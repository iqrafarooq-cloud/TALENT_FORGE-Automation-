#!/usr/bin/env node
// recover-changepassword-agent.js — put AGENT_CHANGEPASSWORD_EMAIL back on a
// KNOWN password by driving the product's own Forgot Password flow, then record
// that password in .env.
//
// WHY THIS EXISTS. Change-Password.feature rotates a real password on a real
// shared agent. If a run dies between "rotate to TEMP" and "restore to
// ORIGINAL", the account is left on a password .env does not name — and once
// BOTH names in .env are wrong the account is unreachable by any means the repo
// owns. That is the state it was found in on 2026-09-07: the API answered
// 401 Invalid Credentials for AGENT_CHANGEPASSWORD_OLD_PASSWORD, so every
// scenario failed at its Background and the whole feature read as broken.
// (TWOFA_JIRA_VS_APP.md section 4 already recorded the same account unreachable
// on 2026-08-24, under a previous address, so this is the second occurrence.)
//
// Recovery goes through Forgot Password rather than provisioning a new agent on
// purpose: AN AGENT CANNOT BE DELETED, so minting a replacement abandons the old
// one permanently and the addresses accumulate. A reset costs one live email.
//
// It NEVER logs in with a guessed password. Sign-in attempts are rate limited
// ("Too many failed sign-in attempts. Try again in N minute(s)"), and guessing
// is exactly what locks the account out for an hour — see the latch in
// steps/change-password.js. The reset flow needs no password at all.
//
//   node scripts/recover-changepassword-agent.js
//   node scripts/recover-changepassword-agent.js --password "Known!Pass123"
//
// Costs: one password-reset email read out of the live IMAP inbox. No payment,
// no new account, nothing permanent created.
require('dotenv').config();
const { chromium } = require('playwright');
const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const LoginPage = require('../pages/LoginPage');
const { waitForEmail, latestUid } = require('../utils/gmailClient');
const { updateEnvVars, ENV_PATH } = require('../utils/envWriter');
const { EMAIL_TYPES } = require('../utils/emailTypes');

// --email-key / --password-key point the same reset flow at another fixture, e.g.
//   node scripts/recover-changepassword-agent.js --email-key TWOFA_AGENT_EMAIL --password-key TWOFA_AGENT_PASSWORD
const keyArg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i === -1 ? dflt : process.argv[i + 1]; };
const EMAIL_KEY = keyArg('--email-key', 'AGENT_CHANGEPASSWORD_EMAIL');
const PW_KEY = keyArg('--password-key', 'AGENT_CHANGEPASSWORD_OLD_PASSWORD');
const EMAIL = process.env[EMAIL_KEY];
const TEMP = process.env.AGENT_CHANGEPASSWORD_TEMP_PASSWORD || 'TempChange!456A';

// The password the account will end up on. Requirement-satisfying (>=8, upper,
// lower, number, special) and unique per run, so a reset is never refused for
// reusing the previous value.
function freshPassword() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `TfChange!${n}aZ`;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  if (!EMAIL) throw new Error(`${EMAIL_KEY} is not set in .env`);
  if (!process.env.BASE_URL) throw new Error('BASE_URL is not set in .env');

  const wanted = argValue('--password') || freshPassword();
  if (wanted === TEMP) {
    // The E2E scenario rotates ORIGINAL -> TEMP -> ORIGINAL. If the two were the
    // same value the "new password must differ from your current password" rule
    // would block the rotation, and the scenario would fail on a fixture
    // collision that looks nothing like its cause.
    throw new Error(
      `Refusing to set the same value as AGENT_CHANGEPASSWORD_TEMP_PASSWORD (${TEMP}) — ` +
        'the E2E rotation needs the two to differ.'
    );
  }

  console.log(`[recover] account : ${EMAIL}`);
  console.log(`[recover] target  : ${wanted}`);

  const browser = await chromium.launch({
    headless: process.env.HEADED === 'false',
    slowMo: process.env.HEADED === 'false' ? 0 : 50,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const forgot = new ForgotPasswordPage(page);

    // Baseline the inbox BEFORE requesting, so the mail this run triggers is
    // told apart from every earlier reset mail on this long-lived address.
    const baselineUid = await latestUid({
      subject: EMAIL_TYPES.resetPassword.subject,
      to: EMAIL,
    }).catch(() => 0);
    console.log(`[recover] inbox baseline uid: ${baselineUid}`);

    await forgot.navigateToForgot();
    await forgot.requestReset(EMAIL);

    // The confirmation is deliberately enumeration-safe (identical whether or
    // not the account exists), so it is NOT evidence the mail was sent. The
    // arriving mail is.
    await page
      .waitForURL(/check-email/i, { timeout: 30000 })
      .catch(() =>
        console.log('[recover] no /check-email redirect — continuing to wait on the inbox')
      );

    console.log('[recover] waiting for the reset email (up to 3 min)...');
    const { uid, link } = await waitForEmail('resetPassword', {
      to: EMAIL,
      afterUid: baselineUid,
      timeoutMs: 180000,
    });
    if (!link) throw new Error(`Reset email (uid ${uid}) carried no /reset-password link`);
    console.log(`[recover] reset mail uid ${uid}`);

    await forgot.navigateToReset(link);
    const opened = await forgot.resetHeading
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      // "This link has expired" here usually means the VALIDATE endpoint was
      // throttled, not that the token is spent — it shares the rate limit with
      // the send endpoint (measured 2026-09-03, see steps/forgot-password.js).
      const expired = await forgot.linkExpiredHeading.isVisible().catch(() => false);
      throw new Error(
        expired
          ? 'The reset page rendered "link expired". That is usually the validate endpoint ' +
            'being rate limited rather than a spent token — wait a few minutes and re-run.'
          : `The reset form never appeared. URL: ${page.url()}`
      );
    }

    await forgot.setNewPassword(wanted);
    await forgot.resetSubmitButton.click();

    const reset =
      (await page
        .waitForURL(/\/login|success/i, { timeout: 30000 })
        .then(() => true)
        .catch(() => false)) ||
      (await page
        .getByText(/password (has been )?reset|reset successful|successfully/i)
        .first()
        .isVisible()
        .catch(() => false));
    if (!reset) throw new Error(`The reset form did not report success. URL: ${page.url()}`);
    console.log('[recover] password reset accepted');

    // >>> VERIFY BY LOGGING IN, and only then write .env. <<<
    // Writing an unverified value is how this fixture broke in the first place:
    // a .env naming a password the account is not on is worse than one naming
    // nothing, because the suite then reports "Invalid Credentials" and reads
    // like a product defect.
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(EMAIL);
    await login.passwordInput.first().fill(wanted);
    await login.submitButton.first().click();

    const deadline = Date.now() + 40000;
    let verdict = 'stalled';
    let onScreen = '';
    while (Date.now() < deadline) {
      if (!/\/login(\/|\?|$)/.test(page.url())) {
        verdict = 'accepted';
        break;
      }
      const alert = login.alert.first();
      if (await alert.isVisible().catch(() => false)) {
        onScreen = ((await alert.textContent().catch(() => '')) || '').trim();
        if (/too many failed sign-in|account is locked/i.test(onScreen)) {
          verdict = 'locked';
          break;
        }
        if (/invalid|incorrect|no active account|credentials/i.test(onScreen)) {
          verdict = 'rejected';
          break;
        }
      }
      await page.waitForTimeout(300);
    }

    if (verdict === 'locked') {
      // The reset succeeded; the SIGN-IN throttle is what is refusing us, not
      // the password. Record it, but say plainly that it is unverified.
      const written = updateEnvVars({ [PW_KEY]: wanted });
      console.log(`\n[recover] ${PW_KEY} written to ${written}`);
      console.log(
        '[recover] NOT verified by login: the account is still sign-in rate limited ' +
          `("${onScreen}"). The reset itself succeeded, so the value is expected to be ` +
          'correct — re-run this script, or just run the feature, once the window expires.'
      );
      return;
    }
    if (verdict !== 'accepted') {
      throw new Error(
        `Login with the freshly reset password was "${verdict}" (on screen: "${onScreen}"). ` +
          '.env was NOT changed — better to leave it naming nothing usable than to record a ' +
          'password the account is not on.'
      );
    }

    const written = updateEnvVars({ [PW_KEY]: wanted });
    console.log('\n[recover] login verified — the account is on the new password');
    console.log(`[recover] ${PW_KEY} written to ${written}`);
    console.log(`\nAGENT_CHANGEPASSWORD_EMAIL=${EMAIL}`);
    console.log(`AGENT_CHANGEPASSWORD_OLD_PASSWORD=${wanted}`);
    console.log(`AGENT_CHANGEPASSWORD_TEMP_PASSWORD=${TEMP}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`\n[recover] FAILED: ${e.message}`);
  console.error(`[recover] ${ENV_PATH} was left unchanged unless a line above says otherwise.`);
  process.exit(1);
});
