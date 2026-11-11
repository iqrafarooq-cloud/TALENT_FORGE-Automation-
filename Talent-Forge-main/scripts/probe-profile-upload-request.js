// What the candidate Profile > Education "add" form actually SENDS when Save is clicked.
//
// Entry 8988 was created by the walkthrough with every declared field correct and
// `document: null` - the transcript never reached the server, and no document row was created.
// attachDocument() could not have caught that: it returns path.basename() after a 500ms wait,
// so its return value is the file name it was GIVEN, not evidence the form took it.
//
// This logs every request the save produces, with multipart field names and whether a file part
// is present, so "the form never registered the file", "the file is sent to a different
// endpoint" and "the file is sent and dropped server-side" can be told apart.
//
// >>> IT SAVES. That creates a PERMANENT profile entry (and a document row if the file does get
//     through). Run it deliberately, not casually. Pass --no-save to stop before Save and only
//     inspect what the form holds.
//
// Usage: node scripts/probe-profile-upload-request.js [--no-save]

'use strict';

require('dotenv').config();

const { chromium } = require('playwright');
const path = require('path');
const CandidateProfilePage = require('../pages/CandidateProfilePage');

const APP = process.env.DOC_APP_BASE_URL || 'https://dev.talentforge.com.sa';
const NO_SAVE = process.argv.includes('--no-save');
const FIXTURE = path.resolve('Files/Test_doc/NAME-03_transcript_different_name.pdf');

// Multipart bodies are not valid UTF-8, but the part HEADERS are ASCII - so the field names and
// filenames are readable even when the binary payload is not.
function describeBody(post) {
  if (!post) return '(no body)';
  const names = [...post.matchAll(/name="([^"]+)"(?:;\s*filename="([^"]*)")?/g)].map((m) =>
    m[2] !== undefined ? `${m[1]}=<file "${m[2]}">` : m[1]
  );
  if (names.length) return 'multipart parts: ' + names.join(', ');
  return 'body: ' + post.slice(0, 300);
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const log = [];
  page.on('request', (req) => {
    if (!/\/api\//.test(req.url())) return;
    if (req.method() === 'GET') return;
    log.push({ method: req.method(), url: req.url(), body: describeBody(req.postData()) });
  });
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' || !/\/api\//.test(res.url())) return;
    const hit = log.find((l) => l.url === res.url() && l.status === undefined);
    if (hit) hit.status = res.status();
  });

  try {
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').first().fill(process.env.DOC_CANDIDATE_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.DOC_CANDIDATE_PASSWORD);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
    await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 });

    const profile = new CandidateProfilePage(page);
    await profile.open();
    await profile.openAddModal('EDUCATION');
    await profile.selectFromSearch('University/Institution Name', 'King Saud University');
    await profile.selectFromSearch('Degree', "Bachelor's");
    await profile.selectFromSearch('Field of Study', 'Software Engineering');
    await profile.selectMonthYear(0, 'September', 2018);
    await profile.selectMonthYear(1, 'June', 2022);

    log.length = 0; // only care about what the attach and the save produce
    await profile.attachDocument(FIXTURE);

    // Did the FORM register it? Read the input, and look for the name on screen.
    const registered = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') || document.body;
      const inputs = [...d.querySelectorAll('input[type="file"]')].map((i) => ({
        files: i.files ? i.files.length : 0,
        name: i.files && i.files[0] ? i.files[0].name : null,
        size: i.files && i.files[0] ? i.files[0].size : null,
      }));
      const text = (d.textContent || '').replace(/\s+/g, ' ');
      return { inputs, showsFileName: /NAME-03/.test(text), dialogText: text.slice(-400) };
    });
    console.log('='.repeat(78));
    console.log(' AFTER attachDocument()');
    console.log('='.repeat(78));
    console.log('  file inputs in the dialog : ' + JSON.stringify(registered.inputs));
    console.log('  dialog shows the filename : ' + registered.showsFileName);
    console.log('  requests fired by attach  : ' + (log.length ? JSON.stringify(log, null, 1) : '(none)'));
    console.log('  dialog tail text          : ' + JSON.stringify(registered.dialogText));

    if (NO_SAVE) {
      console.log('\n--no-save given: cancelling without saving.');
      await profile.cancel().catch(() => {});
      return;
    }

    log.length = 0;
    console.log('\n' + '='.repeat(78));
    console.log(' SAVING (permanent)');
    console.log('='.repeat(78));
    const result = await profile.save();
    await page.waitForTimeout(4000); // let any follow-up request land
    console.log('  save() saw: HTTP ' + result.httpStatus + '  ' + result.url);
    console.log('  response body: ' + JSON.stringify(result.body));
    console.log('\n  EVERY non-GET /api/ request during the save:');
    for (const l of log) console.log(`    [${l.status ?? '?'}] ${l.method} ${l.url}\n        ${l.body}`);
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
    await page.screenshot({ path: 'reports/probe-profile-upload.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
