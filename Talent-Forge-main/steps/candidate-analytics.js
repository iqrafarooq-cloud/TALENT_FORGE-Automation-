// SuperAdmin Portal > Analytics > Candidates (/candidate-analytics).
// Feature: features/SuperAdmin_Portal/Analytics/Candidate-analytics.feature
// Page object: pages/CandidateAnalyticsPage.js
// Probes: scripts/probe-superadmin-candidate-analytics{,-2,-3,-4}.js (read-only)
//
// EVERY PHRASE NAMES "Candidates Analytics" (or a widget only this page has), so nothing collides
// with the Agents Analytics vocabulary in steps/agent-analytics.js. Reused from elsewhere:
// `Given I am logged in as the superadmin` (steps/invite-agent.js); the access step lives in
// steps/user-management-edges.js beside its siblings, because it needs that file's per-role sign-in.
//
// Every value is compared with the response the app itself received for the request behind the
// render. Multi-case steps collect every problem and throw once.
const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const CandidateAnalyticsPage = require('../pages/CandidateAnalyticsPage');

const { DURATIONS, URL_VALUES, KEYS, MONTHS } = CandidateAnalyticsPage;
const num = CandidateAnalyticsPage.num;
const SLOW = { timeout: 180000 };
const TABLE = { timeout: 420000 };

const cp = (w) => w.pages.candidateAnalytics;
function notes(w) { if (!w._ca) w._ca = {}; return w._ca; }
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// Tooltip copy is compared ignoring case and a trailing full stop; the exact wording is recorded.
const loose = (s) => clean(s).toLowerCase().replace(/[.…]+$/, '');

function fail(problems, headline) {
  if (!problems.length) return;
  throw new Error(`${headline}\n  - ${problems.join('\n  - ')}`);
}
async function record(world, title, payload) {
  await world.attach(`${title}\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`, 'text/plain');
}
async function act(world, fn) {
  const at = cp(world).mark();
  const out = await fn();
  notes(world).lastMark = at;
  return out;
}
const cur = (world, key) => cp(world).current(key);

// Every widget's latest request since the last action carried this duration (or, where the app
// answered from its cache, the response behind the render did).
function requestedWith(world, duration) {
  const a = cp(world);
  const problems = [];
  for (const k of KEYS) {
    const sent = a.since(notes(world).lastMark || 0, k);
    if (sent.some((r) => r.params.duration === duration)) continue;
    const c = a.current(k);
    if (!sent.length && c && c.params.duration === duration) continue;
    problems.push(`${k}: ${sent.length ? `sent ${sent.map((r) => `duration=${r.params.duration}`).join(', ')}` : `sent nothing - the page shows its cached duration=${c ? c.params.duration : '?'} (URL ${cp(world).page.url()})`} - expected duration=${duration}`);
  }
  return problems;
}

// ------------------------------------------------------------------ server vs render, per widget

const STAGES = [
  ['Signed Up', 'signed_up'], ['Profile Completed', 'profile_complete'], ['Track Started', 'track_started'],
  ['Co-op Completed', 'co_op_completed'], ['Tamheer Completed', 'tamheer_completed'],
  ['Track Completed', 'track_completed'], ['Placed', 'placed'],
];

async function compareWidgets(world, label) {
  const a = cp(world);
  const problems = [];
  const ov = await a.readOverview();
  const s = cur(world, 'overview').body;
  [['Total Candidates', ov.total.value, s.total_candidates], ['Active Candidates', ov.active.value, s.active_candidates],
    ['Onboarding In Progress', ov.onboarding.value, s.in_onboarding_process], ['Requires Attention', ov.attention.value, s.requires_attention]]
    .forEach(([n, r, v]) => { if (r !== v) problems.push(`${label}: ${n} reads ${r}, server ${v}`); });

  const j = await a.readJourney();
  const js = cur(world, 'journey').body;
  for (const [stage, key] of STAGES) {
    const row = j.stages.find((x) => x.stage === stage);
    if (!row) problems.push(`${label}: the funnel shows no "${stage}" stage`);
    else if (row.count !== js[key]) problems.push(`${label}: funnel ${stage} reads ${row.count}, server ${js[key]}`);
  }

  const p = await a.readProgress();
  const ps = cur(world, 'progress').body;
  if (num(p.started.value) !== ps.track_started) problems.push(`${label}: Track Started reads ${p.started.value}, server ${ps.track_started}`);
  if (num(p.completed.value) !== ps.track_completed) problems.push(`${label}: Track Completed reads ${p.completed.value}, server ${ps.track_completed}`);
  if (num(p.rate.value) !== ps.completion_rate) problems.push(`${label}: Completion Rate reads ${p.rate.value}, server ${ps.completion_rate}`);

  const c = await a.readCoop();
  const cs = cur(world, 'coop-tamheer').body;
  [['Co-op Started', c.coopStarted.value, cs.co_op_started], ['Co-op Completed', c.coopCompleted.value, cs.co_op_completed],
    ['Tamheer Started', c.tamheerStarted.value, cs.tamheer_started], ['Tamheer Completed', c.tamheerCompleted.value, cs.tamheer_completed]]
    .forEach(([n, r, v]) => { if (r !== v) problems.push(`${label}: ${n} reads ${r}, server ${v}`); });

  const city = await a.readCity();
  const bs = cur(world, 'by-city').body;
  const want = (bs.city_breakdown || []).filter((x) => x.total_candidates > 0).slice(0, 5);
  const got = city.bars.map((b) => `${b.city} ${num(b.total)}`);
  const exp = want.map((x) => `${x.city_name} ${x.total_candidates}`);
  if (JSON.stringify(got) !== JSON.stringify(exp) && !(exp.length === 0 && got.length === 0)) problems.push(`${label}: city bars ${JSON.stringify(got)}, server ${JSON.stringify(exp)}`);
  return problems;
}

// ------------------------------------------------------------------ subjects (cached per worker)

const uniCache = {};
async function findUniversity(world, { empty }) {
  const a = cp(world);
  const duration = a.urlDuration();
  const key = `${duration}|${empty ? 'empty' : 'full'}`;
  if (uniCache[key]) return uniCache[key];
  const inst = (await a.api('/institutions/?page=1&page_size=500')).body.results;
  for (const u of inst) {
    const r = await a.api(`/analytics/candidates/by-university/?duration=${duration}&university=${u.id}`);
    const b = r.body || {};
    if (empty ? b.total_candidates === 0 : (b.major_breakdown || []).length >= 2) {
      uniCache[key] = { id: u.id, name: u.name };
      return uniCache[key];
    }
  }
  throw new Error(`no university ${empty ? 'without' : 'with at least two majors of'} candidates for duration=${duration}`);
}

// ================================================================== background / navigation

Given('I have opened the Candidates Analytics dashboard', SLOW, async function () {
  notes(this).lastMark = 0;
  await cp(this).open();
});

When('I open the Candidates Analytics dashboard at {string}', SLOW, async function (query) {
  const a = cp(this);
  await act(this, async () => {
    const at = a.mark();
    await this.page.goto(`${new URL(this.page.url()).origin}/candidate-analytics${query}`, { waitUntil: 'domcontentloaded' });
    await a.durationTrigger.waitFor({ state: 'visible', timeout: 45000 });
    await a.waitForWidgets(at);
  });
});

When('I reload the Candidates Analytics dashboard', SLOW, async function () {
  await act(this, () => cp(this).reload());
});

When('I choose the {string} Candidates Analytics duration', SLOW, async function (d) {
  await act(this, () => cp(this).chooseDuration(d));
});

When('I open the {string} Analytics tab from the sidebar', SLOW, async function (tab) {
  const a = cp(this);
  const link = this.page.locator(`[data-testid="admin-nav-analytics-${tab.toLowerCase()}-link"]`);
  if (!(await link.isVisible().catch(() => false))) await this.page.locator('[data-testid="admin-nav-analytics-menu"]').click();
  await act(this, async () => {
    const at = a.mark();
    await link.click();
    const route = { agents: /\/agents-analytics/, candidates: /\/candidate-analytics/, platform: /\/platform-analytics/ }[tab.toLowerCase()];
    await this.page.waitForURL(route, { timeout: 30000 });
    if (/candidates/i.test(tab)) {
      await a.durationTrigger.waitFor({ state: 'visible', timeout: 45000 });
      await a.waitForWidgets(at).catch(() => {}); // a cached query fires nothing - requestedWith() reads current() then
      await this.page.waitForTimeout(1500);
    } else {
      await this.page.waitForTimeout(2500);
    }
  });
});

// ================================================================== structure

Then('the Candidates Analytics dashboard should offer the Duration filter and the University dropdown', async function () {
  const a = cp(this);
  await expect(a.durationTrigger).toBeVisible();
  await expect(a.universityInput).toBeVisible();
  expect(await a.universityInput.getAttribute('role')).toBe('combobox');
  expect(clean(await a.card('university').innerText())).toContain('Select a University');
});

Then('the Candidates Analytics dashboard should show these widgets:', async function (table) {
  const missing = [];
  for (const { widget } of table.hashes()) {
    const visible = await this.page.locator('main section').filter({ hasText: widget }).first().isVisible().catch(() => false);
    if (!visible) missing.push(widget);
  }
  fail(missing, 'These Candidates Analytics widgets are not on the page:');
});

Then('the Co-op and Tamheer widget should be titled {string}', async function (title) {
  const c = await cp(this).readCoop();
  expect(c.title, 'the Co-op and Tamheer widget title').toBe(title);
});

// ================================================================== duration

Then('the Candidates Analytics Duration filter should offer exactly:', async function (table) {
  const opts = await cp(this).durationOptions();
  expect(opts.map((o) => o.label)).toEqual(table.hashes().map((r) => r.duration));
});

Then('only {string} should be marked as the chosen Candidates Analytics duration', async function (d) {
  const opts = await cp(this).durationOptions();
  const chosen = opts.filter((o) => o.checked).map((o) => o.label);
  expect(chosen, `options marked as chosen (all: ${JSON.stringify(opts)})`).toEqual([CandidateAnalyticsPage.buildLabel(d)]);
});

Then('every Candidates Analytics widget should have been requested with duration {string}', async function (v) {
  fail(requestedWith(this, v), `Not every Candidates Analytics widget was requested with duration=${v}:`);
});

Then('the Candidates Analytics URL should hold {string}', async function (fragment) {
  const [k, v] = fragment.split('=');
  expect(new URL(this.page.url()).searchParams.get(k), `the URL ${this.page.url()}`).toBe(v);
});

Then('choosing each Candidates Analytics duration should query every widget with its own value:', TABLE, async function (table) {
  const problems = [];
  for (const row of table.hashes()) {
    await act(this, () => cp(this).chooseDuration(row.duration));
    const inUrl = new URL(this.page.url()).searchParams.get('duration');
    const want = row['url value'] || null;
    if (inUrl !== want) problems.push(`${row.duration}: the URL holds duration=${inUrl}, expected ${want === null ? 'no duration' : want}`);
    problems.push(...requestedWith(this, row['api value']).map((p) => `${row.duration}: ${p}`));
  }
  fail(problems, 'A duration did not reach every widget:');
});

Then('for each Candidates Analytics duration every widget should render the server\'s figures:', TABLE, async function (table) {
  const problems = [];
  for (const { duration } of table.hashes()) {
    await act(this, () => cp(this).chooseDuration(duration));
    problems.push(...(await compareWidgets(this, duration)));
  }
  fail(problems, 'A widget does not render what the server returned:');
});

Then('every widget should render the server\'s figures for the current Candidates Analytics duration', SLOW, async function () {
  fail(await compareWidgets(this, cp(this).urlDuration()), 'A widget does not render what the server returned:');
});

Then('each Candidates Analytics comparison line should name its period:', TABLE, async function (table) {
  const problems = [];
  const seen = {};
  for (const row of table.hashes()) {
    await act(this, () => cp(this).chooseDuration(row.duration));
    const text = [await cp(this).cardText('overview'), await cp(this).cardText('progress'), await cp(this).cardText('coop')].join(' ');
    const found = [...text.matchAll(/vs ((?:same period )?last (?:month|quarter|year))/g)].map((m) => `vs ${m[1]}`);
    seen[row.duration] = [...new Set(found)];
    if (!found.length) problems.push(`${row.duration}: no comparison line was found`);
    const wrong = [...new Set(found.filter((f) => f !== row.comparison))];
    if (wrong.length) problems.push(`${row.duration}: reads ${wrong.join(', ')} - expected "${row.comparison}"`);
  }
  await record(this, 'Comparison lines per duration', seen);
  fail(problems, 'A comparison line names the wrong period:');
});

function expectedMonths(spec) {
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const back = (n) => Array.from({ length: n }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)));
  if (/current month$/.test(spec) && !/January/.test(spec) && !/last/.test(spec)) return back(1);
  if (/January/.test(spec)) return back(now.getMonth() + 1);
  const n = Number((spec.match(/last (\d+) months/) || [])[1]);
  if (n) return back(n);
  throw new Error(`unknown month range "${spec}"`);
}

Then('the Candidates Analytics trends should cover these months:', TABLE, async function (table) {
  const problems = [];
  const seen = [];
  for (const row of table.hashes()) {
    await act(this, () => cp(this).chooseDuration(row.duration));
    const want = expectedMonths(row.months);
    const prog = (cur(this, 'progress').body.learning_activity_trend || []).map((t) => t.month);
    const coop = ((cur(this, 'coop-tamheer').body.trend || {}).co_op_trend || []).map((t) => t.month);
    seen.push({ duration: row.duration, expected: want, progress: prog, coop });
    if (JSON.stringify(prog) !== JSON.stringify(want)) problems.push(`${row.duration}: the Learning Activity Trend covers ${prog.join(', ') || '(nothing)'} - expected ${want.join(', ')}`);
    if (JSON.stringify(coop) !== JSON.stringify(want)) problems.push(`${row.duration}: the Co-op trend covers ${coop.join(', ') || '(nothing)'} - expected ${want.join(', ')}`);
  }
  await record(this, 'Months per duration', seen);
  fail(problems, 'A trend does not cover the months its duration names:');
});

When('I choose {string} and then {string} Candidates Analytics durations in quick succession', SLOW, async function (first, second) {
  const a = cp(this);
  await act(this, async () => {
    const at = a.mark();
    await a.openDuration();
    for (const d of [first, second]) {
      if (!(await a.popover().isVisible().catch(() => false))) await a.openDuration();
      const shown = CandidateAnalyticsPage.buildLabel(d);
      await a.popover().locator('.list-option', { hasText: new RegExp(`^\\s*${shown.replace(/-/g, '\\-')}\\s*$`) }).first().click();
    }
    const out = await a.settle(at);
    await a.closePopover();
    return out;
  });
});

Then('every Candidates Analytics widget should render the Year-to-Date figures', SLOW, async function () {
  expect(cp(this).urlDuration(), `the URL ${this.page.url()}`).toBe('ytd');
  // Wait out any late answer to the first choice, then make sure the render is still Year-to-Date's.
  await this.page.waitForTimeout(3000);
  fail(await compareWidgets(this, 'Year-to-Date'), 'After a quick switch a widget does not show the Year-to-Date figures:');
});

Then('the Candidates Analytics Duration popover should close without changing anything by each of these routes:', SLOW, async function (table) {
  const a = cp(this);
  const problems = [];
  for (const { route } of table.hashes()) {
    const url = this.page.url();
    await a.openDuration();
    const before = a.mark();
    if (/escape/i.test(route)) await this.page.keyboard.press('Escape'); else await this.page.mouse.click(5, 5);
    let open = true;
    for (let i = 0; i < 8 && open; i += 1) { await this.page.waitForTimeout(250); open = await a.popover().isVisible().catch(() => false); }
    await this.page.waitForTimeout(1000);
    if (open) problems.push(`${route}: the popover is still open`);
    if (this.page.url() !== url) problems.push(`${route}: the URL changed to ${this.page.url()}`);
    if (a.mark() !== before) problems.push(`${route}: ${a.mark() - before} widget request(s) were sent`);
    await a.closePopover();
  }
  fail(problems, 'Dismissing the Duration popover changed something:');
});

// ================================================================== overview

Then('Active Candidates plus Onboarding In Progress should equal Total Candidates for every duration', TABLE, async function () {
  const problems = [];
  const seen = [];
  for (const d of ['Monthly', 'Quarterly', 'Year-to-Date', 'Yearly']) {
    await act(this, () => cp(this).chooseDuration(d));
    const s = cur(this, 'overview').body;
    seen.push({ duration: d, total: s.total_candidates, active: s.active_candidates, onboarding: s.in_onboarding_process, attention: s.requires_attention });
    if (s.active_candidates + s.in_onboarding_process !== s.total_candidates) problems.push(`${d}: Active ${s.active_candidates} + Onboarding ${s.in_onboarding_process} = ${s.active_candidates + s.in_onboarding_process}, Total ${s.total_candidates}`);
    if (s.requires_attention > s.total_candidates) problems.push(`${d}: Requires Attention ${s.requires_attention} exceeds Total ${s.total_candidates}`);
  }
  notes(this).overviewSeen = seen;
  await record(this, 'Candidate Overview per duration', seen);
  fail(problems, 'The Candidate Overview figures do not add up:');
});

Then('Requires Attention should never exceed Total Candidates', async function () {
  const bad = (notes(this).overviewSeen || []).filter((s) => s.attention > s.total);
  expect(bad).toEqual([]);
});

Then('Active Candidates plus Onboarding In Progress should equal Total Candidates', async function () {
  const ov = await cp(this).readOverview();
  expect(ov.active.value + ov.onboarding.value, `Active ${ov.active.value} + Onboarding ${ov.onboarding.value}`).toBe(ov.total.value);
});

// ================================================================== university

function configuredUniversities(world) {
  const r = cp(world).responses.filter((x) => x.key === 'institutions' && x.params.page_size === '500').pop();
  if (!r || !r.body) throw new Error('the University dropdown\'s institutions list was never fetched');
  return r.body.results;
}

When('I open the Candidates Analytics University dropdown', SLOW, async function () {
  await cp(this).openUniversityList();
});

Then('the University dropdown should list exactly the universities the server configured', async function () {
  const inst = configuredUniversities(this);
  const opts = await cp(this).universityOptions();
  await cp(this).closeUniversityList();
  const want = inst.map((u) => clean(u.name));
  const missing = want.filter((n) => !opts.includes(n));
  const extra = opts.filter((n) => !want.includes(n));
  await record(this, 'University options', { offered: opts.length, configured: want.length, inactiveConfigured: inst.filter((u) => u.is_active === false).map((u) => u.name) });
  fail([...missing.map((n) => `not offered: ${n}`), ...extra.map((n) => `offered but not configured: ${n}`)], 'The University dropdown does not list the configured universities:');
  expect(opts.length).toBe(want.length);
});

When('I search the Candidates Analytics universities for {string}', SLOW, async function (term) {
  notes(this).searchResult = await cp(this).searchUniversity(term);
});

Then('every Candidates Analytics university offered should contain {string}', async function (term) {
  const opts = notes(this).searchResult;
  expect(opts.length, 'the search offered nothing').toBeGreaterThan(0);
  const stray = opts.filter((o) => !o.toLowerCase().includes(term.toLowerCase()));
  expect(stray, `options not containing "${term}"`).toEqual([]);
});

Then('the University dropdown should say {string}', async function (text) {
  expect(notes(this).searchResult).toEqual([text]);
});

Then('the University dropdown should offer every configured university', async function () {
  expect(notes(this).searchResult.length).toBe(configuredUniversities(this).length);
  await cp(this).closeUniversityList();
});

When('I choose a Candidates Analytics university that has candidates', SLOW, async function () {
  const u = await findUniversity(this, { empty: false });
  const r = await cp(this).chooseUniversity(u.name);
  notes(this).university = { ...u, response: r };
  await record(this, 'University chosen', { ...u, total: r.body && r.body.total_candidates });
});

When('I choose a Candidates Analytics university that has no candidates', SLOW, async function () {
  const u = await findUniversity(this, { empty: true });
  const r = await cp(this).chooseUniversity(u.name);
  notes(this).university = { ...u, response: r };
  await record(this, 'University chosen', u);
});

function latestUniversityResponse(world) {
  const id = String(notes(world).university.id);
  return cp(world).responses.filter((r) => r.key === 'by-university' && r.params.university === id).pop();
}

Then('the university widget should have been requested for that university with duration {string}', SLOW, async function (v) {
  const a = cp(this);
  const id = String(notes(this).university.id);
  const deadline = Date.now() + 20000;
  let hit;
  while (Date.now() < deadline) {
    hit = a.responses.filter((r) => r.key === 'by-university' && r.params.university === id && r.params.duration === v).pop();
    if (hit) break;
    await this.page.waitForTimeout(300);
  }
  await a.flush();
  const sent = a.responses.filter((r) => r.key === 'by-university').map((r) => `${r.params.university}/${r.params.duration}`);
  expect(hit, `no by-university request for university=${id} duration=${v}; sent: ${sent.join(', ')}`).toBeTruthy();
});

Then('the university widget should show the server\'s total candidates', async function () {
  await this.page.waitForTimeout(800);
  const s = latestUniversityResponse(this).body;
  const u = await cp(this).readUniversity();
  expect(u.total, `the widget for ${notes(this).university.name}`).toBe(s.total_candidates);
});

Then('the majors table should have the columns:', async function (table) {
  const u = await cp(this).readUniversity();
  expect(u.headers).toEqual(table.hashes().map((r) => r.column));
});

Then('the majors table should list every major the server returned, most candidates first', async function () {
  const s = latestUniversityResponse(this).body.major_breakdown;
  const u = await cp(this).readUniversity();
  const got = u.rows.map((r) => `${r[0]} | ${r[1]} | ${r[2]}`);
  const want = s.map((m) => `${m.major} | ${m.count} | ${m.track_completion_rate}%`);
  expect(got).toEqual(want);
  const counts = s.map((m) => m.count);
  expect(counts, 'the majors are not sorted by candidate count, most first').toEqual([...counts].sort((x, y) => y - x));
});

Then('the donut should have one sector per major and show the exact count on hover', SLOW, async function () {
  const s = latestUniversityResponse(this).body.major_breakdown;
  const u = await cp(this).readUniversity();
  // Recharts draws each sector as a path inside .recharts-pie-sector, so count the groups.
  const sectors = await cp(this).card('university').locator('.recharts-pie-sector').count();
  expect(sectors, `donut sectors for ${s.length} majors (readUniversity saw ${u.sectors})`).toBeGreaterThanOrEqual(s.length);
  const tips = await cp(this).hoverFirstDonutSector();
  await record(this, 'Donut tooltips, one per sector', tips);
  const want = s.map((m) => `${m.major}: ${m.count}`);
  expect(tips, 'one tooltip per sector, each "<major>: <count>" in the server\'s order').toEqual(want);
});

Then('the first university insight should name the two majors with the most candidates', async function () {
  const s = latestUniversityResponse(this).body.major_breakdown;
  const u = await cp(this).readUniversity();
  await record(this, 'University insights', { insights: u.insights, majors: s });
  const first = u.insights[0] || '';
  const missing = s.slice(0, 2).map((m) => m.major).filter((m) => !first.includes(m));
  expect(missing, `insight 1 reads "${first}" and does not name`).toEqual([]);
});

Then('the second university insight should name the major with the highest completion rate', async function () {
  const s = latestUniversityResponse(this).body.major_breakdown;
  const u = await cp(this).readUniversity();
  const top = Math.max(...s.map((m) => m.track_completion_rate));
  const best = s.filter((m) => m.track_completion_rate === top).map((m) => m.major);
  const second = u.insights[1] || '';
  expect(best.some((m) => second.includes(m)), `insight 2 reads "${second}"; the highest completion rate (${top}%) belongs to ${best.join(' / ')}`).toBe(true);
});

Then('the university widget should say {string}', async function (text) {
  const u = await cp(this).readUniversity();
  expect(u.text, `the widget for ${notes(this).university.name} (server: ${JSON.stringify(latestUniversityResponse(this).body)})`).toContain(text);
});

Then('no Candidates Analytics university should be chosen', async function () {
  expect(await cp(this).universityInput.inputValue()).toBe('');
  expect((await cp(this).readUniversity()).text).toContain('Select a University');
});

// ================================================================== city

Then('the city chart should list at most 5 cities, none with zero candidates, as the server returned them', async function () {
  const c = await cp(this).readCity();
  const s = cur(this, 'by-city').body.city_breakdown || [];
  expect(c.bars.length).toBeLessThanOrEqual(5);
  expect(c.bars.filter((b) => num(b.total) === 0).map((b) => b.city), 'cities with zero candidates').toEqual([]);
  expect(c.bars.map((b) => `${b.city} ${num(b.total)}`)).toEqual(s.filter((x) => x.total_candidates > 0).slice(0, 5).map((x) => `${x.city_name} ${x.total_candidates}`));
  await record(this, 'City bars', c.bars);
});

Then('each city bar should be split by its share of candidates open to relocate', async function () {
  const c = await cp(this).readCity();
  const s = cur(this, 'by-city').body.city_breakdown;
  const max = Math.max(...s.map((x) => x.total_candidates));
  const problems = [];
  for (const b of c.bars) {
    const x = s.find((y) => y.city_name === b.city);
    const share = (x.open_to_relocate / x.total_candidates) * 100;
    const length = (x.total_candidates / max) * 100;
    if (Math.abs(b.segs[0] - share) > 1.5) problems.push(`${b.city}: open-to-relocate segment is ${b.segs[0]}% of the bar, ${x.open_to_relocate}/${x.total_candidates} = ${share.toFixed(1)}%`);
    if (Math.abs(b.outer - length) > 1.5) problems.push(`${b.city}: the bar is ${b.outer}% long, ${x.total_candidates}/${max} = ${length.toFixed(1)}%`);
  }
  fail(problems, 'A city bar is not drawn to its figures:');
});

Then('Total Candidates Open to Relocate should equal the open-to-relocate candidates of the listed cities', async function () {
  const c = await cp(this).readCity();
  const s = cur(this, 'by-city').body.city_breakdown;
  expect(c.openToRelocate).toBe(s.reduce((sum, x) => sum + x.open_to_relocate, 0));
});

Then('the relocation table should list each city with its open-to-relocate count and top destination as the server returned them', async function () {
  const c = await cp(this).readCity();
  const s = cur(this, 'by-city').body;
  const want = s.relocation_insights.map((r) => {
    const b = s.city_breakdown.find((x) => x.city_name === r.city_name) || {};
    return `${r.city_name} | ${b.open_to_relocate} | ${r.top_destination ? r.top_destination.location_name : '-'}`;
  });
  expect(c.rows.map((r) => r.join(' | '))).toEqual(want);
  await record(this, 'Relocation table headers (City / Open to Relocate / Top Destination)', c.headers);
});

Then('the first city insight should name the two cities with the most candidates', async function () {
  const c = await cp(this).readCity();
  const top = [...cur(this, 'by-city').body.city_breakdown].sort((x, y) => y.total_candidates - x.total_candidates).slice(0, 2).map((x) => x.city_name);
  await record(this, 'City insights', { insights: c.insights, topCities: top });
  const first = c.insights[0] || '';
  expect(top.filter((t) => !first.includes(t)), `insight 1 reads "${first}" and does not name`).toEqual([]);
});

Then('the second city insight should name the most selected destination city', async function () {
  const c = await cp(this).readCity();
  const totals = {};
  for (const r of cur(this, 'by-city').body.relocation_insights) {
    if (r.top_destination) totals[r.top_destination.location_name] = (totals[r.top_destination.location_name] || 0) + r.top_destination.candidate_count;
  }
  const top = Object.entries(totals).sort((x, y) => y[1] - x[1])[0];
  const second = c.insights[1] || '';
  expect(second, `destinations chosen: ${JSON.stringify(totals)}`).toContain(top[0]);
});

Then('hovering a city bar should show its total and open-to-relocate counts', async function () {
  const a = cp(this);
  const c = await a.readCity();
  const s = cur(this, 'by-city').body.city_breakdown;
  const bar = a.card('city').locator('[aria-hidden="true"]').first();
  const box = await bar.boundingBox();
  await this.page.mouse.move(2, 2);
  await this.page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 4 });
  await this.page.waitForTimeout(800);
  const tip = clean((await this.page.locator('[role="tooltip"], .recharts-tooltip-wrapper, [class*="tooltip"]').allInnerTexts()).join(' '));
  const x = s.find((y) => y.city_name === c.bars[0].city);
  expect(tip.includes(String(x.total_candidates)) && tip.includes(String(x.open_to_relocate)), `hovering ${x.city_name} showed "${tip}", expected ${x.total_candidates} and ${x.open_to_relocate}`).toBe(true);
});

// ================================================================== journey funnel

Then('every Candidate Journey Funnel stage should show the server\'s count', async function () {
  const j = await cp(this).readJourney();
  const s = cur(this, 'journey').body;
  const problems = [];
  for (const [stage, key] of STAGES) {
    const row = j.stages.find((x) => x.stage === stage);
    if (!row) problems.push(`no "${stage}" stage (rendered: ${j.stages.map((x) => x.stage).join(', ')})`);
    else if (row.count !== s[key]) problems.push(`${stage} reads ${row.count}, server ${s[key]}`);
  }
  fail(problems, 'A funnel stage does not show the server\'s count:');
});

Then('the Placed stage should be greyed out, read 0 and explain {string}', async function (text) {
  const a = cp(this);
  const j = await a.readJourney();
  expect(j.stages.find((x) => x.stage === 'Placed').count).toBe(0);
  expect(j.placedColor, 'Placed should be drawn in a different (greyed) colour from the live stages').not.toBe(j.signedColor);
  const tips = await a.helpTooltips('journey');
  await record(this, 'Funnel tooltips', tips);
  expect(tips.some((t) => loose(t) === loose(text)), `funnel tooltips ${JSON.stringify(tips)} should include "${text}"`).toBe(true);
});

Then('the Candidate Journey Funnel help icon should explain {string}', async function (text) {
  const tips = await cp(this).helpTooltips('journey');
  expect(tips.some((t) => loose(t) === loose(text)), `funnel tooltips ${JSON.stringify(tips)}`).toBe(true);
});

Then('the Candidate Journey Funnel stages should be in this order:', async function (table) {
  const j = await cp(this).readJourney();
  await record(this, 'Funnel stages as rendered', j.stages);
  expect(j.stages.map((x) => x.stage)).toEqual(table.hashes().map((r) => r.stage));
});

// ================================================================== progress

Then('the progress figures should be the server\'s for every duration', TABLE, async function () {
  const problems = [];
  for (const d of ['Monthly', 'Quarterly', 'Year-to-Date', 'Yearly']) {
    await act(this, () => cp(this).chooseDuration(d));
    const p = await cp(this).readProgress();
    const s = cur(this, 'progress').body;
    if (num(p.started.value) !== s.track_started) problems.push(`${d}: Track Started ${p.started.value} vs server ${s.track_started}`);
    if (num(p.completed.value) !== s.track_completed) problems.push(`${d}: Track Completed ${p.completed.value} vs server ${s.track_completed}`);
    if (num(p.rate.value) !== s.completion_rate || !/%$/.test(clean(p.rate.value))) problems.push(`${d}: Completion Rate "${p.rate.value}" vs server ${s.completion_rate}%`);
    const formula = s.track_started ? Math.round((s.track_completed / s.track_started) * 1000) / 10 : 0;
    if (Math.abs(s.completion_rate - formula) > 0.05) problems.push(`${d}: Completion Rate ${s.completion_rate}% is not ${s.track_completed} / ${s.track_started} x 100 = ${formula}%`);
  }
  fail(problems, 'A progress figure is wrong:');
});

Then('the Completion Rate should be Track Completed divided by Track Started times 100', async function () {
  const p = await cp(this).readProgress();
  const started = num(p.started.value);
  const completed = num(p.completed.value);
  const want = started ? Math.round((completed / started) * 1000) / 10 : 0;
  expect(num(p.rate.value), `${completed} / ${started} x 100`).toBeCloseTo(want, 1);
});

Then('the Candidate Progress help icon should explain {string}', async function (text) {
  const tips = await cp(this).helpTooltips('progress');
  await record(this, 'Progress tooltip (compared ignoring case and the trailing full stop)', tips);
  expect(tips.some((t) => loose(t) === loose(text)), `progress tooltips ${JSON.stringify(tips)}`).toBe(true);
});

function trendLegend(lines) {
  const i = lines.indexOf('Learning Activity Trend');
  const out = [];
  for (const l of lines.slice(i + 1)) { if (MONTHS.includes(l) || /^"/.test(l) || /^\d/.test(l)) break; out.push(l); }
  return out;
}
function trendMonths(lines, after) {
  const i = lines.indexOf(after);
  return lines.slice(i + 1).filter((l) => MONTHS.includes(l));
}

Then('the Learning Activity Trend should plot one point per month the server returned', async function () {
  const p = await cp(this).readProgress();
  const s = cur(this, 'progress').body.learning_activity_trend;
  const want = s.map((t) => MONTHS[Number(t.month.split('-')[1]) - 1]);
  expect(trendMonths(p.lines, 'Learning Activity Trend')).toEqual(want);
});

Then('the Learning Activity Trend legend should read:', async function (table) {
  const p = await cp(this).readProgress();
  expect(trendLegend(p.lines)).toEqual(table.hashes().map((r) => r.legend));
});

Then('hovering the Learning Activity Trend should show the exact values for a month', SLOW, async function () {
  const tips = await cp(this).sweepTooltips('progress');
  expect(tips.filter((t) => /\d/.test(t)), 'tooltips seen while sweeping the chart (the Co-op chart on the same page does show its values)').not.toEqual([]);
});

// ================================================================== co-op & tamheer

Then('the Co-op tab should be chosen by default', async function () {
  const c = await cp(this).readCoop();
  expect([c.coopChecked, c.tamheerChecked]).toEqual(['true', 'false']);
});

Then('the Co-op and Tamheer figures should be the server\'s', async function () {
  const c = await cp(this).readCoop();
  const s = cur(this, 'coop-tamheer').body;
  expect([c.coopStarted.value, c.coopCompleted.value, c.tamheerStarted.value, c.tamheerCompleted.value])
    .toEqual([s.co_op_started, s.co_op_completed, s.tamheer_started, s.tamheer_completed]);
});

Then('the Co-op and Tamheer help icon should explain {string}', async function (text) {
  const tips = await cp(this).helpTooltips('coop');
  expect(tips.some((t) => loose(t) === loose(text)), `Co-op and Tamheer tooltips ${JSON.stringify(tips)}`).toBe(true);
});

async function hoverProgramChart(world, which) {
  const trend = (cur(world, 'coop-tamheer').body.trend || {})[which === 'Tamheer' ? 'tamheer_trend' : 'co_op_trend'] || [];
  const tips = await cp(world).barTooltips('coop');
  const problems = [];
  // Counts carry thousands separators ("1,080").
  const parsed = tips.map((t) => t.replace(/(\d),(\d)/g, '$1$2').match(/^([A-Z][a-z]+ \d{4}) Started: (\d+) Completed: (\d+)/)).filter(Boolean);
  if (!parsed.length) problems.push(`no "<Month Year> Started: n Completed: n" tooltip appeared (seen: ${JSON.stringify(tips)})`);
  for (const [, month, started, completed] of parsed) {
    const m = trend.find((t) => t.month_name === month);
    if (!m) problems.push(`${month}: not a month the server returned for ${which}`);
    else if (m.started !== Number(started) || m.completed !== Number(completed)) problems.push(`${month}: tooltip Started ${started} / Completed ${completed}, server ${m.started} / ${m.completed}`);
  }
  await record(world, `${which} chart tooltips`, tips);
  fail(problems, `The ${which} chart tooltip does not show the server's counts:`);
}

Then('hovering the Co-op chart should show a month\'s started and completed counts as the server returned them', SLOW, async function () {
  await hoverProgramChart(this, 'Co-op');
});

Then('hovering the Tamheer chart should show a month\'s started and completed counts as the server returned them', SLOW, async function () {
  await hoverProgramChart(this, 'Tamheer');
});

When('I open the Tamheer tab of the Co-op and Tamheer widget', async function () {
  notes(this).tabMark = cp(this).mark();
  await cp(this).tamheerTab.click();
  await this.page.waitForTimeout(1500);
});

When('I open the Tamheer tab of the Co-op and Tamheer widget with the keyboard', async function () {
  notes(this).tabMark = cp(this).mark();
  await cp(this).coopTab.focus();
  await this.page.keyboard.press('ArrowRight');
  await this.page.waitForTimeout(400);
  if ((await cp(this).tamheerTab.getAttribute('aria-checked')) !== 'true') {
    // a radiogroup selects on arrow; if this one only moves focus, Space selects
    await this.page.keyboard.press('Space');
  }
  await this.page.waitForTimeout(1500);
});

Then('the Tamheer tab should be chosen and no Candidates Analytics request should have been sent', async function () {
  const c = await cp(this).readCoop();
  expect([c.coopChecked, c.tamheerChecked]).toEqual(['false', 'true']);
  expect(cp(this).since(notes(this).tabMark).filter((r) => r.key !== 'institutions').map((r) => r.url)).toEqual([]);
});

// ================================================================== empty and failed states

const EMPTY = {
  overview: { total_candidates: 0, total_candidates_change_percent: 0, active_candidates: 0, active_candidates_change: 0, in_onboarding_process: 0, in_onboarding_process_change: 0, requires_attention: 0, requires_attention_change: 0 },
  'by-city': { total_candidates: 0, city_breakdown: [], relocation_insights: [] },
  'by-university': { total_candidates: 0, total_candidates_change_percent: 0, major_breakdown: [] },
  journey: { signed_up: 0, profile_complete: 0, track_started: 0, co_op_completed: 0, tamheer_completed: 0, track_completed: 0, placed: 0 },
  progress: { track_started: 0, track_started_change: 0, track_completed: 0, track_completed_change: 0, completion_rate: 0, completion_rate_change: 0, learning_activity_trend: [] },
  'coop-tamheer': { co_op_started: 0, co_op_started_change: 0, co_op_completed: 0, co_op_completed_change: 0, tamheer_started: 0, tamheer_started_change: 0, tamheer_completed: 0, tamheer_completed_change: 0, trend: { co_op_trend: [], tamheer_trend: [] } },
};
const STUB = /\/api\/v1\/analytics\/candidates\/(overview|by-city|by-university|journey|progress|coop-tamheer)\//;

Given('the Candidates Analytics widgets will return no data', async function () {
  await this.page.route(STUB, (route) => {
    const key = route.request().url().match(STUB)[1];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY[key]) });
  });
});

Given('the Candidates Analytics widgets will fail with a server error', async function () {
  await this.page.route(STUB, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"A server error occurred."}' }));
});

Then('every Candidate Overview metric should read 0', async function () {
  const ov = await cp(this).readOverview();
  expect([ov.total.value, ov.active.value, ov.onboarding.value, ov.attention.value]).toEqual([0, 0, 0, 0]);
});

Then('every Candidate Journey Funnel stage should read 0', async function () {
  const j = await cp(this).readJourney();
  expect(j.stages.length).toBe(7);
  expect(j.stages.filter((x) => x.count !== 0)).toEqual([]);
});

const EMPTY_CARD = { 'Candidates by City': 'city', 'Candidate Progress': 'progress', 'Co-op & Tamheer': 'coop' };

Then('the Candidates Analytics widgets should show these empty states:', async function (table) {
  const problems = [];
  for (const { widget, text } of table.hashes()) {
    const got = await cp(this).cardText(EMPTY_CARD[widget]);
    if (!got.includes(text)) problems.push(`${widget}: reads "${got.slice(0, 200)}"`);
  }
  fail(problems, 'A widget does not show its empty state:');
});

Then('no Candidates Analytics empty-state message should be wrapped in quotation marks', async function () {
  const quoted = [];
  for (const k of Object.values(EMPTY_CARD)) {
    const t = await cp(this).cardText(k);
    const m = t.match(/["“][^"”]*(No data|No candidate)[^"”]*["”]/);
    if (m) quoted.push(m[0]);
  }
  expect(quoted, 'empty-state messages rendered inside quotation marks').toEqual([]);
});

Then('the Candidates Analytics dashboard should say the data could not be loaded', async function () {
  const texts = {};
  for (const k of ['overview', 'university', 'city', 'journey', 'progress', 'coop']) texts[k] = await cp(this).cardText(k);
  const toast = clean(await this.page.locator('.Toastify').innerText().catch(() => ''));
  await record(this, 'Dashboard after every widget answered 500', { toast, texts });
  const all = `${Object.values(texts).join(' ')} ${toast}`;
  expect(/could not|couldn't|unable to|failed|went wrong|try again|error/i.test(all),
    'with every widget failing (HTTP 500) the dashboard should say the data could not be loaded; it shows zeros and the empty states instead').toBe(true);
});
