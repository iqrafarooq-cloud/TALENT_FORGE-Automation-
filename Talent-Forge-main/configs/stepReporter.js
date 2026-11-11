// End-of-run summary in the same shape as Nxtstim's configs/verifyLogReporter.ts:
//
//   ================================================================================
//     PASSED SCENARIOS - [Verify] assertion logs (2 passed)
//   ================================================================================
//
//     PASSED: Verify that the profile header shows the candidate's identity on every listing
//       at features/Agent_Portal/candidate-view-profile.feature:39
//       --------------------------------------------------------------------------
//       [Verify] ✓ each profile header should render the avatar band above ...
//       [Verify] ✓ each profile header should show the name, status and location ...
//
//   ================================================================================
//     FAILED SCENARIOS - [Verify] assertion logs (1 failed)
//   ================================================================================
//
//     X FAILED: Verify that ...
//       [Verify] ✘ the URL should contain the filter "lastActivity=7days"
//                Expected: "lastActivity=7days"
//                Actual:   "activeFilter=all"
//
//   ================================================================================
//     Elapsed time: 2m 14s
//   ================================================================================
//
// Nxtstim's steps print hand-written `[Verify] ... Expected: ... Actual: ...` lines. These steps
// do not, so a scenario's [Verify] lines are its CHECKS: every Then step and the And/But steps
// that follow it (Given/When steps are setup and actions, not verifications). A failed check
// carries the Expected / Actual values out of the assertion's own error. Any real `[Verify]` line
// a step does print is included as well.
//
// Live progress - "Running N tests using M workers" and one numbered line per scenario as it
// runs - comes from Playwright's own 'list' reporter, which runs beside this one.
const fs = require('node:fs');
const path = require('node:path');

const BANNER = '='.repeat(80);
const ANSI = /\x1b\[[0-9;]*m/g;
const KEYWORD = /^(Given|When|Then|And|But|\*)\s+/;
const clean = (s) => String(s || '').replace(ANSI, '');
const ROOT = path.join(__dirname, '..');

class VerifyLogReporter {
  constructor() {
    this.byTest = new Map();
  }

  printsToStdout() {
    return true;
  }

  onTestEnd(test, result) {
    // The LAST attempt is the verdict, so a retry overwrites the first attempt's record.
    this.byTest.set(test.id, { test, result, lines: verifyLines(result) });
  }

  onEnd(result) {
    const all = [...this.byTest.values()];
    const passed = all.filter(({ test }) => ['expected', 'flaky'].includes(test.outcome()));
    const failed = all.filter(({ test }) => test.outcome() === 'unexpected');

    if (passed.length || failed.length) {
      section(`PASSED SCENARIOS - [Verify] assertion logs (${passed.length} passed)`);
      for (const s of passed) block('PASSED', s);
      if (!passed.length) console.log('\n  (none)');

      section(`FAILED SCENARIOS - [Verify] assertion logs (${failed.length} failed)`);
      for (const s of failed) block('FAILED', s);
      if (!failed.length) console.log('\n  (none)');
    }

    console.log('');
    console.log(BANNER);
    console.log(`  ${passed.length} passed, ${failed.length} failed`
      + `${all.length - passed.length - failed.length ? `, ${all.length - passed.length - failed.length} skipped` : ''}`
      + `   |   Elapsed time: ${elapsed(result.duration)}`);
    console.log(BANNER);
  }
}

function section(title) {
  console.log('');
  console.log(BANNER);
  console.log(`  ${title}`);
  console.log(BANNER);
}

function block(status, { test, result, lines }) {
  const flaky = test.outcome() === 'flaky' ? ' (passed on retry)' : '';
  console.log('');
  console.log(`  ${status === 'FAILED' ? 'X FAILED' : 'PASSED'}: ${title(test)}${flaky}`);
  console.log(`    at ${featureLocation(test)}`);
  console.log(`    ${'-'.repeat(74)}`);
  if (!lines.length) {
    console.log(status === 'FAILED'
      ? '    (it failed before reaching any check)'
      : '    (no checks - this scenario has no Then step)');
  }
  for (const l of lines) console.log(`    ${l}`);
  // A failure outside any step (a hook, a fixture, the scenario timeout) still needs saying.
  if (status === 'FAILED' && !lines.some((l) => l.includes('✘')) && result.error) {
    for (const l of errorLines(result.error)) console.log(`    ${l}`);
  }
}

// The scenario's checks, in order, plus any real [Verify] lines it printed.
function verifyLines(result) {
  const lines = [];
  const steps = [];
  collectSteps(result.steps, steps);
  let inThen = false;
  for (const s of steps) {
    const kw = (s.title.match(KEYWORD) || [])[1];
    if (kw === 'Then') inThen = true;
    else if (kw === 'Given' || kw === 'When') inThen = false;
    // A failed setup or action step is reported too - otherwise a scenario that died in its
    // When would show no reason at all in its block.
    if (!inThen && !s.error) continue;
    const text = s.title.replace(KEYWORD, '');
    lines.push(`[Verify] ${s.error ? '✘' : '✓'} ${text}`);
    if (s.error) for (const l of errorLines(s.error)) lines.push(`         ${l}`);
  }
  for (const chunk of [...result.stdout, ...result.stderr]) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    for (const l of text.split(/\r?\n/)) if (l.trim().startsWith('[Verify]')) lines.push(l.trim());
  }
  return lines;
}

function collectSteps(steps, out) {
  for (const s of steps || []) {
    if (s.category === 'test.step' && KEYWORD.test(s.title)) out.push(s);
    else collectSteps(s.steps, out);
  }
}

// The error headline plus its Expected / Actual pair, or this suite's "- <problem>" detail lines.
function errorLines(error) {
  const lines = clean(error.message || error.value || '').split('\n').map((l) => l.trim());
  const head = lines.find(Boolean) || 'failed';
  const out = [head.slice(0, 300)];
  for (const t of lines) {
    if (/^Expected( pattern| substring| value| length)?:/i.test(t)) out.push(`Expected: ${t.replace(/^Expected[^:]*:\s*/i, '')}`);
    else if (/^Received( string| value| length)?:/i.test(t)) out.push(`Actual:   ${t.replace(/^Received[^:]*:\s*/i, '')}`);
    else if (/^[-•]\s/.test(t) && t !== head) out.push(t.slice(0, 300));
  }
  return out.slice(0, 12);
}

const title = (test) => test.title.replace(/\s@\S+/g, '');

// The generated spec's location is not useful to a reader; point at the .feature line instead.
function featureLocation(test) {
  const spec = (test.location && test.location.file) || '';
  const m = spec.replace(/\\/g, '/').match(/\.features-gen\/[^/]+\/(features\/.+\.feature)\.spec\.js$/);
  if (!m) return spec;
  const feature = m[1];
  try {
    const name = title(test).replace(/^Example #\d+$/, '');
    const lines = fs.readFileSync(path.join(ROOT, feature), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => /^\s*Scenario( Outline)?:/.test(l) && l.includes(name));
    return i >= 0 ? `${feature}:${i + 1}` : feature;
  } catch (e) {
    return feature;
  }
}

function elapsed(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${s}s`;
}

module.exports = VerifyLogReporter;
