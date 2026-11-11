// What IS the agent profile's Back control? Read-only.
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
    const row = (await listing.readRows()).filter((r) => r.email)[0];
    await listing.openAgentProfile(row.email);
    await page.waitForTimeout(1800);
    console.log('profile url:', page.url());
    console.log(JSON.stringify(await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((e) => /^back$/i.test((e.innerText || '').trim()) && e.children.length <= 2)
        .map((e) => ({
          tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), href: e.getAttribute('href'),
          ariaLabel: e.getAttribute('aria-label'), testid: e.getAttribute('data-testid'),
          cls: (e.className || '').toString().slice(0, 70),
          html: e.outerHTML.slice(0, 260),
        })))
    , null, 2));
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
