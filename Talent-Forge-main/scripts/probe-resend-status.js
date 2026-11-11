// probe-resend-status.js — does confirming "Resend Invite" change a pending agent's STATUS?
//
//   node scripts/probe-resend-status.js
//
// Invites one brand-new agent, reads its status straight off the listing API, resends the
// invitation, then reads the status again. Prints both, plus the resend response body.
// Leaves the agent on DEV (deactivate by hand if it ends up on the Active tab).
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AgentsListingPage = require('../pages/AgentsListingPage');
const InviteAgentPage = require('../pages/InviteAgentPage');
const { freshAgentIdentity } = require('../utils/agentInviteProvision');

const line = (t) => console.log(`\n${'='.repeat(14)} ${t} ${'='.repeat(14)}`);

// Which tab holds this agent, and with which row actions. The tab + actions ARE the evidence:
// a pending invite is on Invite Sent with Edit / Resend Invite, an activated one is on Active
// with View / Edit / Deactivate Account. No API call needed — an in-page fetch cannot reuse
// the app's auth (it 401s), and the rendered row is the thing a superadmin actually sees.
async function whereIs(listing, { email, surname }) {
  const out = {};
  for (const tab of ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated']) {
    await listing.goto(tab);
    await listing.search(surname);
    const row = (await listing.readRows()).find((r) => (r.email || '').toLowerCase() === email.toLowerCase());
    out[tab] = row ? { status: row.status, actions: row.actions } : null;
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const resendCalls = [];
  page.on('response', async (res) => {
    if (!/\/admin\/invite\/(resend\/)?agent\/?$/.test(res.url())) return;
    if (res.request().method() !== 'POST') return;
    let body = ''; try { body = await res.text(); } catch { /* gone */ }
    resendCalls.push({ url: res.url(), status: res.status(), body: body.slice(0, 300) });
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const invitePage = new InviteAgentPage(page);
  const listing = new AgentsListingPage(page);
  const identity = freshAgentIdentity();
  line(`INVITING ${identity.email} (surname ${identity.lastName})`);

  await invitePage.goto();
  await invitePage.fillValidDetails({
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    university: process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University',
    target: '10',
  });
  await invitePage.clickSubmit();
  await invitePage.waitForSuccessModal();
  console.log('invite submitted, success modal shown');
  await page.waitForTimeout(3000);

  const locate = () => whereIs(listing, { email: identity.email, surname: identity.lastName });

  line('BEFORE THE RESEND');
  console.log(JSON.stringify(await locate(), null, 2));

  line('RESEND');
  await listing.goto('Invite Sent');
  await listing.search(identity.lastName);
  await listing.openResendDialog(identity.email);
  await listing.confirmResend();
  await page.waitForTimeout(4000);
  console.log('resend network calls:', JSON.stringify(resendCalls, null, 2));
  console.log('toasts:', JSON.stringify(await listing.toastMessages()));

  line('AFTER THE RESEND');
  console.log(JSON.stringify(await locate(), null, 2));

  console.log(`\nLEFTOVER ON DEV: ${identity.email} (surname ${identity.lastName})`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
