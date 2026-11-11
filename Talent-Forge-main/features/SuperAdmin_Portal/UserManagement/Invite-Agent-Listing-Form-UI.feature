#ALL PASSED
@invite-agent @superadmin
Feature: Super Admin — Invite New Agent (Listing structure & form UI)

  Background:
    Given I am logged in as the superadmin
    And I am on the "Agents" tab of User Management

  @positive
  Scenario: Verify that the Agents listing shows its lifecycle tabs and the Invite Agent entry point
    Then the User Management module should show the following sub-tabs:
      | sub-tab    |
      | Agents     |
      | Candidates |
    And the "Agents" sub-tab should be selected
    And the Agents listing should show the following lifecycle tabs:
      | tab                |
      | Active             |
      | Invite Sent        |
      | Requires Attention |
      | Deactivated        |
    And the "Active" tab should be selected
    And each lifecycle tab should render its own columns:
      | tab                | columns                                                                       |
      | Active             | Agent, University, Status, Total Candidates, Monthly Target Progress, Actions |
      | Invite Sent        | Agent, University, Status, Actions                                            |
      | Requires Attention | Agent, University, Issue, Severity, Last Activity, Actions                    |
      | Deactivated        | Agent, University, Status, Transferred Candidates to, Actions                 |
    When I open the "Invite Sent" tab
    Then the tab should either list pending invites or show the empty state "No pending invites"
    When I click "Invite Agent"
    Then I should be on the "Invite New Agent" page
    And the page heading should be "Invite new agent"

  @positive
  Scenario: Verify that the invite form shows its sections, required fields and the University Affiliation dropdown
    Given I am on the "Invite New Agent" page
    Then the form should contain the following sections in order:
      | section                          |
      | Basic Info                       |
      | University & Performance Targets |
      | Promo Code Details               |
    And the following fields should be visible and marked required:
      | field                                |
      | First Name                           |
      | Last Name                            |
      | Email Address                        |
      | University Affiliation               |
      | Numeric Performance Target (Monthly) |
    When I open the "University Affiliation" dropdown
    Then the dropdown options should match the universities configured in Configuration
    When I select the university "King Saud University"
    Then "University Affiliation" should hold "King Saud University"
    When I select the university "Al Maarefa University"
    Then "University Affiliation" should hold "Al Maarefa University"
    And exactly one university should be selected
