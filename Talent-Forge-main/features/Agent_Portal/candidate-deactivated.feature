@candidateDeactivated
Feature: Candidates - Deactivated

  Background:
    Given I am logged in as an agent
    And I am on the Candidates Deactivated tab
  # The heading names the listing it is on (measured 2026-10-05: correct here).

  @positive @structure
  Scenario: Verify that the page heading reads "Candidates - Deactivated"
    Then the candidates page heading should read "Candidates - Deactivated"
  # ==================== STRUCTURE ====================

  @positive @structure
  Scenario: Verify that the Deactivated tab loads with its heading and its five columns
    Then the Deactivated heading should be displayed
    And the Deactivated table should be visible
    And the Deactivated table should display exactly these columns:
      | Candidate            |
      | Account Verification |
      | Pending Documents    |
      | Subscription Status  |
      | Actions              |

  @positive @structure
  Scenario: Verify that the Deactivated listing offers a search and filters but no tab strip
    Then the Deactivated search box should be displayed
    And the Deactivated Filters button should be displayed
    And the Deactivated listing should offer no severity or status tab strip
    And the Deactivated URL should carry no tab parameter
  # ==================== SEARCH ====================

  @positive @search
  Scenario: Verify that searching by candidate name filters the list to matching rows
    Given the Deactivated table has at least one record visible
    When I search the Deactivated list by the first candidate's name
    Then every listed candidate should match the Deactivated search term
    And the Deactivated URL should contain the search term
    And the Deactivated request should carry the search term

  @positive @search
  Scenario: Verify that searching by candidate email filters the list to that one candidate
    Given the Deactivated table has at least one record visible
    When I search the Deactivated list by the first candidate's email
    Then every listed candidate should match the Deactivated search term
    And exactly one Deactivated candidate should be listed
    And the Deactivated URL should contain the search term
    And the Deactivated request should carry the search term

  @positive @search @edge-case
  Scenario: Verify that the search matches partial terms, either case and an address containing a plus
    Given the Deactivated table has at least one record visible
    Then the Deactivated search should match these variations of the first candidate's details:
      | variation           |
      | name in upper case  |
      | name in lower case  |
      | first four of name  |
      | full email address  |
      | local part of email |

  # Product decision: the placeholder is "Search by candidate name..." - that is the intended
  # wording (the search also matching an email is not something the placeholder needs to
  # advertise). Same decision as Requires Attention (2026-10-05). Pinned verbatim.
  @positive @search
  Scenario: Verify that the search placeholder reads "Search by candidate name..."
    Then the Deactivated search placeholder should read "Search by candidate name..."

  @negative @search @empty-state
  Scenario: Verify that a search matching no candidate shows the no-results state without crashing
    When I search the Deactivated list for "ZZZNONEXISTENT999"
    Then no Deactivated candidate should be listed
    And the Deactivated empty state should read exactly:
      | heading | No results found                                           |
      | body    | We couldn't find any results matching your current search. |
    And the Deactivated page should still be usable

  @positive @search
  Scenario: Verify that clearing the search restores the full list
    Given the Deactivated table has at least one record visible
    When I search the Deactivated list by the first candidate's name
    Then every listed candidate should match the Deactivated search term
    When I clear the Deactivated search
    Then the Deactivated search box should be empty
    And the Deactivated table should be visible
    And the listed Deactivated count should be back to its unfiltered value

  @edge-case @search
  Scenario: Verify that a whitespace-only search leaves the list unfiltered
    Given the Deactivated table has at least one record visible
    When I search the Deactivated list for "   "
    Then the listed Deactivated count should be back to its unfiltered value
    And the Deactivated URL should not contain a search parameter
    And whatever the app sent for a blank Deactivated search should be reported

  @edge-case @search
  Scenario: Verify that a search can be deep-linked and survives a reload
    Given the Deactivated table has at least one record visible
    When I note the first Deactivated candidate
    And I open the Deactivated tab at that candidate's email as a search parameter
    Then every listed candidate should match the Deactivated search term
    And the Deactivated search box should hold the search term
    When I reload the Deactivated list
    Then every listed candidate should match the Deactivated search term
    And the Deactivated search box should hold the search term
  # ==================== FILTERS ====================

  @positive @filter-modal
  Scenario: Verify that the filter modal presents every group with its options and control type
    When I open the Deactivated filters
    Then the Deactivated filter modal should be visible
    And the Deactivated filter modal should offer exactly these groups and options:
      | group                       | control  | options                                 |
      | Account Verification Status | checkbox | Verified, Unverified                    |
      | Pending Documents           | radio    |                              0, 1-2, 3+ |
      | Subscription Status         | checkbox | Subscribed, Not Subscribed, Payment Due |
    And the Deactivated filter modal should offer a "Clear All", "Cancel" and "Apply Filters" control

  @positive @filter-options
  Scenario: Verify that applying each filter option updates the URL and the request sent
    Then applying each Deactivated filter option should update the URL and the request sent:
      | group                       | option         | urlParam                         | apiParam                           |
      | Account Verification Status | Verified       | accountVerification=verified     | verification_status=verified       |
      | Account Verification Status | Unverified     | accountVerification=unverified   | verification_status=unverified     |
      | Pending Documents           |              0 | pendingDocuments=0               | pending_documents=0                |
      | Pending Documents           |            1-2 | pendingDocuments=1-2             | pending_documents=1-2              |
      | Pending Documents           |             3+ | pendingDocuments=3plus           | pending_documents=3+               |
      | Subscription Status         | Subscribed     | subscriptionStatus=subscribed    | subscription_status=subscribed     |
      | Subscription Status         | Not Subscribed | subscriptionStatus=notSubscribed | subscription_status=not_subscribed |
      | Subscription Status         | Payment Due    | subscriptionStatus=paymentDue    | subscription_status=payment_due    |

  @positive @multi-select @filter-options
  Scenario: Verify that selecting two options in one group returns the union of both
    When I note the Deactivated count for the "Subscribed" filter option
    And I note the Deactivated count for the "Not Subscribed" filter option
    And I open the Deactivated filters
    And I select the "Subscribed" Deactivated filter option
    And I select the "Not Subscribed" Deactivated filter option
    And I apply the Deactivated filters
    Then the URL should contain the filter "subscriptionStatus=subscribed"
    And the URL should contain the filter "subscriptionStatus=notSubscribed"
    And the Deactivated request should carry "subscription_status=subscribed"
    And the Deactivated request should carry "subscription_status=not_subscribed"
    And the listed Deactivated count should equal the sum of the two noted counts

  @edge-case @filter-modal @needs-clarification
  Scenario: Verify that the applied-filter badge counts filter groups rather than options
    When I open the Deactivated filters
    And I select the "Subscribed" Deactivated filter option
    And I select the "Not Subscribed" Deactivated filter option
    And I apply the Deactivated filters
    Then the Deactivated Filters button should show an applied-filter count of "1"
    When I open the Deactivated filters
    And I clear all Deactivated filters
    And I select the "Unverified" Deactivated filter option
    And I select the "Not Subscribed" Deactivated filter option
    And I apply the Deactivated filters
    Then the Deactivated Filters button should show an applied-filter count of "2"

  @edge-case @filter-options
  Scenario: Verify that a second Pending Documents choice replaces the first because the group is single-select
    When I open the Deactivated filters
    And I select the "1-2" Deactivated filter option
    And I select the "3+" Deactivated filter option
    Then exactly one Deactivated filter option should be selected in the modal
    And the only selected Deactivated filter option should be "3+"
    When I select the "3+" Deactivated filter option
    Then the only selected Deactivated filter option should be "3+"
    When I apply the Deactivated filters
    Then the URL should contain the filter "pendingDocuments=3plus"
    And the URL should not contain the filter "pendingDocuments=1-2"

  @positive @clear-all
  Scenario: Verify that Clear All resets every selection and clears the filter parameters
    When I open the Deactivated filters
    And I select the "Unverified" Deactivated filter option
    And I select the "1-2" Deactivated filter option
    And I select the "Payment Due" Deactivated filter option
    And I clear all Deactivated filters
    Then no Deactivated filter option should be selected
    And the URL should not contain any Deactivated filter parameters

  @positive @cancel
  Scenario: Verify that Cancel discards unapplied filter selections
    When I open the Deactivated filters
    And I select the "Verified" Deactivated filter option
    And I cancel the Deactivated filters
    Then the Deactivated filter modal should not be visible
    And the URL should not contain any Deactivated filter parameters
    When I open the Deactivated filters
    Then no Deactivated filter option should be selected

  @positive @modal-close
  Scenario Outline: Verify that the filter modal can be closed via "<closeMethod>" without applying anything
    When I open the Deactivated filters
    Then the Deactivated filter modal should be visible
    When I close the Deactivated filter modal via "<closeMethod>"
    Then the Deactivated filter modal should not be visible
    And the URL should not contain any Deactivated filter parameters

    Examples:
      | closeMethod |
      | X icon      |
      | Cancel      |
      | Escape      |
      | backdrop    |

  @negative @filter-modal @empty-state
  Scenario: Verify that a filter combination matching no candidate shows the no-results state
    When I open the Deactivated filters
    And I select the "Verified" Deactivated filter option
    And I select the "3+" Deactivated filter option
    And I select the "Payment Due" Deactivated filter option
    And I apply the Deactivated filters
    Then no Deactivated candidate should be listed
    And the Deactivated empty state should be displayed
    And the Deactivated page should still be usable

  @positive @filter-options @search
  Scenario: Verify that a filter and a search narrow the list together rather than replacing each other
    Given the Deactivated table has at least one record visible
    When I open the Deactivated filters
    And I select the "Unverified" Deactivated filter option
    And I apply the Deactivated filters
    Then the Deactivated request should carry "verification_status=unverified"
    When I note the first Deactivated candidate
    And I search the Deactivated list by the noted candidate's email
    Then every listed candidate should match the Deactivated search term
    And the Deactivated URL should contain the search term
    And the URL should contain the filter "accountVerification=unverified"
    And the Deactivated request should carry the search term
    And the Deactivated request should carry "verification_status=unverified"

  @edge-case @filter-options
  Scenario: Verify that a filter can be deep-linked, is reflected in the modal and survives a reload
    When I open the Deactivated tab at "?accountVerification=unverified"
    Then the Deactivated request should carry "verification_status=unverified"
    And the Deactivated Filters button should show an applied-filter count of "1"
    When I open the Deactivated filters
    Then the only selected Deactivated filter option should be "Unverified"
    When I close the Deactivated filter modal via "Escape"
    And I reload the Deactivated list
    Then the URL should contain the filter "accountVerification=unverified"
    And the Deactivated request should carry "verification_status=unverified"
  # ==================== ROW ACTIONS ====================

  @positive @row-actions
  Scenario: Verify that every row offers the View action and no other
    Given the Deactivated table has at least one record visible
    Then every Deactivated row should offer exactly the View action
    And no Deactivated row should offer a Reactivate control
    And no Deactivated row should offer a Reminder History control

  @positive @row-actions @candidate-profile
  Scenario: Verify that the View action opens the profile of the candidate on that row
    Given the Deactivated table has at least one record visible
    When I note the first Deactivated candidate
    And I click the View icon on the first Deactivated row
    Then I should be on the noted candidate's view-profile page
    And the profile should render its five tabs

  @positive @row-actions @candidate-profile
  Scenario: Verify that the View action works from a row other than the first
    Given the Deactivated table has at least two records visible
    When I note the second Deactivated candidate
    And I click the View icon on the second Deactivated row
    Then I should be on the noted candidate's view-profile page

  # ==================== PAGINATION ====================

  @edge-case @pagination
  Scenario: Verify that pagination is offered only when the list runs past one page
    Then the Deactivated pagination should be offered only when the list exceeds one page
    And if a second page exists, Next should request it from the server
  # ==================== EMPTY STATES ====================

  @edge-case @empty-state
  Scenario: Verify that the empty state is worded for its own cause rather than one message for both
    Then the Deactivated empty state should be worded for whichever cause applies
  # ==================== END TO END ====================

  @e2e @search @filter-options @candidate-profile
  Scenario: Verify that an agent can filter, search, open a candidate's profile and return to the same list
    Given the Deactivated table has at least one record visible
    When I open the Deactivated filters
    And I select the "Unverified" Deactivated filter option
    And I apply the Deactivated filters
    Then the URL should contain the filter "accountVerification=unverified"
    And the Deactivated request should carry "verification_status=unverified"
    When I note the first Deactivated candidate
    And I search the Deactivated list by the noted candidate's email
    Then exactly one Deactivated candidate should be listed
    And every listed candidate should match the Deactivated search term
    When I note the current Deactivated URL
    And I click the View icon on the first Deactivated row
    Then I should be on the noted candidate's view-profile page
    And the profile should render its five tabs
    When I go back to the Deactivated listing
    Then the Deactivated URL should be unchanged
    And the Deactivated search box should hold the search term
    And the Deactivated Filters button should show an applied-filter count of "1"
    And exactly one Deactivated candidate should be listed

  @e2e @filter-options @clear-all
  Scenario: Verify that an agent can narrow the list by two groups and get the whole list back again
    Given the Deactivated table has at least one record visible
    When I note the unfiltered Deactivated count
    And I open the Deactivated filters
    And I select the "Unverified" Deactivated filter option
    And I select the "Not Subscribed" Deactivated filter option
    And I apply the Deactivated filters
    Then the Deactivated Filters button should show an applied-filter count of "2"
    And the Deactivated request should carry "verification_status=unverified"
    And the Deactivated request should carry "subscription_status=not_subscribed"
    And the listed Deactivated count should be no greater than the unfiltered count
    When I open the Deactivated filters
    And I clear all Deactivated filters
    And I apply the Deactivated filters
    Then the URL should not contain any Deactivated filter parameters
    And the Deactivated Filters button should show an applied-filter count of "0"
    And the listed Deactivated count should be back to its unfiltered value
