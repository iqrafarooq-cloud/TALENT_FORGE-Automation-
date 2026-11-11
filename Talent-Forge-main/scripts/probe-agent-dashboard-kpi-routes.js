// Probe: the agent dashboard's KPI widgets and where each one routes.
//
// Read-only - it navigates and goes back, and creates nothing.
//
// Three questions it answers, which cannot be answered by reading the DOM alone:
//   1. which KPI widgets the build actually renders (the story names are not all of them)
//   2. whether each widget is a control at all, or just a figure
//   3. the url each one lands on, which is the only definition of "routes to its destination"
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

(async () => {
  const base = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(new URL('/login', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[name="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates|getting-started/, { timeout: 60000, waitUntil: 'commit' });
    await page.goto(new URL('/dashboard', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    // Every label/figure pair on the page, structurally: a node whose next sibling holds a number.
    line('===== label/figure pairs (the KPI shape) =====');
    const pairs = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('p, h1, h2, h3, h4, span, div')) {
        const txt = (el.textContent || '').trim();
        if (!txt || txt.length > 40 || el.children.length) continue;
        const next = el.nextElementSibling;
        const raw = next ? (next.textContent || '').trim() : null;
        if (raw === null || !/^-?[\d,]+$/.test(raw)) continue;
        // Walk out to the clickable host, if any.
        let host = el, hops = 0, clickable = null;
        while (host && hops < 8) {
          const cs = getComputedStyle(host);
          if (cs.cursor === 'pointer' || host.tagName === 'A' || host.tagName === 'BUTTON'
              || host.getAttribute('role') === 'button' || host.onclick) {
            clickable = { tag: host.tagName, hops, role: host.getAttribute('role'),
                          href: host.getAttribute('href'), cursor: cs.cursor,
                          testid: host.getAttribute('data-testid') };
            break;
          }
          host = host.parentElement; hops++;
        }
        out.push({ label: txt, value: raw, clickable });
      }
      return out;
    });
    for (const p of pairs) line(`  ${JSON.stringify(p)}`);

    // Now click each one and see where it goes.
    line('\n===== where each KPI routes =====');
    for (const { label } of pairs) {
      await page.goto(new URL('/dashboard', base).href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const before = page.url();
      // The KPI is the label whose sibling holds a number - the same structural rule readKpi uses.
      const handle = await page.evaluateHandle((wanted) => {
        for (const el of document.querySelectorAll('p, h1, h2, h3, h4, span, div')) {
          if ((el.textContent || '').trim() !== wanted || el.children.length) continue;
          const next = el.nextElementSibling;
          if (!next || !/^-?[\d,]+$/.test((next.textContent || '').trim())) continue;
          return el;
        }
        return null;
      }, label);
      const el = handle.asElement();
      if (!el) { line(`  ${label}: not found on re-read`); continue; }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 5000 }).catch((e) => line(`  ${label}: click failed - ${e.message.split('\n')[0]}`));
      await page.waitForTimeout(2500);
      line(`  ${label.padEnd(24)} ${before === page.url() ? 'DID NOT NAVIGATE' : '-> ' + page.url()}`);
    }

    line('\n===== the routes those destinations would mean =====');
    for (const path of ['/candidates', '/candidates/active', '/candidates/in-progress', '/verifications']) {
      await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      line(`  ${path.padEnd(26)} -> ${page.url()}  heading=${JSON.stringify((await page.locator('h1, h2').first().innerText().catch(() => '')).trim())}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
