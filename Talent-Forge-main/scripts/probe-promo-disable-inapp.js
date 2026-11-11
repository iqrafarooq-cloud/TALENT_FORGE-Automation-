// probe-promo-disable-inapp.js — READ ONLY. Did the disable/resume raise an IN-APP notification
// for the limited promo agent, even though no email arrived?
//
//   node scripts/probe-promo-disable-inapp.js
//
// The scenario clears the bell, disables the promo, then waits on the EMAIL - so it dies before
// reaching its in-app assertions and never says whether that half fired. That distinction decides
// what to file: "the disable notification pipeline is dead" is a different bug from "only the
// email leg is dead". The run a few minutes ago left whatever was raised sitting unread, so this
// just reads the bell rather than disabling anything again.
//
// READ ONLY: signs in as the agent and reads notifications. Changes nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const NotificationsPage = require('../pages/NotificationsPage');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.PROMO_LIMITED_AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.PROMO_LIMITED_AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });

  const notes = new NotificationsPage(page);
  await notes.open();
  const items = await notes.readItems();
  console.log(`\n=== ${process.env.PROMO_LIMITED_AGENT_EMAIL} — ${items.length} notification(s) on the first page ===`);
  items.forEach((it, i) => {
    const text = (typeof it === 'string' ? it : JSON.stringify(it)).replace(/\s+/g, ' ').trim();
    console.log(`  [${i}] ${text.slice(0, 220)}`);
  });
  const promo = items.filter((it) => /promo|disabled|resumed|paused/i.test(
    typeof it === 'string' ? it : JSON.stringify(it)
  ));
  console.log(`\n  promo-shaped entries: ${promo.length}`);
  await browser.close();
})();
