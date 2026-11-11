const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const fetch = require('node-fetch');
const SignupPage = require('../pages/SignupPage');
const { latestUid, waitForEmail } = require('../utils/gmailClient');
require('dotenv').config();

const SIGNUP_EMAIL_BASE = process.env.SIGNUP_EMAIL_BASE;
const SIGNUP_AGENT_CODE = process.env.SIGNUP_AGENT_CODE;
const SIGNUP_PASSWORD = process.env.SIGNUP_PASSWORD || 'StrongPass123!';

for (const [name, value] of Object.entries({
  BASE_URL: process.env.BASE_URL,
  SIGNUP_EMAIL_BASE,
  SIGNUP_AGENT_CODE,
  GMAIL_USER: process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
})) {
  if (!value) throw new Error(`Missing required env var ${name}. Set it in .env`);
}

const VERIFY_SUBJECT = 'Verify your Talentforge account';

// Escape a plain string so it can be used as a literal inside a RegExp.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lazily create (and cache) the SignupPage bound to the current page.
function sp(world) {
  if (!world.pages.signup) {
    world.pages.signup = new SignupPage(world.page);
  }
  return world.pages.signup;
}

// A unique, plus-addressed alias off SIGNUP_EMAIL_BASE so every run signs up with a
// fresh address that still delivers to the same IMAP-readable inbox. E.g.
// iqra.farooq+tf<base36-timestamp>@bytecorp.io
function uniqueSignupEmail() {
  const [local, domain] = SIGNUP_EMAIL_BASE.split('@');
  return `${local}+tf${Date.now().toString(36)}@${domain}`;
}

// The verification CTA is a SendGrid click-tracking wrapper (/ls/click?...) that
// 302-redirects to the real app URL (/verify-email?uid=&token=). Headless Chromium
// can stall on the tracker's interstitial, so resolve the redirect chain over HTTP
// first and hand the browser the clean app URL. Falls back to the raw link.
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

// ==================== Navigation ====================

Given('the user navigates to the signup page', async function () {
  await sp(this).navigateToSignup();
  await expect(sp(this).createAccountButton).toBeVisible({ timeout: 20000 });
});

// ==================== Filling the form ====================

When('the user fills the signup form with valid data and a unique email', async function () {
  this._signupEmail = uniqueSignupEmail();
  await sp(this).fillForm({
    firstName: 'Iqra',
    lastName: 'Tester',
    email: this._signupEmail,
    agentCode: SIGNUP_AGENT_CODE,
    password: SIGNUP_PASSWORD,
    confirmPassword: SIGNUP_PASSWORD,
  });
});

When('the user enters and clears each required field', async function () {
  const page = sp(this);
  await page.enterAndClear(page.firstNameInput);
  await page.enterAndClear(page.lastNameInput);
  await page.enterAndClear(page.emailInput, 'x@y.com');
  await page.enterAndClear(page.agentCodeInput);
  await page.enterAndClear(page.passwordInput);
  await page.enterAndClear(page.confirmPasswordInput);
});

When('the user enters the email {string} and moves out of the field', async function (email) {
  const page = sp(this);
  await page.emailInput.fill(email);
  await page.emailInput.blur();
});

When('the user enters password {string} and confirm password {string} and blurs', async function (pw, confirm) {
  const page = sp(this);
  await page.passwordInput.fill(pw);
  await page.passwordInput.blur();
  await page.confirmPasswordInput.fill(confirm);
  await page.confirmPasswordInput.blur();
});

When('the user enters an invalid agent code {string}', async function (code) {
  await sp(this).agentCodeInput.fill(code);
});

When('the user submits the signup form', async function () {
  const page = sp(this);
  // Baseline the newest matching email BEFORE submitting, so a later wait picks up a
  // strictly newer message. Only meaningful when a real (valid) signup is submitted.
  if (this._signupEmail) {
    this._verifyBaselineUid = await latestUid({ subject: VERIFY_SUBJECT, to: this._signupEmail }).catch(() => 0);
  }
  await page.submit();
});

// ==================== Button state ====================

Then('the {string} button should be enabled', async function (label) {
  const btn = this.page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first();
  await expect(btn).toBeEnabled({ timeout: 15000 });
});

Then('the {string} button should be disabled', async function (label) {
  const btn = this.page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first();
  await expect(btn).toBeDisabled({ timeout: 15000 });
});

// ==================== Validation messages ====================

Then('a required-field validation message should be displayed', async function () {
  const msg = this.page.getByText(/is required\./i).first();
  await expect(msg).toBeVisible({ timeout: 15000 });
});

Then('the email validation error {string} should be displayed', async function (message) {
  const msg = this.page.getByText(new RegExp(escapeRegExp(message), 'i')).first();
  await expect(msg).toBeVisible({ timeout: 15000 });
});

Then('the password requirements error should be displayed', async function () {
  await expect(sp(this).passwordRequirementsError).toBeVisible({ timeout: 15000 });
});

Then('the passwords-do-not-match error should be displayed', async function () {
  await expect(sp(this).passwordsDoNotMatchError).toBeVisible({ timeout: 15000 });
});

Then('an error message {string} should be displayed', async function (message) {
  const re = new RegExp(escapeRegExp(message), 'i');
  const inAlert = sp(this).alert.filter({ hasText: re }).first();
  const anywhere = this.page.getByText(re).first();
  const ok = await inAlert
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) await expect(anywhere).toBeVisible({ timeout: 10000 });
});

Then('the user should remain on the signup page', async function () {
  await this.page.waitForTimeout(500);
  expect(this.page.url()).toMatch(/\/signup/);
});

// ==================== Email-verification prompt (screen 2) ====================

Then('the user should be taken to the email verification screen', async function () {
  await this.page.waitForURL(/\/email-verification/, { timeout: 30000 });
  await expect(sp(this).checkInboxHeading).toBeVisible({ timeout: 20000 });
});

Then('the resend email button should show a countdown and be disabled', async function () {
  const btn = sp(this).resendButton;
  await expect(btn).toBeVisible({ timeout: 20000 });
  // e.g. "Resend Email in 00:56" — disabled while the cooldown counts down.
  await expect(btn).toHaveText(/resend email in \d{1,2}:\d{2}/i, { timeout: 20000 });
  await expect(btn).toBeDisabled();
});

// ==================== Email verification (screen 3) ====================

When('the user opens the verification link from the email', async function () {
  expect(this._signupEmail, 'no signup email was captured in this scenario').toBeTruthy();
  const { uid, link } = await waitForEmail('verifyAccount', {
    to: this._signupEmail,
    afterUid: this._verifyBaselineUid || 0,
    timeoutMs: 120000,
  });
  if (!link) throw new Error(`Verification email (uid ${uid}) had no verification link`);
  this._verifyLink = link;
  // Resolve the click-tracking redirect to the clean app URL before navigating.
  const finalUrl = await resolveVerifyUrl(link);
  this._verifyAppUrl = finalUrl;
  await sp(this).openVerificationLink(finalUrl);
});

Then('the email verified successfully screen should be displayed', async function () {
  // Assert on the success signal (heading) rather than the URL — the app may finish
  // the verify call and update the view asynchronously after load.
  await expect(sp(this).verifiedHeading).toBeVisible({ timeout: 30000 });
});
