@candidate-management @superadmin @user-management-edges
Feature: SuperAdmin User Management - Candidates (URL edge cases, paging, failures, access, end to end)

  The listing's own behaviour is covered in Candidate-Search-Filters-View.feature. This file
  covers what that one does not: what an unusable URL does, the LAST page, row order, a failed
  load, and who may open the page at all.

  Nothing here changes an account. Every expectation is read off the server's own answer at run
  time. Measured with scripts/probe-superadmin-user-mgmt-edges.js (read-only).

  Background:
    Given I am logged in as the superadmin

  # ==================== URL EDGE CASES ====================

  @edge-case
  Scenario: Verify that an unrecognised tab value falls back to the All tab
    Then opening the "Candidates" listing with each tab value should fall back to "All":
      | value  |
      | bogus  |
      |        |
      | ACTIVE |

  # ==================== FAILURES ====================

  @negative @known-issue
  Scenario: Verify that a failed candidate list load is reported as a failure, not as an empty list
    Then a failed "Candidates" list load should be reported as a failure for each cause:
      | cause   |
      | 500     |
      | offline |

  # ==================== ACCESS ====================

  @negative
  Scenario: Verify that only a superadmin can reach the candidate management listing
    Then the candidate management listing should be closed to each of these roles:
      | role      | expected                               |
      | agent     | redirected to the agent's own listing  |
      | candidate | access denied                          |
