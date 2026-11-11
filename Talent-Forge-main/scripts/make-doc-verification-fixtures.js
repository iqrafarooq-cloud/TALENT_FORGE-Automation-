// make-doc-verification-fixtures.js - builds every generated document-verification
// fixture and verifies its own output.
//
//     node scripts/make-doc-verification-fixtures.js            # all of them
//     node scripts/make-doc-verification-fixtures.js AUTH-02    # one or several
//     node scripts/make-doc-verification-fixtures.js --list
//
// Not a probe and not part of a test run. Run it when a fixture is lost, when the
// AUTH-02 tampering needs to be more or less obvious, or when DATE-08 has gone stale
// (see below).
//
// ============================================================================
// WHY THESE FILES ARE GENERATED RATHER THAN HAND-MADE
// ============================================================================
// The hand-made set in Files/Test_doc covers the defects somebody thought of while
// making them, and two of those files did not contain the defect their name claimed.
// Everything here is generated from a template with one property varied, so the
// difference between a fixture and its control is exactly the thing under test and
// nothing else. `docFixtureTemplates.js` holds the templates and the PDF writer.
//
// Each fixture records WHY it exists, because "NAME-09 is uppercase" is obvious from
// the name but "and NAME-01 is the control it must be compared against" is not.
//
// ============================================================================
// DATE-08 IS TIME-SENSITIVE AND WILL GO STALE
// ============================================================================
// Its whole point is an expiry date equal to TODAY, so a file built on one day is
// wrong on every other day. It is stamped with its build date and the fixture registry
// records that date, so a run on a later day fails with "this fixture was built for
// 2026-08-24 and today is 2026-09-02, rebuild it" rather than silently testing
// "expiry in the recent past". Rebuild with:
//     node scripts/make-doc-verification-fixtures.js DATE-08

'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./lib/docFixtureTemplates');

const OUT_DIR = path.resolve(__dirname, '..', 'Files', 'Test_doc');
const STAMP_FILE = path.join(OUT_DIR, '.generated-fixtures.json');

// The declared legal name on the document-verification candidate. Every name variant
// below is derived from it, so the set stays correct if the account ever changes.
const DECLARED = 'Abdul Musawwir Siddiqui';
const [FIRST, MIDDLE, LAST] = DECLARED.split(' ');

// The name AUTH-02's forger supposedly painted over. Left partly visible under the patch.
const ORIGINAL_NAME = 'Faisal Al-Harbi';

const iso = (d) => d.toISOString().slice(0, 10);
const pretty = (d) => `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'long' })} ${d.getFullYear()}`;
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

// ---------------------------------------------------------------------------
// AUTH-02 - a transcript with tampering a reviewer would catch at a glance
// ---------------------------------------------------------------------------
// The original contained NO visible tampering: its only anomaly was a truncated word
// "Revis" on an otherwise cleanly rendered PDF, so the recorded "expected fail, got
// uncertain" discrepancy was a FIXTURE defect being reported as an AI defect - the same
// class of mistake as the exact-10 MB PNG in CLAUDE.md.
//
// Every signal below is VISUAL, because the criterion under test is about tamper-proof
// features, which is a visual property. A textual marker would only test the extractor.
function authTampered() {
  const c = new T.Content();
  let y = T.PAGE_H - 90;

  c.text(70, y, T.DEFAULT_INSTITUTION, { font: 'F2', size: 16 });
  y -= 34;
  c.text(70, y, 'OFFICIAL ACADEMIC TRANSCRIPT', { font: 'F2', size: 13 });
  y -= 46;

  // 1. A white-out patch over the original name, deliberately misaligned so the
  //    descenders and the last glyphs of what it covers still show.
  const nameY = y;
  c.text(70, nameY, `Student Name: ${ORIGINAL_NAME}`, { font: 'F1', size: 11 });
  c.rect(148, nameY - 2, 168, 17, { rgb: [1, 1, 1] });
  c.line(148, nameY - 2, 316, nameY - 2, { width: 0.4, rgb: [0.8, 0.8, 0.8] });
  c.line(148, nameY + 15, 316, nameY + 15, { width: 0.4, rgb: [0.8, 0.8, 0.8] });
  // 2. The replacement in a different typeface, a point larger, off the baseline.
  c.text(151, nameY + 2, DECLARED, { font: 'F4', size: 12 });
  y -= 30;

  c.text(70, y, 'Degree: Bachelor of Science in Computer Science', { font: 'F1', size: 11 });
  y -= 24;
  // 3. A third typeface, matching nothing else on the page.
  c.text(70, y, 'Major / Field: Software Engineering', { font: 'F5', size: 11 });
  y -= 24;
  c.text(70, y, 'Date of Conferral: 15 June 2022', { font: 'F1', size: 11 });
  y -= 24;
  c.text(70, y, 'Issue Date: 20 June 2022', { font: 'F1', size: 11 });

  // 4. A splice seam: a hairline, a tonal band beneath it, and the block shifted right.
  //    The band is what makes it read as a splice rather than as an indent.
  const seamY = y - 34;
  c.rect(60, seamY - 74, T.PAGE_W - 120, 74, { rgb: [0.965, 0.965, 0.955] });
  c.line(60, seamY, T.PAGE_W - 60, seamY, { width: 1.1, rgb: [0.4, 0.4, 0.4] });
  c.line(60, seamY - 74, T.PAGE_W - 60, seamY - 74, { width: 0.5, rgb: [0.72, 0.72, 0.72] });
  c.text(79, seamY - 26, 'This document certifies that the above-named student has completed the', { size: 10 });
  c.text(79, seamY - 40, 'prescribed course of study and has been awarded the stated degree with', { size: 10 });
  c.text(79, seamY - 54, 'all the rights and privileges pertaining thereto.', { size: 10 });

  // 5. A stamp, overlapping the body text the way a real one lands.
  c.strokeRect(232, seamY - 66, 196, 54);
  c.rotatedText(248, seamY - 52, 'REVISED COPY', { font: 'F2', size: 22, deg: 8 });

  c.text(70, seamY - 118, 'No institutional seal. No digital certificate attached.', { font: 'F3', size: 10, gray: 0.35 });
  c.text(70, 60, '-- 1 of 1 --', { size: 9, gray: 0.4 });
  return T.buildPdf(c);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
// `why` is the reason the fixture exists and what it must be compared against.
// `mustContain` is checked by reading the built file back through pdf-parse, so a
// fixture that writes but does not extract fails here rather than three scenarios later.
const TARGETS = {
  'AUTH-02': {
    file: 'AUTH-02_transcript_visible_tampering.pdf',
    why: 'Visible tampering. Control: CONT-01, the same transcript untouched.',
    build: authTampered,
    mustContain: [T.DEFAULT_INSTITUTION, DECLARED, 'REVISED COPY'],
  },
  'AUTH-06': {
    file: 'AUTH-06_e_transcript_invalid_digital_cert.pdf',
    why:
      'A digital certificate that FAILS validation. Distinct from AUTH-03, which has no ' +
      'certificate at all - the AC requires a VALID one, so "absent" and "invalid" are ' +
      'different states.',
    build: () => T.eTranscriptInvalidCertificate({ name: DECLARED }),
    mustContain: ['DIGITAL SIGNATURE VALIDATION: INVALID', DECLARED],
  },
  'CONT-05': {
    file: 'CONT-05_transcript_missing_degree.pdf',
    why: 'Major and conferral date present, DEGREE absent. Control: CONT-01.',
    build: () => T.transcript({ name: DECLARED, degree: null }),
    mustContain: ['Major / Field', 'Date of Conferral', DECLARED],
    mustNotContain: ['Degree:'],
  },
  'CONT-06': {
    file: 'CONT-06_transcript_missing_graduation_date.pdf',
    why: 'Degree and major present, CONFERRAL DATE absent. Control: CONT-01.',
    build: () => T.transcript({ name: DECLARED, conferral: null }),
    mustContain: ['Degree:', 'Major / Field', DECLARED],
    mustNotContain: ['Date of Conferral'],
  },
  // The multi-document scenarios need ONE document naming somebody else while the
  // others name the candidate, and the flagged one has to be a WORK LETTER - otherwise
  // "only the document naming a different person is flagged" is satisfied trivially by
  // the transcript that is flagged for its content anyway. No such letter existed: the
  // step that needed it used to fail with "there is no work letter naming a different
  // person in the fixture set". This is that letter, and nothing else about it differs
  // from ENG-07 - same company, same designation, same open-ended dates - so the name is
  // the only variable between the two.
  'NAME-13': {
    file: 'NAME-13_work_letter_different_name.pdf',
    why:
      'A clean work experience letter naming somebody else. The only work-letter fixture ' +
      'with a name defect, and the flagged member of the multi-document set. Control: ENG-07.',
    build: () =>
      T.workLetter({
        name: 'Jonathan Michael Doe',
        designation: 'Senior Software Engineer',
        from: '1 July 2022',
        ongoing: true,
      }),
    mustContain: [T.DEFAULT_COMPANY, 'Jonathan Michael Doe', 'Present'],
    mustNotContain: [DECLARED],
  },
  'DATE-06': {
    file: 'DATE-06_work_letter_open_ended.pdf',
    why:
      'Genuinely open-ended employment, so the AC clause "not in the future unless the ' +
      'document is current/active" has a positive case. DATE-02 is the negative half: its ' +
      'filename says open-ended but the letter states a future END date.',
    build: () =>
      T.workLetter({ name: DECLARED, designation: 'Senior Software Engineer', from: '1 July 2022', ongoing: true }),
    mustContain: [T.DEFAULT_COMPANY, DECLARED, 'Present'],
  },
  'DATE-07': {
    file: 'DATE-07_certificate_active_future_expiry.pdf',
    why:
      'A CURRENT certificate whose expiry is legitimately in the future. The AC forbids ' +
      'future dates only when the document is not current, so a flag here is a false ' +
      'positive. Control: DATE-05 (both dates past).',
    build: () =>
      T.certificate({
        name: DECLARED,
        title: 'ISO 27001 Lead Implementer',
        issue: pretty(shift(-400)),
        expiry: pretty(shift(400)),
        extraLines: ['This certification is currently active and in good standing.'],
      }),
    mustContain: [DECLARED, 'Expiry Date', 'currently active'],
  },
  'DATE-08': {
    file: 'DATE-08_certificate_expiry_today.pdf',
    why:
      'Expiry exactly equal to TODAY - the boundary between active and expired. ' +
      'TIME-SENSITIVE: correct only on the day it is built, and the fixture registry ' +
      'records that date so a later run fails loudly instead of testing a past expiry.',
    timeSensitive: true,
    build: () =>
      T.certificate({
        name: DECLARED,
        title: 'Certified Information Systems Auditor',
        issue: pretty(shift(-730)),
        expiry: pretty(new Date()),
        extraLines: ['This certification expires at the end of the stated expiry date.'],
      }),
    mustContain: [DECLARED, 'Expiry Date'],
  },
  'FILE-06': {
    file: 'FILE-06_blank_document.pdf',
    why:
      'A structurally valid PDF containing nothing. Not a zero-byte file: the parser must ' +
      'open it and the model must render it, and find no content to verify.',
    build: T.blankDocument,
    mustContain: [],
    allowEmptyText: true,
  },
  'NAME-07': {
    file: 'NAME-07_transcript_first_name_differs.pdf',
    why: `Only the FIRST name differs (Ahmed vs ${FIRST}). Middle and last match. Control: NAME-01.`,
    build: () => T.transcript({ name: `Ahmed ${MIDDLE} ${LAST}` }),
    mustContain: [`Ahmed ${MIDDLE} ${LAST}`],
  },
  'NAME-08': {
    file: 'NAME-08_transcript_last_name_differs.pdf',
    why: `Only the LAST name differs (Rahman vs ${LAST}). First and middle match. Control: NAME-01.`,
    build: () => T.transcript({ name: `${FIRST} ${MIDDLE} Rahman` }),
    mustContain: [`${FIRST} ${MIDDLE} Rahman`],
  },
  'NAME-09': {
    file: 'NAME-09_transcript_uppercase_name.pdf',
    why:
      'The same person in upper case. Capitalisation alone must not flag a document, so a ' +
      'fail here is a false positive. Control: NAME-01.',
    build: () => T.transcript({ name: DECLARED.toUpperCase() }),
    mustContain: [DECLARED.toUpperCase()],
  },
  'NAME-10': {
    file: 'NAME-10_transcript_extra_spaces.pdf',
    why:
      'The same person with EXTRA spaces between the parts. NAME-02 is the opposite case ' +
      '(a space removed), and the two together bound whitespace tolerance from both sides.',
    build: () => T.transcript({ name: `${FIRST}  ${MIDDLE}   ${LAST}` }),
    mustContain: [FIRST, MIDDLE, LAST],
  },
  'NAME-11': {
    file: 'NAME-11_transcript_reversed_order.pdf',
    why:
      'Surname first. Whether this should match is a PRODUCT decision, not an obvious ' +
      'defect - the scenario asserts that the configured rule is applied consistently ' +
      'rather than asserting a verdict.',
    build: () => T.transcript({ name: `${LAST} ${FIRST} ${MIDDLE}` }),
    mustContain: [`${LAST} ${FIRST} ${MIDDLE}`],
  },
  'NAME-12': {
    file: 'NAME-12_transcript_missing_middle_name.pdf',
    why:
      `The middle name (${MIDDLE}) dropped, which is the commonest real-world legal-name ` +
      'variance. Derivable only because the declared name has three parts. Control: NAME-01.',
    build: () => T.transcript({ name: `${FIRST} ${LAST}` }),
    mustContain: [`${FIRST} ${LAST}`],
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function verify(target) {
  const { PDFParse } = require('pdf-parse');
  const parsed = await new PDFParse({ data: fs.readFileSync(path.join(OUT_DIR, target.file)) }).getText();
  const text = (parsed.text || '').replace(/\s+/g, ' ');
  const missing = (target.mustContain || []).filter((s) => !text.includes(s.replace(/\s+/g, ' ')));
  const present = (target.mustNotContain || []).filter((s) => text.includes(s));
  const emptyProblem = !target.allowEmptyText && text.trim().length < 20 ? ['(no text extracted)'] : [];
  return {
    ok: missing.length === 0 && present.length === 0 && emptyProblem.length === 0,
    missing: [...missing, ...emptyProblem],
    unexpected: present,
    chars: text.length,
  };
}

function readStamps() {
  try {
    return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
  } catch {
    return {};
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const [id, t] of Object.entries(TARGETS)) {
      console.log(`${id.padEnd(9)} ${t.file}${t.timeSensitive ? '   [TIME-SENSITIVE]' : ''}`);
      console.log(`          ${t.why}\n`);
    }
    return;
  }

  const wanted = args.map((a) => a.toUpperCase());
  const ids = wanted.length ? wanted : Object.keys(TARGETS);
  const unknown = ids.filter((id) => !TARGETS[id]);
  if (unknown.length) {
    console.error(`Unknown fixture id(s): ${unknown.join(', ')}\nKnown: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`Fixture directory does not exist: ${OUT_DIR}`);
    process.exit(1);
  }

  const stamps = readStamps();
  let failed = false;

  for (const id of ids) {
    const t = TARGETS[id];
    const full = path.join(OUT_DIR, t.file);
    const existed = fs.existsSync(full);
    const before = existed ? fs.statSync(full).size : 0;

    // Keep ONE backup of a hand-made file being replaced. A second run must not
    // overwrite the backup with the already-generated file - that would destroy the only
    // copy of the original.
    if (existed) {
      const backup = `${full}.original`;
      if (!fs.existsSync(backup) && !stamps[id]) {
        fs.copyFileSync(full, backup);
        console.log(`  kept the previous file as ${path.basename(backup)} (${before} bytes)`);
      }
    }

    fs.writeFileSync(full, t.build());
    const after = fs.statSync(full).size;
    const v = await verify(t);
    stamps[id] = { file: t.file, builtOn: iso(new Date()), timeSensitive: Boolean(t.timeSensitive) };

    console.log(
      `${v.ok ? 'OK  ' : 'FAIL'} ${id.padEnd(9)} ${t.file.padEnd(48)} ${before ? `${before} -> ` : ''}${after}B  ${v.chars} chars` +
        (v.ok ? '' : `\n     MISSING: ${v.missing.join(' | ')}${v.unexpected.length ? `  UNEXPECTED: ${v.unexpected.join(' | ')}` : ''}`)
    );
    if (!v.ok) failed = true;
  }

  fs.writeFileSync(STAMP_FILE, JSON.stringify(stamps, null, 2));

  if (failed) {
    console.error('\nAt least one fixture did not read back correctly. Do not use it.');
    process.exit(1);
  }
  console.log(`\n${ids.length} fixture(s) built and verified. Build dates recorded in ${path.basename(STAMP_FILE)}.`);
})();
