const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');
const ARCHIVE_DIR = path.join(REPORTS_DIR, 'archive');

// WHY THIS EXISTS. reports/ used to accumulate the output of every run that had ever happened:
// report pairs from five different days sitting side by side, 200 failure screenshots and 225
// videos naming scenarios that had long since gone green, and - worst of it - a
// cucumber-report.html newer than the cucumber-report.json it was built from, i.e. one run's
// HTML presenting a PREVIOUS run's results. Whoever opened the folder could not tell which
// files belonged to the run they had just watched.
//
// So a run now starts by clearing the previous run's output, and what is left in reports/
// afterwards is that one run, whole. The rule below is the definition of "output of a run",
// and it is deliberately narrower than "everything in reports/":
//
//   * every .html - reports/ holds no hand-written HTML, so every one of them is a rendered
//     report (cucumber-report, failed-report, rerun-report, the per-profile ones);
//   * the .json/.md/.ndjson files a run writes, matched by name so a probe's dump is not
//     caught in the sweep;
//   * screenshots/ and videos/, which are per-scenario evidence and belong to one run only.
//
// scripts/probe-*.js write their own .log/.json/.png into reports/ and are NOT test-run output
// - they are measurements someone took on purpose, often the evidence behind a decision
// recorded in CLAUDE.md, and deleting them from under a reader would be its own bug.
// >>> reports/playwright-report/ IS NOT SWEPT, AND MUST STAY THAT WAY.
//     It is the playwright-bdd HTML report (see README.md), which Playwright
//     rewrites wholesale at the end of each of its own runs and which no Cucumber run has any
//     business deleting. Two things keep it safe today and both are load-bearing: a directory
//     is only a run artifact if it is NAMED in RUN_ARTIFACT_DIRS below, and the .html rule in
//     isRunArtifact() only ever sees the TOP level of reports/ because the scan is not
//     recursive. Verified 2026-09-02: a Cucumber run through this wrapper left
//     reports/playwright-report/index.html byte-identical.
//     If either rule is ever widened - a recursive scan, or directories matched by pattern -
//     add an explicit exclusion for it, or a Cucumber run will silently delete the report of
//     the last Playwright run.
// playwright-report/ is rewritten by Playwright on every run anyway; it is listed so that
// KEEP_PREVIOUS_REPORTS=1 ARCHIVES the previous report instead of letting it be overwritten.
const RUN_ARTIFACT_DIRS = new Set(['screenshots', 'videos', 'playwright-report']);
// ai-findings.ndjson is APPENDED to, one line per verified document, by every worker - so it
// must be swept like any other run artifact. Left behind, the next run's findings file would
// silently mix this run's verdicts with the previous run's, which is exactly the class of
// confusion this whole module exists to prevent. Its two built outputs are named
// ai-verification-findings.* and match neither the (report|rerun|messages) pattern nor each
// other, so all three are listed explicitly.
const RUN_ARTIFACT_FILES = new Set([
  '@rerun.txt',
  'run-summary.json',
  'cucumber-messages.ndjson',
  'ai-findings.ndjson',
  'ai-verification-findings.md',
  'ai-verification-findings.json',
  // configs/summaryReportReporter.js. Its .html twin is caught by the .html rule and its data
  // file (summary-report-data.json) by the report-name rule below.
  'Test-Summary-Report.pdf',
  'Test-Summary-Report-ide.pdf',
]);

function isRunArtifact(name, isDirectory) {
  if (isDirectory) return RUN_ARTIFACT_DIRS.has(name);
  if (RUN_ARTIFACT_FILES.has(name)) return true;
  if (/\.html$/i.test(name)) return true;
  return /(report|rerun|messages)/i.test(name) && /\.(json|md|ndjson)$/i.test(name);
}

/** A filesystem-safe stamp for an archive folder: 2026-08-25T14-52-10. */
function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

/**
 * Clear the previous run's output so reports/ describes exactly one run.
 *
 * `archive: true` (KEEP_PREVIOUS_REPORTS=1) MOVES it to reports/archive/<stamp>/ instead of
 * deleting it. That escape hatch is not decoration: a few runs cannot simply be repeated -
 * `test:community-create` permanently consumes a university per scenario, and the promo and
 * doc-verification runs spend real payments or leave undeletable document rows - so their
 * report is the only record of something that cost something. Archive before a run that would
 * otherwise wipe one of those.
 *
 * Never throws: a report folder that cannot be tidied must not stop a test run. Anything it
 * could not remove is returned and named by the caller, because a wipe that silently half
 * happened leaves exactly the mixed-up folder this function exists to prevent.
 */
function resetReportsWorkspace({ archive = false, dryRun = false } = {}) {
  const result = { removed: [], archived: [], archivedTo: null, failed: [], kept: [] };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  let entries;
  try {
    entries = fs.readdirSync(REPORTS_DIR, { withFileTypes: true });
  } catch (e) {
    result.failed.push({ name: '(reports directory)', error: e.message });
    return result;
  }

  const archiveTarget = archive ? path.join(ARCHIVE_DIR, runStamp()) : null;

  for (const entry of entries) {
    const name = entry.name;
    if (name === 'archive') continue; // never sweep the archive itself
    if (!isRunArtifact(name, entry.isDirectory())) {
      result.kept.push(name);
      continue;
    }

    const from = path.join(REPORTS_DIR, name);
    if (dryRun) {
      (archive ? result.archived : result.removed).push(name);
      continue;
    }

    try {
      if (archiveTarget) {
        fs.mkdirSync(archiveTarget, { recursive: true });
        fs.renameSync(from, path.join(archiveTarget, name));
        result.archived.push(name);
        result.archivedTo = archiveTarget;
      } else {
        fs.rmSync(from, { recursive: true, force: true });
        result.removed.push(name);
      }
    } catch (e) {
      result.failed.push({ name, error: e.message });
    }
  }

  return result;
}

/** One line for the run log: what the sweep did, or nothing at all when reports/ was clean. */
function describeReset(result) {
  const parts = [];
  if (result.removed.length) parts.push(`removed ${result.removed.length} file(s)/folder(s) from the previous run`);
  if (result.archived.length) {
    parts.push(`archived ${result.archived.length} file(s)/folder(s) from the previous run to ${path.relative(REPORTS_DIR, result.archivedTo)}/`);
  }
  if (!parts.length) return 'reports/ was already clear of previous-run output.';
  return `reports/: ${parts.join('; ')}.`;
}

module.exports = {
  REPORTS_DIR,
  ARCHIVE_DIR,
  isRunArtifact,
  runStamp,
  resetReportsWorkspace,
  describeReset,
};

// CLI: `npm run reports:clean` (add --archive to keep a copy, --dry-run to see what would go).
if (require.main === module) {
  const argv = process.argv.slice(2);
  const archive = argv.includes('--archive') || process.env.KEEP_PREVIOUS_REPORTS === '1';
  const dryRun = argv.includes('--dry-run');
  const result = resetReportsWorkspace({ archive, dryRun });
  console.log(dryRun ? `[dry run] ${describeReset(result)}` : describeReset(result));
  for (const name of [...result.removed, ...result.archived].sort()) console.log(`  - ${name}`);
  if (result.kept.length) {
    console.log(`Kept ${result.kept.length} non-run file(s) (probe output, logs): ${result.kept.slice(0, 8).join(', ')}${result.kept.length > 8 ? ', …' : ''}`);
  }
  for (const f of result.failed) console.warn(`  ! could not remove ${f.name}: ${f.error}`);
  process.exit(result.failed.length ? 1 : 0);
}
