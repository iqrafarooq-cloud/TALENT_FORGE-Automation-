#ALL PASSED
@subscription @candidate
Feature: Subscription Invoice and Payment Flow

  Background:
    Given I am logged in as a candidate

  @negative @invoice @promo
  Scenario: Verify that An invalid promo code shows an inline error and disables Apply
    When I open the invoice for the "Monthly" plan
    And I apply the promo code "INVALIDCODE99"
    Then the promo error "Invalid or expired promotion code" should be displayed
    And the "Apply" promo button should be disabled
    And the "Subtotal" amount should be "SAR 155.0"
    And the "Total due today" amount should be "SAR 155.0"
    When I modify the promo code by appending "9"
    Then the "Apply" promo button should be enabled
    And the promo error "Invalid or expired promotion code" should not be displayed

  @negative @invoice @customer
  Scenario: Verify that Continue is disabled when a required customer field is empty
    When I open the invoice for the "Monthly" plan
    Then clearing each of the following required fields should disable Continue:
      | field         |
      | First Name    |
      | Last Name     |
      | Email Address |

  @positive @negative @invoice @customer
  Scenario: Verify that First/Last name are editable and required
    When I open the invoice for the "Monthly" plan
    And I change the "First Name" field to "Tester"
    And I change the "Last Name" field to "Candidate-QA"
    Then the "First Name" field should show "Tester"
    And the "Last Name" field should show "Candidate-QA"
    When I clear the "First Name" field and move away
    Then a validation error "First Name is required" should be shown
    When I clear the "Last Name" field and move away
    Then a validation error "Last Name is required" should be shown
    And the "Continue" button should be disabled

  @positive @invoice @promo
  Scenario: Verify that A valid promo code is accepted and can be removed
    Given I am logged in as a candidate of the "unlimited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "unlimited" agent's promo code
    Then the promo code should be accepted
    And a "Remove" promo action should be available
    And the promo error "Invalid or expired promotion code" should not be displayed
    When I remove the applied promo code
    Then the promo code entry should be reset to the "Add promotion code" link

  @negative @invoice @payment @mocked
  Scenario: Verify that Gateway connection error keeps the candidate on the invoice
    Given the payment gateway is unreachable
    And I am on the invoice for the "Monthly" plan
    When I click the invoice "Continue" button
    Then I should remain on the invoice with my details retained
    And no new subscription should have been created

  @e2e @invoice @payment @negative
  Scenario: Verify that Cancelling the payment on PayTabs shows a "payment unsuccessful" error and keeps the invoice
    Given my subscription is on a plan below "Yearly"
    When I open the Subscription tab
    And I open the Change Plan modal
    And I choose the "Yearly" plan and continue
    And payment fails on PayTabs
    Then an error toast "Payment unsuccessful. Please try again" should be shown
    And I should remain on the invoice with my details retained

  @e2e @payment @negative @provision
  Scenario: Verify that An expired card is refused by the gateway and creates no subscription
    Given I am on the invoice for the "Monthly" plan
    When I click the invoice "Continue" button
    And I submit an expired card on PayTabs
    Then the PayTabs error "Card expiry is not valid" should be shown
    And I should remain on the PayTabs payment page
    When I open the Subscription tab
    Then my subscription state should be "never"

  @e2e @invoice @payment @provision
  Scenario: Verify that Continue on a completed invoice redirects to the PayTabs gateway
    When I open the invoice for the "Monthly" plan
    And I click the invoice "Continue" button
    Then I should be redirected to the PayTabs payment gateway

  @e2e @payment @provision
  Scenario: Verify that Full subscribe â†’ pay â†’ activate flow
    Given I am on the invoice for the "Monthly" plan
    When I click the invoice "Continue" button
    And I complete payment on PayTabs with the test card
    Then the success modal titled "Your Subscription is Active!" should be shown
    And the "Go to My Learning Track" CTA should be shown
    When I return to the Subscription tab from the success modal
    Then my subscription state should be "active"
    And the current plan should be "Monthly Plan"