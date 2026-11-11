// probe-candidate-profile-education-form.js
//
// Why the candidate Profile > Candidate Details > Education "add" form leaves Save disabled.
//
// The walkthrough scenario reported "Save DISABLED after every required field was filled",
// which is the honest report of a gate but says nothing about WHICH field the form is still
// unhappy about. This opens the real form, fills it exactly the way the suite does, and after
// EVERY action dumps the state of every control plus the Save button - so the step that flips
// the gate (or fails to) is visible rather than inferred.
//
// NEVER SAVES. It cancels at the end, so it creates no profile entry and no document row.
//
// Usage: node scripts/probe-candidate-profile-education-form.js [--file <fixture.pdf>]

'use strict';

require('dotenv').config();

const { chromium } = require('playwright');
const path = require('path');
const CandidateProfilePage = require('../pages/CandidateProfilePage');

const APP = process.env.DOC_APP_BASE_URL || 'https://dev.talentforge.com.sa';
const argIdx = process.argv.indexOf('--file');
const FIXTURE = path.resolve(
  argIdx > -1 ? process.argv[argIdx + 1] : 'Files/Test_doc/NAME-03_transcript_different_name.pdf'
);

// Everything the modal holds, with enough per-control detail to tell "empty" from "filled but
// rejected". `required`/`aria-invalid` are read because a disabled Save with no visible error is
// the shape this form actually presents.
async function dumpForm(page, label) {
  const state = await page.evaluate(() => {
    const dialog =
      document.querySelector('[role="dialog"]') ||
      document.querySelector('.modal, [class*="modal" i]') ||
      document.body;
    const controls = [...dialog.querySelectorAll('input, select, textarea')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      value: el.type === 'file' ? `${el.files ? el.files.length : 0} file(s)` : el.value,
      required: el.required || el.getAttribute('aria-required') === 'true',
      invalid: el.getAttribute('aria-invalid') === 'true',
      disabled: el.disabled,
      visible: !!(el.offsetParent || el.getClientRects().length),
    }));
    const buttons = [...dialog.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    }));
    // Any red/helper text the form is showing. Kept broad on purpose: guessing one error class
    // is how a real inline message gets reported as "no error shown".
    const errors = [...dialog.querySelectorAll('*')]
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && /required|invalid|must |please |select |enter /i.test(t) && t.length < 120);
    return { controls, buttons, errors: [...new Set(errors)] };
  });

  console.log('\n' + '='.repeat(78));
  console.log(' AFTER: ' + label);
  console.log('='.repeat(78));
  for (const c of state.controls) {
    if (!c.visible && c.type !== 'file') continue;
    const flags = [c.required ? 'required' : '', c.invalid ? 'INVALID' : '', c.disabled ? 'disabled' : '']
      .filter(Boolean)
      .join(',');
    console.log(
      `  ${String(c.type || c.tag).padEnd(10)} ${String(c.name || c.id || c.placeholder || '?').slice(0, 34).padEnd(34)} ` +
        `= ${JSON.stringify(c.value).slice(0, 34).padEnd(36)} ${flags}`
    );
  }
  const save = state.buttons.find((b) => /^save/i.test(b.text));
  console.log('  --');
  console.log('  SAVE: ' + (save ? `"${save.text}" ${save.disabled ? 'DISABLED' : 'ENABLED'}` : '(not found)'));
  console.log('  buttons: ' + state.buttons.map((b) => `${b.text}${b.disabled ? '(off)' : ''}`).join(' | '));
  if (state.errors.length) console.log('  messages: ' + state.errors.join(' | '));
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    // Sign in through the UI - this form is only reachable in a real session.
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.DOC_CANDIDATE_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.DOC_CANDIDATE_PASSWORD);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
    await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 });
    console.log('signed in as', process.env.DOC_CANDIDATE_EMAIL, '->', page.url());

    const profile = new CandidateProfilePage(page);
    await profile.open();
    await profile.openAddModal('EDUCATION');
    await dumpForm(page, 'openAddModal("EDUCATION") - nothing filled yet');

    const steps = [
      ['University/Institution Name = King Saud University', () => profile.selectFromSearch('University/Institution Name', 'King Saud University')],
      ['Degree = Bachelor\'s', () => profile.selectFromSearch('Degree', "Bachelor's")],
      ['Field of Study = Software Engineering', () => profile.selectFromSearch('Field of Study', 'Software Engineering')],
      ['start date = September 2018', () => profile.selectMonthYear(0, 'September', 2018)],
      ['end date = June 2022', () => profile.selectMonthYear(1, 'June', 2022)],
      ['attach ' + path.basename(FIXTURE), () => profile.attachDocument(FIXTURE)],
    ];

    for (const [label, run] of steps) {
      let outcome = 'ok';
      try {
        const r = await run();
        if (r !== undefined) outcome = 'ok -> ' + JSON.stringify(r).slice(0, 60);
      } catch (e) {
        outcome = 'THREW: ' + e.message.split('\n')[0].slice(0, 160);
      }
      console.log('\n>>> ' + label + '   [' + outcome + ']');
      await dumpForm(page, label);
    }

    console.log('\n' + '='.repeat(78));
    console.log(' saveIsEnabled() reports: ' + (await profile.saveIsEnabled()));
    console.log('='.repeat(78));
    console.log('\nCancelling - nothing was saved, no profile entry or document row created.');
    await profile.cancel().catch(() => {});
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
    await page.screenshot({ path: 'reports/probe-education-form.png', fullPage: true }).catch(() => {});
    console.error('screenshot: reports/probe-education-form.png');
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
