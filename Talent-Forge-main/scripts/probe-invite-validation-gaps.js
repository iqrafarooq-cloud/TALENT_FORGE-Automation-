// probe-invite-validation-gaps.js — for the four @known-issue scenarios that report "no
// error anywhere on the form", check whether the app gives the superadmin ANY feedback
// (inline message, toast, or a gated CTA) or none at all. That decides whether the defect
// is "wrong placement" or "silent failure".
//
//   node scripts/probe-invite-validation-gaps.js
//
// Creates nothing: the duplicate email it submits is the exact-case one the backend
// rejects with 400.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InviteAgentPage = require('../pages/InviteAgentPage');
const { freshAgentIdentity } = require('../utils/agentInviteProvision');

const UNI = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';
const DUP = process.env.REFERRAL_AGENT_EMAIL || 'iqra.farooq+refagent@bytecorp.io';
const line = (t) => console.log(`\n${'='.repeat(14)} ${t} ${'='.repeat(14)}`);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext()).newPage();

  const invites = [];
  page.on('response', async (res) => {
    if (!/\/admin\/invite\/agent\/?$/.test(res.url()) || res.request().method() !== 'POST') return;
    let body = ''; try { body = await res.text(); } catch { /* gone */ }
    invites.push({ status: res.status(), body: body.slice(0, 300) });
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const form = new InviteAgentPage(page);
  const report = async (label, field) => {
    console.log(`  inline error on "${field}": ${JSON.stringify(await form.errorFor(field))}`);
    console.log(`  every error on the form: ${JSON.stringify(await form.allErrors())}`);
    console.log(`  toasts on screen:        ${JSON.stringify(await form.toastMessages())}`);
    console.log(`  Send Invite enabled:     ${await form.isSubmitEnabled()}`);
    const body = await page.locator('body').innerText().catch(() => '');
    const shouted = (body.match(/[^\n]*(already exist|duplicate|select a university|maximum|too large|invalid|not valid)[^\n]*/gi) || []);
    console.log(`  any matching text in the page: ${JSON.stringify(shouted.slice(0, 5))}`);
  };

  // ---- 1. duplicate email (exact case) ----
  line('DUPLICATE EMAIL — exact case');
  await form.goto();
  await form.fillValidDetails({ firstName: 'Dup', lastName: 'Check', email: DUP, university: UNI, target: '5' });
  await form.clickSubmit();
  await page.waitForTimeout(4000);
  console.log('  invite responses:', JSON.stringify(invites));
  console.log('  success modal visible:', await form.isSuccessModalVisible());
  await report('duplicate', 'Email Address');

  // ---- 2. University Affiliation left unselected, then submit ----
  line('UNIVERSITY AFFILIATION unselected');
  await form.goto();
  const id = freshAgentIdentity();
  await form.enter('First Name', 'Aisha');
  await form.enter('Last Name', 'AlFahad');
  await form.enter('Email Address', id.email);
  await form.enter('Numeric Performance Target (Monthly)', '10');
  await page.waitForTimeout(600);
  console.log('  Send Invite enabled before submit:', await form.isSubmitEnabled());
  await form.submitButton.click({ force: true }).catch(() => {});
  await page.waitForTimeout(2500);
  await report('university', 'University Affiliation');
  console.log('  invite responses so far:', JSON.stringify(invites));

  // ---- 3. performance target above any sane maximum ----
  line('PERFORMANCE TARGET 1000000');
  await form.goto();
  await form.enter('Numeric Performance Target (Monthly)', '1000000');
  await form.blur('Numeric Performance Target (Monthly)');
  await page.waitForTimeout(1200);
  console.log('  field holds:', JSON.stringify(await form.valueOf('Numeric Performance Target (Monthly)')));
  await report('target', 'Numeric Performance Target (Monthly)');

  // ---- 4. email with no top-level domain ----
  line('EMAIL user@nodot');
  await form.goto();
  await form.enter('Email Address', 'user@nodot');
  await form.blur('Email Address');
  await page.waitForTimeout(1200);
  await report('email', 'Email Address');
  // ...and whether such an address can actually be submitted
  await form.enter('First Name', 'Aisha');
  await form.enter('Last Name', 'AlFahad');
  await form.selectUniversity(UNI);
  await form.enter('Numeric Performance Target (Monthly)', '10');
  await page.waitForTimeout(800);
  console.log('  with the rest of the form valid, Send Invite enabled:', await form.isSubmitEnabled());

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
