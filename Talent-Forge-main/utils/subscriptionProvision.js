// subscriptionProvision.js — self-healing account provisioning for the
// Subscription feature. The shared candidate account is already subscribed, so
// scenarios that need a specific state (never-subscribed, initial subscribe,
// clean upgrade) cannot run on it — the app shows "already subscribed / upgrade
// to continue" instead of the real payment flow. These helpers mint a FRESH,
// verified, logged-in, onboarding-skipped candidate with NO subscription, so
// each such scenario starts from a clean, correct state.
//
// Mirrors scripts/subscription-plans-e2e.js (proven live 2026-07-22):
//   signup -> email-verify (IMAP) -> login -> skip onboarding -> /getting-started.
// anonaddy strips the +tag on delivery, so the verification email arrives To the
// BASE address — match IMAP on the base, log in with the full +alias.
//
// Optional override: set CANDIDATE_FRESH_EMAIL / CANDIDATE_FRESH_PASSWORD in .env
// to reuse a pre-seeded never-subscribed account instead of provisioning one.

require('dotenv').config();
const SignupPage = require('../pages/SignupPage');
const LoginPage = require('../pages/LoginPage');
const OnboardingPage = require('../pages/OnboardingPage');
const { latestUid, waitForEmail } = require('./gmailClient');
const { resolveVerifyUrl } = require('./onboardingProvision');

const VERIFY_SUBJECT = 'Verify your Talentforge account';
// Provisioned candidates use the bytecorp inbox, which keeps the +alias in the To header.
// anonaddy is no longer used (2026-10-14): it strips the alias, so concurrent signups collide.
const EMAIL_BASE = process.env.SUBSCRIPTION_EMAIL_BASE || 'iqra.farooq@bytecorp.io';
const AGENT = process.env.SIGNUP_AGENT_CODE;
const PW = process.env.SIGNUP_PASSWORD || 'StrongPass123!';
const POST_LOGIN = /\/getting-started|\/dashboard|\/onboarding|\/profile|\/my-track/;

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const aliasFor = (token) => {
  const [local, domain] = EMAIL_BASE.split('@');
  return `${local}+sub${token}@${domain}`;
};

// Provision (or reuse) a fresh, never-subscribed candidate. Idempotent per
// scenario: returns immediately if this world already has one. Leaves the page
// logged in past onboarding, ready to reach /subscribe.
//
// `opts.agentCode` overrides which agent the candidate signs up UNDER. Default is
// SIGNUP_AGENT_CODE (the shared agent). The referral-code scenarios pass the referral
// agent's own code instead, so the candidate really belongs to the agent whose promo is
// under test — passed explicitly rather than by mutating process.env, which would leak
// into every other scenario in the run.
//
// `world._provisionAgentCode` is the same override for the HEALING paths, which no caller can pass
// an argument to: `I have an active "Monthly" subscription` and `my subscription is on a plan below
// "Yearly"` provision a candidate on their own when the logged-in account is in the wrong state.
// Promo redemption is ownership-scoped, so healing under SIGNUP_AGENT_CODE would hand a promo
// scenario a candidate that cannot redeem the promo it is about — the refusal then looks like an app
// defect. The promo steps set this when they log in as an agent's own candidate; an explicit
// argument still wins.
async function provisionFreshCandidate(world, { agentCode } = {}) {
  if (world._freshEmail) return world._freshEmail;
  const page = world.page;
  const agent = agentCode || world._provisionAgentCode || AGENT;

  // Override: reuse a pre-seeded account if provided.
  if (process.env.CANDIDATE_FRESH_EMAIL && process.env.CANDIDATE_FRESH_PASSWORD) {
    const email = process.env.CANDIDATE_FRESH_EMAIL;
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(process.env.CANDIDATE_FRESH_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(POST_LOGIN, { timeout: 90000, waitUntil: 'commit' });
    if (/\/onboarding/.test(page.url())) await new OnboardingPage(page).skipAllSteps();
    world._freshEmail = email;
    return email;
  }

  if (!agent) {
    throw new Error(
      'No agent code to sign the candidate up under — set SIGNUP_AGENT_CODE in .env, or pass '
      + 'provisionFreshCandidate(world, { agentCode }).'
    );
  }
  const token = uniq();
  const email = aliasFor(token);
  const signup = new SignupPage(page);

  await signup.navigateToSignup();
  await signup.fillForm({
    firstName: 'Sub', lastName: 'Tester', email,
    agentCode: agent, password: PW, confirmPassword: PW,
  });
  // bytecorp keeps the +alias in the To header, so search by the candidate's own address. (anonaddy
  // delivered everything to the BASE and named the alias only in x-anonaddy-original-to, which
  // bytecorp mail never carries - searching the base, or filtering on that header, finds nothing.)
  const baseline = await latestUid({ subject: VERIFY_SUBJECT, to: email }).catch(() => 0);
  await signup.submit();
  await page.waitForURL(/\/email-verification/, { timeout: 45000 });

  const { link } = await waitForEmail('verifyAccount', {
    to: email, afterUid: baseline || 0, timeoutMs: 150000,
  });
  if (!link) throw new Error('verification email had no link');
  await page.goto(await resolveVerifyUrl(link), { waitUntil: 'domcontentloaded' });
  await signup.verifiedHeading.waitFor({ state: 'visible', timeout: 30000 });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(PW);
  await login.submitButton.first().click();
  await page.waitForURL(POST_LOGIN, { timeout: 90000, waitUntil: 'commit' });
  if (/\/onboarding/.test(page.url())) await new OnboardingPage(page).skipAllSteps();

  world._freshEmail = email;
  return email;
}

// Provision fresh (if needed) then subscribe to `planName` and pay with the test
// card — leaves the account ACTIVE with one Paid billing row, ready for the
// billing-history / upgrade scenarios. Destructive (real test-mode payment).
async function subscribeAndPay(world, planName, opts = {}) {
  await provisionFreshCandidate(world, opts);
  const sub = world.pages.subscription;
  await sub.gotoPlans();
  await sub.selectPlan(planName);
  await sub.continueButton.click();
  await sub.payWithTestCard();
  await sub.successTitle.waitFor({ state: 'visible', timeout: 30000 });
  return world._freshEmail;
}

// ---------------------------------------------------------------------------
// "Account must be on a tier BELOW <plan>" — self-healing
// ---------------------------------------------------------------------------
// The upgrade scenarios choose a specific higher plan (Yearly) in the Change Plan modal, so
// they only work while the account sits on a LOWER tier. The modal offers the two non-current
// plans, so on an account already on Yearly there is no "Yearly Plan" button at all and the
// step times out (seen live 2026-07-28 — the shared candidate had upgraded itself to Yearly in
// an earlier run). Yearly is the top tier, so there is no plan-agnostic rewrite that keeps the
// scenario an UPGRADE: choosing anything lower is a downgrade, which takes the "Confirm plan
// change" path and renders no invoice, no pro-rata credit and no promo field.
//
// So: fast path when the current tier is already below the target (the common case — nothing is
// touched, no payment), and heal by subscribing a FRESH candidate to Monthly when it is not.
// Healing makes a real test-mode payment and inherits the @provision constraints (network +
// IMAP, serial), which is why it is conditional rather than unconditional setup.
//
// Returns { healed, plan } — `plan` is the tier the scenario will upgrade FROM.
async function ensurePlanBelow(world, targetPlan) {
  const sub = world.pages.subscription;
  await sub.gotoSubscriptionTab();
  const state = await sub.currentState();
  const current = state === 'active' ? await sub.currentPlanName() : null;

  if (current && sub.planTier(current) < sub.planTier(targetPlan)) {
    return { healed: false, plan: current };
  }

  const from = SUBSCRIPTION_TIERS[0];
  await subscribeAndPay(world, from);
  await sub.gotoSubscriptionTab();
  const now = await sub.currentPlanName();
  if (!now || sub.planTier(now) >= sub.planTier(targetPlan)) {
    throw new Error(
      `Needed an account on a tier below "${targetPlan}" to upgrade FROM. The logged-in account `
      + `was ${current ? `on "${current}"` : `in state "${state}"`}, so a fresh candidate was `
      + `subscribed to "${from}" — but the tab now reads ${now ? `"${now}"` : '(no plan)'}.`
    );
  }
  return { healed: true, plan: now };
}

const SUBSCRIPTION_TIERS = ['Monthly', 'Quarterly', 'Yearly'];

// ---------------------------------------------------------------------------
// Non-Paid billing rows (Pending / Canceled) — self-healing
// ---------------------------------------------------------------------------
// The billing-history rule "non-Paid rows have disabled receipt actions" can only be
// asserted where such a row exists. The shared candidate happens to carry both statuses
// (leftovers from earlier live runs), but a clean account carries neither, and an
// assertion that silently skips is worse than no assertion — so mint the row for real.
//
// Mechanics, verified live 2026-07-27 (scripts/probe-provision-nonpaid-rows.js):
//   POST /payments/paytabs/initiate/ creates the row immediately as PENDING (201), and how
//   the gateway session ENDS decides the final status:
//       abandon (navigate away)     -> stays PENDING
//       Cancel on the PayTabs page  -> becomes CANCELED (via /payment/result)
//   No card details are entered either way, so nothing is charged.
//
// Why it must run on a fresh candidate: on an already-subscribed account initiate answers
// 422 ["You already have an active subscription. Use upgrade or change plan instead."] and
// creates nothing. Healing therefore provisions a never-subscribed candidate first, which
// means a healing run inherits the @provision constraints — network + IMAP, and SERIAL
// execution (every verification mail lands on the same inbox). Dormant while the shared
// account still has the rows.

// The app title-cases the API enum in US spelling: PENDING -> "Pending", CANCELED ->
// "Canceled". "Cancelled" (double L) is accepted as input and normalised, since it matches
// zero rows in the UI and is the easy mistake to make.
const NONPAID_LABELS = { pending: 'Pending', canceled: 'Canceled', cancelled: 'Canceled' };

// Each minter only ENDS an already-initiated gateway session — the initiate itself is shared
// (and its response captured for diagnostics) in provisionNonPaidRow below.
const NONPAID_MINTERS = {
  Pending: (sub) => sub.abandonPayTabsSession(),
  Canceled: (sub) => sub.cancelPayTabsSession(),
};

// Ensure the logged-in account's billing history has at least one row with `status`.
// Returns { label, healed, rows } — `healed:false` means the row was already there and
// nothing was touched. Throws if the status is not one that can be minted, or if healing
// ran and still produced no such row (never silently passes).
async function provisionNonPaidRow(world, status) {
  const sub = world.pages.subscription;
  const label = NONPAID_LABELS[String(status).trim().toLowerCase()];
  if (!label) {
    throw new Error(
      `Cannot provision billing status "${status}" — only Pending and Canceled can be minted `
      + '(a Paid row needs a real payment; FAILED needs a backend auto-renewal failure).'
    );
  }

  // Fast path: the account already has such a row, so change nothing at all. Note the
  // *WithBilling* variant — a plain gotoSubscriptionTab resolves before the grid is populated
  // and would read 0 rows on an account that has them, healing needlessly.
  //
  // NONPAID_FORCE_HEAL=true skips the fast path. On the shared candidate the rows are always
  // already there, so the minting path below would otherwise never execute — and an untested
  // heal is a heal that fails the first time a clean account needs it. Set it to exercise the
  // real end-to-end flow (fresh signup -> initiate -> abandon/cancel -> assert the row).
  if (process.env.NONPAID_FORCE_HEAL !== 'true') {
    await sub.gotoSubscriptionTabWithBilling();
    const existing = await sub.rowsWithStatus(label).count();
    if (existing > 0) return { label, healed: false, rows: existing };
  }

  // Heal: mint one on a never-subscribed candidate (reuses this scenario's if already made).
  await provisionFreshCandidate(world);
  const payment = await sub.initiatePayTabsSession('monthly');
  await NONPAID_MINTERS[label](sub);

  await sub.gotoSubscriptionTabWithBilling();
  const rows = await sub.rowsWithStatus(label).count();
  if (rows === 0) {
    const seen = await sub.allBillingRowStatuses();
    throw new Error(
      `Healing ran for "${label}" (initiate answered ${JSON.stringify(payment)}, session then `
      + `ended) but no "${label}" row is in billing history.\n`
      + `Rendered statuses: ${seen.length ? seen.map((s) => `"${s}"`).join(', ') : '(no rows)'}\n`
      + 'Either the end-of-session -> status mapping changed app-side, or the session did not '
      + 'end the way this minter assumes.'
    );
  }
  return { label, healed: true, rows };
}

module.exports = {
  provisionFreshCandidate,
  subscribeAndPay,
  provisionNonPaidRow,
  ensurePlanBelow,
};
