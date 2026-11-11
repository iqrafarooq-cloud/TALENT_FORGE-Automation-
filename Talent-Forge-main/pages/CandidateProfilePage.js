// CandidateProfilePage - the candidate's own Profile > Candidate Details tab, which is
// where documents are actually uploaded.
//
// ============================================================================
// >>> THE ADD / EDIT CONTROLS ARE BARE <svg> ELEMENTS <<<
// ============================================================================
// Each of Education, Work Experience and Certifications carries `svg.add-icon` and
// `svg.edit-icon` in its section header. They are NOT <button>s. They have:
//
//     no <button> wrapper,  no role="button",  no aria-label,  no data-testid
//
// Consequences, and the second one is a product defect worth filing:
//
//   1. FOR TESTING: no role-based or accessible-name locator can find them. Every query
//      of the form getByRole('button', ...) or [aria-label*="add"] returns nothing, and
//      that is exactly how this upload path was first reported as "not existing at all".
//      The ONLY stable hooks are the class names, so this page object uses them and says
//      why.
//
//   2. FOR USERS: an <svg> with no role and no tabindex is not keyboard focusable and is
//      invisible to assistive technology. A keyboard-only or screen-reader candidate
//      cannot add a qualification or upload a document at all. That is an accessibility
//      defect, not merely an automation inconvenience.
//
// Because they are not buttons, Playwright's .click() hit-testing is unreliable on them,
// so `openAddModal` dispatches a bubbling MouseEvent - the same approach the live probe
// used successfully.
//
// ============================================================================
// THE PAGE SCROLLS INSIDE <main>, NOT THE DOCUMENT
// ============================================================================
// Measured 2026-08-24: document.body.scrollHeight === window.innerHeight, while
// <main class="flex-1 min-h-0 overflow-y-auto"> holds 6139px of content in an 836px box.
// So window.scrollTo does nothing and a section below the fold is simply absent from
// anything that reads the visible page. This is the other half of why the controls were
// missed. `scrollToSection` scrolls the container, not the window.
//
// ============================================================================
// THE THREE MODALS (captured live 2026-08-24)
// ============================================================================
//   Add Education    University/Institution Name* | Degree* | Field of Study*   (all three
//                    are type-to-search comboboxes, placeholder "Search")
//                    start month/year, end month/year, "Upload Transcript" + file input
//   Add Experience   an employment-type <select> (required) | Company Name* (search combo)
//                    | Role/Job Title* (plain text) | start month/year
//                    | "I currently work here" checkbox | end month/year
//                    | "Upload Experience Letter" + file input
//   Add Certification  Certificate Name* | Issuing Organization* (both plain text)
//                    | Issue month/year | checkbox | expiry month/year
//                    | "Click to upload" + file input
//
// Field NAMES are React-Hook-Form array paths (`certificationItems.3.title`) whose index
// depends on how many entries already exist, so nothing here locates by name - everything
// is by label or by position within the dialog.

const path = require('path');
const BasePage = require('./BasePage');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

// Section heading -> the modal it opens. The headings are the app's own wording.
const SECTION = {
  EDUCATION: 'Education',
  WORKEXPERIENCE: 'Work Experience',
  CERTIFICATION: 'Certifications',
};

const MODAL_TITLE = {
  EDUCATION: 'Add Education',
  WORKEXPERIENCE: 'Add Experience',
  CERTIFICATION: 'Add Certification',
};

class CandidateProfilePage extends BasePage {
  constructor(page) {
    super(page);
    this.url = `${APP}/profile?selectedTab=candidate-details`;
    this.documentsTabUrl = `${APP}/profile?selectedTab=documents`;
    this.dialog = page.locator('[role="dialog"]').last();
  }

  async open() {
    await this.navigate(this.url);
    await this.page.getByText('Candidate Details', { exact: false }).first().waitFor({ timeout: 60000 });
    // The sections render progressively down a 6000px container; waiting for the last of
    // the three means all of them exist before anything tries to click one.
    await this.page.getByText(SECTION.CERTIFICATION, { exact: true }).first().waitFor({ timeout: 60000 });
  }

  async openDocumentsTab() {
    await this.navigate(this.documentsTabUrl);
    await this.page.getByText('Documents', { exact: false }).first().waitFor({ timeout: 60000 });
  }

  // Scroll the <main> container, not the window. See the header note.
  async scrollToSection(category) {
    const heading = SECTION[category];
    if (!heading) throw new Error(`Unknown category "${category}". Known: ${Object.keys(SECTION).join(', ')}`);
    await this.page.evaluate((h) => {
      const el = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && (e.textContent || '').trim() === h
      );
      if (el) el.scrollIntoView({ block: 'center' });
    }, heading);
    await this.page.waitForTimeout(300);
  }

  // Open the "Add ..." modal for a section.
  //
  // The icon is located by geometry - the `svg.add-icon` on the same row as the heading
  // and to its right - rather than by DOM ancestry, because all three sections share a
  // wrapper and an ancestor walk resolves to the whole page (which is how an earlier
  // attempt reported every section as having no controls).
  async openAddModal(category) {
    const heading = SECTION[category];
    await this.scrollToSection(category);

    const opened = await this.page.evaluate((h) => {
      const label = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && (e.textContent || '').trim() === h
      );
      if (!label) return { ok: false, why: `no section heading "${h}"` };
      const hr = label.getBoundingClientRect();
      const icon = [...document.querySelectorAll('svg.add-icon')].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && Math.abs(r.top - hr.top) < 40 && r.left > hr.left;
      });
      if (!icon) return { ok: false, why: `no svg.add-icon on the "${h}" header row` };
      // Not a <button>: dispatch rather than click so hit-testing cannot refuse it.
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true };
    }, heading);

    if (!opened.ok) {
      throw new Error(
        `Could not open the Add modal for "${heading}": ${opened.why}.\n` +
          'These controls are bare <svg class="add-icon"> elements with no role, no aria-label and ' +
          'no data-testid, so if the class name changed there is no other hook to fall back on.'
      );
    }

    await this.dialog.waitFor({ state: 'visible', timeout: 30000 });
    const title = MODAL_TITLE[category];
    await this.dialog.getByText(title, { exact: false }).first().waitFor({ timeout: 30000 });
    return this.dialog;
  }

  // A type-to-search combobox: fill it, then pick the option. Every one of these has
  // placeholder "Search", so they are addressed by their LABEL and resolved to the input
  // that follows it.
  // Pick a value from one of the form's three type-to-search comboboxes (institution, degree,
  // field of study).
  //
  // >>> THREE THINGS HERE ARE LOAD-BEARING. All three were bugs, diagnosed 2026-08-25 by
  //     scripts/probe-education-institution-field.js after this method left the institution
  //     field EMPTY while reporting success - which gated Save and made a working form look
  //     broken. See scripts/probe-candidate-profile-education-form.js for the field-by-field dump.
  //
  // 1. THE OPTION IS MATCHED BY EXACT ACCESSIBLE NAME, never by `filter({ hasText })`.
  //    hasText is a SUBSTRING match: typing "King Saud University" renders THREE options -
  //    "King Saud University", "King Saud University (KSU)" and "King Saud bin Abdulaziz
  //    University for Health Sciences" - all of which contain the term, so `.first()` resolved
  //    in DOM order and could commit a different institution than the one asked for. The suite
  //    already learned this in AdminPromoToolsPage.disambiguate() and the community Majors
  //    filter; this is the same trap in a third place.
  //
  // 2. THE RESULT LIST LAGS THE TYPED TERM, so the wait is for an option matching THIS value,
  //    not for any option to appear. Measured: filling "King Saud" then reading 2.5s later
  //    returned 0 options, and the NEXT term's read returned the previous term's three. A wait
  //    for "an option is visible" is therefore satisfied by the previous query's results - the
  //    exact way a combobox silently selects the wrong row.
  //
  // 3. THERE IS NO SILENT FALLBACK. This used to swallow the wait with `.catch(() => {})` and
  //    press Enter, which does not commit on a react-aria combobox with several matches - so
  //    the field stayed empty and the step reported "ok". It now throws, naming the options it
  //    did see, and verifies the value actually committed. A form control that did not take the
  //    value must never look like one that did.
  async selectFromSearch(labelText, value) {
    const field = this.dialog
      .locator(`xpath=//label[contains(normalize-space(.), ${JSON.stringify(labelText)})]/following::input[@placeholder='Search'][1]`)
      .first();
    await field.waitFor({ state: 'visible', timeout: 15000 });

    // 4. THE POPOVER MUST BE OPENED, AND THE TERM TYPED AS REAL KEYSTROKES.
    //    `fill()` sets the value in a single input event, and this control then renders NO
    //    options at all - measured: 0 options after a 20s wait on a term that returns three
    //    when typed. It searches on keystrokes, so pressSequentially is not a slower `fill()`
    //    here, it is the only thing that triggers the query. Clicking first opens the popover;
    //    typing into a closed combobox leaves the list unmounted.
    await field.click();
    await field.fill('');
    await field.pressSequentially(value, { delay: 40 });

    const exact = this.page.getByRole('option', { name: value, exact: true }).first();
    try {
      await exact.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      const offered = await this.page
        .locator('[role="option"]')
        .evaluateAll((els) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
      throw new Error(
        `"${labelText}": no option exactly named "${value}" appeared after typing it.\n` +
          `  options offered: ${offered.length ? JSON.stringify(offered) : '(none)'}\n` +
          '  If the value is right, the list may still be showing the previous query - this ' +
          'control renders results one term behind. If it is wrong, the reference data does not ' +
          'hold that name verbatim (case-different and parenthesised duplicates both exist).'
      );
    }
    // >>> THE OPTION LIST RE-RENDERS WHILE THE CLICK IS BEING ATTEMPTED. <<<
    // Measured 2026-08-25 on a full run: the option resolved, then
    // "element is not stable" -> "element was detached from the DOM, retrying" -> 30s
    // timeout, on the SAME term and control that works in most scenarios. This control
    // queries per keystroke, so the last query's results can land after the exact option is
    // already visible and React replaces the list wholesale.
    //
    // Playwright's own auto-retry cannot win that race: it keeps retrying the ONE handle it
    // resolved, and that node is gone. Re-resolving the locator per attempt is what makes it
    // survive, so each attempt looks the option up again. Three attempts, and the commit is
    // verified below either way - so a click that lands on a dying node fails loudly rather
    // than leaving the field empty.
    let clicked = false;
    let lastClickError = null;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      try {
        await this.page.getByRole('option', { name: value, exact: true }).first().click({ timeout: 10000 });
        clicked = true;
      } catch (e) {
        lastClickError = e;
        // Let the pending query settle, then re-resolve and try the fresh node.
        await this.page.waitForTimeout(600);
        const stillThere = await this.page
          .getByRole('option', { name: value, exact: true })
          .first()
          .isVisible()
          .catch(() => false);
        if (!stillThere) {
          await this.page
            .getByRole('option', { name: value, exact: true })
            .first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {});
        }
      }
    }
    if (!clicked) {
      throw new Error(
        `"${labelText}": the option "${value}" was visible but could not be clicked in 3 attempts - ` +
          'the list kept re-rendering underneath it. Last error: ' +
          String((lastClickError && lastClickError.message) || '').split('\n')[0]
      );
    }

    // Confirm the combobox actually took it. Without this the next assertion is about a form
    // that silently discarded the selection.
    const committed = await field.inputValue().catch(() => '');
    if (committed.trim() !== value.trim()) {
      throw new Error(
        `"${labelText}": clicked the option "${value}" but the field holds ${JSON.stringify(committed)}. ` +
          'The selection did not commit.'
      );
    }
  }

  async fillText(labelText, value) {
    const field = this.dialog
      .locator(`xpath=//label[contains(normalize-space(.), ${JSON.stringify(labelText)})]/following::input[not(@type='file')][1]`)
      .first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(value);
  }

  // Month/year pairs are plain <select>s in document order. `which` is 0 for the first
  // pair (start / issue) and 1 for the second (end / expiry).
  //
  // >>> `offset` IS NOT OPTIONAL POLISH - THE EXPERIENCE MODAL NEEDS IT. <<<
  // Measured 2026-08-25: Add Experience opens with an EMPLOYMENT TYPE <select> ("Co-op",
  // "Tamheer", "Full-time Employment", ...), so its five selects are
  // [type, startMonth, startYear, endMonth, endYear] and index 0 is not the start month.
  // Add Education and Add Certification have four selects and no leading one. Without the
  // offset this method silently writes a month into the employment-type control - which
  // fails as "option not found" and points at the month list rather than at the layout.
  async selectMonthYear(which, month, year, { offset = 0 } = {}) {
    const selects = this.dialog.locator('select');
    const base = offset + which * 2;
    const count = await selects.count();
    if (count < base + 2) {
      throw new Error(
        `The modal has ${count} <select>s; a month/year pair at index ${base} (offset ${offset}, ` +
          `pair ${which}) does not exist.`
      );
    }
    await selects.nth(base).selectOption({ label: month });
    await selects.nth(base + 1).selectOption({ label: String(year) });
  }

  // The leading employment-type dropdown on Add Experience. Its own method rather than a
  // raw index at the call site, so the "index 0 is not a month" trap is stated in one place.
  async selectEmploymentType(label) {
    const select = this.dialog.locator('select').first();
    await select.waitFor({ state: 'visible', timeout: 15000 });
    const options = await select.locator('option').allTextContents();
    const match = options.map((o) => o.trim()).find((o) => o === label);
    if (!match) {
      throw new Error(
        `No employment type exactly named "${label}". The control offers: ` +
          `${options.map((o) => JSON.stringify(o.trim())).join(', ')}`
      );
    }
    await select.selectOption({ label });
  }

  // Tick a checkbox by the text beside it ("I currently work here", and the certification
  // modal's no-expiry box). Matched on the checkbox's own container text rather than a
  // <label for>, because neither box carries one - the certification checkbox has no name
  // attribute at all.
  async checkBoxNear(text) {
    const boxes = this.dialog.locator('input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      const near = await box.evaluate((el) => {
        let host = el;
        for (let d = 0; d < 4 && host; d++) {
          const t = (host.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return t;
          host = host.parentElement;
        }
        return '';
      });
      if (near.toLowerCase().includes(text.toLowerCase())) {
        // >>> .check() CANNOT CLICK THIS BOX. <<< The real <input type="checkbox"> is
        // visually replaced by a styled sibling <div class="... cursor-pointer ...">, which
        // sits on top of it - so Playwright's hit-target check fails, it retries for the
        // full timeout and reports "div ... intercepts pointer events". Same shape as the
        // community form's sr-only file input, and as the bare <svg> add icons above.
        //
        // A DOM click on the input itself toggles it and fires the input/change events
        // React is listening for, without any hit-testing. The state is then VERIFIED
        // rather than assumed: a click that silently failed to tick the box would leave
        // Save gated, and "Save is disabled" is a much harder failure to trace back here.
        if (!(await box.isChecked())) await box.evaluate((el) => el.click());
        if (!(await box.isChecked())) {
          throw new Error(
            `The checkbox beside "${near}" did not become checked. It is an <input> covered by a ` +
              'styled sibling, so it is toggled by a DOM click on the input rather than a real one.'
          );
        }
        return near;
      }
    }
    throw new Error(
      `No checkbox found next to text containing "${text}" among the ${n} checkbox(es) in this modal.`
    );
  }

  // Attach the document.
  //
  // setInputFiles on the hidden input rather than clicking "Click to upload": that button
  // opens the OS file chooser, and driving a native chooser is both slower and a different
  // code path from the one the form actually reads.
  // Attach the document and WAIT FOR THE FORM'S UPLOAD PROGRESS TO FINISH.
  //
  // >>> THIS USED TO WAIT 500ms AND RETURN path.basename(), WHICH IS NOT EVIDENCE OF ANYTHING.
  //     Measured 2026-08-25: the form animates a progress bar - "NAME-03....pdf 13% - 4 seconds
  //     remaining" - that runs 0% -> 89% over about FOUR SECONDS and fires NO request while it
  //     does (the file is held client-side and posted with Save). So the old 500ms wait returned
  //     at roughly 13%, the caller clicked Save immediately, and the entry was created with
  //     `document: null` - no document row, and therefore no AI verification ever. The walkthrough
  //     failed as an AI TIMEOUT (29 polls, ai_verification stayed null), which points at the model
  //     rather than at the upload that never happened.
  //
  //     Its return value made this invisible: it returned the file name it was HANDED, so the
  //     report read `attached NAME-03_....pdf` for a file the form was still ingesting. Same
  //     class as the community crop modal, where Save was clicked ~450ms before the cropper had
  //     decoded anything.
  //
  // The settled state is: the file name is shown, with a size, and no percentage and no
  // "remaining" anywhere in the dialog. That is a condition on real state, not a fixed pause -
  // a bigger fixture simply takes longer.
  async attachDocument(filePath) {
    const input = this.dialog.locator('input[type="file"]').first();
    if (!(await input.count())) {
      throw new Error('The Add modal exposes no file input, so no document can be attached.');
    }
    const resolved = path.resolve(filePath);
    const base = path.basename(resolved);
    await input.setInputFiles(resolved);

    // The form must acknowledge the file at all before there is any progress to wait on.
    await this.dialog
      .getByText(base, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {
        throw new Error(
          `The form never displayed "${base}" after it was set on the file input, so it did not ` +
            'register the attachment.'
        );
      });

    const deadline = Date.now() + 60000;
    let last = '';
    for (;;) {
      const seen = await this.dialog.evaluate((d) => {
        const txt = (d.textContent || '').replace(/\s+/g, ' ');
        return {
          percent: (/(\d+)%/.exec(txt) || [])[1] || null,
          remaining: /remaining/i.test(txt),
        };
      });
      if (!seen.percent && !seen.remaining) return base;
      last = `${seen.percent ?? '?'}%${seen.remaining ? ' (still estimating time remaining)' : ''}`;
      if (Date.now() > deadline) {
        throw new Error(
          `"${base}" was still uploading after 60s - the form reports ${last}. Saving now would ` +
            'create a profile entry with no document attached.'
        );
      }
      await this.page.waitForTimeout(250);
    }
  }

  saveButton() {
    return this.dialog.locator('button').filter({ hasText: /^save$/i }).first();
  }

  async saveIsEnabled() {
    const btn = this.saveButton();
    if (!(await btn.count())) return false;
    return !(await btn.isDisabled());
  }

  // Commits the entry. PERMANENT: it creates a profile entry AND a document row, and the
  // API exposes no DELETE for a document row, so nothing undoes this.
  async save() {
    const btn = this.saveButton();
    if (await btn.isDisabled()) {
      throw new Error('Save is disabled - the form considers the entry incomplete.');
    }
    const posted = this.page
      .waitForResponse(
        (r) => /\/candidate\/profile\/(educations|work-experiences|certifications)\//.test(r.url()) && r.request().method() === 'POST',
        { timeout: 60000 }
      )
      .catch(() => null);
    await btn.click();
    const res = await posted;
    await this.dialog.waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    return {
      httpStatus: res ? res.status() : null,
      url: res ? res.url() : null,
      body: res ? await res.json().catch(() => null) : null,
    };
  }

  async cancel() {
    const btn = this.dialog.locator('button').filter({ hasText: /^cancel$/i }).first();
    if (await btn.count()) await btn.click();
    else await this.page.keyboard.press('Escape');
    await this.dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // Everything the Documents tab lists, with the status wording IT uses.
  //
  // >>> DELEGATED, NOT REIMPLEMENTED (2026-09-01). <<<
  // This used to be its own DOM walk, deriving a row from any button whose text ended in
  // a document extension. That made TWO readers for one surface, and "a second reader
  // disagreeing with a first" is the single most expensive class of defect in this repo -
  // every one of the five community-module faults was an instance of it, and each was
  // reported as an application bug before it was found to be a reader.
  //
  // CandidateDocumentsPage.readDocumentsTabRows() is now the one implementation. It is
  // strictly better in three ways rather than merely different: it derives a row from its
  // STATUS BADGE, so a document whose name failed to render is reported as a row with a
  // null name instead of vanishing from the read entirely ("the document is not listed" is
  // the conclusion that must never be reached by accident); it attributes each row to its
  // Education / Work Experience / Certifications section; and it keeps its status wordings
  // in one named map instead of a regex literal that has to be edited in two files.
  //
  // Both classes take the same `page`, so this costs one object and no duplicated logic.
  async readDocumentsTab() {
    const CandidateDocumentsPage = require('./CandidateDocumentsPage');
    if (!this._documentsReader) this._documentsReader = new CandidateDocumentsPage(this.page);
    return this._documentsReader.readDocumentsTabRows();
  }
}

CandidateProfilePage.SECTION = SECTION;
CandidateProfilePage.MODAL_TITLE = MODAL_TITLE;

module.exports = CandidateProfilePage;
