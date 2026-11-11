// probe-subscription-mock-fields.js — capture the REAL payload field names the four
// remaining @mocked scenarios must patch, so the stubs mutate genuine fields instead of
// inventing a shape the app never returns. Dev-only utility, not part of the test run.
//
//   node scripts/probe-subscription-mock-fields.js
//
// Prints:
//   [CURRENT]  the full GET /subscription/current/ JSON (pretty) — the payload that drives
//              active / cancelled / scheduled-change / grace-period rendering. Needed for:
//                - downgrade ACTIVATION on the cycle-end date  (TFF-405 AC25-27)
//                - resubscribe AFTER expiry                    (TFF-406 Scenario B)
//                - the 5-working-day grace countdown           (TFF-416 AC13-20)
//   [ME]       /auth/me/ -> current_subscription (the app reads sub state from both)
//   [PAYMENTS] the first /payments/ row (billing history row shape)
//   [PLANS]    GET /plans/ — the three genuine plan objects. SubscriptionPage.PLAN_SHAPE
//              embeds these; re-run this probe if the app's pricing/tiers change. Patching a
//              subscription payload with a hand-built plan object is NOT enough: the tab
//              derives its billing-cycle copy from billing_cycle + plan_annual_price, so a
//              partial patch leaves the OLD tier's cycle line on screen.
//   [RETURN]   every request the app makes when coming BACK from PayTabs after a
//              cancelled payment — intended to find the verify/callback endpoint whose
//              status would have to read DECLINED for a declined-card scenario.
//              KNOWN DEAD END on the shared account: it is already subscribed, so the
//              initial-subscribe invoice never reaches a live gateway session and the
//              PayTabs card form never appears (the probe times out waiting for it). To
//              capture this leg you need a FRESH never-subscribed candidate — see
//              features/support/subscriptionProvision.js. Set PROBE_RETURN=false to skip.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

// Set PROBE_RETURN=false to skip the slow PayTabs round trip (sections 1-3 only).
const DO_RETURN = process.env.PROBE_RETURN !== 'false';

const isApi = (url) =>
  /\/api\/|\/v\d\//i.test(url) && !/\.(js|css|png|jpe?g|svg|woff2?|ico|map)(\?|$)/i.test(url);

// Capture response bodies keyed by a matcher so we can pretty-print the full payload.
function captureBodies(page, store) {
  page.on('response', async (res) => {
    const url = res.url();
    if (!isApi(url)) return;
    if (!/json/i.test(res.headers()['content-type'] || '')) return;
    try {
      store.push({ url, status: res.status(), json: await res.json() });
    } catch {
      /* non-JSON / already consumed */
    }
  });
}

function show(store, label, re) {
  console.log(`\n=============== ${label} ===============`);
  const hits = store.filter((e) => re.test(e.url));
  if (!hits.length) {
    console.log('  (no matching response captured)');
    return;
  }
  for (const h of hits) {
    console.log(`  <- ${h.status} ${h.url}`);
    console.log(JSON.stringify(h.json, null, 2).slice(0, 4000));
  }
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const store = [];

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
    console.log(`logged in as ${EMAIL} -> ${page.url()}`);

    const sub = new SubscriptionPage(page);
    captureBodies(page, store);

    // ---- 1-3. Subscription tab payloads ----
    await sub.gotoSubscriptionTab();
    await page.waitForTimeout(5000);
    console.log(`\nsubscription tab state: ${await sub.currentState()}`);

    show(store, 'CURRENT', /\/subscription\/current\/?(\?|$)/);
    show(store, 'ME', /\/auth\/me\/?(\?|$)/);
    show(store, 'PAYMENTS', /\/payments\/?(\?|$)/);

    // The plans list is fetched by the plan-selection screen, not the tab.
    await sub.gotoPlans();
    await page.waitForTimeout(3000);
    show(store, 'PLANS', /\/plans\/?(\?|$)/);

    console.log('\n--------- SUBSCRIPTION TAB VISIBLE TEXT ---------');
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 2500));

    if (!DO_RETURN) return;

    // ---- 4. What the app calls when returning from a CANCELLED PayTabs payment ----
    // The declined-card scenario has to patch whichever call reports the outcome; this
    // records the whole return sequence (URLs + bodies + the transient /payment/result hop).
    console.log('\n=============== RETURN (cancelled payment round trip) ===============');
    const seq = [];
    page.on('request', (req) => {
      const u = req.url();
      if (/paytabs|payment|subscri/i.test(u)) {
        seq.push(`  -> ${req.method()} ${u.slice(0, 200)}${req.postData() ? `\n     body: ${String(req.postData()).slice(0, 300)}` : ''}`);
      }
    });
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) seq.push(`  [nav] ${f.url().slice(0, 200)}`);
    });

    await sub.gotoCheckout('Monthly');
    await sub.cancelPaymentOnPayTabs();
    await page.waitForTimeout(8000);
    console.log(seq.join('\n'));
    console.log(`\nfinal url = ${page.url()}`);

    // Any status/verify response captured during the return leg.
    show(store, 'RETURN payloads', /payment|paytabs|subscription/i);

    console.log('\n--------- POST-RETURN VISIBLE TEXT ---------');
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 1500));
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
