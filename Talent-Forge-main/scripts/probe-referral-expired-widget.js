// Read-only: dumps the Promo Code widget's raw DOM on an agent whose promo has EXPIRED, so the
// widget treatment can be compared against the Disabled one. Changes nothing.
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
require('dotenv').config();
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  const EMAIL = process.argv[2] || process.env.REFERRAL_EXPIRED_AGENT_EMAIL;
  const PASSWORD = process.argv[3] || process.env.REFERRAL_EXPIRED_AGENT_PASSWORD;
  console.log('agent:', EMAIL);
  await login.navigate();
  await login.emailInput.first().fill(EMAIL);
  await login.passwordInput.first().fill(PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' });
  const ref = new ReferralCodesPage(page);
  await ref.navigate();

  const w = ref.widget('Promo Code');
  console.log('\n--- Promo Code widget outerHTML ---');
  console.log(await w.evaluate(el => el.outerHTML));

  console.log('\n--- every span.rounded-full inside the widget ---');
  const pills = w.locator('span.rounded-full');
  const n = await pills.count();
  console.log('count:', n);
  for (let i = 0; i < n; i++) {
    const el = pills.nth(i);
    console.log(`  [${i}] text=${JSON.stringify((await el.innerText().catch(()=>'')).trim())} class="${await el.getAttribute('class')}"`);
  }

  console.log('\n--- readers ---');
  console.log('  widgetStatus()   :', JSON.stringify(await ref.widgetStatus('Promo Code')));
  console.log('  hasCopyIcon()    :', await ref.hasCopyIcon('Promo Code'));
  console.log('  copy icon enabled:', await ref.copyIcon('Promo Code').isEnabled().catch(e => 'n/a'));
  console.log('  isCodeWashedOut():', await ref.isCodeWashedOut('Promo Code'));
  console.log('  code colour      :', await ref.codeText('Promo Code').evaluate(el => getComputedStyle(el).color));
  console.log('  share enabled    :', await ref.shareButton('Promo Code').isEnabled().catch(() => 'n/a'));
  await browser.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
