// probe-promo-disabled-mail.js — READ ONLY. Did the "promo disabled/resumed" mail reach the
// limited promo agent at all, and under what subject?
//
//   node scripts/probe-promo-disabled-mail.js [alias] [hours]
//
// The scenario waits on a SUBJECT, and a subject wait can only ever answer "nothing arrived" —
// which cannot distinguish "the app does not send this mail" from "it sends it under a subject
// nobody predicted". Same reasoning as waitForEmailMatching() in the agent-email module. So this
// lists EVERY message to that recipient in the window, whatever its subject, alongside every
// promo-shaped subject the whole mailbox has seen.
require('dotenv').config();
const { ImapFlow } = require('imapflow');

const ALIAS = (process.argv[2] || process.env.PROMO_LIMITED_AGENT_EMAIL || '').toLowerCase();
const HOURS = Number(process.argv[3] || 6);

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - HOURS * 3600 * 1000);
    const uids = await client.search({ since }, { uid: true });
    console.log(`\n=== every message in the last ${HOURS}h: ${uids.length} ===`);
    console.log(`=== addressed to ${ALIAS} ===`);
    let hits = 0;
    for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
      const env = msg.envelope || {};
      const to = (env.to || []).map((t) => (t.address || '').toLowerCase()).join(',');
      if (!to.includes(ALIAS)) continue;
      hits += 1;
      console.log(`  uid=${msg.uid}  ${env.date && env.date.toISOString()}  from=${env.from?.[0]?.address}`);
      console.log(`      subject: ${JSON.stringify((env.subject || '').trim())}`);
    }
    if (!hits) console.log('  (NOTHING AT ALL reached that address in the window)');

    // Every promo-shaped subject the mailbox has ever seen, so a renamed subject is visible.
    const since90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const all = await client.search({ since: since90 }, { uid: true });
    const seen = new Map();
    for await (const msg of client.fetch(all, { envelope: true }, { uid: true })) {
      const env = msg.envelope || {};
      const subj = (env.subject || '').trim();
      if (!/promo/i.test(subj)) continue;
      const e = seen.get(subj) || { n: 0, last: null };
      e.n += 1;
      if (!e.last || env.date > e.last) e.last = env.date;
      seen.set(subj, e);
    }
    console.log('\n=== every promo-shaped subject in the last 90 days ===');
    if (!seen.size) console.log('  (none)');
    [...seen.entries()].sort((a, b) => b[1].last - a[1].last).forEach(([s, e]) => {
      console.log(`  ${String(e.n).padStart(3)}x  last ${e.last && e.last.toISOString()}  ${JSON.stringify(s)}`);
    });
  } finally {
    lock.release();
    await client.logout();
  }
})();
