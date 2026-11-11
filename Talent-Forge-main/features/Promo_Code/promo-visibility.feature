@promo-lifecycle
Feature: Promo Code Lifecycle — Visibility and Validation

  @positive
  Scenario: Verify that an agent's dashboard and the superadmin's Promo Tools tab show the same configured promo code
    Given I am logged in as the "unlimited" promo agent
    Then the "Promo Code" widget should display that agent's assigned promo code
    When the superadmin opens that agent's Promo Tools tab
    Then the superadmin Promo Tools tab should show that agent's promo code
    And the superadmin Code Parameters should read:
      | field          | value               |
      | Status         | Active              |
      | Incentive Type | Percentage Discount |
      | Value          |                 20% |

  @positive
  Scenario: Verify that an agent-assigned promo is accepted, discounts correctly on every plan, attributes to its agent and can be removed
    Then applying each of these agents' promo codes should discount the invoice correctly:
      | agent     | plan      |
      | unlimited | Monthly   |
      | unlimited | Quarterly |
      | fixed     | Monthly   |
      | fixed     | Quarterly |

  @edge-case
  Scenario: Verify that a fixed discount larger than the invoice never produces a negative total
    Given the superadmin has set the "fixed" agent's promo value to "200"
    And I am logged in as a candidate of the "fixed" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "fixed" agent's promo code
    Then the total due should not be negative

  @edge-case
  Scenario: Verify that a decimal percentage discount is applied and rounded coherently
    Given the superadmin has set the "unlimited" agent's promo value to "12.5"
    And I am logged in as a candidate of the "unlimited" promo agent
    When I open the invoice for the "Monthly" plan
    And I apply the "unlimited" agent's promo code
    Then the promo code should be accepted
    And a discount line should be shown below the subtotal
    And the discount should equal that agent's configured promo value
    And the discount should be rounded to at most 2 decimal places
    And the total due should be the subtotal minus the discount

  @negative
  Scenario: Verify that an unknown promo code is rejected inline and leaves the total untouched
    Given I am logged in as a candidate
    When I open the invoice for the "Monthly" plan
    And I apply the promo code "NOSUCHCODE123"
    Then the promo error "Invalid or expired promotion code" should be displayed
    And the "Apply" promo button should be disabled
    And no discount line should be shown
    And the total due should equal the subtotal

  @negative @mocked
  Scenario: Verify that a promo the API refuses shows the inline error whatever the reason
    Given I am logged in as a candidate
    And the invoice preview will reject any promo code
    When I open the invoice for the "Monthly" plan
    And I apply the "unlimited" agent's promo code
    Then the promo error "Invalid or expired promotion code" should be displayed
    And no discount line should be shown
    And the total due should equal the subtotal

  # SCOPED TO EMAIL ONLY on 2026-09-07, by product decision: the in-app half of this pair is not
  # in scope here. The four in-app assertions that used to sit in this scenario were removed with
  # it, and so was the "unread in-app notifications are cleared" Given - that Given existed purely
  # to baseline the bell, and it was also what bound "that agent", so the disable step now names
  # the agent directly. The email baseline is taken by the disable step itself.
  #
  # NOTE FOR WHOEVER SEES THIS RED: the in-app notifications DO fire (measured 2026-09-07 - the
  # bell showed both, naming CODETF5WMM8, minutes after a run). It is the EMAIL leg that has
  # regressed: this agent received disabled/resumed mail reliably until 2026-08-17 12:10 and none
  # since, while the same mails still reach other agents. See the TFF-484 note in CLAUDE.md.
  #
  # @known-issue ADDED 2026-10-07, re-verified: still red at the first email step (after UID 20715),
  # and the defect is now WIDER than one agent - the inbox received 38 TalentForge mails that day
  # but ZERO "promo disabled" / "promo resumed" mails to ANY recipient, although this run disabled
  # and re-enabled CODETF5WMM8 and test:promo:repair --fix re-enabled PROMO_UNLIMITED_AGENT's
  # disabled promo the same morning. The restore hook left CODETF5WMM8 Active afterwards.
  @positive @agent-email @known-issue
  Scenario: Verify that disabling and re-enabling a promo notifies its agent by email
    Given the superadmin has disabled the "limited" agent's promo code
    Then that agent should receive the "promo disabled" email
    And the email should state that the promo code is no longer available for use
    When the superadmin re-enables that agent's promo code
    Then that agent should receive the "promo resumed" email
    And the "promo resumed" email should contain that agent's promo code
