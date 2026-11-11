// Read-only: times open -> close -> open of the share modal, which is what the @provision
// redemption scenario does across its first two Givens - and which straddles the ~2s at which
// the welcome modal appears. Reports where the time goes. Creates nothing.
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
require('dotenv').config();
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2) + 's';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.REFERRAL_AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.REFERRAL_AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' });
  const ref = new ReferralCodesPage(page);
  const welcome = () => ref.welcomeModal.isVisible().catch(() => false);

  const step = async (label, fn) => {
    const s = Date.now();
    const w = await welcome();
    await fn();
    console.log(`${label.padEnd(34)} took ${((Date.now() - s) / 1000).toFixed(1)}s   (welcome modal visible before: ${w}, after: ${await welcome()})  @${at()}`);
  };

  await step('navigate()', () => ref.navigate());
  await step('open #1  (mimics Given 1)', () => ref.openShareModal('Promo Code'));
  await step('  readPromoDetail x2', async () => { await ref.readPromoDetail('Discount'); await ref.readPromoDetail('Usage Limit'); });
  await step('close #1', () => ref.closeShareModal());
  await step('open #2  (mimics Given 2)', () => ref.openShareModal('Promo Code'));
  await step('  readPromoDetail Status', async () => { console.log('    Status =', JSON.stringify(await ref.readPromoDetail('Status'))); });
  await step('close #2', () => ref.closeShareModal());

  // The case the @provision scenario hits: interact AFTER the welcome modal has appeared.
  console.log('--- waiting 3.5s so the welcome modal is definitely up ---');
  await page.waitForTimeout(3500);
  console.log('welcome modal visible:', await welcome());
  await step('open #3 (modal already up)', () => ref.openShareModal('Promo Code'));
  await browser.close();
})().catch(e => { console.error('PROBE FAILED @' + at() + ':', e.message); process.exit(1); });
