# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

> **>>> THE SUITE RUNS ON PLAYWRIGHT'S OWN TEST RUNNER VIA playwright-bdd. CUCUMBER WAS REMOVED ON
> 2026-10-06.** `cucumber.js`, `features/support/`, `features/step_definitions/`,
> `configs/run-tests.js` and the cucumber-html-reporter pipeline are gone. The `.feature` files,
> `steps/`, `pages/` and `utils/` are unchanged, and **every `npm run test:*` script kept its name
> and its selection** - each Cucumber profile became an entry in `configs/profiles.js` with the
> SAME tag expression, and selection parity was measured profile by profile before Cucumber was
> deleted (see "Runner cutover" below). `README.md` is the short guide to the structure.
>
> **Reading older notes in this file:** they were written against Cucumber. Translate them like so:
>
> | Older notes say | Today |
> | --- | --- |
> | `-p <profile>` / `npx cucumber-js -p <profile>` | `npm test -- --profile <profile>` (or the `test:*` script that names it) |
> | `npx cucumber-js -p <profile> --dry-run` (the "authoritative count") | `npm test -- --profile <profile> --list`, or `npm run check:profiles` for every profile at once |
> | `npx cucumber-js <file>:<line>` / `npm run test:only -- <file>:<line>` | unchanged - `file:line` is mapped to that scenario's name |
> | `features/support/hooks.js` (Before/After, page wiring) | `fixtures/PagesFixture.js` + `fixtures/WorldFixture.js` |
> | `setDefaultTimeout(60000)` "overrides the profile's timeout" | `fixtures/bdd.js`: a step with no `{ timeout }` gets 60s (`BDD_STEP_TIMEOUT`), the scenario 600s. The trap is gone: a step's own `{ timeout }` is always honoured |
> | `reports/cucumber-report.html` / `.json` | `reports/playwright-report/index.html` (`npm run test:report`) |
> | "Cucumber abandons a scenario at its first failing step" | still true - Playwright stops a test at its first failed step |
> | an `ambiguous` / `undefined` step "reported and moved on" | now a GENERATION failure: the run refuses to start and names the step |

- `npm test` — the **default** profile (every scenario except the unrecoverable-resource and
  never-runnable tags), headed by default. Goes through `configs/run-playwright.js`, which:
  refuses to start if a playwright-bdd special tag would drop scenarios; clears the previous run's
  output from `reports/`; generates specs into `.features-gen/<profile>/`; prints how many
  scenarios each lane holds (an EMPTY selection fails instead of "passing" with 0 scenarios, which
  is what Cucumber did); runs the **parallel** lane then the **serial** lane; merges both into ONE
  HTML report; writes the AI-findings artifact.
- Any area: `npm run test:<area>` (`test:dashboard`, `test:promo`, ...) - each is
  `--profile <name>`. `npm test -- --profile <name>` runs any profile in `configs/profiles.js`.
- What would run, without running it: `npm test -- --list` (works with every other option).
- One file: `npm test -- features/Auth/Login.feature`. One scenario:
  `npm test -- features/Auth/Login.feature:42` (the line is mapped to the scenario's NAME, since
  the generated spec's lines are not the .feature's; an outline's line selects all its examples).
- By name: `npm test -- --name "Verify that a disabled promo"` (a regex, like Cucumber's).
- By tag: `npm test -- --tags "@negative"` - a Cucumber tag expression, **ANDed with the
  profile's**, exactly as before. So under the default profile `--tags "@consumes-promo"` still
  selects nothing; use the profile that admits it.
- **`npm run test:only -- <path-or-path:line>` — run exactly what you name**, costly scenarios
  included (`--profile only` = every runnable scenario). Same rule as before: reach for it when a
  targeted run says the selection is empty.
- Re-run what failed last time: `npm run test:rerun` (Playwright `--last-failed`; each lane keeps
  its own list under `test-results/<lane>/`).
- Headless: `npm test -- --headless`, or `HEADED=false` (Bash) / `$env:HEADED="false"` (PowerShell).
  `npm run test:headless` and `test:ci` do it for you. A value set in the shell beats `.env`, which
  pins `HEADED=true`.
- Parallelism: `npm test -- --workers 4` or `PARALLEL=4` sets the PARALLEL lane's workers (default:
  half the CPU cores). The serial lane is always one worker with no retries. `--serialise` /
  `SERIALISE=1` puts everything in one lane, one at a time, in file order.
- **`cross-env` IS NOT INSTALLED** and must not be added. A profile that needs an environment
  variable declares it as `env` in `configs/profiles.js` (as `docVerifyFast` does); a value the
  caller already set still wins.
- `npm run gen` - regenerate the specs used by the VS Code Playwright extension
  (`.features-gen/all/`). Every test script regenerates its own profile's specs anyway.
- `npm run check:profiles` - how many scenarios each profile selects (`--save`/`--compare` snapshot
  a before/after when you change tags or feature layout). `npm run check:tags` - the special-tag
  guard on its own.
- `npm run test:report` - open `reports/playwright-report/index.html`.

- **`@provision` is part of the default `npm test` run.** Those scenarios need account states the shared candidate cannot be in (never-subscribed, initial subscribe, a clean lower tier to upgrade FROM), so each signs up a brand-new candidate over live email and pays with the PayTabs test card. Consequences: the full run needs network + the IMAP inbox reachable, it makes real test-mode payments, and it is slower. It also **must run serially** — every verification mail lands on the same inbox (anonaddy strips the `+alias`), so concurrent signups can swap verification links. `npm run test:parallel` therefore filters `not @provision`.
- `npm run test:promo` — the whole promo-code lifecycle feature (`-p promo`, `features/Promo_Code/`). See "Promo code lifecycle" below.
- **`npm run test:bulk-upload`** — the bulk CSV/XLS/XLSX candidate invitation path inside the
  Invite via Email modal (`-p bulkUpload`). 14 scenarios (9 until 2026-09-16, when the five
  upload-condition scenarios below were added). **Excluded from the default run:
  four scenarios send real invitations and a candidate CANNOT BE DELETED**, so each run leaves ~5
  permanent accounts on `AGENT_EMAIL`. Needs network + the IMAP inbox and must run serially. No
  payments. `npm run test:bulk-upload:read-only` is the **10**-scenario cut that creates
  nothing (it was 5, not the 4 recorded here until 2026-09-16, and all five new scenarios are in
  it - none of them sends) — run that while
  iterating on a locator. See "Bulk candidate invitation" below.
- **`npm run test:invite-candidate`** — the Invite via Email modal: its chrome, the email chip field, validation, sending, and every entry point into the flow (`-p inviteCandidate`). 20 scenarios (17 until 2026-09-09, when the TFF-89 dashboard scenario was split in two and the dashboard "View all" coverage was added). **Excluded from the default run: ten scenarios send real invitations and a candidate CANNOT BE DELETED**, so each run leaves ~12 permanent accounts, plus 2 throwaway agents minted for the two dashboard-route scenarios. Needs network + the IMAP inbox and must run serially. No payments. `npm run test:invite-candidate:read-only` is the 10-scenario cut that creates nothing (~4m) — run that while iterating on a locator. See "Invite via Email" below.
- **`npm run test:candidate-e2e`** — the candidate onboarding journey end to end across both portals: invite -> email -> setup link -> signup -> verify -> onboarding -> Test Pending (`-p candidateE2E`). 6 scenarios, ~7 min. **Excluded from the default run: a candidate CANNOT BE DELETED**, so each run leaves ~4 permanent accounts. Needs network + the IMAP inbox and must run serially. No payments. See "Candidate onboarding end to end" below.
- **`npm run test:candidate`** — the SuperAdmin Portal's Candidates listing, its five-group
  filter modal, pagination and the View **drawer** (`-p candidateManagement`). 46 scenarios,
  **all read-only**: every dialog is opened and dismissed, so no payments, no inbox, no fixture
  spent. These 45 are also part of the default `npm test` run, exactly as `@agent-management`'s
  are. `npm run test:candidate-mutating` is the 1 scenario that really deactivates a candidate
  and reactivates it — it drives a seeded `uat.candidate*` account and `candidateLifecycleGuard()`
  refuses anything else. See "SuperAdmin Portal - Candidates" below.
- `npm run test:welcome-onboarding` — the Agent Portal's first-time welcome modal and candidate-onboarding method chooser (`-p welcomeOnboarding`). 11 read-only scenarios: no invites, no payments, no fixture spent. `npm run test:welcome-onboarding:provision` is the 1 scenario that really invites a candidate — it mints its own throwaway agent over live email and spends that agent's zero-candidate state for good. See "Agent Portal welcome + onboarding methods" below.
- **`npm run test:require-attention`** — the Agent Portal's `Candidates > Requires Attention` listing: its three severity tabs (All / Warning / Critical), search, the three-group filter modal, pagination, and its two row actions, View and Reminder History (`-p requireAttention`). 37 scenarios, ~12m, **all read-only** — that tab has no bell, so nothing here can send a reminder, spend a fixture or create a row, and the whole file is therefore part of the default `npm test` run exactly as the `@candidateActive` files are. 2 scenarios are `@known-issue` and fail on purpose (the search placeholder, and a Severity filter being silently discarded on a severity tab). See "Requires Attention" below.
- **`npm run test:deactivated`** - the Agent Portal's `Candidates > Deactivated` listing: its structure, the search (which matches a candidate NAME **and EMAIL**), the three-group filter modal, its single row action and the end-to-end walks (`-p candidateDeactivated`). 33 scenarios, ~15m, **all read-only** - the only row action is View and there is no Reactivate anywhere on the surface, so nothing here can change an account, spend a fixture or send an email, and the whole file is part of the default `npm test` run exactly as the `@requireAttention` and `@candidateActive` files are. 2 scenarios are `@known-issue` and fail on purpose (an unlabelled column-header help icon that renders no tooltip - split in two because "no name" and "does nothing" are different fixes). **The profile the View action opens is NOT re-covered here** - that is `candidate-view-profile.feature`, which already drives it from this listing. See "Deactivated candidates" below.
- **`npm run test:view-profile`** — the Agent Portal's candidate **View Profile** screen at `/candidates/<id>/view-profile`: the profile header (avatar band, name, status pill, headline, location), the four progress widgets, the Reminder History dialog, and all five tabs — Candidate Details, Track Progress, Document Verification, Subscription, Activity Log with its duration filter (`-p candidateViewProfile`). **51 scenarios driven over the Active, Deactivated and Requires Attention listings in ONE file**, because the profile is the same surface from every route. It was 47, went to 56 on 2026-09-17 when Document Verification gained real functional coverage (the tab, its rows, both row actions, the viewer, its zoom, its Download and the gating of Approve / Request Revision), then to 51 when five scenarios were removed the same day by product decision — the four accessibility ones and the deactivated-profile one (see "Removed on 2026-09-17" below). **50 are read-only and ARE in the default `npm test` run** — nothing here writes: there is no form and no Save, and although the document viewer DOES carry Approve and Request Revision, no scenario and no page-object method clicks either (see the correction below). The 1 `@mutates-profile` scenario edits the fixture candidate's About Me on the CANDIDATE portal and reads it back as the agent, and is already excluded by the default profile. `npm run test:view-profile:read-only` is the 50-scenario cut — run that while iterating on a locator. **In Progress is deliberately absent: it has no View control, so the profile is unreachable from it**, and that is asserted as a rule. **4** scenarios are `@known-issue` and fail on purpose. See "Candidate View Profile" below.
- **`npm run test:activity-log`** - the Agent Portal's `Activity Log` page at `/activity-log`: its SEARCH box and its DATE-RANGE filter, the two together, the empty state, and the infinite scroll a new query resets (`-p activityLog`). 17 scenarios (consolidated from 32 - see below), ~7m, **all read-only** - the toolbar holds two controls, neither of which writes, and the list has no row action at all, so nothing here can change an account, spend a fixture or send an email. The whole file is part of the default `npm test` run exactly as the `@requireAttention` and `@candidateDeactivated` files are, and there is no cleanup hook because there is nothing to clean up. No `@known-issue` left - the one-empty-state-for-two-causes defect was FIXED in the build (2026-10-01) and that scenario is now a regression lock. **WHAT KINDS of event belong on this page is deliberately out of scope** - no scenario asserts that a particular event type is or is not logged. See "Agent Portal Activity Log" below.
- **`npm run test:empty-state`** - every Agent Portal empty state (`-p emptyState`,
  `features/Agent_Portal/Empty-state.feature`, `steps/empty-state.js`, `pages/AgentEmptyStatePage.js`).
  **33 scenarios in two `Rule:`s, each grouped Positive / Negative / Edge cases / End to end. All
  read-only, all in the default run.** **Every expected message lives in the FEATURE FILE** (tables and
  quoted strings, each row naming its page) - the steps hard-code no copy, so the feature is the one
  place to read or change an expected empty state. Every wording was measured live on 2026-10-13 and is asserted
  EXACTLY as the portal renders it (that copy is the accepted wording - including "No candidates
  requires attention" / "No documents needs review" - so there is no grammar scenario).
  - **Rule 1 - `NO_CANDIDATE_AGENT` (`+211`), zero candidates.** Dashboard (KPIs 0 in all four
    periods, Promo Code `-`, three card empty states), each listing's default and per-tab wording,
    search / filter / search+filter "No results found" bodies, EVERY option of every Filters modal,
    the Verifications date range, a filter or search on a tab, clearing and reload, deep links
    (unknown `activeFilter` falls back to All and is rewritten; out-of-range page; whitespace
    search param), whitespace typed, unsafe/non-latin terms (with a native-dialog watch), the
    "Invite Candidates" CTAs (chooser opened and closed, NEVER used - one invite spends the fixture),
    and a sidebar walk end to end.
  - **Rule 2 - `EMPTY_PROFILE_AGENT_*` and its ONE candidate** (`EMPTY_PROFILE_CANDIDATE_*`, id 11473),
    who signed up + verified and did nothing else: the View Profile header (em dashes, not 0),
    every Candidate Details section, Track Progress / Document Verification / Subscription / Activity
    Log tabs, Reminder History disabled, and In Progress with one row beside an empty tab. Opened by
    its ROUTE (In Progress has no View). Re-mint with `node scripts/provision-empty-profile-candidate.js`
    (resumes from what .env holds). Never onboard, subscribe or upload as that candidate.
  - **`@mocked`:** the empty bell ("No notifications yet!", only "Go To Settings") and the Activity
    Log's own "No activity to show / Agents recent actions and updates will appear here.", and the
    candidate profile's Activity Log tab ("No activity to show / Your recent actions and updates will
    appear here as you use the platform.") - all
    agents hold a notification/entries, so those states need an empty response.
  - **One `@known-issue` red:** typing only spaces on Active Candidates sends `search=+++` and leaves
    the grid on loading skeletons indefinitely (the other four listings are fine).
  - **Known defect NOT asserted (scenario removed 2026-10-13 on request):** a failed list load
    (HTTP 500) is presented as the "nothing here" empty state on ALL SIX listings - seen for real
    during a DEV database outage, then proved with a stubbed 500 that was counted as hitting each
    listing's request. Raise with dev; the candidate profile's Track Progress tab already shows
    "Track progress could not be loaded. Please try again later." for the same situation.
  - **Readers.** Two empty-state shapes: listings use `h3 + p` with the CTA as a sibling button;
    the Activity Log's own state is `.section-empty-state` with two `<p>`; dashboard cards use
    `p.font-bold.mb-[0.25rem] + p.whitespace-pre-line` (a KPI tile's "0 / 0 vs last month" pair is
    the trap). Every wait polls for the expected heading AND body; searches are confirmed applied
    (box value AND URL) before reading, because keystrokes typed while a listing mounts are
    discarded. The welcome modal is suppressed via `sessionStorage.agent_welcome_shown`.
  - **DEV outages.** Under database load `auth/token/refresh/` answers 500 and drops the session;
    `gotoSignedIn()` signs back in ONCE per navigation and the attachment records
    `sessionRecoveredTimes`. A run with many "stalled on /login" lines is the environment - re-run.
- **`npm run test:agent-settings`** - the Agent Portal's Account Settings (`/settings`: General,
  Notifications, Security cross-checked) and the header notifications panel (All/Unread tabs, Load more,
  Go To Settings, close routes, Mark as read) (`-p agentSettings`, `features/Agent_Portal/account-settings-notifications.feature`,
  `steps/agent-settings.js`, `pages/AgentSettingsPage.js`). Added 2026-10-14. 12 scenarios; the 11 read-only
  ones are in the default run, the 1 `@mutates-notifications` (marks one notification read, serial lane) is not.
  `npm run test:agent-settings:read-only` is the 11. **Nothing is a literal** - every value is compared against
  `GET /auth/settings/` or `GET /notifications/`.
  - **1 `@known-issue`:** the Account Preferences modal opens on the FIRST of 418 zones ("Acre ... Eirunepe")
    while the page shows "Arabia Standard Time (GMT+3 - Riyadh)", and `/auth/settings/` has NO time-zone field.
  - **Recorded for the PO:** `AGENT_EMAIL` is also a candidate, and its AGENT bell lists candidate-facing
    notifications ("Your subscription has expired", "Your agent reminded you ...").
  - The notification reader skips date-group headings ("Today", "Oct 12, 2026"); the first item of each
    group otherwise reads its heading as its title.
- **Activity Log search terms are DERIVED, not literal (2026-10-14).** `"Invite"` was replaced by the
  `<<recent activity term>>` sentinel plus `Given I have chosen a search term from the agent's recent
  activity`, which takes the commonest safe word from the last 30 days (falling back to this year).
- **`npm run test:dashboard`** - the Agent Portal's `/dashboard`: the KPI band and its four periods, the Document Verification Queue (including Review and committed decisions), the Requires Attention and Active Candidates cards, empty and failed states, and the header (`-p agentDashboard`). 32 scenarios. **`npm run test:dashboard:read-only`** is the 29 that change nothing, and those 29 are in the default `npm test` run; the other 3 are `@commits-decision` (an irreversible decision on a document the scenario uploads) and `@creates-agent` (a throwaway agent). See "Agent Portal Dashboard" below.
- **`npm run test:verifications`** - the Agent Portal's `Verifications` page at `/verifications` (the document review queue) as a PAGE: its four status tabs, search, the Filters modal, pagination, both row actions, and the Document Verification panel with its react-pdf viewer, zoom, AI findings, comment history and two decision dialogs (`-p verifications`). **37 scenarios** (24 until 2026-10-01, when 13 were added - see below), **all read-only** - Approve and Request Revision are IRREVERSIBLE, so both decision dialogs are opened, their contract and their mandatory-reason gate read, and CANCELLED. Nothing here commits a decision, spends a fixture, sends an email or makes a payment, so the whole file is part of the default `npm test` run exactly as the `@requireAttention` and `@candidateDeactivated` files are, and there is no cleanup hook. The committing path stays in `npm run test:doc-verify:decisions`, which already owns it. 2 scenarios are `@known-issue` and fail on purpose (the viewer rendering every page of a document at once, and the two decision dialogs sharing one submit `data-testid`). See "Verifications - the document review queue" below.
- **`npm run test:candidate-details`** — the Candidate Portal's own `Profile > Candidate Details` tab: the profile header, the four-tab strip and the six sections a candidate maintains about themselves — Basic Information, Education, Work Experience, Certifications, Work Preferences & Availability, Desired Roles (`-p candidateDetails`). 23 scenarios, ~9m30s. **18 of them are read-only and ARE in the default `npm test` run** — every modal is opened and cancelled. The 5 `@mutates-profile` ones really PATCH, POST and DELETE against the fixture candidate, restore what they change and delete only what they create, and are excluded from the default run because a killed run leaves the fixture edited. `npm run test:candidate-details:read-only` is the 18-scenario cut that writes nothing — run that while iterating on a locator. 5 scenarios are `@known-issue` and fail on purpose. See "Candidate Details" below.
- **`npm run test:only -- <path-or-path:line>` — run exactly what you name, whatever run-mode tags it carries.** Reach for this whenever a targeted run reports `0 scenarios / 0 steps`.
  - **Why that happens, and why it is not a broken scenario.** A `file:line` argument does **not** override a profile's tag expression — Cucumber applies the path **and** the tags — and a CLI `--tags` does **not** replace the profile's either, it is **ANDed** with it. So both of these report zero for a `@consumes-promo` scenario under the default profile (verified 2026-07-31): `npx cucumber-js <file>:90` and `npx cucumber-js <file>:90 --tags "@consumes-promo"`. Only a profile whose own tags admit the scenario will run it.
  - `-p only` filters `not @not-automatable` and nothing else. That one exclusion has to stay: those steps are `() => 'pending'` stubs, so naming one reports `pending` rather than a real result.
  - It DOES leave a report now, and goes through `configs/run-tests.js` like every other `npm test*` command. It used to emit no `json:` formatter, so that a one-scenario run could not be rebuilt into `reports/cucumber-report.html` and read as a report of the whole suite - a risk that needed a whole-suite report to still be lying around, which is no longer possible.
- `npm run test:promo-exhaustion` — **just** the usage-limit/exhaustion scenario (`Promo-Code-Lifecycle.feature` §5), selected by tag rather than line number so it survives edits above it. Costs 1 live agent invite, 3 candidate signups over IMAP and **2 real test-mode payments**; it mints and exhausts its own throwaway agent, so it spends no long-lived fixture's uses.
- `npm run test:promo-usage` — only the `@consumes-promo` scenarios (`-p promoUsage`). Note this is **both** of them: §5 plus `Referral-Codes.feature:200`, and the latter burns a use off `REFERRAL_AGENT`. Use `test:promo-exhaustion` when you only want §5. Each one completes a real payment; run it on purpose, never casually. The promo-lifecycle one **provisions its own throwaway agent** (live signup + IMAP verify) and exhausts it deliberately — see "Usage limits and exhaustion" below.
- **`npm run test:promo-all` — the one command that runs EVERY promo and subscription scenario in a single pass** (`-p promoAll`): both `features/Promo_Code/` files plus `features/Candidate_Portal/Subscription.feature`, with `@provision`, `@mocked`, `@known-issue` **and `@consumes-promo`** all included. 73 scenarios (`npx cucumber-js -p promoAll --dry-run` is the authoritative count: 28 promo + 45 subscription; was 74 before the two save-toast scenarios were merged on 2026-07-31). It goes through `configs/run-tests.js`, so the previous run's output is cleared first and the HTML report is rebuilt afterwards. (Every profile now emits a `json:` formatter, so the old trap - a profile without one silently rebuilding the HTML from the *previous* run's JSON - is gone.)
  - Only `@not-automatable` is excluded, and it cannot sensibly be included: those steps are literally `const manual = () => 'pending'`, so they resolve to `pending` rather than executing. Review them with `npm run test:not-automatable`.
  - **What one run costs:** ~8 live candidate signups, ~7 test-mode PayTabs payments, 3 live agent invites, and 2 uses off a throwaway promo. It needs network + the IMAP inbox, and it **must run serially** — every verification and invite mail lands on the same inbox (anonaddy strips the `+alias`), so two concurrent signups can swap each other's links. Do not add `--parallel`.
- `npm run test:promo:provision` — not a test run. Re-provisions the three dedicated promo agents (`node scripts/provision-promo-agents.js`) and prints an `.env` block to paste in. Pass an env prefix to do just one. The invite/accept mechanics live in `utils/promoAgentProvision.js`, shared with the runtime throwaway-agent step.
- `npm run test:promo:candidates` — not a test run. Provisions **one candidate per promo agent**, signed up under that agent's own code, and prints an `.env` block. Required because redemption is ownership-scoped — see "OWNERSHIP SCOPING IS ENFORCED" below. Skips any agent that already has a candidate in `.env`; pass `--force` to replace one, or a prefix to do just one. **Run `node scripts/probe-promo-candidate-ownership.js` first** — it is the only thing that checks each fixture candidate really belongs to its agent, which `test:promo:repair` does NOT (it echoes `.env`), and an orphaned candidate is refused with the same generic message every other invalid state produces.
- `npm run test:promo:repair` — not a test run. Reports (with `--fix`, corrects) drift between each promo agent's live parameters and `.env`, including the **live promo code string** and its expiry, usage and revenue. Run it first when promo scenarios fail in ways that look like app defects.
- The default run excludes two tags: `@not-automatable` (states needing DB/cron/time-travel; formerly `@manual`) and `@consumes-promo` (spends a finite promo usage limit rather than merely being slow). `@known-issue`, `@mocked` and `@provision` are all included — the full expression is `default` in `configs/profiles.js`. It additionally skips `@videosmoke` (a deliberate-failure smoke test of the old video hook) and every unrecoverable-resource tag (`@doc-verification`, `@creates-community`, `@invite-candidate`, ...).
- **Caveat on `-p provision`:** that profile filters on `@provision` alone, so it also picks up the two scenarios that carry both `@provision` and `@consumes-promo` (`Promo-Code-Lifecycle.feature` §5, `Referral-Codes.feature:200`). `npm run test:provision` therefore *does* spend real payments, unlike `npm test`. It no longer touches the long-lived promo agents' usage — §5 mints and exhausts its own throwaway — but `Referral-Codes.feature:200` still burns a use off `REFERRAL_AGENT`.
- **Tag vocabulary.** Two independent axes. *Test type* — `@positive`, `@negative`, `@edge-case` (older files use `@edge`; `@e2e` is legacy and being retired) — is descriptive only and never changes what runs; filter on it to slice the suite (`npm test -- --tags "@negative"`). *Run mode* — `@not-automatable`, `@known-issue`, `@mocked`, `@provision`, `@consumes-promo`, plus each feature's own selector tag — is what the profiles in `configs/profiles.js`, the serial/parallel lane split and the `After` hooks actually filter on. Every scenario should carry at least one type tag; run-mode tags go alongside, not instead. **Keep the type set to those three plus `@known-issue`** — `features/Promo_Code/` was stripped back to exactly that on 2026-07-31; finer-grained descriptive tags (`@banner`, `@validation`, `@usage`, …) only add report noise.

### Reports: `reports/` describes exactly ONE run

- **`reports/Test-Summary-Report.pdf`** (added 2026-10-22, `npm run test:report:pdf`) - the
  client/PM-facing summary, Nxtstim's `pdfReportReporter.ts` in this suite's shape
  (`configs/summaryReportReporter.js`): header + executive summary, stat cards, pass-rate donut,
  per-feature-area bars, one card per failure (the step it failed at + plain-English reasons,
  credentials redacted), and the full scenario list grouped by portal and feature. Beside it:
  `Test-Summary-Report.html` (same document) and `summary-report-data.json` (what it was built
  from; `npm run report:pdf:rebuild` re-renders from it without re-running anything).
  - **Built where the whole run is visible**: by the lane MERGE (`PW_MERGE`) or by a single
    self-contained run - never by one lane alone - so unlike Nxtstim it needs no on-disk store and
    always describes exactly one run. VS Code runs write `Test-Summary-Report-ide.pdf`.
  - **`@known-issue` reds are their own category** ("Known issues", amber), separate from new
    failures, and a `@known-issue` scenario that PASSED is flagged as a stale tag.
  - All three files are swept with the rest of the run's output (`configs/reportsWorkspace.js`).
- **`reports/playwright-report/index.html`** is the report: every scenario with its steps, its
  failure screenshot, video (kept on failure; `VIDEO=on` for all) and, on a retry, a trace.
  Playwright writes it the moment the run ends and owns the whole folder, so it cannot describe an
  older run - the whole class of "the HTML is a day newer than its JSON" defects that the old
  Cucumber pipeline needed `readCucumberJson.js`, `generate-report.js` and a run-start stamp to
  defend against no longer exists.
- **The two lanes are two `playwright test` calls**, so each writes a blob shard to
  `blob-report/` and `run-playwright.js` merges them into the one HTML report. If the merge fails,
  the run's exit code is unaffected and the shards are left for a manual
  `npx playwright merge-reports`.
- **Every run still clears the previous run's output first** (`configs/reportsWorkspace.js`):
  `reports/screenshots/`, `reports/videos/` (videos of the EXTRA contexts a feature opens by hand -
  superadmin, invited agent - which Playwright does not record itself), the AI-findings files, and
  any stray `.html`. **`scripts/probe-*.js` output is deliberately NOT swept** - probe dumps are
  evidence somebody took on purpose.
- **`KEEP_PREVIOUS_REPORTS=1` archives instead of deleting**, into `reports/archive/<stamp>/`,
  `playwright-report/` included. Use it before a run that would otherwise replace the report of a
  run you cannot repeat (`test:community-create`, `test:promo-usage`, `test:doc-verify:*`).
  `npm run reports:clean`, `reports:clean:dry` and `reports:archive` do the sweep on demand.
- **Do not run two test commands at once.** Each profile generates into its own
  `.features-gen/<profile>/`, so the specs cannot collide, but the second run's `reports/` sweep
  deletes the first run's evidence and the HTML report folder is shared.

There is no lint or type-check step; the project is plain JavaScript with CommonJS `require`.

### Headed vs headless

`configs/playwright.config.js`'s `resolveHeaded()` decides: `PWDEBUG` (headed) > `HEADED`/`HEADLESS`
set in the shell > the same from `.env` (which pins `HEADED=true`) > headed. `--headless` /
`--headed` on the runner fill the gap only when nothing is set. `slowMo` is 50ms headed
(`SLOWMO=<ms>` overrides, `SLOWMO=0` honoured) and 0 headless. Headed + several workers means one
window per worker.

### >>> ANONADDY IS NO LONGER USED - EVERY ADDRESS IS ON bytecorp.io (2026-10-14) <<<

- Every candidate the suite provisions is now minted from `SUBSCRIPTION_EMAIL_BASE=iqra.farooq@bytecorp.io`
  (the code defaults in `utils/subscriptionProvision.js`, `steps/invite-candidate.js` and
  `scripts/subscription-plans-e2e.js` fall back to bytecorp too). bytecorp KEEPS the `+alias` in the
  To header, so the many notes below saying "anonaddy strips the alias, so this must run serially"
  describe the OLD inbox - the collision they guard against no longer applies to new accounts.
- The four long-lived fixtures that were on anonaddy - `CANDIDATE_EMAIL` and the three
  `PROMO_<X>_AGENT_CANDIDATE_EMAIL` - were moved WITHOUT replacing the accounts, by
  **`node scripts/migrate-anonaddy-candidates.js`**: superadmin Update Email Address -> verification
  mail on the bytecorp inbox -> confirm -> prove the login at the new address -> rewrite that one
  `.env` key. Same accounts, so the shared candidate's subscription and each promo candidate's
  owning agent are unchanged. Idempotent (skips keys already on bytecorp); `KEY --resume <address>`
  finishes a change already requested.
- **Do not "migrate" an address by editing `.env` alone** - the address IS the login, and the suite
  would then sign in as an account that does not exist.
- This machine's DNS was seen failing on the SendGrid link host (`url4829.talentforge.com.sa`) while
  public DNS resolved it; the script falls back to pinning it via 8.8.8.8 for its verify browser.

## Architecture

Playwright + **playwright-bdd** + Page Object Model, plain JavaScript (CommonJS). The structure
mirrors the Nxtstim automation (`Documents/Nxt-automation-Test`), which is TypeScript; the
differences are listed in `README.md`.

1. **`configs/playwright.config.js`** - `defineBddConfig` (features + `steps/**` +
   `fixtures/**`), generation filtered by the active **profile** (`BDD_PROFILE`, from
   `configs/profiles.js`), and **two projects**: `parallel` (fullyParallel, `PARALLEL` workers,
   1 retry) and `serial` (1 worker, no retries). A scenario goes to `serial` when it carries one of
   `SERIAL_TAGS` - tags that mean "two of these at once would interfere" (shared IMAP inbox,
   restore-after-mutate, upload order as data, a finite resource). This is Nxtstim's
   `chromium` / `chromium-serial` split, selected by TAG instead of by folder, because several
   feature files mix read-only scenarios with ones that spend something.
2. **`configs/profiles.js`** - every named selection: a Cucumber tag expression, optional feature
   paths, optional env defaults. The successor of `cucumber.js`'s profiles, with the same
   expressions. `@not-automatable` (pending stubs that Playwright would report as PASSED) and
   `@not-implemented` (no step definitions; one undefined step fails ALL generation) are never
   generated, except by the list-only `notAutomatable` profile.
3. **`configs/run-playwright.js`** - the entry point (see Commands). **`configs/globalSetup.js`**
   validates `BASE_URL` and regenerates specs that are stale - by file mtime OR by a changed
   selection (`configs/selectionStamp.js`) - so a hand-typed `npx playwright test` or a run from the
   VS Code Playwright extension cannot execute a previous generation.
4. **`fixtures/`** - `PagesFixture.js` builds every page object per scenario (and calls the
   `install()` request logs BEFORE the first navigation); `WorldFixture.js` is `this` inside a step
   (`page`, `context`, `browser`, `pages`, `attach()`, `failed`, plus collection of extra-context
   videos at teardown); `bdd.js` is the Cucumber-style API every step file imports
   (`Given/When/Then/Before/After/Status`, `{ timeout }` per step, the hook `scenario` argument);
   `merge.js` is what the generated specs import.
5. **`pages/`** - page objects. `BasePage` provides shared actions; every concrete page extends it.
   **A new page must be wired into `fixtures/PagesFixture.js`** and exposed on `pages` so steps
   can reach it as `this.pages.<name>`. There is no auto-discovery.
6. **`steps/`** - step definitions, one file per area, each importing from `../fixtures/bdd`.
   **Each Gherkin phrase must be defined exactly once across the whole of `steps/`** - playwright-bdd
   loads them into one registry and fails generation on an ambiguous phrase. `steps/common.js` owns
   genuinely generic phrases. `BeforeAll`/`AfterAll` run once per WORKER, not once per run.

### Runner cutover (2026-10-06): how "nothing changed" was proved

- **Selection parity, profile by profile.** Before Cucumber was deleted, every one of the 50
  `cucumber.js` profiles was compared per feature file: `cucumber-js --dry-run -p <profile>` against
  the Playwright `--list` of the same profile. **49 of 50 matched exactly** except for the two
  intended differences below; the 50th, `notAutomatable`, is list-only (its `pending` stubs cannot
  be generated and never ran under Cucumber either) and lists the same 14 scenarios.
  - `promo-usage.feature` -1 wherever selected: the one `@not-implemented` scenario (10 undefined
    steps). Cucumber reported it `undefined`; playwright-bdd cannot generate it.
  - `default` -1 more: `@videosmoke`, a deliberate-failure smoke test of the old video hook.
- **All 52 feature files generate** with no undefined or ambiguous step. One step had to be ADDED
  to make that true: `that member should be listed` (`steps/community.js`). It was deleted on
  2026-08-03 with the search-by-Major scenarios, but the candidate Community end-to-end journey
  still calls it, so under Cucumber that journey had been reporting `undefined` - never running.
- **What a real run looked like.** `test:activity-log`: 20 passed in 2.6m at 3 workers (5m18s
  serial under Cucumber). A two-lane run (`candidate-active-view-profile` + the read-only
  `Subscription_Plan_Types`): 3 parallel + 5 serial, all passed, ONE merged report.
- **Three latent suite defects surfaced by running on the new runner, all fixed:**
  - `CandidateViewProfilePage.readHeader()` waited the full 30s action timeout reading an avatar
    `src` on candidates who have INITIALS, not a photo. It now reads `src` only when an image is
    visible.
  - `ReferralCodesPage.widget()` was pinned to `div.flex-1.flex-wrap`; the widget lost
    `flex-wrap`, so every step reading a code timed out against a dashboard showing it. Now
    structural.
  - The Share Code modal's type scale became responsive (`text-md lg:text-lg`, ...), and a class
    written `lg:text-lg` is not `text-lg`. Both forms are accepted now.
- **One product regression found, tagged `@known-issue`:** the Facebook share opens
  `facebook.com/sharer/sharer.php` with NO parameters (it carried `?quote=...<code>` on
  2026-08-28); WhatsApp, LinkedIn and X still carry the code.
- **Open, not investigated:** `Referral-Codes.feature` "An Expired promo code cannot be shared or
  redeemed" read `Active` after its backdate step. Re-running it mutates the live referral promo
  (restored by the After hook), so it was left for a deliberate run.
- **Extra-context videos** (superadmin, invited agent) are now attached as `.webm` files and play
  inside the Playwright report; the old HTML snippet's relative path only resolved beside the
  Cucumber report.
- **Uncommitted edits to the deleted Cucumber files were backed up** outside the repo before
  deletion, except `features/support/hooks.js`, whose working copy was removed before its backup
  (its code was recovered from a print taken earlier; everything it did lives in
  `fixtures/PagesFixture.js` / `WorldFixture.js`).


### Selector strategy (important)

Page Objects do **not** use single selectors — each locator is a comma-separated list layered from most-stable to most-fragile:

```
data-testid → ARIA role / name → semantic HTML (input[type=...]) → MUI/notistack structural classes → text-content fallback
```

This is deliberate: the app under test is a Material-UI + notistack frontend with few `data-testid` hooks today. The layered selectors let the suite tolerate small DOM changes and survive partial test-id rollout. When extending a Page Object, follow the same pattern — prepend a `data-testid` candidate even if the current build doesn't expose one yet, so the suite auto-upgrades when the app team adds them.

### Validation assertions

Several `Then` steps assert "validation occurred" disjunctively — e.g. `a validation message should be displayed for the email field` passes if **either** an inline helper-text error is visible **or** the submit button is disabled. This is intentional: different MUI form states surface validation differently, and both are acceptable feedback. Keep this pattern when adding similar steps.

## App under test

- **The app under test is `BASE_URL` in `.env` - `https://dev.talentforge.com.sa/login`.**
  >>> THE `azurestaticapps.net` URL THIS LINE USED TO NAME IS STALE, AND IT NOW SERVES A
  DIFFERENT PRODUCT. <<< Measured 2026-09-16: that host renders a **NXTSTIM** login page titled
  "NXTSTIM" whose form posts to `qa-nxtstim-api.azurewebsites.net/api/auth/login` and answers
  **400** for a TalentForge agent - so anyone following this line lands on another app's login and
  reads the refusal as a broken fixture. `pages/LoginPage.js` does not hardcode a URL at all; it
  reads `BASE_URL`. To point at another environment, change `BASE_URL` (the file also carries a
  commented `staging.talentforge.com.sa` line).
- Test accounts (valid / invalid / suspended / pending) are in `test-data/users.json`. The `_note` fields document backend state assumptions: the `suspended` and `pending` scenarios pass cleanly only if the backend has those accounts in the right state — otherwise they fall back to a generic invalid-credentials assertion.

## Promo code lifecycle (`features/Promo_Code/`)

Two feature files (TFF-42 / TFF-43), **split by whose screen a scenario drives** — that is what decides which portal it has to open:

- **`Promo-Code-Lifecycle.feature`** — the candidate's and agent's side: ownership, subscription-flow validation in each state, disable/expiry transitions as the candidate experiences them, the §11/§12 notification matrix, and the end-to-end walks.
- **`Promo-Tools-Tab.feature`** — the superadmin's Agent Profile → Promo Tools tab (TFF-43 §4–§10): the two sections, the banner's derived figures, the four tab states (assigned/disabled/expired/none), and the Add/Edit modal as a management tool. Sections 9–12 and 14 moved here out of the lifecycle file on 2026-07-31 rather than being rewritten.

They share one set of agents, **one step-definition file and one teardown hook**, and `npm run test:promo` runs both (`tags: '(@promo-lifecycle or @promo-tools) and …'`). The tab feature's steps live in `promo-lifecycle.steps.js` on purpose: they need its `superadminContext()`, `openPromoTools()`, `armRestore()` and agent registry, and a second step file would duplicate all four and give the two features separate browser contexts and separate teardown for the same promos.

**Tagging in these two files is deliberately minimal** (2026-07-31): the only type tags are `@positive`, `@negative`, `@edge-case`, `@known-issue`, and the only other tags present are the *functional* ones the config filters on — `@promo-lifecycle` / `@promo-tools` (feature level), `@not-automatable`, `@consumes-promo`, `@provision`, `@mocked`. Every descriptive tag (`@banner`, `@calculation`, `@usage`, `@ownership`, `@invoice`, `@redemption`, `@validation`, `@expiry`, `@disabled-promo`, `@notification`, `@empty-state`, `@fixed-amount`, `@payment`, `@e2e`, `@promo`) was removed. **Do not reintroduce them here** — they added report noise without changing what runs. 30 scenarios (13 in `Promo-Tools-Tab.feature`, 17 in `Promo-Code-Lifecycle.feature`), 27 of which run by default and 28 under `-p promoAll` (`npx cucumber-js --dry-run features/Promo_Code` is the authoritative count). Was 31/28/29 before the two save-toast scenarios were merged into one on 2026-07-31.

**Every scenario name starts with "Verify that ..."** (2026-07-31), in these two files only. It is a house convention for the promo coverage, not a suite-wide one — the other feature files keep their existing style, so do not "fix" them to match.

**Invoice arithmetic is asserted on three independent views, never one.** The rendered discount *line* (what the candidate is told), the rendered *total* (what they will be charged), and the preview API's own `base_amount` / `promo_discount` / `amount_after_promo` / `plan_credit` / `final_amount` (what the payment is built from). Deriving the discount as `subtotal - total`, which is all the suite used to do, is structurally blind to a discount that is calculated correctly and *described* wrongly — which is the live state of every Fixed Amount promo. `SubscriptionPage.readInvoiceTotals()` / `readDiscountLine()` are the readers; there is no VAT or tax line on any invoice (confirmed live), so `total = subtotal − discount − plan_credit` is the whole rule.

**§2 drives each promo across two plans, not one.** Against Monthly alone (SAR 155) a flat SAR 50 and "32.26% off" are the same number, so a fixed promo treated as a percentage would pass. The `| agent | plan |` table pairs each promo with Monthly *and* Quarterly: a percentage must scale with the subtotal, a fixed amount must not move. Yearly is excluded — the shared candidate already holds a subscription, so its subscribe-invoice preview answers 422 rather than a quote.

**That pairing is asserted across the two rows, not only within each one** (added 2026-07-31). The per-row checks compare each discount against the rule `.env` configures, so they would still pass if the app read the value off the wrong field and coincidentally landed on the right number. A final pass compares each agent's *own* two invoices against each other, which needs no configured expectation at all: a **percentage** must hold the same ratio on both subtotals *and* the two discounts must differ (a constant ratio alone is satisfied by SAR 0 off both, and an unchanged discount over two different subtotals is a flat amount masquerading as a rate); a **fixed** amount must be identical on both. Live 2026-07-31: 20% gives SAR 31 on SAR 155 and SAR 80 on SAR 400 — the percentage arithmetic is correct on both plans and in the preview API. The scenario's only red is still the Fixed Amount label (`"Discount (50% off)"` for a flat SAR 50).

**The report names the accounts, so a red row is reproducible without `.env`.** The step attaches, per row, the agent's name + email, the candidate's email and the agent code it signed up under, the promo code/type/value, and the arithmetic as a formula (`20% of the subtotal on SAR 155 = SAR 31`). `npm run test:promo:repair` prints the same agent↔candidate pairing per fixture before the drift table — that is the one command to answer "which accounts is the suite driving right now" when handing a defect to dev.

**No Scenario Outlines.** Every outline whose Examples varied only the *subject* (which agent, which field) was collapsed into one scenario driving a data table, because an outline runs once per example and each run costs a fresh browser context plus a superadmin login — a three-example outline paid for three logins to assert one rule three times. The consolidated steps walk the table, collect failures across every subject and report them together, which is also *more* informative: an outline abandons each example independently, so the report shows separate red rows without saying whether they share a cause. This took the two files from 61 scenarios to 32 with no loss of assertions.

Three neighbouring features keep their own concerns and are deliberately **not** duplicated — `Invite-agent.feature` (creating a promo on the invite form, and the authoritative home for the promo field rules: percentage ≤ 100%, fixed 1–999999 SAR, usage limit integers ≥ 1), `Referral-Codes.feature` (the agent's widget and share modal), `Subscription.feature` (the invoice itself).

- **Dedicated accounts.** Three agents in `.env`, kept apart from `REFERRAL_AGENT_*` so burning usage here cannot disturb `Referral-Codes.feature`:
  - `PROMO_UNLIMITED_AGENT_*` — usage limit 10000, the stand-in for "effectively unlimited" (the product has no unlimited option; Usage Limit is a required integer with a minimum of 1 in all three places it can be set).
  - `PROMO_LIMITED_AGENT_*` — usage limit **2**, held in reserve. It is the agent the disable/expiry scenarios mutate, but the suite **no longer spends its uses**: exhaustion is driven through a throwaway agent instead (below), so both remain available for manual investigation.
  - `PROMO_FIXED_AGENT_*` — **Fixed Amount SAR 50**, usage limit 10000. The suite's only flat-amount promo; the other two are Percentage Discount, so before it existed a fixed promo was never exercised past the invite form. SAR 50 is well under the SAR 155 Monthly subtotal and is *not* a percentage of it, so a discount computed the wrong way cannot coincidentally match.

  Each agent's `_PROMO_TYPE` (`Percentage Discount` | `Fixed Amount`) drives how the expected discount is calculated, so changing an agent's incentive in `.env` cannot leave the old arithmetic quietly passing.

  Each also carries **its own signup code and its own candidate** — `_REFERRAL_CODE`, `_CANDIDATE_EMAIL`, `_CANDIDATE_PASSWORD` (provisioned 2026-07-31, `npm run test:promo:candidates`). Not optional extras: redemption is ownership-scoped, so these are the *only* accounts that can redeem their agent's promo. See "OWNERSHIP SCOPING IS ENFORCED" below. They are never-subscribed and nothing in the suite pays with them, so they do not drift.

  Re-provision with `npm run test:promo:provision`, and **pass an env prefix to provision just one** — `node scripts/provision-promo-agents.js PROMO_FIXED_AGENT`. With no argument it re-invites *every* spec, minting new promo codes for agents already recorded in `.env` and orphaning the ones the suite runs against. A missing value fails the run with an explicit message rather than a mystery timeout.
- **Three browser contexts per scenario, not one.** The app holds one session per context, so the superadmin cannot share the candidate's. `superadminContext()` owns the Promo Tools leg, `agentNotifications()` opens a third context purely to read the agent's bell. All of them are keyed `_promo*` on the World — `referral-codes.steps.js` keeps its own admin context on `_adminPromo`/`_adminContext`, and sharing those keys would let one feature's `After` hook close the other's context mid-scenario.
- **State is mutated for real and restored.** Disabling and backdating happen against the live superadmin portal. Every mutating step arms `_promoNeedsRestore`, and the `@promo-lifecycle`-scoped `After` hook puts the parameters back and never throws — a failed restore is *attached to the report* instead, because masking the scenario's own failure with a cleanup error would be worse. A promo left disabled would break every redemption scenario on the next run for a reason that looks nothing like the cause.
- **Expiry is driven through the app's own PATCH.** The form silently disables "Save Changes" for any past date, so `AdminPromoToolsPage.backdateExpiry()` types a valid *future* date to enable Save and rewrites that one field on the request out. Nothing is stubbed — the app supplies its own auth and the API's answer flips the promo to "Expired".
- **What is faked and why.** Only `@mocked` §3 stubs the preview endpoint (both `/payments/paytabs/preview/` **and** `/subscription/change/preview/` — a stub covering one silently does nothing on the other flow). Exhaustion is *not* faked: `total_usage` is server-owned, and the reverse trick of lowering `usage_limit` to 0 was tried and rejected as dishonest — see `scripts/probe-promo-exhaust-and-warn.js`.
- **Usage limits, the derived figures, and exhaustion (§5).** One scenario, **two** real payments, against an agent minted for it and then abandoned. `Given a throwaway agent holds a promo code with a usage limit of 2` calls `provisionPromoAgent()` at runtime (superadmin invite → IMAP invite mail → set-password walk) and registers the result in the step file's `AGENTS` map under the key `throwaway`, so every existing keyed step drives it unchanged. **The agent is never written to `.env` and never reused** — a throwaway that got reused would already be exhausted and would fail as though the app were broken.
  - **Why two payments, on two different plans.** One redemption can only show that a figure *moved*, and a banner that overwrites its revenue with the latest payment satisfies that just as well as one that sums — and on a single plan "sum of both" and "the last one" are the same number anyway. Monthly (SAR 155) then Quarterly (SAR 400) at 20% off charges SAR 124 then SAR 320, which separates the three candidate readings: **summed SAR 444** (specified), overwritten SAR 320, credited at list price SAR 555. The step names whichever one the app matched, so a red run points at the actual defect instead of at a bare number mismatch.
  - Both figures are asserted to be **zero first** — the agent was minted seconds earlier — which makes everything after it an absolute figure rather than a delta off an unknown base, and catches a non-zero revenue against zero usage before it corrupts the arithmetic.
  - The same two payments then prove the status flips to `Expired`, both warning icons appear, the code stops being redeemable *with the standard inline error*, and the §11/§12 notifications fire.
  - **Every candidate belongs to the owning agent** — two paying, one signed up but not subscribed for the exhausted-code check. This is load-bearing, not tidiness: redemption is ownership-scoped, and a candidate from outside is refused with *the very same message*, so a candidate signed up under `SIGNUP_AGENT_CODE` could never redeem at all and the exhaustion assertion would pass without the limit ever being enforced. `agentSignupCode()` reads the throwaway's own **Agent Code** off its dashboard (`provisionPromoAgent()` returns only the promo code — the app generates the referral code on acceptance and the invite form never shows it).
  - **The banner reads are polled, not read once.** Both figures are written by the payment webhook, which can trail the candidate's redirect back from PayTabs by seconds (`AdminPromoToolsPage.refreshPromoTools()` re-fetches without going back through the agents list). Polling is for `=== want`, never `>= want`: a checkout counted twice is as much a defect as one not counted.
  - **Two steps at the very end reconcile the charge end to end** (added 2026-07-31): the amount the PayTabs page asked each candidate for, and the billing row + receipt panel + **receipt PDF** each payment left behind. They assert evidence captured *during* the payments, so they need nothing live — and they are last precisely because a failure there must not cost the eight assertions above them. See "Reconciling a payment against its record".
  - This replaced a one-payment version that also had two latent bugs — it signed its candidate up under the wrong agent, and reused the *shared* candidate for the exhausted-code check. Neither showed up because `@consumes-promo` kept the scenario out of every default run; `npm run test:promo-all` is what surfaces that class of bug.
- **The 80% threshold stays `@not-automatable`** and this is deliberate: the smallest usage limit with a distinct 80% point is 5, so observing that one notification would cost four throwaway signups and four real payments.
- **>>> THE PROMO DISABLED / RESUMED EMAIL NEVER ARRIVES FOR `PROMO_LIMITED_AGENT`, AND THAT
  SCENARIO IS RED FOR IT (measured 2026-09-07, reproduced 3x). <<<** The scenario is
  `Verify that disabling and re-enabling a promo notifies its agent by email`. **It is a product
  problem, not a suite one, and it is AGENT-SPECIFIC - do not report it as "the promo emails are
  down".** An earlier version of this note said exactly that and was wrong; the evidence that
  narrows it:
  - **The mails are still being sent, today.** `scripts/probe-promo-disabled-mail.js` counted 69
    `"Your Talentforge promo code has been disabled"` and 72 `"...has been resumed"` on record, the
    newest **2026-09-07 08:45**. A recipient dump showed those going to `iqra.farooq+21@` (a manual
    test) and to `PROMO_FIXED_AGENT` at 08:32, the latter raised by `test:promo:repair --fix`
    re-activating it. So the template, the trigger and the mail pipeline all work.
  - **This agent used to receive them and stopped.** Pairs land reliably through
    **2026-08-17 12:10** (uid 20716) and then nothing - which is also why the failure message
    always quotes the same baseline, `after UID 20715`.
  - **The address is not the problem.** `scripts/probe-promo-agent-stored-email.js` confirms the
    app holds exactly `PROMO_LIMITED_AGENT_EMAIL` on that agent's profile.
  - **The IN-APP half of the same event works perfectly** - the bell shows
    `"Your promo code CODETF5WMM8 has been disabled."` and its resumed twin, correctly named and
    timestamped minutes after a run, plus pairs on Sep 2 and Sep 4
    (`scripts/probe-promo-disable-inapp.js`). So the notification fires and only the email leg is
    missing for this agent.
  - **It is deliberately NOT tagged `@known-issue`.** That tag is for a deviation the product has
    decided to keep; this is a working feature that regressed on one account, and an expected-red
    tag is how a regression stops being noticed. **File it against TFF-484.**
  - **>>> RE-CONFIRMED AND SHARPENED 2026-09-09, AND IT IS WORSE THAN "THE PAIR STOPPED": THAT
    AGENT RECEIVES NO PROMO NOTIFICATION OF ANY KIND. <<<** The scenario still fails identically
    (same baseline, `after UID 20715`). `node scripts/probe-promo-mail-recipients.js 7` is the new
    probe that settled it - it lists every promo notification in a window **with its recipient**,
    which a bare count cannot do. Over 7 days:
    | mail | count | recipients |
    | --- | --- | --- |
    | disabled | 1 | `iqra.farooq+21@` only |
    | resumed | 4 | `+promofixms7uwru011@` (incl. **2026-09-09 12:54**), `+21@` |
    | expired | 4 | `+promofixms7uwru011@` (the 00:05 cron), `+21@` |
    - `PROMO_LIMITED_AGENT` appears in **none** of the three, over 7 days, despite its promo being
      disabled and re-enabled several times that day. So the **expired** mail is missing for it
      too, which the earlier note did not know - it is excluded from the promo mailing entirely,
      not just from the disable/resume pair.
    - **"The disabled mail is globally broken" was ruled out by experiment, not assumed.** Only
      one disabled mail exists in the window and every disable that day was on the one agent that
      receives nothing, so its health was genuinely unproven. Disabling **`PROMO_FIXED_AGENT`**
      (which demonstrably does receive mail) produced the disabled mail within the window,
      uid 24823, and the fixture was re-enabled straight after. **So the feature works and the
      defect is agent-specific** - report it that way.
- **>>> THE PROMO-EMAIL SCENARIO IS WHAT KEPT LEAVING `PROMO_LIMITED_AGENT` DISABLED, AND THE
  FAILED RESTORE WAS INVISIBLE. <<<** Diagnosed 2026-09-09, and this is the root cause of the
  recurring drift recorded above - the chain is worth knowing because every link in it looked
  like a different product bug:
  1. the scenario disables the promo, then fails waiting for a mail this agent never receives;
  2. the `After` hook's restore silently did nothing, leaving the promo **Disabled**;
  3. `test:promo:repair` then reported the drift, but only if somebody thought to run it;
  4. two `promo-tools` scenarios and two `promo-usage` scenarios failed on their FIRST status
     assertion, all four reading as product defects.
  - **Two defects in the teardown, both fixed.** `this.attach(...)` was **not awaited**, and an
    un-awaited attach from an `After` hook is dropped when the world is torn down - so the
    "could not restore" warning the hook exists to emit never reached the report. And
    `restoreParameters()` has an *"already in the snapshot state"* early return that reports
    `restored: true` whenever Save is disabled and nothing looked changed, so a restore that did
    nothing is indistinguishable from one that worked.
  - The hook now **re-reads the tab and verifies Status against the snapshot** rather than
    trusting the restore's own return value, and downgrades it to a loud warning when the two
    disagree. Verified: the scenario fails as before and the fixture is left **Active**.
  - **Do not "simplify" this by trusting `restoreParameters()`.** Its return value is exactly what
    was wrong, and a promo left disabled breaks four scenarios in two files for a reason that
    looks nothing like the cause.
- **`promo.name` IN THE PREVIEW IS A STALE DENORMALISED LABEL, AND IT IS RECORDED RATHER THAN
  FAILED ON** (measured 2026-09-09, `scripts/probe-promo-name-attribution.js`). For
  `PROMO_FIXED_AGENT` the preview returns
  `"iqra.farooq+promofixms7uwru01@bytecorp.io's promotion"` while the agent's profile, the agents
  list and `.env` all hold `...uwru011@bytecorp.io` - and searching the agents list for that stem
  returns **exactly one** agent, so the address in the label belongs to **nobody**. The server
  builds the string from the address once and never refreshes it, so an email change leaves it
  behind. (Note this is the same address the 2026-09-07 note calls a one-character `.env` typo -
  the `.env` value is right; it is the promo's label that carries the old spelling.)
  - `Verify that an agent-assigned promo is accepted, discounts correctly on every plan...` used
    to FAIL on this, with all four rows' arithmetic correct: 20% giving SAR 31 on SAR 155 and
    SAR 80 on SAR 400, a flat SAR 50 on both, and `"Discount (SAR 50.0)"` rendered correctly.
  - **Recording it is safe because ownership is proven harder, earlier in the same step**:
    redemption is ownership-scoped, and every quote is obtained by that agent's OWN candidate
    successfully applying the code, with the superadmin tab showing that code on that agent's
    profile. So the promo demonstrably belongs to the right agent and only the label disagrees -
    failing on it would keep the scenario permanently red over server-side text while every
    monetary assertion passes. Same call as the receipt-PDF currency step.
  - **Ask dev whether `promo.name` should be regenerated when an agent's email changes**, and do
    not promote this back to a hard failure without that answer.
- **That scenario was SCOPED TO EMAIL ONLY on 2026-09-07, by product decision** - the in-app half
  is not in scope for it. Four in-app assertions were removed, and with them the
  `the "limited" agent's unread in-app notifications are cleared` Given: that Given baselined the
  bell, **and it was also what bound "that agent"**, so the disable step now names the agent
  directly (`the superadmin has disabled the "limited" agent's promo code`, the keyed twin that
  already existed). The email baseline is taken inside the disable step itself, so nothing was
  lost by dropping it. **The in-app behaviour is no longer asserted anywhere in this file** -
  it works today, but a regression in it would now go unnoticed.
- **`PROMO_FIXED_AGENT_EMAIL` IN `.env` WAS WRONG BY ONE CHARACTER** (corrected 2026-09-07):
  `...promofixms7uwru01@bytecorp.io` where the app holds `...promofixms7uwru011@bytecorp.io`.
  Everything still resolved, which is why it went unnoticed for weeks - the agents list matches on
  a SUBSTRING, so the short form found the right row - but any *email* assertion on that agent
  would have waited on an address that receives nothing, and `openPromoTools()` by email timed out
  rather than opening the profile. **`test:promo:repair` does not check the stored email**; it
  compares the promo code and the four parameters only. `scripts/probe-promo-agent-stored-email.js`
  is what compares the two.
- **A LAPSED PROMO EXPIRY BREAKS EVERY SCENARIO ON THAT AGENT, AND USED TO BE REPORTED AS
  "informational"** (found and fixed 2026-09-07). `PROMO_FIXED_AGENT` sat on an expiry of
  **04/09/2026** for three days, and was also left `Disabled` by an earlier interrupted run. The
  two failures that produced looked nothing like a fixture problem:
  - `Verify that an agent-assigned promo is accepted, discounts correctly on every plan...` -
    both `fixed` rows reported *"the code was not accepted - no applied-code chip or Remove action
    appeared"*, i.e. the generic refusal every invalid state produces. Both `unlimited` rows passed
    with correct arithmetic throughout, which is what localises it to the fixture.
  - `Verify that a fixed discount larger than the invoice never produces a negative total` - died
    in its `Given`, because **a past expiry silently gates Save Changes**, so the setup could not
    write the value it needed.
  - **`npm run test:promo:repair` said "nothing to repair".** It printed expiry as
    `(informational)` while its own comment already said a past date is one of the reasons a
    perfectly-configured promo gets refused. Worse, `--fix` could not have repaired this agent
    either: the lapsed date gates Save, so every other value it typed in would have been thrown
    away with the modal. The script now reports `<-- LAPSED`, counts it as drift, and under `--fix`
    **extends the expiry FIRST** so the remaining repairs can be written. Verified: it detected
    both problems, extended to 2027-09-07, restored Status to Active, and both scenarios then
    passed (2 scenarios / 14 steps, 57s).
  - **Run the repair report before concluding a promo scenario has found an app defect.** Every
    invalid state - unknown, disabled, expired, exhausted, foreign - renders the SAME candidate
    message, so a refusal on its own never says which one you are looking at.
  - **>>> AND `test:promo:repair` CANNOT SEE AN ORPHANED *CANDIDATE* FIXTURE - IT SAID "NOTHING TO
    REPAIR" WHILE ONE WAS BROKEN (2026-09-09). <<<** The `candidate ... (signed up under agent
    code X)` line it prints is **echoed from `.env`**, not verified against the app, so the report
    is silent on the one thing ownership scoping actually turns on.
    - Measured: `PROMO_LIMITED_AGENT_CANDIDATE_EMAIL` **was not a candidate of the limited agent
      at all**. Every parameter was healthy - promo Active, expiry 01/11/2026, 1 of 2 uses spent,
      the tab's code matching `.env`, the agent's live Agent Code matching `.env`'s
      `_REFERRAL_CODE`, the candidate never-subscribed with zero billing rows - and the code was
      still refused with the generic `422 ["Invalid or Expired promotion code."]`. Two
      `promo-usage.feature` scenarios failed on it and read exactly like a product defect.
    - **The two competing explanations were ruled out by measurement, not reasoning.** Raising the
      usage limit 2 -> 5 and retrying changed nothing, which eliminates the limit; and all three
      promo candidates are `Unverified` with **zero** billing rows, which eliminates "this one had
      already redeemed it". The decisive test was searching each agent's own candidate list for
      its fixture: the unlimited and fixed candidates are listed and their promos are accepted
      (SAR 31 off and SAR 50 off respectively), the limited one was **not listed**.
    - **`node scripts/probe-promo-candidate-ownership.js` is now the one command that answers
      this**, and it is the first thing to run when a promo is refused for what looks like its own
      candidate. Read-only. Remedy:
      `node scripts/provision-promo-candidates.js PROMO_LIMITED_AGENT --force`, then paste the
      `_CANDIDATE_EMAIL` / `_CANDIDATE_PASSWORD` it prints into `.env`. Done 2026-09-09; both
      scenarios then passed unchanged (2 scenarios / 45 steps, 92s).
    - **The old candidate account is abandoned, not deleted** - a candidate cannot be deleted. The
      note above that these candidates "do not drift" is therefore too strong: nothing in the
      suite *pays* with them, but one still ended up detached from its agent.
  - **>>> IT HAPPENED AGAIN ON 2026-09-09, ON A SECOND AGENT, AND IT WAS REPORTED AS TWO PRODUCT
    BUGS. <<<** `PROMO_LIMITED_AGENT` was sitting **`Disabled`** (`PROMO_FIXED_AGENT` was
    `Disabled` **and** lapsed again, to 07/09/2026). Those two fixtures are exactly what the
    disable and backdate scenarios mutate, so an interrupted run is all it takes - the restore
    hook cannot fire if the process is killed between the two halves. The two failures it caused
    looked nothing like fixture drift, because each died on its FIRST assertion:
    `Verify that a disabled promo greys out...` fails at `should show the status "Active"` (the
    tab reads `Disabled`), and `Verify that an expired promo shows both warning icons...` fails at
    `should show the status "Expired"` (a disabled promo reports `Disabled`, not `Expired`).
    **After `npm run test:promo:repair --fix` both pass unchanged** (2 scenarios / 24 steps, 61s)
    and the restore hooks left all three fixtures `Active` afterwards. So: a promo scenario that
    fails on a STATUS assertion in its opening steps is a drifted fixture until the repair report
    says otherwise.
- **TFF-564 (a Fixed Amount promo rendering its discount line as `"Discount (50% off)"`) NO LONGER
  REPRODUCES.** With the fixed agent repaired, all four rows of the §2 discount scenario pass,
  including both `fixed` rows on two different subtotals. The "1 real defect §2 is designed to
  catch" recorded in the expected-baseline bullet below is therefore stale as of 2026-09-07.
- **THE INLINE REQUIRED ERRORS ARE FIXED, AND THE EXPIRY ROW WAS NEVER FALSIFIABLE** (measured
  2026-09-07). `Verify that clearing a required parameter shows its inline error` dropped
  `@known-issue` and passes. Value renders `Value is required.` and Usage Limit renders
  `Usage limit is required.`, both inline - so the recorded "3 of 3 render no inline error" is
  stale. **Expiry Date was removed from that table and must not be added back**: the control is a
  calendar-button-only react-aria DatePicker with **0 editable date segments** and no clear/reset
  control in its popover, and `AdminPromoToolsPage.expiryDateInput` resolves to react-aria's
  `aria-hidden` `tabindex="-1"` MIRROR input. `fill("")` on it left both the visible control and
  the mirror holding the original date - a complete no-op
  (`scripts/probe-promo-expiry-clear-noop.js`). So an empty expiry is not a state the product can
  reach, and the red row was the suite asserting an unreachable state, not an app defect.
  `setExpiryDate("")` now **throws** rather than no-opping silently - a silent no-op is precisely
  what disguised this as a missing error message. The same unreachable row was removed from the
  two Save-gating tables, where it had been **passing vacuously**; both scenarios still pass
  (2 scenarios / 19 steps, 58s).
  - **>>> BUT THE *ADD*-MODAL GATING TABLE KEEPS ITS EXPIRY DATE ROW, AND MUST. <<<** Corrected
    2026-09-09. "Removed from the two Save-gating tables" is true of the two **Edit**-modal
    tables (`promo-tools.feature` §3, which list Value and Usage Limit only) and there are
    **three** such tables, not two. The third is the Add modal's
    (`"Save Changes" should enable only once every required field is filled:`), where the row is
    load-bearing: the Add modal opens with Expiry Date and Usage Limit **both empty**, so Save
    cannot enable until all three fields hold a value. Drop the row and the step's FILLING phase
    reads `empty: []` after Value and Usage Limit, expects an enabled Save, and reports
    *"a complete form cannot be saved"* against a form that is genuinely incomplete - a false
    failure in the opposite direction.
  - **That difference broke the scenario, and it was the SUITE's fault, not the product's.**
    The step checks the gate in both directions - filling each field, then **clearing** each one,
    which is the only way the gate stays observable (filling one at a time only ever ends
    complete). The clearing loop already tolerated a field that *refuses to stay* empty, but not
    one that **cannot be emptied at all**: `setExpiryDate('')` throws by design, which abandoned
    the whole scenario at that line, reported an unreachable product state as a defect, and took
    the two assertions after it down with it. The clear is now skipped per field when the setter
    refuses, with the reason recorded in the trace - so the fill is asserted for all three fields
    and the clear only for the two the product can actually empty. Fixed and verified
    (1 scenario / 10 steps, 41s); the trace records five real gate observations plus the one
    honest skip. **Do not "tidy" this by deleting the Expiry Date row.**
- **The structural-completeness scenario was REMOVED on 2026-09-07** (`Verify that every agent's
  Promo Tools tab is structurally complete and its figures are coherent`), together with its
  now-unreachable step definition `each of these agents' Promo Tools tabs should be complete and
  coherent:`. Nothing else referenced either.
- **The `@known-issue` scenarios fail on purpose** and are part of the default run. They assert the written AC where the app currently deviates. There are **three**. In `Promo-Code-Lifecycle.feature`: expiry raising no notification at all (§6). In `Promo-Tools-Tab.feature`: the expiry picker **accepts today** where TFF-42 clarification #6 says "only from the next day onwards" (§3); and the **save-confirmation wording**, both halves of it in one `@provision` scenario (§6) — see the next bullet. A green promo run means *those three* are red and nothing else is.
- **The save toast: the app DOES distinguish adding from editing, and both wordings are short of TFF-43 §7.4** (captured live 2026-07-31, and this is the first time the two were separated). Adding renders **"Promo code added successfully."**, editing renders **"Changes saved successfully."** §7.4 asks for "Promo code parameters *added* / *updated* successfully", so the add path is one noun phrase away while the edit path does not mention the promo at all. TFF-183 is closed as Done. Consequences:
  - **Both wordings are asserted in ONE scenario** (`Promo-Tools-Tab.feature` §6, `@positive @provision @known-issue`), which adds a promo and then **edits the promo it just added**. That is why it works that way: the *added* wording can only be seen where a promo is really created, which needs a throwaway agent (saving is irreversible and no control in the portal removes a promo, so doing it to `REFERRAL_NOPROMO_AGENT` would destroy every Case 4 scenario) — and editing that same promo gets the *updated* wording free off the same live invite. The separate edit-only scenario on the `unlimited` agent was removed in the merge; it asserted the same rule for an extra browser context and superadmin login.
  - Both are checked by **one step that collects both mismatches and reports them together**, because Cucumber abandons a scenario at its first failing step: two consecutive `Then the toast should read "…"` steps would only ever show whichever wording failed first, and both deviate, differently. Everything before that step passes — the create and read-back assertions are real coverage, which is why the scenario is `@positive` as well as `@known-issue`.
  - **Cost of the merge, accepted on purpose:** the edit wording is now only checked when `@provision` runs, so it depends on the live invite and the IMAP inbox. `@provision` is in the default run, so this costs nothing day to day — but a run with the inbox down now loses both wordings instead of one.
  - The edit assertion previously failed with **"no toast appeared at all"**, which is a *different bug* from the one it exists to catch. That was the suite's fault, not the app's — see the toast-locator note below. Anyone who read that report went looking for a missing toast instead of a wrong one.
- **A disabled promo IS greyed out, and the scenario asserting otherwise was wrong** (fixed 2026-07-31; `@known-issue` removed). The app greys both sections by repainting their text — every content row goes from `rgb(83,88,98)` / `rgb(24,29,39)` to a uniform `rgb(164,167,174)`, with `opacity` left at 1 and no class change at all (6 of 6 banner rows, 8 of 11 Code Parameters rows; the exceptions are the section heading, the "Status" label and the new "Disabled" value, which correctly stay legible). It is now asserted as a **before/after comparison** — the disabling step records the active render first (`captureVisualBaseline`) — which is the only way a colour-based greying *can* be asserted: there is no absolute "muted" value to test a single render against. **The blur half of §8 is deliberately not asserted.** Two independent live scans found no `blur()` filter, no `backdrop-filter` and no blur class on either section, its ancestors or its descendants, in either state; the only structural change is `pointer-events-none` on the banner. So the app de-emphasises by muting, not blurring — consistent with TFF-185 being closed as Done and "not reproducible on Staging". **Ask dev whether the muting is the intended treatment before adding a blur assertion**; bolting one onto that scenario would make it permanently red on a synonym dispute and, since Cucumber abandons at the first failure, take the keeps-its-code and re-activation assertions down with it.
- **Every invalid promo state shows the SAME candidate-facing message, and this is now live-verified.** `scripts/probe-promo-invalid-state-errors.js` drives all four states reachable without a payment against one candidate session and one superadmin session, restoring the promo in a `finally` block. Captured 2026-07-31: for an **unknown code**, **another agent's active code**, a **disabled** code and an **expired** code, the preview API answers `422 ["Invalid or Expired promotion code."]` and the invoice renders the inline `"Invalid or expired promotion code"`, disables Apply, and shows no applied-code chip, no discount line and no change to the total. The fifth state, **usage limit reached**, needs a payment and is asserted in §5. Consequences recorded here so nobody re-litigates them:
  - The **disabled** scenario is no longer `@known-issue` — the app used to render the applied-code chip with no field error, and now does not. That tag came off on 2026-07-31 along with two extra assertions (Apply disabled, total unchanged).
  - The **expired** paths in the §9 walk previously asserted only "no discount line / total unchanged" and never the message. They assert it now.
  - Re-verify with the probe, not by reading the code: a locator for the *expected* wording can only ever answer "absent", which is why the probe collects every visible candidate string instead.
- **OWNERSHIP SCOPING IS ENFORCED, AND IT DICTATES WHICH CANDIDATE EVERY SCENARIO USES.** This is the single most important thing to know about the promo features. The app began enforcing TFF-42 §6 ("only that agent's candidates can redeem its promo") on **2026-07-31**, and it silently invalidated nine scenarios.
  - **Proved, not assumed.** `scripts/probe-promo-ownership-vs-subscription.js` holds subscription state constant and varies only ownership: a brand-new, **never-subscribed** candidate signed up under `SIGNUP_AGENT_CODE` is refused `PROMO_UNLIMITED_AGENT`'s code — Active, inside its expiry, 0 of 10000 uses — with `422 ["Invalid or Expired promotion code."]`, while §5's candidates *of the owning agent* redeemed the same shape of promo twice. That rules out the competing explanation (the shared candidate already holds a Yearly subscription, so a subscribe-invoice preview could not be quoted).
  - **The shared `CANDIDATE_EMAIL` account belongs to `SIGNUP_AGENT` and can never redeem any of the three promos.** Six scenarios failed outright and **three passed for the wrong reason**, which is worse — they asserted a refusal the app would have produced from ownership regardless of the disabled / over-subtotal / malformed state they claimed to be testing.
  - **The fix: one long-lived candidate per promo agent**, in `.env` as `PROMO_<X>_AGENT_CANDIDATE_EMAIL` / `_CANDIDATE_PASSWORD`, plus each agent's own signup code as `PROMO_<X>_AGENT_REFERRAL_CODE`. Provision with **`npm run test:promo:candidates`** (`scripts/provision-promo-candidates.js`); pass a prefix to do one, `--force` to replace an existing fixture. They are left **never-subscribed** and nothing in the suite pays with them.
  - The Gherkin step is `Given I am logged in as a candidate of the "<agent>" promo agent`. It signs in on the scenario's own page (so every existing invoice step keeps working) and no-ops when that candidate is already signed in — §2's four-row table therefore costs two logins, not four.
  - It also sets `world._provisionAgentCode`, which `provisionFreshCandidate()` prefers over `SIGNUP_AGENT_CODE`. That is what makes the **healing** paths correct: `I have an active "Monthly" subscription` and `my subscription is on a plan below "Yearly"` provision a candidate on their own, and without it they would hand a promo scenario a candidate that cannot redeem the promo the scenario is about.
  - **Which candidate a scenario needs is not cosmetic.** Any scenario expecting a promo to be ACCEPTED needs the owning agent's candidate; so does any scenario whose refusal must be attributable to the promo's *state* (disabled / expired / exhausted) rather than to who is asking. Only `Verify that only a candidate of the owning agent can redeem its promo code` keeps the shared candidate — that is its whole point.
- **The ownership scenario's precondition was rebuilt on 2026-07-31.** It used to assert `Total Usage === 0`, reasoning that a promo with no redemptions cannot have been redeemed by this candidate. Sound, but it breaks permanently the first time anyone redeems that promo, and it says nothing about whether the code is still live. It now checks the two things that could otherwise explain the refusal: `SIGNUP_AGENT_CODE` differs from that agent's own signup code, and the tab's code string matches `.env` with Status `Active`. An **orphaned** `.env` code, a disabled promo or an expired one each produce the identical message — so without those checks the scenario goes green while proving nothing. `npm run test:promo:repair` now compares the live code string too (it previously only echoed the `.env` value) and reports expiry, usage and revenue.
- **Derived-figure coverage (§9).** The banner's `Total Usage` and `Revenue Generated` are server-owned, so on the three long-lived agents neither can be predicted from `.env`. There they are asserted **relationally**: against each other (usage 0 ⇒ revenue 0, usage > 0 ⇒ revenue > 0, usage ≤ limit, revenue ≥ 0) and across portals (the superadmin's bare count vs the agent share modal's "*used* of *limit*"). The **absolute** arithmetic — TFF-43 §6.1's actual definitions, "the exact number of times the code was successfully applied at checkout" and "the total the platform has *received*" — is asserted only where the suite controls every input, i.e. against §5's throwaway agent, which starts at 0/SAR 0 and is redeemed twice at known amounts. Relational checks on a long-lived agent cannot do that: they cannot tell a correct sum from a plausible wrong one.
- **The label mismatch is tolerated on purpose.** TFF-43 §6.1 calls the figure "Revenue Generated"; the live tab renders **"Promo Revenue"** (2026-07-30). `readPromoRevenue()` tries `Promo Revenue` → `Revenue Generated` → `Revenue` and reports which label it found, so a rename does not read as "the figure is missing" and the failure messages quote the label the app actually uses.
- **"Save Changes" gating gets six scenarios, not one** (`Promo-Tools-Tab.feature` §3/§7). "The button is gated" has distinct failure modes and one scenario would stop at the first: each field cleared *on its own*; all three cleared *at once* and refilled one by one (a form that enables Save as soon as **any** field is filled passes the first and fails this); disabled on **open** when nothing has changed (load-bearing — `saveChanges()` distinguishes "nothing changed" from "invalid date" by it — but untested until now) plus the reverse, that reverting an edit re-disables it; **whitespace-only** values not counting as filled; and the Add modal's own gating, which is the only place a modal with nothing entered in it can be observed at all. The Add modal's step reads what each field genuinely holds after every edit rather than assuming an untyped field is empty, and then **clears** each required field in turn so the gate is observable from both directions. (It was written that way when the modal was believed to apply suggested defaults for Expiry Date and Usage Limit; on the real fixture it does not — see below — but reading rather than assuming is right regardless.)
- **The no-promo fixture is read-only.** `REFERRAL_NOPROMO_AGENT_*` is the only agent that can exercise TFF-43 §10 (Case 4), and **there is no UI anywhere in the portal that removes a promo code from an agent**. So every Case 4 scenario opens the "Add Code Parameters" modal, asserts its contract and **cancels** — one scenario exists purely to assert that cancelling created nothing. Consequence: the modal's fields, defaults, validation and Save-gating are all covered against that read-only fixture without ever saving.
- **The save half of §10.2 runs against a throwaway, not the fixture.** `Verify that saving the Add Code Parameters modal creates the promo the superadmin configured` (`@provision`) invites a brand-new agent with the promo checkbox **unticked** (TFF-42 §2.3 allows it), adds a promo from the tab, and abandons the account. It has to be a throwaway because saving is irreversible — no control anywhere in the portal removes a promo from an agent — so doing it to `REFERRAL_NOPROMO_AGENT` would destroy every Case 4 empty-state scenario on the first run. `provisionAgentWithoutPromo()` in `utils/promoAgentProvision.js` is the no-promo spec (`promo: 'unchecked'`); it costs a live signup + IMAP verification, hence `@provision`, but **no payment**, so it is deliberately *not* `@consumes-promo`. It saves **Fixed Amount** on purpose — the one incentive type the Add modal was never saved with.
- **Exhaustion is labelled `Inactive`, date expiry `Expired`** (both captured live 2026-07-31 in one §5 run). TFF-43 §9.1 words the two triggers identically, but the tab does not. The reachable state is the same — warning icons, refusal at checkout with the standard message, notifications — so §5 asserts the *state* via `the superadmin Promo Tools tab should show the promo as no longer usable` (fails only on `Active`, attaches the word it found) while §6 and the §9 walk keep asserting the literal `"Expired"` for date expiry, which is what the app renders there. Asserting `"Expired"` for exhaustion would cost two real payments to fail on wording and, because Cucumber abandons a scenario at the first failure, would take the eight assertions after it down with it. **Ask dev which word is intended before tightening it.**
- **Requirement gaps that are recorded rather than tested.** `Status` is specified as a dropdown (TFF-43 §7.2) but implemented as a toggle switch — the reachable states are identical, so no scenario asserts the control's shape. `Value`'s maximum is `[X]` in both tickets ("TBD — pending on the client's end", TFF-42 clarification #3); the invite form enforces 100% / 999999 SAR live, and those are the figures the modal-validation scenarios use, so **if the client supplies different numbers both files need updating together**. Both notes are at the foot of `Promo-Tools-Tab.feature`.
- **Expected baseline (2026-07-31, after the Add-modal / greying / toast fixes).** `-p promo` now dry-runs **26 scenarios** (the structural-completeness scenario was removed 2026-09-07; before that, 27). The reds should be **4**: the **3 intended `@known-issue`** listed above, plus the **1 real defect §2 is designed to catch** — a Fixed Amount SAR 50 promo renders its discount line as `"Discount (50% off)"`. The amount is right (SAR 50 on both a SAR 155 and a SAR 400 subtotal, so it is genuinely flat); the *description* is a percentage the candidate is not getting. Deriving the discount as `subtotal − total` cannot see this, which is why `readDiscountLine()` exists.
  - **This figure is derived, not measured.** The three scenarios that changed were each re-run and verified individually (`Add modal gates Save` ✅, `disabled promo greys out` ✅, the merged save-wording scenario), but a full `npm run test:promo` has NOT been run since. **Run one and replace this bullet with the measured result** — the fixes touch shared page-object code (`anyToast`, `saveChanges`, `readSectionVisuals`, the disable step's refresh), so a regression elsewhere in the two files is possible and unmeasured.
  - Superseded figures, for reference: `28 scenarios (8 failed, 20 passed)` / 19m09s was the baseline before these fixes; its 8 reds included the 2 Add-modal failures and the greying one, all three of which were the suite's fault and are now fixed. The earlier `22 scenarios, 4 failed` predates the tab feature.
  - **The 2 "pre-existing Add-modal failures" are resolved and were both test defects**, as `scripts/probe-promo-add-value-field.js` suspected. They looked contradictory — Save enabling too early in one scenario, staying disabled with everything filled in the other — because they had *two different* causes: the step assumed untyped fields were empty when the fields held an existing promo's values (the suite was on the wrong agent — see the Case 4 entry below), and `Save Changes` settles asynchronously so a single read caught it on either side.
- **THE TWO CASE 4 SCENARIOS WERE DRIVING AN ARBITRARY AGENT, AND THAT ONE FAULT PRODUCED EVERY UNEXPLAINED THING RECORDED ABOUT THE ADD MODAL** (diagnosed and fixed 2026-08-01). They failed in full runs, passed when re-run alone, and were verified by hand as working — the classic shape of a fixture problem, not an app one. Two independent defects, both in the suite:
  - **The fixture was addressed by NAME.** The row filter is `hasText`, a case-insensitive *substring* match, and `freshAgentIdentity()` surnames every provisioned throwaway `Qa<letters>` — so `REFERRAL_NOPROMO_AGENT_NAME` (`"NoPromo QA"`) is a prefix of every `"Nopromo Qa…"` agent `provisionAgentWithoutPromo()` has ever minted. Live 2026-08-01 it matched **ten rows** and `.first()` opened `/agents/view/1069`, a throwaway that had already been given a promo by §6 — not the `/agents/view/1021` the fixture records. The pool grows by one on every `@provision` run, which is why the failures came and went. This is also the true explanation of the old "NAME and EMAIL resolve to different agents (1058 vs 1021)" note. **Both Case 4 steps now address the agent by EMAIL**, and `AdminPromoToolsPage.disambiguate()` refuses to guess: a term matching several agents with no exact-cell match throws, naming every match, instead of silently taking the first.
  - **The Promo Tools tab paints the no-promo empty state while it loads, on EVERY agent.** Measured live (`scripts/probe-promo-tab-load-race.js`): on an agent that plainly holds a promo, "No code parameters set", its sub-message and its "Add Promo Code" CTA are all visible and "Edit parameters" is absent for the first **~1.0s**, then the section swaps. The loading render and the genuinely-empty render are **indistinguishable in the DOM**. `openPromoToolsAllowingEmpty()` used to race the two buttons and then read `editParametersButton.isVisible()`, which does not wait — the Add CTA won that race **3 times out of 3** and it answered "no promo" for an agent holding one. It now waits on the response the render itself waits on, **`GET /core/api/v1/agents/<id>/promotion/`** (the promo object, or `{"detail":"No promotion found for this agent."}`), and only then reads the DOM. Verified 4/4 in both directions afterwards. `promotionPayloadSummary()` puts that payload in the failure message, so a real fixture loss is quoted from the server rather than guessed from the DOM.
  - **What each failure actually was.** `modal is titled "Edit Code Parameters", not "Add Code Parameters"` — the agent *had* a promo, so the modal correctly opened as Edit; the premise guard and the empty-state assertion had both passed on the loading render. `cancelling the Add Code Parameters modal created a promo` — nothing was created; the closing re-fetch simply had time to settle and saw the promo that was already there.
- **Opening the Add modal does NOT create anything, and it applies NO defaults** (re-measured 2026-08-01 against the real fixture, `scripts/probe-promo-add-modal-heading.js`). On `/agents/view/1021` the modal opens titled **"Add Code Parameters"** — stable through 4s, from both the empty-state CTA and the small icon button in the Code Parameters header, which open the same dialog — with the promo-name field holding a server-**suggested** code (`PROMO5GXTVY`, the same string on every open) and **Expiry Date and Usage Limit both empty, Save disabled**. Cancelling leaves the agent with no promo. **The earlier note that the form fills Expiry Date with today+45 and Usage Limit with 30 "of its own accord" was wrong**: those were an existing promo's values, read off a throwaway the suite had opened by mistake (above). The gating step still reads what each field holds rather than assuming, which is correct either way and costs nothing.
- **Never assert a visual treatment by testing the one CSS property you guessed at.** Two scenarios were red for months against working features because of exactly this, and both were fixed on 2026-07-31 by reading what the DOM actually holds:
  - the **disabled promo's greying** was asserted from `opacity` / `filter` / a class-name pattern, none of which the app touches — it greys by repainting text `color` (uniform `rgb(164,167,174)`). A reader blind to `color` can only ever answer "absent".
  - the **save toast** was matched with a union ending in `[class*="toast" i]`, which also matches react-toastify's wrapper `<section class="Toastify">`. `.first()` resolves in **DOM order, not in the order the selectors are listed**, so it always picked the wrapper — whose children are `position:fixed`, so its own box is zero-height and Playwright never calls it visible. The scenario reported "no toast appeared" for a toast that was on screen throughout, which sends whoever reads the report after the wrong bug.
- **`Save Changes` settles asynchronously, so one read of it is not evidence.** Observed live 2026-07-31: the same three valid Add-modal field values read *disabled* at one point in a run and *ENABLED* a few interactions later. `waitForSaveEnabled()` (must enable — tolerates a late enable) and `saveStaysDisabled()` (must stay gated — watches the whole window, so a late enable is caught rather than missed) are the two readers, and they are **not** each other's negation. `saveChanges()` polls too; reading once there is what intermittently reported "Save Changes is disabled, so the promo parameters were not persisted" against a form that saves fine.
- **An assertion that says a fixture was destroyed must re-fetch before it says it.** `no promo code should have been created for that agent` read the DOM the cancelled modal left behind, via `isVisible()` which does not wait, and announced that the irreplaceable no-promo fixture had been consumed — while the agent was showing its empty state perfectly well. It now re-opens the tab, which asks the server the actual question.
- A `@known-issue` scenario must assert a requirement that **actually exists** in TFF-42/TFF-43. One asserting an unlimited-usage option was removed on 2026-07-30 for failing that test — both tickets specify "Usage Limit: Required, Integer only, Minimum value: 1", so it was permanently red against an AC nobody wrote. See the removal note at the foot of the feature file.

## Reconciling a payment against its record (`utils/chargeReconciliation.js`)

Added 2026-07-31. The suite could assert that a promo discount was calculated and described correctly on the invoice, and that the superadmin's Promo Revenue summed the invoice totals — and **nothing in between**. `payWithTestCard()` only filled in a card, so no assertion covered `invoice total → the amount the gateway asks for → the billing row → the receipt panel → the receipt PDF`. A promo that rendered a correct discount line and then billed list price passed every scenario except `Promo-Code-Lifecycle` §5's revenue step; the two other paid-with-promo scenarios asserted only that a success modal appeared.

- **What is observable on the gateway leg, and what is not.** Live 2026-07-31, `scripts/probe-gateway-amount.js`: `POST /payments/paytabs/initiate/` answers **201 with an empty body** and posts `{plan_id, billing_cycle, promo_code}` — **no amount anywhere**, and the redirect is an opaque `secure.paytabs.sa/payment/page/<token>`. The backend computes the charge and talks to PayTabs itself. So the amount is only readable **on the gateway's own page** (`Payment details ﷼155.00 PAY NOW`), which is also the right thing to assert — it is the figure the candidate reads before authorising. The first version of the reader expected an amount in the API response and reported "the amount could not be read" on a healthy checkout; **do not reintroduce that**, a missing API amount is how this app works.
  - `SubscriptionPage.readGatewayAmount()` waits for the card form first (the URL commits long before the gateway paints, and an early read returns an empty body that looks exactly like "no amount displayed"), and prefers **currency-marked** tokens: the page also contains a transaction reference `PMNT0202.6A6CDAC3.00018B95`, so scraping every number yields `155, 202.6, 6, 3.00018, 95`. `﷼` is U+FDFC.
  - The promo code **is** in the request payload, so "was the discount even submitted" is checkable independently of the gateway's rendering. `expectPromo` asserts it.
- **The receipt PDF's contents are now read.** `pdf-parse` v2 (a class: `new PDFParse({data})` then `getText()`) inflates the compressed text streams exactly as the viewer does. The old comment declining to read the file ("the PDF's text streams are compressed") was true and beside the point.
  - Fields are parsed **by label**, never as "does the charged amount appear anywhere in the file" — the live receipts state the right figure in one field and the wrong one in another, so a presence check passes on a document that contradicts itself. Same reasoning as `readDiscountLine()`.
  - **This found a real defect — see "M8 — the receipt PDF omits the pro-rata plan credit" under the Subscription tab section below. (It used to cite `SUBSCRIPTION_JIRA_VS_APP.md`, which is NOT in this repo — the reference was dangling.)** On any payment carrying a pro-rata plan credit the PDF's `Total Amount Paid` is overstated by exactly the credit (its table has no credit line and computes `Base − Discounts`), while the header `Amount:` field states the true charge. ~~Everything is priced in `$` on a product sold in SAR.~~ **STALE — the `$` is gone from newly generated receipts and the Saudi Riyal sign replaced it, DRAWN AS VECTOR PATHS rather than written as text; see "WITHDRAWN 2026-09-16" below.** `Paid receipt shows the correct amount and downloads as a valid PDF` is now `@known-issue` for this, and fails **only on the last step**.
  - **The credit, not the discount, is the cause — proved by a control payment, not reasoned about (2026-07-31).** Every wrong receipt has a discount on it and the only right one had `Discounts $0.00`, so "the discount breaks the total" is the natural reading and it is wrong. `Receipt PDF for a discounted first-time subscription states what was charged` (`Subscription_Billing_And_Receipts.feature:99`, `@provision @owned-by-unlimited @known-issue` — it is NOT in `Subscription.feature`, which no longer exists) makes a payment with a discount and **no credit** — a fresh candidate of `PROMO_UNLIMITED_AGENT` subscribing to Monthly with its 20% code, so the invoice is exactly `subtotal − discount`. Measured: SAR 155 − 31 = **124**, and the PDF states `Base Fee 155.00 / Discounts 31.00 / Total Amount Paid 124.00` with the header agreeing. **Re-measured 2026-09-16 on `REC-007557`: ALL steps pass** (the 2026-09-09 reading of "11 of 12, red on the currency step" was the vector-symbol misdiagnosis, withdrawn below) — the figures no longer carry a `$`, but they carry no `SAR` either, which is what that step now reports (the 2026-09-07 reading of the same 11/12 was against the `$`; the older "6 of 7" predates the step being split out). It is the cheapest re-check of the arithmetic after a fix (one signup, one payment) and the only paid receipt coverage on the **first-subscribe** path — every other paid receipt assertion runs on an upgrade, a different endpoint and a different payload. `SubscriptionPage.subscribeWithPayment()` is its driver, the first-subscribe twin of `upgradeWithPayment()` (different preview endpoint, and it watches `/payments/paytabs/initiate/` for a refusal, which `continueToGateway()` cannot see).
  - **The currency finding is its own step, placed after the arithmetic, and `verifyPdfStatesCharge()` returns it in its own list** (`currencyProblems`; `collectRecordEvidence()` exposes `pdfCurrencyProblems`). `$`-on-SAR fires on **every** receipt in the app, so while it lived in `problems` every receipt scenario was permanently red and the verdict they exist to report — does the stated total equal the charge — was unreadable. Steps: `the receipt PDF for that payment should price the plan in SAR` and `every redemption's receipt PDF should price the plan in SAR`. **If you add a receipt scenario, assert both and keep currency last** — Cucumber abandons at the first failure, so the order decides which defect a red run names.
  - The reader was validated against a **control** — a hand-built correct receipt — as well as the three live ones, so "it is not simply always red" is established rather than assumed.
- **Evidence is gathered non-fatally during the payment and asserted in later steps.** Cucumber abandons a scenario at its first failing step, and §5's two real payments pay for the usage, revenue, exhaustion *and* notification assertions. A wrong figure on the gateway or the receipt must not cost all of them, so the reconciliation steps are placed **last** in that scenario.
- **Rows are matched by amount, not by position.** `firstPaidRow()` assumes the grid is newest-first — true today, not promised, and on an account with two payments (subscribe, then a discounted upgrade) betting on the order reconciles the wrong row and passes.
- Dates are compared as a **set of components** with month names resolved, because the grid's own format has been seen as both `MM/DD/YY` and `DD/MM/YY` and the PDF writes `July 23, 2026`. A slash date's last component is the year even when it is two digits — inferring the year as "> 31" instead reported every receipt as date-mismatched, correct ones included.
- **`non-paid billing rows should have disabled receipt actions` now fails when there is nothing to check.** It used to `console.log('nothing to assert')` and pass. A scenario that reports PASSED having asserted nothing is worse than one reporting a missing precondition, because the report gives no hint that AC23 went unverified.

## Subscription tab — the mocked/state feature (`features/Candidate_Portal/Subscription_Mock_And_State.feature`)

### >>> THE BILLING GRID PAINTS TEN BLANK SKELETON ROWS BEFORE ITS DATA ARRIVES <<<

Measured 2026-09-07. They carry `role="row"`, and the grid itself is already visible, so
**`expect(billingGrid).toBeVisible()` and a row count are both satisfied while every cell is still
empty**. A status read taken at that moment returns `""` for a perfectly good Paid row — observed
directly: row 0 read `cell: ""` while its own badge already said `Paid`.

- **`SubscriptionPage.waitForBillingRows()` is the settle**, and it keys on the **date** cell
  (`[data-column-index="0"]`), which every row has whatever its status. **Do not settle on the
  status badge** — that would hang for exactly the case these scenarios exist to inspect, a row the
  app renders no badge for.
- The grid's columns are `Date Issued | Plan Type | Amount | Status | Receipt`, and **the date is a
  `role="rowheader"`, not a `gridcell`** — so `billingRowStatus()`'s `gridcells[2]` really is the
  Status column. That indexing is correct and was never the bug.

### The "failed payment" known issue was ENTIRELY the suite's, in two independent ways

`Verify that a declined payment row is labelled and its receipt actions disabled` (was
`A failed payment row is labelled…`) carried `@known-issue` recording that *"a FAILED payment
renders an EMPTY Status cell — the app has no label for that status — and its receipt
View/Download stay ENABLED"*. **Neither half is true.** Both were fixed on 2026-09-07 and the tag
removed; the scenario passes in 10s.

- **>>> THERE IS NO `FAILED` PAYMENT STATUS. <<<** `stubGracePeriod()` injected one. The API's own
  enum is `StatusDcaEnum: ["PAID","PENDING","DECLINED","CANCELED"]`, labelled
  `Paid / Pending / Declined / Canceled`, and the string `FAILED` appears **nowhere** in the whole
  717KB OpenAPI document (`https://dev-api.talentforge.com.sa/api/schema/` — note the schema is at
  `/api/schema/`, NOT under `/core/api/v1/`, which 404s). The tab renders nothing for a value it
  does not know, so the suite invented a status and then reported the app for not labelling it.
  Driven through the same stub, `DECLINED` renders **"Declined"** while `FAILED`,
  `PAYMENT_FAILED`, `FAILURE`, `UNPAID`, `ERROR` and `REFUNDED` all render empty
  (`scripts/probe-billing-failed-status-label.js`).
- **The "enabled receipt actions" half was read off the skeleton rows** (above). Settled, a
  declined row's View and Download are **both disabled**, exactly like Pending and Canceled.
- **A stub must use a value the API can actually return.** This is the same class as the exact-10MB
  PNG fixture: a scenario that never reproduced the state it claims to test, reported for weeks as
  a product defect.
- **Wording left for the PO:** the AC calls this state "Payment Failed"; the API and the UI both
  call it "Declined". The build is self-consistent, so the scenario asserts `"Declined"` and the
  divergence is recorded rather than left permanently red on a synonym — the same call the
  community empty-states and the doc-verification status wordings got.

### M8 — the receipt PDF omits the pro-rata plan credit and contradicts its own header

**A REAL product defect, re-measured live 2026-09-07 and still open.** Recorded here in full because
the reference elsewhere in this file points at `SUBSCRIPTION_JIRA_VS_APP.md`, **which does not exist
in the repo** — so the detail had nowhere to live.

On any payment carrying a pro-rata plan credit, the receipt's table has **no line for the credit**
and computes `Base − Discounts`, overstating the total by exactly the credit. The header `Amount:`
field states the true charge, so one document says two different things:

```
Amount: $1,045.00              <- header, CORRECT (what the gateway actually charged)
Base Fee           $1,500.00
Taxes/Fees             $0.00
Discounts (if any)   $300.00
Total Amount Paid  $1,200.00   <- 1500 − 300; the SAR 155 credit is missing
```

`Verify that Upgrade to a higher plan with a valid promo code and pay` is the scenario that catches
it (`Subscription_Change_And_Cancel.feature`). **12 of its 13 steps pass and only the last is red** —
the upgrade, the promo, the gateway amount and the billing row are all correct. That ordering is
deliberate and must be kept: this scenario costs a live signup and TWO real test-mode payments, and
a receipt nit must not cost the eight assertions above it.

- **It is verified by LABEL, never by "does the charged amount appear anywhere in the file".** The
  live receipts state the right figure in one field and the wrong one in another, so a presence
  check passes on a document that contradicts itself. Same reasoning as `readDiscountLine()`.
- **The credit, not the discount, is the cause** — proved by a control payment with a discount and
  no credit (`Receipt PDF for a discounted first-time subscription states what was charged`), where
  `Base 155 / Discounts 31 / Total 124` is correct and internally consistent.
- **The currency step was MISSING from this scenario and was added 2026-09-07.** Its sibling in
  `Subscription_Billing_And_Receipts.feature` asserts both, and the rule in "Reconciling a payment
  against its record" says to assert both with currency LAST. `$`-on-a-SAR-product fires on every
  receipt in the app, so ordering it before the arithmetic would make every receipt scenario
  permanently red on a currency nit and bury the verdict that matters. While M8 stands the currency
  step never executes (Cucumber abandons at the first failure) — it starts checking the day M8 is
  fixed, which is exactly what it is there for.

### >>> A STORED RECEIPT PDF CAN NEVER SHOW A FIX, AND ONE SCENARIO WAS RED FOR THAT ALONE <<<

Diagnosed 2026-09-09. `Verify that Paid receipt PDF states the amount that was actually charged`
(`Subscription_Billing_And_Receipts.feature`) was `@known-issue` for M8 and read as an open defect.
**It was reporting a stale artifact, not the build.**

- **The receipt PDF is generated at PAYMENT time and stored** —
  `s3…/private/payments/receipt_<payment id>_<yyyymmdd>.pdf`. It is not rendered on download. So a
  row's PDF is frozen in whatever template was live when that payment was made, and **no fix to the
  generator can ever appear in it.**
- The scenario opened the SHARED candidate's first Paid row. Measured: that account holds exactly
  **three** Paid rows, all dated **22–23 July 2026** — `REC-007251` (Yearly, charged SAR 354.45,
  states `Total Amount Paid $750.00`), `REC-007230` (Quarterly, charged SAR 45.00, states
  `$200.00`) and `REC-007228` (Monthly, charged SAR 155.00, states `$155.00` — correct, because it
  carries neither a discount nor a credit). Nothing newer exists on it, so the scenario re-reported
  a July defect on every run.
- **The scenario now provisions its own payment** (`Given I have an active "Monthly" subscription`,
  so `@provision @payment`) and reconciles THAT receipt against its own billing row. Verified
  **9/9 steps, 51s**, on `REC-007531` generated minutes earlier. `@known-issue` removed.
- Its distinct value is unchanged and is why it was not simply deleted: every other receipt
  assertion reconciles the PDF against the **invoice/gateway** evidence, this one against the
  **grid row**. A Monthly first-subscribe carries no pro-rata credit, so M8's arithmetic is
  deliberately not exercised here — that lives where a credit actually exists (the upgrade
  scenario) and, with a discount, in the sibling below.
- **The general rule: never assert a fix against a pre-existing stored artifact.** Same class as
  the `DATE-08_certificate_expiry_today.pdf` fixture going stale overnight — the file is evidence
  of what was true when it was written, not of what the app does now.

### >>> WITHDRAWN 2026-09-16: THE RECEIPT DOES PRICE THE PLAN IN SAR. THE SYMBOL IS VECTOR ART. <<<

**Everything in the section below was a WRONG DIAGNOSIS, and it was handed to dev twice.** The `$`
was removed *and replaced* — with the official Saudi Riyal sign — but the sign is **drawn as vector
paths, not written as text**, so no text extraction can see it and the reader could only ever
answer "absent". The product was FIXED; the suite reported the fix as a defect.

**How it was settled, so nobody re-derives it.** `receipt_7557_20260916.pdf` (the very file the
failing run read) was fetched and compared with the July receipts — same template, same generator:

| | July `REC-007228` | September `REC-007557` |
| --- | --- | --- |
| glyphs before the digits | `gid7 = "$"` (U+24) | `gid3 = " "` (U+20) |
| extracted text | `$155.00` | ` 77.50` |
| `constructPath` ops on the page | 40 | **55** (3 per amount × 5 amounts) |
| image-paint operators | 0 | **0** — so it is not a picture either |
| what the page RENDERS | `$155.00` | `⃀ 77.50` |

The 15 extra paths sit **immediately left of each amount**: a 9.0×10.5 box at a 5.2pt gap, on 5 of
5 amounts. There is no character there at all — `getTextContent()` is not missing the symbol, there
is nothing to miss.

- **The rendered page is the evidence, and rendering it is cheap.** PDF.js rasterises the receipt in
  a browser (Chromium's own viewer *downloads* PDFs headless, so serve the file and pdfjs over
  http and screenshot a canvas). One look answers what three text readers could not.
- **The fix: `currencyMarks()` in `utils/pdfText.js`** establishes the currency STRUCTURALLY — is a
  glyph-sized vector mark drawn immediately left of each bare amount? Three outcomes, kept apart
  because they are three different findings: marks found → priced in SAR with a drawn symbol (not a
  defect, recorded); no marks → genuinely priced in nothing (still a defect); check unusable →
  **UNVERIFIED**, reported as such and still failing. That last branch exists precisely because
  assuming absence from a check that did not run is how this was misdiagnosed.
- **Verified against four cases before being believed**: `REC-007557` → PASS (5/5 marked); both
  July receipts → still FAIL on `$`, so the check has not simply been made permissive; the Yearly
  July receipt → still reports M8; and a synthetic receipt with bare amounts and no marks → FAIL.
- `@known-issue` is off the scenario. Its first 6 steps already passed in the 2026-09-16 run and
  the 7th was **replayed against that run's own receipt**. That is a replay, not a fresh
  end-to-end run — re-measure when a run is affordable.
- **The one thing still worth telling dev**, recorded not asserted: a currency symbol that no text
  extraction can see is lost to copy-paste, to search, and to screen readers. Ask whether the sign
  can be emitted as a character (U+20C0) rather than outlines.
- **The general rule this cost us: a reader that can only answer "absent" must never be the sole
  basis for a defect report.** Same class as `readMemberCards()` under-counting, `uploadedFileName()`
  resolving to a heading, and the promo save-toast locator resolving to the notistack wrapper — but
  this one went further, because the text layer's answer was *correct* and the conclusion drawn
  from it was not.

### THE `$` IS GONE FROM NEW RECEIPTS, BUT NOTHING REPLACED IT (measured 2026-09-09) — SUPERSEDED, see above

Two fresh receipts generated this day, `REC-007531` and `REC-007533`:

```
Amount: 155.00 … Base Fee 155.00  Taxes/Fees 0.00  Discounts (if any) 0.00  Total Amount Paid 155.00
Amount: 124.00 … Base Fee 155.00  Taxes/Fees 0.00  Discounts (if any) 31.00 Total Amount Paid 124.00
```

- **The arithmetic is right and internally consistent** on both, header and total agreeing, so the
  discount path on a first subscribe is confirmed fixed on a genuinely new document.
- **But the dollar sign was removed without `SAR` being added** — every figure is now a bare
  number. `parseReceiptFields()` reports `currency: null`, which is neither `'$'` nor `'SAR'`.
- **That made `the receipt PDF … should price the plan in SAR` PASS VACUOUSLY**, because the only
  check was `f.currency === '$'`. A step going green on a document that prices the plan in nothing
  at all is worse than a red row: it retires the assertion silently. `verifyPdfStatesCharge()` now
  reports the `null` case as its own `currencyProblems` entry, with its own wording so it is not
  confused with the old `$` finding.
- Re-measured after the change: `Receipt PDF for a discounted first-time subscription states what
  was charged` is **11 of 12, red on the currency step alone** — the arithmetic step immediately
  before it passes. That is the intended ordering (currency LAST) doing its job.
- **Question for the PO: should the receipt state `SAR` explicitly?** A bare figure on a document
  sold in SAR and signed off "Talent Forge Saudi Arabia" is a real reading hazard. The scenario
  keeps `@known-issue` for it.
- ~~**RE-CONFIRMED 2026-09-16 on `REC-007557` … the reader was CLEARED as the cause.**~~
  **WRONG, and withdrawn the same day — see the section above.** The `$`-on-the-July-receipts
  control was sound as far as it went and the conclusion drawn from it was not: it established
  only that the reader sees a currency marker *in the text layer* when one is there, which says
  nothing about a symbol drawn as vector artwork. **A control has to rule out the competing
  explanation, not merely confirm the reader works on the case you already understand.**
- **>>> THE MARKER SET WAS WIDENED, AND NOT COSMETICALLY — THE FIX FOR THIS DEFECT WOULD HAVE READ
  AS A BIGGER ONE. <<<** `parseReceiptFields()` recognised only `SAR`, `$` and `ر.س`. It did not
  recognise **`﷼` (U+FDFC), which is what the PayTabs page itself renders**, nor `U+20C0` (the
  2025 riyal sign), nor a bare `SR` — although the money prefix in the very same function already
  accepted `SR`. The prefix is OPTIONAL, so an unrecognised symbol does not merely go unnoticed:
  it sits between the label and the digits and **every field comes back null**, which the caller
  reports as *"the receipt PDF states no 'Total Amount Paid' or 'Amount:' field this reader
  recognises"*. Measured against a synthetic `﷼` receipt before the change: `currency`,
  `headerAmount` and `totalPaid` all null. So the day dev priced the receipt in `﷼`, the
  ARITHMETIC step would have gone red first and the report would have named a template that had
  just been fixed. All six shapes now classify correctly, and `Talent Forge Saudi Arabia` still
  yields `null` rather than a false `SAR` (there is no `sar` substring in it).

### The Change Plan → Yearly flow needs its tier guard, and one scenario was missing it

`Verify that Cancelling the payment on PayTabs shows a "payment unsuccessful" error and keeps the
invoice` (`Subscription_Invoice_And_Payment.feature`) died at
`And I choose the "Yearly" plan and continue` with a bare `locator.click: Timeout 30000ms` against
the Yearly card — which reads like a broken selector and says nothing about the cause.

**An upgrade TO Yearly only exists while the account is on a lower tier**, and the shared
candidate's tier drifts between runs: a real upgrade in an earlier run leaves it ON Yearly, and the
Change Plan modal then correctly offers no Yearly option at all. `Given my subscription is on a plan
below "Yearly"` is the existing guard for exactly this, and **all three sibling scenarios driving
this flow already opened with it** — only this one did not. Two of those three are not `@provision`,
so adding it needed no tag change. It is a fast no-op when the tier is already below Yearly; when it
heals it provisions a fresh candidate and pays for Monthly (`ensurePlanBelow`).

### `I should remain on the invoice with my details retained` pinned the SHARED candidate's address

Second, independent defect in the same scenario, exposed only once the guard let it get that far.
The step asserted the invoice email contains `CANDIDATE_EMAIL` — but the healing Given signs in as a
**brand new** candidate and records it on `world._freshEmail`, so the step failed with

```
Expected substring: "candidates@iqra.anonaddy.com"
Received string:    "candidates+submtr2krsd5zfw@iqra.anonaddy.com"
```

on an invoice that had retained the customer details perfectly — **reporting the very defect it
exists to catch, on a run where nothing was wrong**. It now compares against
`this._freshEmail || CANDIDATE_EMAIL`, i.e. whoever is actually signed in, and names that account in
the failure message. The `@mocked` gateway-unreachable scenario shares this step and still runs on
the shared candidate, where `_freshEmail` is unset and the fallback applies — verified, still green.

**Both scenarios pass:** the PayTabs one 11/11 in 1m13s (healing run), the gateway one 9/9 in 8s.
Neither failure was a product defect.

### FIVE `@known-issue` SCENARIOS IN THAT FILE NOW PASS, AND THEIR TAGS ARE STALE

Measured 2026-09-07: `npx cucumber-js -p only features/Candidate_Portal/Subscription_Mock_And_State.feature`
reports **11 scenarios, 11 passed, 0 failed** in 2m39s, and five of those eleven still carry
`@known-issue` (invoice toggle, invoice customer, change-plan, billing-history formatting, receipt
viewer). **A `@known-issue` that passes is misleading in the opposite direction** — it tells the
team a defect exists when it does not, and it hides the moment one reappears. They were not touched
here because only the failed-payment scenario was in scope; **re-check each against its AC and drop
the tag where the app now behaves**, rather than assuming the list is still accurate.

## Community module (`features/SuperAdmin_Portal/Community/`, `features/Candidate_Portal/Community.feature`)

Two feature files over the SAME two routes — `/community` and `/community/view/<id>` — driven from two roles: the superadmin's management screens (TFF-264) and the candidate's directory (TFF-334). **One step file (`community.steps.js`, ~265 steps) and two Page Objects** (`CommunityPage` for the listing/community page, `CommunityFormPage` for Create/Edit). `npm run test:community` runs both, and that is the right entry point: the two roles render the same cards, header, filters and empty states, so a change to either can break the other and running one alone lets a regression land green.

- **`@creates-community` is excluded from the default run and cannot be replenished.** Saving a community PERMANENTLY CONSUMES A UNIVERSITY — AC 3.1 offers only universities without an active community and the module exposes **no delete CTA anywhere**. Check how many the Create dropdown still offers before spending them with `npm run test:community-create`, and never loop it.
- **Two `COMMUNITY_JIRA_VS_APP.md` files exist and are byte-identical** (`features/` and `features/SuperAdmin_Portal/Community/`). Edit both or delete one; they will drift otherwise.

### Expected baseline for `npm run test:community` (re-measured 2026-08-10)

`features/SuperAdmin_Portal/Community/Community.feature` holds **43 scenarios**; **38** run under the
default profile and under `-p community`; **40** under `-p only`. So **3 are `@not-automatable`** and
**2 `@creates-community`**. The candidate file is commented out in full and contributes none.
**These figures were measured, and the ones they replace (45 / 39 / "4 `@not-automatable`") were
already stale before 2026-08-10 — trust `npx cucumber-js features/SuperAdmin_Portal/Community
--dry-run`, and re-measure rather than adjusting the numbers here by arithmetic.**

**Exactly 5 scenarios carry `@known-issue`, and those are the reds to expect** (enumerated with
`--dry-run --tags "@known-issue"`, which is how to re-check this list):

1. the member-search **placeholder** invites a search by Major, which the search does not match
2. Majors filter offers case-duplicate options
3. Majors filter's search matches token-wise rather than as typed *(new 2026-08-03)*
4. the public profile omits the Major the card shows (`View Profile … exposes no private contact
   details`)
5. an agent reaches `/community` where the access table expects denial (`only a superadmin can
   reach …`)

**Two items this list used to carry are NOT tagged `@known-issue` in the file**, so if they fail they
are *unexpected* reds, and one of them is under suspicion:
- **`the member count agrees across the listing card, the header and the members listed` is plain
  `@negative`.** Measured 2026-08-10 on Arid Universit (id 37): listing card **43**, header **43**,
  API `count` **43** — they AGREE, and the only disagreeing figure was `readMemberCards()` at **7**.
  So the "43 / 63 / 7" on record is at least partly this suite's own reader, not the product. **Do not
  hand that one to dev before re-measuring it** — see the `readMemberCards()` note below.
- **A success-labels scenario no longer exists in this file at all** (`grep "success labels"` finds
  nothing), so the old entry for it was pointing at nothing.

**The image-validation scenario left that list on 2026-08-10 and now PASSES 11 of 11** (measured).
It was the longest-standing red in the module, at 16 mismatches, then 11, then 8, and none of the
three reductions was an app change — each was a decision that **the build, not AC 11, is the source
of truth for the six image rows**: the per-field format wording (PO, 2026-08-03), the size wording,
and finally the **toast surface** (both 2026-08-10). AC 11 needs amending on both counts; the detail
is in `COMMUNITY_JIRA_VS_APP.md` §5. Consequences worth keeping:
- **It is now a regression lock, so a red row means the behaviour CHANGED, not that the AC is
  violated.** Both failure messages say so and name what moved. **A change is not automatically a
  defect** — if dev makes these errors inline, confirm the intent and update the scenario rather than
  treating the app as broken.
- **The four required-field errors in the SAME AC 11 table are inline, and their scenario still
  asserts inline.** The build is inconsistent with itself and both scenarios are right. Do not "make
  them consistent" with each other.
- **Two steps in it were permanently skipped while it was red** — `no preview should be displayed for
  any rejected image` and `the "Save" button should be disabled` — because Cucumber abandons at the
  first failure. They execute now, which is 2 assertions the module never actually ran before.

**The AC 7.4 "Apply Filters / Cancel" scenario was REMOVED on 2026-08-10, not re-tagged.** Applying a
filter the moment its option is picked is the intended design (product decision), so it was
permanently red against a requirement nobody intends to build — the same test the unlimited-usage
promo and search-by-Major scenarios each failed. Opening the panel and selecting nothing already
changes nothing, which is the only guarantee the AC's Cancel was protecting. AC 7.4 needs amending;
`COMMUNITY_JIRA_VS_APP.md` §10 holds the measurements and the removal note is in the feature file.
- **Its two `the number of candidate cards listed should be unchanged` steps PASSED on a run where the
  list really went 12 → 2**, because `readMemberCards()` answered a constant 7 in both states. The
  scenario's red came only from its final chip check, so the two assertions that were *designed* to be
  the evidence proved nothing. **That is the reason to distrust any card-count assertion built on that
  reader until it is fixed.**

**`readMemberCards()` UNDER-COUNTS, AND IT IS THE MODULE'S MOST-USED READER** (measured 2026-08-10,
`scripts/probe-community-filter-confirm.js`, which prints it beside a raw-DOM count and the server's
own answer). On Arid Universit page 1 the API returns `count: 43` with 12 results, the DOM holds **12**
View Profile CTAs, and `readMemberCards()` returns **7**; with a Majors filter applied the API and DOM
both say **2** and it still says **7**. Its structural filter (`CommunityPage.js:389-394`) admits a
card only if the text contains both "track progress" and "hours learned" **and** is under 700
characters, and 5 of 12 cards fail that and are dropped silently. **Fixing it is not cosmetic — it
decides whether the member-count scenario is a product defect at all**, and every member-count,
filter-narrowing and member-search assertion reads through it.

**MEASURED AT LAST - a full `-p community` run on 2026-09-07: 38 scenarios, 32 passed,
1 pending, 5 failed, 496 steps, 43m 28s** (headless). This replaces the long-standing "a full run has NOT
been performed" note, and it CONFIRMS the expected baseline above rather than revising it: the 5
reds are exactly the 5 `@known-issue` scenarios enumerated in that list, and the 1 pending is the
`@not-automatable` no-description header scenario. Nothing else in the module is red.

So a green `npm run test:community` means those 5 and only those 5. In particular the four IMAGE
scenarios (accept JPG/PNG by picker and drag-and-drop, the reject table, the exact-10 MB boundary,
and replace/remove) all PASS - in isolation, in the full run, and under both runners - so a report
naming one of them is a regression, not the module's normal state.

### Consolidation (2026-08-02): the superadmin file went 49 → 43 scenarios with no assertion lost

Same reasoning as the Promo files' 61 → 32. **Every scenario costs a fresh browser context and a superadmin login**, so two scenarios that arrive at the same screen to look at the same state are paying twice for one observation. Six merges, each recorded in a comment at the site so nobody "restores" them:

- **The AC-1 module-overview scenario was deleted outright.** All four of its assertions were the weaker half of an assertion already running elsewhere — it checked that a search field *exists* where §6.1 checks its placeholder, and that cards *offer* an edit icon and a View Community CTA where §6.1's element table already requires both. Only its two Create-form checks were unique, and they moved into §2.1, which already has that form open. **Four step definitions became unreachable and were deleted with it.**
- **The two `@creates-community` scenarios became one, and this one saves a non-renewable resource.** Success-modal contract and "double-click creates only one" now run as a single save, because **double-clicking is a strictly stronger precondition** than the single click the modal scenario used: everything the modal must show after one click it must also show after two. **3 → 2 universities consumed per create run, permanently.**
- **"Search covers every page" folded into the main search scenario** — same control, same setup, same behaviour, only the subject differs. Two steps instead of another context and login. It remains a real risk (a search filtering only the rendered page passes every other row and fails this one).
- **The card-actions scenario was deleted and its two navigations pushed into the scenarios that assert something about where they land** — the edit icon into §7.1, the View Community CTA into §8.1. Navigating and then asserting nothing about the destination was its whole weakness, and its "form should be pre-filled" was **the one outright duplicated assertion in the file** (§7.1 makes it too).
- **§7.1 + §7.2 merged.** Both opened Edit for the same community and inspected the same untouched form — one its contents, the other its Save gating. That is one arrival at one screen. Contents are asserted **before** gating on purpose: a form that failed to pre-fill would also fail the gating steps, and "Save did not enable" for a form that never loaded sends the reader after the wrong bug.
- **§10.2 + §10.4 merged, and one of the two filter drivers deleted.** They ran the *identical* loop — first option of the same three filters, cleared between rows — then asserted different things about it. The merge needed no new plumbing, which shows how duplicated they were: the surviving driver **already recorded `clearAllOffered` and `clearAllCursor`** alongside the request status and cards, so its results were a strict superset. Every `Then` now reads that one recorded pass without re-driving the app.

**What was deliberately NOT merged, and why** — so this does not get "finished" later at the cost of coverage:
- **Anything whose neighbour is `@known-issue`.** A red scenario merged into a green one takes the green assertions down with it, because Cucumber abandons at the first failure. That is why the 10 MB boundary stays out of the accept-formats table, and why the Majors-duplicates and confirm-before-applying filter scenarios stay separate.
- **The two Create dropdowns.** University-exclusion and the AC location list are genuinely different rules; merging them would produce one long scenario whose first failure hides the second rule entirely.
- **The no-members and no-description header scenarios.** They need *different* fixtures, and no community is guaranteed to be both.

### The Create Community page's scroll thrash was ONE mis-resolved locator (fixed 2026-08-03)

The page appeared to "scroll up and down continuously" and every cover upload took ~17s. Both were
the same fault, and it is the trap this file already warns about twice:

- **`getByRole('button', …)` MATCHES `<input type="file">`.** Chromium reports `role="button"` for a
  file input, and its accessible name comes from its `<label>` — so
  `getByRole('button', { name: /upload cover photo/i })` matched the form's 1×1
  `<input class="peer sr-only" type="file">` as well as the real `<button>`, and `.or(…).first()`
  resolves in **DOM order**, so the sr-only input won every time. Its hit target at its own centre
  is a `<span>`, so the click could never pass Playwright's hit-target check: it **retried for the
  full 10s timeout, calling `scrollIntoViewIfNeeded` on each retry**, then was swallowed by
  `.catch(() => {})`. Measured: 10 scroll events with **8 direction reversals** per upload, at the
  1280×720 viewport a real run uses. Restricted to real `<button>`s, the same click opens the picker
  in **51ms** and the whole sequence produces **zero** scroll events.
- **The viewport is why this was invisible in probes.** `videoRecorder.contextOptions()` sets
  `recordVideo.size` but **no `viewport`**, so every run gets Playwright's default **1280×720**. The
  Create form is 918px tall, so it scrolls there — and an early probe run at 1600×950, where the form
  fits exactly, reported zero scroll events against a page the user watches thrash. **Reproduce
  layout-dependent behaviour at 1280×720.**
- **The cover control is named differently on the two screens.** Create renders
  `<button>Click to upload cover photo</button>`, Edit renders `<button>Change photo</button>`. The
  old locator matched **nothing** on Edit, so every edit upload silently took the `setInputFiles`
  fallback. Both are in the locator now.
- **`confirmCrop()` clicked Save ~450ms before the cropper had decoded anything.** The modal appears
  at +1336ms and its image at +1790ms, while Save is enabled from the moment it opens — so "Save is
  clickable" is not "the cropper is ready", the first click was usually a no-op, and the helper then
  absorbed an 8000ms `waitFor({state:'hidden'})` before retrying. `cropImageReady()` waits on the
  image; a Save clicked after it closes the modal in **258ms**.
- **`waitForCropModal()` races the rejection rather than waiting the modal out**, because the reject
  table has eight rows and a naive appear-wait would add a minute to that one scenario. It takes a
  `baseline` of the error already on screen — without it, a toast left by the previous row reads as
  this row's verdict and a file about to be ACCEPTED is reported as refused.

`settle()`'s `networkidle` was measured and is **not** a problem on this form (reached in 0–1ms,
three times running). Do not "optimise" it on suspicion.

### Do not assert a rendered value by re-querying the DOM a second way

Every one of the five suite defects found on 2026-08-02 was a second reader disagreeing with a first, or a locator resolving somewhere nobody intended. They cost **10 scenarios**, and every one of them was reported as an app defect.

- **A comma-separated union resolves in DOM ORDER, not in the order the selectors are written.** `selectFilterOption()` indexed `'[role="dialog"] label, [role="listbox"] label, [role="dialog"] button, [role="option"]'` with `.nth()`, and react-aria renders a zero-content `<button aria-label="Dismiss">` first inside the popover. It is *visible*, so Playwright kept retrying, but it sits under the option list — every click was intercepted by a `<label>` and timed out after 15s. Four scenarios. **`readOpenFilterOptions()` and `selectFilterOption()` now share one `resolveFilterPopover()` pass**, so the index a step reads off `options` is the index the click acts on; they previously indexed different lists, so even a successful click could select the wrong option.
- **`anyFilterApplied()` was incapable of returning `false`.** It counted every visible `[aria-expanded]` element whose text was not one of three bare labels as a selection chip — and the page shell's region menu renders "SA". Measured: `true` on a fresh page, `true` with a filter, `true` after Clear All. Every `no filter should be applied` step was unpassable. It is now scoped to the filter triggers, which are plainly observable: the trigger reads `Members`, gains a count when selected (`Members1`), and Clear All appears only while something is applied. `filterState()` returns the detail so a failure quotes what it saw.
- **`readMemberDetails()` scanned every `h1–h4` in the DOCUMENT**, unscoped, taking each heading's sibling spans as a "member". It now delegates to `readMemberCards()`, which derives a card structurally from its View Profile CTA and its three widget captions, and reads `major`/`gradYear` inside that boundary. (Note: the "Activity log" member that prompted this is a **real candidate account**, not chrome — the rewrite is still right, but it was not that failure's cause.)
- **`pasteAbout()` inserted nothing at all.** A dispatched `ClipboardEvent` is untrusted, so the browser performs no default action, and `clipboard.writeText` is rejected without a granted permission — so the broken fallback was always the path taken. It read back 0 characters at every length and the scenario reported "the app does not cap About University at 300". **The app caps correctly** (`maxlength="300"`; 400 in → 300 held). `keyboard.insertText()` is the right primitive: one `input` event, **zero** keydowns, so it stays a genuinely different code path from typing (which is the point — a per-keystroke guard lets a paste straight through) and still respects maxlength.
- **`selectFirstDifferentLocation()` did not clear the box before opening it.** Location is a type-to-filter combobox pre-filled on the Edit form, so it filtered the list down to the one value being excluded and reported "No location other than the current one was offered" against a dropdown of 31. `selectUniversity()` already documented and guarded this exact trap; it was simply never applied here.

### The empty states: four wordings, and the CTA belongs to filters only (corrected 2026-08-03)

AC 10.1 specifies one wording; the build renders **four**, each naming whichever of search and
filters is actually active. Measured live — the full table is in `COMMUNITY_JIRA_VS_APP.md` §14:

| Surface | Heading | Body | Clear CTA |
| --- | --- | --- | --- |
| `/community` search, no match | `No communities found` | *(none)* | *(none)* |
| member SEARCH only | `No results found` | `…matching your current search.` | *(none)* |
| member FILTER only | `No results found` | `…matching your current filters.` | `Clear all filters` |
| search AND filter | `No results found` | `…matching your current search and filters.` | `Clear all filters` |
| Majors popover, no match | `No results found.` *(full stop)* | *(none)* | *(its own `Clear All`)* |

Three scenarios were `@known-issue` for asserting the AC's single wording — and a
`Clear all filters` CTA on states that deliberately do not offer one — against a build behaving
deliberately. They now assert the build; the AC divergence is recorded in the doc and in TFF-383.
Consequences worth keeping:

- **Every empty-state step RE-READS the page.** They used to reuse a cached snapshot, which the
  filter scenario would defeat: it asserts one wording, adds a search, and asserts a second, and a
  cached read would pass the second no matter what the app did.
- **`the empty state should read exactly "…"`** is what turns the listing's *absent* body line into
  an assertion. An `includes` check would go on passing if a sub-line were added later.
- **`readEmptyState()` excludes anything inside a popover, and `readFilterPopoverEmptyState()` is
  scoped to it.** While a Majors search matches nothing there are two "No results found" on screen,
  and the popover's is the smaller — it would win the innermost-first sort and be reported as the
  member list's own state.
- **TFF-337's spacing is measured GEOMETRICALLY** — the gap to the nearest rendered element above and
  below. The old reader took the host's own `padding + margin` and answered `64px` or `-40px` for the
  *same* visual state depending on which block won the sort. `spacingBelow` is `null` when the
  message is last on the page; that is not a missing gap and is not asserted as one.
- **`I apply a filter combination that no member satisfies` chooses its value instead of guessing.**
  It used to apply the first Grad Year and the last Major on the reasoning that opposite ends of two
  lists would not intersect; live that still left one member, so the step went `pending` and the
  empty state was never reached. It now reads the majors the listed members hold, applies one nobody
  holds, verifies the list is empty, and undoes it if not — reporting every value it tried.

### Searching the member list by Major is NOT a feature — the scenario was deleted, not tagged (2026-08-03)

The PO confirmed the member search matches the candidate **name only**, consistent with TFF-330 being
dropped. So AC 6.2 / AC 5.2 are wrong rather than unimplemented, and
`Verify that members can be found by searching for a Major…` was **removed** from the feature file
along with four step definitions (`I have noted the major of the first member`,
`I search the members for that major`, `that member should be listed`,
`every listed candidate card should show that major`). A scenario asserting a feature nobody intends
to build is permanently red against an AC that will never land — the same test the unlimited-usage
promo scenario failed. **Do not reinstate it, and do not add Major to the name-search table.**

What survives is one `@negative @known-issue` scenario on the **placeholder**, which still reads
`"Search by candidate name or major..."` and so asks the user for something the search cannot do:

- **It compares the placeholder against the behaviour**, rather than pinning either. Pinning the
  expected string would go red the day the copy is reworded for any other reason; pinning only the
  behaviour would say nothing about what the user was told. It goes green whichever way the product
  settles it, and only when the two agree.
- **It picks its own subject** from the member cards. It used to read `notes.member`, set by one of
  the deleted `Given`s — leaving that dependency would have made it throw on `undefined` instead of
  asserting anything.
- **Its own scenario, not a step in the name-search one.** Cucumber abandons at the first failure, so
  folding this red assertion in there would take the four name-matching rules down with it.
- The Majors **FILTER** is a different control and is untouched — filtering by major works.

### The Majors filter has its own search box, it is the only route past ten options, and it matches token-wise

- **The popover renders at most TEN options and its search results are capped at ten too** (on open:
  "AI prompter" … "Architecture", alphabetical, no growth on scroll; `Engineering` returns exactly
  ten). So searching is **the only way** to reach anything else, and the no-duplicates scenario
  necessarily covers those ten — it cannot be widened by unioning per-letter searches, because those
  are capped as well. It still finds a real duplicate pair there ("AI prompter" / "Ai prompter").
- **It filters client-side** (no member-list request), is **case-insensitive**, and matches
  **mid-word**. All asserted, all green.
- **It splits the term on whitespace and requires each token to appear anywhere in the option, in any
  order — not the term as typed.** So `AI p` offers "Supply Chain Management" (ch-**AI**-n,
  su-**P**-ply), `ing acc` offers "Accounting", and `z a` and `a z` return the identical pair.
  Reproducible 3/3 (`scripts/probe-community-majors-stray-match.js`). **Single-token terms are
  unaffected, which is why the @positive scenario derives its term from a single WORD** — using a
  four-character slice of a multi-word option would make that scenario red for this second reason.
- **Two scenarios, not one, and deliberately so.** The working behaviour is `@positive` and green;
  the token matching is `@negative @known-issue` and red. Merging them would let the red half take
  the green assertions down with it, which is this module's own stated rule. **No AC covers this
  search box — ask the PO whether token-wise matching is intended before filing.**
- **`selectFilterOptionByText()` picks by exact text via the index `resolveFilterPopover()` produces**,
  never a `filter({hasText})` — that is a substring match, so "Law" would select "Business Law".

### Choosing a subject, and what the member counts mean

- **The listing card's member count cannot be trusted to pick a fixture.** Card and header disagree — live: "Al Asala College" reads 6 on its card, 10 in its header, with 6 member cards listed; "Arid Universit" reads 43 / 63 / 7. That disagreement is its own `@known-issue` scenario, so *other* scenarios must not be built on either number. `I have found a community with no members` now opens each 0-member candidate and confirms header **and** member cards are empty, reporting the rejects.
- **`filterLabel()` maps each story's naming onto what the app renders.** The feature files say "Graduation Year"/"Member Type" (superadmin) and "Grad Year"/"Members" (candidate); the app renders `Grad Years`, `Majors`, `Members` on both. `CommunityPage.FILTER_TRIGGER_LABELS` holds the rendered set, beside the reader scoped to it.
- **`I apply each of the following filters on its own:` deliberately leaves the LAST row applied.** Clearing between rows is what makes each row "on its own" (TFF-281: Clear All did not appear when only one filter was applied); clearing after the final one left nothing on screen for the scenario's own `When I click "Clear All"`, which then timed out waiting for a control that had already done its job.

### The exact-10 MB boundary was never an app defect — it was a missing fixture (2026-08-03)

`Verify that an image of exactly 10 MB is accepted` failed, and the suite recorded that as the app
wrongly rejecting its own documented maximum. **The app accepts it on both fields.** The table asks
for `Cover Photo | JPG | 10` and `Profile Photo | PNG | 10`; `Exact10MB.jpg` existed but **no PNG was
registered at 10 MB**, so the profile row fell through `imageFixtures.js`'s generated path and sent a
**1×1 image** — the one fixture class the note at the top of that file says must never reach a form
that crops every upload. Measured live: 10,485,760 bytes on both fields opens the crop modal,
confirms and leaves a preview with no error, while 11 MB is refused as a control in the same run.

- `Exact10MB.png` is a **real photograph padded with one tEXt chunk** to the exact byte count, built
  by `scripts/make-exact-10mb-png.js`. Re-run that script if the source photograph is replaced.
- **`Then each upload should have sent exactly 10485760 bytes` runs FIRST in that scenario.** A
  boundary scenario that did not send the boundary proves nothing however green the rest goes, and
  `exactBytes` in `imageFixtures.js` cannot guard a size with no fixture registered at all — which is
  precisely how this happened. The step closes the hole from the other end.
- The upload attachment now reports `pickerFailure` and `cropImageReady` per row, because "the app
  refused this file" and "the suite never managed to send it" were indistinguishable in the report and
  that cost this scenario's whole diagnosis.
- **`clearing any required field shows its exact inline error` is no longer `@known-issue`** either:
  all four messages are inline and verbatim per AC 11 (measured). Note the same AC 11 table's IMAGE
  rules are **toasts with different wording, and that was accepted as intended on 2026-08-10** — so
  the build is inconsistent with itself, the two scenarios assert different surfaces, and **both pass**.
  Do not reconcile them with each other; AC 11 is what needs splitting.

### SuperAdmin coverage pass of 2026-11-02 (`Community-Listing-And-Page-Values.feature`)

25 read-only scenarios (`@community-pages`, in the default run and in `test:community` /
`test:community-admin`), steps `steps/community-pages.js`, probe
`node scripts/probe-community-superadmin-gaps.js [--only listing|community|create|errors]` (read-only).
Every value is compared with the response the app received.
- **Listing:** `GET /community/?page=&page_size=12[&search=]` (145 communities, 13 pages). Cards
  match the server in its order (names sort case-sensitively: "BUKC" before "Bahria"). A page
  already fetched re-renders with no request; a whitespace-only search sends nothing. Page and
  search are NOT in the URL - a reload returns to page 1 (`@needs-clarification`). The card's
  university name button does nothing. Tab order: search -> Create -> Edit -> View Community.
  A failed/offline list load reads "Something went wrong.". "1 Members" is recorded for the PO.
- **Community page:** `GET /community/<id>/` (`member_count`, `location`, `description`) and
  `/community/<id>/candidates/?page=&page_size=12` with `search=`, `grad_year=<year>`,
  `major=<field of study id>`, `qualification=STUDENT|ALUMNI` (they combine). Search and filters
  are NOT in the URL. Header, name/major/track buttons do nothing. View Profile ->
  `/profile/<public_id>`; Back -> `/community`; Edit Community -> `/community/edit/<id>`.
  `/community/view/<unknown|abc>` -> "404 Page not found". A member-list 500 is not shown as
  "No members yet". A community can have a NULL location.
- **Two `@known-issue`:** `/community/edit/<unknown id>` renders an empty Edit form with Save; a 500
  on `GET /community/<id>/` is shown as "404 Page not found".
- **Removed 2026-11-03 on request:** the scenario asserting each member filter control is a named
  button. The finding is real and NOT asserted any more: "Majors" is a `<div tabindex=0>` with no
  button role (Grad Years and Members are buttons), so a screen reader does not announce it as a control.
- **Create/Edit leave by an "Exit" link** (`admin-community-form-exit-button`) with no confirmation.

**>>> DEV HAS NO UNIVERSITY LEFT WITHOUT A COMMUNITY (measured 2026-11-02). <<<**
`GET /institutions/?unassigned=true` answers `count: 0`, and the University dropdown shows a single
`role="option"` reading "No institutions available for assignment." Consequences:
- **`npm run test:community-create` cannot pass** until a university is added on DEV.
- Every scenario that FILLS the Create form was failing before reaching its rule. A `Before` hook in
  `steps/community-pages.js` (all `@community-admin` scenarios except `@creates-community` and
  `@real-universities`) now answers that request with two REAL universities taken from the listing
  ONLY while the server has none, says so in the report, and ABORTS every POST to the community
  API so a stand-in can never be saved. The university-exclusion scenario was split out as
  `@real-universities` and accepts the honest "No institutions available" state.
- The create-failure scenario was re-enabled; its stub now catches every community POST.

**Audit of 2026-11-03 (every control on `/community`, `/community/view/<id>`, `/community/create`,
`/community/edit/<id>` inventoried and mapped to a scenario).** Measured full run of `-p community`:
86 scenarios, 73 passed / 13 failed - 5 superadmin reds (3 `@known-issue` + 2 suite defects, both
fixed) and 8 candidate-side reds (`features/Candidate_Portal/Community.feature`, not in this audit).
- **Edit form's stored images had no coverage** - added two read-only scenarios (values file,
  "EDIT: THE STORED IMAGES"): removing the stored cover and logo re-offers both uploads, gates Save,
  writes nothing and a reload restores them; and the logo removed from the keyboard. The logo's
  "Remove photo" is hover-revealed for a mouse; Enter on `admin-community-form-logo-actions-button`
  ("Show photo options", aria-expanded) reveals it, Tab reaches it, Enter removes. Not a defect.
- **Suite defect 1:** the "No institutions available for assignment." `role="option"` is now a
  0x0 wrapper (its child div has the size), so `CommunityFormPage.readOptions()` dropped it and the
  `@real-universities` scenario said the dropdown "offered nothing and did not say why". Fixed.
- **Suite defect 2:** member filter options changed markup - Grad Years / Members nest an empty
  inner `<label>` inside a text-bearing outer one, Majors wraps the checkbox in a
  `<button data-testid="...-option-checkbox">`. The filter step read `ancestor::label[1]` (empty)
  and then hung on Majors; it now takes the nearest text-bearing label or button.
- With these, the superadmin side's only reds are its `@known-issue` scenarios (2 since the named-button one was removed).

**Suite defects fixed the same day:** the cover crop dialog is now headed "Adjust Cover Photo"
(the logo's still "Upload community profile photo."), so `CommunityFormPage.cropModal` matched
nothing and every cover upload read as refused (7 scenarios); it now keys on the crop test ids.
Both former `@known-issue` scenarios (member placeholder, access table) PASS and are regression locks.

### Known app defects this module is designed to surface

`@known-issue` scenarios fail on purpose and are part of the default run. Beyond the empty-state wording disputes recorded in the feature files:

- **The public profile omits the Major the candidate card displays.** Its Education line renders `Arid Universit , Expected Graduation: 2032` — the stray comma marks an empty field. Name and graduation year appear; the Major never does. Asserted from **both** roles because the profile is rendered per role.
  - **The privacy steps are ordered BEFORE the content check, and that is load-bearing.** Cucumber abandons at the first failure, so with the content check first this cosmetic defect silently cost the two assertions that actually matter on a public surface — email and phone leakage. Same rule as the receipt-PDF currency step. The candidate **end-to-end** journey drops the Major assertion entirely, so a known defect cannot take down the return-loop coverage nothing else provides.
- **An agent reaches `/community`** where the access-control table expects denial. Left asserting the written AC, but `checkAccess()` now also records **which management controls were exposed** on every row — "an agent can browse the directory" and "an agent can create/edit communities" are very different findings and the old message could not tell them apart. **Ask the PO which is intended before changing the expectation.**

## Candidate onboarding end to end (`features/Agent_Portal/candidate_onboarding_e2e.feature`)

The agent-invites-a-candidate journey across BOTH portals: the agent sends the invitation and
watches the status progress, and the candidate reads the mail, signs up from its account-setup
link, verifies, and completes onboarding. Implemented 2026-08-27; before that the file was Gherkin
with **47 of 68 steps undefined**, so every scenario reported `undefined` — which is why running it
"failed everything".

- **`npm run test:candidate-e2e`** (`-p candidateE2E`) — 6 scenarios. Needs network + the IMAP
  inbox, must run **serially**, no payments.
- Steps live in **`steps/invite-candidate.js`** (PART 3); the invite /
  setup-link / token machinery is **`utils/candidateInviteProvision.js`**.
- 8 scenarios / 79 steps under `-p candidateE2E` (6 run; 2 are `@not-automatable`).

### >>> `@candidate-e2e` IS EXCLUDED FROM THE DEFAULT RUN, AND THAT WAS A DELIBERATE CHANGE <<<

**A CANDIDATE CANNOT BE DELETED.** Every scenario here either sends a real invitation or creates a
real candidate account, so a default run would add ~5 permanent rows to the shared agent's list
every time. That is exactly what the `inProgress` profile already refuses to do ("an invited
candidate CANNOT BE DELETED, so a routine run must not add permanent rows"), so
`not @candidate-e2e` was added to the default profile's tag expression alongside
`@creates-community` and `@doc-verification` — the other two unrecoverable-resource exclusions.

Note the neighbouring `@provision` scenarios stay IN the default run: what they create is a
candidate the suite needs anyway, whereas these create candidates purely to watch them progress.

### The flow, measured — and four things the Gherkin had wrong

```
agent:     Candidates > Invite Candidate > Invite via Email > <address> + Enter > Send Invites
           -> POST /core/api/v1/agent/invite/candidate/bulk/ -> 200 {"detail":"Emails sent successfully"}
           -> modal "Invitations sent!"  (its two CTAs depend on where you invited from - below)
inbox:     "Join Talentforge"  -> CTA -> SendGrid /ls/click -> 302 -> /signup?token=<payload>:<ts>:<sig>
candidate: /signup with email AND agent code pre-filled and DISABLED
           -> Create Account -> /email-verification "Check Your Inbox!"
           -> "Verify your Talentforge account" -> /verify-email?uid=&token=
           -> "Email verified successfully!" -> log in -> /onboarding (Step 1 of 6)
```

The feature file described a different product in three places, and was half-right in a fourth. All were corrected to what the
build does, and the divergences recorded here rather than asserted — the same call the community
module made on its empty-state wordings:

| The Gherkin said | Measured |
| --- | --- |
| "the candidate verifies the emailed **OTP**" | **There is no OTP anywhere.** Verification is a link; after Create Account the page shows "Check Your Inbox!" with **zero** otp-shaped inputs. |
| Status Detail "Awaiting **Sign-up**" | **"Awaiting Signup"** — no hyphen |
| Status Detail "**Profile Incomplete**" | **"Profile Incomplete, Test Pending"** — one combined string |
| a "**Go to In Progress**" button | right for the DASHBOARD path, wrong from `/candidates` - the pair is context-sensitive, see below |

**Ask the PO whether the OTP in the AC was ever intended** — a whole verification mechanism is
either unbuilt or was dropped, and that is a bigger question than a wording nit.

### >>> THE CANDIDATE INVITATION SHARES THE AGENT INVITATION'S EXACT SUBJECT <<<

Both are sent as **"Join Talentforge"**. IMAP subject search is a case-insensitive SUBSTRING match,
so searching the subject alone returns both kinds of mail — and the bodies are nothing alike (the
agent's hands over a temporary password, the candidate's carries a "Set up my account" link), so an
extractor run against the wrong one returns `null`, which reads as **"the mail never arrived"**.
That is precisely how a first sweep of the inbox "proved" the candidate invitation was never sent.

- **The RECIPIENT is the only disambiguator.** `waitForCandidateInvite()` refuses to search without
  an address, and the `candidateInvite` entry in `emailTypes.js` documents the collision. Do not
  "fix" this by inventing a distinct subject: the app really does send one string.
- **Invitees are addressed on the BYTECORP mailbox, never anonaddy.** anonaddy STRIPS the `+alias`
  on delivery, so every invited candidate would arrive at one base address — and with the subject
  shared there would be nothing left to match on at all. bytecorp preserves the `+tag`.

### The invitation token is a readable, signed JSON blob

`/signup?token=` carries Django's signing format — `base64url(JSON) : timestamp : HMAC` — whose
payload decodes to `{"code":"<agent code>","email":"<invited address>"}`. That is how the form knows
what to pre-fill. Two uses:

- **The expected pre-filled values are read FROM the token**, so the assertion compares the form
  against what the invitation actually carried rather than against something the step remembered.
  The agent-code check goes further and reads the code off the **Share Agent Code modal in the
  agent's own session**, because comparing the form to the token would only prove the form echoes
  what it was given.
- **Tampering is precise.** `tamperInviteToken()` flips one character of the PAYLOAD, leaving the
  URL and signature structurally intact, so the HMAC no longer authenticates the contents. Mangling
  the whole URL would test 404 handling instead. Live: the tampered token is **rejected** — the form
  does not arrive pre-filled.
- **"Rejected" is asserted as the OUTCOME, not as an error string.** The rule is that a tampered
  token must not hand over a usable pre-filled invitation; the wording the app renders has never
  been measured and is attached instead, so the step cannot go green on a synonym while a real
  bypass slips past.

### Isolation is measured BEFORE the navigation, not after

`the page should not depend on the original browser session` first failed reporting that the
isolated context "already carried cookies". It had not: **the page sets `g_state` itself on every
load**, from the Google Identity button behind "Sign up with Google". A post-navigation cookie read
cannot tell a cookie carried IN from one the page SET.

So `openSetupIn()` snapshots cookies before navigating (must be empty) and afterwards objects only
to an **app session** cookie (`refresh_token` and friends) — whose absence, on a page that rendered
a correctly pre-filled form, is the real evidence that the invitation travels entirely in its token.

### Completing onboarding is not the same as skipping it

`OnboardingPage.completeAllSteps()` was added beside the existing `skipAllSteps()`. They are not
interchangeable: **skipping also leaves the wizard**, but at 0% completion, and the agent's list
still reports `Profile Incomplete, Test Pending` then. Only a completed profile moves that to
**`Test Pending`** alone, which is the transition scenario 2 asserts. Every filler is called with
the defaults it already had for `onboarding.steps.js`, so this adds no new test data.

### The In Progress row is found by SEARCHING, never by scanning a page

The shared agent's In Progress list runs to **34 pages**, so a candidate invited seconds ago is not
on page 1 and reading the rendered rows would report it "not listed" — the same trap the
document-verification queue step was caught by. `findCandidateRow()` searches by the full email
address, which is exact because the addresses are unique per run. Status and Status Detail are
**polled**, because both are written server-side and can trail the candidate's own action.

### What cannot be automated, and why it is not faked

**The psychometric assessment.** Measured 2026-08-27: "Take the Test" on `/getting-started` opens
`/test`, a **timed** test in two sections — an **adaptive "AI Interview"** (5 min) and 15 MCQs
(15 min) — whose own instructions state the timer cannot be paused. Completing an adaptive AI
interview is not something a suite can do honestly, and answering 15 MCQs against a live model
would assert nothing about the agent portal. So the transition to **Active** is left unautomated:
its own `@not-automatable` scenario, with steps that resolve to `pending` rather than being left
undefined, so a targeted run reports them honestly instead of as a missing implementation.

**If dev can expose a way to mark the assessment complete on a test account, this becomes
automatable and section 2 can be extended to it.** Note `/assessment` and `/psychometric` both
render an empty body and are not routes; every other candidate path redirects to `/onboarding`
until the wizard is left.

### Section 4 was split into one scenario per rule

It was a single scenario carrying three `Given`/`When`/`Then` triples. Cucumber abandons a scenario
at its first failure, so the first broken rule hid the other two — and the mid-scenario `Given`s
read as if the earlier assertions still held. The `.edu`-address rule was dropped rather than
split: nothing measured says the app enforces it, and the suite's own fixtures sign up on
`bytecorp.io` and `anonaddy.com` addresses perfectly well, so a scenario asserting it would be red
against a rule the product does not appear to have. **Confirm with the PO before reinstating it.**

**The AC's exact error strings are NOT asserted.** `a signup error should be displayed` fails only
when no error appears at all, and attaches the wording it found beside the three strings the AC
quotes. Pinning an unmeasured string would go red on a nit and — first failure wins — cost the
"no account was created" assertion after it, which is the one that matters. Tighten it once the
strings are confirmed. `no candidate account should be created` proves the negative by **attempting
to sign in** with the refused credentials in a fresh context, chosen over waiting three minutes for
a verification mail that should never come.

### The success modal's two CTAs depend on where the invitation was sent from

Measured 2026-08-27: it offers "stay here" plus "go to the other place", so the pair is not fixed.

| Invited from | CTAs |
| --- | --- |
| `/dashboard` (the welcome modal) | **Stay on Dashboard** / **Go to In Progress** |
| `/candidates/in-progress` | **Stay on In Progress** / **Go to Dashboard** |

A run that hardcodes the wrong pair times out on a modal that is on screen and working - which is
exactly how the first full run failed. The step attaches the CTAs it found, so a future change says
which pair arrived.

### An already-registered address is refused at INVITE time, not at signup

The AC has this refused when the candidate opens their setup link. The app refuses earlier and
better: **`POST .../agent/invite/candidate/bulk/` answers 422** with
`{"emails":{"<addr>":"This user already has an active account."}}`, and the agent is shown exactly
that sentence - so no setup link is ever issued and there is nothing to sign up with. The scenario
asserts the refusal where it actually happens, and is `@needs-clarification` to get the AC updated;
it is not a defect. The AC's wording ("An account with this email already exists.") differs from the
app's and is attached rather than asserted.

`sendCandidateInvite()` therefore takes **`allowRefusal`**: without it a 4xx throws, because every
other caller wants a refused invitation to fail loudly rather than carry on with nothing sent.

### >>> A SHARED FIXTURE WAS SPENT WHILE BUILDING THIS, AND THE GUARD THAT SHOULD HAVE STOPPED IT DID NOT <<<

On 2026-08-27 the first full run of this feature sent a real invitation as
**`REFERRAL_NOPROMO_AGENT`**. A candidate cannot be deleted, so its count went to 1 permanently: the
first-time welcome modal stopped rendering for it and the In Progress empty state lost its fixture.
Recorded here in full because the failure mode is subtle and worth not repeating.

**Two independent faults combined:**

1. **`newlyOnboardedAgent()` decides whether to provision a throwaway by reading the scenario's
   tags** - and those tags were recorded by a `Before` hook scoped to `@welcome-onboarding`. This
   feature is tagged `@candidate-e2e`, so the hook never ran, the tag list read as empty, and a
   `@provision` scenario silently fell back to the SHARED fixture.
2. **`inviteFixtureGuard()` was not on the path that scenario took.** It sends through the modal
   ("I add a new candidate email..." then "I click Send Invites"); the guard sat on a different step
   entirely.

**What changed, so neither can recur:**

- The guard is now **POSITIVE and identity-based**: it names the agents that may be invited as
  (a throwaway this scenario minted, or `AGENT_EMAIL`, whose 50+ candidates are not a fixture) and
  refuses everything else **regardless of tags, hooks, or which step is calling**. It is wired into
  every candidate-creating call site, the modal path included.
- The `Before` hook covers `@welcome-onboarding or @candidate-e2e`. The guard no longer depends on
  it, but a missing hook would still stop a `@provision` scenario provisioning.
- **The zero-candidate property has its own dedicated account.** `NO_CANDIDATE_AGENT_*` in `.env`,
  minted and verified by **`node scripts/provision-no-candidate-agent.js`** (it asserts
  `Total Candidates: 0` and that the welcome modal renders before printing the block). Both the In
  Progress empty state and `WELCOME_AGENT_*` now default to it.
- **`REFERRAL_NOPROMO_AGENT` keeps only the property it exists for** - having no PROMO CODE, for
  TFF-43 §10. Nothing there can be spent by a candidate, so the promo module was never affected.
  **Do not borrow it for a zero-candidate fixture again.**

Repair verified: the In Progress empty state passes 8/8, and
`npm run test:welcome-onboarding` is back to its 8 passed / 3 `@known-issue` baseline.

### Expected baseline (measured 2026-08-27)

`npm run test:candidate-e2e` - **6 scenarios, 6 passed / 0 failed, 7m 01s.** A green run here is
genuinely all-green: unlike the neighbouring welcome feature, nothing in this file is
`@known-issue`.

| Scenario | Time |
| --- | --- |
| First-time agent invites a candidate end to end from the welcome modal | 92s |
| An invited candidate signs up and reaches Test Pending | 111s |
| The setup link is portable across sessions but rejects a tampered token | 101s |
| A candidate onboards using a shared agent code | 44s |
| Signup is refused for an unrecognised agent code | 28s |
| Inviting an address that already has an account is refused | 16s |

**What one run costs:** 1 throwaway agent (live superadmin invite + IMAP), ~4 permanent candidate
accounts and invitations on `AGENT_EMAIL`, and one refused invitation. No payments. The 2
`@not-automatable` scenarios are excluded and resolve to `pending` if named directly.

## Bulk candidate invitation (`features/Agent_Portal/invite-candidate-bulk_upload.feature`)

The CSV/XLS/XLSX upload zone inside the **Invite via Email** modal - its instructions, its
template link, its validation, and what sending an uploaded file actually does (TFF-36, TFF-87,
TFF-88, TFF-314, TFF-410). Implemented 2026-08-27; before that all 9 scenarios were Gherkin with
every step undefined.

- **`npm run test:bulk-upload`** (`-p bulkUpload`) - 14 scenarios. Needs network + the IMAP
  inbox, must run **serially**, no payments.
- **`npm run test:bulk-upload:read-only`** (`-p bulkUploadReadOnly`) - the 4 scenarios that create
  NOTHING: the zone's contract, the accept/reject table, the size boundary, the format list. Every
  file is chosen and removed again and no send ever happens, so this is the cut to run while
  iterating on a locator. ~1m10s.
- Steps live in **`steps/invite-candidate.js`** (PART 4) - see that
  file's header for why the whole Agent-Portal candidate area shares one step file. The page
  object is `CandidateOnboardingPage` (the bulk zone is part of the invite modal, not a separate
  screen); the fixtures are **`utils/bulkCandidateFile.js`**.
- **14 scenarios / 162 steps under `-p bulkUpload`, 0 undefined, 0 ambiguous** (measured
  2026-09-16 with `--dry-run`; was 9 / 105 before the five upload-condition scenarios). The
  commented-out `@not-automatable` large-file scenario is still commented out, so nothing is
  excluded from this profile.

### >>> `@bulk-upload` IS EXCLUDED FROM THE DEFAULT RUN <<<

Four of the nine scenarios send real invitations, and **a candidate CANNOT BE DELETED** - a
default run would add ~5 permanent rows to the shared agent every time. `not @bulk-upload` was
added to the default profile's tag expression alongside `not @candidate-e2e`,
`not @creates-community` and `not @doc-verification`, the other unrecoverable-resource exclusions.

**Everything here runs as `AGENT_EMAIL`**, pinned by a `Before` hook rather than left to whichever
Given happens to run first. That account already holds 50+ candidates, so its count is not a
fixture; inviting as the zero-candidate agent would destroy the welcome-modal coverage AND the
promo module's read-only Case 4 fixture in one step, which is exactly what happened on 2026-08-27.
`inviteFixtureGuard()` is the backstop.

- **The hook also SIGNS IN, before any step runs.** Section 3 opens with the shared step
  `Given I am on the Agent Dashboard` (referral-codes.steps.js), which navigates to /dashboard and
  waits for the Referral Codes heading - unauthenticated that bounces to /login and the step spends
  its whole 60s budget on a heading that cannot arrive. The first full run failed exactly there,
  reporting a timeout that said nothing about the missing session. Signing in up front costs
  nothing net: every scenario signs in anyway, just later.
- **The chooser is opened from `/candidates`, never `/dashboard`.** The dashboard route into the
  onboarding chooser is the welcome modal's button, which exists only for a zero-candidate agent -
  so a bulk scenario opened from the dashboard waits out its timeout on a modal that is never
  coming. `wnotes().agentOverride` carries both the account and the entry point, and
  `openChooser()` reads it, so the shared `Given the "<x>" modal is open` step needed no
  bulk-specific branch.

### The zone, measured (2026-08-27)

Three probes did the measuring and **none of them sends an invitation**:
`scripts/probe-bulk-upload-modal.js` (structure + the template file),
`scripts/probe-bulk-upload-states.js` (what each class of file leaves behind),
`scripts/probe-bulk-upload-formats.js` (accept/reject table, drag-and-drop, the 422 surface).

| | |
| --- | --- |
| container | `[data-testid="agent-invite-csv-dropzone"]`, inside the invite modal |
| drop target | `[data-dropzone="true"]` - handles dragenter/dragover/drop |
| file input | `input.peer.sr-only[accept=".csv,.xlsx,.xls"]`, **single** file |
| upload button | `[data-testid="agent-invite-csv-upload-button"]` ("Click to upload") |
| template | `<a download href="/invite-candidates-template.csv">` - a **link**, not a button |
| template contents | `emails` header + 2 sample rows, 64 bytes |
| hint | `CSV, XLS, XLSX (max. 10MB)` |
| remove | `button[aria-label="Delete"]` on the file card |
| send endpoint | `POST /core/api/v1/agent/invite/candidate/bulk/file/` (multipart) |

**FIVE MEASUREMENTS SHAPE EVERY STEP. Read them before changing anything here.**

1. **THE CHIP INPUT AND THE FILE UPLOAD ARE MUTUALLY EXCLUSIVE, BY DESIGN.** With both present the
   modal renders `"You can only use one option at a time. Remove the emails or the uploaded file."`
   and **disables** Send Invites. See the dedupe scenario below.
2. **VALIDATION IS BY EXTENSION ONLY, CLIENT-SIDE.** `.csv`/`.xls`/`.xlsx` are accepted whatever
   they contain; `.pdf`/`.txt`/`.docx`/`.png`/`.json`/`.zip`/`.exe` are refused on the extension.
   So a CSV with no rows, a CSV of entirely malformed addresses and a CSV of binary rubbish are
   **all accepted by the form**.
3. **THE APP'S TWO REJECTION MESSAGES ARE NOT THE ONES THE AC QUOTES.** Both steps therefore assert
   the REJECTION first and the WORDING second, collecting both and throwing once - so a red row
   says "it was refused, with different words" rather than the far more alarming "it was not
   refused at all". A locator built from the AC's strings could only ever answer "absent" and would
   report a working rejection as a missing one.
   | | AC | app |
   | --- | --- | --- |
   | type | `Invalid file type. Only CSV or XLSX allowed.` | `This file type is not allowed. Use one of the accepted formats listed below.` |
   | size | `File exceeds 10MB limit. Please upload a smaller file.` | `This file is too large. Maximum size is 10.0 MB.` |
4. **THE ZONE ANIMATES A FAKE PROGRESS BAR FOR ~2s AND FIRES NO REQUEST WHILE IT RUNS**, during
   which Send Invites stays **disabled** (`good.csv | 62% - 2 seconds remaining` -> `good.csv | 0.0 MB`).
   Every read goes through `waitForUploadSettled()`; a read taken straight after `setInputFiles()`
   reports a working upload as refused. Same failure as the candidate-profile document upload that
   saved entries with `document: null`.
5. **THE SEND ENDPOINT IS DIFFERENT FROM THE CHIP PATH'S** (`.../bulk/file/` vs `.../bulk/`). It
   answers `200 {"detail":"Emails sent successfully"}` for a header-only file **and** for a file
   whose every address is malformed, and `422 {"non_field_errors":["Uploaded .csv file is not a
   plain-text CSV."]}` for content that is not really CSV. **The 422's toast says something else
   entirely** - `"One or multiple emails from file already exists."` - so the agent is told the
   wrong reason. Recorded by the steps rather than asserted; no AC covers it.

### The dedupe scenario asks for something the app refuses

`Duplicates inside the file and across the chips collapse to unique recipients` supplies a typed
chip AND an uploaded file, which is precisely the combination measurement 1 forbids. It is left
asserting the AC and tagged `@known-issue @needs-clarification`: whether the two input methods are
meant to be combinable is a product question, not a defect the suite should hide by rewriting the
scenario. **`I click "Send Invites"` has a guarded branch in `common.steps.js`** that reads the
exclusion notice and fails naming it - without it a bare click on the disabled button waits out its
full timeout and reports `element is not enabled`, which says nothing about why.

### The five upload-CONDITION scenarios (added 2026-09-16)

Coverage of the upload path was about the FILE - its extension, its size, its rows. Nothing
covered the ZONE as a control: what it offers while it is holding something, whether a dismissal
releases it, or whether the rules it prints in its own UI are applied. Five scenarios, **every one
measured live through the real modal before it was written**, and **none of them sends** - so all
five are in the read-only cut and none can create a candidate.

- **>>> THE ZONE IS WITHDRAWN WHOLE WHILE A FILE IS HELD. <<<** The drop target, the "Click to
  upload" button AND the `<input type="file">` are all removed from the DOM, so there is no
  control that can choose a second file until the first is deleted. `CandidateOnboardingPage`
  already documented this on `csvFileInput` - it had simply never been ASSERTED, so a regression
  that left the input behind (and let two files be chosen on a single-file upload) would have gone
  unnoticed. Note the accept/replace scenario is *titled* "replaced or removed" but only ever
  removes FIRST, so the in-place replacement it claims was never exercised; the new scenario
  removes, re-uploads and asserts the card shows the SECOND file's name.
- **>>> THE MODAL STATES A RULE IT DOES NOT ENFORCE, AND THAT IS THE ONE NEW RED. <<<**
  "Do not change the column headers." is printed in the zone's own Upload Instructions and the
  template it serves is a single column headed `emails` (64 bytes, re-fetched live). Measured: a
  renamed header (`email_address`), **no header row at all**, and extra columns are all ACCEPTED
  with Send Invites **ENABLED** and no error anywhere - because validation is by EXTENSION only.
  - **The scenario asserts the RULE, not the measurement**: a file whose structure breaks the
    stated instruction must not be taken *in silence* - refuse it, or say something. Writing down
    "all three are accepted" would lock the defect in and the scenario could never go green;
    writing "each must be refused" would be red even if the product chose to report it some other
    way. It goes green whichever way the PO settles it, and only once the instruction and the
    behaviour agree. Same treatment as the search-placeholder scenarios.
  - It reads the header off **the template the app itself serves**, not off a string repeated from
    a ticket, so the rule it holds the build to is the build's own.
  - **Question for the PO:** should the form check the header, or should the instruction stop
    claiming a rule the form does not apply?
- **The mutual-exclusion rule is now covered in BOTH directions, plus its recovery.** The existing
  scenario types the chip FIRST; measured, the email input stays **enabled** while a file is held,
  so the conflicting state is genuinely reachable file-first too - and it raises the same notice
  with Send disabled. The recovery had no coverage at all: removing the chips clears the notice,
  re-enables Send and **leaves the file held**. A build that dropped the upload while resolving the
  conflict would send the agent back to the file picker with nothing explaining why.
- **Dismissing the modal discards the uploaded file**, asserted on both documented routes (Cancel
  button and X icon). The chip half of this is covered in `Invite-candidate.feature`; the file was
  not. A file surviving a dismissal would be sent by whoever opened the modal next believing it
  empty. **Note the parameter is `"Cancel button"`, not `"Cancel"`** - `dismissInviteBy()` knows
  three names (`X icon`, `Cancel button`, `clicking outside`) and throws on anything else.
- **The bulk path now has failure coverage.** It had none, while the chip path has three - and the
  two post to DIFFERENT endpoints (`.../bulk/file/`, multipart, against `.../bulk/`). It needed no
  new machinery: `stubInvite()` routes `**/invite/candidate/**`, which matches both. The request is
  intercepted, so nothing is really sent and no candidate is created.

**Measured baseline for the read-only cut, 2026-09-16: `npm run test:bulk-upload:read-only` -
10 scenarios, 8 passed / 2 failed, 125 steps, 3m 50s** (headless). Both reds are `@known-issue`:
the pre-existing "unusable files are accepted client-side" one, and the new header-instruction one.
Four of the five new scenarios pass.

### Fixtures are BUILT PER RUN, and the boundary one verifies itself

`utils/bulkCandidateFile.js`. Nothing is committed, for three reasons and the third is
the one that matters:

1. The boundary scenario needs **exactly 10,485,760 bytes** plus neighbours at 10.1MB and 11MB.
   `writeSized()` **verifies its own output byte count and throws** rather than returning a near
   miss - the exact-10MB PNG lesson, where a fixture that was not at the boundary was reported for
   a week as an app defect. `Then the file should be accepted` would otherwise pass on a file that
   never tested the limit.
2. Recipients must be **unique per run** - a committed CSV of fixed addresses would have real
   accounts after its first run, so every later run would exercise the already-registered path.
3. The dedupe and mixed-rows fixtures are about the RELATIONSHIP between rows, and generating them
   keeps that relationship in the step's own evidence: a red row reads "3 valid + 2 malformed"
   instead of sending the reader to open a file.
4. The STRUCTURE variants (added 2026-09-16, `structureVariantFile()`) carry **real fresh
   addresses** on purpose. A structure fixture whose rows were junk would be refused for its
   CONTENT, and the scenario could no longer attribute a refusal to the SHAPE of the file - every
   row in them would be perfectly invitable if the header were right.

- **`.xlsx` is a REAL workbook** - a stored-entry zip written by hand (no dependency), so an xlsx
  row in the accept table is not quietly a renamed CSV. **`.xls` is CSV content under a `.xls`
  extension and says so in its metadata**: the app checks the extension, and nothing in the suite
  sends an `.xls` to the server, so a BIFF8 writer would be machinery for nothing.
- **The mixed fixture INTERLEAVES its bad rows.** A parser that stops at the first bad row and one
  that skips bad rows behave identically on a file whose bad rows are all at the end.
- The unsupported-extension fixtures carry **plausible content for their extension** (a real PDF
  header, real PNG magic bytes), so a rejection is attributable to the extension rather than to
  unreadable bytes.

### Two suite defects the first live run exposed, both fixed

Both were a reader resolving somewhere nobody intended - the class this file already records five
of for the community module.

- **`uploadedFileName()` returned `"Upload Instructions:"`.** It read `p.text-sm.font-bold` inside
  the zone, and the "Upload Instructions:" heading sits INSIDE the dropzone container and matches
  that class. So with no file uploaded it answered with the heading, and the run reported **seven
  correctly-refused files as ACCEPTED** and an oversized file as "still being held". The card is
  now derived structurally, from the one control only it has: `li` containing
  `button[aria-label="Delete"]`. **A locator that can resolve to page furniture is worse than one
  that resolves to nothing**, because the failure it produces describes a defect the app does not
  have.
- **`hasUploadedFile()` could not return false** - it returned the un-awaited Promise from
  `isVisible()`, which is always truthy.

### Assertions worth keeping as they are

- **Counts are polled for EQUALITY, never `>=`.** A candidate invited twice is as much a defect as
  one not invited at all, so `countRowsFor()` waits for the exact number - `at least one row`
  passes on the very duplication the dedupe scenario exists to catch. Same for
  `my total candidate count should have increased by 3`.
- **Rows are found by SEARCHING, never by scanning a page.** This agent's In Progress list runs to
  30+ pages, so a candidate invited seconds ago is not on page 1 - the trap the
  document-verification queue step was caught by.
- **The downloaded template is READ, not merely counted.** A download event alone would pass on any
  file at all, including an HTML error page served under the right name; the assertion is that its
  header row is `emails`, the column the upload path parses.
- **"Immediately below the upload area" is measured as GEOMETRY** - the gap between the drop
  target's bottom edge and the error's top edge. DOM order would pass on an error positioned
  anywhere on the page.
- **`the invalid rows should be reported to me` collects every surface** (zone error, modal text,
  every toast) before failing. A locator for the message we hoped to find could only answer
  "absent" and would say nothing about what the app DID show.
- **Invitation emails are waited for by RECIPIENT, never by subject.** The candidate invitation
  shares the AGENT invitation's exact subject ("Join Talentforge") and IMAP subject search is a
  case-insensitive substring match, so a subject search returns both kinds - which is why the
  invitees are on the **bytecorp** mailbox (anonaddy strips the `+alias`).

### Expected baseline (measured 2026-08-27)

**SUPERSEDED 2026-09-08 - the two WORDING reds are gone, and one suite defect was fixed.** Each
scenario below was re-measured individually; the 5/3 total is therefore DERIVED, not measured -
**run `npm run test:bulk-upload` once and replace this line with the real figure.**

Reds **1 and 2 were copy divergences, not defects**, and both now assert the BUILD's wording
(confirmed as intended), so:

- **the 10MB boundary scenario PASSES** (11/11) - it asserts
  `"This file is too large. Maximum size is 10.0 MB."` and dropped `@known-issue`. The limit was
  never in doubt: 10,485,760 bytes accepted, 10.1MB and 11MB both refused with Send disabled.
- **the unsupported-extensions scenario is STILL red, but for a completely different and genuine
  reason.** All 7 extensions are refused correctly with the build's wording; what fails now is the
  content check below it - see red 1 rewritten below. While it was red on wording, its *first*
  message step failed and everything after it was skipped, so **the three content cases had never
  once executed.**

The reds to expect now:

1. **every unusable-but-correctly-named file is ACCEPTED client-side (3 of 3)** - binary content
   under a `.csv` name, a header-only CSV, and a CSV whose every row is malformed all render a
   file card with Send Invites ENABLED. Only the binary one is refused at all, by the SERVER at
   send time (422 `"Uploaded .csv file is not a plain-text CSV."`); the other two answer
   `200 {"detail":"Emails sent successfully"}`. These three used to be consecutive When/Then pairs,
   so only the first was ever reported - they are one collecting step now and all three are named
   in a single failure.
2. ~~the chip + file combination is refused outright~~ - **NO LONGER A RED. Replaced 2026-09-09
   by two passing scenarios**, because the old one was unpassable rather than a defect: it typed a
   chip AND uploaded a file, which this build forbids, so nothing was ever sent and its two
   "exactly 1 invitation should be sent" assertions could never be true. It read like a dedupe
   defect for months; the real story is an AC-vs-build mismatch. The requirement is now covered as
   the three things that exist: **dedupe INSIDE the file** (file only, no chip - passes, 1 of 3
   duplicate rows invited), **the exclusion rule itself** (chip + file =&gt; the "only use one option
   at a time" notice and Send Invites disabled - passes, and written to go red the day the rule is
   lifted), and **dedupe across typed addresses**, which already had coverage in
   `Invite-candidate.feature`. `@needs-clarification` stays on the exclusion scenario: whether the
   two input methods SHOULD be combinable is a product question, and if the answer is yes the
   cross-input dedupe assertion should be restored.
3. **a file mixing valid and malformed rows reports NOTHING about the bad rows** - no zone error,
   no toast, nothing in the modal, and a 200 from the server. Re-confirmed 2026-09-08.

**`Sending invites from a bulk upload also raises the success modal` and `A bulk upload onboards
several candidates end to end` both PASS** (10/10 and 8/8). The first failed once in a batch run
inside its `Before` hook with `page.waitForURL: Timeout 60000ms` on the shared agent login and
passed alone immediately after - **that is the shared-login flake recorded elsewhere in this file,
not a bulk-upload failure.**

`npm run test:bulk-upload:read-only` - **4 scenarios, 2 passed / 2 failed, 1m 14s** (measured
2026-09-08; the two reds are the wording pair as it stood before this change - re-measure).

**What one full run costs:** ~5 permanent candidate accounts on `AGENT_EMAIL` and 3 invitations
read out of the live inbox. No payments. Reds 3 and 4 fail *before* their send, so they cost
nothing.

Three questions for the PO, all recorded in the feature file and attached by the steps: the two
message wordings, whether typed addresses and an uploaded file are meant to be combinable at all,
and whether per-row reporting of malformed addresses is in scope.

## Resend invite (row actions on Candidates > In Progress)

Added 2026-09-09. The Resend and Reminder History row actions, the resend confirmation, and what
confirming it actually does. **Split across two feature files on purpose** - see the warning below.

| Where | What it covers | In the default run? |
| --- | --- | --- |
| `inprogress-search_filters.feature` §0 | both actions offered per tab, Resend enabled/disabled per tab, the confirmation's contract, Cancel sending nothing | **yes** - all four are read-only |
| `Invite-candidate.feature` | confirming the resend, against a candidate the scenario invites itself | no (`@invite-candidate` is excluded) |

### >>> A RESEND EMAILS WHOEVER IS ON THAT ROW, AND THE INVITE SENT TAB IS FULL OF REAL PEOPLE <<<

Measured 2026-09-09: the shared agent's Invite Sent rows are colleagues' addresses on
`@bytecorp.io` plus `@yopmail.com`. `inprogress-search_filters.feature` is **in** the default
`npm test` run, so a scenario that confirmed a resend there would mail a stranger on every
routine run. That is the whole reason the confirm path lives in the other file, where it invites
its own candidate first. **`resendTargetGuard()` is the backstop** - POSITIVE and identity-based
like `inviteFixtureGuard()`, it refuses any address the scenario did not itself create, whatever
the tags say.

### The two icons follow DIFFERENT rules, and conflating them is the trap

Measured over the first page of each tab (10 rows each):

| tab | Resend | Reminder History |
| --- | --- | --- |
| Invite Sent | 10/10 present, **all enabled** | 10/10 present, all enabled |
| Onboarding Incomplete | 10/10 present, **all disabled** | 10/10 present, **3 ENABLED** |
| All | 10/10 present, all disabled | 10/10 present, 3 enabled |

- **Resend is decided by the row's STATUS** - live while the invitation is outstanding (Invite
  Sent / Awaiting Signup), disabled once the candidate has signed up and is merely Onboarding
  Incomplete. Sensible: there is no outstanding invitation left to resend.
- **Reminder History is decided by whether that candidate HAS reminders**, tab regardless - the
  rule `readReminderIconStates()` already documents.
- So **"both icons are disabled on Onboarding Incomplete" is true of Resend and FALSE of Reminder
  History.** Only the Resend half is asserted as a rule; the history icon's per-tab split is
  attached to the report on every run instead, because asserting the other half would be red
  against a build behaving correctly. Its real rule has its own coverage in that file's Reminder
  Status scenarios.

### The confirmation, verbatim

```
Resend Invitation
You're about to resend the invitation to:
<candidate email>
They'll receive a new email with the signup link. Any previous invite links will no longer work.
[Cancel]  [Resend Invite]      (plus an X "Close")
```

- **Opening it fires NO request**, and Cancel fires none either - both asserted by watching a
  window rather than sampling once, since "no request yet" is also true of one about to be made.
- Confirming posts **`POST /core/api/v1/agent/invite/candidate/`** - the SAME endpoint a first
  invitation uses (singular; the bulk path is `.../bulk/`) - and answers
  `200 {"detail":"Invitation resent."}` with a toast **"Invite re-sent successfully"**.
- **THE EMAIL IS VERIFIED IN THE INBOX, not just the toast.** The scenario reads the ORIGINAL
  invitation first and uses **its uid as the baseline** - without that, "a new invitation arrived"
  would pass on the mail that was already sitting there from the invite seconds earlier. Measured
  2026-09-09: original uid 24763, resent uid **24764**, subject "Join Talentforge", and the resent
  setup link resolves to `/signup?token=...` with a readable token. The resent link is asserted to
  **differ** from the original, so a resend that merely re-delivered the same invitation is caught.
- **>>> THE MODAL'S SECOND PROMISE DOES NOT HOLD. <<<** It says "Any previous invite links will no
  longer work". Measured by opening the ORIGINAL link in an isolated context after the resend: it
  **still pre-fills the setup form** with the invited address, so the previous link is still
  usable. This is RECORDED, not asserted - nothing had established the claim before, and a
  scenario asserting an unmeasured promise would go red on a guess. **Tighten it into an assertion
  once the PO confirms which behaviour is intended**, and note the security angle: an invite link
  the agent believes they have revoked still works.

### >>> THE SAME ENDPOINT REFUSES SOME INVITE SENT CANDIDATES, REPRODUCIBLY <<<

`422 {"email":["This candidate is already assigned to you."]}`, shown to the agent as that
sentence. Measured per candidate, twice each: `muhammad.awwab@bytecorp.io` refused 2/2,
`gsubz@yopmail.com` succeeded 2/2 - **on rows whose Resend icon is ENABLED**. So the app can
offer an action that cannot succeed, and the message it then shows describes the
duplicate-invite path rather than a resend failure.

- Cancel does **not** poison the next attempt (open -> Cancel -> re-open -> confirm answered 200,
  as did the X-close variant), so this is not a stale-payload bug.
- The confirm step reports the server's answer, not just the toast, and names this measurement in
  its failure message - so a red run says which of the two happened instead of "the resend
  failed". The scenario is `@needs-clarification`: **ask dev/the PO which candidates are meant to
  be resendable**, and whether a non-resendable one should have its icon disabled.

## Requires Attention (`features/Agent_Portal/require-attention.feature`)

The Agent Portal's `Candidates > Requires Attention` listing: its three severity tabs, search,
the filter modal, pagination, and the two row actions (View + Reminder History). Added
2026-09-09, deliberately mirroring the Active-tab coverage next door, but as ONE file rather
than four - this surface has no Send Reminder control, so there is no reminder-sending section
to split out.

- **`npm run test:require-attention`** (`-p requireAttention`) - the whole file, 37 scenarios.
- **It is IN the default `npm test` run**, exactly as the `@candidateActive` files are, and
  nothing excludes `@requireAttention`. **That is safe because the tab has no bell**: the only
  two row actions are View and Reminder History, so no scenario can send a reminder, create a
  candidate or mutate anything. No fixture is spent, no payment is made, the inbox is not read
  and there is no cleanup hook.
- Steps live in **`steps/require-attention.js`**; the page object is
  **`pages/RequiresAttentionPage.js`**, wired into `features/support/hooks.js` AND
  `fixtures/PagesFixture.js` (one for each runner - there is no auto-discovery in either), and
  picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- **`node scripts/probe-requires-attention.js`** maps the STRUCTURE and
  **`scripts/probe-requires-attention-2.js`** the BEHAVIOUR. Both read-only: they open the filter
  modal and the Reminder History dialog and dismiss both. Every string, URL param and API param
  below came from them - **re-run them rather than reasoning about the DOM.** The second one
  drives the real page object rather than its own copy of the locators, on purpose: a probe with
  its own readers can agree with itself while disagreeing with the suite, which is how the
  community module's `readMemberCards()` under-count went unnoticed.

### Expected baseline (MEASURED 2026-09-09)

`npm run test:require-attention` - **37 scenarios, 35 passed / 2 failed, ~12m** (headless,
serial; 386 steps).

**Both reds are `@known-issue` and are the findings this module exists to surface** (below). A
green run means exactly those two are red and nothing else is.

**>>> THAT BASELINE IS STALE AS OF 2026-09-17 AND MUST BE RE-MEASURED. <<<**
`readReminderHistory()` parsed the dialog's entries by looking for **`Sent • <date>` on ONE
line**. The app now renders **"Sent" and the timestamp on separate lines**, so that regex matched
NOTHING and the reader returned `entries: []` for a candidate whose dialog held **ten `<li>`
rows** - the exact false negative its own comment warns about, live in the default `npm test`
run. Measured directly on the listing: `liCount: 10`, `matchesExistingRegex: []`.

Fixed 2026-09-17 while building the Candidate View Profile feature (which hits the same dialog
from the profile) by deriving entries from the **`<li>` elements** - the structure - and reading
the text inside each one, tolerating both the current stacked form and the older inline one so a
layout change back cannot empty the reader a second time. **Re-run
`npm run test:require-attention` and replace the 35/2 figure above with the measured result**:
whether those Reminder History scenarios were failing or passing vacuously depends on which
assertion each one makes, and that has not been re-measured here.

### The surface, measured

| | |
| --- | --- |
| route | `/candidates/requires-attention` -> redirects to `?activeFilter=all` |
| heading | `Candidates - Requires Attention` |
| tabs | All / Warning / Critical, `agent-candidates-requires-attention-filter-<slug>` |
| tab -> URL | `activeFilter=all\|warning\|critical` |
| tab -> API | `severity=warning\|critical`; **All sends no severity at all** |
| columns | Candidate / Issue / Severity / Last Activity / Actions |
| search | `agent-candidates-search-input`, `?search=`, debounced ~1s |
| row actions | View (`agent-candidates-view-button`) + Reminder History (`agent-candidates-reminder-history-button`) - **no bell** |
| View -> | `/candidates/<id>/view-profile/?selectedTab=candidate-details` - the same 5-tab profile the Active and In Progress tabs open |
| Reminder History -> | a dialog; **the URL does not change** |
| list endpoint | `GET /core/api/v1/candidate/requires-attention/` |
| reminders endpoint | `GET /core/api/v1/agent/candidate/<id>/reminders/?page=1&page_size=10` |

### FIVE DIFFERENCES FROM THE ACTIVE TAB, and each one has a wrong assertion waiting behind it

Do not carry an assertion over from `candidate-active-*.feature` without checking this list.

1. **There is no bell.** Two row actions, not three. An extra action here would be a control
   nobody specified, so the row-action scenario asserts **exactly** two.
2. **The filter groups are its own** - Severity, Issue Category, Last Activity - and none of the
   Active tab's four appear.
3. **>>> LAST ACTIVITY IS A RADIO GROUP AND ITS LABELS CARRY NO `data-testid`. <<<** The other
   two groups are checkboxes that do (`filters-severity-*-checkbox`,
   `filters-issueCategory-*-checkbox`). So a testid-only reader sees **5 of the 9** options and
   any assertion counting them passes having inspected five. `readFilterOptions()` therefore
   walks every `<label>` in the dialog in DOM order and `selectFilterOption()` clicks by the
   index that same pass produced - one list, so the index a step reads is by construction the
   index the click acts on. The SuperAdmin Candidates modal was caught by exactly this.
   - Being a radio group also means **a second Last Activity choice REPLACES the first**
     (measured), so the "two options in one group" scenario is aimed at **Severity**. Aimed at
     Last Activity it would assert behaviour the control cannot have.
   - The checkbox labels need a **real Playwright pointer click**: they carry
     `data-react-aria-pressable` and ignore a scripted `element.click()`.
4. **Last Activity is not sent as a param at all.** The app translates the choice into
   `last_updated_after=` / `last_updated_before=` ISO timestamps, so its URL value
   (`lastUpdated=7days`) and its wire shape have nothing in common - and the exact value moves
   with the clock, which is why the table checks for `last_updated_after=` only.
5. **"Documents" is sent as the SINGULAR `issue_category=Document`** while its URL value is
   `issueCategory=documents`. **Not one of the nine options has a URL param equal to its API
   param**, which is why the filter table asserts both. Checking only the URL would pass on a
   front end that rewrites the address bar and queries the server for something else - and that
   is not hypothetical here, it is the defect below.

### >>> THE REAL DEFECT: A SEVERITY FILTER IS SILENTLY DISCARDED ON A SEVERITY TAB <<<

Measured 2026-09-09 and reproducible. **The tab always wins and the Severity filter is dropped**,
while the URL records it and the Filters badge reads `Filters 1` - so the agent is told a filter
is applied that is not. **The two paths differ, and the difference is the whole finding:**

```
Critical tab + Warning selected, clicking Apply  ->  NO list request is fired at all
reloading that same URL                          ->  ?...&severity=critical   (the TAB's value;
                                                     severity=warning dropped entirely)
```

So it is not merely un-applied on reload: **the opposite value is sent.** A single "the filter
was not applied" message would send a developer hunting for a click handler that never fires
when the bug is in how the two params are reconciled - the step reports both paths separately for
that reason. On the **All** tab the same filter applies correctly (`severity=warning` reaches the
server), which is what localises it.

`Verify that a Severity filter is applied rather than silently discarded on a severity tab`
asserts the sensible behaviour and is `@known-issue @needs-clarification`. **Its first two steps
pass** - the URL really does carry the filter and the badge really does read 1 - so skimming the
report this scenario looks half-green; only the last step is red.

Either fix is defensible - re-sync the tab to the filter, or disable the Severity group while a
severity tab is selected - **so ask the PO which is intended.** This is the same defect class as
the SuperAdmin Candidates listing's Status-filter-vs-lifecycle-tab finding; the two should
probably be settled together.

### The search matches an email; its placeholder says it does not

`Verify that the search placeholder describes what the search actually matches` is the second
`@known-issue`. Measured: the placeholder reads **"Search by candidate name..."** while a full
email address returns that exact one row (4 rows for the name, 1 for the email).

- **It compares the placeholder against the BEHAVIOUR rather than pinning either.** Pinning the
  expected wording would go red the day the copy is reworded for any other reason; pinning only
  the behaviour would say nothing about what the user was told. It goes green whichever way the
  product settles it - reword the placeholder, or narrow the search - and only once the two
  agree. Same treatment as the community module's `Search by candidate name or major`
  placeholder, except that one **over**-promises and this one **under**-promises.
- The behaviour itself is asserted positively two scenarios earlier, and it is correct:
  name, email, a partial email (`abdul.mu` -> 4 rows) and case-insensitively (a full uppercase
  name -> the 1 right row) all match.

### TWO empty states, worded differently, and they are not interchangeable

| Surface | Heading | Body |
| --- | --- | --- |
| a tab with no candidates | `No warnings at the moment` | `Candidates with minor issues that need attention will appear here.` |
| a query matching nothing | `No results found` | `We couldn't find any results matching your current search.` |

A single reader looking for "No results found" answers **absent** on an empty Warning tab, which
reads as the empty state being missing. So `EMPTY_STATES` holds both, `readEmptyState()`
re-reads the page every time (a cached snapshot would let the scenario that asserts one wording,
adds a search, then asserts the second pass no matter what the app rendered), and one scenario
asserts both **exactly** - an `includes` check would go on passing if a sub-line were added.

**The Warning tab holds ZERO candidates today and Critical holds 10+.** That shapes two things:
- every content assertion is **tolerant** (rows OR an empty state), because requiring rows on
  Warning would be red against a tab behaving correctly;
- exactly one scenario pins the empty-state wording, and **it goes red the day Warning gains a
  candidate.** That is the honest signal to re-measure, not a defect - `@edge-case`, not
  `@known-issue`.

### Divergences RECORDED rather than failed on

Same call the receipt-PDF currency step and the agent-email "Talentforge" spelling got: no AC
says which behaviour is right, so failing on them would make the module permanently red over
questions for the PO and bury the findings that matter.

- **A whitespace-only search IS sent to the server** (`search=%20%20%20`), the URL correctly
  omits it, and the list comes back unfiltered - so the outcome is right and the cost is one
  wasted round trip. **Three surfaces, two behaviours:** the SuperAdmin candidates listing does
  the same, the Agents listing suppresses the request entirely. Ask the PO which is house style.
- **The applied-filter badge counts GROUPS, not options.** Two options inside Severity reads
  `Filters 1`; one option in each of two groups reads `Filters 2`. The Active tab's own scenarios
  assert the **option** count for the same-looking badge, so the two listings genuinely disagree
  about what the number means. Asserted as measured on each surface rather than reconciled - **do
  not "align" them** without a product answer.

### >>> THE INLINE ERROR: ONE FIELD OF THREE EXPLAINS ITSELF, AND SPACES SILENCE IT <<<

The form was believed to give no feedback but the disabled Submit. It does - **it validates on
BLUR** - and whitespace is the one case it gets wrong.

| what the candidate does | inline error | Submit |
| --- | --- | --- |
| opens the form, touches nothing | *(none - correct)* | disabled |
| focuses the description and tabs away, empty | **`Description is required.`** | disabled |
| types, clears, and LEAVES the field | **`Description is required.`** | disabled |
| types and clears WITHOUT leaving | *(none - correct, it validates on blur)* | disabled |
| **fills with spaces and leaves** | **NOTHING** | **disabled** |
| **error already shown, then types spaces** | **the message is ERASED** | **disabled** |
| opens the category dropdown and dismisses it, empty | *(none)* | disabled |

- **Spaces count as CONTENT for the message and as EMPTY for the gate.** The field is invalid -
  Submit is correctly disabled - and the candidate is told nothing; worse, typing a space
  actively removes a message that was already on screen. Those two rows are the `@known-issue`.
  The scenario asserts the sensible behaviour, so it turns green by itself the day it is fixed.
- **>>> THE FIRST PROBE GOT THIS RULE WRONG, AND THE WAY IT DID IS THE LESSON. <<<**
  `probe-contact-us-errors.js` ran every case against ONE form, so its opening focus-and-blur
  left the field "touched" and every later case inherited that state. It concluded that "typed
  and cleared" raises the error on its own - which it does not; nothing is raised until the field
  is blurred. `probe-contact-us-errors2.js` reopens the form per case, and the step does too.
  **A probe that reuses one surface across cases measures the case before it, not the app.**
- **Two findings beside it are RECORDED, not failed on**, because no AC settles either: only the
  description explains itself (the category dropdown raises nothing), and **no field carries
  `aria-invalid`**, so `Description is required.` is not associated with its control for a screen
  reader. Both are attached to the report by the same step.
- The cap raises no error at 500 - the field simply stops accepting characters (600 typed -> 500
  held, counter `500/500`), which is the right behaviour and is asserted in the counter table.

### >>> THE CONFIRMATION TOAST CAN APPEAR AND VANISH WHILE THE RESPONSE IS BEING READ <<<

`submit()` used to start looking for the toast AFTER `await response.text()`. Observed
2026-09-14: two submissions of the same shape, one captured
`Support request submitted successfully.` and the other recorded **nothing** - and "no toast
appeared" is a far more alarming finding to hand to dev than the truth. The collector now starts
**before the click** and runs a 20s window concurrently with the request, so a toast that came
and went is evidence rather than a false negative. Same class as the billing grid's skeleton rows
and the bulk-upload progress bar: a reader that can only ever answer "absent" is worse than one
that answers nothing.

### Assertions worth keeping exactly as they are

- **The request log is installed BEFORE the first navigation**, from `hooks.js` /
  `PagesFixture.js`, the same way `InProgressCandidatePage` is. Two reasons, and the second
  forced it: several steps read the query for an action taken several steps earlier, and **the
  defect above is an action that fires NO request at all** - a `waitForRequest` there resolves to
  null and reads identically to a timeout, a slow network or a broken listener. A running log
  distinguishes "nothing was sent" from "something was sent and I missed it". Steps take an index
  baseline rather than resetting the log, so nothing earlier is destroyed.
- **The grid paints before its rows do.** A read taken 4s after `domcontentloaded` reported 0
  rows on a tab holding 10, twice. `settleRows()` keys on `@` appearing in the first Candidate
  cell - the cell is two React-Aria `<button><span>` lines and populates a tick after the row
  skeleton, so the row existing is not the row having content. It resolves on **rows OR an empty
  state**, so an empty tab does not hang.
- **>>> THE REMINDER HISTORY DIALOG OPENS EMPTY AND FILLS AFTERWARDS. <<<** It is visible with
  only its heading while `GET /agent/candidate/<id>/reminders/` is in flight. A read on `visible`
  returned **zero entries for a candidate holding ten** - which would have been reported as "this
  candidate has no reminders", the one conclusion that reader must never reach by accident (same
  class as the billing grid's ten blank skeleton rows). `openReminderHistory()` awaits that
  response and then polls the render up to the count it returned, and hands the payload back so a
  step can compare the two.
  - Compared against **`results.length`, never `count`**: the endpoint pages at 10, so a higher
    `count` is correct and the panel legitimately shows one page of it. And never against a fixed
    number - this account's history grows every time the product's reminder cron runs.
  - Each entry must carry **both** a title and a `Sent - <date>`. A panel listing bare titles
    with no timestamps is not a reminder history, and a presence check on either alone passes on
    it. Entries are derived structurally from the `Sent` line, not from a class name.
  - **The panel must NAME the candidate whose row was clicked**, checked against the noted row. A
    dialog that always shows the first candidate's history is a disclosure problem as much as a
    rendering one, and it is invisible unless the name is compared against the row.
- **The profile's tab strip paints seconds after its heading**, so it is polled. A single read
  returned `["Candidates","Profile","En","FM","Reminder History"]` - the shell only - and
  reported all five tabs as missing on a profile that renders them about four seconds later.
  `I should be on that candidate's profile page` waits for the URL and the `Profile` heading, and
  neither is evidence the tabs have arrived. (Found by the first full run; it was a suite defect,
  not a product one.)
- **Absences watch a WINDOW, never a single sample.** `no Reminder History panel should open on
  its own` and `reminderHistoryStaysClosed()` exist because "not visible" is also true of a panel
  the app has not rendered yet - the same distinction `saveStaysDisabled()` makes in the promo
  module.
- **Multi-check steps collect every problem and throw once.** Cucumber abandons a scenario at its
  first failing step, and the severity-tab, filter-option, row-action and search-variation steps
  each have three to nine independent cases - reporting only the first would hide whether the
  rest share a cause.
- **The column list is asserted EXACTLY and in order.** An extra column silently shifts every
  gridcell index the row readers depend on (Issue=0, Severity=1, Last Activity=2), so a tolerant
  check would let every later severity assertion read the wrong cell.
- **Pagination is scoped by accessible name.** The page shell's sidebar is also a `<nav>`, so an
  unnamed reader resolves to `Dashboard Candidates Active In Progress ...` and reports it as
  pagination. Measured behaviour: `Previous 1 2 Next`, Next requests `page=2`, and **a search
  from page 2 resets to `page=1`** and drops the param from the URL (a search that kept the
  offset would strand the agent on an empty page 2 of a one-page result).

### Every phrase is worded "Requires Attention ...", and that is deliberate

Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
**ambiguous** step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
fails generation on it instead). `steps/active-candidate.js` already owns the generic listing
vocabulary, and **every one of those steps is bound to `this.pages.activeCandidate`** - so they
could not be reused here even if the wording were free: they would drive the Active tab while the
scenario is on Requires Attention, and pass or fail against the wrong page.

Exactly **three** phrases are reused from `active-candidate.js`, and only because each is
genuinely page-agnostic (it reads `this.page.url()` / `this.searchTerm` and touches no page
object): `Given I am logged in as an agent`, `Then the URL should contain the search term`, and
`Then the URL should contain the filter "<fragment>"`. Two phrases had to be renamed to avoid a
collision - `the Requires Attention Filters button should show an applied-filter count of ...`
and `no Requires Attention filter option should be selected`.

`npx cucumber-js -p requireAttention --dry-run` reports **37 scenarios / 386 steps, 0 undefined,
0 ambiguous**, and `node scripts/check-profile-selection.js` confirms the new profile selects 37
and the default profile picks the file up.

## Deactivated candidates (`features/Agent_Portal/candidate-deactivated.feature`)

The Agent Portal's `Candidates > Deactivated` listing: its structure, the search, the three-group
filter modal, its single row action and the end-to-end walks. Added 2026-09-21, deliberately
mirroring the Requires Attention file next door - ONE file, sectioned, rather than the Active
tab's four, because this surface is smaller still (no tabs, no reminders, one row action).

- **`npm run test:deactivated`** (`-p candidateDeactivated`) - the whole file, 33 scenarios.
- **It is IN the default `npm test` run**, exactly as `@requireAttention` and `@candidateActive`
  are, and nothing excludes `@candidateDeactivated`. **That is safe because the listing has no
  write control of any kind**: the only row action is View, and there is no Reactivate anywhere on
  the surface - so no scenario can change an account, spend a fixture, send an email or make a
  payment. There is no cleanup hook because there is nothing to clean up.
- Steps live in **`steps/candidate-deactivated.js`**; the page object is
  **`pages/DeactivatedCandidatePage.js`**, wired into `features/support/hooks.js` AND
  `fixtures/PagesFixture.js` (one for each runner - there is no auto-discovery in either) and
  picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- **Four read-only probes** did the measuring and not one of them writes:
  `scripts/probe-deactivated-candidates.js` (structure), `-2.js` (behaviour - search, every filter
  option's URL param beside its API param, multi-select, Clear All, the View destination,
  pagination), `-3.js` (the three questions the first two left unsettled) and `-4.js` (the empty
  state on a zero-candidate agent, and how an agent gets back from the profile). **Re-run them
  rather than reasoning about the DOM.**

### Expected baseline (MEASURED 2026-09-21)

`npm run test:deactivated` - **33 scenarios, 30 passed / 3 failed, 363 steps** (headless, serial). **Since 2026-10-14 the placeholder scenario is pinned and passes, so the expected steady state is 31 passed / 2 failed** (derived, not re-measured).

**All three reds are `@known-issue` and they are the findings this module exists to surface.** A
green run means exactly those three are red and nothing else is. Verify the list with
`npx cucumber-js -p candidateDeactivated --dry-run --tags "@known-issue"` rather than trusting
this prose.

**That 30/3 is derived from two runs and the derivation matters, so it is written down rather
than rounded off.** The final full run reported 28 passed / 5 failed in 15m 34s. Two of those
five shared one cause and neither is a defect: the machine's network was suspended part way
through (`page.goto: net::ERR_NETWORK_IO_SUSPENDED`, which is the OS suspending network I/O, i.e.
the laptop slept), and the adjacent scenario's sign-in then exhausted its retries against a dead
network. **Both pass when re-run - 2 scenarios / 13 steps / 40s** - so the steady state is 30/3.
The run takes ~15 minutes, which is long enough for a machine to sleep under it; if two
scenarios fail on `ERR_NETWORK_IO_SUSPENDED` or a sign-in timeout, re-run them before reading
anything into it.

The FIRST full run reported **27 passed / 6 failed**. Three of those six were SUITE defects, not
product ones, and all three are fixed and re-verified (3 scenarios / 43 steps, 27s): the
profile-payload wait, the same again on a second row, and a stalled Background login. Each is a
class this repo has paid for before - see "THREE SUITE DEFECTS THE FIRST FULL RUN EXPOSED" below.

### The surface, measured

| | |
| --- | --- |
| route | `/candidates/deactivated` - **no redirect and no `activeFilter` param** |
| heading | `Candidates - Deactivated` (rendered as a `<button>` inside the `<h1>`) |
| grid | `role=grid`, accessible name **"Deactivated"** |
| columns | Candidate / Account Verification / Pending Documents / Subscription Status / Actions |
| search | `agent-candidates-deactivated-search-input`, `?search=`, debounced ~1s |
| filters | `agent-candidates-deactivated-filters-button` |
| row action | **View only** (`agent-candidates-view-button`) |
| View -> | `/candidates/<id>/view-profile?selectedTab=candidate-details` |
| list endpoint | `GET /core/api/v1/candidate/deactivated/?page=1&page_size=10&search=` |
| profile payload | `GET /core/api/v1/candidate/profile/<id>/` |
| no-results state | `No results found` / `We couldn't find any results matching your current search.` - and **no "Clear all filters" CTA** |

### SIX DIFFERENCES FROM THE NEIGHBOURING LISTINGS, each with a wrong assertion behind it

Do not carry an assertion over from `require-attention.feature` or `candidate-active-*.feature`
without checking this list.

1. **THERE IS NO TAB STRIP.** No radiogroup on the route and no `activeFilter` param, where
   Requires Attention has three severity tabs. A reader that waits for one hangs on a page that is
   fully rendered. Asserted as a rule, so if one is ever added that scenario says so.
2. **THERE IS EXACTLY ONE ROW ACTION.** No Reminder History (both siblings have it), no Reactivate.
3. **Pending Documents is a RADIO group and its labels carry NO `data-testid`**, where the other
   two groups are checkboxes that do. So a testid-only reader sees **5 of the 8** options and any
   assertion counting them passes having inspected five. `readFilterOptions()` therefore walks
   every `<label>` in the dialog in DOM order and `selectFilterOption()` clicks by the index that
   same pass produced. Being a radio also means a second Pending Documents choice **replaces** the
   first and a chosen option cannot be un-picked, so the "two options in one group" scenario is
   aimed at **Subscription Status**; aimed at Pending Documents it would be asserting behaviour the
   control cannot have.
4. **NOT ONE option's URL value equals its API value.** `pendingDocuments=3plus` ->
   `pending_documents=3+`, `subscriptionStatus=notSubscribed` -> `subscription_status=not_subscribed`,
   and so on for all eight - which is why the filter table asserts both. Checking only the URL
   would pass on a front end that rewrites the address bar and queries the server for something
   else, and that cannot be caught by reading the rendered rows either.
5. **The app ALWAYS sends `search=`, even empty.** So "a request carrying `search=`" is not
   evidence that a search was applied - assert the VALUE.
6. **There is no `Back` control on the profile this listing opens** (measured: zero elements whose
   text is exactly "Back"). The return path is the browser's own Back, and it restores the filter,
   the badge, the search term and the rows - which is what the end-to-end scenario asserts.

### >>> THE GRID KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT <<<

The single most important thing in this module, and it cost the first run two red scenarios.

A row read taken after a fixed delay is not reading the result of the action just performed - it
is reading whatever happened to be on screen, and it does not fail, it **reports the OLD list as
the new one**. Measured: searching one candidate's email returned all six rows, and the scenario
reported the search as not filtering at all, against a search that works perfectly.

- **No delay fixes it**, because nothing in the DOM distinguishes "these are the new rows" from
  "these are the old ones". `settleRows()` resolves on the first visible row, which the stale ones
  satisfy.
- **`settleAgainstServer()` is the settle**: wait for the list RESPONSE, then poll the grid until
  what it renders matches that payload. Every action that changes the list - search, clear, apply
  filters, navigate, reload, Next - goes through it. **Do not add one that does not.**
- It matches against `results.length`, **never `count`**: the endpoint pages at 10, so a higher
  `count` is correct and the render legitimately stops there.
- **`searchCapturingRequest()` clears first and settles that too**, because the control only fires
  when the value CHANGES - typing a term equal to the one already applied sends nothing at all and
  the read would be of the previous result. That is also what lets the variations table drive two
  terms that happen to be identical (an all-lowercase name in "upper case" and "lower case")
  without one silently measuring the other.
- **Counts compared against counts use the SERVER's `count`** (`lastListCount()`), not the rendered
  row count, because the render is capped at `page_size`: two results differing only past the first
  page would look identical on screen.

### >>> `decodeURIComponent` DOES NOT DECODE "+" TO A SPACE, AND A SHARED STEP RELIES ON IT <<<

`the URL should contain the search term` in `steps/active-candidate.js` compares
`decodeURIComponent(url)` against `search=<term>`, so for a MULTI-WORD term it looks for
`search=Abdul Musawwir` in a URL that correctly reads `search=Abdul+Musawwir`, and can never
match. **That is a reader limitation, not a product defect** - a query string encodes a space as
`+`, and `decodeURIComponent` deliberately does not undo that (only `URLSearchParams` does).

This file therefore defines its own `the Deactivated URL should contain the search term`, built on
`URLSearchParams`. **The shared step was deliberately left alone**: three features depend on it and
fixing it there needs those three re-measured. Worth doing - it means any sibling scenario
searching a multi-word name is either red or has never been run with one - but not from here.

### Two suspected defects that DISSOLVED under a control, recorded so nobody re-files them

Both looked real in the first probe pass and both were measurement artefacts.

- **"A union of two filter options returns MORE rows than the unfiltered list"** - observed 5
  against a total of 4. It was two readings of a list that changed between them: the deactivated
  list grew 4 -> 6 during one afternoon's probing. Re-measured against the server's own `count` in
  a single pass: unfiltered 6, Subscribed 1, Not Subscribed 4, Payment Due 1, union of the first
  two **5**. The arithmetic is correct and the three options partition the list.
- **"The search returns every row for an address containing a `+`"** - the natural reading was that
  the term was not being encoded. Controlled against an address with no `+` in it, both return
  exactly one row with `count: 1`. The original reading was the stale-grid trap above.

**The deactivated list is small and VOLATILE** - it is shared DEV data and other people deactivate
candidates on it. So no scenario pins a row count, a candidate name or a total; every count
assertion is relational (back to its unfiltered value, no greater than unfiltered, the sum of two
measured figures), and the union step's failure message says to check whether the list moved under
the scenario before reading it as a defect.

### The three findings this module surfaces

**Two are `@known-issue` across three scenarios** (finding 2 is split in two); the third is
recorded rather than failed on.

1. ~~**The search placeholder under-promises.**~~ **RESOLVED 2026-10-14 by product decision** (same as Requires Attention, 2026-10-05): `Search by candidate name...` IS the intended wording, so the scenario now pins it verbatim and is `@positive`. Original note: it reads `Search by candidate name...` while the
   search also matches an EMAIL - measured four ways (full address, an address containing `+`, the
   local part, the bare domain). The scenario compares the placeholder against the BEHAVIOUR rather
   than pinning either, so it goes green whichever way the product settles it - reword the
   placeholder, or narrow the search - and only once the two agree. **Identical to the Requires
   Attention placeholder**, so it is probably one copy fix for both.
2. **>>> THE ACCOUNT VERIFICATION COLUMN HEADER CARRIES AN UNLABELLED HELP ICON THAT EXPLAINS
   NOTHING. <<<** It is Feather's `help-circle` in an icon-only `<button>` with **no aria-label, no
   title, no text and no `aria-describedby`**, and it renders **no tooltip on hover or on click**.
   So it advertises an explanation and provides none, and announces only "button" to a screen
   reader. WCAG 4.1.2 Name, Role, Value (A).
   - **IT IS NOT A SORT CONTROL, and that is worth knowing before anyone re-diagnoses it.** The
     header carries no `aria-sort`, no other column has a button at all, and clicking it reorders
     nothing and fires no request. It was first mistaken for a sort off the MCP accessibility tree;
     every row on the tab reads "Unverified", so a working sort and an inert control look
     identical, and it took reading the svg path to settle it.
   - **TWO scenarios, not one** - "the control has no name" and "the control does nothing" are
     different defects with different fixes, and Cucumber abandons at the first failing step, so
     one scenario could only ever report the first. Same split the candidate view-profile module
     made for its own unlabelled-and-inert header icon; that one is the same defect class, so it is
     probably one component fix rather than two.
   - The tooltip assertion watches a WINDOW and tries hover AND click, because it proves an
     ABSENCE: "no tooltip is visible" is also true of one the app has not rendered yet.
3. **RECORDED, NOT FAILED ON: the `3+` filter sends a raw, unencoded `pending_documents=3+`.** A
   bare `+` in a query string decodes as a space, so the server receives `"3 "`. No deactivated
   candidate currently holds 3+ documents, so a working filter and a broken one return the
   identical empty list and **cannot be told apart on this data** - which is exactly why it is
   attached for the PO rather than asserted. The URL already renames the value sensibly (`3plus`).
   **Question for the PO: should it be percent-encoded (`%2B`), or renamed on the wire too?**

### Divergences recorded rather than failed on

Same call the receipt-PDF currency step and the Requires Attention badge got: no AC settles either,
so failing on them would make the file permanently red over a question for the PO.

- **A whitespace-only search IS sent to the server** (`search=+++`), the URL correctly omits it,
  and the list comes back unfiltered - so the outcome is right and the cost is one wasted round
  trip. **Three surfaces, two behaviours**: Requires Attention and the SuperAdmin candidates
  listing do the same; the Agents listing suppresses the request entirely. Ask the PO which is
  house style.
- **The applied-filter badge counts GROUPS, not options.** Two options inside Subscription Status
  reads `Filters 1`; one option in each of two groups reads `Filters 2`. The Active tab's own
  scenarios assert the OPTION count for the same-looking badge, so the two listings genuinely
  disagree about what the number means. Asserted as measured on each surface - **do not "align"
  them** without a product answer.

### Pagination is asserted as a RULE, never as the current state

The app asks for `page_size=10` and this agent holds well under that, so no pagination control
renders today - and that is correct. Pinning "there is no pagination" goes red the day an 11th
candidate is deactivated, which is not a defect; pinning "there is pagination" is red right now for
the same reason. So the scenario asserts the RELATIONSHIP - offered only when the list exceeds one
page - reading the page size off **the app's own request** rather than hardcoding it, and exercises
Next only when there is a second page to go to. It reports which branch the data put it in on every
run, so a green row still says what was observed.

### The tab-level empty state is UNREACHABLE today, and the step says so rather than pretending

There are TWO empty states and they are not interchangeable: one describes a listing with nothing
on it, the other a query matching nothing. A single reader looking for "No results found" answers
"absent" on a genuinely empty listing, which reads as the empty state being missing entirely.

- The **no-results** state is measured verbatim and pinned exactly (not `includes`, which would go
  on passing if a sub-line were added).
- The **tab-level** state - `No deactivated candidates` / `Candidates who have been deactivated
  will appear here.` - is **supplied by the PO and NOT yet measured**: this agent always holds
  deactivated candidates, and `NO_CANDIDATE_AGENT`'s login currently times out, so it cannot be
  observed. **That fixture is worth repairing** - `scripts/provision-no-candidate-agent.js`.
- So `Verify that the empty state is worded for its own cause rather than one message for both`
  asserts the tab-level wording verbatim **when the listing is empty**, and when it is not, it
  asserts the half that can actually go wrong: that the no-results state is NOT worded as the
  tab-level one, i.e. the app does not use one message for both causes. It strengthens by itself
  the day the fixture allows it, and attaches why it took the branch it took.

### THREE SUITE DEFECTS THE FIRST FULL RUN EXPOSED, ALL FIXED

Every one would have been read as a product defect, and each is a class this repo has paid for
before. The diagnosis is the reusable part.

1. **>>> `waitForURL` RESOLVES ON COMMIT, LONG BEFORE THE PAGE HAS FETCHED ANYTHING. <<<** Two
   scenarios reported *"the profile payload was never captured, so which candidate was opened
   cannot be established"* - i.e. they described the app as never making a call it demonstrably
   makes (measured: `GET /candidate/profile/11409/` -> 200, matching the reader's own regex).
   `profilePayload()` flushed the outstanding parses at a moment when the request had not been
   made. It now WAITS for the payload and then awaits the parse - **both halves are needed**,
   because `page.on('response')` handlers are not awaited by Playwright, so a body that has arrived
   is not yet a body that has been read. Same class as the candidate view-profile module's finding
   2, and the second half was already guarded there; the first was not.
   - `openCandidateProfile()` also clears the payload BEFORE clicking, so a scenario that opens two
     profiles in turn cannot read the first one's payload and conclude the second opened the right
     candidate.
2. **The stale-grid read** - see the settle section above.
3. **A stalled Background login** killed one scenario at exactly 60s. Fixed at the root, for three
   features at once - see the next section.

### >>> THE STALLED LOGIN IS NOW FIXED IN ONE PLACE: `utils/resilientSignIn.js` <<<

This environment intermittently stalls a login: the form submits and the app never navigates, with
no error shown. Measured at 2 of 45, 0 of 45 and 1 of 45 scenarios across three runs of
`candidate-view-profile.feature`, and it killed one Deactivated scenario the same way. Every one
passes when re-run alone.

- **A BIGGER TIMEOUT IS THE WRONG FIX AND WAS ALREADY TRIED** (60s -> 120s; the next run blew
  through 120s on a different scenario). A stalled attempt never completes however long you wait.
- Each attempt is **bounded at 30s and CLASSIFIED**: left `/login` for an expected route = accepted;
  an error on screen = **rejected, fails now**; "too many attempts" = **locked out, fails now**;
  still on `/login` with nothing said = stalled, re-navigate and retry (3 attempts).
- **A rejection must never be retried.** Failed sign-ins are rate limited per ACCOUNT on this
  backend, so retrying a wrong password deepens a lockout and turns one fixture problem into a
  whole unusable run - exactly what happened to the Change Password fixture. Lockout is checked
  FIRST, because its wording also matches the rejection pattern via "attempts"/"try again".
- **It was a module-local function inside `steps/candidate-view-profile.js`, while
  `steps/active-candidate.js` - whose `I am logged in as an agent` is the Background of the
  Active, Requires Attention AND Deactivated features - had a bare `waitForURL` and no retry at
  all.** So the fix existed and three features went on failing for want of it. It is now one
  implementation in `utils/resilientSignIn.js`; candidate-view-profile keeps a thin positional
  wrapper so its own call sites are unchanged. **Do not write a fourth login here.**
- A retry that succeeded is **attached to the report**, so a run that needed one is visible rather
  than silently slower.

### Assertions worth keeping exactly as they are

- **The View destination is checked against the PROFILE PAYLOAD, not the rendered header.** A
  listing that always opened the first row's profile would satisfy a bare "I am on a view-profile
  page" check, and that is a disclosure problem as much as a navigation one.
- **The profile's CONTENTS are deliberately NOT asserted.** Only that the route works and the five
  tabs render. Its header, widgets, every tab and its Reminder History dialog belong to
  `candidate-view-profile.feature`, which already drives that screen **from this very listing** - a
  second implementation would drift from the first.
- **The profile tabs are `role="radio"` in a `role="radiogroup"`, NOT `role="tab"`**, and they paint
  seconds after the "Profile" heading, so they are polled. A `getByRole('tab')` reader finds nothing
  on a strip that plainly renders five.
- **The column list is asserted EXACTLY and in order.** An extra column silently shifts every
  gridcell index the row readers depend on (Account Verification=0, Pending Documents=1,
  Subscription Status=2), so a tolerant check would let every later cell assertion read the wrong
  column.
- **Filter options are clicked with a REAL Playwright pointer click**, never `element.click()`:
  React-Aria pressable labels ignore a scripted click, and a mixed pass through the SuperAdmin
  modal reported three working checkbox groups as ignored by the app - a defect that did not exist.
- **Options are matched on their EXACT label**, never a `filter({hasText})` substring - "Subscribed"
  would otherwise also match "Not Subscribed", and "0" every option containing a zero.
- **Multi-check steps collect every problem and throw once.** The column, filter-group,
  filter-option, search-variation and row-action steps each have three to eight independent cases;
  Cucumber abandons at the first failing step, so reporting only the first would hide whether the
  rest share a cause.
- **Every table-driven step carries an explicit `{ timeout }`.** `features/support/hooks.js` calls
  `setDefaultTimeout(60000)` and **that overrides the profile's own `timeout`** - this profile asks
  for 300000 and gets 60000. A step that reopens the filter modal once per row is many times a
  normal step's work, so without a budget of its own it is killed part way and reports "function
  timed out", which says nothing about the app and hides however many rows had already passed.
  **This trap has now bitten five areas in this repo.**

### Every phrase is worded "... Deactivated ...", and that is deliberate

Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
**ambiguous** step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
fails generation on it instead). `steps/active-candidate.js` already owns the generic listing
vocabulary, and **every one of those steps is bound to `this.pages.activeCandidate`** - so they
could not be reused here even if the wording were free: they would drive the Active tab while the
scenario is on Deactivated, and pass or fail against the wrong page.

Exactly **three** phrases are reused, and only because each is genuinely page-agnostic (it reads
`this.page.url()` and touches no page object): `Given I am logged in as an agent`, `Then the URL
should contain the filter "<fragment>"` and `Then the URL should not contain the filter
"<fragment>"`. A fourth - `the URL should contain the search term` - was deliberately NOT reused;
see the `decodeURIComponent` note above.

`npx cucumber-js -p candidateDeactivated --dry-run` reports **33 scenarios / 363 steps, 0
undefined, 0 ambiguous**, and `node scripts/check-profile-selection.js` confirms the new profile
selects 33 and the default profile picks the file up.

## Candidate View Profile (`features/Agent_Portal/candidate-view-profile.feature`)

The screen the **View** row action opens from the Candidates listings:
`/candidates/<id>/view-profile?selectedTab=<slug>`. Its header (avatar band, name, status pill,
headline, location), its four progress widgets, its Reminder History dialog, and its five tabs -
Candidate Details, Track Progress, Document Verification, Subscription, Activity Log. Added
2026-09-17.

- **`npm run test:view-profile`** (`-p candidateViewProfile`) - all 51 scenarios.
- **`npm run test:view-profile:read-only`** (`-p candidateViewProfileReadOnly`) - the 50 that
  write NOTHING. **Run this while iterating on a locator.**
- Those same 50 are **IN the default `npm test` run**, exactly as `@candidateActive`'s and
  `@requireAttention`'s are, and nothing excludes `@candidateViewProfile`.

#### >>> WHY THAT IS SAFE - AND THE REASON THIS FILE USED TO GIVE WAS FALSE <<<

Until 2026-09-17 the stated reason was "the page has no form, no Save, **no decision control**
and nothing that sends a reminder". **The decision-control half is wrong.** Measured: opening a
**Needs Review** document from the Document Verification tab raises a dialog carrying
**Approve** and **Request Revision** - `agent-approve-button` and
`agent-request-revision-button`, the same controls under the same test ids that `/verifications`
uses, because it is the same panel component. Either one commits irreversibly and nothing in the
product reverses it.

The feature is still safe in the default run, but for a narrower and more honest reason:

- the tab, its rows, both row actions, the viewer, its zoom and its Download are all **reads**;
- **opening the viewer fires no request at all** - the tab re-renders the profile payload;
- so a scenario may open the viewer, read which controls are offered, and close it.

**Nothing in `pages/CandidateViewProfilePage.js` clicks either decision control, deliberately -
do not add a generic `decide()` there.** The gating rule is asserted by OBSERVING which controls
appear per status, never by using one. The decision itself, and the version increment a
resubmission produces, are driven in `features/AI Document Verification/`, which already owns
upload -> AI -> agent decision end to end and already pays that irreversible cost.

There is no cleanup hook, because there is nothing to clean up.
- The 1 excluded scenario is `@mutates-profile` - the end-to-end one that edits the fixture
  candidate's About Me on the CANDIDATE portal and reads it back on the agent portal. It is
  already excluded by the default profile's existing `not @mutates-profile`, so no tag change
  was needed anywhere.
- Steps live in **`steps/candidate-view-profile.js`**; the page object is
  **`pages/CandidateViewProfilePage.js`**, wired into `features/support/hooks.js` AND
  `fixtures/PagesFixture.js` (one for each runner - there is no auto-discovery in either) and
  picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- **`node scripts/probe-candidate-view-profile.js`** is the read-only probe behind every string,
  route, param and measurement below. It opens both dialogs and closes them and clicks nothing
  that writes. **Re-run it rather than reasoning about the DOM.** It drives the real page object
  rather than its own copy of the readers, on purpose: a probe with its own readers can agree
  with itself while disagreeing with the suite, which is how the community module's
  `readMemberCards()` under-count went unnoticed.

### Expected baseline

**>>> STALE AS OF 2026-09-17: THE FILE WENT 47 -> 56 SCENARIOS AND NO FULL RUN HAS HAPPENED
SINCE. <<<** What WAS measured that day, after the Document Verification rework:

`npx cucumber-js -p candidateViewProfile --name "document|empty state|without a mouse"` -
**12 scenarios, 11 passed / 1 failed, 110 steps, 3m 38s** (headless). The one red is the
accessibility `@known-issue`, failing with *"6 of 6 View/Download actions cannot be operated
without a mouse"*; re-run alone it is 7 of its 8 steps green and only the audit step red. The
`@known-issue` count is unchanged at **9** (`--dry-run --tags "@known-issue"`).

Five scenarios were then REMOVED (below), so the file now dry-runs to **51** with **4**
`@known-issue` reds. **Run `npm run test:view-profile:read-only` once and replace this block
with the measured figure.** The expected shape is 50 scenarios with 4 reds.

The superseded figure, for reference - `npm run test:view-profile:read-only` -
**46 scenarios, 37 passed / 9 failed** - was DERIVED from
the 45 / 36 / 9 / 381 steps measured that morning plus the tab-slug split made the same day (one
scenario became two, the new half being the green control, and both halves were re-run
individually: **2 scenarios, 1 passed / 1 failed, 18 steps, 27s**). **Run the cut once and
replace this line with the measured figure.** **All 9 reds are the `@known-issue` findings
enumerated at the foot of this section, and nothing else.** A green run means exactly those 9
are red.

Verify the list with
`npx cucumber-js -p candidateViewProfile --dry-run --tags "@known-issue"` (reports 9) rather than
trusting this prose.

The 47th scenario is the `@mutates-profile` end-to-end one, which is excluded from this cut and
**has never been run** - it needs `VIEWPROFILE_E2E_CANDIDATE_EMAIL` / `_PASSWORD`, a candidate of
this agent whose password the suite knows, and no existing fixture qualifies. It is the only
scenario in the file that proves the candidate -> agent WRITE path rather than comparing two
reads of it, so it is worth provisioning for.

**Three earlier runs are superseded and are recorded only because each one taught something:**
34/11 (two login stalls plus the under-counting activity reader), 37/8 (the Basic Information
scenario passing VACUOUSLY on a drifted fixture - see below), and 35/10 (one login stall, on the
run that still had the wrong timeout-based fix). **Do not average them** - the differences were
three distinct defects in the suite, all since fixed.

### >>> ONE FEATURE FILE FOR EVERY LISTING, NOT ONE PER LISTING <<<

The profile is the SAME surface however it is reached, so each rule is asserted ONCE against a
data table of listings. That is not tidiness: every scenario costs a fresh browser context and
an agent login, so three files asserting one rule would pay for three logins to learn one thing
- and when the rule broke, three red rows would not say whether they shared a cause. The
table-driven steps walk every listing, collect every failure and report them together.

Same reasoning as `features/Promo_Code/`'s 61 -> 32 and the community module's 49 -> 43.

### >>> THE IN PROGRESS LISTING HAS NO VIEW CONTROL, SO THE PROFILE IS UNREACHABLE FROM IT <<<

Measured 2026-09-17, and it corrected a wrong assumption this work started from:

| listing | row actions | route to the profile? |
| --- | --- | --- |
| Active | View + Reminder History | yes |
| **In Progress** | **Resend + Reminder History** | **NO - there is no View at all** |
| Deactivated | **View only** (no Reminder History row action) | yes |
| Requires Attention | View + Reminder History | yes |

So the listing tables in the feature file hold **three** listings, not four. That absence is
**asserted as a rule** by its own scenario rather than left as a silent gap - if a View is ever
added to In Progress, that scenario goes red and the map in `CandidateViewProfilePage.listings`
gains a fourth entry. The scenario also REPORTS what In Progress offers instead, so a red row
says what the product does rather than only what it does not.

Listing testids: `agent-candidates-view-button`, `agent-candidates-reminder-history-button`,
`agent-candidates-resend-invite-button`.

### The surface, measured

| | |
| --- | --- |
| route (Active, Deactivated) | `/candidates/<id>/view-profile?selectedTab=<slug>` |
| route (Requires Attention) | `/candidates/<id>/view-profile/?selectedTab=<slug>` **note the extra `/`** |
| tab slugs | `candidate-details` / `track-progress` / `document-verification` / `subscription` / `activity-log` |
| profile payload | `GET /candidate/profile/<id>/` |
| Candidate Details | **no request** - re-renders the payload above |
| Document Verification | **no request** - likewise |
| Track Progress | `GET /tracks/candidate/<id>/` -> **404 when no track, which is NORMAL** |
| Subscription | `GET /subscription/current/<id>/` + `GET /plans/` |
| Activity Log | `GET /analytics/candidates/activity-logs/<id>/?page=1&page_size=10&duration=<v>` |
| Reminder History | `GET /agent/candidate/<id>/reminders/?page=1&page_size=10` |
| sections | Basic Information / Education / Work Experience / Certifications / Work Preferences & Availability / Desired Roles |
| widgets | Track Progress `<n>%` / Courses Completed / Hours Learned / Certificates Earned |
| header controls | an icon-only `<button>` with NO accessible name, then "Reminder History" |

**THE ROUTE DIFFERS BY A TRAILING SLASH BETWEEN LISTINGS**, and both forms are live today, so
every URL assertion tolerates both (`VIEW_PROFILE_URL`). A step pinning one form would be red
from whichever listing uses the other, which says nothing about the product.

### THREE LOCATOR TRAPS, ALL MEASURED

1. **>>> THERE IS NOT ONE `data-testid` ON THE WHOLE PAGE. <<<** Measured 0 on every tab. So
   every locator is a role+accessible-name or one of the app's own structural class hooks -
   `.profile-images-container`, `.profile-basic-details`, `.top-right-buttons-container`,
   `.basic-information-section`, `.education-section`, `.work-experience-section`,
   `.certifications-section`, `.location-preferences-section`, `.desired-roles-section`. Those
   class names ARE the stable contract here. **Note Work Preferences' class is
   `location-preferences-section`** - it does not follow its heading, and guessing
   `work-preferences-section` yields a reader that can only ever answer "absent".
2. **>>> THE TABS ARE `role="radio"` IN A `role="radiogroup"`, NOT `role="tab"`. <<<** A
   `getByRole('tab')` reader finds NOTHING on a strip that plainly renders five tabs. (One tab
   stop for all five with arrows moving within is correct radiogroup behaviour, not a defect.)
3. **>>> NEVER USE A react-aria ELEMENT ID. <<<** They look tempting
   (`#react-aria2477098970-_r_b3_` on the header icon button) and they are **regenerated on
   every render**. Observed while probing: an id captured moments earlier resolved to the header
   AVATAR MENU after a tab change, so a click "on the link button" opened the profile dropdown
   instead - a wrong-element resolution that reads as the app misbehaving.

### Two placeholder characters, meaning two different things

An unset profile **field** renders an ASCII hyphen `-`; an uncomputed **statistic** renders an em
dash `—` (the four widgets, when `stats` is null, with Track Progress showing `—%`). The
candidate's own profile draws the same distinction. A reader that conflates them reports an empty
field as a missing statistic. One scenario additionally asserts the widgets show **no zero** when
the statistics are uncomputed - a zero and an unknown are different facts, and a widget showing 0
tells the agent the candidate has done nothing, which is not known.

### The payload field behind every rendered value

Written down because asserting a rendered value against the wrong payload field is this repo's
most repeated source of false findings (`is_verified` vs `is_email_verified`, `account_status`
"Inactive" vs the grid's "Deactivated").

| rendered | field |
| --- | --- |
| name | `user.firstname` + `user.lastname` |
| status pill | `is_verified` -> Verified / Unverified — **verification state, NOT account state** |
| headline | `headline` (an EMPTY `<p>` is rendered when null, so "the line after the pill" is not safely the location) |
| location | `current_location.location_name` |
| widgets | `stats.track_progress` + `%`, `stats.courses_completed`, `stats.hours_learned`, `stats.certifications_earned` |
| Current Status | `qualification`, Title-Cased (`STUDENT` -> `Student`) |
| About Me | `about_me` |
| Education line | `institution_name` / `degree_name, field_of_study_name` / `Month YYYY - Month YYYY` |
| Work Experience | `designation` / `experience` Title-Cased / `company_name` / `... - Present` when `is_current` |
| Certifications | `name` / `issued_by` / `Issued Month YYYY - Expires Month YYYY` |
| Interested Programs | derived from `interested_in_tamheer` + `is_co_op_preferred`; neither -> `-` |
| Open to Relocation | `interested_in_relocation` -> Yes / No |
| Preferred Work Location(s) | `preferred_locations[].location_name`, `-` when empty |
| Desired Roles | a FLAT list of `roles[].name`, uppercase Title-Cased (`DATA ANALYST` -> `Data Analyst`) |
| attachment | `document.file_name`, linked to `document.file` (a presigned S3 URL) |

**`roles` IS A FLAT LIST, AND A FIRST READING OF IT WAS WRONG.** On a candidate holding
`["DATA ANALYST", "Information Technology"]` the section renders the second name underneath the
first, which looks exactly like a role with a *category* beneath it - and the natural conclusion
is that the app mislabels `roles[1]` as a sector. It does not: a candidate holding three roles
renders three lines. Checked before it was filed; **do not report it.**

**THE PRESIGNED `href` CARRIES AN `X-Amz-Signature`, WHICH IS A CREDENTIAL.** It is stripped in
`CandidateViewProfilePage.redact()` on the way out of the reader, not at each call site, so it
cannot reach a report or a log by somebody forgetting.

### >>> TWO TABS CORRECTLY FIRE NO REQUEST, AND THAT ABSENCE IS THE ASSERTION <<<

Candidate Details and Document Verification both re-render the payload fetched when the profile
opened. A `waitForResponse` there resolves to null, which is **indistinguishable** from a
timeout, a slow network or a listener attached too late. So `CandidateViewProfilePage.install()`
runs from `hooks.js` / `PagesFixture.js` **before the first navigation** and keeps a running
request log, the same way `InProgressCandidatePage`, `RequiresAttentionPage` and `AuditLogsPage`
do - and here the reason is sharper than in any of them, because the absence is what a scenario
asserts rather than a hazard it works around. The log also captures the profile payload, which
every "the agent sees what the candidate entered" comparison is made against. Steps take an
index baseline rather than resetting it.

### Cross-portal assertions compare against the candidate's OWN stored profile

The heart of this feature is "what the candidate filled in on the candidate portal is what the
agent sees". Every such assertion is made against the payload the app itself fetched, never
against strings repeated from the Gherkin - so a scenario cannot pass by agreeing with itself.

**The date and enum helpers are deliberately thin.** They format a month and year from an ISO
date and title-case one token, and nothing else. A helper clever enough to reproduce the app's
whole rendering would agree with the app by construction and could not catch it being wrong, so
the assertions compare the parts that are unambiguous - the institution name exactly as stored,
the month and year of a stored date - rather than re-deriving a whole sentence.

- `isoMonthYear()` builds from the ISO string's own parts rather than through `new Date()`, which
  shifts a date-only value by the runner's timezone and can report the previous month.
- `titleCaseEnum()` capitalises only the FIRST word and turns `_` into `-`, because the measured
  forms are `STUDENT` -> `Student`, `internship` -> `Internship` and **`co_op` -> `Co-op`** - a
  naive word-by-word title case yields `Co-Op` and fails against a correct render.
- It is used ONLY to build an expected string, never to normalise the app's output before
  comparing: normalising both sides is how a raw-enum leak stops being detectable. One scenario
  is a **regression lock** against exactly that - the candidate's own portal leaks `co_op` in its
  manage list, and the agent portal renders it correctly today.

### >>> THE TWO LABELLED SECTIONS ARE MARKED UP DIFFERENTLY, AND TWO READERS EACH BROKE ON THE
###     OTHER <<<

Found by the first run of this file, and worth keeping because both failures reported fields as
missing from sections rendering them perfectly well:

- **Basic Information** puts all ten lines in **ONE** wrapper (label, value, label, value, ...).
- **Work Preferences** uses one wrapper **per field** - and `Preferred Work Location(s)` **wraps
  its value**, because it can hold several locations.

A reader requiring "exactly two `<p>` children" silently skipped Preferred Work Location(s); a
reader taking "the first line of each wrapper" collapsed the whole of Basic Information into one
entry. `readLabelledFields()` therefore works from the LABELS the section is contracted to show
(`CandidateViewProfilePage.FIELD_LABELS`) and takes each value as everything between that label
and the next. That is independent of the markup, it handles a multi-line value, and a label the
app stops rendering is genuinely absent from the result rather than silently merged into its
neighbour.

### Document Verification

Grouped Education / Work Experience / Certifications. A row is derived from the
`Uploaded on <date>` line it carries rather than from a class name - that line is the one thing
every row has and nothing else on the tab does.

**One API status is rendered three ways across the product**, so the mapping is written down
rather than guessed: `AWAITING` is **"Needs Review"** here (the agent pill) **and on the
verifications filter tab**, and "Awaiting Verification" in the schema's own description.
`REVISION` renders "Revision Required". **>>> THE TAB USED TO READ "Need Review" (singular) AND
NO LONGER DOES - re-measured 2026-09-22; see "Verifications - the document review queue". <<<**

**The Candidate Details tab says nothing about an attachment's verification status** - an entry
whose document is sitting in `REVISION` renders as a bare filename link there, while the status
IS on Document Verification. The candidate's own profile has the same gap, recorded under
"Candidate Details". Arguably more serious on the agent side, since the agent is who decides.
Recorded, not asserted.

### Subscription: `Total Fee` is the amount CHARGED, not the plan price

Measured: a Yearly Plan whose `plan_price` is **1500** renders **`895 SAR`**, which is
`payment.amount` after a promo. Both numbers are on the same payload, so a check for "a number
appears on the page" would pass on either - the assertion names `payment.amount` specifically.
`Status` is a third naming for one state: the API says `ACTIVE`, the tab says **"Subscribed"**.

Dates are compared by their **components** with the month resolved, not as a literal string -
this product's date format has been seen more than one way and a literal comparison would be red
on a formatting choice.

**Question for the PO:** "Total Fee" reads as the plan's fee; it is the amount charged. Should it
be labelled "Amount Paid"?

### Activity Log and its duration filter

Six ranges, and **the filter's value goes straight through as the `duration` API parameter**
(`last_24_hours`, `last_7_days`, `last_30_days`, `last_3_months`, `last_6_months`, `this_year`).
That is unusual and worth noting: on the Requires Attention and SuperAdmin Candidates filter
modals **not one** option's URL value equals its API value.

- **The hidden mirror `<select>` carries a BLANK option the popover does NOT offer**, so it is
  not user-selectable and is **not a defect**. Recorded so nobody reports it.
- **The popover is `role=dialog` > `role=listbox` > `role=option`, with TWO
  `<button aria-label="Dismiss">` FLANKING the listbox.** So select by `role=option` and name,
  never by indexing a locator union - the community module lost four scenarios to exactly this.
- Entries are `headline` / `description` / `created_at`, newest first, and every entry carries
  `actor` and `audience: "CANDIDATE"`. **The actor is asserted against the candidate whose
  profile is open**: a log that always showed the first candidate's activity would satisfy every
  other assertion here, and that is a disclosure problem as much as a rendering one.
- The rendered count is compared against `results.length`, **never `count`** - the endpoint pages
  at 10, so a higher count is correct.
- Narrowing the range is asserted **relationally** (a narrower window cannot return more than a
  wider one), so it needs no fixed expectation about how much activity the account holds.

**FINDING, recorded not asserted: the UI renders only the DATE and discards the time `date_time`
carries.** Two entries on one day with the same headline and description render **identically**,
so the agent cannot tell them apart. Measured twice, the second time far more starkly: on
candidate 10880, **8 of the 10 rendered entries are visually indistinguishable duplicates** -
`Track Completed / ... Marketing and Communications / Jul 23, 2026` three times and
`Course Completed / Brand Management course completed successfully / Jul 23, 2026` three times -
while `date_time` carries a distinct time for each. (The first measurement was two
`Document Resubmitted` entries at 12:04:20 and 11:25:54.)

### >>> THE ACTIVITY READER MUST COUNT ROWS, NOT DE-DUPLICATE TEXT <<<

`readActivityEntries()` returns one entry per **`.activity-log-item`**, the app's own row
container, inside `.activity-log-items-container`. Its first version walked every leaf that
looked like a date and climbed to "a host holding three `<p>`s", which reaches the same row from
several ancestors - so it de-duplicated on `headline|description|date`, and **that collapsed 10
rows into 5**.

Both halves were wrong, and the second is the dangerous one: because this tab discards the time,
rows that are genuinely distinct render identically, so a content de-duplication **hides real
activity** - and it would have let "every entry the server returned is rendered" pass while half
of them were missing. Verified after the rewrite: 10 rows in the DOM, 10 from the reader, all
three fields present on every one.

**Same class as the community module's `readMemberCards()`**, which answered a constant 7 on a
list of 12 and made two scenarios pass having proved nothing. Counting the app's own row
elements cannot drift from what the page shows.

**FINDING: the empty state uses candidate-facing copy on an agent-facing surface** -
`"Your recent actions and updates will appear here as you use the platform."` while an AGENT is
looking at a CANDIDATE.

### Reminder History

A dialog, titled with the candidate's name and subtitled "Reminder History"; **the URL does not
change**. Its Close control is properly `aria-label="Close"` - the one control on this screen
that is. Enablement tracks `has_reminders`, asserted in both directions.

- **>>> THE DIALOG OPENS EMPTY AND ITS ENTRIES ARRIVE AFTERWARDS. <<<** It is visible with only
  its heading while the reminders request is in flight, so a read on `visible` returns ZERO
  entries for a candidate holding ten - "this candidate has no reminders" being precisely the
  conclusion this reader must never reach by accident. The response is awaited and the render
  polled up to the count the server returned.
- **The footer is CORRECT and an early reading of it was wrong:** it offers "View more" when the
  history is truncated (`count` > page) and says "Showing all reminders sent to this candidate"
  only when it is complete. Both branches are asserted. **Do not file it.**
- It renders `title` ("We miss you on Talentforge") rather than `display_title` ("Inactivity
  reminder" / "Document reminder" / "Psychometric test reminder"), i.e. the candidate-facing
  wording where the categorical label would be more useful to an agent scanning a history.
  Recorded, not asserted.
- **Times are timezone-converted** (`08:00Z` renders `1:00 PM`), so no assertion pins a literal
  time.

### >>> A REGRESSION FIXED IN `RequiresAttentionPage` WHILE BUILDING THIS <<<

`RequiresAttentionPage.readReminderHistory()` parsed the entries out of the dialog text looking
for **`Sent • <date>` on ONE line**. The app renders **"Sent" and the timestamp on separate
lines**, so that regex matched NOTHING and the reader returned `entries: []` for a candidate
whose dialog held **ten `<li>` rows** - the exact false negative its own comment warns about, and
it was live in the **default `npm test` run**.

Measured directly on the Requires Attention listing: `liCount: 10`,
`matchesExistingRegex: []`. Fixed by counting the `<li>`s - which is the structure - and reading
the text inside each one, tolerating both the current stacked form and the older inline one so a
layout change back cannot empty the reader a second time. `require-attention.feature`'s recorded
baseline of 35 passed / 2 failed therefore predates this and should be re-measured.

**The lesson is the one this repo keeps paying for: a reader that can only ever answer "absent"
must never be the sole basis for a conclusion.**

### >>> TWO SCENARIO DEFECTS FOUND BY AUDITING THE REDS, AND ONE OF THEM WAS A GREEN <<<

Found 2026-09-17 by going through every failing scenario and asking "is this the product or is
this me". Both are worth knowing because neither showed up as a broken-looking failure.

**1. `Verify that Basic Information is not reported as empty while it holds a stored value`
PASSED HAVING TESTED NOTHING.** Its fixture needs a candidate with a stored `qualification` and
an EMPTY `about_me` - the state the defect turns on. The pinned candidate's `about_me` changed
from `null` to `"I'm a Tester"` between being chosen and being run (somebody edited it), so the
section correctly rendered its table, the step's `isEmptyState === false` was trivially true,
and it went green.

- **A step that goes green on a lost premise is worse than one that fails**, because it retires
  the assertion silently - the run looked better, not worse. The neighbouring em-dash scenario
  had the same fixture drift on the same day and FAILED honestly, because it guards its premise
  (`expect(stats).toBeNull()`). That contrast is the whole lesson.
- The step now asserts BOTH halves of the premise first - a truthy `qualification` and an empty
  `about_me` - with a message that says to re-resolve the fixture rather than pointing at the
  app. It then fails on the real defect again, and the defect still reproduces (candidate 9127:
  `about_me: null`, `qualification: "STUDENT"`, section says "hasn't added their basic
  information").
- `VIEWPROFILE_STATUSONLY_CANDIDATE_EMAIL` is now left UNSET for the same reason as
  `_NOSTATS_`: both key on something the candidate has NOT filled in, which is the most
  volatile kind of fixture there is.

**2. `Basic Information should show a phone number or explain why it is unavailable` WAS
ASSERTING SOMETHING UNPROVABLE.** The agent's profile payload carries no phone field for
anybody, so as the agent there is no way to know whether a phone was ever entered - which makes
a `-` indistinguishable from a candidate who simply never supplied one, and THAT IS CORRECT
BEHAVIOUR. A step that cannot tell a defect from correct behaviour must not be a hard assertion.

- Replaced with what IS provable and is actually a stronger claim: the section renders five
  labelled rows and **three of them (Email, Phone Number, Nationality) have no corresponding
  field anywhere in the payload**, so they are permanently `-` for every candidate. Rendering a
  labelled row that can never hold a value is a defect whichever way the product resolves it.
- **The EMAIL half was always sound and stays a hard assertion**, because the value demonstrably
  exists: the listing the profile was opened from displays it. Measured:
  `iqra.farooq+80@bytecorp.io` on the row, `-` in the section.

**Two scenarios that looked red were neither**: `the profile offers exactly the five tabs on
every listing` and `Reminder History is reachable ... on every listing` appeared in one run's
failure screenshots and in NO run's report JSON - they were artifacts of the VS Code extension
auto-running the file concurrently. **Trust `reports/*.json`, not `reports/screenshots/`**, when
deciding what failed: a screenshot can outlive the run that wrote it if a second run raced the
pre-run sweep.

### Removed on 2026-09-17, by product decision - do not "restore" these

Five scenarios were removed on request. None was flaky and none was measuring wrongly, so what
each one found is recorded rather than deleted with it.

- **The four ACCESSIBILITY scenarios** - Back unreachable by keyboard, the header icon control
  having no accessible name, that control being inert, and the Document Verification row actions
  being mouse-only. All four are real WCAG level-A failures (2.1.1 Keyboard, 4.1.2 Name Role
  Value) and all four were measured with a real Tab walk **plus a control**. None of them blocks
  an agent working with a mouse, which is the practical argument for dropping them.
  - The page object KEEPS `auditKeyboard()`, `auditClickableIcons()`, `readHeaderActions()` and
    `probeHeaderIconButton()`, and `node scripts/probe-candidate-view-profile.js` still reports
    all of it - so re-measuring costs one read-only command and nothing has to be rewritten if
    they are ever wanted back.
  - Five step definitions went with them. A step nothing calls is indistinguishable from one
    whose scenario was lost by accident, which is why they were not left behind.
- **"a deactivated candidate's profile says the account is deactivated"** - this one was not a
  defect at all. The measurement stands (the profile says nothing about the account state and
  its pill reads "Unverified", the EMAIL VERIFICATION state), but the answer to the
  `@needs-clarification` question it carried is that the deactivated state belongs to the
  Deactivated LISTING and is not repeated on the profile. It was asserting a requirement nobody
  wrote - the same test the search-by-Major and unlimited-usage-promo scenarios each failed.

**About Me: the step was WIDENED, because there are two places it can land and pinning one was a
guess.** It was reported that About Me shows under the candidate's name rather than in Basic
Information. Measured on two candidates, both are true depending on the candidate:

| candidate | `about_me` | `headline` | under the name | Basic Information |
| --- | --- | --- | --- | --- |
| 10849 | `"nil"` | `"nil"` | **yes** | **yes** |
| 10880 | `"I am SDET"` | `null` | no | **yes** |

So the line under the name is `headline`, the Basic Information row is `about_me`, and one
candidate carries the same text in both. **Which of the two the CANDIDATE PORTAL writes when they
fill in About Me has never been measured** - that e2e scenario has never run, because it needs a
candidate of this agent whose password the suite knows (`VIEWPROFILE_E2E_*`, still empty).

`Then the agent's profile should show the About Me I just saved` therefore asserts the rule worth
having - the text reaches the agent - and ATTACHES which surface carried it plus both payload
fields. Pinning Basic Information would go red on a correct build if the candidate portal writes
the headline; pinning the header would go red on the reverse. The first real run settles it, and
the attachment says what to tighten it to.

### Document Verification: what the tab actually does (MEASURED 2026-09-17)

The documents the CANDIDATE uploaded on their own portal, as their agent sees them. Coverage went
from three scenarios (listed / status label / an accessibility audit) to twelve, because the
three said nothing about what an agent comes to this tab to DO.

| | |
| --- | --- |
| row | `.document-list-item` inside `.documents-list-items-container`, grouped Education / Work Experience / Certifications |
| row contents | file-type icon, file name (a real `<button>`), `.status-badge-label` pill, "Uploaded on <date>" |
| row actions | **two** bare `<svg>` in a sibling `[margin-inline-start:auto]` container: **[0] View, [1] Download** |
| empty state | **one line PER GROUP**, no tab-level message - `No education documents uploaded yet.` / `No work experience documents uploaded yet.` / `No certification documents uploaded yet.` |
| View -> | a dialog titled **"Document Verification"**. The URL does not change and **no request is fired** |
| the dialog | the preview, a zoom level between `Zoom out` and `Zoom in`, a `Download` button, and Document Information: Document Name / Document Type / Date Uploaded / Status / **Version** |
| zoom | 100 -> 125 -> 150 stepping in; floor **50**, where `Zoom out` is **disabled** |
| Download | delivers the file and **leaves the dialog open** |
| close | `aria-label="Close"`, and Escape also closes it |
| decisions | `Request Revision` + `Approve`, **only when Status is "Needs Review"** |

- **>>> THE ROW READER NEVER REACHED THE ACTIONS, AND WOULD HAVE PASSED HAVING INSPECTED
  NOTHING. <<<** `readDocumentGroups()` derived a row by climbing from the "Uploaded on" line to
  the nearest ancestor holding a `<button>` - and **the file name is itself a button**, so the
  climb stopped one level early, inside the details column and outside the actions container.
  Every row came back `iconControls: []` on a tab that renders two actions per row. Rows now come
  from the app's own row class. Same class as the community module's `readMemberCards()`
  answering a constant 7 for a list of 12.
  - Note the container is **plural** (`documents-list-items-container`) and the row **singular**,
    so a `[class*="list-item"]` union matches both and a one-row group resolves to two elements -
    the exact trap that cost a fixture entry in the candidate-portal module.
- **THE VERSION IS AN INTEGER ON THE PAYLOAD AND RENDERS AS `v<n>.0`.** Measured across three
  documents of one candidate: `version: 1` -> **v1.0**, `version: 3` -> **v3.0**. So when an
  agent requests a revision and the candidate uploads a replacement, the number the agent is
  shown goes up - which is how they tell a replacement from the copy they sent back.
  - The suite asserts the rendered version **against the stored one**, read-only. A viewer that
    hardcoded "v1.0" would look perfectly healthy without that check, because two of the three
    documents measured really are version 1.
  - **The INCREMENT itself is not asserted here** and that is deliberate: it needs a real
    revision decision plus a candidate re-upload, i.e. an irreversible decision and a candidate
    password the suite does not hold. It belongs to `features/AI Document Verification/`, which
    already owns that chain and already pays for it. Duplicating it here would be a second
    implementation that drifts.
- **THE DECISION GATING IS ASSERTED IN BOTH DIRECTIONS, AND THE STEP REFUSES TO PASS WITHOUT
  BOTH CASES.** A "Needs Review" document must offer Approve and Request Revision; an Approved or
  Revision Required one must not (measured: it offers only Close / Zoom out / Zoom in /
  Download). The step therefore needs one of each on the same candidate, and **fails naming the
  fixture if it does not get them** - a gating rule checked against documents that are all in one
  state proves nothing and would go green for exactly the reason the Basic Information scenario
  did on a drifted fixture.
- **`flaggedFor` USED TO SWALLOW THE COMMENT HISTORY.** A decided document also renders a
  **Comment History** block - the stored comment, its author (**"AI review"** on an AI finding,
  "Agent" on an agent's note) and a timestamp - and a reader slicing from "Flagged for" to the
  end returned all of it as AI findings. It was invisible because the slice stopped at the
  decision buttons, **which a decided document does not have** - so it mis-read exactly the
  documents it was most likely to be asked about. The two blocks are read separately now.
- **Two new fixture keys, both deliberately UNSET** (`VIEWPROFILE_NODOCS_CANDIDATE_EMAIL`,
  `VIEWPROFILE_MIXEDDOCS_CANDIDATE_EMAIL`): each is keyed on a state the product moves out of -
  one upload ends "has uploaded nothing", one approval ends "holds a document needing review" -
  so pinning either is the DATE-08 mistake. Unset, the step scans and attaches which candidate it
  drove.
- **`node scripts/probe-candidate-view-profile.js`** now walks the viewer too (section 6b),
  opening each document, reading the dialog beside the payload behind it, and closing it.
  `--no-viewer` skips it, `--zoom` also exercises the zoom. **It never clicks a decision
  control.**

### >>> THE LOGIN STALLS ON /login WITH NO ERROR, AND A BIGGER TIMEOUT IS THE WRONG FIX <<<

Measured across three full runs of this feature: **2 of 45**, then **0 of 45**, then **1 of 45**
scenarios died in the Background with
`page.waitForURL: Timeout ... waiting for navigation until "commit"`. Every one passed
immediately when re-run alone, so the login SUCCEEDS on a retry - the attempt simply never
completes.

**The first fix attempted here was to raise the wait 60s -> 120s. IT DID NOT WORK**: the next run
blew through 120s on a different scenario. A stalled attempt never completes however long you
wait; a bigger timeout only makes the run slower before reporting the same thing. That wrong turn
is recorded because the failure message invites exactly it.

**`steps/change-password.js` had already diagnosed this and written down the remedy** - *"This
environment occasionally stalls a login (stays on /login with no error) - those attempts are
retried rather than treated as a failure"* - so the `signIn()` this file used was that pattern,
not a new invention. **Look for an existing hardened login before writing a wait.**

**>>> IT NOW LIVES IN `utils/resilientSignIn.js`, AND THIS FILE ONLY WRAPS IT (moved
2026-09-21). <<<** It was a module-local function here, while `steps/active-candidate.js` - whose
`I am logged in as an agent` is the Background of the Active, Requires Attention AND Deactivated
features - still had a bare `waitForURL` and no retry at all. So the fix existed and three
features went on failing for want of it; `candidate-deactivated.feature` lost a scenario to the
same stall on its first run. There is one implementation now, `signIn()` here is a thin
positional wrapper around it, and every call site is unchanged. **Do not write a fourth login.**

Each attempt is bounded at 30s and classified:

| observed | verdict |
| --- | --- |
| the URL left `/login` for an expected route | accepted |
| an error is on screen (`invalid`, `credentials`, `too many ... attempts`, `try again in N minute`) | **rejected - fails NOW** |
| still on `/login`, nothing said | stalled - re-navigate, re-fill, re-submit (3 attempts) |

- **A rejection must not be retried**, and that is the one thing this borrows most directly:
  failed sign-ins are rate limited on this backend
  (`401 "Too many failed sign-in attempts. Try again in 59 minute(s)."`), so retrying a wrong
  password deepens a lockout and turns one fixture problem into a whole unusable run. Lockout is
  checked in the same branch as rejection for that reason.
- A retry that succeeded is **attached to the report**, so a run that needed one is visible
  rather than silently slower.
- It is a REDUCED version of change-password's: that file walks several candidate PASSWORDS
  because it rotates one. Here there is a single known password, so the only thing retried is
  the stall.
- All four sign-in sites in the file go through it - the agent Background, the candidate login
  and the agent re-login in the end-to-end scenario, and the candidate re-login in the restore
  hook. A hook that cannot sign in cannot restore the fixture it changed.

### FOUR SUITE DEFECTS THE FIRST FULL RUN EXPOSED, ALL FIXED

Every one would have been read as a product defect, and three are classes this repo has paid for
before. Recorded because the diagnosis is the reusable part.

1. **>>> THE WIDGET VALUE RENDERS ABOVE ITS LABEL, SO THE HEADER READER WAS OFF BY ONE. <<<**
   The identity block reads `[name, pill, (headline), location, "0%", "Track Progress", "0",
   "Courses Completed", ...]`. `readHeader()` cut the identity lines at the first widget LABEL,
   which leaves the first widget's VALUE among them - and for a candidate with no headline that
   shifts everything by one: measured on all three listings, `headline` came back as the location
   and `location` as `"0%"`. The step then reported the header as disagreeing with the payload on
   a header that is entirely correct. It now cuts at `firstWidgetLabel - 1`.
2. **>>> READING A RESPONSE BODY IS ASYNCHRONOUS AND PLAYWRIGHT DOES NOT AWAIT AN EVENT
   HANDLER. <<<** `await page.waitForResponse(...)` resolves when the response ARRIVES, not when
   the handler has parsed it, so two scenarios read `profilePayload()` as `null` on a profile
   that had loaded perfectly well - and reported that the profile "was not fetched" and that "no
   payload was captured", which reads as the app not making the call. Every parse is now tracked
   as a promise and `flush()` awaits the outstanding ones from each settle point.
3. **>>> THE ACTIVITY READER DE-DUPLICATED BY CONTENT AND UNDER-COUNTED 10 ROWS AS 5. <<<**
   See the section above - and note the second-order danger: because this tab discards the time,
   genuinely distinct rows render identically, so de-duplicating on text hides real activity and
   would have let "every entry the server returned is rendered" pass with half of them missing.
   **Same class as the community module's `readMemberCards()`.**
4. **>>> THE TWO LABELLED SECTIONS ARE MARKED UP DIFFERENTLY AND TWO READERS EACH BROKE ON THE
   OTHER. <<<** See "readLabelledFields" above. Both versions reported fields as missing from
   sections that render them.

**A fifth was not a suite defect but a FIXTURE one, and the step caught it correctly:** the
`noStats` candidate acquired statistics between being pinned and being run, so the em-dash
scenario failed saying *"the resolved fixture HAS stats, so nothing is under test"* - the step
refusing to assert rather than passing vacuously, which is exactly what it should do. See the
fixture note below for why that one key is deliberately left unpinned.

### FOR THE PO: the co-op programme is spelled two ways in one product

`Interested Programs` renders **"Co-Op"** (capital O) while the Work Experience section renders
**"Co-op"** for the employment type of the same name - measured on one candidate showing
`Co-Op, Tamheer`. The Work Preferences assertion therefore matches the programme names
**case-insensitively** and attaches the inconsistency: pinning either spelling would make the
step red on a capitalisation nit and bury the assertion that matters, which is whether the
programme the candidate opted into is listed at all.

### Fixtures: pinned in `.env`, resolved by scan when unset

Eight `VIEWPROFILE_*_CANDIDATE_EMAIL` keys, each a candidate of `AGENT_EMAIL` chosen for a
PROPERTY that is invisible in the listing grid - a headline, a photo, populated statistics, an
empty `about_me`. **Every key is optional**: with one unset the step scans the listing, reads each
candidate's payload and takes the first that satisfies the property, then attaches which one it
drove plus the `.env` line to pin it. So a fresh checkout runs, and a pinned fixture is what makes
a red row reproducible.

Nothing here is spent or mutated - the screen is read-only.

**The subscribed candidate cannot be resolved from the profile payload at all** (it carries no
subscription data; the Subscription tab fetches its own), so that subject is chosen from the
listing's Subscription Status column instead - and **"Not Subscribed" contains "Subscribed"**, so
the negative is excluded explicitly or the scenario picks an unsubscribed candidate and then
fails against a correct empty state.

**>>> `VIEWPROFILE_NOSTATS_CANDIDATE_EMAIL` IS DELIBERATELY LEFT UNSET, AND THAT IS NOT AN
OVERSIGHT. <<<** "Has no computed statistics" is a state the product LEAVES, not one it keeps: a
candidate pinned there today has statistics tomorrow once the track engine has run. It WAS
pinned, and went stale within hours of being measured. Unset, the step scans for a candidate
whose payload really holds `stats: null` (20 of 30 did at last count) and attaches which one it
drove. **Never pin a fixture on a property the product is in the process of removing** - same
lesson as the `DATE-08` certificate fixture that expired overnight.

**The `@mutates-profile` scenario's two keys are deliberately left EMPTY.** It needs a candidate
of this agent whose PASSWORD the suite knows, and none of the pinned fixtures qualify - they were
created by earlier runs and their passwords were never recorded. The step fails with an explicit
message naming the two keys, which is honest; a guessed password would fail as an unexplained
login timeout.

### >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT `{ timeout }` <<<

`features/support/hooks.js` calls `setDefaultTimeout(60000)`, and **that overrides every profile's
own `timeout`** - this profile asks for 300000 and gets 60000. A step that opens three profiles
across three listings is many times a normal step's work, so it is killed part way and reports
`function timed out`, which says nothing about the app and hides however many table rows had
already passed. **Measured on the very first run of this file**: the three-listing step died at
exactly 60s.

An internal wait longer than the step budget is not a slow test, it is a test that **cannot
pass**. This is the fourth place in the repo to hit it (Contact Us hit it three times). **Give any
new multi-subject step here a budget bigger than the work inside it** - the constants are `SLOW`,
`TABLE` and `AUDIT` at the top of the step file.

### The findings this module exists to surface

**7 findings across 3 `@known-issue` scenarios** (it was 8 across 9 before the removals of 2026-09-17 and the Nationality withdrawal of 2026-09-22) - finding 5 is split in two, because "the
control has no name" and "the control does nothing" are different defects with different fixes
and one scenario reporting both could not say which. Every one is measured, and each has its own
scenario so a red row names one thing. The accessibility ones are
`@known-issue @needs-clarification` because no AC settles them.

Verify the list with `npx cucumber-js -p candidateViewProfile --dry-run --tags "@known-issue"`,
which is how to re-check it rather than trusting this prose.

1. **Basic Information is gated on `about_me` ALONE.** With it empty the section renders
   *"Nothing here yet / This candidate hasn't added their basic information"* and **hides the
   Current Status the candidate did provide**. Controlled comparison over four candidates, all
   with `qualification: "STUDENT"`: the two with a non-empty `about_me` render the full
   five-field table, the two without render the empty state. **This is not an empty-state rule -
   it is a populated section refusing to render**, which is why it is covered although empty
   states are otherwise out of scope here.
2. ~~Email and Phone Number always render `-`.~~ ~~PARTLY FIXED - ONLY NATIONALITY IS LEFT.~~
   **>>> WITHDRAWN ENTIRELY 2026-09-22: THERE IS NO DEFECT HERE, AND THE SUITE WAS LOOKING IN THE
   WRONG PLACE. <<<** The claim that "the payload has no field for Nationality" was measured by
   testing `Object.keys(payload)` - the **TOP LEVEL ONLY** - and the contact fields are nested
   under `user`. Measured directly:

   ```
   user.* = id, public_id, firstname, lastname, profile_image, email, phone_number, nationality
   user.email        "faran.mustafa+26@bytecorp.io"  -> rendered as the address
   user.phone_number null                            -> rendered "-"  (candidate never added it)
   user.nationality  null                            -> rendered "-"  (candidate never added it)
   ```

   So the product is **correct**: it shows what the candidate filled in on their own portal and
   marks the rest unset, which is the product's own documented convention for an unset field. The
   candidate portal captures nationality as `user.nationality` through a combobox
   (`CandidateDetailsPage.nationalityField()`), so the two portals agree.

   **The scenario was reframed as the LINKAGE rule rather than deleted** - `Verify that Basic
   Information shows what the candidate filled in and marks the rest unset`, `@positive`, driving a
   `| field | payload field | enum |` table and asserting BOTH directions per row: a field the
   candidate stored must be rendered with that value, and a field they left empty must render the
   placeholder rather than a value from anywhere else. That is strictly stronger than what it
   replaced and it passes (7/7).

   **The lesson is the one this repo keeps paying for**: a reader that looks in the wrong place can
   only ever answer "absent", and absence read as a defect is how this sat `@known-issue` against a
   correct build. Resolve a payload field by PATH, never by top-level key.
3. ~~A deactivated candidate's profile says nothing about being deactivated.~~ **NOT A DEFECT,
   and its scenario was REMOVED on 2026-09-17.** The measurement stands - the pill reads
   "Unverified", which is the candidate's EMAIL VERIFICATION state - but the product answer to
   the `@needs-clarification` question it carried is that the deactivated state belongs to the
   Deactivated LISTING and is not repeated on the profile. So it was asserting a requirement
   nobody wrote.
4. **`Back` is unreachable by keyboard.** It is a `<p class="... cursor-pointer">` at
   `tabIndex -1` that **cannot be focused even by calling `focus()` on it**. Measured with a real
   60-press Tab walk **plus a control** (Reminder History must focus, or "nothing focused" is
   just a broken walk). WCAG 2.1.1 (A) and 4.1.2 (A).
   **>>> ITS SCENARIO WAS REMOVED ON 2026-09-17 ON REQUEST. The finding is real and is kept here
   as a record; nothing asserts it any more. <<<**
5. **The header's icon-only button has no accessible name AND is completely inert.** It carries a
   link/chain icon, is focusable, and announces only "button". Verified inert four ways with
   everything instrumented BEFORE the click: no `navigator.clipboard.writeText`, no
   `document.execCommand('copy')`, no request, no navigation, no dialog, no toast. **A control
   with no name that does nothing.**
   **>>> BOTH ITS SCENARIOS WERE REMOVED ON 2026-09-17 ON REQUEST. Kept here as a record. <<<**
6. **Every Document Verification row action is unreachable without a mouse.** Two per row -
   **View** and **Download** - each a bare `<svg aria-hidden="true">` outside any button or
   anchor with a parent at `tabIndex -1`. So the Tab key never lands on one (verified by a real
   50-press walk **plus a control**, on a page whose file-name buttons DO focus), Enter and Space
   do nothing, and `aria-hidden` also removes them from what a screen reader announces. An agent
   who does not use a mouse cannot open or download a single candidate document; the only
   reachable control on a row is the file name, **and clicking that does nothing at all**.
   Measured 2026-09-17: 6 of 6 on a three-document candidate. WCAG 2.1.1 Keyboard (A) and 4.1.2
   Name, Role, Value (A). Same defect class as the dashboard's "View all" spans and the
   candidate-profile upload controls being bare `<svg class="add-icon">`, so it is probably one
   component fix rather than three.
   - **>>> ITS SCENARIO WAS REMOVED ON 2026-09-17 ON REQUEST, ALONG WITH THE THREE CHROME ONES.
     The finding is real and is kept here as a record; nothing asserts it any more. <<<** Before
     it went it was reworded to **"Verify that the View and Download actions can be operated
     without a mouse"**, because "reachable by assistive technology" was not something anyone
     could act on without first being told what it meant.
   - **The controls THEMSELVES work with a mouse, and every other Document Verification scenario
     passes** - it was one scenario's worth of red beside eleven green.
   - `node scripts/probe-candidate-view-profile.js` still reports all four findings, and the page
     object keeps `auditKeyboard()`, `auditClickableIcons()`, `readHeaderActions()` and
     `probeHeaderIconButton()`, so re-measuring costs one read-only command.
7. **The Activity Log duration is written nowhere a reload can restore it.** It is sent as the
   `duration` API parameter and never reaches the URL, so a filtered view cannot be shared or
   reloaded and the agent silently drops back to "Last 24 hours". Inconsistent with the rest of
   the product, where `activeFilter=`, `search=` and `severity=` are all in the URL.
8. **An unrecognised `?selectedTab=` value leaves NO tab selected AND renders no panel.**
   `?selectedTab=not-a-real-tab` gives 0 of 5 tabs checked and an empty body, so the agent gets
   the header, the widget row and a tab strip above nothing. **It is the same defect the
   CANDIDATE's own profile has** (recorded under "Candidate Details"), which makes it a shared
   routing gap rather than two separate bugs. An EMPTY value falls back correctly - the app
   rewrites the URL to `?selectedTab=candidate-details` - so the fallback exists and simply does
   not cover an unknown value.
   - **>>> THE CONTROL IS ITS OWN SCENARIO NOW, NOT THE FIRST HALF OF THIS ONE (2026-09-17).
     <<<** It used to run first inside it, because the candidate-portal twin had it second and
     Cucumber's abandon-at-first-failure meant the control had never once executed - a diagnosis
     resting on a measurement nobody was taking. Ordering only postponed that hazard: any red
     step ahead of it would skip it again. Split out as `Verify that an empty tab slug falls
     back to the Candidate Details tab` (`@positive`), it runs and passes on every routine run
     whatever the defect beside it does, which is this module's own stated rule - a red scenario
     merged into a green one takes the green assertions down with it.
   - **The expectation is the DEFAULT tab, not "some tab".** Both scenarios end on one step,
     `the profile should fall back to the "Candidate Details" tab with its panel rendered`.
     Asserting only that one of five tabs is chosen would go green the day an unknown slug
     landed on Activity Log, which is not the behaviour anybody asked for.
   - **That step collects all three facts and throws once** - how many tabs are selected, which
     one, and whether a panel rendered - because they fail INDEPENDENTLY and the live defect
     fails all three. As consecutive `Then`s only the first would ever be reported, and "the
     strip is there but nothing is chosen" and "nothing is shown at all" send a developer to
     different places.
   - **>>> THE PANEL CHECK MUST NOT BE A TEXT SCAN OF `main`, BECAUSE `main` CONTAINS THE TAB
     STRIP. <<<** The first version tested the body for `/Subscription Details|Activity Log|
     Uploaded on/`, and `Activity Log` is a tab LABEL - so it answered *"a panel rendered"* for
     a 226-character body that was entirely chrome, i.e. it would have passed vacuously on the
     very defect it exists to report. It delegates to `waitForTabBody()`, the page object's own
     per-tab readiness, which is structural for Candidate Details (`Basic Information` is
     present or it is not). Same class as `readMemberCards()` and the promo save-toast locator:
     **a reader that cannot fail is worse than one that answers "absent".**

**Questions for the PO**, each attached to the report by the step that measures it rather than
failed on: should "Total Fee" be labelled "Amount Paid"; should the Activity Log render the time
it holds; should its empty state stop saying "Your"; and should Reminder History show
`display_title` rather than the candidate-facing `title`.

## Agent Portal Dashboard (`features/Agent_Portal/Dashboard.feature`)

The agent's landing page at `/dashboard`: the KPI band and its period selector, the Document
Verification Queue, the Requires Attention card, the Active Candidates card and the header around
them. Added 2026-10-01; the file had held a fully commented-out draft whose scenarios never ran.

- **`npm run test:dashboard`** (`-p agentDashboard`) - all 32 scenarios.
- **`npm run test:dashboard:read-only`** (`-p agentDashboardReadOnly`) - the 29 that change
  nothing. **Those same 29 are IN the default `npm test` run.**
- Steps: **`steps/dashboard.js`** (+ the shim). Page object: **`pages/DashboardPage.js`**, EXTENDED
  - PART 1 (the header/avatar locators login, logout, change-password and 2FA use) is unchanged.
  Its `install()` request log runs from `hooks.js` AND `PagesFixture.js` before the first navigation.
- **`node scripts/probe-agent-dashboard.js`** is the read-only probe behind the measurements.
- **Figma (node 548-3842) could NOT be read** - the connector needs edit access and the browser gets
  a 403 without a Figma session. So no scenario asserts Figma layout or copy yet; every wording
  assertion is the build's measured text. When screenshots/access arrive, add the Figma layer and
  turn any divergence into a `@known-issue`.

### What is deliberately NOT covered here (it lives elsewhere and must not be duplicated)

The welcome modal and the onboarding chooser (`invite-candidate_welcome_onboarding.feature`),
Referral Codes copy/share and every promo state of that widget (`Referral-Codes.feature` - including
the expired-promo-not-marked case), the three "View all" links' routing and keyboard reachability
(`Invite-candidate.feature`), the review panel's viewer/zoom (`verifications.feature`) and the
profile's contents (`candidate-view-profile.feature`). The review panel's readers and its GUARDED
decision methods are reused from `AgentVerificationsPage` - the duplicated submit test id is
guarded in one place and must stay that way.

### Expected baseline (MEASURED 2026-10-01, headless, serial)

- `npm run test:dashboard:read-only` - **31 scenarios, 22 passed / 9 failed** (DERIVED: measured at
  32 / 22 / 10 in 9m 06s, then the keyboard-tooltip scenario - one of the reds - was removed by
  request). **All 9 reds are `@known-issue`** and nothing else is red. Check with
  `npx cucumber-js -p agentDashboard --dry-run --tags "@known-issue"` (9).
- The 3 costly scenarios, run separately: **3 passed** - the throwaway-agent one (1m 20s, minted
  `iqra.farooq+dashzeromuphwwr31@bytecorp.io`) and both decisions (1m 29s for the pair; ORG-03 rows
  26737 -> REVISION and 26738 -> APPROVED). A brand-new agent's target is **10**, not 4.

### Two tags excluded from the default run, both added with this feature

| tag | what it costs |
| --- | --- |
| `@commits-decision` | uploads ONE ORG-03 document as `DOC_CANDIDATE` and commits an IRREVERSIBLE Approve / Request Revision on THAT document only. A document row cannot be deleted. |
| `@creates-agent` | mints a throwaway agent (live superadmin invite + IMAP). An agent cannot be deleted. Also `@provision`, so `test:provision` picks it up. |

Both are in `cucumber.js`'s default exclusions AND `configs/playwright.config.js`'s `UNRECOVERABLE`
and `SERIAL_TAGS`, added in the same change.

### The surface, measured (2026-10-01, AGENT_EMAIL)

| | |
| --- | --- |
| stats | `GET /candidate/stats/?period=monthly\|quarterly\|yearly\|year-to-date` (note the hyphens) |
| queue | `GET /candidate/documents/all/?page=1&page_size=5&status=AWAITING` - newest first, server order kept |
| requires attention | `GET /candidate/requires-attention/?page=1&page_size=5` |
| active | `GET /candidate/active/?page=1&page_size=6` |
| identity | `GET /auth/me/` - name, email, `agent_code`, `promotion` |
| avatar menu | Account Settings -> `/settings`, Become a Candidate -> confirm dialog (Stay Here / Become a Candidate), Referral Codes -> `/dashboard#referral-codes`, Log out |
| period | NOT in the URL; a reload reopens on Monthly. A period already fetched re-renders from cache with NO request |

### >>> THE KPI TILES ARE PERIOD-SCOPED - ON THE 1ST OF A MONTH THEY ALL READ 0 <<<

`period=monthly` counts only candidates added this month. On 2026-10-01 every tile read 0 while
the cards below listed 39 active candidates. Tiles and cards are DIFFERENT figures; no scenario
compares them. Every KPI assertion compares the render against the stats payload behind it.

### Findings - each its own `@known-issue` scenario

1. *(NOT a defect - product rule confirmed 2026-10-01)* **The welcome modal is MONTHLY.** It shows on
   every sign-in while the CURRENT month has no invited/onboarded candidate - even for an agent with
   candidates from earlier months - and stops for the rest of the month once one is added. Two
   passing `@positive @mocked` scenarios lock both directions in, each across two new sessions.
2. **The target and comparison labels never follow the period** - Quarterly/Yearly/Year to Date still
   read "% of Monthly Target" and "vs last month" while the figures change correctly. The scenario
   drives ALL FOUR periods against the labels each should carry (Monthly is the passing control);
   the expected wordings for the other three are an ASSUMPTION pending Figma. The target is
   4 for every period, so Yearly reads "563/4 - 14075% of Monthly Target".
3. **A failed figures load leaves the target line presenting figures** - "% Behind of Target" with no
   number, "0% of Monthly Target", "0/0". The tiles themselves handle it correctly ("-" / "No data
   available"), which has its own passing scenario.
4. **A failed section-card load is presented as an empty account** - all three cards show their
   empty-state copy on a 500, and the Active card even offers "Invite Candidates".
5. *(NOT defects - product rules confirmed 2026-10-01)* **Names and file names are not entry
   points.** A queue row's file name opens nothing - only Review opens a document, now a passing
   scenario. The Requires Attention names and the Active grid's name/email are not meant to do
   anything either; those two scenarios were removed as irrelevant. All asserted by watching a window for
   a navigation, popup or request - an absence is never sampled once.
6. *(removed from this file - the same help-icon defect is owned by `candidate-deactivated.feature`)*
7. **The Active Candidates grid re-sorts the server's page by name** (same as Verifications).
8. **The En language control does nothing** - no menu, the page stays `en-US`/`ltr`.

Recorded, NOT asserted (scenarios removed 2026-10-01 by request or as out of scope): the target
tooltip opens on hover but NOT on keyboard focus; and `GET /dashboard` answers HTTP 404 because the
SPA is a 404 fallback on EVERY route - a hosting finding, not a dashboard one. Also removed as
duplicates: the decision-dialog reason gate and the panel's View-profile journey (both owned by
`verifications.feature`).

Also seen, NOT asserted here because another file owns it: `AGENT_EMAIL`'s own promo PROMOMZFVYB
expired 2026-09-30 (`auth/me` -> `is_active: false`) and the widget still offers Copy/Share.

### Traps found while building it

- **Playwright's `hasText` reads text content with NO spaces between elements**, so a row reading
  "Ghazan Ahmed / Warning" is `"Ghazan AhmedWarning"` and `/\bWarning\b/` never matches. The first
  run reported 0 Requires Attention rows on a card listing five. Rows are derived structurally now.
- **The target tooltip needs a pointer to ENTER the control** - a mouse already resting on it opens
  nothing, so `hoverTargetInfo()` moves away first.
- **A menu closed by Escape is still attached while it animates out**, so its items resolve and
  cannot be clicked; `chooseAvatarItem()` waits for it to go and opens it fresh.

### >>> FIXED ALONG THE WAY: FIVE `utils/` FILES RESOLVED PATHS ONE LEVEL ABOVE THE REPO <<<

Same class as the `envWriter.js` bug recorded under Change Password. Moving the helpers into
`utils/` left `path.resolve(__dirname, '..', '..', ...)` pointing at `C:\Users\Byte\Documents`:

- `utils/docVerificationFixtures.js` - **every AI Document Verification upload failed** with
  "A test-document folder does not exist" (`Files/Test_doc` was looked for outside the repo).
- `utils/videoRecorder.js`, `utils/tracer.js` - failure videos and traces were written to
  `C:\Users\Byte\Documents\reports`, where the HTML report's links and the pre-run sweep never look.
  That stray folder is a leftover and can be deleted.
- `utils/aiFindingsLog.js`, `utils/docVerificationReport.js` - their reports, likewise.

Also fixed: **`steps/verifications.js` imported `@cucumber/cucumber` directly** instead of
`../fixtures/bdd`, which stopped `bddgen` generating ANY feature for playwright-bdd.

## Agent Portal Activity Log (`features/Agent_Portal/activity-log.feature`)

The agent's own activity trail at `/activity-log`, and specifically its two controls: the
**SEARCH** box and the **DATE-RANGE filter**. Added 2026-09-21.

**WHAT KINDS of event belong on this page is deliberately OUT OF SCOPE** - no scenario here
asserts that a particular event type is or is not logged. Everything in the file is about
finding and narrowing whatever the page holds. That coverage is a separate piece of work.

- **`npm run test:activity-log`** (`-p activityLog`) - the whole file, 17 scenarios.
- **It is IN the default `npm test` run**, exactly as `@requireAttention` and
  `@candidateDeactivated` are, and nothing excludes `@activity-log`. **That is safe because the
  page has no write control of any kind**: the toolbar holds a search box and a dropdown, and
  the list has no row action at all - not even a View. So no scenario can change an account,
  spend a fixture, send an email or make a payment. There is no cleanup hook because there is
  nothing to clean up.
- Steps live in **`steps/activity-log.js`**; the page object is **`pages/ActivityLogPage.js`**,
  wired into `features/support/hooks.js` AND `fixtures/PagesFixture.js` (one for each runner -
  there is no auto-discovery in either) and picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- **`node scripts/probe-activity-log.js`** is the read-only probe behind every string, param and
  measurement below. It writes nothing and can be re-run freely. **Re-run it rather than
  reasoning about the DOM.** It drives the real page object rather than its own copy of the
  readers, on purpose: a probe with its own readers can agree with itself while disagreeing with
  the suite, which is how the community module's `readMemberCards()` under-count went unnoticed.
  `--no-scroll` skips the infinite-scroll walk.

### >>> ONE SCENARIO PER BEHAVIOUR: CONSOLIDATED 32 -> 17 ON 2026-09-22, WITH NO ASSERTION LOST <<<

The file was written as roughly one scenario per ASSERTION. Every scenario costs a fresh browser
context and an agent login, so several scenarios arriving at the same page to look at the same
state were paying several times over for one observation - the same waste `features/Promo_Code/`
(61 -> 32), the community module (49 -> 43) and `Contact-us.feature` (19 -> 11) each corrected.

Where a rule has independent CASES they are now driven from a data table by ONE step that walks
every row, collects every failure and reports them together. Cucumber abandons a scenario at its
first failing step, so N scenarios produce N red rows without ever saying whether they share a
cause.

| section | was | now | what was merged |
| --- | --- | --- | --- |
| the page and its controls | 3 | 1 | the two controls, the six ranges the filter offers, and the range it opens on - all read from one page load |
| the date-range filter | 7 | 4 | the monotonic walk absorbed "the list matches the server" (it already drove all six ranges); re-selecting the applied range and dismissing the popover became one "a no-op changes nothing"; the two unusable URL values became one table |
| the search | 10 | 6 | narrowing + both params + render fidelity from one search; the no-match state, the list being replaced, and clearing to restore it became one journey (now in section 5) |
| search + range together | 3 | 1 | the three compose/survive claims, plus the end-to-end scenario that was re-walking the same path |
| the empty state | 2 | 2 | the no-match journey moved in; the `@known-issue` wording scenario stays alone |
| paging | 4 | 2 | the absent pagination control is only CORRECT because scrolling pages the list, so the two are asserted together; and the two reset triggers share one scroll setup |
| end to end | 3 | 1 | the reload and the shared-link open are two halves of one claim about the URL |

**Merging the pagination pair matters more than the arithmetic suggests.** Reading the missing
control on its own and reporting "10 of 514 entries are unreachable" was very nearly filed before
the scroll was measured - it is the same shape as the candidate dashboard's "Your Documents"
block, which really IS capped. The difference is one measurement, and it now sits in the same
scenario as the claim it justifies.

**NOTHING WAS DROPPED, and that is checked rather than asserted.** Every step definition in
`steps/activity-log.js` is still reached by a feature line - 59 definitions, 0 unreachable. Two
steps went and one arrived: `I open the Activity Log with the date range` and `the Activity Log
should still list entries or show its empty state` were replaced by the collecting table step,
which asserts the control's label, the value that reached the server, AND that something
rendered - three facts that fail independently, where the old pair checked two of them in
separate scenarios.

**WHAT IS DELIBERATELY NOT MERGED:**

- **the `@known-issue` empty-state scenario.** It fails on purpose, and merged into the no-match
  journey it would take those green assertions down with it at the first failing step.
- **the two `@needs-clarification` findings** (the whitespace-only search, and the search matching
  the actor). Each is the only place its measurement is attached for the PO, so burying either
  inside a larger scenario would lose the report it exists to make.
- **the unsafe-term scenario**, which is the one place a native dialog and script injection are
  watched for - it has to be able to go red on its own terms.

### Expected baseline (MEASURED 2026-09-21)

`npm run test:activity-log` - **MEASURED 2026-09-22, after the 32 -> 17 consolidation:
17 scenarios, 16 passed / 1 failed, 197 steps, 5m 18s** (headless, serial).

The run before the merge was **32 scenarios, 31 passed / 1 failed, 301 steps, 7m 17s** - same one
red, same coverage, 15 fewer browser contexts and logins.

**>>> RE-MEASURED 2026-10-01: 17 scenarios, 17 passed, 197 steps. <<<** The `@known-issue` below was
FIXED by the product, and the two empty-state scenarios had gone red against the fix for two SUITE
reasons, both since corrected:
- **`readEmptyState()` knew only `.section-empty-state`.** The fix renders a DIFFERENT component - a
  bare `<section>` with an `<h3>` "No results found", one `<p>` worded per cause (`...your current
  search.` / `...current filters.` / `...search and filters.`) and, only when a non-default range is
  applied, a "Clear all filters" CTA. The reader answered null and reported a working empty state as
  missing. It now finds either component structurally, and so does the settle locator.
- **The SEARCH step chose its branch from the Background's first load**, treating `count === 0` as
  "the account is genuinely empty". That load is the DEFAULT RANGE (Last 7 days), which was empty
  that week on an account holding hundreds of entries - so it demanded the tab-level copy for a list
  emptied by the search. The branch is gone: a search is applied, so the message must name it.
- **Last 7 days and Last 24 hours can legitimately be EMPTY on `AGENT_EMAIL`.** Do not assume the
  default range holds rows; the scenarios that need rows select "This year".

The text below is the pre-fix record. A green
run means exactly that one is red and nothing else is. Verify the list with
`npx cucumber-js -p activityLog --dry-run --tags "@known-issue"` rather than trusting this prose.

Type tags partition the file exactly once each: **11 `@positive`, 4 `@negative`, 2 `@edge-case`**
(1 of the positives also carries `@smoke`, and 2 scenarios carry `@needs-clarification` alongside
their type tag).

### The surface, measured

| | |
| --- | --- |
| route | `/activity-log` - no redirect, and **no query param written until one is changed** |
| heading | `Activity Log` (an `<h1>` wrapping a `tabindex="-1"` `<button>`) |
| toolbar | a search box and a date-range dropdown. **THAT IS ALL** |
| search | URL `?activityLogSearch=` -> API `search=` - **THE TWO DIFFER**; debounced ~1.2s |
| date range | URL `?duration=` -> API `duration=` - **identical**; default `last_7_days` |
| ranges | Last 24 hours / 7 days / 30 days / 3 months / 6 months / This year |
| list endpoint | `GET /core/api/v1/analytics/agents/activity-logs/me/?page=1&page_size=10&duration=<v>[&search=<term>]` |
| paging | **INFINITE SCROLL, and it appends.** No pagination control, and none is needed |
| entry | `.activity-log-item` inside `.activity-log-items-container` - headline / description / `MMM D, YYYY - h:mm AM` |
| empty state | `.section-empty-state`, two `<p>` |
| testids | **exactly ONE on the whole page**, and it is not a control |

Measured server totals on `AGENT_EMAIL` (2026-09-21): 1 / 29 / 207 / 348 / 514 / 514 across the
six ranges, and `Invite` narrowing 514 -> 248 on This year and -> 166 on Last 30 days.

### FIVE THINGS THAT WOULD BE EASY TO GET WRONG HERE

1. **>>> THE LIST KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. <<<** A read taken
   after a fixed delay does not fail - it **reports the OLD list as the new one**, and nothing in
   the DOM distinguishes the two. `ActivityLogPage.settleAgainstServer()` is the settle: wait for
   a response newer than a baseline, then poll the render until it matches that payload. Every
   action that changes the list goes through it. **Do not add one that does not.** It matches
   against `results.length`, never `count` - the endpoint pages at 10, so a higher count is
   correct and the render legitimately stops there.
2. **>>> THERE IS NO PAGINATION CONTROL, AND THAT IS CORRECT. <<<** The list pages by scrolling
   **`<main>`** (not the window - the app puts `flex-1 min-h-0 overflow-y-auto` there, so
   `window.scrollTo` does nothing at all), and it **appends**: 10 rows grew to 70 over six
   fetches against `count: 514`. Reading the absent control and reporting "10 of 514 entries are
   unreachable" is a conclusion that was **nearly filed before the scroll was measured** - it is
   the same shape as the candidate dashboard's "Your Documents" block, which really IS capped.
   The difference is one measurement. The scenario asserting the absence says WHY, so a red row
   means the paging model changed rather than that a pager is missing.
3. **THE SEARCH'S URL PARAM IS NOT ITS API PARAM** (`activityLogSearch` vs `search`), while the
   date range's **are** the same on both. That is the exact reverse of every filter modal in this
   product, where "not one option's URL param equals its API param". So both are asserted per
   control: checking only the URL passes on a front end that rewrites the address bar and queries
   the server for something else.
4. **THE DATE RANGE REACHES THE URL AND SURVIVES A RELOAD HERE**, search included. The candidate
   view-profile's Activity Log **TAB** writes its duration nowhere (recorded there as finding 7),
   so an assertion carried over from that module would be backwards. **This surface also renders
   the TIME**, which that tab discards - another carried-over assertion that would fail against a
   correct render.
5. **`decodeURIComponent` does not turn `+` back into a space**, so a multi-word term compared
   that way can never match a URL that correctly encodes it. `urlParams()` uses
   `URLSearchParams`. This is the same trap that makes `active-candidate.js`'s shared
   `the URL should contain the search term` unusable here.

### The findings this module surfaces

**ONE is asserted and fails on purpose; THREE are recorded** and attached to the report on every
run, because no AC settles them and failing on them would make the file permanently red over
questions for the PO - the call the receipt-PDF currency step and the community empty-state
wordings already got.

1. **~~`@known-issue`~~ FIXED 2026-10-01 - ONE EMPTY-STATE MESSAGE FOR TWO DIFFERENT CAUSES.** Now a regression lock. A search matching
   nothing renders the **tab-level** copy `No activity to show` /
   `Agents recent actions and updates will appear here.` - so an agent holding 514 entries is
   told they have none. Every sibling listing in this product distinguishes the two
   (`No results found` / `We couldn't find any results matching your current search.`).
   - **It asserts the sensible behaviour and pins no replacement string**, so it turns green by
     itself whichever wording the product chooses, and only once a search-caused empty list is
     explained as one.
   - **The TAB-LEVEL half is asserted CONDITIONALLY**, the pattern `candidate-deactivated.feature`
     uses: the step reads the unfiltered count off the Background's own first load, and when the
     account is genuinely empty it asserts the tab-level wording **verbatim** instead. That branch
     is unreachable on `AGENT_EMAIL` today (514 entries, every range populated) and the step
     attaches which branch it took rather than pretending. It strengthens by itself the day a
     zero-activity fixture exists.
2. **RECORDED: the same message is missing its apostrophe** - "Agents recent actions" for
   "Agent's". **Deliberately NOT what finding 1 fails on**: a typo and a wrong-cause message are
   different fixes, and pinning the exact string would make that scenario red for the smaller
   reason and bury the larger one.
3. **RECORDED: THE SEARCH MATCHES FIELDS NO ENTRY DISPLAYS** - the actor's name and email.
   Searching the agent's own first name returns **492 of 514** entries, not one of which shows it
   anywhere on screen; the full email returns the same 492. (The remaining 22 are the superadmin
   impersonation rows, which `administrator` returns - 492 + 22 = 514, so the partition is
   self-consistent.) Combined with a placeholder that is a bare `Search...`, an agent has no way
   to know what the box searches. **Question for the PO: should the placeholder name the fields,
   or should the search be narrowed to what is displayed?**
   - Its scenario asserts what the build **does**, so it goes red if the actor stops being
     searchable - which would be a regression in a capability agents may be relying on.
   - **This also constrains how a search term may be DERIVED.** `safeWordsFrom()` excludes any
     word overlapping the signed-in agent's identity: such a term matches nearly every entry, and
     `every listed entry should match the search term` would then fail against a search working
     exactly as built.
4. **RECORDED: a whitespace-only term costs a round trip.** The URL correctly omits it and the
   app correctly drops the param from the request, so the outcome is right - but the request is
   made anyway. **Three surfaces in this product, two behaviours**: Requires Attention and the
   SuperAdmin candidates listing also send it; the Agents listing suppresses it entirely. Ask the
   PO which is house style.

### Edge cases in the URL: the fallback works here, unlike on the candidate profile

| supplied | trigger reads | request carries | the URL |
| --- | --- | --- | --- |
| nothing | Last 7 days | `duration=last_7_days` | no param written at all |
| `?duration=` | Last 7 days | `duration=last_7_days` | left empty |
| `?duration=not_a_real_range` | Last 7 days | `duration=last_7_days` | **left holding the rejected value** |

The fallback is **correct**, and that is worth asserting precisely because the candidate portal's
own profile has the same shape of routing gap and does **not** fall back - an unrecognised
`?selectedTab=` there leaves no tab selected and renders no panel. The URL being left holding the
rejected value is recorded, not failed on.

### Assertions worth keeping exactly as they are

- **Counts are RELATIONAL, never pinned.** This is a live, growing log on a shared DEV account and
  the narrow ranges roll forward with the clock, so no scenario pins a count, a headline or a
  total. The three relational rules need no fixed expectation at all: a wider range cannot return
  fewer than a narrower one; two casings of one term must return the **same** number; a mid-word
  slice must return **at least** as many as the whole word (everything containing `Invite`
  contains `nvit`, so the slice is a strict superset).
- **>>> THE MONOTONIC CHECK ALSO REQUIRES THE WIDEST RANGE TO EXCEED THE NARROWEST. <<<** Six
  identical figures satisfy "never decreases" perfectly, so without that second assertion a
  filter that was ignored entirely would pass. The only honest exception - an account whose whole
  history fits inside 24 hours - is reported rather than silently allowed.
- **Search terms are DERIVED from the first entry on screen** wherever the assertion is about
  matching, so they cannot go stale as the log changes. The two hardcoded terms (`Invite`) are
  used only where the assertion is about a parameter reaching the server, and their failure
  messages say to pick a term the account still holds rather than to read it as a broken search.
- **Every count comparison uses the SERVER's `count`**, never the rendered row count: the render
  is capped at `page_size`, so two results differing only past the first page look identical on
  screen.
- **`every listed entry should match the search term` refuses to pass on an empty list.** A step
  that goes green having inspected nothing retires the assertion silently - the same rule as
  `non-paid billing rows should have disabled receipt actions`, which used to log "nothing to
  assert" and pass, and the same way the Basic Information scenario on the candidate view-profile
  passed vacuously on a drifted fixture.
- **Entries are counted per `.activity-log-item`, NEVER de-duplicated by text.** The identical
  reader on the candidate view-profile tab collapsed 10 rows into 5 by de-duplicating on
  `headline|description|date`. Here it would be worse still: rows that are genuinely distinct can
  render identically, so a content de-duplication **hides real activity** and would let "every
  entry the server returned is rendered" pass with half of them missing.
- **Two absences ARE the assertion**, which is why the request log is installed from `hooks.js` /
  `PagesFixture.js` **before the first navigation**: re-picking the range already applied fires
  no request, and clearing an already-empty search fires none either. A `waitForResponse` there
  resolves to null, which is indistinguishable from a timeout, a slow network or a listener
  attached too late. `clearSearch()` settles **only if the box had content**, for the same
  reason - an unconditional settle would wait out its whole budget and report a working control
  as broken.
- **The search control fires only when the value CHANGES**, so `searchFor()` clears first. That is
  also what lets the variations table drive two terms that happen to be identical without one
  silently measuring the other.
- **Real keystrokes, never `fill()`** - the box is debounced and a single scripted value-set is
  not what the app listens to.
- **The date-range trigger is located STRUCTURALLY, as the sibling of the aria-hidden mirror.**
  Its label IS the current selection, so a text locator cannot find it when the selection is
  unknown - which is exactly the case in the step asserting what the default is. A `main button`
  reader is right today (there is exactly one) and silently resolves elsewhere the moment a second
  button appears. **NEVER use the trigger's id**: it is react-aria-generated and regenerated on
  every render.
- **Options are selected by ROLE AND NAME**, never by indexing a locator union: the popover is
  `role=dialog` > `role=listbox` > `role=option` with **two `<button aria-label="Dismiss">`
  FLANKING the listbox**, and the community module lost four scenarios to exactly that.
- **The aria-hidden mirror `<select>` carries a BLANK option the popover does not offer.** It is
  not user-selectable and **not a defect** - the identical mirror on the candidate view-profile
  tab was checked and recorded there. It is compared against the popover anyway, so a real
  divergence (a range the mirror knows and the popover hides) would be visible.
- **Multi-check steps collect every problem and throw once.** The six-range table, the four search
  variations, the five unsafe terms and the two dismissal routes each have independent cases;
  Cucumber abandons at the first failing step, so reporting only the first would hide whether the
  rest share a cause.
- **The unsafe-term step watches for a native DIALOG and for injected `<script>` elements**, not
  just for a non-500. Playwright dismisses dialogs automatically, so without a listener an
  executed term would leave no trace at all. Measured: a 300-character term, `' OR 1=1 --`,
  `<script>alert(1)</script>`, a non-latin term and `%26%3D` all return `200` with 0 results, no
  dialog and no injected markup.
- **`the Activity Log should offer no separate Filters button` is asserted as a RULE.** Every other
  Agent Portal listing opens a Filters modal, so this is what stops a filter-modal assertion being
  ported onto a page that has none - and if one is ever added, it goes red and says so.
- **Every table-driven step carries an explicit `{ timeout }`.** `features/support/hooks.js` calls
  `setDefaultTimeout(60000)` and **that overrides the profile's own `timeout`** - this profile asks
  for 300000 and gets 60000. A step applying six date ranges, each costing a debounce plus a round
  trip, is many times a normal step's work, so without a budget of its own it is killed part way
  and reports "function timed out", which says nothing about the app and hides however many rows
  had already passed. **This trap has now bitten six areas in this repo.**

### Every phrase is worded "... Activity Log ..." or "... date-range ...", and that is deliberate

Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
**ambiguous** step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
fails generation on it instead). Two neighbours make this a real hazard rather than a theoretical
one, and **both bind their steps to a different page object**, so they could not be reused even if
the wording were free:

- **`steps/audit-logs.js`** owns the SuperAdmin audit trail, which is also a searchable,
  filterable log. `the search box should be displayed` and `no entry should be listed` would
  collide immediately, and every one of its steps drives `this.pages.auditLogs`.
- **`steps/candidate-view-profile.js`** owns an **Activity Log TAB** on a candidate's profile,
  with the same six duration options and the same `.activity-log-item` markup. Its steps drive
  `this.pages.candidateViewProfile` and would assert against a different account entirely.

Exactly **one** phrase is reused, and only because it is genuinely page-agnostic:
`Given I am logged in as an agent` (`steps/active-candidate.js`, via `utils/resilientSignIn.js`).

`npx cucumber-js -p activityLog --dry-run` reports **17 scenarios / 197 steps, 0 undefined, 0
ambiguous**, and `node scripts/check-profile-selection.js` confirms the new profile selects 32,
the default profile picks the file up, and no other profile's selection changed.

## Verifications - the document review queue (`features/Agent_Portal/verifications.feature`)

The Agent Portal's `Verifications` page at `/verifications`: the queue an agent works through.
Its four status tabs, its search, its Filters modal, its pagination, its two row actions, and the
**Document Verification** panel the View action opens - the react-pdf viewer and its zoom, the
document information, the AI's findings, the decision comment history, and the two decision
dialogs. Added 2026-09-22.

- **`npm run test:verifications`** (`-p verifications`) - the whole file, 24 scenarios.
- **It is IN the default `npm test` run**, exactly as `@requireAttention`, `@candidateDeactivated`
  and `@activity-log` are, and nothing excludes `@verifications`.
- Steps live in **`steps/verifications.js`**; the page object is **`pages/AgentVerificationsPage.js`**
  - **extended, not replaced** (see below). It was already wired into `features/support/hooks.js`
  and `fixtures/PagesFixture.js`; what was added is the `install()` call in both, and the file is
  picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- **Three read-only probes** did the measuring and **not one of them commits a decision**:
  `scripts/probe-agent-verifications.js` (the whole surface - route, tabs, columns, the Filters
  modal, search, pagination, the panel per status, both decision dialogs' contracts, the edge
  cases), `-2.js` (Download, the panel's "View profile", what the row's candidate buttons do) and
  `-3.js` (the one question the first two left open - keyboard operability, below). **Re-run them
  rather than reasoning about the DOM.**

### >>> THE WHOLE FILE IS READ-ONLY, AND THAT IS WHAT MAKES IT SAFE IN THE DEFAULT RUN <<<

**Approve and Request Revision are IRREVERSIBLE** - nothing anywhere in the product undoes a
decision. So the decision dialogs here are OPENED, their contract and their mandatory-reason gate
read, and **CANCELLED**. No scenario clicks a submit control, and `submitDecision()` - the page
object's only committing method - is never called from `steps/verifications.js`.

- **The committing path is NOT duplicated here.** It already lives in
  `features/AI Document Verification` (`@mutates-document`, `npm run test:doc-verify:decisions`),
  which owns upload -> AI -> agent decision end to end and already pays that cost. A second
  implementation would drift from the first.
- So nothing in this file can change a document, spend a fixture, send an email or make a payment,
  and **there is no cleanup hook because there is nothing to clean up.**
- **One scenario exists purely to protect that property**: `Verify that the queue offers no control
  that can decide a document from the listing`. If a decision control is ever added to a ROW, it
  goes red and says so - rather than a routine `npm test` quietly acquiring the ability to approve
  a document irreversibly.

### ONE PAGE OBJECT, NOT TWO - `AgentVerificationsPage` was EXTENDED

`pages/AgentVerificationsPage.js` already existed, written 2026-08-24 for the AI Document
Verification module - which drives this route only as a **means**: it uploads a document, then
reads that document's status and commits a decision. Nothing in it covered the screen as a screen.

It now has two parts, and **every method in PART 1 is untouched**:

| | |
| --- | --- |
| PART 1 | the AI module's needs: `open`, `search`, `selectTab`, `readRows`, `findRow`, `openDocument`, `readPanel`, `readFlaggedFor`, `readCommentHistory`, `waitForDocumentRendered`, `submitDecision` |
| PART 2 | the page as a page: the request log, `settleAgainstServer`, the tab strip, the Filters modal, pagination, the empty state, the viewer, `probeDecisionDialog`, `auditRowActionKeyboard` |

A second page object for one screen is how two readers of it drift, and this repo has paid for
that more than once.

### >>> 13 SCENARIOS ADDED 2026-10-01: 24 -> 37 <<<

A coverage audit found the Date Uploaded filter asserted only as *present*, Download never
clicked by mouse, pagination never past page 2, and nothing on load failures, access, reload,
row order or dismissing a decision dialog. Every addition was measured first with
`scripts/probe-agent-verifications-5.js` and `-6.js` (read-only - nothing is decided).

| Added | Type | Measured |
| --- | --- | --- |
| date range narrows, URL + request + Clear All | positive | URL `dateUploadedStart/End`, API `uploaded_after/before` (names differ - both asserted) |
| incomplete or backwards range | negative | "End Date is required" + Apply disabled; end picker disables days before the start |
| **single-day range** | edge, `@known-issue` | **Sep 15 to Sep 15 returns 0; Sep 15 to 16 returns 3 - the END date is exclusive** |
| filter matching nothing + its CTA | negative | "...matching your current filters." + "Clear all filters" restores |
| reload restores tab + search + type + range | positive | identical URL and request |
| numbered page + last page | positive | page 25 holds the remainder, Next disabled |
| unusable page number | edge | `abc` / `0` / `-1` fall back to page 1 |
| Download from row and from panel | positive | real file (magic bytes checked), no navigation, panel stays open |
| decision dialog dismissed by X / Escape | positive | back to the panel, status unchanged, typed reason discarded |
| **failed load reported as empty** | negative, `@known-issue` | **expected "Failed to load document" (product owner); 500, offline and `?page=99999` all say "No documents to verify yet" instead** |
| **row order** | negative, `@known-issue` | **server sends newest-first, the grid re-sorts each page by file name** |
| second end to end | e2e | date range -> review -> download -> back to the same queue |

- **The date pickers are calendar-button-only react-aria DatePickers** with a popover that has its
  OWN Cancel / Apply and blocks the rest of the modal until one is pressed. `pickDate()` drives it.
  The first selectable day's label carries a suffix (`"..., First available date"`), so day cells
  are matched on what the label CONTAINS, never its end.
- **The failed-load check first PASSED BLIND**: `readEmptyState()` keys on `.section-empty-state`,
  which this message is not inside. It now reads the page text and refuses to conclude anything
  until the tab strip has painted. Same class as every reader that can only answer "absent".
- Measured full run, 2026-10-01: **37 scenarios, 29 passed / 8 failed, 16m 10s** - but one
  "pass" was that blind check, so the steady state is **28 passed / 9 failed**:
  7 intended (`@known-issue` x5, plus the two spec reds below), the decision-gating question for
  the PO, and **the zoom scenario**, which hung because each zoom re-renders all 1294 pages of the
  4MB PDF that sits first in the queue - the viewer `@known-issue`'s own symptom, not a regression.

### >>> RE-MEASURED 2026-10-01: THREE THINGS MOVED IN THE BUILD <<<

`node scripts/probe-agent-verifications-4.js` (read-only) measures all three.

1. **The AWAITING tab renders "Awaiting Verification"; the SPEC is "Need Review"** (confirmed by
   the product owner 2026-10-01). The scenario and `TAB_LABEL.AWAITING` assert "Need Review", so
   the page-contract scenario is RED against this build on purpose - the build is off-spec.
2. **The Filters modal renders a third group, Status, which the spec says it should NOT have**
   (product owner, 2026-10-01). The scenario asserts exactly "Document Type, Date Uploaded" and is
   RED against this build. `readFilterGroups()` is structural now - the old reader matched a
   hardcoded two-item list and could never have reported the extra group, so it would have
   passed blind. Document-type options are read by test-id prefix (`filters-documentType-`).
3. **A Revision Required document now OFFERS Approve and Request Revision** - on agent-decided
   and AI-set revisions alike (4 of 4 measured); Approved still withholds them. The gating
   scenario is left RED and deliberately untagged: this is either a new re-decide feature or a
   regression, and **the PO must say which** before the expectation is changed.

### >>> THE "Need Review" INCONSISTENCY IS FIXED, AND THE SUITE WAS THE STALE HALF <<<

`AgentVerificationsPage.TAB_LABEL.AWAITING` read **"Need Review"** (singular), recorded on
2026-08-24 as a real UI inconsistency against a pill reading "Needs Review". Re-measured
2026-09-22: **the build renders "Needs Review" in BOTH places.** The product fixed the defect and
the suite went on reporting it.

That was not cosmetic. `steps/document-verification.js:2068` asserts
`tab label === TAB_LABEL[status]`, so **that step was RED against a build that had been
corrected**. The map is now `'Needs Review'` and that step should pass again.

- **`TAB_LABEL` and `STATUS_LABEL` are deliberately KEPT SEPARATE** even though they now agree on
  every status. They are two different surfaces, and collapsing them into one map would mean a
  future divergence could not be expressed at all - which is the state that made this one hard to
  spot in the first place.
- **Two other files still repeat the old reading** and are stale for the same reason:
  `pages/CandidateDocumentsPage.js:96-97` and `pages/CandidateViewProfilePage.js:242`, plus
  `scripts/probe-candidate-view-profile.js:263`. They are comments only, so nothing fails on them.

### >>> ONE SCENARIO PER BEHAVIOUR: CONSOLIDATED 49 -> 24 ON 2026-09-22, WITH NO ASSERTION LOST <<<

The file was written as roughly one scenario per ASSERTION. Every scenario costs a fresh browser
context and an agent login, so several scenarios arriving at the same screen to look at the same
state were paying several times over for one observation - the same waste `features/Promo_Code/`
(61 -> 32), the community module (49 -> 43) and `Contact-us.feature` (19 -> 11) each corrected.

**It is not only cheaper, it is a better report.** Where a rule has independent CASES - three
unusable tab values, three document types, four status tabs - they are now driven from a data
table by ONE step that walks every row, collects every failure and reports them together.
Cucumber abandons a scenario at its first failing step, so N scenarios produce N red rows without
ever saying whether they share a cause.

**The three fallback scenarios are the clearest example of the merge being a repair rather than a
tidy-up.** As three scenarios, a break in the unrecognised-value case said nothing about whether
the empty and wrong-case cases still worked - and the diagnosis recorded against them ("the
fallback exists and simply does not cover an unknown value") rested on a measurement nobody was
taking, because the control case ran second and was skipped on every failing run. One collecting
step reports all three, every run.

The merges, all of them scenarios that observed the same behaviour or the same rule under
different inputs:

| section | was | now | what was merged |
| --- | --- | --- | --- |
| page contract | 5 | 2 | heading + controls + tab strip + columns + row actions, all read from one page load |
| status tabs | 6 | 2 | the per-tab table absorbed the All tab's ABSENT status param and the no-request re-select; the three unusable tab values became one table |
| search | 7 | 5 | narrowing + both params + the matching table; and the no-match empty state + clearing to restore it |
| filters modal | 10 | 4 | the modal's contract + Cancel + the restored selection + Clear All, all from one modal; the union + its badge; and the tab / search / URL composition |
| pagination | 2 | 1 | the second had to page forward first anyway to have somewhere to reset from |
| the panel | 9 | 5 | describe + render + no-request + zoom from one open; dialog-not-a-route + the profile link (row View -> modal -> its own View profile); flagged-for + comment history |
| decision dialogs | 5 | 3 | both dialogs' contracts from one document; the mandatory reason + its 500-character cap |
| accessibility | 2 | 1 | the same two controls are named AND operable without a mouse |
| end to end | 2 | 1 | narrowing by tab+filter and by name are two ways into the same review-and-return loop |

**NOTHING WAS DROPPED, and that is checked rather than asserted.** Every step definition in
`steps/verifications.js` is still reached by a feature line - 101 definitions, 0 unreachable. Two
steps went and one arrived: `I open the Verifications page with the tab value` and `the URL should
hold the tab value` were replaced by the collecting table step, which asserts the same three facts
per row plus the URL rewrite.

**WHAT IS DELIBERATELY NOT MERGED**, so this does not get "finished" later at the cost of coverage:

- **ANYTHING `@known-issue`.** A red scenario merged into a green one takes the green assertions
  down with it at the first failing step. The viewer and the duplicated-test-id scenarios stand
  alone for that reason.
- **"the queue offers no control that can decide a document from the listing".** It is the rule
  this whole file's membership of the default run rests on: if a decision control is ever added to
  a ROW it must go red as its own unmissable row, not as the seventh Then of a contract scenario.
- **the search PLACEHOLDER scenario**, which compares copy against behaviour and so can go red for
  a reason that has nothing to do with the search working.

### Expected baseline

`npm run test:verifications` - **MEASURED 2026-09-22, after the 49 -> 24 consolidation:
24 scenarios, 22 passed / 2 failed, 261 steps, 12m 06s** (headless, serial).

The run before the merge was **49 scenarios, 47 passed / 2 failed, 405 steps, 14m 54s** - same
two reds, same coverage, 25 fewer browser contexts and logins.

**A fourth run, after the profile-link strengthening below, reported 21 passed / 3 failed in
33m 42s** - and the third red was the environment, not a regression. `Given I am logged in as an
agent` exhausted its whole 150s budget, on a run that took nearly three times as long as the one
before it; **that scenario passes alone in 17s** and the change it followed touched neither the
login nor that scenario. Same caveat as always on this surface: a ~12-minute run is long enough
for the machine to degrade under it, so **re-run a scenario that fails on a sign-in timeout or
`ERR_NETWORK_IO_SUSPENDED` before reading anything into it.**

**Both reds are `@known-issue` and they are the findings this module exists to surface** (below).
A green run means exactly those two are red and nothing else is. Verify the list with
`npx cucumber-js -p verifications --dry-run --tags "@known-issue"` rather than trusting this prose.

Type tags cover every scenario: **17 `@positive`, 5 `@negative`, 3 `@edge-case`** - 25 against a
file of 24, because one scenario carries `@negative @edge-case` (the unsafe-search-term one).
1 positive also carries `@smoke` and 1 carries `@e2e`. Both `@known-issue` scenarios carry
`@negative` alongside, so `--tags "@negative"` slices them in.

**It took THREE full runs to get there, and the two superseded ones are recorded because each
taught something rather than because the numbers are interesting:**

| run | result | what the extra reds were |
| --- | --- | --- |
| 1 | 44 passed / 5 failed | **3 suite defects, ONE cause** - a re-resolving locator (below) |
| 2 | 45 passed / 4 failed, 16m 55s | **1 suite defect** (the cell-level settle, below) + **1 `net::ERR_NETWORK_IO_SUSPENDED`** - the OS suspending network I/O, i.e. the machine slept under the run |
| 3 | **47 passed / 2 failed, 14m 54s** | the two intended `@known-issue` reds, and nothing else |

**Do not average them** - the differences were four distinct suite defects, all since fixed.

The run takes ~15 minutes, which is long enough for a machine to sleep under it - **if a scenario
fails on `ERR_NETWORK_IO_SUSPENDED` or a sign-in timeout, re-run it before reading anything into
it.** The same caveat is recorded for `candidate-deactivated.feature`.

### FOUR SUITE DEFECTS THE FULL RUNS EXPOSED, ALL FIXED

Every one would have been read as a product defect, and both causes are classes this repo has paid
for before. The diagnosis is the reusable part.

**1. >>> A LOCATOR THAT RE-RESOLVES: `the decision dialog is still open after Cancel`, THREE TIMES,
AGAINST A CANCEL THAT WORKS. <<<** `openDecisionDialog()` returns
`page.locator('[role="dialog"]').last()`. That is correct while the dialog is open and **wrong the
moment it closes**: THREE dialogs can exist on this screen - the review panel, the Filters modal
and a decision dialog - so once the decision dialog is cancelled `.last()` silently re-resolves to
**the review panel**, which is still open and still visible. Asking that handle "are you closed?"
therefore answers "no".

- **The probe had already measured the truth and it read as confirmation of the bug.**
  `probe-agent-verifications.js` prints `revision after Cancel -> dialogs on page: 1`, and that 1
  is the review panel. A bare COUNT of dialogs cannot answer this question either.
- **The fix is `decisionDialogIsOpen(decision)`**, scoped to text only that dialog carries and
  counted among the **visible** dialogs. Both markers are measured, not guessed:
  `Help the candidate understand what needs to be fixed` (revision) and
  `Confirm this document meets the verification criteria` (approve).
- **It deliberately does NOT key on the submit button's label**: the review panel's own TRIGGER
  button also reads "Request Revision", so a `hasText` on that matches the panel too.
- Everything else in those three scenarios had passed - every gate observation was correct - so the
  mandatory-reason rule was never actually in doubt.

**2. >>> A MATCHING ROW COUNT IS NOT A POPULATED GRID. <<<** `settleAgainstServer()` polled until
`rendered === results.length` and stopped there - but the rows arrive before their CELLS do, so
that condition is satisfied while a cell is still blank. A read taken there **does not fail, it
reports an empty Document Type as the row's actual type**: the filter scenario reported
`expected every row to read "Transcript", got ["","Transcript"]` against a filter that is entirely
correct.

- **Exactly the billing grid's ten blank skeleton rows, one surface along** - and the same shape as
  `RequiresAttentionPage.settleRows()`, which keys on `@` appearing in the Candidate cell.
- The settle now has a **second phase**: wait until every row has painted its identity and type
  cells. It **gives up quietly rather than throwing**, because a document legitimately holding no
  type would otherwise hang for the whole budget and report a working queue as broken.

### The surface, measured (2026-09-22)

| | |
| --- | --- |
| route | `/verifications` -> redirects to `?activeFilter=ALL` |
| heading | `Verifications` (a `<button>` inside the `<h1>`) |
| grid | `role=grid`, accessible name **"Verifications"** |
| columns | Document Name / Uploaded By / Document Type / Date Uploaded / Status / Actions |
| tabs | All / Needs Review / Approved / Revision Required, `agent-verifications-tab-<slug>` |
| tab -> URL | `activeFilter=ALL\|AWAITING\|APPROVED\|REVISION` |
| tab -> API | `status=AWAITING\|APPROVED\|REVISION`; **All sends no status at all** |
| search | `input[type=search]`, placeholder `Search by document name...`, `?search=`, debounced |
| filters | a modal titled **"Apply Filters"**: Document Type (3 checkboxes) + Date Uploaded (start/end) |
| filter -> URL | `documentType=EDUCATION\|WORKEXPERIENCE\|CERTIFICATION` |
| filter -> API | **`category=`** with the same values |
| row actions | View (`agent-verifications-view-button`) + Download (`agent-verifications-download-button`) |
| list endpoint | `GET /core/api/v1/candidate/documents/all/?page=1&page_size=10&search=` |
| panel | a dialog titled "Document Verification"; **the URL does not change** and **no request fires** |
| decision submit | `agent-submit-request-revision-button` - **on BOTH dialogs**, see below |

**Only six `data-testid` hooks exist on the whole page** (the four tabs and the two row actions),
plus three inside the Filters modal (`filters-documentType-<VALUE>-checkbox`,
`filters-clear-all-button`, `filters-apply-button`). Everything else is a role + accessible name.

### SIX THINGS THAT WOULD BE EASY TO GET WRONG, each with a wrong assertion behind it

1. **>>> THE TAB STRIP IS `role="radio"` IN A `radiogroup`, NOT `role="tab"`. <<<** Measured: zero
   elements with `role=tab` on a page that plainly renders four tabs. A `getByRole('tab')` reader
   finds nothing. That absence is asserted, so a markup change says so.
2. **>>> THE PARAM NAMES DIFFER BETWEEN THE URL AND THE WIRE, IN BOTH CONTROLS. <<<** Tabs:
   `activeFilter=AWAITING` -> `status=AWAITING`. Filter: `documentType=EDUCATION` ->
   **`category=EDUCATION`**. So both are asserted per row - checking only the URL passes on a front
   end that rewrites the address bar and queries the server for something else, and reading the
   rendered rows cannot catch that either. Note the filter's VALUES are the API's own enum while
   its LABELS are not: **Transcript=EDUCATION, Experience Letter=WORKEXPERIENCE,
   Certification=CERTIFICATION**.
3. **>>> THE ALL TAB SENDS NO `status` PARAMETER AT ALL <<<** - it is an absence, not a value. A
   reader expecting `status=ALL` finds nothing and reports a working tab as broken.
4. **The app ALWAYS sends `search=`, even empty.** So "a request carrying `search=`" is not
   evidence a search was applied - assert the VALUE.
5. **>>> THE GRID KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. <<<** A read after a
   fixed delay does not fail - it **reports the OLD list as the new one**. `settleAgainstServer()`
   waits for a response newer than a baseline and then polls the render until it matches that
   payload. Every list-changing action goes through it. **Do not add one that does not.** Matched
   against `results.length`, never `count` - the endpoint pages at 10.
6. **THERE ARE TWO `<nav>` ELEMENTS.** The sidebar is one, so an unscoped pagination reader
   resolves to `Dashboard Candidates Verifications Activity Log`. The pager is scoped by its
   accessible name.

### The findings this module surfaces

**TWO are asserted and fail on purpose; THREE are recorded** and attached to the report on every
run, because no AC settles them and failing on them would make the file permanently red over a
question for the PO.

1. **`@known-issue` - THE VIEWER RENDERS EVERY PAGE OF THE DOCUMENT AT ONCE.** Measured: a 5MB PDF
   produced **1619** `.react-pdf__Page` elements with **1619** `<canvas>` siblings; a 4MB one 1294.
   Every zoom step re-renders all of them, which is why **a single zoom click was measured taking
   over two minutes to settle** (an MCP evaluate driving 14 zoom presses had to be backgrounded).
   An agent working a queue pays that on every document they open.
   - The scenario asserts the **sensible behaviour** - a bounded render - and **pins no particular
     limit**, which would be a guess at a number nobody has specified. It turns green by itself
     once the viewer paginates or virtualises.
   - The zoom itself is CORRECT and has its own passing scenario: **50% to 200% in steps of 25**,
     with Zoom out disabled at the floor and Zoom in at the ceiling. Both ends are asserted - a
     control that steps but never stops is a different defect from one that stops in the wrong place.
2. **`@known-issue` - THE TWO DECISION DIALOGS' SUBMIT BUTTONS SHARE ONE `data-testid`.** Both
   carry `agent-submit-request-revision-button` while their labels read **"Approve document"** and
   **"Request Revision"**. Recorded in 2026-08 and **re-measured live 2026-09-22 - still present.**
   These are OPPOSITE, IRREVERSIBLE actions, so a test-id selector can approve a document when
   asked to send it back. It is why `submitDecision()` refuses to click a control whose visible
   label does not match the decision it was asked to make - a guard that should not need to exist.
3. **RECORDED: the applied-filter badge counts GROUPS, not options.** Two Document Type options
   selected reads `Filters 1`, while the URL and the request both correctly carry two values.
   Requires Attention and Deactivated behave the same way; the Active tab's own scenarios assert
   the OPTION count for the same-looking badge. The listings genuinely disagree about what the
   number means. **Do not "align" them without a product answer.**
4. **RECORDED: a whitespace-only search costs a round trip.** The URL correctly omits it, the
   request carries `search=+++`, and the list comes back unfiltered - so the outcome is right.
   **Three surfaces in this product, two behaviours**: Requires Attention and the SuperAdmin
   candidates listing also send it; the Agents listing suppresses it entirely. Ask the PO which is
   house style.
5. **RECORDED: the Approve dialog is headed "Approve document" (lower-case d)** where every other
   heading on the surface is title case, and its helper text - *"Explain why this document is
   acceptable despite the flagged checks"* - presumes the document was flagged, which is not true
   of every document an agent may approve.

### >>> THE PANEL CARRIES A SECOND "VIEW", AND "IT NAVIGATED" WAS NOT ENOUGH TO ASSERT ABOUT IT <<<

The queue's row **View** opens the review panel; the panel then carries a **second view control of
its own** - an icon-only button whose accessible name is `View profile` - which leaves the queue
for the uploader's profile. So the chain is:

```
row View  ->  Document Verification modal  ->  its "View profile"  ->  /candidates/<id>/view-profile
```

That chain WAS covered from the start, but the assertion behind it was one line:

```js
expect(url).to.match(/\/candidates\/\d+\/view-profile/)   // the whole check
```

**A URL-shape check passes just as happily on a panel that always opens the FIRST row's
candidate**, which is a disclosure problem rather than a routing nit: the agent would be reading
one person's profile while reviewing another person's document. It is the same hazard the panel's
own "describe the document from the row I opened" step guards, left unguarded one control along.
Strengthened 2026-09-22.

**The behaviour is CORRECT - measured, and re-measured after the strengthening.** For the document
uploaded by `Ghazan Ahmed / ghazan.ahmed+1257@bytecorp.io`:

```
landed url      : /candidates/11411/view-profile?selectedTab=candidate-details
profile fetched : GET /core/api/v1/candidate/profile/11411/
profile header  : Ghazan Ahmed          <- the uploader
tab strip       : Candidate Details, Track Progress, Document Verification, Subscription, Activity Log
```

**What is asserted now**, collected and thrown once because the three fail independently and send a
developer to different places:

1. **it navigated** to a candidate profile route;
2. **it opened the RIGHT person** - the uploader is captured from the panel BEFORE the click and
   compared against the name the profile renders, and against the id the app actually FETCHED;
3. **the destination is the profile SCREEN**, identified by its five-tab strip, so a route that
   resolved to a blank page cannot pass.

**The profile's CONTENTS stay out of scope, deliberately** - `candidate-view-profile.feature` owns
that screen and already drives it from three listings. This step **delegates to
`CandidateViewProfilePage`** (`settleProfile()`, `readHeader()`, `tabLabels()`) rather than
re-implementing its readers, which is what keeps the two from drifting. It is the same screen, and
asserting it is the same screen is all this file should do about it.

**Two traps measured while closing the gap, and each produced a wrong answer first:**

- **>>> THE PANEL'S "Uploaded By" BLOCK RENDERS THREE LINES AND THE FIRST IS THE AVATAR'S
  INITIALS. <<<** `readPanel()`'s generic `field()` takes "the line after the label", which here is
  **`"GH"`** - not the candidate's name. A probe written that way compared `"GH"` against the
  profile header and **reported that the profile link opens the wrong person, on a build that opens
  exactly the right one**. `readPanelUploader()` identifies the three parts by what they ARE - the
  email is the line holding `@`, the initials are the short all-caps line - rather than by position.
  Same class as every other positional reader this file records.
- **THE PROFILE PAYLOAD CARRIES NO TOP-LEVEL `id`.** A first version compared `payload.id` against
  the id in the address bar and failed with *"the profile fetched was undefined"* on a profile that
  had loaded perfectly. The candidate the app ASKED FOR is in the **request URL**, which is the
  better evidence anyway: it catches a page showing the right id in the address bar while fetching
  somebody else.

`scripts/probe-agent-verifications-2.js` section C is the read-only measurement behind all of this -
it prints the row's uploader, the panel's uploader block, the landed URL, the profile payloads
fetched, the tab strip and the profile header side by side.

### THINGS THIS SURFACE GETS RIGHT, asserted so a regression is caught

Worth listing, because three of them are defects on the neighbouring listings and the natural move
is to carry the assertion over.

- **The search placeholder is ACCURATE.** It reads "Search by document name..." and the search
  matches the document name and nothing else - measured against an uploader's name, which returns
  zero rows. Requires Attention and Deactivated both **under**-promise on the same kind of control
  (their placeholders say "candidate name" while the search also matches an email). The scenario
  compares the placeholder against the BEHAVIOUR rather than pinning either, so it goes red only
  when the two stop agreeing.
- **A FILTER AND A TAB COMPOSE.** Measured: `status=AWAITING&category=EDUCATION` in one request,
  with both values in the URL. **Requires Attention has the opposite defect** - a Severity filter
  set against a severity TAB is silently discarded there and the tab's value sent instead. The step
  names that in its failure message, so if this ever regresses the two get settled together.
- **An unrecognised `?activeFilter=` falls back to All and rewrites the URL.** So does an empty
  value, and so does a value in the wrong case (`approved`). **The candidate portal's own profile
  has the same shape of routing gap and does NOT fall back** - an unrecognised `?selectedTab=`
  there leaves no tab selected and renders no panel. Each case is its OWN scenario: as halves of
  one, Cucumber's abandon-at-first-failure would stop the control executing the day the
  unknown-value case broke, and the diagnosis would then rest on a measurement nobody was taking.
- **The mandatory-reason gate REJECTS WHITESPACE.** `"   "` leaves the submit control disabled on
  both dialogs. That is the case the Contact Us description field and the Candidate Details name
  fields both get **wrong**, and it is the one thing standing between a mis-click and an
  irreversible decision. A single character is accepted, so there is no minimum length.
- **Searching from page 2 resets to `page=1`** and drops the page from the URL.
- **Clear All applies immediately and leaves the modal open** - the URL loses its filter params,
  the badge drops back to "Filters" and a request fires, all without Apply.

### >>> AN ACCESSIBILITY DEFECT THAT DISSOLVED UNDER A CONTROL - DO NOT RE-FILE IT <<<

A 40-press Tab walk **never lands on View or Download**, and `button.focus()` does not focus them
either. Both readings say "the row actions are unreachable by keyboard", both look exactly like the
dashboard's "View all" defect, and **BOTH ARE WRONG.**

This is a **react-aria grid with a roving tabindex**: the ROW is one tab stop and the cells inside
it are reached with the **ARROW KEYS**. Measured end to end:

```
Tab x3          -> TR[row]
ArrowRight x7   -> document name -> candidate -> email -> type -> date -> status -> View
Enter           -> the review panel opens
ArrowRight x8   -> ... -> Download
Enter           -> the file is delivered (4-mb-example-file.pdf)
```

So both actions are **reachable AND operable**, and a Tab-only audit would have filed a phantom
defect. `auditRowActionKeyboard()` drives the arrow-key model on purpose, takes a CONTROL (the
search box must be Tab-focusable, or "nothing focused" is just a broken walk), and the scenario
then **presses Enter and asserts the thing actually happened** - reachable is not operable.

**The lesson generalises: an accessibility audit must drive the interaction model the component
actually has.** The dashboard "View all" finding is real precisely because those are bare `<span>`s
with no grid semantics to fall back on; this one is not.

The row's candidate name and email buttons carry `tabIndex -1`, which is **correct** for a grid cell
under a roving tabindex - they are reached by ArrowRight like everything else. Nothing asserts them
as a defect.

### Assertions worth keeping exactly as they are

- **The panel is compared against THE ROW THAT WAS CLICKED**, never against a string from the
  Gherkin. A queue that always opened the first row's document would satisfy a bare "a panel
  opened" check, and that is a disclosure problem as much as a rendering one. Four fields are
  compared - name, type, status and date.
- **The decision gating is asserted in BOTH directions and the step REFUSES TO PASS without both
  cases.** A Needs Review document must offer Approve and Request Revision; an Approved or Revision
  Required one must not (measured: it offers only Close / Zoom out / Zoom in / Download /
  View profile). A gating rule checked against documents that are all in one state proves nothing
  and would go green for exactly the reason a drifted fixture made the candidate view-profile's
  Basic Information scenario pass vacuously.
- **Two measured ABSENCES are the assertion**, which is why the request log is installed from
  `hooks.js` / `PagesFixture.js` **before the first navigation**: re-choosing the tab already
  selected fires no request, and opening the review panel fires none either (it re-renders data the
  listing already holds). A `waitForResponse` there resolves to null, which is indistinguishable
  from a timeout, a slow network or a listener attached too late.
- **Counts compared against counts use the SERVER's `count`** (`lastListCount()`), never the
  rendered row count - the render is capped at `page_size`, so two result sets differing only past
  the first page look identical on screen.
- **`every listed document name should contain the search term` refuses to pass on an empty list.**
  A step that goes green having inspected nothing retires the assertion silently.
- **The columns are asserted EXACTLY and IN ORDER.** An extra column silently shifts every cell
  index the row readers depend on (Uploaded By=1, Document Type=2, Date Uploaded=3, Status=4).
  Note the Document Name cell is a `<td role="rowheader">`, so it really is index 0 - `readRows()`
  was right and a first MCP pass that assumed otherwise read the date as the status.
- **The reason-field cap is asserted on what the field HOLDS** (600 typed -> 500 held), not on its
  `maxlength` attribute: a form that accepted the overflow and merely declared a limit would pass
  an attribute-only check.
- **Filter options are clicked with a REAL Playwright pointer click**, never `element.click()` -
  the labels carry `data-react-aria-pressable` and ignore a scripted click. A mixed pass through
  the SuperAdmin Candidates modal once reported three working checkbox groups as ignored by the app.
- **`readFilterOptions()` walks every `<label>` in DOM order** and `selectFilterOption()` clicks by
  the index that same pass produced. The Document Type labels carry a test id, the Date Uploaded
  controls do NOT, so a testid-only reader sees 3 of 5 and any assertion counting them passes
  having inspected three.
- **Options are matched on their EXACT label**, never a `filter({hasText})` substring.
- **The unsafe-term step watches for a native DIALOG and for injected `<script>` elements**, not
  just for a non-500: Playwright dismisses dialogs automatically, so without a listener an executed
  term would leave no trace at all.
- **Multi-check steps collect every problem and throw once.** The tab table, the filter table, the
  search variations, the gating table, the reason gate and the row-action sweep each have three to
  ten independent cases; Cucumber abandons at the first failing step, so reporting only the first
  would hide whether the rest share a cause.
- **Every table-driven step carries an explicit `{ timeout }`.** `features/support/hooks.js` calls
  `setDefaultTimeout(60000)` and **that overrides the profile's own `timeout`** - this profile asks
  for 300000 and gets 60000. A step that opens three documents, each costing a ~14s PDF render, is
  many times a normal step's work, so without a budget of its own it is killed part way and reports
  "function timed out", which says nothing about the app. **This trap has now bitten seven areas in
  this repo.**

### The queue is shared, volatile DEV data

It runs to 25 pages and other people upload to it, so **no scenario pins a document, a count or a
total**. Search terms are DERIVED from the first row on screen wherever the assertion is about
matching; the panel is compared against the row it was opened from; and the end-to-end scenario's
"the queue came back showing what it showed before" failure message says to re-run before reading a
changed first row as a defect.

### Every phrase is worded "... Verifications ...", "... the queue ..." or "... the review panel ..."

Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
**ambiguous** step - neither a pass nor a failure, and easy to miss in the summary (playwright-bdd
fails generation on it instead). **`steps/document-verification.js` already owns a queue
vocabulary** (`the agent opens the verification queue`, `the queue should list no documents`, `the
queue should show an empty state`), and every one of those steps drives a document IT uploaded, so
they could not be reused here even if the wording were free.

Five phrases had to be renamed during the dry-run to avoid a collision, which is exactly what that
dry-run is for: `the queue should list no documents`, `I press Escape`,
`I should be on that candidate's profile page`, `the Filters button should show no applied-filter
count` and `the URL should not have changed`.

Exactly **one** phrase is reused, and only because it is genuinely page-agnostic:
`Given I am logged in as an agent` (`steps/active-candidate.js`, via `utils/resilientSignIn.js`).

`npx cucumber-js -p verifications --dry-run` reports **24 scenarios / 261 steps, 0 undefined, 0
ambiguous**, and `node scripts/check-profile-selection.js` confirms the new profile selects 49, the
default profile picks the file up, and no other profile's selection changed.

## Invite via Email (`features/Agent_Portal/Invite-candidate.feature`)

The invitation modal itself - its chrome, its email chip field, sending, and every documented
entry point into the flow (TFF-36, TFF-135, TFF-89, TFF-313, TFF-410, TFF-216). Implemented
2026-08-29; before that all 14 scenarios were Gherkin with **83 of 172 steps undefined**, so
every scenario reported `undefined`, which is why running it "failed everything".

- **`npm run test:invite-candidate`** (`-p inviteCandidate`) - all 20 scenarios. Needs network +
  the IMAP inbox, must run **serially**, no payments.
- **`npm run test:invite-candidate:read-only`** (`-p inviteCandidateReadOnly`) - the 10 scenarios
  that create NOTHING: the modal's chrome, the chip field, validation, the entry points, the KPI
  tiles and the dashboard "View all" links. No invitation is ever sent, so this is the cut to run
  while iterating on a locator. ~4m.
- Steps live in **`steps/invite-candidate.js`** (PART 5) - see that
  file's header for why the whole Agent-Portal candidate area shares one step file. The page
  object is `CandidateOnboardingPage`; the chip readers were added to it for this feature.
- 20 scenarios / 249 steps, 0 undefined, 0 ambiguous (measured 2026-09-09 with --dry-run).

### A TARGETED RUN REPORTS 0 SCENARIOS UNLESS YOU NAME THE PROFILE

The same trap already recorded for the document-verification module, and it now applies here:
`@invite-candidate` is excluded from the default profile, so anything that does not name a
profile matches nothing. Measured 2026-08-29 on this feature file:

| Command | Result |
| --- | --- |
| `npx cucumber-js features/Agent_Portal/Invite-candidate.feature` | **0 scenarios** |
| `npx cucumber-js <file> --tags @invite-candidate` | **0 scenarios** |
| `npm run test:invite-candidate` | 20 scenarios |
| `npx cucumber-js -p inviteCandidate <file>:43` | that one scenario |
| `npm run test:only -- <file>:43` | that one scenario |

**The second row is the one that catches people.** A CLI `--tags` is **ANDed** with the
profile's own tag expression, never a replacement, so `@invite-candidate` AND
`not @invite-candidate` is always empty. Only a profile whose own tags admit the scenario will
run it.

**The VS Code Test Explorer runs the DEFAULT profile**, so a scenario clicked in the gutter
would report 0 and show as skipped. `configs/vscode-cucumber-runner.js` (REMOVED 2026-10-06 with Cucumber - see "Running a scenario from VS Code") auto-selected a
profile from a TABLE of default-excluded features rather than the single doc-verification case
it used to carry - `Invite-candidate.feature` -> `inviteCandidate`,
`invite-candidate-bulk_upload.feature` -> `bulkUpload`, `candidate_onboarding_e2e.feature` ->
`candidateE2E`, the Community files -> `community`. Verified 2026-08-29 through the shim: the
whole file resolves to 20 scenarios and a `file:line` target to exactly one.

**Note that clicking one in the gutter really does spend what the exclusion protects** -
permanent candidates here, permanent uploads for doc-verification. The shim makes the run
possible; it does not make it free.

### >>> `@invite-candidate` IS EXCLUDED FROM THE DEFAULT RUN <<<

Ten of the twenty scenarios send real invitations and **a candidate CANNOT BE DELETED**, so a
default run would add roughly ten permanent rows to `AGENT_EMAIL` every time. `not
@invite-candidate` was added to the default profile's tag expression alongside
`not @candidate-e2e`, `not @bulk-upload`, `not @creates-community` and `not @doc-verification`,
the other unrecoverable-resource exclusions.

**Everything here runs as `AGENT_EMAIL`**, pinned by a `Before` hook that also SIGNS IN before
any step runs - section 3 opens with the shared `Given I am on the Agent Dashboard`, which
unauthenticated bounces to /login and then spends its whole 60s budget on a heading that cannot
arrive. The one exception is the entry-point pair, whose own Given signs in as the
zero-candidate agent: the dashboard's onboarding CTA exists only for one, and those scenarios
only OPEN the flow. `inviteFixtureGuard()` is the backstop.

### >>> THE ADDRESSES IN THE GHERKIN ARE LABELS, NOT MAILBOXES <<<

`appears.here@university.edu` is not deliverable and, being fixed, would already hold an account
after the first run - so every sending scenario would silently be exercising the
duplicate-account path instead of a first invitation. `inviteeFor()` maps each label to a fresh
address on the real **bytecorp** inbox, once per scenario, and the mapping is attached to the
report so a row is traceable to the account it created. Non-sending scenarios use the literal
string, because there the string itself is the subject of the assertion.

**bytecorp, never anonaddy**: anonaddy STRIPS the `+alias` on delivery, and the candidate
invitation shares the AGENT invitation's exact subject ("Join Talentforge"), so the recipient is
the only thing left to tell two mails apart.

### The chip field, measured (2026-08-29)

`scripts/probe-invite-chips.js` (the DOM) and `scripts/probe-invite-chip-rules.js` (the rules).
Both read-only; neither sends anything.

| | |
| --- | --- |
| a chip | `<span>addr<button aria-label="Remove addr">` - the aria-label is the ONLY hook carrying the address |
| input | `[data-testid="agent-invite-email-input"]` |
| inline error | `<p class="text-sm text-error-primary" role="alert">Please enter a valid email address.</p>` |
| commit keys | **Enter, Tab, comma** |
| trimming | surrounding whitespace stripped |
| duplicates | collapse **client-side**, case-insensitively, before anything is sent |

The error reader is scoped to the MODAL: the bulk CSV zone below it raises its own errors under
the same `role="alert"`, so an unscoped read would report a file-format refusal as an email
validation error.

### Seven product findings, all `@known-issue`, all measured

1. **>>> SPACE DOES NOT COMMIT A CHIP. <<<** Enter, Tab and a comma each turn the address into a
   chip and clear the input; a Space leaves it in the input with a trailing space and creates
   nothing. TFF-36 lists Space as a commit key. The Space row sits **after** the Enter row on
   purpose - first failure wins, so with Space first this one defect cost the paste, removal and
   button-state assertions below it.
2. **Three of twelve malformed addresses are accepted as recipients.** Nine are refused
   correctly. `spaced name@domain.com` is **SILENTLY TRUNCATED to `name@domain.com`** and
   committed (an error IS shown, but a recipient the agent never typed is now queued);
   `user@-domain.com` and `<script>alert('xss')</script>@x.com` are committed with **no error at
   all**. The payload does **not** execute - no native dialog, no injected `<script>` - so this
   is input validation, not XSS. **The two assertions are separate steps on purpose**: "it
   raised no error" and "it became a recipient" are different failures with different
   severities, and one step reporting both could not say which.
3. **The In Progress invite button reads "Invite Candidate", the AC says "Invite candidate".**
   Words and singular right, capital C wrong. **Split into its own scenario** - inside the
   entry-point walk it cost the two entry points after it, neither of which has anything to do
   with a capital letter.
4. **The top-row KPI tiles are figures, not controls - but each section CARD's "View all" routes
   correctly, and that distinction is the whole finding.** Mapped live 2026-09-09 on AGENT_EMAIL
   (83 candidates):
   - **KPI tiles** (label + a bare number): Total Candidates 83 (with a Monthly / Quarterly /
     Yearly / YTD selector and "2075% of Monthly Target"), Active Candidates 6, Onboarding in
     Progress 77, Requires Attention 2. **Not one has an interactive ancestor** - no `href`,
     `role`, `tabindex`, React `onClick` or pointer cursor out to `<main>`.
   - **Section cards**, each with a working "View all": Document Verification Queue "154 Items"
     -> `/verifications?activeFilter=ALL`; Requires Attention "17 Items" ->
     `/candidates/requires-attention?activeFilter=all`; Active Candidates "37 Candidates" ->
     `/candidates/active?activeFilter=all`. All three verified to land on a rendered listing
     (11 rows each), not merely on the right URL.
   - **Referral Codes has no "View all"** - Agent Code + Promo Code, each with Copy Code and
     Share Code, nothing navigational. It has no routing row for that reason.
   - Param casing is inconsistent - `activeFilter=ALL` on the verifications route against
     `activeFilter=all` on both candidate routes. Recorded, not asserted.
   - **"Active Candidates" and "Requires Attention" EACH APPEAR TWICE** (once as a tile, once as a
     card heading), so a label-only locator cannot tell them apart: the KPI reader keys on the
     label being followed by a bare number, the "View all" reader on the card owning the link.
     The build also renders the fourth tile as "Requires Attention" where TFF-36 says "Pending
     Verifications"; the step maps the story name onto the rendered one.
   - **Question for the PO:** given every section card has a working "View all", is the KPI tile
     meant to be clickable at all, or is TFF-36's routing requirement already met by these links?

5. **~~TFF-89’s dashboard success pair is UNREACHABLE~~ - WITHDRAWN 2026-09-09. It is reachable,
   it works, and this entry was reporting a product gap that does not exist.** The two post-send
   CTAs are context-sensitive by design - each pair offers "stay here" plus "go to the other
   place": `/candidates/in-progress` gives "Stay on In Progress" / "Go to Dashboard", the
   DASHBOARD gives "Stay on Dashboard" / "Go to In Progress". Both work (re-measured live, and
   confirmed by hand by the PO).
   - What is true is only that the dashboard route is **gated on candidate count = 0** and is
     therefore available **exactly once per agent**. Measured 2026-09-09, both accounts in one
     run: `AGENT_EMAIL` (77 candidates) renders **no invite control anywhere** on the dashboard,
     `onboardCandidatesButton` count **0**, and no welcome modal even after clearing
     `sessionStorage.agent_welcome_shown` and reloading; a zero-candidate agent renders the
     welcome modal with "Onboard Candidates" **and** the Active Candidates empty state's
     "Invite Candidates".
   - **The conclusion drawn from that was wrong.** "No reusable fixture can drive it" is not
     "the product cannot be observed" - a **throwaway** agent can, and the machinery was already
     in this repo (`provisionAgentWithoutPromo()`, as `test:welcome-onboarding:provision` uses).
   - So the scenario was **split into two `@provision` scenarios**, one per route, each minting
     its own throwaway and abandoning it. Two, not one, because the route is spent by the first
     invitation - asserting both routes needs two agents either way, and a merged scenario's
     first failure would hide the second route. `@known-issue` came off both.
   - The old single scenario failed for an entirely different reason: the `@invite-candidate`
     `Before` hook pins every sending scenario to `AGENT_EMAIL` with `from: 'candidates'`, so
     `Given I am on the Agent Dashboard` was silently overridden, the send happened from In
     Progress, and the step then reported that the modal "does not offer Stay on Dashboard" - a
     true statement about the In Progress path that says nothing about the product. **A hook that
     overrides a `Given` is worth suspecting first whenever a scenario's failure message contradicts
     what the Gherkin says it did.**
6. **TFF-313 gets a full modal, not a plain sentence.** Inviting from In Progress renders
   `"Invitations sent! | Track who’s still pending... | Stay on In Progress | Go to Dashboard"`
   plus a toast `"Emails sent successfully"`. The AC asks for `"Invitation sent successfully."`
   with no navigation options.
7. **The invitation email’s CTA reads "Set up my account"**, the AC says "Set up your account".
   That assertion is LAST in its scenario on purpose - everything before it (the row, the status,
   the count, delivery, the setup link, the icon) passes, and a possessive pronoun must not cost
   those six. Same rule as the receipt-PDF currency step.

8. **None of the three "View all" links is a real control.** Each is a bare `<span>` carrying a
   React `onClick`: no `<button>`, no `role`, no `href`, no `tabindex`, no test id. They work
   with a mouse and are **unreachable by keyboard and invisible to a screen reader** - the same
   defect class as the candidate-profile upload controls being bare `<svg class="add-icon">`.
   It is asserted in its own scenario, because the routing scenario beside it PASSES and Cucumber
   abandons at the first failure.
   - **VERIFIED FOUR WAYS, not inferred from the markup**
     (`node scripts/probe-dashboard-view-all-a11y.js`, 2026-09-09): a real **80-press Tab walk**
     cycled the whole dashboard **twice** and never once landed on a "View all" - the stops are
     Dashboard, Candidates, Verifications, Activity Log, En, Notifications, FM, Monthly,
     Copy/Share Code x2, Review x5, the candidate row, then back to the top; the **accessibility
     tree** exposes each link as `generic`, not `link` or `button`; **Enter and Space do
     nothing**; and as a **control**, a real `<button>` on the same page ("Share Code") focuses
     fine with `tabIndex` 0 - without that last check "nothing focused" could just mean the walk
     was broken.
   - `el.tabIndex` is **-1** and `focus()` **does not focus it even programmatically**, so a
     keyboard user has no route to it at all.
   - **The styling gives the intent away**: the span carries
     `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600`, i.e. a focus
     ring styled for a state the markup can never produce. The whole element is
     `<div class="... cursor-pointer"><span class="... underline text-brand-700">View all</span></div>`
     with the `onClick` on the span. So this reads as an oversight, and **the fix is a role plus a
     tabindex (or a real `<button>`), not new styling.**
   - **SEVERITY QUALIFIER, and it belongs in the ticket:** every destination IS keyboard-reachable
     through the sidebar, which has proper `<a href>` links with `tabIndex` 0 (Active, In
     Progress, Deactivated, Requires Attention, Verifications). So the defect blocks the
     **shortcut**, not the listings. WCAG 2.1.1 Keyboard (A) and 4.1.2 Name, Role, Value (A).
   - It is also why this coverage did not exist until now: a dump of every `button` / `a` /
     `[role]` in `<main>` returns 46 controls and **not one "View all"**, so a role-based reader
     reports the links as absent on a dashboard that plainly shows three.

**A green run means exactly those SEVEN are red and nothing else is** - finding 5 was WITHDRAWN on 2026-09-09 (it is not a product gap; see above), and the two scenarios that replaced it PASS.

### Expected baseline (measured 2026-08-29)

`npm run test:invite-candidate` - **20 scenarios, 13 passed / 7 failed** is the DERIVED baseline
after the 2026-09-09 TFF-89 split, and it is derived, NOT measured: the two new scenarios were
each verified individually (below) but no full run has happened since. **Run one and replace this
line with the measured figure.** The 17 / 10 / 7 / 8m 47s it supersedes was measured 2026-08-29,
when finding 5 was still being counted as a red.

The two dashboard success-route scenarios, measured 2026-09-09: **2 scenarios, 30/30 steps,
1m 59s.** Each minted its own throwaway agent (verified at `totalCandidates: "0"` with the welcome
modal rendering), and both read the pair the AC asks for, verbatim: `"Invitations sent! | Track
who’s still pending, who’s started onboarding, and what’s next from Candidates → In Progress. |
Stay on Dashboard | Go to In Progress"`, plus a toast `"Emails sent successfully"`. Stay on
Dashboard keeps the agent on `/dashboard`; Go to In Progress reaches `/candidates/in-progress`.
`npm run test:invite-candidate:read-only` - **8 scenarios, 4 passed / 4 failed, ~3m** (findings 1,
2, 3 and 4).

**What one full run costs:** ~11 permanent candidate accounts and invitations on `AGENT_EMAIL`,
plus **2 throwaway agents** (a live superadmin invite + IMAP round trip each), each carrying one
permanent candidate of its own; one refused invitation; and 3 invitation emails read out of the
live inbox. No payments. The three
failure scenarios and both entry-point scenarios cost nothing - they fail or finish before any send.
`@needs-clarification` questions for the PO except #4, which already carries one.

### The dashboard CTA only paints once `/candidate/stats/` answers

The dashboard renders a literal `-` for every KPI until the stats arrive, and the Active
Candidates card only swaps in its empty state - CTA included - afterwards. A read taken before
that finds the dashboard's own chrome and **no CTA**, which reads as "the control does not
exist" for one that appears a second later. Reproduced both ways on 2026-08-29: present on a
settled dashboard, absent on a run that read it immediately. So the step waits for
`dashboardReady()`, dismisses whatever modal is covering it, and then **polls** for the control
rather than sampling once. Same class as the KPI `-` placeholder already recorded for the
welcome feature.

**The build labels that same control "Invite Candidates" (plural)** where TFF-216 says "Invite
Candidate", so it is matched as a SUBSTRING and the rendered label is attached - an anchored
regex is additionally at the mercy of whatever an icon contributes to the accessible name, which
is what made an anchored match fail against a button whose own innerText was in the failure
message.

### Three suite defects the first send run exposed, all fixed

Both read as product defects, and both were the class this repo already records several of.

- **The three-failure scenario was BROKEN, not merely untidy.** It carried three
  `Given`/`When`/`Then` triples, and `no row for ... should be created` SEARCHES the In Progress
  list - which navigates away and closes the modal. The second `When I click "Send Invites"` then
  waited out its full timeout on a button no longer on screen, reporting `locator.click: Timeout
  30000ms exceeded` for what was a step-order problem. **Split into one scenario per failure
  mode** (service / network / session), which also fixes the older complaint that the first broken
  rule hid the other two. Same call as section 4 of `candidate_onboarding_e2e.feature`.
- **The duplicate-account check reported "nothing explains why" against a message that explains it
  perfectly.** Measured: the app answers `422 {"emails":{"<addr>":"This candidate is already
  assigned to you."}}` and shows the agent that exact sentence; the step’s pattern looked only for
  "already has an account" / "already exists". It now matches the SHAPE of the explanation
  (assigned / registered / invited / already a candidate / duplicate) rather than a pinned
  sentence - pinning one would go red on a rewording and, first failure wins, cost the
  no-duplicate-row assertion after it.

- **`no invitation should have been sent to ...` could not read the list after the session
  scenario had destroyed the session.** That scenario asserts the negative AFTER the app has
  bounced the agent to /login with the 401 stubs still armed, so an unauthenticated navigate lands
  back on /login, the search box never appears, and the step spent its whole 240s budget reporting
  `locator.fill: Timeout` against a control that cannot exist - a broken-locator message for a
  missing session. It now unroutes the stubs and re-authenticates FIRST. Deliberately in the step
  and not inside `countRowsFor()`: that helper is shared with the bulk-upload feature and runs in a
  poll loop, so a login attempt per iteration would be both wrong and slow.

### The three failure scenarios are driven by intercepting the app's own request

There is no UI path to a 500, and taking the machine offline would break the suite's own IMAP
and reporting. So `the invitation service will fail` / `the network is offline` / `my session has
expired` each `page.route()` the invite endpoint and answer 500 / abort
`internetdisconnected` / answer 401. The session one **also stubs `/auth/token/refresh/`**,
without which the app renews the session and retries - and the scenario would then be asserting
a successful send. `route.abort()` rather than `context.setOffline()` for the same reason the
error is scoped: offline mode cuts the page's other traffic too and the failure could then be
attributed to anything.

### Assertions worth keeping as they are

- **The double-click sampler runs in PARALLEL, and the two clicks have no await between them.**
  By the time a sequential read happens the request has usually landed and the button is enabled
  again, so a single read cannot tell a button that was never disabled from one that has already
  recovered - the distinction `saveStaysDisabled()` exists to make in the promo module. A
  refused second click is the CORRECT behaviour and is recorded, never thrown.
- **`the Invitation Success modal should not be displayed` watches a WINDOW.** A "not visible"
  read is also true of a modal the app has not rendered yet, so a single check on a settling
  page reports "no success modal" for one that appears a second later - and that step exists to
  prove a refusal produced none.
- **Rows are found by SEARCHING and polled for EQUALITY.** This agent's In Progress list runs to
  30+ pages, and a candidate invited twice is as much a defect as one not invited at all, so
  `at least one row` would pass on the very duplication the dedupe scenario exists to catch.
- **Delivery, then the link, then the wording.** If the mail never arrived, "the CTA is wrong" is
  noise that sends the reader after a copy bug. The setup link is **resolved through its
  SendGrid wrapper** before being asserted - the raw href is a tracker, so asserting on it would
  pass on a link that redirects anywhere at all.
- **The duplicate-account refusal asserts the REFUSAL first and the wording second, and the AC's
  own string is deliberately NOT pinned.** Measured 2026-08-27 the app refuses at INVITE time
  with HTTP 422 - earlier and better than the AC, which has this refused when the candidate opens
  their setup link. Pinning an unmeasured wording would go red on a synonym and, first failure
  wins, cost the no-duplicate-row assertion after it.
- **"without exposing the other agent's data" asserts a LEAK, not a sentence.** The AC does not
  say what the agent should be told, so the step checks that no other agent's name or address
  appears in what was surfaced. A step pinning an unmeasured sentence would report a wording nit
  where the finding that matters is a disclosure.
- **TFF-313's plain success message is asserted as written and fails.** Measured 2026-08-27 the
  two success CTAs are context-sensitive - inviting from `/candidates/in-progress` offers "Stay
  on In Progress" / "Go to Dashboard". `readSuccessSurface()` reads the modal AND any toast, so
  a red row says which arrived; a reader looking for only one of them could never report that.


## Agent Portal welcome + onboarding methods (`features/Agent_Portal/invite-candidate_welcome_onboarding.feature`)

The first-time welcome modal, the "Choose how you want to onboard your candidates:" chooser and
the Share Agent Code modal it opens (TFF-36, TFF-158, TFF-467). Implemented 2026-08-27; before
that the whole file was Gherkin with **62 undefined steps**, so every scenario in it reported
`undefined` and nothing was being tested.

- **`npm run test:welcome-onboarding`** (`-p welcomeOnboarding`) — the 11 read-only scenarios.
  No invites, no payments, no fixture spent. **This is the one to run.**
- **`npm run test:welcome-onboarding:provision`** (`-p welcomeOnboardingProvision`) — the 1
  scenario that really invites a candidate. Costs a live superadmin invite + IMAP round trip +
  one candidate invite, and spends that agent's zero-candidate state for good. No payments.
- Steps live in **`steps/invite-candidate.js`** (PART 2), the file that
  already owns the whole Agent-Portal candidate area — see its header for why a second step file
  would only duplicate the login helper, the page objects and the teardown. The page object is
  **`pages/CandidateOnboardingPage.js`**, wired into `hooks.js`.
- 12 scenarios / 133 steps, 0 undefined, 0 ambiguous.

### >>> THE WELCOME MODAL IS NOT GATED ON "FIRST LOGIN", WHICH IS THE WHOLE FIXTURE STORY <<<

TFF-158 words it as "shown on first login only and never again". Measured 2026-08-27 across five
accounts, it is nothing of the sort:

- **It renders on EVERY fresh sign-in of any agent whose candidate count is 0**, and never for an
  agent that has candidates. Four long-lived fixtures that have each signed in dozens of times
  (`REFERRAL_NOPROMO_AGENT`, `TWOFA_AGENT`, `PROMO_FIXED_AGENT`, `PROMO_LIMITED_AGENT`) all showed
  it; `AGENT_EMAIL` (41 candidates) and `PROMO_UNLIMITED_AGENT` did not.
- **What suppresses it once seen is `sessionStorage.agent_welcome_shown === '1'`**, written
  client-side on dismissal. **No request is fired, no cookie is set, nothing is stored
  server-side** — verified by watching every request, and by diffing cookies, localStorage,
  sessionStorage and IndexedDB across a dismissal.
- sessionStorage is per TAB, so the flag survives a reload (a reload re-authenticates through
  `POST /auth/token/refresh/`, not `POST /auth/token/`) but not a new browser context.

Three consequences that the whole design here rests on:

1. **Looking at the welcome modal consumes NOTHING.** Every Cucumber scenario gets a fresh
   context, so the modal is up again at the start of each one. That is why 11 of 12 scenarios are
   read-only and run against the shared zero-candidate fixture.
2. **"Log out and log back in" in one tab proves nothing on its own** — the flag alone would keep
   the modal down whatever the app's rule is. `clearWelcomeSuppression()` is called by every step
   that claims to start a new session, so the assertion tests the app instead of its own leftover
   state.
3. **The `@needs-clarification` scenario MEASURES which rule the app follows rather than pinning
   one.** Recorded live: `welcomeModalDisplayed: true` on a new session at
   `totalCandidates: "0"`, i.e. the build gates on the candidate count. **Ask the PO which is
   intended before tightening TFF-158 into an assertion.**

### Fixtures: only one scenario is `@provision`, and the guard is deliberate

- The read-only scenarios use `WELCOME_AGENT_EMAIL` / `_PASSWORD`, which **default to
  `REFERRAL_NOPROMO_AGENT`** — the suite's canonical zero-candidate agent, and the promo module's
  read-only Case 4 fixture. Reading it is explicitly safe; inviting as it is not.
- **`inviteFixtureGuard()` REFUSES to send an invite as a long-lived fixture and throws.** An
  invite takes the agent off zero candidates permanently and nothing anywhere removes a candidate,
  so one careless run would destroy every welcome scenario in this file *and* every promo
  empty-state scenario. A scenario that reached it by accident must fail loudly rather than spend
  a fixture nothing can rebuild — same rule as `AgentsListingPage.confirmDeactivate()` refusing
  Transfer & Deactivate.
- The `@provision` scenario mints its own agent through `provisionAgentWithoutPromo()` and
  **abandons it** (there is no way to delete an agent, and deactivating one would send a live
  email). The `After` hook records what was created and never throws.
- `agent-one` / `agent-two` in the uniqueness scenario are **mapped in the step file**, not in the
  Gherkin, so the feature file carries no `.env` keys. Neither agent is mutated: the agent code is
  generated by the app on invite acceptance and no control anywhere edits it.

### Two entry points, and they are NOT interchangeable

- **`/dashboard`** — only through the welcome modal's `agent-onboard-candidates-button`, so only
  for a zero-candidate agent. There is no other onboarding control on the dashboard; the two
  "Share Code" buttons belong to the Referral Codes section and open a *different* modal
  (`ReferralCodesPage`).
- **`/candidates/in-progress`** — the "Invite Candidate" button, available to every agent.

So a scenario that ends by asserting it is back "on the Agent Dashboard" **has** to have opened
the chooser from the dashboard. `openChooserFromDashboard()` is that path and
`openChooserFromCandidates()` is the one the two-arbitrary-agents scenario needs.

### The story's modal names are not the titles the app renders

| The feature file says | The app titles it |
| --- | --- |
| Choose Onboarding Method | Choose how you want to onboard your candidates: |
| Share Agent Code | **Agent Code** |
| Send Onboarding Invite | **Invite via Email** |

The story names are the card LINK labels ("Share agent code" / "Send onboarding invite"), not the
headings. `CandidateOnboardingPage.MODALS` maps one onto the other — the same thing
`CommunityPage.FILTER_TRIGGER_LABELS` does for filter naming — so a step can say
`the "Send Onboarding Invite" modal should be displayed` and still be checked against what the
build paints. Every step that reads a modal **attaches the rendered title**, so the divergence is
recorded rather than silently tolerated.

### `title` and `body` regexes are separate, and conflating them breaks every locator

Playwright's `filter({ hasText })` tests an element's **whole** text content, so an anchored title
regex can never match a dialog: the chooser's own text is
`"Choose how you want to onboard your candidates: | Invite via Email | Send an email invitation
… | Share agent code"`, and `/^Choose … candidates:?$/` fails on it. Using the title regex as a
filter is how the first live run reported the chooser **"not displayed" while its own error
message quoted the correct title back**. Hence two regexes per modal:

- **`body`** — a phrase that modal owns outright, used to FIND it. Deliberately not the heading:
  the chooser and the invite modal both contain the words "Invite via Email".
- **`title`** — the exact heading, used to resolve a story name and to assert wording.

### >>> TWO MODALS ARE VISIBLE AT ONCE WHILE ONE REPLACES ANOTHER <<<

Measured 2026-08-27 (`scripts/probe-onboarding-reopen-loop.js`): for a beat after "Onboard
Candidates" is clicked, the welcome modal **and** the chooser are both attached and visible. This
produced two separate wrong-element bugs, both of which read as app defects:

- **`openModal()` tested the four modals in a fixed key order** and so reported the STALE one. A
  live run said the Share Agent Code modal had not opened while its own evidence showed the click
  had worked. It now reads every visible dialog and returns the **topmost** (last in document
  order) — the one the app has just pushed. `renderedTitle()` reads the topmost too. Same
  DOM-order trap this file already records for comma-separated locator unions, one layer up.
- **`I click {string}` scoped to `[role="dialog"]`.first()**, which mid-transition is the
  *outgoing* modal — holding no matching button. The lookup found nothing, fell through to the
  page-level fallback, and clicked **the dashboard's own `button[aria-label="Copy Code"]` behind
  the overlay**, failing with `"Or share via" … subtree intercepts pointer events`: a
  pointer-event error for what was really a wrong-element resolution. The branch in
  `common.steps.js` now walks every visible dialog newest-first. **That branch has to stay** — the
  Referral Codes section renders two "Copy Code" controls above the modal in the DOM, so the bare
  fallback can never be trusted for this label.

### The dashboard renders `-` before its figures arrive

`Total Candidates` and the other three KPI widgets paint a literal **`-`** until
`GET /candidate/stats/` answers. Waiting for the *label* is not enough: a read taken in between
finds the label and a value of `-`, which the reader reports as "no figure" — and a live run
failed with `label nodes: [{"raw":"-","numeric":false}]` on a dashboard showing `0` a moment
later. So `dashboardReady()` waits for the first figure to be **numeric**, and
`readKpiWhenSettled()` polls; a genuinely absent figure is still reportable because the
placeholder is carried in `candidates`.

**"Active Candidates" and "Requires Attention" each appear TWICE on the page** — once as a KPI
label and once as a list-section heading — so the label alone cannot identify the widget. The KPI
is the one whose label node is immediately followed by a sibling holding a number; read
structurally, so the palette and size classes stay free to change.

### `waitForModalGone()` alone is not evidence of absence

It resolves the instant the locator matches nothing, which is also true of a modal the app has
not rendered **yet** — so on a dashboard still painting it answers "gone" for a welcome modal
about to appear a second later, and three scenarios here would pass having asserted nothing.
`modalStaysAbsent()` watches the whole window instead, and the welcome-absence step waits for
`dashboardReady()` first. Same distinction the promo module's `saveStaysDisabled()` exists to
make.

### Escape does NOT close every modal here, and an overlay blocks the header avatar

Two measurements that between them made the sign-out helper look like it worked when it did not:

- **The welcome modal and the chooser close on Escape; the Share Agent Code modal does not.** An
  Escape aimed at it is a silent no-op, so the overlay stays up.
- **The modal overlay (`div.fixed.inset-0.bg-overlay/70`) swallows the header avatar click.** With
  a modal up, `DashboardPage.openProfileMenu()` retries for its full timeout; with it dismissed,
  avatar → Log out works first time (`scripts/probe-agent-logout.js`).

Together those meant `signOutAndBackIn()` fell back to clearing cookies on **every** run while
reporting nothing amiss — the provision scenario's own evidence read
`signedOutThroughMenu: false`. It now closes whatever modal is open via
`dismissOpenModal()` (X icon first, then Escape, then an outside click, **verifying** the modal is
actually gone), and records which control worked plus the menu failure if it still has to fall
back. **Keep the fallback and keep it recorded** — a silent one is how this hid.

### The invite endpoint, measured once and recorded so nobody has to spend a fixture again

`POST /core/api/v1/agent/invite/candidate/bulk/` → **200** (single address as well as bulk).
The step deliberately does not pin that path — it accepts any non-GET to the API host and reports
whichever URL it saw — because measuring it costs a real invite. It is written down here so the
sibling feature that is still unimplemented (`Invite-candidate.feature`) does not have
to rediscover it. `candidate_onboarding_e2e.feature` and `invite-candidate-bulk_upload.feature`
are implemented now; note the BULK path posts to a DIFFERENT endpoint,
`.../agent/invite/candidate/bulk/file/` (multipart) - see "Bulk candidate invitation". The app's own confirmation that a send was accepted is **the invite modal
closing**; a refusal keeps it open with an inline error.

### Splitting: a known deviation must not mask real coverage

Two assertions were pulled into scenarios of their own, because Cucumber abandons a scenario at
its first failing step and both of these fail:

- **the chooser's X close icon** — out of "Method chooser closes on an outside click", where as the
  first step it took the outside-click coverage down with it.
- **the "6-digit numeric" agent code** — out of the middle of "Agent code modal displays, copies
  and navigates correctly", where it cost the copy, back-arrow and close assertions.

The social-share scenario is *not* split: its step drives all four platforms and reports them
together, so one broken platform still leaves the other three measured.

### >>> THE FACEBOOK "CARRIES NO CODE" FINDING WAS THE SUITE READING FACEBOOK'S REDIRECT <<<

Diagnosed and fixed 2026-08-28. The share scenario was `@known-issue` for two months over a defect
this app does not have, and the symptom that gave it away is worth remembering: **the code is on
screen in the popup for barely a second, then a platform login screen replaces it.**

- **`share()` clicked a platform, waited a fixed 1500ms and read `popup.url()`.** That reports
  where the BROWSER ENDED UP - a function of the platform's own login and content rules, and of
  whether the machine happens to hold a session on that network - not what the product sent.
- **What the app actually sends, measured by wrapping `window.open`**
  (`scripts/probe-agent-code-share-window-open.js`): all four carry
  `Join me on Talent Forge using my agent code: <CODE>`, **Facebook included**.

  | platform | the app opens | the popup lands on |
  | --- | --- | --- |
  | WhatsApp | `wa.me/?text=…code: SZZZCE` | `api.whatsapp.com/send/?text=…SZZZCE` |
  | Facebook | `facebook.com/sharer/sharer.php?quote=…SZZZCE` | `facebook.com/share_channel/?type=empty` |
  | LinkedIn | `linkedin.com/sharing/share-offsite/?url=…SZZZCE` | `linkedin.com/login?session_redirect=…SZZZCE` |
  | X | `x.com/intent/tweet?text=…SZZZCE` | unchanged |

- **The assertion is now the url the app OPENS**, captured from a `window.open` recorder installed
  on the page immediately before the click (an init script would never run - by the time a modal is
  open the page navigated long ago). The landing url is still captured as **evidence**, with its own
  separate code check, because it is what a human watching the popup sees.
- **The real gap is recorded, not asserted.** Facebook's `sharer.php` shares a `u=` (a URL) and
  treats `quote=` as a comment ON that url, so a `quote=` with no `u=` leaves Facebook nothing to
  share and it answers `share_channel/?type=empty` - "empty" being Facebook's own term for a share
  carrying no content. The step attaches that under `codeLostByThePlatformItself` with the question
  for the PO (should the share pass a `u=` as well - a signup link carrying the code?). Failing on
  it would keep the scenario red for as long as Facebook keeps that rule, and a platform discarding
  a correctly formed share is not this product's behaviour. Same call as the receipt-PDF currency
  step and the agent-email "Talentforge" spelling.
- **`PLATFORMS[].host` had to gain `wa.me`.** It is WhatsApp's own short domain and is what the app
  opens; the previous reader only ever saw the redirect to `api.whatsapp.com`, so the pattern had
  never needed it. That one line is the whole cost of asserting intent instead of destination.
- The scenario dropped `@known-issue` and keeps `@needs-clarification` for the `u=` question. It is
  also **8s faster** - the 1500ms-per-platform wait existed only to let the redirect commit.
- `scripts/probe-agent-code-share-urls.js` prints the whole redirect chain per platform with
  timestamps, which is what shows the login screen arriving at ~5s on LinkedIn; the
  `window-open` probe is the one that answers "what did the app send".

### Expected baseline (measured 2026-08-28)

**RE-MEASURED 2026-09-08: 11 scenarios, 10 passed / 1 failed, 6m 50s** (headless). The counts match
the 2026-08-28 line below, but **the red is a DIFFERENT scenario** - do not read the totals alone.

- **The agent-code format scenario now PASSES and is no longer `@known-issue`.** It used to assert
  the sample `"VIS-AG-8472"`, from which the step derived an EXACT positional pattern - three
  letters, a hyphen, two letters, a hyphen, four digits. The build has never produced that, and
  cannot: measured codes are `SZZZCE`, `MZFVYB`, `RHCRKR`, `5GXTVY`, and that last one leads with a
  digit while the others carry none, so **any** positional pattern is wrong on its face. The
  scenario now asserts the build's actual rule - 6 characters, uppercase letters and digits, **no
  hyphen or other separator**, digits optional and unconstrained in position - and is `@positive`.
  It keeps `@needs-clarification`: TFF-467 still words the code as 6-digit NUMERIC, so the length
  agrees and the character set does not. Question for the PO, not a defect.
- **The new red is `The agent code can be shared to every supported social platform`**, which timed
  out at its 180s step budget (the `After` hook's screenshot then timed out too, so the page was
  unresponsive - it looks like a share popup hanging rather than a wrong assertion). It is NOT
  tagged `@known-issue` and was green after the Facebook fix, so **treat it as a regression or an
  environmental hang and re-measure before filing.**
- **The X close icon scenario is GREEN and stable** - 3/3 in isolation and green in the full run.
  It is selected by the default profile too (checked: the whole file dry-runs to 12 scenarios there),
  so a report of it failing is not the "0 scenarios" profile trap. The 2026-08-28 note below already
  called this entry stale; that still holds.

**Two entries left the previous 8/3 baseline, and only one of them was a change made here.**
Facebook (above) was a suite defect. **The X-close-icon entry was already stale**: that scenario
reads `Method chooser offers an X close icon that closes it`, is plain `@positive` with no
`@known-issue`, and asserts what the build does - it had been inverted without the baseline being
re-measured. Trust a run, not this paragraph, and re-measure rather than adjusting it by arithmetic.

`npm run test:welcome-onboarding:provision` - **1 scenario, 16/16 steps passed, 2m 04s.** It
minted `iqra.farooq+welcomeonb…@bytecorp.io`, invited one candidate on the anonaddy inbox
(`POST …/agent/invite/candidate/bulk/` → 200), and the welcome modal **did not return** on a new
session with the suppression flag verified clear - so the "never after the first invite" half of
TFF-158 does hold. The agent is abandoned; it is recorded in the report, not cleaned up.

Note the two halves of TFF-158 therefore measure differently, and that is the finding: the modal
correctly stops appearing once the agent has a candidate, but it does **not** stop appearing after
merely being seen and dismissed.

## Agent email notifications (`features/Notifications/Agent-Email-Notifications.feature`)

Every email TalentForge sends to an **agent**, driven end to end: commit the action in the
superadmin portal, then read the mail out of the live IMAP inbox. Design source is the Figma board
"Email Templates, In-app Notifications & Activity Logs" > **Agent** > **Email Templates** (node
`16044:74781`), which holds **15** templates. `npm run test:agent-emails` is the entry point and
runs the whole matrix - **7 scenarios**, spanning three feature files.

- **`npm run test:agent-emails`** (`-p agentEmails`) - the one command for the whole agent email
  matrix. It is the **only profile in the repo that sets `--parallel`** (2 workers). Costs 3 live
  agent invites, 1 committed email change, 1 deactivate/reactivate round trip and 1 real reminder
  email. **No payments.** Needs network + the IMAP inbox. Writes its own
  `reports/agent-emails-report.json`, not the shared path.
- **Why parallel is safe here and nowhere else.** Every agent these scenarios drive is addressed at
  its own `iqra.farooq+<tag>@bytecorp.io`, and **bytecorp preserves the `+alias` in the `To`
  header** (verified by inbox sweep 2026-08-12), so `waitForEmail`'s `{subject, to}` search tells
  two concurrent scenarios' mail apart. The candidate signups that force `provision` and `promoAll`
  to run serially use `@iqra.anonaddy.com` aliases, which anonaddy **strips** on delivery, leaving
  every concurrent signup indistinguishable in one mailbox. That is the entire difference - do not
  generalise "parallel is fine" from this profile to those.

### THE TWO TRAPS THAT MAKE THIS AREA EASY TO GET WRONG

- **The Figma frame titles are NOT subject lines.** They read like them and they are not: the frame
  `Agent - Your Promo Code Has Been Disabled` is sent as `Your Talentforge promo code has been
  disabled`. Registering a frame title in `emailTypes.js` makes `waitForEmail` time out on a mail
  that arrived perfectly well. **Every subject in the registry was copied from a real message** -
  discover them with `npm`-less `node scripts/probe-talentforge-subjects.js`, never from Figma.
- **IMAP subject search is CASE-INSENSITIVE and a SUBSTRING match.** Measured 2026-08-12: searching
  `"...has been deactivated"` returns all 90 messages, *including* the 27 the app sent as
  `"...Has Been Deactivated"`. So the registry strings are **search keys, not assertions**, and the
  exact subject must be checked against `parsed.subject` separately - which
  `agentEmailEvidence.js`'s `expectSubject()` does. Without that split the casing defect is
  invisible and every scenario looks clean.

### 9 of 15 templates are live; 5 have never been sent; 1 is cron-only

Measured over a 90-day sweep (3,459 messages, 43 distinct TalentForge subjects). The full
template-by-template table, every defect and every recorded decision live in
**`AGENT_EMAIL_FIGMA_VS_APP.md`** - read that before filing anything or re-measuring.

- **Never sent at all:** Verification Delay Reminder, Candidates Transferred, Document Review
  Activity Reminder, and both Candidate-Account Deactivated/Reactivated notices.
- **`Reminder: Log back into Talentforge`** (Figma's "Activity reminder") *is* sent, but its
  18:00:01 delivery times mark it **cron-driven**; nothing in the suite provokes it and it is
  registered for recognition only.
- **The never-sent templates are matched on BODY text, not a guessed subject** (`waitForEmailMatching()`,
  `AGENT_TEMPLATES_NOT_SENT`). This is not a workaround: a guessed subject can only ever answer
  "nothing arrived", which cannot distinguish *"the app does not send this mail"* from *"the app
  sends it under a subject nobody predicted"*, and those are completely different findings. Matching
  the body reports whichever subject the mail lands under, so the day dev implements one the
  scenario turns green **and** names the subject to register.

### Nothing here touches a fixture - every committing scenario owns a throwaway

The neighbouring `Agent.feature` states at the top that **nothing in it mutates an agent** and means
it: every deactivate, reactivate and email-change dialog there is opened and then **cancelled**,
because that file runs against shared DEV agents the promo, referral, invite and dashboard features
all read. These emails are only observable if the action really happens, so each scenario invites
its own agent via `provisionAgentWithoutPromo()`, commits against that, and abandons it.

- **`AgentsListingPage` gained four commit methods** - `confirmEmailUpdate`, `confirmDeactivate`,
  `confirmReactivate`, `confirmSendReminder`. They were the missing half of that page object. **Do
  not call them from a scenario driving a fixture.**
- **`confirmDeactivate()` REFUSES the Transfer & Deactivate variant** and throws instead. That path
  moves real candidates onto another agent and nothing in the portal undoes it, so a scenario that
  reached it by accident must fail loudly rather than reassign somebody's caseload.
- **Throwaway agents are ABANDONED, not cleaned up.** There is no way to delete an agent, so
  "cleanup" could only mean deactivating one - which sends yet another live email and, worse, fires
  the very notification a later scenario in the same run may be baselining for. The `@agent-email`
  `After` hook records what was created and re-activates an agent **only** if a scenario died
  between deactivate and re-activate. It never throws.

### Coverage is shared by tag, never duplicated

Four of the 15 templates were already covered end to end before this file existed, so they are
**not** reimplemented. They carry `@agent-email` alongside their own tags so `-p agentEmails` picks
them up - a tag is not duplication, a second implementation would be and the two would drift.

- `Join Talentforge` -> `Invite-agent.feature`, "the full invite lifecycle ..."
- promo disabled / resumed -> `Promo-Code-Lifecycle.feature`, "disabling and re-enabling a promo ..."
- promo expired -> `Promo-Code-Lifecycle.feature` §6

Adding that tag **changes nothing about what runs by default** (no profile filters on
`@agent-email` except this one), and both borrowed scenarios remain in the default run - verified
with `--dry-run --tags "@agent-email"`.

### `emailTypes.js` was stale about the promo-expiry mail

It stated that no such mail exists and that its subject was a guess; the scenario asserting it is
`@known-issue` on those grounds. **Ten of them are in the inbox, newest 2026-08-07, under exactly
the subject it guessed.** The note has been rewritten. The `@known-issue` tag on
`Promo-Code-Lifecycle.feature` §6 has deliberately **not** been touched - removing it belongs with a
measured re-run of that feature, not with this change.

### Every assertion is categorised, and the order is load-bearing

`utils/agentEmailEvidence.js` sorts findings into `delivery` / `identity` / `content` /
`figmaCopy`, and steps fail on the first three only.

- **`figmaCopy` is collected, not failed on.** The app says "Talentforge" where Figma says "Talent
  Forge" - in *every* mail it sends, sometimes both spellings in one message - so failing on it
  would make every scenario permanently red on a branding disagreement and bury the findings that
  matter. Divergences are attached to the report instead. Ask the PO for one canonical spelling
  before tightening this.
- **Delivery, then subject, then wording.** If the mail never arrived, "the greeting is wrong" is
  noise that sends the reader after a copy bug. Same rule as the receipt-PDF currency step.
- **No step throws on the first thing it finds wrong.** An email has three independent ways to fail
  and Cucumber abandons a scenario at its first failing step, so each step collects every problem
  across every mail it owns and throws once. That is also why the email-change pair is one scenario
  asserting both mails rather than two.
- **Every mail is attached to the report whether or not it passed** - on a red row it is the
  evidence, on a green one it is the record of what the app actually sent that day, which is what
  makes a later wording change diagnosable instead of mysterious.
- **`expectGreetsRecipient()` asserts the greeting NAMES the agent**, not that it exists. The live
  verify-new-email mail greets **`"Hi ,"`** with the name missing entirely, and a
  `body.includes(...)` check on any other sentence in that mail passes straight over it.

### Expected baseline

**Not yet measured.** `npx cucumber-js -p agentEmails --dry-run` reports **7 scenarios / 119 steps**
and every step resolves. Three scenarios are `@known-issue` and fail on purpose (the reminder-type
gap covering two unreachable templates, and the unreachable transfer mail). **Run
`npm run test:agent-emails` and replace this paragraph with the measured result.**

## AI document verification (`features/AI Document Verification/`)

> **MERGED INTO ONE APPLICATION FILE ON 2026-09-01.** The module went 11 files
> (criterion-per-file) -> 8 (2026-08-25) -> 9 (`status-lifecycle.feature`) -> **2**:
> `ai-document-verification.feature` plus `test-data-integrity.feature`. Start at
> `features/AI Document Verification/README.md`; it is the entry point for this module and
> carries the AI-trustworthiness measurements recorded further down.
>
> **THE MERGE WAS SAFE FOR ONE REASON: all 9 files already shared ONE step-definition file**,
> so no step, page object or fixture changed. The one real edit was moving each area tag from
> feature level onto each of its own scenarios - a feature-level tag applies to every
> scenario in the file, and this module's profiles filter on tags, so leaving
> `@status-lifecycle` up there would have made `npm run test:doc-lifecycle` select all 78
> scenarios and commit dozens of irreversible agent decisions.
>
> **`node scripts/check-profile-selection.js` is what proved it.** It evaluates every
> profile's own tag expression against the parsed Gherkin and compares the SET OF SCENARIO
> NAMES - not the count, which is unchanged if a merge drops one scenario and admits
> another. All 30 profiles selected identical scenarios before and after. **Run it after any
> change to tags or file layout, anywhere in the suite.**
>
> One deliberate behaviour change, the only one: `upload-validation.feature` had a ONE-step
> Background where the other seven had the same three, so its 11 scenarios gained two cheap
> guard steps (a fixture name assertion with no network, and a `GET institutions/` liveness
> check - not a model call). That is the whole of the module's step count going 1013 -> 1035.
>
> | File | Scenarios | What it owns |
> | --- | --- | --- |
> | `ai-document-verification.feature` | 78 | **the whole application module**, in 8 titled sections |
> | `test-data-integrity.feature` | 2 | the suite's own fixtures - NOT the application |
>
> `test-data-integrity.feature` is deliberately NOT merged: a red row there means the
> automation is about to test the wrong thing, a different message from "the product is
> wrong", and it has **no Background on purpose** (it needs no account and no API). Folding it
> in would make an API outage report "your fixtures are broken" when they are fine.
>
> **The 8 sections keep their area tag on every scenario, so `--tags` slices the module
> exactly as the files used to:** `@core-criteria` 33, `@upload-validation` 11,
> `@auto-approval` 5, `@agent-review` 10, `@candidate` 3, `@resubmission` 3,
> `@status-lifecycle` 10, `@e2e` 6. (Sums to 81, not 78, because 3 scenarios carry two area
> tags - they did before the merge too.)
>
> `npx cucumber-js -p docVerify --tags "@core-criteria"` runs exactly what
> `core-criteria.feature` ran.
>
> **EVERY SCENARIO NAME IN BOTH FILES STARTS WITH "Verify that ..."** (applied 2026-09-01),
> the same house convention `features/Promo_Code/` follows. The form is
> `Verify that <lowercase declarative clause>`, proper nouns and acronyms keeping their case
> (AI, JPEG, Need Review, Documents tab). Note this is a convention in THESE files and the
> promo files only - the other feature files keep their own style, so do not "fix" them.
>
> It was not a prefix-and-lowercase job: about a third of the old names were IMPERATIVE
> ("Approve a document when...", "Flag a document...", "Do not apply..."), and prefixing
> those yields "Verify that approve a document when...". Each became a declarative clause,
> one judgement per name - so write a NEW scenario in the new form rather than regexing it.
>
> Scenario names are read by nothing but the artifact filenames, so a rename cannot break a
> step. It CAN change which scenarios a profile selects, and
> `node scripts/check-profile-selection.js --by line --compare <snapshot>` is what proved it
> did not: all 31 profiles unchanged. `--by line` is the mode for a rename - the default
> compares NAMES, which a rename makes useless.
>
> Dry-run counts, MEASURED 2026-09-01 - re-measure rather than adjusting these by arithmetic:
> **71 (`-p docVerify` and `-p docVerifyUi`) / 5 (upload) / 5 (decisions) / 1 (walkthrough) /
> 10 (`-p docLifecycle`) / 7 (`-p docLifecycleReadOnly`); 80 under `-p only` over the folder,
> 1013 steps, 0 undefined, 0 ambiguous.** The figures they replace (65 / 4 / 2 / 70, 865 steps)
> were already stale before this change.
>
> Note `docVerifyUpload` and `docVerifyDecisions` each gained a scenario from
> `status-lifecycle.feature`: its approved-visibility scenario carries BOTH
> `@creates-profile-entry` and `@mutates-document`, so both profiles pick it up. That is
> intended - it is exactly the kind of scenario each of those commands exists to spend.
>
> **Type tags slice ACROSS the files**, so both cuts work - by area (one file) or by type
> (`--tags "@negative"`).
>
> **Steps were NOT split** - they all remain in
> `steps/document-verification.js`, because Cucumber loads step
> definitions globally and a second file would duplicate the API client, the browser contexts
> and the teardown hook, and the two copies would drift.
>
> **The path contains spaces, so quote it:**
> `npx cucumber-js -p docVerify "features/AI Document Verification/ai-document-verification.feature"`.
> Since the merge you rarely need the path at all - `-p docVerify` alone runs the module, and a
> section is selected by its tag (`--tags "@core-criteria"`).
>
> `configs/vscode-cucumber-runner.js` (REMOVED 2026-10-06 with Cucumber) matched the FOLDER plus every historical file name, and
> maps them to **`-p docAll`** rather than `docVerify`: the merged file holds
> `@mutates-document` and `@creates-profile-entry` scenarios that `docVerify` excludes, so a
> gutter click on one of those would otherwise report `0 scenarios` and show as skipped.

### >>> THE MODULE IS BROWSER-DRIVEN NOW: `DOC_UPLOAD_MODE` (added 2026-08-25) <<<

It used to be API-driven with no page object, on the reasoning that the AC's rules live in the
upload/verify endpoints and asserting them through a UI would test the rendering of a verdict
rather than the verdict. That reasoning is still true of the ASSERTIONS - the verdict is still
read from the API - but it left **53 of 75 scenarios doing all their work over HTTP**, so a
headed run showed an empty `about:blank` window and nobody could watch the product behave.

`DOC_UPLOAD_MODE` decides how the document gets onto the account. **It does not change a single
assertion.**

- **`ui` (the default)** fills the real Education / Work Experience / Certification modal,
  attaches the file and saves - what a candidate actually does.
- **`api`** posts straight to the upload endpoint. Far faster; the right mode when you are
  diagnosing an assertion rather than observing the product.

```
npm run test:doc-verify:ui                        # watch it (65 scenarios)
SLOWMO=400 npm run test:doc-verify:ui             # at a followable pace
DOC_UPLOAD_MODE=api npm run test:doc-verify-bdd   # the fast path
```

- **BOTH MODES CREATE THE SAME PERMANENT DOCUMENT ROW.** There is no DELETE for a document row
  anywhere in the API, so `api` is not the cheap mode in the sense that matters - it only costs
  less time.
- **Two classes of document stay on the API path whatever the mode**, and that is what those
  scenarios are *about*, not a limitation. Anything with a `file` property (disallowed format,
  oversized, the allowed-format pair, the near-inline-limit file) asserts the **endpoint's**
  policy - an HTTP status and its message; a form grey-ing out a `.docx` proves the client
  blocks it, which is a weaker and different claim, and "each allowed format" sends two files,
  which no single form submission does. And anything whose category has no profile form - there
  is none today, the check exists so a new category fails loudly instead of silently reverting.
- **The route taken is attached to the report on EVERY upload**, so a green run always says how
  the document got there.
- **`@ui` as a tag is gone**, and so is the distinction it drew. It used to select "the
  scenarios that genuinely drive a browser"; under `ui` mode that is all of them, and the tag
  selected nothing - `docVerifyUi` dry-ran to **0 scenarios**, which is worse than useless
  because it reports as a clean pass. That profile is now the same set as `docVerify`, kept
  because "show me the flow" deserves an obvious command and its own report file.

### Expected baseline (measured 2026-08-25)

`npm run test:doc-verify:ui` - **65 scenarios, 48m04s, 45 passed / 20 failed.** Four of those 20
were suite defects and are fixed, one scenario was inverted, and one (@not-automatable) is now
excluded - so the **derived** baseline is **64 scenarios, 15 failed**. *Derived*, not measured: no
full run has happened since the fixes. **Run one and replace this paragraph with the result.**

The 15 expected reds: **6** intentional `@known-issue`, **5** the `cross_document_consistency`
account-history condition (environmental, not a defect), **3** real AI findings left deliberately
untagged (`CONT-02` answered *pass* on a transcript with no major line, `CONT-03` named only some
of its missing fields, `AUTH-05` was judged confidently despite being illegible), and **1** real
product defect asserted as written (9 of 9 upload controls unreachable by keyboard). The full
table is in the module README.

**Two findings worth acting on, both first measured through the suite on this run:**

- **A document OVER the size limit is ACCEPTED.** `FILE-03`, 8,672,391 bytes, answered `HTTP 201`
  with a document row and `status: AWAITING`. The 5 MB limit is not enforced on that endpoint.
- **The JPEG defect is FIXED, and its scenario was INVERTED rather than left red.** The message now
  reads `Only .pdf, .png files are allowed.` and the endpoint refuses a JPEG - the two finally
  agree, where it used to refuse a format its own message advertised. `@known-issue` removed. The
  scenario asserts the refusal AND that the refusal explains itself, so it goes red again if they
  diverge in either direction. **The message recorded elsewhere in this file
  ("Only .jpg / .jpeg, .pdf, .png, .webp files are allowed.") is STALE.**

**The status-wording finding got sharper:** one API status (`AWAITING`) is rendered **three**
ways - candidate "Awaiting Verification", agent pill "Needs Review", agent filter tab
"Need Review" **(STALE - the tab now reads "Needs Review" too; re-measured 2026-09-22, so the
product renders TWO wordings, not three)**. That is why the candidate-side pre-decision step
accepts the known set of wordings
and attaches the one it found: pinning a single string would make the scenario red on a synonym
and, since Cucumber abandons at the first failure, take its second assertion down with it.

**Four suite defects that run exposed, all fixed** - each would have been read as a product bug:

- **`@not-automatable` WAS RUNNING.** Neither `docVerify` nor `docVerifyUi` excluded it (nor did
  their predecessor), so the one scenario tagged it ran on every routine pass and could only ever
  fail: no fixture can carry a genuinely valid digital certificate and the resolver correctly
  refuses to substitute an ordinary scan. Both profiles exclude it now.
- **The queue step read ONE PAGE.** `each uploaded document should appear with its own status`
  checked the snapshot taken when the queue opened, and that queue spans every candidate - 250+
  document rows. Three documents uploaded seconds earlier were all reported as *"does not appear
  in the queue"*, which reads as the product losing documents. It now SEARCHES per document and
  matches the full stored name.
- **A 30-character stem matched TEN rows.** `the version shown to the agent should have increased`
  opened by `stem.slice(0, 30)`, and because uploads are permanent the same fixture uploaded
  repeatedly leaves rows with identical prefixes. `findRow()` rightly refused to guess. It now
  opens by the **full stored filename, extension included** - the server-appended suffix is the
  only thing that distinguishes them. This is the third occurrence of this trap in the repo.
- **The Education combobox detached mid-click.** `element is not stable` -> `element was detached
  from the DOM` -> 30s timeout, on the same control and term that works elsewhere. The control
  queries per keystroke, so a late query replaces the list wholesale, and Playwright’s auto-retry
  cannot win: it retries the ONE handle it resolved. `selectFromSearch()` now RE-RESOLVES the
  option on each of three attempts, and the commit is still verified afterwards.

**A resubmission AI timeout was seen once and did not reproduce** (passed 14/14 immediately after;
the other two resubmission scenarios use the same step and passed in the full run). Transient,
recorded so it is not re-diagnosed from scratch.

### The form fillers read each document's own `declared` block

Every fixture carries a `declared` block - the values a candidate would type alongside that
file - and the fillers read **that**, never constants of their own. Not tidiness:
`issuing_organisation` and several date rules are evaluated by comparing the document against
**what the candidate declared**, so a filler with hardcoded values would declare "King Saud
University" for a fixture whose whole point is an unrecognised institution, and the AI would
then correctly report a mismatch the scenario never asked for. That is the exact class of false
finding that inflated the measured AI mismatch rate from 5.3% to 10.2% until
`probe-ai-verdict-vs-document-condition.js` learned to separate the two.

**Two of the three modals are not what they look like** (measured 2026-08-25):

| Modal | `<select>`s, in order | The trap |
| --- | --- | --- |
| Add Education | `startMonth, startYear, endMonth, endYear` | all three text fields are real comboboxes - each needs an **option picked**, not a typed value |
| Add Experience | `employmentType, startMonth, startYear, endMonth, endYear` | **index 0 is not a month** - hence `selectMonthYear(..., {offset: 1})` |
| Add Certification | `issueMonth, issueYear, expiryMonth, expiryYear` | none |

- **>>> "Company Name" IS A PLAIN TEXT INPUT, NOT A COMBOBOX, DESPITE ITS "Search"
  PLACEHOLDER. <<<** Dumped side by side with the Education control
  (`scripts/probe-company-combobox.js`): the institution field carries `role="combobox"`,
  `aria-autocomplete="list"`, `aria-expanded` and a "Show suggestions" button; Company Name
  carries none of them - it is `<input type="text" placeholder="Search">` and nothing else. So
  it has no options and never had any. `selectFromSearch()` on it timed out reporting *"no
  option exactly named ... options offered: (none)"*, which reads like missing reference data,
  and is why the work-experience upload path was believed to be an app problem. **It had never
  run successfully.** `fillText` is the right primitive. Worth raising with the PO as a UX
  finding in its own right - the placeholder tells a candidate to search a field that does not
  search, the same shape as the community module's "Search by candidate name or major".
- **A null end/expiry date means a CHECKBOX, not an empty pair.** That is how the test data
  records ongoing employment and a non-expiring certificate, and the end month/year are
  *required* without it - so ticking it is what lets Save enable. The checkbox is an `<input>`
  hidden behind a styled `<div>` that intercepts pointer events, so `.check()` retries for the
  full timeout and reports *"div ... intercepts pointer events"*. It is toggled by a DOM click
  on the input, and the resulting state is **verified** - a click that silently failed would
  leave Save gated, and "Save is disabled" is a far harder failure to trace back here.
- `scripts/probe-candidate-profile-experience-form.js` dumps every control in both modals.
  Neither probe saves anything.

### Uploads are QUEUED by the Givens and flushed once, later

A `Given` queues an upload; `flushUploads()` sends them, called from the small set of steps that
can follow the Given block. The opening `Given` used to upload immediately and a refinement then
ASSERTED that the already-uploaded document happened to satisfy it. Wrong twice over, both
measured 2026-08-25:

- **IT PICKED THE WRONG DOCUMENT.** "Given the candidate has uploaded a certificate / And the
  document is currently active with an expiry date that is today" resolved the *cleanest*
  certificate on the first line - DATE-05, all dates past - and only then discovered the
  refinement wanted DATE-08. It failed with "put the narrowest Given first", blaming the feature
  file for the design's own ordering constraint. A reader writing Gherkin should not have to
  know which Given resolves.
- **IT SPENT A PERMANENT UPLOAD ON THE WRONG DOCUMENT FIRST.** With no DELETE for a document
  row, that failure left DATE-05 on the account twice, for nothing.

Resolving after every constraint is known means the account only ever receives the document the
scenario actually wanted. An unsatisfiable combination still fails naming both constraints, and
`current()` throws if any step reads the document while the queue is non-empty - that is a
step-definition gap, not a scenario problem, and it must say so rather than silently returning
the previous document.

### `NAME-13` was added: the only work letter with a name defect

The multi-document scenarios need one document naming somebody else while the others name the
candidate, and **the flagged one has to be a WORK LETTER** - a transcript naming somebody else is
usually flagged for its content too, so "only that document is flagged for a name mismatch"
would be satisfied without the rule being isolated at all. No such letter existed; the step that
needed it used to fail with *"there is no work letter naming a different person in the fixture
set"*. `NAME-13` is identical to `ENG-07` in every other respect - same company, designation and
open-ended dates - so the name is the single variable between them. Built by
`node scripts/make-doc-verification-fixtures.js NAME-13`.


Drives the real Bedrock verification run and compares every criterion against the expected business
behaviour. **The VERDICT is still read from the API** - the AC's rules live in the upload/verify
endpoints, and asserting them off a rendered panel would test how a verdict is displayed rather than
the verdict itself. **How the document GETS there is now the browser** - see `DOC_UPLOAD_MODE` above.

- **`npm run test:doc-verify`** - the standalone run. Reads every document, uploads it, polls for the AI
  result, compares against expected, writes `reports/document-verification-report.{md,json}`. **This is
  the one to run.** Filters: `-- --only ENG-01,NAME-03`, `--types positive,negative`,
  `--category EDUCATION`, `--skip-large`, `--dry-run`.
- `npm run test:doc-verify-bdd` - the same matrix as Cucumber scenarios (`-p docVerify`). **71 scenarios /
  865 steps, none undefined** (`npx cucumber-js -p only "features/AI Document Verification" --dry-run`
  is the authoritative count; it reports 70, dropping the 1 `@not-automatable`). Written
  declaratively: no fixture ids appear in the Gherkin. **65 run under `-p docVerify`**; the 4
  `@creates-profile-entry` and 2 `@mutates-document` scenarios are split out.
- `npm run test:doc-verify:upload` - the 4 scenarios that upload through the real Profile >
  Candidate Details form. Each save creates a profile entry AND an unremovable document row, so
  they are spent deliberately, the same way `@creates-community` is.
- **`npm run test:doc-verify:walkthrough` - THE ONE TO RUN WHEN YOU WANT TO WATCH THE PRODUCT.**
  One document driven through the real screens end to end: the candidate's
  Profile > Candidate Details > Education form, the real AI run, then the agent's
  `/verifications` panel showing the AI summary and its findings - all on that same document.
  Measured 2026-08-25: **19/19 steps, 1m12s.**
  - `SLOWMO=400 npm run test:doc-verify:walkthrough` to follow it by eye (see below).
  - `VIDEO=on ...` keeps the .webm even on a pass - it records TWO, one per browser context.
  - It attaches the transcript naming a DIFFERENT PERSON on purpose. A clean document passes
    every criterion and an agent panel with nothing flagged shows nothing worth watching, so
    it uses `identity_name_match` - the one criterion measured as fully deterministic - which
    means a finding renders every single run.
  - `@creates-profile-entry`, so it is excluded from the routine run: each save is a permanent
    profile entry plus an unremovable document row.
- **`npm run test:doc-verify:fast`** - the same 71 scenarios as `docVerify`, run
  `DOC_UPLOAD_MODE=api` + headless (SERIAL - see below). Not one assertion differs (verified with
  `node scripts/check-profile-selection.js`); only the scheduling and the upload route do.
  - **MEASURED per-scenario FLOOR 2026-09-01: ~14s** for a scenario that uploads nothing and
    calls no AI (42s for three, serial, headless) - that is browser-context creation plus a
    page load, not test logic. The AI adds 7-15s, a UI upload ~60s, an API upload ~2s, a UI
    sign-in 6-8s. **So a serial run of 71 cannot go far below ~15 minutes**, and
    `test:doc-verify:ui` measured 48. Expecting single-digit minutes serially is expecting the
    AI and the browser to be faster than they are.
  - **>>> --parallel WAS TRIED, MEASURED AND REJECTED. <<<** With `parallel: 4` a 6-scenario
    slice ran in **5m45s wall for 16m51s of work** - a real ~3x - and **4 of 6 FAILED**, three
    of them all three resubmission scenarios timing out on the AI. Converting passing
    scenarios into timeouts is worth no speedup. Whether parallelism CAUSED it is suspected,
    not proven (the same timeout was seen once serially and did not reproduce); settling it
    needs a controlled A/B that spends permanent uploads. Until then this profile is serial.
  - **A second, independent caveat:** `cross_document_consistency` is judged against
    whatever is already on the account, so UPLOAD ORDER IS TEST DATA here - the reason every
    other profile in this module is serial. Parallel lanes make that criterion's input
    non-deterministic, which is tolerable ONLY because it is already unpassable on this
    account and no assertion trusts it. **If that is ever fixed, put this profile back to
    serial.** Use `-p docVerify` when a cross-document verdict matters.
- **`reports/ai-verification-findings.md` (+ `.json`) - WHAT THE AI ACTUALLY SAID, across the
  whole run.** One section per document: the status it chose, every criterion with the reason
  it gave, and the remarks the candidate can see with their source, non-passing criteria
  first. Built by `utils/aiFindingsLog.js` - each verified document appends a line
  to `reports/ai-findings.ndjson` from the `After` hook (so it happens whether the scenario
  passed or FAILED), and `configs/run-tests.js` builds the artifacts after cucumber exits.
  - NDJSON because a `--parallel` run has one `AfterAll` per worker: building it inside
    cucumber would write one partial file per lane, each overwriting the last. It also means a
    KILLED run still leaves what it measured - which matters, because an abandoned run has
    still spent its permanent uploads.
  - **It carries no pass/fail of its own, deliberately.** The expected-results table has never
    been supplied, so a verdict column would be invented. It reports what the AI said; the
    scenario beside it does the judging.
  - `documentStatus` and `aiStatus` are recorded separately and a mismatch is flagged in bold:
    where they differ, something other than the AI moved the document.
- **`npm run test:doc-lifecycle`** - **THE ONE THAT TESTS THE STATUS ITSELF** (`-p docLifecycle`).
  10 scenarios, **7 passed / 3 failed, 10m 17s (measured 2026-09-01)**; the 3 reds are exactly the 3
  `@known-issue` scenarios. A document is driven from upload through the AI to a final agent
  decision, and the status is checked on the candidate portal AND the agent portal at every step -
  plus the two COMMENT cases, which are opposite: an agent-decided document must show the
  **agent's** reason and must not present the AI findings as the reason, while a document the AI
  set to Revision Required itself must show the **AI's own** reason. Fixtures are the three
  supplied documents in `Files/3 documents(Approved,requestrevision & need review)/`, registered
  as `EDU-APPROVED` / `EDU-REVIEW` / `EDU-REJECTED`.
  - **Cost per run: ~11 permanent document uploads and 3 IRREVERSIBLE AGENT DECISIONS.** No
    payments. Excluded from the default run by the module's own `@doc-verification` tag.
  - `npm run test:doc-lifecycle:read-only` is the 7-scenario cut that decides nothing (it still
    uploads - that cost is unavoidable).
  - **`node scripts/probe-doc-status-rule.js`** is the read-only probe behind every premise in
    that file: it cross-tabulates which criteria came back non-pass against the status the document
    ended up with. Measured 33 of 33 - **all pass -> APPROVED**, **`date_validity: fail` ->
    REVISION**, **any other non-pass -> AWAITING**. `date_validity` is the discriminator, present
    in every REVISION row and absent from every AWAITING one. Re-run it after any model change; the
    rule is empirical and will go stale silently.
  - Full detail, including the three expected reds and the two findings it settled, is in
    `features/AI Document Verification/README.md`.
- **`npm run test:doc-verify:decisions`** - the 2 `@mutates-document` end-to-end scenarios
  (`-p docVerifyDecisions`): agent requests a revision, and agent approves. Each **COMMITS A REAL
  AGENT DECISION** through the Agent Portal dialog and **nothing in the product reverses one**. Both
  upload their own document first and never decide on a pre-existing one, so no other scenario's
  fixture is disturbed.
  - **Until 2026-08-25 `-p docVerify` did NOT exclude `@mutates-document`, so every routine BDD run
    committed a live revision decision.** That was not intentional. Beyond accumulating settled
    documents it slowly consumes the AWAITING rows that several read-only scenarios read as their
    fixture, which is the sort of drift that surfaces later as an unrelated-looking failure.
- `npm run test:doc-verify:dry` - builds every multipart form and posts nothing. Validates credentials,
  reference-data resolution and fixtures without spending an irreversible upload.
- `npm run test:doc-verify:reset` - **not a reset.** Reports what the account holds and how much of it
  cannot be removed. `--delete` removes profile entries only.
- `npm run test:doc-verify:probe` / `:fixtures` - one document end to end with everything dumped; and the
  fixture generator.

### THE THREE THINGS THAT MAKE THIS AREA EASY TO GET WRONG

- **UPLOADS ARE PERMANENT when the document is posted straight to the upload endpoint.** There is
  no DELETE for a document row *on its own*, so a document the suite uploads over the API can
  never be removed. Measured 2026-08-24: 5 profile entries, 78 document rows, **73 orphaned**.
  `@doc-verification` is therefore excluded from the default profile and that exclusion cannot be
  relaxed - a default run would add ~40 unremovable rows every time.
  - **>>> BUT "DELETING A PROFILE ENTRY LEAVES ITS DOCUMENT ORPHANED" IS WRONG, AND THAT HALF OF
    THIS NOTE IS WITHDRAWN (measured 2026-09-14). <<<** Deleting the ENTRY *does* take its document
    with it. Measured directly by `scripts/probe-candidate-details-mutations.js`: add a
    certification carrying document 26718 -> `DELETE /candidate/profile/certifications/<id>/` ->
    204 -> re-read `/candidate/documents/`, the document is **gone** and the account holds **zero**
    orphans. `Candidate-Details.feature` asserts the cascade on every run.
  - **So where do this account's 73 orphans come from? `DOC_UPLOAD_MODE=api`.** That path posts
    straight to the upload endpoint and never creates a profile entry at all, so those rows were
    orphaned *from birth* - not orphaned by a deletion. The distinction matters: it means the
    unremovable cost is the API upload path, and a document attached through a form is recoverable
    by deleting its entry.
- **`cross_document_consistency` CANNOT PASS on this account, and it is not a product defect.** Four
  documents name somebody else (`Ali Hassan`, `Jon Smith-Doe`, two `John Doe`), **three of them
  orphaned**. Proved by consequence, not inferred: `ENG-01`, the one fixture designed to pass every
  criterion, failed on this criterion **and only this criterion**. Three ways out are recorded in
  `Files/DOC_VERIFICATION_TEST_MATRIX.md` §9.2; **none is chosen yet**, so every
  `cross_document_consistency: pass` expectation will be red for a reason that is not a bug.
- **UPLOAD ORDER IS TEST DATA.** `order` in the test data decides what `cross_document_consistency` is
  evaluated against - NAME-06 first, the wrong-name documents after the correct ones, EDGE-03 after
  NAME-03. The table step sorts by `order`, never by the order rows appear in the Gherkin table. **Never
  add `--parallel` to `docVerify`.**

### A TARGETED RUN REPORTS 0 SCENARIOS UNLESS YOU NAME THE PROFILE

`@doc-verification` is excluded from the default profile, so anything that does not name a profile
matches nothing. Measured 2026-08-24 on the same feature file:

| Command | Result |
| --- | --- |
| `npx cucumber-js <file>` | **0 scenarios** |
| `npx cucumber-js <file> --tags @doc-verification` | **0 scenarios** |
| `npx cucumber-js -p docVerify` | 71 scenarios (re-measured 2026-09-01) |
| `npx cucumber-js -p only <folder>` | 80 (the whole module) |
| `npx cucumber-js -p docVerify <file>:<line>` | that one scenario |
| `npx cucumber-js -p docAll <file>:<line>` | that one scenario, **including a costly one** |

**The path contains spaces** (`features/AI Document Verification/ai-document-verification.feature`),
so it must be quoted in every one of these. An unquoted path is split into three arguments, and
cucumber treats each as its own path - which reports `0 scenarios` for a reason that has nothing
to do with tags.

**Since the 2026-09-01 merge, prefer the TAG to the path.** `--tags "@core-criteria"` selects what
`core-criteria.feature` used to hold, and needs no quoting at all. The last row exists because
`docVerify` excludes `@mutates-document` and `@creates-profile-entry`: naming one of those by line
under `docVerify` reports `0 scenarios`, and `-p docAll` is the profile that admits them.

**The second row is the one that catches people.** A CLI `--tags` is **ANDed** with the profile's own
tag expression, never a replacement, so `--tags @doc-verification` AND `not @doc-verification` is
always empty. The same trap is recorded under `npm run test:only` in Commands.

Use **`npm run test:doc-verify:one -- --name ...`** or **`-- <file>:<line>`** for a single scenario
(direct `cucumber-js`, so a one-scenario run cannot rebuild the HTML report and read as a whole-suite
result), and `npm run test:doc-verify-bdd` for the whole set.

**The VS Code Test Explorer runs the DEFAULT profile**, so a scenario clicked in the gutter reports 0
and shows as skipped. That is the profile filter, not a broken scenario.
### The Gherkin is declarative: constraints in, a real document out

No scenario names a fixture. Each `Given` adds a property CONSTRAINT and the `When` resolves the
document in `Files/Test_doc` whose recorded `properties` satisfy all of them. Ambiguity is normal, so
resolution prefers the document that satisfies the constraints and is otherwise **clean** - fewest
properties differing from the neutral baseline. Ties break on `order`; the chosen document is
attached to the report every time, so a red row is still traceable to a file.

**An unsatisfiable combination FAILS naming the constraints and the near misses.** That is what stops
a scenario passing against a document that does not contain the defect it claims.

The description->constraint table lives in ONE place (`DESCRIPTIONS` in the step file) so the whole
binding between prose and fixtures is reviewable at a glance. **The eight refinement phrases are
defined as explicit steps, never as a catch-all regex** - a regex like `/^(?:the |all )?(.+)$/` matches
almost every Given in the repository and Cucumber rejects hundreds of steps as ambiguous.

### The two portals, measured

- **"Needs Review" is the UI's name for the API's `AWAITING`.** The enum and its schema description
  are unchanged ("Awaiting Verification"), and the filter tab's test id is still
  `agent-verifications-tab-awaiting-verification`, so the rename is presentation-level.
  **>>> THE TAB/PILL INCONSISTENCY IS FIXED, AND THIS ENTRY WAS STALE. <<<** The tab used to read
  "Need Review" (singular) against a pill reading "Needs Review"; re-measured 2026-09-22 **both
  read "Needs Review"**. `AgentVerificationsPage.TAB_LABEL.AWAITING` still held the old string, and
  `steps/document-verification.js` asserts `tab label === TAB_LABEL[status]` - so that step was RED
  against a build that had been corrected. Fixed in the map. See "Verifications - the document
  review queue".
- **The AC's phrases are real and live in the UI.** The panel's "Flagged for" block renders
  "Name mismatch detected: ...", "Authenticity could not be confirmed: ..." verbatim.
  `ai_verification.criteria[].detail` carries the sentence but NOT the leading phrase. So steps about
  what a person is SHOWN read the panel; steps about the verdict read the API, and one step compares
  the two so a criterion that fails server-side but never reaches the screen is a finding.
- **"Automated System Message" is the who-flagged label**, not the AC's "AI Review". On the candidate
  side an agent decision is attributed to "Agent". Wording divergence for the PO, not a defect.
- **The document viewer is react-pdf and takes ~9.5 SECONDS to render.**
  `.react-pdf__Document > .react-pdf__Page > canvas.react-pdf__Page__canvas` - no iframe, no img, ever.
  A first attempt guessed `iframe, embed, object, canvas, img` and reported the document absent on a
  panel visibly showing it, because react-pdf was still painting its loader.
  `waitForDocumentRendered()` waits for a rendered PAGE, not for the loader to clear - an error state
  clears the loader too, and "failed to render" must not read as "rendered". Use
  `scripts/probe-document-review-panel.js` before changing any viewer locator.
- **Mandatory reason works correctly on BOTH decisions** (measured; the three gating scenarios pass):
  empty -> disabled, whitespace-only -> disabled, real reason -> enabled.
- **The candidate has THREE document surfaces and they do different things.**
  `/dashboard` "Your Documents" lists a SUBSET and its View opens the verification panel - the only
  surface carrying a REASON. `/profile?selectedTab=documents` lists EVERY document **with its status
  badge**, grouped Education / Work Experience / Certifications.
  `/profile?selectedTab=candidate-details` is where documents are UPLOADED, via an add control on
  each section. `/documents` and `/my-documents` render an empty body and are not the page.
  - **RE-MEASURED 2026-09-01 - two things here were STALE.** The Documents tab **does** carry a
    status now (the old note said it had none and downloaded on click), and it labels `AWAITING`
    **"Needs Review"** - the same string the agent pill uses, not "Awaiting Verification".
    `CandidateDocumentsPage.STATUS_LABEL` held the old wording, and since `readDocumentCards()`
    classifies rows by those strings it returned **0 cards on a dashboard plainly showing four**. A
    reader that can only ever answer "absent" is the trap this repo has paid for repeatedly.
  - **Clicking a filename on that tab now does NOTHING** - no dialog, no download, no navigation, no
    request, on a real `<button>`. It used to download. Asserted as a finding, not worked around.
  - **The dashboard block is hard-capped at FOUR and the cap is the app's own:**
    `GET /core/api/v1/candidate/documents/?page=1&page_size=4`, against `count: 61`, with a
    `next` page the UI never exposes and no pagination control anywhere. Since that block is the
    only surface showing a reason, 57 of 61 documents have no reachable reason at all.
- **>>> THE UPLOAD CONTROLS ARE BARE `<svg class="add-icon">` / `<svg class="edit-icon">` <<<**
  No `<button>`, no `role`, no `aria-label`, no `data-testid`, no `tabindex`. Two consequences:
  every role-based or accessible-name locator returns nothing (which is why this upload path was
  first reported as not existing at all), and the controls are **not keyboard focusable and invisible
  to assistive technology** - a real defect, asserted by
  `The document upload controls are reachable by assistive technology`, which fails naming all 9.
  The class names are the only hooks; `CandidateProfilePage` uses them and says why.
- **The profile scrolls inside `<main>`** (6139px of content, 836px visible), so `window.scrollTo`
  does nothing and anything below the fold is absent from a naive DOM read. Reproduce layout-dependent
  behaviour at 1440x900 or wider - at 732px the app renders its narrow layout.
- **Remarks reach the candidate only AFTER the agent's final decision** (product rule, confirmed
  2026-08-24). Silence before a decision is CORRECT, and is asserted as a rule in both directions so
  AI findings leaking early would be caught. An earlier note calling that silence an AC violation was
  wrong and is withdrawn.

### >>> THE AGENT SUBMIT TEST ID IS DUPLICATED <<<

The Approve dialog's submit button carries `data-testid="agent-submit-request-revision-button"`, the
SAME id as the Request Revision dialog's. Approving and requesting a revision are opposite,
irreversible actions and a test id cannot tell them apart. Every page-object method scopes to the open
dialog and matches the button's visible TEXT, and `submitDecision()` refuses to click a control whose
label does not match the decision it was asked to make. **Do not write a test id selector here.**

### Expected results are PENDING, and pending is never a pass

Sections 1-13 of the requirement (which hold the expected-results table) never reached the automation
author, so every `expected` block in `test-data/document-verification/documents.json` is `null`. The
comparison engine reports those as **PENDING**, counts them in their own column, and prints the count
loudly. `Verify that every document in the test data carries an expected result` is `@known-issue` and
**fails on purpose** until the table lands - a suite that silently verifies nothing is the failure mode
this whole design guards against. Same rule as the community module's "nothing to assert" step.

Filling in the `expected` blocks requires **no code change**. `known_defect` annotates a row without
suppressing it: per requirement §15 a known product defect stays a failing test.

### Findings are classified, and the class comes before the detail

`docVerificationErrors.js` implements §14's eight required classes plus two more, and both extras are
deliberate: `fixture-failure` (the suite's own fault - the exact-10 MB PNG lesson) and
`expectation-pending`. Every step collects findings across every document it owns and throws once,
because Cucumber abandons a scenario at its first failing step and a document has six independent
criteria that fail for unrelated reasons.

**Redaction is structural**, not per-call-site: passwords, tokens and the `X-Amz-Signature` on presigned
URLs are stripped on the way into every error and every log line. A presigned URL is a credential.

### What was measured, so nobody re-derives it

- **`ai_verification` is free-form in the OpenAPI schema** (`readOnly`, `nullable`, no type), so its
  shape is only knowable by measurement. Captured shape and the seven criterion keys are in
  `docVerificationApi.js`'s header. **Do not read it off the schema.**
- **Document status is `AWAITING | APPROVED | REVISION`. There is no `NEEDS_REVIEW`**, so the AC's
  three-status model does not map onto the product and "agents decide only on Needs Review" cannot be
  asserted. Needs a product answer.
- ~~**A genuine JPEG is refused by an endpoint whose own message allows it**~~ - **RESOLVED, and the
  scenario inverted, 2026-08-25.** It used to answer
  `422 "Only .jpg / .jpeg, .pdf, .png, .webp files are allowed."` on a file with `ff d8 ff e0`/JFIF
  magic bytes, `.jpg`, `image/jpeg` - refusing a format its own message advertised, reproduced twice.
  Measured this run the message is **`Only .pdf, .png files are allowed.`**, so the policy tightened
  to PDF/PNG and message and behaviour now agree. The scenario asserts **refusal** plus a
  self-explaining message, and `@known-issue` came off. **The old string above is stale - do not
  re-register it in a locator.**
- **The AI is fast** - 7-15s over 2 polls. `DOC_AI_TIMEOUT_MS` (180s) is not the constraint. Completion
  is a polled condition on real state (`ai_verification` going from null to a row with a `checked_at`),
  because there is no "AI finished" flag to wait a fixed time for.
- **`DOC_CANDIDATE_PASSWORD` is QUOTED in `.env` on purpose.** dotenv treats an unquoted `#` as a
  comment, so `StrongPass123!@#` silently became `StrongPass123!@` and the API answered
  `401 Invalid Credentials` - indistinguishable from a wrong password.
- **The agent account is 403** on `/agent/<id>/pending-verifications/` and every
  `/agent/analytics/documents/*` endpoint, but **can** read the whole review queue through
  `GET /candidate/documents/all/` (136 rows, all candidates). Nothing may depend on the 403 endpoints.
- **An AI-worded comment is stamped `source: "AGENT"`** (document 26252). The AC requires the candidate
  to see who flagged the document. **Confirm with dev before filing** - the agent may have copied the
  text into a note.

### Two fixtures are generated, and filenames are not evidence

`scripts/make-doc-verification-fixtures.js` builds them and verifies its own output by reading each file
back through the same `pdf-parse` reader the suite uses.

- **AUTH-02 was rebuilt because it contained no tampering at all.** Its only anomaly was a truncated
  word `Revis` on a cleanly rendered PDF, so the recorded "expected fail, got uncertain" discrepancy was
  a **fixture** defect being reported as an AI defect - the same class of mistake as the exact-10 MB PNG.
  Now carries a misaligned white-out patch leaving a sliver of the original name visible, three
  mismatched typefaces, a tonal splice band with the block beneath shifted, and a `REVISED COPY` stamp
  over the body text. The original is kept **once** as `.pdf.original`; a second run will not overwrite
  that backup.
- **DATE-06 was added** because DATE-02's filename says `current_open_end` while the letter states
  `to 31 December 2030`, a future end date. DATE-02 keeps the negative case; DATE-06 is the genuinely
  open-ended positive one.
- **Two byte-identical clusters exist and must NOT be collapsed** - `CONT-01/NAME-01/NAME-06/ORG-01` and
  `CONT-04/ENG-07/ORG-02`. They differ by *context* (category, declared data, upload order), which the
  automation supplies, not by content.
- **CONT-03 is a certificate uploaded as EDUCATION on purpose**, because that is what forces
  `transcript_content` to apply. The 2026-08-21 run uploaded it as `WORKEXPERIENCE`, which is why its
  recorded result is not meaningful.

### The tracked document is PROVED new, never assumed (2026-08-25)

This candidate is dedicated but long-lived - **151 document rows** at last measure, 26 of them naming
somebody else - so "the newest row of this category" is not a safe way to find what a run just sent.
Every upload therefore snapshots the account first:

`snapshotDocumentIds()` -> `upload(doc, fixture, { priorIds })` -> `confirmRowIsNew()`

and that guard does two things the upload response alone cannot. It **supplies** `documentRowId` when
the response omits it (`body.document` has been observed null on a 201, and without a row id the
agent-side assertions fall back to matching by file name - and these file names repeat across runs).
And it **refuses** a row that was already on the account, because a scenario tracking a pre-existing
row reads a PREVIOUS run's verdict and passes. `rowIdSource` in the report says which path was taken;
recovery-by-diff is itself a finding and must not look like the normal path.

`Then the verification result should belong to the document this run uploaded` promotes the guarantee
into Gherkin. That is not decoration: if a future change stops passing the snapshot, the guard
silently becomes a no-op and this step is the only thing that would notice.

### Cross-validation asserts FOUR name sources separately, not one

The rule joins four things that fail for unrelated reasons, and each mistaken diagnosis sends the
reader somewhere different. So there are four steps, never one "the names are consistent" check:

| # | Source | A failure here means |
| --- | --- | --- |
| 1 | the legal name **declared** on the account | fixture/account problem - invalidates 2-4 |
| 2 | the name extracted from **this** document | extraction failure, not a mismatch |
| 3 | the names on the candidate's **other** documents | unremovable history on a shared account |
| 4 | the `cross_document_consistency` **verdict** | the rule itself |

Source 3 reads through `otherDocumentNames()`, which returns rows carrying no verification as
`verified: false` rather than dropping them - silently dropping them would let the read return an
empty list on an account full of conflicting documents, and "nothing to conflict with" is the one
conclusion that must never be reached by accident.

**Only one direction of source 4 is a hard failure.** Claiming a conflict while no other document
names anybody else is unexplainable and fails. Passing *despite* a conflicting document is the app's
own tolerance rule - the AC never says how much history a conflict is judged against - so it is
attached to the report and left for a product answer.

Measured 2026-08-25 on `NAME-03`: declared `Abdul Musawwir Siddiqui`, document `John Doe`, 26 of 117
named rows naming somebody else, verdict `fail`. All four consistent, scenario green in 25s.

### Candidate notifications (AC section 11)

Read over `GET /core/api/v1/notifications/` against an **id baseline taken before the decision**, then
confirmed on the bell. Two surfaces because they answer different questions: the API says the
notification was RAISED, the bell says the candidate can actually SEE it, and one that exists but
never renders is a real defect an API-only check passes over. `NotificationsPage` is reused as-is -
it is role-agnostic and already documented for the superadmin and agent sessions.

- **A baseline, not a count.** This account is long-lived, so counting matches cannot tell a
  notification raised by this run from one left last week.
- **`waitForNotification()` throws carrying EVERY new notification it saw**, not a count. "The app
  raises nothing" and "it raises something worded differently" are different findings and a bare
  timeout cannot tell them apart. Same reasoning as `waitForEmailMatching()` in the agent-email module.
- **The notification steps are LAST in their scenario.** Cucumber abandons at the first failure and
  this is the newest surface here, so a wording problem must not cost the decision and status
  assertions above it. Same rule as the receipt-PDF currency step.

### Three suite defects fixed on 2026-08-25, all of them mis-reported as product defects

Every one was a second reader disagreeing with a first, or a locator resolving somewhere nobody
intended - the same class this file already records five of for the community module.

- **`CandidateDocumentsPage.openDocument()` ALWAYS OPENED THE FIRST CARD.** It walked up to six
  ancestors from each "View" control and clicked as soon as one *contained* the target name - but four
  levels up that ancestor is the whole "Your Documents" container, whose text holds **every** card's
  name, so the first View always satisfied the test. Measured: asked for
  `Screenshot_from_2026-03-25_19-33-48_RD5y5VY.png` [Revision Required], opened `Empty_GYFa8Bv.png`
  [Approved]. The scenario then failed as *"the candidate sees the status as Approved"*, which reads
  exactly like a product defect in what the candidate is shown. `readDocumentCards()` never had this
  bug because it requires the host to hold a filename **and** be under 250 characters - the tight card
  boundary - so `openDocument()` now derives each View's own card the same way. It also **asserts the
  panel is showing the document that was asked for**; the failed-click return value used to be
  ignored, and the panel wait then "succeeded" on whatever was already open.
- **`readCommentHistory()` returned the "Document Information" block as a comment.** Its walk up from
  the heading stopped at the first ancestor holding more than 60 characters, which on this panel is an
  ancestor of *both* sections. The block came back as an entry with `source: null`, reading as a real
  comment the app had failed to attribute - a different and non-existent defect. It now climbs only
  while the ancestor stays clear of `Document Information`.
- **`the candidate has a document that was marked for revision` chose an unreachable fixture.** It
  took the API's first REVISION row, but the dashboard surfaces only a subset (**4 cards against 152
  rows**), so that row was usually a document the candidate cannot open - and the scenario failed on
  reachability rather than on the remarks it exists to assert. It now opens the dashboard, intersects
  with what is actually listed, and **prefers a card carrying an automated-system comment**, reporting
  what it inspected either way. Its back-match to the API row is **exact on `file_name`**: the account
  holds both `...19-33-48_RD5y5VY.png` and `...19-33-48-1_0qkiwZd.png`, so a 30-character prefix
  matched both and picking the first reintroduced the same bug one layer down.

### A HEADED RUN USED TO SHOW AN EMPTY BROWSER - IT NO LONGER DOES

**Superseded on 2026-08-25 by `DOC_UPLOAD_MODE` (above).** This section used to record that
`hooks.js` creates a context + page for **every** scenario whether or not it is used, and that
**53 of the 75 scenarios did all their work over the API** - so their window sat on
`about:blank` from start to finish and a scenario passing with nothing on screen was the
expected outcome rather than a silent skip.

Under the default `DOC_UPLOAD_MODE=ui` that is no longer true: every document is uploaded
through the candidate's real Profile form, so every scenario has something to watch. The
`about:blank` window returns only under `DOC_UPLOAD_MODE=api`, and there it still means what it
used to - the shared lifecycle, not a skip.

To actually watch the flow:

```
npm run test:doc-verify:ui                        # all 65, browser-driven
SLOWMO=400 npm run test:doc-verify:ui             # at a followable pace
SLOWMO=400 npm run test:doc-verify:walkthrough    # the full chain on ONE document
VIDEO=on   npm run test:doc-verify-bdd            # keep every scenario's .webm, not just failures
```

**`SLOWMO` (added 2026-08-25)** overrides Playwright's per-action delay in headed mode. The
default 50ms is right for a normal run but far too fast to follow; 300-500ms is watchable. It is
ignored headless (a delay nobody can see is pure cost) and an explicit `SLOWMO=0` is honoured, so
a headed run can be sped up as well as slowed down.

**`VIDEO`** already existed: `retain-on-failure` (default) / `on` / `off`. Note a scenario using a
second browser context records TWO clips - the walkthrough writes a `-main` and a `-candidate`.

### FIVE BUGS IN THE UI UPLOAD PATH, ALL FOUND BY WRITING THE WALKTHROUGH (2026-08-25)

The four `@creates-profile-entry` scenarios had **never been run live** - each save is permanent,
so they sit outside every routine profile. Every one of them would have failed on its first step.
This is what "excluded from the run" costs, and it is worth remembering the next time a scenario
is tagged out of the default profile.

- **`documentSpec()` was called and never defined.** A bare `ReferenceError` on the first step of
  all four scenarios. It is now a real function that looks a document up by test-data id and
  fails naming the known ids.
- **`selectFromSearch()` left the institution field EMPTY while reporting success**, which gated
  Save and made a working form look broken. Three separate faults in one method:
  - it matched the option with `filter({ hasText: value })`, a **substring** match - typing
    "King Saud University" renders THREE options ("King Saud University", "...(KSU)", "King Saud
    bin Abdulaziz University for Health Sciences"), so `.first()` resolved in DOM order and could
    commit a different institution than the one asked for. Now matched by **exact accessible
    name**. Same trap as `AdminPromoToolsPage.disambiguate()` and the community Majors filter -
    third occurrence in this repo.
  - **it needs a click and REAL KEYSTROKES.** `fill()` sets the value in one input event and this
    control then renders **no options at all** - measured: 0 options after a 20s wait on a term
    that returns three when typed. It searches on keystrokes, so `pressSequentially` is not a
    slower `fill()` here, it is the only thing that triggers the query.
  - **it swallowed the failure** with `.catch(() => {})` and pressed Enter, which does not commit
    on a react-aria combobox with several matches. It now throws, naming the options it did see,
    and verifies the value actually committed.
- **>>> `attachDocument()` WAITED 500ms AND RETURNED `path.basename()`, WHICH IS NOT EVIDENCE OF
  ANYTHING. <<<** The form animates a progress bar - `"NAME-03....pdf 13% - 4 seconds remaining"`
  - that runs 0% -> 89% over about **four seconds**, firing **no request** while it does (the file
  is held client-side and posted with Save). So the old wait returned at roughly 13%, Save was
  clicked immediately, and the entry was created with **`document: null`** - no document row, and
  therefore no AI verification ever. The walkthrough failed as an **AI TIMEOUT** (29 polls,
  `ai_verification` stayed null), which points at the model rather than at the upload that never
  happened. Meanwhile the report read `attached NAME-03_....pdf`, because the method returned the
  name it was handed. Same class as the community crop modal, where Save was clicked ~450ms before
  the cropper had decoded anything. It now waits for the settled state - file name shown with a
  size, no percentage and no "remaining" - and throws if it never settles.
- **The UI path took no pre-upload snapshot**, so nothing proved the row a save created was new.
  Caught by `Then the verification result should belong to the document this run uploaded` - which
  is exactly why that guard was promoted into Gherkin. `uploadThroughUi()` now snapshots and runs
  the same `confirmRowIsNew()` the API path does.

Verified after the fixes: entry 8989 created **with** its document (row 26353), and the
walkthrough green at 19/19. Cost of the diagnosis: three permanent profile entries (8988 with no
document, 8989 and 8990 with one).
### >>> HOW FAR THE AI VERDICTS CAN BE TRUSTED (measured 2026-08-25) <<<

Read this before treating any verdict from this module as ground truth. Produced by
`node scripts/probe-ai-verdict-vs-document-condition.js` - read-only, uploads nothing. It maps
every document row on the account back to its fixture and compares the **condition the fixture
was built to contain** against the **verdict the AI actually gave**.

Expectations there come from each fixture's recorded `properties`, **not** from the
requirement's expected-results table, which has never been supplied. That is why the probe can
answer "is the AI right?" today while the suite itself still reports those documents PENDING.

Over **130 verified rows / 437 condition-criterion pairs**: **410 MATCH (93.8%)**, 23 MISMATCH
(5.3%), 3 uncertain-where-definite. A further **24** apparent failures were the AI **correctly**
reporting that the organisation on the document differed from the one declared on the form -
rows uploaded under earlier declared values. Those are excluded rather than counted as AI
defects; conflating the two is the misleading conclusion the probe exists to prevent.

| criterion | MATCH | MISMATCH | stable across runs? |
| --- | --- | --- | --- |
| `identity_name_match` | **122** | **0** | **yes - never varied** |
| `date_validity` | 113 | 9 | no |
| `issuing_organisation` | 91 | 9 | no |
| `transcript_content` | 82 | 5 | no |
| `authenticity` | 2 | 0 | no - least stable |
| `cross_document_consistency` | - | - | no - flipped in 20 of 20 repeats |

**`identity_name_match` is the only criterion that can be relied on.** 122/122 correct with no
variance, and the AI extracted a name agreeing with the fixture's intent in 121 of 124 rows -
independent evidence it really read the file it was given.

**THE AI IS NON-DETERMINISTIC ON THE SAME UNCHANGED DOCUMENT.** Of 193 fixture+criterion pairs
observed more than once, **59 (30.6%) changed verdict between runs on the identical file**:

```
DATE-01 | date_validity        pass, pass, fail
ENG-02  | date_validity        fail, pass, pass
CONT-02 | transcript_content   pass, fail
NAME-06 | authenticity         pass x3, uncertain x3, ... (12 runs, both values)
```

**Consequence for anyone reading a report from this module:** on any criterion other than
`identity_name_match`, one green run is not evidence the rule works and one red run is not proof
it is broken. Wherever the verdict matters it needs repeat observation. This is also the
strongest argument for the expected-results table landing - without it the suite cannot tell
model variance from a regression.

**Confirmed AI defects, verified against the extracted PDF text rather than inferred from the
filename** (so the fixture is known to contain what its name claims):

| Fixture | The document literally says | The AI answered |
| --- | --- | --- |
| `DATE-01` | `Date of Conferral: 15 June 2030` | "All dates are present, well formed, and logically ordered." |
| `DATE-03` | `Date of Conferral: 32nd of Never, 202X` | "All dates are present, well-formed, and logically ordered." |
| `ENG-02` | `Issue Date: 15 June 2030` | "All dates are present, well-formed, and logically ordered." |

These reproduce the Dev report's discrepancies (future date passed, malformed date passed) and
the scenarios asserting them are deliberately left failing.

**Arguable - do NOT file these without a product answer.** `CONT-02` has no `Major / Field` line
yet the AI said all three fields were present - but its degree line reads "Bachelor of Science in
Computer Science", so a model could infer the field. `Systems Limited Pakistan` is reported
"not recognised" 9 times out of 9 on work letters while the test data labels it `recognised` -
whether a private employer counts as recognised is not stated in the AC. And
`authenticity: uncertain` on an ordinary scan with no seal is defensible, since the AC says
"valid digital certificate **where applicable**".
### What has been verified live (2026-08-25)

Measured, not derived. All runs `HEADED=false`, one scenario at a time.

| Scenario | Result |
| --- | --- |
| Every document the test data names exists on disk | **10/11 steps** - red on fixture staleness, below |
| Cross-validation compares four independent name sources | **PASS** 15/15, 25s |
| An agent is offered no decision controls on a document that is not awaiting review | **PASS** 11/11, 22s |
| After a decision the candidate sees the remark and the AI findings behind it | **13/14** - `@known-issue`, red on the last step only |
| A name mismatch is flagged, explained to the candidate, corrected, and cleared | **PASS** 18/18, 41s |
| `npm run test:doc-verify:dry` | **PASS** - auth, reference data, all 53 fixtures resolved, nothing posted |
| An agent requests a revision and the candidate sees the agent as the reviewer | **12/16** - `@known-issue`, red at the candidate surface |
| An agent approves a flagged document and the candidate sees the updated result | **14/22** - `@known-issue`, red at the same point |

### >>> THE CANDIDATE CANNOT SEE A DECISION ON A DOCUMENT THEY JUST UPLOADED <<<

> **PARTLY SUPERSEDED 2026-09-01 - THE DIAGNOSIS WAS TOO BROAD, AND THAT MATTERS.** The conclusion
> below was "there is no candidate surface at all for a recent document's outcome". Re-measured,
> the truth is narrower and far more actionable: the candidate's STATUS is visible for every
> document on `/profile?selectedTab=documents`, and the REASON is visible in the dashboard panel
> for whichever **four** documents that block happens to request - it asks for
> `page=1&page_size=4` and offers no pagination control. So the defect is a hardcoded page size
> on one widget, not a missing surface.
>
> That distinction is the difference between "build a candidate results screen" and "raise a
> page_size and add a control", and the old wording would have sent dev after the wrong work.
>
> **AC section 11 is therefore partly MET and now partly PROVEN.** `status-lifecycle.feature`
> drives the whole chain and passes: an agent decision reaches the candidate's panel with the
> agent's reason attributed to the agent, an AI-set revision reaches it with the AI's own reason
> attributed to the automated system, and the status updates on both portals. The scenarios there
> reach the panel by widening the block's own page size - see the module README.
>
> **The candidate-notification steps are still UNMEASURED**, and that half of the note stands.

The original finding, measured twice on 2026-08-25 - once per decision type, on two different
documents in the same session, so it is not a fixture accident.

Both `@mutates-document` scenarios pass their **entire** agent-side chain: upload, AI run, review
screen listing the failed criteria, the decision committing through the real dialog, and the status
reaching `Revision Required` / `Approved`. Both then fail at `When the candidate opens that document`.

The candidate dashboard's "Your Documents" block listed the **same 4 cards throughout, dated Mar-May
2026, while the account held 154 document rows** - which is the page cap above, seen before its
cause was known. Neither scenario is weakened to pass.

**Consequence to keep in mind: the candidate-notification steps have NEVER EXECUTED.** They resolve
and are dry-run clean, but nothing has confirmed the app raises a candidate notification for a
document decision. That is **unmeasured, not passing**, and the red row does not cover it either way.

### Two more suite defects the decision run exposed (both fixed)

- **The revision scenario never opened the document before clicking Request Revision.** Its Gherkin
  went straight from `When the AI verifies the document` to the commit step, and the decision controls
  only exist inside an open review panel - so it failed as `locator.click: Timeout 30000ms exceeded`
  against `[data-testid="agent-request-revision-button"]`, which reads exactly like a renamed or
  missing test id. Both commit steps now call `ensureReviewPanelOpen()`. The step had never been run
  live, which is why nobody had noticed.
  - The two decision TRIGGERS were also **bare test-id lookups** - the one locator form that cannot
    distinguish "the id was renamed" from "the control is not offered on this document", and both are
    things scenarios here assert. They are layered now and scoped to the review panel, so they can
    never resolve to a decision dialog's submit button.
- **OPENING BY FILENAME STEM IS AMBIGUOUS, AND IT GETS WORSE WITH EVERY RUN.** Uploads are permanent,
  so the same fixture uploaded twice leaves two rows whose stems are prefixes of one another -
  `NAME-03_transcript_different_name_NS6EM35.pdf` and
  `NAME-03_transcript_different_name_NS6EM35_AcaNqtk.pdf`. `findRow()`/`findCard()` rightly refuse to
  guess, so a previously-green scenario went red purely because an earlier run had uploaded the same
  fixture. Both openers are now passed the **full stored filename including its extension**, which is
  what makes the match exact. **This collision is permanent and will recur for every fixture uploaded
  more than once** - never reintroduce stem matching here.

**Two live findings from these runs, neither of them caused by the changes:**

1. **`DATE-08_certificate_expiry_today.pdf` is stale.** Built 2026-08-24 with an expiry of *that day*,
   so from 2026-08-25 it is an **expired** certificate and the scenario *"A document expiring today is
   still treated as valid"* tests the wrong condition. The time-sensitivity guard catches this by
   design and names the remedy: `node scripts/make-doc-verification-fixtures.js DATE-08`. **Not
   regenerated** - regenerating a fixture is a decision for whoever owns the dataset.
2. **The candidate never sees an AI finding attributed to the AI.** The account holds **32** documents
   in REVISION; the dashboard surfaces 2, and **both carry a single comment sourced `Agent`** and
   nothing from the automated system. Two things are tangled and dev should separate them: what "Your
   Documents" surfaces (4 of 152 rows), and whether an AI finding ever reaches the candidate
   attributed to the AI at all - note document 26252 carries AI-worded text stamped `source: "AGENT"`,
   which would make the AC's *"candidate can identify who flagged it: AI Review / Agent"* unmeetable.
   The step is **deliberately not weakened**; the same requirement is covered positively in the
   approve end-to-end scenario, where the suite controls the whole chain.

**Not yet run live:** the 2 `@mutates-document` scenarios (they commit irreversible decisions - the
approve one and its notification assertions are new and unmeasured), the file-validation set, and the
multi-document set. **A full `-p docVerify` run has still NOT been performed** - it costs roughly 40
permanent uploads and every expectation is still PENDING, so it should wait for the expected-results
table.

### Not automatable

`EDGE-06` (`verified_at` stamped once) is **not testable at all** - the field is exposed on no API
response. `EDGE-01` is reachable honestly through `FILE-04`, which is under the 5 MB upload limit but
over the model's 4,718,592-byte inline limit and so produces a real `ai_verification.error`. The rest
are listed with their reasons in the test data's `not_automatable` block.

## Probe scripts

`scripts/probe-*.js` are standalone Playwright scripts used to interactively discover/verify selectors against the live app (e.g. `node scripts/probe-agent-dashboard-empty.js`). They are dev-only utilities, not part of the test run, and are wired into neither runner. (The example here used to name `probe-dashboard.js`, which does not exist and never did; the dashboard probes are the three `probe-agent-dashboard-*.js`.)

- `probe-candidate-profile-education-form.js` - **the one to reach for when the Education add form
  leaves Save disabled.** Fills the form exactly the way the suite does and, after EVERY action,
  dumps every control with its value plus `required`/`aria-invalid` and the Save state - so the
  step that flips the gate (or fails to) is visible rather than inferred. It is how the empty
  institution field was found. Never saves.
- `probe-education-institution-field.js` - why one combobox on that form behaves differently from
  the other two: the label text the form really renders, what control each label owns, how many
  options a term returns, and whether an exact-name option exists. Never saves.
- `probe-candidate-profile-experience-form.js` - **the one to reach for when the Add Experience
  or Add Certification modal leaves Save disabled.** Dumps every `<select>` with its options and
  every `<input>` with its placeholder/name/required flags, then types a series of terms into
  Company Name and prints what each one actually returns. Written because "no option exactly
  named X appeared" cannot distinguish missing reference data from a mis-resolved label from a
  control that needs real keystrokes - and the answer turned out to be a fourth thing (it is not
  a combobox at all). Never saves.
- `probe-company-combobox.js` - the Add Experience "Company Name" and Add Education
  "University/Institution Name" controls dumped as raw HTML side by side. That comparison is
  what proved one is a real `role="combobox"` and the other a plain text input, so the two
  cannot be driven the same way. Never saves.
- `probe-profile-upload-request.js` - **what the form actually SENDS.** Logs every non-GET request
  the save produces with multipart field names, so "the form never registered the file", "the file
  goes to a different endpoint" and "it is sent and dropped server-side" can be told apart. This
  is what proved `document: null` was a client-side timing bug. **IT SAVES** (permanent entry);
  pass `--no-save` to inspect the form without committing.
- **`probe-ai-verdict-vs-document-condition.js` - the one command that answers "is the AI
  actually judging the document it was given?"** Read-only; uploads, decides and spends nothing.
  Maps every document row on the account back to its fixture, then cross-tabulates the condition
  the fixture was built to contain against the verdict the AI gave. `--since YYYY-MM-DD` limits
  it to rows uploaded on or after a date, which is how to get a signal free of history uploaded
  under earlier declared values; `--verbose` also lists the uncertain answers.
  - Expectations are derived from each fixture's `properties`, one value at a time, written out
    explicitly. An inferred rule ("anything off-baseline should fail") would invent expectations
    nobody decided - the same hole the PENDING expected-results table already represents. A
    condition with no decided rule is SKIPPED, never counted as a pass.
  - It separates "the AI says the document disagrees with what you DECLARED" from "the AI does
    not recognise this organisation". The first is the AI working correctly and is reported
    apart; counting it as a defect inflated the mismatch rate from 5.3% to 10.2% before the
    split was added.
- **The Agent-Portal onboarding modal stack** — six probes, all read-only, none of which sends an
  invite. Reach for them before changing any locator in `CandidateOnboardingPage`.
  - `probe-welcome-modal.js` — the one that answers **"is the welcome modal first-login-only or
    candidate-count-driven?"**. Logs in as five different agents and dumps whatever dialog each one
    lands on, beside its KPI figures. This is what proved the modal renders for *every*
    zero-candidate agent, contradicting TFF-158.
  - `probe-welcome-dismiss-persistence.js` / `probe-welcome-modal-scope.js` /
    `probe-welcome-cookie.js` / `probe-welcome-reload.js` — where the dismissal is recorded. They
    watch every request and diff cookies, localStorage, sessionStorage and IndexedDB across a
    dismissal, which is how `sessionStorage.agent_welcome_shown` was found after cookies and
    localStorage had each been ruled out. Run these rather than reasoning about the mechanism.
  - `probe-onboarding-modals.js` / `probe-onboarding-flow.js` — the whole modal stack driven the
    way the scenarios drive it, with every dialog's HTML, every button's `aria-label`/test id, the
    clipboard before and after Copy Code, and the URL each social-share control opens. The source
    of the "the app titles them *Agent Code* / *Invite via Email*" mapping. Note the url it
    prints is the POPUP's, i.e. after the platform's own redirect - for what the app SENDS use
    `probe-agent-code-share-window-open.js` below, which is why the old Facebook finding was wrong.
  - `probe-onboarding-reopen-loop.js` - **the one to reach for when a modal assertion is
    intermittent.** It replays the four-pass card-and-text-link loop and dumps every dialog on
    screen at each step, which is what showed TWO dialogs visible at once mid-transition.
  - **`probe-agent-code-share-window-open.js` - the one that answers "does the app pass the agent
    code to this platform?"** It wraps `window.open` before the click, so it reports what the
    APPLICATION asked for rather than where the popup ended up. This is what proved the recorded
    "Facebook carries no code" finding was the suite reading Facebook's own redirect. Read-only.
  - `probe-agent-code-share-urls.js` - the full redirect chain per platform with timestamps: the
    popup's url at creation, every main-frame navigation, and a code check on each. Run it when a
    share assertion is intermittent; it is what shows the platform's login screen arriving several
    seconds in and taking the code off the url with it. Read-only.
  - `probe-onboarding-entry.js` - where the onboarding entry control actually lives (`/candidates`,
    not `/dashboard`).
- **The candidate invitation journey** - five probes. All read-only EXCEPT the two noted, which
  create real accounts (a candidate cannot be deleted) and are deliberately run as `AGENT_EMAIL`,
  whose candidate count is not a fixture.
  - `probe-candidate-invite-email.js` / `probe-candidate-invite-search.js` — sweep the inbox for
    the candidate invitation without guessing its subject. Between them they showed the
    invitation shares the AGENT invite subject exactly, which is why a subject search "proved"
    it was never sent. Read-only.
  - `probe-candidate-invite-delivery.js` — **the one that answers "is this mail sent at all?"**
    Sends one invitation and then waits for ANY message to that alias, whatever its subject, so
    "not sent" and "sent under an unexpected subject" are distinguishable. **COSTS ONE INVITE.**
  - `probe-candidate-setup-link.js <email>` — resolves the setup link through its SendGrid
    wrapper and dumps the landing page with every field's pre-filled value and `disabled` flag.
    Read-only; the source of the token format.
  - `probe-candidate-lifecycle.js <email>` / `probe-assessment-surface.js <email>` — walk an
    invited candidate through signup, verification, login and onboarding, then dump
    `/getting-started` and whatever the assessment turns out to be, beside the AGENT's In
    Progress row for the same person. **These CREATE a real candidate.** They are how the
    "there is no OTP" and "the assessment is a timed adaptive AI interview" findings were made.
  - `probe-invite-sent-status.js` — the exact Status / Status Detail strings the In Progress list
    renders per quick-filter tab. Read-only; the source of "Awaiting Signup".
- `provision-no-candidate-agent.js` — not a probe. Mints the DEDICATED zero-candidate agent
  (`NO_CANDIDATE_AGENT_*`) and verifies the property before printing the `.env` block: 0
  candidates AND the welcome modal rendering. Run it if that fixture is ever spent.
- **The bulk candidate upload zone** - three read-only probes plus one that sends only
  harmless files. Reach for them before changing any locator in the bulk half of
  `CandidateOnboardingPage`.
  - `probe-bulk-upload-modal.js` - the zone dumped whole: its HTML, every control with its test
    id, the file input's `accept` attribute, and the template file downloaded and printed. The
    source of "Download Template is an `<a download>`, not a button". Read-only.
  - `probe-bulk-upload-states.js` - **the one that answers "did the app take this file?"** It
    uploads a valid CSV, a `.pdf`, an 11MB file, a header-only file, an all-malformed file, a
    binary `.csv` and a mixed file, removing between each, and prints the zone text plus the
    Send Invites state after every one. It is what showed the ~2s fake progress bar, and that a
    chip plus a file raises "You can only use one option at a time". Read-only.
  - `probe-bulk-upload-formats.js` - the accept/reject table across nine extensions,
    drag-and-drop driven through a real DataTransfer, and where a server 422 surfaces. The
    source of the finding that the 422 toast states the wrong reason. Read-only.
  - `probe-bulk-send.js` - **IT SENDS.** Deliberately only files that CANNOT create a candidate
    (header-only, all-malformed, binary), purely to learn the endpoint and its answers. Do not
    point it at a file holding real addresses.
- **The promo notification pair** — two read-only probes, neither of which disables anything.
  Reach for them when a promo email assertion times out, before concluding the mail is unsent.
  - `probe-promo-disabled-mail.js [alias] [hours]` — **the one that answers "is this mail unsent,
    or sent under a subject nobody predicted?"** Lists EVERY message to the recipient in the
    window whatever its subject, then every promo-shaped subject the mailbox has seen in 90 days
    with its last-seen date. That last column is what showed the disabled/resumed mails stopping
    in mid-August while `expired` kept flowing.
  - `probe-promo-agent-stored-email.js` — **the one that answers "is the app emailing an address
    my `.env` does not know about?"** Prints each promo agent's `.env` address beside every address
    on the profile the app opens for it. Found `PROMO_FIXED_AGENT_EMAIL` short by one character.
  - `probe-promo-disable-inapp.js` — dumps the limited promo agent's bell. Run it straight after a
    failed email scenario: the in-app notification it raised is still sitting there unread, so the
    email and in-app legs can be separated for free rather than by disabling the promo again.
- **The agent Referral Codes section** — three read-only probes, none of which mutates a promo.
  Reach for them before changing any locator in `ReferralCodesPage`.
  - `probe-referral-promo-state.js` — **the one that answers "what does the agent actually see,
    and what does the app ASK each share platform for?"** Dumps both widgets, every Promo Details
    field, and per platform the url from a `window.open` recorder beside the popup's landing url.
    That pairing is what proved the recorded "Facebook carries no code" finding is the suite
    reading Facebook's own redirect: the app sends
    `sharer.php?quote=...CODEHFA8X3Y` and Facebook answers `share_channel/?type=empty`.
  - `probe-referral-agent-row.js` — **the one to run when a superadmin-leg step dies in its
    Given.** Prints every agents-list row matching the fixture email, which one
    `disambiguate()` picks, and the promo code on the profile it opens. It is how the duplicate
    `Dup Check | IQRA.FAROOQ+REFAGENT@bytecorp.io` row was found — see the note in
    `AdminPromoToolsPage.disambiguate()`. Opens the profile read-only; saves nothing.
  - `probe-referral-modal-reopen.js` — times open -> close -> open of the share modal, the
    sequence the @provision redemption scenario performs across its first two Givens, and prints
    whether the welcome modal was up before and after each call. Run it when a share-modal step is
    intermittently slow: it is what showed the modal's appearance is NOT reliably ~2s (it tracks
    `/candidate/stats/` resolving, so it sometimes never appears inside the window at all) - which
    is why the dismissal is retried at click time rather than waited for a fixed period.
  - `probe-referral-welcome-block.js` — samples the first-time welcome modal's visibility over
    time, lists its controls, and checks whether Share Code is clickable after dismissal. The
    source of the ~2s appearance measurement: it is absent at 0ms and 1000ms and present from
    ~2000ms, which is why a click made after a detour into another context is intercepted while
    a fast one is not.
- **The Edit Code Parameters expiry field** — two read-only probes, both of which cancel and never
  save. `probe-promo-expiry-clear-noop.js` is the one that proved the field cannot be cleared at
  all (0 editable segments, no clear control, `fill('')` a no-op on the aria-hidden mirror);
  `probe-promo-expiry-required-error.js` drives it four ways and prints what the modal gains after
  each, which is how "the app shows no required error" and "the suite never emptied the field"
  were told apart.
- **The Candidate Portal's Contact Us modal** - four probes. The first three are read-only and
  SUBMIT NOTHING; the fourth does, and every run of it raises a permanent support request.
  - `probe-contact-us.js` - the modal's whole contract plus the full category -> issue dependency
    matrix, read off the hidden mirror `<select>` beside each react-aria dropdown. The source of
    "Other removes the issue field entirely". Read-only.
  - `probe-contact-us-2.js` - the BEHAVIOUR: does switching category reset the issue, do all three
    dismissal routes close it, and does a draft survive a reopen. Read-only.
  - `probe-contact-us-upload.js` - **the one to reach for when a screenshot assertion is wrong.**
    Attaches each file class in turn and REMOVES it between rows, printing the zone text, the
    alerts and the buttons after every one - which is what separates "the app refused this file"
    from "the previous file is still attached and the input is gone". Read-only.
  - `probe-contact-us-submit.js` - **IT SUBMITS.** It is how the endpoint
    (`POST /core/api/v1/candidate/feedback/` -> 201) and the success toast were learned, and it
    then sweeps the mailbox for whatever mail the submission produced, matching on a unique body
    marker rather than a guessed subject. Run it deliberately.
- **The Candidate Details tab** - two probes, and the split matters because one of them writes.
  - `probe-candidate-details.js` - **read-only, and the one to reach for before changing any
    locator in `CandidateDetailsPage`.** The page chrome, all six sections with their icon sets,
    every rendered value beside the payload field that produced it, EVERY modal contract (each one
    opened and CANCELLED), the accessibility audit of the nine bare `<svg>` controls, what each tab
    does to the URL, and what an unrecognised `?selectedTab=` value renders. It is what measured
    the `-` vs `—` placeholder split and the "no tab selected" defect.
  - `probe-candidate-details-mutations.js` - **IT WRITES.** The only thing that answers what a save
    actually sends, whether it persists, and **whether deleting an entry takes its document with
    it** - which it does, correcting a long-standing note in this file. It restores the field it
    edits and deletes the entry it adds, and refuses to run as any account but the Candidate
    Details fixture. Its first version deleted the WRONG row (it indexed one collection and clicked
    another); the row locator and its "exactly one match or refuse" guard both date from that.
- **The Verifications queue - three probes, and NOT ONE OF THEM COMMITS A DECISION.** Approve and
  Request Revision are irreversible, so every dialog these open they cancel and no submit control
  is ever clicked. Reach for them before changing any locator in `AgentVerificationsPage`.
  - **`probe-agent-verifications.js` - the whole surface in one pass**: route and identity, the tab
    strip, the columns and row shape, each tab's URL param beside the API param it produces, the
    Filters modal dumped label by label with each one's control type and testid, each document
    type's URL-vs-API mapping, the two-option union, Clear All, six search variations with both
    empty states verbatim, pagination and the search-from-page-2 reset, the review panel opened on
    each of the three statuses with its react-pdf counts and decision controls, both decision
    dialogs' contracts and their mandatory-reason gate, the unrecognised-`activeFilter` edge cases,
    and the row actions' accessibility attributes. `--no-zoom` skips the zoom walk (every step
    re-renders every canvas, so it is slow), `--no-viewer` skips the panel section entirely.
  - `probe-agent-verifications-2.js` - the three behaviours the first leaves open: the row
    Download, the panel's "View profile" control, and what the row's candidate name/email buttons
    do. Its section C answers **WHOSE profile that second view opens**, printing the row's uploader,
    the panel's uploader block, the landed URL, the profile payloads fetched, the tab strip and the
    profile header side by side - a URL-shape check cannot tell the right candidate from the first
    row's. It is also where the 40-press Tab walk lives that produced the WRONG a11y reading.
  - **`probe-agent-verifications-3.js` - the one that TAKES A CONTROL, and the reason a phantom
    accessibility defect was not filed.** A Tab-only walk never reaches View or Download and
    `button.focus()` does not focus them either, so both readings say "unreachable by keyboard" -
    and both are wrong. This drives the react-aria grid's own model (Tab to the ROW, then
    ArrowRight through the cells) and then presses **Enter** on each action, which is the deciding
    test: Enter on View opens the panel, Enter on Download delivers the file. **Run this before
    filing any keyboard finding against a grid.**
- **`probe-candidate-view-profile.js` - the AGENT PORTAL's candidate profile, mapped end to end:
  which listings offer a route into it, the header and its four widgets, all five tabs and what
  each one queries, all six Candidate Details sections BESIDE the payload field that produced
  them, the Document Verification rows, the Subscription fields, the Activity Log and its
  duration filter, the Reminder History dialog, and an accessibility audit of the chrome.**
  Read-only: it opens both dialogs and closes them and clicks nothing that writes - the screen
  has no form, no Save and no decision control, so there is nothing on it to spend. It is the
  script behind every measurement in "Candidate View Profile" above.
  `--candidate <id>`, `--listing <name>`, `--no-audit` (skips the 60-press Tab walk).
  - It drives the REAL page object rather than its own copy of the readers, deliberately: a
    probe with its own readers can agree with itself while disagreeing with the suite, which is
    how the community module's `readMemberCards()` under-count went unnoticed.
  - Its a11y section is a real Tab walk PLUS A CONTROL, because "nothing focused" is also what a
    broken walk reports.
- `probe-agent-logout.js` — whether avatar → Log out works with a modal open and with it dismissed.
  Written because a scenario's evidence read `signedOutThroughMenu: false` on every run; it proved
  the modal overlay swallows the click rather than the locator being wrong. Read-only.
- **`probe-dashboard-view-all-a11y.js` — the one command that answers "can a keyboard user reach
  the dashboard's View all links?"** A REAL Tab walk (80 presses, enough to cycle the page twice)
  recording every focus stop, then programmatic `focus()`, then Enter and Space, then a CONTROL:
  a real `<button>` on the same page which must focus with `tabIndex` 0 - without that, "nothing
  focused" could just mean the walk was broken. Written because "the markup has no tabindex" is an
  inference, and an accessibility finding handed to dev needs measurement. Read-only: it signs in,
  walks and navigates, and creates nothing.
- `probe-agent-dashboard-empty.js` — the zero-candidate dashboard's KPI widgets and empty states,
  structurally. Shows both the duplicated labels and the `-` placeholder the figures start as.
- `probe-active-candidate-rowheader.js` — **the one to reach for when an Active-tab search step
  times out on a table that is plainly populated.** Dumps the "Candidate" rowheader's `innerText`,
  its `<p>` tags and its raw HTML for the first three rows, beside each row's full text. It is what
  proved the cell holds **no `<p>` at all** (name and email are React-Aria `<button><span>`), so a
  reader waiting for a `<p>` containing '@' reported four working search scenarios as broken. It
  also shows why `textContent` is the wrong fallback there — it glues "Cand Tester" onto the email
  with no separator. Read-only; costs nothing.
- `probe-receipt-pdf-contents.js` — downloads every Paid row's receipt, extracts its text and runs the same `verifyPdfStatesCharge` reader the step uses (deliberately not a second inline copy of the rules — two readers drift, and then the probe and the report disagree about what the file says). Costs nothing.
- `probe-gateway-amount.js` — a fresh candidate, one checkout, and a dump of every observable source of the amount (API request/response, redirect URL, rendered gateway page), then walks away. Costs a live signup + IMAP verification and leaves a Pending row; **makes no payment**.
- `probe-community-filter-applied.js` — prints what `anyFilterApplied()` is looking at in three states (fresh / one filter / after Clear All). The one command that answers "is the app not clearing, or is the reader broken". Read-only, costs nothing.
- `probe-community-member-card-fields.js [name]` — dumps `readMemberCards()` beside the RAW text of each card found via its View Profile CTA, so field attribution can be compared by eye. Flags any "member" that looks like page chrome and prints its ancestor chain. Optional argument picks a community by name. Read-only.
- `probe-community-public-profile.js [id]` — opens the first member's public profile and prints its whole visible text plus which card fields appear in it. Read-only.
- `probe-community-about-cap.js` / `probe-community-about-paste.js` — drive About University four different ways at 299/300/301/400 characters and report what each leaves behind, including whether a path respects `maxlength` and whether it fires keydowns. Written to separate "the app does not cap" from "the reader inserts nothing". Never save.
- `probe-community-create-page.js` — **the one to reach for when the Create form behaves oddly.** Drives the real `CommunityFormPage` and prints, per call, its duration AND the scroll events it produced (with direction reversals, which is what distinguishes thrash from one `scrollIntoView`). Then uploads exactly 10 MB to both fields with an 11 MB control. Defaults to **1280×720**, the viewport a real run actually gets — set `VIEWPORT=1600x950` to see how a taller window hides the problem. Never saves.
- `probe-community-crop-modal.js` — samples the crop modal every 250ms from the moment the file is set, so "the modal is open", "Save is enabled" and "the image has decoded" can be told apart. That is where the 8s-per-upload dead time was found. Never saves.
- `probe-community-cover-control.js` / `probe-community-file-inputs.js` — what each upload locator resolves to, its hit target, and which candidate actually opens a file chooser and how fast. The pair that identified `getByRole('button')` matching a `sr-only` file input. Read-only.
- `probe-community-empty-states.js` — every empty state in the module, captured verbatim without filtering for the wording we hoped to find. The only honest way to fix copy assertions. Read-only.
- `probe-community-majors-search.js` / `probe-community-majors-stray-match.js` — the Majors popover's own search: whether it narrows, is case-insensitive, matches mid-word, what it says when nothing matches, and (the second one) which returned options match the term by no rule at all, with a repeatability check. `TERMS='a|b|c'` overrides the term list. Read-only.
- `probe-community-readers.js` — drives the rewritten `CommunityPage` readers across all four empty states plus the Majors search, so a feature file can be written against measured output rather than intended output. Read-only.
- `probe-community-edit-upload.js` — the accepted-upload path on the **Edit** form (which only a `@mutates-community` scenario otherwise reaches) and the four required-field inline errors quoted verbatim. Never clicks Save.
- `make-exact-10mb-png.js` — not a probe. Builds `images to upload for testing/Exact10MB.png`: a real photograph padded to exactly 10,485,760 bytes. Idempotent, verifies its own output.

### The rest of `scripts/`, and the 2026-09-03 sweep

**Every probe below is deliberate but was previously named nowhere**, which made it
indistinguishable from an abandoned one. They are listed here so the next person reading
`scripts/` can tell a tool from a leftover - that ambiguity is the whole reason a sweep was
needed. All are read-only unless the line says otherwise.

- **`probe-superadmin-candidates.js` — the one command that answers "what does the SuperAdmin
  Portal's Candidates page actually do?"** Read-only: it opens both lifecycle dialogs and
  dismisses them with the confirm button never clicked, so it deactivates nothing and sends no
  email. Eight sections - structure and row actions per tab, the five filter groups WITH each
  one's control type, every filter option's URL param beside the API param it produces, what
  search matches, both empty states verbatim, the View drawer (proving the URL never changes)
  with the requests each tab fires, the deactivation reason gate one reason at a time, and the
  reactivate dialog. Reach for it before changing any locator in `CandidatesListingPage` or
  `CandidateDetailPanelPage`.
  - **It uses a REAL Playwright click on every filter option, and that is load-bearing.** The
    checkbox labels carry `data-react-aria-pressable` and ignore a scripted `element.click()`
    while the radio labels honour one - so a probe mixing the two reported the three checkbox
    groups as ignored by the app, a defect that does not exist.
- `probe-community-universities-left.js` — **the one that answers "can I afford to run
  `@creates-community`?"** Saving a community permanently consumes a university and no delete CTA
  exists anywhere, so this counts what the Create dropdown still offers before you spend one.
- `probe-community-walk-guard.js` — proves `collectAllPages()`'s completeness guard actually
  FIRES on the bug it was written for, rather than only looking as though it would.
- `probe-community-save-gate.js` — **the one to reach for when Create's Save stays disabled with
  every required field filled.** Drives the same Page Object the steps use and reports the Save
  state plus what the form really holds after each action, so "the app never enables it" and "the
  crop modal never applied the image" are distinguishable. Never saves.
- `probe-community-save-button-identity.js` - **the one that answers "which Save is that
  assertion actually reading?"** It opens the crop modal and LEAVES IT OPEN, then prints every
  /save/i button in DOM order beside what the generic step's locator and
  `CommunityFormPage.saveButton` each resolve to. Measured 2026-09-07: with the cropper up there
  are **two**: the form's submit (`type="submit"`, disabled) and the crop modal's
  (`type="button"`, inside `[role="dialog"]`, **enabled**). Never saves.
- `probe-community-candidate.js` — the CANDIDATE side of the Community epic (TFF-334), which no
  superadmin probe can show: the sidebar entry, the BETA badge, and what that session can reach.
- `probe-community-controls.js` / `probe-community-filters-and-upload.js` — the second- and
  third-pass superadmin discovery runs behind the Create form's file inputs and the three filter
  controls. Supersede nothing; `probe-community-superadmin.js` mapped the pages, these mapped the
  controls on them.
- `probe-candidate-inbox-recent.js` — the newest messages in the mailbox, **unfiltered**, so
  "the invitation never arrived" can be told apart from "my search missed it". The right first
  move whenever an IMAP wait times out.
- `probe-forgot.js` / `probe-reset-rules.js` / `probe-reset-email.js` / `probe-ratelimit.js` —
  the forgot/reset flow. Between them: the DOM shape of both pages, the password-requirement UI and
  when submit enables, the reset link out of the live mail, and the rate-limit / Resend cooldown /
  email-normalisation rules. `probe-forgot.js` and `probe-reset-rules.js` deliberately stop before
  the final submit so the one-time token survives.
- `probe-expired-card.js` — what PayTabs does with a past-dated card. **Provisions a fresh
  candidate** (live signup + IMAP) and leaves a Pending row; makes no payment.
- **The Deactivated listing - four probes, and NOT ONE OF THEM WRITES.** There is no reactivate control on that surface at all, so nothing there can be spent; every dialog they open they dismiss. Reach for them before changing any locator in `DeactivatedCandidatePage`.
  - `probe-deactivated-candidates.js` - the STRUCTURE: route, heading, columns, the search input, every page-level button, the filter modal dumped label by label with each one's control type and testid, and pagination. The source of "Pending Documents is a radio group whose labels carry no testid", which a testid-only reader would have missed.
  - `probe-deactivated-candidates-2.js` - the BEHAVIOUR: eight search variations, every filter option's URL param beside the API param it produces, multi-select, the radio group replacing rather than adding, Clear All, Cancel, filter+search together, deep link and reload, the View destination, and pagination.
  - **`probe-deactivated-candidates-3.js` - the one that takes a CONTROL, and it is why two "defects" were never filed.** It searches an address WITH a `+` beside one WITHOUT, and reads the server's own `count` beside the rendered row count for each filter and for their union. Both suspected defects dissolved: the `+` is handled correctly, and the union arithmetic is right (the earlier reading compared two moments of a list that had grown 4 -> 6 underneath it).
  - `probe-deactivated-candidates-4.js` - the two questions the others left open: the tab-level empty state on a zero-candidate agent (currently unmeasurable - that fixture's login times out), and how an agent returns from the profile. It is what established there is NO `Back` control on that screen and that the browser's own Back restores the filter, the badge, the search term and the rows.
- **`probe-requires-attention.js` / `probe-requires-attention-2.js` — the Requires Attention
  pair: the first maps the STRUCTURE (tabs, columns, search, filter modal, row actions, the View
  destination, the Reminder History dialog, pagination), the second the BEHAVIOUR (does search match
  an email, a partial term, case-insensitively; is a blank term sent; does pagination reset on
  search; is a Severity filter honoured on a severity TAB — it is not).** Both read-only: they open
  the filter modal and the reminder dialog and dismiss both, and the tab has no Send Reminder
  control at all, so neither can send anything. **The second drives the real `RequiresAttentionPage`
  rather than its own copy of the locators** — a probe with its own readers can agree with itself
  while disagreeing with the suite, which is how `readMemberCards()`'s under-count went unnoticed.
- `probe-inprogress-reminder-icon.js` — whether the reminder-history icon is disabled on a
  candidate the app classifies "No Reminder Sent". The only DOM surface the Reminder Status filter
  can be checked against. Opens no panel, sends no reminder.
- `probe-onboarding-methods.js` — the onboarding modal stack in one pass (entry control, chooser,
  both modals). Overlaps `probe-onboarding-modals.js`, which dumps more; keep this one for a quick
  look. It NEVER clicks Send Invites.

**Eleven scripts were deleted in the same sweep** and are recorded here so nobody re-adds them:
three self-declared throwaways (`probe-verify-email.js` and `probe-signup-e2e.js` both said "TEMP"
in their own headers, `probe-invalid-token2.js` was an unlabelled second copy of
`probe-invalid-token.js`), and eight superseded by a documented probe on the same subject —
`probe-agent-code-modal.js` / `probe-agent-code-share-sequence.js` (see
`probe-agent-code-share-window-open.js`, which reports what the app SENDS rather than where the
popup lands), `probe-welcome-modal-controls.js` / `probe-welcome-modal-state.js` (see
`probe-welcome-modal.js` and `probe-welcome-dismiss-persistence.js`, which answered the
sessionStorage question this one was still asking), `probe-community-majors.js` (see
`probe-community-majors-search.js`), and `probe-invalid-token.js`, `probe-invalid-formats.js`,
`probe-email-normalize.js` (all three are forgot/reset form checks that `probe-forgot.js` and
`probe-ratelimit.js` already cover, the last one explicitly).

## Running a scenario from VS Code

Use the official **Playwright Test for VSCode** extension (`ms-playwright.playwright`, recommended
in `.vscode/extensions.json`). It runs `configs/playwright.config.js` directly, with no profile,
so it lists **every** runnable scenario from `.features-gen/all/` - run `npm run gen` once if the
Testing panel is empty. `globalSetup` regenerates stale specs before a run, so an edited
`.feature` or step file is picked up.

- **Clicking a costly scenario in the editor runs it.** No profile means no exclusions - that is
  the "I am naming what I want" path, and an `@invite-candidate` or `@doc-verification`
  scenario started there really creates its permanent rows.
- The scenario appears under its feature's describe block in the `parallel` or `serial`
  project, according to its tags.
- The Cucumber *runner* extensions (`nick-mandziak.vscode-cucumber-js-runner`,
  `sleeper-inc.cucumber-runner`) no longer work - there is no `cucumber-js` to run - and are
  listed as unwanted; disable them. The shim `configs/vscode-cucumber-runner.js` that rewrote
  Cucumber's stats line for one of them was deleted with Cucumber. The official Cucumber language
  extension stays useful for highlighting and go-to-definition (`.vscode/settings.json` points it
  at `steps/**/*.js`).
- The old warning still applies in spirit: an extension that auto-runs a file you just saved is a
  concurrent run, and the second run's `reports/` sweep deletes the first's evidence.


## Change Password (`features/Agent_Portal/Change-Password.feature`)

The Account Settings > Security > Password card, its "Set a New Password" modal, and the full
rotation lifecycle. 12 scenarios, one step file (`steps/change-password.js`), one page object
(`pages/ChangePasswordPage.js`).

- **`npm run test:change-password`** (`-p changePassword`) — the whole feature. Writes
  `reports/change-password-report.json`, not the shared path.
- **`npm run test:change-password:recover`** — **not a test run.** The fixture repair; see below.
- **It is IN the default `npm test` run** — nothing excludes `@rotates-password`. So a wedged
  fixture here poisons the default run's report as well as this profile's.
- **MUST RUN SERIALLY.** The `@e2e` scenario rotates the shared account's real password and
  rotates it back, so two workers would have one scenario signing in while another has just
  invalidated that password. Do not add `--parallel`.

### >>> EVERY SCENARIO FAILING AT ITS BACKGROUND WITH "Invalid Credentials" IS A WEDGED FIXTURE, NOT A PRODUCT DEFECT <<<

Diagnosed 2026-09-07, and it had happened at least once before (`TWOFA_JIRA_VS_APP.md` §4 records
the same account unreachable on 2026-08-24 under a previous address). The report reads as though
login is broken; what is actually broken is the password `.env` names.

Measured directly against `POST /core/api/v1/auth/token/`:

```
AGENT_CHANGEPASSWORD_OLD_PASSWORD  -> 401 {"detail":"Invalid Credentials"}
AGENT_CHANGEPASSWORD_TEMP_PASSWORD -> 401 {"detail":"Too many failed sign-in attempts.
                                                     Try again in 59 minute(s)."}
```

**Three separate faults compounded, and each is worth knowing on its own.**

1. **`utils/envWriter.js` HAD BEEN WRITING OUTSIDE THE REPO SINCE THE TOP-LEVEL RESTRUCTURE.**
   It resolved `__dirname/../../.env`, correct while the file lived two levels deep and wrong the
   moment it moved to `utils/` — so `..` `..` resolved to the PARENT OF THE PROJECT and every
   persisted value landed in `C:\Users\Byte\Documents\.env`, which dotenv never loads. The suite
   printed `updated in <path>` and the project `.env` went on holding a stale value.
   - **Proved on a second account, not inferred.** The stray file held
     `FORGOT_PASSWORD=Tf!Reset2829aZ` while the project `.env` held `Tf!Reset1299aZ`. Against the
     live API the project value answered **401 Invalid Credentials** and the stray one **200**.
     So `Forgot-password.feature` was carrying the same defect: it resets a password, reports it
     saved, and the next run signs in with the previous one.
   - It also orphaned `TWOFA_AGENT_SECRET` — the one value `TWOFA_JIRA_VS_APP.md` says is
     persisted *because* an account with 2FA left on is otherwise unreachable by any means the
     repo owns. It was never in the project `.env` at all.
   - Both values were migrated back on 2026-09-07. **The stray
     `C:\Users\Byte\Documents\.env` is a leftover and can be deleted** — nothing reads it.
   - The module now **asserts** the `.env` it writes sits beside `package.json` and throws
     otherwise, so moving the file again fails loudly instead of writing a credential into a
     directory nobody reads.

2. **Nothing persisted the rotated password, so a run that died mid-rotation lost it.** The
   feature rotates ORIGINAL -> TEMP -> ORIGINAL on a **real shared agent**. `state.currentPassword`
   lived only for the run, so a failure between the two halves left the account on a value nothing
   on disk named. `KNOWN_PASSWORDS` covers the TEMP case; it covers nothing else, and once both
   names are wrong the account is recoverable only through a live password reset.
   - `rememberPassword()` now writes `AGENT_CHANGEPASSWORD_OLD_PASSWORD` at every point the live
     password becomes **known**: a login that proves which value works, and a rotation the app has
     confirmed.
   - **It keys off `_rotationTarget`, not `_newPassword`.** The `@e2e` scenario passes through the
     success-toast step twice (rotate, then restore) while `_newPassword` stays TEMP throughout
     (`I log in with the new password` needs it), so keying off `_newPassword` would record TEMP as
     live immediately after the account had been put back on ORIGINAL. The target is consumed on
     use so a later toast cannot re-apply a stale one.
   - **Persistence is gated on the app's own confirmation**, never on having clicked Save. The
     success toast is the evidence for a scenario rotation; leaving `/settings` for `/login` is the
     evidence for the safety hook's restore. Recording the intended value optimistically is
     precisely how `.env` came to name a password the account was not on.

3. **>>> FAILED SIGN-INS ARE RATE LIMITED, AND THE SELF-HEALING LOGIN IS WHAT TRIPS IT. <<<**
   This is what turns one stale `.env` entry into twelve red scenarios. The Background runs per
   scenario and `resilientLogin()` walks **every** known password, each with its own retries — so a
   stale `.env` costs several failed attempts per scenario and the account locks out within a few.
   After that the API **stops evaluating the password at all**, so a *correct* password is refused
   too: the first scenario's failure is the fixture, and every one after it is collateral.
   - **A lockout is its own verdict now, never folded into "rejected".** A rejection means "this
     password is wrong, try the next"; a lockout means "no password can be evaluated, stop". They
     are checked lockout-first, because the lockout wording also matches the rejection pattern via
     "attempts"/"Try again" and mistaking one for the other sends the next attempt straight back
     into the throttle.
   - **`state.wedged` is a run-level latch.** Once a run establishes that no known password works,
     every later scenario fails **immediately** on that verdict. Not an optimisation: re-proving it
     is what deepens the lockout, so without the latch a stale `.env` leaves the account unusable
     for the next hour as well as this run.
   - **The failure message names the cause and the way out** (`wedgedMessage()`), because a bare
     "could not log in as ..." is what let this read as a product defect for weeks.
   - **The throttle is per ACCOUNT, not per IP** — measured: `FORGOT_EMAIL` logged in with 200
     while this account was locked out. So a wedged fixture here cannot affect the rest of the
     suite.

### Recovering the fixture: `npm run test:change-password:recover`

`scripts/recover-changepassword-agent.js` drives the product's own **Forgot Password** flow for
`AGENT_CHANGEPASSWORD_EMAIL`, sets a fresh requirement-satisfying password, verifies it by logging
in, and writes it to `.env`. Costs one reset email off the live IMAP inbox; **no payment, no new
account, nothing permanent created.**

- **Reset, not re-provision, and deliberately so.** AN AGENT CANNOT BE DELETED, so minting a
  replacement abandons the old one permanently and the addresses accumulate — which is how this
  account's address already changed once (`TWOFA_JIRA_VS_APP.md` §4 names `iqra.farooq+5@`).
- **It never guesses a password.** Guessing is what causes the lockout; the reset flow needs no
  password at all, so it works *during* a lockout.
- **`.env` is written only after the login verifies** — except under an active lockout, where the
  reset has succeeded but cannot be confirmed. There it records the value and says plainly that it
  is unverified, rather than either discarding a good password or claiming a verification it did
  not perform.
- `--password "Known!Pass123"` pins the value; it refuses one equal to
  `AGENT_CHANGEPASSWORD_TEMP_PASSWORD`, since the `@e2e` rotation needs the two to differ or the
  "new password must be different from your current password" rule blocks it.
- **Do NOT re-run the feature to "see if it works" before recovering.** Every failed sign-in
  extends the rate-limit window.

Applied 2026-09-07: the reset succeeded (mail uid 24563) and `.env` was updated in place. The
login verification was blocked by the still-open lockout window and confirmed separately once it
expired.


## SuperAdmin Portal - Candidates (`features/SuperAdmin_Portal/UserManagement/Candidate-*.feature`)

The superadmin's candidate list at `/candidates`, its filter modal, the View drawer and both
lifecycle actions. Added 2026-09-07, deliberately mirroring the Agents pair next to it.

- **`npm run test:candidate`** (`-p candidateManagement`) - **the one to run.** 46 scenarios
  across both files. **Nothing in it changes an account**: every dialog it opens it dismisses
  again. No payments, no inbox, no fixture spent.
- **`npm run test:candidate-mutating`** (`-p candidateMutating`) - the 1 scenario that really
  deactivates a candidate and reactivates it. Excluded from the default run by
  `@mutates-candidate`. See the guard below before running it.
- The 45 read-only scenarios ARE in the default `npm test` run, exactly as `@agent-management`'s
  48 are.
- Steps live in **`steps/candidate-management.js`**; page objects are `CandidatesListingPage`
  (extended - it already existed for the edit-email flow) and the new
  **`CandidateDetailPanelPage`**.
- **`node scripts/probe-superadmin-candidates.js`** is the read-only probe behind every string,
  param and control below. It commits nothing - both lifecycle dialogs are opened and dismissed
  with their confirm button never clicked. **Re-run it rather than reasoning about the DOM.**

### Expected baseline (MEASURED 2026-09-07)

`npm run test:candidate` - **46 scenarios, 45 passed / 1 failed, 21m 06s** (headless, serial).

**The one red is `@known-issue` and is the finding this module exists to surface**: ~~the Status
filter silently discarded on a lifecycle tab~~ - since 2026-10-19 it is **a leftover `?status=`
URL param filtering the All tab invisibly** (see "THE STATUS GROUP IS GONE" below). A green run
means exactly that one is red and nothing else is. (Scenario counts moved too - re-measure.)

`npm run test:candidate-mutating` - **1 scenario, 20/20 steps, 1m 09s.** It deactivated
`uat.candidate1700@talentforge.test` with reason "Temporary hold", confirmed the move to the
Deactivated tab on the server, reactivated it and confirmed the move back.

- **The After-hook safety net is PROVEN, not assumed.** An earlier run of that scenario failed on
  its last assertion while the candidate was deactivated, and the hook reactivated it and said so
  in the report (`RESTORE: ... Reactivated successfully - the server now reports it as Active`).
  That is the one part of this module that had to be demonstrated rather than reviewed.
- **A superadmin-login flake was seen once**, in the shared `Given I am logged in as the
  superadmin` (`steps/invite-agent.js`): `page.waitForURL: Timeout 90000ms exceeded` on 1 of 46
  scenarios. The same scenario passes alone in 16s. That step is shared by most of the suite and
  one observation is not enough to justify changing it - **if it recurs, fix it there rather than
  adding a retry here.**

### >>> THE VIEW IS A DRAWER, NOT A ROUTE, AND THAT IS THE WHOLE STRUCTURAL STORY <<<

Measured 2026-09-07. The agent equivalent is a real page at `/agents/view/<id>?tab=`; this is not.

- **The URL stays exactly `/candidates`.** There is no `/candidates/view/<id>`.
- **No panel tab writes a `?tab=` param**, so a tab cannot be deep-linked, reloaded into, or
  reached with the browser Back button.
- **There is no Back control**, and **no lifecycle action inside the drawer** - no Deactivate,
  no Reactivate, no "Log in as". Those live only on the listing row.

So none of the agent profile's navigation coverage transfers, and a step asserting a URL after
View would be asserting a route the product does not have. The drawer's five tabs are
`Candidate Details | Track Progress | Documents | Subscription | Activity Log`, as
`<button role="radio">` in one radiogroup - **not `role="tab"`**, so a `getByRole('tab')` reader
finds nothing. `Verify that the candidate view is a drawer with no route, no deep link and no
Back` is the one place this is recorded; it is `@edge-case` and goes red the day the product
gives the view a route, which is the point.

### The profile is fetched ONCE, when the drawer opens

**Candidate Details and Documents fire NO request on selection** - both read the payload the
drawer fetched as it opened, and re-selecting either does not re-query (measured, including
after switching away and back). Only three tabs query on selection:

| tab | endpoint | note |
| --- | --- | --- |
| Candidate Details | *(none)* | reads the opening `GET /candidate/profile/<id>/` |
| Documents | *(none)* | the same payload |
| Track Progress | `GET /tracks/candidate/<id>/` | **404 when no track - the NORMAL answer** |
| Subscription | `GET /subscription/current/<id>/` | **404 when none - also normal** |
| Activity Log | `GET /analytics/candidates/activity-logs/<id>/?duration=` | |

- **The two 404s are not errors.** The panel renders its own copy for each, and a scenario
  treating a 404 here as a failure would report every unsubscribed candidate as broken.
- **The first version of the per-tab table expected Candidate Details to query on selection**
  and failed with *"Candidate Details fired no request"* - a true statement about a working
  panel and a misleading one about the product. The opening fetch is now asserted by its own
  step (`opening the drawer should have fetched that candidate's profile`), which also checks
  the **id** in that URL against the row that was clicked: a drawer that always renders the
  first row reads as "the superadmin is shown the wrong status", and the document-verification
  module was caught by exactly that.

### >>> 2026-10-19: THE STATUS GROUP IS GONE - THE MODAL HAS FOUR GROUPS NOW <<<

Measured live on every tab: Account Verification Status, Pending Documents, Subscription Status,
Last Activity. Account status is chosen by the All / Active / Deactivated **tabs alone** - the
product's fix for the Status-vs-tab defect below. In the same change Last Activity's "30+ days"
became **"Inactive (30+ days)"** (URL/API values unchanged) and the drawer's Activity Log periods
went to sentence case ("Last 24 hours"). Every scenario that set Status now drives the matching
tab. (A scenario asserting the modal offers no Status group was removed 2026-10-19 on request;
`Verify that the Filters modal presents every group...` already pins the exact four groups.)

**One defect survives the fix and is the file's `@known-issue` now**: the listing still OBEYS a
`?status=` param (a bookmark or shared link from before the change). `/candidates?status=deactivated`
sends `is_active=false` and lists only deactivated candidates while the **All** tab is selected,
the button reads plain "Filters" and the modal has nothing checked. Clicking All does not clear
it; applying another filter stacks on it; only the modal's Clear All removes it. Ask the PO:
ignore the stale param, or re-sync the tab to it. The table below is the PRE-2026-10-19 modal.

### The filter modal has FIVE groups and two of them are single-select radios

| group | control | options | url param | api param |
| --- | --- | --- | --- | --- |
| Status | checkbox | Active / Deactivated | `status=active`/`deactivated` | `is_active=true`/`false` |
| Account Verification Status | checkbox | Verified / Unverified | `accountVerification=verified`/`unverified` | `verification_status=verified`/`unverified` |
| Pending Documents | **radio** | 0 / 1-2 / 3+ | `pendingDocuments=0`/`1-2`/`3plus` | `pending_documents=0`/`1-2`/`3+` |
| Subscription Status | checkbox | Subscribed / Not Subscribed / Payment Due | `subscriptionStatus=subscribed`/`notSubscribed`/`paymentDue` | `subscription_status=subscribed`/`not_subscribed`/`payment_due` |
| Last Activity | **radio** | Last 24 hours / Last 7 days / Last 30 days / 30+ days | `lastActivity=24h`/`7days`/`30days`/`inactive` | `last_activity=24h`/`7d`/`30d`/`inactive` |

- **NOT ONE url param equals its api param**, which is why the table asserts both. Checking only
  the URL would pass on a front end that rewrites the address bar and queries the server for
  something else - and that cannot be caught by reading rendered rows either.
- **Pending Documents and Last Activity are RADIOS.** A second option there REPLACES the first,
  and a selected radio cannot be un-selected by clicking it again - Clear All is the only way
  back. So the "two options in one group return the union" scenario is aimed at **Subscription
  Status**; aimed at a radio group it would assert behaviour the control cannot have.
- **>>> ONLY THE CHECKBOX LABELS CARRY `data-testid`. <<<** The radio labels carry none
  (`filters-<group>-<slug>-checkbox` exists for 7 of the 14 options), so a testid-only reader
  silently sees half the modal and any assertion counting options passes having inspected seven.
  `readFilterOptions()` therefore walks **every** `<label>` in the dialog in DOM order and
  `selectFilterOption()` clicks by the index that same pass produced - one list, so the index a
  step reads is by construction the index the click acts on. That is the community module's
  `resolveFilterPopover()` lesson applied up front.
- **>>> THE CHECKBOX LABELS NEED A REAL POINTER CLICK. <<<** They carry
  `data-react-aria-pressable`, and `element.click()` on them is a **silent no-op** - Apply then
  produces a URL with the param missing. The RADIO labels DO respond to a scripted click, which
  is what made this confusing while probing: a mixed pass reported the two radio groups working
  and the three checkbox groups ignored, i.e. an app defect that does not exist. Every selection
  goes through a Playwright `.click()`.

### Deactivation is gated TWICE; reactivation is gated not at all

That asymmetry is the most interesting thing about the pair and is asserted in both directions.

- **Deactivate Candidate Account** - heading verbatim. Body promises four things (prevent login,
  pause subscriptions, keep the data, allow reactivation). **"Reason for Deactivation \*"** is a
  real `<select>`: *User requested closure / Policy violation / Temporary hold / Duplicate
  account / Fraudulent activity / Other*. Confirm ("Deactivate Account") is **disabled until a
  reason is chosen**, and **"Other" reveals a second required field** ("Please specify reason
  \*", placeholder "Enter reason for deactivation...") and **re-disables** it. Whitespace alone
  does not satisfy that field - measured, and the build gets it right.
- **Reactivate Account** - names the candidate and their email, says access returns instantly
  and that a reactivation email will be sent. **No reason, confirm enabled on open.**
- Row actions are **icon buttons with an `aria-label` and no inner text** (`View` / `Edit` /
  `Deactivate account`, and `Reactivate Account` on the Deactivated tab), so a text locator finds
  nothing on a row that plainly offers all three. One scenario asserts that accessible name
  exists at all - a regression to a bare `<svg>` would make the controls unreachable by a screen
  reader AND unlocatable by every step in this file.

### >>> THE MUTATING SCENARIO IS AIMED AT A SEEDED uat.candidate ACCOUNT, NEVER AT A FIXTURE <<<

`candidateLifecycleGuard()` in `steps/candidate-management.js` is **positive and
identity-based**, like `inviteFixtureGuard()`: it names what MAY be deactivated
(`uat.candidate<N>@talentforge.test`, or whatever `CANDIDATE_LIFECYCLE_EMAIL` pins) and refuses
everything else **regardless of tags, hooks or which step is calling**. A tag-driven guard is
one missing hook away from spending the wrong account - which is exactly how
`REFERRAL_NOPROMO_AGENT`'s zero-candidate state was destroyed on 2026-08-27.

- **The shared `CANDIDATE_EMAIL` must never be deactivated.** It is the login for the
  subscription, promo and document-verification suites; deactivating it would stop all three
  working for a reason that looks nothing like the cause.
- `talentforge.test` is undeliverable, so the reactivation email the round trip causes reaches no
  real inbox.
- **The `After` hook reactivates the candidate if the scenario dies between the two halves, and
  never throws** - a failed restore is *attached* instead, loudly, because masking the scenario's
  own failure with a cleanup error sends whoever reads the report after the wrong problem.
- Both halves are verified against the **server's** answer, not the row left on screen: the grid
  keeps the previous query's rows while the next is in flight, so a DOM read straight after
  confirming reports the candidate as still on the tab it just left.

### >>> FIXED 2026-10-19 (the Status group was removed) - kept as history: A STATUS FILTER SET AGAINST A LIFECYCLE TAB WAS SILENTLY DISCARDED <<<

**THE TAB ALWAYS WINS AND THE STATUS FILTER IS ALWAYS DROPPED.** Re-verified live 2026-09-07
three ways - by clicking, by hard-loading the URL, and in both directions:

```
?accountTab=active&status=deactivated   ->  GET …/candidate/?…&is_active=true    (Active tab's value)
?accountTab=deactivated&status=active   ->  GET …/candidate/?…&is_active=false   (Deactivated tab's value)
```

The `status` param never reaches the API at all. Either way the URL records the filter and the
Filters button reads **"Filters 1"**, so the superadmin is told a filter is applied while the
list is unchanged.

**The two paths differ, and the reload is the more damning one:**

- **clicking Apply fires NO request at all** - the app evidently sees the query as unchanged;
- **reloading that same URL fires one carrying the TAB's value**, with `status` dropped. The
  filter is not merely un-applied; the opposite value is sent.

**An earlier version of this note said the reload "behaves identically" to the click. That was
wrong** - it would have sent a developer looking for a click handler that never fires, when the
bug is in how the two params are reconciled. The step now measures and reports both paths.

With no `accountTab` at all (the **All** tab), `?status=deactivated` filters correctly
(`is_active=false`). `Verify that the Status filter is applied rather than silently ignored on a
lifecycle tab` asserts the sensible behaviour and is `@known-issue @needs-clarification`. Either
fix is defensible - re-sync the tab to the filter, or disable the Status group while a lifecycle
tab is chosen - **so ask the PO which.**

**11 of its 12 steps pass**, including `the candidates URL should contain the filter
"status=deactivated"` and the applied-filter count. Only the last step is red. Skimming the
report, this scenario looks green - it is not.

### Divergences from the Agents listing, RECORDED rather than failed on

No AC says which of each pair is right, so failing on them would make this module permanently red
over questions for the PO and bury the findings that matter - the call the receipt-PDF currency
step and the agent-email "Talentforge" spelling already got. **Ask the PO about all four.**

1. **A whitespace-only search is SENT to the server.** The agents listing suppresses it entirely
   and fires no request; this one keeps it out of the URL but sends `search=%20%20%20` and gets
   the unfiltered list back. The outcome the user sees is correct and one round trip is wasted.
2. **The filtered empty state's CTA reads "Clear all filters"** where the agents listing says
   "Clear All". Both are asserted as measured; neither is pinned as the house style.
3. **The applied-filter badge counts GROUPS, not options.** Two options in one group read
   "Filters 1"; one option in each of two groups reads "Filters 2".
   `Agent-Search-Filters-View.feature` asserts **2** for two options in one group, so the two
   listings genuinely disagree about what the number means.
4. **Edit is rendered but DISABLED on every Deactivated row** (10 of 10, whatever the row's
   verification state), where the Agents listing renders no Edit at all. The two listings agree
   on the RULE - a deactivated account's email cannot be changed - and differ only in how they
   say so, so this is asserted as measured rather than filed.
   - **It does mean `Edit-Email.feature`'s matrix row `Candidates | Deactivated | edit: yes` is
     reporting a control nobody can use.** That file owns its own matrix and was not touched from
     here; **ask the PO whether "offered" should mean "enabled" there.**
   - The scenario originally assumed Edit worked and went on to open the modal. It failed with a
     30s `element is not enabled` timeout, which reads like a broken locator and says nothing
     about the rule.

### TWO PAYLOAD TRAPS THAT EACH REPORTED A WORKING FILTER AS BROKEN

Both were found by the first full run and both are the same class: a reader keyed to the wrong
field or the wrong wording, inventing a defect.

- **>>> THERE ARE TWO VERIFICATION FLAGS AND THEY DISAGREE ON THE SAME ROW. <<<**
  `is_verified: true` alongside `is_email_verified: false`. The **Account Verification** column
  and the `verification_status=` filter both mean **`is_verified`**. An assertion built on
  `is_email_verified` reported Verified as returning a row that "failed" and Unverified as
  returning ten - against a filter that is completely correct (confirmed live: every row a
  `verification_status=verified` query returns renders "Verified").
- **>>> `account_status` IS `"Inactive"` WHERE THE GRID RENDERS `"Deactivated"`. <<<** And the tab
  is a third name for the same state. `CandidatesListingPage.statusIs()` accepts the pair;
  pinning the rendered wording makes every payload assertion red and pinning the API's makes
  every grid assertion red. This bit twice - once in the filter rules, once in the mutating
  round trip's final check, where it failed AFTER a deactivation that had plainly worked.
  `Verify that a row's account status means the same thing in the grid and in the payload`
  reports the pair per row for the PO.

### A page already fetched is re-rendered with NO request, and that is correct

`Previous` after `Next`, and clearing filters back to a page already seen, both fire nothing and
render the right rows. So `payload` is legitimately null there and `candidatesFrom(null)` is `[]`
- which every payload-based assertion reads as "no candidates listed". Two scenarios failed
exactly that way, each describing an empty list the superadmin was never shown.
`lastPayloadCandidates()` falls back to reading the grid **only** in that case, and says in the
report which source it used. Reading the DOM is otherwise forbidden here (the grid holds the
previous query's rows while the next is in flight) - the hazard simply does not exist when no
query was made at all.

### Edit > Update Email Address is NOT re-covered here

`Edit-Email.feature` owns that modal's rules and already drives **this very listing** for four of
its scenarios. A second copy would assert one modal twice and the two would drift. Only the
candidate-specific gaps are in the new files (Edit offered on the Deactivated tab, and the
pending-email marker). Run `npm run test:edit-email` for the modal itself.

### Candidates coverage pass of 2026-10-26: the drawer, pagination, lifecycle

Probe: `node scripts/probe-superadmin-candidate-drawer.js [--only A|B|C|D]` (read-only).
- **`Candidate-View-Drawer.feature` (new, `@candidate-drawer`, read-only, in the default run).**
  Steps `steps/candidate-drawer.js`; readers added to `CandidateDetailPanelPage.js` (PART 2). Every
  tab is compared with the response the app received for the opened candidate; subjects are chosen
  live (pending-documents / subscribed / tracked / activity / empty-profile filters) and **cached
  per worker** - re-scanning in every scenario on 3 workers starved the browser (drawer took >3m).
  - Documents: rows `.document-list-item` with bare-`<svg>` actions
    `candidate-profile-document-view-button` / `-download-button`. View opens "Document
    Verification" (Document Name / Type / Date Uploaded / Status / Version `v<n>.0`, "Flagged for",
    zoom 50-200% in 25s). **Type reads Transcript / Experience Letter / Certification**, not the
    category headings. react-pdf needs ~9s - wait for `.react-pdf__Page canvas`. Download (row and
    viewer) delivers the stored file; Escape/X close the viewer only. Clicking the file name does
    nothing - INTENDED (PO, 2026-10-26). **Approve / Request Revision appear for the SUPERADMIN on
    Needs Review documents, and the superadmin IS meant to decide there (PO, 2026-10-26)** - only
    read by the suite, never clicked, because a decision is irreversible.
  - Activity entries are `.activity-log-item`. Subscription "Total Fee" = `payment.amount`.
  - **4 `@known-issue`:** a 500 on Subscription reads "does not have an active subscription", on
    Activity Log "No activity to show", on the profile "hasn't added ..." everywhere; and a
    candidate with no `qualification` stored shows Current Status "Student" (`@needs-clarification`).
- **Pagination (21 scenarios) moved into `Candidate-Search-Filters-View.feature`**, driven by the
  listing-name steps in `steps/user-management-edges.js` (tab filter checked as `query`: All sends no
  `is_active`). Rows are compared as SETS because the grid re-sorts the server's page (still the
  `@known-issue` order scenario - now on page 1 too). The "page past the end" `@known-issue` is FIXED
  (404 "Page not found"). "Apply the first filter" goes through each listing's own `openFilters()`:
  a generic `getByRole('button', /^filters/)` hung on the Candidates page.
- **Lifecycle:** Edit disabled on Deactivated rows is now also asserted inert (forced press: no
  modal, no request), on the All tab and after a search; Edit enabled on every Active row; a
  deactivated candidate is still viewable. `@mutates-candidate` gained a stubbed-500 deactivation
  (reported, candidate stays Active) and a round trip asserting Edit disabled -> enabled.
- **Stale wording fixed:** the reactivate dialog is "Re-activate Account" (body "re-activation
  email"); the row action is still "Reactivate Account".
- **Measured 2026-10-26, `npm run test:candidate` (3 workers): 103 scenarios, 97 passed / 6 failed,
  23m 50s** - the 6 reds are exactly the 6 `@known-issue` scenarios (grid order, failed list load,
  and the drawer's four), 1 flaky (passed on retry). `npm run test:candidate-mutating`: 3 passed.

### Candidates listing gap pass of 2026-11-02 (`Candidate-Listing-Values.feature`)

14 read-only scenarios, `@candidate-listing-values`, in the default run and in `npm run test:candidate`.
Steps `steps/candidate-listing-values.js`; the two help-icon steps are reused from
`agent-listing-values.js` (they read any column header).
- **Every cell vs the server**, rows matched by EMAIL (the grid re-sorts - separate `@known-issue`):
  All / Active / Deactivated page 1 and All page 2. `subscription_status` snake_case renders Title
  Case; `account_status` "Inactive" renders "Deactivated"; `last_login` is rendered verbatim.
- **The email warning icon follows `is_email_verified`, NOT `pending_email`.** It appears on every
  row whose sign-up email is unverified, yet its tooltip reads "Email update will take effect once
  the new email is verified by the candidate." on candidates with no change pending (`@known-issue
  @needs-clarification`). The icon also has no accessible name (`@known-issue`), and neither does
  the "Account Verification" header help icon (its tooltip works on hover and keyboard).
- The candidate's and agent's name/email buttons in a row do nothing (asserted as measured,
  `@needs-clarification`: should the agent open its profile?). The search never matches the Agent
  column; it matches the candidate's own name/email word by word.
- **Sidebar defect, `@known-issue`:** from a searched + filtered Deactivated view the sidebar
  Candidates link rewrites the URL to `/candidates` but leaves the screen as it was and sends no
  request - the same defect the Agents sidebar link has.
- `Edit-Email.feature`'s Edit matrix now distinguishes `yes` (enabled) / `disabled` / `no` (absent);
  Candidates > Deactivated is `disabled`.
- Measured 2026-11-02 (3 workers): 10 passed / 4 failed - the 4 reds are the 4 `@known-issue`
  scenarios above; 1 scenario passed on retry after the DEV sign-in stall.

### Edit Email on the Agents INVITE SENT tab - change the address and resend (new flow, 2026-10-20)

`Edit-Email.feature` section 8; probes `scripts/probe-invite-sent-edit-email{,-2,-3}.js`. An agent who
has NOT claimed their invite can now have their email changed (the old "Agent has not yet claimed
their account." refusal is gone - that scenario was replaced).

- Form: same "Update Email Address" fields, primary **Next**, enabled from the start. Next REPLACES
  the form with **"Resend Invitation"** ("You're about to resend the invitation to the updated email
  address: <new>"); with nothing usable typed it offers a plain resend "to: <current>". Nothing is
  written until **Resend Invite**.
- Resend Invite -> `PATCH /agent/<id>/update-email/` -> 200 `{"detail":"Invite re-sent successfully.",
  "reinvite_disabled_until": now+2min}`, toast "Verification email sent to the updated email." The
  row shows the new address AT ONCE (no pending marker - unlike the Active tab's verify-first
  handshake), a new "Join Talentforge" mail with a NEW temporary password goes to it, the old
  temporary password is refused (401), and the row's Edit is disabled during the 2-minute cooldown.
- **Server refusals are toasts and BOTH dialogs close** (nothing inline, typed text lost): existing
  agent/candidate email (any case) "An account with this email already exists.", invalid format
  "Enter a valid email address.", current address in upper case "New email must be different from
  the current email." Asserted as measured, `@needs-clarification` (the Active tab keeps its modal open).
- **One `@known-issue` red left:** Resend Invite also fires `POST /admin/invite/resend/agent/`,
  always refused by the cooldown the change just set (re-confirmed 2026-10-22).
- **Three former reds were FIXED in the build by 2026-10-22** and are regression locks now (tag
  removed): Next is disabled until the address is valid, matching and different; the form stops an
  unusable address inline ("Please enter a valid email address.", "The emails do not match.",
  "New email must be different"); a confirmation differing only in case now counts as matching.
  Because the form now stops an invalid format and the current address in upper case, those two
  rows were removed from the server-refusal table - they can no longer reach the server.
- **2026-10-22 run, three reds, only one of them real:** the Active-tab "awaiting verification"
  scenario hung in its IMAP baseline lookup (imapflow has no connect timeout; both lanes were
  running) until the 180s step budget ran out - it passed alone straight after, and the baseline
  for a freshly generated alias is now bounded (`freshAliasBaseline()` in `steps/edit-email.js`).
- Anything that presses Resend Invite runs on an agent the scenario invites itself
  (`Given I have invited a throwaway agent who has not claimed the invite`, `@mutates-email @provision`,
  one invite mail each; `npm run test:edit-email:e2e`). The read-only scenarios press Next at most.
- `AgentsListingPage.readEmailDialog()` used to report the white "Next" label as an inline error on
  every read; button labels are now excluded and `updateDisabled`/`primaryLabel` cover Next too.
- Measured 2026-10-20: read-only `npm run test:edit-email` 22 scenarios, 20 passed / 2 failed (the two
  form-validation `@known-issue`); the 3 committing scenarios 2 passed / 1 failed (the duplicate request).
  The plain-resend scenario was then replaced by the Next-gating `@known-issue` (verified red on its 7
  unusable rows, green on the valid one), so the read-only steady state is 19 passed / 3 failed.
- **Measured 2026-10-22:** the 6 read-only Invite Sent scenarios 6 passed (the three former
  `@known-issue` included); the awaiting-verification and server-refusal scenarios each passed
  alone. The read-only steady state is therefore expected to be all green (derived, not a full run).

### `@mutates-email` was missing from `configs/playwright.config.js`'s UNRECOVERABLE list

Found and fixed while wiring `@mutates-candidate` in (2026-09-07). It was in `SERIAL_TAGS` and in
cucumber.js's default exclusions but **not** in `UNRECOVERABLE`, so `npm run pw:test` would have
committed four real email changes on what reads like an ordinary run. That is precisely the
failure mode the long note above that list describes - **re-derive it from
`node -e "console.log(require('./cucumber.js').default.tags)"` rather than reasoning about
whether the two still agree**, and run `node scripts/check-profile-selection.js` after any change
to tags or file layout.

## SuperAdmin User Management - edge cases and agent lifecycle (added 2026-10-14)

Three files, all `@agent-management` / `@candidate-management`, so `npm run test:agent` and
`npm run test:candidate` already pick them up and they are IN the default run (read-only).

- **`npm run test:user-management`** (`-p userManagement`) - every read-only Agents + Candidates
  scenario (listing, filters, view, Edit Email read-only, lifecycle dialogs, edges).
- **`npm run test:user-management:edges`** (`-p userManagementEdges`) - just the two new edge files.
- **`npm run test:agent-mutating`** - the 1 `@mutates-agent @provision` round trip (below).
- Steps: **`steps/user-management-edges.js`** (one implementation for BOTH listings, driven by its
  `SURFACES` table). Probe: **`node scripts/probe-superadmin-user-mgmt-edges.js [--only agents|candidates|access]`**
  (read-only; the 500 is a `page.route()` stub).

| file | what it covers |
| --- | --- |
| `Agent-Listing-Edge-Cases.feature` | unusable `?tab=`, failed load (500 + offline), unknown profile id, access by agent/candidate. **Its paging scenarios moved to `Agent-Search-Filters-View.feature` on 2026-10-26** (see "Agents listing pagination" below) |
| `Candidate-Listing-Edge-Cases.feature` | the same for `/candidates` (`?accountTab=`), access, e2e last page -> drawer -> reload |
| `Agent-Deactivate-Reactivate.feature` | **was fully commented out - revived**; plus receiver-picker, dismissal and reopen cases |

### Agents listing pagination (`Agent-Search-Filters-View.feature`, PAGINATION section, 2026-10-26)

All Agents-listing paging lives here now: 20 scenarios (positive / negative / edge / e2e), read-only,
in the default run. Steps are the listing-name-driven ones in `steps/user-management-edges.js`
(`"Agents"` surface) plus the original Next/Previous scenario's steps in `steps/agent.js`. Probe:
`node scripts/probe-agents-pagination-full.js` (read-only).
- Measured: page_size 10; `?page=<n>` in the URL (page 1 writes none) and in the request with the
  tab's status (`ACTIVE,ATTENTION` / `INVITE_SENT` / `ATTENTION` / `DEACTIVATED`); pager
  "Pagination Navigation" = Previous Page | five numbers + first + last | Next Page, one ellipsis
  per gap (`1 2 3 4 5 … 35`, `1 … 3 4 5 … 35`, `1 … 31-35`); numbered controls are
  `<button role="listitem" aria-label="Page N">` with a hidden narrow-screen duplicate (`:visible`).
- Search, an applied filter, clearing the search and a tab switch from a later page all go back to
  page 1 and drop `?page=`; a reload and a deep link keep the page; a result that fits one page has
  NO pager; the pager is keyboard-operable (Enter / Space).
- A page already fetched is re-rendered from cache with NO request (Page 1 after Next, browser Back)
  - read the page off the URL/pager, never off the last request.
- `?page=abc|0|-1` fall back to page 1; **`?page=2.5` and any page past the end render "404 Page not
  found / The page you requested does not exist."** (the request is sent as `page=2.5`).
  `@needs-clarification`: should a fractional page fall back like the others?
- **Paging REPLACES the browser history entry** (history.length does not grow), so browser Back
  after paging does not step back through pages. Asserted as measured, `@needs-clarification`.
- The old "page beyond the last blames the connection" `@known-issue` is FIXED and now opens a page
  100 past the end - one past the end became a real page during a run when the list grew to 36 pages.
- Measured 2026-10-26: 20 passed (17 in the first run; the 2 suite/premise reds fixed and re-run).

### >>> AGENT-DEACTIVATE-REACTIVATE.FEATURE WAS COMMENTED OUT, AND DEACTIVATE HAD MOVED <<<

Every Deactivate scenario timed out at `I open the Deactivate dialog`: Deactivate is no longer an
inline row button ("Deactivate Account") but an item **"Deactivate" in the row's "Open menu"
overflow** (Active tab: View / Edit / Open menu -> "Log in as agent", "Deactivate"). The listing
scenario already recorded the new menu; the page object did not. `AgentsListingPage.clickDeactivateRowAction()`
tries the inline form then the menu, and `openDeactivateDialog()` / `deactivateAgent()` use it.

- **The transfer-picker `@known-issue` now PASSES** - the picker offers the university's other
  agents. Tag removed; it is a regression lock.
- **The gendered transfer prompt is still a real defect** (`@known-issue`): "you must first
  transfer **his** 1 active candidate**s**" - a gendered pronoun and a plural with a count of 1.
- **The `@mutates-agent` round trip now runs on a THROWAWAY agent** (`Given I have provisioned a
  throwaway agent to deactivate`, `provisionAgentWithoutPromo`). It used to reactivate whoever
  was first on the Deactivated tab - somebody's real account. Measured 2026-10-14: 1 passed, 2m22s.
  Cost per run: 1 abandoned agent + its deactivate/reactivate mails on the bytecorp inbox. The
  `@mutates-agent` After hook leaves the throwaway deactivated.

### Expected baseline (MEASURED 2026-10-14, headless, 2 workers)

The three files read-only (`--profile only --tags "not @mutates-agent"` over them): **33 scenarios,
26 passed / 7 failed, 9m 55s** - the 7 reds are exactly the 7 `@known-issue` scenarios (6 in the
edge files + the gendered transfer prompt). A first attempt at 4 workers lost 18 scenarios to the
known "stalled on /login" DEV stall in the superadmin Background - re-run before reading anything
into a wall of login stalls.

### Measured 2026-10-14 (probe + runs)

| | Agents | Candidates |
| --- | --- | --- |
| `?page=abc` / `0` / `-1` | page 1 requested, page 1 current (URL keeps the bad value) | same |
| unknown tab param | Active (`status=ACTIVE&status=ATTENTION`) | All (no `is_active`) |
| last page | remainder rows, "Next Page" disabled | same |
| row order | server order kept (page 1 and a later page) | **re-ordered on a later page** |
| list 500 / offline | "Unable to load **candidates**. Check your connection..." | "No results found ... current search and filters" |
| page past the end (404) | ~~blames the connection~~ FIXED 2026-10-26: "404 Page not found / The page you requested does not exist." | the same "search and filters" no-results copy |
| `/agents/view/<unknown>` | "Profile not found." **plus** the tabs and zeroed charts | (drawer, no route) |
| agent session | `/agents*` -> `/unauthorized` "Access denied" | `/candidates` -> its own In Progress; superadmin list never requested |
| candidate session | "Access denied" | "Access denied" |

**Five `@known-issue` scenarios in the edge files**, each verified to fail for the defect it names:
the Agents failure copy says "candidates"; ~~a page past the end blames the connection~~ (FIXED 2026-10-26, now a regression lock in `Agent-Search-Filters-View.feature`); a failed
candidate load is shown as "no results"; a page past the end claims a search/filter is applied;
the candidate grid re-orders a later page (page 1 matches by coincidence - **one page cannot tell
"keeps the order" from "happens to agree"**).

**The unknown-agent-profile scenario is NOT a defect (re-verified 2026-10-20, now passing).** Every
`/agent/<id>/...` call answers 404 and the page says "Profile not found."; the four tabs render on
EVERY profile by design, and with no data each chart shows its own empty state ("No data to display
for candidate onboarding / revenue impact"). It asserts exactly that, plus no agent identity
(email, Edit Target). The tiles still read 0% / "0 of 0" / 0 SAR / 0 pending - the same as a real
agent with no activity - and that is recorded, not asserted.

### Locator traps measured here

- **>>> THE NUMBERED PAGER CONTROLS ARE `<button role="listitem" aria-label="Page N">`. <<<** The
  explicit role overrides `button`, so `getByRole('button', { name: 'Page 2' })` finds NOTHING.
  A hidden duplicate set exists for narrow screens, so take them `:visible`. Previous/Next are
  aria-labelled "Previous Page" / "Next Page". (Existing listing steps that use `/next/i` still match.)
- A nav-scoped pager locator resolved to nothing on both listings; locate inside `main` instead.

### View profile against the server (`View-Profile.feature`, added 2026-10-14)

The View action on BOTH listings was already covered for STRUCTURE (tabs, URL per tab, Back, the
drawer's five tabs, closing). `View-Profile.feature` (17 scenarios, read-only, in the default run;
`npm run test:user-management:view-profile`) checks every rendered VALUE against the response the
app itself received for the record that was opened. `steps/view-profile.js` keeps a response
recorder from the View click onwards; `scripts/probe-superadmin-view-profile.js` is the read-only probe.

| agent profile request | used for |
| --- | --- |
| `GET /agent/<id>/profile/` | header (name, email, `institution.name`, `status`), `monthly_target`, `user_id` |
| `GET /agent/<id>/target-progress/?duration=` | `current_month` (Monthly), **`last_quarter` (Quarterly)**, `yearly`, `ytd`; the choice is written to the URL as `targetDuration=` |
| `GET /agent/<id>/pending-verifications/` | `total_pending` -> "N Documents Needs Review" |
| `GET /agent/<id>/candidates/?page=1&page_size=10[&search=]` | the Candidates tab (searched SERVER-side, no URL param); `...&is_active=true` page_size=1 gives the listing's Total Candidates |
| `GET /analytics/agents/activity-logs/<user_id>/?duration=` | Activity Log, keyed on the profile's `user_id`; default `last_7_days`; duration written to the URL |

- The profile's Candidates-tab **View opens the same candidate drawer** as the Candidates page
  (no route; URL unchanged); closing it leaves the profile on its Candidates tab.
- Drawer: `GET /candidate/profile/<id>/` is fetched ONCE on first open and reused on reopen.
  Documents are not a collection - each lives on its education / work / certification entry as
  `document`. A reopened drawer starts on Candidate Details. `?tab=bogus` on the profile falls
  back to Performance Overview; every real `?tab=` survives a reload.
- **No `@known-issue` left (2026-10-22).** The last one - a search with no match on the profile's
  Candidates tab showing "No candidates yet" for an agent that has candidates - is FIXED: it now
  reads "No results found / We couldn't find any results matching your current search.", asserted
  verbatim. Found because the new summary report flagged the `@known-issue` scenario as passing.
- **"Quarterly" is NOT a defect - product rule 2026-10-22: it covers the last 4 months, not the
  current one** (`duration=last_quarter`). It was a `@known-issue` until then; the scenario now
  asserts the rule (`@positive`). Measured across every agent on DEV (candidate creation dates
  decoded from the base36 timestamp in each test alias, `scripts/probe-target-progress-window.js`
  plus the session's ad-hoc probes): an onboarding made this month never counts in Quarterly
  (`+refagent`: 11 this month, Quarterly 6 = September's 6), and July-September ones do.
  - **The month COUNT (4 vs 3) is not assertable**: no endpoint exposes a candidate's dates and the
    profile shows no range. The step asserts what is observable - the request is `last_quarter`,
    Quarterly <= Year to Date minus this month (while the window lies inside the calendar year,
    i.e. May onwards), and the render matches the server.
  - `Given I have found an agent who onboarded candidates this month` picks, from the server's own
    figures, an agent whose onboardings THIS month outnumber the year's earlier ones - only then can
    a Quarterly count that wrongly included the current month break the bound. It reads the token
    off the listing's own request (the app keeps it in memory, not a cookie).
- **The period TARGETS are not consistently the monthly target** (measured 2026-10-22): `+refagent`
  renders Quarterly "6 of 30" against a monthly target of 10, while several throwaway agents get 10
  for Quarterly, and `temp.agent2` gets 1 / 1 / 2 / 2 for Monthly / Quarterly / Yearly / YTD. The
  render always equals the server, so nothing fails; how the server derives a period's target is
  unknown - a question for the PO, not asserted.

## SuperAdmin Agents - View from Active / Requires Attention / Deactivated (`Agent-View-Profile.feature`, added 2026-10-22)

The agent profile opened by View from each tab that offers it, checked against the server, plus
everything the superadmin can do there. Steps: `steps/agent-view-profile.js`. Its recorder writes
the same `world._vp` shape `steps/view-profile.js` reads, so that file's server-comparison steps
run unchanged after a profile opened from ANY tab. Probes: `scripts/probe-agent-view-per-tab.js`
(read-only) and `scripts/probe-agent-view-profile-mutations.js` (**mints one throwaway agent**).

- **`npm run test:agent-view`** - 21 read-only scenarios, in the default run (no Save is ever
  clicked; every dialog is cancelled; failures are `page.route()` stubs).
- **`npm run test:agent-view:e2e`** - 2 `@mutates-agent @provision` scenarios, each on its OWN
  throwaway agent (`+agview` alias; committing steps refuse any other address): a target saved,
  then deactivate and reactivate FROM THE PROFILE; and a promo added, edited, disabled and enabled
  from the profile's Promo Tools tab. Leaves 2 abandoned agents per run, no payment.
- Measured: View fires `/agent/<id>/profile|target-progress|onboarding-trends|revenue-impact|pending-verifications|candidates`
  and `/agents/<id>/promotion/` (Promo Tools re-renders that, no request). Menu: ACTIVE/ATTENTION
  -> Log in as agent, Deactivate; DEACTIVATED -> Reactivate. Edit Target `PATCH /agent/<id>/profile/`
  -> "Target updated."; lifecycle `POST /agent/<id>/deactivate|reactivate/`. A period already
  fetched re-renders from cache with no request. Profile tab changes REPLACE history (one Back
  leaves the profile). Keyboard: Tab to the row, ArrowRight x7 to View, Enter.
- **Edit Target validation was FIXED by 2026-10-22** (inline "required / cannot be zero / cannot be
  negative / must be a numeric value / must be a whole number", Save disabled). The old
  `@known-issue` in `Agent-Search-Filters-View.feature` was removed - it is a regression lock now.
- **Four `@known-issue` reds:** 99999999999 is accepted with Save enabled (the server then answers
  HTTP 500); a 500 on the profile request says "Profile not found."; a 500 on target-progress
  renders "0% / 0 of 0"; Revenue Impact says "vs last month" for every period.
- **Recorded for the PO, not failed on:** on the Active tab an ATTENTION agent's row reads "Active"
  while its profile reads "Requires Attention"; a deactivated agent's profile still offers Edit
  Target and Add Promo Code (`@needs-clarification`, asserted as measured); clicking outside Edit
  Target does not close it. Promo server status `Used` is shown as `Inactive`.

### A-to-Z audit (2026-10-22): `Agent-Listing-Values.feature`

`node scripts/probe-agents-page-inventory.js` (read-only) lists every control per tab; each was
mapped to an existing scenario and the gaps filled (steps `steps/agent-listing-values.js`, which
imports the recorder from `agent-view-profile.js`). Read-only, picked up by `test:agent-view`.
- **Covered:** every tab's cell VALUES vs the server; the Deactivated "Transferred Candidates to"
  receiver; filters on Invite Sent / Requires Attention / Deactivated (request carries the tab's
  status + the filter); the sidebar link; the profile Candidates tab's row Edit; the Activity Log
  empty state ("No activity to show").
- **Two `@known-issue` reds:** the "Total Candidates" header help icon has no accessible name
  (a bare `button`); from the Deactivated tab the sidebar "Agents" link rewrites the URL to `/agents` while
  the screen stays on Deactivated (no request) - from another page it works.
- **The icon's tooltip WORKS, and "shows nothing" was the suite's finding (corrected 2026-10-23).**
  "Total number of active candidates currently being managed by this agent." opens as
  `role="tooltip"` on hover and on keyboard focus (Tab -> first row, ArrowUp -> header, ArrowRight
  to the icon). The step hovered as the page's FIRST mouse event, and react-aria opens a tooltip
  only when the pointer ENTERS the control from elsewhere; `.focus()` is not keyboard modality.
  Now a `@positive` scenario of its own; `scripts/probe-agents-total-candidates-help.js` measures it.

### The profile's Candidates tab as a page (`Agent-Profile-Candidates-Tab.feature`, added 2026-10-26)

`/agents/view/<id>?tab=candidates`. Steps `steps/agent-profile-candidates.js`; page object
`pages/AgentProfileCandidatesPage.js` (extends `CandidatesListingPage` - the Edit / Deactivate /
Re-activate dialogs are the same components); probes `scripts/probe-agent-profile-candidates-tab{,-2,-3}.js`
(read-only). `npm run test:agent-profile-candidates` = 13 read-only (in the default run);
`npm run test:agent-profile-candidates:e2e` = 1 `@mutates-email @provision` (signs up one throwaway
candidate under SIGNUP_AGENT_CODE and changes ITS email through the verify handshake).
- **The Edit Email steps are not duplicated**: the tab is a third surface in `steps/edit-email.js`
  (`PROFILE_CANDIDATES`), so the modal contract, invalid table, gating, Cancel/X/Escape and the
  pending/verify chain are the same steps the two listings use.
- Measured: request `GET /agent/<id>/candidates/?page=&page_size=10[&search=]` (+ two page_size=1
  count requests on every profile load); columns [checkbox] Candidate | Account Verification |
  Account Status | Pending Documents | Subscription Status | Last Activity | Actions; row View / Edit /
  Open menu (`admin-agent-profile-candidates-*-button`). Menu: ACTIVE -> Reassign candidate,
  Deactivate; INACTIVE -> Reassign candidate, Reactivate, with Edit DISABLED. Search and page are NOT
  in the URL (a reload returns to page 1, unfiltered). Whitespace-only search sends nothing.
- **The query cache**: a query the app already made is served with NO request, so
  `search()` falls back to the last payload received for that exact query.
- **`last_login` carries a non-breaking space** ("6 days ago"); compare collapsed.
- **The Reactivate dialog now reads "Re-activate Account"** (heading, confirm, "re-activated" in the
  body) while the menu item says "Reactivate". `CandidatesListingPage` matches both spellings.
- **`@known-issue`:** a deactivated candidate's Account Status reads the API's raw "Inactive" here;
  the Candidates listing shows the same record as "Deactivated".
- Measured 2026-10-26: 13 read-only -> 12 passed + the 1 intended `@known-issue` (one scenario lost
  to the DEV superadmin-login stall and passed alone). The e2e has NOT run green yet: the Gmail app
  password was revoked (`AUTHENTICATIONFAILED`), which blocks every email scenario.

### Reassign candidates (`Agent-Reassign-Candidates.feature`, added 2026-10-22)

Written against the PO's requirement (selection, "Select all N" prompt, modal wording, picker,
audit). Steps `steps/agent-reassign.js`; probe `node scripts/probe-reassign-candidates.js`
(read-only). 15 read-only scenarios in the default run + 1 committing journey
(`test:agent-view:e2e`) that moves 2 candidates from an abandoned `+promoexh` throwaway to a fresh
`+agview` one and back, checking the modal wording, the instant list update, the server and the
Audit Log drawer. Committing steps refuse any agent outside those two aliases.
- Measured: selection fires no request; the bar counts the CURRENT page ("10 of 10 selected.");
  the X is aria-labelled "Clear selection"; "Select all 53 candidates assigned to <Agent>" counts
  ALL statuses (the listing's Total Candidates is active only); paging clears the selection
  (`@needs-clarification`). Picker: `GET /agent/?university=<id>&status=ACTIVE&status=ATTENTION&page_size=10[&search=]`;
  the SERVER returns the source agent on a search and the app drops it before rendering. Audit:
  event `ADMIN_CANDIDATES_REASSIGNED`, entity Agent, entity_name = the source, drawer
  "Candidates N" + "Agent A → B", Date & Time in the browser's timezone.
- **Two `@known-issue` reds:** the New Agent dropdown lists only the first 10 of the university's
  active agents (158 for KSU) and loads no more on scroll; a search matching nobody says "There
  are no other agents available for this university".
- "All N" is covered read-only only: committing it needs a throwaway with more than a page.
- Traps: opening the picker can re-fetch its list under the pointer, so options are chosen by name
  and verified on the input; a second browser tab restores its session late, so wait for an OK
  list response there.

### The profile's three-dot menu

Items per state, Log in as agent, and direct Deactivate / Reactivate were already covered. Added
to `Agent-View-Profile.feature`: open and close by Escape and by clicking elsewhere (nothing
sent), and the transfer variant of Deactivate for an agent holding candidates.
The menu IS keyboard-operable (re-verified 2026-10-22, `@known-issue` removed): Enter opens it with
focus on the popover wrapper, one Tab reaches the first item, the arrow keys move and Enter opens the
dialog. The old red was the suite pressing ArrowDown on the wrapper only.

## SuperAdmin Agents - row actions per tab (`Agent-Row-Actions.feature`, added 2026-10-22)

Every tab has its own row actions (measured on every row of page 1): Active = View, Edit,
Open menu > Log in as agent / Deactivate; Invite Sent = Edit, Resend Invite; Requires Attention =
View, Notify; Deactivated = View, Reactivate. `Agent-Search-Filters-View.feature`'s tab table now
checks EVERY row of page 1, not only the first. The feature file's header maps each action to the
file that covers it; this file holds what had no behavioural coverage before.

- **`npm run test:agent-row-actions`** - 8 read-only scenarios (in the default run). One of them
  checks the superadmin's own password for real (the verify token is never used).
- **`npm run test:agent-login-as`** - the 2 `@impersonates-agent` scenarios, excluded from the
  default run: ONE wrong superadmin password per run (failed checks are rate limited), and a real
  impersonation session on a throwaway agent (`@provision`, so `test:provision` also runs it).
- **Log in as agent is three dialogs**, nothing starts until the last: "Verify your identity"
  (password; `POST /impersonation/agents/<id>/verify/` -> 5-minute token, or 401 shown inline as
  "Incorrect password.") -> "Reason for access" (5 reasons; Other needs text, and spaces don't
  count) -> "Before you start" (agent + reason, 30 min / 15 min idle; Back keeps the reason) ->
  `POST .../start/`. The same tab becomes `/dashboard/agent` with a "You're logged in as <name>
  (Agent)" banner, a countdown and End Session (no confirmation) -> "Session Ended" -> Back to Agent
  Profile. Audit Logs record "Logged In As Agent" (reason) and "Logged Out As Agent" (MANUAL +
  session id). Starting again while a session is open RESUMES it (same `session_id`).
  Probe: `scripts/probe-agent-login-as.js` (read-only unless `--wrong` / `--confirm --through`).
- **Recorded, not asserted:** Confirm accepts a password of only spaces; the "Please specify
  reason" field has no length cap; a resend disables Edit AND Resend Invite for 2 minutes with
  nothing on the row saying why. **Asserted as measured, `@needs-clarification`:** an outside click
  does NOT close Resend Invitation, while it closes Send Reminder and Verify your identity.
- Measured 2026-10-22: 8 read-only 8 passed (after one suite fix - the access step's X is
  aria-labelled "Cancel" too); the 2 `@impersonates-agent` 2 passed; the every-row tab table passed.

## SuperAdmin Audit Logs (`features/SuperAdmin_Portal/Audit-Logs.feature`) - re-verified 2026-10-23

9 reds in a full run; 8 were the suite's, now fixed. 1 `@known-issue` red remains.
- **`+` in a query string is a space.** The request log and the export query were read with a bare
  `decodeURIComponent`, so `search=super+admin` never matched `search=super admin` (3 scenarios).
  `decodeQuery()` in `AuditLogsPage.js` handles it.
- **Last Activity's "30+ days" is now "Inactive (30+ days)"** (same rename as the Candidates modal).
- **"Clearing the search shows more rows" compares the SERVER count** (`lastServerCount`): a search
  matching 14 logs fills the 9-row page just like the unfiltered list.
- **Log Details' Event Details section has no "Details" label any more** - it renders its own
  label/value pairs; compared with the row's Event Details cell, colons aside.
- **The keyboard `@known-issue` was a phantom.** Roving-tabindex grid: Tab to the row, ArrowRight
  focuses every row button. Now a `@positive` regression lock that drives the arrow keys.
- **`@known-issue`, product data:** the export holds logs with no Action By (14, impersonation and a
  few admin events, newest 2026-09-01) and no Location despite an IP (162, newest 2026-10-05).
- ~~Not asserted: clicking the row's actor / entity buttons does nothing~~ - asserted since
  2026-11-03 (`@needs-clarification`), see below.

### Coverage pass of 2026-11-03 (section 7 additions + section 7b, 13 scenarios, read-only)

Probe first, then scenarios. Before it the file was 40 scenarios, 39 passed / 1 failed (the export
`@known-issue` above). Added:
- **Grid vs server**, page 1, 2 and last, in the server's order. The grid shows `created_at` in the
  BROWSER's timezone (`DD-MM-YYYY HH:mm:ss`), an empty server value as a dash, and Event Details
  with HUMAN KEY LABELS (`email_sent_to` -> "Email Sent to", `code` -> "Promo Code") and Title-Cased
  values with `->` drawn as an arrow - so only the VALUES are compared, segment by segment.
- **Paging:** page_size 9, `?page=<n>` in URL and request; Previous / numbered / last page (remainder
  rows, Next disabled); a reload keeps the page; a filter from page 3 returns to page 1;
  `abc` / `0` / `-1` fall back to page 1 and the URL is cleaned; a page past the end and `2.5` show
  "404 Page not found" (`@needs-clarification`). A page already seen IS re-requested (no cache
  here). Paging REPLACES the browser history entry (same as Agents) - its scenario was removed on
  request 2026-11-03, so that is recorded, not asserted.
- **URL filter values:** `?entity=bogus` / `?entity=AGENT` are dropped from URL and request.
  **`@known-issue`:** `?last_activity=forever` is not sent and nothing is checked in the modal, yet
  the URL keeps it and the button reads "Filters 1"; Clear All recovers.
- **Failures:** a 500 or a dropped connection reads "Unable to load audit logs. Please try again."
- Row text buttons do nothing; Log Details closes by Escape, outside click and its Close button
  (`admin-audit-logs-details-close-button`); the sidebar link opens page 1; an agent and a candidate
  are refused ("Access denied", no audit request - step in `steps/user-management-edges.js`).
- **The page has test ids now** (`admin-audit-logs-search-input` / `-filters-button` /
  `-export-button` / `-view-button`, `pagination-*`); `AuditLogsPage` tries them first, and
  `install()` keeps the last list payload (`lastPayload`). Its request log stores the query WITH
  the leading `?` - strip it before matching `(^|&)page=`.

## SuperAdmin Analytics - Agents and Candidates (`features/SuperAdmin_Portal/Analytics/`)

Both dashboards are READ-ONLY (filters are GETs; nothing writes), so both are in the default run.
Every value is compared with the response the app received, never a literal. `install()` on each
page object records the widget responses BEFORE the first navigation (PagesFixture).
`Platform-analytics.feature` is still empty.

**Running one file without a profile** (`npx playwright test --config ... <file>`) generates EVERY
feature, so any undefined step anywhere blocks it - use `npm run test:agent-analytics` /
`test:candidate-analytics`, which generate only their profile.

### Agents (`Agent-analytics.feature`, `steps/agent-analytics.js`, `pages/AgentAnalyticsPage.js`)
- **Measured 2026-11-10: 53 scenarios, 35 passed / 18 failed (11m)** - all 18 reds expected to be
  `@known-issue` (count matches; not re-checked scenario by scenario).
- Gap pass 2026-11-10 (`scripts/probe-agent-analytics-gaps{,-2}.js`): keyboard duration choice
  (options are `tabindex=0` divs - Tab moves, arrows do not), popover dismissal, keyboard university
  check/uncheck, malformed `?university=` values (dropped from requests - even the valid id in
  `117,abc`, `@needs-clarification`), unsafe university search, agent names are not links.
- **New `@known-issue`:** Avg. Candidates per Agent is duration-scoped (Monthly 0, YTD 4.5) where the
  AC formula is active candidates / active agents (2171 / 364 = 6.0); unchecking the last university
  leaves `?university=<id>` in the URL; two help icons have no accessible name.
- The access step accepts a REDIRECT as a refusal: a candidate is sent to `/getting-started`, an agent
  to "Access denied". Both e2e journeys clear the university before opening the backlog View All - a
  single university's backlog is often empty and then has no View All.
- **Product decision 2026-11-10:** with no data, Top Revenue Generating Agents keeps ranks #1-#5 with
  `-` for agent and revenue - that IS its empty state (asserted `@positive`, no longer a defect). The
  stray-quotes check is its own `@known-issue`: Document Verification Overview still renders
  `"No data to display for verification activity trend"` in quotation marks.
- **Help icons are icon-only BY DESIGN** (product decision 2026-11-10): the scenario asserts each
  tooltip opens on hover and on keyboard focus. The empty `aria-label` and the `aria-describedby`
  link (set on hover for both; on keyboard focus only for Document Verification Overview) are
  recorded, not failed on.
- **Default duration** (`@known-issue`, AC 2.B "Default Selection: Year to Date"): the first load sends
  NO duration, marks no option, and the server answers with the CURRENT MONTH's figures
  (`scripts/probe-agent-analytics-default-period.js`).
- **Yearly = 13 months on BOTH dashboards** (`@known-issue`): the server's Yearly is a rolling 365-day
  window (e.g. 2025-11-10 -> 2026-11-10), so last year's partial month becomes a 13th bar (November
  twice). The AC's 12 months including the current one start the month after.

### Candidates (`Candidate-analytics.feature`, `steps/candidate-analytics.js`, `pages/CandidateAnalyticsPage.js`)
`npm run test:candidate-analytics`. Probes: `scripts/probe-superadmin-candidate-analytics{,-2,-3,-4,-donut}.js`.
- **Measured 2026-11-10: 40 scenarios, 27 passed / 13 failed (11m 24s); the 13 reds are exactly the
  13 `@known-issue` scenarios.** One flaky = the DEV superadmin-login stall, passed on retry.
- Requests: `GET /analytics/candidates/{overview,by-city,journey,progress,coop-tamheer}/?duration=`
  on load, plus `by-university/?duration=&university=<id>` only once a university is picked (and
  again on every duration change). Duration URL `Monthly|Quarterly|Year-to-Date` -> API
  `current_month|last_quarter|ytd`; **Yearly is the default and writes NO param.** `?duration=forever`
  falls back to Yearly. University options = `GET /institutions/?page=1&page_size=500` (145, all
  rendered); the combobox searches client-side; **the university is not in the URL - a reload clears it**
  (`@needs-clarification`).
- Readers worth knowing: the overview card's class is `.total-agents-card` (sic); city bars are plain
  `aria-hidden` divs (two width-% segments: open-to-relocate, rest), not Recharts; insights start with
  a pointing-hand emoji that may sit on its own line, so they are split on the emoji; **a donut arc's
  bounding-box centre is the hole** - sectors are hovered at a point inside the ring; the Recharts
  legend icons are `.recharts-surface` too, so a sweep uses the LARGEST surface; tooltip counts carry
  thousands separators ("1,080").
- Rules asserted green: Active + Onboarding In Progress = Total (every duration); Completion Rate =
  completed / started x 100; majors sorted by count; every donut/Co-op/Tamheer tooltip = the server's
  figure; the Tamheer tab fires no request and Co-op is restored on reload; comparison lines name their
  period ("vs same period last year" for YTD).
- **`@known-issue` (13):** widget titled "Co-op & Tamheer Progress" (AC "Program"); Quarterly returns
  Jul-Sep (omits Oct and the current month); Yearly returns 13 months; duration does NOT persist across
  the Analytics tabs; university insights are generic ("technical and business backgrounds") instead
  of naming majors; a university with no candidates shows dashes, not the AC message; city insights
  name "Riyadh and Jeddah" where the top two are Riyadh and Abha, and "toward Riyadh" which is nobody's
  top destination; city bars show nothing on hover; funnel stages re-sort by count (Co-op/Tamheer
  before Track Started) - an all-zero stub renders the AC order; trend legend reads "Courses
  Started / Courses Completed / Certifications Earned"; the Learning Activity Trend shows nothing on
  hover (the Co-op chart on the same page does - that is the control); empty chart messages wrapped
  in quotation marks; an HTTP 500 on every widget is shown as zeros and empty states.
- Recorded, not asserted: the funnel's Track Started (30) differs from the progress widget's (34);
  the server returns at most 5 cities, so "5 before scrolling" cannot be observed; two donut majors
  can share a colour (`--color-chart-major-1`); tooltip copy lacks the AC's trailing full stop and
  "Coming soon..." is lower-case (compared loosely).

## Contact Us (`features/Candidate_Portal/Contact-us.feature`)

The Candidate Portal's support-request form: the category/issue dependency, the description cap,
the optional screenshot, and what submitting actually does. Added 2026-09-14; the feature file
existed but was **0 bytes**.

- **`npm run test:contact-us`** (`-p contactUs`) - all 13 scenarios. Needs network; the email
  scenario needs the IMAP inbox. No payments.
- **`npm run test:contact-us:read-only`** (`-p contactUsReadOnly`) - the 10 that submit NOTHING:
  the contract, the issue matrix, the Submit gating, the inline errors, the counter and cap, the
  two screenshot tables (accept and refuse), remove-and-restore, the three dismissal routes, the
  no-route rule. **Run this while iterating on a locator.**
- Those same 10 are **IN the default `npm test` run**. The 3 `@submits-request` ones are not -
  see below.

### >>> ONE BEHAVIOUR, ONE SCENARIO - AND WHY THAT IS NOT JUST TIDINESS <<<

The file was consolidated from 19 scenarios to **11** on 2026-09-14 with no assertion lost, the
same reasoning as `features/Promo_Code/`'s 61 -> 32 and the community module's 49 -> 43. Every
rule with several cases is driven by a TABLE inside one scenario, and the step walks every row,
collects every failure and reports them together.

That is **more** informative than a scenario per case, not less: Cucumber abandons a scenario at
its first failing step, so consecutive `Then` steps only ever show whichever case failed first
and say nothing about whether the rest share a cause. It also costs one browser context and one
login instead of N.

| Was | Now |
| --- | --- |
| 4 scenarios on the Submit gate (each-field-missing, whitespace, complete, one-character) | **1** table, 9 rows, both directions |
| 3 on the category -> issue dependency (matrix, "Other", reset-on-change) | **1**, the matrix table plus the reset |
| 2 upload rejections + 1 accept + 1 boundary | **1** accept/reject table carrying the byte assertion |
| 3 submitting (plain, with-screenshot, end-to-end) | **1** end-to-end - which also halves the permanent tickets a run leaves |

**What was deliberately NOT merged.** The email scenario stays separate because it is
`@known-issue` and a red scenario merged into a green one takes the green assertions down with
it. Remove-and-restore stays out of the accept/reject table because removing is a different
behaviour from judging a file. The no-route rule stays its own scenario because it asserts
something about the page, not the form.
- Steps live in **`steps/contact-us.js`**; the page object is **`pages/ContactUsPage.js`**, wired
  into `features/support/hooks.js` AND `fixtures/PagesFixture.js` (one for each runner - there is
  no auto-discovery in either) and picked up by generation automatically (the `configs/migratedFeatures.js` registry was removed with Cucumber on 2026-10-06).
- Fixture: **`CONTACTUS_EMAIL` / `CONTACTUS_PASSWORD`** in `.env` - a dedicated candidate
  (`iqra.farooq+554@bytecorp.io`, id 11401, agent code `GXHFLT`, Monthly subscription).
- **Four read-only probes** map the surface and none of them submits:
  `scripts/probe-contact-us.js` (the modal contract + the full category -> issue matrix),
  `probe-contact-us-2.js` (dependency reset, the three dismissal routes, draft retention),
  `probe-contact-us-upload.js` (the accept/reject table and the remove control),
  `probe-contact-us-errors.js` (**the one that answers "does this form raise an inline error at
  all?"**) and `probe-contact-us-errors2.js` (**the one that answers WHEN** - a fresh form per
  case, which is what corrected the first one's inherited-state mistake).
  **`scripts/probe-contact-us-submit.js` DOES submit** - it is how the endpoint and the success
  toast were learned, and it raises a real permanent request each time it runs.

### Expected baseline

`npm run test:contact-us` - **MEASURED 2026-09-15: 13 scenarios, 11 passed / 2 failed, 151 steps**
(headless, serial). **One of those two reds was a login-timeout flake that has since been fixed**
(below), so the steady state is **12 passed / 1 failed** - stated as the derivation it is, not as
a measurement. The 11 / 9 / 2 / 8m 31s it supersedes was measured 2026-09-14.

`npm run test:contact-us:read-only` re-run immediately afterwards: **10 scenarios, 9 passed /
1 failed** - the one red being the `@known-issue` inline-error scenario, i.e. the expected
steady state on that cut.

**>>> THE `Given I am logged in as the Contact Us candidate` HAD AN INTERNAL WAIT LONGER THAN ITS
OWN STEP BUDGET, AND THAT IS WHAT THE SECOND RED WAS. <<<** Its `waitForURL` allows 90s while
`features/support/hooks.js`'s `setDefaultTimeout(60000)` capped the step at 60s - so a login that
took longer than a minute could never be waited out: cucumber killed the step first and reported
`function timed out`, which says nothing about the login. It hit 1 of 13 scenarios (the counter
one, which passes in 15s on its own). **An internal wait longer than the step budget is not a slow
test, it is a test that cannot pass** - the third instance of this trap in this file, after the
email step and the table steps. The step now carries `{ timeout: 150000 }`. **Give any new step
here an explicit budget bigger than the waits inside it.**

**There is now exactly ONE expected red, and a green run means that one and nothing else:**

1. `Verify that an empty required field explains itself instead of only disabling Submit` - red on
   its last two table rows only (the whitespace defect below). Its first two rows pass.

The notification-email scenario **was** the second red and is not any more - it was reporting a
product gap that does not exist (see below). It dropped `@known-issue @needs-clarification` on
2026-09-15 and passes 16/16 in 39s.

`npm run test:contact-us:read-only` - **10 scenarios, 9 passed / 1 failed, 4m 09s** (measured
2026-09-15; the one red is the inline-error scenario, the email one being excluded from this cut).

Measured individually 2026-09-15, all green:

| Scenario | Result |
| --- | --- |
| accepts PNG and JPG at every size up to exactly 10 MB | 2 scenarios / 14 steps, 58s, run with the refuse table |
| refuses anything over 10 MB or of an unsupported type | (same run) |
| a request submitted without a screenshot succeeds and confirms itself | 21/21 steps, 22s |
| a candidate can report a problem end to end and start cleanly afterwards | 22/22 steps, 28s |
| submitting a support request notifies the assigned agent by email | 16/16 steps, 39s |

### The success confirmation is its OWN scenario now, and on the no-screenshot path

Added 2026-09-15. It used to be a single step (`a submission confirmation should be displayed`)
buried in the end-to-end scenario, which also attaches a screenshot - so the confirmation was
only ever observed on the everything-filled path, and only in a run nobody performs by default
(`@submits-request` is excluded from `npm test` AND from the read-only cut). It read as missing
coverage because in practice it never executed.

- **The screenshot is OPTIONAL, so a request carrying none is the minimum valid submission** and
  has to succeed on its own. That path had no coverage at all: every submission in the file
  attached a file, so the response's `screenshot: null` branch was measured by the probe and
  never asserted. `the submitted request should have carried no screenshot` asserts it on the
  SERVER's record, the same way its presence is - that is the only thing that distinguishes "no
  file was sent" from "a file was sent and the server dropped it". It also guards the scenario's
  own premise: a non-null value there means a file leaked in from somewhere.
- **The confirmation is now asserted THREE ways**, because the first two alone are satisfied by
  an app that is plainly broken: that one was raised at all; that it reads **exactly**
  `Support request submitted successfully.` (not `includes`, so a toast reworded to something
  vaguer, or a generic "Done", is caught); and that **no error was raised beside it**. A success
  toast AND a failure toast passes every other assertion in the scenario - the 201 is checked
  separately and the wording is matched with `some()`.
- The exact-wording check compares through `normaliseTypography()` after collapsing whitespace,
  and matches ANY ONE of the collected surfaces: notistack nests its wrapper, so one toast is
  legitimately reported as several identical strings.
- The error guard matches on the SHAPE of an error, never a pinned sentence - the failure
  wordings have never been measured here (there is still no failure-path coverage at all), so a
  pinned string could only ever answer "absent".
- Both assertions were added to the with-attachment end-to-end scenario too, so the two differ
  only in the screenshot.

### The screenshot matrix: 4 rows -> 8, and accept is split from refuse

- **Two scenarios, not one eight-row table.** Each half is a rule in its own right and carries a
  different type tag, and the step uploads three 10 MB files apiece - one combined step would
  need a timeout budget big enough to hide a hang. The step itself is shared and unchanged; it
  already judged both outcomes.
- **`OverLimitBy1Byte.png` (10,485,761 bytes) is the row that makes the limit falsifiable.**
  With only `Exact10MB` accepted and an 11 MB file refused, the real cutoff was unproven anywhere
  in the megabyte between them, so a build rejecting at 10.5 MB would have passed. Measured
  2026-09-15: **10,485,760 accepted, 10,485,761 refused** with
  `This file is too large. Maximum size is 10.0 MB.` - the boundary is now pinned from both sides.
- **`screenshot.jpeg` covers the `.jpeg` extension**, which the input's
  `accept=".png,.jpg,.jpeg"` advertises and nothing had ever sent. Those are three separate
  strings in that attribute and a build could honour one and not another. Measured: accepted.
- **Both 10 MB boundary files are exercised now, PNG *and* JPG** (`Exact10MB.png`,
  `Exact10MB.jpg`), plus an 8.4 MB JPG and a 5.2 MB PNG - so every size band is covered on both
  accepted formats rather than on PNG alone.
- The `bytes` column is filled in on every row that has one, and the step asserts it BEFORE the
  app's reaction. A boundary scenario that did not send the boundary proves nothing however green
  the rest of it goes.
- The step's timeout went 180s -> **420s**, sized to the biggest table it drives.
  `features/support/hooks.js` calls `setDefaultTimeout(60000)`, which overrides the profile's own
  `timeout`, so an under-budgeted table step is killed part way and reports "function timed out" -
  which says nothing about the app and hides however many rows had already passed.

### `node scripts/make-contact-us-fixtures.js` builds the two new fixtures

Creates `screenshot.jpeg` and `OverLimitBy1Byte.png` in `images to upload for testing/` and does
nothing else - it uploads nothing and needs no account. Idempotent, and it **verifies its own
output on disk and exits non-zero on a near miss**, which is the exact-10MB PNG lesson: a fixture
off the boundary was reported for a week as an app defect.

- **>>> `utils/imageFixtures.js`'s `pngOfSize()` OVERSHOOTS ITS TARGET BY 8 BYTES, AND THIS
  SCRIPT'S SELF-CHECK IS WHAT FOUND IT. <<<** Its padding arithmetic subtracts the tEXt chunk's
  12-byte overhead but not the chunk's own 8-byte `Comment` keyword, so `pngOfSize(n)` returns
  `n + 8` bytes. **Harmless for every existing caller** - they all ask for an approximate
  whole-megabyte size, and the exact-byte fixtures in `REAL_FILES` are real files guarded by
  `exactBytes` - so it was deliberately NOT changed here; a helper five other suites share is not
  a screenshot matrix's business to fix. But **anything needing an exact byte count must not use
  it.** This script does the splice itself, padding a real photograph (`larger than 5MB.png`)
  exactly the way `scripts/make-exact-10mb-png.js` does, and re-walks the chunk list afterwards so
  a malformed splice fails there rather than in a red scenario.
- `screenshot.jpeg` comes from `jpgOfSize()`, which is right for it: it needs to be a real
  decodable baseline JPEG, and its size does not matter.

>>> EVERY TABLE-DRIVEN STEP NEEDS AN EXPLICIT `{ timeout }`, AND FINDING OUT COST A FULL RUN. <<<
`features/support/hooks.js` calls `setDefaultTimeout(60000)`, and **that overrides every profile's
own `timeout`** - this profile asks for 300000 and gets 60000. A step that walks nine rows,
reopening the modal for each, is many times a normal step's work, so it was killed part-way and
reported `function timed out, ensure the promise resolves within 60000 milliseconds` - which says
nothing about the app and hides however many rows had already passed. All six table steps here now
carry a budget sized to what they actually do (the gating step 300s, the counter 120s, the rest
180s). **Write one on any new table step in this file.**

>>> A `file:line` TARGET GOES STALE THE MOMENT THE FEATURE FILE IS EDITED. <<<
The VS Code Test Explorer caches each scenario's line when it INDEXES a file, so editing that file
- adding a comment, deleting one, reflowing a table - moves every scenario below the edit while
the extension goes on sending the line it cached. Cucumber then matches nothing and reports
`0 scenarios / 0 steps / 3 hooks (3 passed)`, which reads like a broken scenario and is nothing of
the sort - the hooks run because `BeforeAll`/`AfterAll` do not depend on a scenario being selected.
This bit Contact-us.feature twice while it was being edited. `configs/vscode-cucumber-runner.js`
now DETECTS an empty selection from a `file:line` target and prints the lines the file really has,
plus the name-based command that cannot go stale:
`npm run test:only -- --name "<part of the scenario name>"`. Reload the VS Code window to re-index.

>>> A RUN THAT SKIPPED EVERYTHING REPORTED "0 failed", AND THAT IS WORTH KNOWING. <<<
Observed 2026-09-14: `BeforeAll` (the shared `chromium.launch()`) hung, so every scenario and
even every `Before` hook was recorded as **skipped** - a structurally valid JSON that
`generate-report.js` happily rebuilt as `19 scenarios, 0 failed`. The salvage logic in
`configs/readCucumberJson.js` guards a TRUNCATED file, not an all-skipped one, so this shape gets
through. **Check the passed count, never just the failed count**, and treat a run that finishes
far too fast or far too slowly as suspect.

### >>> IT IS A MODAL, NOT A PAGE, AND `/contact-us` IS NOT A ROUTE <<<

Measured 2026-09-14: `/contact-us`, `/contact`, `/support` and `/help` all render an **empty
body**. The form is opened from the sidebar entry, which is a bare `<button>` with **no href** -
while the FAQs entry immediately beside it IS a real `<a href="/faqs">`. So there is nothing to
deep-link, nothing to reload into and no Back destination, and a step asserting a URL after
opening it would be asserting a route the product does not have. Same shape as the SuperAdmin
candidate View drawer.

`Verify that Contact Us is a modal with no route of its own` records this as a rule, so it goes
red the day the product gives the form a route - which is the point.

### The surface, measured

| | |
| --- | --- |
| entry | sidebar -> `Contact Us` (a `<button>`; behind "Open menu" below ~1440px) |
| heading | `Need help? We're here for you.` + a sparkle emoji |
| sub-heading | `Your assigned agent will respond via email within 24–48 hours.` |
| category | `What do you need help with? *` - 6 options |
| issue | `What's the issue? *` - **dependent**, disabled until a category is chosen |
| description | `Describe what happened *`, `textarea[name="describe"]`, **maxlength 500**, counter `n/500` |
| screenshot | optional, `accept=".png,.jpg,.jpeg"`, hint `PNG, JPG (max. 10MB)`, single file |
| footer | `Cancel` / `Submit` (+ a header `X` labelled Close) |
| endpoint | `POST /core/api/v1/candidate/feedback/` (multipart) -> **201** |
| response | `{"category","issue","description","screenshot","status":"OPEN"}` |
| success | toast `Support request submitted successfully.`, and the modal closes |

Category -> issue, with the values the API receives:

| category (value) | issues (values) |
| --- | --- |
| My Track/Progress (`myTrackProgress`) | `cantAccessLesson`, `completedNotUpdating`, `stuckNeedGuidance`, `other` |
| Assessment/Test (`assessmentTest`) | `other`, `unableToStart`, `submissionFailed`, `scoreIncorrect` |
| Documents (`documents`) | `other`, `unableToSubmitUpload`, `needClarification`, `notApproved` |
| Payment/Subscription (`paymentSubscription`) | `other`, `paymentFailed`, `needInvoice`, `wantToCancel` |
| Technical Issue (`technicalIssue`) | `other`, `pageNotLoading`, `errorMessageDisplayed`, `progressNotUpdating`, `loginIssue` |
| Other (`other`) | **none - the field is not rendered at all** |

### >>> EVERY SUBMISSION IS PERMANENT, WHICH IS WHY `@submits-request` IS EXCLUDED <<<

`POST /core/api/v1/candidate/feedback/` is **POST-only** - a GET answers
`405 Method "GET" not allowed` - and there is no control anywhere in the portal that lists or
withdraws a request. So a submitted support request cannot be taken back, exactly like an
invited candidate or a created community.

- `not @submits-request` was added to the default profile's tag expression alongside
  `not @creates-community`, `not @invite-candidate` and the other unrecoverable-resource
  exclusions. **One full run leaves 3 real OPEN support requests** against the fixture
  candidate's assigned agent (plus 1 more if the email scenario reaches its submit).
- **`contactUsFixtureGuard()` is the backstop, and it is POSITIVE and identity-based** - it names
  the one account that may submit (`CONTACTUS_EMAIL`) and refuses everything else **regardless of
  tags, hooks, or which step is calling**. A tag-driven guard is one missing hook away from
  filing tickets as the wrong candidate, which is precisely how `REFERRAL_NOPROMO_AGENT`'s
  zero-candidate state was spent on 2026-08-27. The shared `CANDIDATE_EMAIL` is the login for the
  subscription, promo and document-verification suites and must never be used here.
- The `After` hook **records** what was created and never throws. There is nothing to clean up.

### THREE MEASUREMENTS THAT EACH REPORTED A WORKING FORM AS BROKEN

All three were caught by the first live runs, and each is a class this repo already records
elsewhere.

1. **>>> THE HEADING'S APOSTROPHE IS A STRAIGHT `U+0027` WHILE THE SUB-HEADING'S DASH IS AN EN
   DASH `U+2013`. <<<** The two lines disagree with each other and a source file makes them look
   identical. Written with a curly `U+2019`, the contract check failed against copy that is
   word-for-word correct. Copy assertions now compare through `normaliseTypography()` and record
   the RAW text beside the verdict, so a genuine wording change is still visible.
2. **THE UPLOAD ANIMATES A FAKE PROGRESS BAR FOR ~2s AND FIRES NO REQUEST WHILE IT RUNS**
   (`Exact10MB.png 75% - 1 second remaining` -> `Exact10MB.png 10.0 MB`). A read taken straight
   after `setInputFiles()` catches the card mid-animation and reports an accepted file as
   refused. `waitForUploadSettled()` is the settle. Identical to the agent-portal bulk CSV zone
   and the community crop modal.
3. **THE SCREENSHOT MUST BE ASSERTED ON THE SERVER'S RECORD, NOT ON THE REQUEST BODY.** The first
   version checked `request.postData()` for a `name="screenshot"` part and **failed on a
   submission that had worked** - Playwright does not expose a multipart body containing binary
   as a string, so `postData()` came back empty and the step reported that "the attached file
   never left the browser". The response is unambiguous: `screenshot` is a presigned S3 URL on
   success and `null` when no file was sent. Only the PATH is recorded - the `X-Amz-Signature` is
   a credential.

### Assertions worth keeping exactly as they are

- **The issue SET is asserted, the ORDER only recorded.** "Other" is rendered LAST under
  My Track/Progress and FIRST under all four other categories. No AC settles it, so failing on it
  would make the file permanently red over a question for the PO.
- **Submit gating is checked in BOTH directions in one scenario.** Filling one field at a time
  only ever ends complete, so the CLEARING half is where a form that enables Submit on *any*
  single field would be caught.
- **`submitStaysDisabled()` and `waitForSubmitEnabled()` are not each other's negation.** Submit
  settles asynchronously, so a single read cannot tell a gate that holds from one about to open -
  the distinction `saveStaysDisabled()` exists to make in the promo module.
- **An issue WITHOUT a category is not a reachable state**, and the gating table records that
  honestly rather than clicking a disabled control - which waits out its full timeout and reports
  `element is not enabled`, reading as a broken locator rather than as a form correctly refusing
  an impossible combination. Same lesson as the promo Add-modal's un-clearable expiry field.
- **The description cap is asserted on what the field HOLDS** (600 typed -> 500 held), not on the
  counter: a form that accepted 600 characters and merely displayed `500/500` would pass a
  counter-only check.
- **The 10 MB boundary asserts the BYTE COUNT FIRST.** `Exact10MB.png` is verified to be exactly
  10,485,760 bytes before anything about the app's reaction is checked - a boundary scenario that
  did not send the boundary proves nothing however green it goes. That is the exact-10MB PNG
  lesson, where a fixture that was not at the boundary was reported for a week as an app defect.
- **Both upload rejections assert the REFUSAL first and the WORDING second**, collected and
  thrown once - so a red row reads "it was refused, with different words" rather than the far
  more alarming "it was not refused at all". Both messages are **word-for-word the ones the Agent
  Portal's bulk CSV zone raises** - the same component - so a rewording changes both surfaces.
- **Dismissal watches a WINDOW.** "Not visible" is also true of a modal still animating out, and a
  request already in flight arrives after the click, so `staysClosed()` watches rather than
  sampling. All three routes (Cancel, X, Escape) close it, send nothing and discard the draft.
- **The confirmation toast is POLLED over a 12s window, not sampled once.** It is raised when the
  response lands and auto-dismisses a few seconds later, so a read at a fixed offset can miss it
  in both directions - and "no toast appeared" is a far more alarming report than the truth.

### >>> THE NOTIFICATION EMAIL IS SENT, AND IT GOES TO THE ASSIGNED AGENT - SETTLED 2026-09-15 <<<

This section used to read "UNRESOLVED ... it is not known whether the mail goes to the assigned
agent or is not sent at all", and the scenario was `@known-issue @needs-clarification` on the
strength of it. **Both tags are gone: the feature works, and the suite was looking in the wrong
place.** Measured directly, mail uid 25087:

```
FROM    : "TalentForge" <noreply@talentforge.com.sa>
TO      : iqra.farooq+9999@bytecorp.io        <- the ASSIGNED AGENT
SUBJECT : New Feedback from referaal earn     <- "New Feedback from <candidate name>"
BODY    : Hi Agent added,  /  Candidate Details: Name, Email: iqra.farooq+554@bytecorp.io
          Category: technicalIssue  /  Issue: pageNotLoading  /  Message: ...
          Attachment: less_than_5MB_ZUxnMzO.png  /  Submitted on: September 15, 2026 - 7:25 AM
```

**Why it read as unsent for a fortnight, and the lesson.** `CONTACT_US_NOTIFY_EMAIL` was unset,
so the step fell back to `CONTACTUS_EMAIL` - the CANDIDATE's own address - and
`waitForEmailMatching()` filters IMAP **server-side by recipient**
(`client.search({ to })`). Every `iqra.farooq+*@bytecorp.io` alias lands in one INBOX, so the
mail was sitting there the whole time and was filtered out of every run. The modal's own copy
said where to look ("Your assigned agent will respond via email within 24-48 hours") and was
taken as a hypothesis rather than as the measurement it turned out to be. **A recipient-filtered
search cannot distinguish "no mail was sent" from "I asked the wrong address"** - the same class
as a locator that can only ever answer "absent".

- **`.env` now sets `CONTACT_US_NOTIFY_EMAIL=iqra.farooq+9999@bytecorp.io`.** The fallback to the
  candidate is kept so a fresh checkout still runs, but it can no longer pass for the right
  answer: `the notification should be addressed to the assigned agent rather than the candidate`
  reads the delivered message's own **To header** and fails if the candidate is the recipient. A
  `.env` pointed at the wrong address would otherwise make the search green while the finding
  this scenario exists to hold quietly stopped being tested.
- **`contactUsNotification` is registered in `utils/emailTypes.js` now**, as the subject PREFIX
  `New Feedback from` only. The full subject is dynamic (`New Feedback from <candidate name>`),
  and IMAP subject search is a case-insensitive SUBSTRING match, so the prefix finds the mail for
  any candidate. **Do not pin the observed string.**
- **The scenario asserts the CONTENTS, not just arrival** - the candidate's email address, the
  category and issue *as the server recorded them for this submission*, and the description. An
  agent who receives a mail that only announces a request exists cannot act on it. Asserted
  against `this._contactUsSubmission.json` rather than strings repeated from the Gherkin, so the
  scenario cannot pass by agreeing with itself.
- **Order is delivery -> recipient -> contents.** If the mail never arrived, "it does not name the
  candidate" is noise that sends the reader after a template bug. Same rule as the receipt-PDF
  currency step.
- **The email step carries an explicit `{ timeout: 260000 }`**, because `features/support/hooks.js`
  calls `setDefaultTimeout(60000)`, which overrides every profile's own `timeout` - without it the
  step was killed at 60s while its own mail wait was set to 180s, and reported "function timed
  out", which says nothing about the mailbox.

**NEW FINDING, recorded rather than failed on: the mail renders the RAW API ENUMS.** The agent is
shown `Category: technicalIssue` / `Issue: errorMessageDisplayed` where the candidate chose
"Technical Issue" / "Error message displayed". Same class as the Candidate Details manage list
leaking `co_op`. No AC settles how the notification should render them, so the enum is what is
asserted (it IS the submitted value) and the divergence is attached beside it for the PO.

### >>> A REVOKED GMAIL APP PASSWORD BREAKS EVERY EMAIL SCENARIO IN THE SUITE, AND THE `Given` HID IT <<<

Hit 2026-09-15. IMAP answered `AUTHENTICATIONFAILED - Invalid credentials (Failure)`, 3 times out
of 3, on a `GMAIL_APP_PASSWORD` that was present and correctly shaped (16 characters after the
spaces Google's UI includes are stripped). Google revokes app passwords when the account password
changes or 2FA is reconfigured; nothing in `.env` looks any different afterwards.

- **It is not a Contact Us problem.** Everything that reads the mailbox goes through
  `utils/gmailClient.js` - the agent-email matrix, invite delivery, promo disabled/resumed,
  forgot-password, candidate onboarding end to end. All of them fail together, and a run
  diagnosing one of them in isolation will chase the wrong thing.
- **>>> THE BASELINE `Given` SWALLOWS THE AUTH FAILURE. <<<**
  `latestUidForRecipient(...).catch(() => 0)` cannot tell "this mailbox has no mail yet" from "I
  could not log in", so the run looks healthy for three steps and then dies in the `Then` with a
  raw imapflow `Error: Command failed` - and the carefully worded message about
  `CONTACT_US_NOTIFY_EMAIL` never renders. **Check the mailbox connects before diagnosing any
  email scenario:** a three-line script calling `makeClient().connect()` answers it in seconds.
- Remedy: generate a new app password at `myaccount.google.com/apppasswords` for `GMAIL_USER` and
  replace `GMAIL_APP_PASSWORD`. It can be pasted with its spaces; `makeClient()` strips them.

### Four questions for the PO

Each is attached to the report by the step that measures it rather than failed on - no AC settles
any of them, so asserting a preference would make this file permanently red over a question.

1. **Should the notification email render the human labels rather than the raw API enums?**
   The agent is shown `Category: technicalIssue`, not "Technical Issue" (above). The former
   question here - where the mail goes, and whether one is sent at all - was SETTLED on
   2026-09-15: it is sent, to the assigned agent.
2. **The category dropdown raises no inline error** when opened and dismissed empty, while the
   description does. One required field of three explains itself.
3. **No field carries `aria-invalid`**, so the error is not associated with its control for
   assistive technology.
4. **There is no minimum description length** - a single character passes the gate, so `x` is a
   submittable support request. Asserted as measured, as a row in the gating table.
5. **The issue ordering is inconsistent** - "Other" first under four categories, last under one.
   The set is asserted; the order is only recorded.


## Candidate Details (`features/Candidate_Portal/Candidate-Details.feature`)

The candidate's OWN `Profile > Candidate Details` tab - the profile header, the four-tab strip and
the six sections a candidate maintains about themselves. Added 2026-09-14.

- **`npm run test:candidate-details`** (`-p candidateDetails`) - all 24 scenarios.
- **`npm run test:candidate-details:read-only`** (`-p candidateDetailsReadOnly`) - the 19 that
  write NOTHING: every modal is opened and cancelled. **Run this while iterating on a locator.**
- Those same 19 are **IN the default `npm test` run**. The 5 `@mutates-profile` ones are not.
- Steps live in **`steps/candidate-details.js`**; the page object is
  **`pages/CandidateDetailsPage.js`**, wired into `features/support/hooks.js` AND
  `fixtures/PagesFixture.js` (one per runner - there is no auto-discovery in either) and
  registered in `configs/migratedFeatures.js`.
- Fixture: **`CANDIDATE_DETAILS_EMAIL` / `_PASSWORD`**, defaulting to the Contact Us candidate
  (`iqra.farooq+554@bytecorp.io`, id 11401). Contact Us only READS its fixture, so the two coexist.
- **Two probes.** `scripts/probe-candidate-details.js` is read-only - the page contract, every
  modal, the payload, the accessibility audit, the tab routing; it cancels everything.
  `scripts/probe-candidate-details-mutations.js` **WRITES** - it is what measured the save
  endpoints, the toast, persistence and the delete cascade. Re-run them rather than reasoning
  about the DOM.

### >>> IT IS NOT `CandidateProfilePage`, AND THE TWO MUST NOT BE MERGED <<<

`pages/CandidateProfilePage.js` drives the SAME route, but only as a means to an end: the
document-verification module uses it to get a file onto the account through the three Add forms
and then asserts the verdict over the API. It knows nothing about the page as a page - no
sections, no Basic Information, no Work Preferences, no Desired Roles, no manage lists, no delete.

`CandidateDetailsPage` owns the SCREEN. They are deliberately separate: folding the verification
machinery in would drag `DOC_UPLOAD_MODE`, the AI poller and the fixture resolver into a feature
that has nothing to do with any of them.

### Expected baseline

`npm run test:candidate-details:read-only` - **MEASURED 2026-09-15: 19 scenarios, 13 passed /
6 failed, 151 steps, 0 skipped.** The 6 reds are exactly the 6 `@known-issue` scenarios below and
nothing else. `npm run test:candidate-details` is therefore **24 scenarios, 18 passed / 6 failed**
- DERIVED, since the 5 `@mutates-profile` scenarios were last measured green on 2026-09-14
(5/5, 73 steps, 3m 04s, fixture byte-identical afterwards) and have not been re-run since.

Superseded: 23 / 18 / 5 / 9m 34s and 18 / 13 / 5 / 6m 16s, measured 2026-09-14, before the
`@known-issue` set was re-verified on 2026-09-15 (below).

### >>> RE-VERIFIED 2026-09-15: ALL SIX REDS ARE REAL, BUT THREE OF THE ASSERTIONS WERE NOT
###     ACTUALLY RUNNING <<<

Every one of the five `@known-issue` scenarios was re-run and each reports a genuine product
defect - none was a suite defect. But the run also showed **3 steps SKIPPED out of 37**, and that
is what the re-verification was worth:

- **`Verify that an unrecognised tab value...` had its CONTROL SECOND, so the control had never
  once executed.** The scenario asserted the unknown-value case first, cucumber abandoned there,
  and `When I open the profile with no tab value at all` / `Then the Candidate Details tab should
  be the selected tab` were skipped on every run that had ever happened. That is worse than lost
  coverage: the failure message tells dev *"an empty value falls back to Candidate Details
  correctly, so the fallback exists and simply does not cover an unknown value"* - and the step
  establishing that claim was the skipped one. **A diagnosis resting on a measurement nobody is
  taking is worse than no diagnosis.** The halves are now control-first, the control passes, and
  the claim is verified on every run.
- **The a11y scenario's close-control assertion had never executed either**, for the same reason -
  the per-entry check fails first. It is now its own scenario, and measured for the first time on
  2026-09-15: the modal's X is a bare `<svg>` too. See finding 6.
- **`the Work Experience manage list should render each entry's employment type as a label` could
  PASS HAVING INSPECTED NOTHING.** It loops the account's work-experience entries, so an account
  with none - or rows that stopped matching by company name - left `problems` empty and the step
  reported green. It now fails if there are no entries to compare, and an unmatched row is
  reported as a SUITE locator problem rather than silently counting as a pass. Same rule as
  `non-paid billing rows should have disabled receipt actions`, which used to
  `console.log('nothing to assert')` and pass.

After the fixes: **6 scenarios, 6 failed, 43 steps, 37 passed, 0 skipped** - every assertion in
the set now actually executes. The other three steps were already sound: the two validation table
steps walk a Gherkin table (so they always have rows), use real keystrokes, check both the inline
error and the Save gate, and restore the original value; and the per-entry a11y step already
guarded itself with `expect(audit.total, 'rendered no per-entry controls to audit')
.toBeGreaterThan(0)`, which is the model the enum step was missing.

### The surface, measured

| | |
| --- | --- |
| route | `/profile?selectedTab=candidate-details` |
| tabs | Candidate Details / Documents / Subscription / Activity Log |
| payload | `GET /core/api/v1/candidate/profile/me/` |
| Basic Information save | `PATCH /candidate/profile/basic-info` -> 200 |
| Work Preferences save | `PATCH /candidate/onboarding/preferences/` -> 200 |
| add an entry | `POST /candidate/profile/<collection>/` -> 201 |
| delete an entry | `DELETE /candidate/profile/<collection>/<id>/` -> 204 |
| toast | **"Updated Successfully!"** on all of them |
| delete confirmation | "Are you sure you want to delete this?" / Cancel / Delete |
| reference data | `/institutions/?page_size=200`, `/degree/`, `/field_of_study/?page_size=200`, `/companies/`, `/locations/?page_size=200`, `/roles/?page_size=200` |

Six sections: Basic Information (edit), Education / Work Experience / Certifications (add **and**
edit), Work Preferences & Availability (edit), Desired Roles (edit).

- **>>> THE TABS ARE `role="radio"`, NOT `role="tab"`. <<<** One radiogroup. `getByRole('tab')`
  finds nothing on a strip that plainly renders four tabs.
- **The three list sections' "edit" icon opens a MANAGE LIST, not a form** - every entry with its
  own pencil and trash, plus one real `<button>` "Add other ...". Two different shapes behind one
  icon, so a caller has to know which it wants.

### >>> THE API FIELD NAMES ARE NOT THE UI LABELS, AND ONE PAIR IS ACTIVELY MISLEADING <<<

Asserting a rendered value against the wrong payload field is this repo's most repeated source of
false findings (`is_verified` vs `is_email_verified`; `account_status` "Inactive" vs the grid's
"Deactivated"). The mapping is in the header of `CandidateDetailsPage.js`; the three that bite:

- **the modal's `Bio*` field is `headline` in the payload.** There is no `bio` key at all.
- **`Bio` is rendered in the HEADER, not in the Basic Information section.** That section renders
  Email, Phone Number, Current Status, Nationality and About Me - and no Bio. A persistence step
  asserting it in the section fails against a save that worked perfectly, which is exactly what
  the first run reported.
- **`roles[].name` is UPPERCASE on the wire** (`"CUSTOMER SERVICE REPRESENTATIVE"`) and Title Case
  on screen; `qualification` is `"STUDENT"` and renders `"Student"`.

**Two DIFFERENT placeholders, and they mean different things**: an unset field renders a literal
hyphen `-`, an uncomputed statistic renders an em dash `—` (`stats: null`, and
`/tracks/my_track/stats` answers 404 for a candidate with no track). A reader that conflates them
reports an empty profile field as a missing statistic.

### >>> THE MANAGE-LIST ROW CLASS IS SINGULAR, AND THE PLURAL WRAPPER IS THE TRAP <<<

Each list modal holds `<div class="certification-list-items-container">` wrapping N
`<div class="certification-list-item">` rows, so `[class*="list-item"]` matches **both** and a
1-row list resolves to 2 elements.

**It cost a fixture entry while this was being written.** The first mutating probe read a row index
off one collection and clicked a trash icon from a DIFFERENT one (every error-coloured svg in the
dialog); both resolved index 0, and it **deleted the pre-existing entry instead of the row it had
just created** - then reported a conclusion about a document whose entry was never deleted. Same
class as the community module's `resolveFilterPopover()` bug.

So rows are located by the EXACT singular class, a row's pencil/trash is always located INSIDE that
row, and **`rowFor()` refuses to return anything unless exactly one row matches** - "it took the
first one" is not a failure worth recovering from when the action is delete.

### SIX `@known-issue` SCENARIOS - the findings this module exists to surface

1. **An unrecognised `?selectedTab=` value leaves NO tab selected.** `?selectedTab=not-a-tab`
   renders the profile shell with nothing chosen; an empty value falls back to Candidate Details
   correctly, which is what localises it - the fallback exists and simply does not cover an
   unknown value.
2. **`Bio*` and `About Me*` are marked required but are NOT validated at all.** Cleared and
   blurred, no inline error appears and Save stays ENABLED. First Name and Last Name behave
   correctly (`"First Name is required"`, Save re-gated), which is what makes this a gap rather
   than a missing feature.
3. **Whitespace defeats the required check.** Typing three spaces into First Name or Last Name
   **erases the error already on screen** and re-enables Save, so a profile can be saved with a
   legal first name of `"   "`. **Same defect as the Contact Us description field** - if it is
   fixed centrally, both features go green together.
4. **The manage list leaks the raw API enum.** The Work Experience SECTION renders `Co-op`; the
   manage-list modal for the same entry renders **`co_op`**, underscore and all. One entry, two
   spellings, two clicks apart.
5. **Every per-entry control in a manage list is a bare `<svg>`** - 0 in a `<button>`, 0 with a
   role, 0 with an aria-label, 0 focusable. A keyboard-only or screen-reader candidate cannot edit
   or delete any qualification they have recorded. WCAG 2.1.1 (A) and 4.1.2 (A).
   - **It deliberately does NOT re-assert the SIX section icons**, which are the same defect one
     layer up and are already asserted by the document-verification module. A second permanently
     red row for one defect makes the report harder to read, not more complete.
6. **The manage-list modal's own X close control is a bare `<svg>` too** - no `<button>`, no role,
   no aria-label, no tabindex. **Measured 2026-09-15, the first run in which that assertion had
   ever executed** (it had been skipped behind finding 5 since the file was written). Escape does
   close the modal, so a keyboard user is not trapped - the control itself is simply invisible to
   them, which is why it is recorded as a lesser severity than finding 5 rather than merged into
   it. **Kept as its own scenario on purpose**, and this is NOT the "second red row for one
   defect" the note under finding 5 warns against: those section icons are already asserted by
   another module, whereas nothing else in the suite asserts this control, and a fix to the
   per-entry icons may well not touch the modal chrome.

### >>> VALIDATION MUST BE MEASURED WITH REAL KEYSTROKES <<<

React-Hook-Form validates on **blur**. A programmatic value set plus a dispatched `blur` moves the
Save gate but does **not** run the validator - and the first probe written that way reported First
Name as having no required message at all, **the exact opposite of the truth**. Every validation
step uses a real click, a real `ControlOrMeta+a`, real typing and a real `Tab`. Same class as
`pasteAbout()` inserting nothing in the community module.

### Four divergences RECORDED rather than failed on

No AC settles any of them, so asserting a preference would make the file permanently red over
questions for the PO - the call the receipt-PDF currency step and the community empty states got.

1. **The profile photo input carries NO `accept` attribute**, so the picker offers every file type
   on the machine, while every document upload on the same page declares `.pdf,.jpg,.jpeg,.png`.
2. **The Add forms advertise `.jpg,.jpeg` which the document endpoint refuses**
   (`"Only .pdf, .png files are allowed."`). Either widen the endpoint or narrow the accept list.
3. **The tab says nothing about an attachment's verification status.** An entry whose document is
   sitting in `REVISION` renders as a bare filename link here; the status IS on the Documents tab,
   so this is a question about where it belongs.
4. **The phone field accepts `+1`** as a complete number. It correctly filters letters (typing
   `abcdef` leaves `+`), which is the only half asserted.

### Assertions worth keeping exactly as they are

- **Persistence is checked against the PAYLOAD, never a second DOM read.** The sections re-render
  from a fresh GET, so a DOM read cannot distinguish "the server stored it" from "React still
  holds what I typed".
- **The bearer token is captured off a real request**, not read from localStorage. The app keeps
  it in memory under no guessable key, so a localStorage read returns null, the API read answers
  401, and every field comes back `undefined` - which prints as "the app lost the value" against a
  save that worked. **That mistake cost a live restore**, and `profile()` now throws on any
  non-200 rather than poisoning the assertion above it.
- **The sections do NOT share one save endpoint.** Basic Information PATCHes
  `/candidate/profile/basic-info`, Work Preferences PATCHes `/candidate/onboarding/preferences/`.
  A filter written against `/candidate/profile` alone reports "Save fired no request at all" for a
  Work Preferences save that plainly returned 200.
- **`waitForSaveEnabled()` and `saveStaysDisabled()` are not each other's negation** - Save settles
  asynchronously, so one read cannot tell a gate that holds from one about to open.
- **The confirmation toast is polled over a window AND deduped.** notistack nests its wrapper, so
  one toast reads as three identical strings and an "exactly one confirmation" assertion would
  fail against a single correct toast.
- **`attachDocument()` waits for the upload to settle.** The zone animates a progress bar and
  fires no request while it runs - the file is posted with Save - so a Save clicked mid-animation
  creates the entry with **`document: null`**: no document row and no verification, on an entry
  that looks perfectly fine on screen. `the created entry should carry the document that was
  attached` is the step that catches it.
- **`selectFromCombobox()` types, matches on the EXACT accessible name, and re-resolves per
  attempt.** The control queries per keystroke, so `fill()` renders no options at all; a
  `hasText` substring match on "King Saud University" commits whichever of three options is first
  in the DOM; and a handle resolved a moment ago detaches when the list is replaced. It also
  intersects the label with `input[role="combobox"]` - `getByLabel()` alone resolves to **two**
  elements, the input and the "Show suggestions" button beside it.
- **The teardown verifies its restore against the SERVER** rather than trusting the save's return
  value, and **awaits its attach** - an un-awaited attach from an `After` hook is dropped when the
  world is torn down, which is how the promo module's "could not restore" warning never reached a
  single report. It never throws; a failed restore is attached loudly instead.


## Notes

- ~~`features/add supervisor.feature` is wired to a supervisor step file and the `SupervisorsPage` POM.~~ **STALE — none of those three files is in the repo, and none ever was.** Checked 2026-09-03: no `add supervisor.feature`, no supervisor step file, no `SupervisorsPage`, and `git log --all -- "*supervisor*"` returns nothing, so they are absent from the pre-migration baseline commit too. Nothing is wired to anything here; the entry describes work that was never committed. Left in place, struck through, rather than deleted, so that whoever wrote it can say whether it is still wanted.
- Email-driven scenarios read from a Gmail inbox over IMAP via `utils/gmailClient.js`. The subject lines the app sends are registered in `utils/emailTypes.js`; subject + extractor (OTP / reset link / reactivation link / promo code) live in that single file. Add new subjects there rather than loosening an assertion in a step.
- Email and in-app notification assertions both take a **baseline before the triggering action** — `afterUid` for the inbox, "mark all as read" for the bell. These are long-lived accounts: the bell's first page only holds 10 items and the inbox holds every earlier run's mail, so counting matches cannot tell a new notification from an old one, but "is unread" / "after this UID" can.
- `pages/NotificationsPage.js` derives notification items **structurally** (smallest element whose text is 4–8 lines and carries both a "Review" and a "Mark As Read" line) rather than by class name, so a Tailwind churn cannot break it. It also dismisses the agent dashboard's "Welcome …" modal first — its backdrop swallows the bell click.
- `reports/` is regenerated each run: every run clears the previous one's output first, so the folder describes exactly one run (see "Report freshness"). **It IS in `.gitignore` now** — re-checked 2026-09-17, and the two previous versions of this line were both wrong in turn (one claimed it was ignored when it was not, the next claimed "only `node_modules/` and `test-results/` are"). The file today ignores `reports/`, `test-results/`, `playwright-report/`, `blob-report/`, `.playwright-mcp/`, `.features-gen/`, `node_modules/`, `*.log`, `*.webm`, **`.env` and `.env.*`** (so every fixture credential stays local), and `auth/*.session.json` / `auth/*.mfa.json`, which hold live tokens. **Read `.gitignore` rather than this line** — it has been stale twice.
