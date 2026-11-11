// The `world` fixture - a faithful stand-in for the Cucumber `World` that every one of this
// suite's 1,593 step definitions is written against.
//
// >>> THIS IS WHAT MAKES THE MIGRATION A ONE-LINE CHANGE PER STEP FILE.
//     playwright-bdd's cucumber-style steps (createBdd(test, { worldFixture: 'world' })) call
//     the step function with `this` bound to whatever this fixture resolves to - verified in
//     node_modules/playwright-bdd/dist/steps/styles/cucumberStyle.js, which registers
//     `fn: function (_fixtures, ...args) { return fn.call(this, ...args); }`. So a step body
//     that reads `this.page`, `this.pages.dashboard`, `this.attach(...)` or its own
//     `this._promoSnapshot` keeps working with NO edit at all, provided this object carries
//     the same surface the old CustomWorld did. That is the entire job of this file.
//
// WHAT IS DELIBERATELY DIFFERENT FROM features/support/world.js + hooks.js:
//   - `browser`, `context` and `page` come from Playwright's own fixtures instead of a
//     hand-launched browser. That is the point of the move: Playwright owns the lifecycle, so
//     it can run scenarios in parallel workers, and it attaches the screenshot / video / trace
//     for the scenario's own page itself (see the `use` block in configs/playwright.config.js).
//   - the failure screenshot is NOT taken here. Playwright's `screenshot: 'only-on-failure'`
//     already captures and attaches one, and taking a second would double the cost and put two
//     images in the report for one failure.
const { test: base } = require('./PagesFixture');
const video = require('../utils/videoRecorder');

// Head-room added on top of a step's own declared timeout when raising the SCENARIO budget.
// A step that asks for 300s must not be cut short at 300s by the scenario ceiling while the
// steps before it have already spent time.
const STEP_BUDGET_SLACK_MS = 15000;

class World {
  constructor({ page, context, browser, pages, testInfo }) {
    // ---- the surface features/support/world.js defined -------------------------------
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.pages = pages;

    // ---- runner handle, so the compat layer can reach Playwright ---------------------
    this.testInfo = testInfo;

    this._startedAt = Date.now();
    this._attachSeq = 0;
    this._pendingAttachments = [];
  }

  /**
   * Cucumber's `this.attach(data, mediaType)`, on top of Playwright's
   * `testInfo.attach(name, { body, contentType })`.
   *
   * Two things it must get right, both learned from how the suite actually calls it:
   *
   *   1. IT MUST NEVER THROW OR REJECT. 221 call sites attach EVIDENCE about a result - a
   *      promo snapshot, an email body, the accounts a row drove - and most of them do not
   *      `await`. An unawaited rejection would surface as an unhandled rejection and fail a
   *      scenario for a reason that has nothing to do with what it was asserting. Cucumber's
   *      attach was fire-and-forget too, so swallowing is the faithful behaviour, and the
   *      warning keeps a silent loss of evidence visible.
   *   2. NAMES MUST BE UNIQUE. Cucumber attachments are an ordered list with no names at all;
   *      Playwright keys them by name in the HTML report, so a fixed name would let the last
   *      attachment of a scenario hide every earlier one.
   */
  attach(data, mediaType) {
    const contentType = mediaType || 'text/plain';
    const name = `${attachmentLabel(contentType)}-${++this._attachSeq}`;
    const body = Buffer.isBuffer(data) ? data : String(data == null ? '' : data);
    const pending = Promise.resolve()
      .then(() => this.testInfo.attach(name, { body, contentType }))
      .catch((e) => {
        console.warn(`[world.attach] could not attach "${name}" (${contentType}): ${e.message}`);
      });
    this._pendingAttachments.push(pending);
    return pending;
  }

  /**
   * Make room in the SCENARIO budget for a step that declared its own Cucumber timeout.
   *
   * Cucumber timed each STEP; Playwright times the whole SCENARIO. fixtures/bdd.js still
   * enforces the per-step budget itself (so a hung step fails in its own time rather than
   * burning the scenario ceiling), but a legitimately long step - a live signup + IMAP verify,
   * a PayTabs redirect - also needs the scenario to still be alive when it finishes. This only
   * ever RAISES the ceiling, never lowers it, so it cannot shorten anything.
   */
  allowStepTimeout(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const needed = Date.now() - this._startedAt + ms + STEP_BUDGET_SLACK_MS;
    if (needed > this.testInfo.timeout) this.testInfo.setTimeout(needed);
  }

  /** True once the scenario has failed - the replacement for `scenario.result.status`. */
  get failed() {
    return this.testInfo.status === 'failed'
      || this.testInfo.status === 'timedOut'
      || !!this.testInfo.error;
  }

  /**
   * Runs after every feature's own `After` hooks (Playwright runs test.afterEach - which is
   * where playwright-bdd invokes scenario hooks - before tearing fixtures down), and before
   * Playwright closes the context. Both halves of that ordering are load-bearing; see below.
   */
  async _teardown() {
    // Drop route handlers BEFORE the context closes. Scenarios that stub API responses
    // (SubscriptionPage.stubGracePeriod, ChangePasswordPage.stubServerError) can still have a
    // route.fetch() in flight at teardown; closing the context under it throws "Request
    // context disposed" out of the route callback - which under Cucumber failed the NEXT
    // scenario's Before hook. unrouteAll swallows those in-flight handlers.
    if (this.page && !this.page.isClosed()) {
      await this.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    }
    if (this.context) {
      await this.context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    }

    // Videos for the EXTRA contexts a feature opened (superadmin, invited agent, provisioned
    // candidate). Playwright records the scenario's OWN page itself, but a context created by
    // hand from `world.browser` is outside its lifecycle, so those .webm files would otherwise
    // pile up unclaimed in reports/videos/.raw. Those contexts are closed by the feature's own
    // After hook, which has already run by now - and a .webm is only finalized once its
    // context has closed, which is why this is here and not earlier.
    if (video.enabled()) {
      const keep = this.failed || video.mode() === 'on';
      const files = await video
        .collect(this, { keep, scenarioName: this.testInfo.title })
        .catch(() => []);
      // Attach the .webm files THEMSELVES so they play inside reports/playwright-report. The old
      // reportHtml() snippet linked a relative `videos/...` path that only resolved next to the
      // Cucumber HTML report, so in the Playwright report it would be a broken player.
      for (const file of files || []) {
        await this.testInfo
          .attach(`video-${file}`, { path: require('node:path').join(video.VIDEO_DIR, file), contentType: 'video/webm' })
          .catch((e) => console.warn(`[world] could not attach video ${file}: ${e.message}`));
      }
    }

    // Attachments are queued rather than awaited at the call site, so the last of them can
    // still be in flight here. Awaiting them is what stops evidence being dropped on the floor
    // as the test object is finalized.
    await Promise.allSettled(this._pendingAttachments);
  }
}

function attachmentLabel(contentType) {
  if (contentType.startsWith('image/')) return 'screenshot';
  if (contentType === 'text/html') return 'video';
  if (contentType.startsWith('application/')) return 'data';
  return 'note';
}

const test = base.extend({
  world: async ({ page, context, browser, pages }, use, testInfo) => {
    const world = new World({ page, context, browser, pages, testInfo });
    await use(world);
    await world._teardown();
  },
});

module.exports = { test, World };
