@agent-management @superadmin @agent-row-actions
Feature: SuperAdmin User Management - Agents row actions on every tab

  Background:
    Given I am logged in as the superadmin
    And I am on the Agents listing
  # ==================== 1. LOG IN AS AGENT: VERIFY YOUR IDENTITY ====================

  @positive
  Scenario: Verify that Log in as agent asks the superadmin to confirm their identity before anything starts
    Given I have noted the first agent on the Active tab
    When I choose "Log in as agent" for that agent
    Then the Verify your identity dialog should name that agent
    And the identity password field should be masked and read "Enter current password"
    And Confirm should be disabled until a password is typed
    And no impersonation request should have been made

  @positive
  Scenario: Verify that the identity password can be shown and hidden again
    Given I have noted the first agent on the Active tab
    When I choose "Log in as agent" for that agent
    And I type "Peek-a-boo-1" as the identity password
    Then toggling the password visibility should show it and then mask it again

  @positive
  Scenario: Verify that leaving the Verify your identity dialog any way starts nothing and forgets the password
    Given I have noted the first agent on the Active tab
    Then leaving the Verify your identity dialog each way should start nothing and clear the password:
      | way out       |
      | Cancel        |
      | X icon        |
      | Escape        |
      | outside click |

  @positive
  Scenario: Verify that Log in as agent is also offered from the agent profile
    Then the profile overflow "Log in as agent" should open the Verify your identity dialog from each of these tabs:
      | tab                |
      | Active             |
      | Requires Attention |
  # ==================== 2. LOG IN AS AGENT: REASON AND REVIEW ====================

  @positive
  Scenario: Verify that a confirmed identity asks for a reason and a review before any session starts
    Given I have noted the first agent on the Active tab
    When I choose "Log in as agent" for that agent
    And I confirm my identity with my own password
    Then the identity should have been verified without starting a session
    And the Reason for access step should read "This will be logged and visible in the audit trail."
    And the Reason for access step should offer exactly these reasons:
      | Troubleshooting an issue         |
      | Assisting with account setup     |
      | Investigating a reported problem |
      | Acting at the agent's request    |
      | Other                            |
    And Next should be disabled until a reason is chosen
    When I choose the access reason "Other"
    Then a required "Please specify reason" field should appear and keep Next disabled for:
      | <empty>  |
      | <spaces> |
    When I specify the other reason "Checking a reported sign-in problem"
    Then Next should be enabled
    When I press "Next" on the access step
    Then the review step should name that agent and the reason "Checking a reported sign-in problem"
    And the review step should say the session ends after 30 minutes or 15 minutes of inactivity
    When I press "Back" on the access step
    Then the access step should still hold the reason "Other" with "Checking a reported sign-in problem"
    When I press "Cancel" on the access step
    Then no impersonation session should have been started
    And I should still be on the Agents listing as the superadmin
  # ==================== 3. LOG IN AS AGENT: THE REAL THING ====================

  @negative @impersonates-agent
  Scenario: Verify that a wrong password is refused inline and starts nothing
    Given I have noted the first agent on the Active tab
    When I choose "Log in as agent" for that agent
    And I confirm my identity with a wrong password
    Then the identity check should be refused with "Incorrect password."
    And the Verify your identity dialog should still be open
    And no impersonation session should have been started

  @positive @e2e @impersonates-agent @provision
  Scenario: Verify that a superadmin can log in as an agent, see whose account it is, and end the session
    Given I have provisioned a throwaway agent to log in as
    When I choose "Log in as agent" for that agent
    And I confirm my identity with my own password
    And I choose the access reason "Troubleshooting an issue"
    And I press "Next" on the access step
    Then the review step should name that agent and the reason "Troubleshooting an issue"
    When I start the impersonation session
    Then I should be on that agent's dashboard with a banner naming them
    And the banner should count down from at most 30 minutes
    When I end the impersonation session
    Then a "Session Ended" confirmation should name that agent and offer "Back to Agent Profile"
    When I go back to the agent profile
    Then I should be on that agent's profile as the superadmin
    And the audit trail should record logging in as that agent for "Troubleshooting an issue" and logging out of the same session
  # ==================== 4. NOTIFY: EVERY WAY OUT ====================

  @positive
  Scenario: Verify that the Send Reminder dialog can be left every way without sending a reminder
    Given I am on the "Requires Attention" tab
    And I have noted the first agent on the current tab
    Then leaving the "Send Reminder" dialog each way should send nothing:
      | way out       | closes |
      | Cancel        | yes    |
      | X icon        | yes    |
      | Escape        | yes    |
      | outside click | yes    |
  # ==================== 5. RESEND INVITE: EVERY WAY OUT, AND THE COOLDOWN ====================

  @positive @needs-clarification
  Scenario: Verify that the Resend Invitation dialog can be left without resending the invitation
    Given I am on the "Invite Sent" tab
    And I have noted the first agent on the current tab
    Then leaving the "Resend Invitation" dialog each way should send nothing:
      | way out       | closes |
      | Cancel        | yes    |
      | X icon        | yes    |
      | Escape        | yes    |
      | outside click | no     |

  @positive @provision
  Scenario: Verify that a resent invitation locks the row's Edit and Resend Invite until the cooldown ends
    Given I have just invited an agent successfully
    When I click "Resend Invite" for the invited agent
    And I confirm the resend and note its cooldown
    Then the toast "Invite re-sent successfully." should be displayed
    And the invited agent's Edit and Resend Invite should be disabled while the cooldown runs
    And the invited agent's Edit and Resend Invite should be enabled again once the cooldown ends
