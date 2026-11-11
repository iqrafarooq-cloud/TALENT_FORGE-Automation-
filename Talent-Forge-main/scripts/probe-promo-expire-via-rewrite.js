// probe-promo-expire-via-rewrite.js — expire a promo for real, by rewriting the app's own
// save request instead of fabricating an API call.
//
//   node scripts/probe-promo-expire-via-rewrite.js
//
// WHY. "Save Changes" in Promo Tools > Edit Code Parameters is silently disabled for any
// expiry date before today, so the UI cannot produce an expired promo. Calling the API
// directly does not work either — the session is not a storage JWT, so a hand-rolled fetch
// answers 401 (checked by scripts/probe-promo-expire-via-api.js).
//
// So: put a VALID future date in the form (Save enabled), and rewrite `expiry_date` in the
// PATCH body on its way out. The app itself supplies the auth; only the date changes. That
// makes "its expiry date passes" a real lifecycle transition the suite can drive.
//
// Prints the request headers of a genuine save, the API's answer to the rewritten one, and
// then what the superadmin tab / agent bell / a candidate redemption report. RESTORES the
// original expiry date before exiting.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const AGENT_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.PROMO_LIMITED_AGENT_PASSWORD;
const AGENT_NAME = process.env.PROMO_LIMITED_AGENT_NAME;
const AGENT_CODE = process.env.PROMO_LIMITED_AGENT_PROMO_CODE;

const PROMOTION_PATCH = /\/core\/api\/v1\/agents\/\d+\/promotion\/?$/;

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function login(browser, email, password, urlRe) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(urlRe, { timeout: 90000, waitUntil: 'commit' });
  return { context, page };
}

// Read the bell panel as a user would.
async function readBell(page, tag) {
  const bell = page.locator('header button[aria-label*="notification" i], button[aria-label*="notification" i]').first();
  if (!(await bell.isVisible().catch(() => false))) {
    console.log(`  [${tag}] no notifications bell`);
    return;
  }
  await bell.click();
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => {
    const p = document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]');
    return p ? (p.innerText || '').slice(0, 900) : null;
  });
  console.log(`  [${tag}] bell panel:\n${(text || '(none)').split('\n').map((l) => `      ${l}`).join('\n')}`);
  await page.keyboard.press('Escape').catch(() => {});
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  let promo = null;
  let snap = null;
  try {
    const admin = await login(browser, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/);
    promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    snap = await promo.snapshotParameters();
    console.log(`snapshot ${JSON.stringify(snap)}`);

    const past = isoOffset(-1);
    let seen = null;

    // Rewrite the outgoing PATCH: keep everything the app sent, swap only the date.
    await admin.page.route(PROMOTION_PATCH, async (route) => {
      const req = route.request();
      if (req.method() !== 'PATCH') return route.fallback();
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* keep {} */ }
      seen = { headers: req.headers(), original: body };
      await route.continue({ postData: JSON.stringify({ ...body, expiry_date: past }) });
    });

    // A valid future date so the form lets us press Save; the route swaps it for `past`.
    await promo.openEditParameters();
    await promo.setExpiryDate(isoOffset(30));
    console.log(`Save enabled with a +30d date: ${await promo.isSaveEnabled()}`);
    const [res] = await Promise.all([
      admin.page.waitForResponse((r) => PROMOTION_PATCH.test(new URL(r.url()).pathname), { timeout: 30000 }).catch(() => null),
      promo.saveChanges().catch((e) => console.log(`saveChanges: ${e.message.split('\n')[0]}`)),
    ]);
    await admin.page.unroute(PROMOTION_PATCH);

    console.log(`\n=============== REWRITE ===============`);
    console.log(`  app sent:      ${JSON.stringify(seen && seen.original)}`);
    console.log(`  auth headers:  ${JSON.stringify(Object.fromEntries(
      Object.entries((seen && seen.headers) || {}).filter(([k]) => /auth|cookie|token|x-/i.test(k))
    )).slice(0, 300)}`);
    console.log(`  we sent:       expiry_date=${past}`);
    console.log(res ? `  API answered:  ${res.status()}\n     ${(await res.text().catch(() => '')).slice(0, 500)}`
      : '  no PATCH response captured');

    console.log(`\n=============== EFFECT (superadmin tab) ===============`);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`  parameters:    ${JSON.stringify(await promo.readAllParameters())}`);
    console.log(`  warning icons: ${JSON.stringify(await promo.warningIcons())}`);
    await readBell(admin.page, 'superadmin');

    // ---- agent side ----
    const agent = await login(browser, AGENT_EMAIL, AGENT_PASSWORD,
      /\/dashboard|\/candidates|\/verifications|\/activity-log/);
    console.log(`\n=============== EFFECT (agent) ===============`);
    await readBell(agent.page, 'agent');
    await agent.context.close();

    // ---- candidate redemption ----
    const candEmail = process.env.CANDIDATE_EMAIL;
    const candPass = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;
    if (candEmail && candPass) {
      const cand = await login(browser, candEmail, candPass, /\/getting-started|\/dashboard|\/profile|\/jobs|\/onboarding/);
      const SubscriptionPage = require('../pages/SubscriptionPage');
      const subs = new SubscriptionPage(cand.page);
      console.log(`\n=============== EFFECT (candidate redemption) ===============`);
      await subs.gotoPlans().catch((e) => console.log(`  gotoPlans: ${e.message.split('\n')[0]}`));
      await subs.selectPlan('Monthly').catch((e) => console.log(`  selectPlan: ${e.message.split('\n')[0]}`));
      const r = await subs.applyPromoAwaitingPreview(AGENT_CODE).catch((e) => ({ error: e.message.split('\n')[0] }));
      console.log(`  applyPromo: ${JSON.stringify(r).slice(0, 500)}`);
      const err = await cand.page.getByText(/invalid or expired promotion code/i).first().isVisible().catch(() => false);
      console.log(`  inline "Invalid or expired promotion code" visible: ${err}`);
      await cand.context.close();
    }
  } catch (e) {
    console.error(`\nPROBE FAILED: ${e.message.split('\n')[0]}`);
  } finally {
    if (promo && snap) {
      const back = await promo.restoreParameters(snap).catch((e) => ({ restored: false, reason: e.message }));
      console.log(`\nRESTORE: ${JSON.stringify(back)}`);
      const now = await promo.readAllParameters().catch(() => null);
      console.log(`now: ${JSON.stringify(now)}`);
    }
    await browser.close();
  }
})();
