const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const CandidateViewProfilePage = require('../pages/CandidateViewProfilePage');
const { resilientSignIn } = require('../utils/resilientSignIn');
require('dotenv').config();

const AGENT_EMAIL = process.env.AGENT_EMAIL;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalise a feature-file option label to a tolerant regex that also matches
// the real app's wording (e.g. feature "Inactive (30+ days)" -> app "30+ days").
function optionRegex(label) {
  let alt = label.replace(/^Inactive\s*\((.*)\)$/i, '$1'); // "Inactive (30+ days)" -> "30+ days"
  return new RegExp(escapeRegExp(alt).replace(/\s+/g, '\\s*'), 'i');
}

// Attach evidence to the report. Same shape as the helper in invite-candidate.js
// (kept local rather than exported across step files, which Cucumber loads into
// one global registry). Every row-action assertion attaches what it measured, so
// a green run records the state the app was in and a red one carries its evidence.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// Subscription-status pill colour -> Tailwind class fragments used by the app.
// Verified against the live DOM on 2026-07-21.
const PILL_COLORS = {
  green: /success/, // Subscribed  -> bg-success-25 ring-success-600
  orange: /warning/, // Payment Due -> bg-warning-* (orange)
  red: /error/, // Not Subscribed -> bg-error-25 ring-error-600
};

// ==================== Background ====================

// >>> THE SHARED AGENT BACKGROUND LOGIN. <<< Used by the Active, Requires Attention and
// Deactivated features, so a stall here fails a Background and costs a whole scenario in three
// separate areas.
//
// It used to be a bare waitForURL with no retry, and this environment intermittently STALLS a
// login - the form submits and the app never navigates, with no error shown. Measured at 2 of 45,
// 0 of 45 and 1 of 45 scenarios across three runs of candidate-view-profile.feature, and it hit
// candidate-deactivated.feature the same way. Every one passed when re-run alone.
//
// resilientSignIn() bounds each attempt and CLASSIFIES the outcome, rather than waiting longer:
// a stall is retried, a rejection or a lockout fails immediately (retrying a wrong password
// deepens this backend's per-account rate limit and turns one fixture problem into an unusable
// run). See utils/resilientSignIn.js - the reasoning is written down there once, not per caller.
Given('I am logged in as an agent', { timeout: 150000 }, async function () {
  if (!AGENT_EMAIL || !AGENT_PASSWORD) {
    throw new Error('Missing AGENT_EMAIL / AGENT_PASSWORD in .env');
  }
  await resilientSignIn(this, AGENT_EMAIL, AGENT_PASSWORD, {
    landedOn: /\/dashboard|\/candidates|\/getting-started/,
  });
});

Given('I am on the Candidates Active tab', async function () {
  await this.pages.activeCandidate.navigate();
});

// ==================== Shared preconditions ====================

Given('the candidate table has at least one record visible', async function () {
  const count = await this.pages.activeCandidate.rowCount();
  expect(count, 'expected at least one candidate row').toBeGreaterThan(0);
});

// ==================== load & columns ====================

// Polled: after a navigation the URL and the radiogroup settle a moment after the route commits.
Then('the {string} quick filter tab should be active', { timeout: 30000 }, async function (label) {
  await expect
    .poll(() => this.pages.activeCandidate.isQuickFilterActive(label), {
      timeout: 15000,
      message: `the "${label}" quick filter tab should be active (url: ${this.page.url()})`,
    })
    .toBe(true);
});

Then('the candidate table should be visible', async function () {
  await expect(this.pages.activeCandidate.table).toBeVisible({ timeout: 15000 });
});

Then('the page title or heading should indicate {string} candidates', async function (word) {
  await expect(this.pages.activeCandidate.pageHeading).toBeVisible({ timeout: 15000 });
  await expect(this.pages.activeCandidate.pageHeading).toContainText(new RegExp(word, 'i'));
});

Then('the table should display the following columns:', async function (dataTable) {
  const table = this.pages.activeCandidate.table;
  await expect(table, 'candidate grid should be visible').toBeVisible({ timeout: 15000 });
  for (const [column] of dataTable.raw()) {
    // The header label is rendered inside a nested role="group", which leaves the
    // columnheader's *accessible name* empty — so getByRole({ name }) never matches.
    // Match on the header cell's text content instead.
    const header = table.locator('[role="columnheader"]', {
      hasText: new RegExp(escapeRegExp(column), 'i'),
    });
    await expect(header.first(), `column "${column}" should be visible`).toBeVisible({ timeout: 10000 });
  }
});

// ====================  quick filters ====================

When('I click the {string} quick filter tab', async function (label) {
  await this.pages.activeCandidate.clickQuickFilter(label);
});

Then('the {string} tab should become active', async function (label) {
  expect(await this.pages.activeCandidate.isQuickFilterActive(label)).toBeTruthy();
});

// Tolerant: a filter view legitimately shows either matching rows OR an
// empty-state panel (e.g. "Payment Due" currently has no candidates).
Then('the table should refresh and display results for {string}', async function (_label) {
  const count = await this.pages.activeCandidate.rowCount();
  if (count > 0) {
    await expect(this.pages.activeCandidate.table).toBeVisible();
    return;
  }
  const emptyState = this.page.getByText(/no .*|appear here|nothing/i).first();
  await expect(emptyState, 'expected rows or an empty-state message').toBeVisible({ timeout: 10000 });
});

// ==================== Search ====================

// Search matches BOTH candidate name and email; drive it with the first visible
// candidate's real value ("name" -> first name token, "email" -> full email) so
// the query always matches live data rather than a hardcoded term.
When("I search by the first candidate's {word}", async function (field) {
  const { name, email } = await this.pages.activeCandidate.firstCandidate();
  const term = /email/i.test(field) ? email : (name.split(/\s+/)[0] || '');
  expect(term, `first candidate row should expose a ${field}`).toBeTruthy();
  this.searchTerm = term;
  await this.pages.activeCandidate.search(term);
});

When('I type {string} into the search bar', async function (term) {
  this.searchTerm = term;
  await this.pages.activeCandidate.search(term);
});

// The grid keeps the PREVIOUS query's rows while the next one is in flight, so a fixed sleep here
// let the following step read (or click) a row from the unfiltered list. It now waits until the
// grid shows either no rows or only rows matching the term. It does not fail by itself: the
// assertion steps after it own the verdict, and a search legitimately matching nothing must pass.
When('I wait for the search results to update', { timeout: 30000 }, async function () {
  const ac = this.pages.activeCandidate;
  const re = this.searchTerm ? new RegExp(escapeRegExp(this.searchTerm), 'i') : null;
  await expect
    .poll(
      async () => {
        const texts = await ac.visibleRowHeaders();
        return !re || texts.length === 0 || texts.every((t) => re.test(t));
      },
      { timeout: 15000 }
    )
    .toBe(true)
    .catch(() => {});
  await this.page.waitForTimeout(500); // let the settled rows finish painting their action cells
});

Then('the table should show no candidate rows', async function () {
  const count = await this.pages.activeCandidate.rowCount();
  expect(count).toBe(0);
});

Then('the page should not crash or throw an error', async function () {
  await expect(this.pages.activeCandidate.pageHeading).toBeVisible();
  await expect(this.pages.activeCandidate.searchInput).toBeVisible();
});

// ====================  filter modal ====================

When('I click the {string} button', async function (label) {
  if (/^filters$/i.test(label)) {
    await this.pages.activeCandidate.filtersButton.click();
    await expect(this.pages.activeCandidate.filterModal).toBeVisible({ timeout: 10000 });
    return;
  }
  if (/^send reminder$/i.test(label)) {
    await this.pages.activeCandidate.reminderModal
      .getByRole('button', { name: /^Send Reminder$/i })
      .click();
    return;
  }
  if (/^back$/i.test(label)) {
    // The profile "Back" affordance is a clickable paragraph, not a <button>,
    // and a hidden responsive duplicate also exists — scope to the visible one.
    await this.page.locator(':text-is("Back"):visible').first().click();
    return;
  }
  await this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
});

Then('the filter modal should be visible', async function () {
  await expect(this.pages.activeCandidate.filterModal).toBeVisible({ timeout: 10000 });
});

Then('the filter modal should not be visible', async function () {
  await expect(this.pages.activeCandidate.filterModal).toBeHidden({ timeout: 10000 });
});

Then('the filter modal should close', async function () {
  await expect(this.pages.activeCandidate.filterModal).toBeHidden({ timeout: 10000 });
});

Then('the modal should contain the filter group {string}', async function (group) {
  await expect(
    this.pages.activeCandidate.filterModal.getByText(new RegExp(escapeRegExp(group), 'i')).first()
  ).toBeVisible({ timeout: 10000 });
});

// A removed group must STAY removed (Subscription Status left this modal on 2026-10-05). The modal
// is waited for first, so "absent" is not just "not painted yet".
Then('the modal should not contain the filter group {string}', async function (group) {
  const modal = this.pages.activeCandidate.filterModal;
  await expect(modal).toBeVisible({ timeout: 10000 });
  const text = await modal.innerText();
  expect(text, `the filter modal should no longer offer a "${group}" group`).not.toMatch(
    new RegExp(`(^|\\n)\\s*${escapeRegExp(group)}\\s*(\\n|$)`, 'i')
  );
});

Then('the {string} group should have options:', async function (_group, dataTable) {
  const modalText = await this.pages.activeCandidate.filterModal.innerText();
  for (const [option] of dataTable.raw()) {
    expect(modalText, `option "${option}" should be present`).toMatch(optionRegex(option));
  }
});

When('I select the {string} option under {string}', async function (option, _group) {
  await this.pages.activeCandidate.selectFilterOption(option);
});

When('I apply the filters', async function () {
  await this.pages.activeCandidate.applyFilters();
});

// ====================  modal close methods ====================

async function closeModalVia(page, modal, method) {
  if (/x icon/i.test(method)) {
    await modal.getByRole('button', { name: /^close$/i }).first().click();
  } else if (/cancel/i.test(method)) {
    await modal.getByRole('button', { name: /^cancel$/i }).first().click();
  } else if (/backdrop/i.test(method)) {
    // Click the overlay outside the dialog (top-left corner). React-Aria's
    // hidden "Dismiss" button is pointer-intercepted, so fall back to Escape.
    await page.mouse.click(8, 8);
    await page.waitForTimeout(300);
    if (await modal.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
    }
  } else {
    await page.keyboard.press('Escape');
  }
}

When('I close the filter modal via {string}', async function (method) {
  await closeModalVia(this.page, this.pages.activeCandidate.filterModal, method);
});

When('I close the reminder modal via {string}', async function (method) {
  await closeModalVia(this.page, this.pages.activeCandidate.reminderModal, method);
});

// ==================== subscription pills ====================

Then('candidates with {string} status should show a/an {word} pill', async function (status, color) {
  const classFragment = PILL_COLORS[color.toLowerCase()];
  expect(classFragment, `unknown pill colour "${color}"`).toBeTruthy();
  // Surface the candidates of this status via its matching quick-filter tab, so
  // the colour is actually asserted rather than silently skipped just because
  // page 1 of "All" happens to contain none of them.
  await this.pages.activeCandidate.clickQuickFilter(status);
  // Status pills are <span class="...rounded-full...bg-{colour}-* ring-{colour}-*">
  // carrying an icon + the status label. Match on the EXACT label so
  // "Subscribed" does not also match "Not Subscribed", and scope to grid cells
  // so the quick-filter tab buttons (same text) are excluded.
  const pills = this.pages.activeCandidate.table
    .locator('[role="gridcell"] span.rounded-full')
    .filter({ hasText: new RegExp(`^${escapeRegExp(status)}$`, 'i') });
  const n = await pills.count();
  if (n === 0) {
    // Genuinely no candidate in this state (e.g. Payment Due is empty) — nothing to assert.
    console.log(`[P8] No "${status}" candidates exist; skipping ${color} colour check.`);
    return;
  }
  for (let i = 0; i < n; i++) {
    const cls = (await pills.nth(i).getAttribute('class')) || '';
    expect(
      classFragment.test(cls),
      `"${status}" pill #${i} should use the ${color} (${classFragment}) colour classes, got: ${cls}`
    ).toBeTruthy();
  }
});

// ====================  header tooltip ====================

When('I hover over the info icon in the {string} column header', async function (_column) {
  await this.pages.activeCandidate.hoverVerificationInfo();
});

Then('a tooltip should become visible', async function () {
  const tooltip = this.page
    .locator('[role="tooltip"], .tooltip-title, [data-radix-popper-content-wrapper]')
    .first();
  await expect(tooltip).toBeVisible({ timeout: 8000 });
});

// ====================  E2E — profile navigation & state ====================

When('I note the current URL and filter state', async function () {
  this.noted = {
    url: this.page.url(),
    search: await this.pages.activeCandidate.getSearchValue(),
  };
});

// Notes WHO is on the first row before clicking, so the profile step can check the View action
// opened that candidate rather than any profile at all.
When('I click the eye icon on the first candidate row', { timeout: 60000 }, async function () {
  this.openedCandidate = await this.pages.activeCandidate.firstCandidate();
  await this.pages.activeCandidate.openFirstCandidateProfile();
});

// >>> THE PROFILE NO LONGER HAS A "Profile" HEADING - ITS <h1> READS "Candidates". <<<
// Re-measured 2026-10-06 (scripts/probe-active-profile-landing.js). This step waited 5s for a
// "Profile" heading and so failed on every run against a profile that renders completely in ~2s.
// Requires Attention hit the same change on 2026-10-05. The screen is now identified by what it
// IS, not by copy: the profile route with a candidate id, the five-tab strip (polled - it paints
// after the shell), and the candidate's name in the header, compared against the row that was
// clicked so a View that opened somebody else's profile cannot pass.
Then('I should be on the candidate profile page', { timeout: 60000 }, async function () {
  await expect(this.page).toHaveURL(/\/candidates\/\d+\/view-profile/, { timeout: 30000 });
  const vp = this.pages.candidateViewProfile;
  const settled = await vp.settleProfile(30000);
  const tabs = await vp.tabLabels();
  expect(settled, `the profile did not finish rendering; tabs seen: ${JSON.stringify(tabs)}`).toBe(true);
  expect(tabs).toEqual(expect.arrayContaining(CandidateViewProfilePage.TABS.map((t) => t.label)));
  const want = this.openedCandidate && this.openedCandidate.name;
  if (want) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const shown = (await vp.readHeader()).name;
    expect(norm(shown), `the profile opened should belong to the clicked row "${want}"`).toBe(norm(want));
  }
});

Then('the profile page should have a {string} button', async function (label) {
  await expect(this.page.locator(`:text-is("${label}"):visible`).first()).toBeVisible({ timeout: 15000 });
});

Then('I should be returned to the Active tab', async function () {
  await expect(this.page).toHaveURL(/\/candidates\/active/, { timeout: 15000 });
});

// >>> OPENING A PROFILE PUSHES **TWO** HISTORY ENTRIES, SO ONE BACK PRESS DOES NOT LEAVE IT. <<<
// Measured 2026-09-09: the eye icon navigates to `/candidates/<id>/view-profile` and the profile
// then replaces that with `/candidates/<id>/view-profile?selectedTab=candidate-details`, taking
// history from 4 entries to 6. So:
//   back #1 -> /candidates/7/view-profile          (still on the profile, tab param dropped)
//   back #2 -> /candidates/active?search=...&activeFilter=subscribed   (the listing, restored)
// A step that pressed back ONCE would assert the listing's state against the profile page and
// report "the tab was not preserved" for a build that preserves it perfectly. It therefore walks
// back until it actually leaves the profile, and REPORTS how many presses that took - so the
// extra entry stays visible instead of being silently absorbed. A user pressing Back once sees
// nothing happen, which is worth raising on its own.
When('I return with the browser back button', { timeout: 120000 }, async function () {
  const hops = [];
  for (let i = 0; i < 4; i += 1) {
    await this.page.goBack().catch(() => {});
    await this.page.waitForTimeout(3500);
    const url = this.page.url();
    hops.push(url);
    if (/\/candidates\/active/.test(url)) break;
  }
  this.backHops = hops;
  await this.attach(
    `Browser back took ${hops.length} press(es) to leave the profile:\n`
    + hops.map((u, i) => `  back #${i + 1} -> ${u}`).join('\n')
    + (hops.length > 1
      ? '\n\nMEASURED: opening a profile pushes TWO history entries (/view-profile, then'
        + ' /view-profile?selectedTab=candidate-details), so the first Back press stays on the'
        + ' profile and appears to do nothing. Worth raising as a UX finding in its own right.'
      : ''),
    'text/plain'
  );
  if (!/\/candidates\/active/.test(this.page.url())) {
    throw new Error(
      `Browser back never reached the Active listing after ${hops.length} press(es). It visited:\n`
      + hops.map((u, i) => `  #${i + 1} ${u}`).join('\n')
    );
  }
});

// NOTE: the live app does NOT restore filter/search after Back — it resets to
// activeFilter=all and clears the search. This assertion therefore reflects the
// feature's stated expectation and will FAIL against current behaviour, flagging
// the mismatch rather than masking it.
Then('the previous filter state should be preserved', async function () {
  const notedFilter = (this.noted.url.match(/accountVerification=[^&]+/) || [])[0];
  if (notedFilter) {
    expect(this.page.url(), 'filter query param should be preserved after Back').toContain(notedFilter);
  } else {
    expect(this.page.url()).toBe(this.noted.url);
  }
});

Then('the {string} tab should still be active', { timeout: 30000 }, async function (label) {
  await expect
    .poll(() => this.pages.activeCandidate.isQuickFilterActive(label), {
      timeout: 15000,
      message: `the "${label}" tab should still be active (url: ${this.page.url()})`,
    })
    .toBe(true);
});

// The search box is re-hydrated from the URL after Back, a beat after the route commits.
Then('the search term should still be present in the search bar', { timeout: 30000 }, async function () {
  expect(this.noted.search, 'no search term was noted before leaving the listing').toBeTruthy();
  await expect
    .poll(() => this.pages.activeCandidate.getSearchValue(), {
      timeout: 15000,
      message: `the search bar should still hold "${this.noted.search}"`,
    })
    .toBe(this.noted.search);
});

// ====================  Send Reminder modal ====================

When('I click the bell icon on the first candidate row', async function () {
  await this.pages.activeCandidate.openFirstCandidateReminder();
});

Then('the Send Reminder modal should be visible', async function () {
  await expect(this.pages.activeCandidate.reminderModal).toBeVisible({ timeout: 10000 });
});

Then('the Send Reminder modal should not be visible', async function () {
  await expect(this.pages.activeCandidate.reminderModal).toBeHidden({ timeout: 10000 });
});

Then('the Send Reminder modal should auto-close', async function () {
  await expect(this.pages.activeCandidate.reminderModal).toBeHidden({ timeout: 10000 });
});

// Used as an "And" precondition in P12.
Given('the Send Reminder modal is visible', async function () {
  await expect(this.pages.activeCandidate.reminderModal).toBeVisible({ timeout: 10000 });
});

Then('the modal should contain radio buttons for:', async function (dataTable) {
  const modal = this.pages.activeCandidate.reminderModal;
  for (const [option] of dataTable.raw()) {
    await expect(
      modal.getByRole('radio', { name: new RegExp(escapeRegExp(option), 'i') }).first(),
      `radio "${option}" should be present`
    ).toBeVisible({ timeout: 10000 });
  }
});

Then('the first radio option should be selected by default', async function () {
  const firstRadio = this.pages.activeCandidate.reminderModal.getByRole('radio').first();
  const checked = await firstRadio.getAttribute('aria-checked');
  const isChecked = checked === 'true' || (await firstRadio.isChecked().catch(() => false));
  expect(isChecked, 'first reminder radio should be selected by default').toBeTruthy();
});

Then('the message preview text area should be visible', async function () {
  const modal = this.pages.activeCandidate.reminderModal;
  const area = modal.locator('textarea, [role="textbox"]').first();
  await expect(area).toBeVisible({ timeout: 10000 });
});

// NOTE: "the {string} button should be enabled" is intentionally NOT defined
// here — signup.steps.js already provides a page-level implementation, and a
// second definition would make the step ambiguous. The page-level match
// resolves to the modal's "Send Reminder" button in P11.

Then('the {string} button should be enabled without selecting any additional options', async function (label) {
  const modal = this.pages.activeCandidate.reminderModal;
  await expect(modal.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()).toBeEnabled();
});

When('I select the {string} radio option', async function (option) {
  await this.pages.activeCandidate.reminderModal
    .getByText(new RegExp(escapeRegExp(option), 'i'))
    .first()
    .click();
  await this.page.waitForTimeout(300);
});

Then('the message preview text area should update with the payment reminder template', async function () {
  const modal = this.pages.activeCandidate.reminderModal;
  const text = await modal.innerText();
  expect(text, 'preview should reflect the payment reminder template').toMatch(/payment/i);
});

Then('a success toast with text {string} should appear', async function (text) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(text), 'i')).first()).toBeVisible({ timeout: 15000 });
});

// Drive the full send flow once per reminder type: open a fresh candidate's
// modal (a bell disables after its reminder is sent, so each type uses a
// different enabled row), pick the type, confirm its preview reflects a
// template, send, and confirm success. The modal auto-closing is the reliable
// success signal — the toast is brief, so it is only a best-effort check. The
// send click occasionally doesn't register, so retry it once if still open.
Then('sending a reminder succeeds for each reminder type:', async function (dataTable) {
  const ac = this.pages.activeCandidate;
  const types = dataTable.raw().map((row) => row[0]);
  for (const type of types) {
    await ac.openFirstEnabledReminder();
    await ac.reminderModal.getByText(new RegExp(escapeRegExp(type), 'i')).first().click();
    await this.page.waitForTimeout(300);

    const preview = ac.reminderModal.locator('textarea, [role="textbox"]').first();
    await expect(preview, `preview for "${type}"`).toBeVisible({ timeout: 10000 });
    const value = await preview.inputValue().catch(() => '');
    expect(value.trim().length, `preview for "${type}" should not be empty`).toBeGreaterThan(0);

    const sendBtn = ac.reminderModal.getByRole('button', { name: /^Send Reminder$/i });
    await expect(sendBtn, `Send Reminder should be enabled for "${type}"`).toBeEnabled();
    await sendBtn.click();
    // best-effort toast (auto-dismisses quickly), then the definitive signal.
    await this.page
      .getByText(/Reminder sent successfully/i)
      .first()
      .waitFor({ state: 'visible', timeout: 3000 })
      .catch(() => {});
    if (await ac.reminderModal.isVisible().catch(() => false)) {
      await sendBtn.click().catch(() => {}); // one retry — click sometimes doesn't register
    }
    await expect(ac.reminderModal, `modal should auto-close after sending "${type}"`).toBeHidden({
      timeout: 15000,
    });
  }
});

// ==================== row actions (View + Reminder History) ====================

// Both controls, on every tab, in ONE scenario driving a table rather than a
// Scenario Outline: an outline pays for a fresh browser context and a login per
// tab to assert the same rule four times.
//
// >>> IT REFUSES TO PASS HAVING INSPECTED NOTHING. <<< "Payment Due" is
// frequently empty in this environment, and a per-tab outline would report a
// green row for a tab holding no candidates at all. So an empty tab is recorded
// and tolerated, but the scenario fails outright if NO tab produced a single
// row — otherwise the whole thing is a vacuous pass.
Then('each quick filter tab should offer both row actions on every candidate row:', async function (dataTable) {
  const ac = this.pages.activeCandidate;
  const problems = [];
  const perTab = {};
  let inspected = 0;

  for (const [tab] of dataTable.raw()) {
    await ac.clickQuickFilter(tab);
    await this.page.waitForTimeout(1200);
    const rows = await ac.readRowActions();
    perTab[tab] = { rows: rows.length, missingView: 0, missingHistory: 0 };

    if (rows.length === 0) {
      // No candidates in this state — legitimate. Require the empty state so an
      // outright broken tab is still caught.
      await expect(ac.emptyState, `"${tab}" listed no rows, so it should show an empty state`).toBeVisible({
        timeout: 10000,
      });
      continue;
    }

    inspected += rows.length;
    for (const row of rows) {
      const who = row.email || row.name || '(unnamed row)';
      if (!row.view.present) {
        perTab[tab].missingView += 1;
        problems.push(`"${tab}": ${who} offers no View action`);
      }
      if (!row.reminderHistory.present) {
        perTab[tab].missingHistory += 1;
        problems.push(`"${tab}": ${who} offers no Reminder History action`);
      }
    }
  }

  await record(this, 'Row actions per quick filter tab', { perTab, rowsInspected: inspected, problems });

  expect(inspected, 'no tab listed a single candidate, so this scenario asserted nothing').toBeGreaterThan(0);
  if (problems.length) {
    throw new Error(
      `Every candidate row must offer both a View and a Reminder History action. ${problems.length} `
      + `problem(s) across ${inspected} row(s):\n  - ${problems.join('\n  - ')}`
    );
  }
});

// >>> THE DISABLED RULE IS ASSERTED AGAINST THE SERVER'S OWN FLAG, NOT GUESSED
// FROM THE DOM. <<<
//
// The Active tab renders no reminder column, so "this candidate has had no
// reminder" is invisible in the grid. `GET /candidate/active/` returns
// `has_reminders` per row (measured 2026-09-08), which lets this check assert the
// no-history case without imposing an enabled-state rule on every other row or tab.
//
// Rows are paired by EMAIL, never by position: the grid keeps the previous
// query's rows while the next is in flight, so index-pairing can compare one
// candidate's flag against another's button.
// Visit the tabs because a candidate without reminder history is not guaranteed
// to appear on the default page. Only that candidate's disabled state is required.
Then('the Reminder History action should be disabled for candidates with no reminder history', async function () {
  const ac = this.pages.activeCandidate;
  const problems = [];
  const compared = [];
  const perTab = {};
  let withReminders = 0;
  let withoutReminders = 0;

  for (const tab of ['All', 'Subscribed', 'Payment Due', 'Not Subscribed']) {
    let payload = [];
    try {
      payload = await ac.clickQuickFilterCapturingList(tab);
    } catch (err) {
      problems.push(`"${tab}": the candidate list request never resolved (${err.message})`);
      continue;
    }
    const rows = await ac.readRowActions();
    const byEmail = new Map(rows.filter((r) => r.email).map((r) => [r.email.toLowerCase(), r]));
    perTab[tab] = { payloadRows: payload.length, renderedRows: rows.length, paired: 0 };

    for (const row of payload) {
      const rendered = byEmail.get(String(row.email || '').toLowerCase());
      if (!rendered) continue; // payload row not painted — not this rule's concern
      if (!rendered.reminderHistory.present) {
        problems.push(`"${tab}": ${row.email} renders no Reminder History control at all`);
        continue;
      }

      if (typeof row.has_reminders !== 'boolean') {
        problems.push(`"${tab}": ${row.email} has no boolean has_reminders value in the list response`);
        continue;
      }

      perTab[tab].paired += 1;
      if (row.has_reminders) {
        withReminders += 1;
      } else {
        withoutReminders += 1;
      }
      compared.push({
        tab,
        email: row.email,
        has_reminders: row.has_reminders,
        disabled: rendered.reminderHistory.disabled,
      });

      if (!row.has_reminders && !rendered.reminderHistory.disabled) {
        problems.push(
          `"${tab}": ${row.email} has_reminders=false but the Reminder History control is ENABLED; `
          + 'it should be disabled when there is no reminder history'
        );
      }
    }
  }

  await record(this, 'Reminder History enabled-state vs has_reminders', {
    rule: 'disabled when has_reminders is false; enabled state for candidates with reminders is not constrained',
    perTab,
    rowsCompared: compared.length,
    withReminders,
    withoutReminders,
    noReminderCandidateObserved: withoutReminders > 0,
    compared,
    problems,
  });

  expect(compared.length, 'no payload row could be paired with a rendered row on any tab').toBeGreaterThan(0);

  if (problems.length) {
    throw new Error(
      `The Reminder History control must be disabled when a candidate has no reminder history. `
      + `${problems.length} issue(s) across ${compared.length} row(s):\n  - `
      + problems.join('\n  - ')
    );
  }

  expect(
    withoutReminders,
    `no candidate without reminder history was found among the ${compared.length} rows inspected `
    + 'across the four tabs, so this run did not exercise the disabled-state rule. Re-check the '
    + 'fixture data rather than reporting a vacuous pass.'
  ).toBeGreaterThan(0);
});

// ==================== pagination ====================

Then('the pagination section should be visible', async function () {
  await expect(this.pages.activeCandidate.pagination).toBeVisible({ timeout: 10000 });
});

Then('the pagination should contain a {string} control', async function (label) {
  const pag = this.pages.activeCandidate.pagination;
  const control = pag.getByRole('button', { name: new RegExp(label, 'i') });
  await expect(control.first(), `pagination "${label}" control`).toBeVisible();
});

// Tolerant: the Active tab renders "Page X of Y" rather than numbered buttons.
Then('the pagination should contain at least one page number', async function () {
  const text = await this.pages.activeCandidate.pagination.innerText();
  expect(text, 'pagination should include a page number').toMatch(/\d+/);
});

When('I clear the search bar', async function () {
  await this.pages.activeCandidate.clearSearch();
});

// Works for a name or an email term: polls an atomic rowheader snapshot
// (name + email — the two fields the app searches) and requires every visible
// row to contain the searched term.
Then('the table should only display candidates matching the search term', async function () {
  const re = new RegExp(escapeRegExp(this.searchTerm), 'i');
  await expect
    .poll(
      async () => {
        const texts = await this.pages.activeCandidate.visibleRowHeaders();
        return texts.length > 0 && texts.every((t) => re.test(t));
      },
      {
        timeout: 10000,
        message: `every visible row's name or email should contain "${this.searchTerm}"`,
      }
    )
    .toBe(true);
});

Then('the URL should contain the search term', async function () {
  await expect
    .poll(() => decodeURIComponent(this.page.url()), { timeout: 8000 })
    .toContain(`search=${this.searchTerm}`);
});

// Deterministic regardless of whether the app drops the empty ?search= param:
// assert the input itself is empty.
Then('the search bar should be empty', { timeout: 30000 }, async function () {
  await expect
    .poll(() => this.pages.activeCandidate.getSearchValue(), { timeout: 15000, message: 'the search bar should be empty' })
    .toBe('');
});

// ==================== Expanded FILTER coverage ====================

Then('the URL should contain the filter {string}', async function (fragment) {
  await expect
    .poll(() => decodeURIComponent(this.page.url()), { timeout: 8000 })
    .toContain(fragment);
});

Then('the URL should not contain any filter parameters', async function () {
  const url = this.page.url();
  for (const p of ['accountVerification=', 'pendingDocuments=', 'subscriptionStatus=', 'lastActivity=']) {
    expect(url, `URL should not carry ${p} after clearing`).not.toContain(p);
  }
});

// A filter view legitimately shows either matching rows OR the empty-results
// panel (many filter combinations have no data in this environment).
Then('the table should show matching results or an empty state', async function () {
  const count = await this.pages.activeCandidate.rowCount();
  if (count > 0) {
    await expect(this.pages.activeCandidate.table).toBeVisible();
    return;
  }
  await expect(this.pages.activeCandidate.emptyState).toBeVisible({ timeout: 10000 });
});

Then('an empty results state should be visible', async function () {
  await expect(this.pages.activeCandidate.emptyState).toBeVisible({ timeout: 10000 });
});

// Data-column labels -> their gridcell index (Candidate is the rowheader, so
// the data cells start at 0 = Account Verification).
const COLUMN_INDEX = {
  'account verification': 0,
  'pending documents': 1,
  'subscription status': 2,
  'last activity': 3,
};

// The search+filter pairing, asserted properly.
//
// Tolerant about EMPTINESS — a narrow combination legitimately matches nothing
// in this environment — but never about CORRECTNESS. The plain "matching
// results or an empty state" step this replaces could not tell a correctly
// narrowed table from one ignoring the filter entirely, so a filter written to
// the URL but never applied to the results would have passed it: the URL
// assertions are satisfied by the front end alone. That exact defect is on
// record for the SuperAdmin Candidates Status filter, where the URL and the
// applied-count badge both agreed while the param never reached the API.
//
// So: zero rows -> the empty state must be shown; any rows -> every one of them
// must satisfy BOTH the search term and the filtered column.
Then(
  'any results shown should match the search term and read {string} in the {string} column',
  async function (expected, column) {
    const ac = this.pages.activeCandidate;
    const idx = COLUMN_INDEX[column.trim().toLowerCase()];
    expect(idx, `unknown column "${column}"`).not.toBeUndefined();

    if ((await ac.rowCount()) === 0) {
      await expect(ac.emptyState, 'no rows matched, so the empty state should be shown').toBeVisible({
        timeout: 10000,
      });
      return;
    }

    const re = new RegExp(escapeRegExp(this.searchTerm), 'i');
    const want = expected.trim().toLowerCase();
    await expect
      .poll(
        async () => {
          const headers = await ac.visibleRowHeaders();
          const cells = await ac.columnValues(idx);
          if (headers.length === 0 || headers.length !== cells.length) return null;
          return {
            search: headers.every((t) => re.test(t)),
            column: cells.every((v) => v.trim().toLowerCase() === want),
          };
        },
        {
          timeout: 10000,
          message:
            `every listed candidate should match the search term "${this.searchTerm}" ` +
            `AND read "${expected}" in the "${column}" column`,
        }
      )
      .toEqual({ search: true, column: true });
  }
);

// Single data-driven check for the whole "applying a filter" behaviour. For every option in every
// group: open the modal, reset, select the option, apply, then assert
//   1. the URL carries the expected param,
//   2. the LIST REQUEST carries the expected API param - the two names differ for every option
//      (accountVerification -> verification_status, lastActivity=7days -> last_activity=7d), and a
//      URL-only check passes on a front end that rewrites the address bar while querying the
//      server for something else,
//   3. the grid has settled to THAT response (rendered rows === results.length) before any cell is
//      read. The grid keeps the previous query's rows while the next is in flight, so a read after
//      a fixed delay reports the old list as the new one,
//   4. where "column"/"expected" are given, every rendered cell reads that value.
// Every row is checked and every problem reported together, so one broken option cannot hide
// whether the others share its cause. Measured live 2026-10-06 (scripts/probe-active-filter-options.js).
Then('applying filters behaves correctly for each option:', { timeout: 300000 }, async function (dataTable) {
  const ac = this.pages.activeCandidate;
  const problems = [];
  const evidence = [];
  /* eslint-disable no-await-in-loop */
  for (const { option, param, api, column, expected } of dataTable.hashes()) {
    const tag = `["${option}"]`;
    try {
      await ac.openFilters();
      await ac.clearAllFilters(); // reset any previously-applied filter
      const response = this.page.waitForResponse(
        (r) =>
          /\/candidate\/active\//.test(r.url())
          && r.request().method() === 'GET'
          && (!api || decodeURIComponent(r.url()).includes(api)),
        { timeout: 20000 }
      ).catch(() => null);
      await ac.selectFilterOption(option);
      await ac.applyFilters();

      const url = await expect
        .poll(() => decodeURIComponent(this.page.url()), { timeout: 8000 })
        .toContain(param)
        .then(() => null, () => decodeURIComponent(this.page.url()));
      if (url !== null) problems.push(`${tag} URL should carry "${param}", got ${url}`);

      const res = await response;
      if (!res) {
        problems.push(`${tag} no list request carrying "${api}" was sent after Apply`);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      const results = body.results || body.data || [];
      evidence.push({ option, api: decodeURIComponent(res.url().split('?')[1] || ''), count: body.count, page: results.length });

      const settled = await expect
        .poll(() => ac.rowCount(), { timeout: 15000 })
        .toBe(results.length)
        .then(() => true, () => false);
      if (!settled) {
        problems.push(`${tag} the grid did not settle to the ${results.length} row(s) the server returned (shows ${await ac.rowCount()})`);
        continue;
      }
      if (results.length === 0) {
        if (!(await ac.emptyState.isVisible({ timeout: 10000 }).catch(() => false))) {
          problems.push(`${tag} the server returned no rows but no empty state was shown`);
        }
        continue;
      }
      if (column && expected) {
        const idx = COLUMN_INDEX[column.trim().toLowerCase()];
        const want = expected.trim().toLowerCase();
        const cells = await ac.columnValues(idx);
        const wrong = cells.filter((v) => v.trim().toLowerCase() !== want);
        if (wrong.length) problems.push(`${tag} every "${column}" cell should read "${expected}", got ${JSON.stringify(cells)}`);
      }
    } catch (e) {
      problems.push(`${tag} ${e.message.split('\n')[0]}`);
      await this.page.keyboard.press('Escape').catch(() => {});
    }
  }
  /* eslint-enable no-await-in-loop */
  await this.attach(JSON.stringify(evidence, null, 2), 'application/json');
  expect(problems, problems.join('\n')).toEqual([]);
});

// ---- Clear All / Cancel ----

When('I clear all filters in the modal', async function () {
  await this.pages.activeCandidate.clearAllFilters();
});

When('I cancel the filters', async function () {
  await this.pages.activeCandidate.cancelFilters();
});

Then('no filter option should be selected in the modal', async function () {
  const n = await this.pages.activeCandidate.selectedFilterCount();
  expect(n, 'no filter option should be checked').toBe(0);
});

Then('the Filters button should show an applied-filter count of {string}', async function (expected) {
  const n = await this.pages.activeCandidate.appliedFilterCount();
  expect(n, 'applied-filter count badge').toBe(parseInt(expected, 10));
});
