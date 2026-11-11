// >>> GUARDS AGAINST THE ONE WAY playwright-bdd CAN SILENTLY DROP COVERAGE.
//
// Under Cucumber every tag in this suite is inert unless a profile filters on it: tags are how
// scenarios are SELECTED, never how they behave. playwright-bdd is different. It reserves a set
// of tags as EXECUTION DIRECTIVES and acts on them at generation time
// (node_modules/playwright-bdd/dist/generate/specialTags.js):
//
//   @skip, @fixme     the scenario is not run at all
//   @only             every other scenario in that file is not run
//   @fail             the scenario is expected to fail; passing becomes a failure
//   @slow             triples the scenario's timeout
//   @retries:<n>      overrides the retry count
//   @timeout:<ms>     overrides the scenario timeout
//   @mode:<m>         default | parallel | serial
//
// This suite already uses two of those names DESCRIPTIVELY, which is exactly the collision worth
// catching: features/Agent_Portal/Onboarding.feature tags a scenario `@skip @positive` because
// the scenario is about a user who SKIPS every onboarding step, and Forgot-password.feature tags
// one `@slow` because it is slow. Neither is asking to be skipped or re-timed. Under Cucumber
// both run normally; under playwright-bdd the first would silently not run - a green report with
// one fewer scenario in it, and nothing anywhere saying so.
//
// EXIT CODE, AND WHY IT IS SPLIT.
//   - A SELECTION tag (@skip/@fixme/@only/@fail) on a MIGRATED feature is fatal: it changes
//     WHICH scenarios run, which is silent coverage loss.
//   - A TIMING tag (@slow/@retries/@timeout/@mode) is reported but not fatal: it changes how a
//     scenario runs, not whether, and a longer timeout is rarely the wrong answer.
//   - Anything on a not-yet-migrated feature is advisory, so this can be run today to see what
//     the rest of the rollout will have to deal with.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const SELECTION_TAGS = ['@skip', '@fixme', '@only', '@fail'];
const TIMING_TAGS = [/^@slow$/i, /^@retries:\d+$/i, /^@timeout:[\d_]+$/i, /^@mode:(default|parallel|serial)$/i];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.feature')) out.push(full);
  }
  return out;
}

const findings = { fatal: [], timing: [], advisory: [] };

for (const file of walk(path.join(ROOT, 'features'))) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // Every feature file is generated since Cucumber was removed (2026-10-06), so every finding
  // counts - there is no longer an unregistered, advisory-only set.
  const isMigrated = true;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('@')) return;
    for (const tag of trimmed.split(/\s+/).filter((t) => t.startsWith('@'))) {
      const selection = SELECTION_TAGS.includes(tag.toLowerCase());
      const timing = TIMING_TAGS.some((re) => re.test(tag));
      if (!selection && !timing) continue;
      const at = `${rel}:${i + 1}`;
      const entry = `${at}  ${tag}`;
      if (selection && isMigrated) findings.fatal.push(entry);
      else if (selection) findings.advisory.push(entry);
      else findings.timing.push(entry + (isMigrated ? '' : '   (not yet migrated)'));
    }
  });
}

const report = (label, items) => {
  if (!items.length) return;
  console.log(`\n${label}`);
  for (const item of items) console.log(`  ${item}`);
};

if (!findings.fatal.length && !findings.timing.length && !findings.advisory.length) {
  console.log('check-special-tags: no playwright-bdd special tags found in any .feature file.');
  process.exit(0);
}

report('FATAL - a selection tag on a MIGRATED feature. These scenarios will NOT RUN:', findings.fatal);
report('Reported - timing tags. These change how a scenario runs, not whether it does:', findings.timing);
report('Advisory - selection tags on features not yet migrated. Resolve before migrating them:', findings.advisory);

console.log(
  '\nplaywright-bdd treats these tags as execution directives, not as labels. If a tag here is'
  + '\nmeant descriptively, rename it (e.g. @skip -> @skip-all-steps, @slow -> @long-running):'
  + '\nnothing in cucumber.js or the Playwright config filters on any of them, so a rename costs'
  + '\nnothing and removes the collision.',
);

process.exit(findings.fatal.length ? 1 : 0);
