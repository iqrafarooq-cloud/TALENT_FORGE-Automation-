@superadmin @agent-management @agent-view
Feature: SuperAdmin User Management - Agents: View from Active, Requires Attention and Deactivated

  Background:
    Given I am logged in as the superadmin
  # ==================== OPENING THE PROFILE FROM EACH TAB ====================

  @positive @smoke
  Scenario: Verify that View opens the clicked agent's own profile from every tab that offers it
    Then viewing the first agent of each tab should open that agent's profile, as the server describes it:
      | tab                | statuses                   | menu                        |
      | Active             | Active, Requires Attention | Log in as agent, Deactivate |
      | Requires Attention | Requires Attention         | Log in as agent, Deactivate |
      | Deactivated        | Deactivated                | Reactivate                  |

  @positive
  Scenario: Verify that Performance Overview shows the server's figures for an agent opened from each tab
    Then Performance Overview should show the server's figures for the first agent of each tab:
      | tab                |
      | Active             |
      | Requires Attention |
      | Deactivated        |

  @positive
  Scenario: Verify that the Promo Tools tab shows the opened agent's own promo, whichever tab it was opened from
    Then the Promo Tools tab should show each agent's own promo as the server holds it:
      | tab                | agent                       |
      | Active             | PROMO_UNLIMITED_AGENT_EMAIL |
      | Requires Attention | first listed                |
      | Deactivated        | first listed                |

  @positive
  Scenario: Verify that an agent opened from Requires Attention has its candidates and activity fetched for that agent only
    Given I have picked an agent on the "Requires Attention" tab who holds candidates
    When I view that agent from the "Requires Attention" tab and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    And every agent request the profile made should be for that agent only
    When I open the "Candidates" profile tab
    Then the profile's Candidates tab should list exactly the candidates the server returned
    When I open the "Activity Log" profile tab
    Then the Activity Log should be requested for that agent's own account

  @positive
  Scenario: Verify that Candidate Onboarding and Revenue Impact show the server's figures for each period
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then Candidate Onboarding and Revenue Impact should re-query and show the server's figures for each period:
      | period       | duration      |
      | Quarterly    | last_quarter  |
      | Yearly       | yearly        |
      | Year to Date | ytd           |
      | Monthly      | current_month |

  @negative @known-issue
  Scenario: Verify that Revenue Impact compares against the chosen period, not always against last month
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then the Revenue Impact comparison should name the period chosen:
      | period       |
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |
  # ==================== HEADER ACTIONS PER AGENT STATE (read-only) ====================

  @positive
  Scenario: Verify that Deactivate from an active agent's profile names that agent and changes nothing when left
    Given I have picked the first agent listed on the "Active" tab
    When I view that agent from the "Active" tab and record what the server sends
    And I choose "Deactivate" from the profile's menu
    Then the profile's lifecycle dialog should be "Deactivate Agent Account" and name that agent
    And leaving the profile's "Deactivate" dialog each of these ways should change nothing:
      | method |
      | Cancel |
      | X icon |
      | Escape |

  @positive
  Scenario: Verify that Reactivate from a deactivated agent's profile names that agent and changes nothing when left
    Given I have picked the first agent listed on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    And I choose "Reactivate" from the profile's menu
    Then the profile's lifecycle dialog should be "Re-activate Account" and name that agent
    And the profile's lifecycle dialog should say the agent is currently "Deactivated"
    And leaving the profile's "Reactivate" dialog each of these ways should change nothing:
      | method |
      | Cancel |
      | X icon |
      | Escape |

  @positive
  Scenario: Verify that the profile's three-dot menu opens, and closes without acting, on every state
    Then the profile's three-dot menu should list its items and close each of these ways, sending nothing:
      | tab                | items                       |
      | Active             | Log in as agent, Deactivate |
      | Requires Attention | Log in as agent, Deactivate |
      | Deactivated        | Reactivate                  |

  @positive
  Scenario: Verify that every item of the profile's three-dot menu can be chosen from the keyboard
    Then each profile menu item should open its dialog from the keyboard:
      | tab         | item            | dialog                   |
      | Active      | Log in as agent | Verify your identity     |
      | Active      | Deactivate      | Deactivate Agent Account |
      | Deactivated | Reactivate      | Re-activate Account      |

  @negative
  Scenario: Verify that Deactivate from the profile of an agent holding candidates requires a transfer first and Cancel changes nothing
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I choose "Deactivate" from the profile's menu
    Then the profile's Deactivate dialog should require that agent's active candidates to be transferred first
    And leaving the profile's "Deactivate" dialog each of these ways should change nothing:
      | method |
      | Cancel |
      | X icon |
      | Escape |

  @edge-case @needs-clarification
  Scenario: Verify that a deactivated agent's profile still offers Edit Target, Reactivate and a way to manage its promo
    Given I have picked the first agent listed on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    Then the profile should offer an enabled "Edit Target"
    And the profile's menu should offer only its lifecycle action "Reactivate"
    When I open the "Promo Tools" profile tab
    Then the profile's Promo Tools tab should offer a way to add or edit that agent's promo
  # ==================== EDIT TARGET (read-only - Save is never clicked) ====================

  @negative
  Scenario: Verify that Edit Target explains each unusable target inline and blocks Save
    Given I have picked the first agent listed on the "Requires Attention" tab
    When I view that agent from the "Requires Attention" tab and record what the server sends
    Then Edit Target should explain each unusable target inline, keep Save disabled and send nothing:
      | target | message                                 |
      |        | Monthly target is required.             |
      | "   "  | Monthly target is required.             |
      |      0 | Monthly target cannot be zero.          |
      |     -5 | Monthly target cannot be negative.      |
      | abc    | Monthly target must be a numeric value. |
      |    5.5 | Monthly target must be a whole number.  |

  @negative @known-issue
  Scenario: Verify that Edit Target refuses a target too large to store before it is sent
    Given I have picked the first agent listed on the "Active" tab
    When I view that agent from the "Active" tab and record what the server sends
    Then Edit Target should refuse a target of "99999999999" before it is sent

  @edge-case
  Scenario: Verify that leaving Edit Target any way discards the typed target
    Given I have picked the first agent listed on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    Then leaving Edit Target each of these ways should discard a typed target and send nothing:
      | method |
      | Cancel |
      | X icon |
      | Escape |
  # ==================== EDGE CASES ====================

  @edge-case
  Scenario: Verify that an unusable profile address says the profile was not found
    Then opening each of these agent profile addresses should say the profile was not found:
      | address       |
      | abc           |
      |             0 |
      |            -1 |
      | <agent id>abc |

  @edge-case
  Scenario: Verify that a trailing slash or a repeated tab parameter still opens the right agent
    Given I have picked the first agent listed on the "Requires Attention" tab
    Then opening that agent's profile at each of these addresses should show that agent:
      | address                                   | tab is one of            |
      | <agent id>/                               | Performance Overview     |
      | <agent id>?tab=candidates&tab=activityLog | Candidates, Activity Log |

  @negative @known-issue
  Scenario: Verify that a failed profile load is reported as a failure, not as a missing profile
    Given I have picked the first agent listed on the "Active" tab
    And the agent profile request will fail with a server error
    When I open that agent's profile by its address
    Then the profile should report that it could not be loaded rather than that it does not exist

  @negative @known-issue
  Scenario: Verify that a failed Target Progress load is not shown as zero figures
    Given I have picked the first agent listed on the "Requires Attention" tab
    And the Target Progress request will fail with a server error
    When I open that agent's profile by its address
    Then Target Progress should not present the failed load as figures

  @edge-case
  Scenario: Verify that opening a second agent shows none of the first agent's details
    Given I have picked the first two agents listed on the "Active" tab
    When I view the first picked agent, go Back, and view the second
    Then the profile should show only the second agent at every moment it is sampled

  @edge-case
  Scenario: Verify that browser Back leaves the profile and Forward restores the tab it was on
    Given I have picked the first agent listed on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I open the "Activity Log" profile tab
    Then browser Back should return to the Agents listing and Forward should restore the "Activity Log" tab

  @positive
  Scenario: Verify that a profile address opened in a new browser tab of the same session shows that agent
    Given I have picked the first agent listed on the "Requires Attention" tab
    Then that agent's profile address opened in a new browser tab should show that agent

  @positive
  Scenario: Verify that View can be reached and used from the keyboard on every tab that offers it
    Then View should open the row's agent from the keyboard on each of these tabs:
      | tab                |
      | Active             |
      | Requires Attention |
      | Deactivated        |
  # ==================== END TO END, READ-ONLY ====================

  @positive @e2e
  Scenario: Verify that a superadmin can review a Requires Attention agent end to end and return
    Given I have picked an agent on the "Requires Attention" tab who holds candidates
    When I view that agent from the "Requires Attention" tab and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    And the profile header should match the server's profile for that agent:
      | field      |
      | name       |
      | email      |
      | university |
      | status     |
    And Target Progress should render the server's percentage, onboarded count and target
    And Pending Verifications should render the server's total for that agent
    When I open the "Candidates" profile tab
    Then the profile's Candidates tab should list exactly the candidates the server returned
    When I open the "Promo Tools" profile tab
    Then the profile's Promo Tools tab should show what the server holds for that agent
    When I open the "Activity Log" profile tab
    Then the Activity Log should be requested for that agent's own account
    When I click the profile "Back" control
    Then I should be on the Agents listing
  # ==================== COMMITTING, ON THROWAWAY AGENTS ====================

  @positive @e2e @mutates-agent @provision
  Scenario: Verify that a target set, a deactivation and a reactivation from the profile all take effect end to end
    Given I have provisioned a throwaway agent to manage from its profile
    When I view that agent from the "Requires Attention" tab and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    When I save a monthly target of 25 from the profile
    Then the server should have saved a monthly target of 25 and the profile confirmed it
    And Target Progress should measure the agent against a target of 25
    And Edit Target should reopen holding 25
    And after a reload the server should still hold a monthly target of 25
    And the Agents listing should hold a monthly target of 25 for that agent
    When I deactivate that agent from its profile
    Then the profile should show the agent as "Deactivated" with only "Reactivate" in its menu
    And that agent should appear on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    And after a reload the server should still hold a monthly target of 25
    When I reactivate that agent from its profile
    Then the profile should show the agent as active with "Log in as agent, Deactivate" in its menu
    And that agent should no longer be listed on the "Deactivated" tab

  @positive @e2e @mutates-agent @provision
  Scenario: Verify that a promo added, edited, disabled and enabled from the profile is what the server holds
    Given I have provisioned a throwaway agent to manage from its profile
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Promo Tools" profile tab
    Then the profile's Promo Tools tab should show what the server holds for that agent
    When I add a promo from the profile's Promo Tools tab with:
      | field          | value               |
      | Incentive Type | Percentage Discount |
      | Value          |                  15 |
      | Usage Limit    |                  25 |
      | Expiry Date    |            +30 days |
    Then the promo save should be confirmed
    And the profile's Promo Tools tab should show the server's promo with:
      | field          | value               |
      | Status         | Active              |
      | Incentive Type | Percentage Discount |
      | Value          |                  15 |
      | Usage Limit    |                  25 |
    When I change the profile promo's value to 20
    Then the promo save should be confirmed
    And the profile's Promo Tools tab should show the server's promo with:
      | field | value |
      | Value |    20 |
    When I set the profile promo's status to "Disabled"
    Then the profile's Promo Tools tab should show the server's promo with:
      | field  | value    |
      | Status | Disabled |
    When I set the profile promo's status to "Active"
    Then the profile's Promo Tools tab should show the server's promo with:
      | field  | value  |
      | Status | Active |
    And the promo code should not have changed since it was added
