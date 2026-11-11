# TALENT_FORGE-Automation-
 ▎ Learning and talent platform where candidates track courses, assessments and certifications, with separate Super Admin and Agent portals.


# TalentForge Automation — Playwright + playwright-bdd (POM, JavaScript)

BDD scenarios written in Gherkin, compiled by **playwright-bdd** and run by **Playwright's own
test runner**. Plain JavaScript (CommonJS), Page Object Model. Cucumber is not used as a runner
(it was removed on 2026-10-06); the `.feature` files and step definitions are unchanged.

## Project structure

The same shape as the Nxtstim automation, in JavaScript:

```
features/            .feature files (Gherkin), grouped by portal/area
steps/               step definitions, one file per area
pages/               page objects (BasePage + one per screen)
fixtures/            Playwright fixtures
  bdd.js             Given/When/Then/Before/After - the Cucumber-style API on playwright-bdd
  PagesFixture.js    `pages` - every page object, built per scenario
  WorldFixture.js    `world` - `this` inside a step (page, context, pages, attach, ...)
  merge.js           mergeTests entry point the generated specs import
utils/               helpers (IMAP inbox, provisioning, PDF/receipt readers, ...)
test-data/           static test data
configs/
  playwright.config.js   defineBddConfig + two projects: 'parallel' and 'serial'
  profiles.js            named selections (tag expression + optional paths)
  run-playwright.js      the entry point every `npm test*` script calls
  globalSetup.js         env check + regenerates stale specs
scripts/             probes and fixture-provisioning tools (not part of a run)
.features-gen/       GENERATED Playwright specs - never edit, gitignored
reports/             playwright-report/ (HTML) and run artifacts
```

### How Nxtstim's structure maps onto this repo

| Nxtstim | here |
| --- | --- |
| `features/Parallel/**` -> project `chromium` | scenarios **without** a serial tag -> project `parallel` (fully parallel) |
| `features/Serial/**` -> project `chromium-serial` | scenarios **with** a serial tag (`@provision`, `@mutates-*`, `@subscription`, ...) -> project `serial` (one worker, no retries) |
| `npm test` = one `playwright test` call per project | same: parallel lane, then serial lane, merged into one HTML report |
| `steps/*.ts` with `createBdd(test)` | `steps/*.js` via `fixtures/bdd.js` |
| `fixtures/*Fixture.ts` + `merge.ts` | `fixtures/PagesFixture.js`, `WorldFixture.js`, `merge.js` |

The split is by **tag**, not folder, because several feature files mix read-only scenarios with
ones that spend something unrecoverable (a payment, a university, a permanent candidate). The
serial tag list, with the reason for each, is `SERIAL_TAGS` in `configs/playwright.config.js`.

## Setup

```bash
npm install
npx playwright install chromium
```

Credentials and fixtures live in `.env` (not committed). `BASE_URL` is required.

## Run tests

```bash
npm test                         # the default selection (excludes everything unrecoverable)
npm run test:dashboard           # one area - every area has a test:* script, see package.json
npm test -- --list               # what would run, without running it
npm test -- features/Auth/Login.feature            # one file
npm test -- features/Auth/Login.feature:42         # one scenario, by its line in the .feature
npm test -- --name "Verify that a disabled promo"  # by scenario name (regex)
npm test -- --tags "@known-issue and not @provision"   # ANDed with the profile's tags
npm run test:only -- <path>      # run exactly what you name, costly scenarios included
npm run test:rerun               # only what failed last time
npm run test:report              # open reports/playwright-report
```

Knobs (set in the shell; a value you set beats `.env`):

| | |
| --- | --- |
| `--headless` / `--headed`, or `HEADED=false` / `HEADLESS=1` | browser visibility (headed by default) |
| `--workers 3` or `PARALLEL=3` | workers for the parallel lane (default: half the CPU cores) |
| `--serialise` or `SERIALISE=1` | everything one at a time, in file order |
| `SLOWMO=400` | per-action delay when headed |
| `VIDEO=on|off` | video for every scenario / none (default: kept on failure) |
| `KEEP_PREVIOUS_REPORTS=1` | archive the previous report instead of replacing it |
| `BDD_STEP_TIMEOUT=120000` | default per-step budget (60s; a step's own `{ timeout }` wins) |

PowerShell: `$env:HEADED='false'; npm test`. Bash: `HEADED=false npm test`.

### Profiles

`configs/profiles.js` holds every named selection (formerly `cucumber.js` profiles): a Cucumber
tag expression plus optional feature paths. `npm test -- --profile <name>` runs one;
`npm run check:profiles` prints how many scenarios each selects.

### Running from VS Code

Use the **Playwright Test for VSCode** extension. It lists the generated specs under
`.features-gen/all/` - run `npm run gen` once if the Testing panel is empty. Runs started from the
editor use no profile, so **every** runnable scenario is available, including the costly ones.

## Reports

`reports/playwright-report/index.html` - every scenario with its steps, failure screenshot,
video and (on retry) trace. Open it with `npm run test:report`. Document-verification runs also
write `reports/ai-verification-findings.md`.
