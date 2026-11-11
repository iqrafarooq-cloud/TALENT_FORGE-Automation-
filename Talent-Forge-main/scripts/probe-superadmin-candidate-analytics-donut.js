/* eslint-disable no-console */
// probe-superadmin-candidate-analytics-donut.js - READ-ONLY. Picks a university (argument, or the
// first with two or more majors), then dumps the donut's DOM and what hovering each sector raises.
// Run: node scripts/probe-superadmin-candidate-analytics-donut.js ["University name"]
require('dotenv').config();
const { chromium } = require('playwright');
const CandidateAnalyticsPage = require('../pages/CandidateAnalyticsPage');

(async () => {
  const BASE = process.env.BASE_URL;
  const b = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const ca = new CandidateAnalyticsPage(page); ca.install();
  await page.goto(BASE);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await ca.open();
  let name = process.argv[2];
  if (!name) {
    for (const u of (await ca.api('/institutions/?page=1&page_size=500')).body.results) {
      const r = await ca.api(`/analytics/candidates/by-university/?duration=yearly&university=${u.id}`);
      if ((r.body.major_breakdown || []).length >= 2) { name = u.name; break; }
    }
  }
  console.log('university', name);
  const r = await ca.chooseUniversity(name);
  console.log('server', JSON.stringify(r.body.major_breakdown.map((m) => `${m.major}:${m.count}`)));
  const card = ca.card('university');
  console.log('svg parts', [...new Set(await card.locator('svg *').evaluateAll((e) => e.map((x) => `${x.tagName}.${(x.getAttribute('class') || '').split(' ')[0]}`)))].join(' '));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: 'reports/probe-candidate-analytics/donut.png' });
  console.log('sector 0', await card.locator('path.recharts-sector').first().evaluate((p) => ({ d: p.getAttribute('d').slice(0, 160), vis: getComputedStyle(p).visibility, op: getComputedStyle(p).opacity, bb: (() => { const r = p.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })));
  const sectors = card.locator('path.recharts-sector');
  const n = await sectors.count();
  console.log('path.recharts-sector', n);
  for (let i = 0; i < n; i += 1) {
    const box = await sectors.nth(i).boundingBox();
    await page.mouse.move(2, 2);
    await sectors.nth(i).hover({ force: true, timeout: 5000 }).catch((e) => console.log('hover err', e.message.split('\n')[0]));
    await page.waitForTimeout(700);
    console.log(i, JSON.stringify(box), 'fill', await sectors.nth(i).getAttribute('fill'), 'tooltips', await page.locator('.recharts-tooltip-wrapper').allInnerTexts());
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
