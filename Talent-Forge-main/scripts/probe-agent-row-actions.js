// What row actions does EACH lifecycle tab really offer — inline buttons AND whatever the
// three-dot overflow menu holds? Read-only: every menu is opened and dismissed with Escape,
// nothing is clicked inside one.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

const TABS = ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated'];

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
    for (const tab of TABS) {
      await listing.runAndWaitForList(async () => { await listing.goto(tab); });
      await page.waitForTimeout(1200);
      const columns = (await listing.columnHeaders()).map((c) => c.trim()).filter(Boolean);
      const rows = (await listing.readRows()).filter((r) => r.email);
      line(`\n===== ${tab} (${page.url()}) =====`);
      line(`  columns : ${JSON.stringify(columns)}`);
      line(`  rows    : ${rows.length}`);
      if (!rows.length) { line('  (no rows — actions unverifiable)'); continue; }
      line(`  inline  : ${JSON.stringify(rows[0].actions)}  on ${rows[0].email}`);

      // Open whatever overflow control the row offers and dump the menu.
      const trigger = rows[0].actions.find((a) => /open menu|more|options|â‹®|\.\.\./i.test(a));
      if (!trigger) { line('  menu    : (no overflow trigger on this row)'); continue; }
      const rowLoc = listing.rowLocator(rows[0].email);
      await rowLoc.getByRole('button', { name: new RegExp(`^${trigger}$`, 'i') }).first().click();
      await page.waitForTimeout(900);
      const dump = await page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [role="dialog"]'));
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          hostCount: hosts.length,
          hosts: hosts.filter(visible).map((h) => ({
            role: h.getAttribute('role'), cls: (h.className||'').toString().slice(0,80),
            html: h.outerHTML.slice(0, 900),
          })),
          floating: Array.from(document.querySelectorAll('body > div'))
            .filter((d) => visible(d) && /fixed|absolute/.test(getComputedStyle(d).position))
            .map((d) => (d.innerText||'').replace(/s+/g,' ').trim()).filter(Boolean).slice(0,6),
        };
      });
      const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => ({ key: e.getAttribute('data-key'), role: e.getAttribute('role'), innerText: JSON.stringify(e.innerText||''), textContent: JSON.stringify(e.textContent||''), ariaLabel: e.getAttribute('aria-label'), spans: Array.from(e.querySelectorAll('*')).map((n)=>n.tagName.toLowerCase()+':'+JSON.stringify((n.textContent||''))).slice(0,6) })));
      line(`  trigger : ${JSON.stringify(trigger)}`);
      line(`  MENU ITEMS: ${JSON.stringify(items)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
