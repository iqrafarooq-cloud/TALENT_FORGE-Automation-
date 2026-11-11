// docVerificationEvidence.js - compares an expected result against an observed one
// and returns findings. It never mutates the expectation, and it never decides that a
// missing expectation is a pass.
//
// ============================================================================
// THE RULE THIS MODULE EXISTS TO ENFORCE (requirement section 15)
// ============================================================================
// "Do not simply automate the current behavior. The purpose of this automation is to
// detect when the actual system behavior differs from the EXPECTED business
// behavior... Do not change the expected result just to make the automation pass."
//
// So the comparison is one-directional. Expected values come from the test data and
// are read-only here; observed values come from the API. Nothing in this file can
// widen an expectation, and `known_defect` annotates a finding without suppressing
// it - a document with a recorded defect still produces a failure.
//
// ============================================================================
// WHY FINDINGS ARE COLLECTED RATHER THAN THROWN ON THE FIRST ONE
// ============================================================================
// Cucumber abandons a scenario at its first failing step. A document has up to six
// independent criteria plus a status plus extracted fields, and they fail for
// unrelated reasons - so a step that threw on the first mismatch would report one
// criterion and hide the other five. This repo already learned that with the promo
// save-toast (two wordings, both wrong, only ever one visible) and with the receipt
// PDF currency check. Every comparison here returns a list, and the step throws once
// at the end with all of it.
//
// ============================================================================
// SEVERITY ORDERING IS LOAD-BEARING
// ============================================================================
// Findings are ordered delivery -> identity -> verdict -> detail. If the document
// never uploaded, "the authenticity verdict is wrong" is noise that sends the reader
// after the wrong bug. Same rule as the receipt-PDF currency step and the agent-email
// evidence module in this repo.

'use strict';

const { KIND } = require('./docVerificationErrors');
const { VERDICT } = require('./docVerificationApi');

// Ordered most-fundamental first. `sortFindings` uses the index.
const SEVERITY_ORDER = [
  KIND.FIXTURE,
  KIND.AUTH,
  KIND.API,
  KIND.UPLOAD,
  KIND.FILE_VALIDATION,
  KIND.AI_TIMEOUT,
  KIND.AI_PROCESSING,
  KIND.STATUS_MISMATCH,
  KIND.CRITERIA_MISMATCH,
  KIND.PENDING,
];

function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    const d = SEVERITY_ORDER.indexOf(a.kind) - SEVERITY_ORDER.indexOf(b.kind);
    return d !== 0 ? d : String(a.subject).localeCompare(String(b.subject));
  });
}

function finding(kind, subject, message, extra = {}) {
  return { kind, subject, message, ...extra };
}

// An expectation may be a single verdict ("fail") or a set of acceptable verdicts
// (["pass","uncertain"]). The set form is not laziness: where the AC is genuinely
// silent - an ordinary scan has no digital certificate to validate, so neither pass
// nor fail is wrong - pinning one verdict would be inventing a requirement, and this
// automation exists to test the requirement that exists. Where the AC is definite the
// test data pins a single value and this returns an exact comparison.
function acceptableVerdicts(expected) {
  return Array.isArray(expected) ? expected : [expected];
}

function describeExpectation(expected) {
  const list = acceptableVerdicts(expected);
  return list.length === 1 ? list[0] : `any of [${list.join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Upload expectation
// ---------------------------------------------------------------------------
// `expected.upload` is "accepted" or "rejected", and `expected.http_status` pins the
// code when the test data states one. A rejection with the wrong status is still a
// finding, because "refused for the right reason" is part of the requirement - a file
// rejected as 500 rather than 422 is a different product than one that validates.
function compareUpload(doc, observed) {
  const findings = [];
  const expected = doc.expected;
  if (!expected || !expected.upload) {
    findings.push(
      finding(KIND.PENDING, `${doc.id} upload`, 'No expected upload outcome supplied for this document', {
        observedHttpStatus: observed.httpStatus,
        observedAccepted: observed.accepted,
      })
    );
    return findings;
  }

  const wantAccepted = expected.upload === 'accepted';
  if (wantAccepted !== observed.accepted) {
    findings.push(
      finding(
        wantAccepted ? KIND.UPLOAD : KIND.FILE_VALIDATION,
        `${doc.id} upload`,
        wantAccepted
          ? `Upload was expected to be accepted but the API refused it with HTTP ${observed.httpStatus}`
          : `Upload was expected to be REJECTED but the API accepted it with HTTP ${observed.httpStatus}`,
        {
          expected: expected.upload,
          observed: observed.accepted ? 'accepted' : 'rejected',
          httpStatus: observed.httpStatus,
          bytesSent: observed.bytesSent,
          contentType: observed.contentType,
          // Section 14: do not hide API response errors.
          apiResponse: observed.responseBody,
        }
      )
    );
    return findings;
  }

  if (expected.http_status && expected.http_status !== observed.httpStatus) {
    findings.push(
      finding(KIND.FILE_VALIDATION, `${doc.id} upload status`, 'Upload outcome was correct but the HTTP status differs', {
        expected: expected.http_status,
        observed: observed.httpStatus,
        apiResponse: observed.responseBody,
      })
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Criteria expectation
// ---------------------------------------------------------------------------
// Three distinct failure modes, kept apart on purpose:
//   - the criterion is absent from the run entirely (the AI did not evaluate it)
//   - the verdict differs
//   - the criterion failed but carried no detail, which breaks the AC requirement
//     that a flagged document explains what failed
function compareCriteria(doc, verification) {
  const findings = [];
  const expected = (doc.expected && doc.expected.criteria) || null;
  const observedList = (verification && verification.criteria) || [];
  const observed = new Map(observedList.map((c) => [c.key, c]));

  if (!expected) {
    findings.push(
      finding(KIND.PENDING, `${doc.id} criteria`, 'No expected criteria supplied for this document', {
        observed: observedList.map((c) => `${c.key}=${c.verdict}`),
      })
    );
    return findings;
  }

  for (const [key, want] of Object.entries(expected)) {
    const got = observed.get(key);
    if (!got) {
      findings.push(
        finding(KIND.CRITERIA_MISMATCH, `${doc.id} ${key}`, 'The AI run did not evaluate this criterion at all', {
          expected: describeExpectation(want),
          criteriaPresent: observedList.map((c) => c.key),
        })
      );
      continue;
    }
    if (!acceptableVerdicts(want).includes(got.verdict)) {
      findings.push(
        finding(KIND.CRITERIA_MISMATCH, `${doc.id} ${key}`, 'Criterion verdict differs from the expected business behaviour', {
          expected: describeExpectation(want),
          observed: got.verdict,
          // The AC requires the reason to be displayed, so the reason belongs in the
          // failure message. It is also the only way to tell a wrong verdict from a
          // right verdict reached for the wrong reason.
          aiDetail: got.detail,
          knownDefect: doc.known_defect || undefined,
        })
      );
      continue;
    }
    if (got.verdict === VERDICT.FAIL && !String(got.detail || '').trim()) {
      findings.push(
        finding(KIND.CRITERIA_MISMATCH, `${doc.id} ${key}`, 'Criterion failed but carried no reason text, so nothing can be displayed to the agent or candidate', {
          expected: 'a non-empty detail alongside a fail verdict',
          observed: '(empty detail)',
        })
      );
    }
  }

  // Criteria the AI produced that no expectation covers. Reported as PENDING, not as
  // a failure: an unexpected criterion is a coverage gap in the test data, and
  // silently ignoring it is how a new rule ships unverified.
  for (const c of observedList) {
    if (!(c.key in expected)) {
      findings.push(
        finding(KIND.PENDING, `${doc.id} ${c.key}`, 'The AI evaluated a criterion the test data has no expectation for', {
          observed: c.verdict,
          aiDetail: c.detail,
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Extracted-field expectation
// ---------------------------------------------------------------------------
// Asserted only where the test data states a value. This is what separates "the AI
// reached the right verdict" from "the AI read the right document" - a name-match pass
// on a document whose extracted legal_name is empty is not a pass, it is a coincidence.
// Same reasoning as readDiscountLine() in the promo work: the rendered figure and the
// figure the decision was made from are different assertions.
function compareExtracted(doc, verification) {
  const findings = [];
  const expected = (doc.expected && doc.expected.extracted) || null;
  if (!expected) return findings;
  const got = (verification && verification.extracted) || {};
  for (const [field, want] of Object.entries(expected)) {
    const observedValue = got[field];
    const list = Array.isArray(want) ? want : [want];
    const hit = list.some(
      (w) => String(observedValue ?? '').trim().toLowerCase() === String(w).trim().toLowerCase()
    );
    if (!hit) {
      findings.push(
        finding(KIND.CRITERIA_MISMATCH, `${doc.id} extracted.${field}`, 'The AI extracted a different value from the document', {
          expected: list.join(' | '),
          observed: observedValue === undefined ? '(field absent)' : observedValue,
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Status and AI-error expectation
// ---------------------------------------------------------------------------
function compareStatus(doc, documentRow, verification) {
  const findings = [];
  const expected = doc.expected || {};

  // An AI error is a distinct diagnosis from an AI verdict. Reported when it was not
  // expected, and reported when it was expected and did not happen - the oversized
  // file scenario exists precisely to prove the error occurs.
  const observedError = (verification && verification.error) || null;
  if (expected.ai_error === true && !observedError) {
    findings.push(
      finding(KIND.AI_PROCESSING, `${doc.id} ai_error`, 'An AI processing error was expected but the run completed without one', {
        expected: 'ai_verification.error to be set',
        observed: 'null',
      })
    );
  } else if (!expected.ai_error && observedError) {
    findings.push(
      finding(KIND.AI_PROCESSING, `${doc.id} ai_error`, 'The AI could not verify this document', {
        error: observedError,
        note: 'This is an AI processing failure, not a verdict. The criteria below (if any) are not trustworthy.',
      })
    );
  }

  if (!expected.final_status) {
    findings.push(
      finding(KIND.PENDING, `${doc.id} final_status`, 'No expected final status supplied for this document', {
        observed: documentRow && documentRow.status,
        observedAiStatus: verification && verification.status,
      })
    );
    return findings;
  }

  const want = acceptableVerdicts(expected.final_status);
  const observed = documentRow && documentRow.status;
  if (!want.includes(observed)) {
    findings.push(
      finding(KIND.STATUS_MISMATCH, `${doc.id} final_status`, 'Final document status differs from the expected business behaviour', {
        expected: want.join(' | '),
        observed,
        aiStatus: verification && verification.status,
        failedCriteria: ((verification && verification.criteria) || [])
          .filter((c) => c.verdict === VERDICT.FAIL)
          .map((c) => c.key),
        knownDefect: doc.known_defect || undefined,
      })
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The whole-document comparison
// ---------------------------------------------------------------------------
// `observed` is { upload, verification, document } as produced by the API client.
// Returns an ordered finding list; an empty list means the document matched every
// expectation the test data states.
function compareDocument(doc, observed) {
  const findings = [];
  findings.push(...compareUpload(doc, observed.upload));

  // No point comparing verdicts on a document the API refused, and the expectation
  // for a refused document is only about the refusal.
  if (!observed.upload.accepted) return sortFindings(findings);

  findings.push(...compareStatus(doc, observed.document, observed.verification));
  findings.push(...compareCriteria(doc, observed.verification));
  findings.push(...compareExtracted(doc, observed.verification));
  return sortFindings(findings);
}

// A single human-readable block per document, attached to the report whether or not
// the document passed. On a red row it is the evidence; on a green one it is the
// record of what the AI actually said that day, which is what makes a later behaviour
// change diagnosable instead of mysterious. Same reasoning as the agent-email
// evidence module.
function documentReport(doc, observed) {
  const v = observed.verification || {};
  const lines = [];
  lines.push(`Document ${doc.id}  (${doc.category})`);
  lines.push(`  file            ${observed.upload.file}  ${observed.upload.bytesSent} bytes  ${observed.upload.contentType}`);
  lines.push(`  upload          HTTP ${observed.upload.httpStatus}  ${observed.upload.accepted ? 'accepted' : 'REJECTED'}`);
  if (!observed.upload.accepted) {
    lines.push(`  api response    ${JSON.stringify(observed.upload.responseBody)}`);
    return lines.join('\n');
  }
  lines.push(`  entry / doc id  ${observed.upload.entryId} / ${observed.upload.documentRowId}`);
  lines.push(`  document status ${observed.document && observed.document.status}`);
  lines.push(`  ai status       ${v.status}   model ${v.model}   version ${v.version}`);
  lines.push(`  checked_at      ${v.checked_at}`);
  if (observed.elapsedMs !== undefined) {
    lines.push(`  ai wait         ${Math.round(observed.elapsedMs / 1000)}s over ${observed.polls} polls`);
  }
  if (v.error) lines.push(`  ai error        ${v.error}`);
  lines.push('  criteria:');
  for (const c of v.criteria || []) {
    lines.push(`    ${String(c.key).padEnd(28)} ${String(c.verdict).padEnd(10)} ${c.detail || ''}`);
  }
  if (v.extracted) {
    lines.push('  extracted:');
    for (const [k, val] of Object.entries(v.extracted)) {
      lines.push(`    ${String(k).padEnd(28)} ${val === '' ? '(empty)' : val}`);
    }
  }
  const comments = (observed.document && observed.document.comments) || [];
  if (comments.length) {
    lines.push('  comments:');
    for (const c of comments) lines.push(`    [${c.source}] ${c.timestamp}  ${c.comment}`);
  }
  return lines.join('\n');
}

// Turn findings into one throwable message. Grouped by kind so the reader sees the
// diagnosis before the list, and counted so a run with 40 findings does not read as 40
// unrelated problems.
function formatFindings(findings) {
  if (!findings.length) return '';
  const byKind = new Map();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const lines = [`${findings.length} finding(s):`];
  for (const kind of SEVERITY_ORDER) {
    const list = byKind.get(kind);
    if (!list) continue;
    lines.push('');
    lines.push(`--- ${kind} (${list.length}) ---`);
    for (const f of list) {
      lines.push(`  ${f.subject}: ${f.message}`);
      for (const [k, v] of Object.entries(f)) {
        if (['kind', 'subject', 'message'].includes(k) || v === undefined) continue;
        lines.push(`      ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      }
    }
  }
  return lines.join('\n');
}

// Findings that must fail a step, versus findings that are recorded but do not.
// PENDING is the only non-failing kind, and only because the expected-results table
// has not been supplied yet. It is counted and printed loudly so an unverified
// document can never read as a verified one.
function splitFindings(findings) {
  return {
    failing: findings.filter((f) => f.kind !== KIND.PENDING),
    pending: findings.filter((f) => f.kind === KIND.PENDING),
  };
}

module.exports = {
  SEVERITY_ORDER,
  acceptableVerdicts,
  describeExpectation,
  compareUpload,
  compareCriteria,
  compareExtracted,
  compareStatus,
  compareDocument,
  documentReport,
  formatFindings,
  splitFindings,
  sortFindings,
};
