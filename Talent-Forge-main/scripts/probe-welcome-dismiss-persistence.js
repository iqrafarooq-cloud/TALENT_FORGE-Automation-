// Decisive: does DISMISSING the welcome modal survive a reload, and if so what records it?
// Runs the same sequence twice on two agents, logging every API request throughout.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

async function run(browser, label, email, password, dismissBy) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const api = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/dev-api\.talentforge/.test(u)) api.push(`${r.method()} ${u.replace(/^https?:\/\/[^/]+/, '')} ${(r.postData() || '').slice(0, 150)}`);
  });
  const modal = () => page.locator('[role="dialog"]').filter({ hasText: /Welcome,/ }).first();
  const up = async (ms) => { try { await modal().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };

  line(`\n######## ${label} (dismiss by ${dismissBy}) ########`);
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
  line(`  A. after login:            modal up = ${await up(20000)}`);

  api.length = 0;
  if (dismissBy === 'escape') await page.keyboard.press('Escape');
  else await page.mouse.click(6, 6);
  await page.waitForTimeout(4000);
  line(`  B. after dismissal:        modal up = ${await up(2500)}`);
  line(`     API calls in the 4s after the dismissal: ${JSON.stringify(api, null, 1)}`);
  line(`     localStorage: ${JSON.stringify(await page.evaluate(() => ({ ...localStorage })))}`);
  line(`     sessionStorage: ${JSON.stringify(await page.evaluate(() => ({ ...sessionStorage })))}`);

  api.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  line(`  C. after reload:           modal up = ${await up(20000)}`);
  line(`     API calls during the reload: ${JSON.stringify(api.slice(0, 12), null, 1)}`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await run(browser, 'PROMO_LIMITED', process.env.PROMO_LIMITED_AGENT_EMAIL, process.env.PROMO_LIMITED_AGENT_PASSWORD, 'escape');
  await run(browser, 'PROMO_FIXED', process.env.PROMO_FIXED_AGENT_EMAIL, process.env.PROMO_FIXED_AGENT_PASSWORD, 'outside-click');
  await browser.close();
})();
