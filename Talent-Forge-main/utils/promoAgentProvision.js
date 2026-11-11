// promoAgentProvision.js — invite a brand-new agent WITH a promo code, accept the invite, and
// hand back an agent record in exactly the shape features/step_definitions/promo-lifecycle.steps.js
// builds from .env.
//
// WHY THIS IS A MODULE AND NOT JUST THE SCRIPT
// scripts/provision-promo-agents.js owned this flow, so the only way to get a promo agent was to
// run a script by hand and paste the result into .env. That is right for the three LONG-LIVED
// agents — their codes are app-generated and unrenameable, so they have to be recorded somewhere
// — but it cannot serve the usage-limit scenarios, which need an agent whose promo is DESTROYED
// by the test that uses it.
//
// Exhausting a promo is irreversible: `total_usage` is server-owned, there is no UI anywhere in
// the portal that resets it or removes a promo from an agent, and raising `usage_limit` afterwards
// would only paper over it. So an exhaustion test can never run twice against the same agent. The
// only honest way to automate it is to mint an agent that is EXPECTED to be consumed — one per
// run, never recorded in .env, never reused.
//
// Cost is real and deliberate: one live superadmin invite + one IMAP round trip for the invite
// mail + a set-password walk, before the scenario has asserted anything. That is why the scenarios
// using this carry @provision and @consumes-promo and stay out of the default run.
require('dotenv').config();
const LoginPage = require('../pages/LoginPage');
const InviteAgentPage = require('../pages/InviteAgentPage');
const {
  freshAgentIdentity,
  baselineInviteMail,
  waitForInviteMail,
} = require('./agentInviteProvision');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const UNIVERSITY = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';
const NEW_PASSWORD = process.env.INVITE_AGENT_NEW_PASSWORD;

// "Percentage Discount of 20" -> { type: 'Percentage Discount', value: 20 }
function parsePromoSpec(promo) {
  const m = String(promo).match(/^(percentage discount|fixed amount)\s+of\s+([\d.]+)$/i);
  if (!m) {
    throw new Error(
      `Unparseable promo spec "${promo}". Use "Percentage Discount of <n>" or "Fixed Amount of <n>".`
    );
  }
  return {
    type: /fixed/i.test(m[1]) ? 'Fixed Amount' : 'Percentage Discount',
    value: Number(m[2]),
  };
}

async function loginSuperadmin(page) {
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

// Invite one agent with a promo of the given usage limit, and read back the code the app
// generated for it. The code is only readable BEFORE submit — the success modal does not repeat
// it — so it is captured from the form.
async function inviteWithPromo(page, spec) {
  const identity = freshAgentIdentity({ firstName: spec.firstName, prefix: spec.tagPrefix });
  const invite = new InviteAgentPage(page);

  await invite.goto();
  await invite.fillValidDetails({
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    university: UNIVERSITY,
    target: '10',
  });
  // "unchecked" leaves the promo section closed — TFF-42 §2.3 allows an agent with no promo,
  // and that is the ONLY way to produce the Case 4 empty state, since no control anywhere in
  // the portal removes a promo from an agent once it exists.
  const withoutPromo = /^unchecked$/i.test(String(spec.promo));
  await invite.completePromoSection(spec.promo, {
    expiryOffsetDays: spec.expiryOffsetDays || 365,
    usageLimit: String(spec.usageLimit || ''),
  });
  const promoCode = withoutPromo ? null : await invite.promoCodeName();
  if (!withoutPromo && !promoCode) {
    throw new Error(`No promo code was generated on the invite form for ${identity.email}`);
  }
  if (!(await invite.isSubmitEnabled())) {
    throw new Error(
      `Send Invite stayed disabled for ${identity.email} — the form did not accept the details `
      + `(promo: ${spec.promo}${withoutPromo ? '' : `, usage limit ${spec.usageLimit}`}).`
    );
  }

  // Baseline the inbox immediately before submit so the wait below can only return THIS invite's
  // mail (every invite lands on the same mailbox — anonaddy strips the +alias).
  const baseline = await baselineInviteMail(identity.email);
  await invite.clickSubmit();
  await invite.waitForSuccessModal();

  return { identity, promoCode, baseline };
}

// Accept the invite on a context of its own, so the caller's sessions survive.
async function acceptInvite(browser, identity, baseline) {
  const mail = await waitForInviteMail(identity.email, { afterUid: baseline, timeoutMs: 240000 });
  if (!mail.tempPassword) {
    throw new Error(`No temporary password found in the invite mail for ${identity.email}`);
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(identity.email);
    await login.passwordInput.first().fill(mail.tempPassword);
    await login.submitButton.first().click();
    await page
      .waitForURL(/\/set-password|\/dashboard|\/verifications|\/activity-log/, {
        timeout: 90000,
        waitUntil: 'commit',
      })
      .catch(() => {});
    await page.waitForTimeout(2000);

    if (!/\/set-password/.test(page.url())) {
      throw new Error(
        `${identity.email} did not land on /set-password after signing in with the temporary `
        + `password (landed on ${page.url()}).`
      );
    }

    await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirmNewPassword"]').fill(NEW_PASSWORD);
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /update password/i }).first().click();
    await page.waitForURL(/\/login|\/dashboard/, { timeout: 60000, waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(2500);

    // "Update Password" bounces back to /login rather than signing the agent in, so it has to
    // authenticate again with the new password. Doing it here proves the account is usable before
    // the caller starts driving it.
    if (/\/login/.test(page.url())) {
      const relogin = new LoginPage(page);
      await relogin.emailInput.first().waitFor({ state: 'visible', timeout: 30000 });
      await relogin.emailInput.first().fill(identity.email);
      await relogin.passwordInput.first().fill(NEW_PASSWORD);
      await relogin.submitButton.first().click();
      await page
        .waitForURL(/\/dashboard|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' })
        .catch(() => {});
      await page.waitForTimeout(2000);
    }
    return { landedOn: page.url() };
  } finally {
    await context.close().catch(() => {});
  }
}

// Provision one promo agent end to end on a browser the caller already owns.
//
// Returns the same record shape the step file's agentFromEnv() produces, so a provisioned agent
// can be dropped straight into the AGENTS registry and every existing keyed step ("the '<key>'
// agent's promo code") works against it unchanged.
async function provisionPromoAgent(browser, spec) {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  }
  if (!NEW_PASSWORD) {
    throw new Error('Missing INVITE_AGENT_NEW_PASSWORD in .env');
  }
  const withoutPromo = /^unchecked$/i.test(String(spec.promo));
  const { type, value } = withoutPromo ? { type: null, value: null } : parsePromoSpec(spec.promo);

  const context = await browser.newContext();
  const page = await context.newPage();
  let invited;
  try {
    await loginSuperadmin(page);
    invited = await inviteWithPromo(page, spec);
  } finally {
    await context.close().catch(() => {});
  }

  await acceptInvite(browser, invited.identity, invited.baseline);

  return {
    label: spec.label || spec.firstName.toLowerCase(),
    email: invited.identity.email,
    password: NEW_PASSWORD,
    name: `${invited.identity.firstName} ${invited.identity.lastName}`,
    code: invited.promoCode,
    limit: withoutPromo ? null : Number(spec.usageLimit),
    value,
    type,
  };
}

// A fresh agent with NO promo code, for TFF-43 §10 (Case 4).
//
// REFERRAL_NOPROMO_AGENT is the suite's only other no-promo agent and it has to stay read-only:
// saving the "Add Code Parameters" modal against it would give it a promo permanently, and every
// empty-state scenario would fail from then on for a reason that looks nothing like the cause. A
// throwaway lets the SAVE half of §10.2 actually be exercised — the agent is created, given a
// promo through the tab, and abandoned.
//
// Costs a live signup + IMAP verification but NO payment, so the scenario using it is @provision
// and does not need @consumes-promo.
async function provisionAgentWithoutPromo(browser, spec = {}) {
  return provisionPromoAgent(browser, {
    label: 'no-promo-throwaway',
    firstName: 'Nopromo',
    tagPrefix: 'promonone',
    ...spec,
    promo: 'unchecked',
  });
}

module.exports = {
  provisionPromoAgent,
  provisionAgentWithoutPromo,
  parsePromoSpec,
  loginSuperadmin,
  inviteWithPromo,
  acceptInvite,
};
