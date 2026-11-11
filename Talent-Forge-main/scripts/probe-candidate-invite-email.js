// probe-candidate-invite-email.js - what does the CANDIDATE invitation email actually contain,
// and where does its account-setup link go?
//
// candidate_onboarding_e2e.feature turns entirely on this: five scenarios open "the account setup
// link from the email" and expect the signup page to arrive with the email and agent code
// pre-filled. None of that is registered in emailTypes.js, so it has to be measured.
//
// Read-only: sweeps the inbox. Sends nothing, invites nobody.
require('dotenv').config();
const { makeClient } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const line = console.log;

(async () => {
  const client = makeClient();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    // Every message to the candidates inbox, so the invite's real subject is discovered rather
    // than guessed - the same reason probe-talentforge-subjects.js exists for agent mail.
    const uids = await client.search({ since, to: 'candidates@iqra.anonaddy.com' }, { uid: true });
    line(`messages to candidates@iqra.anonaddy.com in the last 30 days: ${uids.length}`);

    const subjects = new Map();
    const recent = uids.sort((a, b) => b - a).slice(0, 60);
    const invites = [];
    for (const uid of recent) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const p = await simpleParser(msg.source);
      const subj = (p.subject || '').trim();
      subjects.set(subj, (subjects.get(subj) || 0) + 1);
      if (/invit|onboard|welcome|set ?up|join/i.test(subj)) invites.push({ uid, p });
    }
    line('\n=== distinct subjects (newest 60) ===');
    for (const [s, n] of [...subjects.entries()].sort((a, b) => b[1] - a[1])) line(`  ${n}x  ${JSON.stringify(s)}`);

    line(`\n=== invitation-looking messages: ${invites.length} ===`);
    for (const { uid, p } of invites.slice(0, 3)) {
      line(`\n---- uid=${uid} date=${p.date && p.date.toISOString()}`);
      line(`  subject: ${JSON.stringify(p.subject)}`);
      line(`  to:      ${JSON.stringify(p.to && p.to.text)}`);
      line(`  from:    ${JSON.stringify(p.from && p.from.text)}`);
      const text = (p.text || '').replace(/\n{3,}/g, '\n\n');
      line(`  TEXT BODY:\n${text.slice(0, 1800)}`);
      const html = p.html || '';
      const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
      line(`  LINKS (${links.length}):`);
      links.forEach((l) => line(`    ${l.slice(0, 300)}`));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { lock.release(); await client.logout(); }
})();
