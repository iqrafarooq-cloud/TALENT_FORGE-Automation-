// Step definitions for features/Agent_Portal/candidate-deactivated.feature -
// Agent Portal > Candidates > Deactivated: its structure, the search (name AND email), the
// three-group filter modal, its single row action and the end-to-end walks.
//
// >>> EVERY PHRASE HERE IS DELIBERATELY WORDED "... Deactivated ...". <<<
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - which counts as neither a pass nor a failure and is easy to miss in the
// summary (playwright-bdd fails generation on it instead). steps/active-candidate.js already
// owns the generic listing vocabulary ("the candidate table has at least one record visible",
// "the filter modal should be visible", "no filter option should be selected in the modal", ...)
// and every one of those is BOUND TO `this.pages.activeCandidate`, so they could not be reused
// here even if the wording were free: they would drive the Active tab while this feature is on
// Deactivated, and pass or fail against the wrong page.
//
// Exactly FOUR phrases ARE reused, and only because each is genuinely page-agnostic - they read
// `this.page.url()` / `this.searchTerm` and touch no page object:
//     Given I am logged in as an agent                       (active-candidate.js)
//     Then  the URL should contain the search term           (active-candidate.js)
//     Then  the URL should contain the filter "<fragment>"   (active-candidate.js)
//     Then  the URL should not contain the filter "<frag>"   (require-attention.js)
//
// >>> NOTHING IN THIS FILE WRITES. <<< The only row action on this listing is View and there is
// no reactivate control anywhere on the surface, so no scenario here can change an account,
// spend a fixture or send an email. That is why the whole feature is safe in the default run -
// and it is asserted as a rule ("every row should offer exactly the View action") rather than
// assumed, so the day a write control appears this file goes red.
//
// >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT { timeout }. <<<
// features/support/hooks.js calls setDefaultTimeout(60000) and THAT OVERRIDES the profile's own
// `timeout`. A step that reopens the filter modal once per row is many times a normal step's
// work, so without a budget of its own it is killed part way and reports "function timed out" -
// which says nothing about the app and hides however many rows had already passed. This trap has
// now bitten four areas in this repo; do not add a table step here without one.

const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const DeactivatedCandidatePage = require('../pages/DeactivatedCandidatePage');

// Per-step budgets, sized to the work inside each one rather than guessed.
const TABLE = 300000; // reopens the modal / re-navigates once per row
const SLOW = 180000; // several navigations or a profile load

const dc = (world) => world.pages.deactivatedCandidate;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Attach evidence to the report. Every assertion that measured something attaches what it saw:
// on a red row it is the evidence, on a green one it is the record of what the app did that day,
// which is what makes a later change diagnosable instead of mysterious.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// A row "matches" a term if its Candidate cell contains it, case-insensitively. The cell holds
// the name and the email on two lines, which is exactly why the reader uses innerText - see
// visibleRowHeaders().
function matches(header, term) {
  return header.toLowerCase().includes(String(term).toLowerCase());
}

// ==================== Background ====================

Given('I am on the Candidates Deactivated tab', { timeout: SLOW }, async function () {
  await dc(this).navigate();
  this.dcUnfilteredCount = await dc(this).rowCount();
});

Given('the Deactivated table has at least one record visible', async function () {
  const page = dc(this);
  await page.settleRows();
  const count = await page.rowCount();
  expect(
    count,
    'expected at least one deactivated candidate on this agent. Every scenario in this file reads '
    + 'the list, so with none there is nothing under test - deactivate a uat.candidate* account '
    + 'from the SuperAdmin portal, or point AGENT_EMAIL at an agent that has some.'
  ).toBeGreaterThan(0);
  this.dcUnfilteredCount = count;
});

Given('the Deactivated table has at least two records visible', async function () {
  const page = dc(this);
  await page.settleRows();
  const count = await page.rowCount();
  expect(count, 'this scenario drives a row other than the first, so it needs two rows').toBeGreaterThan(1);
  this.dcUnfilteredCount = count;
});

// ==================== structure ====================

Then('the Deactivated heading should be displayed', async function () {
  await expect(dc(this).pageHeading).toBeVisible({ timeout: 20000 });
});

Then('the Deactivated table should be visible', async function () {
  await expect(dc(this).table).toBeVisible({ timeout: 20000 });
});

// EXACTLY these columns, in this order - not merely "each is present". An extra column silently
// shifts every gridcell index the row readers depend on (Account Verification=0, Pending
// Documents=1, Subscription Status=2), so a tolerant check here would let every later cell
// assertion read the wrong column.
Then('the Deactivated table should display exactly these columns:', async function (dataTable) {
  const expected = dataTable.raw().map(([c]) => c.trim());
  const actual = (await dc(this).columnHeaders()).map((h) => h.trim());
  await record(this, 'Deactivated column headers', { expected, actual });
  expect(actual, 'the grid columns, in order').toEqual(expected);
});

Then('the Deactivated search box should be displayed', async function () {
  await expect(dc(this).searchInput).toBeVisible({ timeout: 20000 });
});

Then('the Deactivated Filters button should be displayed', async function () {
  await expect(dc(this).filtersButton).toBeVisible({ timeout: 20000 });
});

// The Requires Attention tab renders three severity tabs in a radiogroup; this listing renders
// none. Asserted rather than left as a silent gap - a reader that waits for a tab strip hangs on
// a page that is fully rendered, so if one is ever added this is what says so.
//
// Scoped to <main>: the page shell's language switcher and the profile menu use radiogroups of
// their own elsewhere in the document.
Then('the Deactivated listing should offer no severity or status tab strip', async function () {
  const groups = await this.page
    .locator('main [role="radiogroup"]')
    .evaluateAll((gs) => gs.map((g) => (g.innerText || '').replace(/\s+/g, ' ').trim()));
  await record(this, 'radiogroups inside <main> on the Deactivated listing', groups);
  expect(
    groups,
    'the Deactivated listing renders no tab strip today; if one has been added, extend '
    + 'DeactivatedCandidatePage rather than deleting this assertion'
  ).toEqual([]);
});

Then('the Deactivated URL should carry no tab parameter', async function () {
  const url = decodeURIComponent(this.page.url());
  await record(this, 'Deactivated URL on arrival', url);
  for (const param of ['activeFilter=', 'tab=', 'severity=']) {
    expect(url, `the Deactivated route carries no ${param}`).not.toContain(param);
  }
});

// ==================== search ====================

When("I search the Deactivated list by the first candidate's name", { timeout: SLOW }, async function () {
  const { name } = await dc(this).firstCandidate();
  this.searchTerm = name;
  this.dcSent = await dc(this).searchCapturingRequest(name);
  await record(this, 'searched the Deactivated list by name', { term: name, sent: this.dcSent });
});

When("I search the Deactivated list by the first candidate's email", { timeout: SLOW }, async function () {
  const { email } = await dc(this).firstCandidate();
  this.searchTerm = email;
  this.dcSent = await dc(this).searchCapturingRequest(email);
  await record(this, 'searched the Deactivated list by email', { term: email, sent: this.dcSent });
});

When("I search the Deactivated list by the noted candidate's email", { timeout: SLOW }, async function () {
  expect(this.dcNoted, 'no candidate has been noted - put a "note the first Deactivated candidate" step first').toBeTruthy();
  const { email } = this.dcNoted;
  this.searchTerm = email;
  this.dcSent = await dc(this).searchCapturingRequest(email);
  await record(this, 'searched the Deactivated list by the noted email', { term: email, sent: this.dcSent });
});

When('I search the Deactivated list for {string}', { timeout: SLOW }, async function (term) {
  this.searchTerm = term;
  this.dcSent = await dc(this).searchCapturingRequest(term);
  await record(this, 'searched the Deactivated list', { term, sent: this.dcSent });
});

When('I clear the Deactivated search', { timeout: SLOW }, async function () {
  await dc(this).clearSearch();
});

Then('every listed candidate should match the Deactivated search term', async function () {
  const headers = await dc(this).visibleRowHeaders();
  await record(this, `rows listed for "${this.searchTerm}"`, headers);
  const offenders = headers.filter((h) => !matches(h, this.searchTerm));
  expect(
    offenders,
    `every listed candidate should contain "${this.searchTerm}" in its Candidate cell`
  ).toEqual([]);
});

Then('exactly one Deactivated candidate should be listed', async function () {
  const headers = await dc(this).visibleRowHeaders();
  await record(this, 'rows listed', headers);
  expect(headers.length, `expected exactly one row, got: ${JSON.stringify(headers)}`).toBe(1);
});

Then('no Deactivated candidate should be listed', async function () {
  await expect
    .poll(() => dc(this).rowCount(), { timeout: 15000, message: 'expected the grid to hold no rows' })
    .toBe(0);
});

// The app ALWAYS sends `search=`, even empty, so "a request carrying search=" is not evidence
// that a search was applied - the VALUE is what is asserted. A "+" in the term is compared
// against both spellings because a query string may legitimately carry it raw or percent-encoded.
// >>> A QUERY STRING ENCODES A SPACE AS "+", AND decodeURIComponent DOES NOT DECODE IT. <<<
// So the shared `the URL should contain the search term` step in active-candidate.js can never
// match a multi-word term: it looks for "search=Abdul Musawwir" in a URL that correctly reads
// "search=Abdul+Musawwir". That is a reader limitation, not a product defect - the app's encoding
// is right - and the shared step is left alone because three features depend on it. This is the
// correct reader: URLSearchParams applies the "+"-means-space rule that decodeURIComponent does
// not.
Then('the Deactivated URL should contain the search term', async function () {
  await expect
    .poll(
      () => {
        const q = new URL(this.page.url()).searchParams.get('search');
        return q === null ? '(no search parameter)' : q;
      },
      {
        timeout: 10000,
        message: `the URL should carry the search term. URL: ${this.page.url()}`,
      }
    )
    .toBe(this.searchTerm);
});

Then('the Deactivated request should carry the search term', async function () {
  const sent = this.dcSent || dc(this).lastRequestQuery();
  await record(this, 'the request the app sent', sent);
  expect(sent, 'the app sent no list request for that search').toBeTruthy();
  const term = String(this.searchTerm);
  const ok = sent.includes(`search=${term}`)
    || sent.includes(`search=${term.replace(/ /g, '+')}`)
    || sent.includes(`search=${encodeURIComponent(term)}`);
  expect(ok, `expected the request to carry search=${term}. It carried: ${sent}`).toBe(true);
});

Then('the Deactivated request should carry {string}', async function (fragment) {
  await expect
    .poll(() => dc(this).lastRequestQuery() || '', {
      timeout: 15000,
      message: `the last list request should carry "${fragment}". Requests so far: ${JSON.stringify(dc(this).requestsSince(0))}`,
    })
    .toContain(fragment);
});

// Five variations in ONE step, every one driven and every failure collected before throwing once.
// Cucumber abandons a scenario at its first failing step, so five consecutive Then steps would
// only ever report whichever variation failed first and would say nothing about whether the rest
// share a cause.
//
// It asserts the NOTED candidate is returned rather than "some rows came back": a search that
// ignored its term entirely would return every row and satisfy a bare non-empty check.
Then(
  "the Deactivated search should match these variations of the first candidate's details:",
  { timeout: TABLE },
  async function (dataTable) {
    const page = dc(this);
    const { name, email } = await page.firstCandidate();
    const local = email.split('@')[0];

    const build = {
      'name in upper case': name.toUpperCase(),
      'name in lower case': name.toLowerCase(),
      'first four of name': name.slice(0, 4),
      'full email address': email,
      'local part of email': local,
    };

    const problems = [];
    const evidence = [];

    for (const row of dataTable.hashes()) {
      const variation = row.variation.trim();
      const term = build[variation];
      if (term === undefined) {
        problems.push(`unknown variation "${variation}" - known: ${Object.keys(build).join(', ')}`);
        continue;
      }

      /* eslint-disable no-await-in-loop */
      const sent = await page.searchCapturingRequest(term);
      const headers = await page.visibleRowHeaders();
      /* eslint-enable no-await-in-loop */

      evidence.push({ variation, term, rows: headers.length, sent, headers });

      if (!headers.length) {
        problems.push(`${variation}: searching ${JSON.stringify(term)} returned NO rows`);
        continue;
      }
      // The candidate the term was derived from must be among the results.
      if (!headers.some((h) => matches(h, email))) {
        problems.push(
          `${variation}: searching ${JSON.stringify(term)} returned ${headers.length} row(s) but not `
          + `${email} - got ${JSON.stringify(headers)}`
        );
      }
      // Every row returned must genuinely contain the term, or the search is not filtering.
      const offenders = headers.filter((h) => !matches(h, term));
      if (offenders.length) {
        problems.push(
          `${variation}: ${offenders.length} row(s) do not contain ${JSON.stringify(term)} - ${JSON.stringify(offenders)}`
        );
      }
    }

    await record(this, 'Deactivated search variations', evidence);
    await page.clearSearch();
    expect(problems, `${problems.length} of ${dataTable.hashes().length} search variations failed`).toEqual([]);
  }
);

// Product decision: the placeholder is "Search by candidate name..." (same as Requires Attention).
// Pinned verbatim - the search also matching an email is not something it needs to advertise.
Then('the Deactivated search placeholder should read {string}', async function (expected) {
  const placeholder = await dc(this).searchPlaceholder();
  await record(this, 'Search placeholder', placeholder);
  expect(placeholder, 'the search box placeholder').toBe(expected);
});

Then('the Deactivated empty state should read exactly:', async function (dataTable) {
  const expected = Object.fromEntries(dataTable.raw().map(([k, v]) => [k.trim(), v.trim()]));
  const state = await dc(this).readEmptyState();
  await record(this, 'Deactivated empty state', state);
  expect(state, 'no empty state is on screen').toBeTruthy();
  // EXACTLY, not `includes`: an `includes` check would go on passing if a sub-line were added.
  if (expected.heading !== undefined) expect(state.heading).toBe(expected.heading);
  if (expected.body !== undefined) expect(state.body).toBe(expected.body);
});

Then('the Deactivated empty state should be displayed', async function () {
  await expect
    .poll(async () => Boolean(await dc(this).readEmptyState()), {
      timeout: 15000,
      message: 'expected an empty state on screen',
    })
    .toBe(true);
});

// "Still usable" means the controls the agent needs to get OUT of the empty state are alive -
// an empty result that also disabled the search box would strand them.
Then('the Deactivated page should still be usable', async function () {
  const page = dc(this);
  await expect(page.searchInput).toBeEnabled({ timeout: 10000 });
  await expect(page.filtersButton).toBeEnabled({ timeout: 10000 });
  await expect(page.pageHeading).toBeVisible({ timeout: 10000 });
});

Then('the Deactivated search box should be empty', async function () {
  expect(await dc(this).getSearchValue()).toBe('');
});

Then('the Deactivated search box should hold the search term', async function () {
  await expect
    .poll(() => dc(this).getSearchValue(), { timeout: 10000 })
    .toBe(this.searchTerm);
});

Then('the listed Deactivated count should be back to its unfiltered value', async function () {
  const want = this.dcUnfilteredCount;
  expect(want, 'no unfiltered count was recorded earlier in this scenario').toBeGreaterThan(-1);
  await expect
    .poll(() => dc(this).rowCount(), {
      timeout: 15000,
      message: `expected the list back at its unfiltered ${want} rows`,
    })
    .toBe(want);
});

Then('the Deactivated URL should not contain a search parameter', async function () {
  const url = decodeURIComponent(this.page.url());
  await record(this, 'URL after a whitespace-only search', url);
  expect(url, 'a blank search should not reach the address bar').not.toContain('search=');
});

// RECORDED, NEVER FAILED ON. The outcome the agent sees is correct - the list comes back
// unfiltered and the URL omits the term - and the only cost is one wasted round trip. Three
// surfaces in this product do two different things with a blank search, and no AC settles which
// is right, so failing here would make the file permanently red over a question for the PO.
Then('whatever the app sent for a blank Deactivated search should be reported', async function () {
  const sent = this.dcSent;
  await record(
    this,
    'FOR THE PO - what a whitespace-only search sends',
    {
      requestSent: sent,
      note:
        'The Deactivated listing SENDS a blank search to the server (search=+++) while correctly '
        + 'keeping it out of the URL. Requires Attention and the SuperAdmin candidates listing do '
        + 'the same; the Agents listing suppresses the request entirely. Three surfaces, two '
        + 'behaviours - which is house style?',
    }
  );
});

When('I note the first Deactivated candidate', async function () {
  this.dcNoted = await dc(this).firstCandidate();
  await record(this, 'noted candidate', this.dcNoted);
});

When('I note the second Deactivated candidate', async function () {
  const headers = await dc(this).visibleRowHeaders();
  expect(headers.length, 'need a second row to note').toBeGreaterThan(1);
  const tokens = headers[1].split(' ').filter(Boolean);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const email = tokens.find((t) => emailRe.test(t)) || '';
  const name = tokens.filter((t) => !emailRe.test(t)).join(' ').trim();
  expect(email, `the second row exposed no email: ${JSON.stringify(headers[1])}`).toBeTruthy();
  this.dcNoted = { name, email };
  await record(this, 'noted candidate (row 2)', this.dcNoted);
});

When(
  "I open the Deactivated tab at that candidate's email as a search parameter",
  { timeout: SLOW },
  async function () {
    expect(this.dcNoted, 'no candidate has been noted').toBeTruthy();
    this.searchTerm = this.dcNoted.email;
    this.dcSent = await dc(this).loadUrlCapturingRequest(`?search=${encodeURIComponent(this.dcNoted.email)}`);
    await record(this, 'deep-linked a search', { term: this.searchTerm, sent: this.dcSent });
  }
);

When('I open the Deactivated tab at {string}', { timeout: SLOW }, async function (suffix) {
  this.dcSent = await dc(this).loadUrlCapturingRequest(suffix);
  await record(this, `deep-linked ${suffix}`, { sent: this.dcSent });
});

When('I reload the Deactivated list', { timeout: SLOW }, async function () {
  this.dcSent = await dc(this).reload();
  await record(this, 'reloaded the Deactivated list', { sent: this.dcSent });
});

// ==================== filters ====================

When('I open the Deactivated filters', async function () {
  await dc(this).openFilters();
});

Then('the Deactivated filter modal should be visible', async function () {
  await expect(dc(this).filterModal).toBeVisible({ timeout: 10000 });
});

Then('the Deactivated filter modal should not be visible', async function () {
  await expect(dc(this).filterModal).toBeHidden({ timeout: 10000 });
});

// Asserts the groups, their options AND the control type each uses, collecting every problem
// before throwing once. The TYPE matters as much as the options: it decides what a second
// selection in the group means (a checkbox adds, a radio REPLACES), and two scenarios below turn
// on that difference.
Then(
  'the Deactivated filter modal should offer exactly these groups and options:',
  { timeout: SLOW },
  async function (dataTable) {
    const page = dc(this);
    const rendered = await page.readFilterGroups();
    const options = await page.readFilterOptions();
    await record(this, 'filter modal as rendered', { groups: rendered, options });

    const problems = [];
    const expectedGroups = dataTable.hashes();

    for (const row of expectedGroups) {
      const group = row.group.trim();
      const wantOptions = row.options.split(',').map((o) => o.trim());
      const wantControl = row.control.trim();

      const got = rendered[group];
      if (!got) {
        problems.push(`group "${group}" is not rendered. Groups found: ${JSON.stringify(Object.keys(rendered))}`);
        continue;
      }
      if (JSON.stringify(got) !== JSON.stringify(wantOptions)) {
        problems.push(`group "${group}" offers ${JSON.stringify(got)}, expected ${JSON.stringify(wantOptions)}`);
      }
      for (const opt of wantOptions) {
        const found = options.find((o) => o.text.toLowerCase() === opt.toLowerCase());
        if (!found) {
          problems.push(`option "${opt}" of "${group}" has no <label> in the modal`);
        } else if (found.control !== wantControl) {
          problems.push(
            `option "${opt}" of "${group}" is a ${found.control}, expected a ${wantControl} - `
            + 'a checkbox ADDS to the group while a radio REPLACES, so this changes what the group means'
          );
        }
      }
    }

    const expectedNames = expectedGroups.map((r) => r.group.trim());
    const extra = Object.keys(rendered).filter((g) => !expectedNames.includes(g));
    if (extra.length) problems.push(`unexpected group(s) rendered: ${JSON.stringify(extra)}`);

    expect(problems, `${problems.length} problem(s) with the filter modal`).toEqual([]);
  }
);

Then(
  'the Deactivated filter modal should offer a {string}, {string} and {string} control',
  async function (a, b, c) {
    const modal = dc(this).filterModal;
    for (const label of [a, b, c]) {
      await expect(
        modal.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first(),
        `the modal should offer a "${label}" control`
      ).toBeVisible({ timeout: 10000 });
    }
  }
);

// Walks all eight options and collects every problem before throwing once. Three independent
// things are checked per option - the URL value, the API value, and that a request was made at
// all - and reporting only the first would hide whether the rest share a cause.
//
// >>> THE `3+` ROW IS RECORDED, NOT FAILED ON, WHERE IT CONCERNS ENCODING. <<< The app sends a
// RAW `pending_documents=3+`, and a bare "+" in a query string decodes as a space, so the server
// receives "3 ". No deactivated candidate holds 3+ documents today, so a working filter and a
// broken one return the identical empty list and cannot be told apart on this data. What IS
// asserted is the param the app sends; the encoding concern is attached for the PO.
Then(
  'applying each Deactivated filter option should update the URL and the request sent:',
  { timeout: TABLE },
  async function (dataTable) {
    const page = dc(this);
    const problems = [];
    const evidence = [];
    const encodingConcerns = [];

    for (const row of dataTable.hashes()) {
      const option = row.option.trim();
      const wantUrl = row.urlParam.trim();
      const wantApi = row.apiParam.trim();

      /* eslint-disable no-await-in-loop */
      await page.navigate();
      await page.openFilters();
      await page.selectFilterOption(option);
      const sent = await page.applyFiltersCapturingRequest();
      const url = decodeURIComponent(this.page.url());
      const rows = await page.rowCount();
      /* eslint-enable no-await-in-loop */

      evidence.push({ group: row.group.trim(), option, url, sent, rows });

      if (!url.includes(wantUrl)) {
        problems.push(`"${option}": the URL should carry ${wantUrl}, it reads ${JSON.stringify(url)}`);
      }
      if (sent === null) {
        problems.push(`"${option}": the app fired NO list request when the filter was applied`);
      } else if (!sent.includes(wantApi)) {
        problems.push(
          `"${option}": the request should carry ${wantApi}, it carried ${JSON.stringify(sent)} - `
          + 'a front end that rewrites the address bar and queries the server for something else '
          + 'cannot be caught by reading the URL or the rendered rows'
        );
      }
      if (sent && /=[^&]*\+/.test(sent.split(wantApi.split('=')[0] + '=')[1] || '')) {
        encodingConcerns.push({ option, sent });
      }
    }

    await record(this, 'each Deactivated filter option: URL vs request', evidence);
    if (encodingConcerns.length) {
      await record(this, 'FOR THE PO - an unencoded "+" on the wire', {
        observed: encodingConcerns,
        note:
          'A bare "+" in a query string decodes as a SPACE, so the server receives "3 " rather '
          + 'than "3+". It returns an empty list either way on the current data, so a working '
          + 'filter and a broken one are indistinguishable here - should the value be '
          + 'percent-encoded (%2B), or renamed the way the URL already renames it ("3plus")?',
      });
    }
    expect(problems, `${problems.length} of ${dataTable.hashes().length} filter options misbehaved`).toEqual([]);
  }
);

// Measures one option's result count on its own, so the union scenario can be asserted as a
// RELATION rather than against a number pinned in the Gherkin - the deactivated list is small and
// changes under us (it went 4 -> 6 rows during one afternoon's probing), so a pinned count would
// be red for a reason that is not a defect.
When(
  'I note the Deactivated count for the {string} filter option',
  { timeout: SLOW },
  async function (option) {
    const page = dc(this);
    await page.navigate();
    await page.openFilters();
    await page.selectFilterOption(option);
    const sent = await page.applyFiltersCapturingRequest();
    // The SERVER's total, not the rendered row count: the render is capped at page_size, so two
    // results differing only past the first page would look identical on screen and the union
    // arithmetic below would be comparing two 10s.
    const count = page.lastListCount();
    const rendered = await page.rowCount();
    expect(
      count,
      `the server returned no count for "${option}", so its result size cannot be established`
    ).not.toBeNull();
    this.dcNotedCounts = this.dcNotedCounts || [];
    this.dcNotedCounts.push({ option, count, rendered, sent });
    await record(this, `result size for "${option}" alone`, { option, count, rendered, sent });
    await page.navigate();
  }
);

When('I select the {string} Deactivated filter option', async function (option) {
  await dc(this).selectFilterOption(option);
});

When('I apply the Deactivated filters', { timeout: SLOW }, async function () {
  this.dcSent = await dc(this).applyFiltersCapturingRequest();
  await record(this, 'applied the Deactivated filters', { sent: this.dcSent });
});

// Subscribed / Not Subscribed / Payment Due partition the list, so the union of two of them is
// exactly the sum of the two. Asserted with all three figures attached, because the honest
// alternative explanation for a mismatch is that somebody deactivated a candidate mid-scenario.
Then('the listed Deactivated count should equal the sum of the two noted counts', async function () {
  const noted = this.dcNotedCounts || [];
  expect(noted.length, 'two counts should have been noted before this step').toBe(2);
  const union = dc(this).lastListCount();
  const sum = noted[0].count + noted[1].count;
  expect(union, 'the server returned no count for the union query').not.toBeNull();
  await record(this, 'union arithmetic', { noted, union, sum });
  expect(
    union,
    `"${noted[0].option}" returned ${noted[0].count} and "${noted[1].option}" returned ${noted[1].count}, `
    + `so their union should be ${sum} - the two are mutually exclusive. It returned ${union}. `
    + 'If these figures look inconsistent with each other rather than with the rule, check whether '
    + 'a candidate was deactivated or reactivated while the scenario was running.'
  ).toBe(sum);
});

// >>> IT COUNTS GROUPS, NOT OPTIONS. <<< Measured. The Active tab's own scenarios assert the
// OPTION count for the same-looking badge, so the two listings genuinely disagree about what the
// number means - asserted as measured on each surface rather than reconciled.
Then(
  'the Deactivated Filters button should show an applied-filter count of {string}',
  async function (expected) {
    const want = parseInt(expected, 10);
    await expect
      .poll(() => dc(this).appliedFilterCount(), {
        timeout: 12000,
        message: `the Filters button should read a count of ${want}`,
      })
      .toBe(want);
  }
);

When('I clear all Deactivated filters', async function () {
  await dc(this).clearAllFilters();
});

Then('exactly one Deactivated filter option should be selected in the modal', async function () {
  const selected = await dc(this).selectedFilterOptions();
  await record(this, 'selected filter options', selected);
  expect(selected.length, `expected exactly one selection, got ${JSON.stringify(selected)}`).toBe(1);
});

Then('the only selected Deactivated filter option should be {string}', async function (option) {
  const selected = await dc(this).selectedFilterOptions();
  await record(this, 'selected filter options', selected);
  expect(selected).toEqual([option]);
});

Then('no Deactivated filter option should be selected', async function () {
  const selected = await dc(this).selectedFilterOptions();
  await record(this, 'selected filter options', selected);
  expect(selected, 'every selection should have been cleared').toEqual([]);
});

Then('the URL should not contain any Deactivated filter parameters', async function () {
  const url = decodeURIComponent(this.page.url());
  await record(this, 'URL after clearing/cancelling filters', url);
  for (const param of ['accountVerification=', 'pendingDocuments=', 'subscriptionStatus=']) {
    expect(url, `the URL should not carry ${param} once filters are cleared`).not.toContain(param);
  }
});

When('I cancel the Deactivated filters', async function () {
  await dc(this).cancelFilters();
});

When('I close the Deactivated filter modal via {string}', async function (method) {
  await dc(this).closeFilterModal(method);
});

// ==================== row actions ====================

// EXACTLY one action, asserted as an exhaustive list rather than as "View is present". This is
// what keeps the whole file safe in the default run: the module is read-only only because no
// write control exists on a row, so a new action must turn this red rather than slip in. It names
// whatever it found, so a red row says WHICH control appeared.
Then('every Deactivated row should offer exactly the View action', async function () {
  const rows = await dc(this).readRows();
  await record(this, 'row actions per row', rows.map((r) => ({ email: r.email, actions: r.actions })));
  expect(rows.length, 'no rows to inspect').toBeGreaterThan(0);

  const problems = [];
  rows.forEach((r, i) => {
    if (!r.view.present) problems.push(`row ${i} (${r.email}) offers no View control`);
    if (r.view.present && r.view.disabled) problems.push(`row ${i} (${r.email}) has View DISABLED`);
    const extra = r.actions.filter((a) => !/^view$/i.test(a));
    if (extra.length) {
      problems.push(
        `row ${i} (${r.email}) offers ${JSON.stringify(extra)} besides View. If a control has been `
        + 'added deliberately, check whether it WRITES - this whole feature is in the default run '
        + 'only because nothing on this listing can change an account.'
      );
    }
  });
  expect(problems, `${problems.length} row(s) do not offer exactly the View action`).toEqual([]);
});

Then('no Deactivated row should offer a Reactivate control', async function () {
  const rows = await dc(this).readRows();
  const offenders = rows.filter((r) => r.reactivate.present).map((r) => r.email);
  await record(this, 'rows offering a Reactivate control', offenders);
  expect(
    offenders,
    'a reactivate control on this listing would make the module capable of changing an account, '
    + 'and it is in the default `npm test` run on the basis that it cannot'
  ).toEqual([]);
});

Then('no Deactivated row should offer a Reminder History control', async function () {
  const rows = await dc(this).readRows();
  const offenders = rows.filter((r) => r.reminderHistory.present).map((r) => r.email);
  await record(this, 'rows offering a Reminder History control', offenders);
  expect(
    offenders,
    'the Active and Requires Attention listings offer Reminder History; this one does not. If it '
    + 'has been added, give it coverage rather than deleting this assertion.'
  ).toEqual([]);
});

When('I click the View icon on the first Deactivated row', { timeout: SLOW }, async function () {
  await dc(this).openCandidateProfile(0);
});

When('I click the View icon on the second Deactivated row', { timeout: SLOW }, async function () {
  await dc(this).openCandidateProfile(1);
});

// "the right candidate" is the load-bearing half. A listing that always opened the first row's
// profile would satisfy a bare "I am on a view-profile page" check, and that is a disclosure
// problem as much as a navigation one - the document-verification module was caught by exactly
// this class of bug.
//
// Compared against the profile payload the app itself fetched, not against the rendered header:
// the header paints seconds after the route commits, and the payload is unambiguous.
Then("I should be on the noted candidate's view-profile page", { timeout: SLOW }, async function () {
  expect(this.dcNoted, 'no candidate was noted before View was clicked').toBeTruthy();

  await expect
    .poll(() => this.page.url(), { timeout: 30000, message: 'expected a view-profile route' })
    .toMatch(/\/candidates\/\d+\/view-profile/);

  const url = decodeURIComponent(this.page.url());
  const payload = await dc(this).profilePayload();
  await record(this, 'profile opened', { url, noted: this.dcNoted, payload });

  expect(
    payload,
    'the profile payload was never captured, so which candidate was opened cannot be established'
  ).toBeTruthy();

  const onScreen = [
    payload.email,
    payload.user && payload.user.email,
    `${(payload.user && payload.user.firstname) || ''} ${(payload.user && payload.user.lastname) || ''}`.trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const wanted = this.dcNoted.email.toLowerCase();
  const wantedName = this.dcNoted.name.toLowerCase();
  expect(
    onScreen.includes(wanted) || (wantedName && onScreen.includes(wantedName)),
    `View on the row for ${this.dcNoted.name} <${this.dcNoted.email}> opened ${url}, whose profile `
    + `payload identifies ${JSON.stringify(onScreen)}. The row action opened the wrong candidate.`
  ).toBe(true);
});

// The tabs are role="radio" in a role="radiogroup", NOT role="tab" - a getByRole('tab') reader
// finds nothing on a strip that plainly renders five. Polled, because the strip paints seconds
// after the "Profile" heading.
//
// This is the ONLY thing asserted about the profile here. Its header, widgets, every tab's
// contents and its Reminder History dialog belong to candidate-view-profile.feature, which
// already drives this screen from this very listing; a second implementation would drift.
Then('the profile should render its five tabs', { timeout: SLOW }, async function () {
  const tabs = await dc(this).profileTabs();
  await record(this, 'profile tab strip', tabs);
  expect(tabs).toEqual([
    'Candidate Details',
    'Track Progress',
    'Document Verification',
    'Subscription',
    'Activity Log',
  ]);
});

// ==================== pagination ====================

// The RULE, never the current state. The app asks for page_size=10 and this agent holds well
// under that, so no control renders today - and that is correct. Pinning "there is no pagination"
// goes red the day an 11th candidate is deactivated, which is not a defect; pinning "there is
// pagination" is red right now for the same reason. So the relationship between the two is what
// is asserted, and the branch taken is always reported.
Then(
  'the Deactivated pagination should be offered only when the list exceeds one page',
  { timeout: SLOW },
  async function () {
    const page = dc(this);
    const state = await page.paginationState();
    this.dcPagination = state;
    await record(this, 'pagination state', state);

    const pageSize = state.pageSize;
    expect(
      pageSize,
      'the page_size the app asked for could not be read off its own request, so the rule this '
      + 'scenario asserts has no basis - check the request log'
    ).toBeGreaterThan(0);

    const fitsOnOnePage = state.rows < pageSize;
    if (fitsOnOnePage) {
      expect(
        state.present,
        `${state.rows} row(s) fit inside a page of ${pageSize}, so no pagination control should be `
        + 'rendered. One is.'
      ).toBe(false);
    } else {
      expect(
        state.present,
        `the list filled a page of ${pageSize}, so a pagination control should be offered. None is - `
        + 'an agent cannot reach the candidates past the first page.'
      ).toBe(true);
    }
  }
);

// Exercises Next only when there is a second page to go to, and says so when there is not. A
// conditional assertion is honest here in a way a skipped scenario would not be: it reports, on
// every run, which branch the data put it in.
Then('if a second page exists, Next should request it from the server', { timeout: SLOW }, async function () {
  const state = this.dcPagination || (await dc(this).paginationState());
  if (!state.present || !state.next) {
    await record(this, 'Next was not exercised', {
      reason: `the list holds ${state.rows} row(s) against a page size of ${state.pageSize}, so there is no second page`,
      state,
    });
    return;
  }
  const sent = await dc(this).goToNextPage();
  await record(this, 'went to page 2', { sent, url: decodeURIComponent(this.page.url()) });
  expect(sent, 'clicking Next fired no list request').toBeTruthy();
  expect(sent, 'Next should ask the server for page 2').toContain('page=2');
});

// ==================== empty states ====================

// TWO empty states with different wording, and they are not interchangeable: one describes a
// listing with nothing on it, the other a query matching nothing.
//
// >>> THE TAB-LEVEL STATE IS UNREACHABLE ON THIS FIXTURE AND THIS STEP SAYS SO RATHER THAN
// PRETENDING. <<< What it asserts without it is the half that can actually go wrong - that the
// no-results state is NOT worded as the tab-level one, i.e. the app does not use one message for
// both causes. When the listing ever IS empty, the tab-level wording is asserted verbatim
// instead, so the step strengthens by itself the day the fixture allows it.
Then(
  'the Deactivated empty state should be worded for whichever cause applies',
  { timeout: SLOW },
  async function () {
    const page = dc(this);
    const { results, tab } = DeactivatedCandidatePage.EMPTY_STATES;

    await page.navigate();
    const rows = await page.rowCount();

    if (rows === 0) {
      const state = await page.readEmptyState();
      await record(this, 'the listing is empty - asserting the TAB-LEVEL wording', state);
      expect(state, 'the listing holds no rows but renders no empty state at all').toBeTruthy();
      expect(state.heading).toBe(tab.heading);
      expect(state.body).toBe(tab.body);
      return;
    }

    // Not reachable today: reach the other state and prove the two are worded apart.
    await page.search('ZZZNONEXISTENT999');
    const state = await page.readEmptyState();
    await record(this, 'the NO-RESULTS wording (the tab-level one is unreachable on this fixture)', {
      rendered: state,
      expectedForNoResults: results,
      expectedForAnEmptyTab: tab,
      note:
        `This agent holds ${rows} deactivated candidate(s), so the tab-level empty state cannot be `
        + 'observed here, and the dedicated zero-candidate agent\'s login currently times out. What '
        + 'is asserted instead is that the app does not use ONE message for BOTH causes. Give this '
        + 'step an agent with no deactivated candidates and it asserts the tab-level wording verbatim.',
    });

    expect(state, 'a search matching nothing rendered no empty state').toBeTruthy();
    expect(state.heading, 'the no-results heading').toBe(results.heading);
    expect(state.body, 'the no-results body').toBe(results.body);
    expect(
      state.heading,
      'the no-results state must not be worded as the empty-listing state - a single message for '
      + 'both causes tells an agent with no deactivated candidates that their SEARCH failed'
    ).not.toBe(tab.heading);

    await page.clearSearch();
  }
);

// ==================== end to end ====================

When('I note the current Deactivated URL', async function () {
  this.dcUrl = this.page.url();
  await record(this, 'noted URL', decodeURIComponent(this.dcUrl));
});

Then('the Deactivated URL should be unchanged', async function () {
  expect(decodeURIComponent(this.page.url())).toBe(decodeURIComponent(this.dcUrl));
});

// The browser's own Back, because this profile carries NO Back control - measured 2026-09-21,
// zero elements whose text is "Back". Back DOES restore the filter, the badge, the search term
// and the rows, which is what the steps after this one assert.
When('I go back to the Deactivated listing', { timeout: SLOW }, async function () {
  await this.page.goBack({ waitUntil: 'domcontentloaded' });
  await dc(this).settleRows(20000);
  await record(this, 'after browser Back', decodeURIComponent(this.page.url()));
});

When('I note the unfiltered Deactivated count', async function () {
  this.dcUnfilteredCount = await dc(this).rowCount();
  await record(this, 'unfiltered Deactivated count', this.dcUnfilteredCount);
});

Then('the listed Deactivated count should be no greater than the unfiltered count', async function () {
  const now = await dc(this).rowCount();
  await record(this, 'filtered vs unfiltered', { filtered: now, unfiltered: this.dcUnfilteredCount });
  expect(
    now,
    `a filter cannot return more rows than the unfiltered list (${now} > ${this.dcUnfilteredCount})`
  ).toBeLessThanOrEqual(this.dcUnfilteredCount);
});
