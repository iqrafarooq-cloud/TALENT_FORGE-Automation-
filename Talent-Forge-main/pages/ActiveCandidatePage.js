const BasePage = require('./BasePage');

// ActiveCandidatePage — Page Object for Agent Portal > Candidates > Active tab.
//
// Selectors follow the project convention: layered from most-stable
// (data-testid) -> ARIA role/name -> semantic HTML -> structural class ->
// text fallback. The live app (React Aria + Tailwind) already exposes a good
// set of data-testids for the Active tab, which we prefer.
//
// Verified against dev.talentforge.com.sa on 2026-07-21:
//   - URL:            /candidates/active  (redirects to ?activeFilter=all)
//   - quick filters:  activeFilter = all | subscribed | paymentDue | notSubscribed
//   - search param:   ?search=<term>   (debounced ~1s)
//   - filter param:   ?accountVerification=verified  etc.
//   - row actions:    "View" (eye) -> profile,  "Notify" (bell) -> Send Reminder modal
class ActiveCandidatePage extends BasePage {
  constructor(page) {
    super(page);

    // Derive the app origin from BASE_URL (e.g. https://dev.talentforge.com.sa/login).
    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/candidates/active`;

    // ---- Header / page identity ----
    this.pageHeading = page.getByRole('heading', { name: /Candidates\s*-\s*Active/i });

    // ---- Search ----
    // Live testid is `agent-candidates-search-input` (verified 2026-07-21); the
    // older `agent-candidates-search` and the placeholder/searchbox fallbacks are
    // kept so the locator survives a partial test-id rollout.
    this.searchInput = page.locator(
      '[data-testid="agent-candidates-search-input"], [data-testid="agent-candidates-search"], input[placeholder="Search by candidate name..."], [role="searchbox"]'
    ).first();

    // ---- Quick filter tabs (rendered as a radiogroup) ----
    this.quickFilters = page.locator('[role="radiogroup"]').first();

    // ---- Filters button + modal ----
    this.filtersButton = page.locator(
      '[data-testid="agent-candidates-filters-button"], button:has-text("Filters")'
    ).first();
    this.filterModal = page.getByRole('dialog').filter({ hasText: /Apply Filters/i }).first();
    this.applyFiltersButton = page.locator(
      '[data-testid="filters-apply-button"], [role="dialog"] button:has-text("Apply Filters")'
    ).first();
    // Filter modal footer / header controls.
    this.clearAllButton = this.filterModal.getByRole('button', { name: /^Clear All$/i }).first();
    this.cancelFiltersButton = this.filterModal.getByRole('button', { name: /^Cancel$/i }).first();
    this.closeFilterButton = this.filterModal.getByRole('button', { name: /^Close$/i }).first();

    // ---- Empty-results state (shown when a search/filter combo matches nothing) ----
    this.emptyState = page
      .getByText(/No results found|couldn't find any results|Clear all filters/i)
      .first();

    // ---- Table ----
    this.table = page.getByRole('grid', { name: /Candidates/i }).first();
    this.tableRows = this.table.locator('[role="rowgroup"]').last().locator('[role="row"]');

    // ---- Pagination ----
    this.pagination = page.getByRole('navigation', { name: /Pagination/i }).first();

    // ---- Row action buttons (per-row; callers use .first() or row scoping) ----
    this.viewButtons = page.locator(
      '[data-testid="agent-candidates-view-button"], button[aria-label="View"]'
    );
    this.notifyButtons = page.locator(
      '[data-testid="agent-candidates-notify-icon"], button[aria-label="Notify"]'
    );

    // ---- Send Reminder modal ----
    this.reminderModal = page.getByRole('dialog').filter({ hasText: /Send Reminder/i }).first();

    // ---- Tooltip (React-Aria renders role="tooltip"; the others are fallbacks
    // kept so a library swap does not silently report "no tooltip") ----
    this.tooltip = page
      .locator('[role="tooltip"], .tooltip-title, [data-radix-popper-content-wrapper]')
      .first();

    // ---- Account Verification header info icon ----
    this.verificationInfoIcon = page
      .locator('[role="columnheader"]', { hasText: /Account Verification/i })
      .locator('button')
      .first();

    // Map the quick-filter UI labels to their data-testid slugs / URL values.
    this.quickFilterTestIds = {
      all: 'agent-candidates-active-filter-all',
      subscribed: 'agent-candidates-active-filter-subscribed',
      'payment due': 'agent-candidates-active-filter-payment-due',
      'not subscribed': 'agent-candidates-active-filter-not-subscribed',
    };
  }

  async navigate() {
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    // Either the table or an empty-state renders once the tab is ready.
    await this.pageHeading.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
  }

  // Click a quick-filter tab by its visible label ("All", "Subscribed", ...).
  async clickQuickFilter(label) {
    const key = label.trim().toLowerCase();
    const testId = this.quickFilterTestIds[key];
    if (testId) {
      const byTestId = this.page.locator(`[data-testid="${testId}"]`);
      if (await byTestId.count()) {
        await byTestId.first().click();
        await this.page.waitForTimeout(600); // let the table refresh
        return;
      }
    }
    // Fallback: click the radio's visible label text inside the quick-filter group.
    await this.quickFilters.getByText(new RegExp(`^${label}$`, 'i')).first().click();
    await this.page.waitForTimeout(600);
  }

  // Is the given quick filter currently active/checked?
  async isQuickFilterActive(label) {
    const key = label.trim().toLowerCase();
    const map = { all: 'all', subscribed: 'subscribed', 'payment due': 'paymentDue', 'not subscribed': 'notSubscribed' };
    const urlValue = map[key];
    if (urlValue && this.page.url().toLowerCase().includes(`activefilter=${urlValue.toLowerCase()}`)) {
      return true;
    }
    // Fallback: aria-checked on the matching radio.
    const radio = this.quickFilters.getByRole('radio', { name: new RegExp(label, 'i') }).first();
    if (await radio.count()) {
      const checked = await radio.getAttribute('aria-checked');
      if (checked === 'true') return true;
      const isChecked = await radio.isChecked().catch(() => false);
      return isChecked;
    }
    return false;
  }

  async search(term) {
    await this.searchInput.fill(term);
    // The search is debounced and reflected in the URL (?search=...).
    await this.page.waitForTimeout(1200);
  }

  async getSearchValue() {
    return this.searchInput.inputValue();
  }

  // Count data rows (rows carrying a rowheader = candidate cell).
  async rowCount() {
    return this.table.locator('[role="row"]:has([role="rowheader"])').count();
  }

  rowByName(name) {
    return this.table.locator('[role="row"]', { hasText: name }).first();
  }

  // Open the profile of the first candidate row (the "eye" / View action).
  async openFirstCandidateProfile() {
    await this.viewButtons.first().click();
    await this.page.waitForURL(/\/view-profile/, { timeout: 30000 });
  }

  // Open the Send Reminder modal for the first candidate whose bell is ENABLED.
  // A candidate's bell disables briefly right after its reminder is sent (the
  // table refetches), so poll for an available one — this lets a "send to every
  // type" flow step onto a fresh row each time without racing the reload.
  async openFirstEnabledReminder() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const total = await this.notifyButtons.count();
      for (let i = 0; i < total; i++) {
        const bell = this.notifyButtons.nth(i);
        if (await bell.isEnabled().catch(() => false)) {
          await bell.click();
          await this.reminderModal.waitFor({ state: 'visible', timeout: 15000 });
          return;
        }
      }
      await this.page.waitForTimeout(1000); // bells re-enable shortly after a send
    }
    throw new Error('No enabled Notify (bell) button became available within timeout.');
  }

  // Open the Send Reminder modal for the first candidate row (the "bell" / Notify action).
  async openFirstCandidateReminder() {
    await this.notifyButtons.first().click();
    await this.reminderModal.waitFor({ state: 'visible', timeout: 15000 });
  }

  // Hover the Account Verification header info icon to reveal its tooltip.
  // React-Aria hover tooltips only open on a real pointer transition, so we
  // move the pointer to a neutral element (the page heading) first — otherwise,
  // if the mouse is already over the target, Playwright's hover() is a no-op and
  // no pointerenter fires.
  // >>> THE HOVER IS RETRIED, BECAUSE ONE POINTER TRANSITION IS NOT RELIABLE
  // HERE. <<< Measured 2026-09-08: this scenario failed 1 run in 2 in isolation
  // with the tooltip never appearing at all. The cause is not the locator - it
  // resolves and the tooltip does open on a good run - it is that the grid
  // finishes loading and re-renders the header AFTER the hover lands, which
  // discards React-Aria's pointerenter and with it the pending tooltip. A fixed
  // 300ms wait cannot survive that: the tooltip is simply never scheduled.
  //
  // So: let the grid settle first, then re-drive the transition (neutral element
  // -> icon) until the tooltip actually appears. The pointer must leave and
  // re-enter each time - hovering an already-hovered element fires nothing, the
  // same reason the neutral hover was there to begin with.
  //
  // The final attempt deliberately leaves the pointer on the icon so the calling
  // step still asserts against a genuine state rather than a cleaned-up one.
  async hoverVerificationInfo(attempts = 4) {
    await this.table.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(500); // let the grid's render pass complete
    for (let i = 0; i < attempts; i++) {
      await this.pageHeading.hover().catch(() => {});
      await this.page.waitForTimeout(150);
      await this.verificationInfoIcon.hover();
      try {
        await this.tooltip.waitFor({ state: 'visible', timeout: 3000 });
        return;
      } catch {
        // re-render swallowed the pointerenter - drive it again
      }
    }
  }

  // Clear the search box and let the debounced fetch settle.
  async clearSearch() {
    await this.searchInput.fill('');
    await this.page.waitForTimeout(1200);
  }

  // Name + email of the first data row.
  //
  // >>> THE CANDIDATE CELL CONTAINS NO <p>. <<< Measured live 2026-09-08
  // (scripts/probe-active-candidate-rowheader.js): each of the two lines is a
  // React-Aria <button><span>, so the earlier reader — which waited for a <p>
  // holding '@' — timed out on every row and reported four working search
  // scenarios as broken. Read the cell's own innerText instead: it survives the
  // app changing which element wraps each line, and it is newline-separated,
  // which textContent is NOT (that concatenates to "Cand Testeriqra.farooq+...",
  // destroying the name/email boundary).
  //
  // The wait is on '@' appearing in that text, because the row skeleton renders
  // a tick before its content populates.
  async firstCandidate() {
    const rh = this.table.locator('[role="row"]:has([role="rowheader"]) [role="rowheader"]').first();
    await rh.waitFor({ state: 'visible', timeout: 15000 });
    await this.page
      .waitForFunction(
        () => {
          const el = document.querySelector('[role="row"]:has([role="rowheader"]) [role="rowheader"]');
          return !!el && el.innerText.includes('@');
        },
        undefined,
        { timeout: 15000 }
      )
      .catch(() => {});
    const lines = (await rh.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const name = lines.find((t) => !emailRe.test(t)) || '';
    const email = lines.find((t) => emailRe.test(t)) || '';
    if (!email) {
      throw new Error(
        `The first candidate row exposed no email address. Candidate cell read: ${JSON.stringify(lines)}`
      );
    }
    return { name, email };
  }

  // Atomic snapshot of every visible row's "Candidate" cell as "name email".
  // One $$eval so the list can't detach mid-iteration while the table
  // re-renders.
  //
  // innerText, never textContent: the cell holds no <p> (see firstCandidate),
  // and textContent runs the two lines together with no separator, so a term
  // straddling the name/email boundary would match text no row displays.
  async visibleRowHeaders() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"]) [role="rowheader"]', (els) =>
      els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
    );
  }

  // Values of a given data column across all visible rows.
  // gridcell order: 0=Account Verification, 1=Pending Documents,
  // 2=Subscription Status, 3=Last Activity, 4=Actions.
  async columnValues(colIndex) {
    return this.page.$$eval(
      '[role="row"]:has([role="rowheader"])',
      (rows, i) =>
        rows.map((r) => {
          const cells = r.querySelectorAll('[role="gridcell"]');
          return cells[i] ? cells[i].innerText.replace(/\s+/g, ' ').trim() : '';
        }),
      colIndex
    );
  }

  // Per-row snapshot of the Actions cell: which of the two controls the row
  // offers, and whether each is disabled.
  //
  // Measured live 2026-09-08 (scripts/probe-active-actions-column.js): the grid
  // carries an "Actions" column header and every row holds exactly two controls,
  // `agent-candidates-view-button` ("View") and
  // `agent-candidates-reminder-history-button` ("Reminder History"), on all four
  // quick-filter tabs. Both are real <button>s with an aria-label, so the label
  // is layered behind the test id rather than being the only hook.
  //
  // One $$eval so the list cannot detach mid-iteration while the grid re-renders.
  async readRowActions() {
    return this.page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
      rows.map((r) => {
        const header = r.querySelector('[role="rowheader"]');
        const lines = ((header && header.innerText) || '')
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean);
        const state = (el) =>
          el
            ? {
              present: true,
              disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
            }
            : { present: false, disabled: null };
        return {
          email: lines.find((t) => t.includes('@')) || '',
          name: lines.find((t) => !t.includes('@')) || '',
          view: state(
            r.querySelector('[data-testid="agent-candidates-view-button"], button[aria-label="View"]')
          ),
          reminderHistory: state(
            r.querySelector(
              '[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]'
            )
          ),
        };
      })
    );
  }

  // Switch to a quick-filter tab and hand back the rows the server returned for
  // it. Used to hunt for both polarities of `has_reminders`: the default "All"
  // page is frequently all-reminders, so a check that never leaves it can only
  // ever exercise the ENABLED half of the rule.
  async clickQuickFilterCapturingList(label, timeout = 45000) {
    const response = this.page.waitForResponse(
      (r) => /\/candidate\/active\//.test(r.url()) && r.request().method() === 'GET' && r.ok(),
      { timeout }
    );
    await this.clickQuickFilter(label);
    const body = await (await response).json();
    await this.page.waitForTimeout(1200); // let the grid paint the rows that payload describes
    return body.results || body.data || [];
  }

  // Reload the CURRENT view (query string intact, so the quick-filter tab is
  // preserved) and hand back the rows the server actually returned.
  //
  // `has_reminders` on each row is what drives the Reminder History control's
  // disabled state, and it is exposed nowhere in the grid — there is no reminder
  // column on this tab — so the payload is the only way to assert the rule
  // rather than merely observing that some controls happen to be disabled.
  async reloadCapturingActiveList(timeout = 45000) {
    const response = this.page.waitForResponse(
      (r) => /\/candidate\/active\//.test(r.url()) && r.request().method() === 'GET' && r.ok(),
      { timeout }
    );
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    const body = await (await response).json();
    const rows = body.results || body.data || [];
    // Let the grid paint the rows that payload describes before they are read.
    await this.table.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
    return rows;
  }

  // Open the filter modal and wait for it to render.
  async openFilters() {
    await this.filtersButton.click();
    await this.filterModal.waitFor({ state: 'visible', timeout: 10000 });
  }

  // Toggle a filter option by its exact label (exact match so "Subscribed"
  // does not also hit "Not Subscribed"), scoped to the modal.
  async selectFilterOption(label) {
    await this.filterModal.getByText(label, { exact: true }).first().click();
  }

  // Apply the current selection and let the table refresh.
  async applyFilters() {
    await this.applyFiltersButton.click();
    await this.page.waitForTimeout(800);
  }

  // Clear All wipes every selection AND the filter URL params immediately
  // (no Apply needed); the modal stays open.
  async clearAllFilters() {
    await this.clearAllButton.click();
    await this.page.waitForTimeout(400);
  }

  // Cancel discards any unapplied selections and closes the modal.
  async cancelFilters() {
    await this.cancelFiltersButton.click();
  }

  // How many filter options are currently checked inside the open modal.
  // React-Aria renders real <input> elements, so :checked is reliable.
  async selectedFilterCount() {
    return this.filterModal.locator('input:checked').count();
  }

  // The applied-filter count badge rendered on the Filters button (0 if none).
  async appliedFilterCount() {
    const txt = (await this.filtersButton.innerText().catch(() => '')) || '';
    const m = txt.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
}

module.exports = ActiveCandidatePage;
