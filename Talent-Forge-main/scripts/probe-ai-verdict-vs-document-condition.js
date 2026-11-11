// probe-ai-verdict-vs-document-condition.js
//
// THE QUESTION THIS ANSWERS: is the AI's verdict actually about the document that was
// uploaded, or is it plausible-looking noise that happens to line up?
//
// It reads every document row already on the dedicated candidate's account, maps each one
// back to the fixture it came from, and cross-tabulates the CONDITION THE FIXTURE WAS BUILT
// TO CONTAIN (its `properties` block in the test data) against the VERDICT THE AI GAVE for
// the criterion that condition targets.
//
// READ-ONLY. It uploads nothing, decides nothing, and spends nothing. Everything it reports
// comes from GET /candidate/documents/all/, which carries `ai_verification` per row.
//
// WHY THIS IS NOT THE SAME AS THE SUITE'S OWN ASSERTIONS
// Every `expected` block in the test data is still null (the expected-results table never
// arrived), so the suite reports those as PENDING and cannot fail on a wrong verdict. This
// probe derives the expectation from the fixture's own recorded condition instead, which is
// independent of that missing table - so it can answer "is the AI right?" today.
//
// HOW TO READ THE OUTPUT
//   MATCH      the AI reached the verdict the document's condition calls for
//   MISMATCH   the AI disagreed with the condition - a candidate AI defect
//   SOFT       the AI said "uncertain" where the condition calls for pass/fail. Reported
//              separately because uncertainty is a legitimate answer on a degraded scan and
//              a cop-out on a clean one, and only the row's condition tells you which.
//   NO DATA    no verification on that row, or the criterion was not evaluated
//
// A MISMATCH IS NOT AUTOMATICALLY AN AI DEFECT, and the probe separates the two causes it
// can actually distinguish:
//
//   declared-data mismatch  the AI reports that the organisation ON the document differs
//                           from the one DECLARED on the form. That is the AI doing its job.
//                           It shows up here only because this account's history includes
//                           rows uploaded under earlier, different declared values - the
//                           test data's `declared` block is current, those rows are not.
//                           Counted apart, never as an AI defect.
//   recognition judgement   the AI reports the organisation is not recognised at all. THIS
//                           is the criterion under test.
//
// `--since YYYY-MM-DD` restricts to rows uploaded on or after a date, which is how to get a
// signal free of that stale history. `--verbose` also lists the uncertain answers.
//
// Usage: node scripts/probe-ai-verdict-vs-document-condition.js [--verbose] [--since 2026-08-24]

'use strict';

require('dotenv').config();

const { DocVerificationApi } = require('../utils/docVerificationApi');
const data = require('../test-data/document-verification/documents.json');

const VERBOSE = process.argv.includes('--verbose');
const sinceIdx = process.argv.indexOf('--since');
const SINCE = sinceIdx > -1 ? Date.parse(process.argv[sinceIdx + 1]) : null;

// The AI's own wording for "the document disagrees with what you declared", as opposed to
// "I do not recognise this organisation". Matched on the shape of the sentence rather than on
// one exact string, because the live phrasing varies across runs (7 variants observed for the
// same finding on 2026-08-25).
const DECLARED_MISMATCH = /does not match the declared|which does not match|, not [A-Z]|as declared/;

// ---------------------------------------------------------------------------
// The condition -> expected verdict map.
//
// This is the whole substance of the probe, so it is written out per value rather than
// inferred: an inferred rule ("anything that is not the baseline should fail") would quietly
// invent expectations for conditions nobody decided, which is the exact failure mode the
// PENDING expected-results table already represents.
//
// `null` means the condition genuinely does not constrain that criterion, and the row is
// skipped rather than counted as a pass.
// ---------------------------------------------------------------------------
const EXPECTED = {
  identity_name_match: {
    // The AC: "legal first and last name must match the applicant".
    exact: 'pass',
    missing_space: 'pass',          // "AbdulMusawwir" - a spacing variance, not a different person
    extra_spaces: 'pass',
    uppercase: 'pass',
    different_person: 'fail',
    first_differs: 'fail',
    last_differs: 'fail',
    // These two have no decided rule in the AC, so nothing is asserted about them here.
    reversed: null,
    missing_middle: null,
    unreadable: null,
  },
  date_validity: {
    valid_past: 'pass',
    open_ended: 'pass',             // "to Present" on a current work letter
    active_future_expiry: 'pass',   // legitimately current document
    expiry_today: 'pass',
    future_conferral: 'fail',
    future_end_date: 'fail',
    future_issue: 'fail',
    malformed: 'fail',
    expiry_before_issue: 'fail',
    unreadable: null,
  },
  issuing_organisation: {
    recognised: 'pass',
    unrecognised: 'fail',
    absent: 'fail',
    unreadable: null,
  },
  transcript_content: {
    complete: 'pass',
    not_a_transcript: null,         // criterion should not apply at all - checked separately
    missing_major: 'fail',
    missing_degree: 'fail',
    missing_date: 'fail',
    missing_multiple: 'fail',
    unreadable: null,
  },
  authenticity: {
    // Only the unambiguous ends are asserted. An ordinary scan with no seal is exactly the
    // case the AC leaves open ("valid digital certificate WHERE APPLICABLE"), and the live
    // AI answers "uncertain" on it - which is defensible, so it is not called a defect.
    tampered: 'fail',
    invalid_digital_cert: 'fail',
    ordinary_scan: null,
    no_digital_cert: null,
    faint_seal: null,
    blurry_legible: null,
    illegible: null,
  },
};

// properties key -> the criterion it targets
const DIMENSION = {
  name: 'identity_name_match',
  dates: 'date_validity',
  issuer: 'issuing_organisation',
  content: 'transcript_content',
  authenticity: 'authenticity',
};

// ---------------------------------------------------------------------------

// Uploaded files gain a random suffix (`NAME-03_transcript_different_name_BP9y3WO.pdf`), and
// the same fixture uploaded twice leaves two rows. Match a row to a fixture by the LONGEST
// fixture stem that the row's name starts with - longest, because
// `FILE-01_allowed_pdf` and `FILE-01_allowed_png` share a prefix, and so do
// `CONT-01_transcript_complete` and nothing else, but `NAME-01_transcript_exact_name`
// vs `NAME-01...` variants would collide on a shortest-first match.
function buildIndex(docs) {
  return docs
    .filter((d) => d.file)
    .map((d) => ({ doc: d, stem: d.file.replace(/\.[a-z0-9]+$/i, '') }))
    .sort((a, b) => b.stem.length - a.stem.length);
}

function matchFixture(index, fileName) {
  if (!fileName) return null;
  const stem = String(fileName).replace(/\.[a-z0-9]+$/i, '');
  const hit = index.find((e) => stem === e.stem || stem.startsWith(e.stem + '_'));
  return hit ? hit.doc : null;
}

(async () => {
  const api = new DocVerificationApi();
  const identity = await api.login(
    process.env.DOC_CANDIDATE_EMAIL,
    process.env.DOC_CANDIDATE_PASSWORD,
    'candidate'
  );

  const rows = await api.listDocuments();
  const index = buildIndex(data.documents);

  console.log('='.repeat(78));
  console.log(' AI verdict vs the condition each document was built to contain');
  console.log('='.repeat(78));
  console.log(`candidate      ${identity.email}  ("${identity.declaredName}")`);
  console.log(`document rows  ${rows.length}`);
  console.log(`declared name  "${data.declared.legal_name}"`);
  console.log('');

  const tally = { MATCH: 0, MISMATCH: 0, SOFT: 0, 'NO DATA': 0 };
  const mismatches = [];
  const declaredDataMismatches = [];
  const softs = [];
  const perDimension = {};
  let verified = 0;
  let unmatchedRows = 0;
  let outsideWindow = 0;
  const extractedNameAgreement = { agree: 0, disagree: 0, absent: 0 };

  for (const row of rows) {
    const fixture = matchFixture(index, row.file_name);
    if (!fixture) {
      unmatchedRows += 1;
      continue;
    }
    if (SINCE !== null) {
      const when = Date.parse(row.uploaded_on);
      if (!Number.isNaN(when) && when < SINCE) {
        outsideWindow += 1;
        continue;
      }
    }
    const v = row.ai_verification;
    if (!v || !Array.isArray(v.criteria)) continue;
    verified += 1;

    const byKey = new Map(v.criteria.map((c) => [c.key, c]));

    // Does the name the AI extracted match what the document is supposed to say? This is a
    // second, independent check on whether the AI read THIS document at all: a verdict can
    // be correct while the extraction is of some other file.
    const extracted = (v.extracted && v.extracted.legal_name) || null;
    if (!extracted) extractedNameAgreement.absent += 1;
    else {
      const isDeclared =
        extracted.replace(/\s+/g, ' ').trim().toLowerCase() ===
        data.declared.legal_name.toLowerCase();
      const shouldBeDeclared = ['exact', 'missing_space', 'extra_spaces', 'uppercase'].includes(
        fixture.properties.name
      );
      if (shouldBeDeclared === isDeclared) extractedNameAgreement.agree += 1;
      else extractedNameAgreement.disagree += 1;
    }

    for (const [propKey, criterionKey] of Object.entries(DIMENSION)) {
      const condition = fixture.properties && fixture.properties[propKey];
      if (condition === undefined) continue;
      const want = (EXPECTED[criterionKey] || {})[condition];
      if (!want) continue; // no decided expectation for this condition

      const c = byKey.get(criterionKey);
      const slot = (perDimension[criterionKey] = perDimension[criterionKey] || {
        MATCH: 0,
        MISMATCH: 0,
        SOFT: 0,
        'NO DATA': 0,
      });

      let verdictClass;
      if (!c) verdictClass = 'NO DATA';
      else if (c.verdict === want) verdictClass = 'MATCH';
      else if (c.verdict === 'uncertain') verdictClass = 'SOFT';
      else verdictClass = 'MISMATCH';

      const record = {
        fixture: fixture.id,
        row: row.id,
        file: row.file_name,
        uploadedOn: row.uploaded_on,
        criterion: criterionKey,
        condition: `${propKey}=${condition}`,
        want,
        got: c ? c.verdict : '(not evaluated)',
        detail: c ? c.detail : null,
      };

      // A "fail" that the AI explains as declared-vs-document disagreement is the AI working
      // correctly against a row whose declared data differed. Pulled out BEFORE the tally so
      // it cannot inflate the defect count - reporting it as an AI defect would be the exact
      // kind of misleading conclusion this probe exists to prevent.
      if (verdictClass === 'MISMATCH' && c && DECLARED_MISMATCH.test(String(c.detail || ''))) {
        declaredDataMismatches.push(record);
        continue;
      }

      tally[verdictClass] += 1;
      slot[verdictClass] += 1;
      if (verdictClass === 'MISMATCH') mismatches.push(record);
      if (verdictClass === 'SOFT') softs.push(record);
    }
  }

  console.log(`rows matched to a fixture and carrying a verification: ${verified}`);
  console.log(`rows whose file name matched no fixture (pre-existing/manual): ${unmatchedRows}`);
  if (SINCE !== null) console.log(`rows skipped as older than --since: ${outsideWindow}`);
  console.log('');
  console.log('OVERALL');
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  for (const [k, n] of Object.entries(tally)) {
    const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${k.padEnd(9)} ${String(n).padStart(4)}   ${pct}%`);
  }
  console.log(`  ${'TOTAL'.padEnd(9)} ${String(total).padStart(4)}   (condition/criterion pairs with a decided expectation)`);

  console.log('');
  console.log('PER CRITERION');
  console.log(`  ${'criterion'.padEnd(28)} ${'MATCH'.padStart(6)}${'MISMATCH'.padStart(10)}${'SOFT'.padStart(6)}${'NODATA'.padStart(8)}`);
  for (const [k, s] of Object.entries(perDimension)) {
    console.log(
      `  ${k.padEnd(28)} ${String(s.MATCH).padStart(6)}${String(s.MISMATCH).padStart(10)}${String(s.SOFT).padStart(6)}${String(s['NO DATA']).padStart(8)}`
    );
  }

  console.log('');
  console.log('DID THE AI READ THE RIGHT DOCUMENT? (extracted legal_name vs the fixture\'s intent)');
  console.log(`  agrees with the fixture's intent : ${extractedNameAgreement.agree}`);
  console.log(`  disagrees                        : ${extractedNameAgreement.disagree}`);
  console.log(`  no name extracted                : ${extractedNameAgreement.absent}`);

  if (declaredDataMismatches.length) {
    const byFixture = {};
    for (const r of declaredDataMismatches) byFixture[r.fixture] = (byFixture[r.fixture] || 0) + 1;
    console.log('');
    console.log('-'.repeat(78));
    console.log(` NOT AI DEFECTS: the AI correctly flagged declared-vs-document disagreement (${declaredDataMismatches.length})`);
    console.log('-'.repeat(78));
    console.log(' These rows were uploaded declaring one organisation while the PDF names another,');
    console.log(' so the AI is right and the row is unusable for testing the recognition rule.');
    console.log(' Excluded from the tally above. By fixture: ' + JSON.stringify(byFixture));
    if (VERBOSE) for (const r of declaredDataMismatches) console.log(`   ${r.fixture} row ${r.row}  ${r.detail}`);
  }

  if (mismatches.length) {
    console.log('');
    console.log('='.repeat(78));
    console.log(` MISMATCHES - the AI disagreed with the document's built-in condition (${mismatches.length})`);
    console.log('='.repeat(78));
    for (const m of mismatches) {
      console.log(`\n  ${m.fixture}  row ${m.row}  ${m.file}`);
      console.log(`    ${m.criterion}: condition ${m.condition} -> expected "${m.want}", got "${m.got}"`);
      if (m.detail) console.log(`    AI said: ${m.detail}`);
    }
  }

  if (VERBOSE && softs.length) {
    console.log('');
    console.log('='.repeat(78));
    console.log(` UNCERTAIN where the condition calls for a definite verdict (${softs.length})`);
    console.log('='.repeat(78));
    for (const m of softs) {
      console.log(`\n  ${m.fixture}  row ${m.row}  ${m.criterion}`);
      console.log(`    condition ${m.condition} -> expected "${m.want}", got "uncertain"`);
      if (m.detail) console.log(`    AI said: ${m.detail}`);
    }
  } else if (softs.length) {
    console.log('');
    console.log(`(${softs.length} "uncertain" answers where a definite verdict was expected - re-run with --verbose)`);
  }

  console.log('');
  console.log('NOTE: expectations here are derived from each fixture\'s recorded `properties`,');
  console.log('not from the requirement\'s expected-results table, which has never been supplied.');
  console.log('Conditions with no decided rule are SKIPPED rather than counted as passes.');
})().catch((e) => {
  console.error('\nPROBE FAILED');
  console.error(e && e.toReport ? e.toReport() : e);
  process.exit(1);
});
