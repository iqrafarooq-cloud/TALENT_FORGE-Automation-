require('dotenv').config();
const { chromium } = require('playwright');
const EMAIL = process.env.AGENT_EMAIL, PASSWORD = process.env.AGENT_PASSWORD;
const line = console.log;

async function dumpButtons(page, label) {
  line(`\n===== buttons: ${label} (${page.url()}) =====`);
  const b = page.locator('button, [role="button"]');
  const n = await b.count();
  for (let i = 0; i < n; i++) {
    const el = b.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const txt = (await el.innerText().catch(() => '')).trim().replace(/\n/g, ' / ');
    const aria = await el.getAttribute('aria-label').catch(() => null);
    if (!txt && !aria) continue;
    line(`  [${i}] ${JSON.stringify(txt.slice(0, 70))} aria=${JSON.stringify(aria)}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);

    for (const path of ['/candidates', '/getting-started', '/candidates?tab=in-progress']) {
      await page.goto(new URL(path, process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3000);
      await dumpButtons(page, path);
      line(`--- text ---\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 1200)}`);
    }
  } catch (e) { line('ERR ' + e.message); }
  finally { await ctx.close(); await browser.close(); }
})();
