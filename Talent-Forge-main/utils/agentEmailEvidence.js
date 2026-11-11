// agentEmailEvidence.js - one reader for every agent notification email.
//
// WHAT THIS IS FOR. The agent email scenarios each commit a real action and then read the mail
// it produced. Without a shared reader, each scenario would grow its own ad-hoc string checks
// and the report would say "the email was wrong" without saying which part. Worse, the two
// failures that matter most would be indistinguishable: a mail that never arrived and a mail
// that arrived saying the wrong thing are the same red row if all you assert is a body match.
//
// SO EVERY ASSERTION IS CATEGORISED, and the step decides which categories are fatal:
//
//   delivery      the mail arrived at all, from the right sender, to the right agent
//   identity      the exact subject the app SENT (not the search key that found it)
//   content       the load-bearing facts - the greeting names the agent, the promised link is
//                 present, an interpolated number is right
//   figmaCopy     wording that differs from the Figma template
//
// `figmaCopy` is collected but NOT failed on, per the decision recorded in
// AGENT_EMAIL_FIGMA_VS_APP.md: the app says "Talentforge" where Figma says "Talent Forge", and
// failing every mail on that would make the whole suite red on a branding disagreement and bury
// the findings that matter. The divergences are attached to the report instead, so the PO gets
// them without the run losing its signal.
//
// THE SUBJECT TRAP THIS MODULE EXISTS TO CLOSE. IMAP subject search is case-insensitive and a
// substring match (measured 2026-08-12: searching "...has been deactivated" returns the 27
// messages the app sent as "...Has Been Deactivated" too). So a scenario that only searched
// would report a clean pass on a mail whose subject is wrong. `expectSubject` compares against
// `parsed.subject` - the value as sent - which is the only way that defect is visible.

const { waitForEmail, waitForEmailMatching, latestUid, latestUidForRecipient } = require('./gmailClient');
const { EMAIL_TYPES, AGENT_TEMPLATES_NOT_SENT } = require('./emailTypes');

// Strip the SendGrid tracking URLs and the S3 asset links out of a body before it is read for
// copy. They are long, they change per message, and left in they make every "does the body say
// X" check noisy and every attached body unreadable in the report.
function readableBody(parsed) {
  const raw = `${(parsed && parsed.text) || ''}`;
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^\s*\[?https?:\/\//.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Everything a scenario might want to assert about one delivered mail, gathered once.
//
// Takes the baseline the caller recorded BEFORE the triggering action. That baseline is
// mandatory, not optional: these are long-lived inboxes holding every previous run's mail, so
// "a message with this subject exists" proves nothing. Only "a message newer than UID N" does.
async function captureAgentEmail(type, { to, afterUid = 0, timeoutMs = 180000 } = {}) {
  const def = EMAIL_TYPES[type];
  if (!def) throw new Error(`captureAgentEmail: unknown email type "${type}"`);
  if (!to) throw new Error(`captureAgentEmail: no recipient given for "${type}"`);

  let result;
  try {
    result = await waitForEmail(type, { to, afterUid, timeoutMs, pollMs: 6000 });
  } catch (error) {
    // A timeout is a MEASUREMENT here, not a crash - several of these templates are expected
    // never to arrive. Return it as one so the step can report it in the same shape as a
    // delivered mail, and say plainly what it waited for.
    return {
      delivered: false,
      type,
      searchedSubject: def.subject,
      recipient: to,
      afterUid,
      waitedMs: timeoutMs,
      failure: error.message,
      problems: {
        delivery: [
          `no "${def.subject}" email reached ${to} within ${Math.round(timeoutMs / 1000)}s `
          + `(waiting for a message newer than UID ${afterUid})`,
        ],
        identity: [], content: [], figmaCopy: [],
      },
    };
  }

  const parsed = result.parsed || {};
  const body = readableBody(parsed);
  return {
    delivered: true,
    type,
    uid: result.uid,
    searchedSubject: def.subject,
    // The subject AS SENT. Compare against this, never against searchedSubject.
    actualSubject: (parsed.subject || '').trim(),
    from: (parsed.from && parsed.from.text) || '',
    to: (parsed.to && parsed.to.text) || '',
    recipient: to,
    date: parsed.date || null,
    body,
    html: parsed.html || '',
    // Whatever the type's extractor pulls out - a verify link, a promo code, a password, or
    // null for the notifications that carry none.
    extracted: result.link || null,
    problems: { delivery: [], identity: [], content: [], figmaCopy: [] },
  };
}

// The reader for the five templates with no known subject. Same shape as captureAgentEmail so a
// step can treat both alike, but it searches the BODY and reports whichever subject it lands on.
async function captureAgentEmailByBody(templateKey, { to, afterUid = 0, timeoutMs = 120000 } = {}) {
  const def = AGENT_TEMPLATES_NOT_SENT[templateKey];
  if (!def) throw new Error(`captureAgentEmailByBody: unknown template "${templateKey}"`);
  if (!to) throw new Error(`captureAgentEmailByBody: no recipient given for "${templateKey}"`);

  const hit = await waitForEmailMatching({ to, bodyIncludes: def.bodyIncludes, afterUid, timeoutMs });
  if (!hit.found) {
    return {
      delivered: false,
      templateKey,
      figmaTitle: def.figmaTitle,
      bodyIncludes: def.bodyIncludes,
      recipient: to,
      afterUid,
      scanned: hit.scanned,
      subjectsSeen: hit.subjectsSeen,
      problems: {
        delivery: [
          `the "${def.figmaTitle}" email never arrived. Waited `
          + `${Math.round(timeoutMs / 1000)}s for a message to ${to} newer than UID ${afterUid} `
          + `whose body contains "${def.bodyIncludes}"; read ${hit.scanned} message(s) and saw `
          + `subjects ${JSON.stringify(hit.subjectsSeen)}. Searching the BODY rather than a `
          + 'guessed subject is deliberate, so this result means the app did not send this mail '
          + 'at all - not merely that it used an unexpected subject line.',
        ],
        identity: [], content: [], figmaCopy: [],
      },
    };
  }
  return {
    delivered: true,
    templateKey,
    figmaTitle: def.figmaTitle,
    uid: hit.uid,
    actualSubject: (hit.subject || '').trim(),
    recipient: to,
    body: readableBody(hit.parsed),
    from: (hit.parsed.from && hit.parsed.from.text) || '',
    to: (hit.parsed.to && hit.parsed.to.text) || '',
    problems: { delivery: [], identity: [], content: [], figmaCopy: [] },
  };
}

// ==================== The assertions, as accumulating checks ====================
//
// Each records into `evidence.problems` and returns the evidence, so a step can chain several
// and then fail ONCE with everything it found. Cucumber abandons a scenario at its first failing
// step, so a step that stops at its first wrong field hides every other wrong field in the same
// mail - and for an email template, "which parts are wrong" is the entire finding.

function expectSender(evidence, expected = 'noreply@talentforge.com.sa') {
  if (!evidence.delivered) return evidence;
  if (!evidence.from.toLowerCase().includes(expected.toLowerCase())) {
    evidence.problems.delivery.push(`sender should be ${expected} but was "${evidence.from}"`);
  }
  return evidence;
}

// The exact subject the app sent. See the note at the top of this file: the search that found
// the mail is case-insensitive and substring-based, so this is the only check that can see a
// wrong subject at all.
function expectSubject(evidence, expected) {
  if (!evidence.delivered) return evidence;
  if (evidence.actualSubject !== expected) {
    evidence.problems.identity.push(
      `subject should be exactly "${expected}" but the app sent "${evidence.actualSubject}"`
      + (evidence.actualSubject.toLowerCase() === String(expected).toLowerCase()
        ? ' - the two differ only in CASING, which the IMAP search cannot see'
        : '')
    );
  }
  return evidence;
}

// The greeting has to name the recipient. This is not cosmetic: the live
// "Verify your new Talentforge email address" mail greets "Hi ," with the name missing
// entirely, and a body-contains check for any other sentence passes straight over it.
function expectGreetsRecipient(evidence, name) {
  if (!evidence.delivered) return evidence;
  const greeting = (evidence.body.match(/^\s*Hi\b[^\n]*/im) || [''])[0].trim();
  if (!greeting) {
    evidence.problems.content.push('the body has no "Hi <name>" greeting at all');
    return evidence;
  }
  // Match on the first name only. The app renders the full name on some templates and just the
  // first on others, and pinning the whole string would fail on that difference rather than on
  // the defect this check exists for (an EMPTY name).
  const first = String(name || '').trim().split(/\s+/)[0];
  if (!first) return evidence;
  if (!greeting.toLowerCase().includes(first.toLowerCase())) {
    evidence.problems.content.push(
      `the greeting should name the agent ("${first}") but reads "${greeting}"`
      + (/^hi\s*[,.]?\s*$/i.test(greeting) ? ' - the name is missing entirely' : '')
    );
  }
  return evidence;
}

// A phrase the mail must carry to be the mail we think it is. Compared with whitespace
// collapsed, because the plaintext part hard-wraps at ~76 characters and a phrase spanning a
// line break would otherwise never match.
function expectBodyStates(evidence, phrase, { label = 'body' } = {}) {
  if (!evidence.delivered) return evidence;
  const flat = evidence.body.replace(/\s+/g, ' ').toLowerCase();
  if (!flat.includes(String(phrase).replace(/\s+/g, ' ').toLowerCase())) {
    evidence.problems.content.push(`the ${label} should state "${phrase}" but does not`);
  }
  return evidence;
}

function expectCta(evidence, label) {
  if (!evidence.delivered) return evidence;
  const flat = `${evidence.body}\n${evidence.html}`.replace(/\s+/g, ' ');
  if (!new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(flat)) {
    evidence.problems.content.push(`the "${label}" CTA is missing from the email`);
  }
  return evidence;
}

// An actionable link must be present AND be a real URL. Reported under `content` because a
// verification mail with no link is a broken mail, not a wording difference.
function expectActionableLink(evidence, { label = 'link' } = {}) {
  if (!evidence.delivered) return evidence;
  if (!evidence.extracted) {
    evidence.problems.content.push(
      `the email carries no ${label} - its extractor found nothing to act on`
    );
    return evidence;
  }
  if (!/^https?:\/\//i.test(evidence.extracted)) {
    evidence.problems.content.push(
      `the ${label} is not a URL: ${JSON.stringify(evidence.extracted)}`
    );
  }
  return evidence;
}

// Figma wording, recorded and NOT failed on. `expected` is the Figma sentence; if the mail says
// something different, the difference goes to figmaCopy for the report.
function noteFigmaCopy(evidence, expected, { note = '' } = {}) {
  if (!evidence.delivered) return evidence;
  const flat = evidence.body.replace(/\s+/g, ' ').toLowerCase();
  const want = String(expected).replace(/\s+/g, ' ').toLowerCase();
  if (!flat.includes(want)) {
    evidence.problems.figmaCopy.push(
      `Figma says "${expected}"; the app does not send that wording${note ? ` (${note})` : ''}`
    );
  }
  return evidence;
}

// ==================== Reporting ====================

// The fatal problems, in the order a reader needs them.
//
// ORDER IS LOAD-BEARING. Delivery first, then identity, then content: if the mail never
// arrived, "the greeting is wrong" is noise, and a reader who sees it first goes looking for a
// copy bug instead of a missing email. figmaCopy is never fatal.
function fatalProblems(evidence) {
  const { delivery, identity, content } = evidence.problems;
  return [...delivery, ...identity, ...content];
}

// A human-readable dump of one mail for the Cucumber report. Attached whether or not the
// scenario passed: on a red row it is the evidence, and on a green one it is the record of what
// the app actually sent on the day the run passed.
function describeEvidence(evidence) {
  const lines = [];
  const title = evidence.type || evidence.templateKey || 'email';
  lines.push(`=== ${title} ===`);
  lines.push(`recipient searched : ${evidence.recipient}`);
  if (evidence.searchedSubject) lines.push(`subject searched   : ${evidence.searchedSubject}`);
  if (evidence.bodyIncludes) lines.push(`body phrase        : "${evidence.bodyIncludes}"`);
  lines.push(`delivered          : ${evidence.delivered ? 'YES' : 'NO'}`);
  if (evidence.delivered) {
    lines.push(`subject AS SENT    : ${JSON.stringify(evidence.actualSubject)}`);
    lines.push(`from               : ${evidence.from}`);
    lines.push(`to                 : ${evidence.to}`);
    if (evidence.date) lines.push(`date               : ${evidence.date.toISOString()}`);
    if (evidence.extracted) lines.push(`extracted          : ${evidence.extracted}`);
    lines.push('--- body ---');
    lines.push(evidence.body);
  } else {
    if (evidence.subjectsSeen && evidence.subjectsSeen.length) {
      lines.push(`subjects seen      : ${JSON.stringify(evidence.subjectsSeen)}`);
    }
    if (evidence.failure) lines.push(`wait failed        : ${evidence.failure}`);
  }
  const fatal = fatalProblems(evidence);
  if (fatal.length) {
    lines.push('--- problems (fatal) ---');
    fatal.forEach((p) => lines.push(`  * ${p}`));
  }
  if (evidence.problems.figmaCopy.length) {
    lines.push('--- Figma copy divergence (recorded, not failed) ---');
    evidence.problems.figmaCopy.forEach((p) => lines.push(`  * ${p}`));
  }
  return lines.join('\n');
}

module.exports = {
  captureAgentEmail,
  captureAgentEmailByBody,
  expectSender,
  expectSubject,
  expectGreetsRecipient,
  expectBodyStates,
  expectCta,
  expectActionableLink,
  noteFigmaCopy,
  fatalProblems,
  describeEvidence,
  readableBody,
  latestUid,
  latestUidForRecipient,
};
