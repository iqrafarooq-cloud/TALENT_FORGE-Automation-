// probe-expired-resubscribe.js — TFF-406 Scenario B: once a cancelled subscription's
// end date has PASSED, resubscribing must start a NEW subscription (plan selection ->
// invoice -> payment), not merely re-enable auto-renewal the way resubscribing BEFORE
// expiry does. Dev-only utility, not part of the test run.
//
//   node scripts/probe-expired-resubscribe.js
//
// The expired state is reached by making /subscription/current/ 404 (no live subscription
// record) and reporting is_subscribed=false on /auth/me/ — the combination the backend
// genuinely returns once the record is gone. Field names come from
// probe-subscription-mock-fields.js. This prints what the Resubscribe CTA actually does:
// navigates to /subscribe (new subscription) or opens the re-enable confirm modal.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(EMAIL);
    await login.passwordInput.first().fill(PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, {
      timeout: 90000,
      waitUntil: 'commit',
    });

    // ---- expired: no live subscription record ----
    await page.route(/\/api\/v\d\/subscription\/current\/?(\?|$)/, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not found.' }),
      })
    );
    await page.route(/\/api\/v\d\/auth\/me\/?(\?|$)/, async (route) => {
      try {
        const res = await route.fetch();
        const json = await res.json().catch(() => null);
        if (!json) return await route.fulfill({ response: res });
        json.is_subscribed = false;
        json.current_subscription = null;
        json.was_previously_subscribed = true;
        await route.fulfill({ response: res, json });
      } catch {
        await route.continue().catch(() => {});
      }
    });

    // Log any state-changing call the CTA fires (a re-enable would POST/PATCH).
    page.on('request', (req) => {
      if (req.method() !== 'GET' && /subscri|payment/i.test(req.url())) {
        console.log(`  -> ${req.method()} ${req.url().slice(0, 180)}`);
        if (req.postData()) console.log(`     body: ${String(req.postData()).slice(0, 300)}`);
      }
    });

    const sub = new SubscriptionPage(page);
    await sub.gotoSubscriptionTab();
    await page.waitForTimeout(5000);

    console.log(`state per currentState(): ${await sub.currentState()}`);
    console.log(`expired heading visible: ${await page.getByText(/your subscription has expired/i).first().isVisible().catch(() => false)}`);
    console.log(`"Current Subscription" heading visible: ${await sub.currentSubscriptionHeading.isVisible().catch(() => false)}`);
    console.log(`notSubscribedHeading visible: ${await sub.notSubscribedHeading.isVisible().catch(() => false)}`);
    console.log(`Change Plan visible: ${await sub.changePlanButton.isVisible().catch(() => false)}`);
    console.log(`Cancel Plan visible: ${await sub.cancelPlanButton.isVisible().catch(() => false)}`);
    console.log(`Billing History visible: ${await sub.billingHistoryHeading.isVisible().catch(() => false)}`);

    // Exact copy of the expired panel, so assertions match the app's real wording.
    for (const re of [
      /your subscription has expired[^\n]*/i,
      /resubscribe to continue learning/i,
      /your track and progress are saved[^\n]*/i,
    ]) {
      const el = page.getByText(re).first();
      console.log(`copy ${re} -> ${(await el.innerText().catch(() => '(absent)')).replace(/\s+/g, ' ')}`);
    }

    // ---- what does Resubscribe DO here? ----
    const urlBefore = page.url();
    await sub.resubscribeButton.click();
    await page.waitForTimeout(6000);
    console.log(`\nURL before: ${urlBefore}`);
    console.log(`URL after : ${page.url()}`);
    console.log(`navigated to plan selection: ${/\/subscribe(\?|$|\/)/.test(page.url()) && !/checkout/.test(page.url())}`);
    console.log(`navigated to checkout      : ${/\/subscribe\/checkout/.test(page.url())}`);
    const dialog = page.getByRole('dialog').first();
    console.log(`confirm modal opened: ${await dialog.isVisible().catch(() => false)}`);
    if (await dialog.isVisible().catch(() => false)) {
      console.log(`modal text: ${(await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    console.log(`Select Plan buttons on page: ${await page.getByRole('button', { name: /^select plan$/i }).count().catch(() => 0)}`);
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
