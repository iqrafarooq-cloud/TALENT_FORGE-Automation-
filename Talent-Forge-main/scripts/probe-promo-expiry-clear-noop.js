// probe-promo-expiry-clear-noop.js — READ ONLY. Does setExpiryDate('') do ANYTHING to the Edit
// Code Parameters modal, and can a user clear Expiry Date at all?
//
//   node scripts/probe-promo-expiry-clear-noop.js
//
// The control is a calendar-button-only react-aria DatePicker: one <button aria-label="Calendar">
// showing dd/mm/yyyy, and a hidden aria-hidden <input type="date" tabindex="-1"> that mirrors it.
// AdminPromoToolsPage.expiryDateInput resolves to the MIRROR. So this checks the visible button
// before and after a fill(''), which is the difference between "the app shows no required error"
// and "the field was never cleared".
//
// READ ONLY: opens the Edit modal and cancels. Never clicks Save Changes.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, { timeout: 90000, waitUntil: 'commit' });

  const admin = new AdminPromoToolsPage(page);
  await admin.openPromoTools(process.env.PROMO_UNLIMITED_AGENT_EMAIL);
  await admin.openEditParameters();

  const visible = admin.modal.getByRole('button', { name: /calendar/i });
  const read = async (label) => console.log(
    `  ${label.padEnd(26)} visible="${(await visible.innerText()).trim()}"  `
    + `mirror="${await admin.expiryDateInput.inputValue()}"  save=${await admin.isSaveEnabled()}`
  );

  console.log('\n=== can the Expiry Date be cleared? ===');
  await read('on open');
  await admin.setExpiryDate('');
  await page.waitForTimeout(600);
  await read('after setExpiryDate("")');
  await admin.expiryDateInput.blur().catch(() => {});
  await page.waitForTimeout(600);
  await read('after blur');

  // Is there any user-reachable clear control — a segment to delete, an X, a "Clear" in the popover?
  console.log(`\n  editable date segments in the modal: ${await admin.modal.locator('[role="spinbutton"]').count()}`);
  await visible.click();
  await page.waitForTimeout(1200);
  const popover = page.locator('[role="dialog"]').last();
  const btns = await popover.getByRole('button').allInnerTexts().catch(() => []);
  console.log(`  calendar popover buttons: ${JSON.stringify(btns.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20))}`);
  console.log(`  any clear/reset control:  ${JSON.stringify(await popover.getByRole('button', { name: /clear|reset|remove/i }).count())}`);
  await page.keyboard.press('Escape');

  await admin.cancelEdit();
  await browser.close();
})();
