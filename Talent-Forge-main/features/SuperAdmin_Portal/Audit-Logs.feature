@audit-logs @superadmin
Feature: SuperAdmin Portal - Audit Logs

  Background:
    Given I am logged in as the superadmin
    And I am on the Audit Logs page

  @positive @smoke
  Scenario: Verify that the Audit Logs page presents its grid, controls and columns
    Then the Audit Logs grid should be displayed
    And the Audit Logs page should offer a search box, a Filters button and an Export button
    And the Audit Logs columns should be exactly:
      | Date & Time   |
      | Action By     |
      | Action Type   |
      | Entity        |
      | Entity Name   |
      | Endpoint      |
      | Event Details |
      | IP Address    |
      | Location      |
      | Actions       |
    And every Audit Logs row should carry a value in every column

  @positive
  Scenario: Verify that the listing renders no more rows than the page size it requested
    Then the Audit Logs grid should render no more rows than the requested page size
    And Audit Logs pagination should be displayed

  @edge-case
  Scenario: Verify that a row is not reported as present until its cells hold content
    Then the first Audit Logs row should hold a real timestamp, actor and action type
  # SECTION 2 - SEARCH (positive)

  @positive
  Scenario: Verify that the search matches every field it is documented to cover
    When I search the Audit Logs by each of these fields:
      | field           | source column   |
      | Action By       | Action By       |
      | Action By Email | Action By Email |
      | Action Type     | Action Type     |
      | Entity Name     | Entity Name     |
      | IP Address      | IP Address      |
      | Location        | Location        |
    Then every Audit Logs search should have returned at least one row matching the term
    And every Audit Logs search should have sent the term to the server

  @positive
  Scenario: Verify that the search is case-insensitive and matches a partial term
    When I search the Audit Logs for a location and then for its lowercase partial form
    Then both Audit Logs searches should return the same rows

  @positive
  Scenario: Verify that the search term is carried in the URL and survives a reload
    When I search the Audit Logs for "Community Created"
    Then the Audit Logs URL should contain the search term
    And the Audit Logs search box should still hold the term after a reload
    And the reloaded results should be the same as before the reload
  # SECTION 3 - SEARCH (negative and edge)

  @negative
  Scenario: Verify that the search does not match the columns it is not scoped to
    When I search the Audit Logs by each of these fields:
      | field         | source column |
      | Endpoint      | Endpoint      |
      | Event Details | Event Details |
    Then every Audit Logs search should have returned no rows

  @negative @empty-state
  Scenario: Verify that a search matching nothing shows the search empty state
    When I search the Audit Logs for "zzzzqqqnope12345"
    Then the Audit Logs empty state should be the "search" one
    And the Audit Logs empty state should read exactly:
      | heading | No results found                                |
      | body    | We couldn't find any logs matching your search. |
    And the Audit Logs empty state should offer no Clear CTA
    And no Audit Logs rows should be displayed
    And Audit Logs pagination should not be displayed

  @edge-case
  Scenario: Verify that a whitespace-only search is not sent to the server
    When I search the Audit Logs for "   "
    Then no Audit Logs request should have been sent for that search
    And the Audit Logs URL should not contain a search parameter
    And Audit Logs rows should be displayed

  @negative @edge-case
  Scenario: Verify that a hostile search term is treated as text and not executed
    When I search the Audit Logs by each of these terms:
      | term                      |
      | ' OR 1=1 --               |
      | <script>alert(1)</script> |
      | %00                       |
    Then every Audit Logs search should have returned no rows
    And no Audit Logs search should have raised a page error or a browser dialog
    And the Audit Logs page should still be usable

  @edge-case
  Scenario: Verify that clearing the search restores the unfiltered listing
    When I search the Audit Logs for "Community Created"
    And I note how many Audit Logs rows are shown
    And I clear the Audit Logs search
    Then the Audit Logs URL should not contain a search parameter
    And the Audit Logs listing should show more rows than it did while searching
  # SECTION 4 - FILTERS

  @positive
  Scenario: Verify that the filter modal offers both groups and all of their options
    When I open the Audit Logs filter modal
    Then the Audit Logs filter modal should offer these groups and options:
      | group         | control  | options                                                       |
      | Entity        | checkbox | Agent, Candidate, Configuration, Community                    |
      | Last Activity | radio    | Last 24 hours, Last 7 days, Last 30 days, Inactive (30+ days) |
    And no Audit Logs filter option should be selected
    And the Audit Logs filter modal should offer Clear All, Cancel and Apply Filters

  @positive
  Scenario: Verify that each filter option sends the parameter it is supposed to
    When I apply each Audit Logs filter on its own:
      | option              | url parameter          | api parameter          |
      | Agent               | entity=agent           | entity=Agent           |
      | Candidate           | entity=candidate       | entity=Candidate       |
      | Configuration       | entity=configuration   | entity=Configuration   |
      | Community           | entity=community       | entity=Community       |
      | Last 24 hours       | last_activity=24h      | last_activity=24h      |
      | Last 7 days         | last_activity=7d       | last_activity=7d       |
      | Last 30 days        | last_activity=30d      | last_activity=30d      |
      | Inactive (30+ days) | last_activity=inactive | last_activity=inactive |
    Then every Audit Logs filter should have sent both of its parameters

  @positive
  Scenario: Verify that two options in one group widen the results rather than replacing them
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter options "Agent" and "Candidate"
    And I apply the Audit Logs filters
    Then the Audit Logs request should have carried both "entity=Agent" and "entity=Candidate"
    And every Audit Logs row should have an entity of "Agent" or "Candidate"

  @positive
  Scenario: Verify that a second Last Activity choice replaces the first
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Last 24 hours"
    And I select the Audit Logs filter option "Last 7 days"
    Then only "Last 7 days" should be selected in the Last Activity group
    When I apply the Audit Logs filters
    Then the Audit Logs request should have carried "last_activity=7d"
    And the Audit Logs request should not have carried "last_activity=24h"

  @positive
  Scenario: Verify that the applied-filter badge counts every selected option
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter options "Agent" and "Candidate"
    And I select the Audit Logs filter option "Last 7 days"
    And I apply the Audit Logs filters
    Then the Audit Logs Filters button should show an applied-filter count of 3

  @positive
  Scenario: Verify that filters combine with a search rather than replacing it
    When I search the Audit Logs for "Karachi"
    And I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Community"
    And I apply the Audit Logs filters
    Then the Audit Logs request should have carried both "search=Karachi" and "entity=Community"
    And the Audit Logs search box should still hold "Karachi"
    And the Audit Logs Filters button should show an applied-filter count of 1

  @negative
  Scenario: Verify that cancelling the filter modal applies nothing
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Community"
    And I cancel the Audit Logs filter modal
    Then no Audit Logs request should have been sent for that filter
    And the Audit Logs URL should not contain a filter parameter
    And the Audit Logs Filters button should show an applied-filter count of 0

  @positive
  Scenario: Verify that Clear All inside the modal deselects every option
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter options "Agent" and "Candidate"
    And I select the Audit Logs filter option "Last 7 days"
    And I clear all filters inside the Audit Logs modal
    Then no Audit Logs filter option should be selected

  @negative @empty-state
  Scenario: Verify that a filter combination matching nothing shows the filter empty state
    When I apply an Audit Logs filter combination that no log satisfies
    Then the Audit Logs empty state should be the "filters" one
    And the Audit Logs empty state should read exactly:
      | heading | No results found                                          |
      | body    | We couldn't find any logs matching your selected filters. |
    And the Audit Logs empty state should offer a Clear CTA
    And no Audit Logs rows should be displayed
  # The third wording, and the reason all three empty states are covered separately: they differ
  # only in their last clause, so one reader keyed to "No results found" cannot tell them apart -
  # and naming whichever of search and filters is active is the whole behaviour.

  @negative @empty-state
  Scenario: Verify that a search and filter matching nothing together names both
    When I search the Audit Logs for "asd3"
    And I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Agent"
    And I apply the Audit Logs filters
    Then the Audit Logs empty state should be the "both" one
    And the Audit Logs empty state should read exactly:
      | heading | No results found                                            |
      | body    | We couldn't find any logs matching your search and filters. |
    And the Audit Logs empty state should offer a Clear CTA

  @edge-case
  Scenario: Verify that the empty state's Clear CTA restores the full listing
    When I search the Audit Logs for "asd3"
    And I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Agent"
    And I apply the Audit Logs filters
    And I click the Audit Logs empty state Clear CTA
    Then the Audit Logs URL should not contain a search parameter
    And the Audit Logs URL should not contain a filter parameter
    And the Audit Logs search box should be empty
    And the Audit Logs Filters button should show an applied-filter count of 0
    And Audit Logs rows should be displayed
  # SECTION 5 - EXPORT

  @positive
  Scenario: Verify that the Export menu offers CSV and Excel
    When I open the Audit Logs Export menu
    Then the Audit Logs Export menu should offer exactly:
      | label         | key   |
      | CSV           | csv   |
      | Excel (.xlsx) | excel |
  # Measured 2026-10-23 over all 2983 logs: 14 have no Action By (impersonation start/end and a few
  # admin actions, newest 2026-09-01) and 162 have no Location despite an IP address (newest
  # 2026-10-05). An audit record must say who and from where, so this stays red on the data.

  @positive @known-issue
  Scenario: Verify that a CSV export downloads and holds every documented column
    When I export the Audit Logs as "CSV"
    Then the downloaded file should be named "audit-logs.csv"
    And the export should be a readable CSV
    And the export columns should be exactly:
      | Date & Time     |
      | Action By       |
      | Action By Email |
      | Action Type     |
      | Entity          |
      | Entity Name     |
      | Endpoint        |
      | Event Details   |
      | IP Address      |
      | Location        |
      | Headline        |
      | Description     |
      | Event Type      |
      | Actor Name      |
      | Metadata        |
    And every export row should hold a value in every one of those columns

  @positive
  Scenario: Verify that an Excel export downloads as a real .xlsx workbook
    When I export the Audit Logs as "Excel (.xlsx)"
    Then the downloaded file should be named "audit-logs.xlsx"
    And the export should be a real xlsx workbook and not a renamed CSV
    And the export columns should be exactly:
      | Date & Time     |
      | Action By       |
      | Action By Email |
      | Action Type     |
      | Entity          |
      | Entity Name     |
      | Endpoint        |
      | Event Details   |
      | IP Address      |
      | Location        |
      | Headline        |
      | Description     |
      | Event Type      |
      | Actor Name      |
      | Metadata        |

  @positive
  Scenario: Verify that the export carries the extra columns the grid does not show
    When I export the Audit Logs as "CSV"
    Then the export should carry every column the grid shows except "Actions"
    And the export should additionally carry:
      | Action By Email |
      | Headline        |
      | Description     |
      | Event Type      |
      | Actor Name      |
      | Metadata        |
    And the export's Metadata column should hold readable JSON

  @positive @e2e
  Scenario: Verify that the CSV and the Excel export describe the same logs
    When I export the Audit Logs as "CSV"
    And I export the Audit Logs as "Excel (.xlsx)"
    Then the two Audit Logs exports should have identical columns
    And the two Audit Logs exports should hold the same number of rows
    And the two Audit Logs exports should agree row for row

  @positive @e2e
  Scenario: Verify that the export honours the search that is applied
    When I search the Audit Logs for "Community Created"
    And I export the Audit Logs as "CSV"
    Then the export request should have carried "search=Community Created"
    And every export row should have an action type of "Community Created"

  @positive @e2e
  Scenario: Verify that the export honours the filters that are applied
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Community"
    And I apply the Audit Logs filters
    And I export the Audit Logs as "CSV"
    Then the export request should have carried "entity=Community"
    And every export row should have an entity of "Community"

  @positive @e2e
  Scenario: Verify that the export contains every matching log and not just the current page
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Community"
    And I apply the Audit Logs filters
    And I export the Audit Logs as "CSV"
    Then the export should hold one row for every log the server reported
    And the export should hold more rows than the grid was showing, unless they all fit on one page

  @edge-case
  Scenario: Verify that exporting an empty result set produces a header-only file
    When I search the Audit Logs for "zzzzqqqnope12345"
    And I export the Audit Logs as "CSV"
    Then the export should be a readable CSV
    And the export should hold no data rows
  # SECTION 6 - VIEW LOG

  @positive
  Scenario: Verify that View log opens the Log Details dialog for the row it was clicked on
    When I note the first Audit Logs row
    And I open the Log Details dialog for that row
    Then the Log Details dialog should be titled "Log Details"
    And the Log Details dialog should describe that same row
    And the Log Details dialog should show these fields:
      | Entity Type |
      | Entity Name |
      | Action Type |
      | Action By   |
      | Date & Time |
    And the Log Details dialog should show the event details

  @positive
  Scenario: Verify that the Log Details dialog is a dialog with no route of its own
    When I open the Log Details dialog for the first Audit Logs row
    Then the Audit Logs URL should not have changed
    And no Audit Logs request should have been sent for opening the dialog

  @positive
  Scenario: Verify that the Log Details dialog closes and leaves the listing untouched
    When I note how many Audit Logs rows are shown
    And I open the Log Details dialog for the first Audit Logs row
    And I close the Log Details dialog
    Then the Log Details dialog should no longer be displayed
    And the Audit Logs listing should show the same rows as before

  @negative
  Scenario: Verify that no Log Details dialog opens on its own
    Then no Log Details dialog should open on its own
  # SECTION 7 - PAGINATION

  @positive
  Scenario: Verify that paging forward requests the next page and renders different rows
    When I note the first Audit Logs row
    And I go to the next page of Audit Logs
    Then the Audit Logs request should have carried "page=2"
    And the Audit Logs URL should contain "page=2"
    And the first Audit Logs row should be different from the one I noted
  # A search that kept the offset would strand the superadmin on an empty page 2 of a one-page
  # result - and the empty state they then saw would describe the search, not the paging.

  @edge-case
  Scenario: Verify that searching from a later page returns to the first page
    When I go to the next page of Audit Logs
    And I search the Audit Logs for "Community Created"
    Then the Audit Logs URL should not contain "page=2"
    And the Audit Logs request should have carried "page=1"

  @positive
  Scenario: Verify that the Audit Logs pager pages with Previous, numbered pages and Next
    Then the Audit Logs pager should page with Previous, numbered pages and Next

  @positive
  Scenario: Verify that a reload on a later Audit Logs page keeps that page
    When I open the Audit Logs page at "?page=3"
    Then the Audit Logs request should have carried "page=3"
    And reloading the Audit Logs page should keep page "3" and its rows

  @positive
  Scenario: Verify that applying a filter from a later Audit Logs page returns to the first page
    When I open the Audit Logs page at "?page=3"
    And I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Agent"
    And I apply the Audit Logs filters
    Then the Audit Logs request should have carried "page=1"
    And the Audit Logs URL should not contain "page="

  @edge-case
  Scenario: Verify that an unusable Audit Logs page number falls back to the first page
    Then each of these Audit Logs page values should fall back to the first page:
      | value |
      | abc   |
      |     0 |
      |    -1 |

  @edge-case @needs-clarification
  Scenario: Verify that an Audit Logs page number with no logs shows the "Page not found" page
    Then each of these Audit Logs page values should show the "404 Page not found" page:
      | value              |
      | past the last page |
      |                2.5 |
  # Measured: paging REPLACES the history entry, so browser Back leaves the page instead of
  # stepping back through pages (same as the Agents listing). Its scenario was removed on request
  # 2026-11-03 - recorded, not asserted.
  # SECTION 7b - VALUES, URL VALUES, FAILURES, ROW CONTROLS, ACCESS (coverage pass 2026-11-03)

  @positive
  Scenario: Verify that every Audit Logs row shows what the server sent, in the server's order
    Then every Audit Logs row should match the server on each of these pages:
      | page |
      |    1 |
      |    2 |
      | last |

  @edge-case
  Scenario: Verify that an unrecognised filter value in the Audit Logs URL is ignored and removed
    Then each of these Audit Logs filter URL values should be ignored and removed from the URL:
      | query         | parameter |
      | ?entity=bogus | entity    |
      | ?entity=AGENT | entity    |

  @negative @known-issue
  Scenario: Verify that an unrecognised Last Activity value in the URL is not counted as an applied filter
    Then each of these Audit Logs filter URL values should be ignored and removed from the URL:
      | query                  | parameter     |
      | ?last_activity=forever | last_activity |

  @negative
  Scenario: Verify that a failed Audit Logs load says so rather than showing an empty listing
    Then each of these Audit Logs load failures should say "Unable to load audit logs. Please try again." rather than show an empty listing:
      | failure       |
      | server error  |
      | network error |

  @positive @needs-clarification
  Scenario: Verify that the text buttons in an Audit Logs row open nothing
    Then clicking the first Audit Logs row's name, email, entity and entity name should open nothing and send nothing

  @positive
  Scenario: Verify that the Log Details dialog closes by Escape, an outside click and its Close button
    Then the Log Details dialog should close by each of these routes and leave the listing untouched:
      | route         |
      | Escape        |
      | outside click |
      | Close button  |

  @positive
  Scenario: Verify that the sidebar Audit Logs link opens the listing on its first page
    When I open Audit Logs from the sidebar while on the Community page
    Then the Audit Logs listing should open on its first page

  @negative
  Scenario: Verify that only a superadmin can reach the Audit Logs page
    Then each of these roles should be refused the Audit Logs page:
      | role      |
      | agent     |
      | candidate |
  # SECTION 8 - END TO END

  @positive @e2e
  Scenario: Verify that a superadmin can filter, search, inspect and export one coherent result set
    When I open the Audit Logs filter modal
    And I select the Audit Logs filter option "Community"
    And I apply the Audit Logs filters
    Then every Audit Logs row should have an entity of "Community"
    When I search the Audit Logs for "Community Created"
    Then the Audit Logs request should have carried both "search=Community Created" and "entity=Community"
    And every Audit Logs row should have an action type of "Community Created"
    When I note the first Audit Logs row
    And I open the Log Details dialog for that row
    Then the Log Details dialog should describe that same row
    When I close the Log Details dialog
    And I export the Audit Logs as "CSV"
    Then the export request should have carried "search=Community Created"
    And the export request should have carried "entity=Community"
    And every export row should have an action type of "Community Created"
    And every export row should have an entity of "Community"
    And the export should hold one row for every log the server reported
    And the exported rows should match the rows the grid was showing

  @edge-case @needs-clarification
  Scenario: Verify that the differences between the grid and the export are still what was measured
    When I note the first Audit Logs row
    And I export the Audit Logs as "CSV"
    Then the export and the grid should be compared field by field for that row
    And any differences between the grid and the export should be reported

  @positive @accessibility
  Scenario: Verify that every interactive control in a row is reachable by keyboard
    Then every interactive Audit Logs row control should be reachable by keyboard
