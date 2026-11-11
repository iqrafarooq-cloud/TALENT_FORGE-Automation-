// docVerificationApi.js - the one API client for the AI document-verification
// automation. Auth, reference-data resolution, upload, result polling, the agent
// decision, and presigned download all go through here so no step definition and no
// probe script owns a second copy of the same request.
//
// ============================================================================
// WHAT WAS MEASURED, 2026-08-24 (do not re-derive this from the OpenAPI schema)
// ============================================================================
//
// The schema at https://dev-api.talentforge.com.sa/api/schema/ is open and
// authoritative for the REQUEST shapes, but it declares `ai_verification` as a
// free-form field (readOnly, nullable, no type at all). Its contents are therefore
// only knowable by measurement. Captured live off document id 26252:
//
//   ai_verification: {
//     error:      null | string          // AI could not run. NOT a verdict.
//     model:      "amazon.nova-pro-v1:0"
//     status:     "AWAITING" | "APPROVED" | "REVISION"
//     version:    1                      // increments per verification run
//     checked_at: ISO-8601
//     criteria:   [ { key, verdict: "pass"|"fail"|"uncertain", detail } ]
//     extracted:  { legal_name, degree, major, issuing_organisation,
//                   issue_date, expiry_date, conferral_date, is_current }
//   }
//
// Criterion keys seen: date_validity, authenticity, identity_name_match,
// cross_document_consistency, issuing_organisation, transcript_content,
// automated_check.
//
// Document status enum (StatusDa2Enum): AWAITING | APPROVED | REVISION. There is no
// NEEDS_REVIEW, so the AC's three-status model does not map onto the product. That
// divergence is recorded in Files/DOC_VERIFICATION_TEST_MATRIX.md and is not papered
// over here.
//
// Upload contracts (from the schema, field names exact):
//   POST /candidate/profile/educations/       institution(id) degree(id)
//                                            field_of_study_id start_date end_date file
//   POST /candidate/profile/work-experiences/ company(str) experience(enum)
//                                            designation start_date end_date file
//   POST /candidate/profile/certifications/   certificate_name issuing_organization
//                                            issue_date expiry_date file
//   experience enum: co_op tamheer full_time part_time freelance internship
//                    apprenticeship self_employed
//
// ============================================================================
// WHY THE BUILT-IN fetch AND NOT node-fetch
// ============================================================================
// The rest of features/support uses node-fetch v2, which cannot build a multipart
// body without also adding the `form-data` package. Node 18+ ships FormData and Blob
// natively and this module is the only one in the repo that uploads files, so it uses
// the global fetch rather than growing a dependency for one call site.
//
// ============================================================================
// WHY EVERY REQUEST RETRIES, AND WHICH ONES DO NOT
// ============================================================================
// The DEV host produced both ConnectTimeoutError and EAI_AGAIN during a single
// afternoon of read-only probing on 2026-08-24. A transport failure is not a product
// finding, and a suite that reports one as an API failure trains its reader to ignore
// API failures. So transport errors and 502/503/504 retry with backoff; every 4xx is
// returned to the caller immediately, because a 4xx is an answer.

'use strict';

require('dotenv').config();

const {
  KIND,
  authError,
  uploadError,
  apiError,
  aiTimeoutError,
  redact,
} = require('./docVerificationErrors');
const { readFixture } = require('./docVerificationFixtures');

const DEFAULT_BASE = 'https://dev-api.talentforge.com.sa';
const API_ROOT = '/core/api/v1';

// Transport-level failures worth another attempt. Anything else is an answer.
const RETRYABLE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
]);
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const CATEGORY = {
  EDUCATION: 'EDUCATION',
  WORKEXPERIENCE: 'WORKEXPERIENCE',
  CERTIFICATION: 'CERTIFICATION',
};

// Category -> the collection endpoint that owns it. One map, so a new category is a
// one-line change and no step definition has to know a URL.
const ENDPOINT = {
  [CATEGORY.EDUCATION]: 'candidate/profile/educations',
  [CATEGORY.WORKEXPERIENCE]: 'candidate/profile/work-experiences',
  [CATEGORY.CERTIFICATION]: 'candidate/profile/certifications',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DocVerificationApi {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.DOC_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    this.token = null;
    this.identity = null;
    this.retries = options.retries ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 1500;
    // Every request/response pair, redacted, in order. This is what makes a failed
    // run debuggable without re-running it, which section 14 asks for explicitly.
    this.log = [];
  }

  // ---------------------------------------------------------------- transport

  url(pathname) {
    if (/^https?:\/\//.test(pathname)) return pathname;
    const clean = pathname.replace(/^\//, '');
    return clean.startsWith('core/') ? `${this.baseUrl}/${clean}` : `${this.baseUrl}${API_ROOT}/${clean}`;
  }

  // The single request primitive. Returns { status, ok, body, headers } and throws
  // only for transport failure after exhausting retries. A non-2xx is data, not an
  // exception, because half the scenarios here are asserting on a refusal.
  async request(method, pathname, options = {}) {
    const url = this.url(pathname);
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (this.token && !options.anonymous) headers.Authorization = `Bearer ${this.token}`;

    let body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      // Let undici set the multipart boundary; setting Content-Type by hand here is
      // the classic way to produce a body the server cannot parse.
      body = options.form;
    }

    let lastTransportError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const startedAt = Date.now();
      let res;
      try {
        res = await fetch(url, { method, headers, body, redirect: options.redirect || 'follow' });
      } catch (e) {
        lastTransportError = e;
        const code = (e.cause && e.cause.code) || e.code;
        if (attempt < this.retries && (RETRYABLE_CODES.has(code) || !code)) {
          await sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }
        throw apiError('Transport failure reaching the API', {
          method,
          url,
          attempts: attempt + 1,
          cause: (e.cause && e.cause.code) || e.message,
        });
      }

      const text = await res.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // A Django debug 404 page, an HTML error, or an empty 201. Keep a prefix so
        // the report shows what actually came back rather than "parse error".
        parsed = { _nonJsonBody: text.slice(0, 400) };
      }

      const entry = {
        method,
        url: redact(url),
        status: res.status,
        ms: Date.now() - startedAt,
        attempt: attempt + 1,
        response: redact(parsed),
      };
      if (options.logRequest !== false && options.json !== undefined) entry.request = redact(options.json);
      this.log.push(entry);

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.retries) {
        await sleep(this.retryDelayMs * (attempt + 1));
        continue;
      }

      return { status: res.status, ok: res.ok, body: parsed, headers: res.headers, raw: text };
    }
    throw apiError('Transport failure reaching the API', {
      method,
      url,
      cause: lastTransportError && lastTransportError.message,
    });
  }

  // ---------------------------------------------------------------------- auth

  // Authentication failure is its own kind because it invalidates the whole run, and
  // because 401-on-login and 401-mid-run mean different things (bad credentials
  // versus an expired token).
  async login(email, password, role = 'candidate') {
    if (!email || !password) {
      throw authError('Missing credentials', {
        role,
        emailProvided: Boolean(email),
        passwordProvided: Boolean(password),
      });
    }
    const res = await this.request('POST', 'auth/token/', {
      json: { email, password },
      anonymous: true,
      logRequest: false, // never log a login body, even redacted
    });
    if (!res.ok || !res.body || !res.body.access) {
      throw authError('Login was refused', {
        role,
        email,
        status: res.status,
        response: res.body,
      });
    }
    if (res.body.requires_2fa) {
      // Not fatal in itself, but the token would be a pre-2FA one. Fail loudly rather
      // than proceeding with a token that silently cannot do anything.
      throw authError('Account requires 2FA, which this automation does not drive', { role, email });
    }
    this.token = res.body.access;
    const me = await this.request('GET', 'auth/me/');
    if (!me.ok) throw authError('Token was issued but /auth/me/ refused it', { role, status: me.status });
    this.identity = {
      id: me.body.id,
      email: me.body.email,
      firstName: me.body.firstname,
      lastName: me.body.lastname,
      declaredName: [me.body.firstname, me.body.lastname].filter(Boolean).join(' '),
      role: me.body.role,
      activeRole: me.body.active_role,
      isCandidate: me.body.is_candidate,
      isAgent: me.body.is_agent,
    };
    return this.identity;
  }

  // ------------------------------------------------------------ reference data

  // institutions / degrees / fields of study, cached per client.
  //
  // Exact-name resolution, and an ambiguous name is refused rather than resolved to
  // `.first()`. The live data makes this mandatory, not defensive: the institution
  // list holds BOTH "King Saud University" (117) and "King Saud University (KSU)" (1),
  // and field_of_study holds both "Computer Science" (1) and "computer science" (144).
  // Picking the first match would bind a scenario to whichever row the server happened
  // to order first. CLAUDE.md records the same trap for INVITE_AGENT_UNIVERSITY and for
  // the community Majors filter.
  async referenceData() {
    if (this._reference) return this._reference;
    const load = async (pathname) => {
      const res = await this.request('GET', `${pathname}?page_size=500`);
      if (!res.ok) throw apiError(`Could not load reference data from ${pathname}`, { status: res.status });
      const b = res.body;
      return Array.isArray(b) ? b : b.results || [];
    };
    const [institutions, degrees, fields] = await Promise.all([
      load('institutions/'),
      load('degree/'),
      load('field_of_study/'),
    ]);
    this._reference = { institutions, degrees, fields };
    return this._reference;
  }

  static resolveByExactName(list, name, what) {
    const exact = list.filter((i) => i.name === name);
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) {
      throw apiError(`${what} name is ambiguous - several rows carry it verbatim`, {
        name,
        matches: exact.map((i) => `${i.id}:${i.name}`),
      });
    }
    const near = list.filter((i) => String(i.name).toLowerCase() === String(name).toLowerCase());
    throw apiError(`${what} not found by exact name`, {
      name,
      caseInsensitiveMatches: near.length ? near.map((i) => `${i.id}:${i.name}`) : '(none)',
      hint: 'The declared value must match the configured row verbatim. Case-different rows exist in this data.',
    });
  }

  async institutionId(name) {
    const { institutions } = await this.referenceData();
    return DocVerificationApi.resolveByExactName(institutions, name, 'Institution');
  }

  async degreeId(name) {
    const { degrees } = await this.referenceData();
    return DocVerificationApi.resolveByExactName(degrees, name, 'Degree');
  }

  async fieldOfStudyId(name) {
    const { fields } = await this.referenceData();
    return DocVerificationApi.resolveByExactName(fields, name, 'Field of study');
  }

  // -------------------------------------------------------------------- upload

  // Build the multipart body for one category. Kept separate from upload() so a probe
  // can print exactly what will be sent without sending it.
  async buildForm(doc, fixture) {
    const d = doc.declared || {};
    const form = new FormData();
    const bytes = readFixture(fixture);
    const file = new File([bytes], fixture.fileName, { type: fixture.contentType });

    if (doc.category === CATEGORY.EDUCATION) {
      form.set('institution', String(await this.institutionId(d.institution)));
      form.set('degree', String(await this.degreeId(d.degree)));
      form.set('field_of_study_id', String(await this.fieldOfStudyId(d.field_of_study)));
      form.set('start_date', d.start_date);
      if (d.end_date) form.set('end_date', d.end_date);
    } else if (doc.category === CATEGORY.WORKEXPERIENCE) {
      form.set('company', d.company);
      form.set('experience', d.experience || 'full_time');
      form.set('designation', d.designation);
      form.set('start_date', d.start_date);
      // end_date omitted entirely means current employment; is_current is derived
      // server-side and is readOnly, so this is the only way to express "to Present".
      if (d.end_date) form.set('end_date', d.end_date);
    } else if (doc.category === CATEGORY.CERTIFICATION) {
      form.set('certificate_name', d.certificate_name);
      form.set('issuing_organization', d.issuing_organization);
      form.set('issue_date', d.issue_date);
      if (d.expiry_date) form.set('expiry_date', d.expiry_date);
    } else {
      throw uploadError('Unknown document category in the test data', {
        document: doc.id,
        category: doc.category,
        known: Object.keys(CATEGORY).join(', '),
      });
    }
    form.set('file', file, fixture.fileName);
    return form;
  }

  // Every document row id currently on the signed-in candidate's account, as a Set.
  //
  // Taken BEFORE an upload so the row the upload creates can be identified positively
  // rather than assumed. The dedicated candidate is long-lived and already holds ~78
  // rows, several of them transcripts naming somebody else, so "the newest row of this
  // category" is not a safe way to find what this run just sent - that is exactly how a
  // scenario ends up asserting an AI verdict from a previous run and passing.
  async snapshotDocumentIds() {
    const rows = await this.listDocuments();
    return new Set(rows.map((r) => r.id).filter((id) => id !== undefined && id !== null));
  }

  // Upload one document. Never throws on a refusal: a refusal is the expected outcome
  // for the FILE-02 and FILE-03 scenarios, so the caller decides whether a 422 is a
  // pass or a failure. Only a transport failure or a malformed 2xx throws.
  //
  // `priorIds` is the pre-upload snapshot from snapshotDocumentIds(). It is optional but
  // the callers all pass it, and it does two things that the upload response alone
  // cannot:
  //
  //   1. It supplies documentRowId when the response omits it. The response nests the
  //      created document, but `document` has been observed null on a 201, and without a
  //      row id every agent-side assertion has nothing to target - the scenario then
  //      falls back to matching by file name, and the file names in this dataset repeat
  //      across runs.
  //   2. It PROVES the row is new. If the id resolved from the response was already on
  //      the account before this upload, the run is about to track somebody else's row
  //      and every verdict it reads would be a previous run's. That is a hard failure,
  //      not a warning: a silently mistargeted assertion is the one failure mode this
  //      whole module is built to prevent.
  async upload(doc, fixture, { priorIds = null } = {}) {
    const form = await this.buildForm(doc, fixture);
    const res = await this.request('POST', `${ENDPOINT[doc.category]}/`, { form });

    const accepted = res.status >= 200 && res.status < 300;
    const out = {
      documentId: doc.id,
      category: doc.category,
      file: fixture.fileName,
      bytesSent: fixture.bytes,
      contentType: fixture.contentType,
      httpStatus: res.status,
      accepted,
      // The rejection reason verbatim. "Do not hide API response errors" is section 14
      // in as many words, and a 422 body is where the field rule actually lives.
      responseBody: redact(res.body),
      entryId: null,
      documentRowId: null,
      // How the tracked row was identified, so the report says whether the id was taken
      // from the response or recovered by diffing. Recovery-by-diff is a finding in
      // itself (the response should carry it) and must not look like the normal path.
      rowIdSource: null,
      priorDocumentCount: priorIds ? priorIds.size : null,
    };
    if (!accepted) return out;

    const body = res.body || {};
    out.entryId = body.id ?? null;
    out.documentRowId = (body.document && body.document.id) ?? null;
    out.uploadedFileName = (body.document && body.document.file_name) ?? null;
    if (out.documentRowId !== null) out.rowIdSource = 'upload response';
    if (out.entryId === null) {
      throw uploadError('Upload returned success but no entry id, so the result cannot be polled', {
        document: doc.id,
        status: res.status,
        response: redact(res.body),
      });
    }

    if (priorIds) await this.confirmRowIsNew(doc, out, priorIds);
    return out;
  }

  // Resolve and/or verify `out.documentRowId` against the pre-upload snapshot. Mutates
  // `out` and throws if the tracked row cannot be shown to be new.
  async confirmRowIsNew(doc, out, priorIds) {
    const fresh = await this.listDocuments();
    const added = fresh.filter((r) => !priorIds.has(r.id));
    out.documentsAdded = added.map((r) => ({ id: r.id, file: r.file_name ?? null, status: r.status ?? null }));

    if (out.documentRowId === null) {
      // The response did not carry the row. Recover it from the diff - but only when the
      // diff is unambiguous. Guessing among several new rows would reintroduce exactly
      // the mistargeting this method exists to rule out.
      if (added.length === 1) {
        out.documentRowId = added[0].id;
        out.rowIdSource = 'diff against the pre-upload snapshot';
        return;
      }
      throw uploadError(
        added.length
          ? 'The upload response carried no document row, and the account gained more than one row, ' +
              'so the row this upload created cannot be identified without guessing'
          : 'The upload response carried no document row and the account gained none, so the upload ' +
              'reported success without creating a document',
        {
          document: doc.id,
          entryId: out.entryId,
          priorDocumentCount: priorIds.size,
          documentsAdded: out.documentsAdded,
          response: redact(out.responseBody),
        }
      );
    }

    if (priorIds.has(out.documentRowId)) {
      throw uploadError(
        'The document row this upload reported already existed on the account before the upload, so ' +
          'every assertion in this scenario would read a PREVIOUS run\'s verification result',
        {
          document: doc.id,
          entryId: out.entryId,
          documentRowId: out.documentRowId,
          priorDocumentCount: priorIds.size,
          documentsAdded: out.documentsAdded,
        }
      );
    }
  }

  // Resubmit a corrected file against an existing entry. This is the candidate-side
  // "I fixed it and uploaded again" path the AC requires, and it is deliberately a
  // REPLACEMENT on the same entry rather than a new upload: a new upload would create a
  // second document row, and then "the stale AI finding was cleared" could pass simply
  // because the assertion was reading a different row.
  //
  // PATCH on the entry is tried first because that is the flow the profile UI drives.
  // If the endpoint refuses a file-only PATCH the caller gets the refusal verbatim
  // rather than a silent fallback - a fallback here would hide which path the app
  // actually supports, which is part of what this scenario is measuring.
  async resubmit(category, entryId, fixture) {
    const form = new FormData();
    const bytes = readFixture(fixture);
    form.set('file', new File([bytes], fixture.fileName, { type: fixture.contentType }), fixture.fileName);
    const res = await this.request('PATCH', `${ENDPOINT[category]}/${entryId}/`, { form });
    return {
      httpStatus: res.status,
      accepted: res.ok,
      responseBody: redact(res.body),
      documentRowId: (res.body && res.body.document && res.body.document.id) ?? null,
      file: fixture.fileName,
      bytesSent: fixture.bytes,
      contentType: fixture.contentType,
      entryId,
    };
  }

  // --------------------------------------------------------------- read result

  // The single-entry read. Preferred over scanning the document list because
  // Education/WorkExperience/Certification each nest a full DocumentEntry (including
  // ai_verification) and this is one request rather than a paged scan.
  async fetchEntry(category, entryId) {
    const res = await this.request('GET', `${ENDPOINT[category]}/${entryId}/`);
    if (!res.ok) {
      throw apiError('Could not read back the uploaded entry', {
        category,
        entryId,
        status: res.status,
        response: redact(res.body),
      });
    }
    return res.body;
  }

  // Every document row for the signed-in principal. As a candidate this is that
  // candidate's own documents; as the agent it is the whole review queue (measured:
  // 136 rows across all candidates), which is what the agent-side scenarios read.
  async listDocuments({ pageSize = 100, search, all = true } = {}) {
    const out = [];
    let page = 1;
    for (;;) {
      const q = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search) q.set('search', search);
      const res = await this.request('GET', `candidate/documents/all/?${q}`);
      if (!res.ok) {
        throw apiError('Could not list documents', { status: res.status, response: redact(res.body) });
      }
      const body = res.body || {};
      out.push(...(body.results || []));
      if (!all || !body.next || !(body.results || []).length) break;
      page += 1;
    }
    return out;
  }

  // ---------------------------------------------------------- notifications
  //
  // GET /notifications/ is role-agnostic - it answers for whichever principal holds the
  // token - so the same call serves the candidate here and the agent/superadmin in the
  // promo features (see NotificationsPage.js, which documents the same shape off the UI).
  //
  // Read over the API rather than the bell because the bell's first page holds only ten
  // items and this account is long-lived: counting matches cannot tell a notification
  // raised by this run from one left by a run last week. An id baseline can.
  async listNotifications({ pageSize = 50, unreadOnly = false } = {}) {
    const q = new URLSearchParams({ page: '1', page_size: String(pageSize) });
    if (unreadOnly) q.set('is_read', 'false');
    const res = await this.request('GET', `notifications/?${q}`);
    if (!res.ok) {
      throw apiError('Could not list notifications', { status: res.status, response: redact(res.body) });
    }
    return (res.body && res.body.results) || [];
  }

  async snapshotNotificationIds() {
    const rows = await this.listNotifications();
    return new Set(rows.map((r) => r.id).filter((id) => id !== undefined && id !== null));
  }

  // Poll for a notification this run caused. `afterIds` is the pre-action snapshot;
  // `match` narrows to the notification being waited for.
  //
  // Returns `{ notification, candidates, polls, elapsedMs }`. On timeout it throws
  // carrying EVERY new notification it saw, not just a count: "no notification arrived"
  // and "a notification arrived but says something else" are different findings, and a
  // bare timeout cannot tell them apart. Same reasoning as waitForEmailMatching() in the
  // agent-email module.
  async waitForNotification({ afterIds, match, timeoutMs = 120000, intervalMs = 5000 } = {}) {
    const startedAt = Date.now();
    let polls = 0;
    let seen = [];
    while (Date.now() - startedAt < timeoutMs) {
      polls += 1;
      const rows = await this.listNotifications();
      seen = rows.filter((r) => !afterIds.has(r.id));
      const hit = match ? seen.find((r) => match(r)) : seen[0];
      if (hit) return { notification: hit, candidates: seen, polls, elapsedMs: Date.now() - startedAt };
      await sleep(intervalMs);
    }
    throw apiError('No matching notification arrived within the timeout', {
      timeoutMs,
      polls,
      notificationsRaisedSinceBaseline: seen.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        created_at: r.created_at,
      })),
      note:
        seen.length
          ? 'Notifications WERE raised but none matched. The app notifies; the wording or type is ' +
            'not what was expected. That is a different finding from silence.'
          : 'No notification of any kind was raised for this action.',
    });
  }

  // The names the AI has read off the candidate's OTHER documents - the third of the four
  // independent name sources the cross-validation rule compares (declared name, the name
  // on this document, the names on the others, and the verdict). Kept apart from the
  // other three on purpose: a single "names agree" assertion cannot distinguish "the AI
  // misread this document" from "the AI is comparing against a document that names
  // somebody else", and on this account four documents genuinely name somebody else.
  //
  // Rows carrying no verification are returned as `verified: false` rather than dropped.
  // Silently dropping them would let this read return an empty list on an account full of
  // conflicting documents, and "nothing to conflict with" is the one conclusion that must
  // never be reached by accident.
  async otherDocumentNames({ excludeRowId = null } = {}) {
    const rows = await this.listDocuments();
    const out = [];
    for (const r of rows) {
      if (excludeRowId !== null && r.id === excludeRowId) continue;
      const v = r.ai_verification || null;
      out.push({
        rowId: r.id,
        file: r.file_name ?? null,
        status: r.status ?? null,
        verified: Boolean(v),
        legalName: (v && v.extracted && v.extracted.legal_name) || null,
        checkedAt: (v && v.checked_at) || null,
      });
    }
    return out;
  }

  // Poll until this document version carries a verification run.
  //
  // There is no "AI finished" flag on any response. `ai_verification` is null until a
  // run exists, then carries checked_at and an integer version. So completion is a
  // polled condition on real state (a run exists, and it is newer than the baseline),
  // which is what "avoid hardcoded waits" means in practice - there is nothing to
  // wait a fixed time for.
  //
  // Returns `{ verification, entry, elapsedMs, polls }`. An AI run that errored is
  // returned rather than thrown: `ai_verification.error` is a legitimate outcome (it
  // is the expected one for the oversized-file scenario) and only the caller knows
  // whether it was expected. A run that never appears is an AI_TIMEOUT, which is a
  // different diagnosis and must not be reported as an error verdict.
  async waitForVerification(category, entryId, options = {}) {
    const timeoutMs = options.timeoutMs ?? Number(process.env.DOC_AI_TIMEOUT_MS || 180000);
    const intervalMs = options.intervalMs ?? Number(process.env.DOC_AI_POLL_MS || 5000);
    const afterVersion = options.afterVersion ?? null;
    const afterCheckedAt = options.afterCheckedAt ? Date.parse(options.afterCheckedAt) : null;

    const startedAt = Date.now();
    let polls = 0;
    let lastEntry = null;

    while (Date.now() - startedAt < timeoutMs) {
      polls += 1;
      lastEntry = await this.fetchEntry(category, entryId);
      const doc = lastEntry.document || {};
      const v = doc.ai_verification;

      if (v) {
        const newEnough =
          (afterVersion === null || Number(v.version) > Number(afterVersion)) &&
          (afterCheckedAt === null || Date.parse(v.checked_at) > afterCheckedAt);
        if (newEnough) {
          return {
            verification: v,
            document: doc,
            entry: lastEntry,
            elapsedMs: Date.now() - startedAt,
            polls,
          };
        }
      }
      await sleep(intervalMs);
    }

    const doc = (lastEntry && lastEntry.document) || {};
    throw aiTimeoutError('AI verification did not produce a result within the timeout', {
      category,
      entryId,
      timeoutMs,
      polls,
      lastDocumentStatus: doc.status ?? null,
      lastAiVerification: doc.ai_verification ? redact(doc.ai_verification) : null,
      note:
        'ai_verification stayed null (or stayed at the baseline version). That is a timeout, ' +
        'not a verdict, and must not be reported as one.',
    });
  }

  // ------------------------------------------------------------ agent decision

  // The agent's Approve / Request Revision. PATCH is the documented decision
  // endpoint; `comment` is writeOnly on the serializer and is the mandatory note the
  // AC requires.
  async decide(documentRowId, { status, comment }) {
    const res = await this.request('PATCH', 'candidate/documents/update/', {
      json: { id: documentRowId, status, comment },
    });
    return { httpStatus: res.status, ok: res.ok, body: redact(res.body) };
  }

  // ------------------------------------------------------------------ cleanup

  // Delete one profile entry. Note the measured limitation this cannot work around:
  // deleting an entry does NOT delete its document row. On 2026-08-24 the candidate
  // held 4 profile entries and 77 document rows, so 73 were already orphaned, and no
  // DELETE exists for a document anywhere in the API. Full isolation is therefore not
  // achievable through this interface; see DOC_VERIFICATION_TEST_MATRIX.md.
  async deleteEntry(category, entryId) {
    const res = await this.request('DELETE', `${ENDPOINT[category]}/${entryId}/`);
    return { httpStatus: res.status, ok: res.ok };
  }

  async listEntries(category) {
    const res = await this.request('GET', `${ENDPOINT[category]}/?page_size=200`);
    if (!res.ok) throw apiError('Could not list profile entries', { category, status: res.status });
    const b = res.body;
    return Array.isArray(b) ? b : b.results || [];
  }

  // --------------------------------------------------- presigned file download

  // FILE-05 asserts the document URL is a time-limited presigned link rather than a
  // publicly readable object. Fetched deliberately WITHOUT the Authorization header:
  // the whole point of a presigned URL is that the signature, not the session, grants
  // access, so sending the bearer token would make an unprotected object look
  // protected.
  async downloadDocumentFile(fileUrl) {
    const res = await this.request('GET', fileUrl, { anonymous: true });
    const q = new URL(fileUrl).searchParams;
    return {
      httpStatus: res.status,
      ok: res.ok,
      bytes: res.raw ? Buffer.byteLength(res.raw) : 0,
      presigned: q.has('X-Amz-Signature'),
      expiresInSeconds: q.get('X-Amz-Expires') ? Number(q.get('X-Amz-Expires')) : null,
      algorithm: q.get('X-Amz-Algorithm'),
    };
  }

  // ---------------------------------------------------------------- reporting

  // Everything this client did, redacted, for attaching to a failed scenario.
  requestLog() {
    return this.log.slice();
  }
}

// Verdict and criterion vocabularies, exported so the comparison engine and the step
// definitions cannot drift from the client's understanding of them.
const VERDICT = { PASS: 'pass', FAIL: 'fail', UNCERTAIN: 'uncertain' };
const STATUS = { AWAITING: 'AWAITING', APPROVED: 'APPROVED', REVISION: 'REVISION' };
const CRITERION = {
  DATE_VALIDITY: 'date_validity',
  AUTHENTICITY: 'authenticity',
  IDENTITY_NAME_MATCH: 'identity_name_match',
  CROSS_DOCUMENT_CONSISTENCY: 'cross_document_consistency',
  ISSUING_ORGANISATION: 'issuing_organisation',
  TRANSCRIPT_CONTENT: 'transcript_content',
  AUTOMATED_CHECK: 'automated_check',
};

module.exports = {
  DocVerificationApi,
  CATEGORY,
  ENDPOINT,
  VERDICT,
  STATUS,
  CRITERION,
  KIND,
};
