// probe-doc-status-rule.js - WHICH AI CRITERION DECIDES A DOCUMENT'S STATUS.
//
// READ-ONLY. Uploads nothing, decides nothing, spends nothing.
//
// Nothing in the requirement says what makes the AI approve a document, reject it, or
// leave it for an agent - and every status assertion in status-lifecycle.feature depends
// on knowing. So this measures it: every verified document row on the account, cross
// tabulated as "which criteria came back non-pass" against "what status the document
// ended up with".
//
// >>> WHY A CROSS-TABULATION AND NOT A SPOT CHECK. <<<
// The first version of the AWAITING premise in the step file was derived from a spot
// check - 8 of 8 DATE-05 rows sat at AWAITING, so an ordinary scan was assumed to leave
// the document undecided. Run live, the AI passed authenticity on that same fixture, the
// document was all-pass, and it auto-APPROVED. The scenario then failed on its own
// premise, which reads as a product defect and is not one. A cross-tabulation would have
// shown immediately that those 8 rows were AWAITING because of a DIFFERENT criterion.
//
// Measured 2026-09-01 over 33 verified rows, without exception:
//
//     all six criteria pass          -> APPROVED   (1 of 1)
//     date_validity: fail            -> REVISION   (3 of 3)
//     any OTHER criterion non-pass   -> AWAITING   (30 of 30)
//
// date_validity is the discriminator: present in every REVISION row, absent from every
// AWAITING one. identity_name_match: fail, issuing_organisation: fail, authenticity:
// uncertain and cross_document_consistency: fail all leave the document for an agent.
//
// Re-run this after any change to the model or its prompt. The rule is empirical, so it
// is exactly the kind of thing that goes stale without anybody noticing.
'use strict';

require('dotenv').config();
const { DocVerificationApi } = require('../utils/docVerificationApi');

(async () => {
  const api = new DocVerificationApi();
  await api.login(process.env.DOC_CANDIDATE_EMAIL, process.env.DOC_CANDIDATE_PASSWORD, 'candidate');

  const all = await api.listDocuments({ pageSize: 200 });
  const rows = Array.isArray(all) ? all : Object.values(all).filter((r) => r && r.id);

  const byStatus = {};
  let unverified = 0;
  for (const r of rows) {
    const v = r.ai_verification;
    if (!v || !v.criteria) {
      unverified += 1;
      continue;
    }
    // The KEY as well as the verdict. Verdicts alone are positional, and the criteria
    // list is not the same length or order on every document - an earlier read of
    // verdicts-only attributed a failure to the wrong criterion entirely.
    const bad =
      v.criteria
        .filter((c) => c.verdict !== 'pass')
        .map((c) => `${c.key}:${c.verdict}`)
        .sort()
        .join(' + ') || '(all pass)';
    const bucket = byStatus[r.status] || (byStatus[r.status] = {});
    bucket[bad] = (bucket[bad] || 0) + 1;
  }

  console.log(`${rows.length} document row(s), ${unverified} with no AI verification yet\n`);
  for (const status of Object.keys(byStatus).sort()) {
    console.log(`### ${status}`);
    for (const [pattern, n] of Object.entries(byStatus[status]).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}x  ${pattern}`);
    }
    console.log('');
  }

  // The discriminator, derived rather than asserted, so a changed rule is reported as a
  // changed rule instead of failing an expectation nobody agreed to.
  //
  // Compared as key:VERDICT pairs, never as bare keys. `date_validity` appears in both
  // buckets - as `uncertain` in AWAITING rows and as `fail` in REVISION ones - so a
  // key-only comparison finds no discriminator at all and reports that the rule has
  // broken down, on data that shows a perfectly clean rule. Same class of mistake as
  // reading verdicts positionally.
  const pairsIn = (status) =>
    new Set(
      Object.keys(byStatus[status] || {})
        .flatMap((p) => p.split(' + '))
        .filter((t) => t !== '(all pass)')
    );
  const revision = pairsIn('REVISION');
  const awaiting = pairsIn('AWAITING');
  const only = [...revision].filter((k) => !awaiting.has(k));
  console.log(
    only.length
      ? `DISCRIMINATOR: ${only.join(', ')} appears in REVISION rows and in no AWAITING row.`
      : 'NO DISCRIMINATOR: every criterion failing in a REVISION row also fails in an ' +
          'AWAITING row, so status is not predictable from the criteria alone any more. ' +
          'The premises in status-lifecycle.feature need re-deriving.'
  );
})().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
