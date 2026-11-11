// The BDD surface every step file imports: the Cucumber-style API (Given/When/Then, Before/After,
// `this` as the World, `{ timeout }`) served on top of playwright-bdd and Playwright's runner.
//
// >>> WHAT THIS FILE BUYS: A STEP FILE MIGRATES BY CHANGING ITS FIRST LINE AND NOTHING ELSE.
//
//       -const { Given, When, Then, After } = require('@cucumber/cucumber');
//       +const { Given, When, Then, After } = require('../fixtures/bdd');
//
//     Everything after that line - `async function () { this.page ... }`, `this.pages.x`,
//     `this.attach(...)`, `this._myScenarioState`, `{ timeout: 180000 }`, `dataTable.hashes()`,
//     `After({ tags: '@x' }, ...)` - keeps working as written. 25,317 lines of step code and
//     465 scenarios move without being rewritten, which is the only way a migration this size
//     can be trusted not to change what the suite asserts.
//
// >>> IT USED TO BE DUAL-MODE (Cucumber passthrough + this translation layer) while both runners
//     coexisted. Cucumber was removed on 2026-10-06, so only the translation layer is left.
//
// The translation layer forwards every call to playwright-bdd's own cucumber-style
// constructors. It only has to translate the three places where the two APIs genuinely differ,
// each documented at its own function:
//
//   1. PER-STEP TIMEOUTS. Cucumber's `{ timeout: N }` has no equivalent - playwright-bdd's
//      ProvidedStepOptions is `{ tags, arityCheck }` only, so an unhandled `{ timeout }` would
//      be silently dropped and 411 step definitions would quietly lose their budget.
//   2. THE HOOK `scenario` ARGUMENT. Cucumber passes a pickle; playwright-bdd passes fixtures.
//   3. `Status`. Read by the hooks that branch on pass/fail (values match Cucumber's).

module.exports = playwrightBdd();

function playwrightBdd() {
  const { createBdd, DataTable } = require('playwright-bdd');
  const { test } = require('./merge');

  const bdd = createBdd(test, { worldFixture: 'world' });

  const envStepTimeout = Number(process.env.BDD_STEP_TIMEOUT);
  const DEFAULT_STEP_TIMEOUT_MS = process.env.BDD_STEP_TIMEOUT !== undefined && Number.isFinite(envStepTimeout)
    ? envStepTimeout
    : 60000;

  // -------------------------------------------------------------------------------------------
  // 1. Per-step timeouts
  // -------------------------------------------------------------------------------------------

  /**
   * Cucumber timed each STEP. Playwright times the whole SCENARIO. Mapping one onto the other
   * needs BOTH halves, and dropping either one changes how the suite fails:
   *
   *   - The scenario ceiling is RAISED (world.allowStepTimeout) so a step that legitimately
   *     needs 300s - a live signup plus an IMAP verify, a PayTabs redirect - is not cut off by
   *     the scenario budget while the steps before it have already spent time.
   *   - The step's own budget is still ENFORCED here, by racing it against a timer. Without
   *     this, a hung step would run until the scenario ceiling instead of failing in its own
   *     time: `{ timeout: 60000 }` exists precisely so a step that hangs is reported in a
   *     minute rather than in ten, and so the failure names the STEP rather than the scenario.
   *     That is exactly what Cucumber did (its own step timeout is a Promise.race too), so
   *     enforcing it is the faithful choice as well as the fast one.
   */
  function callWithStepTimeout(invoke, timeout, pattern) {
    let timer;
    const running = (async () => invoke())();
    // If the guard wins the race, `running` is still pending and will settle unobserved.
    // Giving it a handled branch here is what stops that becoming an unhandled rejection that
    // fails an unrelated later scenario in the same worker.
    running.catch(() => {});
    const guard = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Step timed out after ${timeout}ms: ${describePattern(pattern)}`)),
        timeout,
      );
    });
    return Promise.race([running, guard]).finally(() => clearTimeout(timer));
  }

  function describePattern(pattern) {
    return pattern instanceof RegExp ? String(pattern) : `"${pattern}"`;
  }

  /**
   * Wrap a step function so it honours a Cucumber `{ timeout }`.
   *
   * >>> THE ARITY MUST BE PRESERVED. playwright-bdd registers `arity: fn.length` and compares
   *     it against the number of Cucumber-Expression parameters in the step text (see
   *     dist/steps/stepDefinition.js). A `function (...args)` wrapper reports 0, so every
   *     parameterised step - `{string}`, `{int}`, a data table - would fail generation with an
   *     arity mismatch against a step definition that is perfectly correct. Function.length is
   *     configurable, so it is restored explicitly rather than worked around by turning the
   *     check off: the check is worth keeping.
   */
  function withStepTimeout(fn, timeout, pattern) {
    // A step that declares no timeout gets Cucumber's default (60s - features/support/hooks.js
    // set it with setDefaultTimeout(60000), which overrode every profile's own value). Without
    // it a hung step would run until the 10-minute SCENARIO budget and the failure would name the
    // scenario, not the step. BDD_STEP_TIMEOUT overrides it; BDD_STEP_TIMEOUT=0 turns it off.
    if (!Number.isFinite(timeout) || timeout <= 0) timeout = DEFAULT_STEP_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) return fn;

    const wrapped = function (...args) {
      if (this && typeof this.allowStepTimeout === 'function') this.allowStepTimeout(timeout);
      return callWithStepTimeout(() => fn.apply(this, args), timeout, pattern);
    };
    Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
    return wrapped;
  }

  function wrapStepCtor(ctor) {
    return function step(pattern, ...rest) {
      const hasOptions = rest.length > 1;
      const options = (hasOptions ? rest[0] : null) || {};
      const fn = hasOptions ? rest[1] : rest[0];

      // `timeout` is ours to implement; anything else Cucumber accepted that playwright-bdd
      // also understands (`tags`, `arityCheck`) is passed through rather than swallowed.
      const { timeout, ...providedOptions } = options;
      const impl = withStepTimeout(fn, timeout, pattern);

      if (Object.keys(providedOptions).length) ctor(pattern, providedOptions, impl);
      else ctor(pattern, impl);

      // Cucumber returns nothing here, but playwright-bdd returns the function so one step can
      // be reused inside another. Returning the ORIGINAL (not the wrapper) is deliberate: a
      // reused step runs inside its caller's budget, and nesting a second race would make the
      // reused step's timeout fire against the wrong clock.
      return fn;
    };
  }

  // -------------------------------------------------------------------------------------------
  // 2. The hook `scenario` argument
  // -------------------------------------------------------------------------------------------

  const KEYWORDS = /^(Given|When|Then|And|But|\*)\s+/;

  /**
   * Build the `scenario` object a Cucumber hook expects, from what Playwright knows.
   *
   * Only the fields this suite's four scenario-arg hooks actually read are synthesised, and
   * each is a real value rather than a placeholder:
   *
   *   scenario.result.status  -> FAILED / PASSED, from testInfo. Read by the doc-verification
   *                              After hook to decide whether to keep a trace.
   *   scenario.pickle.name    -> the scenario title. Names trace files and labels the
   *                              AI-findings record.
   *   scenario.pickle.tags    -> `[{ name: '@tag' }]`. The welcome-onboarding, bulk-upload and
   *                              invite-candidate Before hooks map over `.name`, so the SHAPE
   *                              matters, not just the values.
   *   scenario.pickle.steps   -> `[{ text }]`. The invite-candidate Before hook matches step
   *                              TEXT to spot the one scenario that must stay on the
   *                              zero-candidate agent. playwright-bdd stores the text with its
   *                              keyword ("Given the agent ..."), so the keyword is stripped to
   *                              match what Cucumber put in `pickle.steps[].text`.
   */
  function cucumberScenario(bddContext, world) {
    const testInfo = (bddContext && bddContext.testInfo) || (world && world.testInfo) || {};
    const tags = (bddContext && bddContext.tags) || [];
    const steps = (bddContext && bddContext.bddTestData && bddContext.bddTestData.steps) || [];
    const failed = world && typeof world.failed === 'boolean'
      ? world.failed
      : testInfo.status === 'failed' || testInfo.status === 'timedOut' || !!testInfo.error;

    return {
      result: { status: failed ? Status.FAILED : Status.PASSED },
      pickle: {
        name: testInfo.title || '',
        tags: tags.map((name) => ({ name })),
        steps: steps.map((s) => ({
          text: String(s.textWithKeyword || '').replace(KEYWORDS, ''),
          textWithKeyword: s.textWithKeyword,
        })),
      },
      // Playwright's own handle, for anything written against the new runner directly.
      testInfo,
    };
  }

  /**
   * Wrap Before/After so the hook function receives a Cucumber `scenario`.
   *
   * >>> THE WRAPPER'S FIRST PARAMETER MUST BE A DESTRUCTURING PATTERN. playwright-bdd reads
   *     the fixtures a hook needs by parsing its parameter list, and
   *     dist/playwright/fixtureParameterNames.js THROWS - it does not fall back - when the
   *     first parameter is a plain identifier. `{ $bddContext }` is the right thing to ask for
   *     anyway: it is an auto-inject fixture, so naming it costs no fixture resolution, and it
   *     carries the tags, the step data and the testInfo the scenario object is built from.
   *
   * `this` needs no translation. playwright-bdd invokes hooks as `hook.fn.call(world, ...)`
   * against the same `$world` the steps get, so `this._promoNeedsRestore` in an After hook
   * still sees what a step set on it.
   */
  function wrapHookCtor(ctor) {
    return function hook(...args) {
      const fn = args[args.length - 1];
      const head = args.length > 1 ? args[0] : undefined;
      const impl = async function ({ $bddContext }) {
        return fn.call(this, cucumberScenario($bddContext, this));
      };
      if (head === undefined) ctor(impl);
      else ctor(head, impl);
      return fn;
    };
  }

  // -------------------------------------------------------------------------------------------
  // 3. Status
  // -------------------------------------------------------------------------------------------

  // Values match Cucumber's own (plain uppercase strings), so an existing
  // `scenario.result.status === Status.FAILED` comparison keeps working under either runner.
  const Status = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    PASSED: 'PASSED',
    SKIPPED: 'SKIPPED',
    PENDING: 'PENDING',
    UNDEFINED: 'UNDEFINED',
    AMBIGUOUS: 'AMBIGUOUS',
    FAILED: 'FAILED',
  });

  return {
    Given: wrapStepCtor(bdd.Given),
    When: wrapStepCtor(bdd.When),
    Then: wrapStepCtor(bdd.Then),
    Step: wrapStepCtor(bdd.Step),

    Before: wrapHookCtor(bdd.Before),
    After: wrapHookCtor(bdd.After),
    BeforeStep: wrapHookCtor(bdd.BeforeStep),
    AfterStep: wrapHookCtor(bdd.AfterStep),

    // Forwarded unchanged, but their SCOPE differs from Cucumber's and that is worth knowing
    // rather than discovering: playwright-bdd runs these once PER WORKER, not once per run.
    // With parallel workers that is the only coherent meaning - a browser or a shared client
    // has to be set up in the process that will use it - and it is what Playwright's own
    // beforeAll does. Nothing in this suite assumes single execution: the one AfterAll
    // (document-verification) collects leftover traces, which is per-worker work anyway.
    BeforeAll: bdd.BeforeAll,
    AfterAll: bdd.AfterAll,

    Status,
    DataTable,

    // Exported so a step file that wants a Playwright fixture directly (rather than the World)
    // can build its own createBdd against the same merged test.
    test,
    runner: 'playwright-bdd',
  };
}
