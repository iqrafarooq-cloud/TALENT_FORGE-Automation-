// The dual-runner binding, not @cucumber/cucumber directly - see fixtures/bdd.js.
//
// >>> THIS WAS THE LAST STEP FILE STILL IMPORTING @cucumber/cucumber, AND IT BROKE GENERATION
//     FOR THE WHOLE playwright-bdd RUNNER. <<< Found 2026-09-17. playwright-bdd's `loadSteps`
//     loads EVERY file under steps/ regardless of which features are registered in
//     configs/migratedFeatures.js, so importing Cucumber's constructors here tripped its
//     "invalid installation" check and `npm run gen` / `npm run pw:test` died with a stack
//     pointing at this line - nothing to do with audit logs, and nothing to do with whichever
//     feature the reader was actually working on.
//
// Under Cucumber this module is a verbatim passthrough, so this file behaves exactly as before;
// 24 of the 25 step files already imported it. Note `audit-logs.feature` is still NOT registered
// with playwright-bdd - this change unblocks generation, it does not migrate the area.
const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('chai');
const AuditLogsPage = require('../pages/AuditLogsPage');
const { readExport, asObjects } = require('../utils/spreadsheet');

// Step definitions for SuperAdmin Portal > Audit Logs.
//
// >>> EVERY PHRASE HERE IS WORDED "... Audit Logs ..." OR "... Log Details ...", DELIBERATELY. <<<
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
// fails generation on it instead). `steps/active-candidate.js`, `steps/require-attention.js` and
// `steps/candidate-management.js` already own most of the generic listing vocabulary, and every
// one of their steps is bound to its OWN page object - so reusing a phrase would not merely
// collide, it would drive the wrong page and pass or fail against it.
//
// Exactly ONE phrase is reused rather than redefined: `Given I am logged in as the superadmin`,
// which `steps/invite-agent.js` owns. It is page-agnostic (it builds its own LoginPage against
// `this.page`) and every superadmin feature in the repo shares it.
//
// NOTHING HERE MUTATES ANYTHING. An audit log has no create, edit or delete; the only row action
// opens a dialog and both exports are GETs. So there is no fixture guard and no teardown hook -
// there is nothing this file could spend.

const page = (w) => w.pages.auditLogs;

// Collect-then-throw. Cucumber abandons a scenario at its first failing step, and most steps
// here have between two and eight independent cases - reporting only the first would hide
// whether the rest share a cause. Every multi-case step below collects and throws once.
function reportAll(problems, headline) {
  if (!problems.length) return;
  throw new Error(`${headline}\n  - ${problems.join('\n  - ')}`);
}

// Attach a block of evidence to the report. Always awaited: an un-awaited attach is dropped
// when the world is torn down, which is how the promo module's "could not restore" warning
// never reached a single report.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

function notes(world) {
  if (!world._audit) world._audit = {};
  return world._audit;
}

// ---------------------------------------------------------------- Given

Given('I am on the Audit Logs page', { timeout: 90000 }, async function () {
  await page(this).navigate();
  notes(this).baseline = page(this).requestCount();
});

// ---------------------------------------------------------------- the page itself

Then('the Audit Logs grid should be displayed', async function () {
  await expect(page(this).table).to.be.ok;
  const visible = await page(this).table.isVisible();
  if (!visible) throw new Error('The Audit Logs grid is not displayed.');
});

Then(
  'the Audit Logs page should offer a search box, a Filters button and an Export button',
  async function () {
    const p = page(this);
    const problems = [];
    if (!(await p.searchInput.isVisible().catch(() => false))) problems.push('no search box');
    if (!(await p.filtersButton.isVisible().catch(() => false))) problems.push('no Filters button');
    if (!(await p.exportButton.isVisible().catch(() => false))) problems.push('no Export button');
    reportAll(problems, 'The Audit Logs page is missing one of its three controls:');
  }
);

// Asserted EXACTLY and IN ORDER. The row readers address cells by `data-column-index`, so an
// inserted column silently shifts every index and a tolerant check would let every later
// assertion read the wrong cell.
Then('the Audit Logs columns should be exactly:', async function (table) {
  const want = table.raw().map((r) => r[0].trim());
  const got = await page(this).columnHeaders();
  await record(this, 'Rendered columns', got);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(
      `The Audit Logs columns are not what was measured.\n  expected: ${JSON.stringify(want)}\n  actual:   ${JSON.stringify(got)}`
    );
  }
});

Then('every Audit Logs row should carry a value in every column', async function () {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('No Audit Logs rows are displayed, so no row could be checked.');
  const problems = [];
  rows.forEach((r, i) => {
    // Entity Name is legitimately blank on some event types (a config change with no named
    // subject), so it is excluded rather than asserted and then explained away.
    ['dateTime', 'actionBy', 'actionType', 'entity', 'ipAddress', 'location'].forEach((f) => {
      if (!r[f]) problems.push(`row ${i}: ${f} is empty`);
    });
  });
  await record(this, 'Rows read', rows);
  reportAll(problems, 'Some Audit Logs rows are missing values:');
});

Then('the Audit Logs grid should render no more rows than the requested page size', async function () {
  const p = page(this);
  const size = p.requestedPageSize();
  const rows = await p.rowCount();
  await record(this, 'Page size', { requestedPageSize: size, renderedRows: rows });
  if (size === null) throw new Error('No Audit Logs list request was recorded, so the page size is unknown.');
  if (rows > size) {
    throw new Error(`The grid rendered ${rows} rows but the app asked the server for page_size=${size}.`);
  }
  if (rows === 0) throw new Error('The grid rendered no rows at all.');
});

Then('Audit Logs pagination should be displayed', async function () {
  if (!(await page(this).pagination.isVisible().catch(() => false))) {
    throw new Error('The Audit Logs pagination navigation is not displayed.');
  }
});

Then('Audit Logs pagination should not be displayed', async function () {
  if (await page(this).pagination.isVisible().catch(() => false)) {
    throw new Error('The Audit Logs pagination navigation is displayed on a page with no results.');
  }
});

Then(
  'the first Audit Logs row should hold a real timestamp, actor and action type',
  async function () {
    const rows = await page(this).readRows();
    if (!rows.length) throw new Error('No Audit Logs rows are displayed.');
    const r = rows[0];
    const problems = [];
    if (!/^\d{2}-\d{2}-\d{4}\b/.test(r.dateTime)) problems.push(`dateTime is "${r.dateTime}"`);
    if (!r.actionBy) problems.push('actionBy is empty');
    if (!r.actionType) problems.push('actionType is empty');
    await record(this, 'First row', r);
    reportAll(problems, 'The first Audit Logs row was read before its cells had content:');
  }
);

// ---------------------------------------------------------------- search

// Drive one search per table row, each term taken from a REAL row currently in the grid rather
// than hardcoded. A hardcoded term goes stale the day the data changes and the failure then
// describes a broken search rather than a stale fixture.
When('I search the Audit Logs by each of these fields:', { timeout: 240000 }, async function (table) {
  const p = page(this);
  const n = notes(this);
  n.searchRuns = [];

  await p.clearSearch();
  const sample = await p.readRows();
  if (!sample.length) throw new Error('The Audit Logs listing is empty, so no search term could be derived.');

  const fieldOf = {
    'Action By': (r) => r.actionBy,
    'Action By Email': (r) => r.actionByEmail,
    'Action Type': (r) => r.actionType,
    'Entity Name': (r) => r.entityName,
    'IP Address': (r) => r.ipAddress,
    'Location': (r) => r.location,
    'Endpoint': (r) => r.endpoint,
    'Event Details': (r) => r.eventDetails,
  };

  for (const row of table.hashes()) {
    const field = row.field.trim();
    const pick = fieldOf[field];
    if (!pick) throw new Error(`Unknown search field "${field}".`);

    // First row that actually holds this field, so a blank cell cannot become a blank search.
    const source = sample.find((r) => (pick(r) || '').trim().length > 2);
    if (!source) {
      n.searchRuns.push({ field, term: null, skipped: 'no row in the grid holds this field' });
      continue;
    }
    let term = pick(source).trim();
    // Event Details can be a whole sentence; take a distinctive token so the search is a fair
    // test of the field rather than of exact-string matching.
    if (field === 'Event Details') term = (term.split(/[,;]/)[0] || term).trim().slice(0, 40);

    const before = p.requestCount();
    const sent = await p.search(term);
    const rows = await p.readRows();
    const matched = rows.filter((r) => (pick(r) || '').toLowerCase().includes(term.toLowerCase()));

    n.searchRuns.push({
      field,
      term,
      sent,
      query: p.lastRequestQuery(),
      rowsReturned: rows.length,
      rowsMatchingTerm: matched.length,
      requestsFired: p.requestCount() - before,
    });
  }

  await p.clearSearch();
  await record(this, 'Search runs', n.searchRuns);
});

When('I search the Audit Logs by each of these terms:', { timeout: 240000 }, async function (table) {
  const p = page(this);
  const n = notes(this);
  n.searchRuns = [];
  n.pageErrors = [];
  n.dialogs = [];

  // A hostile term that actually executed would most likely surface as a page error or a native
  // dialog, and neither is visible in a row count. Both are watched for the duration.
  const onError = (e) => n.pageErrors.push(String(e));
  const onDialog = async (d) => {
    n.dialogs.push({ type: d.type(), message: d.message() });
    await d.dismiss().catch(() => {});
  };
  this.page.on('pageerror', onError);
  this.page.on('dialog', onDialog);

  try {
    for (const row of table.hashes()) {
      const term = row.term;
      const sent = await p.search(term);
      const rows = await p.readRows();
      n.searchRuns.push({ field: 'hostile', term, sent, rowsReturned: rows.length, query: p.lastRequestQuery() });
    }
  } finally {
    this.page.off('pageerror', onError);
    this.page.off('dialog', onDialog);
  }
  await record(this, 'Hostile search runs', { runs: n.searchRuns, pageErrors: n.pageErrors, dialogs: n.dialogs });
});

Then('every Audit Logs search should have returned at least one row matching the term', async function () {
  const runs = notes(this).searchRuns || [];
  const problems = [];
  runs.forEach((r) => {
    if (r.skipped) {
      problems.push(`${r.field}: SKIPPED - ${r.skipped}`);
      return;
    }
    if (r.rowsReturned === 0) problems.push(`${r.field}: searching "${r.term}" returned no rows at all`);
    else if (r.rowsMatchingTerm === 0) {
      problems.push(
        `${r.field}: searching "${r.term}" returned ${r.rowsReturned} rows but none of them holds the term in that column`
      );
    }
  });
  reportAll(problems, 'The Audit Logs search did not match every field it is documented to cover:');
});

Then('every Audit Logs search should have sent the term to the server', async function () {
  const runs = notes(this).searchRuns || [];
  const problems = [];
  runs.filter((r) => !r.skipped).forEach((r) => {
    if (!r.sent) problems.push(`${r.field}: no request was fired for "${r.term}"`);
    else if (!(r.query || '').includes(`search=${r.term}`)) {
      problems.push(`${r.field}: the request carried "${r.query}", which does not hold search=${r.term}`);
    }
  });
  reportAll(problems, 'Some Audit Logs searches were not sent to the server:');
});

Then('every Audit Logs search should have returned no rows', async function () {
  const runs = notes(this).searchRuns || [];
  const problems = [];
  runs.filter((r) => !r.skipped).forEach((r) => {
    if (r.rowsReturned !== 0) {
      problems.push(`searching "${r.term}" returned ${r.rowsReturned} rows, where the search is not scoped to that column`);
    }
  });
  reportAll(problems, 'The Audit Logs search matched a column it is not scoped to:');
});

Then('no Audit Logs search should have raised a page error or a browser dialog', async function () {
  const n = notes(this);
  const problems = [];
  if ((n.pageErrors || []).length) problems.push(`page errors: ${JSON.stringify(n.pageErrors)}`);
  if ((n.dialogs || []).length) problems.push(`browser dialogs: ${JSON.stringify(n.dialogs)}`);
  reportAll(problems, 'A hostile search term was not treated as plain text:');
});

Then('the Audit Logs page should still be usable', async function () {
  const p = page(this);
  await p.clearSearch();
  const rows = await p.rowCount();
  if (rows === 0) {
    throw new Error('After clearing the search the Audit Logs listing is still empty - the page did not recover.');
  }
});

When('I search the Audit Logs for {string}', { timeout: 90000 }, async function (term) {
  const p = page(this);
  const n = notes(this);
  n.searchBaseline = p.requestCount();
  n.lastTerm = term;
  n.lastSearchSent = await p.search(term);
  n.lastSearchQuery = p.lastRequestQuery();
});

When(
  'I search the Audit Logs for a location and then for its lowercase partial form',
  { timeout: 120000 },
  async function () {
    const p = page(this);
    const n = notes(this);
    await p.clearSearch();
    const sample = await p.readRows();
    const source = sample.find((r) => (r.location || '').length > 4);
    if (!source) throw new Error('No row in the grid carries a location to search for.');

    // "Karachi, Pakistan" -> "Karachi", then "karac" - a lowercase PARTIAL of the same value, so
    // the two searches differ in case and in length but must resolve to the same set.
    const full = source.location.split(',')[0].trim();
    const partial = full.slice(0, Math.max(4, full.length - 2)).toLowerCase();

    await p.search(full);
    n.compareA = { term: full, rows: await p.readRows() };
    await p.search(partial);
    n.compareB = { term: partial, rows: await p.readRows() };
    await record(this, 'Case/partial comparison', {
      a: { term: n.compareA.term, count: n.compareA.rows.length },
      b: { term: n.compareB.term, count: n.compareB.rows.length },
    });
  }
);

Then('both Audit Logs searches should return the same rows', async function () {
  const n = notes(this);
  const key = (rows) => rows.map((r) => `${r.dateTime}|${r.actionType}|${r.entityName}`).join('\n');
  if (key(n.compareA.rows) !== key(n.compareB.rows)) {
    throw new Error(
      `"${n.compareA.term}" (${n.compareA.rows.length} rows) and "${n.compareB.term}" `
      + `(${n.compareB.rows.length} rows) returned different results, so the search is not `
      + 'case-insensitive or does not match a partial term.'
    );
  }
});

Then('the Audit Logs URL should contain the search term', async function () {
  const term = notes(this).lastTerm;
  const url = decodeURIComponent(this.page.url().replace(/\+/g, ' '));
  if (!url.includes(`search=${term}`)) {
    throw new Error(`The URL is "${url}", which does not carry search=${term}.`);
  }
});

Then('the Audit Logs URL should not contain a search parameter', async function () {
  const url = this.page.url();
  if (/[?&]search=/.test(url)) throw new Error(`The URL still carries a search parameter: ${url}`);
});

Then('the Audit Logs URL should not contain a filter parameter', async function () {
  const url = this.page.url();
  if (/[?&](entity|last_activity)=/.test(url)) {
    throw new Error(`The URL still carries a filter parameter: ${url}`);
  }
});

Then('the Audit Logs URL should contain {string}', async function (fragment) {
  const url = this.page.url();
  if (!url.includes(fragment)) throw new Error(`The URL is "${url}", which does not contain "${fragment}".`);
});

Then('the Audit Logs URL should not contain {string}', async function (fragment) {
  const url = this.page.url();
  if (url.includes(fragment)) throw new Error(`The URL is "${url}", which still contains "${fragment}".`);
});

Then('the Audit Logs search box should still hold the term after a reload', { timeout: 90000 }, async function () {
  const p = page(this);
  const n = notes(this);
  n.beforeReload = await p.readRows();
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await p.settleRows();
  const value = await p.searchValue();
  if (value !== n.lastTerm) {
    throw new Error(`After a reload the search box holds "${value}", not "${n.lastTerm}".`);
  }
});

Then('the reloaded results should be the same as before the reload', async function () {
  const p = page(this);
  const n = notes(this);
  const after = await p.readRows();
  const key = (rows) => rows.map((r) => `${r.dateTime}|${r.actionType}`).join('\n');
  if (key(after) !== key(n.beforeReload)) {
    throw new Error(
      `The reload returned different rows.\n  before: ${key(n.beforeReload)}\n  after:  ${key(after)}`
    );
  }
});

Then('the Audit Logs search box should still hold {string}', async function (term) {
  const value = await page(this).searchValue();
  if (value !== term) throw new Error(`The search box holds "${value}", not "${term}".`);
});

Then('the Audit Logs search box should be empty', async function () {
  const value = await page(this).searchValue();
  if (value !== '') throw new Error(`The search box still holds "${value}".`);
});

Then('no Audit Logs request should have been sent for that search', async function () {
  const n = notes(this);
  const after = page(this).requestCount();
  const fired = after - n.searchBaseline;
  if (fired !== 0) {
    throw new Error(
      `The app sent ${fired} request(s) for a whitespace-only search: `
      + JSON.stringify(page(this).requestsSince(n.searchBaseline))
    );
  }
});

Then('Audit Logs rows should be displayed', async function () {
  const rows = await page(this).rowCount();
  if (rows === 0) throw new Error('No Audit Logs rows are displayed.');
});

Then('no Audit Logs rows should be displayed', async function () {
  const rows = await page(this).rowCount();
  if (rows !== 0) throw new Error(`${rows} Audit Logs rows are displayed where none were expected.`);
});

When('I note how many Audit Logs rows are shown', async function () {
  const p = page(this);
  notes(this).notedRowCount = await p.rowCount();
  notes(this).notedServerCount = p.lastServerCount;
  notes(this).notedRows = await p.readRows();
});

When('I clear the Audit Logs search', { timeout: 60000 }, async function () {
  await page(this).clearSearch();
});

// Compared on the SERVER's count, not rendered rows: a search matching more than one page (14 for
// "Community Created" against page_size 9) renders a full page either way.
Then('the Audit Logs listing should show more rows than it did while searching', async function () {
  const n = notes(this);
  const p = page(this);
  const until = Date.now() + 10000;
  while (p.lastServerCount === n.notedServerCount && Date.now() < until) await this.page.waitForTimeout(250);
  if (n.notedServerCount == null || p.lastServerCount == null) {
    throw new Error('The server total was not captured for the search or for the cleared listing.');
  }
  if (!(p.lastServerCount > n.notedServerCount)) {
    throw new Error(
      `Clearing the search left ${p.lastServerCount} logs on the server, which is not more than the `
      + `${n.notedServerCount} matched while searching.`
    );
  }
});

Then('the Audit Logs listing should show the same rows as before', async function () {
  const n = notes(this);
  const now = await page(this).readRows();
  const key = (rows) => rows.map((r) => `${r.dateTime}|${r.actionType}`).join('\n');
  if (key(now) !== key(n.notedRows)) {
    throw new Error('The listing changed while the Log Details dialog was open and closed.');
  }
});

// ---------------------------------------------------------------- empty states

Then('the Audit Logs empty state should be the {string} one', async function (which) {
  const p = page(this);
  const state = await p.readEmptyState();
  await record(this, 'Empty state', state);
  if (!state) throw new Error('No Audit Logs empty state is displayed.');
  const want = AuditLogsPage.EMPTY_STATES[which];
  if (!want) throw new Error(`Unknown empty state "${which}".`);
  notes(this).emptyState = state;
  if (!state.body.includes(want.body)) {
    throw new Error(
      `The empty state does not describe the "${which}" case.\n  expected body: ${want.body}\n  actual body:   ${state.body}`
    );
  }
});

// Asserted EXACTLY, not with `includes`. An `includes` check would go on passing if a sub-line
// were added later, and the whole behaviour here is that the app names precisely which of
// search and filters is active.
Then('the Audit Logs empty state should read exactly:', async function (table) {
  const want = {};
  table.raw().forEach(([k, v]) => { want[k.trim()] = v.trim(); });
  const state = await page(this).readEmptyState();
  if (!state) throw new Error('No Audit Logs empty state is displayed.');
  const problems = [];
  if (state.heading !== want.heading) problems.push(`heading is "${state.heading}", expected "${want.heading}"`);
  if (state.body !== want.body) problems.push(`body is "${state.body}", expected "${want.body}"`);
  reportAll(problems, 'The Audit Logs empty state is not worded as measured:');
});

Then('the Audit Logs empty state should offer no Clear CTA', async function () {
  const visible = await page(this).clearAllFiltersCta().isVisible().catch(() => false);
  if (visible) throw new Error('The search-only empty state offers a "Clear all filters" CTA, where none was measured.');
});

Then('the Audit Logs empty state should offer a Clear CTA', async function () {
  const visible = await page(this).clearAllFiltersCta().isVisible().catch(() => false);
  if (!visible) throw new Error('The empty state offers no "Clear all filters" CTA.');
});

When('I click the Audit Logs empty state Clear CTA', { timeout: 60000 }, async function () {
  const p = page(this);
  await p.clearAllFiltersCta().click();
  await p.settleRows();
  await this.page.waitForTimeout(500);
  // The CTA says "filters" and clears the SEARCH too. Recorded for the PO rather than failed on:
  // restoring the whole listing is the useful behaviour, but the label under-describes it.
  await record(
    this,
    'RECORDED (question for the PO)',
    'The empty state CTA is labelled "Clear all filters" and also clears the SEARCH box. '
    + 'Restoring the full listing is arguably right, but the label describes only half of what it does.'
  );
});

// ---------------------------------------------------------------- filters

When('I open the Audit Logs filter modal', { timeout: 60000 }, async function () {
  const p = page(this);
  notes(this).filterBaseline = p.requestCount();
  await p.openFilters();
});

Then('the Audit Logs filter modal should offer these groups and options:', async function (table) {
  const options = await page(this).readFilterOptions();
  await record(this, 'Filter options as rendered', options);
  const problems = [];

  for (const row of table.hashes()) {
    const want = row.options.split(',').map((s) => s.trim());
    const got = options.filter((o) => o.group === row.group);
    const gotText = got.map((o) => o.text);
    if (JSON.stringify(gotText) !== JSON.stringify(want)) {
      problems.push(`${row.group}: options are ${JSON.stringify(gotText)}, expected ${JSON.stringify(want)}`);
    }
    got.forEach((o) => {
      if (o.control !== row.control) {
        problems.push(`${row.group} > "${o.text}" is a ${o.control}, expected a ${row.control}`);
      }
    });
  }

  const declared = table.hashes().reduce((n, r) => n + r.options.split(',').length, 0);
  if (options.length !== declared) {
    problems.push(`the modal renders ${options.length} options in total, expected ${declared}`);
  }
  reportAll(problems, 'The Audit Logs filter modal is not what was measured:');
});

Then('no Audit Logs filter option should be selected', async function () {
  const options = await page(this).readFilterOptions();
  const on = options.filter((o) => o.checked).map((o) => o.text);
  if (on.length) throw new Error(`These filter options are selected where none should be: ${JSON.stringify(on)}`);
});

Then('the Audit Logs filter modal should offer Clear All, Cancel and Apply Filters', async function () {
  const p = page(this);
  const problems = [];
  if (!(await p.clearAllButton.isVisible().catch(() => false))) problems.push('no Clear All');
  if (!(await p.cancelFiltersButton.isVisible().catch(() => false))) problems.push('no Cancel');
  if (!(await p.applyFiltersButton.isVisible().catch(() => false))) problems.push('no Apply Filters');
  reportAll(problems, 'The Audit Logs filter modal is missing a footer control:');
});

// Each option applied ALONE, clearing between rows - that is what makes each row "on its own".
// Both the URL param and the API param are checked, because for Entity they are different
// strings and a URL-only check would pass on a front end querying the server for something else.
When('I apply each Audit Logs filter on its own:', { timeout: 300000 }, async function (table) {
  const p = page(this);
  const n = notes(this);
  n.filterRuns = [];

  for (const row of table.hashes()) {
    await p.navigate();
    await p.openFilters();
    await p.selectFilterOption(row.option);
    const before = p.requestCount();
    await p.applyFilters();
    const sent = p.requestsSince(before);
    const url = decodeURIComponent(this.page.url().replace(/\+/g, ' '));
    n.filterRuns.push({
      option: row.option,
      wantUrl: row['url parameter'],
      wantApi: row['api parameter'],
      url,
      apiQueries: sent,
      urlOk: url.includes(row['url parameter']),
      apiOk: sent.some((q) => q.includes(row['api parameter'])),
      rows: await p.rowCount(),
    });
  }
  await record(this, 'Filter runs', n.filterRuns);
});

Then('every Audit Logs filter should have sent both of its parameters', async function () {
  const runs = notes(this).filterRuns || [];
  const problems = [];
  runs.forEach((r) => {
    if (!r.urlOk) problems.push(`${r.option}: the URL is "${r.url}", which does not carry "${r.wantUrl}"`);
    if (!r.apiOk) {
      problems.push(
        `${r.option}: no request carried "${r.wantApi}". Requests sent: ${JSON.stringify(r.apiQueries)}`
      );
    }
  });
  reportAll(problems, 'Some Audit Logs filters did not reach the server as measured:');
});

When('I select the Audit Logs filter option {string}', async function (label) {
  await page(this).selectFilterOption(label);
});

When('I select the Audit Logs filter options {string} and {string}', async function (a, b) {
  await page(this).selectFilterOption(a);
  await page(this).selectFilterOption(b);
});

When('I apply the Audit Logs filters', { timeout: 90000 }, async function () {
  const p = page(this);
  notes(this).applyBaseline = notes(this).filterBaseline ?? p.requestCount();
  await p.applyFilters();
});

When('I cancel the Audit Logs filter modal', { timeout: 60000 }, async function () {
  const p = page(this);
  await p.closeFilters();
  // A request already in flight arrives AFTER the click, so a single sample here would pass on a
  // cancel that did fire one. Watch a window instead.
  await this.page.waitForTimeout(3000);
});

When('I clear all filters inside the Audit Logs modal', async function () {
  await page(this).clearAllInModal();
});

Then('no Audit Logs request should have been sent for that filter', async function () {
  const n = notes(this);
  const sent = page(this).requestsSince(n.filterBaseline);
  if (sent.length) {
    throw new Error(`Cancelling the filter modal sent ${sent.length} request(s): ${JSON.stringify(sent)}`);
  }
});

Then('the Audit Logs request should have carried {string}', async function (fragment) {
  const n = notes(this);
  const baseline = n.applyBaseline ?? n.baseline ?? 0;
  const sent = page(this).requestsSince(baseline);
  if (!sent.some((q) => q.includes(fragment))) {
    throw new Error(`No request carried "${fragment}". Requests sent: ${JSON.stringify(sent)}`);
  }
});

Then('the Audit Logs request should not have carried {string}', async function (fragment) {
  const n = notes(this);
  const baseline = n.applyBaseline ?? n.baseline ?? 0;
  const sent = page(this).requestsSince(baseline);
  const hit = sent.filter((q) => q.includes(fragment));
  if (hit.length) throw new Error(`A request carried "${fragment}", which it should not: ${JSON.stringify(hit)}`);
});

Then(
  'the Audit Logs request should have carried both {string} and {string}',
  async function (a, b) {
    const sent = page(this).requestsSince(0);
    const both = sent.filter((q) => q.includes(a) && q.includes(b));
    if (!both.length) {
      throw new Error(
        `No single request carried both "${a}" and "${b}". Requests sent: ${JSON.stringify(sent)}`
      );
    }
  }
);

Then('every Audit Logs row should have an entity of {string}', async function (entity) {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('No Audit Logs rows are displayed, so the filter could not be checked.');
  const bad = rows.filter((r) => r.entity.toLowerCase() !== entity.toLowerCase());
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${rows.length} rows are not "${entity}": ${JSON.stringify(bad.map((r) => r.entity))}`
    );
  }
});

Then('every Audit Logs row should have an entity of {string} or {string}', async function (a, b) {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('No Audit Logs rows are displayed, so the filter could not be checked.');
  const ok = [a.toLowerCase(), b.toLowerCase()];
  const bad = rows.filter((r) => !ok.includes(r.entity.toLowerCase()));
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${rows.length} rows are neither "${a}" nor "${b}": ${JSON.stringify(bad.map((r) => r.entity))}`
    );
  }
});

Then('every Audit Logs row should have an action type of {string}', async function (type) {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('No Audit Logs rows are displayed.');
  const bad = rows.filter((r) => r.actionType.toLowerCase() !== type.toLowerCase());
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${rows.length} rows are not "${type}": ${JSON.stringify(bad.map((r) => r.actionType))}`
    );
  }
});

Then('only {string} should be selected in the Last Activity group', async function (label) {
  const options = await page(this).readFilterOptions();
  const group = options.filter((o) => o.group === 'Last Activity');
  const on = group.filter((o) => o.checked).map((o) => o.text);
  if (JSON.stringify(on) !== JSON.stringify([label])) {
    throw new Error(`Last Activity has ${JSON.stringify(on)} selected, expected only ["${label}"].`);
  }
});

Then('the Audit Logs Filters button should show an applied-filter count of {int}', async function (n) {
  const got = await page(this).appliedFilterCount();
  if (got !== n) {
    throw new Error(
      `The Filters button shows an applied-filter count of ${got}, expected ${n}. `
      + '(This badge counts OPTIONS, not groups - see the note in the feature file.)'
    );
  }
});

// Chooses its combination instead of guessing, and VERIFIES the result is empty before the
// scenario relies on it. A hardcoded pair that happens to be empty today stops being empty the
// moment somebody performs that action, and the scenario would then fail describing a missing
// empty state.
When('I apply an Audit Logs filter combination that no log satisfies', { timeout: 180000 }, async function () {
  const p = page(this);
  const tried = [];
  const entities = ['Community', 'Candidate', 'Configuration', 'Agent'];

  for (const entity of entities) {
    await p.navigate();
    await p.openFilters();
    await p.selectFilterOption(entity);
    await p.selectFilterOption('Last 24 hours');
    notes(this).filterBaseline = p.requestCount();
    await p.applyFilters();
    const rows = await p.rowCount();
    tried.push({ entity, lastActivity: 'Last 24 hours', rows });
    if (rows === 0) {
      await record(this, 'Empty filter combination found', tried);
      return;
    }
  }
  await record(this, 'Filter combinations tried', tried);
  throw new Error(
    'Every entity has audit logs in the last 24 hours, so no filter-only empty state could be '
    + `reached. Tried: ${JSON.stringify(tried)}`
  );
});

// ---------------------------------------------------------------- export

When('I open the Audit Logs Export menu', { timeout: 60000 }, async function () {
  await page(this).openExportMenu();
});

Then('the Audit Logs Export menu should offer exactly:', async function (table) {
  const got = await page(this).readExportOptions();
  await record(this, 'Export menu', got);
  const want = table.hashes().map((r) => ({ text: r.label, key: r.key }));
  const norm = got.map((o) => ({ text: o.text, key: o.key }));
  if (JSON.stringify(norm) !== JSON.stringify(want)) {
    throw new Error(
      `The Export menu is not what was measured.\n  expected: ${JSON.stringify(want)}\n  actual:   ${JSON.stringify(norm)}`
    );
  }
  await page(this).closeExportMenu();
});

When('I export the Audit Logs as {string}', { timeout: 180000 }, async function (format) {
  const p = page(this);
  const n = notes(this);
  // The rows on screen at export time, so the file can be reconciled against what the
  // superadmin was actually looking at.
  n.rowsAtExport = await p.readRows();
  const result = await p.exportAs(format);
  const parsed = readExport(result.filePath);
  const record0 = {
    format,
    file: result.suggestedFilename,
    bytes: result.bytes,
    requestQuery: result.requestQuery,
    columns: parsed.header.length,
    dataRows: parsed.rows.length,
  };
  n.exports = n.exports || [];
  n.exports.push({ ...result, parsed, format });
  n.lastExport = n.exports[n.exports.length - 1];
  await record(this, `Export (${format})`, record0);
});

Then('the downloaded file should be named {string}', async function (name) {
  const e = notes(this).lastExport;
  if (e.suggestedFilename !== name) {
    throw new Error(`The download is named "${e.suggestedFilename}", expected "${name}".`);
  }
});

Then('the export should be a readable CSV', async function () {
  const e = notes(this).lastExport;
  if (!e.parsed.header.length) throw new Error('The exported CSV has no header row.');
  if (e.bytes === 0) throw new Error('The exported CSV is zero bytes.');
});

// A .xlsx that is really a renamed CSV is a real and easy defect, and the file name alone cannot
// tell you. The reader inflates the zip, so reaching a worksheet at all is the proof.
Then('the export should be a real xlsx workbook and not a renamed CSV', async function () {
  const fs = require('fs');
  const e = notes(this).lastExport;
  const head = fs.readFileSync(e.filePath).slice(0, 4);
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error(
      `The .xlsx does not start with the ZIP magic bytes PK - it is not an OOXML workbook. `
      + `First bytes: ${JSON.stringify(head.toString('utf8'))}`
    );
  }
  if (!e.parsed.header.length) throw new Error('The workbook holds no worksheet header row.');
});

Then('the export columns should be exactly:', async function (table) {
  const want = table.raw().map((r) => r[0].trim());
  const got = notes(this).lastExport.parsed.header.map((h) => h.trim());
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(
      `The export columns are not what was measured.\n  expected: ${JSON.stringify(want)}\n  actual:   ${JSON.stringify(got)}`
    );
  }
});

Then('every export row should hold a value in every one of those columns', async function () {
  const e = notes(this).lastExport;
  const rows = asObjects(e.parsed);
  if (!rows.length) throw new Error('The export holds no data rows.');
  const problems = [];
  // Entity Name and Endpoint are legitimately blank on some event types, so a blank there is not
  // a defect. The rest identify WHO did WHAT, WHEN and FROM WHERE, which an audit record cannot
  // be missing.
  const required = ['Date & Time', 'Action By', 'Action Type', 'Entity', 'IP Address', 'Location', 'Event Type'];
  rows.forEach((r, i) => {
    required.forEach((c) => {
      if (!String(r[c] || '').trim()) problems.push(`row ${i + 1}: "${c}" is empty`);
    });
  });
  reportAll(problems.slice(0, 20), `The export has empty required cells (${problems.length} in total):`);
});

Then('the export should carry every column the grid shows except {string}', async function (excluded) {
  const got = notes(this).lastExport.parsed.header.map((h) => h.trim());
  const problems = [];
  AuditLogsPage.COLUMNS.filter((c) => c !== excluded).forEach((c) => {
    if (!got.includes(c)) problems.push(`the export is missing the grid column "${c}"`);
  });
  if (got.includes(excluded)) {
    problems.push(`the export carries "${excluded}", which is a button column with nothing to export`);
  }
  reportAll(problems, 'The export does not carry the grid columns:');
});

Then('the export should additionally carry:', async function (table) {
  const want = table.raw().map((r) => r[0].trim());
  const got = notes(this).lastExport.parsed.header.map((h) => h.trim());
  const missing = want.filter((c) => !got.includes(c));
  if (missing.length) {
    throw new Error(
      `The export is missing the extra columns ${JSON.stringify(missing)}. It carries: ${JSON.stringify(got)}`
    );
  }
});

Then("the export's Metadata column should hold readable JSON", async function () {
  const rows = asObjects(notes(this).lastExport.parsed);
  const problems = [];
  rows.slice(0, 25).forEach((r, i) => {
    const raw = String(r.Metadata || '').trim();
    if (!raw) return; // a row with no metadata is legitimate
    try {
      const o = JSON.parse(raw);
      if (typeof o !== 'object' || o === null) problems.push(`row ${i + 1}: Metadata is not an object`);
    } catch (err) {
      problems.push(`row ${i + 1}: Metadata is not valid JSON (${err.message}) - ${raw.slice(0, 80)}`);
    }
  });
  reportAll(problems, 'The export\'s Metadata column does not hold readable JSON:');
});

Then('the two Audit Logs exports should have identical columns', async function () {
  const [a, b] = notes(this).exports;
  if (JSON.stringify(a.parsed.header) !== JSON.stringify(b.parsed.header)) {
    throw new Error(
      `The two exports have different columns.\n  ${a.format}: ${JSON.stringify(a.parsed.header)}\n  ${b.format}: ${JSON.stringify(b.parsed.header)}`
    );
  }
});

Then('the two Audit Logs exports should hold the same number of rows', async function () {
  const [a, b] = notes(this).exports;
  if (a.parsed.rows.length !== b.parsed.rows.length) {
    throw new Error(
      `${a.format} holds ${a.parsed.rows.length} rows and ${b.format} holds ${b.parsed.rows.length}.`
    );
  }
});

Then('the two Audit Logs exports should agree row for row', async function () {
  const [a, b] = notes(this).exports;
  const problems = [];
  const n = Math.min(a.parsed.rows.length, b.parsed.rows.length);
  for (let i = 0; i < n; i += 1) {
    const ra = a.parsed.rows[i].map((c) => String(c).trim());
    const rb = b.parsed.rows[i].map((c) => String(c).trim());
    if (JSON.stringify(ra) !== JSON.stringify(rb)) {
      const col = ra.findIndex((c, j) => c !== rb[j]);
      problems.push(
        `row ${i + 1}, column "${a.parsed.header[col]}": ${a.format} has ${JSON.stringify(ra[col])}, `
        + `${b.format} has ${JSON.stringify(rb[col])}`
      );
    }
  }
  reportAll(problems.slice(0, 10), `The two exports disagree on ${problems.length} row(s):`);
});

Then('the export request should have carried {string}', async function (fragment) {
  const e = notes(this).lastExport;
  if (!e.requestQuery) throw new Error('No export request was captured, so what it asked for is unknown.');
  if (!e.requestQuery.includes(fragment)) {
    throw new Error(`The export asked the server for "${e.requestQuery}", which does not carry "${fragment}".`);
  }
});

Then('every export row should have an action type of {string}', async function (type) {
  const rows = asObjects(notes(this).lastExport.parsed);
  if (!rows.length) throw new Error('The export holds no data rows.');
  const bad = rows.filter((r) => String(r['Action Type'] || '').toLowerCase() !== type.toLowerCase());
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${rows.length} exported rows are not "${type}" - the export did not honour the search. `
      + `Examples: ${JSON.stringify(bad.slice(0, 5).map((r) => r['Action Type']))}`
    );
  }
});

Then('every export row should have an entity of {string}', async function (entity) {
  const rows = asObjects(notes(this).lastExport.parsed);
  if (!rows.length) throw new Error('The export holds no data rows.');
  const bad = rows.filter((r) => String(r.Entity || '').toLowerCase() !== entity.toLowerCase());
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${rows.length} exported rows are not "${entity}" - the export did not honour the filter. `
      + `Examples: ${JSON.stringify(bad.slice(0, 5).map((r) => r.Entity))}`
    );
  }
});

// The count the SERVER reported for the query, taken from the list response rather than from the
// grid - the grid only ever shows one page, so it cannot say how many rows an export should hold.
Then('the export should hold one row for every log the server reported', { timeout: 60000 }, async function () {
  const p = page(this);
  const e = notes(this).lastExport;
  const response = await this.page.evaluate(async (query) => {
    // Ask the same question the app just asked, through the app's own session.
    try {
      const r = await fetch(`/core/api/v1/analytics/admin/audit-logs/${query}`, { credentials: 'include' });
      if (!r.ok) return { status: r.status };
      return await r.json();
    } catch (err) {
      return { error: String(err) };
    }
  }, '?' + (p.lastRequestQuery() || 'page=1'));

  // The API is on a different origin and needs a bearer token, so a same-origin fetch will
  // usually fail. When it does, fall back to the count the export itself implies and say so -
  // this assertion is about the export not being truncated to one page, and the page size is
  // the number that matters.
  const size = p.requestedPageSize();
  const exported = e.parsed.rows.length;
  if (response && typeof response.count === 'number') {
    if (exported !== response.count) {
      throw new Error(`The server reported ${response.count} matching logs but the export holds ${exported} rows.`);
    }
    return;
  }
  await record(this, 'Server count unavailable', {
    reason: 'the API is cross-origin and needs a bearer token; falling back to the page-size check',
    requestedPageSize: size,
    exportedRows: exported,
  });
  if (size !== null && exported > 0 && exported < size && (await p.rowCount()) >= size) {
    throw new Error(
      `The grid is showing a full page of ${size} rows but the export holds only ${exported} - it looks truncated.`
    );
  }
});

Then(
  'the export should hold more rows than the grid was showing, unless they all fit on one page',
  async function () {
    const p = page(this);
    const n = notes(this);
    const exported = n.lastExport.parsed.rows.length;
    const onScreen = n.rowsAtExport.length;
    const size = p.requestedPageSize();
    await record(this, 'Export vs page', { exportedRows: exported, rowsOnScreen: onScreen, pageSize: size });
    // Only meaningful when the grid was FULL - a result set smaller than a page legitimately
    // exports the same number of rows as it shows.
    if (size !== null && onScreen >= size && exported <= onScreen) {
      throw new Error(
        `The grid was showing a full page (${onScreen} rows) but the export holds only ${exported} - `
        + 'the export appears to be limited to the current page rather than the whole result set.'
      );
    }
  }
);

Then('the export should hold no data rows', async function () {
  const e = notes(this).lastExport;
  if (e.parsed.rows.length !== 0) {
    throw new Error(`The export of an empty result set holds ${e.parsed.rows.length} data rows.`);
  }
  if (!e.parsed.header.length) {
    throw new Error('The export of an empty result set has no header row either - it is not a usable file.');
  }
});

Then('the exported rows should match the rows the grid was showing', async function () {
  const n = notes(this);
  const exported = asObjects(n.lastExport.parsed);
  const problems = [];
  // Compare the grid's page against the FIRST page of the export, on the fields both carry and
  // agree about. Date & Time is deliberately excluded - the two disagree by the UTC offset, which
  // is recorded as its own finding rather than failed on here.
  n.rowsAtExport.forEach((row, i) => {
    const e = exported[i];
    if (!e) {
      problems.push(`grid row ${i + 1} has no matching export row`);
      return;
    }
    if (String(e['Action Type'] || '').trim() !== row.actionType) {
      problems.push(`row ${i + 1}: action type is "${row.actionType}" on screen and "${e['Action Type']}" in the export`);
    }
    if (String(e.Entity || '').trim() !== row.entity) {
      problems.push(`row ${i + 1}: entity is "${row.entity}" on screen and "${e.Entity}" in the export`);
    }
    if (String(e['IP Address'] || '').trim() !== row.ipAddress) {
      problems.push(`row ${i + 1}: IP is "${row.ipAddress}" on screen and "${e['IP Address']}" in the export`);
    }
  });
  reportAll(problems.slice(0, 10), 'The export does not describe the rows the grid was showing:');
});

// ---------------------------------------------------------------- View log

When('I note the first Audit Logs row', async function () {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('No Audit Logs rows are displayed.');
  notes(this).notedRow = rows[0];
  await record(this, 'Noted row', rows[0]);
});

When('I open the Log Details dialog for that row', { timeout: 60000 }, async function () {
  notes(this).viewBaseline = page(this).requestCount();
  notes(this).urlBeforeView = this.page.url();
  await page(this).openLogDetails(0);
});

When('I open the Log Details dialog for the first Audit Logs row', { timeout: 60000 }, async function () {
  const rows = await page(this).readRows();
  notes(this).notedRow = rows[0];
  notes(this).viewBaseline = page(this).requestCount();
  notes(this).urlBeforeView = this.page.url();
  await page(this).openLogDetails(0);
});

Then('the Log Details dialog should be titled {string}', async function (title) {
  const d = await page(this).readLogDetails();
  if (!String(d.title || '').trim().includes(title)) {
    throw new Error(`The dialog is titled "${d.title}", expected "${title}".`);
  }
});

// >>> COMPARED AGAINST THE ROW THAT WAS CLICKED, not merely "some log". A dialog that always
// showed the first row's details would render perfectly and be completely wrong, and that is
// invisible unless the two are compared. The document-verification module was caught by exactly
// this - openDocument() always opened the first card.
Then('the Log Details dialog should describe that same row', async function () {
  const n = notes(this);
  const d = await page(this).readLogDetails();
  await record(this, 'Log Details fields', d);
  const row = n.notedRow;
  const problems = [];
  const f = d.fields || {};
  if (f['Action Type'] !== row.actionType) {
    problems.push(`Action Type is "${f['Action Type']}" in the dialog and "${row.actionType}" on the row`);
  }
  if (f['Entity Type'] !== row.entity) {
    problems.push(`Entity Type is "${f['Entity Type']}" in the dialog and "${row.entity}" on the row`);
  }
  if (row.entityName && f['Entity Name'] !== row.entityName) {
    problems.push(`Entity Name is "${f['Entity Name']}" in the dialog and "${row.entityName}" on the row`);
  }
  if (f['Action By'] !== row.actionBy) {
    problems.push(`Action By is "${f['Action By']}" in the dialog and "${row.actionBy}" on the row`);
  }
  reportAll(problems, 'The Log Details dialog does not describe the row it was opened from:');
});

Then('the Log Details dialog should show these fields:', async function (table) {
  const want = table.raw().map((r) => r[0].trim());
  const d = await page(this).readLogDetails();
  const got = Object.keys(d.fields || {});
  const missing = want.filter((w) => !got.includes(w));
  if (missing.length) {
    throw new Error(`The dialog is missing ${JSON.stringify(missing)}. It shows: ${JSON.stringify(got)}`);
  }
  // The dialog omits Endpoint, IP Address and Location, which the grid shows. Recorded rather
  // than failed on - no AC says the dialog must carry every column.
  const omitted = ['Endpoint', 'IP Address', 'Location'].filter((c) => !got.includes(c));
  if (omitted.length) {
    await record(
      this,
      'RECORDED (question for the PO)',
      `The Log Details dialog omits ${JSON.stringify(omitted)}, which the grid shows on every row. `
      + 'For an audit record the origin of the action (IP and location) is arguably the part a '
      + 'reviewer most needs in the detail view.'
    );
  }
});

// The Event Details section renders its own label/value pairs (e.g. "Verification Email Sent to"
// / "iq***@bytecorp.io") - there is no "Details" label - so its text is compared, punctuation
// aside, with the row's Event Details cell ("Verification Email Sent to: iq***@bytecorp.io").
Then('the Log Details dialog should show the event details', async function () {
  const n = notes(this);
  const d = await page(this).readLogDetails();
  if (!(d.sections || []).some((s) => /Event Details/i.test(s))) {
    throw new Error(`The dialog has no "Event Details" section. Sections: ${JSON.stringify(d.sections)}`);
  }
  const details = await page(this).logDetailsDialog.evaluate((dlg) => {
    const p = [...dlg.querySelectorAll('p')].find((x) => /^Event Details$/i.test(x.innerText.trim()));
    const host = p && p.parentElement;
    return host ? host.innerText.replace(/^\s*Event Details\s*/i, '') : '';
  });
  const norm = (t) => String(t || '').replace(/[:\s]+/g, ' ').trim();
  if (!norm(details)) throw new Error('The Event Details section is empty.');
  if (n.notedRow && n.notedRow.eventDetails && norm(details) !== norm(n.notedRow.eventDetails)) {
    throw new Error(
      `The dialog's event details read "${norm(details)}" but the row reads "${norm(n.notedRow.eventDetails)}".`
    );
  }
});

Then('the Audit Logs URL should not have changed', async function () {
  const before = notes(this).urlBeforeView;
  const now = this.page.url();
  if (now !== before) throw new Error(`The URL changed from "${before}" to "${now}".`);
});

Then('no Audit Logs request should have been sent for opening the dialog', async function () {
  const sent = page(this).requestsSince(notes(this).viewBaseline);
  if (sent.length) {
    throw new Error(`Opening the dialog sent ${sent.length} list request(s): ${JSON.stringify(sent)}`);
  }
});

When('I close the Log Details dialog', async function () {
  await page(this).closeLogDetails();
});

Then('the Log Details dialog should no longer be displayed', async function () {
  if (await page(this).logDetailsDialog.isVisible().catch(() => false)) {
    throw new Error('The Log Details dialog is still displayed after being closed.');
  }
});

// Watches a WINDOW rather than sampling once: "not visible" is also true of a dialog the app has
// not rendered yet, so a single read on a settling page reports "no dialog" for one that appears
// a second later - and this step exists to prove none appears at all.
Then('no Log Details dialog should open on its own', { timeout: 30000 }, async function () {
  const ok = await page(this).dialogStaysClosed(5000);
  if (!ok) throw new Error('A Log Details dialog opened without any row action being clicked.');
});

// ---------------------------------------------------------------- pagination

When('I go to the next page of Audit Logs', { timeout: 60000 }, async function () {
  const p = page(this);
  notes(this).applyBaseline = p.requestCount();
  await p.goToNextPage();
});

Then('the first Audit Logs row should be different from the one I noted', async function () {
  const rows = await page(this).readRows();
  if (!rows.length) throw new Error('The next page rendered no rows.');
  const noted = notes(this).notedRow;
  const now = rows[0];
  if (now.dateTime === noted.dateTime && now.actionType === noted.actionType) {
    throw new Error(
      `Page 2 opens with the same row as page 1 (${now.dateTime} / ${now.actionType}) - the page did not change.`
    );
  }
});

// ---------------------------------------------------------------- recorded divergences

// The four measured differences between the grid and the export, re-measured every run.
//
// RECORDED, NOT FAILED ON. No AC settles any of them, so asserting a preference would make this
// scenario permanently red over questions for the PO. The value is that they are re-measured:
// a finding nobody re-checks goes stale, which is exactly what happened to the receipt PDF's
// dollar sign.
Then('the export and the grid should be compared field by field for that row', async function () {
  const n = notes(this);
  const row = n.notedRow;
  const exported = asObjects(n.lastExport.parsed)[0];
  if (!exported) throw new Error('The export holds no rows to compare against.');

  const diffs = [];
  const agree = [];
  const cmp = (label, screen, file) => {
    if (String(screen).trim() === String(file || '').trim()) agree.push(label);
    else diffs.push({ field: label, onScreen: screen, inExport: file });
  };
  cmp('Date & Time', row.dateTime, exported['Date & Time']);
  cmp('Action By', row.actionBy, exported['Action By']);
  cmp('Action By Email', row.actionByEmail, exported['Action By Email']);
  cmp('Action Type', row.actionType, exported['Action Type']);
  cmp('Entity', row.entity, exported.Entity);
  cmp('Entity Name', row.entityName, exported['Entity Name']);
  cmp('Endpoint', row.endpoint, exported.Endpoint);
  cmp('Event Details', row.eventDetails, exported['Event Details']);
  cmp('IP Address', row.ipAddress, exported['IP Address']);
  cmp('Location', row.location, exported.Location);

  n.gridVsExport = { agree, diffs, actorNameDuplicates: exported['Actor Name'] === exported['Action By'] };
  await record(this, 'Grid vs export, field by field', n.gridVsExport);
});

Then('any differences between the grid and the export should be reported', async function () {
  const d = notes(this).gridVsExport;
  const lines = [];

  const email = d.diffs.find((x) => x.field === 'Action By Email');
  if (email) {
    lines.push(
      `EMAIL MASKING: the grid shows "${email.onScreen}" and the export shows "${email.inExport}". `
      + 'The export is MORE redacted than the screen. Which is correct is a data-protection '
      + 'decision - ask the PO.'
    );
  }
  const when = d.diffs.find((x) => x.field === 'Date & Time');
  if (when) {
    lines.push(
      `TIMEZONE: the grid shows "${when.onScreen}" and the export shows "${when.inExport}" for the `
      + 'same event. Neither surface carries a timezone label, so a reader cannot tell which is '
      + 'local and which is UTC.'
    );
  }
  if (d.actorNameDuplicates) {
    lines.push('DUPLICATE COLUMN: the export\'s "Actor Name" repeats "Action By" exactly.');
  }
  const other = d.diffs.filter((x) => !['Action By Email', 'Date & Time'].includes(x.field));
  if (other.length) lines.push(`OTHER DIFFERENCES: ${JSON.stringify(other)}`);
  if (!lines.length) lines.push('No differences - the grid and the export agree on every compared field.');

  await record(this, 'RECORDED (questions for the PO)', lines.join('\n\n'));
});

// A react-aria grid with a ROVING tabindex: the row is one Tab stop and its cells are reached with
// the arrow keys, so tabindex="-1" on a cell button is correct, not a defect (measured 2026-10-23:
// Tab, Tab, Tab lands on row 1; ArrowRight then focuses actor, email, entity, entity name and
// View log in turn). So the audit drives that model and checks every button actually takes focus.
Then('every interactive Audit Logs row control should be reachable by keyboard', { timeout: 60000 }, async function () {
  const labels = await this.page.evaluate(() => {
    const row = document.querySelector('[role="row"]:has([role="rowheader"])');
    return row ? [...row.querySelectorAll('button')].map((b) => (b.innerText || '').trim() || b.getAttribute('aria-label') || '(unnamed)') : null;
  });
  if (!labels || !labels.length) throw new Error('No Audit Logs row was available to audit.');
  const active = () => this.page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a.tagName, role: a.getAttribute('role'), label: (a.innerText || '').trim() || a.getAttribute('aria-label') || '' };
  });
  await this.page.locator('main input').first().focus();
  let onRow = false;
  for (let i = 0; i < 10 && !onRow; i++) {
    await this.page.keyboard.press('Tab');
    const a = await active();
    onRow = a.role === 'row';
  }
  if (!onRow) throw new Error('Tab never reached the first Audit Logs row.');
  const focused = [];
  for (let i = 0; i < 14; i++) {
    await this.page.keyboard.press('ArrowRight');
    const a = await active();
    if (a.tag === 'BUTTON') focused.push(a.label);
  }
  await record(this, 'Row controls focused with the arrow keys', { buttons: labels, focused });
  const missed = labels.filter((l) => !focused.includes(l));
  if (missed.length) {
    throw new Error(`These Audit Logs row controls never took keyboard focus: ${JSON.stringify(missed)}`);
  }
});

// =============================================================================================
// COVERAGE PASS 2026-11-03 - values against the server, paging, URL values, failures, row
// buttons, dialog dismissal, sidebar. Every behaviour below was measured live first (read-only).
// =============================================================================================

const LIST_RE = /\/analytics\/admin\/audit-logs\/\?/;
const isDash = (v) => /^[-—–]?$/.test(String(v == null ? '' : v).trim());
const flat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Waits for a listing response caused by `action`, then for the grid to render it.
async function withList(world, action, timeout = 30000) {
  const p = page(world);
  const wait = world.page.waitForResponse((r) => LIST_RE.test(r.url()) && r.request().method() === 'GET' && !/export=/.test(r.url()), { timeout }).catch(() => null);
  notes(world).applyBaseline = p.requestCount();
  await action();
  const res = await wait;
  if (res) { await res.finished().catch(() => {}); await world.page.waitForTimeout(150); }
  await p.settleRows(20000);
  await world.page.waitForTimeout(400);
  return res;
}

const pageParam = (world) => new URL(world.page.url()).searchParams.get('page');
const lastRequestedPage = (world) => {
  // The page object keeps the query with its leading "?".
  const q = (page(world).lastRequestQuery() || '').replace(/^\?/, '');
  const m = q.match(/(?:^|&)page=([^&]*)/);
  return m ? m[1] : null;
};

// The server sends UTC; the grid shows the browser's local time as DD-MM-YYYY HH:mm:ss.
// Formatted INSIDE the browser, so the expectation uses the same timezone the app does.
async function localStamps(world, isoList) {
  return world.page.evaluate((isos) => isos.map((iso) => {
    const d = new Date(iso);
    const z = (n) => String(n).padStart(2, '0');
    return `${z(d.getDate())}-${z(d.getMonth() + 1)}-${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }), isoList);
}

// Event Details: the server sends "key: value" pairs with raw keys (email_sent_to, code,
// expiry_date); the grid shows human labels ("Email Sent to", "Promo Code", "Expiry Date"),
// Title-Cases the values and draws "->" as an arrow. So the VALUES are compared, case-insensitively,
// segment by segment; the key wording is presentation.
const normDetails = (s) => flat(s).replace(/->/g, '→').toLowerCase()
  .split(/[;,]\s+(?=[^:;,]+:)/)
  .map((seg) => (seg.includes(':') ? seg.slice(seg.indexOf(':') + 1) : seg).trim())
  .join(' | ');

async function compareRowsWithServer(world, label) {
  const p = page(world);
  const payload = p.lastPayload;
  if (!payload || !Array.isArray(payload.results)) return [`${label}: no listing response was captured`];
  const rows = await p.readRows();
  const res = payload.results;
  const problems = [];
  if (rows.length !== res.length) problems.push(`${label}: the grid shows ${rows.length} rows, the server sent ${res.length}`);
  const stamps = await localStamps(world, res.map((r) => r.created_at));
  res.forEach((r, i) => {
    const g = rows[i];
    if (!g) return;
    const at = `${label} row ${i + 1} (log ${r.id})`;
    const want = {
      dateTime: stamps[i],
      actionBy: r.actor_name,
      actionByEmail: r.actor_email,
      actionType: r.action_type_label,
      entity: r.entity,
      entityName: r.entity_name,
      endpoint: r.endpoint,
      ipAddress: r.ip_address,
      location: r.location,
    };
    for (const [k, v] of Object.entries(want)) {
      const got = flat(g[k]);
      if (isDash(v)) { if (!isDash(got)) problems.push(`${at}: ${k} is empty on the server but the grid shows "${got}"`); continue; }
      if (got !== flat(v)) problems.push(`${at}: ${k} reads "${got}", the server sent "${flat(v)}"`);
    }
    const detailsOk = isDash(r.event_details) ? isDash(g.eventDetails) : normDetails(g.eventDetails) === normDetails(r.event_details);
    if (!detailsOk) problems.push(`${at}: Event Details reads "${flat(g.eventDetails)}", the server sent "${flat(r.event_details)}"`);
  });
  return problems;
}

When('I open the Audit Logs page at {string}', { timeout: 90000 }, async function (query) {
  await withList(this, () => this.page.goto(`${page(this).url}${query}`, { waitUntil: 'domcontentloaded' }), 45000);
});

Then('every Audit Logs row should match the server on each of these pages:', { timeout: 300000 }, async function (table) {
  const problems = [];
  const seen = [];
  for (const { page: which } of table.hashes()) {
    let n = which;
    if (which === 'last') {
      const size = page(this).requestedPageSize() || 9;
      n = String(Math.ceil(page(this).lastServerCount / size));
    }
    await withList(this, () => this.page.goto(`${page(this).url}${n === '1' ? '' : `?page=${n}`}`, { waitUntil: 'domcontentloaded' }), 45000);
    if (lastRequestedPage(this) !== n) problems.push(`page ${which}: the app asked for page ${lastRequestedPage(this)}`);
    problems.push(...await compareRowsWithServer(this, `page ${which} (${n})`));
    seen.push(`page ${which} = ${n}: ${((page(this).lastPayload || {}).results || []).length} logs`);
  }
  await record(this, 'Pages compared with the server', seen.join('\n'));
  reportAll(problems, 'The Audit Logs grid does not show what the server sent:');
});

Then('the Audit Logs pager should page with Previous, numbered pages and Next', { timeout: 180000 }, async function () {
  const p = page(this);
  const tid = (t) => this.page.locator(`[data-testid="${t}"]:visible`).first();
  const problems = [];
  const size = p.requestedPageSize() || 9;
  const total = p.lastServerCount;
  const last = Math.ceil(total / size);
  if (!(await tid('pagination-previous-button').isDisabled())) problems.push('Previous is enabled on page 1');
  if (!(await tid(`pagination-page-${last}-button`).isVisible())) problems.push(`the pager does not offer the last page (${last})`);

  await withList(this, () => tid('pagination-page-2-button').click());
  if (lastRequestedPage(this) !== '2') problems.push(`numbered page 2 asked for page ${lastRequestedPage(this)}`);
  if (pageParam(this) !== '2') problems.push(`numbered page 2 left the URL at page=${pageParam(this)}`);

  await withList(this, () => tid('pagination-previous-button').click());
  if (lastRequestedPage(this) !== '1') problems.push(`Previous from page 2 asked for page ${lastRequestedPage(this)}`);
  if (![null, '1'].includes(pageParam(this))) problems.push(`Previous from page 2 left the URL at page=${pageParam(this)}`);

  await withList(this, () => tid(`pagination-page-${last}-button`).click());
  if (lastRequestedPage(this) !== String(last)) problems.push(`the last page button asked for page ${lastRequestedPage(this)}`);
  const want = p.lastServerCount - (last - 1) * size;
  const rows = await p.rowCount();
  if (rows !== want) problems.push(`the last page shows ${rows} rows, the server's count leaves ${want}`);
  if (!(await tid('pagination-next-button').isDisabled())) problems.push('Next is enabled on the last page');
  if (await tid('pagination-previous-button').isDisabled()) problems.push('Previous is disabled on the last page');
  await record(this, 'Pager', { total, size, last, lastPageRows: rows });
  reportAll(problems, 'The Audit Logs pager did not page as expected:');
});

Then('reloading the Audit Logs page should keep page {string} and its rows', { timeout: 90000 }, async function (n) {
  const key = (r) => `${r.dateTime}|${r.actionType}|${r.entityName}`;
  const before = (await page(this).readRows()).map(key);
  await withList(this, () => this.page.reload({ waitUntil: 'domcontentloaded' }), 45000);
  const after = (await page(this).readRows()).map(key);
  const problems = [];
  if (lastRequestedPage(this) !== n) problems.push(`the reload asked for page ${lastRequestedPage(this)}`);
  if (pageParam(this) !== n) problems.push(`the reload left the URL at page=${pageParam(this)}`);
  // A log written between the two reads shifts the page by one; anything more is a real change.
  const shared = after.filter((r) => before.includes(r)).length;
  if (shared < before.length - 1) problems.push(`only ${shared} of ${before.length} rows are still on page ${n} after the reload`);
  reportAll(problems, 'A reload did not keep the Audit Logs page:');
});

Then('each of these Audit Logs page values should fall back to the first page:', { timeout: 240000 }, async function (table) {
  const problems = [];
  for (const { value } of table.hashes()) {
    await withList(this, () => this.page.goto(`${page(this).url}?page=${encodeURIComponent(value)}`, { waitUntil: 'domcontentloaded' }), 45000);
    if (lastRequestedPage(this) !== '1') problems.push(`?page=${value}: the app asked for page ${lastRequestedPage(this)}`);
    if (pageParam(this) !== null) problems.push(`?page=${value}: the URL still carries page=${pageParam(this)}`);
    if (!(await page(this).rowCount())) problems.push(`?page=${value}: no rows were listed`);
  }
  reportAll(problems, 'An unusable page number did not fall back to page 1:');
});

Then('each of these Audit Logs page values should show the "404 Page not found" page:', { timeout: 240000 }, async function (table) {
  const problems = [];
  const size = page(this).requestedPageSize() || 9;
  const last = Math.ceil(page(this).lastServerCount / size);
  for (const { value } of table.hashes()) {
    const v = value === 'past the last page' ? String(last + 50) : value;
    await this.page.goto(`${page(this).url}?page=${v}`, { waitUntil: 'domcontentloaded' });
    let text = '';
    for (let i = 0; i < 30 && !/page not found/i.test(text); i++) {
      await this.page.waitForTimeout(500);
      text = flat(await this.page.locator('body').innerText().catch(() => ''));
    }
    if (!/404\s*Page not found/i.test(text)) problems.push(`?page=${v}: no "404 Page not found" - the page read "${text.slice(0, 140)}"`);
  }
  reportAll(problems, 'A page number with no logs was not reported as "Page not found":');
});

Then('each of these Audit Logs filter URL values should be ignored and removed from the URL:', { timeout: 240000 }, async function (table) {
  const problems = [];
  for (const { query, parameter } of table.hashes()) {
    await withList(this, () => this.page.goto(`${page(this).url}${query}`, { waitUntil: 'domcontentloaded' }), 45000);
    const sent = page(this).lastRequestQuery() || '';
    if (new RegExp(`(^|&)${parameter}=`).test(sent)) problems.push(`${query}: the request still carried ${parameter} (${sent})`);
    if (new URL(this.page.url()).searchParams.has(parameter)) problems.push(`${query}: the URL kept ${parameter}`);
    const badge = await page(this).appliedFilterCount();
    if (badge) problems.push(`${query}: the Filters button counts ${badge} applied filter(s)`);
  }
  reportAll(problems, 'An unrecognised filter value in the URL was not handled cleanly:');
});

Then('each of these Audit Logs load failures should say {string} rather than show an empty listing:', { timeout: 240000 }, async function (message, table) {
  const problems = [];
  for (const { failure } of table.hashes()) {
    const handler = failure === 'network error'
      ? (r) => r.abort('internetdisconnected')
      : (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed failure"}' });
    await this.page.route(LIST_RE, handler);
    try {
      await this.page.goto(page(this).url, { waitUntil: 'domcontentloaded' });
      let text = '';
      for (let i = 0; i < 30 && !text.includes(message); i++) {
        await this.page.waitForTimeout(500);
        text = flat(await this.page.locator('main').innerText().catch(() => ''));
      }
      if (!text.includes(message)) problems.push(`${failure}: no "${message}" - the page read "${text.slice(0, 160)}"`);
      if (/No results found/i.test(text)) problems.push(`${failure}: the failure is presented as "No results found"`);
      if (await page(this).rowCount()) problems.push(`${failure}: rows are still listed`);
    } finally {
      await this.page.unroute(LIST_RE);
    }
  }
  reportAll(problems, 'A failed Audit Logs load was not reported as a failure:');
});

Then("clicking the first Audit Logs row's name, email, entity and entity name should open nothing and send nothing", { timeout: 90000 }, async function () {
  const p = page(this);
  const buttons = p.rows.first().locator('button:not([aria-label="View log"]):not([data-testid="admin-audit-logs-view-button"])');
  const n = await buttons.count();
  expect(n, 'the first row offers no name/email/entity buttons').to.be.greaterThan(0);
  const problems = [];
  const url = this.page.url();
  const labels = [];
  for (let i = 0; i < n; i++) {
    const label = flat(await buttons.nth(i).innerText());
    labels.push(label);
    const before = p.requestCount();
    const popup = this.page.context().waitForEvent('page', { timeout: 1500 }).then(() => true).catch(() => false);
    await buttons.nth(i).click({ force: true });
    await this.page.waitForTimeout(1500);
    if (this.page.url() !== url) { problems.push(`"${label}" navigated to ${this.page.url()}`); await this.page.goBack(); }
    if (await popup) problems.push(`"${label}" opened a new tab`);
    if (await this.page.getByRole('dialog').count()) { problems.push(`"${label}" opened a dialog`); await this.page.keyboard.press('Escape'); }
    if (p.requestCount() !== before) problems.push(`"${label}" sent a request`);
  }
  await record(this, 'Row text buttons clicked', labels.join(' | '));
  reportAll(problems, 'A text button in an Audit Logs row did something:');
});

Then('the Log Details dialog should close by each of these routes and leave the listing untouched:', { timeout: 180000 }, async function (table) {
  const p = page(this);
  const problems = [];
  const key = async () => (await p.readRows()).map((r) => r.dateTime + r.actionType).join('|');
  const rowsBefore = await key();
  for (const { route } of table.hashes()) {
    await p.openLogDetails(0);
    const before = p.requestCount();
    if (/escape/i.test(route)) await this.page.keyboard.press('Escape');
    else if (/outside/i.test(route)) await this.page.mouse.click(5, 5);
    else {
      await p.logDetailsDialog.locator('[data-testid="admin-audit-logs-details-close-button"]')
        .or(p.logDetailsDialog.getByRole('button', { name: /^close$/i })).first().click();
    }
    const closed = await p.logDetailsDialog.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);
    if (!closed) { problems.push(`${route} did not close the Log Details dialog`); await this.page.keyboard.press('Escape'); }
    if (p.requestCount() !== before) problems.push(`${route} sent a listing request`);
  }
  if ((await key()) !== rowsBefore) problems.push('the listing changed while the dialog was opened and closed');
  reportAll(problems, 'The Log Details dialog did not close cleanly:');
});

When('I open Audit Logs from the sidebar while on the Community page', { timeout: 90000 }, async function () {
  await this.page.goto(`${page(this).origin}/community`, { waitUntil: 'domcontentloaded' });
  await this.page.locator('[data-testid="admin-nav-community-link"]').waitFor({ timeout: 30000 });
  await withList(this, () => this.page.locator('[data-testid="admin-nav-audit-logs-link"]')
    .or(this.page.getByRole('link', { name: /^Audit Logs$/i })).first().click(), 45000);
});

Then('the Audit Logs listing should open on its first page', async function () {
  const problems = [];
  if (!/\/audit-logs/.test(this.page.url())) problems.push(`landed on ${this.page.url()}`);
  if (lastRequestedPage(this) !== '1') problems.push(`the listing asked for page ${lastRequestedPage(this)}`);
  if (!(await page(this).rowCount())) problems.push('no logs are listed');
  reportAll(problems, 'The sidebar did not open the Audit Logs listing on its first page:');
});
