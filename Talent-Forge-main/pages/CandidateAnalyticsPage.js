// SuperAdmin Portal > Analytics > Candidates (/candidate-analytics).
//
// Measured 2026-11-10 with scripts/probe-superadmin-candidate-analytics{,-2,-3,-4}.js (all
// read-only). Two filters and six widget cards; nothing on the page writes, so the whole area is
// safe in the default run and there is nothing to clean up.
//
// >>> EVERY VALUE IS COMPARED WITH THE RESPONSE THE APP RECEIVED, NEVER WITH A LITERAL. <<<
//
// REQUESTS (GET /core/api/v1/analytics/candidates/<key>/?duration=<v>[&university=<id>]):
//   overview       Candidate Overview      total_candidates, active_candidates, in_onboarding_process, requires_attention (+ *_change)
//   by-university  Candidates by University total_candidates, major_breakdown:[{major,count,track_completion_rate}]
//                  - fired ONLY once a university is picked, and re-fired on every duration change
//   by-city        Candidates by City      city_breakdown:[{city_name,total_candidates,open_to_relocate}],
//                                          relocation_insights:[{city_name,candidate_count,top_destination:{location_name,candidate_count}}]
//   journey        Candidate Journey Funnel signed_up, profile_complete, track_started, co_op_completed, tamheer_completed, track_completed, placed
//   progress       Progress & Learning     track_started, track_completed, completion_rate, learning_activity_trend:[{month,course_started,...}]
//   coop-tamheer   Co-op & Tamheer         co_op_started/completed, tamheer_started/completed, trend:{co_op_trend,tamheer_trend}
// The University options come from GET /institutions/?page=1&page_size=500 ({id,name,is_active}).
//
// FILTERS
//   Duration   : URL ?duration=Monthly|Quarterly|Year-to-Date -> API current_month|last_quarter|ytd.
//                Yearly is the DEFAULT and writes NO param (choosing it removes the param).
//                Trigger [data-testid="admin-analytics-candidates-duration-select"] reads "Duration 1".
//   University : a react-aria combobox (input + "Show suggestions" toggle). Client-side search.
//                NOT written to the URL - a reload drops it.
const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').origin;

const KEYS = ['overview', 'by-city', 'journey', 'progress', 'coop-tamheer'];
const DURATIONS = { Monthly: 'current_month', Quarterly: 'last_quarter', Yearly: 'yearly', 'Year-to-Date': 'ytd' };
// The value the URL carries for each duration (Yearly is the default and writes none).
const URL_VALUES = { Monthly: 'Monthly', Quarterly: 'Quarterly', Yearly: null, 'Year-to-Date': 'Year-to-Date' };

const CARDS = {
  overview: { cls: '.total-agents-card', heading: 'Total Candidates' },
  university: { cls: '.candidates-by-university-card', heading: 'Candidates by University' },
  city: { cls: '.candidates-by-city-card', heading: 'Candidates by City' },
  journey: { cls: '.candidate-journey-full-card', heading: 'Candidate Journey Funnel' },
  progress: { cls: '.candidate-progress-and-learning-activity-card', heading: 'Candidate Progress & Learning Activity' },
  coop: { cls: '.co-op-and-tamheer-progress-card', heading: 'Co-op & Tamheer' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const num = (s) => {
  const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

class CandidateAnalyticsPage {
  constructor(page) {
    this.page = page;
    this.responses = [];
    this._parses = [];
    this.durationTrigger = page.locator('[data-testid="admin-analytics-candidates-duration-select"]');
    this.universityInput = page.locator('[data-testid="admin-analytics-candidates-university-input"]');
    this.universityToggle = page.locator('[data-testid="admin-analytics-candidates-university-input-toggle-button"]');
    this.coopTab = page.locator('[data-testid="admin-analytics-candidates-tab-co-op"]');
    this.tamheerTab = page.locator('[data-testid="admin-analytics-candidates-tab-tamheer"]');
  }

  static get KEYS() { return KEYS; }
  static get DURATIONS() { return DURATIONS; }
  static get URL_VALUES() { return URL_VALUES; }
  static get MONTHS() { return MONTHS; }
  static num(s) { return num(s); }

  // The AC writes "Year-to-Date" and "Year to Date" interchangeably.
  static buildLabel(label) {
    const n = (s) => String(s).toLowerCase().replace(/[-\s]+/g, ' ').trim();
    const hit = Object.keys(DURATIONS).find((k) => n(k) === n(label));
    if (!hit) throw new Error(`"${label}" is not one of the Candidates Analytics durations: ${Object.keys(DURATIONS).join(', ')}`);
    return hit;
  }

  async api(pathAndQuery) {
    if (!this.token) throw new Error('no bearer token has been seen yet - the dashboard has not loaded');
    const r = await this.page.request.get(`${this.apiBase}${pathAndQuery}`, { headers: { authorization: this.token } });
    return { status: r.status(), body: await r.json().catch(() => null) };
  }

  // Called from PagesFixture BEFORE the first navigation: the default load fires every widget at
  // once, and a listener attached afterwards would miss the payloads the first assertion needs.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.page.on('request', (r) => {
      const auth = r.headers().authorization;
      if (auth && /\/core\/api\/v1\//.test(r.url())) {
        this.token = auth;
        this.apiBase = `${r.url().split('/core/api/v1/')[0]}/core/api/v1`;
      }
    });
    this.page.on('response', (r) => {
      const url = r.url();
      const m = url.match(/\/api\/v1\/analytics\/candidates\/([a-z-]+)\/?(\?|$)/);
      const inst = /\/api\/v1\/institutions\//.test(url);
      if ((!m && !inst) || r.request().method() !== 'GET') return;
      const rec = {
        key: m ? m[1] : 'institutions',
        url,
        params: Object.fromEntries(new URL(url).searchParams.entries()),
        status: r.status(),
        body: null,
      };
      this.responses.push(rec);
      this._parses.push(r.json().then((b) => { rec.body = b; }).catch(() => {}));
    });
  }

  mark() { return this.responses.length; }
  async flush() { await Promise.all(this._parses); }
  since(index, key) { return this.responses.slice(index).filter((r) => !key || r.key === key); }
  latest(key) { const l = this.responses.filter((r) => r.key === key); return l.length ? l[l.length - 1] : null; }

  // The API duration the URL asks for. An unrecognised value falls back to Yearly (measured).
  urlDuration() {
    const v = new URL(this.page.url()).searchParams.get('duration');
    const hit = Object.keys(URL_VALUES).find((k) => URL_VALUES[k] === v);
    return hit ? DURATIONS[hit] : 'yearly';
  }

  // The response behind the render: the latest one for the duration the URL holds. A query the
  // app already made is answered from its cache with NO request (choosing Yearly again, Back).
  current(key) {
    const want = this.urlDuration();
    const list = this.responses.filter((r) => r.key === key);
    return list.filter((r) => r.params.duration === want).pop() || list[list.length - 1] || null;
  }

  async settle(index, { timeout = 45000, keys = KEYS } = {}) {
    const deadline = Date.now() + timeout;
    const grace = Date.now() + 3000;
    let missing = keys;
    while (Date.now() < deadline) {
      const want = this.urlDuration();
      missing = keys.filter((k) => !this.responses.some((r) => r.key === k && r.params.duration === want));
      const fresh = keys.every((k) => this.since(index, k).some((r) => r.params.duration === want));
      if (!missing.length && (fresh || Date.now() > grace)) break;
      await this.page.waitForTimeout(250);
    }
    if (missing.length) throw new Error(`no response for duration=${this.urlDuration()} from these widgets: ${missing.join(', ')}`);
    await this.flush();
    await this.page.waitForTimeout(1200); // the cards re-render a tick after the data lands
    return Object.fromEntries(keys.map((k) => [k, this.current(k)]));
  }

  // Waits for any answer from every widget after `index` (used where the URL cannot guide it).
  async waitForWidgets(index, { timeout = 45000 } = {}) {
    const deadline = Date.now() + timeout;
    let missing = KEYS;
    while (Date.now() < deadline) {
      missing = KEYS.filter((k) => !this.since(index, k).length);
      if (!missing.length) break;
      await this.page.waitForTimeout(250);
    }
    if (missing.length) throw new Error(`these Candidates Analytics widgets never answered: ${missing.join(', ')}`);
    await this.flush();
    await this.page.waitForTimeout(1200);
  }

  async open(query = '') {
    const at = this.mark();
    const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
    await this.page.goto(`${ORIGIN}/candidate-analytics${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
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

  async cardText(name) { return clean(await this.card(name).innerText().catch(() => '')); }

  async cardLines(name) {
    return (await this.card(name).innerText().catch(() => '')).split('\n').map(clean).filter(Boolean);
  }

  // Each insight starts with a pointing-hand emoji, which may render on its own line.
  static insights(lines) {
    return clean(lines.join(' ')).split('👉').slice(1).map(clean).filter(Boolean);
  }

  static after(lines, label, offset = 1) {
    const i = lines.indexOf(label);
    return i >= 0 ? lines[i + offset] : null;
  }

  // ------------------------------------------------------------------ duration

  popover() { return this.page.locator('[role="dialog"]').last(); }

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

  async chooseDuration(label, { wait = true } = {}) {
    await this.openDuration();
    const at = this.mark();
    const shown = CandidateAnalyticsPage.buildLabel(label);
    await this.popover().locator('.list-option', { hasText: new RegExp(`^\\s*${shown.replace(/-/g, '\\-')}\\s*$`) }).first().click();
    const out = wait ? await this.settle(at) : null;
    await this.closePopover();
    return out;
  }

  // ------------------------------------------------------------------ university

  async universityOptions() {
    return this.page.locator('[role="listbox"] [role="option"]').allInnerTexts().then((l) => l.map(clean));
  }

  async searchUniversity(term) {
    await this.universityInput.click();
    await this.universityInput.fill('');
    if (term) await this.universityInput.pressSequentially(term, { delay: 20 });
    await this.page.locator('[role="listbox"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
    return this.universityOptions();
  }

  async openUniversityList() {
    await this.universityToggle.click();
    await this.page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(500);
  }

  async closeUniversityList() {
    if (await this.page.locator('[role="listbox"]').isVisible().catch(() => false)) await this.page.keyboard.press('Escape');
  }

  // Picks a university by its exact name; returns the by-university response it produced.
  async chooseUniversity(name) {
    await this.searchUniversity(name);
    const at = this.mark();
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await this.page.locator('[role="listbox"] [role="option"]').filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`) }).first().click();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !this.since(at, 'by-university').length) await this.page.waitForTimeout(250);
    await this.flush();
    await this.page.waitForTimeout(1200);
    const r = this.since(at, 'by-university').pop();
    if (!r) throw new Error(`choosing "${name}" fired no by-university request`);
    return r;
  }

  // ------------------------------------------------------------------ readers

  async readOverview() {
    const l = await this.cardLines('overview');
    const pick = (label) => ({ value: num(CandidateAnalyticsPage.after(l, label)), change: CandidateAnalyticsPage.after(l, label, 2) });
    return {
      lines: l,
      total: pick('Total Candidates'),
      active: pick('Active Candidates'),
      onboarding: pick('Onboarding In Progress'),
      attention: pick('Requires Attention'),
    };
  }

  async readUniversity() {
    const card = this.card('university');
    const l = await this.cardLines('university');
    const rows = await card.locator('tbody tr').evaluateAll((els) => els.map((r) => Array.from(r.querySelectorAll('td,th')).map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
    const headers = await card.locator('thead th').allInnerTexts().then((h) => h.map(clean)).catch(() => []);
    return {
      lines: l,
      text: clean(l.join(' ')),
      total: num(CandidateAnalyticsPage.after(l, 'Total Candidates')),
      headers,
      rows: rows.filter((r) => r.some((c) => c && c !== '-')),
      sectors: await card.locator('.recharts-pie-sector').count(),
      insights: CandidateAnalyticsPage.insights(l),
    };
  }

  async hoverFirstDonutSector() {
    const card = this.card('university');
    await this.page.mouse.move(2, 2);
    // Measured (scripts/probe-superadmin-candidate-analytics-donut.js): each sector raises
    // "<major>: <count>". The card sits low on the page, so it is scrolled into view first - a
    // sector below the fold has no bounding box and cannot be hovered.
    await card.scrollIntoViewIfNeeded();
    const sectors = card.locator('path.recharts-sector');
    const out = [];
    const n = await sectors.count();
    for (let i = 0; i < n; i += 1) {
      await this.page.mouse.move(2, 2);
      // A large arc's bounding-box centre is the donut's HOLE (measured on a 70% sector), so aim
      // between a point on the outer arc (25% along the path) and one on the inner arc (75%).
      const pt = await sectors.nth(i).evaluate((p) => {
        const len = p.getTotalLength();
        const a = p.getPointAtLength(len * 0.25);
        const b = p.getPointAtLength(len * 0.75);
        const m = p.getScreenCTM();
        const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2;
        return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
      }).catch(() => null);
      if (pt) await this.page.mouse.move(pt.x, pt.y, { steps: 3 });
      await this.page.waitForTimeout(500);
      const t = (await this.page.locator('.recharts-tooltip-wrapper').allInnerTexts()).map(clean).filter((x) => /: \d/.test(x));
      out.push(t[0] || '');
    }
    await this.page.mouse.move(2, 2);
    return out;
  }

  async readCity() {
    const card = this.card('city');
    const l = await this.cardLines('city');
    const bars = await card.locator('[aria-hidden="true"]').evaluateAll((els) => els.map((b) => {
      const row = b.closest('div.flex.items-center') || b.parentElement.parentElement;
      const ps = Array.from(row.querySelectorAll('p'));
      const segs = Array.from(b.children).map((s) => parseFloat(s.style.width));
      return { city: ps[0] ? ps[0].innerText.trim() : null, total: ps[ps.length - 1] ? ps[ps.length - 1].innerText.trim() : null, outer: parseFloat(b.style.width), segs };
    }));
    const rows = await card.locator('tbody tr').evaluateAll((els) => els.map((r) => Array.from(r.querySelectorAll('td,th')).map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
    const headers = await card.locator('thead th').allInnerTexts().then((h) => h.map(clean)).catch(() => []);
    return {
      lines: l,
      text: clean(l.join(' ')),
      bars: bars.filter((b) => b.city),
      rows,
      headers,
      openToRelocate: num(CandidateAnalyticsPage.after(l, 'Total Candidates Open to Relocate')),
      insights: CandidateAnalyticsPage.insights(l),
    };
  }

  async readJourney() {
    const l = await this.cardLines('journey');
    const stages = [];
    for (let i = 0; i < l.length - 1; i += 1) {
      if (/^[\d,]+$/.test(l[i + 1]) && !/^[\d,]+$/.test(l[i]) && l[i] !== 'Candidate Journey Funnel') stages.push({ stage: l[i], count: num(l[i + 1]) });
    }
    const placedColor = await this.card('journey').getByText('Placed', { exact: true }).first().evaluate((e) => getComputedStyle(e).color).catch(() => null);
    const signedColor = await this.card('journey').getByText('Signed Up', { exact: true }).first().evaluate((e) => getComputedStyle(e).color).catch(() => null);
    return { lines: l, stages, placedColor, signedColor };
  }

  async readProgress() {
    const card = this.card('progress');
    const l = await this.cardLines('progress');
    const pick = (label) => ({ value: CandidateAnalyticsPage.after(l, label), change: CandidateAnalyticsPage.after(l, label, 2) });
    const ticks = await card.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value, .recharts-cartesian-axis-tick-labels text').allTextContents().catch(() => []);
    return {
      lines: l,
      text: clean(l.join(' ')),
      started: pick('Track Started'),
      completed: pick('Track Completed'),
      rate: pick('Completion Rate'),
      legend: l.filter((x) => /^(Courses?|Tracks?|Certifica)/i.test(x) && !/^Track (Started|Completed)$/.test(x)),
      months: ticks.map(clean).filter((t) => MONTHS.includes(t)),
      curves: await card.locator('path.recharts-curve').count(),
    };
  }

  async readCoop() {
    const card = this.card('coop');
    const l = await this.cardLines('coop');
    const pick = (label) => ({ value: num(CandidateAnalyticsPage.after(l, label)), change: CandidateAnalyticsPage.after(l, label, 2) });
    const ticks = await card.locator('.recharts-cartesian-axis-tick-labels text').allTextContents().catch(() => []);
    return {
      lines: l,
      text: clean(l.join(' ')),
      title: l[0],
      coopStarted: pick('Co-op Started'),
      coopCompleted: pick('Co-op Completed'),
      tamheerStarted: pick('Tamheer Started'),
      tamheerCompleted: pick('Tamheer Completed'),
      bars: await card.locator('.recharts-bar-rectangle').count(),
      months: ticks.map(clean).filter((t) => MONTHS.includes(t)),
      coopChecked: await this.coopTab.getAttribute('aria-checked'),
      tamheerChecked: await this.tamheerTab.getAttribute('aria-checked'),
    };
  }

  // Sweeps the pointer across a card's chart and returns every non-empty tooltip text seen.
  async sweepTooltips(name, { target = '.recharts-surface' } = {}) {
    const card = this.card(name);
    const boxes = await card.locator(target).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const box = boxes.sort((p, q) => q.width * q.height - p.width * p.height)[0];
    if (!box) return [];
    const seen = new Set();
    for (const x of [0.15, 0.35, 0.55, 0.75, 0.9]) {
      for (const y of [0.35, 0.65, 0.9]) {
        await this.page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 });
        await this.page.waitForTimeout(350);
        const t = clean((await this.page.locator('.recharts-tooltip-wrapper, [role="tooltip"]').allInnerTexts()).join(' '));
        if (t) seen.add(t);
      }
    }
    await this.page.mouse.move(2, 2);
    return [...seen];
  }

  // Hovers every drawn bar (height > 0) in a card and returns the tooltip text each produced.
  async barTooltips(name, { max = 8 } = {}) {
    const card = this.card(name);
    const boxes = (await card.locator('.recharts-bar-rectangle path').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))).filter((b) => b.height > 1).slice(0, max);
    const seen = new Set();
    for (const b of boxes) {
      await this.page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 4) + 1, { steps: 3 });
      await this.page.waitForTimeout(400);
      const t = clean((await this.page.locator('.recharts-tooltip-wrapper').allInnerTexts()).join(' '));
      if (t) seen.add(t);
    }
    await this.page.mouse.move(2, 2);
    return [...seen];
  }

  // Help icons are icon-only buttons with no name; their tooltip opens on hover.
  async helpTooltips(name) {
    const card = this.card(name);
    const btns = card.locator('button:not([data-testid])');
    const out = [];
    const n = await btns.count();
    for (let i = 0; i < n; i += 1) {
      const b = btns.nth(i);
      if (clean(await b.innerText().catch(() => ''))) continue;
      await this.page.mouse.move(2, 2);
      await this.page.waitForTimeout(250);
      await b.hover({ force: true }).catch(() => {});
      const tip = this.page.locator('[role="tooltip"]').last();
      await tip.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
      out.push(clean(await tip.innerText().catch(() => '')));
    }
    await this.page.mouse.move(2, 2);
    return out.filter(Boolean);
  }
}

module.exports = CandidateAnalyticsPage;
