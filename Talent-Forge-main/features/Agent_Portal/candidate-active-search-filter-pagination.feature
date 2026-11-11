#ALL PASSED
@candidateActive @searchFilterPagination
Feature: Candidate Active Search, Filters and Pagination

  Background:
    Given I am logged in as an agent
    And I am on the Candidates Active tab
  # SEARCH

  @positive @search
  Scenario: Verify that searching by candidate name and by email both filter matching results
    Given the candidate table has at least one record visible
    When I search by the first candidate's name
    And I wait for the search results to update
    Then the table should only display candidates matching the search term
    And the URL should contain the search term
    When I clear the search bar
    And I wait for the search results to update
    When I search by the first candidate's email
    And I wait for the search results to update
    Then the table should only display candidates matching the search term
    And the URL should contain the search term

  @positive @search @negative
  Scenario: Verify that searching for a non-existent candidate shows no results without crashing
    When I type "ZZZNONEXISTENT999" into the search bar
    And I wait for the search results to update
    Then the table should show no candidate rows
    And the page should not crash or throw an error

  @positive @search
  Scenario: Verify that clearing the search restores the full candidate list
    Given the candidate table has at least one record visible
    When I search by the first candidate's name
    And I wait for the search results to update
    Then the table should only display candidates matching the search term
    When I clear the search bar
    And I wait for the search results to update
    Then the search bar should be empty
    And the candidate table should be visible

  @positive @search
  Scenario: Verify that search filters candidates within a non-default subscription tab
    When I click the "Not Subscribed" quick filter tab
    And the candidate table has at least one record visible
    And I search by the first candidate's name
    And I wait for the search results to update
    Then the table should only display candidates matching the search term
    And the "Not Subscribed" tab should still be active
  # FILTER MODAL

  @positive @filter-modal
  Scenario: Verify that the filter modal presents every group with its correct options
    When I click the "Filters" button
    Then the filter modal should be visible
    And the modal should contain the filter group "Account Verification Status"
    And the "Account Verification Status" group should have options:
      | Verified   |
      | Unverified |
    And the modal should contain the filter group "Pending Documents"
    And the "Pending Documents" group should have options:
      |   0 |
      | 1-2 |
      |  3+ |
    And the modal should not contain the filter group "Subscription Status"
    And the modal should contain the filter group "Last Activity"
    And the "Last Activity" group should have options:
      | Last 24 hours       |
      | Last 7 days         |
      | Last 30 days        |
      | Inactive (30+ days) |

  @positive @filter-options
  Scenario: Verify that applying every filter option updates the URL and refreshes the table
    Given the candidate table has at least one record visible
    Then applying filters behaves correctly for each option:
      | group                       | option              | param                          | api                            | column               | expected   |
      | Account Verification Status | Verified            | accountVerification=verified   | verification_status=verified   | Account Verification | Verified   |
      | Account Verification Status | Unverified          | accountVerification=unverified | verification_status=unverified | Account Verification | Unverified |
      | Pending Documents           | 0                   | pendingDocuments=0             | pending_documents=0            | Pending Documents    | 0          |
      | Pending Documents           | 1-2                 | pendingDocuments=1-2           | pending_documents=1-2          |                      |            |
      | Pending Documents           | 3+                  | pendingDocuments=3plus         | pending_documents=3+           |                      |            |
      | Last Activity               | Last 24 hours       | lastActivity=24h               | last_activity=24h              |                      |            |
      | Last Activity               | Last 7 days         | lastActivity=7days             | last_activity=7d               |                      |            |
      | Last Activity               | Last 30 days        | lastActivity=30days            | last_activity=30d              |                      |            |
      | Last Activity               | Inactive (30+ days) | lastActivity=inactive          | last_activity=inactive         |                      |            |

  @positive @multi-select
  Scenario: Verify that selecting multiple options in a group applies all of them
    When I click the "Filters" button
    And I select the "Verified" option under "Account Verification Status"
    And I select the "Unverified" option under "Account Verification Status"
    And I apply the filters
    Then the filter modal should close
    And the URL should contain the filter "accountVerification=verified"
    And the URL should contain the filter "accountVerification=unverified"

  @positive @filter-modal
  Scenario: Verify that applying a filter shows the applied-filter count on the Filters button
    When I click the "Filters" button
    And I select the "Verified" option under "Account Verification Status"
    And I apply the filters
    Then the filter modal should close
    And the Filters button should show an applied-filter count of "1"

  @positive @clear-all
  Scenario: Verify that Clear All resets every selected filter and clears the URL
    When I click the "Filters" button
    And I select the "Verified" option under "Account Verification Status"
    And I select the "1-2" option under "Pending Documents"
    And I clear all filters in the modal
    Then no filter option should be selected in the modal
    And the URL should not contain any filter parameters

  @positive @cancel
  Scenario: Verify that Cancel discards unapplied filter selections
    When I click the "Filters" button
    And I select the "Verified" option under "Account Verification Status"
    And I cancel the filters
    Then the filter modal should not be visible
    And the URL should not contain any filter parameters
    When I click the "Filters" button
    Then no filter option should be selected in the modal

  @positive @modal-close
  Scenario Outline: Verify that the filter modal can be closed via different methods
    When I click the "Filters" button
    Then the filter modal should be visible
    When I close the filter modal via "<closeMethod>"
    Then the filter modal should not be visible

    Examples:
      | closeMethod |
      | X icon      |
      | Cancel      |
      | backdrop    |

  @negative @filter-modal
  Scenario: Verify that filtering with no matching candidates shows the empty results state
    When I click the "Filters" button
    And I select the "Verified" option under "Account Verification Status"
    And I select the "1-2" option under "Pending Documents"
    And I select the "Last 7 days" option under "Last Activity"
    And I apply the filters
    Then the filter modal should close
    And an empty results state should be visible
    And the table should show no candidate rows
  # PAGINATION

  @positive @pagination
  Scenario: Verify that pagination controls are rendered on the Active tab
    Then the pagination section should be visible
    And the pagination should contain a "Previous" control
    And the pagination should contain a "Next" control
    And the pagination should contain at least one page number
  # SEARCH + FILTER E2E

  @e2e @search @filter-modal
  Scenario: Verify that searching and filtering together narrows results and both persist in the URL
    Given the candidate table has at least one record visible
    When I search by the first candidate's name
    And I wait for the search results to update
    And I click the "Filters" button
    And I select the "Unverified" option under "Account Verification Status"
    And I apply the filters
    Then the filter modal should close
    And the URL should contain the search term
    And the URL should contain the filter "accountVerification=unverified"
    And any results shown should match the search term and read "Unverified" in the "Account Verification" column
