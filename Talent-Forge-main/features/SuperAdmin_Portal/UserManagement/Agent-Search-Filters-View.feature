#FIXED and one BUG
@agent-management @superadmin
Feature: SuperAdmin User Management - Agents (structure, search, filters, pagination, view)

  Background:
    Given I am logged in as the superadmin
    And I am on the Agents listing
  # ==================== STRUCTURE & NAVIGATION ====================

  @positive
  Scenario: Verify that the Agents listing opens on the Active tab with its full structure
    Then the agents page heading should be "User Management - Agents"
    And the agent search box should invite a search
    And the "Invite Agent" call to action should link to the invite form
    And the lifecycle tabs should be:
      | Active             |
      | Invite Sent        |
      | Requires Attention |
      | Deactivated        |
    And the "Active" tab should be the selected tab
    And the "Filters" button should be available
    And the agent grid should be visible

  @positive
  Scenario: Verify that each lifecycle tab renders its own columns and row actions
    Then each lifecycle tab should render its own columns and row actions:
      | tab                | param             | columns                                                                       | actions               | menu                        |
      | Active             |                   | Agent, University, Status, Total Candidates, Monthly Target Progress, Actions | View, Edit, Open menu | Log in as agent, Deactivate |
      | Invite Sent        | inviteSent        | Agent, University, Status, Actions                                            | Edit, Resend Invite   |                             |
      | Requires Attention | requiresAttention | Agent, University, Issue, Severity, Last Activity, Actions                    | View, Notify          |                             |
      | Deactivated        | deactivated       | Agent, University, Status, Transferred Candidates to, Actions                 | View, Reactivate      |                             |
  # ==================== SEARCH ====================

  @positive
  Scenario: Verify that an agent can be found by name, by email and by university
    Given I have noted the first agent on the Active tab
    Then searching the agents should find that agent by each of:
      | field           |
      | full name       |
      | first name only |
      | name uppercased |
      | full email      |
      | university      |

  @negative
  Scenario: Verify that a search matching no agent shows the empty state and stays safe
    Then searching the agents for each of these terms should return nothing and not break the page:
      | term               |
      | ZZZNONEXISTENT999  |
      | a' OR 1=1 --       |
      | <script>x</script> |
    And the listing empty state should read "We couldn't find any results matching your current search."

  @positive
  Scenario: Verify that clearing the search restores the full agent list
    Given I have noted the first agent on the Active tab
    And I search the agents for that agent's name
    Then exactly 1 agent should be listed
    When I clear the agent search
    Then the search box should be empty
    And more than 1 agent should be listed
    And the agent grid should be visible

  @edge-case
  Scenario: Verify that a whitespace-only search is ignored rather than sent to the server
    When I search the agents for "   "
    Then no agent list request should have been sent
    And the URL should not contain a search term
    And more than 1 agent should be listed

  @positive
  Scenario: Verify that a search narrows the results within a non-default tab
    When I open the "Deactivated" agents tab
    And I have noted the first agent on the current tab
    And I search the agents for that agent's name
    Then that agent should be listed
    And the "Deactivated" tab should still be the selected tab
    And the agents URL should contain the search term
  # ==================== FILTERS ====================

  @positive
  Scenario: Verify that the Filters modal presents every group with its correct options
    When I open the Filters modal
    Then the filter modal heading should be "Apply Filters"
    And the filter modal should offer the groups:
      | University      |
      | Target Progress |
      | Candidate Count |
    And the "Target Progress" group should offer the options:
      |   1% - 25% |
      |  26% - 50% |
      |  51% - 75% |
      | 76% - 100% |
    And the "Candidate Count" group should offer the options:
      |      0 |
      |   1-50 |
      | 51-100 |
      |   100+ |
    And no filter option should be selected
    And the filter modal should offer "Clear All", "Cancel" and "Apply Filters"

  @positive
  Scenario: Verify that applying each filter option returns only agents that satisfy it
    Then applying each filter option should return only agents that satisfy it:
      | group           | option     | param                 | apiParam               |
      | Target Progress |   1% - 25% | targetProgress=1-25   | target_progress=1-25   |
      | Target Progress |  26% - 50% | targetProgress=26-50  | target_progress=26-50  |
      | Target Progress |  51% - 75% | targetProgress=51-75  | target_progress=51-75  |
      | Target Progress | 76% - 100% | targetProgress=76-100 | target_progress=76-100 |
      | Candidate Count |          0 | candidateCount=0      | candidate_count=0      |
      | Candidate Count |       1-50 | candidateCount=1-50   | candidate_count=1-50   |
      | Candidate Count |     51-100 | candidateCount=51-100 | candidate_count=51-100 |
      | Candidate Count |       100+ | candidateCount=100%2B | candidate_count=100%2B |
  #BUG LOGGED

  @positive
  Scenario: Verify that two options in the same group return the union of both
    When I note the number of agents matching "Candidate Count" option "0"
    And I note the number of agents matching "Candidate Count" option "1-50"
    And I am on the Agents listing
    And I open the Filters modal
    And I select the agent filter "0" under "Candidate Count"
    And I select the agent filter "1-50" under "Candidate Count"
    And I apply the agent filters
    Then the agents URL should contain the filter "candidateCount=0"
    And the agents URL should contain the filter "candidateCount=1-50"
    And the number of matching agents should equal the sum of the two noted counts
    And the "Filters" button should show an applied-filter count of 2

  @positive
  Scenario: Verify that filters from two groups return only agents satisfying both
    When I open the Filters modal
    And I select the agent filter "1-50" under "Candidate Count"
    And I apply the agent filters
    Then every agent returned should have between 1 and 50 candidates
    When I open the Filters modal
    And I open the university suggestions
    And I choose a university that has agents
    And I apply the agent filters
    Then every agent returned should have between 1 and 50 candidates
    And every agent returned should belong to the chosen university
    And the "Filters" button should show an applied-filter count of 2
    When I open the Filters modal
    Then the "1-50" option under "Candidate Count" should be selected

  @positive
  Scenario: Verify that Clear All in the modal clears every selection and the applied filters
    When I open the Filters modal
    And I select the agent filter "0" under "Candidate Count"
    And I select the agent filter "76% - 100%" under "Target Progress"
    And I apply the agent filters
    And I open the Filters modal
    And I clear all agent filters in the modal
    Then no filter option should be selected
    And the filter modal should still be open
    And the agents URL should not contain any filter parameters
    And the "Filters" button should show no applied-filter count

  @positive
  Scenario: Verify that Cancel discards filter selections that were never applied
    When I open the Filters modal
    And I select the agent filter "100+" under "Candidate Count"
    And I cancel the agent filters
    Then the agent filter modal should not be visible
    And the agents URL should not contain any filter parameters
    And the "Filters" button should show no applied-filter count
    When I open the Filters modal
    Then no filter option should be selected

  @positive
  Scenario: Verify that the Filters modal can be dismissed by every available means
    Then the filter modal should close via each of:
      | method   |
      | X icon   |
      | Cancel   |
      | Escape   |
      | backdrop |

  @negative
  Scenario: Verify that a filter combination matching no agent shows the filtered empty state
    When I open the Filters modal
    And I select the agent filter "0" under "Candidate Count"
    And I select the agent filter "76% - 100%" under "Target Progress"
    And I apply the agent filters
    Then no agents should be listed
    And the listing empty state heading should be "No results found"
    And the listing empty state should read "We couldn't find any results matching your current filters."
    And the empty state should offer a "Clear all filters" call to action
    When I clear the filters from the empty state
    Then more than 1 agent should be listed
    And the agents URL should not contain any filter parameters

  @positive
  Scenario: Verify that filtering by university returns only agents of that university
    When I open the Filters modal
    And I open the university suggestions
    Then the university list should offer at least one university
    When I type "King" into the university filter
    Then every university offered should contain "King"
    When I choose a university that has agents
    And I apply the agent filters
    Then the URL should contain the chosen university
    And every agent returned should belong to the chosen university
    When I open the Filters modal
    And I type "ZZZZNOSUCHUNIVERSITY" into the university filter
    Then the university list should offer no universities
    And the university list should say why nothing matched
  # ==================== PAGINATION ====================
  # Measured 2026-10-26 (scripts/probe-agents-pagination-full.js, read-only): 10 agents a page;
  # ?page=<n> in the URL (page 1 writes none) and in the request alongside the tab's status; a
  # "Pagination Navigation" pager of Previous | five numbers plus the first and last | Next with an
  # ellipsis for each gap; each tab pages its own list; search, filter and tab switch go back to
  # page 1; a reload keeps the page; no pager when the result fits on one page. Every expectation
  # is derived from the server's own count at run time - no page number or total is pinned.
  # The paging scenarios that lived in Agent-Listing-Edge-Cases.feature were moved here.

  @positive @smoke
  Scenario: Verify that pagination moves through the agent list without repeating agents
    Then the pagination controls should be visible
    And the "Previous" control should be disabled on the first page
    When I note the agents listed on the current page
    And I go to the next page
    Then the URL should contain "page=2"
    And none of the previously noted agents should be listed again
    And the "Previous" control should be enabled
    When I go to the previous page
    Then the agents listed should match the first page again

  @positive
  Scenario: Verify that Next asks the server for the next page and the pager marks it current
    Given I have opened the "Agents" listing
    Then the "Agents" pager should mark page 1 as the current page
    When I go to the "Next" page of the "Agents" listing
    Then the "Agents" listing should show page 2 of the server's results
    And the "Agents" pager should mark page 2 as the current page
    And none of the first page's rows should be listed again on the "Agents" listing
    When I go to the "Previous" page of the "Agents" listing
    Then the "Agents" pager should mark page 1 as the current page
    And the "Agents" listing should show the first page it showed before

  @positive
  Scenario: Verify that a numbered page control jumps straight to that agent page
    Given I have opened the "Agents" listing
    When I choose page 2 from the "Agents" pager
    Then the "Agents" listing should show page 2 of the server's results
    And the "Agents" pager should mark page 2 as the current page
    And none of the first page's rows should be listed again on the "Agents" listing

  @positive
  Scenario: Verify that the last agent page holds the remainder and offers no Next
    Given I have opened the "Agents" listing
    When I open the last page of the "Agents" listing
    Then the "Agents" listing should list exactly the remainder of the server's count
    And the "Agents" pager should disable "Next" and enable "Previous"

  @positive
  Scenario: Verify that the pager always offers the first and last pages and the pages around the current one
    Given I have opened the "Agents" listing
    Then the "Agents" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap
    When I open the "Agents" listing at page 4
    Then the "Agents" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap
    When I open the last page of the "Agents" listing
    Then the "Agents" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap

  @positive
  Scenario: Verify that every tab pages through its own list of agents
    Then each "Agents" tab should page through its own list:
      | tab                | status           | url               |
      | Active             | ACTIVE,ATTENTION |                   |
      | Invite Sent        | INVITE_SENT      | inviteSent        |
      | Requires Attention | ATTENTION        | requiresAttention |
      | Deactivated        | DEACTIVATED      | deactivated       |

  @positive
  Scenario: Verify that a page opened from the URL or kept across a reload shows that page
    Given I have opened the "Agents" listing
    When I open the "Agents" listing at page 3
    Then the "Agents" listing should show page 3 of the server's results
    And the "Agents" pager should mark page 3 as the current page
    When I reload the "Agents" listing
    Then the "Agents" listing should show page 3 of the server's results
    And the "Agents" pager should mark page 3 as the current page

  @positive
  Scenario: Verify that the agent grid keeps the order the server returns
    Given I have opened the "Agents" listing
    Then the "Agents" grid should list its rows in the server's order on the first and a later page

  @positive
  Scenario: Verify that the pager can be operated from the keyboard
    Given I have opened the "Agents" listing
    Then the "Agents" pager should be operable from the keyboard

  @negative
  Scenario: Verify that Previous on the first page and Next on the last page are disabled and do nothing
    Given I have opened the "Agents" listing
    Then the "Agents" pager should disable "Previous" and pressing it should change nothing
    When I open the last page of the "Agents" listing
    Then the "Agents" pager should disable "Next" and pressing it should change nothing

  @negative
  Scenario: Verify that a search narrowed to a single agent shows no pager
    Given I have opened the "Agents" listing
    When I search the "Agents" listing for the first email on this page
    Then the "Agents" pager should not be shown
  # Was @known-issue (it blamed the connection). FIXED by 2026-10-26: it now says the page does not
  # exist. Opened far past the end, since the list grows while the suite runs.

  @negative
  Scenario: Verify that a page beyond the last agent page says it does not exist rather than blaming the connection
    Given I have opened the "Agents" listing
    When I open the "Agents" listing far beyond its last page
    Then the "Agents" listing should say the page does not exist and list no rows

  @edge-case
  Scenario: Verify that an unusable page number falls back to the first page of agents
    Then opening the "Agents" listing with each page value should fall back to the first page:
      | page |
      | abc  |
      |    0 |
      |   -1 |
  # Measured: the app sends page=2.5 to the server, which answers 404, while abc/0/-1 fall back to
  # page 1. Asserted as measured; ask the PO whether a fractional page should fall back too.

  @edge-case @needs-clarification
  Scenario: Verify that a fractional page number is reported as a page that does not exist
    Given I have opened the "Agents" listing
    When I open the "Agents" listing with the page value "2.5"
    Then the "Agents" listing should say the page does not exist and list no rows

  @edge-case
  Scenario: Verify that a search from a later page starts again at page 1, and so does clearing it
    Given I have opened the "Agents" listing
    When I open the "Agents" listing at page 3
    And I search the "Agents" listing for "a"
    Then the "Agents" listing should be back on page 1 with no page in the URL
    When I clear the "Agents" listing search
    Then the "Agents" listing should be back on page 1 with no page in the URL

  @edge-case
  Scenario: Verify that applying a filter from a later page starts again at page 1
    Given I have opened the "Agents" listing
    When I open the "Agents" listing at page 3
    And I apply the first filter option on the "Agents" listing
    Then the "Agents" listing should be back on page 1 with no page in the URL

  @edge-case
  Scenario: Verify that switching tab from a later page starts the new tab at page 1
    Given I have opened the "Agents" listing
    When I open the "Agents" listing at page 3
    And I switch the "Agents" listing to the "Deactivated" tab
    Then the "Agents" listing should be back on page 1 with no page in the URL
    And the "Agents" pager should mark page 1 as the current page

  @edge-case @needs-clarification
  Scenario: Verify that changing page replaces the browser history entry rather than adding one
    Given I have opened the "Agents" listing
    Then changing page on the "Agents" listing should not add a browser history entry

  @positive @e2e
  Scenario: Verify that opening an agent from a later page and going Back returns to that same page
    Given I have opened the "Agents" listing
    When I open the last page of the "Agents" listing
    And I note the rows on the "Agents" listing
    And I open the first agent listed on the current page
    Then I should be on the agent profile page
    When I go back from the agent profile with the browser
    Then the "Agents" listing should be back on the same page with the same rows

  @positive @e2e
  Scenario: Verify that a tab's second page survives a reload and a visit to an agent profile
    Given I have opened the "Agents" listing
    When I switch the "Agents" listing to the "Deactivated" tab
    And I note this as the first page of the "Agents" listing
    And I go to the "Next" page of the "Agents" listing
    Then the "Agents" listing should show page 2 of the server's results
    When I reload the "Agents" listing
    Then the "Agents" listing should show page 2 of the server's results
    And none of the first page's rows should be listed again on the "Agents" listing
    When I note the rows on the "Agents" listing
    And I open the first agent listed on the current page
    Then I should be on the agent profile page
    When I go back from the agent profile with the browser
    Then the "Agents" listing should be back on the same page with the same rows
    When I go to the "Previous" page of the "Agents" listing
    Then the "Agents" pager should mark page 1 as the current page
    And the "Agents" listing should show the first page it showed before
  # ==================== VIEW ====================

  @positive
  Scenario: Verify that View opens the agent profile with the agent's identity and actions
    Given I have noted the first agent on the Active tab
    When I view that agent's profile
    Then I should be on the agent profile page
    And the profile should show that agent's name and email
    And the profile should show that agent's university
    And the profile should offer the inline action "Edit Target"
    And the profile overflow menu should offer "Log in as agent, Deactivate"
    And the profile tabs should be:
      | Performance Overview |
      | Candidates           |
      | Promo Tools          |
      | Activity Log         |
    And the "Performance Overview" tab should be the selected tab

  @positive
  Scenario: Verify that the profile opens on Performance Overview whichever tab it is reached from
    Then opening an agent profile should render the same tabs with "Performance Overview" selected, from each of these tabs:
      | tab                | tabs                                                        | menu                        |
      | Active             | Performance Overview, Candidates, Promo Tools, Activity Log | Log in as agent, Deactivate |
      | Requires Attention | Performance Overview, Candidates, Promo Tools, Activity Log | Log in as agent, Deactivate |
      | Deactivated        | Performance Overview, Candidates, Promo Tools, Activity Log | Reactivate                  |

  @positive
  Scenario: Verify that every profile tab is reachable and records itself in the URL
    Given I have noted the first agent on the Active tab
    And I view that agent's profile
    Then each profile tab should open and record itself in the URL:
      | tab                  | param       |
      | Performance Overview |             |
      | Candidates           | candidates  |
      | Promo Tools          | promoTools  |
      | Activity Log         | activityLog |

  @positive
  Scenario: Verify that the profile's Performance Overview reports the agent's target progress
    Given I have found an agent holding active candidates
    When I view that agent's profile
    Then the Performance Overview should show the sections:
      | Target Progress       |
      | Candidate Onboarding  |
      | Revenue Impact        |
      | Pending Verifications |
    And the pending verification breakdown should cover:
      | Transcripts        |
      | Experience Letters |
      | Certifications     |
    And the target progress should offer the periods:
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |

  @edge-case
  Scenario: Verify that an agent's candidate count and target progress agree across every view
    Given I have found an agent holding active candidates
    When I view that agent's profile
    Then the profile's target progress should agree with the listing row and the server

  @positive
  Scenario: Verify that the profile's Candidates tab lists the agent's candidates with its own columns
    Given I have found an agent holding active candidates
    When I view that agent's profile
    And I open the "Candidates" profile tab
    Then the candidates grid should have the columns:
      | Candidate            |
      | Account Verification |
      | Account Status       |
      | Pending Documents    |
      | Subscription Status  |
      | Last Activity        |
      | Actions              |
    And at least one candidate should be listed

  @positive
  Scenario: Verify that the Activity Log offers its reporting periods and lists dated entries
    Given I have noted the first agent on the Active tab
    When I view that agent's profile
    And I open the "Activity Log" profile tab
    Then the activity log should offer the periods:
      | Last 24 hours |
      | Last 7 days   |
      | Last 30 days  |
      | Last 3 months |
      | Last 6 months |
      | This year     |

  @positive
  Scenario: Verify that Back returns from the agent profile to the Agents listing
    Given I have noted the first agent on the Active tab
    When I view that agent's profile
    Then I should be on the agent profile page
    When I click the profile "Back" control
    Then I should be on the Agents listing
    And the agent grid should be visible

  @positive @needs-clarification
  Scenario: Verify that Back always returns to the Active tab, whichever tab the profile was opened from
    Then returning from an agent profile should land on the Agents listing for each of these tabs:
      | tab                | lands_on |
      | Active             | Active   |
      | Requires Attention | Active   |
      | Deactivated        | Active   |
  # ==================== EDIT TARGET ====================

  @positive
  Scenario: Verify that Edit Target opens with the agent's current monthly target
    Given I have noted the first agent on the Active tab
    When I view that agent's profile
    And I open the Edit Target modal
    Then the Edit Target modal heading should be "Edit Target"
    And the Edit Target modal should ask for a numeric monthly performance target
    And the Edit Target field should hold that agent's current target
    And the Edit Target modal should offer "Cancel" and "Save Changes"
    When I cancel the Edit Target modal
    Then the Edit Target modal should not be visible
  # Was @known-issue (Save always enabled, no validation). FIXED in the build by 2026-10-22: each
  # value now shows an inline error and Save is disabled - a regression lock now. The exact
  # messages are asserted in Agent-View-Profile.feature.

  @negative
  Scenario: Verify that Edit Target refuses an empty, zero, negative or non-numeric target
    Given I have noted the first agent on the Active tab
    When I view that agent's profile
    And I open the Edit Target modal
    Then the Edit Target modal should refuse each invalid target:
      | target | why                              |
      |        | empty, but the field is required |
      |      0 | a monthly target of none         |
      |     -5 | a negative target                |
      | abc    | not a number at all              |
  # ==================== END TO END ====================

  @positive @e2e
  Scenario: Verify that browser Back restores the filtered and searched agent list
    When I open the Filters modal
    And I open the university suggestions
    And I choose a university that has agents
    And I apply the agent filters
    Then every agent returned should belong to the chosen university
    And I have noted the first agent on the current tab
    When I search the agents for that agent's name
    Then that agent should be listed
    When I view that agent's profile
    Then I should be on the agent profile page
    And the profile should show that agent's name and email
    When I use the browser Back button
    Then I should be on the Agents listing
    And the URL should contain the chosen university
    And the agents URL should contain the search term

  @positive @e2e
  Scenario: Verify that the profile Back control returns to the default agents listing
    When I open the Filters modal
    And I open the university suggestions
    And I choose a university that has agents
    And I apply the agent filters
    And I have noted the first agent on the current tab
    When I search the agents for that agent's name
    And I view that agent's profile
    Then I should be on the agent profile page
    When I click the profile "Back" control
    Then I should be on the Agents listing
    And the agents URL should not contain any filter parameters
    And the URL should not contain a search term

  @edge-case @e2e
  Scenario: Verify that a search and a filter survive together across a reload and a tab switch
    Given I have noted the first agent on the Active tab
    When I open the Filters modal
    And I select the agent filter "0" under "Candidate Count"
    And I apply the agent filters
    And I search the agents for that agent's first name
    Then the agents URL should contain the search term
    And the agents URL should contain the filter "candidateCount=0"
    And the "Filters" button should show an applied-filter count of 1
    When I reload the Agents listing
    Then the agents URL should contain the search term
    And the agents URL should contain the filter "candidateCount=0"
    And the search box should still hold the search term
    And the "Filters" button should show an applied-filter count of 1
    When I open the "Deactivated" agents tab
    Then the agents URL should contain the search term
    And the agents URL should contain the filter "candidateCount=0"
    And the "Filters" button should show an applied-filter count of 1
