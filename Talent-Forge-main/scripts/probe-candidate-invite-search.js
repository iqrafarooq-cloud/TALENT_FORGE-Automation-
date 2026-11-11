// Find the candidate invitation email by searching the inbox for likely subjects and for the
// alias of a candidate we know was invited. Read-only.
require('dotenv').config();
const { makeClient } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const line = console.log;

const TERMS = ['invit', 'onboard', 'set up your account', 'account setup', 'join', 'welcome to talent'];

(async () => {
  const client = makeClient();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    for (const term of TERMS) {
      const uids = await client.search({ since, subject: term }, { uid: true });
      line(`\n### subject contains ${JSON.stringify(term)}: ${uids.length} message(s)`);
      for (const uid of uids.sort((a, b) => b - a).slice(0, 4)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const p = await simpleParser(msg.source);
        line(`  uid=${uid} ${p.date && p.date.toISOString()} to=${JSON.stringify(p.to && p.to.text)}`);
        line(`    subject: ${JSON.stringify(p.subject)}`);
      }
    }
    // And the specific candidate the last run invited.
    const byText = await client.search({ since, body: 'welcomemtbbgzwj1' }, { uid: true });
    line(`\n### body mentions the alias invited on 2026-08-27: ${byText.length}`);
    for (const uid of byText.slice(-3)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      const p = await simpleParser(msg.source);
      line(`\n  uid=${uid} subject=${JSON.stringify(p.subject)} to=${JSON.stringify(p.to && p.to.text)}`);
      line(`  TEXT:\n${(p.text || '').slice(0, 1500)}`);
      const links = [...new Set([...(p.html || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
      line(`  LINKS:`); links.forEach((l) => line(`    ${l.slice(0, 300)}`));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { lock.release(); await client.logout(); }
})();
