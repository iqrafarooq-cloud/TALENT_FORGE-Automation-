// Dev-only probe: verify IMAP login works and dump recent message subjects/senders.
// Usage: node scripts/probe-imap.js
require('dotenv').config();
const { ImapFlow } = require('imapflow');

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    },
    logger: false,
  });

  await client.connect();
  console.log('IMAP connected as', process.env.GMAIL_USER);

  const lock = await client.getMailboxLock('INBOX');
  try {
    const total = client.mailbox.exists;
    console.log('INBOX total messages:', total);
    const start = Math.max(1, total - 9);
    for await (const msg of client.fetch(`${start}:*`, { envelope: true })) {
      const env = msg.envelope || {};
      const from = (env.from && env.from[0] && env.from[0].address) || '?';
      const to = (env.to && env.to.map((t) => t.address).join(',')) || '?';
      console.log(`#${msg.seq} | ${env.date ? env.date.toISOString() : '?'} | from=${from} | to=${to} | subj=${env.subject}`);
    }
  } finally {
    lock.release();
  }
  await client.logout();
  console.log('done');
})().catch((e) => {
  console.error('IMAP PROBE ERROR:', e.message);
  process.exit(1);
});
