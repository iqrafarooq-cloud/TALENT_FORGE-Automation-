// Central place to combine every fixture-defining `test` into the single `test` that step
// files and the generated specs import. Add a new fixture file as another argument to
// mergeTests() rather than chaining .extend() by hand.
//
// >>> THIS FILE'S PATH IS PART OF THE BUILD. playwright-bdd writes
//     `import { test } from "<this file>"` into every generated spec under .features-gen/, so
//     renaming or moving it invalidates the whole generated tree until `npm run gen` is re-run.
//
// Today there are two fixture layers and they are a CHAIN, not two independent sets:
//   PagesFixture  -> `pages`, the 19 page objects hooks.js used to wire onto `this.pages`
//   WorldFixture  -> `world`, the Cucumber World stand-in, which consumes `pages`
// WorldFixture extends PagesFixture's test directly, so the dependency resolves through the
// chain rather than through the merge. mergeTests is still the entry point because that is
// where a genuinely independent fixture (an API client, a seeded-data fixture) should be
// added, and doing it here keeps every step file's import stable.
const { mergeTests } = require('@playwright/test');
const { test: worldTest } = require('./WorldFixture');

const test = mergeTests(worldTest);

module.exports = { test };
