@agent-management @superadmin @agent-profile-candidates
Feature: SuperAdmin User Management - the agent profile's Candidates tab

  

  Background:
    Given I am logged in as the superadmin

  # ==================== 1. THE GRID ====================

  @positive @smoke
  Scenario: Verify that the Candidates tab lists the agent's candidates with its columns, checkboxes and row actions
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    Then the profile Candidates tab should show the columns:
      | Candidate            |
      | Account Verification |
      | Account Status       |
      | Pending Documents    |
      | Subscription Status  |
      | Last Activity        |
      | Actions              |
    And every row on the profile Candidates tab should offer a "Select candidate" checkbox and these actions:
      | action    | testid                                              |
      | View      | admin-agent-profile-candidates-view-button          |
      | Edit      | admin-agent-profile-candidates-edit-email-button    |
      | Open menu | admin-agent-profile-candidates-actions-menu-button  |

  @positive
  Scenario: Verify that every cell on the Candidates tab shows what the server holds for that candidate
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    Then every row on the profile Candidates tab should show what the server returned for that candidate

  # ==================== 2. THE ROW MENU ====================

  @positive
  Scenario: Verify that an active candidate's row menu offers Reassign candidate and Deactivate
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    Then that candidate's row menu should offer exactly:
      | Reassign candidate |
      | Deactivate         |

  @positive
  Scenario: Verify that Reassign candidate from the row menu describes that one candidate and reassigns nothing when left
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I start recording what the profile Candidates tab sends
    And I open Reassign candidate from that candidate's row menu
    Then the Reassign dialog should name that candidate and the agent and lock the university to the agent's own
    And the Reassign dialog should keep "Reassign" disabled until a new agent is chosen
    And leaving the Reassign dialog each of these ways should reassign nothing:
      | way    |
      | Cancel |
      | X icon |
      | Escape |

  @positive
  Scenario: Verify that Deactivate from the row menu opens the candidate deactivation dialog and Cancel changes nothing
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I start recording what the profile Candidates tab sends
    And I open Deactivate from that candidate's row menu
    Then the Deactivate Candidate Account dialog should name that candidate and require a reason
    When I cancel the candidate lifecycle dialog
    Then the candidate's account status should be unchanged and nothing should have been sent

  @positive
  Scenario: Verify that a deactivated candidate offers Reactivate, not Deactivate, and its Edit is disabled
    Given I have opened the Candidates tab of an agent who holds a deactivated candidate
    Then that candidate's row menu should offer exactly:
      | Reassign candidate |
      | Reactivate         |
    And that candidate's Edit action should be disabled
    When I start recording what the profile Candidates tab sends
    And I open Reactivate from that candidate's row menu
    Then the Reactivate Account dialog should name that candidate
    When I cancel the candidate lifecycle dialog
    Then the candidate's account status should be unchanged and nothing should have been sent

  @negative @known-issue
  Scenario: Verify that a deactivated candidate's Account Status is worded as on the Candidates listing
    Given I have opened the Candidates tab of an agent who holds a deactivated candidate
    Then that deactivated candidate's Account Status should read "Deactivated", as on the Candidates listing

  # ==================== 3. PAGINATION AND SEARCH ====================

  @positive
  Scenario: Verify that the Candidates tab pages through the agent's candidates and a search starts again at page 1
    Given I have opened the Candidates tab of an agent with more than one page of candidates
    When I go to the next page of the profile Candidates tab
    Then it should have asked the server for page 2 and show exactly what came back
    And the pager should mark page 2 as current and disable "Next Page" on the last page
    When I search the profile Candidates tab for the first letter of a listed name
    Then the search should have asked the server for page 1
    And after a reload the profile should reopen on its Candidates tab at page 1

  @edge-case
  Scenario: Verify that a search of only spaces is not sent and leaves the list as it was
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    When I type only spaces into the profile Candidates search
    Then no search should be sent and the list should be unchanged

  # ==================== 4. EDIT -> UPDATE EMAIL ADDRESS ====================

  @positive
  Scenario: Verify that Edit on the Candidates tab opens the candidate Update Email Address modal with the current address locked
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I open the Update Email Address modal for that record
    Then the modal heading should be "Update Email Address"
    And the modal should show the fields:
      | Current Email     |
      | New Email Address |
      | Confirm New Email |
    And the current email address should be that record's email
    And the current email address field should not be editable
    And the New and Confirm email fields should be empty
    And the modal primary button should read "Update"
    And the modal "Update" button should be disabled
    And the modal should offer "Cancel" and "Update"

  @negative
  Scenario: Verify that the Candidates tab modal refuses every invalid combination with its own message
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I open the Update Email Address modal for that record
    Then each invalid email combination should be refused with its own message:
      | newEmail               | confirmEmail           | message                             |
      | notanemail             | notanemail             | Please enter a valid email address. |
      | no@domain              | no@domain              | Please enter a valid email address. |
      | valid.one@bytecorp.io  | valid.two@bytecorp.io  | The emails do not match.            |
      | THE RECORD'S OWN EMAIL | THE RECORD'S OWN EMAIL | New email must be different.        |
    And the modal "Update" button should be disabled

  @edge-case
  Scenario: Verify that empty, whitespace and half-filled addresses keep Update disabled on the Candidates tab
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I open the Update Email Address modal for that record
    And I enter "" as the new email and "" as the confirmation
    Then the modal "Update" button should be disabled
    And no inline error should be shown in the modal
    When I enter "   " as the new email and "   " as the confirmation
    Then the modal "Update" button should be disabled
    When I enter "qa.partial@bytecorp.io" as the new email and "" as the confirmation
    Then the modal "Update" button should be disabled
    When I enter "QA.Cand.Case@BYTECORP.IO" as the new email and "qa.cand.case@bytecorp.io" as the confirmation
    Then the modal should not show the inline error "The emails do not match."
    And the modal "Update" button should be enabled

  @positive
  Scenario: Verify that Cancel, the X icon and Escape each close the Candidates tab modal and change nothing
    Given I have opened the Candidates tab of an agent whose candidates fit on one page
    And I have noted the first active candidate on that Candidates tab with no email change pending
    When I open the Update Email Address modal for that record
    And I enter "qa.cand.discarded@bytecorp.io" as the new email and "qa.cand.discarded@bytecorp.io" as the confirmation
    And I cancel the Update Email Address modal
    Then the Update Email Address modal should not be visible
    When I open the Update Email Address modal for that record
    And I enter "qa.cand.discarded@bytecorp.io" as the new email and "qa.cand.discarded@bytecorp.io" as the confirmation
    And I close the Update Email Address modal with the X icon
    Then the Update Email Address modal should not be visible
    When I open the Update Email Address modal for that record
    Then the New and Confirm email fields should be empty
    When I dismiss the Update Email Address modal with Escape
    Then the Update Email Address modal should not be visible
    And that record should still be listed with the original email address

  @positive @e2e @mutates-email @provision
  Scenario: Verify that an email change made from the Candidates tab is held pending and completes once verified
    Given I have provisioned a throwaway candidate and opened its agent's Candidates tab
    When I open the Update Email Address modal for that record
    And I change that record's email to a fresh address on the test inbox
    Then the update should be accepted with the message "Verification email sent to the new address."
    And the Update Email Address modal should not be visible
    And the listing should show that address in red with a warning icon
    And the listing should still show the original address as the live one
    And the server should record the new address as pending verification
    When I open the Update Email Address modal for that record
    Then the modal should say an email update is already pending
    And the pending notice should name the live address and the pending one
    When I cancel the Update Email Address modal
    Then a verification email should be delivered to the new address
    When the recipient opens the verification link
    Then the verification page should confirm the address is now active
    And the listing should show the new address with no pending marker
