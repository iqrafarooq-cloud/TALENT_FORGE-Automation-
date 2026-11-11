/* eslint-disable no-console */
// probe-community-crop-modal.js — READ-ONLY. Times the crop modal frame by frame.
//
// WHY. `uploadImage('Cover Photo', ...)` takes 17.5s and produces 10 scroll events with 8
// DIRECTION REVERSALS, while the very same helper on the Profile Photo takes 3.3s and scrolls
// not at all (measured 2026-08-03, probe-community-create-page.js at the real 1280x720 viewport).
// That asymmetry is the whole of the "it just scrolls up and down" complaint, and it has to be
// attributed to a specific wait before it can be fixed rather than papered over with a sleep.
//
// The hypothesis being tested: confirmCrop() clicks the modal's Save before the cropper has
// mounted its image, the click is a no-op, and the helper then absorbs an 8000ms
// waitFor({state:'hidden'}) before retrying — 8s of dead time per upload, with the modal being
// re-scrolled into view on each attempt.
//
// What it prints: the modal's contents and control states sampled every 250ms from the moment
// the file is set, so the earliest reliable "the cropper is ready" signal is visible rather than
// guessed at. Then it clicks Save once and times how long the modal takes to go.
//
// Never saves the form. Nothing is created.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityFormPage = require('../pages/CommunityFormPage');
const { imageFile } = require('../utils/imageFixtures');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const HEADED = process.env.HEADED === 'true';

const inspect = (page) => page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const modal = Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter(vis)
    .find((d) => /upload community/i.test(d.innerText || ''));
  if (!modal) return { open: false, pageScrollY: window.scrollY };
  return {
    open: true,
    pageScrollY: window.scrollY,
    bodyOverflow: getComputedStyle(document.body).overflow,
    heading: t(modal.innerText).split(/(?<=\.)\s/)[0].slice(0, 60),
    buttons: Array.from(modal.querySelectorAll('button')).filter(vis).map((b) => ({
      text: t(b.textContent) || b.getAttribute('aria-label'),
      disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    })),
    imgs: Array.from(modal.querySelectorAll('img')).map((i) => ({
      complete: i.complete,
      nw: i.naturalWidth,
      nh: i.naturalHeight,
      w: Math.round(i.getBoundingClientRect().width),
      h: Math.round(i.getBoundingClientRect().height),
      src: String(i.src).slice(0, 24),
    })),
    canvases: Array.from(modal.querySelectorAll('canvas')).map((c) => ({ w: c.width, h: c.height })),
    sliders: Array.from(modal.querySelectorAll('input[type="range"],[role="slider"]')).length,
  };
});

(async () => {
  const [vw, vh] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
  const browser = await chromium.launch({ headless: !HEADED, slowMo: 0 });
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const form = new CommunityFormPage(page);
  await form.gotoCreate();
  console.log(`viewport ${vw}x${vh}; document height ${await page.evaluate(() => document.documentElement.scrollHeight)}px`);

  for (const [field, fmt, mb] of [['Cover Photo', 'JPG', 8], ['Profile Photo', 'PNG', 5]]) {
    console.log(`\n================ ${field} — ${fmt} ${mb}MB ================`);
    const file = imageFile(fmt, mb, field.toLowerCase().includes('profile') ? 'logo' : 'cover');
    const isProfile = /profile|logo/i.test(field);
    console.log(`file "${file.name}" (${file.buffer.length} bytes)`);

    const t0 = Date.now();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
      (isProfile ? form.logoUploadButton : form.coverUploadButton).click({ timeout: 10000 }).catch(() => {}),
    ]);
    console.log(`filechooser fired after ${Date.now() - t0}ms: ${!!chooser}`);
    if (!chooser) { console.log('no chooser — skipping'); continue; }
    const tSet = Date.now();
    await chooser.setFiles(file);

    // Sample every 250ms for 6s, so the moment each signal becomes true is visible.
    let firstOpen = null;
    let firstDecoded = null;
    let firstSaveEnabled = null;
    for (let i = 0; i < 24; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const s = await inspect(page);
      const ms = Date.now() - tSet;
      if (s.open && firstOpen === null) firstOpen = ms;
      const decoded = s.open && (s.imgs || []).some((im) => im.complete && im.nw > 0);
      if (decoded && firstDecoded === null) firstDecoded = ms;
      const save = s.open && (s.buttons || []).find((b) => /^save$/i.test(b.text || ''));
      if (save && !save.disabled && firstSaveEnabled === null) firstSaveEnabled = ms;
      if (i < 12 || decoded) {
        console.log(`  +${String(ms).padStart(4)}ms  ${JSON.stringify(s).slice(0, 320)}`);
      }
      if (decoded && ms > 2000) break;
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(250);
    }
    console.log(`  --> modal open at +${firstOpen}ms, image decoded at +${firstDecoded}ms, Save enabled at +${firstSaveEnabled}ms`);

    // ONE Save click, timed. If the modal closes promptly the 8s cost is entirely the blind
    // early click; if it does not, the wait itself is what needs changing.
    const tSave = Date.now();
    await form.cropSave.click({ timeout: 8000 }).catch((e) => console.log('  save click failed:', e.message.split('\n')[0]));
    const closed = await form.cropModal.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false);
    console.log(`  --> single Save click: modal ${closed ? 'CLOSED' : 'still open'} after ${Date.now() - tSave}ms`);
    console.log(`  --> preview present: ${await form.hasPreview(field)}`);
  }

  console.log('\nNothing was saved. No community was created.');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
