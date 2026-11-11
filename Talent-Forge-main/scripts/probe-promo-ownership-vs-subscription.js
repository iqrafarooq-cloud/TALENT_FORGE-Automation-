// probe-promo-ownership-vs-subscription.js — WHY is the shared candidate refused a perfectly
// healthy promo code?
//
//   node scripts/probe-promo-ownership-vs-subscription.js
//
// On 2026-07-31 every positive redemption scenario driven by the SHARED candidate started failing:
// the unlimited and fixed agents' codes are refused at the invoice even though
// `node scripts/repair-promo-agents.js` reports both Active, byte-identical to .env, inside their
// expiry dates and on 0 of 10000 uses. Two explanations fit that equally well, and they call for
// completely different fixes:
//
//   OWNERSHIP   the candidate belongs to SIGNUP_AGENT_CODE, not to the promo's agent, and the app
//               has begun enforcing TFF-42's "only that agent's candidates can redeem it".
//               -> the positive scenarios need candidates of the OWNING agent.
//   SUBSCRIBED  the shared candidate already holds a subscription, so a SUBSCRIBE invoice's
//               preview cannot be quoted for it at all, whatever the promo.
//               -> the positive scenarios need a never-subscribed candidate, any agent.
//
// The §5 run cannot separate them: its candidates were BOTH owned by the promo's agent AND
// never-subscribed, and they redeemed fine.
//
// So this holds subscription state constant and varies only ownership: a brand-new,
// NEVER-SUBSCRIBED candidate signed up under SIGNUP_AGENT_CODE — i.e. not the promo's agent —
// applies the unlimited agent's code.
//   refused  -> OWNERSHIP is the cause (never-subscribed is ruled out)
//   accepted -> SUBSCRIPTION STATE is the cause (ownership is ruled out)
//
// Costs one live signup + IMAP verification. NO payment: it stops at the invoice.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

const PROMO = process.env.PROMO_UNLIMITED_AGENT_PROMO_CODE;
const PREVIEW = /\/(payments\/paytabs|subscription\/change)\/preview\/?$/;

async function applyAndReport(subs, page, code, label) {
  await subs.gotoCheckout('Monthly');
  const preview = page
    .waitForResponse(
      (r) => PREVIEW.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 20000 }
    )
    .catch(() => null);
  await subs.openPromo();
  await subs.promoInput.fill(code);
  await subs.promoApplyButton.click();
  const res = await preview;
  await page.waitForTimeout(2000);
  const out = {
    who: label,
    code,
    previewPath: res ? new URL(res.url()).pathname : null,
    previewStatus: res ? res.status() : null,
    previewBody: res ? (await res.text().catch(() => '')).slice(0, 260) : '',
    accepted: await subs.promoRemoveButton.isVisible().catch(() => false),
    discountShown: await subs.discountLine.isVisible().catch(() => false),
    inlineError: await subs.promoError.isVisible().catch(() => false),
    subtotal: await subs.amountFor('Subtotal').catch(() => null),
    total: await subs.amountFor('Total due today').catch(() => null),
  };
  console.log(`\n--- ${label} ---\n${JSON.stringify(out, null, 2)}`);
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const results = [];
  try {
    // ---- A: the SHARED candidate (already subscribed, does NOT own the promo) ----
    const sharedCtx = await browser.newContext();
    const sharedPage = await sharedCtx.newPage();
    const lp = new LoginPage(sharedPage);
    await lp.navigate();
    await lp.emailInput.first().fill(process.env.CANDIDATE_EMAIL);
    await lp.passwordInput.first().fill(process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD);
    await lp.submitButton.first().click();
    await sharedPage.waitForURL(/\/getting-started|\/dashboard|\/profile|\/jobs|\/onboarding/, {
      timeout: 90000, waitUntil: 'commit',
    });
    const sharedSubs = new SubscriptionPage(sharedPage);
    await sharedSubs.gotoSubscriptionTab();
    const state = await sharedSubs.currentState().catch(() => null);
    const plan = state === 'active' ? await sharedSubs.currentPlanName().catch(() => null) : null;
    console.log(`shared candidate ${process.env.CANDIDATE_EMAIL}: state=${state} plan=${plan}`);
    results.push(await applyAndReport(sharedSubs, sharedPage, PROMO, 'SHARED candidate (subscribed, non-owner)'));
    await sharedCtx.close();

    // ---- B: a FRESH candidate under SIGNUP_AGENT_CODE (never subscribed, still NOT the owner) ----
    // This is the isolating case. Same non-ownership as A, opposite subscription state.
    const freshCtx = await browser.newContext();
    const freshPage = await freshCtx.newPage();
    const freshWorld = {
      page: freshPage,
      context: freshCtx,
      browser,
      pages: { subscription: new SubscriptionPage(freshPage) },
    };
    const email = await provisionFreshCandidate(freshWorld);
    console.log(`\nfresh candidate ${email} signed up under SIGNUP_AGENT_CODE=${process.env.SIGNUP_AGENT_CODE}`);
    results.push(await applyAndReport(
      freshWorld.pages.subscription, freshPage, PROMO, 'FRESH candidate (never subscribed, non-owner)'
    ));
    await freshCtx.close();
  } catch (e) {
    console.error(`\nPROBE FAILED: ${(e && e.message ? e.message : String(e)).split('\n')[0]}`);
  } finally {
    console.log('\n=========== VERDICT ===========');
    for (const r of results) {
      console.log(`${r.who.padEnd(46)} preview ${r.previewStatus} accepted=${r.accepted} total=${r.total}`);
    }
    const fresh = results.find((r) => /FRESH/.test(r.who));
    if (fresh) {
      console.log(
        fresh.accepted
          ? '\n=> SUBSCRIPTION STATE is the cause. A never-subscribed candidate of ANOTHER agent can\n'
            + '   redeem, so ownership is NOT being enforced and the shared candidate is refused only\n'
            + '   because it already holds a subscription.'
          : '\n=> OWNERSHIP is the cause. A never-subscribed candidate is still refused, so the only\n'
            + '   remaining difference from the §5 candidates that DID redeem is which agent it\n'
            + '   belongs to. Every positive redemption scenario needs a candidate of the owning agent.'
      );
    }
    await browser.close();
  }
})();
