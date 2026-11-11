@verifications
Feature: Agent Portal - Verifications
  Background:
    Given I am logged in as an agent
    And I am on the Verifications page
  # 1. THE PAGE'S CONTRACT

  @positive @smoke
  Scenario: Verify that the Verifications page shows the search box, the four status tabs, the table columns and the View and Download buttons
    Then the Verifications page should be headed "Verifications"
    And the Verifications page should offer a search box, a status tab strip and a Filters button
    And the verification queue should be displayed
    And the status tabs should be a radio group offering exactly "All, Needs Review, Approved, Revision Required"
    And exactly one status tab should be selected
    And the verification queue should list exactly these columns in order:
      | Document Name |
      | Uploaded By   |
      | Document Type |
      | Date Uploaded |
      | Status        |
      | Actions       |
    And every row should offer exactly the actions "View, Download"

  @edge-case
  Scenario: Verify that the queue offers no control that can decide a document from the listing
    Then no row should offer a control that approves or requests a revision

  @negative @known-issue @needs-clarification
  Scenario: Verify that the documents table shows the documents in the same order the server sends them (newest first)

    Then the queue should list the documents in the order the server returned them
    When I go to the next page of the queue
    Then the queue should list the documents in the order the server returned them
  # 2. THE STATUS TABS

  @positive
  Scenario: Verify that each status tab filters the queue, records itself in the URL and asks the server for its own status
    Then each status tab should filter the queue and query the server for its own status:
      | tab               | url param                | api param          | rendered status   |
      | Needs Review      | activeFilter=needs-review      | status=AWAITING    | Needs Review      |
      | Approved          | activeFilter=approved          | status=APPROVED    | Approved          |
      | Revision Required | activeFilter=revision-required | status=REVISION    | Revision Required |
    When I choose the "All" status tab
    Then the last queue request should carry no status parameter
    And the queue should list documents of more than one status
    When I choose the "All" status tab again
    Then no further queue request should have been sent
    And the "All" status tab should be selected with the queue rendered

  @edge-case
  Scenario: Verify that a tab value the app cannot use falls back to All, whatever shape it takes
    Then each of these tab values should fall back to the All tab with the queue rendered:
      | tab value         | why it matters                 |
      | NOT_A_REAL_STATUS | an unrecognised value          |
      |                   | an empty value                 |
      | AWAITING          | the retired pre-2026-10-14 value |
  # 3. THE SEARCH

  @positive
  Scenario: Verify that the search narrows the queue, records the term in the URL and the request, and matches whatever the case
    When I search the queue for the first listed document's name
    Then the URL and the queue request should both carry the search term
    And every listed document name should contain the search term
    And the queue search should behave as follows:
      | variation               | expectation     |
      | the exact name          | matches the row |
      | the name in UPPER CASE  | matches the row |
      | the name in lower case  | matches the row |
      | a slice from the middle | matches the row |

  # This checks copy against behavior. The next scenario separately locks the document-name-only
  # search behavior promised by the placeholder.
  @positive
  Scenario: Verify that the search placeholder describes what the search actually matches
    Then the queue search placeholder should agree with what the search matches

  @negative
  Scenario: Verify that the queue search matches document names only, as its placeholder promises
    When I search the queue for an uploader name absent from a listed document's filename
    Then every returned document should match the document-name search term

  @negative
  Scenario: Verify that a term matching nothing shows the no-results empty state, and that clearing it restores the queue
    When I note how many documents the server holds for this queue
    And I search the queue for "zzz-no-such-document-zzz"
    Then the verification queue should list no documents
    And the queue empty state should read exactly:
      | heading | No results found                                           |
      | body    | We couldn't find any results matching your current search. |
    When I clear the queue search
    Then the queue should hold the number of documents it held before the search
    And the URL should carry no search term

  @negative
  Scenario: Verify that a whitespace-only search is kept out of the URL and changes nothing
    When I search the queue for "   "
    Then the URL should carry no search term
    And the queue should still list documents
    And the wasted round trip should be reported for the product owner

  @negative @edge-case
  Scenario: Verify that an unsafe search term is neither executed nor able to break the queue
    Then none of these search terms should be executed or break the queue:
      | term                      |
      | <script>alert(1)</script> |
      | ' OR 1=1 --               |
      | %26%3D                    |
      | ../../etc/passwd          |
  # 4. THE FILTERS MODAL

  @positive
  Scenario: Verify that the Filters popup offers only Document Type and Date Uploaded, and that Cancel, reopening and Clear All work
    When I note how many documents the server holds for this queue
    And I open the Verifications Filters modal
    Then the Filters modal should be titled "Apply Filters"
    And the Filters modal should offer exactly the groups "Document Type, Date Uploaded"
    And the Filters modal should offer exactly the document types "Transcript, Experience Letter, Certification"
    And the Filters modal should offer a start date and an end date
    And the Filters modal should offer the actions "Clear All, Cancel, Apply Filters"
    When I select the document types "Transcript"
    And I cancel the Verifications Filters modal
    Then the Filters modal should be closed
    And the URL should carry no document type filter
    And the Verifications Filters button should show no applied-filter count
    When I filter the queue by the document type "Transcript"
    And I open the Verifications Filters modal
    Then the document type "Transcript" should be selected in the Filters modal
    When I clear all the Verifications filters
    Then the URL should carry no document type filter
    And the Verifications Filters button should show no applied-filter count
    And the queue should hold the number of documents it held before the filter

  @positive
  Scenario: Verify that each document type filters the queue and asks the server for its own category
    Then each document type should filter the queue and query the server for its own category:
      | document type     | url param                   | api param               | rendered type     |
      | Transcript        | documentType=EDUCATION      | category=EDUCATION      | Transcript        |
      | Experience Letter | documentType=WORKEXPERIENCE | category=WORKEXPERIENCE | Experience Letter |
      | Certification     | documentType=CERTIFICATION  | category=CERTIFICATION  | Certification     |

  @positive
  Scenario: Verify that two document types selected together return the union of both, counted as one applied filter
    When I open the Verifications Filters modal
    And I select the document types "Transcript" and "Certification"
    And I apply the Verifications filters
    Then the queue should list documents of both types and of no other
    And both document types should be sent to the server
    And the Filters button should show an applied-filter count of 1
    And what the applied-filter count counts should be reported for the product owner

  @positive
  Scenario: Verify that a filter composes with the status tab and the search, and is restorable from the URL
    When I filter the queue by the document type "Transcript"
    And I choose the "Needs Review" status tab
    Then the queue request should carry both the status and the category
    And the URL should carry both the tab and the document type filter
    When I search the queue for the first listed document's name
    Then the queue request should carry both the search term and the category
    And every listed document name should contain the search term
    When I open the Verifications page filtered by the document type "CERTIFICATION"
    Then the queue request should carry the category "CERTIFICATION"
    And every listed document should be of the type "Certification"
    And the Filters button should show an applied-filter count of 1

  @positive
  Scenario: Verify that the Date Uploaded range narrows the queue, records itself in the URL and the request, and clears
    When I note the upload dates on the first page of the queue
    And I filter the queue by a date range spanning the noted upload dates
    Then the URL and the queue request should both carry the date range
    And every listed document should have been uploaded within the date range
    And the Filters button should show an applied-filter count of 1
    When I open the Verifications Filters modal
    Then the Filters modal should show the date range I applied
    When I clear all the Verifications filters
    Then the URL and the queue request should carry no date range
    And the Filters modal should show no date range
    And the Verifications Filters button should show no applied-filter count
    And the queue should hold the number of documents it held before the filter

  @negative
  Scenario: Verify that a date range cannot be applied incomplete or backwards
    When I note the upload dates on the first page of the queue
    And I open the Verifications Filters modal
    And I choose a start date without an end date
    Then the Filters modal should report "End Date is required"
    And Apply Filters should be disabled
    And the end date picker should refuse every day before the start date
    And no queue request should have carried a date range

  @edge-case @known-issue
  Scenario: Verify that filtering Date Uploaded from one day to the same day shows the documents uploaded on that day
    When I note the upload dates on the first page of the queue
    And I filter the queue by a single day on which documents were uploaded
    Then the queue should list the documents uploaded on that day

  @negative
  Scenario: Verify that a filter matching nothing explains itself, and its Clear all filters action restores the queue
    When I note how many documents the server holds for this queue
    And I filter the queue by a date range in the future
    Then the verification queue should list no documents
    And the queue empty state should read exactly:
      | heading | No results found                                            |
      | body    | We couldn't find any results matching your current filters. |
    When I use the empty state's "Clear all filters" action
    Then the URL and the queue request should carry no date range
    And the Verifications Filters button should show no applied-filter count
    And the queue should hold the number of documents it held before the filter

  @positive
  Scenario: Verify that a reload restores the tab, the search, the document type and the date range exactly
    When I note the upload dates on the first page of the queue
    And I choose the "Approved" status tab
    And I note which status tab is selected
    And I filter the queue by the document type "Transcript"
    And I filter the queue by a date range spanning the noted upload dates
    And I search the queue for "pdf"
    And I reload the Verifications page
    Then the URL and the queue request should be exactly as they were before the reload
    And the search box, the status tab, the document type and the date range should all be restored
  # 5. PAGINATION

  @positive
  Scenario: Verify that pagination requests the page it names, enables Previous past the first, and resets on a new search
    Then the queue pagination should offer a Previous, a Next and numbered pages
    And Previous should be disabled on the first page
    When I go to the next page of the queue
    Then the queue request should carry "page=2"
    And Previous should be enabled
    # A search that kept the offset would strand the agent on an empty page 2 of a one-page result.
    When I search the queue for "e"
    Then the queue request should carry "page=1"
    And the URL should carry no page number

  @positive
  Scenario: Verify that a numbered page can be chosen and that the last page holds the remainder with Next disabled
    When I go to page 2 of the queue by its number
    Then the queue request should carry "page=2"
    And Previous should be enabled
    When I open the last page of the queue
    Then the last page should hold the remainder of the queue
    And Next should be disabled on the last page
    And Previous should be enabled

  @edge-case
  Scenario: Verify that a page number the app cannot use falls back to the first page
    Then each of these page values should fall back to the first page with the queue rendered:
      | page value | why it matters    |
      | abc        | not a number      |
      |          0 | below the first   |
      |         -1 | a negative number |
  # 6. THE DOCUMENT VERIFICATION PANEL

  @positive
  Scenario: Verify that opening a document shows a panel describing and rendering that same document, fetching nothing new
    When I open the first document in the queue
    Then the review panel should describe the document from the row I opened
    And the review panel should state the document's version
    And no further queue request should have been sent
    And the review panel should render the document itself
    And the review panel should offer a zoom control and a Download
    And the zoom should start at 100%
    And zooming in should step up to 200% and stop there
    And zooming out should step down to 50% and stop there

  @positive
  Scenario: Verify that the review panel is a dialog rather than a route, closes both ways, and opens the uploader's own profile
    When I open the first document in the queue
    Then the review panel should not have changed the URL
    When I close the review panel with its Close control
    Then the review panel should be closed
    When I open the first document in the queue
    And I press Escape on the review panel
    Then the review panel should be closed
    When I open the first document in the queue
    And I follow the panel's link to the uploader's profile
    Then I should be on the uploader's profile page

  @positive
  Scenario: Verify that a document can be downloaded from its row and from the review panel
    When I download the first document in the queue from its row
    Then the downloaded file should be the document named on the row
    And downloading should not have left the queue
    When I open the first document in the queue
    And I download the document from the review panel
    Then the downloaded file should be the document named on the row
    And the review panel should still be open

  @positive
  Scenario: Verify that the Approve and Request Revision buttons appear only on documents that still need review
    Then the decision controls should be offered only where the status allows:
      | status            | decision controls |
      | Needs Review      | offered           |
      | Approved          | not offered       |
      | Revision Required | not offered       |

  @positive
  Scenario: Verify that the panel explains why a document was flagged and, once decided, who decided it
    When I open the first document in the queue under the "Needs Review" status tab
    Then the review panel should explain why the document was flagged
    And the review panel should name what flagged it
    When I close the review panel with its Close control
    And I open the first document in the queue under the "Revision Required" status tab
    Then the review panel should show a comment history
    And every comment should name its author and when it was left

  # 7. THE DECISION DIALOGS - opened and cancelled, never submitted

  @positive
  Scenario: Verify that both decision dialogs explain themselves, require a reason, and commit nothing when cancelled
    When I open the first document in the queue under the "Needs Review" status tab
    And I open the "Request Revision" decision dialog
    Then the decision dialog should be headed "Request Revision"
    And the decision dialog should say the reason will be visible to the candidate
    And the decision dialog should require a reason
    And cancelling the decision dialog should leave the document unchanged
    When I open the "Approve" decision dialog
    Then the decision dialog should be headed "Approve document"
    And the decision dialog should require a reason
    And cancelling the decision dialog should leave the document unchanged

  @positive
  Scenario: Verify that neither decision can be submitted without a real reason, and that the reason is capped
    Then neither decision should be submittable without a reason:
      | reason             | submit   |
      | untouched          | disabled |
      | whitespace only    | disabled |
      | a single character | enabled  |
      | a genuine sentence | enabled  |
    And each decision dialog's reason field should cap what can be typed at 500 characters

  @positive
  Scenario: Verify that a decision dialog dismissed by X or Escape returns to the review panel and keeps nothing
    Then each decision dialog should close back to the review panel and discard its reason when dismissed:
      | decision         | dismissed by |
      | Request Revision | Escape       |
      | Request Revision | its X        |
      | Approve          | Escape       |
      | Approve          | its X        |

  # Both decisions now open their own popup (Approve as well as Request Revision). Each is asserted
  # to be ITS OWN dialog - heading, submit label, gated submit, cancel. Measured 2026-10-15: the two
  # submit buttons still share data-testid="agent-submit-request-revision-button"; that is recorded
  # in the report for dev, not failed on (product decision).
  @positive
  Scenario: Verify that the Approve and Request Revision buttons each open their own popup with its own submit button
    Then each decision dialog's submit control should be distinguishable from the other's
  # 8. ACCESSIBILITY

  @positive
  Scenario: Verify that both row actions are named controls a keyboard user can reach and operate
    Then every row action should be a real button carrying an accessible name
    And the "View" action should be reachable and operable from the keyboard
    And the "Download" action should be reachable and operable from the keyboard
  # 9. END TO END

  @positive @e2e
  Scenario: Verify that an agent can narrow the queue by tab, filter and name, review a document, and return to the same queue
    When I choose the "Needs Review" status tab
    And I filter the queue by the document type "Transcript"
    And I note the first document in the queue
    And I open the first document in the queue
    Then the review panel should describe the document from the row I opened
    And the review panel should render the document itself
    And the decision controls should be offered
    When I close the review panel with its Close control
    Then the queue should still be filtered as it was
    And the first document in the queue should be the one I noted
    When I search the queue for the first listed document's name
    And I open the first document in the queue
    Then the review panel should describe the document from the row I opened
    And the review panel should state the document's version
    When I close the review panel with its Close control
    And I clear the queue search
    Then the queue should still list documents

  @positive @e2e
  Scenario: Verify that an agent can narrow the queue by date, review and download a document, and return to the same queue
    When I note the upload dates on the first page of the queue
    And I filter the queue by a date range spanning the noted upload dates
    And I note the first document in the queue
    And I open the first document in the queue
    Then the review panel should describe the document from the row I opened
    And the review panel should render the document itself
    When I download the document from the review panel
    Then the downloaded file should be the document named on the row
    And the review panel should still be open
    When I close the review panel with its Close control
    Then the URL should still carry the date range
    And the first document in the queue should be the one I noted
    When I open the Verifications Filters modal
    And I clear all the Verifications filters
    Then the URL and the queue request should carry no date range
  # 10. FAILURE AND ACCESS

  @negative @known-issue
  # Load ERRORS only. Empty states (incl. a page number past the last page) are covered separately.
  Scenario: Verify that when the documents list fails to load the page shows "Failed to load document"
    Then a documents list that fails to load should show "Failed to load document":
      | failure           |
      | a server error    |
      | a network failure |
