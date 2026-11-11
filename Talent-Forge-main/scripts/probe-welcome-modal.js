// probe-welcome-modal.js - is the first-time welcome modal driven by a "first login" flag or by
// the agent having no candidates? Logs in as the zero-candidate fixture and as the ordinary
// agent, and dumps whatever dialog each one lands on.
//
// Read-only: it never clicks the modal's primary action, so nothing is invited.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

const ACCOUNTS = [
  ['REFERRAL_NOPROMO_AGENT (zero candidates)', process.env.REFERRAL_NOPROMO_AGENT_EMAIL, process.env.REFERRAL_NOPROMO_AGENT_PASSWORD],
  ['AGENT (has candidates)', process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD],
  ['TWOFA_AGENT', process.env.TWOFA_AGENT_EMAIL, process.env.TWOFA_AGENT_PASSWORD],
  ['PROMO_FIXED_AGENT', process.env.PROMO_FIXED_AGENT_EMAIL, process.env.PROMO_FIXED_AGENT_PASSWORD],
  ['PROMO_LIMITED_AGENT', process.env.PROMO_LIMITED_AGENT_EMAIL, process.env.PROMO_LIMITED_AGENT_PASSWORD],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [label, email, password] of ACCOUNTS) {
    if (!email) { line(`\n### ${label}: no email in .env, skipped`); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="email"]').first().fill(email);
      await page.locator('input[name="password"]').first().fill(password);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/dashboard|candidates|verifications|activity-log|set-password/, { timeout: 60000, waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(5000);
      line(`\n### ${label} <${email}>  ->  ${page.url()}`);
      const d = page.locator('[role="dialog"]');
      const n = await d.count();
      line(`  dialogs: ${n}`);
      for (let i = 0; i < n; i++) {
        const el = d.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        line(`  dialog[${i}] TEXT: ${JSON.stringify((await el.innerText()).replace(/\n+/g, ' | '))}`);
        line(`  dialog[${i}] HTML: ${(await el.evaluate((e) => e.outerHTML)).slice(0, 3500)}`);
      }
      // KPI widgets, for the empty-state assertions.
      const body = await page.locator('body').innerText().catch(() => '');
      const kpi = body.match(/Total Candidates[\s\S]{0,80}|Active Candidates[\s\S]{0,40}|Onboarding in Progress[\s\S]{0,40}|Requires Attention[\s\S]{0,40}/g);
      line(`  KPI text: ${JSON.stringify(kpi)}`);
    } catch (e) { line(`  ERR ${e.message}`); }
    finally { await ctx.close(); }
  }
  await browser.close();
})();
