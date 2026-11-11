/* eslint-disable no-console */
// probe-agents-total-candidates-help.js - READ-ONLY. What the "Total Candidates" header help icon
// on the SuperAdmin Agents listing actually renders on hover / click / focus: every element that
// becomes visible, whatever its role, so a tooltip without role="tooltip" is not reported absent.
//
// Run:  node scripts/probe-agents-total-candidates-help.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL;
const ORIGIN = new URL(BASE).origin;
const SHOT = process.env.SHOT_DIR || 'reports';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(BASE);
  await page.locator('input[type="email"]').fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/agents|candidate/, { timeout: 90000 });
  await page.goto(`${ORIGIN}/agents`);
  await page.locator('[role="row"]').nth(1).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const header = page.locator('[role="columnheader"]').filter({ hasText: 'Total Candidates' }).first();
  console.log('header html:', (await header.evaluate((h) => h.outerHTML)).slice(0, 1500));
  const buttons = header.locator('button');
  console.log('buttons in header:', await buttons.count());
  const icon = buttons.first();
  console.log('icon attrs:', JSON.stringify(await icon.evaluate((b) => ({
    aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), describedby: b.getAttribute('aria-describedby'),
    text: b.innerText, tab: b.tabIndex, svg: (b.querySelector('svg') || {}).outerHTML ? b.querySelector('svg').outerHTML.slice(0, 200) : null,
  }))));

  const visibleTexts = () => page.evaluate(() => {
    const out = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = (el.innerText || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width && r.height && s.visibility !== 'hidden' && s.opacity !== '0') out.add(t);
    }
    return [...out];
  });
  const roles = () => page.evaluate(() => [...document.querySelectorAll('[role="tooltip"],[data-tooltip],[class*="tooltip" i],[popover]')]
    .map((e) => ({ tag: e.tagName, role: e.getAttribute('role'), cls: String(e.className).slice(0, 80), text: (e.innerText || '').trim().slice(0, 200) })));

  const before = new Set(await visibleTexts());
  await page.mouse.move(5, 5); await page.waitForTimeout(400);
  await icon.hover();
  for (const ms of [300, 800, 1500, 3000]) {
    await page.waitForTimeout(ms === 300 ? 300 : ms - [300, 800, 1500, 3000][[300, 800, 1500, 3000].indexOf(ms) - 1]);
    const now = (await visibleTexts()).filter((t) => !before.has(t));
    console.log(`hover +${ms}ms new text:`, JSON.stringify(now), 'tooltip-ish:', JSON.stringify(await roles()));
  }
  await page.screenshot({ path: `${SHOT}/probe-total-candidates-hover.png` });

  // the step's own read after hover
  console.log('[role=tooltip] after hover:', JSON.stringify(await page.locator('[role="tooltip"]').allInnerTexts()));
  console.log('icon aria-describedby after hover:', await icon.getAttribute('aria-describedby'));

  // hover the svg itself rather than the button centre
  const svg = header.locator('svg').first();
  if (await svg.count()) {
    await page.mouse.move(5, 5); await page.waitForTimeout(600);
    await svg.hover(); await page.waitForTimeout(1500);
    console.log('svg hover new text:', JSON.stringify((await visibleTexts()).filter((t) => !before.has(t))));
  }
  await page.mouse.move(5, 5); await page.waitForTimeout(800);
  await icon.focus(); await page.waitForTimeout(1500);
  console.log('focus new text:', JSON.stringify((await visibleTexts()).filter((t) => !before.has(t))));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
