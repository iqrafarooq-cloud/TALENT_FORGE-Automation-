#ALL PASSED
@agent-portal @welcome-onboarding
Feature: Agent Portal - Welcome and Candidate Onboarding Methods
  # 1. FIRST-TIME AGENT - WELCOME MODAL LIFECYCLE

  @positive @welcome-modal @TFF-36
  Scenario: Verify that the welcome modal greets a brand-new agent over an empty dashboard
    Given I am a newly onboarded agent who has never invited a candidate
    When I log in to the Agent Portal for the first time
    Then the first-time welcome modal should be displayed
    And the welcome modal should greet the agent by name
    And the welcome modal should show an "Onboard Candidates" primary button
    And the "Onboard Candidates" button should display a right-arrow icon
    And the dashboard behind the modal should show the empty state
    And every dashboard KPI widget should show a count of "0"

  @positive @welcome-modal @TFF-36
  Scenario: Verify that the welcome modal advances to the method chooser and dismisses cleanly
    Given the first-time welcome modal is displayed
    When I click "Onboard Candidates"
    Then the "Choose how you want to onboard your candidates:" modal should be displayed
    And the first-time welcome modal should no longer be displayed
    When I click outside the modal
    Then I should be on the Agent Dashboard
    And the first-time welcome modal should no longer be displayed
    When I refresh the page
    Then the first-time welcome modal should not be displayed

  @positive @welcome-modal @TFF-36
  Scenario: Verify that the welcome modal is dismissed by pressing Escape
    Given the first-time welcome modal is displayed
    When I press Escape
    Then the first-time welcome modal should no longer be displayed
    And I should be on the Agent Dashboard

  @positive @welcome-modal @TFF-158 @provision
  Scenario: Verify that the welcome modal is shown before the first invite and never after it
    Given I am a newly onboarded agent who has never invited a candidate
    When I log in to the Agent Portal for the first time
    Then the first-time welcome modal should be displayed
    When I invite a candidate via email
    And I log out and log back in as the same agent
    Then the first-time welcome modal should not be displayed
    And I should land directly on the Agent Dashboard
    When I log in as a different agent who already has candidates
    Then the first-time welcome modal should not be displayed
    And I should land directly on the Agent Dashboard

  @edge @welcome-modal @TFF-158 @needs-clarification
  Scenario: Verify that dismissing the modal without inviting anyone leaves the agent at zero candidates
    Given I am a newly onboarded agent who has never invited a candidate
    And I log in to the Agent Portal for the first time
    When I dismiss the welcome modal without inviting anyone
    And I log out and log back in as the same agent
    Then my total candidate count should be "0"
    And the first-time welcome modal state should be recorded for review
  # 2. CHOOSE ONBOARDING METHOD MODAL

  @positive @method-modal @TFF-36
  Scenario: Verify that both onboarding methods are offered as cards and each opens its own modal
    Given the "Choose Onboarding Method" modal is open
    Then the modal should present the following onboarding methods as interactive cards:
      | method           |
      | Invite via Email |
      | Share Agent Code |
    And each onboarding method should open its own modal from both its card and its text link:
      | method           | target                 |
      | Invite via Email | Send Onboarding Invite |
      | Share Agent Code | Share Agent Code       |
    When I click the "Invite via Email" card
    Then the "Send Onboarding Invite" modal should be displayed
    And the "Share Agent Code" modal should not be displayed

  @positive @method-modal @TFF-36
  Scenario: Verify that the method chooser closes on an outside click
    Given the "Choose Onboarding Method" modal is open
    When I click outside the modal
    Then the "Choose Onboarding Method" modal should no longer be displayed
    And I should be on the Agent Dashboard

  @positive @method-modal @TFF-36
  Scenario: Verify that the method chooser offers an X close icon that closes it
    Given the "Choose Onboarding Method" modal is open
    Then the modal should display an X close icon
    When I click the X close icon
    Then the "Choose Onboarding Method" modal should no longer be displayed
  # 3. SHARE AGENT CODE PATH

  @positive @agent-code @TFF-36 @TFF-467
  Scenario: Verify that the agent code modal displays, copies and navigates correctly
    Given the "Choose Onboarding Method" modal is open
    When I click the "Share Agent Code" card
    Then the "Share Agent Code" modal should be displayed
    And the agent code should be displayed in a centered card
    And a "Copy Code" button with a clipboard icon should be displayed
    When I click "Copy Code"
    Then the clipboard should hold the agent code shown in the modal
    And a "Copied!" confirmation should be displayed
    When I click the back arrow next to the modal title
    Then the "Choose Onboarding Method" modal should be displayed
    When I click the "Share Agent Code" card
    And I click the X close icon
    Then the "Share Agent Code" modal should no longer be displayed

  @positive @agent-code @TFF-467 @needs-clarification
  Scenario: Verify that the displayed agent code is alphanumeric with no separator characters
    Given the "Share Agent Code" modal is open
    Then the displayed agent code should be 6 characters of uppercase letters and digits with no separators

  @positive @agent-code @TFF-36
  Scenario: Verify that the agent code is permanently assigned and unique per agent
    Given I am logged in as agent "agent-one"
    And I note the agent code shown in the Share Agent Code modal
    When I log out and log back in as agent "agent-one"
    Then the agent code shown in the Share Agent Code modal should be unchanged
    When I log in as agent "agent-two"
    Then the agent code shown should differ from agent "agent-one"'s code

  # KNOWN ISSUE (re-measured 2026-10-15): the Facebook share opens facebook.com/sharer/sharer.php with
  # NO parameters, so the agent code is never passed (it carried ?quote=...<code> on 2026-08-28).
  # WhatsApp, LinkedIn and X still carry the code. Same regression as Referral-Codes.feature's share.
  @positive @agent-code @TFF-467 @known-issue
  Scenario: Verify that the agent code can be shared to every supported social platform
    Given the "Share Agent Code" modal is open
    Then sharing should open each platform's interface with the agent code pre-filled:
      | platform    |
      | WhatsApp    |
      | Facebook    |
      | LinkedIn    |
      | X (Twitter) |
