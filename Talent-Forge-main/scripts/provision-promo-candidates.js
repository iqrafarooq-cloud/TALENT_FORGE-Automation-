// provision-promo-candidates.js — one-off provisioning of ONE candidate per dedicated promo agent.
//
//   node scripts/provision-promo-candidates.js [ENV_PREFIX ...]
//   npm run test:promo:candidates
//
// WHY THESE ACCOUNTS EXIST
// Promo redemption is OWNERSHIP-SCOPED: only a candidate that signed up under an agent's own agent
// code can redeem that agent's promo (TFF-42 §6). The app began enforcing it on 2026-07-31, and
// scripts/probe-promo-ownership-vs-subscription.js proves that is the cause rather than subscription
// state — a brand-new, never-subscribed candidate of ANOTHER agent is refused an Active, unexpired,
// 0-of-10000-uses code with "Invalid or expired promotion code".
//
// The shared CANDIDATE_EMAIL account belongs to SIGNUP_AGENT, so it can no longer redeem any of the
// three promo agents' codes. Every scenario that expects a promo to be ACCEPTED, and every scenario
// whose refusal must be attributable to the promo's STATE (disabled / expired / exhausted) rather
// than to who is asking, therefore needs the owning agent's own candidate. Without that the app
// refuses the code for the wrong reason and the negative scenarios pass having tested nothing.
//
// WHY LONG-LIVED RATHER THAN PROVISIONED PER RUN
// Signing one up costs a live signup plus an IMAP round trip (~90s). Nine scenarios need one, so
// doing it at runtime would add ~12 minutes to every promo run and make all nine depend on the
// inbox. They are stable accounts instead: nothing in the suite mutates them, and none of them ever
// pays — the scenarios that DO pay provision their own throwaway candidate under the same agent
// code (see `world._provisionAgentCode` in features/support/subscriptionProvision.js).
//
// WHAT IT ALSO CAPTURES: each agent's own AGENT CODE (its referral code, distinct from the promo
// code). The app generates it on invite acceptance and only the agent's own dashboard renders it, so
// provision-promo-agents.js could not report it. It is recorded as <PREFIX>_REFERRAL_CODE so the
// healing paths can sign a candidate up under the right agent without an agent login.
//
// Each candidate is left NEVER-SUBSCRIBED, which is the state the subscribe-invoice scenarios need.
// The one scenario that needs a subscription (the Yearly upgrade with a promo) heals by provisioning
// its own candidate under the same agent code.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

const PREFIXES = ['PROMO_UNLIMITED_AGENT', 'PROMO_LIMITED_AGENT', 'PROMO_FIXED_AGENT'];
const AGENT_POST_LOGIN = /\/dashboard|\/candidates|\/verifications|\/activity-log/;
const FORCE = process.argv.includes('--force');

// Read an agent's own "Agent Code" widget off its dashboard, on a context of its own.
async function readAgentCode(browser, agent) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(agent.email);
    await login.passwordInput.first().fill(agent.password);
    await login.submitButton.first().click();
    await page.waitForURL(AGENT_POST_LOGIN, { timeout: 90000, waitUntil: 'commit' });
    if (/\/set-password/.test(page.url())) {
      throw new Error(`${agent.email} was bounced to /set-password — its invite was never accepted`);
    }
    const referral = new ReferralCodesPage(page);
    await referral.navigate();
    const code = (await referral.readCode('Agent Code')).trim();
    if (!code) throw new Error(`the "Agent Code" widget on ${agent.email}'s dashboard is empty`);
    return code;
  } finally {
    await context.close().catch(() => {});
  }
}

// Sign one candidate up under `agentCode`, on a context of its own. Never subscribes it.
async function signUpCandidate(browser, agentCode) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const world = {
      page,
      context,
      browser,
      pages: { subscription: new SubscriptionPage(page) },
    };
    return await provisionFreshCandidate(world, { agentCode });
  } finally {
    await context.close().catch(() => {});
  }
}

(async () => {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const prefixes = wanted.length ? PREFIXES.filter((p) => wanted.includes(p)) : PREFIXES;
  if (!prefixes.length) {
    throw new Error(`No prefix matched ${JSON.stringify(wanted)}. Known: ${PREFIXES.join(', ')}.`);
  }

  const agents = prefixes.map((prefix) => ({
    prefix,
    email: process.env[`${prefix}_EMAIL`],
    password: process.env[`${prefix}_PASSWORD`],
    existingCandidate: process.env[`${prefix}_CANDIDATE_EMAIL`],
  }));
  const missing = agents.filter((a) => !a.email || !a.password);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.map((a) => `${a.prefix}_EMAIL/_PASSWORD`).join(', ')} in .env. Provision the `
      + 'agents first with `npm run test:promo:provision`.'
    );
  }

  // Never silently replace a working fixture: a second candidate under the same agent is harmless
  // but the .env entry the suite actually uses would be swapped for an untested one.
  const todo = FORCE ? agents : agents.filter((a) => !a.existingCandidate);
  const skipped = agents.filter((a) => !todo.includes(a));
  for (const a of skipped) {
    console.log(`skipping ${a.prefix} — already has ${a.existingCandidate} (pass --force to replace)`);
  }
  if (!todo.length) {
    console.log('\nnothing to do. Every requested agent already has a candidate recorded in .env.');
    return;
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const created = [];
  try {
    for (const agent of todo) {
      console.log(`\n--- ${agent.prefix} ---`);
      const referralCode = await readAgentCode(browser, agent);
      console.log(`  agent code: ${referralCode}`);
      const candidateEmail = await signUpCandidate(browser, referralCode);
      console.log(`  candidate:  ${candidateEmail} (verified, never subscribed)`);
      created.push({ ...agent, referralCode, candidateEmail });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const password = process.env.SIGNUP_PASSWORD || 'StrongPass123!';
  console.log('\n================ paste into .env ================\n');
  console.log('#PROMO CODE LIFECYCLE — one CANDIDATE per promo agent, plus each agent\'s own code.');
  console.log(`# Provisioned ${new Date().toISOString().slice(0, 10)} by scripts/provision-promo-candidates.js.`);
  console.log('# Redemption is ownership-scoped: only these candidates can redeem their agent\'s promo.');
  console.log('# Left NEVER-SUBSCRIBED on purpose. Nothing in the suite pays with them.');
  for (const c of created) {
    console.log('#');
    console.log(`${c.prefix}_REFERRAL_CODE=${c.referralCode}`);
    console.log(`${c.prefix}_CANDIDATE_EMAIL=${c.candidateEmail}`);
    console.log(`${c.prefix}_CANDIDATE_PASSWORD=${password}`);
  }
  console.log('\n=================================================\n');
})().catch((e) => {
  console.error('\nPROVISIONING FAILED:', (e && e.message) || e);
  process.exit(1);
});
