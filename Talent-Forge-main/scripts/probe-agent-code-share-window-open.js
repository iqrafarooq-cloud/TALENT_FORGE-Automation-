// Probe: what the APP passes to window.open for each share control, and what the DOM holds.
//
// Read-only. `popup.url()` can only ever report where the browser ENDED UP; wrapping window.open
// reports what the application ASKED for, which is the only way to tell "the app passes no code"
// from "the platform redirected the code away before anything could read it".
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

(async () => {
  const base = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
  const email = process.env.WELCOME_AGENT_EMAIL || process.env.NO_CANDIDATE_AGENT_EMAIL || process.env.AGENT_EMAIL;
  const password = process.env.WELCOME_AGENT_PASSWORD || process.env.NO_CANDIDATE_AGENT_PASSWORD || process.env.AGENT_PASSWORD;

  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Installed before any script on the page runs, so the app's own handler cannot beat it.
  await ctx.addInitScript(() => {
    window.__opened = [];
    const real = window.open;
    window.open = function (...args) {
      window.__opened.push(args.map((a) => (a === undefined ? null : String(a))));
      return real.apply(this, args);
    };
  });
  const page = await ctx.newPage();
  try {
    await page.goto(new URL('/login', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(email);
    await page.locator('input[name="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await page.goto(new URL('/candidates/in-progress', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: /^invite candidate$/i }).first().click();
    await page.waitForTimeout(1200);
    await page.getByText(/share agent code/i).first().click();
    await page.waitForTimeout(1500);

    const dlg = page.locator('[role="dialog"]').last();
    const code = (await dlg.locator('[data-testid="agent-code-text-area"]').first().innerText()).trim();
    line(`agent code: ${JSON.stringify(code)}`);

    line('\n===== the share controls as the DOM holds them =====');
    line(await dlg.evaluate((d) => [...d.querySelectorAll('a, button')]
      .filter((e) => /whatsapp|facebook|linkedin|twitter|^x$/i.test((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')))
      .map((e) => `  ${e.tagName} text=${JSON.stringify((e.innerText || '').trim())} aria=${e.getAttribute('aria-label')} href=${e.getAttribute('href')} target=${e.getAttribute('target')}`)
      .join('\n')));

    for (const name of ['WhatsApp', 'Facebook', 'LinkedIn', 'Twitter']) {
      const btn = dlg.getByRole('button', { name: new RegExp(`^(${name}|X)$`, 'i') }).first();
      if (!(await btn.isVisible().catch(() => false))) { line(`\n### ${name}: no control`); continue; }
      await page.evaluate(() => { window.__opened = []; });
      const popupPromise = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await btn.click();
      const popup = await popupPromise;
      await page.waitForTimeout(500);
      const opened = await page.evaluate(() => window.__opened);
      line(`\n############ ${name} ############`);
      line(`  window.open args: ${JSON.stringify(opened)}`);
      if (opened.length) {
        const asked = opened[0][0] || '';
        line(`  app asked for: ${asked}`);
        line(`  app's url carries the code: ${decodeURIComponent(asked).toUpperCase().includes(code.toUpperCase())}`);
      }
      if (popup) {
        line(`  popup landed on: ${popup.url()}`);
        await popup.close().catch(() => {});
      } else {
        line('  no popup');
      }
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
