// probe-promo-agent-stored-email.js — READ ONLY. What email address does the APP hold for each
// promo agent, and does it match .env?
//
//   node scripts/probe-promo-agent-stored-email.js
//
// Why: the promo disabled/resumed mails ARE being sent (69 and 72 on record, newest today), but
// none reached PROMO_LIMITED_AGENT_EMAIL. A subject wait cannot tell "not sent" from "sent to a
// different address", and today's mails went to iqra.farooq+21@ and to the fixed agent's address
// with a trailing character that .env does not have. So compare the two directly.
//
// READ ONLY: opens the agents list and reads. Changes nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const PREFIXES = ['PROMO_UNLIMITED_AGENT', 'PROMO_LIMITED_AGENT', 'PROMO_FIXED_AGENT'];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, { timeout: 90000, waitUntil: 'commit' });

  const admin = new AdminPromoToolsPage(page);
  for (const prefix of PREFIXES) {
    const envEmail = process.env[`${prefix}_EMAIL`];
    console.log(`\n--- ${prefix} ---`);
    console.log(`  .env email   ${JSON.stringify(envEmail)}`);
    // Address by EMAIL so the row cannot be an ambiguous name match, then read the profile back.
    await admin.openPromoTools(envEmail).catch((e) => console.log(`  open failed: ${e.message.split('\n')[0]}`));
    const url = page.url();
    const body = await page.locator('body').innerText().catch(() => '');
    const found = [...new Set(body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])]
      .filter((a) => !/talentforge\.com\.sa$/i.test(a));
    console.log(`  profile url  ${url}`);
    console.log(`  addresses on the profile: ${JSON.stringify(found)}`);
    console.log(`  exact .env match present: ${found.some((a) => a.toLowerCase() === String(envEmail).toLowerCase())}`);
  }
  await browser.close();
})();
