const fs = require('fs');
const os = require('os');
const path = require('path');
const BasePage = require('./BasePage');

// One definition of "a data row": a grid row carrying a rowheader (the Date & Time cell). The
// header row has none, so this cannot count it — and a row count that silently includes the
// header reports an empty grid as holding one row.
const ROW = '[role="row"]:has([role="rowheader"])';

// A query string encodes a space as "+", which decodeURIComponent leaves alone - so a term like
// "super admin" read that way can never match "search=super admin". URLSearchParams semantics.
const decodeQuery = (q) => decodeURIComponent(String(q).replace(/\+/g, ' '));

// AuditLogsPage - Page Object for SuperAdmin Portal > Audit Logs.
//
// Selectors follow the project convention: layered from most-stable (data-testid) -> ARIA
// role/name -> semantic HTML -> structural class -> text fallback.
//
// >>> MEASURED LIVE 2026-09-14 (scripts/probe-audit-logs.js). Every string, URL param, API
// param and column name below was read off the running app. Re-run the probe rather than
// reasoning about the DOM. <<<
//
//   route            /audit-logs           (sidebar "Audit Logs")
//   list endpoint    GET /core/api/v1/analytics/admin/audit-logs/?page=&page_size=9
//   grid             role="grid", aria-label "Audit Logs"
//   columns          Date & Time | Action By | Action Type | Entity | Entity Name |
//                    Endpoint | Event Details | IP Address | Location | Actions
//   search           ?search=  (debounced ~1s), URL and API param IDENTICAL
//   filters          Entity (checkbox x4) + Last Activity (radio x4)
//   export           Export -> role="menu" with data-key="csv" / data-key="excel"
//   row action       "View log" -> a dialog titled "Log Details"; the URL does NOT change
//
// >>> FIVE MEASUREMENTS SHAPE EVERY LOCATOR HERE. READ THEM BEFORE CHANGING ANYTHING. <<<
//
//  1. (STALE since 2026-11-03: the search box, Filters, Export, View log and the pager now carry
//     admin-audit-logs-* / pagination-* test ids, and the locators below try them first.)
//     THERE WAS NOT ONE data-testid ON THE PAGE ITSELF. Not on the search box, the Filters
//     button, the Export button, the grid, a column header or a row. The only test ids in this
//     whole module are the six inside the filter modal. So every locator here is role- or
//     semantics-based by necessity, not by preference.
//  2. THE FILTER MODAL'S RADIO LABELS CARRY NO data-testid EITHER — only the four Entity
//     checkboxes do (`filters-entity-<slug>-checkbox`). A testid-only reader therefore sees 4 of
//     the 8 options and any assertion counting them passes having inspected half the modal.
//     readFilterOptions() walks every <label> in DOM order and selectFilterOption() clicks by
//     the index that same pass produced — one list, so the index a step reads is by construction
//     the index the click acts on. (The SuperAdmin Candidates modal was caught by exactly this.)
//  3. THE CHECKBOX LABELS NEED A REAL POINTER CLICK. They carry `data-react-aria-pressable` and
//     a scripted `element.click()` on them is a silent no-op — Apply then produces a URL with
//     the param missing, which reads as the app ignoring the filter.
//  4. THE EXPORT POPOVER IS ALSO role="dialog". It wraps a role="menu", so `getByRole('dialog')`
//     matches BOTH it and the filter modal. Every dialog locator here is filtered by the text
//     it owns, never taken as `.first()`.
//  5. THE ROW'S NAME / EMAIL / ENTITY CONTROLS ARE <button tabindex="-1">. They look
//     interactive and are not reachable by keyboard; only "View log" has tabIndex 0. Recorded
//     as a finding, and the reason no reader here treats them as navigable.
class AuditLogsPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/audit-logs`;

    // ---- Header / page identity ----
    // The page has no <h1> of its own — the shell's header renders "Audit Logs" and so does the
    // grid's accessible name. The GRID is the identity that matters, so it is what navigate()
    // waits on.
    this.pageHeading = page.getByRole('heading', { name: /^Audit Logs$/i }).first();

    // ---- Search ----
    // Placeholder is a bare "Search...", which says nothing about what it matches — see
    // SEARCHABLE_FIELDS. type="search" is the stable hook; the placeholder is a fallback only.
    // Test ids measured 2026-11-03 (admin-audit-logs-*); the role/semantic fallbacks stay behind them.
    this.searchInput = page.locator('[data-testid="admin-audit-logs-search-input"]')
      .or(page.locator('main input[type="search"], main [role="searchbox"], main input[placeholder="Search..."]'))
      .first();

    // ---- Filters ----
    // Scoped to <main>: the page shell renders its own buttons, and an unscoped
    // `button:has-text("Filters")` would be free to resolve to one of them.
    this.filtersButton = page.locator('[data-testid="admin-audit-logs-filters-button"]')
      .or(page.locator('main button:has-text("Filters")')).first();
    this.filterModal = page.getByRole('dialog').filter({ hasText: /Apply Filters/i }).first();
    this.applyFiltersButton = this.filterModal
      .locator('[data-testid="filters-apply-button"]')
      .or(this.filterModal.getByRole('button', { name: /^Apply Filters$/i }))
      .first();
    this.clearAllButton = this.filterModal
      .locator('[data-testid="filters-clear-all-button"]')
      .or(this.filterModal.getByRole('button', { name: /^Clear All$/i }))
      .first();
    this.cancelFiltersButton = this.filterModal.getByRole('button', { name: /^Cancel$/i }).first();
    this.closeFilterButton = this.filterModal.getByRole('button', { name: /^Close$/i }).first();

    // ---- Export ----
    this.exportButton = page.locator('[data-testid="admin-audit-logs-export-button"]')
      .or(page.locator('main button:has-text("Export")')).first();
    // The menu, not its dialog wrapper (see measurement 4).
    this.exportMenu = page.locator('[role="menu"]').filter({ hasText: /CSV/i }).first();

    // ---- Table ----
    // There is exactly one grid on this route. Deliberately NOT scoped by accessible name:
    // betting on a name is the kind of guess that reports a rendered table as absent.
    this.table = page.locator('[role="grid"]').first();
    this.rows = page.locator(ROW);

    // ---- Pagination ----
    // Scoped by name: the page shell's sidebar is also a <nav>, so an unnamed reader resolves
    // to "Analytics Agents Candidates Platform ..." and reports it as pagination.
    this.pagination = page.getByRole('navigation', { name: /Pagination/i }).first();

    // ---- Row action + its dialog ----
    this.viewLogButtons = page.locator('[data-testid="admin-audit-logs-view-button"]')
      .or(page.locator('main button[aria-label="View log"]'));
    this.logDetailsDialog = page.getByRole('dialog').filter({ hasText: /Log Details/i }).first();
  }

  // The ten columns the grid renders, in order. Asserted EXACTLY and in order, because the row
  // readers below address cells by `data-column-index` — an inserted column silently shifts
  // every index and a tolerant check would let every later assertion read the wrong cell.
  static COLUMNS = [
    'Date & Time', 'Action By', 'Action Type', 'Entity', 'Entity Name',
    'Endpoint', 'Event Details', 'IP Address', 'Location', 'Actions',
  ];

  // Column index of each field within a row, measured off `data-column-index`.
  static COL = {
    dateTime: 0, actionBy: 1, actionType: 2, entity: 3, entityName: 4,
    endpoint: 5, eventDetails: 6, ipAddress: 7, location: 8, actions: 9,
  };

  // >>> THE EXPORT CARRIES FIVE COLUMNS THE GRID DOES NOT, AND SPLITS A SIXTH IN TWO. <<<
  // Measured on both formats; the two files are byte-for-byte identical in their headers.
  //
  //   the ten on screen, minus "Actions" (a button column has nothing to export)
  //   + "Action By Email"  — the grid packs name AND email into the one Action By cell
  //   + "Headline"         — the raw event headline; usually equals Action Type, NOT always
  //                          (ADMIN_AGENT_INVITATION_SENT is headline "Agent Invitation Sent"
  //                           against action_type_label "Agent Invited")
  //   + "Description"      — the long prose form
  //   + "Event Type"       — the raw enum, e.g. ADMIN_COMMUNITY_CREATED
  //   + "Actor Name"       — DUPLICATES "Action By" on every row measured
  //   + "Metadata"         — the whole metadata object as JSON
  static EXPORT_COLUMNS = [
    'Date & Time', 'Action By', 'Action By Email', 'Action Type', 'Entity', 'Entity Name',
    'Endpoint', 'Event Details', 'IP Address', 'Location',
    'Headline', 'Description', 'Event Type', 'Actor Name', 'Metadata',
  ];

  // The columns the export adds on top of what the grid shows. Kept as its own list so a
  // scenario can assert the ADDITION specifically — that is the part of the requirement a plain
  // "the header matches" check states only implicitly.
  static EXPORT_EXTRA_COLUMNS = [
    'Action By Email', 'Headline', 'Description', 'Event Type', 'Actor Name', 'Metadata',
  ];

  // The two filter groups, in render order, with the control type each uses. The type is
  // recorded because it decides what a SECOND selection in the group means: a checkbox adds,
  // a radio REPLACES. A "two options in one group" scenario aimed at Last Activity would be
  // asserting behaviour the control cannot have, so it is aimed at Entity.
  static FILTER_GROUPS = [
    {
      name: 'Entity',
      control: 'checkbox',
      options: ['Agent', 'Candidate', 'Configuration', 'Community'],
    },
    {
      name: 'Last Activity',
      control: 'radio',
      options: ['Last 24 hours', 'Last 7 days', 'Last 30 days', 'Inactive (30+ days)'],
    },
  ];

  // Each option's URL param and the API param it produces.
  //
  // >>> ENTITY IS LOWERCASED IN THE URL AND CAPITALISED ON THE WIRE. <<< `?entity=agent`
  // becomes `entity=Agent`. Last Activity uses the same value in both. That is why the filter
  // table asserts BOTH: checking only the URL would pass on a front end that rewrites the
  // address bar and queries the server for something else, and this app really does transform
  // one of the two.
  static FILTER_PARAMS = {
    Agent: { url: 'entity=agent', api: 'entity=Agent' },
    Candidate: { url: 'entity=candidate', api: 'entity=Candidate' },
    Configuration: { url: 'entity=configuration', api: 'entity=Configuration' },
    Community: { url: 'entity=community', api: 'entity=Community' },
    'Last 24 hours': { url: 'last_activity=24h', api: 'last_activity=24h' },
    'Last 7 days': { url: 'last_activity=7d', api: 'last_activity=7d' },
    'Last 30 days': { url: 'last_activity=30d', api: 'last_activity=30d' },
    'Inactive (30+ days)': { url: 'last_activity=inactive', api: 'last_activity=inactive' },
  };

  // The fields the search matches, and the two visible columns it does NOT.
  //
  // Measured by counting results per term against a 2236-row baseline: Endpoint ("/communities")
  // and Event Details ("invite_status") each return ZERO while being plainly on screen. That is
  // the documented scope, so the negative half is asserted deliberately — a search that
  // silently widened to every column would otherwise go unnoticed.
  static SEARCHABLE_FIELDS = ['Action By', 'Action By Email', 'Action Type', 'Entity Name', 'IP Address', 'Location'];

  static NON_SEARCHABLE_FIELDS = ['Endpoint', 'Event Details'];

  // >>> THREE EMPTY STATES, WORDED DIFFERENTLY, AND THEY ARE NOT INTERCHANGEABLE. <<<
  // All three share the heading, so a reader keying on the heading alone cannot tell which one
  // it is looking at — and the whole point of the empty-state coverage is that the app names
  // whichever of search and filters is actually active. Note only two of the three offer a CTA.
  static EMPTY_STATES = {
    search: {
      heading: 'No results found',
      body: "We couldn't find any logs matching your search.",
      clearCta: false,
    },
    filters: {
      heading: 'No results found',
      body: "We couldn't find any logs matching your selected filters.",
      clearCta: true,
    },
    both: {
      heading: 'No results found',
      body: "We couldn't find any logs matching your search and filters.",
      clearCta: true,
    },
  };

  // >>> EVERY LIST REQUEST IS RECORDED FROM THE MOMENT THE SCENARIO STARTS. <<<
  //
  // `install()` is called once per scenario (from hooks.js / PagesFixture.js, the same way
  // InProgressCandidatePage and RequiresAttentionPage are) rather than each action capturing its
  // own request. Two reasons, and the second is what forced it:
  //
  //  1. Several assertions read the query the app sent for an action taken SEVERAL steps
  //     earlier — "the request should have carried entity=Agent" after a later search.
  //  2. SOME ACTIONS HERE CORRECTLY FIRE NO REQUEST AT ALL. A whitespace-only search sends
  //     nothing (measured), and so does opening the View log dialog. A `waitForRequest` for
  //     those resolves to null and reads identically to a timeout, a slow network or a broken
  //     listener. A running log distinguishes "nothing was sent" from "something was sent and I
  //     missed it" — and here "nothing was sent" is the assertion, not the failure.
  //
  // The log is never reset mid-scenario; steps take an index baseline instead, so a step can ask
  // what the app sent AFTER a point without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.lastServerCount = null;
    // The server's own total for the latest listing response - the grid caps at page_size, so two
    // results larger than one page look identical on screen.
    this.page.on('response', async (res) => {
      if (res.request().method() !== 'GET') return;
      if (!/\/analytics\/admin\/audit-logs\/\?/.test(res.url()) || /export=/.test(res.url())) return;
      // The body is kept too, so a step can compare every rendered cell with the row the server sent.
      try {
        const j = await res.json();
        if (j && typeof j.count === 'number') { this.lastServerCount = j.count; this.lastPayload = j; }
      } catch (_) { /* not JSON */ }
    });
    this.page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      if (!/\/analytics\/admin\/audit-logs\//.test(req.url())) return;
      this.requests.push({
        at: Date.now(),
        url: req.url(),
        query: decodeQuery(req.url().split('/audit-logs/')[1] || ''),
      });
    });
  }

  requestCount() {
    return (this.requests || []).length;
  }

  lastRequestQuery() {
    const log = this.requests || [];
    return log.length ? log[log.length - 1].query : null;
  }

  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline).map((r) => r.query);
  }

  // The page_size the app asked for, read off its own request rather than hardcoded.
  //
  // It is 9 today and it is NOT viewport-derived (same value at 1600x950 and 1280x720), but a
  // scenario that hardcodes 9 asserts a layout decision rather than a behaviour, and goes red on
  // a harmless change. Reading it back means "the grid shows no more rows than were asked for"
  // stays true whatever the app picks.
  requestedPageSize() {
    const q = this.lastRequestQuery();
    const m = q && q.match(/page_size=(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // ---------------------------------------------------------------- navigation

  async navigate(query = '') {
    this.install();
    await super.navigate(this.url + query);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.settleRows();
  }

  // >>> THE GRID PAINTS BEFORE ITS ROWS DO, SO A ROW READ TAKEN ON ARRIVAL RETURNS ZERO. <<<
  // The settle keys on the Date & Time rowheader holding a real timestamp: the cell renders as
  // two stacked <div>s (date, then time) and populates a tick after the row skeleton, so the row
  // existing is not the row having content.
  //
  // It resolves on rows OR an empty state, so a query matching nothing does not hang — and a
  // timeout is not an error here, because "neither" is itself reportable.
  async settleRows(timeout = 25000) {
    const which = await Promise.race([
      this.rows.first().waitFor({ state: 'visible', timeout }).then(() => 'rows'),
      this.emptyStateHost().waitFor({ state: 'visible', timeout }).then(() => 'empty'),
    ]).catch(() => 'neither');

    if (which === 'rows') {
      await this.page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(`${sel} [role="rowheader"]`);
            return !!el && /\d{2}-\d{2}-\d{4}/.test(el.innerText || '');
          },
          ROW,
          { timeout }
        )
        .catch(() => {});
    }
    return which;
  }

  // ---------------------------------------------------------------- reading the grid

  async columnHeaders() {
    return this.page
      .locator('[role="columnheader"]')
      .evaluateAll((els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()));
  }

  async rowCount() {
    return this.rows.count();
  }

  // Every rendered row as a field object, addressed by `data-column-index` rather than by
  // position among the cells. Positional reads break the moment a cell is omitted; the index is
  // what the app itself stamps.
  async readRows() {
    return this.rows.evaluateAll((rows, COL) =>
      rows.map((r) => {
        const cell = (i) => {
          const c = r.querySelector(`[data-column-index="${i}"]`);
          return c ? (c.innerText || '').replace(/\s+/g, ' ').trim() : '';
        };
        // Action By packs a name and an email into one cell as two buttons; split them so a
        // search assertion can say WHICH of the two matched.
        const actionByCell = r.querySelector(`[data-column-index="${COL.actionBy}"]`);
        const parts = actionByCell
          ? [...actionByCell.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean)
          : [];
        return {
          dateTime: cell(COL.dateTime),
          actionBy: parts[0] || '',
          actionByEmail: parts.find((p) => p.includes('@')) || '',
          actionType: cell(COL.actionType),
          entity: cell(COL.entity),
          entityName: cell(COL.entityName),
          endpoint: cell(COL.endpoint),
          eventDetails: cell(COL.eventDetails),
          ipAddress: cell(COL.ipAddress),
          location: cell(COL.location),
        };
      }),
    AuditLogsPage.COL);
  }

  // ---------------------------------------------------------------- empty state

  // Deliberately narrow: "No results found" and nothing looser. Matching on the word "No" alone
  // would also hit the grid header and the filter modal.
  emptyStateHost() {
    return this.page.locator('main').getByText(/No results found/i).first();
  }

  // The empty state's two lines and whether it offers the Clear CTA, or null when the grid is
  // showing rows.
  //
  // RE-READS EVERY TIME. A cached snapshot would let the scenario that asserts one wording, adds
  // a search, and asserts a second pass no matter what the app rendered — which is precisely the
  // scenario this module has.
  async readEmptyState() {
    const host = this.emptyStateHost();
    if (!(await host.isVisible().catch(() => false))) return null;
    const text = await host
      .evaluate((el) => {
        let node = el;
        for (let i = 0; i < 5 && node.parentElement; i += 1) {
          node = node.parentElement;
          const t = (node.innerText || '').trim();
          if (t.split('\n').filter(Boolean).length >= 2 && t.length < 400) return t;
        }
        return (el.innerText || '').trim();
      })
      .catch(() => '');
    const lines = text.split('\n').map((t) => t.trim()).filter(Boolean);
    return {
      heading: lines[0] || '',
      body: lines.slice(1).filter((l) => !/^Clear all filters$/i.test(l)).join(' '),
      clearCta: await this.clearAllFiltersCta().isVisible().catch(() => false),
      lines,
    };
  }

  // The CTA the empty state offers. NOT the modal's "Clear All" — a different control with a
  // different label in a different place, and scoping to <main> is what keeps them apart.
  clearAllFiltersCta() {
    return this.page.locator('main').getByRole('button', { name: /^Clear all filters$/i }).first();
  }

  // ---------------------------------------------------------------- search

  // Type a term and wait out the ~1s debounce plus the round trip.
  //
  // The wait is on the REQUEST COUNT changing, not a fixed sleep — except that a term the app
  // declines to send (whitespace) never changes it, so the wait is bounded and its expiry is a
  // legitimate outcome rather than a failure. The caller decides which it wanted.
  async search(term, { settle = true } = {}) {
    const before = this.requestCount();
    await this.searchInput.fill(term);
    // Poll our own log rather than the page: the request may legitimately never come.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && this.requestCount() === before) {
      await this.page.waitForTimeout(150);
    }
    if (settle) await this.settleRows(20000);
    // Give the grid a beat to repaint after the response lands.
    await this.page.waitForTimeout(400);
    return this.requestCount() > before;
  }

  async searchValue() {
    return this.searchInput.inputValue();
  }

  async clearSearch() {
    await this.search('');
  }

  // ---------------------------------------------------------------- filters

  async openFilters() {
    await this.filtersButton.click();
    await this.filterModal.waitFor({ state: 'visible', timeout: 15000 });
  }

  async closeFilters() {
    if (await this.cancelFiltersButton.isVisible().catch(() => false)) {
      await this.cancelFiltersButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  // Every option in the modal, in DOM order, with its group, control type and checked state.
  //
  // >>> WALKS <label>, NOT [data-testid]. <<< Only the four Entity checkboxes carry a test id;
  // the four Last Activity radios carry none, so a testid-only pass returns half the modal and
  // an assertion counting options passes having inspected four of eight.
  async readFilterOptions() {
    return this.filterModal.locator('label').evaluateAll((labels) =>
      labels.map((l, index) => {
        const input = l.querySelector('input');
        // The group is the nearest preceding <p> that is not inside a label — the modal renders
        // "Entity" and "Last Activity" as plain paragraphs above their option blocks.
        let group = '';
        let node = l.parentElement;
        while (node && !group) {
          const p = node.querySelector('p');
          if (p && !p.closest('label')) group = (p.innerText || '').trim();
          node = node.parentElement;
        }
        return {
          index,
          text: (l.innerText || '').replace(/\s+/g, ' ').trim(),
          control: input ? input.type : 'unknown',
          checked: input ? !!input.checked : false,
          group,
          hasTestId: !!l.getAttribute('data-testid'),
        };
      })
    );
  }

  // Select one option by its exact label.
  //
  // Clicks by the index `readFilterOptions()` produced, through a REAL Playwright pointer click:
  // these labels carry `data-react-aria-pressable` and ignore a scripted `element.click()`
  // entirely — Apply then produces a URL with the param missing, which reads as the app
  // discarding the filter.
  async selectFilterOption(label) {
    const options = await this.readFilterOptions();
    const want = String(label).trim().toLowerCase();
    const match = options.find((o) => o.text.toLowerCase() === want);
    if (!match) {
      throw new Error(
        `No filter option exactly named "${label}" in the modal. Options offered: `
        + JSON.stringify(options.map((o) => o.text))
      );
    }
    await this.filterModal.locator('label').nth(match.index).click();
    await this.page.waitForTimeout(200);
    return match;
  }

  async applyFilters() {
    const before = this.requestCount();
    await this.applyFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && this.requestCount() === before) {
      await this.page.waitForTimeout(150);
    }
    await this.settleRows(20000);
    await this.page.waitForTimeout(300);
    return this.requestCount() > before;
  }

  async clearAllInModal() {
    await this.clearAllButton.click();
    await this.page.waitForTimeout(300);
  }

  // The applied-filter count the Filters button shows, or 0 when it shows none.
  //
  // >>> THIS BADGE COUNTS OPTIONS, NOT GROUPS. <<< Two Entity options plus one Last Activity
  // reads "3". The Requires Attention listing's identical-looking badge counts GROUPS, so the
  // two surfaces genuinely disagree about what the number means. Asserted as measured on each,
  // never reconciled — see the note in the feature file.
  async appliedFilterCount() {
    const txt = (await this.filtersButton.innerText().catch(() => '')) || '';
    const m = txt.replace(/\s+/g, ' ').match(/Filters\s*(\d+)/i);
    return m ? Number(m[1]) : 0;
  }

  // ---------------------------------------------------------------- export

  async openExportMenu() {
    await this.exportButton.click();
    await this.exportMenu.waitFor({ state: 'visible', timeout: 15000 });
  }

  // The formats the menu offers, in order.
  async readExportOptions() {
    return this.exportMenu
      .locator('[role="menuitemradio"], [role="menuitem"]')
      .evaluateAll((els) =>
        els.map((e) => ({
          text: (e.innerText || '').replace(/\s+/g, ' ').trim(),
          key: e.getAttribute('data-key') || '',
        }))
      );
  }

  async closeExportMenu() {
    await this.page.keyboard.press('Escape');
    await this.exportMenu.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  // Export in one format and return { filePath, suggestedFilename, requestUrl }.
  //
  // The DOWNLOAD and the REQUEST are captured together on purpose. A download alone proves only
  // that bytes arrived — it cannot say whether the export carried the search and filters that
  // were on screen, which is the requirement. Capturing the request URL is what makes
  // "the export asked the server for what I was looking at" checkable.
  async exportAs(format) {
    const key = /excel|xlsx/i.test(format) ? 'excel' : 'csv';
    await this.openExportMenu();

    const requestPromise = this.page
      .waitForRequest((r) => /\/analytics\/admin\/audit-logs\/.*export=/.test(r.url()), { timeout: 45000 })
      .catch(() => null);
    const downloadPromise = this.page.waitForEvent('download', { timeout: 60000 });

    const item = this.exportMenu.locator(`[role="menuitemradio"][data-key="${key}"]`);
    if (await item.count()) await item.first().click();
    else await this.exportMenu.getByText(key === 'excel' ? /Excel/i : /^CSV$/i).first().click();

    const download = await downloadPromise;
    const request = await requestPromise;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-audit-export-'));
    const suggested = download.suggestedFilename();
    const filePath = path.join(dir, suggested);
    await download.saveAs(filePath);

    return {
      filePath,
      suggestedFilename: suggested,
      requestUrl: request ? request.url() : null,
      requestQuery: request ? decodeQuery(request.url().split('/audit-logs/')[1] || '') : null,
      bytes: fs.statSync(filePath).size,
    };
  }

  // ---------------------------------------------------------------- View log

  async openLogDetails(index = 0) {
    await this.viewLogButtons.nth(index).click();
    await this.logDetailsDialog.waitFor({ state: 'visible', timeout: 15000 });
  }

  // The dialog's fields as { label: value }.
  //
  // Derived from the label/value <p> pairs the dialog renders, NOT from position: the dialog
  // omits three of the grid's columns (Endpoint, IP Address, Location), so counting to a field
  // would silently read the wrong one.
  async readLogDetails() {
    const raw = await this.logDetailsDialog.evaluate((d) => {
      const out = {};
      const sections = [];
      // Each field is a small block holding a label <p> and a value node beneath it.
      d.querySelectorAll('p').forEach((p) => {
        const label = (p.innerText || '').trim();
        if (!label || label.length > 40) return;
        const host = p.parentElement;
        if (!host) return;
        const text = (host.innerText || '').trim();
        const lines = text.split('\n').map((t) => t.trim()).filter(Boolean);
        if (lines.length === 2 && lines[0] === label) out[label] = lines[1];
      });
      d.querySelectorAll('p').forEach((p) => {
        const t = (p.innerText || '').trim();
        if (/^(Entity Information|Event Details)$/i.test(t)) sections.push(t);
      });
      return { fields: out, sections, title: (d.querySelector('h2') || {}).innerText || '' };
    });
    return raw;
  }

  async closeLogDetails() {
    await this.page.keyboard.press('Escape');
    await this.logDetailsDialog.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  // >>> "NOT VISIBLE" IS ALSO TRUE OF A DIALOG THE APP HAS NOT RENDERED YET. <<<
  // So an absence assertion watches a window rather than sampling once — the distinction
  // `saveStaysDisabled()` exists to make in the promo module.
  async dialogStaysClosed(ms = 3000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.logDetailsDialog.isVisible().catch(() => false)) return false;
      await this.page.waitForTimeout(200);
    }
    return true;
  }

  // ---------------------------------------------------------------- pagination

  nextPageButton() {
    return this.pagination.getByRole('button', { name: /Next/i }).first();
  }

  previousPageButton() {
    return this.pagination.getByRole('button', { name: /Previous/i }).first();
  }

  async goToNextPage() {
    await this.nextPageButton().click();
    await this.settleRows(20000);
    await this.page.waitForTimeout(300);
  }
}

module.exports = AuditLogsPage;
