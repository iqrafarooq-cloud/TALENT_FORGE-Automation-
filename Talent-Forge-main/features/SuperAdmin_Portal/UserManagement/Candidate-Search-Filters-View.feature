@candidate-management @superadmin
Feature: SuperAdmin User Management - Candidates (structure, search, filters, pagination, view)

  Background:
    Given I am logged in as the superadmin
    And I am on the Candidates listing
  # ==================== STRUCTURE & NAVIGATION ====================

  @positive
  Scenario: Verify that the Candidates listing opens on the All tab with its full structure
    Then the candidates page heading should be "User Management - Candidates"
    And the candidate search box should invite a search
    And the candidate lifecycle tabs should be:
      | All         |
      | Active      |
      | Deactivated |
    And the "All" candidates tab should be the selected tab
    And the candidate "Filters" button should be available
    And the candidate grid should be visible
    And the candidate grid should have the columns:
      | Candidate            |
      | Agent                |
      | Account Status       |
      | Account Verification |
      | Pending Documents    |
      | Subscription Status  |
      | Last Activity        |
      | Actions              |

  @positive
  Scenario: Verify that each lifecycle tab renders its own columns and row actions
    Then each candidates tab should render its own columns and row actions:
      | tab         | param       | columns                                                                                                                | actions                        |
      | All         |             | Candidate, Agent, Account Status, Account Verification, Pending Documents, Subscription Status, Last Activity, Actions | View, Edit, Deactivate account |
      | Active      | active      | Candidate, Agent, Account Status, Account Verification, Pending Documents, Subscription Status, Last Activity, Actions | View, Edit, Deactivate account |
      | Deactivated | deactivated | Candidate, Agent, Account Status, Account Verification, Pending Documents, Subscription Status, Last Activity, Actions | View, Edit, Reactivate Account |

  @edge-case
  Scenario: Verify that every row action is an icon button that names itself to assistive technology
    Then every candidate row action should expose an accessible name

  @edge-case @needs-clarification
  Scenario: Verify that a row's account status means the same thing in the grid and in the payload
    When I open the "Deactivated" candidates tab
    Then the rendered account status and the payload's should be reported side by side
  # ==================== SEARCH ====================

  @positive
  Scenario: Verify that a candidate can be found by name and by email
    Given I have noted the first candidate on the "All" tab
    Then searching the candidates should find that candidate by each of:
      | field           |
      | full name       |
      | first name only |
      | name uppercased |
      | full email      |

  @negative
  Scenario: Verify that a search matching no candidate shows the empty state and stays safe
    Then searching the candidates for each of these terms should return nothing and not break the page:
      | term               |
      | ZZZNONEXISTENT999  |
      | a' OR 1=1 --       |
      | <script>x</script> |
    And the candidates empty state heading should be "No results found"
    And the candidates empty state should read "We couldn't find any results matching your current search."

  @negative
  Scenario: Verify that the search empty state offers no way out, unlike the filtered one
    When I search the candidates for "ZZZNONEXISTENT999"
    Then no candidates should be listed
    And the candidates empty state should offer no call to action
    When I clear the candidate search
    Then more than 1 candidate should be listed

  @positive
  Scenario: Verify that clearing the search restores the full candidate list
    Given I have noted the first candidate on the "All" tab
    And I search the candidates for that candidate's full email
    Then exactly 1 candidate should be listed
    When I clear the candidate search
    Then the candidate search box should be empty
    And more than 1 candidate should be listed
    And the candidate grid should be visible

  @edge-case
  Scenario: Verify that a whitespace-only search is kept out of the URL and its server request is reported
    When I search the candidates for "   "
    Then the candidates URL should not contain a search term
    And more than 1 candidate should be listed
    And what the whitespace-only search sent to the server should be reported

  @positive
  Scenario: Verify that a search narrows the results within a non-default tab
    When I open the "Deactivated" candidates tab
    And I have noted the first candidate on the current tab
    And I search the candidates for that candidate's full email
    Then that candidate should be listed
    And the "Deactivated" candidates tab should still be the selected tab
    And the candidates URL should contain the search term
  # ==================== FILTERS ====================

  # >>> THE "Status" GROUP WAS REMOVED FROM THIS MODAL (measured 2026-10-19). <<< Account status
  # is chosen ONLY by the All / Active / Deactivated tabs now - on every tab the modal offers the
  # four groups below. That removal is the product's fix for the old "a Status filter is silently
  # discarded on a lifecycle tab" defect, so every scenario that used to set Status drives the
  # matching TAB instead. "30+ days" was relabelled "Inactive (30+ days)" in the same change.
  @positive
  Scenario: Verify that the Filters modal presents every group with its correct options
    When I open the candidate Filters modal
    Then the candidate filter modal heading should be "Apply Filters"
    And the candidate filter modal should offer the groups:
      | Account Verification Status |
      | Pending Documents           |
      | Subscription Status         |
      | Last Activity               |
    And each candidate filter group should offer its own options and control type:
      | group                       | control  | options                                                       |
      | Account Verification Status | checkbox | Verified, Unverified                                          |
      | Pending Documents           | radio    |                                                    0, 1-2, 3+ |
      | Subscription Status         | checkbox | Subscribed, Not Subscribed, Payment Due                       |
      | Last Activity               | radio    | Last 24 hours, Last 7 days, Last 30 days, Inactive (30+ days) |
    And no candidate filter option should be selected
    And the candidate filter modal should offer "Clear All", "Cancel" and "Apply Filters"

  @positive
  Scenario: Verify that applying each filter option records itself in the URL and on the request
    Then applying each candidate filter option should record itself in the URL and on the request:
      | group                       | option         | param                            | apiParam                           |
      | Account Verification Status | Verified       | accountVerification=verified     | verification_status=verified       |
      | Account Verification Status | Unverified     | accountVerification=unverified   | verification_status=unverified     |
      | Pending Documents           |              0 | pendingDocuments=0               | pending_documents=0                |
      | Pending Documents           |            1-2 | pendingDocuments=1-2             | pending_documents=1-2              |
      | Pending Documents           |             3+ | pendingDocuments=3plus           | pending_documents=3+               |
      | Subscription Status         | Subscribed     | subscriptionStatus=subscribed    | subscription_status=subscribed     |
      | Subscription Status         | Not Subscribed | subscriptionStatus=notSubscribed | subscription_status=not_subscribed |
      | Subscription Status         | Payment Due    | subscriptionStatus=paymentDue    | subscription_status=payment_due    |
      | Last Activity               | Last 24 hours  | lastActivity=24h                 | last_activity=24h                  |
      | Last Activity               | Last 7 days    | lastActivity=7days               | last_activity=7d                   |
      | Last Activity               | Last 30 days   | lastActivity=30days              | last_activity=30d                  |
      | Last Activity               | Inactive (30+ days) | lastActivity=inactive     | last_activity=inactive             |

  @positive
  Scenario: Verify that each Verification filter returns only candidates that satisfy it
    Then applying each of these candidate filters should return only candidates that satisfy it:
      | group                       | option     | rule       |
      | Account Verification Status | Verified   | verified   |
      | Account Verification Status | Unverified | unverified |

  # The Active / Deactivated rows used to be Status-filter rows. The tabs are now the only way
  # to filter by account status, so they carry that rule - checked against the server's payload.
  @positive
  Scenario: Verify that each lifecycle tab returns only candidates in that account state
    When I open the "Active" candidates tab
    Then every candidate returned should be "active"
    And the candidates URL should contain the filter "accountTab=active"
    When I open the "Deactivated" candidates tab
    Then every candidate returned should be "deactivated"
    And the candidates URL should contain the filter "accountTab=deactivated"

  @edge-case
  Scenario: Verify that the two radio groups are single-select and replace rather than union
    When I open the candidate Filters modal
    And I select the candidate filter "0" under "Pending Documents"
    And I select the candidate filter "3+" under "Pending Documents"
    Then the candidate filter "3+" under "Pending Documents" should be the only one selected
    When I select the candidate filter "Last 24 hours" under "Last Activity"
    And I select the candidate filter "Inactive (30+ days)" under "Last Activity"
    Then the candidate filter "Inactive (30+ days)" under "Last Activity" should be the only one selected
    When I apply the candidate filters
    Then the candidates URL should contain the filter "pendingDocuments=3plus"
    And the candidates URL should contain the filter "lastActivity=inactive"
    And the candidates URL should not contain the filter "pendingDocuments=0"
    And the candidate "Filters" button should show an applied-filter count of 2

  @positive
  Scenario: Verify that two options in one checkbox group return the union of both
    When I note the number of candidates matching "Subscription Status" option "Subscribed"
    And I note the number of candidates matching "Subscription Status" option "Not Subscribed"
    And I am on the Candidates listing
    And I open the candidate Filters modal
    And I select the candidate filter "Subscribed" under "Subscription Status"
    And I select the candidate filter "Not Subscribed" under "Subscription Status"
    And I apply the candidate filters
    Then the candidates URL should contain the filter "subscriptionStatus=subscribed"
    And the candidates URL should contain the filter "subscriptionStatus=notSubscribed"
    And the number of matching candidates should equal the sum of the two noted counts
    And the candidate "Filters" button should show an applied-filter count of 1
    And the applied-filter count should be reported as counting groups rather than options

  # Two groups, applied in turn, on top of a lifecycle tab - so the tab and both filters must
  # all hold at once. Each rule is checked against the server's payload.
  @positive
  Scenario: Verify that filters from two groups on a lifecycle tab return only candidates satisfying all of them
    When I open the "Active" candidates tab
    And I open the candidate Filters modal
    And I select the candidate filter "Verified" under "Account Verification Status"
    And I apply the candidate filters
    Then every candidate returned should be "active"
    And every candidate returned should be "verified"
    When I open the candidate Filters modal
    And I select the candidate filter "0" under "Pending Documents"
    And I apply the candidate filters
    Then every candidate returned should be "active"
    And every candidate returned should be "verified"
    And every candidate returned should be "without pending documents"
    And the candidate "Filters" button should show an applied-filter count of 2
    And the "Active" candidates tab should still be the selected tab
    When I open the candidate Filters modal
    Then the candidate filter "Verified" under "Account Verification Status" should be selected
    And the candidate filter "0" under "Pending Documents" should be selected

  @positive
  Scenario: Verify that Clear All in the modal clears every selection and the applied filters
    When I open the candidate Filters modal
    And I select the candidate filter "Verified" under "Account Verification Status"
    And I select the candidate filter "3+" under "Pending Documents"
    And I apply the candidate filters
    And I open the candidate Filters modal
    And I clear all candidate filters in the modal
    Then no candidate filter option should be selected
    And the candidate filter modal should still be open
    And the candidates URL should not contain any filter parameters
    And the candidate "Filters" button should show no applied-filter count

  @positive
  Scenario: Verify that Cancel discards filter selections that were never applied
    When I open the candidate Filters modal
    And I select the candidate filter "Payment Due" under "Subscription Status"
    And I cancel the candidate filters
    Then the candidate filter modal should not be visible
    And the candidates URL should not contain any filter parameters
    And the candidate "Filters" button should show no applied-filter count
    When I open the candidate Filters modal
    Then no candidate filter option should be selected

  @positive
  Scenario: Verify that the Filters modal can be dismissed by every available means
    Then the candidate filter modal should close via each of:
      | method   |
      | X icon   |
      | Cancel   |
      | Escape   |
      | backdrop |

  @negative
  Scenario: Verify that a filter combination matching no candidate shows the filtered empty state
    When I open the "Deactivated" candidates tab
    And I open the candidate Filters modal
    And I select the candidate filter "3+" under "Pending Documents"
    And I select the candidate filter "Payment Due" under "Subscription Status"
    And I apply the candidate filters
    Then no candidates should be listed
    And the candidates empty state heading should be "No results found"
    And the candidates empty state should read "We couldn't find any results matching your current filters."
    And the candidates empty state should offer a "Clear all filters" call to action
    When I clear the candidate filters from the empty state
    Then more than 1 candidate should be listed
    And the candidates URL should not contain any filter parameters

  @negative @known-issue @needs-clarification
  Scenario: Verify that a leftover status parameter does not filter the All tab invisibly
    # >>> A REAL DEFECT, the remnant of the old Status-vs-tab one. Measured live 2026-10-19. <<<
    # The Status group was removed from the modal, but the listing still READS `?status=` from
    # the URL - which a bookmark or shared link made before the change still carries:
    #   /candidates?status=deactivated  -> request is_active=false, every row Deactivated
    # while the ALL tab shows as selected, the Filters button reads plain "Filters" (no count)
    # and the modal has nothing checked. Clicking the All tab does not clear it, and applying
    # another filter keeps it (`is_active=false&verification_status=verified`). Only the
    # modal's Clear All removes it, and nothing tells the superadmin to press it.
    # Either fix is fine: ignore the stale param, or re-sync the tab to it. Ask the PO which.
    When I open the Candidates listing at "?status=deactivated"
    Then the candidate list should only be narrowed by account status where the tab says so
  # ==================== PAGINATION ====================
  # Measured 2026-10-26 (scripts/probe-superadmin-candidate-drawer.js section D, read-only): 10 a
  # page; ?page=<n> in the URL (page 1 writes none) and in the request beside the tab's filter
  # (All sends no is_active, Active is_active=true, Deactivated is_active=false); a "Pagination
  # Navigation" pager of Previous | the first, the last and the pages around the current one with
  # an ellipsis per gap | Next; search, filter and tab switch go back to page 1; a reload keeps the
  # page; a page past the end says "404 Page not found"; changing page replaces the browser history
  # entry. Every expectation is derived from the server's own count. The paging scenarios that lived
  # in Candidate-Listing-Edge-Cases.feature were moved here.

  @positive @smoke
  Scenario: Verify that pagination moves through the candidate list without repeating candidates
    Then the candidate pagination controls should be visible
    And the candidate "Previous" control should be disabled on the first page
    When I note the candidates listed on the current page
    And I go to the next candidates page
    Then the candidates URL should contain the filter "page=2"
    And none of the previously noted candidates should be listed again
    And the candidate "Previous" control should be enabled
    When I go to the previous candidates page
    Then the candidates listed should match the first page again

  @positive
  Scenario: Verify that Next asks the server for the next candidate page and the pager marks it current
    Given I have opened the "Candidates" listing
    Then the "Candidates" pager should mark page 1 as the current page
    When I go to the "Next" page of the "Candidates" listing
    Then the "Candidates" listing should show page 2 of the server's results
    And the "Candidates" pager should mark page 2 as the current page
    And none of the first page's rows should be listed again on the "Candidates" listing

  @positive
  Scenario: Verify that a numbered page control jumps straight to that page
    Given I have opened the "Candidates" listing
    When I choose page 3 from the "Candidates" pager
    Then the "Candidates" listing should show page 3 of the server's results
    And the "Candidates" pager should mark page 3 as the current page
    And none of the first page's rows should be listed again on the "Candidates" listing

  @positive
  Scenario: Verify that the last candidate page holds the remainder and offers no Next
    Given I have opened the "Candidates" listing
    When I open the last page of the "Candidates" listing
    Then the "Candidates" listing should list exactly the remainder of the server's count
    And the "Candidates" pager should disable "Next" and enable "Previous"

  @positive
  Scenario: Verify that the candidate pager always offers the first and last pages and the pages around the current one
    Given I have opened the "Candidates" listing
    Then the "Candidates" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap
    When I open the "Candidates" listing at page 5
    Then the "Candidates" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap
    When I open the last page of the "Candidates" listing
    Then the "Candidates" pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap

  @positive
  Scenario: Verify that every candidate tab pages through its own list
    Then each "Candidates" tab should page through its own list:
      | tab         | query           | url         |
      | All         | no is_active    |             |
      | Active      | is_active=true  | active      |
      | Deactivated | is_active=false | deactivated |

  @positive
  Scenario: Verify that a candidate page opened from the URL or kept across a reload shows that page
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing at page 3
    Then the "Candidates" listing should show page 3 of the server's results
    When I reload the "Candidates" listing
    Then the "Candidates" listing should show page 3 of the server's results
    And the "Candidates" pager should mark page 3 as the current page

  @positive
  Scenario: Verify that the candidate pager can be operated from the keyboard
    Given I have opened the "Candidates" listing
    Then the "Candidates" pager should be operable from the keyboard

  # Measured 2026-10-14: page 1 happens to match, but a later page is re-ordered completely, with
  # no sort control or indicator on any column. The Agents grid keeps the server's order on both
  # pages. Ask the PO whether a client-side sort is intended.
  @negative @known-issue @needs-clarification
  Scenario: Verify that the candidate grid keeps the order the server returns
    Given I have opened the "Candidates" listing
    Then the "Candidates" grid should list its rows in the server's order on the first and a later page

  @negative
  Scenario: Verify that Previous on the first candidate page and Next on the last are disabled and do nothing
    Given I have opened the "Candidates" listing
    Then the "Candidates" pager should disable "Previous" and pressing it should change nothing
    When I open the last page of the "Candidates" listing
    Then the "Candidates" pager should disable "Next" and pressing it should change nothing

  @negative
  Scenario: Verify that a search narrowed to a single candidate shows no pager
    Given I have opened the "Candidates" listing
    When I search the "Candidates" listing for the first email on this page
    Then the "Candidates" pager should not be shown

  # Was @known-issue ("presented as a search with no results"). FIXED by 2026-10-26: it now says
  # the page does not exist.
  @negative
  Scenario: Verify that a page beyond the last candidate page says it does not exist
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing far beyond its last page
    Then the "Candidates" listing should say the page does not exist and list no rows

  @edge-case
  Scenario: Verify that an unusable page number falls back to the first page of candidates
    Then opening the "Candidates" listing with each page value should fall back to the first page:
      | page |
      | abc  |
      | 0    |
      | -1   |

  @edge-case @needs-clarification
  Scenario: Verify that a fractional candidate page number is reported as a page that does not exist
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing with the page value "2.5"
    Then the "Candidates" listing should say the page does not exist and list no rows

  @edge-case
  Scenario: Verify that a candidate search from a later page starts again at page 1, and so does clearing it
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing at page 3
    And I search the "Candidates" listing for "a"
    Then the "Candidates" listing should be back on page 1 with no page in the URL
    When I clear the "Candidates" listing search
    Then the "Candidates" listing should be back on page 1 with no page in the URL

  @edge-case
  Scenario: Verify that applying a candidate filter from a later page starts again at page 1
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing at page 3
    And I apply the first filter option on the "Candidates" listing
    Then the "Candidates" listing should be back on page 1 with no page in the URL

  @edge-case
  Scenario: Verify that switching candidate tab from a later page starts the new tab at page 1
    Given I have opened the "Candidates" listing
    When I open the "Candidates" listing at page 3
    And I switch the "Candidates" listing to the "Deactivated" tab
    Then the "Candidates" listing should be back on page 1 with no page in the URL
    And the "Candidates" pager should mark page 1 as the current page

  @edge-case @needs-clarification
  Scenario: Verify that changing candidate page replaces the browser history entry rather than adding one
    Given I have opened the "Candidates" listing
    Then changing page on the "Candidates" listing should not add a browser history entry

  @positive @e2e
  Scenario: Verify that a later candidate page survives viewing a candidate and a reload
    Given I have opened the "Candidates" listing
    When I open the last page of the "Candidates" listing
    And I note the rows on the "Candidates" listing
    And I view and close the first candidate listed on the current page
    Then the "Candidates" listing should be back on the same page with the same rows
    When I reload the "Candidates" listing
    Then the "Candidates" listing should be back on the same page with the same rows

  @positive @e2e
  Scenario: Verify that the Deactivated tab's second page survives a reload and a candidate view
    Given I have opened the "Candidates" listing
    When I switch the "Candidates" listing to the "Deactivated" tab
    And I note this as the first page of the "Candidates" listing
    And I go to the "Next" page of the "Candidates" listing
    Then the "Candidates" listing should show page 2 of the server's results
    When I reload the "Candidates" listing
    Then the "Candidates" listing should show page 2 of the server's results
    And none of the first page's rows should be listed again on the "Candidates" listing
    When I note the rows on the "Candidates" listing
    And I view and close the first candidate listed on the current page
    Then the "Candidates" listing should be back on the same page with the same rows
    When I go to the "Previous" page of the "Candidates" listing
    Then the "Candidates" pager should mark page 1 as the current page
    And the "Candidates" listing should show the first page it showed before
  # ==================== VIEW - the candidate drawer ====================

  @positive
  Scenario: Verify that View opens the candidate drawer with their identity and its five tabs
    Given I have noted the first candidate on the "All" tab
    When I view that candidate
    Then the candidate panel should be displayed
    And the candidate panel should show that candidate's name
    And the candidate panel tabs should be:
      | Candidate Details |
      | Track Progress    |
      | Documents         |
      | Subscription      |
      | Activity Log      |
    And the "Candidate Details" candidate panel tab should be the selected tab
    And the candidate panel should show the summary figures:
      | Track Progress      |
      | Courses Completed   |
      | Hours Learned       |
      | Certificates Earned |

  @edge-case
  Scenario: Verify that the candidate view is a drawer with no route, no deep link and no Back
    Given I have noted the first candidate on the "All" tab
    And I have noted the listing URL
    When I view that candidate
    Then the candidate panel should be displayed
    And the URL should be unchanged from the noted listing URL
    And the candidate panel should offer no Back control
    And the candidate panel should offer no lifecycle action

  @positive
  Scenario: Verify that every panel tab opens and queries its own endpoint
    Given I have noted the first candidate on the "All" tab
    And I view that candidate
    Then opening the drawer should have fetched that candidate's profile
    And each candidate panel tab should open and query its own endpoint:
      | tab               | endpoint                             |
      | Candidate Details |                                      |
      | Track Progress    | /tracks/candidate/                   |
      | Documents         |                                      |
      | Subscription      | /subscription/current/               |
      | Activity Log      | /analytics/candidates/activity-logs/ |

  @positive
  Scenario: Verify that Candidate Details lists every section of the candidate's profile
    Given I have noted the first candidate on the "All" tab
    And I view that candidate
    When I open the "Candidate Details" candidate panel tab
    Then the candidate details tab should show the sections:
      | Basic Information               |
      | Education                       |
      | Work Experience                 |
      | Certifications                  |
      | Work Preferences & Availability |
      | Desired Roles                   |
    And every empty section should explain itself rather than render blank

  @positive
  Scenario: Verify that the Documents tab groups every document under its own category with a status
    Given I have found a candidate holding uploaded documents
    When I view that candidate
    And I open the "Documents" candidate panel tab
    Then the documents tab should group documents under:
      | Education       |
      | Work Experience |
      | Certifications  |
    And every listed document should carry a file name, a status and an upload date
    And a group with no documents should say so

  @positive
  Scenario: Verify that the Subscription tab reports the plan or says there is none
    Given I have noted the first candidate on the "All" tab
    And I view that candidate
    When I open the "Subscription" candidate panel tab
    Then the subscription tab should either detail the plan or state there is none
    And a detailed subscription should show the fields:
      | Status               |
      | Subscription Started |
      | Current Subscription |
      | Total Fee            |
      | Next Billing Date    |

  @positive
  Scenario: Verify that the Activity Log offers its reporting periods and re-queries the server for each
    Given I have noted the first candidate on the "All" tab
    And I view that candidate
    When I open the "Activity Log" candidate panel tab
    # Sentence case since 2026-10-19 ("Last 24 hours"), matching the Agent Portal's Activity Log.
    Then the activity log should offer the candidate periods:
      | Last 24 hours |
      | Last 7 days   |
      | Last 30 days  |
      | Last 3 months |
      | Last 6 months |
      | This year     |
    And "Last 24 hours" should be the period it opens on
    And selecting each period should re-query the server for that duration:
      | period        | duration      |
      | Last 7 days   | last_7_days   |
      | Last 30 days  | last_30_days  |
      | Last 3 months | last_3_months |
      | Last 6 months | last_6_months |
      | This year     | this_year     |

  @edge-case
  Scenario: Verify that Track Progress reports whichever assessment state the candidate is in
    Given I have noted the first candidate on the "All" tab
    And I view that candidate
    When I open the "Track Progress" candidate panel tab
    Then the track progress tab should report the candidate's assessment state

  @positive
  Scenario: Verify that the candidate drawer closes by every available means
    Given I have noted the first candidate on the "All" tab
    Then the candidate panel should close via each of:
      | method |
      | X icon |
      | Escape |

  @positive
  Scenario: Verify that View is offered on every tab and opens the candidate it was clicked for
    Then View should open the correct candidate from each of these tabs:
      | tab         |
      | All         |
      | Active      |
      | Deactivated |
  # ==================== END TO END ====================

  @positive @e2e
  Scenario: Verify that a search and a filter survive together across a reload and a tab switch
    Given I have noted the first candidate on the "Active" tab
    When I open the candidate Filters modal
    And I select the candidate filter "Verified" under "Account Verification Status"
    And I apply the candidate filters
    And I search the candidates for that candidate's first name
    Then the candidates URL should contain the search term
    And the candidates URL should contain the filter "accountVerification=verified"
    And the candidate "Filters" button should show an applied-filter count of 1
    When I reload the Candidates listing
    Then the candidates URL should contain the search term
    And the candidates URL should contain the filter "accountVerification=verified"
    And the candidate search box should still hold the search term
    And the candidate "Filters" button should show an applied-filter count of 1
    When I open the "Deactivated" candidates tab
    Then the candidates URL should contain the search term
    And the candidates URL should contain the filter "accountVerification=verified"
    And the candidate "Filters" button should show an applied-filter count of 1

  @positive @e2e
  Scenario: Verify that filtering, searching and viewing a candidate leaves the list as it was
    When I open the "Active" candidates tab
    And I open the candidate Filters modal
    And I select the candidate filter "Verified" under "Account Verification Status"
    And I apply the candidate filters
    Then every candidate returned should be "active"
    And every candidate returned should be "verified"
    When I have noted the first candidate on the current tab
    And I search the candidates for that candidate's full email
    Then exactly 1 candidate should be listed
    When I view that candidate
    Then the candidate panel should be displayed
    And the candidate panel should show that candidate's name
    When I close the candidate panel
    Then the candidate panel should not be displayed
    And the candidates URL should contain the search term
    And the candidates URL should contain the filter "accountVerification=verified"
    And the "Active" candidates tab should still be the selected tab
    And that candidate should be listed
