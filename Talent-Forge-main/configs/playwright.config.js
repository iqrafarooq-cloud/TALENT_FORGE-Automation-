// Playwright + playwright-bdd configuration. This is the ONLY runner: Cucumber was removed on
// 2026-10-06, and every `npm test*` script now goes through configs/run-playwright.js.
//
// >>> .feature FILES ARE COMPILED, NOT INTERPRETED. `bddgen` turns each one into a Playwright
//     spec under .features-gen/<profile>/, and `playwright test` runs THOSE. Every npm script
//     regenerates first, and configs/globalSetup.js regenerates automatically when a .feature,
//     step or fixture is newer than the specs - so a hand-typed `npx playwright test` is safe too.
//
// THE SHAPE, AND HOW IT MAPS ONTO NXTSTIM
//
//   Nxtstim                                     here
//   features/Parallel/** -> project chromium    tag-selected -> project 'parallel' (fullyParallel)
//   features/Serial/**   -> chromium-serial     tag-selected -> project 'serial'   (one worker)
//   npm test = one playwright call per project  same - configs/run-playwright.js runs parallel
//                                               first, serial second, one merged HTML report
//
// The split is by TAG rather than by folder because this suite's serialisation needs are PER
// SCENARIO, not per file: Referral-Codes.feature, Community.feature and the document-verification
// file each mix read-only scenarios with ones that spend something. A folder split would tear
// those files in half. The tags that say "this touches shared, finite or unrecoverable state"
// already exist (SERIAL_TAGS below), so they decide the project.
//
// WHICH SCENARIOS ARE GENERATED AT ALL is decided by a PROFILE (configs/profiles.js) - the direct
// successor of cucumber.js's profiles. BDD_PROFILE names it; configs/run-playwright.js always sets
// it (to "default" unless --profile says otherwise). With BDD_PROFILE unset - a hand-typed
// `npx playwright test`, or the VS Code Playwright extension - EVERY runnable scenario is
// generated, so naming a feature file always runs it. That is the "I am naming what I want" path,
// and it INCLUDES the costly areas.
const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');

// >>> SNAPSHOT THE REAL SHELL ENVIRONMENT BEFORE dotenv RUNS. dotenv merges .env into
//     process.env, after which a value the CALLER typed cannot be told from one sitting in .env -
//     and this project's .env pins HEADED=true. resolveHeaded() prefers SHELL_ENV, so a variable
//     you set on the command line beats the same variable in .env.
const SHELL_ENV = { ...process.env };

// Explicit path: this file is loaded by bddgen as well as the runner, from configs/, so it must
// not depend on the caller's cwd. Every other module's bare dotenv.config() then becomes a no-op.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PROFILES } = require('./profiles');

// >>> THE VS CODE PLAYWRIGHT EXTENSION MUST NOT SHARE OUTPUT FOLDERS WITH A TERMINAL RUN.
//     Its long-lived `playwright test-server` loads this same config, and every run it starts WIPES
//     the output folder first - so a terminal run in progress lost its trace and video files
//     mid-write (measured 2026-10-06: "ENOENT ... .playwright-artifacts-1/<trace>.zip", and a
//     "Target page, context or browser has been closed" on a scenario that passes alone).
//     The server is detected once, in its main process, and marked in the environment, because
//     its WORKERS re-load this file with a different argv but inherit the environment.
if (process.argv.some((a) => /test-server/.test(a))) process.env.PW_IDE_RUN = '1';
const IDE_RUN = process.env.PW_IDE_RUN === '1';

// ---------------------------------------------------------------------------------------------
// Selection: which scenarios are generated
// ---------------------------------------------------------------------------------------------

// @not-automatable steps are `() => 'pending'` stubs (states needing DB access, cron, time-travel).
// Cucumber reported them as `pending`; Playwright has no such verdict and would report them as
// PASSED having asserted nothing - so they are never generated (except by the list-only
// notAutomatable profile). @not-implemented scenarios have no step definitions at all, and
// playwright-bdd fails the WHOLE generation on one undefined step, so excluding them is what keeps
// generation alive.
const NEVER_RUN = 'not @not-automatable and not @not-implemented';

const PROFILE_NAME = (process.env.BDD_PROFILE || '').trim();
if (PROFILE_NAME && !PROFILES[PROFILE_NAME]) {
  throw new Error(`Unknown BDD_PROFILE "${PROFILE_NAME}". Known profiles: ${Object.keys(PROFILES).join(', ')}`);
}
const PROFILE = PROFILE_NAME ? PROFILES[PROFILE_NAME] : null;

// Extra tags from --tags on the command line. ANDed with the profile's own expression - exactly
// what a CLI --tags did under Cucumber, so `--profile promoUsage --tags "@promo-lifecycle"` narrows.
const EXTRA_TAGS = (process.env.BDD_TAGS || '').trim();

const and = (...exprs) => exprs.filter(Boolean).map((e) => `(${e})`).join(' and ');
const GENERATION_TAGS = and(
  PROFILE && PROFILE.listOnly ? null : NEVER_RUN,
  PROFILE && PROFILE.tags,
  EXTRA_TAGS,
);

// Feature files: any .feature path the caller named (BDD_PATHS, set by run-playwright.js), else
// the profile's own paths, else everything. Paths are repo-relative; bddgen resolves from here.
const toConfigRel = (p) => `../${p.replace(/\\/g, '/').replace(/^\.\//, '')}`;
const CLI_PATHS = (process.env.BDD_PATHS || '').split('|').map((s) => s.trim()).filter(Boolean);
const FEATURES = CLI_PATHS.length
  ? CLI_PATHS.map(toConfigRel)
  : (PROFILE && PROFILE.paths ? PROFILE.paths.map(toConfigRel) : ['../features/**/*.feature']);

// One generated tree per profile, so switching profiles does not overwrite another's specs and a
// run cannot pick up specs generated for a different selection.
const OUTPUT_DIR = path.join(__dirname, '..', '.features-gen', PROFILE_NAME || 'all');

const testDir = defineBddConfig({
  featuresRoot: '..',
  features: FEATURES,
  steps: ['../steps/**/*.js', '../fixtures/**/*.js'],
  tags: GENERATION_TAGS || undefined,
  outputDir: OUTPUT_DIR,
});

// ---------------------------------------------------------------------------------------------
// Which project (lane) a scenario runs in
// ---------------------------------------------------------------------------------------------

// A scenario belongs in the SERIAL lane when running two of its kind at once would make them
// interfere - NOT merely because it is slow. Four reasons cover every tag here:
//   - IT READS THE SHARED IMAP INBOX. anonaddy STRIPS the `+alias` on delivery, so two concurrent
//     signups can pick up each other's verification link.
//   - IT MUTATES SHARED LIVE STATE AND PUTS IT BACK in an After hook; two at once restore each
//     other's snapshot.
//   - ITS INPUT IS THE ACCOUNT'S OWN HISTORY (cross_document_consistency: upload order is data).
//   - IT SPENDS SOMETHING FINITE. A real payment, a promo usage, a university.
const SERIAL_TAGS = [
  '@mutates-notifications', // marks a notification read; the dashboard's unread-count scenario reads that count
  '@commits-decision',   // uploads as the shared DOC_CANDIDATE and decides on that one document
  '@creates-agent',      // live superadmin invite + shared IMAP inbox
  '@provision',          // live signup over the shared IMAP inbox (anonaddy strips +alias)
  '@consumes-promo',     // real test-mode payments and a finite promo usage limit
  '@doc-verification',   // upload order is test data (cross_document_consistency)
  '@candidate-e2e',      // shared inbox + permanent candidates on a shared agent
  '@bulk-upload',        // shared inbox + permanent candidates on a shared agent
  '@invite-candidate',   // shared inbox + permanent candidates on a shared agent
  '@creates-community',  // permanently consumes a university; no delete exists
  '@mutates-community',  // mutates a shared community and restores it
  '@mutates-agent',      // commits a real agent state change
  '@impersonates-agent', // checks the superadmin's password (rate limited) and starts a real
                         // impersonation session
  '@mutates-candidate',  // deactivates a live candidate and reactivates it, reading the SERVER's
                         // answer for one account between the two halves
  '@mutates-email',      // commits a real email change; the four verification mails share ONE
                         // subject, so the recipient alias is all that tells them apart
  '@mutates-document',   // commits an irreversible agent decision
  '@promo-lifecycle',    // disables/backdates a real promo and restores it in an After hook
  '@promo-tools',        // same shared promos, same restore
  '@referral-codes',     // disables the referral agent's real promo and restores it
  '@subscription',       // one shared candidate account holding one subscription
  '@welcome-onboarding', // the zero-candidate fixture; an invite spends it permanently
  '@mutates-profile',    // edits the ONE Candidate Details fixture and restores it
  '@submits-request',    // raises a REAL support request; one Contact Us candidate
  '@shared-inbox',       // reads the shared IMAP inbox (Signup, Onboarding, Forgot-password)
  '@creates-accounts',   // signs up a real account over live email
  '@rotates-password',   // rotates a shared account's password and restores it; a failed
                         // restore locks the account out of every later scenario
  '@2fa',                // ONE account; scenarios toggle its 2FA and submit wrong OTPs/logins on
                         // purpose. Run in parallel (2026-10) they overlapped and the account was
                         // LOCKED ("Your account is locked. Please reset your password...").
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// playwright-bdd appends every tag to the test title, so a project-level grep can match a tag.
// The lookahead stops '@provision' matching a longer tag that merely starts with it.
const SERIAL_RE = new RegExp(`(?:${SERIAL_TAGS.map(escapeRe).join('|')})(?![\\w-])`);

/**
 * SERIALISE=1 (or --serialise) - put EVERYTHING in one lane, one scenario at a time, in file
 * order. Sets workers to 1 AND fullyParallel to false: either alone is not enough, because
 * scenarios inside one generated spec interleave under fullyParallel whatever the worker count.
 */
const SERIALISE = /^(1|true|yes)$/i.test(String(process.env.SERIALISE || ''));

// ---------------------------------------------------------------------------------------------
// Run knobs
// ---------------------------------------------------------------------------------------------

/**
 * How many workers the PARALLEL lane gets.
 *
 *   PARALLEL=3     -> exactly 3
 *   PARALLEL=50%   -> Playwright's percentage-of-cores form, passed through untouched
 *   PARALLEL=0     -> 1
 *   unset / junk   -> the profile's own preference, else `undefined` - which is NOT "one worker":
 *                     it hands the decision to Playwright (half the machine's CPU cores).
 *
 * Every worker drives the SAME shared staging app, and failed sign-ins are rate limited PER
 * ACCOUNT, so the practical ceiling is what that environment tolerates, not what this machine can
 * schedule.
 */
function resolveWorkers() {
  const raw = String(process.env.PARALLEL ?? '').trim();
  if (!raw) return undefined;
  if (/^\d+%$/.test(raw)) return raw;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n === 0 ? 1 : n;
}

const PARALLEL_WORKERS = resolveWorkers();
const LANE_WORKERS = PARALLEL_WORKERS !== undefined
  ? PARALLEL_WORKERS
  : (PROFILE && PROFILE.workers) || undefined;

/**
 * Headed or headless. Order:
 *   1. PWDEBUG set and not '0'/'false'   -> HEADED. Debugging is never headless.
 *   2. HEADED, then HEADLESS, AS SET BY THE CALLER
 *   3. HEADED, then HEADLESS, from .env  (this project's .env pins HEADED=true)
 *   4. nothing anywhere                  -> HEADED, which is what `npm test` has always done.
 * HEADED is this repo's own name, HEADLESS the Nxtstim one; `HEADLESS=0` and `HEADED=true` mean
 * the same thing. Headed + parallel means one visible window per worker - use --headless for speed.
 */
function resolveHeaded() {
  const set = (v) => v !== undefined && v !== '';
  const pwdebug = process.env.PWDEBUG;
  if (set(pwdebug) && pwdebug !== '0' && pwdebug !== 'false') return true;
  for (const env of [SHELL_ENV, process.env]) {
    if (set(env.HEADED)) return env.HEADED !== 'false';
    if (set(env.HEADLESS)) return env.HEADLESS === '0' || env.HEADLESS === 'false';
  }
  return true;
}

const HEADED = resolveHeaded();

// SLOWMO overrides the per-action delay in headed mode (default 50ms; 300-500ms is watchable).
// Ignored headless. An explicit SLOWMO=0 is honoured.
const slowMoRaw = process.env.SLOWMO === undefined || process.env.SLOWMO === ''
  ? null
  : Number(process.env.SLOWMO);
const SLOW_MO = HEADED ? (Number.isFinite(slowMoRaw) ? slowMoRaw : 50) : 0;

// One retry converts environment weather on the shared staging app into "flaky" (reported
// separately from "passed") and is what makes `trace: 'on-first-retry'` produce a trace. Never in
// the serial lane: a retry there re-spends what the scenario spent - a payment, a promo use, a
// permanent candidate, a university.
const RETRIES = process.env.CI ? 2 : 1;

module.exports = defineConfig({
  // Runs once per `playwright test` call: validates the environment and regenerates stale specs.
  // A config field rather than top-level code because bddgen also loads this file and needs none
  // of it.
  globalSetup: require.resolve('./globalSetup.js'),

  // The SCENARIO budget. Steps are also timed individually by fixtures/bdd.js (each step's own
  // `{ timeout }`, else 60s - Cucumber's default), and a long step raises this ceiling as it
  // starts, so a hung step still fails in its own time and names itself.
  timeout: 600_000,

  // Bounds a single click/fill/press. Without it an action inherits the scenario budget, which in
  // a MUI app full of invisible portal backdrops hides "something is layered over this button"
  // behind a ten-minute timeout.
  actionTimeout: 30_000,

  // One results folder PER LANE: each lane is its own `playwright test` call, and Playwright keeps
  // the list of failed tests (what --last-failed / `npm run test:rerun` reads) in this folder - so a
  // shared folder would let the serial call overwrite the parallel call's failures.
  outputDir: IDE_RUN
    ? '../test-results/ide'
    : (process.env.PW_LANE ? `../test-results/${process.env.PW_LANE}` : '../test-results/cli'),
  workers: SERIALISE ? 1 : LANE_WORKERS,

  use: {
    baseURL: process.env.BASE_URL,
    headless: !HEADED,
    launchOptions: { slowMo: SLOW_MO },
    // Playwright captures these for the scenario's own page. Extra contexts a feature opens by
    // hand (superadmin, invited agent) are recorded by utils/videoRecorder.js - see WorldFixture.
    screenshot: 'only-on-failure',
    video: process.env.VIDEO === 'on' ? 'on' : (process.env.VIDEO === 'off' ? 'off' : 'retain-on-failure'),
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'parallel',
      testDir,
      use: { ...devices['Desktop Chrome'] },
      ...(SERIALISE ? {} : { grepInvert: SERIAL_RE }),
      // playwright-bdd compiles a whole .feature into ONE spec, and Playwright only parallelises
      // across files by default - without this every scenario of a feature would share a worker.
      fullyParallel: !SERIALISE,
      retries: SERIALISE ? 0 : RETRIES,
    },
    {
      name: 'serial',
      testDir,
      use: { ...devices['Desktop Chrome'] },
      // Under SERIALISE the parallel lane already holds everything, so this one matches nothing.
      grep: SERIALISE ? /(?!)/ : SERIAL_RE,
      fullyParallel: false,
      workers: 1,
      retries: 0,
    },
  ],

  reporter: reporters(),
});

/**
 * The two lanes run as two separate `playwright test` calls (see run-playwright.js), and the HTML
 * reporter owns its whole output folder - so the second call would overwrite the first call's
 * report. Each call therefore writes a BLOB shard and the shards are merged into one HTML report:
 *
 *   PW_BLOB=<name>   one call of a multi-call run -> list + blob-report/<name>.zip
 *   (unset)          a single self-contained run  -> list + the HTML report directly
 */
function reporters() {
  // Same output as Nxtstim: Playwright's 'list' for LIVE progress (how many scenarios, which one is
  // running, a numbered line as each finishes), then configs/stepReporter.js at the end - PASSED /
  // FAILED banners with each scenario's [Verify] check lines, Expected / Actual for a failed check,
  // and the elapsed time.
  const verify = [require.resolve('./stepReporter.js')];
  const html = ['html', { outputFolder: IDE_RUN ? '../reports/playwright-report-ide' : '../reports/playwright-report', open: 'never' }];
  // The client/PM-facing PDF (reports/Test-Summary-Report.pdf), Nxtstim's pdfReportReporter in
  // this suite's shape - see configs/summaryReportReporter.js. Like the HTML report it is built
  // where the WHOLE run is visible: by the merge, or by a single self-contained run; never by one
  // lane on its own.
  const summary = [require.resolve('./summaryReportReporter.js'), { baseName: IDE_RUN ? 'Test-Summary-Report-ide' : 'Test-Summary-Report' }];
  // npm test runs the two lanes as separate calls and merges them; the summary is printed ONCE, by
  // the merge (it replays both lanes' results), so it covers the whole run.
  if (process.env.PW_MERGE) return [verify, html, summary];
  if (process.env.PW_BLOB) {
    return [['list'], ['blob', { outputDir: '../blob-report', fileName: `${process.env.PW_BLOB}.zip` }]];
  }
  return [['list'], verify, html, summary];
}

// Metadata for run-playwright.js, globalSetup.js and the selection stamp. Non-enumerable because
// Playwright validates the keys of the exported config object. `generation` is everything baked
// into the generated specs; when it changes, the specs on disk are stale and must be regenerated.
Object.defineProperty(module.exports, '__selection', {
  enumerable: false,
  value: {
    profile: PROFILE_NAME || null,
    listOnly: !!(PROFILE && PROFILE.listOnly),
    env: (PROFILE && PROFILE.env) || {},
    generation: JSON.stringify({ tags: GENERATION_TAGS, features: FEATURES }),
    outputDir: OUTPUT_DIR,
    serialTags: SERIAL_TAGS,
    serialise: SERIALISE,
    workers: SERIALISE ? 1 : LANE_WORKERS,
  },
});
