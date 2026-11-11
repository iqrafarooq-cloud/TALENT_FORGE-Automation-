@candidate-management @superadmin @candidate-drawer
Feature: SuperAdmin User Management - Candidates: the View drawer and its five tabs

  View on the Candidates listing opens a drawer (no route of its own) with five tabs: Candidate
  Details, Track Progress, Documents, Subscription and Activity Log. This file checks what each tab
  SHOWS against the response the app itself received for the candidate that was opened. The
  drawer's structure - tab names, one endpoint per tab, closing it - is covered in
  Candidate-Search-Filters-View.feature and not repeated here.

  Subjects are chosen from live data on every run (a candidate with documents, a subscribed one,
  one with a track...), never pinned. Everything here is read-only: the Documents viewer offers
  Approve / Request Revision on a Needs Review document - the superadmin IS meant to decide there
  (product decision 2026-10-26) - but deciding is irreversible, so here they are only ever READ.
  Measured 2026-10-26 with scripts/probe-superadmin-candidate-drawer.js (read-only).

  Background:
    Given I am logged in as the superadmin

  # ==================== HEADER ====================

  @positive
  Scenario: Verify that the drawer header shows the candidate's name, verification and figures as the server holds them
    Given I have found a candidate with a filled-in profile
    When I open that candidate's drawer from the listing
    Then the drawer header should show that candidate as the server holds them

  @edge-case
  Scenario: Verify that a candidate with no statistics shows placeholders, not zeros, in the header
    Given I have found a candidate with an empty profile
    When I open that candidate's drawer from the listing
    Then the drawer header should show that candidate as the server holds them

  # ==================== CANDIDATE DETAILS ====================

  @positive
  Scenario: Verify that Candidate Details shows what the candidate entered on their profile
    Given I have found a candidate with a filled-in profile
    When I open that candidate's drawer from the listing
    Then Candidate Details should show what the server holds for that candidate

  @edge-case
  Scenario: Verify that Candidate Details explains every empty section for a candidate who has entered nothing
    Given I have found a candidate with an empty profile
    When I open that candidate's drawer from the listing
    Then Candidate Details should show what the server holds for that candidate

  # Measured 2026-10-26: with no qualification stored (the profile payload holds null) Basic
  # Information shows "Current Status Student" - a status the candidate never chose. Every other
  # unset field there shows "-". Ask the PO whether "Student" is meant to be a default.
  @negative @known-issue @needs-clarification
  Scenario: Verify that Current Status shows "-" for a candidate who has not chosen one
    Given I have found a candidate with an empty profile
    When I open that candidate's drawer from the listing
    Then Current Status should read "-" when the candidate has not stored one

  # ==================== TRACK PROGRESS ====================

  @positive
  Scenario: Verify that Track Progress shows the candidate's track with every course and its status
    Given I have found a candidate with an assigned track
    When I open that candidate's drawer from the listing
    Then Track Progress should show the server's track with every course and its status

  @edge-case
  Scenario: Verify that Track Progress says no track is assigned for a candidate without one
    Given I have found a candidate without a track
    When I open that candidate's drawer from the listing
    Then Track Progress should say no track is assigned yet, as the server answered 404

  # ==================== DOCUMENTS ====================

  @positive
  Scenario: Verify that the Documents tab lists every document under its category with its status, date and actions
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    Then the Documents tab should list exactly the server's documents under their categories

  @positive
  Scenario: Verify that View opens each document in the viewer described exactly as the server holds it
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    Then the viewer should describe each document as the server holds it

  @positive
  Scenario: Verify that the document viewer zooms between 50% and 200% in steps of 25
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    And I open the first document in the viewer
    Then the viewer should zoom in steps of 25 between 50% and 200% and disable each control at its bound

  @positive
  Scenario: Verify that Download delivers the real document from the viewer and from its row
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    And I open the first document in the viewer
    Then the viewer's Download should deliver that document and leave the viewer open
    When I close the viewer with "Escape"
    Then each document's row Download should deliver that document under its own name

  @positive
  Scenario: Verify that closing the viewer returns to the drawer's Documents tab
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    And I open the first document in the viewer
    Then closing the viewer each of these ways should leave the drawer open on Documents:
      | way    |
      | X icon |
      | Escape |

  # Product decision 2026-10-26: the file name is not an entry point - only View opens a document.
  @positive
  Scenario: Verify that clicking a document's name does nothing
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    Then clicking a document's name should open nothing, download nothing and send nothing

  # ==================== SUBSCRIPTION ====================

  @positive
  Scenario: Verify that the Subscription tab shows the candidate's current plan, dates and the amount charged
    Given I have found a subscribed candidate
    When I open that candidate's drawer from the listing
    Then the Subscription tab should show the server's current subscription

  @edge-case
  Scenario: Verify that the Subscription tab says there is none for a candidate who never subscribed
    Given I have found a candidate without a subscription
    When I open that candidate's drawer from the listing
    Then the Subscription tab should say there is no active subscription, as the server answered 404

  # ==================== ACTIVITY LOG ====================

  @positive
  Scenario: Verify that the Activity Log lists exactly the entries the server returns for a period
    Given I have found a candidate with activity this year
    When I open that candidate's drawer from the listing
    And I choose the "This year" activity period in the drawer
    Then the Activity Log should list exactly the entries the server returned

  @edge-case
  Scenario: Verify that a period with no activity says so instead of listing nothing
    Given I have found a candidate with an empty profile
    When I open that candidate's drawer from the listing
    And I choose the "Last 24 hours" activity period in the drawer
    Then the Activity Log should say there is no activity when the server returns none

  # ==================== FAILED LOADS (stubbed - nothing is changed) ====================

  @negative
  Scenario Outline: Verify that a failed <tab> load is not presented as "nothing here"
    Given I have found a subscribed candidate
    And the drawer's "<tab>" request will fail with a server error
    When I open that candidate's drawer from the listing
    Then the "<tab>" tab should not present the failed load as an empty state

    Examples:
      | tab            |
      | Track Progress |

    # Measured 2026-10-26: a 500 renders that tab's own "nothing here" copy - Subscription says
    # "This candidate does not have an active subscription." (so a paying candidate reads as never
    # subscribed) and Activity Log says "No activity to show". Track Progress handles it correctly.
    @known-issue
    Examples:
      | tab          |
      | Subscription |
      | Activity Log |

  # Measured 2026-10-26: a 500 on the profile request renders every Candidate Details section as
  # "Nothing here yet / This candidate hasn't added ..." - a failure shown as an empty profile.
  @negative @known-issue
  Scenario: Verify that a failed profile load is not presented as a candidate who has entered nothing
    Given I have found a candidate with a filled-in profile
    And the drawer's "profile" request will fail with a server error
    When I open that candidate's drawer from the listing
    Then the drawer should not present a failed profile load as an empty profile

  # ==================== MOVING BETWEEN CANDIDATES ====================

  @edge-case
  Scenario: Verify that opening a second candidate shows only that candidate, starting on Candidate Details
    Given I have found two different candidates on the listing
    When I open that candidate's drawer from the listing
    And I open the "Subscription" candidate panel tab
    And I close the drawer and open the second candidate
    Then the drawer should show only the second candidate, opened on Candidate Details

  @edge-case
  Scenario: Verify that reopening the same candidate starts again on Candidate Details
    Given I have found a candidate whose documents I can open
    When I open that candidate's drawer from the listing
    And I open the "Documents" candidate panel tab
    And I close the drawer and reopen the same candidate
    Then the drawer should reopen on Candidate Details

  # ==================== END TO END ====================

  @positive @e2e
  Scenario: Verify that a superadmin can review a candidate's documents end to end and return to the same list
    Given I have found a candidate whose documents I can open
    When I search the candidates for that candidate's full email
    And I note the candidate listing as it stands
    And I view that candidate and record what the drawer fetches
    Then the drawer header should show that candidate as the server holds them
    And the Documents tab should list exactly the server's documents under their categories
    When I open the first document in the viewer
    Then the viewer's Download should deliver that document and leave the viewer open
    When I close the viewer with "X icon"
    Then Candidate Details should show what the server holds for that candidate
    When I open the "Subscription" candidate panel tab
    And I open the "Activity Log" candidate panel tab
    And I close the candidate panel
    Then the candidate listing should be exactly as it was before the drawer opened
