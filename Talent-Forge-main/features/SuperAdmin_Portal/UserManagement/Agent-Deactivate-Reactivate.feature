@agent-management @superadmin
Feature: SuperAdmin User Management - Agents (Deactivate, Reactivate, Notify)

  Background:
    Given I am logged in as the superadmin
    And I am on the Agents listing
  # ==================== DEACTIVATE ====================

  @positive
  Scenario: Verify that an agent with no active candidates can be deactivated directly
    Given I have found an agent with no active candidates
    When I open the Deactivate dialog for that agent
    Then the deactivate dialog heading should be "Deactivate Agent Account"
    And the deactivate dialog should say there are no active candidates assigned
    And the deactivate dialog should not ask for a candidate transfer
    And the confirm button should be labelled "Deactivate"
    And the confirm button should be enabled
    When I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible
    And that agent should still be listed on the "Active" tab

  @positive
  Scenario: Verify that an agent holding candidates must transfer them before deactivation
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    Then the deactivate dialog heading should be "Deactivate Agent Account"
    And the deactivate dialog should require the candidates to be transferred first
    And the deactivate dialog should name that agent's number of active candidates
    And the deactivate dialog should show that agent's university as the affiliation
    And the deactivate dialog should offer a receiving agent picker
    And the confirm button should be labelled "Transfer & Deactivate"
    And the confirm button should be disabled
    When I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible

  @positive
  Scenario: Verify that cancelling the Deactivate dialog leaves the agent active
    Given I have found an agent with no active candidates
    When I open the Deactivate dialog for that agent
    And I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible
    And that agent should still be listed on the "Active" tab
    And that agent should not be listed on the "Deactivated" tab

  @positive
  Scenario: Verify that the transfer picker offers the other agents of the same university
    Given I have found an agent holding active candidates
    And other agents exist at that agent's university
    When I open the Deactivate dialog for that agent
    Then the receiving agent picker should offer at least one of those other agents

  @negative @known-issue
  Scenario: Verify that the transfer prompt neither assumes the agent's gender nor mis-numbers their candidates
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    Then the transfer prompt should refer to the agent without assuming gender and agree in number

  @negative
  Scenario: Verify that an agent is never offered as the receiver of their own candidates
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    Then the receiving agent picker should not offer that agent itself
    When I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible

  @positive
  Scenario: Verify that choosing a receiving agent is what enables Transfer & Deactivate
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    Then the confirm button should be labelled "Transfer & Deactivate"
    And the confirm button should be disabled
    When I choose the first receiving agent offered
    Then the confirm button should be enabled
    When I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible
    And that agent should still be listed on the "Active" tab

  @edge-case
  Scenario: Verify that reopening the Deactivate dialog forgets a receiver chosen and cancelled
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    And I choose the first receiving agent offered
    And I cancel the Deactivate dialog
    And I reopen the Deactivate dialog for that agent
    Then the receiving agent picker should be empty
    And the confirm button should be disabled
    When I cancel the Deactivate dialog
    Then the deactivate dialog should not be visible

  @positive
  Scenario: Verify that the Deactivate dialog can be dismissed by every route without deactivating
    Given I have found an agent with no active candidates
    Then the Deactivate dialog should close via each of these, leaving the agent active:
      | method |
      | Cancel |
      | X icon |
      | Escape |
  # ==================== REACTIVATE / NOTIFY ====================

  @positive
  Scenario: Verify that Reactivate on the Deactivated tab offers to restore the agent's access
    Given I am on the "Deactivated" tab
    And I have noted the first agent on the current tab
    When I open the Reactivate dialog for that agent
    Then the reactivate dialog heading should be "Re-activate Account"
    And the reactivate dialog should name that agent
    And the reactivate dialog should say the agent regains access instantly
    And the reactivate dialog should say a re-activation email will be sent
    And the reactivate dialog should offer "Cancel" and "Re-activate Account"
    When I cancel the Reactivate dialog
    Then that agent should still be listed on the "Deactivated" tab

  @positive
  Scenario: Verify that the Reactivate dialog can be dismissed by every route without reactivating
    Given I am on the "Deactivated" tab
    And I have noted the first agent on the current tab
    Then the Reactivate dialog should close via each of these, leaving the agent deactivated:
      | method |
      | Cancel |
      | X icon |
      | Escape |

  @positive
  Scenario: Verify that Notify on the Requires Attention tab opens a reminder for the flagged agent
    Given I am on the "Requires Attention" tab
    And I have noted the first agent on the current tab
    When I open the Notify dialog for that agent
    Then the notify dialog heading should be "Send Reminder"
    And the notify dialog should name that agent as the recipient
    And the notify dialog should offer a message preview
    And the notify dialog should offer "Cancel" and "Send Reminder"
    When I cancel the Notify dialog
    Then the notify dialog should not be visible

  @positive @e2e
  Scenario: Verify that the superadmin is guided down the right deactivation path for each agent
    Given I have found an agent holding active candidates
    When I open the Deactivate dialog for that agent
    Then the deactivate dialog should require the candidates to be transferred first
    And the confirm button should be labelled "Transfer & Deactivate"
    And the confirm button should be disabled
    When I cancel the Deactivate dialog
    And I have found an agent with no active candidates
    And I open the Deactivate dialog for that agent
    Then the deactivate dialog should not ask for a candidate transfer
    And the confirm button should be labelled "Deactivate"
    And the confirm button should be enabled
    When I cancel the Deactivate dialog
    Then that agent should still be listed on the "Active" tab

  @positive @e2e @mutates-agent @provision
  Scenario: Verify that an agent can be deactivated and re-activated again
    Given I have provisioned a throwaway agent to deactivate
    When I open the Deactivate dialog for that agent
    Then the deactivate dialog should not ask for a candidate transfer
    And the confirm button should be labelled "Deactivate"
    When I confirm the deactivation
    Then that agent should appear on the "Deactivated" tab
    And that agent should no longer be listed on the "Active" tab
    When I open the "Deactivated" agents tab
    And I open the Reactivate dialog for that agent
    And I confirm the re-activation
    Then that agent should appear on the "Active" tab
    And that agent should no longer be listed on the "Deactivated" tab
