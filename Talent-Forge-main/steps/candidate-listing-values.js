const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');

// Step definitions for
//   features/SuperAdmin_Portal/UserManagement/Candidate-Listing-Values.feature
//
// Reused from other step files, NOT redefined here (one registry - a second definition is an
// ambiguous step and fails generation):
//   - `I am logged in as the superadmin`                       invite-agent.js
//   - `I am on the {string} candidates tab`, `I search the candidates for that candidate's
//     full email`, `the candidate search box should still hold the search term`
//                                                              candidate-management.js
//   - `I have noted the first candidate on the {string} tab`, `I am on the Agents listing`
//                                                              edit-email.js / agent.js
//   - the two `help icon on the {string} column` steps         agent-listing-values.js
//     (they read any column header on the current page, so they serve both listings)
//
// RULES, as in candidate-management.js: values are compared with the payload the app received,
// rows are matched by EMAIL (the grid re-sorts the server's page - a separate @known-issue), and
// every table step collects all failures and throws once.

const listing = (world) => world.pages.candidatesListing;
const panel = (world) => world.pages.candidateDetailPanel;
const clean = (s) => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
const lower = (s) => clean(s).toLowerCase();

function fail(problems, context) {
  if (problems.length) throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
}

const rawResults = (payload) => (payload && (payload.results || payload.data || payload.items)) || [];

// ---------- what each column should render for a payload row ----------
// account_status: the API says "Inactive" where the grid says "Deactivated" (recorded in
// CandidatesListingPage); every other value is the same word.
const EXPECT = {
  'Account Status': (r) => (/^inactive$/i.test(r.account_status) ? ['Deactivated', 'Inactive'] : [clean(r.account_status)]),
  'Account Verification': (r) => [r.is_verified ? 'Verified' : 'Unverified'],
  'Pending Documents': (r) => [String(r.pending_documents_count == null ? '' : r.pending_documents_count)],
  'Subscription Status': (r) => [clean(String(r.subscription_status || '').split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '))],
  'Last Activity': (r) => (r.last_login == null ? ['-', '—', 'Never', ''] : [clean(r.last_login)]),
};

// The grid, read structurally: header names in order, then each row's cells in the same order.
// The Candidate and Agent cells hold two buttons (name, email) and possibly an icon button.
async function readGrid(world) {
  return world.page.evaluate(() => {
    const c = (s) => String(s || '').replace(/[\s ]+/g, ' ').trim();
    const headers = Array.from(document.querySelectorAll('[role="columnheader"]')).map((h) => c(h.innerText));
    const rows = Array.from(document.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]'));
    return rows.map((r, index) => {
      const cells = Array.from(r.querySelectorAll('[role="rowheader"], [role="gridcell"]'));
      const out = { index };
      headers.forEach((h, i) => {
        const cell = cells[i];
        if (!cell) { out[h] = null; return; }
        const buttons = Array.from(cell.querySelectorAll('button'));
        const texts = buttons.map((b) => c(b.innerText)).filter(Boolean);
        const icon = buttons.find((b) => !c(b.innerText) && !c(b.getAttribute('aria-label')) && b.querySelector('svg'));
        out[h] = {
          text: c(cell.innerText),
          name: texts.find((t) => !t.includes('@')) || '',
          email: texts.find((t) => t.includes('@')) || '',
          iconId: icon ? icon.id : null,
        };
      });
      return out;
    });
  });
}

// Waits until the grid shows exactly the rows of `payload`, every one painted (skeleton rows and
// the previous query's rows both look like rows - see CandidatesListingPage.settle()).
async function settledGrid(world, payload, { timeout = 20000 } = {}) {
  const want = rawResults(payload).map((r) => lower(r.email)).sort();
  const deadline = Date.now() + timeout;
  let grid = [];
  while (Date.now() < deadline) {
    grid = await readGrid(world);
    const got = grid.map((g) => lower(g.Candidate && g.Candidate.email)).sort();
    const painted = grid.every((g) => g['Account Status'] && g['Account Status'].text);
    if (painted && JSON.stringify(got) === JSON.stringify(want)) return grid;
    await world.page.waitForTimeout(300);
  }
  return grid;
}

async function compareRows(world, payload, where) {
  const problems = [];
  const results = rawResults(payload);
  if (!results.length) return { problems: [`${where}: the server returned no candidates, so nothing could be compared`], checked: 0 };
  const grid = await settledGrid(world, payload);
  for (const r of results) {
    const row = grid.find((g) => g.Candidate && lower(g.Candidate.email) === lower(r.email));
    if (!row) { problems.push(`${where}: ${r.email} is in the server's page but not on screen`); continue; }
    const at = `${where} ${r.email}`;
    if (clean(row.Candidate.name) !== clean(r.full_name)) problems.push(`${at}: Candidate name reads ${JSON.stringify(row.Candidate.name)}, server ${JSON.stringify(r.full_name)}`);
    if (!row.Agent) problems.push(`${at}: there is no Agent cell`);
    else if (r.agent_email || r.agent_name) {
      if (clean(row.Agent.name) !== clean(r.agent_name)) problems.push(`${at}: Agent name reads ${JSON.stringify(row.Agent.name)}, server ${JSON.stringify(r.agent_name)}`);
      if (lower(row.Agent.email) !== lower(r.agent_email)) problems.push(`${at}: Agent email reads ${JSON.stringify(row.Agent.email)}, server ${JSON.stringify(r.agent_email)}`);
    } else if (row.Agent.email) problems.push(`${at}: the server holds no agent but the row shows ${JSON.stringify(row.Agent.text)}`);
    for (const [column, expected] of Object.entries(EXPECT)) {
      const cell = row[column];
      const got = cell ? clean(cell.text) : null;
      const allowed = expected(r);
      if (!allowed.includes(got)) problems.push(`${at}: ${column} reads ${JSON.stringify(got)}, expected ${allowed.map((a) => JSON.stringify(a)).join(' or ')}`);
    }
  }
  for (const g of grid) {
    if (g.Candidate && g.Candidate.email && !results.some((r) => lower(r.email) === lower(g.Candidate.email))) {
      problems.push(`${where}: ${g.Candidate.email} is on screen but not in the server's page`);
    }
  }
  return { problems, checked: results.length };
}

// ==================== CELL VALUES ====================

Then("every candidate row should show the server's values on each of these pages:", { timeout: 420000 }, async function (table) {
  const L = listing(this);
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const tab = row.tab.trim();
    const page = Number(row.page);
    let res = await L.runAndWaitForList(async () => { await L.goto(tab); });
    if (page > 1) res = await L.goToPageNumber(page);
    const where = `${tab} page ${page}`;
    if (!res.payload) { problems.push(`${where}: no list response was captured`); continue; }
    const { problems: p, checked } = await compareRows(this, res.payload, where);
    problems.push(...p);
    report.push(`${where}: ${checked} row(s) compared, ${p.length} mismatch(es) - ${res.requestUrl.replace(/^.*\/api\/v1/, '')}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidate row does not show what the server holds:');
});

Then('each of these candidate filters should list only rows rendering its label:', { timeout: 420000 }, async function (table) {
  const L = listing(this);
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    await L.runAndWaitForList(async () => { await L.goto('All'); });
    await L.openFilters();
    await L.selectFilterOption(row.group.trim(), row.option.trim());
    const res = await L.applyFilters();
    const where = `${row.group} = ${row.option}`;
    const results = rawResults(res.payload);
    if (!results.length) { problems.push(`${where}: the server returned no candidate in this state, so its label could not be checked`); continue; }
    const grid = await settledGrid(this, res.payload);
    const wrong = grid.filter((g) => !g[row.column] || clean(g[row.column].text) !== clean(row.label));
    if (wrong.length) problems.push(`${where}: ${wrong.length} row(s) render ${JSON.stringify([...new Set(wrong.map((g) => g[row.column] && g[row.column].text))])} in "${row.column}" instead of ${JSON.stringify(row.label)}`);
    report.push(`${where}: ${grid.length} row(s) on screen, server count ${res.payload.count}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A filtered state is not rendered with its own label:');
});

// ==================== ROW ENTRY POINTS ====================

// Requests that do not belong to a click: the app's own background polling.
const BACKGROUND = /notifications|token\/refresh|auth\/me/;

function recordRequests(world) {
  const seen = [];
  const handler = (r) => { if (/\/api\//.test(r.url()) && !BACKGROUND.test(r.url())) seen.push(`${r.method()} ${r.url().replace(/^.*\/api\/v1/, '')}`); };
  world.page.on('request', handler);
  return { seen, stop: () => world.page.off('request', handler) };
}

Then('clicking each of these in the first candidate row should open nothing and send nothing:', { timeout: 180000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const column = row.cell.trim();
    const part = row.part.trim();
    const grid = await readGrid(this);
    const first = grid[0] && grid[0][column];
    if (!first) { problems.push(`${column}: the first row has no such cell`); continue; }
    const text = part === 'email' ? first.email : first.name;
    if (!text) { problems.push(`${column} ${part}: the first row shows none`); continue; }
    const cellIndex = (await this.page.locator('[role="columnheader"]').allInnerTexts()).map(clean).indexOf(column);
    const cell = this.page.locator('[role="row"]:not(:has([role="columnheader"]))').first()
      .locator('[role="rowheader"], [role="gridcell"]').nth(cellIndex);
    const button = cell.getByRole('button', { name: text, exact: true }).first();
    const before = this.page.url();
    const dialogsBefore = await this.page.locator('[role="dialog"]:visible').count();
    const popups = [];
    const onPage = (p) => popups.push(p.url());
    this.context.on('page', onPage);
    const rec = recordRequests(this);
    await button.click();
    await this.page.waitForTimeout(2500);
    rec.stop();
    this.context.off('page', onPage);
    const after = this.page.url();
    const dialogsAfter = await this.page.locator('[role="dialog"]:visible').count();
    const effects = [];
    if (after !== before) effects.push(`navigated to ${after}`);
    if (dialogsAfter > dialogsBefore) effects.push('opened a dialog');
    if (popups.length) effects.push(`opened a new tab ${popups.join(', ')}`);
    if (rec.seen.length) effects.push(`sent ${rec.seen.join(', ')}`);
    report.push(`${column} ${part} (${text}): ${effects.length ? effects.join('; ') : 'nothing happened'}`);
    if (effects.length) problems.push(`${column} ${part} (${text}) ${effects.join('; ')}`);
    if (after !== before) await this.page.goBack().catch(() => {});
    await this.page.keyboard.press('Escape').catch(() => {});
    await listing(this).settle();
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A name or email in a candidate row did something - ask the PO whether it should, then update this scenario:');
});

// ==================== EMAIL WARNING ICON ====================

// Walks the All tab page by page and pairs each row's icon with the server's flags.
async function iconRows(world, { pages = 4, until } = {}) {
  const L = listing(world);
  const out = [];
  let res = await L.runAndWaitForList(async () => { await L.goto('All'); });
  for (let p = 1; p <= pages; p++) {
    if (p > 1) res = await L.goToPageNumber(p);
    if (!res.payload) break;
    const grid = await settledGrid(world, res.payload);
    for (const r of rawResults(res.payload)) {
      const g = grid.find((x) => x.Candidate && lower(x.Candidate.email) === lower(r.email));
      out.push({ page: p, email: r.email, emailVerified: r.is_email_verified, pendingEmail: r.pending_email, onScreen: !!g, iconId: g ? g.Candidate.iconId : null });
    }
    if (until && until(out)) break;
  }
  return out;
}

Then('the email warning icon should appear exactly on the rows the server marks as unverified or pending', { timeout: 300000 }, async function () {
  const rows = await iconRows(this, {
    until: (o) => o.some((r) => r.iconId) && o.some((r) => !r.iconId),
  });
  const problems = [];
  for (const r of rows) {
    if (!r.onScreen) { problems.push(`page ${r.page} ${r.email}: in the server's page but not on screen`); continue; }
    const want = r.emailVerified === false || !!r.pendingEmail;
    if (want && !r.iconId) problems.push(`page ${r.page} ${r.email}: is_email_verified=${r.emailVerified}, pending_email=${JSON.stringify(r.pendingEmail)} but no warning icon is shown`);
    if (!want && r.iconId) problems.push(`page ${r.page} ${r.email}: verified with nothing pending, yet a warning icon is shown`);
  }
  const withIcon = rows.filter((r) => r.iconId).length;
  if (!withIcon) problems.push(`no row with a warning icon was found on ${rows.length} rows, so the rule was not exercised`);
  if (withIcon === rows.length) problems.push('every row had a warning icon, so the rule was not exercised in the other direction');
  this.attach(`${rows.length} rows compared, ${withIcon} with the icon:\n${rows.map((r) => `p${r.page} ${r.email} email_verified=${r.emailVerified} pending=${r.pendingEmail} icon=${!!r.iconId}`).join('\n')}`, 'text/plain');
  fail(problems, 'The email warning icon does not follow the server\'s flags:');
});

Given('I have found a candidate whose email is unverified with no change pending', { timeout: 300000 }, async function () {
  const rows = await iconRows(this, { until: (o) => o.some((r) => r.iconId && r.emailVerified === false && !r.pendingEmail) });
  const hit = rows.find((r) => r.iconId && r.emailVerified === false && !r.pendingEmail);
  expect(hit, `none of the ${rows.length} candidates on the first pages of the All tab has an unverified email with no pending change`).toBeTruthy();
  this._iconCandidate = hit;
  this.attach(`Subject: ${hit.email} (page ${hit.page}) - is_email_verified=false, pending_email=null`, 'text/plain');
});

Then("that candidate's email warning icon should not describe a pending email update", { timeout: 90000 }, async function () {
  const tip = await listing(this).readPendingTooltip(this._iconCandidate.email);
  this.attach(`Tooltip on ${this._iconCandidate.email}: ${JSON.stringify(tip)}`, 'text/plain');
  expect(tip.opened, `the warning icon opened no tooltip: ${tip.reason}`).toBe(true);
  expect(tip.text, 'the candidate has NO email change pending (pending_email is null) - they simply have not '
    + 'verified their sign-up email - yet the tooltip says an email update is waiting for verification')
    .not.toMatch(/email update will take effect/i);
});

Then("that candidate's email warning icon should have an accessible name", async function () {
  const attrs = await this.page.locator(`[id="${this._iconCandidate.iconId}"]`).first().evaluate((b) => ({
    ariaLabel: b.getAttribute('aria-label'), labelledBy: b.getAttribute('aria-labelledby'),
    title: b.getAttribute('title'), text: (b.innerText || '').trim(),
  }));
  this.attach(`Icon attributes: ${JSON.stringify(attrs)}`, 'text/plain');
  expect(attrs.ariaLabel || attrs.labelledBy || attrs.title || attrs.text,
    'the warning icon is a <button> with no aria-label, aria-labelledby, title or text - a screen reader announces only "button"')
    .toBeTruthy();
});

// ==================== SEARCH SCOPE ====================

Then('the candidate search placeholder should read {string}', async function (expected) {
  expect(clean(await listing(this).searchPlaceholder())).toBe(expected);
});

const ownText = (r) => lower(`${r.full_name} ${r.email}`);
const tokens = (term) => lower(term).split(' ').filter(Boolean);
const matchesOwn = (r, term) => tokens(term).every((t) => ownText(r).includes(t));

Given('I have noted a candidate whose own name and email do not mention their agent', { timeout: 120000 }, async function () {
  const L = listing(this);
  const res = await L.runAndWaitForList(async () => { await L.goto('All'); });
  const pick = rawResults(res.payload).find((r) => r.agent_email && r.agent_name
    && !matchesOwn(r, r.agent_email) && !matchesOwn(r, r.agent_name));
  expect(pick, 'no candidate on the first page has an agent whose name and email differ from its own').toBeTruthy();
  this._agentSearchSubject = pick;
  this.attach(`Subject: ${pick.full_name} <${pick.email}>, agent ${pick.agent_name} <${pick.agent_email}>`, 'text/plain');
});

Then("searching the candidates for that candidate's agent should return only candidates matching in their own name or email:", { timeout: 240000 }, async function (table) {
  const L = listing(this);
  const subjectRow = this._agentSearchSubject;
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const term = row.term.trim() === 'agent email' ? subjectRow.agent_email : subjectRow.agent_name;
    const res = await L.search(term, { tab: 'All' });
    const results = rawResults(res.payload);
    const viaAgent = results.filter((r) => !matchesOwn(r, term));
    if (viaAgent.length) problems.push(`"${term}": ${viaAgent.length} candidate(s) returned that do not match in their own name or email: ${viaAgent.slice(0, 3).map((r) => `${r.full_name} <${r.email}> (agent ${r.agent_name})`).join(', ')}`);
    if (results.some((r) => lower(r.email) === lower(subjectRow.email))) problems.push(`"${term}": ${subjectRow.email} was returned although only its AGENT matches the term`);
    report.push(`"${term}" -> server count ${res.payload ? res.payload.count : 'none'}, first page ${results.length}, ${viaAgent.length} matched only via the agent`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The candidate search matched the Agent column:');
});

// ==================== KEYBOARD ====================

const ACTION_TESTID = {
  View: 'admin-candidates-view-button',
  Edit: 'admin-candidates-edit-email-button',
  'Deactivate account': 'admin-candidates-toggle-account-button',
  'Reactivate Account': 'admin-candidates-toggle-account-button',
};

// react-aria grid with a roving tabindex: Tab lands on a ROW, ArrowDown moves between rows and
// ArrowRight walks the focusable controls cell by cell (measured on Verifications and Audit Logs).
async function focusRowAction(world, action, rowIndex) {
  const testid = ACTION_TESTID[action];
  const target = world.page.locator('[role="row"]:not(:has([role="columnheader"]))').nth(rowIndex)
    .locator(`[data-testid="${testid}"]`).first();
  await world.page.getByRole('button', { name: /^filters/i }).first().focus();
  await world.page.keyboard.press('Tab');
  for (let i = 0; i < rowIndex; i++) await world.page.keyboard.press('ArrowDown');
  const isTarget = () => target.evaluate((b) => b === document.activeElement).catch(() => false);
  for (let i = 0; i < 30; i++) {
    if (await isTarget()) return { reached: true, presses: i };
    await world.page.keyboard.press('ArrowRight');
  }
  const active = await world.page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()} ${(a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 40)}` : 'nothing';
  });
  return { reached: await isTarget(), presses: 30, active };
}

async function rowIndexWithEnabled(world, action) {
  return world.page.evaluate((testid) => {
    const rows = Array.from(document.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]'));
    return rows.findIndex((r) => { const b = r.querySelector(`[data-testid="${testid}"]`); return b && !b.disabled; });
  }, ACTION_TESTID[action]);
}

const openDialog = (world, opens) => world.page.locator('[role="dialog"]:visible').filter({ hasText: new RegExp(opens, 'i') }).last();

Then('each candidate row action should be reachable by keyboard and open its dialog, sending nothing:', { timeout: 300000 }, async function (table) {
  const L = listing(this);
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const tab = row.tab.trim();
    const action = row.action.trim();
    const at = `${tab} > ${action}`;
    await L.runAndWaitForList(async () => { await L.goto(tab); });
    const index = await rowIndexWithEnabled(this, action);
    if (index < 0) { problems.push(`${at}: no row on the first page offers an enabled ${action}`); continue; }
    const writes = [];
    const onReq = (r) => { if (/\/api\//.test(r.url()) && r.method() !== 'GET' && !BACKGROUND.test(r.url())) writes.push(`${r.method()} ${r.url()}`); };
    this.page.on('request', onReq);
    try {
      const focus = await focusRowAction(this, action, index);
      if (!focus.reached) { problems.push(`${at}: ArrowRight never reached the action on row ${index + 1} (focus ended on ${focus.active})`); continue; }
      await this.page.keyboard.press('Enter');
      const dialog = openDialog(this, row.opens.trim());
      const opened = await dialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
      if (!opened) { problems.push(`${at}: Enter did not open "${row.opens}"`); continue; }
      await this.page.waitForTimeout(800);
      await this.page.keyboard.press('Escape');
      const closed = await dialog.waitFor({ state: 'hidden', timeout: 8000 }).then(() => true).catch(() => false);
      if (!closed) problems.push(`${at}: Escape did not close "${row.opens}"`);
      report.push(`${at}: reached on row ${index + 1} after ${focus.presses} ArrowRight press(es), Enter opened "${row.opens}", Escape ${closed ? 'closed it' : 'did NOT close it'}`);
    } finally {
      this.page.off('request', onReq);
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    if (writes.length) problems.push(`${at}: opening and dismissing it sent ${writes.join(', ')}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidate row action cannot be operated from the keyboard:');
});

// ==================== SIDEBAR ====================

Given('I have searched and filtered the Deactivated candidates', { timeout: 180000 }, async function () {
  const L = listing(this);
  const res = await L.runAndWaitForList(async () => { await L.goto('Deactivated'); });
  const first = rawResults(res.payload)[0];
  expect(first, 'the Deactivated tab lists no candidate').toBeTruthy();
  await L.search(first.email, { tab: 'Deactivated' });
  await L.openFilters();
  await L.selectFilterOption('Account Verification Status', first.is_verified ? 'Verified' : 'Unverified');
  await L.applyFilters();
  const url = new URL(this.page.url());
  expect(url.searchParams.get('accountTab'), 'the Deactivated tab is not in the URL').toBe('deactivated');
  expect(url.searchParams.get('search'), 'the search is not in the URL').toBeTruthy();
  expect(url.searchParams.get('accountVerification'), 'the filter is not in the URL').toBeTruthy();
  this.attach(`Before the sidebar click: ${this.page.url()}`, 'text/plain');
});

When('I open Candidates from the User Management sidebar', { timeout: 90000 }, async function () {
  const link = this.page.locator('nav a[href="/candidates"], aside a[href="/candidates"]').first();
  if (!(await link.isVisible().catch(() => false))) {
    await this.page.getByRole('button', { name: /^user management$/i }).first().click();
  }
  await expect(link, 'the sidebar offers no link to /candidates under User Management').toBeVisible({ timeout: 10000 });
  this._sidebarList = await listing(this).runAndWaitForList(async () => { await link.click(); }, { timeout: 15000 });
  await listing(this).settle();
});

Then('the Candidates listing should open on its All tab with no search or filter', { timeout: 60000 }, async function () {
  const L = listing(this);
  const problems = [];
  const url = new URL(this.page.url());
  if (url.pathname !== '/candidates') problems.push(`the URL is ${url.pathname}, not /candidates`);
  const params = [...url.searchParams.keys()];
  if (params.length) problems.push(`the URL still carries ${params.map((k) => `${k}=${url.searchParams.get(k)}`).join('&')}`);
  const tab = await L.currentTab();
  if (tab !== 'All') problems.push(`the selected tab is "${tab}", not "All"`);
  const term = clean(await L.searchInput.inputValue());
  if (term) problems.push(`the search box still holds ${JSON.stringify(term)}`);
  const count = await L.appliedFilterCount();
  if (count) problems.push(`the Filters button still counts ${count} applied filter(s)`);
  const req = this._sidebarList && this._sidebarList.requestUrl;
  if (req) {
    const q = new URL(req).searchParams;
    for (const k of q.keys()) {
      if (!['page', 'page_size', 'search'].includes(k)) problems.push(`the list request still carries ${k}=${q.get(k)}`);
    }
    if (q.get('search')) problems.push(`the list request still searches ${JSON.stringify(q.get('search'))}`);
  } else if (problems.length) {
    problems.push('no list request was sent, so the screen kept the previous query');
  }
  this.attach(`After the sidebar click: ${this.page.url()}\nrequest: ${req || '(none)'}`, 'text/plain');
  fail(problems, 'The sidebar Candidates link did not open a clean Candidates listing:');
});

// ==================== END TO END ====================

const e2eSubject = (world) => world._candidate || world._emailSubject;

Then("the searched candidate's row should show the server's values", { timeout: 90000 }, async function () {
  const list = this._candidateList;
  expect(list && list.payload, 'no search response was captured').toBeTruthy();
  const c = e2eSubject(this);
  const results = rawResults(list.payload);
  expect(results.some((r) => lower(r.email) === lower(c.email)), `the search did not return ${c.email}`).toBe(true);
  const { problems } = await compareRows(this, list.payload, `search "${c.email}"`);
  fail(problems, 'The searched candidate\'s row does not show what the server holds:');
});

When("I open that candidate's View from the keyboard", { timeout: 90000 }, async function () {
  const c = e2eSubject(this);
  const grid = await readGrid(this);
  const index = grid.findIndex((g) => g.Candidate && lower(g.Candidate.email) === lower(c.email));
  expect(index, `${c.email} is not on screen`).toBeGreaterThanOrEqual(0);
  this._e2eRow = grid[index];
  const focus = await focusRowAction(this, 'View', index);
  expect(focus.reached, `ArrowRight never reached View (focus ended on ${focus.active})`).toBe(true);
  await this.page.keyboard.press('Enter');
  await panel(this).waitForOpen();
});

Then('the drawer should show the same name and verification as the row', { timeout: 60000 }, async function () {
  const header = await panel(this).readHeader();
  const row = this._e2eRow;
  this.attach(`Row: ${JSON.stringify({ name: row.Candidate.name, verification: row['Account Verification'].text })}\nDrawer: ${JSON.stringify(header)}`, 'text/plain');
  const problems = [];
  if (!header) problems.push('no candidate drawer is open');
  else {
    if (clean(header.name) !== clean(row.Candidate.name)) problems.push(`the drawer names ${JSON.stringify(header.name)}, the row ${JSON.stringify(row.Candidate.name)}`);
    if (header.verification !== clean(row['Account Verification'].text)) problems.push(`the drawer says ${JSON.stringify(header.verification)}, the row ${JSON.stringify(row['Account Verification'].text)}`);
  }
  fail(problems, 'The drawer and the row disagree about the candidate:');
});

When('I press Escape to close the candidate drawer', { timeout: 30000 }, async function () {
  await this.page.keyboard.press('Escape');
  const state = await panel(this).staysClosed();
  expect(state.closed, `Escape did not close the candidate drawer (still open after ${state.at}ms)`).toBe(true);
});
