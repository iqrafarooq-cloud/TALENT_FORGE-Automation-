// aiFindingsLog.js - THE AI's OWN VERDICTS AND REMARKS, AS A READABLE RUN ARTIFACT.
//
// Every scenario that verifies a document already attaches its evidence to the Cucumber
// HTML report (see documentReport() and the @doc-verification After hook). That is the right
// place to read ONE scenario's story. What it cannot answer is the question people actually
// ask after a run:
//
//     "what did the AI flag, across everything, and why?"
//
// Answering that from the HTML means opening 80 scenarios one at a time. So each verification
// also appends one line here, and the run wrapper turns the lot into
// reports/ai-verification-findings.md (to read) and .json (to process).
//
// ---------------------------------------------------------------------------
// WHY NDJSON AND NOT ONE FILE WRITTEN AT THE END
// ---------------------------------------------------------------------------
// Two reasons, and the second is the one that matters.
//
// A `--parallel` run has one worker process per lane, each with its own AfterAll. A
// build-at-the-end design would therefore produce one file per worker, each holding a
// fraction of the run and each overwriting the last. Appending a single line per document is
// process-safe: `fs.appendFileSync` with one write per line does not interleave partial lines
// at these sizes, and the wrapper merges whatever it finds.
//
// And a KILLED run still leaves everything recorded up to the moment it died. That is exactly
// when this artifact is most useful - a run abandoned after 20 minutes has still spent 20
// permanent uploads, and their verdicts should not be lost with it.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
// It does not judge. There is no "expected" column and no pass/fail of its own, because the
// requirement's expected-results table has never been supplied - every `expected` block in
// the test data is still null. Inventing a verdict here would manufacture the very thing this
// repo keeps refusing to fake. It reports what the AI said, per criterion, with the document
// it said it about, and leaves the judgement to the scenario that asserted it.
'use strict';

const fs = require('fs');
const path = require('path');

const REPORTS = path.resolve(__dirname, '..', 'reports');
const NDJSON = path.join(REPORTS, 'ai-findings.ndjson');

function ndjsonPath() {
  return NDJSON;
}

// One record per document a scenario verified. Called from the After hook, so it runs for
// every document whether the scenario passed or failed - a failed scenario's verdicts are the
// evidence, and dropping them would leave the reader with only an assertion message.
function record({ scenario, doc, observed, uploadMode }) {
  try {
    const v = (observed && observed.verification) || {};
    const document = (observed && observed.document) || {};
    const upload = (observed && observed.upload) || {};

    const line = {
      at: new Date().toISOString(),
      scenario: scenario || null,
      documentId: doc ? doc.id : null,
      category: doc ? doc.category : null,
      fixture: doc ? doc.file : null,
      storedFileName: upload.uploadedFileName || (doc ? doc.file : null),
      documentRowId: upload.documentRowId || null,
      entryId: upload.entryId || null,
      uploadMode: uploadMode || (upload.viaUi === false ? 'api' : 'ui'),
      uploadHttpStatus: upload.httpStatus != null ? upload.httpStatus : null,
      uploadAccepted: upload.accepted != null ? upload.accepted : null,
      // The status the document ended up with, and the status the AI itself chose. They are
      // recorded separately on purpose: where they differ, something other than the AI moved
      // the document, and that is the single most important thing this file can show.
      documentStatus: document.status || null,
      aiStatus: v.status || null,
      decidedBy: whoDecided(v, document),
      model: v.model || null,
      aiError: v.error || null,
      waitSeconds: observed && observed.elapsedMs != null ? Math.round(observed.elapsedMs / 1000) : null,
      polls: observed ? observed.polls : null,
      criteria: (v.criteria || []).map((c) => ({ key: c.key, verdict: c.verdict, detail: c.detail || '' })),
      extracted: v.extracted || null,
      // The remarks the CANDIDATE can see, with their source. This is the "AI flagged
      // comment vs agent comment" distinction the whole module turns on.
      comments: ((document.comments || []).map((c) => ({
        source: c.source || null,
        at: c.timestamp || null,
        text: c.comment || '',
      }))),
    };

    fs.mkdirSync(REPORTS, { recursive: true });
    fs.appendFileSync(NDJSON, JSON.stringify(line) + '\n', 'utf8');
  } catch (e) {
    // Recording evidence must NEVER break a scenario or mask its failure. Same rule as the
    // trace and video collectors.
  }
}

// Who put the document in the status it holds. Derived, not guessed: if a comment is
// attributed to an agent the agent acted, and if the AI's own recorded status equals the
// document's status with no agent comment, the AI decided it alone.
function whoDecided(v, document) {
  const comments = document.comments || [];
  const byAgent = comments.some((c) => /^agent$/i.test(String(c.source || '').trim()));
  if (byAgent) return 'AGENT';
  if (v.status && document.status && v.status === document.status) return 'AI';
  if (!document.status) return null;
  return 'UNKNOWN';
}

// Records as written, DEDUPLICATED on the document row a scenario recorded.
//
// The After hook now iterates unique uploads, so it no longer double-records - but this stays,
// because a findings file is also read from runs written before that fix, and because the
// per-criterion tally is the one number in this artifact somebody might act on. A document
// counted twice there is a wrong number presented as a measurement.
//
// The key is (documentRowId, entryId, scenario): two genuinely different uploads always differ
// in documentRowId, and the same document legitimately recorded by two DIFFERENT scenarios is
// kept as two records - that is real coverage, not a duplicate.
function dedupe(records) {
  const seen = new Set();
  const out = [];
  let collapsed = 0;
  for (const r of records) {
    if (!r) { out.push(r); continue; }
    const key = [r.documentRowId, r.entryId, r.scenario].join("|");
    if (r.documentRowId != null && seen.has(key)) { collapsed += 1; continue; }
    seen.add(key);
    out.push(r);
  }
  out.collapsed = collapsed;
  return out;
}

function readAllRaw() {
  if (!fs.existsSync(NDJSON)) return [];
  return fs
    .readFileSync(NDJSON, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        // A truncated final line is possible if a run was killed mid-write. Skipping it is
        // right - but it is COUNTED by the caller so the report can say so rather than
        // quietly presenting an incomplete picture as a complete one.
        return null;
      }
    });
}

const VERDICT_MARK = { pass: 'PASS', fail: 'FAIL', uncertain: '????' };

// The readable artifact. Ordered so the reader meets the summary first, then everything the
// AI flagged, and only then the documents it was happy with - a 40-document run is unreadable
// any other way.
function buildMarkdown(records) {
  const good = records.filter(Boolean);
  const dropped = records.length - good.length;

  const out = [];
  out.push('# AI document verification - what the AI said');
  out.push('');
  out.push(`Generated ${new Date().toISOString()} from ${good.length} verified document(s).`);
  out.push('');
  out.push(
    'This is the AI\'s own output, per document: the status it chose, every criterion it ' +
      'judged with its stated reason, and the remarks that reach the candidate with their ' +
      'source. It contains no pass/fail of its own - the requirement\'s expected-results ' +
      'table has never been supplied, so a verdict column here would be invented. Read a ' +
      'scenario\'s own result in the HTML report beside it.'
  );
  out.push('');
  if (dropped) {
    out.push(
      `> **${dropped} record(s) could not be parsed** and are omitted. That normally means the ` +
        'run was killed mid-write, so treat this as a partial picture.'
    );
    out.push('');
  }
  if (!good.length) {
    out.push('No document was verified in this run.');
    return out.join('\n') + '\n';
  }

  // --- Summary -------------------------------------------------------------
  const byStatus = {};
  const byDecider = {};
  const criterionTally = {};
  for (const r of good) {
    byStatus[r.documentStatus || 'none'] = (byStatus[r.documentStatus || 'none'] || 0) + 1;
    byDecider[r.decidedBy || 'none'] = (byDecider[r.decidedBy || 'none'] || 0) + 1;
    for (const c of r.criteria || []) {
      const t = (criterionTally[c.key] = criterionTally[c.key] || { pass: 0, fail: 0, uncertain: 0 });
      if (t[c.verdict] !== undefined) t[c.verdict] += 1;
    }
  }

  out.push('## Summary');
  out.push('');
  out.push(`- **Final status:** ${Object.entries(byStatus).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  out.push(`- **Decided by:** ${Object.entries(byDecider).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const modes = [...new Set(good.map((r) => r.uploadMode).filter(Boolean))];
  out.push(`- **Uploaded via:** ${modes.join(', ') || 'unknown'}`);
  const waits = good.map((r) => r.waitSeconds).filter((n) => typeof n === 'number');
  if (waits.length) {
    out.push(
      `- **AI wait:** ${Math.min(...waits)}-${Math.max(...waits)}s ` +
        `(median ${waits.slice().sort((a, b) => a - b)[Math.floor(waits.length / 2)]}s)`
    );
  }
  const errs = good.filter((r) => r.aiError);
  if (errs.length) out.push(`- **AI errors:** ${errs.length} (see the per-document sections)`);
  out.push('');

  out.push('### Per criterion');
  out.push('');
  out.push('| Criterion | pass | fail | uncertain |');
  out.push('| --- | --- | --- | --- |');
  for (const [key, t] of Object.entries(criterionTally).sort()) {
    out.push(`| \`${key}\` | ${t.pass} | ${t.fail} | ${t.uncertain} |`);
  }
  out.push('');

  // --- What was flagged ----------------------------------------------------
  const flagged = good.filter((r) => (r.criteria || []).some((c) => c.verdict !== 'pass'));
  const clean = good.filter((r) => !(r.criteria || []).some((c) => c.verdict !== 'pass'));

  out.push(`## Flagged documents (${flagged.length})`);
  out.push('');
  if (!flagged.length) out.push('Nothing was flagged in this run.');
  for (const r of flagged) out.push(...documentSection(r));
  out.push('');

  out.push(`## Documents with every criterion passing (${clean.length})`);
  out.push('');
  if (!clean.length) out.push('None.');
  for (const r of clean) out.push(...documentSection(r, { brief: true }));

  return out.join('\n') + '\n';
}

function documentSection(r, { brief = false } = {}) {
  const out = [];
  const title = r.documentId ? `${r.documentId}` : r.storedFileName || 'unknown document';
  out.push(`### ${title} - ${r.documentStatus || 'no status'} (decided by ${r.decidedBy || 'unknown'})`);
  out.push('');
  out.push(`- file: \`${r.storedFileName || r.fixture}\``);
  out.push(
    `- category ${r.category || '?'} | document row ${r.documentRowId || '?'} | uploaded via ${r.uploadMode || '?'}` +
      (r.uploadHttpStatus != null ? ` | upload HTTP ${r.uploadHttpStatus}` : '')
  );
  if (r.aiStatus && r.documentStatus && r.aiStatus !== r.documentStatus) {
    out.push(
      `- **the AI chose \`${r.aiStatus}\` but the document holds \`${r.documentStatus}\`** - something ` +
        'other than the AI moved it'
    );
  }
  if (r.aiError) out.push(`- **AI error:** ${r.aiError}`);
  if (r.scenario) out.push(`- seen in: _${r.scenario}_`);
  out.push('');

  if (!brief && (r.criteria || []).length) {
    out.push('| Verdict | Criterion | The reason the AI gave |');
    out.push('| --- | --- | --- |');
    // Non-passing first: they are why the document is here.
    const order = (c) => (c.verdict === 'fail' ? 0 : c.verdict === 'uncertain' ? 1 : 2);
    for (const c of [...r.criteria].sort((a, b) => order(a) - order(b))) {
      out.push(
        `| **${VERDICT_MARK[c.verdict] || c.verdict}** | \`${c.key}\` | ${String(c.detail).replace(/\|/g, '\\|') || '_(no reason given)_'} |`
      );
    }
    out.push('');
  }

  if ((r.comments || []).length) {
    out.push('**Remarks the candidate can see:**');
    out.push('');
    for (const c of r.comments) {
      out.push(`- \`[${c.source || 'unattributed'}]\` ${String(c.text).replace(/\n/g, ' ')}`);
    }
    out.push('');
  } else if (!brief) {
    out.push('**Remarks the candidate can see:** none.');
    out.push('');
  }
  return out;
}

// Build both artifacts. Called by configs/run-playwright.js after the test lanes finish, so it sees every
// worker's lines.
// Build both artifacts. Called by configs/run-playwright.js after the test lanes finish, so it sees every
// worker's lines.
//
// `since` is the run start. Any record older than that belongs to a PREVIOUS run whose line
// survived the sweep, and it is excluded and counted rather than presented as part of this
// run - observed live 2026-09-01, when three ui-mode records from an earlier run turned up in
// an api-mode run's findings. The wrapper also clears the log explicitly now, so this should
// be unreachable; it is checked rather than assumed for the same reason the report generator
// refuses a JSON written before its run started.
function write({ since = null } = {}) {
  const all = readAll();
  const cutoff = since ? new Date(since).getTime() : null;
  const stale = cutoff ? all.filter((r) => r && r.at && new Date(r.at).getTime() < cutoff) : [];
  const records = cutoff ? all.filter((r) => !r || !r.at || new Date(r.at).getTime() >= cutoff) : all;
  if (!records.length) return null;
  fs.mkdirSync(REPORTS, { recursive: true });
  const md = path.join(REPORTS, 'ai-verification-findings.md');
  const json = path.join(REPORTS, 'ai-verification-findings.json');
  fs.writeFileSync(md, buildMarkdown(records), 'utf8');
  fs.writeFileSync(json, JSON.stringify(records.filter(Boolean), null, 1), 'utf8');
  return { md, json, count: records.filter(Boolean).length, stale: stale.length };
}

function readAll() {
  return dedupe(readAllRaw());
}

function reset() {
  try {
    if (fs.existsSync(NDJSON)) fs.unlinkSync(NDJSON);
  } catch (e) {
    /* a stale line is better than a crashed run */
  }
}

module.exports = { record, readAll, buildMarkdown, write, reset, ndjsonPath };
