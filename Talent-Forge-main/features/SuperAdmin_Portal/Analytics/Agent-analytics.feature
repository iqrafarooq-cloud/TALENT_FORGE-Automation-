@agent-analytics @analytics @superadmin
Feature: SuperAdmin Portal - Agents Analytics dashboard

  Background:
    Given I am logged in as the superadmin
    And I have opened the Agents Analytics dashboard
  # SECTION 1 - DASHBOARD STRUCTURE

  @positive @smoke
  Scenario: Verify that the Agents Analytics dashboard shows both global filters and all seven widgets
    Then the Analytics module should offer these sub-tabs:
      | sub-tab    | route                |
      | Agents     | /agents-analytics    |
      | Candidates | /candidate-analytics |
      | Platform   | /platform-analytics  |
    And the Agents Analytics dashboard should offer the "University" and "Duration" filters
    And the Agents Analytics dashboard should show these widgets:
      | widget                          |
      | Total Agents                    |
      | Top Performing Agents           |
      | Agents Requiring Attention      |
      | Revenue Impact                  |
      | Document Verification Overview  |
      | Document Verification Breakdown |
      | Verification Backlog Alerts     |

  @positive
  Scenario: Verify that each Analytics sub-tab opens its own dashboard and Agents opens this one again
    When I open each Analytics sub-tab in turn
    Then each Analytics sub-tab should have opened its own route
    And returning to the Agents sub-tab should load every Agents Analytics widget again
  # SECTION 2 - DURATION FILTER

  @positive
  Scenario: Verify that the Duration filter offers exactly the four durations as a single choice
    Then the Agents Analytics Duration filter should offer exactly:
      | duration     |
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |
    When I choose the "Quarterly" Agents Analytics duration
    And I choose the "Monthly" Agents Analytics duration
    Then only "Monthly" should be marked as the chosen Agents Analytics duration

  @negative @known-issue
  Scenario: Verify that the dashboard opens on Year to Date by default
    Then the Agents Analytics Duration filter should show "Year to Date" as chosen
    And every Agents Analytics widget should have been requested for Year to Date

  @positive
  Scenario: Verify that every duration reaches every widget request and the URL
    Then choosing each Agents Analytics duration should query every widget with its own value:
      | duration     | url value    | api value     |
      | Monthly      | Monthly      | current_month |
      | Quarterly    | Quarterly    | last_quarter  |
      | Yearly       | Yearly       | yearly        |
      | Year to Date | Year-to-Date | ytd           |

  @positive
  Scenario: Verify that every widget renders what the server returned for each duration
    Then for each Agents Analytics duration every widget should render the server's figures:
      | duration     |
      | Monthly      |
      | Quarterly    |
      | Yearly       |
      | Year to Date |

  @positive
  Scenario: Verify that the Revenue and Verification trend charts cover Monthly and Year to Date correctly
    Then the Agents Analytics trend charts should cover these months:
      | duration     | months                       |
      | Monthly      | the current month            |
      | Year to Date | January to the current month |

  @negative @known-issue
  Scenario: Verify that Quarterly covers the last 3 months including the current month
    Then the Agents Analytics trend charts should cover these months:
      | duration  | months                                      |
      | Quarterly | the last 3 months including the current one |

  @negative @known-issue
  Scenario: Verify that Yearly covers the last 12 months including the current month
    Then the Agents Analytics trend charts should cover these months:
      | duration | months                                       |
      | Yearly   | the last 12 months including the current one |

  @negative @known-issue
  Scenario: Verify that the Top Performing Agents widget follows the selected duration
    When I choose the "Monthly" Agents Analytics duration
    And I note the Top Performing Agents the server returned
    And I choose the "Year to Date" Agents Analytics duration
    Then the Top Performing Agents request should carry the "ytd" duration
    And each Top Performing Agent's revenue should match its Revenue Impact revenue for Monthly and for Year to Date

  @positive
  Scenario: Verify that the comparison line under each figure names the period it compares with
    Then each Agents Analytics comparison line should name its period:
      | duration     | comparison               |
      | Monthly      | vs last month            |
      | Quarterly    | vs last quarter          |
      | Yearly       | vs last year             |
      | Year to Date | vs same period last year |

  @positive
  Scenario: Verify that the chosen duration survives a reload
    When I choose the "Quarterly" Agents Analytics duration
    And I reload the Agents Analytics dashboard
    Then the Agents Analytics URL should hold "duration=Quarterly"
    And every Agents Analytics widget should have been requested with duration "last_quarter"
    And only "Quarterly" should be marked as the chosen Agents Analytics duration

  @edge-case
  Scenario: Verify that switching duration quickly leaves the widgets on the last choice
    When I choose "Monthly" and then "Year to Date" in quick succession
    Then every Agents Analytics widget should render the Year to Date figures

  @positive
  Scenario: Verify that a duration can be chosen with the keyboard alone
    When I choose the "Quarterly" Agents Analytics duration with the keyboard
    Then every Agents Analytics widget should have been requested with duration "last_quarter"
    And the Agents Analytics URL should hold "duration=Quarterly"
    And only "Quarterly" should be marked as the chosen Agents Analytics duration

  @negative
  Scenario: Verify that dismissing either filter popover changes nothing
    Then each Agents Analytics filter should close without changing anything by each of these routes:
      | filter     | route         |
      | Duration   | Escape        |
      | Duration   | outside click |
      | University | Escape        |
      | University | outside click |
  # SECTION 3 - UNIVERSITY FILTER

  @positive
  Scenario: Verify that the University filter lists the configured universities and loads more on scroll
    When I open the Agents Analytics University filter
    Then the University options should be the universities the server listed, none of them deleted
    And scrolling the University options should load the next page of universities
    And no University option should be checked

  @positive
  Scenario: Verify that the University search narrows the list and says when nothing matches
    When I open the Agents Analytics University filter
    And I search the Agents Analytics universities for "King"
    Then every University option offered should contain "King"
    When I search the Agents Analytics universities for "zzqq-no-such-university"
    Then the University options should say "No results found."

  @positive
  Scenario: Verify that selecting one university narrows every widget to that university
    When I filter the Agents Analytics dashboard by the university of a top performing agent
    Then every Agents Analytics widget should have been requested for that university only
    And the Agents Analytics URL should hold that university
    And the University filter should show a count of 1
    And every Top Performing Agent listed should belong to the chosen universities
    And every widget should render the server's figures for the current filters

  @positive
  Scenario: Verify that the University filter takes several universities at once
    When I filter the Agents Analytics dashboard by the universities of two top performing agents
    Then every Agents Analytics widget should have been requested for both universities
    And the University filter should show a count of 2
    And every Top Performing Agent listed should belong to the chosen universities
    And the Total Agents for both universities should not exceed the unfiltered Total Agents

  @positive
  Scenario: Verify that clearing the universities shows data from every university again
    When I filter the Agents Analytics dashboard by the university of a top performing agent
    And I clear the Agents Analytics universities
    Then every Agents Analytics widget should have been requested without a university
    And the Total Agents should equal the unfiltered Total Agents
    And the University filter should show no count

  @positive
  Scenario: Verify that the university and duration filters combine and survive a reload
    When I filter the Agents Analytics dashboard by the university of a top performing agent
    And I choose the "Monthly" Agents Analytics duration
    Then every Agents Analytics widget should have been requested for that university with duration "current_month"
    When I reload the Agents Analytics dashboard
    Then every Agents Analytics widget should have been requested for that university with duration "current_month"
    And the chosen university should still be checked in the University filter

  @edge-case
  Scenario: Verify that a university id unknown to the system shows empty widgets rather than other data
    When I open the Agents Analytics dashboard at "?duration=Year-to-Date&university=999999"
    Then every Agents Analytics widget should have been requested with university "999999"
    And every widget should render the server's figures for the current filters

  @positive
  Scenario: Verify that a university can be checked from the keyboard and unchecked again
    When I check the first university with the keyboard
    Then every Agents Analytics widget should have been requested for that university only
    And the University filter should show a count of 1
    When I uncheck that university again
    Then every Agents Analytics widget should have been requested without a university
    And the University filter should show no count
    And the Total Agents should equal the unfiltered Total Agents

  @negative @known-issue
  Scenario: Verify that unchecking the last university also removes it from the URL so a reload shows every university
    When I check the first university with the keyboard
    And I uncheck that university again
    Then the Agents Analytics URL should hold no university
    When I reload the Agents Analytics dashboard
    Then the Agents Analytics dashboard should still show every university

  @edge-case @needs-clarification
  Scenario: Verify that a malformed university value in the URL is ignored rather than applied
    Then opening the dashboard with these university values should ask every widget for every university:
      | value   |
      | abc     |
      |         |
      |      -1 |
      | 117,abc |

  @edge-case @negative
  Scenario: Verify that whitespace and unsafe University search terms are handled safely
    When I open the Agents Analytics University filter
    Then a whitespace-only University search should leave the full list offered
    And searching the universities for an unsafe term should find nothing and run nothing
  # SECTION 4 - WIDGET 1: AGENT PERFORMANCE OVERVIEW

  @negative @known-issue
  Scenario: Verify that Total Agents counts active agents only
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Total Agents figure should equal the number of active agents in User Management

  @positive
  Scenario: Verify that the performance bar splits the agents into its three categories
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the performance bar should show High Performing, Average and Requires Attention as the server counted them
    And each performance bar segment should be sized by its share of the agents

  @negative @known-issue @needs-clarification
  Scenario: Verify that Avg. Candidates per Agent is the active candidates divided by the active agents
    Then the Avg. Candidates per Agent should equal the active candidates divided by the active agents

  @positive
  Scenario: Verify that the average figures are formatted with their units
    Then for each Agents Analytics duration the average figures should be formatted:
      | duration     |
      | Monthly      |
      | Quarterly    |
      | Year to Date |
  # SECTION 5 - WIDGET 2: TOP PERFORMING AGENTS

  @positive
  Scenario: Verify that Top Performing Agents lists at most 5 agents with the specified columns
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Top Performing Agents table should have the columns:
      | column             |
      | Rank               |
      | Agent              |
      | Total Candidates   |
      | Documents Verified |
      | Revenue Generated  |
    And the Top Performing Agents table should list at most 5 agents, ranked from #1, as the server returned them

  @negative @known-issue
  Scenario: Verify that Top Performing Agents are ranked by revenue generated
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Top Performing Agents should be ordered by revenue, then documents verified, then total candidates
  # SECTION 6 - WIDGET 3: AGENTS REQUIRING ATTENTION

  @positive
  Scenario: Verify that Agents Requiring Attention shows its count, at most 5 rows and 4 before scrolling
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Agents Requiring Attention badge should read the server's count as "X Items"
    And Agents Requiring Attention should list at most 5 agents as the server returned them
    And each Agents Requiring Attention row should show a name, a Critical or Warning badge, a reason and how long ago it was triggered
    And only 4 Agents Requiring Attention rows should be visible before scrolling

  @negative @known-issue
  Scenario: Verify that the latest triggered issues appear first in Agents Requiring Attention
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Agents Requiring Attention rows should be ordered newest trigger first

  @negative @known-issue @needs-clarification
  Scenario: Verify that every Agents Requiring Attention reason is one of the four trigger reasons
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then every Agents Requiring Attention reason should be one of:
      | reason                          |
      | Slow verification time          |
      | Target progress behind schedule |
      | High document revision rate     |
      | Low activity                    |

  @positive
  Scenario: Verify that View All opens the Requires Attention tab of User Management and Back returns
    When I choose the "Monthly" Agents Analytics duration
    And I click View All on Agents Requiring Attention
    Then I should be on the Requires Attention tab of the Agents listing
    When I go back to the Agents Analytics dashboard with the browser
    Then the Agents Analytics URL should hold "duration=Monthly"
  # SECTION 7 - WIDGET 4: REVENUE IMPACT

  @positive
  Scenario: Verify that Revenue Impact shows the revenue in SAR and its top 5 revenue agents
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Revenue Impact total should be the server's total in SAR and match Total Revenue in Widget 1
    And the Revenue Trend chart should have one bar month per month the server returned
    And Top Revenue Generating Agents should list at most 5 agents in SAR, highest revenue first, as the server returned them

  @negative @known-issue
  Scenario: Verify that the current month is highlighted on the Revenue Trend chart
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the current month's bar on the Revenue Trend chart should be styled differently from the others
  # SECTION 8 - WIDGET 5: DOCUMENT VERIFICATION OVERVIEW

  @positive
  Scenario: Verify that Document Verification Overview shows the three counts and both trend lines
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then Document Verification Overview should show Verified, Pending and Revision Requested as the server counted them
    And the Verification Activity Trend should offer the "Documents Uploaded" and "Documents Verified" lines
    And the Verification Activity Trend should plot the months the server returned
    And the Verification Activity Trend help icon should explain "Document uploads vs completed verifications over time."
  # SECTION 9 - WIDGET 6: DOCUMENT VERIFICATION BREAKDOWN

  @positive
  Scenario: Verify that the breakdown bar is split into Transcripts, Experience Letters and Certifications
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Verification Breakdown should show each category's count as the server returned it
    And each Verification Breakdown segment should be sized by its count

  @negative @known-issue
  Scenario: Verify that Total Documents Verified agrees with the verified documents and with its categories
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Verification Breakdown total should equal the Verified Documents count
    And the Verification Breakdown categories should add up to its total

  @positive
  Scenario: Verify that Verification Backlog Alerts explains itself, lists 4 agents and opens all of them
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then the Verification Backlog Alerts help icon should explain "Agents with unusually high pending verification queues."
    And the Verification Backlog Alerts help icon should explain itself from the keyboard too
    And Verification Backlog Alerts should list at most 4 agents with their pending count as the server returned them
    When I open View All on Verification Backlog Alerts
    Then the backlog modal should list every agent the server returned with their pending count
    And the backlog modal should close by each of these routes:
      | route         |
      | Close button  |
      | Escape        |
      | outside click |

  @negative @known-issue @needs-clarification
  Scenario: Verify that the pending documents tag is red above 50 and yellow from 30 to 50
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then every Verification Backlog tag should follow the severity rule:
      | pending       | tag    |
      | more than 50  | red    |
      |      30 to 50 | yellow |
      | fewer than 30 | none   |
  # SECTION 11 - EMPTY AND FAILED STATES

  @positive @mocked @empty-state
  Scenario: Verify that every widget shows its own empty state when there is no data
    Given the Agents Analytics widgets will return no data
    When I reload the Agents Analytics dashboard
    Then the Agents Analytics widgets should show these empty states:
      | widget                         | text                                                                                                                    |
      | Total Agents                   | Total Agents 0                                                                                                          |
      | Top Performing Agents          | No top performing agents yet Top performing agents will appear here once agents start achieving performance milestones. |
      | Agents Requiring Attention     | No agents requiring attention yet Agents will appear here when their activity or progress falls below expected levels.  |
      | Revenue Impact                 | No data to display for promo revenue                                                                                    |
      | Document Verification Overview | No data to display for verification activity trend                                                                      |
      | Verification Backlog Alerts    | No verification backlog alerts Alerts will appear here when agents have unusually high pending verification queues.     |

  @positive @mocked @empty-state
  Scenario: Verify that Top Revenue Generating Agents keeps five ranks with dashes when there is no data
    Given the Agents Analytics widgets will return no data
    When I reload the Agents Analytics dashboard
    Then Top Revenue Generating Agents should list ranks #1 to #5 with a dash for agent and revenue

  @negative @mocked @empty-state @known-issue
  Scenario: Verify that the empty widgets show no stray quotation marks
    Given the Agents Analytics widgets will return no data
    When I reload the Agents Analytics dashboard
    Then no Agents Analytics empty-state message should be wrapped in quotation marks

  @negative @mocked @known-issue
  Scenario: Verify that a failed load is reported instead of shown as an empty dashboard
    Given the Agents Analytics widgets will fail with a server error
    When I reload the Agents Analytics dashboard
    Then the Agents Analytics dashboard should say the data could not be loaded
  # SECTION 11b - INTERACTION AND ACCESSIBILITY

  @edge-case @needs-clarification
  Scenario: Verify that the agent names in the widgets are not links
    Given the Agents Analytics dashboard is showing "Year to Date"
    Then clicking an agent name in the Agents Analytics widgets should do nothing

  @positive
  Scenario: Verify that every help icon explains its widget on hover and from the keyboard
    Then every Agents Analytics help icon should explain its widget on hover and on keyboard focus:
      | widget                         | explanation                                             |
      | Document Verification Overview | Document uploads vs completed verifications over time.  |
      | Verification Backlog Alerts    | Agents with unusually high pending verification queues. |
  # SECTION 12 - ACCESS

  @negative
  Scenario: Verify that only a superadmin can reach the Agents Analytics dashboard
    Then each of these roles should be refused the Agents Analytics dashboard:
      | role      |
      | agent     |
      | candidate |
  # SECTION 13 - END TO END

  @positive @e2e
  Scenario: Verify that a superadmin can narrow the dashboard, act on an agent requiring attention and come back
    When I filter the Agents Analytics dashboard by the university of a top performing agent
    And I choose the "Monthly" Agents Analytics duration
    Then every widget should render the server's figures for the current filters
    When I click View All on Agents Requiring Attention
    Then I should be on the Requires Attention tab of the Agents listing
    When I go back to the Agents Analytics dashboard with the browser
    Then every Agents Analytics widget should have been requested for that university with duration "current_month"
    When I clear the Agents Analytics universities
    And I choose the "Year to Date" Agents Analytics duration
    And I open View All on Verification Backlog Alerts
    Then the backlog modal should list every agent the server returned with their pending count

  @positive @e2e
  Scenario: Verify that a superadmin can compare two universities over a quarter, keep the view after a reload and review the whole backlog
    When I filter the Agents Analytics dashboard by the universities of two top performing agents
    And I choose the "Quarterly" Agents Analytics duration with the keyboard
    Then every Agents Analytics widget should have been requested for both universities
    And every widget should render the server's figures for the current filters
    And the Total Agents for both universities should not exceed the unfiltered Total Agents
    When I reload the Agents Analytics dashboard
    Then the Agents Analytics URL should hold "duration=Quarterly"
    And the University filter should show a count of 2
    And every Agents Analytics widget should have been requested for both universities
    And every Agents Analytics widget should have been requested with duration "last_quarter"
    When I clear the Agents Analytics universities
    And I open View All on Verification Backlog Alerts
    Then the backlog modal should list every agent the server returned with their pending count
    And the backlog modal should close by each of these routes:
      | route  |
      | Escape |
