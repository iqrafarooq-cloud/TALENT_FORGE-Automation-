// Read-only: what subjects has TalentForge actually sent, and to whom.
require('dotenv').config();
const { ImapFlow } = require('imapflow');

(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const uids = await client.search({ since }, { uid: true });
    console.log('messages in last 90 days:', uids.length);
    const bySubject = new Map();
    for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
      const env = msg.envelope || {};
      const from = (env.from?.[0]?.address || '').toLowerCase();
      if (!from.includes('talentforge')) continue;
      const subj = (env.subject || '(none)').trim();
      const to = (env.to || []).map((t) => t.address).join(',');
      if (!bySubject.has(subj)) bySubject.set(subj, { n: 0, last: null, tos: new Set() });
      const e = bySubject.get(subj);
      e.n += 1;
      if (!e.last || env.date > e.last) e.last = env.date;
      if (e.tos.size < 4) e.tos.add(to);
    }
    const rows = [...bySubject.entries()].sort((a, b) => b[1].last - a[1].last);
    console.log('\ndistinct TalentForge subjects:', rows.length, '\n');
    for (const [subj, e] of rows) {
      console.log(`[${String(e.n).padStart(4)}] ${e.last.toISOString().slice(0, 10)}  ${subj}`);
      console.log(`        to: ${[...e.tos].join(' | ')}`);
    }
  } finally {
    lock.release();
    await client.logout();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
