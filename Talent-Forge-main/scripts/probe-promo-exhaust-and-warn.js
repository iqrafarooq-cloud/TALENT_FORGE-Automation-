// probe-promo-exhaust-and-warn.js — the last two questions before the @not-automatable
// scenarios in Promo-Code-Lifecycle.feature can be automated.
//
//   node scripts/probe-promo-exhaust-and-warn.js
//
// [EXHAUST]  the Edit form enforces "Usage Limit >= 1", but the save is a plain PATCH. If the
//            API accepts usage_limit = 0 (or = total_usage) the promo becomes exhausted
//            WITHOUT burning real payments, which would make "its usage limit is reached"
//            automatable for the first time.
// [WARN]     set the expiry date to exactly +14 days (a date the form accepts unaided). Does
//            an "expiry reminder" in-app notification appear for the agent or the superadmin
//            immediately, or is it a scheduled job?
// [MAIL]     which promo-related subject lines have actually landed for this agent — i.e.
//            does expiry send the agent an email the way disabling does?
//
// Restores the promo to Active / +365d / limit 2 before exiting. Prints everything; do NOT
// pipe it through `head` — a closed pipe can kill the process before the restore runs.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const { makeClient } = require('../utils/gmailClient');

const AGENT_NAME = process.env.PROMO_LIMITED_AGENT_NAME;
const AGENT_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.PROMO_LIMITED_AGENT_PASSWORD;
const PROMOTION_PATCH = /\/core\/api\/v1\/agents\/\d+\/promotion\/?$/;

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function login(browser, email, password, urlRe) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const lp = new LoginPage(page);
  await lp.navigate();
  await lp.emailInput.first().fill(email);
  await lp.passwordInput.first().fill(password);
  await lp.submitButton.first().click();
  await page.waitForURL(urlRe, { timeout: 90000, waitUntil: 'commit' });
  return { context, page };
}

// Save the Edit form with `override` merged into the outgoing PATCH body, so values the
// form refuses (a past date, a zero limit) still reach the API.
//
// NOTE, learned the hard way: "Save Changes" is disabled whenever the form is NOT DIRTY, not
// only when the expiry date is in the past. So every call has to make a REAL change to some
// field first — `dirty` does that — and only then is the wire value swapped.
async function saveWithOverride(page, promo, dirty, override) {
  let sent = null;
  const handler = async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* keep {} */ }
    sent = { ...body, ...override };
    await route.continue({ postData: JSON.stringify(sent) });
  };
  await page.route(PROMOTION_PATCH, handler);
  try {
    await promo.openEditParameters();
    await dirty();
    if (!(await promo.isSaveEnabled())) {
      await promo.cancelEdit();
      return { sent: null, status: null, body: 'Save stayed disabled — the form was not dirty' };
    }
    const [res] = await Promise.all([
      page.waitForResponse((r) => PROMOTION_PATCH.test(new URL(r.url()).pathname), { timeout: 30000 }).catch(() => null),
      promo.saveChanges().catch((e) => console.log(`    saveChanges: ${e.message.split('\n')[0]}`)),
    ]);
    return { sent, status: res && res.status(), body: res ? await res.text().catch(() => '') : '' };
  } finally {
    await promo.cancelEdit().catch(() => {});
    await page.unroute(PROMOTION_PATCH, handler).catch(() => {});
  }
}

async function readBell(page, tag) {
  const bell = page.locator('header button[aria-label*="notification" i], button[aria-label*="notification" i]').first();
  if (!(await bell.isVisible().catch(() => false))) return console.log(`    [${tag}] no bell`);
  await bell.click();
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => {
    const p = document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]');
    return p ? (p.innerText || '') : '';
  });
  // Only the promo/expiry lines matter — the panel is full of unrelated System Alerts.
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => /promo|expir|usage|limit|unread/i.test(l));
  console.log(`    [${tag}] promo/expiry lines: ${JSON.stringify(lines.slice(0, 12))}`);
  await page.keyboard.press('Escape').catch(() => {});
}

async function promoSubjects(to) {
  const client = makeClient();
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since: new Date(Date.now() - 6 * 60 * 60 * 1000) }, { uid: true });
      const out = [];
      for (const uid of (uids || []).slice(-60)) {
        const msg = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
        const subj = msg && msg.envelope && msg.envelope.subject;
        if (subj && /promo/i.test(subj)) out.push(subj);
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  let promo = null;
  let admin = null;
  try {
    admin = await login(browser, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/);
    promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`BEFORE: ${JSON.stringify(await promo.readAllParameters())}`);

    // ---------------- [EXHAUST] ----------------
    console.log('\n=============== EXHAUST ===============');
    for (const limit of [0, -1]) {
      // Dirty the form with a limit the form ACCEPTS (3), then send `limit` on the wire.
      const r = await saveWithOverride(admin.page, promo, () => promo.setUsageLimit('3'), { usage_limit: limit });
      console.log(`  usage_limit=${limit} -> ${r.status}\n     ${String(r.body).slice(0, 400)}`);
      if (r.status && r.status < 400) {
        await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
        console.log(`     tab now: ${JSON.stringify(await promo.readAllParameters())}`);
        console.log(`     icons:   ${JSON.stringify(await promo.warningIcons())}`);
        break;
      }
    }
    // Put the limit back before moving on.
    const back = await saveWithOverride(admin.page, promo, () => promo.setUsageLimit('2'), {});
    console.log(`  restore usage_limit=2 -> ${back.status}`);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`  tab now: ${JSON.stringify(await promo.readAllParameters())}`);

    // ---------------- [WARN] ----------------
    console.log('\n=============== WARN (+14d expiry) ===============');
    const warn = await saveWithOverride(admin.page, promo, () => promo.setExpiryDate(isoOffset(14)), {});
    console.log(`  +14d save -> ${warn.status}\n     ${String(warn.body).slice(0, 300)}`);
    await admin.page.waitForTimeout(5000);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`  tab now: ${JSON.stringify(await promo.readAllParameters())}`);
    await readBell(admin.page, 'superadmin');

    const agent = await login(browser, AGENT_EMAIL, AGENT_PASSWORD,
      /\/dashboard|\/candidates|\/verifications|\/activity-log/);
    await readBell(agent.page, 'agent');
    await agent.context.close();

    // ---------------- [MAIL] ----------------
    console.log('\n=============== MAIL (last 6h, promo subjects) ===============');
    const subs = await promoSubjects(AGENT_EMAIL).catch((e) => [`(imap failed: ${e.message.split('\n')[0]})`]);
    const counts = subs.reduce((a, s) => ({ ...a, [s]: (a[s] || 0) + 1 }), {});
    console.log(`  ${JSON.stringify(counts, null, 2)}`);
  } catch (e) {
    console.error(`\nPROBE FAILED: ${e.message.split('\n')[0]}`);
  } finally {
    if (promo && admin) {
      try {
        await promo.cancelEdit().catch(() => {});
        await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
        await promo.openEditParameters();
        await promo.setStatus(true);
        await promo.setExpiryDate('2027-07-30');
        await promo.setUsageLimit('2');
        if (await promo.isSaveEnabled()) await promo.saveChanges();
        else await promo.cancelEdit();
        await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
        console.log(`\nRESTORE: ${JSON.stringify(await promo.readAllParameters())}`);
      } catch (e) {
        console.log(`\nRESTORE FAILED: ${e.message.split('\n')[0]}`);
        console.log(`  !! by hand: ${AGENT_NAME} > Promo Tools > Edit parameters -> Status ON, expiry 2027-07-30, usage limit 2`);
      }
    }
    await browser.close();
  }
})();
