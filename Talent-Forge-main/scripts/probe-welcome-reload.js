// Does the modal survive a reload when it was NEVER dismissed? That separates "the dismissal is
// remembered" from "a reload simply never shows it" - the app re-authenticates a reload with
// POST /auth/token/refresh/ rather than POST /auth/token/.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const auth = [];
  page.on('request', (r) => { if (/auth\/token/.test(r.url())) auth.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  const modal = () => page.locator('[role="dialog"]').filter({ hasText: /Welcome,/ }).first();
  const up = async (ms = 15000) => { try { await modal().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };

  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(process.env.PROMO_LIMITED_AGENT_EMAIL);
  await page.locator('input[name="password"]').first().fill(process.env.PROMO_LIMITED_AGENT_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
  line(`1. first login: modal up = ${await up()}   auth calls: ${JSON.stringify(auth)}`);

  auth.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  line(`2. reload WITHOUT dismissing: modal up = ${await up()}   auth calls: ${JSON.stringify(auth)}`);
  await ctx.close(); await browser.close();
})();
