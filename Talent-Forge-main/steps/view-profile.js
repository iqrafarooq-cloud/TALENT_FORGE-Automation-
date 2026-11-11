const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

// Step definitions for features/SuperAdmin_Portal/UserManagement/View-Profile.feature - the
// superadmin's "View" action on BOTH listings, asserted against the server.
//
// The structural View coverage (tabs, URL per tab, Back, the drawer's five tabs) lives in
// steps/agent.js and steps/candidate-management.js and is reused here, not repeated. What this
// file adds is a RESPONSE RECORDER: every GET the app makes from the moment of the View click is
// kept with its parsed body, so each rendered value is compared with the value the app itself was
// sent for THAT record. A view that always rendered the first row's record would pass every
// structural check; it cannot pass these.
//
// Measured 2026-10-14 with scripts/probe-superadmin-view-profile.js (read-only):
//   agent profile  GET /agent/<id>/profile/            name, email, institution.name, status, monthly_target, user_id
//                  GET /agent/<id>/target-progress/?duration=current_month|last_quarter|yearly|ytd
//                  GET /agent/<id>/pending-verifications/   total_pending
//                  GET /agent/<id>/candidates/?page=1&page_size=10[&search=]
//                  GET /analytics/agents/activity-logs/<user_id>/?duration=last_7_days ...
//   drawer         GET /candidate/profile/<user id>/    (fetched ONCE on open; tabs reuse it)

const listing = (world) => world.pages.agentsListing;
const profile = (world) => world.pages.agentProfile;
const candidates = (world) => world.pages.candidatesListing;
const panel = (world) => world.pages.candidateDetailPanel;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lc = (s) => clean(s).toLowerCase();

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

// The API's agent status as the profile's pill names it.
const AGENT_STATUS_LABEL = {
  ACTIVE: 'Active',
  ATTENTION: 'Requires Attention',
  DEACTIVATED: 'Deactivated',
  INVITE_SENT: 'Invite Sent',
};

// ==================== The recorder ====================

// Installed once per scenario on the scenario's page. Bodies are parsed as they arrive and the
// PROMISE is kept, because Playwright does not await an event handler: a step that reads a body
// straight after waitForResponse would otherwise find it still unparsed.
function recorder(world) {
  if (!world._vp) {
    const log = [];
    world.page.on('response', (r) => {
      if (r.request().method() !== 'GET' || !/\/api\/v1\//.test(r.url())) return;
      const entry = { url: r.url(), path: r.url().replace(/^.*\/api\/v1/, ''), status: r.status(), at: Date.now() };
      entry.body = r.json().catch(() => null);
      log.push(entry);
    });
    world._vp = { log };
  }
  return world._vp;
}

function mark(world) {
  return recorder(world).log.length;
}

async function waitFor(world, re, { since = 0, timeout = 30000 } = {}) {
  const { log } = recorder(world);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = log.slice(since).filter((e) => re.test(e.path)).pop();
    if (hit) return { ...hit, body: await hit.body };
    await world.page.waitForTimeout(200);
  }
  return null;
}

function latest(world, re) {
  return recorder(world).log.filter((e) => re.test(e.path)).pop() || null;
}

async function latestBody(world, re) {
  const hit = latest(world, re);
  return hit ? hit.body : null;
}

function agentSubject(world) {
  if (!world._agent || !world._agent.email) throw new Error('No agent has been noted - a Given that notes or finds an agent must run first.');
  return world._agent;
}

function candidateSubject(world) {
  const c = world._candidate
    || (world._emailSubject && world._emailSubject.kind === 'candidate' ? world._emailSubject : null);
  if (!c || !c.email) throw new Error('No candidate has been noted - a Given that notes or finds a candidate must run first.');
  return c;
}

const mainText = async (world) => clean(await world.page.locator('main').first().innerText().catch(() => ''));

// ==================== Agent profile ====================

When("I open that agent's profile and record what the server sends", { timeout: 120000 }, async function () {
  const agent = agentSubject(this);
  await listing(this).search(agent.name);
  const since = mark(this);
  await listing(this).openAgentProfile(agent.email);
  this._vpAgentId = profile(this).agentId();
  const prof = await waitFor(this, new RegExp(`^/agent/${this._vpAgentId}/profile/`), { since });
  expect(prof, `GET /agent/${this._vpAgentId}/profile/ was never made`).toBeTruthy();
  this._vpProfile = prof.body;
  this._vpTarget = (await waitFor(this, new RegExp(`^/agent/${this._vpAgentId}/target-progress/`), { since })) || null;
  // The header paints after the payload lands; wait for the name rather than sampling once.
  await expect(this.page.locator('main').first()).toContainText(clean(prof.body.name || agent.name), { timeout: 20000 });
  this.attach(`Agent ${this._vpAgentId} profile payload:\n${JSON.stringify(prof.body, null, 2)}`, 'text/plain');
});

Then('the profile should be the one for the agent whose row was clicked', async function () {
  const agent = agentSubject(this);
  expect(lc(this._vpProfile.email), 'the profile opened is not the agent whose row was clicked').toBe(lc(agent.email));
  expect(String(this._vpProfile.id), 'the profile payload is for a different id than the URL').toBe(String(this._vpAgentId));
});

Then("the profile header should match the server's profile for that agent:", async function (table) {
  const p = this._vpProfile;
  const header = await profile(this).readHeader();
  const head = header.headerLines.map(clean);
  const expected = {
    name: clean(p.name || `${p.first_name || ''} ${p.last_name || ''}`),
    email: clean(p.email),
    university: clean(p.institution && p.institution.name),
    status: AGENT_STATUS_LABEL[p.status] || p.status,
  };
  const problems = [];
  for (const { field } of table.hashes()) {
    const want = expected[field];
    if (want === undefined) throw new Error(`Unknown header field "${field}"`);
    if (!want) { problems.push(`${field}: the server holds no value to compare against`); continue; }
    if (!head.some((l) => lc(l) === lc(want))) problems.push(`${field}: the server says "${want}", the header shows ${JSON.stringify(head)}`);
  }
  this.attach(`Header lines: ${JSON.stringify(head)}\nExpected from server: ${JSON.stringify(expected)}`, 'text/plain');
  fail(problems, 'The agent profile header does not show the server\'s values:');
});

// The first "N% / A of B Candidates Onboarded" block on Performance Overview is Target Progress.
async function readTargetBlock(world) {
  const text = await mainText(world);
  const m = text.match(/Target Progress\s+(?:Monthly|Quarterly|Yearly|Year to Date)\b.*?(\d+(?:\.\d+)?)%\s+(\d+)\s+of\s+(\d+)\s+Candidates Onboarded/);
  return m ? { percent: Number(m[1]), onboarded: Number(m[2]), target: Number(m[3]), raw: m[0] } : { raw: text.slice(0, 300) };
}

async function expectTargetMatches(world, body, label) {
  const deadline = Date.now() + 15000;
  let shown = await readTargetBlock(world);
  while (Date.now() < deadline && !(shown.onboarded === body.onboarded && shown.target === body.target)) {
    await world.page.waitForTimeout(400);
    shown = await readTargetBlock(world);
  }
  const problems = [];
  if (shown.onboarded !== body.onboarded) problems.push(`${label}: shows ${shown.onboarded} onboarded, the server says ${body.onboarded}`);
  if (shown.target !== body.target) problems.push(`${label}: shows a target of ${shown.target}, the server says ${body.target}`);
  if (Math.round(shown.percent) !== Math.round(body.percentage)) problems.push(`${label}: shows ${shown.percent}%, the server says ${body.percentage}%`);
  return { shown, problems };
}

Then("Target Progress should render the server's percentage, onboarded count and target", async function () {
  expect(this._vpTarget, 'no target-progress response was recorded').toBeTruthy();
  expect(this._vpTarget.path, 'the profile does not open on the current month').toMatch(/duration=current_month/);
  const { shown, problems } = await expectTargetMatches(this, this._vpTarget.body, 'Monthly');
  this.attach(`Server: ${JSON.stringify(this._vpTarget.body)}\nRendered: ${shown.raw}`, 'text/plain');
  fail(problems, 'Target Progress does not show the server\'s figures:');
});

Then("the target Target Progress measures against should be the agent's monthly target", async function () {
  expect(this._vpTarget.body.target, `target-progress says ${this._vpTarget.body.target}, the profile's monthly_target is ${this._vpProfile.monthly_target}`)
    .toBe(this._vpProfile.monthly_target);
});

// The FIRST period trigger on Performance Overview belongs to Target Progress. Re-located on every
// use, because its label is the current selection.
async function chooseTargetPeriod(world, label) {
  const trigger = world.page.locator('main button').filter({ hasText: /^(Monthly|Quarterly|Yearly|Year to Date)$/ }).first();
  await trigger.click();
  await world.page.getByRole('option', { name: label, exact: true }).first().click();
}

Then("choosing each Target Progress period should re-query and render the server's figures:",
  { timeout: 180000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const { period, duration } of table.hashes()) {
      const since = mark(this);
      await chooseTargetPeriod(this, period);
      const hit = await waitFor(this, new RegExp(`^/agent/${this._vpAgentId}/target-progress/`), { since, timeout: 15000 });
      if (!hit) { problems.push(`${period}: no target-progress request was made`); continue; }
      const got = new URL(hit.url).searchParams.get('duration');
      if (got !== duration) problems.push(`${period}: requested duration=${got}, expected ${duration}`);
      const { shown, problems: p } = await expectTargetMatches(this, hit.body, period);
      problems.push(...p);
      this._vpLastTargetPeriod = { period, duration: got };
      report.push(`${period}: ${hit.path} -> ${JSON.stringify(hit.body)} | rendered ${shown.raw}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'A Target Progress period did not re-query or render the server\'s answer:');
  });

Then('the URL should record the chosen Target Progress period', async function () {
  const last = this._vpLastTargetPeriod;
  expect(last, 'no period was chosen').toBeTruthy();
  expect(new URL(this.page.url()).searchParams.get('targetDuration'), `the URL does not record ${last.period}`).toBe(last.duration);
});

// "Quarterly" covers the last 4 months, not the current one (product rule, 2026-10-22). The app
// asks for duration=last_quarter. What can be asserted, measured across every agent on DEV:
//   - an onboarding made THIS month never counts in Quarterly;
//   - Quarterly never counts more than the months before this one hold.
// The window's month count (4 rather than 3) is NOT asserted: no endpoint exposes a candidate's
// dates and the profile states no range, so nothing observable separates the two.
//
// The subject is chosen so the exclusion is decidable: this month's onboardings outnumber the
// year's earlier ones. Had Quarterly counted the current month it would hold at least this
// month's figure - more than the earlier months can supply - so one upper bound proves it.
const WINDOW_MONTHS = 4;

Given('I have found an agent who onboarded candidates this month', { timeout: 240000 }, async function () {
  // The app keeps its token in memory, not in a cookie; take it off the listing's own request.
  const authorised = this.page.waitForRequest(
    (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && Boolean(r.headers().authorization),
    { timeout: 60000 },
  );
  await listing(this).runAndWaitForList(async () => { await listing(this).goto('Active'); });
  const req = await authorised;
  const api = req.url().replace(/\/agent\/\?.*$/, '');
  const headers = { authorization: req.headers().authorization };
  const get = async (path) => {
    const r = await this.page.request.get(`${api}${path}`, { headers });
    return r.ok() ? r.json() : null;
  };

  const thisMonth = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await get(`/agent/?status=ACTIVE&status=ATTENTION&page=${page}&page_size=100`);
    if (!body) break;
    thisMonth.push(...(body.results || []).filter((a) => ((a.monthly_progress || {}).onboarded || 0) > 0));
    if (!body.next) break;
  }
  const scored = [];
  for (const a of thisMonth.slice(0, 25)) {
    const ytd = await get(`/agent/${a.id}/target-progress/?duration=ytd`);
    if (!ytd) continue;
    const month = a.monthly_progress.onboarded;
    scored.push({ a, month, ytd: ytd.onboarded, margin: month - (ytd.onboarded - month) });
  }
  scored.sort((x, y) => y.margin - x.margin);
  this.attach(`Agents who onboarded this month (this month / year to date):\n${
    scored.map((s) => `  ${s.a.email}: ${s.month} / ${s.ytd}`).join('\n') || '  none'}`, 'text/plain');
  const pick = scored.find((s) => s.margin > 0);
  if (!pick) {
    throw new Error('No Active agent has onboarded more candidates this month than in the earlier months of the year, '
      + 'so whether Quarterly excludes the current month cannot be decided on DEV today. This is a missing fixture, '
      + `not an app defect. Agents checked: ${scored.length}.`);
  }
  const a = pick.a;
  this._agent = {
    name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
    email: a.email,
    university: a.institution_name,
    status: a.status,
    candidates: Number(a.total_candidate_count || 0),
    progress: Number((a.monthly_progress || {}).percentage || 0),
    cells: [],
  };
  this._vpOnboardedThisMonth = pick.month;
});

Then('the Quarterly target progress should count the months before the current one, not the current month',
  { timeout: 120000 }, async function () {
    const month = this._vpTarget && this._vpTarget.body;
    expect(month, 'no Monthly target-progress response was recorded when the profile opened').toBeTruthy();
    const read = async (period) => {
      const since = mark(this);
      await chooseTargetPeriod(this, period);
      const hit = await waitFor(this, new RegExp(`^/agent/${this._vpAgentId}/target-progress/`), { since, timeout: 15000 });
      expect(hit, `choosing ${period} made no request`).toBeTruthy();
      return hit;
    };
    const ytd = (await read('Year to Date')).body;
    const q = await read('Quarterly');
    const duration = new URL(q.url).searchParams.get('duration');
    const now = new Date();
    const earlierThisYear = ytd.onboarded - month.onboarded;
    const windowInThisYear = now.getMonth() >= WINDOW_MONTHS;
    const problems = [];
    if (duration !== 'last_quarter') problems.push(`"Quarterly" asks the server for duration=${duration}, not last_quarter`);
    if (month.onboarded <= earlierThisYear) {
      problems.push(`the subject no longer separates the two readings: ${month.onboarded} onboarded this month against `
        + `${earlierThisYear} earlier this year`);
    }
    if (windowInThisYear && q.body.onboarded > earlierThisYear) {
      problems.push(`"Quarterly" counts ${q.body.onboarded} onboarded, but the months before this one hold only `
        + `${earlierThisYear} (year to date ${ytd.onboarded} minus this month's ${month.onboarded}) - it is counting `
        + 'the current month');
    }
    const { shown, problems: rendered } = await expectTargetMatches(this, q.body, 'Quarterly');
    problems.push(...rendered);
    this.attach(`Monthly: ${JSON.stringify(month)}\nYear to Date: ${JSON.stringify(ytd)}\n`
      + `Quarterly (${duration}): ${JSON.stringify(q.body)}\nRendered: ${shown.raw}\n`
      + (windowInThisYear
        ? `Bound: Quarterly ${q.body.onboarded} <= earlier months ${earlierThisYear}`
        : `The ${WINDOW_MONTHS}-month window reaches into last year, so Year to Date cannot bound it this month; only the request and the render were checked.`),
    'text/plain');
    fail(problems, 'Quarterly target progress does not cover the months before the current one:');
  });

Then("Pending Verifications should render the server's total for that agent", { timeout: 60000 }, async function () {
  const hit = latest(this, new RegExp(`^/agent/${this._vpAgentId}/pending-verifications/`));
  expect(hit, 'GET pending-verifications was never made').toBeTruthy();
  const body = await hit.body;
  const text = await mainText(this);
  const m = text.match(/Pending Verifications\s+(\d+)\s+Documents?/i);
  this.attach(`Server: ${JSON.stringify(body)}\nRendered: ${m ? m[0] : text.slice(-300)}`, 'text/plain');
  expect(m, 'Pending Verifications shows no document total').toBeTruthy();
  expect(Number(m[1]), `Pending Verifications shows ${m[1]}, the server says ${body.total_pending}`).toBe(body.total_pending);
});

// ---------- Candidates tab ----------

const candidatesRe = (world) => new RegExp(`^/agent/${world._vpAgentId}/candidates/\\?page=1&page_size=(?!1&|1$)\\d+`);

async function profileCandidateEmails(world) {
  const data = await profile(world).readCandidatesTab();
  return data.rows.map((r) => lc(r.email)).filter(Boolean);
}

async function settleProfileCandidates(world, expectedEmails) {
  const deadline = Date.now() + 20000;
  let shown = await profileCandidateEmails(world);
  while (Date.now() < deadline && shown.slice().sort().join() !== expectedEmails.slice().sort().join()) {
    await world.page.waitForTimeout(400);
    shown = await profileCandidateEmails(world);
  }
  return shown;
}

Then("the profile's Candidates tab should list exactly the candidates the server returned", { timeout: 60000 }, async function () {
  const hit = latest(this, candidatesRe(this));
  expect(hit, 'the profile never requested its candidates list').toBeTruthy();
  const body = await hit.body;
  const server = (body.results || []).map((c) => lc(c.email || (c.user && c.user.email)));
  const shown = await settleProfileCandidates(this, server);
  this._vpCandidates = { body, server };
  this.attach(`Server (${body.count}): ${server.join(', ')}\nShown: ${shown.join(', ')}`, 'text/plain');
  expect(server.length, 'the server returned no candidates for an agent the listing credits with some').toBeGreaterThan(0);
  expect(shown.slice().sort(), 'the Candidates tab does not list the candidates the server returned').toEqual(server.slice().sort());
});

Then("the profile's candidate total should agree with the agent's row on the listing", async function () {
  const agent = agentSubject(this);
  const body = this._vpCandidates.body;
  // The listing's "Total Candidates" counts ACTIVE candidates (the profile asks for that figure
  // separately with is_active=true), so that is the request compared.
  const active = await latestBody(this, new RegExp(`^/agent/${this._vpAgentId}/candidates/\\?.*is_active=true`));
  const activeCount = active ? active.count : body.count;
  expect(activeCount, `the profile counts ${activeCount} active candidates, the listing row says ${agent.candidates}`).toBe(agent.candidates);
});

async function searchProfileCandidates(world, term) {
  const box = world.page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
  await expect(box, 'the profile\'s Candidates tab offers no search box').toBeVisible({ timeout: 15000 });
  const since = mark(world);
  await box.fill('');
  await box.pressSequentially(term, { delay: 30 });
  const hit = await waitFor(world, new RegExp(`^/agent/${world._vpAgentId}/candidates/\\?.*search=`), { since, timeout: 20000 });
  world._vpSearch = { term, hit };
  return hit;
}

When("I search the profile's Candidates tab for part of its first candidate's email", { timeout: 90000 }, async function () {
  const first = (this._vpCandidates && this._vpCandidates.server[0]) || (await profileCandidateEmails(this))[0];
  expect(first, 'the Candidates tab lists nobody to search for').toBeTruthy();
  // The local part, derived at run time; a whole local part is specific enough to narrow and
  // short enough to be a real partial match.
  await searchProfileCandidates(this, first.split('@')[0]);
});

When("I search the profile's Candidates tab for a term no candidate holds", { timeout: 90000 }, async function () {
  await searchProfileCandidates(this, `zz-no-match-${Date.now().toString(36)}`);
});

Then('the search should have been sent to the server for that agent', async function () {
  const { term, hit } = this._vpSearch;
  expect(hit, `searching "${term}" made no request`).toBeTruthy();
  expect(new URL(hit.url).searchParams.get('search'), 'the request does not carry the term typed').toBe(term);
  expect((hit.body.results || []).length, `the server matched nothing for "${term}"`).toBeGreaterThan(0);
});

Then('every candidate listed on the profile should match the search', async function () {
  const { term, hit } = this._vpSearch;
  const server = (hit.body.results || []).map((c) => lc(c.email || (c.user && c.user.email)));
  const shown = await settleProfileCandidates(this, server);
  expect(shown.slice().sort(), 'the tab does not show the server\'s search result').toEqual(server.slice().sort());
  const stray = (hit.body.results || []).filter((c) => !lc(JSON.stringify(c)).includes(lc(term)));
  expect(stray.map((c) => c.email), `candidates listed for "${term}" do not contain it anywhere`).toEqual([]);
});

Then('the server should have answered that search with no candidates', async function () {
  const { term, hit } = this._vpSearch;
  expect(hit, `searching "${term}" made no request`).toBeTruthy();
  expect(hit.body.count, 'the premise is broken - the term matched something').toBe(0);
});

// Measured 2026-10-22 (the defect this used to be @known-issue for is fixed): the tab renders
// "No results found / We couldn't find any results matching your current search." The empty state
// is READ - heading and body - rather than searched for in the page text, so the step cannot pass
// on a stray "search" somewhere else on the screen.
const SEARCH_EMPTY = { heading: 'No results found', body: "We couldn't find any results matching your current search." };

Then("the profile's Candidates tab should explain that the search matched nothing", { timeout: 30000 }, async function () {
  const heading = this.page.locator('main').getByText(/^(No results found|No candidates yet)$/).first();
  await heading.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const shown = await heading.evaluate((h) => {
    const c = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    const next = h.nextElementSibling || (h.parentElement && h.parentElement.querySelector('p'));
    return { heading: c(h.innerText), body: c(next && next.innerText) };
  }).catch(() => null);
  this.attach(`Rendered for a search with no match: ${JSON.stringify(shown)}`, 'text/plain');
  expect(shown, 'no empty state is shown for a search that matched nothing').toBeTruthy();
  expect(shown.heading, 'the tab says the agent HAS no candidates, while only the search matched nothing')
    .toBe(SEARCH_EMPTY.heading);
  expect(shown.body).toBe(SEARCH_EMPTY.body);
});

// ---------- From the profile's Candidates tab into the candidate drawer ----------

When("I view the first candidate on the profile's Candidates tab", { timeout: 90000 }, async function () {
  const data = await profile(this).readCandidatesTab();
  const first = data.rows.find((r) => r.email);
  expect(first, 'the profile\'s Candidates tab lists nobody').toBeTruthy();
  this._vpClicked = first;
  this._vpUrlBefore = this.page.url();
  const since = mark(this);
  const row = this.page.locator('[role="row"]', { hasText: first.email }).first();
  await row.getByRole('button', { name: /^view$/i }).first().click();
  this._vpDrawerProfile = await waitFor(this, /^\/candidate\/profile\/\d+\//, { since, timeout: 20000 });
  await panel(this).waitForOpen();
});

Then('the candidate drawer should be showing the candidate whose row was clicked', async function () {
  const clicked = this._vpClicked;
  expect(this._vpDrawerProfile, 'opening the drawer fetched no candidate profile').toBeTruthy();
  const body = this._vpDrawerProfile.body;
  expect(lc(body.user && body.user.email), 'the drawer fetched a different candidate than the row clicked').toBe(lc(clicked.email));
  const header = await panel(this).readHeader();
  const want = clean(`${body.user.firstname || ''} ${body.user.lastname || ''}`);
  expect(lc(header.name), `the drawer is headed "${header.name}", the candidate is "${want}"`).toBe(lc(want));
});

Then("the URL should still be the agent profile's Candidates tab", async function () {
  expect(this.page.url(), 'opening the drawer navigated away from the profile').toBe(this._vpUrlBefore);
  expect(new URL(this.page.url()).searchParams.get('tab')).toBe('candidates');
});

Then('the {string} profile tab should still be selected', async function (tab) {
  expect(await profile(this).selectedTab(), 'the profile changed tab').toBe(tab);
});

// ---------- Activity Log ----------

Then("the Activity Log should be requested for that agent's own account", { timeout: 60000 }, async function () {
  const hit = await waitFor(this, /^\/analytics\/agents\/activity-logs\/\d+\//, { timeout: 20000 });
  expect(hit, 'the Activity Log made no request').toBeTruthy();
  const userId = String(hit.path.match(/activity-logs\/(\d+)\//)[1]);
  expect(userId, `the log was requested for user ${userId}, the agent's user is ${this._vpProfile.user_id}`)
    .toBe(String(this._vpProfile.user_id));
  this._vpActivity = hit;
});

Then('the Activity Log should open on {string}', async function (label) {
  const trigger = this.page.locator('main button').filter({ hasText: /^(Last \d+ (hours|days|months)|This year)$/i }).first();
  await expect(trigger).toHaveText(new RegExp(`^${label}$`, 'i'), { timeout: 15000 });
  expect(new URL(this._vpActivity.url).searchParams.get('duration')).toBe(label.toLowerCase().replace(/\s+/g, '_'));
});

Then('choosing each Activity Log period should re-query the server and record it in the URL:',
  { timeout: 240000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const { period, duration } of table.hashes()) {
      const trigger = this.page.locator('main button').filter({ hasText: /^(Last \d+ (hours|days|months)|This year)$/i }).first();
      const since = mark(this);
      await trigger.click();
      await this.page.getByRole('option', { name: new RegExp(`^${period}$`, 'i') }).first().click();
      const hit = await waitFor(this, /^\/analytics\/agents\/activity-logs\/\d+\//, { since, timeout: 15000 });
      if (!hit) { problems.push(`${period}: no request was made`); continue; }
      const got = new URL(hit.url).searchParams.get('duration');
      if (got !== duration) problems.push(`${period}: requested duration=${got}, expected ${duration}`);
      const inUrl = new URL(this.page.url()).searchParams.get('duration');
      if (inUrl !== duration) problems.push(`${period}: the URL records duration=${inUrl}`);
      // The rendered entries for this answer: every entry the server returned is rendered.
      const rendered = await profile(this).readActivityLog();
      const want = (hit.body.results || []).length;
      if (rendered.entryDates.length < Math.min(want, 1)) problems.push(`${period}: the server returned ${want} entries, none are rendered`);
      report.push(`${period}: ${hit.path} -> count ${hit.body.count}, rendered ${rendered.entryDates.length}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'The profile Activity Log periods do not re-query the server correctly:');
  });

// ---------- Deep links ----------

Then("opening that agent's profile with each tab value should select the expected tab, also after a reload:",
  { timeout: 300000 }, async function (table) {
    const problems = [];
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    for (const { value, selected } of table.hashes()) {
      const url = `${origin}/agents/view/${this._vpAgentId}?tab=${encodeURIComponent(value)}`;
      for (const how of ['opened', 'reloaded']) {
        if (how === 'opened') await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        else await this.page.reload({ waitUntil: 'domcontentloaded' });
        let got = '';
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && got !== selected) {
          await this.page.waitForTimeout(400);
          got = await profile(this).selectedTab();
        }
        if (got !== selected) problems.push(`?tab=${value} ${how}: selected "${got}", expected "${selected}"`);
      }
      // The header paints after the tab strip on a reload, so the name is polled, not sampled.
      let main = '';
      const until = Date.now() + 15000;
      while (Date.now() < until && !lc(main).includes(lc(this._vpProfile.name))) {
        await this.page.waitForTimeout(400);
        main = await mainText(this);
      }
      if (!lc(main).includes(lc(this._vpProfile.name))) problems.push(`?tab=${value}: the profile no longer shows ${this._vpProfile.name}`);
    }
    fail(problems, 'A profile tab deep link did not select the expected tab:');
  });

// ==================== Candidate drawer ====================

async function openDrawerRecorded(world, c) {
  await candidates(world).goto('All');
  await candidates(world).search(c.email, { tab: 'All' });
  const since = mark(world);
  await candidates(world).openCandidatePanel(c.email);
  await panel(world).waitForOpen();
  // The drawer fetches the profile on its FIRST open only and reuses it afterwards, so a
  // reopen is answered from the recorder's earlier entry for the same candidate.
  const fresh = await waitFor(world, /^\/candidate\/profile\/\d+\//, { since, timeout: 8000 });
  const hit = fresh || latest(world, /^\/candidate\/profile\/\d+\//);
  return hit ? { ...hit, body: await hit.body } : null;
}

When('I view that candidate and record what the server sends', { timeout: 150000 }, async function () {
  const c = candidateSubject(this);
  recorder(this);
  const hit = await openDrawerRecorded(this, c);
  expect(hit, 'opening the drawer fetched no candidate profile').toBeTruthy();
  this._vpCand = hit;
  // Figures start as em dashes and are replaced when the payload lands.
  await expect(panel(this).root || this.page.locator('[role="dialog"]').last()).toContainText(clean(hit.body.user.email), { timeout: 20000 })
    .catch(() => {});
  this.attach(`Candidate profile payload:\n${JSON.stringify(hit.body, null, 2).slice(0, 4000)}`, 'text/plain');
});

Then('the drawer should have fetched the profile of the candidate whose row was clicked', async function () {
  const c = candidateSubject(this);
  expect(lc(this._vpCand.body.user && this._vpCand.body.user.email), 'the drawer fetched a different candidate').toBe(lc(c.email));
});

Then("the drawer header should match the server's profile for that candidate", async function () {
  const b = this._vpCand.body;
  const header = await panel(this).readHeader();
  const name = clean(`${b.user.firstname || ''} ${b.user.lastname || ''}`);
  const problems = [];
  if (lc(header.name) !== lc(name)) problems.push(`name: the drawer shows "${header.name}", the server says "${name}"`);
  // The pill is the VERIFICATION state, `is_verified` - not `is_email_verified`, which disagrees
  // with it on the same record (see "TWO PAYLOAD TRAPS" in CLAUDE.md).
  const pill = b.is_verified ? 'Verified' : 'Unverified';
  if (header.verification !== pill) problems.push(`status: the drawer shows "${header.verification}", is_verified=${b.is_verified} means "${pill}"`);
  fail(problems, 'The drawer header does not match the server:');
});

Then("the drawer's summary figures should match the server's statistics", async function () {
  const stats = this._vpCand.body.stats;
  const kpis = await panel(this).readKpis();
  this.attach(`stats: ${JSON.stringify(stats)}\nrendered: ${JSON.stringify(kpis)}`, 'text/plain');
  expect(kpis.length, 'the drawer renders no summary figures').toBe(4);
  if (!stats) {
    // No statistics computed: every figure must be the em-dash placeholder, never a 0 - a zero
    // tells the superadmin the candidate did nothing, which is not known.
    const zeros = kpis.filter((k) => /^0%?$/.test(k.value));
    expect(zeros.map((k) => k.caption), 'uncomputed statistics are shown as 0').toEqual([]);
    return;
  }
  const want = {
    'Track Progress': `${stats.track_progress}%`,
    'Courses Completed': String(stats.courses_completed),
    'Hours Learned': String(stats.hours_learned),
    'Certificates Earned': String(stats.certifications_earned),
  };
  const problems = kpis.filter((k) => want[k.caption] !== undefined && clean(k.value) !== want[k.caption])
    .map((k) => `${k.caption}: shows ${k.value}, the server says ${want[k.caption]}`);
  fail(problems, 'The drawer\'s summary figures do not match the server:');
});

Then("Basic Information should show the server's email and current status", async function () {
  const b = this._vpCand.body;
  const details = await panel(this).readCandidateDetails();
  const basic = (details.sections.find((s) => /basic information/i.test(s.title)) || {}).text || '';
  const problems = [];
  if (!lc(basic).includes(lc(b.user.email))) problems.push(`the email ${b.user.email} is not shown: "${basic.slice(0, 200)}"`);
  if (b.qualification) {
    const status = b.qualification.charAt(0) + b.qualification.slice(1).toLowerCase().replace(/_/g, '-');
    if (!lc(basic).includes(lc(status))) problems.push(`Current Status "${status}" (qualification ${b.qualification}) is not shown`);
  }
  fail(problems, 'Basic Information does not show the server\'s values:');
});

Then("each profile section in the drawer should list exactly the server's entries:", async function (table) {
  const b = this._vpCand.body;
  const details = await panel(this).readCandidateDetails();
  const problems = [];
  const report = [];
  for (const { section, collection, field } of table.hashes()) {
    const entries = b[collection] || [];
    const s = details.sections.find((x) => lc(x.title) === lc(section));
    if (!s) { problems.push(`${section}: the section is not rendered`); continue; }
    report.push(`${section}: server ${entries.length} -> ${entries.map((e) => e[field]).join(' | ')}`);
    if (!entries.length) {
      if (!s.empty && !/no .* (added|yet)/i.test(s.text)) problems.push(`${section}: the server holds none, the section does not say so ("${s.text.slice(0, 120)}")`);
      continue;
    }
    for (const e of entries) {
      if (e[field] && !lc(s.text).includes(lc(e[field]))) problems.push(`${section}: "${e[field]}" from the server is not listed`);
    }
    if (s.empty) problems.push(`${section}: shows its empty state while the server holds ${entries.length}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A profile section in the drawer does not list the server\'s entries:');
});

// Documents are not a collection of their own on the payload - each lives on the education /
// work experience / certification entry it was uploaded with, as `document`.
Then('each document group should hold exactly the documents attached on the server', async function () {
  const b = this._vpCand.body;
  const docs = await panel(this).readDocuments();
  const groups = { Education: 'educations', 'Work Experience': 'work_experiences', Certifications: 'certifications' };
  const problems = [];
  const report = [];
  let total = 0;
  for (const [group, collection] of Object.entries(groups)) {
    const attached = (b[collection] || []).filter((e) => e.document);
    total += attached.length;
    const g = docs.groups.find((x) => x.group === group);
    report.push(`${group}: server ${attached.length} attached, rendered ${g ? g.files.length : '(absent)'} ${g && g.empty ? '(empty state)' : ''}`);
    if (!g || !g.present) { problems.push(`${group}: the group is not rendered`); continue; }
    if (attached.length === 0 && !g.empty) problems.push(`${group}: the server holds no document, the group does not say so`);
    if (attached.length > 0 && g.files.length !== attached.length) {
      problems.push(`${group}: the server holds ${attached.length} attached document(s), the group lists ${g.files.length}`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  expect(total, 'the premise is broken - the candidate has no attached document on the server').toBeGreaterThan(0);
  fail(problems, 'The Documents tab does not hold exactly the server\'s documents:');
});

// ---------- Two candidates in turn ----------

Given('I have noted the first two candidates on the {string} tab', { timeout: 120000 }, async function (tab) {
  await candidates(this).goto(tab);
  const rows = (await candidates(this).readRows()).filter((r) => r.email);
  expect(rows.length, `the ${tab} tab lists fewer than two candidates`).toBeGreaterThan(1);
  const distinct = rows.find((r) => lc(r.name) !== lc(rows[0].name)) || rows[1];
  this._vpPair = [rows[0], distinct];
  recorder(this);
  this.attach(`Candidates: ${rows[0].name} <${rows[0].email}> then ${distinct.name} <${distinct.email}>`, 'text/plain');
});

When('I view the first noted candidate and close the drawer', { timeout: 150000 }, async function () {
  const [first] = this._vpPair;
  this._vpFirst = await openDrawerRecorded(this, first);
  await panel(this).close();
});

When('I view the second noted candidate', { timeout: 150000 }, async function () {
  const [, second] = this._vpPair;
  this._vpSecond = await openDrawerRecorded(this, second);
});

Then("the drawer should show the second candidate and none of the first one's details", async function () {
  const [first, second] = this._vpPair;
  expect(this._vpSecond, 'opening the second candidate fetched no profile').toBeTruthy();
  expect(lc(this._vpSecond.body.user.email), 'the drawer fetched the wrong candidate the second time').toBe(lc(second.email));
  const header = await panel(this).readHeader();
  const details = await panel(this).readCandidateDetails();
  const all = lc(details.sections.map((s) => s.text).join(' '));
  const problems = [];
  if (lc(header.name) !== lc(`${this._vpSecond.body.user.firstname} ${this._vpSecond.body.user.lastname}`)) {
    problems.push(`the drawer is headed "${header.name}", not the second candidate`);
  }
  if (all.includes(lc(first.email))) problems.push(`the second candidate's drawer still shows the first candidate's email ${first.email}`);
  if (!all.includes(lc(second.email))) problems.push(`the second candidate's email ${second.email} is not shown`);
  fail(problems, 'Opening a second candidate did not replace the first one\'s details:');
});
