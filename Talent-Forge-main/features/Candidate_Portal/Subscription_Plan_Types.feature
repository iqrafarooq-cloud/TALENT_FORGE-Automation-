#ALL PASSED
@subscription @candidate
Feature: Subscription Plan Types Flow

  Background:
    Given I am logged in as a candidate

  @positive @invoice @customer
  Scenario: Verify that Invoice shows correct totals and renders the customer/payment form for each plan
    Then each of the following plan invoices should show its totals and a complete customer form:
      | plan      | amount      |
      | Monthly   | SAR 155.0   |
      | Quarterly | SAR 400.0   |
      | Yearly    | SAR 1,500.0 |

  @positive @invoice @toggle
  Scenario: Verify that Yearly-upgrade toggle on the Monthly invoice recalculates the totals
    When I open the invoice for the "Monthly" plan
    Then the yearly-upgrade toggle should be visible
    And the yearly-upgrade toggle should read "Save SAR 360"
    When I switch the yearly-upgrade toggle on
    Then the invoice heading should read "Subscribe to Yearly Plan"
    And the "Subtotal" amount should be "SAR 1,500.0"
    And the "Total due today" amount should be "SAR 1,500.0"
    When I switch the yearly-upgrade toggle off
    Then the invoice heading should read "Subscribe to Monthly Plan"
    And the "Subtotal" amount should be "SAR 155.0"
    And the "Total due today" amount should be "SAR 155.0"

  @positive @invoice @toggle
  Scenario: Verify that Yearly-upgrade toggle on the Quarterly invoice reads the correct saving
    When I open the invoice for the "Quarterly" plan
    Then the yearly-upgrade toggle should be visible
    And the yearly-upgrade toggle should read "Save SAR 100"

  @positive @invoice @toggle
  Scenario: Verify that The Yearly invoice does not offer an upgrade toggle
    When I open the invoice for the "Yearly" plan
    Then the yearly-upgrade toggle should not be visible

  @positive @invoice @toggle @promo
  Scenario: Verify that Switching the yearly toggle on clears a typed promo code
    When I open the invoice for the "Monthly" plan
    And I enter the promo code "SAVE10"
    And I switch the yearly-upgrade toggle on
    Then the promo code entry should be reset to the "Add promotion code" link

