// Dev-only, READ-ONLY probe: find which SUBJECT carries a given body phrase.
//
// Three of the Figma agent templates could not be mapped to a subject by searching
// subjects, because the subject the app sends does not resemble the frame title:
//   - "Your Candidate Account Has Been Deactivated" / "...Reactivated" (sent to the AGENT
//     about one of their candidates) appear to reuse the agent's own account subject
//   - "Candidates Have Been Transferred to Your Account"
//   - "Verification Delay Reminder"
// The body is the only thing that distinguishes them, so search on that instead.
//
// IMPORTANT and measured 2026-08-12: IMAP subject search is CASE-INSENSITIVE and a
// SUBSTRING match, so searching "...has been deactivated" also returns
// "...Has Been Deactivated". That is why the exact value is printed from the parsed
// envelope rather than trusted from the search term.
//
// Usage: node scripts/probe-agent-email-by-body.js
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const PHRASES = [
  { label: "candidate's account deactivated (to agent)", body: 'one of your candidates' },
  { label: 'candidates transferred to your account', body: 'have been transferred to your account' },
  { label: 'candidates transferred (alt wording)', body: 'transferred to your account' },
  { label: 'verification delay reminder', body: 'complete your pending verifications' },
  { label: 'verification delay (alt wording)', body: 'pending verifications' },
  { label: 'document review / revision reminder', body: 'document revision requests' },
  { label: 'monthly target reminder', body: 'monthly targets' },
  { label: 'activity reminder', body: 'stay active on your account' },
];

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    for (const p of PHRASES) {
      console.log('\n' + '='.repeat(96));
      console.log(`PHRASE: "${p.body}"   (${p.label})`);
      console.log('='.repeat(96));
      const uids = await client.search({ body: p.body }, { uid: true });
      if (!uids.length) { console.log('  NO MESSAGE IN THE INBOX CONTAINS THIS PHRASE'); continue; }
      console.log(`  ${uids.length} message(s) match`);
      // Group by the subject actually sent, newest first, so one line per distinct subject.
      const bySubject = new Map();
      for await (const msg of client.fetch(uids.sort((a, b) => b - a).slice(0, 40), { envelope: true }, { uid: true })) {
        const env = msg.envelope || {};
        const subj = (env.subject || '(none)').trim();
        if (!bySubject.has(subj)) bySubject.set(subj, { n: 0, last: env.date, uid: msg.uid, to: (env.to || []).map((t) => t.address).join(',') });
        const e = bySubject.get(subj);
        e.n += 1;
        if (env.date > e.last) { e.last = env.date; e.uid = msg.uid; e.to = (env.to || []).map((t) => t.address).join(','); }
      }
      for (const [subj, e] of [...bySubject.entries()].sort((a, b) => b[1].last - a[1].last)) {
        console.log(`  [${String(e.n).padStart(3)}] ${e.last.toISOString().slice(0, 10)}  SUBJECT: ${JSON.stringify(subj)}`);
        console.log(`        to: ${e.to}   uid: ${e.uid}`);
      }
      // Print the newest matching body once, so the real copy is on record.
      const newest = [...bySubject.values()].sort((a, b) => b.last - a.last)[0];
      const msg = await client.fetchOne(String(newest.uid), { source: true }, { uid: true });
      const parsed = await simpleParser(msg.source);
      const text = (parsed.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      console.log('  --- newest body ---');
      console.log(text.split('\n').filter((l) => !/^\[?https?:\/\//.test(l.trim())).map((l) => '    ' + l).join('\n').slice(0, 1800));
    }
  } finally {
    lock.release();
    await client.logout();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
