/* eslint-disable no-console */
// Follow-up to probe-community-about-cap.js, which established that pasteAbout() leaves the
// field EMPTY at every length (0 for 299, 300, 301 and 400) while typing caps correctly at 300.
// A dispatched ClipboardEvent is untrusted, so the browser performs no default action — nothing
// is inserted, and the scenario read that as "the app cleared the field".
//
// The paste path has to stay a DIFFERENT code path from typing (its whole point: a per-keystroke
// guard lets a paste straight through, which is how TFF-288 survived its first fix), so the
// replacement must insert text WITHOUT synthesising keystrokes. Two candidates:
//   1. a real clipboard paste, with the context granted clipboard permissions
//   2. page.keyboard.insertText(), which commits text the way an IME/paste does — one input
//      event, no keydown/keypress per character
// This measures both, and specifically whether each still respects maxlength=300. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(process.env.BASE_URL).origin })
    .then(() => console.log('clipboard permissions: GRANTED'))
    .catch((e) => console.log('clipboard permissions: REFUSED —', e.message.split('\n')[0]));
  const p = await c.newPage();
  await p.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const f = new CommunityFormPage(p);
  await f.gotoCreate();
  const el = f.aboutInput;

  const run = async (how, n, fn) => {
    await el.fill('').catch(() => {});
    await p.waitForTimeout(300);
    try { await fn('z'.repeat(n)); } catch (e) {
      console.log(`${how} (${n}): THREW ${e.message.split('\n')[0]}`); return;
    }
    await p.waitForTimeout(600);
    console.log(`${how} (${n} in): held ${(await el.inputValue()).length}`);
  };

  for (const n of [299, 301, 400]) {
    await run('keyboard.insertText ', n, async (t) => {
      await el.click();
      await p.keyboard.insertText(t);
    });
    await run('real clipboard Ctrl+V', n, async (t) => {
      await p.evaluate((s) => navigator.clipboard.writeText(s), t);
      await el.click();
      await p.keyboard.press('Control+V');
    });
    console.log('---');
  }

  // Does insertText really bypass per-keystroke handlers? Count keydowns for each path; a paste
  // must produce none, or it is just typing under another name and TFF-288 loses its cover.
  await el.fill('');
  const counted = await p.evaluate(() => new Promise((res) => {
    const ta = document.querySelector('textarea[name="description"]');
    let keys = 0, inputs = 0;
    const k = () => { keys++; };
    const i = () => { inputs++; };
    ta.addEventListener('keydown', k); ta.addEventListener('input', i);
    window.__stop = () => { ta.removeEventListener('keydown', k); ta.removeEventListener('input', i); return { keys, inputs }; };
    res('armed');
  }));
  console.log('listener:', counted);
  await el.click();
  await p.keyboard.insertText('hello world');
  await p.waitForTimeout(300);
  console.log('insertText event counts:', JSON.stringify(await p.evaluate(() => window.__stop())));

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
