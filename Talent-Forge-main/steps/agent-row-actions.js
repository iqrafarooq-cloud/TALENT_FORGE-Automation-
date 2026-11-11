const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');

// Step definitions for
// features/SuperAdmin_Portal/UserManagement/Agent-Row-Actions.feature - the row actions of the
// SuperAdmin Agents listing that had no behavioural coverage of their own: "Log in as agent"
// (Active tab menu and the profile overflow), every way out of the Notify and Resend Invitation
// dialogs, and the re-invite cooldown on an Invite Sent row. Measured 2026-10-22 with
// scripts/probe-agent-login-as.js, scripts/probe-agent-row-dialogs.js and
// scripts/probe-agent-row-actions-2.js. The page-object half is the "Log in as agent" section of
// pages/AgentsListingPage.js, whose header records the whole flow.
//
// Steps owned elsewhere and reused here (redefining any would be an ambiguous step):
//   agent.js        - the Agents listing Givens, "I have noted the first agent on the ... tab"
//   invite-agent.js - "I am logged in as the superadmin", "I have just invited an agent
//                     successfully", "I click {string} for the invited agent", the toast step
//
// TWO RULES THIS FILE FOLLOWS.
// 1. "Starts nothing" and "sends nothing" are ABSENCES, so they are asserted against a running
//    log of every non-GET API request, started before the action. "No session started" cannot be
//    read off the screen: the dialog closing looks the same whether or not a request went out.
// 2. Credentials never reach the report. The verify step returns a verification token and the
//    start step an access token; only whether one was present is ever recorded.

const listing = (world) => world.pages.agentsListing;

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

function subject(world) {
  if (!world._agent || !world._agent.email) {
    throw new Error('No agent has been noted - a Given that notes or provisions one has to run first.');
  }
  return world._agent;
}

// Every non-GET API request from the moment this is first called. Idempotent per scenario.
function recordWrites(world) {
  if (world._rowWrites) return world._rowWrites;
  world._rowWrites = [];
  world.page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/v\d+\//.test(r.url())) {
      world._rowWrites.push({ method: r.method(), path: new URL(r.url()).pathname });
    }
  });
  return world._rowWrites;
}

const writesSince = (world, mark) => recordWrites(world).slice(mark);
const showWrites = (ws) => (ws.length ? ws.map((w) => `${w.method} ${w.path}`).join(', ') : 'none');
const sessionStarts = (world) => recordWrites(world).filter((w) => /\/impersonation\/agents\/\d+\/start\/?$/.test(w.path));

// ==================== Subjects ====================

// The real session is started on an agent of its own, never on a shared fixture: an
// impersonation session writes audit rows and activity against whoever it is started on. The
// agent is abandoned afterwards - an agent cannot be deleted.
Given('I have provisioned a throwaway agent to log in as', { timeout: 600000 }, async function () {
  const agent = await provisionAgentWithoutPromo(this.browser, {
    label: 'agent-login-as-throwaway',
    firstName: 'Loginas',
    tagPrefix: 'loginas',
  });
  this._agent = { name: agent.name, email: agent.email, university: agent.university || '', candidates: 0, progress: null, cells: [] };
  this.attach(`Provisioned throwaway agent ${agent.name} <${agent.email}> - abandoned after the scenario.`, 'text/plain');
  await listing(this).goto('Active');
  await listing(this).waitForAgentOnTab('Active', { name: agent.name, email: agent.email });
});

// ==================== Log in as agent: Verify your identity ====================

When('I choose "Log in as agent" for that agent', { timeout: 120000 }, async function () {
  const agent = subject(this);
  recordWrites(this);
  await listing(this).goto('Active');
  await listing(this).search(agent.name);
  await listing(this).openLoginAsDialog(agent.email);
  this._identity = await listing(this).readIdentityDialog();
  this.attach(`Verify your identity for ${agent.email}: ${JSON.stringify(this._identity)}`, 'text/plain');
});

Then('the Verify your identity dialog should name that agent', async function () {
  const agent = subject(this);
  const d = this._identity;
  expect(d, 'the Verify your identity dialog did not open').toBeTruthy();
  const problems = [];
  if (d.heading !== 'Verify your identity') problems.push(`the heading reads "${d.heading}"`);
  // The app writes a curly apostrophe; compare on the wording, not the glyph.
  const text = d.text.replace(/[‘’]/g, "'");
  if (!text.includes(`Confirm it's you before accessing ${agent.name}'s account`)) {
    problems.push(`it does not say whose account is about to be opened: "${d.text}"`);
  }
  const offered = d.buttons.map((b) => b.toLowerCase());
  for (const b of ['cancel', 'confirm']) if (!offered.includes(b)) problems.push(`it offers no "${b}" (${JSON.stringify(d.buttons)})`);
  fail(problems, 'The Verify your identity dialog does not ask the right question:');
});

Then('the identity password field should be masked and read {string}', async function (placeholder) {
  const d = this._identity;
  expect(d && d.input, 'the dialog has no password field').toBeTruthy();
  expect(d.input.type, 'the password is typed in the clear').toBe('password');
  expect(d.input.placeholder).toBe(placeholder);
  expect(d.input.value, 'the field opens holding a value').toBe('');
});

// Spaces are recorded rather than asserted: a password can legitimately contain spaces, and
// proving how the server treats an all-space one would cost a failed sign-in against the
// superadmin account, which is rate limited.
Then('Confirm should be disabled until a password is typed', { timeout: 60000 }, async function () {
  const page = listing(this);
  const problems = [];
  let d = await page.readIdentityDialog();
  if (d.confirmDisabled !== true) problems.push('Confirm is enabled on an empty field');
  await page.typeIdentityPassword('x');
  d = await page.readIdentityDialog();
  if (d.confirmDisabled !== false) problems.push('Confirm stays disabled with a password typed');
  await page.typeIdentityPassword('   ');
  const spaces = (await page.readIdentityDialog()).confirmDisabled;
  await page.typeIdentityPassword('');
  d = await page.readIdentityDialog();
  if (d.confirmDisabled !== true) problems.push('Confirm stays enabled after the password is cleared');
  this.attach(`Recorded, not asserted: with only spaces typed Confirm is ${spaces ? 'disabled' : 'ENABLED'}.`, 'text/plain');
  fail(problems, 'Confirm is not gated on the password:');
});

Then('no impersonation request should have been made', async function () {
  const made = recordWrites(this).filter((w) => /\/impersonation\//.test(w.path));
  expect(made, `impersonation requests were made: ${showWrites(made)}`).toEqual([]);
});

When('I type {string} as the identity password', async function (value) {
  await listing(this).typeIdentityPassword(value);
});

Then('toggling the password visibility should show it and then mask it again', async function () {
  const shown = await listing(this).togglePasswordVisibility();
  const hidden = await listing(this).togglePasswordVisibility();
  const problems = [];
  if (shown.type !== 'text') problems.push(`after "Show password" the field is type=${shown.type}`);
  if (!/^hide password$/i.test(shown.label || '')) problems.push(`the shown state's toggle is labelled "${shown.label}"`);
  if (hidden.type !== 'password') problems.push(`after "Hide password" the field is type=${hidden.type}`);
  if (!/^show password$/i.test(hidden.label || '')) problems.push(`the masked state's toggle is labelled "${hidden.label}"`);
  fail(problems, 'The password visibility toggle does not round-trip:');
});

Then('leaving the Verify your identity dialog each way should start nothing and clear the password:',
  { timeout: 400000 }, async function (table) {
    const agent = subject(this);
    const page = listing(this);
    recordWrites(this);
    const problems = [];
    await page.goto('Active');
    await page.search(agent.name);
    for (const { 'way out': how } of table.hashes()) {
      await page.openLoginAsDialog(agent.email);
      await page.typeIdentityPassword('typed-before-leaving');
      const mark = recordWrites(this).length;
      const err = await page.leaveDialog(page.identityDialog, how);
      if (err) problems.push(`${how}: ${err}`);
      await this.page.waitForTimeout(800);
      if (await page.identityDialog.isVisible().catch(() => false)) {
        problems.push(`${how}: the dialog is still open`);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }
      const ws = writesSince(this, mark);
      if (ws.length) problems.push(`${how}: requests were sent - ${showWrites(ws)}`);
      await page.openLoginAsDialog(agent.email);
      const reopened = await page.readIdentityDialog();
      if (reopened.input.value) problems.push(`${how}: reopening shows the password typed before leaving`);
      await page.leaveDialog(page.identityDialog, 'Escape');
    }
    if (!(await page.isOnListing())) problems.push(`the superadmin left the Agents listing: ${this.page.url()}`);
    fail(problems, 'The Verify your identity dialog cannot be left cleanly every way:');
  });

// Requires Attention has no row menu, so its only route to Log in as agent is the profile.
Then('the profile overflow "Log in as agent" should open the Verify your identity dialog from each of these tabs:',
  { timeout: 400000 }, async function (table) {
    const page = listing(this);
    recordWrites(this);
    const problems = [];
    const report = [];
    for (const { tab } of table.hashes()) {
      await page.runAndWaitForList(async () => { await page.goto(tab); });
      const rows = (await page.readRows()).filter((r) => r.email);
      if (!rows.length) { problems.push(`"${tab}" lists no agent, so the route could not be checked`); continue; }
      const agent = rows[0];
      await page.openAgentProfile(agent.email);
      await this.page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
      const menu = this.page.locator('[role="menu"]').first();
      await menu.waitFor({ state: 'visible', timeout: 15000 });
      const item = menu.locator('[role^="menuitem"]').filter({ hasText: /^\s*log in as agent\s*$/i }).first();
      if (!(await item.count())) {
        problems.push(`"${tab}" ${agent.email}: the profile menu offers no "Log in as agent"`);
        await this.page.keyboard.press('Escape');
        continue;
      }
      const mark = recordWrites(this).length;
      await item.click();
      await page.identityDialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      const d = await page.readIdentityDialog();
      if (!d) problems.push(`"${tab}" ${agent.email}: "Log in as agent" opened no Verify your identity dialog`);
      else if (!d.text.includes(agent.name)) problems.push(`"${tab}" ${agent.email}: the dialog names someone else: "${d.text}"`);
      if (d) await page.leaveDialog(page.identityDialog, 'Cancel');
      const ws = writesSince(this, mark);
      if (ws.length) problems.push(`"${tab}": opening and cancelling sent ${showWrites(ws)}`);
      report.push(`${tab}: ${agent.email} -> ${d ? d.heading : 'no dialog'}`);
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, 'Log in as agent is not reachable from every profile that offers it:');
  });

// ==================== Log in as agent: verify, reason, review ====================

When('I confirm my identity with my own password', { timeout: 60000 }, async function () {
  await listing(this).typeIdentityPassword(process.env.SUPERADMIN_PASSWORD);
  this._verify = await listing(this).confirmIdentity();
  this.attach(`verify -> ${JSON.stringify(this._verify)}`, 'text/plain');
});

// ONE wrong attempt. Failed checks against the superadmin are rate limited - never loop this.
When('I confirm my identity with a wrong password', { timeout: 60000 }, async function () {
  await listing(this).typeIdentityPassword('Not-The-Superadmin-Password-1!');
  this._verify = await listing(this).confirmIdentity();
  this._identity = await listing(this).readIdentityDialog();
  this.attach(`verify -> ${JSON.stringify(this._verify)}; dialog ${JSON.stringify(this._identity)}`, 'text/plain');
});

Then('the identity should have been verified without starting a session', async function () {
  const v = this._verify;
  expect(v && v.status, `the verify request answered ${JSON.stringify(v)}`).toBe(200);
  expect(v.hasToken, 'the verify answer carries no verification token').toBe(true);
  expect(sessionStarts(this), 'a session was started by the identity check alone').toEqual([]);
  expect(await listing(this).identityDialog.isVisible().catch(() => false), 'the identity dialog is still open').toBe(false);
});

Then('the identity check should be refused with {string}', async function (message) {
  const v = this._verify;
  const d = this._identity;
  const problems = [];
  if (!v || v.status !== 401) problems.push(`the verify request answered ${JSON.stringify(v)}, not 401`);
  if (v && v.hasToken) problems.push('a verification token was issued for a wrong password');
  if (!d) problems.push('the dialog closed, so the refusal is shown nowhere');
  else if (!d.errors.includes(message)) problems.push(`the dialog shows ${JSON.stringify(d.errors)}, not "${message}"`);
  fail(problems, 'A wrong password is not refused as measured:');
});

Then('the Verify your identity dialog should still be open', async function () {
  expect(await listing(this).identityDialog.isVisible().catch(() => false)).toBe(true);
});

Then('no impersonation session should have been started', async function () {
  expect(sessionStarts(this), `a session was started: ${showWrites(sessionStarts(this))}`).toEqual([]);
  const banner = await listing(this).readImpersonationBanner();
  expect(banner, `an impersonation banner is showing: ${JSON.stringify(banner)}`).toBeNull();
});

Then('the Reason for access step should read {string}', async function (line) {
  const s = await listing(this).readAccessStep();
  expect(s, 'no Reason for access step is open').toBeTruthy();
  expect(s.heading).toBe('Reason for access');
  expect(s.text, `the step reads: ${s.text}`).toContain(line);
  this._access = s;
});

Then('the Reason for access step should offer exactly these reasons:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const s = this._access || await listing(this).readAccessStep();
  expect(s.reasonOptions, 'the reasons offered').toEqual(expected);
});

Then('Next should be disabled until a reason is chosen', async function () {
  const s = await listing(this).readAccessStep();
  expect(s.reasonValue, `a reason is preselected: ${s.reasonLabel}`).toBe('');
  expect(s.nextDisabled, 'Next is enabled with no reason chosen').toBe(true);
});

When('I choose the access reason {string}', { timeout: 60000 }, async function (label) {
  await listing(this).chooseAccessReason(label);
  this._access = await listing(this).readAccessStep();
  expect(this._access.reasonLabel, 'the reason did not stick').toBe(label);
});

Then('a required "Please specify reason" field should appear and keep Next disabled for:', { timeout: 60000 },
  async function (table) {
    const s = await listing(this).readAccessStep();
    expect(s.otherField, '"Other" did not reveal a field to specify the reason').toBeTruthy();
    expect(s.text, 'the field is not labelled').toContain('Please specify reason');
    const problems = [];
    for (const [raw] of table.raw()) {
      const value = raw === '<empty>' ? '' : raw === '<spaces>' ? '   ' : raw;
      await listing(this).typeOtherReason(value);
      const now = await listing(this).readAccessStep();
      if (now.nextDisabled !== true) problems.push(`Next is enabled with the reason ${JSON.stringify(value)}`);
    }
    fail(problems, 'An unspecified "Other" reason is accepted:');
  });

When('I specify the other reason {string}', async function (text) {
  this._otherReason = text;
  await listing(this).typeOtherReason(text);
});

Then('Next should be enabled', async function () {
  const s = await listing(this).readAccessStep();
  expect(s.nextDisabled, `Next is disabled: ${JSON.stringify(s)}`).toBe(false);
});

When('I press {string} on the access step', { timeout: 60000 }, async function (label) {
  await listing(this).pressAccessStep(label);
  this._access = await listing(this).readAccessStep();
  this.attach(`after "${label}": ${JSON.stringify(this._access)}`, 'text/plain');
});

Then('the review step should name that agent and the reason {string}', async function (reason) {
  const agent = subject(this);
  const s = this._access;
  expect(s && s.heading, `the review step did not open: ${JSON.stringify(s)}`).toBe('Before you start');
  const text = s.text.replace(/[‘’]/g, "'");
  const problems = [];
  if (!text.includes(`log in as ${agent.name}`)) problems.push(`it does not name ${agent.name}: "${s.text}"`);
  if (!text.includes(reason)) problems.push(`it does not state the reason "${reason}": "${s.text}"`);
  if (s.startDisabled !== false) problems.push('Start session is not available');
  fail(problems, 'The review step does not say what is about to happen:');
});

Then('the review step should say the session ends after 30 minutes or 15 minutes of inactivity', async function () {
  expect(this._access.text).toContain('The session will end automatically after 30 minutes, or after 15 minutes of inactivity.');
});

Then('the access step should still hold the reason {string} with {string}', async function (label, other) {
  const s = this._access;
  expect(s && s.heading).toBe('Reason for access');
  expect(s.reasonLabel, 'Back dropped the chosen reason').toBe(label);
  expect(s.otherField && s.otherField.value, 'Back dropped the specified reason').toBe(other);
});

Then('I should still be on the Agents listing as the superadmin', async function () {
  expect(await listing(this).accessStepDialog.isVisible().catch(() => false), 'the access step is still open').toBe(false);
  expect(await listing(this).isOnListing(), `the superadmin left the listing: ${this.page.url()}`).toBe(true);
});

// ==================== Log in as agent: the session ====================

When('I start the impersonation session', { timeout: 90000 }, async function () {
  this._session = await listing(this).startImpersonation();
  this.attach(`start -> ${JSON.stringify(this._session)}`, 'text/plain');
  expect(this._session.status, 'the session start request did not succeed').toBe(201);
  expect(this._session.sessionId, 'the start answer names no session').toBeTruthy();
});

Then("I should be on that agent's dashboard with a banner naming them", { timeout: 60000 }, async function () {
  const agent = subject(this);
  const problems = [];
  if (!/\/dashboard/.test(this.page.url())) problems.push(`the session landed on ${this.page.url()}`);
  const banner = await listing(this).readImpersonationBanner();
  this._banner = banner;
  this.attach(`banner: ${JSON.stringify(banner)}`, 'text/plain');
  if (!banner) problems.push('no impersonation banner is shown');
  else if (banner.loggedInAs !== agent.name) problems.push(`the banner names "${banner.loggedInAs}", not ${agent.name}: "${banner.text}"`);
  fail(problems, 'The superadmin is not clearly working as that agent:');
});

Then('the banner should count down from at most 30 minutes', { timeout: 30000 }, async function () {
  const first = this._banner;
  expect(first && first.remainingSeconds, `the banner shows no time remaining: ${JSON.stringify(first)}`).toBeTruthy();
  // The countdown is the server's expiry minus the BROWSER's clock, so a client clock running
  // behind the server shows a little over 30:00 - measured 2026-10-22: this machine ~1s behind
  // dev-api, banner read 30:01. A few seconds of skew is the environment; a longer session is not.
  const SKEW_S = 5;
  this.attach(`banner started at ${first.remainingSeconds}s remaining (limit 1800s, ${SKEW_S}s clock-skew tolerance)`, 'text/plain');
  expect(first.remainingSeconds, `the session is offered for more than 30 minutes: ${first.text}`)
    .toBeLessThanOrEqual(30 * 60 + SKEW_S);
  await this.page.waitForTimeout(3000);
  const later = await listing(this).readImpersonationBanner();
  expect(later.remainingSeconds, `the countdown did not move: ${first.text} -> ${later.text}`).toBeLessThan(first.remainingSeconds);
});

When('I end the impersonation session', { timeout: 60000 }, async function () {
  this._ended = await listing(this).endImpersonation();
  this.attach(`end -> ${JSON.stringify(this._ended)}`, 'text/plain');
});

Then('a "Session Ended" confirmation should name that agent and offer "Back to Agent Profile"', async function () {
  const agent = subject(this);
  const e = this._ended;
  const problems = [];
  if (e.status !== 200) problems.push(`the end request answered ${e.status}`);
  if (e.body.state !== 'ended' || e.body.trigger !== 'MANUAL') problems.push(`the server reports ${JSON.stringify(e.body)}`);
  if (!e.endedText.includes(`You ended the session with ${agent.name}`)) problems.push(`the dialog reads "${e.endedText}"`);
  if (JSON.stringify(e.endedButtons) !== JSON.stringify(['Back to Agent Profile'])) problems.push(`it offers ${JSON.stringify(e.endedButtons)}`);
  fail(problems, 'Ending the session is not confirmed as measured:');
});

When('I go back to the agent profile', { timeout: 60000 }, async function () {
  await listing(this).backToAgentProfileAfterSession();
});

Then("I should be on that agent's profile as the superadmin", { timeout: 60000 }, async function () {
  const agent = subject(this);
  const header = await this.pages.agentProfile.readHeader();
  const problems = [];
  if (!/\/agents\/view\/\d+/.test(this.page.url())) problems.push(`landed on ${this.page.url()}`);
  if (!JSON.stringify(header).includes(agent.email)) problems.push(`the profile is not ${agent.email}'s: ${JSON.stringify(header)}`);
  if (await listing(this).readImpersonationBanner()) problems.push('the impersonation banner is still showing');
  const sidebar = await this.page.getByText('User Management', { exact: true }).first().isVisible().catch(() => false);
  if (!sidebar) problems.push('the superadmin navigation is not back');
  fail(problems, 'The superadmin did not get their own session back:');
});

Then('the audit trail should record logging in as that agent for {string} and logging out of the same session',
  { timeout: 120000 }, async function (reason) {
    const agent = subject(this);
    const sessionId = this._session.sessionId;
    const audit = this.pages.auditLogs;
    let rows = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await audit.navigate();
      await audit.search(agent.name);
      rows = (await audit.readRows()).filter((r) => r.entityName === agent.name);
      if (rows.some((r) => /logged out as agent/i.test(r.actionType))) break;
      await this.page.waitForTimeout(5000);
    }
    const loggedIn = rows.find((r) => /logged in as agent/i.test(r.actionType));
    const loggedOut = rows.find((r) => /logged out as agent/i.test(r.actionType));
    this.attach(rows.map((r) => `${r.dateTime} | ${r.actionBy} | ${r.actionType} | ${r.entityName} | ${r.eventDetails}`).join('\n'), 'text/plain');
    const problems = [];
    if (!loggedIn) problems.push('no "Logged In As Agent" entry for that agent');
    else if (!loggedIn.eventDetails.includes(`Reason: ${reason}`)) problems.push(`the log-in entry reads "${loggedIn.eventDetails}"`);
    if (!loggedOut) problems.push('no "Logged Out As Agent" entry for that agent');
    else {
      if (!loggedOut.eventDetails.includes('Reason: MANUAL')) problems.push(`the log-out entry reads "${loggedOut.eventDetails}"`);
      if (!loggedOut.eventDetails.includes(sessionId)) problems.push(`the log-out entry does not name session ${sessionId}: "${loggedOut.eventDetails}"`);
    }
    for (const r of [loggedIn, loggedOut].filter(Boolean)) {
      if (r.actionByEmail && r.actionByEmail.toLowerCase() !== String(process.env.SUPERADMIN_EMAIL).toLowerCase()) {
        problems.push(`"${r.actionType}" is attributed to ${r.actionByEmail}`);
      }
    }
    fail(problems, 'The audit trail does not record the impersonation:');
  });

// ==================== Notify / Resend Invitation: every way out ====================

const ROW_DIALOGS = {
  'Send Reminder': { action: 'Notify', dialog: (page) => page.notifyDialog },
  'Resend Invitation': { action: 'Resend Invite', dialog: (page) => page.resendDialog },
};

Then('leaving the {string} dialog each way should send nothing:', { timeout: 400000 }, async function (name, table) {
  const spec = ROW_DIALOGS[name];
  if (!spec) throw new Error(`Unknown row dialog "${name}" - expected ${Object.keys(ROW_DIALOGS).join(' / ')}`);
  const agent = subject(this);
  const page = listing(this);
  recordWrites(this);
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    const how = row['way out'];
    const shouldClose = /^yes$/i.test(row.closes);
    await page.clickRowAction(agent.email, spec.action);
    const dialog = spec.dialog(page);
    await dialog.waitFor({ state: 'visible', timeout: 20000 });
    const mark = recordWrites(this).length;
    const err = await page.leaveDialog(dialog, how);
    if (err) problems.push(`${how}: ${err}`);
    await this.page.waitForTimeout(1000);
    const open = await dialog.isVisible().catch(() => false);
    if (shouldClose && open) problems.push(`${how}: the dialog stayed open`);
    if (!shouldClose && !open) problems.push(`${how}: the dialog CLOSED - it stayed open when measured, so this changed`);
    const ws = writesSince(this, mark);
    if (ws.length) problems.push(`${how}: requests were sent - ${showWrites(ws)}`);
    report.push(`${how}: ${open ? 'still open' : 'closed'}, requests ${showWrites(ws)}`);
    if (open) await page.leaveDialog(dialog, 'Cancel');
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, `The "${name}" dialog cannot be left as measured:`);
});

// ==================== Resend Invite: the re-invite cooldown ====================

When('I confirm the resend and note its cooldown', { timeout: 60000 }, async function () {
  const response = this.page.waitForResponse(
    (r) => /\/admin\/invite\/resend\/agent\/?$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30000 },
  ).catch(() => null);
  await listing(this).resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
  const r = await response;
  let body = {};
  if (r) { try { body = await r.json(); } catch (e) { /* reported below */ } }
  this._resend = { status: r ? r.status() : null, until: body.reinvite_disabled_until || null, detail: body.detail || null };
  this.attach(`resend -> ${JSON.stringify(this._resend)}`, 'text/plain');
  expect(this._resend.status, `the resend answered ${JSON.stringify(this._resend)}`).toBe(200);
  expect(this._resend.until, 'the resend answer carries no reinvite_disabled_until').toBeTruthy();
});

async function invitedRowActions(world) {
  const identity = world._invited;
  if (!identity || !identity.email) throw new Error('No agent has been invited in this scenario.');
  await listing(world).goto('Invite Sent');
  await listing(world).search(identity.lastName);
  return listing(world).readInviteRowActions(identity.email);
}

Then("the invited agent's Edit and Resend Invite should be disabled while the cooldown runs", { timeout: 90000 },
  async function () {
    const remaining = Date.parse(this._resend.until) - Date.now();
    expect(remaining, `the cooldown already ended (${this._resend.until}), so it cannot be observed`).toBeGreaterThan(10000);
    const actions = await invitedRowActions(this);
    this.attach(`${Math.round(remaining / 1000)}s of cooldown left: ${JSON.stringify(actions)}`, 'text/plain');
    expect(actions, 'the row offers the wrong actions during the cooldown').toEqual({ edit: false, resend: false });
  });

Then("the invited agent's Edit and Resend Invite should be enabled again once the cooldown ends", { timeout: 300000 },
  async function () {
    const wait = Date.parse(this._resend.until) - Date.now() + 5000;
    if (wait > 0) await this.page.waitForTimeout(wait);
    const actions = await invitedRowActions(this);
    this.attach(`after the cooldown (${this._resend.until}): ${JSON.stringify(actions)}`, 'text/plain');
    expect(actions, 'the row is still locked after its cooldown ended').toEqual({ edit: true, resend: true });
  });
