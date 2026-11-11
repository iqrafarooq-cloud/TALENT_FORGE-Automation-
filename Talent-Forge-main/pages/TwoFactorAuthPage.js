const BasePage = require('./BasePage');

// TwoFactorAuthPage — Page Object for Two-Factor Authentication (Jira TFF-20).
//
// It covers THREE surfaces, because 2FA is three screens and not one:
//   1. Account Settings > Security > the "Two-Factor Authentication" card and its toggle
//   2. the setup / disable dialogs that toggle opens (QR + manual key, then a 6-digit step)
//   3. the login-time challenge at /verify-otp, which is a full PAGE, not a dialog
//
// ============================================================================================
// THE ONE THING TO KNOW: THERE ARE TWO DIFFERENT OTP CONTROLS, AND THEY SHARE NO SELECTOR.
// ============================================================================================
// Measured live 2026-08-24 (scripts/probe-2fa.js, scripts/probe-2fa-login-prompt.js):
//
//   SETUP / DISABLE DIALOG — an `input-otp` widget. SIX PRESENTATIONAL <div>s
//   (`aria-label="Enter digit N of 6"`) with ONE transparent <input maxlength="6"
//   data-input-otp> stretched across all of them. The divs hold the rendered digits; the input
//   holds the value. `page.keyboard.type()` alone does nothing — the input is not focused on
//   open, so the keystrokes go to the document.
//
//   LOGIN CHALLENGE (/verify-otp) — SIX REAL <input type="text" maxlength="1"
//   inputmode="numeric"> boxes and NO `aria-label` cells whatsoever.
//
// A reader written against either one silently times out on the other, which is exactly how the
// first probe died on a page that was rendering perfectly. So every OTP interaction here goes
// through otpScope()/enterOtp(), which detect the shape rather than assume it, and readOtpBoxes()
// reports which shape it found so a failure names the surface it was on.
//
// ============================================================================================
// A TOTP CODE IS SINGLE-USE. This is the second trap.
// ============================================================================================
// Submitting the same six digits twice inside one 30-second step is rejected as "Incorrect OTP."
// even though the digits are correct for that window. A scenario that answers the login challenge
// and then immediately disables 2FA would send the identical code twice and read the second
// refusal as an app defect. `consumeCode()` records every code it submits and waits out the
// window rather than reusing one.
//
// The secret itself is not a fixture and is not guessed: the app hands it back in plaintext from
// POST /core/api/v1/auth/token/2fa/ and prints it under the QR code for the user to type into
// their authenticator. features/support/totp.js turns it into the code the server expects, so
// nothing about the verification is stubbed — see the note at the top of that file.
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name -> semantic
// HTML -> structural class -> text fallback. The data-testid candidates lead even though this
// build exposes none on any of the three surfaces, so the suite auto-upgrades when they land.
const { totp, secondsRemaining, extractSecret } = require('../utils/totp');

// Endpoints, measured. Named here so a step can stub or watch one without re-deriving it.
const API = {
  setup: '**/core/api/v1/auth/token/2fa/',
  confirm: '**/core/api/v1/auth/token/2fa/confirm/',
  disable: '**/core/api/v1/auth/token/2fa/disable/',
  submit: '**/core/api/v1/auth/token/2fa/submit/',
};

class TwoFactorAuthPage extends BasePage {
  constructor(page) {
    super(page);
    const base = (process.env.BASE_URL || '').replace(/\/login\/?$/, '');
    this.appUrl = base;
    this.settingsUrl = `${base}/settings`;
    this.verifyOtpUrl = `${base}/verify-otp`;
    this.api = API;

    // Codes already submitted, shared across every instance in the process — NOT per scenario.
    //
    // This was a real bug and it cost four scenarios on the first run. A TOTP step is 30 seconds
    // and a scenario boundary is not: a scenario that ends by submitting a code is routinely
    // followed, inside the same window, by the next scenario's Background answering the login
    // challenge with the identical six digits. The server refuses the repeat as "Incorrect OTP.",
    // the Background never gets past /verify-otp, and the failure surfaces as "the Security tab
    // never appeared" — which points at the wrong screen entirely. Scoping the set to the class
    // makes the wait happen where the reuse actually is.
    this._spentCodes = TwoFactorAuthPage._spentCodes;

    // ---- Account Settings > Security ----
    this.securityTab = page
      .locator('[data-testid="security-tab"]')
      .or(page.getByRole('radio', { name: /^security$/i }))
      .or(page.getByRole('tab', { name: /^security$/i }))
      .first();

    // The card is a <section> whose header holds the title; the same words also appear on the
    // body row, so the card is derived from the section that CONTAINS the toggle rather than
    // from the text (which would resolve to whichever copy sorts first).
    this.card = page
      .locator('[data-testid="two-factor-card"]')
      .or(page.locator('section').filter({ has: page.locator('input[role="switch"]') }))
      .first();
    this.cardHeading = page.getByText(/^two-factor authentication$/i).first();

    // The toggle is an sr-only <input role="switch"> inside a clipped <span> (0x0 hit box), so a
    // plain click can never pass Playwright's hit-target check — toggle() clicks its <label>.
    this.toggle = page
      .locator('[data-testid="two-factor-toggle"]')
      .or(page.locator('input[role="switch"][aria-label="Two-Factor Authentication"]'))
      .or(page.locator('input[role="switch"]'))
      .first();

    // The red warning icon is an <svg class="... fill-error-600">, rendered in TWO places while
    // 2FA is off: inside the Security tab's own label, and in the 2FA card header. There is no
    // text and no role on it, so the fill class is the only handle the build offers.
    this.warningIcons = page.locator('svg.fill-error-600');
    this.securityTabWarning = this.securityTab.locator('svg.fill-error-600');
    this.cardWarning = this.card.locator('svg.fill-error-600');

    // ---- Dialogs ----
    this.dialog = page.locator('[role="dialog"]').first();
    this.setupHeading = page.getByRole('heading', { name: /set up two-factor authentication/i }).first();
    this.setupInstructions = page
      .getByText(/use an authenticator app like google authenticator, authy, or microsoft authenticator/i)
      .first();
    this.manualKeyInstructions = page
      .getByText(/copy the code below into your authenticator app/i)
      .first();
    // The QR is an INLINE <svg>, not an <img> — a locator built on img[alt] finds nothing.
    this.qrCode = this.dialog.locator('svg[viewBox]').filter({ has: page.locator('rect') }).first();
    this.otpHeading = page.getByRole('heading', { name: /enter the 6-digit code/i }).first();
    this.otpInstructions = page.getByText(/enter the 6-digit code displayed in your authenticator app/i).first();
    this.verificationCodeLabel = page.getByText(/^verification code$/i).first();

    this.nextButton = page.getByRole('button', { name: /^next$/i }).first();
    // Two "Cancel" controls exist on every dialog: the header X (an icon button whose accessible
    // name is "Cancel") and the footer button. getByRole matches both, so the footer one — the
    // one the AC means — is taken by its visible text.
    this.cancelButton = this.dialog.getByRole('button', { name: /^cancel$/i }).filter({ hasText: /cancel/i }).first();
    this.dialogCloseButton = this.dialog.getByRole('button', { name: /^cancel$/i }).first();
    this.confirmButton = page.getByRole('button', { name: /^confirm$/i }).first();

    // ---- Disable confirmation ----
    this.disableHeading = page.getByRole('heading', { name: /turn off two factor authentication\?/i }).first();
    this.disableMessage = page.getByText(/reduces your account security/i).first();
    this.turnOffButton = page.getByRole('button', { name: /^turn off 2fa$/i }).first();

    // ---- Login challenge (/verify-otp) ----
    this.loginPromptHeading = page.locator('h1,h2,h3').filter({ hasText: /\S/ }).first();
    this.loginOtpBoxes = page.locator('input[maxlength="1"][inputmode="numeric"]');
    // The AC calls this control "Confirm"; the build labels it "Verify". Both are accepted here
    // so the BEHAVIOUR scenarios test behaviour — the copy divergence is asserted once, in the
    // one scenario that exists for it, rather than failing every login scenario. Same reasoning
    // as AdminPromoToolsPage.readPromoRevenue() tolerating "Promo Revenue"/"Revenue Generated".
    this.loginSubmitButton = page.getByRole('button', { name: /^(verify|confirm)$/i }).first();

    // ---- Feedback ----
    this.toast = page.locator('[role="alert"], [role="status"], [data-sonner-toast]');
  }

  // ============================ navigation ============================

  async openSecurityTab() {
    if (!/\/settings/.test(this.page.url())) {
      await this.page.goto(this.settingsUrl, { waitUntil: 'domcontentloaded' });
    }
    await this.securityTab.waitFor({ state: 'visible', timeout: 30000 });
    await this.securityTab.click();
    await this.card.waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForTimeout(500);
  }

  // Re-read the tab from the server rather than trusting what the last interaction left on
  // screen. Used by every assertion about the toggle's resting state — the card repaints after a
  // confirm/disable round trip, and reading the stale render is how "the toggle did not change"
  // gets reported for a change that happened.
  async refresh() {
    await this.page.goto(this.settingsUrl, { waitUntil: 'domcontentloaded' });
    await this.openSecurityTab();
  }

  async isEnabled() {
    return this.toggle.isChecked();
  }

  // The <input role="switch"> is visually clipped to 0x0, so it is its <label> that is clickable.
  async clickToggle() {
    const label = this.page.locator('label').filter({ has: this.toggle }).first();
    if (await label.count()) {
      await label.click();
    } else {
      await this.toggle.click({ force: true });
    }
    await this.page.waitForTimeout(1200);
  }

  // ============================ the secret ============================

  // Toggle 2FA on and capture the shared secret from the setup dialog.
  //
  // The secret is read off the MODAL, not off the API response, because that is the string a real
  // user copies into their authenticator — so a build that printed a different key from the one
  // it registered would fail here rather than pass on a value only the test could see. The API
  // response is captured too and cross-checked by the caller when it wants both.
  async openSetupDialog() {
    const responded = this.page
      .waitForResponse((r) => r.url().includes('/auth/token/2fa/') && r.request().method() === 'POST', { timeout: 30000 })
      .catch(() => null);
    await this.clickToggle();
    const response = await responded;
    await this.setupHeading.waitFor({ state: 'visible', timeout: 30000 });

    let apiSecret = null;
    if (response) {
      try { apiSecret = extractSecret(await response.json()); } catch { /* not the setup call */ }
    }
    return { apiSecret };
  }

  // The manual key printed under the QR: the longest base32 run in the dialog's own text.
  async readManualKey() {
    const text = (await this.dialog.innerText()).replace(/\s+/g, ' ');
    const m = text.match(/\b[A-Z2-7]{16,}\b/);
    if (!m) throw new Error(`No manual setup code found in the setup dialog. Text was: ${text.slice(0, 300)}`);
    return m[0];
  }

  // ============================ the OTP control ============================

  // Which of the two controls is on screen, and where. Returns null when neither is.
  async otpScope() {
    const inDialog = (await this.dialog.count()) && (await this.dialog.isVisible().catch(() => false));
    const scope = inDialog ? this.dialog : this.page;
    const singles = scope.locator('input[maxlength="1"]');
    if (await singles.count()) return { shape: 'six-inputs', scope, singles };
    const packed = scope.locator('input[data-input-otp], input[maxlength="6"][inputmode="numeric"]');
    if (await packed.count()) {
      return { shape: 'packed-input', scope, input: packed.first(), cells: scope.locator('[aria-label^="Enter digit"]') };
    }
    return null;
  }

  // What the user sees: how many single-digit boxes, what they hold, and whether they are in the
  // error state. Deliberately shape-agnostic — the AC says "6 single-digit OTP input boxes" and
  // both builds render six boxes; only the DOM behind them differs.
  async readOtpBoxes() {
    const otp = await this.otpScope();
    if (!otp) return { shape: 'none', count: 0, digits: [], errored: false, focusedIndex: -1 };

    if (otp.shape === 'six-inputs') {
      const boxes = await otp.singles.evaluateAll((els) =>
        els.map((e) => ({
          value: e.value,
          focused: e === document.activeElement,
          // The login boxes are real inputs, so their error state is a border/ring on the input.
          error: /error|danger|red/i.test((e.className || '').toString())
            || /(border|ring)-error/.test((e.className || '').toString())
            || /rgb\(2[0-5]\d,\s*[0-9]{1,2},\s*[0-9]{1,2}\)/.test(getComputedStyle(e).borderColor),
        }))
      );
      return {
        shape: otp.shape,
        count: boxes.length,
        digits: boxes.map((b) => b.value),
        errored: boxes.some((b) => b.error),
        focusedIndex: boxes.findIndex((b) => b.focused),
      };
    }

    const cells = await otp.cells.evaluateAll((els) =>
      els.map((e) => ({
        text: (e.textContent || '').trim(),
        // Measured: a rejected code repaints every cell from ring-gray-300 to ring-error-500.
        // Nothing else about the cell changes — no class flag, no attribute — so the ring class
        // is the only readable evidence, and reading `opacity`/`filter` instead (the mistake this
        // repo has made twice) could only ever answer "absent".
        error: /ring-error/.test((e.className || '').toString()),
      }))
    );
    const value = await otp.input.inputValue();
    const focused = await otp.input.evaluate((e) => e === document.activeElement).catch(() => false);
    return {
      shape: otp.shape,
      count: cells.length,
      // The cells render "0" as a placeholder for an unfilled position, so the input's own value
      // is the truth about what has been entered.
      digits: value.split('').concat(Array(Math.max(0, cells.length - value.length)).fill('')),
      errored: cells.some((c) => c.error),
      focusedIndex: focused ? value.length : -1,
      placeholderCells: cells.map((c) => c.text),
    };
  }

  // Advance to the step that actually takes a code, if a scenario has not spelled that out.
  //
  // The Gherkin abbreviates both flows — "When the user toggles 2FA off / And the user enters a
  // valid OTP" with no step in between — because the intermediate click is plumbing, not the
  // behaviour under test. That abbreviation is fine and worth honouring: the alternative is a
  // "And the user proceeds to the disable OTP step" line in every scenario that disables, which
  // says nothing a reader needs. Only the two gating scenarios name that step explicitly, because
  // there the intermediate screen IS the subject.
  //
  // It advances one step at most and never invents one: if neither trigger is on screen, the
  // caller's "No OTP control is on screen" stands.
  async ensureOtpStep() {
    if (await this.otpScope()) return false;
    for (const trigger of [this.turnOffButton, this.nextButton]) {
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
        await this.otpHeading.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await this.page.waitForTimeout(500);
        return true;
      }
    }
    return false;
  }

  async enterOtp(code) {
    await this.ensureOtpStep();
    const otp = await this.otpScope();
    if (!otp) throw new Error('No OTP control is on screen');

    if (otp.shape === 'six-inputs') {
      const n = await otp.singles.count();
      for (let i = 0; i < n; i++) await otp.singles.nth(i).fill('');
      for (let i = 0; i < Math.min(code.length, n); i++) {
        await otp.singles.nth(i).click({ force: true });
        await otp.singles.nth(i).fill(code[i]);
      }
    } else {
      await otp.input.click({ force: true });
      await otp.input.fill('');
      // Typed a character at a time, not filled: `input-otp` advances its rendered cells off
      // keystrokes, and a single fill() can leave the cells and the value disagreeing.
      if (code) await otp.input.type(code, { delay: 50 });
    }
    await this.page.waitForTimeout(400);
    return this.readOtpBoxes();
  }

  // Paste rather than type — a genuinely different code path from enterOtp(). A dispatched
  // ClipboardEvent is untrusted and performs no default action, and clipboard.writeText is
  // rejected without a granted permission, so both would silently insert nothing (the mistake
  // CommunityFormPage.pasteAbout() was written to avoid). keyboard.insertText() fires ONE input
  // event with no keydowns, which is what a paste looks like to the page.
  async pasteOtp(code) {
    const otp = await this.otpScope();
    if (!otp) throw new Error('No OTP control is on screen');
    if (otp.shape === 'six-inputs') {
      await otp.singles.first().click({ force: true });
    } else {
      await otp.input.click({ force: true });
      await otp.input.fill('');
    }
    await this.page.keyboard.insertText(code);
    await this.page.waitForTimeout(500);
    return this.readOtpBoxes();
  }

  // ============================ codes ============================

  // A code that has not already been submitted in this scenario. See the single-use note above.
  //
  // MIN_WINDOW_REMAINING IS 8s, NOT 3s, AND THAT IS A MEASURED FIGURE.
  //
  // A code is computed here and validated by the server several steps later: enterOtp() types six
  // characters into `input-otp` (50ms apart, plus a settle), submitOtp() clicks, and the request
  // then has to reach the API. With only 3s of margin the window can tick over in between, and
  // the server answers `400 "Incorrect OTP."` for a code that was correct when it was computed.
  //
  // That is exactly how the 2026-09-03 run failed: `Given a user with 2FA enabled` reported
  // `enabling 2FA failed: 400 Incorrect OTP.` on the one scenario that also signs in from cold
  // between the two, and the SAME scenario passed its Given first time when re-run alone. A red
  // row of that shape reads as the app rejecting a valid code, which is the wrong bug entirely.
  //
  // 8s costs at most one extra window wait per code and removes the race.
  async freshCode(secret, { offsetSeconds = 0 } = {}) {
    if (!secret) throw new Error('No TOTP secret is known — the setup dialog was never read');
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = totp(secret, { offsetSeconds });
      const tooLate = secondsRemaining() < TwoFactorAuthPage.MIN_WINDOW_REMAINING;
      if (!this._spentCodes.has(code) && !tooLate) {
        this._spentCodes.add(code);
        return code;
      }
      // Wait out the rest of the step so the next call lands in a new window.
      await this.page.waitForTimeout((secondsRemaining() + 1) * 1000);
    }
    throw new Error('Could not obtain an unused TOTP code after four windows');
  }

  // ============================ submission ============================

  async clickNext() {
    await this.nextButton.click();
    await this.otpHeading.waitFor({ state: 'visible', timeout: 20000 });
  }

  async clickCancel() {
    await this.cancelButton.click();
    await this.page.waitForTimeout(1200);
  }

  async clickTurnOff() {
    await this.turnOffButton.click();
    await this.otpHeading.waitFor({ state: 'visible', timeout: 20000 });
  }

  // Submit whichever OTP form is on screen and hand back the API's own verdict alongside the
  // rendered one. The API answer is what makes a failure diagnosable: "the toggle did not move"
  // and "the server refused the code" look identical on screen.
  // `label` is the button the SCENARIO names ("Confirm"). It is honoured where it exists, and
  // falls back to whatever the surface actually labels its submit control — the login challenge
  // calls it "Verify". The label used is returned so a step can report the substitution instead
  // of failing three behavioural scenarios on a copy divergence that is asserted once elsewhere.
  async submitOtp(label = 'Confirm') {
    const watching = this.page
      .waitForResponse((r) => /\/auth\/token\/2fa\/(confirm|disable|submit)\//.test(r.url()), { timeout: 30000 })
      .catch(() => null);
    const named = this.page.getByRole('button', { name: new RegExp(`^${String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
    const useNamed = await named.isVisible().catch(() => false);
    const button = useNamed ? named : this.loginSubmitButton;
    const usedLabel = useNamed ? label : (await this.readLoginSubmitLabel()) || '(unlabelled)';
    await button.click();
    const response = await watching;
    let detail = null;
    let status = null;
    if (response) {
      status = response.status();
      try { detail = (await response.json()).detail || null; } catch { /* token payload */ }
    }
    // CAPTURE THE FEEDBACK NOW, WHILE IT IS STILL ON SCREEN.
    //
    // A toast is transient and the steps that follow a submission are not passive: "the 2FA
    // toggle should be on" re-reads the tab from the server, which navigates, and a navigation
    // takes the toast with it. Asserting the toast afterwards then reports "the app displayed
    // nothing" for a message that was rendered perfectly — the failure names the wrong bug, which
    // is the whole reason this repo insists on gathering evidence during the action and asserting
    // it later (see features/support/chargeReconciliation.js).
    //
    // Sampled repeatedly rather than read once: the toast is written after the request settles,
    // so a single read races the network.
    this.lastFeedback = new Set();
    for (let i = 0; i < 8; i++) {
      (await this.readFeedback()).forEach((m) => this.lastFeedback.add(m));
      await this.page.waitForTimeout(250);
    }
    return { status, detail, usedLabel, feedback: [...this.lastFeedback] };
  }

  async dialogIsOpen() {
    return (await this.dialog.count()) > 0 && this.dialog.isVisible().catch(() => false);
  }

  // ============================ feedback ============================

  // Every visible alert/status message plus any standalone red text. Collected rather than
  // matched, so a failure quotes the wording the app actually used instead of reporting the
  // wording the AC hoped for as "absent".
  async readFeedback() {
    return this.page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const out = [];
      document.querySelectorAll('[role="alert"],[role="status"],[data-sonner-toast]').forEach((e) => {
        if (vis(e) && c(e.innerText)) out.push(c(e.innerText));
      });
      document.querySelectorAll('p,span,div,small').forEach((e) => {
        if (!vis(e) || e.children.length || !c(e.textContent)) return;
        const m = getComputedStyle(e).color.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110) out.push(c(e.textContent));
      });
      return [...new Set(out)];
    });
  }

  // Poll the live screen, but ALSO honour what submitOtp() captured at the moment of the action.
  // Which of the two holds the message depends only on whether an intervening step navigated, and
  // that is not something an assertion about wording should be sensitive to.
  async waitForFeedback(pattern, timeout = 15000) {
    const captured = [...(this.lastFeedback || [])];
    if (captured.some((s) => pattern.test(s))) return { matched: true, seen: captured, source: 'captured at submit' };
    const deadline = Date.now() + timeout;
    let seen = [];
    while (Date.now() < deadline) {
      seen = await this.readFeedback();
      if (seen.some((s) => pattern.test(s))) return { matched: true, seen, source: 'on screen' };
      await this.page.waitForTimeout(400);
    }
    return { matched: false, seen: [...new Set([...seen, ...captured])], source: 'nothing matched' };
  }

  // Is the toggle in the wanted state? Polled ON THE CURRENT RENDER first, and only re-fetched
  // from the server if it disagrees.
  //
  // The re-fetch is what makes "the toggle did not change" a real claim — a stale render would
  // make it falsely. But re-fetching UNCONDITIONALLY navigates, and a navigation discards the
  // success toast a later step in the same scenario still has to assert. Polling first keeps both:
  // the fast path leaves the page alone, and a disagreement still gets the authoritative answer.
  async toggleSettlesOn(want, { timeout = 20000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await this.isEnabled().catch(() => null)) === want) return { actual: want, refreshed: false };
      await this.page.waitForTimeout(500);
    }
    await this.refresh();
    return { actual: await this.isEnabled(), refreshed: true };
  }

  // ============================ login challenge ============================

  async onLoginChallenge() {
    return /\/verify-otp/.test(this.page.url());
  }

  async waitForLoginChallenge(timeout = 45000) {
    await this.page.waitForURL(/\/verify-otp/, { timeout });
    await this.loginOtpBoxes.first().waitFor({ state: 'visible', timeout: 20000 });
  }

  async readLoginPromptHeading() {
    const headings = await this.page.locator('h1,h2,h3').evaluateAll((els) =>
      els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );
    return headings[0] || '';
  }

  // The label the build gives the submit control on the login challenge, so a copy assertion can
  // quote it instead of reporting "the Confirm button is missing".
  async readLoginSubmitLabel() {
    return (await this.loginSubmitButton.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
  }

  // Force the enable request to fail, for the global-error scenario. Both the confirm and the
  // disable endpoints are stubbed: a stub covering only one silently does nothing on the other
  // flow, which is the trap the promo feature's preview stub already documents.
  async stubUpdateFailure() {
    for (const url of [API.confirm, API.disable]) {
      await this.page.route(url, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Internal server error' }),
        });
      });
    }
  }
}

// See the constructor: shared across instances on purpose, because a TOTP window outlives a
// scenario and every scenario drives the same account.
TwoFactorAuthPage._spentCodes = new Set();

// Seconds that must be left in the current 30s TOTP step before a code is handed out. See
// freshCode() for the measurement behind the number.
TwoFactorAuthPage.MIN_WINDOW_REMAINING = 8;

module.exports = TwoFactorAuthPage;
