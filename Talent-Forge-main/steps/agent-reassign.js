const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const {
  listing, profile, clean, lc, fail, recorder, mark, markWrites, waitFor, rawAgents, toSubject,
  loadTab, viewFromTab, dismiss, toastsWithin,
} = require('./agent-view-profile');

// Step definitions for Agent-Reassign-Candidates.feature - Reassign candidates from the SuperAdmin
// agent profile's Candidates tab, and its Audit Log entry. The response recorder and the
// "view from a tab" helpers are steps/agent-view-profile.js's, so all three agent step files
// read one log. Measured 2026-10-22 with scripts/probe-reassign-candidates.js (read-only):
//
//   rows      [role=checkbox] "Select candidate" per row, "Select all candidates on this page" in
//             the header; selecting fires NO request
//   bar       "<n> of <rows on this page> selected." + "Reassign candidates" + an X aria-labelled
//             "Clear selection"; a full page on an agent holding more adds the button
//             "Select all <N> candidates assigned to <Agent>", then "All <N> candidates assigned to
//             <Agent> are selected." - N is the count of /agent/<id>/candidates/ (every status), not
//             the listing's Total Candidates (active only)
//   modal     "Reassign Candidate"; University Affiliation is a disabled <select>; New Agent is a
//             combobox -> GET /agent/?university=<id>&status=ACTIVE&status=ATTENTION&page=1&page_size=10
//             [&search=]; Reassign disabled until an agent is chosen
//   audit     GET /analytics/admin/audit-logs/?...&search=, event ADMIN_CANDIDATES_REASSIGNED,
//             entity "Agent", entity_name = source agent, metadata {count, source_agent_name,
//             target_agent_name}; the drawer shows Candidates <n> and "Agent <A> → <B>"

const apostrophes = (s) => clean(s).replace(/[‘’]/g, "'");

// ==================== Selection ====================

const candidateBoxes = (world) => world.page.getByRole('checkbox', { name: /^select candidate$/i });
const selectAllBox = (world) => world.page.getByRole('checkbox', { name: /select all candidates/i }).first();
const selectionBar = (world) => world.page.getByText(/^(\d+ of \d+ selected\.|All \d+ candidates assigned to .+ are selected\.)$/).first();
const selectAllPrompt = (world) => world.page.getByRole('button', { name: /^Select all \d+ candidates assigned to /i }).first();
const clearSelection = (world) => world.page.getByRole('button', { name: 'Clear selection' }).first();

async function selectionState(world) {
  const bar = (await selectionBar(world).isVisible().catch(() => false)) ? clean(await selectionBar(world).innerText()) : null;
  const checked = await candidateBoxes(world).evaluateAll((cs) => cs.map((c) => c.checked));
  return { bar, checked };
}

async function waitForProfileCandidates(world) {
  await candidateBoxes(world).first().waitFor({ state: 'attached', timeout: 30000 });
  return candidateBoxes(world).count();
}

async function tickRow(world, email) {
  await world.page.locator('[role="row"]', { hasText: email }).first().getByRole('checkbox').first().click({ force: true });
}

async function clearAnySelection(world) {
  if (await clearSelection(world).isVisible().catch(() => false)) await clearSelection(world).click();
  await world.page.waitForTimeout(400);
}

// The server's answer for the agent's whole candidate list (every status): its count is the N the
// "select all" prompt names.
async function agentCandidates(world) {
  const hit = await waitFor(world, new RegExp(`^/agent/${world._vpAgentId}/candidates/\\?page=1&page_size=10$`), { timeout: 20000 });
  expect(hit, 'the profile never requested the agent\'s candidates').toBeTruthy();
  return hit.body;
}

// Fill "[N]", "[Agent Name]", "[Candidate Name]" from the server, never from the Gherkin.
async function expand(world, text, extra = {}) {
  const body = await agentCandidates(world);
  return apostrophes(text)
    .replace('[N]', String(extra.n !== undefined ? extra.n : body.count))
    .replace('[Agent Name]', clean(extra.agent || world._vpProfile.name))
    .replace('[Candidate Name]', clean(extra.candidate || ''));
}

Given('I have picked an agent who holds more than one page of candidates', { timeout: 240000 }, async function () {
  recorder(this);
  let pick = null;
  for (const range of ['51-100', '100+', '1-50']) {
    const result = await loadTab(this, 'Active', `candidateCount=${encodeURIComponent(range)}`);
    pick = rawAgents(result).filter((a) => Number(a.total_candidate_count) > 10)
      .sort((a, b) => b.total_candidate_count - a.total_candidate_count)[0];
    if (pick) break;
  }
  if (!pick) throw new Error('No Active agent holds more than 10 candidates - a missing fixture, not an app defect.');
  this._agent = toSubject(pick);
  this.attach(`Subject (more than one page): ${pick.first_name} ${pick.last_name} <${pick.email}> id=${pick.id} active=${pick.total_candidate_count}`, 'text/plain');
});

Given('I have picked an agent on the {string} tab who holds no candidates', { timeout: 120000 }, async function (tab) {
  recorder(this);
  const result = await loadTab(this, tab, 'candidateCount=0');
  const pick = rawAgents(result).find((a) => a.email && Number(a.total_candidate_count) === 0);
  if (!pick) throw new Error(`No agent on the "${tab}" tab holds no candidates - a missing fixture, not an app defect.`);
  this._agent = toSubject(pick);
});

Then('every candidate row should carry a checkbox and the header a master checkbox', { timeout: 60000 }, async function () {
  const boxes = await waitForProfileCandidates(this);
  const rows = (await profile(this).readCandidatesTab()).rows;
  this.attach(`${rows.length} candidate rows, ${boxes} row checkboxes`, 'text/plain');
  expect(boxes, 'not every candidate row carries a checkbox').toBe(rows.length);
  await expect(selectAllBox(this), 'the header has no master checkbox').toBeAttached();
  expect(await candidateBoxes(this).evaluateAll((cs) => cs.some((c) => c.checked)), 'a row is ticked before anything was selected').toBe(false);
  expect((await selectionState(this)).bar, 'a selection bar shows with nothing selected').toBeNull();
});

Then("selecting the profile's candidates should count the selection and offer Reassign and Clear selection, sending nothing",
  { timeout: 120000 }, async function () {
    const total = await waitForProfileCandidates(this);
    const writes = markWrites(this);
    const problems = [];
    const report = [];
    const step = async (label, action, wantBar) => {
      await action();
      await this.page.waitForTimeout(600);
      const s = await selectionState(this);
      report.push(`${label}: ${JSON.stringify(s)}`);
      if (s.bar !== wantBar) problems.push(`${label}: the bar reads ${JSON.stringify(s.bar)}, expected ${JSON.stringify(wantBar)}`);
      return s;
    };
    await step('select the first', () => candidateBoxes(this).nth(0).click({ force: true }), `1 of ${total} selected.`);
    for (const label of ['Reassign candidates', 'Clear selection']) {
      if (!(await this.page.getByRole('button', { name: label }).isVisible().catch(() => false))) problems.push(`with a selection, "${label}" is not offered`);
    }
    if (total > 1) await step('select a second', () => candidateBoxes(this).nth(1).click({ force: true }), `2 of ${total} selected.`);
    await step('untick every one again', async () => {
      for (let i = 0; i < total; i += 1) {
        if (await candidateBoxes(this).nth(i).isChecked()) await candidateBoxes(this).nth(i).click({ force: true });
      }
    }, null);
    if (await this.page.getByRole('button', { name: 'Reassign candidates' }).isVisible().catch(() => false)) {
      problems.push('with nothing selected, "Reassign candidates" is still offered');
    }
    const all = await step('select all on the page', () => selectAllBox(this).click({ force: true }), `${total} of ${total} selected.`);
    if (!all.checked.every(Boolean)) problems.push(`"Select all" left some rows unticked: ${JSON.stringify(all.checked)}`);
    const cleared = await step('dismiss (X) the selection', () => clearSelection(this).click(), null);
    if (cleared.checked.some(Boolean)) problems.push(`dismissing the selection left rows ticked: ${JSON.stringify(cleared.checked)}`);
    const sent = this._avWrites.slice(writes);
    if (sent.length) problems.push(`selecting sent ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`);
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Selecting candidates on the profile does not behave as specified:');
  });

When("I tick the master checkbox on the profile's Candidates tab", { timeout: 60000 }, async function () {
  await waitForProfileCandidates(this);
  this._avSelectWrites = markWrites(this);
  await selectAllBox(this).click({ force: true });
  await this.page.waitForTimeout(800);
});

When('I choose to select every candidate assigned to the agent', { timeout: 60000 }, async function () {
  await expect(selectAllPrompt(this), 'no "Select all N candidates" prompt is offered').toBeVisible({ timeout: 10000 });
  await selectAllPrompt(this).click();
  await this.page.waitForTimeout(800);
});

When('I untick the first candidate on the profile', { timeout: 60000 }, async function () {
  await candidateBoxes(this).nth(0).click({ force: true });
  await this.page.waitForTimeout(800);
});

Then('the selection bar should read {string}', { timeout: 30000 }, async function (wanted) {
  const want = await expand(this, wanted);
  await expect(selectionBar(this), `the selection bar does not read "${want}"`).toHaveText(want, { timeout: 10000 });
});

Then("the bar should offer {string} for that agent's total", { timeout: 30000 }, async function (wanted) {
  const want = await expand(this, wanted);
  await expect(selectAllPrompt(this), `the prompt "${want}" is not offered`).toBeVisible({ timeout: 10000 });
  expect(clean(await selectAllPrompt(this).innerText())).toBe(want);
});

Then('the bar should offer no {string} prompt', { timeout: 30000 }, async function (label) {
  const body = await agentCandidates(this);
  const rows = await candidateBoxes(this).count();
  expect(body.count, 'the premise is broken - this agent holds more than one page').toBeLessThanOrEqual(rows);
  await this.page.waitForTimeout(1500);
  expect(await selectAllPrompt(this).isVisible().catch(() => false), `"${label}" is offered although every candidate is on this page`).toBe(false);
});

Then('selecting should have sent nothing to the server', async function () {
  const sent = this._avWrites.slice(this._avSelectWrites);
  expect(sent.map((w) => `${w.method} ${w.path}`), 'selecting sent a request').toEqual([]);
});

When("I go to the next page of the profile's candidates", { timeout: 60000 }, async function () {
  const before = (await profile(this).readCandidatesTab()).rows.map((r) => r.email);
  await this.page.locator('main').getByRole('button', { name: /^next page$/i }).first().click();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const now = (await profile(this).readCandidatesTab()).rows.map((r) => r.email);
    if (now.length && now[0] !== before[0]) break;
    await this.page.waitForTimeout(400);
  }
});

Then('no candidate on that page should be selected and no selection bar should be shown', async function () {
  const s = await selectionState(this);
  this.attach(`Page 2 after a full page-1 selection: ${JSON.stringify(s)}`, 'text/plain');
  expect(s.checked.some(Boolean), 'rows on the next page are ticked').toBe(false);
  expect(s.bar, 'a selection bar is shown on the next page').toBeNull();
});

Then("the profile's Candidates tab should offer no checkbox and no {string}", { timeout: 60000 }, async function (label) {
  await expect(this.page.locator('main').getByText(/no candidates yet/i).first(), 'the Candidates tab does not say the agent has none').toBeVisible({ timeout: 20000 });
  expect(await candidateBoxes(this).count(), 'rows are selectable on an agent with no candidates').toBe(0);
  expect(await this.page.getByRole('button', { name: label }).count(), `"${label}" is offered with nothing to reassign`).toBe(0);
});

// ==================== Reassign Candidate modal ====================

const reassignDialog = (world) => world.page.locator('[role="dialog"]').filter({ hasText: /reassign candidate/i }).last();
const reassignPicker = (world) => reassignDialog(world).locator('input[role="combobox"]').first();

async function openReassign(world) {
  if (!(await selectionBar(world).isVisible().catch(() => false))) {
    await waitForProfileCandidates(world);
    await candidateBoxes(world).nth(0).click({ force: true });
  }
  const since = mark(world);
  await world.page.getByRole('button', { name: 'Reassign candidates' }).click();
  await reassignDialog(world).waitFor({ state: 'visible', timeout: 20000 });
  world._avReassignOpen = since;
  return apostrophes(await reassignDialog(world).innerText());
}

When('I select the first candidate on the profile and choose {string}', { timeout: 90000 }, async function (button) {
  if (!/reassign candidates/i.test(button)) throw new Error(`Unknown selection action "${button}"`);
  await waitForProfileCandidates(this);
  this._avReassignCandidate = (await profile(this).readCandidatesTab()).rows[0];
  this._avDialogWrites = markWrites(this);
  this._avCandidatesBefore = (await agentCandidates(this)).results.map((c) => lc(c.email || (c.user && c.user.email)));
  await openReassign(this);
});

Then('the Reassign Candidate modal should describe each selection:', { timeout: 240000 }, async function (table) {
  await waitForProfileCandidates(this);
  const rows = (await profile(this).readCandidatesTab()).rows;
  const problems = [];
  const report = [];
  for (const { selection, wording } of table.hashes()) {
    await clearAnySelection(this);
    let extra = {};
    if (selection === 'one') {
      await tickRow(this, rows[0].email);
      extra = { candidate: rows[0].name };
    } else if (selection === 'several') {
      for (const r of rows.slice(0, 3)) await tickRow(this, r.email);
      extra = { n: 3 };
    } else if (selection === 'all') {
      await selectAllBox(this).click({ force: true });
      await selectAllPrompt(this).click();
    } else throw new Error(`Unknown selection "${selection}" - expected one, several or all.`);
    await this.page.waitForTimeout(600);
    const want = await expand(this, wording, extra);
    const text = await openReassign(this);
    report.push(`${selection}: ${text}`);
    if (!text.includes(want)) problems.push(`${selection}: expected "${want}", the modal reads "${text}"`);
    await dismiss(this, reassignDialog(this), 'Cancel');
  }
  await clearAnySelection(this);
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The Reassign Candidate modal does not describe the selection as specified:');
});

Then('the Reassign Candidate dialog should name that candidate and the agent', async function () {
  const text = clean(await reassignDialog(this).innerText());
  this.attach(`Reassign dialog: ${text}`, 'text/plain');
  expect(lc(text), 'the dialog does not name the candidate being moved').toContain(lc(this._avReassignCandidate.name));
  expect(lc(text), 'the dialog does not name the agent the candidate is leaving').toContain(lc(this._vpProfile.name));
});

Then("the Reassign Candidate dialog should lock the university to the agent's own", async function () {
  const select = reassignDialog(this).locator('select').first();
  await expect(select, 'the dialog offers no university field').toHaveCount(1);
  expect(await select.isDisabled(), 'the university can be changed').toBe(true);
  const chosen = await select.evaluate((s) => (s.options[s.selectedIndex] || {}).text || '');
  expect(clean(chosen), 'the dialog is locked to a different university').toBe(clean(this._vpProfile.institution.name));
});

Then('the New Agent field should be marked required', async function () {
  const text = clean(await reassignDialog(this).innerText());
  expect(text, 'New Agent is not marked required').toMatch(/New Agent\s*\*/);
  expect(await reassignPicker(this).inputValue(), 'New Agent opens pre-filled').toBe('');
});

Then('{string} should stay disabled until a new agent is chosen', { timeout: 60000 }, async function (label) {
  const confirm = reassignDialog(this).getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(confirm, `"${label}" is enabled before any agent is chosen`).toBeDisabled();
  // Opening the picker can re-fetch its list, replacing the options under the pointer; a click on
  // an option that was swapped out chooses nothing. So the option is chosen BY NAME, and the
  // choice is verified on the input before Reassign is read.
  await reassignPicker(this).click();
  await this.page.getByRole('option').first().waitFor({ state: 'visible', timeout: 15000 });
  await this.page.waitForTimeout(1000);
  let name = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    name = clean(await this.page.getByRole('option').first().innerText());
    await this.page.getByRole('option', { name, exact: true }).first().click().catch(() => {});
    if (clean(await reassignPicker(this).inputValue()) === name) break;
    await reassignPicker(this).click();
    await this.page.waitForTimeout(800);
  }
  expect(clean(await reassignPicker(this).inputValue()), 'no agent could be chosen in the picker').toBe(name);
  await expect(confirm, `"${label}" stays disabled after choosing ${name}`).toBeEnabled({ timeout: 10000 });
});

Then('leaving the Reassign Candidate dialog each of these ways should send nothing and keep the selection:', { timeout: 180000 }, async function (table) {
  const problems = [];
  const writes = this._avDialogWrites !== undefined ? this._avDialogWrites : markWrites(this);
  for (const { method } of table.hashes()) {
    if (!(await reassignDialog(this).isVisible().catch(() => false))) await openReassign(this);
    if (await dismiss(this, reassignDialog(this), method)) problems.push(`${method}: the dialog is still open`);
    if (!(await selectionState(this)).bar) problems.push(`${method}: leaving the dialog dropped the selection`);
  }
  const sent = this._avWrites.slice(writes);
  if (sent.length) problems.push(`leaving the dialog SENT ${sent.map((w) => `${w.method} ${w.path}`).join('; ')}`);
  fail(problems, 'Leaving the Reassign Candidate dialog was not free of consequences:');
});

Then("the agent's candidates should be unchanged on the server", { timeout: 90000 }, async function () {
  const since = mark(this);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  const hit = await waitFor(this, new RegExp(`^/agent/${this._vpAgentId}/candidates/\\?page=1&page_size=10$`), { since, timeout: 20000 });
  const now = ((hit && hit.body && hit.body.results) || []).map((c) => lc(c.email || (c.user && c.user.email)));
  expect(now.slice().sort(), 'the agent\'s candidates changed although nothing was reassigned').toEqual(this._avCandidatesBefore.slice().sort());
});

// ==================== New Agent picker ====================

const pickerRequest = /^\/agent\/\?.*university=/;

Then("the Reassign agent picker should ask the server for the university's active agents", { timeout: 60000 }, async function () {
  const hit = await waitFor(this, pickerRequest, { since: this._avReassignOpen, timeout: 15000 });
  expect(hit, 'opening the dialog fetched no agents to choose from').toBeTruthy();
  const params = new URL(hit.url).searchParams;
  expect(params.get('university'), 'the picker asks for another university').toBe(String(this._vpProfile.institution.id));
  expect(params.getAll('status').sort(), 'the picker asks for agents other than active ones').toEqual(['ACTIVE', 'ATTENTION']);
  const others = rawAgents({ payload: hit.body }).filter((a) => String(a.institution_id) !== String(this._vpProfile.institution.id));
  expect(others.map((a) => a.email), 'the picker was sent agents of another university').toEqual([]);
  this._avPickerFirst = hit.body;
});

async function searchPicker(world, term) {
  const since = mark(world);
  const box = reassignPicker(world);
  await box.fill('');
  await box.pressSequentially(term, { delay: 40 });
  const hit = await waitFor(world, new RegExp(`${pickerRequest.source}.*search=`), { since, timeout: 15000 });
  await world.page.waitForTimeout(800);
  const options = (await world.page.getByRole('option').allInnerTexts()).map(clean);
  return { hit, options };
}

Then('searching the Reassign agent picker should be sent to the server and offer only matching agents', { timeout: 90000 }, async function () {
  const others = rawAgents({ payload: this._avPickerFirst }).filter((a) => String(a.id) !== String(this._vpAgentId));
  expect(others.length, 'the picker offered no other agent to search for').toBeGreaterThan(0);
  const target = others[0];
  const term = target.last_name;
  const { hit, options } = await searchPicker(this, term);
  this.attach(`Searched "${term}" -> ${hit && hit.path} -> ${JSON.stringify(options)}`, 'text/plain');
  expect(hit, `typing "${term}" made no request`).toBeTruthy();
  expect(new URL(hit.url).searchParams.get('search')).toBe(term);
  const want = clean(`${target.first_name} ${target.last_name}`);
  expect(options, `"${want}" is not offered`).toContain(want);
  const serverNames = rawAgents({ payload: hit.body }).map((a) => clean(`${a.first_name} ${a.last_name}`));
  expect(options.filter((o) => !serverNames.includes(o)), 'the picker offers names the server did not return').toEqual([]);
});

Then('the Reassign agent picker should never offer the agent the candidate is leaving', { timeout: 60000 }, async function () {
  const name = clean(this._vpProfile.name);
  const { hit, options } = await searchPicker(this, name);
  this.attach(`Searched the source agent "${name}" -> ${JSON.stringify(options)}`, 'text/plain');
  // Measured: the SERVER's search does return the source agent; the app drops it before
  // rendering. The requirement is about what the superadmin is offered, so the rendered options
  // are the assertion and the payload is only recorded.
  this.attach(`Server returned ${JSON.stringify(rawAgents({ payload: hit && hit.body }).map((a) => a.id))} for that search`, 'text/plain');
  expect(options, 'the picker offers the agent the candidate is already with').not.toContain(name);
});

Then('the Reassign agent picker should never offer an agent of that university who is:', { timeout: 240000 }, async function (table) {
  const university = String(this._vpProfile.institution.id);
  const problems = [];
  const report = [];
  const profileUrl = this.page.url();
  // Read each tab's agents through the app's own listing request in a second tab, so the open
  // modal and its selection are left untouched.
  const lister = await this.context.newPage();
  try {
    for (const { tab } of table.hashes()) {
      const param = { deactivated: 'deactivated', 'invite sent': 'inviteSent' }[lc(tab)];
      // A new tab restores its session from the refresh cookie, so only a SUCCESSFUL list answer
      // counts. The tab's pages are scanned for an agent of this university.
      let subject = null;
      for (let n = 1; n <= 6 && !subject; n += 1) {
        const response = lister.waitForResponse((r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.ok(), { timeout: 45000 });
        await lister.goto(`${new URL(profileUrl).origin}/agents?tab=${param}&page=${n}`, { waitUntil: 'domcontentloaded' });
        const body = await (await response).json().catch(() => null);
        subject = rawAgents({ payload: body }).find((a) => String(a.institution_id) === university) || null;
        if (!body || !body.next) break;
      }
      if (!subject) { problems.push(`${tab}: no ${tab} agent of this university to check against - a missing fixture`); continue; }
      const name = clean(`${subject.first_name} ${subject.last_name}`);
      const { hit, options } = await searchPicker(this, subject.email);
      const sent = rawAgents({ payload: hit && hit.body }).map((a) => lc(a.email));
      report.push(`${tab}: ${subject.email} (${name}) -> server ${JSON.stringify(sent)}, shown ${JSON.stringify(options)}`);
      if (sent.includes(lc(subject.email))) problems.push(`${tab}: the server offers ${subject.email}, a ${tab} agent`);
      if (options.includes(name) && !sent.length) problems.push(`${tab}: "${name}" is shown`);
    }
  } finally {
    await lister.close().catch(() => {});
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The New Agent picker offers an agent who is not active:');
});

Then('the Reassign agent picker should be able to list every active agent of the university', { timeout: 120000 }, async function () {
  const first = this._avPickerFirst || (await waitFor(this, pickerRequest, { since: this._avReassignOpen, timeout: 15000 })).body;
  const total = first.count;
  await reassignPicker(this).click();
  await this.page.getByRole('option').first().waitFor({ state: 'visible', timeout: 15000 });
  // Scroll the list to its end repeatedly; a list that pages on scroll grows, one that is capped does not.
  let shown = 0;
  for (let i = 0; i < 6; i += 1) {
    await this.page.getByRole('listbox').first().evaluate((e) => { e.scrollTop = e.scrollHeight; }).catch(() => {});
    await this.page.waitForTimeout(1500);
    shown = await this.page.getByRole('option').count();
  }
  this.attach(`The university holds ${total} active agents; the dropdown lists ${shown} after scrolling to its end.`, 'text/plain');
  expect(shown, `the dropdown lists ${shown} of the university's ${total} active agents and loads no more on scroll - `
    + 'the rest can only be found by typing a name').toBeGreaterThanOrEqual(total - 1);
});

Then('a Reassign agent search matching nobody should say the search found nothing, not that the university has no agents', { timeout: 60000 }, async function () {
  const term = `zz-no-agent-${Date.now().toString(36)}`;
  const { hit, options } = await searchPicker(this, term);
  const text = options.join(' | ');
  this.attach(`Searched "${term}" -> server count ${hit && hit.body && hit.body.count}; shown ${JSON.stringify(text)}`, 'text/plain');
  expect(hit && hit.body && hit.body.count, 'the premise is broken - the term matched an agent').toBe(0);
  expect(text, 'a search that matched nobody is explained as the university having no other agents').not.toMatch(/no other agents available for this university/i);
});

// ==================== Audit Log ====================

const auditRe = /^\/analytics\/admin\/audit-logs\/\?/;

async function openAuditSearch(world, term) {
  recorder(world);
  const since = mark(world);
  await world.pages.auditLogs.navigate(`?search=${encodeURIComponent(term)}`);
  const hit = await waitFor(world, new RegExp(`${auditRe.source}.*search=`), { since, timeout: 30000 });
  expect(hit, 'the Audit Logs search made no request').toBeTruthy();
  await world.pages.auditLogs.settleRows().catch(() => {});
  return hit.body;
}

// "22-10-2026 17:38:48" - the drawer's date, in the BROWSER's timezone, as the app renders it.
async function auditDate(world, iso) {
  return world.page.evaluate((v) => {
    const d = new Date(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }, iso);
}

async function checkDrawer(world, entry) {
  const details = await world.pages.auditLogs.readLogDetails();
  const f = details.fields;
  const want = {
    'Entity Type': 'Agent',
    'Entity Name': clean(entry.entity_name),
    'Action Type': clean(entry.action_type_label),
    'Action By': clean(entry.actor_name),
    'Date & Time': await auditDate(world, entry.created_at),
    Candidates: String(entry.metadata.count),
    Agent: `${clean(entry.metadata.source_agent_name)} → ${clean(entry.metadata.target_agent_name)}`,
  };
  const problems = [];
  for (const section of ['Entity Information', 'Event Details']) {
    if (!details.sections.includes(section)) problems.push(`the drawer has no "${section}" section`);
  }
  for (const [label, value] of Object.entries(want)) {
    if (clean(f[label]) !== value) problems.push(`${label}: the drawer shows ${JSON.stringify(f[label])}, the server recorded "${value}"`);
  }
  world.attach(`Log Details: ${JSON.stringify(details)}\nServer entry: ${JSON.stringify(entry)}`, 'text/plain');
  return problems;
}

Given('I have found the latest candidate reassignment in the Audit Log', { timeout: 120000 }, async function () {
  const body = await openAuditSearch(this, 'reassign');
  const results = (body && body.results) || [];
  const index = results.findIndex((r) => r.event_type === 'ADMIN_CANDIDATES_REASSIGNED');
  if (index < 0) throw new Error('The Audit Log holds no candidate reassignment on its first page - a missing fixture, not an app defect.');
  this._avAudit = { entry: results[index], index };
});

When("I open that reassignment's Log Details", { timeout: 60000 }, async function () {
  await this.pages.auditLogs.openLogDetails(this._avAudit.index);
});

Then('Log Details should show that reassignment as the server recorded it', async function () {
  const { entry } = this._avAudit;
  const problems = await checkDrawer(this, entry);
  if (entry.entity !== 'Agent') problems.push(`the entry's entity is "${entry.entity}", not Agent`);
  if (entry.action_type_label !== 'Candidate reassigned') problems.push(`the entry's action is "${entry.action_type_label}"`);
  fail(problems, 'Log Details does not show the reassignment as recorded:');
});

// ==================== Committing: reassign between throwaway agents ====================

function reassignGuard(source, target) {
  const throwaway = /\+(promoexh|agview)/i;
  if (!throwaway.test(source.email) || !throwaway.test(target.email)) {
    throw new Error(`Refusing to reassign between ${source.email} and ${target.email}: this step only moves candidates `
      + 'between throwaway agents (+promoexh / +agview aliases).');
  }
}

Given('I have found an abandoned throwaway agent holding candidates to reassign from', { timeout: 180000 }, async function () {
  recorder(this);
  await loadTab(this, 'Active', 'candidateCount=1-50');
  const result = await listing(this).search('promoexh');
  const pick = rawAgents(result).find((a) => /\+promoexh/i.test(a.email) && Number(a.total_candidate_count) >= 2);
  if (!pick) throw new Error('No abandoned +promoexh throwaway agent holds 2 or more candidates - a missing fixture, not an app defect.');
  this._avSource = toSubject(pick);
  this._avTarget = { ...this._agent };
  this.attach(`Reassign from ${pick.email} (${pick.total_candidate_count} candidates) to ${this._avTarget.email}`, 'text/plain');
});

// Ticks the named candidates on `from`'s profile (the first `count` when none are named), records
// what the modal said, chooses `to` by its exact name and confirms. Returns the emails moved.
async function reassignFromProfile(world, from, to, { emails, count = 1 } = {}) {
  reassignGuard(from, to);
  const { id } = await viewFromTab(world, 'Active', from);
  await profile(world).openTab('Candidates');
  await waitForProfileCandidates(world);
  const rows = (await profile(world).readCandidatesTab()).rows;
  const chosen = emails ? rows.filter((r) => emails.map(lc).includes(lc(r.email))) : rows.slice(0, count);
  expect(chosen.length, `${from.email}'s Candidates tab does not list ${JSON.stringify(emails || count)}`).toBe(emails ? emails.length : count);
  for (const r of chosen) await tickRow(world, r.email);
  const modal = await openReassign(world);
  const toName = clean(to.name);
  const box = reassignPicker(world);
  await box.fill('');
  await box.pressSequentially(toName, { delay: 30 });
  const option = world.page.getByRole('option', { name: toName, exact: true }).first();
  await option.waitFor({ state: 'visible', timeout: 20000 });
  await option.click();
  expect(clean(await box.inputValue()), `${toName} could not be chosen`).toBe(toName);
  const writes = markWrites(world);
  const at = Date.now();
  await reassignDialog(world).getByRole('button', { name: /^reassign$/i }).click();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !world._avWrites.slice(writes).length) await world.page.waitForTimeout(250);
  const toasts = await toastsWithin(world);
  const sent = await Promise.all(world._avWrites.slice(writes).map(async (w) => ({
    method: w.method, path: w.path, status: w.status, request: w.request, body: String(await w.body).slice(0, 400),
  })));
  world._avReassign = {
    fromId: id, from, to, at, modal, toasts, sent,
    candidates: chosen.map((r) => r.email), names: chosen.map((r) => r.name), agentName: clean(world._vpProfile.name),
  };
  world.attach(`Reassign ${JSON.stringify(world._avReassign.candidates)} from ${from.email} to ${to.email}: ${JSON.stringify({ modal, toasts, sent })}`, 'text/plain');
  return world._avReassign.candidates;
}

When('I reassign the first {int} candidates of the original agent to the throwaway agent', { timeout: 240000 }, async function (n) {
  this._avMoved = await reassignFromProfile(this, this._avSource, this._avTarget, { count: n });
});

When('I reassign the first moved candidate back to the original agent', { timeout: 240000 }, async function () {
  await reassignFromProfile(this, this._avTarget, this._avSource, { emails: [this._avMoved[0]] });
});

When('I reassign the remaining moved candidate back to the original agent', { timeout: 240000 }, async function () {
  await reassignFromProfile(this, this._avTarget, this._avSource, { emails: this._avMoved.slice(1) });
});

Then('the Reassign modal should have said {string}', async function (wanted) {
  const r = this._avReassign;
  const want = apostrophes(wanted)
    .replace('[N]', String(r.candidates.length))
    .replace('[Agent Name]', r.agentName)
    .replace('[Candidate Name]', clean(r.names[0]));
  expect(r.modal, 'the Reassign modal did not describe the selection as specified').toContain(want);
});

Then('the reassignment should be confirmed by the server', async function () {
  const r = this._avReassign;
  expect(r.sent.length, 'pressing Reassign sent nothing').toBeGreaterThan(0);
  expect(r.sent.every((w) => w.status >= 200 && w.status < 300), `the reassignment was refused: ${JSON.stringify(r.sent)}`).toBe(true);
  expect(r.toasts.some((t) => /success|reassigned/i.test(t)), `no confirmation was shown: ${JSON.stringify(r.toasts)}`).toBe(true);
});

Then("the original agent's Candidates tab should drop the moved candidates without a reload", { timeout: 60000 }, async function () {
  const moved = this._avReassign.candidates.map(lc);
  let shown = [];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    shown = (await profile(this).readCandidatesTab()).rows.map((r) => lc(r.email));
    if (!moved.some((m) => shown.includes(m))) break;
    await this.page.waitForTimeout(500);
  }
  this.attach(`Without a reload the source tab lists ${JSON.stringify(shown)}`, 'text/plain');
  expect(moved.filter((m) => shown.includes(m)), 'the source agent still lists the moved candidates until the page is reloaded').toEqual([]);
  expect((await selectionState(this)).bar, 'the selection bar is still shown after the reassignment').toBeNull();
});

async function serverCandidatesOf(world, agent) {
  const { id, since } = await viewFromTab(world, 'Active', agent);
  const hit = await waitFor(world, new RegExp(`^/agent/${id}/candidates/\\?page=1&page_size=10$`), { since, timeout: 20000 });
  return ((hit && hit.body && hit.body.results) || []).map((c) => lc(c.email || (c.user && c.user.email)));
}

Then("the moved candidates should be listed on the throwaway agent's profile and no longer on the original agent's", { timeout: 240000 }, async function () {
  const moved = this._avMoved.map(lc);
  const onTarget = await serverCandidatesOf(this, this._avTarget);
  await profile(this).openTab('Candidates');
  await waitForProfileCandidates(this).catch(() => {});
  const rendered = (await profile(this).readCandidatesTab()).rows.map((r) => lc(r.email));
  const onSource = await serverCandidatesOf(this, this._avSource);
  this.attach(`target server ${JSON.stringify(onTarget)} rendered ${JSON.stringify(rendered)}\nsource ${JSON.stringify(onSource)}`, 'text/plain');
  const problems = [];
  for (const m of moved) {
    if (!onTarget.includes(m)) problems.push(`${m} is not held by ${this._avTarget.email} on the server`);
    if (!rendered.includes(m)) problems.push(`${m} is not listed on ${this._avTarget.email}'s Candidates tab`);
    if (onSource.includes(m)) problems.push(`${m} is still held by ${this._avSource.email}`);
  }
  fail(problems, 'The reassigned candidates did not move:');
});

Then("every moved candidate should be listed on the original agent's profile again", { timeout: 180000 }, async function () {
  const onSource = await serverCandidatesOf(this, this._avSource);
  const missing = this._avMoved.map(lc).filter((m) => !onSource.includes(m));
  expect(missing, `${JSON.stringify(missing)} did not return to ${this._avSource.email}`).toEqual([]);
});

Then('the Audit Log should record {int} candidate(s) moved from the {word} agent to the {word} agent', { timeout: 120000 }, async function (n, fromWord, toWord) {
  const r = this._avReassign;
  const pick = (w) => ({ original: this._avSource, throwaway: this._avTarget }[w]);
  const from = pick(fromWord);
  const to = pick(toWord);
  expect(from && to, `unknown agents "${fromWord}" / "${toWord}" - use original or throwaway`).toBeTruthy();
  const name = clean(from.name);
  let entry = null;
  let index = -1;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !entry) {
    const body = await openAuditSearch(this, name);
    const results = (body && body.results) || [];
    index = results.findIndex((e) => e.event_type === 'ADMIN_CANDIDATES_REASSIGNED'
      && clean(e.metadata.source_agent_name) === name && clean(e.metadata.target_agent_name) === clean(to.name)
      && new Date(e.created_at).getTime() >= r.at - 60000);
    entry = index >= 0 ? results[index] : null;
    if (!entry) await this.page.waitForTimeout(3000);
  }
  expect(entry, `no "Candidate reassigned" entry from ${name} to ${to.name} was written after the reassignment`).toBeTruthy();
  const problems = [];
  if (Number(entry.metadata.count) !== n) problems.push(`the entry records ${entry.metadata.count} candidate(s), ${n} were moved`);
  if (clean(entry.entity_name) !== name) problems.push(`the entry names "${entry.entity_name}", the source agent is "${name}"`);
  if (entry.entity !== 'Agent') problems.push(`the entry's entity is "${entry.entity}"`);
  await this.pages.auditLogs.openLogDetails(index);
  problems.push(...await checkDrawer(this, entry));
  await this.pages.auditLogs.closeLogDetails();
  fail(problems, 'The reassignment is not recorded in the Audit Log as specified:');
});

module.exports = { waitForProfileCandidates };
