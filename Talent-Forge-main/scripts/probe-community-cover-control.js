/* eslint-disable no-console */
// probe-community-cover-control.js — READ-ONLY. Identifies the Cover Photo upload control.
//
// WHY. `CommunityFormPage.coverUploadButton` resolves to exactly ONE element, and clicking it
// TIMES OUT after the full 10s while Playwright retries actionability — scrolling it into view
// on every retry. That is the "the page just scrolls up and down" the user reports, and the
// 14s of dead time per cover upload. The logo button, by contrast, opens its file chooser in
// 38ms (measured 2026-08-03, probe-community-crop-modal.js).
//
// So the question is not "is there a control" but "what is that one element, why can it not be
// clicked, and which element DOES open the cover's picker".
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
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

  const form = new CommunityFormPage(page);
  await form.gotoCreate();

  console.log('=== what coverUploadButton resolves to ===');
  console.log(JSON.stringify(await form.coverUploadButton.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    const centreEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      aria: el.getAttribute('aria-label'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      pointerEvents: st.pointerEvents,
      display: st.display,
      visibility: st.visibility,
      opacity: st.opacity,
      disabled: el.disabled,
      // The hit-target check is what Playwright's click actually waits on: if the element at the
      // click point is not this element or a descendant, the click is "intercepted" and retried.
      elementAtCentre: centreEl ? {
        tag: centreEl.tagName,
        text: (centreEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        isSelfOrDescendant: el === centreEl || el.contains(centreEl),
      } : null,
      outer: el.outerHTML.slice(0, 300),
    };
  }), null, 1));

  console.log('\n=== every upload-ish control on the form, with its hit target ===');
  console.log(JSON.stringify(await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('button,label,div,span,input'))
      .filter(vis)
      .filter((e) => /upload|cover|logo|drag and drop/i.test(`${t(e.textContent)} ${e.getAttribute('aria-label') || ''}`))
      .filter((e) => t(e.textContent).length < 120)
      .map((e) => {
        const r = e.getBoundingClientRect();
        const centre = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          tag: e.tagName,
          type: e.getAttribute('type'),
          aria: e.getAttribute('aria-label'),
          text: t(e.textContent).slice(0, 70),
          box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          pointerEvents: getComputedStyle(e).pointerEvents,
          hitTargetIsSelf: centre ? (e === centre || e.contains(centre)) : null,
          hitTarget: centre ? `${centre.tagName}:${t(centre.textContent).slice(0, 40)}` : null,
        };
      });
  }), null, 2));

  console.log('\n=== file inputs ===');
  console.log(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('input[type="file"]')).map((i, idx) => {
    const r = i.getBoundingClientRect();
    return {
      index: idx,
      accept: i.getAttribute('accept'),
      id: i.id,
      name: i.getAttribute('name'),
      box: { w: Math.round(r.width), h: Math.round(r.height) },
      hidden: getComputedStyle(i).display === 'none' || getComputedStyle(i).visibility === 'hidden',
      // Which control owns it — a <label for> or an ancestor label/button is what a user clicks.
      labelFor: document.querySelector(`label[for="${i.id}"]`)
        ? (document.querySelector(`label[for="${i.id}"]`).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)
        : null,
      ancestorChain: (() => {
        const chain = [];
        let p = i.parentElement;
        for (let k = 0; k < 5 && p; k += 1) {
          chain.push(`${p.tagName}${p.getAttribute('aria-label') ? `[${p.getAttribute('aria-label')}]` : ''}`);
          p = p.parentElement;
        }
        return chain.join(' < ');
      })(),
    };
  })), null, 1));

  console.log('\n=== timing: which candidate actually opens a file chooser? ===');
  const candidates = [
    ['coverUploadButton (current)', form.coverUploadButton],
    ['text "Click to upload cover photo"', page.getByText(/click to upload cover photo/i).first()],
    ['the cover drop zone div', page.locator('div').filter({ hasText: /^Click to upload cover photo or drag and drop/ }).first()],
    ['label wrapping cover input', page.locator('label').filter({ hasText: /cover/i }).first()],
    ['logoUploadButton (works, control)', form.logoUploadButton],
  ];
  for (const [name, loc] of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const count = await loc.count().catch(() => 0);
    if (!count) { console.log(`  ${name}: 0 matches`); continue; }
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 3500 }).catch(() => null),
      loc.click({ timeout: 3000 }).catch(() => null),
    ]);
    console.log(`  ${name}: ${count} match(es) -> chooser ${chooser ? 'OPENED' : 'no'} after ${Date.now() - t}ms`);
    if (chooser) {
      // Dismiss it without choosing anything.
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape').catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
    }
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
