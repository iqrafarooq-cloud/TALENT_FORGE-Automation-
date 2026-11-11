// probe-candidate-invite-delivery.js - DOES the candidate invitation email get sent, and what is
// in it?
//
// candidate_onboarding_e2e.feature has five scenarios that open "the account setup link from the
// email". Nothing in emailTypes.js registers such a mail, and a sweep of the inbox found none for
// a candidate invited earlier today (the POST answered 200). "The app does not send it" and "it is
// sent under a subject nobody predicted" are completely different findings, so this matches on the
// RECIPIENT rather than on a guessed subject - the same reason waitForEmailMatching() exists for
// the agent templates.
//
// COST: one real candidate invite, sent as AGENT_EMAIL - an agent that already holds 41
// candidates, so its state is not a fixture anything depends on. Deliberately NOT sent as a
// zero-candidate agent, which would spend the welcome-modal fixture.
require('dotenv').config();
const { chromium } = require('playwright');
const { makeClient } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');
const line = console.log;

const INBOX = process.env.MAILBOX_EMAIL || 'iqra.farooq@bytecorp.io';
const [LOCAL, DOMAIN] = INBOX.split('@');
const TAG = `candinv${Date.now().toString(36)}`;
const TARGET = `${LOCAL}+${TAG}@${DOMAIN}`;

async function newestUid() {
  const c = makeClient(); await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  try { const u = await c.search({ since: new Date(Date.now() - 3600e3) }, { uid: true }); return u.length ? Math.max(...u) : 0; }
  finally { lock.release(); await c.logout(); }
}

// Poll for ANY message newer than the baseline addressed to our tag, whatever its subject.
async function waitForAnyMailTo(target, afterUid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  while (Date.now() < deadline) {
    const c = makeClient(); await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = (await c.search({ to: target }, { uid: true })).filter((u) => u > afterUid);
      for (const uid of uids) {
        const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) seen.push({ uid, parsed: await simpleParser(msg.source) });
      }
    } finally { lock.release(); await c.logout(); }
    if (seen.length) return seen;
    line(`   ...nothing yet for ${target} (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  return seen;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on('response', async (r) => {
    if (r.request().method() === 'GET' || !/talentforge/.test(r.url())) return;
    let body = ''; try { body = (await r.text()).slice(0, 600); } catch {}
    requests.push(`${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} -> ${r.status()} ${body}`);
  });
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[name="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });

    const ob = new CandidateOnboardingPage(page);
    await ob.openChooserFromCandidates();
    await ob.chooseMethod('Invite via Email');

    const baseline = await newestUid();
    line(`baseline uid=${baseline}; inviting ${TARGET}`);
    await ob.inviteEmailInput.fill(TARGET);
    await ob.inviteEmailInput.press('Enter');
    await page.waitForTimeout(700);
    line(`Send Invites enabled: ${await ob.sendInvitesButton.isEnabled()}`);
    await ob.sendInvitesButton.click();
    await page.waitForTimeout(5000);

    line('\n=== what the app rendered after sending ===');
    const dlgs = page.locator('[role="dialog"]');
    for (let i = 0; i < await dlgs.count(); i++) {
      const d = dlgs.nth(i);
      if (!(await d.isVisible().catch(() => false))) continue;
      line(`  dialog: ${JSON.stringify((await d.innerText()).replace(/\n+/g, ' | '))}`);
      line(`  HTML: ${(await d.evaluate((e) => e.outerHTML)).slice(0, 2500)}`);
    }
    line('\n=== non-GET responses ===');
    requests.forEach((r) => line('  ' + r));

    line(`\n=== waiting up to 5 min for ANY mail to ${TARGET} ===`);
    const mails = await waitForAnyMailTo(TARGET, baseline, 300000);
    if (!mails.length) {
      line(`\n>>> NO EMAIL AT ALL arrived for ${TARGET}. <<<`);
    }
    for (const { uid, parsed } of mails) {
      line(`\n---- uid=${uid} ${parsed.date && parsed.date.toISOString()}`);
      line(`  subject: ${JSON.stringify(parsed.subject)}`);
      line(`  to: ${JSON.stringify(parsed.to && parsed.to.text)}`);
      line(`  TEXT:\n${(parsed.text || '').slice(0, 2000)}`);
      const links = [...new Set([...(parsed.html || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
      line(`  LINKS (${links.length}):`); links.forEach((l) => line(`    ${l.slice(0, 400)}`));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
