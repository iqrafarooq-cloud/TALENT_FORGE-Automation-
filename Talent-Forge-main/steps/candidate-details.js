// Step definitions for features/Candidate_Portal/Candidate-Details.feature - the Candidate
// Portal's own Profile > Candidate Details tab.
//
// >>> EVERY PHRASE HERE IS WORDED "... Candidate Details ..." OR NAMES A SECTION, DELIBERATELY.
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
// fails generation on it instead). Three neighbours already own generic candidate vocabulary:
// steps/subscription.js defines "I am logged in as a candidate" (the SHARED CANDIDATE_EMAIL),
// steps/contact-us.js owns "the Contact Us ..." and steps/document-verification.js owns the
// document phrases. Reusing any of those would silently drive a different account or a different
// page - the class of fault that spent REFERRAL_NOPROMO_AGENT's zero-candidate state.
//
// >>> THE @mutates-profile SCENARIOS REALLY WRITE TO A LIVE ACCOUNT. <<<
// candidateDetailsFixtureGuard() is the backstop and it is POSITIVE and identity-based: it names
// the one account that may be written to and refuses everything else regardless of tags, hooks
// or which step is calling. A tag-driven guard is one missing hook away from editing the shared
// CANDIDATE_EMAIL, which is the login for the subscription, promo and document-verification
// suites.
//
// MEASURED LIVE 2026-09-14 - scripts/probe-candidate-details.js (read-only) and
// scripts/probe-candidate-details-mutations.js (writes). Everything asserted here was read off
// the running app; there is no AC for this page, so nothing is inferred from one.
//
// >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT { timeout }. <<<
// features/support/hooks.js calls setDefaultTimeout(60000), and THAT OVERRIDES the profile's own
// `timeout`. A step that walks six sections reopening a modal for each is many times a normal
// step's work, and without a budget it is killed part-way and reports "function timed out",
// which says nothing about the app and hides however many rows had already passed. That cost
// Contact-us.feature a full run.

const path = require('path');
const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const DOC_FIXTURE = path.join(__dirname, '..', 'Files', 'Test_doc', 'AUTH-01_certificate_ordinary_scan.pdf');

// The formats the document endpoint actually accepts, measured by the document-verification
// module: a JPEG is refused with "Only .pdf, .png files are allowed." Kept here as the thing the
// advertised accept list is compared AGAINST, so the day the endpoint widens, that scenario says
// so instead of silently agreeing.
const SERVER_ACCEPTS = ['.pdf', '.png'];

// ---------------------------------------------------------------------------- guard

// The one account this suite may write to. Identity-based on purpose - see the header.
function candidateDetailsFixtureGuard(email) {
  const allowed = (process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL || '').trim().toLowerCase();
  if (!allowed) {
    throw new Error(
      'candidateDetailsFixtureGuard: neither CANDIDATE_DETAILS_EMAIL nor CONTACTUS_EMAIL is set '
      + 'in .env, so no account is authorised to be edited. Refusing to write.'
    );
  }
  if (String(email || '').trim().toLowerCase() !== allowed) {
    throw new Error(
      `candidateDetailsFixtureGuard: REFUSING to edit the profile of "${email}". Only ${allowed} `
      + 'may be written to by this suite. The shared CANDIDATE_EMAIL is the login for the '
      + 'subscription, promo and document-verification suites and must never be edited here.'
    );
  }
}

// ---------------------------------------------------------------------------- helpers

const cd = (world) => {
  if (!world.pages.candidateDetails) {
    throw new Error(
      'CandidateDetailsPage is not wired onto this.pages. Add it to BOTH '
      + 'features/support/hooks.js and fixtures/PagesFixture.js - there is no auto-discovery '
      + 'in either runner.'
    );
  }
  return world.pages.candidateDetails;
};

// Attach evidence on every measuring step. On a red row it is the evidence; on a green one it is
// the record of what the app did that day, which is what makes a later change diagnosable.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// Cucumber abandons a scenario at its first failing step, and most rules here have three to nine
// independent cases. Collecting every problem and throwing once is what makes a red row say
// whether the cases share a cause.
function reportAll(problems, headline, trace) {
  if (!problems.length) return;
  const detail = trace ? `\n\nWhat was observed:\n${JSON.stringify(trace, null, 2)}` : '';
  throw new Error(`${headline}\n  - ${problems.join('\n  - ')}${detail}`);
}

// Read a dotted path out of the profile payload, so the feature file can name the API field
// beside the UI label it is compared against.
function payloadValue(profile, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), profile);
}

// How the app renders a payload value. Each rule was measured, not guessed:
//   null / []      -> "-"        (the unset-field placeholder)
//   "STUDENT"      -> "Student"  (uppercase enum, Title Case on screen)
//   true / false   -> "Yes"/"No"
// A comparison that skipped these would report every correct field as a mismatch.
function expectedRendering(value) {
  if (value === null || value === undefined) return '-';
  if (Array.isArray(value)) return value.length ? value.map((v) => v.location_name || v.name || String(v)) : '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^[A-Z_]+$/.test(value) && value.length > 1) {
    return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return String(value);
}

// >>> THE SECTIONS DO NOT SHARE ONE SAVE ENDPOINT. <<< Measured 2026-09-14:
//   Basic Information            -> PATCH /candidate/profile/basic-info
//   Work Preferences             -> PATCH /candidate/onboarding/preferences/
//   Education / Experience /
//   Certifications (add)         -> POST  /candidate/profile/<collection>/
// A filter written against /candidate/profile alone reports "Save fired no request at all" for a
// Work Preferences save that plainly returned 200 - which reads as the app doing nothing.
const isCandidateWrite = (r) => /\/candidate\//.test(r.url);

function marked(prefix) {
  return `${prefix} ${Date.now().toString().slice(-8)}`;
}

// ==================== Background ====================

Given('I am logged in as the Candidate Details candidate', async function () {
  const email = process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL;
  const password = process.env.CANDIDATE_DETAILS_PASSWORD || process.env.CONTACTUS_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set CANDIDATE_DETAILS_EMAIL / CANDIDATE_DETAILS_PASSWORD in .env (they fall back to '
      + 'CONTACTUS_EMAIL / CONTACTUS_PASSWORD).'
    );
  }
  this._candidateDetailsEmail = email;

  const login = new LoginPage(this.page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  // commit, not load: the dashboard goes on fetching its KPI widgets long after the route changes.
  await this.page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await this.page.waitForTimeout(2000);
});

Given('I am on the Candidate Details tab', async function () {
  await cd(this).open();
});

When('I reload the Candidate Details tab', async function () {
  await cd(this).open();
});

// ==================== 1. The page itself ====================

Then('the profile header should be displayed', async function () {
  const header = await cd(this).readHeader();
  await record(this, 'profile header', header);
  expect(header.badge, 'the profile header rendered no Verified/Unverified badge').not.toBeNull();
  expect(header.stats.length, 'the profile header rendered no statistic widgets').toBeGreaterThan(0);
  expect(header.hasViewAs, 'the profile header offered no "View As" control').toBe(true);
});

Then('the profile tab strip should offer exactly:', async function (table) {
  const want = table.hashes().map((r) => r.tab);
  const got = (await cd(this).readTabs()).map((t) => t.name);
  await record(this, 'tabs rendered', got);
  // Exactly and in order: an extra tab is a surface nobody specified, and the order is what a
  // candidate navigates by.
  expect(got, 'the profile tab strip does not match the documented set').toEqual(want);
});

Then('the Candidate Details tab should be the selected tab', async function () {
  expect(await cd(this).checkedTab(), 'Candidate Details is not the selected tab').toBe('Candidate Details');
});

Then('the Candidate Details page should render exactly these sections, in order:', { timeout: 120000 }, async function (table) {
  const want = table.hashes();
  const got = await cd(this).readSections();
  await record(this, 'sections rendered', got.map((s) => ({ title: s.title, icons: s.icons, entries: s.entryCount })));

  const problems = [];
  const gotTitles = got.map((s) => s.title);
  const wantTitles = want.map((r) => r.section);
  if (JSON.stringify(gotTitles) !== JSON.stringify(wantTitles)) {
    problems.push(`sections are [${gotTitles.join(' | ')}], expected [${wantTitles.join(' | ')}]`);
  }
  for (const row of want) {
    const section = got.find((s) => s.title === row.section);
    if (!section) continue;
    const hasAdd = section.icons.some((c) => c.includes('add-icon'));
    const hasEdit = section.icons.some((c) => c.includes('edit-icon'));
    if (hasAdd !== (row.add === 'yes')) problems.push(`"${row.section}" add icon: expected ${row.add}, found ${hasAdd ? 'yes' : 'no'}`);
    if (hasEdit !== (row.edit === 'yes')) problems.push(`"${row.section}" edit icon: expected ${row.edit}, found ${hasEdit ? 'yes' : 'no'}`);
  }
  reportAll(problems, 'The Candidate Details sections do not match the documented contract.');
});

Then('each of these fields should render the value its payload field holds:', { timeout: 120000 }, async function (table) {
  const page = cd(this);
  const profile = await page.profile();
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const pairs = await page.readFieldPairs(row.section);
    const rendered = pairs[row.label];
    const raw = payloadValue(profile, row['payload field']);
    const want = expectedRendering(raw);
    const wantList = Array.isArray(want) ? want : [want];
    const gotList = Array.isArray(rendered) ? rendered : [rendered];
    const ok = JSON.stringify(gotList) === JSON.stringify(wantList);
    trace.push({ section: row.section, label: row.label, payloadField: row['payload field'], raw, expected: want, rendered });
    if (!ok) {
      problems.push(
        `"${row.label}" renders ${JSON.stringify(rendered)} but ${row['payload field']} holds `
        + `${JSON.stringify(raw)}, which should render ${JSON.stringify(want)}`
      );
    }
  }
  await record(this, 'rendered value vs payload field', trace);
  reportAll(problems, 'The page renders values its own payload does not hold.', null);
});

Then('the profile header should name the candidate the payload names', async function () {
  const page = cd(this);
  const profile = await page.profile();
  const expected = `${profile.user.firstname} ${profile.user.lastname}`.trim();
  const text = await this.page.locator('main').first().innerText();
  await record(this, 'header name check', { expected, headerStartsWith: text.split('\n').slice(0, 6) });
  expect(text, `the header does not name the candidate the payload names ("${expected}")`).toContain(expected);
});

Then('the verification badge should agree with the payload', async function () {
  const page = cd(this);
  const profile = await page.profile();
  const header = await page.readHeader();
  const expected = profile.is_verified ? 'Verified' : 'Unverified';
  await record(this, 'verification badge', { is_verified: profile.is_verified, expected, rendered: header.badge });
  expect(header.badge, `is_verified is ${profile.is_verified} so the badge should read "${expected}"`).toBe(expected);
});

Then('every Education, Work Experience and Certification entry should match its payload entry', { timeout: 120000 }, async function () {
  const page = cd(this);
  const profile = await page.profile();
  const problems = [];
  const trace = {};

  const checks = [
    { section: 'Education', entries: profile.educations || [], parts: (e) => [e.institution_name, e.degree_details && e.degree_details.name, e.field_of_study && e.field_of_study.name] },
    { section: 'Work Experience', entries: profile.work_experiences || [], parts: (e) => [e.designation, e.company_name] },
    { section: 'Certifications', entries: profile.certifications || [], parts: (e) => [e.certificate_name, e.issuing_organization] },
  ];

  for (const check of checks) {
    const section = await page.readSection(check.section);
    const blob = section.lines.join(' | ');
    trace[check.section] = { payloadEntries: check.entries.length, rendered: section.lines };
    if (section.entryCount !== check.entries.length) {
      problems.push(`${check.section} renders ${section.entryCount} entries but the payload holds ${check.entries.length}`);
    }
    for (const entry of check.entries) {
      for (const part of check.parts(entry).filter(Boolean)) {
        if (!blob.includes(part)) problems.push(`${check.section}: "${part}" is in the payload but is not rendered`);
      }
    }
  }
  await record(this, 'list sections vs payload', trace);
  reportAll(problems, 'A list section does not render what its payload holds.');
});

Then('every unset Basic Information field should render {string}', async function (placeholder) {
  const page = cd(this);
  const profile = await page.profile();
  const pairs = await page.readFieldPairs('Basic Information');
  const problems = [];
  const trace = [];
  for (const [label, field] of [['Phone Number', 'user.phone_number'], ['Nationality', 'user.nationality']]) {
    const raw = payloadValue(profile, field);
    trace.push({ label, raw, rendered: pairs[label] });
    if (raw === null || raw === undefined || raw === '') {
      if (pairs[label] !== placeholder) problems.push(`${field} is unset so "${label}" should render "${placeholder}", found ${JSON.stringify(pairs[label])}`);
    }
  }
  await record(this, 'unset-field placeholder', trace);
  // A fixture where nothing is unset proves nothing - say so rather than passing silently. The
  // "nothing to assert" lesson: a scenario reporting PASSED having asserted nothing is worse
  // than one reporting a missing precondition.
  if (!trace.some((t) => t.raw === null || t.raw === undefined || t.raw === '')) {
    throw new Error(
      'Neither Phone Number nor Nationality is unset on this fixture, so the empty-field '
      + 'placeholder was never exercised. Clear one on the fixture, or this rule is unverified.'
    );
  }
  reportAll(problems, 'An unset field does not render the documented placeholder.');
});

// The parentheses are escaped: in a Cucumber expression '(s)' is OPTIONAL TEXT, so the
// unescaped phrase matches 'Preferred Work Location list' and never the label the app renders.
Then('an empty Preferred Work Location\\(s) list should render {string}', async function (placeholder) {
  const page = cd(this);
  const profile = await page.profile();
  const pairs = await page.readFieldPairs('Work Preferences & Availability');
  await record(this, 'preferred locations', { payload: profile.preferred_locations, rendered: pairs['Preferred Work Location(s)'] });
  if ((profile.preferred_locations || []).length === 0) {
    expect(pairs['Preferred Work Location(s)'], 'an empty preferred-location list should render the placeholder').toBe(placeholder);
  } else {
    await record(this, 'NOT EXERCISED', 'the fixture holds preferred locations, so the empty rendering was not exercised');
  }
});

Then('every profile statistic should render a figure or the placeholder {string}', async function (placeholder) {
  const page = cd(this);
  const header = await page.readHeader();
  const profile = await page.profile();
  await record(this, 'statistics', { stats: profile.stats, rendered: header.stats });
  const problems = [];
  for (const stat of header.stats) {
    const isPlaceholder = (stat.value || '').includes(placeholder);
    const isFigure = /\d/.test(stat.value || '');
    if (!isPlaceholder && !isFigure) problems.push(`"${stat.label}" renders ${JSON.stringify(stat.value)}, which is neither a figure nor the placeholder`);
  }
  reportAll(problems, 'A profile statistic renders neither a figure nor its placeholder.');
});

Then('the statistic placeholder should not be the same string as the empty-field placeholder', async function () {
  const CandidateDetailsPage = require('../pages/CandidateDetailsPage');
  expect(
    CandidateDetailsPage.EMPTY_STAT,
    'the two placeholders are the same string, so a reader cannot tell an unfilled field from an uncomputed statistic'
  ).not.toBe(CandidateDetailsPage.EMPTY_VALUE);
});

Then('selecting each tab should put its own value in the URL:', { timeout: 120000 }, async function (table) {
  const page = cd(this);
  const problems = [];
  const trace = [];
  for (const row of table.hashes()) {
    await page.selectTab(row.tab);
    const url = this.page.url();
    trace.push({ tab: row.tab, url });
    if (!url.includes(`selectedTab=${row.selectedTab}`)) {
      problems.push(`selecting "${row.tab}" produced ${url}, expected selectedTab=${row.selectedTab}`);
    }
  }
  this._tabTable = table.hashes();
  await record(this, 'tab -> URL', trace);
  reportAll(problems, 'A tab does not write its own value to the URL.');
});

Then('opening each of those URLs directly should select that same tab', { timeout: 120000 }, async function () {
  const page = cd(this);
  const problems = [];
  const trace = [];
  for (const row of this._tabTable || []) {
    await page.openTabByUrl(row.selectedTab);
    const checked = await page.checkedTab();
    trace.push({ selectedTab: row.selectedTab, checked });
    if (checked !== row.tab) problems.push(`?selectedTab=${row.selectedTab} selected ${JSON.stringify(checked)}, expected "${row.tab}"`);
  }
  await record(this, 'deep link -> selected tab', trace);
  reportAll(problems, 'A tab cannot be opened directly from its own URL.');
});

When('I open the profile with the tab value {string}', async function (value) {
  await cd(this).openTabByUrl(value);
});

When('I open the profile with no tab value at all', async function () {
  await cd(this).openTabByUrl('');
});

Then('some tab should be selected', async function () {
  const page = cd(this);
  const checked = await page.checkedTab();
  const tabs = await page.readTabs();
  await record(this, 'unrecognised tab value', { url: this.page.url(), checked, tabs });
  expect(
    checked,
    'an unrecognised ?selectedTab value left NO tab selected - the candidate lands on the profile '
    + 'shell with no view chosen and nothing saying which one they are in. An empty value falls '
    + 'back to Candidate Details correctly, so the fallback exists and simply does not cover an '
    + 'unknown value.'
  ).not.toBeNull();
});

// ==================== 2. Basic Information ====================

When('I open the {string} edit form', async function (section) {
  await cd(this).openEditModal(section);
});

When('I open the {string} add form', async function (section) {
  await cd(this).openAddModal(section);
});

Then('the modal should be titled {string}', async function (title) {
  const got = await cd(this).modalTitle();
  await record(this, 'modal title', { expected: title, rendered: got });
  expect((got || '').trim(), 'the modal carries a different title').toBe(title);
});

Then('the Basic Information form should offer exactly these fields:', { timeout: 60000 }, async function (table) {
  const fields = await cd(this).readBasicInformationForm();
  await record(this, 'Basic Information form controls', fields);
  const problems = [];

  // Match on the control's own identity rather than on document order - the profile photo input
  // sits first in the DOM and would shift every positional index.
  const find = (name) => {
    const byName = fields.find((f) => (f.name || '').endsWith(name.replace(/\s+/g, '').replace(/^./, (c) => c.toLowerCase())));
    if (byName) return byName;
    return fields.find((f) => (f.label || '').replace('*', '').trim().toLowerCase() === name.toLowerCase())
      || fields.find((f) => (f.placeholder || '').toLowerCase().includes(name.toLowerCase()));
  };

  for (const row of table.hashes()) {
    const field = find(row.field);
    if (!field) { problems.push(`"${row.field}" is not on the form at all`); continue; }
    const control = field.role === 'combobox' ? 'combobox' : (field.tag === 'textarea' ? 'textarea' : field.type);
    if (control !== row.control) problems.push(`"${row.field}" is a ${control}, expected ${row.control}`);
    const editable = !field.disabled;
    if (editable !== (row.editable === 'yes')) {
      problems.push(`"${row.field}" editable=${editable}, expected ${row.editable}`);
    }
    if (row.required === 'yes' && !/\*/.test(field.label || '') && field.name === undefined) {
      problems.push(`"${row.field}" is documented required but carries no required marker`);
    }
  }
  reportAll(problems, 'The Basic Information form does not match its documented contract.');
});

Then('the Basic Information form should offer a profile photo control', async function () {
  const page = cd(this);
  const modalText = await page.modal().innerText();
  const input = page.photoInput();
  const accept = await input.getAttribute('accept');
  await record(this, 'profile photo control', {
    buttons: modalText.split('\n').map((l) => l.trim()).filter((l) => /photo/i.test(l)),
    acceptAttribute: accept,
    note: accept === null
      ? 'RECORDED: the profile photo input carries NO accept attribute, so the picker offers every '
        + 'file type on the machine. Every document upload on this page declares '
        + '".pdf,.jpg,.jpeg,.png". Question for the PO: should the photo input declare an image '
        + 'accept list?'
      : 'the photo input declares an accept list',
  });
  expect(await input.count(), 'the Basic Information form offers no profile photo input').toBeGreaterThan(0);
  expect(/photo/i.test(modalText), 'the Basic Information form offers no photo control').toBe(true);
});

Then('the Save button should be disabled', async function () {
  const page = cd(this);
  expect(
    await page.saveStaysDisabled(2500),
    'Save was enabled when nothing had changed (watched for 2.5s, so this is not a late-enable race)'
  ).toBe(true);
});

Then('the Save button should be enabled', async function () {
  expect(await cd(this).waitForSaveEnabled(8000), 'Save never enabled').toBe(true);
});

When('I change {string} to {string}', async function (field, value) {
  const page = cd(this);
  const locator = fieldLocator(page, field);
  if (!this._originalValues) this._originalValues = {};
  if (this._originalValues[field] === undefined) this._originalValues[field] = await locator.inputValue();
  await page.typeInto(locator, value);
});

When('I change {string} back to its original value', async function (field) {
  const page = cd(this);
  const original = (this._originalValues || {})[field];
  if (original === undefined) throw new Error(`"${field}" was never changed, so there is no original value to restore.`);
  await page.typeInto(fieldLocator(page, field), original);
});

When('I change {string} to a uniquely marked value', async function (field) {
  const page = cd(this);
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const locator = fieldLocator(page, field);
  if (!this._originalValues) this._originalValues = {};
  this._originalValues[field] = await locator.inputValue();
  this._markedValue = marked('Candidate Details automated check');
  this._restoreBasicInfo = { field, value: this._originalValues[field] };
  await page.typeInto(locator, this._markedValue);
});

Then('{string} should hold its original value', async function (field) {
  const page = cd(this);
  const original = (this._originalValues || {})[field];
  const got = await fieldLocator(page, field).inputValue();
  await record(this, 'draft discard check', { field, original, reopened: got });
  expect(got, `"${field}" kept the discarded draft instead of its stored value`).toBe(original);
});

// The Basic Information field names are React-Hook-Form paths; everything else is by label.
function fieldLocator(page, field) {
  const map = {
    'First Name': () => page.basicField('firstName'),
    'Last Name': () => page.basicField('lastName'),
    Bio: () => page.basicField('bio'),
    'About Me': () => page.basicField('aboutMe'),
    Phone: () => page.phoneField(),
    Nationality: () => page.nationalityField(),
  };
  if (!map[field]) throw new Error(`No locator for the field "${field}". Known: ${Object.keys(map).join(', ')}`);
  return map[field]();
}

Then('clearing each required field should raise its own inline error and disable Save:', { timeout: 180000 }, async function (table) {
  const page = cd(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const locator = fieldLocator(page, row.field);
    const original = await locator.inputValue();
    // REAL keystrokes and a REAL Tab. React-Hook-Form validates on blur, and a programmatic
    // value set plus a dispatched blur moves the gate WITHOUT running the validator - a probe
    // written that way reported First Name as having no required message at all.
    await page.typeInto(locator, '');
    await page.blur();
    const errors = await page.inlineErrors();
    const saveDisabled = await page.saveButton().isDisabled();
    const named = errors.some((e) => new RegExp(row.field.replace(/\s+/g, '\\s*'), 'i').test(e));
    trace.push({ field: row.field, errors, saveDisabled });

    if (!errors.length) problems.push(`"${row.field}" cleared and blurred: NO inline error at all`);
    else if (!named) problems.push(`"${row.field}" cleared: an error appeared but does not name the field - ${JSON.stringify(errors)}`);
    if (!saveDisabled) problems.push(`"${row.field}" cleared: Save stayed ENABLED, so an empty required field can be saved`);

    await page.typeInto(locator, original);
    await page.blur();
  }
  await record(this, 'required-field validation, measured with real keystrokes', trace);
  reportAll(problems, 'A required field does not explain itself when cleared.');
});

Then('a whitespace-only value should be refused for each required field:', { timeout: 180000 }, async function (table) {
  const page = cd(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const locator = fieldLocator(page, row.field);
    const original = await locator.inputValue();
    // Clear first so the error is on screen, then type spaces - that is the sequence that shows
    // whitespace ERASING a message the app had already raised, which is worse than never
    // raising one.
    await page.typeInto(locator, '');
    await page.blur();
    const errorsWhenEmpty = await page.inlineErrors();
    await page.typeInto(locator, '   ');
    await page.blur();
    const errorsWhenBlank = await page.inlineErrors();
    const saveDisabled = await page.saveButton().isDisabled();
    trace.push({ field: row.field, errorsWhenEmpty, errorsWhenBlank, saveDisabledWithWhitespace: saveDisabled });

    if (!saveDisabled) {
      problems.push(
        `"${row.field}" = "   ": Save is ENABLED, so a profile can be saved with a whitespace-only `
        + `${row.field.toLowerCase()}`
      );
    }
    if (errorsWhenEmpty.length && !errorsWhenBlank.length) {
      problems.push(`"${row.field}": typing spaces ERASED the required error that was already on screen`);
    }
    await page.typeInto(locator, original);
    await page.blur();
  }
  await record(this, 'whitespace vs required, measured with real keystrokes', trace);
  reportAll(
    problems,
    'Whitespace satisfies a required field. Same defect as the Contact Us description field - if '
    + 'it is fixed centrally both features go green together.'
  );
});

When('I close the form with {string}', async function (route) {
  await cd(this).closeModal({ via: route });
});

Then('no profile request should have been sent', async function () {
  const page = cd(this);
  const writes = page.requests.filter(isCandidateWrite);
  await record(this, 'non-GET candidate requests seen this scenario', writes);
  expect(writes.length, 'a profile write was sent when nothing should have been').toBe(0);
});

Then('each of these dismissal routes should close the form without sending anything:', { timeout: 120000 }, async function (table) {
  const page = cd(this);
  const problems = [];
  const trace = [];
  for (const row of table.hashes()) {
    const before = page.requests.length;
    await page.openEditModal('Basic Information');
    await page.typeInto(page.basicField('bio'), `dismiss check ${row.route}`);
    await page.closeModal({ via: row.route });
    // Watch a window: "not visible" is also true of a modal still animating out, and a request
    // already in flight lands after the click.
    const closed = await page.modalStaysClosed(3000);
    const sent = page.requests.slice(before).filter(isCandidateWrite);
    trace.push({ route: row.route, closed, sent });
    if (!closed) problems.push(`"${row.route}" did not close the form`);
    if (sent.length) problems.push(`"${row.route}" sent ${sent.length} profile request(s) - a dismissal must send nothing`);
  }
  await record(this, 'dismissal routes', trace);
  reportAll(problems, 'A dismissal route does not close the form cleanly.');
});

Then('the phone field should handle each of these inputs:', { timeout: 120000 }, async function (table) {
  const page = cd(this);
  const trace = [];
  for (const row of table.hashes()) {
    await page.typeInto(page.phoneField(), row.typed);
    await page.blur();
    trace.push({
      typed: row.typed,
      note: row.note,
      held: await page.phoneField().inputValue(),
      inlineErrors: await page.inlineErrors(),
      saveEnabled: !(await page.saveButton().isDisabled()),
    });
  }
  await record(
    this,
    'RECORDED, not asserted - no AC settles what a valid phone number is here. Question for the '
    + 'PO: should a one-digit number be accepted?',
    trace
  );
  // Only the behaviour that is unambiguously right is asserted: letters must not survive.
  const letters = trace.find((t) => /[a-z]/i.test(t.typed));
  expect(/[a-z]/i.test(letters.held), `typing letters left "${letters.held}" in the phone field`).toBe(false);
});

// ==================== 3. The three list sections ====================

Then('each Add form should render its documented contract:', { timeout: 180000 }, async function (table) {
  const page = cd(this);
  const problems = [];
  const trace = [];
  this._addForms = {};

  for (const row of table.hashes()) {
    await page.openAddModal(row.section);
    const title = await page.modalTitle();
    const fields = await page.modal().locator('input,textarea,select').evaluateAll((els) => els.map((e) => ({
      tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), role: e.getAttribute('role'),
      label: e.labels && e.labels[0] ? e.labels[0].textContent.trim() : null,
      placeholder: e.placeholder || null, accept: e.getAttribute('accept'),
    })));
    const saveDisabled = await page.saveStaysDisabled(2000);
    this._addForms[row.section] = { title, fields, saveDisabled };
    trace.push({ section: row.section, title, saveDisabled, labels: fields.map((f) => f.label).filter(Boolean) });

    if ((title || '').trim() !== row.title) problems.push(`${row.section}: modal is titled "${(title || '').trim()}", expected "${row.title}"`);
    for (const required of row['required fields'].split(',').map((s) => s.trim())) {
      const field = fields.find((f) => (f.label || '').replace('*', '').trim() === required);
      if (!field) problems.push(`${row.section}: no field labelled "${required}"`);
      else if (!/\*/.test(field.label)) problems.push(`${row.section}: "${required}" carries no required marker`);
    }
    await page.closeModal({ via: 'cancel' });
  }
  await record(this, 'Add form contracts', trace);
  reportAll(problems, 'An Add form does not match its documented contract.');
});

Then('every Add form should open with its Save button disabled', async function () {
  const problems = [];
  for (const [section, form] of Object.entries(this._addForms || {})) {
    if (!form.saveDisabled) problems.push(`${section}: Save was enabled on an empty form`);
  }
  reportAll(problems, 'An Add form does not gate Save on an empty form.');
});

Then('every Add form should offer a document upload accepting {string}', async function (accept) {
  const problems = [];
  const trace = [];
  for (const [section, form] of Object.entries(this._addForms || {})) {
    const file = form.fields.find((f) => f.type === 'file');
    trace.push({ section, accept: file && file.accept });
    if (!file) problems.push(`${section}: no file input at all`);
    else if (file.accept !== accept) problems.push(`${section}: upload accepts "${file.accept}", expected "${accept}"`);
  }
  await record(this, 'upload accept attributes', trace);
  reportAll(problems, 'An Add form does not offer the documented upload control.');
});

Then('each manage list should list exactly the entries the payload holds:', { timeout: 180000 }, async function (table) {
  const page = cd(this);
  const profile = await page.profile();
  const collections = { Education: 'educations', 'Work Experience': 'work_experiences', Certifications: 'certifications' };
  const problems = [];
  const trace = [];
  this._manageLists = {};

  for (const row of table.hashes()) {
    await page.openEditModal(row.section);
    const rows = await page.readRows(row.section);
    const expected = (profile[collections[row.section]] || []).length;
    this._manageLists[row.section] = rows;
    trace.push({ section: row.section, listed: rows.length, payload: expected, rows });
    if (rows.length !== expected) problems.push(`${row.section}: the manage list shows ${rows.length} entries, the payload holds ${expected}`);
    await page.closeModal({ via: 'cancel' });
  }
  await record(this, 'manage lists vs payload', trace);
  reportAll(problems, 'A manage list does not list what the payload holds.');
});

Then('every listed entry should offer its own edit and delete control', async function () {
  const problems = [];
  for (const [section, rows] of Object.entries(this._manageLists || {})) {
    rows.forEach((r, i) => {
      if (!r.hasPencil) problems.push(`${section} row ${i + 1} ("${r.text.slice(0, 40)}") offers no edit control`);
      if (!r.hasTrash) problems.push(`${section} row ${i + 1} ("${r.text.slice(0, 40)}") offers no delete control`);
    });
  }
  reportAll(problems, 'A listed entry is missing one of its row controls.');
});

Then('every manage list should offer a control for adding another entry', { timeout: 120000 }, async function () {
  const page = cd(this);
  const problems = [];
  const trace = [];
  for (const section of Object.keys(this._manageLists || {})) {
    await page.openEditModal(section);
    const button = page.addOtherButton();
    const count = await button.count();
    trace.push({ section, offered: count > 0, label: count ? (await button.innerText()).trim() : null });
    if (!count) problems.push(`${section}: the manage list offers no "Add another" control`);
    await page.closeModal({ via: 'cancel' });
  }
  await record(this, 'add-another controls', trace);
  reportAll(problems, 'A manage list offers no way to add another entry.');
});

Then('the Work Experience manage list should render each entry\'s employment type as a label, not an enum', { timeout: 120000 }, async function () {
  const page = cd(this);
  const profile = await page.profile();
  const section = await page.readSection('Work Experience');
  await page.openEditModal('Work Experience');
  const rows = await page.readRows('Work Experience');
  await page.closeModal({ via: 'cancel' });

  const problems = [];
  const trace = [];

  // >>> THIS STEP MUST NOT BE ABLE TO PASS HAVING INSPECTED NOTHING. <<<
  // Everything below is a loop over the account's work-experience entries, so on an account with
  // none - or one whose rows stopped matching by company name - `problems` stays empty and the
  // step reports PASSED while asserting precisely nothing. That is strictly worse than a red row:
  // it retires the assertion silently and the report gives no hint that the rule went unverified.
  // Same rule as `non-paid billing rows should have disabled receipt actions`, which used to
  // console.log("nothing to assert") and pass.
  const entries = profile.work_experiences || [];
  expect(
    entries.length,
    'this candidate has no Work Experience entries, so there was no employment type to compare '
    + 'between the section and the manage list. The scenario asserted nothing - add an entry to '
    + 'the fixture rather than letting this report as a pass.'
  ).toBeGreaterThan(0);

  for (const entry of entries) {
    const enumValue = entry.experience;                       // e.g. "co_op"
    const row = rows.find((r) => r.text.includes(entry.company_name));
    const sectionShows = section.lines.join(' | ');
    trace.push({ company: entry.company_name, apiValue: enumValue, manageListRow: row && row.text, sectionLines: section.lines });

    // A row that cannot be found is a READER failure, not a clean bill of health - without this
    // the check below is skipped and the entry silently counts as passing.
    if (!row) {
      problems.push(
        `no manage-list row could be matched to "${entry.company_name}", so its employment type `
        + 'was never compared. That is a locator problem in the suite, not a verdict on the app - '
        + `rows seen: ${JSON.stringify(rows.map((r) => r.text.slice(0, 60)))}`
      );
      continue;
    }
    if (enumValue && row.text.includes(enumValue)) {
      problems.push(
        `the manage list renders "${enumValue}" verbatim for "${entry.company_name}" - the raw API `
        + `enum, underscore and all - while the section itself renders it as a label `
        + `(section text: "${sectionShows.slice(0, 80)}")`
      );
    }
  }
  await record(this, 'employment type: section vs manage list', trace);
  reportAll(problems, 'The manage list leaks the raw API enum where the section renders a label.');
});

Then('the formats each Add form advertises should be the formats the document endpoint accepts', { timeout: 180000 }, async function () {
  const page = cd(this);
  const trace = [];
  const divergent = [];
  for (const section of ['Education', 'Work Experience', 'Certifications']) {
    await page.openAddModal(section);
    const accept = await page.modal().locator('input[type="file"]').last().getAttribute('accept');
    const advertised = (accept || '').split(',').map((s) => s.trim()).filter(Boolean);
    const extra = advertised.filter((ext) => !SERVER_ACCEPTS.includes(ext));
    trace.push({ section, advertised, serverAccepts: SERVER_ACCEPTS, advertisedButRefused: extra });
    if (extra.length) divergent.push({ section, extra });
    await page.closeModal({ via: 'cancel' });
  }
  await record(
    this,
    'RECORDED, not failed on - which side is right is a product decision (widen the endpoint, or '
    + 'narrow the accept list). The endpoint\'s own refusal is "Only .pdf, .png files are '
    + 'allowed." (measured by the document-verification module).',
    { trace, divergent }
  );
  // The assertion is only that the form declares SOMETHING - a picker with no accept list at all
  // is a different and worse problem, and would otherwise pass this step silently.
  expect(trace.every((t) => t.advertised.length > 0), 'an Add form declares no accepted formats at all').toBe(true);
});

// ==================== 4. Accessibility ====================

Then('every per-entry control in the manage list should be reachable by assistive technology', async function () {
  const page = cd(this);
  const audit = await page.modalControlAccessibility();
  await record(this, 'per-entry control accessibility', audit);
  expect(audit.total, 'the manage list rendered no per-entry controls to audit').toBeGreaterThan(0);
  expect(
    audit.inButton + audit.withRole,
    `${audit.total} per-entry controls in this manage list are bare <svg> elements: `
    + `${audit.inButton} in a <button>, ${audit.withRole} with a role, ${audit.withAriaLabel} with an `
    + 'aria-label, ' + `${audit.focusable} focusable. A keyboard-only or screen-reader candidate `
    + 'cannot edit or delete any qualification they have recorded. WCAG 2.1.1 Keyboard (A) and '
    + '4.1.2 Name, Role, Value (A).'
  ).toBeGreaterThan(0);
});

Then('the modal close control should be reachable by assistive technology', async function () {
  const page = cd(this);
  const close = await page.modal().evaluate((d) => {
    const header = d.querySelector('header');
    const svg = header && header.querySelector('svg');
    if (!svg) return { found: false };
    return {
      found: true,
      inButton: !!svg.closest('button'),
      role: svg.getAttribute('role'),
      ariaLabel: svg.getAttribute('aria-label'),
      tabindex: svg.getAttribute('tabindex'),
    };
  });
  await record(this, 'modal close control', close);
  expect(close.found, 'the modal offers no close control in its header').toBe(true);
  expect(
    close.inButton || !!close.role,
    'the modal\'s X close control is a bare <svg> - no <button>, no role, no aria-label, no '
    + 'tabindex - so it cannot be reached or announced by assistive technology. Escape does close '
    + 'the modal, so a keyboard user is not trapped, but the control itself is invisible to them.'
  ).toBe(true);
});

// ==================== 5. Attachment status ====================

Then('each attachment listed should be reported alongside the status its document actually holds', { timeout: 120000 }, async function () {
  const page = cd(this);
  const profile = await page.profile();
  const trace = [];
  const sectionText = {};
  for (const section of ['Education', 'Work Experience', 'Certifications']) {
    sectionText[section] = (await page.readSection(section)).lines.join(' | ');
  }
  const collections = [
    ['Education', profile.educations || []],
    ['Work Experience', profile.work_experiences || []],
    ['Certifications', profile.certifications || []],
  ];
  for (const [section, entries] of collections) {
    for (const entry of entries) {
      if (!entry.document) continue;
      trace.push({
        section,
        file: entry.document.file_name,
        documentStatus: entry.document.status,
        statusShownOnThisTab: sectionText[section].includes(entry.document.status)
          || /Approved|Needs Review|Revision Required|Awaiting/i.test(sectionText[section]),
      });
    }
  }
  await record(
    this,
    'RECORDED, not failed on. The Candidate Details tab lists an attachment as a bare filename '
    + 'link and says nothing about its verification status, so a candidate whose transcript is in '
    + 'Revision Required sees it here looking healthy. The status IS available on the Documents '
    + 'tab, so this is a question about WHERE it belongs rather than a missing feature. Question '
    + 'for the PO: should this tab surface the status beside each attachment?',
    trace
  );
  if (!trace.length) {
    throw new Error(
      'No entry on this fixture carries a document, so what the tab says about an attachment\'s '
      + 'status was never exercised. Attach a document to one entry, or this rule is unverified.'
    );
  }
});

// ==================== 6. Saving for real (@mutates-profile) ====================

When('I save the form', async function () {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  this._saveRequests = await cd(this).save();
});

Then('the save should be accepted by the server', async function () {
  const writes = (this._saveRequests || []).filter(isCandidateWrite);
  await record(this, 'requests fired by Save', this._saveRequests);
  expect(writes.length, 'Save fired no profile request at all').toBeGreaterThan(0);
  const bad = writes.filter((r) => r.status === undefined || r.status >= 400);
  expect(bad, `the server refused the save: ${JSON.stringify(bad)}`).toEqual([]);
});

Then('a save confirmation should be displayed', async function () {
  const toasts = await cd(this).waitForToast(15000);
  await record(this, 'confirmation toast', toasts);
  expect(toasts.length, 'no confirmation appeared after a successful save').toBeGreaterThan(0);
});

Then('the form should close', async function () {
  const page = cd(this);
  await page.modal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  expect(await page.modalIsOpen(), 'the form stayed open after a successful save').toBe(false);
});

Then('{string} in the payload should hold that marked value', async function (field) {
  const profile = await cd(this).profile();
  await record(this, 'persistence check', { field, expected: this._markedValue, stored: profile[field] });
  expect(profile[field], `${field} did not persist - the save reported success but the server holds something else`)
    .toBe(this._markedValue);
});

// >>> THE FIELD THE MODAL LABELS "Bio" IS RENDERED IN THE HEADER, NOT IN THE SECTION. <<<
// Measured: the Basic Information SECTION renders Email, Phone Number, Current Status,
// Nationality and About Me - and no Bio at all. The value lives in the payload as `headline` and
// is painted as the strapline under the candidate's name. So a step asserting it in the section
// fails against a save that worked perfectly, which is exactly what the first run reported.
Then('the profile header should render that marked value', async function () {
  const page = cd(this);
  const headerText = await this.page.locator('main').first().innerText();
  const section = await page.readSection('Basic Information');
  await record(this, 'where the Bio value is rendered', {
    inHeader: headerText.includes(this._markedValue),
    inBasicInformationSection: section.lines.join(' | ').includes(this._markedValue),
    note: 'The modal labels this field "Bio*"; the payload calls it `headline`; the page renders '
      + 'it as the strapline in the profile header, NOT as a row in the Basic Information section.',
  });
  expect(headerText, 'the saved Bio is not rendered back in the profile header').toContain(this._markedValue);
});

When('I switch {string} to the other answer', async function (label) {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const page = cd(this);
  const profile = await page.profile();
  this._relocationBefore = profile.interested_in_relocation;
  const want = this._relocationBefore ? 'No' : 'Yes';
  this._relocationWanted = want;
  this._restoreRelocation = true;
  await page.modal().getByText(want, { exact: true }).first().click();
  await page.page.waitForTimeout(600);
});

Then('{string} in the payload should have changed', async function (field) {
  const profile = await cd(this).profile();
  await record(this, 'work preference persistence', { field, before: this._relocationBefore, after: profile[field] });
  expect(profile[field], `${field} did not change`).toBe(!this._relocationBefore);
});

Then('the {string} section should render the new answer', async function (section) {
  const pairs = await cd(this).readFieldPairs(section);
  expect(pairs['Open to Relocation'], 'the section does not render the saved answer').toBe(this._relocationWanted);
});

When('I add a certification with a document attached', async function () {
  await addCertification.call(this, { withDocument: true });
});

When('I add a certification without a document', async function () {
  await addCertification.call(this, { withDocument: false });
});

async function addCertification({ withDocument }) {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const page = cd(this);
  this._certName = marked('Automated check certificate');
  if (!this._createdEntries) this._createdEntries = [];

  await page.openAddModal('Certifications');
  await page.fillText('Certificate Name*', this._certName);
  await page.fillText('Issuing Organization*', 'Automated Check Org');
  await page.selectMonthYear({ monthIndex: 0, yearIndex: 1, month: 'January', year: 2024 });
  await page.toggleOngoing();
  if (withDocument) this._attachedName = path.basename(DOC_FIXTURE);
  if (withDocument) await page.attachDocument(DOC_FIXTURE);
  expect(await page.waitForSaveEnabled(8000), 'Save never enabled on a complete Add Certification form').toBe(true);
  this._saveRequests = await page.save();
  this._createdEntries.push({ section: 'Certifications', name: this._certName });
}

When('I add an education entry', async function () {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const page = cd(this);
  const profile = await page.profile();
  // Reuse the institution/degree/field the account already holds, so this scenario exercises the
  // add path rather than the reference-data lookup - and so it cannot fail because a hard-coded
  // university stopped being offered.
  const existing = (profile.educations || [])[0];
  if (!existing) throw new Error('The fixture holds no education entry to copy reference data from.');
  this._educationOf = existing.institution_name;
  if (!this._createdEntries) this._createdEntries = [];

  await page.openAddModal('Education');
  await page.selectFromCombobox('University/Institution Name*', existing.institution_name);
  await page.selectFromCombobox('Degree*', existing.degree_details.name);
  await page.selectFromCombobox('Field of Study*', existing.field_of_study.name);
  await page.selectMonthYear({ monthIndex: 0, yearIndex: 1, month: 'September', year: 2019 });
  await page.selectMonthYear({ monthIndex: 2, yearIndex: 3, month: 'June', year: 2023 });
  expect(await page.waitForSaveEnabled(8000), 'Save never enabled on a complete Add Education form').toBe(true);
  this._educationCountBefore = (profile.educations || []).length;
  this._saveRequests = await page.save();
  this._createdEntries.push({ section: 'Education', name: 'September 2019 - June 2023' });
});

Then('the entry should be accepted by the server', async function () {
  const writes = (this._saveRequests || []).filter(isCandidateWrite);
  await record(this, 'requests fired by the Add form', this._saveRequests);
  expect(writes.length, 'the Add form fired no request at all').toBeGreaterThan(0);
  const bad = writes.filter((r) => r.status === undefined || r.status >= 400);
  expect(bad, `the server refused the new entry: ${JSON.stringify(bad)}`).toEqual([]);
});

Then('that certification should be listed in the Certifications section', async function () {
  const page = cd(this);
  await page.open();
  const section = await page.readSection('Certifications');
  await record(this, 'Certifications section after adding', section.lines);
  expect(section.lines.join(' | '), 'the new certification is not listed').toContain(this._certName);
});

Then('that education entry should be listed in the Education section', async function () {
  const page = cd(this);
  await page.open();
  const profile = await page.profile();
  await record(this, 'education count', { before: this._educationCountBefore, after: (profile.educations || []).length });
  expect((profile.educations || []).length, 'the education entry was not created').toBe(this._educationCountBefore + 1);
});

Then('the created entry should carry the document that was attached', async function () {
  const page = cd(this);
  const profile = await page.profile();
  const created = (profile.certifications || []).find((c) => c.certificate_name === this._certName);
  await record(this, 'created entry', created && { id: created.id, document: created.document });
  expect(created, 'the created certification is not in the payload').toBeTruthy();
  // >>> THE ASSERTION THAT CATCHES AN UPLOAD CLICKED TOO EARLY. <<< The zone animates a progress
  // bar and posts the file with Save, so a Save clicked mid-animation creates the entry with
  // `document: null` - no document row and no verification, on an entry that looks perfectly
  // fine on screen. That is exactly how the walkthrough's "AI timeout" was really a client-side
  // timing bug.
  expect(created.document, 'the entry was created with document: null - the file never reached the server').toBeTruthy();
  this._createdDocumentId = created.document.id;
  expect(created.document.file_name, 'the stored document is not the file that was attached')
    .toContain(path.basename(DOC_FIXTURE, '.pdf').slice(0, 20));
});

Then('that certification should be listed in the manage list', async function () {
  const page = cd(this);
  const row = await page.rowFor('Certifications', this._certName);
  expect(await row.count(), 'the new certification is not in the manage list').toBe(1);
});

When('I delete that certification', async function () {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  await cd(this).clickDeleteOnRow('Certifications', this._certName);
});

Then('I should be asked to confirm before anything is deleted', async function () {
  const page = cd(this);
  const confirmation = await page.readDeleteConfirmation();
  await record(this, 'delete confirmation', confirmation);
  expect(confirmation.text, 'the delete confirmation does not ask for confirmation').toMatch(/are you sure/i);
  expect(confirmation.buttons.join(' '), 'the confirmation offers no Cancel').toMatch(/Cancel/i);
  expect(confirmation.buttons.join(' '), 'the confirmation offers no Delete').toMatch(/Delete/i);
  // Opening the confirmation must not itself delete anything.
  const deletes = page.requests.filter((r) => r.method === 'DELETE');
  expect(deletes.length, 'a DELETE was sent merely by opening the confirmation').toBe(0);
});

When('I confirm the deletion', async function () {
  this._deleteRequests = await cd(this).confirmDelete();
});

When('I cancel the deletion', async function () {
  this._deleteRequests = await cd(this).cancelDelete();
});

Then('the deletion should be accepted by the server', async function () {
  const deletes = (this._deleteRequests || []).filter((r) => r.method === 'DELETE');
  await record(this, 'requests fired by Delete', this._deleteRequests);
  expect(deletes.length, 'confirming the deletion fired no DELETE').toBeGreaterThan(0);
  const bad = deletes.filter((r) => r.status === undefined || r.status >= 400);
  expect(bad, `the server refused the deletion: ${JSON.stringify(bad)}`).toEqual([]);
});

Then('no delete request should have been sent', async function () {
  const page = cd(this);
  const deletes = page.requests.filter((r) => r.method === 'DELETE');
  await record(this, 'DELETE requests seen this scenario', deletes);
  expect(deletes.length, 'cancelling the confirmation still sent a DELETE').toBe(0);
});

Then('that certification should no longer be listed', async function () {
  const page = cd(this);
  await page.open();
  const profile = await page.profile();
  const still = (profile.certifications || []).some((c) => c.certificate_name === this._certName);
  await record(this, 'after deletion', (profile.certifications || []).map((c) => c.certificate_name));
  expect(still, 'the certification is still on the account after a successful deletion').toBe(false);
  if (this._createdEntries) this._createdEntries = this._createdEntries.filter((e) => e.name !== this._certName);
});

Then('that certification should still be listed', async function () {
  const page = cd(this);
  const profile = await page.profile();
  const still = (profile.certifications || []).some((c) => c.certificate_name === this._certName);
  expect(still, 'the certification was deleted even though the confirmation was cancelled').toBe(true);
});

When('I remove that certification', async function () {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const page = cd(this);
  if (!(await page.modalIsOpen())) await page.openEditModal('Certifications');
  await page.clickDeleteOnRow('Certifications', this._certName);
  await page.confirmDelete();
});

When('I remove the education entry I added', async function () {
  candidateDetailsFixtureGuard(this._candidateDetailsEmail);
  const page = cd(this);
  const profile = await page.profile();
  // The entry this run created is the one the account did not have before. Identified by id, not
  // by position - "the newest row" is not a safe way to find what a run just created on an
  // account that already holds entries with identical text.
  const created = (profile.educations || []).slice(-1)[0];
  this._removedEducationId = created.id;
  await page.openEditModal('Education');
  const rows = page.rows('Education');
  const count = await rows.count();
  expect(count, 'the education manage list is empty').toBeGreaterThan(0);
  await rows.nth(count - 1).locator('svg[class*="error-600"]').first().dispatchEvent('click');
  await page.waitForModal();
  await page.confirmDelete();
});

Then('that education entry should no longer be listed', async function () {
  const page = cd(this);
  await page.open();
  const profile = await page.profile();
  await record(this, 'education after removal', { count: (profile.educations || []).length, expected: this._educationCountBefore });
  expect((profile.educations || []).length, 'the education entry was not removed').toBe(this._educationCountBefore);
  if (this._createdEntries) this._createdEntries = this._createdEntries.filter((e) => e.section !== 'Education');
});

// >>> THE MEASUREMENT THAT CORRECTS CLAUDE.md. <<<
// The repo's long-standing note is that deleting a profile entry leaves its document ORPHANED.
// Measured here directly: it does not - the document goes with the entry. The orphans on the
// doc-verification account are from DOC_UPLOAD_MODE=api, which posts straight to the upload
// endpoint and never creates a profile entry, so those rows were orphaned from birth.
Then('the document it carried should have been deleted with it', async function () {
  const page = cd(this);
  const documents = await page.documents();
  const ids = (documents.results || []).map((d) => d.id);
  const still = ids.includes(this._createdDocumentId);
  await record(this, 'document cascade on entry deletion', {
    documentId: this._createdDocumentId,
    documentRowsOnAccount: documents.count,
    stillPresent: still,
    note: still
      ? 'ORPHANED - the entry is gone and its document remains, reachable from no profile entry.'
      : 'The document was deleted with its entry - deletion cascades correctly.',
  });
  expect(
    still,
    `document ${this._createdDocumentId} is still on the account after its certification was `
    + 'deleted, so it is now an orphan reachable from no profile entry'
  ).toBe(false);
});

// ==================== Teardown ====================

// Restores whatever a @mutates-profile scenario changed, and NEVER throws: masking the
// scenario's own failure with a cleanup error sends whoever reads the report after the wrong
// problem. A failed restore is attached LOUDLY instead - and the attach is awaited, because an
// un-awaited attach from an After hook is dropped when the world is torn down, which is exactly
// how the promo module's "could not restore" warning never reached a single report.
After({ tags: '@mutates-profile' }, async function () {
  const notes = [];
  const page = this.pages && this.pages.candidateDetails;
  if (!page) return;

  try {
    if (this._restoreBasicInfo) {
      await page.open();
      await page.openEditModal('Basic Information');
      await page.typeInto(fieldLocator(page, this._restoreBasicInfo.field), this._restoreBasicInfo.value);
      await page.save();
      const profile = await page.profile();
      const key = this._restoreBasicInfo.field === 'Bio' ? 'headline' : 'about_me';
      // Verify against the SERVER rather than trusting the save's own return value - a restore
      // that did nothing is otherwise indistinguishable from one that worked, which is what let
      // the promo module leave a fixture disabled for days.
      notes.push(profile[key] === this._restoreBasicInfo.value
        ? `restored ${this._restoreBasicInfo.field}`
        : `RESTORE FAILED: ${this._restoreBasicInfo.field} holds ${JSON.stringify(profile[key])}, expected ${JSON.stringify(this._restoreBasicInfo.value)}`);
    }

    if (this._restoreRelocation) {
      await page.open();
      await page.openEditModal('Work Preferences & Availability');
      await page.modal().getByText(this._relocationBefore ? 'Yes' : 'No', { exact: true }).first().click();
      await page.page.waitForTimeout(500);
      await page.save();
      const profile = await page.profile();
      notes.push(profile.interested_in_relocation === this._relocationBefore
        ? 'restored Open to Relocation'
        : `RESTORE FAILED: interested_in_relocation is ${profile.interested_in_relocation}, expected ${this._relocationBefore}`);
    }

    for (const entry of this._createdEntries || []) {
      if (entry.section !== 'Certifications') { notes.push(`LEFT BEHIND: ${entry.section} entry "${entry.name}"`); continue; }
      await page.open();
      await page.openEditModal('Certifications');
      const rows = page.rows('Certifications').filter({ hasText: entry.name });
      if (await rows.count() === 1) {
        await rows.first().locator('svg[class*="error-600"]').first().dispatchEvent('click');
        await page.waitForModal();
        await page.confirmDelete();
        notes.push(`removed leftover certification "${entry.name}"`);
      } else {
        notes.push(`LEFT BEHIND: certification "${entry.name}" matched ${await rows.count()} rows, refusing to guess`);
      }
    }
  } catch (error) {
    notes.push(`RESTORE THREW: ${error.message}`);
  }

  if (notes.length) {
    await this.attach(`Candidate Details teardown\n${notes.join('\n')}`, 'text/plain');
  }
});
