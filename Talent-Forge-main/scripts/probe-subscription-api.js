// probe-subscription-api.js — discover the Subscription module's real API endpoints so
// the @mocked scenarios (gateway-connection error, grace period) can intercept the RIGHT
// calls instead of guessing. Dev-only utility, not part of the test run.
//
//   node scripts/probe-subscription-api.js
//
// Prints, for the shared candidate account:
//   [TAB]      every XHR/fetch made while loading /profile?selectedTab=subscription,
//              plus the JSON body of any response that looks like subscription state
//   [CHECKOUT] every XHR/fetch made while loading the Monthly invoice
//   [CONTINUE] the request fired by the invoice "Continue" button (the PayTabs
//              session-create call we need to abort for the gateway-error scenario)
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

// Only app/API traffic is interesting — skip static assets and analytics noise.
const isApi = (url) =>
  /\/api\/|\/v\d\//i.test(url) && !/\.(js|css|png|jpe?g|svg|woff2?|ico|map)(\?|$)/i.test(url);

function watch(page, tag, sink) {
  page.on('request', (req) => {
    if (!isApi(req.url())) return;
    sink.push({ tag, method: req.method(), url: req.url(), post: req.postData() });
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (!isApi(url)) return;
    const ct = (res.headers()['content-type'] || '');
    if (!/json/i.test(ct)) return;
    let body = '';
    try {
      body = JSON.stringify(await res.json());
    } catch {
      return;
    }
    sink.push({ tag, method: 'RESP', status: res.status(), url, body });
  });
}

function dump(sink, tag) {
  console.log(`\n=============== ${tag} ===============`);
  for (const e of sink.filter((s) => s.tag === tag)) {
    if (e.method === 'RESP') {
      console.log(`  <- ${e.status} ${e.url}`);
      // Print enough of the payload to see the field names we must fabricate.
      console.log(`     ${e.body.slice(0, 1200)}`);
    } else {
      console.log(`  -> ${e.method} ${e.url}`);
      if (e.post) console.log(`     body: ${String(e.post).slice(0, 400)}`);
    }
  }
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sink = [];

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
    watch(page, 'TAB', sink);

    // ---- 1. Subscription tab (the GET whose payload drives active/cancelled/grace UI) ----
    await sub.gotoSubscriptionTab();
    await page.waitForTimeout(4000);
    console.log(`\nsubscription tab state: ${await sub.currentState()}`);
    dump(sink, 'TAB');

    // Capture the whole rendered panel text so we know what the active-state DOM says
    // (needed to write the grace-period assertions against real copy).
    const panel = await page.locator('body').innerText().catch(() => '');
    console.log('\n--------- SUBSCRIPTION TAB VISIBLE TEXT ---------');
    console.log(panel.slice(0, 3000));

    // ---- 2. Invoice load ----
    page.removeAllListeners('request');
    page.removeAllListeners('response');
    watch(page, 'CHECKOUT', sink);
    await sub.gotoCheckout('Monthly');
    await page.waitForTimeout(3000);
    dump(sink, 'CHECKOUT');

    // ---- 3. Continue -> gateway session create ----
    page.removeAllListeners('request');
    page.removeAllListeners('response');
    watch(page, 'CONTINUE', sink);
    // Log EVERY request (not just /api/) here — the redirect to PayTabs itself matters.
    page.on('request', (req) => {
      if (/paytabs|payment|checkout|subscri/i.test(req.url())) {
        console.log(`  [any] ${req.method()} ${req.url().slice(0, 160)}`);
      }
    });
    await sub.continueButton.click();
    await page.waitForTimeout(12000);
    console.log(`\nafter Continue, url = ${page.url()}`);
    dump(sink, 'CONTINUE');
    // If the click surfaced a toast/error instead of navigating, show it.
    console.log('\n--------- POST-CONTINUE VISIBLE TEXT ---------');
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 1500));
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
