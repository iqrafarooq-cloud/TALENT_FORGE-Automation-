#ALL PASSED
@candidate-management @superadmin
Feature: SuperAdmin User Management - Candidates (Deactivate, Reactivate)

  Background:
    Given I am logged in as the superadmin
    And I am on the Candidates listing
  # ==================== THE DEACTIVATE DIALOG ====================

  @positive
  Scenario: Verify that the Deactivate dialog states what deactivation will do
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    Then the deactivate candidate dialog heading should be "Deactivate Candidate Account"
    And the deactivate candidate dialog should name that candidate
    And the deactivate candidate dialog should promise:
      | Prevent the user from logging in          |
      | Pause any active subscriptions            |
      | All user data will remain in the system   |
      | Allow the account to be reactivated later |
    And the deactivate candidate dialog should ask for a reason
    And the deactivate candidate confirm button should be labelled "Deactivate Account"
    And the deactivate candidate confirm button should be disabled
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible
    And that candidate should still be listed on the "Active" tab

  @positive
  Scenario: Verify that the reason list offers every documented reason
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    Then the deactivation reasons offered should be:
      | User requested closure |
      | Policy violation       |
      | Temporary hold         |
      | Duplicate account      |
      | Fraudulent activity    |
      | Other                  |
    And no deactivation reason should be selected to begin with
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible

  @negative
  Scenario: Verify that no candidate can be deactivated without a reason
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    Then the deactivate candidate confirm button should be disabled
    When I choose the deactivation reason "Temporary hold"
    Then the deactivate candidate confirm button should be enabled
    When I clear the deactivation reason
    Then the deactivate candidate confirm button should be disabled
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible

  @positive
  Scenario: Verify that each reason enables confirmation, and that Other alone asks for more
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    Then each deactivation reason should gate confirmation as follows:
      | reason                 | asksForMore | confirmEnabled |
      | User requested closure | no          | yes            |
      | Policy violation       | no          | yes            |
      | Temporary hold         | no          | yes            |
      | Duplicate account      | no          | yes            |
      | Fraudulent activity    | no          | yes            |
      | Other                  | yes         | no             |
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible

  @negative
  Scenario: Verify that the Other reason refuses an empty or whitespace-only explanation
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    And I choose the deactivation reason "Other"
    Then the deactivate candidate dialog should ask me to specify the reason
    And the deactivate candidate confirm button should be disabled
    Then the free-text reason should refuse each of these and accept the last:
      | text            | accepted |
      |                 | no       |
      | <spaces>        | no       |
      | a               | yes      |
      | Duplicate entry | yes      |
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible

  @edge-case
  Scenario: Verify that reopening the Deactivate dialog starts clean rather than remembering
    Given I have noted the first candidate on the "Active" tab
    When I open the Deactivate dialog for that candidate
    And I choose the deactivation reason "Other"
    And I type "left over from the previous attempt" as the free-text reason
    And I cancel the Deactivate dialog for that candidate
    And I open the Deactivate dialog for that candidate
    Then no deactivation reason should be selected to begin with
    And the deactivate candidate dialog should not ask me to specify the reason
    And the deactivate candidate confirm button should be disabled
    When I cancel the Deactivate dialog for that candidate
    Then the deactivate candidate dialog should not be visible

  @positive
  Scenario: Verify that leaving the Deactivate dialog by any route leaves the candidate active
    Given I have noted the first candidate on the "Active" tab
    Then leaving the Deactivate dialog by each of these should change nothing:
      | method |
      | Cancel |
      | X icon |
      | Escape |
    And that candidate should still be listed on the "Active" tab
    And that candidate should not be listed on the "Deactivated" tab
  # ==================== THE REACTIVATE DIALOG ====================

  @positive
  Scenario: Verify that Reactivate on the Deactivated tab offers to restore the candidate's access
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    When I open the Reactivate dialog for that candidate
    # The dialog was renamed "Re-activate Account" (measured 2026-10-26); the row action that
    # opens it is still "Reactivate Account".
    Then the reactivate candidate dialog heading should be "Re-activate Account"
    And the reactivate candidate dialog should name that candidate and their email
    And the reactivate candidate dialog should say the candidate regains access instantly
    And the reactivate candidate dialog should say a reactivation email will be sent
    And the reactivate candidate dialog should offer "Cancel" and "Re-activate Account"
    When I cancel the Reactivate dialog for that candidate
    Then the reactivate candidate dialog should not be visible
    And that candidate should still be listed on the "Deactivated" tab

  @edge-case
  Scenario: Verify that reactivation asks for no reason, unlike deactivation
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    When I open the Reactivate dialog for that candidate
    Then the reactivate candidate dialog should ask for no reason
    And the reactivate candidate confirm button should be enabled
    When I cancel the Reactivate dialog for that candidate
    Then the reactivate candidate dialog should not be visible
  # ==================== WHICH ACTION EACH TAB OFFERS ====================

  @negative
  Scenario: Verify that neither lifecycle action is offered where it makes no sense
    Then each candidates tab should offer only the lifecycle action that applies:
      | tab         | offers             | withholds          |
      | Active      | Deactivate account | Reactivate Account |
      | Deactivated | Reactivate Account | Deactivate account |

  @edge-case @needs-clarification
  Scenario: Verify that Edit is rendered but not usable on the Deactivated tab
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    Then that candidate's row should offer the "Edit" action
    And every Deactivated row's "Edit" action should be disabled
    And that candidate's row should offer the "Reactivate Account" action
  @negative
  Scenario: Verify that pressing a deactivated candidate's disabled Edit opens nothing and sends nothing
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    Then pressing that candidate's disabled Edit should open nothing and send nothing

  @edge-case
  Scenario: Verify that a deactivated candidate's Edit stays disabled when found by search and on the All tab
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    When I search the candidates for that candidate's full email
    Then every Deactivated row's "Edit" action should be disabled
    And that deactivated candidate's Edit should be disabled on the All tab too

  @positive
  Scenario: Verify that Edit is enabled on every active candidate's row
    Given I am on the "Active" candidates tab
    Then every "Active" row's "Edit" action should be enabled

  @positive
  Scenario: Verify that a deactivated candidate can still be viewed
    Given I am on the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    Then View should still open that candidate in the drawer

  # ==================== END TO END - THE ONES THAT COMMIT ====================
  # Both run on a seeded uat.candidate<N>@talentforge.test account (candidateLifecycleGuard), which
  # is undeliverable, and the @mutates-candidate After hook reactivates it if a run dies half way.

  @negative @mutates-candidate
  Scenario: Verify that a deactivation the server refuses is reported and leaves the candidate active
    Given I have found a seeded candidate that is safe to deactivate
    And every change the candidates page sends will fail with a server error
    When I open the Deactivate dialog for that candidate
    And I choose the deactivation reason "Temporary hold"
    And I confirm the candidate deactivation expecting it to fail
    Then the failed deactivation should be reported and the candidate left active

  @positive @e2e @mutates-candidate
  Scenario: Verify that a deactivated candidate loses Edit, stays viewable, and gets Edit back once reactivated
    Given I have found a seeded candidate that is safe to deactivate
    Then that candidate's Edit should be "enabled" on the "Active" tab
    When I open the Deactivate dialog for that candidate
    And I choose the deactivation reason "Other"
    And I type "Automation round trip" as the free-text reason
    And I confirm the candidate deactivation
    Then that candidate should appear on the "Deactivated" tab
    And that candidate's Edit should be "disabled" on the "Deactivated" tab
    And that deactivated candidate's Edit should be disabled on the All tab too
    And View should still open that candidate in the drawer
    When I go to the "Deactivated" tab and open the Reactivate dialog for that candidate
    And I confirm the candidate reactivation
    Then that candidate should appear on the "Active" tab
    And the server should report that candidate as active
    And that candidate's Edit should be "enabled" on the "Active" tab


  @positive @e2e @mutates-candidate
  Scenario: Verify that a candidate can be deactivated with a reason and reactivated again
    Given I have found a seeded candidate that is safe to deactivate
    When I open the Deactivate dialog for that candidate
    And I choose the deactivation reason "Temporary hold"
    Then the deactivate candidate confirm button should be enabled
    When I confirm the candidate deactivation
    Then that candidate should appear on the "Deactivated" tab
    And that candidate should no longer be listed on the "Active" tab
    And the server should report that candidate as deactivated
    When I open the Reactivate dialog for that candidate
    Then the reactivate candidate confirm button should be enabled
    When I confirm the candidate reactivation
    Then that candidate should appear on the "Active" tab
    And that candidate should no longer be listed on the "Deactivated" tab
    And the server should report that candidate as active
