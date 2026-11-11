#ALL PASSED
@candidateActive @candidateProfile
Feature: Candidate Active View Profile

  Background:
    Given I am logged in as an agent
    And I am on the Candidates Active tab

  @e2e @search @candidate-profile
  Scenario: Verify that an agent can filter Not Subscribed candidates, search by email, and open the profile
    When I click the "Not Subscribed" quick filter tab
    And the candidate table has at least one record visible
    And I search by the first candidate's email
    And I wait for the search results to update
    Then the table should only display candidates matching the search term
    When I click the eye icon on the first candidate row
    Then I should be on the candidate profile page

  @e2e @candidate-profile
  Scenario: Verify that returning with the UI Back button resets the filter and clears the search
    Given the candidate table has at least one record visible
    When I click the "Subscribed" quick filter tab
    And I search by the first candidate's name
    And I wait for the search results to update
    And I note the current URL and filter state
    And I click the eye icon on the first candidate row
    Then I should be on the candidate profile page
    When I click the "Back" button
    Then I should be returned to the Active tab
    And the "All" quick filter tab should be active
    And the search bar should be empty

  @e2e @candidate-profile
  Scenario: Verify that returning with the browser back button restores the filter and the search
    Given the candidate table has at least one record visible
    When I click the "Subscribed" quick filter tab
    And I search by the first candidate's name
    And I wait for the search results to update
    And I note the current URL and filter state
    And I click the eye icon on the first candidate row
    Then I should be on the candidate profile page
    When I return with the browser back button
    Then I should be returned to the Active tab
    And the "Subscribed" tab should still be active
    And the search term should still be present in the search bar