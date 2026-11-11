const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const { resilientSignIn } = require('../utils/resilientSignIn');
const AgentsListingPage = require('../pages/AgentsListingPage');
const {
  freshAgentIdentity,
  baselineInviteMail,
  waitForInviteMail,
  signInAsAgent,
  setPasswordAndSignIn,
  deactivateProvisionedAgents,
} = require('../utils/agentInviteProvision');
require('dotenv').config();

// Steps for features/SuperAdmin_Portal/UserManagement/Invite-agent.feature.
//
// This feature runs entirely as the SUPERADMIN on the scenario's own page. The only step
// that needs a second session is the agent-acceptance leg of the lifecycle: the app keeps
// one session per browser context, so signing the invited agent in on this.page would log
// the superadmin out and every later listing assertion would bounce to /login. That leg
// therefore opens its own context, and the After hook at the bottom closes it.
//
// NOT redefined here, on purpose — both already exist and both do the right thing:
//   "I am logged in as an agent"  (active-candidate.steps.js) — the shared agent account
//   "I should be denied access"   (referral-codes.steps.js)  — generic RBAC assertion

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
// An email that definitely already has an agent, for the duplicate-rejection scenarios.
// The referral agent is seeded and Active, so it needs no provisioning of its own.
const EXISTING_AGENT_EMAIL = process.env.REFERRAL_AGENT_EMAIL || 'iqra.farooq+refagent@bytecorp.io';
const DEFAULT_UNIVERSITY = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';

// One source for the throwaway Basic Info used by every "fill the form validly" step. These
// were repeated as bare literals across four separate step definitions, so a change to the
// name filtering rules meant hunting all four. The values matter only in that they are valid:
// letters-only names (the form strips digits as they are typed) and an in-range target.
const VALID_DETAILS = {
  firstName: 'Aisha',
  lastName: 'AlFahad',
  target: '10',
};
// The duplicate-rejection scenarios reuse an email that already belongs to an agent, so their
// names are deliberately distinct from VALID_DETAILS — a row called "Dup Check" on DEV is
// self-documenting when one of them leaks past the rejection.
const DUPLICATE_DETAILS = {
  firstName: 'Dup',
  lastName: 'Check',
  target: '5',
};
// A university that cannot plausibly be added to Configuration, for the free-text case.
const UNKNOWN_UNIVERSITY = 'Zzz Nonexistent Institute Of Automation';

const invite = (world) => world.pages.inviteAgent;
const listing = (world) => world.pages.agentsListing;

// ==================== Step scoping ====================
//
// Several phrasings this feature needs are generic enough to belong to the whole suite:
// `I enter "<x>" into "<field>"`, `I should be on the "<name>" page`, and friends. Written
// with a bare {string} they match ANY quoted value, so they silently swallowed steps from
// other features — verified with `cucumber-js --dry-run`, which routed Community.feature's
//   Then I should be on the "Create Community" page
//   And I enter "..." into "About University"
// into this file. Cucumber reports that as a MATCH, not as ambiguous, so nothing warned:
// the step ran invite-form logic against the Community page and failed for the wrong reason.
//
// The fix is to pin the alternation to the names this feature actually owns. A step for a
// page or field that is not the invite form's now simply does not match here, which leaves
// it undefined (correct) and leaves the other feature free to define it without colliding.
const INVITE_PAGE = 'Invite New Agent';
// Every label in InviteAgentPage.field()'s registry, in one place so the two cannot drift.
const FIELD_NAMES = [
  'First Name',
  'Last Name',
  'Email Address',
  'University Affiliation',
  'Numeric Performance Target (Monthly)',
  'Performance Target',
  'Promo Code Name',
  'Incentive Type',
  'Value',
  'Expiry Date',
  'Usage Limit',
];
const FIELD = FIELD_NAMES.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// A step that documents state the suite cannot reach on DEV (needs DB access, cron, a
// clock change or a second superadmin). Reported as PENDING rather than failed, so the
// report distinguishes "not automatable here" from "broken".
const manual = () => 'pending';

// ==================== Request tracking ====================

// Watch the invite/resend endpoints for the whole scenario. Several assertions can only
// be made at the network level: the form silently swallows a rejected invite, so "no new
// agent was created" and "exactly one request was sent" are provable there and nowhere
// else in the UI.
function trackInvites(world) {
  if (world._inviteTracker) return world._inviteTracker;
  const requests = [];
  const responses = [];
  const onRequest = (req) => {
    if (req.method() !== 'POST') return;
    if (/\/admin\/invite\/agent\/?$/.test(req.url())) requests.push({ kind: 'invite', url: req.url() });
    if (/\/admin\/invite\/resend\/agent\/?$/.test(req.url())) requests.push({ kind: 'resend', url: req.url() });
  };
  const onResponse = async (res) => {
    const req = res.request();
    if (req.method() !== 'POST') return;
    if (!/\/admin\/invite\/(resend\/)?agent\/?$/.test(res.url())) return;
    const body = await res.text().catch(() => '');
    responses.push({
      kind: /resend/.test(res.url()) ? 'resend' : 'invite',
      status: res.status(),
      body: String(body).slice(0, 400),
    });
  };
  world.page.on('request', onRequest);
  world.page.on('response', onResponse);
  world._inviteTracker = {
    requests,
    responses,
    countRequests: (kind) => requests.filter((r) => !kind || r.kind === kind).length,
    ok: (kind = 'invite') => responses.filter((r) => r.kind === kind && r.status >= 200 && r.status < 300),
    rejected: (kind = 'invite') => responses.filter((r) => r.kind === kind && r.status >= 400),
    stop: () => {
      world.page.off('request', onRequest);
      world.page.off('response', onResponse);
    },
  };
  return world._inviteTracker;
}

// ==================== Background ====================

// Goes through utils/resilientSignIn.js: under parallel workers this login intermittently stalls
// (form never renders, or submit goes nowhere) and passes on retry - 3 of 31 Agents scenarios on
// 2026-10-07. A real rejection or lockout still fails immediately.
Given('I am logged in as the superadmin', { timeout: 300000 }, async function () {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  }
  await resilientSignIn(this, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, {
    landedOn: /\/agents-analytics|\/agents|\/candidate-analytics|\/user-management/,
    perAttempt: 45000,
  });
  await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  trackInvites(this);
});

Given('I am on the {string} tab of User Management', async function (tab) {
  expect(tab, 'this feature only drives the Agents sub-tab').toMatch(/agents/i);
  await listing(this).goto('Active');
});

// ==================== Listing, tabs and entry point ====================

Then('the User Management module should show the following sub-tabs:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r['sub-tab']);
  const missing = [];
  for (const name of wanted) {
    const link = this.page.getByRole('link', { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') }).first();
    if (!(await link.isVisible().catch(() => false))) missing.push(name);
  }
  expect(missing, `User Management sub-tabs missing from the left nav: ${missing.join(', ')}`).toEqual([]);
});

Then('the {string} sub-tab should be selected', async function (name) {
  expect(name, 'only the Agents sub-tab is asserted here').toMatch(/agents/i);
  expect(this.page.url(), 'the Agents sub-tab should be the active route').toMatch(/\/agents(\?|$)/);
  await expect(listing(this).pageHeading, 'the Agents page heading').toBeVisible();
});

Then('the Agents listing should show the following lifecycle tabs:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.tab);
  const actual = await listing(this).tabNames();
  const missing = wanted.filter((w) => !actual.some((a) => a.toLowerCase() === w.toLowerCase()));
  expect(
    missing,
    `lifecycle tabs missing from the Agents listing: ${missing.join(', ')}. Found: ${actual.join(', ')}`
  ).toEqual([]);
});

Then('the {string} tab should be selected', async function (tab) {
  expect(await listing(this).isTabSelected(tab), `the "${tab}" tab should be selected by default`).toBeTruthy();
});

When('I open the {string} tab', async function (tab) {
  await listing(this).openTab(tab);
});

// One run walks every tab. Each tab is evaluated before the step fails, so a single
// failure message names every tab whose columns drifted — which is what the per-tab
// Scenario Outline used to cost three browser runs to tell you.
// EXACT columns per tab, in order. "Missing only" was too weak to be worth much: the whole
// point of this step is that each tab renders a DIFFERENT set, so a tab quietly gaining a
// column — or rendering the right ones in the wrong order — is exactly the drift it should
// catch. Verified live 2026-07-30 that all listed tabs match their table row exactly.
Then('each lifecycle tab should render its own columns:', { timeout: 120000 }, async function (dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    await listing(this).openTab(row.tab);
    const wanted = row.columns.split(',').map((s) => s.trim()).filter(Boolean);
    const actual = (await listing(this).columnHeaders()).map((a) => a.replace(/\s+/g, ' ').trim());
    const same = wanted.length === actual.length
      && wanted.every((w, i) => w.toLowerCase() === (actual[i] || '').toLowerCase());
    if (!same) {
      problems.push(`"${row.tab}" should render [${wanted.join(' | ')}] but renders [${actual.join(' | ')}]`);
    }
  }
  expect(problems, `lifecycle tab columns: ${problems.join(' || ')}`).toEqual([]);
});

Then('the tab should either list pending invites or show the empty state {string}', async function (emptyHeading) {
  const rows = await listing(this).rowCount();
  if (rows > 0) {
    const read = await listing(this).readRows();
    const statuses = read.map((r) => r.status).filter(Boolean);
    expect(
      statuses.every((s) => /invite sent/i.test(s)),
      `every row on the Invite Sent tab should carry the "Invite Sent" status, saw: ${statuses.join(', ')}`
    ).toBeTruthy();
    return;
  }
  const text = await listing(this).emptyStateText();
  expect(text, `the Invite Sent empty state should read "${emptyHeading}"`).toContain(emptyHeading);
});

// `I click {string}` is NOT defined here: it is a suite-wide phrase used by a dozen
// features, so it has a single owner in common.steps.js. This feature's three targets
// (Invite Agent / Exit / Send Invite) are dispatched from there to the page objects below.

When('I double-click {string}', async function (label) {
  expect(label, 'only Send Invite is double-clicked in this feature').toMatch(/send invite/i);
  await invite(this).doubleClickSubmit();
  await this.page.waitForTimeout(4000);
});

// One definition for the three phrasings the feature uses ("should be" / "should still be" /
// "should remain"). They asserted exactly the same thing in three copies; the wording is kept
// in the failure message so the report still reads naturally.
Then(new RegExp(`^I should (be|still be|remain) on the "(${INVITE_PAGE})" page$`), async function (phrasing, name) {
  expect(
    await invite(this).isOnInvitePage(),
    `expected to ${phrasing} on the ${name} route, got ${this.page.url()}`
  ).toBeTruthy();
});

Then('the page heading should be {string}', async function (expected) {
  const actual = (await invite(this).heading.innerText()).trim();
  expect(actual, 'the Invite New Agent page heading').toBe(expected);
});

Then('I should be on the Agents listing page', async function () {
  expect(await listing(this).isOnListing(), `expected the Agents listing, got ${this.page.url()}`).toBeTruthy();
  // Record WHICH tab the listing opened on. The URL alone cannot tell the difference between
  // landing on the tab that holds the agent just invited and landing on one that does not, so
  // the tab is captured here for the step below to assert against.
  this._landedOnTab = await listing(this).selectedTab();
  this.attach(`The Agents listing opened on the "${this._landedOnTab}" tab.`, 'text/plain');
});

// Verified live 2026-07-30: the success modal's "Go to Agents" CTA lands on /agents with the
// ACTIVE tab selected, while a freshly invited agent sits on Invite Sent — so the superadmin
// is dropped on a tab that does not contain the agent they just created. This step is what
// makes that observable instead of passing silently on the URL alone.
Then('the Agents listing should open on the {string} tab', async function (expected) {
  const actual = this._landedOnTab || (await listing(this).selectedTab());
  expect(
    actual.toLowerCase(),
    `the listing should have opened on the "${expected}" tab, but opened on "${actual}"`
  ).toBe(expected.toLowerCase());
});

Given(new RegExp(`^I am on the "(?:${INVITE_PAGE})" page$`), { timeout: 90000 }, async function () {
  await invite(this).goto();
});

When('I refresh the page', async function () {
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await this.page.waitForTimeout(2000);
});

// ==================== Form structure ====================

Then('the form should contain the following sections in order:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.section);
  const actual = await invite(this).sectionTitles();
  expect(actual, `section titles on the invite form (wanted ${wanted.join(' -> ')})`).toEqual(wanted);
});

Then('the following fields should be visible and marked required:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.field);
  const notVisible = [];
  const notRequired = [];
  for (const field of wanted) {
    if (!(await invite(this).isFieldVisible(field))) notVisible.push(field);
    else if (!(await invite(this).isMarkedRequired(field))) notRequired.push(field);
  }
  expect(notVisible, `fields not visible on the form: ${notVisible.join(', ')}`).toEqual([]);
  expect(notRequired, `fields visible but NOT marked required with an asterisk: ${notRequired.join(', ')}`).toEqual([]);
});

Then('none of the following fields should be visible:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.field);
  const visible = [];
  for (const field of wanted) {
    if (await invite(this).isFieldVisible(field)) visible.push(field);
  }
  expect(visible, `these fields should be hidden while the promo section is collapsed: ${visible.join(', ')}`)
    .toEqual([]);
});

// ==================== University ====================

When('I open the {string} dropdown', async function (field) {
  expect(field).toMatch(/university/i);
  await invite(this).openUniversityDropdown();
});

// The universities come from the superadmin Configuration module, so this compares the
// dropdown against that list rather than against a hardcoded copy that would rot.
Then('the dropdown options should match the universities configured in Configuration', { timeout: 120000 }, async function () {
  const options = await invite(this).universityOptions();
  expect(options.length, 'the University Affiliation dropdown should not be empty').toBeGreaterThan(0);
  await invite(this).closeUniversityDropdown();

  const configured = await readConfiguredUniversities(this);
  if (!configured.length) {
    // Configuration could not be read (route moved, or the list is not rendered as rows).
    // Rather than silently passing, assert the weaker property that IS checkable and say
    // so in the report.
    this.attach(
      'Could not read the universities out of the Configuration module, so this step '
      + `only verified that the dropdown is populated (${options.length} options).`,
      'text/plain'
    );
    await invite(this).goto();
    return;
  }
  const missing = configured.filter((c) => !options.some((o) => o.toLowerCase() === c.toLowerCase()));
  expect(
    missing.slice(0, 10),
    `universities configured in Configuration but absent from the invite dropdown: ${missing.join(', ')}`
  ).toEqual([]);
  await invite(this).goto();
});

When('I select the university {string}', async function (name) {
  await invite(this).selectUniversity(name);
  this._selectedUniversity = name;
});

// University Affiliation is a react-aria COMBOBOX, not a select — verified live 2026-07-30:
// input[role=combobox] over 139 options, filtering correctly ("Baha" -> 1, "King" -> 10,
// "zzzzz" -> 0). That makes two states reachable that a plain select cannot reach, and both
// are what a superadmin actually does: pick a university and then change their mind, or type
// a name that is not on the list. Neither was covered.
When('I clear the selected university', async function () {
  await invite(this).clearUniversity();
  await this.page.waitForTimeout(400);
});

When('I type a university that is not on the list', async function () {
  this._unknownUniversityHeld = await invite(this).typeUnknownUniversity(UNKNOWN_UNIVERSITY);
});

// The combobox refuses a free-text value rather than reporting it, so what it DOES is the
// assertable behaviour: the entry disappears on blur.
Then('the university entry should be discarded', async function () {
  expect(
    this._unknownUniversityHeld,
    `"${UNKNOWN_UNIVERSITY}" should not have survived in the combobox`
  ).toBe('');
});

Then('exactly one university should be selected', async function () {
  const value = await invite(this).selectedUniversity();
  expect(value, 'the combobox should hold exactly one university').toBeTruthy();
  expect(value.split(',').length, `the combobox holds more than one selection: "${value}"`).toBe(1);
});

// ==================== Entering / reading fields ====================

When(new RegExp(`^I (?:enter|have entered) "([^"]*)" into "(${FIELD})"$`), async function (value, field) {
  await invite(this).enter(field, value);
  await this.page.waitForTimeout(350);
});

// Character-by-character, because these scenarios assert the form's input FILTERING.
When(new RegExp(`^I type "([^"]*)" into "(${FIELD})"$`), async function (text, field) {
  await invite(this).typeInto(field, text);
  await this.page.waitForTimeout(350);
});

When(new RegExp(`^I type (\\d+) letters into "(${FIELD})"$`), async function (count, field) {
  await invite(this).typeInto(field, 'a'.repeat(Number(count)));
  await this.page.waitForTimeout(350);
});

When(new RegExp(`^I clear "(${FIELD})"$`), async function (field) {
  await invite(this).clear(field);
  await this.page.waitForTimeout(350);
});

When(new RegExp(`^I move focus out of "(${FIELD})"$`), async function (field) {
  await invite(this).blur(field);
});

// ==================== Table-driven field checks ====================
//
// The four steps below each replace a Scenario Outline that re-opened the form for every
// row. They all follow the same contract, which is what makes the merge safe:
//   * every row is exercised against the SAME page state the outline used to set up
//   * no row can mask another — each one is evaluated and its result collected
//   * the step fails ONCE, listing every row that did not behave, so a single run still
//     produces the full picture the per-row outline did

// Required-field errors. Deliberately clears WITHOUT blurring first: verified live, the
// error renders the moment the field empties. If a field turns out to need a blur after
// all, it is still asserted, and the run reports which fields those were.
Then('clearing each of the following fields should show its inline required error:', { timeout: 120000 }, async function (dataTable) {
  const problems = [];
  const neededBlur = [];
  for (const row of dataTable.hashes()) {
    await invite(this).enter(row.field, row.value);
    await this.page.waitForTimeout(400);

    await invite(this).field(row.field).fill('');
    await this.page.waitForTimeout(600);
    let actual = await invite(this).errorFor(row.field);
    if (!actual) {
      await invite(this).blur(row.field);
      actual = await invite(this).errorFor(row.field);
      if (actual) neededBlur.push(row.field);
    }
    if (actual !== row.error) {
      problems.push(`"${row.field}" emptied -> expected "${row.error}", got "${actual || 'no error'}"`);
    }
    if (await invite(this).isSubmitEnabled()) {
      problems.push(`"${row.field}" empty -> Send Invite is still enabled`);
    }
    // Restore, so each row is judged on its own and not on the leftovers of the last.
    await invite(this).enter(row.field, row.value);
    await this.page.waitForTimeout(300);
  }
  if (neededBlur.length) {
    this.attach(
      'These fields did NOT render their required error until focus moved away, so the '
      + `"renders immediately" behaviour no longer holds for them: ${neededBlur.join(', ')}`,
      'text/plain'
    );
  }
  expect(problems, `required-field errors: ${problems.join(' || ')}`).toEqual([]);
});

// Input FILTERING, so every row types character by character — the form strips disallowed
// characters in an onChange handler that a single fill() would never exercise.
Then('typing the following should be filtered as shown:', { timeout: 120000 }, async function (dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    const expected = row.retained || '';
    await invite(this).typeInto(row.field, row.input);
    await this.page.waitForTimeout(350);
    const actual = await invite(this).valueOf(row.field);
    if (actual !== expected) {
      problems.push(`"${row.field}": typed "${row.input}" -> held "${actual}", expected "${expected}"`);
    }
  }
  expect(problems, `input filtering: ${problems.join(' || ')}`).toEqual([]);
});

// Email formats. The verdict is read the same way the single-address step reads it: an
// inline message means rejected, its absence means accepted.
Then('the following email addresses should be treated as shown:', { timeout: 120000 }, async function (dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    await invite(this).enter('Email Address', row.email);
    await invite(this).blur('Email Address');
    const error = await invite(this).errorFor('Email Address');
    const shouldBeInvalid = /invalid/i.test(row.verdict);
    if (shouldBeInvalid && !error) {
      problems.push(`"${row.email}" should have been rejected, but no inline error was shown`);
    }
    if (!shouldBeInvalid && error) {
      problems.push(`"${row.email}" should have been accepted, but the form showed "${error}"`);
    }
  }
  expect(problems, `email validation: ${problems.join(' || ')}`).toEqual([]);
});

// Value bounds for one field. An empty `error` cell means "this value must be accepted".
Then('entering the following into {string} should be validated as shown:', { timeout: 120000 }, async function (field, dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    const expected = row.error || '';
    await invite(this).enter(field, row.value);
    await invite(this).blur(field);
    const actual = await invite(this).errorFor(field);
    if (actual !== expected) {
      problems.push(
        `"${row.value}" -> expected ${expected ? `"${expected}"` : 'no error'}, `
        + `got ${actual ? `"${actual}"` : 'no error'}`
      );
    }
  }
  expect(problems, `validation on "${field}": ${problems.join(' || ')}`).toEqual([]);
});

Then('{string} should hold {string}', async function (field, expected) {
  const actual = await invite(this).valueOf(field);
  expect(actual, `"${field}" after the input above`).toBe(expected);
});

Then('{string} should hold exactly {int} characters', async function (field, count) {
  const actual = await invite(this).valueOf(field);
  expect(actual.length, `"${field}" length (held "${actual.slice(0, 20)}...")`).toBe(count);
});

Then('{string} should be empty', async function (field) {
  if (/expiry date/i.test(field)) {
    expect(await invite(this).isExpiryEmpty(), 'the Expiry Date field should be empty').toBeTruthy();
    return;
  }
  const actual = await invite(this).valueOf(field);
  expect(actual, `"${field}" should be empty`).toBe('');
});

Then('every form field should be empty', async function () {
  const result = await invite(this).isFormEmpty();
  expect(
    result.empty,
    `the form should be blank, but these fields still hold values: ${JSON.stringify(result.filled)}`
  ).toBeTruthy();
});

// ==================== Validation assertions ====================

// Covers both phrasings the feature uses ("the inline error ..." / "the error ...").
Then(/^the (?:inline )?error "([^"]*)" should be displayed for "([^"]*)"$/, async function (expected, field) {
  const actual = await invite(this).errorFor(field);
  expect(
    actual,
    `inline error for "${field}" (all errors on the form right now: ${JSON.stringify(await invite(this).allErrors())})`
  ).toBe(expected);
});

Then('a validation error should be displayed for {string}', async function (field) {
  const actual = await invite(this).errorFor(field);
  expect(
    actual,
    `expected SOME validation error on "${field}", found none. Errors on the form: `
    + `${JSON.stringify(await invite(this).allErrors())}`
  ).toBeTruthy();
});

Then('no validation error should be displayed for {string}', async function (field) {
  const actual = await invite(this).errorFor(field);
  expect(actual, `unexpected validation error on "${field}"`).toBe('');
});

// The stronger form of the step above: not merely "no message", but "the field is not
// PAINTED as rejected either". Both halves are asserted because they are independent
// failures — a red outline with no message is as much a defect as a message with no
// outline — and both are reported together rather than the first one winning, so a red row
// says which of the two moved. See InviteAgentPage.fieldErrorState() for why the ring is
// compared against a control field instead of a hardcoded colour.
Then(new RegExp(`^the "(${FIELD})" field should not be marked as invalid$`), async function (field) {
  const state = await invite(this).fieldErrorState(field);
  const problems = [];
  if (state.inlineError) problems.push(`an inline error is shown: "${state.inlineError}"`);
  if (state.ariaInvalid) problems.push('aria-invalid/data-invalid is set to "true"');
  if (state.ringDiffersFromControl) {
    problems.push(
      `it is outlined differently from the "${state.control}" field on the same form `
      + `(this: ${state.ring} | control: ${state.controlRing})`
    );
  }
  expect(problems, `"${field}" is being presented as invalid — ${problems.join('; ')}`).toEqual([]);
});

// The form gives two kinds of feedback for a bad address, and either is acceptable
// evidence that it was rejected: an inline message, or a gated CTA. A "valid" verdict
// must show neither.
Then('the email address should be treated as {string}', async function (verdict) {
  const error = await invite(this).errorFor('Email Address');
  if (/invalid/i.test(verdict)) {
    expect(
      error,
      `"${await invite(this).valueOf('Email Address')}" should have been rejected, but no inline error was shown`
    ).toBeTruthy();
    return;
  }
  expect(
    error,
    `"${await invite(this).valueOf('Email Address')}" should have been accepted, but the form showed "${error}"`
  ).toBe('');
});

// NOT redefined here, on purpose: `the {string} button should be enabled|disabled` already
// exists in signup.steps.js as the suite-wide owner, and its role-based lookup resolves to
// the same submit button this feature cares about. A second definition would make every
// "Send Invite" gating step AMBIGUOUS and skip it.

Then('the submit CTA text should be exactly {string}', async function (expected) {
  expect(await invite(this).submitLabel(), 'the submit CTA label').toBe(expected);
});

// CTA gating, one field at a time, on a form that is otherwise complete: empty the field,
// the CTA must gate; put it back, the CTA must recover. Restoring after every row is what
// lets a single run cover what used to be one full form-fill per field.
Then('clearing each of the following fields should disable {string} until it is restored:', { timeout: 180000 }, async function (label, dataTable) {
  expect(label, 'only the Send Invite CTA is gated in this feature').toMatch(/send invite/i);
  const problems = [];
  for (const row of dataTable.hashes()) {
    await invite(this).clear(row.field);
    if (!(await waitForSubmitState(this, false))) {
      problems.push(`"${row.field}" empty -> Send Invite is still ENABLED`);
    }
    await invite(this).enter(row.field, row.value);
    if (!(await waitForSubmitState(this, true))) {
      problems.push(`"${row.field}" restored to "${row.value}" -> Send Invite is still DISABLED`);
    }
  }
  expect(problems, `Send Invite gating: ${problems.join(' || ')}`).toEqual([]);
});

// The CTA is disabled while the form is invalid, so "attempt to submit" means: click if
// possible, otherwise force the click so any submit-time validation still fires. Either
// way the assertions that follow read the resulting state.
When('I attempt to submit the form', async function () {
  const enabled = await invite(this).isSubmitEnabled();
  if (enabled) await invite(this).clickSubmit();
  else await invite(this).submitButton.click({ force: true }).catch(() => {});
  await this.page.waitForTimeout(2500);
});

// ==================== Promo section ====================

Then('the checkbox {string} should be unchecked', async function (label) {
  expect(label).toMatch(/add promo code/i);
  expect(await invite(this).isPromoChecked(), 'the promo checkbox should start unchecked').toBeFalsy();
});

Then('the checkbox {string} should be checked', async function (label) {
  expect(label).toMatch(/add promo code/i);
  expect(await invite(this).isPromoChecked(), 'the promo checkbox should be checked').toBeTruthy();
});

When(/^I (?:check|have checked) "([^"]*)"$/, async function (label) {
  expect(label).toMatch(/add promo code/i);
  await invite(this).setPromo(true);
});

When('I uncheck {string}', async function (label) {
  expect(label).toMatch(/add promo code/i);
  await invite(this).setPromo(false);
});

Then('{string} should hold a non-empty auto-generated code', async function (field) {
  expect(field).toMatch(/promo code name/i);
  const code = await invite(this).promoCodeName();
  expect(code, 'the app-generated promo code').toBeTruthy();
  expect(code, `"${code}" does not look like a generated promo code`).toMatch(/^[A-Z0-9]{4,}$/);
});

Then('{string} should be read-only', async function (field) {
  expect(await invite(this).isReadOnly(field), `"${field}" should be read-only`).toBeTruthy();
});

Then('{string} should offer the following radio options:', async function (field, dataTable) {
  expect(field).toMatch(/incentive type/i);
  const wanted = dataTable.hashes().map((r) => r.option);
  const actual = await invite(this).incentiveOptions();
  const missing = wanted.filter((w) => !actual.some((a) => a.toLowerCase().includes(w.toLowerCase())));
  expect(missing, `incentive type options missing: ${missing.join(', ')}. Found: ${actual.join(' | ')}`).toEqual([]);
});

When(/^I (?:select|have selected) the incentive type "([^"]*)"$/, async function (type) {
  await invite(this).selectIncentive(type);
});

Then('the incentive type {string} should be selected', async function (expected) {
  const selected = await invite(this).selectedIncentive();
  expect(selected, 'the selected incentive type').toMatch(new RegExp(escapeRegExp(expected), 'i'));
});

Then('the {string} field should show the suffix {string}', async function (field, suffix) {
  expect(field).toMatch(/value/i);
  const actual = await invite(this).valueSuffix();
  expect(actual, `the Value field's suffix for the selected incentive type`).toBe(suffix);
});

Given('I have filled the promo details with a {string} of {string}', { timeout: 90000 }, async function (type, value) {
  await invite(this).setPromo(true);
  await invite(this).selectIncentive(type);
  await invite(this).enter('Value', value);
  this._chosenExpiry = await invite(this).setExpiryFromToday(30);
  await invite(this).enter('Usage Limit', '100');
  await this.page.waitForTimeout(400);
});

When('I complete the promo section as {string}', { timeout: 120000 }, async function (state) {
  const result = await invite(this).completePromoSection(state);
  if (result) this._chosenExpiry = result.expiry;
  this._promoState = state;
  // Capture what was configured, INCLUDING the app-generated code, so a later step can prove
  // the promo was actually stored rather than merely accepted by the form. The code is
  // read-only and generated client-side, so this is the only moment it is knowable.
  this._configuredPromo = result
    ? { ...result, code: await invite(this).promoCodeName() }
    : null;
});

// ==================== Expiry date ====================

When('I open the {string} calendar', async function (field) {
  expect(field).toMatch(/expiry date/i);
  await invite(this).openExpiryCalendar();
});

When('I select an expiry date {int} days from today', { timeout: 90000 }, async function (days) {
  this._chosenExpiry = await invite(this).setExpiryFromToday(days);
  this._chosenExpiryOffset = days;
});

Then('every date before today should be disabled', async function () {
  const days = await invite(this).calendarDays();
  const today = new Date();
  const enabledPast = days.filter((d) => {
    if (d.disabled || !d.label) return false;
    const parsed = parseCalendarLabel(d.label);
    return parsed && parsed < startOfDay(today);
  });
  expect(
    enabledPast.map((d) => d.label),
    `these past dates are still selectable: ${enabledPast.map((d) => d.label).join(', ')}`
  ).toEqual([]);
});

Then("today's date should be disabled", async function () {
  const days = await invite(this).calendarDays();
  const todayCell = days.find((d) => d.today);
  expect(todayCell, "the calendar should render a cell for today").toBeTruthy();
  expect(
    todayCell.disabled,
    `today (${todayCell.label}) is selectable as a promo expiry, but the AC allows only the next day onward`
  ).toBeTruthy();
});

Then('the first selectable date should be tomorrow', async function () {
  const first = await invite(this).firstAvailableDay();
  expect(first, 'the calendar should expose a first selectable date').toBeTruthy();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const parsed = parseCalendarLabel(first.label);
  expect(
    parsed && sameDay(parsed, tomorrow),
    `the first selectable expiry should be tomorrow (${formatDdMmYyyy(tomorrow)}), but the calendar offers `
    + `"${first.label}"`
  ).toBeTruthy();
});

// The calendar popover offers Today / Cancel / Apply — verified live 2026-07-30. "Today" is a
// second route to the same date the day grid offers, so whatever the AC decides about today
// being a legal expiry, this shortcut has to agree with the grid or the two contradict.
Then('the calendar {string} shortcut should agree with the day grid', async function (label) {
  expect(label).toMatch(/today/i);
  const days = await invite(this).calendarDays();
  const todayCell = days.find((d) => d.today);
  expect(todayCell, 'the calendar should render a cell for today').toBeTruthy();
  const shortcutEnabled = await invite(this).isCalendarTodayShortcutEnabled();
  expect(
    shortcutEnabled,
    `the "Today" shortcut is ${shortcutEnabled ? 'enabled' : 'disabled'} while today's cell in `
    + `the grid is ${todayCell.disabled ? 'disabled' : 'enabled'} — the two disagree, so one of `
    + 'them lets a superadmin set an expiry the other forbids'
  ).toBe(!todayCell.disabled);
});

Then('the previous-month navigation should be disabled at the current month', async function () {
  const month = await invite(this).calendarMonthLabel();
  expect(
    await invite(this).isPreviousMonthDisabled(),
    `the calendar opened on ${month} and should not allow navigating to an earlier month`
  ).toBeTruthy();
});

Then('{string} should hold the date {int} days from today', async function (field, days) {
  expect(field).toMatch(/expiry date/i);
  const expected = new Date();
  expected.setDate(expected.getDate() + days);
  const iso = await invite(this).expiryIsoValue();
  const shown = await invite(this).expiryDisplayText();
  expect(iso, `the Expiry Date value (shown as "${shown}")`).toBe(toIso(expected));
});

Then('the {string} placeholder should read {string}', async function (field, expected) {
  expect(field).toMatch(/expiry date/i);
  const shown = await invite(this).expiryDisplayText();
  expect(shown, 'the empty Expiry Date placeholder').toBe(expected);
});

// The slashes are escaped: `/` is the alternation operator in a Cucumber Expression, so an
// unescaped `DD/MM/YYYY` would register as "DD or MM or YYYY" and never match the step.
Then('{string} should display the date as DD\\/MM\\/YYYY', async function (field) {
  expect(field).toMatch(/expiry date/i);
  const shown = await invite(this).expiryDisplayText();
  expect(shown, `"${shown}" is not in DD/MM/YYYY form`).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  // And it is the date actually chosen, not the same digits in US order.
  const iso = await invite(this).expiryIsoValue();
  if (iso) {
    const [y, m, d] = iso.split('-');
    expect(shown, `the field renders ${shown} for the ISO value ${iso} — day and month look swapped`)
      .toBe(`${d}/${m}/${y}`);
  }
});

Then('the {string} text colour should be {string}', async function (field, expectedHex) {
  expect(field).toMatch(/expiry date/i);
  const rgb = await invite(this).expiryTextColour();
  const hex = rgbToHex(rgb);
  expect(hex.toLowerCase(), `the selected expiry date renders in ${rgb} (${hex})`).toBe(expectedHex.toLowerCase());
});

When('I scroll within the calendar popover', async function () {
  await invite(this).scrollCalendar();
});

Then('the {string} button should remain visible and clickable', async function (label) {
  expect(label).toMatch(/apply/i);
  expect(
    await invite(this).isCalendarApplyUsable(),
    'the calendar Apply button scrolled out of reach inside the popover'
  ).toBeTruthy();
});

// ==================== Filling the whole form ====================

Given('I have filled every required field with valid details', { timeout: 90000 }, async function () {
  const identity = freshAgentIdentity();
  await invite(this).fillValidDetails({
    ...VALID_DETAILS,
    email: identity.email,
    university: DEFAULT_UNIVERSITY,
  });
  this._selectedUniversity = DEFAULT_UNIVERSITY;
});

Given('I have filled every required field except {string}', { timeout: 90000 }, async function (skip) {
  const identity = freshAgentIdentity();
  const key = String(skip).trim().toLowerCase();
  await invite(this).enter('First Name', VALID_DETAILS.firstName);
  await invite(this).enter('Last Name', VALID_DETAILS.lastName);
  if (key !== 'email address') await invite(this).enter('Email Address', identity.email);
  if (key !== 'university affiliation') {
    await invite(this).selectUniversity(DEFAULT_UNIVERSITY);
    this._selectedUniversity = DEFAULT_UNIVERSITY;
  }
  if (!/performance target/.test(key)) {
    await invite(this).enter('Numeric Performance Target (Monthly)', VALID_DETAILS.target);
  }
  await this.page.waitForTimeout(400);
});

When('I fill the form with valid details', { timeout: 90000 }, async function () {
  const identity = freshAgentIdentity();
  await invite(this).fillValidDetails({
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    university: DEFAULT_UNIVERSITY,
    target: VALID_DETAILS.target,
  });
  this._selectedUniversity = DEFAULT_UNIVERSITY;
});

// Provisioning: a brand-new address, plus an inbox UID baseline so a later mail read can
// only pick up THIS invite's message.
When('I fill the form with valid details and a unique agent email', { timeout: 150000 }, async function () {
  const identity = freshAgentIdentity();
  this._invited = identity;
  this._inviteMailBaseline = await baselineInviteMail(identity.email);
  await invite(this).fillValidDetails({
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    university: DEFAULT_UNIVERSITY,
    target: VALID_DETAILS.target,
  });
  this._selectedUniversity = DEFAULT_UNIVERSITY;
  registerForCleanup(this, identity);
});

// Same as above, but every text field is submitted with leading AND trailing spaces, so
// the lifecycle scenario can prove trimming without provisioning a second agent for it.
// Whether the padding survives in the input is recorded: if the client strips it, the
// listing assertion no longer proves the BACKEND trims, and the run says so.
When('I fill the form with valid details and a unique agent email padded with spaces', { timeout: 150000 }, async function () {
  const identity = freshAgentIdentity();
  this._invited = identity;
  this._inviteMailBaseline = await baselineInviteMail(identity.email);

  await invite(this).field('First Name').fill(`  ${identity.firstName}  `);
  await invite(this).field('Last Name').fill(`  ${identity.lastName}  `);
  await invite(this).field('Email Address').fill(`  ${identity.email}  `);
  await invite(this).selectUniversity(DEFAULT_UNIVERSITY);
  await invite(this).enter('Numeric Performance Target (Monthly)', '10');
  this._selectedUniversity = DEFAULT_UNIVERSITY;
  await this.page.waitForTimeout(400);

  const held = await invite(this).valueOf('Email Address');
  this._paddingHeldInInput = /^\s|\s$/.test(held);
  registerForCleanup(this, identity);
});

When('I fill the form with valid details using the {string}', { timeout: 90000 }, async function (source) {
  const key = String(source).trim().toLowerCase();
  let email;
  if (key === 'existing agent email') email = EXISTING_AGENT_EMAIL;
  else if (key === 'existing agent email in upper case') email = EXISTING_AGENT_EMAIL.toUpperCase();
  else if (key === "superadmin's own email") email = SUPERADMIN_EMAIL;
  else throw new Error(`Unknown email source "${source}".`);

  this._duplicateEmail = email;
  // The upper-case variant is the one duplicate the backend ACCEPTS (the @known-issue),
  // so it really does create an agent every run — register it for cleanup like any other
  // provisioned account. The other two sources are rejected and create nothing.
  if (key === 'existing agent email in upper case') {
    registerForCleanup(this, { ...DUPLICATE_DETAILS, email });
  }
  await invite(this).fillValidDetails({
    ...DUPLICATE_DETAILS,
    email,
    university: DEFAULT_UNIVERSITY,
  });
  this._selectedUniversity = DEFAULT_UNIVERSITY;
});

// ==================== Submit outcomes ====================

Then('the success modal {string} should be displayed', { timeout: 90000 }, async function (title) {
  await invite(this).waitForSuccessModal();
  const actual = await invite(this).successModalHeadingText();
  expect(actual, 'the success modal heading').toBe(title);
});

Then('the success modal should not be displayed', async function () {
  expect(
    await invite(this).isSuccessModalVisible(),
    'the success modal appeared even though the invite should not have succeeded'
  ).toBeFalsy();
});

Then('the success modal should offer the following CTAs:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.cta);
  const actual = await invite(this).successModalCtas();
  const missing = wanted.filter((w) => !actual.some((a) => a.toLowerCase() === w.toLowerCase()));
  expect(missing, `success modal CTAs missing: ${missing.join(', ')}. Found: ${actual.join(' | ')}`).toEqual([]);
});

When('I click {string} in the success modal', { timeout: 60000 }, async function (cta) {
  await invite(this).clickSuccessModalCta(cta);
  if (/go to agents/i.test(cta)) {
    await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 }).catch(() => {});
    await listing(this).settle();
  }
});

Given('I have just invited an agent successfully', { timeout: 240000 }, async function () {
  const identity = freshAgentIdentity();
  this._invited = identity;
  this._inviteMailBaseline = await baselineInviteMail(identity.email);
  await invite(this).goto();
  await invite(this).fillValidDetails({
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    university: DEFAULT_UNIVERSITY,
    target: VALID_DETAILS.target,
  });
  this._selectedUniversity = DEFAULT_UNIVERSITY;
  registerForCleanup(this, identity);
  await invite(this).clickSubmit();
  await invite(this).waitForSuccessModal();
});

// The form gives no UI signal when the backend rejects a duplicate (see the @known-issue),
// so the rejection is asserted where it is actually observable: the response.
Then('the invite request should be rejected as an already-existing email', async function () {
  const tracker = trackInvites(this);
  const rejected = tracker.rejected('invite');
  const ok = tracker.ok('invite');
  expect(
    rejected.length,
    `expected the invite to be rejected for "${this._duplicateEmail}", but the responses were `
    + `${JSON.stringify(tracker.responses)}`
  ).toBeGreaterThan(0);
  expect(
    ok.length,
    `the invite was ALSO accepted for "${this._duplicateEmail}" — a duplicate agent was created: `
    + `${JSON.stringify(ok)}`
  ).toBe(0);
  expect(
    rejected.map((r) => r.body).join(' '),
    'the rejection should name the duplicate email as the reason'
  ).toMatch(/already exists/i);
});

Then('no invite request should be sent', async function () {
  const tracker = trackInvites(this);
  expect(
    tracker.countRequests('invite'),
    `the form sent ${tracker.countRequests('invite')} invite request(s) even though it should have been blocked`
  ).toBe(0);
});

Then('exactly one invite request should have been sent', async function () {
  const tracker = trackInvites(this);
  expect(
    tracker.countRequests('invite'),
    `a double-click sent ${tracker.countRequests('invite')} invite requests`
  ).toBe(1);
});

Then('no new agent should be created', async function () {
  const tracker = trackInvites(this);
  const ok = tracker.ok('invite');
  expect(
    ok.length,
    `an invite succeeded when none should have: ${JSON.stringify(ok)}`
  ).toBe(0);
});

Then('exactly one agent should exist with that email', { timeout: 240000 }, async function () {
  const identity = this._invited;
  expect(identity, 'no invited agent recorded for this scenario').toBeTruthy();
  const result = await listing(this).countAgentsWithEmail(identity.email, { name: identity.lastName });
  expect(
    result.total,
    `expected exactly one agent for ${identity.email}, found ${result.total} across `
    + `${JSON.stringify(result.perTab)}`
  ).toBe(1);
});

Then('the page should remain usable with my entered details intact', async function () {
  expect(await invite(this).isOnInvitePage(), 'the invite page navigated away after the failure').toBeTruthy();
  const snap = await invite(this).snapshotForm();
  expect(snap.email, 'the email I typed was lost when the request failed').toBeTruthy();
  expect(snap.firstName, 'the first name I typed was lost when the request failed').toBeTruthy();
  // The form must still respond — the logged defect was a blank page after an untreated error.
  await invite(this).enter('First Name', 'Reusable');
  expect(await invite(this).valueOf('First Name'), 'the form stopped accepting input after the failure')
    .toBe('Reusable');
});

// ==================== Failure injection ====================

Given(/^the invite agent request will fail with a (server error|network error)$/, async function (failure) {
  await invite(this).stubInviteFailure(failure);
  this._stubbedFailure = failure;
});

Then('an error toast should be displayed', { timeout: 30000 }, async function () {
  const deadline = Date.now() + 15000;
  let messages = [];
  while (Date.now() < deadline) {
    messages = await invite(this).toastMessages();
    if (messages.some((m) => /error|failed|something went wrong|try again|unable/i.test(m))) return;
    await this.page.waitForTimeout(1000);
  }
  expect(
    messages,
    `no error toast appeared after the stubbed ${this._stubbedFailure}. Toast text on screen: `
    + `${JSON.stringify(messages)}`
  ).toEqual(expect.arrayContaining([expect.stringMatching(/error|failed|something went wrong|try again|unable/i)]));
});

// Both failure modes are stubbed over the same filled form in one run, so the first
// toast has to be off screen before the second submit — otherwise the second assertion
// could pass on the first failure's toast.
When('I dismiss any visible toast', { timeout: 30000 }, async function () {
  const cleared = await invite(this).dismissToasts();
  expect(cleared, `a toast is still on screen: ${JSON.stringify(await invite(this).toastMessages())}`).toBeTruthy();
});

// react-toastify renders into a portal on <body>, so a toast belongs to the SESSION, not to
// whichever screen raised it — and this step is now used from two of them: the listing (the
// resend confirmation) and the invite form itself (the duplicate-email refusal). Reading it
// through one page object only was a latent trap: both readers query the document today, so
// `listing(...)` happened to work on the invite page, but scoping either reader to its own
// container later would have broken the other feature silently. The union costs nothing and
// cannot resolve to the wrong screen.
async function visibleToasts(world) {
  const readers = [listing(world), invite(world)];
  const seen = await Promise.all(readers.map((p) => p.toastMessages().catch(() => [])));
  return [...new Set(seen.flat())];
}

Then('the toast {string} should be displayed', { timeout: 30000 }, async function (expected) {
  const deadline = Date.now() + 15000;
  let messages = [];
  while (Date.now() < deadline) {
    messages = await visibleToasts(this);
    if (messages.some((m) => m.toLowerCase().includes(expected.toLowerCase()))) return;
    await this.page.waitForTimeout(1000);
  }
  expect(
    messages.join(' | '),
    `expected the toast "${expected}", but the toasts on screen were ${JSON.stringify(messages)}`
  ).toContain(expected);
});

// ==================== Lifecycle: listing assertions ====================

// "be listed on" / "still be listed on" / "move to" were three byte-identical bodies. They all
// mean the same assertion — the agent is on this tab — and differ only in what the reader is
// meant to infer, so they share one definition and one generous timeout (the transition is a
// backend state change, not a render).
Then(
  /^the invited agent should (?:be listed on|still be listed on|move to) the "([^"]*)" tab$/,
  { timeout: 240000 },
  async function (tab) {
    const identity = requireInvited(this);
    this._listedRow = await listing(this).waitForAgentOnTab(tab, {
      name: identity.lastName,
      email: identity.email,
      timeout: 180000,
    });
  }
);

// A NEGATIVE listing assertion, which is the one that can pass for the wrong reason: a grid
// that has not finished loading reads exactly like an empty one. confirmAgentAbsentFromTab
// only trusts a read once the tab is really selected AND a grid or empty state is on screen,
// and it requires the absence to hold twice — so "not there" means not there, not "not yet".
Then('the invited agent should not be listed on the {string} tab', { timeout: 120000 }, async function (tab) {
  const identity = requireInvited(this);
  const result = await listing(this).confirmAgentAbsentFromTab(tab, {
    name: identity.lastName,
    email: identity.email,
  });
  expect(
    result.absent,
    `${identity.email} should NOT be on the "${tab}" tab — ${result.reason}`
    + (result.row ? ` (listed there with status "${result.row.status}")` : '')
  ).toBeTruthy();
});

Then('the invited agent should no longer be listed on the {string} tab', { timeout: 180000 }, async function (tab) {
  const identity = requireInvited(this);
  const gone = await listing(this).waitForAgentGoneFromTab(tab, {
    name: identity.lastName,
    email: identity.email,
    timeout: 120000,
  });
  expect(gone, `${identity.email} is still listed on the "${tab}" tab after accepting the invite`).toBeTruthy();
});

Then('the listed row should show the status {string}', async function (status) {
  const row = requireListedRow(this);
  expect(row.status, `the status cell for ${row.email}`).toMatch(new RegExp(escapeRegExp(status), 'i'));
});

// The lifecycle scenario submits every text field padded with spaces, so the listed row is
// where trimming is proven: what the backend stored is what the listing renders.
Then('the listed row should show my details with the padding trimmed', async function () {
  const identity = requireInvited(this);
  const row = requireListedRow(this);
  if (this._paddingHeldInInput === false) {
    this.attach(
      'The form stripped the leading/trailing spaces in the input itself, so this step '
      + 'proves the padding never reached the backend rather than that the backend trims it.',
      'text/plain'
    );
  }
  expect(row.name, `the stored name "${row.name}" still carries padding`).toBe(row.name.trim());
  expect(row.name, 'the stored name should hold the first name I submitted').toContain(identity.firstName);
  expect(row.name, 'the stored name should hold the last name I submitted').toContain(identity.lastName);
  expect(row.email, 'the stored email should carry no padding').toBe(identity.email);
});

Then('the listed row should show the university I selected', async function () {
  const row = requireListedRow(this);
  expect(row.university, 'the university in the listed row').toBe(this._selectedUniversity || DEFAULT_UNIVERSITY);
});

// EXACT set, not merely "contains". Checking only for missing actions is what let a pending
// invite that had silently been activated still pass this step: an activated row keeps Edit
// and gains View + "Deactivate Account", so the extra actions are the evidence that the row
// is no longer the lifecycle state it claims to be.
Then('the row actions available for the invited agent should be {string}', async function (expected) {
  const identity = requireInvited(this);
  const wanted = expected.split(',').map((s) => s.trim()).filter(Boolean);
  const actual = await listing(this).rowActions(identity.email);
  const lower = (xs) => xs.map((x) => x.toLowerCase());
  const missing = wanted.filter((w) => !lower(actual).includes(w.toLowerCase()));
  const extra = actual.filter((a) => !lower(wanted).includes(a.toLowerCase()));
  expect(
    { missing, extra },
    `row actions for ${identity.email} should be exactly [${wanted.join(', ')}] but were `
    + `[${actual.join(', ')}]`
  ).toEqual({ missing: [], extra: [] });
});

When('I return to the Agents listing as the superadmin', { timeout: 90000 }, async function () {
  await listing(this).goto('Active');
});

// ==================== Lifecycle: the invitation email ====================

When('I open the newest {string} email for that agent', { timeout: 240000 }, async function (subject) {
  expect(subject).toMatch(/join talentforge/i);
  const identity = requireInvited(this);
  this._inviteMail = await waitForInviteMail(identity.email, {
    afterUid: this._inviteMailBaseline || 0,
    timeoutMs: 180000,
  });
});

Then('the email should be from {string}', async function (expected) {
  const mail = requireMail(this);
  expect(mail.from.toLowerCase(), 'the invitation email sender').toContain(expected.toLowerCase());
});

Then('the email should be addressed to the email I submitted', async function () {
  const identity = requireInvited(this);
  const mail = requireMail(this);
  expect(mail.to.toLowerCase(), 'the invitation email recipient').toContain(identity.email.toLowerCase());
});

Then('the email should contain a temporary password', async function () {
  const mail = requireMail(this);
  expect(
    mail.tempPassword,
    `no temporary password could be read out of the "Join Talentforge" mail. Body starts: `
    + `${String(mail.body).slice(0, 200)}`
  ).toBeTruthy();
  expect(mail.tempPassword.length, `the temporary password "${mail.tempPassword}" looks too short`)
    .toBeGreaterThanOrEqual(6);
});

Then('the email should contain a sign-in CTA', async function () {
  const mail = requireMail(this);
  expect(mail.hasSignInCta, 'the invitation email should carry a "Go to agent portal" CTA').toBeTruthy();
});

Then('a new {string} email should arrive for that agent', { timeout: 240000 }, async function (subject) {
  expect(subject).toMatch(/join talentforge/i);
  const identity = requireInvited(this);
  const baseline = this._inviteMail ? this._inviteMail.uid : (this._inviteMailBaseline || 0);
  const mail = await waitForInviteMail(identity.email, { afterUid: baseline, timeoutMs: 180000 });
  expect(mail.uid, 'the resend should deliver a strictly newer message').toBeGreaterThan(baseline);
  expect(mail.tempPassword, 'the resent invitation should carry a temporary password').toBeTruthy();
  this._inviteMail = mail;
});

// ==================== Lifecycle: the agent accepts ====================

When('that agent signs in with the temporary password', { timeout: 180000 }, async function () {
  const identity = requireInvited(this);
  const mail = this._inviteMail || (await waitForInviteMail(identity.email, {
    afterUid: this._inviteMailBaseline || 0,
    timeoutMs: 180000,
  }));
  this._inviteMail = mail;
  expect(mail.tempPassword, 'a temporary password is needed to sign the invited agent in').toBeTruthy();
  const session = await signInAsAgent(this, { email: identity.email, password: mail.tempPassword });
  this._agentContext = session.context;
  this._agentPage = session.page;
  this._agentLandedOn = session.landedOn;
});

Then('that agent should be redirected to the set-password screen', async function () {
  const page = requireAgentPage(this);
  expect(
    page.url(),
    `a first login with the temporary password should land on /set-password, got ${page.url()}`
  ).toMatch(/\/set-password/);
  await expect(
    page.getByRole('heading', { name: /set a new password/i }).first(),
    'the set-password heading'
  ).toBeVisible({ timeout: 20000 });
});

// The @known-issue lifecycle scenario needs the agent parked here, mid-onboarding, so the
// listing can be inspected while the account is authenticated but not yet set up.
When('that agent stops at the set-password screen', async function () {
  const page = requireAgentPage(this);
  expect(page.url(), 'the agent should be sitting on the set-password screen').toMatch(/\/set-password/);
  await this.page.waitForTimeout(3000);
});

When('that agent sets a new password', { timeout: 180000 }, async function () {
  const identity = requireInvited(this);
  const page = requireAgentPage(this);
  this._setPasswordResult = await setPasswordAndSignIn(page, {
    email: identity.email,
    password: identity.newPassword,
  });
  expect(
    this._setPasswordResult.setPasswordShown,
    'the set-password screen was not on screen when the password reset was attempted'
  ).toBeTruthy();
});

// setPasswordAndSignIn already performs the re-login, because "Update Password" bounces to
// /login rather than signing the agent in. This step asserts that it landed.
When('that agent signs in with the new password', async function () {
  const result = this._setPasswordResult;
  expect(result, 'the set-password step must run first').toBeTruthy();
  expect(
    result.landedOn,
    `after setting a new password the agent should reach the portal, but landed on ${result.landedOn}`
  ).toMatch(/\/dashboard|\/verifications|\/activity-log/);
});

Then('that agent should reach the Agent Dashboard', async function () {
  const page = requireAgentPage(this);
  expect(page.url(), `the agent should be on the dashboard, got ${page.url()}`).toMatch(/\/dashboard/);
  await expect(
    page.getByRole('heading', { name: /^dashboard$/i }).first(),
    'the Agent Dashboard heading'
  ).toBeVisible({ timeout: 20000 });
});

Then('the dashboard should greet that agent by their first name', async function () {
  const identity = requireInvited(this);
  const page = requireAgentPage(this);
  const body = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  expect(
    body,
    `the dashboard should greet "${identity.firstName}" — the name submitted on the invite`
  ).toMatch(new RegExp(`welcome,?\\s*${escapeRegExp(identity.firstName)}`, 'i'));
});

// ==================== The promo configured at invite time ====================
//
// Whether the promo SURVIVED the invite is not observable while the invite is pending —
// verified live 2026-07-30: the Invite Sent row's only actions are Edit (which opens an
// "Update Email Address" dialog, nothing else) and Resend Invite. The Promo Tools tab hangs
// off /agents/view/<id>, reachable only through the View action, which appears once the agent
// is Active. So this assertion necessarily runs after the agent has accepted.
//
// AdminPromoToolsPage is instantiated on this.page rather than in hooks.js: unlike
// referral-codes.steps.js (which drives an AGENT session and therefore needs a second
// context) this feature is already the superadmin, so the current page is the right one.
Then('the promo stored for that agent should be what I configured', { timeout: 180000 }, async function () {
  const identity = requireInvited(this);
  const configured = this._configuredPromo;
  expect(
    configured,
    'no promo was configured in this scenario — "I complete the promo section as ..." must run first'
  ).toBeTruthy();

  const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
  const promoPage = new AdminPromoToolsPage(this.page);
  await promoPage.openPromoTools(identity.lastName);

  const stored = await promoPage.readAllParameters();
  const storedCode = await promoPage.readPromoCode();

  // The two views render the same data differently, so compare on normalised forms rather
  // than on strings: the form holds "200" + a SAR suffix and an ISO date, Promo Tools renders
  // "200 SAR" and DD/MM/YYYY.
  const expectedType = /fixed/i.test(configured.type) ? 'Fixed Amount' : 'Percentage Discount';
  const expectedValue = /fixed/i.test(configured.type)
    ? `${configured.value} SAR`
    : `${configured.value}%`;

  expect(storedCode, 'the stored promo code should be the one the form generated').toBe(configured.code);
  expect(
    {
      incentiveType: stored['Incentive Type'],
      value: normaliseAmount(stored.Value),
      expiry: normaliseDate(stored['Expiry Date']),
      usageLimit: String(stored['Usage Limit'] || '').trim(),
    },
    `the promo stored against ${identity.email} (raw: ${JSON.stringify(stored)})`
  ).toEqual({
    incentiveType: expectedType,
    value: normaliseAmount(expectedValue),
    expiry: configured.expiry,
    usageLimit: String(configured.usageLimit),
  });
});

// ==================== Resend invite ====================

When('I click {string} for the invited agent', { timeout: 120000 }, async function (action) {
  const identity = requireInvited(this);
  await listing(this).goto('Invite Sent');
  await listing(this).search(identity.lastName);
  await listing(this).openResendDialog(identity.email);
});

Then('a {string} confirmation should be displayed naming that agent', async function (title) {
  const identity = requireInvited(this);
  const text = await listing(this).resendDialogText();
  expect(text, `the confirmation dialog should be titled "${title}"`).toMatch(new RegExp(escapeRegExp(title), 'i'));
  expect(text.toLowerCase(), 'the confirmation should name the agent being re-invited')
    .toContain(identity.email.toLowerCase());
});

When('I confirm the resend', { timeout: 60000 }, async function () {
  await listing(this).confirmResend();
});

When('I cancel the resend confirmation', async function () {
  await listing(this).cancelDialog();
  await this.page.waitForTimeout(1500);
});

Then('no resend request should be sent', async function () {
  const tracker = trackInvites(this);
  expect(
    tracker.countRequests('resend'),
    `cancelling the confirmation still sent ${tracker.countRequests('resend')} resend request(s)`
  ).toBe(0);
});

// ==================== RBAC ====================

When('I navigate directly to the superadmin Invite New Agent page', async function () {
  const origin = new URL(this.page.url()).origin;
  await this.page.goto(`${origin}/agents/invite`, { waitUntil: 'domcontentloaded' });
  // The bounce is client-side, so give the router a moment to run.
  await this.page.waitForTimeout(4000);
});

// ==================== Steps documented but not automatable on DEV ====================

Given('no agents exist in the system', manual);
Then('the Agents tab should display an empty state', manual);
Then('the empty state should indicate that no agents are available', manual);
Then('the primary CTA {string} should be visible', manual);

// The promo-LIFECYCLE living-spec steps (expiry passing, usage limits being reached, the
// notification matrix) moved to promo-lifecycle.steps.js on 2026-07-30, together with the
// scenarios in this feature's old §8. They are defined in exactly one place because Cucumber
// loads every step file into a single namespace — leaving a copy here would make each of
// them an ambiguous-step failure rather than an override.

// ==================== Teardown ====================

// Close the agent's own context, then deactivate whatever this scenario provisioned.
//
// Scoped to @invite-agent so it cannot touch the other features' state. Never throws: it
// runs after the scenario's own result is decided, and masking a real failure with a
// cleanup error would be worse than a leftover agent on DEV.
After({ tags: '@invite-agent', timeout: 180000 }, async function () {
  if (this._agentContext) {
    await this._agentContext.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await this._agentContext.close().catch(() => {});
    this._agentContext = null;
    this._agentPage = null;
  }
  if (this._inviteTracker) {
    this._inviteTracker.stop();
    this._inviteTracker = null;
  }

  const provisioned = this._provisionedAgents || [];
  if (!provisioned.length) return;
  // Cleanup needs a live superadmin session. If the scenario failed before logging in, or
  // the page is already gone, just report what was left behind.
  if (!this.page || this.page.isClosed()) {
    this.attach(
      `Left ${provisioned.length} provisioned agent(s) on DEV (no usable page for cleanup): `
      + `${provisioned.map((a) => a.email).join(', ')}`,
      'text/plain'
    );
    return;
  }
  const report = await deactivateProvisionedAgents(new AgentsListingPage(this.page), provisioned).catch((e) => [
    `cleanup crashed: ${String((e && e.message) || e).split('\n')[0]}`,
  ]);
  const leftover = report.filter((r) => !/: deactivated$/.test(r));
  if (leftover.length) {
    this.attach(
      'Provisioned-agent cleanup could not finish for every account. Deactivate these by '
      + `hand on the superadmin portal (Agents > find > Deactivate Account):\n${leftover.join('\n')}`,
      'text/plain'
    );
  }
});

// ==================== helpers ====================

function registerForCleanup(world, identity) {
  world._provisionedAgents = world._provisionedAgents || [];
  world._provisionedAgents.push(identity);
}

// Poll the CTA rather than reading it once: the form re-validates on a React tick, so an
// immediate read after a fill can catch the previous state. Returns whether it settled.
async function waitForSubmitState(world, wanted, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await invite(world).isSubmitEnabled()) === wanted) return true;
    if (Date.now() >= deadline) return false;
    await world.page.waitForTimeout(300);
  }
}

function requireInvited(world) {
  expect(
    world._invited,
    'no invited agent recorded — a step that provisions a unique agent email must run first'
  ).toBeTruthy();
  return world._invited;
}

function requireListedRow(world) {
  expect(
    world._listedRow,
    'no listing row captured — a step that locates the invited agent on a tab must run first'
  ).toBeTruthy();
  return world._listedRow;
}

function requireMail(world) {
  expect(world._inviteMail, 'the invitation email has not been read yet').toBeTruthy();
  return world._inviteMail;
}

function requireAgentPage(world) {
  expect(world._agentPage, "the invited agent's session has not been opened yet").toBeTruthy();
  return world._agentPage;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "200 SAR" / "200SAR" / "20%" / " 20 % " all normalise to the same thing, so the promo
// comparison is about the VALUE and its unit, not about either view's spacing.
function normaliseAmount(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
}

// Promo Tools renders DD/MM/YYYY; the form and the calendar work in ISO. Compare in ISO.
function normaliseDate(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || '').trim();
}

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function toIso(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDdMmYyyy(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// react-aria labels a day cell "Friday, July 31, 2026" (with extra clauses appended for
// today / the first available date), so parse the "Month D, YYYY" part out of it.
function parseCalendarLabel(label) {
  const m = String(label).match(/([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (month < 0) return null;
  return startOfDay(new Date(Number(m[3]), month, Number(m[2])));
}

function rgbToHex(rgb) {
  const m = String(rgb).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return String(rgb);
  const hex = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`.toUpperCase();
}

// Read the universities out of the superadmin Configuration module, for the cross-check
// step. Returns [] when the list cannot be located, so the caller can degrade honestly
// instead of asserting against an empty set.
async function readConfiguredUniversities(world) {
  const origin = new URL(world.page.url()).origin;
  for (const route of ['/configuration', '/settings/configuration', '/config']) {
    await world.page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await world.page.waitForTimeout(2500);
    const body = ((await world.page.locator('body').innerText().catch(() => '')) || '');
    if (/not found|404|unauthorized/i.test(body.slice(0, 400))) continue;

    const tab = world.page.getByText(/universit/i).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
      await world.page.waitForTimeout(2500);
    }
    const names = await world.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="row"] [role="rowheader"], [role="row"] [role="gridcell"]:first-child, tbody tr td:first-child'))
        .map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 90)
    );
    if (names.length) return [...new Set(names)];
  }
  return [];
}
