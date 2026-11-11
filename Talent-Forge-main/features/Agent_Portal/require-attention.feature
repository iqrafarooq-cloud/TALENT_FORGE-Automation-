
@requireAttention
Feature: Candidates - Requires Attention

  Background:
    Given I am logged in as an agent
    And I am on the Candidates Requires Attention tab
  # ==================== STRUCTURE ====================

  # The heading names the listing it is on. Measured 2026-10-05: this page reads only
  # "Candidates" while the Deactivated listing reads "Candidates - Deactivated", so this
  # is red until the heading names the listing.
  @positive @structure @known-issue
  Scenario: Verify that the page heading reads "Candidates - Requires Attention"
    Then the candidates page heading should read "Candidates - Requires Attention"


  @positive @structure
  Scenario: Verify that the Requires Attention tab loads on All with its five columns
    Then the Requires Attention heading should be displayed
    And the "All" severity tab should be active
    And the Requires Attention table should be visible
    And the Requires Attention table should display exactly these columns:
      | Candidate     |
      | Issue         |
      | Severity      |
      | Last Activity |
      | Actions       |

  @positive @structure
  Scenario: Verify that the tab strip offers exactly All, Warning and Critical
    Then the severity tab strip should offer exactly these tabs:
      | All      |
      | Warning  |
      | Critical |
  # ==================== SEVERITY TABS ====================
  # Tolerant on content by design: Warning holds no candidate in this environment today, so a
  # row assertion would be red against a tab behaving correctly. Each row asserts the URL value,
  # the severity the app SENDS to the server, and - only where rows exist - that every rendered
  # Severity cell agrees. The empty tab's own wording has its own scenario below.

  @positive @tabs
  Scenario: Verify that each severity tab filters the list by its own severity
    Then each severity tab should filter the list by its own severity:
      | tab      | urlParam              | apiParam          | severity |
      | All      | activeFilter=all      |                   |          |
      | Warning  | activeFilter=warning  | severity=warning  | Warning  |
      | Critical | activeFilter=critical | severity=critical | Critical |
  # Pins BOTH empty-state wordings verbatim, and it is the only scenario that does. The Warning
  # tab gained a candidate on 2026-10-05, so its list is now stubbed EMPTY (only that tab's
  # request) - the wording is still the app's own, but it no longer depends on live data.

  @edge-case @empty-state @mocked
  Scenario: Verify that the Warning tab renders its own empty state distinct from the no-results one
    Given the Requires Attention Warning tab will return no candidates
    When I click the "Warning" severity tab
    Then the Requires Attention empty state should read exactly:
      | heading | No warnings at the moment                                          |
      | body    | Candidates with minor issues that need attention will appear here. |
    When I click the "All" severity tab
    And I search the Requires Attention list for "ZZZNONEXISTENT999"
    Then the Requires Attention empty state should read exactly:
      | heading | No results found                                           |
      | body    | We couldn't find any results matching your current search. |
    And the two empty states should have different wording

  @edge-case @tabs
  Scenario: Verify that a severity tab can be deep-linked and survives a reload
    When I open the Requires Attention tab at "?activeFilter=critical"
    Then the "Critical" severity tab should be active
    And the request the app sent should carry "severity=critical"
    When I reload the Requires Attention list
    Then the "Critical" severity tab should be active
    And the request the app sent should carry "severity=critical"
  # ==================== SEARCH ====================

  @positive @search
  Scenario: Verify that searching by candidate name filters the list to matching rows
    Given the Requires Attention table has at least one record visible
    When I search the Requires Attention list by the first candidate's name
    Then every listed candidate should match the search term
    And the URL should contain the search term
    And the request the app sent should carry the search term

  @positive @search
  Scenario: Verify that searching by candidate email filters the list to that candidate
    Given the Requires Attention table has at least one record visible
    When I search the Requires Attention list by the first candidate's email
    Then every listed candidate should match the search term
    And exactly one candidate should be listed
    And the URL should contain the search term

  @positive @search @edge-case
  Scenario: Verify that the search matches a partial term and ignores case
    Given the Requires Attention table has at least one record visible
    Then the search should match these variations of the first candidate's details:
      | variation            |
      | name in upper case   |
      | name in lower case   |
      | first eight of email |
  # Product decision (2026-10-05): the placeholder is "Search by candidate name..." - it names the
  # candidate's name, and that is the intended wording (the search also matching an email is not
  # something the placeholder needs to advertise). Pinned verbatim.
  @positive @search
  Scenario: Verify that the search placeholder reads "Search by candidate name..."
    Then the Requires Attention search placeholder should read "Search by candidate name..."

  @negative @search @empty-state
  Scenario: Verify that a search matching no candidate shows the no-results state without crashing
    When I search the Requires Attention list for "ZZZNONEXISTENT999"
    Then no candidate should be listed
    And the Requires Attention page should still be usable

  @positive @search
  Scenario: Verify that clearing the search restores the full list
    Given the Requires Attention table has at least one record visible
    When I search the Requires Attention list by the first candidate's name
    Then every listed candidate should match the search term
    When I clear the Requires Attention search
    Then the Requires Attention search box should be empty
    And the Requires Attention table should be visible
    And the listed candidate count should be back to its unfiltered value

  @positive @search @tabs
  Scenario: Verify that a search applies inside a severity tab and leaves that tab selected
    When I click the "Critical" severity tab
    And the Requires Attention table has at least one record visible
    And I search the Requires Attention list by the first candidate's name
    Then every listed candidate should match the search term
    And the "Critical" severity tab should be active
    And the request the app sent should carry "severity=critical"
  # Recorded, not failed on: the outcome the user sees is correct (the list is unfiltered), the
  # URL correctly omits the term, and the only cost is one wasted round trip carrying
  # `search=%20%20%20`. The SuperAdmin candidates listing has the identical divergence and it is
  # recorded there too. Suppressing the request is the Agents listing's behaviour - ask the PO
  # which of the three is house style.

  @edge-case @search
  Scenario: Verify that a whitespace-only search leaves the list unfiltered
    Given the Requires Attention table has at least one record visible
    When I search the Requires Attention list for "   "
    Then the listed candidate count should be back to its unfiltered value
    And the URL should not contain a search parameter
    And whatever the app sent for a blank search should be reported
  # ==================== FILTERS ====================

  @positive @filter-modal
  Scenario: Verify that the filter modal presents every group with its options and control type
    When I open the Requires Attention filters
    Then the Requires Attention filter modal should be visible
    And the filter modal should offer exactly these groups and options:
      | group          | control  | options                                               |
      | Issue Category | checkbox | Payment, Progress, Documents                          |
      | Last Updated   | checkbox | Last 24 hours, Last 3 days, Last 7 days, Last 30 days |
    And the filter modal should offer a "Clear All", "Cancel" and "Apply Filters" control
  # Asserts the URL **and** the request the app actually made, per row. Checking only the URL
  # would pass on a front end that rewrites the address bar and queries the server for something
  # else - which is exactly the defect the last scenario in this section catches - and that can
  # be caught by reading neither the URL nor the rendered rows.

  @positive @filter-options
  Scenario: Verify that applying each filter option updates the URL and the request sent
    Then applying each filter option should update the URL and the request sent:
      | group          | option        | urlParam                | apiParam                |
      | Issue Category | Payment       | issueCategory=payment   | issue_category=Payment  |
      | Issue Category | Progress      | issueCategory=progress  | issue_category=Progress |
      | Issue Category | Documents     | issueCategory=documents | issue_category=Document |
      | Last Updated   | Last 24 hours | lastUpdated=24h         | last_updated_after=     |
      | Last Updated   | Last 3 days   | lastUpdated=3days       | last_updated_after=     |
      | Last Updated   | Last 7 days   | lastUpdated=7days       | last_updated_after=     |
      | Last Updated   | Last 30 days  | lastUpdated=30days      | last_updated_after=     |
  # The modal no longer has a Severity group (2026-10-05) - severity is chosen by the tab strip
  # only - so multi-select is asserted on Issue Category.

  @positive @multi-select
  Scenario: Verify that selecting two options in one group applies both
    When I open the Requires Attention filters
    And I select the "Payment" filter option
    And I select the "Documents" filter option
    And I apply the Requires Attention filters
    Then the Requires Attention filter modal should not be visible
    And the URL should contain the filter "issueCategory=payment"
    And the URL should contain the filter "issueCategory=documents"
    And the request the app sent should carry "issue_category=Payment"
    And the request the app sent should carry "issue_category=Document"
  # The badge counts GROUPS, not options - measured. The Active tab's own scenarios assert the
  # OPTION count for the same badge, so the two listings genuinely disagree about what the number
  # means. Asserted as measured on each surface rather than reconciled; ask the PO which is meant.

  @edge-case @filter-modal @needs-clarification
  Scenario: Verify that the applied-filter badge counts filter groups rather than options
    When I open the Requires Attention filters
    And I select the "Payment" filter option
    And I select the "Documents" filter option
    And I apply the Requires Attention filters
    Then the Requires Attention Filters button should show an applied-filter count of "1"
    When I open the Requires Attention filters
    And I clear all Requires Attention filters
    And I select the "Payment" filter option
    And I select the "Last 7 days" filter option
    And I apply the Requires Attention filters
    Then the Requires Attention Filters button should show an applied-filter count of "2"

  # Last Updated became a multi-select checkbox group on 2026-10-05 (it was a single-select radio
  # "Last Activity"). Measured: two ranges both stay ticked, both reach the URL, and the request
  # covers the WIDEST of them - the union of the two windows.
  @edge-case @filter-options
  Scenario: Verify that choosing two Last Updated ranges keeps both and requests the wider window
    When I open the Requires Attention filters
    And I select the "Last 3 days" filter option
    And I select the "Last 30 days" filter option
    Then the selected Requires Attention filter options should be "Last 3 days, Last 30 days"
    When I apply the Requires Attention filters
    Then the URL should contain the filter "lastUpdated=3days"
    And the URL should contain the filter "lastUpdated=30days"
    And the latest Requires Attention request should cover the last 30 days

  @positive @clear-all
  Scenario: Verify that Clear All resets every selection and clears the filter parameters
    When I open the Requires Attention filters
    And I select the "Documents" filter option
    And I select the "Last 7 days" filter option
    And I clear all Requires Attention filters
    Then no Requires Attention filter option should be selected
    And the URL should not contain any Requires Attention filter parameters

  @positive @cancel
  Scenario: Verify that Cancel discards unapplied filter selections
    When I open the Requires Attention filters
    And I select the "Documents" filter option
    And I cancel the Requires Attention filters
    Then the Requires Attention filter modal should not be visible
    And the URL should not contain any Requires Attention filter parameters
    When I open the Requires Attention filters
    Then no Requires Attention filter option should be selected

  @positive @modal-close
  Scenario Outline: Verify that the filter modal can be closed via "<closeMethod>" without applying anything
    When I open the Requires Attention filters
    Then the Requires Attention filter modal should be visible
    When I close the Requires Attention filter modal via "<closeMethod>"
    Then the Requires Attention filter modal should not be visible
    And the URL should not contain any Requires Attention filter parameters

    Examples:
      | closeMethod |
      | X icon      |
      | Cancel      |
      | backdrop    |

  # KNOWN ISSUE (measured 2026-10-05): the server answers count 0 for this combination, but the
  # grid keeps 10 BLANK placeholder rows indefinitely and shows no "No results found" message -
  # while a search matching nothing renders that message correctly.
  @negative @filter-modal @empty-state @known-issue
  Scenario: Verify that a filter combination matching no candidate shows the no-results state
    When I open the Requires Attention filters
    And I select the "Payment" filter option
    And I select the "Last 24 hours" filter option
    And I apply the Requires Attention filters
    Then no candidate should be listed
    And the Requires Attention empty state should be displayed
    And the Requires Attention page should still be usable

  # ==================== PAGINATION ====================

  @positive @pagination
  Scenario: Verify that the pagination controls are rendered with Previous, Next and page numbers
    Then the Requires Attention pagination should be visible
    And the pagination should offer a "Previous" and a "Next" control
    And the pagination should offer at least one page number

  @positive @pagination
  Scenario: Verify that Next advances to the second page and requests it from the server
    Given the Requires Attention table has at least one record visible
    When I go to the next page of the Requires Attention list
    Then the URL should contain the filter "page=2"
    And the request the app sent should carry "page=2"
    And the Requires Attention table should be visible
  # Measured: searching from page 2 requests page=1 and drops the page param from the URL. A
  # search that kept the offset would strand the agent on an empty page 2 of a 1-page result.

  @edge-case @pagination @search
  Scenario: Verify that searching from a later page resets the list to the first page
    Given the Requires Attention table has at least one record visible
    When I go to the next page of the Requires Attention list
    Then the URL should contain the filter "page=2"
    When I search the Requires Attention list by the first candidate's name
    Then the request the app sent should carry "page=1"
    And the URL should not contain the filter "page=2"
  # ==================== ROW ACTIONS ====================

  @positive @row-actions
  Scenario: Verify that every row offers exactly the View and Reminder History actions on every tab
    Then every candidate row should offer exactly the View and Reminder History actions on each tab:
      | All      |
      | Warning  |
      | Critical |

  @positive @row-actions @candidate-profile
  Scenario: Verify that the View action opens the same candidate profile the other tabs open
    Given the Requires Attention table has at least one record visible
    When I note the first Requires Attention candidate
    And I click the View icon on the first Requires Attention row
    Then I should be on that candidate's profile page
    And the profile should offer the same tabs the other candidate listings open:
      | Candidate Details     |
      | Track Progress        |
      | Document Verification |
      | Subscription          |
      | Activity Log          |
  # The panel opens EMPTY and fills from `GET /agent/candidate/<id>/reminders/`, so the rendered
  # entries are compared against what that request returned rather than against a fixed number -
  # this account's history grows every time the reminder cron runs. Each entry is required to
  # carry both a title and a "Sent" date: a panel listing bare titles with no timestamps is not
  # a reminder history.

  @positive @row-actions @reminder-history
  Scenario: Verify that the Reminder History action opens that candidate's reminder history
    Given the Requires Attention table has at least one record visible
    When I note the first Requires Attention candidate
    And I open the Reminder History for the first Requires Attention row
    Then the Reminder History panel should be displayed for that candidate
    And every reminder listed should carry a title and the date it was sent
    And the reminders listed should match the ones the server returned

  @edge-case @row-actions @reminder-history
  Scenario: Verify that opening Reminder History does not navigate away from the listing
    Given the Requires Attention table has at least one record visible
    When I note the current Requires Attention URL
    And I open the Reminder History for the first Requires Attention row
    Then the Reminder History panel should be displayed
    And the Requires Attention URL should be unchanged

  @positive @row-actions @reminder-history @modal-close
  Scenario Outline: Verify that the Reminder History panel closes via "<closeMethod>" and leaves the list intact
    Given the Requires Attention table has at least one record visible
    When I open the Reminder History for the first Requires Attention row
    Then the Reminder History panel should be displayed
    When I close the Reminder History panel via "<closeMethod>"
    Then the Reminder History panel should not be displayed
    And the Requires Attention table should be visible

    Examples:
      | closeMethod |
      | Close       |
      | backdrop    |
  # Proves an ABSENCE, so it watches a window rather than sampling once: "the panel is not
  # visible" is also true of one the app has not rendered yet, and a single read on a settling
  # page would pass while the panel appears a moment later.

  @negative @row-actions @reminder-history
  Scenario: Verify that no Reminder History panel opens until its icon is clicked
    Given the Requires Attention table has at least one record visible
    Then no Reminder History panel should open on its own
  # ==================== END TO END ====================

  @e2e @search @filter-options @candidate-profile
  Scenario: Verify that an agent can filter by severity, search for a candidate and open their profile
    Given the Requires Attention table has at least one record visible
    When I click the "Critical" severity tab
    And the Requires Attention table has at least one record visible
    And I note the first Requires Attention candidate
    And I search the Requires Attention list by the first candidate's email
    Then every listed candidate should match the search term
    And exactly one candidate should be listed
    And the URL should contain the search term
    And the "Critical" severity tab should be active
    When I click the View icon on the first Requires Attention row
    Then I should be on that candidate's profile page

  @e2e @filter-options @reminder-history
  Scenario: Verify that an agent can filter, review a candidate's reminder history and return to the filtered list
    When I open the Requires Attention filters
    And I select the "Documents" filter option
    And I apply the Requires Attention filters
    Then the URL should contain the filter "issueCategory=documents"
    And the request the app sent should carry "issue_category=Document"
    And the Requires Attention table has at least one record visible
    When I note the current Requires Attention URL
    And I note the first Requires Attention candidate
    And I open the Reminder History for the first Requires Attention row
    Then the Reminder History panel should be displayed for that candidate
    And every reminder listed should carry a title and the date it was sent
    When I close the Reminder History panel via "Close"
    Then the Reminder History panel should not be displayed
    And the Requires Attention URL should be unchanged
    And the Requires Attention table should be visible
    And the URL should contain the filter "issueCategory=documents"
