// document-verification.steps.js - steps for "features/AI Document Verification.feature"
// (renamed 2026-08-25 from features/Agent_Portal/Document-AI-Verification.feature).
//
// ============================================================================
// HOW A DECLARATIVE SCENARIO REACHES A REAL DOCUMENT
// ============================================================================
// The Gherkin names no fixture. Instead each `Given the candidate has uploaded <a
// description>` looks the description up in DESCRIPTIONS below, which yields a set of
// PROPERTY CONSTRAINTS, and `resolveDocument()` picks the document in the test data
// whose recorded properties satisfy them.
//
// Ambiguity is the normal case, not an error: "a transcript whose name matches the
// applicant" is true of a dozen files. So resolution prefers the document that satisfies
// the constraints and is otherwise CLEAN - fewest properties differing from the neutral
// baseline. That is what a declarative scenario means: everything about the document
// should be fine except the thing under test. Ties break on `order`, so a run is
// reproducible.
//
// Whichever document is chosen is ATTACHED TO THE REPORT every time. Without that
// nobody reading a red row can tell which file produced it, which would trade away the
// one real advantage the old id-in-Gherkin style had.
//
// ============================================================================
// FOUR RULES THAT SHAPE EVERY STEP
// ============================================================================
// 1. NO STEP THROWS ON THE FIRST PROBLEM. A document has six independent criteria and
//    Cucumber abandons a scenario at its first failing step, so each step collects
//    everything it finds and throws once.
// 2. A STEP THAT ASSERTED NOTHING MUST FAIL. Asserting on a document that was never
//    uploaded, or on a criterion the AI never evaluated, fails saying so rather than
//    passing vacuously.
// 3. VERDICTS COME FROM THE API, DISPLAYED TEXT COMES FROM THE UI. The AC's phrases
//    ("Name mismatch detected:") exist only in the panel and the stored comment, never
//    in ai_verification.criteria[].detail. Steps about what a person is SHOWN read the
//    panel; steps about the verdict read the API. They are not interchangeable.
// 4. TIMEOUTS ARE PER STEP, NEVER setDefaultTimeout - that is global in Cucumber and
//    would raise every other feature's step timeout. See hooks.js:81.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Given, When, Then, Before, After, Status } = require('../fixtures/bdd');
const { expect } = require('chai');

const { DocVerificationApi, VERDICT, CRITERION } = require('../utils/docVerificationApi');
const { resolveFixture, reconcileWithTestData } = require('../utils/docVerificationFixtures');
const { documentReport } = require('../utils/docVerificationEvidence');
const { DocVerificationError, KIND } = require('../utils/docVerificationErrors');
const AgentVerificationsPage = require('../pages/AgentVerificationsPage');
const CandidateDocumentsPage = require('../pages/CandidateDocumentsPage');
// The bell is role-agnostic and already documented for the superadmin and agent sessions
// in the promo features; the candidate's notification assertions bind the same page object
// to the candidate's context rather than growing a second copy of the same locators.
const NotificationsPage = require('../pages/NotificationsPage');
const video = require('../utils/videoRecorder');
// Accumulates the AI's own verdicts and remarks across the whole run into
// reports/ai-verification-findings.md - the artifact that answers 'what did the AI flag, and
// why' without opening 80 scenarios one at a time. See its header for why it is NDJSON.
const aiFindings = require('../utils/aiFindingsLog');
const trace = require('../utils/tracer');

const AI_STEP = 5 * 60 * 1000;
const AI_MULTI = 15 * 60 * 1000;
const NET_STEP = 2 * 60 * 1000;
const UI_STEP = 3 * 60 * 1000;

const TEST_DATA = path.resolve(__dirname, '..', '..', 'test-data', 'document-verification', 'documents.json');
const STAMPS = path.resolve(__dirname, '..', '..', 'Files', 'Test_doc', '.generated-fixtures.json');

// The neutral baseline. A property equal to its baseline value is "nothing wrong", so
// the distance from this set is what makes one candidate document cleaner than another.
const BASELINE = {
  name: 'exact',
  issuer: 'recognised',
  dates: 'valid_past',
  authenticity: 'ordinary_scan',
  file: undefined,
};

// ---------------------------------------------------------------------------
// The one place a business description becomes a fixture constraint
// ---------------------------------------------------------------------------
// Keyed by the text that follows "the candidate has uploaded a/an ". Kept as a single
// table on purpose: it is the whole binding between the Gherkin and the fixture set, and
// scattering it across forty step definitions would make it unreviewable.
const DESCRIPTIONS = {
  // ---- plain document kinds (all-clean examples of each) ----
  'transcript': { kind: 'transcript' },
  // The applicant IS the account holder, so 'naming the applicant' is the clean control.
  'transcript naming the applicant': { kind: 'transcript', name: 'exact' },
  'valid transcript': { kind: 'transcript', name: 'exact', issuer: 'recognised', dates: 'valid_past', content: 'complete' },
  'work experience letter': { kind: 'work_letter' },
  'valid work experience letter': { kind: 'work_letter', name: 'exact', issuer: 'recognised' },
  'certificate': { kind: 'certificate' },
  'valid certificate': { kind: 'certificate', name: 'exact', issuer: 'recognised', dates: 'valid_past' },

  // ---- identity ----
  'transcript naming a different person': { kind: 'transcript', name: 'different_person' },
  'transcript whose full legal name differs from the applicant': { kind: 'transcript', name: 'different_person' },
  // The only work letter with a name defect. Built for the multi-document scenarios, where the
  // flagged document must not be the transcript - a transcript is flagged for its content too,
  // so 'only that document is flagged for a name mismatch' would pass without proving anything.
  'work experience letter naming a different person': { kind: 'work_letter', name: 'different_person' },
  'transcript whose first name differs from the applicant': { kind: 'transcript', name: 'first_differs' },
  'transcript whose last name differs from the applicant': { kind: 'transcript', name: 'last_differs' },
  'transcript naming the applicant with different capitalisation': { kind: 'transcript', name: 'uppercase' },
  'transcript naming the applicant with extra spaces': { kind: 'transcript', name: 'extra_spaces' },
  'transcript naming the applicant with a missing space': { kind: 'transcript', name: 'missing_space' },
  'transcript naming the applicant with reversed name order': { kind: 'transcript', name: 'reversed' },
  'transcript naming the applicant with missing middle name': { kind: 'transcript', name: 'missing_middle' },

  // ---- issuer ----
  'transcript from an unrecognised institution': { kind: 'transcript', issuer: 'unrecognised' },
  'transcript with an unrecognised institution': { kind: 'transcript', issuer: 'unrecognised' },
  'transcript with no issuing institution': { kind: 'transcript', issuer: 'absent' },

  // ---- dates ----
  'transcript with a graduation date in the future': { kind: 'transcript', dates: 'future_conferral' },
  // Worded 'document' rather than 'transcript' because the outline they share pairs a future
  // graduation date with an expiry/issue inversion, which only a certificate can carry.
  'document with a graduation date in the future': { kind: 'transcript', dates: 'future_conferral' },
  'document with an expiry date before the issue date': { kind: 'certificate', dates: 'expiry_before_issue' },
  'certificate with an issue date in the future': { kind: 'certificate', dates: 'future_issue' },
  'certificate whose expiry precedes its issue date': { kind: 'certificate', dates: 'expiry_before_issue' },
  'transcript with a malformed date': { kind: 'transcript', dates: 'malformed' },
  'certificate that expires today': { kind: 'certificate', dates: 'expiry_today' },

  // ---- transcript content ----
  'transcript with no degree awarded': { kind: 'transcript', content: 'missing_degree' },
  'transcript with no major or field of study': { kind: 'transcript', content: 'missing_major' },
  'transcript with no graduation or conferral date': { kind: 'transcript', content: 'missing_date' },
  'transcript missing several required fields': { kind: 'transcript', content: 'missing_multiple' },

  // ---- authenticity ----
  'transcript showing visible tampering': { kind: 'transcript', authenticity: 'tampered' },
  'e-transcript with no digital certificate': { authenticity: 'no_digital_cert' },
  'e-transcript with an invalid certificate': { authenticity: 'invalid_digital_cert' },
  // No fixture can carry a genuinely valid digital certificate, and there is no evidence
  // the product validates signatures at all. The scenario using this is @not-automatable
  // and the resolver failing loudly here is the correct outcome.
  'e-transcript with a valid digital certificate': { authenticity: 'valid_digital_cert' },

  // ---- readability ----
  'document too degraded to read': { authenticity: 'illegible' },
  'blurry but legible document': { authenticity: 'blurry_legible' },
  'blank document': { kind: 'blank' },

  // ---- file validation ----
  'document in a disallowed format': { file: 'disallowed_docx' },
  'JPEG document': { file: 'disallowed_jpg' },
  'document over the size limit': { file: 'oversized' },
  'document the AI cannot process': { file: 'near_ai_inline_limit' },
  'document in each allowed format': { file: ['allowed_pdf', 'allowed_png'], multiple: true },
};

// Criterion phrase -> API key. One map so a step and an assertion cannot drift.
const CRITERION_BY_PHRASE = {
  identity: CRITERION.IDENTITY_NAME_MATCH,
  date: CRITERION.DATE_VALIDITY,
  'issuing institution': CRITERION.ISSUING_ORGANISATION,
  'issuing organisation': CRITERION.ISSUING_ORGANISATION,
  'transcript content': CRITERION.TRANSCRIPT_CONTENT,
  'cross-document name': CRITERION.CROSS_DOCUMENT_CONSISTENCY,
  authenticity: CRITERION.AUTHENTICITY,
};

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

function state(world) {
  if (!world._docVerify) {
    world._docVerify = {
      api: null,
      data: JSON.parse(fs.readFileSync(TEST_DATA, 'utf8')),
      constraints: {},
      resolved: null,
      observed: null,
      submitted: new Map(),
      candidateCtx: null,
      candidatePages: null,
      agentOpened: null,
      decisionDialog: null,
      decisionKind: null,
      gating: [],
    };
  }
  return world._docVerify;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// How far a document's properties sit from the neutral baseline, ignoring anything the
// scenario constrained explicitly. Lower is cleaner.
function distanceFromBaseline(props, constrained) {
  let d = 0;
  for (const [k, base] of Object.entries(BASELINE)) {
    if (constrained.has(k)) continue;
    const v = props[k];
    if (base === undefined) {
      if (v !== undefined) d += 1;
    } else if (v !== base) {
      d += 1;
    }
  }
  // A transcript's content baseline is "complete"; anything else is a defect. Handled
  // separately because non-transcripts legitimately carry 'not_a_transcript'.
  if (!constrained.has('content') && props.kind === 'transcript' && props.content !== 'complete') d += 1;
  return d;
}

function satisfies(props, constraints) {
  for (const [k, want] of Object.entries(constraints)) {
    if (k === 'multiple') continue;
    const have = props[k];
    const ok = Array.isArray(want) ? want.includes(have) : have === want;
    if (!ok) return false;
  }
  return true;
}

// Pick the document. Never guesses silently: an unsatisfiable constraint set names the
// constraints AND the closest candidates, because "no fixture is like that" and "the
// fixture exists but its properties are mislabelled" look identical otherwise.
// Look one document up by its test-data id. Used by the UI-upload path, which names its fixture
// directly (the form has to be filled with THAT document's declared values) rather than
// resolving it from property constraints the way the API-driven Givens do.
//
// This was called as `documentSpec()` and never defined - a latent ReferenceError that would
// have failed all four @creates-profile-entry scenarios on their first step. It went unnoticed
// because those scenarios are excluded from every routine profile (each save creates a
// permanent profile entry) and had never been run live. Found 2026-08-25 by running the
// walkthrough.
function documentSpec(world, id) {
  const s = state(world);
  const doc = s.data.documents.find((d) => String(d.id).toUpperCase() === String(id).toUpperCase());
  if (!doc) {
    throw new Error(
      `No document with id "${id}" in test-data/document-verification/documents.json. ` +
        `Known ids: ${s.data.documents.map((d) => d.id).join(', ')}`
    );
  }
  return doc;
}

function resolveDocument(world, { all = false } = {}) {
  const s = state(world);
  const constrained = new Set(Object.keys(s.constraints).filter((k) => k !== 'multiple'));
  const matches = s.data.documents.filter((d) => d.properties && satisfies(d.properties, s.constraints));

  if (!matches.length) {
    const near = s.data.documents
      .filter((d) => d.properties && d.properties.kind === s.constraints.kind)
      .map((d) => `${d.id} (${JSON.stringify(d.properties)})`);
    throw new Error(
      'No document in the test data satisfies these constraints:\n  ' +
        JSON.stringify(s.constraints) +
        '\nDocuments of the same kind:\n  ' +
        (near.join('\n  ') || '(none)') +
        '\nEither a fixture is missing (generate it) or its `properties` block is wrong.'
    );
  }

  if (all) return matches.sort((a, b) => a.order - b.order);

  const ranked = matches
    .map((d) => ({ d, dist: distanceFromBaseline(d.properties, constrained) }))
    .sort((a, b) => a.dist - b.dist || a.d.order - b.d.order);
  return ranked[0].d;
}

// Upload one document and record it. Refusals are not thrown: several scenarios exist to
// assert a refusal, so the assertion steps decide.
//
// The account's document rows are snapshotted FIRST, every time. This candidate is
// dedicated but long-lived - ~78 rows, four of them naming somebody else - so the row
// this upload creates has to be identified positively. The snapshot is what lets
// `upload()` recover a missing row id and refuse a row that already existed; see
// confirmRowIsNew() in docVerificationApi.js for why that is a hard failure.
// ===========================================================================
// DOC_UPLOAD_MODE - ui (default) or api
// ===========================================================================
//
// `ui` drives the real Profile > Candidate Details form, which is what a candidate
// actually does and what makes the flow watchable in a headed run. `api` posts straight
// to the upload endpoint - far faster, and the right mode when you are re-running to
// diagnose an assertion rather than to observe the product.
//
// BOTH MODES CREATE THE SAME PERMANENT ROW. There is no delete for a document anywhere in
// the API, so neither mode is the "cheap" one in the sense that matters; `api` only costs
// less time.
//
// TWO CLASSES OF DOCUMENT ARE FORCED ONTO THE API PATH regardless of the mode, and this is
// not a limitation being worked around - it is what those scenarios are about:
//
//   * anything carrying a `file` property (disallowed format, oversized, the allowed-format
//     pair, the near-inline-limit file). Those scenarios assert the ENDPOINT's policy - an
//     HTTP status and the message it returns. A form that refuses a .docx in the browser
//     proves the client blocks it, which is a different and weaker claim, and the
//     allowed-formats scenario uploads two files against one entry, which no single form
//     submission does.
//   * anything whose category has no profile form. There is none today; the check is there
//     so a new category fails loudly rather than silently reverting to the API.
//
// Whichever path ran is recorded on the upload as `viaUi`, and attached to the report, so
// a green run always says how the document got there.
const DOC_UPLOAD_MODE = (process.env.DOC_UPLOAD_MODE || 'ui').toLowerCase();
if (!['ui', 'api'].includes(DOC_UPLOAD_MODE)) {
  throw new Error(`DOC_UPLOAD_MODE must be "ui" or "api", not "${process.env.DOC_UPLOAD_MODE}"`);
}

function uploadRouteFor(doc) {
  if (DOC_UPLOAD_MODE !== 'ui') return { via: 'api', why: 'DOC_UPLOAD_MODE=api' };
  if (doc.properties && doc.properties.file) {
    return { via: 'api', why: `${doc.id} tests the upload endpoint's own file policy (${doc.properties.file})` };
  }
  if (!FORM_FILLERS[doc.category]) {
    return { via: 'api', why: `no profile form is registered for category ${doc.category}` };
  }
  return { via: 'ui', why: 'DOC_UPLOAD_MODE=ui' };
}

async function uploadDocument(world, doc) {
  const s = state(world);
  const route = uploadRouteFor(doc);

  // Which document was chosen, and how it is about to be sent. Attached BEFORE the upload
  // so a scenario that dies mid-upload still reports what it was doing - the UI path takes
  // the better part of a minute and a failure inside it used to leave the report silent
  // about which fixture was involved.
  await world.attach(
    `resolved "${JSON.stringify(s.constraints)}"\n  -> ${doc.id}  ${doc.file}\n` +
      `  properties ${JSON.stringify(doc.properties)}\n` +
      `  uploading via ${route.via.toUpperCase()} (${route.why})`,
    'text/plain'
  );

  let observed;
  if (route.via === 'ui') {
    observed = await uploadThroughUi(world, doc);
    observed.upload.routeReason = route.why;
  } else {
    const fixture = resolveFixture(doc.file, doc.id);
    const priorIds = await s.api.snapshotDocumentIds();
    observed = { doc, priorDocumentIds: priorIds, upload: await s.api.upload(doc, fixture, { priorIds }) };
    observed.upload.viaUi = false;
    observed.upload.routeReason = route.why;
    await world.attach(
      `  account held ${priorIds.size} document row(s) before this upload\n` +
        `  upload HTTP ${observed.upload.httpStatus} ${observed.upload.accepted ? 'accepted' : 'REFUSED'}\n` +
        `  entry ${observed.upload.entryId} / document row ${observed.upload.documentRowId}` +
        (observed.upload.rowIdSource ? ` (from the ${observed.upload.rowIdSource})` : ''),
      'text/plain'
    );
  }

  s.submitted.set(doc.id.toUpperCase(), observed);
  s.observed = observed;

  // Every upload joins the running list, so the multi-document scenarios can be written as
  // consecutive `And the candidate has uploaded ...` lines rather than needing one combined
  // step per combination. Steps that assert on a single document keep reading `s.observed`,
  // which is always the most recent - the two views do not compete.
  if (!s.multiple) s.multiple = [];
  s.multiple.push(observed);
  return observed;
}

async function verifyDocument(world, observed) {
  const s = state(world);
  if (!observed.upload.accepted) {
    throw new Error(
      `${observed.doc.id} was refused at upload with HTTP ${observed.upload.httpStatus}, so no AI ` +
        `verification happened. Response: ${JSON.stringify(observed.upload.responseBody)}`
    );
  }
  try {
    const r = await s.api.waitForVerification(observed.doc.category, observed.upload.entryId);
    observed.verification = r.verification;
    observed.document = r.document;
    observed.elapsedMs = r.elapsedMs;
    observed.polls = r.polls;
  } catch (e) {
    if (e instanceof DocVerificationError && e.kind === KIND.AI_TIMEOUT) {
      observed.timeout = e;
      throw new Error(e.toReport());
    }
    throw e;
  }
  return observed;
}

function current(world) {
  const s = state(world);

  // A queue still holding entries here means a step read the document without flushing
  // first. That is a step-definition gap, not a scenario problem, and it must say so:
  // silently returning the previous document (or none) is how an assertion ends up
  // reporting on something the scenario never uploaded. The flush points are listed at
  // flushUploads() - add this step to them.
  if (s.uploadQueue && s.uploadQueue.length) {
    throw new Error(
      `${s.uploadQueue.length} upload(s) are still queued (${s.uploadQueue
        .map((e) => e.label)
        .join(', ')}), so no document has been sent yet. The step that just ran reads the ` +
        'uploaded document but never called flushUploads(). Add it to the flush points - see ' +
        'the comment above flushUploads().'
    );
  }
  if (!s.observed) throw new Error('No document has been uploaded in this scenario yet.');
  return s.observed;
}

function verificationOf(world) {
  const o = current(world);
  if (!o.verification) {
    throw new Error(
      `${o.doc.id} has no AI verification result yet. A "When the AI verifies the document" step ` +
        'must run before this assertion.'
    );
  }
  return o.verification;
}

function criterion(world, key) {
  return (verificationOf(world).criteria || []).find((c) => c.key === key) || null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Before({ tags: '@doc-verification' }, async function () {
  state(this).api = new DocVerificationApi();
});

After({ tags: '@doc-verification', timeout: NET_STEP }, async function (scenario) {
  const s = this._docVerify;
  if (!s) return;

  // >>> TRACES ARE COLLECTED HERE, NOT IN hooks.js, FOR THE CROSS-ROLE SCENARIOS.
  //     Cucumber runs After hooks in reverse registration order, so this one runs BEFORE the
  //     global teardown - and it closes the candidate context below. tracing.stop() needs a
  //     LIVE context, so by the time hooks.js got there that context's trace would already be
  //     unrecoverable, and the loss would be silent. Collecting here, while every context in
  //     the scenario is still open, saves them all; the global hook then finds an empty list
  //     and no-ops.
  if (trace.enabled()) {
    const failed = !!(scenario && scenario.result && scenario.result.status === Status.FAILED);
    try {
      const files = await trace.collect(this, { keep: failed || trace.mode() === 'on', scenarioName: scenario.pickle.name });
      if (files.length) await this.attach(trace.reportText(files), 'text/plain');
    } catch {
      /* a debugging aid must never mask the scenario's own failure */
    }
  }
  // >>> ITERATE UNIQUE UPLOADS, NOT MAP ENTRIES. <<<
  // s.submitted is keyed by document id, but the UI path ALSO registers the same upload under
  // a second key (`${doc.id}(ui)`, line ~2792) and the resubmission path under a third
  // (`${id}(resubmit)`). Two of those keys can point at the SAME observed object, so a plain
  // walk of the map attached the evidence twice and recorded the same document row twice in
  // the findings log - which double-counted it in the per-criterion tally, the one number in
  // that artifact somebody might act on. Deduplicating on object identity is exact: two
  // genuinely different uploads are different objects.
  for (const observed of new Set(s.submitted.values())) {
    try {
      await this.attach(documentReport(observed.doc, observed), 'text/plain');
    } catch {
      /* attaching evidence must never mask the scenario's own failure */
    }
    // The same evidence, also appended to the run-level findings log. Recorded here rather
    // than at the assertion site so it happens for EVERY document a scenario touched, whether
    // the scenario passed or failed - a failed scenario's verdicts are the evidence, and
    // losing them leaves the reader with only an assertion message.
    aiFindings.record({
      scenario: scenario && scenario.pickle ? scenario.pickle.name : null,
      doc: observed.doc,
      observed,
      uploadMode: DOC_UPLOAD_MODE,
    });
  }
  if (s.gating.length) {
    try {
      await this.attach('decision gating observed:\n' + s.gating.map((g) => '  ' + JSON.stringify(g)).join('\n'), 'text/plain');
    } catch {
      /* as above */
    }
  }
  // The second (candidate) session, opened only by the cross-role scenarios.
  if (s.candidateCtx) {
    try {
      await s.candidateCtx.close();
    } catch {
      /* nothing to do */
    }
  }
  // NO document cleanup, deliberately: the API exposes no DELETE for a document row, so
  // cleanup is unavailable at any price. Pretending otherwise would be worse than saying so.
});

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('the candidate has a valid account', { timeout: NET_STEP }, async function () {
  const s = state(this);
  const email = process.env.DOC_CANDIDATE_EMAIL || process.env.CANDIDATE_EMAIL;
  const password = process.env.DOC_CANDIDATE_PASSWORD || process.env.CANDIDTAE_PASSWORD;
  s.identity = await s.api.login(email, password, 'candidate');
  expect(s.identity.isCandidate, `${email} is not a candidate account`).to.equal(true);
});

// Guards the two criteria that are meaningless without it, before any upload is spent.
Given('the candidate has provided their legal first and last name', function () {
  const s = state(this);
  expect(
    s.identity.declaredName,
    'The declared legal name on the account does not match the name printed on the test documents, ' +
      'so every identity and cross-document result would be meaningless. This is a fixture problem, ' +
      'not a product defect: point DOC_CANDIDATE_EMAIL at the right account.'
  ).to.equal(s.data.declared.legal_name);
});

Given('the AI verification service is available', { timeout: NET_STEP }, async function () {
  const s = state(this);
  const res = await s.api.request('GET', 'institutions/?page_size=1', { anonymous: true });
  expect(res.status, `the API at ${s.api.baseUrl} answered ${res.status}`).to.be.below(500);
});

// ---------------------------------------------------------------------------
// Test-data integrity
// ---------------------------------------------------------------------------

Then('no document in the test data should be missing its expected result', function () {
  const s = state(this);
  const missing = s.data.documents.filter((d) => !d.expected).map((d) => d.id);
  expect(
    missing,
    `${missing.length} of ${s.data.documents.length} documents have no expected result, so they can ` +
      'never be verified. They are reported PENDING and are NOT counted as passes.\n  ' +
      missing.join(', ')
  ).to.deep.equal([]);
});

Then('every document file named in the test data should exist', function () {
  const recon = reconcileWithTestData(state(this).data.documents);
  expect(recon.missingFromDisk, `Named in the test data but not on disk: ${recon.missingFromDisk.join(', ')}`).to.deep.equal([]);
});

Then('no document file on disk should be missing a test data entry', function () {
  const recon = reconcileWithTestData(state(this).data.documents);
  // The EDGE notes describe checks needing no document, and the fixture generator keeps
  // one .original backup deliberately. Anything else unclaimed is coverage nobody runs.
  const unexplained = recon.unusedOnDisk.filter(
    (f) => !/^EDGE-\d+.*\.txt$/i.test(f) && !/\.original$/i.test(f) && !/^\./.test(f)
  );
  expect(unexplained, `In Files/Test_doc but used by no test data entry: ${unexplained.join(', ')}`).to.deep.equal([]);
});

// A fixture whose correctness depends on the date it was built (the expires-today
// certificate) is worthless on any other day, and silently tests "expired recently"
// instead of the boundary. So staleness is an assertion, not a comment.
Then('no time-sensitive fixture should be out of date', function () {
  let stamps = {};
  try {
    stamps = JSON.parse(fs.readFileSync(STAMPS, 'utf8'));
  } catch {
    throw new Error(
      `No fixture build record at ${STAMPS}. Run: node scripts/make-doc-verification-fixtures.js`
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const stale = Object.entries(stamps)
    .filter(([, v]) => v.timeSensitive && v.builtOn !== today)
    .map(([id, v]) => `${id} (${v.file}) was built for ${v.builtOn}, today is ${today}`);
  expect(
    stale,
    stale.join('\n') +
      '\nRebuild with: node scripts/make-doc-verification-fixtures.js ' +
      Object.entries(stamps).filter(([, v]) => v.timeSensitive).map(([id]) => id).join(' ')
  ).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Given: upload a document matching a description
// ---------------------------------------------------------------------------

// The `[^,]+` is deliberate: it keeps this generic step from also matching the
// multi-document phrasing further down, which Cucumber would otherwise reject as ambiguous.
// ===========================================================================
// >>> UPLOADS ARE QUEUED BY THE GIVENS AND FLUSHED ONCE, LATER. <<<
// ===========================================================================
//
// The opening Given used to upload immediately, and a refinement then ASSERTED that the
// already-uploaded document happened to satisfy it. That is wrong in two ways, and both
// were measured on 2026-08-25:
//
//   * IT PICKS THE WRONG DOCUMENT. "Given the candidate has uploaded a certificate / And
//     the document is currently active with an expiry date that is today" resolved the
//     CLEANEST certificate on the first line - DATE-05, all dates past - and only then
//     discovered the refinement wanted DATE-08. The scenario failed with "put the
//     narrowest Given first", blaming the feature file for the design's own ordering
//     constraint. A reader writing Gherkin should not have to know which Given resolves.
//
//   * IT SPENDS A PERMANENT UPLOAD ON THE WRONG DOCUMENT FIRST. There is no DELETE for a
//     document row anywhere in the API, so that failure left DATE-05 on the account
//     twice, for nothing. Resolving after every constraint is known means the account only
//     ever receives the document the scenario actually wanted.
//
// So a Given now QUEUES an upload and a refinement merges into the queued entry. The
// queue is flushed by flushUploads(), from the small set of steps that can legitimately
// follow the Given block - listed at each call site. Nothing else changes: refinements
// still cannot invent a document (an unsatisfiable combination fails naming the
// constraints), and the order of the queue is still the order the Givens were written,
// which matters because upload order is test data.
function queueUpload(world, spec, label) {
  const s = state(world);
  if (!s.uploadQueue) s.uploadQueue = [];
  s.uploadQueue.push({ constraints: { ...spec }, label });
  s.constraints = s.uploadQueue[s.uploadQueue.length - 1].constraints;
  return s.uploadQueue[s.uploadQueue.length - 1];
}

// Resolve and upload everything the Givens queued, in order. Safe to call repeatedly -
// an empty queue is a no-op, so a step that flushes defensively costs nothing.
async function flushUploads(world) {
  const s = state(world);
  const queue = s.uploadQueue || [];
  s.uploadQueue = [];
  for (const entry of queue) {
    s.constraints = entry.constraints;
    await uploadDocument(world, resolveDocument(world));
  }
  return s.observed;
}

// The `[^,]+` is deliberate: it keeps this generic step from also matching the
// multi-document phrasing further down, which Cucumber would otherwise reject as ambiguous.
Given(/^the candidate has uploaded (?:a|an) ([^,]+)$/, function (description) {
  const key = description.trim();
  const spec = DESCRIPTIONS[key];
  if (!spec) {
    throw new Error(
      `No fixture description registered for "${key}".\nKnown descriptions:\n  ` +
        Object.keys(DESCRIPTIONS).sort().join('\n  ')
    );
  }

  // `multiple` expands into one queued upload per file, so "a document in each allowed
  // format" is the same mechanism as three consecutive Givens rather than a special case.
  if (spec.multiple) {
    const wanted = Array.isArray(spec.file) ? spec.file : [spec.file];
    for (const f of wanted) queueUpload(this, { file: f }, `${key} (${f})`);
    return;
  }
  queueUpload(this, spec, key);
});

// Refinements: each narrows the document the opening Given queued.
//
// DEFINED EXPLICITLY, ONE PER PHRASE, and NOT as a catch-all regex. A regex like
// /^(?:the |all )?(.+)$/ would match almost every Given in the entire repository and
// Cucumber would reject hundreds of steps as ambiguous. The phrases are few enough to
// list, and listing them means an unregistered phrase is an undefined step - which the
// dry run catches - rather than a runtime surprise.
//
// A refinement narrows the PENDING entry. If the upload has already happened - a
// refinement after the flush, which the feature files do not do but a future one might -
// it falls back to asserting against the resolved document, because re-resolving then
// would mean a second permanent upload.
function refine(world, phrase, constraint) {
  const s = state(world);
  const queue = s.uploadQueue || [];

  if (queue.length) {
    const entry = queue[queue.length - 1];
    const merged = { ...entry.constraints, ...constraint };
    // Resolve now purely to check the combination is satisfiable, so an impossible pair of
    // Givens fails HERE, naming both, rather than at the flush where only the merged
    // constraint object survives to be reported.
    s.constraints = merged;
    try {
      resolveDocument(world);
    } catch (e) {
      throw new Error(
        `No document satisfies "${phrase}" together with the constraints already given.\n` +
          `  combined constraint: ${JSON.stringify(merged)}\n` +
          `  ${e.message.split('\n')[0]}\n` +
          'Either the combination has no fixture, or two Givens in this scenario contradict.'
      );
    }
    entry.constraints = merged;
    return;
  }

  const doc = s.observed && s.observed.doc;
  if (!doc) throw new Error(`"${phrase}" was given before any document was uploaded or queued.`);
  const merged = { ...s.constraints, ...constraint };
  if (!satisfies(doc.properties, merged)) {
    throw new Error(
      `The document chosen for this scenario (${doc.id}) does not satisfy "${phrase}", and it has ` +
        'already been uploaded, so it cannot be re-chosen.\n' +
        `  its properties: ${JSON.stringify(doc.properties)}\n` +
        `  constraint:     ${JSON.stringify(constraint)}\n` +
        'Move this Given above the step that triggered the upload.'
    );
  }
  s.constraints = merged;
}

Given("the candidate's legal name matches the name on the document", function () {
  refine(this, "the candidate's legal name matches the name on the document", { name: 'exact' });
});

Given('the issuing institution is recognised', function () {
  refine(this, 'the issuing institution is recognised', { issuer: 'recognised' });
});

Given('the issuing organisation is recognised', function () {
  refine(this, 'the issuing organisation is recognised', { issuer: 'recognised' });
});

Given('the transcript contains the degree awarded', function () {
  refine(this, 'the transcript contains the degree awarded', { content: 'complete' });
});

Given('the transcript contains the major or field of study', function () {
  refine(this, 'the transcript contains the major or field of study', { content: 'complete' });
});

Given('the transcript contains a valid graduation or conferral date', function () {
  refine(this, 'the transcript contains a valid graduation or conferral date', { content: 'complete' });
});

Given('all document dates are logically valid', function () {
  refine(this, 'all document dates are logically valid', {
    dates: ['valid_past', 'open_ended', 'active_future_expiry'],
  });
});

// Two expiry positions the AC treats identically - the rule forbids a future date only
// when the document is NOT current, so neither of these may be flagged. They are one
// parameterised step rather than two because the assertion after them is the same, and a
// reader comparing the two rows should see one rule applied twice.
const EXPIRY_POSITION = {
  'in the future': 'active_future_expiry',
  today: 'expiry_today',
};

Given(/^the document is currently active with an expiry date that is (in the future|today)$/, function (position) {
  const dates = EXPIRY_POSITION[position];
  refine(this, `the document is currently active with an expiry date that is ${position}`, { dates });
});

Given('the candidate has already submitted a document in their legal name', { timeout: AI_STEP }, async function () {
  const s = state(this);
  s.constraints = { kind: 'transcript', name: 'exact', content: 'complete' };
  const doc = resolveDocument(this);
  const observed = await uploadDocument(this, doc);
  await verifyDocument(this, observed);
  s.priorDocument = observed;
});


Given('a document has been flagged by the AI', { timeout: AI_STEP }, async function () {
  const s = state(this);
  s.constraints = { kind: 'transcript', name: 'different_person' };
  const observed = await uploadDocument(this, resolveDocument(this));
  await verifyDocument(this, observed);
  const failed = (observed.verification.criteria || []).filter((c) => c.verdict === VERDICT.FAIL);
  expect(
    failed.map((c) => c.key),
    `${observed.doc.id} was expected to be flagged so the agent has something to review, but no ` +
      'criterion failed. Without a flagged document this scenario proves nothing.'
  ).to.not.be.empty;
});

Given('the candidate has a document that was marked for revision', { timeout: UI_STEP }, async function () {
  // Reads an EXISTING revision-required document rather than creating one: creating one
  // means committing a real agent decision, which nothing undoes, and this scenario only
  // needs to read what the candidate is shown.
  //
  // The fixture must be one the CANDIDATE CAN ACTUALLY REACH, which is why this step opens
  // the dashboard instead of trusting the API list. The dashboard's "Your Documents" block
  // shows only a subset - measured 2026-08-25: 4 cards against 152 document rows - so the
  // API's first REVISION row is very often a document the candidate cannot open at all.
  // Taking it regardless is what made this scenario fail on reachability
  // ("No document card matches ENG-04...") rather than on the remarks it exists to assert,
  // which sent the reader after a locator bug that was not there.
  const s = state(this);
  const docs = await s.api.listDocuments();
  const revision = docs.filter((d) => d.status === 'REVISION');
  expect(
    revision.length,
    'No document on this account is in REVISION over the API, so there is nothing for the candidate ' +
      'to be shown. Run `npm run test:doc-verify:decisions` first, or seed one.'
  ).to.be.greaterThan(0);

  const { documents } = await candidateUi(this);
  await documents.openDashboard();
  const cards = await documents.readDocumentCards();
  const reachable = cards.filter((c) => c.status === 'Revision Required');

  await this.attach(
    `the API reports ${revision.length} REVISION document(s); the candidate dashboard lists ` +
      `${cards.length} card(s), ${reachable.length} of them Revision Required:\n` +
      cards.map((c) => `  ${String(c.status).padEnd(18)} ${c.documentName}`).join('\n'),
    'text/plain'
  );

  // Prefer a card the dashboard lists. Failing that, say so plainly and name the gap -
  // this is a product limitation on what the candidate can reach, not a bad locator, and
  // the two must not read alike.
  expect(
    reachable.length,
    `The account holds ${revision.length} document(s) in REVISION but the candidate dashboard lists ` +
      `none of them (it shows ${cards.length} card(s) in total). The candidate therefore cannot see ` +
      'the revision remark for any of their revised documents. That is a PRODUCT limitation in what ' +
      '"Your Documents" surfaces, not a selector problem - Profile > Documents lists everything but ' +
      'only downloads on click, so it carries no remarks either.'
  ).to.be.greaterThan(0);

  // Match the reachable card back to its API row so later assertions can read the server's
  // view of the same document. EXACT on file_name, never a prefix: the account holds
  // "Screenshot_from_2026-03-25_19-33-48_RD5y5VY.png" AND
  // "Screenshot_from_2026-03-25_19-33-48-1_0qkiwZd.png", so a 30-character prefix matches
  // both and picking the first opened a document the dashboard does not list at all - the
  // same failure this step was just fixed for, one layer down. The repo's disambiguate()
  // discipline in AdminPromoToolsPage exists for exactly this.
  // Prefer a reachable document that actually carries an AUTOMATED-SYSTEM comment. The
  // scenario asserts that the candidate is shown the AI findings behind the decision, and
  // the reachable set includes documents decided by an agent months before AI verification
  // existed - on those the assertion is measuring the fixture, not the product. Each
  // candidate card is opened and its history read, and what was found is reported either
  // way, so "no reachable revised document carries an AI finding" is stated as the finding
  // it is rather than surfacing as a bare empty-history failure.
  const inspected = [];
  let chosen = null;
  for (const card of reachable) {
    await documents.openDocument(card.documentName);
    const history = await documents.readCommentHistory();
    const sources = history.map((h) => h.source).filter(Boolean);
    inspected.push({ document: card.documentName, entries: history.length, sources });
    await documents.closePanel();
    if (sources.some((src) => /automated|ai/i.test(src))) {
      chosen = card;
      break;
    }
  }
  await this.attach(
    'reachable Revision Required documents and the comment sources each shows:\n' +
      inspected.map((i) => `  ${i.document}  entries=${i.entries}  sources=${JSON.stringify(i.sources)}`).join('\n') +
      (chosen
        ? `\nselected "${chosen.documentName}" (it carries an automated-system comment)`
        : '\nNONE carries an automated-system comment; falling back to the first, so a failure below ' +
          'is about what the app shows for THESE documents, all of which were decided by an agent.'),
    'text/plain'
  );
  if (!chosen) chosen = reachable[0];

  const apiRow = revision.find((d) => String(d.file_name || '') === String(chosen.documentName)) || null;
  if (!apiRow) {
    await this.attach(
      `NOTE: the dashboard card "${chosen.documentName}" has no exactly-matching row in the API's ` +
        'REVISION list, so the server-side view of this document could not be paired with it. The ' +
        "candidate-facing assertions below still read the card, which is this scenario's subject.",
      'text/plain'
    );
  }
  // The UI is targeted by the name the dashboard itself rendered, so the open cannot land
  // on a different document than the one this step selected.
  s.revisionDocument = { file_name: chosen.documentName, apiRow };
  s.revisionCard = chosen;
});

// ---------------------------------------------------------------------------
// When: verification
// ---------------------------------------------------------------------------

When('the AI verifies the document', { timeout: AI_STEP }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  await verifyDocument(this, current(this));
});

When('the AI attempts to verify the document', { timeout: AI_STEP }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  // Same call, different name: used where an ERROR is the expected outcome, so the step
  // reads honestly in the scenario rather than promising a verdict.
  const s = state(this);
  const o = current(this);
  try {
    await verifyDocument(this, o);
  } catch (e) {
    // An AI that never produced a run is a timeout, which this scenario may legitimately
    // be asserting. Record it and let the Then decide.
    o.attemptError = e.message;
  }
  s.observed = o;
});

When('the AI verifies all uploaded documents', { timeout: AI_MULTI }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  const s = state(this);
  expect(s.multiple, 'no multi-document upload happened in this scenario').to.be.an('array').that.is.not.empty;
  for (const observed of s.multiple) await verifyDocument(this, observed);
});

// ---------------------------------------------------------------------------
// When: resubmission
// ---------------------------------------------------------------------------

When('the candidate resubmits a corrected document with the matching legal name', { timeout: AI_STEP }, async function () {
  const s = state(this);
  const previous = current(this);
  expect(previous.verification, 'the original document was never verified, so there is nothing to correct').to.exist;

  s.constraints = { kind: previous.doc.properties.kind, name: 'exact', content: 'complete' };
  const corrected = resolveDocument(this);
  const fixture = resolveFixture(corrected.file, corrected.id);
  const result = await s.api.resubmit(previous.doc.category, previous.upload.entryId, fixture);
  expect(
    result.accepted,
    `the corrected document was refused with HTTP ${result.httpStatus}: ${JSON.stringify(result.responseBody)}`
  ).to.equal(true);

  // Wait for a run NEWER than the one already recorded. Accepting any run would pass
  // instantly against the old result and prove nothing.
  const after = await s.api.waitForVerification(previous.doc.category, previous.upload.entryId, {
    afterVersion: previous.verification.version,
    afterCheckedAt: previous.verification.checked_at,
  });
  s.resubmission = {
    before: previous,
    doc: corrected,
    upload: result,
    verification: after.verification,
    document: after.document,
  };
  s.submitted.set(`${corrected.id}(resubmit)`, s.resubmission);
});

When('the candidate resubmits the same document unchanged', { timeout: AI_STEP }, async function () {
  const s = state(this);
  const previous = current(this);
  const fixture = resolveFixture(previous.doc.file, previous.doc.id);
  const result = await s.api.resubmit(previous.doc.category, previous.upload.entryId, fixture);
  expect(result.accepted, `the resubmission was refused with HTTP ${result.httpStatus}`).to.equal(true);
  const after = await s.api.waitForVerification(previous.doc.category, previous.upload.entryId, {
    afterVersion: previous.verification.version,
    afterCheckedAt: previous.verification.checked_at,
  });
  s.resubmission = { before: previous, doc: previous.doc, upload: result, verification: after.verification, document: after.document };
});

// ---------------------------------------------------------------------------
// Then: API-side verdicts
// ---------------------------------------------------------------------------

Then(
  /^the (identity|date|issuing institution|issuing organisation|transcript content|cross-document name|authenticity) (?:verification|validation) should (pass|fail|not pass)$/,
  function (phrase, outcome) {
    const key = CRITERION_BY_PHRASE[phrase];
    const c = criterion(this, key);
    const o = current(this);
    expect(
      c,
      `The AI did not evaluate "${key}" at all on ${o.doc.id}. Criteria present: ` +
        (verificationOf(this).criteria || []).map((x) => x.key).join(', ')
    ).to.not.equal(null);

    if (outcome === 'pass') {
      expect(c.verdict, `${o.doc.id} ${key}: expected pass, got "${c.verdict}" - ${c.detail}`).to.equal(VERDICT.PASS);
    } else if (outcome === 'fail') {
      expect(c.verdict, `${o.doc.id} ${key}: expected fail, got "${c.verdict}" - ${c.detail}`).to.equal(VERDICT.FAIL);
    } else {
      // "should not pass" covers fail AND uncertain. Used where the AC forbids approval
      // but does not require the AI to be certain, so pinning `fail` would invent a rule.
      expect(
        c.verdict,
        `${o.doc.id} ${key}: expected anything but a pass, got "${c.verdict}" - ${c.detail}`
      ).to.not.equal(VERDICT.PASS);
    }
  }
);

Then('the identity verification should reach a definite verdict', function () {
  const c = criterion(this, CRITERION.IDENTITY_NAME_MATCH);
  const o = current(this);
  expect(c, `identity_name_match was not evaluated on ${o.doc.id}`).to.not.equal(null);
  expect(
    c.verdict,
    `${o.doc.id}: the name variance should be resolved by a rule, one way or the other. An ` +
      `"uncertain" verdict means the rule is undefined for this shape of name. Detail: ${c.detail}`
  ).to.be.oneOf([VERDICT.PASS, VERDICT.FAIL]);
});

Then('the reason should explain how the name was compared', function () {
  const c = criterion(this, CRITERION.IDENTITY_NAME_MATCH);
  const detail = String((c && c.detail) || '');
  const problems = [];
  if (!detail.trim()) problems.push('the criterion carries no reason text at all');
  else {
    // The reason has to name at least one of the two names being compared, otherwise the
    // candidate cannot tell what the system thought their name was.
    const declared = state(this).data.declared.legal_name;
    const mentionsSomething = norm(detail).includes(norm(declared)) || /name/i.test(detail);
    if (!mentionsSomething) problems.push(`the reason does not refer to the name at all: "${detail}"`);
    if (detail.trim().length < 15) problems.push(`the reason is too short to act on: "${detail}"`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// The tracking guard, promoted into Gherkin so it is visible as coverage rather than
// buried in a helper. `upload()` already throws when the row it resolved was on the
// account beforehand; this step states the guarantee positively, and is what fails if a
// future change to uploadDocument() stops passing the snapshot at all - at which point
// the guard silently becomes a no-op and nothing else would notice.
Then('the verification result should belong to the document uploaded in this run', function () {
  const o = current(this);
  const u = o.upload;
  const problems = [];

  if (!o.priorDocumentIds) {
    problems.push(
      'No pre-upload snapshot was taken, so nothing proves the tracked row is the one this run ' +
        'created. uploadDocument() must call snapshotDocumentIds() and pass it to upload().'
    );
  }
  if (u.documentRowId === null || u.documentRowId === undefined) {
    problems.push('The upload produced no document row id, so no assertion can target the row it created.');
  } else if (o.priorDocumentIds && o.priorDocumentIds.has(u.documentRowId)) {
    problems.push(
      `Document row ${u.documentRowId} existed before this upload (the account held ` +
        `${o.priorDocumentIds.size} rows), so this scenario is reading an EARLIER run's verification.`
    );
  }
  // The verification actually asserted on must be the one hanging off that row, not a
  // row that merely happens to sit in the same entry.
  if (o.document && u.documentRowId != null && o.document.id != null && o.document.id !== u.documentRowId) {
    problems.push(
      `The polled document row (${o.document.id}) is not the row the upload created (${u.documentRowId}).`
    );
  }
  if (o.verification && !o.verification.checked_at) {
    problems.push('The verification carries no checked_at, so it cannot be dated to this run.');
  }

  expect(
    problems,
    `${o.doc.id} (${u.file}): document-identity tracking is unsound.\n  ` +
      problems.join('\n  ') +
      `\n  entry=${u.entryId} row=${u.documentRowId} rowIdSource=${u.rowIdSource}` +
      `\n  rows added by this upload: ${JSON.stringify(u.documentsAdded || null)}`
  ).to.deep.equal([]);
});

// >>> WHEN cross_document_consistency IS THE ONLY THING FAILING, SAY SO EXPLICITLY. <<<
//
// That criterion CANNOT PASS on this account and it is not a product defect. The candidate
// is dedicated but long-lived and holds documents naming other people - several of them
// ORPHANED, i.e. their profile entry is gone but the document row cannot be deleted,
// because the API exposes no DELETE for a document row anywhere. So a document that is
// genuinely clean on all five other criteria is still held back from Approved.
//
// Proved by consequence rather than inferred: ENG-01, the one fixture designed to pass
// every criterion, failed on this criterion AND ONLY THIS ONE.
//
// This matters for how a red row is read. "A valid certificate is automatically approved"
// going red looks like the product refusing to auto-approve clean documents - a serious
// finding - when the cause is test-account history. The remedies are recorded in
// Files/DOC_VERIFICATION_TEST_MATRIX.md section 9.2 and NONE IS CHOSEN YET, so this is
// surfaced rather than suppressed: the scenario is not weakened and not tagged
// @known-issue, because the requirement it asserts is real and unmet only for this reason.
function crossDocumentOnly(verification) {
  const failing = ((verification && verification.criteria) || []).filter((c) => c.verdict !== VERDICT.PASS);
  return failing.length > 0 && failing.every((c) => c.key === CRITERION.CROSS_DOCUMENT_CONSISTENCY);
}

Then('the document status should be {string}', function (label) {
  const o = current(this);
  const apiStatus = o.document && o.document.status;
  const shown = AgentVerificationsPage.STATUS_LABEL[apiStatus] || apiStatus;
  const failing = ((o.verification && o.verification.criteria) || [])
    .filter((c) => c.verdict !== VERDICT.PASS)
    .map((c) => `${c.key}=${c.verdict}`)
    .join(', ');

  const note = crossDocumentOnly(o.verification)
    ? '\n\n>>> cross_document_consistency IS THE ONLY FAILING CRITERION, WHICH IS THE KNOWN ' +
      'ACCOUNT-HISTORY CONDITION, NOT A PRODUCT DEFECT. <<<\nThis candidate holds documents ' +
      'naming other people, several of them orphaned and undeletable (the API has no DELETE ' +
      'for a document row), so no document on this account can pass that criterion. The ' +
      'document is otherwise clean on every other rule. Remedies: ' +
      'Files/DOC_VERIFICATION_TEST_MATRIX.md section 9.2 - none chosen yet. Do NOT file this ' +
      'as "the product will not auto-approve a valid document" without reading that first.'
    : '';

  expect(
    shown,
    `${o.doc.id}: expected the status shown as "${label}" but it is "${shown}" (API "${apiStatus}").\n` +
      `Failing criteria: ${failing || '(none)'}${note}`
  ).to.equal(label);
});

Then('no agent action should be required', function () {
  const o = current(this);
  const criteria = (o.verification && o.verification.criteria) || [];
  const notPassed = criteria.filter((c) => c.verdict !== VERDICT.PASS);
  const status = o.document && o.document.status;
  const problems = [];
  if (notPassed.length) {
    problems.push(
      `${o.doc.id} did not pass every criterion, so the auto-approval clause does not apply:\n` +
        notPassed.map((c) => `    ${c.key} = ${c.verdict}  ${c.detail}`).join('\n')
    );
  }
  if (status !== 'APPROVED') {
    problems.push(`${o.doc.id} is "${status}", not APPROVED, so a human still has to act on it.`);
  }
  expect(problems, problems.join('\n\n')).to.deep.equal([]);
});

Then('the document should not be automatically approved', function () {
  const o = current(this);
  const status = o.document && o.document.status;
  expect(
    status,
    `${o.doc.id} was APPROVED despite carrying a defect this scenario is about. Criteria: ` +
      ((o.verification && o.verification.criteria) || []).map((c) => `${c.key}=${c.verdict}`).join(', ')
  ).to.not.equal('APPROVED');
});

Then('the document should not be flagged for a name mismatch', function () {
  const c = criterion(this, CRITERION.IDENTITY_NAME_MATCH);
  const o = current(this);
  expect(
    c && c.verdict,
    `${o.doc.id} was flagged for a name mismatch when the name is the same person: "${c && c.detail}"`
  ).to.not.equal(VERDICT.FAIL);
});

Then('a name mismatch should be reported', function () {
  const c = criterion(this, CRITERION.IDENTITY_NAME_MATCH);
  const o = current(this);
  expect(c, `identity_name_match was not evaluated on ${o.doc.id}`).to.not.equal(null);
  expect(c.verdict, `${o.doc.id} identity_name_match = "${c.verdict}" (${c.detail})`).to.equal(VERDICT.FAIL);
  expect(String(c.detail || '').trim(), `${o.doc.id}: the mismatch carries no reason text`).to.not.equal('');
});

Then('no name mismatch should be reported', function () {
  const keys = [CRITERION.IDENTITY_NAME_MATCH, CRITERION.CROSS_DOCUMENT_CONSISTENCY];
  const bad = keys
    .map((k) => criterion(this, k))
    .filter((c) => c && c.verdict === VERDICT.FAIL)
    .map((c) => `${c.key}: ${c.detail}`);
  expect(bad, bad.join('\n')).to.deep.equal([]);
});

// The AC asks the reason to be actionable, which means it has to say what was compared
// against what. A reason that only says "mismatch" leaves the candidate guessing.
Then('the reason should name both the document name and the declared name', function () {
  const c = criterion(this, CRITERION.IDENTITY_NAME_MATCH);
  const declared = state(this).data.declared.legal_name;
  const detail = String((c && c.detail) || '');
  const problems = [];
  if (!norm(detail).includes(norm(declared))) {
    problems.push(`the reason does not quote the declared name "${declared}": "${detail}"`);
  }
  // The other name is whatever the AI extracted from the document.
  const extracted = (verificationOf(this).extracted || {}).legal_name;
  if (extracted && !norm(detail).includes(norm(extracted))) {
    problems.push(`the reason does not quote the name on the document "${extracted}": "${detail}"`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the reason should identify the conflicting document', function () {
  const c = criterion(this, CRITERION.CROSS_DOCUMENT_CONSISTENCY);
  expect(c, 'cross_document_consistency was not evaluated').to.not.equal(null);
  const detail = String(c.detail || '');
  expect(
    /another submitted document|document/i.test(detail) && detail.length > 20,
    `the cross-document reason does not identify what it conflicts with: "${detail}"`
  ).to.equal(true);
});

// ---------------------------------------------------------------------------
// Cross-validation: the four name sources, asserted SEPARATELY
// ---------------------------------------------------------------------------
// The rule compares four independent things and they fail for unrelated reasons:
//
//   1. the legal name DECLARED on the candidate account
//   2. the name the AI extracted from THIS document
//   3. the names the AI extracted from the candidate's OTHER documents
//   4. the cross_document_consistency verdict itself
//
// One combined "the names are consistent" assertion cannot tell them apart, and each
// mistaken diagnosis sends the reader somewhere different: (1) is a fixture/account
// problem, (2) is extraction, (3) is unremovable history on a shared account (four
// documents here genuinely name somebody else), (4) is the rule. So they are four steps.
// A scenario using them reports which layer broke, not merely that something did.

Then('the declared legal name should be recorded', { timeout: NET_STEP }, async function () {
  const s = state(this);
  const declared = s.data.declared.legal_name;
  const account = (s.identity && s.identity.declaredName) || '';
  expect(
    norm(account),
    `Source 1 of 4 (declared name). The test data declares "${declared}" but the account this run ` +
      `signed into is "${account}". Every name comparison below is measured against the declared ` +
      'name, so a mismatch here invalidates all of them - and it is a fixture/account problem, ' +
      'not an AI one.'
  ).to.equal(norm(declared));
  await this.attach(`source 1/4 declared name: "${declared}" (account "${account}")`, 'text/plain');
});

Then(
  'the name extracted from the current document should be recorded',
  { timeout: NET_STEP },
  async function () {
    const o = current(this);
    const v = verificationOf(this);
    const extracted = (v.extracted || {}).legal_name;
    expect(
      extracted === undefined || extracted === null || String(extracted).trim() === '',
      `Source 2 of 4 (this document). The AI recorded no legal_name for ${o.doc.id} (${o.upload.file}), ` +
        'so there is nothing for the identity or cross-document rules to compare. That is an ' +
        `extraction failure, distinct from a mismatch. extracted: ${JSON.stringify(v.extracted || null)}`
    ).to.equal(false);
    state(this).extractedName = String(extracted);
    await this.attach(`source 2/4 name on ${o.doc.id}: "${extracted}"`, 'text/plain');
  }
);

Then(
  "the names from the candidate's other documents should be recorded",
  { timeout: NET_STEP },
  async function () {
    const s = state(this);
    const o = current(this);
    const others = await s.api.otherDocumentNames({ excludeRowId: o.upload.documentRowId });
    s.otherDocumentNames = others;

    const named = others.filter((d) => d.legalName);
    const declared = s.data.declared.legal_name;
    const conflicting = named.filter((d) => norm(d.legalName) !== norm(declared));

    await this.attach(
      `source 3/4 names on the candidate's other documents (${others.length} row(s), ` +
        `${named.length} with an extracted name, ${conflicting.length} naming somebody else):\n` +
        named
          .slice(0, 40)
          .map((d) => `  row ${d.rowId}  ${String(d.status).padEnd(9)} "${d.legalName}"  ${d.file}`)
          .join('\n'),
      'text/plain'
    );

    // Not an assertion about the product: this is the corpus the rule is evaluated
    // against, and it has to be known before source 4 means anything. It fails only if
    // the corpus could not be read at all, because then source 4 has no baseline.
    expect(
      others.length,
      'Source 3 of 4 (other documents). The account reported no other document rows at all, so ' +
        'cross_document_consistency has nothing to compare against and its verdict cannot be ' +
        'interpreted. Expected this long-lived candidate to hold prior documents.'
    ).to.be.greaterThan(0);
  }
);

Then('the cross-document consistency verdict should follow from those names', function () {
  const s = state(this);
  const o = current(this);
  const c = criterion(this, CRITERION.CROSS_DOCUMENT_CONSISTENCY);
  expect(c, `Source 4 of 4: cross_document_consistency was not evaluated on ${o.doc.id}`).to.not.equal(null);

  const others = s.otherDocumentNames;
  expect(
    others,
    'Source 4 of 4 needs source 3: a "the names on the candidate other documents should be recorded" ' +
      'step must run before this assertion.'
  ).to.not.equal(undefined);

  const declared = s.data.declared.legal_name;
  const thisName = s.extractedName || (verificationOf(this).extracted || {}).legal_name || null;
  const conflicting = others.filter((d) => d.legalName && norm(d.legalName) !== norm(thisName || declared));

  // The verdict has to be CONSISTENT with the three recorded sources. Only one direction
  // is a hard finding: claiming a conflict while no other document names anybody else is
  // unexplainable, whereas passing despite a conflicting document is the app's own
  // tolerance rule and is recorded rather than failed - the AC does not define how many
  // conflicting documents make a conflict.
  const problems = [];
  if (c.verdict === VERDICT.FAIL && !conflicting.length) {
    problems.push(
      `the verdict is "fail" but no other document on the account names anybody other than ` +
        `"${thisName || declared}", so the conflict it reports has no source. Detail: "${c.detail}"`
    );
  }
  if (c.verdict === VERDICT.PASS && conflicting.length) {
    // Recorded, not failed - see above.
    this.attach(
      `NOTE: cross_document_consistency passed while ${conflicting.length} other document(s) name ` +
        `somebody else (${conflicting.slice(0, 5).map((d) => `"${d.legalName}"`).join(', ')}). ` +
        'The AC does not state how much history a conflict is judged against, so this is reported ' +
        'rather than failed. Worth a product answer.',
      'text/plain'
    );
  }

  expect(
    problems,
    `${o.doc.id}: source 4 of 4 (the verdict) does not follow from sources 1-3.\n  ` +
      problems.join('\n  ') +
      `\n  declared="${declared}" thisDocument="${thisName}" ` +
      `otherDocumentsNamingSomeoneElse=${conflicting.length}/${others.length}`
  ).to.deep.equal([]);
});

Then('the document should not be flagged because of the expiry date', function () {
  const c = criterion(this, CRITERION.DATE_VALIDITY);
  const detail = String((c && c.detail) || '');
  const problems = [];
  if (c && c.verdict === VERDICT.FAIL) problems.push(`date_validity failed: "${detail}"`);
  if (/future/i.test(detail) && c && c.verdict !== VERDICT.PASS) {
    problems.push(`the reason blames the future date on a document that is current: "${detail}"`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the transcript content criterion should not have been applied', function () {
  const c = criterion(this, CRITERION.TRANSCRIPT_CONTENT);
  const o = current(this);
  expect(
    c,
    `${o.doc.id} is a ${o.doc.properties.kind}, not a transcript, so transcript_content should not ` +
      `have been evaluated. It was: "${c && c.verdict}" - ${c && c.detail}`
  ).to.equal(null);
});

// The AC asks for EVERY missing field, not the first one the model happened to notice -
// a candidate told only about the missing degree will resubmit and be refused again for
// the major. So this reads the transcript_content reason and requires it to name each
// field the fixture is recorded as lacking, rather than counting failed criteria.
//
// The field the fixture omits is taken from its own `content` property, so the step
// cannot drift from the document: a fixture rebuilt to omit something else changes what
// is demanded here automatically.
const MISSING_FIELD_WORDS = {
  degree: { field: 'degree awarded', words: [/degree/i] },
  major: { field: 'major or field of study', words: [/major/i, /field of study/i] },
  graduation_date: { field: 'graduation or conferral date', words: [/graduat/i, /conferral/i, /date/i] },
};

// properties.content -> the one field that fixture omits. `missing_multiple` is
// deliberately absent: it does not say WHICH fields, so the document has to.
const CONTENT_TO_FIELD = {
  missing_degree: 'degree',
  missing_major: 'major',
  missing_date: 'graduation_date',
};

Then('every missing required field should be reported', function () {
  const o = current(this);
  const c = criterion(this, CRITERION.TRANSCRIPT_CONTENT);
  expect(c, `transcript_content was not evaluated on ${o.doc.id}`).to.not.equal(null);
  const detail = String((c && c.detail) || '');

  // Which fields are absent is read off the DOCUMENT, never inferred from the property
  // name. CONT-03 is "only degree" - it KEEPS the degree and omits the other two - so
  // treating missing_multiple as "all three" would demand the AI report a field that is
  // present, and the step would fail on a correct answer.
  const missing =
    o.doc.content_missing ||
    (CONTENT_TO_FIELD[o.doc.properties.content] ? [CONTENT_TO_FIELD[o.doc.properties.content]] : []);
  const unknown = missing.filter((m) => !MISSING_FIELD_WORDS[m]);
  expect(
    unknown,
    `${o.doc.id} declares content_missing entries with no wording registered: ${unknown.join(', ')}. ` +
      `Known: ${Object.keys(MISSING_FIELD_WORDS).join(', ')}`
  ).to.deep.equal([]);
  const absent = missing.map((m) => MISSING_FIELD_WORDS[m]);

  expect(
    absent.length,
    `${o.doc.id} is not recorded as missing more than one transcript field (content: ` +
      `"${o.doc.properties.content}", content_missing: ${JSON.stringify(o.doc.content_missing || null)}), ` +
      'so this step would assert nothing.'
  ).to.be.greaterThan(1);

  const unreported = absent.filter((f) => !f.words.some((w) => w.test(detail)));
  expect(
    unreported.map((f) => f.field),
    `${o.doc.id} omits ${absent.length} required fields but the reason names only some of them. ` +
      'A candidate told about one missing field at a time resubmits once per field.\n' +
      `  not named: ${unreported.map((f) => f.field).join(', ')}\n` +
      `  reason given: "${detail}"`
  ).to.deep.equal([]);

  const silent = !detail.trim();
  expect(silent, `${o.doc.id}: transcript_content failed with no reason text at all`).to.equal(false);
});

Then('the AI should report that it found nothing to verify', function () {
  const v = verificationOf(this);
  const o = current(this);
  const criteria = v.criteria || [];
  // Either an explicit error, or every content-bearing criterion unable to pass. A blank
  // document that comes back all-pass is the defect this asserts against.
  const passed = criteria.filter((c) => c.verdict === VERDICT.PASS).map((c) => c.key);
  const reported = Boolean(v.error) || passed.length === 0;
  expect(
    reported,
    `${o.doc.id} is blank, but the AI passed ${passed.length} criteria on it (${passed.join(', ')}) ` +
      'and reported no error. A document with no content cannot satisfy a verification criterion.'
  ).to.equal(true);
});

Then('no criterion should be judged confidently on the unreadable document', function () {
  const v = verificationOf(this);
  const o = current(this);
  const confident = (v.criteria || [])
    .filter((c) => c.verdict !== VERDICT.UNCERTAIN)
    .map((c) => `${c.key}=${c.verdict} ("${c.detail}")`);
  expect(
    confident,
    `${o.doc.id} is deliberately illegible, so every criterion that depends on reading it should be ` +
      'uncertain. A confident verdict on an unreadable document is the defect.'
  ).to.deep.equal([]);
});

Then('the AI should have extracted the applicant name from the document', function () {
  const v = verificationOf(this);
  const o = current(this);
  const extracted = (v.extracted || {}).legal_name;
  expect(
    norm(extracted),
    `${o.doc.id} is blurry but legible, so the name should still be read. Extracted: ` +
      `"${extracted === undefined ? '(field absent)' : extracted}"`
  ).to.equal(norm(state(this).data.declared.legal_name));
});

// ---------------------------------------------------------------------------
// Then: multi-document independence
// ---------------------------------------------------------------------------

Then('each document should carry its own verification result', function () {
  const s = state(this);
  const problems = [];
  const seen = new Set();
  for (const o of s.multiple) {
    if (!o.verification) problems.push(`${o.doc.id} has no verification result`);
    else {
      const key = `${o.verification.checked_at}|${o.upload.documentRowId}`;
      if (seen.has(key)) problems.push(`${o.doc.id} shares a verification record with another document`);
      seen.add(key);
    }
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('only the document naming a different person should be flagged for a name mismatch', function () {
  const s = state(this);
  const problems = [];
  for (const o of s.multiple) {
    const c = (o.verification.criteria || []).find((x) => x.key === CRITERION.IDENTITY_NAME_MATCH);
    const shouldFail = o.doc.properties.name === 'different_person';
    const didFail = c && c.verdict === VERDICT.FAIL;
    if (shouldFail && !didFail) {
      problems.push(`${o.doc.id} names a different person but identity_name_match = "${c && c.verdict}"`);
    }
    if (!shouldFail && didFail) {
      problems.push(
        `${o.doc.id} names the applicant correctly but was flagged: "${c.detail}". One document's ` +
          "defect must not contaminate another's result."
      );
    }
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Then: resubmission
// ---------------------------------------------------------------------------

Then('the corrected document should be accepted', function () {
  const r = state(this).resubmission;
  expect(r, 'no resubmission happened in this scenario').to.exist;
  expect(r.upload.accepted, `the resubmission was refused with HTTP ${r.upload.httpStatus}`).to.equal(true);
});

Then('a new AI verification cycle should start', function () {
  const r = state(this).resubmission;
  expect(r, 'no resubmission happened in this scenario').to.exist;
  const problems = [];
  if (!(Number(r.verification.version) > Number(r.before.verification.version))) {
    problems.push(`version did not advance: ${r.before.verification.version} -> ${r.verification.version}`);
  }
  if (!(Date.parse(r.verification.checked_at) > Date.parse(r.before.verification.checked_at))) {
    problems.push(`checked_at did not advance: ${r.before.verification.checked_at} -> ${r.verification.checked_at}`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the previous verification result should not be reused', function () {
  const r = state(this).resubmission;
  expect(
    r.verification.checked_at,
    'the resubmitted document carries the SAME checked_at as the original run, so the old result was reused'
  ).to.not.equal(r.before.verification.checked_at);
});

Then('the superseded name mismatch should no longer be reported', function () {
  const r = state(this).resubmission;
  expect(r, 'no resubmission happened in this scenario').to.exist;
  const stale = (r.before.verification.criteria || []).find((c) => c.key === CRITERION.IDENTITY_NAME_MATCH);
  const now = (r.verification.criteria || []).find((c) => c.key === CRITERION.IDENTITY_NAME_MATCH);

  const problems = [];
  if (now && now.verdict === VERDICT.FAIL) {
    problems.push(
      `identity_name_match still fails after the correction: "${now.detail}". The corrected document ` +
        'names the applicant, so the new run should not repeat the old finding.'
    );
  }
  // The stale COMMENT is the other half: it is what the candidate is still shown.
  const staleName = stale && (/'([^']+)'/.exec(stale.detail) || [])[1];
  if (staleName && norm(staleName) !== norm(state(this).data.declared.legal_name)) {
    const lingering = ((r.document && r.document.comments) || []).filter((c) =>
      String(c.comment || '').includes(staleName)
    );
    if (lingering.length) {
      problems.push(
        `${lingering.length} comment(s) still quote the superseded name "${staleName}":\n` +
          lingering.map((c) => `    [${c.source}] ${c.comment}`).join('\n')
      );
    }
  }
  expect(problems, problems.join('\n\n')).to.deep.equal([]);
});

Then('the new verification result should be shown', function () {
  const r = state(this).resubmission;
  expect((r.verification.criteria || []).length, 'the new run produced no criteria at all').to.be.greaterThan(0);
  expect(r.document && r.document.status, 'the resubmitted document has no status').to.be.a('string');
});

Then('the same criterion should fail again', function () {
  const r = state(this).resubmission;
  const before = (r.before.verification.criteria || []).filter((c) => c.verdict === VERDICT.FAIL).map((c) => c.key);
  const after = (r.verification.criteria || []).filter((c) => c.verdict === VERDICT.FAIL).map((c) => c.key);
  const cleared = before.filter((k) => !after.includes(k));
  expect(
    cleared,
    `the same document was resubmitted unchanged, so nothing should have been cleared. These were: ${cleared.join(', ')}`
  ).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Then: file validation
// ---------------------------------------------------------------------------

Then('every allowed format should have been accepted', { timeout: AI_MULTI }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  const s = state(this);
  const refused = [...s.submitted.values()].filter((o) => !o.upload.accepted);
  expect(s.submitted.size, 'no document was uploaded in this scenario').to.be.greaterThan(0);
  expect(
    refused.map((o) => `${o.doc.id} (${o.upload.contentType}) -> HTTP ${o.upload.httpStatus} ${JSON.stringify(o.upload.responseBody)}`),
    'these allowed formats were refused'
  ).to.deep.equal([]);
});

Then('the upload should have been refused', { timeout: AI_STEP }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  const o = current(this);
  expect(
    o.upload.accepted,
    `${o.doc.id} (${o.upload.bytesSent} bytes, ${o.upload.contentType}) was ACCEPTED with HTTP ` +
      `${o.upload.httpStatus} where a refusal is required. Response: ${JSON.stringify(o.upload.responseBody)}`
  ).to.equal(false);
});

Then('the upload should have been accepted', { timeout: AI_STEP }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  const o = current(this);
  expect(
    o.upload.accepted,
    `${o.doc.id} (${o.upload.bytesSent} bytes, ${o.upload.contentType}) was REFUSED with HTTP ` +
      `${o.upload.httpStatus}. Response: ${JSON.stringify(o.upload.responseBody)}`
  ).to.equal(true);
});

Then('the refusal should identify the accepted formats', function () {
  const o = current(this);
  const body = JSON.stringify(o.upload.responseBody || {});
  const problems = [];
  if (o.upload.httpStatus !== 422) {
    problems.push(`refused with HTTP ${o.upload.httpStatus}, expected a 422 validation refusal`);
  }
  if (!/\.(pdf|png|jpe?g|webp)/i.test(body)) {
    problems.push(`the refusal does not name any accepted format. Body: ${body}`);
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('an AI processing error should be reported', function () {
  const o = current(this);
  expect(o.upload.accepted, `${o.doc.id} was refused at upload, so no AI run happened`).to.equal(true);
  const error = (o.verification && o.verification.error) || null;
  expect(
    error,
    `${o.doc.id} is ${o.upload.bytesSent} bytes, over the model's inline limit, so the AI cannot ` +
      `verify it and must say so. No error was reported.${o.attemptError ? ` (the wait also reported: ${o.attemptError})` : ''}`
  ).to.be.a('string').and.not.empty;
});

Then('the result should be reported as an error rather than as a verification verdict', function () {
  const o = current(this);
  const v = o.verification || {};
  const problems = [];
  const failed = (v.criteria || []).filter((c) => c.verdict === VERDICT.FAIL);
  if (failed.length) {
    problems.push(
      `the AI errored ("${v.error}") but still returned ${failed.length} FAIL verdict(s) ` +
        `(${failed.map((c) => c.key).join(', ')}). A run that could not happen must not produce ` +
        'verdicts - the candidate would be told their document is wrong when it was never read.'
    );
  }
  if (o.document && o.document.status === 'REVISION') {
    problems.push(
      'the AI errored but the document was moved to REVISION, which asks the candidate to fix a ' +
        'document that was never assessed.'
    );
  }
  expect(problems, problems.join('\n\n')).to.deep.equal([]);
});

Then('the document should be served by a time-limited presigned link', { timeout: NET_STEP }, async function () {
  const s = state(this);
  const o = current(this);
  const url = o.document && o.document.file;
  expect(url, `${o.doc.id} has no file URL on its document row`).to.be.a('string').and.not.empty;

  const dl = await s.api.downloadDocumentFile(url);
  const problems = [];
  if (!dl.presigned) problems.push(`the URL carries no X-Amz-Signature, so the object is not presigned: ${url.split('?')[0]}`);
  if (!dl.expiresInSeconds) problems.push('the URL carries no X-Amz-Expires, so the link does not expire');
  if (dl.expiresInSeconds && dl.expiresInSeconds > 3600) problems.push(`the link is valid for ${dl.expiresInSeconds}s, longer than an hour`);
  if (!dl.ok) problems.push(`the presigned link did not serve the document: HTTP ${dl.httpStatus}`);
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Agent portal (UI)
// ---------------------------------------------------------------------------

// Sign in on a given page. Uses LoginPage's real contract - navigate() plus the three
// locators - and retries only the NAVIGATION, never the credential submission, so a
// genuinely rejected login still fails once. Copied deliberately from the pattern in
// 2fa.steps.js, which records why: a single flaky page.goto is a red row that says
// nothing about the feature under test.
async function signInAs(world, page, email, password, who) {
  const LoginPage = require('../pages/LoginPage');
  const login = new LoginPage(page);
  try {
    await login.navigate();
  } catch (e) {
    world.attach(`${who} login navigation failed (${e.message.split('\n')[0]}) - retrying once`, 'text/plain');
    await login.navigate();
  }
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page
    .waitForURL((u) => !/\/login(\/|\?|$)/.test(String(u)), { timeout: 90000 })
    .catch(() => {
      throw new Error(`${who} sign-in did not leave /login. Still at ${page.url()}`);
    });
  // No networkidle here: waitForURL already proved the navigation happened, and the
  // dashboard polls, so networkidle is an unbounded wait for no extra certainty.
}

// ---------------------------------------------------------------------------
// SESSION REUSE - why this exists and why it is safe
// ---------------------------------------------------------------------------
// MEASURED 2026-08-24 (scripts/probe-verification-load-timing.js): reaching a usable
// login form on DEV takes 6-8 SECONDS (goto 3.1-5.3s, then ~3.0s for the form to paint),
// and the credential round trip another ~2.3s. hooks.js gives every scenario a fresh
// context, so without this every UI scenario paid ~9s to sign in again.
//
// The app keeps its session in a `refresh_token` COOKIE (verified: no access token in
// localStorage; the SPA calls POST /auth/token/refresh/ on load). So the storage state
// can be captured once and replayed into each new context.
//
// The fallback is the important part: if the replayed session is stale the app bounces to
// /login, and this signs in for real and re-captures. A cached session that quietly
// stopped working would otherwise surface as a mysterious "element not found" on a login
// page nobody expected to be looking at.
let cachedAgentState = null;

async function agentSignIn(world) {
  const s = state(world);
  if (s.agentSignedIn) return;

  if (cachedAgentState) {
    await world.context.addCookies(cachedAgentState.cookies).catch(() => {});
    await world.page.goto(`${(process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '')}/verifications?activeFilter=all`, {
      waitUntil: 'domcontentloaded',
    });
    // Did the replayed session hold? The app bounces an unauthenticated visitor to /login.
    const bounced = await world.page
      .waitForURL((u) => /\/login/.test(String(u)), { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (!bounced) {
      s.agentSignedIn = true;
      return;
    }
    world.attach('the cached agent session was stale - signing in again', 'text/plain');
    cachedAgentState = null;
  }

  await signInAs(world, world.page, process.env.DOC_AGENT_EMAIL, process.env.DOC_AGENT_PASSWORD, 'agent');
  cachedAgentState = await world.context.storageState();
  s.agentSignedIn = true;
}

// "That document" is whichever document the scenario established, and there are three
// ways a scenario can establish one: it uploaded it, or it picked an already-decided one,
// or it picked one already in revision. Resolving all three here rather than assuming an
// upload is what lets the queue and no-decision-controls scenarios share this step - and a
// scenario that established nothing gets a message saying so rather than a null dereference.
function subjectFileName(world) {
  const s = state(world);
  if (s.decidedDocument) return s.decidedDocument.file_name;
  if (s.revisionDocument) return s.revisionDocument.file_name;
  const o = s.observed;
  if (!o) {
    throw new Error(
      'This step needs a document, but the scenario has not established one. Use an upload ' +
        'Given, or one of the Givens that selects an existing document.'
    );
  }
  return o.upload.uploadedFileName || o.doc.file;
}

async function openInReviewScreen(world) {
  const s = state(world);
  const stored = subjectFileName(world);
  await agentSignIn(world);
  const agent = world.pages.agentVerifications;
  await agent.open('ALL');
  // SEARCH by the stem (the API appends a random suffix, and the search box narrows the
  // grid), but OPEN by the full stored filename including its extension.
  //
  // Opening by the stem was ambiguous and got worse with every run. The account now holds
  // both `NAME-03_transcript_different_name_NS6EM35.pdf` and
  // `NAME-03_transcript_different_name_NS6EM35_AcaNqtk.pdf` - the same fixture uploaded
  // twice, each with its own suffix - so the first name's stem is a PREFIX of the second
  // and findRow() correctly refused to guess between them. Passing the full name lets its
  // exact-match branch settle it. Since uploads here are permanent, this collision is
  // permanent too and will recur for every fixture uploaded more than once.
  await agent.search(stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 40));
  s.agentOpened = await agent.openDocument(stored);
  s.agentPanel = await agent.readPanel();
  await world.attach(`agent panel:\n${JSON.stringify(s.agentPanel, null, 1)}`, 'text/plain');
  return s.agentPanel;
}

When('the agent opens that document in the review screen', { timeout: UI_STEP }, async function () {
  await openInReviewScreen(this);
});

// The decision controls only exist inside an OPEN review panel, so a commit step has to
// guarantee one rather than assume it. Without this, "the agent requests a revision on that
// document with a reason" clicked a control on a page where no document was open and failed
// as `locator.click: Timeout 30000ms exceeded` against
// `[data-testid="agent-request-revision-button"]` - which reads as a missing or renamed test
// id, and is not one. Measured 2026-08-25: the scenario's Gherkin simply never opened the
// document first, and the step had never been run live to notice.
async function ensureReviewPanelOpen(world) {
  const s = state(world);
  if (s.agentPanel) return s.agentPanel;
  return openInReviewScreen(world);
}

When('the agent opens the verification queue', { timeout: UI_STEP }, async function () {
  // Flush point: this is a step that can directly follow the Given block, so the queued
  // uploads happen here. A no-op once the queue is empty.
  await flushUploads(this);
  await agentSignIn(this);
  const agent = this.pages.agentVerifications;
  await agent.open('ALL');
  state(this).queueRows = await agent.readRows();
});

Then('the original document should be displayed', { timeout: UI_STEP }, async function () {
  const viewer = await this.pages.agentVerifications.documentViewer();
  expect(
    viewer.present,
    'The AC requires the original document to be visible alongside the summary. No viewer element ' +
      `with a usable box was found (tag=${viewer.tag}, ${viewer.width}x${viewer.height}).`
  ).to.equal(true);
});

Then('the AI verification summary should be displayed', function () {
  const p = state(this).agentPanel;
  expect(p, 'the agent panel was never read').to.exist;
  const problems = [];
  if (!p.flaggedFor || !p.flaggedFor.present) problems.push('no "Flagged for" summary block is present');
  if (!p.status) problems.push('the panel shows no Status');
  if (!p.documentName) problems.push('the panel shows no Document Name');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// Compares what the AGENT IS SHOWN against what the API decided. This is the step that
// justifies reading the UI at all: a criterion that failed in the API but is absent from
// the panel means the agent is asked to decide without the reason.
// One implementation, three wordings. The two narrowed forms exist because the
// end-to-end scenarios are about ONE rule reaching the agent: on a document that also
// fails something unrelated (and these fixtures usually do - a transcript naming somebody
// else may also trip cross_document_consistency), the broad form fails for a reason that
// has nothing to do with the journey under test, and the report then blames the wrong
// rule. `only` narrows the check without weakening it: the criterion named must be
// present, failed, and explained.
function assertFailedCriteriaListed(world, only) {
  const s = state(world);
  const shown = (s.agentPanel && s.agentPanel.flaggedFor) || { reasons: [] };
  let failed = (verificationOf(world).criteria || []).filter((c) => c.verdict !== VERDICT.PASS);
  const blob = norm(shown.reasons.join(' '));

  const problems = [];
  if (only) {
    const target = failed.filter((c) => c.key === only);
    if (!target.length) {
      const all = (verificationOf(world).criteria || []).map((c) => `${c.key}=${c.verdict}`).join(', ');
      problems.push(
        `"${only}" did not fail on this document, so the panel has nothing to list for it. ` +
          `The scenario needs a document that fails this rule. Verdicts: ${all}`
      );
    }
    failed = target;
  } else if (!failed.length) {
    problems.push('no criterion failed on this document, so this step asserted nothing');
  }

  for (const c of failed) {
    // Match on a distinctive fragment of the API detail rather than the whole string:
    // the panel prefixes each reason with a label ("Name mismatch detected: ") and may
    // punctuate differently.
    const fragment = norm(String(c.detail || '').split(/[.:]/)[0]).slice(0, 30);
    if (fragment && !blob.includes(fragment)) {
      problems.push(
        `the panel does not show the reason for "${c.key}" (${c.verdict}).\n` +
          `    API detail: ${c.detail}\n` +
          `    panel shows: ${shown.reasons.join(' | ') || '(nothing)'}`
      );
    }
  }
  expect(problems, problems.join('\n\n')).to.deep.equal([]);
}

Then('the failed criteria should be listed with their reasons', function () {
  assertFailedCriteriaListed(this, null);
});

Then('every failed criterion should be listed with its reason', function () {
  assertFailedCriteriaListed(this, null);
});

Then('the failed identity criterion should be listed with its reason', function () {
  assertFailedCriteriaListed(this, CRITERION.IDENTITY_NAME_MATCH);
});

Then('the failed institution criterion should be listed with its reason', function () {
  assertFailedCriteriaListed(this, CRITERION.ISSUING_ORGANISATION);
});

// The AC: the candidate (and the agent) must see WHO flagged the document. Measured, the
// panel ends the "Flagged for" block with "Automated System Message" for an AI finding.
Then('the summary should show that it was flagged by the automated system', function () {
  const shown = (state(this).agentPanel && state(this).agentPanel.flaggedFor) || {};
  const by = shown.flaggedBy;
  expect(
    by,
    'The "Flagged for" block names no source, so neither the agent nor the candidate can tell ' +
      `whether a human or the AI raised these findings. Block contents: ${JSON.stringify(shown.reasons)}`
  ).to.be.a('string').and.not.empty;
  expect(
    /automated|system|ai/i.test(by),
    `the finding is the AI's, but the source reads "${by}". Note the app's label is ` +
      '"Automated System Message", not the AC\'s "AI Review" - a wording divergence worth raising ' +
      'with the PO, but not a functional defect.'
  ).to.equal(true);
});

When(/^the agent opens the (revision|approval) decision$/, { timeout: UI_STEP }, async function (kind) {
  const s = state(this);
  const decision = kind === 'approval' ? 'approve' : 'revision';
  s.decisionKind = decision;
  s.decisionDialog = await this.pages.agentVerifications.openDecisionDialog(decision);
});

// Probes the gate WITHOUT submitting. Reads the field back rather than assuming, and
// records every observation so a red row shows all three states at once.
async function probeGate(world, reason) {
  const s = state(world);
  expect(s.decisionDialog, 'no decision dialog is open').to.exist;
  const obs = await world.pages.agentVerifications.probeReasonGating(s.decisionDialog, s.decisionKind, reason);
  s.gating.push({ decision: s.decisionKind, ...obs });
  return obs;
}

Then('the decision cannot be submitted with no reason', { timeout: UI_STEP }, async function () {
  const obs = await probeGate(this, '');
  expect(
    obs.submitDisabled,
    `the ${state(this).decisionKind} decision can be submitted with an empty reason, but the AC makes ` +
      'the reason mandatory'
  ).to.equal(true);
});

Then('the decision cannot be submitted with only spaces', { timeout: UI_STEP }, async function () {
  const obs = await probeGate(this, '   ');
  expect(
    obs.submitDisabled,
    `the ${state(this).decisionKind} decision can be submitted with a whitespace-only reason ` +
      `(field held ${JSON.stringify(obs.fieldValue)}), which satisfies the control but not the requirement`
  ).to.equal(true);
});

// Split into a When that acts and a Then that observes, because the scenario reads
// "...cannot be submitted with only spaces / When the agent enters a meaningful reason /
// Then the decision should become enabled". Typing inside the assertion would make the
// gate's two directions look like one step, and the report could not show which half
// failed. The gate is left in the state the When put it in - nothing is submitted here.
When('the agent enters a meaningful reason', { timeout: UI_STEP }, async function () {
  const s = state(this);
  s.gateReason = 'The name on this document does not match your profile. Please upload a corrected copy.';
  s.gateObserved = await probeGate(this, s.gateReason);
});

Then('the decision should become enabled', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const obs = s.gateObserved;
  expect(obs, 'no reason was entered - "the agent enters a meaningful reason" must run first').to.exist;
  expect(
    obs.submitDisabled,
    `the ${s.decisionKind} decision is still blocked after a valid reason was entered ` +
      `(field held ${JSON.stringify(obs.fieldValue)}), so the decision cannot be made at all`
  ).to.equal(false);
});

When('the agent requests a revision on that document with a reason', { timeout: UI_STEP }, async function () {
  const s = state(this);
  await ensureReviewPanelOpen(this);
  const agent = this.pages.agentVerifications;
  const dialog = await agent.openDecisionDialog('revision');
  s.agentReason = `Automated check: the name on this document does not match your profile. Please upload a corrected copy. [${Date.now()}]`;
  s.decisionResult = await agent.submitDecision(dialog, 'revision', s.agentReason);
  await this.attach(`agent decision committed: ${JSON.stringify(s.decisionResult)}`, 'text/plain');
  // Re-read from the API so the status assertion reflects the server, not the panel.
  const o = current(this);
  const entry = await s.api.fetchEntry(o.doc.category, o.upload.entryId);
  o.document = entry.document;
});

// The notification baseline. Taken BEFORE the decision, and it has to be: this candidate
// is long-lived, so counting notifications cannot tell one raised by this run from one
// left by a run last week. Same rule the promo and agent-email features follow.
Given('the candidate notifications are noted', { timeout: NET_STEP }, async function () {
  const s = state(this);
  s.notificationBaseline = await s.api.snapshotNotificationIds();
  await this.attach(
    `notification baseline: ${s.notificationBaseline.size} notification(s) already on the account`,
    'text/plain'
  );
});

// The approval twin of the revision commit above. Its own step rather than a parameter on
// one shared step, because they are opposite irreversible actions and submitDecision()
// deliberately refuses to click a control whose label does not match the decision asked
// for - the two dialogs share a data-testid, so the decision has to be named explicitly.
When('the agent approves that document with a reason', { timeout: UI_STEP }, async function () {
  const s = state(this);
  await ensureReviewPanelOpen(this);
  const agent = this.pages.agentVerifications;
  const dialog = await agent.openDecisionDialog('approve');
  s.agentReason = `Automated check: reviewed against the candidate's declared details and accepted. [${Date.now()}]`;
  s.decisionResult = await agent.submitDecision(dialog, 'approve', s.agentReason);
  await this.attach(`agent decision committed: ${JSON.stringify(s.decisionResult)}`, 'text/plain');
  const o = current(this);
  const entry = await s.api.fetchEntry(o.doc.category, o.upload.entryId);
  o.document = entry.document;
});

// >>> EACH DOCUMENT IS SEARCHED FOR, NOT LOOKED FOR IN ONE PAGE OF THE QUEUE. <<<
//
// This used to read the snapshot taken when the queue opened and expect all three rows in
// it. That snapshot is ONE PAGE. The agent queue spans every candidate - it read 250+
// document rows on this account at last measure - so three documents uploaded seconds ago
// are not reliably on it, and all three were reported as "does not appear in the queue"
// on a run where they existed perfectly well. That failure reads as the product losing
// documents, which is a serious and completely wrong conclusion.
//
// Searching per document also makes the assertion the one the scenario actually claims:
// each document is present and carries ITS OWN status. The search term is the stem, which
// may match earlier uploads of the same fixture; the row is then matched on the FULL
// stored name, which is unique because of the suffix the server appends.
Then('each uploaded document should appear with its own status', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const agent = this.pages.agentVerifications;
  expect(s.multiple, 'no multi-document upload happened in this scenario').to.be.an('array').that.is.not.empty;

  const problems = [];
  const seen = [];
  for (const o of s.multiple) {
    const stored = o.upload.uploadedFileName || o.doc.file;
    const stem = stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 30);
    await agent.search(stem);
    const rows = await agent.readRows();
    const row = rows.find((r) => r.documentName === stored) || rows.find((r) => r.documentName.includes(stored));
    if (!row) {
      problems.push(
        `${o.doc.id} (stored as "${stored}") is not listed when the queue is searched for "${stem}". ` +
          `The search returned ${rows.length} row(s): ${rows.slice(0, 5).map((r) => r.documentName).join(', ')}`
      );
      continue;
    }
    const expectedLabel = AgentVerificationsPage.STATUS_LABEL[o.document.status];
    seen.push(`${o.doc.id} -> "${row.status}" (API ${o.document.status})`);
    if (!row.status.includes(expectedLabel)) {
      problems.push(
        `${o.doc.id}: the queue shows "${row.status}" but the API says ${o.document.status} ("${expectedLabel}")`
      );
    }
  }
  await agent.search('');
  await this.attach(`queue rows found by search:\n  ${seen.join('\n  ')}`, 'text/plain');
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('the queue should offer filters for the statuses it displays', { timeout: UI_STEP }, async function () {
  const agent = this.pages.agentVerifications;
  const problems = [];
  for (const [status, testid] of Object.entries(AgentVerificationsPage.TAB_TESTID)) {
    const tab = this.page.locator(`[data-testid="${testid}"]`);
    if (!(await tab.count())) {
      problems.push(`no filter tab for ${status} (expected data-testid="${testid}")`);
      continue;
    }
    const label = (await tab.first().innerText()).trim();
    const expected = AgentVerificationsPage.TAB_LABEL[status];
    if (label !== expected) {
      problems.push(`the ${status} tab reads "${label}", recorded as "${expected}"`);
    }
  }
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Candidate portal (UI)
// ---------------------------------------------------------------------------

// The candidate's session, replayed rather than re-entered.
//
// MEASURED 2026-08-24 (scripts/probe-verification-load-timing.js): reaching a usable login
// form on DEV costs 6-8 SECONDS, and the credential round trip another ~2.3s. That was being
// paid again by EVERY candidate-side scenario, because state() is per-scenario and this
// function's cache lived there - while agentSignIn() has cached its storage state at module
// scope since it was written. Same app, same cookie mechanism, no reason for the two to
// differ; the candidate half was simply never given the same treatment.
//
// The app keeps its session in a `refresh_token` COOKIE (no access token in localStorage; the
// SPA calls POST /auth/token/refresh/ on load), so the storage state replays cleanly.
//
// >>> THE FALLBACK IS THE LOAD-BEARING PART. <<< A replayed session that has expired leaves
// the app bouncing to /login, and every later step then fails on a locator that cannot exist -
// which reads as a broken page object, not a stale session. So a bounce is detected, reported,
// and recovered by signing in for real and re-capturing. A silent fallback is how this class
// of problem hides; `signOutAndBackIn()` in the agent-portal feature had exactly that bug.
let cachedCandidateState = null;

// Any authenticated page will do to test a replayed session - the app bounces to /login when
// it is not honoured. /dashboard is the cheapest.
const CANDIDATE_HOME =
  (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '') + '/dashboard';

async function candidateUi(world) {
  const s = state(world);
  if (s.candidatePages) return s.candidatePages;
  s.candidateCtx = await world.browser.newContext(video.contextOptions());
  // Trace this context too. A context created without start() traces NOTHING, silently - so
  // without this the candidate half of every cross-role scenario would be missing from the
  // timeline, which is precisely the half those scenarios exist to inspect.
  await trace.start(world, s.candidateCtx, 'candidate');
  const page = await s.candidateCtx.newPage();
  video.track(world, page, 'candidate');

  let signedInFresh = true;
  if (cachedCandidateState) {
    await s.candidateCtx.addCookies(cachedCandidateState.cookies).catch(() => {});
    await page.goto(CANDIDATE_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const bounced = await page
      .waitForURL((u) => /\/login/.test(String(u)), { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (!bounced) {
      signedInFresh = false;
    } else {
      world.attach('the cached candidate session was stale - signing in again', 'text/plain');
      cachedCandidateState = null;
    }
  }
  if (signedInFresh) {
    await signInAs(world, page, process.env.DOC_CANDIDATE_EMAIL, process.env.DOC_CANDIDATE_PASSWORD, 'candidate');
    cachedCandidateState = await s.candidateCtx.storageState();
  }

  s.candidatePages = { page, documents: new CandidateDocumentsPage(page) };
  return s.candidatePages;
}

When('the candidate opens that document', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const { documents } = await candidateUi(this);
  await documents.openDashboard();
  const target = s.revisionDocument
    ? s.revisionDocument.file_name
    : (current(this).upload.uploadedFileName || current(this).doc.file);
  // The FULL stored filename, extension included - not the stem. Uploads here are
  // permanent, so the same fixture uploaded twice leaves two rows whose stems are prefixes
  // of one another (`..._NS6EM35.pdf` and `..._NS6EM35_AcaNqtk.pdf`), and findCard()
  // rightly refuses to guess between them. The extension is what makes the match exact.
  await documents.openDocument(target);
  s.candidatePanel = await documents.readPanel();
  await this.attach(`candidate panel:\n${JSON.stringify(s.candidatePanel, null, 1)}`, 'text/plain');
});

Then('the candidate should see that the document requires revision', function () {
  const p = state(this).candidatePanel;
  expect(p, 'the candidate panel was never read').to.exist;
  expect(p.status, `the candidate sees the status as "${p.status}"`).to.equal('Revision Required');
});

Then('the candidate should see the reason it was flagged', function () {
  const p = state(this).candidatePanel;
  const history = p.commentHistory || [];
  expect(
    history.length,
    'the candidate is shown no comment history at all, so they are told the document needs revision ' +
      'without being told why'
  ).to.be.greaterThan(0);
  const withText = history.filter((h) => String(h.comment || '').trim().length > 3);
  expect(
    withText.length,
    `every comment shown to the candidate is empty or too short to act on: ${JSON.stringify(history)}`
  ).to.be.greaterThan(0);
});

Then('the candidate should see the reason the agent gave', function () {
  const s = state(this);
  const history = (s.candidatePanel && s.candidatePanel.commentHistory) || [];
  expect(s.agentReason, 'no agent reason was submitted in this scenario').to.be.a('string');
  const found = history.find((h) => String(h.comment || '').includes(s.agentReason.slice(0, 40)));
  expect(
    found,
    `the reason the agent typed is not shown to the candidate.\n  agent typed: ${s.agentReason}\n` +
      `  candidate sees: ${JSON.stringify(history)}`
  ).to.exist;
});

Then('the candidate should see who made the decision', function () {
  const history = (state(this).candidatePanel && state(this).candidatePanel.commentHistory) || [];
  const sourced = history.filter((h) => h.source);
  expect(
    sourced.length,
    'no comment shown to the candidate names its source, so the AC requirement that the candidate ' +
      `sees who flagged the document is unmet. History: ${JSON.stringify(history)}`
  ).to.be.greaterThan(0);
});

Then('the candidate should see that an agent made the decision', function () {
  const history = (state(this).candidatePanel && state(this).candidatePanel.commentHistory) || [];
  const byAgent = history.filter((h) => /agent/i.test(h.source || ''));
  expect(
    byAgent.length,
    'the decision was made by an agent, but no comment shown to the candidate attributes it to one. ' +
      `History: ${JSON.stringify(history)}`
  ).to.be.greaterThan(0);
});

Then('the candidate should see that the document was approved', function () {
  const p = state(this).candidatePanel;
  expect(p, 'the candidate panel was never read').to.exist;
  expect(
    p.status,
    `the agent approved this document but the candidate sees the status as "${p.status}". The ` +
      "candidate's view must reflect the decision that was committed."
  ).to.equal('Approved');
});

// The previous verdict must not survive as the active result. Asserted from the
// candidate's side because that is where a stale status actually misleads somebody.
Then('the earlier flagged result should no longer be active', function () {
  const s = state(this);
  const p = s.candidatePanel;
  expect(p, 'the candidate panel was never read').to.exist;
  const problems = [];
  if (['Needs Review', 'Revision Required'].includes(p.status)) {
    problems.push(`the candidate still sees "${p.status}" after a decision was committed`);
  }
  const o = current(this);
  const apiStatus = o.document && o.document.status;
  if (apiStatus === 'AWAITING') {
    problems.push(`the API still reports AWAITING for document row ${o.upload.documentRowId}`);
  }
  expect(
    problems,
    `${o.doc.id}: the superseded result is still active.\n  ` + problems.join('\n  ')
  ).to.deep.equal([]);
});

// ---------------------------------------------------------------------------
// Candidate notification (AC section 11)
// ---------------------------------------------------------------------------
// Read over the API against the id baseline, then confirmed on the bell. Two surfaces
// because they answer different questions: the API says the notification was RAISED, the
// bell says the candidate can actually SEE it, and a notification that exists but never
// renders is a real defect that an API-only check passes straight over.
//
// Placed LAST in its scenario deliberately. Cucumber abandons at the first failure, and
// this is the newest, least-established surface in the module - a wrong wording here must
// not cost the decision and status assertions above it. Same rule as the receipt-PDF
// currency step and the community privacy ordering.
Then('the candidate should be notified of the decision', { timeout: NET_STEP }, async function () {
  const s = state(this);
  expect(
    s.notificationBaseline,
    'no notification baseline was taken, so a notification already on the account could be mistaken ' +
      'for one this run caused. A "Given the candidate notifications are noted" step must run before ' +
      'the agent decision.'
  ).to.exist;

  let result;
  try {
    result = await s.api.waitForNotification({
      afterIds: s.notificationBaseline,
      // Matched on the document, not on a guessed subject line: a guessed string can only
      // ever answer "nothing arrived", which cannot distinguish "the app raises no
      // notification" from "it raises one worded differently". Same reasoning as
      // waitForEmailMatching() in the agent-email module.
      match: (n) => /document|verification|revision|approv/i.test(`${n.title} ${n.body} ${n.type}`),
      timeoutMs: 120000,
    });
  } catch (e) {
    await this.attach(e.toReport ? e.toReport() : String(e.message), 'text/plain');
    throw new Error(
      'The candidate was not notified about the decision on their document.\n' +
        (e.toReport ? e.toReport() : e.message)
    );
  }

  s.decisionNotification = result.notification;
  await this.attach(
    `notification raised after ${Math.round(result.elapsedMs / 1000)}s over ${result.polls} poll(s):\n` +
      JSON.stringify(result.notification, null, 1) +
      (result.candidates.length > 1
        ? `\n(${result.candidates.length} new notification(s) total since the baseline)`
        : ''),
    'text/plain'
  );
});

Then('the notification should be visible in the candidate notification centre', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const raised = s.decisionNotification;
  expect(raised, 'no notification was captured over the API, so there is nothing to look for').to.exist;

  const { page } = await candidateUi(this);
  const bell = new NotificationsPage(page);
  const opened = await bell.open().then(
    () => true,
    () => false
  );
  expect(
    opened,
    'The candidate portal exposes no reachable notification centre, so a notification the API raised ' +
      'cannot be seen by the candidate it was raised for. The bell locator is documented in ' +
      'NotificationsPage.js; if the candidate portal renders it differently, that is what to record.'
  ).to.equal(true);

  const items = await bell.readItems();
  await this.attach(
    `notification centre holds ${items.length} item(s):\n` +
      items.slice(0, 10).map((i) => `  ${JSON.stringify(i)}`).join('\n'),
    'text/plain'
  );
  const key = String(raised.title || '').slice(0, 30);
  const found = items.find((i) => `${i.title || ''} ${i.body || ''}`.includes(key));
  expect(
    found,
    `The API raised "${raised.title}" but the candidate's notification centre does not show it.\n` +
      `  looking for: "${key}"\n  centre holds: ${JSON.stringify(items.slice(0, 10))}`
  ).to.exist;
});

// ---------------------------------------------------------------------------
// Folded in from the two feature files this one replaces (2026-08-24)
// ---------------------------------------------------------------------------


Then('every document should have the status {string}', function (label) {
  const s = state(this);
  expect(s.multiple, 'no multi-document upload happened in this scenario').to.be.an('array').that.is.not.empty;
  const wrong = s.multiple
    .map((o) => ({ id: o.doc.id, api: o.document && o.document.status }))
    .filter((r) => (AgentVerificationsPage.STATUS_LABEL[r.api] || r.api) !== label)
    .map((r) => `${r.id} is "${AgentVerificationsPage.STATUS_LABEL[r.api] || r.api}" (API ${r.api})`);
  expect(wrong, wrong.join('\n')).to.deep.equal([]);
});

Then('no agent action should be required for any document', function () {
  const s = state(this);
  const problems = [];
  for (const o of s.multiple || []) {
    const notPassed = ((o.verification && o.verification.criteria) || []).filter((c) => c.verdict !== VERDICT.PASS);
    if (notPassed.length) {
      problems.push(`${o.doc.id}: ${notPassed.map((c) => `${c.key}=${c.verdict}`).join(', ')}`);
    }
  }
  expect(
    problems,
    'these documents still need a human because a criterion did not pass:\n' + problems.join('\n')
  ).to.deep.equal([]);
});

// A document already Approved or already sent back. READ from the account rather than
// created, because creating one means committing a real agent decision and nothing undoes it.
Given('a document that has already been decided', { timeout: NET_STEP }, async function () {
  const s = state(this);
  const docs = await s.api.listDocuments();
  const decided = docs.filter((d) => d.status === 'APPROVED' || d.status === 'REVISION');
  expect(
    decided.length,
    'No document on this account is APPROVED or REVISION, so there is nothing to prove the ' +
      'decision controls are withheld on. Run the agent-decision scenario first, or seed one.'
  ).to.be.greaterThan(0);
  s.decidedDocument = decided[0];
});

// The AC: "Agents should take a decision only on the Needs Review status." A settled
// document offering Approve / Request Revision means an agent can overturn it, with no undo.
Then('no decision controls should be offered', { timeout: UI_STEP }, async function () {
  const agent = this.pages.agentVerifications;
  const offered = [];
  if (await agent.requestRevisionButton.count()) offered.push('Request Revision');
  if (await agent.approveButton.count()) offered.push('Approve');
  const s = state(this);
  const status = (s.decidedDocument && s.decidedDocument.status) || (s.agentPanel && s.agentPanel.status);
  expect(
    offered,
    `The document is "${status}", which is not awaiting review, but the panel still offers ` +
      `${offered.join(' and ')}. An agent could overturn a settled decision and nothing undoes it.`
  ).to.deep.equal([]);
});

When('the agent searches the queue for that document', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const o = current(this);
  const stem = (o.upload.uploadedFileName || o.doc.file).replace(/\.[a-z0-9]+$/i, '');
  await agentSignIn(this);
  const agent = this.pages.agentVerifications;
  await agent.open('ALL');
  s.searchTerm = stem.slice(0, 30);
  await agent.search(s.searchTerm);
  s.queueRows = await agent.readRows();
});

When('the agent searches for a document name that cannot exist', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const agent = this.pages.agentVerifications;
  s.searchTerm = 'zzz-no-such-document-' + Date.now();
  await agent.search(s.searchTerm);
  s.queueRows = await agent.readRows();
});

Then('only documents matching the search should be listed', function () {
  const s = state(this);
  expect(s.queueRows.length, `the search for "${s.searchTerm}" returned nothing at all`).to.be.greaterThan(0);
  const stray = s.queueRows
    .filter((r) => !r.documentName.toLowerCase().includes(s.searchTerm.toLowerCase()))
    .map((r) => r.documentName);
  expect(stray, `these rows do not match "${s.searchTerm}":\n  ` + stray.join('\n  ')).to.deep.equal([]);
});

When('the agent filters the queue by {string}', { timeout: UI_STEP }, async function (label) {
  const s = state(this);
  const status = Object.keys(AgentVerificationsPage.STATUS_LABEL).find(
    (k) => AgentVerificationsPage.STATUS_LABEL[k] === label
  );
  expect(status, `"${label}" is not a status this queue displays`).to.be.a('string');
  s.filterLabel = label;
  await this.pages.agentVerifications.selectTab(status);
  s.queueRows = await this.pages.agentVerifications.readRows();
});

Then('every listed row should carry that status', function () {
  const s = state(this);
  expect(s.queueRows.length, `filtering by "${s.filterLabel}" listed no rows at all`).to.be.greaterThan(0);
  const stray = s.queueRows
    .filter((r) => !r.status.includes(s.filterLabel))
    .map((r) => `${r.documentName} -> "${r.status}"`);
  expect(
    stray,
    `these rows are listed under "${s.filterLabel}" but do not carry it:\n  ` + stray.join('\n  ')
  ).to.deep.equal([]);
});

Then('the queue should list no documents', function () {
  const s = state(this);
  const names = s.queueRows.map((r) => r.documentName);
  expect(names, `searching for "${s.searchTerm}" still listed rows:\n  ` + names.join('\n  ')).to.deep.equal([]);
});

// Reads whatever the queue renders rather than asserting a wording nobody has agreed. A
// search that matches nothing and shows NOTHING at all is the defect - the agent is left
// looking at a blank panel, unable to tell it apart from a failed load.
Then('the queue should show an empty state', { timeout: UI_STEP }, async function () {
  const text = await this.page.locator('main, body').first().innerText();
  const hasMessage = /no (documents|results|verifications)|nothing (found|to)|empty/i.test(text);
  await this.attach('queue text while empty:\n' + text.replace(/\s+/g, ' ').slice(0, 600), 'text/plain');
  expect(
    hasMessage,
    'the queue matched nothing and rendered no empty-state message, so the agent cannot tell an ' +
      'empty result from a failed load'
  ).to.equal(true);
});

Then('the version shown to the agent should have increased', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const r = s.resubmission;
  expect(r, 'no resubmission happened in this scenario').to.exist;
  await agentSignIn(this);
  const agent = this.pages.agentVerifications;
  await agent.open('ALL');
  // >>> OPEN BY THE FULL STORED FILENAME, EXTENSION INCLUDED. <<<
  // This used to search and open with `stem.slice(0, 30)`, and uploads are permanent, so
  // the same fixture uploaded repeatedly leaves rows whose 30-character prefixes are all
  // identical. Measured on this run: that prefix matched TEN rows
  // ("NAME-03_transcript_different_name_Axmq5CH.pdf", "..._fRU3amr.pdf", ...) and
  // findRow() rightly refused to guess. Only the full name is unique - it is the random
  // suffix the server appends that distinguishes them.
  //
  // The name is taken from the document the API reports AFTER the resubmission, because
  // that is the row whose version this step is about; the pre-resubmission name is only a
  // fallback for a response that omitted it.
  const stored =
    (r.document && r.document.file_name) || r.upload.uploadedFileName || r.before.upload.uploadedFileName || r.before.doc.file;
  await agent.search(stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 30));
  await agent.openDocument(stored);
  const panel = await agent.readPanel();
  const shown = parseFloat(String(panel.version || '').replace(/[^0-9.]/g, ''));
  await this.attach(`version shown: ${panel.version}  (API verification version ${r.verification.version})`, 'text/plain');
  expect(
    shown > 1,
    `after a resubmission the panel still shows version "${panel.version}". The API recorded ` +
      `verification version ${r.verification.version}, so the document WAS re-verified but the ` +
      'version the agent is shown did not move.'
  ).to.equal(true);
});

// ---------------------------------------------------------------------------
// When the candidate is told anything, and uploading through the real UI
// ---------------------------------------------------------------------------
// Product rule confirmed 2026-08-24: remarks reach the candidate ONLY after the agent's
// final decision. Before that the candidate sees a status and nothing else, and that is
// correct. Both halves are asserted so a future leak of AI findings to the candidate
// while a document is still awaiting review would be caught.

const CandidateProfilePage = require('../pages/CandidateProfilePage');

// The candidate's own profile, on the second (candidate) context.
async function candidateProfile(world) {
  const s = state(world);
  const ui = await candidateUi(world);
  if (!s.candidateProfilePage) s.candidateProfilePage = new CandidateProfilePage(ui.page);
  return s.candidateProfilePage;
}

// >>> THE PRE-DECISION STATE HAS SEVERAL RENDERED WORDINGS, AND THAT IS THE POINT. <<<
//
// The API's status is AWAITING. The candidate's Documents tab has been measured showing
// "Awaiting Verification"; the agent portal renders the same state as "Needs Review" on
// its pill and "Need Review" on its filter tab. Which of those a given surface uses is
// exactly what the @known-issue wording scenario further down this file exists to report.
//
// So this step asserts THE STATE, against the set of wordings the product is known to use
// for it, and attaches the one it actually found. Pinning a single string here would make
// this scenario red on a synonym and take its second assertion - that no remark has
// leaked to the candidate before a decision - down with it, since Cucumber abandons at the
// first failure. It is still a real assertion: a decided document reads "Approved" or
// "Revision Required" and fails.
const PRE_DECISION_WORDINGS = ['awaiting verification', 'needs review', 'need review', 'pending'];

Then('the candidate should see the document as Need Review', { timeout: UI_STEP }, async function () {
  const o = current(this);
  const stored = o.upload.uploadedFileName || o.doc.file;
  const profile = await candidateProfile(this);
  await profile.openDocumentsTab();
  const rows = await profile.readDocumentsTab();
  state(this).candidateRows = rows;
  // `documentName` can be null since the Documents tab reader was unified on 2026-09-01:
  // it derives a row from its STATUS BADGE, so a row whose name failed to render comes
  // back with a null name rather than vanishing from the read. That is deliberate - "the
  // document is not listed" must never be concluded from an unrendered name - and it means
  // every consumer has to guard, which this one previously did not.
  const named = rows.filter((r) => r.documentName);
  const nameless = rows.length - named.length;
  const row = named.find((r) => r.documentName.includes(stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 30)));
  expect(
    row,
    `the document the candidate just uploaded (${stored}) is not listed on their Documents tab.\n` +
      `Listed: ${named.slice(0, 8).map((r) => r.documentName).join(', ')}` +
      (nameless ? `\n${nameless} further row(s) rendered no readable name, which is itself a finding.` : '')
  ).to.exist;
  await this.attach(`candidate sees: ${row.documentName} -> "${row.status}"`, 'text/plain');
  expect(
    PRE_DECISION_WORDINGS.includes(String(row.status || '').trim().toLowerCase()),
    `the candidate's Documents tab shows "${row.status}" for a document with no decision yet. ` +
      `A pre-decision document should read one of: ${PRE_DECISION_WORDINGS.join(', ')}. ` +
      'If this is a NEW wording for the same state, add it to PRE_DECISION_WORDINGS; if it is ' +
      'a decided state, the document was decided when the scenario assumed it had not been.'
  ).to.equal(true);
});

// The silence BEFORE a decision is the assertion here, not an absence of coverage.
Then('the candidate should not yet be shown an agent decision remark', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const o = current(this);
  const failing = ((o.verification && o.verification.criteria) || []).filter((c) => c.verdict !== VERDICT.PASS);
  expect(
    failing.length,
    'this step is only meaningful on a document the AI actually flagged, and nothing failed on ' +
      'this one - so it would pass without proving anything'
  ).to.be.greaterThan(0);

  const comments = (o.document && o.document.comments) || [];
  expect(
    comments.map((c) => `[${c.source}] ${String(c.comment).slice(0, 60)}`),
    'the document has no agent decision yet, so the candidate should have been told nothing. ' +
      'These remarks are already attached to it:'
  ).to.deep.equal([]);
});

// After a decision the candidate must see BOTH the agent's remark and the AI findings
// behind it (product decision, 2026-08-24).
Then('the candidate should see the AI findings that led to the decision', function () {
  const s = state(this);
  const panel = s.candidatePanel;
  expect(panel, 'the candidate panel was never read').to.exist;
  const history = panel.commentHistory || [];
  const fromAi = history.filter((h) => /ai|automated|system/i.test(h.source || ''));
  expect(
    fromAi.length,
    'after a decision the candidate should see the AI findings that led to it, attributed to the ' +
      `automated system. Nothing in the history is attributed that way: ${JSON.stringify(history)}`
  ).to.be.greaterThan(0);
});

// ---- uploading through the real form ----

// ===========================================================================
// FILLING THE THREE PROFILE FORMS, FROM THE DOCUMENT'S OWN DECLARED BLOCK
// ===========================================================================
//
// Every fixture in the test data carries a `declared` block - the values a candidate
// would type on the form alongside that file. The fillers below read THAT, rather than
// carrying constants of their own, and the reason is not tidiness:
//
//   `issuing_organisation` and several date rules are evaluated by comparing the
//   document against WHAT THE CANDIDATE DECLARED. A filler with hardcoded values would
//   declare "King Saud University" for a fixture whose whole point is an unrecognised
//   institution, and the AI would then correctly report a mismatch the scenario never
//   asked for. That is exactly the class of false finding that inflated the measured AI
//   mismatch rate from 5.3% to 10.2% until probe-ai-verdict-vs-document-condition.js
//   learned to separate the two.
//
// So the form is filled with what the fixture says it should be filled with, and the
// only thing under test is the document.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "2018-09-01" -> { month: 'September', year: 2018 }. Returns null for a null date, which
// is how the test data records open-ended employment and non-expiring certificates.
function monthYear(isoDate) {
  if (!isoDate) return null;
  const [y, m] = String(isoDate).split('-');
  const idx = Number(m) - 1;
  if (!y || !MONTHS[idx]) throw new Error(`Cannot read a month/year out of "${isoDate}"`);
  return { month: MONTHS[idx], year: Number(y) };
}

async function setMonthYearPair(profile, which, isoDate, offset = 0) {
  const v = monthYear(isoDate);
  if (!v) return false;
  await profile.selectMonthYear(which, v.month, v.year, { offset });
  return true;
}

// The test data's employment enum -> the label the Add Experience dropdown renders.
// Mapped explicitly: the control offers eight options and several are near-synonyms
// ("Freelance / Contract", "Self-employed"), so an inferred match would be a guess.
const EMPLOYMENT_TYPE_LABEL = {
  full_time: 'Full-time Employment',
  part_time: 'Part-time Employment',
  freelance: 'Freelance / Contract',
  contract: 'Freelance / Contract',
  internship: 'Internship',
  apprenticeship: 'Apprenticeship',
  co_op: 'Co-op',
  tamheer: 'Tamheer',
  self_employed: 'Self-employed',
};

const FORM_FILLERS = {
  // Four selects: [startMonth, startYear, endMonth, endYear]. All three text fields are
  // real react-aria comboboxes (role="combobox", aria-autocomplete="list", each with a
  // "Show suggestions" button), so each needs an option picked, not a typed value.
  EDUCATION: async (profile, d) => {
    await profile.selectFromSearch('University/Institution Name', d.institution);
    await profile.selectFromSearch('Degree', d.degree);
    await profile.selectFromSearch('Field of Study', d.field_of_study);
    await setMonthYearPair(profile, 0, d.start_date);
    await setMonthYearPair(profile, 1, d.end_date);
  },

  // >>> "Company Name" IS A PLAIN TEXT INPUT, NOT A COMBOBOX, DESPITE ITS "Search"
  //     PLACEHOLDER. <<< Dumped side by side with the Education control on 2026-08-25
  //     (scripts/probe-company-combobox.js): the institution field carries
  //     role="combobox", aria-autocomplete="list", aria-expanded and a "Show suggestions"
  //     button; Company Name carries none of them - it is
  //     <input type="text" placeholder="Search"> and nothing else.
  //
  //     So it has no options and never had any. selectFromSearch() on it timed out
  //     reporting "no option exactly named ... options offered: (none)", which reads like
  //     missing reference data and is why the work-experience upload path was believed to
  //     be an app problem. It is free text; fillText is the right primitive.
  //
  //     (Worth raising with the PO as a UX finding in its own right: the placeholder tells
  //     a candidate to search a field that does not search. Same shape as the community
  //     module's "Search by candidate name or major" placeholder over a name-only search.)
  //
  // FIVE selects here: [employmentType, startMonth, startYear, endMonth, endYear], hence
  // offset 1 on every month/year pair.
  WORKEXPERIENCE: async (profile, d) => {
    const label = EMPLOYMENT_TYPE_LABEL[d.experience];
    if (!label) {
      throw new Error(
        `No employment-type label registered for "${d.experience}". Known: ` +
          Object.keys(EMPLOYMENT_TYPE_LABEL).join(', ')
      );
    }
    await profile.selectEmploymentType(label);
    await profile.fillText('Company Name', d.company);
    await profile.fillText('Role/Job Title', d.designation);
    await setMonthYearPair(profile, 0, d.start_date, 1);
    // A null end date is how the test data records ongoing employment. The form models
    // that with a checkbox, and the end month/year are required without it - so ticking it
    // is what lets Save enable, not a nicety.
    if (!d.end_date) await profile.checkBoxNear('I currently work here');
    else await setMonthYearPair(profile, 1, d.end_date, 1);
  },

  // Four selects: [issueMonth, issueYear, expiryMonth, expiryYear]. Both text fields are
  // plain inputs (placeholders "Enter Certificate Name" and
  // "e.g. Google, Coursera, Microsoft, University name"), so neither offers options.
  CERTIFICATION: async (profile, d) => {
    await profile.fillText('Certificate Name', d.certificate_name);
    await profile.fillText('Issuing Organization', d.issuing_organization);
    await setMonthYearPair(profile, 0, d.issue_date);
    if (!d.expiry_date) await profile.checkBoxNear('expire');
    else await setMonthYearPair(profile, 1, d.expiry_date);
  },
};

// Which profile section each outline row drives, and which fixture it attaches. The
// document type is what selects the fixture; the profile entry is what selects the form.
const PROFILE_UPLOAD_ROWS = {
  'education/transcript': { category: 'EDUCATION', docId: 'NAME-01' },
  'work experience/experience letter': { category: 'WORKEXPERIENCE', docId: 'ENG-07' },
  'certification/certificate': { category: 'CERTIFICATION', docId: 'ENG-06' },
};

// The one the walkthrough attaches: the same Education form, but a transcript naming
// somebody else - so the AI has something to flag and the agent panel actually RENDERS a
// finding.
//
// NAME-03 specifically, and the choice matters: identity_name_match is the one criterion
// measured as fully deterministic (122/122 correct, verdict never varied across runs), so a
// walkthrough built on it shows a real finding every time. Built on date_validity or
// authenticity it would intermittently show nothing, through no fault of the test.
const WALKTHROUGH_DOC_ID = 'NAME-03';

// Drive ANY document through the real Profile > Candidate Details form. The category
// decides which section is opened and which filler runs; the filler reads the document's
// own `declared` block, so this works for every fixture in the test data rather than the
// four it used to be hardcoded for.
async function uploadThroughUi(world, doc) {
  const s = state(world);
  const fixture = resolveFixture(doc.file, doc.id);
  const category = doc.category;
  const fill = FORM_FILLERS[category];
  if (!fill) {
    throw new Error(
      `No profile form is registered for category "${category}" (${doc.id}). Known: ` +
        `${Object.keys(FORM_FILLERS).join(', ')}`
    );
  }
  if (!doc.declared) {
    throw new Error(
      `${doc.id} has no "declared" block in the test data, so the profile form cannot be filled ` +
        'the way a candidate would fill it. Add one - the declared values are part of what the AI ' +
        'compares the document against, not incidental form-filling.'
    );
  }

  // The same pre-upload snapshot the API path takes. It was missing here, and the tracking
  // guard caught it: without it nothing proves the row this save created is new, and on an
  // account holding 166 rows of repeatedly-uploaded fixtures that is not a safe assumption.
  const priorIds = await s.api.snapshotDocumentIds();

  const profile = await candidateProfile(world);
  await profile.open();
  await profile.openAddModal(category);
  await fill(profile, doc.declared);
  const attached = await profile.attachDocument(fixture.path);

  // Read the gate before saving: a Save that is still disabled means the form rejected
  // something, and "the upload failed" would otherwise be indistinguishable from "the
  // suite never managed to submit it".
  const enabled = await profile.saveIsEnabled();
  await world.attach(
    `UI upload (${category}) of ${doc.id} ${doc.file}\n` +
      `  declared on the form: ${JSON.stringify(doc.declared)}\n` +
      `  attached ${attached}, Save ${enabled ? 'enabled' : 'DISABLED'}`,
    'text/plain'
  );
  if (!enabled) {
    throw new Error(
      `The ${category} form left Save disabled after every required field was filled and ` +
        `${attached} was attached, so nothing could be submitted.`
    );
  }

  const result = await profile.save();
  // Shaped like an API upload so the shared assertion steps work unchanged.
  const upload = {
    documentId: doc.id,
    category,
    file: doc.file,
    bytesSent: fixture.bytes,
    contentType: fixture.contentType,
    httpStatus: result.httpStatus,
    accepted: result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300,
    responseBody: result.body,
    entryId: result.body && result.body.id,
    documentRowId: (result.body && result.body.document && result.body.document.id) ?? null,
    uploadedFileName: result.body && result.body.document && result.body.document.file_name,
    rowIdSource: result.body && result.body.document && result.body.document.id ? 'save response' : null,
    priorDocumentCount: priorIds.size,
    viaUi: true,
  };
  // Same guard the API path runs: recover the row id if the response omitted it, and refuse a
  // row that already existed. A UI save that reported 2xx but created no document row is
  // exactly what happened here before attachDocument() learned to wait for the upload to
  // finish - the entry came back with `document: null` and the failure surfaced much later as
  // an AI timeout.
  if (upload.accepted) await s.api.confirmRowIsNew(doc, upload, priorIds);

  s.observed = { doc, priorDocumentIds: priorIds, upload };
  s.submitted.set(`${doc.id}(ui)`, s.observed);
  await world.attach(
    `  account held ${priorIds.size} document row(s) before this upload\n` +
      `  save HTTP ${upload.httpStatus} ${upload.accepted ? 'accepted' : 'REFUSED'}\n` +
      `  entry ${upload.entryId} / document row ${upload.documentRowId}` +
      (upload.rowIdSource ? ` (from the ${upload.rowIdSource})` : ''),
    'text/plain'
  );
  return s.observed;
}



// The walkthrough's opening step. Same real form as above, but the transcript names somebody
// else, so the AI produces a finding the agent panel can actually display.
When(
  'the candidate uploads a transcript naming a different person through the profile form',
  { timeout: UI_STEP },
  async function () {
    await uploadThroughUi(this, documentSpec(this, WALKTHROUGH_DOC_ID));
  }
);

// The outline row is 'a <profile_entry> with a <document_type>'. Both halves are captured
// and looked up as a PAIR rather than independently: the section and the fixture have to
// agree, and a row pairing 'certification' with 'transcript' is a mistake in the feature
// file that must fail naming the rows that do exist, not quietly upload a transcript into
// the Certifications section.
When(
  /^the candidate adds an? (education|work experience|certification) with an? ([a-z ]+) through the profile$/,
  { timeout: UI_STEP },
  async function (entry, type) {
    const key = `${entry}/${type.trim()}`;
    const row = PROFILE_UPLOAD_ROWS[key];
    if (!row) {
      throw new Error(
        `No profile upload is registered for "${key}". Registered pairs:\n  ` +
          Object.keys(PROFILE_UPLOAD_ROWS).join('\n  ')
      );
    }
    const doc = documentSpec(this, row.docId);
    if (doc.category !== row.category) {
      throw new Error(
        `${row.docId} is category ${doc.category} in the test data but "${key}" drives the ` +
          `${row.category} section. One of the two is wrong.`
      );
    }
    await uploadThroughUi(this, doc);
  }
);





Then("the document should appear in the candidate's Documents tab", { timeout: UI_STEP }, async function () {
  const o = current(this);
  const stored = o.upload.uploadedFileName || o.doc.file;
  const stem = stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 30);
  const profile = await candidateProfile(this);
  await profile.openDocumentsTab();
  const rows = await profile.readDocumentsTab();
  const row = rows.find((r) => r.documentName.includes(stem));
  expect(
    row,
    `the document uploaded through the form (${stored}) does not appear on the Documents tab.\n` +
      `Listed: ${rows.slice(0, 10).map((r) => r.documentName).join(', ')}`
  ).to.exist;
});

// ---- accessibility of the upload controls ----

When('the candidate opens the profile details tab', { timeout: UI_STEP }, async function () {
  const profile = await candidateProfile(this);
  await profile.open();
});

// SPLIT INTO TWO ASSERTIONS on purpose (the AC treats them as two rules, and they have
// different remedies - a tabindex versus an aria-label). The DOM is read ONCE and cached
// on the scenario, because Cucumber abandons at the first failure: re-reading in the
// second step would be wasted on every red run, and on a green one the two steps would be
// reporting on two different reads of a live page.
async function readUploadControlAccessibility(world) {
  const s = state(world);
  if (!s.uploadControlA11y) {
    const ui = await candidateUi(world);
    s.uploadControlA11y = await ui.page.evaluate(() => {
      const out = [];
      for (const icon of document.querySelectorAll('svg.add-icon, svg.edit-icon')) {
        const r = icon.getBoundingClientRect();
        if (!r.width) continue;
        // Walk up a little: a correctly built control wraps the icon in a button.
        let host = icon;
        let wrapper = null;
        for (let i = 0; i < 3 && host; i++) {
          if (host.tagName === 'BUTTON' || host.getAttribute('role') === 'button') {
            wrapper = host;
            break;
          }
          host = host.parentElement;
        }
        const named =
          (wrapper && (wrapper.getAttribute('aria-label') || (wrapper.textContent || '').trim())) ||
          icon.getAttribute('aria-label') ||
          (icon.querySelector('title') || {}).textContent ||
          null;
        const focusable = Boolean(
          wrapper || icon.getAttribute('tabindex') !== null || icon.getAttribute('role') === 'button'
        );
        // EVERY control is returned, passing or not. The two steps below each filter it
        // their own way; returning only the failures would leave the second step unable to
        // say how many controls it actually examined.
        out.push({
          control: (icon.getAttribute('class') || '').toString(),
          wrappedInButton: Boolean(wrapper),
          accessibleName: named,
          tabindex: icon.getAttribute('tabindex'),
          role: icon.getAttribute('role'),
          focusable,
          named: Boolean(named),
        });
      }
      return out;
    });
    await world.attach(
      `document upload controls examined (${s.uploadControlA11y.length}):\n` +
        JSON.stringify(s.uploadControlA11y, null, 1),
      'text/plain'
    );
  }
  expect(
    s.uploadControlA11y.length,
    'No document add/edit control was found on the profile at all, so neither accessibility rule ' +
      'was actually checked. The controls are bare <svg class="add-icon"> / <svg class="edit-icon"> ' +
      'elements - if those class names changed there is no other hook.'
  ).to.be.greaterThan(0);
  return s.uploadControlA11y;
}

Then('every document upload control should be reachable by keyboard', { timeout: UI_STEP }, async function () {
  const controls = await readUploadControlAccessibility(this);
  const unreachable = controls.filter((c) => !c.focusable);
  expect(
    unreachable,
    `${unreachable.length} of ${controls.length} document add/edit control(s) cannot be reached by ` +
      'keyboard: they are bare <svg> elements with no button wrapper, no role and no tabindex, so ' +
      'a keyboard-only candidate cannot add a qualification or upload a document at all.'
  ).to.deep.equal([]);
});

Then('every document upload control should have an accessible name', { timeout: UI_STEP }, async function () {
  const controls = await readUploadControlAccessibility(this);
  const unnamed = controls.filter((c) => !c.named);
  expect(
    unnamed,
    `${unnamed.length} of ${controls.length} document add/edit control(s) expose no accessible name ` +
      '(no aria-label, no <title>, no text in a wrapping button), so a screen reader announces ' +
      'nothing a candidate could act on.'
  ).to.deep.equal([]);
});

// ---- status wording across the two portals ----

Then('the status wording should agree across the candidate and agent portals', { timeout: UI_STEP }, async function () {
  const o = current(this);
  const apiStatus = o.document && o.document.status;
  const stored = o.upload.uploadedFileName || o.doc.file;
  const stem = stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 30);

  // The candidate's wording.
  const profile = await candidateProfile(this);
  await profile.openDocumentsTab();
  const rows = await profile.readDocumentsTab();
  const candidateWord = (rows.find((r) => r.documentName.includes(stem)) || {}).status || null;

  // The agent's wording - both the status pill and the filter tab, because the tab uses a
  // third spelling of the same state.
  await agentSignIn(this);
  const agent = this.pages.agentVerifications;
  await agent.open('ALL');
  await agent.search(stem);
  const agentRow = (await agent.readRows())[0];
  const agentWord = agentRow ? agentRow.status.trim() : null;
  const tabWord = (
    await this.page.locator(`[data-testid="${AgentVerificationsPage.TAB_TESTID.AWAITING}"]`).innerText()
  ).trim();

  await this.attach(
    `API ${apiStatus}\n  candidate Documents tab: "${candidateWord}"\n  agent status pill: "${agentWord}"\n  agent filter tab: "${tabWord}"`,
    'text/plain'
  );

  const wordings = [...new Set([candidateWord, agentWord, tabWord].filter(Boolean))];
  expect(
    wordings,
    `the API status ${apiStatus} is rendered ${wordings.length} different ways: ` +
      `candidate "${candidateWord}", agent pill "${agentWord}", agent filter tab "${tabWord}". ` +
      'A candidate and an agent discussing the same document read different words for its state.'
  ).to.have.lengthOf(1);
});
// ---------------------------------------------------------------------------
// PART 6 - STATUS LIFECYCLE
// ---------------------------------------------------------------------------
// Steps for "features/AI Document Verification/status-lifecycle.feature": one
// document's status driven from upload to final decision, checked on BOTH portals at
// every step, and the two COMMENT cases separated.
//
// >>> THE MECHANISM THESE STEPS ARE BUILT ON, MEASURED LIVE 2026-09-01. <<<
// The AI writes the FINAL STATUS itself - ai_verification.status becomes the
// document's status - and which comment reaches the candidate depends on who decided:
//
//   AI -> APPROVED   auto-approved, comments []. No agent, no comment.
//   AI -> REVISION   auto-rejected AND the AI writes a comment stamped source "AI",
//                    holding the failed criteria as prose. That is the candidate's
//                    only explanation.
//   AI -> AWAITING   "Needs Review". No comment. The AGENT decides, and the comment
//                    the candidate then sees is the AGENT's reason (source "AGENT"),
//                    NOT the AI's findings.
//
// So sections 2 and 4 of the feature file assert OPPOSITE comment rules, and both
// assert them in both directions - "the agent comment is shown" is satisfied by a
// panel showing the agent comment AND the AI findings, which is not what was asked
// for.
//
// FOUR RULES SPECIFIC TO THIS PART, on top of the four in the file header:
//
// 5. A LIFECYCLE DOCUMENT IS UPLOADED IMMEDIATELY, NOT QUEUED. The upload queue
//    exists so a later refinement can narrow which fixture a Given resolves to -
//    resolving early once spent a permanent upload on the wrong document. These
//    Givens name their document outright, so there is nothing to narrow and nothing
//    to defer. current() still works because the queue is left empty.
//
// 6. STATUS IS READ FROM THE SERVER, WORDING FROM THE PORTALS. A status assertion
//    re-fetches the entry rather than trusting a panel or a row; a wording assertion
//    reads the rendered string. Conflating them is how a rename reads as a broken
//    transition.
//
// 7. THE AGENT'S REASON IS UNIQUE PER RUN. This account holds comments from every
//    previous run and no control anywhere removes one, so a reason like "please
//    correct this" would match a comment left weeks ago and the assertion would pass
//    without the decision having reached the candidate at all.
//
// 8. THE CANDIDATE PANEL IS REACHED THROUGH A WIDENED PAGE, AND IT SAYS SO. The
//    dashboard block requests page_size=4 with no pagination control, so the panel of
//    a document uploaded minutes ago is otherwise unreachable. widenDashboardPaging()
//    changes only the page SIZE of a request the app already paginates - every value
//    is still the server's and still rendered by the app - and the widening is
//    attached to the report every time. The cap has its own scenario that does NOT
//    widen, so the workaround cannot hide the defect.

// The document class the agent-decision scenarios need: one the AI leaves AWAITING.
//
// >>> WHICH CRITERION DECIDES THE STATUS - MEASURED, BECAUSE NOTHING SPECIFIES IT. <<<
// Cross-tabulated over every verified row on the account, 2026-09-01
// (scripts/probe-doc-status-rule.js), the rule holds without exception in 33 of 33:
//
//     all six criteria pass          -> APPROVED   (1 of 1)
//     date_validity: fail            -> REVISION   (3 of 3)
//     any OTHER criterion non-pass   -> AWAITING   (30 of 30)
//
// date_validity is the discriminator: it appears in every REVISION row and in no
// AWAITING row. Everything else - identity_name_match: fail, issuing_organisation:
// fail, authenticity: uncertain, cross_document_consistency: fail - leaves the document
// for an agent.
//
// So the reliable way to reach AWAITING is a document that fails a criterion OTHER than
// date_validity. The choice is a transcript from an UNRECOGNISED INSTITUTION that names
// the candidate correctly: issuing_organisation comes back fail, its dates are ordinary
// past dates, and every other criterion is clean.
//
// >>> TWO EARLIER CHOICES WERE WRONG, AND BOTH MISTAKES ARE WORTH KEEPING ON RECORD. <<<
//
// (1) A CLEAN ORDINARY SCAN, on the reasoning that authenticity would come back
//     `uncertain` and leave the document undecided - which is what 8 of 8 DATE-05 rows on
//     the account showed. Run live the AI PASSED authenticity, the document was all-pass,
//     and it auto-APPROVED, so the scenario failed on its own premise. An ordinary scan's
//     authenticity verdict is the least stable thing this model produces. A criterion
//     that must FAIL is a far safer premise than one merely likely to be uncertain.
//
// (2) A TRANSCRIPT NAMING SOMEBODY ELSE - reliable (identity_name_match: fail is 3 of 3
//     AWAITING, and it is the one criterion measured as fully deterministic) but it has a
//     SIDE EFFECT THAT DAMAGES OTHER SCENARIOS. Every such upload adds a document naming
//     another person to an account whose document rows CANNOT BE DELETED, and
//     cross_document_consistency is evaluated against exactly that history. Three of them
//     went on in one run and the auto-approval scenario, which had passed that morning,
//     could no longer reach APPROVED - the clean document now failed
//     cross_document_consistency and stopped at Needs Review. A premise that quietly
//     spends another scenario's fixture is worse than an unreliable one, because the
//     damage is permanent and shows up somewhere else.
//
// ORG-03's shape has neither problem: the failure is a hard one, and the document names
// the candidate, so nothing about the account's name history changes.
//
// The step does NOT retry with a second fixture if the AI decides anyway. A retry would
// spend another permanent upload to paper over a real observation. It fails instead,
// naming the status the AI chose and every criterion behind it.
const UNDECIDABLE_DOCUMENT = {
  kind: 'transcript',
  name: 'exact',
  issuer: 'unrecognised',
  dates: 'valid_past',
  content: 'complete',
};

// Upload one NAMED document now. See rule 5 above for why this does not queue.
async function uploadNamedLifecycleDocument(world, id) {
  const s = state(world);
  const doc = documentSpec(world, id);
  s.constraints = { lifecycleId: id };
  const observed = await uploadDocument(world, doc);
  if (!s.lifecycle) s.lifecycle = [];
  s.lifecycle.push(observed);
  return observed;
}

// The status the SERVER holds, re-fetched. Never the panel's or the row's - see rule 6.
async function serverStatus(world, observed) {
  const s = state(world);
  const o = observed || current(world);
  const entry = await s.api.fetchEntry(o.doc.category, o.upload.entryId);
  o.document = entry.document;
  return (o.document && o.document.status) || null;
}

// The full stored file name, extension included. NEVER a stem: uploads here are
// permanent, so the same fixture uploaded twice leaves rows whose stems are prefixes of
// one another, and every reader in this module refuses to guess between them. Third
// occurrence of this trap in the repo.
function storedName(observed) {
  return observed.upload.uploadedFileName || observed.doc.file;
}

// A reason no earlier run can have left on this account - see rule 7.
function uniqueReason(kind) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return kind === 'approve'
    ? `Approved by the automation suite after review of the declared details. Ref ${stamp}`
    : `Please upload a corrected copy: the details on this document need to be revised. Ref ${stamp}`;
}

// The candidate's Documents tab, read through the ONE reader for that surface.
async function candidateDocumentsTabRows(world) {
  const profile = await candidateProfile(world);
  await profile.openDocumentsTab();
  const rows = await profile.readDocumentsTab();
  state(world).candidateRows = rows;
  return rows;
}

// Find one row for a stored file name, refusing to guess and reporting what it saw.
// Rows with a null documentName are counted and reported rather than dropped: the badge
// derived reader returns them precisely so "the document is not listed" cannot be
// concluded from a name that failed to render.
function rowFor(rows, stored, surface) {
  const named = rows.filter((r) => r.documentName);
  const nameless = rows.length - named.length;
  const exact = named.filter((r) => r.documentName === stored);
  if (exact.length === 1) return exact[0];
  const partial = named.filter((r) => r.documentName.includes(stored));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${stored}" matches ${partial.length} rows on ${surface}: ` +
        `${partial.map((r) => r.documentName).join(', ')}.`
    );
  }
  throw new Error(
    `"${stored}" is not listed on ${surface}. ${rows.length} row(s) were read` +
      (nameless ? ` (${nameless} of them with no readable name, which is itself a finding)` : '') +
      `.\nListed: ${named.slice(0, 12).map((r) => `${r.documentName} -> "${r.status}"`).join('\n         ')}`
  );
}

// The agent queue row for a document, SEARCHED for rather than looked for in one page.
// The queue spans every candidate - 250+ rows at last measure - so a document uploaded
// seconds ago is not reliably on page one, and reading the rendered page reported three
// present documents as missing on a previous run. That failure reads as the product
// losing documents, which is a serious and completely wrong conclusion.
async function agentQueueRow(world, stored) {
  await agentSignIn(world);
  const agent = world.pages.agentVerifications;
  await agent.open('ALL');
  await agent.search(stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 40));
  const rows = await agent.readRows();
  state(world).queueRows = rows;
  const match =
    rows.find((r) => r.documentName === stored) ||
    rows.filter((r) => r.documentName && r.documentName.includes(stored))[0] ||
    null;
  if (!match) {
    throw new Error(
      `"${stored}" was not found in the agent verification queue after searching for it. ` +
        `${rows.length} row(s) came back: ${rows.slice(0, 10).map((r) => r.documentName).join(', ')}`
    );
  }
  return match;
}

// Open the candidate's verification panel for a document, widening the dashboard block's
// own paging so a recently uploaded document is reachable at all. See rule 8.
async function openCandidatePanel(world, stored) {
  const s = state(world);
  const { documents } = await candidateUi(world);
  const restore = await documents.widenDashboardPaging();
  s.candidatePanelWidened = true;
  try {
    await documents.openDashboard();
    await documents.openDocument(stored);
    s.candidatePanel = await documents.readPanel();
  } finally {
    await restore();
  }
  await world.attach(
    'the candidate verification panel was reached by widening the dashboard block\'s OWN\n' +
      'page_size (the app requests page=1&page_size=4 and offers no pagination control, so a\n' +
      'document uploaded minutes ago has no reachable panel otherwise). Only the page SIZE was\n' +
      'changed: every value below is the server\'s and was rendered by the app.\n\n' +
      JSON.stringify(s.candidatePanel, null, 1),
    'text/plain'
  );
  return s.candidatePanel;
}

// Comments split by who wrote them. The source taxonomy is the API's (`AI` / `AGENT`),
// and the panel renders it as "Agent" / "Automated System Message" - so both spellings
// are accepted, and the raw source is reported either way.
function splitComments(comments) {
  const list = comments || [];
  const isAi = (c) => /^(ai|automated|system)/i.test(String(c.source || ''));
  const isAgent = (c) => /^agent$/i.test(String(c.source || '').trim());
  return {
    all: list,
    ai: list.filter(isAi),
    agent: list.filter(isAgent),
    unattributed: list.filter((c) => !isAi(c) && !isAgent(c)),
  };
}

// The criteria the AI failed, as the prose it recorded. Used to check that an
// AI-authored revision comment actually explains the failure rather than merely being
// attributed to the AI - a comment stamped "AI" that repeats none of the findings would
// satisfy an attribution-only check while telling the candidate nothing to correct.
function failedCriteria(verification) {
  return ((verification && verification.criteria) || []).filter((c) => c.verdict === VERDICT.FAIL);
}

// -------------------- Givens: which document ---------------------------------

Given(
  'the candidate uploads a document that the AI cannot decide on its own',
  { timeout: AI_STEP },
  async function () {
    const s = state(this);
    s.constraints = { ...UNDECIDABLE_DOCUMENT };
    const doc = resolveDocument(this);
    const observed = await uploadDocument(this, doc);
    if (!s.lifecycle) s.lifecycle = [];
    s.lifecycle.push(observed);
    s.expectUndecided = true;
  }
);

Given('the candidate uploads the name-mismatch lifecycle document', { timeout: AI_STEP }, async function () {
  await uploadNamedLifecycleDocument(this, 'EDU-REVIEW');
});

Given('the candidate uploads the auto-rejected lifecycle document', { timeout: AI_STEP }, async function () {
  await uploadNamedLifecycleDocument(this, 'EDU-REJECTED');
});

Given('the candidate uploads the auto-approved lifecycle document', { timeout: AI_STEP }, async function () {
  await uploadNamedLifecycleDocument(this, 'EDU-APPROVED');
});

// The same document, but forced down the real profile form regardless of
// DOC_UPLOAD_MODE. This scenario exists to settle whether an APPROVED document really
// disappears from the candidate's own list or whether the row measured missing was
// simply ORPHANED - uploaded with no profile entry, which this account has held 73 of.
// An API upload could not tell the two apart, so the mode is pinned for this step only
// and restored afterwards.
Given(
  'the candidate uploads the auto-approved lifecycle document through the profile form',
  { timeout: AI_STEP },
  async function () {
    const s = state(this);
    const doc = documentSpec(this, 'EDU-APPROVED');
    s.constraints = { lifecycleId: 'EDU-APPROVED' };
    const observed = { doc, upload: null };
    const priorIds = await s.api.snapshotDocumentIds();
    const ui = await uploadThroughUi(this, doc);
    Object.assign(observed, ui);
    observed.priorDocumentIds = priorIds;
    s.submitted.set('EDU-APPROVED', observed);
    s.observed = observed;
    if (!s.multiple) s.multiple = [];
    s.multiple.push(observed);
    if (!s.lifecycle) s.lifecycle = [];
    s.lifecycle.push(observed);
    await this.attach(
      'uploaded through the real profile form, so the document row is definitely attached to a ' +
        'profile entry. That is what separates "an approved document is hidden from the candidate" ' +
        'from "the row measured missing was orphaned".',
      'text/plain'
    );
  }
);

Given('the candidate uploads all three lifecycle documents', { timeout: AI_MULTI }, async function () {
  // Uploaded in the order recorded in the test data (90, 91, 92). Order is TEST DATA in
  // this module: cross_document_consistency is evaluated against whatever is already on
  // the account, so a different order gives a different - and unreproducible - verdict.
  for (const id of ['EDU-APPROVED', 'EDU-REVIEW', 'EDU-REJECTED']) {
    await uploadNamedLifecycleDocument(this, id);
  }
});

// The AI-verify step phrased as a precondition. Same work as "When the AI verifies the
// document"; a separate step so a scenario can read as Given/When/Then without the
// verification looking like the action under test.
Given('the AI has verified the document', { timeout: AI_STEP }, async function () {
  // Flush point: this can directly follow the Given block, so any queued upload happens
  // here. A no-op once the queue is empty.
  await flushUploads(this);
  const o = await verifyDocument(this, current(this));
  // The verdict, attached as the plain criterion list rather than through
  // documentReport(): that reader takes (doc, observed) and reads upload fields the UI
  // upload path does not set, so calling it here threw on a healthy verification. The
  // criteria are what the following steps assert on, so this is the useful record anyway.
  await this.attach(
    `${o.doc.id} -> ${(o.document || {}).status}  (ai_verification.status ` +
      `${(o.verification || {}).status})\n` +
      ((o.verification && o.verification.criteria) || [])
        .map((c) => `  ${c.verdict.toUpperCase().padEnd(9)} ${c.key}: ${c.detail}`)
        .join('\n'),
    'text/plain'
  );
});

// -------------------- Then: status, on the server and on both portals --------

Then('the status should have been chosen by the AI rather than by an agent', async function () {
  const o = current(this);
  const v = verificationOf(this);
  const comments = splitComments(o.document && o.document.comments);
  const problems = [];

  // The AI's own recorded status must be the document's status. If they differ, somebody
  // or something else moved it, and every "the AI decided this" claim after that is void.
  if (!v.status) {
    problems.push('ai_verification carries no status of its own, so who decided cannot be established');
  } else if (o.document && o.document.status !== v.status) {
    problems.push(
      `the document is ${o.document.status} but ai_verification.status is ${v.status}, so the ` +
        'status was not the AI\'s decision'
    );
  }
  if (comments.agent.length) {
    problems.push(
      `${comments.agent.length} comment(s) on this document are attributed to an agent, so an ` +
        `agent has acted on it: ${comments.agent.map((c) => c.comment.slice(0, 80)).join(' | ')}`
    );
  }

  await this.attach(
    `ai_verification.status=${v.status}  document.status=${o.document && o.document.status}\n` +
      `comments: ${comments.all.map((c) => `[${c.source}]`).join(' ') || '(none)'}`,
    'text/plain'
  );
  expect(problems, problems.join('\n')).to.deep.equal([]);
});

Then('every AI criterion should have passed', function () {
  const v = verificationOf(this);
  const criteria = v.criteria || [];
  // A step that asserted nothing must fail - rule 2. An empty criteria list would
  // otherwise satisfy "every criterion passed" perfectly.
  expect(criteria.length, 'the AI returned no criteria at all, so there is nothing to assert').to.be.greaterThan(0);
  const notPassed = criteria.filter((c) => c.verdict !== VERDICT.PASS);
  expect(
    notPassed.map((c) => `${c.key}: ${c.verdict} - ${c.detail}`),
    'this document is the clean one, so every criterion should pass. These did not:'
  ).to.deep.equal([]);
});

Then(
  'the document should be listed on the candidate Documents tab with status {string}',
  { timeout: UI_STEP },
  async function (expected) {
    const o = current(this);
    const stored = storedName(o);
    const rows = await candidateDocumentsTabRows(this);
    const row = rowFor(rows, stored, 'the candidate Documents tab');
    await this.attach(`candidate Documents tab: ${row.documentName} -> "${row.status}" (${row.section})`, 'text/plain');
    expect(
      row.status,
      `the candidate's Documents tab shows "${row.status}" for a document the server holds as ` +
        `${(o.document && o.document.status) || 'unknown'}. Expected the tab to read "${expected}".`
    ).to.equal(expected);
  }
);

Then(
  'the document should be listed under the correct section of the candidate Documents tab',
  { timeout: UI_STEP },
  async function () {
    const o = current(this);
    const rows = state(this).candidateRows || (await candidateDocumentsTabRows(this));
    const row = rowFor(rows, storedName(o), 'the candidate Documents tab');
    // The tab's own headings, mapped from the API category. The row carries no category
    // of its own, so the grouping IS the category as far as the candidate can tell - a
    // document filed under the wrong heading is a real defect and invisible to any
    // assertion that only checks the status.
    const SECTION_FOR = {
      EDUCATION: 'Education',
      WORKEXPERIENCE: 'Work Experience',
      CERTIFICATION: 'Certifications',
    };
    const want = SECTION_FOR[o.doc.category];
    expect(want, `no Documents tab section is mapped for category ${o.doc.category}`).to.exist;
    expect(
      row.section,
      `${row.documentName} was uploaded as ${o.doc.category} but is listed under ` +
        `"${row.section}" on the candidate's Documents tab, not "${want}".`
    ).to.equal(want);
  }
);

Then(
  'the agent verification queue should show that document with status {string}',
  { timeout: UI_STEP },
  async function (expected) {
    const o = current(this);
    const row = await agentQueueRow(this, storedName(o));
    await this.attach(`agent queue: ${row.documentName} -> "${row.status}"`, 'text/plain');
    expect(
      row.status.trim(),
      `the agent queue shows "${row.status}" for a document the server holds as ` +
        `${(o.document && o.document.status) || 'unknown'}. Expected "${expected}".`
    ).to.equal(expected);
  }
);

Then(
  'the document should be listed under the agent {string} filter tab',
  { timeout: UI_STEP },
  async function (label) {
    const o = current(this);
    const stored = storedName(o);
    await agentSignIn(this);
    const agent = this.pages.agentVerifications;
    // The API status this label denotes, resolved through the page object's own maps
    // rather than a literal - the pill and the tab use DIFFERENT strings for AWAITING
    // ("Needs Review" against "Need Review") and a literal here would have to pick one.
    const status = Object.keys(AgentVerificationsPage.STATUS_LABEL).find(
      (k) =>
        AgentVerificationsPage.STATUS_LABEL[k] === label ||
        AgentVerificationsPage.TAB_LABEL[k] === label
    );
    expect(
      status,
      `"${label}" is not a status this build renders. Pills: ` +
        `${Object.values(AgentVerificationsPage.STATUS_LABEL).join(', ')}; tabs: ` +
        `${Object.values(AgentVerificationsPage.TAB_LABEL).join(', ')}`
    ).to.exist;

    await agent.selectTab(status);
    await agent.search(stored.replace(/\.[a-z0-9]+$/i, '').slice(0, 40));
    const rows = await agent.readRows();
    const found = rows.find((r) => r.documentName && r.documentName.includes(stored));
    await this.attach(
      `filter tab "${AgentVerificationsPage.TAB_LABEL[status]}" + search -> ` +
        `${rows.length} row(s): ${rows.slice(0, 6).map((r) => r.documentName).join(', ')}`,
      'text/plain'
    );
    expect(
      found,
      `${stored} is held as ${status} by the server but does not appear under the agent's ` +
        `"${AgentVerificationsPage.TAB_LABEL[status]}" filter tab. A document missing from its own ` +
        'status tab is invisible to the agent whose queue it belongs in.'
    ).to.exist;
  }
);

// -------------------- Then: the two comment cases ---------------------------

When('the candidate opens the verification panel for that document', { timeout: UI_STEP }, async function () {
  await openCandidatePanel(this, storedName(current(this)));
});

Then('the candidate panel status should read {string}', function (expected) {
  const panel = state(this).candidatePanel;
  expect(panel, 'the candidate verification panel was never read').to.exist;
  expect(
    panel.status,
    `the candidate's own verification panel reads "${panel.status}" for a document the server ` +
      `holds as ${(current(this).document || {}).status}. Expected "${expected}".`
  ).to.equal(expected);
});

Then("the candidate should be shown the agent's reason attributed to the agent", function () {
  const s = state(this);
  const panel = s.candidatePanel;
  expect(panel, 'the candidate verification panel was never read').to.exist;
  expect(s.agentReason, 'no agent decision was committed in this scenario, so there is no reason to look for')
    .to.exist;

  const history = panel.commentHistory || [];
  const problems = [];

  // The reason is matched by its unique per-run reference, not by a phrase - see rule 7.
  // This account holds comments from every previous run and none can be removed, so a
  // phrase match would pass on a comment left weeks ago.
  const ref = (/Ref ([\w-]+)/.exec(s.agentReason) || [])[1];
  const mine = history.filter((h) => ref && String(h.raw || h.comment || '').includes(ref));
  if (!mine.length) {
    problems.push(
      `the reason this run's agent gave (ref ${ref}) is not in the candidate's comment history. ` +
        `History: ${JSON.stringify(history)}`
    );
  } else {
    const attributed = mine.filter((h) => /^agent$/i.test(String(h.source || '').trim()));
    if (!attributed.length) {
      problems.push(
        'the agent\'s reason reached the candidate but is not attributed to the agent. It is ' +
          `sourced ${mine.map((h) => JSON.stringify(h.source)).join(', ')}, and the AC requires the ` +
          'candidate to be able to tell who flagged the document.'
      );
    }
  }

  expect(problems, problems.join('\n')).to.deep.equal([]);
});

// >>> THE OTHER HALF OF THE RULE, AND IT NEEDS ITS OWN ASSERTION. <<<
// "The agent's comment is shown" is satisfied perfectly well by a panel showing the
// agent's comment AND the AI findings together, which is not what was specified for an
// agent-decided document. Asserted separately so a red row says which half broke.
Then(
  'the candidate should not be shown the AI findings as the reason for the revision',
  function () {
    const s = state(this);
    const panel = s.candidatePanel;
    expect(panel, 'the candidate verification panel was never read').to.exist;
    const v = verificationOf(this);
    const failed = failedCriteria(v);

    const comments = splitComments(panel.commentHistory);
    const fromAi = comments.ai;

    // Only meaningful if the AI actually found something - rule 2. On a document with no
    // failed criterion there are no AI findings to leak and the step would pass vacuously.
    expect(
      failed.length,
      'this step is only meaningful on a document the AI flagged, and nothing failed on this ' +
        'one - so it would pass without proving anything'
    ).to.be.greaterThan(0);

    expect(
      fromAi.map((c) => `[${c.source}] ${String(c.comment).slice(0, 120)}`),
      'this document was decided by an AGENT, so the reason the candidate is shown should be the ' +
        'agent\'s. These comments attributed to the automated system are also being shown, which ' +
        'presents the AI\'s findings as the reason for the agent\'s decision:'
    ).to.deep.equal([]);
  }
);

Then(
  'the candidate should be shown a revision reason attributed to the automated system',
  { timeout: UI_STEP },
  async function () {
    const o = current(this);
    // Read the SERVER's comment rows as well as the panel. The panel is what the
    // candidate sees and is the assertion; the server rows are attached beside it so a
    // red row distinguishes "the app stored no AI comment" from "it stored one and does
    // not render it" - completely different defects with the same symptom.
    const stored = (o.document && o.document.comments) || [];
    const panel = await openCandidatePanel(this, storedName(o));
    const inPanel = splitComments(panel.commentHistory);
    const onServer = splitComments(stored);

    await this.attach(
      `server comments: ${JSON.stringify(stored)}\n` +
        `panel history:   ${JSON.stringify(panel.commentHistory)}`,
      'text/plain'
    );

    const problems = [];
    if (!onServer.ai.length) {
      problems.push(
        'the AI set this document to Revision Required but recorded no comment of its own, so the ' +
          'candidate is given no reason at all. Server comments: ' +
          `${JSON.stringify(stored.map((c) => c.source))}`
      );
    }
    if (!inPanel.ai.length) {
      problems.push(
        onServer.ai.length
          ? 'the AI recorded a reason on the server but the candidate\'s panel does not show it ' +
            `attributed to the automated system. Panel history: ${JSON.stringify(panel.commentHistory)}`
          : 'the candidate\'s panel shows nothing attributed to the automated system'
      );
    }
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

Then('that reason should repeat the criteria the AI failed', function () {
  const s = state(this);
  const v = verificationOf(this);
  const failed = failedCriteria(v);
  expect(
    failed.length,
    'no criterion failed, so there is nothing the reason could be expected to repeat - this step ' +
      'would pass without asserting anything'
  ).to.be.greaterThan(0);

  const aiComments = splitComments(s.candidatePanel && s.candidatePanel.commentHistory).ai;
  const blob = aiComments.map((c) => String(c.comment || '')).join(' \n ');

  // Matched on the recorded DETAIL prose, because that is what the AI writes into the
  // comment - a comment naming the criterion KEY ("date_validity") would tell a candidate
  // nothing, and a check on the key would pass on exactly that.
  const missing = failed.filter((c) => {
    const detail = String(c.detail || '').trim();
    if (!detail) return false;
    // First clause of the detail: the AI concatenates its findings, and later clauses are
    // sometimes reworded, so requiring the whole sentence verbatim would fail on a
    // document whose reason is genuinely complete.
    const head = detail.split(/[.;]/)[0].trim().slice(0, 40);
    return head && !blob.toLowerCase().includes(head.toLowerCase());
  });

  expect(
    missing.map((c) => `${c.key}: ${c.detail}`),
    'the candidate is told the document needs revision, but these criteria the AI failed are not ' +
      `mentioned in the reason they are shown, so they have nothing to correct.\nReason shown: ${blob}`
  ).to.deep.equal([]);
});

// -------------------- Then: agent decisions with a unique reason -------------

When('the agent requests a revision on that document with a unique reason', { timeout: UI_STEP }, async function () {
  const s = state(this);
  await ensureReviewPanelOpen(this);
  const agent = this.pages.agentVerifications;
  const dialog = await agent.openDecisionDialog('revision');
  s.agentReason = uniqueReason('revision');
  s.decisionResult = await agent.submitDecision(dialog, 'revision', s.agentReason);
  await serverStatus(this);
  await this.attach(
    `agent decision committed: ${JSON.stringify(s.decisionResult)}\nreason: ${s.agentReason}`,
    'text/plain'
  );
});

When('the agent approves that document with a unique reason', { timeout: UI_STEP }, async function () {
  const s = state(this);
  await ensureReviewPanelOpen(this);
  const agent = this.pages.agentVerifications;
  const dialog = await agent.openDecisionDialog('approve');
  s.agentReason = uniqueReason('approve');
  s.decisionResult = await agent.submitDecision(dialog, 'approve', s.agentReason);
  await serverStatus(this);
  await this.attach(
    `agent decision committed: ${JSON.stringify(s.decisionResult)}\nreason: ${s.agentReason}`,
    'text/plain'
  );
});

// -------------------- The three documents side by side ----------------------

Then(
  'each document should carry its own status on the candidate Documents tab',
  { timeout: UI_STEP },
  async function () {
    const s = state(this);
    const docs = s.lifecycle || [];
    expect(docs.length, 'no lifecycle documents were uploaded in this scenario').to.be.greaterThan(0);
    const rows = await candidateDocumentsTabRows(this);

    // Collect across all three and throw once. Three documents fail for unrelated
    // reasons, and a scenario abandoned at the first would say nothing about the other
    // two - the same reasoning as the promo module's consolidated table steps.
    const problems = [];
    const seen = [];
    for (const o of docs) {
      const stored = storedName(o);
      const apiStatus = await serverStatus(this, o);
      const expected = CandidateDocumentsPage.STATUS_LABEL[apiStatus];
      let row = null;
      try {
        row = rowFor(rows, stored, 'the candidate Documents tab');
      } catch (e) {
        problems.push(`${o.doc.id}: ${e.message.split('\n')[0]}`);
        continue;
      }
      seen.push(`${o.doc.id} ${stored} -> API ${apiStatus} / tab "${row.status}"`);
      if (!expected) {
        problems.push(`${o.doc.id}: no candidate wording is mapped for API status ${apiStatus}`);
      } else if (row.status !== expected) {
        problems.push(
          `${o.doc.id}: the server holds ${apiStatus} but the candidate's tab reads "${row.status}" ` +
            `(expected "${expected}")`
        );
      }
    }
    await this.attach(seen.join('\n'), 'text/plain');

    // The independence claim itself: three documents built for three end states must not
    // all be showing one status. Asserted explicitly, because three rows each matching
    // their own API status would also be satisfied if the AI had given all three the same
    // verdict - in which case the scenario proves nothing about independence.
    const statuses = [...new Set(seen.map((l) => (/tab "([^"]+)"/.exec(l) || [])[1]).filter(Boolean))];
    if (statuses.length < 2 && docs.length > 1) {
      problems.push(
        `all ${docs.length} documents show the same status ("${statuses[0]}"), so this scenario ` +
          'cannot demonstrate that statuses are independent. The AI gave them the same verdict - ' +
          'see the per-document verdicts attached above.'
      );
    }
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

Then(
  'each document should carry the same status in the agent verification queue',
  { timeout: UI_STEP },
  async function () {
    const docs = state(this).lifecycle || [];
    const problems = [];
    const seen = [];
    for (const o of docs) {
      const stored = storedName(o);
      const apiStatus = await serverStatus(this, o);
      const expected = AgentVerificationsPage.STATUS_LABEL[apiStatus];
      let row = null;
      try {
        row = await agentQueueRow(this, stored);
      } catch (e) {
        problems.push(`${o.doc.id}: ${e.message.split('\n')[0]}`);
        continue;
      }
      seen.push(`${o.doc.id} -> API ${apiStatus} / queue "${row.status}"`);
      if (row.status.trim() !== expected) {
        problems.push(
          `${o.doc.id}: the server holds ${apiStatus} but the agent queue reads "${row.status}" ` +
            `(expected "${expected}")`
        );
      }
    }
    await this.attach(seen.join('\n'), 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

Then(
  'the status wording should agree across the candidate and agent portals for each document',
  { timeout: UI_STEP },
  async function () {
    const docs = state(this).lifecycle || [];
    const rows = await candidateDocumentsTabRows(this);
    const problems = [];
    const table = [];
    for (const o of docs) {
      const stored = storedName(o);
      const apiStatus = await serverStatus(this, o);
      let candidateWord = null;
      try {
        candidateWord = rowFor(rows, stored, 'the candidate Documents tab').status;
      } catch (e) {
        problems.push(`${o.doc.id}: not on the candidate tab`);
        continue;
      }
      const agentWord = (await agentQueueRow(this, stored)).status.trim();
      table.push(`${o.doc.id}  API ${apiStatus}  candidate "${candidateWord}"  agent "${agentWord}"`);
      if (candidateWord !== agentWord) {
        problems.push(
          `${o.doc.id}: API ${apiStatus} reads "${candidateWord}" to the candidate and ` +
            `"${agentWord}" to the agent, so the two are discussing the same document in ` +
            'different words'
        );
      }
    }
    await this.attach(table.join('\n'), 'text/plain');
    expect(problems, problems.join('\n')).to.deep.equal([]);
  }
);

// -------------------- The surfaces themselves -------------------------------

Given(
  'the candidate has more documents than the dashboard block displays',
  { timeout: NET_STEP },
  async function () {
    const s = state(this);
    const all = await s.api.listDocuments({ pageSize: 200 });
    const rows = Array.isArray(all) ? all : Object.values(all).filter((r) => r && r.id);
    s.allDocumentRows = rows;
    // A precondition, asserted rather than assumed: on an account with four documents or
    // fewer the cap is unobservable and the scenario would pass while proving nothing.
    expect(
      rows.length,
      'this scenario needs more documents on the account than the dashboard block shows, and the ' +
        `account holds ${rows.length}`
    ).to.be.greaterThan(4);
    await this.attach(`the account holds ${rows.length} document row(s)`, 'text/plain');
  }
);

When('the candidate opens the dashboard documents block', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const { documents } = await candidateUi(this);
  // >>> DELIBERATELY NOT WIDENED. <<< The comment scenarios widen the block's paging so
  // the panel is reachable at all; if this step did too, the cap would never be observed
  // and the workaround would be hiding the defect it exists to work around.
  s.dashboardPaging = await documents.dashboardPagingContract();
  await this.attach(
    `the block's own request: ${JSON.stringify(s.dashboardPaging.request)}\n` +
      `cards rendered: ${s.dashboardPaging.cardsRendered}\n` +
      `paging controls offered: ${JSON.stringify(s.dashboardPaging.pagingControls)}`,
    'text/plain'
  );
});

Then('the block should offer a way to reach every document', function () {
  const s = state(this);
  const paging = s.dashboardPaging;
  expect(paging, 'the dashboard documents block was never read').to.exist;
  const req = paging.request || {};
  const total = req.count != null ? req.count : (s.allDocumentRows || []).length;

  // Measured off the app's own request, never compared to a remembered "4" - hardcoding
  // the figure would go stale silently the day dev raises it, and the finding is the
  // absence of a way past the cap rather than the number itself.
  const reachable = paging.cardsRendered;
  const canPage = (paging.pagingControls || []).length > 0;
  expect(
    canPage || reachable >= total,
    `the candidate's dashboard block renders ${reachable} of ${total} documents ` +
      `(its request asks for page_size=${req.pageSize}${req.hasNextPage ? ', and the response ' +
        'carries a next page' : ''}) and offers no control to reach the rest ` +
      `(controls found: ${JSON.stringify(paging.pagingControls)}). This block is the ONLY candidate ` +
      `surface that shows why a document was flagged, so ${Math.max(0, total - reachable)} ` +
      'document(s) have no reachable reason at all.'
  ).to.equal(true);
});

Then(
  'the verification reason should be reachable for the most recently uploaded document',
  { timeout: UI_STEP },
  async function () {
    const s = state(this);
    const rows = s.allDocumentRows || [];
    // Newest by id. The account's own created-at ordering has not been established, and
    // ids are monotonic on this API - so this is the one ordering that is measurable
    // rather than assumed.
    const newest = [...rows].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
    expect(newest, 'the account holds no document rows').to.exist;
    const { documents } = await candidateUi(this);
    const cards = await documents.readDocumentCards();
    const reachable = cards.some((c) => c.documentName && newest.file_name.includes(c.documentName));
    await this.attach(
      `newest row: ${newest.id} ${newest.file_name} (${newest.status})\n` +
        `dashboard offers: ${cards.map((c) => c.documentName).join(', ') || '(none)'}`,
      'text/plain'
    );
    expect(
      reachable,
      `the newest document on the account (${newest.file_name}, ${newest.status}) is not among the ` +
        `${cards.length} the dashboard block offers, so the candidate cannot open its verification ` +
        'panel and cannot be told why it was flagged.'
    ).to.equal(true);
  }
);

When('the candidate selects that document on the Documents tab', { timeout: UI_STEP }, async function () {
  const s = state(this);
  const o = current(this);
  const profile = await candidateProfile(this);
  await profile.openDocumentsTab();
  const { documents } = await candidateUi(this);
  s.documentsTabActivation = await documents.documentsTabRowActivation(storedName(o));
  await this.attach(
    `selecting "${storedName(o)}" on the Documents tab produced: ` +
      JSON.stringify(s.documentsTabActivation, null, 1),
    'text/plain'
  );
});

Then("the document's verification details should be shown", function () {
  const a = state(this).documentsTabActivation;
  expect(a, 'the Documents tab row was never selected').to.exist;
  // Asserted as "something happened", not as "a panel with this heading appeared". The
  // control's intended behaviour has never been specified, and a locator built from a
  // guess could only ever answer "absent" - which would report a working panel with
  // different markup as a dead control. What the click DID do is attached either way.
  expect(
    a.didSomething,
    'clicking the document name on the candidate\'s Documents tab did nothing at all: no dialog ' +
      'opened, no download started, no navigation happened and no request was made. It is a real ' +
      '<button>, so something is meant to happen - and this tab is the only candidate surface ' +
      'that lists every document, so its rows are the natural route to a document\'s details.'
  ).to.equal(true);
});

Then(
  "the document should still be returned by the candidate's own documents endpoint",
  { timeout: NET_STEP },
  async function () {
    const s = state(this);
    const o = current(this);
    const rowId = o.upload.documentRowId;
    const stored = storedName(o);

    // Both endpoints, because they were measured DISAGREEING: /candidate/documents/
    // returned 29 rows and omitted the one APPROVED row, while /candidate/documents/all/
    // included it. Asking both is what turns "the document is missing" into a statement
    // about WHICH surface loses it.
    const own = await s.api.request('GET', '/core/api/v1/candidate/documents/?page=1&page_size=200');
    const ownRows = (own.body && own.body.results) || [];
    const all = await s.api.listDocuments({ pageSize: 200 });
    const allRows = Array.isArray(all) ? all : Object.values(all).filter((r) => r && r.id);

    const inOwn = ownRows.find((r) => r.id === rowId || (r.file_name || '').includes(stored));
    const inAll = allRows.find((r) => r.id === rowId || (r.file_name || '').includes(stored));

    await this.attach(
      `document row ${rowId} (${stored}), status ${(o.document || {}).status}\n` +
        `  /candidate/documents/      count ${own.body && own.body.count}, returned ` +
        `${ownRows.length}  -> ${inOwn ? 'PRESENT' : 'MISSING'}\n` +
        `  /candidate/documents/all/  returned ${allRows.length}  -> ${inAll ? 'PRESENT' : 'MISSING'}\n` +
        `  uploaded via ${o.upload.viaUi === false ? 'API' : 'the profile form'}, entry ` +
        `${o.upload.entryId} - so the row ${o.upload.entryId ? 'IS' : 'is NOT'} attached to a ` +
        'profile entry',
      'text/plain'
    );

    expect(
      inOwn,
      `the document is ${(o.document || {}).status} and the candidate's own documents endpoint no ` +
        `longer returns it (it returns ${ownRows.length} of ${allRows.length} rows). It was ` +
        'uploaded through the profile form in this run, so it is attached to a profile entry and ' +
        'cannot be dismissed as an orphaned row. Both candidate surfaces are built on this ' +
        'endpoint, so the candidate can never see that their document was approved - the one ' +
        'outcome they most need.'
    ).to.exist;
  }
);

// No comment has reached the candidate yet.
//
// Distinct from "the candidate should not yet be shown an agent decision remark", which
// requires a FAILING criterion to be meaningful. This one is used in two places where that
// precondition does not hold: a Need Review document, and an auto-APPROVED document where
// every criterion passed. On an approved document the absence is its own finding - a
// comment on a document that passed every criterion would be telling the candidate
// something about a document with nothing wrong with it.
//
// The SERVER's comment rows are the subject, re-fetched rather than read off a panel: the
// panel would only prove the app does not render a comment, and "not stored" and "stored
// but not rendered" are different defects with the same symptom.
Then('no decision comment should be shown to the candidate yet', { timeout: NET_STEP }, async function () {
  const o = current(this);
  await serverStatus(this, o);
  const comments = (o.document && o.document.comments) || [];
  await this.attach(
    `document ${o.upload.documentRowId} (${(o.document || {}).status}) carries ` +
      `${comments.length} comment row(s)`,
    'text/plain'
  );
  expect(
    comments.map((c) => `[${c.source}] ${String(c.comment).slice(0, 90)}`),
    'no agent has decided on this document, so the candidate should have been told nothing. ' +
      'These remarks are already attached to it:'
  ).to.deep.equal([]);
});
