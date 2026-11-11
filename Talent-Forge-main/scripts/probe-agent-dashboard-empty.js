// The zero-candidate agent dashboard: the KPI widgets and the empty states behind the welcome
// modal. Read-only.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_EMAIL);
  await page.locator('input[name="password"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
  await page.waitForTimeout(6000);
  await page.keyboard.press('Escape');   // dismiss the welcome modal to read the dashboard behind it
  await page.waitForTimeout(1500);

  line('===== KPI cards: heading + value, structurally =====');
  for (const label of ['Total Candidates', 'Active Candidates', 'Onboarding in Progress', 'Requires Attention']) {
    const host = page.locator(`div:has(> p:text-is("${label}")), div:has(> div > p:text-is("${label}"))`).first();
    const n = await page.locator(`p:text-is("${label}"), h3:text-is("${label}")`).count();
    line(`\n-- ${label}: ${n} matching label node(s)`);
    const h = await host.evaluate((e) => ({ cls: (e.className || '').toString().slice(0, 100), txt: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 200) })).catch((err) => 'ERR ' + err.message);
    line(`   host: ${JSON.stringify(h)}`);
  }

  line('\n===== full dashboard text =====');
  line(await page.locator('main, body').first().innerText());

  line('\n===== the KPI value node next to each label (raw HTML of the card) =====');
  const card = page.locator('p:text-is("Total Candidates")').first();
  line(await card.evaluate((e) => {
    let n = e;
    for (let i = 0; i < 4 && n.parentElement; i++) n = n.parentElement;
    const c = n.cloneNode(true);
    c.querySelectorAll('svg').forEach((s) => s.replaceWith(document.createTextNode('[svg]')));
    return c.outerHTML.slice(0, 3000);
  }));
  await ctx.close(); await browser.close();
})();
