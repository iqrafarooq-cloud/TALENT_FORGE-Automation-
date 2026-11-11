// docVerificationErrors.js - the failure taxonomy for the AI document-verification
// automation, plus the redaction that keeps credentials out of every log line.
//
// Why a taxonomy at all: section 14 of the requirement says the automation must
// clearly distinguish upload failure, authentication failure, API failure, AI
// processing failure, AI timeout, verification mismatch, final status mismatch and
// file validation failure. Those are eight genuinely different diagnoses, and a
// generic `throw new Error(msg)` collapses them into one. When a run goes red the
// first question is always "whose fault is this", and the answer has to be in the
// error itself, not inferred from prose.
//
// Two kinds exist here that section 14 does not list, and both are deliberate:
//
//   FIXTURE  - the suite's own fault. The file was missing, the wrong size, or
//              could not be read. This repo has been burned by exactly that
//              confusion before (see the "exact-10 MB boundary was never an app
//              defect" note in CLAUDE.md): a missing PNG fixture was reported for
//              months as the app wrongly rejecting its own documented maximum.
//              "The app refused this file" and "the suite never sent it" must
//              never be indistinguishable in a report.
//
//   PENDING  - no expected result has been supplied for this document yet. It is
//              NOT a pass. A scenario that reports green having asserted nothing is
//              worse than one reporting a missing precondition, because the report
//              gives no hint that the requirement went unverified.

'use strict';

// The eight required kinds, plus the two above. Values are the strings that reach
// the report, so they are kebab-case and readable on their own.
const KIND = {
  AUTH: 'authentication-failure',
  UPLOAD: 'upload-failure',
  API: 'api-failure',
  AI_PROCESSING: 'ai-processing-failure',
  AI_TIMEOUT: 'ai-timeout',
  CRITERIA_MISMATCH: 'verification-mismatch',
  STATUS_MISMATCH: 'final-status-mismatch',
  FILE_VALIDATION: 'file-validation-failure',
  FIXTURE: 'fixture-failure',
  PENDING: 'expectation-pending',
};

// Human-readable one-liners, used in report headings so a reader does not have to
// know the vocabulary.
const KIND_LABEL = {
  [KIND.AUTH]: 'Authentication failed',
  [KIND.UPLOAD]: 'Upload failed',
  [KIND.API]: 'API call failed',
  [KIND.AI_PROCESSING]: 'AI verification errored',
  [KIND.AI_TIMEOUT]: 'AI verification timed out',
  [KIND.CRITERIA_MISMATCH]: 'Criterion verdict differs from expected',
  [KIND.STATUS_MISMATCH]: 'Final document status differs from expected',
  [KIND.FILE_VALIDATION]: 'File validation behaved unexpectedly',
  [KIND.FIXTURE]: 'Test fixture problem (the suite, not the app)',
  [KIND.PENDING]: 'No expected result supplied yet',
};

// Keys whose values must never be printed. Matched case-insensitively against the
// whole key name, so `AGENT_PASSWORD`, `access`, `refresh_token` are all covered.
const SECRET_KEY = /pass(word)?|token|secret|authorization|^access$|^refresh$|credential|api[-_]?key/i;

// A presigned S3 URL is a credential: the signature grants read access to a private
// object to anyone holding the string. The path is safe and useful (it names the
// file), the query is not.
function redactUrl(value) {
  if (typeof value !== 'string') return value;
  return value.replace(
    /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|Signature|AWSAccessKeyId)=)[^&\s]*/gi,
    '$1<redacted>'
  );
}

// Deep-copy a value with every secret replaced. Used on everything that reaches a
// log line or the Cucumber report, so redaction is structural rather than something
// each call site has to remember.
function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return redactUrl(value).replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>');
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '<redacted>' : redact(v, seen);
  }
  return out;
}

// One error type carrying its kind and whatever context the caller had. `detail` is
// redacted on the way in, so an error object is always safe to stringify.
class DocVerificationError extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = 'DocVerificationError';
    this.kind = kind;
    this.label = KIND_LABEL[kind] || kind;
    this.detail = redact(detail);
  }

  // Multi-line, because these end up in a Cucumber failure message where a single
  // long line is unreadable.
  toReport() {
    const lines = [`[${this.kind}] ${this.message}`];
    for (const [k, v] of Object.entries(this.detail)) {
      if (v === undefined) continue;
      lines.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
    return lines.join('\n');
  }
}

const err = (kind) => (message, detail) => new DocVerificationError(kind, message, detail);

module.exports = {
  KIND,
  KIND_LABEL,
  DocVerificationError,
  redact,
  redactUrl,
  authError: err(KIND.AUTH),
  uploadError: err(KIND.UPLOAD),
  apiError: err(KIND.API),
  aiProcessingError: err(KIND.AI_PROCESSING),
  aiTimeoutError: err(KIND.AI_TIMEOUT),
  criteriaMismatch: err(KIND.CRITERIA_MISMATCH),
  statusMismatch: err(KIND.STATUS_MISMATCH),
  fileValidationError: err(KIND.FILE_VALIDATION),
  fixtureError: err(KIND.FIXTURE),
  pendingExpectation: err(KIND.PENDING),
};
