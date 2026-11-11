// probe-subscription-lifecycle-states.js — discover how the Subscription tab RENDERS the
// three lifecycle states that have no UI path, so the @mocked scenarios can assert the
// app's REAL copy instead of guessed wording. Dev-only utility, not part of the test run.
//
//   node scripts/probe-subscription-lifecycle-states.js
//
// Each case patches only specific fields of the genuine /subscription/current/, /auth/me/
// and /payments/ responses (field names taken from probe-subscription-mock-fields.js) and
// dumps the resulting panel text + buttons:
//
//   scheduled-downgrade   scheduled_billing_cycle set     -> does "Changes to X Plan on" render?
//                         (establishes the marker, so the activated case is a real contrast)
//   downgrade-activated   marker CLEARED + plan flipped   -> TFF-405 AC25-27
//   expired-404 / -status cancelled sub past its end date  -> TFF-406 Scenario B
//   grace-countdown       grace_period_end 5 working days  -> is any "N days left" computed
//                         out                                 CLIENT-side from that date?
//   grace-expired         grace_period_end in the PAST     -> what replaces the warning?
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

// "Today" for the probe. Kept explicit so the printed dates are readable in the output.
const TODAY = '2026-07-27';

// 5 WORKING days after `from` (skips Sat/Sun) — the TFF-416 grace window.
function addWorkingDays(from, days) {
  const d = new Date(`${from}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

function shiftDays(from, days) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CASES = [
  {
    name: 'scheduled-downgrade (marker SET — establishes the notice)',
    patchSub: (s) => {
      s.status = 'ACTIVE';
      s.scheduled_billing_cycle = 'monthly';
      s.renewal_date = shiftDays(TODAY, 30);
      return s;
    },
  },
  {
    name: 'downgrade-activated (marker CLEARED + plan flipped to Monthly)',
    patchSub: (s) => {
      s.status = 'ACTIVE';
      s.plan_name = 'Monthly Plan';
      s.plan_price = 155;
      s.billing_cycle = 'Billed Monthly';
      s.scheduled_billing_cycle = '';
      s.cancel_at_period_end = false;
      // Cycle rolled over: the new monthly cycle renews a month from activation.
      s.subscription_start_date = TODAY;
      s.renewal_date = shiftDays(TODAY, 30);
      if (s.payment && s.payment.plan) {
        s.payment.plan.id = 1;
        s.payment.plan.name = 'Monthly Plan';
        s.payment.plan.price = 155;
        s.payment.billing_cycle = 'monthly';
      }
      return s;
    },
  },
  {
    name: 'expired-status (cancelled sub whose end date has passed)',
    patchSub: (s) => {
      s.status = 'EXPIRED';
      s.cancel_at_period_end = true;
      s.cancelled_at = `${shiftDays(TODAY, -40)}T00:00:00Z`;
      s.renewal_date = shiftDays(TODAY, -10);
      return s;
    },
    patchMe: (json) => {
      json.is_subscribed = false;
      json.current_subscription = null;
      json.was_previously_subscribed = true;
      return json;
    },
  },
  {
    name: 'expired-404 (current/ returns 404, as a never/expired account may)',
    subStatus: 404,
    patchMe: (json) => {
      json.is_subscribed = false;
      json.current_subscription = null;
      json.was_previously_subscribed = true;
      return json;
    },
  },
  {
    name: `grace-countdown (grace_period_end = ${addWorkingDays(TODAY, 5)}, 5 working days out)`,
    patchSub: (s) => {
      s.status = 'GRACE_PERIOD';
      s.payment_failed = true;
      s.grace_period_end = addWorkingDays(TODAY, 5);
      s.retry_count = 1;
      s.max_retries = 3;
      return s;
    },
    failFirstPayment: true,
  },
  {
    name: 'grace-expired (grace_period_end in the PAST)',
    patchSub: (s) => {
      s.status = 'EXPIRED';
      s.payment_failed = true;
      s.grace_period_end = shiftDays(TODAY, -3);
      s.retry_count = 3;
      s.max_retries = 3;
      s.renewal_date = shiftDays(TODAY, -8);
      return s;
    },
    patchMe: (json) => {
      json.is_subscribed = false;
      json.current_subscription = null;
      json.was_previously_subscribed = true;
      return json;
    },
    failFirstPayment: true,
  },
];

async function applyCase(page, c) {
  const patchJson = async (route, mutate) => {
    try {
      const res = await route.fetch();
      const json = await res.json().catch(() => null);
      if (!json) return await route.fulfill({ response: res });
      await route.fulfill({ response: res, json: mutate(json) });
    } catch {
      await route.continue().catch(() => {});
    }
  };

  await page.route(/\/api\/v\d\/subscription\/current\/?(\?|$)/, async (route) => {
    if (c.subStatus) {
      return route.fulfill({
        status: c.subStatus,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not found.' }),
      });
    }
    await patchJson(route, (json) => c.patchSub(json));
  });

  await page.route(/\/api\/v\d\/auth\/me\/?(\?|$)/, (route) =>
    patchJson(route, (json) => {
      if (c.patchMe) return c.patchMe(json);
      if (json.current_subscription) c.patchSub(json.current_subscription);
      return json;
    })
  );

  if (c.failFirstPayment) {
    await page.route(/\/api\/v\d\/payments\/(\?|$)/, (route) =>
      patchJson(route, (json) => {
        if (Array.isArray(json.results) && json.results.length) {
          json.results[0].status = 'FAILED';
          json.results[0].failure_reason = 'Card declined by issuer';
          json.results[0].paid_at = null;
          json.results[0].receipt_document = null;
        }
        return json;
      })
    );
  }
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  const browser = await chromium.launch({ headless: true });

  for (const c of CASES) {
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

      await applyCase(page, c);

      const sub = new SubscriptionPage(page);
      await sub.gotoSubscriptionTab();
      await page.waitForTimeout(5000);

      console.log(`\n\n############ ${c.name} ############`);
      console.log(`detected state: ${await sub.currentState()}`);
      const txt = (await page.locator('body').innerText().catch(() => '')) || '';
      const start = txt.search(/current subscription|you're not subscribed/i);
      console.log('--------- VISIBLE TEXT ---------');
      console.log(txt.slice(start > 0 ? start : 0, (start > 0 ? start : 0) + 1800));

      const btns = await page.getByRole('button').allInnerTexts().catch(() => []);
      console.log('--------- BUTTONS ---------');
      console.log(btns.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
    } catch (e) {
      console.error(`PROBE ERROR (${c.name}):`, e.message);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
})();
