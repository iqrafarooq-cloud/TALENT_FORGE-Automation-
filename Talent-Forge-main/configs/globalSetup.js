// Runs once, in the process that outlives every worker, before Playwright loads any test file.
//
// Wired in via the `globalSetup` config field rather than as top-level code in
// playwright.config.js on purpose: `npx bddgen` loads that same config to discover features and
// steps, and generation needs no credentials at all - so a check placed at the top level would
// fail generation for a missing variable that generation never uses. (bddgen does NOT run
// globalSetup, which is what makes the regeneration below safe rather than recursive.)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveBin } = require('./resolveBin');
const selectionStamp = require('./selectionStamp');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');

// >>> DELIBERATELY A SHORT LIST. Only variables EVERY project needs are checked here.
//     Per-area credentials (REFERRAL_AGENT_*, PROMO_*_AGENT_*, SUPERADMIN_*, TWOFA_AGENT_*,
//     DOC_CANDIDATE_*, the IMAP settings) are validated by the step file that owns them, which
//     is the better place for two reasons: the message names the area that needs it, and a run
//     of one area is not blocked by a variable only another area uses. Promoting them here
//     would turn "the promo fixtures are not provisioned" into "the whole suite refuses to
//     start".
const REQUIRED = ['BASE_URL'];

// Everything whose change invalidates the generated specs.
const SOURCE_GLOBS = [
  { dir: path.join(ROOT, 'features'), ext: '.feature' },
  { dir: path.join(ROOT, 'steps'), ext: '.js' },
  { dir: path.join(ROOT, 'fixtures'), ext: '.js' },
];

function newestMtime(dir, ext, newest = 0) {
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = newestMtime(full, ext, newest);
    else if (entry.name.endsWith(ext)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * >>> WHY THIS EXISTS: `.feature` FILES ARE COMPILED, AND A DIRECT `npx playwright test` DOES
 *     NOT COMPILE THEM.
 *
 * bddgen turns each .feature into a spec under .features-gen/, and Playwright runs those. Going
 * through `npm run pw:*` regenerates first, so this is a no-op there. But running
 * `npx playwright test --config configs/playwright.config.js <feature>` by hand - which is a
 * perfectly reasonable thing to want - skips generation entirely, and the run then reports a
 * result for the PREVIOUS generation. That is the exact class of defect CLAUDE.md documents at
 * length for the old HTML report describing an older run, and here it is worse: the numbers look
 * completely normal.
 *
 * So rather than warn, this regenerates. Playwright runs globalSetup BEFORE it loads test files
 * (verified: the banner below prints ahead of "Running N tests"), so specs written here are
 * picked up by the run that triggered it.
 *
 * BDD_SKIP_GEN=1 opts out, for the case where you know the specs are current and want the
 * seconds back.
 */
function regenerateIfStale() {
  if (process.env.BDD_SKIP_GEN === '1') return;

  // The ACTIVE profile's own generated tree (one per profile - see OUTPUT_DIR in the config).
  const generated = require('./playwright.config.js').__selection.outputDir;
  const newestSpec = newestMtime(generated, '.spec.js');
  let newestSource = fs.statSync(path.join(__dirname, 'profiles.js')).mtimeMs;
  for (const { dir, ext } of SOURCE_GLOBS) newestSource = Math.max(newestSource, newestMtime(dir, ext));

  // >>> TWO INDEPENDENT REASONS THE SPECS CAN BE STALE, AND MTIME ONLY SEES ONE OF THEM.
  //
  //     The mtime comparison catches a CODE change (a .feature, a step, a fixture). It is blind
  //     to a changed TAG EXPRESSION, because bddgen filters by tag at generation time - so the
  //     specs on disk are the selection that was in force when generation last ran, and setting
  //     ALLOW=@doc-verification changes the config without touching a single file. Measured:
  //     that opt-in reported the default 372 tests off the previous generation, i.e. it silently
  //     did nothing. See configs/selectionStamp.js.
  const stamp = selectionStamp.check();
  const codeStale = newestSpec === 0 || newestSource > newestSpec;

  if (!codeStale && !stamp.stale) return;

  const reason = newestSpec === 0
    ? 'no generated specs found'
    : (codeStale
      ? 'a .feature, step or fixture file is newer than the generated specs'
      : stamp.reason);
  console.log(`[playwright-bdd] ${reason} - regenerating (BDD_SKIP_GEN=1 to skip)`);

  // >>> RESOLVED THROUGH THE PACKAGE'S OWN `bin` FIELD, NOT BY A DEEP PATH.
  //     `require.resolve('playwright-bdd/dist/cli/index.js')` throws
  //     "Package subpath './dist/cli/index.js' is not defined by exports" - the package's
  //     `exports` map blocks it. That is precisely the trap configs/resolveBin.js was written
  //     for, and reusing resolveBin() means the path cannot go stale on an upgrade either.
  const bddgen = resolveBin('playwright-bdd', 'bddgen');

  // >>> PLAYWRIGHT_BDD_CONFIGS MUST BE STRIPPED FROM THE CHILD'S ENVIRONMENT, AND LEAVING IT
  //     THERE SILENTLY BREAKS THE CLEANUP OF STALE SPECS.
  //
  //     playwright-bdd writes this variable into process.env as a SIDE EFFECT of the config
  //     being loaded - it is how `defineBddProject` hands its per-project outputDir to the
  //     generator. By the time this function runs, Playwright has loaded the config in THIS
  //     process, so the variable is set here; `stdio: 'inherit'` with no `env` then passes it
  //     down, and bddgen prefers the inherited registry over resolving the config itself.
  //
  //     That registry's paths are resolved against the PARENT's cwd and are wrong: measured,
  //     they come out as `C:\Users\Byte\Documents\.features-gen\{parallel,serial}` - one level
  //     ABOVE the project, a directory that does not exist. So `clearOutputDir()` globs nothing,
  //     deletes nothing, and returns happily, while generation still writes the new specs to the
  //     correct place through its own resolution. The result is a generation that ADDS but never
  //     REMOVES, with exit code 0 and no output at all.
  //
  //     WHY THAT IS DANGEROUS RATHER THAN UNTIDY: the specs are the selection. A scenario that
  //     the current tag expression excludes still has a spec file on disk from the last run that
  //     included it, and Playwright runs every spec it finds. Measured: after one
  //     `ALLOW=@doc-verification` generation, a subsequent DEFAULT run reported 452 tests in 28
  //     files instead of 372 in 26 - i.e. it would have spent ~40 permanent, undeletable
  //     document uploads on a run that never opted in.
  //
  //     `npm run gen` was never affected, which is why this hid: configs/run-playwright.js does
  //     not require the config before spawning bddgen, so nothing has polluted its environment.
  //     Reproduced and fixed by experiment - pre-loading the config then spawning bddgen leaves
  //     the orphan; deleting this one variable from the child env removes it (28 -> 26 files).
  const childEnv = { ...process.env };
  delete childEnv.PLAYWRIGHT_BDD_CONFIGS;

  const result = spawnSync(process.execPath, [bddgen, '--config', path.join(__dirname, 'playwright.config.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false, // an argument with spaces must stay one argument - see configs/run-playwright.js
    env: childEnv,
  });
  if (result.status !== 0) {
    throw new Error(
      'playwright-bdd generation failed, so the specs on disk are stale. Fix the error above, '
      + 'or run `npm run gen` to see it on its own. Refusing to run tests against specs that do '
      + 'not match the current .feature/steps files.',
    );
  }

  // Record WHICH selection those specs are, so the next run can tell a stale tag expression from
  // a current one. Written only after a SUCCESSFUL generation - stamping a failed one would claim
  // the specs match an expression they were never built from.
  selectionStamp.write();
}

module.exports = function globalSetup() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n`
      + 'Set them in .env at the project root.',
    );
  }

  regenerateIfStale();

  // One line naming what this run actually IS. Worth printing because the knobs that most
  // change a run's behaviour are all environment variables - so a report read later gives no
  // hint of which values produced it. The values are read back off the resolved config rather
  // than recomputed here, so this cannot drift from what Playwright is actually doing.
  //
  // Requiring the config is safe: Playwright has already loaded it by the time globalSetup runs,
  // so this is a cache hit, not a second evaluation.
  const config = require('./playwright.config.js');
  const workers = config.workers === undefined
    ? 'auto (Playwright decides - half the CPU cores)'
    : config.workers;
  console.log(
    `[playwright-bdd] base=${process.env.BASE_URL} workers=${workers} `
    + `${config.use.headless ? 'headless' : 'headed'} `
    + `video=${process.env.VIDEO || 'retain-on-failure'}`,
  );
};
