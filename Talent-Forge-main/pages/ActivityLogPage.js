const BasePage = require('./BasePage');

// One definition of "a log entry": the app's own row container. NEVER derived from text, and
// never de-duplicated by text - see readEntries().
const ITEM = '.activity-log-item';
const ITEMS_CONTAINER = '.activity-log-items-container';

// The list endpoint. Matched as a path fragment so a host or version change does not silently
// stop the log recording.
const LIST_PATH = '/analytics/agents/activity-logs/me/';

// ActivityLogPage - Page Object for Agent Portal > Activity Log (/activity-log).
//
// Selectors follow the project convention: layered from most-stable (data-testid) -> ARIA
// role/name -> semantic HTML -> structural class -> text fallback.
//
// >>> MEASURED LIVE 2026-09-21 through the Playwright MCP browser, against AGENT_EMAIL (514
// entries). Every string, URL param, API param and count below was read off the running app.
// NOTHING was carried over by analogy from CandidateViewProfilePage's Activity Log TAB or from
// AuditLogsPage - the three surfaces differ in ways that each have a wrong assertion waiting
// behind them (see the five differences below). <<<
//
//   route            /activity-log     - no redirect; no param written until one is changed
//   heading          "Activity Log"  (an <h1> wrapping a tabindex="-1" <button>)
//   toolbar          a search box and a date-range dropdown. THAT IS ALL - there is no Filters
//                    button and the word "filter" appears nowhere in <main> (checked at 1280,
//                    1600 and 1920 wide).
//   search           URL ?activityLogSearch=<term>  ->  API search=<term>   (THE TWO DIFFER)
//                    debounced ~1.2s; matches headline, description, actor name and actor email
//   date range       URL ?duration=<v>              ->  API duration=<v>    (identical)
//                    Last 24 hours / 7 days / 30 days / 3 months / 6 months / This year
//                    default last_7_days
//   list endpoint    GET /core/api/v1/analytics/agents/activity-logs/me/
//                        ?page=1&page_size=10&duration=<v>[&search=<term>]
//   paging           INFINITE SCROLL - it appends. There is no pagination control and none is
//                    needed.
//   row              .activity-log-item - headline / description / "MMM D, YYYY - h:mm AM"
//   empty state      .section-empty-state (tab-level) OR a <section> with an <h3> (no results): see readEmptyState()
//
// FIVE DIFFERENCES FROM THE NEIGHBOURING SURFACES, all of them load-bearing:
//
//  1. THERE IS NO PAGINATION CONTROL, AND THAT IS CORRECT. The list is infinite scroll: 10 rows
//     at page_size=10 against count 514, growing to 70 over six fetches as <main> is scrolled.
//     Reading the absent control and reporting "10 of 514 are unreachable" is the conclusion
//     this note exists to prevent - it was nearly filed before the scroll was measured.
//  2. THE SEARCH'S URL PARAM IS NOT ITS API PARAM (activityLogSearch vs search), while the date
//     range's ARE the same on both. That is the exact reverse of every filter modal in this
//     product, where "not one option's URL param equals its API param". So both are asserted,
//     per group - checking only the URL passes on a front end that rewrites the address bar and
//     queries the server for something else.
//  3. THE DATE RANGE REACHES THE URL AND SURVIVES A RELOAD, search included. The candidate
//     view-profile's Activity Log tab writes its duration NOWHERE (recorded there as finding 7),
//     so an assertion carried over from that module would be backwards here.
//  4. THIS SURFACE RENDERS THE TIME. The view-profile tab discards it and renders the date only
//     (recorded there as a finding). A reader that expects a bare date fails against a correct
//     render.
//  5. IT IS THE AGENT'S OWN LOG (.../activity-logs/me/), not a candidate's. Every row shares one
//     actor, which is why a search on the actor's name returns nearly everything rather than
//     nothing - 492 of 514, the remaining 22 being superadmin impersonation rows.
//
// >>> THERE IS EXACTLY ONE data-testid ON THE WHOLE PAGE - "hidden-select-container", react-aria's
// aria-hidden mirror for the date-range dropdown. It is not a control and must never be clicked;
// it is used here only as a structural ANCHOR for the real trigger beside it, and as the one
// honest way to read the option list the popover is built from. <<<
class ActivityLogPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/activity-log`;

    // ---- Page identity ----
    // The sidebar's own "Activity Log" link carries the same text, so this is a HEADING lookup
    // and not a text lookup. (The <h1> wraps a tabindex="-1" <button>, which is why the name
    // resolves at all.)
    this.pageHeading = page.getByRole('heading', { name: /^Activity Log$/i }).first();
    this.sidebarLink = page.getByRole('link', { name: /Activity Log/i }).first();

    // ---- Search ----
    // The placeholder is a bare "Search...", so it is a locator fallback only and never an
    // assertion - there is nothing in it to hold the product to.
    this.searchInput = page
      .locator('main input[type="search"], main [role="searchbox"], main input[placeholder="Search..."]')
      .first();

    // ---- Date-range dropdown ----
    // >>> LOCATED STRUCTURALLY, AS THE SIBLING OF THE HIDDEN MIRROR, AND NOT BY ITS TEXT. <<<
    // Its label IS the current selection, so a text locator has to be rewritten every time the
    // selection changes and cannot find the control at all when the selection is unknown - which
    // is precisely the case in the step that asserts what the default is. A `main button` reader
    // is right today (there is exactly one) and silently resolves to something else the moment a
    // second button is added. The mirror is a stable, named anchor for both.
    //
    // NEVER use the trigger's id. It is `react-aria5503990128-_r_i_`-shaped and REGENERATED ON
    // EVERY RENDER; an id captured moments earlier has been observed resolving to a different
    // control entirely.
    this.hiddenSelectContainer = page.locator('[data-testid="hidden-select-container"]').first();
    this.durationTrigger = page
      .locator(
        'div:has(> [data-testid="hidden-select-container"]) > button,'
        + ' main button[data-react-aria-pressable],'
        + ' main button'
      )
      .first();

    // The popover is role=dialog > role=listbox > role=option, with TWO <button aria-label=
    // "Dismiss"> FLANKING the listbox. Options are therefore selected by role and NAME, never by
    // indexing a locator union - the community module lost four scenarios to exactly that.
    this.durationMenu = page.getByRole('listbox').first();
    this.durationOptions = this.durationMenu.getByRole('option');

    // ---- List ----
    this.itemsContainer = page.locator(ITEMS_CONTAINER).first();
    this.items = page.locator(ITEM);

    // ---- Empty state ----
    // Either empty-state component - the tab-level one or the no-results <section> (see
    // readEmptyState). The settle logic resolves on this, so it must know both or it waits out its
    // whole timeout on a list that is empty and correctly explained.
    this.emptyState = page
      .locator('main .section-empty-state, main section:has(h3):not(:has(.activity-log-item))')
      .first();
  }

  // The six date ranges, in the order the popover renders them, each with the value it writes to
  // the URL and the value it sends on the wire. Recorded as a pair on purpose: they are equal on
  // this surface, and writing them out is what makes that a measured fact rather than an
  // assumption the day one of them changes.
  static DURATIONS = [
    { label: 'Last 24 hours', urlValue: 'last_24_hours', apiValue: 'last_24_hours' },
    { label: 'Last 7 days', urlValue: 'last_7_days', apiValue: 'last_7_days' },
    { label: 'Last 30 days', urlValue: 'last_30_days', apiValue: 'last_30_days' },
    { label: 'Last 3 months', urlValue: 'last_3_months', apiValue: 'last_3_months' },
    { label: 'Last 6 months', urlValue: 'last_6_months', apiValue: 'last_6_months' },
    { label: 'This year', urlValue: 'this_year', apiValue: 'this_year' },
  ];

  // What the page applies when no ?duration= is supplied, when it is empty, and when it holds a
  // value the app does not recognise. Measured in all three cases.
  static DEFAULT_DURATION = { label: 'Last 7 days', apiValue: 'last_7_days' };

  // The URL parameter names, which are NOT the API parameter names for the search. Kept here so
  // a step reads one definition rather than repeating a string that is easy to get subtly wrong.
  static URL_PARAMS = { search: 'activityLogSearch', duration: 'duration' };

  static API_PARAMS = { search: 'search', duration: 'duration' };

  // The one empty state this page has, verbatim. Note the apostrophe missing from "Agents" - it
  // is quoted exactly as the app renders it, because the scenario that reads it is asserting a
  // DIFFERENT defect (one message for both causes) and must not also fail on the typo.
  static EMPTY_STATE = {
    heading: 'No activity to show',
    body: 'Agents recent actions and updates will appear here.',
  };

  // ============================== the request/response log ==============================

  // `install()` is called ONCE PER SCENARIO from hooks.js / PagesFixture.js, before the first
  // navigation - the same way InProgressCandidatePage, RequiresAttentionPage,
  // DeactivatedCandidatePage and AuditLogsPage are. Three reasons here, and the second and third
  // are the ones that forced it:
  //
  //  1. Several assertions read the query the app sent for an action taken steps earlier.
  //  2. TWO OF THE BEHAVIOURS ASSERTED ARE AN ACTION THAT CORRECTLY FIRES NO REQUEST AT ALL -
  //     re-picking the date range already selected, and clearing an already-empty search. A
  //     `waitForResponse` there resolves to null, which is INDISTINGUISHABLE from a timeout, a
  //     slow network or a listener attached too late. A running log tells "nothing was sent"
  //     apart from "something was sent and I missed it".
  //  3. The server's own `count` is the only figure two result sets can be compared by: the
  //     render is capped at page_size, so two queries differing only past the first page look
  //     identical on screen.
  //
  // The log is never reset mid-scenario; steps take an index baseline instead, so a step can ask
  // what happened AFTER a point without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.responses = [];
    this._parsing = [];

    this.page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      if (!req.url().includes(LIST_PATH)) return;
      this.requests.push({
        at: Date.now(),
        url: req.url(),
        query: decodeURIComponent(req.url().split(LIST_PATH)[1] || ''),
      });
    });

    this.page.on('response', (res) => {
      if (res.request().method() !== 'GET') return;
      if (!res.url().includes(LIST_PATH)) return;
      // >>> READING A BODY IS ASYNCHRONOUS AND PLAYWRIGHT DOES NOT AWAIT AN EVENT HANDLER. <<<
      // A response that has ARRIVED is not yet one that has been READ, so every parse is tracked
      // and flush() awaits the outstanding ones. Without this a settle resolves and the reader
      // still answers null - which reads as "the app never fetched anything".
      const p = res
        .json()
        .then((body) => {
          this.responses.push({
            at: Date.now(),
            status: res.status(),
            query: decodeURIComponent(res.url().split(LIST_PATH)[1] || ''),
            rawQuery: res.url().split(LIST_PATH)[1] || '',
            count: typeof body.count === 'number' ? body.count : null,
            next: body.next || '',
            results: Array.isArray(body.results) ? body.results : [],
          });
        })
        .catch(() => {});
      this._parsing.push(p);
    });
  }

  async flush() {
    const pending = this._parsing || [];
    this._parsing = [];
    await Promise.all(pending);
  }

  requestCount() {
    return (this.requests || []).length;
  }

  async responseCount() {
    await this.flush();
    return (this.responses || []).length;
  }

  // Without a flush - for the poll inside settleAgainstServer, which flushes itself.
  responseCountSync() {
    return (this.responses || []).length;
  }

  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline).map((r) => r.query);
  }

  async responsesSince(baseline = 0) {
    await this.flush();
    return (this.responses || []).slice(baseline);
  }

  async lastListResponse() {
    await this.flush();
    const log = this.responses || [];
    return log.length ? log[log.length - 1] : null;
  }

  // The server's own total for the last list query. Preferred over a rendered row count wherever
  // a figure is compared against another figure - see reason 3 in install().
  async lastListCount() {
    const last = await this.lastListResponse();
    return last ? last.count : null;
  }

  async lastListQuery() {
    const last = await this.lastListResponse();
    return last ? last.query : null;
  }

  // ============================== navigation & settling ==============================

  // `params` is written straight onto the query string, so a step can deep-link a search, a date
  // range, both, or a deliberately invalid value.
  async navigate(params = {}) {
    const qs = new URLSearchParams(params).toString();
    await this.page.goto(qs ? `${this.url}?${qs}` : this.url, { waitUntil: 'domcontentloaded' });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await this.settleList();
  }

  // Resolve on ROWS OR THE EMPTY STATE, never on rows alone: this agent's log is populated, but a
  // narrow range or an unmatched search legitimately renders nothing, and a rows-only wait would
  // hang for exactly the cases several scenarios exist to inspect.
  async settleList(timeout = 25000) {
    const which = await Promise.race([
      this.items.first().waitFor({ state: 'visible', timeout }).then(() => 'rows'),
      this.emptyState.waitFor({ state: 'visible', timeout }).then(() => 'empty'),
    ]).catch(() => 'neither');
    return which;
  }

  // >>> THE LIST KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. <<<
  // So a read taken after a fixed delay is not reading the result of the action just performed -
  // it does not fail, it reports the OLD list as the new one. Nothing in the DOM distinguishes
  // the two, and settleList() resolves on stale rows just as happily.
  //
  // Every action that changes the list goes through this: wait for a response newer than
  // `baseline`, then poll the render until it matches that payload. DO NOT ADD ONE THAT DOES NOT.
  //
  // Matched against `results.length`, NEVER `count`: the endpoint pages at 10, so a higher count
  // is correct and the render legitimately stops there.
  async settleAgainstServer(baseline, timeout = 30000) {
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await this.flush();
      if (this.responseCountSync() > baseline) break;
      await this.page.waitForTimeout(150);
    }
    await this.flush();
    if (this.responseCountSync() <= baseline) return null;

    const latest = await this.lastListResponse();
    const want = latest.results.length;
    while (Date.now() < deadline) {
      const rendered = await this.items.count();
      if (rendered === want) break;
      // An empty payload renders the empty state, which is a match too.
      if (want === 0 && (await this.emptyState.isVisible().catch(() => false))) break;
      await this.page.waitForTimeout(150);
    }
    /* eslint-enable no-await-in-loop */
    return latest;
  }

  // ============================== the list ==============================

  async rowCount() {
    return this.items.count();
  }

  // >>> ONE ENTRY PER `.activity-log-item`, AND THE TEXT IS NEVER DE-DUPLICATED. <<<
  // The identical reader on the candidate view-profile tab was first written to climb from a
  // date-shaped leaf to "an ancestor holding three <p>s", which reaches one row from several
  // ancestors - so it de-duplicated on headline|description|date and COLLAPSED 10 ROWS INTO 5.
  // That is worse than under-counting: rows that are genuinely distinct can render identically
  // (two entries a minute apart with the same headline), so a content de-duplication HIDES REAL
  // ACTIVITY and would let "every entry the server returned is rendered" pass with half missing.
  // Counting the app's own row elements cannot drift from what the page shows.
  async readEntries() {
    return this.items.evaluateAll((rows) =>
      rows.map((row) => {
        const paras = [...row.querySelectorAll('p')].map((p) => p.textContent.trim());
        return {
          headline: paras[0] || null,
          description: paras[1] || null,
          timestamp: paras[2] || null,
          text: row.innerText.replace(/\s+/g, ' ').trim(),
        };
      })
    );
  }

  // ============================== search ==============================

  async searchValue() {
    return this.searchInput.inputValue();
  }

  // Clear the box, settling only if it actually had something in it.
  //
  // >>> THE CONTROL FIRES ONLY WHEN THE VALUE CHANGES. <<< Clearing an already-empty box sends
  // nothing, so an unconditional settle here would wait out its whole budget and report a
  // working control as broken. Returns the response if one was made, else null.
  async clearSearch(timeout = 25000) {
    const before = (await this.searchValue()).length;
    if (!before) return null;
    const baseline = await this.responseCount();
    await this.searchInput.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.press('Backspace');
    return this.settleAgainstServer(baseline, timeout);
  }

  // Type `term` and wait for the list it produces.
  //
  // It CLEARS FIRST for the same reason: typing a term equal to the one already applied sends
  // nothing at all, and the read would then be of the previous result. That is also what lets a
  // variations table drive two terms that happen to be identical (an all-lowercase name in
  // "upper case" and in "lower case") without one silently measuring the other.
  //
  // Real keystrokes, never fill(): the box is debounced (~1.2s measured) and a single scripted
  // value-set is not what the app listens to.
  async searchFor(term, timeout = 30000) {
    await this.clearSearch(timeout);
    const baseline = await this.responseCount();
    await this.searchInput.click();
    if (term) await this.searchInput.pressSequentially(String(term), { delay: 25 });
    const res = await this.settleAgainstServer(baseline, timeout);
    return res;
  }

  // Type a term and report EVERY list request it produced, without asserting one was made. The
  // reader for "a whitespace-only term is sent to the server anyway" and for "no request is
  // fired at all", which are different findings and must not be conflated.
  async searchWatchingRequests(term, settleMs = 4000) {
    await this.clearSearch();
    const reqBase = this.requestCount();
    const resBase = await this.responseCount();
    await this.searchInput.click();
    if (term) await this.searchInput.pressSequentially(String(term), { delay: 25 });
    await this.page.waitForTimeout(settleMs);
    await this.flush();
    return {
      term,
      requests: this.requestsSince(reqBase),
      responses: await this.responsesSince(resBase),
      rendered: await this.rowCount(),
      url: this.page.url(),
    };
  }

  // ============================== the date range ==============================

  // The label the trigger is currently showing, i.e. the applied range.
  async currentDurationLabel() {
    return (await this.durationTrigger.innerText()).trim();
  }

  async openDurationMenu(timeout = 10000) {
    if (await this.durationMenu.isVisible().catch(() => false)) return;
    await this.durationTrigger.click();
    await this.durationMenu.waitFor({ state: 'visible', timeout });
  }

  async closeDurationMenu() {
    if (!(await this.durationMenu.isVisible().catch(() => false))) return;
    await this.page.keyboard.press('Escape');
    await this.durationMenu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async durationMenuIsOpen() {
    return this.durationMenu.isVisible().catch(() => false);
  }

  // Every option the popover offers, in DOM order. Read by ROLE, so the two flanking
  // <button aria-label="Dismiss"> elements cannot be counted as options.
  async readDurationOptions() {
    await this.openDurationMenu();
    return this.durationOptions.evaluateAll((els) =>
      els.map((e) => ({
        label: e.textContent.trim(),
        selected: e.getAttribute('aria-selected') === 'true',
      }))
    );
  }

  // Pick a range and wait for the list it produces. Returns the response, or null when the app
  // correctly made no request (re-picking the range already applied).
  async selectDuration(label, timeout = 30000) {
    await this.openDurationMenu();
    const baseline = await this.responseCount();
    await this.durationMenu.getByRole('option', { name: label, exact: true }).click();
    await this.durationMenu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    return this.settleAgainstServer(baseline, timeout);
  }

  // Pick a range and report what it produced WITHOUT requiring a request - the reader for
  // "re-picking the same range fires nothing", where the absence is the assertion.
  async selectDurationWatchingRequests(label, settleMs = 3000) {
    await this.openDurationMenu();
    const reqBase = this.requestCount();
    const resBase = await this.responseCount();
    await this.durationMenu.getByRole('option', { name: label, exact: true }).click();
    await this.durationMenu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(settleMs);
    await this.flush();
    return {
      label,
      requests: this.requestsSince(reqBase),
      responses: await this.responsesSince(resBase),
      rendered: await this.rowCount(),
      url: this.page.url(),
    };
  }

  // react-aria's aria-hidden mirror <select>. Read only to compare it against the popover - it
  // carries a BLANK option the popover does not offer, which is NOT user-selectable and NOT a
  // defect (the same mirror on the candidate view-profile tab was checked and recorded there).
  // Written down so nobody reports it a second time.
  async readMirrorOptions() {
    return this.page.evaluate(() => {
      const host = document.querySelector('[data-testid="hidden-select-container"]');
      const sel = host ? host.querySelector('select') : document.querySelector('select');
      if (!sel) return null;
      return {
        value: sel.value,
        options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })),
      };
    });
  }

  // ============================== empty state ==============================

  // Both lines as the page renders them, or null when the list is populated. Re-read every time
  // it is asked for: a cached snapshot would let a scenario that asserts one state, changes the
  // query, then asserts another, pass no matter what the app did.
  async readEmptyState() {
    // TWO components render an empty list, and the reader must see both (re-measured 2026-10-01):
    //  - `.section-empty-state` - the TAB-LEVEL state, "No activity to show", shown when nothing
    //    narrows the list (the default range, no search) and it is still empty;
    //  - a bare `<section>` holding an `<h3>` "No results found", a cause-specific `<p>`, and a
    //    "Clear all filters" CTA for narrowed queries. The feature asserts the requested shared copy.
    // The second component is the product's FIX for the old one-message-for-two-causes defect.
    // Keyed on `.section-empty-state` alone, this reader answered null for it and reported a
    // working empty state as missing - which is exactly how two scenarios went red against a fix.
    return this.page.evaluate(() => {
      const visible = (el) => !!el && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden';
      const main = document.querySelector('main') || document.body;
      // Boxes are measured RELATIVE TO <main> and corrected for its scroll, so two states can be
      // compared for position whatever the window or the scroll offset was.
      const origin = main.getBoundingClientRect();
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          top: Math.round(b.top - origin.top + main.scrollTop),
          left: Math.round(b.left - origin.left),
          width: Math.round(b.width),
          height: Math.round(b.height),
          centreX: Math.round(b.left - origin.left + b.width / 2),
        };
      };
      const geometry = (host, heading) => ({
        host: box(host), heading: box(heading), illustration: box(host.querySelector('svg')),
      });
      const legacy = main.querySelector('.section-empty-state');
      if (visible(legacy)) {
        const paras = [...legacy.querySelectorAll('p')].map((p) => p.textContent.trim());
        return {
          variant: 'tab-level', heading: paras[0] || null, body: paras[1] || null,
          cta: [...legacy.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean),
          text: legacy.innerText.trim(),
          geometry: geometry(legacy, legacy.querySelector('p')),
        };
      }
      // Structural: a section holding a heading and NO activity rows. Never matched on wording -
      // a reader looking for the copy we expect can only ever answer "absent" when it changes.
      const host = [...main.querySelectorAll('section')].find((sec) => visible(sec)
        && sec.querySelector('h1, h2, h3, h4') && !sec.querySelector('.activity-log-item'));
      if (!host) return null;
      const h = host.querySelector('h1, h2, h3, h4');
      const body = h.parentElement.querySelector('p');
      return {
        variant: 'no-results', heading: h.textContent.trim(), body: body ? body.textContent.trim() : null,
        cta: [...host.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean),
        text: host.innerText.trim(),
        geometry: geometry(host, h),
      };
    });
  }

  // The empty state's "Clear All" CTA. Matched on /clear all/i rather than the exact label - the
  // build says "Clear all filters", the requirement says "Clear All", and a label nit must not
  // stop the behaviour being asserted. Scoped to the empty-state host so it can never resolve to
  // anything else on the page.
  clearAllButton() {
    return this.emptyState.getByRole('button', { name: /clear all/i });
  }

  // Click Clear All and wait for the list it produces. MEASURED: one click fires TWO requests -
  // first the default range WITH the search still on it, then the default range alone - so the
  // first response is an intermediate state. Waiting for "a newer response" alone would settle on
  // it and report the search as never cleared.
  async clickClearAll(timeout = 30000) {
    const baseline = await this.responseCount();
    await this.clearAllButton().click();
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await this.flush();
      const fresh = this.responses.slice(baseline);
      if (fresh.length && !/(^|&)search=/.test(fresh[fresh.length - 1].query)) break;
      await this.page.waitForTimeout(200);
    }
    /* eslint-enable no-await-in-loop */
    await this.settleAgainstServer(this.responseCountSync() - 1, 10000);
    return this.responses.slice(baseline).map((r) => r.query);
  }

  // >>> NO DATE RANGE IS GUARANTEED TO BE EMPTY ON A LIVE, GROWING LOG. <<<
  // A "range only, nothing found" state can therefore not be reached honestly by data alone - the
  // narrowest range held 1 entry one week and 0 the next. This answers the list endpoint with an
  // empty page so the RENDERING of that state can be asserted deterministically. What is under
  // test is the page's reaction to an empty result for a given cause, which the server's real
  // answer does not change. Always paired with unstubEmptyList(); the caller records the stub.
  async stubEmptyList() {
    this._emptyStub = (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    });
    await this.page.route(`**${LIST_PATH}**`, this._emptyStub);
  }

  async unstubEmptyList() {
    if (!this._emptyStub) return;
    await this.page.unroute(`**${LIST_PATH}**`, this._emptyStub).catch(() => {});
    this._emptyStub = null;
  }

  async hasItemsContainer() {
    return (await this.page.locator(ITEMS_CONTAINER).count()) > 0;
  }

  // ============================== infinite scroll ==============================

  // The list appends as <main> is scrolled. NOTE the scroller is <main>, not the window - the
  // app lays the page out with `flex-1 min-h-0 overflow-y-auto` there, so window.scrollTo does
  // nothing at all and a reader built on it concludes there is no more to load.
  scroller() {
    return this.page.locator('main').first();
  }

  // Scroll to the bottom `times` times, waiting for a new response after each. Returns what each
  // pass produced, so a step can assert the pages were requested IN ORDER and that the rendered
  // count GREW - a build that re-requested page 1 forever would satisfy "a request was made".
  async scrollForMore(times = 2, timeout = 20000) {
    const passes = [];
    for (let i = 0; i < times; i += 1) {
      /* eslint-disable no-await-in-loop */
      const before = await this.rowCount();
      const baseline = await this.responseCount();
      await this.scroller().evaluate((m) => m.scrollTo(0, m.scrollHeight));
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await this.flush();
        if (this.responseCountSync() > baseline) break;
        await this.page.waitForTimeout(200);
      }
      const gained = await this.responsesSince(baseline);
      // Let the appended rows paint before the next pass measures them.
      await this.page.waitForTimeout(700);
      passes.push({
        pass: i + 1,
        before,
        after: await this.rowCount(),
        queries: gained.map((r) => r.query),
      });
      /* eslint-enable no-await-in-loop */
    }
    return passes;
  }

  async scrollTop() {
    return this.scroller().evaluate((m) => m.scrollTop);
  }

  // ============================== the URL ==============================

  // The query string as an object, so a step compares values rather than substring-matching a
  // URL. `decodeURIComponent` is deliberately NOT used to build this: it does not turn "+" back
  // into a space, so a multi-word term compared that way can never match - the trap that makes
  // active-candidate.js's shared "the URL should contain the search term" unusable here.
  // URLSearchParams decodes "+" correctly.
  urlParams() {
    const u = new URL(this.page.url());
    return Object.fromEntries(u.searchParams.entries());
  }

  currentPath() {
    return new URL(this.page.url()).pathname;
  }
}

module.exports = ActivityLogPage;
