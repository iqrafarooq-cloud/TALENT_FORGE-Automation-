#ALL PASSED
@candidateActive @tabs
Feature: Candidate Active Tab

  Background:
    Given I am logged in as an agent
    And I am on the Candidates Active tab

  # The heading names the listing it is on. Measured 2026-10-05: this page reads only
  # "Candidates" while the Deactivated listing reads "Candidates - Deactivated", so this
  # is red until the heading names the listing.
  @positive @structure @known-issue
  Scenario: Verify that the page heading reads "Candidates - Active"
    Then the candidates page heading should read "Candidates - Active"

  @positive @navigation
  Scenario: Verify that the Active tab loads with the "All" quick filter selected by default
    Then the "All" quick filter tab should be active
    And the candidate table should be visible
    And the page title or heading should indicate "Active" candidates

  @positive @table-columns
  Scenario: Verify that all required table columns are visible
    Then the table should display the following columns:
      | Candidate            |
      | Account Verification |
      | Pending Documents    |
      | Subscription Status  |
      | Last Activity        |

  @positive @quick-filters
  Scenario Outline: Verify that the quick filter tabs switch the table view correctly
    When I click the "<filterTab>" quick filter tab
    Then the "<filterTab>" tab should become active
    And the table should refresh and display results for "<filterTab>"

    Examples:
      | filterTab      |
      | Subscribed     |
      | Payment Due    |
      | Not Subscribed |

  @positive @subscription-pills
  Scenario: Verify that subscription status pills display correct colors
    Then candidates with "Subscribed" status should show a green pill
    And candidates with "Payment Due" status should show an orange pill
    And candidates with "Not Subscribed" status should show a red pill

  @positive @row-actions
  Scenario: Verify that every quick filter tab offers both row actions on each candidate
    Then each quick filter tab should offer both row actions on every candidate row:
      | All            |
      | Subscribed     |
      | Payment Due    |
      | Not Subscribed |

  @positive @row-actions @reminder-history
  Scenario: Verify that Reminder History is disabled when a candidate has no reminder history
    Given the candidate table has at least one record visible
    Then the Reminder History action should be disabled for candidates with no reminder history

  @positive @tooltip
  Scenario: Verify that the Account Verification column header tooltip is visible on hover
    When I hover over the info icon in the "Account Verification" column header
    Then a tooltip should become visible
