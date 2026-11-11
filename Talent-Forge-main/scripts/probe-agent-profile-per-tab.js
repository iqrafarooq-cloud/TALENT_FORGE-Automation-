// The agent profile as reached from each lifecycle tab: which profile tabs are rendered,
// which one is selected on arrival, and which header actions are offered. Read-only -
// nothing is clicked beyond View.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const AgentProfilePage = require('../pages/AgentProfilePage');
const line = console.log;

const TABS = ['Active', 'Requires Attention', 'Deactivated'];

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

    for (const tab of TABS) {
      await listing.runAndWaitForList(async () => { await listing.goto(tab); });
      await page.waitForTimeout(1000);
      const rows = (await listing.readRows()).filter((r) => r.email);
      line('\n===== from "' + tab + '" =====');
      if (!rows.length) { line('  no rows, skipped'); continue; }
      const agent = rows[0];
      line('  agent   : ' + agent.email + '  (row status "' + agent.status + '")');
      line('  inline  : ' + JSON.stringify(agent.actions));

      const opened = await listing.openAgentProfile(agent.email).then(() => true).catch((e) => e.message);
      if (opened !== true) { line('  >> View could not be opened: ' + opened); continue; }
      await page.waitForTimeout(2000);

      line('  url     : ' + page.url());
      line('  isProfile: ' + await profile.isOnProfile());
      line('  tabs    : ' + JSON.stringify(await profile.tabNames()));
      line('  selected: ' + JSON.stringify(await profile.selectedTab()));
      const header = await profile.readHeader();
      line('  actions : ' + JSON.stringify(header.actions));
      line('  email   : ' + JSON.stringify(header.email) + '  university: ' + JSON.stringify(header.university));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
