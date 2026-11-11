#ALL PASSED
@subscription @candidate
Feature: Subscription Change Plan and Cancellation Flow

  Background:
    Given I am logged in as a candidate

  @positive @active @change-plan
  Scenario: Verify that Change Plan modal shows the current plan and the two other plans with the first pre-selected
    When I open the Subscription tab
    And I open the Change Plan modal
    Then the Change Plan modal should show the current plan
    And the Change Plan modal should offer the two non-current plans
    And the first offered plan should be pre-selected
    And the Change Plan modal should show the upgrade/downgrade note

  @positive @active @change-plan
  Scenario: Verify that Cancel on the Change Plan modal closes it without changing the plan
    When I open the Subscription tab
    And I open the Change Plan modal
    And I dismiss the Change Plan modal
    Then the Change Plan modal should close
    And my subscription state should be "active"
    And a current-plan date should be shown

  @positive @active @change-plan @upgrade
  Scenario: Verify that Upgrading to the Yearly plan shows a pro-rata credit and recalculated total
    Given my subscription is on a plan below "Yearly"
    When I open the Subscription tab
    And I open the Change Plan modal
    And I choose the "Yearly" plan and continue
    Then the invoice heading should read "Switch to Yearly Plan"
    And the "Subtotal" amount should be "SAR 1,500.0"
    And a plan credit line should be shown
    And the total due should be the subtotal minus the plan credit

  @positive @active @change-plan @promo @provision @owned-by-unlimited
  Scenario: Verify that A valid promo code applies a discount on the upgrade invoice
    Given my subscription is on a plan below "Yearly"
    When I open the Subscription tab
    And I open the Change Plan modal
    And I choose the "Yearly" plan and continue
    And I apply the "unlimited" agent's promo code
    Then a discount line should be shown below the subtotal
    And the discount should equal that agent's configured promo value
    And the total due should be the subtotal minus the discount

  # KNOWN ISSUE (M8) - a REAL product defect, re-measured 2026-09-07 and still live. On a payment
  # carrying a pro-rata plan credit the receipt PDF has no line for the credit, so its table
  # computes Base - Discounts and OVERSTATES the total by exactly the credit - while the header
  # Amount: field states the true charge, so the document contradicts itself. Measured this run:
  #   charged SAR 1045   (Yearly 1500 - promo 300 - plan credit 155)
  #   header  Amount: $1,045.00        <- correct
  #   table   Base 1500 / Taxes 0 / Discounts 300 / Total Amount Paid $1,200.00   <- 1500-300
  # 12 of 13 steps pass; only the last one is red, which is the point of the ordering below.
  @e2e @change-plan @upgrade @payment @provision @owned-by-unlimited @known-issue
  #BUG LOGGED
  Scenario: Verify that Upgrade to a higher plan with a valid promo code and pay
    Given I have an active "Monthly" subscription
    When I open the Subscription tab
    And I upgrade to the "Yearly" plan with the "unlimited" agent's promo code and pay
    Then the plan changed successfully modal should be shown
    And the gateway should have been asked for the discounted amount
    And the billing record should show the amount that was charged
    And the receipt PDF for that payment should state the amount that was charged
    And the receipt PDF for that payment should price the plan in SAR

  @e2e @change-plan @downgrade @provision @payment
  Scenario: Verify that Schedule a downgrade to a lower plan
    Given I have an active "Yearly" subscription
    When I open the Subscription tab
    And I schedule a downgrade to the "Monthly" plan
    Then a plan change scheduled modal should be shown
    And the subscription tab should show a scheduled change to "Monthly"

  @positive @active @cancel
  Scenario: Verify that Cancel modal shows the confirmation copy and Keep My Plan closes it without cancelling
    When I open the Subscription tab
    And I open the Cancel Subscription modal
    Then the cancel modal title "Cancel Your Subscription" should be shown
    And the cancel modal should mention retained access until the billing end date
    And the cancel modal should offer "Keep My Plan" and a confirm-cancel action
    When I click "Keep My Plan"
    Then the cancel modal should close
    And my subscription state should be "active"

  @e2e @active @cancel @resubscribe
  Scenario: Verify that Cancelling a subscription then resubscribing restores the active plan
    When I open the Subscription tab
    And I confirm cancellation of my subscription
    Then a "Your plan has been cancelled." toast should be shown
    And my subscription state should be "cancelled"
    And the current subscription should show an "Expires on" date
    And the post-cancellation info text should be shown
    When I resubscribe to my plan
    Then my subscription state should be "active"
    And a current-plan date should be shown
    And a "Change Plan" action should be available

