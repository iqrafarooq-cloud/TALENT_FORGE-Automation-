# AI Document Verification - Automation Analysis (STEPS 1-8)

Written 2026-08-24. This is the analysis that must precede any code, per the
implementation approach. It records what the 38 fixtures in `Files/Test_doc`
actually contain (read out of the files, not inferred from their names), what
the live API actually returns, and what is therefore assertable.

**Nothing here is code. No expected result in this document has been chosen to
make a test pass.**

---

## 1. The live contract (measured, not assumed)

Discovered from the open OpenAPI schema at `https://dev-api.talentforge.com.sa/api/schema/`
and one read-only pass over the API on 2026-08-24.

### Auth

```
POST /core/api/v1/auth/token/   {email, password} -> 200 {access, requires_2fa}
GET  /core/api/v1/auth/me/      -> id, firstname, lastname, role, active_role, is_candidate, is_agent
```

### Upload (one endpoint per document category)

```
POST /core/api/v1/candidate/profile/educations/       multipart: institution(id), degree(id),
                                                      field_of_study_id, start_date, end_date, file
POST /core/api/v1/candidate/profile/work-experiences/  multipart: company, experience, designation,
                                                      start_date, end_date, file
POST /core/api/v1/candidate/profile/certifications/    multipart: certificate_name,
                                                      issuing_organization, issue_date, expiry_date, file
```

Reference data for the declared fields:
`GET /core/api/v1/institutions/`, `GET /core/api/v1/degree/`, `GET /core/api/v1/field_of_study/`

### Result retrieval

```
GET   /core/api/v1/candidate/documents/all/?page=&page_size=&search=
      -> PaginatedDocumentVerificationDisplayList
GET   /core/api/v1/candidate/documents/          (candidate's own)
PATCH /core/api/v1/candidate/documents/update/   (status + comment; the decision endpoint)
```

### The `ai_verification` object (captured live, document id 26252)

The OpenAPI schema declares this field as free-form (`readOnly`, `nullable`, no
type), so its shape is only knowable by measurement:

```json
{
  "error": null,
  "model": "amazon.nova-pro-v1:0",
  "status": "AWAITING",
  "version": 1,
  "checked_at": "2026-08-24T08:47:57.782842+00:00",
  "criteria": [ { "key": "...", "verdict": "pass|fail|uncertain", "detail": "..." } ],
  "extracted": {
    "legal_name": "...", "degree": "...", "major": "...",
    "issuing_organisation": "...", "issue_date": "...", "expiry_date": "...",
    "conferral_date": "...", "is_current": false
  }
}
```

**Criterion keys observed:** `date_validity`, `authenticity`, `identity_name_match`,
`cross_document_consistency`, `issuing_organisation`, `transcript_content`,
`automated_check`.

**Verdict vocabulary:** `pass` | `fail` | `uncertain`.

**Document status enum:** `AWAITING` | `APPROVED` | `REVISION` (`StatusDa2Enum`).

> **Spec divergence, recorded not resolved.** The AC asks for three statuses:
> Approved, **Needs Review**, Revision Required. The product has no
> `NEEDS_REVIEW`. `AWAITING` renders as "Awaiting Verification", which is the
> pre-verification state, not a post-verification "a human must look at this"
> state. So the AC requirement that "agents take a decision only on the Needs
> Review status" cannot be asserted against a status that does not exist. This
> needs a product answer before the status assertions are finalised.

### Comment provenance

`comments[]` carries `{comment, timestamp, source}`. Live document 26252 holds a
comment whose text is plainly AI-generated ("Authenticity could not be
confirmed: ...") stamped `"source": "AGENT"`. The AC requires the candidate to
see **who flagged** the document, so a mislabelled source is directly in scope.
Confirm with dev whether AI findings are intentionally written as `AGENT`.

### Permissions observed

The agent account `faran.mustafa` (user id 2) can read the whole review queue via
`GET /candidate/documents/all/` (136 documents, all candidates) but receives
**403** on `/agent/{id}/pending-verifications/` and every
`/agent/analytics/documents/*` endpoint. Whether that is intended is a question
for dev; the automation reads the queue through the endpoint that works.

---

## 2. Fixture inventory - what the files actually contain

Read with `pdf-parse`. **Filenames are not evidence**; several disagree with
their own content and that is called out per row.

Name on every document: **"Abdul Musawwir Siddiqui"**, except the three
name-defect fixtures. Issuer on most: **King Saud University**; work letters:
**Systems Limited Pakistan**, except ORG-04 (**ByteCorp Solutions**).

| ID | Real content | Type | Upload category |
|----|--------------|------|-----------------|
| AUTH-01 | Certificate of Completion, "Google Cloud Professional Data Engineer", issue 10 Oct 2023. No tamper markers, no seal. | negative/edge | CERTIFICATION |
| AUTH-02 | Clean transcript **plus a stray truncated word "Revis"** at the end. No visual tampering of any kind. | negative | EDUCATION |
| AUTH-03 | Certificate titled "E-Transcript Digital Credential (No Seal)". Self-declaring, no actual digital certificate. | negative | CERTIFICATION |
| AUTH-04 | PNG, 30 KB. Genuine e-transcript with a faint seal. | edge | EDUCATION |
| AUTH-05 | PNG, 7 KB. Too degraded to judge. | edge | EDUCATION |
| CONT-01 | Complete transcript: degree + major + conferral date. | positive | EDUCATION |
| CONT-02 | Transcript with **no Major/Field line**. | negative | EDUCATION |
| CONT-03 | **A certificate, not a transcript**: "CERTIFICATE OF COMPLETION / Bachelor of Science in Computer Science". No major, no conferral date. | negative | EDUCATION (deliberately, to force `transcript_content` to apply) |
| CONT-04 | Employment letter, "1 July 2022 to Present". | positive | WORKEXPERIENCE |
| DATE-01 | Transcript, conferral **15 June 2030** (future), issue 20 June 2022. | negative | EDUCATION |
| DATE-02 | Employment letter, "1 July 2022 to **31 December 2030**". **Filename says "current_open_end" but the letter states a future END date, not an open end.** | ambiguous | WORKEXPERIENCE |
| DATE-03 | Transcript, conferral **"32nd of Never, 202X"** (malformed); issue date valid. | negative | EDUCATION |
| DATE-04 | Certificate, issue 15 June 2025, **expiry 15 June 2023** (expiry before issue). | negative | CERTIFICATION |
| DATE-05 | Certificate, issue 15 June 2021, expiry 15 June 2024. Both past, correctly ordered. | positive | CERTIFICATION |
| ENG-01 | Clean transcript, every field present, all dates past and valid. | positive/e2e | EDUCATION |
| ENG-02 | Certificate, issue **15 June 2030** (future), expiry 2035. | negative/e2e | CERTIFICATION |
| ENG-03 | Transcript naming **"John Doe"**, plus a valid issue date. | negative/e2e | EDUCATION |
| ENG-04 | Transcript from **"Institute of Advanced Space Studies, Zanzibar"** with conferral **"not-a-date"**. Two defects. | negative/e2e | EDUCATION |
| ENG-05 | PNG, 27 KB, blurry but legible scan. | edge/e2e | EDUCATION |
| ENG-06 | Certificate, minimal fields (name, award, issue date only). | positive/e2e | CERTIFICATION |
| ENG-07 | Employment letter, "to Present". | positive/e2e | WORKEXPERIENCE |
| FILE-01 (pdf) | Certificate, "Sample Certification PDF". | file validation | CERTIFICATION |
| FILE-01 (png) | PNG, 8 KB. | file validation | CERTIFICATION |
| FILE-02 (docx) | 1.3 KB .docx. | file validation | rejection expected |
| FILE-02 (jpg) | 6.7 KB .jpg. | file validation | rejection expected |
| FILE-03 | 8,672,391 bytes (8.27 MB). | file validation | rejection expected |
| FILE-04 | 4,952,868 bytes (4.72 MB). | file validation/edge | CERTIFICATION |
| FILE-05 | Certificate, "Presigned Download Safety Test". | edge | CERTIFICATION |
| NAME-01 | Transcript, name exactly "Abdul Musawwir Siddiqui". | positive | EDUCATION |
| NAME-02 | Transcript, **"AbdulMusawwir Siddiqui"** (space removed). | edge | EDUCATION |
| NAME-03 | Transcript, **"John Doe"**. | negative | EDUCATION |
| NAME-04 | Transcript, **"Jon Smith-Doe"**. | negative | EDUCATION |
| NAME-05 | Transcript, correct name, **different degree** (MSc Data Science, conferral 2024). | cross-document | EDUCATION |
| NAME-06 | Transcript, correct name. Intended as the very first document uploaded. | cross-document | EDUCATION |
| ORG-01 | Transcript from King Saud University. | positive | EDUCATION |
| ORG-02 | Employment letter from Systems Limited Pakistan. | positive | WORKEXPERIENCE |
| ORG-03 | Transcript from "Institute of Advanced Space Studies, Zanzibar". | negative | EDUCATION |
| ORG-04 | Employment letter from "ByteCorp Solutions". | negative | WORKEXPERIENCE |
| ORG-05 | Transcript with **no issuer line at all**. | negative | EDUCATION |
| EDGE-03 (pdf) | Clean transcript, correct name. The corrected re-upload following NAME-03. | e2e | EDUCATION |
| EDGE-01/02/04/05/06 | `.txt` notes only. **No document exists.** | see section 6 | n/a |

---

## 3. Duplicate and redundant fixtures (STEP 3)

Two clusters are **byte-identical** (md5 verified):

- `a2fb79e0...` - **CONT-01, NAME-01, NAME-06, ORG-01** (4 files, one document)
- `9b46089e...` - **CONT-04, ENG-07, ORG-02** (3 files, one document)

Near-duplicates, differing only by an added field:

- **NAME-03 / ENG-03** - same "John Doe" defect; ENG-03 adds an issue date.
- **ORG-03 / ENG-04** - same unrecognised institution; ENG-04 adds a malformed date.
- **EDGE-03** - same content as cluster A, different bytes.

**These are not wasted fixtures, and the automation must not collapse them.**
Each cluster member exercises a different *context*, and the context is supplied
by the automation rather than by the file: which category it is uploaded as, what
declared data accompanies it, and **what was uploaded before it**. NAME-06 ("first
ever document") and NAME-05 ("same name, second document") are the clearest case,
near-identical files whose only distinguishing feature is upload order, because
`cross_document_consistency` is evaluated against history.

The consequence is a hard constraint on the runner: **upload order is part of the
test data, and the cross-document scenarios cannot be parallelised.**

---

## 4. Missing coverage (STEP 4)

Gaps found against the AC, none of which any current fixture reaches:

1. **No exact size boundary.** FILE-03 is 8.27 MB and FILE-04 is 4.72 MB. Neither
   sits on the documented 5 MB limit. Missing: exactly 5,242,880 bytes, and one
   byte under.
2. **The 4.5 MB AI inline limit is covered only by accident.** FILE-04 is under the
   5 MB upload limit but over the model's 4,718,592-byte inline limit, so it
   uploads and then can never be verified. That is a genuine product gap and
   deserves its own named scenario rather than being a side effect of one fixture.
3. **No corrupt, zero-byte, or password-protected file.**
4. **No multi-page document**, and none where page 2 contradicts page 1.
5. **No Arabic / RTL document**, on a product sold in Saudi Arabia.
6. **Declared-data cross-validation is tested on the name only.** The AC says the
   full legal name must match "all submitted documents and declared input", but
   nothing tests a declared *institution*, *degree* or *date* contradicting the
   document.
7. **No fixture can produce "Needs Review"**, because the status does not exist.
8. **No re-verification-after-declared-data-edit fixture** beyond the EDGE-04 note.
9. **No assertion that an APPROVED or REVISION document offers the agent no further
   action**, which the AC implies and which the dormant
   `features/Agent_Portal/Verification.feature` already drafts.
10. **Nothing checks `verified_at` immutability** (EDGE-06), because that field is
    not exposed on `DocumentVerificationDisplay` at all.

---

## 5. Fixture defects that will read as product defects if left alone

Called out because §15 says the automation must expose product bugs, and the
inverse rule matters just as much: **a fixture that does not contain the defect it
claims cannot be evidence of anything.**

- **AUTH-02 "visible tampering" contains no visible tampering.** Its only anomaly
  is the truncated string `Revis` at the end of an otherwise clean, cleanly
  rendered PDF. A vision model is right not to call that tampering. The recorded
  discrepancy (expected `fail`, got `uncertain`) is therefore most likely a
  **fixture defect, not an AI defect**. It needs a genuinely tampered document -
  visible overlay, mismatched fonts, a spliced region - before an expected result
  of `fail` is defensible.
- **DATE-02's filename contradicts its content.** "current_open_end" implies "to
  Present"; the letter says "to 31 December 2030". Under the AC ("not in the future
  unless the document is current/active") the correct expectation depends entirely
  on which of the two the fixture is meant to be. Left `ambiguous` pending an answer.
- **CONT-03 is a certificate being used to test transcript content.** Defensible
  *if* it is uploaded as an education document, which forces the
  `transcript_content` criterion to apply. Uploaded as a certification it proves
  nothing. The previous run uploaded it as `WORKEXPERIENCE`, which is why its
  result is not meaningful.
- **FILE-02 rejects `.jpg` while FILE-01 accepts `.png`.** Both confirmed live
  (HTTP 422 for jpg). Whether excluding a mainstream image format is intended is a
  product question, not a test one.

---

## 6. The EDGE fixtures: five of six have no document

`EDGE-01/02/04/05/06` are `.txt` notes describing an implementation detail to
verify. Assessed individually:

| ID | What it asks | Automatable? |
|----|--------------|--------------|
| EDGE-01 | Bedrock failure surfaces as an error, not a silent pass | Only by forcing model failure. Reachable honestly via FILE-04, which produces a real `ai_verification.error`. Otherwise infra-level. |
| EDGE-02 | Agent approve/revision save does not re-queue verification | Yes. Approve, then assert `ai_verification.version` and `checked_at` are unchanged. |
| EDGE-03 | Re-upload clears the stale AI comment | Yes, end to end: upload NAME-03, wait for the flag, re-upload EDGE-03, assert the prior AI comment is gone. |
| EDGE-04 | Agent comments survive re-verification; AI comments are stripped | Yes, if a declared-data edit reliably re-queues. Depends on `comments[].source` being correct, which is currently suspect. |
| EDGE-05 | Link-only save does not queue verification | Probably. Needs the link-only code path identified first. |
| EDGE-06 | `verified_at` is stamped once | **No.** The field is not exposed by any API response. Not automatable without a backend change. |

---

## 7. Proposed test-data structure (STEP 7)

One entry per document. Expected results live here and **only** here; actual
results are never written back into this file.

```jsonc
{
  "declared": {                     // the applicant's declared input (AC: cross-validation)
    "legal_name": "Abdul Musawwir Siddiqui"
  },
  "documents": [
    {
      "id": "ENG-01",
      "file": "ENG-01_clean_transcript_all_pass.pdf",
      "category": "EDUCATION",              // EDUCATION | WORKEXPERIENCE | CERTIFICATION
      "types": ["positive", "e2e"],
      "order": 10,                          // upload order; cross-document cases depend on it
      "declared": {                         // per-document declared data
        "institution": "King Saud University",
        "degree": "Bachelor of Science",
        "field_of_study": "Software Engineering",
        "start_date": "2018-09-01",
        "end_date": "2022-06-15"
      },
      "expected": {
        "upload": "accepted",               // accepted | rejected
        "http_status": 201,
        "final_status": "APPROVED",
        "criteria": {
          "identity_name_match": "pass",
          "date_validity": "pass",
          "issuing_organisation": "pass",
          "transcript_content": "pass",
          "cross_document_consistency": "pass",
          "authenticity": ["pass", "uncertain"]   // a list means any of these is acceptable
        },
        "extracted": {                      // optional, asserted only where stated
          "legal_name": "Abdul Musawwir Siddiqui",
          "issuing_organisation": "King Saud University"
        }
      },
      "known_defect": null                  // or a note; the test still FAILS
    }
  ]
}
```

Two deliberate choices:

- **`authenticity` accepts a set of verdicts.** The AC only requires a *valid*
  digital certificate to pass; for an ordinary scan neither `pass` nor `fail` is
  wrong, and pinning one would be inventing a requirement. Where the AC is
  definite (AUTH-03, no digital certificate at all) a single verdict is pinned.
- **`known_defect` annotates, it does not excuse.** A row carrying a known defect
  still asserts the expected value and still fails, per §15. The note only makes
  the report readable.

---

## 8. API response fields the automation must have (STEP 8)

| Field | Source | Used for |
|-------|--------|----------|
| HTTP status + body of the upload | upload POST | upload accepted/rejected, and the rejection reason |
| `id`, `file_name`, `version` | documents/all | identifying the row, detecting a re-upload |
| `status` | documents/all | final status assertion |
| `ai_verification.status` | documents/all | the AI's own verdict, distinct from document status |
| `ai_verification.criteria[].key/verdict/detail` | documents/all | per-criterion assertion, and the reason text the AC requires |
| `ai_verification.error` | documents/all | separating AI failure from AI verdict |
| `ai_verification.checked_at`, `.version`, `.model` | documents/all | completion detection, no-requeue assertion, model recorded in the report |
| `ai_verification.extracted.*` | documents/all | proving the AI read the right values, not merely landed on the right verdict |
| `comments[].comment/source/timestamp` | documents/all | who flagged it, stale-comment clearing, agent note |

**Completion detection.** There is no "AI finished" flag. `ai_verification` is
`null` until a run exists, then carries `checked_at` and `version`. So
"verification complete" is `ai_verification != null` with a `checked_at` newer
than the upload, polled to a timeout. That is a polled condition on real state,
not a fixed wait.

---

## 9. Measured after the plumbing was built (2026-08-24)

Everything below was observed by running the real client against the live API, not
reasoned about. Where it contradicts an earlier section, this section wins.

### 9.1 A genuine JPEG is refused by an endpoint whose own message allows it

This resolves the open question in section 5, and it resolves it as a **product defect**
rather than as a product decision.

```
POST /candidate/profile/certifications/   FILE-02_disallowed_jpg.jpg
  -> HTTP 422 {"file":["Only .jpg / .jpeg, .pdf, .png, .webp files are allowed."]}
```

The file is a real JPEG (magic bytes `ff d8 ff e0`, `JFIF` header), it is named `.jpg`,
and it is sent as `image/jpeg`. The validator refuses it while its own error message
lists `.jpg / .jpeg` first among the accepted formats. Reproduced twice.

The message is the only written statement of intent available, so the scenario
`Verify that a JPEG is accepted, since the endpoint's own error message allows it`
asserts acceptance and is `@known-issue`. **If dev confirms JPEG is meant to be
excluded, the MESSAGE is the bug and that scenario inverts** - either way the two
disagree today and something has to change.

The DOCX refusal is correct and its scenario passes.

### 9.2 cross_document_consistency cannot pass on this account, and cannot be made to

Measured with `node scripts/doc-verification-reset.js`:

| Figure | Value |
|--------|-------|
| Profile entries (education + work + certification) | 5 |
| Document rows | 78 |
| **Orphaned document rows** | **73** |
| Documents naming somebody other than the applicant | 4 |
| of those, reachable through a profile entry | 1 |
| **of those, orphaned and unremovable** | **3** |

The unremovable four are `Ali Hassan`, `Jon Smith-Doe` and two `John Doe` transcripts
left by earlier runs. The API has **no DELETE for a document row**, and deleting a
profile entry leaves its document behind.

Proved by consequence, not inferred: `FILE-01_allowed_pdf.pdf`, a clean sample uploaded
fresh, came back with

```
cross_document_consistency  fail  Name 'Abdul Musawwir Siddiqui' does not
                                  match 'John Doe' on another submitted document
```

and so did `ENG-01`, the one fixture designed to pass every criterion - its **only**
failing criterion was this one.

**Consequence: the isolation decision of "delete all documents before each run" is not
achievable through this API.** Three ways out, none of them free:

1. **A fresh candidate per run**, with its declared legal name set to match the
   fixtures. Costs a signup and an IMAP verification per run, and needs the profile name
   to be settable.
2. **Ask dev for a document DELETE** (or a test-data reset endpoint). Cheapest to run,
   needs a backend change.
3. **Accept it** and drop `cross_document_consistency` from every expectation, recording
   the criterion as untestable on a long-lived account. Honest, and loses real coverage -
   NAME-05 and NAME-06 exist for nothing else.

Until one is chosen, every `cross_document_consistency: pass` expectation will be red
for a reason that is not a product defect.

### 9.3 The AI itself is fast, and the timeout is not the constraint

7 to 15 seconds from upload to a completed verification, over 2 polls, across 5
documents. `DOC_AI_TIMEOUT_MS` is set to 180000 with a lot of headroom.

### 9.4 Two fixtures were rebuilt, and one backup was kept

`node scripts/make-doc-verification-fixtures.js`, verified by reading each file back
through the same `pdf-parse` reader the suite uses.

- **AUTH-02** rebuilt with tampering a reviewer would catch at a glance: a misaligned
  white-out patch over the original name leaving a sliver of it visible, the replacement
  name in a different typeface and size and off-baseline, a third typeface on another
  field, a tonal splice band with a seam line and the block beneath shifted, and a
  rotated `REVISED COPY` stamp over the body text. Text extraction now yields
  `Student Name: Faisal Al-Harbi   Abdul Musawwir Siddiqui`, so the alteration is
  evidenced in the text layer as well as visually. The original is kept once as
  `AUTH-02_transcript_visible_tampering.pdf.original` and a second run will not
  overwrite that backup.
- **DATE-06** added as the genuinely open-ended employment letter, so the AC clause
  "not in the future unless the document is current/active" has a positive case.
  DATE-02 keeps the future-end-date negative case.

### 9.5 A dotenv trap that reads exactly like a wrong password

`DOC_CANDIDATE_PASSWORD=StrongPass123!@#` silently becomes `StrongPass123!@`, because
dotenv treats an unquoted `#` as the start of a comment. The API then answers
`401 {"detail":"Invalid Credentials"}`, which is indistinguishable from a genuinely
wrong password. The value is quoted in `.env` and the reason is recorded beside it.

### 9.6 An AI-worded comment is stamped `source: "AGENT"`

Still open. Live document 26252 carries a comment reading "Authenticity could not be
confirmed: ... Name 'Abdul Musawwir Siddiqui' does not match 'John Doe' on another
submitted document" with `"source": "AGENT"`. The AC requires the candidate to see **who
flagged** the document, so if AI findings are written as `AGENT` the candidate is told a
human made a judgement that a model made. **Confirm with dev before filing** - it may be
that the agent genuinely copied the AI text into a note.

---

## 10. Mapping the declarative scenario set onto the fixtures (2026-08-24)

A 53-scenario declarative feature was proposed, one rule per scenario, written in
business language with no fixture ids in the Gherkin. **That style is adopted**: a red
row should name the rule that broke, not a fixture, and fixture ids are implementation
detail. The table-driven version this replaces was optimising for fewer uploads, which
is the wrong thing to optimise.

The mapping below is what makes it real. 53 scenarios, sorted by whether a document
exists that can satisfy them.

### 10.1 Backed by a fixture we already have (26)

| Scenario | Fixture |
|---|---|
| Approve a valid work experience letter | ENG-07 |
| Approve a valid certificate | ENG-06 |
| Approve when the legal name matches | NAME-01 |
| Approve a document with valid past dates | CONT-01 |
| Approve a document from a recognised institution | ORG-01 |
| Approve a transcript containing all required information | CONT-01 |
| Candidate resubmits a corrected document | NAME-03 then EDGE-03 |
| Flag when the full legal name does not match | NAME-03 |
| Flag when the name does not match another submitted document | NAME-01 then NAME-03 |
| Flag an unrecognised issuing institution | ORG-03 |
| Flag a future graduation date | DATE-01 |
| Flag a future issue date | ENG-02 |
| Flag an invalid date sequence | DATE-04 |
| Flag a transcript missing the major | CONT-02 |
| Flag a transcript missing multiple required fields | CONT-03 |
| Flag an e-transcript with no digital certificate | AUTH-03 |
| Flag an e-transcript with no tamper-proof features | AUTH-02 (rebuilt) |
| Resubmitting the same invalid document is not approved | NAME-03 twice |
| Handle an unreadable document | AUTH-05 |
| Different results across multiple documents | ENG-01 + NAME-03 + ENG-06 |
| A new verification cycle starts after resubmission | EDGE-03 |
| Previous failed criteria are not shown after correction | EDGE-03 |
| E2E name mismatch across documents | NAME-01 + NAME-03 + ENG-06 |
| E2E unrecognised institution | ORG-03 |
| E2E different results across documents | as above |
| E2E complete lifecycle | NAME-03 then EDGE-03 |

### 10.2 Need a fixture that does not exist yet, and can be generated (14)

`scripts/make-doc-verification-fixtures.js` already builds PDFs and verifies its own
output, so each of these is a generator entry rather than new tooling.

| Scenario | Fixture to build |
|---|---|
| Approve a current document with a valid future expiry | certificate, issue in the past, expiry in the future |
| Flag when only the FIRST name differs | `Ahmed Musawwir Siddiqui` |
| Flag when only the LAST name differs | `Abdul Musawwir Rahman` |
| Flag a transcript missing only the degree | major + conferral date present, degree absent |
| Flag a transcript missing only the graduation date | degree + major present, date absent |
| Flag an e-transcript with an INVALID digital certificate | a certificate block declaring itself invalid / signature mismatch |
| Handle different capitalisation | `ABDUL MUSAWWIR SIDDIQUI` |
| Handle extra spaces | `Abdul  Musawwir   Siddiqui` (NAME-02 is a REMOVED space, the opposite case) |
| Handle different name ordering | `Siddiqui Abdul Musawwir` |
| Handle a missing middle name | `Abdul Siddiqui` (the declared name has three parts, so this is derivable) |
| Handle an expiry equal to today | **must be generated at run time** - a fixed file is only correct on one day |
| Handle a future expiry on a current document | overlaps the first row; one fixture serves both |
| Handle a blank document | a valid single-page PDF with no text |
| Handle a handwritten document | **weak**: a handwriting-style font is not handwriting. Recommend dropping or sourcing a real scan. |

### 10.3 UI scenarios - the page objects are not built (9)

Agent views the document alongside the AI summary; agent submits a decision with a
mandatory reason; the empty-reason and spaces-only-reason validations; the candidate
seeing the reason and who flagged it; and the four E2E agent/candidate journeys. These
need an Agent Portal Document Review page object and a Candidate Portal documents page
object, neither of which exists. They were outside the "plumbing only" scope.

### 10.4 Cannot pass, for reasons that are not test defects (4)

- **Approve a valid transcript** and **Approve an authentic e-transcript** both require
  "a valid digital certificate". **No fixture can have one**, and more importantly there
  is no evidence the product verifies digital signatures at all - every `authenticity`
  detail observed so far talks about seals, scan quality and visible tampering. Asserting
  a passing digital-certificate check would be asserting a feature that may not exist.
  **Ask dev whether digital-signature validation is implemented before writing these.**
- **Approve when the name matches across all submitted documents** and the **E2E
  all-approved** scenario are blocked by the cross-document history in §9.2.

### 10.5 Three problems in the proposed set that need a decision

1. **`"Needs Review"` does not exist.** Eight scenarios use it as a status. The product
   has `AWAITING | APPROVED | REVISION`. Either the scenarios assert the AC and stay red
   on a status nobody implemented, or `Needs Review` is defined as "AWAITING with at
   least one non-passing criterion" and the steps assert that.
2. **`"Name mismatch detected"` and `"Issuing institution not recognised"` are the AC's
   example strings, not the app's.** The app produces "The legal name on the document
   'John Doe' does not match the applicant's declared name 'Abdul Musawwir Siddiqui'".
   Asserting the AC literal makes every one of those scenarios permanently red on
   wording, which buries the verdict they exist to check.
3. **Every scenario uploads, and uploads are permanent.** 53 declarative scenarios is
   roughly 70 uploads per run, none of them removable. That is the price of one rule per
   scenario, and it is worth paying - but it makes the isolation decision in §9.2 more
   urgent, not less.

---

## 11. The declarative rewrite, and what the two portals actually look like (2026-08-24)

The feature file was rewritten in the declarative style proposed in section 10: 60
scenarios, no fixture ids in the Gherkin, `npx cucumber-js -p docVerify --dry-run`
reports **60 scenarios / 745 steps with none undefined**.

### 11.1 How a scenario reaches a document

Each `Given` adds a property CONSTRAINT and the `When` resolves the document whose
recorded `properties` satisfy all of them. Ambiguity is the normal case, so resolution
prefers the document that satisfies the constraints and is otherwise **clean** - fewest
properties differing from the neutral baseline. That is what a declarative scenario
means: everything about the document should be fine except the thing under test. Ties
break on `order`, so a run is reproducible, and the chosen document is attached to the
report every time so a red row is still traceable to a file.

An unsatisfiable combination FAILS naming the constraints and the near misses. That is
the property that stops a scenario passing against a document which does not contain the
defect it claims - the mistake that made AUTH-02 look like an AI defect.

### 11.2 The status rename: the UI says "Needs Review", the API still says AWAITING

Confirmed on both sides. `StatusDa2Enum` is still `AWAITING | APPROVED | REVISION` and
still documents AWAITING as "Awaiting Verification", but the agent screen renders the
pill as **"Needs Review"**, and the filter tab's own test id is still
`agent-verifications-tab-awaiting-verification`. So the rename is presentation-level and
the mapping is `AWAITING == "Needs Review"`.

**A real inconsistency, asserted rather than smoothed over:** the filter tab reads
**"Need Review"** (singular) while the status pill reads **"Needs Review"**.

### 11.3 The AC's phrases are real - they live in the UI, not the API

The panel's "Flagged for" block renders exactly the strings the AC uses:

```
Authenticity could not be confirmed: The document appears to be a scan or printout, ...
Name mismatch detected: The legal name on the document ('John Doe') does not match
                        the applicant's declared name ('Abdul Musawwir Siddiqui').
Name is not consistent across the document: Name 'John Doe' does not match ...
Automated System Message
```

`ai_verification.criteria[].detail` carries the sentence but **not** the leading phrase.
So an assertion about what a person is SHOWN must read the panel, and one about the
verdict must read the API. The steps are split accordingly and the pairing is itself
asserted: `the criteria that failed should be listed with their reasons` compares the
API's failing criteria against the panel's text, so a criterion that fails server-side
but never reaches the screen is a finding.

**"Automated System Message" is the who-flagged label, not the AC's "AI Review".** A
wording divergence for the PO, not a functional defect. On the candidate side an agent's
decision is attributed to **"Agent"**.

### 11.4 The agent review panel, measured

| Thing | Finding |
|---|---|
| Route | `/verifications?activeFilter=ALL`, react-aria `<table role="grid">` |
| Test ids | `agent-verifications-tab-*`, `-view-button`, `-download-button`, `agent-request-revision-button`, `agent-approve-button`, `agent-submit-request-revision-button` |
| Document viewer | **react-pdf**: `.document-preview-container > .pdf-container > .react-pdf__Document > .react-pdf__Page > canvas.react-pdf__Page__canvas`. No iframe, no img, ever. |
| **Render time** | **~9.5 seconds.** `loading=true` through +8511ms, canvas present at +9545ms. |
| Semantic hooks | `document-information-section`, `flagged-for-section`, `right-section` |
| Request Revision dialog | "Reason for the request*", "This message will be visible to the candidate." |
| Approve dialog | "Approve document", "Reason for approval*", "Your note is recorded against the decision." |

**Mandatory reason works correctly on both decisions** (measured, and the three gating
scenarios pass): empty -> submit disabled, whitespace-only -> submit disabled, real
reason -> enabled.

**The 9.5-second render is a trap, not a defect.** A first version of `documentViewer()`
guessed `iframe, embed, object, canvas, img` and reported the document as absent on a
panel that was visibly showing it, because react-pdf was still painting its loader.
`waitForDocumentRendered()` now waits for a rendered PAGE rather than for the loader to
clear, because an error state also clears the loader and "failed to render" must not read
as "rendered".

### 11.5 >>> THE SUBMIT TEST ID IS DUPLICATED - A PRODUCT BUG <<<

The Approve dialog's submit button carries
`data-testid="agent-submit-request-revision-button"`, the same id as the Request Revision
dialog's. **Approving and requesting a revision are opposite, irreversible actions and a
test id cannot tell them apart.** Every method scopes to the open dialog and matches the
button's visible text, and `submitDecision()` refuses outright to click a control whose
label does not match the decision it was asked to make. Worth fixing in the build: the
next person to write a test id selector here will not know.

### 11.6 The candidate side

- **The documents are on `/dashboard`**, in a "Your Documents" block. `/documents` and
  `/my-documents` both render an **empty body**. Anyone looking for a documents page will
  conclude the feature is missing.
- The View panel is the same "Document Verification" dialog minus the decision controls,
  plus a **"Comment History"** block rendering `<comment> <source> - <timestamp>`.
- **THERE IS NO RESUBMIT CONTROL IN THAT PANEL.** Measured: zero `<input type="file">`,
  one "Download" button. So the AC's "the candidate must be able to resubmit a corrected
  document" is not satisfied from the place the candidate is told what to correct.
  Whatever path exists is elsewhere (the profile sections, which is what the API-level
  resubmit drives). `resubmitControl()` returns what it finds so a scenario reports the
  absence as a finding instead of timing out.

### 11.7 What has been verified live, and what has not

**Run and passing:** the two integrity scenarios; the full-legal-name mismatch scenario
(13 steps, resolver + upload + AI + reason assertions); the agent review scenario (14
steps, including the react-pdf render and the UI-vs-API reason comparison); all three
mandatory-reason gating scenarios (37 steps).

**Not yet run live:** the candidate-portal scenarios, the resubmission scenarios, the
multi-document scenario, and the file-validation scenarios in their new declarative form
(their previous table-driven equivalents passed). **A full `-p docVerify` run has NOT been
performed** - it costs roughly 70 permanent uploads and every expectation is still
PENDING, so it should wait for the expected-results table.

---

## 12. Live walkthrough of both portals (2026-08-24) - three earlier conclusions corrected

Driven through the Playwright MCP browser against the live app, plus an API sweep of all
96 documents on the account (80 of which carry an AI run). **Where this contradicts
sections 9-11, this section wins.**

### 12.1 CORRECTION: `cross_document_consistency` is variable, not permanently failing

Section 9.2 concluded it "CANNOT pass on this account" because of unremovable history.
**That was wrong.** Across the 80 AI runs on this account:

| verdict | count |
|---|---|
| pass | 26 |
| uncertain | 5 |
| **fail** | **43** |

It passes routinely. The earlier conclusion generalised from a run in which it happened
to fail. The `@known-issue` tag has been removed from
`Approve a document when the name matches across all submitted documents`.

It does appear to **vary between runs on similar documents**, which is worth asking dev
about - but "sometimes fails" and "can never pass" are very different findings and only
the first is true.

### 12.2 CORRECTION: auto-approval WORKS

Exactly **one** document on the account passed every criterion -
`ENG-01_clean_transcript_all_pass.pdf` - and its status is **APPROVED**. So the AC clause
"documents that pass all verification criteria must be approved without requiring any
agent action" is satisfied. The recorded 2026-08-21 discrepancy (expected APPROVED,
observed AWAITING) no longer reproduces; `known_defect` is cleared on ENG-01.

Status spread: APPROVED 11, REVISION 24, AWAITING 61.

### 12.3 CORRECTION: the comment source taxonomy is fine

Section 9.6 flagged an AI-worded comment stamped `source: "AGENT"`. Across the account the
sources are **AI 19, AGENT 8**, so the distinction does exist. The single odd row was most
likely an agent pasting AI text into their own note. Not a defect - do not file it.

### 12.4 >>> THE CANDIDATE IS NEVER SHOWN THE AI's REASONS <<<

**This is the most serious finding of the walkthrough, and it is an AC violation.**

The AC: *"If a document is flagged, the candidate must be notified with a clear message
explaining what needs to be corrected or resubmitted."*

- The **agent's** panel has a "Flagged for" block derived live from
  `ai_verification.criteria`, rendering "Name mismatch detected: ...", "Authenticity could
  not be confirmed: ...".
- The **candidate's** panel has **no such block**. It shows only stored COMMENT rows.
- **Of 71 documents carrying a failing criterion, 52 have no comment at all.**

So for roughly **three quarters of flagged documents the candidate sees a status and
nothing else** - no reason, no instruction, nothing to act on.

### 12.5 The two portals label the same status differently

| API status | agent queue | candidate Profile > Documents |
|---|---|---|
| `AWAITING` | **"Needs Review"** | **"Awaiting Verification"** |
| `REVISION` | "Revision Required" | "Revision Required" |
| `APPROVED` | "Approved" | "Approved" |

A candidate and an agent looking at the same document read two different words for its
state. (The agent's own filter tab adds a third wording, "Need Review", singular.)

### 12.6 The candidate's two document surfaces disagree, and neither is complete

| Surface | Lists | Clicking a document |
|---|---|---|
| `/dashboard` "Your Documents" | a **SUBSET** - 4 rows while the account held 96, all from March-May | opens the verification panel |
| `/profile?selectedTab=documents` | **every** document including that day's | **downloads the file** |

The surface that lists everything explains nothing; the surface that explains things does
not list everything. **A candidate whose document was flagged today cannot find it on the
dashboard at all.** `/documents` and `/my-documents` render an empty body.

Minor: clicking a document on the Documents tab also resets the tab back to Candidate
Details.

### 12.7 >>> AN ONBOARDED CANDIDATE HAS NO WAY TO UPLOAD OR RESUBMIT <<<

The AC: *"The candidate must be able to resubmit a corrected document [starting] a new AI
verification cycle."*

Measured on a fully onboarded candidate:

- `/profile?selectedTab=candidate-details` - **46 interactive controls, not one of them an
  edit, add or upload**, and **zero** `<input type="file">`. Education, work experience and
  certification entries are read-only, showing "Attachment: <file>".
- `/profile?selectedTab=documents` - no upload control; clicking downloads.
- `/dashboard` document panel - zero file inputs, one "Download" button.
- `/onboarding` - **redirects to `/dashboard`**; onboarding is one-way and already complete.

**So there is no UI path by which this candidate can upload a new document or replace a
flagged one.** The suite's resubmission scenarios work only because they drive the API
directly (`PATCH /candidate/profile/<category>/<id>/` with a new file). Ask dev where the
candidate is expected to do this - if the answer is "only during onboarding", the AC's
resubmission requirement is unimplemented.

### 12.8 Confirmed working

- Auto-approval on an all-pass document (12.2).
- The agent panel shows the document alongside the AI summary, with the failed criteria
  and their reasons, and names the source.
- Mandatory reason is enforced on **both** decisions - empty and whitespace-only are both
  refused, a real reason enables submission.
- A settled document (APPROVED / REVISION) offers the agent **no decision controls**, so
  the AC's "decide only on Needs Review" holds. Scenario passes.

---

## 13. Corrections after the product owner's review (2026-08-24)

Two findings in section 12 were wrong. Both are corrected here and in the suite.

### 13.1 CORRECTION: the upload path exists - Profile > Candidate Details

Section 12.7 claimed an onboarded candidate had "no way to upload or resubmit". **Wrong.**
Each of **Education**, **Work Experience** and **Certifications** carries an add and an
edit control in its section header, and the add control opens a modal with a file input.

**Why every scan missed it, which is itself the finding:** the controls are bare
`<svg class="add-icon">` / `<svg class="edit-icon">` elements. No `<button>` wrapper, no
`role="button"`, no `aria-label`, no `data-testid`. Queries for buttons or accessible
names return nothing. Two things compounded it: the browser was at **732x701** (narrow
layout) and the page scrolls inside `<main>` (**6139px** of content in an 836px box), so
early scans only ever saw the top of the page.

The modals, captured live:

| Section | Required fields | File control |
|---|---|---|
| Add Education | University/Institution Name*, Degree*, Field of Study* (all type-to-search comboboxes), start + end month/year | "Upload Transcript" |
| Add Experience | employment-type select, Company Name* (search combo), Role/Job Title* (text), start month/year, "I currently work here", end month/year | "Upload Experience Letter" |
| Add Certification | Certificate Name*, Issuing Organization* (both text), issue month/year, expiry month/year | "Click to upload" |

Field NAMES are React-Hook-Form array paths (`certificationItems.3.title`) whose index
depends on how many entries already exist, so nothing locates by name - the page object
uses labels and dialog-relative positions.

### 13.2 >>> A REAL DEFECT: THE UPLOAD CONTROLS ARE INACCESSIBLE <<<

The same fact that hid them from the automation locks real users out. Measured live, the
scenario `The document upload controls are reachable by assistive technology` fails with:

```
9 document add/edit control(s) are bare <svg> elements with no button wrapper,
no role, no aria-label and no tabindex.
```

An `<svg>` with no role and no tabindex is **not keyboard focusable and invisible to
assistive technology**. A keyboard-only or screen-reader candidate cannot add a
qualification or upload a document at all. Worth filing on its own.

### 13.3 CORRECTION: the candidate's silence before a decision is BY DESIGN

Section 12.4 called it "the most serious finding" that the candidate is never shown the
AI's reasons, on the strength of 52 of 71 flagged documents having no comment. **The
product rule is that remarks reach the candidate only AFTER the agent's final decision**
(Request Revision or Approve). Those 52 documents are all still awaiting a decision, so
showing nothing is correct.

12.4 is withdrawn as a defect. It is now asserted as a RULE, in both directions:

- `A candidate is told nothing about a document still awaiting a decision` - asserts the
  silence is correct, so AI findings leaking to the candidate early would be caught.
- `After a decision the candidate sees the remark and the AI findings behind it` - asserts
  that once decided, the candidate gets the agent's remark **and** the AI findings that
  led to it, attributed to the automated system (product decision, 2026-08-24).

### 13.4 What now runs where

| Command | Scenarios |
|---|---|
| `npm run test:doc-verify-bdd` | 69 - everything except the permanent uploads |
| `npm run test:doc-verify:upload` | 3 - the real Profile > Candidate Details uploads |
| `npm run test:doc-verify:one -- --name "..."` | one, by name or `file:line` |

`@creates-profile-entry` is excluded from `docVerify` for the same reason
`@creates-community` is excluded from the default profile: each save creates a profile
entry **and** an unremovable document row.

### 13.5 The DEV API was severely slow during this session

Three consecutive login calls timed at **31.9s, 9.4s, 4.6s**, and the MCP browser failed
with `net::ERR_FAILED` because requests timed out. That is the cause of "the portal loads
very late" - the backend, not the automation. Earlier the same day the same call took
~2s, so it varies widely. Nothing in the suite can compensate for it; the timeouts are
already generous.

---

## 14. Do the AI messages reach the candidate after a decision? NOT CONFIRMED (2026-08-24)

Asked directly, and checked rather than assumed. **The answer is no, on the evidence
available**, and the scenario that asserts it FAILS live.

### 14.1 The AI messages exist

Of 99 documents on the account, **35 are decided** (REVISION or APPROVED):

| | count |
|---|---|
| decided documents carrying an **AI** comment | **17** |
| decided documents carrying an **AGENT** comment | 7 |
| decided documents carrying **no comment at all** | 11 |

So the AI does write candidate-visible comment rows, e.g. on a REVISION document:

```
[AI] The legal first and last name on the document does not match the applicant's
     declared name. The name used is not consistently everywhere it ...
```

### 14.2 But the candidate cannot reach any of them

The only candidate surface that renders the Comment History panel is the **dashboard**
"Your Documents" block, and it lists **4** documents while the account holds 99. Those
four carry only AGENT comments (`"revision"`, `"rf"`) or none at all.

```
decided documents carrying an AI comment ................. 17
...of those reachable on the candidate dashboard .......... 0
```

`Profile > Documents` lists every document but **downloads** on click - no panel, no
remarks. So there is no route by which this candidate can read any of the 17 AI messages.

### 14.3 The scenario fails live, and names the cause

`After a decision the candidate sees the remark and the AI findings behind it`:

```
No document card matches "CONT-03_transcript_only_degree_rkDY4Mr" on the candidate dashboard.
The dashboard lists 4: Empty_GYFa8Bv.png [Approved], Screenshot_..._RD5y5VY.png [Revision
Required], output-onlinepngtools.png [Revision Required], Screenshot_..._q66FS7q.png [Approved]
```

**This is a product finding, not a locator problem**, and `findCard()` now says so in the
failure message so nobody spends time "fixing the selector".

### 14.4 The open question for dev

Why does the dashboard list only 4 of 99? It is not "the most recent" - all four are from
April/May while 31 newer decided documents exist. Until that is answered, the AC clause
*"the candidate must be notified with a clear message explaining what needs to be
corrected"* is **unverifiable through the UI**, because the message exists in the API and
has nowhere to be displayed.

### 14.5 Reader defect fixed at the same time

`readDocumentCards()` was walking up the DOM until it swallowed the whole dashboard - the
streak calendar and "Welcome Back" header included - and reporting that blob as a
document card. A card now has to contain a FILE NAME, not merely a status word. Same
over-capture that `CommunityPage.readMemberCards()` was fixed for.
