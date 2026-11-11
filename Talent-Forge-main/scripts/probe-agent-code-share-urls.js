// Probe: the FULL redirect chain of each agent-code share popup.
//
// Read-only. Nothing is invited, nothing is saved.
//
// Why this exists: `CandidateOnboardingPage.share()` clicked a platform, waited a fixed 1500ms
// and read ONE url. Every one of these platforms answers the share URL with a redirect to its
// own login page, so a single read after a fixed delay can land on either side of that redirect
// and the two say completely different things. This prints, per platform, the popup's url at
// creation, EVERY main-frame navigation with its timestamp, and whether each one carries the
// agent code - so "the app does not pass the code" and "the suite read the url too late" are
// finally distinguishable.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

const PLATFORMS = ['WhatsApp', 'Facebook', 'LinkedIn', 'Twitter'];

function decodeDeep(u) {
  let d = u;
  for (let i = 0; i < 4; i++) {
    let next;
    try { next = decodeURIComponent(d); } catch { break; }
    if (next === d) break;
    d = next;
  }
  return d;
}

(async () => {
  const base = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
  const email = process.env.WELCOME_AGENT_EMAIL || process.env.NO_CANDIDATE_AGENT_EMAIL || process.env.AGENT_EMAIL;
  const password = process.env.WELCOME_AGENT_PASSWORD || process.env.NO_CANDIDATE_AGENT_PASSWORD || process.env.AGENT_PASSWORD;
  line(`agent: ${email}`);

  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

    for (const name of PLATFORMS) {
      const btn = dlg.getByRole('button', { name: new RegExp(`^(${name}|X)$`, 'i') }).first();
      if (!(await btn.isVisible().catch(() => false))) { line(`\n### ${name}: no control`); continue; }

      const t0 = Date.now();
      const chain = [];
      const popupPromise = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await btn.click();
      const popup = await popupPromise;
      line(`\n############ ${name} ############`);
      if (!popup) { line('  no popup opened'); continue; }

      chain.push({ at: Date.now() - t0, how: 'popup.url() at creation', url: popup.url() });
      popup.on('framenavigated', (f) => {
        if (f === popup.mainFrame()) chain.push({ at: Date.now() - t0, how: 'framenavigated', url: f.url() });
      });
      popup.on('request', (r) => {
        if (r.isNavigationRequest() && r.frame() === popup.mainFrame()) {
          chain.push({ at: Date.now() - t0, how: `nav request (${r.method()})`, url: r.url() });
        }
      });
      for (const ms of [1500, 3000, 6000]) {
        await popup.waitForTimeout(ms === 1500 ? 1500 : 1500);
        chain.push({ at: Date.now() - t0, how: `popup.url() @~${ms}ms`, url: popup.url() });
      }
      await popup.close().catch(() => {});

      for (const step of chain) {
        const dec = decodeDeep(step.url);
        const carries = !!code && dec.toUpperCase().includes(code.toUpperCase());
        line(`  +${String(step.at).padStart(5)}ms ${carries ? 'CODE  ' : '      '} ${step.how}`);
        line(`          ${step.url.slice(0, 220)}`);
        if (dec !== step.url) line(`  decoded ${dec.slice(0, 220)}`);
      }
      const anyCarried = chain.some((s) => decodeDeep(s.url).toUpperCase().includes(code.toUpperCase()));
      line(`  => code appeared anywhere in the chain: ${anyCarried}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
