const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const AgentsListingPage = require('../pages/AgentsListingPage');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');

// Step definitions for features/SuperAdmin_Portal/UserManagement/Agent-View-Profile.feature - the
// agent profile reached by View from Active, Requires Attention and Deactivated.
//
// The response recorder below writes the SAME shape steps/view-profile.js reads (world._vp.log,
// entries {url, path, status, at, body: Promise}), and the "view from a tab" step fills the same
// world fields that file's open step does (_agent, _vpAgentId, _vpProfile, _vpTarget). So every
// server comparison there ("the profile header should match the server's profile ...", "Target
// Progress should render ...", the Candidates tab, the Activity Log) works unchanged after a
// profile opened from ANY tab, and is not written twice.
//
// Measured 2026-10-22 (scripts/probe-agent-view-per-tab.js, probe-agent-view-profile-mutations.js):
//   View fires   GET /agent/<id>/profile/, /target-progress/, /onboarding-trends/, /revenue-impact/,
//                /pending-verifications/, /candidates/ (x3) and GET /agents/<id>/promotion/ - the
//                Promo Tools tab re-renders that last one and fires nothing when selected
//   header menu  ACTIVE / ATTENTION -> "Log in as agent", "Deactivate"; DEACTIVATED -> "Reactivate"
//   Edit Target  PATCH /agent/<id>/profile/ {"monthly_target":n} -> 200, toast "Target updated."
//                inline errors for empty / zero / negative / non-numeric / decimal, Save disabled;
//                99999999999 is NOT gated and the server answers 500
//   lifecycle    POST /agent/<id>/deactivate/  "Account deactivated successfully."
//                POST /agent/<id>/reactivate/  "Account reactivated successfully." (back as ATTENTION
//                for an agent with no candidates)
//   addresses    /agents/view/abc | 0 | -1 | <id>abc -> every request 404, "Profile not found."
//   failures     a 500 on the profile request also says "Profile not found."; a 500 on
//                target-progress renders "0% / 0 of 0 Candidates Onboarded"

const listing = (world) => world.pages.agentsListing;
const profile = (world) => world.pages.agentProfile;
const promoTools = (world) => {
  if (!world._avPromo) world._avPromo = new AdminPromoToolsPage(world.page);
  return world._avPromo;
};

const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lc = (s) => clean(s).toLowerCase();
const PERIOD_RE = /^(Monthly|Quarterly|Yearly|Year to Date)$/;

const STATUS_LABEL = { ACTIVE: 'Active', ATTENTION: 'Requires Attention', DEACTIVATED: 'Deactivated', INVITE_SENT: 'Invite Sent' };

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const unquote = (s) => {
  const v = s === undefined ? '' : String(s);
  const m = v.match(/^"(.*)"$/);
  return m ? m[1] : v;
};

function isoDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ==================== The recorder ====================

// GETs go to world._vp in exactly the shape steps/view-profile.js uses, so its steps read them.
// Writes (any non-GET to the API) are kept separately: several scenarios here assert that NOTHING
// was written, and a GET-only log could never show that.
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
  if (!world._avWrites) {
    const writes = [];
    world.page.on('response', (r) => {
      const method = r.request().method();
      if (method === 'GET' || !/\/api\/v1\//.test(r.url())) return;
      writes.push({
        method,
        path: r.url().replace(/^.*\/api\/v1/, ''),
        status: r.status(),
        request: r.request().postData(),
        body: r.text().catch(() => ''),
        at: Date.now(),
      });
    });
    world._avWrites = writes;
  }
  return world._vp;
}

const mark = (world) => recorder(world).log.length;
const markWrites = (world) => { recorder(world); return world._avWrites.length; };

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

// Writes to the agent's own record or lifecycle since `since`, i.e. anything a cancelled dialog
// must not have sent. Notification reads and the like are GETs and never land here.
function agentWritesSince(world, since) {
  return world._avWrites.slice(since).filter((w) => /\/agents?\/\d+\//.test(w.path));
}

const mainText = async (world) => clean(await world.page.locator('main').first().innerText().catch(() => ''));

// ==================== Picking a subject ====================

function rawAgents(result) {
  const p = result && result.payload;
  return (p && (p.results || p.data || p.items)) || [];
}

function toSubject(a) {
  return {
    id: String(a.id),
    name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
    email: a.email,
    university: a.institution_name || '',
    status: a.status,
    candidates: Number(a.total_candidate_count || 0),
    progress: Number((a.monthly_progress || {}).percentage || 0),
    monthlyTarget: a.monthly_target,
    attention: a.attention_details || null,
    cells: [],
  };
}

async function loadTab(world, tab, query = '') {
  const param = AgentsListingPage.TAB_PARAM[String(tab).trim().toLowerCase()];
  if (param === undefined) throw new Error(`Unknown Agents tab "${tab}"`);
  const params = new URLSearchParams(query);
  if (param) params.set('tab', param);
  const qs = params.toString();
  const result = await listing(world).runAndWaitForList(async () => {
    await world.page.goto(`${listing(world).url}${qs ? `?${qs}` : ''}`, { waitUntil: 'domcontentloaded' });
  });
  world._lastList = result;
  return result;
}

async function pickFirst(world, tab, { count = 1 } = {}) {
  const result = await loadTab(world, tab);
  const agents = rawAgents(result).filter((a) => a.email);
  if (agents.length < count) {
    throw new Error(`The "${tab}" tab lists ${agents.length} agent(s); this scenario needs ${count}. `
      + 'That is a missing fixture on DEV, not an app defect.');
  }
  return agents.slice(0, count).map(toSubject);
}

Given('I have picked the first agent listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  recorder(this);
  [this._agent] = await pickFirst(this, tab);
  this.attach(`Subject (first on ${tab}): ${this._agent.name} <${this._agent.email}> id=${this._agent.id} status=${this._agent.status}`, 'text/plain');
});

Given('I have picked the first two agents listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  recorder(this);
  this._avPair = await pickFirst(this, tab, { count: 2 });
  this.attach(`Agents: ${this._avPair.map((a) => `${a.name} <${a.email}> id=${a.id}`).join(' then ')}`, 'text/plain');
});

// The listing's own Candidate Count filter narrows to agents holding candidates; it composes
// with the tab. Up to five pages are read so a tab whose first page holds only new agents still
// yields a subject.
Given('I have picked an agent on the {string} tab who holds candidates', { timeout: 180000 }, async function (tab) {
  recorder(this);
  let pick = null;
  for (let page = 1; page <= 5 && !pick; page += 1) {
    const result = await loadTab(this, tab, `candidateCount=1-50${page > 1 ? `&page=${page}` : ''}`);
    pick = rawAgents(result).find((a) => a.email && Number(a.total_candidate_count) > 0);
    if (!result.payload || !result.payload.next) break;
  }
  if (!pick) {
    throw new Error(`No agent on the "${tab}" tab holds a candidate, so this scenario has no subject. `
      + 'That is a missing fixture on DEV, not an app defect.');
  }
  this._agent = toSubject(pick);
  this.attach(`Subject (${tab}, holds candidates): ${this._agent.name} <${this._agent.email}> `
    + `id=${this._agent.id} candidates=${this._agent.candidates}`, 'text/plain');
});

// One throwaway per committing scenario: invited without a promo, no payment, abandoned
// afterwards (an agent cannot be deleted). A brand-new agent has onboarded nobody, so the server
// classes it as ATTENTION straight away - which is what lets one scenario reach it from the
// Requires Attention tab as well as from Active.
Given('I have provisioned a throwaway agent to manage from its profile', { timeout: 600000 }, async function () {
  const agent = await provisionAgentWithoutPromo(this.browser, {
    label: 'agent-view-throwaway',
    firstName: 'Viewprofile',
    tagPrefix: 'agview',
  });
  recorder(this);
  this._agent = { name: agent.name, email: agent.email, university: agent.university || '', candidates: 0, progress: null, cells: [] };
  this.attach(`Provisioned throwaway agent ${agent.name} <${agent.email}> - abandoned after the scenario.`, 'text/plain');
  await listing(this).goto('Active');
  await listing(this).waitForAgentOnTab('Active', { name: agent.name, email: agent.email });
});

// ==================== Opening the profile ====================

// Navigates to the tab, finds the agent's row there by searching its address (the subject may
// not be on the first page), and opens View on THAT row. Fills the same world fields
// steps/view-profile.js reads.
async function viewFromTab(world, tab, agent) {
  recorder(world);
  await loadTab(world, tab);
  const result = await listing(world).search(agent.email, { tab });
  world._lastList = result;
  const listed = rawAgents(result).find((a) => lc(a.email) === lc(agent.email));
  if (!listed) {
    throw new Error(`${agent.email} is not listed on the "${tab}" tab (searched by its address). `
      + `The server returned ${JSON.stringify(rawAgents(result).map((a) => `${a.email}:${a.status}`))}.`);
  }
  const since = mark(world);
  const writes = markWrites(world);
  await listing(world).openAgentProfile(agent.email);
  const id = profile(world).agentId();
  const prof = await waitFor(world, new RegExp(`^/agent/${id}/profile/`), { since });
  expect(prof, `GET /agent/${id}/profile/ was never made`).toBeTruthy();
  await expect(world.page.locator('main').first()).toContainText(clean(prof.body.name || agent.name), { timeout: 20000 });
  world._vpAgentId = id;
  world._vpProfile = prof.body;
  world._vpTarget = await waitFor(world, new RegExp(`^/agent/${id}/target-progress/`), { since, timeout: 15000 });
  world._avOpen = { tab, since, writes, listed };
  Object.assign(agent, { id: String(listed.id), status: listed.status, monthlyTarget: listed.monthly_target });
  return { id, listed, profile: prof.body, since };
}

When('I view that agent from the {string} tab and record what the server sends', { timeout: 150000 }, async function (tab) {
  if (!this._agent || !this._agent.email) throw new Error('No agent has been picked - a Given that picks one must run first.');
  const { id, profile: body } = await viewFromTab(this, tab, this._agent);
  this.attach(`Opened ${this._agent.email} from "${tab}" -> /agents/view/${id}\nProfile payload: ${JSON.stringify(body)}`, 'text/plain');
});

async function openByAddress(world, address) {
  recorder(world);
  const since = mark(world);
  await world.page.goto(`${ORIGIN}/agents/view/${address}`, { waitUntil: 'domcontentloaded' });
  return since;
}

When("I open that agent's profile by its address", { timeout: 90000 }, async function () {
  const since = await openByAddress(this, this._agent.id);
  // Let every panel request answer (or fail) before anything is read.
  await waitFor(this, new RegExp(`^/agent/${this._agent.id}/pending-verifications/`), { since, timeout: 20000 });
  await this.page.waitForTimeout(3000);
  this._avOpen = { since };
});

// ==================== Every tab: identity against the server ====================

Then("viewing the first agent of each tab should open that agent's profile, as the server describes it:",
  { timeout: 480000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const tab = row.tab.trim();
      const [agent] = await pickFirst(this, tab);
      const { id, listed, profile: p, since } = await viewFromTab(this, tab, agent);
      const header = await profile(this).readHeader();
      const lines = header.headerLines.map(clean);
      const pill = STATUS_LABEL[p.status] || p.status;
      const at = (s) => `${tab}: ${s}`;
      if (id !== String(listed.id)) problems.push(at(`the row clicked is agent ${listed.id}, the profile opened is ${id}`));
      if (lc(p.email) !== lc(listed.email)) problems.push(at(`the profile fetched ${p.email}, the row clicked is ${listed.email}`));
      const want = { name: clean(p.name), email: clean(p.email), university: clean(p.institution && p.institution.name), status: pill };
      for (const [field, value] of Object.entries(want)) {
        if (!value) problems.push(at(`the server holds no ${field} to compare against`));
        else if (!lines.some((l) => lc(l) === lc(value))) problems.push(at(`${field}: the server says "${value}", the header shows ${JSON.stringify(lines)}`));
      }
      if (!csv(row.statuses).some((s) => lc(s) === lc(pill))) {
        problems.push(at(`the profile says "${pill}", which is not a state the ${tab} tab lists (${row.statuses})`));
      }
      if (p.status !== listed.status) problems.push(at(`the listing holds status ${listed.status}, the profile ${p.status}`));
      // Every panel the profile loaded must be for the opened agent.
      const stray = recorder(this).log.slice(since)
        .map((e) => (e.path.match(/^\/agents?\/(\d+)\//) || [])[1])
        .filter((x) => x && x !== id);
      if (stray.length) problems.push(at(`the profile also requested data for agent(s) ${[...new Set(stray)].join(', ')}`));
      const menu = (await profile(this).headerMenuItems()).items.map((i) => i.label);
      const expectedMenu = csv(row.menu);
      if (menu.join('|').toLowerCase() !== expectedMenu.join('|').toLowerCase()) {
        problems.push(at(`the menu holds ${JSON.stringify(menu)}, expected ${JSON.stringify(expectedMenu)}`));
      }
      if (!header.actions.some((a) => /^edit target$/i.test(a))) problems.push(at('the profile offers no "Edit Target"'));
      // The listing's own status cell, recorded beside the pill: on the Active tab an ATTENTION
      // agent's row reads "Active" while its profile reads "Requires Attention" (measured). No AC
      // settles which word the row should use, so it is reported, not failed on.
      const rowCells = ((await listing(this).readRows().catch(() => [])) || []).find((r) => lc(r.email) === lc(agent.email));
      report.push(`${tab}: row ${listed.id} <${listed.email}> status=${listed.status} -> profile ${id} pill="${pill}" `
        + `menu=${JSON.stringify(menu)}${rowCells ? ` rowCells=${JSON.stringify(rowCells.cells)}` : ''}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'View did not open the clicked agent\'s own profile as the server describes it:');
  });

Then('every agent request the profile made should be for that agent only', async function () {
  const id = this._vpAgentId;
  const seen = recorder(this).log.slice(this._avOpen.since)
    .map((e) => (e.path.match(/^\/agents?\/(\d+)\//) || [])[1]).filter(Boolean);
  expect(seen.length, 'the profile made no agent request at all').toBeGreaterThan(0);
  expect([...new Set(seen)], `the profile of agent ${id} requested data for other agents`).toEqual([id]);
});

// ==================== Performance Overview against the server ====================

function sectionText(text, from, to) {
  const a = text.indexOf(from);
  if (a < 0) return '';
  const b = to ? text.indexOf(to, a + from.length) : -1;
  return text.slice(a, b > a ? b : undefined);
}

function readTarget(text) {
  const m = text.match(/Target Progress\s+(?:Monthly|Quarterly|Yearly|Year to Date)\b.*?(\d+(?:\.\d+)?)%\s+(\d+)\s+of\s+(\d+)\s+Candidates Onboarded/);
  return m ? { percent: Number(m[1]), onboarded: Number(m[2]), target: Number(m[3]) } : null;
}

// "888 SAR", "1,234 SAR" or "1.2K SAR" -> a number, or null.
function readRevenue(text) {
  const m = sectionText(text, 'Revenue Impact', 'Pending Verifications').match(/([\d.,]+)\s*([KkMm])?\s*SAR/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return m[2] ? { value: n * (/k/i.test(m[2]) ? 1000 : 1000000), approximate: true } : { value: n, approximate: false };
}

function compareCharts(text, onboarding, revenue) {
  const problems = [];
  const onb = sectionText(text, 'Candidate Onboarding', 'Revenue Impact');
  const rev = sectionText(text, 'Revenue Impact', 'Pending Verifications');
  if (onboarding) {
    const months = (onboarding.monthly_data || []).filter((m) => Number(m.count) > 0).map((m) => m.month);
    if (!Number(onboarding.total_onboarded)) {
      if (!/No data to display for candidate onboarding/i.test(onb)) problems.push(`Candidate Onboarding: the server reports nobody onboarded, the chart does not say so ("${onb.slice(0, 120)}")`);
    } else {
      if (/No data to display/i.test(onb)) problems.push(`Candidate Onboarding: the server reports ${onboarding.total_onboarded} onboarded, the chart says it has no data`);
      for (const m of months) if (!new RegExp(`\\b${m}\\b`).test(onb)) problems.push(`Candidate Onboarding: the server holds ${m}, the chart does not label it`);
    }
  }
  if (revenue) {
    const shown = readRevenue(text);
    const total = Number(revenue.total_revenue || 0);
    if (!shown) problems.push(`Revenue Impact: no "<amount> SAR" figure is shown ("${rev.slice(0, 120)}")`);
    else if (shown.approximate ? Math.abs(shown.value - total) > Math.max(100, total * 0.05) : shown.value !== total) {
      problems.push(`Revenue Impact: shows ${shown.value} SAR, the server says ${total}`);
    }
    if (!total && !/No data to display for revenue impact/i.test(rev)) problems.push('Revenue Impact: the server reports no revenue, the chart does not say so');
  }
  return problems;
}

Then("Performance Overview should show the server's figures for the first agent of each tab:",
  { timeout: 420000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const { tab } of table.hashes()) {
      const [agent] = await pickFirst(this, tab);
      const { id, since } = await viewFromTab(this, tab, agent);
      const get = (re) => waitFor(this, new RegExp(`^/agent/${id}/${re}`), { since, timeout: 20000 });
      const [target, pending, onboarding, revenue] = [await get('target-progress/'), await get('pending-verifications/'),
        await get('onboarding-trends/'), await get('revenue-impact/')];
      const at = (s) => `${tab} (${agent.email}): ${s}`;
      for (const [name, hit] of Object.entries({ 'target-progress': target, 'pending-verifications': pending, 'onboarding-trends': onboarding, 'revenue-impact': revenue })) {
        if (!hit) problems.push(at(`${name} was never requested`));
      }
      // The figures paint after their payloads land; poll the target block until it settles.
      let text = await mainText(this);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && target && (readTarget(text) || {}).target !== target.body.target) {
        await this.page.waitForTimeout(400);
        text = await mainText(this);
      }
      if (target) {
        const t = readTarget(text);
        if (!t) problems.push(at('Target Progress shows no "N% / A of B Candidates Onboarded" figure'));
        else {
          if (t.onboarded !== target.body.onboarded) problems.push(at(`Target Progress shows ${t.onboarded} onboarded, the server says ${target.body.onboarded}`));
          if (t.target !== target.body.target) problems.push(at(`Target Progress shows a target of ${t.target}, the server says ${target.body.target}`));
          if (Math.round(t.percent) !== Math.round(target.body.percentage)) problems.push(at(`Target Progress shows ${t.percent}%, the server says ${target.body.percentage}%`));
        }
      }
      if (pending) {
        const m = text.match(/Pending Verifications\s+(\d+)\s+Documents?/i);
        if (!m) problems.push(at('Pending Verifications shows no document total'));
        else if (Number(m[1]) !== pending.body.total_pending) problems.push(at(`Pending Verifications shows ${m[1]}, the server says ${pending.body.total_pending}`));
      }
      problems.push(...compareCharts(text, onboarding && onboarding.body, revenue && revenue.body).map(at));
      report.push(`${tab} -> agent ${id}: target ${JSON.stringify(target && target.body)} pending ${pending && pending.body && pending.body.total_pending} `
        + `onboarding ${JSON.stringify(onboarding && onboarding.body)} revenue ${JSON.stringify(revenue && revenue.body)}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Performance Overview does not show the server\'s figures:');
  });

// The three period triggers on Performance Overview, in DOM order: Target Progress,
// Candidate Onboarding, Revenue Impact. Re-located on every use - each one's label IS its
// current selection.
const CHART_TRIGGER = { target: 0, onboarding: 1, revenue: 2 };

async function choosePeriod(world, chart, label) {
  const trigger = world.page.locator('main button').filter({ hasText: PERIOD_RE }).nth(CHART_TRIGGER[chart]);
  if (clean(await trigger.innerText()) === label) return false;
  await trigger.click();
  await world.page.getByRole('option', { name: label, exact: true }).first().click();
  return true;
}

Then("Candidate Onboarding and Revenue Impact should re-query and show the server's figures for each period:",
  { timeout: 300000 }, async function (table) {
    const id = this._vpAgentId;
    const problems = [];
    const report = [];
    for (const { period, duration } of table.hashes()) {
      const result = {};
      for (const [chart, endpoint, param] of [['onboarding', 'onboarding-trends', 'onboardingDuration'], ['revenue', 'revenue-impact', 'revenueDuration']]) {
        const since = mark(this);
        const changed = await choosePeriod(this, chart, period);
        const forDuration = new RegExp(`^/agent/${id}/${endpoint}/\\?.*duration=${duration}(&|$)`);
        // A period already fetched is re-rendered from the app's cache with NO request (measured:
        // Monthly, fetched when the profile opened, is not asked for again). So a new request is
        // required only for a period not seen before; otherwise the earlier answer is the one the
        // render must match.
        const seenBefore = changed && recorder(this).log.slice(0, since).some((e) => forDuration.test(e.path));
        const hit = changed && !seenBefore
          ? await waitFor(this, new RegExp(`^/agent/${id}/${endpoint}/`), { since, timeout: 15000 })
          : await waitFor(this, forDuration, { timeout: 1000 });
        if (!hit) { problems.push(`${period} ${chart}: no ${endpoint} request was made`); continue; }
        const got = new URL(hit.url).searchParams.get('duration');
        if (got !== duration) problems.push(`${period} ${chart}: requested duration=${got}, expected ${duration}`);
        const inUrl = new URL(this.page.url()).searchParams.get(param);
        if (changed && inUrl !== duration && !(duration === 'current_month' && inUrl === null)) {
          problems.push(`${period} ${chart}: the URL records ${param}=${inUrl}`);
        }
        result[chart] = hit.body;
      }
      await this.page.waitForTimeout(800);
      const text = await mainText(this);
      problems.push(...compareCharts(text, result.onboarding, result.revenue).map((p) => `${period}: ${p}`));
      report.push(`${period}: onboarding ${JSON.stringify(result.onboarding)} | revenue ${JSON.stringify(result.revenue)} | url ${this.page.url().replace(ORIGIN, '')}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Candidate Onboarding / Revenue Impact did not re-query or render the server\'s answer:');
  });

// Measured: the comparison line reads "vs last month" for EVERY period, Yearly included. It pins
// no replacement wording - only that a non-monthly period is not compared "vs last month".
Then('the Revenue Impact comparison should name the period chosen:', { timeout: 180000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { period } of table.hashes()) {
    await choosePeriod(this, 'revenue', period);
    await this.page.waitForTimeout(2500);
    const rev = sectionText(await mainText(this), 'Revenue Impact', 'Pending Verifications');
    const vs = (rev.match(/vs\s+(?:last|previous|prior)\s+(?:month|quarter|year|period)/i) || [''])[0];
    report.push(`${period}: "${vs || '(no comparison shown)'}"`);
    if (period === 'Monthly') {
      if (!/vs last month/i.test(vs)) problems.push(`Monthly: compares "${vs}", expected "vs last month"`);
    } else if (/vs last month/i.test(vs)) {
      problems.push(`${period}: the figure is for ${period} but is still compared "${vs}"`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'Revenue Impact\'s comparison does not follow the period chosen:');
});

// ==================== Promo Tools ====================

// The server's promo status as the tab words it. Exhaustion is "Used" on the wire and "Inactive"
// on the tab (measured; the promo module records the same word for an exhausted promo), so the
// raw value cannot be compared with the label.
const PROMO_STATUS_LABEL = { Used: 'Inactive' };

// What GET /agents/<id>/promotion/ answered for the profile now open. The profile fetches it when
// it OPENS, not when the tab is selected (measured), so the recorder already holds it.
async function promotionFor(world, id, since = 0) {
  return waitFor(world, new RegExp(`^/agents/${id}/promotion/`), { since, timeout: 20000 });
}

async function expectPromoTabMatches(world, id, hit) {
  const problems = [];
  const body = hit && hit.body;
  const text = await mainText(world);
  const promo = promoTools(world);
  if (!hit) return [`agent ${id}: GET /agents/${id}/promotion/ was never made`];
  if (body && body.code) {
    await promo.editParametersButton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    if (!text.includes(body.code) && !(await mainText(world)).includes(body.code)) problems.push(`the server's promo ${body.code} is not shown`);
    const status = await promo.readParameter('Status');
    const label = PROMO_STATUS_LABEL[body.status] || body.status;
    if (body.status && lc(status) !== lc(label)) problems.push(`Status shows "${status}", the server says "${body.status}" (shown as "${label}")`);
    if (!(await promo.editParametersButton.isVisible().catch(() => false))) problems.push('a promo is assigned but "Edit parameters" is not offered');
  } else {
    await promo.addPromoCodeButton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const empty = await promo.readEmptyState();
    if (!empty.message || !empty.cta) problems.push(`the server holds no promo (${JSON.stringify(body)}), the tab does not show its empty state: ${JSON.stringify(empty)}`);
  }
  return problems;
}

async function openPromoTab(world) {
  await profile(world).openTab('Promo Tools');
}

Then("the Promo Tools tab should show each agent's own promo as the server holds it:", { timeout: 420000 }, async function (table) {
  const problems = [];
  const report = [];
  let withPromo = 0;
  let without = 0;
  for (const row of table.hashes()) {
    const tab = row.tab.trim();
    const key = row.agent.trim();
    let agent;
    if (/^first listed$/i.test(key)) [agent] = await pickFirst(this, tab);
    else {
      const email = process.env[key];
      if (!email) throw new Error(`.env has no ${key}, so the "${tab}" row has no subject.`);
      agent = { email, name: email };
    }
    const { id, since } = await viewFromTab(this, tab, agent);
    const hit = await promotionFor(this, id, since);
    await openPromoTab(this);
    const p = await expectPromoTabMatches(this, id, hit);
    problems.push(...p.map((x) => `${tab} (${agent.email}): ${x}`));
    if (hit && hit.body && hit.body.code) withPromo += 1; else without += 1;
    report.push(`${tab} ${agent.email} -> agent ${id}: ${JSON.stringify(hit && hit.body)}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  if (!withPromo || !without) {
    problems.push(`the table covered ${withPromo} agent(s) with a promo and ${without} without - both cases are needed, `
      + 'so the fixture (PROMO_UNLIMITED_AGENT_EMAIL, or the first listed agents) has drifted');
  }
  fail(problems, 'The Promo Tools tab does not show the opened agent\'s promo as the server holds it:');
});

Then("the profile's Promo Tools tab should show what the server holds for that agent", { timeout: 90000 }, async function () {
  const id = this._vpAgentId;
  if (!/promo tools/i.test(await profile(this).selectedTab())) await openPromoTab(this);
  const hit = await promotionFor(this, id);
  this.attach(`GET /agents/${id}/promotion/ -> ${JSON.stringify(hit && hit.body)}`, 'text/plain');
  fail(await expectPromoTabMatches(this, id, hit), 'The Promo Tools tab does not show what the server holds:');
});

Then("the profile's Promo Tools tab should offer a way to add or edit that agent's promo", { timeout: 60000 }, async function () {
  const promo = promoTools(this);
  const add = promo.addPromoCodeButton;
  const edit = promo.editParametersButton;
  await add.or(edit).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const offered = (await add.isVisible().catch(() => false)) ? add : edit;
  expect(await offered.isVisible().catch(() => false), 'the Promo Tools tab offers neither "Add Promo Code" nor "Edit parameters"').toBe(true);
  expect(await offered.isEnabled(), 'the Promo Tools action is offered but disabled').toBe(true);
});

// ==================== Header actions per state (read-only) ====================

Then('the profile should offer an enabled {string}', async function (label) {
  const control = this.page.locator('main').getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(control, `the profile does not offer "${label}"`).toBeVisible({ timeout: 15000 });
  await expect(control, `"${label}" is offered but disabled`).toBeEnabled();
});

Then("the profile's menu should offer only its lifecycle action {string}", { timeout: 60000 }, async function (label) {
  const items = (await profile(this).headerMenuItems()).items.map((i) => i.label);
  expect(items, `the profile's menu holds ${JSON.stringify(items)}`).toEqual([label]);
});

const MENU_ITEM = { deactivate: /^deactivate$/i, reactivate: /^re-?activate( account)?$/i };
const DIALOG_TEXT = { deactivate: /deactivate agent account/i, reactivate: /re-?activate account/i };

function lifecycleDialog(world, action) {
  return world.page.locator('[role="dialog"]').filter({ hasText: DIALOG_TEXT[lc(action)] }).last();
}

async function chooseFromMenu(world, action) {
  const key = lc(action);
  if (!MENU_ITEM[key]) throw new Error(`Unknown profile menu action "${action}" - expected Deactivate or Reactivate.`);
  await world.page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
  const item = world.page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: MENU_ITEM[key] }).first();
  await item.waitFor({ state: 'visible', timeout: 15000 });
  await item.click();
  await lifecycleDialog(world, action).waitFor({ state: 'visible', timeout: 20000 });
  await world.page.waitForTimeout(500);
}

When("I choose {string} from the profile's menu", { timeout: 60000 }, async function (action) {
  this._avDialogAction = action;
  this._avDialogWrites = markWrites(this);
  await chooseFromMenu(this, action);
});

Then("the profile's lifecycle dialog should be {string} and name that agent", async function (heading) {
  const dialog = lifecycleDialog(this, this._avDialogAction);
  const text = clean(await dialog.innerText());
  this.attach(`Dialog: ${text}`, 'text/plain');
  expect(text, `the dialog does not read "${heading}"`).toMatch(new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  expect(lc(text), `the dialog does not name ${this._vpProfile.name}`).toContain(lc(this._vpProfile.name));
});

Then("the profile's lifecycle dialog should say the agent is currently {string}", async function (state) {
  const text = clean(await lifecycleDialog(this, this._avDialogAction).innerText());
  expect(lc(text), `the dialog does not name the agent's address ${this._vpProfile.email}`).toContain(lc(this._vpProfile.email));
  expect(text, `the dialog does not state the current status "${state}"`).toContain(state);
});

async function dismiss(world, dialog, method) {
  const how = lc(method);
  if (how === 'cancel') await dialog.getByRole('button', { name: /^cancel$/i }).first().click();
  else if (how === 'x icon') await dialog.getByRole('button', { name: /^close$/i }).first().click();
  else if (how === 'escape') await world.page.keyboard.press('Escape');
  else throw new Error(`Unknown way to leave a dialog "${method}" - expected Cancel, X icon or Escape.`);
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  return dialog.isVisible().catch(() => false);
}

Then("leaving the profile's {string} dialog each of these ways should change nothing:", { timeout: 240000 }, async function (action, table) {
  const id = this._vpAgentId;
  const before = this._vpProfile.status;
  const writes = this._avDialogWrites !== undefined ? this._avDialogWrites : markWrites(this);
  const problems = [];
  for (const { method } of table.hashes()) {
    const dialog = lifecycleDialog(this, action);
    if (!(await dialog.isVisible().catch(() => false))) await chooseFromMenu(this, action);
    if (await dismiss(this, dialog, method)) problems.push(`${method}: the dialog is still open`);
    if (!new RegExp(`/agents/view/${id}`).test(this.page.url())) problems.push(`${method}: leaving the dialog navigated to ${this.page.url()}`);
  }
  const sent = agentWritesSince(this, writes);
  if (sent.length) problems.push(`leaving the dialog SENT ${sent.map((w) => `${w.method} ${w.path} -> ${w.status}`).join('; ')}`);
  const since = mark(this);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  const prof = await waitFor(this, new RegExp(`^/agent/${id}/profile/`), { since });
  if (!prof) problems.push('the profile could not be re-read after the dialog was left');
  else if (prof.body.status !== before) problems.push(`the agent was ${before} and is now ${prof.body.status}`);
  else {
    await expect(this.page.locator('main').first()).toContainText(STATUS_LABEL[before], { timeout: 15000 }).catch(() => {});
    const pill = (await profile(this).readHeader()).statusPill;
    if (lc(pill) !== lc(STATUS_LABEL[before])) problems.push(`the profile now says "${pill}", it said "${STATUS_LABEL[before]}"`);
  }
  fail(problems, `Leaving the "${action}" dialog was not free of consequences:`);
});

// ==================== Edit Target (read-only: Save is never clicked) ====================

function editDialog(world) {
  return world.page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first();
}

async function openEdit(world) {
  await profile(world).openEditTarget();
  return editDialog(world);
}

// Real keystrokes: the field validates on input, and a scripted value set does not run the
// form's validator.
async function typeTarget(world, dialog, value) {
  const input = dialog.locator('input').first();
  await input.click();
  await world.page.keyboard.press('ControlOrMeta+a');
  await world.page.keyboard.press('Backspace');
  if (value !== '') await world.page.keyboard.type(value);
  await world.page.waitForTimeout(500);
  return input;
}

async function readEditState(dialog) {
  return dialog.evaluate((el) => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const save = Array.from(el.querySelectorAll('button')).find((b) => /save changes/i.test(c(b.innerText)));
    const input = el.querySelector('input');
    return {
      value: input ? input.value : null,
      saveDisabled: save ? save.disabled : null,
      lines: Array.from(el.querySelectorAll('p,span')).filter((e) => !e.children.length).map((e) => c(e.innerText)).filter(Boolean),
    };
  });
}

Then('Edit Target should explain each unusable target inline, keep Save disabled and send nothing:',
  { timeout: 180000 }, async function (table) {
    const writes = markWrites(this);
    const dialog = await openEdit(this);
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const target = unquote(row.target);
      await typeTarget(this, dialog, target);
      const state = await readEditState(dialog);
      report.push(`${JSON.stringify(target)}: held ${JSON.stringify(state.value)}, Save disabled ${state.saveDisabled}, lines ${JSON.stringify(state.lines)}`);
      if (state.saveDisabled !== true) problems.push(`${JSON.stringify(target)}: "Save Changes" is ENABLED`);
      if (!state.lines.includes(row.message)) problems.push(`${JSON.stringify(target)}: expected the inline message "${row.message}", the dialog shows ${JSON.stringify(state.lines)}`);
    }
    await profile(this).cancelEditTarget();
    const sent = agentWritesSince(this, writes);
    if (sent.length) problems.push(`the dialog SENT ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`);
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Edit Target does not refuse every unusable target inline:');
  });

Then('Edit Target should refuse a target of {string} before it is sent', { timeout: 90000 }, async function (value) {
  const writes = markWrites(this);
  const dialog = await openEdit(this);
  await typeTarget(this, dialog, value);
  const state = await readEditState(dialog);
  await profile(this).cancelEditTarget();
  this.attach(`Typed ${value}: ${JSON.stringify(state)}`, 'text/plain');
  expect(agentWritesSince(this, writes), 'the dialog sent a request without Save being clicked').toEqual([]);
  const refused = state.saveDisabled === true || state.lines.some((l) => /target|maximum|too (large|big|high)|exceed/i.test(l));
  expect(refused, `"${value}" is accepted with "Save Changes" enabled and no message, and the server answers it with `
    + 'HTTP 500 "An unexpected error occurred" (measured on a throwaway agent). The form should refuse it, or state a maximum, '
    + 'before anything is sent.').toBe(true);
});

Then('leaving Edit Target each of these ways should discard a typed target and send nothing:', { timeout: 180000 }, async function (table) {
  const writes = markWrites(this);
  const original = String(this._vpProfile.monthly_target);
  const problems = [];
  const report = [];
  for (const { method } of table.hashes()) {
    const dialog = await openEdit(this);
    const opened = (await readEditState(dialog)).value;
    if (opened !== original) problems.push(`${method}: Edit Target opened holding ${opened}, the server's target is ${original}`);
    const typed = String(Number(original) + 7);
    await typeTarget(this, dialog, typed);
    if (await dismiss(this, dialog, method)) { problems.push(`${method}: the dialog is still open`); await profile(this).cancelEditTarget(); continue; }
    const again = await openEdit(this);
    const held = (await readEditState(again)).value;
    report.push(`${method}: opened ${opened}, typed ${typed}, reopened ${held}`);
    if (held !== original) problems.push(`${method}: after leaving, Edit Target reopens holding ${held}, not the saved ${original}`);
    await profile(this).cancelEditTarget();
  }
  // Recorded, not asserted: a click outside the dialog does NOT close it (measured), while the
  // lifecycle dialogs and Send Reminder do close that way. No AC says which is right.
  const sent = agentWritesSince(this, writes);
  if (sent.length) problems.push(`leaving the dialog SENT ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`);
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'Leaving Edit Target did not discard the typed target:');
});

// ==================== Addresses and failures ====================

async function anyAgentId(world) {
  if (world._agent && world._agent.id) return world._agent.id;
  const [a] = await pickFirst(world, 'Active');
  return a.id;
}

Then('opening each of these agent profile addresses should say the profile was not found:', { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const address = row.address.includes('<agent id>') ? row.address.replace('<agent id>', await anyAgentId(this)) : row.address.trim();
    const since = await openByAddress(this, address);
    const notFound = this.page.getByText('Profile not found.', { exact: true }).first();
    const shown = await notFound.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    await this.page.waitForTimeout(1500);
    const header = await profile(this).readHeader();
    const answers = recorder(this).log.slice(since).filter((e) => /^\/agents?\/[^/]+\//.test(e.path) && !/notifications/.test(e.path));
    const ok = answers.filter((e) => e.status < 400);
    report.push(`/agents/view/${address}: notFound=${shown} header email=${JSON.stringify(header.email)} `
      + `answers=${JSON.stringify(answers.map((e) => `${e.status} ${e.path}`))}`);
    if (!shown) problems.push(`/agents/view/${address}: "Profile not found." is not shown`);
    if (header.email) problems.push(`/agents/view/${address}: an agent identity is shown (${header.email})`);
    if (ok.length) problems.push(`/agents/view/${address}: the server answered an agent request successfully: ${ok.map((e) => e.path).join(', ')}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'An unusable profile address did not say the profile was not found:');
});

Then("opening that agent's profile at each of these addresses should show that agent:", { timeout: 240000 }, async function (table) {
  const agent = this._agent;
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const address = row.address.replace('<agent id>', agent.id);
    await openByAddress(this, address);
    const header = await profile(this).readHeader();
    let selected = '';
    const allowed = csv(row['tab is one of']);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !allowed.includes(selected)) {
      selected = await profile(this).selectedTab();
      if (!allowed.includes(selected)) await this.page.waitForTimeout(400);
    }
    report.push(`/agents/view/${address}: email=${header.email} selected="${selected}" url=${this.page.url().replace(ORIGIN, '')}`);
    if (lc(header.email) !== lc(agent.email)) problems.push(`/agents/view/${address}: shows ${JSON.stringify(header.email)}, not ${agent.email}`);
    if (!allowed.includes(selected)) problems.push(`/agents/view/${address}: selected "${selected}", expected one of ${allowed.join(', ')}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A variant of the profile address did not open the right agent:');
});

Given('the agent profile request will fail with a server error', async function () {
  await this.page.route(/\/api\/v1\/agent\/\d+\/profile\/(\?|$)/, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Simulated server error"}' })
    : route.continue()));
});

Given('the Target Progress request will fail with a server error', async function () {
  await this.page.route(/\/api\/v1\/agent\/\d+\/target-progress\//, (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: '{"detail":"Simulated server error"}',
  }));
});

// Pins no wording: a failure has to be presented as a failure (an error, "could not load", a
// retry...), and must not be presented as the profile not existing.
Then('the profile should report that it could not be loaded rather than that it does not exist', async function () {
  const text = await mainText(this);
  this.attach(`Rendered after a 500 on the profile request: ${text.slice(0, 600)}`, 'text/plain');
  const problems = [];
  if (/profile not found/i.test(text)) problems.push('a server failure is presented as "Profile not found." - the profile exists, it could not be loaded');
  if (!/could ?n[o']t|failed|error|unable|try again|something went wrong/i.test(text)) problems.push('nothing on the page says the profile failed to load');
  fail(problems, 'A failed profile load is not reported as a failure:');
});

Then('Target Progress should not present the failed load as figures', async function () {
  const text = await mainText(this);
  const t = readTarget(text);
  this.attach(`Target Progress after a 500: ${sectionText(text, 'Target Progress', 'Candidate Onboarding').slice(0, 300)}`, 'text/plain');
  expect(t, `Target Progress failed to load, yet it shows "${t && `${t.percent}% / ${t.onboarded} of ${t.target}`}" - `
    + 'figures the server never sent, read as the agent having onboarded nobody against a target of 0').toBeNull();
});

// ==================== Two agents in turn ====================

When('I view the first picked agent, go Back, and view the second', { timeout: 240000 }, async function () {
  const [first, second] = this._avPair;
  await viewFromTab(this, 'Active', first);
  await profile(this).clickBack();
  this._lastList = await listing(this).search(second.email);
  const since = mark(this);
  await listing(this).clickRowAction(second.email, 'View');
  const samples = [];
  const start = Date.now();
  for (const wait of [150, 400, 800, 1500, 3000, 5000]) {
    await this.page.waitForTimeout(Math.max(0, wait - (Date.now() - start)));
    samples.push({ at: Date.now() - start, url: this.page.url(), text: await mainText(this) });
  }
  this._avSamples = { since, samples };
});

Then('the profile should show only the second agent at every moment it is sampled', async function () {
  const [first, second] = this._avPair;
  const { since, samples } = this._avSamples;
  const problems = [];
  for (const s of samples) {
    if (lc(s.text).includes(lc(first.email))) problems.push(`+${s.at}ms: the profile still shows the first agent's address ${first.email}`);
    if (s.url.includes(`/agents/view/${first.id}`)) problems.push(`+${s.at}ms: the URL is still the first agent's (${s.url})`);
  }
  const last = samples[samples.length - 1];
  if (!lc(last.text).includes(lc(second.email))) problems.push(`after ${last.at}ms the profile does not show ${second.email}`);
  if (!last.url.includes(`/agents/view/${second.id}`)) problems.push(`the second profile opened at ${last.url}, expected agent ${second.id}`);
  const ids = [...new Set(recorder(this).log.slice(since).map((e) => (e.path.match(/^\/agents?\/(\d+)\//) || [])[1]).filter(Boolean))];
  if (ids.some((id) => id !== second.id)) problems.push(`opening the second agent requested data for ${JSON.stringify(ids)}`);
  this.attach(samples.map((s) => `+${s.at}ms ${s.url.replace(ORIGIN, '')} ${s.text.slice(0, 160)}`).join('\n'), 'text/plain');
  fail(problems, 'Opening a second agent did not show that agent alone:');
});

// ==================== Browser history, new tab, keyboard ====================

Then('browser Back should return to the Agents listing and Forward should restore the {string} tab', { timeout: 90000 }, async function (tab) {
  const agent = this._agent;
  // Measured: profile tab changes REPLACE the history entry, so one Back leaves the profile.
  await this.page.goBack({ waitUntil: 'domcontentloaded' });
  await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 }).catch(() => {});
  const back = this.page.url();
  await this.page.goForward({ waitUntil: 'domcontentloaded' });
  await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 }).catch(() => {});
  let selected = '';
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && selected !== tab) {
    selected = await profile(this).selectedTab();
    if (selected !== tab) await this.page.waitForTimeout(400);
  }
  const header = await profile(this).readHeader();
  this.attach(`Back -> ${back}\nForward -> ${this.page.url()} (selected "${selected}", ${header.email})`, 'text/plain');
  const problems = [];
  if (!/\/agents(\?|$)/.test(back) || /\/agents\/view\//.test(back)) problems.push(`Back went to ${back}, not the Agents listing`);
  if (!new RegExp(`/agents/view/${agent.id}`).test(this.page.url())) problems.push(`Forward went to ${this.page.url()}, not agent ${agent.id}'s profile`);
  if (selected !== tab) problems.push(`Forward restored the "${selected}" tab, not "${tab}"`);
  if (lc(header.email) !== lc(agent.email)) problems.push(`Forward shows ${header.email}, not ${agent.email}`);
  fail(problems, 'Browser history did not move in and out of the profile as expected:');
});

Then("that agent's profile address opened in a new browser tab should show that agent", { timeout: 90000 }, async function () {
  const agent = this._agent;
  const tab = await this.context.newPage();
  try {
    const AgentProfilePage = require('../pages/AgentProfilePage');
    await tab.goto(`${ORIGIN}/agents/view/${agent.id}`, { waitUntil: 'domcontentloaded' });
    const header = await new AgentProfilePage(tab).readHeader();
    this.attach(`New tab ${tab.url()}: ${JSON.stringify(header.headerLines)}`, 'text/plain');
    expect(tab.url(), 'the new tab did not stay on the profile (signed out?)').toMatch(new RegExp(`/agents/view/${agent.id}`));
    expect(lc(header.email), `the new tab shows ${JSON.stringify(header.email)}`).toBe(lc(agent.email));
    expect(header.text).toContain(agent.name);
  } finally {
    await tab.close().catch(() => {});
  }
});

Then("View should open the row's agent from the keyboard on each of these tabs:", { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { tab } of table.hashes()) {
    const [agent] = await pickFirst(this, tab);
    const row = this.page.locator('[role="row"]', { hasText: agent.email }).first();
    await row.focus();
    let presses = 0;
    let onView = false;
    for (; presses < 15 && !onView; presses += 1) {
      await this.page.keyboard.press('ArrowRight');
      await this.page.waitForTimeout(120);
      onView = await this.page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('aria-label')) === 'View');
    }
    if (!onView) { problems.push(`${tab}: ArrowRight from the focused row never reached View`); continue; }
    await this.page.keyboard.press('Enter');
    const opened = await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 20000 }).then(() => true).catch(() => false);
    const id = profile(this).agentId();
    report.push(`${tab}: View reached after ${presses} ArrowRight; Enter -> ${this.page.url().replace(ORIGIN, '')}`);
    if (!opened) problems.push(`${tab}: Enter on View opened nothing (${this.page.url()})`);
    else if (id !== agent.id) problems.push(`${tab}: Enter opened agent ${id}, the focused row is agent ${agent.id}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'View cannot be reached and used from the keyboard on every tab:');
});

// ==================== Committing (throwaway agents only) ====================

function throwawayGuard(world) {
  const email = world._agent && world._agent.email;
  if (!/\+agview/i.test(String(email))) {
    throw new Error(`Refusing to change ${email}: committing steps in this file only act on a throwaway agent `
      + 'minted by "I have provisioned a throwaway agent to manage from its profile".');
  }
}

async function ensureOnProfile(world) {
  const id = world._vpAgentId;
  if (!new RegExp(`/agents/view/${id}(\\?|$)`).test(world.page.url())) {
    await openByAddress(world, id);
    await expect(world.page.locator('main').first()).toContainText(world._agent.email, { timeout: 20000 });
  }
}

async function toastsWithin(world, ms = 8000) {
  const seen = new Set();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const now = await world.page.evaluate(() => Array.from(document.querySelectorAll('.app-toast, .Toastify__toast, [role="alert"], [role="status"]'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    now.forEach((t) => seen.add(t));
    if (seen.size) break;
    await world.page.waitForTimeout(250);
  }
  return [...seen];
}

When('I save a monthly target of {int} from the profile', { timeout: 90000 }, async function (n) {
  throwawayGuard(this);
  await ensureOnProfile(this);
  const id = this._vpAgentId;
  const dialog = await openEdit(this);
  await typeTarget(this, dialog, String(n));
  const response = this.page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/agent/${id}/profile/`).test(r.url()), { timeout: 20000 });
  await dialog.getByRole('button', { name: /^save changes$/i }).first().click();
  const r = await response;
  this._avSave = {
    status: r.status(),
    request: JSON.parse(r.request().postData() || '{}'),
    body: await r.json().catch(() => null),
    toasts: await toastsWithin(this),
    dialogOpen: await dialog.isVisible().catch(() => false),
  };
  this.attach(`Edit Target save: ${JSON.stringify(this._avSave)}`, 'text/plain');
});

Then('the server should have saved a monthly target of {int} and the profile confirmed it', async function (n) {
  const s = this._avSave;
  const problems = [];
  if (s.status !== 200) problems.push(`the save answered HTTP ${s.status}`);
  if (s.request.monthly_target !== n) problems.push(`the save sent ${JSON.stringify(s.request)}, not monthly_target ${n}`);
  if (!s.body || s.body.monthly_target !== n) problems.push(`the server answered monthly_target ${s.body && s.body.monthly_target}`);
  if (!s.toasts.some((t) => /target updated/i.test(t))) problems.push(`no "Target updated." confirmation; toasts ${JSON.stringify(s.toasts)}`);
  if (s.dialogOpen) problems.push('Edit Target is still open after saving');
  fail(problems, 'Saving the monthly target from the profile did not take effect:');
});

Then('Target Progress should measure the agent against a target of {int}', { timeout: 60000 }, async function (n) {
  let t = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    t = readTarget(await mainText(this));
    if (t && t.target === n) break;
    await this.page.waitForTimeout(400);
  }
  expect(t && t.target, `Target Progress measures against ${t && t.target}, not the saved ${n}`).toBe(n);
});

Then('Edit Target should reopen holding {int}', { timeout: 60000 }, async function (n) {
  const dialog = await openEdit(this);
  const held = (await readEditState(dialog)).value;
  await profile(this).cancelEditTarget();
  expect(held, 'Edit Target does not reopen holding the target just saved').toBe(String(n));
});

Then('after a reload the server should still hold a monthly target of {int}', { timeout: 90000 }, async function (n) {
  await ensureOnProfile(this);
  const id = this._vpAgentId;
  const since = mark(this);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  const prof = await waitFor(this, new RegExp(`^/agent/${id}/profile/`), { since });
  const target = await waitFor(this, new RegExp(`^/agent/${id}/target-progress/`), { since });
  this.attach(`After reload: profile ${JSON.stringify(prof && prof.body)}\ntarget-progress ${JSON.stringify(target && target.body)}`, 'text/plain');
  expect(prof && prof.body.monthly_target, 'the server does not hold the saved monthly target').toBe(n);
  expect(target && target.body.target, 'Target Progress is not measured against the saved target').toBe(n);
});

Then('the Agents listing should hold a monthly target of {int} for that agent', { timeout: 120000 }, async function (n) {
  const agent = this._agent;
  await loadTab(this, 'Active');
  const result = await listing(this).search(agent.email);
  const listed = rawAgents(result).find((a) => lc(a.email) === lc(agent.email));
  expect(listed, `${agent.email} is not on the Active tab`).toBeTruthy();
  expect(listed.monthly_target, 'the Agents listing holds a different monthly target').toBe(n);
  expect((listed.monthly_progress || {}).target, 'the listing measures progress against a different target').toBe(n);
});

async function commitLifecycle(world, action) {
  throwawayGuard(world);
  await ensureOnProfile(world);
  const id = world._vpAgentId;
  await chooseFromMenu(world, action);
  const dialog = lifecycleDialog(world, action);
  const deactivate = lc(action) === 'deactivate';
  const confirm = dialog.getByRole('button', { name: deactivate ? /^deactivate$/i : /^re-?activate account$/i }).first();
  // Never the transfer variant: a transfer moves real candidates and nothing undoes it. A
  // throwaway holds none, so the direct button is the only one that may be pressed here.
  await expect(confirm, `the direct ${action} button is not offered`).toBeEnabled({ timeout: 15000 });
  const endpoint = deactivate ? 'deactivate' : 'reactivate';
  const response = world.page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/agent/${id}/${endpoint}/`).test(r.url()), { timeout: 30000 });
  await confirm.click();
  const r = await response;
  const result = { status: r.status(), body: await r.text().catch(() => ''), toasts: await toastsWithin(world) };
  world.attach(`${action} from the profile: ${JSON.stringify(result)}`, 'text/plain');
  expect(r.status(), `${action} answered HTTP ${r.status()}: ${result.body}`).toBe(200);
  const confirmed = deactivate ? /account deactivated successfully/i : /account reactivated successfully/i;
  expect(result.toasts.some((t) => confirmed.test(t)), `no ${action} confirmation; toasts ${JSON.stringify(result.toasts)}`).toBe(true);
  await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
}

When('I deactivate that agent from its profile', { timeout: 120000 }, async function () {
  await commitLifecycle(this, 'Deactivate');
});

When('I reactivate that agent from its profile', { timeout: 120000 }, async function () {
  await commitLifecycle(this, 'Reactivate');
});

async function expectStateAndMenu(world, pills, menu) {
  let pill = '';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !pills.some((p) => lc(p) === lc(pill))) {
    pill = (await profile(world).readHeader()).statusPill;
    if (!pills.some((p) => lc(p) === lc(pill))) await world.page.waitForTimeout(500);
  }
  const items = (await profile(world).headerMenuItems()).items.map((i) => i.label);
  const problems = [];
  if (!pills.some((p) => lc(p) === lc(pill))) problems.push(`the profile says "${pill}", expected ${pills.join(' or ')}`);
  if (items.join('|').toLowerCase() !== menu.join('|').toLowerCase()) problems.push(`the menu holds ${JSON.stringify(items)}, expected ${JSON.stringify(menu)}`);
  fail(problems, 'The profile does not reflect the agent\'s new state:');
}

Then('the profile should show the agent as {string} with only {string} in its menu', { timeout: 90000 }, async function (state, item) {
  await expectStateAndMenu(this, [state], [item]);
});

Then('the profile should show the agent as active with {string} in its menu', { timeout: 90000 }, async function (items) {
  await expectStateAndMenu(this, ['Active', 'Requires Attention'], csv(items));
});

// ---------- Promo Tools, committing ----------

When("I add a promo from the profile's Promo Tools tab with:", { timeout: 180000 }, async function (table) {
  throwawayGuard(this);
  const promo = promoTools(this);
  if (!/promo tools/i.test(await profile(this).selectedTab())) await openPromoTab(this);
  await promo.addPromoCodeButton.waitFor({ state: 'visible', timeout: 30000 });
  const writes = markWrites(this);
  await promo.openAddParameters();
  for (const { field, value } of table.hashes()) {
    const relative = String(value).match(/^\+(\d+)\s*days?$/i);
    const v = relative ? isoDaysFromToday(Number(relative[1])) : value;
    if (/incentive/i.test(field)) await promo.setIncentive(v);
    else if (/^value$/i.test(field)) await promo.setValue(v);
    else if (/usage/i.test(field)) await promo.setUsageLimit(v);
    else if (/expiry/i.test(field)) await promo.setExpiryDate(v);
    else throw new Error(`Unknown promo field "${field}" - use Incentive Type, Value, Usage Limit or Expiry Date.`);
  }
  await promo.saveChanges();
  this._avPromoSave = { writes, toast: promo.lastSaveToast };
});

When("I change the profile promo's value to {int}", { timeout: 180000 }, async function (n) {
  throwawayGuard(this);
  const promo = promoTools(this);
  const writes = markWrites(this);
  promo.lastSaveToast = undefined;
  await promo.openEditParameters();
  await promo.setValue(String(n));
  await promo.saveChanges();
  this._avPromoSave = { writes, toast: promo.lastSaveToast };
});

When("I set the profile promo's status to {string}", { timeout: 180000 }, async function (status) {
  throwawayGuard(this);
  const promo = promoTools(this);
  const writes = markWrites(this);
  promo.lastSaveToast = undefined;
  const { changed } = await promo.setStatusAndSave(lc(status) === 'active');
  expect(changed, `the promo was already "${status}", so nothing was saved`).toBe(true);
  this._avPromoSave = { writes, toast: promo.lastSaveToast };
});

Then('the promo save should be confirmed', async function () {
  const s = this._avPromoSave;
  const sent = this._avWrites.slice(s.writes).filter((w) => /\/agents\/\d+\/promotion\//.test(w.path));
  const bodies = await Promise.all(sent.map(async (w) => `${w.method} ${w.status} ${w.path} req=${w.request} res=${String(await w.body).slice(0, 300)}`));
  this.attach(`Promo save: toast ${JSON.stringify(s.toast)}\n${bodies.join('\n')}`, 'text/plain');
  expect(sent.length, 'saving the promo sent nothing to /agents/<id>/promotion/').toBeGreaterThan(0);
  expect(sent.every((w) => w.status >= 200 && w.status < 300), `the promo save was refused: ${bodies.join('; ')}`).toBe(true);
  expect(s.toast, 'no confirmation was shown for the promo save').toMatch(/success/i);
});

// Each check reads BOTH the re-fetched tab and the server's own answer for the same reload, so a
// tab that kept a stale render and a server that never stored the value are told apart.
Then("the profile's Promo Tools tab should show the server's promo with:", { timeout: 120000 }, async function (table) {
  const id = this._vpAgentId;
  const promo = promoTools(this);
  const since = mark(this);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await openPromoTab(this);
  const hit = await promotionFor(this, id, since);
  expect(hit && hit.body && hit.body.code, `GET /agents/${id}/promotion/ holds no promo: ${JSON.stringify(hit && hit.body)}`).toBeTruthy();
  await promo.editParametersButton.waitFor({ state: 'visible', timeout: 30000 });
  const body = hit.body;
  const shown = await promo.readAllParameters();
  const code = await promo.readPromoCode();
  this._avPromoCodes = [...(this._avPromoCodes || []), body.code];
  const server = {
    Status: body.status,
    'Incentive Type': body.incentive_type,
    Value: body.incentive_value !== undefined ? body.incentive_value : body.value,
    'Usage Limit': body.usage_limit,
  };
  const problems = [];
  if (code !== body.code) problems.push(`the tab shows the code ${code}, the server holds ${body.code}`);
  for (const { field, value } of table.hashes()) {
    const r = shown[field];
    const s = server[field];
    if (field === 'Status') {
      if (lc(r) !== lc(value)) problems.push(`Status shows "${r}", expected "${value}"`);
      if (lc(s) !== lc(value)) problems.push(`the server's status is "${s}", expected "${value}"`);
    } else if (field === 'Incentive Type') {
      const want = /fixed/i.test(value) ? /fixed/i : /percent/i;
      if (!want.test(r)) problems.push(`Incentive Type shows "${r}", expected "${value}"`);
      if (!want.test(String(s))) problems.push(`the server's incentive type is "${s}", expected "${value}"`);
    } else {
      const num = (x) => Number(String(x === undefined || x === null ? '' : x).replace(/[^\d.]/g, ''));
      if (num(r) !== Number(value)) problems.push(`${field} shows "${r}", expected ${value}`);
      if (num(s) !== Number(value)) problems.push(`the server's ${field} is ${JSON.stringify(s)}, expected ${value}`);
    }
  }
  this.attach(`Server promo: ${JSON.stringify(body)}\nTab: ${JSON.stringify({ code, ...shown })}`, 'text/plain');
  fail(problems, 'The Promo Tools tab and the server do not hold the promo as saved:');
});

Then('the promo code should not have changed since it was added', async function () {
  const codes = [...new Set(this._avPromoCodes || [])];
  expect(codes.length, 'the promo was never read back').toBeGreaterThan(0);
  expect(codes, 'editing, disabling or enabling the promo changed its code').toHaveLength(1);
});

// ==================== The profile's three-dot menu ====================

const menuButton = (world) => world.page.getByRole('button', { name: 'Open menu', exact: true }).first();
const openMenu = (world) => world.page.locator('[role="menu"]').first();

async function menuLabels(world) {
  return world.page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]'))
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
}

Then("the profile's three-dot menu should list its items and close each of these ways, sending nothing:",
  { timeout: 360000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const [agent] = await pickFirst(this, row.tab);
      const { id } = await viewFromTab(this, row.tab, agent);
      const writes = markWrites(this);
      const url = this.page.url();
      for (const method of ['Escape', 'clicking elsewhere on the profile']) {
        const at = (s) => `${row.tab} / ${method}: ${s}`;
        await menuButton(this).click();
        await openMenu(this).waitFor({ state: 'visible', timeout: 15000 });
        const items = await menuLabels(this);
        if (items.join('|') !== csv(row.items).join('|')) problems.push(at(`the menu holds ${JSON.stringify(items)}, expected ${row.items}`));
        if (method === 'Escape') await this.page.keyboard.press('Escape');
        else await this.page.locator('main').getByText(clean(this._vpProfile.email), { exact: true }).first().click({ force: true });
        const closed = await openMenu(this).waitFor({ state: 'hidden', timeout: 8000 }).then(() => true).catch(() => false);
        if (!closed) { problems.push(at('the menu is still open')); await this.page.keyboard.press('Escape'); }
        if (await this.page.locator('[role="dialog"]').count()) problems.push(at('closing the menu opened a dialog'));
        report.push(`${row.tab} agent ${id} ${method}: ${JSON.stringify(items)} closed=${closed}`);
      }
      if (this.page.url() !== url) problems.push(`${row.tab}: closing the menu navigated to ${this.page.url()}`);
      const sent = agentWritesSince(this, writes);
      if (sent.length) problems.push(`${row.tab}: the menu SENT ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'The profile\'s three-dot menu does not open and close cleanly:');
  });

Then('each profile menu item should open its dialog from the keyboard:', { timeout: 360000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const [agent] = await pickFirst(this, row.tab);
    await viewFromTab(this, row.tab, agent);
    const writes = markWrites(this);
    const at = (s) => `${row.tab} / ${row.item}: ${s}`;
    await menuButton(this).focus();
    await this.page.keyboard.press('Enter');
    const opened = await openMenu(this).waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (!opened) { problems.push(at('Enter on "Open menu" opened no menu')); continue; }
    // Focus opens on the popover wrapper (role=dialog), whose text is every item's text run
    // together - on a one-item menu identical to the item. So only a focused menu ITEM counts,
    // and from the wrapper one Tab moves onto the first item (the arrow keys do nothing there).
    const readFocus = () => this.page.evaluate(() => {
      const e = document.activeElement;
      return { item: /^menuitem/.test((e && e.getAttribute('role')) || ''), text: (e && e.textContent || '').replace(/\s+/g, ' ').trim() };
    });
    let f = await readFocus();
    if (!f.item) { await this.page.keyboard.press('Tab'); f = await readFocus(); }
    let focused = f.item ? f.text : `(not an item) ${f.text}`;
    for (let i = 0; i < 6 && lc(focused) !== lc(row.item); i += 1) {
      await this.page.keyboard.press('ArrowDown');
      f = await readFocus();
      focused = f.item ? f.text : `(not an item) ${f.text}`;
    }
    if (lc(focused) !== lc(row.item)) { problems.push(at(`the arrow keys never reached it (focus on "${focused}")`)); await this.page.keyboard.press('Escape'); continue; }
    await this.page.keyboard.press('Enter');
    const dialog = this.page.locator('[role="dialog"]').filter({ hasText: new RegExp(row.dialog, 'i') }).last();
    const shown = await dialog.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    report.push(`${row.tab} / ${row.item}: menu opened by Enter, item reached, dialog shown=${shown}`);
    if (!shown) problems.push(at(`Enter on the item did not open "${row.dialog}"`));
    else {
      await dialog.getByRole('button', { name: /^cancel$/i }).first().click().catch(() => this.page.keyboard.press('Escape'));
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
    const sent = agentWritesSince(this, writes);
    if (sent.length) problems.push(at(`opening and cancelling SENT ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`));
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A profile menu item cannot be chosen from the keyboard:');
});

Then("the profile's Deactivate dialog should require that agent's active candidates to be transferred first", { timeout: 60000 }, async function () {
  const id = this._vpAgentId;
  const active = await waitFor(this, new RegExp(`^/agent/${id}/candidates/\\?.*is_active=true`), { timeout: 15000 });
  // The dialog decides its own shape from a candidates call, so it is read once it has settled.
  await this.page.waitForTimeout(2000);
  const d = await listing(this).readDeactivateDialog();
  this.attach(`Deactivate dialog from the profile: ${JSON.stringify(d)}\nActive candidates: ${active && active.body && active.body.count}`, 'text/plain');
  const problems = [];
  if (!d) throw new Error('the Deactivate dialog is not open');
  if (!d.requiresTransfer) problems.push('the dialog does not ask for the candidates to be transferred first');
  if (!d.hasAgentPicker) problems.push('the dialog offers no receiving agent picker');
  if (!/^transfer & deactivate$/i.test(d.confirmLabel)) problems.push(`the confirm button reads "${d.confirmLabel}", not "Transfer & Deactivate"`);
  if (d.confirmDisabled !== true) problems.push('"Transfer & Deactivate" is enabled before a receiving agent is chosen');
  const n = active && active.body && active.body.count;
  if (n && !new RegExp(`\\b${n}\\b`).test(d.body)) problems.push(`the dialog does not name the agent's ${n} active candidates ("${d.body}")`);
  if (!lc(d.body).includes(lc(this._vpProfile.name))) problems.push(`the dialog does not name ${this._vpProfile.name}`);
  fail(problems, 'Deactivating an agent holding candidates from the profile does not require a transfer:');
});

// Shared with steps/agent-listing-values.js, which covers the same page from the listing side.
module.exports = {
  listing, profile, clean, lc, fail, recorder, mark, markWrites, waitFor, rawAgents, toSubject,
  loadTab, viewFromTab, dismiss, toastsWithin,
};
