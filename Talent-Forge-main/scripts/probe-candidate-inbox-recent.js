// The newest messages in the mailbox, unfiltered, so "the candidate invitation email never
// arrived" can be told apart from "my search missed it". Read-only.
require('dotenv').config();
const { makeClient } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const line = console.log;

(async () => {
  const client = makeClient();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const uids = await client.search({ since }, { uid: true });
    line(`messages in the last 48h (ALL recipients): ${uids.length}`);
    for (const uid of uids.sort((a, b) => b - a).slice(0, 30)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const p = await simpleParser(msg.source);
      line(`  ${p.date && p.date.toISOString()}  to=${String(p.to && p.to.text).slice(0, 52).padEnd(52)}  ${JSON.stringify((p.subject || '').slice(0, 60))}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { lock.release(); await client.logout(); }
})();
