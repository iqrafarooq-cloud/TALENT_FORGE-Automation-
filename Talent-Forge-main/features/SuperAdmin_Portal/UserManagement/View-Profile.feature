@superadmin @view-profile
Feature: SuperAdmin User Management - View profile (agent profile and candidate drawer, against the server)

  Background:
    Given I am logged in as the superadmin
  # ==================== AGENT PROFILE: WHAT IT SHOWS ====================

  @agent-management @positive
  Scenario: Verify that the agent profile header shows the opened agent's own details from the server
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    And the profile header should match the server's profile for that agent:
      | field      |
      | name       |
      | email      |
      | university |
      | status     |

  @agent-management @positive
  Scenario: Verify that Target Progress shows the server's figures for the agent's monthly target
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then Target Progress should render the server's percentage, onboarded count and target
    And the target Target Progress measures against should be the agent's monthly target

  @agent-management @positive
  Scenario: Verify that each Target Progress period re-queries the server and renders its answer
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then choosing each Target Progress period should re-query and render the server's figures:
      | period       | duration |
      | Yearly       | yearly   |
      | Year to Date | ytd      |
    And the URL should record the chosen Target Progress period

  @agent-management @positive
  Scenario: Verify that the Quarterly target progress covers the last 4 months, not the current one
    Given I have found an agent who onboarded candidates this month
    When I open that agent's profile and record what the server sends
    Then the Quarterly target progress should count the months before the current one, not the current month

  @agent-management @positive
  Scenario: Verify that Pending Verifications shows the server's total for the agent
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then Pending Verifications should render the server's total for that agent
  # ==================== AGENT PROFILE: CANDIDATES TAB ====================

  @agent-management @positive
  Scenario: Verify that the profile's Candidates tab lists exactly the agent's candidates from the server
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    And I open the "Candidates" profile tab
    Then the profile's Candidates tab should list exactly the candidates the server returned
    And the profile's candidate total should agree with the agent's row on the listing

  @agent-management @positive
  Scenario: Verify that searching the profile's Candidates tab narrows the list on the server
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    And I open the "Candidates" profile tab
    And I search the profile's Candidates tab for part of its first candidate's email
    Then the search should have been sent to the server for that agent
    And every candidate listed on the profile should match the search

  @agent-management @negative
  Scenario: Verify that a search with no match on the profile's Candidates tab says so, not that the agent has none
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    And I open the "Candidates" profile tab
    And I search the profile's Candidates tab for a term no candidate holds
    Then the server should have answered that search with no candidates
    And the profile's Candidates tab should explain that the search matched nothing

  @agent-management @candidate-management @positive
  Scenario: Verify that View on the profile's Candidates tab opens that candidate's drawer
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    And I open the "Candidates" profile tab
    And I view the first candidate on the profile's Candidates tab
    Then the candidate drawer should be showing the candidate whose row was clicked
    And the URL should still be the agent profile's Candidates tab
    When I close the candidate panel
    Then the candidate panel should not be displayed
    And the "Candidates" profile tab should still be selected
  # ==================== AGENT PROFILE: ACTIVITY LOG ====================

  @agent-management @positive
  Scenario: Verify that the profile's Activity Log is the opened agent's and re-queries for each period
    Given I have noted the first agent on the Active tab
    When I open that agent's profile and record what the server sends
    And I open the "Activity Log" profile tab
    Then the Activity Log should be requested for that agent's own account
    And the Activity Log should open on "Last 7 days"
    And choosing each Activity Log period should re-query the server and record it in the URL:
      | period        | duration      |
      | Last 24 hours | last_24_hours |
      | Last 30 days  | last_30_days  |
      | Last 3 months | last_3_months |
      | Last 6 months | last_6_months |
      | This year     | this_year     |
  # ==================== AGENT PROFILE: DEEP LINKS ====================

  @agent-management @edge-case
  Scenario: Verify that each profile tab can be deep-linked and reloaded, and an unknown tab falls back
    Given I have noted the first agent on the Active tab
    When I open that agent's profile and record what the server sends
    Then opening that agent's profile with each tab value should select the expected tab, also after a reload:
      | value       | selected             |
      | candidates  | Candidates           |
      | promoTools  | Promo Tools          |
      | activityLog | Activity Log         |
      | bogus       | Performance Overview |
  # ==================== CANDIDATE DRAWER: WHAT IT SHOWS ====================

  @candidate-management @positive
  Scenario: Verify that the candidate drawer shows the opened candidate's own details from the server
    Given I have noted the first candidate on the "All" tab
    When I view that candidate and record what the server sends
    Then the drawer should have fetched the profile of the candidate whose row was clicked
    And the drawer header should match the server's profile for that candidate
    And the drawer's summary figures should match the server's statistics
    And Basic Information should show the server's email and current status

  @candidate-management @positive
  Scenario: Verify that the drawer lists the candidate's education, work experience and certifications from the server
    Given I have noted the first candidate on the "All" tab
    When I view that candidate and record what the server sends
    Then each profile section in the drawer should list exactly the server's entries:
      | section         | collection       | field            |
      | Education       | educations       | institution_name |
      | Work Experience | work_experiences | company_name     |
      | Certifications  | certifications   | name             |

  @candidate-management @positive
  Scenario: Verify that the drawer's Documents tab holds exactly the documents attached to the candidate's entries
    Given I have found a candidate holding uploaded documents
    When I view that candidate and record what the server sends
    And I open the "Documents" candidate panel tab
    Then each document group should hold exactly the documents attached on the server

  @candidate-management @edge-case
  Scenario: Verify that a reopened drawer starts on Candidate Details whichever tab it was left on
    Given I have noted the first candidate on the "All" tab
    When I view that candidate and record what the server sends
    And I open the "Subscription" candidate panel tab
    And I close the candidate panel
    And I view that candidate and record what the server sends
    Then the "Candidate Details" candidate panel tab should be the selected tab

  @candidate-management @edge-case
  Scenario: Verify that opening a second candidate replaces the first one's details
    Given I have noted the first two candidates on the "All" tab
    When I view the first noted candidate and close the drawer
    And I view the second noted candidate
    Then the drawer should show the second candidate and none of the first one's details
  # ==================== END TO END ====================

  @agent-management @candidate-management @positive @e2e
  Scenario: Verify that a superadmin can go from an agent to one of its candidates and back to the listing
    Given I have found an agent holding active candidates
    When I open that agent's profile and record what the server sends
    Then the profile should be the one for the agent whose row was clicked
    When I open the "Candidates" profile tab
    And I view the first candidate on the profile's Candidates tab
    Then the candidate drawer should be showing the candidate whose row was clicked
    When I close the candidate panel
    And I click the profile "Back" control
    Then I should be on the Agents listing
    And the agent grid should be visible
