// doc-verification-review-sheet.js - turns a measured run into a REVIEW SHEET for filling
// in the expected-results table.
//
//     node scripts/doc-verification-review-sheet.js
//     node scripts/doc-verification-review-sheet.js reports/doc-verification-baseline.json
//
// ============================================================================
// WHAT THIS DELIBERATELY DOES NOT DO
// ============================================================================
// It does NOT write the measured verdicts into `expected`. Requirement section 15 is
// explicit: "Do not simply automate the current behavior... Do not change the expected
// result just to make the automation pass." A generator that copied actuals into
// expectations would produce a suite that can never fail, and would quietly bless every
// defect the run just measured - including the four already on record.
//
// Instead it derives, from each fixture's OWN recorded `properties` (what the document
// was built to contain), what each criterion OUGHT to say - and prints that beside what
// the AI actually said. The output is a disagreement list.
//
//   AGREE      the AI reached the verdict the fixture was designed to provoke
//   DISAGREE   either a product defect or a fixture that does not contain its defect.
//              These are the rows a human has to judge; nothing else needs attention.
//   n/a        the fixture's properties imply nothing about that criterion
//
// The implied verdicts below are a reading of the AC, not of the app. They are the
// starting point for the conversation, not the answer to it.

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_REPORT = path.resolve(__dirname, '..', 'reports', 'document-verification-report.json');
const TEST_DATA = path.resolve(__dirname, '..', 'test-data', 'document-verification', 'documents.json');

// property value -> what the AC implies for that criterion.
// `null` means the properties say nothing about it.
const IMPLIED = {
  identity_name_match: {
    exact: 'pass',
    uppercase: 'pass', // capitalisation alone is not a different person
    extra_spaces: 'pass',
    missing_space: 'pass',
    missing_middle: 'pass', // commonest real-world legal-name variance
    reversed: null, // a product decision, not an obvious rule
    first_differs: 'fail',
    last_differs: 'fail',
    different_person: 'fail',
    unreadable: 'uncertain',
  },
  issuing_organisation: {
    recognised: 'pass',
    unrecognised: 'fail',
    absent: 'fail',
    unreadable: 'uncertain',
  },
  date_validity: {
    valid_past: 'pass',
    open_ended: 'pass',
    active_future_expiry: 'pass', // future expiry is legitimate on a current document
    expiry_today: 'pass', // the boundary is still valid
    future_conferral: 'fail',
    future_issue: 'fail',
    expiry_before_issue: 'fail',
    future_end_date: 'fail',
    malformed: 'fail',
    unreadable: 'uncertain',
  },
  transcript_content: {
    complete: 'pass',
    missing_degree: 'fail',
    missing_major: 'fail',
    missing_date: 'fail',
    missing_multiple: 'fail',
    not_a_transcript: null, // the criterion should not apply at all
    unreadable: 'uncertain',
  },
  authenticity: {
    ordinary_scan: null, // the AC only requires authenticity of e-transcripts
    faint_seal: null,
    blurry_legible: null,
    tampered: 'fail',
    no_digital_cert: 'fail',
    invalid_digital_cert: 'fail',
    illegible: 'uncertain',
  },
};

// Which property drives which criterion.
const DRIVEN_BY = {
  identity_name_match: 'name',
  issuing_organisation: 'issuer',
  date_validity: 'dates',
  transcript_content: 'content',
  authenticity: 'authenticity',
};

function impliedVerdict(criterion, props) {
  const prop = DRIVEN_BY[criterion];
  if (!prop) return null;
  const value = props[prop];
  if (value === undefined) return null;
  const table = IMPLIED[criterion] || {};
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null;
}

(async () => {
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_REPORT;
  if (!fs.existsSync(reportPath)) {
    console.error(`No run report at ${reportPath}\nRun: npm run test:doc-verify -- --allow-pending`);
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const data = JSON.parse(fs.readFileSync(TEST_DATA, 'utf8'));
  const props = new Map(data.documents.map((d) => [d.id, d.properties || {}]));

  const rows = [];
  const agreements = [];
  let criteriaCompared = 0;

  for (const doc of report.documents.slice().sort((a, b) => a.order - b.order)) {
    const p = props.get(doc.id) || {};
    const observed = new Map((doc.observed.criteria || []).map((c) => [c.key, c]));

    if (!doc.observed.uploadAccepted) {
      rows.push({
        id: doc.id,
        criterion: '(upload)',
        implied: p.file && /disallowed|oversized/.test(p.file) ? 'rejected' : 'accepted',
        measured: `rejected HTTP ${doc.observed.httpStatus}`,
        verdict: p.file && /disallowed|oversized/.test(p.file) ? 'AGREE' : 'DISAGREE',
        detail: JSON.stringify(doc.observed.uploadResponse || {}).slice(0, 90),
      });
      continue;
    }

    for (const criterion of Object.keys(DRIVEN_BY)) {
      const implied = impliedVerdict(criterion, p);
      const got = observed.get(criterion);

      // transcript_content on a non-transcript: the criterion should not have run.
      if (criterion === 'transcript_content' && p.content === 'not_a_transcript') {
        if (got) {
          rows.push({
            id: doc.id,
            criterion,
            implied: 'not applied',
            measured: got.verdict,
            verdict: 'DISAGREE',
            detail: got.detail,
          });
        }
        continue;
      }

      if (implied === null) continue;
      if (!got) {
        rows.push({ id: doc.id, criterion, implied, measured: '(not evaluated)', verdict: 'DISAGREE', detail: '' });
        continue;
      }
      criteriaCompared += 1;
      if (got.verdict === implied) {
        agreements.push(`${doc.id} ${criterion}=${implied}`);
      } else {
        rows.push({ id: doc.id, criterion, implied, measured: got.verdict, verdict: 'DISAGREE', detail: got.detail });
      }
    }
  }

  const disagreements = rows.filter((r) => r.verdict === 'DISAGREE');

  const L = [];
  L.push('# Document verification - review sheet');
  L.push('');
  L.push(`Generated from \`${path.relative(process.cwd(), reportPath)}\` (run of ${report.meta.startedAt}).`);
  L.push('');
  L.push('**This is not a set of expected results.** It compares what each fixture was BUILT to');
  L.push('contain against what the AI actually said, so the disagreements below are the only rows');
  L.push('that need a human decision. Each one is either a product defect or a fixture that does not');
  L.push('contain the defect its name claims.');
  L.push('');
  L.push('| Metric | Count |');
  L.push('|--------|-------|');
  L.push(`| Documents driven | ${report.documents.length} |`);
  L.push(`| Criteria compared | ${criteriaCompared} |`);
  L.push(`| **Agreements** | **${agreements.length}** |`);
  L.push(`| **Disagreements needing a decision** | **${disagreements.length}** |`);
  L.push('');
  L.push('> `cross_document_consistency` is deliberately absent from this sheet. On a shared account');
  L.push('> its pass direction is not reliable - see `_note_cross_document` in the test data.');
  L.push('');

  if (disagreements.length) {
    L.push('## Disagreements - decide each of these');
    L.push('');
    L.push('| Document | Criterion | The fixture implies | The AI said | AI reason |');
    L.push('|----------|-----------|---------------------|-------------|-----------|');
    for (const r of disagreements) {
      L.push(
        `| \`${r.id}\` | ${r.criterion} | **${r.implied}** | **${r.measured}** | ${String(r.detail || '').replace(/\|/g, '/').slice(0, 120)} |`
      );
    }
    L.push('');
  }

  L.push('## Agreements');
  L.push('');
  L.push('These need no decision - the AI reached the verdict the fixture was designed to provoke.');
  L.push('');
  L.push('```');
  for (const a of agreements) L.push('  ' + a);
  L.push('```');

  const out = path.resolve(__dirname, '..', 'reports', 'doc-verification-review-sheet.md');
  fs.writeFileSync(out, L.join('\n'));

  console.log(`${report.documents.length} documents, ${criteriaCompared} criteria compared`);
  console.log(`  ${agreements.length} agree`);
  console.log(`  ${disagreements.length} DISAGREE - each needs a decision`);
  console.log('');
  for (const r of disagreements) {
    console.log(`  ${r.id.padEnd(13)} ${r.criterion.padEnd(22)} fixture implies ${String(r.implied).padEnd(12)} AI said ${r.measured}`);
  }
  console.log('');
  console.log(`written: ${path.relative(process.cwd(), out)}`);
})();
