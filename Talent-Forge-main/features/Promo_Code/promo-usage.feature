@promo-lifecycle
Feature: Promo Code Lifecycle — Usage and Expiry

  # The warning icon is for a DATE-EXPIRED promo only (product rule, confirmed 2026-10-19). An
  # exhausted promo reads "Inactive" and shows NO icon - measured on throwaway CODE6NXP4UO
  # (2 of 2 uses): no icon on the Promo Tools tab or the "Code Parameters" heading. This scenario
  # used to assert the icon (TFF-43 §9.2 wording) and was @known-issue for it; it now asserts the
  # absence. The Expired case keeps its icon assertion in the expiry scenarios.
  @positive @consumes-promo
  Scenario: Verify that Total Usage counts every redemption and Revenue Generated sums exactly what those candidates were charged
    Given a throwaway agent holds a promo code with a usage limit of 2
    And the "throwaway" agent's unread in-app notifications are cleared
    And the superadmin's unread in-app notifications are cleared
    And the superadmin opens the "throwaway" agent's Promo Tools tab
    And I have noted the superadmin "Total Usage" for that agent's promo
    Then that agent's promo should show no usage and no revenue yet
    When a candidate of that agent subscribes to the "Monthly" plan using its promo code and pays
    Then the superadmin "Total Usage" for that agent's promo should count every redemption so far
    And the superadmin "Revenue Generated" for that agent's promo should equal the total charged so far
    When a candidate of that agent subscribes to the "Quarterly" plan using its promo code and pays
    Then the superadmin "Total Usage" for that agent's promo should count every redemption so far
    And the superadmin "Revenue Generated" for that agent's promo should equal the total charged so far
    And the superadmin Promo Tools tab should show the promo as no longer usable
    And the promo code should not show a warning icon on that agent's Promo Tools tab
    When another candidate of that agent has signed up but not subscribed
    And I open the invoice for the "Monthly" plan
    And I apply the "throwaway" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And the "Apply" promo button should be disabled
    And the invoice should not show an applied promo code
    And no discount line should be shown
    And the total due should equal the subtotal
    And the following "promo expired" notifications should be delivered:
      | recipient  | channel |
      | agent      | in-app  |
      | superadmin | in-app  |
      | agent      | email   |
    And every redemption should have been charged the discounted amount at the gateway
    And every redemption's billing record should state the discounted amount
    And every redemption's receipt PDF should state the discounted amount
    And every redemption's receipt PDF should price the plan in SAR

  # @negative @known-issue
  # Scenario: Verify that expiring a promo code notifies both the superadmin and its agent
  #   Given the "limited" agent's unread in-app notifications are cleared
  #   And the superadmin's unread in-app notifications are cleared
  #   And the superadmin has backdated that agent's promo code so its expiry date has passed
  #   Then the superadmin Promo Tools tab should show the status "Expired"
  #   And the following "promo expired" notifications should be delivered:
  #     | recipient  | channel |
  #     | agent      | in-app  |
  #     | superadmin | in-app  |
  #     | agent      | email   |

  @positive @not-automatable
  Scenario: Verify that both the superadmin and the agent are warned in advance of expiry and of the 80% threshold
    Given an agent holds an active promo code
    Then the superadmin and that agent should each be warned in advance of:
      | trigger                                   | notification            |
      | the promo code is two weeks from expiring | expiry reminder         |
      |         80% of the usage limit is reached | usage threshold warning |

  @edge-case @not-automatable
  Scenario: Verify that agents whose promo codes expire on the same day are notified individually
    Given two agents hold promo codes expiring on the same date
    When that expiry date passes
    Then each agent should receive their own notification
    And the superadmin should receive one notification per agent

  @negative
  Scenario: Verify that only a candidate of the owning agent can redeem its promo code
    Given I am logged in as a candidate
    And that candidate does not belong to the "unlimited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "unlimited" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And no discount line should be shown
    And the total due should equal the subtotal

  @negative
  Scenario: Verify that a disabled promo code shows the same inline error as any other invalid code
    Given the superadmin has disabled the "limited" agent's promo code
    And I am logged in as a candidate of the "limited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And the "Apply" promo button should be disabled
    And the invoice should not show an applied promo code
    And no discount line should be shown
    And the total due should equal the subtotal

  @edge-case
  Scenario: Verify that a malformed promo code is either accepted or refused, never half-applied
    Given I am logged in as a candidate of the "unlimited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "unlimited" agent's promo code
    Then applying each of these promo code variants should leave the applied state and the total in agreement:
      | variant            |
      | lower case         |
      | padded with spaces |

  @negative
  Scenario: Verify that the Apply button is gated while the promo field is empty
    Given I am logged in as a candidate
    When I open the invoice for the "Monthly" plan
    Then the "Apply" promo button should be disabled while the promo field is empty

  @positive
  Scenario: Verify that a promo discounts, stops when disabled, and discounts again when re-enabled
    Given I am logged in as a candidate of the "limited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo code should be accepted
    And the discount should equal that agent's configured promo value
    And the total due should be the subtotal minus the discount
    When the superadmin has disabled that agent's promo code
    Then the superadmin Promo Tools tab should show the status "Disabled"
    When I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And no discount line should be shown
    And the total due should equal the subtotal
    When the superadmin re-enables that agent's promo code
    Then the superadmin Promo Tools tab should show the status "Active"
    When I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo code should be accepted
    And the discount should equal that agent's configured promo value
    And the total due should be the subtotal minus the discount

  @positive
  Scenario: Verify that a promo expires, stops discounting, and works again once its expiry date is restored
    Given the superadmin has backdated the "limited" agent's promo code so its expiry date has passed
    Then the superadmin Promo Tools tab should show the status "Expired"
    And the promo code should show a warning icon on that agent's Promo Tools tab
    When I am logged in as a candidate of the "limited" promo agent
    And I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And no discount line should be shown
    And the total due should equal the subtotal
    When the superadmin changes that agent's expiry date to 60 days from today
    Then the superadmin Promo Tools tab should show the status "Active"
    And the "Expiry Date" should be the new date and not the previous one
    When I open the invoice for the "Monthly" plan
    And I apply the "limited" agent's promo code
    Then the promo code should be accepted
    And the discount should equal that agent's configured promo value
    And the total due should be the subtotal minus the discount

  # >>> ITS 10 STEPS ARE UNWRITTEN, AND @not-implemented SAYS SO RATHER THAN PRETENDING OTHERWISE.
  #
  # This is pre-existing - the pre-migration baseline reports the same 1 undefined scenario / 10
  # undefined steps - but the two runners answer it differently. Cucumber reports `undefined` and
  # moves on, so it sat in the default profile asserting nothing. playwright-bdd's
  # `missingSteps: 'fail-on-gen'` REFUSES TO GENERATE the whole suite over it, so it had to be
  # named before any area could be registered.
  #
  # It is NOT @not-automatable, and the distinction is deliberate. In this repo that tag means a
  # state reachable only through the DB, a cron job or time-travel, and its steps are `pending`
  # stubs; this scenario is ordinarily automatable and every helper it needs already exists -
  # promo-usage's own exhaustion scenario mints a throwaway agent with a usage limit, redeems it
  # with candidates of that agent, and polls the banner. Tagging it @not-automatable would file a
  # coverage gap as a product limitation and add it to `npm run test:not-automatable`, which
  # reviews a different class of thing entirely.
  #
  # TO IMPLEMENT: mint a throwaway agent whose promo has a usage limit of 1
  # (provisionPromoAgent), redeem it once with a candidate OF THAT AGENT - redemption is
  # ownership-scoped - then raise the limit to 2 and extend the expiry through
  # AdminPromoToolsPage, and redeem again with a second candidate. Cost per run is 1 live agent
  # invite, 2 candidate signups over IMAP and 2 REAL test-mode payments, so it also earns
  # @provision and @consumes-promo, the latter keeping it out of every default run.
  @promo @regression @not-implemented
  Scenario: Verify that a promo code becomes reusable after increasing its usage limit and extending its expiry date
    Given a promo code exists with a usage limit of "1", a future expiry date, and is not disabled
    And the promo code has already been redeemed once
    When the superadmin edits the promo code
    And increases the usage limit from "1" to "2"
    And extends the expiry date to a future date
    And saves the changes
    Then the promo code should no longer appear disabled or inactive
    And the Disabled toggle should remain OFF
    And the promo code should be redeemable again
    And applying the promo code should not display an "Invalid or Expired Promo Code" error
