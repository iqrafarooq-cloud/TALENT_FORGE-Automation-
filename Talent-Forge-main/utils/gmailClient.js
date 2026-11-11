// gmailClient.js — thin IMAP helper over imapflow for reading TalentForge
// transactional emails during tests.
//
// Auth uses a Gmail/Workspace *App Password* (GMAIL_APP_PASSWORD), not the normal
// account password. Spaces in the app password are stripped so the value can be
// pasted from Google's UI verbatim.
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { EMAIL_TYPES } = require('./emailTypes');

function makeClient() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) {
    throw new Error('Missing GMAIL_USER / GMAIL_APP_PASSWORD in .env');
  }
  return new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Highest UID currently matching (subject, to). Used to establish a baseline
// *before* triggering a new email, so we can wait for a strictly newer one and
// never pick up a stale message from a previous run.
async function latestUid({ subject, to }) {
  const client = makeClient();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ subject, to }, { uid: true });
    return uids.length ? Math.max(...uids) : 0;
  } finally {
    lock.release();
    await client.logout();
  }
}

// Poll INBOX until a message matching (subject, to) with UID > afterUid arrives,
// then parse it and run the type's extractor. Returns { uid, link, parsed }.
//
// `originalTo` narrows the match to ONE alias on an anonaddy inbox. anonaddy strips the +alias
// from To on delivery, so concurrent signups' mails are identical to a (subject, to) search and
// the newest may belong to somebody else - measured 2026-10-07: four verification mails in two
// minutes, and the wrong one answered "This verification link is invalid or expired". anonaddy
// keeps the real alias in X-AnonAddy-Original-To, which is what tells them apart.
async function waitForEmail(type, {
  to, afterUid = 0, timeoutMs = 90000, pollMs = 5000, originalTo = null,
} = {}) {
  const def = EMAIL_TYPES[type];
  if (!def) throw new Error(`Unknown email type: ${type}`);
  const recipient = to || process.env.FORGOT_EMAIL;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const client = makeClient();
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ subject: def.subject, to: recipient }, { uid: true });
      const fresh = uids.filter((u) => u > afterUid).sort((a, b) => b - a);
      for (const uid of fresh) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const parsed = await simpleParser(msg.source);
        if (originalTo) {
          const header = String(parsed.headers.get('x-anonaddy-original-to') || '').toLowerCase();
          if (!header.includes(originalTo.toLowerCase())) continue;
        }
        const link = def.extract(parsed);
        return { uid, link, parsed };
      }
    } finally {
      lock.release();
      await client.logout();
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for "${def.subject}" to ${recipient}`);
}

// Highest UID currently addressed to `to`, regardless of subject. The subject-scoped
// latestUid() above cannot baseline a mail whose subject is unknown, which is exactly the
// case waitForEmailMatching() covers.
async function latestUidForRecipient(to) {
  const client = makeClient();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ to }, { uid: true });
    return uids.length ? Math.max(...uids) : 0;
  } finally {
    lock.release();
    await client.logout();
  }
}

// Wait for a message to `to` whose BODY contains `bodyIncludes`, whatever its subject.
//
// WHY THIS EXISTS, and why it is not just a looser waitForEmail. Five of the Figma agent
// templates have never been sent, so there is no subject to search on. Searching a GUESSED
// subject can only ever answer "nothing arrived" - which cannot distinguish "the app does not
// send this mail" from "the app sends it under a subject nobody predicted", and those are
// completely different findings to hand to dev. Matching on the body reports whichever subject
// the message really carries.
//
// It returns `{ found: false, ... }` on timeout rather than throwing, because for these
// templates "no mail" is the expected measurement, not an error - the caller decides whether
// that is a failure. `scanned` is reported so a run that found nothing can be told apart from a
// run that never looked (an `afterUid` baseline taken against the wrong address would silently
// filter everything out).
//
// The filter is applied client-side over messages newer than the baseline rather than via IMAP
// BODY search, because Gmail's BODY search does not reliably match text inside quoted-printable
// HTML parts - the probe that mapped these templates hit exactly that.
async function waitForEmailMatching({
  to, bodyIncludes, afterUid = 0, timeoutMs = 120000, pollMs = 8000,
} = {}) {
  if (!to) throw new Error('waitForEmailMatching needs a recipient');
  if (!bodyIncludes) throw new Error('waitForEmailMatching needs a bodyIncludes phrase');
  const needle = String(bodyIncludes).toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let scanned = 0;
  const subjectsSeen = [];

  while (Date.now() < deadline) {
    const client = makeClient();
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = (await client.search({ to }, { uid: true })).filter((u) => u > afterUid);
      for (const uid of uids.sort((a, b) => b - a)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const parsed = await simpleParser(msg.source);
        scanned += 1;
        const subject = parsed.subject || '(no subject)';
        if (!subjectsSeen.includes(subject)) subjectsSeen.push(subject);
        const body = `${parsed.text || ''}\n${parsed.html || ''}`.toLowerCase();
        if (body.includes(needle)) {
          return { found: true, uid, subject, parsed, scanned, subjectsSeen };
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  return { found: false, uid: null, subject: null, parsed: null, scanned, subjectsSeen };
}

module.exports = {
  makeClient, latestUid, latestUidForRecipient, waitForEmail, waitForEmailMatching,
};
