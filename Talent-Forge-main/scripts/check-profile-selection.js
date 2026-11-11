// check-profile-selection.js - WHICH SCENARIOS EACH PROFILE SELECTS, BY NAME.
//
// READ-ONLY. Parses feature files and evaluates each profile's own tag expression. It runs
// no tests, opens no browser and touches no account.
//
// >>> WHY THIS EXISTS. <<<
// Written for the 2026-09-01 merge of the AI-document-verification feature files into one,
// but it is not specific to that. Any Gherkin reorganisation - merging files, splitting
// them, moving a tag from feature level to scenario level - can silently change WHAT RUNS,
// and in this repo several profiles commit irreversible things: permanent document uploads,
// real agent decisions, a consumed university, live payments. A tag that moves up to
// feature level applies to every scenario in the file, so `-p docLifecycle` could go from
// selecting 10 scenarios to selecting all of them, and the only symptom would be a much
// longer run doing much more damage.
//
// >>> WHY BY NAME AND NOT BY COUNT. <<<
// Comparing totals is the weaker check and it passes on the mistake that matters most: if a
// merge drops one scenario and a tag change admits another, the count is unchanged and the
// selection is wrong. Comparing the SET OF SCENARIO NAMES catches that, and when it fails it
// says which scenarios appeared and which vanished.
//
// Usage:
//   node scripts/check-profile-selection.js --save before.json
//   ...make the change...
//   node scripts/check-profile-selection.js --compare before.json
//   node scripts/check-profile-selection.js                     # just print the selection
//   node scripts/check-profile-selection.js --profiles docVerify,docLifecycle
//
// Pick the comparison key with --by (name | line | tags) - see the note on KEY_BY below.
// For a RENAME use --by line, and take the snapshot immediately before renaming: anything
// that shifts line numbers afterwards (a new comment block is enough) invalidates it. --by
// tags survives both renames and line shifts and is the safest default for a mixed change.
//
// A Scenario Outline is reported once per EXAMPLE, named as cucumber names it, because that
// is what actually runs - an outline whose examples carry different tags can be partly
// selected, and reporting the outline once would hide that.
'use strict';

const fs = require('fs');
const path = require('path');

// The Gherkin parser and tag-expression library are playwright-bdd's OWN dependencies (Cucumber
// the runner is gone), and npm nests them under node_modules/playwright-bdd/. Resolving them from
// there means this script parses features with exactly the versions the generator uses, so the
// two cannot disagree about what a profile selects.
const BDD_DIR = path.dirname(require.resolve('playwright-bdd/package.json'));
const fromBdd = (name) => require(require.resolve(name, { paths: [BDD_DIR] }));
const { Parser, AstBuilder, GherkinClassicTokenMatcher } = fromBdd('@cucumber/gherkin');
const { IdGenerator } = fromBdd('@cucumber/messages');
// The package exports { default, parse }; the callable parser is `parse` (`default` is the
// same function under an ESM interop shim). Destructuring is the form that works from CJS.
const { parse: tagExpressionParser } = fromBdd('@cucumber/tag-expressions');

const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// What identifies a scenario in the comparison. Three modes, because each is blind to exactly
// what another catches - pick the one whose blind spot your change cannot hit.
//
//   name  (default)  Right for a MERGE or a file move: proves no scenario was lost. Useless
//                    for a rename, which makes every entry look deleted-and-re-added.
//   line             Right for a RENAME: renaming in place changes no line numbers, so
//                    file:line identifies each scenario exactly. Useless once anything shifts
//                    the lines - adding a comment block is enough.
//   tags             Right for ANYTHING: immune to both renames and line shifts, because tags
//                    are what a profile actually selects on. Compared as a MULTISET, so two
//                    scenarios with identical tag sets still count twice. This is the mode to
//                    reach for when a change touches names AND positions.
const KEY_BY = arg('--by', 'name');
if (!['name', 'line', 'tags'].includes(KEY_BY)) {
  console.error(`--by must be "name", "line" or "tags", got "${KEY_BY}"`);
  process.exit(1);
}

// Every .feature under features/, so a profile with no `paths` is evaluated over the same
// set Playwright generates from (configs/playwright.config.js: features/**/*.feature).
function featureFiles(dir = path.join(ROOT, 'features')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...featureFiles(full));
    else if (entry.name.endsWith('.feature')) out.push(full);
  }
  return out.sort();
}

// Parse one file into a flat list of runnable scenarios with their EFFECTIVE tags.
//
// Effective tags are feature + scenario + (for an outline) the Examples block's own tags.
// Getting that union right is the whole point of the script: it is precisely the thing a
// feature-level tag change alters.
function scenariosIn(file) {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  const doc = parser.parse(fs.readFileSync(file, 'utf8'));
  if (!doc.feature) return [];
  const featureTags = doc.feature.tags.map((t) => t.name);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const out = [];

  const walk = (children) => {
    for (const child of children) {
      if (child.rule) {
        // Rule blocks nest scenarios and carry tags of their own.
        const ruleTags = (child.rule.tags || []).map((t) => t.name);
        walk(
          child.rule.children.map((c) =>
            c.scenario ? { scenario: { ...c.scenario, _inheritedTags: ruleTags } } : c
          )
        );
        continue;
      }
      if (!child.scenario) continue;
      const sc = child.scenario;
      const own = sc.tags.map((t) => t.name).concat(sc._inheritedTags || []);
      const examples = sc.examples || [];
      if (!examples.length) {
        out.push({ file: rel, line: sc.location.line, name: sc.name, tags: [...featureTags, ...own] });
        continue;
      }
      // One entry per example row - that is what runs.
      for (const ex of examples) {
        const exTags = (ex.tags || []).map((t) => t.name);
        for (const row of (ex.tableBody || [])) {
          out.push({
            file: rel,
            line: row.location.line,
            name: sc.name,
            tags: [...featureTags, ...own, ...exTags],
          });
        }
      }
    }
  };
  walk(doc.feature.children);
  return out;
}

function selectionFor(profileName, profile, all) {
  // The same expression configs/playwright.config.js generates from: the profile's tags ANDed with
  // NEVER_RUN (except for a list-only profile), so this reports what Playwright will actually run.
  const NEVER_RUN = 'not @not-automatable and not @not-implemented';
  const expr = tagExpressionParser(profile.listOnly ? (profile.tags || '') : `(${NEVER_RUN}) and (${profile.tags || 'not @__none__'})`);
  // A profile's `paths` narrows which files it looks at; without one it sees everything.
  const paths = profile.paths || null;
  const inScope = (s) =>
    !paths ||
    paths.some((p) => {
      const norm = p.replace(/\\/g, '/');
      return s.file === norm || s.file.startsWith(norm.replace(/\/$/, '') + '/');
    });
  return all
    .filter(inScope)
    .filter((s) => expr.evaluate(s.tags))
    .map((s) => {
      if (KEY_BY === 'line') return `${s.file}:${s.line}`;
      if (KEY_BY === 'tags') return [...s.tags].sort().join(' ');
      return s.name;
    })
    .sort();
}

const { PROFILES: config } = require(path.join(ROOT, 'configs', 'profiles.js'));
const wanted = arg('--profiles');
const profileNames = (wanted ? wanted.split(',') : Object.keys(config)).map((s) => s.trim());

const all = [];
for (const f of featureFiles()) {
  try {
    all.push(...scenariosIn(f));
  } catch (e) {
    console.error(`could not parse ${path.relative(ROOT, f)}: ${e.message}`);
    process.exitCode = 1;
  }
}

const snapshot = {};
for (const name of profileNames) {
  const profile = config[name];
  if (!profile) {
    console.error(`no profile named "${name}" in configs/profiles.js`);
    process.exitCode = 1;
    continue;
  }
  snapshot[name] = selectionFor(name, profile, all);
}

const savePath = arg('--save');
const comparePath = arg('--compare');

if (comparePath) {
  const before = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  let differences = 0;
  for (const name of Object.keys({ ...before, ...snapshot })) {
    const a = before[name] || [];
    const b = snapshot[name] || [];
    const gone = a.filter((x) => !b.includes(x));
    const added = b.filter((x) => !a.includes(x));
    if (!gone.length && !added.length) {
      console.log(`  OK    ${name.padEnd(24)} ${b.length} scenario(s), unchanged`);
      continue;
    }
    differences += 1;
    console.log(`  DIFF  ${name.padEnd(24)} ${a.length} -> ${b.length}`);
    for (const x of gone) console.log(`          NO LONGER SELECTED: ${x}`);
    for (const x of added) console.log(`          NEWLY SELECTED:     ${x}`);
  }
  console.log(
    differences
      ? `\n${differences} profile(s) changed which scenarios they select. Every one is either ` +
          'intended or a bug - decide which, per line above.'
      : '\nEvery profile selects exactly the same scenarios as before. Nothing was lost or gained.'
  );
  if (differences) process.exitCode = 2;
} else {
  for (const name of profileNames.filter((n) => snapshot[n])) {
    console.log(`${name}: ${snapshot[name].length}`);
    // --print lists each selected scenario (keyed per --by) - used for the list-only
    // notAutomatable profile, whose 'pending' stub steps playwright-bdd cannot generate at all.
    if (process.argv.includes('--print')) for (const key of snapshot[name]) console.log(`  ${key}`);
  }
}

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(snapshot, null, 1));
  console.log(`\nsaved selection for ${Object.keys(snapshot).length} profile(s) -> ${savePath}`);
}
