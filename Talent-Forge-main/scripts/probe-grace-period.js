// probe-grace-period.js — discover how the Subscription tab RENDERS a failed
// auto-renewal (grace period), by patching the real API responses instead of guessing:
//
//   GET /core/api/v1/subscription/current/  -> payment_failed / grace_period_end / retry_count
//   GET /core/api/v1/auth/me/               -> same fields under current_subscription
//   GET /core/api/v1/payments/?page=...     -> first row status flipped to a FAILED variant
//
// Prints the resulting visible text + button list so the grace-period assertions can be
// written against the app's real copy. Also tries each candidate "failed" status string
// so we learn which one the billing-history grid labels "Payment Failed".
//
//   node scripts/probe-grace-period.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

const GRACE_END = '2026-08-05';
const CANDIDATE_STATUSES = ['FAILED', 'PAYMENT_FAILED'];

async function patchRoutes(page, failedStatus) {
  // Subscription state -> grace period.
  const patchSub = (s) => {
    if (!s) return s;
    s.status = 'GRACE_PERIOD';
    s.payment_failed = true;
    s.grace_period_end = GRACE_END;
    s.retry_count = 1;
    s.max_retries = 3;
    return s;
  };

  await page.route('**/core/api/v1/subscription/current/', async (route) => {
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    if (!json) return route.fulfill({ response: res });
    await route.fulfill({ response: res, json: patchSub(json) });
  });

  await page.route('**/core/api/v1/auth/me/', async (route) => {
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    if (!json) return route.fulfill({ response: res });
    if (json.current_subscription) patchSub(json.current_subscription);
    await route.fulfill({ response: res, json });
  });

  await page.route('**/core/api/v1/payments/**', async (route) => {
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.results) || !json.results.length) {
      return route.fulfill({ response: res });
    }
    json.results[0].status = failedStatus;
    json.results[0].failure_reason = 'Card declined by issuer';
    json.results[0].paid_at = null;
    await route.fulfill({ response: res, json });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const status of CANDIDATE_STATUSES) {
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

      await patchRoutes(page, status);

      const sub = new SubscriptionPage(page);
      await sub.gotoSubscriptionTab();
      await page.waitForTimeout(5000);

      console.log(`\n\n############ payments status = "${status}" ############`);
      const txt = (await page.locator('body').innerText().catch(() => '')) || '';
      // Trim the profile chrome — start at the subscription panel.
      const start = txt.search(/current subscription|you're not subscribed/i);
      console.log('--------- VISIBLE TEXT ---------');
      console.log(txt.slice(start > 0 ? start : 0, (start > 0 ? start : 0) + 2200));

      const btns = await page.getByRole('button').allInnerTexts().catch(() => []);
      console.log('--------- BUTTONS ---------');
      console.log(btns.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));

      const links = await page.getByRole('link').allInnerTexts().catch(() => []);
      console.log('--------- LINKS ---------');
      console.log(links.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30).join(' | '));

      // Are the first row's receipt actions disabled now that it is not Paid?
      const firstRow = sub.billingRows.first();
      const actions = firstRow.locator('button, a');
      const n = await actions.count().catch(() => 0);
      const states = [];
      for (let i = 0; i < n; i++) {
        const a = actions.nth(i);
        states.push(
          `${(await a.getAttribute('aria-label')) || (await a.innerText().catch(() => '')) || '?'}=` +
            `${(await a.isEnabled().catch(() => null)) ? 'enabled' : 'disabled'}`
        );
      }
      console.log('--------- FIRST BILLING ROW ACTIONS ---------');
      console.log(states.join(' | ') || '(none found)');
    } catch (e) {
      console.error(`PROBE ERROR (${status}):`, e.message);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
})();
