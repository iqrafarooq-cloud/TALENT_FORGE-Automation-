// agentInviteProvision.js — everything the @provision invite scenarios need in order to
// work with a REAL, brand-new agent account instead of a shared one.
//
// Why a fresh account per run: the states under test cannot be re-created on an existing
// agent. "Invite Sent" only exists before the very first login, and that login is
// one-way — once an agent has authenticated it can never be pending again, and DEV has no
// delete. So every lifecycle scenario signs up its own agent over live email.
//
// Cost of that, stated plainly:
//   * each @provision scenario permanently adds one agent row to DEV
//   * it needs the network and the IMAP inbox reachable
//   * cleanup can only DEACTIVATE (see deactivateProvisionedAgents) — an agent that never
//     accepted stays on the Invite Sent tab, because that tab offers no deactivate action
//
// MUST RUN SERIALLY, for the same reason as the candidate provisioning: every invitation
// mail lands in the SAME inbox, and messages are told apart only by a UID baseline taken
// immediately before the invite is submitted. Two concurrent invites can each pick up the
// other's temporary password. `cucumber.js` therefore keeps @provision out of the
// parallel profile.
require('dotenv').config();
const { latestUid, waitForEmail } = require('./gmailClient');

// The mailbox every invited agent's address is tagged off. GMAIL_USER is the inbox the
// suite reads, so the +tag has to hang off that same address to be deliverable AND
// readable.
const INBOX = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
const TAG_PREFIX = process.env.INVITE_AGENT_TAG_PREFIX || 'ia';
// The password every provisioned agent is moved to once it accepts. Fixed rather than
// random so a mid-scenario failure always leaves the account on a KNOWN password.
//
// No literal fallback on purpose: a default password committed to source is a credential in
// the repo, and it silently diverges from .env the moment either one changes. Failing loudly
// here beats a run that sets a password nobody can look up.
const NEW_PASSWORD = process.env.INVITE_AGENT_NEW_PASSWORD;
if (!NEW_PASSWORD) {
  throw new Error(
    'Missing INVITE_AGENT_NEW_PASSWORD in .env — the @provision invite scenarios move every '
    + 'agent they create onto this password when it accepts the invite.'
  );
}

// A unique-per-invite identity. The name has to be DISTINCTIVE, not just unique: the
// listing's only search box matches on agent NAME (a logged defect, TFF-532, confirms it
// ignores email), and DEV already holds 17 pages of agents called "Iqra Farooq". A
// generated surname keeps every lookup down to a single row.
//
// `seq` disambiguates two invites inside the same millisecond-poor clock tick.
let seq = 0;
function freshAgentIdentity({ firstName = 'Zayd', prefix = TAG_PREFIX } = {}) {
  seq += 1;
  const stamp = `${Date.now().toString(36)}${seq}`;
  const [local, domain] = INBOX.split('@');
  const tag = `${prefix}${stamp}`;
  return {
    firstName,
    // Letters only — the form strips digits from the name fields as they are typed, so a
    // numeric stamp in the surname would be silently dropped and every row would read
    // the same. base36 digits are mapped onto letters instead.
    lastName: `Qa${digitsToLetters(stamp)}`,
    email: `${local}+${tag}@${domain}`,
    tag,
    newPassword: NEW_PASSWORD,
  };
}

// 0-9 -> a-j, so a base36 stamp survives the name field's letters-only filter.
function digitsToLetters(s) {
  return String(s).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
}

// Baseline the inbox BEFORE the invite is submitted, so the wait below can only ever
// return a strictly newer message.
async function baselineInviteMail(email) {
  return latestUid({ subject: 'Join Talentforge', to: email }).catch(() => 0);
}

// Wait for the invitation mail and pull the temporary password out of it.
async function waitForInviteMail(email, { afterUid = 0, timeoutMs = 180000 } = {}) {
  const result = await waitForEmail('agentInvite', {
    to: email,
    afterUid,
    timeoutMs,
    pollMs: 6000,
  });
  const parsed = result.parsed || {};
  const body = `${parsed.text || ''}\n${parsed.html || ''}`;
  return {
    uid: result.uid,
    // gmailClient calls the extractor's output `link`; for this type it is the password.
    tempPassword: result.link,
    from: (parsed.from && parsed.from.text) || '',
    to: (parsed.to && parsed.to.text) || '',
    subject: parsed.subject || '',
    // The CTA is a SendGrid click wrapper around the login page — its presence is the
    // assertable part, not its target.
    hasSignInCta: /go to agent portal/i.test(body),
    body,
  };
}

// Log an invited agent in on its OWN browser context.
//
// A separate context is mandatory: the app keeps one session per context, so reusing the
// superadmin's would log the superadmin out mid-scenario and every later listing
// assertion would bounce to /login.
//
// Returns { context, page, landedOn } — the caller owns the context and must close it
// (the invite-agent After hook does).
async function signInAsAgent(world, { email, password }) {
  const LoginPage = require('../pages/LoginPage');
  const video = require('./videoRecorder');
  const context = await world.browser.newContext(video.contextOptions());
  const page = video.track(world, await context.newPage(), 'agent');
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  // Three possible landings: the forced set-password screen (first login), the agent
  // dashboard (already onboarded), or back on /login (bad credentials).
  await page
    .waitForURL(/\/set-password|\/dashboard|\/verifications|\/activity-log/, {
      timeout: 90000,
      waitUntil: 'commit',
    })
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);
  return { context, page, landedOn: page.url() };
}

// Complete the forced first-login password reset.
//
// Verified live 2026-07-30: "Update Password" does NOT sign the agent in — it bounces
// back to /login, so the agent has to authenticate again with the new password. That is
// the real flow, so it is what this helper performs.
async function setPasswordAndSignIn(page, { email, password }) {
  const out = { setPasswordShown: /\/set-password/.test(page.url()) };
  if (!out.setPasswordShown) return out;

  await page.locator('input[name="newPassword"]').fill(password);
  await page.locator('input[name="confirmNewPassword"]').fill(password);
  await page.waitForTimeout(400);
  const update = page.getByRole('button', { name: /update password/i }).first();
  out.updateEnabled = await update.isEnabled();
  await update.click();
  await page.waitForURL(/\/login|\/dashboard/, { timeout: 60000, waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(2500);
  out.afterUpdate = page.url();

  if (/\/login/.test(page.url())) {
    const LoginPage = require('../pages/LoginPage');
    const login = new LoginPage(page);
    await login.emailInput.first().waitFor({ state: 'visible', timeout: 30000 });
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(password);
    await login.submitButton.first().click();
    await page
      .waitForURL(/\/dashboard|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' })
      .catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
  }
  out.landedOn = page.url();
  out.onDashboard = /\/dashboard/.test(page.url());
  return out;
}

// Best-effort cleanup: deactivate every agent this scenario provisioned so the DEV Active
// tab does not fill up run after run.
//
// Deliberately never throws — it runs from an After hook, where masking the scenario's own
// failure would be worse than a leftover agent. The caller reports what it could not do.
async function deactivateProvisionedAgents(listingPage, agents = []) {
  const report = [];
  for (const agent of agents) {
    if (!agent || !agent.email) continue;
    try {
      await listingPage.goto('Active');
      await listingPage.search(agent.lastName || agent.firstName);
      const rows = await listingPage.readRows();
      const hit = rows.find((r) => (r.email || '').toLowerCase() === agent.email.toLowerCase());
      if (!hit) {
        report.push(`${agent.email}: not on the Active tab (still pending — the Invite Sent tab has no deactivate action)`);
        continue;
      }
      await listingPage.deactivateAgent(agent.email);
      report.push(`${agent.email}: deactivated`);
    } catch (e) {
      report.push(`${agent.email}: deactivation failed (${String((e && e.message) || e).split('\n')[0]})`);
    }
  }
  return report;
}

module.exports = {
  INBOX,
  NEW_PASSWORD,
  freshAgentIdentity,
  baselineInviteMail,
  waitForInviteMail,
  signInAsAgent,
  setPasswordAndSignIn,
  deactivateProvisionedAgents,
};
