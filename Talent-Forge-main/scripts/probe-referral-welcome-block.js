// Read-only: does the first-time welcome modal cover the Referral Codes widgets, and what
// dismisses it? Reproduces the race that broke the superadmin-comparison scenario.
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
require('dotenv').config();
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.REFERRAL_AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.REFERRAL_AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' });
  const ref = new ReferralCodesPage(page);
  await ref.navigate();

  const modal = page.locator('div.fixed.inset-0').filter({ hasText: /welcome,/i }).first();
  for (const t of [0, 1000, 2000, 4000, 8000]) {
    if (t) await page.waitForTimeout(t === 1000 ? 1000 : t - (t === 2000 ? 1000 : t === 4000 ? 2000 : 4000));
    console.log(`t≈${t}ms  welcomeModal visible: ${await modal.isVisible().catch(() => false)}`);
  }
  console.log('\nsessionStorage:', JSON.stringify(await page.evaluate(() => ({ ...sessionStorage }))));
  const dlg = page.locator('[role="dialog"]');
  console.log('role=dialog count:', await dlg.count());
  if (await modal.isVisible().catch(() => false)) {
    console.log('\nmodal buttons:');
    const btns = modal.getByRole('button');
    for (let i = 0; i < await btns.count(); i++) {
      const b = btns.nth(i);
      console.log(`  [${i}] text=${JSON.stringify((await b.innerText().catch(() => '')).trim())} aria-label=${JSON.stringify(await b.getAttribute('aria-label'))}`);
    }
    console.log('\n"Dismiss" button present:', await page.getByRole('button', { name: /^dismiss$/i }).first().isVisible().catch(() => false));
    console.log('trying Escape...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    console.log('  after Escape, visible:', await modal.isVisible().catch(() => false));
    console.log('  sessionStorage now:', JSON.stringify(await page.evaluate(() => ({ ...sessionStorage }))));
    console.log('  Share Code clickable now:',
      await ref.shareButton('Promo Code').click({ trial: true, timeout: 5000 }).then(() => true).catch(e => e.message.slice(0, 60)));
  }
  await browser.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
