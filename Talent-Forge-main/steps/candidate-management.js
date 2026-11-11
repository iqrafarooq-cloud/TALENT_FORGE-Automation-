const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const CandidatesListingPage = require('../pages/CandidatesListingPage');
const CandidateDetailPanelPage = require('../pages/CandidateDetailPanelPage');
require('dotenv').config();

// Step definitions for
//   features/SuperAdmin_Portal/UserManagement/Candidate-Search-Filters-View.feature
//   features/SuperAdmin_Portal/UserManagement/Candidate-Deactivate-Reactivate.feature
//
// `Given I am logged in as the superadmin` is NOT defined here - invite-agent.js owns it - and
// neither are `Given I am on the Candidates listing`, `Given I have noted the first candidate
// on the {string} tab`, or any of the Update Email Address steps: edit-email.js owns those and
// Cucumber loads every step file into ONE registry, so a second definition is an ambiguous
// step, which counts as neither a pass nor a failure and is easy to miss in the summary.
//
// >>> WHY EVERY PHRASE HERE SAYS "candidate". <<< The agents listing's steps are generic
// ("I open the Filters modal", "the confirm button should be disabled", "I go to the next
// page") and they are already taken. Re-using one would either be ambiguous or, worse, would
// resolve to the AGENT page object and quietly assert the wrong screen. The candidate
// vocabulary is deliberately explicit for that reason, not for tidiness.
//
// THREE RULES THIS FILE FOLLOWS THROUGHOUT, all of them lessons already paid for in this repo:
//
// 1. ANYTHING THAT ASSERTS WHAT THE LIST CONTAINS READS THE SERVER'S PAYLOAD, never scraped
//    rows. The grid keeps the previous query's rows on screen while the next one is in flight
//    AND paints skeleton rows before its data arrives, so a DOM read after Apply describes the
//    page that was already there. CandidatesListingPage.runAndWaitForList() returns the
//    payload; every filter and search assertion here reads that.
//
// 2. A STEP DRIVEN BY A DATA TABLE COLLECTS EVERY ROW'S FAILURE AND REPORTS THEM TOGETHER.
//    Cucumber abandons a scenario at its first failing step, so throwing on row 1 hides rows
//    2..N. That is also why these are single scenarios rather than Scenario Outlines: an
//    outline pays for a browser context and a superadmin login per example and still cannot
//    say whether its examples failed for the same reason.
//
// 3. A DIVERGENCE NOBODY HAS RULED ON IS ATTACHED, NOT FAILED ON. Three things here differ
//    from the agents listing (the whitespace search, the "Clear all filters" wording, the
//    tab-vs-Status-filter contradiction) and no AC says which is right. Failing on them would
//    make this module permanently red over questions for the PO and would bury the findings
//    that matter - the same call the receipt-PDF currency step and the agent-email
//    "Talentforge" spelling already got.

const listing = (world) => world.pages.candidatesListing;
const panel = (world) => world.pages.candidateDetailPanel;
const candidatesOf = (payload) => CandidatesListingPage.candidatesFrom(payload);

// Remember the last list request so URL / param / payload assertions all read one source.
function remember(world, result) {
  world._candidateList = result || { requestUrl: '', payload: null, requestFired: false };
  return world._candidateList;
}

// >>> THE BRIDGE TO edit-email.js. <<< Two Givens this feature leans on are ALREADY DEFINED
// there and must not be defined again - `I am on the Candidates listing` and `I have noted the
// first candidate on the {string} tab`. Cucumber loads every step file into one registry, so a
// second definition is an ambiguous step: it counts as neither a pass nor a failure and is
// easy to miss in the summary.
//
// Those steps record their result on `_emailLastList` / `_emailSubject`, since they serve both
// listings. Reading through to them here is what lets a candidate scenario open with the
// existing Background and then use this file's vocabulary - rather than the alternative, which
// would be a near-identical second Given whose only purpose was to write a different property.
function lastList(world) {
  const list = world._candidateList || world._emailLastList;
  if (!list) {
    throw new Error(
      'No candidate list request has been captured yet - a Given/When that loads, searches or '
      + 'filters the list has to run first.',
    );
  }
  return list;
}

// >>> A PAGE THE APP HAS ALREADY FETCHED IS RE-RENDERED FROM ITS OWN CACHE WITH NO REQUEST,
// AND THAT IS CORRECT BEHAVIOUR. <<< Measured on the first full run: `Previous` after `Next`
// fires nothing and renders page 1's rows perfectly, and so does clearing filters from the
// empty state back to a page already seen. AgentsListingPage documents the same thing.
//
// So `payload` is legitimately null in those cases, and `candidatesFrom(null)` is `[]` - which
// every payload-based assertion reports as "no candidates listed". Two scenarios failed exactly
// that way, both describing an empty list the superadmin was never shown.
//
// The fallback reads the GRID instead, and says which source it used so a report never has to
// guess. Reading the DOM is normally forbidden here (rule 1 at the top of this file) precisely
// because the grid keeps the previous query's rows while the next is in flight - but that
// hazard does not exist when no query was made at all, which is the only case this runs in.
async function lastPayloadCandidates(world) {
  const list = lastList(world);
  if (list.payload) return candidatesOf(list.payload);
  const rows = (await listing(world).readRows()).filter((r) => r.email);
  world.attach(
    `No candidate-list request was fired, so the ${rows.length} row(s) on screen were read from `
    + 'the grid instead. That is the app re-rendering a page it had already fetched - see the '
    + 'note on lastPayloadCandidates().',
    'text/plain',
  );
  return rows.map((r) => ({ name: r.name, email: r.email, status: '', verified: null }));
}

// The subject an assertion is about. Steps that need one fail with a clear message rather
// than reading `undefined.email` three lines later.
// The subject an assertion is about. Steps that need one fail with a clear message rather than
// reading `undefined.email` three lines later. Falls through to edit-email.js's own subject
// (see the bridge note above) so `Given I have noted the first candidate on the "All" tab`
// works as the opening of a scenario in either file.
function subject(world) {
  const c = world._candidate
    || (world._emailSubject && world._emailSubject.kind === 'candidate' ? world._emailSubject : null);
  if (!c || !c.email) {
    throw new Error('No candidate has been noted - use a Given that notes or finds a candidate first.');
  }
  return c;
}

// The other half of the bridge. Every Given here that notes a candidate calls this, so it
// records the subject under BOTH vocabularies:
//
//   _candidate    - what this file's steps read
//   _emailSubject - what edit-email.js's steps read, plus _emailSurface so its `surface()`
//                   resolves to the CANDIDATES listing rather than defaulting to Agents
//
// Without the second half, `When I open the Update Email Address modal for that record` throws
// "No agent or candidate has been noted" when it follows one of this file's Givens - which is
// exactly what the Deactivated-tab Edit scenario does. Setting both is what lets the two
// vocabularies be mixed in one scenario, and mixing them is the point: Edit-Email.feature owns
// the modal's rules and this file only proves the action is offered where it should be.
//
// `kind: 'candidate'` is what subject() above keys on, so a scenario that noted an AGENT
// cannot be silently read back here as a candidate.
function noteCandidate(world, row, note) {
  world._candidate = row;
  world._emailSurface = 'Candidates';
  world._emailSubject = { kind: 'candidate', ...row };
  world.attach(
    `Subject candidate: ${row.name} <${row.email}>`
    + `${row.status ? ` (${row.status})` : ''}`
    + `${row.agentName ? `, agent ${row.agentName} <${row.agentEmail}>` : ''}`
    + `${note ? `\n${note}` : ''}`,
    'text/plain',
  );
  return row;
}

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// >>> THE GUARD. Read the note at the top of Candidate-Deactivate-Reactivate.feature. <<<
//
// POSITIVE and IDENTITY-BASED, exactly like inviteFixtureGuard(): it names what MAY be
// deactivated and refuses everything else, regardless of tags, hooks or which step is
// calling. A tag-driven guard is one missing hook away from spending the wrong account - which
// is precisely how REFERRAL_NOPROMO_AGENT's zero-candidate state was destroyed on 2026-08-27.
//
// The shared CANDIDATE_EMAIL is what the subscription, promo and document-verification suites
// sign in as. Deactivating it would stop all three logging in, and the failures would look
// nothing like the cause.
function candidateLifecycleGuard(email) {
  const addr = String(email || '').trim().toLowerCase();
  const pinned = String(process.env.CANDIDATE_LIFECYCLE_EMAIL || '').trim().toLowerCase();
  if (pinned && addr === pinned) return addr;
  if (/^uat\.candidate\d+@talentforge\.test$/.test(addr)) return addr;
  throw new Error(
    `REFUSING to change the account state of ${JSON.stringify(email)}.\n\n`
    + 'Only a seeded uat.candidate<N>@talentforge.test account may be deactivated, or whichever '
    + 'address CANDIDATE_LIFECYCLE_EMAIL names. A candidate cannot be deleted, and the shared '
    + 'CANDIDATE_EMAIL is the login for the subscription, promo and document-verification '
    + 'suites - deactivating it would stop all three working for a reason that looks nothing '
    + 'like this.',
  );
}

// ==================== Navigation and tabs ====================
//
// `Given I am on the Candidates listing` is edit-email.js's. It navigates but does not record
// a payload, so every step here that needs one re-reads rather than assuming.

Given('I am on the {string} candidates tab', { timeout: 90000 }, async function (tab) {
  const result = await listing(this).runAndWaitForList(async () => {
    await listing(this).goto(tab);
  });
  remember(this, result);
});

When('I open the {string} candidates tab', { timeout: 90000 }, async function (tab) {
  remember(this, await listing(this).selectTab(tab));
});

When('I reload the Candidates listing', { timeout: 90000 }, async function () {
  const result = await listing(this).runAndWaitForList(async () => {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  });
  await listing(this).settle();
  remember(this, result);
});

Given('I have noted the listing URL', async function () {
  this._notedListingUrl = this.page.url();
  this.attach(`Noted listing URL: ${this._notedListingUrl}`, 'text/plain');
});

Then('the URL should be unchanged from the noted listing URL', async function () {
  expect(this._notedListingUrl, 'no listing URL was noted').toBeTruthy();
  expect(
    this.page.url(),
    'the candidate view is a DRAWER: opening it must not navigate. A changed URL here means the '
    + 'product has gained a route for it, which is a real change and not a test failure - '
    + 'update this scenario and the header of CandidateDetailPanelPage.',
  ).toBe(this._notedListingUrl);
});

// ==================== Structure ====================

Then('the candidates page heading should be {string}', async function (expected) {
  expect(await listing(this).headingText()).toContain(expected);
});

Then('the candidate search box should invite a search', async function () {
  const placeholder = await listing(this).searchPlaceholder();
  this.attach(`Search placeholder: ${JSON.stringify(placeholder)}`, 'text/plain');
  expect(placeholder, 'the search box should carry a placeholder telling the superadmin what it searches')
    .toMatch(/search/i);
});

Then('the candidate lifecycle tabs should be:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const got = await listing(this).tabNames();
  expect(got, `tabs on screen: ${JSON.stringify(got)}`).toEqual(want);
});

Then('the {string} candidates tab should be the selected tab', async function (tab) {
  const current = await listing(this).currentTab();
  expect(current, `selected tab is "${current}"`).toMatch(new RegExp(`^${tab}$`, 'i'));
});

Then('the {string} candidates tab should still be the selected tab', async function (tab) {
  const current = await listing(this).currentTab();
  expect(current, `selected tab is "${current}"`).toMatch(new RegExp(`^${tab}$`, 'i'));
});

Then('the candidate {string} button should be available', async function (label) {
  await expect(this.page.getByRole('button', { name: new RegExp(`^${label}\\b`, 'i') }).first()).toBeVisible();
});

Then('the candidate grid should be visible', async function () {
  await expect(listing(this).grid).toBeVisible();
});

Then('the candidate grid should have the columns:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const got = await listing(this).columnHeaders();
  expect(got, `columns on screen: ${JSON.stringify(got)}`).toEqual(want);
});

Then('each candidates tab should render its own columns and row actions:', { timeout: 240000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const tab = row.tab.trim();
    await listing(this).goto(tab);
    const columns = await listing(this).columnHeaders();
    const rows = await listing(this).readRows();
    const actions = rows.length ? rows[0].actions.filter((a) => /^(view|edit|deactivate account|reactivate account)$/i.test(a)) : [];
    const wantColumns = splitList(row.columns);
    const wantActions = splitList(row.actions);

    // The tab's own URL param, so a tab that renders correctly while querying the wrong slice
    // is still caught.
    const param = (row.param || '').trim();
    const url = new URL(this.page.url());
    const actualParam = url.searchParams.get('accountTab') || '';
    if (actualParam !== param) {
      problems.push(`"${tab}": expected accountTab=${JSON.stringify(param || '(none)')}, got ${JSON.stringify(actualParam || '(none)')}`);
    }
    if (JSON.stringify(columns) !== JSON.stringify(wantColumns)) {
      problems.push(`"${tab}" columns: expected ${JSON.stringify(wantColumns)}, got ${JSON.stringify(columns)}`);
    }
    if (!rows.length) {
      problems.push(`"${tab}" listed no rows at all, so its row actions could not be read.`);
    } else if (JSON.stringify(actions) !== JSON.stringify(wantActions)) {
      problems.push(`"${tab}" row actions: expected ${JSON.stringify(wantActions)}, got ${JSON.stringify(actions)}`);
    }
    report.push(`${tab}: ${rows.length} row(s), actions ${JSON.stringify(actions)}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The candidate tabs did not render as specified.');
});

Then('every candidate row action should expose an accessible name', async function () {
  const state = await this.page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'));
    // The Actions cell is the last gridcell. Scoped to it so the row's own name/email
    // buttons - which are real buttons with text - are not counted as row actions.
    return rows.slice(0, 3).map((r) => {
      const cells = Array.from(r.querySelectorAll('[role="gridcell"]'));
      const actionsCell = cells[cells.length - 1];
      return Array.from((actionsCell || r).querySelectorAll('button')).map((b) => ({
        aria: b.getAttribute('aria-label'),
        text: c(b.innerText),
        hasIcon: Boolean(b.querySelector('svg')),
      }));
    });
  });
  const problems = [];
  state.forEach((row, i) => {
    if (!row.length) problems.push(`row ${i + 1} exposes no action buttons at all`);
    row.forEach((b, j) => {
      if (!b.aria && !b.text) {
        problems.push(
          `row ${i + 1} action ${j + 1} has neither an aria-label nor any text, so it is `
          + 'unreachable by a screen reader and unlocatable by every step in this file',
        );
      }
    });
  });
  this.attach(JSON.stringify(state, null, 2), 'text/plain');
  fail(problems, 'Candidate row actions are not named for assistive technology.');
});

// The account-status wording, compared across the two layers that name it. Both are read for
// the SAME rows, matched by email - comparing a set of rendered strings against a set of
// payload strings would pass on two lists that happen to overlap.
Then('the rendered account status and the payload\'s should be reported side by side', async function () {
  const payload = await lastPayloadCandidates(this);
  const rendered = await this.page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'))
      .map((r) => {
        const header = r.querySelector('[role="rowheader"]');
        const email = (c(header && header.innerText).match(/[^\s@]+@[^\s@]+/) || [''])[0];
        const cells = Array.from(r.querySelectorAll('[role="gridcell"]')).map((x) => c(x.innerText));
        return { email, status: cells[1] };
      });
  });
  const pairs = rendered
    .map((r) => {
      const hit = payload.find((p) => String(p.email).toLowerCase() === String(r.email).toLowerCase());
      return { email: r.email, grid: r.status, payload: hit ? hit.status : '(row not in payload)' };
    })
    .filter((p) => p.email);

  const tab = await listing(this).currentTab();
  const differing = pairs.filter((p) => p.grid && p.payload && p.grid !== p.payload);
  this.attach(
    'ACCOUNT STATUS, per layer (for the PO, not a failure):\n'
    + `  tab label   : ${JSON.stringify(tab)}\n`
    + `  ${differing.length} of ${pairs.length} row(s) name the state differently\n`
    + `${pairs.map((p) => `    ${p.email}\n      grid    ${JSON.stringify(p.grid)}\n      payload ${JSON.stringify(p.payload)}`).join('\n')}\n`
    + '  So the same state has up to three names - the tab, the cell and the API field.\n'
    + '  CandidatesListingPage.statusIs() accepts the pair rather than either string; pinning\n'
    + '  the rendered wording would make every payload assertion red and pinning the API\'s\n'
    + '  would make every grid assertion red.',
    'text/plain',
  );
  expect(pairs.length, 'no rows were on screen, so nothing was compared').toBeGreaterThan(0);
});

// ==================== Noting a subject ====================

Given('I have noted the first candidate on the current tab', { timeout: 90000 }, async function () {
  const result = await listing(this).runAndWaitForList(async () => {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  });
  remember(this, result);
  const rows = candidatesOf(result.payload);
  if (!rows.length) throw new Error(`The current tab (${await listing(this).currentTab()}) listed no candidates.`);
  noteCandidate(this, rows[0], `Noted on the "${await listing(this).currentTab()}" tab.`);
});

// NOTE: `Given I have noted the first candidate on the {string} tab` is deliberately NOT
// defined here. edit-email.js owns it, and subject() reads through to what it records - see
// the bridge note at the top of this file. Adding it here would make it ambiguous and take
// both features down.

// ==================== Search ====================

When('I search the candidates for {string}', { timeout: 120000 }, async function (term) {
  remember(this, await listing(this).search(term, { tab: await listing(this).currentTab() }));
});

When("I search the candidates for that candidate's full email", { timeout: 120000 }, async function () {
  const c = subject(this);
  this._searchTerm = c.email;
  remember(this, await listing(this).search(c.email, { tab: await listing(this).currentTab() }));
});

When("I search the candidates for that candidate's first name", { timeout: 120000 }, async function () {
  const c = subject(this);
  this._searchTerm = String(c.name).trim().split(/\s+/)[0];
  remember(this, await listing(this).search(this._searchTerm, { tab: await listing(this).currentTab() }));
});

When('I clear the candidate search', { timeout: 120000 }, async function () {
  remember(this, await listing(this).search(''));
  this._searchTerm = '';
});

Then('the candidate search box should be empty', async function () {
  expect((await listing(this).searchInput.inputValue()).trim()).toBe('');
});

Then('the candidate search box should still hold the search term', async function () {
  expect(await listing(this).searchInput.inputValue()).toContain(this._searchTerm);
});

// Every field is asserted against the SERVER's answer for that term, and every field's result
// is collected so one unmatched field does not hide the rest.
Then('searching the candidates should find that candidate by each of:', { timeout: 240000 }, async function (dataTable) {
  const c = subject(this);
  const first = String(c.name).trim().split(/\s+/)[0];
  const TERMS = {
    'full name': c.name,
    'first name only': first,
    'name uppercased': String(c.name).toUpperCase(),
    'full email': c.email,
  };
  const problems = [];
  const report = [`Subject: ${c.name} <${c.email}>`];
  for (const row of dataTable.hashes()) {
    const field = row.field.trim();
    const term = TERMS[field];
    if (term === undefined) { problems.push(`No term is defined for field "${field}".`); continue; }
    const result = await listing(this).search(term, { tab: 'All' });
    const rows = candidatesOf(result.payload);
    const hit = rows.find((r) => String(r.email).toLowerCase() === String(c.email).toLowerCase());
    report.push(`${field} -> ${JSON.stringify(term)} : ${rows.length} result(s), subject ${hit ? 'FOUND' : 'MISSING'}`);
    if (!hit) {
      problems.push(
        `searching by ${field} (${JSON.stringify(term)}) did not return ${c.email}. `
        + `The server returned ${rows.length} candidate(s): ${JSON.stringify(rows.slice(0, 5).map((r) => r.email))}`,
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The candidate search did not find the subject by every field.');
});

Then('searching the candidates for each of these terms should return nothing and not break the page:', { timeout: 240000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  // Console errors are collected for the whole step: an injection term that returns nothing
  // AND throws in the page is a different finding from one that merely returns nothing.
  const consoleErrors = [];
  const onConsole = (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); };
  this.page.on('console', onConsole);
  try {
    for (const row of dataTable.hashes()) {
      const term = row.term.trim();
      const result = await listing(this).search(term, { tab: 'All' });
      const rows = candidatesOf(result.payload);
      const empty = await listing(this).readEmptyState();
      report.push(`${JSON.stringify(term)} -> ${rows.length} result(s), empty state ${empty ? JSON.stringify(empty.heading) : 'ABSENT'}`);
      if (rows.length) {
        problems.push(`${JSON.stringify(term)} returned ${rows.length} candidate(s) when it should match none: ${JSON.stringify(rows.slice(0, 3).map((r) => r.email))}`);
      }
      if (!empty) {
        problems.push(`${JSON.stringify(term)} returned nothing but rendered no empty state, so the superadmin is shown a blank grid with no explanation.`);
      }
      // The page must still work afterwards - an injection term that leaves the listing
      // unusable is the actual risk, not the zero results.
      if (!(await listing(this).grid.isVisible().catch(() => false)) && !empty) {
        problems.push(`${JSON.stringify(term)} left neither a grid nor an empty state on screen.`);
      }
    }
  } finally {
    this.page.off('console', onConsole);
  }
  if (consoleErrors.length) this.attach(`Console errors during search:\n${consoleErrors.join('\n')}`, 'text/plain');
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A search matching no candidate did not behave safely.');
});

Then('the candidates empty state heading should be {string}', async function (expected) {
  const empty = await listing(this).readEmptyState();
  expect(empty, 'no empty state is on screen').not.toBeNull();
  expect(empty.heading).toBe(expected);
});

// Exact, not `includes`: an `includes` check goes on passing if a sub-line is added later, and
// the two empty states here differ by ONE WORD ("search" vs "filters") - a substring match on
// the shorter would pass on the wrong state entirely.
Then('the candidates empty state should read {string}', async function (expected) {
  const empty = await listing(this).readEmptyState();
  expect(empty, 'no empty state is on screen').not.toBeNull();
  this.attach(`Empty state: ${JSON.stringify(empty, null, 2)}`, 'text/plain');
  expect(empty.text).toContain(expected);
});

Then('the candidates empty state should offer no call to action', async function () {
  const empty = await listing(this).readEmptyState();
  expect(empty, 'no empty state is on screen').not.toBeNull();
  expect(empty.ctas, `the search empty state offered ${JSON.stringify(empty.ctas)}`).toEqual([]);
});

Then('the candidates empty state should offer a {string} call to action', async function (label) {
  const empty = await listing(this).readEmptyState();
  expect(empty, 'no empty state is on screen').not.toBeNull();
  this.attach(
    `Empty-state CTAs: ${JSON.stringify(empty.ctas)}\n`
    + 'NOTE: the AGENTS listing labels the same control "Clear All". Neither wording is '
    + 'asserted as the house style - both are asserted as measured, and the divergence is a '
    + 'question for the PO.',
    'text/plain',
  );
  expect(empty.ctas.map((t) => t.toLowerCase())).toContain(label.toLowerCase());
});

When('I clear the candidate filters from the empty state', { timeout: 90000 }, async function () {
  remember(this, await listing(this).clickEmptyStateClearAll());
});

// The whitespace finding, REPORTED rather than judged - see rule 3 in the header.
Then('what the whitespace-only search sent to the server should be reported', async function () {
  const list = lastList(this);
  const sent = list.requestUrl ? decodeURIComponent(new URL(list.requestUrl).searchParams.get('search') || '') : null;
  this.attach(
    'MEASURED DIVERGENCE FROM THE AGENTS LISTING (for the PO, not a failure):\n'
    + `  request fired : ${list.requestFired}\n`
    + `  search param  : ${JSON.stringify(sent)}\n`
    + `  request       : ${list.requestUrl || '(none)'}\n`
    + '  The agents listing suppresses a whitespace-only term entirely and fires NO request.\n'
    + '  This listing keeps it out of the URL but sends it to the API, which answers with the\n'
    + '  unfiltered list - so the outcome is correct and one round trip is wasted.',
    'text/plain',
  );
  expect(true).toBe(true);
});

// ==================== Counting ====================

Then('exactly {int} candidate should be listed', async function (n) {
  const rows = await lastPayloadCandidates(this);
  expect(rows.length, `the server returned ${JSON.stringify(rows.map((r) => r.email))}`).toBe(n);
});

Then('more than {int} candidate should be listed', { timeout: 90000 }, async function (n) {
  const rows = await lastPayloadCandidates(this);
  expect(rows.length, `the server returned ${rows.length} candidate(s)`).toBeGreaterThan(n);
});

Then('no candidates should be listed', async function () {
  const rows = await lastPayloadCandidates(this);
  expect(rows.length, `the server returned ${JSON.stringify(rows.map((r) => r.email))}`).toBe(0);
});

Then('that candidate should be listed', async function () {
  const c = subject(this);
  const rows = await lastPayloadCandidates(this);
  const hit = rows.find((r) => String(r.email).toLowerCase() === String(c.email).toLowerCase());
  expect(hit, `${c.email} is not among ${JSON.stringify(rows.map((r) => r.email))}`).toBeTruthy();
});

// ==================== URL assertions ====================

Then('the candidates URL should contain the search term', async function () {
  const url = new URL(this.page.url());
  const term = url.searchParams.get('search') || '';
  expect(term, `URL is ${this.page.url()}`).toBeTruthy();
  if (this._searchTerm) expect(term.toLowerCase()).toBe(String(this._searchTerm).toLowerCase());
});

Then('the candidates URL should not contain a search term', async function () {
  const url = new URL(this.page.url());
  expect(url.searchParams.get('search'), `URL is ${this.page.url()}`).toBeFalsy();
});

Then('the candidates URL should contain the filter {string}', async function (pair) {
  const [key, value] = String(pair).split('=');
  const url = new URL(this.page.url());
  const got = url.searchParams.getAll(key);
  expect(got, `URL is ${this.page.url()}`).toContain(value);
});

Then('the candidates URL should not contain the filter {string}', async function (pair) {
  const [key, value] = String(pair).split('=');
  const url = new URL(this.page.url());
  expect(url.searchParams.getAll(key), `URL is ${this.page.url()}`).not.toContain(value);
});

// Every param the modal can write. `page` and `search` are deliberately NOT in this list -
// they are not filters, and a paging assertion has to survive this step.
const FILTER_KEYS = ['status', 'accountVerification', 'pendingDocuments', 'subscriptionStatus', 'lastActivity'];

Then('the candidates URL should not contain any filter parameters', async function () {
  const url = new URL(this.page.url());
  const present = FILTER_KEYS.filter((k) => url.searchParams.has(k));
  expect(present, `URL is ${this.page.url()}`).toEqual([]);
});

// ==================== Filters ====================

When('I open the candidate Filters modal', { timeout: 60000 }, async function () {
  await listing(this).openFilters();
});

Then('the candidate filter modal heading should be {string}', async function (expected) {
  const state = await listing(this).readFilterOptions();
  expect(state.found, 'the Filters modal is not open').toBe(true);
  await expect(listing(this).filterDialog.getByRole('heading', { name: expected })).toBeVisible();
});

Then('the candidate filter modal should offer the groups:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const state = await listing(this).readFilterOptions();
  expect(state.found, 'the Filters modal is not open').toBe(true);
  expect(state.groupTitles, `groups on screen: ${JSON.stringify(state.groupTitles)}`).toEqual(want);
});

// The CONTROL TYPE is asserted alongside the options, and that is the point of the step: two
// of these groups are radios, so an assertion that only counted options would pass on a modal
// where a checkbox group had silently become single-select - which changes what the superadmin
// can express, not just how it looks.
Then('each candidate filter group should offer its own options and control type:', async function (dataTable) {
  const state = await listing(this).readFilterOptions();
  expect(state.found, 'the Filters modal is not open').toBe(true);
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const group = row.group.trim();
    const mine = state.options.filter((o) => o.group.toLowerCase() === group.toLowerCase());
    const labels = mine.map((o) => o.label);
    const types = Array.from(new Set(mine.map((o) => o.type)));
    const wantLabels = splitList(row.options);
    const wantType = row.control.trim();
    report.push(`${group}: ${wantType} / ${JSON.stringify(labels)}`);
    if (!mine.length) { problems.push(`"${group}" offers no options at all.`); continue; }
    if (JSON.stringify(labels) !== JSON.stringify(wantLabels)) {
      problems.push(`"${group}" options: expected ${JSON.stringify(wantLabels)}, got ${JSON.stringify(labels)}`);
    }
    if (types.length !== 1 || types[0] !== wantType) {
      problems.push(
        `"${group}" control: expected every option to be a ${wantType}, got ${JSON.stringify(types)}. `
        + 'A group changing between checkbox and radio changes whether two options can be '
        + 'selected at once, so this is a behavioural change and not a styling one.',
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The candidate filter groups are not as specified.');
});

When('I select the candidate filter {string} under {string}', { timeout: 60000 }, async function (option, group) {
  await listing(this).selectFilterOption(group, option);
});

When('I apply the candidate filters', { timeout: 90000 }, async function () {
  remember(this, await listing(this).applyFilters());
});

When('I clear all candidate filters in the modal', { timeout: 90000 }, async function () {
  remember(this, await listing(this).clearAllInModal());
});

When('I cancel the candidate filters', { timeout: 60000 }, async function () {
  await listing(this).cancelFilters();
});

Then('no candidate filter option should be selected', async function () {
  const selected = await listing(this).selectedFilterOptions();
  expect(selected, `selected: ${JSON.stringify(selected)}`).toEqual([]);
});

// NOT 'the {string} option under {string} should be selected' - agent.js owns that phrase
// and Cucumber reported the pair as ambiguous. Renamed rather than widened: an ambiguous step
// counts as neither a pass nor a failure and is easy to miss in the summary.
Then('the candidate filter {string} under {string} should be selected', async function (option, group) {
  expect(await listing(this).isFilterOptionSelected(group, option)).toBe(true);
});

// The radio rule: not merely "the second is selected" but "the second is the ONLY one".
// Asserting the second alone would pass on a group that had become multi-select.
Then('the candidate filter {string} under {string} should be the only one selected', async function (option, group) {
  const state = await listing(this).readFilterOptions();
  const inGroup = state.options.filter((o) => o.group.toLowerCase() === String(group).trim().toLowerCase());
  const checked = inGroup.filter((o) => o.checked).map((o) => o.label);
  expect(
    checked,
    `"${group}" is a single-select group, so selecting a second option must replace the first. `
    + `Selected: ${JSON.stringify(checked)}`,
  ).toEqual([option]);
});

Then('the candidate filter modal should offer {string}, {string} and {string}', async function (a, b, c) {
  for (const label of [a, b, c]) {
    await expect(
      listing(this).filterDialog.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first(),
      `the Filters modal should offer "${label}"`,
    ).toBeVisible();
  }
});

Then('the candidate filter modal should still be open', async function () {
  expect(await listing(this).isFilterDialogOpen()).toBe(true);
});

Then('the candidate filter modal should not be visible', async function () {
  expect(await listing(this).isFilterDialogOpen()).toBe(false);
});

Then('the candidate filter modal should close via each of:', { timeout: 180000 }, async function (dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    const method = row.method.trim();
    await listing(this).openFilters();
    if (!(await listing(this).isFilterDialogOpen())) {
      problems.push(`could not reopen the Filters modal before testing "${method}"`);
      continue;
    }
    await listing(this).closeFilterDialogVia(method);
    if (await listing(this).isFilterDialogOpen()) problems.push(`"${method}" did not close the Filters modal`);
  }
  fail(problems, 'The Filters modal could not be dismissed by every documented means.');
});

Then('the candidate {string} button should show an applied-filter count of {int}', async function (label, n) {
  const actual = await listing(this).appliedFilterCount();
  expect(actual, `the "${label}" trigger reads ${JSON.stringify(await listing(this).filtersTriggerLabel())}`).toBe(n);
});

Then('the candidate {string} button should show no applied-filter count', async function (label) {
  const actual = await listing(this).appliedFilterCount();
  expect(actual, `the "${label}" trigger reads ${JSON.stringify(await listing(this).filtersTriggerLabel())}`).toBe(0);
});

// URL param AND API param, per option, collected. Reading only the URL would pass on a front
// end that rewrites the address bar and queries the server for something else.
Then('applying each candidate filter option should record itself in the URL and on the request:', { timeout: 900000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const { group, option } = { group: row.group.trim(), option: row.option.trim() };
    const [wantKey, wantValue] = row.param.trim().split('=');
    const [apiKey, apiValue] = row.apiParam.trim().split('=');

    await listing(this).goto('All');
    await listing(this).openFilters();
    await listing(this).selectFilterOption(group, option);
    const result = await listing(this).applyFilters();

    const url = new URL(this.page.url());
    const gotUrl = url.searchParams.getAll(wantKey);
    const request = result.requestUrl ? new URL(result.requestUrl) : null;
    const gotApi = request ? request.searchParams.getAll(apiKey) : [];

    report.push(
      `${group} / ${option}\n`
      + `    url  ${wantKey}=${JSON.stringify(gotUrl)}   (want ${JSON.stringify(wantValue)})\n`
      + `    api  ${apiKey}=${JSON.stringify(gotApi)}   (want ${JSON.stringify(apiValue)})\n`
      + `    request ${result.requestUrl || '(none)'}`,
    );
    if (!gotUrl.includes(wantValue)) {
      problems.push(`${group} / ${option}: URL should carry ${wantKey}=${wantValue}, actual URL ${this.page.url()}`);
    }
    if (!result.requestFired) {
      problems.push(`${group} / ${option}: applying the filter fired NO candidate-list request, so the server was never asked to filter.`);
    } else if (!gotApi.includes(apiValue)) {
      problems.push(
        `${group} / ${option}: the request should carry ${apiKey}=${apiValue}, actual request `
        + `${result.requestUrl}. The URL and the request can disagree, which is exactly what `
        + 'this row exists to catch.',
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidate filter did not record itself in the URL and on the request.');
});

// The four filters whose effect is re-derivable from the row payload. `status` and
// `emailVerified` come off the server's own answer, so this checks the RESULT of filtering
// rather than the app's claim to have filtered.
// >>> BOTH OF THESE PAIRS WERE WRONG ON THE FIRST FULL RUN, AND BOTH REPORTED A WORKING
// FILTER AS BROKEN. <<< Measured 2026-09-07 and corrected:
//
//   * `account_status` is **"Inactive"** in the payload where the grid renders
//     **"Deactivated"**. `CandidatesListingPage.statusIs()` accepts the pair; the original rule
//     matched only the rendered wording and reported all ten correctly-filtered rows as
//     violations.
//   * the Account Verification column and its filter both mean **`is_verified`**, NOT
//     `is_email_verified` - the two disagree on the same row (`is_verified: true` alongside
//     `is_email_verified: false`). The original rule read the email flag, so Verified "failed"
//     on a row that is verified and Unverified "failed" on ten rows that are.
//
// Confirmed live afterwards: `verification_status=verified` returns rows whose Account
// Verification cell reads "Verified", every one of them. The filter was never at fault.
const ROW_RULES = {
  active: {
    describe: 'account_status Active',
    test: (c) => CandidatesListingPage.statusIs(c, 'active'),
  },
  deactivated: {
    describe: 'account_status Deactivated (the API calls it "Inactive")',
    test: (c) => CandidatesListingPage.statusIs(c, 'deactivated'),
  },
  verified: { describe: 'is_verified true', test: (c) => c.verified === true },
  unverified: { describe: 'is_verified false', test: (c) => c.verified === false },
  'without pending documents': { describe: 'pending_documents_count 0', test: (c) => c.pendingDocuments === 0 },
};

Then('applying each of these candidate filters should return only candidates that satisfy it:', { timeout: 600000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const { group, option } = { group: row.group.trim(), option: row.option.trim() };
    const rule = ROW_RULES[row.rule.trim()];
    if (!rule) { problems.push(`No row rule is defined for "${row.rule}".`); continue; }

    await listing(this).goto('All');
    await listing(this).openFilters();
    await listing(this).selectFilterOption(group, option);
    const result = await listing(this).applyFilters();
    const rows = candidatesOf(result.payload);

    const offenders = rows.filter((c) => !rule.test(c));
    report.push(`${group} / ${option} (${rule.describe}): ${rows.length} returned, ${offenders.length} violating`);
    if (!rows.length) {
      // Reported, not passed over. A filter returning nothing proves nothing about whether it
      // filters correctly, and a step that says "0 rows, all of them satisfied the rule" is
      // the vacuous pass this repo has been bitten by before.
      problems.push(
        `${group} / ${option} returned NO candidates, so it could not be verified. The rule `
        + `(${rule.describe}) was neither confirmed nor refuted.`,
      );
      continue;
    }
    if (offenders.length) {
      problems.push(
        `${group} / ${option} returned ${offenders.length} candidate(s) failing ${rule.describe}: `
        + `${JSON.stringify(offenders.slice(0, 5).map((c) => ({ email: c.email, status: c.status, is_verified: c.verified, is_email_verified: c.emailVerified })))}`,
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidate filter returned candidates that do not satisfy it.');
});

Then('every candidate returned should be {string}', async function (ruleName) {
  const rule = ROW_RULES[String(ruleName).trim()];
  expect(rule, `No row rule is defined for "${ruleName}"`).toBeTruthy();
  const rows = await lastPayloadCandidates(this);
  expect(rows.length, 'the filter returned no candidates, so nothing was verified').toBeGreaterThan(0);
  const offenders = rows.filter((c) => !rule.test(c));
  expect(
    offenders.map((c) => ({ email: c.email, status: c.status, is_verified: c.verified, is_email_verified: c.emailVerified })),
    `expected every returned candidate to satisfy ${rule.describe}`,
  ).toEqual([]);
});

// Counting for the union assertion. The server's own `count` is used rather than the rendered
// rows: the page holds 10 at a time and the union of two buckets spans many pages.
When('I note the number of candidates matching {string} option {string}', { timeout: 180000 }, async function (group, option) {
  await listing(this).goto('All');
  await listing(this).openFilters();
  await listing(this).selectFilterOption(group, option);
  const result = await listing(this).applyFilters();
  const count = result.payload && typeof result.payload.count === 'number' ? result.payload.count : null;
  if (count === null) {
    throw new Error(
      `The candidate list response carried no \`count\` for ${group} "${option}", so the union `
      + 'assertion has no total to add up. Response keys: '
      + `${JSON.stringify(Object.keys(result.payload || {}))}`,
    );
  }
  this._notedCounts = this._notedCounts || [];
  this._notedCounts.push({ group, option, count });
  this.attach(`${group} "${option}" matches ${count} candidate(s)`, 'text/plain');
});

Then('the number of matching candidates should equal the sum of the two noted counts', async function () {
  const noted = this._notedCounts || [];
  expect(noted.length, `expected two noted counts, have ${noted.length}`).toBe(2);
  const want = noted[0].count + noted[1].count;
  const result = lastList(this);
  const got = result.payload && result.payload.count;
  this.attach(
    `${noted[0].option} ${noted[0].count} + ${noted[1].option} ${noted[1].count} = ${want}; union returned ${got}`,
    'text/plain',
  );
  expect(
    got,
    'two options in one CHECKBOX group should return the union of both. A number equal to one '
    + 'of the two means the second selection was ignored; a smaller one means they were '
    + 'intersected.',
  ).toBe(want);
});

// The applied-filter badge counts GROUPS, not options - a real divergence from the agents
// listing, reported rather than failed on. It runs AFTER the union arithmetic so a badge nit
// cannot cost the assertion that matters.
Then('the applied-filter count should be reported as counting groups rather than options', async function () {
  const label = await listing(this).filtersTriggerLabel();
  const selected = await (async () => {
    await listing(this).openFilters();
    const s = await listing(this).selectedFilterOptions();
    await listing(this).cancelFilters();
    return s;
  })();
  this.attach(
    'APPLIED-FILTER COUNT (for the PO, not a failure):\n'
    + `  options actually selected : ${JSON.stringify(selected)} (${selected.length})\n`
    + `  the trigger reads         : ${JSON.stringify(label)}\n`
    + '  Measured 2026-09-07: two options in ONE group read "Filters 1"; one option in each of\n'
    + '  two groups reads "Filters 2". So the badge counts GROUPS.\n'
    + '  The AGENTS listing counts OPTIONS - Agent-Search-Filters-View.feature asserts a count\n'
    + '  of 2 for two options in one group. The two listings therefore disagree about what the\n'
    + '  number means. "1 filter group applied" is a defensible reading and no AC settles it.',
    'text/plain',
  );
  expect(selected.length, 'the two options should still be selected when the modal is reopened')
    .toBeGreaterThan(1);
});

// Open the listing on a hand-typed query string - what a bookmark or a shared link does.
When('I open the Candidates listing at {string}', { timeout: 90000 }, async function (query) {
  const target = `${listing(this).url}${query}`;
  const result = await listing(this).runAndWaitForList(async () => {
    await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  });
  remember(this, result);
});

// >>> THE REMNANT OF THE OLD DEFECT: THE LISTING STILL OBEYS A `status` PARAM IT NO LONGER
// SHOWS. <<< Measured 2026-10-19: `/candidates?status=deactivated` sends is_active=false and
// lists only deactivated candidates, while the All tab is selected, the Filters button reads
// plain "Filters" and the modal has nothing checked. So the superadmin is looking at "All" and
// seeing a narrowed list with nothing on screen saying so.
//
// The rule asserted: if the request narrows by account status, the selected TAB must be the
// one that means that status. That goes green whichever way the product fixes it - drop the
// stale param (no is_active, All is right) or re-sync the tab to it (Deactivated selected).
Then('the candidate list should only be narrowed by account status where the tab says so', { timeout: 90000 }, async function () {
  const list = lastList(this);
  expect(list.requestFired, 'opening the listing fired no candidate-list request, so nothing was measured').toBe(true);
  const isActive = new URL(list.requestUrl).searchParams.get('is_active');
  const tab = await listing(this).currentTab();
  const badge = await listing(this).filtersTriggerLabel();
  await listing(this).openFilters();
  const checked = await listing(this).selectedFilterOptions();
  await listing(this).cancelFilters();
  const statuses = Array.from(new Set(candidatesOf(list.payload).map((c) => c.status).filter(Boolean)));
  const tabFor = { true: 'Active', false: 'Deactivated' };
  const wantTab = isActive === null ? 'All' : tabFor[isActive];

  this.attach(
    'ACCOUNT-STATUS NARROWING vs WHAT THE SCREEN SAYS:\n'
    + `  URL                   : ${this.page.url()}\n`
    + `  request               : ${list.requestUrl}\n`
    + `  is_active sent        : ${JSON.stringify(isActive)}\n`
    + `  statuses returned     : ${JSON.stringify(statuses)}\n`
    + `  selected tab          : ${JSON.stringify(tab)}\n`
    + `  Filters button        : ${JSON.stringify(badge)}\n`
    + `  options checked       : ${JSON.stringify(checked)}`,
    'text/plain',
  );
  expect(
    tab,
    `the request carries is_active=${JSON.stringify(isActive)} (rows: ${JSON.stringify(statuses)}), `
    + `which only the "${wantTab}" tab should mean - but the "${tab}" tab is selected, the Filters `
    + `button reads ${JSON.stringify(badge)} and the modal has ${checked.length} option(s) checked. `
    + 'The list is narrowed by a filter nothing on screen shows. See the attachment; ask the PO '
    + 'whether the stale `status` param should be ignored or the tab re-synced to it.',
  ).toBe(wantTab);
});

// ==================== Pagination ====================

Then('the candidate pagination controls should be visible', async function () {
  expect(await listing(this).hasPagination(), 'no pagination controls are on screen').toBe(true);
  this.attach(`Pagination: ${await listing(this).paginationText()}`, 'text/plain');
});

Then('the candidate {string} control should be disabled on the first page', async function (label) {
  const control = /previous/i.test(label) ? listing(this).prevButton() : listing(this).nextButton();
  expect(await control.isDisabled(), `"${label}" should be disabled on page 1`).toBe(true);
});

Then('the candidate {string} control should be enabled', async function (label) {
  const control = /previous/i.test(label) ? listing(this).prevButton() : listing(this).nextButton();
  expect(await control.isDisabled(), `"${label}" should be enabled`).toBe(false);
});

When('I note the candidates listed on the current page', async function () {
  this._notedPage = (await lastPayloadCandidates(this)).map((c) => c.email);
  expect(this._notedPage.length, 'the current page listed no candidates').toBeGreaterThan(0);
  this.attach(`Page 1: ${JSON.stringify(this._notedPage)}`, 'text/plain');
});

When('I go to the next candidates page', { timeout: 90000 }, async function () {
  remember(this, await listing(this).goToNextPage());
});

When('I go to the previous candidates page', { timeout: 90000 }, async function () {
  remember(this, await listing(this).goToPrevPage());
});

When('I go to candidates page {int}', { timeout: 90000 }, async function (n) {
  remember(this, await listing(this).goToPageNumber(n));
});

Then('none of the previously noted candidates should be listed again', async function () {
  const now = (await lastPayloadCandidates(this)).map((c) => c.email);
  const repeated = now.filter((e) => (this._notedPage || []).includes(e));
  this.attach(`Page 2: ${JSON.stringify(now)}`, 'text/plain');
  expect(repeated, 'these candidates appeared on both pages').toEqual([]);
});

// Compared as a SET. Page 1 is noted from the server's answer and, on the way back, re-rendered
// from the app's cache and read off the grid - which re-sorts rows (its own @known-issue in
// Candidate-Listing-Edge-Cases.feature). Order is that scenario's subject, not this one's.
Then('the candidates listed should match the first page again', async function () {
  const now = (await lastPayloadCandidates(this)).map((c) => c.email);
  expect(now.slice().sort(), `page 1 was ${JSON.stringify(this._notedPage)}, now ${JSON.stringify(now)}`)
    .toEqual((this._notedPage || []).slice().sort());
});

// ==================== View - the candidate drawer ====================

When('I view that candidate', { timeout: 120000 }, async function () {
  const c = subject(this);
  // Armed BEFORE the click: the profile fetch happens as the drawer opens, and Candidate
  // Details and Documents both read that one payload rather than querying on selection. See
  // armOpeningWatch() in CandidateDetailPanelPage.
  panel(this).armOpeningWatch();
  await listing(this).openCandidatePanel(c.email);
  await panel(this).waitForOpen();
  this._panelOpeningRequests = panel(this).disarmOpeningWatch();
  this.attach(`Requests fired while the drawer opened:\n  ${this._panelOpeningRequests.join('\n  ') || '(none)'}`, 'text/plain');
});

Then('the candidate panel should be displayed', async function () {
  expect(await panel(this).isOpen(), 'the candidate drawer is not on screen').toBe(true);
  this.attach(JSON.stringify(await panel(this).snapshot(), null, 2), 'text/plain');
});

// Absence is watched over a WINDOW, not sampled once: a "not visible" read is also true of a
// drawer the app has not rendered yet, so a single check on a settling page reports "closed"
// for one that appears a second later.
Then('the candidate panel should not be displayed', async function () {
  const state = await panel(this).staysClosed({ windowMs: 3000 });
  expect(state.closed, `the drawer was still (or again) on screen after ${state.at}ms`).toBe(true);
});

Then("the candidate panel should show that candidate's name", async function () {
  const c = subject(this);
  const header = await panel(this).readHeader();
  expect(header, 'the drawer rendered no header').not.toBeNull();
  this.attach(`Drawer header: ${JSON.stringify(header, null, 2)}`, 'text/plain');
  expect(
    header.headerText,
    `the drawer should be showing ${c.name}. Opening the wrong candidate is the failure mode `
    + 'here - a drawer that always renders the first row reads as "the candidate sees the wrong '
    + 'status", which is a defect the product does not have.',
  ).toContain(c.name);
});

Then('the candidate panel tabs should be:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const got = await panel(this).tabNames();
  expect(got, `tabs in the drawer: ${JSON.stringify(got)}`).toEqual(want);
});

Then('the {string} candidate panel tab should be the selected tab', async function (tab) {
  expect(await panel(this).selectedTab()).toBe(tab);
});

When('I open the {string} candidate panel tab', { timeout: 90000 }, async function (tab) {
  this._panelTab = await panel(this).openTab(tab);
  this.attach(
    `${tab}: request ${this._panelTab.requestUrl || '(none)'} -> ${this._panelTab.status === null ? 'no response' : this._panelTab.status}`,
    'text/plain',
  );
});

Then('the candidate panel should show the summary figures:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const kpis = await panel(this).readKpis();
  const captions = kpis.map((k) => k.caption);
  this.attach(`Summary figures: ${JSON.stringify(kpis, null, 2)}`, 'text/plain');
  const missing = want.filter((w) => !captions.includes(w));
  expect(
    missing,
    `the drawer's summary figures are ${JSON.stringify(captions)}. Note each figure renders an `
    + 'em dash until its payload lands, so a missing CAPTION is the finding here - a dash is a '
    + 'placeholder, not an absence.',
  ).toEqual([]);
});

Then('the candidate panel should offer no Back control', async function () {
  const header = await panel(this).readHeader();
  const back = header.buttons.filter((b) => /^back$/i.test(b));
  expect(
    back,
    'the drawer has no route, so a Back control would have nowhere to go. If one has appeared, '
    + 'the product has probably gained a route for this view - see CandidateDetailPanelPage.',
  ).toEqual([]);
});

Then('the candidate panel should offer no lifecycle action', async function () {
  const header = await panel(this).readHeader();
  const lifecycle = header.buttons.filter((b) => /deactivate|reactivate|log in as/i.test(b));
  this.attach(`Drawer controls: ${JSON.stringify(header.buttons)}`, 'text/plain');
  expect(
    lifecycle,
    'measured 2026-09-07 the drawer offers Close and its five tabs and nothing else - every '
    + 'lifecycle action lives on the listing row. A control appearing here is a real change, '
    + 'and it would need its own coverage.',
  ).toEqual([]);
});

When('I close the candidate panel', { timeout: 60000 }, async function () {
  await panel(this).close();
});

Then('the candidate panel should close via each of:', { timeout: 180000 }, async function (dataTable) {
  const c = subject(this);
  const problems = [];
  for (const row of dataTable.hashes()) {
    const method = row.method.trim();
    await listing(this).goto('All');
    await listing(this).search(c.email, { tab: 'All' });
    await listing(this).openCandidatePanel(c.email);
    await panel(this).waitForOpen();
    const closed = await panel(this).closeVia(method);
    if (!closed) problems.push(`"${method}" did not close the candidate drawer`);
  }
  fail(problems, 'The candidate drawer could not be dismissed by every documented means.');
});

// Each tab against the request it fires. A tab rendering its empty copy because its request
// never went out is indistinguishable on screen from a candidate who genuinely has nothing -
// and those are opposite findings.
Then('each candidate panel tab should open and query its own endpoint:', { timeout: 240000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  const allTabs = await panel(this).tabNames();
  for (const row of dataTable.hashes()) {
    const tab = row.tab.trim();
    const endpoint = (row.endpoint || '').trim();
    // >>> CLICKING THE TAB THAT IS ALREADY SELECTED FIRES NOTHING, AND THAT IS CORRECT. <<<
    // The drawer opens ON Candidate Details and fetches the profile while it opens, so by the
    // time this table reaches that row the tab is already current and the click is a no-op.
    // Measured, the first run reported "Candidate Details fired no request" - a true statement
    // about a working panel, and a misleading one about the product.
    //
    // So the tab is genuinely OPENED: if it is already current, move away first. What this
    // step asserts is unchanged - opening a tab queries its own endpoint - and it is now
    // actually exercised rather than assumed from the panel's own opening fetch.
    if ((await panel(this).selectedTab()) === tab) {
      const other = allTabs.find((t) => t !== tab);
      if (other) await panel(this).openTab(other);
    }
    const result = await panel(this).openTab(tab);
    const selected = await panel(this).selectedTab();
    report.push(
      `${tab}: selected ${JSON.stringify(selected)}, request ${result.requestUrl || '(none)'}`
      + `${result.status === null ? '' : ` -> ${result.status}`}`,
    );
    if (selected !== tab) problems.push(`clicking "${tab}" left "${selected}" selected`);
    if (!endpoint) {
      // Candidate Details and Documents deliberately fire nothing: both read the profile
      // payload the drawer fetched when it OPENED, and re-selecting them does not re-query.
      // Measured, so recorded as intended rather than reported as a missing call. The opening
      // fetch itself is asserted by the next step, which is where it really happens.
      if (result.requestFired) {
        problems.push(
          `"${tab}" fired ${result.requestUrl} on selection. Measured 2026-09-07 it fires `
          + 'nothing and reads the payload fetched when the drawer opened - so this is a change '
          + 'in how the panel loads, not a failure. Confirm it is intended and update the table.',
        );
      }
      continue;
    }
    if (!result.requestFired) {
      problems.push(`"${tab}" fired no request, so its content cannot be trusted to be this candidate's.`);
    } else if (!result.requestUrl.includes(endpoint)) {
      problems.push(`"${tab}" should query ${endpoint}, actually queried ${result.requestUrl}`);
    } else if (result.status >= 500) {
      problems.push(`"${tab}" queried ${endpoint} and the server answered ${result.status}`);
    }
    // A 404 from /tracks/candidate/ or /subscription/current/ is the app's NORMAL answer for a
    // candidate with no track or no subscription, and the panel renders its own copy for it.
    // Treating it as a failure would report every unsubscribed candidate as broken.
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidate panel tab did not open and query its own endpoint.');
});

// The profile fetch, asserted where it actually happens. This is what proves the drawer is
// showing the candidate whose row was clicked - the failure mode being a panel that always
// renders the first row, which reads as "the superadmin is shown the wrong status" and is a
// defect the product does not have. The document-verification module was caught by exactly
// that, so the id in the URL is checked, not merely the path.
Then('opening the drawer should have fetched that candidate\'s profile', async function () {
  const fired = this._panelOpeningRequests || [];
  const profile = fired.find((u) => /\/candidate\/profile\/\d+\//.test(u));
  this.attach(`Requests fired while the drawer opened:\n  ${fired.join('\n  ') || '(none)'}`, 'text/plain');
  expect(
    profile,
    'the drawer opened without fetching /candidate/profile/<id>/, so whatever it is rendering '
    + `did not come from this candidate's record. Requests seen: ${JSON.stringify(fired)}`,
  ).toBeTruthy();
  const id = (profile.match(/\/candidate\/profile\/(\d+)\//) || [])[1];
  const c = subject(this);
  if (c.id !== undefined && c.id !== null) {
    expect(
      String(id),
      `the drawer fetched profile ${id} but the row clicked was ${c.email} (id ${c.id})`,
    ).toBe(String(c.id));
  }
});

Then('the candidate details tab should show the sections:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const details = await panel(this).readCandidateDetails();
  expect(details, 'the Candidate Details tab rendered nothing').not.toBeNull();
  this.attach(JSON.stringify(details, null, 2), 'text/plain');
  const missing = want.filter((w) => !details.titles.includes(w));
  expect(missing, `sections on screen: ${JSON.stringify(details.titles)}`).toEqual([]);
});

Then('every empty section should explain itself rather than render blank', async function () {
  const details = await panel(this).readCandidateDetails();
  const problems = [];
  details.sections.forEach((s) => {
    if (!s.text) {
      problems.push(
        `"${s.title}" rendered completely blank. An unset section must say so - a blank one `
        + 'is indistinguishable from a section that failed to load.',
      );
    }
  });
  this.attach(
    details.sections.map((s) => `${s.title}: ${s.empty ? 'EMPTY' : 'populated'} - ${s.text.slice(0, 120)}`).join('\n'),
    'text/plain',
  );
  fail(problems, 'A section of Candidate Details rendered blank.');
});

// A candidate with real uploads. Found by SEARCHING rather than by scanning page 1 of 214, and
// it reports what it inspected when it cannot find one rather than passing silently.
Given('I have found a candidate holding uploaded documents', { timeout: 300000 }, async function () {
  const tried = [];
  // Pending Documents 1-2 and 3+ are the app's own way of naming candidates that have
  // uploaded something, so the search is aimed rather than exhaustive.
  for (const option of ['1-2', '3+']) {
    await listing(this).goto('All');
    await listing(this).openFilters();
    await listing(this).selectFilterOption('Pending Documents', option);
    const result = await listing(this).applyFilters();
    const rows = candidatesOf(result.payload);
    for (const row of rows.slice(0, 4)) {
      await listing(this).goto('All');
      await listing(this).search(row.email, { tab: 'All' });
      await listing(this).openCandidatePanel(row.email);
      await panel(this).waitForOpen();
      await panel(this).openTab('Documents');
      const docs = await panel(this).readDocuments();
      const files = docs ? docs.groups.reduce((n, g) => n + g.files.length, 0) : 0;
      tried.push(`${row.email} (Pending Documents ${option}): ${files} document(s)`);
      await panel(this).closeVia('Escape');
      if (files > 0) {
        noteCandidate(this, row, `Holds ${files} document(s).\nInspected:\n  ${tried.join('\n  ')}`);
        return;
      }
    }
  }
  throw new Error(
    'No candidate holding an uploaded document could be found.\n\nInspected:\n  '
    + `${tried.join('\n  ')}\n\nThis is a FIXTURE problem, not a product one - the Documents tab `
    + 'cannot be verified against a candidate who has uploaded nothing.',
  );
});

Then('the documents tab should group documents under:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const docs = await panel(this).readDocuments();
  expect(docs, 'the Documents tab rendered nothing').not.toBeNull();
  this.attach(JSON.stringify(docs, null, 2), 'text/plain');
  const missing = want.filter((w) => !docs.groups.find((g) => g.group === w && g.present));
  expect(missing, `groups on screen: ${JSON.stringify(docs.groups.map((g) => g.group))}`).toEqual([]);
});

Then('every listed document should carry a file name, a status and an upload date', async function () {
  const docs = await panel(this).readDocuments();
  const problems = [];
  let seen = 0;
  docs.groups.forEach((g) => {
    g.files.forEach((f) => {
      seen += 1;
      if (!f.name) problems.push(`${g.group}: a document has no file name (${JSON.stringify(f.raw)})`);
      if (!f.status) problems.push(`${g.group}: ${f.name || 'a document'} has no status`);
      if (!f.uploadedOn) problems.push(`${g.group}: ${f.name || 'a document'} has no upload date`);
    });
  });
  this.attach(
    docs.groups.map((g) => `${g.group}: ${g.empty ? 'empty' : JSON.stringify(g.files)}`).join('\n'),
    'text/plain',
  );
  expect(seen, 'no documents were listed at all, so nothing was verified').toBeGreaterThan(0);
  fail(problems, 'A listed document is missing part of its record.');
});

Then('a group with no documents should say so', async function () {
  const docs = await panel(this).readDocuments();
  const problems = [];
  docs.groups.forEach((g) => {
    if (g.present && !g.files.length && !g.empty) {
      problems.push(
        `"${g.group}" listed no documents and did not say why. Its text was `
        + `${JSON.stringify(g.text)} - a group that renders neither documents nor an `
        + 'explanation is indistinguishable from one that failed to load.',
      );
    }
  });
  fail(problems, 'A document group with nothing in it rendered no explanation.');
});

Then('the subscription tab should either detail the plan or state there is none', async function () {
  const sub = await panel(this).readSubscription();
  expect(sub, 'the Subscription tab rendered nothing').not.toBeNull();
  this._subscription = sub;
  this.attach(JSON.stringify(sub, null, 2), 'text/plain');
  expect(
    Boolean(sub.heading) || sub.none,
    `the tab rendered neither "Subscription Details" nor the no-subscription message. Body: `
    + `${JSON.stringify(sub.body)}`,
  ).toBe(true);
});

Then('a detailed subscription should show the fields:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const sub = this._subscription || await panel(this).readSubscription();
  if (sub.none) {
    // Not a skip and not a vacuous pass: the state is stated in the report so a reader knows
    // which of the two branches ran and that the field list went unchecked for this candidate.
    this.attach(
      'This candidate has NO subscription, so the field list was not applicable. The endpoint '
      + 'answers 404 in this state and the panel renders its own copy - both correct. The '
      + 'populated shape is asserted whenever the subject does hold a subscription.',
      'text/plain',
    );
    return;
  }
  const missing = want.filter((w) => !sub.fieldsPresent.includes(w));
  expect(missing, `fields on screen: ${JSON.stringify(sub.fieldsPresent)} with values ${JSON.stringify(sub.fields)}`).toEqual([]);
});

Then('the activity log should offer the candidate periods:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const log = await panel(this).readActivityLog();
  expect(log, 'the Activity Log tab rendered nothing').not.toBeNull();
  this.attach(JSON.stringify(log, null, 2), 'text/plain');
  expect(log.periods, `periods on screen: ${JSON.stringify(log.periods)}`).toEqual(want);
});

Then('{string} should be the period it opens on', async function (expected) {
  const log = await panel(this).readActivityLog();
  expect(log.selectedPeriod).toBe(expected);
});

// The options alone would pass on a selector wired to nothing, so each is checked against the
// `duration` the panel actually sends.
Then('selecting each period should re-query the server for that duration:', { timeout: 240000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const period = row.period.trim();
    const duration = row.duration.trim();
    const result = await panel(this).selectActivityPeriod(period);
    const sent = result.requestUrl ? new URL(result.requestUrl).searchParams.get('duration') : null;
    report.push(`${period} -> duration=${JSON.stringify(sent)} (want ${JSON.stringify(duration)})`);
    if (!result.requestFired) {
      problems.push(`choosing "${period}" fired no activity-log request, so the selector changed nothing.`);
    } else if (sent !== duration) {
      problems.push(`choosing "${period}" sent duration=${JSON.stringify(sent)}, expected ${JSON.stringify(duration)}`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'An Activity Log period did not re-query the server for its own duration.');
});

// The un-assessed copy is the rule; the populated shape has never been observed on this
// environment, so it is REPORTED if found rather than pinned to a shape nobody has measured.
Then("the track progress tab should report the candidate's assessment state", async function () {
  const track = await panel(this).readTrackProgress();
  expect(track, 'the Track Progress tab rendered nothing').not.toBeNull();
  this.attach(JSON.stringify(track, null, 2), 'text/plain');
  if (track.noAssessment) {
    expect(track.body).toContain("hasn't completed the psychometric assessment");
    return;
  }
  this.attach(
    'FIRST OBSERVATION OF A POPULATED TRACK PROGRESS TAB. No candidate on this environment had '
    + 'completed the psychometric assessment when this scenario was written, so the populated '
    + 'shape was deliberately left unpinned. What it rendered is above - turn it into a real '
    + 'assertion now that a fixture exists.',
    'text/plain',
  );
  expect(
    track.body,
    'the tab rendered neither the un-assessed message nor any content at all, which is a third '
    + 'state and a defect: the superadmin is shown an empty panel with no explanation.',
  ).not.toBe('');
});

// Opening the drawer from every tab, checking the IDENTITY each time.
Then('View should open the correct candidate from each of these tabs:', { timeout: 300000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const tab = row.tab.trim();
    const result = await listing(this).runAndWaitForList(async () => { await listing(this).goto(tab); });
    const rows = candidatesOf(result.payload);
    if (!rows.length) { problems.push(`the "${tab}" tab listed no candidates, so View could not be exercised.`); continue; }
    const [want] = rows;
    await listing(this).openCandidatePanel(want.email);
    await panel(this).waitForOpen();
    const header = await panel(this).readHeader();
    const tabs = await panel(this).tabNames();
    report.push(`${tab}: asked for ${want.name} <${want.email}>, drawer header ${JSON.stringify(header.headerText.slice(0, 80))}`);
    if (!header.headerText.includes(want.name)) {
      problems.push(`"${tab}": View was clicked for ${want.name} but the drawer shows ${JSON.stringify(header.headerText.slice(0, 120))}`);
    }
    if (tabs.length !== 5) {
      problems.push(`"${tab}": the drawer offered ${tabs.length} tab(s) (${JSON.stringify(tabs)}) instead of five.`);
    }
    await panel(this).closeVia('Escape');
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'View did not open the correct candidate from every tab.');
});

// ==================== Deactivate ====================

When('I open the Deactivate dialog for that candidate', { timeout: 120000 }, async function () {
  const c = subject(this);
  await listing(this).openDeactivateDialog(c.email);
  this._deactivateState = await listing(this).readDeactivateDialog();
});

When('I cancel the Deactivate dialog for that candidate', { timeout: 60000 }, async function () {
  await listing(this).cancelDeactivateDialog();
});

Then('the deactivate candidate dialog heading should be {string}', async function (expected) {
  const state = await listing(this).readDeactivateDialog();
  expect(state, 'the Deactivate dialog is not open').not.toBeNull();
  this.attach(JSON.stringify(state, null, 2), 'text/plain');
  expect(state.heading).toBe(expected);
});

Then('the deactivate candidate dialog should name that candidate', async function () {
  const c = subject(this);
  const state = await listing(this).readDeactivateDialog();
  expect(
    state.text,
    `the dialog must name who is about to be deactivated. It reads ${JSON.stringify(state.text.slice(0, 200))}`,
  ).toContain(c.name);
});

// The consequences as a SET. One long string would break on any re-wording of any bullet and
// could not say which promise had gone.
Then('the deactivate candidate dialog should promise:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const state = await listing(this).readDeactivateDialog();
  const haystack = state.bullets.length ? state.bullets.join(' | ') : state.text;
  const problems = want
    .filter((w) => !haystack.toLowerCase().includes(w.toLowerCase()))
    .map((w) => `the dialog does not promise ${JSON.stringify(w)}`);
  this.attach(`Bullets: ${JSON.stringify(state.bullets, null, 2)}\nFull text: ${state.text}`, 'text/plain');
  fail(problems, 'The Deactivate dialog does not state what deactivation will do.');
});

Then('the deactivate candidate dialog should ask for a reason', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(state.reasons, 'the dialog offers no reason control at all').toBeTruthy();
  expect(state.reasonLabel, `the reason control carries no label. Dialog text: ${state.text}`).toMatch(/reason for deactivation/i);
});

Then('the deactivate candidate confirm button should be labelled {string}', async function (expected) {
  const state = await listing(this).readDeactivateDialog();
  expect(state.confirmLabel).toBe(expected);
});

Then('the deactivate candidate confirm button should be disabled', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(
    state.confirmDisabled,
    `confirm is enabled while the dialog holds reason=${JSON.stringify(state.selectedReason)} `
    + `freeText=${JSON.stringify(state.freeTextValue)}`,
  ).toBe(true);
});

Then('the deactivate candidate confirm button should be enabled', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(
    state.confirmDisabled,
    `confirm is disabled while the dialog holds reason=${JSON.stringify(state.selectedReason)} `
    + `freeText=${JSON.stringify(state.freeTextValue)}`,
  ).toBe(false);
});

Then('the deactivate candidate dialog should not be visible', async function () {
  await expect(listing(this).deactivateDialog).toBeHidden();
});

Then('the deactivation reasons offered should be:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const state = await listing(this).readDeactivateDialog();
  expect(state.reasons, 'the dialog offers no reason control').toBeTruthy();
  // The placeholder option (value "") is the "Select reason" prompt, not a reason.
  const offered = state.reasons.filter((r) => r.value).map((r) => r.label);
  this.attach(`Reasons: ${JSON.stringify(state.reasons, null, 2)}`, 'text/plain');
  expect(offered, `reasons on screen: ${JSON.stringify(offered)}`).toEqual(want);
});

Then('no deactivation reason should be selected to begin with', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(
    state.selectedReason,
    'the dialog opened with a reason already chosen. A retained reason is how an account gets '
    + 'deactivated for the wrong stated cause - the superadmin reopens the dialog, sees a '
    + 'reason already there, and confirms.',
  ).toBe('');
});

When('I choose the deactivation reason {string}', { timeout: 60000 }, async function (reason) {
  await listing(this).selectDeactivationReason(reason);
  this._deactivateState = await listing(this).readDeactivateDialog();
});

When('I clear the deactivation reason', { timeout: 60000 }, async function () {
  // Back to the placeholder option, which is what "no reason chosen" is in this control.
  await listing(this).deactivateDialog.locator('select').first().selectOption('');
  await this.page.waitForTimeout(700);
});

Then('the deactivate candidate dialog should ask me to specify the reason', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(state.freeTextShown, 'no free-text reason field appeared').toBe(true);
  this.attach(
    `Free-text field: placeholder ${JSON.stringify(state.freeTextPlaceholder)}\n`
    + `Dialog text: ${state.text}`,
    'text/plain',
  );
  expect(state.text).toMatch(/please specify reason/i);
});

Then('the deactivate candidate dialog should not ask me to specify the reason', async function () {
  const state = await listing(this).readDeactivateDialog();
  expect(state.freeTextShown, `a free-text field is on screen holding ${JSON.stringify(state.freeTextValue)}`).toBe(false);
});

When('I type {string} as the free-text reason', { timeout: 60000 }, async function (text) {
  await listing(this).fillOtherReason(text);
});

// Every reason's gate, collected. Six consecutive Then steps would only ever show whichever
// reason broke first, and the interesting one ("Other") is last.
Then('each deactivation reason should gate confirmation as follows:', { timeout: 180000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const reason = row.reason.trim();
    const wantMore = /^yes$/i.test(row.asksForMore.trim());
    const wantEnabled = /^yes$/i.test(row.confirmEnabled.trim());
    await listing(this).selectDeactivationReason(reason);
    const state = await listing(this).readDeactivateDialog();
    report.push(
      `${reason}: asksForMore=${state.freeTextShown} confirmEnabled=${state.confirmDisabled === false}`,
    );
    if (state.freeTextShown !== wantMore) {
      problems.push(
        `"${reason}": expected asksForMore=${wantMore}, got ${state.freeTextShown}. `
        + 'Only "Other" should reveal a second field.',
      );
    }
    if ((state.confirmDisabled === false) !== wantEnabled) {
      problems.push(
        `"${reason}": expected confirm ${wantEnabled ? 'enabled' : 'disabled'}, got `
        + `${state.confirmDisabled === false ? 'enabled' : 'disabled'}.`,
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The deactivation reasons do not gate confirmation as specified.');
});

// The free-text gate. Whitespace alone must not satisfy a required explanation - the classic
// edge case, and this build gets it right.
Then('the free-text reason should refuse each of these and accept the last:', { timeout: 180000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    // >>> A GHERKIN TABLE CELL IS TRIMMED. <<< So "   " written in the feature file arrives
    // here as "", and the whitespace row and the empty row would be the identical test - the
    // scenario would claim to cover a case it never sent, which is the exact-10MB-fixture
    // lesson in miniature. `<spaces>` is the sentinel, mapped here and named in the report.
    const raw = row.text === undefined ? '' : String(row.text);
    const text = raw === '<spaces>' ? '   ' : raw;
    const wantAccepted = /^yes$/i.test(String(row.accepted).trim());
    await listing(this).fillOtherReason(text);
    const state = await listing(this).readDeactivateDialog();
    const accepted = state.confirmDisabled === false;
    report.push(`${JSON.stringify(text)}${raw === '<spaces>' ? ' (from <spaces>)' : ''} -> confirm ${accepted ? 'ENABLED' : 'disabled'}`);
    if (accepted !== wantAccepted) {
      problems.push(
        `free-text ${JSON.stringify(text)}: expected confirm ${wantAccepted ? 'enabled' : 'disabled'}, `
        + `got ${accepted ? 'enabled' : 'disabled'}. A required explanation must not be `
        + 'satisfied by whitespace.',
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The free-text deactivation reason does not gate confirmation correctly.');
});

// All three exits, and the candidate's state re-read from the SERVER after each - not from the
// row left on screen, which is the previous query's render.
Then('leaving the Deactivate dialog by each of these should change nothing:', { timeout: 300000 }, async function (dataTable) {
  const c = subject(this);
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const method = row.method.trim();
    await listing(this).goto('All');
    await listing(this).search(c.email, { tab: 'All' });
    await listing(this).openDeactivateDialog(c.email);
    // A reason is chosen first on purpose: abandoning a dialog that could have been submitted
    // is the state worth testing. Abandoning one whose confirm button was disabled anyway
    // proves much less.
    await listing(this).selectDeactivationReason('Temporary hold');
    if (method.toLowerCase() === 'cancel') await listing(this).cancelDeactivateDialog();
    else if (method.toLowerCase() === 'x icon') await listing(this).closeDeactivateDialogWithIcon();
    else if (method.toLowerCase() === 'escape') {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1200);
    } else problems.push(`unknown exit "${method}"`);

    if (await listing(this).deactivateDialog.isVisible().catch(() => false)) {
      problems.push(`"${method}" did not close the Deactivate dialog`);
    }
    const after = await listing(this).findCandidateOnTab('All', c.email, { timeout: 30000 });
    report.push(`${method}: status afterwards ${after ? after.status : 'NOT FOUND'}`);
    if (!after) problems.push(`after "${method}" the candidate could not be found at all.`);
    else if (!/^active$/i.test(String(after.status))) {
      problems.push(`after "${method}" the server reports ${c.email} as ${JSON.stringify(after.status)} - abandoning the dialog changed the account.`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'Abandoning the Deactivate dialog did not leave the candidate untouched.');
});

// ==================== Reactivate ====================

When('I open the Reactivate dialog for that candidate', { timeout: 120000 }, async function () {
  const c = subject(this);
  await listing(this).openReactivateDialog(c.email);
});

When('I cancel the Reactivate dialog for that candidate', { timeout: 60000 }, async function () {
  await listing(this).cancelReactivateDialog();
});

Then('the reactivate candidate dialog heading should be {string}', async function (expected) {
  const state = await listing(this).readReactivateDialog();
  expect(state, 'the Reactivate dialog is not open').not.toBeNull();
  this.attach(JSON.stringify(state, null, 2), 'text/plain');
  expect(state.heading).toBe(expected);
});

Then('the reactivate candidate dialog should name that candidate and their email', async function () {
  const c = subject(this);
  const state = await listing(this).readReactivateDialog();
  const problems = [];
  if (!state.text.includes(c.name)) problems.push(`the dialog does not name ${c.name}`);
  if (!state.emails.map((e) => e.toLowerCase()).includes(String(c.email).toLowerCase())) {
    problems.push(`the dialog does not show ${c.email}; it shows ${JSON.stringify(state.emails)}`);
  }
  fail(problems, 'The Reactivate dialog does not identify the candidate it is about.');
});

Then('the reactivate candidate dialog should say the candidate regains access instantly', async function () {
  const state = await listing(this).readReactivateDialog();
  expect(state.text).toMatch(/regain access .*instantly|instantly/i);
});

Then('the reactivate candidate dialog should say a reactivation email will be sent', async function () {
  const state = await listing(this).readReactivateDialog();
  expect(state.text).toMatch(/re-?activation email will be sent/i);
});

Then('the reactivate candidate dialog should offer {string} and {string}', async function (a, b) {
  const state = await listing(this).readReactivateDialog();
  const problems = [a, b]
    .filter((label) => !state.buttons.some((x) => x.toLowerCase() === label.toLowerCase()))
    .map((label) => `the dialog does not offer "${label}"; it offers ${JSON.stringify(state.buttons)}`);
  fail(problems, 'The Reactivate dialog does not offer both controls.');
});

Then('the reactivate candidate dialog should ask for no reason', async function () {
  const state = await listing(this).readReactivateDialog();
  this.attach(
    `Reactivate dialog fields: ${state.fields}\n`
    + 'Deactivating is gated on a stated reason; reactivating is gated on nothing. That '
    + 'asymmetry is asserted deliberately - it is defensible, and it is exactly the sort of '
    + 'thing that gets "tidied" into consistency by accident.',
    'text/plain',
  );
  expect(state.fields, 'the Reactivate dialog rendered an input, select or textarea').toBe(0);
});

Then('the reactivate candidate confirm button should be enabled', async function () {
  const state = await listing(this).readReactivateDialog();
  expect(state.confirmDisabled, 'the Reactivate confirm button is disabled on open').toBe(false);
});

Then('the reactivate candidate dialog should not be visible', async function () {
  await expect(listing(this).reactivateDialog).toBeHidden();
});

// ==================== Which action each tab offers ====================

Then('each candidates tab should offer only the lifecycle action that applies:', { timeout: 240000 }, async function (dataTable) {
  const problems = [];
  const report = [];
  for (const row of dataTable.hashes()) {
    const tab = row.tab.trim();
    const offers = row.offers.trim();
    const withholds = row.withholds.trim();
    await listing(this).goto(tab);
    const rows = await listing(this).readRows();
    if (!rows.length) { problems.push(`the "${tab}" tab listed no rows.`); continue; }
    const actions = rows[0].actions;
    report.push(`${tab}: ${JSON.stringify(actions)}`);
    if (!actions.some((a) => a.toLowerCase() === offers.toLowerCase())) {
      problems.push(`"${tab}" should offer "${offers}" but offers ${JSON.stringify(actions)}`);
    }
    if (actions.some((a) => a.toLowerCase() === withholds.toLowerCase())) {
      problems.push(
        `"${tab}" should NOT offer "${withholds}" but does. On a deactivated row that would let `
        + 'a superadmin deactivate an account that already is, and the app\'s answer to that is '
        + 'unknown.',
      );
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A candidates tab offers a lifecycle action that does not apply to it.');
});

// Rendered AND disabled, across every row on the tab - not just the one the scenario noted.
// A single-row check could not tell "this candidate cannot be edited" from "no deactivated
// candidate can be", and those are different rules.
Then('every Deactivated row\'s {string} action should be disabled', async function (action) {
  const state = await this.page.evaluate((label) => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'))
      .map((r) => {
        const header = r.querySelector('[role="rowheader"]');
        const email = (c(header && header.innerText).match(/[^\s@]+@[^\s@]+/) || [''])[0];
        const btn = Array.from(r.querySelectorAll('button'))
          .find((b) => (b.getAttribute('aria-label') || '').toLowerCase() === String(label).toLowerCase());
        return { email, present: Boolean(btn), disabled: btn ? btn.disabled : null };
      });
  }, action);
  this.attach(JSON.stringify(state, null, 2), 'text/plain');
  const problems = [];
  if (!state.length) problems.push('no rows were on screen, so nothing was checked');
  state.forEach((r) => {
    if (!r.present) problems.push(`${r.email}: no "${action}" control at all`);
    else if (r.disabled !== true) {
      problems.push(
        `${r.email}: "${action}" is ENABLED. Measured 2026-09-07 it is disabled on every `
        + 'deactivated row - if that has changed, the email of a deactivated candidate can now '
        + 'be edited, which is a rule change and needs its own coverage.',
      );
    }
  });
  fail(problems, `The "${action}" action is not uniformly disabled on the Deactivated tab.`);
});

Then('that candidate\'s row should offer the {string} action', async function (action) {
  const c = subject(this);
  const actions = await listing(this).rowActions(c.email);
  expect(
    actions.map((a) => a.toLowerCase()),
    `${c.email}'s row offers ${JSON.stringify(actions)}. Note the AGENTS listing withholds Edit `
    + 'from a deactivated agent while this listing offers it - a deliberate divergence, and '
    + 'this is its regression lock.',
  ).toContain(action.toLowerCase());
});

// ==================== Which tab a candidate is on ====================

Then('that candidate should still be listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  const c = subject(this);
  const hit = await listing(this).findCandidateOnTab(tab, c.email, { timeout: 45000 });
  expect(hit, `${c.email} is not on the "${tab}" tab`).toBeTruthy();
});

Then('that candidate should not be listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  const c = subject(this);
  const state = await listing(this).confirmCandidateAbsentFromTab(tab, c.email);
  expect(
    state.absent,
    `${c.email} IS listed on the "${tab}" tab: ${JSON.stringify(state.found)}`,
  ).toBe(true);
});

Then('that candidate should appear on the {string} tab', { timeout: 180000 }, async function (tab) {
  const c = subject(this);
  const hit = await listing(this).waitForCandidateOnTab(tab, c.email, { timeout: 120000 });
  this.attach(`${c.email} is on "${tab}" with status ${JSON.stringify(hit.status)}`, 'text/plain');
});

Then('that candidate should no longer be listed on the {string} tab', { timeout: 180000 }, async function (tab) {
  const c = subject(this);
  const state = await listing(this).confirmCandidateAbsentFromTab(tab, c.email, { confirmations: 2, gapMs: 3000 });
  expect(state.absent, `${c.email} is still on the "${tab}" tab: ${JSON.stringify(state.found)}`).toBe(true);
});

// ==================== THE MUTATING PATH ====================

// A seeded candidate that is currently ACTIVE, so the round trip starts and ends in the same
// state. CANDIDATE_LIFECYCLE_EMAIL pins one; otherwise the first active seeded candidate is
// taken. Either way it goes through candidateLifecycleGuard().
Given('I have found a seeded candidate that is safe to deactivate', { timeout: 300000 }, async function () {
  const pinned = String(process.env.CANDIDATE_LIFECYCLE_EMAIL || '').trim();
  if (pinned) {
    candidateLifecycleGuard(pinned);
    const hit = await listing(this).findCandidateOnTab('Active', pinned, { timeout: 60000 });
    if (!hit) {
      throw new Error(
        `CANDIDATE_LIFECYCLE_EMAIL names ${pinned}, but that candidate is not on the Active tab. `
        + 'The round trip has to start from Active so it can end there - if a previous run died '
        + 'half way, reactivate it first.',
      );
    }
    this._lifecycleSubject = hit;
    noteCandidate(this, hit, 'Pinned by CANDIDATE_LIFECYCLE_EMAIL.');
    return;
  }

  // The seeded accounts are all `uat.candidate<N>@talentforge.test`, so searching that stem on
  // the Active tab returns candidates the guard will accept.
  await listing(this).goto('Active');
  const result = await listing(this).search('uat.candidate', { tab: 'Active' });
  const rows = candidatesOf(result.payload).filter((c) => /^active$/i.test(String(c.status)));
  const tried = [];
  for (const row of rows) {
    try {
      candidateLifecycleGuard(row.email);
      this._lifecycleSubject = row;
      noteCandidate(
        this,
        row,
        'Seeded account on the undeliverable talentforge.test domain, so the reactivation email '
        + 'this scenario causes reaches no real inbox. Set CANDIDATE_LIFECYCLE_EMAIL to pin a '
        + 'different one.',
      );
      return;
    } catch (e) {
      tried.push(`${row.email}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'No seeded active candidate safe to deactivate could be found.\n\n'
    + `Active candidates matching "uat.candidate": ${JSON.stringify(rows.map((r) => r.email))}\n`
    + `${tried.length ? `Rejected by the guard:\n  ${tried.join('\n  ')}\n` : ''}`
    + 'Set CANDIDATE_LIFECYCLE_EMAIL to name one explicitly.',
  );
});

When('I confirm the candidate deactivation', { timeout: 180000 }, async function () {
  const c = subject(this);
  candidateLifecycleGuard(c.email);
  const result = await listing(this).confirmDeactivate();
  this._deactivated = c;
  this.attach(`Deactivated ${c.email}. Toasts: ${JSON.stringify(result.toasts)}`, 'text/plain');
});

When('I confirm the candidate reactivation', { timeout: 180000 }, async function () {
  const c = subject(this);
  const result = await listing(this).confirmReactivate();
  this._deactivated = null;
  this.attach(`Reactivated ${c.email}. Toasts: ${JSON.stringify(result.toasts)}`, 'text/plain');
});

// Both go through statusIs(), because the API answers "Inactive" where the grid renders
// "Deactivated" - see the note above CandidatesListingPage.candidatesFrom(). Written against
// the rendered wording first, this failed with `the server reports ... as "Inactive"` AFTER a
// deactivation that had worked perfectly, on the step immediately following two that had
// already confirmed the move between tabs.
Then('the server should report that candidate as deactivated', { timeout: 120000 }, async function () {
  const c = subject(this);
  const hit = await listing(this).waitForCandidateOnTab('All', c.email, { timeout: 90000 });
  expect(
    CandidatesListingPage.statusIs(hit, 'deactivated'),
    `the server reports ${c.email} as ${JSON.stringify(hit.status)}, expected Deactivated `
    + '(the API spells it "Inactive")',
  ).toBe(true);
});

Then('the server should report that candidate as active', { timeout: 120000 }, async function () {
  const c = subject(this);
  const hit = await listing(this).waitForCandidateOnTab('All', c.email, { timeout: 90000 });
  expect(
    CandidatesListingPage.statusIs(hit, 'active'),
    `the server reports ${c.email} as ${JSON.stringify(hit.status)}, expected Active`,
  ).toBe(true);
});

// The safety net. If the scenario dies between deactivating and reactivating, the candidate is
// put back - and this hook NEVER throws: masking the scenario's own failure with a cleanup
// error would send whoever reads the report after the wrong problem. A failed restore is
// ATTACHED instead, loudly, because a candidate left deactivated is a state somebody has to
// fix by hand.
After({ tags: '@mutates-candidate' }, async function () {
  const left = this._deactivated;
  if (!left || !left.email) return;
  const notes = [`RESTORE: ${left.email} was left deactivated by this scenario.`];
  try {
    const hit = await listing(this).findCandidateOnTab('Deactivated', left.email, { timeout: 45000 });
    if (!hit) {
      notes.push('  It is no longer on the Deactivated tab, so nothing needed restoring.');
    } else {
      await listing(this).openReactivateDialog(left.email);
      await listing(this).confirmReactivate();
      const back = await listing(this).findCandidateOnTab('Active', left.email, { timeout: 60000 });
      notes.push(back
        ? `  Reactivated successfully - the server now reports it as ${back.status}.`
        : '  >>> REACTIVATION DID NOT TAKE EFFECT. THIS CANDIDATE IS STILL DEACTIVATED AND NEEDS'
          + ' FIXING BY HAND. <<<');
    }
  } catch (e) {
    notes.push(
      `  >>> RESTORE FAILED: ${e.message}\n`
      + `  ${left.email} IS STILL DEACTIVATED AND NEEDS REACTIVATING BY HAND, from`
      + ' /candidates?accountTab=deactivated. <<<',
    );
  }
  this.attach(notes.join('\n'), 'text/plain');
});

// ==================== Lifecycle, part 2 (added 2026-10-26) ====================
//
// Edit on a deactivated candidate, a failed deactivation, and what a deactivated candidate still
// offers. The disabled-Edit rule is asserted on the Deactivated tab (where the product shows it)
// AND on the All tab, where the same deactivated candidate is listed beside active ones.

async function rowEdit(world, email) {
  return world.page.evaluate((needle) => {
    const row = Array.from(document.querySelectorAll('[role="row"]'))
      .find((r) => !r.querySelector('[role="columnheader"]') && (r.innerText || '').toLowerCase().includes(needle.toLowerCase()));
    if (!row) return null;
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').toLowerCase() === 'edit');
    return { present: Boolean(btn), disabled: btn ? btn.disabled : null };
  }, email);
}

// Pressing a disabled control must do nothing: no modal, no request. Forced past the disabled
// state on purpose - a control that merely LOOKS disabled but still reacts is the defect this
// catches.
Then("pressing that candidate's disabled Edit should open nothing and send nothing", { timeout: 60000 }, async function () {
  const c = subject(this);
  const sent = [];
  const watch = (r) => { if (/\/api\/v1\//.test(r.url()) && r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`); };
  this.page.on('request', watch);
  await listing(this).rowLocator(c.email).getByRole('button', { name: /^edit$/i }).first()
    .click({ force: true }).catch(() => {});
  await this.page.waitForTimeout(2500);
  this.page.off('request', watch);
  expect(await listing(this).emailDialog.isVisible().catch(() => false), 'the Update Email Address modal opened').toBe(false);
  expect(sent, `pressing the disabled Edit sent ${JSON.stringify(sent)}`).toEqual([]);
});

Then("every {string} row's {string} action should be enabled", async function (tab, action) {
  const rows = await this.page.evaluate((label) => Array.from(document.querySelectorAll('[role="row"]'))
    .filter((r) => !r.querySelector('[role="columnheader"]') && /@/.test(r.innerText || ''))
    .map((r) => {
      const btn = Array.from(r.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').toLowerCase() === label.toLowerCase());
      return { email: ((r.innerText || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [''])[0], present: Boolean(btn), disabled: btn ? btn.disabled : null };
    }), action);
  this.attach(JSON.stringify(rows, null, 1), 'text/plain');
  const problems = [];
  if (!rows.length) problems.push(`no rows on the ${tab} tab to check`);
  rows.forEach((r) => {
    if (!r.present) problems.push(`${r.email}: no "${action}" control`);
    else if (r.disabled) problems.push(`${r.email}: "${action}" is disabled on the ${tab} tab`);
  });
  fail(problems, `"${action}" is not enabled on every ${tab} row:`);
});

// The same deactivated candidate, found on the ALL tab by its exact address.
Then("that deactivated candidate's Edit should be disabled on the All tab too", { timeout: 120000 }, async function () {
  const c = subject(this);
  await listing(this).goto('All');
  await listing(this).search(c.email, { tab: 'All' });
  const state = await rowEdit(this, c.email);
  expect(state, `${c.email} is not listed on the All tab`).toBeTruthy();
  expect(state.present, 'the row offers no Edit').toBe(true);
  expect(state.disabled, `Edit is ENABLED for the deactivated ${c.email} on the All tab`).toBe(true);
});

Then("that candidate's Edit should be {string} on the {string} tab", { timeout: 120000 }, async function (want, tab) {
  const c = subject(this);
  await listing(this).goto(tab);
  await listing(this).search(c.email, { tab });
  const state = await rowEdit(this, c.email);
  expect(state, `${c.email} is not listed on the ${tab} tab`).toBeTruthy();
  expect(state.disabled, `Edit is ${state.disabled ? 'disabled' : 'enabled'} on the ${tab} tab`).toBe(want === 'disabled');
});

// A deactivated candidate's record is still readable: View opens the drawer for them.
Then('View should still open that candidate in the drawer', { timeout: 120000 }, async function () {
  const c = subject(this);
  await listing(this).openCandidatePanel(c.email);
  await panel(this).waitForOpen();
  const header = await panel(this).readHeader();
  expect(header && header.headerText, `the drawer does not name ${c.name}`).toContain(c.name);
  await panel(this).closeVia('Escape');
});

// Every write the page makes is answered 500 for the length of the scenario, so nothing reaches the
// server. The subject is still a guarded seeded candidate: if the interception ever stopped
// working, the change would land on an account the suite owns, and the @mutates-candidate After
// hook would put it back.
Given('every change the candidates page sends will fail with a server error', async function () {
  this._writesFailed = [];
  await this.page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    this._writesFailed.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed failure"}' });
  });
});

When('I confirm the candidate deactivation expecting it to fail', { timeout: 120000 }, async function () {
  const c = subject(this);
  candidateLifecycleGuard(c.email);
  const confirm = listing(this).deactivateDialog.getByRole('button', { name: /^deactivate account$/i }).first();
  this._failedToasts = await listing(this).captureToasts(async () => { await confirm.click(); }, { sampleMs: 6000 });
  this._failedDialogOpen = await listing(this).deactivateDialog.isVisible().catch(() => false);
  this.attach(`Writes answered 500: ${JSON.stringify(this._writesFailed)}\nToasts: ${JSON.stringify(this._failedToasts)}\n`
    + `Dialog still open: ${this._failedDialogOpen}`, 'text/plain');
  await this.page.unroute('**/api/v1/**');
});

Then('the failed deactivation should be reported and the candidate left active', { timeout: 120000 }, async function () {
  const problems = [];
  if (!(this._writesFailed || []).length) problems.push('the deactivation never reached the stub - nothing was sent');
  const toasts = this._failedToasts || [];
  if (toasts.some((t) => /deactivated successfully|has been deactivated/i.test(t))) {
    problems.push(`a SUCCESS message was shown for a deactivation the server refused: ${JSON.stringify(toasts)}`);
  }
  if (!this._failedDialogOpen && !toasts.some((t) => /error|fail|could not|unable|wrong/i.test(t))) {
    problems.push(`the dialog closed and nothing says the deactivation failed (toasts ${JSON.stringify(toasts)})`);
  }
  if (await listing(this).deactivateDialog.isVisible().catch(() => false)) await listing(this).cancelDeactivateDialog();
  const c = subject(this);
  const hit = await listing(this).findCandidateOnTab('Active', c.email, { timeout: 60000 });
  if (!hit) problems.push(`${c.email} is no longer on the Active tab`);
  fail(problems, 'A failed deactivation was not handled as a failure:');
});

When('I go to the {string} tab and open the Reactivate dialog for that candidate', { timeout: 120000 }, async function (tab) {
  const c = subject(this);
  await listing(this).goto(tab);
  await listing(this).search(c.email, { tab });
  await listing(this).openReactivateDialog(c.email);
});
