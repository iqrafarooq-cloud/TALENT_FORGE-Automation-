// Is the same-group union really a UNION? Compares each option's own count against the
// count when both are selected, and cross-checks against the unfiltered total. Read-only.
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

    const countFor = async (qs) => {
      const res = await listing.runAndWaitForList(async () => { await page.goto(listing.url + qs); });
      return { count: res.payload && res.payload.count, url: String(res.requestUrl).replace(/^https?:\/\/[^/]+\/core\/api\/v1\/agent\//, '') };
    };

    const all   = await countFor('');
    const zero  = await countFor('?candidateCount=0');
    const one50 = await countFor('?candidateCount=1-50');
    const both  = await countFor('?candidateCount=0&candidateCount=1-50');
    const c51   = await countFor('?candidateCount=51-100');
    const c100  = await countFor('?candidateCount=100%2B');

    line('unfiltered        : ' + all.count);
    line('candidateCount=0  : ' + zero.count + '   ' + zero.url);
    line('candidateCount=1-50: ' + one50.count + '  ' + one50.url);
    line('BOTH selected     : ' + both.count + '  ' + both.url);
    line('candidateCount=51-100: ' + c51.count);
    line('candidateCount=100+  : ' + c100.count);
    line('');
    line('union check : ' + zero.count + ' + ' + one50.count + ' = ' + (zero.count + one50.count)
      + '  vs both=' + both.count + '   -> ' + ((zero.count + one50.count) === both.count ? 'MATCH' : 'MISMATCH'));
    const sumAll = zero.count + one50.count + c51.count + c100.count;
    line('all buckets : ' + sumAll + ' vs unfiltered ' + all.count
      + '   -> ' + (sumAll === all.count ? 'MATCH (buckets partition the list)' : 'MISMATCH'));
    line('');
    line('Is the union assertion meaningful? both(' + both.count + ') differs from each part ('
      + zero.count + ', ' + one50.count + ') and from the total (' + all.count + '): '
      + (both.count !== zero.count && both.count !== one50.count && both.count !== all.count ? 'YES' : 'NO - it could pass trivially'));
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
