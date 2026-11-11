const BasePage = require('./BasePage');

// One definition of "a data row": a grid row carrying a rowheader (the Candidate cell). The
// header row has none, so this cannot count it.
const ROW = '[role="row"]:has([role="rowheader"])';

// RequiresAttentionPage - Page Object for Agent Portal > Candidates > Requires Attention.
//
// Selectors follow the project convention: layered from most-stable (data-testid) -> ARIA
// role/name -> semantic HTML -> structural class -> text fallback.
//
// >>> MEASURED LIVE 2026-09-09 (scripts/probe-requires-attention.js and -2.js). Every string,
// URL param and API param below was read off the running app, never inferred from the Active
// tab next to it - the two surfaces differ in five places, and each difference has already
// produced a wrong assertion somewhere in this repo. <<<
//
//   URL              /candidates/requires-attention  -> redirects to ?activeFilter=all
//   heading          "Candidates - Requires Attention"
//   quick filters    activeFilter = all | warning | critical
//   columns          Candidate | Issue | Severity | Last Activity | Actions
//   search           ?search=<term>  (debounced ~1s); matches candidate NAME **and EMAIL**
//   row actions      View (eye) -> /candidates/<id>/view-profile/?selectedTab=candidate-details
//                    Reminder History -> a dialog; the URL does NOT change
//   list endpoint    GET /core/api/v1/candidate/requires-attention/
//
// FIVE DIFFERENCES FROM THE ACTIVE TAB, all of them load-bearing:
//
//  1. There is NO bell / Send Reminder control here. The only two row actions are View and
//     Reminder History, so nothing in this module can send a reminder - which is why every
//     scenario against it is read-only and safe in the default run.
//  2. The three filter groups are its OWN (Severity, Issue Category, Last Activity) and none of
//     the Active tab's four appear.
//  3. Last Activity is a RADIO group and its labels carry NO data-testid, where the other two
//     groups are checkboxes that do. A testid-only reader therefore sees 5 of the 9 options and
//     any assertion counting them passes having inspected five. Hence readFilterOptions() walks
//     every <label> in the dialog in DOM order, and selectFilterOption() clicks by the index that
//     same pass produced - one list, so the index a step reads is the index the click acts on.
//     (The SuperAdmin Candidates filter modal was caught by exactly this.)
//  4. Last Activity is NOT sent as a param at all: the app translates the choice into
//     `last_updated_after=`/`last_updated_before=` ISO timestamps. So its URL value
//     (`lastUpdated=7days`) and its API shape have nothing in common, and an assertion expecting
//     `last_activity=` on the wire would fail against a filter that works correctly.
//  5. THERE ARE TWO DIFFERENT EMPTY STATES with different wording - a per-tab one ("No warnings
//     at the moment") and a search/filter one ("No results found"). See EMPTY_STATES.
class RequiresAttentionPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/candidates/requires-attention`;

    // ---- Header / page identity ----
    // Re-measured 2026-10-05: the <h1> now reads just "Candidates" (it read "Candidates - Requires
    // Attention" until then). Waiting for the old wording took 60s on every navigation and timed
    // out the Background of every scenario. Both forms are accepted; the route itself is asserted
    // separately by the heading step, since "Candidates" alone no longer names the tab.
    this.pageHeading = page
      .getByRole('heading', { name: /^\s*Candidates(\s*-\s*Requires\s*Attention)?\s*$/i })
      .first();

    // ---- Search ----
    // The placeholder reads "Search by candidate name..." but the search matches an EMAIL too
    // (measured). The placeholder is kept only as a locator fallback, never as an assertion.
    this.searchInput = page
      .locator(
        '[data-testid="agent-candidates-search-input"], input[placeholder*="Search by candidate" i], input[type="search"], [role="searchbox"]'
      )
      .first();

    // ---- Quick filter tabs (a radiogroup) ----
    this.quickFilters = page.locator('[role="radiogroup"]').first();

    // ---- Filters button + modal ----
    this.filtersButton = page
      .locator('[data-testid="agent-candidates-filters-button"], button:has-text("Filters")')
      .first();
    this.filterModal = page.getByRole('dialog').filter({ hasText: /Apply Filters/i }).first();
    this.applyFiltersButton = this.filterModal.getByRole('button', { name: /^Apply Filters$/i }).first();
    this.clearAllButton = this.filterModal.getByRole('button', { name: /^Clear All$/i }).first();
    this.cancelFiltersButton = this.filterModal.getByRole('button', { name: /^Cancel$/i }).first();
    this.closeFilterButton = this.filterModal.getByRole('button', { name: /^Close$/i }).first();

    // ---- Table ----
    // Deliberately NOT scoped by accessible name: the Active tab's grid is named "Candidates"
    // and betting on the same name here is the kind of guess that reports a rendered table as
    // absent. There is exactly one grid on this route.
    this.table = page.locator('[role="grid"]').first();

    // ---- Pagination ----
    // Scoped by name: the page shell's own sidebar is also a <nav>, so an unnamed reader
    // resolves to "Dashboard Candidates Active In Progress ..." and reports it as pagination.
    this.pagination = page.getByRole('navigation', { name: /Pagination/i }).first();

    // ---- Row actions ----
    this.viewButtons = page.locator(
      '[data-testid="agent-candidates-view-button"], button[aria-label="View"]'
    );
    this.reminderHistoryButtons = page.locator(
      '[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]'
    );

    // ---- Reminder History dialog ----
    this.reminderHistoryPanel = page
      .getByRole('dialog')
      .filter({ hasText: /Reminder History/i })
      .first();

    // Quick-filter label -> its data-testid slug and its activeFilter URL value.
    this.tabTestIds = {
      all: 'agent-candidates-requires-attention-filter-all',
      warning: 'agent-candidates-requires-attention-filter-warning',
      critical: 'agent-candidates-requires-attention-filter-critical',
    };
  }

  // The three filter groups, in the order the modal renders them, with the control type each
  // uses. The type is recorded because it decides what a second selection in the group MEANS:
  // a checkbox adds, a radio REPLACES - so a "two options in one group" scenario aimed at Last
  // Activity would be asserting behaviour the control cannot have.
  // Re-measured 2026-10-05: the Severity group was REMOVED (severity is chosen by the tab strip
  // only), and "Last Activity" became "Last Updated" - now a multi-select CHECKBOX group with test
  // ids (filters-lastUpdated-<v>-checkbox) that sends the WIDEST chosen window.
  static FILTER_GROUPS = [
    { name: 'Issue Category', control: 'checkbox', options: ['Payment', 'Progress', 'Documents'] },
    {
      name: 'Last Updated',
      control: 'checkbox',
      options: ['Last 24 hours', 'Last 3 days', 'Last 7 days', 'Last 30 days'],
    },
  ];

  // The two empty states, verbatim (measured 2026-09-09). They are NOT interchangeable: the
  // per-tab one describes the tab having no candidates, the results one describes a query
  // matching none. A single reader looking for "No results found" answers "absent" on an empty
  // Warning tab, which reads as the empty state being missing.
  static EMPTY_STATES = {
    warning: {
      heading: 'No warnings at the moment',
      body: 'Candidates with minor issues that need attention will appear here.',
    },
    results: {
      heading: 'No results found',
      body: "We couldn't find any results matching your current search.",
    },
  };

  // >>> EVERY LIST REQUEST IS RECORDED FROM THE MOMENT THE SCENARIO STARTS. <<<
  //
  // `install()` is called once per scenario (from hooks.js / PagesFixture.js, the same way
  // InProgressCandidatePage is installed) rather than each action capturing its own request.
  // Two reasons, and the second is what forced it:
  //
  //  1. Several assertions read the query the app sent for an action taken SEVERAL steps
  //     earlier - "the request the app sent should carry severity=critical" after a search, for
  //     instance. A per-action capture cannot answer that.
  //  2. THE DEFECT THIS MODULE EXISTS TO CATCH IS AN ACTION THAT FIRES NO REQUEST AT ALL.
  //     Applying a Severity filter on a severity tab sends nothing, so a `waitForRequest` there
  //     resolves to null and reads identically to a timeout, a slow network or a broken
  //     listener. A running log distinguishes "nothing was sent" from "something was sent and I
  //     missed it", which is the whole finding.
  //
  // The log is never reset mid-scenario; steps take an index baseline instead, so a step can ask
  // "what did the app send AFTER this point" without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      if (!/\/candidate\/requires-attention\//.test(req.url())) return;
      this.requests.push({
        at: Date.now(),
        url: req.url(),
        query: decodeURIComponent(req.url().split('/requires-attention/')[1] || ''),
      });
    });
  }

  requestCount() {
    return (this.requests || []).length;
  }

  // The most recent list request's query string, or null if none has been made.
  lastRequestQuery() {
    const log = this.requests || [];
    return log.length ? log[log.length - 1].query : null;
  }

  // Every request made since `baseline` (an index from requestCount()).
  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline).map((r) => r.query);
  }

  async navigate() {
    this.install();
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    // Bounded well inside the 60s step budget, together with settleRows() below.
    await this.pageHeading.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await this.settleRows();
  }

  // >>> THE GRID PAINTS BEFORE ITS ROWS DO, SO A ROW READ TAKEN ON ARRIVAL RETURNS ZERO. <<<
  // Measured: a read 4s after domcontentloaded reported 0 rows on a tab that holds 10, twice.
  // The settle keys on '@' appearing in the first candidate cell - the cell renders as two
  // React-Aria <button><span> lines and populates a tick after the row skeleton, so the row
  // existing is not the same as the row having content. An EMPTY tab must not hang here, so a
  // timeout is not an error: it is resolved by whichever of rows-or-empty-state arrives.
  async settleRows(timeout = 20000) {
    const rowOrEmpty = Promise.race([
      this.page.locator(ROW).first().waitFor({ state: 'visible', timeout }).then(() => 'rows'),
      this.emptyStateHost().waitFor({ state: 'visible', timeout }).then(() => 'empty'),
    ]).catch(() => 'neither');
    const which = await rowOrEmpty;
    if (which === 'rows') {
      await this.page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(`${sel} [role="rowheader"]`);
            return !!el && el.innerText.includes('@');
          },
          ROW,
          { timeout }
        )
        .catch(() => {});
    }
    return which;
  }

  // The element either empty state renders into. Matched on the two measured headings rather
  // than on a class, and deliberately not on the word "No" alone - the grid header row and the
  // filter modal both contain it.
  emptyStateHost() {
    return this.page
      .getByText(/No results found|No warnings at the moment|No critical issues/i)
      .first();
  }

  // Both empty-state lines as the page renders them, or null when neither is on screen.
  // Re-reads every time: a cached snapshot would let a scenario that asserts one wording, adds
  // a search, and asserts the second pass no matter what the app did.
  async readEmptyState() {
    const host = this.emptyStateHost();
    if (!(await host.isVisible().catch(() => false))) return null;
    // Climb to the smallest ancestor that carries a second line of text, so the body sentence
    // is captured without swallowing the whole page.
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
    return { heading: lines[0] || '', body: lines.slice(1).join(' '), lines };
  }

  // ---------------------------------------------------------------- tabs

  async clickTab(label) {
    const key = label.trim().toLowerCase();
    const testId = this.tabTestIds[key];
    if (testId) {
      const byTestId = this.page.locator(`[data-testid="${testId}"]`);
      if (await byTestId.count()) {
        await byTestId.first().click();
        await this.settleRows(12000);
        await this.page.waitForTimeout(500);
        return;
      }
    }
    await this.quickFilters.getByText(new RegExp(`^${label}$`, 'i')).first().click();
    await this.settleRows(12000);
    await this.page.waitForTimeout(500);
  }

  // Switch tab and hand back the list the SERVER returned for it, so a scenario can assert
  // against the payload rather than against rows the grid may not have repainted yet - the grid
  // keeps the previous query's rows while the next is in flight.
  async clickTabCapturingList(label, timeout = 45000) {
    const response = this.page.waitForResponse(
      (r) =>
        /\/candidate\/requires-attention\//.test(r.url()) && r.request().method() === 'GET' && r.ok(),
      { timeout }
    );
    await this.clickTab(label);
    const body = await (await response).json().catch(() => ({}));
    return body.results || body.data || [];
  }

  async isTabActive(label) {
    const key = label.trim().toLowerCase();
    if (this.page.url().toLowerCase().includes(`activefilter=${key}`)) return true;
    const testId = this.tabTestIds[key];
    if (testId) {
      const el = this.page.locator(`[data-testid="${testId}"]`).first();
      if (await el.count()) {
        if ((await el.getAttribute('aria-checked')) === 'true') return true;
        if ((await el.getAttribute('data-selected')) !== null) return true;
      }
    }
    const radio = this.quickFilters.getByRole('radio', { name: new RegExp(label, 'i') }).first();
    if (await radio.count()) return (await radio.getAttribute('aria-checked')) === 'true';
    return false;
  }

  async tabLabels() {
    return this.quickFilters.evaluate((g) =>
      [...g.querySelectorAll('[role="radio"], label')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
    );
  }

  // ---------------------------------------------------------------- search

  async search(term) {
    await this.searchInput.fill(term);
    await this.page.waitForTimeout(1400); // debounced, then reflected in ?search=
    await this.settleRows(12000);
  }

  async clearSearch() {
    await this.searchInput.fill('');
    await this.page.waitForTimeout(1400);
    await this.settleRows(12000);
  }

  async getSearchValue() {
    return this.searchInput.inputValue();
  }

  async searchPlaceholder() {
    return (await this.searchInput.getAttribute('placeholder')) || '';
  }

  // ---------------------------------------------------------------- rows

  async rowCount() {
    return this.page.locator(ROW).count();
  }

  // Every visible row's Candidate cell as "name email", in ONE $$eval so the list cannot detach
  // mid-iteration while the grid re-renders.
  //
  // innerText, never textContent: the cell holds no <p> (the name and email are each a
  // React-Aria <button><span>) and textContent runs the two lines together with no separator,
  // so a term straddling the name/email boundary would match text no row displays.
  async visibleRowHeaders() {
    return this.page.$$eval(`${ROW} [role="rowheader"]`, (els) =>
      els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
    );
  }

  // Name + email of the first data row.
  async firstCandidate() {
    await this.settleRows();
    const headers = await this.visibleRowHeaders();
    if (!headers.length) throw new Error('The Requires Attention grid rendered no candidate rows.');
    const lines = headers[0].split(' ').filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = lines.find((t) => emailRe.test(t)) || '';
    const name = lines.filter((t) => !emailRe.test(t)).join(' ').trim();
    if (!email) {
      throw new Error(
        `The first candidate row exposed no email address. Candidate cell read: ${JSON.stringify(headers[0])}`
      );
    }
    return { name, email };
  }

  // Every row as {name, email, issue, severity, lastActivity} plus its two action controls.
  // gridcell order (the Candidate column is a rowheader, not a gridcell):
  //   0 = Issue, 1 = Severity, 2 = Last Activity, 3 = Actions
  async readRows() {
    return this.page.$$eval(ROW, (rows) =>
      rows.map((r) => {
        const header = r.querySelector('[role="rowheader"]');
        const lines = ((header && header.innerText) || '')
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean);
        const cells = [...r.querySelectorAll('[role="gridcell"]')].map((c) =>
          (c.innerText || '').replace(/\s+/g, ' ').trim()
        );
        const state = (sel) => {
          const el = r.querySelector(sel);
          return el
            ? {
              present: true,
              disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
              label: el.getAttribute('aria-label'),
            }
            : { present: false, disabled: null, label: null };
        };
        return {
          name: lines.find((t) => !t.includes('@')) || '',
          email: lines.find((t) => t.includes('@')) || '',
          issue: cells[0] || '',
          severity: cells[1] || '',
          lastActivity: cells[2] || '',
          view: state('[data-testid="agent-candidates-view-button"], button[aria-label="View"]'),
          reminderHistory: state(
            '[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]'
          ),
        };
      })
    );
  }

  async columnHeaders() {
    return this.table.evaluate((t) =>
      [...t.querySelectorAll('[role="columnheader"]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
    );
  }

  // ---------------------------------------------------------------- row actions

  async openFirstCandidateProfile() {
    await this.viewButtons.first().click();
    await this.page.waitForURL(/\/view-profile/, { timeout: 30000 });
  }

  // >>> THE PANEL OPENS EMPTY AND ITS ENTRIES ARRIVE AFTERWARDS. <<< Measured 2026-09-09: the
  // dialog is visible with only its heading while
  // `GET /core/api/v1/agent/candidate/<id>/reminders/?page=1&page_size=10` is still in flight,
  // and the entries paint when it answers. A read taken on `visible` therefore returned ZERO
  // entries for a candidate holding TEN - reported as "this candidate has no reminders", which
  // is precisely the false conclusion readReminderHistory() must never reach by accident. (Same
  // class as the billing grid's ten blank skeleton rows.)
  //
  // So the response is awaited and the RENDER is then polled up to the count the server
  // returned. The payload is handed back as well, so a step can assert what was rendered
  // against what was fetched rather than against a number nobody can predict - this account's
  // history grows every time the cron sends a reminder.
  // Index of the first row whose Reminder History icon is enabled, or -1.
  async firstEnabledReminderIndex() {
    await this.settleRows();
    return this.reminderHistoryButtons.evaluateAll((bs) =>
      bs.findIndex((b) => !b.disabled && b.getAttribute('data-disabled') !== 'true')
    );
  }

  // { name, email } of the candidate on row `index`, parsed the same way firstCandidate() does.
  async candidateAt(index) {
    const header = (await this.visibleRowHeaders())[index] || '';
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const parts = header.split(' ').filter(Boolean);
    return { name: parts.filter((t) => !emailRe.test(t)).join(' ').trim(), email: parts.find((t) => emailRe.test(t)) || '' };
  }

  async openReminderHistory(index = 0) {
    const response = this.page
      .waitForResponse(
        (r) => /\/candidate\/\d+\/reminders\//.test(r.url()) && r.request().method() === 'GET',
        { timeout: 30000 }
      )
      .catch(() => null);
    await this.reminderHistoryButtons.nth(index).click();
    await this.reminderHistoryPanel.waitFor({ state: 'visible', timeout: 15000 });

    const res = await response;
    const payload = res ? await res.json().catch(() => null) : null;
    const fetched = payload && Array.isArray(payload.results) ? payload.results.length : null;

    // Poll the render up to the fetched count. A page of 10 is the server's own page size, so
    // the rendered list legitimately stops there even when `count` is higher - compare against
    // results.length, never against count.
    if (fetched) {
      const until = Date.now() + 15000;
      /* eslint-disable no-await-in-loop */
      while (Date.now() < until) {
        const { entries } = await this.readReminderHistory();
        if (entries.length >= fetched) break;
        await this.page.waitForTimeout(250);
      }
      /* eslint-enable no-await-in-loop */
    }
    return { payload, fetched, endpoint: res ? res.url() : null };
  }

  // The panel's contents: its heading, the candidate it names, and one entry per reminder.
  //
  // Entries are derived STRUCTURALLY, from the one <li> the app renders per reminder, rather
  // than from a class name - a Tailwind churn would otherwise silently return an empty history,
  // and "this candidate has no reminders" is a conclusion that must never be reached by
  // accident.
  //
  // >>> IT USED TO PARSE THE TEXT FOR "Sent • <date>" ON ONE LINE, AND THAT STOPPED MATCHING.
  //     <<< Measured 2026-09-17: the app renders "Sent" and the timestamp on SEPARATE lines
  //     ("Upload your required documents" / "Sent" / "Sep 13, 2026 - 1:00 PM"), so the old
  //     regex matched NOTHING and this reader returned `entries: []` for a candidate whose
  //     dialog held ten <li> rows - the exact false negative the paragraph above warns about,
  //     and it was live in the default `npm test` run.
  //
  //     The fix is to count the <li>s, which is the structure, and to read the text INSIDE each
  //     one - where both the current stacked form and the older inline "Sent • <date>" form are
  //     tolerated, so a layout change back does not empty the reader a second time.
  async readReminderHistory() {
    const lines = (await this.reminderHistoryPanel.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    const entries = await this.reminderHistoryPanel.evaluate((el) =>
      [...el.querySelectorAll('li')].map((li) => {
        const parts = li.innerText
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean);
        const sentIdx = parts.findIndex((p) => /^Sent\b/i.test(p));
        let sent = null;
        if (sentIdx !== -1) {
          const inline = parts[sentIdx].match(/^Sent\s*[•·-]\s*(.+)$/i);
          sent = inline ? inline[1].trim() : parts[sentIdx + 1] || null;
        }
        return { title: parts[0] || null, sent };
      })
    );

    return {
      lines,
      heading: lines.find((t) => /^Reminder History$/i.test(t)) || null,
      candidate: lines[0] || null,
      entries,
      hasViewMore: lines.some((t) => /^View more$/i.test(t)),
    };
  }

  async closeReminderHistory(method = 'Close') {
    if (/escape/i.test(method)) await this.page.keyboard.press('Escape');
    else if (/backdrop/i.test(method)) await this.page.mouse.click(5, 5);
    else await this.reminderHistoryPanel.getByRole('button', { name: /^Close$/i }).first().click();
    await this.reminderHistoryPanel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // Watch a WINDOW rather than sampling once. "The panel is not visible" is also true of one the
  // app has not rendered YET, so a single read on a settling page reports "no panel" for one
  // that appears a moment later - and the step that uses this exists to prove an absence.
  async reminderHistoryStaysClosed(windowMs = 2500) {
    const until = Date.now() + windowMs;
    while (Date.now() < until) {
      if (await this.reminderHistoryPanel.isVisible().catch(() => false)) return false;
      await this.page.waitForTimeout(200);
    }
    return true;
  }

  // ---------------------------------------------------------------- filters

  async openFilters() {
    await this.filtersButton.click();
    await this.filterModal.waitFor({ state: 'visible', timeout: 10000 });
  }

  // Every option label in the modal, in DOM order, with its control type, testid and checked
  // state. ONE pass, and selectFilterOption() clicks by an index from this same pass - the two
  // used to be separate lists in the community module, where even a successful click could
  // select the wrong option.
  async readFilterOptions() {
    return this.filterModal.evaluate((d) =>
      [...d.querySelectorAll('label')].map((l, index) => {
        const input = l.querySelector('input');
        return {
          index,
          text: (l.innerText || '').replace(/\s+/g, ' ').trim(),
          testid: l.getAttribute('data-testid'),
          control: input ? input.type : null,
          checked: input ? input.checked : null,
        };
      })
    );
  }

  // The modal partitioned into its groups, by walking the dialog's own text and cutting at each
  // group heading. STRUCTURAL: every line that is neither an option label nor modal chrome is a
  // group heading. It used to match a hard-coded list of group names, which could never report a
  // group that was added or renamed - exactly how the Severity removal and the Last Activity ->
  // Last Updated rename (2026-10-05) went unseen.
  async readFilterGroups() {
    const optionTexts = new Set((await this.readFilterOptions()).map((o) => o.text.trim()));
    const lines = (await this.filterModal.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const chrome = /^(Apply Filters|Clear All|Cancel|Close)$/i;
    const groups = {};
    let current = null;
    for (const line of lines) {
      if (chrome.test(line)) continue;
      if (optionTexts.has(line)) {
        if (current) groups[current].push(line);
        continue;
      }
      current = line;
      groups[current] = [];
    }
    return groups;
  }

  // Click an option by its EXACT label, via the index readFilterOptions() produced.
  //
  // Exact, never a filter({hasText}) substring match: "Warning" would otherwise also be
  // satisfied by a future "No Warning" option, and "Payment" by "Payment Due".
  //
  // A real Playwright pointer click, never element.click(): React-Aria pressable labels ignore a
  // scripted click, and a mixed pass through the SuperAdmin modal reported three working
  // checkbox groups as ignored by the app - a defect that did not exist.
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
    await this.page.waitForTimeout(250);
  }

  async applyFilters() {
    await this.applyFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.settleRows(12000);
    await this.page.waitForTimeout(400);
  }

  async clearAllFilters() {
    await this.clearAllButton.click();
    await this.page.waitForTimeout(500);
  }

  async cancelFilters() {
    await this.cancelFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async closeFilterModal(method) {
    if (/x icon|close/i.test(method)) await this.closeFilterButton.click();
    else if (/cancel/i.test(method)) await this.cancelFiltersButton.click();
    else if (/escape/i.test(method)) await this.page.keyboard.press('Escape');
    else await this.page.mouse.click(5, 5); // backdrop
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async selectedFilterCount() {
    return this.filterModal.locator('input:checked').count();
  }

  // The count the Filters button renders ("Filters 2" -> 2, "Filters" -> 0).
  //
  // >>> IT COUNTS GROUPS, NOT OPTIONS. <<< Measured: two options inside Severity reads
  // "Filters 1"; one option in each of two groups reads "Filters 2". The Active tab's own
  // scenarios assert the option count, so the two listings genuinely disagree about what this
  // number means - do not "align" them.
  async appliedFilterCount() {
    const txt = (await this.filtersButton.innerText().catch(() => '')) || '';
    const m = txt.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  // Apply a filter and hand back the request the app actually made, so a scenario can assert the
  // API param and not merely the address bar. A front end that rewrites the URL and queries the
  // server for something else is exactly the defect this module exists to surface, and it cannot
  // be caught by reading either the URL or the rendered rows.
  async applyFiltersCapturingRequest(timeout = 45000) {
    const request = this.page
      .waitForRequest(
        (r) => /\/candidate\/requires-attention\//.test(r.url()) && r.method() === 'GET',
        { timeout }
      )
      .catch(() => null);
    await this.applyFilters();
    const req = await request;
    return req ? decodeURIComponent(req.url().split('/requires-attention/')[1] || '') : null;
  }

  // Load a URL directly and report the query the app sends for it. This is what separates "the
  // filter was never applied" from "the opposite value was sent": clicking Apply on a lifecycle
  // tab fires no request at all, while RELOADING the same URL fires one carrying the tab's
  // value with the filter dropped. Reporting them as one behaviour would send a developer
  // looking for a click handler that never fires.
  async loadUrlCapturingRequest(url, timeout = 45000) {
    const request = this.page
      .waitForRequest(
        (r) => /\/candidate\/requires-attention\//.test(r.url()) && r.method() === 'GET',
        { timeout }
      )
      .catch(() => null);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const req = await request;
    await this.settleRows(12000);
    return req ? decodeURIComponent(req.url().split('/requires-attention/')[1] || '') : null;
  }
}

RequiresAttentionPage.ROW = ROW;

module.exports = RequiresAttentionPage;
