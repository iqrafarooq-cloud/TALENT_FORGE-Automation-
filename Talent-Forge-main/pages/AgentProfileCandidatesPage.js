const CandidatesListingPage = require('./CandidatesListingPage');

// AgentProfileCandidatesPage - SuperAdmin Portal > Agents > View > the agent profile's
// CANDIDATES tab (`/agents/view/<id>?tab=candidates`), driven as a page in its own right.
//
// It EXTENDS CandidatesListingPage because the dialogs behind its row actions are the very same
// components - Update Email Address, Deactivate Candidate Account and Reactivate Account render
// with the Candidates listing's labels, buttons and wording. What differs is the grid, the
// search, the request and where the lifecycle actions live, and only those are overridden here.
// Reusing the dialog readers is what keeps the two surfaces from drifting.
//
// ===========================================================================================
// MEASURED LIVE 2026-10-26 (scripts/probe-agent-profile-candidates-tab*.js), agent 1220 (3
// candidates), agent 1020 (17) and agent 1 (holds a deactivated candidate):
// ===========================================================================================
//
//   request   GET /agent/<id>/candidates/?page=<n>&page_size=10[&search=<term>]
//             plus two page_size=1 requests (one with is_active=true) that feed the profile's
//             counts - NOT the grid. Fired on every profile load, whatever the tab.
//   payload   the Candidates listing's own shape (full_name, email, is_verified,
//             pending_documents_count, subscription_status, last_login, account_status,
//             pending_email, ...), so CandidatesListingPage.candidatesFrom() reads it as is.
//   columns   [checkbox] | Candidate | Account Verification | Account Status |
//             Pending Documents | Subscription Status | Last Activity | Actions
//             (Account Verification carries a help-icon button in its header)
//   row       "Select candidate" checkbox; the name and email are buttons in the rowheader;
//             View | Edit | Open menu (testids admin-agent-profile-candidates-*-button)
//   menu      ACTIVE row: Reassign candidate | Deactivate
//             INACTIVE row: Reassign candidate | Reactivate - and Edit is DISABLED
//   search    testid admin-agent-profile-candidates-search-input, "Search by candidate
//             name...", server-side, debounced. NEITHER the term nor the page reaches the URL,
//             so a reload drops both. A whitespace-only term sends no request.
//   pager     "Previous Page" | "Page N" | "Next Page" (only when there is a second page);
//             a search from page 2 asks for page 1.
//
// >>> A DEACTIVATED CANDIDATE'S ACCOUNT STATUS READS "Inactive" HERE. <<< The Candidates
// listing renders the same record "Deactivated". This tab prints the API's raw word; recorded
// as a @known-issue, not normalised away here.

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The listing's lifecycle actions live in the row's "Open menu" here, under shorter names.
const MENU_ACTIONS = {
  'deactivate account': 'Deactivate',
  deactivate: 'Deactivate',
  'reactivate account': 'Reactivate',
  reactivate: 'Reactivate',
  'reassign candidate': 'Reassign candidate',
};

const GRID_REQUEST = /\/api\/v1\/agent\/\d+\/candidates\/\?/;
// The two count requests ask for page_size=1; only the grid's own request asks for a page.
const isGridRequest = (url) => GRID_REQUEST.test(url) && !/[?&]page_size=1(&|$)/.test(url);

class AgentProfileCandidatesPage extends CandidatesListingPage {
  constructor(page) {
    super(page);
    this.agentId = null;
    this.searchInput = page.locator(
      '[data-testid="admin-agent-profile-candidates-search-input"], main input[type="search"]',
    ).first();
    this.grid = page.locator('main [role="grid"]').first();
    this.reassignDialog = page.locator('[role="dialog"]').filter({ hasText: /reassign candidate/i }).first();
  }

  profileUrl(agentId = this.agentId) {
    if (!agentId) throw new Error('No agent has been chosen for the profile Candidates tab.');
    return `${this.origin}/agents/view/${agentId}?tab=candidates`;
  }

  // `tab` is accepted and ignored so the Edit Email steps, which pass the listing tab a record
  // was found on, can drive this surface unchanged. This tab has no sub-tabs.
  async goto(_tab, agentId = this.agentId) {
    if (agentId) this.agentId = agentId;
    return this.runAndWaitForList(async () => {
      await this.page.goto(this.profileUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    }, { timeout: 60000 });
  }

  async settle(timeout = 30000) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return { rows: 0, filled: 0, empty: false };
        const rows = Array.from(main.querySelectorAll('[role="row"]'))
          .filter((r) => !r.querySelector('[role="columnheader"]'));
        return {
          rows: rows.length,
          filled: rows.filter((r) => /@/.test(r.innerText || '')).length,
          empty: /no results found|no candidates yet/i.test(main.innerText || ''),
        };
      });
      if (last.filled > 0 || last.empty) return last;
      await this.page.waitForTimeout(300);
    }
    return last;
  }

  // Every grid answer the app receives, by its query. A query the app has already made is served
  // from its cache with NO request, so a search repeated in one scenario (the Edit Email steps
  // search before every open) would otherwise come back with no payload to assert on.
  watchResponses() {
    if (this._watching === this.page) return;
    this._watching = this.page;
    this._payloads = new Map();
    this.page.on('response', async (r) => {
      if (!isGridRequest(r.url()) || r.request().method() !== 'GET') return;
      const payload = await r.json().catch(() => null);
      if (payload) this._payloads.set(AgentProfileCandidatesPage.queryKey(r.url()), payload);
    });
  }

  static queryKey(url) {
    const u = new URL(url);
    return `${u.pathname}?page=${u.searchParams.get('page') || '1'}&search=${u.searchParams.get('search') || ''}`;
  }

  async runAndWaitForList(action, { timeout = 45000 } = {}) {
    this.watchResponses();
    const pending = this.page.waitForResponse(
      (r) => isGridRequest(r.url()) && r.request().method() === 'GET',
      { timeout },
    );
    await action();
    try {
      const response = await pending;
      const payload = await response.json().catch(() => null);
      await this.settle();
      return { requestUrl: response.url(), payload, requestFired: true };
    } catch {
      await this.settle();
      return { requestUrl: '', payload: null, requestFired: false };
    }
  }

  // The term is not written to the URL, so there is no address-bar fallback here. The box only
  // sends when its value CHANGES, so it is cleared first: re-typing the term already applied
  // would otherwise fire nothing and the read would be of the previous answer.
  async search(term) {
    const wanted = String(term);
    const current = await this.searchInput.inputValue().catch(() => '');
    if (current) {
      await this.runAndWaitForList(async () => { await this.searchInput.fill(''); }, { timeout: 12000 });
    }
    const result = await this.runAndWaitForList(async () => { await this.searchInput.fill(wanted); }, { timeout: 15000 });
    if (result.requestFired || !this.agentId) return result;
    const key = `/core/api/v1/agent/${this.agentId}/candidates/?page=1&search=${wanted.trim() ? wanted : ''}`;
    const cached = this._payloads && this._payloads.get(key);
    return { ...result, payload: cached || null, fromCache: Boolean(cached) };
  }

  rowLocator(needle) {
    return this.page.locator('main [role="row"]').filter({ hasText: String(needle) }).first();
  }

  async readRows() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main');
      return Array.from(main.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => {
          const header = r.querySelector('[role="rowheader"]');
          const lines = header ? String(header.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean) : [];
          return {
            text: c(r.innerText),
            name: lines.find((t) => !t.includes('@')) || '',
            email: lines.find((t) => t.includes('@')) || '',
            actions: Array.from(r.querySelectorAll('button'))
              .map((b) => c(b.getAttribute('aria-label')) || c(b.innerText)).filter(Boolean),
          };
        });
    });
  }

  // Every row read cell by cell and keyed by its COLUMN HEADER, so an added or reordered column
  // shows up as a wrong key rather than as every value being read one cell off.
  async readGrid() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const grid = document.querySelector('main [role="grid"]');
      if (!grid) return { columns: [], rows: [], masterCheckbox: null };
      const columns = Array.from(grid.querySelectorAll('[role="columnheader"]')).map((h) => c(h.innerText));
      const master = grid.querySelector('[role="columnheader"] input[type="checkbox"]');
      const rows = Array.from(grid.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => {
          const cells = Array.from(r.children);
          const byColumn = {};
          cells.forEach((cell, i) => { if (columns[i]) byColumn[columns[i]] = c(cell.innerText); });
          const header = r.querySelector('[role="rowheader"]');
          const lines = header ? String(header.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean) : [];
          const checkbox = r.querySelector('input[type="checkbox"]');
          return {
            name: lines.find((t) => !t.includes('@')) || '',
            email: lines.find((t) => t.includes('@')) || '',
            cells: byColumn,
            checkbox: checkbox ? checkbox.getAttribute('aria-label') : null,
            actions: Array.from(r.querySelectorAll('[role="gridcell"]:last-child button, td:last-child button'))
              .map((b) => ({
                label: c(b.getAttribute('aria-label')) || c(b.innerText),
                testid: b.getAttribute('data-testid'),
                disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
              })),
          };
        });
      return { columns, rows, masterCheckbox: master ? master.getAttribute('aria-label') : null };
    });
  }

  // ==================== The row's "Open menu" ====================

  async openRowMenu(needle) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.getByRole('button', { name: 'Open menu', exact: true }).first().click();
    const menu = this.page.locator('[role="menu"]').last();
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    return menu;
  }

  // The items are role="menuitemradio" (react-aria renders the menu with a selection mode), so
  // they are matched by the role PREFIX - a `getByRole('menuitem')` finds nothing.
  async readRowMenu(needle) {
    await this.openRowMenu(needle);
    const items = await this.page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]'))
      .map((e) => String(e.textContent || '').replace(/\s+/g, ' ').trim()));
    await this.page.keyboard.press('Escape');
    await this.page.locator('[role="menu"]').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    return items;
  }

  async chooseRowMenuItem(needle, item) {
    await this.openRowMenu(needle);
    await this.page.locator('[role="menu"] [role^="menuitem"]')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(item)}\\s*$`, 'i') }).first().click();
    await this.page.waitForTimeout(800);
  }

  // The listing's "Deactivate account" / "Reactivate Account" row buttons are menu items here,
  // so the inherited open*Dialog() methods route through the menu.
  async clickRowAction(needle, action) {
    const item = MENU_ACTIONS[String(action).trim().toLowerCase()];
    if (item) return this.chooseRowMenuItem(needle, item);
    return super.clickRowAction(needle, action);
  }

  // ==================== Reassign candidate (one row) ====================
  //
  // MEASURED: "Reassign Candidate" / "You’re reassigning <Name> from <Agent> to another agent
  // within the same university hub." / University Affiliation (a DISABLED select holding the
  // agent's university) / New Agent * (a combobox, "Select an agent") / Cancel | Reassign
  // (disabled until an agent is chosen) and an X "Close". Opening it fetches the university's
  // active agents: GET /agent/?university=<id>&status=ACTIVE&status=ATTENTION&page=1&page_size=10.

  async openReassignDialog(needle) {
    await this.chooseRowMenuItem(needle, 'Reassign candidate');
    await this.reassignDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(600);
  }

  async readReassignDialog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /reassign candidate/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const sel = d.querySelector('select');
      const confirm = Array.from(d.querySelectorAll('button')).find((b) => /^reassign$/i.test(c(b.innerText)));
      const picker = d.querySelector('input[role="combobox"], input[placeholder*="agent" i]');
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        text: c(d.innerText),
        university: sel ? c((sel.options[sel.selectedIndex] || {}).text) : null,
        universityDisabled: sel ? sel.disabled : null,
        pickerPlaceholder: picker ? picker.placeholder : null,
        pickerValue: picker ? picker.value : null,
        confirmDisabled: confirm ? confirm.disabled : null,
        buttons: Array.from(d.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      };
    });
  }

  async leaveReassignDialog(how) {
    const way = String(how).trim().toLowerCase();
    if (way === 'cancel') {
      await this.reassignDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    } else if (way === 'x icon') {
      await this.reassignDialog.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    } else if (way === 'escape') {
      await this.page.keyboard.press('Escape');
    } else {
      throw new Error(`Unknown way to leave the Reassign dialog: "${how}" (Cancel | X icon | Escape).`);
    }
    await this.reassignDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ==================== Pagination ====================
  //
  // The numbered controls are <button role="listitem" aria-label="Page N">, so they are found by
  // aria-label; a hidden duplicate set exists for narrow screens, hence :visible.

  prevButton() { return this.page.locator('main button[aria-label="Previous Page"]:visible').first(); }

  nextButton() { return this.page.locator('main button[aria-label="Next Page"]:visible').first(); }

  async readPager() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll('main button[aria-label$=" Page"], main button[aria-label^="Page "]'))
      .filter((b) => b.offsetParent)
      .map((b) => ({
        label: b.getAttribute('aria-label'),
        disabled: b.disabled,
        current: Boolean(b.getAttribute('aria-current')),
      })));
  }
}

AgentProfileCandidatesPage.isGridRequest = isGridRequest;
module.exports = AgentProfileCandidatesPage;
