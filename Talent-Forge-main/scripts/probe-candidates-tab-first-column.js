require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const AgentProfilePage = require('../pages/AgentProfilePage');
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
    const profile = new AgentProfilePage(page);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
    const filtered = await listing.runAndWaitForList(async () => {
      await page.goto(listing.url + '?candidateCount=' + encodeURIComponent('1-50'));
    });
    const pick = AgentsListingPage.agentsFrom(filtered.payload).filter((a) => Number(a.candidates) >= 1)[0];
    await listing.openAgentProfile(pick.email);
    await page.waitForTimeout(1500);
    await profile.openTab('Candidates');
    await page.waitForTimeout(2500);
    console.log(JSON.stringify(await page.evaluate(() => {
      const hdrs = Array.from(document.querySelectorAll('[role="columnheader"]'));
      const firstRow = Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))[0];
      return {
        header0: hdrs[0] ? hdrs[0].outerHTML.slice(0, 300) : null,
        rowCellCount: firstRow ? firstRow.children.length : null,
        rowFirstCell: firstRow && firstRow.children[0] ? firstRow.children[0].outerHTML.slice(0, 300) : null,
        rowHasCheckbox: firstRow ? firstRow.querySelectorAll('input[type=checkbox],[role=checkbox]').length : null,
      };
    }), null, 2));
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
