// onboardingProvision.js — provisions a fresh, verified, logged-in account and
// drives it to the /onboarding wizard, so every onboarding scenario can start
// from a clean state.
//
// Why this exists: reaching /onboarding requires a real account that is
//   1. created via /signup,
//   2. email-verified (the verify link is read from the Gmail inbox over IMAP),
//   3. logged in — "Start Onboarding" on the verify screen routes to /login, and
//      a verified-but-not-onboarded account lands on /onboarding after login.
// Finishing (or fully skipping) onboarding is one-way per account, so each
// scenario that completes the wizard needs its own fresh account. We mint a
// unique plus-addressed alias per run, exactly like the signup suite does.

require('dotenv').config();
const fetch = require('node-fetch');
const SignupPage = require('../pages/SignupPage');
const LoginPage = require('../pages/LoginPage');
const { latestUid, waitForEmail } = require('./gmailClient');

const VERIFY_SUBJECT = 'Verify your Talentforge account';
const SIGNUP_EMAIL_BASE = process.env.SIGNUP_EMAIL_BASE;
const SIGNUP_AGENT_CODE = process.env.SIGNUP_AGENT_CODE;
const SIGNUP_PASSWORD = process.env.SIGNUP_PASSWORD || 'StrongPass123!';

// A unique, plus-addressed alias off SIGNUP_EMAIL_BASE so every run signs up with
// a fresh address that still delivers to the same IMAP-readable inbox, e.g.
// iqra.farooq+onb<base36-timestamp>@bytecorp.io
function uniqueOnboardingEmail() {
  const [local, domain] = SIGNUP_EMAIL_BASE.split('@');
  return `${local}+onb${Date.now().toString(36)}@${domain}`;
}

// The verification CTA is a SendGrid click-tracking wrapper (/ls/click?...) that
// 302-redirects to the real app URL (/verify-email?uid=&token=). Resolve the
// redirect chain over HTTP first so headless Chromium never stalls on the
// tracker's interstitial. Falls back to the raw link. (Mirrors signup.steps.js.)
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

// Full provisioning: signup -> verify -> login -> /onboarding. Returns the email
// used (also stashed on world._onboardingEmail) so scenarios can reference it.
async function provisionAccountToOnboarding(world) {
  const page = world.page;
  const signup = new SignupPage(page);
  const email = uniqueOnboardingEmail();
  world._onboardingEmail = email;

  // ---- 1. Sign up ----
  await signup.navigateToSignup();
  await signup.fillForm({
    firstName: 'Iqra',
    lastName: 'Onboard',
    email,
    agentCode: SIGNUP_AGENT_CODE,
    password: SIGNUP_PASSWORD,
    confirmPassword: SIGNUP_PASSWORD,
  });

  // Baseline the newest matching email BEFORE submitting so we wait for a
  // strictly newer verification message (never a stale one from a prior run).
  const baselineUid = await latestUid({ subject: VERIFY_SUBJECT, to: email }).catch(() => 0);
  await signup.submit();
  await page.waitForURL(/\/email-verification/, { timeout: 45000 });

  // ---- 2. Read + open the verification link ----
  const { uid, link } = await waitForEmail('verifyAccount', {
    to: email,
    afterUid: baselineUid || 0,
    timeoutMs: 120000,
  });
  if (!link) throw new Error(`Verification email (uid ${uid}) had no verification link`);
  const finalUrl = await resolveVerifyUrl(link);
  await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
  await signup.verifiedHeading.waitFor({ state: 'visible', timeout: 30000 });

  // ---- 3. Log in (verify screen's "Start Onboarding" only routes to /login) ----
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(SIGNUP_PASSWORD);
  await login.submitButton.first().click();

  // A verified, not-yet-onboarded account is routed straight to the wizard.
  await page.waitForURL(/\/onboarding/, { timeout: 45000 });
  return email;
}

module.exports = { provisionAccountToOnboarding, uniqueOnboardingEmail, resolveVerifyUrl };
