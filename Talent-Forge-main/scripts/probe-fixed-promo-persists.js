// probe-fixed-promo-persists.js — is a FIXED AMOUNT promo configured at invite time
// actually stored, and where can it be asserted?
//
//   node scripts/probe-fixed-promo-persists.js <agentEmail> <surname>
//
// Takes an agent that was already invited WITH a Fixed Amount promo, accepts the invite
// (so the superadmin gains the View action that reaches Promo Tools), reads the stored
// Code Parameters, then deactivates the account again.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AgentsListingPage = require('../pages/AgentsListingPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const {
  waitForInviteMail,
  setPasswordAndSignIn,
  deactivateProvisionedAgents,
} = require('../utils/agentInviteProvision');

const EMAIL = process.argv[2] || 'iqra.farooq+iamcpfixed1@bytecorp.io';
const SURNAME = process.argv[3] || 'Qamcpfixedone';
const NEW_PASSWORD = process.env.INVITE_AGENT_NEW_PASSWORD || 'StrongPass123!';
const line = (t) => console.log(`\n${'='.repeat(14)} ${t} ${'='.repeat(14)}`);

(async () => {
  line('READING THE INVITATION MAIL');
  const mail = await waitForInviteMail(EMAIL, { afterUid: 0, timeoutMs: 180000 });
  console.log('temp password found:', Boolean(mail.tempPassword), '| from:', mail.from);

  const browser = await chromium.launch({ headless: true });

  line('AGENT ACCEPTS (own context)');
  const agentCtx = await browser.newContext();
  const agentPage = await agentCtx.newPage();
  const agentLogin = new LoginPage(agentPage);
  await agentLogin.navigate();
  await agentLogin.emailInput.first().fill(EMAIL);
  await agentLogin.passwordInput.first().fill(mail.tempPassword);
  await agentLogin.submitButton.first().click();
  await agentPage.waitForURL(/\/set-password|\/dashboard/, { timeout: 90000, waitUntil: 'commit' }).catch(() => {});
  await agentPage.waitForTimeout(2000);
  console.log('landed on:', agentPage.url());
  const result = await setPasswordAndSignIn(agentPage, { email: EMAIL, password: NEW_PASSWORD });
  console.log('after accepting:', JSON.stringify(result));
  await agentCtx.close();

  line('SUPERADMIN READS THE STORED PROMO');
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const login = new LoginPage(adminPage);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await adminPage.waitForURL(/\/agents|\/candidate|\/user-management/, { timeout: 90000, waitUntil: 'commit' });

  const promo = new AdminPromoToolsPage(adminPage);
  await promo.openPromoTools(SURNAME);
  console.log('agent detail url:', adminPage.url());
  console.log('promo code:      ', await promo.readPromoCode());
  console.log('code parameters: ', JSON.stringify(await promo.readAllParameters(), null, 2));

  line('CLEANUP');
  console.log(await deactivateProvisionedAgents(new AgentsListingPage(adminPage), [
    { email: EMAIL, lastName: SURNAME },
  ]));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
