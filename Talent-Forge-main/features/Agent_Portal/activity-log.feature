@activity-log @agent-portal
Feature: Agent Portal - Activity Log

  Background:
    Given I am logged in as an agent
    And I am on the Activity Log page
  # SECTION 1 - THE PAGE AND ITS TWO CONTROLS

  @positive @smoke
  Scenario: Verify that the Activity Log presents its two controls, offers exactly six ranges and opens on Last 7 days
    Then the Activity Log heading should be displayed
    And the Activity Log search box should be displayed
    And the Activity Log date-range filter should be displayed
    And the Activity Log should offer no separate Filters button
    And the date-range filter should show "Last 7 days"
    And the Activity Log request should carry the date range "last_7_days"
    And the Activity Log URL should carry no date-range parameter
    When I open the Activity Log date-range filter
    Then the date-range filter should offer exactly these ranges in order:
      | Last 24 hours |
      | Last 7 days   |
      | Last 30 days  |
      | Last 3 months |
      | Last 6 months |
      | This year     |
    And the date-range filter should mark the applied range as selected
  # SECTION 2 - THE DATE-RANGE FILTER

  @positive
  Scenario: Verify that every date range reaches both the URL and the request the app sends
    Then applying each date range should carry its value to the URL and to the server:
      | range         | url value     | api value     |
      | Last 24 hours | last_24_hours | last_24_hours |
      | Last 7 days   | last_7_days   | last_7_days   |
      | Last 30 days  | last_30_days  | last_30_days  |
      | Last 3 months | last_3_months | last_3_months |
      | Last 6 months | last_6_months | last_6_months |
      | This year     | this_year     | this_year     |

  @positive
  Scenario: Verify that a wider date range never returns fewer entries than a narrower one, and that the list matches the server
    Then the entry totals for the six date ranges should never decrease as the range widens
    And every rendered entry should be one the server returned

  @edge-case
  Scenario: Verify that a no-op interaction with the date-range filter changes nothing and queries nothing
    When I select the "Last 30 days" date range
    And I re-select the "Last 30 days" date range
    Then no further Activity Log request should have been sent
    And the date-range filter should show "Last 30 days"
    And dismissing the date-range popover should change nothing, by each of these routes:
      | Escape        |
      | outside click |

  @negative
  Scenario: Verify that a date range the app cannot use falls back to the default, whatever shape it takes
    Then each of these date-range values should fall back to the default:
      | date range       | why it matters        |
      | not_a_real_range | an unrecognised value |
      |                  | an empty value        |
  # SECTION 3 - THE SEARCH

  @positive
  Scenario: Verify that searching narrows the list, reaches both the URL and the server, and renders everything it returned
    When I select the "This year" date range
    And I note the Activity Log total
    And I search the Activity Log by a word from the first entry
    Then the Activity Log total should be no greater than the noted total
    And at least one entry should be listed
    And every listed entry should match the Activity Log search term
    And the Activity Log URL should carry the search term
    And the Activity Log request should carry the search term
    And every entry the server returned should be rendered
    And every rendered entry should carry a headline, a description and a timestamp

  @positive
  Scenario: Verify that the search matches the same entries however the term is cased or truncated
    When I select the "This year" date range
    Then these variations of a term taken from the first entry should agree with one another:
      | variation      | expectation                 |
      | as typed       | is the baseline             |
      | lower case     | same total as the baseline  |
      | upper case     | same total as the baseline  |
      | mid-word slice | at least the baseline total |

  @positive
  Scenario: Verify that surrounding whitespace is trimmed from a search term
    Given I have chosen a search term from the agent's recent activity
    When I search the Activity Log for "  <<recent activity term>>  "
    Then the Activity Log URL should carry the search term "<<recent activity term>>"
    And the Activity Log request should carry the search term "<<recent activity term>>"

  @edge-case @needs-clarification
  Scenario: Verify that a whitespace-only search applies no filter
    When I select the "This year" date range
    And I note the Activity Log total
    And I search the Activity Log for "   "
    Then the Activity Log URL should carry no search parameter
    And the Activity Log request should carry no search parameter
    And the Activity Log total should equal the noted total

  @negative
  Scenario: Verify that a term the log cannot contain is handled safely rather than erroring
    Then each of these search terms should be handled safely:
      | label            | term                      |
      |   300 characters | <<300 chars>>             |
      | sql fragment     | ' OR 1=1 --               |
      | script tag       | <script>alert(1)</script> |
      | non-latin script | 日本語                    |
      | percent escapes  | %26%3D                    |

  @positive @needs-clarification
  Scenario: Verify that the search also matches the actor, which no entry displays
    When I select the "This year" date range
    And I search the Activity Log by the signed-in agent's own name
    Then at least one entry should be listed
    And the fields the search matched should be reported for the PO
  # SECTION 4 - THE SEARCH AND THE DATE RANGE TOGETHER

  @positive
  Scenario: Verify that the search and the date range compose, each surviving a change to the other, and that the list returns
    Given I have chosen a search term from the agent's recent activity
    When I select the "This year" date range
    And I note the Activity Log total
    And I search the Activity Log for "<<recent activity term>>"
    Then the Activity Log total should be no greater than the noted total
    And at least one entry should be listed
    When I select the "Last 30 days" date range
    Then the Activity Log request should carry the date range "last_30_days"
    And the Activity Log request should carry the search term "<<recent activity term>>"
    And the Activity Log search box should contain "<<recent activity term>>"
    And the Activity Log URL should carry the search term "<<recent activity term>>"
    And the Activity Log URL should carry the date range "last_30_days"
    And the Activity Log total should be no greater than the noted total
    When I clear the Activity Log search
    Then the date-range filter should show "Last 30 days"
    And the Activity Log request should carry the date range "last_30_days"
    And the Activity Log URL should carry no search parameter
    When I select the "This year" date range
    Then the Activity Log total should equal the noted total
    And the Activity Log search box should be empty
  # SECTION 5 - THE EMPTY STATE

  @negative
  Scenario: Verify that a term matching nothing replaces the list with the empty state, and that clearing it restores the list
    When I select the "This year" date range
    And I note the Activity Log total
    And I search the Activity Log for "zzzz-no-such-activity-zzzz"
    Then no entry should be listed
    And the Activity Log empty state should be displayed
    And the Activity Log entry list should not be rendered at all
    And the Activity Log page should still be usable
    When I clear the Activity Log search
    Then at least one entry should be listed
    And the Activity Log empty state should not be displayed
    And the Activity Log URL should carry no search parameter
    And the Activity Log request should carry no search parameter
    And the Activity Log total should equal the noted total
    And the Activity Log search box should be empty

  # Search-only and combined states use the search-and-filters wording; date-range-only uses the
  # filters wording. All narrowed states offer Clear all filters.
  @negative
  Scenario: Verify that the empty state reads exactly as specified for a search, a date range, or both
    Then the Activity Log empty state should read exactly as follows:
      | applied           | search                     | range     | heading          | message                                                                | clear all         |
      | search only       | zzzz-no-such-activity-zzzz | -         | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | date range only   | -                          | This year | No results found | We couldn't find any results matching your current filters.            | Clear all filters |
      | search and filter | zzzz-no-such-activity-zzzz | This year | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |

  @positive
  Scenario: Verify that Clear all filters removes both the search and the date range and returns to the default view
    When I open the Activity Log with the date range "this_year" and the search term "zzzz-no-such-activity-zzzz"
    And I click Clear All in the Activity Log empty state
    Then the Activity Log URL should carry no search parameter
    And the Activity Log request should carry no search parameter
    And the Activity Log search box should be empty
    And the date-range filter should show "Last 7 days"
    And the Activity Log request should carry the date range "last_7_days"
    When I reload the Activity Log
    Then the Activity Log search box should be empty
    And the date-range filter should show "Last 7 days"
    And the Activity Log URL should carry no search parameter

  # SECTION 6 - PAGING, WHICH IS WHAT A SEARCH OR A RANGE RESETS

  @positive
  Scenario: Verify that the list pages by scrolling and appends, which is why it offers no pagination control
    When I select the "This year" date range
    And I scroll the Activity Log to the end twice
    Then each scroll should have requested the next page in order
    And the number of entries listed should have grown with each scroll
    And the Activity Log should offer no pagination control
    And the server should report more entries than the page renders

  @positive
  Scenario: Verify that a new search or a new date range restarts the list at the first page
    Given I have chosen a search term from the agent's recent activity
    When I select the "This year" date range
    And I scroll the Activity Log to the end twice
    And I search the Activity Log for "<<recent activity term>>"
    Then the Activity Log request should carry the first page
    And the Activity Log should be scrolled back to the top
    When I scroll the Activity Log to the end twice
    And I select the "Last 30 days" date range
    Then the Activity Log request should carry the first page
    And the Activity Log should be scrolled back to the top
  # SECTION 7 - END TO END

  @positive
  Scenario: Verify that an agent can narrow by range and term, reload into the same view, and share the link
    Given I have chosen a search term from the agent's recent activity
    When I select the "Last 6 months" date range
    And I search the Activity Log for "<<recent activity term>>"
    And I note the Activity Log total
    And I note the Activity Log URL
    And I reload the Activity Log
    Then the date-range filter should show "Last 6 months"
    And the Activity Log search box should contain "<<recent activity term>>"
    And the Activity Log request should carry the date range "last_6_months"
    And the Activity Log request should carry the search term "<<recent activity term>>"
    And the Activity Log total should equal the noted total
    And the Activity Log URL should be the noted URL
    When I open the Activity Log with the date range "last_30_days" and the search term "<<recent activity term>>"
    Then the date-range filter should show "Last 30 days"
    And the Activity Log search box should contain "<<recent activity term>>"
    And the Activity Log request should carry the date range "last_30_days"
    And the Activity Log request should carry the search term "<<recent activity term>>"
    And every listed entry should match the Activity Log search term

  @positive
  Scenario: Verify that what the agent selects survives a page refresh
    Given I have chosen a search term from the agent's recent activity
    Then each of these selections should survive a page refresh:
      | selection                        | range         | search |
      | nothing - the default            | -             | -      |
      | a date range only                | Last 30 days  | -      |
      | the default range picked again   | Last 7 days   | -      |
      | a search only                    | -             | <<recent activity term>> |
      | a date range and a search        | Last 3 months | <<recent activity term>> |

  @negative
  Scenario: Verify that an empty state survives a page refresh with its message and Clear All intact
    When I open the Activity Log with the date range "this_year" and the search term "zzzz-no-such-activity-zzzz"
    And I note the Activity Log empty state
    And I reload the Activity Log
    Then the Activity Log empty state should be the noted one
    And the Activity Log search box should contain "zzzz-no-such-activity-zzzz"
    And the date-range filter should show "This year"
    And no entry should be listed
