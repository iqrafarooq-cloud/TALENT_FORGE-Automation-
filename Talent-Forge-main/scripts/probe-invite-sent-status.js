// The exact Status / Status Detail strings the In Progress list renders for a candidate who has
// been INVITED but has not signed up yet. candidate_onboarding_e2e.feature asserts
// "Invite Sent" / "Awaiting Sign-up" and those strings have never been verified. Read-only.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    const ip = new InProgressCandidatePage(page);
    ip.install();
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await ip.navigate();
    await page.waitForTimeout(2500);

    for (const tab of ['Invite Sent', 'Onboarding Incomplete']) {
      await ip.clickQuickFilter(tab);
      await page.waitForTimeout(3500);
      const rows = await ip.readRows();
      const api = ip.lastRows();
      line(`\n===== quick filter "${tab}" =====`);
      line(`  rendered rows: ${rows.length}`);
      const details = new Map();
      for (const r of rows) details.set(`${r.status} || ${r.statusDetail}`, (details.get(`${r.status} || ${r.statusDetail}`) || 0) + 1);
      line('  distinct Status || Status Detail on this page:');
      for (const [k, n] of details) line(`    ${n}x  ${JSON.stringify(k)}`);
      line(`  API status/status_detail: ${JSON.stringify([...new Set((api || []).map((r) => `${r.status} || ${r.status_detail}`))], null, 1)}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
