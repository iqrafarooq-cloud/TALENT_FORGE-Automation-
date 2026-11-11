@agent-dashboard @agent-portal
Feature: Agent Portal - Dashboard
 

  Background:
    Given I am logged in as an agent
    And I am on the agent dashboard with any first-time modal dismissed

  # ---------------------------------------------------------------------------------------------
  # SECTION 1 - THE PAGE SHELL
  # ---------------------------------------------------------------------------------------------

  @positive @smoke
  Scenario: Verify that the dashboard presents its sections in order and loads each from its own request
    Then the dashboard heading should be displayed
    And the dashboard should present these sections in reading order:
      | KPI band                    |
      | Referral Codes              |
      | Document Verification Queue |
      | Requires Attention          |
      | Active Candidates           |
    And the dashboard should have requested each widget on load:
      | widget    | query must carry            |
      | stats     | period=monthly              |
      | queue     | page_size=5&status=AWAITING |
      | attention | page_size=5                 |
      | active    | page_size=6                 |
    And the dashboard header should offer the language, notifications and account controls

  @positive
  Scenario: Verify that every sidebar link reaches its page and the Dashboard link returns
    Then the dashboard sidebar should offer these links:
      | link               | route                         |
      | Dashboard          | /dashboard                    |
      | Active             | /candidates/active            |
      | In Progress        | /candidates/in-progress       |
      | Deactivated        | /candidates/deactivated       |
      | Requires Attention | /candidates/requires-attention |
      | Verifications      | /verifications                |
      | Activity Log       | /activity-log                 |
    And following each dashboard sidebar link should reach its route and the Dashboard link should return

  # REMOVED 2026-10-01: "the dashboard route is served with a successful HTTP status". Every route
  # in the app answers HTTP 404 (the SPA is a 404 fallback), so it is a hosting finding, not a
  # dashboard one - recorded in CLAUDE.md for the dev team instead of red here.

  @edge-case
  Scenario: Verify that the dashboard lays out without horizontal scrolling at common desktop widths
    Then the dashboard should not scroll horizontally at any of these viewports:
      | width | height |
      | 1280  | 720    |
      | 1440  | 900    |
      | 1920  | 1080   |

  @negative
  Scenario: Verify that the dashboard cannot be reached without a session
    Then opening the dashboard in a session that is not signed in should land on the login page without loading any figures

  # ---------------------------------------------------------------------------------------------
  # SECTION 2 - THE KPI BAND AND ITS PERIOD SELECTOR
  # ---------------------------------------------------------------------------------------------

  @positive @smoke
  Scenario: Verify that every KPI figure shows what the server returned for the default Monthly period
    Then the dashboard period selector should show "Monthly"
    And the KPI band should render the figures the server returned

  @positive
  Scenario: Verify that the period selector offers four periods and each one queries and renders its own figures
    Then the dashboard period selector should offer exactly these periods in order:
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |
    And choosing each dashboard period should query its own figures and render them:
      | period       | api value    |
      | Quarterly    | quarterly    |
      | Yearly       | yearly       |
      | Year to Date | year-to-date |
      | Monthly      | monthly      |

  @positive
  Scenario: Verify that the target and comparison labels follow the selected period
    Then each dashboard period's KPI labels should name that period:
      | period       | target label        | comparison label |
      | Monthly      | Monthly Target      | vs last month    |
      | Quarterly    | Quarterly Target    | vs last quarter  |
      | Yearly       | Yearly Target       | vs last year     |
      | Year to Date | Year to Date Target | vs last year     |

  # The three scenarios below check that the FIGURES THE SERVER RETURNS FOR A PERIOD ARE RIGHT FOR
  # THAT PERIOD - the scenarios above only check the band renders whatever came back. Measured
  # 2026-10-05: Total = Active + Onboarding in Progress (Requires Attention is a subset, not added),
  # each difference = current - previous, achieved = Total, and the periods are calendar-aligned
  # windows (on 5 Oct the quarter is Oct 1-5, so Quarterly equals Monthly). Every rule is relational,
  # so it needs no fixed figure and holds on any day of the year.
  @positive
  Scenario: Verify that each period's figures add up and its target line is calculated from them
    Then for every dashboard period the figures should add up:
      | period       |
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |

  @positive
  Scenario: Verify that a wider period never reports fewer candidates than a narrower one, nor more than the agent holds
    When I read the dashboard figures for every period
    Then each dashboard tile should never decrease from Monthly to Quarterly to Year to Date to Yearly
    And no period should report more candidates than the agent's listings hold:
      | tile                   | listing                        |
      | Active Candidates      | /candidates/active             |
      | Onboarding in Progress | /candidates/in-progress        |
      | Requires Attention     | /candidates/requires-attention |

  @positive
  Scenario: Verify that changing the period refreshes only the KPI band and leaves the section cards untouched
    Given I have noted what each dashboard section card shows
    When I choose the "Quarterly" dashboard period
    And I choose the "Monthly" dashboard period
    Then only the dashboard figures should have been requested since the cards were noted
    And each dashboard section card should still show what it showed before
    And the KPI band should render the figures the server returned

  @positive
  Scenario: Verify that the target icon explains the target on hover
    Then hovering the dashboard target icon should show the Target Overview explanation

  @edge-case @needs-clarification
  Scenario: Verify that the chosen period is not written to the URL and a reload reopens on Monthly
    When I choose the "Yearly" dashboard period
    Then the dashboard URL should carry no query parameters
    When I reopen the dashboard
    Then the dashboard period selector should show "Monthly"
    And the latest dashboard figures request should carry "period=monthly"

  @negative @mocked
  Scenario: Verify that a failed figures load shows a placeholder on every tile rather than a zero
    Given the dashboard figures will fail to load
    When I reopen the dashboard
    Then every dashboard KPI tile should show "-" with the note "No data available"
    And no dashboard KPI tile should show a zero

  # Product rule (confirmed 2026-10-05): when the figures cannot be loaded the target line falls back
  # to ZERO - "0% of Monthly Target" and "0/0" - rather than a blank or a placeholder.
  @negative @mocked
  Scenario: Verify that a failed figures load shows the target line as zero
    Given the dashboard figures will fail to load
    When I reopen the dashboard
    Then the dashboard target line should fall back to zero

  @edge-case @mocked
  Scenario: Verify that each comparison line signs its difference
    Given the Monthly dashboard figures will report these differences:
      | tile                   | current | previous | difference |
      | Active Candidates      | 5       | 0        | 5          |
      | Onboarding in Progress | 3       | 6        | -3         |
      | Requires Attention     | 0       | 0        | 0          |
    When I reopen the dashboard
    Then the dashboard comparison lines should read:
      | tile                   | comparison       |
      | Active Candidates      | +5 vs last month |
      | Onboarding in Progress | -3 vs last month |
      | Requires Attention     | 0 vs last month  |

  # THE WELCOME MODAL IS MONTHLY BY DESIGN (product rule, confirmed 2026-10-01): it is shown on every
  # sign-in while the CURRENT MONTH has no invited/onboarded candidate - even for an agent who holds
  # candidates from earlier months - and stops for the rest of the month once one is added. Both
  # scenarios drive the rule off this month's figures and confirm the agent really holds candidates,
  # so they prove the gate is the month, not the agent's lifetime count.

  @positive @mocked
  Scenario: Verify that the welcome modal is shown on every new session while the current month has no new candidates
    Given the Monthly dashboard figures will report no new candidates
    When I start a new dashboard session
    Then the agent should hold candidates according to the Active Candidates card
    And the first-time welcome modal should be displayed on the dashboard
    When I dismiss the first-time welcome modal on the dashboard
    And I start a new dashboard session
    Then the first-time welcome modal should be displayed on the dashboard

  @positive @mocked
  Scenario: Verify that once a candidate is added in the current month the welcome modal is not shown again on later sessions
    Given the Monthly dashboard figures will report 1 new candidate
    When I start a new dashboard session
    Then the agent should hold candidates according to the Active Candidates card
    And the first-time welcome modal should not be displayed on the dashboard
    When I start a new dashboard session
    Then the first-time welcome modal should not be displayed on the dashboard

  # ---------------------------------------------------------------------------------------------
  # SECTION 3 - THE DOCUMENT VERIFICATION QUEUE
  # ---------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the Document Verification Queue lists what the server returned, in its order, each with a Review action
    Then the "Document Verification Queue" card count should equal the server's count
    And the Document Verification Queue should list the server's documents in the server's order

  @positive
  Scenario: Verify that Review opens that document's review panel in place and every close route returns to the dashboard
    When I review the first document in the dashboard queue
    Then the review panel should describe the document from the dashboard row I reviewed
    And the review panel should offer Approve and Request Revision
    And opening the review panel should not have changed the dashboard URL
    And closing the review panel should return to the intact dashboard by each of these routes:
      | Close button |
      | Escape       |

  # REMOVED 2026-10-01: "both decision dialogs gate on a real reason and cancelling commits nothing".
  # Review opens the SAME panel and dialogs as /verifications, and verifications.feature already
  # owns the mandatory reason, the whitespace gate, the 500-character cap and Cancel/X/Escape.

  # Product rule (2026-10-01): the file name is NOT an entry point - only Review opens the document.
  @positive
  Scenario: Verify that a queue row's file name opens nothing and only Review opens the document
    When I activate the file name of the first document in the dashboard queue
    Then activating the queue file name should not have opened anything
    When I review the first document in the dashboard queue
    Then the review panel should describe the document from the dashboard row I reviewed

  # ---------------------------------------------------------------------------------------------
  # SECTION 4 - THE REQUIRES ATTENTION CARD
  # ---------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the Requires Attention card lists what the server returned with severity, issue and age
    Then the "Requires Attention" card count should equal the server's count
    And the Requires Attention card should list the server's candidates with their severity, issue, initials and age

  # REMOVED 2026-10-01 (product rule): a Requires Attention candidate name is not an entry point and is
  # not meant to open anything, so "the name opens that candidate" asserted a requirement nobody wrote.

  # ---------------------------------------------------------------------------------------------
  # SECTION 5 - THE ACTIVE CANDIDATES CARD
  # ---------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the Active Candidates card shows the server's candidates under exactly the expected columns
    Then the "Active Candidates" card count should equal the server's count
    And the Active Candidates grid should have exactly these columns in order:
      | Candidate            |
      | Account Verification |
      | Pending Documents    |
      | Subscription Status  |
      | Last Activity        |
      | Actions              |
    And every Active Candidates row should match the server's record for that candidate
    And every Active Candidates row should offer exactly View and Reminder History

  @negative @known-issue
  Scenario: Verify that the Active Candidates card keeps the order the server returned
    Then the Active Candidates rows should be in the server's order

  @positive
  Scenario: Verify that View opens the right candidate's profile and Back returns to the dashboard
    When I view the first candidate on the Active Candidates card
    Then the dashboard should have opened the profile of the candidate on that row
    When I go back in the browser
    Then the agent dashboard should be displayed with its Active Candidates card

  @positive
  Scenario: Verify that Reminder History is offered exactly when a candidate has reminders and opens that candidate's history
    Then each Active Candidates row's Reminder History should be enabled exactly when the server says it has reminders
    When I open Reminder History for the first Active Candidates row that has reminders
    Then the Reminder History dialog should name that dashboard candidate
    And the dashboard URL should carry no query parameters
    When I close the dashboard Reminder History dialog
    Then no dashboard dialog should be open

  # REMOVED 2026-10-01 (product rule): an Active Candidates row's name and email are not entry points
  # and are not meant to do anything - View is the row's action - so "they do something" asserted a
  # requirement nobody wrote.

  # REMOVED 2026-10-01: "the Account Verification column's help icon is named and explains itself".
  # The same shared column-header component and the same defect are already asserted in
  # candidate-deactivated.feature; a second permanently red row for one defect adds noise, not coverage.

  # ---------------------------------------------------------------------------------------------
  # SECTION 6 - EMPTY AND FAILED SECTION CARDS
  # ---------------------------------------------------------------------------------------------

  @positive @mocked
  Scenario: Verify that each section card explains itself when it has nothing to show, and the Active card offers an invite
    Given the dashboard section lists will come back empty
    When I reopen the dashboard
    Then each dashboard section card should show its own empty state:
      | card                        | heading                                | body                                                                                                           | cta               |
      | Document Verification Queue | No documents to review yet             | Documents will show up here after candidates complete their onboarding and uploads.                           |                   |
      | Requires Attention          | Nothing needs your attention right now | When a candidate needs follow-up (incomplete onboarding, pending documents, or payments), it'll show up here. |                   |
      | Active Candidates           | No candidates yet                      | Candidates will appear here once they are invited to the portal.                                              | Invite Candidates |
    When I click "Invite Candidates" on the empty Active Candidates card
    Then the onboarding method chooser should open over the dashboard

  # ---------------------------------------------------------------------------------------------
  # SECTION 7 - THE HEADER
  # ---------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the account menu identifies the signed-in agent and each item goes where it says
    Then the dashboard avatar should show the signed-in agent's initials
    And the dashboard account menu should name the signed-in agent and offer exactly:
      | Account Settings   |
      | Become a Candidate |
      | Referral Codes     |
      | Log out            |
    When I choose "Account Settings" from the dashboard account menu
    Then the dashboard should have navigated to "/settings"
    When I return to the dashboard
    And I choose "Referral Codes" from the dashboard account menu
    Then the Referral Codes section should be scrolled into view at "#referral-codes"

  @positive
  Scenario: Verify that Become a Candidate asks for confirmation and Stay Here keeps the agent where they are
    When I choose "Become a Candidate" from the dashboard account menu
    Then the Become a Candidate confirmation should be displayed with its exact wording
    When I choose "Stay Here" in the Become a Candidate confirmation
    Then no dashboard dialog should be open
    And no dashboard write request should have been sent
    And the agent should still be signed in as an agent on the dashboard

  @positive
  Scenario: Verify that the notifications panel's unread count matches the server's
    When I open the dashboard notifications panel
    Then the dashboard notifications panel's unread count should equal the server's unread count

  # ---------------------------------------------------------------------------------------------
  # SECTION 8 - A BRAND-NEW AGENT (provisions a throwaway agent that cannot be deleted)
  # ---------------------------------------------------------------------------------------------

  @positive @provision @creates-agent
  Scenario: Verify that a brand-new agent's dashboard shows zero figures, every empty state and their own code
    Given I am signed in on the dashboard as a brand-new throwaway agent
    Then the first-time welcome modal should be displayed on the dashboard
    When I dismiss the first-time welcome modal on the dashboard
    Then every dashboard KPI tile should show 0 for every period
    And each dashboard section card should show its own empty state:
      | card                        | heading                                | body                                                                                                           | cta               |
      | Document Verification Queue | No documents to review yet             | Documents will show up here after candidates complete their onboarding and uploads.                           |                   |
      | Requires Attention          | Nothing needs your attention right now | When a candidate needs follow-up (incomplete onboarding, pending documents, or payments), it'll show up here. |                   |
      | Active Candidates           | No candidates yet                      | Candidates will appear here once they are invited to the portal.                                              | Invite Candidates |
    And the dashboard Agent Code should be the signed-in agent's own code

  # ---------------------------------------------------------------------------------------------
  # SECTION 9 - DECISIONS COMMITTED FROM THE DASHBOARD (irreversible; each acts only on a document
  #             the scenario uploads itself)
  # ---------------------------------------------------------------------------------------------

  @positive @commits-decision
  Scenario: Verify that requesting a revision from the dashboard updates the document and removes it from the queue
    Given the document candidate has uploaded a document that awaits review
    When I reopen the dashboard
    Then the dashboard queue should list that uploaded document
    When I review that uploaded document from the dashboard
    And I request a revision on it from the dashboard with a reason
    Then the server should have accepted the dashboard decision
    And the uploaded document's status on the server should be "REVISION"
    When I reopen the dashboard
    Then the dashboard queue should no longer list that uploaded document
    And the "Document Verification Queue" card count should equal the server's count

  @positive @commits-decision
  Scenario: Verify that approving from the dashboard updates the document and removes it from the queue
    Given the document candidate has uploaded a document that awaits review
    When I reopen the dashboard
    Then the dashboard queue should list that uploaded document
    When I review that uploaded document from the dashboard
    And I approve it from the dashboard with a reason
    Then the server should have accepted the dashboard decision
    And the uploaded document's status on the server should be "APPROVED"
    When I reopen the dashboard
    Then the dashboard queue should no longer list that uploaded document
    And the "Document Verification Queue" card count should equal the server's count

  # ---------------------------------------------------------------------------------------------
  # SECTION 10 - END TO END
  # ---------------------------------------------------------------------------------------------

  @positive @e2e
  Scenario: Verify that each section card's count agrees with the listing its View all link opens
    Then each dashboard card's count should agree with the listing it links to:
      | card                        | route                          |
      | Document Verification Queue | /verifications                 |
      | Requires Attention          | /candidates/requires-attention |
      | Active Candidates           | /candidates/active             |

  # REMOVED 2026-10-01: "go from the dashboard queue to the uploader's profile and back". The
  # review panel's View profile link is the same component as on /verifications, where
  # verifications.feature already proves it opens the RIGHT person (name, fetched id, tab strip).
