// Does the header avatar -> Log out path work on the agent dashboard, and does the welcome modal
// overlay block it? The welcome/onboarding scenarios sign out and back in, and their evidence
// showed the menu path falling back to clearing cookies on every run.
require('dotenv').config();
const { chromium } = require('playwright');
const DashboardPage = require('../pages/DashboardPage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [label, withModal] of [['welcome modal left UP', true], ['welcome modal dismissed', false]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="email"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_EMAIL);
      await page.locator('input[name="password"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
      await page.locator('[role="dialog"]').filter({ hasText: /Everything starts with onboarding/ }).first()
        .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      if (!withModal) { await page.keyboard.press('Escape'); await page.waitForTimeout(1500); }

      line(`\n### ${label}`);
      const d = new DashboardPage(page);
      line(`  profileMenuTrigger count=${await d.profileMenuTrigger.count()} visible=${await d.profileMenuTrigger.isVisible().catch(() => 'err')}`);
      try {
        await d.openProfileMenu();
        line('  openProfileMenu: OK');
        await d.clickLogout();
        await page.waitForURL(/login/, { timeout: 30000, waitUntil: 'commit' });
        line(`  logout OK -> ${page.url()}`);
      } catch (e) {
        line(`  FAILED: ${e.message.split('\n')[0]}`);
        // What header buttons exist, so the right locator is measurable rather than guessed.
        const hb = page.locator('header button, nav button, button[aria-haspopup]');
        for (let i = 0; i < await hb.count(); i++) {
          const b = hb.nth(i);
          if (!(await b.isVisible().catch(() => false))) continue;
          line('   ' + JSON.stringify(await b.evaluate((e2) => ({
            text: (e2.innerText || '').trim().slice(0, 24), aria: e2.getAttribute('aria-label'),
            haspopup: e2.getAttribute('aria-haspopup'), cls: (e2.className || '').toString().slice(0, 60),
          }))));
        }
      }
    } catch (e) { line('ERR ' + e.message); }
    finally { await ctx.close(); }
  }
  await browser.close();
})();
