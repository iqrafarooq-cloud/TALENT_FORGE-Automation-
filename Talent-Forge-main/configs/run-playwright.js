// The entry point every `npm test*` script goes through. Playwright + playwright-bdd only.
//
//   node configs/run-playwright.js [--profile <name>] [--tags "<expr>"] [--name "<text>"]
//                                  [features/X.feature[:line] ...] [--headless|--headed]
//                                  [--serialise] [--workers N] [--gen-only] [--list]
//                                  [any other Playwright option, passed through]
//
// It accepts the arguments the old Cucumber wrapper (configs/run-tests.js) did, so every npm
// script, and every command recorded in CLAUDE.md, keeps working with the same meaning:
//
//   --profile/-p <name>   a selection from configs/profiles.js (default: "default")
//   --tags "<expr>"       a Cucumber tag expression, ANDed with the profile's - as before
//   --name "<text>"       a scenario-name filter (Playwright --grep, a regex)
//   path.feature          limits the run to that file
//   path.feature:<line>   ...and to the scenario at that line (mapped to its name, since the
//                         generated spec's line numbers are not the .feature's)
//   --workers N           the parallel lane's worker count (same as PARALLEL=N)
//   --report-name / --format   accepted and ignored - there is one report now
//
// WHAT A RUN DOES, IN ORDER
//   0. refuses to start if a playwright-bdd special tag (@skip/@fixme/@only) would silently drop
//      scenarios                                          (scripts/check-special-tags.js)
//   1. clears the previous run's output from reports/    (configs/reportsWorkspace.js;
//      KEEP_PREVIOUS_REPORTS=1 archives instead)
//   2. generates the profile's specs into .features-gen/<profile>/
//   3. lists the selection per lane, so an empty selection fails loudly instead of "passing"
//   4. runs the PARALLEL lane, then the SERIAL lane - two `playwright test` calls, exactly as
//      Nxtstim's `npm test` does - and merges their blob shards into ONE HTML report
//   5. writes the AI-findings artifact if any document was verified
// The exit code is the worst of the lanes.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { resolveBin } = require('./resolveBin');
const { PROFILES } = require('./profiles');

const CONFIG = path.join(__dirname, 'playwright.config.js');
const ROOT = path.join(__dirname, '..');
const LANES = ['parallel', 'serial'];

// ---- parse arguments --------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { genOnly: false, headless: false, headed: false, serialise: false, list: false };
let profile = null;
let tags = null;
const names = [];
const featurePaths = [];
const lineTargets = [];
const passthrough = [];

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => {
    i += 1;
    if (argv[i] === undefined) fail(`${a} needs a value`);
    return argv[i];
  };
  if (a === '--gen-only') flags.genOnly = true;
  else if (a === '--headless') flags.headless = true;
  else if (a === '--headed') flags.headed = true;
  else if (a === '--serialise' || a === '--serial') flags.serialise = true;
  else if (a === '--list') { flags.list = true; passthrough.push(a); }
  else if (a === '--profile' || a === '-p') profile = next();
  else if (a === '--tags' || a === '-t') tags = next();
  else if (a === '--name') names.push(next());
  else if (a === '--workers' && /^\d+%?$/.test(argv[i + 1] || '')) process.env.PARALLEL = next();
  else if (a === '--report-name' || a === '--format' || a === '-f') next(); // one report now
  else if (/\.feature(:\d+)*$/.test(a)) {
    const [file, ...lines] = a.split(':').reduce((acc, part) => {
      // Re-join a Windows drive letter ("C:\...") that split(':') tore off.
      if (acc.length === 1 && /^[A-Za-z]$/.test(acc[0])) { acc[0] = `${acc[0]}:${part}`; return acc; }
      acc.push(part);
      return acc;
    }, []);
    const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');
    if (!fs.existsSync(path.join(ROOT, rel))) fail(`no such feature file: ${rel}`);
    featurePaths.push(rel);
    for (const l of lines) lineTargets.push({ file: rel, line: Number(l) });
  } else passthrough.push(a);
}

profile = profile || 'default';
if (!PROFILES[profile]) fail(`unknown profile "${profile}". Known: ${Object.keys(PROFILES).join(', ')}`);

// ---- environment for every child ------------------------------------------------------------

const env = { ...process.env, BDD_PROFILE: profile };
if (tags) env.BDD_TAGS = tags;
if (featurePaths.length) env.BDD_PATHS = [...new Set(featurePaths)].join('|');
// "Only ever fills a gap": a value the caller exported always wins over a flag or a profile.
const fillGap = (k, v, why) => {
  if (env[k] === undefined || env[k] === '') {
    env[k] = v;
    if (why) console.log(`[run] ${why}: ${k}=${v}`);
  }
};
if (flags.headless) fillGap('HEADED', 'false');
if (flags.headed) fillGap('HEADED', 'true');
if (flags.serialise) fillGap('SERIALISE', '1');
for (const [k, v] of Object.entries(PROFILES[profile].env || {})) fillGap(k, v, `profile '${profile}' default`);
// The config is also loaded IN THIS PROCESS (for the selection metadata), so it must see the same
// variables the children will.
Object.assign(process.env, env);

// A `file:line` names one scenario. The generated spec's line numbers are not the .feature's, so
// the line is mapped to the scenario it falls in and selected by name.
for (const t of lineTargets) {
  const name = scenarioAt(path.join(ROOT, t.file), t.line);
  if (!name) fail(`${t.file}:${t.line} is not inside a Scenario`);
  names.push(`${escapeRe(name)}(?=$| @| Example #)`);
}
if (names.length) passthrough.push('--grep', names.length === 1 ? names[0] : names.map((n) => `(?:${n})`).join('|'));

// A list-only profile's scenarios cannot even be GENERATED (their 'pending' stub steps take no
// arguments, which playwright-bdd's arity check rejects) - and running them would report PASSED
// anyway. Cucumber only ever reported them as `pending`, so they are listed straight from the
// Gherkin for manual review instead.
if (PROFILES[profile].listOnly) {
  console.log(`[run] profile '${profile}' is list-only: these scenarios cannot be automated, so `
    + 'they are listed for manual review rather than run.');
  process.exit(run('list', path.join(ROOT, 'scripts', 'check-profile-selection.js'),
    ['--profiles', profile, '--by', 'line', '--print']));
}

const PLAYWRIGHT = resolveBin('@playwright/test', 'playwright');
const BDDGEN = resolveBin('playwright-bdd', 'bddgen');

// ---- 0. special tags ------------------------------------------------------------------------
if (run('check special tags', path.join(ROOT, 'scripts', 'check-special-tags.js'), []) !== 0) {
  fail('a playwright-bdd special tag would change which scenarios run. Refusing to start rather '
    + 'than report a green run with scenarios missing from it.');
}

// ---- 1. generate ----------------------------------------------------------------------------
// A generation failure is fatal: stale specs on disk would otherwise go green against code that
// no longer exists, hiding the very error (an undefined step) generation exists to catch.
const genCode = run(`generate specs (profile ${profile})`, BDDGEN, ['--config', CONFIG]);
if (genCode !== 0) {
  fail('generation failed - not running tests. The specs on disk are from a previous generation.', genCode);
}
// Written after a SUCCESSFUL generation only, so globalSetup can tell these specs are current.
require('./selectionStamp').write();
if (flags.genOnly) process.exit(0);

const selection = require('./playwright.config.js').__selection;

// ---- 2. list the selection per lane ---------------------------------------------------------
const counts = countPerLane();
const total = counts.parallel + counts.serial;
console.log(`\n[run] profile '${profile}'${tags ? ` + tags "${tags}"` : ''}`
  + `${featurePaths.length ? ` + ${featurePaths.join(', ')}` : ''}: `
  + `${counts.parallel} parallel + ${counts.serial} serial scenario(s)`);
if (total === 0) {
  fail('the selection is EMPTY - nothing would run. Check the profile, --tags, --name and paths. '
    + '(Under Cucumber this printed "0 scenarios" and exited 0, which read as a pass.)');
}
if (flags.list) {
  run('list', PLAYWRIGHT, ['test', '--config', CONFIG, ...passthrough]);
  process.exit(0);
}

// ---- 3. prepare reports/ --------------------------------------------------------------------
const { resetReportsWorkspace, describeReset } = require('./reportsWorkspace');
const reset = resetReportsWorkspace({ archive: process.env.KEEP_PREVIOUS_REPORTS === '1' });
console.log(describeReset(reset));
for (const f of reset.failed) console.warn(`[run] could not clear reports/${f.name}: ${f.error}`);
fs.rmSync(path.join(ROOT, 'blob-report'), { recursive: true, force: true });
const aiFindings = require('../utils/aiFindingsLog');
aiFindings.reset();
const startedAt = new Date();

// ---- 4. run the lanes -----------------------------------------------------------------------
const lanes = LANES.filter((l) => counts[l] > 0);
const sharded = lanes.length > 1;
let worst = 0;
for (const lane of lanes) {
  const code = run(`${lane} lane (${counts[lane]})`, PLAYWRIGHT,
    ['test', '--config', CONFIG, `--project=${lane}`, ...passthrough],
    // PWTEST_BLOB_DO_NOT_REMOVE: the blob reporter otherwise empties its output folder before
    // writing, so the serial call would delete the parallel call's shard. blob-report/ was swept
    // above, so suppressing that removal is safe.
    sharded ? { PW_LANE: lane, PW_BLOB: lane, PWTEST_BLOB_DO_NOT_REMOVE: '1' } : { PW_LANE: lane });
  worst = Math.max(worst, code);
}
if (sharded) {
  const mergeCode = run('merge reports', PLAYWRIGHT,
    // No --reporter: an explicit one overrides the config's html outputFolder and writes to
    // ./playwright-report instead of reports/playwright-report. PW_BLOB is unset here, so the
    // config hands the merge its html reporter.
    ['merge-reports', '--config', CONFIG, path.join(ROOT, 'blob-report')], { PW_MERGE: '1' });
  if (mergeCode !== 0) {
    console.error('[run] the lanes finished but merging their reports failed. The shards are in '
      + `blob-report/; merge by hand with:\n  npx playwright merge-reports --config ${CONFIG} blob-report`);
  }
}

// ---- 5. AI findings -------------------------------------------------------------------------
try {
  const built = aiFindings.write({ since: startedAt });
  if (built) {
    console.log(`AI findings: ${built.count} verified document(s) -> reports/ai-verification-findings.md (+ .json)`
      + (built.stale ? `  [${built.stale} stale record(s) from an earlier run excluded]` : ''));
  }
} catch (e) {
  console.warn('[run] AI findings artifact failed:', e.message);
}

console.log('\n> report: npm run test:report   (reports/playwright-report/index.html)');
console.log('> summary: npm run test:report:pdf   (reports/Test-Summary-Report.pdf)');
process.exit(worst);

// =============================================================================================

function run(label, bin, args, extraEnv) {
  console.log(`\n> ${label}: node ${path.relative(ROOT, bin)} ${args.join(' ')}`);
  // shell:false so an argument containing a space (a scenario name, "AI Document Verification")
  // stays ONE argument. PLAYWRIGHT_BDD_CONFIGS is stripped: playwright-bdd sets it as a side
  // effect of loading the config in THIS process, and a child inheriting it resolves the config
  // registry against the wrong cwd (see the long note in configs/globalSetup.js).
  const childEnv = { ...env, ...extraEnv };
  delete childEnv.PLAYWRIGHT_BDD_CONFIGS;
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: ROOT, env: childEnv, stdio: 'inherit', shell: false,
  });
  if (result.error) {
    console.error(`[run] could not start "${label}": ${result.error.message}`);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

function countPerLane() {
  const out = {};
  for (const lane of LANES) {
    const childEnv = { ...env, BDD_SKIP_GEN: '1', PW_LANE: lane };
    delete childEnv.PLAYWRIGHT_BDD_CONFIGS;
    const r = spawnSync(process.execPath,
      [PLAYWRIGHT, 'test', '--config', CONFIG, `--project=${lane}`, '--list', '--reporter=json',
        ...passthrough.filter((a) => a !== '--list')],
      { cwd: ROOT, env: childEnv, encoding: 'utf8', shell: false, maxBuffer: 256 * 1024 * 1024 });
    let n = 0;
    try {
      const j = JSON.parse(r.stdout);
      (function walk(s) {
        for (const c of s.suites || []) walk(c);
        for (const spec of s.specs || []) n += (spec.tests || []).length || 1;
      })({ suites: j.suites || [] });
    } catch (e) {
      // "No tests found" exits non-zero with no JSON - that lane is simply empty.
      n = 0;
    }
    out[lane] = n;
  }
  return out;
}

function scenarioAt(file, line) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i -= 1) {
    const m = lines[i].match(/^\s*(?:Scenario Outline|Scenario Template|Scenario|Example):\s*(.+?)\s*$/);
    if (m) return m[1];
    if (/^\s*(?:Feature|Rule|Background):/.test(lines[i])) return null;
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message, code = 1) {
  console.error(`\n[run] ${message}`);
  process.exit(code);
}
