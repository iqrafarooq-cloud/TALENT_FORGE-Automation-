/* eslint-disable no-console */
// probe-superadmin-candidate-analytics-3.js - READ-ONLY. Do the Learning Activity Trend and the
// city bars show exact counts on hover? Sweeps the pointer across each chart and prints any
// tooltip text that appears, plus the SVG element classes the trend chart is built from.
require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL; const ORIGIN = new URL(BASE).origin;
  const b = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(BASE);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await page.goto(`${ORIGIN}/candidate-analytics`); await page.waitForTimeout(8000);

  const prog = page.locator('.candidate-progress-and-learning-activity-card');
  console.log('trend svg parts:', [...new Set(await prog.locator('svg *').evaluateAll((e) => e.map((x) => `${x.tagName}.${(x.getAttribute('class') || '').split(' ')[0]}`)))].join(' '));
  const sv = prog.locator('.recharts-surface').first();
  const box = await sv.boundingBox();
  let hits = 0;
  for (const x of [0.3, 0.55, 0.8, 0.9]) {
    for (const y of [0.3, 0.6, 0.85]) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 });
      await page.waitForTimeout(500);
      const t = (await page.locator('.recharts-tooltip-wrapper, [role="tooltip"]').allInnerTexts()).join(' | ').trim();
      if (t) { hits += 1; console.log('trend hover', x, y, JSON.stringify(t)); }
    }
  }
  console.log('trend hover hits', hits);

  const city = page.locator('.candidates-by-city-card');
  const segs = city.locator('[aria-hidden="true"] > div');
  const n = Math.min(await segs.count(), 4);
  for (let i = 0; i < n; i += 1) {
    const sb = await segs.nth(i).boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 4 });
    await page.waitForTimeout(700);
    const t = (await page.locator('[role="tooltip"], [class*="tooltip"]').allInnerTexts()).join(' | ').trim();
    console.log('city segment', i, JSON.stringify(t), 'title', await segs.nth(i).getAttribute('title'));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
