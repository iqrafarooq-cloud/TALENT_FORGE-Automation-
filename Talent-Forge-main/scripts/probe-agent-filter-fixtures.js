// Which filter combinations actually MATCH agents on DEV? Drives the real Filters modal.
// Read-only - filters are applied and cleared, nothing is created.
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

    const apply = async (label, picks) => {
      await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
      await listing.openFilters();
      for (const [group, option] of picks) await listing.selectFilterOption(group, option);
      const res = await listing.runAndWaitForList(async () => { await listing.applyFilters(); }, { timeout: 15000 });
      const agents = AgentsListingPage.agentsFrom(res.payload);
      line('  ' + label.padEnd(46) + ' count=' + String(res.payload && res.payload.count).padEnd(6)
        + ' returned=' + agents.length);
      line('     ' + String(res.requestUrl).replace(/^https?:\/\/[^/]+\/core\/api\/v1\/agent\//, ''));
      return { count: res.payload && res.payload.count, agents };
    };

    line('--- every Target Progress bucket, alone ---');
    for (const o of ['1% - 25%', '26% - 50%', '51% - 75%', '76% - 100%']) {
      await apply('Target Progress ' + o, [['Target Progress', o]]);
    }

    line('\n--- every Candidate Count bucket, alone ---');
    for (const o of ['0', '1-50', '51-100', '100+']) {
      await apply('Candidate Count ' + o, [['Candidate Count', o]]);
    }

    line('\n--- Candidate Count 1-50, to find a university that also has agents ---');
    const base = await apply('Candidate Count 1-50', [['Candidate Count', '1-50']]);
    const unis = [...new Set(base.agents.map((a) => a.university).filter(Boolean))];
    line('     universities on page 1: ' + JSON.stringify(unis));
    if (unis.length) {
      await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
      await listing.openFilters();
      await listing.selectFilterOption('Candidate Count', '1-50');
      await listing.openUniversitySuggestions();
      await listing.typeUniversity(unis[0]);
      await listing.chooseUniversity(unis[0]);
      const res = await listing.runAndWaitForList(async () => { await listing.applyFilters(); }, { timeout: 15000 });
      const agents = AgentsListingPage.agentsFrom(res.payload);
      line('\n  COMBINATION "Candidate Count 1-50" + university ' + JSON.stringify(unis[0]));
      line('     count=' + (res.payload && res.payload.count) + ' returned=' + agents.length);
      line('     ' + String(res.requestUrl).replace(/^https?:\/\/[^/]+\/core\/api\/v1\/agent\//, ''));
      agents.slice(0, 5).forEach((a) => line('       ' + a.email + ' candidates=' + a.candidates + ' uni=' + JSON.stringify(a.university)));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
