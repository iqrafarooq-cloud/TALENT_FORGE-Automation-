@agent-management @superadmin @user-management-edges
Feature: SuperAdmin User Management - Agents (URL edge cases, failures, access)

  

  Background:
    Given I am logged in as the superadmin

  # ==================== URL EDGE CASES ====================

  @edge-case
  Scenario: Verify that an unrecognised tab value falls back to the Active tab
    Then opening the "Agents" listing with each tab value should fall back to "Active":
      | value  |
      | bogus  |
      |        |
      | ACTIVE |

  # ==================== FAILURES ====================

  @negative
  Scenario: Verify that a failed agent list load is reported as a failure, not as an empty list
    Then a failed "Agents" list load should be reported as a failure for each cause:
      | cause   |
      | 500     |
      | offline |

  @negative @known-issue
  Scenario: Verify that the failed agent list load names agents rather than candidates
    Given the "Agents" list request will answer "500"
    When I open the "Agents" listing expecting a failure
    Then the "Agents" failure message should name "agents" and not "candidates"

  @negative
  Scenario: Verify that an agent profile that does not exist says so
    Then opening an agent profile that does not exist should say "Profile not found" for each id:
      | id       |
      | 99999999 |
      | abc      |

  # The tabs render on every profile by design, missing or not. What matters is that a profile
  # with no data says so: "Profile not found.", no agent identity, and each chart on its own
  # empty state rather than a plotted series.
  @negative
  Scenario: Verify that an agent profile that does not exist shows no performance figures
    When I open the profile of an agent that does not exist
    Then the missing agent profile should say it was not found and show its empty states

  # ==================== ACCESS ====================

  @negative
  Scenario: Verify that only a superadmin can reach the agent management pages
    Then each of these roles should be refused the agent management pages:
      | role      |
      | agent     |
      | candidate |
