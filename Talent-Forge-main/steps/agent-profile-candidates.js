const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

const CandidatesListingPage = require('../pages/CandidatesListingPage');
const AgentProfileCandidatesPage = require('../pages/AgentProfileCandidatesPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');
const { PROFILE_CANDIDATES } = require('./edit-email');

// Step definitions for
// features/SuperAdmin_Portal/UserManagement/Agent-Profile-Candidates-Tab.feature - the agent
// profile's Candidates tab (/agents/view/<id>?tab=candidates) as a page: its grid against the
// server, its row menu, its pagination and search, and the Update Email Address flow run from it.
//
// THE EMAIL STEPS ARE NOT HERE. The Givens below set `_emailSurface` to the profile tab and
// `_emailSubject` to the chosen candidate, and every "Update Email Address" step in
// steps/edit-email.js then drives this tab through AgentProfileCandidatesPage - one vocabulary,
// three surfaces. A second copy would assert the same modal twice and drift.
//
// WHAT IS ALREADY COVERED ELSEWHERE AND NOT REPEATED: the candidate list against the server's
// names, the server-side search and its no-match state, and View opening the drawer
// (View-Profile.feature); bulk selection and Reassign from the checkbox bar
// (Agent-Reassign-Candidates.feature); Edit opened and cancelled (Agent-Listing-Values.feature).
//
// Subjects are CHOSEN from the server's own data on every run, never pinned: this is shared DEV
// data, and a pinned agent's candidates move, get deactivated or are reassigned by other people.

const tab = (world) => world.pages.agentProfileCandidates;

function fail(problems, context) {
  if (problems.length) throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
}

// The app keeps its token in memory, not in a cookie, so it is taken off one of its own requests.
async function api(world) {
  if (world._pcApi && world._pcApi.page === world.page) return world._pcApi;
  const authorised = world.page.waitForRequest(
    (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && Boolean(r.headers().authorization),
    { timeout: 60000 },
  );
  await world.pages.agentsListing.goto('Active');
  const req = await authorised;
  const base = req.url().replace(/\/agent\/\?.*$/, '');
  const headers = { authorization: req.headers().authorization };
  const get = async (path) => {
    const r = await world.page.request.get(`${base}${path}`, { headers });
    return r.ok() ? r.json() : null;
  };
  world._pcApi = { page: world.page, get };
  return world._pcApi;
}

async function activeAgents(world, pages = 5) {
  const { get } = await api(world);
  const all = [];
  for (let p = 1; p <= pages; p += 1) {
    const body = await get(`/agent/?status=ACTIVE&status=ATTENTION&page=${p}&page_size=100`);
    if (!body) break;
    all.push(...(body.results || []));
    if (!body.next) break;
  }
  return all;
}

async function openTabFor(world, agent) {
  world._pcAgent = agent;
  world._pcList = await tab(world).goto(null, agent.id);
  expect(world._pcList.requestFired, `the Candidates tab of ${agent.email} fired no candidates request`).toBe(true);
  world.attach(`Agent: ${agent.email} (id ${agent.id})\nCandidates on page 1: `
    + `${(world._pcList.payload.results || []).length} of ${world._pcList.payload.count}`, 'text/plain');
}

const serverRows = (world) => CandidatesListingPage.candidatesFrom(world._pcList && world._pcList.payload);

// ==================== Choosing a subject ====================

Given('I have opened the Candidates tab of an agent whose candidates fit on one page', { timeout: 300000 }, async function () {
  const agents = await activeAgents(this);
  const { get } = await api(this);
  for (const a of agents.filter((x) => x.total_candidate_count >= 2 && x.total_candidate_count <= 10)) {
    const body = await get(`/agent/${a.id}/candidates/?page=1&page_size=10`);
    const rows = (body && body.results) || [];
    // A pending change would open the modal as the pending notice, not the form.
    if (body && body.count <= 10 && rows.length >= 2 && rows.some((r) => !r.pending_email && r.account_status === 'Active')) {
      await openTabFor(this, a);
      return;
    }
  }
  throw new Error('No active agent holds between 2 and 10 candidates with an Active one among them.');
});

Given('I have opened the Candidates tab of an agent with more than one page of candidates', { timeout: 300000 }, async function () {
  const agents = await activeAgents(this);
  const pick = agents.filter((a) => a.total_candidate_count > 10 && a.total_candidate_count <= 40)
    .sort((x, y) => x.total_candidate_count - y.total_candidate_count)[0];
  if (!pick) throw new Error('No active agent holds between 11 and 40 candidates.');
  await openTabFor(this, pick);
  expect(this._pcList.payload.count, 'the chosen agent does not hold more than one page of candidates')
    .toBeGreaterThan(10);
});

Given('I have opened the Candidates tab of an agent who holds a deactivated candidate', { timeout: 300000 }, async function () {
  const { get } = await api(this);
  const deactivated = ((await get('/candidate/?page=1&page_size=20&is_active=false')) || {}).results || [];
  for (const c of deactivated.filter((x) => x.agent_email)) {
    const found = ((await get(`/agent/?page=1&page_size=10&search=${encodeURIComponent(c.agent_email)}`)) || {}).results || [];
    const agent = found.find((a) => String(a.email).toLowerCase() === c.agent_email.toLowerCase());
    if (!agent) continue;
    await openTabFor(this, agent);
    this._pcList = await tab(this).search(c.email);
    const row = serverRows(this).find((r) => r.email === c.email);
    if (!row) continue;
    this._pcCandidate = row;
    this.attach(`Deactivated candidate: ${row.name} <${row.email}>, account_status ${row.status}`, 'text/plain');
    return;
  }
  throw new Error('No deactivated candidate could be found on its agent\'s Candidates tab.');
});

Given('I have noted the first active candidate on that Candidates tab with no email change pending', { timeout: 60000 }, async function () {
  const row = serverRows(this).find((r) => !r.pendingEmail && CandidatesListingPage.statusIs(r, 'Active'));
  expect(row, 'the tab lists no Active candidate without a pending email change').toBeTruthy();
  this._pcCandidate = row;
  this._emailSurface = PROFILE_CANDIDATES;
  this._emailSubject = { kind: 'candidate', name: row.name, email: row.email, tab: null, ...row };
  this.attach(`Subject candidate: ${row.name} <${row.email}>`, 'text/plain');
});

// The committing email scenario owns its candidate. One is signed up in an ISOLATED context (the
// signup signs that context in as the candidate, which must not replace the superadmin session),
// under SIGNUP_AGENT_CODE, and abandoned afterwards - a candidate cannot be deleted.
Given("I have provisioned a throwaway candidate and opened its agent's Candidates tab", { timeout: 600000 }, async function () {
  const context = await this.browser.newContext();
  let email;
  try {
    const candidateWorld = { page: await context.newPage() };
    email = await provisionFreshCandidate(candidateWorld);
  } finally {
    await context.close().catch(() => {});
  }
  const { get } = await api(this);
  const listed = ((await get(`/candidate/?page=1&page_size=10&search=${encodeURIComponent(email)}`)) || {}).results || [];
  const me = listed.find((c) => c.email === email);
  expect(me, `the new candidate ${email} is not on the Candidates listing`).toBeTruthy();
  const found = ((await get(`/agent/?page=1&page_size=10&search=${encodeURIComponent(me.agent_email)}`)) || {}).results || [];
  const agent = found.find((a) => String(a.email).toLowerCase() === String(me.agent_email).toLowerCase());
  expect(agent, `the agent ${me.agent_email} of the new candidate was not found`).toBeTruthy();
  await openTabFor(this, agent);
  this._pcList = await tab(this).search(email);
  this._emailSurface = PROFILE_CANDIDATES;
  this._emailSubject = { kind: 'candidate', name: me.full_name, email, tab: null };
  this.attach(`Provisioned throwaway candidate ${email} under agent ${agent.email} (id ${agent.id}). `
    + 'It is abandoned when the scenario ends.', 'text/plain');
});

// ==================== The grid ====================

Then('the profile Candidates tab should show the columns:', async function (table) {
  const grid = await tab(this).readGrid();
  const want = table.raw().map((r) => r[0]);
  // The first column is the selection checkbox and has no heading.
  expect(grid.columns, 'the Candidates tab renders other columns').toEqual(['', ...want]);
});

Then('every row on the profile Candidates tab should offer a {string} checkbox and these actions:', async function (checkbox, table) {
  const grid = await tab(this).readGrid();
  const want = table.hashes();
  const problems = [];
  if (grid.masterCheckbox !== 'Select all candidates on this page') {
    problems.push(`the header checkbox is labelled ${JSON.stringify(grid.masterCheckbox)}`);
  }
  expect(grid.rows.length, 'the tab lists no rows to check').toBeGreaterThan(0);
  for (const row of grid.rows) {
    if (row.checkbox !== checkbox) problems.push(`${row.email}: checkbox labelled ${JSON.stringify(row.checkbox)}`);
    const got = row.actions.map((a) => `${a.label}|${a.testid}`);
    const exp = want.map((w) => `${w.action}|${w.testid}`);
    if (JSON.stringify(got) !== JSON.stringify(exp)) problems.push(`${row.email}: actions ${JSON.stringify(got)}`);
  }
  fail(problems, 'A row on the profile Candidates tab does not offer what it should:');
});

const VERIFICATION = (c) => (c.verified ? 'Verified' : 'Unverified');
const SUBSCRIPTION = { subscribed: 'Subscribed', not_subscribed: 'Not Subscribed', payment_due: 'Payment Due' };

// Every cell against the candidate the server returned for that row. Account Status is compared
// only on ACTIVE rows here; how an inactive row is worded is its own @known-issue scenario, and
// folding it in would make this check red for that one reason on any agent holding one.
Then('every row on the profile Candidates tab should show what the server returned for that candidate', async function () {
  const grid = await tab(this).readGrid();
  const payload = (this._pcList.payload.results || []);
  const problems = [];
  expect(grid.rows.length, 'the tab lists no rows').toBe(payload.length);
  for (const row of grid.rows) {
    const raw = payload.find((p) => p.email === row.email);
    if (!raw) { problems.push(`${row.email} is listed but the server did not return it`); continue; }
    const c = CandidatesListingPage.candidatesFrom({ results: [raw] })[0];
    const expected = {
      'Account Verification': VERIFICATION(c),
      'Pending Documents': String(raw.pending_documents_count),
      'Subscription Status': SUBSCRIPTION[raw.subscription_status] || raw.subscription_status,
      // The server writes "6 days ago" with a non-breaking space; the grid reader collapses
      // whitespace, so the expectation is collapsed the same way.
      'Last Activity': String(raw.last_login || '-').replace(/\s+/g, ' ').trim(),
    };
    if (CandidatesListingPage.statusIs(c, 'Active')) expected['Account Status'] = 'Active';
    if (row.name !== raw.full_name) problems.push(`${row.email}: name ${JSON.stringify(row.name)}, server ${JSON.stringify(raw.full_name)}`);
    for (const [col, want] of Object.entries(expected)) {
      if (row.cells[col] !== want) problems.push(`${row.email}: ${col} reads ${JSON.stringify(row.cells[col])}, server says ${JSON.stringify(want)}`);
    }
  }
  this.attach(grid.rows.map((r) => `${r.email}: ${JSON.stringify(r.cells)}`).join('\n'), 'text/plain');
  fail(problems, 'The profile Candidates tab does not show what the server returned:');
});

Then("that deactivated candidate's Account Status should read {string}, as on the Candidates listing", async function (expected) {
  const grid = await tab(this).readGrid();
  const row = grid.rows.find((r) => r.email === this._pcCandidate.email);
  expect(row, `${this._pcCandidate.email} is not listed`).toBeTruthy();
  this.attach(`Server account_status: ${this._pcCandidate.status}; rendered: ${row.cells['Account Status']}`, 'text/plain');
  expect(row.cells['Account Status'], `the profile tab shows the API's raw "${this._pcCandidate.status}" `
    + 'where the Candidates listing shows the same candidate as "Deactivated"').toBe(expected);
});

Then("that candidate's Edit action should be disabled", async function () {
  const grid = await tab(this).readGrid();
  const row = grid.rows.find((r) => r.email === this._pcCandidate.email);
  const edit = row && row.actions.find((a) => a.label === 'Edit');
  expect(edit, 'the row offers no Edit at all').toBeTruthy();
  expect(edit.disabled, 'Edit is enabled on a deactivated candidate').toBe(true);
});

// ==================== The row menu ====================

Then("that candidate's row menu should offer exactly:", { timeout: 60000 }, async function (table) {
  const items = await tab(this).readRowMenu(this._pcCandidate.email);
  expect(items, `the row menu offers ${JSON.stringify(items)}`).toEqual(table.raw().map((r) => r[0]));
});

// Every non-GET request the page makes from here on. An absence is the assertion for the
// dialogs below, so it is watched rather than sampled.
When('I start recording what the profile Candidates tab sends', async function () {
  const writes = [];
  this.page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/v1\//.test(r.url())) writes.push(`${r.method()} ${r.url().replace(/^.*\/api\/v1/, '')}`);
  });
  this._pcWrites = writes;
});

const noWrites = (world, context) => {
  expect(world._pcWrites, 'nothing is recording requests - "I start recording..." must run first').toBeTruthy();
  expect(world._pcWrites, `${context} sent ${JSON.stringify(world._pcWrites)}`).toEqual([]);
};

When("I open Reassign candidate from that candidate's row menu", { timeout: 60000 }, async function () {
  const agentList = this.page.waitForResponse((r) => /\/api\/v1\/agent\/\?university=/.test(r.url()), { timeout: 20000 }).catch(() => null);
  await tab(this).openReassignDialog(this._pcCandidate.email);
  const res = await agentList;
  this._pcReassignAgents = res ? await res.json().catch(() => null) : null;
  this._pcReassignAgentsUrl = res ? res.url() : null;
});

Then("the Reassign dialog should name that candidate and the agent and lock the university to the agent's own", { timeout: 60000 }, async function () {
  const d = await tab(this).readReassignDialog();
  expect(d, 'the Reassign Candidate dialog is not open').toBeTruthy();
  const { get } = await api(this);
  const profile = await get(`/agent/${this._pcAgent.id}/profile/`);
  const university = profile && profile.institution && profile.institution.name;
  const agentName = `${this._pcAgent.first_name} ${this._pcAgent.last_name}`.trim();
  const problems = [];
  if (d.heading !== 'Reassign Candidate') problems.push(`heading ${JSON.stringify(d.heading)}`);
  if (!d.text.includes(`reassigning ${this._pcCandidate.name} from ${agentName}`)) {
    problems.push(`the body does not read "reassigning ${this._pcCandidate.name} from ${agentName}": ${d.text}`);
  }
  if (d.university !== university) problems.push(`University Affiliation reads ${JSON.stringify(d.university)}, the agent's is ${JSON.stringify(university)}`);
  if (d.universityDisabled !== true) problems.push('University Affiliation can be changed');
  if (this._pcReassignAgentsUrl && !/[?&]status=ACTIVE/.test(this._pcReassignAgentsUrl)) {
    problems.push(`the New Agent list asked for ${this._pcReassignAgentsUrl}, not active agents`);
  }
  this.attach(`${JSON.stringify(d, null, 1)}\nNew Agent list request: ${this._pcReassignAgentsUrl}`, 'text/plain');
  fail(problems, 'The Reassign Candidate dialog does not describe this reassignment:');
});

Then('the Reassign dialog should keep {string} disabled until a new agent is chosen', async function (label) {
  const d = await tab(this).readReassignDialog();
  expect(d.buttons, `the dialog offers ${JSON.stringify(d.buttons)}`).toContain(label);
  expect(d.pickerValue, 'the New Agent picker opened holding a value').toBe('');
  expect(d.confirmDisabled, `"${label}" is enabled with no new agent chosen`).toBe(true);
});

Then('leaving the Reassign dialog each of these ways should reassign nothing:', { timeout: 240000 }, async function (table) {
  const problems = [];
  for (const { way } of table.hashes()) {
    if (!(await tab(this).reassignDialog.isVisible().catch(() => false))) {
      await tab(this).openReassignDialog(this._pcCandidate.email);
    }
    const mark = this._pcWrites.length;
    await tab(this).leaveReassignDialog(way);
    await this.page.waitForTimeout(1500);
    if (await tab(this).reassignDialog.isVisible().catch(() => false)) problems.push(`${way}: the dialog is still open`);
    const sent = this._pcWrites.slice(mark);
    if (sent.length) problems.push(`${way}: sent ${JSON.stringify(sent)}`);
  }
  this._pcList = await tab(this).goto(null);
  if (!serverRows(this).some((r) => r.email === this._pcCandidate.email)) {
    problems.push(`${this._pcCandidate.email} is no longer on this agent's Candidates tab`);
  }
  fail(problems, 'Leaving the Reassign Candidate dialog did not leave the candidate where it was:');
});

When("I open Deactivate from that candidate's row menu", { timeout: 60000 }, async function () {
  await tab(this).openDeactivateDialog(this._pcCandidate.email);
});

When("I open Reactivate from that candidate's row menu", { timeout: 60000 }, async function () {
  await tab(this).openReactivateDialog(this._pcCandidate.email);
});

// The Candidates listing's own dialog, so its whole contract is owned by
// Candidate-Deactivate-Reactivate.feature; here it is checked to be THAT dialog, for THIS
// candidate, with its reason gate intact.
Then('the Deactivate Candidate Account dialog should name that candidate and require a reason', { timeout: 60000 }, async function () {
  const d = await tab(this).readDeactivateDialog();
  expect(d, 'the Deactivate Candidate Account dialog is not open').toBeTruthy();
  const problems = [];
  if (!d.text.includes(`deactivate ${this._pcCandidate.name}'s account`)) problems.push(`it does not name ${this._pcCandidate.name}: ${d.text}`);
  if (d.confirmDisabled !== true) problems.push('"Deactivate Account" is enabled before a reason is chosen');
  await tab(this).selectDeactivationReason('Temporary hold');
  const after = await tab(this).readDeactivateDialog();
  if (after.confirmDisabled !== false) problems.push('"Deactivate Account" stays disabled once a reason is chosen');
  fail(problems, 'The Deactivate dialog opened from the profile tab is not the candidate deactivation dialog:');
});

// MEASURED 2026-10-26: the menu item reads "Reactivate" while the dialog it opens is headed and
// confirmed "Re-activate Account". The dialog's own wording is asserted; the two spellings are
// recorded for the PO rather than failed on.
Then('the Reactivate Account dialog should name that candidate', { timeout: 60000 }, async function () {
  const d = await tab(this).readReactivateDialog();
  expect(d, 'the Reactivate Account dialog is not open').toBeTruthy();
  this.attach(`Dialog: ${d.heading} / confirm "${d.confirmLabel}" (the menu item reads "Reactivate")\n${d.text}`, 'text/plain');
  expect(d.emails.map((e) => e.toLowerCase()), `it names ${JSON.stringify(d.emails)}`).toContain(this._pcCandidate.email.toLowerCase());
  expect(d.text).toContain(this._pcCandidate.name);
  expect(d.heading).toBe('Re-activate Account');
  expect(d.confirmLabel).toBe('Re-activate Account');
  expect(d.confirmDisabled, 'Re-activate Account is disabled though it asks for nothing').toBe(false);
});

When('I cancel the candidate lifecycle dialog', { timeout: 30000 }, async function () {
  if (await tab(this).deactivateDialog.isVisible().catch(() => false)) await tab(this).cancelDeactivateDialog();
  if (await tab(this).reactivateDialog.isVisible().catch(() => false)) await tab(this).cancelReactivateDialog();
});

Then("the candidate's account status should be unchanged and nothing should have been sent", { timeout: 60000 }, async function () {
  await this.page.waitForTimeout(1000);
  noWrites(this, 'cancelling the dialog');
  // Asked of the server directly: re-typing the term the search box already holds sends nothing.
  const { get } = await api(this);
  const body = await get(`/agent/${this._pcAgent.id}/candidates/?page=1&page_size=10&search=${encodeURIComponent(this._pcCandidate.email)}`);
  const now = CandidatesListingPage.candidatesFrom(body).find((r) => r.email === this._pcCandidate.email);
  expect(now, `${this._pcCandidate.email} is no longer on this agent's tab`).toBeTruthy();
  expect(now.status, 'the account status changed').toBe(this._pcCandidate.status);
});

// ==================== Pagination and search ====================

When('I go to the next page of the profile Candidates tab', { timeout: 60000 }, async function () {
  this._pcPage1 = serverRows(this).map((r) => r.email);
  this._pcList = await tab(this).goToNextPage();
});

Then('it should have asked the server for page 2 and show exactly what came back', { timeout: 30000 }, async function () {
  const problems = [];
  if (!this._pcList.requestFired) problems.push('Next fired no candidates request');
  else if (!/[?&]page=2(&|$)/.test(this._pcList.requestUrl)) problems.push(`Next asked for ${this._pcList.requestUrl}`);
  const shown = (await tab(this).readRows()).map((r) => r.email);
  const server = serverRows(this).map((r) => r.email);
  if (JSON.stringify(shown.slice().sort()) !== JSON.stringify(server.slice().sort())) {
    problems.push(`page 2 lists ${JSON.stringify(shown)}, the server returned ${JSON.stringify(server)}`);
  }
  if (server.some((e) => this._pcPage1.includes(e))) problems.push('page 2 repeats a candidate from page 1');
  fail(problems, 'Page 2 of the profile Candidates tab is not what the server returned:');
});

Then('the pager should mark page 2 as current and disable {string} on the last page', async function (label) {
  const pager = await tab(this).readPager();
  const current = pager.find((p) => p.current);
  expect(current && current.label, `the pager reads ${JSON.stringify(pager)}`).toBe('Page 2');
  const last = !this._pcList.payload.next;
  const btn = pager.find((p) => p.label === label);
  expect(btn, `the pager offers no "${label}"`).toBeTruthy();
  expect(btn.disabled, `"${label}" is ${btn.disabled ? 'disabled' : 'enabled'} on ${last ? 'the last' : 'a middle'} page`).toBe(last);
});

When('I search the profile Candidates tab for the first letter of a listed name', { timeout: 60000 }, async function () {
  const letter = (serverRows(this)[0].name || 'a')[0];
  this._pcTerm = letter;
  this._pcList = await tab(this).search(letter);
});

Then('the search should have asked the server for page 1', async function () {
  expect(this._pcList.requestFired, 'the search fired no request').toBe(true);
  const url = new URL(this._pcList.requestUrl);
  expect(url.searchParams.get('page'), `the search asked for ${this._pcList.requestUrl}`).toBe('1');
  expect(url.searchParams.get('search')).toBe(this._pcTerm);
});

// MEASURED: neither the term nor the page reaches the URL, so a reload returns to an unfiltered
// page 1. Recorded rather than failed on (no AC says either should survive), and asserted only as
// "the reload lands on a working Candidates tab".
Then('after a reload the profile should reopen on its Candidates tab at page 1', { timeout: 90000 }, async function () {
  const result = await tab(this).runAndWaitForList(async () => { await this.page.reload({ waitUntil: 'domcontentloaded' }); }, { timeout: 60000 });
  const selected = await this.page.evaluate(() => Array.from(document.querySelectorAll('main [role="radio"][aria-checked="true"]')).map((t) => (t.innerText || '').trim()));
  const box = await tab(this).searchInput.inputValue().catch(() => '');
  this.attach(`After reload: url ${this.page.url()} selected ${JSON.stringify(selected)} search box ${JSON.stringify(box)} `
    + `request ${result.requestUrl}. The search term and page are not kept in the URL.`, 'text/plain');
  expect(selected).toEqual(['Candidates']);
  expect(result.requestFired, 'the reload fired no candidates request').toBe(true);
  expect(new URL(result.requestUrl).searchParams.get('page')).toBe('1');
});

When('I type only spaces into the profile Candidates search', { timeout: 30000 }, async function () {
  this._pcBefore = (await tab(this).readRows()).map((r) => r.email);
  const pending = this.page.waitForRequest((r) => AgentProfileCandidatesPage.isGridRequest(r.url()), { timeout: 5000 }).catch(() => null);
  await tab(this).searchInput.fill('   ');
  this._pcSpaceRequest = await pending;
});

Then('no search should be sent and the list should be unchanged', async function () {
  expect(this._pcSpaceRequest && this._pcSpaceRequest.url(), 'a whitespace-only term was sent to the server').toBeFalsy();
  const now = (await tab(this).readRows()).map((r) => r.email);
  expect(now).toEqual(this._pcBefore);
});
