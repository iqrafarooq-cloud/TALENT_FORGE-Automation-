# when superadmin invited agent - first time
# when superadmin updated agent email address -your email address has been updated
# when superadmin updates the agent's email address- verify your new email address
# agent- your promo code has expired
# agent-your promo code has been disabled
# agent-your promo code has been resumed
# agent- your promo code has been deactivated
# agent- candidated have been transferred to your account
# agent - your account has been reactivated
# agent- verification delay reminder
# agent- monthly target delay reminder
# agent-activity reminder
# agent- document review activity reminder
# agent- your candidate account has been deactivated
# agent- your candidate account has been reactivated


















@agent-email
Feature: Agent email notifications
  Every email TalentForge sends to an AGENT, driven end to end: commit the action in the
  superadmin portal, then read the mail it produced out of the live IMAP inbox.

  Figma: "Email Templates, In-app Notifications & Activity Logs" > Agent > Email Templates
  (node 16044:74781). That board holds FIFTEEN agent templates. This file does not hold
  fifteen scenarios, and the gap is the point - it is recorded here rather than left for
  the next person to rediscover.

  ---------------------------------------------------------------------------------------
  THE FRAME TITLES ON THAT BOARD ARE NOT SUBJECT LINES. They read like them and they are
  not: the frame "Agent - Your Promo Code Has Been Disabled" is sent as "Your Talentforge
  promo code has been disabled". Every subject this file asserts was copied from a real
  message during an inbox sweep on 2026-08-12, never from Figma. Registering a frame title
  would make waitForEmail time out on a mail that arrived perfectly well.

  AND THE SEARCH THAT FINDS A MAIL CANNOT VERIFY ITS SUBJECT. IMAP subject search is
  case-insensitive and substring-based - measured the same day, searching
  "...has been deactivated" also returns the 27 messages the app sent as
  "...Has Been Deactivated". So the registry strings in emailTypes.js are search KEYS, and
  the exact subject is asserted separately against the value the app sent. Without that
  split the casing defect below would be invisible and every scenario would look clean.

  ---------------------------------------------------------------------------------------
  WHAT COVERS WHAT. Four of the fifteen templates were ALREADY covered end to end before
  this file existed, and are deliberately NOT duplicated here - the same rule the promo and
  community modules follow. They carry the @agent-email tag where they live, so
  `npm run test:agent-emails` runs the whole matrix in one pass:

    Join Talentforge (invite, first time)
      -> SuperAdmin_Portal/UserManagement/Invite-agent.feature, "the full invite lifecycle
         from submit through the invitation email to Active" (sender, recipient, temporary
         password and sign-in CTA all asserted)
    Your Talentforge promo code has been disabled
    Your Talentforge promo code has been resumed
      -> Promo_Code/Promo-Code-Lifecycle.feature, "disabling and re-enabling a promo
         notifies its agent by email and in-app"
    Your Talentforge promo code has expired
      -> Promo_Code/Promo-Code-Lifecycle.feature §6. NOTE: that scenario is tagged
         "known-issue" on the grounds that the app never sends this mail. THAT IS STALE -
         the 2026-08-12 sweep found ten of them, newest 2026-08-07, under exactly the
         subject emailTypes.js had only guessed at. Re-run it before assuming it must fail.
         (The tag is spelled without its leading marker here on purpose: Gherkin parses any
         description line STARTING with that character as a tag and fails the whole file.)

  FIVE templates have never been sent at all. A 90-day sweep found no message carrying
  their copy, so there is no subject to register and no honest way to guess one. They are
  matched on BODY TEXT instead (see AGENT_TEMPLATES_NOT_SENT in emailTypes.js), because a
  guessed subject can only ever answer "nothing arrived" - which cannot tell "the app does
  not send this" from "the app sends it under a subject nobody predicted", and those are
  completely different findings to hand to dev.

  ---------------------------------------------------------------------------------------
  EVERY SCENARIO HERE OWNS A THROWAWAY AGENT, or drives a mail-only action.

  This matters because the neighbouring Agent.feature says at the top that NOTHING in it
  mutates an agent, and means it - every deactivate, reactivate and email-change dialog
  there is opened and then cancelled, because that file runs against shared DEV agents the
  promo, referral, invite and dashboard features all read. These emails can only be
  observed if the action really happens, so each scenario invites its own agent, commits
  against that, and abandons the account. Nothing here touches a fixture in .env.

  Consequence, accepted deliberately: the committing scenarios are @provision, so they need
  the network and the IMAP inbox, and each costs one live agent invite. No payments.

  PARALLEL IS SAFE HERE, and that is not true of the rest of the suite. Every provisioned
  agent gets its own `iqra.farooq+<tag>@bytecorp.io` address, and bytecorp PRESERVES the
  +alias in the To header - verified in the sweep - so waitForEmail tells two agents' mail
  apart by recipient. The candidate signups that CLAUDE.md forbids running in parallel use
  anonaddy aliases (iqra.anonaddy.com), which anonaddy strips on delivery, leaving nothing
  to disambiguate. Hence `-p agentEmails` sets --parallel and the provision profile does not.
  (Addresses are written without a leading marker character in this description on purpose:
  Gherkin parses any description line STARTING with one as a tag and fails the whole file.)

  # Reuses Agent.feature's own two Background steps rather than defining a third way to sign a
  # superadmin in. One login path for the whole superadmin surface means a change to it cannot
  # leave this file passing against a stale one.
  Background:
    Given I am logged in as the superadmin
    And I am on the Agents listing

  # ==================== 1. The email-change pair ====================

  # ONE TRIGGER, TWO MAILS, so one scenario asserts both. Committing Update Email Address
  # sends a change notice to the agent's OLD address and a verification link to the NEW one,
  # simultaneously. Splitting them would mean committing a SECOND email change purely to
  # observe the other half, and each scenario would have to ignore the mail it is not about.
  #
  # Both are checked by one step that collects every mismatch across both mails and reports
  # them together, because Cucumber abandons a scenario at its first failing step: two
  # consecutive Then steps would only ever show whichever mail failed first.
  #
  # TWO CONFIRMED DEFECTS, both measured in the run of 2026-08-12, which is why this is
  # @known-issue. Everything else in the scenario passes, and the one step collects both so a
  # single red row shows both rather than whichever failed first.
  #
  #   1. THE CHANGE NOTICE IS NEVER SENT AT ALL. Figma's "Your Email Address Has Been Updated"
  #      template says the agent is told their address changed. Committing a real email change
  #      produced NO such mail: a 180s wait on the old address found nothing, and a follow-up
  #      sweep for that subject across the WHOLE inbox over the following six hours found zero
  #      messages to any recipient. So the agent is silently moved to a new address. Only the
  #      verification mail goes out.
  #   2. THE VERIFICATION MAIL GREETS "Hi ," WITH THE NAME MISSING. Reproduced on a
  #      brand-new agent (uid 20307, 14:54:32Z) as well as on an older message (uid 19703), so
  #      it is not a data problem with one account. Note the change notice on the SAME trigger
  #      greets correctly in the historical messages, so only this template is affected.
  #      A body-contains check for any other sentence passes straight over it, which is why the
  #      greeting is asserted as NAMING the agent rather than as merely being present.
  @positive @provision @known-issue
  Scenario: Verify that updating an agent's email address notifies the old address and sends a verification link to the new one
    Given I have provisioned a throwaway agent for email notifications
    And I have baselined the inbox for that agent's email-change mails
    When I update that agent's email address to a fresh address
    Then both email-change notifications should be correct:
      | mail              | to      | subject                                        |
      | account changed   | old     | Your Talentforge account email was changed     |
      | verify new address| new     | Verify your new Talentforge email address      |
    And the verification email should carry a working verification link

  # ==================== 2. Deactivation and re-activation ====================

  # ONE scenario for both mails, deliberately. Deactivation is reversible from the portal -
  # Reactivate restores the account - so the round trip is a single natural journey and the
  # second mail needs the first action to have happened. It also leaves the throwaway Active
  # rather than abandoning it deactivated.
  #
  # THE SUBJECTS ARE ASSERTED EXACTLY, IN LOWER CASE, and that was settled by measurement
  # rather than by choosing. The inbox holds this pair under two different casings - 59 as
  # "...has been deactivated" and 27 as "...Has Been Deactivated", both sent on the same day -
  # so two code paths disagree about one subject line. Committing a real deactivation and
  # re-activation against a throwaway on 2026-08-12 settled which belongs to the AGENT: uid
  # 20308 "Your Talentforge account has been deactivated" and uid 20310 "...has been
  # reactivated", both LOWER CASE. The Title Case variants therefore belong to another path,
  # almost certainly the candidate-facing one, which shares the subject.
  #
  # THAT SHARED SUBJECT IS ITSELF WORTH RAISING and is recorded in
  # AGENT_EMAIL_FIGMA_VS_APP.md: a superadmin scanning the inbox cannot tell whether an agent's
  # account or a candidate's was deactivated, because only the body distinguishes them.
  #
  # The deactivation is committed through the DIRECT path only. confirmDeactivate() refuses
  # the Transfer & Deactivate variant on purpose: that path moves real candidates onto
  # another agent and nothing in the portal undoes it. A throwaway has no candidates, so the
  # direct path is the one it gets - and if that ever changes, the scenario fails loudly
  # instead of reassigning somebody's caseload.
  @positive @provision
  Scenario: Verify that deactivating and re-activating an agent emails them at each step
    Given I have provisioned a throwaway agent for email notifications
    And I have baselined the inbox for that agent's lifecycle mails
    When I deactivate that agent
    Then that agent should be emailed that their account was deactivated
    When I re-activate that agent
    Then that agent should be emailed that their account was reactivated
    And the two lifecycle emails should each name the agent and describe the right state

  # ==================== 3. The reminder the portal can actually send ====================

  # This one does NOT provision. A freshly invited agent is Active, not flagged, so it has no
  # Notify action at all - the reminder can only be sent to an agent the app itself has put on
  # Requires Attention.
  #
  # So the Given HUNTS for a usable subject rather than assuming one: a flagged agent whose
  # address is on the inbox the suite reads. Measured 2026-08-12, three of the ten agents on
  # that tab qualify (leftover +promonone throwaways from earlier @provision runs); the other
  # seven are on @addy.com and @gmail.com addresses whose mail this suite cannot see at all.
  # If none qualifies the step says so explicitly instead of timing out on an inbox read.
  #
  # Sending a reminder mutates nothing - it delivers an email and leaves the account exactly
  # as it was - so this scenario is not @provision and needs no restore hook.
  #
  # The step asserts the mail matching whatever type the DIALOG SAID it would send, rather
  # than a hardcoded one. The dialog offers only "Monthly Target Delay Reminder" today (see
  # the next scenario), but reading the promise and then checking it was kept is the
  # assertion that stays correct if the app ever offers more.
  #
  # THE BUTTON SENDS A DIFFERENT TEMPLATE FROM THE AUTOMATIC REMINDER, AND IT IS THE BROKEN
  # ONE. This is the scenario's finding and the reason it is @known-issue. Measured 2026-08-12
  # on one flagged agent, two mails about the same thing:
  #
  #   sent automatically  uid 20306  "Reminder: Monthly target progress"        <- clean
  #   sent by the button  uid 20311  "Subject: Monthly target delay reminder"   <- malformed
  #
  # The on-demand mail's subject carries the literal label "Subject: " baked into its value, so
  # the agent's client shows "Subject: Subject: Monthly target delay reminder". Three of these
  # prefixed subjects exist elsewhere in the app, and this proves at least one is agent-facing
  # and still live rather than reworded.
  #
  # ASSERTION ORDER IS LOAD-BEARING HERE. Delivery and body come first and pass; the subject
  # hygiene check is LAST, so this cosmetic-looking defect cannot cost the assertions that say
  # whether the reminder fires and reads correctly at all. Same rule as the receipt-PDF
  # currency step. It also means a red row on the final step alone is the expected result.
  @positive @known-issue
  Scenario: Verify that Send Reminder emails the flagged agent the reminder it promised
    Given I have found a flagged agent whose mail the suite can read
    And I have baselined the inbox for that agent's reminder mails
    When I open the Notify dialog for that flagged agent
    And I send the reminder the dialog offers
    Then that agent should receive the reminder the dialog promised
    And the reminder email should name the agent and state its purpose
    And the reminder email's subject should not carry a literal "Subject:" label

  # ==================== 4. The reminders the portal cannot send ====================

  # THREE OF THE FOUR REMINDER TEMPLATES IN FIGMA CANNOT BE SENT FROM THE PORTAL AT ALL, and
  # this scenario is where that is asserted. It costs no email and no provisioning: the whole
  # finding is visible in the dialog.
  #
  # Measured 2026-08-12 across EIGHT agents on Requires Attention
  # (scripts/probe-agent-notify-reminder-types.js): the dialog renders the label
  # "Select Reminder Type" above the single fixed value "Monthly Target Delay Reminder", with
  # NO <select>, NO radio group and NO combobox anywhere in it - 8 of 8, no variation by
  # agent, so the type does not follow the flag reason either. A label inviting a choice with
  # nothing to choose from is its own defect, independent of the missing templates.
  #
  # Figma defines four agent reminders: Monthly target delay, Verification delay, Activity,
  # and Document review activity. Of the other three, the Activity reminder IS sent but by
  # cron (its messages land at 18:00:01), so it is excluded from this assertion - a portal
  # with no button for it is not a defect if a scheduler owns it. The remaining two have
  # never been sent by anything: no message in 90 days carries their copy.
  #
  # WHY THIS IS ONE SCENARIO AND NOT TWO. The two missing types are the same defect in the
  # same control, and the step reports every type it did not find, so a single red row names
  # both. Two scenarios would open the same dialog on the same agent twice to assert one gap.
  @negative @known-issue
  Scenario: Verify that Send Reminder offers every reminder type the design defines
    Given I have found a flagged agent whose mail the suite can read
    When I open the Notify dialog for that flagged agent
    Then the dialog should offer a way to choose the reminder type
    And the dialog should offer each reminder type the design defines:
      | reminder type              | figma template                            |
      | Monthly Target Delay       | Agent - Monthly target delay reminder     |
      | Verification Delay         | Agent - Verification Delay Reminder       |
      | Document Review Activity   | Agent - Document Review Activity Reminder |

  # ==================== 5. The transfer email, unreachable behind a logged defect ====================

  # "Agent - Candidates Have Been Transferred to Your Account" has never been sent: no message
  # in 90 days contains that phrase. It cannot currently be provoked either, because the only
  # trigger - Transfer & Deactivate - is blocked by a defect already logged and asserted in
  # Agent.feature ("the transfer picker offers the other agents of the same university",
  # @known-issue): the picker renders "No agents available" for an agent whose university
  # demonstrably holds nine others, leaving Transfer & Deactivate permanently disabled.
  #
  # THIS SCENARIO DELIBERATELY DOES NOT RE-ASSERT THE PICKER. That would duplicate the other
  # file, and the two would then disagree the day one is updated. It asserts the EMAIL
  # consequence, which nothing else covers, and its failure message names the picker as the
  # blocker with the cross-reference - so whoever reads the red row is sent to the right
  # defect rather than to a second, apparently-separate one.
  #
  # It will turn green on its own once the picker is fixed, without being rewritten.
  # The donor is found by Agent.feature's OWN Given, which filters the listing by candidate
  # count and reads the server's payload. The first version of this scenario used a bespoke
  # step that scanned rendered rows for a candidate count and found nothing on the run of
  # 2026-08-12 - `readRows()` does not expose that figure the way it assumed. Reusing the
  # step that already does it correctly is both shorter and the repo's own rule.
  @negative @known-issue @provision
  Scenario: Verify that transferring candidates emails the receiving agent
    Given I have provisioned a throwaway agent for email notifications
    And I have baselined the inbox for that agent's transfer mails
    And I have found an agent holding active candidates
    When I transfer those candidates to the throwaway agent
    Then the throwaway agent should be emailed that candidates were transferred to them

  # ==================== 6. The two templates whose trigger this suite cannot reach ====================

  # "Agent - Your Candidate Account Has Been Deactivated" and "...Reactivated" are sent to the
  # AGENT about one of THEIR CANDIDATES. Neither has ever been sent - no message in 90 days
  # contains "one of your candidates".
  #
  # They are @not-automatable rather than @known-issue, and the distinction is deliberate. The
  # other unreachable templates above can each be asserted against something real: a dialog
  # that offers no type, a picker that offers no agent. These two cannot, because THE TRIGGER
  # ITSELF IS UNVERIFIED - deactivating a candidate from the superadmin portal is a flow no
  # feature file drives and no Page Object in this repo covers, so there is nothing to assert
  # against and no measured control to build on. Writing a scenario against a UI nobody has
  # confirmed exists would produce a red row that says "the email is missing" when the real
  # answer might be "the suite never performed the trigger" - the exact confusion the rest of
  # this file is built to avoid.
  #
  # TO PROMOTE THESE: confirm with the PO whether a superadmin can deactivate an individual
  # candidate and where, then drive it against a candidate of a THROWAWAY agent - never a
  # promo fixture's candidate, which the promo suite depends on being subscribable.
  @not-automatable
  Scenario: Verify that deactivating a candidate emails their agent
    Given a candidate of a throwaway agent is deactivated by a superadmin
    Then that agent should be emailed that their candidate's account was deactivated

  @not-automatable
  Scenario: Verify that re-activating a candidate emails their agent
    Given a candidate of a throwaway agent is re-activated by a superadmin
    Then that agent should be emailed that their candidate's account was reactivated
