// Step definitions for features/Agent_Portal/Dashboard.feature - the Agent Portal's /dashboard.
//
// >>> EVERY PHRASE IS WORDED "... dashboard ..." AND NONE REUSES AN EXISTING DASHBOARD PHRASE. <<<
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step (neither a pass nor a failure). Several dashboard phrases already exist and are
// bound to OTHER page objects - "I am on the Agent Dashboard" (referral-codes.js, drives
// ReferralCodesPage), "I should be on the Agent Dashboard" and the "View all" routing steps
// (invite-candidate.js). Reusing them would drive the wrong page object, so this file has its own.
//
// Exactly ONE phrase is reused, because it touches no page object:
//     Given I am logged in as an agent      (steps/active-candidate.js, via resilientSignIn)
//
// >>> WHAT THIS FILE WRITES, AND WHERE. <<< Almost nothing. Every dialog it opens it cancels, and
// every stub is a page.route() local to the scenario's own page. The exceptions are tagged and
// excluded from the default run:
//   @commits-decision  uploads ONE document as DOC_CANDIDATE and commits an IRREVERSIBLE agent
//                      decision on THAT document only - never on a pre-existing row.
//   @creates-agent     mints a throwaway agent, which can never be deleted.
//
// >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT { timeout }. <<< features/support/hooks.js calls
// setDefaultTimeout(60000), which overrides the profile's own timeout.

const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const DashboardPage = require('../pages/DashboardPage');
const { resilientSignIn } = require('../utils/resilientSignIn');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');
const { DocVerificationApi } = require('../utils/docVerificationApi');
const { resolveFixture } = require('../utils/docVerificationFixtures');
const docTestData = require('../test-data/document-verification/documents.json');

const STEP = 90000;
const SLOW = 180000;
const TABLE = 300000;
const PROVISION = 420000;
const AI = 300000;

const dash = (world) => world.pages.dashboard;
const av = (world) => world.pages.agentVerifications;
const ob = (world) => world.pages.candidateOnboarding;
const notes = (world) => {
  if (!world._dashboard) world._dashboard = {};
  return world._dashboard;
};

async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// Collect-then-throw: Cucumber abandons a scenario at its first failing step, so a table step that
// threw on its first bad row would hide whether the rest share a cause.
function failIf(problems, heading) {
  if (problems.length) throw new Error(`${heading}\n  - ${problems.join('\n  - ')}`);
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const signed = (n) => (Number(n) > 0 ? `+${n}` : String(n));
const close = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.01;

// The server key behind each card, and the request that fills it.
const CARD_KIND = {
  'Document Verification Queue': 'queue',
  'Requires Attention': 'attention',
  'Active Candidates': 'active',
};

// ------------------------------------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------------------------------------

// The first-time welcome modal is gated on something other than "has never had a candidate" (see
// the known-issue scenario), so it can appear for AGENT_EMAIL. It is dismissed and RECORDED, never
// silently - a modal that should not be there is a finding even when it is not the one under test.
async function dismissWelcomeIfShown(world) {
  const shown = await ob(world).isModalDisplayed('welcome', 5000);
  if (!shown) return false;
  const how = await ob(world).dismissOpenModal();
  await record(world, 'The first-time welcome modal was showing and was dismissed', how);
  return true;
}

async function openDashboardDismissed(world) {
  const loaded = await dash(world).openDashboard();
  const missing = Object.entries(loaded).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`The dashboard never received a response for: ${missing.join(', ')}`);
  }
  await dismissWelcomeIfShown(world);
  return loaded;
}

// Compare the KPI band against a stats payload. `monthly` additionally checks the comparison suffix,
// which is the only period the build has a correct label for.
function kpiProblems(k, body, { monthly = false } = {}) {
  const p = [];
  if (!body || !body.total) return ['no stats payload was captured to compare against'];
  if (k.total.valueRaw !== String(body.total.current)) {
    p.push(`Total Candidates reads "${k.total.valueRaw}", the server returned ${body.total.current}`);
  }
  for (const tile of k.tiles) {
    const src = body[tile.key];
    if (!src) {
      p.push(`the payload carries no "${tile.key}" for ${tile.label}`);
      continue;
    }
    if (tile.valueRaw !== String(src.current)) {
      p.push(`${tile.label} reads "${tile.valueRaw}", the server returned ${src.current}`);
    }
    const want = signed(src.difference);
    if (!tile.comparison || !tile.comparison.startsWith(`${want} `)) {
      p.push(`${tile.label}'s comparison reads "${tile.comparison}", expected it to start "${want} " (difference ${src.difference})`);
    }
    if (monthly && tile.comparison && !/ vs last month$/.test(tile.comparison)) {
      p.push(`${tile.label}'s comparison "${tile.comparison}" does not end "vs last month"`);
    }
  }
  const t = body.target || {};
  if (k.target.ratio !== `${t.achieved}/${t.target}`) {
    p.push(`the target ratio reads "${k.target.ratio}", the server returned ${t.achieved}/${t.target}`);
  }
  if (!close(k.target.percentAchieved, t.percent_achieved)) {
    p.push(`"${k.target.ofTargetLine}" does not state the server's percent_achieved ${t.percent_achieved}`);
  }
  if (!close(k.target.vsPercent, t.percent_vs_projection)) {
    p.push(`"${k.target.vsTargetLine}" does not state the server's percent_vs_projection ${t.percent_vs_projection}`);
  }
  const word = Number(t.percent_vs_projection) > 0 ? 'Ahead' : 'Behind';
  if (k.target.vsWord !== word) {
    p.push(`"${k.target.vsTargetLine}" says "${k.target.vsWord}", expected "${word}" for ${t.percent_vs_projection}%`);
  }
  return p;
}

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Stub the stats endpoint by editing the REAL response, so every field the stub does not mention is
// exactly what the server returned and the stub cannot invent a shape the API never produces.
async function stubStats(world, edit, { period = null } = {}) {
  await world.page.route(/\/core\/api\/v1\/candidate\/stats\//, async (route) => {
    const url = route.request().url();
    if (period && !new RegExp(`[?&]period=${period}(&|$)`).test(url)) return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    edit(body);
    return route.fulfill({ response: res, json: body });
  });
  notes(world).stubbed = true;
}

const LISTS = /\/core\/api\/v1\/candidate\/(documents\/all|requires-attention|active)\//;

// ------------------------------------------------------------------------------------------------
// Background and navigation
// ------------------------------------------------------------------------------------------------

Given('I am on the agent dashboard with any first-time modal dismissed', { timeout: STEP }, async function () {
  await openDashboardDismissed(this);
  notes(this).loadMark = dash(this).lastOpenRequestMark;
});

When('I reopen the dashboard', { timeout: STEP }, async function () {
  await openDashboardDismissed(this);
});

When('I return to the dashboard', { timeout: STEP }, async function () {
  await openDashboardDismissed(this);
});

// A NEW SESSION as far as the welcome modal is concerned: its suppression is a per-tab
// sessionStorage flag, so clearing it is exactly what a fresh sign-in does. Deliberately does NOT
// dismiss anything - the scenarios using it are asserting whether the modal comes.
When('I start a new dashboard session', { timeout: STEP }, async function () {
  await ob(this).clearWelcomeSuppression();
  await dash(this).openDashboard();
});

// ------------------------------------------------------------------------------------------------
// SECTION 1 - the shell
// ------------------------------------------------------------------------------------------------

Then('the dashboard heading should be displayed', async function () {
  await expect(dash(this).heading).toBeVisible({ timeout: 15000 });
});

Then('the dashboard should present these sections in reading order:', { timeout: STEP }, async function (table) {
  const want = table.raw().map((r) => r[0]);
  const boxes = await dash(this).sectionOrder();
  await record(this, 'Section positions', boxes);
  const missing = boxes.filter((b) => b.y === null).map((b) => b.section);
  failIf(missing.map((m) => `"${m}" is not rendered`), 'The dashboard is missing sections:');
  // Reading order: top to bottom, and left to right within a row (rows bucketed to 10px).
  const got = [...boxes]
    .sort((a, b) => Math.round(a.y / 10) - Math.round(b.y / 10) || a.x - b.x)
    .map((b) => b.section);
  expect(got, 'dashboard section reading order').toEqual(want);
});

Then('the dashboard should have requested each widget on load:', { timeout: STEP }, async function (table) {
  const d = dash(this);
  const reqs = d.requestsSince(notes(this).loadMark || 0).filter((r) => r.method === 'GET');
  const problems = [];
  const seen = {};
  for (const row of table.hashes()) {
    const hits = reqs.filter((r) => r.kind === row.widget);
    seen[row.widget] = hits.map((h) => h.url.replace(/^.*\/v1/, ''));
    const fragments = row['query must carry'].split('&');
    const matching = hits.filter((h) => fragments.every((f) => h.url.includes(f)));
    if (!matching.length) problems.push(`no ${row.widget} request carried "${row['query must carry']}" (saw ${JSON.stringify(seen[row.widget])})`);
    else if (matching.length > 1) problems.push(`${row.widget} was requested ${matching.length} times for one page load`);
  }
  await record(this, 'Widget requests made by the load', seen);
  failIf(problems, 'The dashboard did not load its widgets as expected:');
});

Then('the dashboard header should offer the language, notifications and account controls', async function () {
  const d = dash(this);
  const problems = [];
  if (!(await d.languageButton.isVisible())) problems.push('no language control');
  if (!(await d.bellButton.isVisible())) problems.push('no Notifications button');
  if (!(await d.profileMenuTrigger.isVisible())) problems.push('no account (avatar) button');
  failIf(problems, 'The dashboard header is missing controls:');
});

async function expandCandidates(world) {
  const nav = dash(world).sidebar;
  const active = nav.getByRole('link', { name: 'Active', exact: true });
  if (await active.isVisible().catch(() => false)) return;
  await nav.getByRole('button', { name: 'Candidates' }).first().click();
  await active.waitFor({ state: 'visible', timeout: 10000 });
}

async function sidebarLinks(world) {
  await expandCandidates(world);
  return dash(world)
    .sidebar.getByRole('link')
    .evaluateAll((as) => as.map((a) => ({ name: a.innerText.trim(), href: a.getAttribute('href') })));
}

Then('the dashboard sidebar should offer these links:', { timeout: STEP }, async function (table) {
  const links = await sidebarLinks(this);
  notes(this).sidebar = table.hashes();
  await record(this, 'Sidebar links', links);
  const problems = [];
  for (const row of table.hashes()) {
    const hit = links.find((l) => l.name === row.link);
    if (!hit) problems.push(`no "${row.link}" link`);
    else if (hit.href !== row.route) problems.push(`"${row.link}" links to "${hit.href}", expected "${row.route}"`);
  }
  failIf(problems, 'The sidebar does not offer the expected links:');
});

Then(
  'following each dashboard sidebar link should reach its route and the Dashboard link should return',
  { timeout: TABLE },
  async function () {
    const page = this.page;
    const problems = [];
    for (const row of notes(this).sidebar.filter((r) => r.link !== 'Dashboard')) {
      try {
        await expandCandidates(this);
        await dash(this).sidebar.getByRole('link', { name: row.link, exact: true }).click();
        await page.waitForURL((u) => u.pathname === row.route, { timeout: 30000 });
        await dash(this).sidebar.getByRole('link', { name: 'Dashboard', exact: true }).click();
        await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 30000 });
        await dash(this).heading.waitFor({ state: 'visible', timeout: 30000 });
      } catch (e) {
        problems.push(`${row.link}: ${e.message.split('\n')[0]} (at ${page.url()})`);
        await openDashboardDismissed(this).catch(() => {});
      }
    }
    failIf(problems, 'Sidebar navigation from the dashboard failed:');
  }
);

Then('the dashboard should not scroll horizontally at any of these viewports:', { timeout: SLOW }, async function (table) {
  const page = this.page;
  const original = page.viewportSize();
  const problems = [];
  const seen = [];
  try {
    for (const row of table.hashes()) {
      await page.setViewportSize({ width: Number(row.width), height: Number(row.height) });
      await page.waitForTimeout(1000);
      const o = await dash(this).horizontalOverflow();
      seen.push({ viewport: `${row.width}x${row.height}`, ...o });
      if (o.documentScrollWidth > o.viewportWidth + 1) {
        problems.push(`${row.width}x${row.height}: the page is ${o.documentScrollWidth}px wide`);
      }
      if (o.mainScrollWidth > o.mainClientWidth + 1) {
        problems.push(`${row.width}x${row.height}: <main> scrolls sideways (${o.mainScrollWidth} > ${o.mainClientWidth})`);
      }
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
  await record(this, 'Horizontal overflow per viewport', seen);
  failIf(problems, 'The dashboard scrolls horizontally:');
});

Then(
  'opening the dashboard in a session that is not signed in should land on the login page without loading any figures',
  { timeout: STEP },
  async function () {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const loaded = [];
    page.on('response', (r) => {
      if (/\/candidate\/(stats|active|requires-attention|documents\/all)\//.test(r.url()) && r.ok()) loaded.push(r.url());
    });
    try {
      await page.goto(dash(this).dashboardUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});
      const landed = page.url();
      await record(this, 'Unauthenticated /dashboard', { landed, figuresLoaded: loaded });
      expect(landed, 'an unauthenticated visit to /dashboard').toMatch(/\/login/);
      expect(loaded, 'dashboard data returned to a session with no sign-in').toEqual([]);
    } finally {
      await context.close().catch(() => {});
    }
  }
);

// ------------------------------------------------------------------------------------------------
// SECTION 2 - the KPI band
// ------------------------------------------------------------------------------------------------

Then('the dashboard period selector should show {string}', async function (label) {
  await expect(dash(this).periodTrigger).toHaveText(label, { timeout: 15000 });
});

Then('the KPI band should render the figures the server returned', { timeout: STEP }, async function () {
  const k = await dash(this).readKpis();
  // Compare against the response for the period ON SCREEN: a period already fetched is re-shown from
  // the app's cache with no request, so the newest stats response may belong to another period.
  await dash(this).flush();
  const spec = DashboardPage.PERIODS.find((p) => p.label === k.period);
  const re = spec ? new RegExp(`[?&]period=${spec.apiValue}(&|$)`) : null;
  const hits = (dash(this).responses || []).filter((r) => r.kind === 'stats' && (!re || re.test(r.url)));
  const body = hits.length ? hits[hits.length - 1].body : null;
  await record(this, 'KPI band vs stats payload', { rendered: { total: k.total, tiles: k.tiles, target: k.target }, server: body });
  failIf(kpiProblems(k, body, { monthly: true }), 'The KPI band does not render what the server returned:');
});

Then('the dashboard period selector should offer exactly these periods in order:', { timeout: STEP }, async function (table) {
  const want = table.raw().map((r) => r[0]);
  const options = await dash(this).readPeriodOptions();
  await record(this, 'Period options', options);
  expect(options.map((o) => o.label), 'period options').toEqual(want);
  const selected = options.filter((o) => o.selected).map((o) => o.label);
  expect(selected, 'the option marked selected').toEqual([(await dash(this).periodTrigger.innerText()).trim()]);
});

Then('choosing each dashboard period should query its own figures and render them:', { timeout: TABLE }, async function (table) {
  const problems = [];
  const seen = [];
  for (const row of table.hashes()) {
    const { response, sent } = await dash(this).choosePeriod(row.period);
    if (!response) {
      problems.push(`${row.period}: no stats response carrying period=${row['api value']} (sent ${JSON.stringify(sent)})`);
      continue;
    }
    const k = await dash(this).readKpis();
    seen.push({ period: row.period, sent, server: response.body, rendered: { total: k.total.valueRaw, tiles: k.tiles, target: k.target } });
    if (k.period !== row.period) problems.push(`${row.period}: the selector reads "${k.period}" afterwards`);
    kpiProblems(k, response.body).forEach((p) => problems.push(`${row.period}: ${p}`));
  }
  await record(this, 'Each period: what was sent, returned and rendered', seen);
  failIf(problems, 'The period selector does not query and render each period:');
});

// Every period, Monthly included, is checked against the labels it SHOULD carry - so the Monthly row
// is the control that proves the reader works, and a red Quarterly/Yearly/Year to Date row is the
// label failing to follow the selection rather than the step misreading the band.
Then("each dashboard period's KPI labels should name that period:", { timeout: TABLE }, async function (table) {
  const problems = [];
  const seen = [];
  for (const row of table.hashes()) {
    const { period } = row;
    await dash(this).choosePeriod(period);
    const k = await dash(this).readKpis();
    const comparisons = k.tiles.map((t) => ({ tile: t.label, text: t.comparison }));
    seen.push({ period, targetLine: k.target.ofTargetLine, comparisons: comparisons.map((c) => c.text) });
    if (k.target.targetLabel !== row['target label']) {
      problems.push(`${period}: the target line reads "${k.target.ofTargetLine}", expected "... of ${row['target label']}"`);
    }
    comparisons
      .filter((c) => !(c.text || '').endsWith(` ${row['comparison label']}`))
      .forEach((c) => problems.push(`${period}: ${c.tile} reads "${c.text}", expected it to end "${row['comparison label']}"`));
  }
  await record(this, 'Labels per period', seen);
  failIf(problems, 'The KPI labels do not follow the selected period:');
});

// ---- Are the figures right FOR THE PERIOD? (not only rendered as returned) ----

const SECTION_TITLES = ['Document Verification Queue', 'Requires Attention', 'Active Candidates'];
// Relative ages ("4m ago") tick with the clock while the period is switched, so they are masked -
// they are not something a period change could have caused.
const cardText = async (world, t) => norm(await dash(world).card(t).innerText()).replace(/\b\d+\s*(s|m|h|d|w|mo|y)\s+ago\b/g, '<age> ago');

// Select each period through the real selector and keep the payload it rendered.
async function figuresByPeriod(world, labels = DashboardPage.PERIODS.map((p) => p.label)) {
  const out = {};
  for (const label of labels) {
    const { response } = await dash(world).choosePeriod(label);
    if (!response || !response.body || !response.body.total) throw new Error(`${label}: no stats payload was captured`);
    out[label] = response.body;
  }
  return out;
}

Then('for every dashboard period the figures should add up:', { timeout: TABLE }, async function (table) {
  const labels = table.raw().map((r) => r[0]).filter((l) => l !== 'period');
  const figures = await figuresByPeriod(this, labels);
  const problems = [];
  for (const [period, b] of Object.entries(figures)) {
    for (const side of ['current', 'previous']) {
      const sum = b.active[side] + b.in_progress[side];
      if (b.total[side] !== sum) {
        problems.push(`${period}: Total ${side} is ${b.total[side]}, but Active + Onboarding in Progress = ${b.active[side]} + ${b.in_progress[side]} = ${sum}`);
      }
    }
    for (const key of ['total', 'active', 'in_progress', 'requires_attention']) {
      const t = b[key];
      if (t.difference !== t.current - t.previous) {
        problems.push(`${period}: ${key} difference is ${t.difference}, but current - previous = ${t.current} - ${t.previous} = ${t.current - t.previous}`);
      }
      if (t.current < 0 || t.previous < 0) problems.push(`${period}: ${key} reports a negative count (${t.current} / ${t.previous})`);
    }
    if (b.requires_attention.current > b.total.current) {
      problems.push(`${period}: Requires Attention (${b.requires_attention.current}) exceeds Total Candidates (${b.total.current})`);
    }
    const t = b.target || {};
    if (t.achieved !== b.total.current) problems.push(`${period}: the target's achieved is ${t.achieved}, but Total Candidates is ${b.total.current}`);
    if (t.target > 0 && Math.abs((t.achieved / t.target) * 100 - t.percent_achieved) > 0.5) {
      problems.push(`${period}: percent_achieved is ${t.percent_achieved}, but ${t.achieved}/${t.target} = ${((t.achieved / t.target) * 100).toFixed(2)}%`);
    }
  }
  await record(this, 'Figures per period', figures);
  failIf(problems, "The period figures do not add up:");
});

When('I read the dashboard figures for every period', { timeout: TABLE }, async function () {
  notes(this).periodFigures = await figuresByPeriod(this);
});

// Calendar-aligned windows nest: this month sits inside this quarter, inside this year to date,
// inside the year. Only CURRENT figures nest - last month is not always inside last quarter.
Then('each dashboard tile should never decrease from Monthly to Quarterly to Year to Date to Yearly', async function () {
  const f = notes(this).periodFigures;
  const order = ['Monthly', 'Quarterly', 'Year to Date', 'Yearly'];
  const problems = [];
  const seen = {};
  for (const key of ['total', 'active', 'in_progress', 'requires_attention']) {
    const values = order.map((p) => f[p][key].current);
    seen[key] = Object.fromEntries(order.map((p, i) => [p, values[i]]));
    for (let i = 1; i < order.length; i += 1) {
      if (values[i] < values[i - 1]) problems.push(`${key}: ${order[i]} reports ${values[i]}, fewer than ${order[i - 1]}'s ${values[i - 1]}`);
    }
  }
  await record(this, 'Current figures, narrowest period first', seen);
  failIf(problems, 'A wider period reports fewer candidates than a narrower one:');
});

Then("no period should report more candidates than the agent's listings hold:", { timeout: STEP }, async function (table) {
  const f = notes(this).periodFigures;
  const listingApi = {
    '/candidates/active': 'candidate/active/',
    '/candidates/in-progress': 'candidate/in-progress/',
    '/candidates/requires-attention': 'candidate/requires-attention/',
  };
  const api = new DocVerificationApi();
  await api.login(process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD, 'agent');
  const problems = [];
  const seen = [];
  for (const row of table.hashes()) {
    const key = TILE_KEY[row.tile];
    const res = await api.request('GET', `${listingApi[row.listing]}?page=1&page_size=1`);
    const held = res.body && res.body.count;
    if (typeof held !== 'number') {
      problems.push(`${row.listing}: could not read the listing count (HTTP ${res.status})`);
      continue;
    }
    for (const [period, b] of Object.entries(f)) {
      seen.push({ tile: row.tile, period, reported: b[key].current, listing: held });
      if (b[key].current > held) problems.push(`${row.tile}: ${period} reports ${b[key].current}, but ${row.listing} holds only ${held}`);
    }
  }
  await record(this, 'Period figures vs what the agent holds', seen);
  failIf(problems, 'A period reports more candidates than the agent holds:');
});

Given('I have noted what each dashboard section card shows', { timeout: STEP }, async function () {
  const cards = {};
  for (const t of SECTION_TITLES) cards[t] = await cardText(this, t);
  notes(this).cardsBefore = cards;
  notes(this).cardsReqMark = dash(this).requestCount();
});

Then('only the dashboard figures should have been requested since the cards were noted', async function () {
  const reqs = dash(this).requestsSince(notes(this).cardsReqMark);
  await record(this, 'Requests while switching period', reqs.map((r) => `${r.method} ${r.kind || '-'} ${r.url}`));
  const stats = reqs.filter((r) => r.kind === 'stats');
  const others = reqs.filter((r) => ['queue', 'attention', 'active', 'me'].includes(r.kind) || r.method !== 'GET');
  expect(stats.length, 'a figures request for the newly chosen period').toBeGreaterThan(0);
  expect(others.map((r) => `${r.method} ${r.url}`), 'section-card or write requests caused by a period change').toEqual([]);
});

Then('each dashboard section card should still show what it showed before', async function () {
  const before = notes(this).cardsBefore;
  const changed = [];
  for (const t of SECTION_TITLES) {
    const now = await cardText(this, t);
    if (now !== before[t]) changed.push(`${t}: was "${before[t].slice(0, 160)}", now "${now.slice(0, 160)}"`);
  }
  failIf(changed, 'A period change altered a section card it does not scope:');
});

Then('hovering the dashboard target icon should show the Target Overview explanation', { timeout: STEP }, async function () {
  const tip = norm(await dash(this).hoverTargetInfo());
  await record(this, 'Target tooltip', tip);
  const want = DashboardPage.TARGET_TOOLTIP;
  expect(tip, 'target tooltip').toBe(norm(`${want.heading} ${want.body}`));
});

When('I choose the {string} dashboard period',{ timeout: STEP }, async function (label) {
  const { response } = await dash(this).choosePeriod(label);
  expect(response, `a stats response for ${label}`).toBeTruthy();
});

Then('the dashboard URL should carry no query parameters', async function () {
  const url = new URL(this.page.url());
  await record(this, 'Dashboard URL', url.href);
  expect(url.pathname).toBe('/dashboard');
  expect(url.search, 'dashboard query string').toBe('');
});

Then('the latest dashboard figures request should carry {string}', async function (fragment) {
  const reqs = dash(this).requests.filter((r) => r.kind === 'stats');
  const last = reqs[reqs.length - 1];
  await record(this, 'Latest stats request', last && last.url);
  await record(this, 'Question for the PO', 'The chosen period is held in memory only: it is not written to the URL, so a reload, a shared link or the browser Back button always reopens on Monthly. Is that intended?');
  expect(last && last.url, 'latest stats request').toContain(fragment);
});

Given('the dashboard figures will fail to load', async function () {
  await this.page.route(/\/core\/api\/v1\/candidate\/stats\//, (route) =>
    route.fulfill({ status: 500, json: { detail: 'stubbed failure' } })
  );
});

Then('every dashboard KPI tile should show {string} with the note {string}', async function (value, note) {
  const k = await dash(this).readKpis();
  await record(this, 'KPI band after a failed load', k.lines);
  const problems = [];
  if (k.total.valueRaw !== value) problems.push(`Total Candidates reads "${k.total.valueRaw}"`);
  for (const t of k.tiles) {
    if (t.valueRaw !== value) problems.push(`${t.label} reads "${t.valueRaw}"`);
    if (t.comparison !== note) problems.push(`${t.label}'s note reads "${t.comparison}"`);
  }
  failIf(problems, `Not every KPI tile shows "${value}" / "${note}" after a failed load:`);
});

Then('no dashboard KPI tile should show a zero', async function () {
  const k = await dash(this).readKpis();
  const zeros = [{ label: 'Total Candidates', value: k.total.value }, ...k.tiles].filter((t) => t.value === 0).map((t) => t.label);
  expect(zeros, 'tiles rendering 0 after a failed load').toEqual([]);
});

// Product rule: with no figures to show the target line falls back to zero, not a blank. Each part
// is checked separately and reported together, since they render from different fields.
Then('the dashboard target line should fall back to zero', async function () {
  const k = await dash(this).readKpis();
  await record(this, 'Target line after a failed load', k.target);
  const problems = [];
  if (k.target.percentAchieved !== 0) problems.push(`"${k.target.ofTargetLine}" should state 0% of target`);
  if (k.target.ratio !== '0/0') problems.push(`the ratio reads "${k.target.ratio}", expected "0/0"`);
  if (k.target.vsTargetLine && k.target.vsPercent !== null && k.target.vsPercent !== 0) {
    problems.push(`"${k.target.vsTargetLine}" states ${k.target.vsPercent}% where nothing was loaded`);
  }
  failIf(problems, 'After the figures failed to load, the target line does not fall back to zero:');
});

const TILE_KEY = Object.fromEntries(DashboardPage.KPI_TILES.map((t) => [t.label, t.key]));

Given('the Monthly dashboard figures will report these differences:', async function (table) {
  const rows = table.hashes();
  await stubStats(
    this,
    (body) => {
      for (const r of rows) {
        body[TILE_KEY[r.tile]] = { current: Number(r.current), previous: Number(r.previous), difference: Number(r.difference) };
      }
    },
    { period: 'monthly' }
  );
});

Then('the dashboard comparison lines should read:', async function (table) {
  const k = await dash(this).readKpis();
  const problems = [];
  for (const row of table.hashes()) {
    const t = k.tiles.find((x) => x.label === row.tile);
    if (!t) problems.push(`no "${row.tile}" tile`);
    else if (t.comparison !== row.comparison) problems.push(`${row.tile} reads "${t.comparison}", expected "${row.comparison}"`);
  }
  failIf(problems, 'The comparison lines are not signed as expected:');
});

Given('the Monthly dashboard figures will report no new candidates', async function () {
  await stubStats(
    this,
    (body) => {
      for (const key of ['total', 'active', 'in_progress', 'requires_attention']) body[key].current = 0;
    },
    { period: 'monthly' }
  );
});

Given('the Monthly dashboard figures will report {int} new candidate(s)', async function (n) {
  await stubStats(
    this,
    (body) => {
      body.total.current = n;
      body.in_progress.current = n;
    },
    { period: 'monthly' }
  );
});

Then('the agent should hold candidates according to the Active Candidates card', async function () {
  const body = await dash(this).latestBody('active');
  await record(this, 'Candidates the agent holds (Active Candidates card)', { count: body && body.count });
  expect(body && body.count, 'active candidates the agent holds').toBeGreaterThan(0);
});

Then('the first-time welcome modal should not be displayed on the dashboard', { timeout: STEP }, async function () {
  // An ABSENCE, so a window is watched - "not visible" is also true of a modal not rendered yet.
  const shown = await ob(this).isModalDisplayed('welcome', 8000);
  const stats = await dash(this).latestBody('stats');
  await record(this, 'Welcome modal on an agent holding candidates', {
    shown,
    monthlyTotal: stats && stats.total && stats.total.current,
    activeCandidates: ((await dash(this).latestBody('active')) || {}).count,
    rule: 'Product rule (2026-10-01): the welcome modal is MONTHLY - shown while the current month has no invited/onboarded candidate, and not again that month once one is added.',
  });
  expect(shown, 'the welcome modal must not show once the current month already has a candidate').toBe(false);
});

// ------------------------------------------------------------------------------------------------
// SECTION 3 - the Document Verification Queue
// ------------------------------------------------------------------------------------------------

Then('the {string} card count should equal the server\'s count', { timeout: STEP }, async function (title) {
  const kind = CARD_KIND[title];
  const body = await dash(this).latestBody(kind);
  const c = await dash(this).cardCount(title);
  await record(this, `${title} count`, { rendered: c, server: body && body.count });
  expect(body, `a ${kind} payload`).toBeTruthy();
  if (body.count === 0) {
    expect(c, `${title} with nothing to show renders no count`).toBeNull();
  } else {
    expect(c && c.value, `${title} count`).toBe(body.count);
  }
});

Then('the Document Verification Queue should list the server\'s documents in the server\'s order', async function () {
  const body = await dash(this).latestBody('queue');
  const rows = await dash(this).readQueueRows();
  const results = (body && body.results) || [];
  await record(this, 'Queue rows vs server', { rows, server: results.map((r) => ({ file: r.file_name, uploaded_on: r.uploaded_on, by: r.user && r.user.name, status: r.status })) });
  const problems = [];
  const want = Math.min(results.length, DashboardPage.CARD_PAGE_SIZE['Document Verification Queue']);
  if (rows.length !== want) problems.push(`${rows.length} rows rendered, the server returned ${results.length} (page size 5)`);
  results.slice(0, want).forEach((r, i) => {
    const row = rows[i] || {};
    if (r.status !== 'AWAITING') problems.push(`server row ${i} has status ${r.status}`);
    if (row.fileName !== r.file_name) problems.push(`row ${i} names "${row.fileName}", the server's row ${i} is "${r.file_name}"`);
    if (row.uploadedOn !== r.uploaded_on) problems.push(`row ${i} reads "Uploaded on ${row.uploadedOn}", the server says ${r.uploaded_on}`);
    if (row.uploader !== (r.user && r.user.name)) problems.push(`row ${i} names uploader "${row.uploader}", the server says "${r.user && r.user.name}"`);
    if (!(row.actions || []).includes('Review')) problems.push(`row ${i} offers no Review`);
  });
  failIf(problems, 'The Document Verification Queue does not match the server:');
});

When('I review the first document in the dashboard queue', { timeout: STEP }, async function () {
  const rows = await dash(this).readQueueRows();
  expect(rows.length, 'documents in the dashboard queue').toBeGreaterThan(0);
  const body = await dash(this).latestBody('queue');
  notes(this).reviewed = { row: rows[0], server: body.results[0] };
  notes(this).reviewUrl = this.page.url();
  notes(this).reviewReqMark = dash(this).requestCount();
  await dash(this).openReview(0);
  await av(this).panel.waitFor({ state: 'visible', timeout: 30000 });
});

Then('the review panel should describe the document from the dashboard row I reviewed', { timeout: STEP }, async function () {
  const { row } = notes(this).reviewed;
  const p = await av(this).readPanel();
  const up = await av(this).readPanelUploader();
  await record(this, 'Review panel vs dashboard row', { row, panel: { ...p, fullText: undefined }, uploader: up });
  const problems = [];
  if (p.documentName !== row.fileName) problems.push(`panel names "${p.documentName}", the row "${row.fileName}"`);
  if (p.dateUploaded !== row.uploadedOn) problems.push(`panel dates it "${p.dateUploaded}", the row "${row.uploadedOn}"`);
  if (p.status !== 'Needs Review') problems.push(`panel status "${p.status}", expected "Needs Review" for a queue document`);
  if (up.name !== row.uploader) problems.push(`panel uploader "${up.name}", the row "${row.uploader}"`);
  failIf(problems, 'The review panel does not describe the document that was reviewed:');
});

Then('the review panel should offer Approve and Request Revision', async function () {
  const offered = await av(this).decisionControlsOffered();
  expect(offered, 'decision controls on a Needs Review document').toEqual({ approve: true, requestRevision: true });
});

Then('opening the review panel should not have changed the dashboard URL', async function () {
  expect(this.page.url()).toBe(notes(this).reviewUrl);
});

Then('closing the review panel should return to the intact dashboard by each of these routes:', { timeout: SLOW }, async function (table) {
  const problems = [];
  for (const [route] of table.raw()) {
    if (!(await av(this).panelOpen())) {
      await dash(this).openReview(0);
      await av(this).panel.waitFor({ state: 'visible', timeout: 30000 });
    }
    if (route === 'Close button') await av(this).closePanel();
    else if (route === 'Escape') await av(this).closePanelByEscape();
    else throw new Error(`Unknown close route "${route}"`);
    if (await av(this).panelOpen()) problems.push(`${route}: the panel is still open`);
    if (!(await dash(this).heading.isVisible())) problems.push(`${route}: the dashboard heading is gone`);
    if ((await dash(this).queueRows().count()) === 0) problems.push(`${route}: the queue lost its rows`);
  }
  failIf(problems, 'Closing the review panel did not return to the intact dashboard:');
});

When('I activate the file name of the first document in the dashboard queue', { timeout: STEP }, async function () {
  const rows = await dash(this).readQueueRows();
  notes(this).reviewed = { row: rows[0] };
  notes(this).reaction = await dash(this).watchForReaction(() => dash(this).clickQueueFileName(0));
});

// Product rule (2026-10-01): the file name is not an entry point - only Review opens the document.
// Asserted over a WINDOW (watchForReaction), because "nothing opened" is also true of a panel that has
// not rendered yet.
Then('activating the queue file name should not have opened anything', async function () {
  const r = notes(this).reaction;
  await record(this, 'What activating the file name did', r);
  expect(r.reacted, `the queue file name must not open anything, but it produced ${JSON.stringify(r.reaction)}`).toBe(false);
  expect(await av(this).panelOpen(), 'the review panel after clicking only the file name').toBe(false);
});

// ------------------------------------------------------------------------------------------------
// SECTION 4 - Requires Attention
// ------------------------------------------------------------------------------------------------

function ageProblem(rendered, iso, now = Date.now()) {
  const days = Math.floor((now - Date.parse(iso)) / 86400000);
  if (days >= 1) {
    const m = /^(\d+)d ago$/.exec(rendered || '');
    if (!m) return `"${rendered}" is not "<n>d ago" for an issue ${days} days old`;
    if (Math.abs(Number(m[1]) - days) > 1) return `"${rendered}" for an issue ${days} days old (${iso})`;
    return null;
  }
  return /^(\d+)(h|m|s) ago$|^just now$/i.test(rendered || '') ? null : `"${rendered}" for an issue under a day old (${iso})`;
}

Then('the Requires Attention card should list the server\'s candidates with their severity, issue, initials and age', async function () {
  const body = await dash(this).latestBody('attention');
  const rows = await dash(this).readAttentionRows();
  const results = (body && body.results) || [];
  await record(this, 'Requires Attention rows vs server', { rows, server: results });
  const problems = [];
  const want = Math.min(results.length, DashboardPage.CARD_PAGE_SIZE['Requires Attention']);
  if (rows.length !== want) problems.push(`${rows.length} rows rendered, the server returned ${results.length}`);
  results.slice(0, want).forEach((r, i) => {
    const row = rows[i] || {};
    if (row.name !== r.name) problems.push(`row ${i} names "${row.name}", the server "${r.name}"`);
    if (row.severity !== r.severity) problems.push(`row ${i} (${r.name}) severity "${row.severity}", the server "${r.severity}"`);
    if (row.issue !== r.issue) problems.push(`row ${i} (${r.name}) issue "${row.issue}", the server "${r.issue}"`);
    if (row.initials !== initialsOf(r.name)) problems.push(`row ${i} initials "${row.initials}", expected "${initialsOf(r.name)}"`);
    const age = ageProblem(row.when, r.last_updated);
    if (age) problems.push(`row ${i} (${r.name}) age ${age}`);
  });
  failIf(problems, 'The Requires Attention card does not match the server:');
});

// ------------------------------------------------------------------------------------------------
// SECTION 5 - Active Candidates
// ------------------------------------------------------------------------------------------------

Then('the Active Candidates grid should have exactly these columns in order:', async function (table) {
  expect(await dash(this).readActiveColumns()).toEqual(table.raw().map((r) => r[0]));
});

Then('every Active Candidates row should match the server\'s record for that candidate', async function () {
  const body = await dash(this).latestBody('active');
  const rows = await dash(this).readActiveRows();
  const results = (body && body.results) || [];
  await record(this, 'Active rows vs server', { rows, server: results });
  const problems = [];
  const want = Math.min(results.length, DashboardPage.CARD_PAGE_SIZE['Active Candidates']);
  if (rows.length !== want) problems.push(`${rows.length} rows rendered, the server returned ${results.length}`);
  for (const row of rows) {
    const r = results.find((x) => x.email === row.email);
    if (!r) {
      problems.push(`row "${row.email}" is not among the candidates the server returned`);
      continue;
    }
    const sub = DashboardPage.SUBSCRIPTION_LABELS[r.subscription_status] || r.subscription_status;
    const checks = [
      ['name', row.name, r.full_name],
      ['Account Verification', row.verification, r.is_verified ? 'Verified' : 'Unverified'],
      ['Pending Documents', row.pendingDocuments, String(r.pending_documents_count)],
      ['Subscription Status', row.subscription, sub],
      ['Last Activity', row.lastActivity, r.last_login],
    ];
    checks.filter(([, a, b]) => a !== b).forEach(([f, a, b]) => problems.push(`${row.email}: ${f} reads "${a}", the server says "${b}"`));
  }
  failIf(problems, 'The Active Candidates rows do not match the server:');
});

Then('every Active Candidates row should offer exactly View and Reminder History', async function () {
  const rows = await dash(this).readActiveRows();
  const bad = rows.filter((r) => JSON.stringify(r.actions.map((a) => a.name)) !== JSON.stringify(['View', 'Reminder History']));
  expect(bad.map((r) => `${r.email}: ${r.actions.map((a) => a.name).join(', ')}`)).toEqual([]);
});

Then('the Active Candidates rows should be in the server\'s order', async function () {
  const body = await dash(this).latestBody('active');
  const rendered = (await dash(this).readActiveRows()).map((r) => r.email);
  const server = body.results.slice(0, rendered.length).map((r) => r.email);
  await record(this, 'Row order', { rendered, server, note: 'The grid re-sorts each page by name, so the newest candidates the server put first are not shown first. Same behaviour as the Verifications queue.' });
  expect(rendered, 'Active Candidates order').toEqual(server);
});

When('I view the first candidate on the Active Candidates card', { timeout: STEP }, async function () {
  const rows = await dash(this).readActiveRows();
  const body = await dash(this).latestBody('active');
  const r = body.results.find((x) => x.email === rows[0].email);
  notes(this).viewed = r;
  await dash(this).activeRowFor(rows[0].email).getByRole('button', { name: 'View', exact: true }).click();
  await this.page.waitForURL(/\/candidates\/\d+\/view-profile/, { timeout: 45000 });
});

Then('the dashboard should have opened the profile of the candidate on that row', async function () {
  const id = (/\/candidates\/(\d+)\/view-profile/.exec(this.page.url()) || [])[1];
  await record(this, 'View from the dashboard', { opened: this.page.url(), row: notes(this).viewed });
  expect(Number(id), `the profile opened for ${notes(this).viewed.email}`).toBe(notes(this).viewed.id);
});

When('I go back in the browser', { timeout: STEP }, async function () {
  await this.page.goBack({ waitUntil: 'domcontentloaded' });
});

Then('the agent dashboard should be displayed with its Active Candidates card', { timeout: STEP }, async function () {
  await this.page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 30000 });
  await expect(dash(this).heading).toBeVisible({ timeout: 30000 });
  await expect(dash(this).activeGrid()).toBeVisible({ timeout: 30000 });
});

Then('each Active Candidates row\'s Reminder History should be enabled exactly when the server says it has reminders', async function () {
  const body = await dash(this).latestBody('active');
  const rows = await dash(this).readActiveRows();
  const problems = [];
  for (const row of rows) {
    const r = body.results.find((x) => x.email === row.email);
    const btn = row.actions.find((a) => a.name === 'Reminder History');
    if (!r || !btn) continue;
    if (btn.disabled === Boolean(r.has_reminders)) problems.push(`${row.email}: Reminder History is ${btn.disabled ? 'disabled' : 'enabled'} while has_reminders is ${r.has_reminders}`);
  }
  failIf(problems, 'Reminder History enablement does not follow has_reminders:');
});

When('I open Reminder History for the first Active Candidates row that has reminders', { timeout: STEP }, async function () {
  const body = await dash(this).latestBody('active');
  const rows = await dash(this).readActiveRows();
  const row = rows.find((x) => (body.results.find((r) => r.email === x.email) || {}).has_reminders);
  expect(row, 'a row whose candidate has reminders').toBeTruthy();
  notes(this).reminderFor = row;
  await dash(this).activeRowFor(row.email).getByRole('button', { name: 'Reminder History', exact: true }).click();
  await this.page.locator('[role="dialog"]:visible').filter({ hasText: 'Reminder History' }).first().waitFor({ state: 'visible', timeout: 20000 });
});

Then('the Reminder History dialog should name that dashboard candidate', async function () {
  const dialog = this.page.locator('[role="dialog"]:visible').filter({ hasText: 'Reminder History' }).first();
  const lines = (await dialog.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  await record(this, 'Reminder History dialog', lines.slice(0, 8));
  expect(lines[0], 'the dialog title').toBe(notes(this).reminderFor.name);
});

When('I close the dashboard Reminder History dialog', async function () {
  const dialog = this.page.locator('[role="dialog"]:visible').filter({ hasText: 'Reminder History' }).first();
  const closeBtn = dialog.getByRole('button', { name: 'Close' });
  if (await closeBtn.count()) await closeBtn.first().click();
  else await this.page.keyboard.press('Escape');
});

Then('no dashboard dialog should be open', async function () {
  await expect(this.page.locator('[role="dialog"]:visible')).toHaveCount(0, { timeout: 10000 });
});

// ------------------------------------------------------------------------------------------------
// SECTION 6 - empty and failed cards
// ------------------------------------------------------------------------------------------------

Given('the dashboard section lists will come back empty', async function () {
  await this.page.route(LISTS, (route) => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
});

Then('each dashboard section card should show its own empty state:', { timeout: STEP }, async function (table) {
  const problems = [];
  const seen = {};
  for (const row of table.hashes()) {
    const e = await dash(this).readEmptyState(row.card);
    seen[row.card] = { ...e, count: await dash(this).cardCount(row.card), viewAll: await dash(this).cardHasViewAll(row.card) };
    if (!e.present) {
      problems.push(`${row.card}: no "${row.heading}" (card reads ${JSON.stringify(e.lines.slice(0, 6))})`);
      continue;
    }
    if (e.body !== row.body) problems.push(`${row.card}: body reads "${e.body}"`);
    const wantCtas = row.cta ? [row.cta] : [];
    if (JSON.stringify(e.ctas) !== JSON.stringify(wantCtas)) problems.push(`${row.card}: offers ${JSON.stringify(e.ctas)}, expected ${JSON.stringify(wantCtas)}`);
    if (seen[row.card].count) problems.push(`${row.card}: still shows a count "${seen[row.card].count.raw}"`);
    if (seen[row.card].viewAll) problems.push(`${row.card}: still offers View all with nothing to view`);
  }
  await record(this, 'Empty states', seen);
  failIf(problems, 'Not every card shows its own empty state:');
});

When('I click {string} on the empty Active Candidates card', async function (label) {
  await dash(this).card('Active Candidates').getByRole('button', { name: label, exact: true }).click();
});

Then('the onboarding method chooser should open over the dashboard', { timeout: STEP }, async function () {
  expect(await ob(this).isModalDisplayed('chooser', 20000), 'the onboarding method chooser').toBe(true);
  expect(new URL(this.page.url()).pathname).toBe('/dashboard');
  await ob(this).dismissOpenModal();
});

// ------------------------------------------------------------------------------------------------
// SECTION 7 - the header
// ------------------------------------------------------------------------------------------------

Then('the dashboard avatar should show the signed-in agent\'s initials', async function () {
  const me = await dash(this).latestBody('me');
  const want = `${(me.firstname || ' ')[0]}${(me.lastname || ' ')[0]}`.toUpperCase();
  expect(await dash(this).avatarInitials()).toBe(want);
});

Then('the dashboard account menu should name the signed-in agent and offer exactly:', { timeout: STEP }, async function (table) {
  const me = await dash(this).latestBody('me');
  const menu = await dash(this).readAvatarMenu();
  await record(this, 'Account menu', menu);
  const problems = [];
  if (JSON.stringify(menu.items) !== JSON.stringify(table.raw().map((r) => r[0]))) problems.push(`offers ${JSON.stringify(menu.items)}`);
  if (!menu.text.toLowerCase().includes(`${me.firstname} ${me.lastname}`.toLowerCase())) problems.push(`does not name "${me.firstname} ${me.lastname}"`);
  if (!menu.text.toLowerCase().includes(String(me.email).toLowerCase())) problems.push(`does not show "${me.email}"`);
  await this.page.keyboard.press('Escape');
  failIf(problems, 'The account menu is not as expected:');
});

When('I choose {string} from the dashboard account menu', { timeout: STEP }, async function (label) {
  notes(this).writeMark = dash(this).requestCount();
  await dash(this).chooseAvatarItem(label);
});

Then('the dashboard should have navigated to {string}', { timeout: STEP }, async function (pathname) {
  await this.page.waitForURL((u) => u.pathname === pathname, { timeout: 30000 });
});

Then('the Referral Codes section should be scrolled into view at {string}', { timeout: STEP }, async function (hash) {
  await this.page.waitForURL((u) => u.hash === hash, { timeout: 15000 });
  await this.page.waitForTimeout(1200);
  const box = await dash(this).card('Referral Codes').boundingBox();
  const vh = this.page.viewportSize().height;
  await record(this, 'Referral Codes position after the menu item', { url: this.page.url(), box, viewportHeight: vh });
  expect(box && box.y < vh && box.y + box.height > 0, 'Referral Codes is in the viewport').toBe(true);
});

const becomeDialog = (world) =>
  world.page.locator('[role="dialog"]:visible').filter({ hasText: DashboardPage.BECOME_CANDIDATE.heading }).first();

Then('the Become a Candidate confirmation should be displayed with its exact wording', { timeout: STEP }, async function () {
  const d = becomeDialog(this);
  await d.waitFor({ state: 'visible', timeout: 15000 });
  const lines = (await d.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  const buttons = await d.getByRole('button').evaluateAll((bs) => bs.map((b) => b.innerText.trim()).filter(Boolean));
  await record(this, 'Become a Candidate confirmation', { lines, buttons });
  const spec = DashboardPage.BECOME_CANDIDATE;
  const problems = [];
  if (!spec.heading.test(lines[0] || '')) problems.push(`heading reads "${lines[0]}"`);
  if (!lines.includes(spec.body)) problems.push('the explanation is not the expected wording');
  if (JSON.stringify(buttons) !== JSON.stringify([spec.cancel, spec.confirm])) problems.push(`buttons are ${JSON.stringify(buttons)}`);
  failIf(problems, 'The Become a Candidate confirmation is not as expected:');
});

When('I choose {string} in the Become a Candidate confirmation', async function (label) {
  await becomeDialog(this).getByRole('button', { name: label, exact: true }).click();
});

Then('no dashboard write request should have been sent', async function () {
  const writes = dash(this).writesSince(notes(this).writeMark || 0);
  expect(writes.map((w) => `${w.method} ${w.url}`)).toEqual([]);
});

Then('the agent should still be signed in as an agent on the dashboard', { timeout: STEP }, async function () {
  expect(new URL(this.page.url()).pathname).toBe('/dashboard');
  await openDashboardDismissed(this);
  const me = await dash(this).latestBody('me');
  expect(me && me.active_role, 'active role after Stay Here').toBe('AGENT');
});

When('I open the dashboard notifications panel', { timeout: STEP }, async function () {
  notes(this).bellMark = dash(this).responseMark();
  await dash(this).bellButton.click();
  await this.page.locator('[role="dialog"]:visible').filter({ hasText: /Unread/ }).first().waitFor({ state: 'visible', timeout: 20000 });
});

Then('the dashboard notifications panel\'s unread count should equal the server\'s unread count', { timeout: STEP }, async function () {
  const panel = this.page.locator('[role="dialog"]:visible').filter({ hasText: /Unread/ }).first();
  const m = /Unread\s*\((\d+)\)/.exec(await panel.innerText());
  const server = await dash(this).latestBody('unread');
  await record(this, 'Unread count', { rendered: m && m[1], server: server && server.count });
  expect(m, 'an "Unread (n)" tab').toBeTruthy();
  expect(Number(m[1])).toBe(server.count);
  await this.page.keyboard.press('Escape');
});

// ------------------------------------------------------------------------------------------------
// SECTION 8 - a brand-new agent
// ------------------------------------------------------------------------------------------------

Given('I am signed in on the dashboard as a brand-new throwaway agent', { timeout: PROVISION }, async function () {
  const agent = await provisionAgentWithoutPromo(this.browser, { label: 'dashboard-zero', firstName: 'Dashzero', tagPrefix: 'dashzero' });
  notes(this).throwaway = agent;
  await record(this, 'Provisioned a throwaway agent (it cannot be deleted)', { email: agent.email, name: agent.name });
  // Replace the Background's AGENT_EMAIL session with the new agent's.
  await this.context.clearCookies();
  await this.page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
  });
  await resilientSignIn(this, agent.email, agent.password, { landedOn: /\/dashboard|\/getting-started/ });
  await dash(this).openDashboard();
});

Then('the first-time welcome modal should be displayed on the dashboard', { timeout: STEP }, async function () {
  const shown = await ob(this).isModalDisplayed('welcome', 20000);
  const stats = await dash(this).latestBody('stats');
  await record(this, 'Welcome modal', { shown, monthlyNewCandidates: stats && stats.total && stats.total.current });
  expect(shown, 'the welcome modal while the current month has no new candidate').toBe(true);
});

When('I dismiss the first-time welcome modal on the dashboard', async function () {
  const r = await ob(this).dismissOpenModal();
  expect(r.dismissed, `dismissing the welcome modal (${JSON.stringify(r)})`).toBe(true);
});

Then('every dashboard KPI tile should show 0 for every period', { timeout: TABLE }, async function () {
  const problems = [];
  const seen = [];
  for (const { label } of DashboardPage.PERIODS) {
    if ((await dash(this).periodTrigger.innerText()).trim() !== label) await dash(this).choosePeriod(label);
    const k = await dash(this).readKpis();
    seen.push({ period: label, total: k.total.valueRaw, tiles: k.tiles.map((t) => `${t.label}=${t.valueRaw} (${t.comparison})`), target: k.target });
    if (k.total.value !== 0) problems.push(`${label}: Total Candidates reads "${k.total.valueRaw}"`);
    k.tiles.filter((t) => t.value !== 0).forEach((t) => problems.push(`${label}: ${t.label} reads "${t.valueRaw}"`));
  }
  await record(this, 'A brand-new agent\'s KPI band per period', seen);
  failIf(problems, 'A brand-new agent\'s dashboard reports candidates it does not have:');
});

Then('the dashboard Agent Code should be the signed-in agent\'s own code', async function () {
  const me = await dash(this).latestBody('me');
  const lines = (await dash(this).card('Referral Codes').innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  const shown = lines[lines.indexOf('Agent Code') + 1];
  expect(shown, 'the Agent Code on the dashboard').toBe(me.agent_code);
});

// ------------------------------------------------------------------------------------------------
// SECTION 9 - decisions committed from the dashboard
// ------------------------------------------------------------------------------------------------

// Fixtures the AI is measured to leave in Needs Review, tried in order. ORG-03 is the undecidable
// document the status-lifecycle scenarios use (unrecognised institution, everything else clean);
// EDU-REVIEW is the name-mismatch lifecycle document.
const AWAITING_CANDIDATES = ['ORG-03', 'EDU-REVIEW'];

Given('the document candidate has uploaded a document that awaits review', { timeout: AI }, async function () {
  const api = new DocVerificationApi();
  await api.login(process.env.DOC_CANDIDATE_EMAIL, process.env.DOC_CANDIDATE_PASSWORD, 'candidate');
  const tried = [];
  for (const id of AWAITING_CANDIDATES) {
    const doc = docTestData.documents.find((x) => x.id === id);
    const fixture = resolveFixture(doc.file, doc.id);
    const priorIds = await api.snapshotDocumentIds();
    const up = await api.upload(doc, fixture, { priorIds });
    if (!up.accepted) {
      tried.push({ id, refused: up.httpStatus, body: up.responseBody });
      continue;
    }
    const v = await api.waitForVerification(doc.category, up.entryId);
    const status = v.document && v.document.status;
    tried.push({ id, entryId: up.entryId, documentRowId: up.documentRowId, file: up.uploadedFileName, status });
    if (status === 'AWAITING') {
      notes(this).uploaded = { api, doc, up, fileName: up.uploadedFileName || (v.document && v.document.file_name) };
      await record(this, 'Uploaded a document that awaits review (permanent - no DELETE exists)', tried);
      return;
    }
  }
  await record(this, 'Uploads tried', tried);
  throw new Error(`None of ${AWAITING_CANDIDATES.join(', ')} was left in Needs Review by the AI, so there is no document of this scenario's own to decide on: ${JSON.stringify(tried)}`);
});

Then('the dashboard queue should list that uploaded document', async function () {
  const names = (await dash(this).readQueueRows()).map((r) => r.fileName);
  const want = notes(this).uploaded.fileName;
  await record(this, 'Queue after the upload', { looking_for: want, rows: names });
  expect(names, 'the uploaded document should be in the dashboard queue (it is the newest AWAITING row)').toContain(want);
});

When('I review that uploaded document from the dashboard', { timeout: STEP }, async function () {
  const want = notes(this).uploaded.fileName;
  const idx = (await dash(this).readQueueRows()).findIndex((r) => r.fileName === want);
  expect(idx, `${want} in the queue`).toBeGreaterThanOrEqual(0);
  await dash(this).openReview(idx);
  await av(this).panel.waitFor({ state: 'visible', timeout: 30000 });
  const p = await av(this).readPanel();
  expect(p.documentName, 'the panel must show the document this scenario uploaded before any decision').toBe(want);
});

async function commitFromDashboard(world, decision) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const reason = decision === 'approve'
    ? `Approved from the dashboard by the automation suite. Ref ${stamp}`
    : `Please upload a corrected copy - requested from the dashboard by the automation suite. Ref ${stamp}`;
  const dialog = await av(world).openDecisionDialog(decision);
  const res = await av(world).submitDecision(dialog, decision, reason);
  await world.page.waitForTimeout(1000);
  const toasts = await world.page.locator('[data-sonner-toast], .Toastify__toast, [role="status"]').allInnerTexts().catch(() => []);
  notes(world).decision = { ...res, toasts };
  await record(world, `Committed "${decision}" from the dashboard`, notes(world).decision);
}

When('I request a revision on it from the dashboard with a reason', { timeout: STEP }, async function () {
  await commitFromDashboard(this, 'revision');
});

When('I approve it from the dashboard with a reason', { timeout: STEP }, async function () {
  await commitFromDashboard(this, 'approve');
});

Then('the server should have accepted the dashboard decision', async function () {
  const s = notes(this).decision.httpStatus;
  expect(s, 'HTTP status of the decision').toBeGreaterThanOrEqual(200);
  expect(s).toBeLessThan(300);
});

Then('the uploaded document\'s status on the server should be {string}', { timeout: STEP }, async function (status) {
  const { api, doc, up } = notes(this).uploaded;
  let last = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const entry = await api.fetchEntry(doc.category, up.entryId);
    last = entry.document && entry.document.status;
    if (last === status) return;
    await this.page.waitForTimeout(1000);
  }
  throw new Error(`The uploaded document's server status is "${last}", expected "${status}"`);
});

Then('the dashboard queue should no longer list that uploaded document', async function () {
  const { fileName, up } = notes(this).uploaded;
  const names = (await dash(this).readQueueRows()).map((r) => r.fileName);
  const body = await dash(this).latestBody('queue');
  const ids = ((body && body.results) || []).map((r) => r.id);
  expect(names, 'rendered queue rows').not.toContain(fileName);
  if (up.documentRowId) expect(ids, 'the queue payload').not.toContain(up.documentRowId);
});

// ------------------------------------------------------------------------------------------------
// SECTION 10 - end to end
// ------------------------------------------------------------------------------------------------

Then('each dashboard card\'s count should agree with the listing it links to:', { timeout: TABLE }, async function (table) {
  const problems = [];
  const seen = [];
  for (const row of table.hashes()) {
    await openDashboardDismissed(this);
    const kind = CARD_KIND[row.card];
    const cardBody = await dash(this).latestBody(kind);
    const shown = await dash(this).cardCount(row.card);
    const mark = dash(this).responseMark();
    await dash(this).clickViewAll(row.card);
    await this.page.waitForURL((u) => u.pathname === row.route, { timeout: 30000 });
    let listing = await dash(this).waitForKind(kind, { since: mark, timeout: 30000 });
    if (kind === 'queue') {
      // View all opens the ALL tab; the card counts documents awaiting review, so the comparison is
      // with the Needs Review tab.
      const m2 = dash(this).responseMark();
      await av(this).chooseTab('AWAITING');
      listing = await dash(this).waitForKind('queue', { since: m2, match: /status=AWAITING/, timeout: 30000 });
    }
    const listCount = listing && listing.body ? listing.body.count : null;
    seen.push({ card: row.card, rendered: shown && shown.value, cardServer: cardBody && cardBody.count, listing: listCount, listingUrl: listing && listing.url });
    if (!shown || shown.value !== listCount) problems.push(`${row.card} shows ${shown && shown.value}, ${row.route} reports ${listCount}`);
    await this.page.goBack({ waitUntil: 'domcontentloaded' });
  }
  await record(this, 'Card counts vs their listings', seen);
  failIf(problems, 'A card count disagrees with the listing it links to:');
});

// ------------------------------------------------------------------------------------------------
// Teardown - routes are per page and die with the context; nothing to restore. The throwaway agent
// is abandoned on purpose (an agent cannot be deleted); it is recorded, not cleaned up.
// ------------------------------------------------------------------------------------------------

After({ tags: '@agent-dashboard' }, async function () {
  await this.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
});

module.exports = { kpiProblems, ageProblem, initialsOf };
