@superadmin @agent-management @agent-view
Feature: SuperAdmin User Management - Agents: listing values, profile candidate Edit and Activity Log

  Background:
    Given I am logged in as the superadmin
  # ==================== LISTING VALUES ====================

  @positive
  Scenario: Verify that every row on each Agents tab shows the server's values
    Then every row on the first page of each tab should show the server's values:
      | tab                |
      | Active             |
      | Invite Sent        |
      | Requires Attention |
      | Deactivated        |

  @positive
  Scenario: Verify that a deactivated agent's row names the agent its candidates were transferred to
    Given I have found a deactivated agent whose candidates were transferred
    Then that deactivated agent's row should name the receiving agent the server holds

  @positive
  Scenario: Verify that the filters apply on every Agents tab and are sent with that tab's status
    Then each filter applied on a tab should be sent with that tab's status and honoured:
      | tab                | group           | option | url                 | api                  | status      |
      | Invite Sent        | Candidate Count |      0 | candidateCount=0    | candidate_count=0    | INVITE_SENT |
      | Requires Attention | Candidate Count |   1-50 | candidateCount=1-50 | candidate_count=1-50 | ATTENTION   |
      | Deactivated        | Candidate Count |      0 | candidateCount=0    | candidate_count=0    | DEACTIVATED |

  @positive
  Scenario: Verify that the help icon on the "Total Candidates" column explains the column on hover and keyboard focus
    Given I am on the "Active" tab
    Then the help icon on the "Total Candidates" column should show "Total number of active candidates currently being managed by this agent." on hover and on keyboard focus

  @negative @known-issue
  Scenario: Verify that the help icon on the "Total Candidates" column has an accessible name
    Given I am on the "Active" tab
    Then the help icon on the "Total Candidates" column should have an accessible name

  @positive
  Scenario: Verify that the Agents link in the sidebar opens the Agents listing on its Active tab
    Given I am on the Candidates listing
    When I open "Agents" from the sidebar
    Then the Agents listing should open on its "Active" tab

  @negative @known-issue
  Scenario: Verify that the Agents link in the sidebar resets the listing from a non-default tab
    Given I am on the "Deactivated" tab
    When I open "Agents" from the sidebar
    Then the Agents listing should open on its "Active" tab
  # ==================== PROFILE: CANDIDATES TAB AND ACTIVITY LOG ====================

  @positive
  Scenario: Verify that Edit on the profile's Candidates tab opens that candidate's email change and Cancel changes nothing
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    Then Edit on the first candidate should open the email change for that candidate with its address locked
    And cancelling that email change should send nothing and leave the profile on its Candidates tab

  @edge-case
  Scenario: Verify that the profile Activity Log shows the server's entries, or its empty state, for every period
    Given I have picked the first agent listed on the "Deactivated" tab
    When I view that agent from the "Deactivated" tab and record what the server sends
    And I open the "Activity Log" profile tab
    Then each Activity Log period should render the server's entries or say there is no activity:
      | period        | duration      |
      | Last 24 hours | last_24_hours |
      | Last 30 days  | last_30_days  |
      | Last 3 months | last_3_months |
      | Last 6 months | last_6_months |
      | This year     | this_year     |
      | Last 7 days   | last_7_days   |
