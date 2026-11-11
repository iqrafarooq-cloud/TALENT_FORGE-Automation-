// docVerificationFixtures.js - resolves a test-data document id to the real file on
// disk in `Files/Test_doc`, and refuses to guess.
//
// Why this is its own module rather than a `path.join` at the call site: the one
// lesson this repo has paid for twice is that a fixture which silently falls back to
// something else destroys the diagnosis. `imageFixtures.js` had a generated-image
// fallback, and when no PNG was registered at exactly 10 MB the form received a 1x1
// image instead; the resulting failure was recorded for months as the app wrongly
// rejecting its own documented maximum. See the "exact-10 MB boundary was never an
// app defect" note in CLAUDE.md.
//
// So there is no fallback here. A missing or unreadable file is a FIXTURE failure
// with the path in the message, never a substituted file and never a silent skip.
//
// It also reports the byte count and the extension it will actually send, because
// the FILE-* scenarios assert on exactly those two things and "the app refused this"
// versus "the suite sent something else" has to be distinguishable in the report.

'use strict';

const fs = require('fs');
const path = require('path');
const { fixtureError } = require('./docVerificationErrors');

// Repo-root relative, resolved from this file so the module works from any cwd.
const FIXTURE_DIR = path.resolve(__dirname, '..', 'Files', 'Test_doc');

// A SECOND fixture directory, added 2026-09-01 for the status-lifecycle documents.
//
// They live in their own folder because that is how they were supplied and because
// they are a coherent set - one document per end state (Approved / Revision Required /
// Need Review) built for the same candidate - which is worth keeping legible rather
// than dissolving into the 54-file criterion matrix.
//
// The directories are searched IN ORDER and a name present in BOTH is a hard fixture
// failure, never a silent first match. That rule is the whole reason this is a list and
// not a fallback: this repo already holds two byte-identical fixture clusters that
// differ only by context, so a resolver quietly preferring one directory could rebind a
// scenario to the wrong file, and the failure would read as a product defect. See the
// "exact-10 MB boundary was never an app defect" note in CLAUDE.md.
const LIFECYCLE_FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  'Files',
  '3 documents(Approved,requestrevision & need review)'
);

const FIXTURE_DIRS = [FIXTURE_DIR, LIFECYCLE_FIXTURE_DIR];

// The upload endpoints accept PDF and PNG and refuse DOCX and JPG (HTTP 422,
// measured 2026-08-21 and unchanged). The map exists so the automation sends a
// correct Content-Type rather than letting the runtime guess, and so an unknown
// extension is a loud fixture failure instead of an octet-stream upload that the
// server may refuse for a reason nobody intended.
const CONTENT_TYPE = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

function fixtureDir() {
  return FIXTURE_DIR;
}

function fixtureDirs() {
  return FIXTURE_DIRS.slice();
}

// Every file present, so a run can report "the test data names 41 documents and the
// folder holds 42" rather than quietly ignoring one.
function listFixtureFiles() {
  // A configured directory that has moved is REPORTED, never skipped - a skipped
  // directory makes a missing fixture look like a test-data typo.
  const missing = FIXTURE_DIRS.filter((d) => !fs.existsSync(d));
  if (missing.length) {
    throw fixtureError('A test-document folder does not exist', { dirs: missing });
  }
  const files = [];
  for (const dir of FIXTURE_DIRS) {
    for (const f of fs.readdirSync(dir)) if (!f.startsWith('.')) files.push(f);
  }
  return [...new Set(files)].sort();
}

// Every directory holding this file name. Returns them ALL so the caller can refuse
// to choose rather than taking a first match.
function locateFixtureFile(fileName) {
  return FIXTURE_DIRS.map((dir) => path.join(dir, fileName)).filter((f) => fs.existsSync(f));
}

// Resolve one document. `fileName` comes from the test data and must match exactly;
// a case-insensitive or fuzzy match is refused on purpose, because a fixture folder
// that grows a near-duplicate (this repo has two byte-identical clusters already)
// would otherwise silently rebind a scenario to the wrong file.
function resolveFixture(fileName, docId) {
  if (!fileName) {
    throw fixtureError('Test data entry has no file name', { document: docId });
  }
  const hits = locateFixtureFile(fileName);
  if (hits.length > 1) {
    throw fixtureError('That test document file name exists in more than one fixture folder', {
      document: docId,
      file: fileName,
      foundIn: hits,
      remedy:
        'Rename one of them. The resolver refuses to choose: two fixtures sharing a name would ' +
        'silently rebind a scenario to the wrong file.',
    });
  }
  const full = hits[0] || path.join(FIXTURE_DIR, fileName);
  if (!fs.existsSync(full)) {
    // Name the near-misses. A renamed fixture is the most likely cause and the
    // reader should not have to go looking.
    const stem = fileName.split('_')[0];
    const near = listFixtureFiles().filter((f) => f.startsWith(stem));
    throw fixtureError('Test document file is missing', {
      document: docId,
      expectedFile: fileName,
      dirs: FIXTURE_DIRS,
      filesStartingWithSamePrefix: near.length ? near : '(none)',
    });
  }
  const stat = fs.statSync(full);
  if (!stat.isFile()) {
    throw fixtureError('Test document path is not a file', { document: docId, path: full });
  }
  if (stat.size === 0) {
    throw fixtureError('Test document file is empty (0 bytes)', { document: docId, path: full });
  }
  const ext = path.extname(fileName).toLowerCase();
  const contentType = CONTENT_TYPE[ext];
  if (!contentType) {
    throw fixtureError('Test document has an extension the suite has no content type for', {
      document: docId,
      file: fileName,
      extension: ext,
      known: Object.keys(CONTENT_TYPE).join(', '),
    });
  }
  return { docId, fileName, path: full, bytes: stat.size, extension: ext, contentType };
}

// Read the bytes. Separate from resolveFixture so a scenario can assert on size
// before deciding to send an 8 MB file, and so an unreadable file (locked, or a
// permissions problem on Windows) is reported as a fixture failure rather than as an
// upload failure.
function readFixture(fixture) {
  try {
    return fs.readFileSync(fixture.path);
  } catch (e) {
    throw fixtureError('Test document could not be read', {
      document: fixture.docId,
      path: fixture.path,
      cause: e.message,
    });
  }
}

// Files named in the test data but absent from disk, and files on disk that no test
// data entry claims. Both directions matter: the first is a broken run, the second
// is coverage nobody is exercising.
function reconcileWithTestData(documents) {
  const named = new Set(
    documents.flatMap((d) => (Array.isArray(d.files) ? d.files : [d.file])).filter(Boolean)
  );
  const onDisk = new Set(listFixtureFiles());
  return {
    missingFromDisk: [...named].filter((f) => !onDisk.has(f)).sort(),
    unusedOnDisk: [...onDisk].filter((f) => !named.has(f)).sort(),
  };
}

module.exports = {
  FIXTURE_DIR,
  LIFECYCLE_FIXTURE_DIR,
  FIXTURE_DIRS,
  CONTENT_TYPE,
  fixtureDir,
  fixtureDirs,
  locateFixtureFile,
  listFixtureFiles,
  resolveFixture,
  readFixture,
  reconcileWithTestData,
};
