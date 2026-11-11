#ALL PASSED 
@login
Feature: Login Page Functionality

  Background:
    Given the user navigates to the login page
  # ==================== NEGATIVE TESTS ====================
  Scenario: Login button is enabled only when both fields are valid
    When the user fills the login form with each of these field combinations:
      | email            | password       | state    |
      | user@bytecorp.io |                | disabled |
      |                  | StrongPass123! | disabled |
      |                  |                | disabled |
      | user@bytecorp.io | StrongPass123! | enabled  |
    Then the login button should have matched the expected state for every combination

  Scenario: Inline errors appear when email and password are entered and then removed
    When the user enters valid email and password and removes both
    Then the inline validation message "Email is required" should be visible
    And the inline validation message "Password is required" should be visible

  Scenario: Invalid credentials are rejected with a generic error
    When the user attempts to log in with each of these credential sets:
      | email                     | password       |
      | wrong.user@bytecorp.io    | StrongPass123! |
      | faran.mustafa+1@bytecorp.io | WrongPassword! |
      | nonexistent@anonaddy.me   | StrongPass123! |
      | wrong@example.com         | WrongPass@123  |
    Then every credential set should have been rejected with a generic error on the login page

  Scenario: Invalid email format shows inline error
    When the user attempts to log in with each of these malformed emails:
      | email               |
      | plainaddress        |
      | user@               |
      | user.com            |
      | @domain.com         |
      | missing@domain      |
      | spaces in@email.com |
      | user@.com           |
      | user@domain..com    |
    Then every malformed email should have been rejected without submitting the form
  # ==================== POSITIVE TESTS ====================

  Scenario: Password is masked by default and the toggle reveals then hides it
    When the user enters password "StrongPass123!"
    Then the password field should be masked
    When the user taps the password show/hide toggle
    Then the password field should be visible as plain text
    When the user taps the password show/hide toggle
    Then the password field should be masked

  Scenario: Successful login shows a success message and redirects to the dashboard
    When the user enters the base account email
    And the user enters the base account password
    And the user clicks the login button
    Then a success message should be displayed
    And user should be redirected

  Scenario: User navigates to Forgot Password page
    When the user clicks the "Forgot Password" link
    Then the user should be redirected to the Forgot Password page

  Scenario: User navigates to Sign Up page
    When the user clicks the "Sign Up" link
    Then the user should be redirected to the Sign Up page

  Scenario: Google Sign In opens OAuth popup
    When the user clicks the "Continue with Google" button
    Then the Google authentication popup should be displayed

  Scenario: User can log out successfully
    When the user enters the base account email
    And the user enters the base account password
    And the user clicks the login button
    And the user opens the profile menu
    And the user clicks the logout option
    Then the user should be redirected to the login page
    And the user should not be authenticated
