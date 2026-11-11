// Read-only probe of the Invite via Email chip input. Sends NOTHING.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'true' ? false : true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });

  const ob = new CandidateOnboardingPage(page);
  await ob.openChooserFromCandidates();
  await ob.chooseMethod('Invite via Email');
  await ob.inviteModal.waitFor({ state: 'visible', timeout: 20000 });

  const dump = async (label) => {
    const html = await ob.inviteModal.innerHTML();
    console.log(`\n===== ${label} =====`);
    console.log(html.slice(0, 6000));
    console.log(`--- sendInvites enabled: ${await ob.sendInvitesButton.isEnabled().catch(() => null)}`);
    console.log(`--- input value: ${JSON.stringify(await ob.inviteEmailInput.inputValue().catch(() => null))}`);
  };

  await dump('EMPTY');
  await ob.inviteEmailInput.fill('chip.one@university.edu');
  await ob.inviteEmailInput.press('Enter');
  await page.waitForTimeout(800);
  await dump('AFTER ONE CHIP (Enter)');
  await ob.inviteEmailInput.fill('chip.two@university.edu');
  await ob.inviteEmailInput.press(' ');
  await page.waitForTimeout(800);
  await dump('AFTER SPACE CHIP');
  await ob.inviteEmailInput.fill('invalid-email');
  await ob.inviteEmailInput.press('Enter');
  await page.waitForTimeout(800);
  await dump('AFTER INVALID');
  await browser.close();
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
