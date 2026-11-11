#ALL PASSED
@forgot-password @shared-inbox @rotates-password
Feature: Forgot / Reset Password
  # ==================== NEGATIVE TEST CASES ====================

  @negative
  Scenario: Send button is disabled when the email field is empty
    Given the user is on the Forgot Password page
    When the user leaves the forgot password email empty
    Then a validation message should be displayed for the forgot email field

  @negative
  Scenario Outline: Invalid email format is rejected on the forgot password page
    Given the user is on the Forgot Password page
    When the user enters the email "<email>" on the forgot password page
    Then a validation message should be displayed for the forgot email field

    Examples:
      | email               |
      | plainaddress        |
      | user@               |
      | user.com            |
      | @domain.com         |
      | user@.com           |
      | user@domain..com    |
      | spaces in@email.com |

  @negative
  Scenario: Reset link with an invalid token shows "Link Expired"
    Given the user is on the Forgot Password page
    When the user opens a reset link with an invalid token
    Then the "Link Expired" error should be displayed on the reset page
    And the "This link has expired" error should be displayed on the reset page

  @negative @security
  Scenario Outline: Accessing an expired password reset link lands on the Link Expired page
    Given a user has a password reset link that has expired
    When the user accesses the expired reset link via "<accessMethod>"
    Then the user should be redirected to the "Link Expired" page
    And the page should display the heading "Link Expired"
    And the page should display the message "This link has expired. Please go back to the Forgot Password page and request a new one to reset your password."
    And the "Go to Forgot Password" button should be visible and enabled

    Examples:
      | accessMethod                                 |
      | clicking the link                            |
      | copying and pasting the URL into the browser |

  @negative @positive
  Scenario: The reset-password form enforces every password rule on one link
    Given the user requests a password reset for the forgot-password account
    And the user opens the password reset link from the email
    Then the Reset Password button should be disabled
    When the user enters new password "Ab1!xy" and confirmation "Ab1!xy"
    Then the password requirements checklist should be displayed
    And the Reset Password button should be disabled
    When the user enters new password "lowercase1!" and confirmation "lowercase1!"
    Then the Reset Password button should be disabled
    When the user enters new password "UPPERCASE1!" and confirmation "UPPERCASE1!"
    Then the Reset Password button should be disabled
    When the user enters new password "NoNumber!!" and confirmation "NoNumber!!"
    Then the Reset Password button should be disabled
    When the user enters new password "NoSpecial123" and confirmation "NoSpecial123"
    Then the Reset Password button should be disabled
    # weak password surfaces the requirements error
    When the user enters new password "weak" and confirmation "weak"
    Then the "doesn't meet all requirements" error should be displayed on the reset page
    And the Reset Password button should be disabled
    # mismatched confirmation surfaces inline on blur
    When the user enters new password "Tf!Reset1234aZ" and confirmation "Tf!Reset9999aZ" then blurs
    Then the "Passwords do not match" error should be displayed on the reset page
    And the Reset Password button should be disabled
    # a valid, matching password enables submit and show/hide reveals it
    When the user enters a valid new password with matching confirmation
    Then the Reset Password button should be enabled
    When the user toggles password visibility on the reset page
    Then the new password field should be visible as plain text
  # @negative @RateLimit
  # Scenario: Rapid repeat reset requests are throttled
  #   Given the user requests a password reset for the forgot-password account
  #   When the user requests a password reset for the forgot-password account
  #   Then a throttling message should be displayed
  # ==================== POSITIVE TEST CASES ====================

  @positive
  Scenario: User navigates from Login to the Forgot Password page
    Given the user navigates to the login page
    When the user clicks the "Forgot Password" link
    Then the user should be redirected to the Forgot Password page

  @positive
  Scenario: Back to Log in returns to the login page from the forgot password page
    Given the user is on the Forgot Password page
    When the user clicks the Back to Log in button
    Then the user should be returned to the login page
  # One request covers the whole check-email screen: enumeration-safe confirmation,
  # the resend control, and back-to-login — one email request instead of three.

  @positive
  Scenario: The check-email screen confirms the request and offers resend and back-to-login
    Given the user is on the Forgot Password page
    When the user enters the forgot-password account email
    And the user submits the forgot password form
    Then the check-email confirmation should be displayed
    And the enumeration-safe confirmation message should be displayed
    And the Resend Email button should be offered to request a fresh link
    When the user clicks the Back to Log in button
    Then the user should be returned to the login page

  @positive
  Scenario: Reset request accepts a case- and space-variant email
    Given the user is on the Forgot Password page
    When the user enters the email "IQRA.FAROOQ+51@BYTECORP.IO" on the forgot password page
    And the user submits the forgot password form
    Then the check-email confirmation should be displayed
  # ==================== END-TO-END ====================
  # Single lifecycle: reset succeeds, .env is updated, the used link is single-use,
  # and the new password logs in — one email request covers the full journey.

  @e2e
  Scenario: A reset link completes the flow, is single-use, and the new password works
    Given the user requests a password reset for the forgot-password account
    And the user opens the password reset link from the email
    When the user enters a valid new password with matching confirmation
    And the user submits the reset password form
    Then the password reset should succeed
    And the new password should be written to the .env file
    When the user reopens the previously used reset link
    Then the "Link Expired" error should be displayed on the reset page
    When the user logs in with the forgot-password account using the new password
    Then the login with the new password should be accepted

  @e2e @long-running
  Scenario: Resend Email delivers a fresh reset link
    Given the user requests a password reset for the forgot-password account
    Then the check-email confirmation should be displayed
    When the user waits for the resend cooldown and resends the email
    Then a new reset email should be received
