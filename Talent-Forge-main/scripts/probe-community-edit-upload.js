/* eslint-disable no-console */
// probe-community-edit-upload.js — READ-ONLY (never clicks Save). Two checks that the scenarios
// cannot make without saving or without being red for another reason:
//
//   A. AN ACCEPTED UPLOAD ON THE EDIT FORM. `coverUploadButton` was rewritten to match a real
//      <button>, and on /community/edit/<id> that button reads "Change photo" — the old locator
//      (/upload cover photo/i) matched NOTHING there, so every edit upload silently took the
//      setInputFiles fallback. `Verify that Edit Community enforces the same validation rules`
//      exercises the REJECTION path on that page and passes; this covers the accepted path, which
//      only the @mutates-community scenario otherwise reaches.
//
//   B. THE INLINE REQUIRED-FIELD ERRORS on the create form, quoted verbatim. The scenario asserting
//      them is tagged @known-issue but now passes, so either the app has been fixed or it is
//      passing for the wrong reason. Printing what the reader actually finds settles which.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');
const CommunityFormPage = require('../pages/CommunityFormPage');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const c = new CommunityPage(page);
  const form = new CommunityFormPage(page);

  // ---------- A. accepted upload on the EDIT form ----------
  await c.gotoList();
  const cards = await c.readCards();
  const id = cards[0].id;
  console.log(`\n================ A. accepted upload on /community/edit/${id} ("${cards[0].name}") ================`);
  await form.gotoEdit(id);
  console.log(`cover control resolves to ${await form.coverUploadButton.count()} element(s); `
    + `logo control ${await form.logoUploadButton.count()}`);
  console.log(`previews before: ${JSON.stringify(await form.imagePreviews())}`);

  for (const [field, fmt, mb] of [['Cover Photo', 'PNG', 6], ['Profile Photo', 'JPG', 8]]) {
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const r = await form.uploadImage(field, fmt, mb);
    console.log(`\n  ${field} ${fmt} ${mb}MB in ${Date.now() - t}ms`);
    console.log(`    sent "${r.fileName}" [${r.fileSource}, ${r.sizeBytes} bytes]`);
    console.log(`    pickerFailure: ${JSON.stringify(r.pickerFailure)}`);
    console.log(`    crop modal: appeared=${r.cropModalAppeared} heading=${JSON.stringify(r.cropHeading)} `
      + `imageReady=${r.cropImageReady} confirmed=${r.cropConfirmed}`);
    console.log(`    preview=${r.previewShown}  ACCEPTED=${r.accepted}  error=[${r.errorSurface || 'none'}] ${JSON.stringify(r.error)}`);
  }
  console.log(`\n  Save enabled after the two replacements: ${await form.waitForSaveEnabled(6000)}`);
  console.log('  (NOT clicked — nothing is saved, so the community is unchanged.)');

  // ---------- B. the inline required-field errors on CREATE ----------
  console.log('\n================ B. required-field errors on /community/create ================');
  await form.gotoCreate();
  await form.fillValidDetails();
  for (const field of ['Cover Photo', 'Profile Photo', 'University/Institute Name', 'Location']) {
    if (/photo/i.test(field)) {
      // eslint-disable-next-line no-await-in-loop
      await form.removeImage(field).catch(() => {});
    } else {
      // eslint-disable-next-line no-await-in-loop
      await form.clearField(field);
    }
    // eslint-disable-next-line no-await-in-loop
    const err = await form.readValidationError();
    // eslint-disable-next-line no-await-in-loop
    const gated = await form.saveStaysDisabled(1200);
    console.log(`  cleared ${field.padEnd(26)} -> [${err.surface || 'none'}] ${JSON.stringify(err.message)}  (Save ${gated ? 'disabled' : 'ENABLED'})`);
    // eslint-disable-next-line no-await-in-loop
    if (/cover/i.test(field)) await form.uploadImage('Cover Photo', 'JPG', 8);
    // eslint-disable-next-line no-await-in-loop
    else if (/profile/i.test(field)) await form.uploadImage('Profile Photo', 'PNG', 5);
    // eslint-disable-next-line no-await-in-loop
    else if (/university/i.test(field)) await form.selectUniversity(0).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    else await form.selectLocation('Riyadh').catch(() => {});
  }

  console.log('\nNothing was saved. No community was created or changed.');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
