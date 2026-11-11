// What does PayTabs do with an EXPIRED card (12/25, i.e. in the past)? Provisions a
// fresh never-subscribed candidate, submits 4242… with 12/25, and reports where the
// browser ends up and what error text is shown — gateway-side inline error vs a
// redirect back to the app's /payment/result with a failure toast.
require('dotenv').config();
const path = require('path');
const { chromium } = require('playwright');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

const OUT = path.join(__dirname, '..', 'reports');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const world = { page, pages: {} };
  const sub = new SubscriptionPage(page);
  world.pages.subscription = sub;

  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV ->', f.url()); });

  console.log('provisioning…');
  console.log('email:', await provisionFreshCandidate(world));

  await sub.gotoCheckout('Monthly');
  await sub.continueButton.click();
  await page.waitForURL(/paytabs\./i, { timeout: 60000 });
  await sub.typeCardDetails({ number: '4242424242424242', month: '12', year: '25', cvv: '123' });
  await page.screenshot({ path: path.join(OUT, 'expired-01-form.png'), fullPage: true });
  await sub.paytabsPayNow.click();

  for (let i = 1; i <= 9; i++) {
    await page.waitForTimeout(5000);
    console.log(`t+${i * 5}s`, page.url());
    if (!/paytabs\./i.test(page.url())) break;
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'expired-02-after.png'), fullPage: true });
  const text = (await page.evaluate(() => document.body.innerText).catch(() => '')) || '';
  console.log('URL:', page.url());
  console.log('---- TEXT ----\n' + text.slice(0, 2000));
  await browser.close();
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
