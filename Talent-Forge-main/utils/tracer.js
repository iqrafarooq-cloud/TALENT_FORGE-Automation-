// Per-scenario Playwright TRACES - the sibling of videoRecorder.js and the failure screenshot.
//
// WHY THIS EXISTS ALONGSIDE VIDEO
// A video shows you what the screen looked like. A trace lets you interrogate it: every action
// with the DOM snapshot before and after it, the exact locator each step resolved to, every
// network request, the console, and the wall-clock gap between actions. When a step "passed but
// nothing happened" - the failure mode this suite has hit repeatedly, from the community crop
// modal to the profile form's 4-second upload progress - the video shows a blur and the trace
// shows the click landing on the wrong element.
//
// Open one with:  npx playwright show-trace reports/traces/<file>.zip
//
// MODES, via the TRACE env var (mirrors VIDEO deliberately, so one mental model covers both):
//   off               (default) - do not trace at all. Zero overhead.
//   retain-on-failure - trace everything, keep only failed scenarios' traces
//   on                - keep every scenario's trace
//
// DEFAULT IS OFF, unlike video's retain-on-failure. Tracing captures a DOM snapshot per action,
// so on this suite's UI-heavy scenarios a trace is an order of magnitude larger than the .webm
// and slows a headed run noticeably. It is a debugging tool you reach for, not a standing cost.
//
// >>> TRACING IS PER CONTEXT, NOT PER PAGE. That is the difference from videoRecorder, which
//     tracks pages. Several scenarios here open a SECOND context (the candidate's session
//     alongside the agent's, the superadmin's alongside the candidate's), and a context created
//     without start() traces nothing - silently. So start() must be called everywhere a context
//     is created, exactly as video.contextOptions() must be.
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const TRACE_DIR = path.join(REPORTS_DIR, 'traces');

const MODES = ['off', 'on', 'retain-on-failure'];

function mode() {
  const raw = String(process.env.TRACE || 'off').trim().toLowerCase();
  return MODES.includes(raw) ? raw : 'off';
}

const enabled = () => mode() !== 'off';

// Same sanitizer video and screenshots use, so a scenario's .png, .webm and .zip sit under
// matching names.
function slug(name) {
  return String(name || 'scenario').replace(/[^\w-]+/g, '_').slice(0, 80);
}

/**
 * Begin tracing on a context and register it for collection. Safe to call when tracing is off
 * (it does nothing) and safe to call twice on the same context (the second call is ignored).
 *
 * `label` distinguishes the contexts of a multi-session scenario in the saved file name, the
 * same way videoRecorder labels its pages ('main', 'candidate', 'agent').
 */
async function start(world, context, label = 'main') {
  if (!enabled() || !context) return context;
  if (!world._traceContexts) world._traceContexts = [];
  if (world._traceContexts.some((t) => t.context === context)) return context;

  try {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      // The action's own stack is what makes a trace navigable back to the step definition
      // that issued it - without it you get "click" with no idea which page object asked.
      sources: true,
      title: `${label}: ${world._traceTitle || 'scenario'}`,
    });
    world._traceContexts.push({ context, label });
  } catch (e) {
    // Never let a debugging aid fail a scenario. A trace that could not start is worth one
    // warning, not a red row.
    console.warn(`Could not start tracing (${label}): ${(e && e.message) || e}`);
  }
  return context;
}

/**
 * Stop every tracked context's trace and either save or discard it.
 *
 * Unlike video, this MUST run BEFORE the contexts are closed: tracing.stop() needs a live
 * context to write the archive from. Getting that order wrong loses the trace silently, which
 * is why it is stated here rather than left to the caller to remember.
 */
async function collect(world, { keep, scenarioName }) {
  const tracked = (world && world._traceContexts) || [];
  if (world) world._traceContexts = [];
  const saved = [];
  if (!tracked.length) return saved;

  const base = slug(scenarioName);
  for (let i = 0; i < tracked.length; i++) {
    const { context, label } = tracked[i];
    try {
      if (!keep) {
        await context.tracing.stop();
        continue;
      }
      const suffix = tracked.length > 1 ? `-${label || i + 1}` : '';
      const file = `${base}${suffix}.zip`;
      fs.mkdirSync(TRACE_DIR, { recursive: true });
      await context.tracing.stop({ path: path.join(TRACE_DIR, file) });
      saved.push(file);
    } catch (e) {
      console.warn(`Could not save trace for "${scenarioName}" (${label}): ${(e && e.message) || e}`);
    }
  }
  return saved;
}

/**
 * The line the report shows. Deliberately includes the command, because a .zip in a reports
 * folder tells nobody how to read it - and `show-trace` is not a well-known command.
 */
function reportText(files) {
  return (
    `Playwright trace (DOM snapshot per action, network, console):\n` +
    files.map((f) => `  npx playwright show-trace reports/traces/${f}`).join('\n')
  );
}

module.exports = { mode, enabled, start, collect, reportText, TRACE_DIR };
