/* eslint-disable no-console */
// probe-agent-profile-candidates-tab-3.js - READ-ONLY. Two questions the first two probes left:
//   1. the exact characters of a Last Activity cell beside the server's last_login
//   2. what Reactivate from an INACTIVE row's menu opens (the dialog is cancelled)
// Run:  node scripts/probe-agent-profile-candidates-tab-3.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const codes = (s) => Array.from(String(s)).map((ch) => ch.charCodeAt(0).toString(16)).join(' ');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let payload = null;
  page.on('response', async (r) => {
    if (/\/agent\/\d+\/candidates\/\?page=\d+&page_size=10/.test(r.url())) payload = await r.json().catch(() => null);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates)/, { timeout: 90000 });

  await page.goto(`${ORIGIN}/agents/view/1220?tab=candidates`);
  await page.waitForTimeout(7000);
  const cell = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('main [role="row"]')).find((r) => !r.querySelector('[role="columnheader"]'));
    return { innerText: row.children[6].innerText, textContent: row.children[6].textContent };
  });
  console.log('cell innerText  :', JSON.stringify(cell.innerText), codes(cell.innerText));
  console.log('cell textContent:', JSON.stringify(cell.textContent), codes(cell.textContent));
  const ll = payload && payload.results[0].last_login;
  console.log('server last_login:', JSON.stringify(ll), codes(ll));

  await page.goto(`${ORIGIN}/agents/view/1?tab=candidates`);
  await page.waitForTimeout(7000);
  await page.locator('main input[type="search"]').fill('abdul.musawwir+12221@bytecorp.io');
  await page.waitForTimeout(4000);
  const row = page.locator('main [role="row"]').filter({ hasText: 'abdul.musawwir+12221@bytecorp.io' }).first();
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(800);
  await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /^\s*Reactivate\s*$/ }).first().click();
  await page.waitForTimeout(2500);
  console.log(await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
    .map((d) => ({ role: d.getAttribute('role'), text: (d.innerText || '').replace(/\s+/g, ' ').trim(), buttons: Array.from(d.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.innerText.trim()) }))));
  await page.getByRole('button', { name: /^cancel$/i }).last().click().catch(() => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
