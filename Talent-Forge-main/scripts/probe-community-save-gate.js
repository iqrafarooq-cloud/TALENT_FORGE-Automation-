/* eslint-disable no-console */
// Why does Save stay disabled with all four required fields filled? Either the app never
// enables it (a defect) or the crop modal is not really applying the image (a suite bug).
// Fills the form step by step through the SAME Page Object the steps use and reports the Save
// state plus what the form actually holds after each action. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await c.newPage();
  const BASE = process.env.BASE_URL, ORIGIN = new URL(BASE).origin;
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const f = new CommunityFormPage(p);
  await f.gotoCreate();

  const dump = async (tag) => {
    const state = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        saveButtons: Array.from(document.querySelectorAll('button')).filter(vis)
          .filter(b => /^save$/i.test(t(b))).map(b => ({ type: b.getAttribute('type'), disabled: b.disabled })),
        previews: Array.from(document.querySelectorAll('img')).filter(vis)
          .map(i => ({ alt: i.alt, kind: /^blob:|^data:/.test(i.src) ? 'blob' : (i.src.includes('community/') ? 'remote' : 'other'), w: Math.round(i.getBoundingClientRect().width) })),
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(vis).map(d => t(d).slice(0, 90)),
        values: Array.from(document.querySelectorAll('input,textarea')).filter(i => i.type !== 'file')
          .map(i => ({ ph: i.getAttribute('placeholder'), v: i.value })),
        errors: Array.from(document.querySelectorAll('p,span,div')).filter(e => e.children.length === 0 && vis(e))
          .map(e => t(e)).filter(s => /required|only jpg|exceed|too large|must be/i.test(s)),
      };
    });
    console.log(`\n### ${tag}\n${JSON.stringify(state, null, 1)}`);
  };

  await dump('fresh form');
  console.log('\n>> upload cover');
  console.log(JSON.stringify(await f.uploadImage('Cover Photo', 'JPG', 2)));
  await dump('after cover');
  console.log('\n>> upload logo');
  console.log(JSON.stringify(await f.uploadImage('Profile Photo', 'PNG', 2)));
  await dump('after logo');
  console.log('\n>> select university:', await f.selectUniversity(0));
  await dump('after university');
  console.log('\n>> select location:', await f.selectLocation('Riyadh'));
  await dump('after location');
  console.log('\n>> waitForSaveEnabled:', await f.waitForSaveEnabled(15000));
  await dump('final');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
