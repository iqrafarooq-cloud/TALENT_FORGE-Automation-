// Is ANY agent on DEV above 25% target progress? Walks every page of the Active list and
// reports the distribution. Read-only. Also drives the Filters MODAL to see which
// target_progress value each option actually sends.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    const listing = new AgentsListingPage(page);

    const buckets = { '0': 0, '1-25': 0, '26-50': 0, '51-75': 0, '76-100': 0, 'other': 0 };
    const above25 = [];
    let total = 0;
    for (let p = 1; p <= 25; p += 1) {
      const res = await listing.runAndWaitForList(async () => {
        await page.goto(listing.url + '?page=' + p);
      });
      const agents = AgentsListingPage.agentsFrom(res.payload);
      if (!agents.length) break;
      total += agents.length;
      for (const a of agents) {
        const v = Number(a.progress);
        if (Number.isNaN(v)) buckets.other += 1;
        else if (v === 0) buckets['0'] += 1;
        else if (v <= 25) buckets['1-25'] += 1;
        else if (v <= 50) { buckets['26-50'] += 1; above25.push(a); }
        else if (v <= 75) { buckets['51-75'] += 1; above25.push(a); }
        else { buckets['76-100'] += 1; above25.push(a); }
      }
    }
    line('agents scanned: ' + total);
    line('target-progress distribution: ' + JSON.stringify(buckets, null, 1));
    line('agents above 25%: ' + JSON.stringify(above25.map((a) => a.email + '=' + a.progress)));

    line('\n--- what each Target Progress option SENDS, driven through the modal ---');
    for (const option of ['0% - 25%', '26% - 50%', '51% - 75%', '76% - 100%']) {
      await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
      await listing.openFilters();
      await listing.selectFilterOption('Target Progress', option);
      const res = await listing.runAndWaitForList(async () => { await listing.applyFilters(); }, { timeout: 15000 });
      const agents = AgentsListingPage.agentsFrom(res.payload);
      line('  ' + option.padEnd(12) + ' fired=' + res.requestFired
        + ' count=' + (res.payload && res.payload.count) + ' returned=' + agents.length);
      line('     request: ' + String(res.requestUrl).replace(/^https?:\/\/[^/]+/, ''));
      line('     url    : ' + page.url());
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
