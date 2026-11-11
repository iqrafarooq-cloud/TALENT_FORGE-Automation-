// Does the Candidate Count x Target Progress combination genuinely match no agent, or is a
// filter broken? Applies each alone and then together, and reports the server's own counts.
// Read-only.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

const CASES = [
  ['no filter',                      ''],
  ['candidateCount=1-50',            '?candidateCount=1-50'],
  ['targetProgress=76-100',          '?targetProgress=76-100'],
  ['both',                           '?candidateCount=1-50&targetProgress=76-100'],
  ['candidateCount=0',               '?candidateCount=0'],
  ['targetProgress=0-25',            '?targetProgress=0-25'],
  ['targetProgress=26-50',           '?targetProgress=26-50'],
  ['targetProgress=51-75',           '?targetProgress=51-75'],
];

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
    for (const [label, qs] of CASES) {
      const res = await listing.runAndWaitForList(async () => {
        await page.goto(listing.url + qs);
      });
      const agents = AgentsListingPage.agentsFrom(res.payload);
      const count = res.payload && res.payload.count;
      line('\n' + label.padEnd(26) + ' -> count=' + String(count).padEnd(6) + ' returned=' + agents.length);
      line('   request: ' + String(res.requestUrl).replace(/^https?:\/\/[^/]+/, ''));
      agents.slice(0, 5).forEach((a) =>
        line('     ' + a.email.padEnd(46) + ' candidates=' + String(a.candidates).padEnd(4) + ' progress=' + a.progress));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
