const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const CommunityPage = require('../pages/CommunityPage');
const CommunityFormPage = require('../pages/CommunityFormPage');
const LoginPage = require('../pages/LoginPage');
const video = require('../utils/videoRecorder');
require('dotenv').config();

// Steps for BOTH Community feature files:
//   features/SuperAdmin_Portal/Community/Community.feature   (@community-admin, TFF-264)
//   features/Candidate_Portal/Community.feature              (@community-candidate, TFF-334)
//
// ONE step file for two features, on purpose. They drive the SAME two screens — /community and
// /community/view/<id> — off the same endpoints; only the role differs. Splitting them would
// duplicate every card, header, search, filter and empty-state reader, and the two copies would
// drift until the two features disagreed about what the app does. Where a step is genuinely
// role-specific it says so in its own comment.
//
// NOT REDEFINED HERE, because they already exist and already do the right thing:
//   "I am logged in as the superadmin"      invite-agent.steps.js
//   "I am logged in as a candidate"         subscription.steps.js
//   "I am logged in as an agent"            active-candidate.steps.js
//   "I refresh the page"                    invite-agent.steps.js
//   "the {string} button should be disabled/enabled"   signup.steps.js (generic, role-based)
//   "I click {string}"                      common.steps.js (a dispatcher — the Community
//                                           branch was added THERE rather than duplicated here)
//
// AND DELIBERATELY NOT REUSED — these phrasings are owned by invite-agent.steps.js and are
// bound to the INVITE form, so a Community scenario using them would run invite-form logic
// against a Community screen and fail for a reason that has nothing to do with the defect:
//   "I open the {string} dropdown"          asserts the field matches /university/
//   "I double-click {string}"               asserts the label matches /send invite/
//   "every form field should be empty"      reads the invite form's fields
//   "no validation error should be displayed for {string}"
//   "{string} should hold exactly {int} characters"
//   "I click {string} in the success modal"
// The Community feature files use distinct wording for each. This is the same trap the note at
// the top of invite-agent.steps.js records; it has bitten this module once already.

// AC 3.1 D — the 28 locations the story lists. The live dropdown offers 31 (a superset), so
// the assertion is that every one of these is present, not that the count matches; the extras
// are reported instead of failed on. See COMMUNITY_JIRA_VS_APP.md §B.3.
const AC_LOCATIONS = [
  'Abha', 'Al Ahsa', 'Al Baha', 'Al Kharj', 'Al Khobar', 'Al Majmaah', 'Al Qassim', 'Arar',
  'Asir', 'Bisha', 'Buraidah', 'Dammam', 'Dhahran', 'Hafr Al Batin', 'Hail', 'Jazan', 'Jeddah',
  'Jubail', 'Madinah', 'Makkah', 'Najran', 'Northern Borders', 'Riyadh', 'Sakaka', 'Shaqra',
  'Tabuk', 'Taif', 'Thuwal',
];

const SUCCESS_LABELS = ['Course Completed', 'Certificate', 'Co-op Program', 'Tamheer Program'];

// The image a step sends when it just needs a required field filled with something valid and
// the file itself is not what the scenario is about (Save gating, clear-a-field validation,
// editing an existing community). Defined ON THE PAGE OBJECT so this file and
// fillValidDetails() cannot drift apart — see the note there for why that matters.
const { VALID_COVER, VALID_LOGO } = CommunityFormPage;
// The edit scenarios deliberately swap the formats over, so a changed image is a different
// file in every respect rather than the same picture re-sent.
const EDIT_COVER = ['PNG', 6];
const EDIT_LOGO = ['JPG', 8];

// Living-spec steps: scenarios tagged @not-automatable need candidate/tenant state no screen
// can produce. Returning 'pending' rather than throwing keeps them yellow (a documented gap)
// instead of red (a defect that is not there).
const manual = () => 'pending';

// ==================== World plumbing ====================

function community(world) {
  if (!world._community) world._community = new CommunityPage(world.page);
  return world._community;
}

function form(world) {
  if (!world._communityForm) world._communityForm = new CommunityFormPage(world.page);
  return world._communityForm;
}

// Scratch space for everything a scenario notes and re-reads later. Namespaced `_cmty` so it
// cannot collide with the promo and referral features' World keys.
function notes(world) {
  if (!world._cmty) world._cmty = { failures: [] };
  return world._cmty;
}

// Collect-and-report, used by every table-driven step. Cucumber abandons a scenario at its
// FIRST failing step, so a step that walked four rows and threw on row one would hide whether
// the other three shared the cause — which is the single most useful thing a report can say
// about a table.
function reportFailures(world, label, failures, extra = []) {
  if (extra.length) world.attach(extra.join('\n'), 'text/plain');
  if (!failures.length) return;
  world.attach(`${label}\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}`, 'text/plain');
  throw new Error(`${label} (${failures.length}):\n- ${failures.join('\n- ')}`);
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lc = (s) => norm(s).toLowerCase();

// ==================== Second sessions ====================

// A second superadmin context, for the ONE candidate-side scenario that has to compare what the
// two roles can see. The app holds one session per context, so this cannot share the
// candidate's. Keys are `_cmtyAdmin*` — promo-lifecycle.steps.js owns `_promoAdmin*` and
// referral-codes.steps.js owns `_adminContext`, and sharing either would let one feature's
// After hook close the other's context mid-scenario.
async function superadminCommunity(world) {
  if (world._cmtyAdmin) return world._cmtyAdmin;
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  const context = await world.browser.newContext(video.contextOptions());
  const page = video.track(world, await context.newPage(), 'community-superadmin');
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/candidate-analytics|\/dashboard/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  world._cmtyAdminContext = context;
  world._cmtyAdmin = new CommunityPage(page);
  return world._cmtyAdmin;
}

// A throwaway session for the access-control table: one context per role, torn down after.
// `role` is the Gherkin wording, so the report quotes what the scenario asked for.
async function sessionFor(world, role) {
  const context = await world.browser.newContext(video.contextOptions());
  const page = video.track(world, await context.newPage(), `community-${lc(role).replace(/\W+/g, '-')}`);
  const creds = {
    'logged in as an agent': [process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD],
    'logged in as a candidate': [process.env.CANDIDATE_EMAIL, process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD],
  }[lc(role)];
  if (creds) {
    const [email, password] = creds;
    if (!email || !password) throw new Error(`Missing credentials in .env for "${role}"`);
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(password);
    await login.submitButton.first().click();
    await page.waitForTimeout(9000);
  }
  if (!world._cmtySessions) world._cmtySessions = [];
  world._cmtySessions.push(context);
  return page;
}

// ==================== Restore hook (@mutates-community) ====================

// The edit scenarios change a REAL community. Restoring is not optional: a community left with
// "Corrected description for TFF-264." would make the header scenarios assert against a value
// nobody configured, and the next run would read as a defect.
//
// The hook never throws. A failed restore is ATTACHED to the report instead, because masking
// the scenario's own result with a cleanup error is strictly worse than a documented dirty
// fixture — the report would name the wrong cause.
After({ tags: '@mutates-community' }, async function () {
  const n = this._cmty;
  if (!n || !n.restore) return;
  try {
    const f = form(this);
    await f.gotoEdit(n.restore.id);
    if (n.restore.location) await f.selectLocation(n.restore.location);
    if (n.restore.about != null) await f.typeAbout(n.restore.about);
    if (await f.waitForSaveEnabled(6000)) {
      await f.clickSave();
      this.attach(`Restored community ${n.restore.id} to location "${n.restore.location}" / about "${String(n.restore.about).slice(0, 60)}"`, 'text/plain');
    } else {
      this.attach(`Nothing to restore on community ${n.restore.id} — the form reported no change.`, 'text/plain');
    }
  } catch (err) {
    this.attach(
      `RESTORE FAILED for community ${n.restore.id}: ${err.message}\n`
      + `Expected location "${n.restore.location}", about "${String(n.restore.about).slice(0, 120)}".\n`
      + 'Put them back by hand before the next run — the header scenarios read these values.',
      'text/plain'
    );
  }
});

// Closed in PARALLEL and with an explicit timeout. The access-control scenario opens three
// extra contexts (agent, candidate, logged-out), and closing them one at a time overran the
// 60s default that a hook without its own timeout inherits — the run of 2026-08-02 reported
// two "function timed out" errors against that scenario ON TOP of its real finding, which
// makes a genuine access-control result look like an unstable test.
After({ tags: '@community', timeout: 120000 }, async function () {
  const contexts = [...(this._cmtySessions || [])];
  if (this._cmtyAdminContext) contexts.push(this._cmtyAdminContext);
  await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
  this._cmtySessions = [];
  this._cmtyAdminContext = null;
  this._cmtyAdmin = null;
});

// ============================================================================
// Navigation and module overview
// ============================================================================

Given('I am on the Community main page', { timeout: 90000 }, async function () {
  await community(this).gotoList();
});

// Four steps were DELETED here on 2026-08-02 along with the AC-1 overview scenario that was
// their only caller:
//   the Community main page should offer a {string} CTA
//   the Community main page should offer a search field
//   every community card should offer an edit action
//   every community card should offer a {string} CTA
// Each asserted the mere PRESENCE of something the card/search scenarios assert the content of
// (§6.1's element table covers the edit icon and the View Community CTA; its placeholder check
// covers the search field). They are not reachable from any feature file now, and a step
// definition nothing calls is dead weight that still has to be read and maintained.
// NOTE: `no community card should offer an edit action` is a DIFFERENT step, still live — the
// candidate feature uses it to prove the superadmin's affordance does not leak to that role.

When('I open the Create Community page', { timeout: 60000 }, async function () {
  await form(this).gotoCreate();
});

Then('I should be on the Create Community page', async function () {
  expect(form(this).isOnCreate(), `expected /community/create, got ${this.page.url()}`).toBeTruthy();
});

Then('the form should identify the community by its university', async function () {
  const fields = await form(this).readFields();
  const named = fields.labels.some((l) => /university|institut/i.test(l.text));
  expect(named, `no field on the form names the university. Labels: ${fields.labels.map((l) => l.text).join(' | ')}`).toBeTruthy();
});

// AC 1 says communities are university-based ONLY. The durable check is that the form offers no
// way to pick a different KIND of community — asserting the absence of a named control would
// pass on a build that renamed it.
Then('the form should offer no community type other than university', async function () {
  const body = await this.page.evaluate(() => document.body.innerText);
  const offenders = ['community type', 'type of community', 'category', 'company', 'organisation community']
    .filter((t) => new RegExp(t, 'i').test(body));
  expect(offenders, `the form appears to offer a community type selector: ${offenders.join(', ')}`).toHaveLength(0);
});

// ============================================================================
// Create form — fields, dropdowns, About University
// ============================================================================

Then('the Create Community form should show the following fields:', async function (table) {
  const fields = await form(this).readFields();
  const failures = [];
  const seen = [];

  for (const row of table.hashes()) {
    const name = row.field;
    const wantRequired = /required/i.test(row.requiredness);
    const mustRefer = row['placeholder must refer to'];

    // Cover and Profile are upload BUTTONS, not labelled inputs, so they are matched against
    // the button inventory; the other three are label+input pairs.
    if (/photo/i.test(name)) {
      const isProfile = /profile/i.test(name);
      const btn = fields.uploadButtons.find((b) =>
        isProfile
          ? /logo|profile/i.test(`${b.text} ${b.aria || ''}`)
          : /cover/i.test(`${b.text} ${b.aria || ''}`));
      if (!btn) {
        failures.push(`"${name}": no upload control found. Upload controls on the form: ${JSON.stringify(fields.uploadButtons)}`);
        continue;
      }
      const describes = new RegExp(mustRefer.split(/\s+or\s+/).join('|'), 'i').test(`${btn.text} ${btn.aria || ''}`);
      if (!describes) failures.push(`"${name}": its control reads "${btn.text || btn.aria}" which does not refer to ${mustRefer}`);
      seen.push(`${name}: control "${btn.text || btn.aria}"`);
      continue;
    }

    const label = fields.labels.find((l) => {
      const t = lc(l.text);
      if (/university\/institute/i.test(name)) return /university|institut/.test(t) && !/about/.test(t);
      if (/about/i.test(name)) return /about/.test(t);
      return t.includes(lc(name));
    });
    if (!label) {
      failures.push(`"${name}": no label found. Labels present: ${fields.labels.map((l) => l.text).join(' | ')}`);
      continue;
    }
    // Requiredness from a VISIBLE asterisk — About University ships a hidden one, and reading
    // textContent would call this optional field required.
    if (label.requiredVisible !== wantRequired) {
      failures.push(
        `"${name}": AC says ${wantRequired ? 'required' : 'optional'}, but the form renders it `
        + `${label.requiredVisible ? 'required' : 'optional'} (visible asterisk: ${label.requiredVisible})`
      );
    }

    // Bind each field to ITS OWN input by identity, never by scanning every placeholder for a
    // keyword: "university" appears in the university placeholder AND in the About University
    // one, so a keyword scan silently checks the wrong control and reports a field as fine
    // because a different field's placeholder happened to match.
    const textInputs = fields.inputs.filter((i) => i.visible && i.type !== 'file');
    const input = /university\/institute/i.test(name)
      ? textInputs.find((i) => /select university|institut/i.test(i.placeholder || '')) || textInputs[0]
      : /about/i.test(name)
        ? textInputs.find((i) => i.maxlength || i.name === 'description')
        : textInputs.find((i) => i !== textInputs[0] && !i.maxlength && i.name !== 'description');
    if (!input || !norm(input.placeholder)) {
      failures.push(`"${name}": its input has no placeholder at all (TFF-273). Inputs on the form: ${JSON.stringify(textInputs)}`);
      continue;
    }
    // The AC pins this copy only through a design image, so the durable assertion is that the
    // placeholder GUIDES the user about this field — not that it repeats the field's name.
    // "e.g. Riyadh, Saudi Arabia" describes a location perfectly well without the word.
    const alternatives = mustRefer.split(/\s+or\s+/).map((s) => norm(s).replace(/^(a|the)\s+/, ''));
    const extra = { location: 'riyadh|saudi|jeddah', 'a city': 'riyadh|saudi|jeddah', 'a welcome': 'welcome|brief|message', 'the community': 'communit' };
    const pattern = alternatives.map((a) => extra[a] || a).join('|');
    if (!new RegExp(pattern, 'i').test(input.placeholder)) {
      failures.push(`"${name}": its placeholder "${input.placeholder}" does not refer to ${mustRefer} (TFF-273)`);
    }
    seen.push(`${name}: ${label.requiredVisible ? 'required' : 'optional'}, placeholder "${input.placeholder}"`);
  }
  reportFailures(this, 'Create Community field inventory', failures, [`Read from the live form:\n${seen.join('\n')}`]);
});

Then('the upload hint should state the accepted formats and the size limit', async function () {
  const fields = await form(this).readFields();
  const hint = fields.hint;
  expect(hint, 'no upload hint was rendered').toBeTruthy();
  expect(/jpg/i.test(hint) && /png/i.test(hint), `the hint "${hint}" should name JPG and PNG`).toBeTruthy();
  expect(/10\s*MB/i.test(hint), `the hint "${hint}" should state the 10 MB limit from AC 3.1`).toBeTruthy();
  this.attach(`Upload hint: "${hint}"`, 'text/plain');
});

Given('I have noted the university of an existing community', { timeout: 60000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed to note').toBeGreaterThan(0);
  notes(this).existingCommunity = cards[0];
  this.attach(`Noted existing community: "${cards[0].name}" (id ${cards[0].id}, ${cards[0].memberText})`, 'text/plain');
});

When('I open the community university dropdown', async function () {
  await form(this).openUniversityDropdown();
});

When('I open the community location dropdown', async function () {
  await form(this).openLocationDropdown();
});

// The dropdown renders 12 at a time and does not grow on scroll, so "every listed university"
// means every one it is currently offering. The rule is proved against a KNOWN subject by the
// search step below; this one guards against the obvious regression — a listed university that
// is plainly one of the communities on screen.
Then('every listed university should be one without an active community', { timeout: 60000 }, async function () {
  // The list paints after the dropdown opens, so it is polled rather than read once.
  let shown = [];
  for (let i = 0; i < 10 && !shown.length; i++) {
    shown = await form(this).readOptions();
    if (!shown.length) await this.page.waitForTimeout(500);
  }
  // The empty list is itself rendered as a role=option. Measured 2026-11-02: DEV has no
  // university left without a community, and the dropdown then says exactly this - which is the
  // rule holding, not the dropdown failing.
  const NONE_LEFT = /^No institutions available for assignment\.?$/i;
  const offered = shown.filter((o) => !NONE_LEFT.test(o));
  if (!offered.length) {
    expect(shown, 'the university dropdown offered nothing and did not say why').toEqual(['No institutions available for assignment.']);
    this.attach('Every university already has a community: the dropdown says "No institutions available for assignment." and offers nothing.', 'text/plain');
    notes(this).offeredUniversities = [];
    return;
  }
  const withCommunities = (notes(this).allCommunityNames || []).map(lc);
  const clash = offered.filter((o) => withCommunities.includes(lc(o)));
  notes(this).offeredUniversities = offered;
  this.attach(`University dropdown offered ${offered.length}: ${offered.join(', ')}`, 'text/plain');
  expect(clash, `these universities already have a community but were still offered: ${clash.join(', ')}`).toHaveLength(0);
});

When("I search the university dropdown for that community's university", async function () {
  const name = notes(this).existingCommunity.name;
  notes(this).universitySearchResults = await form(this).filterUniversityDropdown(name);
  this.attach(`Searched the university dropdown for "${name}" -> ${notes(this).universitySearchResults.length} option(s)`, 'text/plain');
});

Then('no university option should be offered', async function () {
  // the "No institutions available for assignment." line is the empty list, not an option
  const found = (notes(this).universitySearchResults || []).filter((o) => !/^No institutions available/i.test(o));
  expect(
    found,
    `AC 3.1 says a university with an active community must not be offered, but the dropdown offered: ${found.join(', ')}`
  ).toHaveLength(0);
});

When('I select the first available university', async function () {
  notes(this).firstUniversity = await form(this).selectUniversity(0);
});

When('I select a different available university', async function () {
  const first = notes(this).firstUniversity;
  // Clearing before reopening for the same reason selectUniversity does: the field now holds
  // the first selection, and a type-to-filter combobox would offer only that one back.
  await form(this).universityInput.fill('').catch(() => {});
  await this.page.waitForTimeout(600);
  await form(this).openUniversityDropdown();
  const options = await form(this).readOptions();
  const other = options.find((o) => lc(o) !== lc(first)) || options[1] || options[0];
  await this.page.locator('[role="option"]').filter({ hasText: other }).first().click({ timeout: 15000 });
  await form(this).settle(600);
  notes(this).secondUniversity = other;
});

Then('only the second university should be selected', async function () {
  const held = await form(this).universityInput.inputValue();
  const n = notes(this);
  expect(norm(held), `the field should hold the second selection "${n.secondUniversity}"`).toBe(norm(n.secondUniversity));
  expect(
    lc(held) === lc(n.firstUniversity) && lc(n.firstUniversity) !== lc(n.secondUniversity),
    'the field still holds the first selection, so it is not single-select'
  ).toBeFalsy();
});

Then('the {string} dropdown should offer every location named in the AC', { timeout: 60000 }, async function (field) {
  const offered = await form(this).readOptions();
  notes(this).locationOptions = offered;
  const missing = AC_LOCATIONS.filter((l) => !offered.some((o) => lc(o) === lc(l)));
  this.attach(`The "${field}" dropdown offered ${offered.length} options.`, 'text/plain');
  expect(
    missing,
    `AC 3.1 D lists ${AC_LOCATIONS.length} locations; these were not offered: ${missing.join(', ')}`
  ).toHaveLength(0);
});

// Reported, not failed on: the live list is a 31-value superset and no ticket disputes the
// extras, so failing here would make the scenario permanently red on undisputed data.
Then('any location offered beyond the AC list should be reported', async function () {
  const offered = notes(this).locationOptions || [];
  const extra = offered.filter((o) => !AC_LOCATIONS.some((l) => lc(l) === lc(o)));
  this.attach(
    extra.length
      ? `The Location dropdown offers ${extra.length} value(s) beyond AC 3.1 D: ${extra.join(', ')}.\n`
        + 'Reported rather than failed on — the AC list is a subset of what Configuration holds.'
      : 'The Location dropdown offers exactly the AC 3.1 D list, with no extras.',
    'text/plain'
  );
});

When('I select the location {string}', async function (name) {
  notes(this).lastLocation = await form(this).selectLocation(name);
});

Then('the {string} field should hold {string}', async function (field, value) {
  const held = /location/i.test(field)
    ? await form(this).locationInput.inputValue()
    : await form(this).universityInput.inputValue();
  expect(norm(held), `the "${field}" field`).toBe(norm(value));
});

Then('the {string} field should not hold {string}', async function (field, value) {
  const held = /location/i.test(field)
    ? await form(this).locationInput.inputValue()
    : await form(this).universityInput.inputValue();
  expect(lc(held), `the "${field}" field still holds the earlier selection, so it is not single-select`).not.toBe(lc(value));
});

When('I fill every required field with valid details', { timeout: 120000 }, async function () {
  const used = await form(this).fillValidDetails();
  notes(this).filled = used;
  this.attach(`Filled the form with: ${JSON.stringify(used)}`, 'text/plain');
});

When('I leave {string} empty', async function (field) {
  if (/about/i.test(field)) await form(this).typeAbout('');
});

Then('the About University field should be empty', async function () {
  const value = await form(this).aboutInput.inputValue();
  expect(value, 'About University should remain empty because it is optional').toBe('');
});

Then('the community Save button should be enabled', async function () {
  expect(
    await form(this).waitForSaveEnabled(),
    'Save should be enabled when all required fields are valid, regardless of About University'
  ).toBeTruthy();
});

// COMMUNITY-OWNED, AND NOT INTERCHANGEABLE WITH THE GENERIC
// `the {string} button should be disabled` (steps/signup.js). Two differences, both of which
// matter on this form:
//
//   * IT WATCHES A WINDOW INSTEAD OF TAKING ONE READ. The generic step is a Playwright
//     `toBeDisabled` retry, so it passes the moment Save is disabled ONCE and returns. Save on
//     this form settles asynchronously (see the note beside saveStaysDisabled/waitForSaveEnabled
//     in CommunityFormPage), so a Save that is briefly disabled and then WRONGLY enables passes
//     the generic step and fails this one. That is exactly the defect the image scenarios are
//     asserting against - Save must not come back after a rejected upload or a removed cover.
//   * IT USES THE FORM'S OWN SUBMIT. The generic step matches the accessible name as a
//     SUBSTRING and takes `.first()` in DOM ORDER, and the CROP MODAL also renders a button
//     named "Save" (measured: type="button", inside [role="dialog"], and ENABLED while the form's
//     own submit is disabled). CommunityFormPage.saveButton filters on the submit type, so it
//     cannot resolve to the cropper. DOM order happens to spare the generic step today; that is
//     luck, not a guarantee, and this repo has paid for that assumption several times over.
//
// The message states what was observed rather than naming one cause - this step has three call
// sites (a fresh form, after rejected uploads, after an image is removed) and "missing required
// fields" was true of only the first.
Then('the community Save button should be disabled', async function () {
  const f = form(this);
  const stayed = await f.saveStaysDisabled();
  expect(
    stayed,
    'Save did not stay disabled: it was enabled at some point during the observation window, so '
    + 'the form accepted a state it should have gated. Save is only legitimate once every '
    + 'required field - both images, the university and the location - is valid.'
  ).toBeTruthy();
});

Then('no validation error should be shown for {string}', async function (field) {
  const errors = await form(this).readAllErrors();
  const relevant = errors.filter((e) => new RegExp(field.split('/')[0], 'i').test(e));
  expect(relevant, `unexpected validation error on "${field}": ${relevant.join(' | ')}`).toHaveLength(0);
});

When('I type a three-line description into {string}', async function (field) {
  notes(this).aboutHeld = await form(this).typeAbout('First line.\nSecond line.\nThird line.');
});

Then('the About University field should hold three lines', async function () {
  const value = await form(this).aboutInput.inputValue();
  const lines = value.split('\n').filter(Boolean);
  expect(lines.length, `About University held ${lines.length} line(s): ${JSON.stringify(value)}`).toBe(3);
});

When('I type {int} characters into {string}', async function (count, field) {
  notes(this).aboutHeld = await form(this).typeAbout('x'.repeat(count));
});

When('I paste {int} characters into {string}', async function (count, field) {
  notes(this).aboutHeld = await form(this).pasteAbout('y'.repeat(count));
});

Then('the About University field should hold exactly {int} characters', async function (count) {
  const value = await form(this).aboutInput.inputValue();
  expect(
    value.length,
    `AC 3.1 E caps About University at ${count} characters "silently"; the field held ${value.length}`
  ).toBe(count);
});

// ============================================================================
// Image uploads
// ============================================================================

Then('each image field should accept only JPG and PNG file types', async function () {
  const fields = await form(this).readFields();
  const inputs = fields.inputs.filter((i) => i.type === 'file');
  expect(inputs.length, 'no file inputs were found on the form').toBeGreaterThan(0);
  const failures = inputs
    .filter((i) => !i.accept || !/jpe?g/i.test(i.accept) || !/png/i.test(i.accept) || /gif|webp|svg|\*/i.test(i.accept))
    .map((i) => `a file input accepts "${i.accept}", which is not JPG/PNG only`);
  reportFailures(this, 'File input accept attributes', failures, [
    `accept attributes: ${inputs.map((i) => i.accept).join(' | ')}`,
  ]);
});

// One step for both the accept and the reject tables — they differ only by whether the row
// carries an "expected error" column. Every row is attempted and every verdict kept, so a
// rejection scenario reports all seven rows rather than stopping at the first.
When('I upload the following images:', { timeout: 300000 }, async function (table) {
  const n = notes(this);
  n.uploads = [];
  for (const row of table.hashes()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await form(this).uploadImage(row.field, row.format, Number(row['size MB']), row.method || 'picker');
    n.uploads.push({ ...row, ...result, expectedError: row['expected error'] || null });
    // eslint-disable-next-line no-await-in-loop
    await this.page.waitForTimeout(400);
  }
  this.attach(
    n.uploads
      // The FILE NAME is named, not just the nominal size: the sizes come from real checked-in
      // photographs, so "10MB" alone leaves a reader unable to tell which bytes were sent or to
      // reproduce the row by hand.
      .map((u) => `${u.field} / ${u.format} / ${u['size MB']}MB -> sent "${u.fileName}" `
        + `[${u.fileSource}, ${u.sizeBytes} bytes] via ${u.method || 'picker'} -> `
        + `${u.accepted ? 'ACCEPTED' : 'rejected'}${u.error ? ` [${u.errorSurface}] "${u.error}"` : ''}`
        // Three things that separate "the app refused this file" from "the suite never managed to
        // send it", which used to be indistinguishable in the report and cost a whole scenario's
        // diagnosis. `pickerFailure` means the upload control could not be clicked at all;
        // `cropImageReady: false` means the cropper never decoded the bytes.
        + (u.pickerFailure ? `\n    picker could not be clicked: ${u.pickerFailure}` : '')
        + (u.cropModalAppeared ? `\n    crop modal: "${u.cropHeading}" (image decoded: ${u.cropImageReady}, confirmed: ${u.cropConfirmed})` : ''))
      .join('\n'),
    'text/plain'
  );
});

// A BOUNDARY SCENARIO THAT DID NOT SEND THE BOUNDARY PROVES NOTHING, so this is asserted before
// anything is concluded from the result. imageFixtures.js already throws if a fixture registered
// with `exactBytes` has drifted, but that guard cannot fire for a size with NO fixture registered
// — which is exactly how `Profile Photo | PNG | 10` came to send a generated 1x1 image while the
// scenario went on claiming to test 10 MB. This step closes that hole from the other end: it reads
// what was actually put on the wire, and a silent fall-through to the generated path fails here
// with the byte count and the file name in the message.
Then('each upload should have sent exactly {int} bytes', async function (bytes) {
  const uploads = notes(this).uploads || [];
  expect(uploads.length, 'no uploads were attempted').toBeGreaterThan(0);
  const wrong = uploads
    .filter((u) => u.sizeBytes !== bytes)
    .map((u) => `${u.field} / ${u.format}: sent "${u.fileName}" [${u.fileSource}] of ${u.sizeBytes} bytes, not ${bytes}`);
  reportFailures(this, `Uploads that did not send exactly ${bytes} bytes`, wrong, [
    uploads.map((u) => `${u.field} / ${u.format}: "${u.fileName}" [${u.fileSource}] ${u.sizeBytes} bytes`).join('\n'),
  ]);
});

Then('a preview should be displayed for every uploaded image', async function () {
  const failures = [];
  for (const u of notes(this).uploads || []) {
    // eslint-disable-next-line no-await-in-loop
    const shown = await form(this).hasPreview(u.field);
    if (!shown) {
      failures.push(
        `${u.field}: no preview after a ${u.format} of ${u['size MB']} MB (${u.sizeBytes} bytes) via ${u.method || 'picker'}`
        + `${u.error ? ` — the app answered [${u.errorSurface}] "${u.error}"` : ''}`
      );
    }
  }
  reportFailures(this, 'Uploads that produced no preview', failures);
});

Then('no validation error should be displayed for either image field', async function () {
  const errors = (notes(this).uploads || []).filter((u) => u.error);
  reportFailures(
    this,
    'Validation errors raised on uploads that AC 3.1 says are valid',
    errors.map((u) => `${u.field} / ${u.format} / ${u['size MB']} MB: [${u.errorSurface}] "${u.error}"`)
  );
});

// A REGRESSION LOCK ON SHIPPED BEHAVIOUR, NOT AN AC ASSERTION — and it is expected to PASS.
//
// Both halves of what it checks are captures of what the product does, per the 2026-08-10 decision
// that the build is the source of truth for AC 11's image rows (see the comment on the scenario, and
// COMMUNITY_JIRA_VS_APP.md §5, which records that the AC needs amending on both counts):
//   * WORDING — the feature table holds the strings the build ships, both the per-field format ones
//     (PO clarification, 2026-08-03) and the size one (2026-08-10).
//   * SURFACE — a TOAST. AC 11 marks all six image messages "Inline"; the build has always used
//     toasts and that was accepted as intended.
// SO A FAILURE HERE MEANS THE BEHAVIOUR CHANGED, and both messages say so instead of quoting an AC —
// "AC 11 marks this Inline" sent whoever read a red row to a document that is now known to be wrong.
// A change is not automatically a defect: if dev moves these errors inline, this goes red and the
// right response is to confirm the intent and update the scenario, not to "fix" the app back.
//
// Every row's verdict is still collected and reported together rather than thrown one at a time, so
// the report names all eight rows instead of stopping at the first.
Then('each rejected upload should show its expected error as a toast', async function () {
  const failures = [];
  const observed = [];
  for (const u of notes(this).uploads || []) {
    if (!u.expectedError) continue;
    observed.push(`${u.field} / ${u.format} / ${u['size MB']}MB -> [${u.errorSurface || 'none'}] "${u.error || ''}"`);
    if (!u.error) {
      failures.push(`${u.field} / ${u.format} / ${u['size MB']} MB: no error at all; expected "${u.expectedError}"`);
      continue;
    }
    if (norm(u.error) !== norm(u.expectedError)) {
      failures.push(
        `${u.field} / ${u.format} / ${u['size MB']} MB: the message CHANGED — this scenario pins the `
        + `wording the build shipped, "${u.expectedError}", and the app now shows "${u.error}". `
        + 'Confirm which is intended, then update the feature table (this is not an AC 11 deviation).'
      );
    }
    if (u.errorSurface !== 'toast') {
      failures.push(
        `${u.field} / ${u.format} / ${u['size MB']} MB: the SURFACE changed — this scenario pins the `
        + `toast the build ships, and the app used a ${u.errorSurface}. If that is dev implementing `
        + 'AC 11\'s "Inline" on purpose, confirm it and update this scenario to expect inline.'
      );
    }
  }
  reportFailures(this, 'Image validation mismatches', failures, [`Observed:\n${observed.join('\n')}`]);
});

Then('no preview should be displayed for any rejected image', async function () {
  const failures = [];
  for (const u of notes(this).uploads || []) {
    if (!u.expectedError) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await form(this).hasPreview(u.field)) {
      failures.push(`${u.field}: a preview was rendered for a rejected ${u.format} of ${u['size MB']} MB`);
    }
  }
  reportFailures(this, 'Rejected uploads that still produced a preview', failures);
});

Then("each image field's edit and remove controls should be visible with a pointer cursor", async function () {
  const controls = await form(this).imageControls();
  this.attach(`Image controls on the form: ${JSON.stringify(controls)}`, 'text/plain');
  const failures = [];
  const edit = controls.filter((c) => /change|edit/i.test(`${c.text} ${c.aria || ''}`));
  const remove = controls.filter((c) => /remove|delete/i.test(`${c.text} ${c.aria || ''}`));
  if (!edit.length) failures.push('no edit/change control was rendered for an uploaded image (TFF-272)');
  if (!remove.length) failures.push('no remove control was rendered for an uploaded image (TFF-272)');
  for (const c of [...edit, ...remove]) {
    if (c.cursor !== 'pointer') failures.push(`"${c.text || c.aria}" has cursor "${c.cursor}", not "pointer" (TFF-272 / TFF-329)`);
  }
  reportFailures(this, 'Image edit/remove control problems', failures);
});

When('I replace each uploaded image with a different valid image', { timeout: 180000 }, async function () {
  const n = notes(this);
  n.replacements = [];
  for (const field of ['Cover Photo', 'Profile Photo']) {
    // variant 1 — a DIFFERENT real photograph from the one the original upload sent. Re-sending
    // identical bytes cannot distinguish "the replacement was applied" from "the original is
    // still on screen", so the whole scenario would pass without the replace path working.
    // eslint-disable-next-line no-await-in-loop
    n.replacements.push(await form(this).uploadImage(field, 'PNG', 5, 'picker', 1));
  }
  n.replacementFiles = n.replacements.map((r) => r.fileName);
  this.attach(`Replacement images sent: ${n.replacementFiles.join(', ')}`, 'text/plain');
});

Then('each preview should show the replacement image', async function () {
  const failures = [];
  for (const field of ['Cover Photo', 'Profile Photo']) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await form(this).hasPreview(field))) failures.push(`${field}: no preview after replacing the image`);
  }
  reportFailures(this, 'Replacement previews', failures);
});

When('I remove the {string} image', async function (field) {
  const f = form(this);
  const removed = await f.removeImage(field);
  // Report WHY, not just that it failed: "no remove control was available" sent readers looking
  // for a missing button when the real answer could be that two controls matched the field.
  expect(removed, `could not remove "${field}": ${f.lastRemoveFailure || 'no reason recorded'}`).toBeTruthy();
  this.attach(`Removed "${field}". Previews now: ${JSON.stringify(await f.imagePreviews())}`, 'text/plain');
});

Then('no preview should be displayed for {string}', async function (field) {
  const shown = await form(this).hasPreview(field);
  expect(shown, `"${field}" still shows a preview after being removed`).toBeFalsy();
});

Then('no preview should be displayed for either image field', async function () {
  const failures = [];
  for (const field of ['Cover Photo', 'Profile Photo']) {
    // eslint-disable-next-line no-await-in-loop
    if (await form(this).hasPreview(field)) failures.push(`${field} still shows a preview`);
  }
  reportFailures(this, 'Previews left on a form that should be empty', failures);
});

Then('the upload should have been rejected', async function () {
  const last = (notes(this).uploads || []).slice(-1)[0];
  expect(last, 'no upload was attempted').toBeTruthy();
  expect(
    last.accepted,
    `a ${last.format} of ${last['size MB']} MB was ACCEPTED on ${last.field}; Edit must enforce the same rules as Create`
  ).toBeFalsy();
  this.attach(`Rejection message: [${last.errorSurface}] "${last.error}"`, 'text/plain');
});

// ============================================================================
// Save gating and required-field validation
// ============================================================================

When('I fill the required fields one at a time:', { timeout: 240000 }, async function (table) {
  const states = [];
  // hashes() builds a NEW array on every call, so `row === table.hashes()[last]` is never true —
  // comparing by index instead is what makes "until the LAST field" mean anything.
  const rows = table.hashes();
  for (const row of rows) {
    const field = row.field;
    // eslint-disable-next-line no-await-in-loop
    if (/cover/i.test(field)) await form(this).uploadImage('Cover Photo', ...VALID_COVER);
    // eslint-disable-next-line no-await-in-loop
    else if (/profile/i.test(field)) await form(this).uploadImage('Profile Photo', ...VALID_LOGO);
    // eslint-disable-next-line no-await-in-loop
    else if (/university/i.test(field)) await form(this).selectUniversity(0);
    // eslint-disable-next-line no-await-in-loop
    else if (/location/i.test(field)) await form(this).selectLocation('Riyadh');
    // The LAST field must enable Save, so it is read with the tolerant reader; every earlier
    // one must keep it gated, so those are read with the reader that watches a window. They
    // are not each other's negation — a single read of an asynchronously-settling button is
    // not evidence either way.
    const isLast = rows.indexOf(row) === rows.length - 1;
    // eslint-disable-next-line no-await-in-loop
    const disabled = isLast ? !(await form(this).waitForSaveEnabled()) : await form(this).saveStaysDisabled(1500);
    states.push({ field, saveDisabled: disabled });
  }
  notes(this).gatingStates = states;
  this.attach(`Save state after each field:\n${states.map((s) => `${s.field}: Save ${s.saveDisabled ? 'disabled' : 'ENABLED'}`).join('\n')}`, 'text/plain');
});

Then('the {string} button should have stayed disabled until the last field was filled', async function (label) {
  const states = notes(this).gatingStates || [];
  expect(states.length, 'no gating states were recorded').toBeGreaterThan(0);
  const early = states.slice(0, -1).filter((s) => !s.saveDisabled);
  expect(
    early,
    `AC 3.2 gates "${label}" until every required field is complete, but it was already enabled after: ${early.map((s) => s.field).join(', ')}`
  ).toHaveLength(0);
});

// The ONLY route to the AC 11 required-field messages: Save is gated, so there is no submit to
// trigger them. Filling then clearing is what a superadmin would actually do to reach them.
When('I clear each required field in turn and read its error:', { timeout: 240000 }, async function (table) {
  const results = [];
  for (const [index, row] of table.hashes().entries()) {
    const field = row.field;
    // Each row gets an independent valid form. This keeps the assertion for one missing field
    // from depending on a restore upload or selection from the previous row.
    if (index > 0) {
      // eslint-disable-next-line no-await-in-loop
      await form(this).gotoCreate();
      // eslint-disable-next-line no-await-in-loop
      await form(this).fillValidDetails();
    }
    // eslint-disable-next-line no-await-in-loop
    if (/photo/i.test(field)) {
      const removed = await form(this).removeImage(field);
      expect(removed, `could not clear "${field}": ${form(this).lastRemoveFailure || 'no remove control was available'}`).toBeTruthy();
    }
    // eslint-disable-next-line no-await-in-loop
    else await form(this).clearField(field);
    // eslint-disable-next-line no-await-in-loop
    const error = await form(this).readValidationError();
    // eslint-disable-next-line no-await-in-loop
    const saveDisabled = await form(this).saveStaysDisabled(1200);
    results.push({ field, expected: row['expected error'], actual: error.message, surface: error.surface, saveDisabled });
  }
  notes(this).clearResults = results;
  this.attach(
    results.map((r) => `${r.field}: expected "${r.expected}" -> got [${r.surface || 'none'}] "${r.actual || ''}" (Save ${r.saveDisabled ? 'disabled' : 'ENABLED'})`).join('\n'),
    'text/plain'
  );
});

Then('each cleared field should have shown its expected error inline, not as a toast', async function () {
  const failures = [];
  for (const r of notes(this).clearResults || []) {
    if (!r.actual) {
      failures.push(`${r.field}: no validation message at all; AC 11 requires "${r.expected}" (Inline)`);
      continue;
    }
    if (norm(r.actual) !== norm(r.expected)) {
      failures.push(`${r.field}: AC 11 requires "${r.expected}", the app showed "${r.actual}"`);
    }
    if (r.surface !== 'inline') failures.push(`${r.field}: AC 11 marks this "Inline"; the app used a ${r.surface}`);
  }
  reportFailures(this, 'AC 11 required-field message mismatches', failures);
});

Then('the {string} button should be disabled after each field was cleared', async function (label) {
  const enabled = (notes(this).clearResults || []).filter((r) => !r.saveDisabled).map((r) => r.field);
  expect(
    enabled,
    `AC 3.2 gates "${label}" while any required field is missing, but it stayed enabled after clearing: ${enabled.join(', ')}`
  ).toHaveLength(0);
});

// ============================================================================
// Creation (@creates-community)
// ============================================================================

When('I create a community with valid details', { timeout: 300000 }, async function () {
  const used = await form(this).fillValidDetails({ about: 'Automation-created community.' });
  notes(this).created = used;
  const resp = await form(this).clickSave();
  this.attach(`Created a community for "${used.university}" in "${used.location}" (${resp ? `${resp.method} ${resp.status}` : 'no response captured'})`, 'text/plain');
});

When('I double-click the Save button', { timeout: 300000 }, async function () {
  const resp = await form(this).clickSave({ dblclick: true });
  notes(this).created = notes(this).filled;
  this.attach(`Double-clicked Save (${resp ? `${resp.method} ${resp.status}` : 'no response captured'})`, 'text/plain');
});

Then('the community success modal {string} should be displayed', async function (heading) {
  const modal = await form(this).readSuccessModal();
  notes(this).successModal = modal;
  expect(modal.present, 'no success modal appeared after saving').toBeTruthy();
  expect(
    new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(modal.text),
    `AC 3.3 specifies "${heading}"; the modal read "${modal.text}"`
  ).toBeTruthy();
  // THIS MODAL IS THE PROOF THAT CREATION HAPPENED, so it is the right place to promote the values
  // the form was filled with into `created` — and it works no matter WHICH step pressed Save.
  //
  // Only `I create a community with valid details` and `I double-click the Save button` used to set
  // `created`. The end-to-end scenario saves through the GENERIC `I click "Save"` in
  // common.steps.js, which knows nothing about communities, so `created` stayed undefined and the
  // next step called `fill(undefined)` — "value: expected string, got undefined". Recording it here
  // rather than teaching the generic click step about this feature keeps the coupling in the module
  // that owns it, and deliberately does NOT fall back to `filled` anywhere else: outside a confirmed
  // save, "what I typed" is not "what exists".
  if (!notes(this).created && notes(this).filled) notes(this).created = notes(this).filled;
});

Then('the community success modal should display {string}', async function (line) {
  const modal = notes(this).successModal || (await form(this).readSuccessModal());
  expect(
    norm(modal.text).includes(norm(line)),
    `AC 3.3 specifies "${line}"; the modal read "${modal.text}"`
  ).toBeTruthy();
});

// TFF-338 shipped the AGENT invite copy in this modal, so this is a named regression rather
// than a stylistic check.
Then('the community success modal should not mention an agent', async function () {
  const modal = notes(this).successModal || (await form(this).readSuccessModal());
  expect(/\bagent\b/i.test(modal.text), `TFF-338: the community success modal mentions an agent: "${modal.text}"`).toBeFalsy();
});

Then('the community success modal should offer the CTAs {string} and {string}', async function (a, b) {
  const modal = notes(this).successModal || (await form(this).readSuccessModal());
  const missing = [a, b].filter((c) => !modal.ctas.some((x) => lc(x).includes(lc(c))));
  expect(missing, `the modal offered ${JSON.stringify(modal.ctas)}; missing: ${missing.join(', ')}`).toHaveLength(0);
});

When('I click {string} in the community success modal', { timeout: 60000 }, async function (cta) {
  await form(this).clickSuccessCta(cta);
});

Then('every Create Community field should be empty', async function () {
  const values = await form(this).readValues();
  const dirty = Object.entries(values).filter(([, v]) => (typeof v === 'boolean' ? v : norm(v) !== ''));
  expect(dirty, `the reopened form is not empty: ${JSON.stringify(values)}`).toHaveLength(0);
});

Then('exactly one community should be listed for that university', async function () {
  const cards = await community(this).readCards();
  const name = createdUniversity(this);
  const matches = cards.filter((c) => lc(c.name) === lc(name));
  this.attach(`Searched for "${name}" -> ${cards.length} card(s): ${cards.map((c) => c.name).join(', ')}`, 'text/plain');
  expect(
    matches.length,
    `AC 3.1 allows one community per university, but ${matches.length} exist for "${name}"`
  ).toBe(1);
});

// ============================================================================
// Listing — cards and search
// ============================================================================

Then('every community card should show the following elements:', async function (table) {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  const wanted = table.hashes().map((r) => r.element);
  const failures = [];
  for (const card of cards) {
    for (const element of wanted) {
      const ok = {
        'University Profile Photo': card.hasImage,
        'University Logo/Profile Image': card.hasImage,
        'University Name': !!card.name,
        'Member Count': card.memberCount !== null,
        'Total Member Count': card.memberCount !== null,
        'Edit Icon': card.hasEdit,
        'View Community CTA': card.hasViewCta,
      }[element];
      if (ok === undefined) failures.push(`unknown element "${element}" in the table`);
      else if (!ok) failures.push(`"${card.name || '(unnamed card)'}" is missing: ${element}`);
    }
  }
  reportFailures(this, 'Community card elements', failures, [`Checked ${cards.length} card(s).`]);
});

Then('every community card member count should read as {string}', async function (format) {
  const cards = await community(this).readCards();
  const bad = cards.filter((c) => !c.memberText || !/^\d[\d,]*\s*Members?$/i.test(c.memberText));
  reportFailures(
    this,
    `Member counts not in the "${format}" format`,
    bad.map((c) => `"${c.name}" reads "${c.memberText}"`)
  );
});

// The live placeholder carries a trailing ellipsis the AC does not quote. That is a truncation
// affordance rather than different copy, so it is normalised away and reported — failing on it
// would bury a real defect under a punctuation argument.
Then('the community search placeholder should be {string}', async function (expected) {
  const actual = await community(this).searchPlaceholder();
  this.attach(`Live placeholder: "${actual}" (AC: "${expected}")`, 'text/plain');
  const stripped = norm(actual).replace(/[.…]+$/, '');
  expect(stripped.toLowerCase(), `the search placeholder (AC 4.1 specifies "${expected}")`).toBe(lc(expected));
});

Given('I have noted the name and location of an existing community', { timeout: 90000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  const card = cards[0];
  await community(this).gotoCommunity(card.id);
  const header = await community(this).readHeader();
  notes(this).subject = { ...card, location: header.location, description: header.description };
  this.attach(`Noted "${card.name}" (id ${card.id}) in "${header.location}"`, 'text/plain');
  await community(this).gotoList();
});

Given('I have noted the name of a listed community', { timeout: 60000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  notes(this).subject = cards[0];
  this.attach(`Noted "${cards[0].name}"`, 'text/plain');
});

// Builds each variation FROM the noted name, so the scenario carries no hardcoded university
// and keeps working when DEV's data changes.
function nameVariation(name, rule) {
  const n = norm(name);
  if (/upper case/i.test(rule)) return n.toUpperCase();
  if (/fragment/i.test(rule)) return n.split(/\s+/)[0] || n.slice(0, 4);
  if (/padded/i.test(rule)) return `   ${n}   `;
  return n;
}

When('I search the communities for each of the following:', { timeout: 180000 }, async function (table) {
  const subject = notes(this).subject;
  const results = [];
  for (const row of table.hashes()) {
    const rule = row['variation of that community\'s name'] || row.rule;
    const term = nameVariation(subject.name, rule);
    // eslint-disable-next-line no-await-in-loop
    await community(this).search(term);
    // eslint-disable-next-line no-await-in-loop
    const cards = await community(this).readCards();
    results.push({ rule: row.rule, term, listed: cards.some((c) => lc(c.name) === lc(subject.name)), count: cards.length });
  }
  notes(this).searchResults = results;
  this.attach(results.map((r) => `${r.rule}: searched "${r.term}" -> ${r.count} card(s), subject ${r.listed ? 'listed' : 'MISSING'}`).join('\n'), 'text/plain');
});

Then('that community should be listed for every one of them', async function () {
  const subject = notes(this).subject;
  const misses = (notes(this).searchResults || []).filter((r) => !r.listed);
  reportFailures(
    this,
    `Searches that failed to find "${subject.name}"`,
    misses.map((r) => `${r.rule}: searching "${r.term}" returned ${r.count} card(s) and not the subject`)
  );
});

When("I search the communities for that community's location", { timeout: 60000 }, async function () {
  const subject = notes(this).subject;
  await community(this).search(subject.location);
  notes(this).locationSearchCards = await community(this).readCards();
  this.attach(`Searched for the location "${subject.location}" -> ${notes(this).locationSearchCards.map((c) => c.name).join(', ') || '(none)'}`, 'text/plain');
});

// AC 4.1 scopes the search to the university NAME. A community whose NAME happens to contain
// the location legitimately matches, so that case is excluded rather than counted as a failure —
// two such communities exist on DEV ("Riyadh Elm University", "Vision Colleges in Riyadh").
Then('that community should not be listed', async function () {
  const subject = notes(this).subject;
  const cards = notes(this).locationSearchCards || [];
  const matched = cards.find((c) => lc(c.name) === lc(subject.name));
  if (matched && new RegExp(subject.location, 'i').test(subject.name)) {
    this.attach(`"${subject.name}" contains "${subject.location}" in its NAME, so matching it is correct.`, 'text/plain');
    return;
  }
  expect(
    matched,
    `AC 4.1 scopes the search to the university name, but searching the location "${subject.location}" returned "${subject.name}"`
  ).toBeFalsy();
});

// SEARCHING THE LISTING REQUIRES THE LISTING TO BE ON SCREEN. Both @creates-community scenarios ran
// this step from a page that has no community search box — one from /community/create (reached via
// the success modal's "Create New Community" CTA), the other straight after creating — and
// `searchInput.fill()` then spent its full 30s timeout waiting for a control that was never going to
// appear. It read as the search field being broken; it was the wrong page.
//
// Navigating here is what both scenarios intend anyway: each searches the listing to prove exactly
// one community was created.
async function searchListing(world, term) {
  const c = community(world);
  if (!c.isOnListing()) await c.gotoList();
  await c.search(term);
}

// Named, with a real error, rather than letting an undefined reach fill(). Playwright's
// "value: expected string, got undefined" says nothing about which note was missing or why.
function createdUniversity(world) {
  const n = notes(world);
  const name = (n.created || {}).university || (n.subject || {}).name;
  expect(
    name,
    'no created community is on record — the success-modal step records it, so either the save was '
    + 'never confirmed or this step ran before it'
  ).toBeTruthy();
  return name;
}

When('I search the communities for {string}', { timeout: 60000 }, async function (term) {
  await searchListing(this, term);
});

When('I search the communities for that university', { timeout: 60000 }, async function () {
  await searchListing(this, createdUniversity(this));
});

When("I search the communities for that community's name", { timeout: 60000 }, async function () {
  await searchListing(this, notes(this).subject.name);
});

Then('that community should be listed', async function () {
  const cards = await community(this).readCards();
  const subject = notes(this).subject;
  expect(
    cards.some((c) => lc(c.name) === lc(subject.name)),
    `"${subject.name}" was not listed. Got: ${cards.map((c) => c.name).join(', ') || '(none)'}`
  ).toBeTruthy();
});

Then('only that community should be listed', async function () {
  const cards = await community(this).readCards();
  const name = createdUniversity(this);
  expect(cards.length, `expected exactly one card for "${name}", got: ${cards.map((c) => c.name).join(', ')}`).toBe(1);
  expect(lc(cards[0].name), 'the listed card').toBe(lc(name));
  notes(this).subject = cards[0];
});

Then('no community cards should be listed', async function () {
  const cards = await community(this).readCards();
  expect(cards, `expected no cards, got: ${cards.map((c) => c.name).join(', ')}`).toHaveLength(0);
});

// EVERY empty-state reader below RE-READS the page rather than reusing a cached snapshot, and
// that is not tidiness. The member list renders a DIFFERENT body line depending on whether a
// search, a filter, or both are active, so the filter scenario asserts one wording, applies a
// search, and asserts a second — and with a cached state that second assertion would re-read the
// first snapshot and pass no matter what the app did. The cache is still written so a failure
// message and the attachment agree with each other.
Then('the empty state heading {string} should be displayed', async function (heading) {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  expect(state.present, 'no empty state was rendered at all').toBeTruthy();
  expect(
    lc(state.heading),
    `the empty-state heading (expected "${heading}"; the app rendered "${state.heading}")`
  ).toBe(lc(heading));
});

Then('the empty state should display {string}', async function (line) {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  expect(
    norm(state.fullText).toLowerCase().includes(lc(line)),
    `expected "${line}"; the empty state read "${state.fullText}"`
  ).toBeTruthy();
});

// The listing's empty state is a heading and NOTHING ELSE (live: exactly "No communities found").
// Asserting the whole text rather than a substring is what turns that absence into a real
// assertion — a build that adds a sub-line later changes this string and is caught, where an
// `includes` check would go on passing.
Then('the empty state should read exactly {string}', async function (expected) {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  expect(state.present, 'no empty state was rendered at all').toBeTruthy();
  this.attach(`Empty state (${state.hostTag}) reads: ${JSON.stringify(state.fullText)}`, 'text/plain');
  expect(norm(state.fullText), 'the whole of the empty state').toBe(norm(expected));
});

Then('a {string} CTA should be offered', async function (label) {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  const found = (state.clearCtas || []).some((c) => lc(c).includes(lc(label)));
  expect(
    found,
    `expected a "${label}" CTA on this empty state; the page offered: ${(state.clearCtas || []).join(', ') || '(none)'}`
  ).toBeTruthy();
});

// The counterpart, for the two states that deliberately offer none: the listing's
// "No communities found" and the member list's search-only state. Both were previously asserted
// to offer a "Clear all filters" CTA, which the app does not put there — the CTA belongs to the
// filter states. Without this step that difference goes unrecorded, and a build that started
// showing a clear CTA on a plain search would be indistinguishable from today's.
Then('no empty-state clear CTA should be offered', async function () {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  const ctas = state.clearCtas || [];
  expect(
    ctas,
    `this empty state offers no clear CTA in the build, but the page rendered: ${ctas.join(', ')}`
  ).toHaveLength(0);
});

Then('the empty state heading should not be {string}', async function (heading) {
  const state = notes(this).emptyState || (await community(this).readEmptyState());
  expect(
    lc(state.heading),
    'the no-members state must not be confused with the no-results state'
  ).not.toBe(lc(heading));
});

// TFF-337: the message rendered with no spacing.
//
// MEASURED GEOMETRICALLY — the gap to the nearest rendered thing above and below — because the
// old reader took the host's own padding + margin, and that answered 64px or -40px for the SAME
// visual state depending on which block won an innermost-first sort (both measured live
// 2026-08-03). `spacingBelow` is null when the message is the last thing on the page, which is
// not a missing gap and must not be asserted as one.
Then('the no-results message should have vertical spacing above and below it', async function () {
  const state = await community(this).readEmptyState();
  notes(this).emptyState = state;
  this.attach(
    `Empty state (${state.hostTag}) "${state.heading}": ${state.spacingAbove}px above, `
    + `${state.spacingBelow === null ? 'nothing rendered below it' : `${state.spacingBelow}px below`}`,
    'text/plain'
  );
  expect(state.spacingAbove, 'TFF-337: no vertical space above the no-results message').toBeGreaterThan(0);
  if (state.spacingBelow !== null) {
    expect(state.spacingBelow, 'TFF-337: no vertical space below the no-results message').toBeGreaterThan(0);
  }
});

When('I clear the community search', async function () {
  await community(this).clearSearch();
});

Then('the community search field should be empty', async function () {
  expect(await community(this).searchInput.inputValue(), 'the community search field').toBe('');
});

Then('all communities should be listed again', async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'clearing the search left the listing empty').toBeGreaterThan(0);
});

When('I search the communities for each of the following terms:', { timeout: 180000 }, async function (table) {
  const results = [];
  for (const row of table.hashes()) {
    const term = row.term;
    // eslint-disable-next-line no-await-in-loop
    await community(this).search(term).catch((e) => results.push({ term, threw: e.message }));
    // eslint-disable-next-line no-await-in-loop
    const body = await community(this).bodyText();
    // eslint-disable-next-line no-await-in-loop
    const html = await this.page.content();
    results.push({
      term,
      // "Something went wrong" / a stack trace / a blank shell are the three ways this fails.
      errored: /something went wrong|unexpected error|cannot read propert/i.test(body),
      blank: norm(body).length < 40,
      // A term reflected as MARKUP rather than as text is the injection case that matters.
      reflectedAsMarkup: term.includes('<') && html.includes(term) && !html.includes(term.replace(/</g, '&lt;')),
    });
  }
  notes(this).specialSearches = results;
  await community(this).clearSearch();
  this.attach(results.map((r) => `"${r.term}" -> ${JSON.stringify(r)}`).join('\n'), 'text/plain');
});

Then('no error should be displayed for any of them', async function () {
  const bad = (notes(this).specialSearches || []).filter((r) => r.errored || r.threw);
  reportFailures(this, 'Search terms that produced an error', bad.map((r) => `"${r.term}": ${r.threw || 'an error was displayed'}`));
});

Then('no term should be reflected into the page as markup', async function () {
  const bad = (notes(this).specialSearches || []).filter((r) => r.reflectedAsMarkup);
  reportFailures(this, 'Search terms reflected into the page unescaped', bad.map((r) => `"${r.term}"`));
});

Then('the page should remain usable', async function () {
  await expect(community(this).searchInput, 'the search field should still be usable').toBeVisible({ timeout: 15000 });
  const blank = (notes(this).specialSearches || []).filter((r) => r.blank);
  reportFailures(this, 'Search terms that blanked the page', blank.map((r) => `"${r.term}"`));
});

// 127 communities across 11 pages. A browser-side search over the CURRENT page would satisfy
// every other search assertion and still miss three quarters of the data, so the subject here
// is deliberately taken from a later page.
Given('I have noted a community that is not on the first page of the listing', { timeout: 180000 }, async function () {
  // START FROM AN UNFILTERED LISTING. This Given runs mid-scenario, after the search assertions,
  // and the last of those searches is for the community's LOCATION — which correctly matches
  // nothing, so the listing is sitting on its empty state with no pagination at all. Reading
  // nextPage there found 0 and the step returned pending, silently dropping the one assertion that
  // catches a search which filters only the rendered page. It was invisible in the report because
  // the step before it was failing for an unrelated reason and Cucumber had already abandoned the
  // scenario; fixing that race is what exposed this.
  await community(this).gotoList();
  const firstPage = (await community(this).readCards()).map((c) => lc(c.name));
  const canPage = await community(this).nextPage.count();
  // Genuinely a single-page listing now that nothing is filtering it — the scenario cannot ask
  // its question, and saying so is better than passing.
  if (!canPage) {
    this.attach(
      `The unfiltered listing offers no next page (${firstPage.length} card(s) on page 1), so no `
      + 'community exists off the first page to search for.',
      'text/plain'
    );
    return manual();
  }
  await community(this).nextPage.click();
  await community(this).settle(1500);
  const later = await community(this).readCards();
  const subject = later.find((c) => !firstPage.includes(lc(c.name)));
  expect(subject, 'the second page held no community that was not already on the first').toBeTruthy();
  notes(this).subject = subject;
  notes(this).allCommunityNames = [...firstPage, ...later.map((c) => c.name)];
  this.attach(`Noted "${subject.name}" from page 2 (page 1 held: ${firstPage.slice(0, 4).join(', ')}...)`, 'text/plain');
  await community(this).gotoList();
});

When('I click the edit icon on the first community card', { timeout: 60000 }, async function () {
  const cards = await listingCards(this);
  const card = noteSubject(this, cards[0]);
  await this.page.locator(`a[href="/community/edit/${card.id}"]`).first().click({ timeout: 20000 });
  await form(this).ready();
});

Then('I should be on the Edit Community page for that community', async function () {
  const id = form(this).editingId();
  expect(id, `expected /community/edit/<id>, got ${this.page.url()}`).toBeTruthy();
  expect(id, 'the edit form opened for a different community').toBe(notes(this).subject.id);
});

Then("the form should be pre-filled with that community's details", async function () {
  const values = await form(this).readValues();
  notes(this).prefilled = values;
  this.attach(`Edit form holds: ${JSON.stringify(values)}`, 'text/plain');
  const failures = [];
  if (lc(values.university) !== lc(notes(this).subject.name)) {
    failures.push(`university holds "${values.university}", expected "${notes(this).subject.name}"`);
  }
  if (!norm(values.location)) failures.push('location is empty');
  if (!values.coverPreview) failures.push('no cover photo is shown');
  if (!values.profilePreview) failures.push('no profile photo is shown');
  reportFailures(this, 'Edit form was not pre-filled', failures);
});

When('I go back to the Community main page', { timeout: 60000 }, async function () {
  await community(this).gotoList();
});

// READ LISTING CARDS ONLY WHILE THE LISTING IS ON SCREEN, and say so loudly otherwise.
//
// readCards() falls back to `document.querySelectorAll('article')` when no community-card testid
// is present, and a community VIEW page is full of articles — so called from the wrong page it
// returns member cards dressed as community cards, every one with `id: null` because a member card
// holds no `/community/view/` link. That produced `a[href="/community/view/null"]` and a 20s
// timeout that read as the View Community CTA being broken, when the real fault was that the
// preceding Given had left the browser on /community/view/<id>. Same class as the promo Case 4
// bug: a reader that answers confidently on the wrong page costs the diagnosis, not just the run.
async function listingCards(world) {
  const c = community(world);
  if (!c.isOnListing()) await c.gotoList();
  const cards = await c.readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  const idless = cards.filter((x) => !x.id);
  expect(
    idless.length,
    `readCards() returned ${idless.length} of ${cards.length} card(s) with no community id, which means `
    + `this is not the listing. URL: ${world.page.url()}`
  ).toBe(0);
  return cards;
}

// MERGES into the noted subject rather than replacing it. The Given that precedes these steps
// records `location` and `description` off the community's own header, and the two assertions that
// compare them (`the header should show that community's configured ...`) are written to SKIP a
// field the subject does not carry — so overwriting the subject with a bare listing card would let
// that scenario pass having checked the name alone.
function noteSubject(world, card) {
  const prev = notes(world).subject;
  notes(world).subject = prev && lc(prev.name) === lc(card.name) ? { ...prev, ...card } : card;
  return notes(world).subject;
}

When('I click {string} on the first community card', { timeout: 60000 }, async function (label) {
  const cards = await listingCards(this);
  const card = noteSubject(this, cards[0]);
  await this.page.locator(`a[href="/community/view/${card.id}"]`).first().click({ timeout: 20000 });
  await community(this).settle(2000);
});

When('I click {string} on that community card', { timeout: 60000 }, async function (label) {
  const subject = notes(this).subject;
  const cards = await listingCards(this);
  const card = noteSubject(this, cards.find((c) => lc(c.name) === lc(subject.name)) || cards[0]);
  await this.page.locator(`a[href="/community/view/${card.id}"]`).first().click({ timeout: 20000 });
  await community(this).settle(2000);
});

When('I click {string} on that card', { timeout: 60000 }, async function (label) {
  const subject = notes(this).subject;
  await this.page.locator(`a[href="/community/view/${subject.id}"]`).first().click({ timeout: 20000 });
  await community(this).settle(2500);
});

Then('I should be on the University Community page for that community', async function () {
  const id = community(this).currentCommunityId();
  expect(id, `expected /community/view/<id>, got ${this.page.url()}`).toBeTruthy();
  expect(id, 'a different community opened than the card that was clicked').toBe(notes(this).subject.id);
});

Then('that community card should show the university name I selected', async function () {
  const cards = await community(this).readCards();
  const name = (notes(this).created || {}).university;
  expect(cards.some((c) => lc(c.name) === lc(name)), `no card named "${name}"; got ${cards.map((c) => c.name).join(', ')}`).toBeTruthy();
});

Then('that community card should show {string}', async function (text) {
  const cards = await community(this).readCards();
  const name = (notes(this).created || {}).university;
  const card = cards.find((c) => lc(c.name) === lc(name)) || cards[0];
  expect(norm(card.memberText), `the new community's member count`).toBe(norm(text));
});

// ============================================================================
// Edit
// ============================================================================

When('I open Edit Community for the first community', { timeout: 90000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  notes(this).subject = cards[0];
  await form(this).gotoEdit(cards[0].id);
});

When('I open Edit Community for that community', { timeout: 90000 }, async function () {
  await form(this).gotoEdit(notes(this).subject.id);
});

Then('the following fields should be editable:', async function (table) {
  const values = await form(this).readValues();
  const failures = [];
  for (const row of table.hashes()) {
    const field = row.field;
    if (/cover/i.test(field) && !(await form(this).coverUploadButton.count()) && !values.coverPreview) {
      failures.push('Cover Photo: no control and no existing image');
    } else if (/profile/i.test(field) && !(await form(this).logoUploadButton.count()) && !values.profilePreview) {
      failures.push('Profile Photo: no control and no existing image');
    } else if (/location/i.test(field) && (await form(this).locationInput.isDisabled().catch(() => true))) {
      failures.push('Location: the field is disabled');
    } else if (/about/i.test(field) && (await form(this).aboutInput.isDisabled().catch(() => true))) {
      failures.push('About University: the field is disabled');
    }
  }
  reportFailures(this, 'Fields AC 5.1 says are editable but are not', failures);
});

// The app does not DISABLE the university control; it offers exactly one option — its own. So
// the assertion is the rule AC 5.1 protects (identity is fixed), not an implementation detail
// the AC never specified.
Then('the university should not be changeable to a different university', { timeout: 60000 }, async function () {
  const current = await form(this).universityInput.inputValue();
  await form(this).openUniversityDropdown().catch(() => {});
  const options = await form(this).readOptions();
  await this.page.keyboard.press('Escape').catch(() => {});
  const others = options.filter((o) => lc(o) !== lc(current));
  this.attach(`Edit university control holds "${current}" and offers: ${options.join(', ') || '(nothing)'}`, 'text/plain');
  expect(
    others,
    `AC 5.1 omits the university from the editable fields, but the Edit form offers ${others.length} other university/ies: ${others.join(', ')}`
  ).toHaveLength(0);
});

When('I select the location it already holds', async function () {
  const current = await form(this).locationInput.inputValue();
  notes(this).originalLocation = current;
  await form(this).selectLocation(current);
});

When('I note the current location', async function () {
  notes(this).originalLocation = await form(this).locationInput.inputValue();
  this.attach(`Current location: "${notes(this).originalLocation}"`, 'text/plain');
});

When('I select a different location', async function () {
  const current = notes(this).originalLocation || (await form(this).locationInput.inputValue());
  notes(this).originalLocation = notes(this).originalLocation || current;
  notes(this).newLocation = await form(this).selectFirstDifferentLocation(current);
  this.attach(`Selected "${notes(this).newLocation}" (was "${current}")`, 'text/plain');
});

When('I select the original location again', async function () {
  await form(this).selectLocation(notes(this).originalLocation);
});

Given('I have noted the current details of the first community', { timeout: 120000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  const card = cards[0];
  await community(this).gotoCommunity(card.id);
  const header = await community(this).readHeader();
  notes(this).subject = { ...card, location: header.location, description: header.description };
  notes(this).header = header;
  this.attach(`Noted "${card.name}" (id ${card.id}): location "${header.location}", description "${String(header.description).slice(0, 80)}"`, 'text/plain');
  // BACK TO THE LISTING, as the sibling "noted the name and location" Given already did. Reading the
  // header means opening the community, and every scenario that uses this Given goes on to act on the
  // LISTING (click a card's edit icon, click its View Community CTA). Left on /community/view/<id>
  // the next step read member cards as community cards and clicked `/community/view/null`.
  await community(this).gotoList();
});

// Arms the restore hook BEFORE changing anything — a failure part-way through the table must
// still leave the After hook able to put the community back.
When('I change the following fields:', { timeout: 300000 }, async function (table) {
  const f = form(this);
  const n = notes(this);
  const before = await f.readValues();
  n.restore = { id: n.subject.id, location: before.location, about: before.about };
  n.changes = {};
  for (const row of table.hashes()) {
    const field = row.field;
    // eslint-disable-next-line no-await-in-loop
    if (/location/i.test(field)) n.changes.location = await f.selectFirstDifferentLocation(before.location);
    // eslint-disable-next-line no-await-in-loop
    else if (/about/i.test(field)) n.changes.about = await f.typeAbout(`Automation edit ${n.subject.id}.`);
    // eslint-disable-next-line no-await-in-loop
    else if (/cover/i.test(field)) n.changes.cover = (await f.uploadImage('Cover Photo', ...EDIT_COVER)).accepted;
    // eslint-disable-next-line no-await-in-loop
    else if (/profile/i.test(field)) n.changes.profile = (await f.uploadImage('Profile Photo', ...EDIT_LOGO)).accepted;
  }
  this.attach(`Changed: ${JSON.stringify(n.changes)} (restoring to ${JSON.stringify(n.restore)})`, 'text/plain');
});

Then('the community toast {string} should be displayed', async function (expected) {
  const actual = await community(this).toastText();
  this.attach(`Toast: "${actual}"`, 'text/plain');
  expect(actual, 'no toast appeared at all').toBeTruthy();
  expect(norm(actual).toLowerCase(), `AC 5.2 specifies "${expected}"`).toContain(lc(expected));
});

Then('the community toast {string} should not be displayed', async function (unwanted) {
  const actual = await community(this).toastText();
  expect(
    actual && lc(actual).includes(lc(unwanted)),
    `a failed save still showed the success toast "${actual}"`
  ).toBeFalsy();
});

When('I reopen that community for editing', { timeout: 90000 }, async function () {
  await form(this).gotoEdit(notes(this).subject.id);
});

When('I reopen that community', { timeout: 90000 }, async function () {
  await community(this).gotoCommunity(notes(this).subject.id);
});

Then('every changed field should hold its new value', async function () {
  const values = await form(this).readValues();
  const changes = notes(this).changes || {};
  const failures = [];
  if (changes.location && lc(values.location) !== lc(changes.location)) {
    failures.push(`location holds "${values.location}", expected "${changes.location}" — the edit did not persist`);
  }
  if (changes.about && norm(values.about) !== norm(changes.about)) {
    failures.push(`about holds "${values.about}", expected "${changes.about}" — the edit did not persist`);
  }
  if (changes.cover && !values.coverPreview) failures.push('the cover photo is missing after a reload');
  if (changes.profile && !values.profilePreview) failures.push('the profile photo is missing after a reload');
  reportFailures(this, 'Edits that did not survive a reload', failures, [`Read back: ${JSON.stringify(values)}`]);
});

When('I change the about university to {string}', async function (text) {
  const n = notes(this);
  if (n.subject && !n.restore) {
    n.restore = { id: n.subject.id, location: await form(this).locationInput.inputValue(), about: await form(this).aboutInput.inputValue() };
  }
  await form(this).typeAbout(text);
});

When('I leave the page without saving', { timeout: 60000 }, async function () {
  await community(this).gotoList();
});

Then('the about university should not be {string}', async function (text) {
  const value = await form(this).aboutInput.inputValue();
  expect(norm(value), 'an unsaved change was persisted').not.toBe(norm(text));
});

// SCOPED TO "About University" ON PURPOSE — do not widen it back to `{string} into {string}`.
//
// As a generic two-argument pattern this shadowed Invite-agent.feature's own
// `I enter "<value>" into "<one of an enumerated field list>"` (invite-agent.steps.js), and
// Cucumber does not prefer the narrower definition: it reported "Multiple matching step
// definitions found" and made FOUR Invite-agent scenarios ambiguous, which counts as neither
// a pass nor a failure and so went unnoticed in the summary.
//
// Scoping it here rather than renaming the other one is right on both counts: this body never
// used its `field` argument at all — it always typed into About University regardless of what
// it was handed — so the narrow pattern is what it actually implements, and Community.feature
// uses it in exactly one place, with that field.
// The field name is a NON-capturing group, and it has to be. As `(About University)` it captured
// a second argument that this body does not declare, which Cucumber silently ignores but
// playwright-bdd rejects at generation time ("Function has 1 argument, but expected 2") - so the
// whole suite failed to generate for a step that had been working for months. `(?:...)` keeps the
// pattern matching exactly the same strings, and therefore keeps the scoping the note above
// describes, while yielding the one argument the body uses.
When(/^I enter "([^"]*)" into "(?:About University)"$/, async function (text) {
  notes(this).enteredAbout = text;
  await form(this).typeAbout(text);
});

// ============================================================================
// Community page — header
// ============================================================================

When('I open that community', { timeout: 60000 }, async function () {
  await community(this).gotoCommunity(notes(this).subject.id);
});

Then('the community header should show the following elements:', async function (table) {
  const header = await community(this).readHeader();
  notes(this).header = header;
  const cards = await community(this).readMemberCards();
  const failures = [];
  for (const row of table.hashes()) {
    const element = row.element;
    const ok = {
      'Cover Photo': header.images >= 2,
      'University Cover Image': header.images >= 2,
      'Profile Picture': header.images >= 1,
      'University Profile Image': header.images >= 1,
      'University Name': !!header.name,
      'About University': header.description !== null,
      'University Description': header.description !== null,
      'Member Count': header.memberCount !== null,
      'Total Member Count': header.memberCount !== null,
      Location: !!header.location,
      'University Location': !!header.location,
      'Edit Community CTA': header.hasEditCta,
    }[element];
    if (ok === undefined) failures.push(`unknown element "${element}" in the table`);
    else if (!ok) failures.push(`the header is missing: ${element}`);
  }
  reportFailures(this, 'Community header elements', failures, [
    `Header read: ${JSON.stringify(header)}\nMembers listed: ${cards.length}`,
  ]);
});

Then('the header member count should read as {string}', async function (format) {
  const header = notes(this).header || (await community(this).readHeader());
  expect(
    header.memberText && /^\d[\d,]*\s*Members?$/i.test(header.memberText),
    `AC 6.1 specifies the "${format}" format; the header read "${header.memberText}"`
  ).toBeTruthy();
});

Then("the header should show that community's configured university name, location and description", async function () {
  const header = await community(this).readHeader();
  const subject = notes(this).subject;
  const failures = [];
  if (lc(header.name) !== lc(subject.name)) failures.push(`name: header "${header.name}" vs configured "${subject.name}"`);
  if (subject.location && lc(header.location) !== lc(subject.location)) {
    failures.push(`location: header "${header.location}" vs configured "${subject.location}"`);
  }
  if (subject.description != null && norm(header.description) !== norm(subject.description)) {
    failures.push(`description: header "${header.description}" vs configured "${subject.description}"`);
  }
  reportFailures(this, 'Header values that do not match this community', failures);
});

Then('the header university name should be the one on the card I clicked', async function () {
  const header = await community(this).readHeader();
  expect(lc(header.name), 'the header names a different community than the card that was clicked').toBe(lc(notes(this).subject.name));
});

Then('the header description should be {string}', async function (expected) {
  const header = await community(this).readHeader();
  // The end-to-end scenario enters a padded string on purpose — the AC implies storage is
  // trimmed, and only comparing against the trimmed form can catch a build that stores the
  // padding and renders it back.
  expect(norm(header.description), 'the stored description (entered padded, so this also checks it was trimmed)').toBe(norm(expected));
});

Then('the header location should be the location I selected second', async function () {
  const header = await community(this).readHeader();
  expect(lc(header.location), 'the header location after the edit').toBe(lc(notes(this).newLocation));
});

Then('the community header should show its university name', async function () {
  const header = await community(this).readHeader();
  expect(header.name, 'the header shows no university name').toBeTruthy();
});

Then('the community header should show its location', async function () {
  const header = await community(this).readHeader();
  expect(header.location, 'the header shows no location').toBeTruthy();
});

// A community with no description must degrade cleanly — not render "undefined", "null" or an
// empty quoted block, which is what an unguarded template does.
Then('the header should not display a broken or placeholder description', async function () {
  const header = await community(this).readHeader();
  const bad = ['undefined', 'null', 'NaN', '[object Object]'].filter((t) => new RegExp(t, 'i').test(header.description || ''));
  this.attach(`Description rendered as: ${JSON.stringify(header.description)}`, 'text/plain');
  expect(bad, `the header rendered a broken description: ${bad.join(', ')}`).toHaveLength(0);
});

Given('I have noted the member count on the first community card', { timeout: 60000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  notes(this).subject = cards[0];
  this.attach(`Card "${cards[0].name}" reads "${cards[0].memberText}"`, 'text/plain');
});

Given('I have noted the name and member count of the first community card', { timeout: 60000 }, async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
  notes(this).subject = cards[0];
  this.attach(`Card "${cards[0].name}" (id ${cards[0].id}) reads "${cards[0].memberText}"`, 'text/plain');
});

Then('the header member count should equal the count on its listing card', async function () {
  const header = await community(this).readHeader();
  const card = notes(this).subject;
  notes(this).header = header;
  expect(
    header.memberCount,
    `the listing card for "${card.name}" says ${card.memberCount} members, the header says ${header.memberCount}`
  ).toBe(card.memberCount);
});

Then('the header member count should equal the number of candidate cards listed across every page', { timeout: 180000 }, async function () {
  const header = notes(this).header || (await community(this).readHeader());
  const all = await community(this).collectAllPages(() => community(this).readMemberCards());
  const walk = community(this).lastWalk;
  this.attach(
    `Header says ${header.memberCount}; ${all.length} candidate card(s) were listed across every page.\n`
    + `Page walk: ${community(this).walkSummary()}\n`
    + `${all.map((c) => c.name).join(', ')}`,
    'text/plain'
  );
  // THE WALK'S COMPLETENESS IS ASSERTED BEFORE THE COUNT. "Across every page" is a claim about
  // coverage, and a truncated walk makes the comparison meaningless in BOTH directions — it can
  // manufacture a mismatch, and it can hide one. Until 2026-08-03 the next-page locator matched
  // nothing, so this step compared the header against page ONE and reported the result as a
  // whole-list count; asserting the walk is what stops that being silent a second time.
  expect(
    walk && walk.complete,
    `the member list could not be walked to the end, so "across every page" was not measured — ${community(this).walkSummary()}`
  ).toBeTruthy();
  expect(
    all.length,
    `the header claims ${header.memberCount} members but ${all.length} were listed (${community(this).walkSummary()})`
  ).toBe(header.memberCount);
});

Then('the header member count should read {string}', async function (expected) {
  const header = await community(this).readHeader();
  expect(norm(header.memberText), 'the header member count').toBe(norm(expected));
});

// Finding a subject rather than creating one: DEV carries several 0-member communities and
// several with no description, so neither scenario needs to consume a university.
// The listing card's count CANNOT be trusted to pick this subject, and that is not a
// hypothetical: the card-vs-header disagreement is a live defect this suite already reports
// (§8.2, @known-issue — "Al Asala College" reads 6 on its card and 10 in its header). Choosing
// on the card alone picked a community whose card said 0 and whose header said 2, and the
// scenario then failed on the count instead of on the empty state it exists to assert —
// collateral damage from a defect another scenario already owns.
//
// So each 0-member candidate is OPENED and confirmed against the community page itself, which
// is the view the scenario goes on to assert. Candidates are tried in order and the rejects are
// reported, so "no empty community exists" and "the listing is lying about several" look
// different in the report.
Given('I have found a community with no members', { timeout: 240000 }, async function () {
  const found = await community(this).collectAllPages(() => community(this).readCards(), 12);
  const claimEmpty = found.filter((c) => c.memberCount === 0);
  if (!claimEmpty.length) return manual();

  const rejected = [];
  for (const card of claimEmpty.slice(0, 8)) {
    // eslint-disable-next-line no-await-in-loop
    await community(this).gotoCommunity(card.id);
    // eslint-disable-next-line no-await-in-loop
    const header = await community(this).readHeader();
    // eslint-disable-next-line no-await-in-loop
    const members = await community(this).readMemberCards();
    if (header.memberCount === 0 && members.length === 0) {
      notes(this).subject = card;
      this.attach(
        `Using "${card.name}" (id ${card.id}): card 0, header ${header.memberCount}, `
        + `${members.length} member card(s).`
        + (rejected.length ? `\nRejected first: ${rejected.join('; ')}` : ''),
        'text/plain'
      );
      return undefined;
    }
    rejected.push(`"${card.name}" (id ${card.id}) card says 0 but header says ${header.memberCount} `
      + `with ${members.length} member card(s)`);
  }

  this.attach(
    `${claimEmpty.length} community card(s) claim 0 members, but none of the ${Math.min(claimEmpty.length, 8)} `
    + `checked is really empty:\n- ${rejected.join('\n- ')}`,
    'text/plain'
  );
  return manual();
});

Given('I have found a community with no About University text', { timeout: 240000 }, async function () {
  // 16 pages, not 6. The listing holds 127 communities over 11 pages of 12, and this cap was set
  // while the next-page locator was broken — so it was never reached and 6 looked generous. It is
  // now a real bound: at 6 this fixture-finder would search 72 of 127 and report "no community has
  // an empty description" as though it had looked at all of them. Headroom for the list growing.
  const cards = await community(this).collectAllPages(() => community(this).readCards(), 16);
  for (const card of cards.slice(0, 25)) {
    // eslint-disable-next-line no-await-in-loop
    await community(this).gotoCommunity(card.id);
    // eslint-disable-next-line no-await-in-loop
    const header = await community(this).readHeader();
    if (!norm(header.description)) {
      notes(this).subject = { ...card, location: header.location, description: header.description };
      this.attach(`Using "${card.name}" (id ${card.id}), which has no description.`, 'text/plain');
      return undefined;
    }
  }
  // Nothing on DEV matches, so the scenario cannot run honestly. Pending beats a false pass.
  return manual();
});

// ============================================================================
// Members — search
// ============================================================================

// Picks a community with enough members rather than assuming the first one has any, so the
// scenario cannot go green having asserted nothing.
async function openCommunityWithMembers(world, minimum) {
  const c = community(world);
  if (c.isOnCommunity()) {
    const here = await c.readMemberCards();
    if (here.length >= minimum) return here;
  }
  await c.gotoList();
  // 16 pages for the same reason as the no-description finder above: the cap was unreachable while
  // the next-page locator was broken, and at 6 this would pick "the community with the most members"
  // out of the first 72 of 127 — which is a different community than the one it claims to choose.
  const cards = await c.collectAllPages(() => c.readCards(), 16);
  const candidates = cards.filter((x) => (x.memberCount || 0) >= minimum).sort((a, b) => b.memberCount - a.memberCount);
  if (!candidates.length) return null;
  await c.gotoCommunity(candidates[0].id);
  notes(world).subject = candidates[0];
  const members = await c.readMemberCards();
  return members.length >= minimum ? members : null;
}

Given('I am on a community that has at least {int} member', { timeout: 240000 }, async function (n) {
  const members = await openCommunityWithMembers(this, n);
  if (!members) return manual();
  notes(this).members = members;
  this.attach(`On "${notes(this).subject.name}" with ${members.length} member(s) listed.`, 'text/plain');
  return undefined;
});

Given('I am on a community that has at least {int} members', { timeout: 240000 }, async function (n) {
  const members = await openCommunityWithMembers(this, n);
  if (!members) return manual();
  notes(this).members = members;
  this.attach(`On "${notes(this).subject.name}" with ${members.length} member(s) listed.`, 'text/plain');
  return undefined;
});

Given('I have noted the name of the first member', async function () {
  const members = notes(this).members || (await community(this).readMemberCards());
  expect(members.length, 'no members are listed').toBeGreaterThan(0);
  notes(this).member = members[0];
  this.attach(`Noted member "${members[0].name}"`, 'text/plain');
});

// DELETED 2026-08-03, with the scenario that was their only caller — see the note in the feature
// file at §9. Searching the member list by Major is NOT a capability of this search (TFF-330 was
// dropped), so the scenario asserting it was permanently red against an AC nobody intends to
// deliver:
//   Given I have noted the major of the first member
//   When  I search the members for that major
//   Then  that member should be listed
//   And   every listed candidate card should show that major
// A step definition nothing calls is dead weight that still has to be read and maintained — the
// same reason four steps went with the AC-1 overview scenario on 2026-08-02.
//
// `I have noted the major and track of the first member` below is KEPT: the candidate feature file
// still names it (currently commented out in full), and it feeds that portal's own
// name/major/track search scenario rather than this one.
Given('I have noted the major and track of the first member', { timeout: 60000 }, async function () {
  const details = await community(this).readMemberDetails();
  const cards = await community(this).readMemberCards();
  expect(details.length, 'no members are listed').toBeGreaterThan(0);
  const d = details.find((x) => x.major) || details[0];
  const card = cards.find((c) => lc(c.name) === lc(d.name)) || cards[0];
  notes(this).member = { ...d, track: card ? card.track : null };
  this.attach(`Noted "${d.name}": major "${d.major}", track "${notes(this).member.track}"`, 'text/plain');
});

Given('I have noted the name, major and track of the first member', { timeout: 60000 }, async function () {
  const details = await community(this).readMemberDetails();
  const cards = await community(this).readMemberCards();
  expect(cards.length, 'no members are listed').toBeGreaterThan(0);
  const card = cards[0];
  const d = details.find((x) => lc(x.name) === lc(card.name)) || details[0] || {};
  notes(this).member = { name: card.name, major: d.major, track: card.track };
  this.attach(`Noted "${card.name}": major "${d.major}", track "${card.track}"`, 'text/plain');
});

When('I search the members for each of the following:', { timeout: 180000 }, async function (table) {
  const member = notes(this).member;
  const results = [];
  for (const row of table.hashes()) {
    const rule = row["variation of that member's name"] || row.rule;
    const term = nameVariation(member.name, rule);
    // eslint-disable-next-line no-await-in-loop
    await community(this).searchMembers(term);
    // eslint-disable-next-line no-await-in-loop
    const cards = await community(this).readMemberCards();
    results.push({ rule: row.rule, term, listed: cards.some((c) => lc(c.name) === lc(member.name)), cards });
  }
  notes(this).memberSearchResults = results;
  notes(this).lastSearchTerm = results.length ? results[results.length - 1].term : null;
  this.attach(results.map((r) => `${r.rule}: "${r.term}" -> ${r.cards.length} card(s), subject ${r.listed ? 'listed' : 'MISSING'}`).join('\n'), 'text/plain');
});

Then('that member should be listed for every one of them', async function () {
  const member = notes(this).member;
  const misses = (notes(this).memberSearchResults || []).filter((r) => !r.listed);
  reportFailures(
    this,
    `Member searches that failed to find "${member.name}"`,
    misses.map((r) => `${r.rule}: searching "${r.term}" returned ${r.cards.length} card(s) and not the subject`)
  );
});

// The list must be genuinely FILTERED, not merely re-rendered — TFF-284 was a search that
// responded to nothing at all, and a list that returns everything looks identical to one that
// returns the right thing when the community has only one member.
Then('every listed candidate card should match the search term', async function () {
  const results = notes(this).memberSearchResults || [];
  const last = results[results.length - 1];
  const cards = last ? last.cards : await community(this).readMemberCards();
  const term = lc(last ? last.term : notes(this).lastSearchTerm || '');
  const strays = cards.filter((c) => !lc(c.text).includes(term));
  reportFailures(
    this,
    `Cards listed that do not match "${term}"`,
    strays.map((c) => `"${c.name}"`)
  );
});

// DELETED 2026-08-10 — THEY ASSERTED A CAPABILITY THE PRODUCT HAS DECIDED NOT TO HAVE:
//   When I search the members for that major and for that track in turn
//   Then that member should be listed for both of them
// The second one failed with "AC 5.2 requires the member search to match Candidate Name, Major AND
// Track Name", and AC 5.2 is wrong: name-only matching is intended and TFF-330 is WON'T DO. Their
// only remaining callers were three COMMENTED-OUT lines in the candidate feature file, which is
// exactly how a forbidden expectation gets resurrected — someone uncomments that file and the suite
// starts demanding major search again. Those lines were rewritten to the name-only rule at the same
// time. `I have noted the major and track of the first member` is KEPT: the candidate file still
// names it, and reading a member's fields is fine — it was asserting that searching them WORKS that
// was wrong.
//
// The enforcement now lives in `Verify that the member search does not match a candidate's Major`,
// which asserts the opposite: a Major must find NOBODY.

// ==================== Member search: name-only is the RULE ====================
//
// NAME-ONLY MATCHING IS INTENDED, so the suite's job here is to ENFORCE it, not to report it as a
// gap. TFF-330 (search by Major) is WON'T DO — PO-confirmed 2026-08-03, reconfirmed 2026-08-10 — and
// AC 5.2 / AC 6.2, which both promise Major, are the things that are wrong.
//
// THIS REPLACED A SINGLE STEP THAT COMPARED THE PLACEHOLDER AGAINST THE BEHAVIOUR and passed as long
// as the two agreed. That was the right design while the product decision was open, and it is the
// wrong one now: it would have gone GREEN if someone had added major search, which is precisely the
// regression the product decision forbids. The rule and the copy are now asserted separately —
// searching by Major must find nobody (this pair of steps, green), and the placeholder must not
// mention Major (below, red until dev change the copy).
Given('I have noted the Major of a member who holds one', { timeout: 60000 }, async function () {
  const cards = await community(this).readMemberCards();
  expect(cards.length, 'no members are listed').toBeGreaterThan(0);
  // A member who genuinely HOLDS a major, so "the search found nobody" cannot be explained by there
  // having been nothing to search for. '—' is what a card renders for an empty field.
  const subject = cards.find((m) => m.name && m.major && m.major !== '—');
  expect(
    subject,
    'no listed member holds a Major, so the name-only rule cannot be exercised here. Members: '
    + cards.map((c) => `"${c.name}" major "${c.major}"`).join(', ')
  ).toBeTruthy();
  notes(this).member = subject;
  this.attach(`Subject "${subject.name}" — major "${subject.major}"`, 'text/plain');
});

When('I search the members for that Major', { timeout: 60000 }, async function () {
  const m = notes(this).member;
  await community(this).searchMembers(m.major);
  notes(this).lastSearchTerm = m.major;
  notes(this).memberSearchCards = await community(this).readMemberCards();
  this.attach(
    `Searched the members for the Major "${m.major}" -> ${notes(this).memberSearchCards.length} card(s): `
    + `${notes(this).memberSearchCards.map((c) => `"${c.name}"`).join(', ') || 'none'}`,
    'text/plain'
  );
});

Then('that member should not be listed', async function () {
  const m = notes(this).member;
  const cards = notes(this).memberSearchCards || (await community(this).readMemberCards());
  const hit = cards.find((c) => lc(c.name) === lc(m.name));
  expect(
    hit,
    `searching for the Major "${notes(this).lastSearchTerm}" returned "${m.name}". Major is NOT a `
    + 'searchable field — the member search matches the candidate name only, and TFF-330 is WON\'T DO — '
    + `so a Major must match nobody. ${cards.length} card(s) came back: `
    + `${cards.map((c) => `"${c.name}"`).join(', ')}`
  ).toBeFalsy();
});

// THE CONTROL. Without it a search box that matched NOTHING would satisfy the assertion above and
// pass — and that is not hypothetical: TFF-284 was a member search that responded to no input at all.
When("I search the members for that member's name", { timeout: 60000 }, async function () {
  const m = notes(this).member;
  await community(this).searchMembers(m.name);
  notes(this).lastSearchTerm = m.name;
  notes(this).memberSearchCards = await community(this).readMemberCards();
});

Then('that member should be listed by name', async function () {
  const m = notes(this).member;
  const cards = notes(this).memberSearchCards || (await community(this).readMemberCards());
  expect(
    cards.some((c) => lc(c.name) === lc(m.name)),
    `the CONTROL failed: searching for the name "${m.name}" did not return that member, so this run `
    + 'proves nothing about Major — the search is matching nothing at all. '
    + `${cards.length} card(s) came back: ${cards.map((c) => `"${c.name}"`).join(', ') || 'none'}`
  ).toBeTruthy();
});

// THE PLACEHOLDER IS A PROMISE TO THE USER, and it is the last Major-related defect on this screen.
// FAILS ON PURPOSE: live the field reads "Search by candidate name or major..." while Major is not
// searchable, so it invites a search the product will never support. The fix is dev dropping
// "or major" from the copy — there is nothing to change on the suite side.
//
// It pins the RULE ("name, and no other field"), not an exact string. A reworded placeholder that
// still says name-only — "Search candidates by name…" — passes, so ordinary copy edits do not turn
// this red; only re-advertising an unsearchable field does.
Then('the member search placeholder should offer a search by candidate name only', async function () {
  const placeholder = await community(this).memberSearchPlaceholder();
  expect(placeholder, 'the member search field has no placeholder at all').toBeTruthy();

  const failures = [];
  if (!/name/i.test(placeholder)) {
    failures.push(`it does not mention the candidate name, which is the one field the search matches: "${placeholder}"`);
  }
  // Every field the card renders but the search does NOT match. A placeholder naming any of them is
  // making a promise the search cannot keep.
  const UNSEARCHABLE = ['major', 'track', 'email', 'phone', 'university', 'location', 'graduation'];
  for (const field of UNSEARCHABLE.filter((f) => new RegExp(`\\b${f}`, 'i').test(placeholder))) {
    failures.push(
      `it invites a search by ${field}, which the search does not match — the member search matches `
      + `the candidate NAME only. Drop it from the copy: "${placeholder}"`
    );
  }
  reportFailures(this, 'Member search placeholder', failures, [`Placeholder: "${placeholder}"`]);
});

When('I search the members for {string}', { timeout: 60000 }, async function (term) {
  await community(this).searchMembers(term);
  notes(this).lastSearchTerm = term;
});

When('I search the members for a fragment shared by several members', { timeout: 60000 }, async function () {
  const members = await community(this).readMemberCards();
  // The longest common leading fragment across two names, or a single letter as a floor.
  const names = members.map((m) => lc(m.name)).filter(Boolean);
  let fragment = 'a';
  for (let len = 4; len >= 1; len -= 1) {
    const counts = {};
    for (const n of names) {
      const key = n.slice(0, len);
      counts[key] = (counts[key] || 0) + 1;
    }
    const shared = Object.entries(counts).find(([, c]) => c > 1);
    if (shared) {
      [fragment] = shared;
      break;
    }
  }
  notes(this).lastSearchTerm = fragment;
  await community(this).searchMembers(fragment);
  this.attach(`Searched members for the shared fragment "${fragment}"`, 'text/plain');
});

When("I search the members for a fragment of that member's name", { timeout: 60000 }, async function () {
  const fragment = norm(notes(this).member.name).split(/\s+/)[0];
  notes(this).lastSearchTerm = fragment;
  await community(this).searchMembers(fragment);
  const cards = await community(this).readMemberCards();
  notes(this).memberSearchResults = [{ rule: 'a fragment of the name', term: fragment, listed: cards.some((c) => lc(c.name) === lc(notes(this).member.name)), cards }];
});

// Used by the candidate end-to-end journey right after the fragment search above. It was deleted
// on 2026-08-03 with the search-by-Major scenarios, but that journey still calls it - so under
// Cucumber the whole journey reported `undefined` and never ran. It reads the evidence the
// preceding search step recorded, so it cannot pass on a search that returned someone else.
Then('that member should be listed', async function () {
  const m = notes(this).member;
  const last = (notes(this).memberSearchResults || []).slice(-1)[0];
  expect(last, 'no member search was recorded before this step').toBeTruthy();
  expect(
    last.listed,
    `searching the members for "${last.term}" did not return "${m.name}". `
    + `${last.cards.length} card(s) came back: ${last.cards.map((c) => `"${c.name}"`).join(', ') || 'none'}`
  ).toBe(true);
});

Then('no candidate cards should be listed', async function () {
  const cards = await community(this).readMemberCards();
  expect(cards, `expected no candidate cards, got: ${cards.map((c) => c.name).join(', ')}`).toHaveLength(0);
});

When('I clear the member search', async function () {
  await community(this).clearMemberSearch();
});

Then('the member search field should be empty', async function () {
  const value = await community(this).memberSearchInput.inputValue();
  expect(value, 'TFF-356: "Clear all filters" must clear the search input too').toBe('');
});

Then('the member search field should still hold that fragment', async function () {
  const value = await community(this).memberSearchInput.inputValue();
  expect(
    norm(value),
    `AC 6.3 requires the search to persist across a refresh; the field held "${value}" instead of "${notes(this).lastSearchTerm}"`
  ).toBe(norm(notes(this).lastSearchTerm));
});

Then('all members should be listed again', async function () {
  const cards = await community(this).readMemberCards();
  expect(cards.length, 'clearing the search/filters left no members listed').toBeGreaterThan(0);
});

// ============================================================================
// Filters
// ============================================================================

Then('the following filters should be offered and allow multiple selections:', { timeout: 120000 }, async function (table) {
  const failures = [];
  const seen = [];
  for (const row of table.hashes()) {
    const name = row.filter;
    try {
      // eslint-disable-next-line no-await-in-loop
      await community(this).openFilter(name);
      // eslint-disable-next-line no-await-in-loop
      const read = await community(this).readOpenFilterOptions();
      seen.push(`${name} (rendered as "${CommunityPage.filterLabel(name)}"): ${read.options.length} option(s), shape ${read.shape}, multi-select ${read.multiSelect}`);
      if (!read.options.length) failures.push(`"${name}" offered no options`);
      if (!read.multiSelect) failures.push(`"${name}" is not multi-select (AC 7 specifies a multi-select dropdown)`);
    } catch (err) {
      failures.push(`"${name}" could not be opened: ${err.message.split('\n')[0]}`);
    }
  }
  await community(this).closeAnyPopover();
  reportFailures(this, 'Filter panel problems', failures, [seen.join('\n')]);
});

When('I open the {string} filter', { timeout: 60000 }, async function (name) {
  await community(this).openFilter(name);
  notes(this).openFilter = await community(this).readOpenFilterOptions();
  notes(this).openFilterName = name;
  // The unsearched list, kept so the search steps can assert that searching NARROWED it and that
  // clearing restored it. Both are meaningless without a baseline, and the popover is closed by
  // the time any later step could go back for one.
  notes(this).filterOptionsBefore = notes(this).openFilter.options;
});

// ============================================================================
// The filter popover's own search box (Majors only)
// ============================================================================

Then('the {string} filter should offer a search box of its own', async function (name) {
  const read = notes(this).openFilter || (await community(this).readOpenFilterOptions());
  this.attach(
    `The "${name}" popover renders ${read.count} option(s) as ${read.shape}, own search box: ${read.hasOwnSearch}.\n`
    + 'The list is capped at ten, so this box is the only route to the rest of the Field of Study values.',
    'text/plain'
  );
  expect(read.hasOwnSearch, `the "${name}" filter popover has no search box`).toBeTruthy();
});

// The term is derived from a REAL option so "the list narrowed" can be told apart from "the list
// emptied", and it is deliberately a SINGLE WORD: the search tokenises on whitespace and requires
// each token to appear anywhere in the option, so a multi-token fragment legitimately returns
// options that do not contain the term as typed. That behaviour has its own @known-issue scenario;
// exercising it here would make this one red for a second, unrelated reason.
When('I search the open filter for a word from the first option', { timeout: 60000 }, async function () {
  const before = notes(this).filterOptionsBefore || [];
  expect(before.length, 'the filter offered nothing to derive a search term from').toBeGreaterThan(0);
  const words = norm(before[0]).split(/\s+/).filter(Boolean);
  const longest = words.sort((a, b) => b.length - a.length)[0] || before[0];
  const word = longest.slice(0, Math.min(4, longest.length));
  notes(this).filterWord = word;
  notes(this).filterSearch = await community(this).searchInOpenFilter(word);
  notes(this).filterSearchLower = notes(this).filterSearch;
  this.attach(
    `Derived "${word}" from the first option "${before[0]}" -> ${notes(this).filterSearch.count} of ${before.length} `
    + `option(s): ${JSON.stringify(notes(this).filterSearch.options)}`,
    'text/plain'
  );
});

When('I search the open filter for that word in upper case', { timeout: 60000 }, async function () {
  const word = notes(this).filterWord;
  expect(word, 'no search word was recorded').toBeTruthy();
  notes(this).filterSearch = await community(this).searchInOpenFilter(word.toUpperCase());
});

When('I search the open filter for a fragment from the middle of that word', { timeout: 60000 }, async function () {
  const word = notes(this).filterWord;
  const source = norm((notes(this).filterOptionsBefore || [''])[0]).split(/\s+/).sort((a, b) => b.length - a.length)[0] || word;
  // Start one character in, so this is genuinely a substring rather than the prefix already tried.
  const fragment = source.slice(1, Math.min(5, source.length));
  expect(fragment.length, `"${source}" is too short to take a mid-word fragment from`).toBeGreaterThan(1);
  notes(this).filterSearch = await community(this).searchInOpenFilter(fragment);
  this.attach(`Mid-word fragment "${fragment}" of "${source}" -> ${JSON.stringify(notes(this).filterSearch.options)}`, 'text/plain');
});

When('I search the open filter for {string}', { timeout: 60000 }, async function (term) {
  notes(this).filterSearch = await community(this).searchInOpenFilter(term);
});

When("I clear the open filter's search box", { timeout: 60000 }, async function () {
  await community(this).clearOpenFilterSearch();
  notes(this).filterSearch = null;
  notes(this).filterOptionsAfterClear = (await community(this).readOpenFilterOptions()).options;
});

Then('fewer options should be offered than before the search', async function () {
  const before = (notes(this).filterOptionsBefore || []).length;
  const now = notes(this).filterSearch.count;
  expect(
    now,
    `searching for "${notes(this).filterSearch.term}" left ${now} option(s) of ${before} — the search did not narrow the list`
  ).toBeLessThan(before);
  expect(now, `searching for "${notes(this).filterSearch.term}" left nothing, so nothing was narrowed`).toBeGreaterThan(0);
});

Then('every option offered should contain what was searched for', async function () {
  const r = notes(this).filterSearch;
  const strays = (r.options || []).filter((o) => !lc(o).includes(lc(r.term)));
  reportFailures(
    this,
    `Options offered for "${r.term}" that do not contain it`,
    strays.map((o) => `"${o}"`),
    [`Searched "${r.term}" -> ${JSON.stringify(r.options)}`]
  );
});

// Client-side filtering is worth pinning down: if it were server-side, every keystroke would be a
// request against a list this popover already holds, and the assertion above would be measuring
// the backend's matching rather than the control's.
Then('the search should have filtered the options without issuing a request', async function () {
  const r = notes(this).filterSearch;
  expect(
    r.issuedRequest,
    `searching the filter popover issued a member-list request; it filters the options it already holds`
  ).toBeFalsy();
});

Then('the same options should be offered as for the lower-case word', async function () {
  const lower = notes(this).filterSearchLower;
  const upper = notes(this).filterSearch;
  this.attach(`"${lower.term}" -> ${JSON.stringify(lower.options)}\n"${upper.term}" -> ${JSON.stringify(upper.options)}`, 'text/plain');
  expect(upper.options.map(lc).sort(), `"${upper.term}" should match the same options as "${lower.term}"`)
    .toEqual(lower.options.map(lc).sort());
});

Then('no options should be offered', async function () {
  const r = notes(this).filterSearch;
  expect(r.options, `searching for "${r.term}" still offered: ${JSON.stringify(r.options)}`).toHaveLength(0);
});

// The popover's own message, read from inside the popover. The PAGE also renders a
// "No results found" for an empty member list, and reading one for the other would report the
// wrong surface — which is why readEmptyState() excludes the popover and this reader is scoped to
// it. The trailing full stop the app adds ("No results found.") is normalised away rather than
// failed on, the same treatment the search placeholder's ellipsis gets.
Then('the filter popover should report {string}', async function (expected) {
  const state = notes(this).filterSearch
    ? notes(this).filterSearch.emptyState
    : await community(this).readFilterPopoverEmptyState();
  this.attach(`Popover reads: ${JSON.stringify(state.popoverText)}`, 'text/plain');
  expect(state.present, `the popover showed no empty-state message at all; it read "${state.popoverText}"`).toBeTruthy();
  expect(norm(state.message).replace(/[.…]+$/, '').toLowerCase(), 'the popover empty-state message').toBe(lc(expected));
});

Then('every option offered before the search should be offered again', async function () {
  const before = notes(this).filterOptionsBefore || [];
  const after = notes(this).filterOptionsAfterClear || [];
  const missing = before.filter((o) => !after.some((a) => lc(a) === lc(o)));
  reportFailures(
    this,
    'Options that did not come back after the search box was cleared',
    missing.map((o) => `"${o}"`),
    [`Before: ${JSON.stringify(before)}\nAfter clearing: ${JSON.stringify(after)}`]
  );
});

// Every row is searched and every verdict kept, so the report shows which terms behave and which
// do not rather than stopping at the first stray. That contrast is the finding: single-token terms
// are clean, multi-token ones are not.
When('I search the open filter for each of the following:', { timeout: 180000 }, async function (table) {
  const results = [];
  for (const row of table.hashes()) {
    // eslint-disable-next-line no-await-in-loop
    const r = await community(this).searchInOpenFilter(row.term);
    results.push({ term: row.term, options: r.options, strays: r.options.filter((o) => !lc(o).includes(lc(row.term))) });
  }
  notes(this).filterSearches = results;
  this.attach(
    results.map((r) => `"${r.term}" -> ${r.options.length} option(s): ${JSON.stringify(r.options)}`
      + (r.strays.length ? `\n    STRAY: ${JSON.stringify(r.strays)}` : '')).join('\n'),
    'text/plain'
  );
});

Then('every option offered should have contained the term that was searched for', async function () {
  const results = notes(this).filterSearches || [];
  expect(results.length, 'no filter searches were performed').toBeGreaterThan(0);
  const failures = [];
  for (const r of results) {
    for (const stray of r.strays) {
      failures.push(`searching "${r.term}" offered "${stray}", which does not contain it`);
    }
  }
  reportFailures(this, 'Options offered that do not match the term typed', failures, [
    'Measured mechanism (2026-08-03): the search splits the term on whitespace and requires each\n'
    + 'token to appear anywhere in the option, in any order — so "AI p" offers "Supply Chain\n'
    + 'Management" (ch-AI-n, su-P-ply) and "ing acc" offers "Accounting". Single-token terms are\n'
    + 'unaffected. No AC covers this search box; confirm with the PO whether token-wise matching is\n'
    + 'intended before filing.',
  ]);
});

Then('every option offered should contain every token from the search term', async function () {
  const results = notes(this).filterSearches || [];
  expect(results.length, 'no filter searches were performed').toBeGreaterThan(0);
  const failures = [];
  for (const result of results) {
    const tokens = result.term.toLowerCase().split(/\s+/).filter(Boolean);
    for (const option of result.options) {
      const missing = tokens.filter((token) => !option.toLowerCase().includes(token));
      if (missing.length) {
        failures.push(`searching "${result.term}" offered "${option}", missing token(s): ${missing.join(', ')}`);
      }
    }
  }
  reportFailures(this, 'Majors options missing a typed search token', failures);
});

Then('the filter should offer every year from {string} to {string}', async function (from, to) {
  const options = (notes(this).openFilter || {}).options || [];
  const years = options.map((o) => Number(o)).filter((y) => Number.isFinite(y));
  const wanted = [];
  for (let y = Number(from); y <= Number(to); y += 1) wanted.push(y);
  const missing = wanted.filter((y) => !years.includes(y));
  const extra = years.filter((y) => y < Number(from) || y > Number(to));
  this.attach(`Graduation Year offered: ${options.join(', ')}`, 'text/plain');
  const failures = [];
  if (missing.length) failures.push(`missing years: ${missing.join(', ')}`);
  if (extra.length) failures.push(`TFF-283: years outside ${from}-${to} were offered: ${extra.join(', ')}`);
  reportFailures(this, 'Graduation Year range', failures);
});

Then('the filter should offer exactly {int} options', async function (count) {
  const options = (notes(this).openFilter || {}).options || [];
  expect(options.length, `the "${notes(this).openFilterName}" filter offered: ${options.join(', ')}`).toBe(count);
});

Then('the filter should offer exactly the options {string} and {string}', async function (a, b) {
  const options = ((notes(this).openFilter || {}).options || []).map(norm);
  expect(options.sort(), `the "${notes(this).openFilterName}" filter`).toEqual([a, b].map(norm).sort());
});

Then('the filter should offer options sourced from the configured Field of Study list', async function () {
  const options = (notes(this).openFilter || {}).options || [];
  this.attach(`Majors offered ${options.length}: ${options.slice(0, 30).join(', ')}${options.length > 30 ? ' …' : ''}`, 'text/plain');
  expect(options.length, 'the Majors filter offered no options, so it is not populated from Configuration').toBeGreaterThan(0);
});

// TFF-334 §6.1 says "values based on available graduation years" rather than a fixed range, so
// this file asserts plausibility rather than TFF-264's 2015-2032. Keeping the two assertions
// apart is what lets the two feature files disagree if the builds ever do.
Then('every year offered should be a plausible graduation year', async function () {
  const options = (notes(this).openFilter || {}).options || [];
  const years = options.map((o) => Number(o));
  const bad = options.filter((o, i) => !Number.isInteger(years[i]) || years[i] < 1950 || years[i] > 2100);
  this.attach(`Grad Year offered: ${options.join(', ')}`, 'text/plain');
  expect(options.length, 'the Grad Year filter offered no options').toBeGreaterThan(0);
  reportFailures(this, 'Implausible graduation years offered', bad.map((o) => `"${o}"`));
});

// AC 7.2 sources this from Configuration. A list offering the same value twice under different
// casing means filtering for one silently excludes members carrying the other.
Then('the filter should offer no option twice, ignoring case and surrounding spaces', async function () {
  const options = (notes(this).openFilter || {}).options || [];
  const seen = new Map();
  const dupes = [];
  for (const o of options) {
    const key = lc(o);
    if (seen.has(key)) dupes.push(`"${seen.get(key)}" and "${o}"`);
    else seen.set(key, o);
  }
  this.attach(`${options.length} option(s) offered; ${dupes.length} duplicate pair(s).`, 'text/plain');
  reportFailures(this, 'Duplicate options in the Majors filter (AC 7.2 sources it from Configuration)', dupes);
});

// THE one filter-loop driver. Applies the first option of each named filter on its own,
// clearing BETWEEN rows (which is what TFF-281 needs: Clear All did not appear when only ONE
// filter was applied), and records everything any assertion downstream needs from that single
// pass — request status, the resulting cards, whether "Something went wrong" appeared, and
// whether Clear All was offered and with what cursor.
//
// The LAST row is deliberately LEFT APPLIED. The merged scenario continues `When I click
// "Clear All"` / `Then no filter should be applied` / `...back to the noted count`; clearing
// after every row without exception left nothing on screen for that click, and the step timed
// out waiting for a control that had already done its job. Clearing between rows is what makes
// each row "on its own" — clearing after the final one serves nothing and breaks what follows.
When('I apply the first available option in each of the following filters in turn:', { timeout: 240000 }, async function (table) {
  const results = [];
  const rows = table.hashes();
  for (const [i, row] of rows.entries()) {
    const isLast = i === rows.length - 1;
    const name = row.filter;
    try {
      // eslint-disable-next-line no-await-in-loop
      await community(this).openFilter(name);
      // eslint-disable-next-line no-await-in-loop
      const applied = await community(this).selectFilterOption(0);
      // eslint-disable-next-line no-await-in-loop
      await community(this).closeAnyPopover();
      // eslint-disable-next-line no-await-in-loop
      const body = await community(this).bodyText();
      // eslint-disable-next-line no-await-in-loop
      const cards = await community(this).readMemberCards();
      // eslint-disable-next-line no-await-in-loop
      const clearAll = await community(this).clearAllControl().count();
      // eslint-disable-next-line no-await-in-loop
      const cursor = clearAll ? await community(this).cursorOf(community(this).clearAllControl()) : null;
      results.push({
        name,
        value: applied.text,
        status: applied.status,
        url: applied.url,
        wentWrong: /something went wrong/i.test(body),
        cards,
        clearAllOffered: !!clearAll,
        clearAllCursor: cursor,
        leftApplied: isLast,
      });
      // eslint-disable-next-line no-await-in-loop
      if (clearAll && !isLast) await community(this).clearAllControl().click({ timeout: 10000 }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await community(this).settle(1200);
    } catch (err) {
      results.push({ name, error: err.message.split('\n')[0] });
    }
  }
  notes(this).filterResults = results;
  this.attach(
    results
      .map((r) => (r.error
        ? `${r.name}: FAILED — ${r.error}`
        : `${r.name}: selected "${r.value}" -> HTTP ${r.status}, ${r.cards.length} card(s), Clear All ${r.clearAllOffered ? `offered (cursor ${r.clearAllCursor})` : 'NOT offered'}`))
      .join('\n'),
    'text/plain'
  );
});

// Reads the SAME recorded pass as the narrowing assertions above. There used to be a second
// driver ("I apply each of the following filters on its own:") writing `singleFilterResults`,
// which re-ran the identical loop for this one check; the driver above already recorded
// `clearAllOffered`/`clearAllCursor`, so it was a strict superset and the second one has been
// deleted. Nothing here touches the app, so ordering it after the narrowing checks costs no
// extra interaction.
Then('a {string} control should have been offered with a pointer cursor for every one of them', async function (label) {
  const results = notes(this).filterResults || [];
  expect(results.length, 'no filters were applied, so Clear All availability was never observed').toBeGreaterThan(0);
  const failures = [];
  for (const r of results) {
    if (r.error) failures.push(`${r.name}: ${r.error}`);
    else if (!r.clearAllOffered) failures.push(`TFF-281: "${label}" was not offered with only the "${r.name}" filter applied`);
    else if (r.clearAllCursor !== 'pointer') failures.push(`TFF-329: "${label}" has cursor "${r.clearAllCursor}", not "pointer", after applying "${r.name}"`);
  }
  reportFailures(this, `"${label}" availability per filter`, failures);
});

Then('no {string} error should be displayed for any of them', async function (message) {
  const bad = (notes(this).filterResults || []).filter((r) => r.wentWrong);
  reportFailures(this, `TFF-282: filters that produced "${message}"`, bad.map((r) => `${r.name} = "${r.value}"`));
});

Then('every member list request should have succeeded', async function () {
  const results = notes(this).filterResults || [];
  const failures = results
    .filter((r) => r.error || (r.status !== null && r.status >= 400))
    .map((r) => (r.error ? `${r.name}: ${r.error}` : `${r.name} = "${r.value}" -> HTTP ${r.status} (${r.url})`));
  reportFailures(this, 'TFF-282: member list requests that did not succeed', failures);
});

Then('the member list request should have succeeded', async function () {
  const last = (notes(this).appliedFilters || []).slice(-1)[0];
  expect(last, 'no filter request was captured').toBeTruthy();
  expect(last.status, `the member list request answered HTTP ${last.status} for ${last.url}`).toBeLessThan(400);
});

// The filter's own value is compared against the card, so this catches a request that succeeded
// and returned the wrong rows — which a status check alone cannot.
Then('every listed candidate card should match the filter that was applied', async function () {
  const failures = [];
  for (const r of notes(this).filterResults || []) {
    if (r.error || !r.cards) continue;
    if (!r.cards.length) continue; // an empty result is legitimate; the empty-state scenario owns it
    const value = lc(r.value);
    const strays = r.cards.filter((c) => !lc(c.text).includes(value));
    if (/member/i.test(r.name)) continue; // Student/Alumni is not rendered on the card
    for (const s of strays) failures.push(`${r.name} = "${r.value}": "${s.name}" does not show that value`);
  }
  reportFailures(this, 'Cards listed that do not match the applied filter', failures);
});

When('I select the first available option in the {string} filter', { timeout: 90000 }, async function (name) {
  await community(this).openFilter(name);
  const applied = await community(this).selectFilterOption(0);
  await community(this).closeAnyPopover();
  if (!notes(this).appliedFilters) notes(this).appliedFilters = [];
  notes(this).appliedFilters.push({ name, ...applied });
  // Snapshot the filtered list here rather than in a step of its own. `I refresh the page` is
  // a generic step owned by invite-agent.steps.js and cannot be taught to record anything, so
  // the persistence scenario's "same as before the refresh" needs the baseline captured by
  // whatever ran last — which is always this step.
  notes(this).cardsBeforeRefresh = await community(this).readMemberCards();
  this.attach(
    `${name} = "${applied.text}" -> HTTP ${applied.status}, ${notes(this).cardsBeforeRefresh.length} card(s) listed`,
    'text/plain'
  );
});

When('I select {string} in the {string} filter', { timeout: 90000 }, async function (value, name) {
  await community(this).openFilter(name);
  const option = this.page.locator('[role="dialog"] label, [role="listbox"] label, [role="option"], [role="dialog"] button')
    .filter({ hasText: new RegExp(`^${value}$`, 'i') })
    .first();
  const [resp] = await Promise.all([
    this.page.waitForResponse((r) => /\/candidates\/\?/.test(r.url()), { timeout: 20000 }).catch(() => null),
    option.click({ timeout: 15000 }),
  ]);
  await community(this).closeAnyPopover();
  if (!notes(this).appliedFilters) notes(this).appliedFilters = [];
  notes(this).appliedFilters.push({ name, text: value, status: resp ? resp.status() : null, url: resp ? resp.url() : null });
});

Then('every listed candidate card should match all three selected filters', async function () {
  await assertCardsMatchFilters(this, 3);
});

Then('every listed candidate card should match both selected filters', async function () {
  await assertCardsMatchFilters(this, 2);
});

async function assertCardsMatchFilters(world, expected) {
  const applied = notes(world).appliedFilters || [];
  expect(applied.length, `${expected} filters should have been applied, ${applied.length} were`).toBe(expected);
  const cards = await community(world).readMemberCards();
  world.attach(`Applied: ${applied.map((a) => `${a.name}="${a.text}"`).join(', ')} -> ${cards.length} card(s)`, 'text/plain');
  if (!cards.length) return; // an empty intersection is a legitimate result
  const failures = [];
  for (const a of applied) {
    if (/member/i.test(a.name)) continue; // Student/Alumni is not rendered on the card
    for (const c of cards.filter((x) => !lc(x.text).includes(lc(a.text)))) {
      failures.push(`${a.name} = "${a.text}": "${c.name}" does not show that value`);
    }
  }
  reportFailures(world, 'Cards listed that do not match every applied filter', failures);
}

Then('every listed candidate card should match both the search and the filters', async function () {
  const applied = notes(this).appliedFilters || [];
  const term = lc(notes(this).lastSearchTerm || '');
  const cards = await community(this).readMemberCards();
  this.attach(`Search "${term}" + ${applied.map((a) => `${a.name}="${a.text}"`).join(', ')} -> ${cards.length} card(s)`, 'text/plain');
  if (!cards.length) return;
  const failures = [];
  for (const c of cards.filter((x) => !lc(x.text).includes(term))) failures.push(`"${c.name}" does not match the search "${term}"`);
  for (const a of applied) {
    if (/member/i.test(a.name)) continue;
    for (const c of cards.filter((x) => !lc(x.text).includes(lc(a.text)))) failures.push(`"${c.name}" does not match ${a.name} = "${a.text}"`);
  }
  reportFailures(this, 'Cards matching neither the search nor the filters', failures);
});

Given('I have noted the number of candidate cards listed', async function () {
  const cards = await community(this).readMemberCards();
  notes(this).baselineCards = cards.length;
  this.attach(`Baseline: ${cards.length} candidate card(s) listed.`, 'text/plain');
});

Then('the number of candidate cards listed should be back to the noted count', async function () {
  const cards = await community(this).readMemberCards();
  expect(cards.length, 'clearing the filters did not restore the full member list').toBe(notes(this).baselineCards);
});

// DELETED 2026-08-10 with their only caller — the AC 7.4 "Apply Filters / Cancel" scenario. Applying
// a filter as soon as its option is picked is the INTENDED design, so that scenario asserted a
// requirement nobody intends to build:
//   When I select the first available option without confirming
//   Then the number of candidate cards listed should be unchanged
//   When I dismiss the filter panel without confirming
// See the removal note in the feature file at §10 for what was measured before removing it.
//
// WORTH KNOWING IF ANYTHING LIKE THIS IS WRITTEN AGAIN: both `unchanged` assertions PASSED on a run
// where the list really went from 12 members to 2, because `readMemberCards()` answered a constant 7
// in both states. A card-count assertion built on that reader proves nothing today — see the note on
// readMemberCards() in CommunityPage.js.
Then('no filter should be applied', async function () {
  const state = await community(this).filterState();
  const applied = state.clearAll > 0 || state.withSelection.length > 0;
  expect(
    applied,
    `a filter is still applied — ${state.clearAll} "Clear all" control(s) on screen, `
    + `trigger(s) showing a selection: ${state.withSelection.length ? state.withSelection.join(', ') : 'none'} `
    + `(all filter triggers read: ${state.triggers.join(', ') || 'none found'})`
  ).toBeFalsy();
});

// CHOSEN, NOT GUESSED AT. This used to apply the first Grad Year and the last Major, on the
// reasoning that opposite ends of two lists would not intersect — and measured live 2026-08-03 that
// combination still left ONE member listed, so the step returned `pending` and the empty state it
// exists to reach was never rendered. Worse, "the last Major" indexed a ten-item window of a list
// that is capped at ten, so which value it picked depended on the alphabet.
//
// Instead: read the majors the members actually hold, then apply one that NOBODY holds. Each
// candidate is applied, verified to have emptied the list, and undone if it did not — so the step
// either arrives at a genuinely empty result or says which values it tried and why each failed.
// Paging is why verification is needed rather than assumed: a major absent from page one can still
// be held by someone on page three.
When('I apply a filter combination that no member satisfies', { timeout: 240000 }, async function () {
  const c = community(this);
  const held = new Set((await c.readMemberCards()).map((m) => lc(m.major)).filter(Boolean));
  await c.openFilter('Majors');
  const offered = (await c.readOpenFilterOptions()).options;
  const candidates = offered.filter((o) => !held.has(lc(o)));
  this.attach(
    `Members listed hold: ${[...held].join(', ') || '(no major on any card)'}\n`
    + `Majors offered: ${offered.join(', ')}\nTrying, in order: ${candidates.slice(0, 5).join(', ')}`,
    'text/plain'
  );
  if (!candidates.length) {
    this.attach('Every major the filter offers is held by a listed member, so no single filter can empty the list.', 'text/plain');
    return manual();
  }

  const tried = [];
  for (const option of candidates.slice(0, 5)) {
    // Reached BY NAME through the popover's own search. With the list capped at ten, indexing it is
    // not a reliable way to select a named value — and searching is the only way to reach anything
    // outside the first ten anyway.
    // eslint-disable-next-line no-await-in-loop
    await c.searchInOpenFilter(option);
    // eslint-disable-next-line no-await-in-loop
    const applied = await c.selectFilterOptionByText(option);
    // eslint-disable-next-line no-await-in-loop
    await c.closeAnyPopover();
    // eslint-disable-next-line no-await-in-loop
    await c.settle(1500);
    // eslint-disable-next-line no-await-in-loop
    const cards = await c.readMemberCards();
    tried.push(`Majors = "${option}" -> HTTP ${applied.status}, ${cards.length} card(s)`);
    if (!cards.length) {
      notes(this).emptyingFilter = { name: 'Majors', value: option, status: applied.status, url: applied.url };
      this.attach(`${tried.join('\n')}\nUsing Majors = "${option}", which leaves the member list empty.`, 'text/plain');
      return undefined;
    }
    // Undo and try the next, so only one filter is ever applied at a time.
    // eslint-disable-next-line no-await-in-loop
    await c.clearAllControl().click({ timeout: 10000 }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await c.settle(1200);
    // eslint-disable-next-line no-await-in-loop
    await c.openFilter('Majors');
  }
  await c.closeAnyPopover();
  this.attach(`No single Majors value emptied the member list:\n${tried.join('\n')}`, 'text/plain');
  return manual();
});

// ============================================================================
// Candidate cards
// ============================================================================

Then('every candidate card should show the following elements:', { timeout: 60000 }, async function (table) {
  const cards = await community(this).readMemberCards();
  const details = await community(this).readMemberDetails();
  expect(cards.length, 'no candidate cards were listed').toBeGreaterThan(0);
  const failures = [];
  for (const card of cards) {
    const d = details.find((x) => lc(x.name) === lc(card.name)) || {};
    for (const row of table.hashes()) {
      const ok = {
        'Profile Picture': card.hasAvatar,
        'Candidate Name': !!card.name,
        Major: !!d.major,
        'Track Name': card.track !== null,
        'Track Progress Widget': card.trackProgress !== null,
        'Courses Completed Widget': card.coursesCompleted !== null,
        'Hours Learned Widget': card.hoursLearned !== null,
      }[row.element];
      if (ok === undefined) failures.push(`unknown element "${row.element}" in the table`);
      else if (!ok) failures.push(`"${card.name}" is missing: ${row.element}`);
    }
  }
  reportFailures(this, 'Candidate card elements', failures, [`Checked ${cards.length} card(s).`]);
});

Then('every candidate card should offer a {string} CTA', async function (label) {
  const cards = await community(this).readMemberCards();
  const without = cards.filter((c) => !c.hasViewProfile).map((c) => c.name);
  expect(without, `these cards offered no "${label}" CTA: ${without.join(', ')}`).toHaveLength(0);
});

Then('every track progress value should be between {string} and {string} percent', async function (min, max) {
  const cards = await community(this).readMemberCards();
  const bad = cards.filter((c) => c.trackProgress === null || c.trackProgress < Number(min) || c.trackProgress > Number(max));
  reportFailures(this, `Track progress outside ${min}-${max}%`, bad.map((c) => `"${c.name}": ${c.trackProgress}`));
});

Then('every courses completed value should be a non-negative whole number', async function () {
  const cards = await community(this).readMemberCards();
  const bad = cards.filter((c) => c.coursesCompleted === null || !Number.isInteger(c.coursesCompleted) || c.coursesCompleted < 0);
  reportFailures(this, 'Invalid courses-completed values', bad.map((c) => `"${c.name}": ${c.coursesCompleted}`));
});

Then('every hours learned value should be a non-negative number', async function () {
  const cards = await community(this).readMemberCards();
  const bad = cards.filter((c) => c.hoursLearned === null || c.hoursLearned < 0);
  reportFailures(this, 'Invalid hours-learned values', bad.map((c) => `"${c.name}": ${c.hoursLearned}`));
});

// FAILS ON PURPOSE — no label rendered on any card in any community inspected on 2026-07-31.
//
// IT SCANS EVERY PAGE, AND NOW ACTUALLY PROVES IT DID. This comment used to claim "a red row cannot
// be explained away by paging" while the next-page locator matched nothing (fixed 2026-08-03), so the
// verdict "none on any of the 7 cards inspected" was page ONE of one community — precisely the
// explanation the comment ruled out. An absence is only evidence if the search was exhaustive, so the
// walk's completeness is asserted BEFORE the absence is reported.
Then('at least one candidate card should display a success label', { timeout: 180000 }, async function () {
  const all = await community(this).collectAllPages(() => community(this).readMemberCards());
  const walk = community(this).lastWalk;
  const withLabels = all.filter((c) => c.successLabels.length);
  notes(this).labelledCards = all;
  this.attach(
    `${all.length} candidate card(s) scanned; ${withLabels.length} carried a success label.\n`
    + `Page walk: ${community(this).walkSummary()}\n`
    + `AC 8 defines: ${SUCCESS_LABELS.join(', ')}`,
    'text/plain'
  );
  expect(
    walk && walk.complete,
    `the member list could not be walked to the end, so "no card shows a success label" would be a claim `
    + `about part of the list — ${community(this).walkSummary()}`
  ).toBeTruthy();
  expect(
    withLabels.length,
    `AC 8 defines four success labels and none was rendered on any of the ${all.length} cards inspected `
    + `(${community(this).walkSummary()}). Confirm with dev whether success labels are implemented before filing.`
  ).toBeGreaterThan(0);
});

Then('every success label shown should be one of {string}', async function (list) {
  const allowed = list.split(',').map((s) => lc(s));
  const cards = notes(this).labelledCards || (await community(this).readMemberCards());
  const strays = [];
  for (const c of cards) {
    for (const label of c.successLabels) if (!allowed.includes(lc(label))) strays.push(`"${c.name}" shows "${label}"`);
  }
  reportFailures(this, `Success labels outside the four AC 8 values (${list})`, strays);
});

// AC 8 says several labels may appear at once, so the layout risk is them colliding. Asserted
// only where such a card exists — a scenario that reports PASSED having found no subject would
// read as covered when it is not, so it says so instead.
Then('a candidate with more than one achievement should show its labels without overlapping the card content', async function () {
  const cards = notes(this).labelledCards || (await community(this).readMemberCards());
  const multi = cards.filter((c) => c.successLabels.length > 1);
  if (!multi.length) {
    this.attach(
      `No candidate carrying more than one success label was found among ${cards.length} card(s), `
      + 'so the multi-label layout was NOT verified.',
      'text/plain'
    );
    return manual();
  }
  const overlaps = await this.page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const labels = Array.from(document.querySelectorAll('*'))
      .filter((e) => e.children.length === 0 && vis(e))
      .filter((e) => /course completed|certificate|co-op program|tamheer program/i.test(e.textContent || ''));
    const bad = [];
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i].getBoundingClientRect();
        const b = labels[j].getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          bad.push(`"${labels[i].textContent.trim()}" overlaps "${labels[j].textContent.trim()}"`);
        }
      }
    }
    return bad;
  });
  reportFailures(this, 'Overlapping success labels', overlaps);
  return undefined;
});

When('I click {string} on that candidate card', { timeout: 90000 }, async function (label) {
  const member = notes(this).member;
  const card = this.page.locator('div,article,li').filter({ hasText: member.name }).filter({ hasText: /view profile/i }).last();
  await card.getByRole('button', { name: /view profile/i }).or(card.getByRole('link', { name: /view profile/i })).first()
    .click({ timeout: 20000 });
  await community(this).settle(2500);
  notes(this).profileUrl = this.page.url();
});

Then("the candidate's public profile should be displayed", async function () {
  const body = await community(this).bodyText();
  notes(this).profileBody = body;
  expect(
    new RegExp(norm(notes(this).member.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body),
    `the page at ${this.page.url()} does not show "${notes(this).member.name}"`
  ).toBeTruthy();
});

Then("the public profile should show that candidate's name, major and track", async function () {
  const body = notes(this).profileBody || (await community(this).bodyText());
  const m = notes(this).member;
  const failures = [];
  for (const [what, value] of [['name', m.name], ['major', m.major], ['track', m.track]]) {
    if (!value || value === '—') continue;
    if (!new RegExp(norm(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body)) {
      failures.push(`the profile does not show the ${what} shown on the card: "${value}"`);
    }
  }
  // Attach what the profile DOES show. Without it the failure is a bare "does not show X" and
  // the next person has to re-drive the app to find out whether the field is absent, renamed or
  // truncated — which is exactly what had to be done for the Major (see below).
  reportFailures(this, 'Public profile does not match the card', failures, [
    `Card said: name "${m.name}", major "${m.major}", track "${m.track}".`,
    `Profile at ${this.page.url()} renders:\n${norm(body).slice(0, 800)}`,
  ]);
});

Then("the public profile should not display the candidate's email address", async function () {
  const body = notes(this).profileBody || (await community(this).bodyText());
  const emails = body.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  // The signed-in user's own address can legitimately appear in the shell (header menu).
  const own = [process.env.CANDIDATE_EMAIL, process.env.SUPERADMIN_EMAIL].filter(Boolean).map(lc);
  const leaked = emails.filter((e) => !own.includes(lc(e)));
  expect(leaked, `a public profile leaked email address(es): ${leaked.join(', ')}`).toHaveLength(0);
});

Then("the public profile should not display the candidate's phone number", async function () {
  const body = notes(this).profileBody || (await community(this).bodyText());
  // Long digit runs and +country formats. Years, percentages and counts are excluded so a
  // graduation year does not read as a phone number.
  const phones = (body.match(/(?:\+\d[\d\s-]{7,}\d)|(?:\b\d{9,}\b)/g) || []).filter((p) => !/^\d{4}$/.test(norm(p)));
  expect(phones, `a public profile leaked what looks like a phone number: ${phones.join(', ')}`).toHaveLength(0);
});

Then('the public profile should offer no control that edits that candidate', async function () {
  const controls = await this.page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll('button,a'))
      .filter(vis)
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /^(edit|delete|remove|suspend|deactivate|save)\b/i.test(t));
  });
  expect(controls, `a peer's public profile offers management controls: ${controls.join(', ')}`).toHaveLength(0);
});

When('I go back to the community', { timeout: 60000 }, async function () {
  await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await community(this).settle(2000);
  if (!community(this).isOnCommunity()) await community(this).gotoCommunity(notes(this).subject.id);
});

// ============================================================================
// Failure handling (@mocked)
// ============================================================================

When('the create community request will fail with each of the following:', { timeout: 240000 }, async function (table) {
  const results = [];
  for (const row of table.hashes()) {
    const failure = row.failure;
    // eslint-disable-next-line no-await-in-loop
    // EVERY POST to the community API is stubbed, not only the URL the create is believed to use:
    // a stub that missed the real create endpoint would let the save through and permanently
    // consume a university (no community can be deleted).
    await this.page.route(/\/api\/v1\/community/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (/network/i.test(failure)) return route.abort('failed');
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) });
    });
    // eslint-disable-next-line no-await-in-loop
    const before = await form(this).readValues();
    try {
      // eslint-disable-next-line no-await-in-loop
      await form(this).clickSave({ expectRequest: false });
    } catch (err) {
      results.push({ failure, threw: err.message.split('\n')[0] });
    }
    // eslint-disable-next-line no-await-in-loop
    await this.page.waitForTimeout(3000);
    // eslint-disable-next-line no-await-in-loop
    const modal = await form(this).readSuccessModal();
    // eslint-disable-next-line no-await-in-loop
    const toast = await community(this).toastText();
    // eslint-disable-next-line no-await-in-loop
    const errors = await form(this).readAllErrors();
    // eslint-disable-next-line no-await-in-loop
    const after = await form(this).readValues();
    results.push({ failure, successModal: modal.present, toast, errors, before, after });
    // eslint-disable-next-line no-await-in-loop
    await this.page.unroute(/\/api\/v1\/community/).catch(() => {});
  }
  notes(this).failureResults = results;
  this.attach(results.map((r) => `${r.failure}: modal=${r.successModal}, toast="${r.toast || ''}", errors=${JSON.stringify(r.errors)}`).join('\n'), 'text/plain');
});

Then('an error should be surfaced for every one of them', async function () {
  const silent = (notes(this).failureResults || []).filter((r) => !r.toast && !(r.errors || []).length && !r.threw);
  reportFailures(
    this,
    'Failures that were swallowed silently',
    silent.map((r) => `${r.failure}: no toast, no inline error and no visible feedback of any kind`)
  );
});

Then('an error should be surfaced', async function () {
  const toast = await community(this).toastText();
  const errors = await form(this).readAllErrors();
  expect(
    !!toast || errors.length > 0,
    'the failed save produced no toast and no inline error — the failure was swallowed silently'
  ).toBeTruthy();
});

Then('no community success modal should be displayed', async function () {
  const shown = (notes(this).failureResults || []).filter((r) => r.successModal);
  if (shown.length) {
    throw new Error(`a success modal appeared despite the request failing: ${shown.map((r) => r.failure).join(', ')}`);
  }
  const modal = await form(this).readSuccessModal();
  expect(modal.present, 'a success modal appeared despite the request failing').toBeFalsy();
});

Then('no community should have been created', async function () {
  // The form is still open, so no navigation to the listing happened — which is what a
  // successful create does. Asserted alongside the absent success modal rather than by
  // counting communities, which would race the listing's own cache.
  const stillOnForm = form(this).isOnCreate() || !!form(this).editingId();
  expect(stillOnForm, `the app navigated away to ${this.page.url()}, which suggests the create succeeded`).toBeTruthy();
});

Then('the Create Community page should remain usable with my entered details intact', async function () {
  const failures = [];
  for (const r of notes(this).failureResults || []) {
    for (const key of ['university', 'location', 'about']) {
      if (norm(r.before[key]) !== norm(r.after[key])) {
        failures.push(`${r.failure}: "${key}" was "${r.before[key]}" before the failure and "${r.after[key]}" after`);
      }
    }
  }
  await expect(form(this).saveButton, 'the form is no longer usable').toBeVisible({ timeout: 15000 });
  reportFailures(this, 'Input lost when the request failed', failures);
});

When('the update community request will fail with a server error', async function () {
  await this.page.route(/\/api\/v1\/community\/\d+\/?$/, async (route) => {
    if (!['PATCH', 'PUT'].includes(route.request().method())) return route.fallback();
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) });
  });
});

// ============================================================================
// Access control
// ============================================================================

const ROUTE_FOR = {
  community: '/community',
  'create community': '/community/create',
  'edit community': '/community/edit/78',
};

async function checkAccess(world, page, pageName) {
  const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
  const route = ROUTE_FOR[lc(pageName)];
  await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const url = page.url();
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  // Reaching the ROUTE and getting the MANAGEMENT AFFORDANCES are different findings, and the
  // report has to separate them: /community is a superadmin management screen and a candidate
  // directory at the same URL, so "an agent landed on /community" on its own does not say
  // whether they can only browse or can actually create and edit. Recorded on every row so a
  // reader can tell the two apart without re-running anything.
  const manage = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('button,a'))
      .filter(vis)
      .map((e) => clean(e.textContent) || e.getAttribute('aria-label') || '')
      .filter((t) => /create community|edit community|edit parameters|add community/i.test(t));
  }).catch(() => []);
  return {
    url,
    denied: /\/unauthorized|\/forbidden/.test(url) || /access denied|do not have permission/i.test(body),
    toLogin: /\/login|\/signin/.test(url),
    reached: new RegExp(route.replace(/\//g, '\\/')).test(url),
    manageControls: Array.from(new Set(manage)),
  };
}

When('each of the following roles opens each superadmin Community page directly:', { timeout: 300000 }, async function (table) {
  const results = [];
  for (const row of table.hashes()) {
    // eslint-disable-next-line no-await-in-loop
    const page = await sessionFor(this, row.role);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await checkAccess(this, page, row.page);
    results.push({ ...row, ...outcome });
  }
  notes(this).accessResults = results;
  this.attach(results.map((r) => (
    `${r.role} -> ${r.page}: landed on ${r.url} (denied=${r.denied}, login=${r.toLogin}), `
    + `management controls exposed: ${r.manageControls.length ? r.manageControls.join(' / ') : 'none'}`
  )).join('\n'), 'text/plain');
});

When('each of the following superadmin Community pages is opened directly:', { timeout: 180000 }, async function (table) {
  const results = [];
  for (const row of table.hashes()) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await checkAccess(this, this.page, row.page);
    results.push({ role: 'logged in as a candidate', ...row, ...outcome });
  }
  notes(this).accessResults = results;
  this.attach(results.map((r) => `${r.page}: landed on ${r.url} (denied=${r.denied})`).join('\n'), 'text/plain');
});

Then('every one of them should have got its expected outcome', async function () {
  const failures = [];
  for (const r of notes(this).accessResults || []) {
    const want = lc(r['expected outcome']);
    if (want === 'denied access' && !r.denied) {
      failures.push(
        `${r.role} reached ${r.page} (landed on ${r.url}) instead of being denied`
        + ` — management controls exposed there: ${r.manageControls && r.manageControls.length ? r.manageControls.join(' / ') : 'none'}`
      );
    }
    if (want === 'accessible without management controls') {
      if (!r.reached || r.denied || r.toLogin) {
        failures.push(`${r.role} opening ${r.page} was not accessible: landed on ${r.url}`);
      } else if (r.manageControls && r.manageControls.length) {
        failures.push(
          `${r.role} opening ${r.page} exposed management controls: ${r.manageControls.join(' / ')}`
        );
      }
    }
    if (want === 'taken to the login page' && !r.toLogin) failures.push(`${r.role} opening ${r.page} landed on ${r.url}, not the login page`);
  }
  reportFailures(this, 'Access-control outcomes that did not match', failures);
});

Then('I should still be able to open the Community main page', { timeout: 60000 }, async function () {
  await community(this).gotoList();
  const cards = await community(this).readCards();
  expect(
    community(this).isOnListing(),
    `a candidate should still be able to read /community, but landed on ${this.page.url()}`
  ).toBeTruthy();
  this.attach(`Candidate can read the directory: ${cards.length} card(s) listed.`, 'text/plain');
});

// ============================================================================
// End-to-end helpers
// ============================================================================

When('I note the list of available universities', { timeout: 60000 }, async function () {
  await form(this).openUniversityDropdown();
  notes(this).universitiesBefore = await form(this).readOptions();
  await this.page.keyboard.press('Escape').catch(() => {});
  this.attach(`${notes(this).universitiesBefore.length} universities available before creating.`, 'text/plain');
});

Then('the university I just used should no longer be available', { timeout: 60000 }, async function () {
  const used = (notes(this).created || {}).university;
  const found = await form(this).filterUniversityDropdown(used);
  this.attach(`Searching the dropdown for "${used}" after creating its community -> ${found.length} option(s)`, 'text/plain');
  expect(
    found,
    `AC 3.1 removes a university once it has a community, but "${used}" is still offered`
  ).toHaveLength(0);
});

Then('I should be on the Community main page', async function () {
  expect(community(this).isOnListing(), `expected /community, got ${this.page.url()}`).toBeTruthy();
});

// ============================================================================
// Candidate portal — sidebar, listing scope, persistence
// ============================================================================

Then('the sidebar should offer a {string} entry', async function (label) {
  const entry = this.page.locator(`a[href="/community"]`).or(this.page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).first();
  await expect(entry, `no "${label}" entry in the sidebar`).toBeVisible({ timeout: 20000 });
});

When('I open Community from the sidebar', { timeout: 60000 }, async function () {
  const entry = this.page.locator('a[href="/community"]').first();
  const disabled = await entry.evaluate((el) => getComputedStyle(el).pointerEvents === 'none').catch(() => false);
  // The entry is rendered pointer-events:none for a candidate with an incomplete profile, so
  // clicking it would hang. Navigating directly is the honest fallback, and the gating scenario
  // below is the one that reports the inconsistency.
  if (disabled) {
    this.attach('The sidebar Community entry is rendered non-interactive, so the route was opened directly.', 'text/plain');
    await community(this).gotoList();
    return;
  }
  await entry.click({ timeout: 20000 });
  await community(this).waitForListing();
});

Then('at least one community card should be listed', async function () {
  const cards = await community(this).readCards();
  expect(cards.length, 'no community cards were listed').toBeGreaterThan(0);
});

// FAILS ON PURPOSE — TFF-521 is still open.
Then('the sidebar {string} entry should carry a BETA badge', async function (label) {
  const found = await this.page.evaluate(() => {
    const link = document.querySelector('a[href="/community"]');
    if (!link) return { present: false, text: null };
    return { present: /beta/i.test(link.textContent || '') || !!link.querySelector('[class*="beta" i],[aria-label*="beta" i]'), text: (link.textContent || '').trim() };
  });
  this.attach(`Sidebar entry reads: "${found.text}"`, 'text/plain');
  expect(found.present, `TFF-521: the "${label}" sidebar entry carries no BETA badge (it reads "${found.text}")`).toBeTruthy();
});

// No AC covers this either way. Either the gate means something and the route must honour it,
// or it does not and the sidebar should not claim otherwise.
Then('the sidebar {string} entry should be either enabled, or disabled with the route also refusing access', { timeout: 90000 }, async function (label) {
  const state = await this.page.evaluate(() => {
    const link = document.querySelector('a[href="/community"]');
    if (!link) return null;
    const s = getComputedStyle(link);
    return { pointerEvents: s.pointerEvents, cursor: s.cursor, opacity: s.opacity, className: link.className };
  });
  expect(state, 'no Community entry in the sidebar').toBeTruthy();
  const gated = state.pointerEvents === 'none' || /not-allowed/.test(state.cursor);
  await community(this).gotoList();
  const cards = await community(this).readCards();
  const routeOpen = community(this).isOnListing() && cards.length > 0;
  this.attach(
    `Sidebar entry: ${JSON.stringify(state)} -> ${gated ? 'GATED' : 'enabled'}.\n`
    + `Direct navigation to /community: ${routeOpen ? `open (${cards.length} cards)` : 'refused'}.`,
    'text/plain'
  );
  expect(
    gated && routeOpen,
    'the sidebar renders Community as unavailable (pointer-events:none / cursor:not-allowed) while /community '
    + 'loads normally by direct URL — the two disagree, so the gate is cosmetic'
  ).toBeFalsy();
});

Then('no community card should offer an edit action', async function () {
  const cards = await community(this).readCards();
  const leaked = cards.filter((c) => c.hasEdit).map((c) => c.name);
  expect(leaked, `the superadmin's edit affordance leaked onto a candidate's cards: ${leaked.join(', ')}`).toHaveLength(0);
});

Given('I have noted how many communities the superadmin can see', { timeout: 180000 }, async function () {
  const admin = await superadminCommunity(this);
  await admin.gotoList();
  const total = await admin.readTotalCount();
  const cards = await admin.collectAllPages(() => admin.readCards(), 3);
  notes(this).adminTotal = total;
  notes(this).allCommunityNames = cards.map((c) => c.name);
  this.attach(`The superadmin's listing reports ${total} communities.`, 'text/plain');
  expect(total, 'the superadmin listing reported no total').toBeGreaterThan(0);
});

// FAILS ON PURPOSE. Read from the listing's own total rather than by counting cards, so it
// stays true whatever page size the app settles on.
Then('the candidate listing should offer that same number of communities', { timeout: 120000 }, async function () {
  const total = await community(this).readTotalCount();
  const admin = notes(this).adminTotal;
  this.attach(`Candidate sees ${total}; superadmin sees ${admin}.`, 'text/plain');
  expect(
    total,
    `AC 2.1 says the candidate's page "displays all created university communities" and AC 2.3 says the rest `
    + `"remain viewable and accessible", but the candidate is offered ${total} of the superadmin's ${admin}`
  ).toBe(admin);
});

Then('the header should offer no Edit Community control', async function () {
  const header = await community(this).readHeader();
  expect(header.hasEditCta, "a candidate's community page offers an Edit Community control").toBeFalsy();
});

// FAILS ON PURPOSE — AC 6.3. The filters are not reflected in the URL, so a reload has nothing
// to restore.
Then('that filter should still be applied', async function () {
  const applied = await community(this).anyFilterApplied();
  const last = (notes(this).appliedFilters || []).slice(-1)[0];
  expect(
    applied,
    `AC 6.3 requires an applied filter to persist across a refresh; ${last ? `"${last.name} = ${last.text}"` : 'the filter'} was lost`
  ).toBeTruthy();
});

Then('the listed candidate cards should be the same as before the refresh', async function () {
  const before = (notes(this).cardsBeforeRefresh || []).map((c) => c.name).sort();
  const after = (await community(this).readMemberCards()).map((c) => c.name).sort();
  expect(after, 'the member list changed across the refresh, so the search and filters did not persist').toEqual(before);
});

// ============================================================================
// @not-automatable living spec
// ============================================================================

Given('no communities exist in the system', manual);
Given('no communities exist on the platform', manual);
Then('the primary CTA {string} should be visible', manual);
Given('a community exists for a known university', manual);
When('that community is deleted', manual);
Then('that university should be listed again', manual);
Given('a candidate whose university matches an existing community', manual);
Given('that candidate is Active, with profile and onboarding complete', manual);
Given('that candidate has not completed the psychometric assessment', manual);
When("I open that university's community", manual);
Then('that candidate should not be listed as a member', manual);
When('that candidate completes the psychometric assessment', manual);
When("I reopen that university's community", manual);
Then('that candidate should be listed as a member', manual);
Then('the header member count should have increased by {int}', manual);
Then('no manual action should have been required to add them', manual);
When('each of the following conditions is unmet in turn:', manual);
Then('that candidate should not be listed as a member for any of them', manual);
Given('a candidate whose university has no community on the platform', manual);
When('I open every community', manual);
Then('that candidate should not be listed in any of them', manual);
Given('an enrolled member of a community', manual);
When("that candidate's status becomes suspended", manual);
Then('that candidate should no longer be listed as a member', manual);
Then('the header member count should have decreased by {int}', manual);
Given('two superadmins are on the Create Community page in separate sessions', manual);
When('both save a community for the same university at the same time', manual);
Then('only one community should exist for that university', manual);
Then('the losing session should be shown an error rather than a success modal', manual);
Given('I am a candidate enrolled in at least one university community', manual);
Then('every community I am enrolled in should be listed above the communities I am not', manual);
Then('each of those cards should display a {string} label', manual);
Then('the label should appear on the card for my first education record', manual);
Given('I am a candidate with two education records naming universities that both have communities', manual);
Then('both of those communities should be listed as mine', manual);
Then('I should be listed as a member of each of them', manual);
Given('I am a candidate whose education end date is in the future', manual);
Then('I should be listed as a {string} in that community', manual);
When('my education end date is changed to a date in the past', manual);
Then('I should be listed as an {string} in that community', manual);
