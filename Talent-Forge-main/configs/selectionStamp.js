// The tag expressions the specs under .features-gen/ were generated FROM, recorded beside them.
//
// >>> WHY: bddgen FILTERS BY TAG AT GENERATION TIME, SO THE SELECTION IS BAKED INTO THE SPECS.
//
//     .features-gen/ holds only the scenarios the tag expression admitted when generation last
//     ran. globalSetup's staleness check compares FILE MTIMES - is any .feature, step or fixture
//     newer than the newest spec - which is exactly right for a code change and completely blind
//     to a changed environment variable.
//
//     Measured before this existed: `ALLOW=@doc-verification npx playwright test --list` reported
//     372 tests, the default selection, because the specs on disk had been generated without
//     ALLOW. The opt-in appeared to work, changed nothing, and reported a normal-looking number.
//     After a regeneration the same command reports 452. A knob that lies like that is worse than
//     one that errors, so the expressions are stamped and compared.
//
// Kept in .features-gen/ rather than reports/ or a temp dir because it describes precisely that
// directory's contents and must be deleted along with them - .features-gen/ is gitignored and
// regenerated wholesale, so a stamp left behind by a `rm -rf` of the specs would be worse than
// none at all.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// One stamp per generated tree - each profile generates into its own .features-gen/<profile>/.
const stampPath = () => path.join(require('./playwright.config.js').__selection.outputDir, '.selection-stamp.json');

// The shape compared. Only the tag expressions and the ALLOW set: anything else that changes the
// specs (a .feature edit, a step file) is already covered by the mtime check, and putting it here
// too would mean two mechanisms disagreeing about the same question.
// >>> ONLY THE GENERATION EXPRESSION BELONGS HERE.
//
//     The generation value is the profile's tag expression plus its feature list - the whole of
//     what decides which specs exist. SERIALISE and PARALLEL only change how many workers run them,
//     neither is baked into a spec, so stamping them would force a pointless regeneration.
function current() {
  // A cache hit - Playwright has already loaded this config by the time globalSetup runs, and
  // run-playwright.js loads it to read the projects. bddgen does not run either caller.
  const config = require('./playwright.config.js');
  const sel = config.__selection || {};
  return {
    generation: sel.generation || null,
  };
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(stampPath(), 'utf8'));
  } catch (e) {
    return null; // missing or unreadable both mean "cannot prove the specs match" - regenerate
  }
}

function write() {
  try {
    const STAMP = stampPath();
    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, JSON.stringify(current(), null, 2) + '\n');
  } catch (e) {
    // Non-fatal by design. Failing to record the stamp costs one unnecessary regeneration on the
    // next run, which is the safe direction; failing the run over it would not be.
    console.warn(`[playwright-bdd] could not write the selection stamp: ${e.message}`);
  }
}

/**
 * @returns {{stale: boolean, reason: string|null}} whether the generated specs were produced by a
 *   different tag expression than the one in force now.
 */
function check() {
  const now = current();
  const was = read();
  if (!was) return { stale: true, reason: 'no selection stamp beside the generated specs' };

  if (was.generation !== now.generation) {
    return {
      stale: true,
      reason: 'the generation tag expression changed since the specs were written '
        + `(was "${was.generation}", now "${now.generation}")`,
    };
  }
  return { stale: false, reason: null };
}

module.exports = { check, write, current, stampPath };
