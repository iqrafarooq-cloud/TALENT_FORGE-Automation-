// candidateInviteProvision.js — the agent-invites-a-candidate flow, end to end: send the invite
// through the real modal, read the invitation out of the live inbox, resolve its account-setup
// link, and walk the candidate through signup and email verification.
//
// features/Agent_Portal/candidate_onboarding_e2e.feature is the only consumer. Everything here
// was measured against the live app on 2026-08-27; the notes are the measurements, not intentions.
//
// ============================================================================================
// WHAT THE FLOW ACTUALLY IS
//
//   agent: Candidates > Invite Candidate > Invite via Email > <address> + Enter > Send Invites
//          -> POST /core/api/v1/agent/invite/candidate/bulk/  -> 200 {"detail":"Emails sent
//             successfully"}
//          -> modal "Invitations sent!" with "Stay on In Progress" / "Go to Dashboard"
//   inbox: "Join Talentforge"  (the SAME subject as the AGENT invite - see emailTypes.js)
//          CTA -> SendGrid /ls/click wrapper -> 302 -> /signup?token=<payload>:<sig>:<sig>
//   candidate: /signup arrives with email AND agent code pre-filled and DISABLED
//          -> Create Account -> /email-verification ("Check Your Inbox!")
//          -> "Verify your Talentforge account" -> /verify-email?uid=&token=
//          -> "Email verified successfully!" -> log in -> /onboarding (Step 1 of 6)
//
// >>> THERE IS NO OTP ANYWHERE IN THIS FLOW. <<< The feature file used to say "the candidate
// verifies the emailed OTP". Measured: after Create Account the page shows "Check Your Inbox!"
// with ZERO otp-shaped inputs, and verification completes by opening a link. Anything asserting
// an OTP here would be red against a flow the product does not have.
//
// ============================================================================================
// THE INVITE TOKEN IS A READABLE, SIGNED JSON BLOB
//
//   /signup?token=eyJjb2RlIjoiTVpGVllCIiwiZW1haWwiOiI...ifQ:1wzXGG:VqfYGZzQ_AbZS...
//
// Three colon-separated parts, Django's signing format: base64url(JSON) : timestamp : HMAC.
// The payload decodes to {"code":"<agent code>","email":"<invited address>"} — which is how the
// signup form knows what to pre-fill. Two consequences the scenarios use:
//   * the expected pre-filled values can be read FROM THE TOKEN rather than assumed, so the
//     assertion compares the form against what the invite actually carried.
//   * tampering is precise: flip a character of the PAYLOAD and the HMAC no longer matches, which
//     is a genuinely invalid token rather than a malformed URL.
require('dotenv').config();
const SignupPage = require('../pages/SignupPage');
const LoginPage = require('../pages/LoginPage');
const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');
const { latestUidForRecipient, waitForEmail } = require('./gmailClient');

// Invited candidates are addressed on the BYTECORP mailbox, not the anonaddy one.
//
// >>> THAT CHOICE IS LOAD-BEARING. <<< anonaddy STRIPS the +alias on delivery, so every invited
// candidate would arrive at the one base address and be indistinguishable - and since the
// candidate invite shares the AGENT invite's subject, there would be nothing left to match on at
// all. bytecorp preserves the +tag in the To header (verified by inbox sweep 2026-08-12 for the
// agent-email module), so `{ to: <alias> }` identifies exactly one invitation.
const INBOX = process.env.CANDIDATE_INVITE_INBOX || process.env.MAILBOX_EMAIL || 'iqra.farooq@bytecorp.io';
const PASSWORD = process.env.SIGNUP_PASSWORD || 'StrongPass123!';

let seq = 0;

// A fresh, unique invitee address. Letters-and-digits tag; nothing downstream filters it.
function freshCandidateEmail(prefix = 'cand') {
  seq += 1;
  const [local, domain] = INBOX.split('@');
  return `${local}+${prefix}${Date.now().toString(36)}${seq}@${domain}`;
}

// ---------------------------------------------------------------------------------------------
// The invitation token
// ---------------------------------------------------------------------------------------------

function tokenFromUrl(url) {
  try {
    return new URL(url).searchParams.get('token');
  } catch {
    return null;
  }
}

// Decode the payload half. Returns { code, email } or null — never throws, because a scenario
// asserting a TAMPERED token deliberately hands this something undecodable.
function decodeInviteToken(urlOrToken) {
  const token = /^https?:/i.test(String(urlOrToken)) ? tokenFromUrl(urlOrToken) : urlOrToken;
  if (!token) return null;
  const payload = String(token).split(':')[0];
  try {
    // base64url — Django signs with '-' and '_' in place of '+' and '/', and strips padding.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return { code: parsed.code, email: parsed.email, raw: parsed };
  } catch {
    return null;
  }
}

// Corrupt the PAYLOAD of the token, leaving the URL and the signature structurally intact.
//
// Tampering has to break the payload, not the URL: dropping the token or mangling the whole
// string tests the app's 404 handling, whereas the scenario is about a token whose signature no
// longer authenticates its contents. The substituted character is chosen to differ from the
// original, so the mutation can never be a no-op.
function tamperInviteToken(url) {
  const token = tokenFromUrl(url);
  if (!token) throw new Error(`No token to tamper with in ${url}`);
  const parts = token.split(':');
  const payload = parts[0];
  const i = Math.max(0, payload.length - 5);
  const original = payload[i];
  const swapped = original === 'A' ? 'B' : 'A';
  parts[0] = payload.slice(0, i) + swapped + payload.slice(i + 1);
  const tamperedUrl = new URL(url);
  tamperedUrl.searchParams.set('token', parts.join(':'));
  return { url: tamperedUrl.href, original: token, tampered: parts.join(':'), changedAt: i };
}

// ---------------------------------------------------------------------------------------------
// Sending an invitation
// ---------------------------------------------------------------------------------------------

// Send one invitation through the real modal stack as the currently signed-in agent, and hand
// back the address plus the inbox baseline taken BEFORE the send.
//
// The baseline is not optional. This mailbox holds every earlier run's mail and the subject is
// shared with the agent invite, so "the newest Join Talentforge" is not a safe way to find this
// one; only "to this alias, newer than this UID" is.
// `allowRefusal` returns the refusal instead of throwing, WITH its response body. Needed because
// the app refuses to invite an address that already has an account (HTTP 422, measured
// 2026-08-27) — a scenario about that refusal must be able to inspect it, while every other caller
// still wants a 4xx to fail loudly rather than silently proceed with no invitation.
async function sendCandidateInvite(page, { email = freshCandidateEmail(), from = 'candidates', allowRefusal = false } = {}) {
  const ob = new CandidateOnboardingPage(page);
  if (from === 'dashboard') await ob.openChooserFromDashboard();
  else await ob.openChooserFromCandidates();
  await ob.chooseMethod('Invite via Email');

  const baseline = await latestUidForRecipient(email).catch(() => 0);

  await ob.inviteEmailInput.fill(email);
  // The field turns each address into a chip on Enter, and Send Invites stays disabled until at
  // least one chip exists - so the button's state is what confirms the address was accepted.
  await ob.inviteEmailInput.press('Enter');
  await page.waitForTimeout(600);
  await ob.sendInvitesButton.waitFor({ state: 'visible', timeout: 15000 });
  if (!(await ob.sendInvitesButton.isEnabled())) {
    throw new Error(`Send Invites stayed disabled after entering ${email}, so it was not accepted as a chip.`);
  }

  // Watch for the send without pinning its path — reported, not asserted, so a renamed endpoint
  // does not fail a scenario about the candidate's journey.
  const responsePromise = page
    .waitForResponse((r) => r.request().method() !== 'GET' && /talentforge/i.test(r.url()), { timeout: 60000 })
    .catch(() => null);
  await ob.sendInvitesButton.click();
  const response = await responsePromise;
  const status = response ? response.status() : null;
  let body = null;
  if (response) body = await response.text().then((t) => t.slice(0, 800)).catch(() => null);

  // The message the AGENT is shown, which is what a refusal has to explain. Collected here rather
  // than in the step so both the API's answer and the UI's are in one place.
  await page.waitForTimeout(3000);
  const uiErrors = await page
    .locator('[role="alert"], .notistack-Snackbar, .MuiAlert-message')
    .evaluateAll((els) => [...new Set(els.map((e) => (e.innerText || '').trim()).filter(Boolean))])
    .catch(() => []);

  const result = { email, baseline, status, body, uiErrors, requestUrl: response ? response.url() : null };
  if (status !== null && status >= 400 && !allowRefusal) {
    throw new Error(
      `The invitation for ${email} was refused with HTTP ${status} (${response.url()}): `
      + `${JSON.stringify(body)}`
    );
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Reading the invitation and resolving its setup link
// ---------------------------------------------------------------------------------------------

// Follow the SendGrid wrapper to the app URL it redirects to.
//
// Deliberately NOT reusing onboardingProvision.resolveVerifyUrl(): that one returns early the
// moment it sees /verify-email, and an invitation lands on /signup instead — so it would follow
// one hop further than intended on some chains. Resolved over HTTP rather than in the browser so
// headless Chromium never stalls on the tracker's interstitial.
async function resolveSetupUrl(startUrl, maxHops = 8) {
  let url = startUrl;
  for (let i = 0; i < maxHops; i++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch {
      return url;
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = loc;
      if (/\/signup\?/i.test(url)) return url;
      continue;
    }
    return url;
  }
  return url;
}

// Wait for the invitation addressed to `email` and return its resolved setup URL and decoded
// token. `afterUid` must be the baseline taken before the send — see sendCandidateInvite.
async function waitForCandidateInvite(email, { afterUid = 0, timeoutMs = 240000 } = {}) {
  if (!email) throw new Error('waitForCandidateInvite needs the invited address — the subject alone matches agent invites too.');
  const { uid, link, parsed } = await waitForEmail('candidateInvite', { to: email, afterUid, timeoutMs });
  if (!link) {
    throw new Error(
      `The invitation for ${email} (uid ${uid}) carried no account-setup link. `
      + `Subject was ${JSON.stringify(parsed && parsed.subject)}.`
    );
  }
  const setupUrl = await resolveSetupUrl(link);
  return { uid, parsed, ctaLink: link, setupUrl, token: decodeInviteToken(setupUrl) };
}

// ---------------------------------------------------------------------------------------------
// Walking the candidate through signup
// ---------------------------------------------------------------------------------------------

// Read back what the setup page has pre-filled, and whether each field is editable. The
// `disabled` flags matter as much as the values: the point of arriving from an invitation is that
// the candidate cannot change who invited them or which address they are claiming.
async function readSetupForm(page) {
  const signup = new SignupPage(page);
  await signup.firstNameInput.waitFor({ state: 'visible', timeout: 45000 });
  const read = async (locator) => locator.evaluate((el) => ({
    value: el.value,
    disabled: el.disabled,
    readonly: el.readOnly,
  }));
  return {
    email: await read(signup.emailInput),
    agentCode: await read(signup.agentCodeInput),
    firstName: await read(signup.firstNameInput),
    lastName: await read(signup.lastNameInput),
    createAccountEnabled: await signup.createAccountButton.isEnabled(),
  };
}

// Complete the create-account form on an OPEN setup page and submit it.
//
// It never touches email or agent code: both are disabled, and `fill()` on a disabled input
// throws — a scenario that tried would fail with a Playwright error about the element instead of
// the assertion it meant to make.
async function completeSignupFromSetupPage(page, { firstName = 'Cand', lastName = 'Tester', password = PASSWORD } = {}) {
  const signup = new SignupPage(page);
  await signup.firstNameInput.fill(firstName);
  await signup.lastNameInput.fill(lastName);
  await signup.passwordInput.fill(password);
  await signup.confirmPasswordInput.fill(password);
  await page.waitForTimeout(400);
  if (!(await signup.createAccountButton.isEnabled())) {
    throw new Error('Create Account stayed disabled with every editable field filled in.');
  }
  await signup.submit();
  await page.waitForURL(/\/email-verification/, { timeout: 60000, waitUntil: 'commit' });
  return { firstName, lastName, password };
}

// Open the "Verify your Talentforge account" link and confirm the app says so.
async function verifyCandidateEmail(page, email, { afterUid = 0, timeoutMs = 180000 } = {}) {
  const { link, parsed } = await waitForEmail('verifyAccount', { to: email, afterUid, timeoutMs });
  if (!link) throw new Error(`The verification email for ${email} carried no link.`);
  const finalUrl = await resolveSetupUrl(link);
  await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
  const signup = new SignupPage(page);
  await signup.verifiedHeading.waitFor({ state: 'visible', timeout: 45000 });
  return { verifyUrl: finalUrl, subject: parsed && parsed.subject };
}

// Sign the candidate in. Lands on /onboarding while their profile is untouched.
async function loginAsCandidate(page, email, password = PASSWORD) {
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(/\/onboarding|\/getting-started|\/dashboard|\/my-track/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  return page.url();
}

// ---------------------------------------------------------------------------------------------
// The fixture-safety rule, as a pure function
// ---------------------------------------------------------------------------------------------

// May an invitation be sent as `current`?
//
// >>> THIS LIVES HERE, SEPARATED FROM THE STEP, SO IT CAN BE EXERCISED IN BOTH DIRECTIONS. <<<
// The step-level guard that preceded it was never tested and did not do its job: on 2026-08-27 a
// real invitation went out as the shared zero-candidate fixture and spent it permanently (a
// candidate cannot be deleted). The repo's own lesson from the community module applies - an
// untested safeguard is one that fails the first time it is needed - so the decision is a pure
// function with no page, no world and no I/O, and `scripts/check-invite-guard.js` runs it through
// every case including the exact one that went wrong.
//
// Allowed only if:
//   * `current` is the throwaway agent the running scenario minted itself, or
//   * `current` is on `allowList` - accounts whose candidate count is not a fixture.
// Everything else is refused, regardless of tags, hooks, or which step is calling.
function isInvitableAgent({ current, throwaway, allowList = [] }) {
  const now = String(current || '').trim().toLowerCase();
  if (!now) return { allowed: false, reason: 'no agent is signed in, so there is nothing to check' };
  const mine = String(throwaway || '').trim().toLowerCase();
  if (mine && now === mine) return { allowed: true, reason: 'this scenario provisioned this agent itself' };
  const allowed = allowList.filter(Boolean).map((e) => String(e).trim().toLowerCase());
  if (allowed.includes(now)) return { allowed: true, reason: 'on the allow-list - its candidate count is not a fixture' };
  return {
    allowed: false,
    reason: 'not a throwaway this scenario minted, and not on the allow-list',
  };
}

module.exports = {
  INBOX,
  PASSWORD,
  isInvitableAgent,
  freshCandidateEmail,
  decodeInviteToken,
  tamperInviteToken,
  sendCandidateInvite,
  resolveSetupUrl,
  waitForCandidateInvite,
  readSetupForm,
  completeSignupFromSetupPage,
  verifyCandidateEmail,
  loginAsCandidate,
};
