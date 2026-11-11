// WHO is actually receiving the promo disabled / resumed / expired mails, and WHEN?
//
//   node scripts/probe-promo-mail-recipients.js [days]
//
// scripts/probe-promo-disabled-mail.js answers "did anything reach THIS address"; this one
// answers the question that decides whether a missing mail is agent-specific or global, by
// listing every recent promo notification with its recipient and date. Without the recipient
// column, a bare count cannot tell "the feature is broken" from "it is broken for one account".
//
// Read-only: it reads the shared IMAP mailbox and sends nothing.
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const SUBJECTS = [
  'Your Talentforge promo code has been disabled',
  'Your Talentforge promo code has been resumed',
  'Your Talentforge promo code has expired',
];

const days = Number(process.argv[2] || 14);

(async () => {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    for (const subject of SUBJECTS) {
      console.log(`\n=== "${subject}" — last ${days} days ===`);
      const uids = await client.search({ header: { subject }, since });
      if (!uids || !uids.length) {
        console.log('  (none in the window)');
        continue;
      }
      const rows = [];
      for await (const msg of client.fetch(uids, { source: true, uid: true })) {
        const parsed = await simpleParser(msg.source);
        // IMAP subject search is a case-insensitive SUBSTRING match, so confirm the exact
        // subject rather than trusting the search - the three wordings overlap.
        if ((parsed.subject || '').trim().toLowerCase() !== subject.toLowerCase()) continue;
        rows.push({
          uid: msg.uid,
          to: (parsed.to && parsed.to.text) || '(no To header)',
          date: parsed.date ? parsed.date.toISOString() : '(no date)',
        });
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const r of rows) console.log(`  uid ${String(r.uid).padEnd(7)} ${r.date}  ->  ${r.to}`);
      console.log(`  total: ${rows.length}`);
      const recipients = [...new Set(rows.map((r) => r.to))];
      console.log('  distinct recipients:', JSON.stringify(recipients, null, 1));
    }
  } finally {
    lock.release();
    await client.logout();
  }
})();
