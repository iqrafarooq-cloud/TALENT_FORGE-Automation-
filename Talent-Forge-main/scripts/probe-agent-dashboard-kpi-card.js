// Probe: is a dashboard KPI widget a CONTROL at all?
//
// Read-only. Clicking the label alone is not evidence: a React onClick sits on an ancestor and a
// computed `cursor` is not proof either way. So this dumps the whole card - its ancestor chain,
// its outerHTML, every anchor/button inside it - and then clicks the CARD's own centre, which is
// what a user clicks. "The widget does not route" and "the suite clicked the wrong node" are
// completely different findings and only this can tell them apart.
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

    for (const label of ['Total Candidates', 'Active Candidates', 'Onboarding in Progress', 'Requires Attention']) {
      await page.goto(new URL('/dashboard', base).href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      line(`\n############ ${label} ############`);
      const info = await page.evaluate((wanted) => {
        let node = null;
        for (const el of document.querySelectorAll('p, h1, h2, h3, h4, span, div')) {
          if ((el.textContent || '').trim() !== wanted || el.children.length) continue;
          const next = el.nextElementSibling;
          if (next && /^-?[\d,]+$/.test((next.textContent || '').trim())) { node = el; break; }
        }
        if (!node) return { found: false };
        const chain = [];
        let host = node;
        for (let i = 0; i < 7 && host; i++) {
          const cs = getComputedStyle(host);
          chain.push({
            hop: i, tag: host.tagName, role: host.getAttribute('role'),
            testid: host.getAttribute('data-testid'), href: host.getAttribute('href'),
            tabindex: host.getAttribute('tabindex'), cursor: cs.cursor,
            reactProps: Object.keys(host).filter((k) => k.startsWith('__react')).length > 0,
            hasOnClickProp: (() => {
              const k = Object.keys(host).find((x) => x.startsWith('__reactProps'));
              return k ? typeof host[k].onClick === 'function' : null;
            })(),
            cls: (host.className || '').toString().slice(0, 70),
          });
          host = host.parentElement;
        }
        // The card: the nearest ancestor that holds the label, the figure and nothing else's label.
        let card = node.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          const t = (card.textContent || '').trim();
          if (t.length > 60) break;
          card = card.parentElement;
        }
        const cardEl = node.closest('[class*="card" i]') || node.parentElement?.parentElement;
        return {
          found: true, chain,
          cardHtml: cardEl ? cardEl.outerHTML.slice(0, 900) : null,
          linksInCard: cardEl ? [...cardEl.querySelectorAll('a, button, [role="button"]')]
            .map((e) => ({ tag: e.tagName, txt: (e.innerText || '').trim().slice(0, 40), href: e.getAttribute('href') })) : [],
        };
      }, label);
      if (!info.found) { line('  label not found'); continue; }
      for (const c of info.chain) line(`  hop${c.hop} ${JSON.stringify(c)}`);
      line(`  controls inside the card: ${JSON.stringify(info.linksInCard)}`);
      line(`  CARD HTML: ${info.cardHtml}`);

      // Click the card's centre, the way a user would.
      const before = page.url();
      const card = page.locator('div').filter({ hasText: new RegExp('^' + label + '\\d') }).last();
      const n = await card.count().catch(() => 0);
      if (n) {
        await card.click({ timeout: 5000 }).catch((e) => line(`  card click failed: ${e.message.split('\n')[0]}`));
        await page.waitForTimeout(2500);
      }
      line(`  clicking the CARD: ${before === page.url() ? 'DID NOT NAVIGATE' : '-> ' + page.url()}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
