// The SCENARIO's path: apply the filters through the modal, then Clear All from the empty
// state. The URL-driven probe took 812ms; this reproduces what the scenario actually does.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on('response', (r) => {
    if (/\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET') {
      calls.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
    }
  });
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    const listing = new AgentsListingPage(page);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });

    await listing.openFilters();
    await listing.selectFilterOption('Candidate Count', '0');
    await listing.selectFilterOption('Target Progress', '76% - 100%');
    await listing.applyFilters();
    await page.waitForTimeout(1500);
    console.log('after apply: ' + page.url());

    const dialogs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map((d) => (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)));
    console.log('visible dialogs after apply: ' + JSON.stringify(dialogs));

    const clearAlls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => /^clear all$/i.test((b.innerText || '').trim()))
        .map((b) => ({
          inDialog: !!b.closest('[role="dialog"]'),
          rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(b.getBoundingClientRect()),
        })));
    console.log('"Clear All" buttons in DOM order: ' + JSON.stringify(clearAlls));

    const before = calls.length;
    const t0 = Date.now();
    const res = await listing.clickPageClearAll();
    console.log('clickPageClearAll: requestFired=' + res.requestFired + '  took ' + (Date.now() - t0) + 'ms');
    console.log('  new calls: ' + JSON.stringify(calls.slice(before)));
    console.log('  url after: ' + page.url());
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
