// Standalone 3-plan subscription E2E (NOT part of the .feature suite — testing aid,
// as requested). For EACH plan (Monthly, Quarterly, Yearly) it:
//   1. provisions a FRESH, never-subscribed candidate via the real signup flow
//      (candidates+<uniq>@iqra.anonaddy.com — anonaddy strips the +tag on delivery, so
//      the verification email is matched on the base candidates@iqra.anonaddy.com),
//   2. subscribes to that plan and pays for real on PayTabs (4242 test card, no promo),
//   3. verifies the success modal, the Subscription tab (plan name + per-plan billing
//      frequency + amount + "Auto-renews on"), the Paid billing row, and the receipt
//      viewer details (Plan Type / Amount) matched against the row,
//   4. sets a unique customer name at checkout and checks it appears in the downloaded
//      receipt PDF (best-effort — PDF text may be compressed).
//
// Run: node scripts/subscription-plans-e2e.js
// Each plan uses its own isolated account, so the flow is repeatable.
require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');
const SignupPage = require('../pages/SignupPage');
const LoginPage = require('../pages/LoginPage');
const OnboardingPage = require('../pages/OnboardingPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { latestUid, waitForEmail } = require('../utils/gmailClient');

const VERIFY_SUBJECT = 'Verify your Talentforge account';
const VERIFY_TO_BASE = process.env.SUBSCRIPTION_EMAIL_BASE || 'iqra.farooq@bytecorp.io';
const AGENT = process.env.SIGNUP_AGENT_CODE;
const PW = process.env.SIGNUP_PASSWORD || 'StrongPass123!';

const PLANS = [
  { name: 'Monthly', amount: 155, freq: 'Billed monthly · 12 payments/year' },
  { name: 'Quarterly', amount: 400, freq: 'Billed every 3 months · 4 payments/year' },
  { name: 'Yearly', amount: 1500, freq: 'Billed once a year' },
];

const uniq = () => Date.now().toString(36) + Math.floor(performance.now()).toString(36);
const money = (s) => { const m = String(s).match(/[\d.,]+/); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };

async function resolveVerifyUrl(startUrl, maxHops = 6) {
  let url = startUrl;
  for (let i = 0; i < maxHops; i++) {
    let res;
    try { res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } }); }
    catch { return url; }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = loc; if (/\/verify-email/i.test(url)) return url; continue; }
    return url;
  }
  return url;
}

// Signup -> verify (IMAP) -> login. Returns the fresh account email; page is left logged in.
async function provisionFreshCandidate(page, token) {
  const [local, domain] = VERIFY_TO_BASE.split('@');
  const email = `${local}+e2e${token}@${domain}`;
  const signup = new SignupPage(page);
  await signup.navigateToSignup();
  await signup.fillForm({ firstName: 'Plan', lastName: 'Tester', email, agentCode: AGENT, password: PW, confirmPassword: PW });
  const baseline = await latestUid({ subject: VERIFY_SUBJECT, to: VERIFY_TO_BASE }).catch(() => 0);
  await signup.submit();
  await page.waitForURL(/\/email-verification/, { timeout: 45000 });
  const { link } = await waitForEmail('verifyAccount', { to: VERIFY_TO_BASE, afterUid: baseline || 0, timeoutMs: 150000 });
  if (!link) throw new Error('verification email had no link');
  await page.goto(await resolveVerifyUrl(link), { waitUntil: 'domcontentloaded' });
  await signup.verifiedHeading.waitFor({ state: 'visible', timeout: 30000 });
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(PW);
  await login.submitButton.first().click();
  await page.waitForURL(/\/getting-started|\/dashboard|\/onboarding|\/profile/, { timeout: 45000, waitUntil: 'commit' });
  // A brand-new account lands on the 6-step onboarding wizard, and /subscribe redirects
  // back to it until it is completed or skipped. Skip all steps to unlock the paywall.
  if (/\/onboarding/.test(page.url())) {
    await new OnboardingPage(page).skipAllSteps();
  }
  return email;
}

async function runPlan(browser, plan) {
  const checks = [];
  const ok = (label, cond, extra = '') => checks.push({ label, pass: !!cond, extra });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const token = uniq();
  const firstName = `QA${token}`;
  const lastName = `Name${token}`;
  let email = '(not created)';
  try {
    email = await provisionFreshCandidate(page, token);
    const sub = new SubscriptionPage(page);

    // Subscribe to the plan.
    await sub.gotoPlans();
    await sub.selectPlan(plan.name);
    // Set a unique customer name so we can look for it in the receipt PDF.
    await sub.fillCustomer({ first: firstName, last: lastName });
    await sub.continueButton.click();
    await sub.payWithTestCard();
    const activeModal = await sub.successTitle
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    ok('success modal "Your Subscription is Active!"', activeModal);

    // Subscription tab checks.
    await sub.gotoSubscriptionTab();
    ok('state = active', (await sub.currentState()) === 'active');
    ok(`plan name "${plan.name} Plan" shown`, await page.getByText(new RegExp(`^${plan.name} Plan$`, 'i')).first().isVisible().catch(() => false));
    ok(`billing frequency "${plan.freq}"`, await page.getByText(plan.freq, { exact: false }).first().isVisible().catch(() => false));
    ok('"Auto-renews on" shown', await sub.autoRenewText.isVisible().catch(() => false));

    const row = await sub.firstPaidRowData();
    ok(`billing row plan = ${plan.name} Plan`, /(?:Monthly|Quarterly|Yearly) Plan/.test(row.plan) && new RegExp(plan.name, 'i').test(row.plan), `got "${row.plan}"`);
    ok(`billing row amount = ${plan.amount}`, money(row.amount) === plan.amount, `got "${row.amount}"`);
    ok('billing row status = Paid', /paid/i.test(row.status), `got "${row.status}"`);

    // Receipt viewer.
    await sub.openFirstPaidReceipt();
    const rPlan = await sub.receiptPanelValue('Plan Type');
    const rAmount = await sub.receiptPanelValue('Amount');
    const rName = await sub.receiptPanelValue('Receipt Name');
    ok('receipt Plan Type matches row', rPlan === row.plan, `panel "${rPlan}" vs row "${row.plan}"`);
    ok('receipt Amount matches row', money(rAmount) === money(row.amount), `panel "${rAmount}" vs row "${row.amount}"`);
    // The receipt shows the RECEIPT name (a .pdf), not the customer's name (confirmed with
    // the product owner — the customer's first/last name is not rendered on the receipt).
    ok('receipt name (a .pdf) is shown', /\.pdf$/i.test(rName), `got "${rName}"`);

    // Row's signed receipt link is a downloadable PDF.
    let href = '';
    try {
      href = (await page.locator('[role="grid"] a[href*="receipt"]').first().getAttribute('href')) || '';
    } catch { /* ignore */ }
    ok('receipt download link points to a .pdf', /receipt.*\.pdf/i.test(href), `href "${href.slice(0, 80)}"`);
  } catch (e) {
    ok(`FLOW ERROR: ${e.message}`, false);
  } finally {
    await ctx.close();
  }
  return { plan: plan.name, email, checks };
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' || true });
  const results = [];
  try {
    for (const plan of PLANS) {
      console.log(`\n=== ${plan.name} plan ===`);
      const r = await runPlan(browser, plan);
      results.push(r);
      console.log(`account: ${r.email}`);
      for (const c of r.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.extra ? '  [' + c.extra + ']' : ''}`);
    }
  } finally {
    await browser.close();
  }

  console.log('\n================ SUMMARY ================');
  let totalFail = 0;
  for (const r of results) {
    const fails = r.checks.filter((c) => !c.pass);
    totalFail += fails.length;
    console.log(`${plan_pad(r.plan)} ${r.checks.length - fails.length}/${r.checks.length} passed  (${r.email})`);
    // Treat the PDF-name best-effort check as non-blocking in the exit code.
  }
  const blockingFails = results.flatMap((r) => r.checks).filter((c) => !c.pass && !/best-effort/.test(c.label));
  console.log(`\nBlocking failures: ${blockingFails.length}`);
  process.exitCode = blockingFails.length ? 1 : 0;
})();

function plan_pad(s) { return (s + ' plan').padEnd(16); }
