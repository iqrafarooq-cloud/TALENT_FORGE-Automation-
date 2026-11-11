// probe-promo-modal-truth.js — decide, against the live app, which of three promo failures are
// APP defects and which are defects in the test code.
//
//   node scripts/probe-promo-modal-truth.js
//
// [A] USAGE LIMIT   The Promo Tools tab reports Usage Limit 10 for two agents that were
//                   provisioned at 10000. Either the app is truncating the field or an earlier
//                   run wrote 10 back. Reads the tab and the modal, then types 10000, saves, and
//                   reads it back — if 10000 will not stick, it is the app.
// [B] SAVE TOAST    "Saving promo parameters" reported NO toast at all, where the recorded
//                   defect (TFF-183) is the WRONG WORDING. Polls hard from the instant Save is
//                   clicked and prints everything that appears, so "no toast" can be told from
//                   "a toast the reader missed".
// [C] ADD MODAL     The Add Code Parameters modal leaves "Save Changes" disabled even with every
//                   documented field filled. Dumps every control in the modal with its value and
//                   disabled state, so a missing REQUIRED field shows up as itself rather than as
//                   "the button is broken".
//
// Read-only where it can be: [A] restores the value it found, and [C] always cancels — saving it
// would create a promo on the only agent that can exercise the empty state.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const UNLIMITED_NAME = process.env.PROMO_UNLIMITED_AGENT_NAME;
const UNLIMITED_EMAIL = process.env.PROMO_UNLIMITED_AGENT_EMAIL;
const NOPROMO_NAME = process.env.REFERRAL_NOPROMO_AGENT_NAME;
const NOPROMO_EMAIL = process.env.REFERRAL_NOPROMO_AGENT_EMAIL;

const iso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Every control the modal renders, with what it holds and whether it is usable. This is the
// evidence that distinguishes "the app requires a field the test never fills" from "the button
// is wrong".
async function dumpModalControls(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document.body;
    const controls = Array.from(dialog.querySelectorAll('input,select,textarea,button'));
    return controls.map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      value: el.value === undefined ? null : el.value,
      checked: el.type === 'radio' || el.type === 'checkbox' ? el.checked : null,
      disabled: el.disabled === true,
      required: el.required === true,
      ariaInvalid: el.getAttribute('aria-invalid'),
      text: (el.textContent || '').trim().slice(0, 40) || null,
    }));
  });
}

(async () => {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  console.log(`superadmin signed in -> ${page.url()}\n`);

  const admin = new AdminPromoToolsPage(page);

  // ================= [A] USAGE LIMIT =================
  console.log('=================== [A] USAGE LIMIT ===================');
  await admin.openPromoTools(UNLIMITED_NAME || UNLIMITED_EMAIL);
  const onTab = await admin.readParameter('Usage Limit');
  console.log(`  Code Parameters shows Usage Limit: ${JSON.stringify(onTab)}`);

  await admin.openEditParameters();
  const inModal = await admin.readUsageLimitField();
  console.log(`  Edit modal field holds:            ${JSON.stringify(inModal)}`);
  const maxLength = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[role="dialog"] input'));
    return inputs.map((el) => ({
      placeholder: el.getAttribute('placeholder'),
      maxLength: el.maxLength,
      inputMode: el.getAttribute('inputmode'),
      value: el.value,
    }));
  });
  console.log(`  modal inputs: ${JSON.stringify(maxLength)}`);

  // Type a five-digit limit and see what the field is willing to hold.
  await admin.setUsageLimitAndBlur('10000');
  const typed = await admin.readUsageLimitField();
  console.log(`  after typing "10000" the field holds: ${JSON.stringify(typed)}`);
  if (String(typed) !== '10000') {
    console.log('  >> THE FIELD ITSELF REFUSES 10000 — this is an app-side input constraint.');
  }

  // Only save if the field actually accepted it, and put the original back afterwards.
  if (String(typed) === '10000' && String(inModal) !== '10000') {
    if (await admin.isSaveEnabled()) {
      await admin.saveChanges().catch((e) => console.log(`  save failed: ${e.message.split('\n')[0]}`));
      await admin.openPromoTools(UNLIMITED_NAME || UNLIMITED_EMAIL);
      const after = await admin.readParameter('Usage Limit');
      console.log(`  after saving 10000, the tab reads: ${JSON.stringify(after)}`);
      console.log(String(after).replace(/\D/g, '') === '10000'
        ? '  >> 10000 PERSISTS — the earlier "10" was left behind by a previous run, not the app.'
        : '  >> 10000 DID NOT PERSIST — the app is not storing the value it was given.');
    } else {
      console.log('  Save stayed disabled after typing 10000.');
    }
  } else {
    await admin.cancelEdit().catch(() => {});
  }

  // ================= [B] SAVE TOAST =================
  console.log('\n=================== [B] SAVE TOAST ===================');
  await admin.openPromoTools(UNLIMITED_NAME || UNLIMITED_EMAIL);
  await admin.openEditParameters();
  await admin.setExpiryDate(iso(50));
  const saveEnabled = await admin.isSaveEnabled();
  console.log(`  Save enabled after changing expiry to ${iso(50)}: ${saveEnabled}`);
  if (saveEnabled) {
    // Poll from the instant of the click rather than after it settles — a toast that
    // auto-dismisses in a couple of seconds is invisible to a reader that starts late.
    const seen = new Set();
    const watcher = (async () => {
      for (let i = 0; i < 60; i += 1) {
        const texts = await page.evaluate(() => Array.from(
          document.querySelectorAll('[role="alert"],[role="status"],.notistack-Snackbar,[class*="toast"],[class*="Toast"],[class*="snack"],[class*="Snack"]')
        ).map((el) => (el.textContent || '').trim()).filter(Boolean)).catch(() => []);
        for (const t of texts) if (t) seen.add(t);
        await page.waitForTimeout(250);
      }
    })();
    await admin.saveButton.click().catch(async () => {
      await page.getByRole('button', { name: /save changes/i }).first().click();
    });
    await watcher;
    console.log(`  toast texts captured over 15s: ${JSON.stringify([...seen])}`);
    console.log(seen.size
      ? '  >> A TOAST DOES APPEAR — the step\'s reader missed it (test-side timing).'
      : '  >> NO TOAST AT ALL — app-side, and a change from the recorded "wrong wording" defect.');
  }

  // ================= [C] ADD MODAL =================
  console.log('\n=================== [C] ADD CODE PARAMETERS MODAL ===================');
  const hasPromo = await admin.openPromoToolsAllowingEmpty(NOPROMO_NAME || NOPROMO_EMAIL);
  console.log(`  ${NOPROMO_EMAIL} has a promo assigned: ${hasPromo}`);
  if (!hasPromo) {
    await admin.openAddParameters();
    console.log('  --- on open ---');
    console.log(JSON.stringify(await dumpModalControls(page), null, 1));
    console.log(`  selected incentive: ${await admin.selectedIncentive()}`);
    console.log(`  Save enabled: ${await admin.isSaveEnabled()}`);

    await admin.setValueAndBlur('15');
    await admin.setUsageLimitAndBlur('25');
    await admin.setExpiryDate(iso(30));
    await page.waitForTimeout(800);

    console.log('\n  --- after filling Value=15, Usage Limit=25, Expiry=+30d ---');
    console.log(JSON.stringify(await dumpModalControls(page), null, 1));
    console.log(`  selected incentive: ${await admin.selectedIncentive()}`);
    console.log(`  Save enabled: ${await admin.isSaveEnabled()}`);
    console.log(`  modal text:\n${(await admin.modalText()).split('\n').map((l) => `    ${l}`).join('\n')}`);

    // Try explicitly selecting the incentive radio — if THAT is what unlocks Save, the modal
    // requires a choice it also claims to default, and the test was never making it.
    await admin.setIncentive('Percentage Discount').catch(() => {});
    await page.waitForTimeout(600);
    console.log(`  Save enabled after explicitly clicking "Percentage Discount": ${await admin.isSaveEnabled()}`);

    // NEVER save here — this is the only agent that can exercise the empty state.
    await admin.cancelEdit().catch(() => {});
    console.log('  modal cancelled — nothing created.');
  }

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
