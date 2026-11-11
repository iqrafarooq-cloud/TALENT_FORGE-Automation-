#ALL PASSED
@subscription @candidate
Feature: Subscription Billing and Receipt Flow

  Background:
    Given I am logged in as a candidate

  @negative @active @billing-history
  Scenario: Verify that Non-paid billing rows have disabled receipt actions
    When I open the Subscription tab
    Then non-paid billing rows should have disabled receipt actions

  @negative @active @billing-history
  Scenario: Verify that Pending and Canceled payment rows have disabled receipt View and Download icons
    Given payment rows exist in my billing history with the statuses:
      | Pending  |
      | Canceled |
    When I open the Subscription tab
    Then the "Billing History" section should be visible
    And each of those statuses should have at least one billing row
    And every one of those rows should have disabled receipt View and Download actions
    And none of those rows should expose a receipt download link

  @subscription-tab @provision
  Scenario: Verify that Never-subscribed tab shows the paywall prompt
    When I open the Subscription tab
    Then my subscription state should be "never"
    And the "You're Not Subscribed Yet" heading should be shown
    And a "Subscribe Now" CTA should be shown
    And the "Billing History" section should not be visible
    When I click "Subscribe Now"
    Then I should be on the plan-selection screen

  @positive @active @subscription-tab
  Scenario: Verify that Active subscription tab shows the current plan details and management CTAs
    When I open the Subscription tab
    Then my subscription state should be "active"
    And the "Current Subscription" section should be visible
    And a current-plan date should be shown
    And a "Change Plan" action should be available
    And a "Cancel" action should be available

  @positive @active @billing-history @provision @payment
  Scenario: Verify that Billing history lists past payments with receipt actions
    Given I have an active "Monthly" subscription
    When I open the Subscription tab
    Then the "Billing History" section should be visible
    And the billing history table should display the following columns:
      | Date Issued |
      | Plan Type   |
      | Amount      |
      | Status      |
      | Receipt     |
    And at least one billing row should have status "Paid"
    And the "Paid" billing row should have enabled receipt View and Download actions
    And the first paid billing row Download should point to a receipt file

  @positive @active @billing-history @receipt
  Scenario: Verify that Opening a paid receipt shows the receipt viewer with zoom + download controls and info
    When I open the Subscription tab
    And I open the first paid receipt
    Then the receipt viewer should be visible
    And the receipt viewer should offer zoom in and zoom out controls
    And the receipt viewer should offer a download control
    And the receipt information panel should show the plan type and amount

  @positive @active @billing-history @receipt
  Scenario: Verify that Receipt viewer zoom controls change the rendered zoom level
    When I open the Subscription tab
    And I open the first paid receipt
    Then the receipt viewer should show a zoom level of "100%"
    When I zoom the receipt in
    Then the receipt zoom level should have increased
    When I zoom the receipt out
    Then the receipt zoom level should return to "100%"

  @positive @active @billing-history @receipt
  Scenario: Verify that Receipt viewer Download control delivers the receipt PDF
    When I open the Subscription tab
    And I open the first paid receipt
    Then the receipt viewer should be visible
    And the receipt viewer download control should deliver a valid PDF

  @e2e @active @billing-history @receipt
  Scenario: Verify that Paid receipt shows the correct amount and downloads as a valid PDF
    When I open the Subscription tab
    And I open the first paid receipt
    Then the receipt viewer should be visible
    And the receipt information should match that billing row
    And the receipt document should render without a load error
    And the receipt download should return a valid PDF
  #BUG LOGGED

  # >>> THIS SCENARIO MUST DRIVE A PAYMENT IT MADE ITSELF. <<<
  #
  # It used to open the SHARED candidate's first Paid row, and was @known-issue for M8 (the
  # receipt PDF omitting the pro-rata plan credit, so its total read Base - Discounts). But the
  # receipt PDF is generated at payment time and STORED (receipt_<id>_<date>.pdf on S3), so that
  # account's rows - all three dated 22-23 July 2026 - carry the OLD template forever and no fix
  # to the generator can ever show up in them. Measured 2026-09-09: rows #0/#1 still state
  # "Total Amount Paid $750.00" / "$200.00" against charges of SAR 354.45 / SAR 45.00, priced in
  # $ throughout. The red row was reporting a defect off a stale artifact, not off the build.
  #
  # It now provisions a fresh candidate, pays for real, and reconciles THAT payment's receipt
  # against its own billing row - which is this scenario's distinct value: every other receipt
  # scenario reconciles the PDF against the invoice/gateway evidence, this one against the GRID.
  #
  # A Monthly first-subscribe carries no pro-rata credit, so M8's own arithmetic is deliberately
  # not exercised here - it is covered where a credit actually exists ("Verify that Upgrade to a
  # higher plan with a valid promo code and pay", Subscription_Change_And_Cancel.feature) and
  # with a discount by the scenario below.
  @e2e @active @billing-history @receipt @provision @payment
  Scenario: Verify that Paid receipt PDF states the amount that was actually charged
    Given I have an active "Monthly" subscription
    When I open the Subscription tab
    And I open the first paid receipt
    Then the receipt PDF should state the same amount, plan and date as that billing row

  # >>> @known-issue REMOVED 2026-09-16: THE CURRENCY DEFECT IT CARRIED WAS NEVER A DEFECT. <<<
  #
  # This scenario was red on its LAST step only, reporting that the receipt "states every figure
  # with NO currency at all". The receipt had in fact been FIXED - the "$" was replaced with the
  # Saudi Riyal sign - but the sign is drawn as VECTOR PATHS, so no text extraction can see it and
  # the reader could only ever answer "absent". Proved by fetching REC-007557 (the very file the
  # failing run read) and comparing it with the July receipts, same template, same generator:
  #
  #   July      gid7 = "$" (U+24) + digits -> extracts "$155.00"
  #   September gid3 = " " (U+20) + digits -> extracts " 77.50", and 15 extra constructPath ops
  #             draw a 9.0x10.5 mark 5.2pt to the left of each of the 5 amounts
  #
  # The currency is therefore established structurally now (utils/pdfText.js currencyMarks), and
  # this scenario is expected to PASS. Its first 6 steps were already passing in the 2026-09-16
  # run; the 7th was replayed against that run's own receipt and passes. NOTE that is a REPLAY,
  # not a fresh end-to-end run - re-measure when a run is affordable, since one costs a live
  # signup and a real test-mode payment.
  @e2e @payment @promo @receipt @provision @owned-by-unlimited
  Scenario: Verify that Receipt PDF for a discounted first-time subscription states what was charged
    When I subscribe to the "Monthly" plan with the "unlimited" agent's promo code and pay
    Then the success modal titled "Your Subscription is Active!" should be shown
    And the gateway should have been asked for the discounted amount
    And the billing record should show the amount that was charged
    And the receipt PDF for that payment should state the amount that was charged
    And the receipt PDF for that payment should price the plan in SAR
