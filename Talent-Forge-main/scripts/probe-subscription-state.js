// probe-subscription-state.js — dump the FULL subscription-state payloads behind the
// Subscription tab, so the @mocked grace-period scenario can patch the real response
// instead of fabricating one. Dev-only utility.
//
//   node scripts/probe-subscription-state.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const seen = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/core\/api\//.test(url)) return;
    if (!/json/i.test(res.headers()['content-type'] || '')) return;
    let body;
    try {
      body = await res.json();
    } catch {
      return;
    }
    seen.push({ url, status: res.status(), body });
  });

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

    seen.length = 0; // only care about traffic from the tab itself
    const sub = new SubscriptionPage(page);
    await sub.gotoSubscriptionTab();
    await page.waitForTimeout(5000);

    console.log('======== ENDPOINTS HIT BY THE SUBSCRIPTION TAB ========');
    for (const s of seen) console.log(`  ${s.status}  ${s.url}`);

    for (const s of seen) {
      if (/auth\/me/.test(s.url)) {
        console.log('\n======== auth/me -> current_subscription (FULL) ========');
        console.log(JSON.stringify(s.body.current_subscription, null, 2));
        console.log(`\nis_subscribed = ${s.body.is_subscribed}`);
      }
      // Any endpoint that looks like it feeds the billing-history grid.
      if (/subscription|payment|invoice|billing|receipt|transaction/i.test(s.url) && !/auth\/me/.test(s.url)) {
        console.log(`\n======== ${s.url} ========`);
        console.log(JSON.stringify(s.body, null, 2).slice(0, 4000));
      }
    }

    // The grace-period warning + "Update Payment Method" CTA are not visible in the
    // active state, so record which buttons DO exist for comparison.
    const btns = await page.getByRole('button').allInnerTexts().catch(() => []);
    console.log('\n======== BUTTONS ON THE ACTIVE SUBSCRIPTION TAB ========');
    console.log(btns.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
