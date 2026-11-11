# AI Document Verification

**80 scenarios across 2 feature files.** Merged into a single application file on
**2026-09-01**. The module went 11 files (criterion-per-file) -> 8 (2026-08-25) -> 9 (the
status lifecycle) -> **2**.

> **The module is now BROWSER-DRIVEN by default.** Every document is uploaded through the
> candidate's own **Profile > Candidate Details** form, the way a candidate does it, rather
> than posted to the upload endpoint. See **`DOC_UPLOAD_MODE`** below - that switch is the
> single most important thing to understand about running this module.

## The two files

| File | Scenarios | What it owns |
| --- | --- | --- |
| `ai-document-verification.feature` | 78 | **the whole application module**, in 8 titled sections |
| `test-data-integrity.feature` | 2 | the suite's own fixtures - NOT the application |

`test-data-integrity.feature` stays separate for two reasons, and both matter. A red row there
means **the automation is about to test the wrong thing**, which is a different message from
"the product is wrong". And it has **no Background on purpose** - it needs no account and no
API - so folding it into the merged file would hand its scenarios a login and an
API-reachability check, and an outage would then report "your fixtures are broken" when they
are fine. That inverts the purpose of the one file that tells you whether to trust the others.

### Every scenario name starts with "Verify that ..."

Applied **2026-09-01** to both files, matching the convention `features/Promo_Code/` already
follows. The form is `Verify that <lowercase declarative clause>`, with proper nouns and
acronyms keeping their case - AI, JPEG, Need Review, Documents tab. **Keep it** - a new
scenario that does not start with "Verify that" is inconsistent with all 68 of its neighbours.

**It was not a prefix-and-lowercase job, and a future one will not be either.** About a third
of the old names were IMPERATIVE - "Approve a document when...", "Flag a document...", "Do not
apply...", "Read a blurry document..." - and prefixing those gives "Verify that approve a
document when...", which is not English. Each had to become a declarative clause, a judgement
per name. So write a new scenario in the new form rather than reaching for a regex.

Scenario names are read by nothing except the artifact filenames (screenshots, videos,
traces), so a rename cannot break a step. What a rename CAN break is which scenarios a profile
selects, so it was proven it did not:

```
node scripts/check-profile-selection.js --by line --save before.json
# ...rename...
node scripts/check-profile-selection.js --by line --compare before.json
```

`--by line` is the mode for a rename: the default compares scenario NAMES, which a rename
makes useless (every entry looks deleted and re-added). Renaming in place changes no line
numbers, so `file:line` identifies each scenario exactly. **All 31 profiles were unchanged**,
and cucumber's own dry-run agreed: 80 in the module, 71 / 5 / 5 / 1 / 10 / 7 / 80 per profile,
374 for the default profile.

### The 8 sections inside the merged file

Each was a file before 2026-09-01, and each keeps **its own area tag on every one of its
scenarios**, so `--tags` still slices the module exactly as the files used to:

| Section | Tag | Scenarios | What it owns |
| --- | --- | --- | --- |
| 1 | `@core-criteria` | 33 | the six verification rules, one block each, plus readability |
| 2 | `@upload-validation` | 11 | the real upload form, accepted formats, size limits, presigned links, accessibility |
| 3 | `@auto-approval` | 5 | a clean document reaching Approved with no agent action |
| 4 | `@agent-review` | 10 | the Agent Portal review panel, decision gating, and the queue |
| 5 | `@candidate` | 3 | what the candidate is told, and when |
| 6 | `@resubmission` | 3 | the correction loop, and that a verdict is never replayed |
| 7 | `@status-lifecycle` | 10 | the status from upload to final decision on BOTH portals, and which comment reaches the candidate |
| 8 | `@e2e` | 6 | the full chain across both portals |

Those counts sum to 81 rather than 78 because **3 scenarios legitimately carry two area tags** -
they did before the merge too (an `e2e.feature` scenario tagged `@agent-review` at scenario
level, for instance). Nothing was duplicated.

```
npx cucumber-js -p docVerify --tags "@core-criteria"   # exactly what core-criteria.feature ran
```

### >>> WHAT THE MERGE CHANGED, AND HOW IT WAS PROVEN SAFE <<<

All 9 files **already shared one step-definition file**, because cucumber loads step
definitions globally. So the merge changed no step, no page object and no fixture. It is pure
Gherkin reorganisation, and there was exactly one real edit:

**Every area tag moved from feature level onto each scenario.** A feature-level tag applies to
every scenario in the file, and this module's profiles filter on tags. Had `@status-lifecycle`
been left at feature level in the merged file, `npm run test:doc-lifecycle` would have selected
**all 78 scenarios instead of 10** and committed dozens of irreversible agent decisions. Only
`@doc-verification` stays at feature level, which changes nothing - it already applied to
every scenario in all 9 files.

**Proven, not assumed.** `node scripts/check-profile-selection.js` parses the Gherkin, evaluates
each profile's own tag expression, and compares the **set of scenario names** per profile -
not the count, because a count is unchanged if a merge drops one scenario and admits another.
**All 30 profiles selected identical scenarios before and after.** Cucumber's own dry-run
agrees: 71 / 71 / 5 / 5 / 1 / 10 / 7 and 374 for the default profile, all unchanged. Run that
script after any change to tags or file layout here.

**One deliberate behaviour change, and it is the only one.** `upload-validation.feature` had a
**one-step** Background where the other seven had the same three steps, so its 11 scenarios
gained two: `the candidate has provided their legal first and last name` (a pure in-memory
fixture assertion, no network) and `the AI verification service is available` (one
`GET institutions/?page_size=1` asserting status < 500 - an API liveness check, not a model
call). That is the whole of the +22 in the module's step count, 1013 -> 1035. Both are guards
that make a failure more informative, and neither couples those scenarios to the AI.

**The VS Code Test Explorer shim was re-pointed to `docAll`.** It maps a file to a profile, and
the merged file holds scenarios `docVerify` deliberately excludes (`@mutates-document`,
`@creates-profile-entry`) - so pointed at `docVerify`, clicking one in the gutter would report
`0 scenarios` and show as skipped. `docAll` admits everything but `@not-automatable`. Note
this means a gutter click there really does spend a permanent upload or an irreversible
decision; `docAll` is therefore **not** a routine command.

`test-data-integrity.feature` is deliberately separate: a red row there means the automation
is about to test the wrong thing, which is a different message from "the product is wrong".

**Steps for all 8 files live in ONE place** - `features/step_definitions/document-verification.steps.js`.
Cucumber loads step definitions globally, so splitting the features does not and must not
split the steps: a second step file would duplicate the API client, the browser contexts and
the teardown hook, and the two copies would drift.

## The six criteria, and which file covers each

| Criterion | The rule | Covered in |
| --- | --- | --- |
| `identity_name_match` | Legal first and last name must match the applicant. | `core-criteria` (Identity), `e2e` |
| `cross_document_consistency` | The full legal name must match across all submitted documents and declared input. | `core-criteria` (Cross-document) |
| `issuing_organisation` | The issuing institution/organisation must be recognised. | `core-criteria` (Institution), `e2e` |
| `date_validity` | All dates must be logically valid, and not in the future unless the document is current/active. | `core-criteria` (Dates) |
| `transcript_content` | Degree, major/field of study and graduation date must all be present. | `core-criteria` (Transcript) |
| `authenticity` | e-transcripts need a valid digital certificate and tamper-proof features. | `core-criteria` (Authenticity) |

Type tags slice **across** the files, so both cuts work - by area (one file) or by type:

```
npx cucumber-js -p docVerify --tags "@negative"
npx cucumber-js -p docVerify --tags "@positive and @identity"
npx cucumber-js -p docVerify "features/AI Document Verification/core-criteria.feature"
```

## >>> `DOC_UPLOAD_MODE` - ui (default) or api <<<

| | what it does | when to use it |
| --- | --- | --- |
| `ui` **(default)** | fills the real Education / Work Experience / Certification modal, attaches the file, saves | watching the product; any run whose result you will report |
| `api` | posts straight to the upload endpoint | diagnosing an assertion, not the app - far faster |

```
npm run test:doc-verify:ui                       # watch it
SLOWMO=400 npm run test:doc-verify:ui            # watch it at a followable pace
DOC_UPLOAD_MODE=api npm run test:doc-verify-bdd  # the fast path
```

**Both modes create the same permanent document row.** There is no DELETE for a document row
anywhere in the API, so `api` is not the cheap mode in the sense that matters - it only costs
less time.

**Two classes of document stay on the API path whatever the mode**, and this is what those
scenarios are *about*, not a limitation:

- anything with a `file` property - disallowed format, oversized, the allowed-format pair, the
  near-inline-limit file. Those assert the **endpoint's** policy: an HTTP status and the message
  it returns. A form grey-ing out a `.docx` proves the client blocks it, which is a weaker and
  different claim - and "each allowed format" sends two files, which no single form submission does.
- anything whose category has no profile form. There is none today; the check exists so a new
  category fails loudly instead of silently reverting to the API.

The route taken is attached to the report on **every** upload, so a green run always says how
the document got there.

## The form fillers read the document's own `declared` block

Each fixture in `test-data/document-verification/documents.json` carries a `declared` block -
the values a candidate would type alongside that file - and the fillers read **that**, never
constants of their own. This is not tidiness: `issuing_organisation` and several date rules are
evaluated by comparing the document against **what the candidate declared**. A filler with
hardcoded values would declare "King Saud University" for a fixture whose whole point is an
unrecognised institution, and the AI would then correctly report a mismatch the scenario never
asked for - the exact class of false finding that inflated the measured AI mismatch rate from
5.3% to 10.2% until the verdict probe learned to separate the two.

Measured layouts, because two of the three modals are not what they look like:

| Modal | `<select>`s | The trap |
| --- | --- | --- |
| Add Education | `[startMonth, startYear, endMonth, endYear]` | all three text fields are real comboboxes - each needs an **option picked** |
| Add Experience | `[employmentType, startMonth, startYear, endMonth, endYear]` | **index 0 is not a month.** And **"Company Name" is a PLAIN TEXT INPUT** despite its "Search" placeholder - no `role="combobox"`, no listbox, no options, ever |
| Add Certification | `[issueMonth, issueYear, expiryMonth, expiryYear]` | none |

A null end/expiry date is how the test data records ongoing employment and a non-expiring
certificate; the form models that with a **checkbox**, and the end month/year are required
without it - so ticking it is what lets Save enable. That checkbox is an `<input>` hidden behind
a styled `<div>` that intercepts clicks, so it is toggled by a DOM click on the input and the
resulting state is **verified**, never assumed.

Reach for `node scripts/probe-candidate-profile-experience-form.js` (dumps every control in
both modals) or `node scripts/probe-company-combobox.js` (the two widgets side by side) before
changing any of this. Neither saves anything.

## Uploads happen ONCE, after every Given is known

A `Given` **queues** an upload; the queue is flushed by the first step that needs the document.
The opening `Given` used to upload immediately and a later refinement then asserted that the
already-uploaded document happened to satisfy it, which was wrong twice over:

- **it picked the wrong document.** "Given the candidate has uploaded a certificate / And the
  document is currently active with an expiry date that is today" resolved the *cleanest*
  certificate on the first line and only then discovered the refinement wanted a different one.
  It failed with "put the narrowest Given first", blaming the feature file for the design's own
  ordering constraint.
- **it spent a permanent upload on the wrong document first.** With no DELETE for a document
  row, that failure left the wrong certificate on the account - twice.

Resolving after every constraint is known means the account only ever receives the document the
scenario actually wanted. An unsatisfiable combination still fails, naming both constraints.

## How to run

```
npm run test:doc-verify:dry          # free: credentials, reference data, all 54 fixtures. Uploads nothing.
npm run test:doc-verify:ui           # 65 scenarios, browser-driven. THE ONE TO WATCH.
npm run test:doc-verify-bdd          # the same 65. PERMANENT uploads.
npm run test:doc-verify:upload       # 4 scenarios through the profile form. Permanent entries.
npm run test:doc-verify:walkthrough  # 1 document, the whole chain, visibly
npm run test:doc-verify:decisions    # 2 scenarios. COMMITS REAL AGENT DECISIONS. Irreversible.
npm run test:doc-verify              # standalone reported runner over all 54 documents

npm run test:doc-lifecycle           # 10 scenarios: the STATUS from upload to decision, both portals
npm run test:doc-lifecycle:read-only # the 7 that decide nothing

# one file - quote it, the path contains spaces
npx cucumber-js -p docVerify "features/AI Document Verification/core-criteria.feature"
```

A targeted run **must name a profile**. `@doc-verification` is excluded from the default
profile, and a CLI `--tags` is ANDed with the profile's expression rather than replacing it -
so `npx cucumber-js <file>` and `npx cucumber-js <file> --tags @doc-verification` both report
`0 scenarios`. That is the profile filter, not a broken scenario.

## Five things to know before reading a red row

1. **"Needs Review" is the UI's name for the API's `AWAITING`.** The API enum is
   `AWAITING | APPROVED | REVISION` - there is no `NEEDS_REVIEW` - so the AC's three-status
   model does not map onto the product.
2. **The AC's phrases are real, but they live in the UI.** `"Name mismatch detected:"` is
   rendered in the panel's "Flagged for" block and is **not** in `criteria[].detail`. A step
   asserting what the agent is *shown* reads the panel; a step asserting the verdict reads the
   API. They are not interchangeable.
3. **No fixture ids appear in the Gherkin, on purpose.** Each `Given` adds a property
   *constraint* and the document in `Files/Test_doc` whose recorded `properties` satisfy all of
   them is resolved. An unsatisfiable combination **fails**, naming the constraints and the near
   misses, rather than quietly picking something close. The chosen document is attached to the
   report every time, so a red row is still traceable to a file.
4. **UPLOADS ARE PERMANENT.** There is no DELETE for a document row anywhere in the API.
   `@doc-verification` is excluded from the default profile and that exclusion must stay.
5. **>>> `cross_document_consistency` CANNOT PASS ON THIS ACCOUNT, AND THAT IS NOT A PRODUCT
   DEFECT. <<<** The candidate is dedicated but long-lived and holds documents naming other
   people, several of them **orphaned** - the profile entry is gone but the document row cannot
   be deleted. So a document that is genuinely clean on the other five criteria is still held
   back from Approved. Proved by consequence, not inferred: `ENG-01`, the one fixture designed
   to pass everything, failed on this criterion **and only this one**. The status step detects
   the case and says so in its failure message; remedies are in
   `Files/DOC_VERIFICATION_TEST_MATRIX.md` section 9.2 and **none is chosen yet**. Do not file
   this as "the product will not auto-approve a valid document" without reading that first.

## The status lifecycle: `status-lifecycle.feature` (added 2026-09-01)

**`npm run test:doc-lifecycle` - 10 scenarios, 7 passed / 3 failed, 10m 17s (MEASURED
2026-09-01).** The three reds are exactly the three `@known-issue` scenarios listed below. A
green run means *those three* are red and nothing else.

This file is the answer to "does the status actually work". Everything else in the module
tests a verification RULE; this tests the STATE MACHINE, and checks it on both portals at
every step.

### >>> THE MECHANISM. READ THIS BEFORE TOUCHING ANY STATUS ASSERTION. <<<

The AI writes the **final status itself** - `ai_verification.status` becomes the document's
status, it is not advice an agent then acts on. And **which comment reaches the candidate
depends on who decided**:

| The AI's verdict | Status | What the candidate is told |
| --- | --- | --- |
| every criterion passes | `APPROVED` | nothing - `comments: []`, no agent involved |
| `date_validity: fail` | `REVISION` | the **AI's own comment**, stamped `source: "AI"`, holding the failed criteria as prose |
| any other criterion non-pass | `AWAITING` = Need Review | nothing yet; the **agent** decides, and the candidate then sees the **agent's reason**, stamped `source: "AGENT"` |

So the two comment cases are **opposite**, and the file asserts both in both directions - an
agent-decided document must show the agent's reason and must **not** present the AI's findings
as the reason, because "the agent comment is shown" is satisfied perfectly well by a panel
showing both.

### Which criterion decides the status - measured, because nothing specifies it

Cross-tabulated over every verified row on the account with
**`node scripts/probe-doc-status-rule.js`** (read-only, uploads nothing). It held in **33 of
33**:

```
all six criteria pass          -> APPROVED   (1 of 1)
date_validity: fail            -> REVISION   (3 of 3)
any OTHER criterion non-pass   -> AWAITING   (30 of 30)
```

**`date_validity` is the discriminator** - present in every REVISION row, absent from every
AWAITING one. `identity_name_match: fail`, `issuing_organisation: fail`,
`authenticity: uncertain` and `cross_document_consistency: fail` all leave the document for
an agent. **Re-run that probe after any model or prompt change**; the rule is empirical, so it
is exactly the kind of thing that goes stale unnoticed.

Two scenarios lost their `@known-issue` tag on this evidence, and both then passed:

- **A name mismatch IS left for an agent** (Need Review), not auto-rejected. It was tagged on
  the assumption that a hard fail drives REVISION; only `date_validity` does.
- **A future-dated document IS auto-rejected** with the AI's own explanation. **Expect this one
  to flake** - `date_validity` is one of the unstable criteria, and if the AI passes it the
  document lands at Need Review instead. A red row there is model variance, not a regression.

### The three fixtures

`Files/3 documents(Approved,requestrevision & need review)/`, registered in the test data as
`EDU-APPROVED` / `EDU-REVIEW` / `EDU-REJECTED`. That folder is wired in as a **second**
fixture directory rather than merged into `Files/Test_doc`, and `resolveFixture()` treats a
name present in both as a hard failure - it refuses to choose, because two fixtures sharing a
name would silently rebind a scenario to the wrong file.

**`EDU-REJECTED`'s declared dates deliberately do NOT match its document.** The document states
conferral 2035-01-15; the Education form's year dropdown offers **1977-2026 only** (measured),
so a future graduation date is not expressible on the form at all. An earlier version declared
2030/2035 and the upload died with `selectOption: did not find some options` - a fixture fault
that reads as a broken form. `date_validity` therefore fails for two reasons at once, which is
fine: the assertion is on the STATUS the failure produces, not on the wording of the reason.

### The candidate's two surfaces answer different questions

| Surface | Answers | Does not |
| --- | --- | --- |
| `/profile?selectedTab=documents` | did it arrive, and what state is it in - **every** document, one status badge each, grouped Education / Work Experience / Certifications | show any reason; its filename button does nothing at all |
| `/dashboard` "Your Documents" | **why** - its View opens the Document Verification panel | list more than **4** documents |

**Two notes in `CandidateDocumentsPage` were STALE and are corrected.** That tab does carry a
status now, and it labels `AWAITING` **"Needs Review"** - the same string the agent pill uses,
not "Awaiting Verification". `STATUS_LABEL` held the old value, and since `readDocumentCards()`
classifies rows by those strings it returned **0 cards on a dashboard plainly showing four**. A
reader that can only ever answer "absent" is the trap this repo has paid for repeatedly.

**There was also a SECOND reader for that one surface** - `CandidateProfilePage.readDocumentsTab()`
had its own DOM walk. It now delegates to `CandidateDocumentsPage.readDocumentsTabRows()`. Two
readers for one surface is the single most expensive class of defect in this repo, and every one
of the five community-module faults was an instance of it.

### The panel is reached through a widened page, and it says so

The dashboard block requests `?page=1&page_size=4` with **no pagination control**, so the panel
of a document uploaded minutes ago is otherwise unreachable. The comment scenarios call
`widenDashboardPaging()`, which rewrites **only the page size of a request the app already
paginates** - every row, status and comment still comes from the server and is still rendered by
the app - and the widening is attached to the report every time.

**The cap has its own scenario, and that one does NOT widen.** If it did, the cap would never be
observed and the workaround would be hiding the defect it exists to work around.

### The three expected reds

1. **A clean document cannot auto-approve on this account** - `cross_document_consistency` is
   the only failing criterion. **Environmental, not a product defect**: the account holds
   documents naming other people and document rows cannot be deleted. Measured both ways in one
   day - `EDU-APPROVED` reached APPROVED with all six passing in the morning, and after three
   transcripts naming another person went on, the same file reached only Need Review.
2. **The candidate cannot reach the reason for 57 of 61 documents** - `page_size=4`, no
   pagination, and this block is the only surface that shows a reason. Real product defect.
3. **Clicking a document on the Documents tab does nothing** - no dialog, no download, no
   navigation, no request, on a real `<button>`. Real product defect, `@needs-clarification`.

### Two questions settled, both of which looked like defects

- **An approved document DOES remain visible to the candidate.** `GET /candidate/documents/`
  was measured returning 29 rows while omitting the one APPROVED row, which would have meant a
  candidate could never see their document approved. That row was **orphaned** - uploaded with
  no profile entry, and this account has held 73 such rows. The scenario uploads through the
  real form and has the agent approve it, and the document stays in the endpoint and on the tab.
  Now a passing regression lock.
- **The premise "an ordinary scan is left undecided" is false**, and it cost a permanent upload
  to learn. 8 of 8 DATE-05 rows sat at AWAITING, so authenticity was assumed to come back
  uncertain; run live the AI passed it, the document was all-pass and auto-APPROVED. A criterion
  that must **fail** is a far safer premise than one merely likely to be uncertain.

### What one run costs

~11 permanent document uploads and **3 irreversible agent decisions**. No payments. There is no
DELETE for a document row anywhere in the API and nothing in the product reverses a decision.
`npm run test:doc-lifecycle:read-only` is the 7-scenario cut that decides nothing (it still
uploads). **Never `--parallel`**: upload order is test data here.

## >>> WHERE TO READ WHAT THE AI ACTUALLY SAID <<<

Three places, and they answer different questions. Reach for the right one.

| Artifact | Answers |
| --- | --- |
| `reports/ai-verification-findings.md` | **"what did the AI flag across the whole run, and why?"** One section per document: the status it chose, every criterion with the reason it gave, and the remarks the candidate can see with their source |
| `reports/ai-verification-findings.json` | the same, for processing |
| `reports/<profile>-report.html` | **one scenario's story** - its steps, its failure message, and the same per-document evidence block attached inline |

### The findings artifact

Built by `features/support/aiFindingsLog.js`. Every document a scenario verified appends one
line to `reports/ai-findings.ndjson`, and `configs/run-tests.js` turns the lot into the `.md`
and `.json` after cucumber exits. It is ordered summary -> flagged documents -> clean
documents, because a 40-document run is unreadable any other way, and within a document the
**non-passing criteria come first** - they are why the document is in that section.

Sample of the shape:

```
### NAME-03 - AWAITING (decided by AI)

- file: `NAME-03_transcript_different_name_VFUiV7P.pdf`
- category EDUCATION | document row 26613 | uploaded via api

| Verdict | Criterion | The reason the AI gave |
| --- | --- | --- |
| **FAIL** | `identity_name_match` | The legal name on the document ('John Doe') does not match the applicant's declared name ('Abdul Musawwir Siddiqui'). |
| **????** | `authenticity` | ...no digital certificate or institutional seal to confirm authenticity. |
| **PASS** | `date_validity` | The conferral date is present and well-formed. |

**Remarks the candidate can see:** none.
```

Four decisions in it worth keeping:

- **It is recorded from the `After` hook, not at the assertion site**, so it happens for every
  document a scenario touched whether the scenario passed or failed. A failed scenario's
  verdicts are the evidence; losing them leaves the reader with only an assertion message.
- **It carries NO pass/fail of its own.** The requirement's expected-results table has never
  been supplied - every `expected` block in the test data is still null - so a verdict column
  here would be invented, which is the one thing this module keeps refusing to do. It reports
  what the AI said and leaves the judgement to the scenario beside it.
- **`documentStatus` and `aiStatus` are recorded separately**, and a mismatch is called out in
  bold. Where they differ, something other than the AI moved the document, and that is the
  single most important thing this file can show.
- **NDJSON, appended per line, not one file written at the end.** A `--parallel` run has one
  worker process per lane, each with its own `AfterAll`, so a build-at-the-end design would
  write one partial file per lane, each overwriting the last. Appending is also what makes a
  KILLED run still leave everything it had measured - which is exactly when this matters,
  since an abandoned run has still spent its permanent uploads.

All three files are swept at the start of every run (`configs/reportsWorkspace.js`), so the
folder describes exactly one run. They are listed by name there because `ai-findings.ndjson`
matches neither the `(report|rerun|messages)` pattern nor the two built outputs - left behind,
the next run's findings would silently mix two runs' verdicts.

## How long a run takes, and why

**MEASURED 2026-09-01: ~14 seconds per scenario is the FLOOR**, for a scenario that uploads
nothing and calls no AI (42s for three of them, serially, headless). That is browser-context
creation plus a page load, not test logic. On top of it:

| Cost | Measured |
| --- | --- |
| the AI verification itself | 7-15s, over 2 polls |
| a UI upload through the profile form | ~60s (the form animates a ~4s progress bar, and each combobox queries per keystroke) |
| an API upload | ~2s |
| a candidate or agent UI sign-in | 6-8s to a usable form, plus ~2.3s for the credential round trip |

So a serial run of 71 scenarios cannot go far below **~15 minutes** however much is optimised,
and a full `test:doc-verify:ui` run measured **48 minutes**. Anyone expecting single-digit
minutes serially is expecting the AI and the browser to be faster than they are.

### The three levers, in order of size

1. **`DOC_UPLOAD_MODE=api`** - the biggest by far: ~60s -> ~2s per upload. It changes no
   assertion; only how the document gets onto the account. Both modes create the same
   permanent row.
2. **`--parallel`** - the only lever with headroom left once uploads are cheap, because the
   ~14s floor is per-scenario and parallelism is the only thing that overlaps it.
3. **Session replay** - `agentSignIn()` has cached its storage state at module scope since it
   was written; `candidateUi()` did NOT, so every candidate-side scenario re-entered
   credentials through the UI. Fixed 2026-09-01: it now replays the same way, detects a
   bounce to /login, and re-authenticates for real if the replay is stale. **Keep the
   fallback and keep it reported** - a silent one is how this class of bug hides.

### `npm run test:doc-verify:fast`

`-p docVerifyFast`: the **same 71 scenarios** as `docVerify` (verified with
`scripts/check-profile-selection.js`), with `DOC_UPLOAD_MODE=api` and headless. Not one
assertion differs.

**Realistic expectation: roughly half of the ~48 minutes a `test:doc-verify:ui` run takes.**
The api upload removes ~58s per uploading scenario; the ~14s floor and the 7-15s AI wait
remain, and nothing can remove them.

### >>> --parallel WAS TRIED, MEASURED, AND REJECTED <<<

With `parallel: 4`, a 6-scenario slice ran in **5m45s wall for 16m51s of work** - a genuine
~3x - and **4 of the 6 failed**. Three of those were all three resubmission scenarios timing
out on the AI (`AI verification did not produce a result within the timeout`); the fourth was
the known candidate-dashboard cap. Converting passing scenarios into timeouts is worth no
speedup: a run reporting failures it did not really find is worse than a slow one.

Whether parallelism *caused* those timeouts is **suspected, not proven** - the same class of
timeout was seen once in a serial run and did not reproduce. Settling it needs a controlled
A/B and each arm spends permanent uploads. Until somebody does that, this profile is serial.

There is a second, independent reason for caution: `cross_document_consistency` is judged
against every document already on the account, so **upload order is test data** here - which
is why every other profile in this module is serial.

> **THE ONE REAL CAVEAT.** `cross_document_consistency` is evaluated against every other
> document already on the account, so **upload order is test data** in this module - which is
> why every other profile here is serial. Four lanes uploading at once makes that criterion's
> input non-deterministic. It is tolerable *here* only because the criterion is already
> unpassable on this account for reasons nothing in the suite controls, so no assertion that
> matters trusts its verdict. **If that account condition is ever fixed, this profile must go
> back to serial** - the fix would make the criterion meaningful again and parallelism would
> then be corrupting a real signal. Use `-p docVerify` when a cross-document verdict matters.

## Expected baseline

**Measured 2026-08-25: `npm run test:doc-verify:ui`, 65 scenarios, 48m04s, 45 passed / 20 failed.**
Four of those 20 were suite defects and are fixed; one scenario was inverted; one was excluded.
The **derived** baseline is therefore **64 scenarios, 15 failed** - and *derived* is the operative
word: no full run has happened since the fixes. **Run one and replace this line with the measured
result.**

The 15 expected reds, by cause. A green run means *these* are red and nothing else:

| # | Cause | Scenarios |
| --- | --- | --- |
| 6 | **intentional `@known-issue`** | future issue date; malformed date; candidate revision result; status wording; expected-results table; **upload size limit** |
| 5 | **`cross_document_consistency` account history** - environmental, NOT a defect | cross-document validation passes; the three auto-approval scenarios; multiple-valid-documents |
| 3 | **real AI findings, deliberately untagged** | `CONT-02` transcript_content answered *pass* with no major line; `CONT-03` named only some missing fields; `AUTH-05` judged confidently on an illegible document |
| 1 | **real product defect, asserted as written** | 9 of 9 document upload controls unreachable by keyboard |

### Two findings from that run worth acting on

- **A document over the size limit is ACCEPTED.** `FILE-03`, 8,672,391 bytes, came back
  `HTTP 201` with a document row and `status: AWAITING`. The 5 MB limit is not enforced on this
  endpoint. Already `@known-issue`; this is the first time it has been measured through the suite.
- **The JPEG defect is FIXED, and the scenario was inverted rather than left red.** The endpoint's
  message now reads `Only .pdf, .png files are allowed.` and it refuses a JPEG - message and
  behaviour finally agree. It previously refused a format its own message advertised. The scenario
  now asserts the refusal *and* that the refusal explains itself, so it goes red again if the two
  ever diverge in either direction. `@known-issue` removed.

### The status wording finding got sharper

`Verify that the candidate and agent portals use consistent status wording` now reports that **one API status
(`AWAITING`) is rendered three different ways**: candidate `"Awaiting Verification"`, agent pill
`"Needs Review"`, agent filter tab `"Need Review"`. That is a better bug report than "the wording
differs", and it is why the candidate-side pre-decision step accepts the known set of wordings and
attaches the one it found rather than pinning a single string - pinning one would make the scenario
red on a synonym and take its second assertion down with it.

### A resubmission AI timeout was observed once and did not reproduce

`Verify that a corrected resubmission does not reuse the previous verification result` failed once with
*"AI verification did not produce a result within the timeout"*, then passed 14/14 on an immediate
re-run. The other two resubmission scenarios use the same step and passed in the full run, so this
is transient rather than a missing re-verification. Recorded so it is not re-diagnosed from
scratch; if it becomes frequent, the AI is the place to look, not the step.

## >>> HOW MUCH THE AI VERDICTS CAN BE TRUSTED (measured 2026-08-25) <<<

Read this before treating any verdict here as ground truth. Produced by
`node scripts/probe-ai-verdict-vs-document-condition.js` — read-only, uploads nothing. It maps
every document row on the account back to its fixture and compares the **condition the fixture
was built to contain** against the **verdict the AI gave**.

Expectations there are derived from each fixture's recorded `properties`, **not** from the
requirement's expected-results table, which has never been supplied. That is why this probe can
answer "is the AI right?" today while the suite itself still reports those documents as PENDING.

### Overall, 130 verified rows, 437 condition/criterion pairs with a decided expectation

| | count | share |
| --- | --- | --- |
| MATCH | 410 | 93.8% |
| MISMATCH | 23 | 5.3% |
| uncertain where a definite verdict was due | 3 | 0.7% |

A further **24** "failures" were the AI **correctly** reporting that the organisation on the
document differed from the one declared on the form — rows uploaded under earlier declared
values. Those are excluded from the tally rather than counted as AI defects; conflating the two
is exactly the misleading conclusion this probe exists to prevent.

### Per criterion — and they are not equally trustworthy

| criterion | MATCH | MISMATCH | verdict stable across runs? |
| --- | --- | --- | --- |
| `identity_name_match` | **122** | **0** | **yes — never varied** |
| `date_validity` | 113 | 9 | no |
| `issuing_organisation` | 91 | 9 | no |
| `transcript_content` | 82 | 5 | no |
| `authenticity` | 2 | 0 | no — the least stable |
| `cross_document_consistency` | — | — | no — flipped in 20 of 20 repeats |

**`identity_name_match` is the one criterion that can be relied on.** 122/122 correct, and its
verdict never changed between runs on the same document. The AI also extracted a name agreeing
with the fixture's intent in 121 of 124 rows, which is independent evidence that it really read
the file it was given.

### >>> THE AI IS NON-DETERMINISTIC ON THE SAME UNCHANGED DOCUMENT <<<

Of 193 fixture+criterion pairs observed more than once, **59 (30.6%) changed verdict between
runs on the identical file**. Examples:

```
DATE-01 | date_validity   pass, pass, fail
ENG-02  | date_validity   fail, pass, pass
CONT-02 | transcript_content   pass, fail
NAME-06 | authenticity    pass, pass, pass, uncertain, uncertain, ... (12 runs, both values)
AUTH-02 | authenticity    fail, uncertain
```

**Consequence for anyone reading a report from this module:** a single green run on any
criterion other than `identity_name_match` is not evidence the rule works, and a single red run
is not proof it is broken. Wherever the verdict matters, it needs repeat observations. This is
the strongest argument for the expected-results table landing — without it the suite cannot
distinguish model variance from a regression.

### Confirmed AI defects — verified against the PDF text, not inferred from the filename

Each of these was checked by extracting the actual document text first, so the fixture is known
to contain what its name claims:

| Fixture | The document literally says | The AI answered |
| --- | --- | --- |
| `DATE-01` | `Date of Conferral: 15 June 2030` | "All dates are present, well formed, and logically ordered." |
| `DATE-03` | `Date of Conferral: 32nd of Never, 202X` | "All dates are present, well-formed, and logically ordered." |
| `ENG-02` | `Issue Date: 15 June 2030` | "All dates are present, well-formed, and logically ordered." |

These reproduce the discrepancies in the Dev report (future date passed, malformed date passed)
and the scenarios asserting them are **deliberately left failing**.

### Arguable — do not file these without a product answer

- **`CONT-02` missing major.** The document has no `Major / Field` line, yet the AI said all
  three fields were present. But its degree line reads "Bachelor of Science in Computer
  Science", so a model could reasonably infer the field from it. Whether inference is acceptable
  is undecided.
- **`Systems Limited Pakistan` not recognised**, 9 times out of 9 on work-experience letters.
  The test data labels that employer `recognised`. Whether a private employer is meant to be
  "recognised" at all is not stated in the AC — a requirement gap, not an AI defect.
- **`authenticity: uncertain` on an ordinary scan with no seal.** Defensible: the AC says
  "valid digital certificate **where applicable**". Not asserted either way.

## Known product findings this module surfaces

- **The candidate cannot see a decision on a document they just uploaded.** The dashboard's
  "Your Documents" block listed the same 4 cards (Mar–May 2026) while the account held 166
  rows; Profile > Documents lists everything but downloads on click, so it carries no status
  and no remarks. Both `@mutates-document` scenarios pass their entire agent-side chain and
  then fail here. Recorded in file `10` and file `12`.
- **The candidate never sees an AI finding attributed to the AI.** Both reachable REVISION
  documents carry a single comment sourced `Agent`. Document 26252 carries AI-worded text
  stamped `source: "AGENT"`, which would make the AC's *"candidate can identify who flagged it:
  AI Review / Agent"* unmeetable.
- **The document upload controls are bare `<svg class="add-icon">`** — no `<button>`, no role,
  no `aria-label`, no `tabindex`. Not keyboard focusable and invisible to assistive technology.
- **The agent submit test id is duplicated** across Approve and Request Revision. See file `09`.
- **Every `expected` block in the test data is still `null`.** 9 scenarios carry
  `@known-issue` and fail on purpose. A suite that silently verifies nothing while reporting
  green is the failure mode this whole design guards against.
