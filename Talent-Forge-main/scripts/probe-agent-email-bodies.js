// Dev-only, READ-ONLY probe: for each subject the agent-notification suite needs to
// recognise, pull the most recent real messages and print recipient + plaintext body.
//
// Why this exists: the Figma frame titles are NOT the subject lines the app sends, and
// several subjects arrive in two variants that differ only in CASING or wording
// ("...has been deactivated" vs "...Has Been Deactivated"). Those variants are almost
// certainly two different code paths - the agent's own account vs one of their
// candidates' - and the only way to tell which is which is to read the body. Registering
// a guessed subject in emailTypes.js would make waitForEmail() time out on a mail that
// arrived perfectly well.
//
// Usage: node scripts/probe-agent-email-bodies.js [n]      (n = messages per subject, default 2)
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const SUBJECTS = [
  // The email-change pair - two wordings each, need the current one.
  'Your Talentforge account email was changed',
  'Your Talentforge account email has been updated',
  'Verify your new Talentforge email address',
  'Confirm your new Talentforge email address',
  // Deactivate / reactivate - casing variants, agent's own account vs their candidate's.
  'Your Talentforge account has been deactivated',
  'Your Talentforge account Has Been Deactivated',
  'Your Talentforge account has been reactivated',
  'Your Talentforge account Has Been Reactivated',
  // The reminder family.
  'Reminder: Monthly target progress',
  'Subject: Monthly target delay reminder',
  'Reminder: Log back into Talentforge',
  'Subject: Document Revision Pending',
  // Already-known good, included as a control so a broken reader is obvious.
  'Your Talentforge promo code has expired',
];

const PER = Number(process.argv[2] || 2);

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    for (const subject of SUBJECTS) {
      console.log('\n' + '='.repeat(100));
      console.log('SUBJECT SEARCHED:', subject);
      console.log('='.repeat(100));
      const uids = await client.search({ subject }, { uid: true });
      if (!uids.length) { console.log('  (no messages)'); continue; }
      const newest = uids.sort((a, b) => b - a).slice(0, PER);
      console.log(`  ${uids.length} total; showing ${newest.length} newest\n`);
      for (const uid of newest) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const p = await simpleParser(msg.source);
        // The exact subject as SENT - IMAP subject search is a substring match, so a hit
        // on "...has been deactivated" can actually be "...Has Been Deactivated".
        console.log(`  --- uid ${uid} | ${p.date && p.date.toISOString()} ---`);
        console.log(`  ACTUAL SUBJECT: ${JSON.stringify(p.subject)}`);
        console.log(`  TO            : ${p.to && p.to.text}`);
        console.log(`  FROM          : ${p.from && p.from.text}`);
        const text = (p.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
        console.log('  BODY:');
        console.log(text.split('\n').map((l) => '    ' + l).join('\n').slice(0, 2600));
        console.log('');
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
