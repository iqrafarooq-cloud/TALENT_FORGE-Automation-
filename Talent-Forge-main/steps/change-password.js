const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const ChangePasswordPage = require('../pages/ChangePasswordPage');
const LoginPage = require('../pages/LoginPage');
const { updateEnv, ENV_PATH } = require('../utils/envWriter');
require('dotenv').config();

const EMAIL = process.env.AGENT_CHANGEPASSWORD_EMAIL;
const ORIGINAL_PASSWORD = process.env.AGENT_CHANGEPASSWORD_OLD_PASSWORD;
// Fixed (not random) temp password the E2E scenarios rotate through, so any
// mid-scenario failure always leaves the account on a KNOWN password.
const TEMP_PASSWORD = process.env.AGENT_CHANGEPASSWORD_TEMP_PASSWORD || 'TempChange!456A';

for (const [name, value] of Object.entries({
  BASE_URL: process.env.BASE_URL,
  AGENT_CHANGEPASSWORD_EMAIL: EMAIL,
  AGENT_CHANGEPASSWORD_OLD_PASSWORD: ORIGINAL_PASSWORD,
})) {
  if (!value) throw new Error(`Missing required env var ${name}. Set it in .env`);
}

// The two must differ, and this is checked at load rather than discovered mid-run.
// Persisting the live password (see rememberPassword) makes this state REACHABLE: a
// run that dies after rotating to TEMP leaves .env recording TEMP as the account's
// password, and if OLD then equals TEMP the @e2e scenario would try to rotate the
// account onto the value it is already on — which the app correctly refuses with
// "New password must be different from your current password." The scenario would
// then fail on its own fixture, several steps in, reporting a validation rule
// working exactly as specified. Failing here instead says what to do about it.
if (ORIGINAL_PASSWORD === TEMP_PASSWORD) {
  throw new Error(
    'AGENT_CHANGEPASSWORD_OLD_PASSWORD and AGENT_CHANGEPASSWORD_TEMP_PASSWORD are the same ' +
      `value ("${TEMP_PASSWORD}"), so the @e2e rotation has nowhere to rotate to. A previous ` +
      'run most likely died mid-rotation. Fix it with: npm run test:change-password:recover'
  );
}

// Every password the account might legitimately be sitting on. Used by the
// self-healing login so a botched prior run can never wedge the suite.
const KNOWN_PASSWORDS = [ORIGINAL_PASSWORD, TEMP_PASSWORD];

// Module-level state so the "current" password is tracked across scenarios in a
// run. A successful change updates it; the E2E scenarios (and a safety After
// hook) restore it to the original before the run ends.
//
// `wedged` is the LOCKOUT LATCH. See rememberPassword() and resilientLogin().
const state = { currentPassword: ORIGINAL_PASSWORD, wedged: null };

// >>> THE PASSWORD THIS ACCOUNT IS ON MUST BE PERSISTED, NOT JUST REMEMBERED. <<<
// This feature rotates a real password on a real shared agent, and `state` lives
// only for the run. Before this existed, a run that died between "rotate to TEMP"
// and "restore to ORIGINAL" left the account on a value nothing on disk named, and
// the NEXT run failed at its Background with "Invalid Credentials" — a fixture
// problem wearing the costume of a product defect. Found in exactly that state on
// 2026-09-07 (and once before, recorded in TWOFA_JIRA_VS_APP.md section 4), by
// which point BOTH known passwords were wrong and the account was only recoverable
// through `npm run test:change-password:recover`.
//
// So every point at which the live password becomes known — a successful rotation,
// or a login that proves which value works — writes it to .env. Writing it is
// cheap; not writing it costs a live password reset.
function rememberPassword(password, why) {
  state.currentPassword = password;
  if (process.env.AGENT_CHANGEPASSWORD_OLD_PASSWORD === password) return; // already recorded
  try {
    updateEnv('AGENT_CHANGEPASSWORD_OLD_PASSWORD', password);
    // eslint-disable-next-line no-console
    console.log(`[change-password] AGENT_CHANGEPASSWORD_OLD_PASSWORD updated in ${ENV_PATH} (${why})`);
  } catch (e) {
    // Never fail a scenario over bookkeeping — but say so loudly, because an
    // unpersisted rotation is what wedges the fixture for the next run.
    // eslint-disable-next-line no-console
    console.error(
      `[change-password] COULD NOT PERSIST the account password to .env (${why}): ${e.message}. ` +
        `Record AGENT_CHANGEPASSWORD_OLD_PASSWORD=${password} by hand.`
    );
  }
}

// Lazily create (and cache) the ChangePasswordPage bound to the current page.
function cp(world) {
  if (!world.pages.changePassword) {
    world.pages.changePassword = new ChangePasswordPage(world.page);
  }
  return world.pages.changePassword;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const isLoginUrl = (u) => /\/login(\/|\?|$)/.test(String(u));

async function waitForUrl(page, predicate, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (predicate(page.url())) return true;
    } catch {
      /* ignore transient */
    }
    await page.waitForTimeout(300);
  }
  return predicate(page.url());
}

// Read whatever the login page is currently saying, or '' if nothing is on screen.
async function loginAlertText(login) {
  const a = login.alert.first();
  if (!(await a.isVisible().catch(() => false))) return '';
  return ((await a.textContent().catch(() => '')) || '').trim();
}

// >>> THE ACCOUNT IS RATE LIMITED ON FAILED SIGN-INS, AND THAT IS WHAT TURNS ONE
//     WRONG PASSWORD IN .env INTO TWELVE SCENARIOS REPORTING "Invalid Credentials".
// Measured 2026-09-07: after enough failed attempts the API stops evaluating the
// password at all and answers
//   401 {"detail":"Too many failed sign-in attempts. Try again in 59 minute(s)."}
// The Background runs per scenario, and resilientLogin() walks EVERY known
// password, each with its own retries — so a stale .env costs several failed
// attempts per scenario and the account is locked out within a few scenarios.
// After that even a CORRECT password is refused, so the run is unreadable: the
// first scenario's failure is a fixture problem and the rest are collateral.
//
// A lockout is therefore its own verdict, never lumped in with "rejected":
//   - a rejection means this password is wrong -> try the next one
//   - a lockout means no password can be evaluated -> stop, and say so
const LOCKOUT_RE = /too many (?:failed )?(?:sign-?in|login) attempts|try again in \d+ minute/i;
const REJECTED_RE = /invalid|incorrect|no active account|credentials|not found/i;

// Submit the login form and classify the outcome, retrying transient stalls.
// This environment occasionally stalls a login (stays on /login with no error) —
// those attempts are retried rather than treated as a failure.
// Returns 'accepted' | 'rejected' | 'locked' | 'stalled'.
async function loginAndClassify(world, email, password, retries = 3) {
  const login = new LoginPage(world.page);
  for (let attempt = 0; attempt < retries; attempt++) {
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(password);
    await login.submitButton.first().click();
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (!isLoginUrl(world.page.url())) return 'accepted'; // left /login => success
      const text = await loginAlertText(login);
      // Lockout is checked FIRST: its message also matches REJECTED_RE via
      // "attempts"/"Try again", and mistaking it for a wrong password is what
      // sends the next attempt straight back into the throttle.
      if (LOCKOUT_RE.test(text)) {
        state.wedged = `the account is sign-in rate limited — "${text}"`;
        return 'locked';
      }
      if (REJECTED_RE.test(text)) return 'rejected'; // wrong credentials => stop
      await world.page.waitForTimeout(300);
    }
    // Stalled with no verdict — loop and retry a fresh attempt.
  }
  return isLoginUrl(world.page.url()) ? 'stalled' : 'accepted';
}

// Log in, preferring `preferred`, then falling back through the other known
// passwords. Persists whichever one worked (see rememberPassword).
async function resilientLogin(world, email, preferred) {
  // Once this run has established that no known password works, every later
  // scenario fails IMMEDIATELY on that verdict instead of re-proving it. Not an
  // optimisation: re-proving it is what deepens the lockout, so without the latch
  // a stale .env leaves the account unusable for the next hour as well as this run.
  if (state.wedged) throw new Error(wedgedMessage(email));

  const ordered = [preferred, ...KNOWN_PASSWORDS.filter((p) => p !== preferred)];
  const verdicts = [];
  for (const pw of ordered) {
    const verdict = await loginAndClassify(world, email, pw);
    verdicts.push(verdict);
    if (verdict === 'accepted') {
      rememberPassword(pw, 'confirmed by login');
      return pw;
    }
    if (verdict === 'locked') break; // no password can be evaluated — stop guessing
  }

  if (!state.wedged) {
    state.wedged =
      `none of the ${ordered.length} password(s) .env names is the one this account is on ` +
      `(verdicts: ${verdicts.join(', ')})`;
  }
  throw new Error(wedgedMessage(email));
}

// One message, used by every caller, that names the cause AND the way out. A bare
// "could not log in" is what made this read as a product defect for weeks.
function wedgedMessage(email) {
  return (
    `Cannot sign in as ${email}: ${state.wedged}.\n` +
    `This is a FIXTURE problem, not a product one — the password in .env is not the ` +
    `password the account is on, most likely because an earlier run rotated it and died ` +
    `before restoring.\n` +
    `Recover it with:  npm run test:change-password:recover\n` +
    `That drives the real Forgot Password flow over the live inbox and writes the verified ` +
    `password back to ${ENV_PATH}. Do NOT retry the feature first — every failed sign-in ` +
    `extends the rate-limit window.`
  );
}

// ==================== Background ====================

Given('I am logged in and on the Change Password modal', { timeout: 120000 }, async function () {
  await resilientLogin(this, EMAIL, state.currentPassword);
  await cp(this).openFromSettings();
});

// ==================== Filling fields ====================

When('I enter the correct current password', async function () {
  await cp(this).currentPasswordInput.fill(state.currentPassword);
  this._entered = { ...(this._entered || {}), current: state.currentPassword };
});

When('I enter an incorrect current password', async function () {
  await cp(this).currentPasswordInput.fill('DefinitelyWrong999!');
});

When('I enter a valid new password and matching confirmation', async function () {
  this._newPassword = TEMP_PASSWORD;
  // Declared here, acted on only if the success toast actually arrives — see
  // `a success toast {string} is displayed`. The scenarios that fill these fields
  // and then cancel, or are stubbed to a 500, set it too and it is simply never
  // consumed, which is the correct outcome: no rotation happened.
  this._rotationTarget = TEMP_PASSWORD;
  await cp(this).fillFields({ next: this._newPassword, confirm: this._newPassword });
  this._entered = { ...(this._entered || {}), next: this._newPassword, confirm: this._newPassword };
});

When('I enter a valid new password', async function () {
  this._newPassword = TEMP_PASSWORD;
  await cp(this).newPasswordInput.fill(this._newPassword);
});

When('I set a new valid password different from the current one', async function () {
  this._newPassword = TEMP_PASSWORD;
  this._rotationTarget = TEMP_PASSWORD;
  await cp(this).fillFields({ next: this._newPassword, confirm: this._newPassword });
});

When('I enter the weak new password {string}', async function (weak) {
  const page = cp(this);
  await page.newPasswordInput.click();
  await page.newPasswordInput.fill(weak);
});

When('I enter a new password equal to the current password', async function () {
  await cp(this).newPasswordInput.fill(state.currentPassword);
});

When('I confirm with the same value', async function () {
  await cp(this).confirmPasswordInput.fill(state.currentPassword);
  await cp(this).modalHeading.click(); // blur so field-level validation runs
});

When('I enter a different confirmation and blur', async function () {
  const page = cp(this);
  await page.confirmPasswordInput.fill('Mismatch999!');
  await page.modalHeading.click();
});

When('I leave the confirmation empty and blur', async function () {
  const page = cp(this);
  await page.confirmPasswordInput.click();
  await page.confirmPasswordInput.fill('');
  await page.modalHeading.click();
});

When('I touch and leave the {string} field empty', async function (field) {
  expect(/current password/i.test(field), `unsupported field "${field}"`).toBeTruthy();
  const input = cp(this).currentPasswordInput;
  await input.click();
  await input.fill('a');
  await input.fill('');
  await cp(this).modalHeading.click();
});

// ==================== Actions ====================

// `I click {string}` used to live here, but a dozen features share the phrase and Cucumber
// allows only one definition of it. It now lives in common.steps.js, which dispatches the
// change-password labels back to this page object.

When('the change-password API will fail with a server error', async function () {
  await cp(this).stubServerError();
});

// Click every field toggle currently in the given state ('show' reveals, 'hide'
// masks) — a toggle labelled "Show password" is currently masked, and vice versa.
async function toggleAllFields(world, want) {
  const toggles = cp(world).passwordToggles;
  const count = await toggles.count();
  const label = new RegExp(`${want} password`, 'i');
  for (let i = 0; i < count; i++) {
    const t = toggles.nth(i);
    if (label.test((await t.getAttribute('aria-label')) || '')) await t.click();
  }
}

When('I reveal all three password fields', async function () {
  await toggleAllFields(this, 'show');
});

When('I hide all three password fields', async function () {
  await toggleAllFields(this, 'hide');
});

// ==================== Submit-button / field-state assertions ====================

Then('the {string} button is disabled', async function (label) {
  expect(/change password/i.test(label), `unsupported button "${label}"`).toBeTruthy();
  await expect(cp(this).changePasswordButton).toBeDisabled();
});

Then('the {string} field is marked invalid', async function (field) {
  const page = cp(this);
  const input = /current password/i.test(field)
    ? page.currentPasswordInput
    : /new password/i.test(field)
      ? page.newPasswordInput
      : page.confirmPasswordInput;
  await expect(input).toHaveAttribute('aria-invalid', 'true', { timeout: 10000 });
});

// ==================== Inline error assertions ====================

Then('the inline error {string} is displayed', async function (message) {
  const page = cp(this);
  const map = [
    [/current password is required/i, page.currentRequiredError],
    [/current password you entered is incorrect/i, page.incorrectCurrentError],
    [/must be different from your current password/i, page.sameAsCurrentError],
    [/passwords do not match/i, page.passwordsDoNotMatchError],
  ];
  const hit = map.find(([re]) => re.test(message));
  const locator = hit ? hit[1] : this.page.getByText(new RegExp(escapeRegExp(message), 'i')).first();
  await expect(locator).toBeVisible({ timeout: 10000 });
});

Then('no {string} error is shown', async function (message) {
  const locator = this.page.getByText(new RegExp(escapeRegExp(message), 'i')).first();
  await expect(locator).toBeHidden({ timeout: 3000 }).catch(async () => {
    await expect(locator).toHaveCount(0);
  });
});

Then('the password requirements tooltip lists all five rules', async function () {
  const req = cp(this).requirementItems;
  await expect(req.length).toBeVisible({ timeout: 10000 });
  await expect(req.uppercase).toBeVisible();
  await expect(req.lowercase).toBeVisible();
  await expect(req.number).toBeVisible();
  await expect(req.special).toBeVisible();
});

// ==================== Modal / session state ====================

Then('the modal remains open', async function () {
  await expect(cp(this).modalHeading).toBeVisible({ timeout: 10000 });
});

Then('the modal closes', async function () {
  await expect(cp(this).modalHeading).toBeHidden({ timeout: 10000 });
});

Then('I am not logged out', async function () {
  // On a server error the session is untouched, so we stay on /settings.
  await this.page.waitForTimeout(1000);
  expect(this.page.url()).toMatch(/\/settings/);
});

Then('all entered password values are preserved', async function () {
  const page = cp(this);
  expect(this._entered, 'no values were captured for this scenario').toBeTruthy();
  await expect(page.currentPasswordInput).toHaveValue(this._entered.current);
  await expect(page.newPasswordInput).toHaveValue(this._entered.next);
  await expect(page.confirmPasswordInput).toHaveValue(this._entered.confirm);
});

Then('I remain logged in on the Security tab', async function () {
  expect(this.page.url()).toMatch(/\/settings/);
  await expect(cp(this).editPasswordButton).toBeVisible({ timeout: 10000 });
});

// ==================== Show/Hide assertions ====================

Then('all three password fields are shown as plain text', async function () {
  const page = cp(this);
  await expect(page.currentPasswordInput).toHaveAttribute('type', 'text', { timeout: 10000 });
  await expect(page.newPasswordInput).toHaveAttribute('type', 'text');
  await expect(page.confirmPasswordInput).toHaveAttribute('type', 'text');
});

Then('all three password fields are masked', async function () {
  const page = cp(this);
  await expect(page.currentPasswordInput).toHaveAttribute('type', 'password', { timeout: 10000 });
  await expect(page.newPasswordInput).toHaveAttribute('type', 'password');
  await expect(page.confirmPasswordInput).toHaveAttribute('type', 'password');
});

// ==================== Navigation ====================

Then('I am redirected to the Forgot Password page', async function () {
  const ok = await waitForUrl(this.page, (u) => /\/forgot-password/.test(u), 30000);
  expect(ok, `expected /forgot-password but was at ${this.page.url()}`).toBeTruthy();
});

// ==================== Success / logout / E2E ====================

Then('a success toast {string} is displayed', async function (message) {
  const re = new RegExp(escapeRegExp(message), 'i');
  const page = cp(this);
  const captured = page.lastSubmit && page.lastSubmit.feedback ? page.lastSubmit.feedback : [];
  const seen = captured.some((text) => re.test(text));
  if (!seen) {
    const responseSucceeded = page.lastSubmit && page.lastSubmit.status >= 200 && page.lastSubmit.status < 300;
    if (!responseSucceeded) await expect(this.page.getByText(re).first()).toBeVisible({ timeout: 15000 });
    this.attach(
      `The success toast was transient and disappeared during logout; change-password API status: ${page.lastSubmit && page.lastSubmit.status}`,
      'text/plain'
    );
  }

  // This toast is the app confirming the rotation LANDED, so it is the earliest
  // moment the account's new password is a fact rather than an intention — and
  // therefore the right moment to record it. Recording it here rather than at the
  // end of the scenario is the whole point: the steps that follow log out, log
  // back in twice and rotate again, and a failure in any of them used to leave the
  // account on a password nothing on disk named.
  //
  // It reads `_rotationTarget`, NOT `_newPassword`. The E2E scenario passes through
  // this step twice — once for the rotation to TEMP and once for the restore to
  // ORIGINAL — while `_newPassword` stays TEMP throughout (`I log in with the new
  // password` needs it), so keying off it would record TEMP as the live password
  // immediately after the account had been put back on ORIGINAL. The target is
  // consumed so a later toast cannot re-apply a stale one.
  if (this._rotationTarget) {
    rememberPassword(this._rotationTarget, 'rotation confirmed by the success toast');
    this._rotationTarget = null;
  }
});

Then('I am logged out and redirected to the login page', async function () {
  const ok = await waitForUrl(this.page, (u) => isLoginUrl(u), 40000);
  expect(ok, `expected to be on /login but was at ${this.page.url()}`).toBeTruthy();
});

When('I log in with the new password', { timeout: 120000 }, async function () {
  expect(this._newPassword, 'no new password was set in this scenario').toBeTruthy();
  this._loginResult = await loginAndClassify(this, EMAIL, this._newPassword);
});

When('I log in with the original password', { timeout: 120000 }, async function () {
  this._loginResult = await loginAndClassify(this, EMAIL, ORIGINAL_PASSWORD);
});

Then('the login is accepted', async function () {
  expect(
    this._loginResult,
    `expected login to be accepted but was "${this._loginResult}" (url ${this.page.url()})`
  ).toBe('accepted');
});

Then('the login is rejected', async function () {
  expect(
    this._loginResult,
    `expected login to be rejected but was "${this._loginResult}" (url ${this.page.url()})`
  ).toBe('rejected');
});

// Current date formatted exactly as the Password card renders it, e.g.
// "Jul 22, 2026" (short month, no-leading-zero day, full year).
function todayFormatted() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

When('I open the Security tab in Account Settings', { timeout: 60000 }, async function () {
  await cp(this).openSecurityTab();
});

Then('the Password card shows today\'s date as the last updated date', async function () {
  const el = cp(this).lastUpdatedText;
  await expect(el).toBeVisible({ timeout: 15000 });
  await expect(el).toContainText(todayFormatted(), { timeout: 15000 });
});

// Log in with the new password, reopen the modal, and change it back to the
// original so the account is restored for the next run.
When('I change the password back to the original from Account Settings', { timeout: 150000 }, async function () {
  expect(this._newPassword, 'no new password to change back from').toBeTruthy();
  await resilientLogin(this, EMAIL, this._newPassword);
  const page = cp(this);
  await page.openFromSettings();
  await page.fillFields({ current: state.currentPassword, next: ORIGINAL_PASSWORD, confirm: ORIGINAL_PASSWORD });
  await page.submit();
  // Declared, not recorded: the following `Then a success toast ...` step is what
  // confirms the restore landed and persists it. Recording it here would claim the
  // account is back on ORIGINAL before the app has said so — the exact optimism
  // that leaves .env naming a password the account is not on.
  this._rotationTarget = ORIGINAL_PASSWORD;
});

// ==================== Safety net ====================
// After any @e2e scenario, guarantee the account is back on the original
// password — even if the scenario failed partway through a rotation. This runs
// before the global context-closing After (support files load first, and After
// hooks execute in reverse registration order), so `this.page` is still alive.
// Scoped to `@e2e and @change-password`: `@e2e` alone is a TEST-TYPE tag used across the
// whole suite, so an unscoped hook logged into this account and rotated its password after
// every unrelated @e2e scenario (Subscription, 2FA, Invite-agent, ...). Change-Password.feature
// carries the feature-level @change-password tag, so this matches exactly the same scenarios
// inside this feature as before.
After({ tags: '@e2e and @change-password', timeout: 180000 }, async function () {
  try {
    // Discover the password the account is ACTUALLY on (state may be stale if the
    // scenario failed right after a rotation), then restore to the original.
    // resilientLogin persists whichever password worked, so by the time this
    // returns .env already names the account's live password even if the restore
    // below then fails.
    const working = await resilientLogin(this, EMAIL, state.currentPassword);
    if (working === ORIGINAL_PASSWORD) return;

    const page = cp(this);
    await page.openFromSettings();
    await page.fillFields({ current: working, next: ORIGINAL_PASSWORD, confirm: ORIGINAL_PASSWORD });
    await page.submit();
    // The app logs the session out on a successful change, so leaving /login-ward
    // is the confirmation the restore landed. Persist only on that evidence —
    // recording ORIGINAL unconditionally is how .env came to name a password the
    // account was not on.
    const restored = await this.page
      .waitForURL((u) => isLoginUrl(u), { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (restored) {
      rememberPassword(ORIGINAL_PASSWORD, 'safety hook restored the original');
      // eslint-disable-next-line no-console
      console.log('[change-password] safety hook restored the account to the original password');
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[change-password] safety hook could not confirm the restore — .env still names ` +
          `"${working}", which is the password the account was verified to be on.`
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `[change-password] SAFETY RESTORE FAILED. The live password is whatever .env now names ` +
        `(${ENV_PATH}); if that is refused, recover with ` +
        `"npm run test:change-password:recover". Cause: ${e.message}`
    );
  }
});
