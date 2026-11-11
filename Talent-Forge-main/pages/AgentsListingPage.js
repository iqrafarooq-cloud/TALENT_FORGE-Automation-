const BasePage = require('./BasePage');

// AgentsListingPage — Page Object for the SUPERADMIN "User Management > Agents"
// listing at /agents, which is where the invite lifecycle is observed.
//
// Live DOM verified 2026-07-30:
//   route            /agents            (default tab: Active)
//                    /agents?tab=inviteSent | ?tab=requiresAttention | ?tab=deactivated
//                    a search adds ?q=<term>
//   left nav         "User Management" group with the sub-links Agents -> /agents and
//                    Candidates -> /candidates
//   page heading     h1 "User Management - Agents"
//   search           [role=searchbox] "Search by agent name..."
//   invite CTA       <a href="/agents/invite">Invite Agent</a>   (a LINK, not a button)
//   tabs             [role=radiogroup] with [role=radio]s:
//                    Active | Invite Sent | Requires Attention | Deactivated
//   grid             [role=grid] "Agents"; each row is [role=row] whose [role=rowheader]
//                    holds the agent NAME and EMAIL on separate <p>s
//
//   Columns and row actions differ per tab — this is the whole point of the lifecycle:
//     Active       Agent | University | Status | Total Candidates | Monthly Target Progress
//                  | Actions        -> View / Edit / Open menu (Log in as agent, Deactivate)
//     Invite Sent  Agent | University | Status | Actions
//                                     -> Edit / Resend Invite
//     Deactivated  Agent | University | Status | Transferred Candidates to | Actions
//
//   Invite Sent empty state: h3 "No pending invites" + "Invited agents who haven't
//   accepted yet will appear here."
//   Resend Invite opens a [role=dialog] "Resend Invitation" (Cancel / Resend Invite) ->
//     POST /core/api/v1/admin/invite/resend/agent/ -> toast "Invite re-sent successfully."
//     Dialog body: "You're about to resend the invitation to: <email> They'll receive a new email
//     with the signup link. Any previous invite links will no longer work."
//
//   >>> THERE IS NO RESEND COOLDOWN. Measured 2026-09-03, scripts/probe-resend-cooldown.js:
//       after a successful resend the row's Resend Invite icon is sampled at 100ms for 15s (129
//       samples) and is NEVER disabled - `disabled` false, `aria-disabled` absent,
//       cursor: pointer, opacity 1 throughout. No countdown text anywhere on the page, no
//       tooltip, no 429 and no Retry-After header; the endpoint answers 200
//       {"detail":"Invite re-sent successfully."} and answered 200 again for the SAME address
//       minutes later, so there is no server-side throttle either.
//
//       Do not write a test that waits for this icon to re-enable - it never disables. The one
//       place in this product that DOES have a resend cooldown is the candidate's
//       /email-verification and forgot-password "Resend Email" button, which renders its own
//       countdown in the label ("Resend Email in 00:56"); see SignupPage.js.
//   Deactivate Account opens "Deactivate Agent Account" (Cancel / Deactivate) ->
//     POST /core/api/v1/agent/<id>/deactivate/ -> the row moves to the Deactivated tab.
//
// IMPORTANT — searching: the box is labelled "Search by agent name...", but that label
// UNDERSTATES it. Re-measured live 2026-08-11 (scripts/probe-agent-management.js): one
// `search=` param is sent and the backend matches the agent NAME, the EMAIL and the
// UNIVERSITY name, case-insensitively and on partial words —
//   "alexa smith" / "alexa" / "ALEXA SMITH" -> the row
//   "alex@addy.com"                          -> the row (so email DOES match)
//   "King Saud University"                   -> every agent at that university
// The older note here said email did not match, citing TFF-532; that is no longer true on
// DEV, so do not "restore" a name-only assumption. Lookups still search by NAME and then
// filter the rows on the FULL email, which remains right for a different reason: a partial
// term can match several agents, and filtering on the exact email is what makes a lookup
// unambiguous.
const TAB_PARAM = {
  active: null,
  'invite sent': 'inviteSent',
  'requires attention': 'requiresAttention',
  deactivated: 'deactivated',
};

// The four tabs are NOT a partition of the agent population — verified live 2026-07-30 by
// watching the request each tab fires:
//   Active              GET /core/api/v1/agent/?status=ACTIVE&status=ATTENTION
//   Invite Sent         GET /core/api/v1/agent/?status=INVITE_SENT
//   Requires Attention  GET /core/api/v1/agent/?status=ATTENTION
//   Deactivated         GET /core/api/v1/agent/?status=DEACTIVATED
// "Requires Attention" is an OVERLAY on Active, not a lifecycle stage: it renders different
// columns (Agent | University | Issue | Severity | Last Activity | Actions) and every freshly
// activated agent with no candidates is immediately "Target progress behind schedule", so it
// appears on Active AND Requires Attention at the same time.
//
// Anything that COUNTS agents must therefore walk only the exclusive tabs, or it reports one
// agent as two.
const EXCLUSIVE_TABS = ['Active', 'Invite Sent', 'Deactivated'];
const OVERLAY_TABS = ['Requires Attention'];

class AgentsListingPage extends BasePage {
  constructor(page) {
    super(page);
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    this.origin = origin;
    this.url = `${origin}/agents`;

    this.pageHeading = page
      .locator('[data-testid="agents-heading"]')
      .or(page.getByRole('heading', { name: /user management\s*-\s*agents/i }))
      .first();
    this.searchInput = page
      .locator('[data-testid="agents-search"]')
      .or(page.getByRole('searchbox', { name: /search by agent name/i }))
      .or(page.locator('input[type="search"], input[placeholder*="Search" i]'))
      .first();
    this.inviteCta = page
      .locator('[data-testid="agents-invite-cta"]')
      .or(page.getByRole('link', { name: /^invite agents?$/i }))
      .or(page.getByRole('button', { name: /^invite agents?$/i }))
      .first();
    this.tabGroup = page.locator('[role="radiogroup"]').first();
    this.grid = page.locator('[role="grid"]').first();
    this.rows = page.locator('[role="row"]');
    this.emptyStateHeading = page.locator('h3').first();

    // ---- Sub-tabs of User Management in the left nav ----
    this.navAgentsLink = page.getByRole('link', { name: /^agents$/i }).first();

    // ---- Confirmation dialogs ----
    this.resendDialog = page.locator('[role="dialog"]').filter({ hasText: /resend invitation/i }).first();
    this.deactivateDialog = page.locator('[role="dialog"]').filter({ hasText: /deactivate agent account/i }).first();
    this.toast = page.locator('.Toastify__toast, .Toastify__toast-body, [role="status"], [role="alert"]');
  }

  // ==================== Navigation ====================

  async goto(tab = 'Active') {
    const param = TAB_PARAM[String(tab).trim().toLowerCase()];
    await super.navigate(param ? `${this.url}?tab=${param}` : this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.searchInput.waitFor({ state: 'visible', timeout: 60000 });
    await this.settle();
  }

  async isOnListing() {
    return /\/agents(\?|$)/.test(this.page.url()) && !/\/agents\/(invite|view|edit)/.test(this.page.url());
  }

  async clickInviteCta() {
    await this.inviteCta.click();
    await this.page.waitForURL(/\/agents\/invite/, { timeout: 30000 });
  }

  // Either the grid or the empty state has to be on screen before a row read is
  // meaningful; without this a fast assertion reads a still-loading table as "empty".
  //
  // NOTE the extra condition on rows that actually hold an email. The grid paints SKELETON
  // rows first — ten [role=row]s whose cells are all blank — so "the grid is visible" is
  // reached while there is still nothing to read, and a reader timed on it reports ten
  // agents with no names. Measured 2026-08-11.
  async settle(timeout = 30000) {
    await Promise.race([
      this.grid.waitFor({ state: 'visible', timeout }).catch(() => {}),
      this.page.locator('h3').first().waitFor({ state: 'visible', timeout }).catch(() => {}),
    ]);
    const deadline = Date.now() + Math.min(timeout, 20000);
    while (Date.now() < deadline) {
      const ready = await this.page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'))
          .filter((r) => !r.querySelector('[role="columnheader"]'));
        const filled = rows.some((r) => /@/.test(r.innerText || ''));
        const empty = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
          .some((h) => /no results|no pending|no agents|not found/i.test(h.innerText || ''));
        return filled || empty;
      }).catch(() => false);
      if (ready) break;
      await this.page.waitForTimeout(300);
    }
    await this.page.waitForTimeout(400);
  }

  // ==================== Waiting on the LIST REQUEST, not the DOM ====================

  // THE MOST IMPORTANT READER IN THIS FILE. Every filter/search/pagination assertion has to
  // go through it.
  //
  // Why: settle() above is satisfied by rows that hold an email — and the PREVIOUS query's
  // rows satisfy that the instant Apply is clicked. So a read timed on the DOM alone
  // silently returns the page that was already there. That is not a hypothetical: the first
  // version of scripts/probe-agent-management.js reported the identical ten rows for all
  // eight filter options and read as "the backend ignores every filter". Waiting for the
  // response instead (scripts/probe-agent-filter-truth.js) showed every filter is honoured
  // exactly — counts 0/1/0/1/115/80/0/1, no row violating its range. The defect was entirely
  // in the reader.
  //
  // Returns the parsed payload so an assertion can be made against the SERVER's own answer
  // rather than against scraped text, and so a failure can quote both.
  async runAndWaitForList(action, { timeout = 45000 } = {}) {
    const pending = this.page.waitForResponse(
      (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET',
      { timeout },
    );
    await action();
    let payload = null;
    let requestUrl = '';
    try {
      const response = await pending;
      requestUrl = response.url();
      payload = await response.json().catch(() => null);
    } catch {
      // No request fired. That is a real outcome for some inputs (a whitespace-only search
      // sends nothing at all), so it is reported rather than thrown.
      return { requestUrl: '', payload: null, requestFired: false };
    }
    await this.settle();
    return { requestUrl, payload, requestFired: true };
  }

  // The agents in a payload, reduced to what the assertions care about.
  static agentsFrom(payload) {
    if (!payload) return [];
    const items = payload.results || payload.data || payload.items || [];
    return items.map((a) => ({
      email: a.email,
      name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      university: a.institution_name,
      universityId: String(a.institution_id ?? ''),
      status: a.status,
      candidates: Number(a.total_candidate_count ?? -1),
      progress: Number((a.monthly_progress || {}).percentage ?? -1),
      // `pending_email` is the ONLY machine-readable statement of a half-finished email
      // change - null in the settled state, the unverified new address while one is in
      // flight. It was missing here until 2026-09-04, and three steps in
      // steps/edit-email.js read it: two of them ("still listed with the original address",
      // "no pending marker") were passing on `undefined` and so asserting nothing, and the
      // third ("the server should record the new address as pending") could only ever fail.
      // CandidatesListingPage.candidatesFrom() has always exposed it; the two readers are
      // one vocabulary and must agree.
      pendingEmail: a.pending_email,
      emailVerified: a.is_email_verified,
    }));
  }

  // ==================== Tabs ====================

  // Each tab is a <button role="radio" aria-checked> that CARRIES ITS OWN LABEL as text —
  // verified live 2026-07-30. Reading the parent instead (as this used to) returns the
  // whole strip, "Active Invite Sent Requires Attention Deactivated", four times over, so
  // every per-tab lookup silently failed to match.
  async tabNames() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="radio"]')).map((r) => {
        const own = (r.innerText || '').replace(/\s+/g, ' ').trim();
        if (own) return own;
        const aria = (r.getAttribute('aria-label') || '').trim();
        if (aria) return aria;
        // Last resort: climb, but only while the ancestor still holds exactly this one tab.
        let node = r.parentElement;
        for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
          if (node.querySelectorAll('[role="radio"]').length !== 1) break;
          const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
          if (text) return text;
        }
        return '';
      }).filter(Boolean)
    );
  }

  tab(name) {
    return this.page.getByRole('radio', { name: new RegExp(`^${escapeRegExp(String(name).trim())}$`, 'i') }).first();
  }

  async openTab(name) {
    const radio = this.tab(name);
    await radio.click({ force: true });
    await this.page.waitForTimeout(1200);
    await this.settle();
  }

  async selectedTab() {
    const names = await this.tabNames();
    for (const name of names) {
      if (await this.tab(name).isChecked().catch(() => false)) return name;
    }
    return '';
  }

  async isTabSelected(name) {
    return this.tab(name).isChecked().catch(() => false);
  }

  // ==================== Structure ====================

  async columnHeaders() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="columnheader"]')).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim())
    );
  }

  async emptyStateText() {
    return this.page.evaluate(() => {
      const h = document.querySelector('h3');
      if (!h) return '';
      const wrap = h.parentElement || h;
      return (wrap.innerText || '').replace(/\s+/g, ' ').trim();
    });
  }

  async rowCount() {
    const total = await this.rows.count();
    // The header row is a [role=row] too.
    return Math.max(0, total - 1);
  }

  // ==================== Searching / reading rows ====================

  // Type a term and wait for the request it causes, so the rows read afterwards are this
  // term's rows and not the previous term's. A whitespace-only term sends NO request (the
  // app trims it and restores the unfiltered list), which is why `requestFired` is returned
  // rather than treated as a failure.
  // >>> SEARCHING THE SAME TERM TWICE FIRES NO REQUEST. <<< Measured 2026-09-04: pass 1 issues
  // `GET /agent/?…&search=<term>` and returns the row; passes 2 and 3 issue NOTHING, because
  // the box already holds that term and the list on screen is already its result. The caller
  // then received `payload: null`, `agentsFrom()` returned `[]`, and any payload-based reader
  // reported the record as absent from a listing that was displaying it - which is how three
  // scenarios came to claim `<address> was not returned by the listing endpoint` about an
  // address plainly on screen. Exactly the trap already recorded for `goToPrevPage()` one
  // section down; the remedy has to live here rather than in each caller.
  //
  // >>> THE TERM LIVES IN THE URL AS `?q=`, WHICH IS WHY RETYPING IT NEVER FIRES AGAIN. <<<
  // Measured 2026-09-04: pass 1 puts the app on `/agents?q=<term>`; from then on the box
  // already holds that value, `fill()` produces no change event, and the caller received
  // `payload: null` while the row sat on screen. Three remedies were tried against the live
  // app before this one, and the failures are the useful part of the note:
  //   - clearing to "" in between - an empty term sends nothing at all (see above), so the
  //     intermediate step fired nothing either;
  //   - a non-empty SENTINEL term - the sentinel's own request fired, then re-typing the real
  //     term after it still fired nothing;
  //   - a RELOAD followed by typing - the reload does refetch, from `?q=` in the URL, but that
  //     fetch happens before a wait armed around the later `fill()` can see it, and the
  //     `fill()` itself is a no-op because the box came back already filled.
  //
  // So the repeat is driven the way the app itself drives it: NAVIGATE with `q` set, with the
  // wait armed around the navigation. Existing params are preserved, so the tab is not lost -
  // note pass 1's own typing REPLACES `?tab=active` with `?q=`, so the tab has to be carried
  // explicitly rather than assumed to still be there.
  //
  // Replaying a remembered payload was rejected: callers search the same address before AND
  // after committing a change, so a cached answer would hand back the PRE-CHANGE row and
  // `pending_email` would read as null on a change that had just been accepted. This reader
  // exists precisely to state what the server holds NOW.
  //
  // The first attempt gets a SHORT window: a debounced search answers in well under a second,
  // so all a 45s wait buys on the no-request path is a 45s stall per call.
  async search(term, { tab } = {}) {
    const wanted = String(term);
    await this.settle();
    const result = await this.runAndWaitForList(async () => {
      await this.searchInput.fill('');
      await this.searchInput.fill(wanted);
    }, { timeout: 12000 });
    if (result.requestFired) return { ...result, refetched: false };

    // A term that trims to nothing sending NO request is the very outcome under test, so it must
    // be returned as measured. The repeat path below would navigate to `?q=+++` itself, and the
    // list request THAT reload fires was being reported as "the app sent a whitespace search"
    // (measured 2026-10-07: nothing fired in the 12s after typing; the request came ~1s after the
    // suite's own navigation).
    if (wanted.trim() === '') return { ...result, refetched: false };

    await this.settle();
    const url = new URL(this.page.url());
    // The param NAME is read off the URL the app itself produced rather than hardcoded - the
    // first search has already put the term there, so whichever key holds it is the key to
    // set. Measured as `q` here; deriving it means the sibling listing needs no second
    // measurement and a rename in the app does not silently break the repeat path.
    let key = 'q';
    for (const [k, v] of url.searchParams.entries()) {
      if (v === wanted) { key = k; break; }
    }
    url.searchParams.set(key, wanted);
    const tabParam = tab ? TAB_PARAM[String(tab).trim().toLowerCase()] : null;
    if (tabParam) url.searchParams.set('tab', tabParam);
    const forced = await this.runAndWaitForList(async () => {
      await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    }, { timeout: 45000 });
    await this.searchInput.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    if (!forced.requestFired) await this.settle();
    return { ...forced, refetched: true };
  }

  async readRows() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => {
          const header = r.querySelector('[role="rowheader"]');
          // The rowheader carries the agent's NAME and EMAIL on two separate lines. It used to
          // render them as two <p>s and now renders them as two
          // <button><span>…</span></button> pairs (react-aria; measured 2026-09-03), so the
          // lines are taken from innerText rather than from a tag name. A `p` selector returned
          // "" for BOTH fields against a grid rendering perfectly well, and every step that
          // filters rows on `r.email` then reported "No agent rows on the current tab" — which
          // reads as the listing being broken rather than the reader.
          const lines = header
            ? String(header.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean)
            : [];
          const cells = Array.from(r.querySelectorAll('[role="gridcell"]')).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim());
          return {
            text: (r.innerText || '').replace(/\s+/g, ' ').trim(),
            name: lines.find((t) => !t.includes('@')) || '',
            email: lines.find((t) => t.includes('@')) || '',
            university: cells[0] || '',
            status: cells[1] || '',
            cells,
            // Row actions are ICON-ONLY buttons — verified live 2026-07-30: innerText is
            // empty and the label lives on aria-label ("Edit", "Resend Invite"), so reading
            // text alone reported every row as having no actions at all.
            //
            // SCOPED TO THE ACTIONS CELL on purpose. Every other cell now wraps its own text
            // in a <button> as well, so an unscoped read returned the agent's name, email and
            // university as "actions". A reader that resolves to page content is worse than one
            // that resolves to nothing: the failure it produces describes a defect the app does
            // not have.
            actions: Array.from(
              (r.querySelector('[role="gridcell"][data-key$=":actions"]')
                || r.querySelector('[role="gridcell"]:last-child')
                || r).querySelectorAll('button, [role="button"]'),
            )
              .map((b) => ((b.getAttribute('aria-label') || '').trim()
                || (b.getAttribute('title') || '').trim()
                || (b.innerText || '').replace(/\s+/g, ' ').trim()))
              .filter(Boolean),
          };
        })
    );
  }

  // Poll until the agent shows up on `tab`. The lifecycle transition is driven by a
  // backend state change, so it is not instantaneous after the agent's first login.
  //
  // On failure this sweeps the other tabs and names the one the agent is ACTUALLY on. That
  // is the whole difference between a report that says "never appeared on Invite Sent" and
  // one that says "it is on Active" — the second is the defect, the first is a shrug.
  async waitForAgentOnTab(tab, { name, email, timeout = 120000 } = {}) {
    const deadline = Date.now() + timeout;
    let lastRows = [];
    while (Date.now() < deadline) {
      await this.goto(tab);
      if (name) await this.search(name);
      lastRows = await this.readRows();
      const hit = lastRows.find((r) => r.text.toLowerCase().includes(String(email || name).toLowerCase()));
      if (hit) return hit;
      await this.page.waitForTimeout(5000);
    }
    const elsewhere = await this.whereIsAgent({ name, email, exclude: tab });
    throw new Error(
      `"${email || name}" never appeared on the "${tab}" tab within ${timeout}ms. `
      + `Rows last seen there: ${JSON.stringify(lastRows.map((r) => r.email || r.name))}. `
      + (elsewhere.length
        ? `It IS listed on: ${elsewhere.map((e) => `"${e.tab}" (status "${e.status}", actions ${JSON.stringify(e.actions)})`).join('; ')}`
        : 'It is on no other tab either.')
    );
  }

  // Which tab(s) hold this agent right now. Used to explain a failed tab expectation, and
  // to make "not on tab X" provable rather than merely unobserved.
  async whereIsAgent({ name, email, exclude } = {}) {
    const needle = String(email || name).toLowerCase();
    const found = [];
    for (const tab of [...EXCLUSIVE_TABS, ...OVERLAY_TABS]) {
      if (exclude && tab.toLowerCase() === String(exclude).trim().toLowerCase()) continue;
      await this.goto(tab);
      if (name) await this.search(name);
      const row = (await this.readRows()).find((r) => r.text.toLowerCase().includes(needle));
      if (row) found.push({ tab, status: row.status, actions: row.actions });
    }
    return found;
  }

  async waitForAgentGoneFromTab(tab, { name, email, timeout = 120000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await this.goto(tab);
      if (name) await this.search(name);
      const rows = await this.readRows();
      if (!rows.some((r) => r.text.toLowerCase().includes(String(email || name).toLowerCase()))) return true;
      await this.page.waitForTimeout(5000);
    }
    return false;
  }

  // "This agent is NOT on `tab`" — the hard direction to assert honestly, because a grid
  // that has not finished loading reads exactly like an empty one and would make the
  // assertion pass for the wrong reason.
  //
  // Two defences: the read is only trusted once the tab really is the selected one, and
  // absence has to hold over `confirmations` consecutive reads spaced apart. Returns the
  // evidence so the caller can put it in the failure message either way.
  async confirmAgentAbsentFromTab(tab, { name, email, confirmations = 2, gapMs = 2500 } = {}) {
    const needle = String(email || name).toLowerCase();
    let gridSeen = false;
    for (let i = 0; i < confirmations; i += 1) {
      await this.goto(tab);
      if (!(await this.isTabSelected(tab))) {
        return { absent: false, reason: `the "${tab}" tab never became the selected tab`, row: null, gridSeen };
      }
      if (name) await this.search(name);
      // A trustworthy read needs the grid OR an explicit empty state on screen.
      const rendered = (await this.grid.isVisible().catch(() => false))
        || Boolean(await this.emptyStateText());
      if (!rendered) {
        return { absent: false, reason: `the "${tab}" tab rendered neither a grid nor an empty state`, row: null, gridSeen };
      }
      gridSeen = true;
      const row = (await this.readRows()).find((r) => r.text.toLowerCase().includes(needle));
      if (row) return { absent: false, reason: 'the agent is listed there', row, gridSeen };
      if (i < confirmations - 1) await this.page.waitForTimeout(gapMs);
    }
    return { absent: true, reason: '', row: null, gridSeen };
  }

  rowLocator(needle) {
    return this.page.locator('[role="row"]', { hasText: String(needle) }).first();
  }

  // ==================== Row actions ====================

  async rowActions(needle) {
    const rows = await this.readRows();
    const row = rows.find((r) => r.text.toLowerCase().includes(String(needle).toLowerCase()));
    return row ? row.actions : [];
  }

  // The Active tab keeps two of its actions behind a three-dot overflow, so the inline
  // buttons alone are NOT the row's action set. `readRows()` reports the trigger itself
  // ("Open menu"); this opens it and reports what is inside.
  //
  // >>> THE ITEMS ARE role="menuitemRADIO", NOT role="menuitem". <<< react-aria renders this
  // menu with a selection mode, so a `[role="menuitem"]` reader finds NOTHING and reports an
  // empty menu for one that is open and populated — measured 2026-09-04,
  // scripts/probe-agent-row-actions.js. The prefix match covers menuitem, menuitemradio and
  // menuitemcheckbox so a change of selection mode cannot silently empty this again.
  //
  // The menu is closed again on the way out: it renders in a portal with an overlay, and a
  // menu left open swallows the next row's click.
  async rowMenuItems(needle, { trigger = 'Open menu' } = {}) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    const opener = row.getByRole('button', { name: new RegExp(`^${escapeRegExp(trigger)}$`, 'i') }).first();
    if (!(await opener.count())) return { opened: false, trigger, items: [] };
    await opener.click();
    const menu = this.page.locator('[role="menu"]').first();
    await menu.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const items = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((el) => ({
        key: el.getAttribute('data-key'),
        label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      })).filter((i) => i.label)
    );
    await this.page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(300);
    return { opened: true, trigger, items };
  }

  async clickRowMenuItem(needle, label) {
    const row = this.rowLocator(needle);
    await row.getByRole('button', { name: /^open menu$/i }).first().click();
    const menu = this.page.locator('[role="menu"]').first();
    await menu.waitFor({ state: 'visible', timeout: 15000 });
    await menu
      .locator('[role^="menuitem"]')
      .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, 'i') })
      .first()
      .click();
    await this.page.waitForTimeout(800);
  }

  async clickRowAction(needle, action) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.getByRole('button', { name: new RegExp(`^${escapeRegExp(action)}$`, 'i') }).first().click();
    await this.page.waitForTimeout(800);
  }

  // ---- Resend Invite ----

  async openResendDialog(needle) {
    await this.clickRowAction(needle, 'Resend Invite');
    await this.resendDialog.waitFor({ state: 'visible', timeout: 20000 });
  }

  async resendDialogText() {
    return (await this.resendDialog.innerText()).replace(/\s+/g, ' ').trim();
  }

  async confirmResend() {
    await this.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
    await this.resendDialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(1500);
  }

  async cancelDialog() {
    const dlg = this.page.locator('[role="dialog"]').first();
    if (await dlg.isVisible().catch(() => false)) {
      await dlg.getByRole('button', { name: /^cancel$/i }).first().click().catch(() => {});
      await dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }

  // ---- Deactivate (used for cleanup after a provisioning run) ----

  // >>> DEACTIVATE MOVED INTO THE ROW'S OVERFLOW MENU. <<< It used to be an inline icon button
  // named "Deactivate Account"; measured 2026-10-14 the Active row offers View / Edit / Open menu
  // and the menu holds "Log in as agent" and "Deactivate". A bare inline lookup then waits out the
  // whole step budget and reports a timeout that says nothing about the move - which is how
  // Agent-Deactivate-Reactivate.feature went red on every Deactivate scenario. The inline form is
  // still tried first, so a build that brings it back keeps working.
  async clickDeactivateRowAction(needle) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    const inline = row.getByRole('button', { name: /^deactivate( account)?$/i }).first();
    if (await inline.count()) {
      await inline.click();
    } else {
      await this.clickRowMenuItem(needle, 'Deactivate');
    }
  }

  async deactivateAgent(needle) {
    await this.clickDeactivateRowAction(needle);
    await this.deactivateDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.deactivateDialog.getByRole('button', { name: /^deactivate$/i }).click();
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
    await this.page.waitForTimeout(2000);
  }

  async toastMessages() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.Toastify__toast, .Toastify__toast-body, [role="status"], [role="alert"]'))
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    );
  }

  // ==================== Counting, for the uniqueness assertions ====================

  // How many DISTINCT agents carry this email. The double-click and duplicate-email
  // scenarios both need "exactly one", and a duplicate could land on a different tab than
  // the original.
  //
  // `total` counts the EXCLUSIVE tabs only — see the note on EXCLUSIVE_TABS above. The
  // overlay tab is still visited and reported, because knowing an agent is flagged is
  // useful the moment this assertion fails, but it must never add to the count.
  // ==================== Filters modal ("Apply Filters") ====================
  //
  // Live contract, measured 2026-08-11 (scripts/probe-agent-management.js):
  //   trigger   button "Filters", which gains a COUNT once something is applied ("Filters 2")
  //   heading   "Apply Filters"
  //   groups    University       — a type-to-filter combobox, "Select university..."
  //             Target Progress  — checkboxes 1% - 25% / 26% - 50% / 51% - 75% / 76% - 100%
  //             Candidate Count  — checkboxes 0 / 1-50 / 51-100 / 100+
  //   footer    Clear All | Cancel | Apply Filters   (+ an X "Close")
  //
  // THE CHECKBOXES CARRY data-testid AND THE RAW <input> IS UNCLICKABLE. Each option is a
  // <label data-testid="filters-<group>-<slug>-checkbox"> wrapping an <input type=checkbox>
  // plus a styled <div>. Clicking the input itself always fails Playwright's hit-target
  // check — the styling div sits over its centre, so the click retries for the full timeout
  // and then reports the LABEL as the thing intercepting. Click the label; it is also the
  // only stable handle here. (Verified against the live DOM, which is why these locators
  // start from the testid rather than from a role.)
  //
  // A [role="checkbox"] selector matches NOTHING in this modal — they are real inputs with
  // an implicit role — so a reader written that way reports "no options" and any assertion
  // built on it passes vacuously. Read `.checked` off the input inside the label.
  static filterGroupKey(group) {
    const g = String(group).trim().toLowerCase();
    if (g === 'target progress') return 'targetProgress';
    if (g === 'candidate count') return 'candidateCount';
    throw new Error(`Unknown filter group "${group}" — the modal offers "Target Progress" and "Candidate Count" (plus the University combobox).`);
  }

  // "1% - 25%" -> "1-25", "26% - 50%" -> "26-50", "100+" -> "100+", "0" -> "0"
  static filterOptionSlug(option) {
    return String(option).trim().replace(/\s+/g, '').replace(/%/g, '');
  }

  filterCheckbox(group, option) {
    const key = AgentsListingPage.filterGroupKey(group);
    const slug = AgentsListingPage.filterOptionSlug(option);
    return this.page.locator(`[data-testid="filters-${key}-${slug}-checkbox"]`);
  }

  get filtersTrigger() {
    return this.page.getByRole('button', { name: /^filters\b/i }).first();
  }

  get filterDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /apply filters/i }).first();
  }

  async openFilters() {
    await this.filtersTrigger.click();
    await this.filterDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(400);
  }

  async isFilterDialogOpen() {
    return this.filterDialog.isVisible().catch(() => false);
  }

  // The label the trigger renders. Unfiltered it is exactly "Filters"; with N applied the
  // count is appended, so the applied-count assertion reads it rather than counting chips.
  async filtersTriggerLabel() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const b = Array.from(document.querySelectorAll('button')).find((x) => /^filters\b/i.test(c(x.innerText)));
      return b ? c(b.innerText) : '';
    });
  }

  async appliedFilterCount() {
    const label = await this.filtersTriggerLabel();
    const m = label.match(/^filters\s+(\d+)$/i);
    return m ? Number(m[1]) : 0;
  }

  // Every option the modal offers, per group, with its checked state — read from the real
  // inputs (see the note above on [role="checkbox"] matching nothing).
  async readFilterOptions() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /apply filters/i.test(d.innerText || ''));
      if (!dialog) return { found: false, groups: {}, options: [] };
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const options = Array.from(dialog.querySelectorAll('label[data-testid]')).map((l) => {
        const testid = l.getAttribute('data-testid') || '';
        const input = l.querySelector('input[type="checkbox"]');
        const m = testid.match(/^filters-(\w+)-(.+)-checkbox$/);
        return {
          testid,
          group: m ? m[1] : '',
          slug: m ? m[2] : '',
          label: c(l.innerText),
          checked: Boolean(input && input.checked),
        };
      });
      const groups = {};
      // The group HEADINGS are <p>s that are not themselves option labels.
      const optionTexts = new Set(options.map((o) => o.label));
      Array.from(dialog.querySelectorAll('p')).forEach((p) => {
        const t = c(p.innerText);
        if (t && !optionTexts.has(t)) groups[t] = true;
      });
      return { found: true, groupTitles: Object.keys(groups), options };
    });
  }

  async selectFilterOption(group, option) {
    const box = this.filterCheckbox(group, option);
    if (!(await box.count())) {
      const offered = (await this.readFilterOptions()).options.map((o) => `${o.group}/${o.label}`);
      throw new Error(
        `The Filters modal offers no "${option}" under "${group}". `
        + `Expected a label with data-testid "filters-${AgentsListingPage.filterGroupKey(group)}-${AgentsListingPage.filterOptionSlug(option)}-checkbox". `
        + `It offers: ${JSON.stringify(offered)}`,
      );
    }
    await box.click();
    await this.page.waitForTimeout(300);
  }

  async isFilterOptionSelected(group, option) {
    const key = AgentsListingPage.filterGroupKey(group);
    const slug = AgentsListingPage.filterOptionSlug(option);
    const found = (await this.readFilterOptions()).options
      .find((o) => o.group === key && o.slug === slug);
    return Boolean(found && found.checked);
  }

  // Apply, and hand back the payload the list was rebuilt from. Assertions read that.
  async applyFilters() {
    return this.runAndWaitForList(async () => {
      await this.page.locator('[data-testid="filters-apply-button"]').click();
    });
  }

  // Clear All inside the modal. Measured: it clears the checkboxes AND the URL immediately —
  // it does not wait for Apply — and it leaves the dialog OPEN.
  async clearAllInModal() {
    return this.runAndWaitForList(async () => {
      await this.page.locator('[data-testid="filters-clear-all-button"]').click();
    });
  }

  async cancelFilters() {
    await this.filterDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.filterDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  async closeFilterDialogVia(method) {
    const how = String(method).trim().toLowerCase();
    if (how === 'x icon' || how === 'x') {
      await this.filterDialog.locator('button[aria-label="Close" i]').first().click();
    } else if (how === 'cancel') {
      await this.filterDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    } else if (how === 'escape') {
      await this.page.keyboard.press('Escape');
    } else if (how === 'backdrop') {
      // Click the very corner of the viewport — inside the backdrop, clear of the panel.
      await this.page.mouse.click(5, 5);
    } else {
      throw new Error(`Unknown close method "${method}"`);
    }
    await this.page.waitForTimeout(1000);
  }

  // ---- The University combobox ----

  get universityCombobox() {
    return this.filterDialog.locator('input[placeholder*="university" i]').first();
  }

  // >>> "Show suggestions" IS A TOGGLE, NOT AN "OPEN". <<< Clicking it while the list is
  // already open CLOSES it. Measured 2026-09-04 (scripts/probe-agent-university-filter.js):
  //
  //   open suggestions        -> 10 options, aria-expanded="true"
  //   type "King"             -> 10 options, all King*, aria-expanded="true"
  //   open suggestions AGAIN  ->  0 options, aria-expanded="false", no [role=listbox]
  //   open suggestions again  -> 10 options, back
  //
  // `I choose a university that has agents` called this defensively after the list was
  // already open, so it CLOSED the popover it was about to read and failed with "no
  // universities were offered" — which reads as the app offering nothing for "King" when it
  // offers ten. The filter itself is fine, and `fill()` is enough to drive it (unlike the
  // candidate-profile institution combobox, which needs real keystrokes).
  //
  // Idempotent now: it opens only when the control is actually collapsed, so a defensive
  // second call is a no-op instead of a close.
  async openUniversitySuggestions() {
    const isExpanded = async () =>
      (await this.universityCombobox.getAttribute('aria-expanded').catch(() => null)) === 'true';
    if (await isExpanded()) return;
    await this.filterDialog.locator('button[aria-label="Show suggestions" i]').first().click();
    await this.page.waitForTimeout(1200);
  }

  // >>> THE "No results found." PLACEHOLDER IS ITSELF A role="option". <<< So a bare
  // `[role="option"]` reader counts it as an offered university, and
  // `the university list should offer no universities` failed reporting that the combobox
  // "still offers [\"No results found.\"]" — i.e. the app's way of saying nothing matched was
  // read as something matching.
  //
  // It is excluded STRUCTURALLY, not by its wording: a text match would break the day the
  // copy changes, and would also drop a genuine option that happened to contain the phrase.
  // Measured 2026-09-04 (scripts/probe-university-no-results.js) a real option carries
  // `data-key`, `aria-selected` and an `id`; the placeholder is a bare
  // `<div role="option" style="display: contents">` with none of them.
  async universityOptions() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"][data-key]'))
        .map((o) => (o.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
  }

  // The combobox's own empty state, so "no universities are offered" can be told apart from
  // "the popover never rendered". Returns '' when the placeholder is not on screen.
  async universityNoResultsText() {
    return this.page.evaluate(() => {
      const placeholder = Array.from(document.querySelectorAll('[role="option"]:not([data-key])'))
        .map((o) => (o.innerText || '').replace(/\s+/g, ' ').trim())
        .find(Boolean);
      return placeholder || '';
    });
  }

  async typeUniversity(term) {
    await this.universityCombobox.fill(String(term));
    await this.page.waitForTimeout(1200);
  }

  async chooseUniversity(name) {
    const option = this.page.getByRole('option', { name: String(name), exact: true }).first();
    if (await option.count()) await option.click();
    else await this.page.locator('[role="option"]').filter({ hasText: String(name) }).first().click();
    await this.page.waitForTimeout(600);
  }

  async selectedUniversity() {
    return this.universityCombobox.inputValue().catch(() => '');
  }

  // ==================== Empty state ====================

  // The listing's own empty state, scoped away from anything inside a dialog or popover —
  // while a filter popover is open there can be two "No results found" on screen and the
  // popover's is the inner one, so an unscoped innermost-first read picks the wrong one.
  async readEmptyState() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
        .filter((h) => !h.closest('[role="dialog"],[role="listbox"],[data-radix-popper-content-wrapper]'))
        .find((h) => /no results|no pending|no agents|not found/i.test(h.innerText || ''));
      if (!heading) return null;
      // >>> THE CTA IS NOT A SIBLING OF THE HEADING. <<< Measured 2026-09-04
      // (scripts/probe-agent-filtered-empty-state.js) on the filtered empty state: the
      // heading is an <h3>, and "Clear All" only appears THREE levels above it —
      //   level 0 <h3>  ctas []            level 3 <div> ctas ["Clear All"]
      //   level 1 <div> ctas []            level 4 <div> ctas ["Clear All"]
      //   level 2 <div> ctas []            level 5 <div> ctas ["Invite Agent", tabs…, "Clear All"]
      // so reading `heading.parentElement` reported `ctas: []` for an empty state rendering
      // its CTA perfectly well, and the scenario failed as though the app offered no way out
      // of a filter that matches nothing.
      //
      // Climbing a fixed number of levels instead would reach level 5 and start reporting the
      // page's own chrome — "Invite Agent" and the four lifecycle tabs — as empty-state CTAs,
      // which is the worse failure: a reader that resolves to page furniture invents defects.
      // The boundary is therefore derived: keep climbing while the ancestor's text still
      // BEGINS with the heading, i.e. while the empty state is still the whole of what that
      // ancestor contains. Level 5 begins with "Invite Agent", so the climb stops at 4.
      const headingText = c(heading.innerText);
      let wrap = heading.parentElement || heading;
      for (let i = 0; i < 6 && wrap.parentElement; i += 1) {
        if (!c(wrap.parentElement.innerText).startsWith(headingText)) break;
        wrap = wrap.parentElement;
      }
      const cta = Array.from(wrap.querySelectorAll('button,a')).map((b) => c(b.innerText)).filter(Boolean);
      return { heading: headingText, text: c(wrap.innerText), ctas: cta };
    });
  }

  // The page-level "Clear All" the filtered empty state offers (distinct from the modal's).
  // Clearing the filters returns to unfiltered page 1 — a page this session has usually
  // ALREADY fetched, so the app re-renders it from its own cache and issues NO request. Same
  // behaviour as paging backwards; see goToPrevPage().
  //
  // Measured 2026-09-04 (scripts/probe-agent-clear-all-modal-path.js): reached through the
  // Filters modal, Clear All fires no list call, lands correctly on /agents, and the default
  // wait burns its FULL 45,015ms before giving up — which is where ~50s of that scenario's
  // runtime went. Reached instead by navigating straight to a filtered URL
  // (scripts/probe-agent-clear-all-timing.js) it DOES fetch, in 812ms, because the hard
  // navigation wiped the cache. Both are correct app behaviour, and a caller cannot know in
  // advance which it will get — so the wait must not depend on a request arriving.
  async clickPageClearAll() {
    const result = await this.runAndWaitForList(async () => {
      // The empty-state CTA was renamed "Clear All" -> "Clear all filters" (2026-10-07), matching
      // the Candidates listing's wording. Both are accepted.
      await this.page.getByRole('button', { name: /^clear all( filters)?$/i }).first().click();
    }, { timeout: 8000 });
    await this.settle();
    return result;
  }

  // ==================== Pagination ====================

  get pagination() {
    return this.page.locator('[aria-label*="Pagination" i]').first();
  }

  async paginationText() {
    if (!(await this.pagination.count())) return '';
    return (await this.pagination.innerText()).replace(/\s+/g, ' ').trim();
  }

  async hasPagination() {
    return (await this.pagination.count()) > 0 && await this.pagination.isVisible().catch(() => false);
  }

  prevButton() { return this.page.getByRole('button', { name: /previous/i }).first(); }

  nextButton() { return this.page.getByRole('button', { name: /next/i }).first(); }

  async isPrevDisabled() { return this.prevButton().isDisabled().catch(() => null); }

  async isNextDisabled() { return this.nextButton().isDisabled().catch(() => null); }

  // A page the app has ALREADY FETCHED is re-rendered from its own cache with NO request —
  // measured 2026-09-04 (scripts/probe-agent-pagination.js): Next issues
  // `GET /agent/?page=2&…`, Previous issues nothing and renders the correct rows anyway.
  //
  // So a paging navigation is complete when the GRID says so, not when a response arrives.
  // The default 45s wait was being spent in full on every Previous, and the caller then
  // received `payload: null` — which any payload-based reader reports as "no agents listed".
  // The short window still catches a real request (page 2 answered in well under a second),
  // and `settle()` is what makes the return safe to read either way. `requestFired` tells the
  // caller which happened, so nothing has to guess.
  async goToNextPage() {
    const result = await this.runAndWaitForList(async () => { await this.nextButton().click(); }, { timeout: 15000 });
    await this.settle();
    return result;
  }

  async goToPrevPage() {
    const result = await this.runAndWaitForList(async () => { await this.prevButton().click(); }, { timeout: 8000 });
    await this.settle();
    return result;
  }

  // ==================== Row action: Edit -> "Update Email Address" ====================
  //
  // The listing's Edit action does NOT open a full agent form — it opens a modal that can
  // change ONE thing, the email address. Measured 2026-08-11:
  //   Current Email Address  (disabled, pre-filled)
  //   New Email Address *    placeholder "Enter your new email"
  //   Confirm Email Address * placeholder "Re-enter your new email"
  //   Cancel | Update        (Update starts disabled)
  // Inline errors, verbatim:
  //   "Please enter a valid email address."   invalid format
  //   "The emails do not match."              new != confirm
  //   "New email must be different"           equal to the current address (NO full stop —
  //                                           the other two have one; do not "normalise" it)

  get emailDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /update email address/i }).first();
  }

  async openEmailDialog(needle) {
    await this.clickRowAction(needle, 'Edit');
    await this.emailDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(500);
  }

  async readEmailDialog() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /update email address/i.test(d.innerText || ''));
      if (!dialog) return null;
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const inputs = Array.from(dialog.querySelectorAll('input'));
      // The primary is "Update" on the Active tab and "Next" on the Invite Sent tab.
      const update = Array.from(dialog.querySelectorAll('button')).find((b) => /^(update|next)$/i.test(c(b.innerText)));
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        // The SAME heading is used by the pending-change notice, which carries no inputs at
        // all - so a step reading `current` or `values` on it would see nulls and report a
        // broken form. The flag lets a caller say which of the two it is looking at.
        pending: /already pending/i.test(c(dialog.innerText)),
        labels: Array.from(dialog.querySelectorAll('label')).map((l) => c(l.innerText)),
        // Each input BOUND TO ITS OWN LABEL, rather than two parallel arrays a caller has to
        // line up by position. Measured 2026-09-04: every field here carries a real
        // `<label for>` pointing at its input's id, so the binding is readable rather than
        // assumed - and a caller reading a placeholder "by label" is then reading the
        // placeholder that label actually belongs to. `labels`/`placeholders`/`values` are
        // kept as they were; nothing has to migrate at once.
        fields: inputs.map((i, idx) => {
          const byFor = i.id ? dialog.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null;
          const byAria = i.getAttribute('aria-labelledby')
            ? document.getElementById(i.getAttribute('aria-labelledby')) : null;
          const el = byFor || byAria;
          return {
            index: idx,
            label: c(el ? el.innerText : '').replace(/\s*\*\s*$/, '').trim(),
            labelSource: byFor ? 'for' : (byAria ? 'aria-labelledby' : 'none'),
            placeholder: i.placeholder,
            value: i.value,
            disabled: i.disabled,
          };
        }),
        current: inputs[0] ? { value: inputs[0].value, disabled: inputs[0].disabled } : null,
        placeholders: inputs.map((i) => i.placeholder),
        values: inputs.map((i) => i.value),
        updateDisabled: update ? update.disabled : null,
        primaryLabel: update ? c(update.innerText) : null,
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        // Inline errors are red text nodes. Matching on COLOUR rather than on the wording we
        // hope to find is deliberate: a locator for the expected string can only ever answer
        // "absent", which cannot tell a missing error from a differently-worded one.
        errors: Array.from(new Set(
          Array.from(dialog.querySelectorAll('p,span,div')).filter((e) => {
            const t = c(e.innerText);
            if (!t || t.length > 160 || e.children.length) return false;
            // A button's own label is never an error. The Invite Sent tab's "Next" is a white label
            // on a dark fill and matched the colour test, so every read reported ["Next"] as an
            // inline error - on a modal showing none (measured 2026-10-20).
            if (e.closest('button')) return false;
            if (/^(update|cancel|next)$/i.test(t)) return false;
            return /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color);
          }).map((e) => c(e.innerText)),
        )),
      };
    });
  }

  // Fill both editable fields and let the form revalidate. Uses the native value setter so a
  // React-controlled input really updates, then reads the result back.
  async fillNewEmail(newEmail, confirmEmail) {
    await this.page.evaluate(([nv, cv]) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /update email address/i.test(d.innerText || ''));
      const inputs = Array.from(dialog.querySelectorAll('input'));
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(inputs[1], nv);
      set(inputs[2], cv);
    }, [String(newEmail), String(confirmEmail)]);
    await this.page.waitForTimeout(800);
  }

  async cancelEmailDialog() {
    await this.emailDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // The modal offers THREE ways out, and all three are worth covering: Cancel, an X icon in
  // the header, and Escape. Measured 2026-09-03 — the icon is a button whose only hook is
  // aria-label="close" (LOWERCASE; it carries no text and no test id), and Escape really does
  // dismiss the dialog, unlike the Agent Portal's Share Agent Code modal where an Escape is a
  // silent no-op. Each of these returns without asserting; the caller checks the dialog is gone,
  // because "the click was dispatched" is not "the modal closed".
  async closeEmailDialogWithIcon() {
    await this.emailDialog.getByRole('button', { name: /^close$/i }).first().click();
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  async escapeEmailDialog() {
    await this.page.keyboard.press('Escape');
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ==================== Invite Sent: change the address, then resend ====================
  //
  // MEASURED 2026-10-20 (scripts/probe-invite-sent-edit-email*.js, on throwaway agents). On the
  // Invite Sent tab the same "Update Email Address" form has a "Next" primary, ENABLED from the
  // start, and the form validates NOTHING itself:
  //   * Next REPLACES the form with "Resend Invitation" (the form is unmounted, so Cancel there
  //     does not go back to it). For a typed address it reads "You're about to resend the
  //     invitation to the updated email address: <address>"; with the fields empty / spaces / one
  //     field filled it falls back to a plain resend "to: <current address>".
  //   * a mismatch, the current address, or a confirmation differing only in case leave the form
  //     open with NO message at all; an invalid format goes straight to the confirmation.
  //   * nothing is written until "Resend Invite": PATCH /agent/<id>/update-email/ ->
  //     200 {"detail":"Invite re-sent successfully.", "reinvite_disabled_until": now+2min} with the
  //     toast "Verification email sent to the updated email.", or 422 with the server's message as
  //     a toast - and on a 422 BOTH dialogs close, so what was typed is lost.
  //   * on success the row shows the new address at once (no pending marker - unlike the Active
  //     tab's verify-first handshake), a new "Join Talentforge" mail with a NEW temporary password
  //     goes to it, the old temporary password stops working, and Edit is disabled for the cooldown.
  //   * the app ALSO fires POST /admin/invite/resend/agent/ straight after, which the cooldown the
  //     PATCH just set always refuses (422 "Resend invitation is disabled for 1m 59s.").

  get emailPrimaryButton() {
    return this.emailDialog.getByRole('button', { name: /^(update|next)$/i }).first();
  }

  // Click the form's primary and report where the flow went. Never throws for a gated or silent
  // Next: which inputs must be stopped is the scenario's business.
  async pressEmailNext() {
    const primary = this.emailPrimaryButton;
    const label = (await primary.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const disabled = await primary.isDisabled().catch(() => false);
    if (!disabled) await primary.click();
    await this.resendDialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(500);
    return {
      label,
      disabled,
      resendOpen: await this.resendDialog.isVisible().catch(() => false),
      formOpen: await this.emailDialog.isVisible().catch(() => false),
      form: await this.readEmailDialog(),
    };
  }

  async readResendDialog() {
    if (!(await this.resendDialog.isVisible().catch(() => false))) return null;
    return this.resendDialog.evaluate((d) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        lines: Array.from(d.querySelectorAll('p,span,strong,b,div'))
          .filter((e) => !e.children.length && !e.closest('button') && c(e.innerText))
          .map((e) => c(e.innerText)),
        text: c(d.innerText),
        buttons: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))),
      };
    });
  }

  // Leave the Resend Invitation dialog without confirming: "Cancel", "the X icon" or "Escape".
  async leaveResendDialog(how) {
    if (/^cancel$/i.test(how)) {
      await this.resendDialog.getByRole('button', { name: /^cancel$/i }).click();
    } else if (/x icon/i.test(how)) {
      await this.resendDialog.getByRole('button', { name: /^close$/i }).first().click();
    } else if (/^escape$/i.test(how)) {
      await this.page.keyboard.press('Escape');
    } else {
      throw new Error(`Unknown way out of the Resend Invitation dialog: "${how}" (Cancel / the X icon / Escape)`);
    }
    await this.resendDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // Click "Resend Invite" and collect every toast while the request settles.
  async confirmResendCapturing({ sampleMs = 7000 } = {}) {
    const toasts = await this.captureToasts(async () => {
      await this.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
    }, { sampleMs });
    return {
      toasts,
      resendOpen: await this.resendDialog.isVisible().catch(() => false),
      formOpen: await this.emailDialog.isVisible().catch(() => false),
    };
  }

  // The row's Edit and Resend Invite buttons with their enabled state.
  async readInviteRowActions(needle) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    const read = async (name) => {
      const b = row.getByRole('button', { name, exact: true }).first();
      if (!(await b.count())) return null;
      return !(await b.isDisabled().catch(() => true));
    };
    return { edit: await read('Edit'), resend: await read('Resend Invite') };
  }

  // ==================== The PENDING email change ====================
  //
  // MEASURED LIVE 2026-09-03 (Playwright MCP, on a throwaway agent this run created and then
  // abandoned). Committing Update on the Active tab does NOT change the address - it starts a
  // two-party handshake, and every observable below belongs to the half-finished state:
  //
  //   PATCH /core/api/v1/agent/<user_id>/update-email/  -> 200
  //   toast  "Verification email sent to the updated email."
  //   listing row: the STILL-ACTIVE (old) address is repainted rgb(217, 45, 32) - class
  //                text-fg-error-primary - and an alert-circle <button><svg> appears BEFORE it
  //   tooltip on that icon: "Email update will take effect once the new email is verified by
  //                the agent."   (the candidate listing says "by the candidate")
  //   payload:     `pending_email` on the agent row goes from null to the new address, and it
  //                is the only machine-readable statement of the state
  //   re-Edit:     the form is REPLACED by a notice - "An email update is already pending:"
  //                old -> new, "It is currently awaiting verification from the agent's side.
  //                If you still want to update it, you can edit the pending email."
  //                Cancel | Edit Email  (no inputs at all)
  //   mail:        "Verify your new Talentforge email address" to the NEW address; its CTA
  //                resolves to /agent/verify-email-change?token=... (the candidate route has
  //                no /agent prefix), which answers "Email address confirmed".
  //   afterwards:  the row shows the NEW address in the ordinary rgb(83, 88, 98), the icon is
  //                gone and `pending_email` is null again.
  //
  // THE COLOUR IS READ, NEVER A CLASS GUESSED AT. This repo has twice reported a working
  // visual treatment as missing by testing the one CSS property somebody assumed - see the
  // disabled-promo greying and the save toast. `text-fg-error-primary` here and
  // `text-error-600` on the candidate listing are two different class names for the same
  // rendered colour, so a class-name match would answer "not pending" on one of the two.

  // Everything the row says about the address, including whether it is painted as pending.
  // Returns `null` when the row is not on screen, so the caller can search first and say so.
  async readRowEmailState(needle) {
    return this.page.evaluate((term) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'));
      const row = rows.find((r) => c(r.innerText).toLowerCase().includes(String(term).toLowerCase()));
      if (!row) return null;
      const cell = row.querySelector('[role="rowheader"]') || row;
      // The address is the leaf element holding an "@" - the cell also wraps it in a
      // <button>, and reading the button would take the name in with it.
      const el = Array.from(cell.querySelectorAll('span,p,a'))
        .find((e) => !e.children.length && /@/.test(e.innerText || ''));
      // The warning icon is the only <button> in that cell carrying an <svg>; the name and
      // address buttons carry text. It is what the tooltip hangs off.
      const icon = Array.from(cell.querySelectorAll('button')).find((b) => b.querySelector('svg'));
      const colour = el ? getComputedStyle(el).color : '';
      const rgb = (colour.match(/\d+/g) || []).map(Number);
      return {
        email: el ? c(el.innerText) : '',
        colour,
        className: el ? String(el.className) : '',
        // Red as a MEASUREMENT, not as an exact string: the app paints rgb(217, 45, 32), and
        // a shade change is not the defect these scenarios exist to catch.
        paintedAsError: rgb.length >= 3 && rgb[0] >= 170 && rgb[1] < 110 && rgb[2] < 110,
        hasWarningIcon: !!icon,
        iconId: icon ? icon.id : null,
        rowText: c(row.innerText),
      };
    }, String(needle));
  }

  // The tooltip on that icon, opened the way a person opens it and read from the live DOM.
  //
  // It tries a real hover FIRST because that is the interaction the requirement describes,
  // then falls back to focus - react-aria opens the same tooltip on either, and a 16px icon
  // inside a virtualised grid is a genuinely flaky hover target. Which route worked is
  // returned, so a report can never claim a hover was proved when only the fallback fired.
  async readPendingTooltip(needle) {
    const state = await this.readRowEmailState(needle);
    if (!state) throw new Error(`No row matching ${JSON.stringify(needle)} is on screen.`);
    if (!state.hasWarningIcon) {
      return { opened: false, via: null, text: '', reason: 'the row renders no warning icon' };
    }
    // Addressed by ATTRIBUTE, not by `#id`: react-aria ids look like
    // "react-aria6775656653-_r_di_" and a `#` selector chokes on characters like that in
    // some engines, while [id="..."] is exact and needs no escaping.
    const icon = this.page.locator(`[id="${state.iconId}"]`).first();
    // >>> A 1200ms SAMPLE AFTER `hover()` REPORTS "no tooltip" ON A TOOLTIP THAT WORKS. <<<
    // Measured 2026-09-04: the icon is a 12x12 react-aria trigger, and it opens only on a real
    // pointer TRANSITION onto it, after a cold-start warm-up longer than 1.2s. A single
    // `icon.hover()` + 1200ms read found nothing three times running; moving the mouse in from
    // elsewhere and polling to 6s opened it every time, carrying the expected sentence and
    // setting `aria-describedby` on the trigger. So each route below is POLLED, never sampled
    // once, and hover is tried first because hover is what the requirement describes.
    //
    // Two things that are NOT routes in, worth not re-testing: `focus()` opens nothing here,
    // and a CLICK actively CLOSES an open tooltip - so never click this icon to "make sure".
    const read = async () => this.page.evaluate(() => Array.from(document.querySelectorAll('[role="tooltip"]'))
      .map((t) => String(t.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    const poll = async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const tips = await read();
        if (tips.length) return tips;
        await this.page.waitForTimeout(250);
      }
      return [];
    };

    const box = await icon.boundingBox().catch(() => null);
    if (box) {
      // Away first, then in with steps: without an actual mouseenter the trigger never arms.
      await this.page.mouse.move(Math.max(0, box.x - 80), Math.max(0, box.y - 80));
      await this.page.waitForTimeout(250);
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    } else {
      await icon.hover({ timeout: 10000 }).catch(() => {});
    }
    let tips = await poll(6000);
    if (tips.length) return { opened: true, via: 'hover', text: tips[0], all: tips };

    await icon.focus().catch(() => {});
    tips = await poll(3000);
    if (tips.length) return { opened: true, via: 'focus', text: tips[0], all: tips };

    return {
      opened: false,
      via: null,
      text: '',
      reason: 'no [role="tooltip"] appeared within 6s of a real pointer move onto the icon, '
        + 'nor within 3s of focusing it',
    };
  }

  // The notice that REPLACES the form when a change is already pending. Returns null when the
  // dialog is showing the ordinary form, so "the pending notice did not appear" and "the modal
  // never opened" stay distinguishable.
  async readPendingNotice() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => /update email address/i.test(d.innerText || '')).pop();
      if (!dialog) return null;
      const text = c(dialog.innerText);
      if (!/already pending/i.test(text)) return null;
      const emails = Array.from(new Set(text.match(/[^\s@]+@[^\s@]+\.[^\s@,]+/g) || []));
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        text,
        emails,
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        inputs: dialog.querySelectorAll('input').length,
      };
    });
  }

  // "Edit Email" on that notice - the only route from it back to the form.
  async clickEditPendingEmail() {
    await this.emailDialog.getByRole('button', { name: /^edit email$/i }).first().click();
    await this.page.waitForTimeout(1200);
  }

  // ==================== COMMIT METHODS ====================
  //
  // Everything above opens a dialog and cancels it - Agent.feature says so at the top of the
  // file and means it, because that feature runs against shared DEV agents every other suite
  // reads. The four methods below are the only ones that COMMIT, and they exist for the agent
  // email-notification scenarios: the mails are only observable if the action really happens.
  //
  // They are safe to add here because nothing calls them except scenarios that own a THROWAWAY
  // agent they provisioned themselves. Do not reach for them from a scenario driving a fixture.
  //
  // Each returns the toasts it saw. The toast is not the assertion - the delivered email is -
  // but a commit that silently no-ops and a commit that failed with an error toast look
  // identical from the inbox's side, and telling those apart is the difference between "the app
  // does not send this mail" and "the action never happened".

  // Submit the Update Email Address form and report EVERYTHING the app answered with.
  //
  // Separate from confirmEmailUpdate() below, which exists for the email-notification
  // scenarios and throws unless the change goes through. This one is the reader the
  // Edit-Email feature needs, because three of its scenarios are about a submission the app
  // REFUSES - and a refusal is only visible for a few seconds:
  //
  //   * the primary button is labelled "Update" on the Active/candidate listings and "Next"
  //     on the Invite Sent tab. Measured 2026-09-03. Matching only "Update" waits out the
  //     full timeout on a button that is on screen and working.
  //   * >>> THE TOAST IS THE WHOLE ANSWER, AND IT IS GONE IN ~4s. <<< A single
  //     toastMessages() read taken after the network settles finds nothing, which reads as
  //     "the app said nothing" for a refusal it stated perfectly clearly. So the toast
  //     surface is SAMPLED across the whole window, and every distinct message is kept.
  //   * the modal STAYS OPEN on refusal and CLOSES on success, so whether it closed is
  //     independent evidence of the outcome and is returned rather than asserted here.
  //
  // Nothing is thrown for a refusal: which submissions must be refused is the scenario's
  // business, not the page object's.
  async submitEmailUpdate({ sampleMs = 6000 } = {}) {
    const primary = this.emailDialog
      .getByRole('button', { name: /^(update|next)$/i }).first();
    const label = (await primary.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (await primary.isDisabled().catch(() => false)) {
      const state = await this.readEmailDialog();
      return {
        submitted: false,
        buttonLabel: label,
        toasts: [],
        dialogStillOpen: true,
        gatedBecause: `"${label}" is disabled. The modal holds ${JSON.stringify(state && state.values)} `
          + `and shows ${JSON.stringify(state && state.errors)}.`,
      };
    }
    const toasts = await this.captureToasts(async () => { await primary.click(); }, { sampleMs });
    const dialogStillOpen = await this.emailDialog.isVisible().catch(() => false);
    return { submitted: true, buttonLabel: label, toasts, dialogStillOpen, gatedBecause: null };
  }

  // Run `action` and collect every distinct toast that appears while it runs and for a
  // moment afterwards. Sampling in the PAGE keeps the polling loop off the wire, which
  // matters: a round trip per sample from Node is slower than the toast's own lifetime.
  async captureToasts(action, { sampleMs = 6000, everyMs = 200 } = {}) {
    const started = this.page.evaluate(([total, step]) => new Promise((resolve) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const seen = [];
      const tick = () => {
        document.querySelectorAll(
          '.Toastify__toast, .Toastify__toast-body, li[data-sonner-toast], [role="status"], [role="alert"]'
        ).forEach((e) => {
          const t = c(e.innerText);
          if (t && !seen.includes(t)) seen.push(t);
        });
      };
      const id = setInterval(tick, step);
      setTimeout(() => { clearInterval(id); tick(); resolve(seen); }, total);
    }), [sampleMs, everyMs]);
    await action();
    return started;
  }

  // Commit Edit > Update Email Address. This fires TWO mails at once: a change notice to the
  // OLD address and a verification link to the NEW one.
  async confirmEmailUpdate() {
    const update = this.emailDialog.getByRole('button', { name: /^update$/i }).first();
    // Read the gate rather than assuming it: the modal enables Update only once the address is
    // valid, matching and different, so a disabled button here means the caller filled the
    // fields wrongly - a far more useful message than a click timeout.
    if (await update.isDisabled().catch(() => false)) {
      const state = await this.readEmailDialog();
      throw new Error(
        'Update is disabled, so the email change was never submitted. The modal holds '
        + `${JSON.stringify(state && state.values)} and shows ${JSON.stringify(state && state.errors)}.`
      );
    }
    await update.click();
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return this.toastMessages();
  }

  // Commit the DIRECT deactivation only.
  //
  // It refuses the transfer variant on purpose. That path moves real candidates onto another
  // agent and there is no undo for it anywhere in the portal, so a scenario that reached it by
  // accident must fail loudly rather than reassign somebody's caseload.
  async confirmDeactivate() {
    const state = await this.readDeactivateDialog();
    if (state && state.requiresTransfer) {
      throw new Error(
        'This agent holds active candidates, so the dialog is the Transfer & Deactivate variant. '
        + 'Refusing to commit: a transfer cannot be undone from the portal. '
        + `Dialog said: ${state.body}`
      );
    }
    const confirm = this.deactivateDialog.getByRole('button', { name: /^deactivate$/i }).first();
    await confirm.waitFor({ state: 'visible', timeout: 15000 });
    await confirm.click();
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return this.toastMessages();
  }

  async confirmReactivate() {
    const confirm = this.reactivateDialog
      .getByRole('button', { name: /^re-?activate account$/i }).first();
    await confirm.waitFor({ state: 'visible', timeout: 15000 });
    await confirm.click();
    await this.reactivateDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return this.toastMessages();
  }

  // Commit Notify > Send Reminder, and report WHICH reminder the dialog said it was sending.
  //
  // The type is read rather than assumed. Measured 2026-08-12 the dialog offers only "Monthly
  // Target Delay Reminder", but the Requires Attention tab flags agents for more than one
  // reason, so the type on offer may well vary by agent. Returning it lets the step assert the
  // mail that matches what the dialog promised instead of hard-coding one.
  async confirmSendReminder() {
    const before = await this.readNotifyDialog();
    const confirm = this.notifyDialog.getByRole('button', { name: /^send reminder$/i }).first();
    await confirm.waitFor({ state: 'visible', timeout: 15000 });
    await confirm.click();
    await this.notifyDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return {
      reminderType: reminderTypeFrom(before && before.body),
      dialogBody: (before && before.body) || '',
      toasts: await this.toastMessages(),
    };
  }

  // ==================== Row action: Deactivate ====================
  //
  // TWO VARIANTS, chosen by the agent's active candidate count — the dialog asks
  // GET /agent/<id>/candidates/count/ before it renders. Measured 2026-08-11:
  //
  //   0 candidates   "You're about to deactivate <name> account. Since there are no active
  //                   candidates assigned, you can proceed with deactivation directly."
  //                  -> Cancel | Deactivate            (enabled immediately)
  //
  //   >=1 candidate  "To deactivate <name>, you must first transfer his N active candidates
  //                   to another agent within the same university hub."
  //                  + University Affiliation (disabled, the agent's own)
  //                  + New Agent * combobox "Select an agent"
  //                  -> Cancel | Transfer & Deactivate (DISABLED until an agent is chosen)
  //
  // Note the apostrophe in "You're" is U+2019, not '. Match it tolerantly.

  async readDeactivateDialog() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /deactivate agent account/i.test(d.innerText || ''));
      if (!dialog) return null;
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const buttons = Array.from(dialog.querySelectorAll('button'))
        .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled }))
        .filter((b) => b.label);
      const confirm = buttons.find((b) => /^(deactivate|transfer & deactivate)$/i.test(b.label));
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        body: c(dialog.innerText),
        buttons,
        confirmLabel: confirm ? confirm.label : '',
        confirmDisabled: confirm ? confirm.disabled : null,
        requiresTransfer: /transfer & deactivate/i.test(c(dialog.innerText)),
        hasAgentPicker: Boolean(dialog.querySelector('input[placeholder*="select an agent" i]')),
        universityShown: (() => {
          const btn = Array.from(dialog.querySelectorAll('button')).find((b) => b.disabled && c(b.innerText).length > 6
            && !/^(deactivate|cancel|close|transfer & deactivate)$/i.test(c(b.innerText)));
          return btn ? c(btn.innerText) : '';
        })(),
      };
    });
  }

  async openDeactivateDialog(needle) {
    await this.clickDeactivateRowAction(needle);
    await this.deactivateDialog.waitFor({ state: 'visible', timeout: 20000 });
    // The dialog decides its own shape from a candidates/count call, so a read taken the
    // instant it appears can catch the pre-decision render.
    await this.page.waitForTimeout(2000);
  }

  // The transfer picker's options. Returns the raw strings, so the "No agents available"
  // empty state is reported as itself rather than as zero options — the two mean very
  // different things and the caller has to be able to tell them apart.
  async transferAgentOptions() {
    const trigger = this.deactivateDialog.locator('button[aria-label="Show suggestions" i]').first();
    if (!(await trigger.count())) return { offered: [], emptyState: null, pickerPresent: false };
    await trigger.click();
    await this.page.waitForTimeout(1800);
    const raw = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]'))
        .map((o) => (o.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    const emptyish = raw.filter((t) => /no agents available|no other agents/i.test(t));
    return {
      offered: raw.filter((t) => !/no agents available|no other agents/i.test(t)),
      emptyState: emptyish[0] || null,
      pickerPresent: true,
      raw,
    };
  }

  async closeTransferSuggestions() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(400);
  }

  async cancelDeactivateDialog() {
    await this.deactivateDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  // ==================== Row action: Reactivate (Deactivated tab) ====================
  //
  // Measured: heading "Re-activate Account", the body names the agent, states access is
  // regained instantly and that a re-activation email is sent.
  // -> Cancel | "Re-activate Account"

  get reactivateDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /re-?activate account/i }).first();
  }

  async openReactivateDialog(needle) {
    await this.clickRowAction(needle, 'Reactivate');
    await this.reactivateDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(1000);
  }

  async readReactivateDialog() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /re-?activate account/i.test(d.innerText || ''));
      if (!dialog) return null;
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        body: c(dialog.innerText),
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled }))
          .filter((b) => b.label),
      };
    });
  }

  async cancelReactivateDialog() {
    await this.reactivateDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.reactivateDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ==================== Row action: Notify (Requires Attention tab) ====================
  //
  // Measured: opens a "Send Reminder" modal naming the recipient, offering the reminder type
  // "Monthly Target Delay Reminder" and a Message Preview. -> Cancel | Send Reminder

  get notifyDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /send reminder/i }).first();
  }

  async openNotifyDialog(needle) {
    await this.clickRowAction(needle, 'Notify');
    await this.notifyDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(1000);
  }

  async readNotifyDialog() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /send reminder/i.test(d.innerText || ''));
      if (!dialog) return null;
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        body: c(dialog.innerText),
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled }))
          .filter((b) => b.label),
        hasMessagePreview: /message preview/i.test(c(dialog.innerText)),
      };
    });
  }

  async cancelNotifyDialog() {
    await this.notifyDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.notifyDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ==================== Leaving a row dialog ====================
  //
  // One driver for every "way out" a row dialog may offer. Each dialog names its X differently
  // (aria-label "Close" on Notify, "close" on Resend Invitation, "Cancel" on Verify your
  // identity - measured 2026-10-22), so the X is found STRUCTURALLY as the icon-only button,
  // never by its label alone: a label match would also hit the text "Cancel" button in the footer.
  async leaveDialog(dialog, how) {
    const method = String(how).trim().toLowerCase();
    if (method === 'cancel') {
      await dialog.locator('button').filter({ hasText: /^\s*cancel\s*$/i }).last().click();
    } else if (method === 'x icon') {
      const icons = dialog.locator('button').filter({ hasNotText: /\S/ });
      const count = await icons.count();
      let clicked = false;
      for (let i = 0; i < count && !clicked; i += 1) {
        const label = (await icons.nth(i).getAttribute('aria-label')) || '';
        if (/^(close|cancel)$/i.test(label.trim())) { await icons.nth(i).click(); clicked = true; }
      }
      if (!clicked) return 'the dialog has no icon-only close control';
    } else if (method === 'escape') {
      await this.page.keyboard.press('Escape');
    } else if (method === 'outside click') {
      await this.page.mouse.click(5, 5);
    } else {
      throw new Error(`Unknown way out "${how}" - Cancel / X icon / Escape / outside click`);
    }
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    return null;
  }

  // ==================== Log in as agent (impersonation) ====================
  //
  // MEASURED 2026-10-22 (scripts/probe-agent-login-as.js, on an abandoned throwaway agent). The
  // Active row's "Open menu > Log in as agent" (and the same item in the profile's overflow) is a
  // THREE-step flow and nothing is started until the last step:
  //   1. "Verify your identity" - "Confirm it's you before accessing <name>'s account.", one
  //      masked Password field (placeholder "Enter current password", a Show/Hide toggle),
  //      Cancel / Confirm. Confirm is disabled while the field is empty - but NOT while it holds
  //      only spaces. Confirm -> POST /impersonation/agents/<id>/verify/ -> 200
  //      {"verification_token"} (a 5-minute JWT) or 401 {"code":"invalid_password"}, which is
  //      shown inline as "Incorrect password." with the dialog left open.
  //   2. "Reason for access" - "This will be logged and visible in the audit trail.", a required
  //      Reason select (Troubleshooting an issue / Assisting with account setup / Investigating a
  //      reported problem / Acting at the agent's request / Other). Next is disabled until one is
  //      chosen; Other adds a required "Please specify reason" textarea that spaces do not satisfy.
  //   3. "Before you start" - names the agent and the reason, says the session ends after 30
  //      minutes or 15 of inactivity; Back (keeps the reason) / Start session.
  //   Start session -> POST /impersonation/agents/<id>/start/ -> 201 {session_id, access_token};
  //   the SAME tab becomes /dashboard/agent with a banner "You're logged in as <name> (Agent)",
  //   a countdown and End Session. End Session needs no confirmation: POST
  //   /impersonation/session/end/ -> {"state":"ended","trigger":"MANUAL"}, a "Session Ended"
  //   dialog, and "Back to Agent Profile" returns the superadmin to /agents/view/<id>.
  //   Audit Logs record "Logged In As Agent" (with the reason) and "Logged Out As Agent"
  //   ("Reason: MANUAL, Session ID: <id>").

  get identityDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /verify your identity/i }).first();
  }

  get accessStepDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /reason for access|before you start/i }).first();
  }

  get impersonationEndSession() {
    return this.page.locator('[data-testid="admin-impersonation-banner-end-session-button"]')
      .or(this.page.getByRole('button', { name: /^end session$/i })).first();
  }

  async openLoginAsDialog(needle) {
    await this.clickRowMenuItem(needle, 'Log in as agent');
    await this.identityDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(400);
  }

  async readIdentityDialog() {
    if (!(await this.identityDialog.isVisible().catch(() => false))) return null;
    return this.identityDialog.evaluate((d) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const input = d.querySelector('input');
      const confirm = Array.from(d.querySelectorAll('button')).find((b) => /^confirm$/i.test(c(b.innerText)));
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        text: c(d.innerText),
        input: input && { type: input.type, placeholder: input.placeholder, value: input.value, required: input.required },
        confirmDisabled: confirm ? confirm.disabled : null,
        buttons: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        errors: Array.from(d.querySelectorAll('p,span,div')).filter((e) => !e.children.length && c(e.innerText) && !e.closest('button')
          && /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color)).map((e) => c(e.innerText)),
      };
    });
  }

  // Real keystrokes: the gate is driven by input events, and fill() is a different code path.
  async typeIdentityPassword(value) {
    const input = this.identityDialog.locator('input').first();
    await input.fill('');
    if (value) await input.pressSequentially(value);
    await this.page.waitForTimeout(300);
  }

  async togglePasswordVisibility() {
    const toggle = this.identityDialog.getByRole('button', { name: /^(show|hide) password$/i }).first();
    await toggle.click();
    await this.page.waitForTimeout(300);
    return {
      label: await toggle.getAttribute('aria-label'),
      type: await this.identityDialog.locator('input').first().getAttribute('type'),
    };
  }

  // Confirm and report the verify request's answer. The token in a 200 is a credential and is
  // never returned - only whether one was present.
  async confirmIdentity() {
    const response = this.page.waitForResponse(
      (r) => /\/impersonation\/agents\/\d+\/verify\/?$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30000 },
    ).catch(() => null);
    await this.identityDialog.getByRole('button', { name: /^confirm$/i }).click();
    const r = await response;
    let body = {};
    if (r) { try { body = await r.json(); } catch (e) { /* reported as empty */ } }
    await this.page.waitForTimeout(800);
    return {
      status: r ? r.status() : null,
      agentId: r ? (r.url().match(/agents\/(\d+)\/verify/) || [])[1] : null,
      hasToken: Boolean(body.verification_token),
      detail: body.detail || null,
      code: body.code || null,
    };
  }

  async readAccessStep() {
    if (!(await this.accessStepDialog.isVisible().catch(() => false))) return null;
    return this.accessStepDialog.evaluate((d) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const select = d.querySelector('select');
      const textarea = d.querySelector('textarea');
      const btn = (re) => Array.from(d.querySelectorAll('button')).find((b) => re.test(c(b.innerText)));
      const next = btn(/^next$/i);
      const start = btn(/^start session$/i);
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        text: c(d.innerText),
        reasonValue: select ? select.value : null,
        reasonLabel: select && select.selectedIndex >= 0 ? c(select.options[select.selectedIndex].text) : null,
        reasonOptions: select ? Array.from(select.options).map((o) => c(o.text)).filter(Boolean) : [],
        otherField: textarea ? { placeholder: textarea.placeholder, value: textarea.value } : null,
        nextDisabled: next ? next.disabled : null,
        startDisabled: start ? start.disabled : null,
        buttons: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      };
    });
  }

  // The Reason control is a react-aria Select: a trigger button over a hidden native <select>.
  // The option is picked through the popover a user sees; the hidden select is only read back.
  async chooseAccessReason(label) {
    const trigger = this.accessStepDialog.locator('button[aria-haspopup="listbox"]').first();
    await trigger.click();
    const option = this.page.getByRole('option', { name: label, exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
    await this.page.waitForTimeout(500);
  }

  async typeOtherReason(value) {
    const area = this.accessStepDialog.locator('textarea').first();
    await area.fill('');
    if (value) await area.pressSequentially(value);
    await area.press('Tab');
    await this.page.waitForTimeout(300);
  }

  // Matched on the VISIBLE label: the step's X icon is aria-labelled "Cancel" as well, so an
  // accessible-name lookup for Cancel resolves to two buttons.
  async pressAccessStep(label) {
    await this.accessStepDialog.locator('button')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i') }).last().click();
    await this.page.waitForTimeout(800);
  }

  // Start the session and report the start request (never its access token).
  async startImpersonation() {
    const response = this.page.waitForResponse(
      (r) => /\/impersonation\/agents\/\d+\/start\/?$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30000 },
    ).catch(() => null);
    await this.pressAccessStep('Start session');
    const r = await response;
    let body = {};
    if (r) { try { body = await r.json(); } catch (e) { /* reported as empty */ } }
    await this.page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
    await this.impersonationEndSession.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    return { status: r ? r.status() : null, sessionId: body.session_id || null };
  }

  async readImpersonationBanner() {
    const end = this.impersonationEndSession;
    if (!(await end.isVisible().catch(() => false))) return null;
    const text = await end.evaluate((b) => {
      let host = b.parentElement;
      for (let i = 0; i < 4 && host && !/logged in as/i.test(host.innerText || ''); i += 1) host = host.parentElement;
      return (host ? host.innerText : b.innerText).replace(/\s+/g, ' ').trim();
    });
    const remaining = text.match(/(\d{1,2}):(\d{2})\s*remaining/i);
    return {
      text,
      loggedInAs: (text.match(/logged in as (.+?) \(agent\)/i) || [])[1] || null,
      remainingSeconds: remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : null,
    };
  }

  // End Session asks nothing: it ends at once and raises "Session Ended". Any modal the agent's
  // own dashboard opened (the first-time welcome modal) is dismissed first - its overlay
  // swallows the banner click.
  async endImpersonation() {
    if (await this.page.locator('[role="dialog"]').count()) {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(600);
    }
    const response = this.page.waitForResponse(
      (r) => /\/impersonation\/session\/end\/?$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30000 },
    ).catch(() => null);
    await this.impersonationEndSession.click();
    const r = await response;
    let body = {};
    if (r) { try { body = await r.json(); } catch (e) { /* reported as empty */ } }
    const ended = this.page.locator('[role="dialog"]').filter({ hasText: /session ended/i }).first();
    await ended.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    const endedText = (await ended.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const endedButtons = (await ended.locator('button').allInnerTexts().catch(() => []))
      .map((b) => b.trim()).filter(Boolean);
    return { status: r ? r.status() : null, body, endedText, endedButtons };
  }

  async backToAgentProfileAfterSession() {
    await this.page.locator('[role="dialog"]').filter({ hasText: /session ended/i })
      .getByRole('button', { name: /^back to agent profile$/i }).click();
    await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
    await this.page.waitForTimeout(1500);
  }

  // ==================== Opening the profile ====================

  async openAgentProfile(needle) {
    await this.clickRowAction(needle, 'View');
    await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
  }

  async countAgentsWithEmail(email, { name } = {}) {
    let total = 0;
    const perTab = {};
    for (const tab of [...EXCLUSIVE_TABS, ...OVERLAY_TABS]) {
      await this.goto(tab);
      if (name) await this.search(name);
      const rows = await this.readRows();
      const hits = rows.filter((r) => (r.email || '').toLowerCase() === String(email).toLowerCase());
      perTab[tab] = hits.length;
      if (EXCLUSIVE_TABS.includes(tab)) total += hits.length;
    }
    return { total, perTab, countedTabs: EXCLUSIVE_TABS, overlayTabs: OVERLAY_TABS };
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Which reminder the Send Reminder dialog says it is about to send.
//
// Matched against the reminder families the Figma agent templates define, rather than pinned to
// the one string the dialog renders today. If the app starts offering a second type for a
// differently-flagged agent, this reports it instead of silently returning the only type it
// knew about - and the step can then wait for the matching mail rather than the wrong one.
// Returns null when the dialog names no recognisable type, which the caller reports as-is.
const REMINDER_TYPES = [
  { key: 'monthlyTarget', match: /monthly target/i },
  { key: 'verificationDelay', match: /verification delay|pending verification/i },
  { key: 'documentReview', match: /document (review|revision)/i },
  { key: 'activity', match: /\bactivity reminder\b|stay active/i },
];

function reminderTypeFrom(dialogBody) {
  const text = String(dialogBody || '');
  const hit = REMINDER_TYPES.find((t) => t.match.test(text));
  return hit ? hit.key : null;
}

module.exports = AgentsListingPage;
module.exports.REMINDER_TYPES = REMINDER_TYPES;
module.exports.TAB_PARAM = TAB_PARAM;
