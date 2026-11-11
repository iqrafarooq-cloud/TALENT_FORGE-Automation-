// provision-empty-profile-candidate.js - mint a DEDICATED agent + ONE fresh candidate of that
// agent who has done NOTHING (signed up and verified, onboarding untouched), and save both to .env
// as EMPTY_PROFILE_AGENT_* / EMPTY_PROFILE_CANDIDATE_*.
//
// WHY A SECOND AGENT. The candidate's View Profile (/candidates/<id>/view-profile) is the only
// Agent Portal surface the zero-candidate agent (NO_CANDIDATE_AGENT, +211) cannot reach - it has
// no candidate to open. Inviting one AS +211 would spend that fixture for good (a candidate cannot
// be deleted) and break every zero-candidate empty state in Empty-state.feature. So the
// "one empty candidate" property gets its own agent.
//
// Resumable: a phase whose result is already in .env is skipped, so a failure mid-way can be
// re-run without minting a second agent.
//
// Costs: one live superadmin invite + IMAP (agent), one candidate invite + signup + IMAP verify.
// No payments. Both accounts are permanent.
require('dotenv').config();
const { chromium } = require('playwright');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');
const {
  PASSWORD, freshCandidateEmail, sendCandidateInvite, waitForCandidateInvite,
  completeSignupFromSetupPage, verifyCandidateEmail, loginAsCandidate,
} = require('../utils/candidateInviteProvision');
const { latestUidForRecipient } = require('../utils/gmailClient');
const { updateEnvVars } = require('../utils/envWriter');

const BASE = String(process.env.BASE_URL).replace(/\/login\/?$/, '');

async function agentLogin(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('agent_welcome_shown', '1'); } catch (_) {} });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard|candidates/, { timeout: 90000, waitUntil: 'commit' });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    // ---- 1. the agent ----
    let agentEmail = (process.env.EMPTY_PROFILE_AGENT_EMAIL || '').trim();
    let agentPassword = process.env.EMPTY_PROFILE_AGENT_PASSWORD;
    if (!agentEmail) {
      console.log('Inviting a fresh agent...');
      const agent = await provisionAgentWithoutPromo(browser, { label: 'empty-profile', firstName: 'Emptyprof', tagPrefix: 'emptyprof' });
      agentEmail = agent.email; agentPassword = agent.password;
      updateEnvVars({ EMPTY_PROFILE_AGENT_EMAIL: agentEmail, EMPTY_PROFILE_AGENT_PASSWORD: agentPassword, EMPTY_PROFILE_AGENT_NAME: agent.name });
      console.log(`  agent saved: ${agentEmail}`);
    } else console.log(`Agent already in .env: ${agentEmail}`);

    // ---- 2. the candidate ----
    let candEmail = (process.env.EMPTY_PROFILE_CANDIDATE_EMAIL || '').trim();
    if (!candEmail) {
      candEmail = freshCandidateEmail('emptyprof');
      const { ctx, page } = await agentLogin(browser, agentEmail, agentPassword);
      console.log(`Inviting ${candEmail} as ${agentEmail}...`);
      const sent = await sendCandidateInvite(page, { email: candEmail, from: 'candidates' });
      await ctx.close();
      // Saved the moment the invitation exists: a candidate cannot be deleted, so losing track of
      // it would orphan a permanent row on this agent.
      updateEnvVars({ EMPTY_PROFILE_CANDIDATE_EMAIL: candEmail, EMPTY_PROFILE_CANDIDATE_PASSWORD: PASSWORD });
      console.log(`  invitation sent (HTTP ${sent.status}); candidate saved`);

      const invite = await waitForCandidateInvite(candEmail, { afterUid: sent.baseline });
      const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const cpage = await cctx.newPage();
      await cpage.goto(invite.setupUrl, { waitUntil: 'domcontentloaded' });
      const verifyBaseline = await latestUidForRecipient(candEmail).catch(() => 0);
      await completeSignupFromSetupPage(cpage, { firstName: 'Empty', lastName: 'Profile' });
      await verifyCandidateEmail(cpage, candEmail, { afterUid: verifyBaseline });
      const landed = await loginAsCandidate(cpage, candEmail);
      console.log(`  candidate signed up, verified, and lands on ${landed} - onboarding left untouched`);
      await cctx.close();
    } else console.log(`Candidate already in .env: ${candEmail}`);

    // ---- 3. find the candidate's id and prove the profile route works ----
    const { ctx, page } = await agentLogin(browser, agentEmail, agentPassword);
    const listing = page.waitForResponse((r) => /\/candidate\/.*in-progress|\/candidate\/in_progress|\/candidate\/onboarding/i.test(r.url()) && r.request().method() === 'GET', { timeout: 30000 }).catch(() => null);
    await page.goto(`${BASE}/candidates/in-progress`, { waitUntil: 'domcontentloaded' });
    const res = await listing;
    let id = null;
    if (res) {
      const body = await res.json().catch(() => null);
      const rows = (body && (body.results || body)) || [];
      const row = rows.find((r) => JSON.stringify(r).toLowerCase().includes(candEmail.toLowerCase()));
      id = row && (row.id || (row.candidate && row.candidate.id));
      console.log(`  In Progress payload from ${res.url()}: ${rows.length} row(s), id=${id}`);
    }
    if (id) {
      updateEnvVars({ EMPTY_PROFILE_CANDIDATE_ID: String(id) });
      await page.goto(`${BASE}/candidates/${id}/view-profile?selectedTab=candidate-details`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      console.log('  profile renders:\n' + (await page.locator('main').first().innerText()).slice(0, 800));
    }
    await ctx.close();
  } catch (err) {
    console.error('FAILED: ' + err.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
