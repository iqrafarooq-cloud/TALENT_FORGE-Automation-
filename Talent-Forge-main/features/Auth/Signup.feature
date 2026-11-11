#ALL PASSED
@shared-inbox @creates-accounts
Feature: Signup Page Functionality
  Background:
    Given the user navigates to the signup page

  # ==================== POSITIVE TEST CASES ====================
  Scenario: User successfully creates an account and verifies their email end-to-end
    When the user fills the signup form with valid data and a unique email
    Then the "Create Account" button should be enabled
    When the user submits the signup form
    Then the user should be taken to the email verification screen
    And the resend email button should show a countdown and be disabled
    When the user opens the verification link from the email
    Then the email verified successfully screen should be displayed

  # ==================== NEGATIVE TEST CASES ====================
  Scenario: Create Account button is disabled when all fields are empty
    Then the "Create Account" button should be disabled

  Scenario: Required-field validation errors appear when fields are cleared
    When the user enters and clears each required field
    Then a required-field validation message should be displayed
    And the "Create Account" button should be disabled

  Scenario: Invalid email format shows a validation error
    When the user enters the email "wrong-email-format" and moves out of the field
    Then the email validation error "Enter a valid email address" should be displayed
    And the "Create Account" button should be disabled

  Scenario: Weak password and mismatched confirmation are both flagged
    When the user enters password "weak" and confirm password "weak2" and blurs
    Then the password requirements error should be displayed
    And the passwords-do-not-match error should be displayed
    And the "Create Account" button should be disabled

  Scenario: Incorrect agent code does not allow signup
    When the user fills the signup form with valid data and a unique email
    And the user enters an invalid agent code "WRONGCODE"
    And the user submits the signup form
    Then an error message "Invalid agent code" should be displayed
    And the user should remain on the signup page
