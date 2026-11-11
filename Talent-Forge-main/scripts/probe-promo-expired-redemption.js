// probe-promo-expired-redemption.js — what does a candidate SEE when the promo is expired?
//
//   node scripts/probe-promo-expired-redemption.js
//
// Follows on from probe-promo-expire-via-rewrite.js, which established that rewriting the
// outgoing PATCH body lets the suite expire a promo for real. This one answers the question
// the assertions actually depend on: does an EXPIRED code render the inline
// "Invalid or expired promotion code" (like an unknown code does), or does it render the
// applied-code chip with no field error (like a DISABLED code does — the §7 known issue)?
//
// Step 1 reports the current state and restores the expiry date if a previous probe left it
// in the past, so this is safe to run at any time.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const AGENT_NAME = process.env.PROMO_LIMITED_AGENT_NAME;
const AGENT_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const AGENT_CODE = process.env.PROMO_LIMITED_AGENT_PROMO_CODE;
const PROMOTION_PATCH = /\/core\/api\/v1\/agents\/\d+\/promotion\/?$/;
const SAFE_EXPIRY = '2027-07-30'; // the provisioned value (+365d from 2026-07-30)

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

// Put the expiry back to a future date. The form allows this through the UI unaided.
async function unexpire(promo, iso) {
  await promo.openEditParameters();
  await promo.setExpiryDate(iso);
  if (!(await promo.isSaveEnabled())) {
    await promo.cancelEdit();
    return false;
  }
  await promo.saveChanges();
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  let promo = null;
  try {
    const admin = await login(browser, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/);
    promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`BEFORE: ${JSON.stringify(await promo.readAllParameters())}`);

    // --- expire it (valid date in the form, past date on the wire) ---
    const past = isoOffset(-1);
    await admin.page.route(PROMOTION_PATCH, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* keep {} */ }
      await route.continue({ postData: JSON.stringify({ ...body, expiry_date: past }) });
    });
    await promo.openEditParameters();
    await promo.setExpiryDate(isoOffset(30));
    await promo.saveChanges();
    await admin.page.unroute(PROMOTION_PATCH);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`EXPIRED: ${JSON.stringify(await promo.readAllParameters())}`);
    console.log(`ICONS:   ${JSON.stringify(await promo.warningIcons())}`);

    // --- candidate tries to redeem it ---
    const cand = await login(browser, process.env.CANDIDATE_EMAIL,
      process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD,
      /\/getting-started|\/dashboard|\/profile|\/jobs|\/onboarding/);
    const subs = new SubscriptionPage(cand.page);
    await subs.gotoPlans();
    await subs.selectPlan('Monthly');
    const r = await subs.applyPromoAwaitingPreview(AGENT_CODE).catch((e) => ({ error: e.message.split('\n')[0] }));
    console.log(`\nAPPLY:   ${JSON.stringify(r).slice(0, 600)}`);
    console.log(`inline "Invalid or expired promotion code": ${await cand.page.getByText(/invalid or expired promotion code/i).first().isVisible().catch(() => false)}`);
    console.log(`bare    "Invalid promo code.":              ${await cand.page.getByText(/^Invalid promo code\.?$/i).first().isVisible().catch(() => false)}`);
    console.log(`applied-code "Remove" chip visible:         ${await subs.promoRemoveButton.isVisible().catch(() => false)}`);
    console.log(`discount line visible:                      ${await subs.discountLine.isVisible().catch(() => false)}`);
    await cand.context.close();
  } catch (e) {
    console.error(`\nPROBE FAILED: ${e.message.split('\n')[0]}`);
  } finally {
    if (promo) {
      const ok = await unexpire(promo, SAFE_EXPIRY).catch(() => false);
      await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL).catch(() => {});
      console.log(`\nRESTORE(${ok}): ${JSON.stringify(await promo.readAllParameters().catch(() => null))}`);
    }
    await browser.close();
  }
})();
