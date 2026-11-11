const BasePage = require('./BasePage');

// InviteAgentPage — Page Object for the SUPERADMIN "User Management > Agents >
// Invite Agent" form at /agents/invite.
//
// Live DOM verified 2026-07-30. The app is react-aria + Tailwind (NOT MUI) on this
// screen and uses react-toastify for toasts, so the fallback layers differ from the
// older MUI Page Objects in this repo: data-testid -> ARIA role/name -> semantic
// HTML/placeholder -> Tailwind structural class -> text. There is not a single
// data-testid on this form today; the testid candidate is still listed first on every
// locator so the suite auto-upgrades when the app team adds them.
//
// Verified layout (2026-07-30):
//   route        /agents/invite
//   header       <p>Invite Agent</p> + <a href="/agents">Exit</a>
//   h1           "Invite new agent"   (lower-case "new" — the AC writes "Invite New Agent")
//   sections     <p>Basic Info</p> | <p>University & Performance Targets</p>
//                <p>Promo Code Details</p>
//   First Name   input[type=text] placeholder "e.g. Alex"          required, caps at 100 chars
//   Last Name    input[type=text] placeholder "e.g. Smith"         required, caps at 100 chars
//   Email        input[type=email] placeholder "alex.smith@example.com"  required
//   University   input[role=combobox] placeholder "Select university..."
//                + button[aria-label="Show suggestions"] -> [role=listbox] with 137
//                [role=option]s. NOTE: typing does NOT filter the list — the option must
//                be clicked by its accessible name.
//   Target       input[type=text][inputmode=decimal] placeholder "0"   required
//   Promo check  input[type=checkbox] — react-aria clips it to 1px, so a direct click is
//                intercepted by <html>. Click the "Add promo code for this agent." text.
//   Promo name   input[type=text] placeholder "CODE2026"  READ-ONLY, app-generated
//   Incentive    input[type=radio][name=incentiveType][value=percentage|fixed]
//                (percentage is pre-checked — see the @known-issue in the feature)
//   Value        input[inputmode=decimal] placeholder "e.g. 15" (%) / "e.g. 50" (SAR),
//                suffix rendered as a sibling <span>
//   Expiry       group > button[aria-label="Calendar"] showing DD/MM/YYYY, backed by a
//                hidden input[type=date]. The popover is [role=dialog] > [role=application]
//                with 35 [role=gridcell]s; each cell is <td><div role="button"
//                aria-label="Friday, July 31, 2026">. Picking a day updates the field
//                IMMEDIATELY; Apply only closes the popover.
//   Usage Limit  input[inputmode=numeric] placeholder "Enter max number of uses (e.g., 100)"
//   Submit       button[type=submit] "Send Invite" — disabled until the form is valid
//   Success      [role=dialog] with h2 "Agent invited successfully!" and the CTAs
//                "Invite New Agent" / "Go to Agents"
//   Endpoint     POST /core/api/v1/admin/invite/agent/  -> 200 {"detail":"Invitation sent."}
//                                                       -> 422 on a duplicate email
//
// Validation copy, all captured live:
//   First Name is required. / Last Name is required. / Performance target is required.
//   Enter a valid email address. / Usage limit is required.
//   Value must be at least 1.            (fixed amount and usage limit, min)
//   Enter a valid percentage value.       (percentage, 0 or malformed)
//   Value cannot exceed 100%.            (percentage, max)
//   Value cannot exceed 999999 SAR.      (fixed amount, max)
class InviteAgentPage extends BasePage {
  constructor(page) {
    super(page);
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    this.origin = origin;
    this.url = `${origin}/agents/invite`;
    this.agentsUrl = `${origin}/agents`;

    // ---- Chrome ----
    this.heading = page
      .locator('[data-testid="invite-agent-heading"]')
      .or(page.getByRole('heading', { level: 1 }))
      .first();
    this.subheading = page.getByText(/provide profile details, set performance targets/i).first();
    this.exitLink = page
      .locator('[data-testid="invite-agent-exit"]')
      .or(page.getByRole('link', { name: /^exit$/i }))
      .or(page.getByRole('button', { name: /^exit$/i }))
      .first();

    // ---- Promo section ----
    this.promoCheckbox = page
      .locator('[data-testid="invite-agent-promo-toggle"]')
      .or(page.getByRole('checkbox', { name: /add promo code for this agent/i }))
      .or(page.locator('input[type="checkbox"]'))
      .first();
    // The <input> is clipped to 1px by react-aria and every click on it is intercepted
    // by an ancestor, so the label text is the only reliable click target.
    this.promoCheckboxLabel = page.getByText(/^add promo code for this agent\.?$/i).first();
    this.promoCodeNameInput = page
      .locator('[data-testid="invite-agent-promo-code"]')
      .or(page.locator('input[placeholder="CODE2026"]'))
      .or(page.locator('input[aria-label="CODE2026"]'))
      .first();
    this.percentageRadio = page.locator('input[type="radio"][value="percentage"]').first();
    this.fixedRadio = page.locator('input[type="radio"][value="fixed"]').first();
    this.percentageLabel = page.getByText(/^percentage discount$/i).first();
    this.fixedLabel = page.getByText(/^fixed amount$/i).first();
    this.incentiveRadioGroup = page.locator('[role="radiogroup"]').first();

    // ---- Expiry date ----
    this.expiryTrigger = page
      .locator('[data-testid="invite-agent-expiry"]')
      .or(page.getByRole('button', { name: /^calendar/i }))
      .first();
    this.expiryHiddenInput = page.locator('input[type="date"]').first();
    this.calendarPopover = page.locator('[role="dialog"]:has([role="application"])').first();
    this.calendarGrid = this.calendarPopover.locator('[role="grid"]').first();
    this.calendarPrev = this.calendarPopover.getByRole('button', { name: /previous/i }).first();
    this.calendarNext = this.calendarPopover.getByRole('button', { name: /next/i }).first();
    this.calendarToday = this.calendarPopover.getByRole('button', { name: /^today$/i }).first();
    this.calendarApply = this.calendarPopover.getByRole('button', { name: /^apply$/i }).first();
    this.calendarCancel = this.calendarPopover.getByRole('button', { name: /^cancel$/i }).first();

    // ---- Submit + outcome ----
    this.submitButton = page
      .locator('[data-testid="invite-agent-submit"]')
      .or(page.getByRole('button', { name: /^send invite$/i }))
      .or(page.locator('button[type="submit"]'))
      .first();
    this.successModal = page.locator('[role="dialog"]:has-text("invited successfully")').first();
    this.successHeading = page
      .getByRole('heading', { name: /agent invited successfully/i })
      .first();
    // react-toastify, not notistack/sonner — verified live.
    this.toast = page.locator('.Toastify__toast, .Toastify__toast-body, [role="status"], [role="alert"]');
  }

  // ==================== Navigation ====================

  async goto() {
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.field('First Name').waitFor({ state: 'visible', timeout: 60000 });
  }

  async isOnInvitePage() {
    return /\/agents\/invite/.test(this.page.url());
  }

  async clickExit() {
    await this.exitLink.click();
    await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 });
  }

  // ==================== Field registry ====================

  // Every Gherkin field label maps to exactly one anchor element here. `field()` returns
  // the control the steps read/write; for Expiry Date that is the calendar trigger and
  // for Incentive Type the radiogroup, since neither has a typeable input.
  field(name) {
    const p = this.page;
    switch (String(name).trim().toLowerCase()) {
      case 'first name':
        return p
          .locator('[data-testid="invite-agent-first-name"]')
          .or(p.getByRole('textbox', { name: /first name/i }))
          .or(p.getByPlaceholder('e.g. Alex'))
          .first();
      case 'last name':
        return p
          .locator('[data-testid="invite-agent-last-name"]')
          .or(p.getByRole('textbox', { name: /last name/i }))
          .or(p.getByPlaceholder('e.g. Smith'))
          .first();
      case 'email address':
        return p
          .locator('[data-testid="invite-agent-email"]')
          .or(p.locator('input[type="email"]'))
          .or(p.getByPlaceholder(/alex\.smith@example\.com/i))
          .first();
      case 'university affiliation':
        return p
          .locator('[data-testid="invite-agent-university"]')
          .or(p.locator('input[role="combobox"]'))
          .or(p.getByPlaceholder(/select university/i))
          .first();
      case 'numeric performance target (monthly)':
      case 'performance target':
        return p
          .locator('[data-testid="invite-agent-target"]')
          .or(p.getByRole('textbox', { name: /performance target/i }))
          .or(p.locator('input[inputmode="decimal"][placeholder="0"]'))
          .first();
      case 'promo code name':
        return this.promoCodeNameInput;
      case 'incentive type':
        return this.incentiveRadioGroup;
      case 'value':
        // Two decimal inputs exist once the promo section is open (the performance
        // target is the other one); the promo Value is always the later of the two.
        return p
          .locator('[data-testid="invite-agent-promo-value"]')
          .or(p.locator('input[inputmode="decimal"]:not([placeholder="0"])'))
          .first();
      case 'expiry date':
        return this.expiryTrigger;
      case 'usage limit':
        return p
          .locator('[data-testid="invite-agent-usage-limit"]')
          .or(p.getByRole('textbox', { name: /usage limit/i }))
          .or(p.getByPlaceholder(/enter max number of uses/i))
          .first();
      default:
        throw new Error(
          `InviteAgentPage.field: unknown field "${name}". Known fields: First Name, `
          + 'Last Name, Email Address, University Affiliation, Numeric Performance Target '
          + '(Monthly), Promo Code Name, Incentive Type, Value, Expiry Date, Usage Limit.'
        );
    }
  }

  async isFieldVisible(name) {
    return this.field(name).isVisible().catch(() => false);
  }

  // ==================== Reading / writing fields ====================

  // Set a value in one shot. Use this when the scenario cares about the RESULT.
  async enter(name, value) {
    const key = String(name).trim().toLowerCase();
    if (key === 'university affiliation') return this.selectUniversity(value);
    if (key === 'expiry date') return this.setExpiryFromToday(Number(value) || 1);
    const target = this.field(name);
    await target.fill('');
    if (value !== '') await target.fill(String(value));
    return undefined;
  }

  // Type character by character. Required wherever the scenario asserts INPUT FILTERING
  // (the form strips disallowed characters in an onChange handler, so a single fill()
  // would not exercise it the way a user does).
  async typeInto(name, text) {
    const target = this.field(name);
    await target.fill('');
    if (text !== '') await target.pressSequentially(String(text), { delay: 8 });
  }

  async clear(name) {
    const key = String(name).trim().toLowerCase();
    if (key === 'expiry date') return this.clearExpiry();
    const target = this.field(name);
    await target.fill('');
    return undefined;
  }

  async valueOf(name) {
    const key = String(name).trim().toLowerCase();
    if (key === 'expiry date') return this.expiryDisplayText();
    if (key === 'incentive type') return this.selectedIncentive();
    return this.field(name).inputValue();
  }

  async blur(name) {
    await this.field(name).evaluate((el) => el.blur());
    // Validation is re-rendered on the blur tick; give React one frame.
    await this.page.waitForTimeout(350);
  }

  async isReadOnly(name) {
    return this.field(name).evaluate((el) => el.readOnly === true || el.disabled === true);
  }

  // Inline error for ONE field.
  //
  // The error is rendered as a DIRECT CHILD of the field's own group container
  // (`<span class="text-sm text-error-primary">` for react-aria fields, `<p class="mt-1.5
  // text-sm text-error-primary">` for the promo Value). Matching only direct children
  // while climbing is what keeps a neighbouring field's error from being reported as this
  // field's: a plain `closest()`-style search would happily return "First Name is
  // required." when asked about Email Address, because both live under the same section.
  async errorFor(name) {
    const anchor = this.field(name);
    if (!(await anchor.count())) return '';
    return anchor.first().evaluate((el) => {
      let n = el;
      for (let i = 0; i < 6 && n; i += 1, n = n.parentElement) {
        const own = Array.from(n.children).find(
          (c) => c.classList.contains('text-error-primary') && c.children.length === 0 && (c.innerText || '').trim()
        );
        if (own) return own.innerText.trim();
      }
      return '';
    });
  }

  async hasErrorFor(name) {
    return Boolean(await this.errorFor(name));
  }

  // Is a field PAINTED as invalid — the red outline a user actually sees?
  //
  // >>> DO NOT ASSERT THIS FROM `border-color`. <<< Measured 2026-09-04
  // (scripts/probe-invite-duplicate-field-state.js): the border is `rgb(24, 29, 39)` on a
  // clean field AND on one the app has just rejected, because this form is Tailwind and the
  // outline is a RING — an inset `box-shadow` on the input's wrapper, not a border at all.
  // A reader built on `borderColor` reports "not red" for every field in every state and can
  // never fail, which is the trap this repo has already paid for twice (the community
  // module's disabled-promo greying, and the save toast).
  //
  // The ring colour is compared against a CONTROL FIELD on the same rendered form rather
  // than against a hardcoded rgb: a palette change should not turn this red, and there is no
  // absolute "not error" colour to test a single render against. Live values for reference —
  // neutral `rgb(213, 215, 218)`, error `rgb(253, 162, 155)` — but nothing asserts them.
  async fieldErrorState(name, { control = 'First Name' } = {}) {
    const ring = (locator) =>
      locator.evaluate((el) => {
        const host = el.closest('div');
        return {
          ariaInvalid: el.getAttribute('aria-invalid'),
          dataInvalid: el.getAttribute('data-invalid'),
          ring: host ? getComputedStyle(host).boxShadow : null,
        };
      });
    const [self, reference] = await Promise.all([ring(this.field(name)), ring(this.field(control))]);
    return {
      field: name,
      control,
      inlineError: await this.errorFor(name),
      ariaInvalid: self.ariaInvalid === 'true' || self.dataInvalid === 'true',
      ring: self.ring,
      controlRing: reference.ring,
      // "Red" means: painted differently from a field the same form is rendering normally.
      ringDiffersFromControl: self.ring !== reference.ring,
    };
  }

  // Every visible validation message on the form, for the "no error anywhere" assertions.
  async allErrors() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.text-error-primary'))
        .filter((e) => e.children.length === 0 && (e.innerText || '').trim())
        .map((e) => e.innerText.trim())
    );
  }

  // ==================== Structure ====================

  async sectionTitles() {
    return this.page.evaluate(() => {
      const wanted = /^(basic info|university & performance targets|promo code details)$/i;
      return Array.from(document.querySelectorAll('main p, main h2, main h3, main legend'))
        .filter((el) => el.offsetParent !== null && wanted.test((el.innerText || '').trim()))
        .map((el) => el.innerText.trim());
    });
  }

  // Labels that render a required asterisk. Read as a set of label texts so a step can
  // assert "<field> is marked required" without depending on the label's DOM position.
  async requiredMarkedLabels() {
    const raw = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('main div, main label, main p, main span'))
        .filter((el) => el.offsetParent !== null && (el.innerText || '').includes('*') && (el.innerText || '').length < 60)
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim())
        .filter(Boolean)
    );
    return [...new Set(raw)];
  }

  async isMarkedRequired(name) {
    const labels = await this.requiredMarkedLabels();
    const wanted = String(name).trim().toLowerCase();
    return labels.some((l) => l.toLowerCase() === wanted);
  }

  // ==================== University combobox ====================

  // The 136-option list is fetched from Configuration, so a click that lands while the
  // request is still in flight opens an EMPTY listbox — and a second click on the trigger
  // would then toggle it shut. Retry from a known-closed state instead, and only give up
  // after the list has really failed to arrive.
  async openUniversityDropdown() {
    const trigger = this.page
      .locator('[data-testid="invite-agent-university-trigger"]')
      .or(this.page.getByRole('button', { name: /show suggestions/i }))
      .first();
    const firstOption = this.page.locator('[role="option"]').first();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (await firstOption.isVisible().catch(() => false)) return;
      await trigger.click().catch(() => {});
      try {
        await firstOption.waitFor({ state: 'visible', timeout: 20000 });
        return;
      } catch (e) {
        if (attempt === 3) {
          throw new Error(
            'The University Affiliation dropdown never rendered any options after 3 attempts — '
            + 'the Configuration list did not load.'
          );
        }
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(2000);
      }
    }
  }

  async closeUniversityDropdown() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.locator('[role="listbox"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async universityOptions() {
    if (!(await this.page.locator('[role="option"]').first().isVisible().catch(() => false))) {
      await this.openUniversityDropdown();
    }
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]')).map((o) => (o.innerText || '').trim()).filter(Boolean)
    );
  }

  // Pick a university by its EXACT accessible name. Exactness matters: the list holds
  // both "King Saud University" and "King Saud University (KSU)".
  //
  // The combobox FILTERS its list by whatever text it currently holds — verified live
  // 2026-07-30: with "King Saud University" selected, reopening offers 3 options instead of
  // 139, so changing the selection silently timed out. Clearing the input first restores
  // the full list.
  async selectUniversity(name) {
    const input = this.field('University Affiliation');
    if (await input.inputValue().catch(() => '')) {
      await input.click();
      await input.press('ControlOrMeta+a');
      await input.press('Delete');
      await this.page.waitForTimeout(600);
      await this.closeUniversityDropdown();
    }
    await this.openUniversityDropdown();
    const option = this.page.getByRole('option', { name: String(name), exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.scrollIntoViewIfNeeded().catch(() => {});
    await option.click();
    await this.page.waitForTimeout(300);
  }

  async selectedUniversity() {
    return this.field('University Affiliation').inputValue();
  }

  // Empty the combobox the way a superadmin would after picking the wrong university:
  // select the text and delete it, then move focus away so any on-blur validation fires.
  //
  // fill('') is deliberately NOT used — it sets the value without the keystrokes react-aria
  // listens for, so the component's own "selection cleared" path never runs and the field can
  // snap back to the previous selection. Focus lands on First Name because the combobox has
  // no other neighbour that is always present.
  async clearUniversity() {
    const input = this.field('University Affiliation');
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Delete');
    await this.page.waitForTimeout(300);
    await this.closeUniversityDropdown();
    await this.field('First Name').click().catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // Type a name that is on no list, to see what the combobox does with it. Returns what the
  // field holds after focus moves away — live it silently reverts to empty.
  async typeUnknownUniversity(text) {
    const input = this.field('University Affiliation');
    await input.click();
    await input.fill('');
    await input.pressSequentially(String(text), { delay: 30 });
    await this.page.waitForTimeout(800);
    await this.closeUniversityDropdown();
    await this.field('First Name').click().catch(() => {});
    await this.page.waitForTimeout(600);
    return input.inputValue();
  }

  // ==================== Promo section ====================

  async isPromoChecked() {
    return this.promoCheckbox.isChecked().catch(() => false);
  }

  async setPromo(on) {
    if ((await this.isPromoChecked()) === on) return;
    await this.promoCheckboxLabel.click();
    await this.page.waitForFunction(
      (want) => {
        const cb = document.querySelector('input[type="checkbox"]');
        return cb && cb.checked === want;
      },
      on,
      { timeout: 10000 }
    );
    await this.page.waitForTimeout(400);
  }

  async promoCodeName() {
    return this.promoCodeNameInput.inputValue();
  }

  async selectIncentive(type) {
    const label = /fixed/i.test(type) ? this.fixedLabel : this.percentageLabel;
    await label.click();
    await this.page.waitForTimeout(400);
  }

  async selectedIncentive() {
    if (await this.percentageRadio.isChecked().catch(() => false)) return 'Percentage Discount';
    if (await this.fixedRadio.isChecked().catch(() => false)) return 'Fixed Amount';
    return '';
  }

  async incentiveOptions() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('input[name="incentiveType"]')).map((r) => {
        const wrap = r.closest('div');
        return ((wrap && wrap.innerText) || r.value || '').replace(/\s+/g, ' ').trim();
      })
    );
  }

  // The "%" / "SAR" suffix rendered as a sibling <span> of the Value input.
  async valueSuffix() {
    return this.field('Value').evaluate((el) => {
      const wrap = el.parentElement;
      if (!wrap) return '';
      const sib = Array.from(wrap.children).find((c) => c !== el && (c.innerText || '').trim());
      return sib ? sib.innerText.trim() : '';
    });
  }

  // ==================== Expiry date picker ====================

  // Idempotent on purpose: a scenario that inspects the open calendar and then picks a
  // date calls this twice, and a second click on the trigger would TOGGLE the popover shut.
  async openExpiryCalendar() {
    if (!(await this.calendarPopover.isVisible().catch(() => false))) {
      await this.expiryTrigger.click();
      await this.calendarPopover.waitFor({ state: 'visible', timeout: 15000 });
    }
    await this.page.locator('[role="gridcell"]').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  async closeExpiryCalendar() {
    if (await this.calendarPopover.isVisible().catch(() => false)) {
      await this.calendarApply.click().catch(() => {});
      await this.calendarPopover.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }

  // Every day cell with its accessible name and enabled state, so a step can assert the
  // shape of the selectable window without re-deriving the calendar's DOM.
  async calendarDays() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="gridcell"]')).map((td) => {
        const inner = td.querySelector('[role="button"]') || td;
        return {
          day: (td.innerText || '').trim(),
          label: inner.getAttribute('aria-label') || '',
          disabled: td.getAttribute('aria-disabled') === 'true' || inner.hasAttribute('data-disabled'),
          today: inner.hasAttribute('data-today'),
          outsideMonth: inner.hasAttribute('data-outside-month'),
        };
      })
    );
  }

  async isPreviousMonthDisabled() {
    return this.calendarPrev.isDisabled().catch(() => true);
  }

  async calendarMonthLabel() {
    return this.page.evaluate(() => {
      const app = document.querySelector('[role="application"]');
      if (!app) return '';
      const m = (app.innerText || '').match(/([A-Z][a-z]+)\s+(\d{4})/);
      return m ? `${m[1]} ${m[2]}` : '';
    });
  }

  // Click a day by its full accessible name, e.g. "Friday, July 31, 2026". react-aria puts
  // the label on an inner div[role=button], not on the <td role=gridcell>.
  async selectCalendarDayByLabel(labelFragment) {
    const cell = this.page.locator(`[role="gridcell"] [aria-label*="${labelFragment}"]`).first();
    await cell.click();
    await this.page.waitForTimeout(400);
  }

  // The first day the calendar will accept. react-aria appends "First available date" to
  // that cell's label, which is what makes the AC's "window starts tomorrow" assertion
  // checkable without re-deriving the rule from the disabled cells.
  async firstAvailableDay() {
    const days = await this.calendarDays();
    const flagged = days.find((d) => /first available date/i.test(d.label));
    return flagged || days.find((d) => !d.disabled && !d.outsideMonth) || null;
  }

  async goToNextMonth(times = 1) {
    for (let i = 0; i < times; i += 1) {
      await this.calendarNext.click();
      await this.page.waitForTimeout(250);
    }
  }

  // Pick `offsetDays` from today via the calendar, walking forward a month at a time when
  // the target falls outside the month on screen. Returns the chosen ISO date.
  async setExpiryFromToday(offsetDays = 1) {
    const target = new Date();
    target.setDate(target.getDate() + Number(offsetDays));
    const iso = toIsoDate(target);

    await this.openExpiryCalendar();
    const wantedLabel = formatCalendarLabel(target);
    for (let hop = 0; hop < 24; hop += 1) {
      const cell = this.page.locator(`[role="gridcell"] [aria-label*="${wantedLabel}"]`).first();
      if (await cell.isVisible().catch(() => false)) {
        const selectable = await cell.evaluate((el) =>
          !el.hasAttribute('data-disabled')
          && el.getAttribute('aria-disabled') !== 'true'
          && !el.hasAttribute('data-outside-month')
          && !el.closest('[role="gridcell"]')?.hasAttribute('data-outside-month')
        ).catch(() => false);
        if (selectable) {
          await cell.click();
          await this.page.waitForTimeout(400);
          await this.closeExpiryCalendar();
          return iso;
        }
      }
      await this.goToNextMonth(1);
    }
    throw new Error(`Could not reach ${wantedLabel} in the expiry calendar after 24 forward hops.`);
  }

  // The trigger renders the chosen date (or the DD/MM/YYYY placeholder when empty).
  async expiryDisplayText() {
    const txt = (await this.expiryTrigger.innerText().catch(() => '')) || '';
    return txt.replace(/\s+/g, ' ').trim();
  }

  async expiryIsoValue() {
    return this.expiryHiddenInput.inputValue().catch(() => '');
  }

  async isExpiryEmpty() {
    const shown = await this.expiryDisplayText();
    return /^DD\/MM\/YYYY$/i.test(shown) || shown === '';
  }

  // The AC calls for the SELECTED date to render in the standard text colour (#181D27)
  // rather than the lighter placeholder grey — a logged defect that is now fixed.
  async expiryTextColour() {
    return this.expiryTrigger.evaluate((el) => {
      const leaf = el.querySelector('span, div, p') || el;
      return getComputedStyle(leaf).color;
    });
  }

  // There is no way to clear a chosen expiry: the field renders no clear affordance, and
  // unticking/re-ticking the promo section no longer drops the promo values either (see the
  // @known-issue for it). Throwing beats a silent no-op that would let a later "should be
  // empty" assertion pass on a stale value.
  async clearExpiry() {
    throw new Error(
      'Expiry Date cannot be cleared: the form renders no clear affordance, and unticking '
      + 'the promo section preserves the promo values. Reload the invite page instead.'
    );
  }

  async isCalendarApplyUsable() {
    return (await this.calendarApply.isVisible().catch(() => false))
      && (await this.calendarApply.isEnabled().catch(() => false));
  }

  // The popover's "Today" shortcut, alongside Cancel / Apply — a second way to reach the same
  // date the day grid offers, so its enabled state has to match the grid's cell for today.
  async isCalendarTodayShortcutEnabled() {
    const button = this.calendarPopover.getByRole('button', { name: /^today$/i }).first();
    if (!(await button.isVisible().catch(() => false))) return null;
    const ariaDisabled = await button.getAttribute('aria-disabled').catch(() => null);
    return (await button.isEnabled().catch(() => false)) && ariaDisabled !== 'true';
  }

  async scrollCalendar() {
    await this.calendarPopover.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      const inner = el.querySelector('[role="application"]');
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await this.page.waitForTimeout(300);
  }

  // ==================== Submit ====================

  async isSubmitEnabled() {
    return this.submitButton.isEnabled();
  }

  async submitLabel() {
    return (await this.submitButton.innerText()).trim();
  }

  async clickSubmit() {
    await this.submitButton.click();
  }

  // Two clicks inside the same tick, to prove a slow backend cannot be made to create
  // two agents by an impatient superadmin.
  async doubleClickSubmit() {
    await this.submitButton.dblclick();
  }

  async waitForSuccessModal(timeout = 45000) {
    await this.successHeading.waitFor({ state: 'visible', timeout });
  }

  async isSuccessModalVisible() {
    return this.successHeading.isVisible().catch(() => false);
  }

  async successModalHeadingText() {
    return (await this.successHeading.innerText().catch(() => '')).trim();
  }

  async successModalCtas() {
    return this.page.evaluate(() => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /invited successfully/i.test(d.innerText || ''));
      if (!dlg) return [];
      return Array.from(dlg.querySelectorAll('button, a'))
        .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    });
  }

  async clickSuccessModalCta(label) {
    const dlg = this.page.locator('[role="dialog"]').filter({ hasText: /invited successfully/i }).first();
    await dlg.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first().click();
    await this.page.waitForTimeout(1200);
  }

  async toastMessages() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.Toastify__toast, .Toastify__toast-body, [role="status"], [role="alert"]'))
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    );
  }

  // Clear the toast stack so a later assertion cannot pass on a stale message. Clicks the
  // close buttons first, then waits out react-toastify's autoClose for anything left.
  // Returns true once nothing is on screen.
  async dismissToasts(timeout = 15000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const closers = this.page.locator('.Toastify__close-button');
      const count = await closers.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        await closers.nth(i).click({ timeout: 2000 }).catch(() => {});
      }
      await this.page.waitForTimeout(600);
      if (!(await this.toastMessages()).length) return true;
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(1000);
    }
  }

  // ==================== Whole-form helpers ====================

  // Fill every required field with valid details. Promo is left alone — the caller
  // decides, because "complete" means something different with and without a promo.
  async fillValidDetails({
    firstName = 'Aisha',
    lastName = 'Al-Fahad',
    email,
    university = 'King Saud University',
    target = '10',
  } = {}) {
    await this.enter('First Name', firstName);
    await this.enter('Last Name', lastName);
    if (email !== undefined) await this.enter('Email Address', email);
    await this.selectUniversity(university);
    await this.enter('Numeric Performance Target (Monthly)', target);
    await this.page.waitForTimeout(400);
    return { firstName, lastName, email, university, target };
  }

  // Drive the promo section from the Gherkin phrases the feature uses:
  //   "unchecked" | "Percentage Discount of 20" | "Fixed Amount of 200"
  async completePromoSection(state, { expiryOffsetDays = 30, usageLimit = '100' } = {}) {
    if (/^unchecked$/i.test(state)) {
      await this.setPromo(false);
      return null;
    }
    const match = String(state).match(/^(percentage discount|fixed amount)\s+of\s+([\d.]+)$/i);
    if (!match) {
      throw new Error(
        `Unrecognised promo state "${state}". Use "unchecked", `
        + '"Percentage Discount of <value>" or "Fixed Amount of <value>".'
      );
    }
    const [, type, value] = match;
    await this.setPromo(true);
    await this.selectIncentive(type);
    await this.enter('Value', value);
    const iso = await this.setExpiryFromToday(expiryOffsetDays);
    await this.enter('Usage Limit', usageLimit);
    await this.page.waitForTimeout(400);
    return { type, value, expiry: iso, usageLimit };
  }

  // Snapshot every field, for the draft-persistence scenario.
  async snapshotForm() {
    return {
      firstName: await this.valueOf('First Name'),
      lastName: await this.valueOf('Last Name'),
      email: await this.valueOf('Email Address'),
      university: await this.selectedUniversity(),
      target: await this.valueOf('Numeric Performance Target (Monthly)'),
      promoChecked: await this.isPromoChecked(),
    };
  }

  async isFormEmpty() {
    const snap = await this.snapshotForm();
    const filled = Object.entries(snap)
      .filter(([key]) => key !== 'promoChecked')
      .filter(([, v]) => String(v || '').trim() !== '');
    return { empty: filled.length === 0 && snap.promoChecked === false, filled, snap };
  }

  // ==================== Failure injection ====================

  // The invite endpoint, verified live. Intercepted rather than triggered for real:
  // there is no UI path to a 500 and no way to pull the network for one request only.
  get inviteEndpoint() {
    return /\/admin\/invite\/agent\/?$/;
  }

  // Re-stubbing has to drop the previous handler first: one scenario now exercises BOTH
  // failure modes over the same form, and a stale route would keep answering with the
  // failure it was registered for.
  async stubInviteFailure(kind) {
    const route = '**/admin/invite/agent/**';
    await this.page.unroute(route).catch(() => {});
    if (/network/i.test(kind)) {
      await this.page.route(route, (r) => r.abort('failed'));
      return;
    }
    await this.page.route(route, (r) =>
      r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error.' }),
      })
    );
  }

  // Record every invite POST the page makes, so a scenario can prove exactly one was
  // sent (double-click) or that none was (validation blocked the submit).
  trackInviteRequests() {
    const calls = [];
    const handler = (request) => {
      if (request.method() === 'POST' && this.inviteEndpoint.test(request.url())) {
        calls.push(request.url());
      }
    };
    this.page.on('request', handler);
    return {
      count: () => calls.length,
      stop: () => this.page.off('request', handler),
    };
  }
}

// --- helpers ---

function toIsoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// react-aria labels its day cells "Friday, July 31, 2026" — build the "July 31, 2026"
// fragment, which is unique within the calendar regardless of the weekday prefix.
function formatCalendarLabel(d) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = InviteAgentPage;
module.exports.toIsoDate = toIsoDate;
module.exports.formatCalendarLabel = formatCalendarLabel;
