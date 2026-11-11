# run by : npm run test:candidate-e2e
#ALL PASSED
@agent-portal @candidate-onboarding @candidate-e2e
Feature: Agent Portal - Candidate Onboarding End to End
  # 1. INVITE TO IN PROGRESS

  @positive @provision @TFF-36 @TFF-9
  Scenario: Verify that a first-time agent can invite a candidate end to end from the welcome modal
    Given I am a newly onboarded agent who has never invited a candidate
    When I log in to the Agent Portal for the first time
    And I click "Onboard Candidates"
    And I click the "Invite via Email" card
    And I add a new candidate email by pressing "Enter"
    And I click "Send Invites"
    Then the Invitation Success modal should be displayed
    When I click "Go to In Progress"
    Then I should be on the Candidates "In Progress" page
    And that candidate should be listed with the status "Invite Sent"
    And the Status Detail should be "Awaiting Signup"
  # 2. FULL CANDIDATE LIFECYCLE

  @positive @provision @TFF-9 @TFF-31
  Scenario: Verify that an invited candidate signs up and reaches Test Pending
    Given I have invited a new candidate via email
    And the invitation email has arrived for that candidate
    Then that candidate's Status Detail should be "Awaiting Signup"
    When the candidate opens the account setup link from the email
    Then the signup page should load with their invited email pre-filled
    And the agent code field should be pre-filled with my agent code
    And neither the email nor the agent code should be editable
    When the candidate completes signup and verifies their email
    Then the candidate should be logged in and taken to the onboarding flow
    When I reload the Candidates "In Progress" page
    Then that candidate should have the status "Onboarding Incomplete"
    And that candidate's Status Detail should be "Profile Incomplete, Test Pending"
    When the candidate completes their onboarding profile
    Then that candidate's Status Detail should be "Test Pending"
  # 3. AGENT CODE ONBOARDING

  @positive @provision @TFF-9 @TFF-467
  Scenario: Verify that a candidate onboards using a shared agent code instead of an email invite
    Given I have copied my agent code from the Share Agent Code modal
    When a new candidate signs up entering my agent code manually
    And the candidate verifies their email
    Then that candidate should be listed under my candidates
  # 4. INVALID SIGNUP CONDITIONS

  @negative @TFF-9
  Scenario: Verify that signup is refused for an unrecognised agent code
    Given a new candidate is on the signup page
    When the candidate submits the signup form with an unrecognised agent code
    Then a signup error should be displayed
    And no candidate account should be created

  @negative @TFF-9 @needs-clarification
  Scenario: Verify that inviting an address that already has an account is refused
    When I invite an email that already has a candidate account
    Then the invitation should be refused
    And the agent should be told why
  # 5. INVITATION TOKEN SECURITY

  @edge @security @provision @TFF-100 @TFF-9
  Scenario: Verify that the setup link is portable across sessions but rejects a tampered token
    Given an invitation email has arrived for a newly invited candidate
    When the account setup link is opened in a different browser
    Then the account setup page should render correctly
    And the page should not depend on the original browser session
    When the account setup link is opened in a private window
    Then the account setup page should render correctly
    When the account setup link is opened with a modified token
    Then the link should be rejected as invalid
    And no candidate account should be created
  # 6. WHAT CANNOT BE AUTOMATED

  @edge @not-automatable @TFF-31 @needs-clarification
  Scenario: Verify that a candidate who completes the psychometric assessment becomes Active
    Given a candidate of mine is at Status Detail "Test Pending"
    When the candidate completes the psychometric assessment
    Then that candidate should no longer be listed under Candidates "In Progress"
    And that candidate should be listed under Candidates "Active"

  @edge @not-automatable @TFF-9 @needs-clarification
  Scenario: Verify that an expired invitation link tells the candidate to request a new invite
    Given a candidate has an invitation whose setup link has expired
    When the candidate opens that expired setup link
    Then they should be told the invitation is no longer valid
    And they should be guided to request a new invitation
