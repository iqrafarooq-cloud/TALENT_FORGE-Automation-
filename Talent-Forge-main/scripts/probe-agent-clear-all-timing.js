// Does the empty state's "Clear All" fire a list request, or is unfiltered page 1 served
// from the client cache? Read-only.
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
    await listing.runAndWaitForList(async () => {
      await page.goto(listing.url + '?candidateCount=0&targetProgress=76-100');
    });
    await page.waitForTimeout(1500);
    const before = calls.length;
    const t0 = Date.now();
    const res = await listing.clickPageClearAll();
    console.log('clickPageClearAll: requestFired=' + res.requestFired + '  took ' + (Date.now() - t0) + 'ms');
    console.log('  new list calls during clear: ' + JSON.stringify(calls.slice(before)));
    console.log('  url after clear : ' + page.url());
    await page.waitForTimeout(1500);
    console.log('  rows after clear: ' + (await listing.readRows()).filter((r) => r.email).length);
    console.log('  all calls: ' + JSON.stringify(calls, null, 1));
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
