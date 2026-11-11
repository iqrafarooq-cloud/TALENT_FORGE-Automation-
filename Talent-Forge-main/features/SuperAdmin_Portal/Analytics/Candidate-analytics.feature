@candidate-analytics @analytics @superadmin
Feature: SuperAdmin Portal - Candidates Analytics dashboard
  As a Super Admin, I want to view candidate analytics, so that I can monitor onboarding progress,
  learning engagement, university participation, relocation trends and program outcomes.

  # Read-only: both filters are GETs and nothing on the page writes. Every value is compared with
  # the response the app received for the request behind the render - never with a literal.
  # Measured with scripts/probe-superadmin-candidate-analytics{,-2,-3,-4}.js (2026-11-10).

  Background:
    Given I am logged in as the superadmin
    And I have opened the Candidates Analytics dashboard

  # SECTION 1 - STRUCTURE

  @positive @smoke
  Scenario: Verify that the Candidates Analytics dashboard shows both filters and all six widgets
    Then the Candidates Analytics dashboard should offer the Duration filter and the University dropdown
    And the Candidates Analytics dashboard should show these widgets:
      | widget                                 |
      | Total Candidates                       |
      | Candidates by University               |
      | Candidates by City                     |
      | Candidate Journey Funnel               |
      | Candidate Progress & Learning Activity |
      | Co-op & Tamheer                        |

  @negative @known-issue
  Scenario: Verify that the Co-op and Tamheer widget is titled as specified
    Then the Co-op and Tamheer widget should be titled "Co-op & Tamheer Program"

  # SECTION 2 - DURATION FILTER

  @positive
  Scenario: Verify that the dashboard opens on Yearly and the Duration filter offers exactly four durations
    Then the Candidates Analytics Duration filter should offer exactly:
      | duration     |
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year-to-Date |
    And only "Yearly" should be marked as the chosen Candidates Analytics duration
    And every Candidates Analytics widget should have been requested with duration "yearly"

  @positive
  Scenario: Verify that every duration reaches every widget request and the URL
    Then choosing each Candidates Analytics duration should query every widget with its own value:
      | duration     | url value    | api value     |
      | Monthly      | Monthly      | current_month |
      | Quarterly    | Quarterly    | last_quarter  |
      | Year-to-Date | Year-to-Date | ytd           |
      | Yearly       |              | yearly        |

  @positive
  Scenario: Verify that every widget renders what the server returned for each duration
    Then for each Candidates Analytics duration every widget should render the server's figures:
      | duration     |
      | Monthly      |
      | Quarterly    |
      | Year-to-Date |
      | Yearly       |

  @positive
  Scenario: Verify that the comparison line under each figure names the period it compares with
    Then each Candidates Analytics comparison line should name its period:
      | duration     | comparison               |
      | Monthly      | vs last month            |
      | Quarterly    | vs last quarter          |
      | Year-to-Date | vs same period last year |
      | Yearly       | vs last year             |

  @positive
  Scenario: Verify that the trend charts cover Monthly and Year-to-Date correctly
    Then the Candidates Analytics trends should cover these months:
      | duration     | months                       |
      | Monthly      | the current month            |
      | Year-to-Date | January to the current month |

  @negative @known-issue
  Scenario: Verify that Quarterly covers the last 3 months including the current month
    Then the Candidates Analytics trends should cover these months:
      | duration  | months                                      |
      | Quarterly | the last 3 months including the current one |

  @negative @known-issue
  Scenario: Verify that Yearly covers the last 12 months including the current month
    Then the Candidates Analytics trends should cover these months:
      | duration | months                                       |
      | Yearly   | the last 12 months including the current one |

  @positive
  Scenario: Verify that the chosen duration survives a reload
    When I choose the "Quarterly" Candidates Analytics duration
    And I reload the Candidates Analytics dashboard
    Then the Candidates Analytics URL should hold "duration=Quarterly"
    And every Candidates Analytics widget should have been requested with duration "last_quarter"
    And only "Quarterly" should be marked as the chosen Candidates Analytics duration

  @negative @known-issue
  Scenario: Verify that the chosen duration persists when moving between the Analytics tabs
    When I choose the "Quarterly" Candidates Analytics duration
    And I open the "Agents" Analytics tab from the sidebar
    And I open the "Candidates" Analytics tab from the sidebar
    Then every Candidates Analytics widget should have been requested with duration "last_quarter"
    And only "Quarterly" should be marked as the chosen Candidates Analytics duration

  @edge-case
  Scenario: Verify that an unrecognised duration in the URL falls back to Yearly
    When I open the Candidates Analytics dashboard at "?duration=forever"
    Then every Candidates Analytics widget should have been requested with duration "yearly"
    And only "Yearly" should be marked as the chosen Candidates Analytics duration

  @edge-case
  Scenario: Verify that switching duration quickly leaves every widget on the last choice
    When I choose "Monthly" and then "Year-to-Date" Candidates Analytics durations in quick succession
    Then every Candidates Analytics widget should render the Year-to-Date figures

  @negative
  Scenario: Verify that dismissing the Duration popover changes nothing
    Then the Candidates Analytics Duration popover should close without changing anything by each of these routes:
      | route         |
      | Escape        |
      | outside click |

  # SECTION 3 - CANDIDATE OVERVIEW

  @positive
  Scenario: Verify that Active and Onboarding In Progress partition Total Candidates
    Then Active Candidates plus Onboarding In Progress should equal Total Candidates for every duration
    And Requires Attention should never exceed Total Candidates

  # SECTION 4 - CANDIDATES BY UNIVERSITY

  @positive
  Scenario: Verify that the University dropdown lists every configured university and no other
    When I open the Candidates Analytics University dropdown
    Then the University dropdown should list exactly the universities the server configured

  @positive
  Scenario: Verify that the University search narrows the list and says when nothing matches
    When I search the Candidates Analytics universities for "King Saud"
    Then every Candidates Analytics university offered should contain "King Saud"
    When I search the Candidates Analytics universities for "zzqq-no-such-university"
    Then the University dropdown should say "No results found."
    When I search the Candidates Analytics universities for "   "
    Then the University dropdown should offer every configured university

  @positive
  Scenario: Verify that choosing a university shows its total, majors table and donut as the server returned them
    When I choose a Candidates Analytics university that has candidates
    Then the university widget should have been requested for that university with duration "yearly"
    And the university widget should show the server's total candidates
    And the majors table should have the columns:
      | column                |
      | Major                 |
      | Candidates            |
      | Track Completion Rate |
    And the majors table should list every major the server returned, most candidates first
    And the donut should have one sector per major and show the exact count on hover

  @negative @known-issue
  Scenario: Verify that the university insights name the majors behind them
    When I choose a Candidates Analytics university that has candidates
    Then the first university insight should name the two majors with the most candidates
    And the second university insight should name the major with the highest completion rate

  @positive
  Scenario: Verify that changing the duration re-queries the chosen university
    When I choose a Candidates Analytics university that has candidates
    And I choose the "Year-to-Date" Candidates Analytics duration
    Then the university widget should have been requested for that university with duration "ytd"
    And the university widget should show the server's total candidates

  @negative @known-issue
  Scenario: Verify that a university with no candidates shows the empty-state message
    When I choose a Candidates Analytics university that has no candidates
    Then the university widget should say "Candidate analytics will appear once candidates are associated with this university."

  @edge-case @needs-clarification
  Scenario: Verify that a reload clears the chosen university because it is not kept in the URL
    When I choose a Candidates Analytics university that has candidates
    And I reload the Candidates Analytics dashboard
    Then no Candidates Analytics university should be chosen

  # SECTION 5 - CANDIDATES BY CITY

  @positive
  Scenario: Verify that the city bars show each city's candidates and open-to-relocate split as the server returned them
    Then the city chart should list at most 5 cities, none with zero candidates, as the server returned them
    And each city bar should be split by its share of candidates open to relocate
    And Total Candidates Open to Relocate should equal the open-to-relocate candidates of the listed cities

  @positive
  Scenario: Verify that the relocation table shows each city's open-to-relocate count and top destination
    Then the relocation table should list each city with its open-to-relocate count and top destination as the server returned them

  @negative @known-issue
  Scenario: Verify that the city insights name the top cities and the top destination
    Then the first city insight should name the two cities with the most candidates
    And the second city insight should name the most selected destination city

  @negative @known-issue
  Scenario: Verify that hovering a city bar shows its exact counts
    Then hovering a city bar should show its total and open-to-relocate counts

  # SECTION 6 - CANDIDATE JOURNEY FUNNEL

  @positive
  Scenario: Verify that every funnel stage shows the count the server returned and Placed is coming soon
    Then every Candidate Journey Funnel stage should show the server's count
    And the Placed stage should be greyed out, read 0 and explain "Coming soon..."
    And the Candidate Journey Funnel help icon should explain "Displays how candidates are distributed across each stage of the platform journey."

  @negative @known-issue
  Scenario: Verify that the funnel stages follow the order of the candidate journey
    Then the Candidate Journey Funnel stages should be in this order:
      | stage             |
      | Signed Up         |
      | Profile Completed |
      | Track Started     |
      | Co-op Completed   |
      | Tamheer Completed |
      | Track Completed   |
      | Placed            |

  # SECTION 7 - CANDIDATE PROGRESS & LEARNING ACTIVITY

  @positive
  Scenario: Verify that Track Started, Track Completed and Completion Rate match the server and the formula
    Then the progress figures should be the server's for every duration
    And the Completion Rate should be Track Completed divided by Track Started times 100
    And the Candidate Progress help icon should explain "Track completion and learning engagement across the platform."
    And the Learning Activity Trend should plot one point per month the server returned

  @negative @known-issue
  Scenario: Verify that the Learning Activity Trend legend names the specified metrics
    Then the Learning Activity Trend legend should read:
      | legend              |
      | Track Started       |
      | Track Completed     |
      | Certificates Earned |

  @negative @known-issue
  Scenario: Verify that hovering the Learning Activity Trend shows the exact values
    Then hovering the Learning Activity Trend should show the exact values for a month

  # SECTION 8 - CO-OP & TAMHEER

  @positive
  Scenario: Verify that Co-op is the default tab and the program figures match the server
    Then the Co-op tab should be chosen by default
    And the Co-op and Tamheer figures should be the server's
    And the Co-op and Tamheer help icon should explain "Tracks candidate participation and completion across Co-op and Tamheer over time."
    And hovering the Co-op chart should show a month's started and completed counts as the server returned them

  @positive
  Scenario: Verify that the Tamheer tab switches the chart without a request and Co-op is restored on reload
    When I open the Tamheer tab of the Co-op and Tamheer widget
    Then the Tamheer tab should be chosen and no Candidates Analytics request should have been sent
    And hovering the Tamheer chart should show a month's started and completed counts as the server returned them
    When I reload the Candidates Analytics dashboard
    Then the Co-op tab should be chosen by default

  @positive
  Scenario: Verify that the Co-op and Tamheer tabs can be used from the keyboard
    When I open the Tamheer tab of the Co-op and Tamheer widget with the keyboard
    Then the Tamheer tab should be chosen and no Candidates Analytics request should have been sent

  # SECTION 9 - EMPTY AND FAILED STATES

  @positive @mocked @empty-state
  Scenario: Verify that every widget shows its empty state when there is no data
    Given the Candidates Analytics widgets will return no data
    When I reload the Candidates Analytics dashboard
    Then every Candidate Overview metric should read 0
    And every Candidate Journey Funnel stage should read 0
    And the Candidates Analytics widgets should show these empty states:
      | widget                 | text                                                    |
      | Candidates by City     | No candidate data available yet                         |
      | Candidate Progress     | No data to display for learning activity trend          |
      | Co-op & Tamheer        | No data to display for participation & completion trend |

  @negative @mocked @empty-state @known-issue
  Scenario: Verify that the empty chart messages are not wrapped in quotation marks
    Given the Candidates Analytics widgets will return no data
    When I reload the Candidates Analytics dashboard
    Then no Candidates Analytics empty-state message should be wrapped in quotation marks

  @negative @mocked @known-issue
  Scenario: Verify that a failed load is reported instead of shown as an empty dashboard
    Given the Candidates Analytics widgets will fail with a server error
    When I reload the Candidates Analytics dashboard
    Then the Candidates Analytics dashboard should say the data could not be loaded

  # SECTION 10 - ACCESS

  @negative
  Scenario: Verify that only a superadmin can reach the Candidates Analytics dashboard
    Then each of these roles should be refused the Candidates Analytics dashboard:
      | role      |
      | agent     |
      | candidate |

  # SECTION 11 - END TO END

  @positive @e2e
  Scenario: Verify that a superadmin can narrow to a quarter and a university, review every widget and keep the duration after a reload
    When I choose the "Quarterly" Candidates Analytics duration
    And I choose a Candidates Analytics university that has candidates
    Then the university widget should have been requested for that university with duration "last_quarter"
    And every widget should render the server's figures for the current Candidates Analytics duration
    When I open the Tamheer tab of the Co-op and Tamheer widget
    Then the Tamheer tab should be chosen and no Candidates Analytics request should have been sent
    When I reload the Candidates Analytics dashboard
    Then the Candidates Analytics URL should hold "duration=Quarterly"
    And every Candidates Analytics widget should have been requested with duration "last_quarter"
    And the Co-op tab should be chosen by default

  @positive @e2e
  Scenario: Verify that a superadmin can move from Agents Analytics to Candidates Analytics and work the dashboard
    When I open the "Agents" Analytics tab from the sidebar
    And I open the "Candidates" Analytics tab from the sidebar
    Then every Candidates Analytics widget should have been requested with duration "yearly"
    When I choose the "Monthly" Candidates Analytics duration
    Then every widget should render the server's figures for the current Candidates Analytics duration
    And Active Candidates plus Onboarding In Progress should equal Total Candidates
