// One-off probe: can we sign up with a candidates+N@iqra.anonaddy.com alias and read
// the verification email via the existing IMAP client? Validates the account-
// provisioning path for the 3-plan subscription script BEFORE any real payment.
// Run: node scripts/probe-anonaddy-signup.js
require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');
const SignupPage = require('../pages/SignupPage');
const { latestUid, waitForEmail } = require('../utils/gmailClient');

const VERIFY_SUBJECT = 'Verify your Talentforge account';
const AGENT = process.env.SIGNUP_AGENT_CODE;
const PW = process.env.SIGNUP_PASSWORD || 'StrongPass123!';
// anonaddy strips the +subaddress on delivery, so the verify email lands with
// To: candidates@iqra.anonaddy.com — match the IMAP search on this base address.
const VERIFY_TO_BASE = 'candidates@iqra.anonaddy.com';
const LoginPage = require('../pages/LoginPage');

function anonaddyAlias() {
  return `candidates+e2e${Date.now().toString(36)}@iqra.anonaddy.com`;
}

async function resolveVerifyUrl(startUrl, maxHops = 6) {
  let url = startUrl;
  for (let i = 0; i < maxHops; i++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch {
      return url;
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = loc;
      if (/\/verify-email/i.test(url)) return url;
      continue;
    }
    return url;
  }
  return url;
}

(async () => {
  const email = anonaddyAlias();
  console.log('[probe] signup email:', email);
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const signup = new SignupPage(page);
  try {
    await signup.navigateToSignup();
    await signup.fillForm({
      firstName: 'Plan',
      lastName: 'Tester',
      email,
      agentCode: AGENT,
      password: PW,
      confirmPassword: PW,
    });
    const baseline = await latestUid({ subject: VERIFY_SUBJECT, to: VERIFY_TO_BASE }).catch(() => 0);
    await signup.submit();
    await page.waitForURL(/\/email-verification/, { timeout: 45000 });
    console.log('[probe] reached /email-verification; polling IMAP for the verify email...');
    const { uid, link } = await waitForEmail('verifyAccount', {
      to: VERIFY_TO_BASE,
      afterUid: baseline || 0,
      timeoutMs: 150000,
    });
    console.log('[probe] verify email found. uid=', uid, 'hasLink=', !!link);
    const finalUrl = await resolveVerifyUrl(link);
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
    await signup.verifiedHeading.waitFor({ state: 'visible', timeout: 30000 });
    console.log('[probe] verified. Now logging in with the full +alias...');
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(PW);
    await login.submitButton.first().click();
    await page.waitForURL(/\/getting-started|\/dashboard|\/onboarding|\/profile/, {
      timeout: 45000,
      waitUntil: 'commit',
    });
    console.log('RESULT: SUCCESS — signup+verify+login works for', email, '=> landed', page.url());
  } catch (e) {
    console.log('RESULT: FAILED —', e.message);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();
