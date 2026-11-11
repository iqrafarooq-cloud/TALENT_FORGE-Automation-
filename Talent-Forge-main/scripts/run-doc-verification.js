// run-doc-verification.js - the standalone automation run. Reads every document in
// test-data/document-verification/documents.json, submits it to the live API, waits for
// the AI verification result, retrieves it, compares it against the expected result,
// and writes reports/document-verification-report.{md,json}.
//
//     npm run test:doc-verify                       # the whole matrix
//     npm run test:doc-verify -- --only ENG-01,NAME-03
//     npm run test:doc-verify -- --types positive,negative
//     npm run test:doc-verify -- --category EDUCATION
//     npm run test:doc-verify -- --dry-run          # build every form, post nothing
//     npm run test:doc-verify -- --skip-large       # leave the 5 MB and 8 MB fixtures out
//     npm run test:doc-verify -- --allow-pending    # explicitly run with incomplete expectations
//
// ============================================================================
// WHY THIS IS SERIAL, AND MUST STAY SERIAL
// ============================================================================
// `cross_document_consistency` is evaluated against everything already submitted, so
// the ORDER documents arrive in is part of the test data (`order`). NAME-06 must be
// first, the two wrong-name documents must follow the correct ones, and EDGE-03 must
// follow NAME-03. Two documents uploaded concurrently make that ordering meaningless
// and the criterion unassertable. Do not add concurrency here.
//
// ============================================================================
// WHAT AN EXIT CODE MEANS
// ============================================================================
//   0  every document with an expected result matched it
//   1  at least one document did not match  (INCLUDING known product defects, per
//      requirement section 15 - a known bug stays a failing test)
//   2  the run could not be performed at all (auth, fixtures, transport, incomplete configuration)
//
// A live run with unresolved expectations is blocked before its first upload unless
// --allow-pending is supplied. Pending is never counted as a pass.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { DocVerificationApi } = require('../utils/docVerificationApi');
const { resolveFixture, reconcileWithTestData } = require('../utils/docVerificationFixtures');
const { compareDocument, documentReport, splitFindings } = require('../utils/docVerificationEvidence');
const { DocVerificationReport } = require('../utils/docVerificationReport');
const { DocVerificationError, KIND } = require('../utils/docVerificationErrors');

const TEST_DATA = path.resolve(__dirname, '..', 'test-data', 'document-verification', 'documents.json');
// The two fixtures big enough to slow a run down noticeably. --skip-large drops them.
const LARGE = new Set(['FILE-03', 'FILE-04']);

function parseArgs(argv) {
  const out = {
    only: null,
    types: null,
    category: null,
    dryRun: false,
    skipLarge: false,
    allowPending: false,
    reportName: 'document-verification-report',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-large') out.skipLarge = true;
    else if (a === '--allow-pending') out.allowPending = true;
    else if (a === '--only') out.only = new Set(String(argv[++i] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
    else if (a === '--types') out.types = new Set(String(argv[++i] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    else if (a === '--category') out.category = String(argv[++i] || '').toUpperCase();
    else if (a === '--report-name') out.reportName = String(argv[++i] || out.reportName);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function selectDocuments(all, args) {
  let docs = all.slice();
  if (args.only) docs = docs.filter((d) => args.only.has(d.id.toUpperCase()));
  if (args.types) docs = docs.filter((d) => (d.types || []).some((t) => args.types.has(String(t).toLowerCase())));
  if (args.category) docs = docs.filter((d) => d.category === args.category);
  if (args.skipLarge) docs = docs.filter((d) => !LARGE.has(d.id));
  return docs.sort((a, b) => a.order - b.order);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(fs.readFileSync(TEST_DATA, 'utf8'));
  const selected = selectDocuments(data.documents, args);

  if (!selected.length) {
    console.error('No documents matched the given filters.');
    process.exit(2);
  }

  // Fixture reconciliation up front. A run that starts and dies on document 30 because
  // a file was renamed has wasted 29 uploads.
  const recon = reconcileWithTestData(selected);
  if (recon.missingFromDisk.length) {
    console.error('These files are named in the test data but are not on disk:');
    recon.missingFromDisk.forEach((f) => console.error('  ' + f));
    process.exit(2);
  }

  const pending = selected.filter((d) => !d.expected);
  if (pending.length && !args.dryRun && !args.allowPending) {
    console.error(
      `Refusing to upload ${pending.length} document(s) with no expected result: ` +
        pending.map((d) => d.id).join(', ')
    );
    console.error('Fill the expected blocks in test-data/document-verification/documents.json, or rerun with --allow-pending.');
    process.exit(2);
  }

  const api = new DocVerificationApi();
  const email = process.env.DOC_CANDIDATE_EMAIL || process.env.CANDIDATE_EMAIL;
  const password = process.env.DOC_CANDIDATE_PASSWORD || process.env.CANDIDTAE_PASSWORD;

  console.log('=========================================================');
  console.log(' AI document verification - automation run');
  console.log('=========================================================');
  console.log(`api         ${api.baseUrl}`);
  console.log(`candidate   ${email || '(not configured)'}`);
  console.log(`documents   ${selected.length} of ${data.documents.length}${args.dryRun ? '   [DRY RUN]' : ''}`);
  console.log('');

  let me;
  try {
    me = await api.login(email, password, 'candidate');
  } catch (e) {
    console.error(e instanceof DocVerificationError ? e.toReport() : e);
    process.exit(2);
  }

  const report = new DocVerificationReport({
    baseUrl: api.baseUrl,
    candidate: me.email,
    declaredName: me.declaredName,
    documentsSelected: selected.length,
    documentsInTestData: data.documents.length,
    filters: { only: args.only && [...args.only], types: args.types && [...args.types], category: args.category, skipLarge: args.skipLarge },
  });

  // ---- run notes: the things that change how every row must be read -------------
  if (me.declaredName !== data.declared.legal_name) {
    report.note(
      `**Declared name mismatch.** The account's declared legal name is "${me.declaredName}" but the ` +
        `test data expects "${data.declared.legal_name}". Every identity_name_match and ` +
        'cross_document_consistency result below is meaningless until these agree. This is a fixture ' +
        'problem, not a product defect.'
    );
  }

  // Quantify the isolation gap before uploading anything, so the report states it as a
  // measured number rather than a caveat.
  try {
    const before = await api.listDocuments();
    const normalise = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const conflicts = before.filter((d) => {
      const n = d.ai_verification && d.ai_verification.extracted && d.ai_verification.extracted.legal_name;
      return n && String(n).trim() && normalise(n) !== normalise(me.declaredName);
    });
    report.meta.documentRowsBeforeRun = before.length;
    report.meta.conflictingNameDocumentsBeforeRun = conflicts.length;
    if (conflicts.length) {
      report.note(
        `**Cross-document history is not clean, and cannot be cleaned.** The account already holds ` +
          `${before.length} document rows, ${conflicts.length} of which name somebody other than the ` +
          `applicant (${[...new Set(conflicts.map((c) => c.ai_verification.extracted.legal_name))].join(', ')}). ` +
          'The API exposes no DELETE for a document row and deleting a profile entry leaves its document ' +
          'orphaned, so `cross_document_consistency` CANNOT pass on this account regardless of what is ' +
          'uploaded. Run `node scripts/doc-verification-reset.js` for the breakdown.'
      );
    }
  } catch {
    report.note('Could not read the existing document rows, so the cross-document baseline is unknown for this run.');
  }

  // ---- the walk ------------------------------------------------------------------
  console.log('  #  document      verdict  upload      status');
  console.log('  -------------------------------------------------------------------');

  for (const doc of selected) {
    let observed = null;
    let findings = [];

    try {
      const fixture = resolveFixture(doc.file, doc.id);

      if (args.dryRun) {
        const form = await api.buildForm(doc, fixture);
        const fields = [...form.entries()].map(([k, v]) => (typeof v === 'string' ? `${k}=${v}` : `${k}=<file ${v.size}B>`));
        console.log(`  ${String(doc.order).padStart(3)}  ${doc.id.padEnd(12)} DRY      ${fields.join('  ')}`);
        continue;
      }

      const upload = await api.upload(doc, fixture);
      observed = { upload };

      if (upload.accepted) {
        try {
          const result = await api.waitForVerification(doc.category, upload.entryId);
          observed.verification = result.verification;
          observed.document = result.document;
          observed.elapsedMs = result.elapsedMs;
          observed.polls = result.polls;
        } catch (e) {
          if (e instanceof DocVerificationError && e.kind === KIND.AI_TIMEOUT) {
            // A timeout is its own diagnosis and must not be reported as a verdict.
            findings.push({ kind: KIND.AI_TIMEOUT, subject: `${doc.id} ai`, message: e.message, ...e.detail });
          } else {
            throw e;
          }
        }
      }

      findings.push(...compareDocument(doc, observed));
    } catch (e) {
      if (e instanceof DocVerificationError) {
        findings.push({ kind: e.kind, subject: doc.id, message: e.message, ...e.detail });
      } else {
        findings.push({ kind: KIND.API, subject: doc.id, message: e.message });
      }
    }

    const { failing, pending } = splitFindings(findings);
    const verdict = failing.length ? 'FAILED' : pending.length ? 'PENDING' : 'PASSED';
    const evidence = observed && observed.upload ? documentReport(doc, observed) : `Document ${doc.id}: no upload was attempted.`;
    report.add(doc, observed, findings, evidence);
    console.log('  ' + DocVerificationReport.line(doc, verdict, observed, findings));
  }

  if (args.dryRun) {
    console.log('\nDry run complete. Nothing was posted and no report was written.');
    return;
  }

  // ---- report --------------------------------------------------------------------
  report.meta.apiCalls = api.requestLog().length;
  const { jsonPath, mdPath } = report.write(args.reportName);
  const s = report.summary();

  console.log('');
  console.log('=========================================================');
  console.log(` ${s.total} documents:  ${s.passed} passed   ${s.failed} FAILED   ${s.pending} pending`);
  if (s.knownDefectFailures) {
    console.log(` of the failures, ${s.knownDefectFailures} are already-known product defects and ${s.newFailures} are new`);
  }
  if (s.pending) {
    console.log('');
    console.log(` ${s.pending} document(s) have NO expected result and were NOT verified.`);
    console.log(' They are not counted as passes. Fill in the `expected` blocks in');
    console.log(' test-data/document-verification/documents.json.');
  }
  console.log('');
  console.log(` report  ${path.relative(process.cwd(), mdPath)}`);
  console.log(`         ${path.relative(process.cwd(), jsonPath)}`);
  console.log('=========================================================');

  // A pending matrix is incomplete verification, not a successful run. Keep the
  // distinction visible to CI and callers even when no observed result disagreed.
  process.exitCode = s.failed > 0 || s.pending > 0 ? 1 : 0;
})().catch((e) => {
  console.error(e instanceof DocVerificationError ? e.toReport() : e);
  process.exitCode = 2;
});
