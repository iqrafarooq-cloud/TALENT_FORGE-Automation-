const BasePage = require('./BasePage');

// SignupPage — Page Object covering the three screens of the signup flow:
//   1. /signup             — create-account form (name, email, agent code, password x2)
//   2. /email-verification — "Check Your Inbox!" prompt + "Resend Email in mm:ss" cooldown
//   3. /verify-email?uid=&token= — "Email verified successfully!" + "Start Onboarding"
//
// Selector strategy follows the project convention: data-testid -> ARIA/role ->
// semantic HTML (name/type) -> placeholder / text fallback. data-testid candidates
// are listed first even though the current build exposes none, so the suite
// auto-upgrades when the app team adds them.
class SignupPage extends BasePage {
  constructor(page) {
    super(page);
    this.signupUrl = (process.env.BASE_URL || '').replace(/\/login\/?$/, '/signup');

    // ---- Screen 1: /signup ----
    this.firstNameInput = page.locator(
      '[data-testid="signup-first-name"], input[name="firstName"], input[placeholder="Enter your first name"]'
    ).first();
    this.lastNameInput = page.locator(
      '[data-testid="signup-last-name"], input[name="lastName"], input[placeholder="Enter your last name"]'
    ).first();
    this.emailInput = page.locator(
      '[data-testid="signup-email"], input[name="email"], input[type="email"], input[placeholder="Enter your university email"]'
    ).first();
    this.agentCodeInput = page.locator(
      '[data-testid="signup-agent-code"], input[name="agentCode"], input[placeholder="Enter your agent code"]'
    ).first();
    this.passwordInput = page.locator(
      '[data-testid="signup-password"], input[name="password"], input[placeholder="Create a strong password"]'
    ).first();
    this.confirmPasswordInput = page.locator(
      '[data-testid="signup-confirm-password"], input[name="confirmPassword"], input[placeholder="Re-enter your password"]'
    ).first();
    this.createAccountButton = page
      .getByRole('button', { name: /create account/i })
      .first();

    // Inline validation helper texts (exact strings as rendered by the app).
    this.passwordRequirementsError = page
      .getByText(/password doesn'?t meet all requirements/i)
      .first();
    this.passwordsDoNotMatchError = page
      .getByText(/passwords do not match/i)
      .first();

    // ---- Screen 2: /email-verification ----
    this.checkInboxHeading = page
      .getByRole('heading', { name: /check your inbox/i })
      .first();
    // Countdown button, e.g. "Resend Email in 00:56" — disabled while counting down,
    // becomes an enabled "Resend Email" once the cooldown elapses.
    this.resendButton = page
      .getByRole('button', { name: /resend email/i })
      .first();

    // ---- Screen 3: /verify-email ----
    this.verifiedHeading = page
      .getByRole('heading', { name: /email verified successfully/i })
      .first();

    // Generic feedback surface (MUI Alert / notistack) for toasts such as
    // "Account created…", "Invalid agent code.", "Email verified successfully.".
    this.alert = page.locator(
      '[role="alert"], .notistack-Snackbar, .MuiAlert-message'
    );
  }

  async navigateToSignup() {
    await super.navigate(this.signupUrl);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.firstNameInput.waitFor({ state: 'visible', timeout: 60000 });
  }

  // Fill every field of the create-account form. Any field left undefined is skipped.
  async fillForm({ firstName, lastName, email, agentCode, password, confirmPassword }) {
    if (firstName !== undefined) await this.firstNameInput.fill(firstName);
    if (lastName !== undefined) await this.lastNameInput.fill(lastName);
    if (email !== undefined) await this.emailInput.fill(email);
    if (agentCode !== undefined) await this.agentCodeInput.fill(agentCode);
    if (password !== undefined) await this.passwordInput.fill(password);
    if (confirmPassword !== undefined) await this.confirmPasswordInput.fill(confirmPassword);
  }

  // Type a value into a field then clear it and blur — used to trigger the
  // "<Field> is required." validation for the cleared-fields negative scenario.
  async enterAndClear(locator, sample = 'x') {
    await locator.fill(sample);
    await locator.fill('');
    await locator.blur();
  }

  async submit() {
    await this.createAccountButton.click();
  }

  // Follow the verification link (a SendGrid /ls/click wrapper) to its final
  // /verify-email destination.
  async openVerificationLink(link) {
    await this.page.goto(link, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  }
}

module.exports = SignupPage;
