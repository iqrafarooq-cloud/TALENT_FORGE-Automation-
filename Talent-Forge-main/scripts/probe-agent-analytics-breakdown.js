/* eslint-disable no-console */
// probe-agent-analytics-breakdown.js - READ-ONLY. Does the Document Verification Breakdown show a
// percentage per category anywhere - in the card text, or on hovering a bar segment / legend item?
require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL;
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(BASE);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  let payload = null;
  page.on('response', async (r) => { if (/documents\/breakdown\/\?duration=ytd/.test(r.url())) payload = await r.json().catch(() => null); });
  await page.goto(`${new URL(BASE).origin}/agents-analytics?duration=Year-to-Date`); await page.waitForTimeout(8000);
  const card = page.locator('.document-verification-breakdown-card');
  console.log('server', JSON.stringify(payload));
  console.log('card text:', JSON.stringify((await card.innerText()).split('\n').filter(Boolean)));
  const segs = card.locator('[style*="flex"][style*="background"]');
  const n = await segs.count();
  for (let i = 0; i < n; i += 1) {
    const box = await segs.nth(i).boundingBox();
    if (!box || box.width < 2) { console.log('segment', i, 'zero width'); continue; }
    await page.mouse.move(2, 2); await page.waitForTimeout(300);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 }); await page.waitForTimeout(800);
    console.log('segment', i, 'title', await segs.nth(i).getAttribute('title'), 'tooltip', await page.locator('[role="tooltip"], .recharts-tooltip-wrapper, [class*="tooltip"]').allInnerTexts());
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
