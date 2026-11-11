
@promo-tools
Feature: Agent Profile — Promo Tools tab management

  @positive
  Scenario: Verify that the usage figure is the same in the agent's share modal and the superadmin banner
    Given I am logged in as the "limited" promo agent
    When I open the "Promo Code" share modal
    Then the promo "Usage Limit" should read as a used count of a limit
    And the banner "Total Usage" should agree with the agent's own share modal

  @negative
  Scenario: Verify that the Edit modal bounds Value and Usage Limit the same way the invite form does
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then entering the following into the modal "Value" field should be validated as shown:
      | value | error                           |
      |     0 | Enter a valid percentage value. |
      |  12.5 |                                 |
      | 99.99 |                                 |
      |   101 | Value cannot exceed 100%.       |
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then entering the following into the modal "Usage Limit" field should be validated as shown:
      | value | error                     |
      |     0 | Value must be at least 1. |
      |     1 |                           |
      |   100 |                           |

  @negative
  Scenario: Verify that clearing a required parameter shows its inline error, not just gates Save
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then clearing each of the following modal fields should show its inline error:
      | field       |
      | Value       |
      | Usage Limit |

  @negative
  Scenario: Verify that Save Changes is gated on every required parameter and on there being a real change
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then "Save Changes" should be disabled while nothing has been changed
    And "Save Changes" should follow whether the form actually differs from what was saved
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then clearing each of the following modal fields should keep "Save Changes" disabled:
      | field       |
      | Value       |
      | Usage Limit |
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then "Save Changes" should stay disabled until every one of these fields is filled again:
      | field       |
      | Value       |
      | Usage Limit |
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then a whitespace-only value in each of these modal fields should keep "Save Changes" disabled:
      | field       |
      | Value       |
      | Usage Limit |

  @edge-case
  Scenario: Verify that the Edit modal shows the code read-only and discards every change on Cancel
    Given the superadmin has opened the "unlimited" agent's Edit Code Parameters modal
    Then the Promo Code Name field should hold that agent's code and be non-editable
    And cancelling the modal should leave every parameter unchanged

  @positive
  Scenario: Verify that editing several parameters at once persists every one of them
    Given the superadmin opens the "unlimited" agent's Promo Tools tab
    When the superadmin sets that agent's promo parameters to:
      | field       | value    |
      | Value       |       35 |
      | Usage Limit |      500 |
      | Expiry Date | +90 days |
    Then the Code Parameters should report those values
    And the superadmin Promo Tools tab should show the status "Active"

  @positive
  Scenario: Verify that a disabled promo greys out, keeps its code, and can be re-activated at any time
    Given the superadmin opens the "limited" agent's Promo Tools tab
    Then the superadmin Promo Tools tab should show the status "Active"
    When the superadmin disables that agent's promo code from the Promo Tools tab
    Then the superadmin Promo Tools tab should show the status "Disabled"
    And the banner and Code Parameters sections should be greyed out
    And the banner should still display the last known promo code
    When the superadmin activates that agent's promo code from the Promo Tools tab
    Then the superadmin Promo Tools tab should show the status "Active"
    And the Promo Tools tab should show both the Banner and Code Parameters sections

  @positive
  Scenario: Verify that an expired promo shows both warning icons and returns to Active when its date is restored
    Given the superadmin has backdated the "limited" agent's promo code so its expiry date has passed
    Then the superadmin Promo Tools tab should show the status "Expired"
    And the promo code should show a warning icon on that agent's Promo Tools tab
    And the banner should still display the last known promo code
    When the superadmin changes that agent's expiry date to 60 days from today
    Then the superadmin Promo Tools tab should show the status "Active"
    And the "Expiry Date" should be the new date and not the previous one

  @positive
  Scenario: Verify that an agent with no promo code shows the empty state, and that its Add CTA opens a matching modal
    Given the superadmin opens the Promo Tools tab of an agent with no promo code
    Then the Promo Tools tab should show the no-promo empty state
    When the superadmin clicks "Add Promo Code"
    Then the "Add Code Parameters" modal should open with the same fields as the Edit modal
    And the incentive type should default to "Percentage Discount"

  @negative
  Scenario: Verify that the Add modal gates Save until every required field is filled, and that cancelling creates nothing
    Given the superadmin opens the Promo Tools tab of an agent with no promo code
    When the superadmin clicks "Add Promo Code"
    Then "Save Changes" should be disabled on the freshly opened modal
    And "Save Changes" should enable only once every required field is filled:
      | field       | value    |
      | Value       |       15 |
      | Expiry Date | +30 days |
      | Usage Limit |       25 |
    And no promo code should have been created for that agent
    And the Promo Tools tab should show the no-promo empty state
  #BUG LOGGED

  @positive @provision @known-issue
  Scenario: Verify that adding a promo creates it, and that adding and editing each confirm with the wording the AC specifies
    Given the superadmin opens the Promo Tools tab of a throwaway agent with no promo code
    When the superadmin clicks "Add Promo Code"
    And the superadmin adds a promo code with:
      | field          | value        |
      | Incentive Type | Fixed Amount |
      | Value          |           75 |
      | Expiry Date    |     +45 days |
      | Usage Limit    |            8 |
    Then the Promo Tools tab should now show an assigned promo code
    And the Code Parameters should report those values
    When the superadmin edits that promo's parameters from the tab it is already on
    Then the two saves should confirm with the wording the AC specifies:
      | save    | expected toast                             |
      | adding  | Promo code parameters added successfully   |
      | editing | Promo code parameters updated successfully |
