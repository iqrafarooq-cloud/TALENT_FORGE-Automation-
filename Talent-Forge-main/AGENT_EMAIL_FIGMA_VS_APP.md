# Agent email notifications: Figma vs the app

Source of truth for the design: Figma "Email Templates, In-app Notifications & Activity Logs"
> **Agent** > **Email Templates** (node `16044:74781`), 15 frames.

Source of truth for the app: the live DEV build and the `iqra.farooq@bytecorp.io` inbox, swept
**2026-08-12** (3,459 messages over 90 days, 43 distinct TalentForge subjects).

Everything below was **measured**, not inferred. Re-measure with the probes named per section
rather than reasoning from this file - it records what was true on 2026-08-12.

---

## 0. The two traps that make this area easy to get wrong

**The Figma frame titles are not subject lines.** They read like them and they are not. The frame
`Agent - Your Promo Code Has Been Disabled` is sent as `Your Talentforge promo code has been
disabled`. Registering a frame title in `emailTypes.js` makes `waitForEmail` time out on a mail
that arrived perfectly well. Every subject in the registry was copied from a real message.

**IMAP subject search is case-insensitive and substring-based.** Searching
`"...has been deactivated"` returns all 90 messages, *including* the 27 the app sent as
`"...Has Been Deactivated"`. So the registry strings are **search keys**, and the exact subject
must be asserted against `parsed.subject` separately - which `agentEmailEvidence.js`
`expectSubject()` does. Without that split, the casing defect (#4 below) is invisible and every scenario looks
clean.

---

## 1. Template-by-template mapping

| # | Figma frame | Subject the app sends | Trigger | Coverage |
| --- | --- | --- | --- | --- |
| 1 | When Super Admin invites Agent - First Time | `Join Talentforge` | SA invite | `Invite-agent.feature` "the full invite lifecycle ..." |
| 2 | ...updates the Agent's Email Address - Your Email Address Has Been Updated | **never sent** (historical only) | SA Edit > Update, committed | `Agent-Email-Notifications.feature` §1 (`@known-issue`) |
| 3 | ...updates the Agent's Email Address - Verify Your New Email Address | `Verify your new Talentforge email address` | same commit | `Agent-Email-Notifications.feature` §1 |
| 4 | Agent - Your Promo Code Has Expired | `Your Talentforge promo code has expired` | promo expiry | `Promo-Code-Lifecycle.feature` §6 |
| 5 | Agent - Your Promo Code Has Been Disabled | `Your Talentforge promo code has been disabled` | Promo Tools toggle | `Promo-Code-Lifecycle.feature` §4 |
| 6 | Agent - Your Promo Code Has Been Resumed | `Your Talentforge promo code has been resumed` | Promo Tools toggle | `Promo-Code-Lifecycle.feature` §4 |
| 7 | Agent - Verification Delay Reminder | **never sent** | none exists | §4 (`@known-issue`) |
| 8 | Agent - Your Account Has Been Deactivated | `Your Talentforge account has been deactivated` (lower case) | SA Deactivate, committed | `Agent-Email-Notifications.feature` §2 |
| 9 | Agent - Monthly target delay reminder | `Subject: Monthly target delay reminder` from the button; `Reminder: Monthly target progress` from cron | Notify > Send Reminder | `Agent-Email-Notifications.feature` §3 (`@known-issue`) |
| 10 | Agent - Candidates Have Been Transferred to Your Account | **never sent** | blocked (see #8 below) | §5 (`@known-issue`) |
| 11 | Agent - Activity reminder | `Reminder: Log back into Talentforge` | **cron**, 18:00:01 | recognised only, nothing provokes it |
| 12 | Agent - Your Account Has Been Reactivated | `Your Talentforge account has been reactivated` (lower case) | SA Reactivate, committed | `Agent-Email-Notifications.feature` §2 |
| 13 | Agent - Document Review Activity Reminder | **never sent** | none exists | §4 (`@known-issue`) |
| 14 | Agent - Your Candidate Account Has Been Deactivated | **never sent** | unverified | `@not-automatable` |
| 15 | Agent - Your Candidate Account Has Been Reactivated | **never sent** | unverified | `@not-automatable` |

**9 of 15 templates are live. 5 have never been sent. 1 (#11) is sent but only by a scheduler.**

---

## 2. Defects, most consequential first

### 1. `emailTypes.js` was stale about the promo-expiry mail - now corrected

`emailTypes.js` stated that no promo-expiry mail exists ("a 6-hour inbox sweep for the agent found
only the disabled/resumed pair", 2026-07-30) and the scenario asserting it is tagged
`@known-issue` for that reason.

**Ten such messages exist**, newest **2026-08-07**, under exactly the subject the file had only
guessed at. So the guess was right and the tag's justification is gone. **Re-run
`Promo-Code-Lifecycle.feature` §6 before assuming it must fail.** The note in `emailTypes.js` has
been rewritten; the `@known-issue` tag on that scenario has **not** been touched, because removing
it belongs with a measured re-run of that feature.

### 2. The "your email address was changed" notice is NEVER SENT

Figma's "Your Email Address Has Been Updated" template says the agent is told their address
changed. Committing a real email change against a throwaway agent on 2026-08-12 produced **no such
mail at all**:

- a 180s wait on the old address (`iqra.farooq+agmailmsq7lhso1@bytecorp.io`) found nothing;
- a follow-up sweep for that subject across the **whole inbox over the next six hours** returned
  **0 messages to any recipient**;
- the only mail the trigger produced was the verification link to the **new** address (uid 20307).

So an agent's login address can be changed and **the agent is never notified**. The seven
historical messages under this subject were all sent on or before 2026-08-06, so this looks like a
**regression**, not an unbuilt feature. Asserted by `Agent-Email-Notifications.feature` §1, tagged
`@known-issue`.

### 3. The monthly-target reminder exists as TWO templates, and the button sends the broken one

Both captured in a single run on 2026-08-12 against one flagged agent:

| Sent by | uid | Subject |
| --- | --- | --- |
| the scheduler | 20306 | `Reminder: Monthly target progress` |
| **Notify > Send Reminder** | 20311 | **`Subject: Monthly target delay reminder`** |

Same reminder, same body, two templates - and the on-demand one has the header label **baked into
its subject value**, so the agent's client renders `Subject: Subject: Monthly target delay
reminder`.

This corrects an earlier reading of the inbox sweep. The `Subject:`-prefixed variant looked
historical (last seen 2026-07-21) and therefore already fixed; it is not. It is what the button
sends today, and only the *automatic* path was ever reworded.

Three more subjects carry the same prefix defect - `Subject: Document Revision Pending`,
`Subject: Subscription payment reminder`, `Subject: Quick nudge to continue your Talent Forge
track`. Those are candidate-facing, so they are recorded here rather than asserted by the agent
suite, but **the same template bug evidently spans both portals.**

Asserted by `Agent-Email-Notifications.feature` §3, whose subject-hygiene step is placed **last**
so this cannot cost the delivery and body assertions above it.

### 4. The deactivate/reactivate subjects ship in two casings, and the agent path is lower case

| Subject as sent | Count | Newest |
| --- | --- | --- |
| `Your Talentforge account has been deactivated` | 59 | 2026-08-05 |
| `Your Talentforge account Has Been Deactivated` | 27 | 2026-08-05 |
| `Your Talentforge account has been reactivated` | 14 | 2026-08-05 |
| `Your Talentforge account Has Been Reactivated` | 27 | 2026-08-05 |

Both casings of each were sent on the same day, so this is **two code paths disagreeing**, not a
rewording. Committing a real deactivation and re-activation against a throwaway settled which
belongs to the agent: **uid 20308 `...has been deactivated`** and **uid 20310 `...has been
reactivated`**, both **lower case**. The Title Case variants therefore belong to another path,
almost certainly the candidate-facing one, whose body differs (`your Talent Forge **agent**
account...` vs the candidate wording) while the subject does not.

`Agent-Email-Notifications.feature` §2 asserts lower case, measured rather than chosen.

**Two things to raise:** which casing is intended, and - more importantly - that **two roles share
one subject line**, so a superadmin scanning the inbox cannot tell whether an agent's account or a
candidate's was deactivated without opening the mail.

### 4b. A brand-new agent is immediately nagged about monthly targets

Measured three times in one run, on three separate throwaways:

| Agent created | `Join Talentforge` | `Reminder: Monthly target progress` | Gap |
| --- | --- | --- | --- |
| `+agmailmsq7lh9o1` | 14:53:45 (uid 20303) | 14:54:05 (uid 20305) | 20s |
| `+agmailmsq7lhso1` | 14:53:47 (uid 20304) | 14:54:04 (uid 20306) | 17s |
| `+agmailmsq7t9mb2` | 14:59:49 (uid 20312) | 15:00:06 (uid 20313) | 17s |

An agent that has existed for seventeen seconds is being told to "stay on track with your monthly
targets". A fourth instance (uid 20309) fired seconds after that agent was **deactivated**, which
is worse - a deactivated account is told to catch up on its targets.

Not currently asserted by any scenario. It is a side effect the agent-email run surfaced rather
than something it was built to test, and it needs a product decision (when *should* this fire?)
before a scenario can pin it. **Raise with the PO.**

### 5. The verify-new-email mail greets `"Hi ,"` with the name missing

Measured on a real message (uid 19703, 2026-08-06):

```
Hi ,

Your email address has been updated for your Talent Forge account. Please verify
your new email address to complete the update.
```

The name interpolation is empty. Note the sibling change-notice mail on the same trigger greets
`Hi Iqra,` correctly, so only the verification template is affected.

This is why `expectGreetsRecipient()` asserts the greeting **names the agent** rather than merely
existing - a `body.includes(...)` check on any other sentence in that mail passes straight over it.

### 6. `Confirm your new Talentforge email address` carries the wrong template

That subject looks like a sibling of #3 and is not. Measured (uid 16953): its body is the
**candidate signup verification** copy - "We're excited to have you onboard. To complete your
signup process..." - so a subject about changing an email address delivers a signup mail.

Do not register it in `emailTypes.js`; it would match the wrong message.

### 7. "Select Reminder Type" offers nothing to select, and 2 of 4 reminder templates are unreachable

Measured across **eight** agents on Requires Attention
(`scripts/probe-agent-notify-reminder-types.js`): the Send Reminder dialog renders the label
**"Select Reminder Type"** above the single fixed value **"Monthly Target Delay Reminder"**, with
**no `<select>`, no radio group and no combobox** anywhere in it. 8 of 8, identical, so the type
does **not** follow the agent's flag reason either.

Two independent findings:

- **A label inviting a choice with nothing to choose from** is a defect on its own.
- **Figma defines four agent reminders.** Monthly target delay is sendable. Activity is sent by
  cron (#11). **Verification Delay** and **Document Review Activity** have no trigger anywhere -
  no message in 90 days carries their copy and no control offers them.

Asserted by `Agent-Email-Notifications.feature` §4, which needs no email and no provisioning - the
whole finding is in the DOM.

### 8. The candidates-transferred mail is unreachable behind an already-logged defect

`Agent - Candidates Have Been Transferred to Your Account` has never been sent, and cannot
currently be provoked: its only trigger is **Transfer & Deactivate**, which is blocked because the
receiving-agent picker renders "No agents available" for a university that demonstrably holds
others, leaving the confirm button permanently disabled.

That picker defect is already asserted in `Agent.feature` ("Verify that the transfer picker offers
the other agents of the same university", `@known-issue`). §5 of the new file deliberately **does
not** re-assert it - it asserts the email, and its failure message names the picker as the blocker
with the cross-reference, so a reader is sent to the right defect instead of a second
apparently-separate one.

### 9. Body copy: the app says "Talentforge", Figma says "Talent Forge" - and the app is inconsistent with itself

Not failed on, per the decision recorded below. A single message routinely contains **both**
spellings: the header renders `Talentforge` or `TalentForge` while the sign-off reads
`The Talent Forge Team.` Also observed:

- `support@talentforge.com` in Figma; live mails mostly say "feel free to reach out" with **no
  address at all**.
- Figma's deactivation body ends with **"Best regards, The Talent Forge Team."** twice in the frame
  text; the live mail sends it once (so the duplication is a Figma artefact, not an app bug).

**Ask the PO for one canonical product spelling** and then this becomes assertable.

---

## 3. Decisions recorded so they are not re-litigated

**Figma copy divergence is collected, not failed on.** `agentEmailEvidence.js` sorts every finding
into `delivery` / `identity` / `content` / `figmaCopy`, and only the first three are fatal. The
reason: `Talentforge` vs `Talent Forge` appears in **every** mail the app sends, so failing on it
would make every scenario permanently red on a branding disagreement and bury the findings that
matter. The divergences are attached to the report instead.

**Assertion order inside a scenario is load-bearing.** Delivery, then subject, then wording. If the
mail never arrived, "the greeting is wrong" is noise that sends the reader after a copy bug. Same
reasoning as the receipt-PDF currency step in `CLAUDE.md`.

**The never-sent templates are matched on BODY text, not a guessed subject.** A guessed subject can
only ever answer "nothing arrived", which cannot distinguish *"the app does not send this mail"*
from *"the app sends it under a subject nobody predicted"* - completely different findings.
`waitForEmailMatching()` reports whichever subject the message actually lands under, so the day one
is implemented the scenario turns green **and** tells us the subject to register.

**Templates #14/#15 are `@not-automatable`, not `@known-issue`.** The other unreachable templates
can each be asserted against something real (a dialog offering no type, a picker offering no
agent). These cannot, because **the trigger itself is unverified** - deactivating an individual
candidate from the superadmin portal is a flow no feature file drives and no Page Object covers. A
scenario against an unconfirmed UI would report "the email is missing" when the real answer might
be "the suite never performed the trigger". **To promote them:** confirm with the PO whether a
superadmin can deactivate a single candidate and where, then drive it against a candidate of a
*throwaway* agent - never a promo fixture's candidate.

---

## 4. Probes

| Script | What it answers | Cost |
| --- | --- | --- |
| `probe-imap.js` | is the inbox reachable, and what arrived last | free |
| `probe-talentforge-subjects.js` | every distinct subject the app has sent in 90 days, with counts, dates and recipients | free, ~2 min |
| `probe-agent-email-bodies.js [n]` | the real body behind each ambiguous subject, and the subject **as sent** | free |
| `probe-agent-email-by-body.js` | which subject carries a given body phrase - the only way to map a template whose subject is unknown | free |
| `probe-agent-notify-reminder-types.js [n]` | what the Send Reminder dialog offers, per flagged agent, and whether the type varies | read-only, opens and cancels; sends nothing |

All five are read-only. None sends an email or changes any state.
