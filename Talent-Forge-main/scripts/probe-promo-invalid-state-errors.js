// probe-promo-invalid-state-errors.js — does EVERY invalid promo state show the same
// inline error the AC now specifies ("Invalid or expired promotion code")?
//
//   node scripts/probe-promo-invalid-state-errors.js
//
// TFF-42/TFF-43 as clarified 2026-07-31: a candidate must be told the same thing whether the
// code does not exist, belongs to a different agent, has been disabled, has expired, or has
// hit its usage limit. Four of those five are reachable without spending a payment, and this
// probe drives all four against ONE candidate session and ONE superadmin session so the four
// answers can be compared directly rather than inferred from four separate runs.
//
// Existing probes cover only slices of this: probe-promo-expired-redemption.js does the expired
// case alone, and the disabled case was only ever observed through the §7 @known-issue scenario,
// which asserts the message and therefore reports "not shown" without saying what IS shown.
//
// USAGE LIMIT REACHED is deliberately absent — reaching it costs a real payment against a
// throwaway agent, which is what Promo-Code-Lifecycle.feature §5 exists for.
//
// SAFE TO RUN AT ANY TIME. The limited agent's promo is snapshotted first and restored in a
// finally block, and nothing here completes a payment, so no promo usage is burned.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const LIMITED_NAME = process.env.PROMO_LIMITED_AGENT_NAME;
const LIMITED_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const LIMITED_CODE = process.env.PROMO_LIMITED_AGENT_PROMO_CODE;
const OTHER_CODE = process.env.PROMO_UNLIMITED_AGENT_PROMO_CODE;
const EXPECTED = /invalid or expired promotion code/i;

async function login(browser, email, password, urlRe, label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const lp = new LoginPage(page);
  await lp.navigate();
  await lp.emailInput.first().fill(email);
  await lp.passwordInput.first().fill(password);
  await lp.submitButton.first().click();
  await page.waitForURL(urlRe, { timeout: 90000, waitUntil: 'commit' });
  console.log(`  logged in as ${label}`);
  return { context, page };
}

// Every visible string on the invoice that could be an error about the promo. Collected
// generically rather than from a locator, because the whole question is WHICH wording the app
// renders — a locator for the expected wording can only ever answer "absent".
async function promoMessages(page) {
  return page.evaluate(() => {
    const re = /invalid|expired|not valid|no longer|cannot|couldn't|could not|unavailable|limit/i;
    const seen = new Set();
    for (const el of document.querySelectorAll('p, span, div, small, label')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 160 && re.test(t)) seen.add(t);
    }
    return [...seen];
  });
}

// Open a clean Monthly invoice, apply `code`, and report everything that decides the assertion.
async function applyAndReport(subs, page, code, caseName) {
  await subs.gotoCheckout('Monthly');
  const preview = page
    .waitForResponse(
      (r) => /\/(payments\/paytabs|subscription\/change)\/preview\/?$/.test(new URL(r.url()).pathname)
        && r.request().method() === 'POST',
      { timeout: 20000 }
    )
    .catch(() => null);
  await subs.openPromo();
  await subs.promoInput.fill(code);
  await subs.promoApplyButton.click();
  const res = await preview;
  await page.waitForTimeout(2000);

  const body = res ? await res.text().catch(() => '') : '';
  const report = {
    case: caseName,
    code,
    previewStatus: res ? res.status() : null,
    previewBody: body.slice(0, 220),
    expectedErrorShown: await subs.promoError.isVisible().catch(() => false),
    removeChipShown: await subs.promoRemoveButton.isVisible().catch(() => false),
    discountLineShown: await subs.discountLine.isVisible().catch(() => false),
    applyStillEnabled: await subs.promoApplyButton.isEnabled().catch(() => null),
    subtotal: await subs.amountFor('Subtotal').catch(() => null),
    total: await subs.amountFor('Total due today').catch(() => null),
    visibleMessages: await promoMessages(page),
  };
  console.log(`\n--- ${caseName} (${code}) ---`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`  VERDICT: "${EXPECTED.source}" ${report.expectedErrorShown ? 'IS' : 'is NOT'} shown`);
  return report;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  let promo = null;
  let snapshot = null;
  const results = [];
  try {
    const admin = await login(
      browser,
      process.env.SUPERADMIN_EMAIL,
      process.env.SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/,
      'superadmin'
    );
    promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(LIMITED_NAME || LIMITED_EMAIL);
    snapshot = await promo.snapshotParameters();
    console.log(`  limited agent's promo BEFORE: ${JSON.stringify(await promo.readAllParameters())}`);

    const cand = await login(
      browser,
      process.env.CANDIDATE_EMAIL,
      process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD,
      /\/getting-started|\/dashboard|\/profile|\/jobs|\/onboarding/,
      'candidate'
    );
    const subs = new SubscriptionPage(cand.page);

    // --- CONTROL 1: a code that does not exist. The reference wording. ---
    results.push(await applyAndReport(subs, cand.page, 'NOSUCHCODE123', 'UNKNOWN CODE'));

    // --- CONTROL 2: a real, ACTIVE code owned by an agent this candidate does not belong to. ---
    if (OTHER_CODE) {
      results.push(await applyAndReport(subs, cand.page, OTHER_CODE, "ANOTHER AGENT'S ACTIVE CODE"));
    }

    // --- CASE A: DISABLED ---
    await promo.setStatusAndSave(false);
    await promo.openPromoTools(LIMITED_NAME || LIMITED_EMAIL);
    console.log(`\n  promo now: ${JSON.stringify(await promo.readAllParameters())}`);
    results.push(await applyAndReport(subs, cand.page, LIMITED_CODE, 'DISABLED'));
    await promo.setStatusAndSave(true);
    await promo.openPromoTools(LIMITED_NAME || LIMITED_EMAIL);
    console.log(`  re-enabled: ${JSON.stringify(await promo.readAllParameters())}`);

    // --- CASE B: EXPIRED ---
    const backdated = await promo.backdateExpiry({ daysPast: 1 });
    await promo.openPromoTools(LIMITED_NAME || LIMITED_EMAIL);
    console.log(`\n  backdated to ${backdated.expiryDate} -> ${JSON.stringify(await promo.readAllParameters())}`);
    results.push(await applyAndReport(subs, cand.page, LIMITED_CODE, 'EXPIRED'));

    await cand.context.close();
  } catch (e) {
    console.error(`\nPROBE FAILED: ${(e && e.message ? e.message : String(e)).split('\n')[0]}`);
  } finally {
    if (promo && snapshot) {
      const restored = await promo.restoreParameters(snapshot).catch((e) => ({ restored: false, reason: e.message }));
      await promo.openPromoTools(LIMITED_NAME || LIMITED_EMAIL).catch(() => {});
      console.log(`\nRESTORE ${JSON.stringify(restored)} -> ${JSON.stringify(await promo.readAllParameters().catch(() => null))}`);
    }
    console.log('\n=========== SUMMARY ===========');
    for (const r of results) {
      console.log(
        `${r.case.padEnd(28)} preview ${String(r.previewStatus).padEnd(4)} `
        + `expectedError=${String(r.expectedErrorShown).padEnd(5)} removeChip=${String(r.removeChipShown).padEnd(5)} `
        + `discount=${String(r.discountLineShown).padEnd(5)} total=${r.total}`
      );
    }
    await browser.close();
  }
})();
