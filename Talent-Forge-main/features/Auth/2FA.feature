#ALL PASSED
@2fa @security
Feature: Two-Factor Authentication (Security tab)

  Background:
    Given the user is logged in and on the Security tab
  # ==================== CARD & WARNING STATE ====================

  Scenario: 2FA card is displayed with a status toggle
    Then the "Two-Factor Authentication" card should be visible
    And the 2FA toggle should reflect the current 2FA status

  Scenario: Red warning icon is shown while 2FA is disabled
    Given 2FA is disabled for the user
    Then a red warning icon should be displayed next to the Security tab label
    And a red warning icon should be displayed on the Two-Factor Authentication card
  # ==================== 2A. ENABLE FLOW ====================

  Scenario: Setup modal is shown when enabling 2FA
    Given 2FA is disabled for the user
    When the user toggles 2FA on
    Then the setup modal should display the authenticator instructions
    And a QR code should be displayed
    And a manual setup code should be displayed
    And the "Cancel" and "Next" buttons should be visible

  Scenario: Cancelling the setup modal keeps 2FA off
    Given 2FA is disabled for the user
    When the user toggles 2FA on
    And the user clicks "Cancel" in the 2FA modal
    Then the 2FA modal should close
    And the 2FA toggle should remain off

  Scenario: OTP entry field behavior on the enable flow
    Given 2FA is disabled for the user
    When the user toggles 2FA on
    And the user clicks "Next" in the 2FA modal
    Then the title "Enter the 6-Digit Code" should be displayed
    And there should be 6 single-digit OTP input boxes
    And the "Confirm" button should be disabled

  Scenario Outline: Confirm button state depends on number of digits entered (enable)
    Given the user is on the enable OTP step
    When the user enters "<digits>" into the OTP boxes
    Then the "Confirm" button should be <state>

    Examples:
      | digits | state    |
      |        | disabled |
      |    123 | disabled |
      |  12345 | disabled |
      | 123456 | enabled  |

  Scenario: Pasting a 6-digit code fills all boxes
    Given the user is on the enable OTP step
    When the user pastes "123456" into the OTP field
    Then all 6 OTP boxes should be filled
    And the "Confirm" button should be enabled

  Scenario: Enabling 2FA with a correct OTP
    Given the user is on the enable OTP step
    When the user enters a valid OTP and clicks "Confirm"
    Then the 2FA modal should close
    And the 2FA toggle should be on
    And the red warning icons should disappear
    And a success toast "Two factor authentication is now active." should be displayed

  Scenario: Enabling 2FA with an incorrect OTP
    Given the user is on the enable OTP step
    When the user enters an invalid OTP and clicks "Confirm"
    Then the OTP input boxes should turn red
    And the inline error "Incorrect OTP" should be displayed
    And the "Confirm" button should remain enabled
    And the 2FA toggle should remain off

  Scenario: Enabling 2FA with an expired OTP
    Given the user is on the enable OTP step
    When the user enters an expired OTP and clicks "Confirm"
    Then the inline error "Incorrect OTP" should be displayed
    And the 2FA toggle should remain off
  # ==================== 2B. DISABLE FLOW ====================

  Scenario: Confirmation modal is shown when disabling 2FA
    Given 2FA is enabled for the user
    When the user toggles 2FA off
    Then the disable confirmation message about reducing account security should be displayed
    And the "Cancel" and "Turn off 2FA" buttons should be visible

  Scenario: Disabling 2FA requires a 6-digit code before Confirm is enabled
    Given 2FA is enabled for the user
    When the user toggles 2FA off
    And the user proceeds to the disable OTP step
    And the user enters "1234" into the OTP boxes
    Then the "Confirm" button should be disabled

  Scenario: Disabling 2FA with a correct OTP
    Given 2FA is enabled for the user
    When the user toggles 2FA off
    And the user enters a valid OTP and clicks "Confirm"
    Then the 2FA toggle should be off
    And the red warning icons should reappear
    And a success toast "Two factor authentication is turned off." should be displayed

  Scenario: Disabling 2FA with an incorrect OTP keeps it on
    Given 2FA is enabled for the user
    When the user toggles 2FA off
    And the user enters an invalid OTP and clicks "Confirm"
    Then the OTP input boxes should turn red
    And the inline error "Incorrect OTP" should be displayed
    And the 2FA toggle should remain on
  # ==================== NEGATIVE / SYSTEM ====================

  @negative
  Scenario: Toggle does not change state until verification succeeds
    Given 2FA is disabled for the user
    When the user toggles 2FA on
    And the user closes the modal without verifying
    Then the 2FA toggle should remain off

  @negative
  Scenario: Global error toast is shown when the 2FA update fails
    Given the user is on the enable OTP step
    When the 2FA update request fails on submit
    Then a toast "Internal server error" should be displayed

  @login-2fa
  Scenario: 2FA prompt is shown after a successful login when 2FA is enabled
    Given a user with 2FA enabled
    When the user logs in with valid credentials
    Then the login 2FA prompt "Check your authenticator app" should be displayed
    And there should be 6 single-digit OTP input boxes
    And the user should not yet be redirected to the application

  @login-2fa
  Scenario: Confirm button state on the login 2FA prompt depends on digit count
    Given a user with 2FA enabled has logged in and is on the login 2FA prompt
    When the user enters "12345" into the OTP boxes
    Then the login 2FA prompt's submit button should be disabled
    When the user enters "123456" into the OTP boxes
    Then the login 2FA prompt's submit button should be enabled

  @login-2fa
  Scenario: Login is completed after entering a valid 2FA code
    Given a user with 2FA enabled has logged in and is on the login 2FA prompt
    When the user enters a valid OTP and clicks "Confirm"
    Then the user should be redirected to the application

  @login-2fa @negative
  Scenario: Login 2FA prompt rejects an incorrect code
    Given a user with 2FA enabled has logged in and is on the login 2FA prompt
    When the user enters an invalid OTP and clicks "Confirm"
    Then the inline error "Invalid or expired code." should be displayed
    And the user should not be redirected to the application

  @login-2fa @negative
  Scenario: Login 2FA prompt rejects an expired code
    Given a user with 2FA enabled has logged in and is on the login 2FA prompt
    When the user enters an expired OTP and clicks "Confirm"
    Then the inline error "Invalid or expired code." should be displayed
    And the user should not be redirected to the application

  @login-2fa @negative
  Scenario: User cannot bypass the login 2FA prompt by navigating away
    Given a user with 2FA enabled has logged in and is on the login 2FA prompt
    When the user attempts to navigate directly to the application
    Then the user should be sent back to the login page
    And the user should not be redirected to the application
  # ==================== 4. END-TO-END ====================

  @e2e
  Scenario: Enable 2FA, then it is enforced on the next login
    Given 2FA is disabled for the user
    When the user toggles 2FA on
    And the user clicks "Next" in the 2FA modal
    And the user enters a valid OTP and clicks "Confirm"
    Then a success toast "Two factor authentication is now active." should be displayed
    When the user logs out
    And the user logs in with valid credentials
    Then the login 2FA prompt should be displayed
    When the user enters a valid OTP and clicks "Confirm"
    Then the user should be redirected to the application

  @e2e
  Scenario: Disable 2FA, then the next login skips the 2FA prompt
    Given 2FA is enabled for the user
    When the user toggles 2FA off
    And the user enters a valid OTP and clicks "Confirm"
    Then a success toast "Two factor authentication is turned off." should be displayed
    When the user logs out
    And the user logs in with valid credentials
    Then the user should be redirected to the application
    And the login 2FA prompt should not be displayed
