// probe-doc-verification.js - drives the REAL DocVerificationApi client through one
// document, end to end, and dumps every observable thing it touched.
//
// This is the script to reach for when a document-verification scenario fails in a way
// that looks like an app defect. It answers, in one run and without Cucumber in the
// way: did the login work, did the reference data resolve, what exactly was posted,
// what did the API answer, how long did the AI take, what verdicts came back, and what
// did it extract.
//
//     node scripts/probe-doc-verification.js                    # FILE-01-PDF (benign)
//     node scripts/probe-doc-verification.js ENG-01             # one document by id
//     node scripts/probe-doc-verification.js ENG-01 NAME-03     # several, in order
//     node scripts/probe-doc-verification.js --list             # what the test data holds
//     node scripts/probe-doc-verification.js --dry-run ENG-01   # build the form, post nothing
//
// It deliberately uses the same client the steps use rather than inlining its own
// requests. Two readers drift, and then the probe and the report disagree about what
// the API said - which is exactly the failure mode CLAUDE.md records for
// probe-receipt-pdf-contents.js.
//
// COST: a real upload per document named, on a real account. It does NOT delete
// anything afterwards, because the API exposes no DELETE for a document row (see
// doc-verification-reset.js). Default is FILE-01-PDF, the most benign fixture in the
// set. Nothing here makes a payment.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DocVerificationApi } = require('../utils/docVerificationApi');
const { resolveFixture, reconcileWithTestData } = require('../utils/docVerificationFixtures');
const { documentReport } = require('../utils/docVerificationEvidence');
const { DocVerificationError } = require('../utils/docVerificationErrors');

const TEST_DATA = path.resolve(__dirname, '..', 'test-data', 'document-verification', 'documents.json');
const DEFAULT_DOC = 'FILE-01-PDF';

function loadTestData() {
  const raw = JSON.parse(fs.readFileSync(TEST_DATA, 'utf8'));
  return raw;
}

function credentials() {
  const email = process.env.DOC_CANDIDATE_EMAIL || process.env.CANDIDATE_EMAIL;
  const password = process.env.DOC_CANDIDATE_PASSWORD || process.env.CANDIDTAE_PASSWORD;
  return { email, password };
}

(async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const wantList = argv.includes('--list');
  const ids = argv.filter((a) => !a.startsWith('--'));

  const data = loadTestData();
  const byId = new Map(data.documents.map((d) => [d.id, d]));

  if (wantList) {
    const recon = reconcileWithTestData(data.documents);
    console.log(`test data holds ${data.documents.length} documents\n`);
    for (const d of data.documents.slice().sort((a, b) => a.order - b.order)) {
      const pending = d.expected ? '' : '  [expected: PENDING]';
      console.log(`  ${String(d.order).padStart(3)}  ${d.id.padEnd(12)} ${d.category.padEnd(15)} ${d.file}${pending}`);
    }
    if (recon.missingFromDisk.length) {
      console.log(`\nNAMED IN TEST DATA BUT MISSING FROM DISK (${recon.missingFromDisk.length}):`);
      recon.missingFromDisk.forEach((f) => console.log('  ' + f));
    }
    if (recon.unusedOnDisk.length) {
      console.log(`\nON DISK BUT NO TEST DATA ENTRY (${recon.unusedOnDisk.length}):`);
      recon.unusedOnDisk.forEach((f) => console.log('  ' + f));
    }
    return;
  }

  const targets = (ids.length ? ids : [DEFAULT_DOC]).map((id) => {
    const doc = byId.get(id);
    if (!doc) {
      console.error(`Unknown document id "${id}". Run with --list to see what the test data holds.`);
      process.exit(1);
    }
    return doc;
  });

  const { email, password } = credentials();
  const api = new DocVerificationApi();

  console.log('=========================================================');
  console.log(' document verification probe');
  console.log('=========================================================');
  console.log(`base url    ${api.baseUrl}`);
  console.log(`candidate   ${email || '(not configured)'}`);
  console.log(`documents   ${targets.map((t) => t.id).join(', ')}${dryRun ? '   [DRY RUN]' : ''}`);
  console.log('');

  try {
    const me = await api.login(email, password, 'candidate');
    console.log(`logged in   id=${me.id}  ${me.declaredName}  role=${me.role}/${me.activeRole}`);
    console.log(`declared    "${me.declaredName}"  vs test data "${data.declared.legal_name}"`);
    if (me.declaredName !== data.declared.legal_name) {
      console.log('  WARNING: the declared name on the account does not match the test data.');
      console.log('  Every identity_name_match and cross_document_consistency expectation is');
      console.log('  meaningless until these agree. This is not an app defect.');
    }

    const ref = await api.referenceData();
    console.log(`reference   ${ref.institutions.length} institutions, ${ref.degrees.length} degrees, ${ref.fields.length} fields`);
    console.log('');

    for (const doc of targets.slice().sort((a, b) => a.order - b.order)) {
      console.log('---------------------------------------------------------');
      console.log(`${doc.id}  ${doc.file}`);
      console.log('---------------------------------------------------------');

      const fixture = resolveFixture(doc.file, doc.id);
      console.log(`fixture     ${fixture.bytes} bytes  ${fixture.contentType}`);

      // Show what will be posted before posting it. A form built from the wrong
      // reference row is the single most likely cause of a mystery 422, and reading it
      // here is cheaper than reading it out of a failure message.
      const form = await api.buildForm(doc, fixture);
      const posted = [];
      for (const [k, v] of form.entries()) {
        posted.push(`${k}=${typeof v === 'string' ? v : `<file ${v.name} ${v.size}B ${v.type}>`}`);
      }
      console.log(`form        ${posted.join('  ')}`);

      if (dryRun) {
        console.log('dry run, nothing posted.\n');
        continue;
      }

      const upload = await api.upload(doc, fixture);
      console.log(`upload      HTTP ${upload.httpStatus}  ${upload.accepted ? 'accepted' : 'REJECTED'}`);
      if (!upload.accepted) {
        console.log(`response    ${JSON.stringify(upload.responseBody)}`);
        console.log('');
        continue;
      }
      console.log(`ids         entry=${upload.entryId}  document=${upload.documentRowId}  stored as ${upload.uploadedFileName}`);

      let observed;
      try {
        const result = await api.waitForVerification(doc.category, upload.entryId);
        observed = {
          upload,
          verification: result.verification,
          document: result.document,
          elapsedMs: result.elapsedMs,
          polls: result.polls,
        };
      } catch (e) {
        if (e instanceof DocVerificationError) {
          console.log(`\n${e.toReport()}\n`);
          continue;
        }
        throw e;
      }

      console.log('');
      console.log(documentReport(doc, observed));
      console.log('');

      // The presigned-URL properties, which FILE-05 asserts and which are invisible in
      // the verdicts.
      const fileUrl = observed.document && observed.document.file;
      if (fileUrl) {
        const dl = await api.downloadDocumentFile(fileUrl);
        console.log(
          `file url    presigned=${dl.presigned}  expires=${dl.expiresInSeconds}s  ` +
            `algorithm=${dl.algorithm}  anonymous GET -> HTTP ${dl.httpStatus} (${dl.bytes} bytes)`
        );
      }
      console.log('');
    }
  } catch (e) {
    if (e instanceof DocVerificationError) {
      console.error('\n' + e.toReport());
      // exitCode rather than process.exit(): an abrupt exit while undici still holds
      // sockets trips a libuv assertion on Windows, which buries the actual message.
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  console.log('=========================================================');
  console.log(` ${api.requestLog().length} API calls made`);
  for (const r of api.requestLog()) {
    console.log(`  ${String(r.status).padEnd(4)} ${r.method.padEnd(6)} ${r.ms}ms  ${r.url.replace(api.baseUrl, '')}`);
  }
})();
