/* eslint-disable no-console */
// Why did "About University should hold exactly 300 characters" read back 0?
//
// AC 3.1 E says the field caps at 300 "silently". The run of 2026-08-02 reported the field
// holding 0 characters after 301 were typed, which has two very different explanations and the
// report cannot tell them apart:
//   (a) the app clears the field when the cap is exceeded, instead of truncating — a real
//       defect, and a nastier one than the AC contemplates (the user loses what they wrote);
//   (b) Page Object `typeAbout()` uses locator.fill(), and fill() on a controlled React
//       textarea carrying a maxLength can land differently from real typing — a suite bug.
//
// So this drives the field FOUR ways against the same element and prints what each leaves
// behind: fill(), pressSequentially(), a direct value set + input event, and the paste path.
// Whichever ways truncate to 300 tell us the app caps correctly and the reader was at fault;
// if EVERY way lands on 0 the app really does clear the field. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await c.newPage();
  const BASE = process.env.BASE_URL;
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const f = new CommunityFormPage(p);
  await f.gotoCreate();

  const el = f.aboutInput;
  console.log('textarea attributes:', JSON.stringify(await el.evaluate((e) => ({
    tag: e.tagName,
    name: e.getAttribute('name'),
    maxLength: e.maxLength,
    maxlengthAttr: e.getAttribute('maxlength'),
    placeholder: e.getAttribute('placeholder'),
  })), null, 1));

  const report = async (how, n, run) => {
    await el.fill('').catch(() => {});
    await p.waitForTimeout(300);
    try {
      await run('x'.repeat(n));
    } catch (e) {
      console.log(`${how} (${n}): THREW ${e.message.split('\n')[0]}`);
      return;
    }
    await p.waitForTimeout(600);
    const v = await el.inputValue();
    console.log(`${how} (${n} in): held ${v.length}`);
  };

  for (const n of [299, 300, 301, 400]) {
    await report('fill()           ', n, (t) => el.fill(t));
    await report('pressSequentially', n, (t) => el.pressSequentially(t, { delay: 0 }));
    await report('value+input event', n, (t) => el.evaluate((e, s) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(e, s);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, t));
    await report('typeAbout() (POM)', n, () => f.typeAbout('x'.repeat(n)));
    await report('pasteAbout() (POM)', n, () => f.pasteAbout('y'.repeat(n)));
    console.log('---');
  }

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
