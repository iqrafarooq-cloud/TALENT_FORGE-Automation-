/* eslint-disable no-console */
// probe-community-create-page.js — answers the two things about the Create Community page that
// could not be settled by reading the code:
//
//   A. WHY THE PAGE SCROLLS UP AND DOWN CONTINUOUSLY. Every scroll event is recorded with the
//      element that scrolled and the label of whichever operation was running at the time, so
//      the thrash is attributed to a CALL rather than guessed at. Each call is also timed —
//      a Playwright action that is silently retrying for 15s is the usual cause, and it shows up
//      as a long call with hundreds of scroll events under it.
//
//   B. WHETHER EXACTLY 10 MB IS ACCEPTED, on BOTH fields. The suite claimed the app wrongly
//      rejects it. That claim was made while the PNG row was sending a generated 1x1 image, so
//      it was never a test of the boundary at all. Both fields are driven with real photographs
//      of exactly 10,485,760 bytes, and 11 MB is driven afterwards as a control — an "accepted"
//      verdict means nothing unless the same reader still rejects something.
//
// Drives the REAL CommunityFormPage, not a re-implementation, so what it measures is what the
// suite does. NEVER CLICKS SAVE: nothing is created.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');
const LoginPage = require('../pages/LoginPage');
const { imageFile } = require('../utils/imageFixtures');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';

// Records every scroll on the page, whatever element it happens on, with a label the driver sets
// before each operation. `capture: true` is required — scroll does not bubble from elements.
const SCROLL_SPY = `
  window.__scrollLog = [];
  window.__scrollLabel = 'idle';
  window.__t0 = Date.now();
  const describe = (t) => {
    if (t === document || t === window || t === document.documentElement || t === document.body) return 'PAGE';
    const el = t;
    return (el.tagName || '?') + (el.id ? '#' + el.id : '')
      + '.' + String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
  };
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    const y = (t === document || t === window) ? window.scrollY : (t.scrollTop != null ? t.scrollTop : window.scrollY);
    window.__scrollLog.push({ ms: Date.now() - window.__t0, label: window.__scrollLabel, on: describe(t), y });
  }, { capture: true, passive: true });
`;

async function summariseScrolls(page, label) {
  return page.evaluate((wanted) => {
    const rows = (window.__scrollLog || []).filter((r) => r.label === wanted);
    if (!rows.length) return { events: 0 };
    const ys = rows.map((r) => r.y);
    const byTarget = {};
    for (const r of rows) byTarget[r.on] = (byTarget[r.on] || 0) + 1;
    // A reversal is a change of scroll direction: the signature of thrash rather than of one
    // scrollIntoView, which moves in a single direction.
    let reversals = 0;
    let dir = 0;
    for (let i = 1; i < ys.length; i += 1) {
      const d = Math.sign(ys[i] - ys[i - 1]);
      if (d !== 0 && dir !== 0 && d !== dir) reversals += 1;
      if (d !== 0) dir = d;
    }
    return {
      events: rows.length,
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      travel: Math.max(...ys) - Math.min(...ys),
      reversals,
      byTarget,
    };
  }, label);
}

async function step(page, label, fn) {
  await page.evaluate((l) => { window.__scrollLabel = l; }, label);
  const t = Date.now();
  let result;
  let error = null;
  try {
    result = await fn();
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  const ms = Date.now() - t;
  const scrolls = await summariseScrolls(page, label);
  console.log(
    `  ${String(ms).padStart(6)}ms  ${label}`
    + `  [scroll events ${scrolls.events}, travel ${scrolls.travel || 0}px, direction reversals ${scrolls.reversals || 0}]`
    + (error ? `  ERROR: ${error}` : '')
  );
  if (scrolls.events > 20) console.log(`            targets: ${JSON.stringify(scrolls.byTarget)}`);
  return { result, ms, scrolls, error };
}

(async () => {
  // DEFAULTS TO 1280x720 ON PURPOSE — that is what a real run uses. hooks.js builds its context
  // through videoRecorder.contextOptions(), which sets recordVideo.size but NO viewport, so
  // Playwright's own default applies. An earlier pass of this probe ran at 1600x950, where the
  // Create form fits the viewport exactly and NOTHING scrolls, and it therefore reported zero
  // scroll events against a page the user watches thrash on every run.
  const [vw, vh] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
  console.log(`viewport ${vw}x${vh}${vw === 1280 && vh === 720 ? '  (the default a real run gets)' : ''}`);
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 50 : 0 });
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(SCROLL_SPY);
  const page = await ctx.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const form = new CommunityFormPage(page);

  // ---------- Does the fixture even decode? ----------
  console.log('\n================ 0. do the boundary fixtures decode in Chromium? ================');
  for (const [fmt, mb] of [['JPG', 10], ['PNG', 10], ['PNG', 5]]) {
    const f = imageFile(fmt, mb, 'cover');
    // eslint-disable-next-line no-await-in-loop
    const decoded = await page.evaluate(async ({ b64, mimeType }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const img = new Image();
      const ok = await new Promise((res) => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = url;
      });
      return { ok, w: img.naturalWidth, h: img.naturalHeight };
    }, { b64: f.buffer.toString('base64'), mimeType: f.mimeType });
    console.log(`  ${fmt} ${mb}MB -> "${f.name}" [${f.source}, ${f.buffer.length} bytes] decodes=${decoded.ok} ${decoded.w}x${decoded.h}`);
  }

  // ---------- A. scroll behaviour of the real code path ----------
  console.log('\n================ A. Create Community — per-call timing and scroll ================');
  await step(page, 'gotoCreate', () => form.gotoCreate());
  console.log(`  page height ${await page.evaluate(() => document.documentElement.scrollHeight)}px, viewport 950px`);
  console.log(`  form heading resolves: ${await form.heading.count()} match(es)`);
  console.log(`  cover button resolves: ${await form.coverUploadButton.count()}, logo button: ${await form.logoUploadButton.count()}`);
  console.log(`  save button resolves: ${await form.saveButton.count()}, exit: ${await form.exitButton.count()}`);

  await step(page, 'readFields', () => form.readFields());
  // How much of settle() is the networkidle wait? It is capped at 20s and settle() is called
  // after nearly every action, so if this page never reaches networkidle the suite pays that cap
  // over and over for nothing.
  for (const i of [1, 2, 3]) {
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const reached = await page.waitForLoadState('networkidle', { timeout: 20000 }).then(() => true).catch(() => false);
    console.log(`  networkidle attempt ${i}: ${reached ? 'reached' : 'TIMED OUT'} after ${Date.now() - t}ms`);
  }
  await step(page, 'settle(800)', () => form.settle(800));
  await step(page, 'uploadImage cover JPG 8', () => form.uploadImage('Cover Photo', 'JPG', 8));
  await step(page, 'uploadImage logo PNG 5', () => form.uploadImage('Profile Photo', 'PNG', 5));
  await step(page, 'selectUniversity(0)', () => form.selectUniversity(0));
  await step(page, 'selectLocation(Riyadh)', () => form.selectLocation('Riyadh'));
  await step(page, 'typeAbout', () => form.typeAbout('Probe only — never saved.'));
  await step(page, 'waitForSaveEnabled', () => form.waitForSaveEnabled());
  await step(page, 'saveStaysDisabled(1500)', () => form.saveStaysDisabled(1500));
  // The suspected thrash: clearField blurs by clicking the heading, which is at the very top.
  await step(page, 'clearField(Location)', () => form.clearField('Location'));
  await step(page, 'readValidationError', () => form.readValidationError());
  await step(page, 'removeImage(Cover Photo)', () => form.removeImage('Cover Photo'));
  await step(page, 'readValidationError #2', () => form.readValidationError());
  await step(page, 'imageControls', () => form.imageControls());

  const total = await page.evaluate(() => (window.__scrollLog || []).length);
  console.log(`\n  TOTAL scroll events across the whole sequence: ${total}`);
  console.log('  busiest 8 labels:');
  console.log(JSON.stringify(await page.evaluate(() => {
    const by = {};
    for (const r of window.__scrollLog || []) by[r.label] = (by[r.label] || 0) + 1;
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }), null, 1));

  // ---------- B. the 10 MB boundary, on both fields, with an 11 MB control ----------
  console.log('\n================ B. exactly 10 MB, both fields, plus an 11 MB control ================');
  await step(page, 'reopen create', () => form.gotoCreate());
  const rows = [
    ['Cover Photo', 'JPG', 10, 'the stated maximum — must be ACCEPTED'],
    ['Profile Photo', 'PNG', 10, 'the stated maximum — must be ACCEPTED'],
    ['Cover Photo', 'JPG', 11, 'over the maximum — must be REJECTED (control)'],
  ];
  for (const [field, fmt, mb, why] of rows) {
    // eslint-disable-next-line no-await-in-loop
    const r = await step(page, `upload ${field} ${fmt} ${mb}MB`, () => form.uploadImage(field, fmt, mb));
    const u = r.result || {};
    console.log(`        ${why}`);
    console.log(`        -> sent "${u.fileName}" [${u.fileSource}, ${u.sizeBytes} bytes]`);
    console.log(`        -> crop modal appeared=${u.cropModalAppeared} heading=${JSON.stringify(u.cropHeading)} confirmed=${u.cropConfirmed}`);
    console.log(`        -> preview=${u.previewShown}  ACCEPTED=${u.accepted}  error=[${u.errorSurface || 'none'}] ${JSON.stringify(u.error)}`);
    // eslint-disable-next-line no-await-in-loop
    console.log(`        -> previews on the form now: ${JSON.stringify(await form.imagePreviews())}`);
  }

  console.log('\nNothing was saved. No community was created.');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
