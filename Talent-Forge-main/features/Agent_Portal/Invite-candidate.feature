@agent-portal @invite-candidate
Feature: Agent Portal - Invite Candidate
  # 1. SEND ONBOARDING INVITE MODAL — NAVIGATION & CHROME

  @positive @invite-modal @TFF-36
  Scenario: Verify that the invite modal navigates back, closes every documented way, and discards unsent input
    Given the "Send Onboarding Invite" modal is open
    When I click the back arrow next to the modal title
    Then the "Choose Onboarding Method" modal should be displayed
    And the "Send Onboarding Invite" modal should no longer be displayed
    When I reopen the "Send Onboarding Invite" modal
    Then the invite modal should close via each of these dismissals:
      | dismissal        |
      | X icon           |
      | Cancel button    |
      | clicking outside |
    When I reopen the "Send Onboarding Invite" modal
    And I enter the email "discard.me@university.edu" as a chip
    And I close the invite modal by "Cancel button"
    And I reopen the "Send Onboarding Invite" modal
    Then no email chips should be present
    And no invitation should have been sent to "discard.me@university.edu"
  # 2. MANUAL EMAIL ENTRY — CHIPS & VALIDATION
    #BUG LOGGED

  @positive @manual-entry @TFF-36 @known-issue @needs-clarification
  Scenario: Verify that emails become removable chips and drive the Send Invites button state
    Given the "Send Onboarding Invite" modal is open
    Then the "Send Invites" button should be disabled
    When I add the email "chip.enter@university.edu" by pressing "Enter"
    Then a chip for "chip.enter@university.edu" should be displayed
    And the email input field should be cleared
    And the "Send Invites" button should be enabled
    When I add the email "chip.space@university.edu" by pressing "Space"
    Then a chip for "chip.space@university.edu" should be displayed
    When I paste "pasted@university.edu" into the email field and press "Enter"
    Then a chip for "pasted@university.edu" should be displayed
    And 3 email chips should be displayed
    When I click the X icon on the chip for "chip.space@university.edu"
    Then a chip for "chip.space@university.edu" should not be displayed
    And a chip for "chip.enter@university.edu" should still be displayed
    And 2 email chips should be displayed
    When I remove all remaining email chips
    Then the "Send Invites" button should be disabled
    #BUG LOGGED
  #BUG LOGGED

  @negative @manual-entry @security @TFF-135 @known-issue
  Scenario: Verify that every malformed email is rejected inline and never becomes a chip
    Given the "Send Onboarding Invite" modal is open
    When I attempt to add each of these malformed emails:
      | email                               |
      | invalid-email                       |
      | missing@                            |
      | @nodomain.com                       |
      | no.at.symbol.com                    |
      | spaced name@domain.com              |
      | double@@domain.com                  |
      | trailing.dot@domain.                |
      | user@domain                         |
      | user@.com                           |
      | user@-domain.com                    |
      |                                     |
      | <script>alert('xss')</script>@x.com |
    Then each of them should be rejected with an inline email validation error
    And no chip should have been created for any of them
    And no script should have been executed on the page
    And the "Send Invites" button should be disabled

  @positive @manual-entry @TFF-36 @TFF-9
  Scenario: Verify that valid-but-unusual addresses are accepted, including non-university ones
    Given the "Send Onboarding Invite" modal is open
    When I attempt to add each of these valid emails:
      | email                                                                           | note                        |
      | candidate@gmail.com                                                             | non-.edu, allowed by TFF-36 |
      | student@mail.eng.university.edu                                                 | multi-level subdomain       |
      | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@university.edu |          64-char local part |
      | padded@university.edu                                                           | surrounding whitespace      |
    Then a chip should be displayed for each of them
    And the chip for "  padded@university.edu  " should be trimmed to "padded@university.edu"
    And the "Send Invites" button should be enabled

  @edge @manual-entry @TFF-36 @needs-clarification
  Scenario: Verify that duplicate emails collapse to a single recipient regardless of letter case
    Given the "Send Onboarding Invite" modal is open
    When I enter the following emails as chips:
      | email               |
      | dupe@university.edu |
      | dupe@university.edu |
      | Dupe@University.edu |
    And I click "Send Invites"
    Then exactly 1 invitation should be sent to "dupe@university.edu"

  @positive @send-invite @provision @TFF-36 @TFF-89
  Scenario: Verify that the dashboard success modal offers both routes and Stay on Dashboard keeps the agent there
    Given I am a newly onboarded agent on the Agent Dashboard
    And the "Send Onboarding Invite" modal is open
    And I have entered the email "manual.success@university.edu" as a chip
    When I click "Send Invites"
    Then the Invitation Success modal should be displayed
    And the modal should offer "Stay on Dashboard"
    And the modal should offer "Go to In Progress"
    When I click "Stay on Dashboard"
    Then the Invitation Success modal should no longer be displayed
    And I should still be on the Agent Dashboard

  @positive @send-invite @provision @TFF-36 @TFF-89
  Scenario: Verify that the dashboard success modal's Go to In Progress route reaches the In Progress page
    Given I am a newly onboarded agent on the Agent Dashboard
    And the "Send Onboarding Invite" modal is open
    And I have entered the email "route.success@university.edu" as a chip
    When I click "Send Invites"
    Then the Invitation Success modal should be displayed
    When I click "Go to In Progress"
    Then I should be on the Candidates "In Progress" page
    And I should not be on the Agent Dashboard
  #BUG LOGGED
  #BUG LOGGED

  @positive @send-invite @TFF-313
  Scenario: Verify that inviting from the In Progress page shows a plain success message instead of nav options
    Given I am on the Candidates "In Progress" page
    And the "Send Onboarding Invite" modal is open
    And I have entered the email "from.inprogress@university.edu" as a chip
    When I click "Send Invites"
    Then the success message "Invite sent successfully." should be displayed
    And the success modal should not offer "Stay on Dashboard"
    And the success modal should not offer "Go to In Progress"

  @positive @send-invite @email @e2e @TFF-410 @TFF-248 @TFF-260 @needs-clarification
  Scenario: Verify that a sent invitation creates the row, bumps the count and delivers the email
    Given I am logged in as an agent
    And I note the current total candidate count
    When I invite the candidate "appears.here@university.edu" via email
    And I open the Candidates "In Progress" page
    And I select the "Invite Sent" quick filter tab
    Then a row for "appears.here@university.edu" should be listed
    And the row status should be "Invite Sent"
    And my total candidate count should have increased by 1
    And an invitation email should arrive for "appears.here@university.edu"
    And the invitation email should contain an account setup link
    And the invitation email should display the correct set-up-account icon
    And the invitation email should display a "Set up my account" call to action

  @positive @send-invite @resend-invite @TFF-36 @needs-clarification
  Scenario: Verify that confirming the resend confirmation resends the invitation to that candidate
    Given I am logged in as an agent
    When I invite the candidate "resend.me@university.edu" via email
    # Read BEFORE the resend: its uid is the baseline, without which "a new mail arrived" would
    # pass on the invitation that was already sitting in the inbox.
    And I read the invitation email for that candidate
    And I open the Candidates "In Progress" page
    And I select the "Invite Sent" quick filter tab
    And I open the resend confirmation for that candidate
    Then the resend confirmation should name that candidate
    And confirming it should resend the invitation
    And a new invitation email should arrive for that candidate
    And the resent invitation should carry a fresh account setup link

  @positive @send-invite @TFF-36
  Scenario: Verify that inviting several recipients at once creates a row for each of them
    Given I am logged in as an agent
    When I invite the following candidates via email:
      | email                      |
      | multi.one@university.edu   |
      | multi.two@university.edu   |
      | multi.three@university.edu |
    # Measured 2026-10-15: inviting several recipients confirms with the toast "Emails sent successfully".
    Then the success message "Emails sent successfully" should be displayed
    And each of those candidates should be listed in the "Invite Sent" tab

  @negative @send-invite @TFF-36 @needs-clarification
  Scenario: Verify that inviting emails that already exist never creates a duplicate candidate
    Given I am logged in as an agent
    And "already.active@university.edu" is already an active candidate of mine
    And "pending.invite@university.edu" already has a pending invitation from me
    And "other.agent@university.edu" is already a candidate of a different agent
    When I invite the candidate "already.active@university.edu" via email
    Then I should be told that the candidate already exists
    And no duplicate candidate row should be created
    When I invite the candidate "pending.invite@university.edu" via email
    Then exactly 1 row for "pending.invite@university.edu" should be listed in the "Invite Sent" tab
    When I invite the candidate "other.agent@university.edu" via email
    Then the outcome should be reported to me without exposing the other agent's data

  @negative @send-invite @TFF-36
  Scenario: Verify that a failing invitation service is surfaced and sends nothing
    Given the "Send Onboarding Invite" modal is open
    And I have entered the email "server.error@university.edu" as a chip
    And the invitation service will fail
    When I click "Send Invites"
    Then an invite error message should be displayed
    And the Invitation Success modal should not be displayed
    And no row for "server.error@university.edu" should be created

  @negative @send-invite @TFF-36
  Scenario: Verify that an unreachable network is surfaced and keeps the entered address for retry
    Given the "Send Onboarding Invite" modal is open
    And I have entered the email "network.error@university.edu" as a chip
    And the network is offline
    When I click "Send Invites"
    Then an invite error message should be displayed
    And the entered email chip should be preserved for retry

  @negative @send-invite @TFF-36
  Scenario: Verify that an expired session sends nothing and returns the agent to login
    Given the "Send Onboarding Invite" modal is open
    And I have entered the email "session.expired@university.edu" as a chip
    And my session has expired
    When I click "Send Invites"
    Then I should be redirected to the login page
    And no invitation should have been sent to "session.expired@university.edu"

  @edge @send-invite @TFF-36
  Scenario: Verify that Send Invites is idempotent and shows a busy state while in flight
    Given the "Send Onboarding Invite" modal is open
    And I have entered the email "double.click@university.edu" as a chip
    When I click "Send Invites" twice in quick succession
    Then the "Send Invites" button should be disabled while the request is in flight
    And exactly 1 invitation should be sent to "double.click@university.edu"
  # 4. DASHBOARD ENTRY POINTS

  @positive @entry-point @TFF-216 @TFF-344 @TFF-31
  Scenario: Verify that every documented entry point opens the candidate invitation flow
    Given I am logged in as an agent who has no candidates
    And I am on the Agent Dashboard
    When I click "Invite Candidate" on the Active Candidates widget
    Then the candidate invitation flow should be opened
    When I close the invitation flow
    And I open the Candidates "In Progress" page
    And I select the "All" quick filter tab
    Then the empty state headline "No candidates yet" should be displayed
    And an "Invite Candidates" primary button should be displayed
    When I click the "Invite Candidates" primary button
    Then the candidate invitation flow should be opened

  @positive @entry-point @TFF-216
  Scenario: Verify that the In Progress invite button reads "Invite Candidates" for an agent with no candidates
    Given I am logged in as an agent who has no candidates
    When I open the Candidates "In Progress" page
    Then the invite button label should be exactly "Invite Candidates"

  @positive @entry-point @TFF-216
  Scenario: Verify that the In Progress invite button reads "Invite Candidate" for an agent who has candidates
    Given I am logged in as an agent
    When I open the Candidates "In Progress" page
    Then the invite button label should be exactly "Invite Candidate"

  @positive @entry-point @TFF-36 @needs-clarification
  Scenario: Verify that the dashboard KPI tiles are figures, with the routing on the section cards
    Given I am logged in as an agent
    And I am on the Agent Dashboard
    Then each KPI widget should be a figure rather than a control:
      | widget                 |
      | Total Candidates       |
      | Active Candidates      |
      | Onboarding in Progress |
      | Pending Verifications  |

  @positive @entry-point @TFF-36
  Scenario: Verify that every dashboard section card's View all link reaches the listing it summarises
    Given I am logged in as an agent
    And I am on the Agent Dashboard
    Then each dashboard "View all" link should reach its listing:
      | card                        | destination                     |
      | Document Verification Queue | Verifications                   |
      | Requires Attention          | Candidates > Requires Attention |
      | Active Candidates           | Candidates > Active             |
    And the dashboard should offer a "View all" link on exactly these cards:
      | card                        |
      | Document Verification Queue |
      | Requires Attention          |
      | Active Candidates           |

  @negative @entry-point @accessibility @TFF-36 @needs-clarification
  Scenario: Verify that the dashboard View all links are reachable by assistive technology
    Given I am logged in as an agent
    And I am on the Agent Dashboard
    Then every dashboard "View all" link should be reachable by assistive technology
