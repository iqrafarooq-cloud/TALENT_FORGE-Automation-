const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// ==============================================================================================
// bulkCandidateFile - the candidate-upload fixtures for the Agent Portal's BULK invite path
// (features/Agent_Portal/invite-candidate-bulk_upload.feature).
//
// Every file is BUILT PER RUN into a temp directory, never committed. Three reasons, and the
// third is the one that matters:
//
//   1. Sizes. The 10MB boundary scenario needs a file of EXACTLY 10,485,760 bytes and neighbours
//      at 10.1MB and 11MB. Committing 31MB of padding to assert a client-side length check would
//      be absurd - and the exact-10MB PNG lesson recorded in CLAUDE.md is that a boundary fixture
//      which is not actually AT the boundary proves nothing, so writeSized() verifies its own
//      output byte count and throws rather than returning a near miss.
//   2. Recipients must be UNIQUE PER RUN. A committed CSV of fixed addresses would have real
//      candidate accounts after its first run, and a CANDIDATE CANNOT BE DELETED - so every later
//      run would be exercising the already-registered path instead of a first invitation.
//   3. The dedupe and mixed-rows scenarios are about the RELATIONSHIP between rows (the same
//      address three times; three good rows against two malformed). Generating them keeps that
//      relationship in the step's own evidence, so a red row reads "3 valid + 2 malformed"
//      instead of making the reader open a file to find out.
//
// >>> THE APP VALIDATES THE UPLOAD BY EXTENSION ONLY, CLIENT-SIDE. <<< Measured 2026-08-27
// (scripts/probe-bulk-upload-formats.js): the `<input type="file">` carries
// `accept=".csv,.xlsx,.xls"`, the zone refuses .pdf/.txt/.docx/.png/.json/.zip/.exe on the
// extension with "This file type is not allowed. Use one of the accepted formats listed below.",
// and it accepts ANY bytes under an accepted extension - a CSV whose content is binary is taken
// by the form and refused only by the server (422 "Uploaded .csv file is not a plain-text CSV.").
// So:
//   * xlsx() writes a REAL, openable workbook (a stored-entry zip, built below). It costs ~40
//     lines and means an xlsx row in the accept table is not quietly a renamed CSV.
//   * xls() writes CSV content under a .xls extension, and SAYS SO in its returned metadata. A
//     genuine BIFF8 workbook is a disproportionate amount of machinery for a check the app makes
//     on the extension, and nothing in the suite sends an .xls to the server.
// ==============================================================================================

const HEADER = 'emails';

let dir = null;
let seq = 0;

function workspace() {
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bulk-'));
  return dir;
}

function unique(name) {
  seq += 1;
  return `${seq}-${name}`;
}

// The invitee mailbox. Deliberately the same helper the single-invite path uses: invitees are
// addressed on the BYTECORP mailbox because anonaddy STRIPS the +alias on delivery, and the
// candidate invitation shares the AGENT invitation's subject - so with the tag gone there would
// be nothing left to tell two invitations apart in one inbox.
function freshEmails(count, prefix = 'bulk') {
  const { freshCandidateEmail } = require('./candidateInviteProvision');
  return Array.from({ length: count }, () => freshCandidateEmail(prefix));
}

// The template's own shape, read off the real download on 2026-08-27:
//   emails\ntest.candidate2@bytecorp.io\ntest.candidate3@bytecorp.io
// One column, header `emails`, one address per row.
function csvBody(rows) {
  return `${HEADER}\n${rows.join('\n')}\n`;
}

function writeFile(name, content) {
  const target = path.join(workspace(), unique(name));
  fs.writeFileSync(target, content);
  return target;
}

// ---------------------------------------------------------------------------------------------
// Exact sizes
// ---------------------------------------------------------------------------------------------

// Pad a CSV body out to EXACTLY `bytes`, and verify it. The padding is trailing spaces, so the
// file stays a single-column CSV whose data rows are untouched.
//
// It throws rather than returning a shorter file: a boundary scenario whose fixture missed the
// boundary is the failure mode that made the exact-10MB PNG look like an app defect for a week.
function writeSized(name, rows, bytes) {
  const body = csvBody(rows);
  const have = Buffer.byteLength(body, 'utf8');
  const need = bytes - have;
  if (need < 0) {
    throw new Error(
      `Cannot build a ${bytes}-byte CSV: its ${rows.length} data row(s) alone are ${have} bytes.`
    );
  }
  const target = writeFile(name, Buffer.concat([Buffer.from(body, 'utf8'), Buffer.alloc(need, 0x20)]));
  const actual = fs.statSync(target).size;
  if (actual !== bytes) {
    throw new Error(
      `Built ${target} at ${actual} bytes, wanted exactly ${bytes}. A boundary assertion against a `
      + 'fixture that is not at the boundary proves nothing, so this is a fixture failure.'
    );
  }
  return target;
}

const MB = 1024 * 1024;

// "10MB" / "10.1MB" / "11MB" as the Gherkin writes them -> a byte count. MB is the BINARY
// megabyte, which is what the app's own limit uses: it refuses 11 * 1024 * 1024 bytes with
// "Maximum size is 10.0 MB".
function bytesFor(sizeWord) {
  const m = String(sizeWord).trim().match(/^([\d.]+)\s*MB$/i);
  if (!m) {
    throw new Error(`Unrecognised file size ${JSON.stringify(sizeWord)} - write it as e.g. "10MB" or "10.1MB".`);
  }
  return Math.round(parseFloat(m[1]) * MB);
}

// ---------------------------------------------------------------------------------------------
// A real .xlsx - a zip of STORED entries, so there is no compressor state to get wrong
// ---------------------------------------------------------------------------------------------

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function zipStored(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // 0 = stored
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(sum, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const B = (s) => Buffer.from(s, 'utf8');

function xlsxBuffer(rows) {
  const all = [HEADER, ...rows];
  const sheetRows = all
    .map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c></row>`)
    .join('');
  return zipStored([
    {
      name: '[Content_Types].xml',
      data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '</Types>'),
    },
    {
      name: '_rels/.rels',
      data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'),
    },
    {
      name: 'xl/workbook.xml',
      data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="Candidates" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '</Relationships>'),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: B('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData>${sheetRows}</sheetData></worksheet>`),
    },
  ]);
}

// ---------------------------------------------------------------------------------------------
// The fixtures the steps ask for. Every one returns metadata as well as a path, so a step can
// attach exactly what it sent - which is what makes a red row reproducible without the temp dir.
// ---------------------------------------------------------------------------------------------

function validFile({ count = 2, extension = '.csv', emails, prefix = 'bulk' } = {}) {
  const rows = emails || freshEmails(count, prefix);
  const ext = String(extension).toLowerCase().replace(/^\.?/, '.');
  if (ext === '.xlsx') {
    return {
      path: writeFile('candidates.xlsx', xlsxBuffer(rows)),
      emails: rows,
      format: ext,
      note: 'a real OOXML workbook (stored-entry zip), one column headed "emails"',
    };
  }
  if (ext === '.xls') {
    return {
      path: writeFile('candidates.xls', csvBody(rows)),
      emails: rows,
      format: ext,
      note: 'CSV content under a .xls extension - the app validates the upload by EXTENSION only, '
        + 'and nothing in the suite sends an .xls to the server',
    };
  }
  if (ext !== '.csv') throw new Error(`validFile() builds .csv, .xls or .xlsx, not ${ext}.`);
  return { path: writeFile('candidates.csv', csvBody(rows)), emails: rows, format: ext, note: 'plain-text CSV' };
}

// A file whose EXTENSION is the subject. Content is deliberately plausible for the extension, so
// a rejection is attributable to the extension and not to unreadable bytes.
const UNSUPPORTED_CONTENT = {
  '.pdf': Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8'),
  '.txt': Buffer.from('emails\nplain.text@bytecorp.io\n', 'utf8'),
  '.docx': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.json': Buffer.from('{"emails":["json@bytecorp.io"]}', 'utf8'),
  '.zip': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00]),
  '.exe': Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
};

function unsupportedFile(extension) {
  const ext = String(extension).toLowerCase().replace(/^\.?/, '.');
  const content = UNSUPPORTED_CONTENT[ext];
  if (!content) {
    throw new Error(
      `No content recipe for ${ext}. Add one to UNSUPPORTED_CONTENT rather than sending empty `
      + 'bytes - a file the app cannot read is a different rejection from one it will not accept.'
    );
  }
  return { path: writeFile(`unsupported${ext}`, content), format: ext };
}

// A .csv whose CONTENT is not CSV. The extension is accepted, so this is the only fixture that
// reaches the SERVER's own content check.
function fakeCsv() {
  const bytes = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]),
    zlib.gzipSync(Buffer.from('this is not a csv at all')),
  ]);
  return { path: writeFile('fake.csv', bytes), format: '.csv', note: 'binary content under a .csv extension' };
}

// ---------------------------------------------------------------------------------------------
// STRUCTURE variants - a well-formed .csv whose SHAPE ignores the modal's own Upload Instructions
// ---------------------------------------------------------------------------------------------
//
// The modal states three rules in its own UI - "Do not change the column headers.", "One
// candidate per row.", "Email address is required." - and the first of those is the only one a
// file can break while still being a perfectly valid CSV. These are the fixtures that break it.
//
// >>> THEY ARE ALL ACCEPTED CLIENT-SIDE, AND THAT IS THE FINDING. <<< Measured live 2026-09-16
// through the real modal: a `.csv` whose header reads `email_address`, and one with no header row
// at all, are both taken by the form with Send Invites ENABLED and no error anywhere in the zone.
// That follows from the recorded rule that validation is by EXTENSION only, but the instruction
// the modal prints implies the header matters - so the two disagree, which is what the scenario
// reports rather than asserting a preference.
//
// The addresses are real fresh ones on purpose: a structure variant whose rows were junk would be
// refused for its CONTENT, and the scenario could then no longer attribute a refusal to the shape
// of the file. Every row here would be perfectly invitable if the header were right.
const STRUCTURES = {
  'a renamed email column header': (rows) => ({
    content: `email_address\n${rows.join('\n')}\n`,
    note: 'valid rows under a header the template does not use (`email_address`, not `emails`)',
  }),
  'no header row at all': (rows) => ({
    content: `${rows.join('\n')}\n`,
    note: 'valid rows with the header line omitted entirely',
  }),
  'extra columns beside emails': (rows) => ({
    content: `${HEADER},first_name,last_name\n${rows.map((r, i) => `${r},Probe,Row${i + 1}`).join('\n')}\n`,
    note: 'the template column plus two the template does not define',
  }),
};

function structureVariantFile(structure, { count = 2, prefix = 'struct' } = {}) {
  const build = STRUCTURES[structure];
  if (!build) {
    throw new Error(
      `No recipe for the structure ${JSON.stringify(structure)}. Add one to STRUCTURES rather `
      + `than improvising in a step - the known ones are: ${Object.keys(STRUCTURES).join(', ')}.`
    );
  }
  const rows = freshEmails(count, prefix);
  const { content, note } = build(rows);
  return {
    path: writeFile('structure.csv', content),
    emails: rows,
    format: '.csv',
    structure,
    note,
  };
}

function emptyFile() {
  return {
    path: writeFile('empty.csv', `${HEADER}\n`),
    emails: [],
    format: '.csv',
    note: 'header row only, no candidate rows',
  };
}

const MALFORMED = ['not-an-email', 'missing-at.bytecorp.io', 'trailing@', '@no-local.io', 'spaces in@address.io'];

function allMalformedFile({ count = 3 } = {}) {
  const rows = MALFORMED.slice(0, count);
  return { path: writeFile('all-malformed.csv', csvBody(rows)), malformed: rows, emails: [], rows, format: '.csv' };
}

// Valid and malformed rows INTERLEAVED, not appended. A parser that stops at the first bad row
// and one that skips bad rows behave identically on a file whose bad rows are all at the end.
function mixedFile({ valid = 3, malformed = 2, prefix = 'mixed' } = {}) {
  const good = freshEmails(valid, prefix);
  const bad = MALFORMED.slice(0, malformed);
  const rows = [];
  for (let i = 0; i < Math.max(good.length, bad.length); i += 1) {
    if (good[i]) rows.push(good[i]);
    if (bad[i]) rows.push(bad[i]);
  }
  return { path: writeFile('mixed.csv', csvBody(rows)), emails: good, malformed: bad, rows, format: '.csv' };
}

// The dedupe fixture: one address repeated `times`, plus any extras exactly once.
function duplicatesFile({ repeated, times = 3, once = [] } = {}) {
  const rows = [...Array(times).fill(repeated), ...once];
  return {
    path: writeFile('duplicates.csv', csvBody(rows)),
    rows,
    repeated,
    times,
    once,
    emails: [repeated, ...once],
    format: '.csv',
  };
}

function sizedFile(sizeWord, { count = 2, prefix = 'size' } = {}) {
  const bytes = bytesFor(sizeWord);
  const rows = freshEmails(count, prefix);
  return {
    path: writeSized(`sized-${String(sizeWord).replace(/\W+/g, '')}.csv`, rows, bytes),
    emails: rows,
    bytes,
    sizeWord,
    format: '.csv',
  };
}

function largeFile({ count = 1000, prefix = 'large' } = {}) {
  const rows = freshEmails(count, prefix);
  return { path: writeFile('large.csv', csvBody(rows)), emails: rows, format: '.csv' };
}

function cleanup() {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
}

module.exports = {
  HEADER,
  MB,
  MALFORMED,
  bytesFor,
  csvBody,
  freshEmails,
  validFile,
  unsupportedFile,
  fakeCsv,
  emptyFile,
  structureVariantFile,
  STRUCTURES,
  allMalformedFile,
  mixedFile,
  duplicatesFile,
  sizedFile,
  largeFile,
  xlsxBuffer,
  cleanup,
};
