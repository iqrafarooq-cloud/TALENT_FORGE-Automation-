// doc-verification-reset.js - clears what CAN be cleared from the document-verification
// candidate, and reports honestly on what cannot.
//
//     node scripts/doc-verification-reset.js              # report only, changes nothing
//     node scripts/doc-verification-reset.js --delete     # actually delete the entries
//
// ============================================================================
// READ THIS BEFORE TRUSTING THE WORD "RESET"
// ============================================================================
// The API exposes DELETE for a profile ENTRY (an education, a work experience, a
// certification) and exposes NO DELETE for a DOCUMENT row anywhere. Deleting an entry
// leaves its document row behind, orphaned.
//
// Measured on the candidate on 2026-08-24: 4 profile entries, 77 document rows. So 73
// were already orphaned by earlier runs before this script existed.
//
// The consequence is not cosmetic. `cross_document_consistency` is evaluated against
// previously submitted documents, and the history contains a "John Doe" transcript
// from an earlier run - so a brand-new, perfectly clean document uploaded today comes
// back with cross_document_consistency = fail, citing a document nothing can remove.
// Verified live: FILE-01_allowed_pdf.pdf, uploaded clean at 10:13 on 2026-08-24, was
// failed against "Name 'Abdul Musawwir Siddiqui' does not match 'John Doe' on another
// submitted document".
//
// So this script does NOT deliver a clean cross-document baseline and does not pretend
// to. It reports the gap in numbers so nobody builds an expectation on an isolation
// that does not exist. Getting a genuinely clean baseline needs either a DELETE for
// document rows (a backend change) or a fresh candidate per run whose declared legal
// name is set to match the fixtures.

'use strict';

require('dotenv').config();

const { DocVerificationApi, CATEGORY } = require('../utils/docVerificationApi');
const { DocVerificationError } = require('../utils/docVerificationErrors');

const CATEGORIES = [CATEGORY.EDUCATION, CATEGORY.WORKEXPERIENCE, CATEGORY.CERTIFICATION];

// Any document naming somebody other than the declared applicant is what makes
// cross_document_consistency unpassable, so those rows are called out by name.
//
// Whitespace and case are normalised away before comparing, and that is not
// cosmetic: NAME-02 is the deliberate spacing-variance fixture and the AI extracts it
// verbatim as "AbdulMusawwir Siddiqui". A raw string comparison reports it as a
// different person, which would send whoever reads this output after a conflict that
// is not one. Punctuation is deliberately NOT normalised - "Jon Smith-Doe" really is
// somebody else.
const normaliseName = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

function conflictingNames(documents, declaredName) {
  const want = normaliseName(declaredName);
  const out = [];
  for (const d of documents) {
    const extracted = d.ai_verification && d.ai_verification.extracted;
    const name = extracted && extracted.legal_name;
    if (!name || !String(name).trim()) continue;
    if (normaliseName(name) === want) continue;
    out.push({ id: d.id, file: d.file_name, name: String(name).trim(), category: d.category });
  }
  return out;
}

(async () => {
  const doDelete = process.argv.includes('--delete');
  const api = new DocVerificationApi();

  const email = process.env.DOC_CANDIDATE_EMAIL || process.env.CANDIDATE_EMAIL;
  const password = process.env.DOC_CANDIDATE_PASSWORD || process.env.CANDIDTAE_PASSWORD;

  try {
    const me = await api.login(email, password, 'candidate');
    console.log('=========================================================');
    console.log(' document verification reset');
    console.log('=========================================================');
    console.log(`candidate   ${me.email}  (id ${me.id})`);
    console.log(`declared    "${me.declaredName}"`);
    console.log(`mode        ${doDelete ? 'DELETE profile entries' : 'REPORT ONLY (pass --delete to act)'}`);
    console.log('');

    // ---- what exists -------------------------------------------------------
    const entries = {};
    let entryTotal = 0;
    for (const category of CATEGORIES) {
      entries[category] = await api.listEntries(category);
      entryTotal += entries[category].length;
    }
    const documents = await api.listDocuments();

    console.log('BEFORE');
    for (const category of CATEGORIES) {
      console.log(`  ${category.padEnd(15)} ${String(entries[category].length).padStart(4)} profile entries`);
    }
    console.log(`  ${'documents'.padEnd(15)} ${String(documents.length).padStart(4)} document rows`);
    const orphaned = documents.length - entryTotal;
    console.log('');
    console.log(`  ${entryTotal} entries vs ${documents.length} document rows -> ${orphaned} ORPHANED`);
    console.log('  An orphaned document row has no entry to delete and no DELETE of its own.');
    console.log('');

    // ---- what makes cross-document consistency unpassable -------------------
    const conflicts = conflictingNames(documents, me.declaredName);
    if (conflicts.length) {
      console.log(`DOCUMENTS NAMING SOMEBODY ELSE (${conflicts.length}) - these are why`);
      console.log('cross_document_consistency fails on clean uploads:');
      for (const c of conflicts) {
        console.log(`  doc ${String(c.id).padStart(6)}  ${c.name.padEnd(24)} ${c.file}`);
      }
      const linkedIds = new Set(
        CATEGORIES.flatMap((c) => entries[c].map((e) => e.document && e.document.id).filter(Boolean))
      );
      const removable = conflicts.filter((c) => linkedIds.has(c.id));
      console.log('');
      console.log(`  ${removable.length} of ${conflicts.length} are reachable through a profile entry.`);
      console.log(`  ${conflicts.length - removable.length} are orphaned and CANNOT be removed through this API.`);
    } else {
      console.log('No document on the account names anybody other than the declared applicant.');
      console.log('(Note: only documents that carry an AI extraction can be checked this way.)');
    }
    console.log('');

    if (!doDelete) {
      console.log('Report only. Nothing was changed. Pass --delete to remove the profile entries.');
      return;
    }

    // ---- delete ------------------------------------------------------------
    let deleted = 0;
    let refused = 0;
    for (const category of CATEGORIES) {
      for (const e of entries[category]) {
        const res = await api.deleteEntry(category, e.id);
        const docId = (e.document && e.document.id) || '-';
        if (res.ok) {
          deleted += 1;
          console.log(`  deleted  ${category.padEnd(15)} entry ${e.id}  (document ${docId} is now orphaned, not removed)`);
        } else {
          refused += 1;
          console.log(`  REFUSED  ${category.padEnd(15)} entry ${e.id}  HTTP ${res.httpStatus}`);
        }
      }
    }

    const after = await api.listDocuments();
    console.log('');
    console.log('AFTER');
    console.log(`  ${deleted} entries deleted, ${refused} refused`);
    console.log(`  ${after.length} document rows remain (was ${documents.length})`);
    if (after.length === documents.length) {
      console.log('');
      console.log('  Document row count did NOT change, which is the documented behaviour:');
      console.log('  deleting an entry does not delete its document. Cross-document history');
      console.log('  is intact and cross_document_consistency expectations remain affected.');
    }
  } catch (e) {
    if (e instanceof DocVerificationError) {
      console.error('\n' + e.toReport());
      process.exitCode = 1;
      return;
    }
    throw e;
  }
})();
