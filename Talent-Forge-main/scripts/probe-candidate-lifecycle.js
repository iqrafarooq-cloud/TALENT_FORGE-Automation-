// probe-candidate-lifecycle.js - walk an INVITED candidate the whole way: setup link -> signup ->
// email verification -> login -> onboarding -> whatever the psychometric assessment turns out to
// be. Dumps each stage.
//
// This exists because candidate_onboarding_e2e.feature scenario 2 asserts a status progression all
// the way to Active, and the last leg ("the candidate completes the psychometric assessment") has
// no support anywhere in the suite. Whether it can be automated at all is unknown, and guessing
// would produce a scenario that fails for the wrong reason.
//
// COST: it completes a real signup for an already-spent invite, under AGENT_EMAIL (41 candidates
// already, so its state is not a fixture). It does NOT pay for anything.
require('dotenv').config();
const { chromium } = require('playwright');
const { makeClient, latestUid, waitForEmail } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const { resolveVerifyUrl } = require('../utils/onboardingProvision');
const SignupPage = require('../pages/SignupPage');
const LoginPage = require('../pages/LoginPage');
const line = console.log;

const TARGET = process.argv[2];
const PW = process.env.SIGNUP_PASSWORD || 'StrongPass123!';
if (!TARGET) { line('usage: node scripts/probe-candidate-lifecycle.js <invited-email>'); process.exit(1); }

async function setupLinkFor(target) {
  const c = makeClient(); await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  try {
    const uids = await c.search({ to: target, subject: 'Join Talentforge' }, { uid: true });
    for (const uid of uids.sort((a, b) => b - a)) {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      const p = await simpleParser(msg.source);
      const links = [...new Set([...(p.html || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]))]
        .filter((l) => /ls\/click/.test(l) && !/\/wf\/open/.test(l));
      if (links.length) return links[0];
    }
  } finally { lock.release(); await c.logout(); }
  return null;
}

async function dump(page, label) {
  line(`\n===== ${label} =====`);
  line(`  url: ${page.url()}`);
  line(`  text: ${(await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, ' | ').slice(0, 900)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    const link = await setupLinkFor(TARGET);
    if (!link) throw new Error('no setup link in the inbox for ' + TARGET);
    const url = await resolveVerifyUrl(link);
    line(`setup url: ${url}`);

    const signup = new SignupPage(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dump(page, '1. setup link landing (/signup?token=)');

    const baseline = await latestUid({ subject: 'Verify your Talentforge account', to: TARGET }).catch(() => 0);
    await signup.firstNameInput.fill('Lifecycle');
    await signup.lastNameInput.fill('Probe');
    await signup.passwordInput.fill(PW);
    await signup.confirmPasswordInput.fill(PW);
    await page.waitForTimeout(500);
    line(`  Create Account enabled: ${await signup.createAccountButton.isEnabled()}`);
    await signup.submit();
    await page.waitForTimeout(6000);
    await dump(page, '2. after Create Account');

    // Link or OTP? The feature file says OTP; the existing signup flow uses a link. Report which.
    const otpish = await page.locator('input[maxlength="1"], input[name*="otp" i], input[inputmode="numeric"]').count();
    line(`  OTP-looking inputs on screen: ${otpish}`);

    line('\n  waiting for the verification email...');
    const { link: vlink, parsed } = await waitForEmail('verifyAccount', { to: TARGET, afterUid: baseline || 0, timeoutMs: 180000 })
      .catch((e) => ({ link: null, parsed: null, err: e.message }));
    line(`  verification mail subject: ${JSON.stringify(parsed && parsed.subject)}`);
    line(`  verification link present: ${!!vlink}`);
    if (parsed) line(`  body (first 700):\n${(parsed.text || '').slice(0, 700)}`);
    if (vlink) {
      await page.goto(await resolveVerifyUrl(vlink), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await dump(page, '3. after opening the verification link');
    }

    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(TARGET);
    await login.passwordInput.first().fill(PW);
    await login.submitButton.first().click();
    await page.waitForURL(/getting-started|dashboard|onboarding|profile|my-track|assessment/, { timeout: 90000, waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(6000);
    await dump(page, '4. after logging in as the new candidate');

    // Where does the app want the candidate to go, and is there an assessment surface?
    line('\n===== assessment surfaces =====');
    for (const path of ['/assessment', '/psychometric', '/test', '/my-track', '/getting-started']) {
      await page.goto(new URL(path, process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3500);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, ' | ');
      line(`  ${path.padEnd(16)} -> ${page.url()}`);
      line(`      ${body.slice(0, 420)}`);
    }
    line(`\nCANDIDATE CREATED: ${TARGET} / ${PW}`);
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
