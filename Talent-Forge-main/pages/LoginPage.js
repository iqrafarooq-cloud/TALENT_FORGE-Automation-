const BasePage = require('./BasePage');

// LoginPage — Page Object for the Talent Forge login page.
class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.url = process.env.BASE_URL;

    // Layered selectors: data-testid -> semantic HTML / ARIA -> placeholder / text fallback.
    this.emailInput = page.locator(
      '[data-testid="login-email-input"], input[name="email"], input[placeholder="Enter your university email"]'
    );
    this.passwordInput = page.locator(
      '[data-testid="login-password-input"], input[name="password"], input[placeholder="Enter your password"]'
    );
    this.submitButton = page.locator(
      '[data-testid="login-submit-button"], button[type="submit"]'
    );
    // Error / success feedback: MUI Alert or notistack snackbar.
    this.alert = page.locator(
      '[data-testid="login-alert"], [role="alert"], .notistack-Snackbar, .MuiAlert-message'
    );

    // Password show/hide toggle — aria-label flips between "Show password" / "Hide password".
    this.passwordToggle = page.locator(
      '[data-testid="login-password-toggle"], button[aria-label="Show password"], button[aria-label="Hide password"]'
    );

    // Inline email-format validation helper text.
    this.emailValidationMessage = page
      .getByText(/please enter a valid email|valid email address|invalid email|email is required/i)
      .first();

    // Navigation affordances (rendered as a button / clickable span, not anchors).
    this.forgotPasswordLink = page
      .getByRole('button', { name: /forgot password/i })
      .or(page.getByText(/^forgot password\??$/i))
      .first();
    this.signUpLink = page
      .getByRole('link', { name: /^sign up$/i })
      .or(page.getByText(/^sign up$/i))
      .first();

    // Google sign-in is the Google Identity Services (GSI) button that opens the OAuth popup.
    this.googleButton = page.getByRole('button', { name: /sign in with google/i }).first();
  }

  async navigate() {
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.emailInput.first().waitFor({ state: 'visible', timeout: 60000 });
  }
}

module.exports = LoginPage;
