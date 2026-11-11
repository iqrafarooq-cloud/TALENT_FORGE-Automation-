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
    for (const tab of ['Active', 'Requires Attention', 'Deactivated']) {
      await listing.runAndWaitForList(async () => { await listing.goto(tab); });
      const row = (await listing.readRows()).filter((r) => r.email)[0];
      await listing.openAgentProfile(row.email);
      await page.waitForTimeout(2000);
      console.log('\n===== profile reached from "' + tab + '" : ' + page.url() + ' =====');
      const all = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, a, [role="button"]'))
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            label: ((e.getAttribute('aria-label') || '') || (e.innerText || '')).replace(/\s+/g, ' ').trim(),
          }))
          .filter((e) => e.label));
      console.log('  all visible controls: ' + JSON.stringify(all.map((a) => a.tag + ':' + a.label)));
      const header = await profile.readHeader();
      console.log('  readHeader().actions: ' + JSON.stringify(header.actions));
      console.log('  readHeader() keys   : ' + JSON.stringify(Object.keys(header)));
      const opener = page.getByRole('button', { name: /^open menu$/i }).first();
      if (await opener.count()) {
        await opener.click();
        await page.waitForTimeout(1200);
        const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => ({ key: e.getAttribute('data-key'), label: (e.textContent||'').replace(/s+/g,' ').trim() })));
        console.log('  OVERFLOW MENU       : ' + JSON.stringify(items));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else { console.log('  OVERFLOW MENU       : (no Open menu control)'); }
    }
  } catch (e) { console.log('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
