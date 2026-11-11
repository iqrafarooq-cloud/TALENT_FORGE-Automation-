# Agent Portal > Candidates - written AC vs the live build

Everything here was **measured** against `dev.talentforge.com.sa` on **2026-08-27**, as
`faran.mustafa@bytecorp.io` (336 In Progress candidates) and
`iqra.farooq+refagent-nopromo@bytecorp.io` (0 candidates). Nothing in this file is inferred from a
feature file or a ticket.

The automation asserts **what the app does**, by decision, so a red row in
`features/Agent_Portal/inprogress-search_filters.feature` means the behaviour **changed** - not
that a requirement is violated. The divergences below are what needs a product or dev answer; each
one is also flagged with a `# DIVERGES:` comment at the site in the feature file.

Re-measure rather than reasoning from this document. The commands are at the foot.

---

## 1. Defects

### D1. `reminder_status` does not reflect the reminders the app itself lists - **HEADLINE**

The In Progress list endpoint classifies every Onboarding Incomplete candidate into one of
`none` / `recent` / `multiple`, and that classification is what the **Reminder Status** filter
selects on. It is wrong, and provably so: the same response that classifies a candidate `none`
also sets `has_reminders: true` on it, and the candidate's own Reminder History panel lists
several reminders.

The first four candidates the **"No Reminder Sent"** filter returned:

| candidate | reminders in its history | newest | classified |
| --- | --- | --- | --- |
| `candidates+submt6x41zkh4o2@iqra.anonaddy.com` | 1 | Aug 26, 2026 12:00 PM (inside 48h) | `none` |
| `candidates+submt497361dhj0@iqra.anonaddy.com` | **4** | Aug 26, 2026 1:00 PM (inside 48h) | `none` |
| `candidates+submt492qff7aaf@iqra.anonaddy.com` | **4** | Aug 26, 2026 1:00 PM (inside 48h) | `none` |
| `candidates+submsx678q3cpl1@iqra.anonaddy.com` | **3** | Aug 25, 2026 1:00 PM | `none` |

All four carry `has_reminders: true`. Two independent readings should have been `recent` (a
reminder inside 48 hours) and three should have been `multiple` (more than one reminder).

**Consequences, which is why this is the headline:**

- `reminder_status=recent` matches **0** of 297 candidates. The filter option is dead.
- `reminder_status=multiple` matches **3** of 297, against at least three more found by hand in a
  sample of four.
- `reminder_status=none` matches **294**, i.e. almost the whole population, most of it wrongly.

So the Reminder Status filter - the feature this work was asked to cover - is not usable. The
contradiction is internal to a single API response, so it needs no decision about what "recently
reminded" ought to mean.

**Asserted by:** `Verify that a candidate classified as No Reminder Sent really has no reminders`
(`@known-issue`, fails on purpose, samples 4 candidates). The neighbouring positive scenario
asserts the filter's *self-consistency*, which does pass, and is kept separate so this failure
cannot hide it.

### D2. The `Invite Sent` duration filter does not filter at all

The UI submits `?invite_sent=<band>`. The endpoint's parameter is **`invite_days`**. The unknown
parameter is dropped, so the response is the **entire unfiltered list**:

| Selected | UI sends | Rows returned |
| --- | --- | --- |
| `> 24 hours` | `invite_sent=<1` | 336 - the whole list |
| `1-3 days` | `invite_sent=1-3` | 336 |
| `4-7 days` | `invite_sent=4-7` | 336 |
| `7+ days` | `invite_sent=7+` | 336 |

336 is every In Progress candidate, **Onboarding Incomplete ones included** - so selecting an
"Invite Sent" duration returns candidates that were never in the Invite Sent state.

Both halves look wrong: sending `invite_days=<band>` directly returns **0** for every band, while
an invite row's own `invite_days` field reads `"7+"`. So fixing the client parameter name alone
would take the filter from "returns everything" to "returns nothing".

Compare the sibling group, which is correct: **Onboarding Incomplete** duration submits
`onboarding_days`, the endpoint reads it, and the bands partition the population exactly
(`0 + 3 + 294 = 297`).

**Asserted by:** `Verify that the Invite Sent duration filter submits its band and does not narrow
the list` - a **regression lock on the broken behaviour**. A green row there must never be read as
"the filter works"; it goes red the day this is fixed, which is the signal to rewrite it.

### D3. The Reminder History panel has no empty state

For a candidate with no reminders the panel renders its title (`Reminder History`) and its
subtitle (`Showing all reminders sent to this candidate`) and **nothing else** - no list, no "no
reminders yet" message. Indistinguishable from a panel that failed to load.

Recorded rather than asserted as a requirement; note D1 currently makes this hard to reach, since
candidates classified `none` do have reminders.

---

## 2. Divergences from the written AC

The build behaves deliberately in each of these; it is the AC that needs amending.

### V1. Status Detail is a combined string, and one value is unhyphenated

The AC expects Status Detail to be exactly one of `Awaiting Sign-up` / `Profile Incomplete` /
`Test Pending`. The app renders:

- `Profile Incomplete, Test Pending` - **combined**, for an Onboarding Incomplete candidate
- `Awaiting Signup` - **unhyphenated**, for an Invite Sent candidate

The filter option for the same state *is* hyphenated (`Awaiting Sign-up`), so the app is
inconsistent with itself across two surfaces. Asserted as composed-of rather than equal-to, which
still catches an undocumented step appearing.

### V2. The In Progress table has a fourth column

The AC lists `Candidate | Status | Status Detail`. The app renders an **`Actions`** column too,
holding `Resend` (`agent-candidates-resend-invite-button`) and `Reminder History`
(`agent-candidates-reminder-history-button`). Neither control appears anywhere in the AC.

### V3. The two duration filter groups are headed ambiguously

The AC calls them `Invite Sent Duration` and `Onboarding Incomplete Duration`. The app drops
"Duration", so the modal renders **five** group headings of which two - `Invite Sent` and
`Onboarding Incomplete` - are **the same strings as the Status group's own two option labels**.

A modal-scoped search for the text `Invite Sent` therefore resolves to four elements. It is a
genuine readability problem for a user, and for automation it means every read and click has to
resolve the group first (which `InProgressCandidatePage.groupSection()` does).

### V4. The search matches email as well as name

The placeholder reads `Search by candidate name...`, but the search also matches the email:
`bytecorp.io` returns **174** rows and matches no candidate's *name* at all, and searching `Abdul`
returns rows displayed as `Musawwir Musawwir` (matched on `abdul.musawwir+110@...`).

The control does **more** than it advertises, so this is a placeholder problem, not a search
problem - the opposite of the Community module's `Search by candidate name or major...`, which
promises a major search the control cannot do.

### V5. The candidate name is not bold

The AC says the Candidate cell shows "the full name **in bold** above the email address".
Measured: the name renders at **font-weight 500** (medium) and the email at **400**. So the name is
emphasised but not bold by any usual definition.

The scenario asserts the *relationship* the AC is protecting - the name is heavier than the email
beneath it, and rendered above it - which the app satisfies. Asserting `>= 600` made all ten rows
red against a build that is behaving deliberately, and a 500-vs-600 argument is not worth a
permanently red row. It still fails if the two weights are ever levelled out.

### V6. Space does not commit an email chip

`Invite-candidate.feature` asserts an email can be added "by pressing Space". Verified with a real
key press: Space simply types a trailing space into the field - `"chip.space@university.edu "` -
and no chip is created. **Enter** commits a chip and clears the input.

Also measured on that modal, for the file-2 work:

- a chip is a `<span class="flex items-center gap-1 bg-brand-25 font-bold ...">` with a remove control
- a malformed address is refused inline with **`Please enter a valid email address.`** and no chip
- surrounding whitespace is trimmed: `  padded@university.edu  ` becomes `padded@university.edu`
- test ids: `agent-invite-email-input`, `agent-send-invites-button`, `agent-invite-csv-upload-button`,
  `agent-send-onboarding-invite-option`; the template link is `/invite-candidates-template.csv`
- the upload control has a **`peer sr-only` file input beside the real button**, so
  `getByRole('button', { name: /upload/i })` matches BOTH - the same trap the Community module
  records. Restrict to real `<button>` elements.

### V7. Two smaller wording divergences

- The invitation modal is titled **`Invite via Email`**, not `Send Onboarding Invite`. That string
  survives only as the chooser card's sub-link, `Send onboarding invite`.
- The In Progress invite button reads **`Invite Candidate`** (capital C) where
  `Invite-candidate.feature` asserts exactly `Invite candidate`.
- The method-chooser modal **does** expose an X close icon, where
  `invite-candidate_welcome_onboarding.feature` asserts it exposes none.

---

## 3. Open questions for the PO / dev

1. **D1** - is `reminder_status` meant to be computed from the reminder log at read time? The
   `has_reminders` flag in the same response is correct, so the data is present.
2. **D2** - which is the intended parameter, `invite_sent` or `invite_days`? And why does
   `invite_days` return 0 for a band a row claims membership of?
3. Are the three reminder states meant to be **mutually exclusive**? They partition the population
   today (294 + 0 + 3 = 297). If a candidate can be both recently reminded and multiply reminded,
   `multiple` currently wins and `recent` can never show them.
4. **V1** - should `Awaiting Signup` be hyphenated to match its own filter option?
5. **V3** - can "Duration" go back into the two group headings? As rendered, the modal shows
   `Invite Sent` twice with two different meanings.
6. **V4** - should the placeholder mention email, or should the search stop matching it?

---

## 4. Reference: what the surface actually is

```
route   /candidates/in-progress          (the All tab adds NO param - it is the bare route)
API     GET /core/api/v1/candidate/in-progress/?page=&page_size=&search=&...
tabs    activeFilter = (absent) | invite_sent | onboarding_incomplete
        data-testid  agent-candidates-in-progress-filter-{all,invite-sent,onboarding-incomplete}
search  ?search=   debounced ~1s, server-side, case-insensitive, substring, name OR email
paging  10 per page, ?page=N, "Previous Page"/"Next Page" + listitem "Page N"
```

Row shape - **`reminder_status`, `invite_days` and `onboarding_days` appear ONLY here, never in the
table**, which is why the automation records the response:

```json
// invite_sent - no id and no name yet; the Candidate cell shows the email alone
{ "id": null, "name": "", "email": "...", "status": "invite_sent",
  "status_detail": "Awaiting Signup", "invite_days": "7+" }

// onboarding_incomplete
{ "id": 11204, "name": "Sub Tester", "email": "...", "status": "onboarding_incomplete",
  "status_detail": "Profile Incomplete, Test Pending", "onboarding_days": "4-7",
  "reminder_status": "none", "has_reminders": true }
```

Filter modal - **the five groups do not share one control type**:

| Heading (as rendered) | Control | Options -> value | URL param | Works? |
| --- | --- | --- | --- | --- |
| Status | checkbox, multi | Invite Sent, Onboarding Incomplete | `status` | yes |
| Onboarding Step | checkbox, multi | Awaiting Sign-up, Profile Incomplete, Test Pending | `onboarding_step` | yes |
| Invite Sent | radio, single | `<1`, `1-3`, `4-7`, `7+` | `invite_sent` | **no - D2** |
| Onboarding Incomplete | radio, single | `1-3`, `4-7`, `7+` | `onboarding_days` | yes |
| Reminder Status | radio, single | `none`, `recent`, `multiple` | `reminder_status` | **no - D1** |

Only the checkbox groups carry test ids (`filters-status-invite_sent-checkbox`,
`filters-onboarding_step-test_pending-checkbox`, ...). The three radio groups have **none**.

Footer: `filters-clear-all-button`, `Cancel` (no test id), `filters-apply-button`. Dismissal works
four ways - X icon, Cancel, backdrop, Escape.

**Clear All wipes only the MODAL's filters.** From
`?activeFilter=invite_sent&onboarding_step=awaiting_signup` it leaves `?activeFilter=invite_sent` -
the tab and the modal are independent controls on independent params, and the Filters button's
count badge does not count the tab either.

### Status pill colours - assert the RING

| Status | Classes | Ring | Background | Text |
| --- | --- | --- | --- | --- |
| Invite Sent | `bg-brand-25 ring-brand-700` | `#4468c5` (blue) | `rgb(241,245,253)` | `rgb(24,29,39)` |
| Onboarding Incomplete | `bg-error-25 ring-error-600` | `#d92d20` (red) | `rgb(255,251,250)` | `rgb(24,29,39)` |

Both backgrounds are near-white and **both texts are identical**, so a reader looking at background
or colour cannot tell blue from red here. The ring is the whole signal.

### Empty states - four wordings, and the Clear CTA belongs to filters only

| Surface | Headline | Body | CTA |
| --- | --- | --- | --- |
| All tab, no candidates | `No candidates yet` | `Start by inviting your first candidate or sharing your agent code.` | `Invite Candidates` |
| Invite Sent tab, none | `No pending invites` | `Candidates will appear here after you send them an invitation.` | *(none)* |
| Onboarding Incomplete tab, none | `No incomplete onboarding` | `Candidates who haven't finished onboarding will show up here.` | *(none)* |
| search matches nothing | `No results found` | `We couldn't find any results matching your current search.` | *(none)* |
| filters match nothing | `No results found` | `We couldn't find any results matching your current filters.` | `Clear all filters` |
| both active | `No results found` | `We couldn't find any results matching your current search and filters.` | `Clear all filters` |

All three no-candidates wordings **match the written AC exactly**. Two notes for anyone writing a
locator: the app uses a **curly** apostrophe (U+2019) in `haven't` and `couldn't`, and the grid is
**removed entirely** (`role="grid"` absent) in every empty state.

---

## 5. Two traps that cost a full run

Recorded because both were read as app defects on the first live run and neither was.

- **The grid renders SKELETON rows.** `[role="row"]` and `[role="rowheader"]` exist with **zero
  `<p>` children**, so a row count returns 10 while every name, email and status is still absent.
  That was reported as `row 1 renders no email address` ten times over, and it silently made the
  searched-for term an empty string.
- **A landed response is not a rendered response.** Waiting for the list request and then for the
  grid to be *visible* reads the PREVIOUS render - the grid is already visible. A search for
  `ZZZNOTEXIST999` came back as ten real candidates and was reported as "the search does not
  filter"; the empty-state reader saw the stale grid and answered "no empty state".

The fix in both cases is the same and it is the general rule for this page: **wait until the DOM
AGREES with the payload** - `InProgressCandidatePage.renderState()` / `settle()`. Not a fixed
sleep, which is what would make this intermittent rather than constant.

Three more from the same run, all of which read as app defects and none of which were:

- **The pagination container has NO `role` attribute.** It is
  `<nav aria-label="Pagination Navigation">`, so its navigation role is implicit and
  `querySelector('[role="navigation"]')` matched nothing - and falling back to the first `<nav>`
  gives the app's **sidebar**, which holds no page numbers. The reader answered "no pagination is
  rendered" on a page showing 34 pages, and four scenarios reported a missing control. Select
  `nav[aria-label*="Pagination" i]`; the page buttons are `<button role="listitem"
  aria-label="Page N">` and the current one carries **`aria-current="page"`**.
- **Every wait has to compose inside 60 seconds.** `hooks.js` calls `setDefaultTimeout(60000)` at
  load, which overrides each profile's own `timeout` for every step. A 45s settle inside
  `I clear all filters` (open modal + Clear All + cancel + settle) blew past 60s and failed as
  "function timed out", which reads like a hung app. Also: **some actions fire no request at all**
  (Clear All with nothing applied), so a long "wait for the next response" window is dead time
  that then starves the settle. The payload window is now short and its expiry is not an error.
- **`npx cucumber-js -p <profile>` writes that profile's `json:` target even with `--dry-run`**, so
  a dry-run run clobbers the report of the real run that preceded it. Use `--report-name`, or a
  different profile, when checking step resolution after a run you still need the report of.

And one thing that turned out **not** to be a defect: the wrapper's exit code. A run with 10
failures appeared to exit 0, but that was `$?` being read after a pipe (it reports `tail`'s status).
`configs/run-tests.js` propagates Cucumber's status correctly - verified, a 1-scenario failing run
exits 1.

---

## 6. Re-measuring

```bash
npm run test:in-progress                 # the whole feature, headed
HEADED=false npm run test:in-progress    # headless
npx cucumber-js -p inProgress --dry-run  # the authoritative scenario count
```

Every filter step attaches what it submitted, what came back and the per-row fields, so a green run
is also the record of what the app did that day. `reports/in-progress-report.html` holds it.
