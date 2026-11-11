const BasePage = require('./BasePage');

// ChangePasswordPage — Page Object for the "Set a New Password" modal reached via
// Account Settings > Security > Password card > "Edit password".
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name
// -> semantic HTML (placeholder) -> structural classes -> text fallback. The
// data-testid candidates are listed first even though the current build exposes
// none, so the suite auto-upgrades when the app team adds them.
//
// Live behaviour reference (dev.talentforge.com.sa, 2026-07-22):
//   - The submit button is labelled "Change Password" and stays DISABLED until the
//     whole form is valid — there is no submit-time "required" validation.
//   - On success the API invalidates the session, so the app shows a
//     "Password updated successfully." toast AND logs the user out to /login.
class ChangePasswordPage extends BasePage {
  constructor(page) {
    super(page);
    this.settingsUrl = (process.env.BASE_URL || '').replace(/\/login\/?$/, '/settings');

    // change-password API endpoint — used by the server-error scenario to force a 500.
    this.changePasswordApi = '**/core/api/v1/auth/change-password/';

    // ---- Account Settings > Security ----
    this.securityTab = page
      .getByRole('radio', { name: /^security$/i })
      .or(page.getByRole('tab', { name: /^security$/i }))
      .first();

    // Password card "Edit password" trigger (a.k.a. the pencil icon).
    this.editPasswordButton = page
      .locator('[data-testid="edit-password-button"]')
      .or(page.getByRole('button', { name: /edit password/i }))
      .first();

    // "Last updated ..." line on the Password card.
    this.lastUpdatedText = page.getByText(/last updated/i).first();

    // ---- Modal: "Set a New Password" ----
    this.modalHeading = page.getByRole('heading', { name: /set a new password/i }).first();
    this.modal = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: /set a new password/i }) })
      .first();

    // Fields are disambiguated by their (unique) placeholders.
    this.currentPasswordInput = page
      .locator('[data-testid="current-password-input"], input[placeholder="Enter current password"]')
      .first();
    this.newPasswordInput = page
      .locator('[data-testid="new-password-input"], input[placeholder="Enter new password"]')
      .first();
    this.confirmPasswordInput = page
      .locator('[data-testid="confirm-password-input"], input[placeholder="Re-enter password"]')
      .first();

    // Per-field Show/Hide toggles (three, in field order) — scoped to the modal so
    // they don't collide with any page-level password toggle.
    this.passwordToggles = this.modal.locator(
      'button[aria-label="Show password"], button[aria-label="Hide password"]'
    );

    this.changePasswordButton = page
      .locator('[data-testid="change-password-submit"]')
      .or(page.getByRole('button', { name: /^change password$/i }))
      .first();
    // There are two "Cancel" controls — the header X and the footer button; the
    // footer one is last in DOM order.
    this.cancelButton = page.getByRole('button', { name: /^cancel$/i }).last();
    this.forgotPasswordLink = page.getByRole('button', { name: /forgotten your password/i }).first();

    // ---- Inline validation messages (exact copy observed live) ----
    this.currentRequiredError = page.getByText(/current password is required\.?/i).first();
    this.incorrectCurrentError = page
      .getByText(/the current password you entered is incorrect\.?/i)
      .first();
    this.sameAsCurrentError = page
      .getByText(/new password must be different from your current password\.?/i)
      .first();
    this.passwordsDoNotMatchError = page.getByText(/passwords do not match\.?/i).first();

    // ---- Password requirements tooltip (5 rules) ----
    this.requirementItems = {
      length: page.getByText(/at least 8 characters/i).first(),
      uppercase: page.getByText(/at least one uppercase/i).first(),
      lowercase: page.getByText(/at least one lowercase/i).first(),
      number: page.getByText(/at least one number/i).first(),
      special: page.getByText(/at least one special/i).first(),
    };

    // ---- Feedback surface ----
    this.alert = page.locator('[role="alert"], .notistack-Snackbar, .MuiAlert-message');
    this.successToast = page.getByText(/password updated successfully\.?/i).first();
  }

  // Open Account Settings > Security from a logged-in session and land on the
  // Password card (does NOT open the modal). The Password card — including its
  // "Last updated ..." line — is visible after this.
  async openSecurityTab() {
    await this.page.goto(this.settingsUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.securityTab.waitFor({ state: 'visible', timeout: 30000 });
    await this.securityTab.click();
    await this.editPasswordButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  // Open the modal from a logged-in session: /settings -> Security -> Edit password.
  async openFromSettings() {
    await this.openSecurityTab();
    await this.editPasswordButton.click();
    await this.modalHeading.waitFor({ state: 'visible', timeout: 30000 });
  }

  // Fill any subset of the three fields. `undefined` leaves a field untouched;
  // pass an empty string to explicitly clear one.
  async fillFields({ current, next, confirm } = {}) {
    if (current !== undefined) await this.currentPasswordInput.fill(current);
    if (next !== undefined) await this.newPasswordInput.fill(next);
    if (confirm !== undefined) await this.confirmPasswordInput.fill(confirm);
  }

  async submit() {
    const responsePromise = this.page
      .waitForResponse((response) => response.url().includes('/auth/change-password/') && response.request().method() === 'POST', { timeout: 10000 })
      .catch(() => null);
    await this.changePasswordButton.click({ timeout: 15000 });
    const response = await responsePromise;
    // Sample the toast WITHOUT auto-waiting. textContent() waits up to the 30s action timeout
    // for a toast that does not exist on the error paths (or has gone after the logout), so
    // eight samples could block for 240s and kill the 60s "I click" step - a hang that read as
    // the Change Password button never responding.
    const feedback = new Set();
    for (let i = 0; i < 8; i++) {
      let text = '';
      try {
        if (await this.successToast.count()) text = await this.successToast.innerText({ timeout: 500 });
      } catch {
        // toast detached between count and read, or the page navigated to /login
      }
      if (text && text.trim()) feedback.add(text.replace(/\s+/g, ' ').trim());
      try {
        await this.page.waitForTimeout(150);
      } catch {
        break;
      }
    }
    this.lastSubmit = {
      status: response ? response.status() : null,
      feedback: [...feedback],
    };
  }

  // Force the change-password request to fail with a 500 (server-error scenario).
  async stubServerError() {
    await this.page.route(this.changePasswordApi, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    });
  }
}

module.exports = ChangePasswordPage;
