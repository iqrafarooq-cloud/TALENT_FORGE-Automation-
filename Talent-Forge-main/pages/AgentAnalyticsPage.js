// SuperAdmin Portal > Analytics > Agents (/agents-analytics).
//
// Measured 2026-11-03 with scripts/probe-superadmin-agent-analytics.js (read-only). The page is
// the superadmin's LANDING page and holds two global filters and seven widget cards. Nothing on
// it writes: both filters are GETs, View All navigates, the backlog View All opens a read-only
// modal. So the whole area is safe in the default run and there is nothing to clean up.
//
// >>> EVERY VALUE IS COMPARED WITH THE RESPONSE THE APP RECEIVED, NEVER WITH A LITERAL. <<<
// This is shared DEV data that moves every day. install() keeps every analytics response, and the
// readers below return what the card RENDERS; steps put the two side by side.
//
// THE NINE REQUESTS (all GET /core/api/v1/agent/analytics/<key>/?duration=<v>[&university=<ids>]):
//
//   key                  widget                               payload
//   overview             Widget 1 Agent Performance Overview  total_agents, high_performing, average,
//                                                             requires_attention, avg_candidates_per_agent,
//                                                             avg_verification_time_seconds, total_promo_revenue
//   performing           Widget 2 Top Performing Agents       [ {name,total_candidates,documents_verified,revenue_generated} ]
//   attention            Widget 3 Agents Requiring Attention  {count, results:[{name,reason,timestamp}]} (sent with pageSize=5)
//   revenue              Widget 4 Revenue Impact              {total, trends:[{month,year,revenue}]}
//   revenue/agents       Widget 4 Top Revenue Generating      [ {name,revenue_generated} ]
//   documents/overview   Widget 5 Verification Overview       {verified, pending, revisions_requested}
//   documents/trend      Widget 5 Verification Activity Trend [ {month,year,documents_uploaded,documents_verified} ]
//   documents/breakdown  Widget 6 Verification Breakdown      {total_submitted, transcripts, experience_letters, certifications}
//   documents/backlog    Widget 7 Verification Backlog Alerts [ {agent_name, pending_document_count} ]
//
// FILTERS
//   Duration   : URL ?duration=Monthly|Quarterly|Yearly|Year-to-Date -> API current_month|last_quarter|yearly|ytd.
//                The trigger shows "Duration" + a count badge, never the chosen value. The chosen option
//                carries a check-mark <svg>. Picking an option does NOT close the popover.
//   University : URL ?university=<id>[,<id>] -> API university=<id>%2C<id>. Options come from
//                GET /institutions/?page=&page_size=10[&search=] and load 10 more on scroll. Each option
//                is button[data-testid="...-option-checkbox"]. "Clear All" sits at the foot.
//
// LOCATORS. Both triggers and the two View All controls carry test ids; the cards do not, so each
// card is found by the app's own structural class (stable on this build) with its heading as the
// fallback - the same layering the rest of the suite uses.
const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').origin;

const KEYS = [
  'overview', 'performing', 'attention', 'revenue', 'revenue/agents',
  'documents/overview', 'documents/trend', 'documents/breakdown', 'documents/backlog',
];

const DURATIONS = {
  Monthly: 'current_month',
  Quarterly: 'last_quarter',
  Yearly: 'yearly',
  'Year-to-Date': 'ytd',
};

const CARDS = {
  overview: { cls: '.total-agents-card', heading: 'Total Agents' },
  performing: { cls: '.top-performing-agents-card', heading: 'Top Performing Agents' },
  attention: { cls: '.agents-requiring-attention-card', heading: 'Agents Requiring Attention' },
  revenue: { cls: '.promo-revenue-card', heading: 'Revenue Impact' },
  documents: { cls: '.document-verification-overview-card', heading: 'Document Verification Overview' },
  breakdown: { cls: '.document-verification-breakdown-card', heading: 'Document Verification Breakdown' },
  backlog: { cls: '.verification-backlog-alerts-card', heading: 'Verification Backlog Alerts' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// "215,927.37 SAR" -> 215927.37, "-" -> null.
const num = (s) => {
  const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

class AgentAnalyticsPage {
  constructor(page) {
    this.page = page;
    this.responses = [];
    this._parses = [];
    this.durationTrigger = page.locator('[data-testid="admin-analytics-agents-duration-select"]');
    this.universityTrigger = page.locator('[data-testid="admin-analytics-agents-university-select"]');
    this.universitySearch = page.locator('[data-testid="admin-analytics-agents-university-select-search-input"]');
    this.universityOptions = page.locator('[data-testid="admin-analytics-agents-university-select-option-checkbox"]');
    this.attentionViewAll = page.locator('[data-testid="admin-analytics-agents-requiring-attention-view-all-button"]');
    this.backlogViewAll = page.locator('[data-testid="admin-analytics-agents-verification-backlog-view-all-button"]');
    this.backlogModalClose = page.locator('[data-testid="admin-analytics-agents-verification-backlog-modal-close-button"]');
  }

  static get KEYS() { return KEYS; }
  static get DURATIONS() { return DURATIONS; }
  static get MONTHS() { return MONTHS; }
  static num(s) { return num(s); }

  // The AC writes "Year to Date", the build "Year-to-Date": resolve a requirement label to the
  // option the build renders, ignoring case, spaces and hyphens.
  static buildLabel(label) {
    const n = (s) => String(s).toLowerCase().replace(/[-\s]+/g, ' ').trim();
    const hit = Object.keys(DURATIONS).find((k) => n(k) === n(label));
    if (!hit) throw new Error(`"${label}" is not one of the Agents Analytics durations: ${Object.keys(DURATIONS).join(', ')}`);
    return hit;
  }

  // GET against the app's own API with the session the app holds.
  async api(pathAndQuery) {
    if (!this.token) throw new Error('no bearer token has been seen yet - the dashboard has not loaded');
    const r = await this.page.request.get(`${this.apiBase}${pathAndQuery}`, { headers: { authorization: this.token } });
    return { status: r.status(), body: await r.json().catch(() => null) };
  }

  // Called from PagesFixture BEFORE the first navigation: the default load fires all nine
  // requests at once, and a listener attached afterwards would miss the very payloads the
  // first assertion compares against.
  install() {
    if (this._installed) return;
    this._installed = true;
    // The app keeps its bearer token in memory, never in storage, so the only way to make a
    // cross-check request (e.g. the agents listing count) is to reuse the header it sends.
    this.page.on('request', (r) => {
      const auth = r.headers().authorization;
      if (auth && /\/core\/api\/v1\//.test(r.url())) {
        this.token = auth;
        this.apiBase = r.url().split('/core/api/v1/')[0] + '/core/api/v1';
      }
    });
    this.page.on('response', (r) => {
      const url = r.url();
      const m = url.match(/\/api\/v1\/agent\/analytics\/(.+?)\/?(\?|$)/);
      const inst = /\/api\/v1\/institutions\//.test(url);
      if ((!m && !inst) || r.request().method() !== 'GET') return;
      const u = new URL(url);
      const rec = {
        key: m ? m[1].replace(/\/$/, '') : 'institutions',
        url,
        params: Object.fromEntries(u.searchParams.entries()),
        status: r.status(),
        body: null,
        at: Date.now(),
      };
      this.responses.push(rec);
      this._parses.push(r.json().then((b) => { rec.body = b; }).catch(() => {}));
    });
  }

  mark() { return this.responses.length; }

  async flush() { await Promise.all(this._parses); }

  since(index, key) {
    return this.responses.slice(index).filter((r) => !key || r.key === key);
  }

  latest(key) {
    const list = this.responses.filter((r) => r.key === key);
    return list.length ? list[list.length - 1] : null;
  }

  // The params the widgets SHOULD have been asked for, read off the URL the page holds.
  // An unrecognised ?duration= is sent as no duration at all (measured), which this mirrors.
  urlParams() {
    const q = new URL(this.page.url()).searchParams;
    // Several universities are written as REPEATED params (?university=117&university=24) while
    // the API gets one comma list (university=117%2C24), so join getAll() - get() returns the first.
    const unis = q.getAll('university').filter(Boolean);
    return { duration: DURATIONS[q.get('duration')], university: unis.length ? unis.join(',') : undefined };
  }

  static matches(r, want) {
    return r.params.duration === want.duration && (r.params.university || undefined) === want.university;
  }

  // >>> THE RESPONSE BEHIND THE RENDER IS THE ONE MATCHING THE URL, NOT THE LAST TO ARRIVE. <<<
  // Two measured reasons: a deep link fires an UNFILTERED round and then the filtered one, and the
  // unfiltered answer can land last; and a query the app has already made is served from its
  // cache with NO request (Clear All, a repeated duration, Back, the sidebar link).
  current(key) {
    const want = this.urlParams();
    const list = this.responses.filter((r) => r.key === key);
    const hit = list.filter((r) => AgentAnalyticsPage.matches(r, want)).pop();
    return hit || list[list.length - 1] || null;
  }

  // Waits until every widget has a response for the query the URL now holds - fresh, or from the
  // app's cache - then for the cards to paint.
  async settle(index, { timeout = 45000 } = {}) {
    const deadline = Date.now() + timeout;
    let missing = KEYS;
    const grace = Date.now() + 3000;
    while (Date.now() < deadline) {
      const want = this.urlParams();
      missing = KEYS.filter((k) => !this.responses.some((r) => r.key === k && AgentAnalyticsPage.matches(r, want)));
      const fresh = KEYS.every((k) => this.since(index, k).some((r) => AgentAnalyticsPage.matches(r, want)));
      if (!missing.length && (fresh || Date.now() > grace)) break;
      await this.page.waitForTimeout(250);
    }
    if (missing.length) throw new Error(`no response matching ${JSON.stringify(this.urlParams())} for these widgets: ${missing.join(', ')}`);
    await this.flush();
    await this.page.waitForTimeout(1200);
    return Object.fromEntries(KEYS.map((k) => [k, this.current(k)]));
  }

  // Waits until every widget has answered AFTER `index`, then for the cards to paint. Throws
  // naming the widgets that never answered, which is a different finding from a wrong value.
  async waitForWidgets(index, { timeout = 45000, keys = KEYS } = {}) {
    const deadline = Date.now() + timeout;
    let missing = keys;
    while (Date.now() < deadline) {
      missing = keys.filter((k) => !this.since(index, k).length);
      if (!missing.length) break;
      await this.page.waitForTimeout(250);
    }
    if (missing.length) throw new Error(`these Agents Analytics widgets never answered: ${missing.join(', ')}`);
    await this.flush();
    await this.page.waitForTimeout(1200); // the cards re-render a tick after the data lands
    return Object.fromEntries(keys.map((k) => [k, this.since(index, k).pop()]));
  }

  async open(query = '') {
    const at = this.mark();
    const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
    await this.page.goto(`${ORIGIN}/agents-analytics${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.durationTrigger.waitFor({ state: 'visible', timeout: 45000 });
    return this.settle(at);
  }

  async reload() {
    const at = this.mark();
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.durationTrigger.waitFor({ state: 'visible', timeout: 45000 });
    return this.settle(at);
  }

  card(name) {
    const c = CARDS[name];
    return this.page.locator(c.cls).or(this.page.locator('section', { hasText: c.heading })).first();
  }

  // ------------------------------------------------------------------ popovers

  popover() { return this.page.locator('[role="dialog"][data-trigger="DialogTrigger"]').last(); }

  async closePopover() {
    if (await this.popover().isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await this.popover().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  async openDuration() {
    await this.closePopover();
    await this.durationTrigger.click();
    await this.popover().locator('.list-option').first().waitFor({ state: 'visible', timeout: 10000 });
  }

  async durationOptions() {
    await this.openDuration();
    const opts = await this.popover().locator('.list-option').evaluateAll((els) => els.map((e) => ({
      label: e.innerText.replace(/\s+/g, ' ').trim(),
      checked: !!e.querySelector('svg'),
    })));
    await this.closePopover();
    return opts;
  }

  async triggerText(which) {
    const t = which === 'university' ? this.universityTrigger : this.durationTrigger;
    return clean(await t.innerText());
  }

  // Picks a duration and waits for all nine widgets to answer with it. Returns the responses.
  async chooseDuration(label, { wait = true } = {}) {
    await this.openDuration();
    const at = this.mark();
    const shown = AgentAnalyticsPage.buildLabel(label);
    await this.popover().locator('.list-option', { hasText: new RegExp(`^\\s*${shown.replace(/[-]/g, '\\-')}\\s*$`) }).first().click();
    const out = wait ? await this.settle(at) : null;
    await this.closePopover();
    return out;
  }

  async openUniversity() {
    await this.closePopover();
    await this.universityTrigger.click();
    await this.universitySearch.waitFor({ state: 'visible', timeout: 10000 });
    await this.universityOptions.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  async readUniversityOptions() {
    return this.universityOptions.evaluateAll((els) => els.map((e) => ({
      name: e.innerText.replace(/\s+/g, ' ').trim(),
      checked: !!(e.querySelector('input[type="checkbox"]') || {}).checked,
    })));
  }

  async scrollUniversityList() {
    const at = this.mark();
    await this.popover().evaluate((d) => {
      const scroller = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 5) || d;
      scroller.scrollTop = scroller.scrollHeight;
    });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !this.since(at, 'institutions').length) await this.page.waitForTimeout(250);
    await this.flush();
    await this.page.waitForTimeout(800);
    return this.since(at, 'institutions');
  }

  async searchUniversity(term) {
    const at = this.mark();
    await this.universitySearch.fill('');
    await this.universitySearch.pressSequentially(term, { delay: 40 });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const hit = this.since(at, 'institutions').find((r) => (r.params.search || '') === term);
      if (hit) break;
      await this.page.waitForTimeout(250);
    }
    await this.flush();
    await this.page.waitForTimeout(1000);
    return this.since(at, 'institutions').filter((r) => (r.params.search || '') === term).pop() || null;
  }

  // Toggles one university by its exact name (the popover must be open) and waits for the
  // widgets to re-query. The popover stays open, as the app leaves it.
  async toggleUniversity(name) {
    const at = this.mark();
    const opt = this.universityOptions.filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    await opt.click({ timeout: 10000 });
    return this.settle(at);
  }

  async clearUniversities() {
    const at = this.mark();
    await this.popover().getByText(/^Clear All$/).click();
    return this.settle(at);
  }

  async popoverText() { return clean(await this.popover().innerText().catch(() => '')); }

  // ------------------------------------------------------------------ readers

  async cardLines(name) {
    const text = await this.card(name).innerText();
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  static after(lines, label) {
    const i = lines.findIndex((l) => l === label);
    return i >= 0 ? lines[i + 1] : null;
  }

  async readOverview() {
    const l = await this.cardLines('overview');
    const cat = (re) => { const x = l.find((s) => re.test(s)); return x ? num(x.match(/\((\d[\d,]*)\)/)[1]) : null; };
    const verif = AgentAnalyticsPage.after(l, 'Avg. Verification Time');
    const verIdx = l.indexOf('Avg. Verification Time');
    const bars = await this.card('overview').locator('.progress-bar-chunk').evaluateAll((els) => els.map((e) => ({
      width: parseFloat(e.style.width), color: e.style.backgroundColor,
    }))).catch(() => []);
    return {
      lines: l,
      totalAgents: num(AgentAnalyticsPage.after(l, 'Total Agents')),
      high: cat(/^High Performing \(/),
      average: cat(/^Average \(/),
      attention: cat(/^Requires Attention \(/),
      avgCandidates: num(AgentAnalyticsPage.after(l, 'Avg. Candidates per Agent')),
      avgCandidatesChange: l[l.indexOf('Avg. Candidates per Agent') + 2] || null,
      avgVerification: verif,
      avgVerificationChange: verIdx >= 0 ? l[verIdx + 2] : null,
      totalRevenue: AgentAnalyticsPage.after(l, 'Total Revenue'),
      totalRevenueChange: l[l.indexOf('Total Revenue') + 2] || null,
      bars,
    };
  }

  async readTopPerforming() {
    const card = this.card('performing');
    const headers = await card.locator('th, [role="columnheader"]').allInnerTexts().then((a) => a.map(clean));
    const rows = await card.locator('tbody tr, [role="row"]:not(:has([role="columnheader"]))').evaluateAll((trs) => trs
      .map((tr) => Array.from(tr.querySelectorAll('td, [role="gridcell"], [role="rowheader"]')).map((c) => c.innerText.replace(/\s+/g, ' ').trim()))
      .filter((cells) => cells.length >= 5));
    return {
      headers,
      rows: rows.map((c) => ({ rank: c[0], agent: c[1], candidates: num(c[2]), verified: num(c[3]), revenue: c[4] })),
      text: clean(await card.innerText()),
    };
  }

  async readAttention() {
    const card = this.card('attention');
    const lines = await this.cardLines('attention');
    const rows = await card.locator('.agents-list-container > div').evaluateAll((els) => els.map((r) => {
      const ps = Array.from(r.querySelectorAll('p'));
      const box = r.getBoundingClientRect();
      const main = r.closest('main') || r.parentElement;
      const mb = main.getBoundingClientRect();
      return {
        name: (r.querySelector('.truncate') || {}).innerText || null,
        severity: (r.querySelector('.status-badge-label') || {}).innerText || null,
        reason: ps[1] ? ps[1].innerText.trim() : null,
        when: ps[2] ? ps[2].innerText.trim() : null,
        fullyVisible: box.top >= mb.top - 1 && box.bottom <= mb.bottom + 1,
      };
    }));
    const scroll = await card.locator('main').first().evaluate((m) => ({ scrollHeight: m.scrollHeight, clientHeight: m.clientHeight })).catch(() => null);
    const badge = lines.find((l) => /^\d[\d,]* Items?$/.test(l)) || null;
    return { lines, badge, count: badge ? num(badge) : null, rows, scroll };
  }

  async scrollAttention() {
    await this.card('attention').locator('main').first().evaluate((m) => { m.scrollTop = m.scrollHeight; });
    await this.page.waitForTimeout(500);
  }

  async readRevenue() {
    const card = this.card('revenue');
    const l = await this.cardLines('revenue');
    const svgText = await card.locator('svg text').allTextContents().catch(() => []);
    const months = svgText.map(clean).filter((t) => MONTHS.includes(t));
    const bars = await card.locator('.recharts-bar-rectangle path, .recharts-bar-rectangle rect').evaluateAll((els) => els.map((p) => ({
      fill: p.getAttribute('fill'),
      opacity: p.getAttribute('opacity') || p.getAttribute('fill-opacity') || getComputedStyle(p).opacity,
      stroke: p.getAttribute('stroke'),
    }))).catch(() => []);
    const topIdx = l.indexOf('Top Revenue Generating Agents');
    const top = [];
    if (topIdx >= 0) {
      const rest = l.slice(topIdx + 1);
      for (let i = 0; i < rest.length; i += 1) {
        if (/^#\d+$/.test(rest[i])) top.push({ rank: rest[i], agent: rest[i + 1], revenue: rest[i + 2] });
      }
    }
    return {
      lines: l,
      total: AgentAnalyticsPage.after(l, 'Total Revenue Generated'),
      change: l[l.indexOf('Total Revenue Generated') + 2] || null,
      months,
      bars,
      top,
      text: clean(l.join(' ')),
    };
  }

  async readDocumentsOverview() {
    const card = this.card('documents');
    const l = await this.cardLines('documents');
    const svgText = await card.locator('svg text').allTextContents().catch(() => []);
    return {
      lines: l,
      verified: num(AgentAnalyticsPage.after(l, 'Verified Documents')),
      pending: num(AgentAnalyticsPage.after(l, 'Pending Verifications')),
      revisions: num(AgentAnalyticsPage.after(l, 'Revision Requested')),
      legend: l.filter((x) => /^Documents (Uploaded|Verified)$/.test(x)),
      lines2: await card.locator('.recharts-line').count().catch(() => 0),
      months: svgText.map(clean).filter((t) => MONTHS.includes(t)),
      text: clean(l.join(' ')),
    };
  }

  async readBreakdown() {
    const card = this.card('breakdown');
    const l = await this.cardLines('breakdown');
    const segs = await card.locator('[style*="flex"][style*="background"]').evaluateAll((els) => els.map((e) => ({
      grow: parseFloat(e.style.flexGrow || (e.style.flex || '').split(' ')[0]),
      background: e.style.background || e.style.backgroundColor,
    }))).catch(() => []);
    const cat = (label) => {
      const i = l.indexOf(label);
      return i >= 0 ? { label, value: l[i + 1] || null } : { label, value: null };
    };
    return {
      lines: l,
      total: num(AgentAnalyticsPage.after(l, 'Total Documents Verified')),
      categories: [cat('Transcripts'), cat('Experience Letters'), cat('Certifications')],
      segments: segs,
      text: clean(l.join(' ')),
    };
  }

  async readBacklog() {
    const card = this.card('backlog');
    const rows = await card.locator('main > div > div').evaluateAll((els) => els.map((r) => {
      const ps = Array.from(r.querySelectorAll('p'));
      const tag = ps.find((p) => /^\s*\d[\d,]*\s+pending\s*$/i.test(p.innerText));
      return {
        agent: ps[0] ? ps[0].innerText.trim() : null,
        tag: tag ? tag.innerText.trim() : null,
        color: tag ? (tag.getAttribute('style') || '') : '',
      };
    })).catch(() => []);
    // A row is an agent only if it carries an "<n> pending" tag: the empty state sits in the same
    // container, and its sentence ("...unusually high pending verification queues.") contains the
    // word "pending" - a looser test read it as an agent named "No verification backlog alerts".
    return { rows: rows.filter((r) => r.agent && r.tag), text: clean(await card.innerText()) };
  }

  static tagColour(style) {
    if (/error/i.test(style)) return 'red';
    if (/warning/i.test(style)) return 'yellow';
    if (!style) return 'none';
    return style;
  }

  backlogModal() {
    return this.page.locator('[role="dialog"]', { has: this.backlogModalClose }).last();
  }

  async openBacklogModal() {
    await this.closePopover();
    // An empty backlog card offers no View All at all, so say that instead of waiting it out.
    if (!(await this.backlogViewAll.isVisible().catch(() => false))) {
      await this.backlogViewAll.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        throw new Error('Verification Backlog Alerts offers no View All (the card is empty for the current filters)');
      });
    }
    await this.backlogViewAll.click();
    await this.backlogModalClose.waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(500);
  }

  async readBacklogModal() {
    const modal = this.backlogModal();
    const rows = await modal.locator('p[style]').evaluateAll((ps) => ps.map((p) => {
      const row = p.parentElement;
      const name = Array.from(row.querySelectorAll('p')).find((x) => x !== p);
      return { agent: name ? name.innerText.trim() : null, tag: p.innerText.trim(), color: p.getAttribute('style') || '' };
    }));
    const heading = clean((await modal.innerText()).split('\n')[0]);
    return { heading, rows };
  }

  async closeBacklogModal(how) {
    if (/escape/i.test(how)) await this.page.keyboard.press('Escape');
    else if (/outside/i.test(how)) await this.page.mouse.click(5, 5);
    else await this.backlogModalClose.click();
    await this.backlogModalClose.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    return !(await this.backlogModalClose.isVisible().catch(() => false));
  }

  // The info icon in a card header. A real hover first leaves the control so react-aria sees
  // the pointer ENTER it (a pointer already resting there opens nothing).
  async tooltipOf(name, via = 'hover') {
    const btn = this.card(name).locator('header button:not([data-testid]), button:not([data-testid])').first();
    await this.page.mouse.move(2, 2);
    await this.page.waitForTimeout(300);
    if (via === 'keyboard') {
      await btn.focus();
      await this.page.keyboard.press('Shift+Tab');
      await this.page.keyboard.press('Tab');
    } else {
      await btn.hover();
    }
    const tip = this.page.locator('[role="tooltip"]').last();
    await tip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const text = clean(await tip.innerText().catch(() => ''));
    const label = await btn.getAttribute('aria-label');
    await this.page.mouse.move(2, 2);
    return { text, label };
  }

  // Every card's visible text, for empty / failed-state assertions.
  async allCardText() {
    const out = {};
    for (const name of Object.keys(CARDS)) out[name] = clean(await this.card(name).innerText().catch(() => ''));
    return out;
  }
}

module.exports = AgentAnalyticsPage;
