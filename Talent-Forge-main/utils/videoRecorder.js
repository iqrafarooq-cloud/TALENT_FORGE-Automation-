// Per-scenario video recording, the sibling of the failure screenshot in hooks.js.
//
// Playwright can only record video at CONTEXT-creation time (`recordVideo`), and the .webm
// is not finalized until the context closes — so a scenario cannot decide "record this one"
// after it starts failing. The suite therefore records every scenario into a temp folder and
// throws away the ones it doesn't need once the result is known. That is what
// `retain-on-failure` (the default) means here.
//
// Modes, via the VIDEO env var:
//   retain-on-failure (default) — record all, keep only failed scenarios' videos
//   on                          — keep every scenario's video
//   off                         — don't record at all (zero overhead)
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const VIDEO_DIR = path.join(REPORTS_DIR, 'videos');
// Playwright picks the raw file name itself (a random hash), so recordings land here and are
// renamed to the scenario name on the way out. Kept inside reports/ so it's gitignored.
const RAW_DIR = path.join(VIDEO_DIR, '.raw');

const MODES = ['off', 'on', 'retain-on-failure'];

function mode() {
  const raw = String(process.env.VIDEO || 'retain-on-failure').trim().toLowerCase();
  return MODES.includes(raw) ? raw : 'retain-on-failure';
}

const enabled = () => mode() !== 'off';

// Same sanitizer the screenshot path uses, so a failure's .png and .webm sit under matching
// names in reports/screenshots/ and reports/videos/.
function slug(name) {
  return String(name || 'scenario').replace(/[^\w-]+/g, '_').slice(0, 80);
}

/**
 * Merge `recordVideo` into browser.newContext() options. Use this EVERYWHERE a context is
 * created — a context built with a bare `newContext()` records nothing, so any extra session
 * a feature opens (superadmin, invited agent, provisioned candidate) would silently have no
 * video for the very failure you're trying to watch.
 */
function contextOptions(extra = {}) {
  if (!enabled()) return extra;
  fs.mkdirSync(RAW_DIR, { recursive: true });
  return {
    ...extra,
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
  };
}

/**
 * Register a page whose video should be kept/discarded with the scenario result.
 * `label` distinguishes the files when a scenario drove more than one session.
 * Returns the page so it can be chained.
 */
function track(world, page, label) {
  if (!enabled() || !world || !page) return page;
  if (!world._videoPages) world._videoPages = [];
  world._videoPages.push({ page, label });
  return page;
}

/**
 * Save or drop every tracked video. MUST be called AFTER all of the scenario's contexts are
 * closed — Playwright finishes writing the .webm on context close, and saveAs() on a live
 * context can stall. Returns the saved files (empty when discarding).
 */
async function collect(world, { keep, scenarioName }) {
  const tracked = (world && world._videoPages) || [];
  if (world) world._videoPages = [];
  const saved = [];
  if (!tracked.length) return saved;

  const base = slug(scenarioName);
  for (let i = 0; i < tracked.length; i++) {
    const { page, label } = tracked[i];
    let video = null;
    try {
      video = page.video();
    } catch {
      video = null; // page belonged to a context created without recordVideo
    }
    if (!video) continue;

    if (!keep) {
      await video.delete().catch(() => {});
      continue;
    }
    const suffix = tracked.length > 1 ? `-${label || i + 1}` : '';
    const file = `${base}${suffix}.webm`;
    try {
      fs.mkdirSync(VIDEO_DIR, { recursive: true });
      await video.saveAs(path.join(VIDEO_DIR, file));
      await video.delete().catch(() => {});
      saved.push(file);
    } catch (e) {
      console.warn(`Could not save video for "${scenarioName}": ${(e && e.message) || e}`);
    }
  }
  return saved;
}

/**
 * HTML markup for the saved videos, from the Cucumber-report era (it relied on a relative
 * `videos/...` path beside reports/cucumber-report.html). fixtures/WorldFixture.js now attaches the
 * .webm files themselves, which the Playwright report plays inline; this is kept for any caller
 * that still wants markup.
 * The stopPropagation wrapper keeps a click on the player from also opening the reporter's
 * info modal, which is what the surrounding div is wired to do.
 */
function reportHtml(files) {
  return files
    .map((file) => {
      const src = `videos/${encodeURIComponent(file)}`;
      return (
        `<div onclick="event.stopPropagation()">`
        + `&#9654; <a href="${src}" target="_blank" rel="noopener">${file}</a><br>`
        + `<video src="${src}" controls preload="metadata" width="640"></video>`
        + `</div>`
      );
    })
    .join('');
}

/**
 * Delete leftover raw recordings from an earlier run.
 *
 * Rarely needed now: configs/run-playwright.js clears the whole reports/videos folder (this RAW_DIR
 * included) before every run, so a killed run cannot leave raw clips behind for the next one.
 * Kept because it is the honest primitive for that job, and a caller outside the wrapper may want
 * it without wiping saved clips.
 */
function purgeRaw() {
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
}

module.exports = {
  mode,
  enabled,
  contextOptions,
  track,
  collect,
  reportHtml,
  purgeRaw,
  VIDEO_DIR,
  RAW_DIR,
};
