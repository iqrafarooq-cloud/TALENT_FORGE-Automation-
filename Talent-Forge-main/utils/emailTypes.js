// emailTypes.js — single registry of the transactional emails the suite reads.
// Each entry: subject line (as sent by TalentForge) + an extractor that pulls the
// actionable value (link / code) out of the parsed message.
//
// To support a new email, add one entry here — gmailClient stays generic.

// Prefer the direct app link from the plaintext body over SendGrid click-tracking
// wrappers (http://url*.talentforge.com.sa/ls/click?...), which only redirect.
function extractResetLink(parsed) {
  const haystacks = [parsed.text || '', parsed.html || ''];
  for (const body of haystacks) {
    const m = body.match(/https?:\/\/[^\s"'<>()[\]]*\/reset-password\?[^\s"'<>()[\]]+/i);
    if (m) return m[0].replace(/&amp;/g, '&');
  }
  return null;
}

// The "Verify your Talentforge account" email does NOT carry a direct
// /verify-email app link in its body — the only actionable URL is the SendGrid
// click-tracking wrapper (http://url*.talentforge.com.sa/ls/click?...). Following
// that redirect lands on https://<app>/verify-email?uid=&token=, which completes
// verification. So we return the /ls/click CTA and let Playwright follow it.
// The /wf/open?... URL is an open-tracking pixel — explicitly skip it.
function extractVerifyLink(parsed) {
  const haystacks = [parsed.text || '', parsed.html || ''];
  for (const body of haystacks) {
    const m = body.match(/https?:\/\/[^\s"'<>()[\]]*\/ls\/click\?[^\s"'<>()[\]]+/i);
    if (m) return m[0].replace(/&amp;/g, '&');
  }
  return null;
}

// The CANDIDATE-invitation mail ("Join Talentforge" - the same subject the agent one uses, see
// the registry entry) carries no direct app link in its body either: the "Set up my account" CTA
// is a SendGrid click-tracking wrapper that 302s to
// https://<app>/signup?token=<base64 payload>:<sig>:<sig>. So return the /ls/click CTA and let the
// caller follow it, exactly as extractVerifyLink does. The /wf/open?... URL is an open-tracking
// pixel and is explicitly excluded - it is also an /ls/-free talentforge.com.sa URL, so a looser
// pattern picks it up and lands on a blank tracker instead of the signup form.
function extractSetupLink(parsed) {
  const haystacks = [parsed.text || '', parsed.html || ''];
  for (const body of haystacks) {
    const m = body.match(/https?:\/\/[^\s"'<>()[\]]*\/ls\/click\?[^\s"'<>()[\]]+/i);
    if (m) return m[0].replace(/&amp;/g, '&');
  }
  return null;
}

// The agent-invitation mail ("Join Talentforge") hands the account over in the body
// rather than through a link: it prints the address and a system-generated temporary
// password, and the CTA ("Go to agent portal") is only a SendGrid click-tracking wrapper
// to the login page. Verified against a real message on 2026-07-30:
//
//   Here are your login details:
//   Email: iqra.farooq+refagent@bytecorp.io
//   Temporary Password: 8vVivMgugB
//
// So the extractor returns the PASSWORD, not a link — `waitForEmail` exposes it as
// `link`, and the steps read `tempPassword` off the result instead.
function extractTempPassword(parsed) {
  const haystacks = [parsed.text || '', parsed.html || ''];
  for (const body of haystacks) {
    // Stop at whitespace or an HTML boundary so a password never picks up markup.
    const m = body.match(/Temporary\s*Password:\s*([^\s<&]+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

// The promo-code state mails carry no link and no credential — the assertable content is
// the message itself, plus (on "resumed" only) the promo code. Captured from real messages
// on 2026-07-30 by disabling and re-enabling CODEHFA8X3Y on the superadmin portal:
//
//   disabled: "This is to inform you that your promo code has been disabled by the super
//              admin and is no longer available for use."   -- code NOT included
//   resumed:  "...your promo code has been resumed and is now active again."
//              Promo Code:
//              CODEHFA8X3Y                                   -- code included
//
// So the extractor returns the code when the mail prints one and null otherwise; the steps
// assert on `parsed.text` for the wording either way.
function extractPromoCode(parsed) {
  const haystacks = [parsed.text || '', parsed.html || ''];
  for (const body of haystacks) {
    const m = body.match(/Promo\s*Code:\s*\n?\s*([A-Z0-9-]{4,})/i);
    if (m) return m[1].trim();
  }
  return null;
}

// The agent email-change flow sends the NEW address a verification link. Like the candidate
// verify mail, the only actionable URL is the SendGrid click wrapper - measured 2026-08-12 on
// a real message (uid 19703): the body carries "Verify Email Address" over an
// http://url4829.talentforge.com.sa/ls/click?... target, and no direct app link at all. The
// /wf/open?... URL in the same body is an open-tracking pixel, so it is excluded exactly as
// extractVerifyLink does.
const extractNewEmailVerifyLink = extractVerifyLink;

// Several agent notifications carry no link and no credential - the assertable content is the
// wording itself, which the steps read off `parsed.text`. Returning null rather than throwing
// keeps waitForEmail's contract uniform: every type has an extractor, and `link` is simply
// null for the ones with nothing to extract.
function extractNothing() {
  return null;
}

const EMAIL_TYPES = {
  resetPassword: {
    subject: 'Reset your Talentforge password',
    from: 'noreply@talentforge.com.sa',
    extract: extractResetLink,
  },
  verifyAccount: {
    subject: 'Verify your Talentforge account',
    from: 'noreply@talentforge.com.sa',
    extract: extractVerifyLink,
  },
  agentInvite: {
    subject: 'Join Talentforge',
    from: 'noreply@talentforge.com.sa',
    extract: extractTempPassword,
  },
  // >>> THE CANDIDATE INVITATION SHARES THE AGENT INVITATION'S EXACT SUBJECT. <<< Both are sent
  // as "Join Talentforge" (measured 2026-08-27), and IMAP subject search is a case-insensitive
  // SUBSTRING match, so a search on the subject alone returns BOTH kinds of mail. The two bodies
  // are nothing alike - the agent's hands over a temporary password, the candidate's carries a
  // "Set up my account" link - so an extractor run against the wrong one silently returns null,
  // which reads as "the mail never arrived".
  //
  // The ONLY disambiguator is the RECIPIENT. Every caller must pass the candidate's own unique
  // alias as `to`; candidateInviteProvision.js does that and refuses to search without one.
  // Do not "fix" this by inventing a distinct subject - the app really does send one string.
  candidateInvite: {
    subject: 'Join Talentforge',
    from: 'noreply@talentforge.com.sa',
    extract: extractSetupLink,
  },
  // Sent to the AGENT when the superadmin toggles Status in Promo Tools > Edit Code
  // Parameters. Both verified live 2026-07-30 (TFF-484, which reported these missing, is
  // fixed on DEV — each mail landed within seconds of the save).
  promoDisabled: {
    subject: 'Your Talentforge promo code has been disabled',
    from: 'noreply@talentforge.com.sa',
    extract: extractPromoCode,
  },
  promoResumed: {
    subject: 'Your Talentforge promo code has been resumed',
    from: 'noreply@talentforge.com.sa',
    extract: extractPromoCode,
  },
  // TFF-43 §11/§12: the AGENT is emailed when their promo code expires.
  //
  // THIS MAIL NOW EXISTS, AND THE SUBJECT BELOW IS CONFIRMED AGAINST REAL MESSAGES.
  // The note that used to sit here said no such mail was ever sent and that this subject was a
  // guess modelled on its two siblings. That was true when it was written (2026-07-30) and is
  // now stale: an inbox sweep on 2026-08-12 found TEN messages under exactly this subject, the
  // newest 2026-08-07, addressed to agent aliases. The guess turned out to be right.
  // Consequence: whatever @known-issue tag was justified by "the app never sends this" no
  // longer is - re-run the expiry scenario before assuming it must fail.
  promoExpired: {
    subject: 'Your Talentforge promo code has expired',
    from: 'noreply@talentforge.com.sa',
    extract: extractPromoCode,
  },

  // ==================== Agent notifications (Figma: Agent > Email Templates) ====================
  //
  // EVERY SUBJECT BELOW WAS COPIED FROM A REAL MESSAGE on 2026-08-12, not from the Figma frame
  // titles. That distinction is load-bearing: the frame titles read like subject lines but are
  // not ("Agent - Your Promo Code Has Been Disabled" is the frame; the app sends "Your
  // Talentforge promo code has been disabled"). Registering a frame title here would make
  // waitForEmail time out on a mail that arrived perfectly well.
  //
  // AND NOTE HOW THE SEARCH BEHAVES. IMAP subject search is CASE-INSENSITIVE and a SUBSTRING
  // match - measured the same day: searching "...has been deactivated" returns all 90 messages,
  // including the 27 the app actually sent as "...Has Been Deactivated". So the strings below
  // are SEARCH KEYS, not assertions. The app really does send two different casings for the
  // deactivate/reactivate pair, and the only way to see that is to assert `parsed.subject`
  // separately - which agentEmailEvidence.js does. Do not "fix" a casing here and call the
  // defect covered.

  // Sent to the agent's CURRENT address when a superadmin commits Edit > Update Email Address.
  // Two wordings exist in the inbox; this is the current one (7 messages, newest 2026-08-06).
  // The other, "Your Talentforge account email has been updated", was last sent 2026-05-18 and
  // is the superseded template - do not register it, or a search would match the old mail.
  agentEmailChanged: {
    subject: 'Your Talentforge account email was changed',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  // Sent to the agent's NEW address by the same trigger, carrying the verification link.
  //
  // Do NOT be tempted by "Confirm your new Talentforge email address", which looks like a
  // sibling and is not: measured 2026-08-12, that subject carries the CANDIDATE SIGNUP body
  // ("We're excited to have you onboard... complete your signup process"), so it is a different
  // email wearing a similar name.
  agentEmailVerify: {
    subject: 'Verify your new Talentforge email address',
    from: 'noreply@talentforge.com.sa',
    extract: extractNewEmailVerifyLink,
  },

  // Sent to the agent when a superadmin commits Deactivate Account. The body says "your Talent
  // Forge agent account has been deactivated" - that word "agent" is what distinguishes it from
  // the candidate-facing deactivation mail, which shares the subject.
  agentDeactivated: {
    subject: 'Your Talentforge account Has Been Deactivated',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  agentReactivated: {
    subject: 'Your Talentforge account Has Been Reactivated',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  // THE MONTHLY-TARGET REMINDER EXISTS AS TWO DIFFERENT TEMPLATES, and which one you get depends
  // on what sent it. Both were captured in a single run on 2026-08-12 against one flagged agent:
  //
  //   sent automatically   uid 20306  "Reminder: Monthly target progress"
  //   sent by the button   uid 20311  "Subject: Monthly target delay reminder"
  //
  // The bodies are the same reminder. The on-demand one carries the literal label "Subject: "
  // baked into its subject VALUE, so the recipient's client renders
  // "Subject: Subject: Monthly target delay reminder". Both are registered because a scenario
  // has to be able to wait for the right one: asserting the automatic subject after clicking
  // Send Reminder waits for a mail a nightly job sends, which is exactly how the first run of
  // the reminder scenario timed out.
  //
  // The automatic one - the clean template. Its 00:00:01 delivery times mark it as cron-driven.
  agentMonthlyTargetReminder: {
    subject: 'Reminder: Monthly target progress',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  // What Notify > Send Reminder actually sends. The subject is malformed and registered AS SENT
  // on purpose: correcting it here would make waitForEmail miss the message entirely, and the
  // defect is asserted by its own step rather than hidden by a tidied-up registry.
  agentMonthlyTargetReminderOnDemand: {
    subject: 'Subject: Monthly target delay reminder',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  // Figma calls this "Agent - Activity reminder". Its 18:00:01 delivery times mark it as
  // cron-driven rather than triggerable from the portal, so it is registered for recognition
  // only - nothing in the suite provokes it.
  agentActivityReminder: {
    subject: 'Reminder: Log back into Talentforge',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },

  // The candidate "Contact Us" support request, as it reaches the candidate's ASSIGNED AGENT.
  //
  // >>> IT GOES TO THE AGENT, NOT THE CANDIDATE - THAT IS THE WHOLE POINT TO REMEMBER. <<<
  // MEASURED 2026-09-15, uid 25087: TO `iqra.farooq+9999@bytecorp.io` (the assigned agent),
  // greeting "Hi Agent added,", naming the candidate `iqra.farooq+554@bytecorp.io` in the body.
  // The modal's own copy says so ("Your assigned agent will respond via email within 24-48
  // hours") and it is accurate. A run watching the candidate's own mailbox sees nothing and
  // reports the mail as unsent, which is how this sat unresolved: set CONTACT_US_NOTIFY_EMAIL
  // to the agent, which .env now does.
  //
  // THE SUBJECT IS DYNAMIC - `New Feedback from <candidate name>`. Only the stable prefix is
  // registered, which is correct for IMAP: subject search is a case-insensitive SUBSTRING match,
  // so this key finds the mail for any candidate. Do NOT pin the full observed string.
  //
  // The body carries Candidate Name / Email, Category, Issue, Message, Attachment and a
  // "Submitted on" timestamp. Note Category and Issue are rendered as the RAW API ENUMS
  // (`technicalIssue`, `pageNotLoading`) rather than the labels the candidate chose - recorded
  // as a finding in Contact-us.feature rather than asserted, since no AC settles it.
  contactUsNotification: {
    subject: 'New Feedback from',
    from: 'noreply@talentforge.com.sa',
    extract: extractNothing,
  },
};

// ==================== Agent notifications with NO subject to register ====================
//
// Five of the fifteen Figma agent templates have never been sent. A 90-day sweep on 2026-08-12
// found no message whose body carries their copy, so there is no subject to copy and no honest
// way to guess one.
//
// THEY ARE MATCHED ON BODY TEXT INSTEAD, via gmailClient's waitForEmailMatching(). That is not
// a workaround, it is the correct reader for this case: a guessed subject can only ever answer
// "nothing arrived", which cannot tell "the app does not send this mail" from "the app sends it
// under a subject we did not predict". Matching the body reports whichever subject the mail
// actually lands under, so the day dev implements one of these the scenario turns green AND
// tells us the subject to register above.
//
// The phrases are taken verbatim from the Figma copy, trimmed to the part least likely to be
// reworded (no greeting, no sign-off, no interpolated name or number).
const AGENT_TEMPLATES_NOT_SENT = {
  verificationDelayReminder: {
    figmaTitle: 'Agent - Verification Delay Reminder',
    bodyIncludes: 'complete your pending verifications',
  },
  candidatesTransferred: {
    figmaTitle: 'Agent - Candidates Have Been Transferred to Your Account',
    bodyIncludes: 'transferred to your account',
  },
  documentReviewReminder: {
    figmaTitle: 'Agent - Document Review Activity Reminder',
    // Deliberately NOT "document revision", which also appears in the CANDIDATE-facing
    // "Subject: Document Revision Pending" mail. This phrase is unique to the agent template.
    bodyIncludes: 'document revision requests',
  },
  candidateAccountDeactivated: {
    figmaTitle: 'Agent - Your Candidate Account Has Been Deactivated',
    bodyIncludes: 'one of your candidates',
  },
  candidateAccountReactivated: {
    figmaTitle: 'Agent - Your Candidate Account Has Been Reactivated',
    bodyIncludes: 'one of your candidates',
  },
};

module.exports = {
  EMAIL_TYPES,
  AGENT_TEMPLATES_NOT_SENT,
  extractResetLink,
  extractVerifyLink,
  extractTempPassword,
  extractPromoCode,
};
