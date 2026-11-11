/* eslint-disable no-console */
// probe-community-file-inputs.js — READ-ONLY. How each <input type=file> on the Create/Edit form
// can be bound to ITS OWN field, and which clickable control opens each picker.
//
// Needed because CommunityFormPage picked its controls by ARIA role and got the wrong element:
// Chromium reports role="button" for <input type="file">, and the input's accessible name comes
// from its <label> — so getByRole('button', {name:/upload cover photo/i}) matched a 1x1 sr-only
// INPUT rather than the real <button>, and .first() (DOM order) preferred it. Clicking it can
// never satisfy the hit-target check, so Playwright retried for the full 10s timeout, scrolling
// it into view on every retry.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;

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

  for (const url of [`${ORIGIN}/community/create`, `${ORIGIN}/community/edit/78`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    console.log(`\n================ ${url} ================`);
    console.log(JSON.stringify(await page.evaluate(() => {
      const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('input[type="file"]')).map((i, idx) => {
        const lbl = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null;
        // The nearest ancestor that carries enough text to say which field this is.
        let host = i.parentElement;
        let hostText = '';
        for (let k = 0; k < 6 && host; k += 1) {
          hostText = t(host.innerText || host.textContent);
          if (hostText.length > 8) break;
          host = host.parentElement;
        }
        return {
          index: idx,
          id: i.id,
          cls: String(i.className || ''),
          accept: i.getAttribute('accept'),
          labelForText: lbl ? t(lbl.textContent) : null,
          ancestorText: hostText.slice(0, 90),
          ancestorTag: host ? host.tagName : null,
        };
      });
    }), null, 1));

    console.log('--- real <button> elements whose text/aria names an upload ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('button'))
        .filter(vis)
        .map((b) => ({ text: t(b.textContent), aria: b.getAttribute('aria-label') }))
        .filter((b) => /upload|cover|logo|photo|change|remove/i.test(`${b.text} ${b.aria || ''}`));
    }), null, 1));
  }

  // Does a click on the real <button> open the chooser, and how fast?
  await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  console.log('\n================ timing the corrected locators ================');
  const cands = [
    ['button filter /upload cover photo/', page.locator('button').filter({ hasText: /upload cover photo/i }).first()],
    ['button[aria-label*=logo]', page.locator('button[aria-label*="logo" i]').first()],
  ];
  for (const [name, loc] of cands) {
    // eslint-disable-next-line no-await-in-loop
    const n = await loc.count();
    if (!n) { console.log(`  ${name}: 0 matches`); continue; }
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
      loc.click({ timeout: 5000 }).catch((e) => console.log(`     click error: ${e.message.split('\n')[0]}`)),
    ]);
    console.log(`  ${name}: ${n} match(es) -> chooser ${chooser ? 'OPENED' : 'NOT opened'} in ${Date.now() - t}ms`);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape').catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
