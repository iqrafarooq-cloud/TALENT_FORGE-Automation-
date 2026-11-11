const { Given, When, Then, After, AfterAll, Status } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const { chromium } = require('playwright');
const TwoFactorAuthPage = require('../pages/TwoFactorAuthPage');
const LoginPage = require('../pages/LoginPage');
const { totp, invalidCode } = require('../utils/totp');
const { updateEnv } = require('../utils/envWriter');
require('dotenv').config();

// ================================================================================================
// 2FA.feature (Jira TFF-20) — Two-Factor Authentication, end to end against the live app.
//
// NOTHING HERE IS MOCKED except the one @negative scenario that exists to force a 500. The app
// hands the TOTP secret back in plaintext at setup time (it is the same string it prints under the
// QR code for a human to copy), so the suite computes the code the server is expecting and submits
// it like an authenticator would. See features/support/totp.js for why that is the honest route
// and stubbing the verify call is not.
//
// ------------------------------------------------------------------------------------------------
// WHY THIS RUNS ON ITS OWN AGENT, AND WHY THAT IS NOT FUSSINESS
// ------------------------------------------------------------------------------------------------
// Enabling 2FA changes how the account LOGS IN. Every other agent-side feature (Dashboard,
// Active-candidate, Verification, Change-Password, Referral-Codes, Invite-agent's accept walk)
// signs in with a plain email+password POST and has no idea what to do with a 6-digit challenge.
// So a 2FA run that dies between "toggle on" and "toggle off" would leave a shared account
// demanding a code, and the whole suite would go red at its Background for a reason that looks
// nothing like the cause.
//
// TWOFA_AGENT_* is therefore a dedicated agent that NOTHING else logs in as. Provision it once
// with `node scripts/provision-2fa-agent.js`; recover a wedged one with
// `node scripts/reset-2fa-agent.js <secret>`.
//
// The secret is persisted to .env as TWOFA_AGENT_SECRET the moment it is minted — not for the
// suite to read back, but so a killed run is recoverable by hand. Without it a fixture with 2FA
// left on is unreachable by any means the repo owns.
//
// ------------------------------------------------------------------------------------------------
// STATE IS MODULE-LEVEL ON PURPOSE
// ------------------------------------------------------------------------------------------------
// `Given 2FA is disabled/enabled for the user` is a precondition, not an assertion, and satisfying
// it costs a real round trip (a dialog, a code, a server call). Tracking the account's state here
// means a run of 27 scenarios pays for a transition only when one is actually needed, instead of
// toggling twice per scenario. An AfterAll turns 2FA off at the end of the run on its own browser
// — hooks.js closes the shared one in an AfterAll of its own that is registered first and so runs
// first.
// ================================================================================================

const EMAIL = process.env.TWOFA_AGENT_EMAIL;
const PASSWORD = process.env.TWOFA_AGENT_PASSWORD;

for (const [name, value] of Object.entries({ BASE_URL: process.env.BASE_URL, TWOFA_AGENT_EMAIL: EMAIL, TWOFA_AGENT_PASSWORD: PASSWORD })) {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Run \`node scripts/provision-2fa-agent.js\` to mint the dedicated 2FA agent.`
    );
  }
}

const state = {
  // null = not yet observed this run. Set from the first Security tab read.
  enabled: null,
  // The shared secret for the CURRENT registration. Disabling and re-enabling mints a new one,
  // so this is overwritten every time the setup dialog is opened.
  secret: process.env.TWOFA_AGENT_SECRET || null,
};

function tfa(world) {
  if (!world._tfa || world._tfaPage !== world.page) {
    world._tfa = new TwoFactorAuthPage(world.page);
    world._tfaPage = world.page;
  }
  return world._tfa;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The app renders its messages without the AC's trailing full stop ("Two factor authentication is
// now active" on screen, "...active." in the API body). Matching on the sentence and treating a
// trailing period as optional keeps the assertion about the WORDING rather than about punctuation
// the AC and the build simply disagree on.
function messageMatcher(message) {
  return new RegExp(escapeRegExp(String(message).replace(/\.\s*$/, '')) + '\\.?', 'i');
}

// Retried once on a navigation failure. Every one of the 27 scenarios logs in from cold, so a
// single flaky `page.goto` — observed once, a 30s timeout on the very first scenario — is a red
// row that says nothing about 2FA. A retry is the right response to a transport failure; it is
// NOT applied to the credential submission, so a genuinely rejected login still fails once.
// ------------------------------------------------------------------------------------------------
// A SIGN-IN THAT DOES NOT LEAVE /login MUST SAY SO, HERE.
//
// This used to submit the credentials once, swallow the `waitForURL` timeout with
// `.catch(() => {})` and carry on. So a login that simply did not take left the run sitting on
// /login, and the failure surfaced 30 SECONDS LATER as
// `locator.waitFor: Timeout ... waiting for locator('[data-testid="security-tab"]')` — a message
// about the Security tab, on a page that has no Security tab because nobody is signed in. That is
// the wrong bug named at the wrong screen, and it cost a red row on the 2026-09-03 verification
// run (1 of 27; the other 26 scenarios signed in with the same credentials in the same run).
//
// The retry distinguishes the two causes rather than papering over both:
//   - the page shows an error  -> the app REJECTED the credentials. Fail immediately, no retry.
//                                 A wrong password must not be retried into looking like a flake.
//   - nothing happened at all  -> the click did not register (submitted before hydration is the
//                                 usual cause). Retry the submission once, which is the right
//                                 response to a lost interaction.
// If it is still on /login after that, it throws NAMING the real problem and attaching whatever
// the page was showing.
// ------------------------------------------------------------------------------------------------
async function signIn(world, { fresh = false } = {}) {
  if (fresh) await world.context.clearCookies();
  const login = new LoginPage(world.page);
  try {
    await login.navigate();
  } catch (e) {
    world.attach(`login page navigation failed (${e.message.split('\n')[0]}) — retrying once`, 'text/plain');
    await login.navigate();
  }

  const stillOnLogin = () => /\/login(\/|\?|$)/.test(String(world.page.url()));
  const visibleError = async () => {
    const texts = await login.alert
      .evaluateAll((els) =>
        els
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      )
      .catch(() => []);
    return [...new Set(texts)];
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    await login.emailInput.first().fill(EMAIL);
    await login.passwordInput.first().fill(PASSWORD);
    await login.submitButton.first().click();
    // Race "left /login" against "an error is on screen". Waiting out the whole 90s for the URL
    // first meant a refusal toast (e.g. "Your account is locked...") had already gone by the time
    // it was read, so a locked fixture was reported as "no error - submission lost" and retried,
    // which only adds failed attempts to the account.
    let errors = [];
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (!stillOnLogin()) return;
      errors = await visibleError();
      if (errors.length) break;
      await world.page.waitForTimeout(500);
    }
    if (!stillOnLogin()) return;
    // A short request throttle ("Request was throttled. Expected available in 9 seconds.") is not
    // a refusal of the credentials - 27 back-to-back logins trip it. Wait out what it asks for and
    // retry. A lockout or "Invalid Credentials" still fails immediately below.
    const throttle = errors.join(' ').match(/throttled[^\d]*(\d+)\s*second/i);
    if (throttle && attempt < 3) {
      world.attach(`sign-in throttled ("${errors.join(' | ')}") - waiting ${throttle[1]}s and retrying`, 'text/plain');
      await world.page.waitForTimeout((Number(throttle[1]) + 2) * 1000);
      await login.navigate();
      continue;
    }
    if (errors.length) {
      throw new Error(
        `the app refused the sign-in for ${EMAIL} and stayed on /login, showing: ${errors.map((e) => `"${e}"`).join(', ')}`
      );
    }
    if (attempt === 1) {
      world.attach(
        `sign-in did not leave /login and the page showed no error — the submission was probably lost, retrying once`,
        'text/plain'
      );
    }
  }

  throw new Error(
    `sign-in for ${EMAIL} never left /login after three attempts, and the page displayed no error. `
    + 'The credentials were not rejected — the submission is not being accepted. '
    + 'Check the fixture with a direct POST /core/api/v1/auth/token/ before looking at any locator.'
  );
}

// Answer the login challenge if one is up. Returns true when it had to.
async function clearLoginChallenge(world) {
  const page = tfa(world);
  if (!/\/verify-otp/.test(world.page.url())) return false;
  if (!state.secret) {
    throw new Error(
      '2FA is enabled on the fixture but no TOTP secret is known to this run. '
      + 'Recover with `node scripts/reset-2fa-agent.js <secret>` (TWOFA_AGENT_SECRET in .env).'
    );
  }
  await page.waitForLoginChallenge();
  await page.enterOtp(await page.freshCode(state.secret));
  const result = await page.submitOtp();
  if (result.status !== 200) {
    throw new Error(
      `the login OTP was rejected with ${result.status || 'no response'}${result.detail ? `: ${result.detail}` : ''}. `
      + `Feedback: ${(result.feedback || []).join(' | ') || '(none)'}`
    );
  }
  await world.page.waitForURL((u) => !/\/verify-otp/.test(String(u)), { timeout: 45000 }).catch(() => null);
  if (/\/verify-otp/.test(world.page.url())) {
    throw new Error(
      `the login OTP submission did not leave /verify-otp. Feedback: `
      + `${(result.feedback || []).join(' | ') || '(none)'}`
    );
  }
  return true;
}

// Bring the account to a known 2FA state, doing real work only when the state has to change.
async function ensureState(world, want) {
  const page = tfa(world);
  await page.openSecurityTab();
  state.enabled = await page.isEnabled();
  if (state.enabled === want) return;

  if (want) {
    const { apiSecret } = await page.openSetupDialog();
    const manualKey = await page.readManualKey();
    // Cross-check: the key the user is shown must be the one the server registered. A build that
    // printed a different string would enable 2FA against a secret no authenticator could hold.
    if (apiSecret && apiSecret !== manualKey) {
      throw new Error(`The manual setup code shown (${manualKey}) is not the secret the API registered (${apiSecret})`);
    }
    state.secret = manualKey;
    updateEnv('TWOFA_AGENT_SECRET', manualKey);
    await page.clickNext();
    await page.enterOtp(await page.freshCode(state.secret));
    const { status, detail } = await page.submitOtp();
    expect(status, `enabling 2FA failed: ${status} ${detail}`).toBe(200);
  } else {
    await page.clickToggle();
    await page.turnOffButton.waitFor({ state: 'visible', timeout: 20000 });
    await page.clickTurnOff();
    await page.enterOtp(await page.freshCode(state.secret));
    const { status, detail } = await page.submitOtp();
    expect(status, `disabling 2FA failed: ${status} ${detail}`).toBe(200);
  }
  state.enabled = want;
  await page.refresh();
}

// ==================== Background ====================

Given('the user is logged in and on the Security tab', { timeout: 180000 }, async function () {
  await signIn(this);
  await clearLoginChallenge(this);
  await tfa(this).openSecurityTab();
  state.enabled = await tfa(this).isEnabled();
});

// ==================== Preconditions ====================

Given('2FA is disabled for the user', { timeout: 180000 }, async function () {
  await ensureState(this, false);
});

Given('2FA is enabled for the user', { timeout: 180000 }, async function () {
  await ensureState(this, true);
});

Given('the user is on the enable OTP step', { timeout: 180000 }, async function () {
  await ensureState(this, false);
  const page = tfa(this);
  const { apiSecret } = await page.openSetupDialog();
  const manualKey = await page.readManualKey();
  state.secret = manualKey;
  updateEnv('TWOFA_AGENT_SECRET', manualKey);
  this._apiSecret = apiSecret;
  await page.clickNext();
});

Given('a user with 2FA enabled', { timeout: 180000 }, async function () {
  await ensureState(this, true);
});

Given('a user with 2FA enabled has logged in and is on the login 2FA prompt', { timeout: 240000 }, async function () {
  await ensureState(this, true);
  await signIn(this, { fresh: true });
  await tfa(this).waitForLoginChallenge();
});

// ==================== Card & warning state ====================

Then('the {string} card should be visible', async function (title) {
  const page = tfa(this);
  await expect(page.card).toBeVisible({ timeout: 20000 });
  await expect(page.card.getByText(new RegExp(escapeRegExp(title), 'i')).first()).toBeVisible({ timeout: 15000 });
});

Then('the 2FA toggle should reflect the current 2FA status', async function () {
  const page = tfa(this);
  const rendered = await page.isEnabled();
  // "Reflects the status" is only an assertion if the status is known independently of the
  // control being asserted. The red warning icons are the app's OTHER rendering of the same fact,
  // so the two must agree: icons are shown while 2FA is OFF and gone once it is ON.
  const icons = await page.warningIcons.count();
  this.attach(`toggle=${rendered ? 'on' : 'off'}; red warning icons on screen=${icons}`, 'text/plain');
  if (rendered) {
    expect(icons, 'the toggle reads ON but the "2FA is off" warning icons are still rendered').toBe(0);
  } else {
    expect(icons, 'the toggle reads OFF but no warning icon is rendered').toBeGreaterThan(0);
  }
});

Then('a red warning icon should be displayed next to the Security tab label', async function () {
  await expect(tfa(this).securityTabWarning.first()).toBeVisible({ timeout: 15000 });
});

Then('a red warning icon should be displayed on the Two-Factor Authentication card', async function () {
  await expect(tfa(this).cardWarning.first()).toBeVisible({ timeout: 15000 });
});

Then('the red warning icons should disappear', async function () {
  await expect
    .poll(async () => tfa(this).warningIcons.count(), { timeout: 20000, message: 'red warning icons never disappeared' })
    .toBe(0);
});

Then('the red warning icons should reappear', async function () {
  await expect
    .poll(async () => tfa(this).warningIcons.count(), { timeout: 20000, message: 'red warning icons never came back' })
    .toBeGreaterThan(0);
});

// ==================== Toggling ====================

When('the user toggles 2FA on', { timeout: 90000 }, async function () {
  const page = tfa(this);
  const { apiSecret } = await page.openSetupDialog();
  this._apiSecret = apiSecret;
  const manualKey = await page.readManualKey();
  state.secret = manualKey;
  updateEnv('TWOFA_AGENT_SECRET', manualKey);
});

When('the user toggles 2FA off', { timeout: 90000 }, async function () {
  await tfa(this).clickToggle();
  await expect(tfa(this).dialog).toBeVisible({ timeout: 20000 });
});

When('the user proceeds to the disable OTP step', { timeout: 60000 }, async function () {
  await tfa(this).clickTurnOff();
});

When('the user clicks {string} in the 2FA modal', { timeout: 60000 }, async function (label) {
  const page = tfa(this);
  if (/^next$/i.test(label)) return page.clickNext();
  if (/^cancel$/i.test(label)) return page.clickCancel();
  await page.dialog.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first().click();
  await this.page.waitForTimeout(1000);
});

When('the user closes the modal without verifying', { timeout: 60000 }, async function () {
  await tfa(this).clickCancel();
});

// ==================== Setup modal contents ====================

Then('the setup modal should display the authenticator instructions', async function () {
  const page = tfa(this);
  await expect(page.setupHeading).toBeVisible({ timeout: 20000 });
  await expect(page.setupInstructions).toBeVisible({ timeout: 15000 });
  await expect(page.manualKeyInstructions).toBeVisible({ timeout: 15000 });
});

Then('a QR code should be displayed', async function () {
  const qr = tfa(this).qrCode;
  await expect(qr).toBeVisible({ timeout: 20000 });
  // A QR is only a QR if it has modules in it. An empty <svg> of the right size would pass a bare
  // visibility check and tell a user nothing.
  const modules = await qr.locator('rect').count();
  expect(modules, 'the QR code element is on screen but contains no modules').toBeGreaterThan(50);
});

Then('a manual setup code should be displayed', async function () {
  const key = await tfa(this).readManualKey();
  this.attach(`manual setup code: ${key}`, 'text/plain');
  // It must be a usable base32 secret, not merely some text: totp() throws on anything else.
  expect(() => totp(key), `"${key}" is displayed as the manual setup code but is not a usable base32 secret`).not.toThrow();
  if (this._apiSecret) {
    expect(key, 'the code shown to the user is not the secret the API registered').toBe(this._apiSecret);
  }
});

Then('the {string} and {string} buttons should be visible', async function (first, second) {
  const page = tfa(this);
  for (const label of [first, second]) {
    const button = page.dialog.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).last();
    await expect(button, `"${label}" is not visible on the dialog`).toBeVisible({ timeout: 15000 });
  }
});

Then('the 2FA modal should close', async function () {
  await expect(tfa(this).dialog).toBeHidden({ timeout: 20000 });
});

// ==================== OTP step contents ====================

Then('the title {string} should be displayed', async function (title) {
  await expect(
    this.page.getByRole('heading', { name: new RegExp(escapeRegExp(title), 'i') }).first()
  ).toBeVisible({ timeout: 20000 });
});

Then('there should be {int} single-digit OTP input boxes', async function (count) {
  const boxes = await tfa(this).readOtpBoxes();
  this.attach(`OTP control shape: ${boxes.shape}; boxes: ${boxes.count}`, 'text/plain');
  expect(boxes.count, `expected ${count} single-digit boxes, found ${boxes.count} (control shape: ${boxes.shape})`).toBe(count);
});

// `the first OTP box should be auto-focused` USED TO BE DEFINED HERE AND HAS BEEN REMOVED.
//
// Neither surface auto-focuses: measured 2026-09-03, focus is on the header "Cancel" BUTTON in
// the setup dialog and on BODY at /verify-otp. That is the current intended behaviour per the
// product owner, so both Gherkin lines were dropped and this definition went with them rather
// than being left unreachable. `readOtpBoxes().focusedIndex` still reports focus, so reinstating
// the step is a few lines if TFF-20's auto-focus is ever built - see TWOFA_JIRA_VS_APP.md §3.

Then('all {int} OTP boxes should be filled', async function (count) {
  const boxes = await tfa(this).readOtpBoxes();
  const filled = boxes.digits.filter((d) => d !== '').length;
  expect(filled, `only ${filled} of ${count} boxes hold a digit (${JSON.stringify(boxes.digits)})`).toBe(count);
});

// ==================== Entering codes ====================

When('the user enters {string} into the OTP boxes', { timeout: 60000 }, async function (digits) {
  await tfa(this).enterOtp(String(digits ?? '').trim());
});

When('the user pastes {string} into the OTP field', { timeout: 60000 }, async function (digits) {
  await tfa(this).pasteOtp(String(digits).trim());
});

When('the user enters a valid OTP and clicks {string}', { timeout: 120000 }, async function (label) {
  const page = tfa(this);
  const code = await page.freshCode(state.secret);
  this._submitted = { kind: 'valid', code };
  await page.enterOtp(code);
  this._result = await page.submitOtp(label);
  this.attach(`submitted valid code ${code} -> ${this._result.status} ${this._result.detail || ''} (clicked "${this._result.usedLabel}")`, 'text/plain');
});

When('the user enters an invalid OTP and clicks {string}', { timeout: 120000 }, async function (label) {
  const page = tfa(this);
  // Not a hard-coded "123456": that collides with the real code roughly once in a million runs,
  // and a flake that rare would be diagnosed as an app defect rather than as a test choosing
  // badly. invalidCode() excludes every code valid in the surrounding four windows.
  const code = invalidCode(state.secret);
  this._submitted = { kind: 'invalid', code };
  await page.enterOtp(code);
  this._result = await page.submitOtp(label);
  this.attach(`submitted invalid code ${code} -> ${this._result.status} ${this._result.detail || ''} (clicked "${this._result.usedLabel}")`, 'text/plain');
});

When('the user enters an expired OTP and clicks {string}', { timeout: 120000 }, async function (label) {
  const page = tfa(this);
  // A code that was GENUINELY VALID two minutes ago — four full 30s steps back, outside any sane
  // server drift window. That is the only honest way to produce an expired code: a random six
  // digits would be merely wrong, and the whole point of this scenario is whether the app tells
  // "wrong" and "stale" apart.
  const code = totp(state.secret, { offsetSeconds: -120 });
  this._submitted = { kind: 'expired', code };
  await page.enterOtp(code);
  this._result = await page.submitOtp(label);
  this.attach(`submitted expired code ${code} (valid at T-120s) -> ${this._result.status} ${this._result.detail || ''} (clicked "${this._result.usedLabel}")`, 'text/plain');
});

When('the 2FA update request fails on submit', { timeout: 120000 }, async function () {
  const page = tfa(this);
  await page.stubUpdateFailure();
  const code = await page.freshCode(state.secret);
  await page.enterOtp(code);
  this._result = await page.submitOtp();
  this.attach(`forced 500 on the 2FA update -> ${this._result.status} ${this._result.detail || ''} (clicked "${this._result.usedLabel}")`, 'text/plain');
});

// ==================== Button state ====================

// `the {string} button should be enabled|disabled` is NOT redefined here. signup.steps.js already
// owns both, generically and by ARIA role, and they resolve correctly against the 2FA dialog's
// Confirm button. Redefining them — or adding a `{word}` variant to serve the Scenario Outline's
// `<state>` — would make every such step in the SUITE ambiguous, not just this feature's.
// The login prompt's submit control, addressed by its job. It names the label it found in the
// attachment, so a green row still records what the button actually reads.
Then('the login 2FA prompt\'s submit button should be disabled', async function () {
  const page = tfa(this);
  this.attach(`the login prompt's submit button reads "${await page.readLoginSubmitLabel()}"`, 'text/plain');
  await expect(page.loginSubmitButton).toBeDisabled({ timeout: 15000 });
});

Then('the login 2FA prompt\'s submit button should be enabled', async function () {
  const page = tfa(this);
  await expect(page.loginSubmitButton).toBeEnabled({ timeout: 15000 });
});

Then('the {string} button should remain enabled', async function (label) {
  const button = this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first();
  await expect(button, `"${label}" should still be enabled after a rejected code`).toBeEnabled({ timeout: 15000 });
});

// ==================== Rejection feedback ====================

Then('the OTP input boxes should turn red', async function () {
  const page = tfa(this);
  await expect
    .poll(async () => (await page.readOtpBoxes()).errored, { timeout: 15000, message: 'the OTP boxes never entered the error state' })
    .toBe(true);
});

Then('the inline error {string} should be displayed', async function (message) {
  const page = tfa(this);
  const { matched, seen, source } = await page.waitForFeedback(messageMatcher(message));
  if (matched) this.attach(`"${message}" found ${source}`, 'text/plain');
  expect(
    matched,
    `expected the message "${message}". The app displayed: ${seen.length ? seen.map((s) => `"${s}"`).join(', ') : '(nothing)'}`
      + (this._result ? ` — API answered ${this._result.status} "${this._result.detail}"` : '')
  ).toBe(true);
});

Then('a success toast {string} should be displayed', async function (message) {
  const page = tfa(this);
  const { matched, seen, source } = await page.waitForFeedback(messageMatcher(message));
  if (matched) this.attach(`"${message}" found ${source}`, 'text/plain');
  expect(matched, `expected the toast "${message}". The app displayed: ${seen.length ? seen.map((s) => `"${s}"`).join(', ') : '(nothing)'}`).toBe(true);
});

Then('a toast {string} should be displayed', async function (message) {
  const page = tfa(this);
  const { matched, seen, source } = await page.waitForFeedback(messageMatcher(message));
  if (matched) this.attach(`"${message}" found ${source}`, 'text/plain');
  expect(matched, `expected the toast "${message}". The app displayed: ${seen.length ? seen.map((s) => `"${s}"`).join(', ') : '(nothing)'}`).toBe(true);
});

// ==================== Resting toggle state ====================

// These do NOT unconditionally reload the page.
//
// Re-reading from the server is what makes "the toggle did not change" a real claim rather than a
// re-read of the render that just failed to change. But a reload discards the success toast, and
// in three scenarios the toast assertion comes AFTER the toggle assertion — so reloading every
// time reported "the app displayed nothing" for a message that had been on screen throughout.
// toggleSettlesOn() polls the live render and only re-fetches when it disagrees, which keeps the
// authoritative answer for the case that needs it and leaves the page alone otherwise.
async function assertToggle(world, want, message) {
  const page = tfa(world);
  const { actual, refreshed } = await page.toggleSettlesOn(want);
  state.enabled = actual;
  world.attach(`2FA toggle read as ${actual ? 'on' : 'off'}${refreshed ? ' (after re-fetching the tab)' : ''}`, 'text/plain');
  expect(actual, message).toBe(want);
}

Then('the 2FA toggle should be on', { timeout: 90000 }, async function () {
  await assertToggle(this, true, '2FA is not enabled');
});

Then('the 2FA toggle should be off', { timeout: 90000 }, async function () {
  await assertToggle(this, false, '2FA is not disabled');
});

Then('the 2FA toggle should remain off', { timeout: 90000 }, async function () {
  await assertToggle(this, false, '2FA became enabled when it should not have');
});

Then('the 2FA toggle should remain on', { timeout: 90000 }, async function () {
  await assertToggle(this, true, '2FA became disabled when it should not have');
});

// ==================== Disable confirmation ====================

Then('the disable confirmation message about reducing account security should be displayed', async function () {
  const page = tfa(this);
  await expect(page.disableHeading).toBeVisible({ timeout: 20000 });
  await expect(page.disableMessage).toBeVisible({ timeout: 15000 });
});

// ==================== Login challenge ====================

When('the user logs in with valid credentials', { timeout: 180000 }, async function () {
  await signIn(this, { fresh: true });
});

When('the user logs out', { timeout: 120000 }, async function () {
  await this.context.clearCookies();
  await this.page.goto(new LoginPage(this.page).url, { waitUntil: 'domcontentloaded' });
  await this.page.waitForTimeout(1000);
});

Then('the login 2FA prompt {string} should be displayed', { timeout: 90000 }, async function (title) {
  const page = tfa(this);
  await page.waitForLoginChallenge();
  const heading = await page.readLoginPromptHeading();
  const submit = await page.readLoginSubmitLabel();
  this.attach(`login challenge at ${this.page.url()} — heading "${heading}", submit button "${submit}"`, 'text/plain');
  expect(
    new RegExp(escapeRegExp(title), 'i').test(heading),
    `the login 2FA prompt is titled "${heading}", not "${title}" (its submit button reads "${submit}")`
  ).toBe(true);
});

// The behavioural half of the step above, with no claim about the copy. Used by the end-to-end
// scenarios so a known copy divergence cannot abandon them before they have proved the thing they
// exist to prove — Cucumber stops a scenario at its first failing step.
Then('the login 2FA prompt should be displayed', { timeout: 90000 }, async function () {
  const page = tfa(this);
  await page.waitForLoginChallenge();
  const boxes = await page.readOtpBoxes();
  this.attach(`login challenge at ${this.page.url()} — heading "${await page.readLoginPromptHeading()}", ${boxes.count} boxes`, 'text/plain');
  expect(boxes.count, 'the login challenge is not showing 6 OTP boxes').toBe(6);
});

Then('the login 2FA prompt should not be displayed', { timeout: 60000 }, async function () {
  await this.page.waitForTimeout(3000);
  expect(
    /\/verify-otp/.test(this.page.url()),
    `a 2FA challenge was raised at ${this.page.url()} for an account with 2FA disabled`
  ).toBe(false);
});

Then('the user should not yet be redirected to the application', async function () {
  expect(/\/verify-otp/.test(this.page.url()), `expected to still be on the 2FA challenge but was at ${this.page.url()}`).toBe(true);
});

Then('the user should not be redirected to the application', async function () {
  await this.page.waitForTimeout(2000);
  const url = this.page.url();
  expect(
    /\/dashboard|\/candidates|\/verifications|\/activity-log/.test(url),
    `the user reached the application at ${url} without completing 2FA`
  ).toBe(false);
});

Then('the user should be redirected to the application', { timeout: 90000 }, async function () {
  await this.page
    .waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 60000 })
    .catch(() => {});
  expect(
    /\/dashboard|\/candidates|\/verifications|\/activity-log/.test(this.page.url()),
    `expected the application but landed on ${this.page.url()}`
  ).toBe(true);
});

When('the user attempts to navigate directly to the application', { timeout: 60000 }, async function () {
  this._bypassFrom = this.page.url();
  await this.page.goto(`${tfa(this).appUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForTimeout(4000);
  this.attach(`navigated from ${this._bypassFrom} to /dashboard and landed on ${this.page.url()}`, 'text/plain');
});

// The app's answer to a bypass attempt: the half-authenticated session is DISCARDED and the user
// is put back on /login, rather than being returned to the challenge TFF-20 describes. Asserted
// as the build behaves (see the note at the scenario), and paired with
// `the user should not be redirected to the application` so the security guarantee is a separate
// step - a future change to where the user is sent must not be able to take that one down with it.
Then('the user should be sent back to the login page', async function () {
  const url = this.page.url();
  this.attach(`bypass attempt from ${this._bypassFrom || '(unknown)'} landed on ${url}`, 'text/plain');
  expect(
    /\/login(\/|\?|$)/.test(url),
    `expected the login page after a bypass attempt but landed on ${url}`
  ).toBe(true);
});

// ================================================================================================
// Teardown
// ================================================================================================

// Per-scenario safety net: a scenario that dies with a dialog half-open leaves the NEXT one
// clicking into a modal it did not open. Only the DOM is reset here — the account's 2FA state is
// deliberately left alone, because ensureState() will fix it for free on the next scenario that
// cares, and disabling after every scenario would cost a code and a round trip 27 times over.
After({ tags: '@2fa' }, async function () {
  if (!this.page || this.page.isClosed()) return;
  await this.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
});

// End-of-run restore. This is what keeps the fixture usable: an agent left with 2FA on can only be
// logged into by something holding its secret.
//
// It runs on its OWN browser. hooks.js closes the shared one in an AfterAll of its own, and
// support files are required before step definitions, so that hook is registered first and
// therefore runs first — the shared browser is already gone by the time this executes.
AfterAll({ timeout: 300000 }, async function () {
  if (state.enabled !== true || !state.secret) return;
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const world = { page, context, _tfa: null, _tfaPage: null };
    const tf = new TwoFactorAuthPage(page);

    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);

    if (/\/verify-otp/.test(page.url())) {
      await tf.waitForLoginChallenge();
      await tf.enterOtp(await tf.freshCode(state.secret));
      await tf.submitOtp();
      await page.waitForURL((u) => !/\/verify-otp/.test(String(u)), { timeout: 45000 }).catch(() => {});
    }

    await tf.openSecurityTab();
    if (await tf.isEnabled()) {
      await tf.clickToggle();
      await tf.clickTurnOff();
      await tf.enterOtp(await tf.freshCode(state.secret));
      await tf.submitOtp();
      await page.waitForTimeout(2500);
    }
    await tf.refresh();
    const left = await tf.isEnabled();
    state.enabled = left;
    // eslint-disable-next-line no-console
    console.log(left
      ? `\n!! 2FA IS STILL ENABLED on ${EMAIL}. Recover with: node scripts/reset-2fa-agent.js ${state.secret}\n`
      : `\n2FA teardown: ${EMAIL} left with 2FA OFF.\n`);
    void world;
  } catch (e) {
    // Never throw out of teardown: a cleanup error would be reported instead of the run's own
    // result. The recovery command is printed instead, which is the actionable part.
    // eslint-disable-next-line no-console
    console.log(`\n!! 2FA teardown failed (${e.message.split('\n')[0]}). Recover with: node scripts/reset-2fa-agent.js ${state.secret}\n`);
  } finally {
    await browser.close().catch(() => {});
  }
});

void Status;
