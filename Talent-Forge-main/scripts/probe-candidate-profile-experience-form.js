// probe-candidate-profile-experience-form.js - what the Add Experience and Add
// Certification modals ACTUALLY contain.
//
//     node scripts/probe-candidate-profile-experience-form.js
//     node scripts/probe-candidate-profile-experience-form.js WORKEXPERIENCE
//
// Written because the generic form filler failed on both modals in ways that pointed at
// the wrong thing:
//
//   * "Company Name": no option exactly named "Systems Limited Pakistan" appeared.
//     That message cannot distinguish "the reference data does not hold this company"
//     from "the label resolved to a different input" from "this control needs real
//     keystrokes". So this probe types the term and dumps EVERY option offered, rather
//     than looking for the one we hoped to find - the same reason the community
//     empty-state probe captures verbatim text instead of matching an expected string.
//
//   * selectMonthYear(which) indexes `dialog.locator('select')` as pairs, but the
//     Experience modal opens with an EMPLOYMENT TYPE <select>, so index 0 is not the
//     start month. Every <select> is dumped with its options so the real layout is
//     visible rather than assumed.
//
// NEVER SAVES. It opens the modal, reads it, and closes it - no profile entry, no
// document row, nothing permanent.

'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const CandidateProfilePage = require('../pages/CandidateProfilePage');

const EMAIL = process.env.DOC_CANDIDATE_EMAIL;
const PASSWORD = process.env.DOC_CANDIDATE_PASSWORD;
const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

// Terms worth trying against the Company Name combobox: the value the test data declares,
// then progressively shorter prefixes. A control that searches server-side on keystrokes
// often needs fewer characters than a full name to return anything at all.
const COMPANY_TERMS = ['Systems Limited Pakistan', 'Systems Limited', 'Systems', 'Syst', 'ByteCorp Solutions', 'ByteCorp', 'Byte'];

const only = process.argv[2] ? process.argv[2].toUpperCase() : null;

async function dumpDialog(dialog, label) {
  console.log(`\n--- ${label}: every control in the dialog -------------------------`);

  const selects = dialog.locator('select');
  const nSel = await selects.count();
  console.log(`  <select> count: ${nSel}`);
  for (let i = 0; i < nSel; i++) {
    const s = selects.nth(i);
    const opts = await s.locator('option').allTextContents();
    const value = await s.inputValue().catch(() => '(unreadable)');
    console.log(
      `    [${i}] value=${JSON.stringify(value)}  ${opts.length} option(s): ` +
        opts.slice(0, 8).map((o) => JSON.stringify(o.trim())).join(', ') +
        (opts.length > 8 ? ` ... (+${opts.length - 8})` : '')
    );
  }

  const inputs = dialog.locator('input');
  const nIn = await inputs.count();
  console.log(`  <input> count: ${nIn}`);
  for (let i = 0; i < nIn; i++) {
    const el = inputs.nth(i);
    const info = await el.evaluate((n) => ({
      type: n.getAttribute('type'),
      placeholder: n.getAttribute('placeholder'),
      name: n.getAttribute('name'),
      required: n.hasAttribute('required'),
      value: n.value,
      cls: (n.getAttribute('class') || '').slice(0, 40),
    }));
    console.log(`    [${i}] ${JSON.stringify(info)}`);
  }

  const labels = await dialog.locator('label').allTextContents();
  console.log(`  labels: ${labels.map((l) => JSON.stringify(l.trim())).filter((l) => l !== '""').join(', ')}`);
}

async function probeSearchCombo(page, dialog, labelText, terms) {
  console.log(`\n--- "${labelText}": what each term actually returns ----------------`);
  const field = dialog
    .locator(`xpath=//label[contains(normalize-space(.), ${JSON.stringify(labelText)})]/following::input[@placeholder='Search'][1]`)
    .first();
  if (!(await field.count())) {
    console.log(`  NO INPUT resolved for label "${labelText}" - the label text or the placeholder is wrong.`);
    return;
  }

  for (const term of terms) {
    await field.click();
    await field.fill('');
    // Real keystrokes: this control queries on keydown, so fill() sets the value in one
    // input event and returns NO options at all. Measured on the Education form's
    // institution field, and the reason pressSequentially is not merely a slower fill here.
    await field.pressSequentially(term, { delay: 40 });
    await page.waitForTimeout(2500);
    const options = await page.getByRole('option').allTextContents();
    console.log(
      `  ${JSON.stringify(term).padEnd(28)} -> ${options.length} option(s): ` +
        (options.slice(0, 6).map((o) => JSON.stringify(o.trim())).join(', ') || '(none)') +
        (options.length > 6 ? ` ... (+${options.length - 6})` : '')
    );
  }
  await field.fill('');
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error('DOC_CANDIDATE_EMAIL / DOC_CANDIDATE_PASSWORD must be set in .env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
    await page.waitForURL(/dashboard|profile/i, { timeout: 60000 });
    console.log(`signed in as ${EMAIL}`);

    const profile = new CandidateProfilePage(page);
    await profile.open();

    for (const category of ['WORKEXPERIENCE', 'CERTIFICATION']) {
      if (only && only !== category) continue;
      console.log(`\n==================== ${category} ====================`);
      const dialog = await profile.openAddModal(category);
      await dumpDialog(dialog, category);

      if (category === 'WORKEXPERIENCE') {
        // The company list may be gated on the employment type being chosen first - the two
        // sit in the same form and a dependent query is the ordinary explanation for a
        // combobox that returns nothing at all. Set it, then search again.
        await dialog.locator('select').nth(0).selectOption({ label: 'Full-time Employment' });
        console.log('\n  employment type set to Full-time Employment');
        await probeSearchCombo(page, dialog, 'Company Name', COMPANY_TERMS.concat(['a', 'King', 'Ltd']));
        // Does it take free text? A company list is not a closed reference set the way
        // universities are, so an entry-creating combobox is plausible.
        const f = dialog.locator('xpath=//label[contains(normalize-space(.), "Company Name")]/following::input[@placeholder="Search"][1]').first();
        await f.click();
        await f.pressSequentially('ByteCorp Solutions', { delay: 40 });
        await page.waitForTimeout(1500);
        const near = await dialog.evaluate((d) => d.innerText.replace(/\s+/g, ' ').slice(0, 600));
        console.log('  field holds after typing: ' + JSON.stringify(await f.inputValue()));
        console.log('  dialog text: ' + JSON.stringify(near));
        await dialog.locator('xpath=//label[contains(normalize-space(.), "Role/Job Title")]/following::input[not(@type="file")][1]').first().fill('Senior Software Engineer');
        await dialog.locator('select').nth(1).selectOption({ label: 'July' });
        await dialog.locator('select').nth(2).selectOption({ label: '2022' });
        await dialog.locator('input[type="checkbox"]').first().check();
        await page.waitForTimeout(800);
        console.log('  Save enabled with everything but a document: ' + (await profile.saveIsEnabled()));
      }

      const saveEnabled = await profile.saveIsEnabled();
      console.log(`\n  Save enabled with nothing filled: ${saveEnabled}`);
      await profile.cancel();
      await page.waitForTimeout(500);
    }

    console.log('\nDone. Nothing was saved.');
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
