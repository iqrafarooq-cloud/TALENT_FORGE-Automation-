// >>> THIS ENVIRONMENT STALLS A LOGIN, AND A BIGGER TIMEOUT IS THE WRONG FIX. <<<
//
// Measured repeatedly across three full runs of candidate-view-profile.feature: 2 of 45, then
// 0 of 45, then 1 of 45 scenarios died in their Background with
// `page.waitForURL: Timeout ... waiting for navigation until "commit"`. Every one of them passed
// immediately when re-run alone, so the login SUCCEEDS on a retry - the attempt simply never
// completes. It hit candidate-deactivated.feature the same way on its first full run.
//
// **RAISING THE WAIT WAS TRIED AND DID NOT WORK.** 60s -> 120s, and the next run blew through
// 120s on a different scenario. A stalled attempt never completes however long you wait; a bigger
// timeout only makes the run slower before reporting the same thing. That wrong turn is recorded
// because the failure message invites exactly it.
//
// So each attempt is BOUNDED and its outcome CLASSIFIED:
//
//   | observed                                              | verdict                          |
//   | the URL left /login for an expected route             | accepted                         |
//   | an error is on screen (invalid / credentials / ...)   | REJECTED - fails NOW, no retry   |
//   | "too many attempts" / "try again in N minutes"        | LOCKED OUT - fails NOW, no retry |
//   | still on /login, nothing said                         | stalled - re-navigate and retry  |
//
// >>> A REJECTION MUST NOT BE RETRIED. <<< Failed sign-ins are rate limited on this backend
// (`401 "Too many failed sign-in attempts. Try again in 59 minute(s)."`), so retrying a wrong
// password deepens a lockout and turns one fixture problem into a whole unusable run - see the
// Change Password notes in CLAUDE.md, where exactly that happened. Lockout is checked FIRST,
// because its wording also matches the rejection pattern via "attempts"/"try again", and
// mistaking one for the other sends the next attempt straight back into the throttle.
//
// >>> ONE IMPLEMENTATION, DELIBERATELY. <<< This used to live as a module-local function inside
// steps/candidate-view-profile.js while steps/active-candidate.js - whose `I am logged in as an
// agent` is the Background of the Active, Requires Attention and Deactivated features - had a
// bare waitForURL and no retry at all. Two copies of a login is how they drift; a second copy
// hardened while the shared one is not is how a fixed flake goes on failing everywhere else.
const LoginPage = require('../pages/LoginPage');

const isLoginUrl = (u) => /\/login(\/|\?|$)/.test(String(u));
const LOCKOUT_RE = /too many (?:failed )?(?:sign-?in|login) attempts|try again in \d+ minute/i;
const REJECTED_RE = /invalid|incorrect|no active account|credentials|not found/i;

// Where a successful agent/candidate login is allowed to land. The app chooses between these
// depending on the account's state, so a caller that pins one of them fails on a correct login.
const DEFAULT_LANDING = /\/dashboard|\/candidates|\/getting-started|\/profile|\/home/;

/**
 * Sign in, tolerating this environment's stall and refusing to retry a real rejection.
 *
 * @param {object} world     the Cucumber world (needs `page`, and `attach` if you want evidence)
 * @param {string} email
 * @param {string} password
 * @param {object} [options]
 * @param {RegExp} [options.landedOn]    routes that count as a successful landing
 * @param {number} [options.attempts]    how many stalled attempts to tolerate (default 3)
 * @param {number} [options.perAttempt]  ms to give each attempt before calling it stalled
 * @returns {Promise<string>} the URL landed on
 */
async function resilientSignIn(world, email, password, options = {}) {
  const {
    landedOn = DEFAULT_LANDING,
    attempts = 3,
    perAttempt = 30000,
  } = options;

  if (!email || !password) {
    throw new Error(
      'resilientSignIn was given no email or no password - check the .env keys the caller reads. '
      + 'Failing here rather than submitting an empty form, which the app answers with the same '
      + 'generic error a wrong password gets and which would then look like a credential problem.'
    );
  }

  const login = new LoginPage(world.page);
  const trace = [];

  const attach = async (title, payload) => {
    if (typeof world.attach !== 'function') return;
    // AWAITED. An un-awaited attach is dropped when the world is torn down, which is how the
    // promo module's "could not restore" warning never reached a single report.
    await world.attach(`${title}\n${JSON.stringify(payload, null, 2)}`, 'text/plain');
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    /* eslint-disable no-await-in-loop */
    try {
      await login.navigate();
      await login.emailInput.first().fill(email);
      await login.passwordInput.first().fill(password);
      await login.submitButton.first().click();
    } catch (e) {
      // The login page itself never painted its form - observed under 4 parallel workers
      // (2026-10-07). That is the same environmental stall as a submit that goes nowhere, so it
      // is retried; a credential problem can never surface before the form has rendered.
      trace.push({ attempt, outcome: 'login form never rendered', error: String(e.message).split('\n')[0] });
      continue;
    }

    const deadline = Date.now() + perAttempt;
    while (Date.now() < deadline) {
      const url = world.page.url();
      if (!isLoginUrl(url) && landedOn.test(url)) {
        trace.push({ attempt, outcome: 'accepted', url });
        // Only reported when a retry was needed, so a run that needed one is visible rather than
        // silently slower.
        if (attempt > 1) await attach(`signed in as ${email} on attempt ${attempt}`, trace);
        return url;
      }

      const alert = login.alert.first();
      const text = (await alert.isVisible().catch(() => false))
        ? ((await alert.textContent().catch(() => '')) || '').trim()
        : '';

      if (text && LOCKOUT_RE.test(text)) {
        await attach(`sign-in LOCKED OUT for ${email}`, [...trace, { attempt, text }]);
        throw new Error(
          `sign-in is rate limited for ${email}: "${text}". Retrying would only deepen the `
          + 'lockout, so it fails here. The throttle is per ACCOUNT, not per IP, so the rest of '
          + 'the suite is unaffected - wait it out, or check the password in .env, since a wrong '
          + 'one is what causes this.'
        );
      }
      if (text && REJECTED_RE.test(text)) {
        await attach(`sign-in REFUSED for ${email}`, [...trace, { attempt, text }]);
        throw new Error(
          `sign-in was refused for ${email}: "${text}". This is a credential problem, not a stall `
          + '- retrying would only deepen the rate limit, so it fails here. Check .env.'
        );
      }

      await world.page.waitForTimeout(300);
    }

    trace.push({ attempt, outcome: 'stalled on /login with no error', url: world.page.url() });
    /* eslint-enable no-await-in-loop */
  }

  await attach(`sign-in STALLED for ${email}`, trace);
  throw new Error(
    `sign-in as ${email} stalled on /login ${attempts} times with no error shown. The form was `
    + `submitted and the app never navigated - the known stall on this environment. Each attempt `
    + `was given ${perAttempt}ms and retried fresh, so this is not a timeout that a bigger budget `
    + 'would fix.'
  );
}

module.exports = { resilientSignIn, isLoginUrl, LOCKOUT_RE, REJECTED_RE, DEFAULT_LANDING };
