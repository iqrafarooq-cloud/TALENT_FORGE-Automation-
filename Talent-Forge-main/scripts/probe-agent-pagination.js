// Does "Previous" really return an empty page, or is the suite reading the wrong thing?
// Watches every agent-list request the app makes and reports the URL, the server's count,
// and the rows actually rendered afterwards. Read-only.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\/agent\/\?/.test(r.url()) || r.request().method() !== 'GET') return;
    const j = await r.json().catch(() => null);
    calls.push({
      url: r.url().replace(/^https?:\/\/[^/]+/, ''),
      status: r.status(),
      count: j && j.count,
      returned: j && Array.isArray(j.results) ? j.results.length : null,
    });
  });

  const snap = async (label, listing) => {
    await page.waitForTimeout(1500);
    const rows = (await listing.readRows()).filter((r) => r.email);
    line('\n--- ' + label + ' ---');
    line('  url        : ' + page.url());
    line('  rows shown : ' + rows.length + '  ' + JSON.stringify(rows.slice(0, 3).map((r) => r.email)));
    line('  pagination : ' + JSON.stringify(await listing.paginationText()));
    line('  prev disabled: ' + await listing.isPrevDisabled() + '   next disabled: ' + await listing.isNextDisabled());
    line('  last call  : ' + JSON.stringify(calls[calls.length - 1]));
  };

  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);

    const listing = new AgentsListingPage(page);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
    await snap('page 1 (initial)', listing);

    const n = await listing.goToNextPage();
    line('\ngoToNextPage -> requestFired=' + n.requestFired + ' url=' + String(n.requestUrl).replace(/^https?:\/\/[^/]+/, ''));
    await snap('after Next', listing);

    const p = await listing.goToPrevPage();
    line('\ngoToPrevPage -> requestFired=' + p.requestFired + ' url=' + String(p.requestUrl).replace(/^https?:\/\/[^/]+/, ''));
    await snap('after Previous (immediately)', listing);

    await page.waitForTimeout(4000);
    await snap('after Previous (+4s)', listing);

    line('\nALL agent-list calls, in order:');
    calls.forEach((c, i) => line('  [' + i + '] ' + c.url + '  -> ' + c.status + ' count=' + c.count + ' returned=' + c.returned));
    await page.screenshot({ path: 'reports/probe-agent-pagination.png', fullPage: true });
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
