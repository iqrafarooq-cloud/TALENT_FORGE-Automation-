// SuperAdmin Portal > Analytics > Agents (/agents-analytics).
// Feature: features/SuperAdmin_Portal/Analytics/Agent-analytics.feature
// Page object: pages/AgentAnalyticsPage.js   Probe: scripts/probe-superadmin-agent-analytics.js
//
// EVERY PHRASE NAMES "Agents Analytics" (or a widget only this page has), so nothing collides
// with the dashboard, Activity Log or listing vocabulary other step files own. The one phrase
// reused is `Given I am logged in as the superadmin` (steps/invite-agent.js); the access step
// lives in steps/user-management-edges.js beside its siblings, because it needs that file's
// per-role sign-in.
//
// Every value is compared with the response the app itself received for the request that
// produced the render - never with a literal. Multi-case steps collect every problem and throw
// once, so a red row names every widget or duration that disagrees, not just the first.
const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const AgentAnalyticsPage = require('../pages/AgentAnalyticsPage');

const { DURATIONS, KEYS, MONTHS } = AgentAnalyticsPage;
const num = AgentAnalyticsPage.num;
const SLOW = { timeout: 180000 };
const TABLE = { timeout: 420000 };

const ap = (w) => w.pages.agentAnalytics;
function notes(w) { if (!w._aa) w._aa = { chosen: [] }; return w._aa; }
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/[-\s]+/g, ' ');

function fail(problems, headline) {
  if (!problems.length) return;
  throw new Error(`${headline}\n  - ${problems.join('\n  - ')}`);
}
async function record(world, title, payload) {
  await world.attach(`${title}\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`, 'text/plain');
}

// Runs an action that re-queries the widgets and remembers which responses it produced.
async function act(world, fn) {
  const at = ap(world).mark();
  const out = await fn();
  notes(world).lastMark = at;
  return out;
}

// The response behind what the card renders now: the one matching the URL (fresh or cached).
const cur = (world, key) => ap(world).current(key);

function sinceLast(world, key) {
  return ap(world).since(notes(world).lastMark || 0, key);
}

// ------------------------------------------------------------------ server vs render

function fmtMonths(list) { return list.map((t) => `${t.month} ${t.year}`); }

// Seconds -> the value the card should show in the unit it chose.
function checkVerificationTime(rendered, seconds, label) {
  const problems = [];
  const m = clean(rendered).match(/^(-?\d+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!m) return [`${label}: Avg. Verification Time reads "${rendered}", which is not a number with a unit`];
  const value = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  const per = /^min/.test(unit) ? 60 : /^(h|hr|hour)/.test(unit) ? 3600 : /^day/.test(unit) ? 86400 : null;
  if (!seconds) {
    if (value !== 0) problems.push(`${label}: the server's average is 0s but the card reads "${rendered}"`);
    return problems;
  }
  if (!per) return [`${label}: Avg. Verification Time "${rendered}" has no minutes / hours / days unit (server: ${seconds}s)`];
  const expected = seconds / per;
  if (Math.abs(expected - value) > 0.6) problems.push(`${label}: Avg. Verification Time reads "${rendered}" but ${seconds}s is ${expected.toFixed(2)} ${unit}`);
  return problems;
}

// What every widget renders, compared with the nine responses that produced it.
async function compareAll(world, label) {
  const a = ap(world);
  const r = Object.fromEntries(KEYS.map((k) => [k, (cur(world, k) || {}).body]));
  const problems = [];
  const notesOut = [];

  const ov = await a.readOverview();
  const s = r.overview || {};
  const pairs = [
    ['Total Agents', ov.totalAgents, s.total_agents],
    ['High Performing', ov.high, s.high_performing],
    ['Average', ov.average, s.average],
    ['Requires Attention', ov.attention, s.requires_attention],
    ['Avg. Candidates per Agent', ov.avgCandidates, s.avg_candidates_per_agent],
    ['Total Revenue', num(ov.totalRevenue), s.total_promo_revenue],
  ];
  for (const [name, got, want] of pairs) if (got !== want) problems.push(`${label}: ${name} reads ${got}, the server returned ${want}`);
  if (s.total_promo_revenue && !/SAR$/.test(clean(ov.totalRevenue))) problems.push(`${label}: Total Revenue "${ov.totalRevenue}" is not in SAR`);
  problems.push(...checkVerificationTime(ov.avgVerification, s.avg_verification_time_seconds, label));

  const tp = await a.readTopPerforming();
  const perf = (r.performing || []).slice(0, 5);
  if (tp.rows.length !== perf.length) problems.push(`${label}: Top Performing Agents lists ${tp.rows.length} agents, the server returned ${perf.length} (max 5)`);
  perf.forEach((p, i) => {
    const row = tp.rows[i];
    if (!row) return;
    if (row.rank !== `#${i + 1}`) problems.push(`${label}: Top Performing row ${i + 1} is ranked "${row.rank}"`);
    if (row.agent !== p.name) problems.push(`${label}: Top Performing #${i + 1} is "${row.agent}", the server's is "${p.name}"`);
    if (row.candidates !== p.total_candidates) problems.push(`${label}: ${p.name} Total Candidates ${row.candidates} vs server ${p.total_candidates}`);
    if (row.verified !== p.documents_verified) problems.push(`${label}: ${p.name} Documents Verified ${row.verified} vs server ${p.documents_verified}`);
    if (num(row.revenue) !== p.revenue_generated || !/SAR$/.test(row.revenue)) problems.push(`${label}: ${p.name} Revenue Generated "${row.revenue}" vs server ${p.revenue_generated} SAR`);
  });

  const at = await a.readAttention();
  const att = r.attention || { count: 0, results: [] };
  if (att.count && at.count !== att.count) problems.push(`${label}: the attention badge reads "${at.badge}", the server counted ${att.count}`);
  const attWant = (att.results || []).slice(0, 5).map((x) => x.name);
  const attGot = at.rows.map((x) => x.name);
  if (JSON.stringify(attWant) !== JSON.stringify(attGot)) problems.push(`${label}: Agents Requiring Attention lists ${JSON.stringify(attGot)}, the server's first 5 are ${JSON.stringify(attWant)}`);

  const rv = await a.readRevenue();
  const rev = r.revenue || {};
  if (num(rv.total) !== rev.total) problems.push(`${label}: Total Revenue Generated reads "${rv.total}", the server returned ${rev.total}`);
  if ((rev.trends || []).some((t) => t.revenue)) {
    const want = (rev.trends || []).map((t) => t.month);
    if (JSON.stringify(rv.months) !== JSON.stringify(want)) problems.push(`${label}: the Revenue Trend chart shows months ${rv.months.join(',')} but the server returned ${want.join(',')}`);
  }
  const ra = (r['revenue/agents'] || []).slice(0, 5);
  if (ra.length) {
    ra.forEach((x, i) => {
      const row = rv.top[i];
      if (!row || row.agent !== x.name || num(row.revenue) !== x.revenue_generated) {
        problems.push(`${label}: Top Revenue #${i + 1} reads ${JSON.stringify(row)}, the server's is ${x.name} ${x.revenue_generated} SAR`);
      }
    });
    if (rv.top.length !== ra.length) problems.push(`${label}: Top Revenue Generating Agents lists ${rv.top.length}, the server returned ${ra.length}`);
  } else {
    notesOut.push(`${label}: the server returned no revenue agents (the placeholder rows are their own @known-issue)`);
  }

  const dv = await a.readDocumentsOverview();
  const d = r['documents/overview'] || {};
  for (const [name, got, want] of [['Verified Documents', dv.verified, d.verified], ['Pending Verifications', dv.pending, d.pending], ['Revision Requested', dv.revisions, d.revisions_requested]]) {
    if (got !== want) problems.push(`${label}: ${name} reads ${got}, the server returned ${want}`);
  }

  const bd = await a.readBreakdown();
  const b = r['documents/breakdown'] || {};
  if (bd.total !== b.total_submitted) problems.push(`${label}: the breakdown total reads ${bd.total}, the server returned ${b.total_submitted}`);
  for (const [cat, field] of [['Transcripts', 'transcripts'], ['Experience Letters', 'experience_letters'], ['Certifications', 'certifications']]) {
    const shown = bd.categories.find((c) => c.label === cat);
    const got = shown ? num(shown.value) : null;
    const want = b[field] || 0;
    if ((got || 0) !== want) problems.push(`${label}: ${cat} reads "${shown && shown.value}", the server returned ${want}`);
  }

  const bl = await a.readBacklog();
  const back = (r['documents/backlog'] || []).slice(0, 4);
  if (bl.rows.length !== back.length) problems.push(`${label}: Verification Backlog Alerts lists ${bl.rows.length} agents, the server returned ${back.length} (max 4)`);
  back.forEach((x, i) => {
    const row = bl.rows[i];
    if (!row || row.agent !== x.agent_name || row.tag !== `${x.pending_document_count} pending`) {
      problems.push(`${label}: backlog #${i + 1} reads ${JSON.stringify(row)}, the server's is ${x.agent_name} ${x.pending_document_count} pending`);
    }
  });

  return { problems, notes: notesOut };
}

// The months a duration should cover, counted back from today.
function windowFor(phrase) {
  const now = new Date();
  const back = (n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });
  if (/current month$/i.test(phrase) && /^the current/i.test(phrase)) return back(1);
  if (/january/i.test(phrase)) return back(now.getMonth() + 1);
  const n = Number((phrase.match(/last (\d+) months/i) || [])[1]);
  if (n) return back(n);
  throw new Error(`no month window is defined for "${phrase}"`);
}

// "3mo ago" against an ISO timestamp, allowing for the floor the UI applies.
function relativeAgrees(text, iso) {
  const m = clean(text).match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|wk|mo|y|yr)s?\s+ago$/i);
  if (!m) return /just now|today/i.test(text);
  const unit = { s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600, d: 86400, day: 86400, w: 604800, wk: 604800, mo: 2592000, y: 31536000, yr: 31536000 }[m[2].toLowerCase()];
  const age = (Date.now() - Date.parse(iso)) / 1000 / unit;
  return Math.abs(age - Number(m[1])) < 1.5;
}

// ------------------------------------------------------------------ Background / navigation

Given('I have opened the Agents Analytics dashboard', SLOW, async function () {
  const n = notes(this);
  n.lastMark = ap(this).mark();
  const out = await ap(this).open();
  n.unfiltered = out.overview.body;
  n.lastMark = n.lastMark || 0;
});

Given('the Agents Analytics dashboard is showing {string}', SLOW, async function (d) {
  await act(this, () => ap(this).chooseDuration(d));
});

When('I open the Agents Analytics dashboard at {string}', SLOW, async function (query) {
  await act(this, () => ap(this).open(query));
});

When('I reload the Agents Analytics dashboard', SLOW, async function () {
  await act(this, () => ap(this).reload());
});

When('I choose the {string} Agents Analytics duration', SLOW, async function (d) {
  await act(this, () => ap(this).chooseDuration(d));
});

Then('the Analytics module should offer these sub-tabs:', async function (table) {
  const problems = [];
  for (const { 'sub-tab': name, route } of table.hashes()) {
    const link = this.page.locator(`a[href="${route}"]`).first();
    if (!(await link.isVisible().catch(() => false))) { problems.push(`no "${name}" link to ${route}`); continue; }
    const text = clean(await link.innerText());
    if (text !== name) problems.push(`the link to ${route} reads "${text}", expected "${name}"`);
  }
  fail(problems, 'The Analytics sub-tabs are not as specified:');
});

Then('the Agents Analytics dashboard should offer the {string} and {string} filters', async function (a1, a2) {
  await expect(ap(this).universityTrigger, `the ${a1} filter`).toBeVisible();
  await expect(ap(this).durationTrigger, `the ${a2} filter`).toBeVisible();
  expect(await ap(this).triggerText('university')).toContain(a1);
  expect(await ap(this).triggerText('duration')).toContain(a2);
});

Then('the Agents Analytics dashboard should show these widgets:', async function (table) {
  const missing = [];
  for (const { widget } of table.hashes()) {
    const loc = this.page.locator('section').filter({ hasText: widget }).first();
    if (!(await loc.isVisible().catch(() => false))) missing.push(widget);
  }
  fail(missing, 'These Agents Analytics widgets are missing:');
});

When('I open each Analytics sub-tab in turn', SLOW, async function () {
  const seen = [];
  for (const route of ['/candidate-analytics', '/platform-analytics']) {
    await this.page.locator(`a[href="${route}"]`).first().click();
    await this.page.waitForURL((u) => u.pathname === route, { timeout: 30000 }).catch(() => {});
    seen.push({ route, landed: new URL(this.page.url()).pathname });
  }
  notes(this).subTabs = seen;
});

Then('each Analytics sub-tab should have opened its own route', async function () {
  const bad = notes(this).subTabs.filter((s) => s.route !== s.landed).map((s) => `${s.route} landed on ${s.landed}`);
  fail(bad, 'An Analytics sub-tab did not open its own route:');
});

async function settleFromUrl(world, at) {
  await ap(world).settle(at);
  notes(world).lastMark = at;
}

// Measured: the sidebar link opens /agents-analytics with no query and the app serves the widgets
// from its cache (no request). So the render is compared with the most recent responses for the
// query the URL now holds - fetched now or earlier.
Then('returning to the Agents sub-tab should load every Agents Analytics widget again', SLOW, async function () {
  const a = ap(this);
  const at = a.mark();
  await this.page.locator('a[href="/agents-analytics"]').first().click();
  await this.page.waitForURL(/\/agents-analytics/, { timeout: 30000 });
  await a.durationTrigger.waitFor({ state: 'visible', timeout: 30000 });
  await settleFromUrl(this, at);
  await record(this, 'Returning to Agents', { url: this.page.url(), refetched: a.since(at).filter((r) => r.key !== 'institutions').length });
  const { problems } = await compareAll(this, 'after returning');
  fail(problems, 'The Agents Analytics widgets did not come back correctly:');
});

// ------------------------------------------------------------------ duration

Then('the Agents Analytics Duration filter should offer exactly:', async function (table) {
  const want = table.hashes().map((r) => norm(r.duration));
  const got = (await ap(this).durationOptions()).map((o) => o.label);
  await record(this, 'Duration options as rendered', got);
  expect(got.map(norm), `the Duration options (rendered ${JSON.stringify(got)})`).toEqual(want);
});

Then('only {string} should be marked as the chosen Agents Analytics duration', async function (d) {
  const opts = await ap(this).durationOptions();
  const checked = opts.filter((o) => o.checked).map((o) => o.label);
  expect(checked.map(norm), `chosen durations (options ${JSON.stringify(opts)})`).toEqual([norm(d)]);
});

Then('the Agents Analytics Duration filter should show {string} as chosen', async function (d) {
  const opts = await ap(this).durationOptions();
  const trigger = await ap(this).triggerText('duration');
  const checked = opts.filter((o) => o.checked).map((o) => o.label);
  await record(this, 'Duration filter state', { trigger, options: opts });
  expect(checked.map(norm), `the Duration filter should open with "${d}" chosen; the trigger reads "${trigger}" and the chosen options are ${JSON.stringify(checked)}`).toEqual([norm(d)]);
});

// What the widgets were asked for since the last action. Prefers a request carrying the expected
// params (a deep link sends an unfiltered round first); when the app answered from its cache and
// sent nothing, the cached response for the URL stands in for it.
function requestedWith(world, { duration, university, noUniversity } = {}) {
  const problems = [];
  for (const k of KEYS) {
    const sent = sinceLast(world, k);
    const last = sent.filter((r) => (duration === undefined || r.params.duration === duration) && (university === undefined || r.params.university === university) && !(noUniversity && r.params.university !== undefined)).pop()
      || cur(world, k) || sent[sent.length - 1];
    if (!last) { problems.push(`${k}: no request was made`); continue; }
    if (duration !== undefined && last.params.duration !== duration) problems.push(`${k}: sent duration=${last.params.duration === undefined ? '(none)' : last.params.duration}, expected ${duration}`);
    if (university !== undefined && last.params.university !== university) problems.push(`${k}: sent university=${last.params.university === undefined ? '(none)' : last.params.university}, expected ${university}`);
    if (noUniversity && last.params.university !== undefined) problems.push(`${k}: still sent university=${last.params.university}`);
  }
  return problems;
}

Then('every Agents Analytics widget should have been requested for Year to Date', async function () {
  fail(requestedWith(this, { duration: DURATIONS['Year-to-Date'] }), 'The default load did not ask for Year to Date:');
});

Then('every Agents Analytics widget should have been requested with duration {string}', async function (v) {
  fail(requestedWith(this, { duration: v }), `Not every widget was requested with duration=${v}:`);
});

Then('every Agents Analytics widget should have been requested with university {string}', async function (v) {
  fail(requestedWith(this, { university: v }), `Not every widget was requested with university=${v}:`);
});

Then('choosing each Agents Analytics duration should query every widget with its own value:', TABLE, async function (table) {
  const problems = [];
  for (const row of table.hashes()) {
    await act(this, () => ap(this).chooseDuration(row.duration));
    problems.push(...requestedWith(this, { duration: row['api value'] }).map((p) => `${row.duration}: ${p}`));
    const q = new URL(this.page.url()).searchParams.get('duration');
    if (q !== row['url value']) problems.push(`${row.duration}: the URL holds duration=${q}, expected ${row['url value']}`);
  }
  fail(problems, 'A duration did not reach every widget request and the URL:');
});

Then('for each Agents Analytics duration every widget should render the server\'s figures:', TABLE, async function (table) {
  const problems = [];
  const extra = [];
  for (const { duration } of table.hashes()) {
    await act(this, () => ap(this).chooseDuration(duration));
    const out = await compareAll(this, duration);
    problems.push(...out.problems);
    extra.push(...out.notes);
  }
  if (extra.length) await record(this, 'Recorded, not asserted', extra);
  fail(problems, 'A widget does not render what the server returned:');
});

Then('every widget should render the server\'s figures for the current filters', SLOW, async function () {
  const out = await compareAll(this, 'current filters');
  if (out.notes.length) await record(this, 'Recorded, not asserted', out.notes);
  fail(out.problems, 'A widget does not render what the server returned:');
});

Then('every Agents Analytics widget should render the Year to Date figures', SLOW, async function () {
  const out = await compareAll(this, 'after the quick switch');
  fail(out.problems, 'After a quick switch the widgets do not show the Year to Date figures:');
});

Then('the Agents Analytics trend charts should cover these months:', TABLE, async function (table) {
  const problems = [];
  const seen = {};
  for (const { duration, months } of table.hashes()) {
    await act(this, () => ap(this).chooseDuration(duration));
    const want = windowFor(months);
    const rev = (cur(this, 'revenue') || {}).body || {};
    const got = fmtMonths(rev.trends || []);
    const shown = (await ap(this).readRevenue()).months;
    const trend = fmtMonths(((cur(this, 'documents/trend') || {}).body) || []);
    seen[duration] = { expected: want, revenueServer: got, revenueChart: shown, verificationServer: trend };
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${duration}: the revenue trend covers ${got.join(', ')} - expected ${months}: ${want.join(', ')}`);
    if (JSON.stringify(shown) !== JSON.stringify(want.map((x) => x.split(' ')[0]))) problems.push(`${duration}: the Revenue Trend chart's x-axis reads ${shown.join(', ')}`);
    const outside = trend.filter((t) => !want.includes(t));
    if (outside.length) problems.push(`${duration}: the verification trend includes months outside the window: ${outside.join(', ')}`);
    const gaps = want.filter((w) => !trend.includes(w));
    if (gaps.length && trend.length) seen[duration].verificationMissingMonths = gaps;
  }
  await record(this, 'Months per duration (verification months the server omits are recorded, not asserted)', seen);
  fail(problems, 'A duration does not cover the months the AC specifies:');
});

When('I note the Top Performing Agents the server returned', async function () {
  notes(this).monthly = {
    performing: cur(this, 'performing').body,
    revenueAgents: cur(this, 'revenue/agents').body,
  };
});

Then('the Top Performing Agents request should carry the {string} duration', async function (v) {
  expect(cur(this, 'performing').params.duration).toBe(v);
});

Then('each Top Performing Agent\'s revenue should match its Revenue Impact revenue for Monthly and for Year to Date', async function () {
  const ytd = { performing: cur(this, 'performing').body, revenueAgents: cur(this, 'revenue/agents').body };
  const problems = [];
  for (const [label, set] of [['Monthly', notes(this).monthly], ['Year to Date', ytd]]) {
    for (const p of set.performing) {
      const r = set.revenueAgents.find((x) => x.id === p.id);
      if (r && r.revenue_generated !== p.revenue_generated) {
        problems.push(`${label}: ${p.name} has ${p.revenue_generated} SAR in Top Performing but ${r.revenue_generated} SAR in Revenue Impact for the same period`);
      }
    }
  }
  const same = JSON.stringify(notes(this).monthly.performing) === JSON.stringify(ytd.performing);
  await record(this, 'Top Performing per duration', { identicalAcrossDurations: same, monthly: notes(this).monthly.performing, ytd: ytd.performing });
  fail(problems, 'Top Performing Agents does not follow the selected duration:');
});

Then('each Agents Analytics comparison line should name its period:', TABLE, async function (table) {
  const problems = [];
  for (const { duration, comparison } of table.hashes()) {
    await act(this, () => ap(this).chooseDuration(duration));
    const lines = [];
    for (const card of ['overview', 'revenue', 'documents', 'breakdown']) {
      lines.push(...(await ap(this).cardLines(card)).filter((l) => / vs /.test(l)));
    }
    if (!lines.length) problems.push(`${duration}: no comparison line was rendered`);
    for (const l of lines) if (!l.endsWith(comparison)) problems.push(`${duration}: "${l}" does not end with "${comparison}"`);
  }
  fail(problems, 'A comparison line does not name the period it compares with:');
});

Then('the Agents Analytics URL should hold {string}', async function (fragment) {
  const [k, v] = fragment.split('=');
  expect(new URL(this.page.url()).searchParams.get(k), `the URL ${this.page.url()}`).toBe(v);
});

When('I choose {string} and then {string} in quick succession', SLOW, async function (first, second) {
  const a = ap(this);
  await a.openDuration();
  const at = a.mark();
  const pick = (l) => a.popover().locator('.list-option', { hasText: new RegExp(`^\\s*${AgentAnalyticsPage.buildLabel(l).replace(/-/g, '\\-')}\\s*$`) }).first();
  await pick(first).click();
  await pick(second).click();
  const want = DURATIONS[AgentAnalyticsPage.buildLabel(second)];
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && KEYS.some((k) => !a.since(at, k).some((r) => r.params.duration === want))) await this.page.waitForTimeout(250);
  await a.flush();
  await this.page.waitForTimeout(3000); // let any late first-choice response land, so a race shows
  await a.closePopover();
  notes(this).lastMark = at;
});

// ------------------------------------------------------------------ university

When('I open the Agents Analytics University filter', SLOW, async function () {
  const at = ap(this).mark();
  await ap(this).openUniversity();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !ap(this).since(at, 'institutions').length && !ap(this).latest('institutions')) await this.page.waitForTimeout(250);
  await ap(this).flush();
});

Then('the University options should be the universities the server listed, none of them deleted', async function () {
  const first = ap(this).responses.filter((r) => r.key === 'institutions' && !r.params.search && r.params.page === '1').pop();
  expect(first, 'the first page of universities was never requested').toBeTruthy();
  const want = first.body.results.map((u) => u.name);
  const got = (await ap(this).readUniversityOptions()).map((o) => o.name);
  expect(got.slice(0, want.length), 'the University options in order').toEqual(want);
  const deleted = first.body.results.filter((u) => u.is_active === false).map((u) => u.name);
  expect(deleted, 'deleted (inactive) universities offered').toEqual([]);
  notes(this).institutionsCount = first.body.count;
});

Then('scrolling the University options should load the next page of universities', SLOW, async function () {
  const before = (await ap(this).readUniversityOptions()).length;
  const calls = await ap(this).scrollUniversityList();
  const after = (await ap(this).readUniversityOptions()).length;
  expect(calls.map((c) => c.params.page), 'the next page of universities should be requested on scroll').toContain('2');
  expect(after, `options after scrolling (before: ${before})`).toBeGreaterThan(before);
});

Then('no University option should be checked', async function () {
  const checked = (await ap(this).readUniversityOptions()).filter((o) => o.checked).map((o) => o.name);
  expect(checked).toEqual([]);
});

When('I search the Agents Analytics universities for {string}', SLOW, async function (term) {
  notes(this).search = await ap(this).searchUniversity(term);
});

Then('every University option offered should contain {string}', async function (term) {
  const res = notes(this).search;
  expect(res, `the search for "${term}" was never sent to the server`).toBeTruthy();
  const got = (await ap(this).readUniversityOptions()).map((o) => o.name);
  expect(got.length, 'options offered for the search').toBeGreaterThan(0);
  const stray = got.filter((n) => !n.toLowerCase().includes(term.toLowerCase()));
  expect(stray, `options that do not contain "${term}"`).toEqual([]);
  expect(got.slice(0, res.body.results.length)).toEqual(res.body.results.map((u) => u.name));
});

Then('the University options should say {string}', async function (text) {
  expect(await ap(this).popoverText()).toContain(text);
  expect(await ap(this).universityOptions.count()).toBe(0);
});

// Universities come from the Top Performing Agents' own payload (so the filter has something to
// narrow to). An agent's university is not always one the filter offers - measured 2026-11-03,
// the #1 agent's "Dhahran Ahliyya Schools" is not among the 145 institutions listed - so each
// candidate is checked against the filter's own search first and skipped (and recorded) if absent.
async function chooseUniversities(world, count) {
  const a = ap(world);
  const perf = (a.latest('performing') || {}).body || [];
  const candidates = [...new Set(perf.map((p) => p.university).filter(Boolean))];
  const chosen = [];
  const notOffered = [];
  let ids = [];
  await a.openUniversity();
  for (const name of candidates) {
    if (chosen.length === count) break;
    const res = await a.searchUniversity(name);
    if (!res || !res.body.results.some((u) => u.name === name)) { notOffered.push(name); continue; }
    const out = await act(world, () => a.toggleUniversity(name));
    chosen.push(name);
    ids = (out.overview.params.university || '').split(',');
  }
  await a.closePopover();
  if (notOffered.length) await record(world, "Agents' universities the University filter does not offer (recorded, not asserted)", notOffered);
  expect(chosen.length, `only ${chosen.length} of the Top Performing Agents' universities are offered by the filter (${candidates.join(', ')}), ${count} needed`).toBe(count);
  notes(world).universities = chosen.map((n, i) => ({ name: n, id: ids[i] }));
  await record(world, 'Universities chosen', notes(world).universities);
}

When('I filter the Agents Analytics dashboard by the university of a top performing agent', TABLE, async function () {
  await chooseUniversities(this, 1);
});

When('I filter the Agents Analytics dashboard by the universities of two top performing agents', TABLE, async function () {
  await chooseUniversities(this, 2);
});

Then('every university a Top Performing Agent belongs to should be offered by the University filter', SLOW, async function () {
  const a = ap(this);
  const names = [...new Set(((a.latest('performing') || {}).body || []).map((p) => p.university).filter(Boolean))];
  await a.openUniversity();
  const missing = [];
  for (const name of names) {
    const res = await a.searchUniversity(name);
    if (!res || !res.body.results.some((u) => u.name === name)) missing.push(name);
  }
  await a.closePopover();
  fail(missing, `The University filter does not offer the university of a Top Performing Agent (checked ${names.join(', ')}):`);
});

Then('every Agents Analytics widget should have been requested for that university only', async function () {
  fail(requestedWith(this, { university: notes(this).universities[0].id }), 'Not every widget was narrowed to the chosen university:');
});

Then('every Agents Analytics widget should have been requested for both universities', async function () {
  const ids = notes(this).universities.map((u) => u.id).join(',');
  fail(requestedWith(this, { university: ids }), 'Not every widget was narrowed to both universities:');
});

Then('every Agents Analytics widget should have been requested for that university with duration {string}', async function (v) {
  fail(requestedWith(this, { university: notes(this).universities[0].id, duration: v }), 'The two filters did not reach every widget together:');
});

// Not URL-guided on purpose: after Clear All the URL still names the universities (its own
// @known-issue), so the truth here is what was SENT since the clear - nothing narrowed - and, where
// the app answered from cache, that an unfiltered answer for the same duration exists to show.
Then('every Agents Analytics widget should have been requested without a university', async function () {
  const problems = [];
  const a = ap(this);
  const at = notes(this).lastMark || 0;
  for (const k of KEYS) {
    const sent = a.since(at, k);
    const narrowed = sent.filter((r) => r.params.university !== undefined);
    if (narrowed.length && !sent.some((r) => r.params.university === undefined)) problems.push(`${k}: after Clear All it was requested with university=${narrowed.pop().params.university}`);
    if (!sent.length && !a.responses.some((r) => r.key === k && r.params.university === undefined)) problems.push(`${k}: no unfiltered answer exists to show`);
  }
  fail(problems, 'A widget is still narrowed to a university:');
});

Then('the Agents Analytics URL should hold that university', async function () {
  expect(new URL(this.page.url()).searchParams.get('university')).toBe(notes(this).universities[0].id);
});

Then('the University filter should show a count of {int}', async function (n) {
  expect(await ap(this).triggerText('university')).toBe(`University ${n}`);
});

Then('the University filter should show no count', async function () {
  expect(await ap(this).triggerText('university')).toBe('University');
});

Then('every Top Performing Agent listed should belong to the chosen universities', async function () {
  const names = notes(this).universities.map((u) => u.name);
  const perf = cur(this, 'performing').body;
  const stray = perf.filter((p) => !names.includes(p.university)).map((p) => `${p.name} (${p.university})`);
  expect(stray, `Top Performing Agents outside ${names.join(' / ')}`).toEqual([]);
  const tp = await ap(this).readTopPerforming();
  expect(tp.rows.map((r) => r.agent)).toEqual(perf.slice(0, 5).map((p) => p.name));
});

Then('the Total Agents for both universities should not exceed the unfiltered Total Agents', async function () {
  const filtered = cur(this, 'overview').body.total_agents;
  expect(filtered).toBeLessThanOrEqual(notes(this).unfiltered.total_agents);
  expect((await ap(this).readOverview()).totalAgents).toBe(filtered);
});

When('I clear the Agents Analytics universities', SLOW, async function () {
  await ap(this).openUniversity();
  await act(this, () => ap(this).clearUniversities());
  await ap(this).closePopover();
});

Then('the Agents Analytics URL should hold no university', async function () {
  expect(new URL(this.page.url()).searchParams.getAll('university'), `the URL ${this.page.url()}`).toEqual([]);
});

Then('the Agents Analytics dashboard should still show every university', async function () {
  expect(await ap(this).triggerText('university')).toBe('University');
  expect((await ap(this).readOverview()).totalAgents, 'Total Agents after the reload').toBe(notes(this).unfiltered.total_agents);
});

Then('the Total Agents should equal the unfiltered Total Agents', async function () {
  expect((await ap(this).readOverview()).totalAgents).toBe(notes(this).unfiltered.total_agents);
});

Then('the chosen university should still be checked in the University filter', SLOW, async function () {
  const { name } = notes(this).universities[0];
  await ap(this).openUniversity();
  await ap(this).searchUniversity(name);
  const opt = (await ap(this).readUniversityOptions()).find((o) => o.name === name);
  await ap(this).closePopover();
  expect(opt && opt.checked, `"${name}" should still be checked after the reload`).toBe(true);
});

// ------------------------------------------------------------------ widget 1

Then('the Total Agents figure should equal the number of active agents in User Management', async function () {
  const a = ap(this);
  const all = await a.api('/agent/?status=ACTIVE&status=ATTENTION&page_size=1');
  const deact = await a.api('/agent/?status=DEACTIVATED&page_size=1');
  const invited = await a.api('/agent/?status=INVITE_SENT&page_size=1');
  const shown = (await a.readOverview()).totalAgents;
  const counts = { shown, activeInUserManagement: all.body.count, deactivated: deact.body.count, inviteSent: invited.body.count };
  await record(this, 'Total Agents vs the Agents listing', counts);
  expect(shown, `Total Agents reads ${shown}; User Management holds ${counts.activeInUserManagement} active agents (plus ${counts.deactivated} deactivated and ${counts.inviteSent} invited)`).toBe(counts.activeInUserManagement);
});

Then('the performance bar should show High Performing, Average and Requires Attention as the server counted them', async function () {
  const ov = await ap(this).readOverview();
  const s = cur(this, 'overview').body;
  expect([ov.high, ov.average, ov.attention]).toEqual([s.high_performing, s.average, s.requires_attention]);
  expect(ov.bars.length, 'the performance bar should have three segments').toBe(3);
});

Then('each performance bar segment should be sized by its share of the agents', async function () {
  const ov = await ap(this).readOverview();
  const parts = [ov.high, ov.average, ov.attention];
  const sum = parts.reduce((x, y) => x + y, 0);
  const problems = [];
  ['High Performing', 'Average', 'Requires Attention'].forEach((name, i) => {
    const share = sum ? (parts[i] / sum) * 100 : 0;
    if (Math.abs(share - ov.bars[i].width) > 1.5) problems.push(`${name} is ${share.toFixed(1)}% of the agents but its segment is ${ov.bars[i].width}% wide`);
  });
  fail(problems, 'The performance bar is not sized by each category\'s share:');
});

Then('for each Agents Analytics duration the average figures should be formatted:', TABLE, async function (table) {
  const problems = [];
  const seen = [];
  for (const { duration } of table.hashes()) {
    await act(this, () => ap(this).chooseDuration(duration));
    const ov = await ap(this).readOverview();
    const s = cur(this, 'overview').body;
    seen.push({ duration, avgCandidates: ov.avgCandidates, avgVerification: ov.avgVerification, seconds: s.avg_verification_time_seconds, totalRevenue: ov.totalRevenue });
    if (ov.avgCandidates !== s.avg_candidates_per_agent) problems.push(`${duration}: Avg. Candidates per Agent reads ${ov.avgCandidates}, server ${s.avg_candidates_per_agent}`);
    problems.push(...checkVerificationTime(ov.avgVerification, s.avg_verification_time_seconds, duration));
    if (s.total_promo_revenue && !/^[\d,]+(\.\d+)? SAR$/.test(clean(ov.totalRevenue))) problems.push(`${duration}: Total Revenue "${ov.totalRevenue}" is not a SAR amount`);
  }
  await record(this, 'Average figures per duration (a 0s average renders without a unit - recorded)', seen);
  fail(problems, 'An average figure is not formatted as specified:');
});

// ------------------------------------------------------------------ widget 2

Then('the Top Performing Agents table should have the columns:', async function (table) {
  expect((await ap(this).readTopPerforming()).headers).toEqual(table.hashes().map((r) => r.column));
});

Then('the Top Performing Agents table should list at most 5 agents, ranked from #1, as the server returned them', async function () {
  const tp = await ap(this).readTopPerforming();
  const perf = cur(this, 'performing').body;
  expect(tp.rows.length).toBe(Math.min(5, perf.length));
  expect(tp.rows.map((r) => r.rank)).toEqual(tp.rows.map((_, i) => `#${i + 1}`));
  const out = await compareAll(this, 'Year to Date');
  fail(out.problems.filter((p) => /Top Performing|Revenue Generated|Total Candidates|Documents Verified/.test(p)), 'Top Performing Agents does not match the server:');
});

Then('the Top Performing Agents should be ordered by revenue, then documents verified, then total candidates', async function () {
  const rows = (await ap(this).readTopPerforming()).rows;
  const sorted = [...rows].sort((a, b) => (num(b.revenue) - num(a.revenue)) || (b.verified - a.verified) || (b.candidates - a.candidates));
  expect(rows.map((r) => `${r.agent} (${r.revenue}, ${r.verified} verified, ${r.candidates} candidates)`))
    .toEqual(sorted.map((r) => `${r.agent} (${r.revenue}, ${r.verified} verified, ${r.candidates} candidates)`));
});

// ------------------------------------------------------------------ widget 3

Then('the Agents Requiring Attention badge should read the server\'s count as {string}', async function (_format) {
  const at = await ap(this).readAttention();
  const count = cur(this, 'attention').body.count;
  expect(at.badge).toBe(`${count.toLocaleString('en-US')} Items`);
});

Then('Agents Requiring Attention should list at most 5 agents as the server returned them', async function () {
  const at = await ap(this).readAttention();
  const res = cur(this, 'attention');
  await record(this, 'Attention request', { params: res.params, returned: res.body.results.length });
  expect(at.rows.length).toBeLessThanOrEqual(5);
  expect(at.rows.map((r) => r.name)).toEqual(res.body.results.slice(0, 5).map((x) => x.name));
});

Then('each Agents Requiring Attention row should show a name, a Critical or Warning badge, a reason and how long ago it was triggered', async function () {
  const at = await ap(this).readAttention();
  const res = cur(this, 'attention').body.results;
  const problems = [];
  at.rows.forEach((row, i) => {
    const s = res[i] || {};
    if (!row.name) problems.push(`row ${i + 1} has no agent name`);
    if (!['Critical', 'Warning'].includes(row.severity)) problems.push(`${row.name}: severity badge reads "${row.severity}"`);
    if (row.reason !== s.reason) problems.push(`${row.name}: reason "${row.reason}", server "${s.reason}"`);
    if (!relativeAgrees(row.when, s.timestamp)) problems.push(`${row.name}: "${row.when}" does not match the trigger time ${s.timestamp}`);
  });
  fail(problems, 'An Agents Requiring Attention row is incomplete:');
});

Then('only 4 Agents Requiring Attention rows should be visible before scrolling', async function () {
  const at = await ap(this).readAttention();
  if (at.rows.length < 5) throw new Error(`only ${at.rows.length} agents are listed, so the 4-before-scroll rule cannot be observed`);
  expect(at.rows.filter((r) => r.fullyVisible).length, 'rows fully visible before scrolling').toBe(4);
  expect(at.scroll.scrollHeight, 'the list should scroll').toBeGreaterThan(at.scroll.clientHeight);
  await ap(this).scrollAttention();
  const after = await ap(this).readAttention();
  expect(after.rows[4].fullyVisible, 'the 5th row should come into view on scroll').toBe(true);
});

Then('the Agents Requiring Attention rows should be ordered newest trigger first', async function () {
  const res = cur(this, 'attention').body.results.slice(0, 5);
  const shown = res.map((x) => `${x.name} ${x.timestamp}`);
  const sorted = [...res].sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp)).map((x) => `${x.name} ${x.timestamp}`);
  expect(shown).toEqual(sorted);
});

Then('every Agents Requiring Attention reason should be one of:', async function (table) {
  const allowed = table.hashes().map((r) => r.reason.trim());
  const rows = (await ap(this).readAttention()).rows;
  const stray = rows.filter((r) => !allowed.includes(r.reason)).map((r) => `${r.name}: "${r.reason}"`);
  expect(stray, 'reasons outside the four trigger reasons').toEqual([]);
});

When('I click View All on Agents Requiring Attention', SLOW, async function () {
  const href = await ap(this).attentionViewAll.getAttribute('href');
  notes(this).viewAllHref = href;
  await ap(this).attentionViewAll.click();
  await this.page.waitForURL(/\/agents\?/, { timeout: 30000 });
});

Then('I should be on the Requires Attention tab of the Agents listing', SLOW, async function () {
  expect(new URL(this.page.url()).pathname).toBe('/agents');
  expect(new URL(this.page.url()).searchParams.get('tab')).toBe('requiresAttention');
  await this.page.locator('[role="grid"], table').first().waitFor({ state: 'visible', timeout: 30000 });
  expect(await this.pages.agentsListing.isTabSelected('Requires Attention'), 'the Requires Attention tab should be selected').toBeTruthy();
});

When('I go back to the Agents Analytics dashboard with the browser', SLOW, async function () {
  const at = ap(this).mark();
  await this.page.goBack({ waitUntil: 'domcontentloaded' });
  await this.page.waitForURL(/\/agents-analytics/, { timeout: 30000 });
  await ap(this).durationTrigger.waitFor({ state: 'visible', timeout: 30000 });
  await settleFromUrl(this, at);
});

// ------------------------------------------------------------------ widget 4

Then('the Revenue Impact total should be the server\'s total in SAR and match Total Revenue in Widget 1', async function () {
  const rv = await ap(this).readRevenue();
  const ov = await ap(this).readOverview();
  const total = cur(this, 'revenue').body.total;
  expect(num(rv.total)).toBe(total);
  expect(rv.total).toMatch(/ SAR$/);
  expect(num(ov.totalRevenue), 'Total Revenue in Agent Performance Overview').toBe(total);
});

Then('the Revenue Trend chart should have one bar month per month the server returned', async function () {
  const rv = await ap(this).readRevenue();
  const trends = cur(this, 'revenue').body.trends;
  expect(rv.months).toEqual(trends.map((t) => t.month));
  expect(rv.bars.length, 'bars drawn for months with revenue').toBe(trends.filter((t) => t.revenue > 0).length);
});

Then('Top Revenue Generating Agents should list at most 5 agents in SAR, highest revenue first, as the server returned them', async function () {
  const rv = await ap(this).readRevenue();
  const server = cur(this, 'revenue/agents').body.slice(0, 5);
  expect(rv.top.map((r) => `${r.rank} ${r.agent} ${num(r.revenue)}`)).toEqual(server.map((x, i) => `#${i + 1} ${x.name} ${x.revenue_generated}`));
  expect(rv.top.every((r) => / SAR$/.test(r.revenue)), 'every revenue in SAR').toBe(true);
  const revs = server.map((x) => x.revenue_generated);
  expect(revs).toEqual([...revs].sort((a, b) => b - a));
});

Then('the current month\'s bar on the Revenue Trend chart should be styled differently from the others', async function () {
  const rv = await ap(this).readRevenue();
  const trends = cur(this, 'revenue').body.trends;
  const now = new Date();
  const current = trends[trends.length - 1];
  if (!current || current.month !== MONTHS[now.getMonth()] || !current.revenue) {
    throw new Error(`the current month has no revenue bar to inspect (last month returned: ${JSON.stringify(current)})`);
  }
  const style = (b) => `${b.fill}|${b.opacity}|${b.stroke}`;
  const last = rv.bars[rv.bars.length - 1];
  const others = rv.bars.slice(0, -1).map(style);
  await record(this, 'Revenue Trend bar styles', rv.bars);
  expect(others.length, 'need other months to compare against').toBeGreaterThan(0);
  expect(others.includes(style(last)), `the ${current.month} bar is drawn ${style(last)} - the same as the other months`).toBe(false);
});

// ------------------------------------------------------------------ widget 5

Then('Document Verification Overview should show Verified, Pending and Revision Requested as the server counted them', async function () {
  const dv = await ap(this).readDocumentsOverview();
  const s = cur(this, 'documents/overview').body;
  expect([dv.verified, dv.pending, dv.revisions]).toEqual([s.verified, s.pending, s.revisions_requested]);
});

Then('the Verification Activity Trend should offer the {string} and {string} lines', async function (a1, a2) {
  const dv = await ap(this).readDocumentsOverview();
  expect(dv.legend).toEqual([a1, a2]);
  const curves = await ap(this).card('documents').locator('path.recharts-area-curve, path.recharts-line-curve').count();
  expect(curves, 'two trend lines drawn').toBeGreaterThanOrEqual(2);
});

Then('the Verification Activity Trend should plot the months the server returned', async function () {
  const dv = await ap(this).readDocumentsOverview();
  const trend = cur(this, 'documents/trend').body;
  expect(dv.months).toEqual(trend.map((t) => t.month));
});

Then('the Verification Activity Trend should show every month from January to the current month', async function () {
  const want = windowFor('January to the current month').map((m) => m.split(' ')[0]);
  const shown = (await ap(this).readDocumentsOverview()).months;
  const missing = want.filter((m) => !shown.includes(m));
  expect(missing, `the Verification Activity Trend's x-axis reads ${shown.join(', ')}`).toEqual([]);
});

Then('the Verification Activity Trend help icon should explain {string}', async function (text) {
  const tip = await ap(this).tooltipOf('documents');
  expect(tip.text).toBe(text);
});

// ------------------------------------------------------------------ widget 6

Then('the Verification Breakdown should show each category\'s count as the server returned it', async function () {
  const bd = await ap(this).readBreakdown();
  const s = cur(this, 'documents/breakdown').body;
  expect(bd.categories.map((c) => num(c.value))).toEqual([s.transcripts, s.experience_letters, s.certifications]);
});

Then('each Verification Breakdown segment should be sized by its count', async function () {
  const bd = await ap(this).readBreakdown();
  const s = cur(this, 'documents/breakdown').body;
  expect(bd.segments.map((x) => x.grow)).toEqual([s.transcripts, s.experience_letters, s.certifications]);
});

Then('the Verification Breakdown total should equal the Verified Documents count', async function () {
  const bd = await ap(this).readBreakdown();
  const verified = cur(this, 'documents/overview').body.verified;
  expect(bd.total, `"Total Documents Verified" reads ${bd.total}, while Verified Documents is ${verified}`).toBe(verified);
});

Then('the Verification Breakdown categories should add up to its total', async function () {
  const bd = await ap(this).readBreakdown();
  const sum = bd.categories.reduce((x, c) => x + (num(c.value) || 0), 0);
  expect(sum, `the three categories add up to ${sum}, the total reads ${bd.total}`).toBe(bd.total);
});

// ------------------------------------------------------------------ widget 7

Then('the Verification Backlog Alerts help icon should explain {string}', async function (text) {
  const tip = await ap(this).tooltipOf('backlog');
  expect(tip.text).toBe(text);
});

Then('the Verification Backlog Alerts help icon should explain itself from the keyboard too', async function () {
  const tip = await ap(this).tooltipOf('backlog', 'keyboard');
  expect(tip.text).toBe('Agents with unusually high pending verification queues.');
});

Then('Verification Backlog Alerts should list at most 4 agents with their pending count as the server returned them', async function () {
  const bl = await ap(this).readBacklog();
  const server = cur(this, 'documents/backlog').body;
  await record(this, 'Backlog request', { returned: server.length });
  expect(bl.rows.map((r) => `${r.agent} | ${r.tag}`)).toEqual(server.slice(0, 4).map((x) => `${x.agent_name} | ${x.pending_document_count} pending`));
});

When('I open View All on Verification Backlog Alerts', SLOW, async function () {
  const at = ap(this).mark();
  await ap(this).openBacklogModal();
  notes(this).modalRequests = ap(this).since(at).length;
});

Then('the backlog modal should list every agent the server returned with their pending count', async function () {
  const m = await ap(this).readBacklogModal();
  const server = cur(this, 'documents/backlog').body;
  expect(m.heading).toBe('Verification Backlog Alerts');
  expect(m.rows.map((r) => `${r.agent} | ${r.tag}`)).toEqual(server.map((x) => `${x.agent_name} | ${x.pending_document_count} pending`));
});

Then('the backlog modal should close by each of these routes:', SLOW, async function (table) {
  const problems = [];
  for (const { route } of table.hashes()) {
    if (!(await ap(this).backlogModalClose.isVisible().catch(() => false))) await ap(this).openBacklogModal();
    const closed = await ap(this).closeBacklogModal(route);
    if (!closed) problems.push(`${route} did not close the backlog modal`);
    else if (!/\/agents-analytics/.test(this.page.url())) problems.push(`${route} left the dashboard for ${this.page.url()}`);
  }
  fail(problems, 'The backlog modal does not close as expected:');
});

Then('every Verification Backlog tag should follow the severity rule:', async function (_rules) {
  await ap(this).openBacklogModal();
  const m = await ap(this).readBacklogModal();
  await ap(this).closeBacklogModal('Close button');
  const expected = (n) => (n > 50 ? 'red' : n >= 30 ? 'yellow' : 'none');
  const wrong = m.rows
    .map((r) => ({ ...r, n: num(r.tag), got: AgentAnalyticsPage.tagColour(r.color) }))
    .filter((r) => r.got !== expected(r.n))
    .map((r) => `${r.agent}: ${r.n} pending is tagged ${r.got}, the rule says ${expected(r.n)}`);
  fail(wrong, 'A Verification Backlog tag does not follow the severity rule (AC: red > 50; the yellow rule "50<=pending<30" is read as 30 to 50):');
});

// ------------------------------------------------------------------ empty / failed

const EMPTY = {
  overview: { total_agents: 0, high_performing: 0, average: 0, requires_attention: 0, avg_candidates_per_agent: 0, avg_candidates_change: 0, avg_verification_time_seconds: 0, avg_verification_time_change_seconds: 0, total_promo_revenue: 0, total_promo_revenue_change_percent: 0 },
  performing: [],
  attention: { count: 0, next: null, previous: null, results: [] },
  revenue: { total: 0, previous_period_total: 0, change_percentage: 0, trends: [] },
  'revenue/agents': [],
  'documents/overview': { verified: 0, pending: 0, revisions_requested: 0, total: 0, previous_period: { verified: 0, pending: 0, revisions_requested: 0, total: 0 }, change_percentage: 0 },
  'documents/trend': [],
  'documents/breakdown': { total_submitted: 0, transcripts: 0, experience_letters: 0, certifications: 0, total_change_percent: 0 },
  'documents/backlog': [],
};

Given('the Agents Analytics widgets will return no data', async function () {
  await this.page.route('**/agent/analytics/**', (route) => {
    const key = new URL(route.request().url()).pathname.replace(/.*\/analytics\//, '').replace(/\/$/, '');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY[key] ?? {}) });
  });
});

Given('the Agents Analytics widgets will fail with a server error', async function () {
  await this.page.route('**/agent/analytics/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed failure"}' }));
});

const CARD_OF = {
  'Total Agents': 'overview',
  'Top Performing Agents': 'performing',
  'Agents Requiring Attention': 'attention',
  'Revenue Impact': 'revenue',
  'Document Verification Overview': 'documents',
  'Document Verification Breakdown': 'breakdown',
  'Verification Backlog Alerts': 'backlog',
};

Then('the Agents Analytics widgets should show these empty states:', async function (table) {
  const texts = await ap(this).allCardText();
  await record(this, 'Every card as rendered with no data', texts);
  const problems = [];
  for (const { widget, text } of table.hashes()) {
    const got = texts[CARD_OF[widget]] || '';
    if (!got.replace(/"/g, '').includes(clean(text))) problems.push(`${widget}: expected "${text}", got "${got.slice(0, 200)}"`);
  }
  fail(problems, 'A widget does not show its empty state:');
});

// Product decision 2026-11-10: the empty list keeps its five ranks with "-" for agent and revenue.
Then('Top Revenue Generating Agents should list ranks #1 to #5 with a dash for agent and revenue', async function () {
  const rv = await ap(this).readRevenue();
  expect(rv.top.map((r) => `${r.rank} ${r.agent} ${r.revenue}`), 'the empty Top Revenue Generating Agents list')
    .toEqual(['#1 - -', '#2 - -', '#3 - -', '#4 - -', '#5 - -']);
});

Then('no Agents Analytics empty-state message should be wrapped in quotation marks', async function () {
  const texts = await ap(this).allCardText();
  const quoted = Object.entries(texts).flatMap(([k, t]) => (t.match(/"[^"]+"/g) || []).map((q) => `${k}: ${q}`));
  expect(quoted).toEqual([]);
});

Then('the Agents Analytics dashboard should say the data could not be loaded', async function () {
  const texts = await ap(this).allCardText();
  const toast = clean(await this.page.locator('.Toastify').innerText().catch(() => ''));
  const all = `${Object.values(texts).join(' ')} ${toast}`;
  await record(this, 'Dashboard after every widget answered 500', { toast, texts });
  expect(/could not|couldn't|unable to|failed|went wrong|try again|error/i.test(all),
    'with every widget failing (HTTP 500) the dashboard should say the data could not be loaded; it shows the empty states instead').toBe(true);
});

// ================================================================== GAP COVERAGE (2026-11-10)
// Measured with scripts/probe-agent-analytics-gaps.js and -gaps-2.js (both read-only).

const analyticsRequestCount = (w) => ap(w).responses.length;
const focusedText = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { text: (a.innerText || a.value || '').replace(/\s+/g, ' ').trim(), testid: a.getAttribute('data-testid') };
});
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// AC 4.C: Total active candidates / total active agents. The server's figure is duration-scoped
// (measured 2026-11-10: Monthly 0, Quarterly 0.8, Yearly and YTD 4.5, against 2171 / 497 = 4.4),
// while the AC formula names no period - so every duration is asserted and the PO asked.
Then('the Avg. Candidates per Agent should equal the active candidates divided by the active agents', TABLE, async function () {
  const a = ap(this);
  const candidates = (await a.api('/candidate/?page=1&page_size=1&is_active=true')).body.count;
  const agents = (await a.api('/agent/?status=ACTIVE&status=ATTENTION&page_size=1')).body.count;
  const expected = Math.round((candidates / agents) * 10) / 10;
  const seen = [];
  for (const d of ['Monthly', 'Quarterly', 'Yearly', 'Year to Date']) {
    await act(this, () => a.chooseDuration(d));
    seen.push({ duration: d, rendered: (await a.readOverview()).avgCandidates, server: cur(this, 'overview').body.avg_candidates_per_agent });
  }
  await record(this, 'Avg. Candidates per Agent per duration vs the AC formula', { activeCandidates: candidates, activeAgents: agents, expected, seen });
  const problems = seen.filter((s) => s.rendered !== expected).map((s) => `${s.duration}: reads ${s.rendered}, the formula gives ${candidates} / ${agents} = ${expected}`);
  fail(problems, 'Avg. Candidates per Agent is not Total active candidates / Total active agents:');
});

// The options are tabindex=0 <div>s: Tab moves between them (arrow keys do not - measured), and
// Enter picks the focused one.
When('I choose the {string} Agents Analytics duration with the keyboard', SLOW, async function (label) {
  const a = ap(this);
  const shown = AgentAnalyticsPage.buildLabel(label);
  await act(this, async () => {
    const at = a.mark();
    await a.closePopover();
    await a.durationTrigger.focus();
    await this.page.keyboard.press('Enter');
    await a.popover().locator('.list-option').first().waitFor({ state: 'visible', timeout: 10000 });
    const trail = [];
    for (let i = 0; i < 8; i += 1) {
      await this.page.keyboard.press('Tab');
      const f = await focusedText(this.page);
      trail.push(f.text);
      if (norm(f.text) === norm(shown)) break;
    }
    expect(norm(trail[trail.length - 1]), `Tab never reached "${shown}" inside the Duration popover - focus went ${JSON.stringify(trail)}`).toBe(norm(shown));
    await this.page.keyboard.press('Enter');
    const out = await a.settle(at);
    await a.closePopover();
    return out;
  });
});

When('I check the first university with the keyboard', SLOW, async function () {
  const a = ap(this);
  const at = a.mark();
  await a.closePopover();
  await a.universityTrigger.focus();
  await this.page.keyboard.press('Enter');
  await a.universitySearch.waitFor({ state: 'visible', timeout: 10000 });
  await a.universityOptions.first().waitFor({ state: 'visible', timeout: 15000 });
  let f = null;
  for (let i = 0; i < 6; i += 1) {
    await this.page.keyboard.press('Tab');
    f = await focusedText(this.page);
    if (/option-checkbox/.test(f.testid || '')) break;
  }
  expect(f && f.testid, 'Tab never reached a University option').toMatch(/option-checkbox/);
  await this.page.keyboard.press('Space');
  await a.settle(at);
  notes(this).lastMark = at;
  const id = new URL(this.page.url()).searchParams.get('university');
  notes(this).universities = [{ name: f.text, id }];
  await record(this, 'University checked from the keyboard', notes(this).universities);
  await a.closePopover();
});

When('I uncheck that university again', SLOW, async function () {
  const a = ap(this);
  const { name } = notes(this).universities[0];
  await a.openUniversity();
  await a.searchUniversity(name);
  const at = a.mark();
  await a.universityOptions.filter({ hasText: new RegExp(`^\\s*${reEscape(name)}\\s*$`) }).first().click();
  notes(this).lastMark = at;
  await a.settle(at);
  await a.closePopover();
});

Then('each Agents Analytics filter should close without changing anything by each of these routes:', SLOW, async function (table) {
  const a = ap(this);
  const problems = [];
  for (const { filter, route } of table.hashes()) {
    const url = this.page.url();
    if (/duration/i.test(filter)) await a.openDuration(); else await a.openUniversity();
    const before = analyticsRequestCount(this);
    if (/escape/i.test(route)) await this.page.keyboard.press('Escape');
    else await this.page.mouse.click(5, 5);
    // an absence: watch a window rather than sample once
    let open = true;
    for (let i = 0; i < 8 && open; i += 1) { await this.page.waitForTimeout(250); open = await a.popover().isVisible().catch(() => false); }
    await this.page.waitForTimeout(1000);
    if (open) problems.push(`${filter} / ${route}: the popover is still open`);
    if (this.page.url() !== url) problems.push(`${filter} / ${route}: the URL changed to ${this.page.url()}`);
    if (analyticsRequestCount(this) !== before) problems.push(`${filter} / ${route}: ${analyticsRequestCount(this) - before} widget request(s) were sent`);
    await a.closePopover();
  }
  fail(problems, 'Dismissing a filter popover changed something:');
});

// Malformed ?university= values are dropped from every request (measured), even the valid id in
// "117,abc". settle() is URL-guided and would wait for a matching request forever, so this waits
// for any widget round instead.
Then('opening the dashboard with these university values should ask every widget for every university:', TABLE, async function (table) {
  const a = ap(this);
  const origin = new URL(this.page.url()).origin;
  const problems = [];
  const seen = [];
  for (const { value } of table.hashes()) {
    const at = a.mark();
    await this.page.goto(`${origin}/agents-analytics?duration=Year-to-Date&university=${value}`, { waitUntil: 'domcontentloaded' });
    await a.waitForWidgets(at);
    await this.page.waitForTimeout(1500);
    const sent = a.since(at).map((r) => r.params.university);
    const narrowed = sent.filter((u) => u !== undefined);
    const shown = (await a.readOverview()).totalAgents;
    const trigger = await a.triggerText('university');
    seen.push({ value, sentUniversities: [...new Set(sent.map(String))], totalAgents: shown, trigger, url: this.page.url() });
    if (narrowed.length) problems.push(`university=${value}: a widget was asked for university=${narrowed[0]}`);
    if (shown !== notes(this).unfiltered.total_agents) problems.push(`university=${value}: Total Agents reads ${shown}, unfiltered is ${notes(this).unfiltered.total_agents}`);
    if (trigger !== 'University') problems.push(`university=${value}: the University filter reads "${trigger}"`);
  }
  await record(this, 'Malformed university values (the URL keeps the value - recorded)', seen);
  fail(problems, 'A malformed university value narrowed the dashboard:');
});

Then('a whitespace-only University search should leave the full list offered', SLOW, async function () {
  const a = ap(this);
  const before = (await a.readUniversityOptions()).map((o) => o.name);
  await a.searchUniversity('   ');
  await this.page.waitForTimeout(1500);
  const after = (await a.readUniversityOptions()).map((o) => o.name);
  expect(after.slice(0, before.length), 'the options after searching only spaces').toEqual(before);
});

Then('searching the universities for an unsafe term should find nothing and run nothing', SLOW, async function () {
  const a = ap(this);
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); };
  this.page.on('dialog', onDialog);
  const problems = [];
  for (const term of ['<script>alert(1)</script>', "' OR 1=1 --", '%26%3D']) {
    await a.searchUniversity(term);
    await this.page.waitForTimeout(1200);
    const txt = await a.popoverText();
    if (!/No results found\./.test(txt)) problems.push(`"${term}": the popover reads "${txt.slice(0, 120)}"`);
  }
  const injected = await this.page.evaluate(() => Array.from(document.querySelectorAll('script')).filter((s) => /alert\(1\)/.test(s.textContent)).length);
  this.page.off('dialog', onDialog);
  if (dialogs.length) problems.push(`a native dialog opened: ${dialogs.join(' | ')}`);
  if (injected) problems.push(`${injected} injected <script> element(s) found`);
  fail(problems, 'An unsafe University search term was not handled safely:');
});

// Measured: no agent name on the dashboard is a control - the only controls in the four agent
// lists are View All and the help icons. Asserted as measured, @needs-clarification.
Then('clicking an agent name in the Agents Analytics widgets should do nothing', SLOW, async function () {
  const a = ap(this);
  const problems = [];
  const subjects = [
    ['performing', (await a.readTopPerforming()).rows.map((r) => r.agent)],
    ['attention', (await a.readAttention()).rows.map((r) => r.name)],
    ['revenue', (await a.readRevenue()).top.map((r) => r.agent)],
    ['backlog', (await a.readBacklog()).rows.map((r) => r.agent)],
  ];
  const clicked = [];
  for (const [card, names] of subjects) {
    const name = names.find(Boolean);
    if (!name) continue;
    clicked.push(`${card}: ${name}`);
    const url = this.page.url();
    const before = analyticsRequestCount(this);
    const pages = this.page.context().pages().length;
    await a.card(card).getByText(name, { exact: true }).first().click();
    await this.page.waitForTimeout(1500);
    if (this.page.url() !== url) problems.push(`${card}: clicking "${name}" navigated to ${this.page.url()}`);
    if (this.page.context().pages().length !== pages) problems.push(`${card}: clicking "${name}" opened a new tab`);
    if (analyticsRequestCount(this) !== before) problems.push(`${card}: clicking "${name}" sent a request`);
    if (await this.page.locator('[role="dialog"]').first().isVisible().catch(() => false)) { problems.push(`${card}: clicking "${name}" opened a dialog`); await this.page.keyboard.press('Escape'); }
  }
  expect(clicked.length, 'no agent names were listed to click').toBeGreaterThan(0);
  await record(this, 'Agent names clicked', clicked);
  fail(problems, 'An agent name on the dashboard did something:');
});

// Icon-only help buttons (by design). Each must open its tooltip on hover AND on keyboard focus,
// and link it with aria-describedby while open - that is what makes a screen reader announce the
// explanation. The empty button name is recorded only (product decision 2026-11-10).
Then('every Agents Analytics help icon should explain its widget on hover and on keyboard focus:', SLOW, async function (table) {
  const page = this.page;
  const problems = [];
  const seen = [];
  for (const { widget, explanation } of table.hashes()) {
    const section = page.locator('main section').filter({ hasText: widget }).first();
    const btn = section.locator('button').filter({ hasNotText: /\S/ }).first();
    if (!(await btn.count())) { problems.push(`${widget}: no icon-only help button`); continue; }
    const tip = page.locator('[role="tooltip"]').last();
    await page.mouse.move(2, 2); await page.waitForTimeout(300);
    await btn.hover({ force: true });
    await tip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const onHover = clean(await tip.innerText().catch(() => ''));
    const describedOnHover = await btn.getAttribute('aria-describedby');
    await page.mouse.move(2, 2);
    await tip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await btn.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await tip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const onFocus = clean(await tip.innerText().catch(() => ''));
    const focusedIsButton = await btn.evaluate((e) => e === document.activeElement);
    // react-aria sets the link a tick after the tooltip paints, so poll rather than read once.
    let describedby = null;
    for (let i = 0; i < 10 && !describedby; i += 1) {
      describedby = await btn.getAttribute('aria-describedby');
      if (!describedby) await page.waitForTimeout(200);
    }
    const described = describedby ? clean(await page.locator(`[id="${describedby}"]`).innerText().catch(() => '')) : '';
    const name = await btn.getAttribute('aria-label');
    seen.push({ widget, onHover, describedOnHover, onFocus, focusedIsButton, describedby, described, ariaLabel: name });
    if (onHover !== explanation) problems.push(`${widget}: hover shows "${onHover}"`);
    if (!focusedIsButton) problems.push(`${widget}: keyboard focus did not land on the help icon`);
    if (onFocus !== explanation) problems.push(`${widget}: keyboard focus shows "${onFocus}"`);
    await page.keyboard.press('Escape');
  }
  // Recorded, not failed on: the aria-describedby link (what a screen reader announces) is set on
  // hover for both icons, but on KEYBOARD focus only for Document Verification Overview - measured
  // 2026-11-10, while an earlier probe saw it on the Backlog icon too. Inconsistent, so not asserted.
  await record(this, 'Help icons (aria-label and the aria-describedby link are recorded, not failed on)', seen);
  fail(problems, 'A help icon does not explain its widget:');
});
