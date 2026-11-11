const BasePage = require('./BasePage');

// OnboardingPage — Page Object for the 6-step onboarding wizard reached at
// /onboarding after a fresh, verified account logs in. The wizard is a
// react-aria + Tailwind frontend (NOT MUI), so its comboboxes render options in
// a portaled `[role="option"]` listbox and its checkboxes/switches wrap the real
// input under decorative overlays that intercept pointer events. The helpers
// below encode the interaction quirks discovered against the live app:
//   - autocomplete/comboboxes: focus, type, then click the exact portaled option
//   - Month/Year: click the "Select Month/Year" button, then pick the option
//   - checkbox/switch: drive via keyboard/native events (overlays swallow clicks)
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name
// -> semantic/text fallback. data-testid candidates are listed first even though
// the current build exposes none, so the suite auto-upgrades when they land.
//
// The 6 steps:
//   1. Profile type  — Student / Graduate
//   2. Education      — University, Degree, Field of Study, Start/Graduation dates
//   3. Work experience — type, company, role, "I currently work here", dates
//   4. Certifications — name, issuing org, issue date, expiry / "Does not expire"
//   5. Work preferences — programs, location, relocation (+ preferred locations)
//   6. Role interests — multi-select grid; "Finish" -> /getting-started
// A global "Skip" button advances ONE step at a time (skipping all six lands on
// /getting-started with 0% profile completion).
class OnboardingPage extends BasePage {
  constructor(page) {
    super(page);

    // ---- Global chrome / navigation ----
    this.skipButton = page.getByRole('button', { name: /^skip$/i }).first();
    this.nextButton = page.getByRole('button', { name: /^next$/i }).first();
    this.backButton = page.getByRole('button', { name: /^back$/i }).first();
    this.finishButton = page.getByRole('button', { name: /^finish$/i }).first();

    // Step indicator, e.g. "Step 1 of 6".
    this.stepIndicator = page.getByText(/step \d of 6/i).first();

    // ---- Step 1: profile type ----
    this.studentOption = page.getByRole('button', { name: /^student/i }).first();
    this.graduateOption = page.getByRole('button', { name: /^graduate/i }).first();

    // ---- Getting Started (post-onboarding destination) ----
    this.welcomeHeading = page.getByRole('heading', { name: /welcome,/i }).first();
    this.profileCompletionValue = page
      .getByText(/^\d{1,3}%$/)
      .first();
  }

  // ---------- Generic combobox / option helpers ----------

  // Click the exact option in the currently-open portaled listbox.
  async pickOption(name) {
    const opt = this.page.getByRole('option', { name, exact: true }).first();
    await opt.waitFor({ state: 'visible', timeout: 15000 });
    // The listbox plays an open animation and can re-render mid-click; let it
    // settle, then retry once if the option element detaches.
    await this.page.waitForTimeout(250);
    try {
      await opt.click({ timeout: 5000 });
    } catch {
      await this.page.getByRole('option', { name, exact: true }).first().click({ timeout: 10000 });
    }
  }

  // Open a button-triggered dropdown and pick an option. These react-aria
  // listboxes intermittently render an EMPTY collection on first open, so if the
  // option isn't there we close and reopen (up to 3 tries) before force-clicking
  // it (force avoids the mid-animation "element not stable/detached" flakiness).
  async openDropdownAndPick(triggerLocator, optionName) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await triggerLocator.click();
      await this.page.waitForTimeout(400);
      const opt = this.page.getByRole('option', { name: optionName, exact: true }).first();
      if (await opt.isVisible().catch(() => false)) {
        try {
          await opt.click({ force: true, timeout: 5000 });
          await this.page.waitForTimeout(300);
          return;
        } catch {
          /* fall through to reopen */
        }
      }
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(200);
    }
    throw new Error(`Could not pick "${optionName}" from dropdown`);
  }

  // Focus a combobox, type the value so the react-aria listbox filters, then click
  // the exact matching option. Works for both fixed-list and free-text comboboxes.
  async chooseFromCombobox(nameRe, value) {
    const combo = this.page.getByRole('combobox', { name: nameRe }).first();
    const option = this.page.getByRole('option', { name: value, exact: true }).first();

    await combo.click();
    // The react-aria listbox frequently stays empty on the first fresh keystroke;
    // clear-and-retype until the filtered option appears.
    for (let attempt = 0; attempt < 3; attempt++) {
      await combo.fill('');
      await combo.pressSequentially(value, { delay: 30 });
      await this.page.waitForTimeout(500);
      if (await option.isVisible().catch(() => false)) break;
      await this.page.waitForTimeout(400);
    }
    await this.pickOption(value);
  }

  // Month/Year custom dropdowns for a dated section ("Start Date", "Graduation
  // Date", "Issue date", "End Date", "Expiry date"). Scope to the innermost <div>
  // holding BOTH the section label and a Month button — sections nest at different
  // depths (the Expiry block has an extra "Does not expire" row), so a fixed
  // parent hop is unreliable. Month/Year buttons are matched by accessible name
  // ("Select Month" -> "<Month> Month").
  async selectMonthYear(sectionLabel, month, year) {
    const section = this.page
      .locator('div')
      .filter({ has: this.page.getByText(sectionLabel, { exact: false }) })
      .filter({ has: this.page.getByRole('button', { name: /Month/i }) })
      .last();
    await this.openDropdownAndPick(section.getByRole('button', { name: /Month/i }).first(), month);
    await this.openDropdownAndPick(section.getByRole('button', { name: /Year/i }).first(), year);
  }

  // Certification/experience text inputs live in an accordion that REMOUNTS when a
  // date dropdown changes, discarding any not-yet-committed value. Typing (rather
  // than fill) drives React's onChange per keystroke; callers must also type these
  // AFTER all date selections so no later remount wipes them.
  async typeText(nameRe, value) {
    const box = this.page.getByRole('textbox', { name: nameRe }).first();
    await box.click();
    await box.fill('');
    await box.pressSequentially(value, { delay: 20 });
  }

  // ---------- Step 1: profile type ----------
  async selectProfileType(type) {
    const option = /graduate/i.test(type) ? this.graduateOption : this.studentOption;
    await option.click();
  }

  // ---------- Step 2: education ----------
  async fillEducation({
    university = 'King Saud University',
    degree = 'IT',
    field = 'Computer Science',
    startMonth = 'September',
    startYear = '2020',
    gradMonth = 'June',
    gradYear = '2024',
  } = {}) {
    await this.chooseFromCombobox(/University\/Institution Name/i, university);
    await this.chooseFromCombobox(/Degree/i, degree);
    await this.chooseFromCombobox(/Field of Study\/Major/i, field);
    await this.selectMonthYear('Start Date', startMonth, startYear);
    await this.selectMonthYear('Graduation Date', gradMonth, gradYear);
  }

  // ---------- Step 3: work experience ----------
  // Checking "I currently work here" removes the End Date requirement, so the
  // default happy path uses it (only a Start Date is then required).
  async fillWorkExperience({
    type = 'Internship',
    company = 'Bytecorp',
    role = 'QA Intern',
    currentlyWorking = true,
    startMonth = 'July',
    startYear = '2024',
    endMonth,
    endYear,
  } = {}) {
    await this.selectExperienceType(type);

    await this.page.getByRole('textbox', { name: /Company Name/i }).first().fill(company);
    await this.page.getByRole('textbox', { name: /Role\/Job Title/i }).first().fill(role);

    if (currentlyWorking) {
      await this.setCurrentlyWorkHere();
    }
    await this.selectMonthYear('Start Date', startMonth, startYear);
    if (!currentlyWorking && endMonth && endYear) {
      await this.selectMonthYear('End Date', endMonth, endYear);
    }
  }

  // The experience-type dropdown is a button-triggered react-aria listbox whose
  // option collection re-renders right after opening, detaching the option node
  // mid-click. Reopen and force-click until the trigger reflects the choice.
  async selectExperienceType(value) {
    const trigger = this.page.getByRole('button', { name: /What type of experience is this/i }).first();
    await this.openDropdownAndPick(trigger, value);
  }

  // react-aria checkbox/switch controls sit under decorative overlays, so pointer
  // clicks land on the decoration and desync the input's native `checked` from
  // React state (flaky). Keyboard Space on the focused control drives React
  // reliably; we verify via the side effect and retry rather than trusting the
  // (potentially desynced) checked property.
  async setCurrentlyWorkHere() {
    const cb = this.page.getByRole('checkbox', { name: /I currently work here/i }).first();
    for (let i = 0; i < 4; i++) {
      // Effect achieved when the End Date section is gone.
      if ((await this.page.getByText(/^End Date/i).count()) === 0) return;
      await cb.focus();
      await this.page.keyboard.press('Space');
      await this.page.waitForTimeout(400);
    }
    throw new Error('Could not check "I currently work here"');
  }

  // ---------- Step 4: certifications ----------
  // Dates are chosen first (they remount the accordion), then the text fields are
  // typed last so nothing wipes them. The default uses an explicit expiry date
  // rather than the "Does not expire" switch (see setDoesNotExpire caveat).
  async fillCertification({
    name = 'ISTQB Foundation',
    organization = 'ISTQB',
    issueMonth = 'March',
    issueYear = '2023',
    doesNotExpire = false,
    expiryMonth = 'March',
    expiryYear = '2027',
  } = {}) {
    await this.selectMonthYear('Issue date', issueMonth, issueYear);
    if (doesNotExpire) {
      await this.setDoesNotExpire();
    } else {
      await this.selectMonthYear('Expiry date', expiryMonth, expiryYear);
    }
    await this.typeText(/Issuing organization/i, organization);
    await this.typeText(/Certificate name/i, name);
  }

  // Toggle the "Does not expire" switch. The switch is overlaid by decorative
  // divs and different react-aria builds respond to different inputs, so we try
  // several methods until Next enables. Call this only AFTER the other required
  // certification fields are filled: enabling Next is then the single reliable
  // signal that the toggle registered (the expiry inputs may remain visible but
  // merely become optional, so their presence is not a usable signal).
  async setDoesNotExpire() {
    const sw = this.page.getByRole('switch').first();
    const done = async () => this.nextButton.isEnabled().catch(() => false);
    const attempts = [
      async () => { await sw.locator('xpath=ancestor::label[1]').click(); },
      async () => { await sw.focus(); await this.page.keyboard.press('Space'); },
      async () => { await sw.focus(); await this.page.keyboard.press('Enter'); },
      async () => { await sw.evaluate((el) => el.click()); },
    ];
    for (const attempt of attempts) {
      if (await done()) return;
      await attempt().catch(() => {});
      await this.page.waitForTimeout(500);
      if (await done()) return;
    }
    throw new Error('Could not toggle "Does not expire"');
  }

  // ---------- Step 5: work preferences ----------
  async fillWorkPreferences({
    location = 'Riyadh',
    relocation = 'Yes',
    preferredLocations = ['Jeddah'],
    programs = [],
  } = {}) {
    for (const program of programs) {
      await this.page.getByText(program, { exact: true }).first().click();
    }
    await this.chooseFromCombobox(/Where are you currently located/i, location);
    if (relocation) {
      await this.selectRelocation(relocation);
    }
    if (/^yes$/i.test(relocation || '')) {
      for (const loc of preferredLocations) {
        await this.chooseFromCombobox(/Preferred Work Location/i, loc);
        await this.page.keyboard.press('Escape');
      }
    }
  }

  async selectRelocation(answer) {
    await this.page.getByRole('button', { name: new RegExp(`^${answer}$`, 'i') }).first().click();
  }

  // ---------- Step 6: role interests ----------
  async selectRoleInterests(roles = ['Information Technology', 'Data Analyst']) {
    for (const role of roles) {
      await this.page.getByRole('button', { name: role, exact: true }).first().click();
    }
  }

  // ---------- Navigation ----------
  async clickNext() {
    await this.nextButton.click();
  }

  async clickFinish() {
    await this.finishButton.click();
  }

  async clickSkip() {
    await this.skipButton.click();
  }

  // Walk all six steps FILLING them in, and Finish.
  //
  // The counterpart to skipAllSteps(), and not interchangeable with it: skipping lands on
  // /getting-started at 0% profile completion, which the agent's In Progress list still reports
  // as "Profile Incomplete, Test Pending". Only a completed profile moves that to "Test Pending"
  // alone, so a lifecycle scenario asserting the transition has to complete rather than skip.
  //
  // Every filler is called with its own defaults - they were written that way for
  // onboarding.steps.js - so this adds no new test data. Each step is advanced with Next and the
  // last with Finish, which is what routes to /getting-started.
  async completeAllSteps({ profileType = 'Student' } = {}) {
    const completed = [];
    await this.selectProfileType(profileType);
    await this.clickNext();
    completed.push('profile type');

    await this.fillEducation();
    await this.clickNext();
    completed.push('education');

    await this.fillWorkExperience();
    await this.clickNext();
    completed.push('work experience');

    await this.fillCertification();
    await this.clickNext();
    completed.push('certifications');

    await this.fillWorkPreferences();
    await this.clickNext();
    completed.push('work preferences');

    await this.selectRoleInterests();
    await this.clickFinish();
    completed.push('role interests');

    await this.page.waitForURL(/\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
    return completed;
  }

  // Skip advances one step at a time; click it until we leave the wizard.
  async skipAllSteps() {
    for (let i = 0; i < 6; i++) {
      if (/\/getting-started/.test(this.page.url())) break;
      await this.skipButton.click();
      await this.page.waitForTimeout(300);
    }
    await this.page.waitForURL(/\/getting-started/, { timeout: 20000 });
  }

  // Reach a specific step (2..6) from step 1 by skipping the preceding steps.
  async skipToStep(step) {
    for (let i = 1; i < step; i++) {
      await this.skipButton.click();
      await this.page.waitForTimeout(300);
    }
  }
}

module.exports = OnboardingPage;
