// Where does the agent profile's Back control land, per originating tab?
// Read-only: opens a profile and comes straight back, changing nothing.
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
      const from = { url: page.url(), selected: await listing.selectedTab() };
      const rows = (await listing.readRows()).filter((r) => r.email);
      if (!rows.length) { line(`\n=== ${tab}: no rows, skipped ===`); continue; }

line(`
=== came from "${tab}" ===`);
      line(`  listing before : ${from.url}   (selected "${from.selected}")`);
      await listing.openAgentProfile(rows[0].email);
      await page.waitForTimeout(1500);
const onProfile = { url: page.url(), isProfile: await profile.isOnProfile() };
      line(`  profile        : ${onProfile.url}  isProfile=${onProfile.isProfile}`);
      const backCtl = await page.evaluate(() => Array.from(document.querySelectorAll("button, a, [role=button]")).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>((e.getAttribute("aria-label")||"")+"|"+(e.innerText||"").replace(/s+/g," ").trim()).slice(0,40)).filter(t=>/back|arrow|←/i.test(t)));
      line(`  back-ish ctrls : ${JSON.stringify(backCtl)}`);

      await profile.clickBack();
      await page.waitForTimeout(2000);
      const back = { url: page.url(), selected: await listing.selectedTab(), onListing: await listing.isOnListing() };

      line(`\n=== came from "${tab}" ===`);
      line(`  listing before : ${from.url}   (selected "${from.selected}")`);
      line(`  profile        : ${onProfile.url}  isProfile=${onProfile.isProfile}`);
      line(`  after Back     : ${back.url}   (selected "${back.selected}")  onListing=${back.onListing}`);
      line(`  >> Back preserved the originating tab: ${back.selected.toLowerCase() === tab.toLowerCase()}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
