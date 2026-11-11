// Read-only: which agent row does openAgent() resolve for the referral fixture?
// Opens the profile and prints the id + Promo Tools code. Changes nothing.
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
require('dotenv').config();
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, { timeout: 90000, waitUntil: 'commit' });

  const admin = new AdminPromoToolsPage(page);
  const email = process.env.REFERRAL_AGENT_EMAIL;
  await admin.gotoAgents();
  await admin.agentSearchInput.fill(email.split('@')[0].split('+')[1]);
  const rows = page.locator('[role="row"]', { hasText: email });
  await rows.first().waitFor({ state: 'visible', timeout: 30000 });
  const n = await rows.count();
  console.log(`rows matching "${email}" (case-insensitive): ${n}`);
  for (let i = 0; i < n; i++) {
    console.log(`  [${i}] ` + (await rows.nth(i).innerText()).split(/[\n\t]+/).map(c => c.trim()).filter(Boolean).join(' | '));
  }
  const picked = await admin.disambiguate(rows, email);
  console.log('\ndisambiguate() picked:');
  console.log('  ' + (await picked.innerText()).split(/[\n\t]+/).map(c => c.trim()).filter(Boolean).join(' | '));

  const url = await admin.openAgent(email);
  console.log('\nopenAgent() ->', url);
  await admin.promoToolsTab.click();
  await admin.editParametersButton.waitFor({ state: 'visible', timeout: 30000 });
  console.log('  promo code on tab :', await admin.readPromoCode());
  console.log('  Status            :', await admin.readParameter('Status'));
  console.log('  expected from .env:', 'CODEHFA8X3Y (per steps/referral-codes.js header)');
  await browser.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
