// >>> THIS PROBE WRITES. <<<
//
// It is the mutating half of scripts/probe-candidate-details.js, kept as a separate file so
// that the read-only one can be run freely. It answers the four questions a read-only probe
// structurally cannot:
//
//   1. what request does Save fire, and does the value survive a reload?
//   2. is there a success toast, and what does it say?
//   3. what does ADDING an entry send, and what comes back?
//   4. >>> DOES DELETING AN ENTRY TAKE ITS DOCUMENT WITH IT? <<<  CLAUDE.md records that
//      there is no DELETE for a document row anywhere in the API and that deleting a profile
//      entry leaves its document ORPHANED (73 of 78 orphaned, measured 2026-08-24). This
//      probe measures it directly rather than trusting either account.
//
// It RESTORES the Basic Information field it edits, and the entry it adds is one it deletes
// itself - so on a clean run nothing pre-existing is touched. A crash mid-run can leave one
// added entry behind; it prints what it created so that is recoverable by hand.
//
// It runs against CANDIDATE_DETAILS_EMAIL (falling back to CONTACTUS_EMAIL) and refuses any
// other account, for the same reason contactUsFixtureGuard() does: a probe that writes must
// never be pointed at a fixture another module depends on.
require('dotenv').config();
const path = require('path');
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const J = (o) => JSON.stringify(o, null, 1);
const EMAIL = process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL;
const PASSWORD = process.env.CANDIDATE_DETAILS_PASSWORD || process.env.CONTACTUS_PASSWORD;
const ALLOWED = [process.env.CANDIDATE_DETAILS_EMAIL, process.env.CONTACTUS_EMAIL].filter(Boolean);

if (!ALLOWED.includes(EMAIL)) {
  console.error('REFUSING to write as ' + EMAIL + '. Allowed: ' + ALLOWED.join(', '));
  process.exit(1);
}

const FIXTURE = path.resolve(__dirname, '..', 'Files', 'Test_doc', 'AUTH-01_certificate_ordinary_scan.pdf');
const STAMP = Date.now().toString().slice(-6);
const CERT_NAME = 'PROBE Certificate ' + STAMP;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();

  // The app holds its token in memory, not under a guessable localStorage key - reading
  // localStorage returned null, apiGet() then answered 401, and every field it read came back
  // undefined, which printed as "did not persist" against a save that had worked perfectly.
  // Capturing the header off a real request is the only reliable source.
  let bearer = null;
  page.on('request', (r) => { const a = r.headers()['authorization']; if (a && a.startsWith('Bearer ')) bearer = a; });

  const calls = [];
  page.on('request', (r) => {
    if (/\/api\/v1\//.test(r.url()) && r.method() !== 'GET') {
      calls.push({ method: r.method(), url: r.url().replace(/^.*\/api\/v1/, ''), at: Date.now() });
    }
  });
  page.on('response', async (r) => {
    if (/\/api\/v1\//.test(r.url()) && r.request().method() !== 'GET') {
      const hit = calls.find((c) => r.url().endsWith(c.url) && c.status === undefined);
      if (hit) { hit.status = r.status(); hit.body = await r.text().catch(() => '').then((t) => t.slice(0, 300)); }
    }
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(EMAIL);
  await login.passwordInput.first().fill(PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });

  const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
  const apiGet = async (p) => {
    if (!bearer) throw new Error('no bearer token captured yet - navigate first');
    const res = await page.evaluate(async ([url, t]) => {
      const r = await fetch(url, { headers: { authorization: t, 'x-active-role': 'CANDIDATE', accept: 'application/json' } });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [origin.replace('dev.', 'dev-api.') + '/core/api/v1' + p, bearer]);
    // A 401 here silently turns every field read into `undefined`, which reads as "the app lost
    // the value". Fail loudly instead - that mistake cost a restore on the first run.
    if (res.status !== 200) throw new Error('apiGet ' + p + ' -> ' + res.status + ' ' + JSON.stringify(res.body));
    return res;
  };

  const openProfile = async () => {
    await page.goto(origin + '/profile?selectedTab=candidate-details');
    await page.getByText('Basic Information', { exact: true }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const icon = (i) => page.locator('svg.add-icon, svg.edit-icon').nth(i);
  const dialog = () => page.locator('[role="dialog"]').last();
  const toasts = async () => (await page.locator('[role="status"], .Toastify__toast, [class*="toast" i]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);

  await openProfile();

  // ------------------------------------------------------------------ 1. SAVE + PERSIST
  console.log('=== 1. BASIC INFORMATION: what Save sends, and does it persist? ===');
  const before = (await apiGet('/candidate/profile/me/')).body;
  const originalBio = before.headline;
  if (typeof originalBio !== 'string') throw new Error('could not read the current headline - refusing to edit a field I cannot restore');
  const newBio = 'Probe bio ' + STAMP;
  console.log('original headline (the modal calls it Bio):', JSON.stringify((originalBio || '').slice(0, 50)));

  await icon(0).dispatchEvent('click');
  await page.waitForTimeout(1800);
  const bio = dialog().locator('input[name="basicInformation.bio"]');
  await bio.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(newBio);
  await page.waitForTimeout(400);
  const saveBtn = dialog().getByRole('button', { name: 'Save', exact: true });
  console.log('Save enabled after edit:', !(await saveBtn.isDisabled()));
  const mark = calls.length;
  await saveBtn.click();
  await page.waitForTimeout(4000);
  console.log('requests fired by Save:', J(calls.slice(mark)));
  console.log('toast:', J(await toasts()));
  console.log('modal still open:', await dialog().count() > 0);

  await openProfile();
  const afterSave = (await apiGet('/candidate/profile/me/')).body;
  console.log('headline after reload:', JSON.stringify((afterSave.headline || '').slice(0, 50)));
  console.log('PERSISTED:', afterSave.headline === newBio);

  // restore
  await icon(0).dispatchEvent('click');
  await page.waitForTimeout(1800);
  await dialog().locator('input[name="basicInformation.bio"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(originalBio);
  await page.waitForTimeout(400);
  await dialog().getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(4000);
  const restored = (await apiGet('/candidate/profile/me/')).body;
  console.log('RESTORED:', restored.headline === originalBio);

  // ------------------------------------------------------------------ 2. ADD an entry
  console.log('\n=== 2. ADD CERTIFICATION (with a document) ===');
  await openProfile();
  const certsBefore = (await apiGet('/candidate/profile/me/')).body.certifications.map((c) => c.id);
  const docsBefore = (await apiGet('/candidate/documents/?page=1&page_size=200')).body;
  console.log('certifications before:', certsBefore, '| document rows before:', docsBefore && docsBefore.count);

  await icon(5).dispatchEvent('click');  // Certifications ADD
  await page.waitForTimeout(1800);
  const d = dialog();
  await d.getByLabel('Certificate Name*').fill(CERT_NAME);
  await d.getByLabel('Issuing Organization*').fill('Probe Org');
  const selects = d.locator('select');
  await selects.nth(0).selectOption({ label: 'January' });
  await selects.nth(1).selectOption({ label: '2024' });
  await d.locator('input[type="checkbox"]').first().dispatchEvent('click'); // "no expiry" switch
  await page.waitForTimeout(500);
  await d.locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.waitForTimeout(4000);
  console.log('Save enabled:', !(await d.getByRole('button', { name: 'Save', exact: true }).isDisabled()));
  const mark2 = calls.length;
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(6000);
  console.log('requests fired by Add:', J(calls.slice(mark2)));
  console.log('toast:', J(await toasts()));

  const afterAdd = (await apiGet('/candidate/profile/me/')).body;
  const added = afterAdd.certifications.find((c) => !certsBefore.includes(c.id));
  console.log('added certification:', J(added && { id: added.id, name: added.certificate_name, doc: added.document && { id: added.document.id, file_name: added.document.file_name, status: added.document.status } }));
  if (!added) { console.log('!! add failed - stopping before the delete measurement'); await browser.close(); return; }
  const addedDocId = added.document && added.document.id;

  // ------------------------------------------------------------------ 3. DELETE it
  console.log('\n=== 3. DELETE that certification - AND WHAT HAPPENS TO ITS DOCUMENT ===');
  await openProfile();
  await icon(6).dispatchEvent('click');  // Certifications manage-list
  await page.waitForTimeout(2000);
  const list = dialog();
  // >>> DERIVE THE ROW AND ITS TRASH FROM THE SAME ELEMENT. <<<
  // The first version read an index off one collection ([class*="list-item"]) and clicked a
  // different one (every trash svg in the dialog). The two are not the same list, so it
  // resolved index 0 in both and DELETED THE PRE-EXISTING ENTRY instead of the one this run
  // had just added - then reported "the document survived" about a document whose entry was
  // never deleted. Same class as the community resolveFilterPopover() bug. Scoping the trash
  // INSIDE the row makes the mis-match impossible to reproduce.
  console.log('list-item classes:', J(await list.evaluate((el) => {
    const c = {};
    el.querySelectorAll('[class*="list-item"]').forEach((e) => { const k = e.className.split(' ')[0]; c[k] = (c[k] || 0) + 1; });
    // NOTE: the plural "-list-items-container" wrapper matches [class*="list-item"] too, which is
    // why the row locator uses the EXACT singular class instead.
    return c;
  })));
  const row = list.locator('.certification-list-item').filter({ hasText: CERT_NAME });
  console.log('rows matching "' + CERT_NAME + '":', await row.count());
  if (await row.count() !== 1) throw new Error('refusing to delete: expected exactly 1 matching row, found ' + (await row.count()));
  const mark3 = calls.length;
  await row.first().locator('svg[class*="error-600"]').first().dispatchEvent('click');
  await page.waitForTimeout(1800);
  const confirmText = await page.locator('[role="dialog"]').last().innerText().catch(() => '');
  console.log('confirmation dialog text:', JSON.stringify(confirmText.slice(0, 300)));
  const confirm = page.locator('[role="dialog"]').last().getByRole('button', { name: /^(delete|confirm|yes|remove)$/i });
  console.log('confirm button offered:', await confirm.count());
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(4000); }
  console.log('requests fired by Delete:', J(calls.slice(mark3)));
  console.log('toast:', J(await toasts()));

  const afterDelete = (await apiGet('/candidate/profile/me/')).body;
  console.log('certification still present:', afterDelete.certifications.some((c) => c.id === added.id));

  if (addedDocId) {
    const docsAfter = (await apiGet('/candidate/documents/?page=1&page_size=200')).body;
    const stillThere = (docsAfter.results || []).some((x) => x.id === addedDocId);
    console.log('\n>>> DOCUMENT ' + addedDocId + ' STILL ON THE ACCOUNT AFTER THE ENTRY WAS DELETED: ' + stillThere);
    console.log('document rows: before=' + (docsBefore && docsBefore.count) + ' after=' + (docsAfter && docsAfter.count));
    console.log(stillThere
      ? '    -> ORPHANED. Deleting the entry did NOT delete its document.'
      : '    -> the document went with the entry.');
  } else {
    console.log('(the added entry carried no document id, so the orphan question is unanswered)');
  }

  console.log('\n=== CREATED BY THIS RUN (delete by hand if it crashed) ===');
  console.log('certification name:', CERT_NAME);

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
