#ALL PASSED
@invite-agent @superadmin
Feature: Super Admin — Invite New Agent (Promo Code Details section)

  Background:
    Given I am logged in as the superadmin
    And I am on the "Agents" tab of User Management

  @positive
  Scenario: Verify that the promo section reveals its fields when ticked and clears them when unticked
    Given I am on the "Invite New Agent" page
    And I have filled every required field with valid details
    Then the checkbox "Add promo code for this agent" should be unchecked
    And none of the following fields should be visible:
      | field           |
      | Promo Code Name |
      | Incentive Type  |
      | Value           |
      | Expiry Date     |
      | Usage Limit     |
    When I check "Add promo code for this agent"
    Then the following fields should be visible and marked required:
      | field          |
      | Incentive Type |
      | Value          |
      | Expiry Date    |
      | Usage Limit    |
    And "Promo Code Name" should hold a non-empty auto-generated code
    And "Promo Code Name" should be read-only
    And "Incentive Type" should offer the following radio options:
      | option              |
      | Percentage Discount |
      | Fixed Amount        |
    When I have filled the promo details with a "Percentage Discount" of "20"
    And I uncheck "Add promo code for this agent"
    Then none of the following fields should be visible:
      | field          |
      | Incentive Type |
      | Value          |
      | Expiry Date    |
      | Usage Limit    |
    And the "Send Invite" button should be enabled
    # --- re-ticking brings the section back empty because unticking discards the promo details ---
    When I check "Add promo code for this agent"
    Then the following fields should be visible and marked required:
      | field          |
      | Incentive Type |
      | Value          |
      | Expiry Date    |
      | Usage Limit    |
    And "Value" should be empty
    And the "Send Invite" button should be disabled

  @positive @negative
  Scenario: Verify that the percentage discount value rules are enforced and switching incentive type re-validates
    Given I am on the "Invite New Agent" page
    And I have checked "Add promo code for this agent"
    When I select the incentive type "Percentage Discount"
    Then the "Value" field should show the suffix "%"
    # --- the field filters as it is typed, so a second decimal point never lands ---
    When I type "12.5.6" into "Value"
    And I move focus out of "Value"
    Then "Value" should hold "12.56"
    And no validation error should be displayed for "Value"
    # --- and what CAN be produced is bounded ---
    Then entering the following into "Value" should be validated as shown:
      | value | error                           |
      |     0 | Enter a valid percentage value. |
      |   0.5 |                                 |
      |     1 |                                 |
      |  12.5 |                                 |
      | 99.99 |                                 |
      |   101 | Value cannot exceed 100%.       |
      |   150 | Value cannot exceed 100%.       |
    And the "Send Invite" button should be disabled
    # --- switching re-labels the field; whether it re-checks the VALUE is the known-issues file ---
    When I select the incentive type "Fixed Amount"
    Then the "Value" field should show the suffix "SAR"

  @edge-case
  Scenario: Verify that the fixed amount value rules are enforced
    Given I am on the "Invite New Agent" page
    And I have checked "Add promo code for this agent"
    And I have selected the incentive type "Fixed Amount"
    Then the "Value" field should show the suffix "SAR"
    And typing the following should be filtered as shown:
      | field | input | retained |
      | Value |   -50 |       50 |
      | Value | abc   |          |
      | Value | 50SAR |       50 |
      | Value |   200 |      200 |
    And entering the following into "Value" should be validated as shown:
      | value   | error                           |
      |       0 | Value must be at least 1.       |
      |       1 |                                 |
      | 1000000 | Value cannot exceed 999999 SAR. |

  @edge-case
  Scenario: Verify that the usage limit rules are enforced
    Given I am on the "Invite New Agent" page
    And I have checked "Add promo code for this agent"
    Then typing the following should be filtered as shown:
      | field       | input | retained |
      | Usage Limit |  10.5 |      105 |
      | Usage Limit |   -20 |       20 |
      | Usage Limit | abc   |          |
      | Usage Limit |   5 x |        5 |
    And entering the following into "Usage Limit" should be validated as shown:
      | value | error                     |
      |     0 | Value must be at least 1. |
      |     1 |                           |
    When I enter "100" into "Usage Limit"
    And I clear "Usage Limit"
    And I move focus out of "Usage Limit"
    Then the inline error "Usage limit is required." should be displayed for "Usage Limit"

  @positive @edge-case
  Scenario: Verify that the promo expiry calendar enforces its window, keeps Apply reachable and renders correctly
    Given I am on the "Invite New Agent" page
    And I have checked "Add promo code for this agent"
    Then the "Expiry Date" placeholder should read "DD/MM/YYYY"
    When I open the "Expiry Date" calendar
    Then every date before today should be disabled
    And the previous-month navigation should be disabled at the current month
    When I scroll within the calendar popover
    Then the "Apply" button should remain visible and clickable
    When I select an expiry date 365 days from today
    Then "Expiry Date" should hold the date 365 days from today
    And "Expiry Date" should display the date as DD/MM/YYYY
    And the "Expiry Date" text colour should be "#181D27"
    And no validation error should be displayed for "Expiry Date"
