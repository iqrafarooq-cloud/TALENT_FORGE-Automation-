// probe-promo-add-value-field.js — why does the Add Code Parameters modal's "Value" field refuse
// to hold what the suite types into it?
//
//   node scripts/probe-promo-add-value-field.js
//
// probe-promo-modal-truth.js established that after setValueAndBlur('15') the field still reads
// "0", which is why "Save Changes" stays disabled — so the Add-modal gating failure is the test's
// fault, not the app's. This narrows WHICH part of the interaction is at fault by trying each
// strategy in turn and reporting what the field holds after each:
//
//   1. locator.fill()           — what the page object does today
//   2. fill('') then fill()     — in case the control ignores a replace over a non-empty value
//   3. click + selectAll + type — real keystrokes, which a controlled/masked input may require
//
// Always cancels. Never saves — this is the only agent that can exercise the empty state.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const NOPROMO_NAME = process.env.REFERRAL_NOPROMO_AGENT_NAME;
const NOPROMO_EMAIL = process.env.REFERRAL_NOPROMO_AGENT_EMAIL;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });

  const admin = new AdminPromoToolsPage(page);
  const hasPromo = await admin.openPromoToolsAllowingEmpty(NOPROMO_NAME || NOPROMO_EMAIL);
  if (hasPromo) throw new Error(`${NOPROMO_EMAIL} already has a promo — cannot probe the Add modal.`);
  await admin.openAddParameters();

  const valueInput = admin.modal.locator('input[type="text"]').nth(1);
  const report = async (label) => {
    const held = await valueInput.inputValue().catch(() => '(unreadable)');
    const save = await admin.isSaveEnabled();
    console.log(`  ${label.padEnd(38)} value=${JSON.stringify(held)}  Save=${save ? 'ENABLED' : 'disabled'}`);
  };

  console.log('--- Add modal, Value field ---');
  await report('on open');

  // 1. what the page object does today
  await valueInput.fill('15');
  await valueInput.blur().catch(() => {});
  await page.waitForTimeout(500);
  await report('after fill("15") + blur');

  // 2. clear first, then fill
  await valueInput.fill('');
  await page.waitForTimeout(300);
  await report('after fill("")');
  await valueInput.fill('15');
  await page.waitForTimeout(500);
  await report('after fill("") then fill("15")');

  // 3. real keystrokes
  await valueInput.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('15', { delay: 60 });
  await page.waitForTimeout(500);
  await report('after click + select all + type');
  await valueInput.blur().catch(() => {});
  await page.waitForTimeout(500);
  await report('after typing, then blur');

  // With Value finally set, does filling the rest unlock Save? That is the question the failing
  // scenario is really asking.
  await admin.setUsageLimitAndBlur('25');
  const d = new Date();
  d.setDate(d.getDate() + 30);
  await admin.setExpiryDate(d.toISOString().slice(0, 10));
  await page.waitForTimeout(800);
  await report('after Usage Limit=25 and Expiry=+30d');

  console.log(`\n  usage limit field holds: ${JSON.stringify(await admin.readUsageLimitField())}`);
  console.log(`  expiry field holds:      ${JSON.stringify(await admin.expiryDateInput.inputValue().catch(() => null))}`);
  console.log(`  modal text:\n${(await admin.modalText()).split('\n').map((l) => `    ${l}`).join('\n')}`);

  await admin.cancelEdit().catch(() => {});
  console.log('\n  cancelled — nothing created.');

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
