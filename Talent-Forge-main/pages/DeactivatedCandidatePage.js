const BasePage = require('./BasePage');

// One definition of "a data row": a grid row carrying a rowheader (the Candidate cell). The
// header row has none, so this cannot count it.
const ROW = '[role="row"]:has([role="rowheader"])';

// DeactivatedCandidatePage - Page Object for Agent Portal > Candidates > Deactivated.
//
// Selectors follow the project convention: layered from most-stable (data-testid) -> ARIA
// role/name -> semantic HTML -> structural class -> text fallback.
//
// >>> MEASURED LIVE 2026-09-21 (scripts/probe-deactivated-candidates{,-2,-3,-4}.js, plus an MCP
// browser pass over the accessibility tree). Every string, URL param and API param below was
// read off the running app. NOTHING here was carried over from RequiresAttentionPage or
// ActiveCandidatePage by analogy - the three surfaces differ in six places and each difference
// has a wrong assertion waiting behind it. <<<
//
//   URL              /candidates/deactivated   - NO redirect and NO activeFilter param
//   heading          "Candidates - Deactivated"  (rendered as a <button> inside the <h1>)
//   grid             role=grid, accessible name "Deactivated"
//   columns          Candidate | Account Verification | Pending Documents |
//                    Subscription Status | Actions
//   search           ?search=<term>, debounced ~1s; matches candidate NAME **and EMAIL**
//   row action       View (eye) -> /candidates/<id>/view-profile?selectedTab=candidate-details
//   list endpoint    GET /core/api/v1/candidate/deactivated/?page=1&page_size=10&search=
//
// SIX DIFFERENCES FROM THE NEIGHBOURING LISTINGS, all of them load-bearing:
//
//  1. THERE IS NO TAB STRIP. Requires Attention has three severity tabs in a radiogroup; this
//     route has no radiogroup at all and no activeFilter param. A reader that waits for one
//     hangs on a page that is fully rendered.
//  2. THERE IS EXACTLY ONE ROW ACTION - View. No Reminder History (Requires Attention and
//     Active both have it) and NO REACTIVATE ANYWHERE. That absence is what makes this whole
//     module read-only and therefore safe in the default run, so it is asserted as a rule
//     rather than assumed.
//  3. The three filter groups are its OWN, and Pending Documents is a RADIO group whose labels
//     carry NO data-testid, where the other two are checkboxes that do. A testid-only reader
//     sees 5 of the 8 options and any assertion counting them passes having inspected five.
//     Hence readFilterOptions() walks every <label> in the dialog in DOM order and
//     selectFilterOption() clicks by the index that same pass produced - one list, so the index
//     a step reads is by construction the index the click acts on. (The SuperAdmin Candidates
//     modal was caught by exactly this.)
//  4. NOT ONE option's URL value equals its API value (the feature file's filter table holds
//     the full mapping, and asserts both per row). Checking only the
//     URL would pass on a front end that rewrites the address bar and queries the server for
//     something else, and that cannot be caught by reading the rendered rows either.
//  5. The app ALWAYS sends `search=`, even when empty, so "a request carrying search=" is not
//     evidence that a search was applied. Assert the VALUE.
//  6. There is no Back control on the profile this listing opens (measured: zero elements whose
//     text is "Back"). The return path is the browser's own Back, which DOES restore the filter,
//     the badge and the search term.
class DeactivatedCandidatePage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/candidates/deactivated`;

    // ---- Header / page identity ----
    // The <h1> wraps a <button>, so getByRole('heading') resolves the h1 and its name comes from
    // that button. Matched on the text rather than the element type for exactly that reason.
    this.pageHeading = page
      .getByRole('heading', { name: /Candidates\s*-\s*Deactivated/i })
      .first();

    // ---- Search ----
    // The placeholder reads "Search by candidate name..." but the search matches an EMAIL too
    // (measured four ways: full address, an address containing "+", the local part, and the bare
    // domain). The placeholder is kept only as a locator fallback, never as an assertion.
    this.searchInput = page
      .locator(
        '[data-testid="agent-candidates-deactivated-search-input"], '
        + '[data-testid="agent-candidates-search-input"], '
        + 'input[placeholder*="Search by candidate" i], input[type="search"], [role="searchbox"]'
      )
      .first();

    // ---- Filters button + modal ----
    this.filtersButton = page
      .locator(
        '[data-testid="agent-candidates-deactivated-filters-button"], '
        + '[data-testid="agent-candidates-filters-button"], button:has-text("Filters")'
      )
      .first();
    this.filterModal = page.getByRole('dialog').filter({ hasText: /Apply Filters/i }).first();
    this.applyFiltersButton = this.filterModal.getByRole('button', { name: /^Apply Filters$/i }).first();
    this.clearAllButton = this.filterModal.getByRole('button', { name: /^Clear All$/i }).first();
    this.cancelFiltersButton = this.filterModal.getByRole('button', { name: /^Cancel$/i }).first();
    this.closeFilterButton = this.filterModal.getByRole('button', { name: /^Close$/i }).first();

    // ---- Table ----
    // Scoped by its accessible name, which this grid HAS ("Deactivated") - unlike the Requires
    // Attention grid, whose page object deliberately avoids a name it does not carry. Falls back
    // to the only grid on the route.
    this.table = page.getByRole('grid', { name: /Deactivated/i }).or(page.locator('[role="grid"]')).first();

    // ---- Pagination ----
    // Scoped by name: the page shell's own sidebar is also a <nav>, so an unnamed reader
    // resolves to "Dashboard Candidates Active In Progress ..." and reports it as pagination.
    this.pagination = page
      .locator('[aria-label*="agination" i]')
      .or(page.getByRole('navigation', { name: /Pagination/i }))
      .first();

    // ---- Row actions ----
    // ONE action on this listing, and this is the only page-level locator for it.
    //
    // There is deliberately no `reminderHistoryButtons` / `reactivateButtons` here, although two
    // scenarios assert those controls are ABSENT: a page-wide count can say "none anywhere" but
    // not WHICH row grew one, and a row is where the finding lives. readRows() reports both per
    // row instead, from the same in-browser pass that reads everything else about it.
    this.viewButtons = page.locator(
      '[data-testid="agent-candidates-view-button"], button[aria-label="View"]'
    );
  }

  // The three filter groups, in the order the modal renders them, with the control type each
  // uses. The TYPE is recorded because it decides what a second selection in the group MEANS: a
  // checkbox adds, a radio REPLACES - so a "two options in one group" scenario aimed at Pending
  // Documents would be asserting behaviour the control cannot have.
  static FILTER_GROUPS = [
    { name: 'Account Verification Status', control: 'checkbox', options: ['Verified', 'Unverified'] },
    { name: 'Pending Documents', control: 'radio', options: ['0', '1-2', '3+'] },
    {
      name: 'Subscription Status',
      control: 'checkbox',
      options: ['Subscribed', 'Not Subscribed', 'Payment Due'],
    },
  ];

  // >>> NOT ONE OPTION'S URL VALUE EQUALS ITS API VALUE. <<< `pendingDocuments=3plus` ->
  // `pending_documents=3+`, `subscriptionStatus=notSubscribed` -> `subscription_status=not_subscribed`,
  // and so on for all eight. The full mapping is the data table in the feature file, asserted row
  // by row - deliberately NOT duplicated here as a constant, because a second copy could only
  // drift out of agreement with the thing actually under test.
  //
  // Note `3+` in particular: the request carries a RAW, UNENCODED `pending_documents=3+`, and a
  // bare "+" in a query string decodes to a space, so the server receives "3 ". No deactivated
  // candidate currently holds 3+ documents, so a working filter and a broken one return the same
  // empty list and cannot be told apart on this data. Recorded for the PO rather than failed on.

  // The two empty states. They are NOT interchangeable: one describes a tab with nothing on it,
  // the other a query matching nothing. A single reader looking for "No results found" answers
  // "absent" on a genuinely empty tab, which reads as the empty state being missing.
  //
  //   `results` - MEASURED verbatim 2026-09-21, and confirmed through the MCP browser. It offers
  //               NO "Clear all filters" CTA (the community module's equivalent does).
  //   `tab`     - supplied by the PO. NOT yet measured: this agent always holds deactivated
  //               candidates and the dedicated zero-candidate fixture's login times out, so the
  //               state is unreachable today. See the empty-state scenario for how that is
  //               handled honestly rather than asserted blind.
  static EMPTY_STATES = {
    results: {
      heading: 'No results found',
      body: "We couldn't find any results matching your current search.",
    },
    tab: {
      heading: 'No deactivated candidates',
      body: 'Candidates who have been deactivated will appear here.',
    },
  };

  // >>> EVERY LIST REQUEST IS RECORDED FROM THE MOMENT THE SCENARIO STARTS. <<<
  //
  // `install()` is called once per scenario (from hooks.js / PagesFixture.js, the same way
  // InProgressCandidatePage and RequiresAttentionPage are) rather than each action capturing its
  // own request. Two reasons:
  //
  //  1. Several assertions read the query the app sent for an action taken SEVERAL steps
  //     earlier - "the request should carry verification_status=unverified" after a later
  //     search, for instance. A per-action capture cannot answer that.
  //  2. Some actions correctly fire NO REQUEST AT ALL - re-rendering a page already fetched,
  //     and re-typing a term identical to the one already applied. A `waitForRequest` there
  //     resolves to null and reads identically to a timeout, a slow network or a broken
  //     listener. A running log distinguishes "nothing was sent" from "something was sent and I
  //     missed it".
  //
  // The log is never reset mid-scenario; steps take an index baseline instead, so a step can ask
  // "what did the app send AFTER this point" without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this._profilePayload = null;
    this._parsing = [];
    this.page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      if (!/\/candidate\/deactivated\//.test(req.url())) return;
      this.requests.push({
        at: Date.now(),
        url: req.url(),
        query: decodeURIComponent(req.url().split('/deactivated/')[1] || ''),
      });
    });

    // The profile payload of whichever candidate the View action opened. Captured here rather
    // than waited for at the click, because it is what answers "did View open the RIGHT
    // candidate" - a listing that always opened the first row would satisfy every other
    // assertion in this file, and that is a disclosure problem as much as a navigation one.
    //
    // >>> READING A RESPONSE BODY IS ASYNCHRONOUS AND PLAYWRIGHT DOES NOT AWAIT AN EVENT
    // HANDLER. <<< `waitForResponse` resolves when the response ARRIVES, not when this handler
    // has parsed it, so a step reading the payload straight afterwards can find null on a
    // profile that loaded perfectly well - and report that the profile "was not fetched", which
    // reads as the app never making the call. Each parse is tracked as a promise and flush()
    // awaits the outstanding ones. (The candidate view-profile module was caught by exactly
    // this.)
    this.page.on('response', (res) => {
      if (!/\/candidate\/profile\/\d+\//.test(res.url())) return;
      const p = res
        .json()
        .then((body) => {
          this._profilePayload = body;
        })
        .catch(() => {});
      this._parsing.push(p);
    });

    // >>> THE LIST RESPONSES, WITH THEIR BODIES - AND THIS IS WHAT MAKES EVERY READ HONEST. <<<
    //
    // THE GRID KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. So a row read taken
    // after a fixed delay is not reading the result of the action just performed, it is reading
    // whatever happened to be on screen - and it does not fail, it reports the OLD list as the
    // new one. Measured on the first run of this feature: searching one candidate's email
    // returned all six rows and the scenario reported the search as not filtering at all, on a
    // search that works perfectly.
    //
    // No delay can fix that, because there is nothing in the DOM that distinguishes "these are
    // the new rows" from "these are the old ones". The only sound settle is against the SERVER's
    // own answer: wait for the response, then poll the render until it matches the payload.
    // settleAgainstServer() does that; every action that changes the list goes through it.
    this.responses = [];
    this.page.on('response', (res) => {
      if (res.request().method() !== 'GET') return;
      if (!/\/candidate\/deactivated\//.test(res.url())) return;
      const p = res
        .json()
        .then((body) => {
          this.responses.push({
            query: decodeURIComponent(res.url().split('/deactivated/')[1] || ''),
            status: res.status(),
            count: typeof body.count === 'number' ? body.count : null,
            results: Array.isArray(body.results) ? body.results : [],
          });
        })
        .catch(() => {});
      this._parsing.push(p);
    });
  }

  responseCount() {
    return (this.responses || []).length;
  }

  lastListResponse() {
    const log = this.responses || [];
    return log.length ? log[log.length - 1] : null;
  }

  // The server's own total for the last list query. Preferred over a rendered row count wherever
  // a figure is compared against another figure: the render is capped at page_size, so two
  // results that differ only past the first page would look identical on screen.
  lastListCount() {
    const last = this.lastListResponse();
    return last ? last.count : null;
  }

  // Wait for a list response newer than `baseline` (an index from responseCount()), then poll the
  // grid until what it renders matches that payload. Returns the response, or null if none came.
  //
  // Not an optimisation - it is the only thing that makes a post-action read mean anything. See
  // the note in install().
  async settleAgainstServer(baseline, timeout = 25000) {
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await this.flush();
      if (this.responseCount() > baseline) break;
      await this.page.waitForTimeout(150);
    }
    await this.flush();
    const latest = this.lastListResponse();
    if (!latest || this.responseCount() <= baseline) return null;

    // The rendered page is capped at page_size, so the render matches results.length - never
    // `count`, which is the total across every page.
    const want = latest.results.length;
    const renderDeadline = Date.now() + timeout;
    while (Date.now() < renderDeadline) {
      const rendered = await this.rowCount();
      if (rendered === want) break;
      await this.page.waitForTimeout(150);
    }
    /* eslint-enable no-await-in-loop */
    return latest;
  }

  async flush() {
    const pending = this._parsing || [];
    this._parsing = [];
    await Promise.all(pending);
  }

  // The payload behind the profile the View action opened.
  //
  // >>> IT WAITS, IT DOES NOT MERELY FLUSH - AND THE FIRST VERSION GOT THAT WRONG. <<<
  // `waitForURL(/view-profile/)` resolves on COMMIT, which happens well before the profile
  // request is even made, so flushing the outstanding parses at that moment finds nothing and
  // returns null. Measured on the first full run of this feature: two scenarios reported "the
  // profile payload was never captured" against a profile that had loaded perfectly well - i.e.
  // they described the app as never making a call it demonstrably makes.
  //
  // Two halves, and BOTH are needed. Waiting for the response to arrive, and then awaiting the
  // parse: `page.on('response')` handlers are not awaited by Playwright, so a body that has
  // arrived is not yet a body that has been read.
  async profilePayload(timeout = 30000) {
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await this.flush();
      if (this._profilePayload) return this._profilePayload;
      await this.page.waitForTimeout(200);
    }
    /* eslint-enable no-await-in-loop */
    await this.flush();
    return this._profilePayload;
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

  async navigate(suffix = '') {
    this.install();
    const responseBaseline = this.responseCount();
    await super.navigate(`${this.url}${suffix}`);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    // settleRows() first so an EMPTY listing resolves on its empty state rather than waiting out
    // the response settle; then settle against the server so the rows on screen are this
    // navigation's, not the previous page's.
    await this.settleRows();
    await this.settleAgainstServer(responseBaseline, 20000);
  }

  // >>> THE GRID PAINTS BEFORE ITS ROWS DO, SO A ROW READ TAKEN ON ARRIVAL RETURNS ZERO. <<<
  // The Candidate cell renders as two React-Aria <button><span> lines and populates a tick after
  // the row skeleton, so the row existing is not the row having content. The settle keys on '@'
  // appearing in the first Candidate cell.
  //
  // An EMPTY listing must not hang here, so a timeout is not an error: it resolves on whichever
  // of rows-or-empty-state arrives, and reports which.
  async settleRows(timeout = 20000) {
    const which = await Promise.race([
      this.page.locator(ROW).first().waitFor({ state: 'visible', timeout }).then(() => 'rows'),
      this.emptyStateHost().waitFor({ state: 'visible', timeout }).then(() => 'empty'),
    ]).catch(() => 'neither');
    if (which === 'rows') {
      await this.page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(`${sel} [role="rowheader"]`);
            return Boolean(el) && el.innerText.includes('@');
          },
          ROW,
          { timeout }
        )
        .catch(() => {});
    }
    return which;
  }

  // The element either empty state renders into. Matched on the measured headings rather than on
  // a class, and deliberately not on the word "No" alone - the grid's own "Not Subscribed" cells
  // and the filter modal both contain it.
  emptyStateHost() {
    return this.page
      .getByText(/No results found|No deactivated candidates/i)
      .first();
  }

  // Both empty-state lines as the page renders them, or null when neither is on screen.
  //
  // RE-READS EVERY TIME. A cached snapshot would let a scenario that asserts one wording, adds a
  // search, and asserts the second pass no matter what the app did.
  async readEmptyState() {
    const host = this.emptyStateHost();
    if (!(await host.isVisible().catch(() => false))) return null;
    // Climb to the smallest ancestor carrying a second line of text, so the body sentence is
    // captured without swallowing the whole page.
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

  // ---------------------------------------------------------------- search

  async search(term) {
    await this.searchCapturingRequest(term);
  }

  async clearSearch() {
    if ((await this.getSearchValue()) === '') return;
    const baseline = this.responseCount();
    await this.searchInput.fill('');
    await this.settleAgainstServer(baseline, 20000);
  }

  async getSearchValue() {
    return this.searchInput.inputValue();
  }

  async searchPlaceholder() {
    return (await this.searchInput.getAttribute('placeholder')) || '';
  }

  // Search, wait for the SERVER's answer, let the grid catch up to it, and hand back the query
  // the app actually sent.
  //
  // It CLEARS FIRST and settles that too, because the control only fires when the value CHANGES:
  // typing a term equal to the one already applied sends nothing at all, and the read would then
  // be of the previous result. Clearing guarantees every search produces a request of its own -
  // which is also what lets the variations table drive two terms that happen to be identical
  // (an all-lowercase name in "upper case" and "lower case") without one of them silently
  // measuring the other.
  async searchCapturingRequest(term, timeout = 30000) {
    await this.clearSearch();
    const responseBaseline = this.responseCount();
    const requestBaseline = this.requestCount();
    await this.searchInput.fill(term);
    await this.settleAgainstServer(responseBaseline, timeout);
    const sent = this.requestsSince(requestBaseline);
    return sent.length ? sent[sent.length - 1] : null;
  }

  // ---------------------------------------------------------------- rows

  async rowCount() {
    return this.page.locator(ROW).count();
  }

  // Every visible row's Candidate cell as "name email", in ONE evaluateAll so the list cannot
  // detach mid-iteration while the grid re-renders.
  //
  // innerText, never textContent: the cell holds no <p> (name and email are each a React-Aria
  // <button><span>) and textContent runs the two lines together with no separator, so a term
  // straddling the name/email boundary would match text no row displays.
  async visibleRowHeaders() {
    return this.page
      .locator(`${ROW} [role="rowheader"]`)
      .evaluateAll((els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()));
  }

  async firstCandidate() {
    await this.settleRows();
    const headers = await this.visibleRowHeaders();
    if (!headers.length) throw new Error('The Deactivated grid rendered no candidate rows.');
    const tokens = headers[0].split(' ').filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = tokens.find((t) => emailRe.test(t)) || '';
    const name = tokens.filter((t) => !emailRe.test(t)).join(' ').trim();
    if (!email) {
      throw new Error(
        `The first candidate row exposed no email address. Candidate cell read: ${JSON.stringify(headers[0])}`
      );
    }
    return { name, email };
  }

  // Every row as {name, email, accountVerification, pendingDocuments, subscriptionStatus} plus
  // the state of each row action.
  //
  // gridcell order (the Candidate column is a rowheader, NOT a gridcell):
  //   0 = Account Verification, 1 = Pending Documents, 2 = Subscription Status, 3 = Actions
  async readRows() {
    return this.page.locator(ROW).evaluateAll((rows) =>
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
        // Every control the Actions cell offers, named however it is named. This is what turns
        // "the row offers View" into "the row offers View AND NOTHING ELSE" - an extra action
        // appearing here is a control nobody specified, and on this listing it could be a
        // WRITE control on a surface the whole module is safe in the default run because it
        // lacks one.
        const actionCell = r.querySelectorAll('[role="gridcell"]')[3];
        const actions = actionCell
          ? [...actionCell.querySelectorAll('button, a')].map(
            (b) => b.getAttribute('aria-label') || (b.innerText || '').trim() || b.getAttribute('data-testid') || '(unnamed)'
          )
          : [];
        return {
          name: lines.find((t) => !t.includes('@')) || '',
          email: lines.find((t) => t.includes('@')) || '',
          accountVerification: cells[0] || '',
          pendingDocuments: cells[1] || '',
          subscriptionStatus: cells[2] || '',
          actions,
          view: state('[data-testid="agent-candidates-view-button"], button[aria-label="View"]'),
          reminderHistory: state(
            '[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]'
          ),
          reactivate: state(
            '[data-testid="agent-candidates-reactivate-button"], button[aria-label*="Reactivate" i]'
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

  // The payload is cleared BEFORE the click, so a scenario that opens two profiles in turn cannot
  // read the first one's payload and conclude the second opened the right candidate.
  async openCandidateProfile(index = 0) {
    this._profilePayload = null;
    await this.viewButtons.nth(index).click();
    await this.page.waitForURL(/\/view-profile/, { timeout: 30000 });
  }

  // The five tabs the profile offers. They are role="radio" in a role="radiogroup", NOT
  // role="tab" - a getByRole('tab') reader finds nothing on a strip that plainly renders five.
  // Polled, because the strip paints seconds after the "Profile" heading: a single read returns
  // the page shell only and reports all five as missing on a profile that renders them.
  async profileTabs(timeout = 30000) {
    const until = Date.now() + timeout;
    let tabs = [];
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      tabs = await this.page
        .locator('[role="radiogroup"] [role="radio"]')
        .evaluateAll((els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
      if (tabs.length >= 5) break;
      await this.page.waitForTimeout(400);
    }
    /* eslint-enable no-await-in-loop */
    return tabs;
  }

  // ---------------------------------------------------------------- filters

  async openFilters() {
    await this.filtersButton.click();
    await this.filterModal.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(300);
  }

  // Every option label in the modal, in DOM order, with its control type, testid and checked
  // state. ONE pass, and selectFilterOption() clicks by an index from this same pass.
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
  // group heading. Derived from what is RENDERED rather than from FILTER_GROUPS, so a group the
  // app stops rendering is reported missing instead of being assumed present.
  async readFilterGroups() {
    const names = DeactivatedCandidatePage.FILTER_GROUPS.map((g) => g.name);
    const lines = (await this.filterModal.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const chrome = /^(Apply Filters|Clear All|Cancel|Close)$/i;
    const groups = {};
    let current = null;
    for (const line of lines) {
      const hit = names.find((n) => n.toLowerCase() === line.toLowerCase());
      if (hit) {
        current = hit;
        groups[hit] = [];
        continue;
      }
      if (current && !chrome.test(line)) groups[current].push(line);
    }
    return groups;
  }

  // Click an option by its EXACT label, via the index readFilterOptions() produced.
  //
  // Exact, never a filter({hasText}) substring match: "Subscribed" would otherwise also match
  // "Not Subscribed", and "0" would match every option containing a zero.
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
    const responseBaseline = this.responseCount();
    await this.applyFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    // Settled against the SERVER, not the grid: the grid keeps the previous query's rows while
    // the next is in flight, so a read here would report the pre-filter list as the filtered one.
    await this.settleAgainstServer(responseBaseline, 25000);
  }

  // Apply and hand back the request the app actually made, so a scenario can assert the API
  // param and not merely the address bar. A front end that rewrites the URL and queries the
  // server for something else cannot be caught by reading either the URL or the rendered rows.
  async applyFiltersCapturingRequest() {
    const requestBaseline = this.requestCount();
    await this.applyFilters();
    const sent = this.requestsSince(requestBaseline);
    return sent.length ? sent[sent.length - 1] : null;
  }

  async clearAllFilters() {
    await this.clearAllButton.click();
    await this.page.waitForTimeout(600);
  }

  async cancelFilters() {
    await this.cancelFiltersButton.click();
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async closeFilterModal(method) {
    if (/x icon|^close$/i.test(method)) await this.closeFilterButton.click();
    else if (/cancel/i.test(method)) await this.cancelFiltersButton.click();
    else if (/escape/i.test(method)) await this.page.keyboard.press('Escape');
    else await this.page.mouse.click(5, 5); // backdrop
    await this.filterModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async selectedFilterCount() {
    return this.filterModal.locator('input:checked').count();
  }

  async selectedFilterOptions() {
    const options = await this.readFilterOptions();
    return options.filter((o) => o.checked).map((o) => o.text);
  }

  // The count the Filters button renders ("Filters 2" -> 2, "Filters" -> 0).
  //
  // >>> IT COUNTS GROUPS, NOT OPTIONS. <<< Measured: two options inside Subscription Status
  // reads "Filters 1"; one option in each of two groups reads "Filters 2". The Active tab's own
  // scenarios assert the OPTION count for the same-looking badge, so the listings genuinely
  // disagree about what the number means - do not "align" them without a product answer.
  async appliedFilterCount() {
    const txt = (await this.filtersButton.innerText().catch(() => '')) || '';
    const m = txt.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  // Load a URL directly and report the query the app sends for it. This is what separates "the
  // filter was never applied" from "the opposite value was sent" - two findings that send a
  // developer to completely different places.
  async loadUrlCapturingRequest(suffix) {
    const requestBaseline = this.requestCount();
    const responseBaseline = this.responseCount();
    await this.page.goto(`${this.url}${suffix}`, { waitUntil: 'domcontentloaded' });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    await this.settleAgainstServer(responseBaseline, 25000);
    const sent = this.requestsSince(requestBaseline);
    return sent.length ? sent[sent.length - 1] : null;
  }

  async reload() {
    const requestBaseline = this.requestCount();
    const responseBaseline = this.responseCount();
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    await this.settleAgainstServer(responseBaseline, 25000);
    const sent = this.requestsSince(requestBaseline);
    return sent.length ? sent[sent.length - 1] : null;
  }

  // ---------------------------------------------------------------- pagination

  // Whether a pagination control is rendered at all, with the evidence either way.
  //
  // >>> IT IS LEGITIMATELY ABSENT ON A SHORT LIST. <<< The app asks for page_size=10 and this
  // agent holds well under that, so no control renders - and that is correct, not a defect. Any
  // assertion here has to be the RULE ("present only when the list exceeds one page"), never the
  // current state, or it goes red the day an 11th candidate is deactivated.
  async paginationState() {
    const present = (await this.pagination.count()) > 0
      && (await this.pagination.isVisible().catch(() => false));
    return {
      present,
      text: present ? (await this.pagination.innerText()).replace(/\s+/g, ' ').trim() : null,
      next: await this.page.getByRole('button', { name: /^Next$/i }).count(),
      previous: await this.page.getByRole('button', { name: /^Previous$/i }).count(),
      pageSize: this.pageSizeAsked(),
      rows: await this.rowCount(),
    };
  }

  // The page_size the app asked for, read off its own last request rather than hardcoded - the
  // rule a pagination scenario asserts turns on it, so a change to it must not silently invert
  // the expectation.
  pageSizeAsked() {
    const q = this.lastRequestQuery() || '';
    const m = q.match(/page_size=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  async goToNextPage() {
    const requestBaseline = this.requestCount();
    const responseBaseline = this.responseCount();
    await this.page.getByRole('button', { name: /^Next$/i }).first().click();
    await this.settleAgainstServer(responseBaseline, 25000);
    const sent = this.requestsSince(requestBaseline);
    return sent.length ? sent[sent.length - 1] : null;
  }
}

DeactivatedCandidatePage.ROW = ROW;

module.exports = DeactivatedCandidatePage;
