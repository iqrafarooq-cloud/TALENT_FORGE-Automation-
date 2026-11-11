/* eslint-disable no-console */
// probe-agent-analytics-help-and-default.js - READ-ONLY.
// (1) Every icon-only button on /agents-analytics: its full markup, what assistive technology would
//     announce for it (aria-label / labelledby / title / svg <title> / describedby), and whether its
//     tooltip opens on hover and on keyboard focus.
// (2) The default load: which duration each widget request carries, what the URL holds and which
//     Duration option is marked as chosen.
require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL; const ORIGIN = new URL(BASE).origin;
  const b = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const reqs = [];
  page.on('request', (r) => { if (/\/agent\/analytics\//.test(r.url())) reqs.push(r.url().replace(/^.*\/v1/, '')); });
  await page.goto(BASE);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });

  console.log('=== (2) default load');
  console.log('landed on', page.url());
  reqs.length = 0;
  await page.goto(`${ORIGIN}/agents-analytics`); await page.waitForTimeout(8000);
  console.log('url after load', page.url());
  console.log('requests', reqs);
  const trig = page.locator('[data-testid="admin-analytics-agents-duration-select"]');
  console.log('trigger text', JSON.stringify(await trig.innerText()));
  await trig.click(); await page.waitForTimeout(800);
  console.log('options', await page.locator('[role="dialog"]').last().locator('.list-option').evaluateAll((els) => els.map((e) => `${e.innerText.trim()} checked=${!!e.querySelector('svg')}`)));
  await page.keyboard.press('Escape');

  console.log('\n=== (1) icon-only buttons');
  const info = await page.locator('main section button').evaluateAll((els) => els
    .filter((e) => !(e.innerText || '').trim())
    .map((e) => {
      const s = e.closest('section');
      const svgTitle = e.querySelector('svg title');
      return {
        card: s ? (s.querySelector('p,h2,h3') || {}).innerText : null,
        ariaLabel: e.getAttribute('aria-label'),
        labelledby: e.getAttribute('aria-labelledby'),
        describedby: e.getAttribute('aria-describedby'),
        title: e.getAttribute('title'),
        svgTitle: svgTitle ? svgTitle.textContent : null,
        svgAriaHidden: (e.querySelector('svg') || {}).getAttribute ? e.querySelector('svg').getAttribute('aria-hidden') : null,
        tabindex: e.getAttribute('tabindex'),
        testid: e.getAttribute('data-testid'),
        html: e.outerHTML.slice(0, 260),
      };
    }));
  console.log(JSON.stringify(info, null, 1));
  const btns = page.locator('main section button');
  const n = await btns.count();
  for (let i = 0; i < n; i += 1) {
    const btn = btns.nth(i);
    if ((await btn.innerText()).trim()) continue;
    await page.mouse.move(2, 2); await page.waitForTimeout(300);
    await btn.hover({ force: true }); await page.waitForTimeout(800);
    const hoverTip = await page.locator('[role="tooltip"]').allInnerTexts();
    await page.mouse.move(2, 2); await page.waitForTimeout(300);
    await btn.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(800);
    const focusTip = await page.locator('[role="tooltip"]').allInnerTexts();
    const described = await btn.getAttribute('aria-describedby');
    // the accessible name Chromium computes, read through the accessibility tree
    const snap = await btn.ariaSnapshot().catch(() => '(no snapshot)');
    console.log(`#${i}`, { hoverTip, focusTip, describedWhileOpen: described, ariaSnapshot: snap });
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
