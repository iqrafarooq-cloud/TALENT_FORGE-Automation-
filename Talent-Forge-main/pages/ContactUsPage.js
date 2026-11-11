const BasePage = require('./BasePage');

// ContactUsPage - Page Object for the Candidate Portal's "Contact Us" support form.
//
// >>> IT IS A MODAL, NOT A PAGE, AND THAT IS THE FIRST THING TO KNOW. <<<
// It is opened from the sidebar entry, which is a bare <button> with NO href. So there is no
// /contact-us route, nothing to deep-link, nothing to reload into and no Back destination -
// the same shape as the SuperAdmin candidate View drawer. A step asserting a URL after opening
// it would be asserting a route the product does not have. Measured 2026-09-14: /contact-us,
// /contact, /support and /help all render an EMPTY body (0 characters).
//
// MEASURED LIVE 2026-09-14 on dev (scripts/probe-contact-us.js, -2.js, -upload.js). Every
// string, option value and rule below was read off the running app. Re-run those probes rather
// than reasoning about the DOM.
//
//   entry point   sidebar -> "Contact Us" (a <button>; the FAQs entry beside it IS a real <a>)
//   heading       "Need help? We're here for you."  (+ a sparkle emoji)
//   sub-heading   "Your assigned agent will respond via email within 24-48 hours."
//   fields        What do you need help with? *  (category, 6 options)
//                 What's the issue?           *  (issue, DEPENDENT - see below)
//                 Describe what happened      *  (textarea name="describe", maxlength 500)
//                 Upload Screenshot (optional)   (.png,.jpg,.jpeg - "PNG, JPG (max. 10MB)")
//   footer        Cancel | Submit  (Submit gated on the three required fields)
//   endpoint      POST /core/api/v1/candidate/feedback/  (multipart) -> 201
//                 {"category","issue","description","screenshot":null,"status":"OPEN"}
//   success       toast "Support request submitted successfully." and the modal closes
//
// >>> THE ONLY TWO data-testid ATTRIBUTES IN THE WHOLE MODAL ARE BOTH "hidden-select-container",
//     one per dropdown. <<< There is none on the dialog, either field, the textarea, the upload
//     control, Cancel or Submit. So the locators here are ARIA/structural by necessity rather
//     than preference - a testid layer is still written first where one might plausibly land,
//     so the suite auto-upgrades if the app team adds them.
//
// >>> EACH DROPDOWN IS A react-aria BUTTON + POPUP WITH A REAL HIDDEN <select> BESIDE IT. <<<
// The hidden select is what makes the options readable without opening anything, and its option
// VALUES are the codes the API receives (`technicalIssue`, `pageNotLoading`). But it is only a
// mirror: writing to it does not move React state, so every SELECTION must go through the
// visible button and its [role="option"] list. Reading one list and clicking a different one is
// the trap this repo has paid for repeatedly (the community Majors popover, the SuperAdmin
// candidates filter modal), so readOptions() and selectCategory() below are keyed on the SAME
// option id the app renders (`...-option-<value>`), never on an index into a second list.
//
// >>> "Other" REMOVES THE ISSUE FIELD ENTIRELY - IT DOES NOT MERELY DISABLE IT. <<<
// Category "Other" renders ONE select, not two. Any reader that assumes a second select is
// present reports a working form as broken, so every issue-side method tolerates its absence
// and says so rather than throwing something generic.
//
// >>> THE UPLOAD ANIMATES A FAKE PROGRESS BAR FOR ~2s AND FIRES NO REQUEST WHILE IT RUNS. <<<
// `Exact10MB.png 75% - 1 second remaining` -> `Exact10MB.png 10.0 MB`. A read taken straight
// after setInputFiles() catches the card mid-animation and reports an accepted file as refused.
// waitForUploadSettled() is the settle. Same failure mode as the bulk CSV zone and the
// community crop modal.
class ContactUsPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');

    // ---- Entry point (sidebar) ----
    // At >= ~1440px the sidebar is permanently rendered; narrower it is behind "Open menu",
    // which is why openFromSidebar() checks for the burger first. The [role="dialog"] arm of
    // this union is the narrow-viewport navigation drawer, which is also a dialog.
    this.sidebarEntry = page
      .locator('[data-testid="candidate-contact-us-link"], nav button, aside button, [role="dialog"] button')
      .filter({ hasText: /^\s*Contact Us\s*$/ })
      .first();
    this.menuButton = page.getByRole('button', { name: /open menu/i });
    this.faqsEntry = page.locator('a[href="/faqs"]').first();

    // ---- The dialog itself ----
    // Scoped by its own heading text, NOT [role="dialog"].first(): the navigation drawer is a
    // dialog at narrow widths and so is each dropdown popover while open, so an unscoped reader
    // resolves to the wrong element exactly when a dropdown is in play.
    this.modal = page.locator('[role="dialog"]').filter({ hasText: /Need help\?/i }).first();
    this.heading = this.modal.getByRole('heading').first();

    // ---- Controls ----
    this.closeButton = this.modal.locator('button[aria-label="Close"]').first();
    this.cancelButton = this.modal.locator('button').filter({ hasText: /^Cancel$/ }).first();
    this.submitButton = this.modal.locator('button[type="submit"]').first();

    this.descriptionInput = this.modal.locator('textarea[name="describe"], textarea').first();
    this.characterCounter = this.modal.locator('p').filter({ hasText: /^\d+\/500$/ }).first();

    this.fileInput = this.modal.locator('input[type="file"]');
    this.uploadButton = this.modal.locator('button').filter({ hasText: /click to upload/i }).last();
    this.uploadHint = this.modal.locator('p').filter({ hasText: /max\.\s*10\s*MB/i }).first();
    // The card the zone renders once a file is held. Derived from the one control only it has -
    // a Delete button - rather than from a class name. An aria-label union that also admits
    // "close" would match the dialog's own header Close and report a card that is not there.
    this.uploadedFileCard = this.modal.locator('button[aria-label="Delete"]');
  }

  // The rendered contract, verbatim as measured. Held here rather than in the step file so a
  // feature can assert wording without a scenario carrying a wall of strings.
  static get COPY() {
    return {
      // MEASURED CHARACTER BY CHARACTER 2026-09-14, because the two lines do NOT agree with each
      // other and a source file makes them look identical: the heading's apostrophe is a STRAIGHT
      // U+0027 while the sub-heading's dash is an EN DASH U+2013. Written with a curly U+2019
      // here, the heading check failed against copy that is word-for-word correct. Steps compare
      // through normaliseTypography() for that reason and record the raw text either way.
      heading: "Need help? We're here for you.",
      subHeading: 'Your assigned agent will respond via email within 24–48 hours.',
      categoryLabel: 'What do you need help with?',
      issueLabel: "What's the issue?",
      descriptionLabel: 'Describe what happened',
      descriptionPlaceholder: 'Let us know what happened and where you got stuck.',
      uploadLabel: 'Upload Screenshot (optional)',
      uploadHint: 'PNG, JPG (max. 10MB)',
      uploadCta: 'Click to upload',
      successToast: 'Support request submitted successfully.',
      // Both rejection messages are the build's, NOT any AC's. They are word-for-word the ones
      // the agent-portal bulk CSV zone raises, which is what identifies this as the same
      // component - so a change here is a change to both surfaces.
      rejectTooLarge: 'This file is too large. Maximum size is 10.0 MB.',
      rejectWrongType: 'This file type is not allowed. Use one of the accepted formats listed below.',
    };
  }

  // category value -> the issue options the app offers for it, in the ORDER it renders them.
  // Measured 2026-09-14. Note the ordering is NOT consistent: "Other" is LAST under
  // My Track/Progress and FIRST under all four others. Recorded here, and asserted as a SET
  // rather than a sequence - the inconsistency is a question for the PO, not a defect the
  // suite should go permanently red over.
  static get ISSUES() {
    return {
      myTrackProgress: [
        "I can't access a lesson",
        "I completed something but it's not updating",
        "I'm stuck and need guidance",
        'Other',
      ],
      assessmentTest: ['Other', 'Unable to start', 'Submission failed', 'Score seems incorrect'],
      documents: ['Other', 'Unable to submit or upload', 'Need clarification', 'Not approved'],
      paymentSubscription: ['Other', 'Payment failed', 'Need invoice', 'Want to cancel'],
      technicalIssue: [
        'Other',
        'Page not loading',
        'Error message displayed',
        'Progress/Status not updating',
        'Login issue',
      ],
      // NOT an empty list by oversight: choosing Other renders no issue field at all.
      other: null,
    };
  }

  static get CATEGORIES() {
    return {
      myTrackProgress: 'My Track/Progress',
      assessmentTest: 'Assessment/Test',
      documents: 'Documents',
      paymentSubscription: 'Payment/Subscription',
      technicalIssue: 'Technical Issue',
      other: 'Other',
    };
  }

  // Map a rendered label back to the value the app uses, so a feature file can say
  // "Technical Issue" and the step still knows to click `...-option-technicalIssue`.
  static categoryValue(label) {
    const hit = Object.entries(ContactUsPage.CATEGORIES).find(
      ([value, text]) =>
        text.toLowerCase() === String(label).trim().toLowerCase() ||
        value.toLowerCase() === String(label).trim().toLowerCase()
    );
    if (!hit) {
      throw new Error(
        `ContactUsPage: "${label}" is not a Contact Us category. The six are: ` +
          Object.values(ContactUsPage.CATEGORIES).join(', ')
      );
    }
    return hit[0];
  }

  // ---------------------------------------------------------------- opening / closing

  async openFromSidebar() {
    if (await this.isOpen()) return;
    const burger = this.menuButton;
    if (await burger.count()) {
      await burger.first().click();
      await this.page.waitForTimeout(500);
    }
    await this.sidebarEntry.click();
    await this.modal.waitFor({ state: 'visible', timeout: 20000 });
    // The dialog mounts before its dropdowns do; a read taken on `visible` alone sees the shell.
    await this.modal.locator('select').first().waitFor({ state: 'attached', timeout: 20000 });
  }

  async isOpen() {
    return (await this.modal.count()) > 0 && (await this.modal.isVisible().catch(() => false));
  }

  // "not visible" is also true of a modal the app has not rendered YET, so one read cannot
  // prove a dismissal worked on a page that is still settling. Watch a window instead - the
  // distinction saveStaysDisabled() exists to make in the promo module.
  async staysClosed(ms = 3000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.isOpen()) return false;
      await this.page.waitForTimeout(250);
    }
    return true;
  }

  async close(how = 'cancel') {
    if (how === 'escape') await this.page.keyboard.press('Escape');
    else if (how === 'x') await this.closeButton.click();
    else await this.cancelButton.click();
    await this.modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  // ---------------------------------------------------------------- dropdowns

  // Which trigger belongs to which field. Both are unnamed buttons, so they are taken
  // positionally after the header Close - but the count is asserted first, so a layout change
  // fails loudly here rather than silently driving the wrong control three steps later.
  async dropdownTrigger(field) {
    const buttons = this.modal.locator('button');
    const index = field === 'category' ? 1 : 2;
    const total = await buttons.count();
    if (total <= index) {
      throw new Error(
        `ContactUsPage: no ${field} dropdown trigger - the modal holds ${total} buttons. ` +
          (field === 'issue'
            ? 'Category "Other" removes the issue field entirely; check the category first.'
            : '')
      );
    }
    return buttons.nth(index);
  }

  // Read the options WITHOUT opening anything, off the hidden mirror select, in the app's own
  // order. Returns null for the issue field when the app renders none (category "Other").
  async readOptions(field) {
    const selects = this.modal.locator('select');
    const count = await selects.count();
    if (field === 'issue' && count < 2) return null;
    return selects
      .nth(field === 'category' ? 0 : 1)
      .evaluate((s) => [...s.options].map((o) => o.text.trim()).filter(Boolean));
  }

  async selectedValue(field) {
    const selects = this.modal.locator('select');
    if (field === 'issue' && (await selects.count()) < 2) return null;
    return selects.nth(field === 'category' ? 0 : 1).inputValue();
  }

  async hasIssueField() {
    return (await this.modal.locator('select').count()) > 1;
  }

  async isIssueEnabled() {
    if (!(await this.hasIssueField())) return false;
    return !(await this.modal.locator('select').nth(1).isDisabled());
  }

  // The label a trigger currently shows ("Select" when nothing is chosen).
  async triggerLabel(field) {
    if (field === 'issue' && !(await this.hasIssueField())) return null;
    return (await (await this.dropdownTrigger(field)).innerText()).replace(/\s+/g, ' ').trim();
  }

  async selectCategory(labelOrValue) {
    const value = ContactUsPage.categoryValue(labelOrValue);
    await (await this.dropdownTrigger('category')).click();
    // Keyed on the option id the app itself renders, so the thing read is the thing clicked.
    await this.page.locator(`[role="option"][id$="option-${value}"]`).first().click();
    // Wait on the mirror select committing, not on a timeout: the popover closes before React
    // has re-rendered the dependent field, and a read taken in between sees the PREVIOUS state.
    await this.page.waitForFunction(
      (v) => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
          /Need help\?/.test(x.innerText || '')
        );
        const s = d && d.querySelector('select');
        return !!s && s.value === v;
      },
      value,
      { timeout: 15000 }
    );
    await this.page.waitForTimeout(400);
    return value;
  }

  async selectIssue(label) {
    if (!(await this.hasIssueField())) {
      throw new Error(
        'ContactUsPage: there is no issue dropdown to select from. Category "Other" removes ' +
          'the field entirely - pick a different category, or do not select an issue.'
      );
    }
    await (await this.dropdownTrigger('issue')).click();
    // Exact accessible name, never filter({hasText}) - that is a SUBSTRING match, and these
    // lists hold near-misses of one another ("Unable to start" / "Unable to submit or upload").
    await this.page.getByRole('option', { name: label, exact: true }).first().click();
    await this.page.waitForTimeout(600);
    return this.selectedValue('issue');
  }

  // ---------------------------------------------------------------- description

  async fillDescription(text) {
    await this.descriptionInput.fill(text);
    await this.page.waitForTimeout(400);
  }

  async descriptionValue() {
    return this.descriptionInput.inputValue();
  }

  async counterText() {
    return (await this.characterCounter.count())
      ? (await this.characterCounter.innerText()).trim()
      : null;
  }

  // ---------------------------------------------------------------- screenshot

  // Resolves once the zone has stopped animating: either a settled card (name + size, no
  // percentage and no "remaining"), or a rejection message with the dropzone still in place.
  async waitForUploadSettled(ms = 20000) {
    const deadline = Date.now() + ms;
    let last = '';
    while (Date.now() < deadline) {
      last = (await this.modal.innerText()).replace(/\s+/g, ' ');
      const zone = last.split('Upload Screenshot')[1] || '';
      const animating = /\d+%|remaining/i.test(zone);
      const settledCard = (await this.uploadedFileCard.count()) > 0 && !animating;
      const rejected = /not allowed|too large/i.test(zone);
      if (settledCard || rejected) return { settledCard, rejected, zone: zone.trim() };
      await this.page.waitForTimeout(400);
    }
    return { settledCard: false, rejected: false, timedOut: true, zone: last };
  }

  async attachScreenshot(absolutePath) {
    await this.fileInput.setInputFiles(absolutePath);
    return this.waitForUploadSettled();
  }

  async hasAttachedFile() {
    return (await this.uploadedFileCard.count()) > 0;
  }

  // The name the card displays. Derived from the card's own subtree (the element holding the
  // Delete button), never from a bold-text class - the zone's "Upload Screenshot (optional)"
  // heading shares those classes, and a reader that can resolve to page furniture reports a
  // defect the app does not have. That exact bug cost the bulk-upload feature a whole run.
  async attachedFileName() {
    if (!(await this.hasAttachedFile())) return null;
    return this.uploadedFileCard
      .last()
      .evaluate((btn) => {
        let host = btn.parentElement;
        for (let i = 0; i < 5 && host; i += 1) {
          const text = (host.innerText || '').replace(/\s+/g, ' ').trim();
          const match = text.match(/([\w\- .()]+\.(?:png|jpe?g))/i);
          if (match) return match[1];
          host = host.parentElement;
        }
        return null;
      })
      .catch(() => null);
  }

  async removeScreenshot() {
    if (!(await this.hasAttachedFile())) return false;
    await this.uploadedFileCard.last().click();
    await this.page.waitForTimeout(1200);
    return !(await this.hasAttachedFile());
  }

  // Every error surface the modal can raise, collected rather than probed one at a time. A
  // locator built from the message we HOPE to find can only ever answer "absent", which says
  // nothing about what the app DID show.
  async errorSurfaces() {
    const inModal = await this.modal
      .locator('[role="alert"], p[class*="error" i], span[class*="error" i]')
      .allInnerTexts()
      .catch(() => []);
    const toasts = await this.page
      .locator('.Toastify__toast, [role="alert"]')
      .allInnerTexts()
      .catch(() => []);
    return [...new Set([...inModal, ...toasts].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  }

  // ---------------------------------------------------------------- submit

  async isSubmitEnabled() {
    return !(await this.submitButton.isDisabled());
  }

  // Submit settles asynchronously, so ONE read of it is not evidence. This watches the whole
  // window, so a late enable is caught rather than missed. It is NOT the negation of
  // waitForSubmitEnabled() - the two answer different questions and both are needed.
  async submitStaysDisabled(ms = 2500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.isSubmitEnabled()) return false;
      await this.page.waitForTimeout(200);
    }
    return true;
  }

  async waitForSubmitEnabled(ms = 10000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.isSubmitEnabled()) return true;
      await this.page.waitForTimeout(200);
    }
    return false;
  }

  // Submits and returns the server's own answer beside the rendered surface. The status and
  // body are what make a red row diagnosable: "no toast appeared" and "the API refused it" are
  // different findings, and the toast alone cannot tell them apart.
  async submit({ timeout = 45000 } = {}) {
    const sent = [];
    const recordRequest = (request) => {
      if (request.method() === 'POST' && /\/candidate\/feedback\/?$/.test(new URL(request.url()).pathname)) {
        sent.push({ url: request.url(), postData: (request.postData() || '').slice(0, 4000) });
      }
    };
    this.page.on('request', recordRequest);
    const waitForPost = this.page
      .waitForResponse(
        (r) =>
          /\/candidate\/feedback\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
        { timeout }
      )
      .catch(() => null);
    // >>> THE TOAST COLLECTOR STARTS BEFORE THE CLICK, NOT AFTER THE RESPONSE. <<<
    // The confirmation is raised the moment the response lands and auto-dismisses a few seconds
    // later, so a reader that only begins once `response.text()` has been awaited can miss it
    // entirely - and then reports "no toast appeared", which is a far more alarming finding than
    // the truth. Observed exactly that on 2026-09-14: two submissions of the same shape, one
    // captured the toast and the other recorded nothing. Collecting across the whole window from
    // before the click makes a toast that came and went evidence rather than a false negative.
    const toastsSeen = [];
    const collectUntil = Date.now() + 20000;
    const collector = (async () => {
      while (Date.now() < collectUntil) {
        const now = await this.page
          .locator('.Toastify__toast, [role="alert"]')
          .allInnerTexts()
          .catch(() => []);
        for (const t of now) {
          const clean = t.replace(/\s+/g, ' ').trim();
          if (clean && !toastsSeen.includes(clean)) toastsSeen.push(clean);
        }
        if (toastsSeen.length) return;
        await this.page.waitForTimeout(250);
      }
    })();

    await this.submitButton.click();
    const response = await waitForPost;
    const body = response ? await response.text().catch(() => '') : '';
    await collector;
    this.page.off('request', recordRequest);
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return {
      status: response ? response.status() : null,
      body,
      json,
      request: sent[0] || null,
      toasts: toastsSeen,
      modalStillOpen: await this.isOpen(),
    };
  }

  // Everything the modal currently holds, for attaching to the report. On a green run it
  // records what the app did that day; on a red one it makes the row reproducible without
  // re-driving the app.
  async snapshot() {
    if (!(await this.isOpen())) return { open: false };
    return {
      open: true,
      category: await this.selectedValue('category'),
      categoryLabel: await this.triggerLabel('category'),
      issue: await this.selectedValue('issue'),
      issueLabel: await this.triggerLabel('issue'),
      hasIssueField: await this.hasIssueField(),
      issueEnabled: await this.isIssueEnabled(),
      description: await this.descriptionValue().catch(() => null),
      counter: await this.counterText(),
      attachedFile: await this.attachedFileName(),
      submitEnabled: await this.isSubmitEnabled().catch(() => null),
      errors: await this.errorSurfaces(),
    };
  }
}

module.exports = ContactUsPage;
