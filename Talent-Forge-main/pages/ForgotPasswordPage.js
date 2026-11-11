const BasePage = require('./BasePage');

// ForgotPasswordPage — Page Object covering the three screens of the reset flow:
//   1. /forgot-password              — request a reset link (email + "Send Reset Email")
//   2. /forgot-password/check-email  — enumeration-safe confirmation ("Check your inbox!")
//   3. /reset-password?uid=&token=   — set a new password ("Set a new password")
//
// Selector strategy follows the project convention: data-testid -> ARIA/role ->
// semantic HTML (name/type) -> placeholder / text fallback. data-testid candidates
// are listed first even though the current build exposes none, so the suite
// auto-upgrades when the app team adds them.
class ForgotPasswordPage extends BasePage {
  constructor(page) {
    super(page);
    this.forgotUrl = (process.env.BASE_URL || '').replace(/\/login\/?$/, '/forgot-password');

    // ---- Screen 1: /forgot-password ----
    this.emailInput = page.locator(
      '[data-testid="forgot-email-input"], input[name="email"], input[type="email"], input[placeholder*="email" i], input[type="text"]'
    ).first();
    this.sendButton = page
      .getByRole('button', { name: /send reset email|send reset|reset email|continue/i })
      .first();
    this.backToLoginButton = page.getByRole('button', { name: /back to log ?in/i }).first();
    this.forgotHeading = page.getByRole('heading', { name: /forgot password/i }).first();
    // Inline email-format validation helper text.
    this.emailValidationMessage = page
      .getByText(/please enter a valid email|valid email address|invalid email|email is required/i)
      .first();

    // ---- Screen 2: /forgot-password/check-email ----
    this.checkEmailHeading = page.getByRole('heading', { name: /check your inbox/i }).first();
    // Enumeration-safe message shown regardless of whether the account exists.
    this.genericSentMessage = page
      .getByText(/if an account exists.*reset link has been sent|sent a password reset link/i)
      .first();
    this.resendButton = page.getByRole('button', { name: /resend email/i }).first();

    // ---- Screen 3: /reset-password ----
    this.resetHeading = page.getByRole('heading', { name: /set a new password/i }).first();
    this.newPasswordInput = page.locator(
      '[data-testid="reset-new-password"], input[name="newPassword"], input[placeholder="Enter new password"]'
    ).first();
    this.confirmPasswordInput = page.locator(
      '[data-testid="reset-confirm-password"], input[name="confirmNewPassword"], input[placeholder="Re-enter password"]'
    ).first();
    this.resetSubmitButton = page
      .getByRole('button', { name: /^reset password$/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    // Show/Hide toggles (there are two — one per field).
    this.passwordToggles = page.locator(
      'button[aria-label="Show password"], button[aria-label="Hide password"]'
    );

    // Validation / requirement feedback.
    this.notMeetRequirementsError = page.getByText(/doesn't meet all requirements|does not meet all requirements/i).first();
    this.passwordsDoNotMatchError = page.getByText(/passwords do not match/i).first();

    // >>> THE THROTTLE SURFACE. `POST /auth/password-reset/` AND
    //     `GET /auth/password-reset/validate/` SHARE ONE ANONYMOUS RATE LIMIT, AND EACH OF THE
    //     TWO FAILURES IT PRODUCES LOOKS LIKE SOMETHING ELSE ENTIRELY.
    //
    //     Measured live 2026-09-03 against dev:
    //       submit throttled   -> 429 {"detail":"Request was throttled. Expected available in
    //         2234 seconds."}; the page STAYS on /forgot-password and renders that sentence as
    //         a toast. The check-email heading never arrives, so an unguarded assertion reports
    //         "element(s) not found" against a heading that is working perfectly.
    //       validate throttled -> the app sends a VALID link to /reset-password/link-expired and
    //         says "This link has expired". Proved by opening the SAME link twice: the 429 gave
    //         Link Expired, the 200 gave {"valid":true,...} and the form. "Expired" there is the
    //         app's own mistranslation of a rate limit, not the token's state.
    //
    //     Both are read from the NETWORK, not inferred from the DOM: the toast is transient and
    //     the Link Expired page is byte-identical to a genuinely dead link's. The toast stays as
    //     a secondary read for when a response body is torn down by the navigation.
    this.throttleNotice = page.getByText(/request was throttled/i).first();
    this.requirementItems = {
      length: page.getByText(/at least 8 characters/i).first(),
      uppercase: page.getByText(/at least one uppercase/i).first(),
      lowercase: page.getByText(/at least one lowercase/i).first(),
      number: page.getByText(/at least one number/i).first(),
      special: page.getByText(/at least one special/i).first(),
    };

    // ---- Screen 3b: /reset-password expired/invalid token state ("Link Expired") ----
    this.linkExpiredHeading = page
      .getByRole('heading', { name: /link expired/i })
      .first();
    // Rendered as a button or a link depending on the build.
    this.goToForgotPasswordButton = page
      .getByRole('button', { name: /go to forgot password/i })
      .or(page.getByRole('link', { name: /go to forgot password/i }))
      .first();

    // Generic feedback surface (MUI Alert / notistack) for success/error toasts.
    this.alert = page.locator(
      '[role="alert"], .notistack-Snackbar, .MuiAlert-message'
    );
  }

  // Craft a reset URL whose token is (treated as) expired. Used by the negative
  // Link-Expired scenarios so they never call the rate-limited send-email flow —
  // the backend surfaces the same "Link Expired" page for expired and bad tokens.
  expiredResetLink() {
    const origin = new URL(process.env.BASE_URL).origin;
    return `${origin}/reset-password?uid=MTA4NTE&token=expired-token-000000000000000000000000`;
  }

  // Record every password-reset API answer this page produces. Attached once per page and from
  // both navigations, so no step has to remember to switch it on. A missed body is tolerated:
  // the status alone is what every throttle check below reads.
  watchResetRequests() {
    if (this._watchingResetRequests) return;
    this._watchingResetRequests = true;
    this.resetResponses = [];
    this.page.on('response', async (res) => {
      if (!/\/auth\/password-reset\//.test(res.url())) return;
      let body = '';
      try {
        body = (await res.text()).slice(0, 400);
      } catch {
        // The page navigated away before the body could be read; the status still counts.
      }
      this.resetResponses.push({
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
        body,
      });
    });
  }

  // How many password-reset answers have been seen so far. A step takes this before acting so
  // its later reads cannot pick up a throttle from an earlier step in the same scenario.
  responseCount() {
    return (this.resetResponses || []).length;
  }

  // The newest 429 recorded at or after `since`, or null. The parsed countdown is returned
  // alongside the raw sentence because it is the one number that says whether a rerun is worth
  // attempting at all.
  lastThrottle(since = 0) {
    const seen = (this.resetResponses || []).slice(since);
    const hit = [...seen].reverse().find((r) => r.status === 429);
    if (!hit) return null;
    const match = /Expected available in ([0-9]+) seconds/i.exec(hit.body || '');
    return {
      method: hit.method,
      url: hit.url,
      detail: hit.body,
      seconds: match ? Number(match[1]) : null,
    };
  }

  // One sentence naming the real cause, for a step that has just failed to observe what a
  // successful request produces. It never invents a throttle: with no 429 recorded it reports
  // what the endpoint actually answered and what is on screen, so an unrelated fault cannot be
  // mislabelled as rate limiting.
  async describeFailure(what, since = 0) {
    const throttle = this.lastThrottle(since);
    if (throttle) {
      const wait = throttle.seconds === null
        ? 'an unstated period'
        : `${throttle.seconds}s (~${Math.ceil(throttle.seconds / 60)} min)`;
      return `${what}: the app answered HTTP 429 to ${throttle.method} ${throttle.url}. `
        + `The password-reset endpoint is rate limited and stays shut for another ${wait}. `
        + `Server said: ${throttle.detail} `
        + `This is the environment's limit, not a broken locator - see the throttle note in `
        + 'pages/ForgotPasswordPage.js.';
    }
    const answers = (this.resetResponses || [])
      .slice(since)
      .map((r) => `${r.status} ${r.method} ${r.url} :: ${r.body}`)
      .join(' | ') || '(no password-reset request was observed at all)';
    let onScreen = '';
    try {
      onScreen = (await this.page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    } catch {
      onScreen = '(page unavailable)';
    }
    return `${what}. Password-reset responses: ${answers}. On screen: "${onScreen}"`;
  }

  async navigateToForgot() {
    this.watchResetRequests();
    await super.navigate(this.forgotUrl);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.emailInput.waitFor({ state: 'visible', timeout: 60000 });
  }

  async navigateToReset(link) {
    this.watchResetRequests();
    await this.page.goto(link, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  }

  async requestReset(email) {
    await this.emailInput.fill(email);
    await this.sendButton.click();
  }

  async setNewPassword(password, confirm = password) {
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.fill(confirm);
  }
}

module.exports = ForgotPasswordPage;
