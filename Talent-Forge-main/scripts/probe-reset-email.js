// Dev-only probe: fetch the most recent "Reset your Talentforge password" email
// for FORGOT_EMAIL and print the reset link(s) found in the body.
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const SUBJECT = 'Reset your Talentforge password';

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ subject: SUBJECT, to: process.env.FORGOT_EMAIL }, { uid: true });
    console.log('matching uids:', uids);
    const uid = uids[uids.length - 1];
    if (!uid) { console.log('no matching email'); return; }
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    const parsed = await simpleParser(msg.source);
    console.log('SUBJECT:', parsed.subject);
    console.log('DATE:', parsed.date);
    console.log('FROM:', parsed.from && parsed.from.text);
    console.log('TO:', parsed.to && parsed.to.text);
    console.log('---- TEXT ----');
    console.log((parsed.text || '').slice(0, 1500));
    console.log('---- LINKS IN HTML ----');
    const html = parsed.html || '';
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    links.forEach((l) => console.log(l));
  } finally {
    lock.release();
  }
  await client.logout();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
