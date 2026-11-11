// Steps for features/Agent_Portal/verifications.feature - the Agent Portal's document review
// queue at /verifications, as a PAGE.
//
// >>> NOTHING IN THIS FILE COMMITS A DECISION. <<<
// Approve and Request Revision are irreversible and nothing in the product undoes either. Every
// decision dialog opened here is CANCELLED, and the only committing method on the page object
// (`submitDecision`) is never called from this file. The end-to-end commit lives in
// steps/document-verification.js, which already owns upload -> AI -> decision.
//
// >>> EVERY PHRASE IS WORDED "... Verifications ..." / "... the queue ..." / "... the review
//     panel ...", AND THAT IS DELIBERATE. <<<
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
// fails generation on it instead). steps/document-verification.js already owns a queue vocabulary
// ("the agent opens the verification queue", "the queue should list no documents", "the queue
// should show an empty state") and every one of those steps drives a document IT uploaded, so
// they could not be reused here even if the wording were free.
//
// Exactly ONE phrase is reused, and only because it is genuinely page-agnostic:
//   Given I am logged in as an agent   (steps/active-candidate.js, via utils/resilientSignIn.js)
//
// >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT { timeout }. <<<
// features/support/hooks.js calls setDefaultTimeout(60000) and THAT OVERRIDES THE PROFILE'S OWN
// `timeout` - this profile asks for 300000 and gets 60000. A step that opens three documents, or
// applies three filters each costing a round trip, is many times a normal step's work, so without
// a budget of its own it is killed part way and reports "function timed out" - which says nothing
// about the app and hides however many rows had already passed. This trap has now bitten seven
// areas in this repo.
const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('chai');
const AgentVerificationsPage = require('../pages/AgentVerificationsPage');

const UI = 90000;
const SLOW = 180000;
const TABLE = 300000;

const page = (w) => w.pages.agentVerifications;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const documentNameContainsTokens = (documentName, value) => {
  const tokens = clean(value).toLowerCase().split(/\s+/).filter(Boolean);
  const normalizedName = clean(documentName).toLowerCase().replace(/[_\-.]+/g, ' ');
  return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
};

// Scenario-local notes, kept off the World's own keys so nothing here can collide with another
// feature's state.
const notes = (w) => {
  w._verif = w._verif || {};
  return w._verif;
};

// The app's own date format is not this file's business, so nothing compares a rendered date to a
// constructed one. Only presence and equality-with-the-row are asserted.

// ============================================================================================
// Background
// ============================================================================================

Given('I am on the Verifications page', { timeout: UI }, async function () {
  await page(this).openWith({ activeFilter: 'ALL' });
  notes(this).openedAt = Date.now();
});

// ============================================================================================
// 1. The page's contract
// ============================================================================================

Then('the Verifications page should be headed {string}', { timeout: UI }, async function (heading) {
  const v = page(this);
  await expect(v.pageHeading).to.be.ok;
  const text = clean(await v.pageHeading.innerText());
  expect(text, `the page heading reads "${text}"`).to.equal(heading);
});

Then(
  'the Verifications page should offer a search box, a status tab strip and a Filters button',
  { timeout: UI },
  async function () {
    const v = page(this);
    const problems = [];
    if (!(await v.searchBox.isVisible().catch(() => false))) problems.push('no search box');
    if (!(await v.tabStrip.isVisible().catch(() => false))) problems.push('no status tab strip (role=radiogroup)');
    if (!(await v.filtersButton.isVisible().catch(() => false))) problems.push('no Filters button');
    await this.attach(
      `search placeholder: ${JSON.stringify(await v.searchPlaceholder())}\n` +
        `tabs: ${JSON.stringify((await v.readTabs()).map((t) => t.label))}\n` +
        `filters badge: ${JSON.stringify(await v.filtersBadge())}`,
      'text/plain'
    );
    expect(problems, problems.join('; ')).to.deep.equal([]);
  }
);

Then('the verification queue should be displayed', { timeout: UI }, async function () {
  const v = page(this);
  expect(await v.table.isVisible(), 'the queue grid is not displayed').to.equal(true);
  const rows = await v.rows.count();
  await this.attach(`rows rendered: ${rows}; server count: ${await v.lastListCount()}`, 'text/plain');
  expect(rows, 'the queue rendered no rows at all').to.be.greaterThan(0);
});

// EXACTLY and IN ORDER. An extra column silently shifts every cell index the row readers depend
// on, so a tolerant check would let every later cell assertion read the wrong column.
Then('the verification queue should list exactly these columns in order:', { timeout: UI }, async function (table) {
  const want = table.raw().map((r) => clean(r[0]));
  const got = await page(this)
    .page.locator('[role="columnheader"]')
    .evaluateAll((es) => es.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  await this.attach(`columns rendered: ${JSON.stringify(got)}`, 'text/plain');
  expect(got, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`).to.deep.equal(want);
});

Then('every row should offer exactly the actions {string}', { timeout: SLOW }, async function (csv) {
  const want = csv.split(',').map((s) => s.trim());
  const v = page(this);
  const n = await v.rows.count();
  expect(n, 'there are no rows to inspect').to.be.greaterThan(0);
  const problems = [];
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    const actions = await v.rows
      .nth(i)
      .locator('td')
      .last()
      .locator('button')
      .evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()));
    if (JSON.stringify(actions) !== JSON.stringify(want)) {
      problems.push(`row ${i} offers ${JSON.stringify(actions)}`);
    }
  }
  await this.attach(`inspected ${n} rows; expected ${JSON.stringify(want)} on each`, 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the status tabs should be a radio group offering exactly {string}', { timeout: UI }, async function (csv) {
  const want = csv.split(',').map((s) => s.trim());
  const v = page(this);
  // Asserted as an absence too: a reader built on role=tab finds nothing here.
  const tabRoles = await v.page.locator('[role="tab"]').count();
  const tabs = await v.readTabs();
  await this.attach(
    `elements with role="tab": ${tabRoles} (expected 0 - this strip is a radiogroup)\n` +
      `tabs: ${JSON.stringify(tabs)}`,
    'text/plain'
  );
  expect(tabRoles, 'this strip is a radiogroup; role="tab" appearing means the markup changed').to.equal(0);
  expect(tabs.map((t) => t.label)).to.deep.equal(want);
});

Then('exactly one status tab should be selected', { timeout: UI }, async function () {
  const sel = await page(this).selectedTab();
  await this.attach(JSON.stringify(sel), 'text/plain');
  expect(sel.count, `selected: ${JSON.stringify(sel.selected)}`).to.equal(1);
});

// The rule the whole file's safety rests on.
Then('no row should offer a control that approves or requests a revision', { timeout: SLOW }, async function () {
  const v = page(this);
  const found = await v.page.evaluate(() => {
    const body = document.querySelector('tbody');
    if (!body) return ['no tbody'];
    return [...body.querySelectorAll('button')]
      .map((b) => ((b.getAttribute('aria-label') || b.innerText || '') + '|' + (b.getAttribute('data-testid') || '')).trim())
      .filter((s) => /approve|revision/i.test(s));
  });
  await this.attach(
    found.length
      ? `DECISION CONTROLS FOUND IN THE LISTING: ${JSON.stringify(found)}`
      : 'no approve/revision control anywhere in the listing rows - the listing is read-only',
    'text/plain'
  );
  expect(
    found,
    'a decision control was found on a listing ROW. Approving or requesting a revision is ' +
      'irreversible, and this file is in the default run precisely because the listing cannot do ' +
      'either. If this is intended, the whole feature has to be re-audited for what a routine run ' +
      'can now spend.'
  ).to.deep.equal([]);
});

// ============================================================================================
// 2. The status tabs
// ============================================================================================

const TAB_STATUS = {
  All: 'ALL',
  'Needs Review': 'AWAITING', // the tab and the pill both read this (re-measured 2026-10-05)
  Approved: 'APPROVED',
  'Revision Required': 'REVISION',
};

When('I choose the {string} status tab', { timeout: UI }, async function (label) {
  const status = TAB_STATUS[label];
  expect(status, `"${label}" is not a tab this page offers (${Object.keys(TAB_STATUS).join(', ')})`).to.exist;
  notes(this).requestBaseline = page(this).requestCount();
  await page(this).chooseTab(status);
  notes(this).tab = label;
});

// Deliberately its own phrase: re-choosing the applied tab correctly fires NO request, so it must
// NOT settle (a settle would wait out its whole budget and report a working control as broken).
When('I choose the {string} status tab again', { timeout: UI }, async function (label) {
  const v = page(this);
  notes(this).requestBaseline = v.requestCount();
  await v.chooseTab(TAB_STATUS[label], { settle: false });
  await v.page.waitForTimeout(2500);
});

Then(
  'each status tab should filter the queue and query the server for its own status:',
  { timeout: TABLE },
  async function (table) {
    const v = page(this);
    const problems = [];
    const trace = [];
    for (const row of table.hashes()) {
      const status = TAB_STATUS[row.tab];
      // eslint-disable-next-line no-await-in-loop
      await v.chooseTab(status);
      // eslint-disable-next-line no-await-in-loop
      const url = v.urlParams();
      // eslint-disable-next-line no-await-in-loop
      const api = await v.lastListParams();
      // eslint-disable-next-line no-await-in-loop
      const rendered = await v.readRows();
      const statuses = [...new Set(rendered.map((r) => r.status))];

      const [uk, uv] = row['url param'].split('=');
      const [ak, av] = row['api param'].split('=');

      if (!(url[uk] || []).includes(uv)) {
        problems.push(`${row.tab}: the URL should carry ${row['url param']} but holds ${JSON.stringify(url)}`);
      }
      if (!api) {
        problems.push(`${row.tab}: no queue request was captured at all`);
      } else if (!(api[ak] || []).includes(av)) {
        problems.push(`${row.tab}: the request should carry ${row['api param']} but carried ${JSON.stringify(api)}`);
      }
      if (!rendered.length) {
        problems.push(`${row.tab}: the tab rendered no rows, so the filtering could not be observed`);
      } else if (statuses.length !== 1 || statuses[0] !== row['rendered status']) {
        problems.push(
          `${row.tab}: expected every row to read "${row['rendered status']}", got ${JSON.stringify(statuses)}`
        );
      }
      trace.push(
        `${row.tab}: url=${JSON.stringify(url)} api=${JSON.stringify(api)} ` +
          `rows=${rendered.length} statuses=${JSON.stringify(statuses)}`
      );
    }
    await this.attach(trace.join('\n'), 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

Then('the last queue request should carry no status parameter', { timeout: UI }, async function () {
  const api = await page(this).lastListParams();
  await this.attach(`last queue request: ${JSON.stringify(api)}`, 'text/plain');
  expect(api, 'no queue request was captured at all').to.exist;
  expect(
    api.status,
    `the All tab sent status=${JSON.stringify(api.status)}. It is specified as "every status", ` +
      'which this API expresses by omitting the parameter.'
  ).to.equal(undefined);
});

Then('the queue should list documents of more than one status', { timeout: UI }, async function () {
  const rows = await page(this).readRows();
  const statuses = [...new Set(rows.map((r) => r.status))].filter(Boolean);
  await this.attach(`statuses on screen: ${JSON.stringify(statuses)} across ${rows.length} rows`, 'text/plain');
  expect(
    statuses.length,
    `every row on the All tab reads "${statuses[0]}". That is possible on a queue that genuinely ` +
      'holds one status, so re-check the account before reading this as a defect.'
  ).to.be.greaterThan(1);
});

// An ABSENCE, which is why the request log runs from before the first navigation.
Then('no further queue request should have been sent', { timeout: UI }, async function () {
  const v = page(this);
  const since = v.requestsSince(notes(this).requestBaseline || 0);
  await this.attach(
    since.length ? `requests sent after the baseline:\n${since.join('\n')}` : 'no queue request was sent - correct',
    'text/plain'
  );
  expect(since, `expected no queue request, got ${since.length}`).to.deep.equal([]);
});

When('I open the Verifications page filtered by the document type {string}', { timeout: UI }, async function (v) {
  await page(this).openWith({ activeFilter: 'ALL', documentType: v });
});

Then('the {string} status tab should be selected with the queue rendered', { timeout: UI }, async function (label) {
  const v = page(this);
  const sel = await v.selectedTab();
  const rows = await v.rows.count();
  const empty = await v.readEmptyState();
  await this.attach(
    `selected: ${JSON.stringify(sel.selected)}; rows: ${rows}; empty state: ${empty.present}; url: ${v.page.url()}`,
    'text/plain'
  );
  // Collected and thrown once: "no tab is selected" and "nothing was rendered" fail independently
  // and send a developer to different places, and the live defect on the candidate profile's twin
  // fails both. As consecutive Thens only the first would ever be reported.
  const problems = [];
  if (sel.count !== 1) problems.push(`${sel.count} tabs are selected (${JSON.stringify(sel.selected)})`);
  else if (sel.selected[0] !== label) problems.push(`the selected tab is "${sel.selected[0]}", not "${label}"`);
  if (!rows && !empty.present) problems.push('no rows and no empty state were rendered - the panel is blank');
  expect(problems, problems.join('; ')).to.deep.equal([]);
});

// >>> ONE COLLECTING STEP, NOT THREE SCENARIOS. <<< The three unusable tab values are independent
// cases of one rule, and they fail independently. As three scenarios Cucumber's
// abandon-at-first-failure meant a break in the unrecognised-value case said nothing about whether
// the empty and wrong-case cases still worked - and the recorded diagnosis ("the fallback exists
// and simply does not cover an unknown value") rested on a measurement nobody was taking. This
// walks every row, records what each one did, and reports them together.
//
// It asserts all THREE facts per row - how many tabs are selected, WHICH one, and whether anything
// rendered - because they fail independently and send a developer to different places: "the strip
// is there but nothing is chosen" and "nothing is shown at all" are different defects.
Then(
  'each of these tab values should fall back to the All tab with the queue rendered:',
  { timeout: TABLE },
  async function (table) {
    const v = page(this);
    const problems = [];
    const trace = [];
    for (const row of table.hashes()) {
      const supplied = row['tab value'] || '';
      // eslint-disable-next-line no-await-in-loop
      await v.openWith({ activeFilter: supplied }, { raw: true });
      // eslint-disable-next-line no-await-in-loop
      const sel = await v.selectedTab();
      // eslint-disable-next-line no-await-in-loop
      const rows = await v.rows.count();
      // eslint-disable-next-line no-await-in-loop
      const empty = await v.readEmptyState();
      const params = v.urlParams();
      const label = `${JSON.stringify(supplied)} (${row['why it matters']})`;

      trace.push(
        `${label}\n   selected=${JSON.stringify(sel.selected)} rows=${rows} ` +
          `emptyState=${empty.present} url=${JSON.stringify(params)}`
      );

      if (sel.count !== 1) {
        problems.push(`${label}: ${sel.count} tabs are selected (${JSON.stringify(sel.selected)})`);
      } else if (sel.selected[0] !== 'All') {
        problems.push(`${label}: the selected tab is "${sel.selected[0]}", expected "All"`);
      }
      if (!rows && !empty.present) {
        problems.push(`${label}: no rows and no empty state were rendered - the panel is blank`);
      }
      // The app rewrites the address bar to the value it actually applied, so the URL is the
      // second half of "it fell back" rather than a separate nicety.
      if (!(params.activeFilter || []).includes('all')) {
        problems.push(
          `${label}: the URL was left holding activeFilter=${JSON.stringify(params.activeFilter)} ` +
            'rather than being rewritten to all, so a reload would not reproduce what is on screen'
        );
      }
    }
    await this.attach(trace.join('\n'), 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

// ============================================================================================
// 3. The search
// ============================================================================================

When("I search the queue for the first listed document's name", { timeout: UI }, async function () {
  const v = page(this);
  const rows = await v.readRows();
  expect(rows.length, 'there are no rows to take a search term from').to.be.greaterThan(0);
  // A slice, not the whole name: the stored names carry a random suffix and a full-name search is
  // a weaker test of matching than a partial one.
  const term = rows[0].documentName.replace(/\.[a-z0-9]+$/i, '').slice(0, 12);
  notes(this).searchTerm = term;
  notes(this).searchSubject = rows[0].documentName;
  await v.searchFor(term);
  await this.attach(`subject: ${rows[0].documentName}\nterm: ${JSON.stringify(term)}`, 'text/plain');
});

When('I search the queue for {string}', { timeout: UI }, async function (term) {
  notes(this).searchTerm = term;
  await page(this).searchFor(term);
});

When('I clear the queue search', { timeout: UI }, async function () {
  await page(this).clearSearch();
  notes(this).searchTerm = null;
});

When('I note how many documents the server holds for this queue', { timeout: UI }, async function () {
  // The SERVER's own count, never the rendered row count: the render is capped at page_size, so
  // two result sets differing only past the first page look identical on screen.
  notes(this).baselineCount = await page(this).lastListCount();
  await this.attach(`server count before: ${notes(this).baselineCount}`, 'text/plain');
});

Then('the URL and the queue request should both carry the search term', { timeout: UI }, async function () {
  const v = page(this);
  const term = notes(this).searchTerm;
  const url = v.urlParams();
  const api = await v.lastListParams();
  await this.attach(`term=${JSON.stringify(term)}\nurl=${JSON.stringify(url)}\napi=${JSON.stringify(api)}`, 'text/plain');
  const problems = [];
  if (!(url.search || []).includes(term)) problems.push(`the URL carries search=${JSON.stringify(url.search)}`);
  if (!api) problems.push('no queue request was captured');
  else if (!(api.search || []).includes(term)) problems.push(`the request carried search=${JSON.stringify(api.search)}`);
  expect(problems, problems.join('; ')).to.deep.equal([]);
});

Then('every listed document name should contain the search term', { timeout: UI }, async function () {
  const rows = await page(this).readRows();
  const term = String(notes(this).searchTerm || '');
  // >>> REFUSES TO PASS ON AN EMPTY LIST. <<< A step that goes green having inspected nothing
  // retires the assertion silently - the same rule as "non-paid billing rows should have disabled
  // receipt actions", which used to log "nothing to assert" and pass.
  expect(
    rows.length,
    `no rows are listed, so "every listed document matches ${JSON.stringify(term)}" would pass ` +
      'having inspected nothing. Pick a term this queue still holds.'
  ).to.be.greaterThan(0);
  const bad = rows.filter((r) => !r.documentName.toLowerCase().includes(term.toLowerCase()));
  await this.attach(`term=${JSON.stringify(term)}; ${rows.length} rows; ${bad.length} not matching`, 'text/plain');
  expect(bad.map((b) => b.documentName), 'rows not containing the term').to.deep.equal([]);
});

Then('the queue search should behave as follows:', { timeout: TABLE }, async function (table) {
  const v = page(this);
  const rows = await v.readRows();
  expect(rows.length, 'there are no rows to derive a search term from').to.be.greaterThan(0);
  const stem = rows[0].documentName.replace(/\.[a-z0-9]+$/i, '');
  const subject = rows[0].documentName;

  const termFor = {
    'the exact name': stem.slice(0, 14),
    'the name in UPPER CASE': stem.slice(0, 14).toUpperCase(),
    'the name in lower case': stem.slice(0, 14).toLowerCase(),
    'a slice from the middle': stem.slice(3, 11),
  };

  const problems = [];
  const trace = [];
  for (const row of table.hashes()) {
    const term = termFor[row.variation];
    if (term === undefined) { problems.push(`unknown variation "${row.variation}"`); continue; }
    // eslint-disable-next-line no-await-in-loop
    await v.searchFor(term);
    // eslint-disable-next-line no-await-in-loop
    const got = await v.readRows();
    const hit = got.some((r) => r.documentName === subject);
    trace.push(`${row.variation}: term=${JSON.stringify(term)} rows=${got.length} subjectListed=${hit}`);
    if (row.expectation === 'matches the row' && !hit) {
      problems.push(`${row.variation} (${JSON.stringify(term)}) did not return ${subject} - ${got.length} rows came back`);
    }
  }
  await this.attach(`subject: ${subject}\n${trace.join('\n')}`, 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// Compares the placeholder against the BEHAVIOUR rather than pinning either. Pinning the wording
// would go red the day the copy is reworded for any other reason; pinning only the behaviour would
// say nothing about what the user was told. It goes green whichever way the product settles it.
Then('the queue search placeholder should agree with what the search matches', { timeout: SLOW }, async function () {
  const v = page(this);
  const placeholder = await v.searchPlaceholder();
  const rows = await v.readRows();
  expect(rows.length, 'there are no rows to derive subjects from').to.be.greaterThan(0);

  const byName = rows[0].documentName.replace(/\.[a-z0-9]+$/i, '').slice(0, 12);
  // The uploader's NAME, which the placeholder does not promise.
  const uploader = clean(rows[0].uploadedBy).split(' ').slice(0, 2).join(' ');

  await v.searchFor(byName);
  const nameRows = await v.readRows();
  await v.searchFor(uploader);
  const uploaderRows = await v.readRows();

  const promisesName = /document name/i.test(placeholder || '');
  const matchesName = nameRows.length > 0;
  // A row counts as an UPLOADER match only if its document name does not itself contain the term.
  // Measured 2026-10-15: "Abdul Musawwir" returns 15 rows because those FILE NAMES contain
  // "abdul_musawwir" - a document-name match, not an uploader one. Judging on the bare row count
  // reported a correct document-name-only search as also searching the uploader.
  const uploaderOnly = uploaderRows.filter((r) => !documentNameContainsTokens(r.documentName, uploader));
  const matchesUploader = uploaderOnly.length > 0;

  await this.attach(
    `placeholder: ${JSON.stringify(placeholder)}\n` +
      `search by document name ${JSON.stringify(byName)} -> ${nameRows.length} rows\n` +
      `search by uploader ${JSON.stringify(uploader)} -> ${uploaderRows.length} rows\n` +
      'measured 2026-09-22: the search matches the document name and nothing else, and the ' +
      'placeholder says exactly that. Requires Attention and Deactivated both UNDER-promise on ' +
      'the same kind of control, so this surface is the one that gets it right.',
    'text/plain'
  );

  const problems = [];
  if (promisesName && !matchesName) {
    problems.push(`the placeholder promises a document-name search and ${JSON.stringify(byName)} matched nothing`);
  }
  if (!promisesName && matchesName) {
    problems.push(`the search matches a document name but the placeholder (${JSON.stringify(placeholder)}) does not say so`);
  }
  if (matchesUploader && !/uploader|candidate|name of/i.test(placeholder || '')) {
    problems.push(
      `the search also matches the uploader (${JSON.stringify(uploader)} returned ${uploaderRows.length} rows) ` +
        `whose document names do not contain it (${JSON.stringify(uploaderOnly.slice(0, 3).map((r) => r.documentName))}) ` +
        `while the placeholder ${JSON.stringify(placeholder)} promises only a document name`
    );
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

When('I search the queue for an uploader name absent from a listed document\'s filename', { timeout: UI }, async function () {
  const v = page(this);
  const rows = await v.readRows();
  expect(rows.length, 'there are no listed documents from which to derive an uploader name').to.be.greaterThan(0);

  const source = rows.find((row) => {
    const uploader = clean(row.uploadedBy).split(' ').slice(0, 2).join(' ');
    return uploader && !documentNameContainsTokens(row.documentName, uploader);
  });
  expect(source, 'no listed row has an uploader name absent from its document filename').to.exist;

  const term = clean(source.uploadedBy).split(' ').slice(0, 2).join(' ');
  await v.searchFor(term);
  notes(this).searchTerm = term;
  await this.attach(
    `uploader search term: ${JSON.stringify(term)}\nsource filename: ${source.documentName}`,
    'text/plain'
  );
});

Then('every returned document should match the document-name search term', { timeout: UI }, async function () {
  const v = page(this);
  const term = String(notes(this).searchTerm || '');
  expect(term, 'the uploader-name search step did not establish a term').not.to.equal('');
  const url = v.urlParams();
  const api = await v.lastListParams();
  const problems = [];
  if (!(url.search || []).includes(term)) problems.push(`the URL did not carry search=${JSON.stringify(term)}`);
  if (!api || !(api.search || []).includes(term)) {
    problems.push(`the queue request did not carry search=${JSON.stringify(term)}: ${JSON.stringify(api)}`);
  }
  expect(problems, problems.join('; ')).to.deep.equal([]);

  const rows = await v.readRows();
  const uploaderOnly = rows.filter((row) => !documentNameContainsTokens(row.documentName, term));
  await this.attach(
    `search term: ${JSON.stringify(term)}\nreturned rows: ${rows.length}\n` +
      `rows matching by uploader only: ${JSON.stringify(uploaderOnly.map((row) => row.documentName))}`,
    'text/plain'
  );
  expect(
    uploaderOnly.map((row) => row.documentName),
    `the search returned documents whose filenames do not contain ${JSON.stringify(term)}`
  ).to.deep.equal([]);
});

Then('the verification queue should list no documents', { timeout: UI }, async function () {
  const n = await page(this).rows.count();
  await this.attach(`rows rendered: ${n}`, 'text/plain');
  expect(n, `${n} rows are still listed`).to.equal(0);
});

// Pinned EXACTLY, not with an `includes` check: a contains assertion would go on passing if a
// sub-line were added later.
Then('the queue empty state should read exactly:', { timeout: UI }, async function (table) {
  const want = table.rowsHash();
  const got = await page(this).readEmptyState();
  await this.attach(`empty state: ${JSON.stringify(got)}`, 'text/plain');
  expect(got.present, 'no empty state was rendered at all').to.equal(true);
  const problems = [];
  if (clean(got.heading) !== clean(want.heading)) {
    problems.push(`heading: expected ${JSON.stringify(want.heading)}, got ${JSON.stringify(got.heading)}`);
  }
  if (clean(got.body) !== clean(want.body)) {
    problems.push(`body: expected ${JSON.stringify(want.body)}, got ${JSON.stringify(got.body)}`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the queue should hold the number of documents it held before the search', { timeout: UI }, async function () {
  const before = notes(this).baselineCount;
  const after = await page(this).lastListCount();
  await this.attach(`server count before: ${before}, after: ${after}`, 'text/plain');
  expect(before, 'no baseline count was taken').to.be.a('number');
  expect(after, `the queue holds ${after} where it held ${before} before the search`).to.equal(before);
});

Then('the queue should hold the number of documents it held before the filter', { timeout: UI }, async function () {
  const before = notes(this).baselineCount;
  const after = await page(this).lastListCount();
  await this.attach(`server count before: ${before}, after: ${after}`, 'text/plain');
  expect(before, 'no baseline count was taken').to.be.a('number');
  expect(after, `the queue holds ${after} where it held ${before} before the filter`).to.equal(before);
});

Then('the URL should carry no search term', { timeout: UI }, async function () {
  const params = page(this).urlParams();
  await this.attach(`url params: ${JSON.stringify(params)}`, 'text/plain');
  const held = (params.search || []).filter((s) => s !== '');
  expect(held, `the URL carries search=${JSON.stringify(held)}`).to.deep.equal([]);
});

Then('the queue should still list documents', { timeout: UI }, async function () {
  const n = await page(this).rows.count();
  await this.attach(`rows rendered: ${n}`, 'text/plain');
  expect(n, 'the queue rendered no rows').to.be.greaterThan(0);
});

// RECORDED, not failed on. Three surfaces in this product, two behaviours, and no AC settles
// which is house style - so failing here would make the file permanently red over a question.
Then('the wasted round trip should be reported for the product owner', { timeout: UI }, async function () {
  const v = page(this);
  const api = await v.lastListParams();
  const sent = api && api.search ? api.search : [];
  await this.attach(
    'FINDING FOR THE PRODUCT OWNER - recorded, not failed on.\n' +
      `A whitespace-only search is kept out of the URL (correct) but IS sent to the server: ` +
      `search=${JSON.stringify(sent)}. The list comes back unfiltered, so the outcome the agent ` +
      'sees is right and the cost is one wasted round trip.\n' +
      'THREE SURFACES, TWO BEHAVIOURS: Requires Attention and the SuperAdmin candidates listing ' +
      'do the same; the Agents listing suppresses the request entirely. Ask the PO which is the ' +
      'house style rather than aligning them here.',
    'text/plain'
  );
});

// Watches for a native DIALOG and for injected <script> elements, not merely for a non-500:
// Playwright dismisses dialogs automatically, so without a listener an executed term would leave
// no trace at all.
Then('none of these search terms should be executed or break the queue:', { timeout: TABLE }, async function (table) {
  const v = page(this);
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); };
  v.page.on('dialog', onDialog);

  const problems = [];
  const trace = [];
  try {
    for (const row of table.hashes()) {
      const term = row.term;
      // eslint-disable-next-line no-await-in-loop
      await v.searchFor(term);
      // eslint-disable-next-line no-await-in-loop
      const injected = await v.page.evaluate(
        (t) => [...document.querySelectorAll('script')].filter((s) => (s.textContent || '').includes(t)).length,
        'alert(1)'
      );
      // eslint-disable-next-line no-await-in-loop
      const rows = await v.rows.count();
      // eslint-disable-next-line no-await-in-loop
      const empty = await v.readEmptyState();
      // eslint-disable-next-line no-await-in-loop
      const stillThere = await v.table.isVisible().catch(() => false);
      trace.push(`${JSON.stringify(term)} -> rows=${rows} emptyState=${empty.present} gridPresent=${stillThere}`);
      if (injected) problems.push(`${JSON.stringify(term)} injected ${injected} <script> element(s)`);
      if (!stillThere && !empty.present) problems.push(`${JSON.stringify(term)} left neither a grid nor an empty state`);
    }
  } finally {
    v.page.off('dialog', onDialog);
  }
  if (dialogs.length) problems.push(`native dialog(s) raised: ${JSON.stringify(dialogs)}`);
  await this.attach(trace.join('\n'), 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// ============================================================================================
// 4. The Filters modal
// ============================================================================================

When('I open the Verifications Filters modal', { timeout: UI }, async function () {
  await page(this).openFilters();
});

When('I select the document types {string}', { timeout: UI }, async function (csv) {
  const labels = csv.split(/,| and /).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const label of labels) {
    // eslint-disable-next-line no-await-in-loop
    await page(this).selectFilterOption(label);
  }
  notes(this).selectedTypes = labels;
});

When('I select the document types {string} and {string}', { timeout: UI }, async function (a, b) {
  await page(this).selectFilterOption(a);
  await page(this).selectFilterOption(b);
  notes(this).selectedTypes = [a, b];
});

When('I apply the Verifications filters', { timeout: UI }, async function () {
  await page(this).applyFilters();
});

When('I clear all the Verifications filters', { timeout: UI }, async function () {
  await page(this).clearAllFilters();
});

When('I cancel the Verifications Filters modal', { timeout: UI }, async function () {
  await page(this).cancelFilters();
});

When('I filter the queue by the document type {string}', { timeout: UI }, async function (label) {
  const v = page(this);
  await v.openFilters();
  await v.selectFilterOption(label);
  await v.applyFilters();
  notes(this).selectedTypes = [label];
});

Then('the Filters modal should be titled {string}', { timeout: UI }, async function (title) {
  const text = clean((await page(this).filterDialog.innerText()).split('\n')[0]);
  await this.attach(`modal heading: ${JSON.stringify(text)}`, 'text/plain');
  expect(text).to.equal(title);
});

Then('the Filters modal should offer exactly the groups {string}', { timeout: UI }, async function (csv) {
  const want = csv.split(',').map((s) => s.trim());
  const got = await page(this).readFilterGroups();
  await this.attach(`groups: ${JSON.stringify(got)}`, 'text/plain');
  expect(got).to.deep.equal(want);
});

// Scoped by test id PREFIX, not by control type: since 2026-10-01 the modal also carries a
// Status group of checkboxes, and a type === 'checkbox' reader counted those as document types.
async function filterOptionsWithPrefix(world, prefix) {
  const options = await page(world).readFilterOptions();
  await world.attach(`all labels in DOM order: ${JSON.stringify(options.map((o) => `${o.label} [${o.testid}]`))}`, 'text/plain');
  return options.filter((o) => (o.testid || '').startsWith(prefix)).map((o) => o.label);
}

Then('the Filters modal should offer exactly the document types {string}', { timeout: UI }, async function (csv) {
  const want = csv.split(',').map((s) => s.trim());
  expect(await filterOptionsWithPrefix(this, 'filters-documentType-')).to.deep.equal(want);
});

Then('the Filters modal should offer a start date and an end date', { timeout: UI }, async function () {
  const options = await page(this).readFilterOptions();
  const labels = options.map((o) => o.label);
  await this.attach(`labels: ${JSON.stringify(labels)}`, 'text/plain');
  const problems = [];
  if (!labels.includes('Start Date')) problems.push('no Start Date');
  if (!labels.includes('End Date')) problems.push('no End Date');
  expect(problems, problems.join('; ')).to.deep.equal([]);
});

Then('the Filters modal should offer the actions {string}', { timeout: UI }, async function (csv) {
  const want = csv.split(',').map((s) => s.trim());
  const got = await page(this)
    .filterDialog.locator('button')
    .evaluateAll((bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
  await this.attach(`buttons: ${JSON.stringify(got)}`, 'text/plain');
  const missing = want.filter((w) => !got.includes(w));
  expect(missing, `missing ${JSON.stringify(missing)}; the modal offers ${JSON.stringify(got)}`).to.deep.equal([]);
});

Then(
  'each document type should filter the queue and query the server for its own category:',
  { timeout: TABLE },
  async function (table) {
    const v = page(this);
    const problems = [];
    const trace = [];
    for (const row of table.hashes()) {
      // eslint-disable-next-line no-await-in-loop
      await v.openWith({ activeFilter: 'ALL' });
      // eslint-disable-next-line no-await-in-loop
      await v.openFilters();
      // eslint-disable-next-line no-await-in-loop
      await v.selectFilterOption(row['document type']);
      // eslint-disable-next-line no-await-in-loop
      await v.applyFilters();

      const url = v.urlParams();
      // eslint-disable-next-line no-await-in-loop
      const api = await v.lastListParams();
      // eslint-disable-next-line no-await-in-loop
      const rendered = await v.readRows();
      const types = [...new Set(rendered.map((r) => r.documentType))];

      const [uk, uv] = row['url param'].split('=');
      const [ak, av] = row['api param'].split('=');

      if (!(url[uk] || []).includes(uv)) {
        problems.push(`${row['document type']}: the URL should carry ${row['url param']}, holds ${JSON.stringify(url)}`);
      }
      if (!api) problems.push(`${row['document type']}: no queue request was captured`);
      else if (!(api[ak] || []).includes(av)) {
        problems.push(`${row['document type']}: the request should carry ${row['api param']}, carried ${JSON.stringify(api)}`);
      }
      if (!rendered.length) {
        problems.push(`${row['document type']}: the filter rendered no rows, so it could not be observed`);
      } else if (types.length !== 1 || types[0] !== row['rendered type']) {
        problems.push(`${row['document type']}: expected every row to read "${row['rendered type']}", got ${JSON.stringify(types)}`);
      }
      trace.push(`${row['document type']}: url=${JSON.stringify(url)} api=${JSON.stringify(api)} types=${JSON.stringify(types)}`);
    }
    await this.attach(trace.join('\n'), 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

Then('the queue should list documents of both types and of no other', { timeout: UI }, async function () {
  const want = (notes(this).selectedTypes || []).slice().sort();
  const rows = await page(this).readRows();
  const got = [...new Set(rows.map((r) => r.documentType))].sort();
  await this.attach(`selected ${JSON.stringify(want)}; rendered ${JSON.stringify(got)} over ${rows.length} rows`, 'text/plain');
  expect(rows.length, 'no rows were rendered, so the union could not be observed').to.be.greaterThan(0);
  const strays = got.filter((t) => !want.includes(t));
  expect(strays, `rows of a type that was not selected: ${JSON.stringify(strays)}`).to.deep.equal([]);
});

Then('both document types should be sent to the server', { timeout: UI }, async function () {
  const want = (notes(this).selectedTypes || []).map((l) => AgentVerificationsPage.DOCUMENT_TYPE[l]);
  const api = await page(this).lastListParams();
  await this.attach(`expected categories ${JSON.stringify(want)}; request ${JSON.stringify(api)}`, 'text/plain');
  expect(api, 'no queue request was captured').to.exist;
  const sent = api.category || [];
  const missing = want.filter((w) => !sent.includes(w));
  expect(
    missing,
    `the request carried category=${JSON.stringify(sent)}. A union sent as a single value would ` +
      'silently narrow the agent\'s queue to one type.'
  ).to.deep.equal([]);
});

Then('the Filters button should show an applied-filter count of {int}', { timeout: UI }, async function (n) {
  const got = await page(this).appliedFilterCount();
  await this.attach(`filters badge: ${JSON.stringify(await page(this).filtersBadge())}`, 'text/plain');
  expect(got, `the badge reads "${await page(this).filtersBadge()}"`).to.equal(n);
});

Then('the Verifications Filters button should show no applied-filter count', { timeout: UI }, async function () {
  const badge = await page(this).filtersBadge();
  await this.attach(`filters badge: ${JSON.stringify(badge)}`, 'text/plain');
  expect(badge, `the badge reads "${badge}"`).to.equal('Filters');
});

Then('what the applied-filter count counts should be reported for the product owner', { timeout: UI }, async function () {
  const v = page(this);
  await this.attach(
    'FINDING FOR THE PRODUCT OWNER - recorded, not failed on.\n' +
      `Two options inside ONE group read ${JSON.stringify(await v.filtersBadge())}, so the badge ` +
      'counts GROUPS, not options.\n' +
      'Requires Attention and Deactivated behave the same way, while the Active tab\'s own ' +
      'scenarios assert the OPTION count for the same-looking badge - so the listings genuinely ' +
      'disagree about what the number means. Asserted as measured on each surface rather than ' +
      '"aligned" without a product answer.',
    'text/plain'
  );
});

Then('the URL should carry no document type filter', { timeout: UI }, async function () {
  const params = page(this).urlParams();
  await this.attach(`url params: ${JSON.stringify(params)}`, 'text/plain');
  expect(params.documentType || [], `the URL carries documentType=${JSON.stringify(params.documentType)}`).to.deep.equal([]);
});

Then('the Filters modal should be closed', { timeout: UI }, async function () {
  const open = await page(this).filtersDialogOpen();
  expect(open, 'the Filters modal is still open').to.equal(false);
});

Then('the document type {string} should be selected in the Filters modal', { timeout: UI }, async function (label) {
  const options = await page(this).readFilterOptions();
  const hit = options.find((o) => o.label === label);
  await this.attach(`options: ${JSON.stringify(options.map((o) => ({ l: o.label, c: o.checked })))}`, 'text/plain');
  expect(hit, `"${label}" is not offered`).to.exist;
  expect(
    hit.checked,
    `"${label}" is applied to the queue but the modal reopened with it unselected, which would ` +
      'send the agent back to re-pick a filter the page is demonstrably still applying.'
  ).to.equal(true);
});

Then('the queue request should carry both the status and the category', { timeout: UI }, async function () {
  const api = await page(this).lastListParams();
  await this.attach(`request: ${JSON.stringify(api)}`, 'text/plain');
  expect(api, 'no queue request was captured').to.exist;
  const problems = [];
  if (!api.status || !api.status.length) problems.push('the request carried no status at all');
  if (!api.category || !api.category.length) problems.push('the request carried no category at all');
  expect(
    problems,
    `${problems.join('; ')}\nThe request was ${JSON.stringify(api)}.\n` +
      'NOTE Requires Attention has the opposite defect - a Severity filter set against a severity ' +
      'TAB is silently discarded there and the tab\'s value sent instead. If this fails the same ' +
      'way, the two should be settled together.'
  ).to.deep.equal([]);
});

Then('the URL should carry both the tab and the document type filter', { timeout: UI }, async function () {
  const params = page(this).urlParams();
  await this.attach(`url params: ${JSON.stringify(params)}`, 'text/plain');
  const problems = [];
  if (!(params.activeFilter || []).length) problems.push('no activeFilter in the URL');
  if (!(params.documentType || []).length) problems.push('no documentType in the URL');
  expect(problems, `${problems.join('; ')} - url params ${JSON.stringify(params)}`).to.deep.equal([]);
});

Then('the queue request should carry both the search term and the category', { timeout: UI }, async function () {
  const api = await page(this).lastListParams();
  const term = notes(this).searchTerm;
  await this.attach(`term=${JSON.stringify(term)}; request=${JSON.stringify(api)}`, 'text/plain');
  expect(api, 'no queue request was captured').to.exist;
  const problems = [];
  if (!(api.search || []).includes(term)) problems.push(`search=${JSON.stringify(api.search)}`);
  if (!(api.category || []).length) problems.push('no category at all');
  expect(problems, `${problems.join('; ')} - request ${JSON.stringify(api)}`).to.deep.equal([]);
});

Then('the queue request should carry the category {string}', { timeout: UI }, async function (value) {
  const api = await page(this).lastListParams();
  await this.attach(`request: ${JSON.stringify(api)}`, 'text/plain');
  expect(api, 'no queue request was captured').to.exist;
  expect(api.category || [], `the request carried category=${JSON.stringify(api.category)}`).to.include(value);
});

Then('every listed document should be of the type {string}', { timeout: UI }, async function (type) {
  const rows = await page(this).readRows();
  expect(rows.length, 'no rows were rendered, so the filter could not be observed').to.be.greaterThan(0);
  const strays = rows.filter((r) => r.documentType !== type);
  await this.attach(`${rows.length} rows; types ${JSON.stringify([...new Set(rows.map((r) => r.documentType))])}`, 'text/plain');
  expect(strays.map((s) => `${s.documentName} (${s.documentType})`), 'rows of another type').to.deep.equal([]);
});

// ============================================================================================
// 5. Pagination
// ============================================================================================

Then('the queue pagination should offer a Previous, a Next and numbered pages', { timeout: UI }, async function () {
  const p = await page(this).readPagination();
  await this.attach(JSON.stringify(p, null, 1), 'text/plain');
  // The sidebar is also a <nav>; this reader is scoped by accessible name. If that scoping ever
  // breaks, this step reports the sidebar's own links rather than silently passing.
  expect(p.present, 'no pagination control was found').to.equal(true);
  const problems = [];
  if (!p.previous) problems.push('no Previous control');
  if (!p.next) problems.push('no Next control');
  if (!p.pages.length) problems.push('no numbered pages');
  expect(problems, problems.join('; ')).to.deep.equal([]);
});

Then('Previous should be disabled on the first page', { timeout: UI }, async function () {
  const p = await page(this).readPagination();
  expect(p.previous && p.previous.disabled, 'Previous is enabled on page one').to.equal(true);
});

Then('Previous should be enabled', { timeout: UI }, async function () {
  const p = await page(this).readPagination();
  expect(p.previous && p.previous.disabled, 'Previous is still disabled after leaving page one').to.equal(false);
});

When('I go to the next page of the queue', { timeout: UI }, async function () {
  await page(this).goToNextPage();
});

Then('the queue request should carry {string}', { timeout: UI }, async function (fragment) {
  const q = await page(this).lastListQuery();
  await this.attach(`last queue query: ${q}`, 'text/plain');
  expect(q, 'no queue request was captured').to.exist;
  expect(q, `the request was ${q}`).to.include(fragment);
});

Then('the URL should carry no page number', { timeout: UI }, async function () {
  const params = page(this).urlParams();
  await this.attach(`url params: ${JSON.stringify(params)}`, 'text/plain');
  const held = (params.page || []).filter((p) => p && p !== '1');
  expect(held, `the URL carries page=${JSON.stringify(held)}`).to.deep.equal([]);
});

// ============================================================================================
// 6. The review panel
// ============================================================================================

When('I open the first document in the queue', { timeout: SLOW }, async function () {
  notes(this).requestBaseline = page(this).requestCount();
  const opened = await page(this).openRow(0);
  notes(this).openedRow = opened.row;
  notes(this).urlBeforePanel = opened.urlBefore;
  await this.attach(`opened row: ${JSON.stringify(opened.row)}`, 'text/plain');
});

When('I open the first document in the queue under the {string} status tab', { timeout: SLOW }, async function (label) {
  const v = page(this);
  await v.chooseTab(TAB_STATUS[label]);
  const rows = await v.readRows();
  expect(
    rows.length,
    `the "${label}" tab holds no documents, so this scenario has nothing to inspect. That is a ` +
      'fixture condition on shared DEV data, not a defect - re-check the queue before reading it as one.'
  ).to.be.greaterThan(0);
  notes(this).requestBaseline = v.requestCount();
  const opened = await v.openRow(0);
  notes(this).openedRow = opened.row;
  notes(this).urlBeforePanel = opened.urlBefore;
  await this.attach(`tab: ${label}\nopened row: ${JSON.stringify(opened.row)}`, 'text/plain');
});

When('I note the first document in the queue', { timeout: UI }, async function () {
  const rows = await page(this).readRows();
  expect(rows.length, 'there are no rows to note').to.be.greaterThan(0);
  notes(this).notedRow = rows[0];
  notes(this).notedUrl = page(this).page.url();
  await this.attach(`noted: ${JSON.stringify(rows[0])}`, 'text/plain');
});

// Compared against THE ROW THAT WAS CLICKED, never a string from the Gherkin: a queue that always
// opened the first row's document would satisfy a bare "a panel opened" check, and that is a
// disclosure problem as much as a rendering one.
Then('the review panel should describe the document from the row I opened', { timeout: SLOW }, async function () {
  const row = notes(this).openedRow;
  expect(row, 'no row was opened').to.exist;
  const panel = await page(this).readPanel();
  await this.attach(`row: ${JSON.stringify(row)}\npanel: ${JSON.stringify({
    documentName: panel.documentName,
    documentType: panel.documentType,
    dateUploaded: panel.dateUploaded,
    status: panel.status,
    version: panel.version,
  })}`, 'text/plain');

  const problems = [];
  if (clean(panel.documentName) !== clean(row.documentName)) {
    problems.push(`document name: row "${row.documentName}", panel "${panel.documentName}"`);
  }
  if (clean(panel.documentType) !== clean(row.documentType)) {
    problems.push(`document type: row "${row.documentType}", panel "${panel.documentType}"`);
  }
  if (clean(panel.status) !== clean(row.status)) {
    problems.push(`status: row "${row.status}", panel "${panel.status}"`);
  }
  if (clean(panel.dateUploaded) !== clean(row.dateUploaded)) {
    problems.push(`date uploaded: row "${row.dateUploaded}", panel "${panel.dateUploaded}"`);
  }
  expect(
    problems,
    `${problems.join('\n')}\nA panel describing a different document from the row that was clicked ` +
      'is a disclosure problem as much as a rendering one - the agent decides on what they are shown.'
  ).to.deep.equal([]);
});

Then('the review panel should state the document\'s version', { timeout: UI }, async function () {
  const panel = await page(this).readPanel();
  await this.attach(`version: ${JSON.stringify(panel.version)}`, 'text/plain');
  expect(panel.version, 'the panel states no Version at all').to.be.a('string');
  expect(
    panel.version,
    `Version reads ${JSON.stringify(panel.version)}. It is how an agent tells a resubmission from ` +
      'the copy they sent back, so it has to be a version number.'
  ).to.match(/^v?\d+(\.\d+)?$/i);
});

Then('the review panel should render the document itself', { timeout: SLOW }, async function () {
  const v = page(this);
  await v.waitForDocumentRendered().catch(() => {});
  const viewer = await v.readViewer();
  await this.attach(JSON.stringify(viewer), 'text/plain');
  // Waits for a rendered PAGE, not for the loader to clear: an error state clears the loader too,
  // and "failed to render" must not read as "rendered".
  expect(viewer.errored, 'the viewer rendered an error state').to.equal(0);
  expect(
    viewer.rendered,
    `the document did not render: ${JSON.stringify(viewer)}. The AC requires the original document ` +
      'to be visible alongside the summary - an agent cannot decide on a document they cannot read.'
  ).to.equal(true);
});

Then('the review panel should offer a zoom control and a Download', { timeout: UI }, async function () {
  const controls = await page(this).readPanelControls();
  const labels = controls.map((c) => c.label);
  await this.attach(`panel controls: ${JSON.stringify(labels)}`, 'text/plain');
  const problems = [];
  if (!labels.includes('Zoom in')) problems.push('no Zoom in');
  if (!labels.includes('Zoom out')) problems.push('no Zoom out');
  if (!labels.includes('Download')) problems.push('no Download');
  expect(
    problems,
    `${problems.join('; ')} - the panel offers ${JSON.stringify(labels)}. Being able to READ the ` +
      'document is part of "displayed alongside", so the zoom is asserted with it.'
  ).to.deep.equal([]);
});

Then('the review panel should not have changed the URL', { timeout: UI }, async function () {
  const before = notes(this).urlBeforePanel;
  const after = page(this).page.url();
  await this.attach(`before: ${before}\nafter:  ${after}`, 'text/plain');
  expect(
    after,
    'the review panel changed the URL. It is a dialog, not a route - if it has gained one, the ' +
      'deep-link, reload and Back behaviour all need covering.'
  ).to.equal(before);
});

When('I close the review panel with its Close control', { timeout: UI }, async function () {
  await page(this).closePanel();
});

When('I press Escape on the review panel', { timeout: UI }, async function () {
  await page(this).closePanelByEscape();
});

Then('the review panel should be closed', { timeout: UI }, async function () {
  const open = await page(this).panelOpen();
  expect(open, 'the review panel is still open').to.equal(false);
});

// >>> BOTH DIRECTIONS, AND THE STEP REFUSES TO PASS WITHOUT BOTH CASES. <<< A gating rule checked
// against documents that are all in one state proves nothing and would go green for exactly the
// reason a drifted fixture makes a scenario pass vacuously elsewhere in this repo.
Then('the decision controls should be offered only where the status allows:', { timeout: TABLE }, async function (table) {
  const v = page(this);
  const problems = [];
  const trace = [];
  let sawOffered = false;
  let sawNotOffered = false;

  for (const row of table.hashes()) {
    const status = TAB_STATUS[row.status];
    // eslint-disable-next-line no-await-in-loop
    await v.openWith({ activeFilter: status });
    // eslint-disable-next-line no-await-in-loop
    const rows = await v.readRows();
    if (!rows.length) {
      problems.push(
        `the "${row.status}" tab holds no documents, so the gating rule could not be observed for it. ` +
          'A gating rule checked against one state only proves nothing.'
      );
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await v.openRow(0);
    // eslint-disable-next-line no-await-in-loop
    const offered = await v.decisionControlsOffered();
    // eslint-disable-next-line no-await-in-loop
    const panel = await v.readPanel();
    // eslint-disable-next-line no-await-in-loop
    await v.closePanel();

    const want = row['decision controls'] === 'offered';
    const got = offered.approve && offered.requestRevision;
    const none = !offered.approve && !offered.requestRevision;
    if (want) sawOffered = true; else sawNotOffered = true;

    trace.push(`${row.status} (panel status "${panel.status}"): ${JSON.stringify(offered)}`);
    if (want && !got) {
      problems.push(`${row.status}: expected BOTH decision controls, got ${JSON.stringify(offered)}`);
    }
    if (!want && !none) {
      problems.push(
        `${row.status}: a decision is offered on an already-decided document (${JSON.stringify(offered)}). ` +
          'Deciding twice is not something the product can undo.'
      );
    }
  }

  await this.attach(trace.join('\n'), 'text/plain');
  if (!sawOffered || !sawNotOffered) {
    problems.push(
      'the table did not exercise BOTH directions, so this rule has not actually been tested - ' +
        'a gating assertion that only ever sees one state passes for the wrong reason.'
    );
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the decision controls should be offered', { timeout: UI }, async function () {
  const offered = await page(this).decisionControlsOffered();
  await this.attach(JSON.stringify(offered), 'text/plain');
  expect(offered.approve && offered.requestRevision, `offered: ${JSON.stringify(offered)}`).to.equal(true);
});

Then('the review panel should explain why the document was flagged', { timeout: UI }, async function () {
  const flagged = await page(this).readFlaggedFor();
  await this.attach(JSON.stringify(flagged, null, 1), 'text/plain');
  expect(flagged.present, 'the panel shows no "Flagged for" block at all').to.equal(true);
  expect(
    flagged.reasons.length,
    'the "Flagged for" block is present but lists no reason. An agent is being asked to decide ' +
      'without being told what the automated check objected to.'
  ).to.be.greaterThan(0);
});

Then('the review panel should name what flagged it', { timeout: UI }, async function () {
  const flagged = await page(this).readFlaggedFor();
  await this.attach(`flaggedBy: ${JSON.stringify(flagged.flaggedBy)}\nraw: ${flagged.raw}`, 'text/plain');
  expect(
    flagged.flaggedBy,
    'the panel does not say what flagged the document. The AC requires the reviewer to be able to ' +
      'tell an automated finding from an agent\'s note; the build labels the former ' +
      '"Automated System Message".'
  ).to.be.a('string').and.not.equal('');
});

Then('the review panel should show a comment history', { timeout: UI }, async function () {
  const history = await page(this).readCommentHistory();
  await this.attach(JSON.stringify(history, null, 1), 'text/plain');
  expect(
    history.length,
    'a document in Revision Required carries no comment history. The comment is the reason the ' +
      'candidate was given, and this panel is the only place the agent can read it back.'
  ).to.be.greaterThan(0);
  notes(this).commentHistory = history;
});

Then('every comment should name its author and when it was left', { timeout: UI }, async function () {
  const history = notes(this).commentHistory || (await page(this).readCommentHistory());
  expect(history.length, 'there are no comments to inspect').to.be.greaterThan(0);
  // A presence check on either alone passes on a panel listing bare text with no attribution.
  const bad = history.filter((entry) => {
    const hasAuthor = /agent|automated system message|ai review/i.test(entry);
    const hasWhen = /\d{4}|\d{1,2}:\d{2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(entry);
    return !hasAuthor || !hasWhen;
  });
  await this.attach(`${history.length} comment(s); ${bad.length} missing an author or a timestamp\n${JSON.stringify(history, null, 1)}`, 'text/plain');
  expect(bad, 'comments missing an author or a timestamp').to.deep.equal([]);
});

Then('the zoom should start at {int}%', { timeout: UI }, async function (level) {
  const got = await page(this).zoomLevel();
  await this.attach(`zoom level: ${got}%`, 'text/plain');
  expect(got, `the zoom reads ${got}%`).to.equal(level);
});

// Both ends are asserted: a control that steps but never stops is a different defect from one
// that stops at the wrong place.
Then('zooming in should step up to {int}% and stop there', { timeout: TABLE }, async function (ceiling) {
  const steps = await page(this).stepZoom('in', 8);
  await this.attach(JSON.stringify(steps, null, 1), 'text/plain');
  const last = steps[steps.length - 1];
  const problems = [];
  if (last.level !== ceiling) problems.push(`the zoom reached ${last.level}% rather than ${ceiling}%`);
  if (!last.disabled) problems.push(`Zoom in is still enabled at ${last.level}%`);
  expect(problems, `${problems.join('; ')}\nsteps: ${JSON.stringify(steps)}`).to.deep.equal([]);
});

Then('zooming out should step down to {int}% and stop there', { timeout: TABLE }, async function (floor) {
  const steps = await page(this).stepZoom('out', 10);
  await this.attach(JSON.stringify(steps, null, 1), 'text/plain');
  const last = steps[steps.length - 1];
  const problems = [];
  if (last.level !== floor) problems.push(`the zoom reached ${last.level}% rather than ${floor}%`);
  if (!last.disabled) problems.push(`Zoom out is still enabled at ${last.level}%`);
  expect(problems, `${problems.join('; ')}\nsteps: ${JSON.stringify(steps)}`).to.deep.equal([]);
});

// @known-issue. Asserts the SENSIBLE behaviour and pins no particular limit, so it turns green by
// itself once the viewer paginates or virtualises.
//
// >>> IT GUARDS ITS OWN PREMISE, AND THAT IS NOT OPTIONAL. <<< A ONE-PAGE PDF renders one page
// whether the viewer is windowed or not, so opening whatever happens to be row 0 of a shared,
// volatile queue could pass having observed nothing - the way the candidate view-profile's Basic
// Information scenario passed vacuously on a drifted fixture. So this SCANS for a document long
// enough for the render strategy to be visible at all, reports which one it drove, and when it
// cannot find one it FAILS SAYING SO rather than going green.
// >>> THE PANEL'S SECOND "View" IS A LINK TO THE UPLOADER'S PROFILE, AND "IT NAVIGATED" IS NOT
//     ENOUGH TO ASSERT ABOUT IT. <<<
// A URL-shape check (`/candidates/\d+/view-profile`) passes just as happily on a panel that always
// opens the FIRST row's candidate - which is a disclosure problem, not a routing nit: the agent
// would be reading one person's profile while reviewing another person's document. So the uploader
// is captured from the panel BEFORE the click and compared against what the profile renders.
When("I follow the panel's link to the uploader's profile", { timeout: SLOW }, async function () {
  const v = page(this);
  const uploader = await v.readPanelUploader();
  expect(
    uploader.name,
    `the panel's "Uploaded By" block named nobody: ${JSON.stringify(uploader.lines)}. ` +
      'Note its first line is the AVATAR\'S INITIALS, not the name.'
  ).to.be.a('string').and.not.equal('');
  notes(this).uploader = uploader;

  // Cleared BEFORE the navigation, so a payload left over from an earlier profile in the same
  // scenario cannot be read as this one's. Same guard DeactivatedCandidatePage needed.
  const profile = this.pages.candidateViewProfile;
  if (profile) profile._profilePayload = null;

  const nav = await v.openUploaderProfile();
  notes(this).profileNav = nav;
  await this.attach(
    `uploader per panel: ${JSON.stringify(uploader)}\n` +
      `before: ${nav.before}\nafter:  ${nav.after}\ncandidate id: ${nav.candidateId}`,
    'text/plain'
  );
});

// Asserts THREE things, collected and thrown once because they fail independently and send a
// developer to different places: it went somewhere, it went to the RIGHT person, and what it
// reached is the profile screen rather than a blank route.
//
// The profile's CONTENTS stay out of scope - candidate-view-profile.feature owns that screen and
// drives it from three listings already. What is asserted here is that this is the SAME screen
// (its five-tab strip) and that it belongs to the uploader.
Then("I should be on the uploader's profile page", { timeout: SLOW }, async function () {
  const nav = notes(this).profileNav;
  const uploader = notes(this).uploader;
  expect(nav, 'the profile link was never followed').to.exist;

  const profile = this.pages.candidateViewProfile;
  expect(
    profile,
    'this.pages.candidateViewProfile is not wired - the profile screen has an owner and this ' +
      'step delegates to it rather than re-implementing its readers'
  ).to.exist;

  await profile.settleProfile().catch(() => {});
  const header = await profile.readHeader().catch(() => null);
  const tabs = await profile.tabLabels().catch(() => []);
  // What the app actually ASKED the server for. The profile payload body carries no id of its
  // own, so the request URL is the evidence - see the note further down.
  const profileFetches = (profile.responses || [])
    .map((r) => r.url)
    .filter((u) => typeof u === 'string' && u.indexOf('/candidate/profile/') !== -1);

  await this.attach(
    `uploader per panel : ${JSON.stringify(uploader)}\n` +
      `landed url         : ${nav.after}\n` +
      `candidate id       : ${nav.candidateId}\n` +
      `profile fetched    : ${JSON.stringify(profileFetches)}\n` +
      `profile header     : ${JSON.stringify(header)}\n` +
      `tab strip          : ${JSON.stringify(tabs)}`,
    'text/plain'
  );

  const problems = [];

  if (!/\/candidates\/\d+\/view-profile/.test(nav.after)) {
    problems.push(`the link landed on ${nav.after}, which is not a candidate profile route`);
  }

  // >>> THE ONE THAT MATTERS: WHOSE profile. <<<
  // Compared against the NAME the panel showed, and - when a profile fetch was captured - against the
  // id as well. The name alone would be satisfied by two candidates sharing one; the id alone
  // says nothing to whoever reads the report.
  const shownName = header && header.name ? String(header.name).trim() : '';
  if (!shownName) {
    problems.push('the profile rendered no candidate name, so who it belongs to cannot be established');
  } else if (uploader && uploader.name && shownName !== uploader.name.trim()) {
    problems.push(
      `the panel said the document was uploaded by "${uploader.name}" but the profile that opened ` +
        `belongs to "${shownName}". An agent reviewing one person's document would be reading ` +
        "another person's profile - a disclosure problem as much as a routing one."
    );
  }

  // >>> THE PROFILE PAYLOAD CARRIES NO TOP-LEVEL `id`, SO THE FETCH IS IDENTIFIED BY ITS URL. <<<
  // A first version compared `payload.id` against the id in the address bar and failed with
  // "the profile fetched was undefined" on a profile that had loaded perfectly - the body simply
  // does not carry that field. The candidate the app ASKED FOR is in the request URL, which is
  // the thing worth checking anyway: it catches a page that shows the right id in the address bar
  // while fetching somebody else.
  const fetchedIds = (profile.responses || [])
    .map((r) => (/\/candidate\/profile\/(\d+)\//.exec(r.url || '') || [])[1])
    .filter(Boolean);
  if (nav.candidateId && fetchedIds.length && !fetchedIds.includes(String(nav.candidateId))) {
    problems.push(
      `the URL names candidate ${nav.candidateId} but the profile actually fetched was ` +
        `${JSON.stringify(fetchedIds)}`
    );
  }

  // The destination is the screen candidate-view-profile.feature owns, and its five-tab strip is
  // what identifies it. The tabs are role="radio" in a radiogroup, NOT role="tab".
  const wantTabs = ['Candidate Details', 'Track Progress', 'Document Verification', 'Subscription', 'Activity Log'];
  const missing = wantTabs.filter((t) => !tabs.includes(t));
  if (missing.length) {
    problems.push(
      `the profile did not render its tab strip - missing ${JSON.stringify(missing)}, got ` +
        `${JSON.stringify(tabs)}. The route resolved but the screen did not, which is the shape ` +
        'of defect the candidate portal has with an unrecognised ?selectedTab= value.'
    );
  }

  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// ============================================================================================
// 7. The decision dialogs - opened and cancelled, NEVER submitted
// ============================================================================================

When('I open the {string} decision dialog', { timeout: UI }, async function (which) {
  const decision = /approve/i.test(which) ? 'approve' : 'revision';
  const dialog = await page(this).openDecisionDialog(decision);
  notes(this).decision = decision;
  notes(this).decisionDialog = dialog;
  notes(this).decisionText = await dialog.innerText();
});

Then('the decision dialog should be headed {string}', { timeout: UI }, async function (heading) {
  const text = notes(this).decisionText || '';
  const first = text.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  await this.attach(`dialog text:\n${text}`, 'text/plain');
  expect(clean(first), `the dialog is headed "${first}"`).to.equal(heading);
});

Then('the decision dialog should say the reason will be visible to the candidate', { timeout: UI }, async function () {
  const text = notes(this).decisionText || '';
  await this.attach(`dialog text:\n${text}`, 'text/plain');
  expect(
    /visible to the candidate/i.test(text),
    'the Request Revision dialog does not say the reason reaches the candidate. An agent typing a ' +
      `reason needs to know it will be read by the person it is about. Dialog text:\n${text}`
  ).to.equal(true);
});

Then('the decision dialog should require a reason', { timeout: UI }, async function () {
  const dialog = notes(this).decisionDialog;
  const decision = notes(this).decision;
  const v = page(this);
  const label = decision === 'approve' ? /^Approve document$/i : /^Request Revision$/i;
  const submit = dialog.locator('button').filter({ hasText: label }).first();
  const field = v.reasonField(dialog);
  const marked = /\*/.test(notes(this).decisionText || '');
  const disabled = await submit.isDisabled();
  await this.attach(
    `field required attr: ${await field.evaluate((f) => f.required).catch(() => null)}\n` +
      `reason marked with * in the copy: ${marked}\nsubmit disabled with no reason: ${disabled}`,
    'text/plain'
  );
  expect(
    disabled,
    'the decision can be submitted with no reason at all. This is the one thing standing between a ' +
      'mis-click and an irreversible decision.'
  ).to.equal(true);
});

// Cancels, and then PROVES nothing was committed by re-reading the document's status.
Then('cancelling the decision dialog should leave the document unchanged', { timeout: SLOW }, async function () {
  const v = page(this);
  const before = notes(this).openedRow;
  await v.cancelDialog(notes(this).decisionDialog);
  // NOT `decisionDialog.isVisible()`: that handle is `[role="dialog"].last()` and re-resolves to
  // the REVIEW PANEL once the decision dialog closes, so it answers "still open" on a Cancel that
  // worked. See AgentVerificationsPage.decisionDialogIsOpen().
  const stillOpen = await v.decisionDialogIsOpen(notes(this).decision);
  const panel = await v.readPanel();
  await this.attach(
    `row status before: ${before && before.status}\npanel status after cancel: ${panel.status}\n` +
      `decision dialog still open: ${stillOpen}`,
    'text/plain'
  );
  const problems = [];
  if (stillOpen) problems.push('the decision dialog is still open after Cancel');
  if (before && clean(panel.status) !== clean(before.status)) {
    problems.push(`the status moved from "${before.status}" to "${panel.status}" after a CANCEL`);
  }
  expect(
    problems,
    `${problems.join('\n')}\nCancelling must commit nothing - a decision cannot be undone.`
  ).to.deep.equal([]);
});

// Both dialogs, all four cases, in ONE step. Cucumber abandons at the first failing step, so as
// consecutive Thens only the first mismatch would ever be reported - and these fail independently.
Then('neither decision should be submittable without a reason:', { timeout: TABLE }, async function (table) {
  const v = page(this);
  await v.openWith({ activeFilter: 'AWAITING' });
  const rows = await v.readRows();
  expect(rows.length, 'the Needs Review tab holds no documents, so no decision dialog can be opened').to.be.greaterThan(0);
  await v.openRow(0);

  const REASONS = {
    untouched: null,
    'whitespace only': '   ',
    'a single character': 'x',
    'a genuine sentence': 'The certificate is legible and the dates are consistent.',
  };
  const wanted = table.hashes();
  const reasons = wanted.map((r) => REASONS[r.reason]);

  const problems = [];
  const trace = [];
  for (const decision of ['revision', 'approve']) {
    // eslint-disable-next-line no-await-in-loop
    const contract = await v.probeDecisionDialog(decision, reasons);
    trace.push(`--- ${decision} (${contract.heading}) ---\n${JSON.stringify(contract.gate, null, 1)}`);
    if (!contract.dialogClosed) problems.push(`${decision}: the dialog did not close on Cancel`);
    contract.gate.forEach((observed, i) => {
      const want = wanted[i].submit === 'disabled';
      if (observed.submitDisabled !== want) {
        problems.push(
          `${decision}: with the reason "${wanted[i].reason}" the submit control is ` +
            `${observed.submitDisabled ? 'disabled' : 'ENABLED'}, expected ${wanted[i].submit}` +
            (wanted[i].reason === 'whitespace only'
              ? ' - whitespace satisfying a mandatory reason is the defect the Contact Us description ' +
                'field and the Candidate Details name fields both have.'
              : '')
        );
      }
    });
  }
  await this.attach(trace.join('\n\n'), 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('each decision dialog\'s reason field should cap what can be typed at {int} characters', { timeout: TABLE }, async function (cap) {
  const v = page(this);
  await v.openWith({ activeFilter: 'AWAITING' });
  const rows = await v.readRows();
  expect(rows.length, 'the Needs Review tab holds no documents').to.be.greaterThan(0);
  await v.openRow(0);

  const problems = [];
  const trace = [];
  for (const decision of ['revision', 'approve']) {
    // eslint-disable-next-line no-await-in-loop
    const contract = await v.probeDecisionDialog(decision, ['A'.repeat(cap + 100)]);
    const held = (contract.gate[0] && contract.gate[0].held) || '';
    trace.push(`${decision}: maxLength=${contract.field && contract.field.maxLength}, typed ${cap + 100}, held ${held.length}`);
    // Asserted on what the field HOLDS, not on its attribute: a form that accepted the overflow
    // and merely declared a maxlength would pass an attribute-only check.
    if (held.length !== cap) {
      problems.push(`${decision}: typed ${cap + 100} characters and the field held ${held.length}, expected ${cap}`);
    }
  }
  await this.attach(trace.join('\n'), 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// @known-issue - the duplicated test id.
Then('each decision dialog\'s submit control should be distinguishable from the other\'s', { timeout: TABLE }, async function () {
  const v = page(this);
  await v.openWith({ activeFilter: 'AWAITING' });
  const rows = await v.readRows();
  expect(rows.length, 'the Needs Review tab holds no documents').to.be.greaterThan(0);
  await v.openRow(0);

  const seen = {};
  for (const decision of ['revision', 'approve']) {
    // eslint-disable-next-line no-await-in-loop
    const contract = await v.probeDecisionDialog(decision, [null]);
    seen[decision] = {
      heading: contract.heading,
      label: contract.submitLabel,
      testid: contract.submitTestid,
      untouchedDisabled: contract.gate[0] && contract.gate[0].submitDisabled,
      closed: contract.dialogClosed,
    };
  }
  await this.attach(
    `revision popup: ${JSON.stringify(seen.revision)} | approve popup: ${JSON.stringify(seen.approve)} | ` +
      (seen.approve.testid && seen.approve.testid === seen.revision.testid
        ? `RECORDED FOR DEV (not failed on): both submit buttons still carry data-testid="${seen.approve.testid}". ` +
          'AgentVerificationsPage.submitDecision() therefore matches on the visible label, never the test id.'
        : 'The two submit buttons carry distinct test ids.'),
    'text/plain'
  );
  const problems = [];
  const want = { approve: { heading: /^approve document$/i, label: /^approve document$/i }, revision: { heading: /^request revision$/i, label: /^request revision$/i } };
  for (const d of ['approve', 'revision']) {
    const c = seen[d];
    if (!want[d].heading.test(c.heading || '')) problems.push(`the ${d} popup is headed ${JSON.stringify(c.heading)}`);
    if (!want[d].label.test(c.label || '')) problems.push(`the ${d} popup's submit button reads ${JSON.stringify(c.label)}`);
    if (c.untouchedDisabled !== true) problems.push(`the ${d} popup's submit button is enabled before a reason is entered`);
    if (!c.closed) problems.push(`the ${d} popup did not close on Cancel`);
  }
  if (seen.approve.label === seen.revision.label) problems.push('both popups offer the same submit label, so the agent cannot tell them apart');
  expect(problems, problems.join(' | ')).to.deep.equal([]);
});

// ============================================================================================
// 8. Accessibility
// ============================================================================================

// >>> THE GRID'S OWN INTERACTION MODEL, NOT A TAB WALK. <<< See the page object's PART 2 header:
// a Tab-only audit answers "unreachable" on a react-aria grid that works perfectly, and
// button.focus() answers the same way because focus is redirected to the row.
Then('the {string} action should be reachable and operable from the keyboard', { timeout: SLOW }, async function (want) {
  const v = page(this);
  await v.openWith({ activeFilter: 'ALL' });
  const audit = await v.auditRowActionKeyboard(want);
  await this.attach(
    `control (search box Tab-focusable): ${audit.control}\n` +
      `reached the row by Tab: ${audit.reachedRow}\n` +
      `reached "${want}" by ArrowRight: ${audit.reached}\n` +
      `focus now on: ${audit.focused}\n` +
      `tab stops: ${JSON.stringify(audit.tabStops)}\n` +
      `arrow stops: ${JSON.stringify(audit.arrowStops)}`,
    'text/plain'
  );
  // The control first: "nothing focused" is also what a broken walk reports.
  expect(
    audit.control,
    'the search box could not be focused by Tab, so this walk proves nothing about the grid'
  ).to.equal(true);
  expect(audit.reachedRow, 'Tab never reached a grid row').to.equal(true);
  expect(
    audit.reached,
    `"${want}" was never reached by arrow keys from the row. Stops seen: ${JSON.stringify(audit.arrowStops)}`
  ).to.equal(true);

  // Reachable is not operable. Enter must actually do the thing.
  if (want === 'View') {
    await v.page.keyboard.press('Enter');
    await v.panel.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const open = await v.panelOpen();
    await this.attach(`Enter on the focused View -> panel open: ${open}`, 'text/plain');
    expect(open, 'View is focusable from the keyboard but Enter does not open the review panel').to.equal(true);
    await v.closePanel();
  } else {
    const download = v.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await v.page.keyboard.press('Enter');
    const got = await download;
    await this.attach(`Enter on the focused Download -> ${got ? got.suggestedFilename() : 'NO DOWNLOAD'}`, 'text/plain');
    expect(
      got,
      'Download is focusable from the keyboard but Enter delivers no file'
    ).to.not.equal(null);
  }
});

Then('every row action should be a real button carrying an accessible name', { timeout: SLOW }, async function () {
  const v = page(this);
  const controls = await v.page.$$eval('tbody tr td:last-child button', (bs) =>
    bs.map((b) => ({
      tag: b.tagName,
      name: b.getAttribute('aria-label') || b.innerText.trim(),
      testid: b.getAttribute('data-testid'),
    }))
  );
  await this.attach(`${controls.length} row actions inspected\n${JSON.stringify(controls.slice(0, 6), null, 1)}`, 'text/plain');
  expect(controls.length, 'no row actions were found to inspect').to.be.greaterThan(0);
  const bad = controls.filter((c) => c.tag !== 'BUTTON' || !c.name);
  expect(
    bad,
    `${bad.length} row action(s) are not a real button or carry no accessible name: ${JSON.stringify(bad)}. ` +
      'A bare <svg> control is unreachable by keyboard and silent to a screen reader - the defect ' +
      'class the dashboard "View all" spans and the candidate-profile upload icons both have.'
  ).to.deep.equal([]);
});

// ============================================================================================
// 9. End to end
// ============================================================================================

Then('the queue should still be filtered as it was', { timeout: UI }, async function () {
  const v = page(this);
  const params = v.urlParams();
  const rows = await v.readRows();
  const types = [...new Set(rows.map((r) => r.documentType))];
  const statuses = [...new Set(rows.map((r) => r.status))];
  await this.attach(
    `url: ${JSON.stringify(params)}\ntypes: ${JSON.stringify(types)}\nstatuses: ${JSON.stringify(statuses)}`,
    'text/plain'
  );
  const problems = [];
  if (!(params.activeFilter || []).length) problems.push('the status tab was dropped from the URL');
  if (!(params.documentType || []).length) problems.push('the document type filter was dropped from the URL');
  if (!rows.length) problems.push('the queue rendered no rows after the panel closed');
  expect(
    problems,
    `${problems.join('; ')}\nA panel that drops the query on close sends the agent back to an ` +
      'unfiltered queue of every document in the system.'
  ).to.deep.equal([]);
});

Then('the first document in the queue should be the one I noted', { timeout: UI }, async function () {
  const noted = notes(this).notedRow;
  expect(noted, 'no document was noted').to.exist;
  const rows = await page(this).readRows();
  expect(rows.length, 'the queue rendered no rows').to.be.greaterThan(0);
  await this.attach(`noted: ${noted.documentName}\nnow first: ${rows[0].documentName}`, 'text/plain');
  expect(
    rows[0].documentName,
    `the queue came back showing "${rows[0].documentName}" where it was showing ` +
      `"${noted.documentName}". Note this queue is shared DEV data - if an upload landed under ` +
      'the scenario, re-run before reading it as a defect.'
  ).to.equal(noted.documentName);
});

// ============================================================================================
// 10. ADDED 2026-10-01 - the behaviours the first 24 scenarios did not reach.
//     Every one was measured first with scripts/probe-agent-verifications-5.js and -6.js
//     (read-only). Nothing here decides a document: decision dialogs are opened and DISMISSED.
// ============================================================================================

const { rowDateToIso, isoAddDays } = AgentVerificationsPage;
const EMPTY = AgentVerificationsPage.EMPTY_STATES;

// "15/09/2026" (what a picker displays) -> "2026-09-15".
const shownDateToIso = (t) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(t));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// The server's own page-one results, newest first. Used to DERIVE every date this section picks,
// so no scenario pins a date that will have rolled out of the shared DEV data by next week.
When('I note the upload dates on the first page of the queue', { timeout: UI }, async function () {
  const v = page(this);
  const last = await v.lastListResponse();
  expect(last && last.results.length, 'the queue returned no documents, so there are no dates to note').to.be.greaterThan(0);
  const dates = last.results.map((r) => rowDateToIso(r.uploaded_on)).filter(Boolean);
  expect(
    dates.length,
    `none of the server's uploaded_on values could be read: ${JSON.stringify(last.results.map((r) => r.uploaded_on))}`
  ).to.be.greaterThan(0);
  const sorted = [...dates].sort();
  notes(this).pageDates = dates;
  notes(this).baselineCount = last.count;
  // A span of at least two days, so the range is a real range and not the single-day case
  // (which has its own scenario and its own known issue).
  const start = sorted[0];
  let end = sorted[sorted.length - 1];
  if (end === start) end = isoAddDays(start, 1);
  notes(this).range = { start, end };
  await this.attach(`page-one upload dates: ${JSON.stringify(dates)}\nrange chosen: ${start} .. ${end}`, 'text/plain');
});

async function applyDateRange(world, start, end) {
  const v = page(world);
  if (!(await v.filtersDialogOpen())) await v.openFilters();
  await v.pickDate('start', start);
  if (end) await v.pickDate('end', end);
  notes(world).appliedRange = { start, end };
  await v.applyFilters();
}

When('I filter the queue by a date range spanning the noted upload dates', { timeout: SLOW }, async function () {
  const r = notes(this).range;
  expect(r, 'no upload dates were noted first').to.exist;
  await applyDateRange(this, r.start, r.end);
});

Then('the URL and the queue request should both carry the date range', { timeout: UI }, async function () {
  const v = page(this);
  const { start, end } = notes(this).appliedRange;
  const url = v.urlParams();
  const api = (await v.lastListParams()) || {};
  await this.attach(`applied: ${start} .. ${end}\nurl: ${JSON.stringify(url)}\napi: ${JSON.stringify(api)}`, 'text/plain');
  // The names differ on the two sides (dateUploadedStart vs uploaded_after), so both are checked:
  // a front end that rewrote the address bar and queried for something else would pass a URL-only
  // check, and reading the rendered rows could not catch it either.
  const problems = [];
  if ((url.dateUploadedStart || [])[0] !== start) problems.push(`URL dateUploadedStart=${JSON.stringify(url.dateUploadedStart)}, expected ${start}`);
  if ((url.dateUploadedEnd || [])[0] !== end) problems.push(`URL dateUploadedEnd=${JSON.stringify(url.dateUploadedEnd)}, expected ${end}`);
  if ((api.uploaded_after || [])[0] !== start) problems.push(`request uploaded_after=${JSON.stringify(api.uploaded_after)}, expected ${start}`);
  if ((api.uploaded_before || [])[0] !== end) problems.push(`request uploaded_before=${JSON.stringify(api.uploaded_before)}, expected ${end}`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('every listed document should have been uploaded within the date range', { timeout: UI }, async function () {
  const v = page(this);
  const { start, end } = notes(this).appliedRange;
  const rows = await v.readRows();
  // Refuses to pass on an empty list: a filter that returned nothing has not been shown to filter.
  expect(rows.length, `the range ${start} .. ${end} returned no documents, so it was never shown to filter anything`).to.be.greaterThan(0);
  const outside = rows
    .map((r) => ({ name: r.documentName, shown: r.dateUploaded, iso: rowDateToIso(r.dateUploaded) }))
    .filter((r) => !r.iso || r.iso < start || r.iso > end);
  await this.attach(`range ${start} .. ${end}\nrows: ${JSON.stringify(rows.map((r) => r.dateUploaded))}`, 'text/plain');
  expect(outside, `documents listed outside ${start} .. ${end}:\n${JSON.stringify(outside, null, 1)}`).to.deep.equal([]);
});

Then('the Filters modal should show the date range I applied', { timeout: UI }, async function () {
  const { start, end } = notes(this).appliedRange;
  const shown = await page(this).readDateRange();
  await this.attach(JSON.stringify(shown), 'text/plain');
  const problems = [];
  if (shownDateToIso(shown.start) !== start) problems.push(`Start Date shows ${JSON.stringify(shown.start)}, expected ${start}`);
  if (shownDateToIso(shown.end) !== end) problems.push(`End Date shows ${JSON.stringify(shown.end)}, expected ${end}`);
  expect(
    problems,
    `${problems.join('\n')}\nA reopened modal that forgets the applied range invites the agent to apply a different one by accident.`
  ).to.deep.equal([]);
});

Then('the Filters modal should show no date range', { timeout: UI }, async function () {
  const shown = await page(this).readDateRange();
  await this.attach(JSON.stringify(shown), 'text/plain');
  expect([shown.start, shown.end], 'a date is still shown in the modal').to.deep.equal([null, null]);
});

Then('the URL and the queue request should carry no date range', { timeout: UI }, async function () {
  const v = page(this);
  const url = v.urlParams();
  const api = (await v.lastListParams()) || {};
  await this.attach(`url: ${JSON.stringify(url)}\napi: ${JSON.stringify(api)}`, 'text/plain');
  const left = ['dateUploadedStart', 'dateUploadedEnd']
    .filter((k) => (url[k] || []).some(Boolean))
    .concat(['uploaded_after', 'uploaded_before'].filter((k) => (api[k] || []).some(Boolean)).map((k) => `request ${k}`));
  expect(left, `the date range survived: ${left.join(', ')}`).to.deep.equal([]);
});

When('I choose a start date without an end date', { timeout: SLOW }, async function () {
  const start = notes(this).range.start;
  const v = page(this);
  if (!(await v.filtersDialogOpen())) await v.openFilters();
  notes(this).requestsBeforeIncomplete = v.requestCount();
  await v.pickDate('start', start);
  notes(this).appliedRange = { start, end: null };
});

Then('the Filters modal should report {string}', { timeout: UI }, async function (message) {
  const errors = await page(this).readFilterErrors();
  await this.attach(`inline messages: ${JSON.stringify(errors)}`, 'text/plain');
  expect(errors, `the modal shows ${JSON.stringify(errors)}`).to.include(message);
});

Then('Apply Filters should be disabled', { timeout: UI }, async function () {
  expect(await page(this).applyFiltersDisabled(), 'Apply Filters is enabled on an incomplete date range').to.equal(true);
});

// Both halves: the day BEFORE the start must be refused, and the start day itself must still be
// offered - a picker that disabled everything up to and including the start would pass the first
// half alone while making a single-day range impossible.
Then('the end date picker should refuse every day before the start date', { timeout: SLOW }, async function () {
  const v = page(this);
  const start = notes(this).appliedRange.start;
  const before = await v.isDateSelectable('end', isoAddDays(start, -1));
  const same = await v.isDateSelectable('end', start);
  await this.attach(`day before start: ${JSON.stringify(before)}\nstart day: ${JSON.stringify(same)}`, 'text/plain');
  const problems = [];
  if (!before.found && before.monthReachable !== false) problems.push(`the day before ${start} was not found in the end picker`);
  else if (before.selectable) problems.push(`the end picker offers ${isoAddDays(start, -1)}, the day BEFORE the start (${start})`);
  if (!same.selectable) problems.push(`the end picker refuses ${start} itself, so a single-day range cannot be chosen`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('no queue request should have carried a date range', { timeout: UI }, async function () {
  const sent = page(this).requestsSince(notes(this).requestsBeforeIncomplete || 0);
  await this.attach(`requests since the date was chosen: ${JSON.stringify(sent)}`, 'text/plain');
  expect(sent.filter((q) => /uploaded_(after|before)=/.test(q)), 'an incomplete range reached the server').to.deep.equal([]);
});

// The day chosen is one the SERVER says documents were uploaded on, and the number expected is
// what page one alone already proves exist - so the assertion is a floor, never a guess.
When('I filter the queue by a single day on which documents were uploaded', { timeout: SLOW }, async function () {
  const dates = notes(this).pageDates;
  expect(dates, 'no upload dates were noted first').to.exist;
  const tally = dates.reduce((m, d) => ({ ...m, [d]: (m[d] || 0) + 1 }), {});
  const day = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || (a < b ? 1 : -1))[0];
  notes(this).singleDay = { day, atLeast: tally[day] };
  await applyDateRange(this, day, day);
});

Then('the queue should list the documents uploaded on that day', { timeout: SLOW }, async function () {
  const v = page(this);
  const { day, atLeast } = notes(this).singleDay;
  const count = await v.lastListCount();
  const rows = await v.readRows();
  const wrong = rows.filter((r) => rowDateToIso(r.dateUploaded) !== day).map((r) => `${r.documentName} (${r.dateUploaded})`);
  // Measure the cause rather than guess it: end the range one day LATER and see whether that
  // day's documents appear. If they do, the end bound is being treated as exclusive.
  await applyDateRange(this, day, isoAddDays(day, 1));
  const widened = await v.lastListCount();
  await this.attach(
    `${day} .. ${day}: server count ${count}, rendered ${rows.length}\n` +
      `page one alone holds ${atLeast} document(s) uploaded on ${day}\n` +
      `${day} .. ${isoAddDays(day, 1)}: server count ${widened}`,
    'text/plain'
  );
  const problems = [];
  if (!(count >= atLeast)) {
    problems.push(
      `a range of ${day} to ${day} returns ${count} document(s), but at least ${atLeast} were uploaded that day.` +
        (widened >= atLeast
          ? ` Ending the range a day later returns ${widened}, so the END date is treated as exclusive - documents uploaded ON the end date are dropped.`
          : '')
    );
  }
  if (wrong.length) problems.push(`documents from other days are listed: ${wrong.join(', ')}`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

When('I filter the queue by a date range in the future', { timeout: SLOW }, async function () {
  const today = new Date().toISOString().slice(0, 10);
  const [y, m] = today.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  await applyDateRange(this, `${next}-10`, `${next}-20`);
});

When("I use the empty state's {string} action", { timeout: UI }, async function (label) {
  const v = page(this);
  const cta = v.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  expect(await cta.count(), `the empty state offers no "${label}" action`).to.be.greaterThan(0);
  const baseline = v.responseCountSync();
  await cta.click();
  await v.settleAgainstServer(baseline).catch(() => {});
  await v.settleList();
});

// ---------------------------------------------------------------- pagination

When('I go to page {int} of the queue by its number', { timeout: UI }, async function (n) {
  await page(this).goToPage(n);
});

When('I open the last page of the queue', { timeout: UI }, async function () {
  const v = page(this);
  const total = await v.lastListCount();
  expect(total, 'the server reported no total, so the last page cannot be computed').to.be.a('number');
  const size = Number(((await v.lastListParams()).page_size || [10])[0]);
  const last = Math.max(1, Math.ceil(total / size));
  notes(this).lastPage = { total, size, last };
  await v.openWith({ page: last });
});

Then('the last page should hold the remainder of the queue', { timeout: UI }, async function () {
  const v = page(this);
  const { total, size, last } = notes(this).lastPage;
  const rows = await v.readRows();
  const want = total - (last - 1) * size;
  const params = await v.lastListParams();
  await this.attach(`total ${total}, page size ${size}, last page ${last}; request ${JSON.stringify(params)}; rows ${rows.length}`, 'text/plain');
  expect((params.page || [])[0], 'the request did not ask for the last page').to.equal(String(last));
  expect(rows.length, `page ${last} of ${total} documents should hold ${want}`).to.equal(want);
});

Then('Next should be disabled on the last page', { timeout: UI }, async function () {
  const pg = await page(this).readPagination();
  await this.attach(JSON.stringify(pg.raw), 'text/plain');
  expect(pg.next && pg.next.disabled, `Next is ${JSON.stringify(pg.next)} on the last page`).to.equal(true);
});

Then('each of these page values should fall back to the first page with the queue rendered:', { timeout: TABLE }, async function (table) {
  const v = page(this);
  const problems = [];
  const trace = [];
  for (const row of table.hashes()) {
    const value = row['page value'];
    /* eslint-disable no-await-in-loop */
    await v.openWith({ page: value });
    const params = (await v.lastListParams()) || {};
    const rows = await v.readRows();
    /* eslint-enable no-await-in-loop */
    const urlPage = (v.urlParams().page || [])[0];
    trace.push(`page=${value} -> request page=${(params.page || [])[0]}, url page=${urlPage}, rows ${rows.length}`);
    if ((params.page || [])[0] !== '1') problems.push(`page=${value} (${row['why it matters']}) requested page ${JSON.stringify(params.page)}`);
    if (!rows.length) problems.push(`page=${value} (${row['why it matters']}) rendered no rows`);
    if (urlPage !== undefined && urlPage !== '1') problems.push(`page=${value} left the URL holding page=${urlPage}`);
  }
  await this.attach(trace.join('\n'), 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// >>> THE GRID RE-SORTS EACH PAGE CLIENT-SIDE. <<< Measured 2026-10-01: the server pages the
// queue newest-first, and the grid then reorders each page alphabetically by file name - so page
// one starts at "4-mb..." and page two starts again at "EDGE-03...". Across pages the list is in
// no order at all. Asserted against the server's own order rather than a sort rule, so it goes
// green whichever order the product settles on, as long as the grid and the paging agree.
Then('the queue should list the documents in the order the server returned them', { timeout: UI }, async function () {
  const v = page(this);
  const last = await v.lastListResponse();
  const rows = await v.readRows();
  const server = last.results.map((r) => r.file_name);
  const shown = rows.map((r) => r.documentName);
  await this.attach(
    `server order (newest first):\n${last.results.map((r) => `  ${r.file_name} | ${r.uploaded_on}`).join('\n')}\n` +
      `grid order:\n${rows.map((r) => `  ${r.documentName} | ${r.dateUploaded}`).join('\n')}`,
    'text/plain'
  );
  expect(
    shown,
    'the grid reorders the page the server sent. The server pages the queue newest-first, so a grid ' +
      'that re-sorts each page on its own leaves the queue in no consistent order across pages - the ' +
      'newest document can sit anywhere on page one.'
  ).to.deep.equal(server);
});

// ---------------------------------------------------------------- downloads

When('I download the first document in the queue from its row', { timeout: SLOW }, async function () {
  const v = page(this);
  const rows = await v.readRows();
  expect(rows.length, 'the queue holds no documents to download').to.be.greaterThan(0);
  notes(this).downloadRow = rows[0];
  notes(this).download = await v.downloadFromRow(0);
});

When('I download the document from the review panel', { timeout: SLOW }, async function () {
  notes(this).downloadRow = notes(this).openedRow || notes(this).downloadRow;
  notes(this).download = await page(this).downloadFromPanel();
});

Then('the downloaded file should be the document named on the row', { timeout: UI }, async function () {
  const row = notes(this).downloadRow;
  const d = notes(this).download;
  await this.attach(`row: ${row && row.documentName}\ndownload: ${JSON.stringify(d)}`, 'text/plain');
  expect(row, 'no row was recorded for the download').to.exist;
  expect(d && d.file, 'no file was delivered').to.exist;
  const problems = [];
  if (d.file.filename !== row.documentName) problems.push(`the file is named "${d.file.filename}", the row says "${row.documentName}"`);
  if (!(d.file.bytes > 0)) problems.push('the file is empty');
  const ext = (row.documentName.split('.').pop() || '').toLowerCase();
  const magic = { pdf: /^%PDF-/, png: /^\x89PNG/, jpg: /^\xFF\xD8\xFF/, jpeg: /^\xFF\xD8\xFF/ }[ext];
  // An HTML error page served under the right name passes a name-and-size check; its first bytes do not.
  if (magic && !magic.test(d.file.head)) problems.push(`the file does not start like a .${ext} (first bytes ${JSON.stringify(d.file.head)})`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('downloading should not have left the queue', { timeout: UI }, async function () {
  const d = notes(this).download;
  await this.attach(JSON.stringify(d), 'text/plain');
  const problems = [];
  if (d.urlAfter !== d.urlBefore) problems.push(`the URL moved from ${d.urlBefore} to ${d.urlAfter}`);
  if (d.newPages > 0) problems.push(`${d.newPages} new tab(s) opened`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the review panel should still be open', { timeout: UI }, async function () {
  expect(await page(this).panelOpen(), 'the review panel closed').to.equal(true);
});

// ---------------------------------------------------------------- decision dialog dismissal

// One step for all four dismissals: Cucumber abandons at the first failing step, so as separate
// Thens only the first mismatch would ever be reported. Never submits - the reason typed is only
// there to prove a dismissal throws it away.
Then(
  'each decision dialog should close back to the review panel and discard its reason when dismissed:',
  { timeout: TABLE },
  async function (table) {
    const v = page(this);
    await v.openWith({ activeFilter: 'AWAITING' });
    const rows = await v.readRows();
    expect(rows.length, 'the Needs Review tab holds no documents, so no decision dialog can be opened').to.be.greaterThan(0);
    const opened = await v.openRow(0);
    const statusBefore = (await v.readPanel()).status;
    const problems = [];
    const trace = [];
    for (const row of table.hashes()) {
      const decision = /approve/i.test(row.decision) ? 'approve' : 'revision';
      const route = /escape/i.test(row['dismissed by']) ? 'Escape' : 'X';
      const tag = `${row.decision} by ${row['dismissed by']}`;
      /* eslint-disable no-await-in-loop */
      if (!(await v.panelOpen())) await v.openRow(0);
      let dialog = await v.openDecisionDialog(decision);
      await v.reasonField(dialog).fill('A draft reason that must not survive a dismissal');
      await v.dismissDecisionDialog(dialog, route);
      const decisionOpen = await v.decisionDialogIsOpen(decision);
      const panelOpen = await v.panelOpen();
      const status = panelOpen ? (await v.readPanel()).status : null;
      let kept = null;
      if (panelOpen && !decisionOpen) {
        dialog = await v.openDecisionDialog(decision);
        kept = await v.reasonField(dialog).inputValue();
        await v.cancelDialog(dialog);
      }
      /* eslint-enable no-await-in-loop */
      trace.push(`${tag}: decision dialog open ${decisionOpen}, panel open ${panelOpen}, status ${status}, reason on reopen ${JSON.stringify(kept)}`);
      if (decisionOpen) problems.push(`${tag}: the decision dialog did not close`);
      if (!panelOpen) problems.push(`${tag}: dismissing the decision dialog also closed the review panel`);
      if (panelOpen && clean(status) !== clean(statusBefore)) problems.push(`${tag}: the status moved from "${statusBefore}" to "${status}"`);
      if (kept) problems.push(`${tag}: the dismissed reason came back on reopen (${JSON.stringify(kept)})`);
    }
    await this.attach(`document: ${opened.row.documentName}\n${trace.join('\n')}`, 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

// ---------------------------------------------------------------- reload

When('I note which status tab is selected', { timeout: UI }, async function () {
  const sel = await page(this).selectedTab();
  notes(this).reloadTab = sel.selected[0];
});

When('I reload the Verifications page', { timeout: UI }, async function () {
  const v = page(this);
  notes(this).beforeReload = { url: v.page.url(), query: await v.lastListQuery() };
  const baseline = v.responseCountSync();
  await v.page.reload({ waitUntil: 'domcontentloaded' });
  await v.settleAgainstServer(baseline).catch(() => {});
  await v.settleList();
});

Then('the URL and the queue request should be exactly as they were before the reload', { timeout: UI }, async function () {
  const v = page(this);
  const before = notes(this).beforeReload;
  const after = { url: v.page.url(), query: await v.lastListQuery() };
  await this.attach(`before: ${JSON.stringify(before, null, 1)}\nafter: ${JSON.stringify(after, null, 1)}`, 'text/plain');
  const problems = [];
  if (after.url !== before.url) problems.push(`URL ${before.url} -> ${after.url}`);
  if (after.query !== before.query) problems.push(`request ${before.query} -> ${after.query}`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then(
  'the search box, the status tab, the document type and the date range should all be restored',
  { timeout: SLOW },
  async function () {
    const v = page(this);
    const n = notes(this);
    const params = v.urlParams();
    const search = await v.searchValue();
    const tab = await v.selectedTab();
    await v.openFilters();
    const options = await v.readFilterOptions();
    const range = await v.readDateRange();
    await v.cancelFilters();
    const checkedTypes = options
      .filter((o) => (o.testid || '').startsWith('filters-documentType-') && o.checked)
      .map((o) => o.label);
    await this.attach(JSON.stringify({ params, search, tab: tab.selected, checkedTypes, range }, null, 1), 'text/plain');
    const problems = [];
    const wantSearch = (params.search || [''])[0];
    if (!wantSearch || clean(search) !== clean(wantSearch)) problems.push(`search box holds ${JSON.stringify(search)}, URL says ${JSON.stringify(wantSearch)}`);
    if (JSON.stringify(tab.selected) !== JSON.stringify([n.reloadTab])) problems.push(`selected tab ${JSON.stringify(tab.selected)}, expected ["${n.reloadTab}"]`);
    if (JSON.stringify(checkedTypes) !== JSON.stringify(n.selectedTypes || [])) {
      problems.push(`document types checked ${JSON.stringify(checkedTypes)}, expected ${JSON.stringify(n.selectedTypes)}`);
    }
    if (shownDateToIso(range.start) !== n.appliedRange.start || shownDateToIso(range.end) !== n.appliedRange.end) {
      problems.push(`date range shows ${JSON.stringify(range)}, expected ${JSON.stringify(n.appliedRange)}`);
    }
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

// ---------------------------------------------------------------- load failures and access

// >>> KNOWN ISSUE (measured 2026-10-01): a server error, a network failure and an out-of-range
// page ALL render "No documents to verify yet" - the copy for a genuinely empty queue - with no
// error and no toast. So an agent is told there is nothing to review when the queue simply failed
// to load. Asserted as the sensible rule - whatever renders must not claim the queue is empty -
// and no particular error wording is pinned, so it goes green however the product reports it.
// Scope (2026-10-05): this is about LOAD ERRORS - a server error and a network failure. Empty
// states are covered separately, so the empty-queue copy is recorded in the trace but is not what
// this step fails on; it fails only when the error message itself is missing.
Then('a documents list that fails to load should show {string}:', { timeout: TABLE }, async function (expected, table) {
  const v = page(this);
  const route = '**/candidate/documents/all/**';
  const problems = [];
  const trace = [];
  for (const row of table.hashes()) {
    const failure = row.failure;
    /* eslint-disable no-await-in-loop */
    if (failure === 'a server error') {
      await v.page.route(route, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal server error"}' }));
      await v.page.goto(v.url, { waitUntil: 'domcontentloaded' });
    } else if (failure === 'a network failure') {
      await v.page.route(route, (r) => r.abort('internetdisconnected'));
      await v.page.goto(v.url, { waitUntil: 'domcontentloaded' });
    } else {
      throw new Error(`unknown failure "${failure}"`);
    }
    // NOT readEmptyState(): this message is not rendered inside .section-empty-state, so that
    // reader answered "nothing" and the first version of this step PASSED BLIND on every failure.
    // Read the page's own text, and refuse to conclude anything until the shell has painted - an
    // unrendered page contains no empty-queue copy either.
    const shell = await v.tabStrip.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    const saysEmpty = await v.page
      .locator('main')
      .getByText(EMPTY.emptyQueue.heading, { exact: true })
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    const text = clean(await v.page.locator('main').innerText().catch(() => ''));
    // The expected copy may sit in the page body or in a toast, so both are read. Matched as a
    // case-insensitive phrase so "Failed to load documents." still counts as the message asked for.
    const errorRe = new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const alerts = await v.page
      .locator('[role="alert"], [role="status"], .Toastify__toast')
      .evaluateAll((t) => t.map((x) => x.innerText.trim()).filter(Boolean));
    await v.page.unroute(route).catch(() => {});
    /* eslint-enable no-await-in-loop */
    const showsError = errorRe.test(text) || alerts.some((a) => errorRe.test(a));
    trace.push(
      `${failure}: shell rendered ${shell}; shows "${expected}" ${showsError}; says empty ${saysEmpty}; ` +
        `alerts ${JSON.stringify(alerts)}; page: ${JSON.stringify(text.slice(0, 300))}`
    );
    if (!shell) {
      problems.push(`${failure}: the page shell never rendered, so what it tells the agent could not be read`);
    } else {
      if (!showsError) {
        const instead = saysEmpty ? `"${EMPTY.emptyQueue.heading}"` : JSON.stringify(text.slice(0, 120));
        problems.push(`${failure}: the page does not show "${expected}" - it shows ${instead} instead`);
      }
    }
  }
  await this.attach(trace.join('\n'), 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the URL should still carry the date range', { timeout: UI }, async function () {
  const { start, end } = notes(this).appliedRange;
  const url = page(this).urlParams();
  await this.attach(JSON.stringify(url), 'text/plain');
  expect([(url.dateUploadedStart || [])[0], (url.dateUploadedEnd || [])[0]], 'closing the panel dropped the date range').to.deep.equal([start, end]);
});
