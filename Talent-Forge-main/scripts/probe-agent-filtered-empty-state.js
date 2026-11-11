// The Agents listing's FILTERED empty state: what does it actually render, and where does
// its Clear CTA live relative to the heading? Read-only; the filter is cleared on the way out.
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
    // Drive it straight through the URL - same state the scenario reaches via the modal.
    await listing.runAndWaitForList(async () => {
      await page.goto(listing.url + '?candidateCount=0&targetProgress=76-100');
    });
    await page.waitForTimeout(2000);
    line('url: ' + page.url());
    line('readEmptyState(): ' + JSON.stringify(await listing.readEmptyState(), null, 1));

    line('\n--- the heading and its ancestry ---');
    line(await page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const h = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
        .filter((x) => !x.closest('[role="dialog"],[role="listbox"],[data-radix-popper-content-wrapper]'))
        .find((x) => /no results|not found/i.test(x.innerText || ''));
      if (!h) return 'NO HEADING FOUND';
      const out = [];
      let n = h;
      for (let i = 0; i < 6 && n; i += 1, n = n.parentElement) {
        const ctas = Array.from(n.querySelectorAll('button,a')).map((b) => c(b.innerText)).filter(Boolean);
        out.push('  level ' + i + ' <' + n.tagName.toLowerCase() + '> ctas=' + JSON.stringify(ctas)
          + '  text=' + JSON.stringify(c(n.innerText).slice(0, 120)));
      }
      return out.join('\n');
    }));

    line('\n--- every visible control on the page ---');
    line(JSON.stringify(await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,a'))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map((e) => e.tagName.toLowerCase() + ':' + ((e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim()))
        .filter((t) => t.split(':')[1])), null, 1));
    await page.screenshot({ path: 'reports/probe-agent-filtered-empty-state.png', fullPage: true });
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
