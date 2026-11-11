// probe-invite-target-max.js — the "target above the maximum" known-issue asserts the CTA
// is disabled, but it enters the target into an OTHERWISE EMPTY form, where the CTA would
// be disabled anyway. This fills every other field validly first, so the CTA state really
// does reflect the target's own validity.
//
//   node scripts/probe-invite-target-max.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InviteAgentPage = require('../pages/InviteAgentPage');
const { freshAgentIdentity } = require('../utils/agentInviteProvision');

const UNI = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const form = new InviteAgentPage(page);
  const id = freshAgentIdentity();
  await form.goto();
  await form.fillValidDetails({
    firstName: 'Aisha', lastName: 'AlFahad', email: id.email, university: UNI, target: '10',
  });
  await page.waitForTimeout(800);
  console.log('baseline (target 10) — Send Invite enabled:', await form.isSubmitEnabled());

  for (const value of ['1000000', '999999', '99999999999', '1.5']) {
    await form.enter('Numeric Performance Target (Monthly)', value);
    await form.blur('Numeric Performance Target (Monthly)');
    await page.waitForTimeout(1200);
    console.log(
      `target "${value}" -> field holds ${JSON.stringify(await form.valueOf('Numeric Performance Target (Monthly)'))}`
      + `, error ${JSON.stringify(await form.errorFor('Numeric Performance Target (Monthly)'))}`
      + `, Send Invite enabled ${await form.isSubmitEnabled()}`
    );
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
