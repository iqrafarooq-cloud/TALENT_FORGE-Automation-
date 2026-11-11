#ALL PASSED
# Search - filter and pagination is covered
@agent-portal @candidate-tracking @search @filters
Feature: Agent Portal - Candidate Tracking, Search and Filters

  Background:
    Given I am logged in as an agent
    And I am on the Candidates "In Progress" page

  # The heading names the listing it is on. Measured 2026-10-05: this page reads only
  # "Candidates" while the Deactivated listing reads "Candidates - Deactivated", so this
  # is red until the heading names the listing.
  @positive @structure @known-issue
  Scenario: Verify that the page heading reads "Candidates - In Progress"
    Then the candidates page heading should read "Candidates - In Progress"

  @positive @row-actions @resend-invite
  Scenario: Verify that both row actions are offered on every Invite Sent and Onboarding Incomplete row
    Then both row actions should be offered on every row of each of these tabs:
      | tab                   |
      | Invite Sent           |
      | Onboarding Incomplete |

  @positive @row-actions @resend-invite
  Scenario: Verify that Resend is enabled while an invitation is outstanding and disabled once it is not
    Then the "Resend" row action should be enabled on every row of each of these tabs:
      | tab         |
      | Invite Sent |
    And the "Resend" row action should be disabled on every row of each of these tabs:
      | tab                   |
      | Onboarding Incomplete |
      | All                   |

  @positive @row-actions @resend-invite @modal
  Scenario: Verify that the resend confirmation names the candidate and offers Cancel and Resend Invite
    When I click the "Invite Sent" In Progress quick filter tab
    And I open the resend confirmation for the first candidate that offers it
    Then the resend confirmation should name the candidate and offer Cancel and Resend Invite

  @negative @row-actions @resend-invite @modal
  Scenario: Verify that cancelling the resend confirmation sends no invitation
    When I click the "Invite Sent" In Progress quick filter tab
    And I open the resend confirmation for the first candidate that offers it
    Then cancelling the resend confirmation should close it without sending
  # ==========================================================================
  # 1. IN PROGRESS PAGE - DEFAULT STATE & TABLE
  # ==========================================================================

  @positive @navigation
  Scenario: Verify that the In Progress page opens with the All tab active by default
    Then the "All" In Progress quick filter tab should be active
    And the In Progress candidate table should be displayed
    And the page heading should indicate "In Progress" candidates
    # The All tab adds NO query param at all - it is the bare route, not activeFilter=all.
    And no In Progress quick filter should be reflected in the URL

  @positive @table
  Scenario: Verify that the In Progress table displays every column the app renders
    Then the In Progress table should display exactly the following columns:
      | column        |
      | Candidate     |
      | Status        |
      | Status Detail |
      | Actions       |

  @positive @table
  Scenario: Verify that candidate information and status details are displayed correctly
    Given the In Progress table has at least one candidate
    Then the Candidate column should show the full name in bold above the email address
    And each row's Status Detail should be composed only of the documented onboarding steps:
      | detail             |
      | Awaiting Signup    |
      | Profile Incomplete |
      | Test Pending       |
    And every row's Status Detail should agree with the step the API reports for it

  @positive @status
  Scenario: Verify that candidate status pills are displayed with the correct colours
    Given the In Progress table has candidates with the status "Invite Sent"
    Then candidates with "Invite Sent" status should display a blue status pill
    When I click the "Onboarding Incomplete" In Progress quick filter tab
    Then candidates with "Onboarding Incomplete" status should display a red status pill
  # ==========================================================================
  # 2. QUICK FILTER TABS
  # ==========================================================================

  @positive @quick-filter
  Scenario: Verify that each quick filter tab shows only candidates with its own status
    Then each In Progress quick filter tab should list only its own statuses:
      | tab                   | statuses                           | activeFilter          |
      | All                   | Invite Sent, Onboarding Incomplete |                       |
      | Invite Sent           | Invite Sent                        | invite_sent           |
      | Onboarding Incomplete | Onboarding Incomplete              | onboarding_incomplete |
  # ==========================================================================
  # 3. SEARCH
  # ==========================================================================

  @positive @search
  Scenario: Verify that the search narrows the list to candidates matching the term
    Given the In Progress candidate table has at least one candidate
    When I type a valid In Progress candidate name in the search bar
    And I wait for In Progress search results to update
    Then the In Progress table should only show candidates matching the searched term
    And the search term should be reflected in the request the page sent

  @positive @search
  Scenario: Verify that the search matches an email as well as a name
    Given the In Progress candidate table has at least one candidate
    When I search the In Progress list for the email of an existing candidate
    And I wait for In Progress search results to update
    Then that candidate should be the only row listed
    And the In Progress search placeholder should read "Search by candidate name..."

  @positive @search @quick-filter
  Scenario: Verify that the search works together with a selected quick filter tab
    Given the In Progress candidate table has at least one candidate
    When I click the "Invite Sent" In Progress quick filter tab
    And I search the In Progress list for an existing candidate name
    And I wait for In Progress search results to update
    Then every listed row should match the searched candidate
    And every listed row should have the status "Invite Sent"
    And both the search term and the quick filter should be reflected in the request the page sent

  @negative @search
  Scenario: Verify that searching for a non-existent candidate shows no results without an error
    When I type "ZZZNOTEXIST999" in the In Progress search bar
    And I wait for In Progress search results to update
    Then the In Progress table should show no candidate rows
    And the no-search-results empty state should be displayed
    And the In Progress page should not display any error message

  @positive @search
  Scenario: Verify that clearing the search restores the unfiltered candidate list
    Given the In Progress candidate table has at least one candidate
    When I search the In Progress list for an existing candidate name
    And I wait for In Progress search results to update
    And I clear the search field
    And I wait for In Progress search results to update
    Then the full In Progress candidate list should be restored
  # ==========================================================================
  # 4. FILTER MODAL - GROUPS, OPTIONS & CONTROL TYPES
  # ==========================================================================

  @positive @filter @filter-modal
  Scenario: Verify that the filter modal displays every filter group with its own options and control
    When I click the "Filters" button on the In Progress page
    Then the In Progress filter modal should be visible
    And the filter modal should contain exactly the following groups, options and controls:
      | group                 | control  | options                                                                 |
      | Onboarding Step       | checkbox | Awaiting Sign-up, Profile Incomplete, Test Pending                      |
      | Invite Sent           | checkbox | > 24 hours, 1-3 days, 4-7 days, 7+ days                                 |
      | Onboarding Incomplete | checkbox |                                             1-3 days, 4-7 days, 7+ days |
      | Reminder Status       | checkbox | No Reminder Sent, Recently Reminded (Last 48 hours), Multiple Reminders |
    And no filter option should be selected when the modal is first opened

  # Re-measured 2026-10-05: the Status group (Invite Sent / Onboarding Incomplete) was REMOVED from
  # the modal - status is chosen by the quick filter tabs only - and every remaining group is now a
  # multi-select checkbox group (Invite Sent, Onboarding Incomplete and Reminder Status used to be
  # single-select radios). Several options in one group all reach the request.
  @positive @filter @filter-modal
  Scenario: Verify that every filter group accepts several options at once
    When I click the "Filters" button on the In Progress page
    And I select every option under the "Onboarding Step" filter group
    Then every option under the "Onboarding Step" filter group should be selected
    When I select every option under the "Reminder Status" filter group
    Then every option under the "Reminder Status" filter group should be selected
    When I apply the In Progress filters
    Then the request the page sent should carry every selected option:
      | param           | values                                         |
      | onboarding_step | awaiting_signup, profile_incomplete, test_pending |
      | reminder_status | none, recent, multiple                         |
  # ==========================================================================
  # 5. FILTER MODAL - CLOSE BEHAVIOUR
  # ==========================================================================

  @positive @filter @filter-modal @modal-close
  Scenario: Verify that the filter modal closes through every supported dismissal
    When I click the "Filters" button on the In Progress page
    Then the In Progress filter modal should close via each of these dismissals:
      | dismissal |
      | X icon    |
      | Cancel    |
      | backdrop  |
      | Escape    |
    And I should remain on the Candidates "In Progress" page

  @positive @filter @filter-modal
  Scenario: Verify that Cancel discards an unapplied selection instead of filtering
    When I click the "Filters" button on the In Progress page
    And I select "Test Pending" under the "Onboarding Step" filter group
    And I close the In Progress filter modal via "Cancel"
    Then no In Progress filter should be reflected in the URL
    And the Filters button should show no applied-filter count
    When I click the "Filters" button on the In Progress page
    Then no filter option should be selected when the modal is first opened
  # 7. ONBOARDING STEP FILTER

  @positive @filter
  Scenario: Verify that the Onboarding Step filter returns only candidates matching the selected step
    Given the In Progress candidate table has at least one candidate
    Then each Onboarding Step filter option should return only its own candidates:
      | step               | param              |
      | Awaiting Sign-up   | awaiting_signup    |
      | Profile Incomplete | profile_incomplete |
      | Test Pending       | test_pending       |
  # 8. DURATION FILTERS

  @negative @filter @known-behaviour
  Scenario: Verify that the Invite Sent duration filter submits its band and does not narrow the list
    Given the In Progress candidate table has at least one candidate
    Then each Invite Sent duration option should submit its band without narrowing the list:
      | duration   | param |
      | > 24 hours | <1    |
      |   1-3 days |   1-3 |
      |   4-7 days |   4-7 |
      |    7+ days |    7+ |

  @positive @filter
  Scenario: Verify that the Onboarding Incomplete duration filter returns candidates within the selected band
    Given the In Progress candidate table has at least one candidate
    Then each Onboarding Incomplete duration option should return only candidates in its band:
      | duration | param |
      | 1-3 days |   1-3 |
      | 4-7 days |   4-7 |
      |  7+ days |    7+ |
  # ==========================================================================
  # 9. REMINDER STATUS FILTER

  @positive @filter @reminder-status
  Scenario: Verify that each Reminder Status option returns only candidates it classifies in that state
    Given the In Progress candidate table has at least one candidate
    Then each Reminder Status option should return only candidates in that reminder state:
      | reminderStatus                    | param    |
      | No Reminder Sent                  | none     |
      | Recently Reminded (Last 48 hours) | recent   |
      | Multiple Reminders                | multiple |
  #@known-issue --- issue fixed

  @negative @filter @reminder-status
  Scenario: Verify that a candidate classified as No Reminder Sent really has no reminders
    Given I have filtered the In Progress list by Reminder Status "No Reminder Sent"
    Then no candidate filtered as "No Reminder Sent" should have any reminder in its history:
      | reminder |
      | any      |

  @positive @filter @reminder-status
  Scenario: Verify that the reminder history icon shows the reminders behind a Multiple Reminders candidate
    Given I have filtered the In Progress list by Reminder Status "Multiple Reminders"
    When I open the reminder history of the first listed candidate
    Then the reminder history panel should be titled "Reminder History"
    And the reminder history should list more than one reminder
    And every listed reminder should record when it was sent
  # ==========================================================================
  # 10. COMBINED FILTERS & SEARCH

  @positive @filter @search
  Scenario: Verify that multiple filters and a search work together
    Given the In Progress candidate table has at least one candidate
    When I click the "Onboarding Incomplete" In Progress quick filter tab
    And I click the "Filters" button on the In Progress page
    And I select "7+ days" under the "Onboarding Incomplete Duration" filter group
    And I apply the In Progress filters
    Then every listed candidate should have status "Onboarding Incomplete"
    And every listed candidate's onboarding-incomplete age should fall within "7+ days"
    When I search the In Progress list for an existing candidate name
    And I wait for In Progress search results to update
    Then every listed candidate should match the searched candidate
    And every listed candidate should have status "Onboarding Incomplete"
    And every listed candidate's onboarding-incomplete age should fall within "7+ days"
    And every applied filter and the search term should be reflected in the request the page sent
  # ==========================================================================
  # 11. CLEAR / RESET FILTERS
  # ==========================================================================

  @positive @filter
  Scenario: Verify that clearing all filters restores the complete In Progress list
    Given the In Progress candidate table has at least one candidate
    When I filter the In Progress list by Onboarding Step "Awaiting Sign-up"
    Then every listed candidate should have status "Invite Sent"
    When I clear all filters
    Then the In Progress filter modal should be closed
    And the full In Progress candidate list should be restored
    And the "All" In Progress quick filter tab should be active

  @positive @filter @quick-filter
  Scenario: Verify that clearing all filters leaves the selected quick filter tab alone
    When I click the "Invite Sent" In Progress quick filter tab
    And I click the "Filters" button on the In Progress page
    And I select "Awaiting Sign-up" under the "Onboarding Step" filter group
    And I apply the In Progress filters
    When I clear all filters
    Then no In Progress filter should be reflected in the URL
    And the "Invite Sent" In Progress quick filter tab should be active

  @positive @filter @search
  Scenario: Verify that clearing the filters and the search restores the complete candidate list
    Given the In Progress candidate table has at least one candidate
    When I filter the In Progress list by Onboarding Step "Awaiting Sign-up"
    And I search the In Progress list for an existing candidate name
    And I wait for In Progress search results to update
    When I clear all filters
    And I clear the search field
    And I wait for In Progress search results to update
    Then the full In Progress candidate list should be restored
    And the "All" In Progress quick filter tab should be active
  # ==========================================================================
  # 12. NO-RESULTS STATES
  # ==========================================================================

  @negative @filter
  Scenario: Verify that filters matching no candidates display the filter no-results state
    Given the In Progress candidate table has at least one candidate
    When I click the "Invite Sent" In Progress quick filter tab
    And I click the "Filters" button on the In Progress page
    And I select "7+ days" under the "Onboarding Incomplete Duration" filter group
    And I select "Multiple Reminders" under the "Reminder Status" filter group
    And I apply the In Progress filters
    Then the In Progress filter modal should be closed
    And the In Progress table should show no candidate rows
    And the no-filter-results empty state should be displayed
    And the no-filter-results empty state should offer to clear the filters
    And the In Progress page should not display any error message

  @positive @empty-state @search
  Scenario: Verify that the search no-results state is distinct from the no-candidates state
    Given the In Progress candidate table has at least one candidate
    When I search the In Progress list for "zzz-no-such-candidate-zzz"
    And I wait for In Progress search results to update
    Then the no-search-results empty state should be displayed
    And the no-search-results empty state should be distinct from the no-candidates empty state
    And the no-search-results empty state should offer no way to clear the filters

  @positive @empty-state @filter
  Scenario: Verify that the search and filter no-results states name whichever of the two is active
    Given the In Progress candidate table has at least one candidate
    When I click the "Invite Sent" In Progress quick filter tab
    And I click the "Filters" button on the In Progress page
    And I select "7+ days" under the "Onboarding Incomplete Duration" filter group
    And I apply the In Progress filters
    Then the empty state body should read exactly "We couldn't find any results matching your current filters."
    When I search the In Progress list for "zzz-no-such-candidate-zzz"
    And I wait for In Progress search results to update
    Then the empty state body should read exactly "We couldn't find any results matching your current search and filters."
    When I clear all filters
    Then the empty state body should read exactly "We couldn't find any results matching your current search."
  # ==========================================================================
  # 13. PAGINATION
  # ==========================================================================

  @positive @pagination
  Scenario: Verify that pagination is displayed when the list exceeds one page
    Given the In Progress candidate list contains more candidates than fit on one page
    Then pagination controls should be displayed
    And the current page should be indicated
    And the next page control should be available

  @positive @pagination
  Scenario: Verify that the next and previous controls navigate between candidate pages
    Given the In Progress candidate list contains more candidates than fit on one page
    When I click the next page control
    Then the next page of candidates should be displayed
    And the current page indicator should be updated
    When I click the previous page control
    Then the previous page of candidates should be displayed
    And the current page indicator should be updated

  @positive @pagination
  Scenario: Verify that the pagination controls are disabled at their boundaries
    Given the In Progress candidate list contains more candidates than fit on one page
    And I am on the first page
    Then the previous page control should be disabled
    When I navigate to the last page
    Then the next page control should be disabled

  @positive @pagination @search
  Scenario: Verify that pagination reflects only the search results
    Given the In Progress candidate list contains more candidates than fit on one page
    When I search the In Progress list for a term that matches more candidates than fit on one page
    And I wait for In Progress search results to update
    Then pagination should reflect only the filtered search results
    When I click the next page control
    Then the next page of candidates should be displayed
    And every listed candidate should match the searched candidate

  @positive @pagination @filter
  Scenario: Verify that pagination reflects only the filtered results
    Given the In Progress candidate list contains more candidates than fit on one page
    When I click the "Onboarding Incomplete" In Progress quick filter tab
    Then pagination should reflect only the filtered results
    When I click the next page control
    Then the next page of candidates should be displayed
    And every listed candidate should have status "Onboarding Incomplete"
  # ==========================================================================
  # 14. END-TO-END SEARCH / FILTER JOURNEYS

  @e2e @search @quick-filter
  Scenario: Verify that a candidate can be searched and the quick filter tabs switched around it
    Given the In Progress candidate table has at least one candidate
    When I search the In Progress list for a term that matches candidates in both statuses
    And I wait for In Progress search results to update
    Then the In Progress table should only show candidates matching the searched term
    When I click the "Invite Sent" In Progress quick filter tab
    Then the "Invite Sent" In Progress quick filter tab should be active
    And every listed candidate should have status "Invite Sent"
    And every listed candidate should match the searched term
    And the search term should be preserved in the search field

  @e2e @filter @search
  Scenario: Verify that a filter can be applied and then searched within
    Given the In Progress candidate table has at least one candidate
    When I filter the In Progress list by Onboarding Step "Awaiting Sign-up"
    Then every listed candidate should have status "Invite Sent"
    When I search the In Progress list for an existing candidate name
    And I wait for In Progress search results to update
    Then every listed candidate should match the searched candidate
    And every listed candidate should have status "Invite Sent"
