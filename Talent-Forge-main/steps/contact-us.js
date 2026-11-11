// Step definitions for features/Candidate_Portal/Contact-us.feature - the Candidate Portal's
// "Contact Us" support-request modal.
//
// >>> EVERY PHRASE HERE IS WORDED "... Contact Us ..." OR "... the screenshot ...", DELIBERATELY.
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
// fails generation on it instead). "I am logged in as a candidate" already exists in
// steps/subscription.js and signs in as the SHARED CANDIDATE_EMAIL, so this feature's Background
// is worded "the Contact Us candidate" and binds its own fixture. Reusing the generic phrase
// would silently drive a different account - the class of fault that spent
// REFERRAL_NOPROMO_AGENT's zero-candidate state on 2026-08-27.
//
// >>> EVERY @submits-request SCENARIO RAISES A REAL, PERMANENT SUPPORT REQUEST. <<<
// POST /core/api/v1/candidate/feedback/ is POST-only (a GET answers 405) and no control in the
// portal lists or withdraws one. contactUsFixtureGuard() is the backstop: it is POSITIVE and
// identity-based, naming the one account that may submit, and refuses everything else
// regardless of tags, hooks or which step is calling. A tag-driven guard is one missing hook
// away from submitting as the wrong candidate.
//
// MEASURED LIVE 2026-09-14 (scripts/probe-contact-us.js, -2.js, -upload.js). Everything asserted
// here was read off the running app; nothing is inferred from an AC.

const fs = require('fs');
const path = require('path');
const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ContactUsPage = require('../pages/ContactUsPage');

const FIXTURE_DIR = path.join(__dirname, '..', 'images to upload for testing');

// The one account that may raise a support request from this suite. Identity-based on purpose -
// see the header. CONTACTUS_EMAIL is the dedicated fixture; the shared CANDIDATE_EMAIL is the
// login for the subscription, promo and document-verification suites and must never be used to
// file support tickets against its agent.
function contactUsFixtureGuard(email) {
  const allowed = (process.env.CONTACTUS_EMAIL || '').trim().toLowerCase();
  if (!allowed) {
    throw new Error(
      'contactUsFixtureGuard: CONTACTUS_EMAIL is not set in .env, so there is no account ' +
        'authorised to submit a support request. Refusing to submit.'
    );
  }
  if (String(email || '').trim().toLowerCase() !== allowed) {
    throw new Error(
      `contactUsFixtureGuard: REFUSING to submit a support request as "${email}". A submission ` +
        'is PERMANENT - the feedback endpoint is POST-only and nothing in the portal withdraws ' +
        `one. Only ${allowed} (CONTACTUS_EMAIL) may submit.`
    );
  }
}

// Curly vs straight apostrophes and hyphen vs en dash are invisible in a source file and have
// already cost this feature one red row against copy that was word-for-word correct - the
// heading uses a STRAIGHT U+0027 while the sub-heading beside it uses an EN DASH U+2013. Copy
// assertions compare through this, and record the RAW text beside it so a genuine wording change
// is still visible in the report.
function normaliseTypography(text) {
  return String(text)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Attach evidence to the report on every measuring step. On a red row it is the evidence; on a
// green one it is the record of what the app did that day, which is what makes a later change
// diagnosable instead of mysterious.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

const cu = (world) => {
  if (!world.pages.contactUs) {
    throw new Error(
      'ContactUsPage is not wired onto this.pages. Add it to BOTH features/support/hooks.js ' +
        'and fixtures/PagesFixture.js - there is no auto-discovery in either runner.'
    );
  }
  return world.pages.contactUs;
};

// Resolve a fixture by the name the feature file uses, and assert it exists. A missing fixture
// must fail naming the file, not fall through to some generated stand-in - the exact-10MB PNG
// lesson, where a fixture that was not at the boundary was reported for a week as an app defect.
function fixturePath(name) {
  const full = path.join(FIXTURE_DIR, name);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Contact Us: the fixture "${name}" is missing from "images to upload for testing". ` +
        `Present: ${fs.readdirSync(FIXTURE_DIR).join(', ')}`
    );
  }
  return full;
}

// ==================== Background ====================

// EXPLICIT TIMEOUT, and it has to be bigger than the waits INSIDE the step. features/support/
// hooks.js calls setDefaultTimeout(60000), which overrides every profile's own `timeout` - so
// this step's own 90s waitForURL could never complete: cucumber killed the step at 60s while
// the navigation was still legitimately in flight, and reported "function timed out", which
// says nothing about the login. Seen on 1 of 13 scenarios in the 2026-09-15 full run (the
// counter scenario, which passes in 15s on its own). Same defect as the email step below, and
// the same class as the table steps' budgets: an internal wait longer than the step budget is
// not a slow test, it is a test that cannot pass.
Given('I am logged in as the Contact Us candidate', { timeout: 150000 }, async function () {
  const email = process.env.CONTACTUS_EMAIL;
  const password = process.env.CONTACTUS_PASSWORD;
  if (!email || !password) {
    throw new Error('CONTACTUS_EMAIL / CONTACTUS_PASSWORD are not set in .env.');
  }
  this._contactUsEmail = email;

  const login = new LoginPage(this.page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  // The candidate lands on /dashboard; commit rather than load, because the dashboard goes on
  // fetching its KPI widgets long after the route has changed.
  await this.page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await this.page.waitForTimeout(2500);
});

// ==================== Opening / closing ====================

When('I open the Contact Us form', async function () {
  await cu(this).openFromSidebar();
});

When('I reopen the Contact Us form', async function () {
  const page = cu(this);
  if (await page.isOpen()) await page.close('cancel');
  await page.openFromSidebar();
});

Then('the Contact Us form should be displayed', async function () {
  expect(await cu(this).isOpen(), 'the Contact Us modal did not open').toBe(true);
});

Then('the Contact Us form should close', async function () {
  const page = cu(this);
  await page.modal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  expect(await page.isOpen(), 'the Contact Us modal stayed open after a successful submission').toBe(false);
});

// "Blank" means every field, not just the one a scenario happens to care about - a form that
// cleared its description while keeping the previous request's category would pass a narrower
// check and then submit a category the candidate never chose.
Then('the Contact Us form should be blank', async function () {
  const page = cu(this);
  const snapshot = await page.snapshot();
  await record(this, 'Contact Us form state on open', snapshot);

  const problems = [];
  if (snapshot.category) problems.push(`category holds "${snapshot.category}"`);
  if (snapshot.issue) problems.push(`issue holds "${snapshot.issue}"`);
  if (snapshot.description) problems.push(`description holds "${snapshot.description}"`);
  if (snapshot.attachedFile) problems.push(`a screenshot is still attached: "${snapshot.attachedFile}"`);
  if (snapshot.submitEnabled) problems.push('Submit is already enabled on an untouched form');

  expect(
    problems,
    `the Contact Us form carried state from a previous use: ${problems.join('; ')}`
  ).toEqual([]);
});

// ==================== The rendered contract ====================

Then('the Contact Us form should render its documented contract', async function () {
  const page = cu(this);
  const copy = ContactUsPage.COPY;
  const raw = (await page.modal.innerText()).replace(/\s+/g, ' ');
  const text = normaliseTypography(raw);
  const missing = [];

  // Matched as substrings on purpose: the heading carries a trailing emoji and the labels carry
  // a separate "*" node, so an exact-equality check would fail on punctuation while the copy is
  // word-for-word right.
  for (const [key, expected] of Object.entries({
    heading: copy.heading,
    subHeading: copy.subHeading,
    categoryLabel: copy.categoryLabel,
    issueLabel: copy.issueLabel,
    descriptionLabel: copy.descriptionLabel,
    uploadLabel: copy.uploadLabel,
    uploadHint: copy.uploadHint,
    uploadCta: copy.uploadCta,
  })) {
    if (!text.includes(normaliseTypography(expected))) missing.push(`${key}: "${expected}"`);
  }

  const placeholder = await page.descriptionInput.getAttribute('placeholder');
  if (placeholder !== copy.descriptionPlaceholder) {
    missing.push(`description placeholder: expected "${copy.descriptionPlaceholder}", found "${placeholder}"`);
  }
  const maxlength = await page.descriptionInput.getAttribute('maxlength');
  if (maxlength !== '500') missing.push(`description maxlength: expected "500", found "${maxlength}"`);

  const accept = await page.fileInput.first().getAttribute('accept');
  if (accept !== '.png,.jpg,.jpeg') missing.push(`file accept: expected ".png,.jpg,.jpeg", found "${accept}"`);

  for (const [label, locator] of [
    ['Cancel', page.cancelButton],
    ['Submit', page.submitButton],
    ['Close (X)', page.closeButton],
  ]) {
    if (!(await locator.count())) missing.push(`the "${label}" control is absent`);
  }

  await record(this, 'Contact Us rendered contract', { raw: raw.slice(0, 1200), placeholder, maxlength, accept });
  expect(missing, `the Contact Us form does not render its documented contract:\n - ${missing.join('\n - ')}`).toEqual([]);
});

Then('the Contact Us entry point should be a button rather than a link', async function () {
  const page = cu(this);
  const shape = await page.sidebarEntry.evaluate((el) => ({
    tag: el.tagName,
    href: el.getAttribute('href'),
    role: el.getAttribute('role'),
    tabIndex: el.tabIndex,
  }));
  // The FAQs entry immediately beside it IS a real <a href="/faqs">, which is what makes this a
  // measurement rather than a guess about how the app is built.
  const faqs = await page.faqsEntry.count()
    ? await page.faqsEntry.evaluate((el) => ({ tag: el.tagName, href: el.getAttribute('href') }))
    : null;
  await record(this, 'Contact Us entry point vs the FAQs entry beside it', { contactUs: shape, faqs });
  expect(shape.href, 'the Contact Us entry carries an href, so it now has a route').toBeNull();
});

// ==================== Category / issue ====================

When('I choose the Contact Us category {string}', async function (label) {
  const value = await cu(this).selectCategory(label);
  this._contactUsCategory = value;
});

When('I choose the Contact Us issue {string}', async function (label) {
  this._contactUsIssue = await cu(this).selectIssue(label);
});

Then('the issue field should not be selectable until a category is chosen', async function () {
  const page = cu(this);
  const hasField = await page.hasIssueField();
  const enabled = await page.isIssueEnabled();
  await record(this, 'issue field before a category is chosen', { hasField, enabled });
  expect(hasField, 'the issue field is not rendered at all before a category is chosen').toBe(true);
  expect(enabled, 'the issue dropdown is selectable before any category has been chosen').toBe(false);
});


Then('the chosen issue should have been cleared', async function () {
  const page = cu(this);
  const value = await page.selectedValue('issue');
  const label = await page.triggerLabel('issue');
  await record(this, 'issue after switching category', { value, label });
  expect(
    value || '',
    `switching category left the previous issue selected ("${value}"), so the form would submit ` +
      'an issue belonging to a category the candidate is no longer reporting'
  ).toBe('');
});

Then('the description should have been kept', async function () {
  const value = await cu(this).descriptionValue();
  expect(value.length, 'switching category also discarded the description the candidate had typed').toBeGreaterThan(0);
});

// >>> EVERY TABLE-DRIVEN STEP BELOW CARRIES AN EXPLICIT TIMEOUT. <<<
// features/support/hooks.js calls setDefaultTimeout(60000), and that OVERRIDES every
// profile's own `timeout`. A step that walks nine rows, reopening the modal for each, is
// many times a normal step's work - so without its own budget it is killed part-way and
// reports "function timed out, ensure the promise resolves within 60000 milliseconds",
// which says nothing about the app and hides however many rows had already passed.
// Measured 2026-09-14: the six-category matrix step did exactly that in a full run.
//
// One scenario, one table, every row reported. Cucumber abandons a scenario at its first failing
// step, so five consecutive Then steps would only ever show whichever category failed first.
Then('each category should offer exactly these issues:',
  // six categories, each a dropdown open + select + settle
  { timeout: 180000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const observed = {};

  for (const row of table.hashes()) {
    const expected = (row.issues || '').split(',').map((x) => x.trim()).filter(Boolean);
    const value = await page.selectCategory(row.category);
    const actual = await page.readOptions('issue');
    observed[row.category] = actual;

    // An EMPTY `issues` cell means the app should render NO issue field at all - which is what
    // "Other" does. It does not merely disable the field, it removes it, so a row asserting an
    // empty LIST would be asserting a control that is not there.
    if (!expected.length) {
      if (actual !== null) {
        problems.push(
          `${row.category} (${value}): an issue field was rendered where none should be, ` +
            `offering ${JSON.stringify(actual)}`
        );
      }
      continue;
    }
    if (actual === null) {
      problems.push(`${row.category}: no issue field was rendered at all`);
      continue;
    }
    const missing = expected.filter((e) => !actual.includes(e));
    const extra = actual.filter((a) => !expected.includes(a));
    if (missing.length) problems.push(`${row.category} (${value}): missing ${JSON.stringify(missing)}`);
    if (extra.length) problems.push(`${row.category} (${value}): unexpected ${JSON.stringify(extra)}`);
  }

  // The SET is asserted, the ORDER is only recorded: "Other" is rendered last under
  // My Track/Progress and first under the other four, and no AC says which is intended.
  // Failing on it would make this permanently red over a question for the PO.
  const orderNote = Object.entries(observed)
    .filter(([, list]) => Array.isArray(list) && list.length)
    .map(([cat, list]) => `${cat}: "Other" at position ${list.indexOf('Other') + 1} of ${list.length}`);
  await record(this, 'issue options per category (order recorded, set asserted)', { observed, orderNote });

  expect(problems, `the issue lists do not match:\n - ${problems.join('\n - ')}`).toEqual([]);
});

// ==================== Description ====================

When('I describe the problem as {string}', async function (text) {
  await cu(this).fillDescription(text);
  this._contactUsDescription = text;
});


// A marker unique to this run, so the mailbox assertion can find the mail this scenario caused
// rather than one left by a previous run.
When('I describe the problem as a uniquely marked support request', async function () {
  const marker = `CONTACTUS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  this._contactUsMarker = marker;
  await cu(this).fillDescription(
    `${marker} - automated check of the Contact Us notification email, please ignore.`
  );
  await record(this, 'unique marker written into the description', marker);
});

When('I clear the description', async function () {
  await cu(this).fillDescription('');
});

// The counter and the cap are ONE behaviour, so one table drives both. `held` is asserted as
// well as `counter` on purpose: a form that accepted 600 characters and merely DISPLAYED
// "500/500" would pass a counter-only check and then submit 600 characters.
Then('the description counter should track each of these lengths:',
  // seven fills, one of them 600 characters
  { timeout: 120000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const typed = Number(row.typed);
    await page.fillDescription('A'.repeat(typed));
    const held = (await page.descriptionValue()).length;
    const counter = await page.counterText();
    trace.push({ typed, held, counter });

    if (held !== Number(row.held)) {
      problems.push(`typed ${typed}: the field held ${held} characters, expected ${row.held}`);
    }
    if (counter !== row.counter) {
      problems.push(`typed ${typed}: the counter reads "${counter}", expected "${row.counter}"`);
    }
  }

  await record(this, 'description counter and cap', trace);
  expect(problems, `the description counter or cap is wrong:\n - ${problems.join('\n - ')}`).toEqual([]);
});

// ==================== Submit gating ====================

Then('the Contact Us Submit button should be enabled', async function () {
  const page = cu(this);
  const enabled = await page.waitForSubmitEnabled();
  if (!enabled) await record(this, 'form state while Submit stayed disabled', await page.snapshot());
  expect(enabled, 'Submit did not enable on a form holding every required field').toBe(true);
});

Then('the Contact Us Submit button should be disabled', async function () {
  const page = cu(this);
  const enabled = await page.isSubmitEnabled();
  if (enabled) await record(this, 'form state while Submit was enabled', await page.snapshot());
  expect(enabled, 'Submit is enabled on an incomplete form').toBe(false);
});

// NOT the negation of the step above. Submit settles asynchronously, so a single read cannot
// tell a gate that holds from one that is about to open - this watches the whole window.
Then('the Contact Us Submit button should stay disabled', async function () {
  const page = cu(this);
  const stayed = await page.submitStaysDisabled();
  if (!stayed) await record(this, 'form state when Submit enabled early', await page.snapshot());
  expect(stayed, 'Submit enabled on an incomplete form').toBe(true);
});

// EVERY gating case in one table, in both directions, every row reported. `<spaces>` in the
// description column means whitespace only - a Gherkin table cannot carry trailing spaces, and
// "whitespace is not a description" is the case that matters most.
Then('Submit should be gated exactly as follows:',
  // nine rows, each REOPENING the modal and refilling it
  { timeout: 300000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    // Reopen per row so each combination is judged on its own rather than on what the previous
    // row left behind - the whole point of an incomplete form is which fields are absent.
    await page.close('cancel');
    await page.openFromSidebar();

    if (row.category) await page.selectCategory(row.category);

    // An issue WITHOUT a category is not a state the product can reach - the issue dropdown is
    // disabled until a category is chosen, so there is nothing to click. Recording that honestly
    // is the point: clicking a disabled control waits out its full timeout and reports
    // "element is not enabled", which reads as a broken locator rather than as a form correctly
    // refusing an impossible combination. (The promo Add-modal gating step had to learn the same
    // lesson about an expiry field that cannot be emptied.)
    let issueSkipped = null;
    if (row.issue) {
      if (await page.isIssueEnabled()) await page.selectIssue(row.issue);
      else issueSkipped = 'the issue dropdown is disabled until a category is chosen, so this combination is unreachable';
    }
    if (row.description) {
      await page.fillDescription(row.description === '<spaces>' ? '   ' : row.description);
    }

    const wantEnabled = row.submit.trim().toLowerCase() === 'enabled';
    // The two readers are NOT each other's negation, and using the right one per direction is
    // what makes this trustworthy. Submit settles asynchronously: "must enable" tolerates a late
    // enable, "must stay gated" watches the whole window so a late enable is caught, not missed.
    const actualEnabled = wantEnabled
      ? await page.waitForSubmitEnabled(8000)
      : !(await page.submitStaysDisabled(1500));

    const snapshot = await page.snapshot();
    trace.push({ row, wantEnabled, actualEnabled, issueSkipped, snapshot });
    if (actualEnabled !== wantEnabled) {
      problems.push(
        `category="${row.category || '(none)'}" issue="${row.issue || '(none)'}" ` +
          `description="${row.description || '(none)'}" -> Submit was ` +
          `${actualEnabled ? 'ENABLED' : 'DISABLED'}, expected ${row.submit}`
      );
    }
  }

  await record(this, 'Submit gating across every combination', trace);
  expect(problems, `Submit is not gated as specified:\n - ${problems.join('\n - ')}`).toEqual([]);
});

// ==================== Inline field errors ====================

Then('an untouched form should show no inline error', async function () {
  const page = cu(this);
  const surfaces = await page.errorSurfaces();
  await record(this, 'inline errors on an untouched form', surfaces);
  expect(
    surfaces.filter((t) => /required|invalid|must be/i.test(t)),
    `the form scolds the candidate before they have touched it: ${surfaces.join(' | ')}`
  ).toEqual([]);
});

// ONE behaviour - "an empty required field explains itself" - across the ways a field ends up
// empty. Collected and thrown once, so a red row says which cases broke rather than stopping at
// the first.
//
// >>> EVERY CASE GETS A FRESH FORM, AND THAT IS LOAD-BEARING. <<<
// The first version of the probe behind this ran every case against ONE form, so the opening
// focus-and-blur left the field "touched" and every later case inherited that state - which
// produced a confident, wrong rule ("typed and cleared raises the error", when in fact nothing
// is raised until the field is BLURRED). Reopening per case is what makes each one a measurement
// of the app rather than of the case before it.
//
// MEASURED 2026-09-14 (scripts/probe-contact-us-errors2.js). The form validates ON BLUR:
//   focused and left empty           -> "Description is required."
//   typed, cleared and left          -> "Description is required."
//   filled with spaces and left      -> NOTHING          <-- the @known-issue
//   error shown, then spaces typed   -> message ERASED   <-- the @known-issue, worse
// Spaces count as CONTENT for the message and as EMPTY for the Submit gate.
Then('the description should report its own error when left empty:',
  // four cases, each reopening the modal, plus the recorded category/aria-invalid pass
  { timeout: 180000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const how = row['left as'];
    await page.close('cancel');
    await page.openFromSidebar();

    // Each case ends by LEAVING the field, because the form validates on blur. A case that
    // types and never blurs measures nothing - it is the app working as designed.
    const leaveField = async () => {
      await page.descriptionInput.click();
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(900);
    };

    if (how === 'focused and left empty') {
      await leaveField();
    } else if (how === 'typed, cleared and left') {
      await page.fillDescription('something, then removed');
      await page.fillDescription('');
      await leaveField();
    } else if (how === 'filled with spaces and left') {
      await page.fillDescription('   ');
      await leaveField();
    } else if (how === 'error shown, then spaces typed') {
      // The sharpest form of the defect: raise the error legitimately FIRST, confirm it is on
      // screen, then type spaces and watch it vanish. Without the confirmation this row could
      // pass vacuously on a form that never raised the error at all.
      await leaveField();
      const raised = await page.errorSurfaces();
      if (!raised.some((t) => t.includes(row['inline error']))) {
        problems.push(
          `${how}: the error was never raised in the first place, so this row could not test ` +
            `whether typing spaces erases it. The form showed: ${raised.join(' | ') || 'NOTHING'}`
        );
        continue;
      }
      await page.fillDescription('   ');
    } else {
      throw new Error(`the step does not know how to leave the description "${how}"`);
    }
    await this.page.waitForTimeout(1000);

    const surfaces = await page.errorSurfaces();
    const shown = surfaces.some((t) => t.includes(row['inline error']));
    const submitEnabled = await page.isSubmitEnabled();
    trace.push({ how, surfaces, expected: row['inline error'], shown, submitEnabled });

    if (!shown) {
      problems.push(
        `${how}: expected "${row['inline error']}", the form showed ` +
          `${surfaces.length ? surfaces.join(' | ') : 'NOTHING'}` +
          (submitEnabled
            ? ''
            : ' (Submit is correctly disabled, so the field IS invalid - the candidate is simply not told why)')
      );
    }
  }

  // RECORDED, NOT FAILED ON - no AC settles either of these, and failing on them would bury the
  // row above that does have a ruling behind it.
  await page.close('cancel');
  await page.openFromSidebar();
  await (await page.dropdownTrigger('category')).click();
  await this.page.keyboard.press('Escape');
  await this.page.waitForTimeout(1000);
  const categoryErrors = await page.errorSurfaces();
  const ariaInvalid = await page.modal.locator('[aria-invalid="true"]').count();
  await record(this, 'inline error behaviour', {
    perCase: trace,
    FOR_THE_PO: {
      categoryDropdownRaisesNoError: categoryErrors.length === 0,
      categorySurfaces: categoryErrors,
      fieldsCarryingAriaInvalid: ariaInvalid,
      note:
        'Only the description explains itself, and no field carries aria-invalid - so the ' +
        'message is not associated with its control for assistive technology.',
    },
  });

  expect(problems, `an empty required field did not explain itself:\n - ${problems.join('\n - ')}`).toEqual([]);
});

// ==================== Screenshot ====================

When('I attach the screenshot {string}', async function (name) {
  const file = fixturePath(name);
  const bytes = fs.statSync(file).size;
  this._contactUsUpload = { name, bytes };
  const settled = await cu(this).attachScreenshot(file);
  this._contactUsUploadResult = settled;
  await record(this, `upload: ${name}`, { bytes, megabytes: (bytes / 1048576).toFixed(3), settled });
});

// ACCEPTS AND REFUSALS IN ONE TABLE, because they are one rule - "PNG/JPG up to 10 MB". Each
// row is judged on its own: the file is attached, the zone is allowed to SETTLE (it animates a
// fake progress bar for ~2s and a read taken before that reports an accepted file as refused),
// and an accepted one is removed again so the next row is not judged against it.
//
// The `bytes` column is asserted BEFORE the app's reaction wherever it is given. A boundary
// scenario that did not send the boundary proves nothing however green the rest of it goes -
// that is the exact-10MB PNG lesson, where a fixture that was not at the boundary was reported
// for a week as an app defect.
//
// Refusals assert the REFUSAL first and the WORDING second, both collected, so a red row reads
// "it was refused, with different words" rather than the far more alarming "it was not refused
// at all". A locator built from an AC's string could only ever answer "absent" and would report
// a working rejection as a missing one.
Then('each screenshot should be handled as follows:',
  // EXPLICIT, and sized to the biggest table this step drives (five rows, of which two are the
  // 10 MB boundary files and one is 8.4 MB). features/support/hooks.js calls
  // setDefaultTimeout(60000), which overrides the profile's own `timeout`, so a step that walks
  // a table of multi-megabyte uploads - each animating a ~2s progress bar before it settles -
  // is killed part way and reports "function timed out", which says nothing about the app and
  // hides however many rows had already passed.
  { timeout: 420000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const file = fixturePath(row.file);
    const bytes = fs.statSync(file).size;

    if (row.bytes) {
      const want = Number(row.bytes);
      if (bytes !== want) {
        problems.push(
          `${row.file} is ${bytes} bytes, not the ${want} this row requires - the boundary was ` +
            'never sent. Rebuild it with scripts/make-exact-10mb-png.js.'
        );
        continue;
      }
    }

    const settled = await page.attachScreenshot(file);
    const attached = await page.attachedFileName();
    const surfaces = await page.errorSurfaces();
    const zoneText = `${settled.zone || ''} ${surfaces.join(' ')}`;
    const uploadStillOffered = /click to upload/i.test((await page.modal.innerText()).replace(/\s+/g, ' '));
    trace.push({ file: row.file, bytes, outcome: row.outcome, attached, settled, surfaces, uploadStillOffered });

    if (row.outcome === 'accepted') {
      if (attached !== row.file) {
        problems.push(`${row.file}: expected it to be accepted, but the zone holds "${attached}"`);
      }
      if (/not allowed|too large/i.test(zoneText)) {
        problems.push(`${row.file}: accepted, but the zone still shows a rejection: ${zoneText.trim()}`);
      }
      // Remove it so the next row is judged on its own - the zone holds ONE file.
      await page.removeScreenshot();
    } else {
      if (attached) {
        problems.push(`${row.file}: should have been refused, but the zone is holding it as "${attached}"`);
      }
      if (!zoneText.includes(row.message)) {
        problems.push(
          `${row.file}: expected the message "${row.message}", the zone showed: ${zoneText.trim() || '(nothing)'}`
        );
      }
      if (!uploadStillOffered) {
        problems.push(`${row.file}: refused, but the upload area did not come back, so no other file can be tried`);
      }
    }
  }

  await record(this, 'screenshot accept / reject table', trace);
  expect(problems, `the screenshot zone did not behave as specified:\n - ${problems.join('\n - ')}`).toEqual([]);
});

Then('the attached screenshot should be {string}', async function (name) {
  const page = cu(this);
  const attached = await page.attachedFileName();
  await record(this, 'attached file card', { attached, errors: await page.errorSurfaces() });
  expect(attached, `the upload zone holds "${attached}", not "${name}"`).toBe(name);
});

Then('no screenshot should be attached', async function () {
  const page = cu(this);
  const has = await page.hasAttachedFile();
  if (has) await record(this, 'unexpectedly attached file', await page.attachedFileName());
  expect(has, 'a file the app said it refused is being held anyway').toBe(false);
});

Then('the upload area should still be offered', async function () {
  const text = (await cu(this).modal.innerText()).replace(/\s+/g, ' ');
  expect(
    /click to upload/i.test(text),
    'the upload zone did not come back, so the candidate cannot try another file'
  ).toBe(true);
});

When('I remove the attached screenshot', async function () {
  const removed = await cu(this).removeScreenshot();
  expect(removed, 'the Delete control did not remove the attached screenshot').toBe(true);
});

// ==================== Dismissal ====================

Then('dismissing the Contact Us form should discard it, by each of these routes:',
  // three routes, each filling the form, closing it and reopening to check the draft
  { timeout: 180000 },
  async function (table) {
  const page = cu(this);
  const problems = [];
  const trace = [];

  for (const row of table.hashes()) {
    const route = row.route.toLowerCase() === 'x' ? 'x' : row.route.toLowerCase();
    await page.openFromSidebar();
    await page.selectCategory('Documents');
    await page.fillDescription(`draft written for the ${row.route} route - it must not survive`);

    const requests = [];
    const listener = (request) => {
      if (request.method() !== 'GET' && /candidate\/feedback/.test(request.url())) requests.push(request.url());
    };
    this.page.on('request', listener);
    await page.close(route);
    // "not visible" is also true of a modal still animating out, and a request already in flight
    // arrives after the click - so watch a window rather than sampling once.
    const closed = await page.staysClosed(2500);
    this.page.off('request', listener);

    let reopened = null;
    if (closed) {
      await page.openFromSidebar();
      reopened = await page.snapshot();
      await page.close('cancel');
    }
    trace.push({ route: row.route, closed, requests, reopened });

    if (!closed) problems.push(`${row.route}: the form did not close`);
    if (requests.length) problems.push(`${row.route}: it sent ${requests.length} request(s) to the feedback endpoint`);
    if (reopened && (reopened.category || reopened.description)) {
      problems.push(
        `${row.route}: the discarded draft came back on reopen ` +
          `(category="${reopened.category}", description="${reopened.description}")`
      );
    }
  }

  await record(this, 'dismissal routes', trace);
  expect(problems, `dismissing the Contact Us form misbehaved:\n - ${problems.join('\n - ')}`).toEqual([]);
});


// ==================== Routing ====================

When('I note the current URL', async function () {
  this._contactUsUrlBefore = this.page.url();
});

Then('the URL should not have changed', async function () {
  const after = this.page.url();
  await record(this, 'URL across opening the modal', { before: this._contactUsUrlBefore, after });
  expect(
    after,
    'opening Contact Us changed the URL, so it now has a route - the scenario and the page ' +
      "object's header both need updating."
  ).toBe(this._contactUsUrlBefore);
});

// ==================== Submitting ====================

When('I submit the Contact Us form', async function () {
  contactUsFixtureGuard(this._contactUsEmail);
  const page = cu(this);
  const enabled = await page.waitForSubmitEnabled();
  if (!enabled) {
    await record(this, 'form state when Submit could not be clicked', await page.snapshot());
    throw new Error(
      'Contact Us: Submit is disabled, so the request was never sent. The form is incomplete - ' +
        'a bare click here would time out reporting "element is not enabled", which says nothing ' +
        'about why.'
    );
  }
  this._contactUsSubmission = await page.submit();
  this._contactUsSubmissions = (this._contactUsSubmissions || 0) + 1;
  await record(this, 'submission', this._contactUsSubmission);
});

Then('the support request should be accepted by the server', async function () {
  const result = this._contactUsSubmission;
  expect(result, 'the form was never submitted in this scenario').toBeTruthy();
  expect(
    result.status,
    `the feedback endpoint answered ${result.status} with body: ${result.body}`
  ).toBe(201);
});

Then('the submitted request should carry:', async function (table) {
  const result = this._contactUsSubmission;
  expect(result && result.json, `the server returned no JSON body: ${result && result.body}`).toBeTruthy();
  const problems = [];
  for (const row of table.hashes()) {
    const actual = result.json[row.field];
    if (String(actual) !== row.value) {
      problems.push(`${row.field}: expected "${row.value}", the server recorded "${actual}"`);
    }
  }
  await record(this, 'server record of the submitted request', result.json);
  expect(problems, `the request was not recorded as submitted:\n - ${problems.join('\n - ')}`).toEqual([]);
});

// >>> ASSERTED ON THE SERVER'S RECORD, NOT ON THE REQUEST BODY. <<<
// The first version of this checked `request.postData()` for a `name="screenshot"` part and
// FAILED on a submission that had worked perfectly - because Playwright does not expose a
// multipart body containing binary as a string, so postData() came back empty and the step
// reported that "the attached file never left the browser". The response is the authority and
// it is unambiguous: on success `screenshot` is a presigned S3 URL, and on a request that
// carried no file it is null. Measured 2026-09-14:
//   .../private/feedback/screenshots/less_than_5MB.png?X-Amz-Algorithm=...
// The URL is a CREDENTIAL, so only its path is recorded - the X-Amz-Signature is stripped.
Then('the submitted request should have carried a screenshot', async function () {
  const result = this._contactUsSubmission;
  const stored = result.json && result.json.screenshot;
  const safe = stored ? String(stored).split('?')[0] : null;
  await record(this, 'screenshot as the server recorded it (query string stripped - it is a credential)', {
    storedPath: safe,
    expectedName: this._contactUsUpload && this._contactUsUpload.name,
  });
  expect(
    stored,
    'the server recorded screenshot: null, so the attached file never reached it'
  ).toBeTruthy();
  // The stored name is the uploaded one with characters the bucket cannot take replaced, so it
  // is compared on the stem rather than byte-for-byte ("less than 5MB.png" -> "less_than_5MB.png").
  const stem = (this._contactUsUpload.name || '').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_');
  expect(
    safe.toLowerCase(),
    `the server stored "${safe}", which does not look like the "${this._contactUsUpload.name}" that was attached`
  ).toContain(stem.toLowerCase());
});

// >>> THE ABSENCE OF A SCREENSHOT IS ASSERTED ON THE SERVER'S RECORD, THE SAME WAY ITS PRESENCE
//     IS. <<< `screenshot: null` in the response is the only thing that distinguishes "no file
// was sent" from "a file was sent and the server dropped it" - and those are opposite findings.
// Reading the form instead would only ever say what the browser held.
//
// It also guards the scenario's own premise: nothing in the no-screenshot scenario attaches a
// file, so a non-null value here means a file leaked in from somewhere (a previous scenario's
// state, a modal that was not blank on open), which would make the whole run untrustworthy.
Then('the submitted request should have carried no screenshot', async function () {
  const result = this._contactUsSubmission;
  expect(result && result.json, `the server returned no JSON body: ${result && result.body}`).toBeTruthy();
  const stored = result.json.screenshot;
  await record(this, 'screenshot as the server recorded it', { storedPath: stored ? String(stored).split('?')[0] : null });
  expect(
    stored,
    `no screenshot was attached, but the server recorded one: ${String(stored).split('?')[0]}. ` +
      'Either a file leaked into this submission or the form is sending something it was not given.'
  ).toBeNull();
});

// EXACT, not `includes`. The step above proves a confirmation was raised at all; this one proves
// it is the confirmation the build is specified to raise, so a toast reworded to something
// vaguer - or a generic "Done" - is caught rather than passing on a substring.
//
// Compared after whitespace collapsing and typography normalisation, because the modal's own
// copy already mixes a straight apostrophe with an en dash and a source file makes the two look
// identical; and matched against ANY ONE of the collected surfaces rather than a single read,
// because notistack nests its wrapper, so one toast is legitimately reported as several
// identical strings. The raw list is recorded either way.
Then('the confirmation should read exactly {string}', async function (expected) {
  const result = this._contactUsSubmission;
  expect(result, 'the form was never submitted in this scenario').toBeTruthy();
  const toasts = (result.toasts || []).map((t) => normaliseTypography(t.replace(/\s+/g, ' ').trim()));
  const want = normaliseTypography(expected);
  await record(this, 'confirmation wording', { expected, sawRaw: result.toasts || [] });
  expect(
    toasts.some((t) => t === want),
    `the confirmation does not read exactly "${expected}". What the app rendered: ` +
      `${(result.toasts || []).map((t) => `"${t}"`).join(' | ') || '(nothing)'}`
  ).toBe(true);
});

// >>> A SUCCESS TOAST IS NOT EVIDENCE ON ITS OWN IF AN ERROR WAS RAISED BESIDE IT. <<<
// The app can render several toasts at once, and every other assertion in these scenarios is
// satisfied by a run that confirms AND fails - the 201 is checked separately, the wording is
// checked with `some()`. Without this step, "submitted successfully" plus "something went wrong"
// passes the whole scenario. Matched on the SHAPE of an error rather than a pinned sentence: the
// failure wordings have never been measured here (there is no failure-path coverage yet), so a
// pinned string could only ever answer "absent".
Then('no error should be displayed alongside the confirmation', async function () {
  const result = this._contactUsSubmission;
  expect(result, 'the form was never submitted in this scenario').toBeTruthy();
  const surfaces = (result.toasts || []).map((t) => t.replace(/\s+/g, ' ').trim());
  const looksLikeError = /error|failed|failure|unable|went wrong|try again|not allowed|too large|invalid|sorry/i;
  const errors = surfaces.filter((t) => looksLikeError.test(t));
  await record(this, 'surfaces raised alongside the confirmation', { all: surfaces, errorLike: errors });
  expect(
    errors,
    `the app raised a confirmation AND something that reads as an error: ${errors.map((e) => `"${e}"`).join(' | ')}`
  ).toEqual([]);
});

Then('a submission confirmation should be displayed', async function () {
  const result = this._contactUsSubmission;
  const toasts = (result.toasts || []).map((t) => t.replace(/\s+/g, ' ').trim());
  const expected = ContactUsPage.COPY.successToast;
  await record(this, 'confirmation surfaces', toasts);
  expect(
    toasts.some((t) => t.includes(expected)),
    `the app raised no "${expected}" confirmation. What it did show: ${toasts.join(' | ') || '(nothing)'}`
  ).toBe(true);
});

// ==================== The notification email ====================

Given('I note the mailbox position before contacting support', async function () {
  const { latestUidForRecipient } = require('../utils/gmailClient');
  // CONTACT_US_NOTIFY_EMAIL is the ASSIGNED AGENT's address, and .env sets it. The fallback to
  // the candidate's own mailbox is what made this scenario report a working feature as unsent for
  // a fortnight: the mail was in the same INBOX the whole time, filtered out because
  // waitForEmailMatching() searches IMAP by recipient. Left as a fallback so a fresh checkout
  // still runs, but the step after the wait now asserts the real To header, so a silent fallback
  // can no longer pass for the right answer.
  this._contactUsNotifyTo = process.env.CONTACT_US_NOTIFY_EMAIL || process.env.CONTACTUS_EMAIL;
  // A UID baseline, never a count: this mailbox is long-lived and holds every earlier run's
  // mail, so counting matches cannot tell a new message from an old one.
  this._contactUsMailBaseline = await latestUidForRecipient(this._contactUsNotifyTo).catch(() => 0);
  await record(this, 'mailbox baseline', {
    recipient: this._contactUsNotifyTo,
    afterUid: this._contactUsMailBaseline,
  });
});

// Matched on the MARKER IN THE BODY, never on a guessed subject. A subject guess can only ever
// answer "nothing arrived", which cannot distinguish "the app sends no mail for this" from "it
// sends one under a subject nobody predicted" - and those are completely different findings.
// Same reasoning as waitForEmailMatching() in the agent-email module.
// EXPLICIT TIMEOUT. features/support/hooks.js calls setDefaultTimeout(60000), which overrides
// every profile's own `timeout`, so this step was killed at 60s while its own mail wait was set
// to 180s - reported as "function timed out", which says nothing about the mailbox. The step
// budget must exceed the wait inside it.
Then('a support notification email carrying that marker should arrive', { timeout: 260000 }, async function () {
  const { waitForEmailMatching } = require('../utils/gmailClient');
  const marker = this._contactUsMarker;
  expect(marker, 'no marker was written into the description').toBeTruthy();

  // waitForEmailMatching returns {found:false, ...} on timeout rather than throwing - for a mail
  // that may not be sent at all, "no mail" is a measurement, not an error, and the caller decides
  // whether it is a failure. `scanned` distinguishes "nothing arrived" from "we never looked",
  // which a baseline taken against the wrong address would otherwise hide.
  const result = await waitForEmailMatching({
    to: this._contactUsNotifyTo,
    bodyIncludes: marker,
    afterUid: this._contactUsMailBaseline,
    timeoutMs: 180000,
    pollMs: 10000,
  });

  // Kept on the world: the two steps after this one assert the ENVELOPE and the CONTENTS, and
  // re-fetching the message would be a second IMAP round trip that could legitimately return a
  // different mail.
  this._contactUsNotification = result;

  await record(this, 'mailbox after submitting', {
    recipient: this._contactUsNotifyTo,
    afterUid: this._contactUsMailBaseline,
    marker,
    found: result.found,
    subject: result.subject,
    uid: result.uid,
    messagesScanned: result.scanned,
    subjectsSeen: result.subjectsSeen,
  });

  // Registered here rather than in utils/emailTypes.js precisely because the subject has never
  // been observed. The moment one arrives, this line names it for registration.
  if (result.found) {
    await record(this, 'REGISTER THIS SUBJECT in utils/emailTypes.js', result.subject);
  }

  expect(
    result.found,
    `No support notification carrying "${marker}" reached ${this._contactUsNotifyTo} within ` +
      `3 minutes, although the request was accepted (HTTP 201). ${result.scanned} message(s) ` +
      `newer than uid ${this._contactUsMailBaseline} were examined; subjects seen: ` +
      `${result.subjectsSeen.join(' | ') || '(none)'}. ` +
      'Note the notification may go to the ASSIGNED AGENT rather than the candidate - set ' +
      'CONTACT_US_NOTIFY_EMAIL in .env to that address once it is known.'
  ).toBe(true);
});

// ==================== Teardown ====================

// Records what this scenario created. It NEVER throws - a support request cannot be withdrawn,
// so there is nothing to clean up and a teardown error would only mask the scenario's own
// failure. What it leaves is a record of the permanent rows this run added.
After({ tags: '@contact-us' }, async function () {
  if (!this._contactUsSubmissions) return;
  await record(
    this,
    'PERMANENT: support requests raised by this scenario',
    {
      count: this._contactUsSubmissions,
      candidate: this._contactUsEmail,
      note:
        'POST /candidate/feedback/ is POST-only (GET answers 405) and no control in the portal ' +
        'withdraws a request. These rows are permanent.',
    }
  );
});

// >>> THE RECIPIENT IS ASSERTED, NOT ASSUMED FROM .env. <<<
// The step above searches IMAP filtered by `to`, so on its own it can only ever confirm that a
// mail reached whatever address CONTACT_US_NOTIFY_EMAIL names - it cannot confirm that address
// is the AGENT. Pointing that variable at the candidate would make the search pass the moment
// the candidate were ever copied in, and the finding this scenario exists to hold (the agent is
// notified, the candidate is not) would quietly stop being tested. Reading the delivered
// message's own To header is what closes that.
//
// Measured 2026-09-15, uid 25087: TO iqra.farooq+9999@bytecorp.io, greeting "Hi Agent added,",
// while the candidate is iqra.farooq+554@bytecorp.io.
Then('the notification should be addressed to the assigned agent rather than the candidate', async function () {
  const mail = this._contactUsNotification;
  expect(mail && mail.parsed, 'no notification was captured by the step before this one').toBeTruthy();
  const to = ((mail.parsed.to && mail.parsed.to.text) || '').toLowerCase();
  const candidate = String(this._contactUsEmail || '').toLowerCase();
  await record(this, 'notification envelope', {
    to: (mail.parsed.to && mail.parsed.to.text) || null,
    from: (mail.parsed.from && mail.parsed.from.text) || null,
    subject: mail.subject,
    candidateAddress: this._contactUsEmail,
  });
  expect(to, 'the notification carried no To header at all').toBeTruthy();
  expect(
    to.includes(candidate),
    `the notification was addressed to the CANDIDATE (${to}). The modal promises "Your assigned ` +
      'agent will respond via email", so it is the agent who should be notified - if the product ' +
      'has changed to copy the candidate in, this scenario records the old behaviour.'
  ).toBe(false);
});

// The agent has to be able to ACT on the mail, so it must carry the request, not just announce
// that one exists. Asserted against what the candidate actually submitted - the server's own
// record of this submission - rather than against strings repeated from the Gherkin, so the
// scenario cannot pass by agreeing with itself.
//
// >>> CATEGORY AND ISSUE ARRIVE AS RAW API ENUMS, AND THAT IS RECORDED, NOT FAILED ON. <<<
// The mail renders `Category: technicalIssue` / `Issue: errorMessageDisplayed` where the
// candidate chose "Technical Issue" / "Error message displayed". Same class as the Candidate
// Details manage list leaking `co_op`. No AC settles how the notification should render them, so
// failing here would make the scenario permanently red over a question for the PO - the enum is
// what is asserted (it IS the submitted value) and the divergence is attached beside it.
Then('the notification should carry the candidate and the request they submitted', async function () {
  const mail = this._contactUsNotification;
  const submitted = this._contactUsSubmission;
  expect(mail && mail.parsed, 'no notification was captured by the step before this one').toBeTruthy();
  expect(submitted && submitted.json, 'nothing was submitted in this scenario').toBeTruthy();

  const body = `${mail.parsed.text || ''}\n${mail.parsed.html || ''}`;
  const want = [
    { what: "the candidate's email address", value: this._contactUsEmail },
    { what: 'the category as submitted', value: submitted.json.category },
    { what: 'the issue as submitted', value: submitted.json.issue },
    { what: 'the description the candidate typed', value: this._contactUsMarker },
  ];
  const missing = want.filter((w) => w.value && !body.toLowerCase().includes(String(w.value).toLowerCase()));

  await record(this, 'notification contents', {
    subject: mail.subject,
    checked: want,
    missing: missing.map((m) => m.what),
    FOR_THE_PO:
      'Category and Issue are rendered as the RAW API enums (e.g. "technicalIssue", ' +
      '"errorMessageDisplayed"), not the labels the candidate picked. Should the notification ' +
      'show the human labels?',
  });

  expect(
    missing,
    'the notification arrived but does not carry what the agent needs to act on it - missing: ' +
      `${missing.map((m) => `${m.what} ("${m.value}")`).join(', ')}`
  ).toEqual([]);
});
