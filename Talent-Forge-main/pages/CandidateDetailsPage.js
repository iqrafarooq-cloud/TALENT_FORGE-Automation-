const BasePage = require('./BasePage');

// CandidateDetailsPage - the Candidate Portal's own Profile > Candidate Details tab
// (/profile?selectedTab=candidate-details): the profile header, the four-tab strip, and the six
// sections a candidate edits about themselves.
//
// MEASURED LIVE 2026-09-14 by scripts/probe-candidate-details.js (read-only) and
// scripts/probe-candidate-details-mutations.js (which writes). Every string, class name, API
// field and endpoint below was read off the running app. RE-RUN THOSE PROBES rather than
// reasoning about the DOM - this page has already produced four separate wrong-element bugs.
//
// ============================================================================
// >>> IT IS NOT CandidateProfilePage, AND THE TWO ARE NOT INTERCHANGEABLE. <<<
// ============================================================================
// pages/CandidateProfilePage.js drives the SAME route, but only as a means to an end: the
// document-verification module uses it to get a file onto the account through the Add Education /
// Add Experience / Add Certification forms, and asserts the verdict over the API. It knows
// nothing about the page as a page - no sections, no Basic Information, no Work Preferences, no
// Desired Roles, no manage lists, no delete.
//
// This object owns the SCREEN. They are deliberately separate rather than merged: a document
// fixture helper and a profile page object have different reasons to change, and folding the
// verification machinery in here would drag DOC_UPLOAD_MODE, the AI poller and the fixture
// resolver into a feature that has nothing to do with any of them.
//
// ============================================================================
// THE SURFACE, MEASURED
// ============================================================================
//   route          /profile?selectedTab=candidate-details
//   tabs           Candidate Details | Documents | Subscription | Activity Log
//                  role="radio" in ONE radiogroup - NOT role="tab", so getByRole('tab') finds
//                  nothing. Each writes ?selectedTab=<slug> (candidate-details, documents,
//                  subscription, activity-log).
//   payload        GET /core/api/v1/candidate/profile/me/   <- the page's single source of truth
//   save           PATCH /core/api/v1/candidate/profile/basic-info      -> 200
//   add entry      POST  /core/api/v1/candidate/profile/<collection>/   -> 201
//   delete entry   DELETE /core/api/v1/candidate/profile/<collection>/<id>/ -> 204
//   toast          "Updated Successfully!" on every one of them
//   reference data /institutions/?page_size=200, /degree/, /field_of_study/?page_size=200,
//                  /companies/, /locations/?page_size=200, /roles/?page_size=200
//
//   section                          add  edit   renders
//   -------------------------------  ---  ----   ----------------------------------------------
//   Basic Information                 -    yes   Email, Phone Number, Current Status,
//                                                Nationality, About Me
//   Education                        yes   yes   institution / degree, field / dates / Attachment
//   Work Experience                  yes   yes   designation / type / company / dates
//   Certifications                   yes   yes   name / organisation / Issued .. - ..
//   Work Preferences & Availability   -    yes   Interested Programs, Current City,
//                                                Open to Relocation, Preferred Work Location(s)
//   Desired Roles                     -    yes   the role list
//
// ============================================================================
// >>> THE API FIELD NAMES ARE NOT THE UI LABELS, AND ONE PAIR IS ACTIVELY MISLEADING. <<<
// ============================================================================
// Asserting a rendered value against the wrong payload field is this repo's single most repeated
// mistake (is_verified vs is_email_verified on the SuperAdmin listing; account_status "Inactive"
// vs the grid's "Deactivated"). The mapping here, measured:
//
//   rendered                      payload
//   ---------------------------   ---------------------------------------------------------
//   the name in the header        user.firstname + " " + user.lastname
//   Email                         user.email
//   Phone Number                  user.phone_number          (null -> renders "-")
//   Nationality                   user.nationality           (null -> renders "-")
//   Current Status "Student"      qualification "STUDENT"    (uppercase enum -> Title Case)
//   About Me                      about_me
//   >>> the modal's "Bio*" field  headline  <<<  NOT `bio`, and there is no `bio` key at all
//   Verified / Unverified badge   is_verified
//   the four stat widgets         stats                      (null -> every one renders "—")
//   Education entry               educations[].institution_name / .degree_details.name /
//                                 .field_of_study.name / .start_date / .end_date / .document
//   Work Experience entry         work_experiences[].designation / .experience / .company_name /
//                                 .start_date / .end_date / .is_current
//   Certification entry           certifications[].certificate_name / .issuing_organization /
//                                 .issue_date / .expiry_date
//   Interested Programs           is_co_op_preferred, interested_in_tamheer
//   Current City                  current_location.location_name
//   Open to Relocation "No"       interested_in_relocation false
//   Preferred Work Location(s)    preferred_locations[]      (empty -> renders "-")
//   Desired Roles                 roles[].name               UPPERCASE in the API
//                                 ("CUSTOMER SERVICE REPRESENTATIVE"), Title Case on screen
//
// ============================================================================
// >>> EVERY CONTROL THAT OPENS A MODAL IS A BARE <svg>. <<<
// ============================================================================
// Measured: 9 section icons, of which 0 are wrapped in a <button>, 0 carry role, 0 carry
// aria-label, 0 carry tabindex and 0 carry data-testid. The per-entry pencil and trash inside
// every manage list are the same, and so is each modal's X.
//
//   1. FOR TESTING: no role-based or accessible-name locator can find them, which is why this
//      object uses the class names and says so. They also fail Playwright's hit-target check
//      often enough to matter, so every one is driven with dispatchEvent('click') - the same
//      call CandidateProfilePage already uses for the add icons.
//   2. FOR USERS: this is a real defect, asserted by its own scenario rather than worked around.
//      A keyboard-only or screen-reader candidate cannot edit any section of their own profile.
//
// ============================================================================
// >>> THE MANAGE-LIST ROW CLASS IS SINGULAR, AND THE PLURAL WRAPPER IS THE TRAP. <<<
// ============================================================================
// Each list modal holds `<div class="certification-list-items-container">` wrapping N
// `<div class="certification-list-item">` rows. `[class*="list-item"]` matches BOTH, so a row
// locator written that way resolves to 2 elements for a 1-row list.
//
// It is worse than a flaky locator. The first mutating probe read a row index off one collection
// and clicked a trash icon from a DIFFERENT one (every error-coloured svg in the dialog), both
// resolved index 0, and it DELETED THE PRE-EXISTING FIXTURE ENTRY instead of the row it had just
// created - then reported a conclusion about a document whose entry was never deleted. Same class
// as the community module's resolveFilterPopover() bug.
//
// So: rows are located by the EXACT singular class, and a row's pencil/trash is always located
// INSIDE that row. rowFor() additionally refuses to return anything unless exactly one row
// matches, because "delete the wrong row" is not a failure worth recovering from.
//
// ============================================================================
// DELETING AN ENTRY DELETES ITS DOCUMENT TOO (measured 2026-09-14, and this CORRECTS CLAUDE.md)
// ============================================================================
// The repo's long-standing note is that a profile entry's document is left ORPHANED on delete
// ("5 profile entries, 78 document rows, 73 orphaned"). Measured directly here - add a
// certification carrying document 26718, delete the certification, re-read
// /candidate/documents/ - the document is GONE and the account holds zero orphans.
//
// The orphans on the doc-verification account are almost certainly from DOC_UPLOAD_MODE=api,
// which posts straight to the upload endpoint and never creates a profile entry at all: those
// rows were orphaned from birth, not orphaned by a deletion. Do not carry the old note over to
// this feature.
class CandidateDetailsPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.apiOrigin = this.origin.replace('://dev.', '://dev-api.');
    this.url = `${this.origin}/profile?selectedTab=candidate-details`;

    // The app keeps its access token in memory under no guessable localStorage key - reading
    // localStorage returns null, the fetch then answers 401, and EVERY field read comes back
    // undefined, which prints as "the app lost the value" against a save that worked perfectly.
    // That mistake cost a live restore while this page object was being written. Capturing the
    // header off a real request is the only reliable source, so the listener goes on in the
    // constructor - before any step navigates.
    this._bearer = null;
    page.on('request', (r) => {
      const auth = r.headers().authorization;
      if (auth && auth.startsWith('Bearer ')) this._bearer = auth;
    });

    // A running log rather than a waitForRequest, for the reason require-attention.js documents:
    // several assertions here concern an action taken steps earlier, and one of them is about an
    // action that fires NO request at all - where a waitForRequest resolves to null and reads
    // identically to a timeout, a slow network or a broken listener.
    this.requests = [];
    page.on('request', (r) => {
      if (/\/api\/v1\//.test(r.url()) && r.method() !== 'GET') {
        this.requests.push({ method: r.method(), url: r.url(), at: Date.now() });
      }
    });
    page.on('response', (r) => {
      if (r.request().method() === 'GET') return;
      const hit = this.requests.find((c) => c.url === r.url() && c.status === undefined);
      if (hit) hit.status = r.status();
    });

    this.tabStrip = page.locator('[role="radiogroup"]').first();
    this.tabs = page.locator('[role="radio"]');
    this.viewAsButton = page.getByRole('button', { name: /^View As$/i });
    this.dialog = page.locator('[role="dialog"]').last();
  }

  // ---------------------------------------------------------------- names and constants

  // Section heading -> everything a step needs to reach it. `singular` is the manage-list row
  // class; `collection` is the API path segment the add/delete endpoints use.
  static get SECTIONS() {
    return {
      'Basic Information': { add: false, rowClass: null, collection: null },
      Education: { add: true, rowClass: 'education-list-item', collection: 'educations' },
      'Work Experience': { add: true, rowClass: 'work-experience-list-item', collection: 'work-experiences' },
      Certifications: { add: true, rowClass: 'certification-list-item', collection: 'certifications' },
      'Work Preferences & Availability': { add: false, rowClass: null, collection: null },
      'Desired Roles': { add: false, rowClass: null, collection: null },
    };
  }

  static get TABS() {
    return {
      'Candidate Details': 'candidate-details',
      Documents: 'documents',
      Subscription: 'subscription',
      'Activity Log': 'activity-log',
    };
  }

  // The app's own modal titles. The Add ones carry leading whitespace in the DOM, which is why
  // every comparison here trims rather than matching exactly on the raw string.
  static get MODAL_TITLES() {
    return {
      'Basic Information': 'Basic Information',
      Education: 'Education',
      'Work Experience': 'Work Experience',
      Certifications: 'Certifications',
      'Work Preferences & Availability': 'Work Preferences & Availability',
      'Desired Roles': 'Desired Roles',
      'Add Education': 'Add Education',
      'Add Experience': 'Add Experience',
      'Add Certification': 'Add Certification',
    };
  }

  // What an unset field renders. A literal hyphen, NOT an em dash and NOT an empty cell - the
  // stat widgets use an em dash and the two must not be conflated.
  static get EMPTY_VALUE() { return '-'; }
  static get EMPTY_STAT() { return '—'; }

  // ---------------------------------------------------------------- navigation

  async open() {
    await this.navigate(this.url);
    await this.settle();
  }

  async openTabByUrl(slug) {
    await this.navigate(`${this.origin}/profile?selectedTab=${slug}`);
    await this.page.waitForTimeout(2500);
  }

  // The sections render progressively down a tall container, so waiting for the first one is not
  // waiting for the page. Wait for the LAST section, which is what makes every later read safe.
  async settle() {
    await this.page.getByText('Basic Information', { exact: true }).first().waitFor({ timeout: 60000 });
    await this.page.getByText('Desired Roles', { exact: true }).first().waitFor({ timeout: 60000 });
    await this.page.waitForTimeout(1200);
  }

  async selectTab(name) {
    await this.tabs.filter({ hasText: name }).first().click();
    await this.page.waitForTimeout(1500);
  }

  async checkedTab() {
    const checked = this.page.locator('[role="radio"][aria-checked="true"]');
    if (!(await checked.count())) return null;
    return (await checked.first().innerText()).trim();
  }

  async readTabs() {
    return this.tabs.evaluateAll((rs) => rs.map((r) => ({
      name: r.textContent.trim(),
      checked: r.getAttribute('aria-checked') === 'true',
    })));
  }

  // ---------------------------------------------------------------- reading the page

  // Every section, derived structurally: the app renders each one as a header <div> holding the
  // title <p> and its icons, followed by a <main>. Reading the title off the header's first <p>
  // rather than walking up from an icon matters - an ancestor walk from the icon resolves to a
  // shared wrapper and reported the last two sections as "Basic Information" while this was
  // being measured.
  async readSections() {
    return this.page.evaluate(() => [...document.querySelectorAll('main')].map((m) => {
      const head = m.previousElementSibling;
      const titleEl = head && head.querySelector('p');
      if (!titleEl) return null;
      return {
        title: titleEl.textContent.trim(),
        icons: [...head.querySelectorAll('svg')].map((s) => s.getAttribute('class') || ''),
        entryCount: m.children[0] ? m.children[0].children.length : 0,
        lines: m.innerText.split('\n').map((l) => l.trim()).filter(Boolean),
      };
    }).filter(Boolean));
  }

  async readSection(title) {
    const all = await this.readSections();
    const found = all.find((s) => s.title === title);
    if (!found) {
      throw new Error(`No section titled "${title}". Sections on screen: ${all.map((s) => s.title).join(' | ') || '(none)'}`);
    }
    return found;
  }

  // Basic Information / Work Preferences render label/value PAIRS; the three list sections do
  // not. This returns the pairs for the two that have them.
  async readFieldPairs(title) {
    const section = await this.readSection(title);
    const pairs = {};
    const lines = section.lines;
    // Every known label, so a value that happens to look like a label cannot start a new pair.
    const LABELS = ['Email', 'Phone Number', 'Current Status', 'Nationality', 'About Me',
      'Interested Programs', 'Current City', 'Open to Relocation', 'Preferred Work Location(s)'];
    let current = null;
    for (const line of lines) {
      if (LABELS.includes(line)) { current = line; pairs[current] = []; continue; }
      if (current) pairs[current].push(line);
    }
    const flat = {};
    for (const [k, v] of Object.entries(pairs)) flat[k] = v.length === 1 ? v[0] : v;
    return flat;
  }

  async readHeader() {
    return this.page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main ? main.innerText : '';
      const badge = (text.match(/\b(Verified|Unverified)\b/) || [])[0] || null;
      const stats = [...document.querySelectorAll('p')]
        .filter((p) => ['Track Progress', 'Courses Completed', 'Hours Learned', 'Certificates Earned'].includes(p.textContent.trim()))
        .map((p) => ({ label: p.textContent.trim(), value: p.previousElementSibling ? p.previousElementSibling.textContent.trim() : null }));
      return { badge, stats, hasViewAs: /View As/.test(text) };
    });
  }

  // ---------------------------------------------------------------- the profile payload

  // The page's own source of truth, read with the token the app is actually using. Every
  // persistence assertion goes through this rather than through a re-read of the DOM: the
  // sections re-render from a fresh GET, so a DOM read cannot distinguish "the server stored it"
  // from "React still holds the value I typed".
  async profile() {
    if (!this._bearer) throw new Error('No bearer token captured yet - open the page before reading the profile.');
    const res = await this.page.evaluate(async ([url, token]) => {
      const r = await fetch(url, { headers: { authorization: token, 'x-active-role': 'CANDIDATE', accept: 'application/json' } });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [`${this.apiOrigin}/core/api/v1/candidate/profile/me/`, this._bearer]);
    // A 401 here turns every field read into `undefined`, which reads as "the app lost the
    // value". Fail loudly instead of quietly poisoning the assertion above.
    if (res.status !== 200) {
      throw new Error(`GET /candidate/profile/me/ answered ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async documents() {
    if (!this._bearer) throw new Error('No bearer token captured yet - open the page first.');
    const res = await this.page.evaluate(async ([url, token]) => {
      const r = await fetch(url, { headers: { authorization: token, 'x-active-role': 'CANDIDATE', accept: 'application/json' } });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [`${this.apiOrigin}/core/api/v1/candidate/documents/?page=1&page_size=200`, this._bearer]);
    if (res.status !== 200) throw new Error(`GET /candidate/documents/ answered ${res.status}`);
    return res.body;
  }

  // ---------------------------------------------------------------- the section icons

  // Index every add/edit icon with the section it belongs to, derived from the header the icon
  // sits in rather than from an ancestor walk.
  async iconIndex() {
    return this.page.evaluate(() => {
      const out = [];
      [...document.querySelectorAll('main')].forEach((m) => {
        const head = m.previousElementSibling;
        const titleEl = head && head.querySelector('p');
        if (!titleEl) return;
        [...head.querySelectorAll('svg.add-icon, svg.edit-icon')].forEach((svg) => {
          out.push({ section: titleEl.textContent.trim(), kind: svg.classList.contains('add-icon') ? 'add' : 'edit' });
        });
      });
      return out;
    });
  }

  async _clickSectionIcon(section, kind) {
    const index = await this.iconIndex();
    const position = index.findIndex((i) => i.section === section && i.kind === kind);
    if (position === -1) {
      throw new Error(
        `Section "${section}" offers no ${kind} icon. What is on screen: `
        + index.map((i) => `${i.section}:${i.kind}`).join(', ')
      );
    }
    // Global order matches iconIndex()'s order because both walk <main> elements in document
    // order and read the header that precedes each.
    await this.page.locator('svg.add-icon, svg.edit-icon').nth(position).dispatchEvent('click');
    await this.page.waitForTimeout(1600);
  }

  // The section's own modal: "Add ..." for the three list sections, the edit form for the rest.
  async openAddModal(section) {
    await this._clickSectionIcon(section, 'add');
    return this.waitForModal();
  }

  // For Education / Work Experience / Certifications this is the MANAGE LIST (every entry with
  // its own pencil and trash, plus an "Add other ..." button). For the other three it is the
  // edit form itself. Two different shapes behind one icon, so callers must know which they want.
  async openEditModal(section) {
    await this._clickSectionIcon(section, 'edit');
    return this.waitForModal();
  }

  // ---------------------------------------------------------------- modals

  // The topmost dialog, never .first(). While one modal replaces another both are attached and
  // visible for a beat, and .first() is the OUTGOING one - which holds none of the controls the
  // step is about. CandidateOnboardingPage records the same trap; this page has the manage-list
  // -> confirm-delete transition, where getting it wrong means clicking Delete on nothing.
  async waitForModal(timeout = 20000) {
    await this.page.locator('[role="dialog"]').last().waitFor({ state: 'visible', timeout });
    await this.page.waitForTimeout(400);
    return this.page.locator('[role="dialog"]').last();
  }

  modal() { return this.page.locator('[role="dialog"]').last(); }

  async modalTitle() {
    const d = this.modal();
    if (!(await d.count())) return null;
    const t = d.locator('.modal-title').first();
    if (await t.count()) return (await t.innerText()).trim();
    return (await d.innerText()).split('\n')[0].trim();
  }

  async modalIsOpen() {
    return (await this.page.locator('[role="dialog"]').count()) > 0;
  }

  // "Not visible" is also true of a modal the app has not rendered YET, so a single read on a
  // settling page reports "no modal" for one that appears a moment later. Watch a window.
  async modalStaysClosed(ms = 4000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.modalIsOpen()) return false;
      await this.page.waitForTimeout(250);
    }
    return true;
  }

  async closeModal({ via = 'cancel' } = {}) {
    const d = this.modal();
    if (!(await d.count())) return 'nothing open';
    if (via === 'escape') { await this.page.keyboard.press('Escape'); }
    else if (via === 'x') { await d.locator('header svg').first().dispatchEvent('click'); }
    else {
      const cancel = d.getByRole('button', { name: /^Cancel$/ });
      if (await cancel.count()) await cancel.click();
      else await d.locator('header svg').first().dispatchEvent('click');
    }
    await this.page.waitForTimeout(1200);
    return via;
  }

  saveButton() { return this.modal().getByRole('button', { name: /^Save$/, exact: false }).filter({ hasText: /^Save$/ }).first(); }
  cancelButton() { return this.modal().getByRole('button', { name: /^Cancel$/ }).first(); }

  // >>> waitForSaveEnabled() and saveStaysDisabled() ARE NOT EACH OTHER'S NEGATION. <<<
  // Save settles asynchronously, so ONE read cannot tell a gate that holds from one about to
  // open. The first tolerates a late enable; the second watches the whole window so a late
  // enable is caught rather than missed. Same pair the promo module needs on its own Save.
  async waitForSaveEnabled(ms = 8000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!(await this.saveButton().isDisabled())) return true;
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  async saveStaysDisabled(ms = 3000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!(await this.saveButton().isDisabled())) return false;
      await this.page.waitForTimeout(250);
    }
    return true;
  }

  // Every inline error currently rendered in the open modal, scoped to it. Unscoped, the page
  // behind can contribute its own role="alert" nodes.
  async inlineErrors() {
    const d = this.modal();
    if (!(await d.count())) return [];
    const raw = await d.locator('[role="alert"], .text-error-primary, p[class*="text-error"]').allInnerTexts();
    return [...new Set(raw.map((t) => t.trim()).filter(Boolean))];
  }

  // ---------------------------------------------------------------- toasts

  // >>> POLL A WINDOW, AND DEDUPE. <<<
  // The toast is raised when the response lands and auto-dismisses a few seconds later, so a
  // read at a fixed offset misses it in both directions - and "no confirmation appeared" is a
  // far more alarming thing to report than the truth. The dedupe is not cosmetic: the notistack
  // wrapper nests, so one toast reads as three identical strings and an assertion on "exactly
  // one confirmation" fails against a single correct toast.
  async waitForToast(ms = 15000) {
    const deadline = Date.now() + ms;
    let seen = [];
    while (Date.now() < deadline) {
      const raw = await this.page
        .locator('[role="status"], [role="alert"], .Toastify__toast, [class*="toast" i]')
        .allInnerTexts()
        .catch(() => []);
      const texts = [...new Set(raw.map((t) => t.trim()).filter(Boolean))];
      if (texts.length) { seen = texts; break; }
      await this.page.waitForTimeout(300);
    }
    return seen;
  }

  // ---------------------------------------------------------------- Basic Information modal

  basicField(name) {
    return this.modal().locator(`input[name="basicInformation.${name}"], textarea[name="basicInformation.${name}"]`).first();
  }

  phoneField() { return this.modal().locator('input[type="tel"]').first(); }
  nationalityField() { return this.modal().locator('input[role="combobox"]').first(); }
  photoInput() { return this.modal().locator('input[type="file"]').first(); }

  async readBasicInformationForm() {
    const d = this.modal();
    return d.locator('input,textarea,select').evaluateAll((els) => els.map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute('type'),
      role: e.getAttribute('role'),
      name: e.getAttribute('name'),
      label: e.labels && e.labels[0] ? e.labels[0].textContent.trim() : null,
      placeholder: e.placeholder || null,
      accept: e.getAttribute('accept'),
      maxlength: e.getAttribute('maxlength'),
      disabled: e.disabled,
      value: e.type === 'file' ? null : String(e.value ?? '').slice(0, 80),
    })));
  }

  // >>> TYPE, DO NOT fill(), WHEN THE ASSERTION IS ABOUT VALIDATION. <<<
  // React-Hook-Form validates on BLUR. A programmatic value set plus a dispatched blur does move
  // the gate but does NOT run the validator, and a probe written that way reported First Name as
  // having no required message at all - the exact opposite of the truth. Real keystrokes and a
  // real Tab are the only honest way to measure this form.
  async typeInto(locator, value) {
    await locator.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    if (value === '') await this.page.keyboard.press('Delete');
    else await this.page.keyboard.type(value);
    await this.page.waitForTimeout(250);
  }

  async blur() {
    await this.page.keyboard.press('Tab');
    await this.page.waitForTimeout(900);
  }

  async save() {
    const before = this.requests.length;
    await this.saveButton().click();
    await this.page.waitForTimeout(3500);
    return this.requests.slice(before);
  }

  // ---------------------------------------------------------------- manage lists

  // Rows by the EXACT singular class - see the header note. [class*="list-item"] also matches
  // the "-list-items-container" wrapper, which is how a 1-row list resolved to 2 elements.
  rows(section) {
    const cls = CandidateDetailsPage.SECTIONS[section] && CandidateDetailsPage.SECTIONS[section].rowClass;
    if (!cls) throw new Error(`Section "${section}" has no manage list.`);
    return this.modal().locator(`.${cls}`);
  }

  async readRows(section) {
    return this.rows(section).evaluateAll((els) => els.map((e) => ({
      text: e.innerText.replace(/\s+/g, ' ').trim(),
      hasPencil: !!e.querySelector('svg.cursor-pointer:not([class*="error"])'),
      hasTrash: !!e.querySelector('svg[class*="error-600"]'),
    })));
  }

  // Exactly one row, or an explicit refusal. Never .first() on an ambiguous match: the one
  // irreversible action on this page is delete, and "it took the first one" is how a fixture
  // entry was destroyed while this was being written.
  async rowFor(section, text) {
    const matches = this.rows(section).filter({ hasText: text });
    const count = await matches.count();
    if (count !== 1) {
      const all = await this.readRows(section);
      throw new Error(
        `Expected exactly one "${section}" row containing "${text}", found ${count}.\n`
        + `Rows in the list: ${all.map((r) => `"${r.text.slice(0, 60)}"`).join(' | ') || '(none)'}`
      );
    }
    return matches.first();
  }

  // The pencil and trash are located INSIDE the row, so the index a reader produces and the
  // element a click acts on cannot disagree.
  async editRow(section, text) {
    const row = await this.rowFor(section, text);
    await row.locator('svg:not([class*="error"])').first().dispatchEvent('click');
    await this.page.waitForTimeout(1600);
    return this.waitForModal();
  }

  async clickDeleteOnRow(section, text) {
    const row = await this.rowFor(section, text);
    await row.locator('svg[class*="error-600"]').first().dispatchEvent('click');
    await this.page.waitForTimeout(1500);
    return this.waitForModal();
  }

  addOtherButton() {
    return this.modal().getByRole('button', { name: /^Add (other|another) /i }).first();
  }

  // ---------------------------------------------------------------- delete confirmation

  async readDeleteConfirmation() {
    const d = this.modal();
    return {
      text: (await d.innerText()).replace(/\n{2,}/g, '\n').trim(),
      buttons: await d.locator('button').evaluateAll((bs) => bs.map((b) => (b.innerText || '').trim()).filter(Boolean)),
    };
  }

  async confirmDelete() {
    const before = this.requests.length;
    await this.modal().getByRole('button', { name: /^Delete$/i }).first().click();
    await this.page.waitForTimeout(3500);
    return this.requests.slice(before);
  }

  async cancelDelete() {
    const before = this.requests.length;
    await this.modal().getByRole('button', { name: /^Cancel$/i }).first().click();
    await this.page.waitForTimeout(2000);
    return this.requests.slice(before);
  }

  // ---------------------------------------------------------------- entry forms

  // A react-aria combobox: it queries on KEYSTROKES, so fill() sets the value in one input event
  // and the control then renders no options at all. pressSequentially is not a slower fill()
  // here - it is the only thing that triggers the query. The option is matched on its EXACT
  // accessible name, never a hasText substring: typing "King Saud University" renders three
  // options and a substring match commits whichever is first in the DOM.
  async selectFromCombobox(label, value) {
    const d = this.modal();
    // >>> SCOPE TO THE COMBOBOX INPUT. <<< getByLabel() alone resolves to TWO elements: the input
    // and the "Show suggestions" button beside it, which react-aria points at the same
    // aria-labelledby. Strict mode then throws a locator error that reads like a missing field -
    // "resolved to 2 elements" on a form that is rendering perfectly. Intersecting the label with
    // the role narrows it to the one control without any regex escaping of the label text.
    const input = d.getByLabel(label).and(this.page.locator('input[role="combobox"]')).first();
    await input.click();
    await input.fill('');
    await input.pressSequentially(value, { delay: 40 });
    await this.page.waitForTimeout(1200);

    let lastSeen = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const options = this.page.locator('[role="option"]');
      await options.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      lastSeen = (await options.allInnerTexts()).map((t) => t.trim());
      const exact = options.filter({ hasText: new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
      if (await exact.count()) {
        // RE-RESOLVE on every attempt: the control re-queries per keystroke and replaces the
        // list wholesale, so a handle resolved a moment ago can detach mid-click. Playwright's
        // own retry cannot win that - it retries the ONE handle it already resolved.
        await exact.first().click().catch(() => {});
        await this.page.waitForTimeout(700);
        if ((await input.inputValue()).trim() === value) return true;
      }
      await this.page.waitForTimeout(600);
    }
    throw new Error(
      `Could not select "${value}" in "${label}". Options offered: ${lastSeen.join(' | ') || '(none)'}`
    );
  }

  // Plain text, despite a "Search" placeholder on some of them. Company Name in particular LOOKS
  // like a combobox and is not - it carries no role, no aria-autocomplete and no suggestions
  // button, so selectFromCombobox() on it times out reporting "(none) offered", which reads as
  // missing reference data rather than as the wrong primitive.
  async fillText(label, value) {
    await this.modal().getByLabel(label).fill(value);
    await this.page.waitForTimeout(250);
  }

  // The month/year pairs are real <select>s. On Add Experience the FIRST select is the
  // employment type, not a month - hence the explicit index rather than "the first two selects".
  async selectMonthYear({ monthIndex, yearIndex, month, year }) {
    const selects = this.modal().locator('select');
    if (month) await selects.nth(monthIndex).selectOption({ label: month });
    if (year) await selects.nth(yearIndex).selectOption({ label: String(year) });
    await this.page.waitForTimeout(400);
  }

  // The "currently here" / "no expiry" control is an <input> behind a styled <div> that
  // intercepts pointer events, so .check() retries for its full timeout and reports
  // "div ... intercepts pointer events". Toggle the input directly and VERIFY - a click that
  // silently failed leaves Save gated, and "Save is disabled" is a much harder failure to trace.
  async toggleOngoing() {
    const box = this.modal().locator('input[type="checkbox"]').first();
    const before = await box.isChecked();
    await box.dispatchEvent('click');
    await this.page.waitForTimeout(600);
    const after = await box.isChecked();
    if (after === before) throw new Error(`The ongoing/no-expiry toggle did not change state (still ${before}).`);
    return after;
  }

  // >>> WAIT FOR THE UPLOAD TO SETTLE. <<<
  // The zone animates a progress bar and fires NO request while it runs - the file is held
  // client-side and posted with Save. A read taken straight after setInputFiles() catches it
  // mid-animation, and a Save clicked then creates the entry with `document: null` - no document
  // row, and therefore no verification, on an entry that looks fine. Same failure as the bulk
  // CSV zone and the community crop modal.
  async attachDocument(filePath) {
    await this.modal().locator('input[type="file"]').last().setInputFiles(filePath);
    const deadline = Date.now() + 30000;
    let text = '';
    while (Date.now() < deadline) {
      text = (await this.modal().innerText()).replace(/\s+/g, ' ');
      const settled = !/%/.test(text) && !/remaining/i.test(text);
      if (settled) return text;
      await this.page.waitForTimeout(400);
    }
    throw new Error(`The upload never settled within 30s. Modal text: ${text.slice(0, 200)}`);
  }

  async uploadRejection() {
    const d = this.modal();
    const raw = await d.locator('[role="alert"], .text-error-primary, p[class*="text-error"]').allInnerTexts().catch(() => []);
    return [...new Set(raw.map((t) => t.trim()).filter(Boolean))];
  }

  // ---------------------------------------------------------------- accessibility

  // Reported as DATA, so the scenario can state the rule and the failure can name what it found.
  // This is the measurement behind the one scenario on this page that asserts a real defect.
  async controlAccessibility() {
    return this.page.evaluate(() => {
      const icons = [...document.querySelectorAll('svg.add-icon, svg.edit-icon')];
      const audit = (list) => ({
        total: list.length,
        inButton: list.filter((s) => s.closest('button')).length,
        withRole: list.filter((s) => s.getAttribute('role')).length,
        withAriaLabel: list.filter((s) => s.getAttribute('aria-label')).length,
        focusable: list.filter((s) => s.hasAttribute('tabindex')).length,
        withTestid: list.filter((s) => s.getAttribute('data-testid')).length,
      });
      return { sectionIcons: audit(icons) };
    });
  }

  async modalControlAccessibility() {
    return this.modal().evaluate((d) => {
      const rowIcons = [...d.querySelectorAll('[class*="-list-item"] svg')];
      return {
        total: rowIcons.length,
        inButton: rowIcons.filter((s) => s.closest('button')).length,
        withRole: rowIcons.filter((s) => s.getAttribute('role')).length,
        withAriaLabel: rowIcons.filter((s) => s.getAttribute('aria-label')).length,
        focusable: rowIcons.filter((s) => s.hasAttribute('tabindex')).length,
      };
    });
  }

  // A REAL Tab walk. "The markup has no tabindex" is an inference; an accessibility finding
  // handed to dev needs a measurement, and the control below proves the walk itself works.
  async tabWalk(presses = 60) {
    await this.page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    const stops = [];
    for (let i = 0; i < presses; i += 1) {
      await this.page.keyboard.press('Tab');
      stops.push(await this.page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        return {
          tag: a.tagName.toLowerCase(),
          cls: (a.getAttribute('class') || '').slice(0, 40),
          text: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        };
      }));
    }
    return stops;
  }
}

module.exports = CandidateDetailsPage;
