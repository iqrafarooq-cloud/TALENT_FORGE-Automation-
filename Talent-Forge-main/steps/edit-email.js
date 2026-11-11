const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

const AgentsListingPage = require('../pages/AgentsListingPage');
const CandidatesListingPage = require('../pages/CandidatesListingPage');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');
const { waitForEmail, latestUid } = require('../utils/gmailClient');

// Step definitions for
// features/SuperAdmin_Portal/UserManagement/Edit-Email.feature.
//
// `Given I am logged in as the superadmin` is NOT defined here - invite-agent.js owns it, and
// `Given I am on the Agents listing` / `I have noted the first agent on the ... tab` belong to
// agent.js. Cucumber loads every step file into ONE registry, so redefining any of them would
// throw an ambiguous-step error and take three features down at once.
//
// THE MODAL STEPS BELOW USED TO LIVE IN agent.js AND WERE MOVED HERE ON 2026-09-03, unchanged
// except that each now resolves its listing at run time. They were only ever used by this
// feature (the copies in Agent.feature are commented out), and the flow they drive exists on
// TWO listings, not one - so leaving them addressed to `world.pages.agentsListing` meant the
// candidate half of the flow could not be written at all without a second, near-identical
// vocabulary that would drift from the first.
//
// ===========================================================================================
// WHAT THIS FEATURE IS ABOUT, measured live 2026-09-03 (see CandidatesListingPage.js and the
// PENDING section of AgentsListingPage.js for the full table).
//
// >>> COMMITTING THE MODAL DOES NOT CHANGE AN ADDRESS. <<< It starts a two-party handshake:
// the app keeps the old address live, records the new one as `pending_email`, repaints the
// row's address RED with a warning icon and a tooltip, and emails a verification link to the
// NEW address. Only following that link swaps the address over. Any assertion that treats
// Update as "the email is now X" is asserting a state the product never enters.
// ===========================================================================================
//
// THREE RULES THIS FILE FOLLOWS.
//
// 1. THE SURFACE IS A PARAMETER, NEVER A COPY. Every modal step reads `surface(world)`, which
//    is the Agents listing or the Candidates listing depending on which Given ran. The two
//    page objects are separate (their markup, class names and wordings differ) but the
//    Gherkin is one vocabulary, so a rule proved on one listing is written once and driven on
//    both.
//
// 2. A WORDING THAT DIFFERS BETWEEN THE TWO LISTINGS IS PASSED IN FROM THE FEATURE FILE, not
//    hardcoded and not normalised. "New email must be different" (agents) and "New email must
//    be different." (candidates) are the same rule rendered two ways; pinning either one in a
//    step would make the other listing permanently red over a full stop, and quietly matching
//    both would hide a real regression in either.
//
// 3. A REFUSAL IS ASSERTED AS A REFUSAL FIRST AND AS A WORDING SECOND. Cucumber abandons a
//    scenario at its first failing step, so "it was refused, with different words" and "it was
//    not refused at all" must not be able to hide one another.

const AGENTS = 'Agents';
const CANDIDATES = 'Candidates';
// The agent profile's Candidates tab (/agents/view/<id>?tab=candidates). Its Edit opens the
// Candidates listing's modal - same labels, same wording - so it is a candidate surface for every
// wording rule, and only the grid, the search and the request differ (AgentProfileCandidatesPage).
const PROFILE_CANDIDATES = 'Agent profile Candidates tab';

function surfaceName(world) {
  if (world._emailSurface === PROFILE_CANDIDATES) return PROFILE_CANDIDATES;
  return world._emailSurface === CANDIDATES ? CANDIDATES : AGENTS;
}

// A record on either candidate surface: the candidate modal, the candidate payload, the
// candidate verification mail.
const isCandidateSurface = (world) => surfaceName(world) !== AGENTS;

// The listing the modal steps act on. Defaults to Agents so the Givens that agent.js owns
// ("I am on the Agents listing") need no change and no companion step.
function surface(world) {
  const name = surfaceName(world);
  if (name === PROFILE_CANDIDATES) return world.pages.agentProfileCandidates;
  return name === CANDIDATES ? world.pages.candidatesListing : world.pages.agentsListing;
}

function rowsFrom(world, payload) {
  return isCandidateSurface(world)
    ? CandidatesListingPage.candidatesFrom(payload)
    : AgentsListingPage.agentsFrom(payload);
}

// The record an assertion is about - an agent or a candidate. `_agent` is read as a fallback
// so the agent Givens in agent.js still work as the subject-setter for this feature.
function subject(world) {
  const record = world._emailSubject || world._agent;
  if (!record || !record.email) {
    throw new Error(
      'No agent or candidate has been noted - a Given that notes one on a listing has to run first.'
    );
  }
  return record;
}

// Read the modal and insist it is showing the FORM, not the pending-change notice.
//
// The two share one heading and one `[role="dialog"]`, so a step that only checked "a modal is
// open" read the notice's zero labels and zero inputs and reported `the modal shows []` - a
// message that sends the reader after a form that never failed to render. `pending` is the
// flag that tells them apart; naming the state is the difference between a diagnosable red row
// and a wild goose chase.
async function readForm(world) {
  const state = await surface(world).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  if (state.pending) {
    throw new Error(
      'The modal is showing the PENDING-CHANGE NOTICE, not the form, so this scenario is '
      + 'driving a record that already has an email change in flight. That is correct app '
      + 'behaviour on such a record - the subject is wrong. Use '
      + '"Given I have noted the first Active agent with no email change pending".\n'
      + `Notice offers: ${JSON.stringify(state.buttons)}`
    );
  }
  return state;
}

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

// A fresh address on the inbox the suite can actually read.
//
// It HAS to be a `+tag` off GMAIL_USER on bytecorp: the change is only observable if the
// verification mail lands somewhere readable, and bytecorp preserves the +alias in the To
// header, which is the only thing distinguishing this run's mail from every other run's -
// anonaddy strips it. A random external address would deliver the mail nowhere the suite can
// see, and the scenario would report a missing email for a mail that was sent perfectly well.
let freshSeq = 0;
function freshAddress(prefix = 'editmail') {
  freshSeq += 1;
  const inbox = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
  const [local, domain] = inbox.split('@');
  return `${local}+${prefix}${Date.now().toString(36)}${freshSeq}@${domain}`;
}

// The inbox baseline for an alias freshAddress() has just generated. Such an alias has never
// received mail, so the answer is 0 by construction; the IMAP lookup only confirms it. It is
// BOUNDED because imapflow sets no connect timeout: on 2026-10-22, with both lanes running at
// once, one lookup hung until its 180s step budget ran out, before a single field was typed,
// and the scenario reported a step timeout against an app that was working (it passed alone in
// 2.5m straight after). Falling back to 0 cannot let an older mail through.
async function freshAliasBaseline(world, lookup, ms = 20000) {
  let timer;
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  const uid = await Promise.race([lookup().catch(() => 0), bound]).finally(() => clearTimeout(timer));
  if (uid === null) {
    world.attach(`The inbox baseline lookup did not answer within ${ms / 1000}s; using 0, which is `
      + 'exact for an alias generated moments ago.', 'text/plain');
    return 0;
  }
  return uid;
}

// Find the record again and read its row. Searching by the FULL address is what makes this
// exact: the Candidates listing runs to 211 pages, so scanning the rendered rows for a record
// touched seconds ago finds nothing - the trap the document-verification queue step was caught
// by, and the In Progress list after it.
async function findRow(world, email) {
  const result = await surface(world).search(email);
  world._emailLastList = result;
  const state = await surface(world).readRowEmailState(email);
  if (!state) {
    throw new Error(
      `${email} is not listed on the ${surfaceName(world)} listing after searching for it. `
      + `The server returned ${JSON.stringify(rowsFrom(world, result.payload).map((r) => r.email))}`
    );
  }
  return state;
}

// What the SERVER says about the record, which is the only machine-readable statement of the
// pending state. The DOM's red text is what a person sees; `pending_email` is what is true.
async function serverRecord(world, email) {
  const result = await surface(world).search(email);
  world._emailLastList = result;
  const rows = rowsFrom(world, result.payload);
  return rows.find((r) => String(r.email || '').toLowerCase() === String(email).toLowerCase())
    || rows.find((r) => String(r.pendingEmail || '').toLowerCase() === String(email).toLowerCase())
    || null;
}

// ==================== Choosing a listing and a subject ====================

Given('I am on the Candidates listing', { timeout: 90000 }, async function () {
  this._emailSurface = CANDIDATES;
  const result = await surface(this).runAndWaitForList(async () => {
    await surface(this).goto('All');
  });
  this._emailLastList = result;
});

Given('I have noted the first candidate on the {string} tab', { timeout: 120000 },
  async function (tab) {
    this._emailSurface = CANDIDATES;
    const page = surface(this);
    const result = await page.runAndWaitForList(async () => { await page.goto(tab); });
    this._emailLastList = result;
    const rows = (await page.readRows()).filter((r) => r.email);
    if (!rows.length) {
      throw new Error(`No candidate rows on the "${tab}" tab (${this.page.url()}).`);
    }
    const fromApi = CandidatesListingPage.candidatesFrom(result.payload)
      .find((c) => c.email === rows[0].email) || {};
    this._emailSubject = {
      kind: 'candidate', name: rows[0].name, email: rows[0].email, tab, ...fromApi,
    };
    this.attach(`Subject candidate on the "${tab}" tab: ${this._emailSubject.name} `
      + `<${this._emailSubject.email}>`, 'text/plain');
  });

// The tab-parameterised twin of agent.js's `I have noted the first agent on the Active tab`,
// which is hardcoded to Active. Deliberately worded differently ("agent listed") rather than
// widening that one to {string} - a {string} version would ALSO match the literal step and
// Cucumber would report both as ambiguous.
Given('I have noted the first agent listed on the {string} tab', { timeout: 120000 },
  async function (tab) {
    this._emailSurface = AGENTS;
    const page = surface(this);
    const result = await page.runAndWaitForList(async () => { await page.goto(tab); });
    this._emailLastList = result;
    const rows = (await page.readRows()).filter((r) => r.email);
    if (!rows.length) throw new Error(`No agent rows on the "${tab}" tab (${this.page.url()}).`);
    const fromApi = AgentsListingPage.agentsFrom(result.payload)
      .find((a) => a.email === rows[0].email) || {};
    this._emailSubject = { kind: 'agent', name: rows[0].name, email: rows[0].email, tab, ...fromApi };
    // `_agent` too, so the steps agent.js owns keep working on the same subject.
    this._agent = this._emailSubject;
    this.attach(`Subject agent on the "${tab}" tab: ${this._emailSubject.name} `
      + `<${this._emailSubject.email}>`, 'text/plain');
  });

// >>> THE FIRST ACTIVE AGENT IS NOT A SAFE SUBJECT FOR THE FORM, AND THAT IS THIS FEATURE'S
// OWN FAULT. <<< Measured 2026-09-04: the first FIVE rows of the Active tab were throwaway
// agents this feature's own `@mutates-email` scenarios had provisioned on earlier runs, each
// still carrying a `pending_email`. On such a record Edit does NOT open the form - the app
// correctly replaces it with the pending notice (the behaviour section 7 asserts positively),
// which has no labels and no inputs at all. So every form-contract scenario read an empty
// modal and reported `the modal shows []`, which reads exactly like a form that failed to
// render. Nothing was wrong with the product.
//
// The remedy is to SELECT the fixture on the property the scenario needs rather than assume
// row 1 has it. `pending_email` is on the payload, so this is observable rather than guessed -
// and when no such agent exists it fails naming every row it skipped, because a scenario that
// silently drove a pending record is what produced the false finding in the first place.
//
// Deliberately a NEW step rather than a change to agent.js's `I have noted the first agent on
// the Active tab`: nine scenarios in Agent-Search-Filters-View.feature use that one, where any
// agent will do, and narrowing it for all of them would be a change nobody there asked for.
Given('I have noted the first Active agent with no email change pending', { timeout: 180000 },
  async function () {
    this._emailSurface = AGENTS;
    const page = surface(this);
    const skipped = [];
    let chosen = null;

    let result = await page.runAndWaitForList(async () => { await page.goto('Active'); });
    for (let pageNo = 1; pageNo <= 5 && !chosen; pageNo += 1) {
      this._emailLastList = result;
      for (const agent of AgentsListingPage.agentsFrom(result.payload)) {
        if (!agent.email) continue;
        if (agent.pendingEmail) {
          skipped.push(`${agent.email} (pending change to ${agent.pendingEmail})`);
          continue;
        }
        chosen = agent;
        break;
      }
      if (chosen) break;
      if (!(await page.hasPagination()) || await page.isNextDisabled()) break;
      result = await page.goToNextPage();
    }

    if (!chosen) {
      throw new Error(
        'No Active agent without an email change already pending could be found in the first '
        + `5 pages of the Active tab, so the Update Email Address FORM cannot be reached - `
        + `Edit opens the pending notice on every one of these ${skipped.length} rows.\n`
        + `Skipped:\n${skipped.map((s) => `  - ${s}`).join('\n')}`
      );
    }

    this._emailSubject = { kind: 'agent', tab: 'Active', ...chosen };
    // `_agent` too, so the steps agent.js owns keep working on the same subject.
    this._agent = this._emailSubject;
    this.attach(
      `Subject agent (no pending email change): ${chosen.name} <${chosen.email}>\n`
      + `Skipped ${skipped.length} row(s) that already had a change in flight`
      + (skipped.length ? `:\n${skipped.map((s) => `  - ${s}`).join('\n')}` : '.'),
      'text/plain'
    );
  });

// >>> SOME ACTIVE AGENTS ARE REFUSED *ANY* EMAIL CHANGE, AND NOTHING ON THE API SAYS WHICH.
// <<< Measured 2026-09-04. `PATCH /agent/<user_id>/update-email/` answers
// `409 {"detail":"Agent has not yet claimed their account."}` for some Active agents and
// accepts the change (202) for others, and the two groups are IDENTICAL in every field the
// listing endpoint exposes - same status, `is_email_verified: true`, `pending_email: null`,
// a recent `last_login`. Proved not to be about the address being submitted: on one refused
// agent a duplicate address AND a brand-new one both came back 409.
//
// Consequence for this feature: a scenario about how a DUPLICATE address is refused cannot be
// pointed at an arbitrary Active agent, because on a refused agent the request never reaches
// the duplicate check and the red row then reports the wrong cause entirely.
//
// So the subject is a NAMED account measured to accept a change attempt. Pointing it at a
// fixture is safe here and only here: the address this scenario submits is already registered,
// so the attempt is ALWAYS refused and nothing about the agent can move. The Given still
// verifies the premise (Active, no change already pending) rather than trusting `.env`.
Given('I have noted an Active agent that can be offered an email change', { timeout: 120000 },
  async function () {
    this._emailSurface = AGENTS;
    const email = process.env.EDIT_EMAIL_CLAIMED_AGENT_EMAIL || process.env.TWOFA_AGENT_EMAIL;
    if (!email) {
      throw new Error('Set EDIT_EMAIL_CLAIMED_AGENT_EMAIL (or TWOFA_AGENT_EMAIL) in .env to the '
        + 'address of an Active agent the app will offer an email change for.');
    }
    const page = surface(this);
    await page.runAndWaitForList(async () => { await page.goto('Active'); });
    const result = await page.search(email, { tab: 'Active' });
    this._emailLastList = result;
    const row = AgentsListingPage.agentsFrom(result.payload)
      .find((a) => String(a.email || '').toLowerCase() === email.toLowerCase());
    if (!row) {
      throw new Error(`${email} is not listed on the Agents Active tab. The listing returned `
        + `${JSON.stringify(AgentsListingPage.agentsFrom(result.payload).map((a) => a.email))}`);
    }
    if (row.pendingEmail) {
      throw new Error(`${email} already has an email change pending to ${row.pendingEmail}, so `
        + 'Edit opens the pending notice and no form can be submitted. Wait for that change to '
        + 'settle or point EDIT_EMAIL_CLAIMED_AGENT_EMAIL at another Active agent.');
    }
    this._emailSubject = { kind: 'agent', tab: 'Active', ...row };
    this._agent = this._emailSubject;
    this.attach(`Subject agent (measured to accept a change attempt): ${row.name} <${row.email}>`,
      'text/plain');
  });

// ==================== Where the Edit action exists ====================
//
// One step, one table, every tab of both listings - and it collects across the whole table
// before throwing. An outline here would pay for a browser context and a superadmin login per
// row to assert one rule, and would still abandon each row independently.
Then('the row Edit action should be offered as follows:', { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const listingName = row.listing.trim();
    const tab = row.tab.trim();
    // `yes` = rendered AND enabled, `disabled` = rendered but not usable, `no` = not rendered.
    // The Candidates Deactivated tab renders Edit disabled on every row, so "offered" alone
    // reported a control nobody can use as a working one.
    const want = /^(yes|true|offered|enabled)$/i.test(row.edit.trim()) ? 'enabled'
      : /^disabled$/i.test(row.edit.trim()) ? 'disabled' : 'absent';
    this._emailSurface = listingName === CANDIDATES ? CANDIDATES : AGENTS;
    const page = surface(this);
    await page.runAndWaitForList(async () => { await page.goto(tab); });
    const rows = (await page.readRows()).filter((r) => r.email);
    if (!rows.length) {
      problems.push(`${listingName} > "${tab}": no rows to read, so the action set is unknown`);
      continue;
    }
    // Read EVERY row's state, not the first one's. A per-row difference (an action offered
    // on some records and not others) is a finding in itself, and `.first()` cannot see it.
    const states = await this.page.evaluate(() => Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]') && /@/.test(r.innerText || ''))
      .map((r) => {
        const b = Array.from(r.querySelectorAll('button')).find((x) => /^edit$/i
          .test(String(x.getAttribute('aria-label') || x.innerText || '').trim()));
        if (!b) return 'absent';
        return b.disabled || b.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'enabled';
      }));
    const tally = states.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});
    report.push(`${listingName} > "${tab}": Edit ${JSON.stringify(tally)} over ${states.length} rows `
      + `(first row's actions: ${JSON.stringify(rows[0].actions.filter((a) => !a.includes('@')))})`);
    const wrong = states.filter((s) => s !== want).length;
    if (wrong) {
      problems.push(`${listingName} > "${tab}": the table expects Edit ${want} on every row, `
        + `but the rows read ${JSON.stringify(tally)}`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The row Edit action is not offered where the table says it should be:');
});

// ==================== Opening the modal ====================

When('I open the Update Email Address modal for that agent', { timeout: 90000 }, async function () {
  const agent = subject(this);
  this._emailLastList = await surface(this).search(agent.name);
  await surface(this).openEmailDialog(agent.email);
});

// The record-neutral opener. It searches by the ADDRESS rather than the name: a candidate's
// name is not unique on this data (there are eight "Iqra Onboard" rows on page 1 alone), and
// opening the wrong row's modal would be invisible - the modal looks identical.
When('I open the Update Email Address modal for that record', { timeout: 120000 }, async function () {
  const record = subject(this);
  this._emailLastList = await surface(this).search(record.email);
  await surface(this).openEmailDialog(record.email);
});

// ==================== The form's contract ====================

Then('the modal heading should be {string}', async function (expected) {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  expect(state.heading).toBe(expected);
});

Then('the modal should show the fields:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const state = await readForm(this);
  const labels = state.labels.map((l) => l.replace(/\s*\*\s*$/, '').trim());
  const missing = expected.filter((e) => !labels.some((l) => l.toLowerCase() === e.toLowerCase()));
  expect(missing, `the modal shows ${JSON.stringify(labels)}`).toEqual([]);
});

Then("the current email address should be that agent's email", async function () {
  const agent = subject(this);
  const state = await readForm(this);
  expect(state.current, 'the modal has no Current Email Address field').toBeTruthy();
  expect(state.current.value.toLowerCase()).toBe(agent.email.toLowerCase());
});

Then("the current email address should be that record's email", async function () {
  const record = subject(this);
  const state = await readForm(this);
  expect(state.current, 'the modal has no current-email field').toBeTruthy();
  expect(state.current.value.toLowerCase()).toBe(record.email.toLowerCase());
});

Then('the current email address field should not be editable', async function () {
  const state = await readForm(this);
  expect(state.current, 'the modal has no Current Email Address field').toBeTruthy();
  expect(state.current.disabled, 'the Current Email Address field is editable').toBe(true);
});

Then('the modal {string} button should be disabled', async function (label) {
  const state = await surface(this).readEmailDialog();
  if (state) {
    expect(state.updateDisabled, `"${label}" is enabled. Modal errors: ${JSON.stringify(state.errors)}`).toBe(true);
    return;
  }
  await expect(this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()).toBeDisabled();
});

Then('the modal {string} button should be enabled', async function (label) {
  const state = await surface(this).readEmailDialog();
  if (state) {
    expect(state.updateDisabled, `"${label}" is disabled. Modal errors: ${JSON.stringify(state.errors)}`).toBe(false);
    return;
  }
  await expect(this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()).toBeEnabled();
});

Then('the modal should offer {string} and {string}', async function (a, b) {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  for (const label of [a, b]) {
    const found = state.buttons.some((x) => x.toLowerCase() === label.toLowerCase());
    expect(found, `the modal offers ${JSON.stringify(state.buttons)}`).toBe(true);
  }
});

// The primary button is "Update" on the Active and candidate listings and "Next" on the Invite
// Sent tab - measured 2026-09-03, and it is not cosmetic: they submit to the same endpoint and
// only one of them can succeed. Asserted rather than tolerated.
Then('the modal primary button should read {string}', async function (expected) {
  const state = await readForm(this);
  const shown = state.primaryLabel
    || (state.buttons.find((b) => /^(update|next)$/i.test(b)) || '');
  expect(shown, `the modal's buttons are ${JSON.stringify(state.buttons)}`).toBe(expected);
});

When('I enter {string} as the new email and {string} as the confirmation',
  { timeout: 60000 }, async function (newEmail, confirmEmail) {
    await surface(this).fillNewEmail(newEmail, confirmEmail);
  });

Then('no inline error should be shown in the modal', async function () {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  expect(state.errors, `the modal shows ${JSON.stringify(state.errors)}`).toEqual([]);
});

Then('the modal should show the inline error {string}', async function (message) {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  const found = state.errors.some((e) => e === message);
  expect(found, `expected the verbatim error ${JSON.stringify(message)} but the modal shows `
    + `${JSON.stringify(state.errors)}`).toBe(true);
});

Then('the modal should not show the inline error {string}', async function (message) {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  const found = state.errors.some((e) => e === message);
  expect(found, `the modal shows ${JSON.stringify(message)}, which it should not. `
    + `All errors: ${JSON.stringify(state.errors)}`).toBe(false);
});

// Every invalid combination in one pass, each with the verbatim message. The sentinel
// "THE RECORD'S OWN EMAIL" is resolved at runtime - the current address cannot be written into
// the feature file because the subject is chosen from live data. ("THE AGENT'S OWN EMAIL" is
// still accepted: the agent scenarios were written with it and the sentinel is not the point
// of the test.)
Then('each invalid email combination should be refused with its own message:',
  { timeout: 240000 }, async function (table) {
    const record = subject(this);
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const resolve = (v) => (/^THE (AGENT'S|RECORD'S) OWN EMAIL$/i.test(String(v).trim())
        ? record.email : v);
      const newEmail = resolve(row.newEmail);
      const confirmEmail = resolve(row.confirmEmail);
      const expected = row.message.trim();
      await surface(this).fillNewEmail(newEmail, confirmEmail);
      const state = await surface(this).readEmailDialog();
      report.push(`new=${JSON.stringify(newEmail)} confirm=${JSON.stringify(confirmEmail)} `
        + `-> updateDisabled=${state.updateDisabled} errors=${JSON.stringify(state.errors)}`);
      if (!state.errors.includes(expected)) {
        problems.push(`new=${JSON.stringify(newEmail)} confirm=${JSON.stringify(confirmEmail)}: expected the `
          + `verbatim message ${JSON.stringify(expected)} but the modal showed ${JSON.stringify(state.errors)}`);
      }
      if (state.updateDisabled !== true) {
        problems.push(`new=${JSON.stringify(newEmail)} confirm=${JSON.stringify(confirmEmail)}: the primary `
          + 'button is ENABLED for an invalid combination');
      }
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'The Update Email Address modal did not refuse every invalid combination with its own message:');
  });

// The two editable fields, by the label the modal renders. readEmailDialog() returns `labels`,
// `placeholders` and `values` in DOM order and the three inputs sit under the three labels in
// that same order, so the label is resolved to an INDEX rather than each field being given its
// own hardcoded position - a fourth field appearing would then shift every read together
// instead of silently re-pointing one assertion at its neighbour.
// Resolve a field by the label the app has BOUND to it (`<label for>` / `aria-labelledby`),
// falling back to the old position-matched arrays only if the markup carries no binding at all.
//
// Why it matters: `labels` and `placeholders` are two independent lists that a caller lines up
// by index, so they agree only while the modal renders exactly one label per input in the same
// order. It does today - measured 2026-09-04, three `<label for>`s each pointing at its own
// input's id. But a hint label, a helper line or a reordered field would silently shift the
// placeholder read one place and the assertion would PASS on the wrong field. Reading the
// binding the DOM already states is the difference between measuring and assuming.
function emailFieldIndex(state, label) {
  const want = String(label).trim().toLowerCase();
  const bound = (state.fields || []).find((f) => f.label && f.label.toLowerCase() === want);
  if (bound) return bound.index;

  const i = state.labels.findIndex((l) => l.replace(/\s*\*\s*$/, '').trim().toLowerCase() === want);
  if (i < 0) {
    throw new Error(
      `The modal has no "${label}" field. Labels bound to an input: `
      + `${JSON.stringify((state.fields || []).map((f) => f.label))}; every label in the modal: `
      + `${JSON.stringify(state.labels)}`
    );
  }
  return i;
}

// Both listings label their two editable fields differently ("Confirm Email Address" vs
// "Confirm New Email"), so this resolves by POSITION - they are always inputs 1 and 2, under
// whatever the labels happen to say.
Then('the New and Confirm email fields should be empty', async function () {
  const state = await readForm(this);
  expect([state.values[1], state.values[2]],
    `the modal holds ${JSON.stringify(state.values)} - a previous edit has leaked into a `
    + 'freshly opened modal').toEqual(['', '']);
});

Then('the {string} field placeholder should read {string}', async function (label, expected) {
  const state = await readForm(this);
  const shown = state.placeholders[emailFieldIndex(state, label)];
  expect(shown, `the "${label}" placeholder`).toBe(expected);
});

Then('the new email field should still hold {string}', async function (expected) {
  const state = await surface(this).readEmailDialog();
  expect(state, 'the Update Email Address modal is not open').toBeTruthy();
  expect(state.values[1], 'the New Email Address field').toBe(expected);
});

// The current address cannot be written into the feature file - the subject is chosen from
// live data - so the case variant is derived at runtime, the same way the invalid-combination
// table resolves its sentinel.
When("I enter that agent's own email address in upper case in both fields",
  { timeout: 60000 }, async function () {
    const upper = subject(this).email.toUpperCase();
    await surface(this).fillNewEmail(upper, upper);
    this.attach(`Typed ${upper} into both fields (the record's own address, upper-cased)`, 'text/plain');
  });

When("I enter that record's own email address in upper case in both fields",
  { timeout: 60000 }, async function () {
    const upper = subject(this).email.toUpperCase();
    await surface(this).fillNewEmail(upper, upper);
    this.attach(`Typed ${upper} into both fields (the record's own address, upper-cased)`, 'text/plain');
  });

// ==================== Leaving the modal ====================

When('I cancel the Update Email Address modal', { timeout: 60000 }, async function () {
  await surface(this).cancelEmailDialog();
});

When('I close the Update Email Address modal with the X icon', { timeout: 60000 }, async function () {
  await surface(this).closeEmailDialogWithIcon();
});

When('I dismiss the Update Email Address modal with Escape', { timeout: 60000 }, async function () {
  await surface(this).escapeEmailDialog();
});

Then('the Update Email Address modal should not be visible', async function () {
  expect(await surface(this).emailDialog.isVisible().catch(() => false),
    'the Update Email Address modal is still open').toBe(false);
});

Then('the Update Email Address modal should still be open', async function () {
  const open = await surface(this).emailDialog.isVisible().catch(() => false);
  expect(open, 'the Update Email Address modal closed, so the submission was accepted').toBe(true);
});

// NOTE `that agent should still be listed with the original email address` is NOT defined
// here. agent.js already owns it, and its version is the stronger one - it asserts that the
// re-search actually fired a request, without which the assertion would be made against the
// payload captured before the modal was opened and could not prove anything about the
// cancellation. The candidate twin below exists because that step is bound to the Agents
// listing.
Then('that record should still be listed with the original email address', { timeout: 120000 },
  async function () {
    const record = subject(this);
    await surface(this).goto(record.tab || (isCandidateSurface(this) ? 'All' : 'Active'));
    const found = await serverRecord(this, record.email);
    expect(found, `${record.email} is no longer listed - the cancelled edit appears to have been applied`)
      .toBeTruthy();
    expect(String(found.pendingEmail || '') === '' || found.pendingEmail === null,
      `${record.email} now has a pending change to ${found.pendingEmail}, so the modal was `
      + 'submitted when it should only have been closed').toBe(true);
  });

// ==================== Submitting ====================

When('I submit the Update Email Address form', { timeout: 120000 }, async function () {
  this._emailSubmission = await surface(this).submitEmailUpdate();
  this.attach(`Submitted with "${this._emailSubmission.buttonLabel}": `
    + `toasts=${JSON.stringify(this._emailSubmission.toasts)} `
    + `modalStillOpen=${this._emailSubmission.dialogStillOpen} `
    + `${this._emailSubmission.gatedBecause || ''}`, 'text/plain');
});

function submission(world) {
  if (!world._emailSubmission) {
    throw new Error('Nothing has been submitted yet - a When that submits the form has to run first.');
  }
  return world._emailSubmission;
}

// Refusal FIRST, wording SECOND, and both reported together rather than one throwing over the
// other. "It was refused with different words" and "it was not refused at all" are completely
// different findings, and only the second is a defect worth stopping a release for.
Then('the update should be refused with the message {string}', async function (expected) {
  const result = submission(this);
  const problems = [];
  if (result.submitted && !result.dialogStillOpen) {
    problems.push('the modal CLOSED, which is what it does on a successful submission - the '
      + 'change appears to have been accepted');
  }
  if (!result.toasts.some((t) => t === expected)) {
    // A "has not yet claimed their account" answer is a DIFFERENT refusal from the one being
    // asserted, and reporting it as a wording mismatch sends the reader after a copy bug. It
    // means the request never reached the rule under test - see the note on
    // `I have noted an Active agent that can be offered an email change`.
    if (result.toasts.some((t) => /not yet claimed their account/i.test(t))) {
      problems.push('the app refused the change BEFORE reaching this rule, with '
        + `${JSON.stringify(result.toasts)}. That is the claimed-account check, not the rule this `
        + 'step asserts, so this scenario is driving an agent the app will not offer any email '
        + 'change for. Nothing on the listing endpoint distinguishes such an agent.');
    } else {
      problems.push(`expected the verbatim message ${JSON.stringify(expected)} but the app said `
        + `${JSON.stringify(result.toasts)}`);
    }
  }
  fail(problems, `The ${surfaceName(this)} listing did not refuse the email change as measured:`);
});

Then('the update should be accepted with the message {string}', async function (expected) {
  const result = submission(this);
  const problems = [];
  if (!result.submitted) problems.push(result.gatedBecause);
  if (result.dialogStillOpen) {
    problems.push('the modal is STILL OPEN, which is what it does on a refusal');
  }
  if (!result.toasts.some((t) => t === expected)) {
    problems.push(`expected the verbatim message ${JSON.stringify(expected)} but the app said `
      + `${JSON.stringify(result.toasts)}`);
  }
  fail(problems, `The ${surfaceName(this)} listing did not accept the email change as measured:`);
});

// ==================== The pending state ====================

// The address is generated, never written into the feature file: a fixed address would already
// hold an account after its first run, so every later run would silently be exercising the
// duplicate-address path instead of a first change.
When('I change that record\'s email to a fresh address on the test inbox', { timeout: 180000 },
  async function () {
    const record = subject(this);
    const fresh = freshAddress(isCandidateSurface(this) ? 'editcand' : 'editagent');
    // Baseline the inbox BEFORE the change. These are long-lived mailboxes holding every
    // earlier run's mail, so "a verification mail exists" proves nothing; "one arrived after
    // this UID, addressed to this alias" does.
    this._emailVerifyBaseline = await freshAliasBaseline(this, () => latestUid({
      subject: 'Verify your new Talentforge email address', to: fresh,
    }));
    await surface(this).fillNewEmail(fresh, fresh);
    this._emailSubmission = await surface(this).submitEmailUpdate();
    this._emailPendingAddress = fresh;
    this.attach(`Requested change: ${record.email} -> ${fresh}\n`
      + `toasts=${JSON.stringify(this._emailSubmission.toasts)}`, 'text/plain');
  });

function pendingAddress(world) {
  if (!world._emailPendingAddress) {
    throw new Error('No email change has been requested in this scenario.');
  }
  return world._emailPendingAddress;
}

// The visual half of the pending state. Colour is MEASURED, never inferred from a class name:
// the two listings paint the same red through two different Tailwind classes
// (text-fg-error-primary and text-error-600), so a class match would answer "not pending" on
// one of them - and this repo has twice reported a working visual treatment as missing by
// testing the one CSS property somebody guessed at.
Then('the listing should show that address in red with a warning icon', { timeout: 120000 },
  async function () {
    const record = subject(this);
    const state = await findRow(this, record.email);
    this._emailRowState = state;
    const problems = [];
    if (!state.paintedAsError) {
      problems.push(`the address is painted ${state.colour} (class ${JSON.stringify(state.className)}), `
        + 'which is not a red');
    }
    if (!state.hasWarningIcon) problems.push('no warning icon is rendered beside the address');
    this.attach(`Row for ${record.email}: colour=${state.colour} icon=${state.hasWarningIcon} `
      + `class=${state.className}`, 'text/plain');
    fail(problems, 'The listing does not mark the address as awaiting verification:');
  });

// Hover is what the requirement describes, so hover is tried first and the route that worked
// is asserted separately from the wording. A tooltip that only opens on focus is a real
// accessibility-adjacent finding, but it is not the same finding as the wrong words.
Then('hovering the warning icon should read {string}', { timeout: 120000 }, async function (expected) {
  const record = subject(this);
  const tip = await surface(this).readPendingTooltip(record.email);
  this.attach(`Tooltip: opened=${tip.opened} via=${tip.via || '-'} `
    + `text=${JSON.stringify(tip.text)} ${tip.reason || ''}`, 'text/plain');
  expect(tip.opened, `no tooltip appeared - ${tip.reason}`).toBe(true);
  expect(tip.text, `the tooltip (opened on ${tip.via}) reads ${JSON.stringify(tip.text)}`).toBe(expected);
});

// The address the row DISPLAYS while a change is pending is still the old one - the account
// has not moved yet, and a listing that showed the new address would be telling the superadmin
// the change had taken effect.
Then('the listing should still show the original address as the live one', { timeout: 120000 },
  async function () {
    const record = subject(this);
    const state = this._emailRowState || await findRow(this, record.email);
    expect(state.email.toLowerCase(), 'the row shows an address other than the one still in force')
      .toBe(record.email.toLowerCase());
  });

Then('the server should record the new address as pending verification', { timeout: 120000 },
  async function () {
    const record = subject(this);
    const fresh = pendingAddress(this);
    const found = await serverRecord(this, record.email);
    expect(found, `${record.email} was not returned by the listing endpoint`).toBeTruthy();
    expect(String(found.pendingEmail || '').toLowerCase(),
      `the record's pending_email is ${JSON.stringify(found.pendingEmail)}`).toBe(fresh.toLowerCase());
    expect(String(found.email).toLowerCase(),
      'the live address has already moved, so the change was applied without verification')
      .toBe(record.email.toLowerCase());
  });

// ==================== The already-pending notice ====================

Then('the modal should say an email update is already pending', { timeout: 60000 }, async function () {
  const notice = await surface(this).readPendingNotice();
  this._emailNotice = notice;
  const state = await surface(this).readEmailDialog();
  expect(notice, 'the modal opened as the ordinary form, not as the already-pending notice. '
    + `It shows ${JSON.stringify(state && state.labels)}`).toBeTruthy();
  this.attach(notice.text, 'text/plain');
});

Then('the pending notice should name the live address and the pending one', async function () {
  const record = subject(this);
  const fresh = pendingAddress(this);
  const notice = this._emailNotice;
  expect(notice, 'no pending notice has been read').toBeTruthy();
  const shown = notice.emails.map((e) => e.toLowerCase());
  const problems = [];
  if (!shown.includes(record.email.toLowerCase())) {
    problems.push(`the live address ${record.email} is not named. The notice shows ${JSON.stringify(notice.emails)}`);
  }
  if (!shown.includes(fresh.toLowerCase())) {
    problems.push(`the pending address ${fresh} is not named. The notice shows ${JSON.stringify(notice.emails)}`);
  }
  fail(problems, 'The already-pending notice does not state which change is in flight:');
});

Then('the pending notice should say it is awaiting verification and offer {string}', async function (cta) {
  const notice = this._emailNotice;
  expect(notice, 'no pending notice has been read').toBeTruthy();
  const problems = [];
  if (!/awaiting verification/i.test(notice.text)) {
    problems.push(`the notice does not say it is awaiting verification. It reads: ${notice.text}`);
  }
  if (!notice.buttons.some((b) => b.toLowerCase() === cta.toLowerCase())) {
    problems.push(`it does not offer "${cta}". It offers ${JSON.stringify(notice.buttons)}`);
  }
  // No inputs at all is the whole point of this face of the modal - the form is REPLACED, not
  // pre-filled, so an assertion that only checked the wording would pass on a form that let
  // the superadmin type over a change already in flight.
  if (notice.inputs !== 0) {
    problems.push(`the notice still renders ${notice.inputs} input(s), so the form was not replaced`);
  }
  fail(problems, 'The already-pending notice does not match what the app renders:');
});

When('I choose {string} on the pending notice', { timeout: 60000 }, async function (cta) {
  expect(cta.toLowerCase()).toBe('edit email');
  await surface(this).clickEditPendingEmail();
});

Then('the form should reopen with the live address as the current email', { timeout: 60000 },
  async function () {
    const record = subject(this);
    const state = await surface(this).readEmailDialog();
    expect(state, 'the modal is not open').toBeTruthy();
    expect(state.pending, 'the modal is still showing the pending notice, not the form').toBe(false);
    expect(state.current && state.current.value.toLowerCase(),
      `the current-email field holds ${JSON.stringify(state.current && state.current.value)}; the form `
      + 'should show the address still in force, not the pending one').toBe(record.email.toLowerCase());
    expect([state.values[1], state.values[2]],
      `the form reopened holding ${JSON.stringify(state.values)}`).toEqual(['', '']);
  });

// ==================== Verification ====================

Then('a verification email should be delivered to the new address', { timeout: 300000 },
  async function () {
    const fresh = pendingAddress(this);
    const mail = await waitForEmail('agentEmailVerify', {
      to: fresh,
      afterUid: this._emailVerifyBaseline || 0,
      timeoutMs: 240000,
      pollMs: 6000,
    });
    this._emailVerifyLink = mail.link;
    this.attach(`Verification mail to ${fresh}\n  subject: ${mail.parsed.subject}\n`
      + `  from   : ${(mail.parsed.from || {}).text}\n  link   : ${mail.link}`, 'text/plain');
    expect(mail.link, 'the verification email carries no actionable link').toBeTruthy();
  });

// The link is followed in an ISOLATED context. It has to be: the scenario's own page holds the
// superadmin session, and confirming an email change from inside it would prove the flow works
// for a signed-in superadmin rather than for the recipient, who is not signed in at all.
When('the recipient opens the verification link', { timeout: 180000 }, async function () {
  expect(this._emailVerifyLink, 'no verification link has been captured').toBeTruthy();
  const context = await this.browser.newContext();
  this._emailVerifyContext = context;
  const page = await context.newPage();
  await page.goto(this._emailVerifyLink, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // The SendGrid wrapper redirects, and the app then resolves the token client-side, so the
  // landing URL commits well before the verdict is painted.
  await page.waitForTimeout(4000);
  this._emailVerifyLanding = {
    url: page.url(),
    text: (await page.innerText('body')).replace(/\s+/g, ' ').trim(),
  };
  this._emailVerifyPage = page;
  this.attach(`Verification landing:\n  ${this._emailVerifyLanding.url}\n  `
    + `${this._emailVerifyLanding.text}`, 'text/plain');
});

Then('the verification page should confirm the address is now active', async function () {
  const landing = this._emailVerifyLanding;
  expect(landing, 'the verification link was never opened').toBeTruthy();
  const problems = [];
  if (!/verify-email-change/.test(landing.url)) {
    problems.push(`it landed on ${landing.url}, which is not the app's verify-email-change route`);
  }
  if (!/email address confirmed/i.test(landing.text)) {
    problems.push(`the page does not confirm the change. It reads: ${landing.text}`);
  }
  if (!/now active/i.test(landing.text)) {
    problems.push(`the page does not say the new address is active. It reads: ${landing.text}`);
  }
  fail(problems, 'Following the verification link did not confirm the email change:');
});

// A one-time link is one-time, and proving that costs nothing here - the same page, the same
// token, a second visit. Left LAST in its scenario on purpose: it is the least important
// assertion in the walkthrough and must not cost the ones above it.
Then('opening the same link again should report it invalid or expired', { timeout: 120000 },
  async function () {
    const page = this._emailVerifyPage;
    expect(page, 'the verification link was never opened').toBeTruthy();
    await page.goto(this._emailVerifyLanding.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const text = (await page.innerText('body')).replace(/\s+/g, ' ').trim();
    this.attach(`Second visit to the same link:\n  ${text}`, 'text/plain');
    expect(text, `re-opening a consumed verification link reads: ${text}`)
      .toMatch(/invalid or has expired|no longer valid/i);
  });

Then('the listing should show the new address with no pending marker', { timeout: 180000 },
  async function () {
    const record = subject(this);
    const fresh = pendingAddress(this);
    await surface(this).goto(record.tab || (isCandidateSurface(this) ? 'All' : 'Active'));
    const state = await findRow(this, fresh);
    const found = await serverRecord(this, fresh);
    const problems = [];
    if (state.email.toLowerCase() !== fresh.toLowerCase()) {
      problems.push(`the row still shows ${state.email}, not the verified ${fresh}`);
    }
    if (state.paintedAsError) {
      problems.push(`the address is still painted ${state.colour}, so the row still reads as pending`);
    }
    if (state.hasWarningIcon) problems.push('the warning icon is still rendered');
    if (found && found.pendingEmail) {
      problems.push(`the server still records pending_email=${JSON.stringify(found.pendingEmail)}`);
    }
    this.attach(`After verification: shown=${state.email} colour=${state.colour} `
      + `icon=${state.hasWarningIcon} pending_email=${JSON.stringify(found && found.pendingEmail)}`,
    'text/plain');
    fail(problems, `The ${surfaceName(this)} listing did not settle on the verified address:`);
    // The subject moves with the account, so anything after this step reads the new address.
    this._emailSubject = { ...record, email: fresh };
    if (this._agent) this._agent = { ...this._agent, email: fresh };
  });

// ==================== The throwaway subject for the walkthrough ====================
//
// The end-to-end scenarios really change an address, so they own a brand-new agent and abandon
// it. NOTHING here may run against a fixture: an agent cannot be deleted, and an address that
// has moved cannot be moved back without a second verification round trip, so a careless run
// would leave a shared account reachable only at an address nothing in .env records.
Given('I have provisioned a throwaway agent for the email-change walkthrough', { timeout: 600000 },
  async function () {
    const agent = await provisionAgentWithoutPromo(this.browser, {
      label: 'edit-email-walkthrough',
      firstName: 'Editmail',
      tagPrefix: 'edmail',
    });
    this._emailSurface = AGENTS;
    this._emailSubject = { kind: 'agent', name: agent.name, email: agent.email, tab: 'Active' };
    this._agent = this._emailSubject;
    if (!this._emailThrowaways) this._emailThrowaways = [];
    this._emailThrowaways.push({ ...agent });
    this.attach(`Provisioned throwaway agent for this scenario:\n  name : ${agent.name}\n`
      + `  email: ${agent.email}\n`
      + 'It is abandoned when the scenario ends - nothing in .env refers to it.', 'text/plain');
    await surface(this).goto('Active');
    this._emailLastList = await surface(this).search(agent.name);
  });

// ==================== Invite Sent: change the address and resend the invitation ====================
//
// NEW FLOW, measured 2026-10-20 (scripts/probe-invite-sent-edit-email*.js; the full table is in the
// INVITE SENT section of AgentsListingPage.js). An agent who has NOT claimed their invite can have
// their address changed: the form's "Next" is replaced by a "Resend Invitation" confirmation, and
// only "Resend Invite" writes anything. Whatever presses Resend Invite runs on an agent the
// scenario invites itself - a refusal that ever stopped refusing would otherwise rename a shared
// Invite Sent agent and mail the result.

const LoginPage = require('../pages/LoginPage');
const { loginSuperadmin, inviteWithPromo } = require('../utils/promoAgentProvision');
const { baselineInviteMail, waitForInviteMail } = require('../utils/agentInviteProvision');

const API_HOST = /dev-api\.talentforge\.com\.sa/;

// Every non-GET API call the page makes, kept from the first time any step below needs it. A step
// takes an index into it rather than resetting it, so nothing earlier is destroyed. Bodies are read
// asynchronously, so `flushWrites` awaits them before a step reads the log.
function recordWrites(world) {
  if (world._emailWritesPage === world.page) return world._emailWrites;
  world._emailWrites = [];
  world._emailWritesPending = [];
  world._emailWritesPage = world.page;
  world.page.on('response', (r) => {
    const req = r.request();
    if (!API_HOST.test(r.url()) || req.method() === 'GET') return;
    const entry = { method: req.method(), status: r.status(), path: r.url().replace(/^https:\/\/[^/]+/, ''), body: null };
    world._emailWrites.push(entry);
    world._emailWritesPending.push(r.text().then((t) => { entry.body = t.slice(0, 400); }).catch(() => {}));
  });
  return world._emailWrites;
}

async function writesSince(world, mark) {
  await world.page.waitForTimeout(800);
  await Promise.all(world._emailWritesPending || []);
  return (world._emailWrites || []).slice(mark);
}

const showWrites = (ws) => (ws.length ? ws.map((w) => `${w.method} ${w.status} ${w.path} ${w.body || ''}`).join('\n') : '(none)');

// The modal's quotes are typographic in one sentence and straight in the next ("You’re" in the
// change confirmation, "You're" in the plain resend), so copy is compared with them folded.
const fold = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

// Table cells cannot hold an empty or all-space string (Gherkin trims them), nor an address
// chosen at run time, so those are written as sentinels.
function resolveAddress(world, cell) {
  const record = subject(world);
  const v = String(cell);
  const other = process.env.AGENT_EMAIL;
  const candidate = process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL;
  const map = {
    '<empty>': '',
    '<spaces>': '   ',
    '<current>': record.email,
    '<current in upper case>': record.email.toUpperCase(),
    "<another agent's email>": other,
    "<another agent's email in upper case>": other && other.toUpperCase(),
    "<a candidate's email>": candidate,
  };
  if (!(v in map)) return v;
  if (map[v] === undefined || map[v] === null) throw new Error(`No address in .env for ${v} (AGENT_EMAIL / CANDIDATE_DETAILS_EMAIL).`);
  if (/another agent|candidate/.test(v) && map[v].toLowerCase() === record.email.toLowerCase()) {
    throw new Error(`${v} resolves to the subject's own address, so the row cannot test a DIFFERENT existing account.`);
  }
  return map[v];
}

// Re-open the form for the subject from its own tab. A successful change starts a two-minute
// re-invite cooldown during which the row's Edit is disabled, so this waits that out rather than
// timing out on a disabled button.
async function openFormFor(world) {
  const record = subject(world);
  const page = surface(world);
  const deadline = Date.now() + 170000;
  for (;;) {
    await page.goto(record.tab || 'Invite Sent');
    await page.search(record.email);
    const actions = await page.readInviteRowActions(record.email);
    if (actions.edit !== false) break;
    if (Date.now() > deadline) throw new Error(`Edit stayed disabled on ${record.email} for ~3 minutes.`);
    await world.page.waitForTimeout(10000);
  }
  await page.openEmailDialog(record.email);
}

async function closeEverything(world) {
  const page = surface(world);
  if (await page.resendDialog.isVisible().catch(() => false)) await page.leaveResendDialog('Cancel');
  if (await page.emailDialog.isVisible().catch(() => false)) await page.cancelEmailDialog();
}

async function signInAttempt(browser, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(password);
    const answered = page.waitForResponse((r) => /\/auth\/token\/$/.test(r.url()), { timeout: 45000 }).catch(() => null);
    await login.submitButton.first().click();
    const response = await answered;
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15000, waitUntil: 'commit' }).catch(() => {});
    return { status: response && response.status(), url: page.url() };
  } finally {
    await context.close().catch(() => {});
  }
}

// An agent invited for THIS scenario and never accepted, so it sits on Invite Sent. Cheaper than
// the walkthrough's provisioning - no set-password walk - and the only kind of agent the Resend
// Invite path may be pressed on.
Given('I have invited a throwaway agent who has not claimed the invite', { timeout: 300000 },
  async function () {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    let invited;
    try {
      await loginSuperadmin(page);
      invited = await inviteWithPromo(page, { promo: 'unchecked', firstName: 'Invsent', tagPrefix: 'invsent' });
    } finally {
      await context.close().catch(() => {});
    }
    const { identity, baseline } = invited;
    const name = `${identity.firstName} ${identity.lastName}`;
    this._emailSurface = AGENTS;
    this._emailSubject = { kind: 'agent', name, email: identity.email, tab: 'Invite Sent' };
    this._agent = this._emailSubject;
    this._inviteOriginal = { email: identity.email, baseline };
    if (!this._emailThrowaways) this._emailThrowaways = [];
    this._emailThrowaways.push({ name, email: identity.email });
    await surface(this).waitForAgentOnTab('Invite Sent', { email: identity.email });
    this.attach(`Invited throwaway agent (never accepted): ${name} <${identity.email}>`, 'text/plain');
  });

When('I enter a fresh address on the test inbox as the new email and confirmation', { timeout: 60000 },
  async function () {
    const fresh = freshAddress('invsentnew');
    this._inviteNew = { email: fresh, baseline: await freshAliasBaseline(this, () => baselineInviteMail(fresh)) };
    await surface(this).fillNewEmail(fresh, fresh);
  });

When('I press Next on the Update Email Address modal', { timeout: 60000 }, async function () {
  recordWrites(this);
  this._emailWritesMark = this._emailWrites.length;
  this._emailNext = await surface(this).pressEmailNext();
  this.attach(`Next ("${this._emailNext.label}", disabled=${this._emailNext.disabled}): `
    + `resend dialog open=${this._emailNext.resendOpen}, form open=${this._emailNext.formOpen}`, 'text/plain');
});

Then('the form should have been replaced by the Resend Invitation dialog', async function () {
  const n = this._emailNext;
  expect(n, 'Next has not been pressed').toBeTruthy();
  const problems = [];
  if (!n.resendOpen) {
    problems.push(`Next did not open "Resend Invitation" - the form is ${n.formOpen ? 'still open' : 'gone'}`
      + `${n.form ? ` showing errors ${JSON.stringify(n.form.errors)}` : ''}`);
  }
  if (n.formOpen) problems.push('the Update Email Address form is still on screen beside it');
  fail(problems, 'Next did not move on to the resend confirmation:');
});

Then('the Resend Invitation dialog should read:', async function (table) {
  const state = await surface(this).readResendDialog();
  expect(state, 'the Resend Invitation dialog is not open').toBeTruthy();
  const lines = [state.heading, ...state.lines].map(fold);
  const missing = table.raw().map((r) => fold(r[0])).filter((want) => !lines.includes(want));
  expect(missing, `the dialog renders the lines ${JSON.stringify(lines)}`).toEqual([]);
});

Then('the Resend Invitation dialog should name the new address', async function () {
  const state = await surface(this).readResendDialog();
  expect(state, 'the Resend Invitation dialog is not open').toBeTruthy();
  const lines = state.lines.map(fold);
  const problems = [];
  if (!lines.includes(fold("You're about to resend the invitation to the updated email address:"))) {
    problems.push(`the dialog does not say it resends to an UPDATED address: ${JSON.stringify(lines)}`);
  }
  if (!lines.includes(this._inviteNew.email)) problems.push(`the dialog does not name ${this._inviteNew.email}: ${JSON.stringify(lines)}`);
  fail(problems, 'The Resend Invitation dialog does not describe the change:');
});

Then('the Resend Invitation dialog should offer {string}, {string} and a close icon', async function (a, b) {
  const state = await surface(this).readResendDialog();
  expect(state, 'the Resend Invitation dialog is not open').toBeTruthy();
  const offered = state.buttons.map((x) => x.toLowerCase());
  const missing = [a, b, 'close'].filter((x) => !offered.includes(x.toLowerCase()));
  expect(missing, `the dialog offers ${JSON.stringify(state.buttons)}`).toEqual([]);
});

Then('no email change should have been sent to the server', async function () {
  const ws = await writesSince(this, this._emailWritesMark || 0);
  expect(ws, `pressing Next already wrote to the server:\n${showWrites(ws)}`).toEqual([]);
});

// Both dialogs, every documented way out, each from a fresh open. Collected and reported together:
// "Escape on the confirmation sends the change" and "Cancel on the form keeps the text" are
// unrelated failures, and one scenario per row would pay a login each to learn them.
Then('leaving each dialog each way should change nothing and send nothing:', { timeout: 300000 },
  async function (table) {
    recordWrites(this);
    const page = surface(this);
    const problems = [];
    const report = [];
    for (const { dialog, 'way out': how } of table.hashes()) {
      const label = `${dialog} / ${how}`;
      const typed = freshAddress('invsentdiscard');
      await openFormFor(this);
      await page.fillNewEmail(typed, typed);
      const mark = this._emailWrites.length;
      if (/resend/i.test(dialog)) {
        const n = await page.pressEmailNext();
        if (!n.resendOpen) { problems.push(`${label}: Next did not open the Resend Invitation dialog`); await closeEverything(this); continue; }
        await page.leaveResendDialog(how);
      } else if (/^cancel$/i.test(how)) await page.cancelEmailDialog();
      else if (/x icon/i.test(how)) await page.closeEmailDialogWithIcon();
      else if (/^escape$/i.test(how)) await page.escapeEmailDialog();
      else throw new Error(`Unknown way out "${how}"`);
      const resendOpen = await page.resendDialog.isVisible().catch(() => false);
      const formOpen = await page.emailDialog.isVisible().catch(() => false);
      if (resendOpen || formOpen) problems.push(`${label}: ${resendOpen ? 'Resend Invitation' : 'the form'} is still open`);
      const ws = await writesSince(this, mark);
      if (ws.length) problems.push(`${label}: wrote to the server:\n${showWrites(ws)}`);
      await closeEverything(this);
      await openFormFor(this);
      const state = await page.readEmailDialog();
      if (state && (state.values[1] || state.values[2])) problems.push(`${label}: re-opening Edit still holds ${JSON.stringify(state.values)}`);
      await closeEverything(this);
      report.push(`${label}: closed, ${ws.length} writes, reopened empty=${!(state && (state.values[1] || state.values[2]))}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Leaving the Invite Sent email change did not leave the agent untouched:');
  });

// The gate itself, row by row, read straight after filling and WITHOUT pressing Next - a state
// assertion, so nothing can be written. The first row is the form as it opens.
Then('the Next button should be in this state for each input:', { timeout: 300000 }, async function (table) {
  const page = surface(this);
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const nv = resolveAddress(this, row['new email']);
    const cv = resolveAddress(this, row.confirmation);
    const label = `${row['new email']} / ${row.confirmation}`;
    await openFormFor(this);
    const opened = await page.readEmailDialog();
    if (nv || cv) await page.fillNewEmail(nv, cv);
    const state = await page.readEmailDialog();
    const shown = state.updateDisabled ? 'disabled' : 'enabled';
    if (shown !== row.Next) problems.push(`${label}: Next is ${shown}, expected ${row.Next} (form shows ${JSON.stringify(state.errors)})`);
    report.push(`${label}: on open ${opened.updateDisabled ? 'disabled' : 'enabled'}, after input ${shown}, errors ${JSON.stringify(state.errors)}`);
    await closeEverything(this);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'Next is not gated on a usable address:');
});

// The Active tab's form stops each of these inline before anything is sent; the Invite Sent tab's
// form is expected to do the same. "-" means "stopped, no particular message required" (the
// Active tab gates a half-filled form silently).
Then('each unusable address should be stopped on the form before the resend step:', { timeout: 300000 },
  async function (table) {
    recordWrites(this);
    const page = surface(this);
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const nv = resolveAddress(this, row['new email']);
      const cv = resolveAddress(this, row.confirmation);
      const label = `${row['new email']} / ${row.confirmation}`;
      await openFormFor(this);
      await page.fillNewEmail(nv, cv);
      const mark = this._emailWrites.length;
      const n = await page.pressEmailNext();
      const errors = (n.form && n.form.errors) || [];
      const where = n.resendOpen
        ? `went on to "Resend Invitation" (${fold((await page.readResendDialog() || {}).text)})`
        : (n.formOpen ? 'stayed on the form' : 'closed');
      if (n.resendOpen || !n.formOpen) problems.push(`${label}: ${where}`);
      if (row.message !== '-' && !errors.includes(row.message)) {
        problems.push(`${label}: no inline "${row.message}" - the form shows ${JSON.stringify(errors)}`);
      }
      const ws = await writesSince(this, mark);
      if (ws.length) problems.push(`${label}: Next wrote to the server:\n${showWrites(ws)}`);
      report.push(`${label}: ${where}, errors ${JSON.stringify(errors)}, Next disabled=${n.disabled}`);
      await closeEverything(this);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'The Invite Sent form does not stop an unusable address itself:');
  });

When('I confirm Resend Invite', { timeout: 60000 }, async function () {
  recordWrites(this);
  this._resendMark = this._emailWrites.length;
  this._resendResult = await surface(this).confirmResendCapturing();
  this._resendWrites = await writesSince(this, this._resendMark);
  this.attach(`Resend Invite: toasts=${JSON.stringify(this._resendResult.toasts)}\n${showWrites(this._resendWrites)}`, 'text/plain');
});

function changeWrite(world) {
  return (world._resendWrites || []).find((w) => /\/agent\/\d+\/update-email\/$/.test(w.path));
}

Then('the change should be accepted with the toast {string}', async function (expected) {
  const r = this._resendResult;
  expect(r, 'Resend Invite has not been confirmed').toBeTruthy();
  const w = changeWrite(this);
  const problems = [];
  if (!w) problems.push(`no PATCH .../update-email/ was made:\n${showWrites(this._resendWrites)}`);
  else if (w.status >= 300) problems.push(`the server refused the change: ${w.status} ${w.body}`);
  if (!r.toasts.includes(expected)) problems.push(`expected the toast ${JSON.stringify(expected)}, the app showed ${JSON.stringify(r.toasts)}`);
  if (r.resendOpen || r.formOpen) problems.push('a dialog is still open after a successful change');
  fail(problems, 'The Invite Sent email change was not accepted as measured:');
});

Then('the server should have changed the address straight away rather than holding it pending', async function () {
  const w = changeWrite(this);
  expect(w, 'no update-email request was recorded').toBeTruthy();
  let body = {};
  try { body = JSON.parse(w.body); } catch (e) { /* reported below */ }
  expect(body.email, `the server's answer does not name the new address: ${w.body}`).toBe(this._inviteNew.email);
  expect(body.detail, `the server's answer: ${w.body}`).toBe('Invite re-sent successfully.');
});

Then('the Invite Sent tab should list the agent at the new address with no pending marker', { timeout: 120000 },
  async function () {
    const fresh = this._inviteNew.email;
    await surface(this).goto('Invite Sent');
    const found = await serverRecord(this, fresh);
    const row = await surface(this).readRowEmailState(fresh).catch(() => null);
    const problems = [];
    if (!found) problems.push(`${fresh} is not listed on Invite Sent`);
    else {
      if (String(found.email).toLowerCase() !== fresh) problems.push(`the record's live address is ${found.email}, not ${fresh}`);
      if (found.pendingEmail) problems.push(`the record holds a pending change to ${found.pendingEmail}`);
      if (found.status !== 'INVITE_SENT') problems.push(`the record's status is ${found.status}, not INVITE_SENT`);
    }
    if (row && (row.paintedAsError || row.hasWarningIcon)) problems.push(`the row paints the address as pending: ${JSON.stringify(row)}`);
    this.attach(`server: ${JSON.stringify(found)}\nrow: ${JSON.stringify(row)}`, 'text/plain');
    fail(problems, 'The changed address is not the live one on Invite Sent:');
    // Every later step is about the agent at its new address.
    this._emailSubject = { ...subject(this), email: fresh };
    this._agent = this._emailSubject;
  });

Then('the agent should no longer be listed at the original address', { timeout: 120000 }, async function () {
  const original = this._inviteOriginal.email.toLowerCase();
  const left = [];
  for (const tab of ['Invite Sent', 'Active']) {
    await surface(this).goto(tab);
    const result = await surface(this).search(original);
    const rows = AgentsListingPage.agentsFrom(result.payload).filter((r) => String(r.email).toLowerCase() === original);
    if (rows.length) left.push(`${tab}: ${JSON.stringify(rows)}`);
  }
  expect(left, `${original} is still listed`).toEqual([]);
});

Then("the row's Edit action should be disabled while the re-invite cooldown runs", { timeout: 60000 }, async function () {
  const w = changeWrite(this);
  let until = null;
  try { until = JSON.parse(w.body).reinvite_disabled_until; } catch (e) { /* reported below */ }
  expect(until, `the server's answer carries no reinvite_disabled_until: ${w && w.body}`).toBeTruthy();
  const remaining = Date.parse(until) - Date.now();
  expect(remaining, `the cooldown already ended (${until}), so it cannot be observed`).toBeGreaterThan(5000);
  await surface(this).goto('Invite Sent');
  await surface(this).search(this._inviteNew.email);
  const actions = await surface(this).readInviteRowActions(this._inviteNew.email);
  this.attach(`cooldown until ${until} (${Math.round(remaining / 1000)}s left): ${JSON.stringify(actions)}`, 'text/plain');
  expect(actions.edit, `Edit is enabled during the cooldown: ${JSON.stringify(actions)}`).toBe(false);
});

Then('an invitation email should be delivered to the new address', { timeout: 300000 }, async function () {
  const { email, baseline } = this._inviteNew;
  const mail = await waitForInviteMail(email, { afterUid: baseline, timeoutMs: 240000 });
  this._inviteNewMail = mail;
  const problems = [];
  if (!String(mail.to).toLowerCase().includes(email)) problems.push(`the mail is addressed to ${mail.to}`);
  if (mail.subject !== 'Join Talentforge') problems.push(`subject is "${mail.subject}"`);
  if (!mail.tempPassword) problems.push('it carries no temporary password');
  if (!mail.hasSignInCta) problems.push('it carries no "Go to Agent Portal" link');
  this.attach(`uid ${mail.uid}, to ${mail.to}, subject "${mail.subject}", temporary password present=${!!mail.tempPassword}`, 'text/plain');
  fail(problems, `The new invitation to ${email} is not a usable invitation:`);
});

// "Any previous invite links sent to the old email address will no longer work." The agent invite
// carries a temporary password rather than a link, so "works" means "signs in".
Then('the original invitation should no longer sign in', { timeout: 300000 }, async function () {
  const { email, baseline } = this._inviteOriginal;
  const original = await waitForInviteMail(email, { afterUid: baseline, timeoutMs: 180000 });
  expect(original.tempPassword, 'the original invitation carried no temporary password').toBeTruthy();
  if (this._inviteNewMail) {
    expect(original.tempPassword, 'the new invitation re-used the old temporary password').not.toBe(this._inviteNewMail.tempPassword);
  }
  const atOld = await signInAttempt(this.browser, email, original.tempPassword);
  const atNew = await signInAttempt(this.browser, this._inviteNew.email, original.tempPassword);
  this.attach(`old address + old password: ${JSON.stringify(atOld)}\nnew address + old password: ${JSON.stringify(atNew)}`, 'text/plain');
  const problems = [];
  if (atOld.status !== 401 || !/\/login/.test(atOld.url)) problems.push(`the old address still signs in with the old password: ${JSON.stringify(atOld)}`);
  if (atNew.status !== 401 || !/\/login/.test(atNew.url)) problems.push(`the new address signs in with the OLD password: ${JSON.stringify(atNew)}`);
  fail(problems, 'The superseded invitation still works:');
});

Then('the new invitation should sign in and ask the agent to set a password', { timeout: 120000 }, async function () {
  const mail = this._inviteNewMail;
  expect(mail, 'the new invitation has not been read yet').toBeTruthy();
  const result = await signInAttempt(this.browser, this._inviteNew.email, mail.tempPassword);
  this.attach(`new address + new password: ${JSON.stringify(result)}`, 'text/plain');
  expect(result.status, `signing in with the new invitation answered ${result.status}`).toBe(200);
  expect(result.url, 'the new invitation did not lead to Set Password').toMatch(/\/set-password/);
});

Then('no other invitation request should have been made after the change', async function () {
  const extra = (this._resendWrites || []).filter((w) => !/\/agent\/\d+\/update-email\/$/.test(w.path));
  expect(extra, 'Resend Invite made a SECOND invitation request after the change, which the cooldown the '
    + 'change itself just set refuses. Were the cooldown absent, the agent would be sent two invitations:\n'
    + showWrites(extra)).toEqual([]);
});

// Each row: Next -> Resend Invite -> the server refuses -> its message as a toast. Asserted as the
// build behaves today (both dialogs close, nothing inline), on a throwaway agent only.
Then('each of these addresses should be refused when the invitation is resent, with its toast:', { timeout: 420000 },
  async function (table) {
    recordWrites(this);
    const page = surface(this);
    const record = subject(this);
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const addr = resolveAddress(this, row['new email']);
      const label = `${row['new email']} (${addr})`;
      await openFormFor(this);
      await page.fillNewEmail(addr, addr);
      const n = await page.pressEmailNext();
      if (!n.resendOpen) {
        problems.push(`${label}: Next did not reach Resend Invitation (form errors ${JSON.stringify((n.form || {}).errors)})`);
        await closeEverything(this);
        continue;
      }
      const mark = this._emailWrites.length;
      const r = await page.confirmResendCapturing();
      const ws = await writesSince(this, mark);
      const patch = ws.find((w) => /\/update-email\/$/.test(w.path));
      if (!patch) problems.push(`${label}: no update-email request was made:\n${showWrites(ws)}`);
      else if (patch.status < 400) problems.push(`${label}: the server ACCEPTED it (${patch.status} ${patch.body})`);
      if (!r.toasts.includes(row.toast)) problems.push(`${label}: expected the toast "${row.toast}", got ${JSON.stringify(r.toasts)}`);
      if (r.resendOpen || r.formOpen) problems.push(`${label}: a dialog stayed open (resend=${r.resendOpen}, form=${r.formOpen})`);
      report.push(`${label}: ${patch ? `${patch.status} ${patch.body}` : 'no request'} | toasts ${JSON.stringify(r.toasts)} | dialogs closed=${!r.resendOpen && !r.formOpen}`);
      await closeEverything(this);
      const found = await serverRecord(this, record.email);
      if (!found || found.pendingEmail) problems.push(`${label}: the agent changed - ${JSON.stringify(found)}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'An unusable address was not refused as measured:');
  });

// Records what was created and closes the isolated verification context. It never throws: a
// cleanup error masking the scenario's own failure would be worse than the leak it reports.
After({ tags: '@edit-email' }, async function () {
  if (this._emailVerifyContext) {
    await this._emailVerifyContext.close().catch(() => {});
    this._emailVerifyContext = null;
  }
  if (this._emailThrowaways && this._emailThrowaways.length) {
    this.attach(
      'Throwaway agents this scenario created and ABANDONED (there is no way to delete an '
      + 'agent, and deactivating one would send a live email):\n'
      + this._emailThrowaways.map((a) => `  ${a.name} <${a.email}>`).join('\n')
      + (this._emailPendingAddress ? `\nFinal address in force: ${this._emailPendingAddress}` : ''),
      'text/plain'
    );
  }
});

module.exports = { PROFILE_CANDIDATES };
