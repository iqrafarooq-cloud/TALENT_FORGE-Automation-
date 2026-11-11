// docVerificationReport.js - turns a set of per-document results into the run report.
//
// Writes two files, on purpose:
//
//   reports/document-verification-report.json  - the machine-readable record. Every
//        expected value, every observed value, every finding, and the request log.
//        This is what a later run is diffed against.
//   reports/document-verification-report.md    - the human-readable version, which is
//        what gets handed to dev.
//
// ============================================================================
// WHAT THE REPORT MUST MAKE OBVIOUS, AND WHY
// ============================================================================
//
// 1. PENDING IS NOT PASSED. A document with no expected result is counted in its own
//    column and printed in its own section. Folding it into "passed" is how a
//    requirement ships unverified while the report reads green. This repo has the same
//    rule for the community module's "nothing to assert" step, which was changed from
//    logging and passing to failing outright.
//
// 2. THE FAILURE CLASS COMES BEFORE THE DETAIL. A reader's first question is whether
//    a red row is the product, the fixture, or the environment. Findings are grouped
//    by kind (section 14's taxonomy) rather than by document, so eight upload failures
//    caused by one expired token read as one problem instead of eight.
//
// 3. A GREEN DOCUMENT STILL SHOWS ITS EVIDENCE. Every document's verdicts and
//    extracted fields are recorded whether or not it matched. On a red row that is the
//    evidence; on a green one it is the record of what the AI said that day, which is
//    what makes a later behaviour change diagnosable rather than mysterious. Same
//    reasoning as agentEmailEvidence.js.
//
// 4. KNOWN DEFECTS ARE LABELLED, NEVER SUBTRACTED. Requirement section 15 is explicit
//    that a known product defect stays a failing test. The report says which failures
//    were already known so the reader can tell a regression from a standing bug, and
//    the pass/fail counts do not move.

'use strict';

const fs = require('fs');
const path = require('path');
const { KIND, KIND_LABEL } = require('./docVerificationErrors');
const { splitFindings } = require('./docVerificationEvidence');

const REPORT_DIR = path.resolve(__dirname, '..', 'reports');

class DocVerificationReport {
  constructor(meta = {}) {
    this.meta = {
      startedAt: new Date().toISOString(),
      baseUrl: meta.baseUrl,
      candidate: meta.candidate,
      declaredName: meta.declaredName,
      model: null, // filled from the first verification that reports one
      ...meta,
    };
    this.rows = [];
    this.notes = [];
  }

  // A note is an observation about the RUN rather than about a document - the
  // isolation gap, a declared-name mismatch, a skipped category. They print above the
  // results because they change how every row should be read.
  note(text) {
    this.notes.push(text);
    return this;
  }

  // One document's outcome. `observed` may be partial (an upload that was refused has
  // no verification), which is why every reader below is defensive about shape.
  add(doc, observed, findings, evidenceText) {
    const { failing, pending } = splitFindings(findings);
    const v = (observed && observed.verification) || null;
    if (v && v.model && !this.meta.model) this.meta.model = v.model;

    this.rows.push({
      id: doc.id,
      file: doc.file,
      category: doc.category,
      types: doc.types || [],
      order: doc.order,
      knownDefect: doc.known_defect || null,
      expected: doc.expected || null,
      observed: {
        httpStatus: observed && observed.upload && observed.upload.httpStatus,
        uploadAccepted: observed && observed.upload && observed.upload.accepted,
        uploadResponse: observed && observed.upload && observed.upload.responseBody,
        entryId: observed && observed.upload && observed.upload.entryId,
        documentRowId: observed && observed.upload && observed.upload.documentRowId,
        bytesSent: observed && observed.upload && observed.upload.bytesSent,
        documentStatus: observed && observed.document && observed.document.status,
        aiStatus: v && v.status,
        aiError: v && v.error,
        aiVersion: v && v.version,
        aiCheckedAt: v && v.checked_at,
        aiWaitMs: observed && observed.elapsedMs,
        criteria: v ? (v.criteria || []).map((c) => ({ key: c.key, verdict: c.verdict, detail: c.detail })) : [],
        extracted: (v && v.extracted) || null,
        comments: ((observed && observed.document && observed.document.comments) || []).map((c) => ({
          source: c.source,
          timestamp: c.timestamp,
          comment: c.comment,
        })),
      },
      findings,
      verdict: failing.length ? 'FAILED' : pending.length ? 'PENDING' : 'PASSED',
      evidence: evidenceText || null,
    });
    return this;
  }

  summary() {
    const s = { total: this.rows.length, passed: 0, failed: 0, pending: 0, byKind: {} };
    for (const r of this.rows) {
      if (r.verdict === 'PASSED') s.passed += 1;
      else if (r.verdict === 'FAILED') s.failed += 1;
      else s.pending += 1;
      for (const f of r.findings) s.byKind[f.kind] = (s.byKind[f.kind] || 0) + 1;
    }
    s.knownDefectFailures = this.rows.filter((r) => r.verdict === 'FAILED' && r.knownDefect).length;
    s.newFailures = s.failed - s.knownDefectFailures;
    return s;
  }

  toMarkdown() {
    const s = this.summary();
    const L = [];
    L.push('# AI Document Verification - Automation Report');
    L.push('');
    L.push(`**Run started:** ${this.meta.startedAt}`);
    L.push(`**API:** ${this.meta.baseUrl}`);
    L.push(`**Candidate:** ${this.meta.candidate} (declared name "${this.meta.declaredName}")`);
    if (this.meta.model) L.push(`**AI model:** ${this.meta.model}`);
    L.push('');

    L.push('## Summary');
    L.push('');
    L.push('| Metric | Count |');
    L.push('|--------|-------|');
    L.push(`| Documents driven | ${s.total} |`);
    L.push(`| Passed | ${s.passed} |`);
    L.push(`| **Failed** | **${s.failed}** |`);
    L.push(`| of which already-known defects | ${s.knownDefectFailures} |`);
    L.push(`| of which NEW | ${s.newFailures} |`);
    L.push(`| Pending (no expected result supplied) | ${s.pending} |`);
    L.push('');
    if (s.pending) {
      L.push(
        `> **${s.pending} document(s) have no expected result and were NOT verified.** ` +
          'They are counted separately and deliberately not reported as passes. Fill in the ' +
          '`expected` blocks in `test-data/document-verification/documents.json`.'
      );
      L.push('');
    }

    if (this.notes.length) {
      L.push('## Run notes');
      L.push('');
      L.push('These change how every row below should be read.');
      L.push('');
      for (const n of this.notes) L.push(`- ${n}`);
      L.push('');
    }

    if (Object.keys(s.byKind).length) {
      L.push('## Findings by class');
      L.push('');
      L.push('Section 14 of the requirement asks these to be distinguishable. They are.');
      L.push('');
      L.push('| Class | Count | Meaning |');
      L.push('|-------|-------|---------|');
      for (const [kind, count] of Object.entries(s.byKind).sort((a, b) => b[1] - a[1])) {
        L.push(`| \`${kind}\` | ${count} | ${KIND_LABEL[kind] || ''} |`);
      }
      L.push('');
    }

    // ---- failures first, because that is what the report is for ----
    const failed = this.rows.filter((r) => r.verdict === 'FAILED');
    if (failed.length) {
      L.push('## Failures');
      L.push('');
      for (const r of failed) {
        L.push(`### ${r.id} - ${r.file}`);
        L.push('');
        if (r.knownDefect) {
          L.push(`> **Known defect, still failing on purpose:** ${r.knownDefect}`);
          L.push('');
        }
        for (const f of splitFindings(r.findings).failing) {
          L.push(`- **\`${f.kind}\`** ${f.subject}: ${f.message}`);
          for (const [k, v] of Object.entries(f)) {
            if (['kind', 'subject', 'message'].includes(k) || v === undefined) continue;
            L.push(`  - ${k}: \`${typeof v === 'object' ? JSON.stringify(v) : String(v)}\``);
          }
        }
        L.push('');
      }
    }

    // ---- the full matrix ----
    L.push('## All documents');
    L.push('');
    L.push('| # | Document | Category | Verdict | HTTP | Doc status | AI status | Criteria of note |');
    L.push('|---|----------|----------|---------|------|------------|-----------|------------------|');
    for (const r of this.rows.slice().sort((a, b) => a.order - b.order)) {
      const failedCriteria = r.observed.criteria.filter((c) => c.verdict === 'fail').map((c) => c.key);
      const uncertain = r.observed.criteria.filter((c) => c.verdict === 'uncertain').map((c) => c.key);
      const cell = [
        failedCriteria.length ? `fail: ${failedCriteria.join(', ')}` : '',
        uncertain.length ? `uncertain: ${uncertain.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('<br>') || '-';
      L.push(
        `| ${r.order} | \`${r.id}\` | ${r.category} | ${r.verdict} | ${r.observed.httpStatus ?? '-'} | ` +
          `${r.observed.documentStatus ?? '-'} | ${r.observed.aiStatus ?? '-'} | ${cell} |`
      );
    }
    L.push('');

    // ---- per-document evidence ----
    L.push('## Evidence');
    L.push('');
    L.push('Recorded for every document, passed or failed, so a later change in behaviour is diagnosable.');
    L.push('');
    for (const r of this.rows.slice().sort((a, b) => a.order - b.order)) {
      L.push(`<details><summary><code>${r.id}</code> - ${r.verdict}</summary>`);
      L.push('');
      L.push('```');
      L.push(r.evidence || '(no evidence captured)');
      L.push('```');
      L.push('');
      L.push('</details>');
      L.push('');
    }

    return L.join('\n');
  }

  // Written after the run finishes, never from inside it. The same reason the
  // Cucumber HTML report in this repo is built by a wrapper rather than an AfterAll
  // hook: a half-written report that reads as a whole-run report is worse than none.
  write(baseName = 'document-verification-report') {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const jsonPath = path.join(REPORT_DIR, `${baseName}.json`);
    const mdPath = path.join(REPORT_DIR, `${baseName}.md`);
    this.meta.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ meta: this.meta, summary: this.summary(), notes: this.notes, documents: this.rows }, null, 2)
    );
    fs.writeFileSync(mdPath, this.toMarkdown());
    return { jsonPath, mdPath };
  }

  // One-line-per-document console summary, printed as the run goes so a long run is
  // watchable rather than silent.
  static line(doc, verdict, observed, findings) {
    const v = (observed && observed.verification) || {};
    const failed = (v.criteria || []).filter((c) => c.verdict === 'fail').map((c) => c.key);
    const bits = [
      String(doc.order).padStart(3),
      doc.id.padEnd(12),
      String(verdict).padEnd(7),
      `HTTP ${observed && observed.upload ? observed.upload.httpStatus : '---'}`,
      (observed && observed.document && observed.document.status) || '-',
    ];
    if (v.error) bits.push(`AI ERROR: ${String(v.error).slice(0, 60)}`);
    else if (failed.length) bits.push(`fail: ${failed.join(',')}`);
    const pending = findings ? findings.filter((f) => f.kind === KIND.PENDING).length : 0;
    if (pending) bits.push(`(${pending} pending)`);
    return bits.join('  ');
  }
}

module.exports = { DocVerificationReport, REPORT_DIR };
