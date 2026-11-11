const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const AgentsListingPage = require('../pages/AgentsListingPage');
require('dotenv').config();

// Step definitions for features/SuperAdmin_Portal/UserManagement/Agent.feature.
//
// `Given I am logged in as the superadmin` is NOT defined here — invite-agent.steps.js owns
// it and Cucumber loads every step file into one registry, so defining it again would throw
// an ambiguous-step error and take both features down.
//
// TWO RULES THIS FILE FOLLOWS THROUGHOUT, both learned the hard way in this repo:
//
// 1. ANYTHING THAT ASSERTS WHAT THE LIST CONTAINS READS THE SERVER'S PAYLOAD, never scraped
//    rows. The grid keeps the previous query's rows on screen while the next one is in
//    flight, so a DOM read after Apply returns the page that was already there — which is
//    how the first probe "found" that all eight filters were ignored when in fact every one
//    of them works. AgentsListingPage.runAndWaitForList() returns the payload; use it.
//
// 2. A STEP DRIVEN BY A DATA TABLE COLLECTS EVERY ROW'S FAILURE AND REPORTS THEM TOGETHER.
//    Cucumber abandons a scenario at its first failing step, so throwing on row 1 hides
//    rows 2..N. Each such step builds a `problems` array and throws once at the end with the
//    whole picture — which is also why these are single scenarios rather than Scenario
//    Outlines (an outline pays for a browser context and a superadmin login per example, and
//    still cannot say whether its examples failed for the same reason).

const listing = (world) => world.pages.agentsListing;
const profile = (world) => world.pages.agentProfile;
const agentsOf = (payload) => AgentsListingPage.agentsFrom(payload);

// Remember the last list request so URL/param/payload assertions can all read one source.
function remember(world, result) {
  world._lastList = result || { requestUrl: '', payload: null, requestFired: false };
  return world._lastList;
}

function lastPayloadAgents(world) {
  if (!world._lastList) {
    throw new Error('No agent list request has been captured yet — a Given/When that loads or filters the list has to run first.');
  }
  return agentsOf(world._lastList.payload);
}

// The subject an assertion is about. Steps that need one fail with a clear message rather
// than reading `undefined.email` three lines later.
function subject(world) {
  if (!world._agent || !world._agent.email) {
    throw new Error('No agent has been noted — use a Given that notes or finds an agent first.');
  }
  return world._agent;
}

// "1% - 25%" / "0" / "1-50" / "100+" -> a predicate over an agent from the payload, plus a
// human description for the failure message. Derived from the option LABEL so the table in
// the feature file stays the single place the ranges are written down.
function optionPredicate(group, option) {
  const g = String(group).trim().toLowerCase();
  const label = String(option).trim();
  const field = g === 'target progress' ? 'progress' : 'candidates';
  const plus = label.match(/^(\d+)\+$/);
  if (plus) {
    const min = Number(plus[1]);
    return { field, describe: `${field} > ${min}`, test: (a) => a[field] > min };
  }
  const range = label.replace(/%/g, '').split(/\s*-\s*/).map((n) => Number(n.trim()));
  if (range.length === 2 && range.every((n) => Number.isFinite(n))) {
    const [min, max] = range;
    return { field, describe: `${min} <= ${field} <= ${max}`, test: (a) => a[field] >= min && a[field] <= max };
  }
  const exact = Number(label);
  if (Number.isFinite(exact)) {
    return { field, describe: `${field} === ${exact}`, test: (a) => a[field] === exact };
  }
  throw new Error(`Cannot derive a range from option "${option}" under "${group}"`);
}

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

// ==================== Background / navigation ====================

Given('I am on the Agents listing', { timeout: 90000 }, async function () {
  const result = await listing(this).runAndWaitForList(async () => {
    await listing(this).goto('Active');
  });
  remember(this, result);
});

Given('I am on the {string} tab', { timeout: 90000 }, async function (tab) {
  const result = await listing(this).runAndWaitForList(async () => {
    await listing(this).goto(tab);
  });
  remember(this, result);
});

When('I open the {string} agents tab', { timeout: 90000 }, async function (tab) {
  const result = await listing(this).runAndWaitForList(async () => {
    await listing(this).openTab(tab);
  });
  remember(this, result);
});

When('I reload the Agents listing', { timeout: 90000 }, async function () {
  const result = await listing(this).runAndWaitForList(async () => {
    await this.page.reload();
  });
  remember(this, result);
});

Then('I should be on the Agents listing', async function () {
  expect(await listing(this).isOnListing(), `expected to be on /agents, actually ${this.page.url()}`).toBe(true);
});

// ==================== Noting a subject ====================

Given('I have noted the first agent on the Active tab', { timeout: 90000 }, async function () {
  const result = await listing(this).runAndWaitForList(async () => {
    await listing(this).goto('Active');
  });
  remember(this, result);
  await noteFirstAgent(this);
});

Given('I have noted the first agent on the current tab', { timeout: 90000 }, async function () {
  await noteFirstAgent(this);
});

// Take the first row that really holds an agent, and enrich it from the PAYLOAD so later
// numeric assertions compare against the server's own figures rather than re-parsed text.
async function noteFirstAgent(world) {
  const rows = (await listing(world).readRows()).filter((r) => r.email);
  if (!rows.length) {
    const empty = await listing(world).readEmptyState();
    throw new Error(`No agent rows on the current tab (${world.page.url()}). Empty state: ${JSON.stringify(empty)}`);
  }
  const row = rows[0];
  const fromApi = lastPayloadAgents(world).find((a) => a.email === row.email) || {};
  world._agent = {
    name: row.name,
    email: row.email,
    university: row.university || fromApi.university || '',
    status: row.status,
    cells: row.cells,
    candidates: Number.isFinite(fromApi.candidates) ? fromApi.candidates : Number(row.cells[2]),
    progress: Number.isFinite(fromApi.progress) ? fromApi.progress : null,
  };
  world.attach(`Subject agent: ${world._agent.name} <${world._agent.email}> `
    + `university="${world._agent.university}" candidates=${world._agent.candidates} progress=${world._agent.progress}%`, 'text/plain');
}

// The two fixture-finding Givens. They use the FILTERS to provision their own subject, which
// is what keeps this feature off the accounts the promo/referral/invite features own.
Given('I have found an agent with no active candidates', { timeout: 120000 }, async function () {
  await findAgentByCandidateBucket(this, '0', (a) => a.candidates === 0);
});

Given('I have found an agent holding active candidates', { timeout: 120000 }, async function () {
  await findAgentByCandidateBucket(this, '1-50', (a) => a.candidates >= 1);
});

async function findAgentByCandidateBucket(world, option, predicate) {
  const result = await listing(world).runAndWaitForList(async () => {
    await listing(world).goto('Active');
  });
  remember(world, result);
  const applied = await listing(world).runAndWaitForList(async () => {
    await world.page.goto(`${listing(world).url}?candidateCount=${encodeURIComponent(option)}`);
  });
  remember(world, applied);
  const candidates = lastPayloadAgents(world).filter(predicate);
  if (!candidates.length) {
    throw new Error(
      `No agent matched Candidate Count "${option}" on DEV, so this scenario has no subject. `
      + `The server returned ${JSON.stringify(lastPayloadAgents(world).map((a) => `${a.email}:${a.candidates}`))}. `
      + 'This is a missing fixture, not an app defect — provision an agent in that state before re-running.',
    );
  }
  // Prefer one that is actually rendered on this page, so the row actions are reachable.
  const rows = (await listing(world).readRows()).filter((r) => r.email);
  const pick = candidates.find((a) => rows.some((r) => r.email === a.email)) || candidates[0];
  world._agent = {
    name: pick.name,
    email: pick.email,
    university: pick.university,
    status: pick.status,
    candidates: pick.candidates,
    progress: pick.progress,
    cells: (rows.find((r) => r.email === pick.email) || {}).cells || [],
  };
  world.attach(`Subject agent (Candidate Count "${option}"): ${pick.name} <${pick.email}> `
    + `university="${pick.university}" candidates=${pick.candidates} progress=${pick.progress}%`, 'text/plain');
}

// ==================== Structure ====================

Then('the agents page heading should be {string}', async function (expected) {
  await expect(listing(this).pageHeading).toBeVisible({ timeout: 30000 });
  const actual = (await listing(this).pageHeading.innerText()).replace(/\s+/g, ' ').trim();
  expect(actual.toLowerCase()).toBe(String(expected).toLowerCase());
});

Then('the agent search box should invite a search', async function () {
  await expect(listing(this).searchInput).toBeVisible({ timeout: 30000 });
  const placeholder = await listing(this).searchInput.getAttribute('placeholder');
  expect(placeholder, 'the search box should carry a placeholder telling the superadmin what it searches')
    .toBeTruthy();
  expect(placeholder.toLowerCase()).toContain('search');
  this.attach(`Search placeholder: ${JSON.stringify(placeholder)}`, 'text/plain');
});

Then('the {string} call to action should link to the invite form', async function (label) {
  const cta = listing(this).inviteCta;
  await expect(cta, `"${label}" call to action should be visible`).toBeVisible({ timeout: 30000 });
  // It is an <a>, not a button — assert the destination rather than clicking, so this
  // scenario does not leave the listing.
  const href = await cta.getAttribute('href');
  expect(href || '', `"${label}" should link to /agents/invite, href was ${JSON.stringify(href)}`)
    .toMatch(/\/agents\/invite/);
});

Then('the lifecycle tabs should be:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const actual = await listing(this).tabNames();
  expect(actual, `tabs rendered: ${JSON.stringify(actual)}`).toEqual(expected);
});

Then('the {string} tab should be the selected tab', async function (tab) {
  const selected = await listing(this).selectedTab();
  expect(selected.toLowerCase(), `selected tab was "${selected}"`).toBe(String(tab).toLowerCase());
});

Then('the {string} tab should still be the selected tab', async function (tab) {
  const selected = await listing(this).selectedTab();
  expect(selected.toLowerCase(), `selected tab was "${selected}"`).toBe(String(tab).toLowerCase());
});

Then('the {string} button should be available', async function (label) {
  await expect(this.page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first())
    .toBeVisible({ timeout: 30000 });
});

Then('the agent grid should be visible', async function () {
  await expect(listing(this).grid).toBeVisible({ timeout: 30000 });
});

// Columns AND actions per tab, in one pass. The pairing is the contract: a tab showing the
// right columns with the wrong actions is a defect either way round.
Then('each lifecycle tab should render its own columns and row actions:', { timeout: 240000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const tab = row.tab.trim();
    const expectedColumns = row.columns.split(',').map((c) => c.trim()).filter(Boolean);
    const expectedActions = row.actions.split(',').map((c) => c.trim()).filter(Boolean);
    const result = await listing(this).runAndWaitForList(async () => {
      await listing(this).goto(tab);
    });
    remember(this, result);

    const url = this.page.url();
    const param = (row.param || '').trim();
    if (param && !url.includes(`tab=${param}`)) {
      problems.push(`"${tab}": the URL should carry tab=${param} but is ${url}`);
    }
    if (!param && /[?&]tab=/.test(url)) {
      problems.push(`"${tab}" is the default tab and should add no tab param, but the URL is ${url}`);
    }
    const selected = await listing(this).selectedTab();
    if (selected.toLowerCase() !== tab.toLowerCase()) {
      problems.push(`"${tab}": opening it left "${selected}" selected instead`);
    }

    const columns = (await listing(this).columnHeaders()).map((c) => c.trim()).filter(Boolean);
    if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) {
      problems.push(`"${tab}" columns: expected ${JSON.stringify(expectedColumns)} but rendered ${JSON.stringify(columns)}`);
    }

    const rows = (await listing(this).readRows()).filter((r) => r.email);
    if (!rows.length) {
      // Not a pass. A tab with no rows cannot show row actions, so the row-action half of
      // this tab's contract went unverified and the report has to say so rather than imply
      // it was checked.
      problems.push(`"${tab}" listed no agents, so its row actions (${JSON.stringify(expectedActions)}) could NOT be verified. `
        + `Empty state: ${JSON.stringify(await listing(this).readEmptyState())}`);
    } else {
      // EVERY row on the first page, not only the first. A row's actions can depend on that
      // row's own state, so a first-row check says nothing about the other nine.
      //
      // The `menu` column covers actions kept behind a row's three-dot overflow. It is a
      // SEPARATE column rather than more entries in `actions` on purpose: "reachable in one
      // click" and "reachable in two" are different contracts, and folding them together
      // would let a build that moved Deactivate out of the menu onto the row - or the
      // reverse - pass unnoticed. A blank cell asserts the row offers NO overflow menu,
      // which is what the other three tabs are meant to do; that is an assertion, not a
      // skip, so a menu appearing where none is specified is a finding.
      const expectedMenu = (row.menu || '').split(',').map((c) => c.trim()).filter(Boolean);
      const shapes = {};
      for (const r of rows) {
        const actions = r.actions;
        const missing = expectedActions.filter((a) => !actions.some((x) => x.toLowerCase() === a.toLowerCase()));
        const extra = actions.filter((a) => !expectedActions.some((x) => x.toLowerCase() === a.toLowerCase()));
        if (missing.length || extra.length) {
          problems.push(`"${tab}" row actions on ${r.email}: expected ${JSON.stringify(expectedActions)} `
            + `but found ${JSON.stringify(actions)}${missing.length ? ` (missing ${JSON.stringify(missing)})` : ''}`
            + `${extra.length ? ` (unexpected ${JSON.stringify(extra)})` : ''}`);
        }
        const menu = await listing(this).rowMenuItems(r.email);
        const menuLabels = menu.items.map((i) => i.label);
        if (!expectedMenu.length && menu.opened) {
          problems.push(`"${tab}" row ${r.email} offers an overflow menu (${JSON.stringify(menuLabels)}) `
            + 'but the table specifies none');
        }
        if (expectedMenu.length) {
          if (!menu.opened) {
            problems.push(`"${tab}" row ${r.email}: no "${menu.trigger}" control, so the menu `
              + `${JSON.stringify(expectedMenu)} could not be opened. Inline actions: ${JSON.stringify(actions)}`);
          } else {
            const menuMissing = expectedMenu.filter((a) => !menuLabels.some((x) => x.toLowerCase() === a.toLowerCase()));
            const menuExtra = menuLabels.filter((a) => !expectedMenu.some((x) => x.toLowerCase() === a.toLowerCase()));
            if (menuMissing.length || menuExtra.length) {
              problems.push(`"${tab}" overflow menu on ${r.email}: expected ${JSON.stringify(expectedMenu)} `
                + `but found ${JSON.stringify(menuLabels)}${menuMissing.length ? ` (missing ${JSON.stringify(menuMissing)})` : ''}`
                + `${menuExtra.length ? ` (unexpected ${JSON.stringify(menuExtra)})` : ''}`);
            }
          }
        }
        const key = `actions ${JSON.stringify(actions)}, menu ${JSON.stringify(menuLabels)}`;
        shapes[key] = (shapes[key] || 0) + 1;
      }
      report.push(`${tab}: ${rows.length} rows, columns ${JSON.stringify(columns)}; `
        + Object.entries(shapes).map(([k, n]) => `${n} x ${k}`).join('; '));
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The lifecycle tabs do not render the columns and row actions their table specifies:');
});

// ==================== Search ====================

When('I search the agents for {string}', { timeout: 90000 }, async function (term) {
  this._searchTerm = term;
  remember(this, await listing(this).search(term));
});

When("I search the agents for that agent's name", { timeout: 90000 }, async function () {
  const agent = subject(this);
  this._searchTerm = agent.name;
  remember(this, await listing(this).search(agent.name));
});

When("I search the agents for that agent's first name", { timeout: 90000 }, async function () {
  const agent = subject(this);
  this._searchTerm = agent.name.split(/\s+/)[0];
  remember(this, await listing(this).search(this._searchTerm));
});

// NOTE: there is deliberately no separate Given for this. Cucumber's Given/When/Then are
// aliases over ONE registry, so defining the same pattern under two keywords is an ambiguous
// step, not an overload — the When above already serves `And I search the agents for ...`
// wherever the feature file uses it in a Given position.

When('I clear the agent search', { timeout: 90000 }, async function () {
  this._searchTerm = '';
  remember(this, await listing(this).runAndWaitForList(async () => {
    await listing(this).searchInput.fill('');
  }));
});

// Name, email and university in one pass. The last two are the interesting ones: the box is
// labelled "Search by agent name..." and matches all three.
Then('searching the agents should find that agent by each of:', { timeout: 240000 }, async function (table) {
  const agent = subject(this);
  const terms = {
    'full name': agent.name,
    'first name only': agent.name.split(/\s+/)[0],
    'name uppercased': agent.name.toUpperCase(),
    'full email': agent.email,
    'email local-part': agent.email.split('@')[0],
    university: agent.university,
  };
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const field = row.field.trim();
    if (!(field in terms)) {
      problems.push(`Unknown search field "${field}" — this step knows ${JSON.stringify(Object.keys(terms))}`);
      continue;
    }
    const term = terms[field];
    if (!term) {
      problems.push(`"${field}": the subject agent has no value for it, so it could not be searched`);
      continue;
    }
    const result = remember(this, await listing(this).search(term));
    const returned = lastPayloadAgents(this);
    const hit = returned.find((a) => (a.email || '').toLowerCase() === agent.email.toLowerCase());
    report.push(`${field.padEnd(16)} term=${JSON.stringify(term)} -> ${returned.length} agent(s)`);
    if (!result.requestFired) {
      problems.push(`"${field}" (term ${JSON.stringify(term)}): no search request was sent at all`);
    } else if (!hit) {
      problems.push(`"${field}" (term ${JSON.stringify(term)}): ${agent.email} was NOT returned. `
        + `The server returned ${returned.length} agent(s): ${JSON.stringify(returned.slice(0, 6).map((a) => a.email))}`);
    }
  }
  this.attach(`Subject: ${agent.name} <${agent.email}> at "${agent.university}"\n${report.join('\n')}`, 'text/plain');
  fail(problems, `Searching did not find ${agent.email} by every field it should:`);
});

Then('searching the agents for each of these terms should return nothing and not break the page:',
  { timeout: 180000 }, async function (table) {
    const problems = [];
    const consoleErrors = [];
    const onError = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
    const onPageError = (err) => consoleErrors.push(`pageerror: ${err.message}`);
    this.page.on('console', onError);
    this.page.on('pageerror', onPageError);
    try {
      for (const row of table.hashes()) {
        const term = row.term;
        const result = remember(this, await listing(this).search(term));
        const returned = lastPayloadAgents(this);
        if (returned.length) {
          problems.push(`${JSON.stringify(term)} returned ${returned.length} agent(s): `
            + `${JSON.stringify(returned.slice(0, 4).map((a) => a.email))}`);
        }
        // "Did not break" is asserted structurally: the page still renders its own furniture
        // and answers, rather than merely "no exception was thrown in the test".
        const heading = await listing(this).pageHeading.isVisible().catch(() => false);
        if (!heading) problems.push(`${JSON.stringify(term)}: the page heading disappeared — the listing did not survive the term`);
        const searchable = await listing(this).searchInput.isVisible().catch(() => false);
        if (!searchable) problems.push(`${JSON.stringify(term)}: the search box disappeared`);
        if (!result.requestFired) problems.push(`${JSON.stringify(term)}: no request was sent, so nothing was actually searched`);
      }
    } finally {
      this.page.off('console', onError);
      this.page.off('pageerror', onPageError);
    }
    // Report console noise, but do not fail on it: this app logs unrelated 404s for static
    // assets on every page load, so treating any console error as a defect would make every
    // scenario red for a reason that has nothing to do with searching.
    if (consoleErrors.length) this.attach(`Console during search:\n${consoleErrors.join('\n')}`, 'text/plain');
    fail(problems, 'A search term that should match nothing did not behave safely:');
  });

Then('the search box should be empty', async function () {
  const value = await listing(this).searchInput.inputValue();
  expect(value.trim(), `the search box still holds ${JSON.stringify(value)}`).toBe('');
});

Then('the search box should still hold the search term', async function () {
  const value = await listing(this).searchInput.inputValue();
  expect(value, `expected the box to still hold ${JSON.stringify(this._searchTerm)}`).toBe(this._searchTerm);
});

Then('the agents URL should contain the search term', async function () {
  expect(this._searchTerm, 'no search term has been noted').toBeTruthy();
  const url = this.page.url();
  const encoded = encodeURIComponent(this._searchTerm).replace(/%20/g, '+');
  const ok = url.includes(encoded) || url.includes(encodeURIComponent(this._searchTerm))
    || url.includes(this._searchTerm.replace(/\s+/g, '+'));
  expect(ok, `the URL ${url} does not carry the search term ${JSON.stringify(this._searchTerm)}`).toBe(true);
});

Then('the URL should not contain a search term', async function () {
  expect(/[?&]q=/.test(this.page.url()), `the URL still carries a q= param: ${this.page.url()}`).toBe(false);
});

Then('no agent list request should have been sent', async function () {
  expect(this._lastList, 'no list attempt was recorded').toBeTruthy();
  expect(this._lastList.requestFired,
    `a list request WAS sent (${this._lastList.requestUrl}) — the app should ignore a term it trims to nothing`)
    .toBe(false);
});

// ==================== Counting what is listed ====================

Then('exactly {int} agent should be listed', async function (n) {
  const rows = (await listing(this).readRows()).filter((r) => r.email);
  expect(rows.length, `rows listed: ${JSON.stringify(rows.map((r) => r.email))}`).toBe(n);
});

Then('more than {int} agent should be listed', async function (n) {
  const rows = (await listing(this).readRows()).filter((r) => r.email);
  expect(rows.length, `only ${rows.length} row(s) listed`).toBeGreaterThan(n);
});

Then('no agents should be listed', async function () {
  const returned = lastPayloadAgents(this);
  expect(returned.length, `the server returned ${JSON.stringify(returned.map((a) => a.email))}`).toBe(0);
  const rows = (await listing(this).readRows()).filter((r) => r.email);
  expect(rows.length, `the grid still renders ${JSON.stringify(rows.map((r) => r.email))}`).toBe(0);
});

Then('that agent should be listed', async function () {
  const agent = subject(this);
  const returned = lastPayloadAgents(this);
  const hit = returned.find((a) => (a.email || '').toLowerCase() === agent.email.toLowerCase());
  expect(hit, `${agent.email} was not returned. The server returned ${JSON.stringify(returned.map((a) => a.email))}`)
    .toBeTruthy();
});

Then('that agent should still be listed with the original email address', { timeout: 120000 }, async function () {
  const agent = subject(this);
  // Reload BEFORE searching. The search box still holds this agent's name — openEmailDialog
  // searched for it to reach the row — and re-typing a term the app already has an answer for
  // fires no request at all, so a bare search() here returned requestFired:false and the
  // assertion below would then have been made against the payload captured before the modal
  // was ever opened. That is the one thing this step must not do: it exists to prove that
  // CANCELLING changed nothing, which is only provable from a fresh answer by the server.
  remember(this, await listing(this).runAndWaitForList(async () => {
    await listing(this).goto('Active');
  }));
  const result = remember(this, await listing(this).search(agent.name));
  expect(result.requestFired, 'searching for the agent fired no list request, so the payload asserted '
    + 'below would be a stale one').toBe(true);
  const hit = lastPayloadAgents(this).find((a) => (a.email || '').toLowerCase() === agent.email.toLowerCase());
  expect(hit, `${agent.email} is no longer listed — the cancelled edit appears to have been applied. `
    + `Now listed: ${JSON.stringify(lastPayloadAgents(this).map((a) => a.email))}`).toBeTruthy();
});

Then('that agent should still be listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  const agent = subject(this);
  const row = await listing(this).waitForAgentOnTab(tab, { name: agent.name, email: agent.email, timeout: 45000 });
  expect(row, `${agent.email} is not on the "${tab}" tab`).toBeTruthy();
});

Then('that agent should not be listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  const agent = subject(this);
  const verdict = await listing(this).confirmAgentAbsentFromTab(tab, { name: agent.name, email: agent.email });
  expect(verdict.absent,
    `${agent.email} should not be on "${tab}" but ${verdict.reason}`
    + `${verdict.row ? ` (row: ${JSON.stringify(verdict.row.cells)})` : ''}`).toBe(true);
});

Then('that agent should appear on the {string} tab', { timeout: 180000 }, async function (tab) {
  const agent = subject(this);
  const row = await listing(this).waitForAgentOnTab(tab, { name: agent.name, email: agent.email, timeout: 120000 });
  this.attach(`${agent.email} is on "${tab}" with cells ${JSON.stringify(row.cells)}`, 'text/plain');
});

Then('that agent should no longer be listed on the {string} tab', { timeout: 180000 }, async function (tab) {
  const agent = subject(this);
  const gone = await listing(this).waitForAgentGoneFromTab(tab, { name: agent.name, email: agent.email, timeout: 120000 });
  expect(gone, `${agent.email} is still listed on the "${tab}" tab`).toBe(true);
});

// ==================== Filters modal ====================

When('I open the Filters modal', { timeout: 60000 }, async function () {
  await listing(this).openFilters();
});

Then('the filter modal heading should be {string}', async function (expected) {
  const heading = await this.page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((x) => /apply filters/i.test(x.innerText || ''));
    return d ? ((d.querySelector('h1,h2,h3') || {}).innerText || '').replace(/\s+/g, ' ').trim() : '';
  });
  expect(heading).toBe(expected);
});

Then('the filter modal should offer the groups:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const state = await listing(this).readFilterOptions();
  expect(state.found, 'the Filters modal is not open').toBe(true);
  const missing = expected.filter((g) => !state.groupTitles.some((t) => t.toLowerCase() === g.toLowerCase()));
  expect(missing, `groups rendered: ${JSON.stringify(state.groupTitles)}`).toEqual([]);
});

Then('the {string} group should offer the options:', async function (group, table) {
  const expected = table.raw().map((r) => r[0].trim());
  const key = AgentsListingPage.filterGroupKey(group);
  const state = await listing(this).readFilterOptions();
  const actual = state.options.filter((o) => o.group === key).map((o) => o.label);
  expect(actual, `"${group}" offers ${JSON.stringify(actual)}`).toEqual(expected);
});

Then('no filter option should be selected', async function () {
  const state = await listing(this).readFilterOptions();
  const checked = state.options.filter((o) => o.checked).map((o) => `${o.group}/${o.label}`);
  expect(checked, `these options are selected: ${JSON.stringify(checked)}`).toEqual([]);
});

Then('the {string} option under {string} should be selected', async function (option, group) {
  const selected = await listing(this).isFilterOptionSelected(group, option);
  const state = await listing(this).readFilterOptions();
  expect(selected, `"${option}" under "${group}" is not selected. Modal state: `
    + `${JSON.stringify(state.options.map((o) => `${o.label}:${o.checked}`))}`).toBe(true);
});

Then('the filter modal should offer {string}, {string} and {string}', async function (a, b, c) {
  for (const label of [a, b, c]) {
    await expect(
      listing(this).filterDialog.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first(),
      `the Filters modal should offer a "${label}" control`,
    ).toBeVisible({ timeout: 15000 });
  }
});

Then('the filter modal should still be open', async function () {
  expect(await listing(this).isFilterDialogOpen(), 'the Filters modal closed').toBe(true);
});

Then('the agent filter modal should not be visible', async function () {
  expect(await listing(this).isFilterDialogOpen(), 'the Filters modal is still open').toBe(false);
});

When('I select the agent filter {string} under {string}', async function (option, group) {
  await listing(this).selectFilterOption(group, option);
});

When('I apply the agent filters', { timeout: 90000 }, async function () {
  remember(this, await listing(this).applyFilters());
});

When('I clear all agent filters in the modal', { timeout: 90000 }, async function () {
  remember(this, await listing(this).clearAllInModal());
});

When('I cancel the agent filters', { timeout: 60000 }, async function () {
  await listing(this).cancelFilters();
});

When('I clear the filters from the empty state', { timeout: 90000 }, async function () {
  remember(this, await listing(this).clickPageClearAll());
});

Then('the filter modal should close via each of:', { timeout: 180000 }, async function (table) {
  const problems = [];
  for (const row of table.hashes()) {
    const method = row.method.trim();
    await listing(this).openFilters();
    if (!(await listing(this).isFilterDialogOpen())) {
      problems.push(`could not open the Filters modal before trying "${method}"`);
      continue;
    }
    await listing(this).closeFilterDialogVia(method);
    if (await listing(this).isFilterDialogOpen()) {
      problems.push(`"${method}" did not close the Filters modal`);
      // Leave the page usable for the next row.
      await listing(this).closeFilterDialogVia('Cancel').catch(() => {});
    }
  }
  fail(problems, 'The Filters modal could not be dismissed by every documented means:');
});

// THE CENTRAL FILTER ASSERTION — see the file header for why it reads the payload.
Then('applying each filter option should return only agents that satisfy it:',
  { timeout: 600000 }, async function (table) {
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const { group, option } = row;
      const urlParam = row.param.trim();
      const apiParam = row.apiParam.trim();
      const predicate = optionPredicate(group, option);

      // Start each row from a clean listing so a previous row's filter cannot survive into
      // this one and make the assertion pass or fail for the wrong reason.
      remember(this, await listing(this).runAndWaitForList(async () => {
        await listing(this).goto('Active');
      }));
      await listing(this).openFilters();
      await listing(this).selectFilterOption(group, option);
      const applied = remember(this, await listing(this).applyFilters());

      if (!applied.requestFired) {
        problems.push(`${group} / "${option}": applying it sent no list request at all`);
        continue;
      }
      const url = this.page.url();
      if (!url.includes(urlParam)) {
        problems.push(`${group} / "${option}": the URL should carry "${urlParam}" but is ${url}`);
      }
      if (!applied.requestUrl.includes(apiParam)) {
        problems.push(`${group} / "${option}": the request should carry "${apiParam}" — the filter never reached the `
          + `backend. Request was ${applied.requestUrl}`);
      }
      const returned = lastPayloadAgents(this);
      const violating = returned.filter((a) => !predicate.test(a));
      report.push(`${group} / ${String(option).padEnd(10)} count=${applied.payload && applied.payload.count} `
        + `returned=${returned.length} rule=${predicate.describe}`);
      if (violating.length) {
        problems.push(`${group} / "${option}" (${predicate.describe}): ${violating.length} of ${returned.length} `
          + `agents returned do NOT satisfy it — ${JSON.stringify(violating.slice(0, 5)
            .map((a) => `${a.email} candidates=${a.candidates} progress=${a.progress}%`))}`);
      }
      // The rendered grid must agree with the payload it was handed. A mismatch is a
      // different defect from a wrong filter (stale rendering), so it is reported as one.
      const rendered = (await listing(this).readRows()).filter((r) => r.email).map((r) => r.email).sort();
      const fromServer = returned.map((a) => a.email).sort();
      if (JSON.stringify(rendered) !== JSON.stringify(fromServer)) {
        problems.push(`${group} / "${option}": the grid renders ${JSON.stringify(rendered)} but the response held `
          + `${JSON.stringify(fromServer)} — the list is showing something other than what it was given`);
      }
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Filter options did not restrict the list to agents that satisfy them:');
  });

When('I note the number of agents matching {string} option {string}',
  { timeout: 120000 }, async function (group, option) {
    const key = AgentsListingPage.filterGroupKey(group);
    const slug = AgentsListingPage.filterOptionSlug(option);
    const result = await listing(this).runAndWaitForList(async () => {
      await this.page.goto(`${listing(this).url}?${key}=${encodeURIComponent(slug)}`);
    });
    remember(this, result);
    this._notedCounts = this._notedCounts || [];
    const count = result.payload ? result.payload.count : null;
    expect(count, `no count came back for ${group}="${option}" (request ${result.requestUrl})`).not.toBeNull();
    this._notedCounts.push({ group, option, count });
    this.attach(`${group} "${option}" matches ${count} agent(s)`, 'text/plain');
  });

Then('the number of matching agents should equal the sum of the two noted counts', async function () {
  const noted = this._notedCounts || [];
  expect(noted.length, 'two counts have to be noted before they can be summed').toBe(2);
  const expected = noted[0].count + noted[1].count;
  const actual = this._lastList.payload ? this._lastList.payload.count : null;
  expect(actual,
    `selecting both options should return the UNION of the two — ${noted[0].option} (${noted[0].count}) `
    + `+ ${noted[1].option} (${noted[1].count}) = ${expected} — but the server returned ${actual}. `
    + `Request: ${this._lastList.requestUrl}`).toBe(expected);
});

Then('every agent returned should have between {int} and {int} candidates', async function (min, max) {
  const returned = lastPayloadAgents(this);
  expect(returned.length, 'the filter returned no agents at all, so nothing was verified').toBeGreaterThan(0);
  const bad = returned.filter((a) => !(a.candidates >= min && a.candidates <= max));
  expect(bad, `these agents fall outside ${min}-${max} candidates: `
    + `${JSON.stringify(bad.map((a) => `${a.email}:${a.candidates}`))}`).toEqual([]);
});

Then('every agent returned should have target progress between {int} and {int}', async function (min, max) {
  const returned = lastPayloadAgents(this);
  expect(returned.length, 'the filter returned no agents at all, so nothing was verified').toBeGreaterThan(0);
  const bad = returned.filter((a) => !(a.progress >= min && a.progress <= max));
  expect(bad, `these agents fall outside ${min}-${max}% progress: `
    + `${JSON.stringify(bad.map((a) => `${a.email}:${a.progress}%`))}`).toEqual([]);
});

Then('the {string} button should show an applied-filter count of {int}', async function (label, expected) {
  const count = await listing(this).appliedFilterCount();
  const rendered = await listing(this).filtersTriggerLabel();
  expect(count, `the "${label}" button reads ${JSON.stringify(rendered)}`).toBe(expected);
});

Then('the {string} button should show no applied-filter count', async function (label) {
  const rendered = await listing(this).filtersTriggerLabel();
  const count = await listing(this).appliedFilterCount();
  expect(count, `the "${label}" button reads ${JSON.stringify(rendered)}, so filters are still applied`).toBe(0);
});

Then('the agents URL should contain the filter {string}', async function (fragment) {
  expect(this.page.url()).toContain(fragment);
});

// Every Target Progress bucket, driven for real, with the server's own count per bucket.
//
// It asserts the AGREEMENT between a bucket and what it returns — every returned agent must
// sit inside the bucket — which is the rule that matters and is checkable whether or not any
// agent currently qualifies. It does NOT require a bucket to be non-empty: on DEV every
// bucket is empty (216 of 217 agents are at 0%, one at 300%, buckets cover 1–100%), and
// demanding matches would make this permanently red against a data gap rather than a rule.
//
// The emptiness IS reported — as attached evidence and, when every bucket is empty, as a
// named finding in the failure message — so the gap stays visible instead of passing silently.
Then('each Target Progress bucket should return only agents inside it:', { timeout: 240000 }, async function (table) {
  const problems = [];
  const report = [];
  let matchedAnywhere = 0;

  for (const row of table.hashes()) {
    const bucket = row.bucket.trim();
    const range = bucket.match(/(\d+)%\s*-\s*(\d+)%/);
    if (!range) { problems.push(`"${bucket}" is not a percentage range`); continue; }
    const [, lo, hi] = range.map(Number);

    await listing(this).runAndWaitForList(async () => { await listing(this).goto('Active'); });
    await listing(this).openFilters();
    await listing(this).selectFilterOption('Target Progress', bucket);
    const result = await listing(this).runAndWaitForList(async () => {
      await listing(this).applyFilters();
    }, { timeout: 15000 });
    remember(this, result);

    const agents = lastPayloadAgents(this);
    const count = (result.payload && result.payload.count) ?? null;
    matchedAnywhere += agents.length;
    const outside = agents.filter((a) => {
      const v = Number(a.progress);
      return Number.isNaN(v) || v < lo || v > hi;
    });
    if (outside.length) {
      problems.push(`"${bucket}" returned agents outside it: `
        + JSON.stringify(outside.map((a) => `${a.email}=${a.progress}%`)));
    }
    report.push(`${bucket}: count=${count} returned=${agents.length}`
      + (agents.length ? ` progress=${JSON.stringify(agents.map((a) => a.progress))}` : ' (no agents in this range)'));
  }

  this.attach(report.join('\n'), 'text/plain');
  if (!matchedAnywhere) {
    problems.push('NO agent on this environment falls inside ANY Target Progress bucket, so the '
      + 'filter could not be exercised at all. Measured 2026-09-04: 216 of 217 agents sit at 0% '
      + '(below the lowest bucket, which starts at 1%) and one sits at 300% (above the highest, '
      + 'which caps at 100%). Two questions for the PO: should there be a 0% bucket, and should '
      + 'the top bucket be open-ended ("76%+") so an agent over target is reachable? '
      + 'This is a data/coverage gap, not a filter defect — each bucket sends the right '
      + 'target_progress parameter and the server answers consistently.');
  }
  fail(problems, 'The Target Progress buckets do not agree with the agents they return:');
});

Then('the agents URL should not contain any filter parameters', async function () {
  const url = this.page.url();
  const offenders = ['targetProgress=', 'candidateCount=', 'university='].filter((p) => url.includes(p));
  expect(offenders, `the URL still carries ${JSON.stringify(offenders)}: ${url}`).toEqual([]);
});

Then('the URL should contain {string}', async function (fragment) {
  expect(this.page.url()).toContain(fragment);
});

// ---------- University filter ----------

When('I open the university suggestions', { timeout: 60000 }, async function () {
  await listing(this).openUniversitySuggestions();
});

Then('the university list should offer at least one university', async function () {
  const options = await listing(this).universityOptions();
  expect(options.length, 'the university combobox offered nothing').toBeGreaterThan(0);
  this.attach(`University options (${options.length}): ${JSON.stringify(options)}`, 'text/plain');
});

When('I type {string} into the university filter', { timeout: 60000 }, async function (term) {
  await listing(this).typeUniversity(term);
});

// The combobox queries per keystroke and keeps the PREVIOUS list on screen until the narrowed one
// arrives, so a single read can catch the unfiltered list (seen 2026-10-07 under 4 workers: ten
// "Al ..." universities for "King"). Poll until it narrows, then judge the last read.
async function pollUniversityOptions(world, settled, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let options = await listing(world).universityOptions();
  while (!settled(options) && Date.now() < deadline) {
    await world.page.waitForTimeout(500);
    options = await listing(world).universityOptions();
  }
  return options;
}

Then('every university offered should contain {string}', { timeout: 60000 }, async function (term) {
  const want = String(term).toLowerCase();
  const options = await pollUniversityOptions(this,
    (o) => o.length > 0 && o.every((x) => x.toLowerCase().includes(want)));
  expect(options.length, `typing ${JSON.stringify(term)} narrowed the list to nothing`).toBeGreaterThan(0);
  const bad = options.filter((o) => !o.toLowerCase().includes(String(term).toLowerCase()));
  expect(bad, `these offered universities do not contain ${JSON.stringify(term)}: ${JSON.stringify(bad)}`).toEqual([]);
});

Then('the university list should offer no universities', { timeout: 60000 }, async function () {
  const options = (await pollUniversityOptions(this, (o) => o.filter(Boolean).length === 0)).filter(Boolean);
  expect(options, `the combobox still offers ${JSON.stringify(options)}`).toEqual([]);
});

// "Offers nothing" is also true of a popover that failed to open at all, so the message the
// app shows instead is asserted separately — that is what distinguishes "nothing matched"
// from "the control is broken". The wording is not pinned: the step fails only when there is
// no message, and attaches whichever one it found.
Then('the university list should say why nothing matched', async function () {
  const message = await listing(this).universityNoResultsText();
  this.attach(`University combobox empty state: ${JSON.stringify(message)}`, 'text/plain');
  expect(message, 'nothing was offered AND no explanation was shown — the popover may not have rendered at all')
    .toBeTruthy();
});

// Pick a university that really has agents, so "every row belongs to it" is a meaningful
// assertion rather than one that passes on an empty list.
When('I choose a university that has agents', { timeout: 120000 }, async function () {
  await listing(this).openUniversitySuggestions().catch(() => {});
  const options = await listing(this).universityOptions();
  expect(options.length, 'no universities were offered').toBeGreaterThan(0);
  // Prefer a university already visible in the current list — that guarantees it has agents
  // without needing a probe request per option.
  //
  // >>> AND PREFER ONE WHOSE NAME IS NOT CONTAINED IN ANOTHER OFFERED NAME. <<< The
  // university filter is sent as `search=<name>`, NOT as an exact university id (measured
  // 2026-09-04, scripts/probe-agent-filter-fixtures.js:
  // `?…&search=King+Saud+University&candidate_count=1-50`), so it is a SUBSTRING match:
  // choosing "King Saud University" also returns agents of "King Saud University (KSU)", a
  // different institution. Picking a name that is a prefix of another therefore makes
  // `every agent returned should belong to the chosen university` fail for a reason that has
  // nothing to do with the rule under test, and only intermittently — depending on which
  // university happens to sit first in the list that run.
  //
  // The substring behaviour is a product question in its own right and is reported
  // separately; this just keeps the AND-semantics scenarios off the ambiguous names.
  // >>> START FROM A UNIVERSITY THAT DEMONSTRABLY HAS AGENTS, THEN GO AND FIND IT IN THE
  // COMBOBOX — not the other way round. <<<
  //
  // Reading the offered options and hoping one of them has agents does not work here, for two
  // measured reasons:
  //   * The popover offers at most TEN options, so the universities that actually own the
  //     agents on screen are frequently not among them at all.
  //   * Callers reach this step with a search term already typed. In the university scenario
  //     that term is "King", so the options are ten King* universities while the agents on
  //     screen are at Al-Baha, Pacific Maritime, Iqra and so on — the intersection is EMPTY,
  //     the old code fell through to "any unambiguous option", and it picked a King*
  //     university with NO agents. `every agent returned should belong to the chosen
  //     university` then failed with "returned no agents, so the filter was not verified".
  //     It only ever passed by luck of which King* university sorted first that run.
  //
  // The universities on the agent rows are the ones known to have agents, so those are the
  // candidates. Each is typed into the filter, which is also how its uniqueness is checked:
  //
  // >>> THE FILTER IS A SUBSTRING SEARCH (`search=<name>`, measured 2026-09-04), so a name
  // contained in another university's name returns that other institution's agents too <<<
  // — "King Saud University" also returns "King Saud University (KSU)". A candidate whose
  // typed term surfaces a longer name is therefore skipped, because the resulting failure
  // would be about the substring behaviour rather than about the rule under test.
  // >>> PAGE 1 IS NOT A BIG ENOUGH POOL. <<< The listing is newest-first and every agent this
  // suite provisions is created at DEFAULT_UNIVERSITY ("King Saud University"), so page 1 is
  // usually ten rows naming that ONE university — and it is precisely the name that is
  // shadowed by "King Saud University (KSU)". Measured 2026-09-04: the candidate list came
  // back as exactly `["King Saud University"]`, unusable, three runs out of three.
  //
  // So when page 1 yields nothing viable, walk further pages for a university that is. That
  // means leaving the modal (a navigation closes it) and reopening it afterwards, which is
  // fine: this step's contract is to leave a workable university SELECTED with the modal open,
  // and how it finds one is its own business.
  const universitiesOn = async () =>
    [...new Set((await listing(this).readRows()).filter((r) => r.university).map((r) => r.university))];

  const tried = [];
  let chosen = null;

  const tryCandidates = async (candidates) => {
    for (const candidate of candidates) {
      if (tried.some((t) => t.candidate === candidate)) continue;
      await listing(this).typeUniversity(candidate);
      await listing(this).openUniversitySuggestions().catch(() => {});
      // Polled, not read once: a stale pre-narrowing list reads as "not offered" and sends the
      // step on a 5-page walk that blew its 120s budget under 4 workers (2026-10-07).
      //
      // >>> SETTLED = THE CANDIDATE'S OWN NAME IS OFFERED, not "every option contains it". <<<
      // The combobox matches WORD-WISE (measured 2026-10-19): "King Saud University" also offers
      // "King Saud bin Abdulaziz University for Health Sciences", which does not contain the
      // typed string - so the old predicate never held and EVERY candidate burned the full wait.
      // That, plus the page 2-6 walk, ran the step past its 120s budget in all four agent
      // scenarios using it, on a combobox that was working perfectly.
      const want = candidate.toLowerCase();
      const offered = await pollUniversityOptions(this,
        (o) => o.some((x) => x.toLowerCase() === want), 5000);
      const exact = offered.includes(candidate);
      const longer = offered.filter((o) => o !== candidate && o.toLowerCase().includes(candidate.toLowerCase()));
      tried.push({ candidate, offered: offered.length, exactlyOffered: exact, shadowedBy: longer });
      if (exact && !longer.length) return candidate;
    }
    return null;
  };

  chosen = await tryCandidates(await universitiesOn());

  if (!chosen) {
    const pooled = [];
    // >>> NO cancelFilters() HERE - THE NAVIGATION BELOW CLOSES THE MODAL BY ITSELF. <<<
    // The university suggestion popover is still open at this point, and while it is react-aria
    // hides the rest of the dialog from the accessibility tree, so `getByRole('button',
    // {name: 'Cancel'})` resolves nothing and the click waited out the WHOLE 120s step budget
    // (measured from the trace 2026-10-19: click on Cancel at +0s, never returned). That one
    // dead click is what failed all four agent scenarios that use this step.
    // >>> WALK FROM THE CURRENT URL, NOT A BARE `?page=N`. <<< A bare URL threw away every filter
    // the scenario had already applied, so "two groups" applied 1-50 first, the walk dropped it,
    // and the final request carried only the university (trace 2026-10-19: `...&search=Arab+East
    // +College+school`, no `candidate_count`) - the app then rightly returned a 0-candidate agent
    // and the scenario blamed the AND semantics. Keeping the query also means the pool holds only
    // universities that have agents UNDER the filters already in force.
    // >>> POOLED FROM THE SERVER, NOT FROM RENDERED PAGES (2026-10-22). <<< Walking pages 2-6
    // stopped working once @provision runs had filled the newest ~60 rows with throwaway agents of
    // ONE university ("King Saud University", which "King Saud University (KSU)" shadows), so every
    // page offered the same unusable candidate and three scenarios failed on a working filter. The
    // list request the app itself makes is replayed - same filters, 100 per page - and the
    // universities are tried commonest first. The token is read off that request (the app keeps
    // it in memory, not in a cookie).
    const authorised = this.page.waitForRequest(
      (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && Boolean(r.headers().authorization), { timeout: 30000 });
    remember(this, await listing(this).runAndWaitForList(async () => { await this.page.reload(); }, { timeout: 30000 }));
    const req = await authorised;
    const counts = {};
    for (let p = 1; p <= 5; p += 1) {
      const url = new URL(req.url());
      url.searchParams.set('page', String(p));
      url.searchParams.set('page_size', '100');
      const res = await this.page.request.get(url.toString(), { headers: { authorization: req.headers().authorization } });
      const body = res.ok() ? await res.json() : null;
      for (const a of (body && body.results) || []) {
        if (a.institution_name) counts[a.institution_name] = (counts[a.institution_name] || 0) + 1;
      }
      if (!body || !body.next) break;
    }
    pooled.push(...Object.keys(counts).sort((a, b) => counts[b] - counts[a]));
    this.attach(`Universities pooled from the server (agents each): ${JSON.stringify(counts)}`, 'text/plain');
    await listing(this).openFilters();
    await listing(this).openUniversitySuggestions().catch(() => {});
    chosen = await tryCandidates(pooled);
  }

  this.attach(`University candidates tried (from agents on screen): ${JSON.stringify(tried, null, 1)}`, 'text/plain');
  expect(chosen,
    'no university on screen could be filtered by unambiguously. Each candidate was either not '
    + 'offered by its own name, or its name is contained in a longer university name — and since '
    + 'the filter is a substring search, that would return another institution\'s agents. '
    + `Tried: ${JSON.stringify(tried)}`).toBeTruthy();

  await listing(this).chooseUniversity(chosen);
  this._chosenUniversity = chosen;
  this.attach(`Chose university: ${JSON.stringify(chosen)}`, 'text/plain');
});

// >>> DECODE THE URL; DO NOT GUESS HOW IT WAS ENCODED. <<<
//
// This used to test three hand-rolled encodings of the university name and pass if the raw
// URL string contained any of them. All three render parentheses LITERALLY — encodeURIComponent
// deliberately leaves `(` and `)` alone, and the `replace(/\s+/g, '+')` variant touches only
// spaces — while the app percent-encodes them. So for "King Abdulaziz University (KAU)" the
// candidates were all `King+Abdulaziz+University+(KAU)` against a URL reading
// `?university=King+Abdulaziz+University+%28KAU%29`, and the step failed 3 runs out of 3
// reporting that the URL "does not carry the chosen university" while quoting a URL that
// plainly did. (It passed before only because the chooser happened to pick a name with no
// parentheses in it — so this was latent, not new.)
//
// `URLSearchParams` decodes `+` and every percent-escape for us, so comparing DECODED values
// is exact and immune to whichever encoding either side prefers. Any parameter may carry it:
// the browser URL uses `university` while the API request uses `search`, and pinning a name
// here would only add a second thing to guess at.
Then('the URL should contain the chosen university', async function () {
  expect(this._chosenUniversity, 'no university has been chosen').toBeTruthy();
  const wanted = String(this._chosenUniversity).trim().toLowerCase();
  const params = [...new URL(this.page.url()).searchParams.entries()];
  const match = params.find(([, value]) => String(value).trim().toLowerCase() === wanted);
  this.attach(
    `URL: ${this.page.url()}\nDecoded params: ${JSON.stringify(params)}\n`
    + `Chosen university: ${JSON.stringify(this._chosenUniversity)}`
    + (match ? `\nCarried by: ${match[0]}` : ''),
    'text/plain',
  );
  expect(
    Boolean(match),
    `no URL parameter carries the chosen university ${JSON.stringify(this._chosenUniversity)}. `
    + `Decoded parameters: ${JSON.stringify(params)} (raw URL ${this.page.url()})`,
  ).toBe(true);
});

Then('every agent returned should belong to the chosen university', async function () {
  expect(this._chosenUniversity, 'no university has been chosen').toBeTruthy();
  const returned = lastPayloadAgents(this);
  expect(returned.length,
    `filtering by ${JSON.stringify(this._chosenUniversity)} returned no agents, so the filter was not verified. `
    + 'Pick a university that has agents.').toBeGreaterThan(0);
  const bad = returned.filter((a) => a.university !== this._chosenUniversity);
  expect(bad, `these agents are not at ${JSON.stringify(this._chosenUniversity)}: `
    + `${JSON.stringify(bad.map((a) => `${a.email}@${a.university}`))}`).toEqual([]);
});

// ==================== Empty state ====================

Then('the listing empty state heading should be {string}', async function (expected) {
  const state = await listing(this).readEmptyState();
  expect(state, 'no empty state is on screen').toBeTruthy();
  expect(state.heading).toBe(expected);
});

// `includes`, not equality: the state is a heading plus a body line and this asserts the body
// verbatim. The two wordings differ only in their last word ("search" vs "filters"), which is
// exactly the distinction worth pinning.
Then('the listing empty state should read {string}', async function (expected) {
  const state = await listing(this).readEmptyState();
  expect(state, 'no empty state is on screen').toBeTruthy();
  expect(state.text, `the empty state reads ${JSON.stringify(state.text)}`).toContain(expected);
});

Then('the empty state should offer a {string} call to action', async function (label) {
  const state = await listing(this).readEmptyState();
  expect(state, 'no empty state is on screen').toBeTruthy();
  const found = state.ctas.some((c) => c.toLowerCase() === String(label).toLowerCase());
  expect(found, `the empty state offers ${JSON.stringify(state.ctas)}`).toBe(true);
});

// ==================== Pagination ====================

Then('the pagination controls should be visible', async function () {
  expect(await listing(this).hasPagination(), 'no pagination control was rendered').toBe(true);
  this.attach(`Pagination: ${await listing(this).paginationText()}`, 'text/plain');
});

Then('the {string} control should be disabled on the first page', async function (label) {
  const disabled = label.toLowerCase() === 'previous'
    ? await listing(this).isPrevDisabled()
    : await listing(this).isNextDisabled();
  expect(disabled, `"${label}" is not disabled on page 1`).toBe(true);
});

Then('the {string} control should be enabled', async function (label) {
  const disabled = label.toLowerCase() === 'previous'
    ? await listing(this).isPrevDisabled()
    : await listing(this).isNextDisabled();
  expect(disabled, `"${label}" is still disabled`).toBe(false);
});

// >>> PAGINATION ASSERTIONS READ THE GRID, NOT THE LAST RESPONSE PAYLOAD. <<<
//
// The app serves a page it has already fetched FROM ITS OWN CACHE, firing no request at all.
// Measured 2026-09-04 (scripts/probe-agent-pagination.js): Next issues
// `GET /agent/?page=2&…`, but Previous issues NOTHING — and renders the correct ten page-1
// agents with Previous disabled again. The product is behaving correctly and efficiently.
//
// `runAndWaitForList()` then returns `{payload: null, requestFired: false}`, `remember()`
// stores that, and `lastPayloadAgents()` reads `[]` out of the null payload — so the
// payload-based assertion reported "going back showed []" for a grid listing ten agents. The
// scenario read as a product bug (pagination loses the list on the way back) when nothing was
// wrong with the app.
//
// "The agents listed" is a claim about the SCREEN, so read the screen. The payload stays the
// right source for filter and search assertions, where the server's own answer is the subject.
async function listedAgentEmails(world) {
  return (await listing(world).readRows()).filter((r) => r.email).map((r) => r.email);
}

When('I note the agents listed on the current page', async function () {
  this._firstPage = await listedAgentEmails(this);
  expect(this._firstPage.length, 'the current page listed no agents, so pagination cannot be checked').toBeGreaterThan(0);
  this.attach(`Page 1: ${JSON.stringify(this._firstPage)}`, 'text/plain');
});

When('I go to the next page', { timeout: 90000 }, async function () {
  remember(this, await listing(this).goToNextPage());
});

When('I go to the previous page', { timeout: 90000 }, async function () {
  remember(this, await listing(this).goToPrevPage());
});

Then('none of the previously noted agents should be listed again', async function () {
  const now = await listedAgentEmails(this);
  expect(now.length, 'the next page listed no agents').toBeGreaterThan(0);
  const repeated = now.filter((e) => (this._firstPage || []).includes(e));
  expect(repeated, `these agents appear on both pages: ${JSON.stringify(repeated)}`).toEqual([]);
});

Then('the agents listed should match the first page again', async function () {
  const now = await listedAgentEmails(this);
  this.attach(`Back on page 1: ${JSON.stringify(now)}`, 'text/plain');
  expect(now.slice().sort(), `page 1 held ${JSON.stringify((this._firstPage || []).slice().sort())} `
    + `but going back showed ${JSON.stringify(now)}`).toEqual((this._firstPage || []).slice().sort());
});

// ==================== View / profile ====================

When("I view that agent's profile", { timeout: 90000 }, async function () {
  const agent = subject(this);
  // Search first so the row is on screen: the subject may have come from a filtered payload
  // whose page has since been replaced.
  remember(this, await listing(this).search(agent.name));
  await listing(this).openAgentProfile(agent.email);
});

When('I use the browser Back button', { timeout: 60000 }, async function () {
  await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 });
  await listing(this).settle();
});

// No separate Given for this either — one definition serves every keyword (see the note on
// `I search the agents for that agent's name` above).

Then('I should be on the agent profile page', async function () {
  expect(await profile(this).isOnProfile(), `expected /agents/view/<id>, actually ${this.page.url()}`).toBe(true);
});

Then("the profile should show that agent's name and email", async function () {
  const agent = subject(this);
  const header = await profile(this).readHeader();
  expect(header.text, `the profile does not name ${agent.name}. Header lines: ${JSON.stringify(header.headerLines)}`)
    .toContain(agent.name);
  expect(header.email.toLowerCase(),
    `the profile shows ${JSON.stringify(header.email)} rather than ${agent.email}`).toBe(agent.email.toLowerCase());
});

Then("the profile should show that agent's university", async function () {
  const agent = subject(this);
  const header = await profile(this).readHeader();
  expect(header.text, `the profile does not show "${agent.university}". Header lines: `
    + `${JSON.stringify(header.headerLines)}`).toContain(agent.university);
});

Then('the profile should offer {string} and {string}', async function (a, b) {
  const header = await profile(this).readHeader();
  for (const label of [a, b]) {
    const found = header.actions.some((x) => x.toLowerCase() === label.toLowerCase());
    expect(found, `the profile offers ${JSON.stringify(header.actions)} — "${label}" is missing`).toBe(true);
  }
});

Then('the profile tabs should be:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const actual = await profile(this).tabNames();
  expect(actual, `profile tabs rendered: ${JSON.stringify(actual)}`).toEqual(expected);
});

// The profile keeps everything but "Edit Target" behind a three-dot overflow, so the inline
// controls and the menu are asserted as two separate things — same split, and the same
// reasoning, as the listing's `actions` / `menu` columns.
Then('the profile should offer the inline action {string}', async function (label) {
  const header = await profile(this).readHeader();
  const found = header.actions.some((x) => x.toLowerCase() === label.toLowerCase());
  expect(found, `the profile offers the inline actions ${JSON.stringify(header.actions)} — "${label}" is missing`)
    .toBe(true);
});

Then('the profile overflow menu should offer {string}', { timeout: 60000 }, async function (expectedCsv) {
  const expected = expectedCsv.split(',').map((s) => s.trim()).filter(Boolean);
  const menu = await profile(this).headerMenuItems();
  expect(menu.opened, `the profile has no "${menu.trigger}" control, so ${JSON.stringify(expected)} is unreachable`)
    .toBe(true);
  const labels = menu.items.map((i) => i.label);
  const missing = expected.filter((a) => !labels.some((x) => x.toLowerCase() === a.toLowerCase()));
  const extra = labels.filter((a) => !expected.some((x) => x.toLowerCase() === a.toLowerCase()));
  expect(
    { missing, extra },
    `the profile overflow menu holds ${JSON.stringify(labels)}, expected ${JSON.stringify(expected)}`,
  ).toEqual({ missing: [], extra: [] });
});

// Every tab that offers a profile to open, in one pass. Three scenarios would each pay for a
// browser context and a superadmin login to make the same observation; this walks the rows
// and reports every failure together, so "one origin behaves differently" stays
// distinguishable from "the profile is broken everywhere".
//
// The `menu` column is here because it is the one thing that legitimately DIFFERS by the
// agent's state, which is exactly what makes the tab set and the default selection worth
// asserting as invariant beside it.
//
// "Invite Sent" is absent on purpose: its rows offer no View, so there is no profile.
Then('opening an agent profile should render the same tabs with {string} selected, from each of these tabs:', { timeout: 300000 }, async function (defaultTab, table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const from = row.tab.trim();
    const expectedTabs = row.tabs.split(',').map((s) => s.trim()).filter(Boolean);
    const expectedMenu = (row.menu || '').split(',').map((s) => s.trim()).filter(Boolean);

    remember(this, await listing(this).runAndWaitForList(async () => {
      await listing(this).goto(from);
    }));
    const rows = (await listing(this).readRows()).filter((r) => r.email);
    if (!rows.length) {
      problems.push(`"${from}" listed no agents, so no profile could be opened from it. `
        + `Empty state: ${JSON.stringify(await listing(this).readEmptyState())}`);
      continue;
    }
    const agent = rows[0];
    await listing(this).openAgentProfile(agent.email);
    if (!(await profile(this).isOnProfile())) {
      problems.push(`"${from}": View on ${agent.email} did not reach a profile (${this.page.url()})`);
      continue;
    }

    const tabs = await profile(this).tabNames();
    if (JSON.stringify(tabs) !== JSON.stringify(expectedTabs)) {
      problems.push(`"${from}" (${agent.email}): profile tabs ${JSON.stringify(tabs)}, expected ${JSON.stringify(expectedTabs)}`);
    }
    const selected = await profile(this).selectedTab();
    if (selected.toLowerCase() !== defaultTab.toLowerCase()) {
      problems.push(`"${from}" (${agent.email}): the profile opened on "${selected}", not "${defaultTab}"`);
    }
    // The default tab must also be the one that adds NO ?tab= param — a profile that renders
    // Performance Overview as selected while the URL names another tab is a different bug.
    if (/[?&]tab=/.test(this.page.url())) {
      problems.push(`"${from}" (${agent.email}): the profile opened with a tab param already set (${this.page.url()})`);
    }

    const menu = await profile(this).headerMenuItems();
    const labels = menu.items.map((i) => i.label);
    if (expectedMenu.length) {
      if (!menu.opened) {
        problems.push(`"${from}" (${agent.email}): no "${menu.trigger}" control, so ${JSON.stringify(expectedMenu)} is unreachable`);
      } else {
        const missing = expectedMenu.filter((a) => !labels.some((x) => x.toLowerCase() === a.toLowerCase()));
        const extra = labels.filter((a) => !expectedMenu.some((x) => x.toLowerCase() === a.toLowerCase()));
        if (missing.length || extra.length) {
          problems.push(`"${from}" (${agent.email}) overflow menu: found ${JSON.stringify(labels)}, `
            + `expected ${JSON.stringify(expectedMenu)}`
            + `${missing.length ? ` (missing ${JSON.stringify(missing)})` : ''}`
            + `${extra.length ? ` (unexpected ${JSON.stringify(extra)})` : ''}`);
        }
      }
    }
    report.push(`${from}: ${agent.email} -> ${this.page.url()} tabs ${JSON.stringify(tabs)} `
      + `selected "${selected}" menu ${JSON.stringify(labels)}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The agent profile does not open consistently from every lifecycle tab:');
});

When('I open the {string} profile tab', { timeout: 60000 }, async function (tab) {
  await profile(this).openTab(tab);
});

Then('each profile tab should open and record itself in the URL:', { timeout: 240000 }, async function (table) {
  const problems = [];
  for (const row of table.hashes()) {
    const tab = row.tab.trim();
    const param = (row.param || '').trim();
    await profile(this).openTab(tab);
    const url = this.page.url();
    if (param && !url.includes(`tab=${param}`)) {
      problems.push(`"${tab}": the URL should carry tab=${param} but is ${url}`);
    }
    if (!param && /[?&]tab=/.test(url)) {
      problems.push(`"${tab}" is the default tab and should add no tab param, but the URL is ${url}`);
    }
    const selected = await profile(this).selectedTab();
    if (selected.toLowerCase() !== tab.toLowerCase()) {
      problems.push(`"${tab}": opening it left "${selected}" selected instead`);
    }
    if (!(await profile(this).isOnProfile())) {
      problems.push(`"${tab}": opening it navigated away from the profile, to ${url}`);
    }
  }
  fail(problems, 'The profile tabs did not each open and record themselves:');
});

Then('the Performance Overview should show the sections:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const overview = await profile(this).readPerformanceOverview();
  const missing = expected.filter((s) => !overview.sections.includes(s));
  expect(missing, `sections found: ${JSON.stringify(overview.sections)}`).toEqual([]);
});

Then('the pending verification breakdown should cover:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const overview = await profile(this).readPerformanceOverview();
  const missing = expected.filter((d) => !overview.documentTypes.includes(d));
  expect(missing, `document types found: ${JSON.stringify(overview.documentTypes)}`).toEqual([]);
});

Then('the target progress should offer the periods:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const overview = await profile(this).readPerformanceOverview();
  const missing = expected.filter((p) => !overview.periodOptions.includes(p));
  expect(missing, `periods found: ${JSON.stringify(overview.periodOptions)}`).toEqual([]);
});

// Three independent sources for the same two figures. None of them is trusted as the answer;
// they are compared with each other, and the failure names which one disagrees.
Then("the profile's target progress should agree with the listing row and the server",
  async function () {
    const agent = subject(this);
    const overview = await profile(this).readPerformanceOverview();
    const problems = [];
    if (overview.progressPercent === null) {
      problems.push(`the profile rendered no percentage at all. Overview text: ${JSON.stringify(overview.text.slice(0, 300))}`);
    } else if (Number.isFinite(agent.progress) && agent.progress !== null
      && Math.round(overview.progressPercent) !== Math.round(agent.progress)) {
      problems.push(`target progress: the server said ${agent.progress}% for ${agent.email} but the profile shows `
        + `${overview.progressPercent}%`);
    }
    if (overview.onboarded !== null && Number.isFinite(agent.candidates)
      && overview.onboarded > agent.candidates) {
      problems.push(`the profile reports ${overview.onboarded} candidates onboarded, which is more than the `
        + `${agent.candidates} total candidates the server credits ${agent.email} with`);
    }
    if (agent.cells && agent.cells.length >= 4) {
      const rowPercent = Number(String(agent.cells[3]).replace('%', ''));
      if (Number.isFinite(rowPercent) && overview.progressPercent !== null
        && Math.round(rowPercent) !== Math.round(overview.progressPercent)) {
        problems.push(`the listing row showed ${rowPercent}% but the profile shows ${overview.progressPercent}%`);
      }
    }
    this.attach(`server=${agent.progress}% (${agent.candidates} candidates) | `
      + `listing row=${JSON.stringify((agent.cells || [])[3])} | `
      + `profile=${overview.progressPercent}% (${overview.onboarded} of ${overview.target})`, 'text/plain');
    fail(problems, `The figures for ${agent.email} do not agree across the listing, the profile and the server:`);
  });

// The grid renders a LEADING UNLABELLED COLUMN before "Candidate" — the row-selection
// checkbox (`data-key="select"`, one `[role=checkbox]` per row; measured 2026-09-04). It has
// no name, so it cannot be written as a Gherkin table row without inventing one, and a bare
// empty cell in a one-column table is unreadable. The assertion therefore compares the
// LABELLED columns, in order, and reports the raw header list — blanks included — alongside,
// so an unlabelled column appearing or vanishing is visible in the report even though it is
// not what this step fails on.
Then('the candidates grid should have the columns:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const tab = await profile(this).readCandidatesTab();
  const labelled = tab.headers.filter((h) => h);
  const unlabelled = tab.headers.length - labelled.length;
  this.attach(
    `Candidates grid headers as rendered (${tab.headers.length}): ${JSON.stringify(tab.headers)}\n`
    + `Unlabelled columns: ${unlabelled}${unlabelled ? ' (row-selection checkbox)' : ''}`,
    'text/plain',
  );
  expect(
    labelled,
    `the candidates grid rendered ${JSON.stringify(tab.headers)} `
    + `(${unlabelled} unlabelled column(s) ignored)`,
  ).toEqual(expected);
});

Then('at least one candidate should be listed', { timeout: 60000 }, async function () {
  // Polled: the grid paints before its rows, and a single read under 4 workers returned no rows
  // AND no empty state - i.e. nothing had rendered yet (2026-10-07). Stop at the first settled read.
  const deadline = Date.now() + 20000;
  let tab = await profile(this).readCandidatesTab();
  while (!tab.rows.length && !tab.emptyState && Date.now() < deadline) {
    await this.page.waitForTimeout(500);
    tab = await profile(this).readCandidatesTab();
  }
  expect(tab.rows.length,
    `the Candidates tab listed nothing for an agent the server credits with candidates. `
    + `Empty state: ${JSON.stringify(tab.emptyState)}`).toBeGreaterThan(0);
  this.attach(`Candidates listed: ${JSON.stringify(tab.rows.map((r) => r.email || r.name))}`, 'text/plain');
});

Then('the activity log should offer the periods:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const log = await profile(this).readActivityLog();
  const missing = expected.filter((p) => !log.periodOptions.includes(p));
  expect(missing, `periods found: ${JSON.stringify(log.periodOptions)}`).toEqual([]);
});

When('I click the profile {string} control', { timeout: 60000 }, async function (label) {
  expect(label.toLowerCase()).toBe('back');
  await profile(this).clickBack();
});

// Back, from every tab that offers a profile to return from. One scenario driving a table
// rather than three scenarios: each would otherwise pay for its own browser context and
// superadmin login to make one observation. Every row is walked and the failures are
// reported together, because a Back that misbehaves on one tab says nothing about the
// others and an abandon-on-first-failure run would not distinguish "one tab is wrong" from
// "the control is broken everywhere".
//
// "Invite Sent" is deliberately absent: its rows offer Edit and Resend Invite and no View,
// so there is no profile to come back from.
Then('returning from an agent profile should land on the Agents listing for each of these tabs:', { timeout: 240000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const from = row.tab.trim();
    const expected = row.lands_on.trim();

    remember(this, await listing(this).runAndWaitForList(async () => {
      await listing(this).goto(from);
    }));
    const rows = (await listing(this).readRows()).filter((r) => r.email);
    if (!rows.length) {
      problems.push(`"${from}" listed no agents, so Back could NOT be exercised from it. `
        + `Empty state: ${JSON.stringify(await listing(this).readEmptyState())}`);
      continue;
    }

    const agent = rows[0];
    await listing(this).openAgentProfile(agent.email);
    if (!(await profile(this).isOnProfile())) {
      problems.push(`"${from}": opening ${agent.email} did not reach a profile page (${this.page.url()})`);
      continue;
    }
    const profileUrl = this.page.url();

    await profile(this).clickBack();
    const landedUrl = this.page.url();
    const selected = await listing(this).selectedTab();

    if (!(await listing(this).isOnListing())) {
      problems.push(`"${from}": Back left the superadmin on ${landedUrl}, not the Agents listing`);
    }
    if (selected.toLowerCase() !== expected.toLowerCase()) {
      problems.push(`"${from}": Back selected the "${selected}" tab, expected "${expected}" (landed on ${landedUrl})`);
    }
    if (!(await listing(this).grid.isVisible().catch(() => false))) {
      problems.push(`"${from}": Back reached ${landedUrl} but no agent grid is rendered`);
    }
    report.push(`${from} -> profile ${profileUrl} -> Back -> ${landedUrl} (tab "${selected}")`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'Back did not return to the Agents listing as specified:');
});

// ==================== Edit Target ====================

When('I open the Edit Target modal', { timeout: 60000 }, async function () {
  await profile(this).openEditTarget();
});

Then('the Edit Target modal heading should be {string}', async function (expected) {
  const state = await profile(this).readEditTarget();
  expect(state, 'the Edit Target modal is not open').toBeTruthy();
  expect(state.heading).toBe(expected);
});

Then('the Edit Target modal should ask for a numeric monthly performance target', async function () {
  const state = await profile(this).readEditTarget();
  expect(state, 'the Edit Target modal is not open').toBeTruthy();
  expect(state.body, `the modal reads ${JSON.stringify(state.body)}`).toMatch(/numeric performance target/i);
  expect(state.body, 'the field should say which period the target covers').toMatch(/\(monthly\)/i);
});

Then("the Edit Target field should hold that agent's current target", async function () {
  const state = await profile(this).readEditTarget();
  expect(state && state.field, 'the Edit Target modal has no input').toBeTruthy();
  expect(state.field.value.trim(),
    'the Edit Target field opened empty, so it is not pre-filled with the current target').not.toBe('');
  expect(Number.isFinite(Number(state.field.value.trim())),
    `the Edit Target field holds ${JSON.stringify(state.field.value)}, which is not a number`).toBe(true);
  this.attach(`Edit Target pre-filled with ${JSON.stringify(state.field.value)}`, 'text/plain');
});

Then('the Edit Target modal should offer {string} and {string}', async function (a, b) {
  const state = await profile(this).readEditTarget();
  expect(state, 'the Edit Target modal is not open').toBeTruthy();
  for (const label of [a, b]) {
    const found = state.buttons.some((x) => x.label.toLowerCase() === label.toLowerCase());
    expect(found, `the modal offers ${JSON.stringify(state.buttons.map((x) => x.label))}`).toBe(true);
  }
});

When('I cancel the Edit Target modal', { timeout: 60000 }, async function () {
  await profile(this).cancelEditTarget();
});

Then('the Edit Target modal should not be visible', async function () {
  expect(await profile(this).editTargetDialog.isVisible().catch(() => false),
    'the Edit Target modal is still open').toBe(false);
});

// Never clicks Save. It asserts the GATE — whether the form would let the superadmin commit
// the value — because finding out what the backend does with "abc" would mean writing a
// broken target onto a live agent.
Then('the Edit Target modal should refuse each invalid target:', { timeout: 180000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const target = row.target === undefined ? '' : row.target;
    const why = (row.why || '').trim();
    const state = await profile(this).editTargetGating(target);
    report.push(`typed=${JSON.stringify(target)} held=${JSON.stringify(state.held)} `
      + `saveDisabled=${state.saveDisabled} errors=${JSON.stringify(state.errors)}`);
    // Refused means one of: the field would not take it, Save is gated, or an error is shown.
    const fieldRejected = String(state.held).trim() === '' && String(target).trim() !== '';
    const refused = state.saveDisabled === true || state.errors.length > 0 || fieldRejected;
    if (!refused) {
      problems.push(`${JSON.stringify(target)} (${why}) was ACCEPTED: the field kept `
        + `${JSON.stringify(state.held)}, "Save Changes" is enabled and no inline error is shown`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The Edit Target modal does not refuse invalid monthly targets '
    + '(it did refuse all four on 2026-10-22, with an inline error and Save disabled - this is a regression):');
});

// ==================== Deactivate ====================

When('I open the Deactivate dialog for that agent', { timeout: 120000 }, async function () {
  const agent = subject(this);
  remember(this, await listing(this).search(agent.name));
  await listing(this).openDeactivateDialog(agent.email);
  this._deactivate = await listing(this).readDeactivateDialog();
  expect(this._deactivate, 'the Deactivate dialog did not open').toBeTruthy();
  this.attach(`Deactivate dialog for ${agent.email} (${agent.candidates} candidates):\n${this._deactivate.body}`, 'text/plain');
});

Then('the deactivate dialog heading should be {string}', async function (expected) {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.heading).toBe(expected);
});

Then('the deactivate dialog should say there are no active candidates assigned', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.body, `the dialog reads: ${this._deactivate.body}`)
    .toMatch(/no active candidates assigned/i);
  expect(this._deactivate.body).toMatch(/proceed with deactivation directly/i);
});

Then('the deactivate dialog should not ask for a candidate transfer', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.requiresTransfer,
    `the dialog asks for a transfer: ${this._deactivate.body}`).toBe(false);
  expect(this._deactivate.hasAgentPicker, 'the dialog offers a receiving-agent picker').toBe(false);
});

Then('the deactivate dialog should require the candidates to be transferred first', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.body, `the dialog reads: ${this._deactivate.body}`)
    .toMatch(/must first transfer/i);
  expect(this._deactivate.body).toMatch(/within the same university hub/i);
  expect(this._deactivate.requiresTransfer, 'the dialog does not offer Transfer & Deactivate').toBe(true);
});

Then("the deactivate dialog should name that agent's number of active candidates", async function () {
  const agent = subject(this);
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  const m = this._deactivate.body.match(/transfer\s+\w+\s+(\d+)\s+active candidate/i);
  expect(m, `the dialog does not state a candidate count: ${this._deactivate.body}`).toBeTruthy();
  expect(Number(m[1]),
    `the dialog says ${m[1]} active candidates but the server credits ${agent.email} with ${agent.candidates}`)
    .toBe(agent.candidates);
});

Then("the deactivate dialog should show that agent's university as the affiliation", async function () {
  const agent = subject(this);
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.body, `the dialog does not mention "${agent.university}": ${this._deactivate.body}`)
    .toContain(agent.university);
});

Then('the deactivate dialog should offer a receiving agent picker', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.hasAgentPicker,
    `the dialog offers no "Select an agent" field: ${this._deactivate.body}`).toBe(true);
});

Then('the confirm button should be labelled {string}', async function (expected) {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.confirmLabel,
    `the dialog's buttons are ${JSON.stringify(this._deactivate.buttons)}`).toBe(expected);
});

Then('the confirm button should be disabled', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.confirmDisabled,
    `"${this._deactivate.confirmLabel}" is enabled with no receiving agent chosen`).toBe(true);
});

Then('the confirm button should be enabled', async function () {
  expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
  expect(this._deactivate.confirmDisabled, `"${this._deactivate.confirmLabel}" is disabled`).toBe(false);
});

When('I cancel the Deactivate dialog', { timeout: 60000 }, async function () {
  await listing(this).cancelDeactivateDialog();
});

Then('the deactivate dialog should not be visible', async function () {
  expect(await listing(this).deactivateDialog.isVisible().catch(() => false),
    'the Deactivate dialog is still open').toBe(false);
});

// ---------- The transfer-picker defect ----------

// Establish, from the app's OWN listing, that other agents exist at this university. Doing it
// through the UI rather than a direct API call keeps the assertion reproducible without a
// token: an unauthenticated fetch from page context answers 401 with an empty list, which
// would make this look like "there are no other agents" and prove the opposite of the point.
Given("other agents exist at that agent's university", { timeout: 120000 }, async function () {
  const agent = subject(this);
  expect(agent.university, 'the subject agent has no university recorded').toBeTruthy();
  const result = await listing(this).runAndWaitForList(async () => {
    await this.page.goto(`${listing(this).url}?university=${encodeURIComponent(agent.university)}`);
  });
  remember(this, result);
  const others = lastPayloadAgents(this)
    .filter((a) => (a.email || '').toLowerCase() !== agent.email.toLowerCase());
  expect(others.length,
    `"${agent.university}" holds no agent other than ${agent.email}, so this scenario has no premise. `
    + 'It needs a university with at least two agents.').toBeGreaterThan(0);
  this._otherAgents = others;
  this.attach(`Other agents at "${agent.university}" (${others.length}):\n`
    + others.map((a) => `  ${a.name} <${a.email}> status=${a.status} candidates=${a.candidates}`).join('\n'), 'text/plain');
});

Then('the receiving agent picker should offer at least one of those other agents',
  { timeout: 120000 }, async function () {
    const agent = subject(this);
    const others = this._otherAgents || [];
    const picker = await listing(this).transferAgentOptions();
    this.attach(`Picker offered: ${JSON.stringify(picker.offered)}\n`
      + `Empty state: ${JSON.stringify(picker.emptyState)}`, 'text/plain');
    expect(picker.pickerPresent, 'the dialog has no receiving-agent picker to open').toBe(true);

    const offeredText = picker.offered.join(' | ').toLowerCase();
    const matched = others.filter((a) => offeredText.includes((a.name || '').toLowerCase())
      || offeredText.includes((a.email || '').toLowerCase()));

    expect(matched.length,
      `The receiving-agent picker offers none of the ${others.length} other agents the app itself lists at `
      + `"${agent.university}".\n`
      + `  It rendered: ${picker.emptyState ? JSON.stringify(picker.emptyState) : JSON.stringify(picker.offered)}\n`
      + `  Other agents at that university, per the listing:\n`
      + others.slice(0, 10).map((a) => `    ${a.name} <${a.email}> status=${a.status}`).join('\n')
      + `\n  Consequence: "Transfer & Deactivate" stays disabled, so ${agent.email} cannot be deactivated at all.\n`
      + '  Note that most of those agents carry status ATTENTION while only the agent being deactivated is ACTIVE, '
      + 'so the likely cause is the picker filtering to ACTIVE only — but ATTENTION is an overlay on Active, not a '
      + 'separate stage (the Active tab itself queries status=ACTIVE&status=ATTENTION). ASK DEV whether excluding '
      + 'flagged agents is intended; if it is, the empty state should say so rather than claim none exist.')
      .toBeGreaterThan(0);
  });

// ---------- The transfer-prompt copy defects ----------

// Both faults live in ONE sentence and are independent, so they are collected and reported
// together — two consecutive Then steps would only ever show whichever failed first.
Then('the transfer prompt should refer to the agent without assuming gender and agree in number',
  async function () {
    const agent = subject(this);
    expect(this._deactivate, 'no deactivate dialog was read').toBeTruthy();
    const sentence = (this._deactivate.body.match(/To deactivate .*?hub\./i) || [this._deactivate.body])[0];
    const problems = [];

    const gendered = sentence.match(/\b(his|her|hers)\b/i);
    if (gendered) {
      problems.push(`it says "${gendered[0]}" — a gendered pronoun the app cannot know is correct. Measured across `
        + 'six different agents on 2026-08-11, "his" is rendered for every one of them regardless of who they are, '
        + `including this agent (${agent.name}), so the portal misgenders agents. "their" is correct for everyone.`);
    }
    const count = sentence.match(/(\d+)\s+active\s+candidate(s?)\b/i);
    if (!count) {
      problems.push(`it states no candidate count at all. Sentence: ${JSON.stringify(sentence)}`);
    } else {
      const n = Number(count[1]);
      const plural = count[2] === 's';
      if (n === 1 && plural) {
        problems.push(`it says "${count[0]}" — with a count of 1 the noun should be singular ("1 active candidate").`);
      }
      if (n !== 1 && !plural) {
        problems.push(`it says "${count[0]}" — with a count of ${n} the noun should be plural.`);
      }
    }
    this.attach(`Transfer prompt for ${agent.name} <${agent.email}> (${agent.candidates} candidates):\n${sentence}`, 'text/plain');
    fail(problems, `The transfer prompt is worded wrongly:\n  ${sentence}\n`);
  });

// ==================== Reactivate ====================

When('I open the Reactivate dialog for that agent', { timeout: 120000 }, async function () {
  const agent = subject(this);
  remember(this, await listing(this).search(agent.name));
  await listing(this).openReactivateDialog(agent.email);
  this._reactivate = await listing(this).readReactivateDialog();
  expect(this._reactivate, 'the Reactivate dialog did not open').toBeTruthy();
  this.attach(`Reactivate dialog for ${agent.email}:\n${this._reactivate.body}`, 'text/plain');
});

Then('the reactivate dialog heading should be {string}', async function (expected) {
  expect(this._reactivate, 'no reactivate dialog was read').toBeTruthy();
  expect(this._reactivate.heading).toBe(expected);
});

Then('the reactivate dialog should name that agent', async function () {
  const agent = subject(this);
  expect(this._reactivate, 'no reactivate dialog was read').toBeTruthy();
  expect(this._reactivate.body, `the dialog reads: ${this._reactivate.body}`).toContain(agent.name);
});

Then('the reactivate dialog should say the agent regains access instantly', async function () {
  expect(this._reactivate, 'no reactivate dialog was read').toBeTruthy();
  expect(this._reactivate.body, `the dialog reads: ${this._reactivate.body}`)
    .toMatch(/regain access to all agent features instantly/i);
});

Then('the reactivate dialog should say a re-activation email will be sent', async function () {
  expect(this._reactivate, 'no reactivate dialog was read').toBeTruthy();
  expect(this._reactivate.body, `the dialog reads: ${this._reactivate.body}`)
    .toMatch(/re-?activation email will be sent/i);
});

Then('the reactivate dialog should offer {string} and {string}', async function (a, b) {
  expect(this._reactivate, 'no reactivate dialog was read').toBeTruthy();
  for (const label of [a, b]) {
    const found = this._reactivate.buttons.some((x) => x.label.toLowerCase() === label.toLowerCase());
    expect(found, `the dialog offers ${JSON.stringify(this._reactivate.buttons.map((x) => x.label))}`).toBe(true);
  }
});

When('I cancel the Reactivate dialog', { timeout: 60000 }, async function () {
  await listing(this).cancelReactivateDialog();
});

// ==================== Notify ====================

When('I open the Notify dialog for that agent', { timeout: 120000 }, async function () {
  const agent = subject(this);
  remember(this, await listing(this).search(agent.name));
  await listing(this).openNotifyDialog(agent.email);
  this._notify = await listing(this).readNotifyDialog();
  expect(this._notify, 'the Notify dialog did not open').toBeTruthy();
  this.attach(`Notify dialog for ${agent.email}:\n${this._notify.body}`, 'text/plain');
});

Then('the notify dialog heading should be {string}', async function (expected) {
  expect(this._notify, 'no notify dialog was read').toBeTruthy();
  expect(this._notify.heading).toBe(expected);
});

Then('the notify dialog should name that agent as the recipient', async function () {
  const agent = subject(this);
  expect(this._notify, 'no notify dialog was read').toBeTruthy();
  expect(this._notify.body, `the dialog reads: ${this._notify.body}`).toContain(agent.name);
  expect(this._notify.body, 'the dialog should name the recipient explicitly').toMatch(/sending to/i);
});

Then('the notify dialog should offer a message preview', async function () {
  expect(this._notify, 'no notify dialog was read').toBeTruthy();
  expect(this._notify.hasMessagePreview,
    `the dialog reads: ${this._notify.body}`).toBe(true);
});

Then('the notify dialog should offer {string} and {string}', async function (a, b) {
  expect(this._notify, 'no notify dialog was read').toBeTruthy();
  for (const label of [a, b]) {
    const found = this._notify.buttons.some((x) => x.label.toLowerCase() === label.toLowerCase());
    expect(found, `the dialog offers ${JSON.stringify(this._notify.buttons.map((x) => x.label))}`).toBe(true);
  }
});

When('I cancel the Notify dialog', { timeout: 60000 }, async function () {
  await listing(this).cancelNotifyDialog();
});

Then('the notify dialog should not be visible', async function () {
  expect(await listing(this).notifyDialog.isVisible().catch(() => false),
    'the Notify dialog is still open').toBe(false);
});

// ==================== The @mutates-agent round trip ====================

// These two are the ONLY steps in this file that commit anything. Each arms a restore first,
// so a failure between them cannot leave the agent on the wrong tab silently.
When('I confirm the re-activation', { timeout: 180000 }, async function () {
  const agent = subject(this);
  this._agentRestore = { email: agent.email, name: agent.name, restoreTo: 'Deactivated' };
  await listing(this).reactivateDialog
    .getByRole('button', { name: /^re-?activate account$/i }).first().click();
  await listing(this).reactivateDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await this.page.waitForTimeout(2500);
  const toasts = await listing(this).toastMessages();
  this.attach(`Re-activated ${agent.email}. Toast: ${JSON.stringify(toasts)}`, 'text/plain');
});

When('I confirm the deactivation', { timeout: 180000 }, async function () {
  const agent = subject(this);
  const dialog = listing(this).deactivateDialog;
  const confirm = dialog.getByRole('button', { name: /^deactivate$/i }).first();
  await expect(confirm, 'the direct Deactivate button is not available — this step must not be used on the '
    + 'transfer variant, which would move real candidates').toBeEnabled({ timeout: 15000 });
  await confirm.click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await this.page.waitForTimeout(2500);
  // The round trip is complete, so nothing needs restoring any more.
  this._agentRestore = null;
  const toasts = await listing(this).toastMessages();
  this.attach(`Deactivated ${agent.email}. Toast: ${JSON.stringify(toasts)}`, 'text/plain');
});

// Put the agent back if the round trip died half way. Scoped to @mutates-agent so it costs
// nothing for the other scenarios, and it NEVER throws — masking the scenario's own failure
// with a cleanup error would be worse, and an agent left on the wrong tab is visible either
// way. A failed restore is attached to the report instead.
After({ tags: '@mutates-agent', timeout: 180000 }, async function () {
  if (!this._agentRestore) return;
  const { email, name, restoreTo } = this._agentRestore;
  try {
    const where = await listing(this).whereIsAgent({ name, email });
    if (where.some((w) => w.tab === restoreTo)) {
      this.attach(`Restore not needed: ${email} is already on "${restoreTo}".`, 'text/plain');
      return;
    }
    await listing(this).goto('Active');
    await listing(this).search(name);
    await listing(this).openDeactivateDialog(email);
    const state = await listing(this).readDeactivateDialog();
    if (state && state.requiresTransfer) {
      // Deliberately does NOT transfer. A transfer is the one action in this module with no
      // undo anywhere in the portal, so the hook reports and stops rather than guessing.
      await listing(this).cancelDeactivateDialog().catch(() => {});
      this.attach(`COULD NOT RESTORE ${email}: it is Active and now holds candidates, so deactivating it would `
        + 'require transferring them — which this hook will not do, because a transfer cannot be undone. '
        + 'Deactivate it by hand from the superadmin portal (Agents > find > Deactivate Account).', 'text/plain');
      return;
    }
    await listing(this).deactivateDialog.getByRole('button', { name: /^deactivate$/i }).first().click();
    await this.page.waitForTimeout(3000);
    this.attach(`Restored ${email} to "${restoreTo}".`, 'text/plain');
  } catch (error) {
    this.attach(`COULD NOT RESTORE ${email} to "${restoreTo}": ${error.message}\n`
      + 'Put it back by hand from the superadmin portal (Agents > find > Deactivate Account).', 'text/plain');
  }
});
