// The client/PM-facing summary of ONE run, as a PDF: reports/Test-Summary-Report.pdf (plus the
// same document as reports/Test-Summary-Report.html, and the data it was built from as
// reports/summary-report-data.json). Modelled on Nxtstim's configs/pdfReportReporter.ts - same
// layout: header + executive summary, stat cards, a pass-rate donut, a per-area bar chart, one
// card per failure (the step it failed at and plain-English reasons), and the full scenario list.
//
// WHERE IT RUNS, AND WHY THAT KEEPS IT TO ONE RUN. `npm test` runs the parallel and serial lanes
// as two `playwright test` calls and then merges their blob shards (configs/run-playwright.js).
// This reporter is attached to that MERGE (PW_MERGE) - which replays both lanes' results - and to
// a single self-contained run (VS Code, `--list`-free direct runs); never to a lane on its own.
// So it always sees the whole run and nothing else, and needs none of the on-disk store Nxtstim
// keeps to stitch four separate invocations together (a store that, here, would mix runs and
// break "reports/ describes exactly ONE run").
//
// WHAT IS SPECIFIC TO THIS SUITE.
//   - @known-issue scenarios fail ON PURPOSE (they assert the right behaviour against a product
//     defect). The report separates them from new failures, because "8 failed" means nothing to a
//     reader who cannot tell the expected reds from a regression. A @known-issue scenario that
//     PASSED is called out too: its tag is stale and is now hiding the moment it breaks again.
//   - Credentials never reach the document: JWTs, presigned-URL signatures and password fields are
//     redacted from every reason, and stack traces / "Call log:" dumps are cut off.
//
// A failure to render is logged and swallowed: the report is a convenience on top of the run and
// must never change its exit code.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const MAX_REASONS = 6;
const KEYWORD = /^(Given|When|Then|And|But|\*)\s+/;
const ANSI = /\x1b\[[0-9;]*m/g;

class SummaryReportReporter {
  constructor(options = {}) {
    this.baseName = options.baseName || 'Test-Summary-Report';
    this.byTest = new Map();
    this.startedAt = new Date();
  }

  printsToStdout() {
    return true;
  }

  onBegin() {
    this.startedAt = new Date();
  }

  onTestEnd(test, result) {
    // The LAST attempt decides the verdict, so a retry overwrites the first attempt.
    this.byTest.set(test.id, { test, result });
  }

  async onEnd(result) {
    const scenarios = [...this.byTest.values()].map(({ test, result: r }) => toRecord(test, r));
    if (!scenarios.length) return;
    const run = runDetails(result, scenarios, this.startedAt);
    const data = { run, scenarios };
    const pdf = path.join(REPORTS_DIR, `${this.baseName}.pdf`);
    try {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(REPORTS_DIR, 'summary-report-data.json'), JSON.stringify(data, null, 2));
      await renderReport(data, path.join(REPORTS_DIR, this.baseName));
      console.log(`\n[Summary Report] ${path.relative(ROOT, pdf)}  (npm run test:report:pdf)`);
    } catch (e) {
      console.log(`\n[Summary Report] could not be generated: ${e.message}\n  (this does not affect the run's result)`);
    }
  }
}

// ==================== Records ====================

function toRecord(test, result) {
  const tags = testTags(test);
  const knownIssue = tags.includes('@known-issue');
  const outcome = test.outcome();
  let status;
  if (outcome === 'skipped') status = 'skipped';
  else if (outcome === 'unexpected') status = knownIssue ? 'known-issue' : 'failed';
  else status = outcome === 'flaky' ? 'flaky' : 'passed';
  const { portal, feature } = location(test);
  const record = {
    title: test.title.replace(/\s@\S+/g, '').trim(),
    portal,
    area: feature,
    status,
    staleKnownIssue: knownIssue && (outcome === 'expected' || outcome === 'flaky'),
    tags,
    file: featureFile(test),
    durationMs: result.duration,
    lane: test.parent.project() ? test.parent.project().name : '',
  };
  if (status === 'failed' || status === 'known-issue') {
    record.failedStep = failedStep(result.steps);
    record.reasons = reasons(result);
  }
  return record;
}

function testTags(test) {
  const fromApi = Array.isArray(test.tags) ? test.tags : [];
  const fromTitle = test.title.match(/@[\w-]+/g) || [];
  return [...new Set([...fromApi, ...fromTitle])];
}

// The feature title is the OUTERMOST describe (a Rule is a describe inside it); the portal is the
// folder under features/ ("Agent_Portal" -> "Agent Portal").
function location(test) {
  let suite = test.parent;
  let feature = '';
  while (suite) {
    if (suite.type === 'describe') feature = suite.title;
    suite = suite.parent;
  }
  const segs = featureFile(test).split('/');
  const i = segs.indexOf('features');
  const portal = (i >= 0 && segs[i + 1] && !/\.feature/.test(segs[i + 1]) ? segs[i + 1] : 'Other')
    .replace(/_/g, ' ');
  return { portal, feature: feature || 'Other' };
}

function featureFile(test) {
  const f = test.location.file.replace(/\\/g, '/');
  const m = f.match(/(features\/.+?\.feature)/);
  return m ? m[1] : f;
}

// The BDD step (Given/When/Then...) that carried the error - "failed at: I click Send Invites"
// rather than a raw locator call.
function failedStep(steps) {
  for (const s of steps || []) {
    const nested = failedStep(s.steps);
    if (nested) return nested;
    if (s.error && s.category === 'test.step' && KEYWORD.test(s.title)) return s.title;
  }
  return undefined;
}

// The error, readable: its headline, this suite's numbered "  1. problem" lines (every step that
// collects problems throws them that way), and a short Expected / Actual pair.
function reasons(result) {
  const errors = result.errors && result.errors.length ? result.errors : result.error ? [result.error] : [];
  const out = [];
  for (const error of errors.slice(0, 2)) out.push(...cleanError(error.message || String(error.value || '')));
  if (!out.length) out.push('The scenario failed, but no readable error message was captured.');
  return out.slice(0, MAX_REASONS + 1);
}

function cleanError(raw) {
  const lines = redact(String(raw).replace(ANSI, '')).split(/\r?\n/).map((l) => l.trim());
  const body = [];
  let expected;
  let received;
  for (const l of lines) {
    if (!l) continue;
    if (/^at\s/.test(l) || /^call log:/i.test(l) || /^\d+\s*\|/.test(l) || /^>\s*\d+\s*\|/.test(l)) break;
    if (/^expect\(/i.test(l)) continue;
    const e = l.match(/^Expected(?: [a-z]+)?:\s*(.+)$/i);
    const r = l.match(/^Received(?: [a-z]+)?:\s*(.+)$/i);
    if (e) { expected = e[1]; continue; }
    if (r) { received = r[1]; continue; }
    if (/^[-+]\s/.test(l) || /^(Array|Object) \[|^[\]}]/.test(l)) continue; // diff noise
    body.push(l.replace(/^Error:\s*/i, ''));
  }
  const head = body.shift() || 'The scenario failed.';
  const numbered = body.filter((l) => /^\d+\.\s/.test(l));
  const rest = numbered.length ? numbered : body.slice(0, 2);
  const short = (v) => v && v.length <= 80 && !/[<>]/.test(v);
  const pair = short(expected) && short(received) ? ` (expected ${expected}, got ${received})` : '';
  const items = [`${head}${pair}`, ...rest.slice(0, MAX_REASONS)];
  if (rest.length > MAX_REASONS) items.push(`... and ${rest.length - MAX_REASONS} more - see the HTML report.`);
  return items.map((s) => (s.length > 420 ? `${s.slice(0, 420)}…` : s));
}

function redact(s) {
  return s
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<token>')
    .replace(/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/("?(?:password|access|refresh|verification_token|access_token)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"');
}

// ==================== Run details ====================

function runDetails(result, scenarios, startedAt) {
  const git = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
  const lanes = {};
  for (const s of scenarios) if (s.lane) lanes[s.lane] = (lanes[s.lane] || 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    startedAt: (result.startTime || startedAt).toISOString(),
    durationMs: result.duration || 0,
    status: result.status,
    profile: process.env.BDD_PROFILE || '(all - run outside npm test)',
    environment: process.env.BASE_URL || '',
    branch: git('git rev-parse --abbrev-ref HEAD'),
    commit: git('git rev-parse --short HEAD'),
    lanes,
  };
}

// ==================== Rendering ====================

async function renderReport(data, basePath) {
  const html = buildHtml(data);
  fs.writeFileSync(`${basePath}.html`, html);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const footerDate = new Date(data.run.generatedAt).toLocaleString();
    await page.pdf({
      path: `${basePath}.pdf`,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '16mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between;"><span>TalentForge Automated Test Report</span><span>${esc(footerDate)}</span></div>`,
      footerTemplate: '<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between;"><span>Prepared by the TalentForge QA Automation Suite</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STATUS = {
  passed: { label: 'Passed', css: 'passed' },
  flaky: { label: 'Passed (after retry)', css: 'flaky' },
  failed: { label: 'Failed', css: 'failed' },
  'known-issue': { label: 'Known issue', css: 'known' },
  skipped: { label: 'Skipped', css: 'skipped' },
};

const COLORS = { passed: '#16a34a', failed: '#dc2626', known: '#d97706', skipped: '#94a3b8' };

function totalsOf(list) {
  const t = { passed: 0, failed: 0, known: 0, skipped: 0 };
  for (const s of list) {
    if (s.status === 'failed') t.failed += 1;
    else if (s.status === 'known-issue') t.known += 1;
    else if (s.status === 'skipped') t.skipped += 1;
    else t.passed += 1; // flaky folds into passed - it did pass, on retry
  }
  return t;
}

function duration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
}

function donut(t) {
  const total = t.passed + t.failed + t.known + t.skipped;
  if (!total) return '<p class="muted">No scenarios were recorded.</p>';
  const size = 200; const c = size / 2; const r = 78; const w = 30; const circ = 2 * Math.PI * r;
  const segs = [
    { v: t.passed, color: COLORS.passed, label: 'Passed' },
    { v: t.failed, color: COLORS.failed, label: 'Failed' },
    { v: t.known, color: COLORS.known, label: 'Known issues' },
    { v: t.skipped, color: COLORS.skipped, label: 'Skipped' },
  ].filter((s) => s.v > 0);
  let drawn = 0;
  const arcs = segs.map((s) => {
    const dash = (s.v / total) * circ;
    const out = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-drawn}" transform="rotate(-90 ${c} ${c})"/>`;
    drawn += dash;
    return out;
  }).join('');
  const executed = total - t.skipped;
  const rate = executed ? Math.round((t.passed / executed) * 100) : 0;
  const legend = segs.map((s) => `<div class="legend-item"><span class="swatch" style="background:${s.color}"></span>${s.label}: <strong>${s.v}</strong> (${Math.round((s.v / total) * 100)}%)</div>`).join('');
  return `<div class="donut-wrap"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${w}"/>${arcs}<text x="${c}" y="${c - 2}" text-anchor="middle" font-size="30" font-weight="700" fill="#0f172a">${rate}%</text><text x="${c}" y="${c + 20}" text-anchor="middle" font-size="12" fill="#64748b">pass rate</text></svg><div class="legend">${legend}</div></div>`;
}

function areaBars(areas) {
  if (!areas.length) return '';
  const max = Math.max(...areas.map((a) => a.total), 1);
  return `<div class="bar-chart">${areas.map((a) => {
    const seg = (v, cls) => (v ? `<div class="bar-seg ${cls}" style="width:${(v / max) * 100}%"></div>` : '');
    const summary = `${a.t.passed}/${a.total} passed${a.t.failed ? `, ${a.t.failed} failed` : ''}${a.t.known ? `, ${a.t.known} known` : ''}${a.t.skipped ? `, ${a.t.skipped} skipped` : ''}`;
    return `<div class="bar-row"><div class="bar-label" title="${esc(a.area)}">${esc(a.area)}</div><div class="bar-track">${seg(a.t.passed, 'bar-pass')}${seg(a.t.failed, 'bar-fail')}${seg(a.t.known, 'bar-known')}${seg(a.t.skipped, 'bar-skip')}</div><div class="bar-count">${esc(summary)}</div></div>`;
  }).join('')}</div>`;
}

function failCard(s) {
  const known = s.status === 'known-issue';
  const items = (s.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('');
  return `<div class="fail-card ${known ? 'known-card' : ''}"><div class="fail-card-head"><span class="badge badge-area">${esc(s.portal)}</span><span class="badge badge-area">${esc(s.area)}</span><span class="badge ${known ? 'badge-known' : 'badge-fail'}">${known ? 'KNOWN ISSUE' : 'FAILED'}</span></div><div class="fail-title">${esc(s.title)}</div>${s.failedStep ? `<div class="fail-step">Failed at step: <em>${esc(s.failedStep)}</em></div>` : ''}<ul class="fail-reasons">${items || '<li>No further detail was captured.</li>'}</ul><div class="fail-file">${esc(s.file)}</div></div>`;
}

function scenarioTable(list) {
  const order = { failed: 0, 'known-issue': 1, flaky: 2, passed: 3, skipped: 4 };
  return `<table class="scenario-table"><tbody>${[...list]
    .sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title))
    .map((s) => `<tr><td>${esc(s.title)}${s.staleKnownIssue ? ' <span class="pill pill-stale">@known-issue now passes</span>' : ''}</td><td class="dur">${duration(s.durationMs)}</td><td><span class="pill pill-${STATUS[s.status].css}">${STATUS[s.status].label}</span></td></tr>`)
    .join('')}</tbody></table>`;
}

function summarySentence(total, t, areaCount, stale) {
  if (!total) return 'No automated scenarios were executed in this run.';
  const executed = total - t.skipped;
  const rate = executed ? Math.round((t.passed / executed) * 100) : 0;
  const parts = [`${t.passed} passed (${rate}%)`];
  if (t.failed) parts.push(`${t.failed} failed`);
  if (t.known) parts.push(`${t.known} failed on a known product issue`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  const out = [
    `This report summarizes an automated end-to-end test run of the TalentForge application across ${areaCount} feature area${areaCount === 1 ? '' : 's'}.`,
    `Of ${total} scenarios, ${parts.join(', ')}.`,
  ];
  if (t.known) out.push('Known issues are scenarios that assert the correct behaviour against a defect already reported; they are expected to fail until it is fixed.');
  out.push(t.failed
    ? 'Every new failure below names the step it failed at and a plain-language reason, so it can be triaged without reading test code.'
    : 'No new failures were recorded in this run.');
  if (stale) out.push(`${stale} scenario(s) tagged as a known issue passed - the defect appears fixed and the tag should be reviewed.`);
  return out.join(' ');
}

function buildHtml({ run, scenarios }) {
  const t = totalsOf(scenarios);
  const total = scenarios.length;
  const executed = total - t.skipped;
  const rate = executed ? Math.round((t.passed / executed) * 100) : 0;
  const byArea = new Map();
  for (const s of scenarios) {
    const key = `${s.portal}|${s.area}`;
    if (!byArea.has(key)) byArea.set(key, { portal: s.portal, area: s.area, list: [] });
    byArea.get(key).list.push(s);
  }
  const areas = [...byArea.values()].map((a) => ({ ...a, t: totalsOf(a.list), total: a.list.length }))
    .sort((a, b) => (b.t.failed - a.t.failed) || (b.t.known - a.t.known) || a.area.localeCompare(b.area));
  const failures = scenarios.filter((s) => s.status === 'failed').sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  const known = scenarios.filter((s) => s.status === 'known-issue').sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  const stale = scenarios.filter((s) => s.staleKnownIssue);
  const flaky = scenarios.filter((s) => s.status === 'flaky');
  const portals = [...new Set(areas.map((a) => a.portal))].sort();
  const lanes = Object.entries(run.lanes).map(([k, v]) => `${k}: ${v}`).join(', ');

  return `<!doctype html><html><head><meta charset="utf-8"><title>TalentForge Automated Test Report</title><style>${CSS}</style></head><body>
<div class="brand-bar"></div>
<header class="report-header">
  <div class="eyebrow">TalentForge QA Automation</div>
  <h1>Automated Test Report</h1>
  <div class="subtitle">End-to-end test execution summary - prepared for product and client review</div>
  <div class="meta-grid">
    <div><span class="meta-label">Generated</span>${esc(new Date(run.generatedAt).toLocaleString())}</div>
    <div><span class="meta-label">Environment</span>${esc(run.environment)}</div>
    <div><span class="meta-label">Run selection</span>${esc(run.profile)}</div>
    <div><span class="meta-label">Duration</span>${duration(run.durationMs)}</div>
    <div><span class="meta-label">Scenarios</span>${total}</div>
    <div><span class="meta-label">Pass rate</span>${rate}%</div>
  </div>
  <p class="exec-summary">${esc(summarySentence(total, t, areas.length, stale.length))}</p>
</header>
<section class="summary">
  <div class="stat-cards">
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total scenarios</div></div>
    <div class="stat-card stat-pass"><div class="stat-num">${t.passed}</div><div class="stat-label">Passed</div></div>
    <div class="stat-card stat-fail"><div class="stat-num">${t.failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat-card stat-known"><div class="stat-num">${t.known}</div><div class="stat-label">Known issues</div></div>
    <div class="stat-card stat-skip"><div class="stat-num">${t.skipped}</div><div class="stat-label">Skipped</div></div>
  </div>
  ${donut(t)}
</section>
<section><h2>Test Coverage by Feature Area</h2>${areaBars(areas)}</section>
<section class="failures"><h2>New Failures${failures.length ? ` (${failures.length})` : ''}</h2>
  ${failures.length ? failures.map(failCard).join('') : '<p class="all-clear">No new failures in this run.</p>'}
</section>
${known.length ? `<section><h2>Known Product Issues (${known.length})</h2><p class="muted-note">These scenarios assert the intended behaviour against a defect that is already reported. They fail on purpose until it is fixed.</p>${known.map(failCard).join('')}</section>` : ''}
${stale.length || flaky.length ? `<section><h2>Worth a Look</h2>
  ${stale.length ? `<p class="note"><strong>Known issue now passing (${stale.length}):</strong> the defect appears fixed - review and remove the tag so a regression is reported again.</p><ul class="plain">${stale.map((s) => `<li>${esc(s.area)} - ${esc(s.title)}</li>`).join('')}</ul>` : ''}
  ${flaky.length ? `<p class="note"><strong>Passed only on retry (${flaky.length}):</strong></p><ul class="plain">${flaky.map((s) => `<li>${esc(s.area)} - ${esc(s.title)}</li>`).join('')}</ul>` : ''}
</section>` : ''}
<section class="full-list page-break"><h2>Full Scenario List</h2>
  ${portals.map((p) => `<h3 class="portal-heading">${esc(p)}</h3>${areas.filter((a) => a.portal === p).sort((a, b) => a.area.localeCompare(b.area)).map((a) => `<h4 class="area-heading">${esc(a.area)} <span class="area-count">${a.t.passed}/${a.total} passed</span></h4>${scenarioTable(a.list)}`).join('')}`).join('')}
</section>
<footer class="report-footer">
  <div>Run started ${esc(new Date(run.startedAt).toLocaleString())}${run.branch ? ` | branch ${esc(run.branch)} @ ${esc(run.commit)}` : ''}${lanes ? ` | lanes ${esc(lanes)}` : ''}</div>
  <div>Screenshots, videos and traces for every failure: reports/playwright-report/index.html (npm run test:report)</div>
</footer>
</body></html>`;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 13px; line-height: 1.55; }
  .brand-bar { height: 6px; border-radius: 4px; margin-bottom: 22px; background: linear-gradient(90deg, #1e3a8a, #2563eb); }
  .eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #2563eb; margin-bottom: 4px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #64748b; margin-bottom: 14px; }
  h2 { font-size: 16px; margin: 0 0 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 7px; }
  h3.portal-heading { font-size: 14px; margin: 22px 0 4px; color: #0f172a; }
  h4.area-heading { font-size: 12.5px; margin: 14px 0 6px; color: #1e3a8a; font-weight: 700; }
  .area-count { font-weight: 400; color: #64748b; font-size: 11px; margin-left: 6px; }
  .report-header { margin-bottom: 26px; }
  .meta-grid { display: flex; gap: 24px; margin-bottom: 14px; flex-wrap: wrap; }
  .meta-grid > div { font-size: 13px; color: #334155; }
  .meta-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; }
  .exec-summary { font-size: 13px; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #2563eb; border-radius: 6px; padding: 12px 14px; margin: 0; }
  section { margin-bottom: 30px; }
  .stat-cards { display: flex; gap: 10px; margin-bottom: 20px; }
  .stat-card { flex: 1; border-radius: 10px; padding: 14px 10px; text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; }
  .stat-num { font-size: 26px; font-weight: 700; }
  .stat-label { font-size: 10.5px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
  .stat-pass .stat-num { color: #16a34a; } .stat-fail .stat-num { color: #dc2626; } .stat-known .stat-num { color: #d97706; } .stat-skip .stat-num { color: #64748b; }
  .donut-wrap { display: flex; align-items: center; gap: 30px; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .bar-chart { display: flex; flex-direction: column; gap: 9px; }
  .bar-row { display: grid; grid-template-columns: 230px 1fr 190px; align-items: center; gap: 10px; page-break-inside: avoid; }
  .bar-label { font-size: 11.5px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { display: flex; height: 13px; border-radius: 7px; overflow: hidden; background: #f1f5f9; }
  .bar-seg { height: 100%; } .bar-pass { background: #16a34a; } .bar-fail { background: #dc2626; } .bar-known { background: #d97706; } .bar-skip { background: #94a3b8; }
  .bar-count { font-size: 11px; color: #64748b; }
  .all-clear { color: #16a34a; font-weight: 600; }
  .muted-note { color: #64748b; font-size: 12px; margin: -6px 0 12px; }
  .fail-card { border: 1px solid #fecaca; background: #fef2f2; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
  .known-card { border-color: #fde68a; background: #fffbeb; }
  .fail-card-head { display: flex; gap: 6px; margin-bottom: 7px; flex-wrap: wrap; }
  .badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 2px 8px; border-radius: 999px; }
  .badge-area { background: #e2e8f0; color: #334155; text-transform: none; letter-spacing: 0; } .badge-fail { background: #dc2626; color: #fff; } .badge-known { background: #d97706; color: #fff; }
  .fail-title { font-weight: 600; margin-bottom: 4px; }
  .fail-step { font-size: 12px; color: #7f1d1d; margin-bottom: 7px; }
  .known-card .fail-step { color: #78350f; }
  .fail-reasons { margin: 0; padding-left: 18px; font-size: 11.5px; color: #334155; }
  .fail-reasons li { margin-bottom: 3px; word-break: break-word; }
  .fail-file { font-size: 10px; color: #94a3b8; margin-top: 6px; }
  .note { margin: 0 0 6px; } ul.plain { margin: 0 0 12px; padding-left: 18px; font-size: 12px; }
  .scenario-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  .scenario-table tr { page-break-inside: avoid; }
  .scenario-table tr:nth-child(even) { background: #f8fafc; }
  .scenario-table td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11.5px; vertical-align: top; }
  .scenario-table td.dur { color: #94a3b8; white-space: nowrap; width: 60px; text-align: right; }
  .scenario-table td:last-child { text-align: right; width: 130px; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; }
  .pill-passed { background: #dcfce7; color: #166534; } .pill-flaky { background: #fef3c7; color: #92400e; } .pill-failed { background: #fee2e2; color: #991b1b; }
  .pill-known { background: #ffedd5; color: #9a3412; } .pill-skipped { background: #f1f5f9; color: #475569; } .pill-stale { background: #e0e7ff; color: #3730a3; }
  .page-break { page-break-before: always; }
  .report-footer { border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; }
  .muted { color: #94a3b8; }
`;

module.exports = SummaryReportReporter;
module.exports.renderReport = renderReport;
module.exports.buildHtml = buildHtml;
