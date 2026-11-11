require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

async function dump(page, label, { html = 4000 } = {}) {
  line(`\n############ ${label} ############`);
  const d = page.locator('[role="dialog"]');
  const n = await d.count();
  line(`dialogs: ${n}`);
  for (let i = 0; i < n; i++) {
    const el = d.nth(i);
    const vis = await el.isVisible().catch(() => false);
    line(`\n-- dialog[${i}] visible=${vis}`);
    if (!vis) continue;
    line(`   TEXT: ${JSON.stringify((await el.innerText().catch(() => '')).replace(/\n/g, ' | '))}`);
    // Every button inside, with its aria-label and svg presence.
    const b = el.locator('button, [role="button"]');
    const bn = await b.count();
    for (let j = 0; j < bn; j++) {
      const bb = b.nth(j);
      if (!(await bb.isVisible().catch(() => false))) continue;
      const info = await bb.evaluate((e) => ({
        text: (e.innerText || '').trim(),
        aria: e.getAttribute('aria-label'),
        cls: (e.className || '').toString().slice(0, 90),
        svgs: e.querySelectorAll('svg').length,
        imgs: [...e.querySelectorAll('img')].map((i) => i.getAttribute('alt') || i.getAttribute('src')),
      }));
      line(`   button[${j}] ${JSON.stringify(info)}`);
    }
    if (html) line(`   HTML:\n${(await el.evaluate((e) => e.outerHTML)).slice(0, html)}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[name="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await page.goto(new URL('/candidates/in-progress', process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.getByRole('button', { name: /^invite candidate$/i }).first().click();
    await page.waitForTimeout(1500);
    await dump(page, 'after clicking "Invite Candidate"', { html: 7000 });

    // The chooser's cards / links
    line('\n===== chooser: clickable descendants with text =====');
    const dlg = page.locator('[role="dialog"]').first();
    const all = dlg.locator('*');
    const cnt = await all.count();
    for (let i = 0; i < cnt; i++) {
      const el = all.nth(i);
      const info = await el.evaluate((e) => ({
        tag: e.tagName, cls: (e.className || '').toString().slice(0, 80),
        txt: (e.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 70),
        cursor: getComputedStyle(e).cursor, role: e.getAttribute('role'),
      })).catch(() => null);
      if (info && info.cursor === 'pointer' && info.txt) line(`  [${i}] ${JSON.stringify(info)}`);
    }

    // Share Agent Code
    await page.getByText(/share agent code/i).first().click();
    await page.waitForTimeout(1500);
    await dump(page, 'after clicking "Share Agent Code"', { html: 8000 });
    line(`\nclipboard-before: ${JSON.stringify(await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR ' + e.message))}`);
    const copy = page.locator('[role="dialog"]').first().getByRole('button', { name: /copy code|copied/i }).first();
    if (await copy.isVisible().catch(() => false)) {
      await copy.click();
      await page.waitForTimeout(800);
      line(`copy label after click: ${JSON.stringify(await copy.innerText().catch(() => ''))}`);
      line(`clipboard-after: ${JSON.stringify(await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR ' + e.message))}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
