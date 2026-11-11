# Two-Factor Authentication — TFF-20 vs the build

Everything here was **measured live on dev.talentforge.com.sa**, 2026-08-24, with
`scripts/probe-2fa.js`, `scripts/probe-2fa-lifecycle.js` and `scripts/probe-2fa-login-prompt.js`.
Nothing is inferred from the code or from the ticket. Re-measure with those three probes rather
than editing the numbers here by hand.

---

## 1. The API contract (this is what makes 2FA testable at all)

| Step | Call | Answer |
| --- | --- | --- |
| Toggle on | `POST /core/api/v1/auth/token/2fa/` | `201` `{"device_id":118,"otpauth_url":"otpauth://totp/<email>?secret=<BASE32>&algorithm=SHA1&digits=6&period=30","manual_key":"<BASE32>","issuer":"TalentForge"}` |
| Confirm enable | `POST /core/api/v1/auth/token/2fa/confirm/` `{"code"}` | `200` `{"detail":"Two factor authentication is now active."}` / `400` `{"detail":"Incorrect OTP."}` |
| Confirm disable | `POST /core/api/v1/auth/token/2fa/disable/` `{"code"}` | `200` `{"detail":"Two factor authentication is turned off."}` / `400` `{"detail":"Incorrect OTP."}` |
| Login | `POST /core/api/v1/auth/token/` | `200` `{"requires_2fa":true,"access":"<token_type: temp_2fa>"}` |
| Answer challenge | `POST /core/api/v1/auth/token/2fa/submit/` `{"code"}` | `200` `{"access":"<real token>"}` / `400` `{"detail":"Invalid or expired code."}` |

**The setup call returns the shared secret in plaintext**, and it is the same string the modal
prints under the QR code for a human to copy into Google Authenticator. So the suite computes the
code the server is expecting (`features/support/totp.js`, validated against all six RFC 6238 SHA-1
test vectors) and submits it exactly as an authenticator would. **Nothing about the verification is
stubbed** — a break in the app's own TOTP implementation still fails the test. Stubbing the confirm
call to a 200 was rejected: it would assert only that the UI reacts to a success it was handed,
which is the half of "enable 2FA" not worth testing.

**A code is single-use.** The same six digits submitted twice inside one 30-second step are
refused as `"Incorrect OTP."` even though they are right for that window. This is not a defect and
it is easy to mistake for one — the first version of `scripts/reset-2fa-agent.js` failed exactly
this way. `TwoFactorAuthPage.freshCode()` records every code it submits and waits out the window.

---

## 2. There are TWO different OTP controls, sharing no selector

| | Setup / disable dialog | Login challenge (`/verify-otp`) |
| --- | --- | --- |
| Control | `input-otp`: **one** transparent `<input maxlength="6" data-input-otp>` stretched over six presentational `<div aria-label="Enter digit N of 6">` | **six real** `<input type="text" maxlength="1" inputmode="numeric">` |
| Digit cells | 6 `<div>`s, rendering `0` as a placeholder for an empty position | none |
| Error state | every cell repaints `ring-gray-300` → **`ring-error-500`** | *(see §3, row 7)* |
| Typing | `keyboard.type()` alone does nothing — the input is not focused | click each box |

A reader written against either one **silently times out on the other**, which is how the first
lifecycle probe died on a page that was rendering perfectly. `TwoFactorAuthPage.otpScope()` detects
the shape instead of assuming it, and `readOtpBoxes()` reports which shape it found so a failure
names the surface it was on.

The error state is read from the **ring class**, because that is the only thing the build changes —
no attribute, no flag. Reading `opacity`/`filter` instead (the mistake this repo has made twice,
see the Community and promo notes in `CLAUDE.md`) could only ever answer "absent".

---

## 3. Where the build and TFF-20 disagree

Every row was measured live. **RE-MEASURED 2026-09-03 over a full `npm run test:2fa`** (27
scenarios, 13m 15s) and the table below is that run's evidence, quoted from the failure messages.

**>>> THE TESTS NOW ASSERT THE BUILD, NOT THE AC. <<<** The product owner confirmed on 2026-09-03
that the portal's current messages, copy and focus behaviour are the intended behaviour for now,
so every scenario here was changed to assert what the app does. Each divergence is recorded in
this table and in a comment at the site in the feature file. Consequences worth keeping:

- **These scenarios are now REGRESSION LOCKS.** A red row means the behaviour CHANGED, not that
  the AC is violated. If dev reworks any of this copy, confirm the intent and update the scenario
  rather than treating the app as broken - the same call the community module's image-validation
  scenario carries.
- **TFF-20 is what needs amending**, on every row marked "amend the AC".
- **The previous version of this section claimed each finding was `@known-issue` in the feature
  file. THAT WAS NEVER TRUE** - `2FA.feature` has never carried a single `@known-issue` tag in any
  commit, so all seven divergences reported as ordinary reds with nothing marking them expected.
  That is exactly the confusion the tag exists to prevent, and it is why they are now asserted as
  the build behaves instead.

| # | AC says | The build does (measured 2026-09-03) | Verdict |
| --- | --- | --- | --- |
| 1 | An **expired** code shows `"This code has expired."` | In the DIALOGS a code that was genuinely valid four 30s windows back is refused as **`"Incorrect OTP"`** inline and **`"Incorrect OTP."`** as a toast, API `400 {"detail":"Incorrect OTP."}`. At LOGIN it is **`"Invalid or expired code."`**, API `400`. Nowhere is "expired" told apart from "wrong". | Accepted as intended. Amend the AC. The scenarios assert the app's wording; both keep a genuinely stale code as the input, so the security property is still covered. |
| 2 | The login prompt is titled **"Enter the 6-Digit Code"** | **"Check your authenticator app"**, body "Open your authenticator app and enter the verification code for your account." The AC's title IS used - on the SETTINGS dialog. | Accepted as intended. Amend the AC. Asserted as written. |
| 3 | The login prompt's submit button is **"Confirm"** | It reads **"Verify"** | Accepted as intended. `loginSubmitButton` accepts either label so the behavioural scenarios do not go red on copy; the divergence is asserted once, in row 2's scenario. |
| 4 | **The first OTP box is auto-focused** | Nothing is. In the dialog focus is on the header **Cancel** button; on `/verify-otp` it is on **BODY**. A user must click before typing on both surfaces. | Accepted as intended. Amend the AC. **Both Gherkin lines and the step definition were removed** - see the note in `steps/2fa.js` where it used to live. `readOtpBoxes().focusedIndex` still reports focus, so reinstating it is a few lines. |
| 5 | Bypassing the prompt **returns the user to the login 2FA prompt** | Navigating straight to `/dashboard` from `/verify-otp` **drops the session** and lands on **`/login`** | **Not a defect - the build is STRICTER than the AC.** The half-authenticated state cannot be resumed at all. Asserted as `the user should be sent back to the login page`, with the "application not reached" guarantee kept as its own step so a change to the destination cannot take it down. |
| 6 | The enable OTP step has **6 single-digit input boxes** | Six boxes are rendered, but as presentational divs behind one input (see section 2) | **Not a defect.** The user-visible contract holds; the suite asserts six boxes shape-agnostically. |
| 7 | A rejected code at login turns **the boxes red** | **It does not.** The six real `<input maxlength="1">` boxes keep their normal border, where the DIALOG's presentational cells correctly repaint `ring-gray-300` -> `ring-error-500`. The app is inconsistent with itself. | Accepted as intended. The `boxes should turn red` step was removed from both login scenarios; the MESSAGE is still asserted there, because it is the only feedback that surface gives - if it stopped rendering the user would see nothing happen at all, and that must fail. |
| 8 | A failed update shows **"Unable to update 2FA. Please try again."** | With the confirm/disable endpoints forced to `500 {"detail":"Internal server error"}` the app renders **"Internal server error"** as a toast AND **"Incorrect OTP"** inline on the boxes. So an outage IS reported, quoting the server, but it is also misattributed to the user's input. | Accepted as intended. Amend the AC. The scenario asserts the server detail reaching the user. **Worth a product conversation on its own**: telling someone their code is wrong when the server is down makes them retype a correct code indefinitely. |

Rows 7 and 8 are new in this measurement - row 7 was previously blank ("measured during the run")
and row 8 had never been measured at all.

**The success wording matches** on both paths, modulo a trailing full stop the AC has and the
screen does not (`"Two factor authentication is now active"` / `"...is turned off"`; the API bodies
carry the period). `messageMatcher()` treats the trailing period as optional, so the assertion is
about the sentence rather than punctuation the AC and the build simply disagree on.

**The disable confirmation matches in substance:** heading "Turn off two factor authentication?",
body "Are you sure you want to turn off two factor authentication? This action reduces your account
security and requires verification using an authenticator code.", buttons **Cancel** / **Turn off 2FA**.

---

## 4. The fixture, and why it is its own agent

### >>> THE .env FIXTURE EMAIL WAS WRONG, AND IT MADE THE WHOLE FEATURE LOOK BROKEN (2026-09-03) <<<

`npm run test:2fa` failed **every one of its 27 scenarios at the Background**, each one timing out
waiting for the Security tab on a page that was sitting at `/login`. That reads as an app defect or
a broken locator. It was neither: `.env` recorded

    TWOFA_AGENT_EMAIL=iqra.farooq+twofamt6xkffd1@bytecorp.io

and **that address does not exist**. `POST /core/api/v1/auth/token/` answers
`401 {"detail":"Invalid Credentials"}` for it. The agent itself was alive the whole time - **id
1088, status ACTIVE, `iqra.farooq+90@bytecorp.io`**, name `Twofa Qamtgxkffdb` matching
`TWOFA_AGENT_NAME` exactly - and the recorded password works against it. Correcting the one line
took the run to 20 passed / 7 failed.

Three things worth keeping from that:

- **Check the fixture before re-measuring the product.** One `POST /auth/token/` with the `.env`
  values distinguishes "the app is broken" from "the account is not there" in about a second, and
  it is the first thing to do when a whole feature goes red at its Background.
- **Do NOT re-provision on a login failure without checking first.** `npm run test:2fa:provision`
  would have minted a replacement agent and abandoned a perfectly good one - an agent cannot be
  deleted, so that cost is permanent. The account was found by searching the superadmin agents
  list for `TWOFA_AGENT_NAME`, which is why that value is worth keeping in `.env`.
- **`PROMO_FIXED_AGENT` fails the same check** (`401 Invalid Credentials`, verified in the same
  sweep). That is a pre-existing problem for the promo module, not one this work introduced, and
  it is untouched here - but it will surface as unexplained promo reds.

### Expected baseline (measured 2026-09-03)

`npm run test:2fa` - **27 scenarios, 27 passed, 0 failed, 12m 13s** (confirmed 2026-09-03;
`reports/run-summary.json` recorded `failedScenarios: 0`). After the section 3 changes every
scenario asserts the build, so **a green run is genuinely all-green**; there is no expected-red set
in this feature any more. The run it replaced was 20 passed / 7 failed, and those 7 were the
section 3 divergences.

**A STRAY FAILURE SCREENSHOT IN `reports/screenshots/` DOES NOT MEAN THIS RUN FAILED.** The
confirmed 27/27 run left one behind (`OTP_entry_field_behavior_on_the_enable_flow.png`) while its
own report recorded that scenario passing every step. `features/support/hooks.js` writes a
screenshot ONLY on `Status.FAILED`, so it came from a SECOND runner sharing `reports/` - a
VS Code Playwright test-server had been alive since before the run started. Two runners sharing
that folder is the hazard `CLAUDE.md` already documents for the report JSON ("TWO OVERLAPPING RUNS
CORRUPT IT"); it corrupts the evidence folders the same way. **Trust `run-summary.json` and the
report JSON over the presence of a PNG**, and if an IDE-launched run ever selects `@2fa` it will
fight the single shared `TWOFA_AGENT` account and produce reds that look nothing like their cause.

**One flake was observed and fixed.** `Given a user with 2FA enabled` reported
`enabling 2FA failed: 400 Incorrect OTP.` in the full run and passed first time when the same
scenario was re-run alone. Cause: `TwoFactorAuthPage.freshCode()` handed out a code with as little
as **3 seconds** left in its 30s window, and that scenario also signs in from cold between
computing the code and submitting it - so the window ticked over and the server correctly refused
a code that had been valid when it was computed. `MIN_WINDOW_REMAINING` is now **8 seconds**. A red
row of that shape is a test race, not the app rejecting valid codes - check it in isolation before
filing anything.


`TWOFA_AGENT_*` in `.env` is a dedicated agent that **nothing else in the suite logs in as**.

Enabling 2FA changes how the account *logs in*. Every other agent-side feature (Dashboard,
Active-candidate, Verification, Change-Password, Referral-Codes, Invite-agent's accept walk) signs
in with a plain email+password POST and has no idea what to do with a 6-digit challenge. A 2FA run
that dies between "toggle on" and "toggle off" would leave a shared account demanding a code, and
the whole suite would go red at its Background for a reason that looks nothing like the cause.

- Provision once: **`npm run test:2fa:provision`** (one live superadmin invite + one IMAP round
  trip; **no payment**). Refuses to overwrite an existing fixture without `--force`.
- Recover a wedged one: **`npm run test:2fa:reset -- <secret>`**. The secret is persisted to
  `.env` as `TWOFA_AGENT_SECRET` the moment it is minted — not for the suite to read back, but
  because without it an account with 2FA left on is unreachable by any means the repo owns.
- The run's own `AfterAll` turns 2FA off on **its own browser** (`hooks.js` closes the shared one
  in an `AfterAll` registered first, so that one runs first). It never throws: a cleanup error
  would be reported instead of the run's own result, so it prints the recovery command instead.

`AGENT_CHANGEPASSWORD_EMAIL` (`iqra.farooq+5@bytecorp.io`) was the account `.env` earmarked for
2FA. **It no longer logs in** with either password `change-password.steps.js` knows
(`AGENT_CHANGEPASSWORD_OLD_PASSWORD` or `_TEMP_PASSWORD`) — verified 2026-08-24. That is a
pre-existing problem for `Change-Password.feature`, not one this work introduced, and it is
untouched here.

> **DIAGNOSED AND FIXED 2026-09-07 — the cause is now known, and it is worth reading before
> trusting any "the fixture no longer logs in" note anywhere in this repo.** It was not the
> account rotting: `utils/envWriter.js` had been writing every persisted value to
> `C:\Users\Byte\Documents\.env` (one level ABOVE the project) since the top-level restructure,
> so a rotated password was never recorded where dotenv reads it — and the self-healing login's
> try-every-known-password loop then tripped the per-account sign-in rate limit, after which even
> a correct password is refused. **`TWOFA_AGENT_SECRET` was one of the orphaned values**, i.e. the
> one thing §4 above says is persisted *because* a wedged 2FA account is otherwise unrecoverable
> was not in the project `.env` at all. It has been migrated back. Full write-up, and the
> `npm run test:change-password:recover` repair, are in `CLAUDE.md` under "Change Password".
> Note the address has since changed (`.env` now names `iqra.farooq+agmailmsq7lh9o1@bytecorp.io`),
> which is itself the cost of re-provisioning rather than repairing — an agent cannot be deleted.

---

## 5. Why the profile must stay serial

`npm run test:2fa` (`-p twofa`) runs serially, and **not** for the inbox reason that forces
`provision` and `promoAll` to. Every scenario drives the same account's 2FA state, and that state
is **server-side and global to the account**. Two workers would have one scenario enabling 2FA
while another asserts the toggle is off, and both would be right about what they saw. Do not add
`--parallel`.

It writes `reports/twofa-report.json`, not the shared `reports/cucumber-report.json`: it runs 27
scenarios out of the suite, and pointed at the shared path it would overwrite the whole-suite
report with a partial one that reads like a full run.
