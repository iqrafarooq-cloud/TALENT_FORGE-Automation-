#ALL PASSED
@change-password @security @rotates-password
Feature: Change Password

  Background:
    Given I am logged in and on the Change Password modal
  # ==================== NEGATIVE TEST CASES ====================

  @negative
  Scenario: Change Password button is disabled with an empty form
    Then the "Change Password" button is disabled

  @negative
  Scenario: Current Password is required when touched and left empty
    When I touch and leave the "Current Password" field empty
    Then the "Current Password" field is marked invalid
    And the inline error "Current password is required." is displayed
    And the "Change Password" button is disabled

  @negative
  Scenario: Incorrect Current Password is rejected on submit
    When I enter an incorrect current password
    And I enter a valid new password and matching confirmation
    And I click "Change Password"
    Then the modal remains open
    And the inline error "The current password you entered is incorrect." is displayed
    And the "Change Password" button is disabled

  @negative
  Scenario: New Password that does not meet requirements keeps submit disabled
    When I enter the correct current password
    And I enter the weak new password "abc"
    Then the password requirements tooltip lists all five rules
    And the "New Password" field is marked invalid
    And the "Change Password" button is disabled

  @negative
  Scenario: New Password same as Current Password is blocked
    When I enter the correct current password
    And I enter a new password equal to the current password
    And I confirm with the same value
    Then the inline error "New password must be different from your current password." is displayed
    And the "Change Password" button is disabled

  @negative
  Scenario: Re-enter Password does not match
    When I enter the correct current password
    And I enter a valid new password
    And I enter a different confirmation and blur
    Then the "Re-enter Password" field is marked invalid
    And the inline error "Passwords do not match." is displayed
    And the "Change Password" button is disabled

  @negative
  Scenario: Re-enter Password left empty keeps submit disabled
    When I enter the correct current password
    And I enter a valid new password
    And I leave the confirmation empty and blur
    Then no "Passwords do not match." error is shown
    And the "Change Password" button is disabled

  @negative @server-error
  Scenario: Server error during password update keeps the modal open
    When I enter the correct current password
    And I enter a valid new password and matching confirmation
    And the change-password API will fail with a server error
    And I click "Change Password"
    Then the modal remains open
    And I am not logged out
    And all entered password values are preserved

  @navigation
  Scenario: Forgotten your password link opens the reset flow
    When I click "Forgotten your password?"
    Then I am redirected to the Forgot Password page
  # ==================== POSITIVE TEST CASES ====================

  @positive
  Scenario: Show/Hide toggle reveals and masks every field
    When I reveal all three password fields
    Then all three password fields are shown as plain text
    When I hide all three password fields
    Then all three password fields are masked

  @positive
  Scenario: Cancel discards input and closes the modal
    When I enter the correct current password
    And I enter a valid new password and matching confirmation
    When I click "Cancel"
    Then the modal closes
    And I remain logged in on the Security tab
  # ==================== END-TO-END ====================

  @e2e @positive @negative @last-updated
  Scenario: Full password-change lifecycle — success, logout, old password fails, last-updated refreshes, and restore
    When I enter the correct current password
    And I set a new valid password different from the current one
    And I click "Change Password"
    Then a success toast "Password updated successfully." is displayed
    And I am logged out and redirected to the login page
    When I log in with the original password
    Then the login is rejected
    When I log in with the new password
    Then the login is accepted
    When I open the Security tab in Account Settings
    Then the Password card shows today's date as the last updated date
    When I change the password back to the original from Account Settings
    Then a success toast "Password updated successfully." is displayed
    And I am logged out and redirected to the login page
    When I log in with the original password
    Then the login is accepted