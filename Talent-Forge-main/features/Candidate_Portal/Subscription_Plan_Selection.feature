#ALL PASSED
@subscription @candidate
Feature: Subscription Plan Selection Flow

  Background:
    Given I am logged in as a candidate

  @positive @plan-selection
  Scenario: Verify that Plan-selection screen shows the three plans with pricing, badges and card copy
    When I open the subscription plans screen
    Then the following plans should be displayed:
      | plan      | price     | frequency                               |
      | Monthly   | SAR 155   | Billed monthly · 12 payments/year       |
      | Quarterly | SAR 400   | Billed every 3 months · 4 payments/year |
      | Yearly    | SAR 1,500 | Billed once a year                      |
    And the "Quarterly" plan should show the badge "Most Popular"
    And the "Yearly" plan should show the badge "Best Value"
    And the "Quarterly" plan should show a savings percentage
    And the "Yearly" plan should show a savings percentage
    And the "Monthly" plan card should contain "Cancel anytime"
    And the "Quarterly" plan card should contain "14% savings"
    And the "Yearly" plan card should contain "19.4% savings"

  @positive @plan-selection
  Scenario: Verify that Selecting a plan opens that plan's invoice
    When I open the subscription plans screen
    Then selecting each of the following plans should open its own invoice:
      | plan      |
      | Monthly   |
      | Quarterly |
      | Yearly    |

  @positive @plan-selection @navigation
  Scenario: Verify that Back from the invoice returns to the plan-selection screen
    When I open the invoice for the "Monthly" plan
    And I click the invoice Back button
    Then I should be on the plan-selection screen

