require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
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
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
    await listing.openFilters();
    await listing.openUniversitySuggestions();

    const dump = async (label) => {
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="option"]')).map((o) => ({
          text: (o.innerText || '').replace(/\s+/g, ' ').trim(),
          dataKey: o.getAttribute('data-key'),
          ariaDisabled: o.getAttribute('aria-disabled'),
          ariaSelected: o.getAttribute('aria-selected'),
          id: o.getAttribute('id'),
          html: o.outerHTML.slice(0, 200),
        })));
      console.log('\n=== ' + label + ' (' + opts.length + ') ===');
      opts.slice(0, 3).forEach((o) => console.log('  ' + JSON.stringify(o, null, 1).replace(/\n/g, ' ')));
    };

    await listing.typeUniversity('King');
    await dump('after "King"');
    await listing.typeUniversity('ZZZZNOSUCHUNIVERSITY');
    await dump('after "ZZZZNOSUCHUNIVERSITY"');
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
