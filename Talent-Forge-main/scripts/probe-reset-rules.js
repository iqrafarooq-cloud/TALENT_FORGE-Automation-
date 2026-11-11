// Dev-only probe: on the reset-password page, discover password-requirement UI,
// the mismatch error, and when the submit button enables. Uses the freshest reset
// email link WITHOUT submitting (so the one-time token is preserved).
require('dotenv').config();
const { chromium } = require('playwright');
const { waitForEmail } = require('../utils/gmailClient');

(async () => {
  const { link } = await waitForEmail('resetPassword', { to: process.env.FORGOT_EMAIL, afterUid: 0, timeoutMs: 30000 });
  console.log('using link:', link);

  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const page = await browser.newPage();
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const nw = page.locator('input[name="newPassword"]');
  const cf = page.locator('input[name="confirmNewPassword"]');
  const submit = page.getByRole('button', { name: /reset password/i });

  const snap = async (label) => {
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log(`\n--- ${label} ---`);
    console.log('submit disabled:', await submit.isDisabled());
    console.log('body:', text.slice(0, 700));
  };

  // 1) weak password to surface requirement list
  await nw.click();
  await nw.fill('a');
  await page.waitForTimeout(800);
  await snap('after typing weak "a"');

  // 2) type a strong-looking password
  await nw.fill('NewStrongPass123!');
  await page.waitForTimeout(600);
  await snap('after strong newPassword, empty confirm');

  // 3) mismatched confirm
  await cf.fill('Mismatch123!');
  await cf.blur();
  await page.waitForTimeout(800);
  await snap('after mismatched confirm');

  // 4) matching confirm
  await cf.fill('NewStrongPass123!');
  await cf.blur();
  await page.waitForTimeout(800);
  await snap('after matching confirm (should enable)');

  console.log('\nleaving browser open 6s (NOT submitting)');
  await page.waitForTimeout(6000);
  await browser.close();
})().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
