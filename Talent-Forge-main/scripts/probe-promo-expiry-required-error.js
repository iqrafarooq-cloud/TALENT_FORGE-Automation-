// probe-promo-expiry-required-error.js — READ ONLY. Does the Edit Code Parameters modal render an
// inline error when EXPIRY DATE is cleared, and if so, what triggers it?
//
//   node scripts/probe-promo-expiry-required-error.js
//
// Why this exists: `clearing a required parameter shows its inline error` reports Value and Usage
// Limit correct and Expiry Date as "the modal gained (nothing)". But the two working fields are set
// through setValueAndBlur/setUsageLimitAndBlur, which BLUR the control; setExpiryDate() only calls
// .fill() and never blurs. So "the app shows no error" and "the suite never triggered validation"
// are indistinguishable from that report — exactly the reader-vs-product ambiguity this repo has
// paid for repeatedly. This probe drives the field four ways and prints what the modal gains after
// each, so the two can be told apart.
//
// READ ONLY: opens the Edit modal and cancels. Never clicks Save Changes.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const BY_EMAIL = process.env.PROMO_UNLIMITED_AGENT_EMAIL;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000, waitUntil: 'commit',
  });

  const admin = new AdminPromoToolsPage(page);
  await admin.openPromoTools(BY_EMAIL);
  await admin.openEditParameters();
  console.log(`\n=== ${page.url()} (PROMO_UNLIMITED_AGENT_EMAIL) ===`);

  const baseline = await admin.modalText();
  const original = await admin.readModalFields();
  console.log(`  original fields: ${JSON.stringify(original)}`);

  // What the modal GAINED relative to the untouched state — the only useful evidence, since it
  // separates "no error at all" from "an error worded differently".
  const gained = async () => {
    const text = await admin.modalText();
    return text.split('\n').filter((l) => l.trim() && !baseline.includes(l.trim())).join(' / ') || '(nothing)';
  };

  const el = admin.expiryDateInput;
  console.log(`\n  expiry control: ${JSON.stringify(await el.evaluate((n) => ({
    tag: n.tagName, type: n.type, required: n.required, testid: n.getAttribute('data-testid'),
  })).catch(() => null))}`);

  const restore = async () => {
    await el.fill(original.expiry);
    await el.blur().catch(() => {});
    await page.waitForTimeout(400);
  };

  // 1) exactly what the suite does today: fill('') and nothing else
  await el.fill('');
  await page.waitForTimeout(400);
  console.log(`\n  [1] fill('') only ............... ${await gained()}   save=${await admin.isSaveEnabled()}`);

  // 2) the same, then blur — the trigger the other two fields use
  await el.blur().catch(() => {});
  await page.waitForTimeout(600);
  console.log(`  [2] + blur() .................... ${await gained()}   save=${await admin.isSaveEnabled()}`);

  // 3) focus, select-all, Delete, Tab out — a real keyboard clear, in case fill() bypasses the
  //    handler the component validates on (fill sets the value in ONE input event)
  await restore();
  await el.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  console.log(`  [3] keyboard clear .............. ${await gained()}   save=${await admin.isSaveEnabled()}`);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  console.log(`  [4] + Tab ....................... ${await gained()}   save=${await admin.isSaveEnabled()}`);

  // 5) cleared and left cleared while ANOTHER field is touched — some forms only validate a field
  //    once the form as a whole has been interacted with
  await admin.setValueAndBlur(original.value);
  await page.waitForTimeout(600);
  console.log(`  [5] + touch Value ............... ${await gained()}   save=${await admin.isSaveEnabled()}`);

  console.log(`\n  full modal text now:\n${(await admin.modalText()).split('\n').map((l) => `    | ${l}`).join('\n')}`);

  await admin.cancelEdit();
  await browser.close();
})();
