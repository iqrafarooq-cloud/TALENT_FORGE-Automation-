const BasePage = require('./BasePage');

// DashboardPage - Page Object for the Agent Portal's authenticated shell AND its /dashboard.
//
// PART 1 (the first three locators and the two methods below them) is the original header/avatar
// object that the login, logout, change-password and 2FA features use. It is UNCHANGED.
//
// PART 2 is the dashboard as a SCREEN, added 2026-10-01 for features/Agent_Portal/Dashboard.feature.
// Every string, endpoint and parameter in it was MEASURED LIVE through the Playwright MCP browser
// against AGENT_EMAIL on 2026-10-01 - re-run `node scripts/probe-agent-dashboard.js` rather than
// reasoning about the DOM.
//
//   route              /dashboard   (the server answers the document itself with HTTP 404 - the SPA
//                                    is served as a 404 fallback; see the known-issue scenario)
//   data endpoints     GET /core/api/v1/candidate/stats/?period=<monthly|quarterly|yearly|year-to-date>
//                      GET /core/api/v1/candidate/documents/all/?page=1&page_size=5&status=AWAITING
//                      GET /core/api/v1/candidate/requires-attention/?page=1&page_size=5
//                      GET /core/api/v1/candidate/active/?page=1&page_size=6
//                      GET /core/api/v1/auth/me/        (name, email, agent_code, promotion)
//                      GET /core/api/v1/notifications/?page=1&page_size=10&is_read=false
//   sections, in order KPI band | Referral Codes | Document Verification Queue | Requires Attention
//                      | Active Candidates
//
// FIVE THINGS THAT WOULD BE EASY TO GET WRONG HERE, each with a wrong assertion behind it:
//
//  1. THE KPI TILES ARE PERIOD-SCOPED. `stats/?period=monthly` counts only candidates added THIS
//     month, so on the 1st of a month every tile legitimately reads 0 while the section cards below
//     list 39 active candidates. Tiles and cards are DIFFERENT figures and are never compared.
//  2. "ACTIVE CANDIDATES" AND "REQUIRES ATTENTION" EACH APPEAR TWICE - once as a KPI label, once as
//     a card title. A label-only locator cannot tell them apart; card() requires the card's own
//     content (a list, a grid or its empty state) inside the same innermost block.
//  3. THE PERIOD TRIGGER'S LABEL IS THE CURRENT SELECTION, and the hidden react-aria mirror <select>
//     puts every option's text into innerText as well. readKpis() therefore parses by LABEL, never
//     by line position.
//  4. A FAILED LOAD IS RENDERED AS AN EMPTY ACCOUNT on all three section cards (measured with a 500
//     stub). A reader that only looks for rows cannot tell "nothing to show" from "could not load",
//     which is exactly the defect - so the empty-state reader is shared by both scenarios.
//  5. THE REVIEW PANEL IS THE SAME COMPONENT /verifications OPENS. Its readers and its guarded
//     decision methods live in AgentVerificationsPage and are REUSED, not re-implemented here - the
//     duplicated submit test id is guarded there and must stay guarded in one place.
const ENDPOINTS = {
  stats: '/candidate/stats/',
  queue: '/candidate/documents/all/',
  attention: '/candidate/requires-attention/',
  active: '/candidate/active/',
  me: '/auth/me/',
  unread: '/notifications/',
};

class DashboardPage extends BasePage {
  constructor(page) {
    super(page);

    // ============================ PART 1 - header / account menu ============================

    // Avatar button in the header that opens the account menu. It carries
    // aria-haspopup but (unlike the Notifications bell) has no aria-label, so
    // `:not([aria-label])` disambiguates the two popup triggers.
    this.profileMenuTrigger = page.locator(
      '[data-testid="profile-menu-button"], header button[aria-haspopup="menu"]:not([aria-label]), button[aria-haspopup="true"]:not([aria-label]), header button.rounded-full:not([aria-label])'
    ).first();

    // Account menu items render as role="menuitemradio" (falls back to menuitem /
    // plain text across builds).
    this.logoutMenuItem = page
      .getByRole('menuitemradio', { name: /log ?out|sign ?out/i })
      .or(page.getByRole('menuitem', { name: /log ?out|sign ?out/i }))
      .or(page.getByText(/^log ?out$|^sign ?out$/i))
      .first();

    this.accountSettingsMenuItem = page
      .getByRole('menuitemradio', { name: /account settings/i })
      .or(page.getByRole('menuitem', { name: /account settings/i }))
      .first();

    // ============================ PART 2 - the dashboard screen ============================

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.dashboardUrl = `${this.origin}/dashboard`;

    // The <h1> wraps a tabindex="-1" <button> named "Dashboard"; the sidebar link carries the same
    // text, so this is a HEADING lookup, not a text lookup.
    this.heading = page.getByRole('heading', { level: 1, name: /^Dashboard$/ }).first();
    this.sidebar = page.getByRole('navigation').first();
    this.languageButton = page
      .locator('[data-testid="language-switcher"]')
      .or(page.getByRole('button', { name: /^(En|Ar|English|العربية)$/, exact: true }))
      .first();
    this.bellButton = page
      .locator('[data-testid="notifications-button"]')
      .or(page.getByRole('button', { name: 'Notifications', exact: true }))
      .first();
    this.main = page.locator('main').first();

    // The KPI band: the innermost block holding both the first and the last KPI label.
    this.kpiBand = this.main
      .locator('div')
      .filter({ has: page.locator('p', { hasText: /^Total Candidates$/ }) })
      .filter({ has: page.locator('p', { hasText: /^Onboarding in Progress$/ }) })
      .last();
    // The period trigger is located by what its label can BE, never by one value - its label is the
    // current selection (see note 3).
    this.periodTrigger = this.kpiBand
      .locator('button')
      .filter({ hasText: /^(Monthly|Quarterly|Yearly|Year to Date)$/ })
      .first();
    // The icon-only button beside the "a/b" target ratio. It has no accessible name; the ratio is
    // its only stable anchor.
    this.targetInfoButton = this.kpiBand
      .locator('div')
      .filter({ hasText: /^\s*(\d+|-)\/(\d+|-)\s*$/ })
      .filter({ has: page.locator('button') })
      .last()
      .locator('button')
      .first();
  }

  // ------------------------------------------------------------------ constants

  static SECTIONS = [
    'Referral Codes',
    'Document Verification Queue',
    'Requires Attention',
    'Active Candidates',
  ];

  // Label, the API value it sends, measured 2026-10-01. NOTE "Year to Date" sends `year-to-date`
  // with HYPHENS while the other three are single words - writing them out is what makes that a
  // measured fact.
  static PERIODS = [
    { label: 'Monthly', apiValue: 'monthly' },
    { label: 'Quarterly', apiValue: 'quarterly' },
    { label: 'Yearly', apiValue: 'yearly' },
    { label: 'Year to Date', apiValue: 'year-to-date' },
  ];

  // KPI tile label -> the stats payload key it renders. "Total Candidates" has no comparison line.
  static KPI_TILES = [
    { label: 'Active Candidates', key: 'active' },
    { label: 'Onboarding in Progress', key: 'in_progress' },
    { label: 'Requires Attention', key: 'requires_attention' },
  ];

  static TARGET_TOOLTIP = {
    heading: 'Target Overview',
    body: "This shows how many candidates you've added compared to your assigned target for the selected period.",
  };

  // Verbatim, measured with an empty-list stub AND on the build's own markup. The Active card is the
  // only one whose empty state carries a CTA.
  static EMPTY_STATES = {
    'Document Verification Queue': {
      heading: 'No documents to review yet',
      body: 'Documents will show up here after candidates complete their onboarding and uploads.',
      cta: null,
    },
    'Requires Attention': {
      heading: 'Nothing needs your attention right now',
      body: "When a candidate needs follow-up (incomplete onboarding, pending documents, or payments), it'll show up here.",
      cta: null,
    },
    'Active Candidates': {
      heading: 'No candidates yet',
      body: 'Candidates will appear here once they are invited to the portal.',
      cta: 'Invite Candidates',
    },
  };

  static ACTIVE_COLUMNS = [
    'Candidate',
    'Account Verification',
    'Pending Documents',
    'Subscription Status',
    'Last Activity',
    'Actions',
  ];

  static SUBSCRIPTION_LABELS = {
    subscribed: 'Subscribed',
    not_subscribed: 'Not Subscribed',
    payment_due: 'Payment Due',
  };

  // What each card's page size is on the wire, so "at most N rows" is read off the app's own request
  // rather than hardcoded twice.
  static CARD_PAGE_SIZE = {
    'Document Verification Queue': 5,
    'Requires Attention': 5,
    'Active Candidates': 6,
  };

  static AVATAR_MENU = ['Account Settings', 'Become a Candidate', 'Referral Codes', 'Log out'];

  static BECOME_CANDIDATE = {
    heading: /^Become a Candidate!/,
    body: 'Start your journey as a candidate and explore learning opportunities designed for your career growth. You can switch back to agent portal anytime.',
    cancel: 'Stay Here',
    confirm: 'Become a Candidate',
  };

  // ------------------------------------------------------------------ PART 1 methods

  async openProfileMenu() {
    await this.profileMenuTrigger.click();
    // Wait for the menu to render before callers try to click an item.
    await this.logoutMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickLogout() {
    await this.logoutMenuItem.click();
  }

  // ======================================================================= request log
  //
  // install() is called ONCE PER SCENARIO from hooks.js / PagesFixture.js, BEFORE the first
  // navigation, for the same reason every listing in this repo does it: several assertions compare
  // the render against the payload the app itself fetched, and two of them (opening the review
  // panel, and the inert controls) assert that an action fires NO request at all - an absence a
  // listener attached late cannot measure. The log is never reset; steps take an index baseline.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.responses = [];
    this._parsing = [];

    const kindOf = (url) => {
      if (!/\/core\/api\/v1\//.test(url)) return null;
      for (const [kind, frag] of Object.entries(ENDPOINTS)) {
        if (!url.includes(frag)) continue;
        if (kind === 'unread' && !/is_read=false/.test(url)) return null;
        return kind;
      }
      return null;
    };

    this.page.on('request', (req) => {
      const url = req.url();
      if (!/\/core\/api\/v1\//.test(url)) return;
      this.requests.push({ at: Date.now(), method: req.method(), url, kind: kindOf(url) });
    });

    this.page.on('response', (res) => {
      if (res.request().method() !== 'GET') return;
      const kind = kindOf(res.url());
      if (!kind) return;
      // Reading a body is asynchronous and Playwright does not await an event handler, so every parse
      // is tracked and flush() awaits the outstanding ones.
      const p = res
        .json()
        .then((body) => this.responses.push({ at: Date.now(), kind, url: res.url(), status: res.status(), body }))
        .catch(() => this.responses.push({ at: Date.now(), kind, url: res.url(), status: res.status(), body: null }));
      this._parsing.push(p);
    });
  }

  async flush() {
    await Promise.all(this._parsing || []);
  }

  requestCount() {
    return (this.requests || []).length;
  }

  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline);
  }

  // Every non-GET API request since a baseline - the evidence for "nothing was committed".
  writesSince(baseline = 0) {
    return this.requestsSince(baseline).filter((r) => r.method !== 'GET');
  }

  async latest(kind) {
    await this.flush();
    const hits = (this.responses || []).filter((r) => r.kind === kind);
    return hits.length ? hits[hits.length - 1] : null;
  }

  async latestBody(kind) {
    const r = await this.latest(kind);
    return r ? r.body : null;
  }

  // Wait for a response of `kind` that arrived after `sinceIndex` responses had been recorded.
  async waitForKind(kind, { since = 0, match = null, timeout = 30000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await this.flush();
      const hit = (this.responses || [])
        .slice(since)
        .find((r) => r.kind === kind && (!match || match.test(r.url)));
      if (hit) return hit;
      await this.page.waitForTimeout(250);
    }
    return null;
  }

  responseMark() {
    return (this.responses || []).length;
  }

  // ======================================================================= navigation

  // Open the dashboard and wait for its four data responses. Returns what arrived, so a step can
  // name which widget never loaded instead of timing out on a render.
  async openDashboard({ timeout = 60000 } = {}) {
    const mark = this.responseMark();
    // Requests made BY THIS LOAD start here - the sign-in that precedes it also lands on /dashboard
    // and fetches every widget once, so a whole-log count would see each request twice.
    this.lastOpenRequestMark = this.requestCount();
    const nav = await this.page.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
    this.lastDocumentStatus = nav ? nav.status() : null;
    const loaded = {};
    for (const kind of ['stats', 'queue', 'attention', 'active']) {
      // eslint-disable-next-line no-await-in-loop
      loaded[kind] = await this.waitForKind(kind, { since: mark, timeout });
    }
    await this.heading.waitFor({ state: 'visible', timeout });
    await this.waitForKpisRendered();
    return loaded;
  }

  // The KPI figures paint a literal "-" until stats answer. Wait for the band to hold either a
  // number or the failure copy, so a read never catches the placeholder mid-flight.
  async waitForKpisRendered(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const k = await this.readKpis().catch(() => null);
      if (k && (k.total.value !== null || /No data available/.test(k.raw))) return k;
      await this.page.waitForTimeout(300);
    }
    return null;
  }

  // ======================================================================= the KPI band

  // Parsed BY LABEL (see note 3). Returns null for anything the band does not render.
  async readKpis() {
    const raw = (await this.kpiBand.innerText()).replace(/\r/g, '');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l !== ' ');
    const after = (label, n = 1) => {
      const i = lines.indexOf(label);
      return i >= 0 && i + n < lines.length ? lines[i + n] : null;
    };
    const num = (s) => (s !== null && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);

    const totalRaw = after('Total Candidates');
    const tiles = DashboardPage.KPI_TILES.map(({ label, key }) => {
      const valueRaw = after(label);
      return { label, key, valueRaw, value: num(valueRaw), comparison: after(label, 2) };
    });
    const ofTarget = lines.find((l) => /% of .*Target$/i.test(l)) || null;
    const vsTarget = lines.find((l) => /(Ahead|Behind) of Target$/i.test(l)) || null;
    const ratio = lines.find((l) => /^(\d+|-)\/(\d+|-)$/.test(l)) || null;

    return {
      raw,
      lines,
      period: (await this.periodTrigger.innerText().catch(() => '')).trim() || null,
      total: { valueRaw: totalRaw, value: num(totalRaw) },
      tiles,
      target: {
        ofTargetLine: ofTarget,
        percentAchieved: ofTarget ? Number((/^(-?[\d.]+)%/.exec(ofTarget) || [])[1]) : null,
        targetLabel: ofTarget ? ofTarget.replace(/^-?[\d.]*%\s*of\s*/i, '') : null,
        vsTargetLine: vsTarget,
        vsPercent: vsTarget && /^-?[\d.]+%/.test(vsTarget) ? Number(/^(-?[\d.]+)%/.exec(vsTarget)[1]) : null,
        vsWord: vsTarget ? ((/(Ahead|Behind)/i.exec(vsTarget) || [])[1] || null) : null,
        ratio,
        achieved: ratio ? num(ratio.split('/')[0]) : null,
        goal: ratio ? num(ratio.split('/')[1]) : null,
      },
    };
  }

  async openPeriodMenu() {
    await this.periodTrigger.click();
    const list = this.page.getByRole('listbox').last();
    await list.waitFor({ state: 'visible', timeout: 10000 });
    return list;
  }

  async readPeriodOptions() {
    const list = await this.openPeriodMenu();
    const options = await list.getByRole('option').evaluateAll((os) =>
      os.map((o) => ({ label: o.innerText.trim(), selected: o.getAttribute('aria-selected') === 'true' }))
    );
    await this.page.keyboard.press('Escape');
    await list.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    return options;
  }

  // Choose a period and wait for THAT period's stats response, then for the band to render it.
  // Returns the response so a step can compare the render against the payload behind it.
  async choosePeriod(label, { timeout = 30000 } = {}) {
    const spec = DashboardPage.PERIODS.find((p) => p.label === label);
    if (!spec) throw new Error(`Unknown dashboard period "${label}"`);
    const mark = this.responseMark();
    const reqMark = this.requestCount();
    const list = await this.openPeriodMenu();
    await list.getByRole('option', { name: label, exact: true }).click();
    const periodRe = new RegExp(`[?&]period=${spec.apiValue}(&|$)`);
    // A period already fetched in this page is re-rendered from the app's cache with NO request, so
    // a fresh response is waited for briefly and the cached one used otherwise - flagged as such.
    let res = await this.waitForKind('stats', { since: mark, match: periodRe, timeout: Math.min(timeout, 8000) });
    let cached = false;
    if (!res) {
      await this.flush();
      const earlier = (this.responses || []).filter((r) => r.kind === 'stats' && periodRe.test(r.url));
      res = earlier.length ? earlier[earlier.length - 1] : null;
      cached = Boolean(res);
    }
    if (res && res.body && res.body.total) {
      const want = String(res.body.total.current);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const k = await this.readKpis().catch(() => null);
        if (k && k.total.valueRaw === want && k.period === label) break;
        await this.page.waitForTimeout(250);
      }
    }
    const sent = this.requestsSince(reqMark).filter((r) => r.kind === 'stats').map((r) => r.url);
    return { response: res, sent, cached };
  }

  // The tooltip opens on a pointer ENTERING the control, so the mouse is moved away first: a pointer
  // already resting on it produces no fresh hover and no tooltip.
  async hoverTargetInfo() {
    const tip = this.page.getByRole('tooltip').first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.page.mouse.move(2, 2);
      await this.page.waitForTimeout(300);
      await this.targetInfoButton.hover();
      if (await tip.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        return (await tip.innerText()).trim();
      }
    }
    return '';
  }

  // ======================================================================= section cards

  // The innermost block that holds the card's TITLE and its own CONTENT - a list, a grid or one of
  // its empty-state headings. The content requirement is what keeps the KPI label of the same name
  // from matching (note 2).
  card(title) {
    const empty = DashboardPage.EMPTY_STATES[title];
    let content = this.page.locator('[role="list"], [role="grid"], ul');
    if (empty) content = content.or(this.page.getByText(empty.heading, { exact: true }));
    if (title === 'Referral Codes') content = this.page.getByText(/^Agent Code$/);
    return this.main
      .locator('div')
      .filter({ has: this.page.locator('p', { hasText: new RegExp(`^${title}$`) }) })
      .filter({ has: content })
      .last();
  }

  async sectionOrder() {
    const boxes = [];
    for (const t of ['Total Candidates', ...DashboardPage.SECTIONS]) {
      const loc = t === 'Total Candidates' ? this.kpiBand : this.card(t);
      // eslint-disable-next-line no-await-in-loop
      const box = await loc.boundingBox().catch(() => null);
      boxes.push({ section: t === 'Total Candidates' ? 'KPI band' : t, y: box ? Math.round(box.y) : null, x: box ? Math.round(box.x) : null });
    }
    return boxes;
  }

  // The count beside a card title ("157 Items", "39 Candidates"). null when the card renders none,
  // which is what its empty state does.
  async cardCount(title) {
    const text = await this.card(title).innerText();
    const m = /^(\d+)\s+(Items?|Candidates?)$/m.exec(text);
    return m ? { value: Number(m[1]), unit: m[2], raw: m[0] } : null;
  }

  async cardHasViewAll(title) {
    return (await this.card(title).getByText('View all', { exact: true }).count()) > 0;
  }

  async clickViewAll(title) {
    await this.card(title).getByText('View all', { exact: true }).first().click();
  }

  async readEmptyState(title) {
    const spec = DashboardPage.EMPTY_STATES[title];
    const card = this.card(title);
    const text = (await card.innerText().catch(() => '')).replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = spec ? lines.indexOf(spec.heading) : -1;
    const ctas = await card.getByRole('button').evaluateAll((bs) => bs.map((b) => b.innerText.trim()).filter(Boolean));
    return {
      present: at >= 0,
      heading: at >= 0 ? lines[at] : null,
      body: at >= 0 ? lines[at + 1] || null : null,
      ctas,
      rows: await card.getByRole('listitem').filter({ hasNot: this.page.locator('[role="separator"]') }).count(),
      lines,
    };
  }

  // ---- Document Verification Queue ----

  queueRows() {
    return this.card('Document Verification Queue')
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button', { name: 'Review', exact: true }) });
  }

  async readQueueRows() {
    return this.queueRows().evaluateAll((items) =>
      items.map((li) => {
        const lines = li.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        const uploaded = lines.find((l) => /^Uploaded on /.test(l)) || null;
        const iUp = lines.indexOf(uploaded);
        return {
          fileName: lines[0] || null,
          uploadedOn: uploaded ? uploaded.replace(/^Uploaded on /, '') : null,
          uploader: iUp >= 0 ? lines[iUp + 1] || null : null,
          actions: [...li.querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => t === 'Review'),
        };
      })
    );
  }

  async openReview(index = 0) {
    await this.queueRows().nth(index).getByRole('button', { name: 'Review', exact: true }).click();
  }

  async clickQueueFileName(index = 0) {
    await this.queueRows().nth(index).locator('button').first().click();
  }

  // ---- Requires Attention ----

  attentionRows() {
    // Structural, not textual: a real row holds the candidate's name button, a separator <li> holds
    // nothing. (A text filter like /\bWarning\b/ never matches - Playwright's hasText reads text
    // content with no spaces between elements, so the row reads "Ghazan AhmedWarning...".)
    return this.card('Requires Attention')
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button') });
  }

  async readAttentionRows() {
    return this.attentionRows().evaluateAll((items) =>
      items.map((li) => {
        const lines = li.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        // [initials, name, severity, issue, "<n>d ago"]
        const sevIdx = lines.findIndex((l) => /^(Warning|Critical)$/.test(l));
        return {
          initials: lines[0] || null,
          name: sevIdx > 0 ? lines[sevIdx - 1] : null,
          severity: sevIdx >= 0 ? lines[sevIdx] : null,
          issue: sevIdx >= 0 ? lines[sevIdx + 1] || null : null,
          when: lines[lines.length - 1] || null,
          buttons: [...li.querySelectorAll('button')].map((b) => b.innerText.trim()),
        };
      })
    );
  }

  // ---- Active Candidates ----

  activeGrid() {
    return this.card('Active Candidates').getByRole('grid').first();
  }

  async readActiveColumns() {
    return this.activeGrid()
      .getByRole('columnheader')
      .evaluateAll((hs) => hs.map((h) => h.innerText.replace(/\s+/g, ' ').trim()));
  }

  activeRows() {
    return this.activeGrid().getByRole('rowgroup').nth(1).getByRole('row');
  }

  async readActiveRows() {
    return this.activeRows().evaluateAll((rows) =>
      rows.map((r) => {
        const head = r.querySelector('[role="rowheader"]');
        const headButtons = head ? [...head.querySelectorAll('button')].map((b) => b.innerText.trim()) : [];
        const cells = [...r.querySelectorAll('[role="gridcell"]')];
        const actions = cells.length
          ? [...cells[cells.length - 1].querySelectorAll('button')].map((b) => ({
              name: b.getAttribute('aria-label') || b.innerText.trim(),
              disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('data-disabled'),
            }))
          : [];
        return {
          name: headButtons[0] || null,
          email: headButtons[1] || null,
          verification: cells[0] ? cells[0].innerText.trim() : null,
          pendingDocuments: cells[1] ? cells[1].innerText.trim() : null,
          subscription: cells[2] ? cells[2].innerText.trim() : null,
          lastActivity: cells[3] ? cells[3].innerText.trim() : null,
          actions,
        };
      })
    );
  }

  activeRowFor(email) {
    return this.activeRows().filter({ has: this.page.getByRole('button', { name: email, exact: true }) }).first();
  }

  // ======================================================================= header

  async avatarInitials() {
    return (await this.profileMenuTrigger.innerText()).trim();
  }

  async readAvatarMenu() {
    await this.profileMenuTrigger.click();
    const menu = this.page.getByRole('menu').last();
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    const items = await menu
      .locator('[role="menuitemradio"], [role="menuitem"]')
      .evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    // The identity block (initials, name, email) sits ABOVE the menu proper, in the same popover.
    const popover = this.page.locator('[role="dialog"]:visible').filter({ has: menu }).last();
    const text = (await popover.innerText().catch(async () => menu.innerText())).replace(/\r/g, '');
    return { items, text };
  }

  // Always opens the menu FRESH: a menu just closed by Escape is still attached while it animates
  // out, so its items resolve but cannot be clicked, and a click on them waits out its timeout.
  async chooseAvatarItem(label) {
    await this.page.getByRole('menu').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await this.profileMenuTrigger.click();
    const item = this.page
      .getByRole('menuitemradio', { name: label, exact: true })
      .or(this.page.getByRole('menuitem', { name: label, exact: true }))
      .first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    await item.click();
  }

  async languageState() {
    return this.page.evaluate(() => ({
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || null,
    }));
  }

  // Whatever popup surface is open right now - menu, listbox, dialog or tooltip - as text.
  async openPopups() {
    return (await this.page
      .locator('[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible, [role="tooltip"]:visible')
      .allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  }

  async visibleDialogs() {
    return (await this.page.locator('[role="dialog"]:visible').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  }

  // Watch a window for anything an inert control might have done: a navigation, a dialog, a popup,
  // or a request. "Nothing happened" is an ABSENCE, so it is watched rather than sampled once.
  //
  // A TOOLTIP IS NOT COUNTED by default. Clicking a control also hovers it, and the Active grid's
  // email cell shows a full-address tooltip at 1280px because the address is truncated there - which
  // the first version read as "the email button opened something". A hover tooltip is not a response
  // to ACTIVATION; pass { countTooltips: true } only where a tooltip is the expected answer.
  async watchForReaction(action, { windowMs = 3000, countTooltips = false } = {}) {
    const read = async () => {
      const sel = countTooltips
        ? '[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible, [role="tooltip"]:visible'
        : '[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible';
      return (await this.page.locator(sel).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    };
    const url = this.page.url();
    const reqMark = this.requestCount();
    const popupsBefore = (await read()).length;
    await action();
    const deadline = Date.now() + windowMs;
    let reaction = null;
    while (Date.now() < deadline && !reaction) {
      // eslint-disable-next-line no-await-in-loop
      const popups = await read();
      if (this.page.url() !== url) reaction = { kind: 'navigation', to: this.page.url() };
      else if (popups.length > popupsBefore) reaction = { kind: 'popup', text: popups[popups.length - 1].slice(0, 200) };
      else {
        const reqs = this.requestsSince(reqMark).filter((r) => r.kind !== 'unread');
        if (reqs.length) reaction = { kind: 'request', requests: reqs.map((r) => `${r.method} ${r.url}`) };
      }
      // eslint-disable-next-line no-await-in-loop
      if (!reaction) await this.page.waitForTimeout(200);
    }
    return { reacted: Boolean(reaction), reaction };
  }

  async horizontalOverflow() {
    return this.page.evaluate(() => {
      const main = document.querySelector('main');
      return {
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        mainScrollWidth: main ? main.scrollWidth : null,
        mainClientWidth: main ? main.clientWidth : null,
      };
    });
  }
}

DashboardPage.ENDPOINTS = ENDPOINTS;

module.exports = DashboardPage;
