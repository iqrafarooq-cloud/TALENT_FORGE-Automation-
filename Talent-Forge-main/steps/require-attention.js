// Step definitions for features/Agent_Portal/require-attention.feature -
// Agent Portal > Candidates > Requires Attention: the three severity tabs, search, the filter
// modal, pagination, and the two row actions (View + Reminder History).
//
// >>> EVERY PHRASE HERE IS DELIBERATELY WORDED "Requires Attention ...". <<<
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - which counts as neither a pass nor a failure and is easy to miss in the
// summary (playwright-bdd fails generation on it instead). steps/active-candidate.js already
// owns the generic listing vocabulary ("the candidate table has at least one record visible",
// "the filter modal should be visible", "no filter option should be selected in the modal", ...)
// and every one of those is BOUND TO `this.pages.activeCandidate`, so they could not be reused
// here even if the wording were free: they would drive the Active tab while this feature is on
// Requires Attention, and pass or fail against the wrong page.
//
// Exactly three phrases ARE reused from active-candidate.js, and only because each is genuinely
// page-agnostic - they read `this.page.url()` / `this.searchTerm` and touch no page object:
//     Given I am logged in as an agent
//     Then the URL should contain the search term
//     Then the URL should contain the filter "<fragment>"
//
// Nothing in this file mutates anything. There is no Send Reminder control on this tab - the row
// actions are View and Reminder History only - so no scenario can send a reminder, and the whole
// feature is safe in the default run.

const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const RequiresAttentionPage = require('../pages/RequiresAttentionPage');

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

const ra = (world) => world.pages.requiresAttention;

// ==================== Background ====================

Given('I am on the Candidates Requires Attention tab', async function () {
  await ra(this).navigate();
});

Given('the Requires Attention table has at least one record visible', async function () {
  const page = ra(this);
  await page.settleRows();
  const count = await page.rowCount();
  expect(count, 'expected at least one candidate row on Requires Attention').toBeGreaterThan(0);
  this.raUnfilteredCount = count;
});

// ==================== structure ====================

Then('the Requires Attention heading should be displayed', async function () {
  await expect(ra(this).pageHeading).toBeVisible({ timeout: 20000 });
  // The heading reads just "Candidates" now, so it no longer identifies the tab - the route does.
  expect(new URL(this.page.url()).pathname, 'the Requires Attention route').toBe('/candidates/requires-attention');
});

Then('the Requires Attention table should be visible', async function () {
  await expect(ra(this).table).toBeVisible({ timeout: 20000 });
});

// EXACTLY these columns, in this order - not merely "each is present". An extra column silently
// shifts every gridcell index the row readers depend on (Issue=0, Severity=1, Last Activity=2),
// so a tolerant check here would let every later severity assertion read the wrong cell.
Then('the Requires Attention table should display exactly these columns:', async function (dataTable) {
  const expected = dataTable.raw().map(([c]) => c.trim());
  const actual = (await ra(this).columnHeaders()).map((h) => h.trim());
  await record(this, 'Requires Attention column headers', { expected, actual });
  expect(actual, 'the grid columns, in order').toEqual(expected);
});

Then('the severity tab strip should offer exactly these tabs:', async function (dataTable) {
  const expected = dataTable.raw().map(([t]) => t.trim());
  const actual = (await ra(this).tabLabels()).map((t) => t.trim()).filter(Boolean);
  await record(this, 'Severity tab strip', { expected, actual });
  expect(actual, 'the severity tabs, in order').toEqual(expected);
});

// ==================== severity tabs ====================

When('I click the {string} severity tab', async function (label) {
  await ra(this).clickTab(label);
});

Then('the {string} severity tab should be active', async function (label) {
  const page = ra(this);
  await expect
    .poll(() => page.isTabActive(label), {
      timeout: 10000,
      message: `the "${label}" severity tab should be selected. URL: ${this.page.url()}`,
    })
    .toBe(true);
});

// Walks all three tabs and collects every problem before throwing once. Cucumber abandons a
// scenario at its first failing step, and there are three independent things to check per tab -
// reporting only the first would hide whether the other two share a cause.
//
// CONTENT IS ASSERTED ONLY WHERE ROWS EXIST. The Warning tab holds no candidate in this
// environment, so requiring rows would be red against a tab behaving perfectly; the empty state
// it renders instead has its own scenario. What is always asserted is the URL value and the
// severity the app SENT - neither of which depends on there being data.
Then('each severity tab should filter the list by its own severity:', async function (dataTable) {
  const page = ra(this);
  const rows = dataTable.hashes();
  const problems = [];
  const evidence = [];

  for (const row of rows) {
    const tab = row.tab.trim();
    const baseline = page.requestCount();
    await page.clickTab(tab);

    const url = decodeURIComponent(this.page.url());
    const sent = page.requestsSince(baseline);
    const listed = await page.readRows();
    const severities = [...new Set(listed.map((r) => r.severity).filter(Boolean))];

    evidence.push({ tab, url, sent, rows: listed.length, severities });

    if (row.urlParam && row.urlParam.trim() && !url.includes(row.urlParam.trim())) {
      problems.push(`"${tab}": the URL should carry ${row.urlParam.trim()} - it read ${url}`);
    }

    const apiParam = (row.apiParam || '').trim();
    if (apiParam) {
      if (!sent.some((q) => q.includes(apiParam))) {
        problems.push(
          `"${tab}": no request carried ${apiParam}. Requests made: ${JSON.stringify(sent)}`
        );
      }
    } else if (sent.length && sent.some((q) => /severity=/.test(q))) {
      // The All tab must send NO severity at all - sending one would mean it is silently a
      // severity view, which is a different product from the one the tab strip describes.
      problems.push(
        `"${tab}": expected no severity param, but a request carried one: ${JSON.stringify(sent)}`
      );
    }

    const wantSeverity = (row.severity || '').trim();
    if (wantSeverity && listed.length) {
      const wrong = severities.filter((s) => !new RegExp(escapeRegExp(wantSeverity), 'i').test(s));
      if (wrong.length) {
        problems.push(
          `"${tab}": every row should read "${wantSeverity}" in the Severity column, but the `
          + `list also showed ${JSON.stringify(wrong)}`
        );
      }
    }
  }

  await record(this, 'Severity tab -> URL, request and rendered severities', evidence);
  if (problems.length) {
    throw new Error(
      `${problems.length} severity-tab problem(s):\n - ${problems.join('\n - ')}`
    );
  }
});

When('I open the Requires Attention tab at {string}', async function (query) {
  const page = ra(this);
  page.install();
  await page.loadUrlCapturingRequest(`${page.url}${query}`);
});

When('I reload the Requires Attention list', async function () {
  const page = ra(this);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await page.settleRows();
});

// ==================== empty states ====================

// Re-reads the page every time rather than reusing a snapshot. The Warning-vs-no-results
// scenario asserts one wording, adds a search, and asserts a second - a cached read would pass
// the second no matter what the app rendered.
//
// EXACT, not `includes`: an `includes` check would go on passing if a sub-line were added later,
// and the whole point of this scenario is that the two states are worded differently.
Then('the Requires Attention empty state should read exactly:', async function (dataTable) {
  const page = ra(this);
  const want = dataTable.rowsHash();
  let state = null;
  await expect
    .poll(
      async () => {
        state = await page.readEmptyState();
        return state ? state.heading : null;
      },
      { timeout: 15000, message: 'an empty state should be rendered' }
    )
    .toBeTruthy();

  await record(this, 'Empty state as rendered', state);
  this.raEmptyStates = this.raEmptyStates || [];
  this.raEmptyStates.push(state);

  const problems = [];
  if (want.heading && state.heading.trim() !== want.heading.trim()) {
    problems.push(`heading: expected "${want.heading.trim()}", read "${state.heading.trim()}"`);
  }
  if (want.body && !state.body.includes(want.body.trim())) {
    problems.push(`body: expected "${want.body.trim()}", read "${state.body}"`);
  }
  if (problems.length) {
    throw new Error(
      `The empty state does not read as expected:\n - ${problems.join('\n - ')}\n\n`
      + `Whole state as rendered: ${JSON.stringify(state.lines)}`
    );
  }
});

Then('the two empty states should have different wording', async function () {
  const seen = this.raEmptyStates || [];
  expect(seen.length, 'two empty states should have been read by this point').toBeGreaterThanOrEqual(2);
  const [first, second] = seen.slice(-2);
  await record(this, 'The two empty states compared', { first, second });
  expect(
    first.heading.trim(),
    'the per-tab empty state and the no-results empty state should not be worded identically - '
    + 'if they have been unified, this scenario and the page object\'s EMPTY_STATES need updating'
  ).not.toBe(second.heading.trim());
});

Then('the Requires Attention empty state should be displayed', async function () {
  const page = ra(this);
  let state = null;
  await expect
    .poll(
      async () => {
        state = await page.readEmptyState();
        return !!state;
      },
      { timeout: 15000, message: 'an empty state should be rendered' }
    )
    .toBe(true);
  await record(this, 'Empty state as rendered', state);
});

// ==================== search ====================

When('I search the Requires Attention list for {string}', async function (term) {
  this.searchTerm = term;
  this.raSearchBaseline = ra(this).requestCount();
  await ra(this).search(term);
});

// Drives the search with the first visible candidate's REAL value, so the query always matches
// live data rather than a hardcoded term. "name" uses the first name token (the full name is one
// row's value and would make the multi-row assertion vacuous); "email" uses the whole address,
// which is unique and so must return exactly one row.
When("I search the Requires Attention list by the first candidate's {word}", async function (field) {
  const page = ra(this);
  const { name, email } = await page.firstCandidate();
  const term = /email/i.test(field) ? email : name.split(/\s+/)[0] || '';
  expect(term, `the first candidate row should expose a ${field}`).toBeTruthy();
  this.searchTerm = term;
  this.raSearchBaseline = page.requestCount();
  await page.search(term);
});

When('I clear the Requires Attention search', async function () {
  await ra(this).clearSearch();
});

Then('the Requires Attention search box should be empty', async function () {
  expect(await ra(this).getSearchValue()).toBe('');
});

// Polls an ATOMIC snapshot of every row's Candidate cell (name + email are the two fields the
// app searches) and requires every visible row to contain the term. Polled because the grid
// keeps the previous query's rows while the next is in flight.
Then('every listed candidate should match the search term', async function () {
  const page = ra(this);
  const re = new RegExp(escapeRegExp(this.searchTerm), 'i');
  let seen = [];
  await expect
    .poll(
      async () => {
        seen = await page.visibleRowHeaders();
        return seen.length > 0 && seen.every((t) => re.test(t));
      },
      {
        timeout: 15000,
        message: `every listed row's name or email should contain "${this.searchTerm}"`,
      }
    )
    .toBe(true);
  await record(this, `Rows listed for search "${this.searchTerm}"`, seen);
});

Then('exactly one candidate should be listed', async function () {
  const page = ra(this);
  await expect
    .poll(() => page.rowCount(), {
      timeout: 15000,
      message: 'a full email address is unique, so exactly one row should be listed',
    })
    .toBe(1);
});

// Counts rows the grid still holds AND rows that actually show a candidate, so a grid stuck on
// blank placeholder rows (measured 2026-10-05 for a filter matching nothing) is named as that
// rather than reported as "10 candidates listed".
Then('no candidate should be listed', async function () {
  const page = ra(this);
  let rows = 0;
  let withContent = 0;
  await expect
    .poll(
      async () => {
        rows = await page.rowCount();
        withContent = (await page.visibleRowHeaders()).filter(Boolean).length;
        return rows;
      },
      { timeout: 15000 }
    )
    .toBe(0)
    .catch(() => {});
  const server = page.lastPayloadCount ? page.lastPayloadCount() : undefined;
  await record(this, 'Rows after the query', { domRows: rows, rowsShowingACandidate: withContent, serverCount: server });
  expect(
    rows,
    withContent === 0 && rows > 0
      ? `the grid still holds ${rows} BLANK placeholder rows (none shows a candidate) instead of clearing them for an empty result`
      : 'no candidate row should be listed'
  ).toBe(0);
});

// Compared against the count taken BEFORE the search, not against a fixed number: this account's
// flagged-candidate list changes as the product's own cron flags and clears candidates.
Then('the listed candidate count should be back to its unfiltered value', async function () {
  const page = ra(this);
  const want = this.raUnfilteredCount;
  expect(want, 'the unfiltered count should have been recorded by an earlier step').toBeGreaterThan(0);
  await expect
    .poll(() => page.rowCount(), {
      timeout: 15000,
      message: `the list should be back to its unfiltered ${want} row(s)`,
    })
    .toBe(want);
});

// Three variations in ONE step, collected and reported together: they are three cases of one
// rule, and as consecutive When/Then pairs only the first would ever be reported.
Then("the search should match these variations of the first candidate's details:", async function (dataTable) {
  const page = ra(this);
  const { name, email } = await page.firstCandidate();
  const variations = {
    'name in upper case': name.toUpperCase(),
    'name in lower case': name.toLowerCase(),
    'first eight of email': email.split('@')[0].slice(0, 8),
  };

  const problems = [];
  const evidence = [];
  for (const [label] of dataTable.rows()) {
    const key = label.trim();
    const term = variations[key];
    if (term === undefined) {
      problems.push(`"${key}" is not a variation this step knows: ${Object.keys(variations).join(', ')}`);
      continue;
    }
    await page.clearSearch();
    await page.search(term);
    const rows = await page.visibleRowHeaders();
    const re = new RegExp(escapeRegExp(term), 'i');
    evidence.push({ variation: key, term, rows: rows.length, matched: rows.filter((r) => re.test(r)).length });

    if (!rows.length) {
      problems.push(`"${key}" (${JSON.stringify(term)}) matched no candidate at all`);
      continue;
    }
    // Case-insensitivity is the claim, so the term is compared case-insensitively against each
    // row - a row that matches only when the case is ignored is exactly the evidence wanted.
    const wrong = rows.filter((r) => !re.test(r));
    if (wrong.length) {
      problems.push(
        `"${key}" (${JSON.stringify(term)}) also listed non-matching row(s): ${JSON.stringify(wrong)}`
      );
    }
  }

  await record(this, 'Search variations', evidence);
  if (problems.length) {
    throw new Error(`${problems.length} search-variation problem(s):\n - ${problems.join('\n - ')}`);
  }
});

// The placeholder is pinned verbatim (product decision 2026-10-05). Read off the input itself.
Then('the Requires Attention search placeholder should read {string}', async function (expected) {
  const placeholder = await ra(this).searchPlaceholder();
  await record(this, 'Search placeholder', placeholder);
  expect(placeholder, 'the search box placeholder').toBe(expected);
});

Then('the Requires Attention page should still be usable', async function () {
  const page = ra(this);
  await expect(page.pageHeading, 'the page heading should survive an empty result').toBeVisible();
  await expect(page.searchInput, 'the search box should survive an empty result').toBeVisible();
  await expect(page.filtersButton, 'the Filters button should survive an empty result').toBeVisible();
});

Then('the URL should not contain a search parameter', async function () {
  const url = decodeURIComponent(this.page.url());
  await record(this, 'URL after a blank search', url);
  expect(url, 'a blank search should not be written into the URL').not.toMatch(/[?&]search=\S/);
});

// Recorded, never failed on. The outcome the user sees is correct; the divergence is that the
// request is made at all. The SuperAdmin candidates listing does the same and the Agents listing
// suppresses it - three surfaces, two behaviours, and no AC saying which is right.
Then('whatever the app sent for a blank search should be reported', async function () {
  const page = ra(this);
  const sent = page.requestsSince(this.raSearchBaseline || 0);
  const carried = sent.filter((q) => /search=\S/.test(q));
  await record(
    this,
    'Blank search: what the app sent',
    {
      requestsMade: sent,
      requestsCarryingTheBlankTerm: carried,
      finding: carried.length
        ? 'The whitespace-only term WAS sent to the server (one wasted round trip). The list came '
          + 'back unfiltered, so the outcome is correct. The SuperAdmin candidates listing behaves '
          + 'the same way; the Agents listing suppresses the request entirely. Recorded rather '
          + 'than failed on - ask the PO which is house style.'
        : 'The app suppressed the request for a whitespace-only term, matching the Agents listing.',
    }
  );
});

// ==================== the request the app sent ====================

// Asserts what went ON THE WIRE, which neither the URL nor the rendered rows can establish: a
// front end that rewrites the address bar and queries the server for something else looks
// correct in both. That is not hypothetical here - see the severity-filter-vs-tab scenario.
Then('the request the app sent should carry {string}', async function (fragment) {
  const page = ra(this);
  await expect
    .poll(() => page.requestsSince(0).some((q) => q.includes(fragment)), {
      timeout: 15000,
      message:
        `some list request should have carried "${fragment}". `
        + `Requests made: ${JSON.stringify(page.requestsSince(0))}`,
    })
    .toBe(true);
  await record(this, `Requests made (looking for "${fragment}")`, page.requestsSince(0));
});

Then('the request the app sent should carry the search term', async function () {
  const page = ra(this);
  const want = `search=${this.searchTerm}`;
  await expect
    .poll(() => page.requestsSince(0).some((q) => q.includes(want)), {
      timeout: 15000,
      message:
        `some list request should have carried "${want}". `
        + `Requests made: ${JSON.stringify(page.requestsSince(0))}`,
    })
    .toBe(true);
});

// ==================== filter modal ====================

Given('the Requires Attention Warning tab will return no candidates', async function () {
  await this.page.route(/\/candidate\/requires-attention\/\?.*severity=warning/, (route) =>
    route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } })
  );
});

When('I open the Requires Attention filters', async function () {
  await ra(this).openFilters();
});

Then('the Requires Attention filter modal should be visible', async function () {
  await expect(ra(this).filterModal).toBeVisible({ timeout: 10000 });
});

Then('the Requires Attention filter modal should not be visible', async function () {
  await expect(ra(this).filterModal).toBeHidden({ timeout: 10000 });
});

// Asserts the groups, their options AND the control type each group uses.
//
// The control type is not decoration: it decides what a second selection in a group MEANS -
// a checkbox adds, a radio REPLACES - and two scenarios in this feature depend on the
// difference. It is also the thing a testid-only reader gets wrong, since the four Last Activity
// radios carry no data-testid at all and would simply be missing from the list.
Then('the filter modal should offer exactly these groups and options:', async function (dataTable) {
  const page = ra(this);
  const rendered = await page.readFilterGroups();
  const options = await page.readFilterOptions();
  await record(this, 'Filter modal as rendered', { groups: rendered, options });

  const problems = [];
  const expectedGroups = [];
  for (const row of dataTable.hashes()) {
    const group = row.group.trim();
    expectedGroups.push(group);
    const wantOptions = row.options.split(',').map((o) => o.trim()).filter(Boolean);
    const wantControl = row.control.trim();

    if (!rendered[group]) {
      problems.push(
        `the "${group}" group is not rendered. Groups found: ${JSON.stringify(Object.keys(rendered))}`
      );
      continue;
    }
    if (JSON.stringify(rendered[group]) !== JSON.stringify(wantOptions)) {
      problems.push(
        `"${group}" options: expected ${JSON.stringify(wantOptions)}, `
        + `rendered ${JSON.stringify(rendered[group])}`
      );
    }
    for (const opt of wantOptions) {
      const found = options.find((o) => o.text.toLowerCase() === opt.toLowerCase());
      if (!found) {
        problems.push(`"${group}" / "${opt}" has no <label> in the modal`);
      } else if (found.control !== wantControl) {
        problems.push(
          `"${group}" / "${opt}" should be a ${wantControl}, but its input is a ${found.control}`
        );
      }
    }
  }

  const extra = Object.keys(rendered).filter((g) => !expectedGroups.includes(g));
  if (extra.length) problems.push(`unexpected filter group(s) rendered: ${JSON.stringify(extra)}`);

  if (problems.length) {
    throw new Error(`${problems.length} filter-modal problem(s):\n - ${problems.join('\n - ')}`);
  }
});

Then(
  'the filter modal should offer a {string}, {string} and {string} control',
  async function (a, b, c) {
    const modal = ra(this).filterModal;
    for (const label of [a, b, c]) {
      await expect(
        modal.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first(),
        `the filter modal should offer a "${label}" control`
      ).toBeVisible({ timeout: 10000 });
    }
  }
);

When('I select the {string} filter option', async function (label) {
  await ra(this).selectFilterOption(label);
});

When('I apply the Requires Attention filters', async function () {
  this.raFilterBaseline = ra(this).requestCount();
  await ra(this).applyFilters();
});

When('I clear all Requires Attention filters', async function () {
  await ra(this).clearAllFilters();
});

When('I cancel the Requires Attention filters', async function () {
  await ra(this).cancelFilters();
});

When('I close the Requires Attention filter modal via {string}', async function (method) {
  await ra(this).closeFilterModal(method);
});

Then('no Requires Attention filter option should be selected', async function () {
  const page = ra(this);
  const selected = (await page.readFilterOptions()).filter((o) => o.checked);
  await record(this, 'Selected filter options', selected);
  expect(selected.map((o) => o.text), 'no option should remain selected').toEqual([]);
});

Then('the selected Requires Attention filter options should be {string}', async function (list) {
  const want = list.split(',').map((x) => x.trim()).filter(Boolean);
  const selected = (await ra(this).readFilterOptions()).filter((o) => o.checked).map((o) => o.text.trim());
  await record(this, 'Selected filter options', selected);
  expect(selected, 'the options ticked in the modal').toEqual(want);
});

// The Last Updated choice is not sent as a value: the app turns it into an ISO window
// (last_updated_after / last_updated_before). The WIDTH of that window is what proves which range
// was applied - a check for "last_updated_after=" alone passes on any range at all.
Then('the latest Requires Attention request should cover the last {int} days', async function (days) {
  const page = ra(this);
  let q = null;
  await expect
    .poll(() => {
      q = page.requestsSince(0).filter((x) => x.includes('last_updated_after=')).pop() || null;
      return Boolean(q);
    }, { timeout: 15000, message: `no list request carried a Last Updated window. Requests: ${JSON.stringify(page.requestsSince(0))}` })
    .toBe(true);
  const params = new URLSearchParams(q.replace(/^[^?]*\?/, ''));
  const after = Date.parse(`${params.get('last_updated_after')}Z`);
  const before = Date.parse(`${params.get('last_updated_before')}Z`);
  const width = (before - after) / 864e5;
  await record(this, 'Last Updated window sent', { query: q, widthInDays: width });
  expect(Math.abs(width - days), `the request covers ${width.toFixed(2)} days, expected ${days}`).toBeLessThan(0.05);
});

// Applies every option in turn from a clean page, and checks the URL **and** the request. Both,
// because either alone can pass on a broken filter: the URL is written by the front end and the
// rows can be identical for two different queries.
Then(
  'applying each filter option should update the URL and the request sent:',
  { timeout: 300000 },
  async function (dataTable) {
    const page = ra(this);
    const problems = [];
    const evidence = [];

    for (const row of dataTable.hashes()) {
      const group = row.group.trim();
      const option = row.option.trim();
      const urlParam = row.urlParam.trim();
      const apiParam = row.apiParam.trim();

      await page.navigate();
      const baseline = page.requestCount();
      await page.openFilters();
      await page.selectFilterOption(option);
      await page.applyFilters();

      const url = decodeURIComponent(this.page.url());
      const sent = page.requestsSince(baseline);
      evidence.push({ group, option, url: url.split('?')[1] || '', sent, rows: await page.rowCount() });

      if (!url.includes(urlParam)) {
        problems.push(`${group} / "${option}": the URL should carry ${urlParam} - it read ${url}`);
      }
      if (!sent.some((q) => q.includes(apiParam))) {
        problems.push(
          `${group} / "${option}": no request carried ${apiParam}. Requests: ${JSON.stringify(sent)}`
        );
      }
    }

    await record(this, 'Filter option -> URL and request sent', evidence);
    if (problems.length) {
      throw new Error(
        `${problems.length} filter-option problem(s):\n - ${problems.join('\n - ')}\n\n`
        + 'NOTE: Last Activity is deliberately checked for `last_updated_after=` only - the app '
        + 'translates the choice into an ISO timestamp range, so the exact value moves with the '
        + 'clock and cannot be pinned.'
      );
    }
  }
);

Then(
  'the Requires Attention Filters button should show an applied-filter count of {string}',
  async function (expected) {
    const page = ra(this);
    const want = parseInt(expected, 10);
    await expect
      .poll(() => page.appliedFilterCount(), {
        timeout: 10000,
        message:
          `the Filters button should read "Filters ${want}". Note this badge counts GROUPS, not `
          + 'options (measured) - the Active tab\'s badge counts options, so the two listings '
          + 'disagree and neither is asserted against the other.',
      })
      .toBe(want);
  }
);

Then('the URL should not contain the filter {string}', async function (fragment) {
  expect(decodeURIComponent(this.page.url())).not.toContain(fragment);
});

Then('the URL should not contain any Requires Attention filter parameters', async function () {
  const url = decodeURIComponent(this.page.url());
  await record(this, 'URL after clearing/cancelling filters', url);
  for (const param of ['severity=', 'issueCategory=', 'lastUpdated=']) {
    expect(url, `the URL should not carry ${param} once filters are cleared`).not.toContain(param);
  }
});

// ==================== pagination ====================

Then('the Requires Attention pagination should be visible', async function () {
  await expect(ra(this).pagination).toBeVisible({ timeout: 15000 });
});

Then('the pagination should offer a {string} and a {string} control', async function (a, b) {
  const pag = ra(this).pagination;
  for (const label of [a, b]) {
    await expect(
      pag.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first(),
      `pagination should offer a "${label}" control`
    ).toBeVisible({ timeout: 10000 });
  }
});

Then('the pagination should offer at least one page number', async function () {
  const text = await ra(this).pagination.innerText();
  await record(this, 'Pagination as rendered', text.replace(/\s+/g, ' ').trim());
  expect(text, 'pagination should include a page number').toMatch(/\d+/);
});

When('I go to the next page of the Requires Attention list', async function () {
  const page = ra(this);
  const next = page.pagination.getByRole('button', { name: /Next/i }).first();
  await expect(next, 'a Next control should be offered').toBeVisible({ timeout: 15000 });
  await next.click();
  await page.settleRows();
  await this.page.waitForTimeout(600);
});

// ==================== row actions ====================

// Walks all three tabs and reports every row's two controls together. EXACTLY two: an extra
// action here would be a control nobody has specified (the Active tab has a bell, this tab must
// not), and a missing one leaves the agent no way to act on a flagged candidate.
Then(
  'every candidate row should offer exactly the View and Reminder History actions on each tab:',
  { timeout: 180000 },
  async function (dataTable) {
    const page = ra(this);
    const problems = [];
    const evidence = [];

    for (const [tab] of dataTable.raw()) {
      await page.clickTab(tab.trim());
      const rows = await page.readRows();
      evidence.push({
        tab: tab.trim(),
        rows: rows.length,
        actions: rows.map((r) => ({
          who: r.email || r.name,
          view: r.view,
          reminderHistory: r.reminderHistory,
        })),
      });

      // An empty tab is legitimate (Warning holds nothing today) - there is simply nothing to
      // assert, and saying so is better than passing silently.
      if (!rows.length) {
        evidence[evidence.length - 1].note = 'no rows on this tab - nothing to assert';
        continue;
      }
      for (const row of rows) {
        const who = row.email || row.name || '(unnamed row)';
        if (!row.view.present) problems.push(`"${tab.trim()}": ${who} offers no View action`);
        if (!row.reminderHistory.present) {
          problems.push(`"${tab.trim()}": ${who} offers no Reminder History action`);
        }
      }
    }

    await record(this, 'Row actions per severity tab', evidence);
    const inspected = evidence.reduce((n, e) => n + e.rows, 0);
    if (!inspected) {
      throw new Error(
        'No candidate row was inspected on any severity tab, so this scenario asserted nothing. '
        + `Evidence: ${JSON.stringify(evidence)}`
      );
    }
    if (problems.length) {
      throw new Error(
        `${problems.length} row-action problem(s) across ${inspected} row(s):\n - `
        + problems.join('\n - ')
      );
    }
  }
);

When('I note the first Requires Attention candidate', async function () {
  this.raCandidate = await ra(this).firstCandidate();
  await record(this, 'Candidate under test', this.raCandidate);
});

When('I note the current Requires Attention URL', async function () {
  this.raNotedUrl = this.page.url();
});

Then('the Requires Attention URL should be unchanged', async function () {
  expect(this.raNotedUrl, 'an earlier step should have noted the URL').toBeTruthy();
  expect(
    this.page.url(),
    'the Reminder History panel is a dialog, so it must not navigate away from the listing'
  ).toBe(this.raNotedUrl);
});

When('I click the View icon on the first Requires Attention row', async function () {
  await ra(this).openFirstCandidateProfile();
});

// The profile no longer carries a "Profile" heading (its <h1> reads "Candidates", re-measured
// 2026-10-05), so the screen is identified by its own tab strip instead.
Then("I should be on that candidate's profile page", async function () {
  await expect(this.page).toHaveURL(/\/candidates\/\d+\/view-profile/, { timeout: 20000 });
  await expect(this.page.getByRole('radio', { name: 'Candidate Details', exact: true }).first()).toBeVisible({
    timeout: 20000,
  });
  await record(this, 'Profile reached', decodeURIComponent(this.page.url()));
});

// The point of this assertion is that Requires Attention opens the SAME profile the Active and
// In Progress tabs open, rather than a reduced variant - so all five tabs are required, and the
// failure names the ones that are missing.
//
// >>> THE PROFILE'S TAB STRIP PAINTS SECONDS AFTER THE HEADING DOES, SO IT IS POLLED. <<<
// Measured 2026-09-09: this step read `["Candidates","Profile","En","FM","Reminder History"]` -
// the shell and the page heading, with NONE of the five tabs - and reported all five as missing
// on a profile that renders them perfectly about four seconds later. `I should be on that
// candidate's profile page` only waits for the URL and the "Profile" heading, and neither is
// evidence that the tab strip has arrived.
//
// A single read here could only ever answer "absent", which is exactly the failure mode this
// repo has paid for repeatedly. Polling also keeps the assertion honest in the other direction:
// a genuinely reduced profile still fails, it just takes the timeout to say so.
Then(
  'the profile should offer the same tabs the other candidate listings open:',
  { timeout: 90000 },
  async function (dataTable) {
    const expected = dataTable.raw().map(([t]) => t.trim());
    const readControls = () =>
      this.page.$$eval('[role="radio"], [role="tab"], button', (els) =>
        els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
      );

    let rendered = [];
    let missing = expected;
    await expect
      .poll(
        async () => {
          rendered = [...new Set(await readControls())];
          missing = expected.filter((t) => !rendered.some((r) => r.toLowerCase() === t.toLowerCase()));
          return missing.length;
        },
        {
          timeout: 45000,
          message: 'the profile tab strip should render every tab the other listings open',
        }
      )
      .toBe(0);

    await record(this, 'Profile tabs rendered', { expected, rendered });
    if (missing.length) {
      throw new Error(
        `The profile opened from Requires Attention is missing ${missing.length} of the tabs the `
        + `other candidate listings open: ${JSON.stringify(missing)}\n`
        + `Controls rendered: ${JSON.stringify(rendered)}`
      );
    }
  }
);

// ==================== reminder history ====================

// Opens the first row whose Reminder History is ENABLED: the icon is disabled for a candidate with
// no reminders, and the first row is not guaranteed to have any (it had none on 2026-10-05, which
// made every Reminder History scenario wait 30s on a disabled button). The candidate is re-noted
// from THAT row, so "the panel names that candidate" still compares against the row clicked.
When('I open the Reminder History for the first Requires Attention row', async function () {
  const page = ra(this);
  const index = await page.firstEnabledReminderIndex();
  expect(index, 'no row on this page has an enabled Reminder History icon').toBeGreaterThanOrEqual(0);
  if (index > 0) this.raCandidate = await page.candidateAt(index);
  this.raReminderFetch = await page.openReminderHistory(index);
  await record(this, 'Reminder History request', {
    endpoint: this.raReminderFetch.endpoint,
    remindersReturned: this.raReminderFetch.fetched,
  });
});

Then('the Reminder History panel should be displayed', async function () {
  await expect(ra(this).reminderHistoryPanel).toBeVisible({ timeout: 15000 });
});

Then('the Reminder History panel should be displayed for that candidate', async function () {
  const page = ra(this);
  await expect(page.reminderHistoryPanel).toBeVisible({ timeout: 15000 });
  const history = await page.readReminderHistory();
  await record(this, 'Reminder History panel', history);

  expect(history.heading, 'the panel should be headed "Reminder History"').toBeTruthy();
  const who = this.raCandidate && this.raCandidate.name;
  expect(who, 'an earlier step should have noted the candidate').toBeTruthy();
  // The panel must name the candidate whose row was clicked. A panel that always shows the first
  // candidate's history is a disclosure problem as much as a rendering one, and it is invisible
  // unless the name is compared against the row.
  expect(
    (history.lines || []).join(' | '),
    `the panel should name the candidate whose row was clicked ("${who}")`
  ).toContain(who);
});

// Each entry must carry BOTH a title and a "Sent" date. A panel listing bare titles with no
// timestamps is not a reminder history, and a presence check on either alone would pass on it.
Then('every reminder listed should carry a title and the date it was sent', async function () {
  const history = await ra(this).readReminderHistory();
  await record(this, 'Reminder entries', history.entries);

  if (!history.entries.length) {
    throw new Error(
      'The Reminder History panel listed no reminder at all. Note the panel opens EMPTY and fills '
      + `from GET /agent/candidate/<id>/reminders/, which returned `
      + `${JSON.stringify((this.raReminderFetch || {}).fetched)} row(s) - so if that number is `
      + `non-zero this is a RENDERING failure, not an empty history.\n`
      + `Panel as rendered: ${JSON.stringify(history.lines)}`
    );
  }

  const problems = [];
  for (const entry of history.entries) {
    if (!entry.title || /^Sent/i.test(entry.title)) {
      problems.push(`an entry carries no title: ${JSON.stringify(entry)}`);
    }
    // A date, not merely the word "Sent" - "Sent • " with nothing after it would otherwise pass.
    if (!/\d/.test(entry.sent || '')) {
      problems.push(`"${entry.title}" carries no date: ${JSON.stringify(entry.sent)}`);
    }
  }
  if (problems.length) {
    throw new Error(
      `${problems.length} reminder entry problem(s):\n - ${problems.join('\n - ')}`
    );
  }
});

// Compares the RENDER against what the server returned, not against a fixed number: this
// account's history grows every time the product's reminder cron runs, so any pinned count would
// rot. `results.length`, never `count` - the endpoint pages at 10, so a higher `count` is
// correct and the panel legitimately shows one page of it.
Then('the reminders listed should match the ones the server returned', async function () {
  const fetch = this.raReminderFetch || {};
  const history = await ra(this).readReminderHistory();
  await record(this, 'Rendered vs fetched reminders', {
    rendered: history.entries.length,
    fetched: fetch.fetched,
    endpoint: fetch.endpoint,
    hasViewMore: history.hasViewMore,
  });

  if (fetch.fetched === null || fetch.fetched === undefined) {
    throw new Error(
      'The reminders request was never observed, so what the panel shows cannot be checked '
      + `against it. Endpoint expected: GET /core/api/v1/agent/candidate/<id>/reminders/. `
      + `Panel as rendered: ${JSON.stringify(history.lines)}`
    );
  }
  expect(
    history.entries.length,
    `the panel should render the ${fetch.fetched} reminder(s) the server returned `
    + `(${fetch.endpoint})`
  ).toBe(fetch.fetched);
});

When('I close the Reminder History panel via {string}', async function (method) {
  await ra(this).closeReminderHistory(method);
});

Then('the Reminder History panel should not be displayed', async function () {
  await expect(ra(this).reminderHistoryPanel).toBeHidden({ timeout: 15000 });
});

// Proves an ABSENCE, so it watches a window rather than sampling once: a "not visible" read is
// also true of a panel the app has not rendered YET, so a single check on a settling page
// reports "no panel" for one that appears a moment later - and this step exists to prove none
// opens unprompted.
Then('no Reminder History panel should open on its own', async function () {
  const page = ra(this);
  const stayedClosed = await page.reminderHistoryStaysClosed(2500);
  await record(this, 'Reminder History unprompted', {
    stayedClosed,
    reminderHistoryButtons: await page.reminderHistoryButtons.count(),
  });
  expect(
    stayedClosed,
    'no Reminder History dialog should be open until its row icon is clicked'
  ).toBe(true);
});

module.exports = { RequiresAttentionPage };
