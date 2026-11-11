const BasePage = require('./BasePage');

// InProgressCandidatePage - Page Object for Agent Portal > Candidates > In Progress.
//
// Selectors follow the project convention: layered from most-stable (data-testid) -> ARIA
// role/name -> semantic HTML -> structural class -> text fallback.
//
// ===========================================================================================
// MEASURED LIVE against dev.talentforge.com.sa on 2026-08-27. Everything below was read off
// the running app, not inferred from the feature file - and the feature file was wrong about
// five things, all recorded in AGENT_PORTAL_JIRA_VS_APP.md. Re-measure with
// `node scripts/probe-inprogress-filters.js` rather than editing these notes by reasoning.
// ===========================================================================================
//
//   URL:        /candidates/in-progress   (bare; the All tab adds NO param)
//   API:        GET /core/api/v1/candidate/in-progress/?page=&page_size=&search=&...
//   quick tabs: activeFilter = (absent) | invite_sent | onboarding_incomplete
//   search:     ?search=<term>  - debounced ~1s, SERVER-side, case-insensitive, substring,
//               and it matches EMAIL as well as name (see SEARCH note below)
//   columns:    Candidate | Status | Status Detail | Actions   (FOUR, not three)
//   row acts:   Resend (agent-candidates-resend-invite-button),
//               Reminder History (agent-candidates-reminder-history-button)
//
// >>> THE RESEND ICON HAS NO COOLDOWN, AND IT OPENS A CONFIRMATION DIALOG FIRST.
//     Measured 2026-09-03 (scripts/probe-resend-cooldown.js), the first time anything in this
//     repo clicked it - the note further down still says "Resend is deliberately never clicked",
//     which was true until then.
//
//       * the icon opens [role=dialog] "Resend Invitation" - "You're about to resend the
//         invitation to: <email> ... Any previous invite links will no longer work"
//         (Cancel / Resend Invite). So the ICON click sends nothing; the dialog's button does.
//       * confirming posts POST /core/api/v1/agent/invite/candidate/ -> 200
//         {"detail":"Invitation resent."} and toasts "Invite re-sent successfully"
//       * >>> the icon is then sampled at 100ms for 15s (132 samples) and is NEVER disabled.
//         No countdown text, no tooltip, no 429, no Retry-After. A second resend to the same
//         candidate minutes later also answered 200, so there is no server-side throttle.
//
//     Note this is a DIFFERENT endpoint from the bulk invite path
//     (.../agent/invite/candidate/bulk/) and from the superadmin agent resend
//     (.../admin/invite/resend/agent/). All three were measured; none has a cooldown.
//     The only resend cooldown in the product is the candidate's own "Resend Email" button on
//     /email-verification and forgot-password, which counts down in its own label - SignupPage.js.
//
// >>> THE PER-ROW RESULT OF A FILTER IS ONLY IN THE API PAYLOAD. <<<
// The table renders nothing about reminders and nothing about how old an invitation is, so
// `reminder_status` and the two duration bands CANNOT be asserted from the DOM. Every row in
// the response carries them, which is why this page object records the last in-progress
// response (see `install()` / `lastPayload()`). Row shape, measured:
//
//   invite_sent row:            { id: null, name: "", email, status: "invite_sent",
//                                 status_detail: "Awaiting Signup", invite_days: "7+" }
//   onboarding_incomplete row:  { id, name, email, status: "onboarding_incomplete",
//                                 status_detail: "Profile Incomplete, Test Pending",
//                                 onboarding_days: "1-3", reminder_status: "none",
//                                 has_reminders: true }
//
// Note `id: null` and `name: ""` on an invite_sent row - the candidate has not signed up yet,
// so the Candidate cell shows the email alone. Anything keying a row on its NAME must tolerate
// that; `rowByEmail()` is the safe opener.
//
// >>> THE FILTER MODAL'S FIVE GROUPS DO NOT USE ONE CONTROL TYPE, AND TWO GROUP HEADINGS
//     COLLIDE WITH THE STATUS GROUP'S OWN OPTION LABELS. <<<
//
//   | heading (as rendered)   | control            | options -> value        | URL param        |
//   | Status                  | checkbox (multi)   | Invite Sent / Onboarding Incomplete | status=          |
//   | Onboarding Step         | checkbox (multi)   | Awaiting Sign-up / Profile Incomplete / Test Pending | onboarding_step= |
//   | Invite Sent             | radio (single)     | > 24 hours=<1, 1-3 days, 4-7 days, 7+ days | invite_sent=     |
//   | Onboarding Incomplete   | radio (single)     | 1-3 days, 4-7 days, 7+ days | onboarding_days= |
//   | Reminder Status         | radio (single)     | No Reminder Sent=none, Recently Reminded (Last 48 hours)=recent, Multiple Reminders=multiple | reminder_status= |
//
// The two DURATION groups are headed exactly "Invite Sent" and "Onboarding Incomplete" - the
// same strings as the Status group's two checkbox labels. So a modal-scoped
// `getByText('Invite Sent', { exact: true })` resolves to FOUR elements (two headings, two
// labels) and `.first()` picks whichever comes first in DOM order, which is the Status
// checkbox. Every read and every click here therefore goes through `groupSection()` first -
// the group is the boundary, never the text. Same class of trap as the community module's
// comma-separated union resolving in DOM order.
//
// The feature file addresses those two groups as "Invite Sent Duration" / "Onboarding
// Incomplete Duration" because "select Invite Sent under the Invite Sent group" is unreadable.
// GROUP_ALIASES maps the readable name onto the rendered heading; the one scenario that
// asserts the modal's own contents uses the rendered headings, because that is what the app
// shows.
//
// >>> ONLY THE CHECKBOX GROUPS CARRY TEST IDS. <<<
// `filters-status-invite_sent-checkbox`, `filters-onboarding_step-test_pending-checkbox`, ...
// The three radio groups have none at all, so they can only be reached structurally. A
// data-testid candidate is still prepended everywhere so the suite auto-upgrades if the app
// team adds them.
//
// SEARCH: the placeholder reads "Search by candidate name..." but the search also matches the
// EMAIL - measured, `bytecorp.io` returns 174 rows and matches no candidate's name at all,
// and searching "Abdul" returns rows displayed as "Musawwir Musawwir" (matched on
// abdul.musawwir+110@...). The control does MORE than it advertises. Recorded as a finding;
// `searchMatches()` therefore tests name OR email, because testing the name alone would
// report a working search as broken.
class InProgressCandidatePage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/candidates/in-progress`;
    // Every in-progress response is recorded here by install(); see lastPayload().
    this._payloads = [];
    this._installed = false;

    // ---- Header / page identity ----
    this.pageHeading = page.getByRole('heading', { name: /Candidates\s*-\s*In\s*Progress/i });

    // ---- Search ----
    this.searchInput = page
      .locator(
        '[data-testid="agent-candidates-search-input"], input[placeholder="Search by candidate name..."], [role="searchbox"]'
      )
      .first();

    // ---- Quick filter tabs (a radiogroup of buttons) ----
    this.quickFilters = page.locator('[role="radiogroup"]').first();

    // ---- Invite CTA. Renders "Invite Candidate" here (capital C) - see the JIRA_VS_APP note. ----
    this.inviteButton = page
      .locator('[data-testid="agent-candidates-invite-button"]')
      .or(page.getByRole('button', { name: /^Invite Candidates?$/i }))
      .first();

    // ---- Filters button + modal ----
    this.filtersButton = page
      .locator('[data-testid="agent-candidates-filters-button"], button:has-text("Filters")')
      .first();
    this.filterModal = page.getByRole('dialog').filter({ hasText: /Apply Filters/i }).first();
    this.applyFiltersButton = page
      .locator('[data-testid="filters-apply-button"], [role="dialog"] button:has-text("Apply Filters")')
      .first();
    this.clearAllButton = this.filterModal
      .locator('[data-testid="filters-clear-all-button"]')
      .or(this.filterModal.getByRole('button', { name: /^Clear All$/i }))
      .first();
    this.cancelFiltersButton = this.filterModal.getByRole('button', { name: /^Cancel$/i }).first();
    this.closeFilterButton = this.filterModal.getByRole('button', { name: /^Close$/i }).first();

    // ---- Table ----
    // The grid is REMOVED ENTIRELY in every empty state (measured: role="grid" absent on a
    // zero-candidate account), so nothing may assume it exists just because the page loaded.
    this.table = page.getByRole('grid', { name: /Candidates/i }).first();
    this.dataRows = page.locator('[role="row"]:has([role="rowheader"])');

    // ---- Pagination ----
    this.pagination = page.getByRole('navigation', { name: /Pagination/i }).first();
    this.previousPageButton = this.pagination.getByRole('button', { name: /Previous/i }).first();
    this.nextPageButton = this.pagination.getByRole('button', { name: /Next/i }).first();

    // ---- Row actions ----
    this.resendButtons = page.locator(
      '[data-testid="agent-candidates-resend-invite-button"], button[aria-label="Resend"]'
    );
    this.reminderHistoryButtons = page.locator(
      '[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]'
    );
    this.reminderHistoryPanel = page
      .getByRole('dialog')
      .filter({ hasText: /Reminder History/i })
      .first();
    this.resendInviteButtons = page.locator(
      '[data-testid="agent-candidates-resend-invite-button"], button[aria-label="Resend"]'
    );
    // Filtered on the HEADING, not on /resend/i: the row's own icon carries aria-label "Resend"
    // and the confirm button reads "Resend Invite", so a loose filter would match the page behind
    // the dialog as well.
    this.resendModal = page
      .getByRole('dialog')
      .filter({ hasText: /Resend Invitation/i })
      .first();

    // Quick-filter label -> data-testid slug and URL value. The All tab adds NO param.
    this.quickFilterTestIds = {
      all: 'agent-candidates-in-progress-filter-all',
      'invite sent': 'agent-candidates-in-progress-filter-invite-sent',
      'onboarding incomplete': 'agent-candidates-in-progress-filter-onboarding-incomplete',
    };
    this.quickFilterUrlValues = {
      all: null,
      'invite sent': 'invite_sent',
      'onboarding incomplete': 'onboarding_incomplete',
    };
  }

  // ---- Group naming -------------------------------------------------------------------
  // Readable feature-file name -> the heading the app really renders.
  static get GROUP_ALIASES() {
    return {
      'invite sent duration': 'Invite Sent',
      'onboarding incomplete duration': 'Onboarding Incomplete',
    };
  }

  // The four headings, in render order, exactly as the app writes them. The Status group was
  // removed from the modal on 2026-10-05 - status is chosen by the quick filter tabs only.
  static get GROUP_HEADINGS() {
    return ['Onboarding Step', 'Invite Sent', 'Onboarding Incomplete', 'Reminder Status'];
  }

  // Option label -> the value the app puts on the wire. Asserting the request as well as the
  // rendered list is what distinguishes "the filter was submitted and ignored" from "the
  // filter was never submitted" - and on this page one of the five really is ignored.
  static get FILTER_PARAMS() {
    return {
      'Onboarding Step': {
        param: 'onboarding_step',
        values: { 'Awaiting Sign-up': 'awaiting_signup', 'Profile Incomplete': 'profile_incomplete', 'Test Pending': 'test_pending' },
      },
      'Invite Sent': { param: 'invite_sent', values: { '> 24 hours': '<1', '1-3 days': '1-3', '4-7 days': '4-7', '7+ days': '7+' } },
      'Onboarding Incomplete': { param: 'onboarding_days', values: { '1-3 days': '1-3', '4-7 days': '4-7', '7+ days': '7+' } },
      'Reminder Status': {
        param: 'reminder_status',
        values: { 'No Reminder Sent': 'none', 'Recently Reminded (Last 48 hours)': 'recent', 'Multiple Reminders': 'multiple' },
      },
    };
  }

  // Reminder Status option label -> the per-row `reminder_status` the API reports.
  static get REMINDER_STATUS_VALUES() {
    return InProgressCandidatePage.FILTER_PARAMS['Reminder Status'].values;
  }

  groupHeading(name) {
    const key = String(name).trim().toLowerCase();
    return InProgressCandidatePage.GROUP_ALIASES[key] || String(name).trim();
  }

  // ---- Response capture ---------------------------------------------------------------
  // Installed on the PAGE, once, before the first navigation. `page.on('response')` rather
  // than a route handler on purpose: nothing here stubs or delays the app, it only observes.
  // A response body can already be gone by the time the handler runs (navigation, redirect),
  // hence the catch - a missed payload must never fail the scenario that merely reads rows.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.page.on('response', async (response) => {
      const url = response.url();
      if (!/\/candidate\/in-progress\//.test(url)) return;
      try {
        const body = await response.json();
        this._payloads.push({ url, status: response.status(), body, at: Date.now() });
        if (this._payloads.length > 40) this._payloads.shift();
      } catch (err) {
        /* body unavailable - see comment above */
      }
    });
  }

  // The most recent in-progress response, or null. Throws nothing: the caller decides whether
  // an absent payload is a problem, because for some steps it is and for others it is not.
  lastPayload() {
    return this._payloads.length ? this._payloads[this._payloads.length - 1] : null;
  }

  // The rows of the last response. Distinct from what the DOM shows: the response holds ten
  // rows AND a total `count`, and several assertions need the count rather than the page.
  lastRows() {
    const p = this.lastPayload();
    return p && p.body && Array.isArray(p.body.results) ? p.body.results : [];
  }

  lastCount() {
    const p = this.lastPayload();
    return p && p.body && typeof p.body.count === 'number' ? p.body.count : null;
  }

  // The filter parameters this page puts on the wire. Note the URL carries NONE of them any more
  // (measured 2026-08-27: the address bar stays a bare /candidates/in-progress under every
  // filter), so the request is the only place an applied filter can be read.
  static get FILTER_QUERY_KEYS() {
    return ['status', 'onboarding_step', 'invite_sent', 'invite_days', 'onboarding_days', 'reminder_status'];
  }

  // >>> WHAT "THE FULL LIST" IS, ON A PAGE THAT RE-RENDERS FROM CACHE. <<<
  //
  // Clearing every filter restores the unfiltered list WITHOUT a request, so `lastCount()` still
  // names the filtered one and cannot answer "was it restored?". The first captured response
  // whose request carried no filter and no search IS the unfiltered list, recorded on page load,
  // and the restored DOM can be compared against it exactly - no fresh request, no remembered
  // number to go stale, and no reload (which would restore the list by itself and prove nothing).
  unfilteredPayload() {
    return (
      this._payloads.find((p) => {
        try {
          const q = new URL(p.url).searchParams;
          return !InProgressCandidatePage.FILTER_QUERY_KEYS.some((k) => q.get(k)) && !(q.get('search') || '') && (q.get('page') || '1') === '1';
        } catch (err) {
          return false;
        }
      }) || null
    );
  }

  // Query params of the last request, so a step can assert what was SUBMITTED.
  lastRequestParams() {
    const p = this.lastPayload();
    if (!p) return {};
    const out = {};
    try {
      new URL(p.url).searchParams.forEach((v, k) => {
        out[k] = v;
      });
    } catch (err) {
      /* malformed url - return what we have */
    }
    return out;
  }

  // >>> READING THE DOM AFTER A RESPONSE LANDS IS NOT ENOUGH - IT MUST BE READ AFTER THE DOM
  //     AGREES WITH THAT RESPONSE. <<<
  //
  // This cost 13 of 18 failures on the first live run, in two disguises, and both read as app
  // defects:
  //
  //   * `waitForResults()` waited for the response and then only for the grid to be VISIBLE.
  //     The grid is visible from the PREVIOUS render, so a search for "ZZZNOTEXIST999" was read
  //     back as ten real candidates and reported as "the search does not filter". The empty-state
  //     reader saw the stale grid and answered "no empty state" for the same reason.
  //   * The grid renders its rows as SKELETONS - `[role="row"]` and `[role="rowheader"]` exist
  //     with ZERO `<p>` children inside - so `rowCount()` returns 10 while every name, email and
  //     status is still absent. That was reported as "row 1 renders no email address" ten times
  //     over, and it silently made the searched-for term an empty string.
  //
  // So the settle condition is agreement, not presence: either the payload is empty AND the DOM
  // shows no rows plus an empty state, or the rendered emails are all populated and are exactly
  // the payload's. Nothing here sleeps a fixed time - a wait long enough for a slow dev box is
  // dead time on a fast one, and a fixed wait is what made this race intermittent rather than
  // constant in the first place.
  // >>> EVERY WAIT HERE IS SIZED TO COMPOSE INSIDE ONE 60s CUCUMBER STEP. <<<
  //
  // `features/support/hooks.js` calls setDefaultTimeout(60000) at load, which overrides each
  // profile's own `timeout` for every step - so a step is capped at 60s no matter what the
  // profile says. A first version used 45s here, and `I clear all filters` (open the modal +
  // Clear All + cancel + settle) blew straight past 60s and failed as "function timed out",
  // which reads like a hung app rather than a budget.
  //
  // The payload window is deliberately SHORT and its expiry is not an error. Some actions fire no
  // request at all - Clear All on a page with nothing applied is one - and in that case the DOM
  // already agrees, so waiting the full window for a request that is never coming is pure dead
  // time that then starves the settle.
  // >>> A RENDER SERVED FROM CACHE FIRES NO REQUEST, AND THE LAST PAYLOAD IS THEN A LIE. <<<
  //
  // Measured 2026-08-27: applying an empty filter set re-renders the unfiltered list the page
  // fetched on load WITHOUT going back to the server. So when no payload arrives, agreement must
  // not be tested against the previous one - the DOM has legitimately moved on from it, they can
  // never agree, and settle() burns its whole timeout before the caller's own assertion runs.
  async waitForResults({ payloadTimeout = 12000, timeout = 25000 } = {}) {
    const before = this._payloads.length;
    const payloadDeadline = Date.now() + payloadTimeout;
    while (this._payloads.length === before && Date.now() < payloadDeadline) {
      await this.page.waitForTimeout(100);
    }
    const arrived = this._payloads.length > before;
    await this.settle({ timeout, ignoreStalePayload: !arrived });
    return arrived;
  }

  // Wait until the DOM is a faithful rendering of the last response. Falls back to "rows are
  // populated OR an empty state is showing" when no response has been captured, so this is still
  // usable on a page that was reached without one.
  async settle({ timeout = 25000, ignoreStalePayload = false } = {}) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.renderState({ ignoreStalePayload });
      if (last.agrees) return last;
      await this.page.waitForTimeout(150);
    }
    // Deliberately does NOT throw: several steps legitimately arrive here on a page whose state
    // they are about to assert, and a throw would replace their specific message with this one.
    // The caller's own assertion reports what it found, and `renderState()` is attachable.
    return last;
  }

  // What the DOM currently shows, and whether it matches the last response. Exposed so a step can
  // attach it - "the DOM never caught up with the payload" and "the app returned the wrong rows"
  // look identical without it.
  async renderState({ ignoreStalePayload = false } = {}) {
    const payload = ignoreStalePayload ? null : this.lastPayload();
    const dom = await this.page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="row"]:has([role="rowheader"])')];
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return {
        gridPresent: !!document.querySelector('[role="grid"]'),
        rowCount: rows.length,
        // A skeleton row's rowheader carries no text at all, so an empty list here is the signal
        // that the content has not arrived yet.
        //
        // This used to look for <p> children, which the app does not render (each line is a
        // React-Aria <button><span>) - so EVERY row read as empty and this readiness check could
        // only ever report "not arrived", on a fully painted grid. Read the cell's own innerText.
        emails: rows.map((r) => {
          const rh = r.querySelector('[role="rowheader"]');
          return (
            ((rh && rh.innerText) || '')
              .split('\n')
              .map((t) => t.trim())
              .find((t) => emailRe.test(t)) || ''
          );
        }),
      };
    });
    const emptyState = await this.readEmptyState();
    const state = { dom, emptyState, payloadCount: payload ? (payload.body && payload.body.count) : null, agrees: false, why: '' };

    if (!payload || !payload.body || !Array.isArray(payload.body.results)) {
      // No payload to agree with - accept a populated list or a rendered empty state.
      state.agrees = (dom.rowCount > 0 && dom.emails.every(Boolean)) || !!emptyState.headline;
      state.why = state.agrees ? 'no payload; DOM is populated or empty-stated' : 'no payload; DOM is neither populated nor empty-stated';
      return state;
    }

    const want = payload.body.results.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
    if (!want.length) {
      state.agrees = dom.rowCount === 0 && !!emptyState.headline;
      state.why = state.agrees ? 'empty payload rendered as an empty state' : `empty payload but ${dom.rowCount} row(s) and headline ${JSON.stringify(emptyState.headline)}`;
      return state;
    }
    const got = dom.emails.map((e) => e.toLowerCase()).filter(Boolean);
    const same = got.length === want.length && want.every((e) => got.includes(e));
    state.agrees = same;
    state.why = same ? 'DOM matches the payload' : `payload has ${want.length} row(s), DOM shows ${got.length} populated of ${dom.rowCount}`;
    return state;
  }

  // The page fetches its list on load, so waiting for that first response here is what makes
  // `lastCount()` usable in the very next step. Without it five pagination scenarios failed on
  // "No In Progress response was captured" - the listener was attached, the response simply had
  // not been parsed yet.
  async navigate() {
    this.install();
    const before = this._payloads.length;
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    const deadline = Date.now() + 30000;
    while (this._payloads.length === before && Date.now() < deadline) {
      await this.page.waitForTimeout(100);
    }
    await this.settle();
  }

  // ---- Quick filter tabs ---------------------------------------------------------------
  async clickQuickFilter(label) {
    const key = String(label).trim().toLowerCase();
    const testId = this.quickFilterTestIds[key];
    const target = testId
      ? this.page.locator(`[data-testid="${testId}"]`).first()
      : this.quickFilters.getByRole('radio', { name: new RegExp(`^${label}$`, 'i') }).first();
    await target.click();
    await this.waitForResults();
  }

  // Is a quick filter active? Read `aria-checked` on the radio, NOT the URL: the All tab adds
  // no param at all, so a URL test would have to treat "no activeFilter" as All - which is
  // also what a page carrying only a `search=` param looks like, and what it looks like
  // mid-navigation. aria-checked is what the app itself renders.
  async isQuickFilterActive(label) {
    const key = String(label).trim().toLowerCase();
    const testId = this.quickFilterTestIds[key];
    const radio = testId
      ? this.page.locator(`[data-testid="${testId}"]`).first()
      : this.quickFilters.getByRole('radio', { name: new RegExp(`^${label}$`, 'i') }).first();
    if (!(await radio.count())) return false;
    return (await radio.getAttribute('aria-checked')) === 'true';
  }

  async activeQuickFilter() {
    for (const label of ['All', 'Invite Sent', 'Onboarding Incomplete']) {
      if (await this.isQuickFilterActive(label)) return label;
    }
    return null;
  }

  // ---- Search --------------------------------------------------------------------------
  async search(term) {
    await this.searchInput.fill(term);
    await this.waitForResults();
  }

  async clearSearch() {
    await this.searchInput.fill('');
    await this.waitForResults();
  }

  async searchValue() {
    return this.searchInput.inputValue();
  }

  // Does a row match a search term? Name OR email, case-insensitive substring - which is what
  // the control measurably does, regardless of what its placeholder claims. Testing the name
  // alone would report every email match as a failure.
  static searchMatches(row, term) {
    const t = String(term).trim().toLowerCase();
    if (!t) return true;
    return `${row.name || ''}`.toLowerCase().includes(t) || `${row.email || ''}`.toLowerCase().includes(t);
  }

  // ---- Table reads ---------------------------------------------------------------------
  async rowCount() {
    return this.dataRows.count();
  }

  // One $$eval so the list cannot detach mid-iteration while the table re-renders.
  // gridcell order: 0 = Status, 1 = Status Detail, 2 = Actions.
  // >>> THE CANDIDATE CELL CONTAINS NO <p>. <<< This read the rowheader's <p>
  // elements, and the app renders each line as a React-Aria <button><span>
  // instead - so `name` and `email` both came back '' on rows that were plainly
  // on screen, while `status` and `statusDetail` (read through innerText on the
  // gridcells) were correct. That asymmetry is exactly how the fault was found.
  //
  // The damage was NOT a cosmetic empty field: findCandidateRow() matches the
  // tracked candidate BY EMAIL, so an empty email meant no row ever matched and
  // three end-to-end scenarios failed with "<addr> is not listed on the agent's
  // In Progress page at all" - while their own attached API payload showed the
  // candidate present with the right status. That reads as a product bug and is
  // not one. (Same defect, same day, as ActiveCandidatePage.firstCandidate().)
  //
  // innerText, never textContent: textContent concatenates the two lines with no
  // separator ("Code Testeriqra.farooq+..."), which destroys the name/email
  // boundary the emailRe classification depends on.
  async readRows() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
      rows.map((r) => {
        const rh = r.querySelector('[role="rowheader"]');
        const lines = ((rh && rh.innerText) || '')
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean);
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const cells = [...r.querySelectorAll('[role="gridcell"]')].map((c) =>
          (c.innerText || '').replace(/\s+/g, ' ').trim()
        );
        return {
          // An invite_sent candidate has no name yet, so the cell holds only an email. Deriving
          // name as "the line that is not an email" keeps that case honest (name '') instead of
          // silently promoting the email into the name.
          name: lines.find((t) => !emailRe.test(t)) || '',
          email: lines.find((t) => emailRe.test(t)) || '',
          status: cells[0] || '',
          statusDetail: cells[1] || '',
        };
      })
    );
  }

  rowByEmail(email) {
    return this.dataRows.filter({ hasText: email }).first();
  }

  async headerLabels() {
    return this.page.$$eval('[role="columnheader"]', (els) =>
      els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );
  }

  // Status pill appearance, per row.
  //
  // >>> ASSERT THE RING, NOT THE BACKGROUND OR THE TEXT. <<< Measured: Invite Sent is
  // bg-brand-25 / ring-brand-700 / #4468c5 and Onboarding Incomplete is bg-error-25 /
  // ring-error-600 / #d92d20 - but both backgrounds are near-white (rgb(241,245,253) vs
  // rgb(255,251,250)) and both texts are the SAME rgb(24,29,39). A reader looking at
  // background or colour cannot tell blue from red here. The ring is the whole signal.
  async readStatusPills() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
      rows.map((r) => {
        const cell = r.querySelectorAll('[role="gridcell"]')[0];
        const pill = cell ? cell.querySelector('*') || cell : null;
        if (!pill) return null;
        const cs = getComputedStyle(pill);
        return {
          text: (pill.innerText || '').trim(),
          className: String(pill.className || ''),
          ringColor: (cs.getPropertyValue('--tw-ring-color') || '').trim(),
          background: cs.backgroundColor,
          textColor: cs.color,
        };
      })
    );
  }

  // Tailwind palette fragment -> the colour word the feature file uses. Keyed off the ring
  // class AND the resolved ring colour, so a palette rename is visible rather than silently
  // unmatched.
  static pillColorName(pill) {
    if (!pill) return null;
    const cls = pill.className || '';
    const ring = (pill.ringColor || '').toLowerCase();
    if (/ring-brand-/.test(cls) || ring === '#4468c5') return 'blue';
    if (/ring-error-/.test(cls) || ring === '#d92d20') return 'red';
    if (/ring-warning-/.test(cls)) return 'orange';
    if (/ring-success-/.test(cls)) return 'green';
    return null;
  }

  // ---- Filter modal --------------------------------------------------------------------
  async openFilters() {
    await this.filtersButton.click();
    await this.filterModal.waitFor({ state: 'visible', timeout: 15000 });
  }

  async isFilterModalOpen() {
    return this.filterModal.isVisible().catch(() => false);
  }

  // Resolve one filter group by its heading. The group is the container whose OWN first <p>
  // child is that heading - not any ancestor that merely contains the text, which on this
  // modal is also true of the whole body. Without the `:scope > p` restriction the two
  // duration groups and the Status group all resolve to the same block.
  groupSection(name) {
    const heading = this.groupHeading(name);
    return this.filterModal
      .locator('div.flex.flex-col.gap-3')
      .filter({ has: this.page.locator(`:scope > p:text-is(${JSON.stringify(heading)})`) })
      .first();
  }

  // Every group, its control type and its options, read structurally. This is the reader the
  // "modal shows its groups and options" scenario asserts against, and the one that proves the
  // heading/label collision is being handled: each option is read INSIDE its own group.
  async readFilterGroups() {
    return this.filterModal.evaluate((dlg) => {
      const blocks = [...dlg.querySelectorAll('div.flex.flex-col.gap-3')];
      return blocks
        .map((g) => {
          const h = g.querySelector(':scope > p');
          if (!h) return null;
          const radio = g.querySelector('[role="radiogroup"]');
          const labels = [...g.querySelectorAll('label')];
          if (!labels.length) return null;
          return {
            heading: (h.textContent || '').trim(),
            control: radio ? 'radio' : 'checkbox',
            options: labels.map((l) => {
              const input = l.querySelector('input');
              return {
                label: l.querySelector('p') ? (l.querySelector('p').textContent || '').trim() : '',
                testId: l.getAttribute('data-testid'),
                value: input ? input.value : null,
                checked: input ? input.checked : false,
              };
            }),
          };
        })
        .filter(Boolean);
    });
  }

  async filterOptions(group) {
    const groups = await this.readFilterGroups();
    const heading = this.groupHeading(group);
    const found = groups.find((g) => g.heading.toLowerCase() === heading.toLowerCase());
    if (!found) {
      throw new Error(
        `No filter group headed "${heading}" in the modal. Groups present: ${groups.map((g) => `"${g.heading}"`).join(', ') || '(none)'}`
      );
    }
    return found;
  }

  // Select one option inside one group, then VERIFY it committed.
  //
  // Verification is not belt-and-braces here. The options are react-aria <label>s wrapping a
  // visually-hidden <input> (the radios carry tabindex="-1"), so the label is the only
  // clickable surface - and a click that lands on the wrong element still "succeeds". An
  // unverified select is how a filter scenario passes having filtered nothing.
  async selectFilterOption(group, option) {
    const heading = this.groupHeading(group);
    const section = this.groupSection(group);
    if (!(await section.count())) {
      const groups = await this.readFilterGroups();
      throw new Error(
        `No filter group headed "${heading}". Groups present: ${groups.map((g) => `"${g.heading}"`).join(', ') || '(none)'}`
      );
    }
    // text-is, never hasText: hasText is a substring match, so "1-3 days" would also match
    // nothing here but "Invite Sent" would match "Invite Sent Duration" if the app ever adds
    // it, and "Profile Incomplete" is a prefix of the combined status detail string.
    const label = section.locator('label').filter({ has: this.page.locator(`p:text-is(${JSON.stringify(option)})`) }).first();
    if (!(await label.count())) {
      const info = await this.filterOptions(group);
      throw new Error(
        `Group "${heading}" offers no option exactly named "${option}". Offered: ${info.options.map((o) => `"${o.label}"`).join(', ')}`
      );
    }
    await label.click();
    const committed = await this.isFilterOptionSelected(group, option);
    if (!committed) {
      throw new Error(
        `Clicked "${option}" in the "${heading}" filter group but it did not become selected. ` +
          `Selected in that group afterwards: ${(await this.selectedFilterOptions(group)).map((s) => `"${s}"`).join(', ') || '(none)'}`
      );
    }
  }

  async isFilterOptionSelected(group, option) {
    const info = await this.filterOptions(group);
    const found = info.options.find((o) => o.label === option);
    return !!(found && found.checked);
  }

  async selectedFilterOptions(group) {
    const info = await this.filterOptions(group);
    return info.options.filter((o) => o.checked).map((o) => o.label);
  }

  async selectedFilterCount() {
    const groups = await this.readFilterGroups();
    return groups.reduce((n, g) => n + g.options.filter((o) => o.checked).length, 0);
  }

  // The count badge the Filters button renders while filters are applied ("Filters 1").
  // The quick-filter tab is NOT counted in it - measured.
  async appliedFilterCount() {
    const txt = (await this.filtersButton.innerText().catch(() => '')) || '';
    const m = txt.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  async applyFilters() {
    await this.applyFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.waitForResults();
  }

  // >>> CLEAR ALL FIRES NO REQUEST, AND THE MODAL STAYS OPEN. <<<
  //
  // Re-measured 2026-08-27 (`scripts/probe-inprogress-clear-all.js`). It wipes the modal's own
  // selections and NOTHING else: no in-progress request, no change to the URL, no change to the
  // rendered list, which goes on showing the filtered rows behind the open modal. Waiting for
  // results here therefore waited 12s for a payload that never comes and then 25s for a DOM that
  // could never agree with the STALE one - 37s, which is what blew the 60s step timeout.
  //
  // The observable effect of the click is the selections clearing, so that is what is waited for.
  // Committing the cleared state is `applyFilters()`'s job, exactly as it is for setting one.
  //
  // >>> IT ALSO DOES NOT RESET THE QUICK FILTER TAB. <<< The tab and the modal are independent
  // controls, so nothing here may claim to restore the unfiltered list on its own.
  async clearAllFilters() {
    await this.clearAllButton.click();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await this.selectedFilterCount()) === 0) return true;
      await this.page.waitForTimeout(150);
    }
    return false;
  }

  async cancelFilters() {
    await this.cancelFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 15000 });
  }

  // Close the modal the way a user would. All four routes verified live 2026-08-27.
  async closeFilterModal(method) {
    const how = String(method).trim().toLowerCase();
    if (/^x( icon)?$|^close$/.test(how)) {
      await this.closeFilterButton.click();
    } else if (/^cancel/.test(how)) {
      await this.cancelFiltersButton.click();
    } else if (/^backdrop|outside/.test(how)) {
      // A real mouse click at a point outside the dialog's own box. Clicking the backdrop
      // ELEMENT would target its centre, which is on top of the dialog; and a dispatched
      // event is untrusted, which is the trap the community module's pasteAbout() hit.
      const box = await this.filterModal.boundingBox();
      const view = this.page.viewportSize() || { width: 1280, height: 720 };
      const x = box && box.x > 40 ? Math.max(8, Math.round(box.x / 2)) : Math.round(view.width - 8);
      const y = Math.round(view.height / 2);
      await this.page.mouse.click(x, y);
    } else if (/^esc/.test(how)) {
      await this.page.keyboard.press('Escape');
    } else {
      throw new Error(`Unknown filter-modal dismissal "${method}". Known: X icon, Cancel, backdrop, Escape.`);
    }
    await this.filterModal.waitFor({ state: 'hidden', timeout: 15000 });
  }

  // ---- Empty states --------------------------------------------------------------------
  // Four distinct states, measured 2026-08-27. All three no-candidates wordings match the
  // written AC; the two no-results ones name whichever of search and filters is active, and
  // only the FILTER one offers a Clear CTA:
  //
  //   All tab, no candidates          | No candidates yet        | Start by inviting your first candidate or sharing your agent code. | Invite Candidates
  //   Invite Sent tab, none           | No pending invites       | Candidates will appear here after you send them an invitation.     | -
  //   Onboarding Incomplete, none     | No incomplete onboarding | Candidates who haven't finished onboarding will show up here.      | -
  //   search matches nothing          | No results found         | We couldn't find any results matching your current search.        | -
  //   filters match nothing           | No results found         | We couldn't find any results matching your current filters.       | Clear all filters
  //
  // NOTE the app writes a CURLY apostrophe (U+2019) in "haven't" and "couldn't"; the feature
  // file uses straight ones. normalizeText() below folds both, because a scenario going red on
  // an invisible codepoint difference tells the reader nothing.
  static normalizeText(s) {
    return String(s || '')
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/–|—/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Read the empty state, scoped to <main> and EXCLUDING any open dialog - the filter modal
  // and the reminder history panel both live outside <main>, but a future in-main overlay
  // would otherwise be read as the list's own state. Returns nulls when the list has rows,
  // which is what lets a step distinguish "no empty state" from "the wrong empty state".
  async readEmptyState() {
    return this.page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return { headline: null, body: null, clearCta: null };
      if (main.querySelector('[role="grid"]')) return { headline: null, body: null, clearCta: null };
      const KNOWN = [
        'No candidates yet',
        'No pending invites',
        'No incomplete onboarding',
        'No results found',
      ];
      const texts = [...main.querySelectorAll('p, h1, h2, h3, h4, span, div')]
        .map((e) => ({ el: e, t: (e.textContent || '').replace(/\s+/g, ' ').trim() }))
        .filter((x) => x.t);
      const head = texts.find((x) => KNOWN.some((k) => x.t === k || x.t === `${k}.`));
      if (!head) return { headline: null, body: null, clearCta: null };
      // The body sentence is the sibling paragraph; take the shortest text that reads like a
      // sentence and is not the headline itself, so a wrapper holding both is never returned.
      const bodyCandidates = texts
        .filter((x) => x.t !== head.t && /\.$/.test(x.t) && x.t.length < 200 && !KNOWN.includes(x.t))
        .sort((a, b) => a.t.length - b.t.length);
      const cta = [...main.querySelectorAll('button, a')]
        .map((e) => (e.textContent || '').trim())
        .find((t) => /^clear all filters$/i.test(t) || /^invite candidates$/i.test(t));
      return {
        headline: head.t,
        body: bodyCandidates.length ? bodyCandidates[0].t : null,
        clearCta: cta || null,
      };
    });
  }

  // Which of the five states is on screen, by its wording alone. Named states rather than a
  // boolean so a step can assert the search state is DISTINCT from the no-candidates one -
  // which is the whole point of one of the scenarios.
  async emptyStateKind() {
    const s = await this.readEmptyState();
    if (!s.headline) return null;
    const body = InProgressCandidatePage.normalizeText(s.body);
    if (/^No candidates yet$/i.test(s.headline)) return 'no-candidates';
    if (/^No pending invites$/i.test(s.headline)) return 'no-invites';
    if (/^No incomplete onboarding$/i.test(s.headline)) return 'no-incomplete-onboarding';
    if (/current search and filters/i.test(body)) return 'no-search-or-filter-results';
    if (/current search/i.test(body)) return 'no-search-results';
    if (/current filters/i.test(body)) return 'no-filter-results';
    return 'unknown';
  }

  // Any error surfaced on the page. Deliberately narrow: a "No results found" empty state is
  // NOT an error, and a reader that treated every red-ish string as one would make the
  // "shows no results without an error" scenarios unpassable - the same defect
  // anyFilterApplied() had in the community module.
  async errorMessages() {
    return this.page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="alert"], [aria-live="assertive"], [data-testid*="error" i]')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      }
      for (const el of document.querySelectorAll('main p, main span')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(something went wrong|an error occurred|failed to load|unable to load)/i.test(t)) out.push(t);
      }
      return [...new Set(out)];
    });
  }

  // ---- Pagination ----------------------------------------------------------------------
  async hasPagination() {
    return this.pagination.isVisible().catch(() => false);
  }

  // The page numbers offered and which is current.
  //
  // >>> THE PAGINATION CONTAINER HAS NO `role` ATTRIBUTE. <<< It is
  // `<nav aria-label="Pagination Navigation">`, so its navigation role is IMPLICIT - and
  // `document.querySelector('[role="navigation"]')`, which only matches an explicit attribute,
  // found nothing. Falling back to the first `<nav>` is worse than nothing: that is the app's
  // SIDEBAR, which holds no page numbers, so this reader answered "no pagination is rendered" on
  // a page showing 34 pages of candidates and four scenarios reported it as a missing control.
  // (`this.pagination` above was always right - Playwright's role engine resolves implicit roles
  // and uses aria-label as the accessible name - so only this evaluate() was affected.)
  //
  // The page controls are `<button role="listitem" aria-label="Page N">` and the current one
  // carries `aria-current="page"`. Read that marker rather than inferring "the first one": after
  // a Next click the current page is mid-list, and a class-name guess would be a fourth way to
  // get this wrong.
  async paginationState() {
    return this.page.evaluate(() => {
      const nav = [...document.querySelectorAll('nav, [role="navigation"]')].find((n) =>
        /pagination/i.test(n.getAttribute('aria-label') || '')
      );
      if (!nav) return { present: false, pages: [], current: null, prevDisabled: null, nextDisabled: null };
      const items = [...nav.querySelectorAll('[role="listitem"], li')];
      const pages = items
        .map((i) => (i.textContent || '').trim())
        .filter((t) => /^\d+$/.test(t))
        .map(Number);
      const currentEl = items.find((i) => i.getAttribute('aria-current') === 'page');
      let current = currentEl ? Number((currentEl.textContent || '').trim()) : null;
      if (!current) {
        // Fall back to the URL, which carries ?page=N once the reader has moved off page 1.
        const p = new URL(location.href).searchParams.get('page');
        current = p ? Number(p) : pages.length ? pages[0] : null;
      }
      const btn = (re) =>
        [...nav.querySelectorAll('button')].find((b) => re.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
      const prev = btn(/previous/i);
      const next = btn(/next/i);
      return {
        present: true,
        pages,
        current,
        prevDisabled: prev ? prev.disabled : null,
        nextDisabled: next ? next.disabled : null,
      };
    });
  }

  async goToNextPage() {
    await this.nextPageButton.click();
    await this.waitForResults();
  }

  async goToPreviousPage() {
    await this.previousPageButton.click();
    await this.waitForResults();
  }

  async goToLastPage() {
    // Click the highest offered page, then keep going while Next stays enabled - the control
    // renders an ellipsis, so the highest VISIBLE number is not always the last page.
    for (let guard = 0; guard < 40; guard++) {
      const state = await this.paginationState();
      if (!state.present) return;
      if (state.nextDisabled) return;
      const highest = Math.max(...state.pages);
      if (state.current !== highest) {
        await this.pagination.locator('[role="listitem"], li').filter({ hasText: new RegExp(`^${highest}$`) }).first().click();
        await this.waitForResults();
      } else {
        await this.goToNextPage();
      }
    }
    throw new Error('Did not reach the last page within 40 pagination steps.');
  }

  // ---- Row actions / reminder history --------------------------------------------------
  // >>> THE REMINDER HISTORY ICON IS THE ONLY PLACE A REMINDER IS VISIBLE TO A HUMAN. <<<
  // The row itself renders nothing about reminders (no column, no badge), so this panel and
  // the API's `reminder_status` are the two surfaces the Reminder Status filter can be
  // asserted against. Nothing here SENDS a reminder - the entries this reads were sent by the
  // product's own scheduler, and no SUITE code clicks Resend. (scripts/probe-resend-cooldown.js
  // does, on purpose and only against a suite-owned address, to measure the cooldown - there is
  // none; see the header of this file.)
  //
  // Measured on a `multiple` candidate: entries render as a title plus "Sent • Aug 26, 2026 -
  // 12:00 PM", ten at a time behind a "View more". On a candidate with no reminders the panel
  // renders its title and subtitle and NOTHING ELSE - no list, no empty state (a finding).
  // >>> A CANDIDATE WITH NO REMINDERS RENDERS ITS HISTORY ICON `disabled`. <<<
  // Measured 2026-08-27: every row the "No Reminder Sent" filter returns carries
  // `has_reminders: false` and its button has the `disabled` attribute with
  // `cursor: not-allowed`; every row `recent`/`multiple` return is enabled with
  // `cursor: pointer`. So the disabled icon IS the app's only human-visible marker of the
  // no-reminder state - the row itself still renders no column, no badge and no count.
  //
  // The state is read from the `disabled` PROPERTY, `aria-disabled` and the computed cursor
  // together, and all three are reported. `opacity` is 1 in BOTH states and the class list is
  // byte-identical (the greying lives in unresolved `disabled:` Tailwind variants), so a reader
  // that guessed at opacity or a class name could only ever answer "not disabled" - the trap the
  // community module's greying assertion was caught by.
  async readReminderIconStates() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
      rows.map((r) => {
        const rh = r.querySelector('[role="rowheader"]');
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        // innerText, not querySelectorAll('p') - the cell renders no <p>, so the <p> read
        // returned '' for every row and any pairing done by email silently matched nothing.
        const email =
          ((rh && rh.innerText) || '')
            .split('\n')
            .map((t) => t.trim())
            .find((t) => emailRe.test(t)) || '';
        const btn =
          r.querySelector('[data-testid="agent-candidates-reminder-history-button"]') ||
          r.querySelector('button[aria-label="Reminder History"]');
        if (!btn) return { email, present: false, disabled: null, ariaDisabled: null, cursor: null };
        return {
          email,
          present: true,
          disabled: btn.disabled === true || btn.getAttribute('aria-disabled') === 'true',
          ariaDisabled: btn.getAttribute('aria-disabled'),
          cursor: getComputedStyle(btn).cursor,
        };
      })
    );
  }

  // Whether the icon can actually be operated, asserted by TRYING it rather than by reading the
  // same attribute twice. A disabled button swallows the click, so the panel must stay away - and
  // absence has to be watched for a window, or a panel that opens a beat later reads as absent.
  // Same distinction as the promo module's `saveStaysDisabled()`.
  async reminderHistoryStaysClosed(index = 0, windowMs = 2500) {
    await this.reminderHistoryButtons
      .nth(index)
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      if (await this.reminderHistoryPanel.isVisible().catch(() => false)) return false;
      await this.page.waitForTimeout(200);
    }
    return true;
  }

  async openReminderHistory(index = 0) {
    await this.reminderHistoryButtons.nth(index).click();
    await this.reminderHistoryPanel.waitFor({ state: 'visible', timeout: 15000 });
    // The list arrives after the panel. Wait for either an entry or a settled empty panel
    // rather than a fixed sleep, then let the caller decide what emptiness means.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if ((await this.readReminderHistory()).entries.length) break;
      await this.page.waitForTimeout(250);
    }
    return this.readReminderHistory();
  }

  async readReminderHistory() {
    return this.reminderHistoryPanel
      .evaluate((panel) => {
        const text = (panel.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const entries = [];
        // >>> "Sent" AND ITS TIMESTAMP ARE NOW ON SEPARATE LINES (re-measured 2026-10-14):
        // title / "Sent" / "Oct 12, 2026 - 1:00 PM". Matching only the older inline
        // "Sent • <date>" form returned ZERO entries for a panel listing several - the false
        // negative RequiresAttentionPage.readReminderHistory() was fixed for on 2026-09-17. Both
        // forms are accepted so a layout change back cannot empty this reader again.
        for (let i = 0; i < text.length; i++) {
          const inline = text[i].match(/^Sent\s*[•·]\s*(.+)$/i);
          if (inline && i > 0) { entries.push({ title: text[i - 1], sentAt: inline[1].trim() }); continue; }
          if (/^Sent$/i.test(text[i]) && i > 0 && text[i + 1]) {
            entries.push({ title: text[i - 1], sentAt: text[i + 1] });
            i += 1;
          }
        }
        return {
          heading: text.find((t) => /Reminder History/i.test(t)) || null,
          subtitle: text.find((t) => /Showing all reminders/i.test(t)) || null,
          entries,
          hasViewMore: text.some((t) => /^view more$/i.test(t)),
          raw: text,
        };
      })
      .catch(() => ({ heading: null, subtitle: null, entries: [], hasViewMore: false, raw: [] }));
  }

  async closeReminderHistory() {
    await this.page.keyboard.press('Escape');
    await this.reminderHistoryPanel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // -------------------------------------------------------------------------------------------
  // Row actions: Resend, and Reminder History beside it
  //
  // >>> THE TWO ICONS FOLLOW DIFFERENT RULES, AND CONFLATING THEM IS THE TRAP HERE. <<<
  // Measured 2026-09-09 over the first page of each tab (10 rows each):
  //
  //   tab                    | Resend                  | Reminder History
  //   -----------------------|-------------------------|--------------------------
  //   Invite Sent            | 10/10 present, ALL enabled  | 10/10 present, all enabled
  //   Onboarding Incomplete  | 10/10 present, ALL disabled | 10/10 present, 3 ENABLED
  //   All                    | 10/10 present, ALL disabled | 10/10 present, 3 enabled
  //
  // So **Resend is decided by the row's status** - enabled while the invitation is still
  // outstanding (Invite Sent / Awaiting Signup), disabled once the candidate has signed up and is
  // merely Onboarding Incomplete, which is the sensible rule: there is no invitation left to
  // resend. **Reminder History is decided by whether that candidate has reminders**, tab
  // regardless - see the note on readReminderIconStates(). An expectation of "both icons are
  // disabled on Onboarding Incomplete" holds for Resend and is FALSE for Reminder History.
  // -------------------------------------------------------------------------------------------

  // Both row actions, per row, with the candidate and status they belong to. One pass, so the two
  // icons are always read from the same render - reading them separately would let a re-render
  // between the two answer about different rows.
  async readRowActionStates() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
      rows.map((r) => {
        const rh = r.querySelector('[role="rowheader"]');
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const email =
          ((rh && rh.innerText) || '').split('\n').map((t) => t.trim()).find((t) => emailRe.test(t)) || '';
        const cells = [...r.querySelectorAll('[role="gridcell"]')];
        const read = (sel, aria) => {
          const b = r.querySelector(sel) || r.querySelector(`button[aria-label="${aria}"]`);
          if (!b) return { present: false, disabled: null, cursor: null };
          return {
            present: true,
            // The `disabled` PROPERTY and aria-disabled together - the class list is identical in
            // both states and the greying lives in unresolved `disabled:` Tailwind variants, so a
            // class or opacity guess could only ever answer "not disabled".
            disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
            cursor: getComputedStyle(b).cursor,
          };
        };
        return {
          email,
          status: cells[1] ? (cells[1].innerText || '').trim() : null,
          statusDetail: cells[2] ? (cells[2].innerText || '').trim() : null,
          resend: read('[data-testid="agent-candidates-resend-invite-button"]', 'Resend'),
          reminderHistory: read('[data-testid="agent-candidates-reminder-history-button"]', 'Reminder History'),
        };
      })
    );
  }

  // Open the confirmation for the nth row whose Resend is actually operable. Deliberately indexed
  // over the ENABLED ones: `.nth(0)` over all rows lands on a disabled icon on the All tab, and a
  // click on that is swallowed, so the wait would time out on a modal that was never coming.
  async openResendModal(index = 0) {
    const enabled = this.page.locator(
      '[data-testid="agent-candidates-resend-invite-button"]:not([disabled])'
    );
    const count = await enabled.count();
    if (count <= index) {
      throw new Error(
        `No enabled Resend icon at index ${index} - this tab offers ${count}. On Onboarding `
        + 'Incomplete every Resend is disabled by design, so a resend scenario has to run on the '
        + 'Invite Sent tab.'
      );
    }
    await enabled.nth(index).click();
    await this.resendModal.waitFor({ state: 'visible', timeout: 15000 });
    return this.readResendModal();
  }

  // The modal's whole contract, read in one pass: its heading, the candidate it names, the warning
  // it carries, and every button with its label and state.
  async readResendModal() {
    return this.resendModal.evaluate((d) => {
      const text = (d.innerText || '').replace(/\n+/g, ' | ');
      return {
        heading: (d.querySelector('h1,h2,h3,h4') || {}).innerText || null,
        text,
        namesCandidate: (text.match(/[\w.+-]+@[\w.-]+\.\w+/) || [null])[0],
        warnsPreviousLinksStop: /previous invite links will no longer work/i.test(text),
        buttons: [...d.querySelectorAll('button')].map((b) => ({
          label: (b.innerText || '').trim() || b.getAttribute('aria-label'),
          disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
        })),
      };
    });
  }

  async closeResendModal(method = 'Cancel') {
    if (/escape/i.test(method)) await this.page.keyboard.press('Escape');
    else if (/close|x icon/i.test(method)) {
      await this.resendModal.locator('button').filter({ hasText: /^close$/i }).first()
        .click()
        .catch(async () => { await this.resendModal.locator('button[aria-label="Close"]').first().click(); });
    } else {
      await this.resendModal.locator('button').filter({ hasText: /^cancel$/i }).first().click();
    }
    await this.resendModal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return !(await this.resendModal.isVisible().catch(() => false));
  }

  // Confirm, and return what the SERVER said rather than only what the screen did.
  //
  // >>> MEASURED: THE OUTCOME IS PER-CANDIDATE AND NOT ALWAYS SUCCESS. <<< The confirm posts
  // `POST /core/api/v1/agent/invite/candidate/` (the same endpoint a first invite uses, singular -
  // the bulk path is `.../bulk/`). For most candidates it answers
  // `200 {"detail":"Invitation resent."}` with a toast "Invite re-sent successfully"; for at least
  // one Invite Sent candidate it answers `422 {"email":["This candidate is already assigned to
  // you."]}` and shows that as the toast - reproducibly, twice in a row, on a row whose Resend
  // icon is ENABLED. Both are returned so the caller can assert the success and REPORT the
  // refusal, instead of a step reading "the resend failed" with no way to tell the two apart.
  async confirmResend({ timeout = 20000 } = {}) {
    const waiting = this.page
      .waitForResponse((r) => /\/agent\/invite\/candidate\/$/.test(r.url()) && r.request().method() !== 'GET', { timeout })
      .catch(() => null);
    await this.resendModal.locator('button').filter({ hasText: /resend invite/i }).first().click();
    const response = await waiting;
    let body = null;
    if (response) {
      try { body = await response.text(); } catch (err) { body = '(unreadable)'; }
    }
    await this.page.waitForTimeout(2500);
    return {
      requested: !!response,
      status: response ? response.status() : null,
      url: response ? response.url() : null,
      body: body ? String(body).slice(0, 400) : null,
      confirmed: !!response && response.status() >= 200 && response.status() < 300,
      modalClosed: !(await this.resendModal.isVisible().catch(() => false)),
      toasts: await this.page
        .locator('[role="alert"], [role="status"], .Toastify__toast')
        .evaluateAll((els) => [...new Set(els.map((e) => (e.innerText || '').trim()).filter(Boolean))])
        .catch(() => []),
    };
  }

  // Watch a window for a resend request rather than sampling once - this is what proves CANCEL
  // sent nothing, and "no request yet" is also true of a request about to be made.
  async noResendRequestDuring(action, windowMs = 4000) {
    const seen = [];
    const listener = (request) => {
      if (request.method() !== 'GET' && /\/agent\/invite\/candidate/.test(request.url())) {
        seen.push(`${request.method()} ${request.url()}`);
      }
    };
    this.page.on('request', listener);
    try {
      await action();
      await this.page.waitForTimeout(windowMs);
    } finally {
      this.page.off('request', listener);
    }
    return seen;
  }
}

module.exports = InProgressCandidatePage;
