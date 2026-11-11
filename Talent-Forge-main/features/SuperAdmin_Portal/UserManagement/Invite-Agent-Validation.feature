#ALL PASSED
@invite-agent @superadmin
Feature: Super Admin — Invite New Agent (Basic Info field validation)

  Background:
    Given I am logged in as the superadmin
    And I am on the "Agents" tab of User Management

  @negative
  Scenario: Verify that clearing any required Basic Info field shows its inline error and gates the CTA
    Given I am on the "Invite New Agent" page
    Then clearing each of the following fields should show its inline required error:
      | field                                | value             | error                           |
      | First Name                           | Aisha             | First Name is required.         |
      | Last Name                            | Fahad             | Last Name is required.          |
      | Email Address                        | agent@bytecorp.io | Email Address is required.      |
      | Numeric Performance Target (Monthly) |                10 | Performance target is required. |
    And the "Send Invite" button should be disabled

  @edge-case
  Scenario: Verify that the Basic Info fields filter, cap and bound what can be entered
    Given I am on the "Invite New Agent" page
    When I type 150 letters into "First Name"
    Then "First Name" should hold exactly 100 characters
    And no validation error should be displayed for "First Name"
    When I type 150 letters into "Last Name"
    Then "Last Name" should hold exactly 100 characters
    And no validation error should be displayed for "Last Name"
    Then typing the following should be filtered as shown:
      | field                                | input        | retained     |
      | First Name                           | Mary Jane    | Mary Jane    |
      | First Name                           | O'Neil       | O'Neil       |
      | First Name                           | Aisha123     | Aisha        |
      | First Name                           | Ais@ha!      | Aisha        |
      | First Name                           | Aisha_Noor   | AishaNoor    |
      | Last Name                            | Al-Fahad     | Al-Fahad     |
      | Last Name                            | Van der Berg | Van der Berg |
      | Last Name                            | O'Brien<>    | O'Brien      |
      | Last Name                            |        12345 |              |
      | Numeric Performance Target (Monthly) | abc          |              |
      | Numeric Performance Target (Monthly) |        12abc |           12 |
      | Numeric Performance Target (Monthly) |           -5 |            5 |
      | Numeric Performance Target (Monthly) |           5% |            5 |
      | Numeric Performance Target (Monthly) |          1e3 |           13 |
    And entering the following into "Numeric Performance Target (Monthly)" should be validated as shown:
      | value | error                     |
      |     0 | Value must be at least 1. |
      |     1 |                           |

  @positive @negative
  Scenario: Verify that the form accepts only valid email addresses and a malformed one can never be submitted
    Given I am on the "Invite New Agent" page
    Then the following email addresses should be treated as shown:
      | email                                  | verdict |
      | plainstring                            | invalid |
      | @nodomain.com                          | invalid |
      | user@                                  | invalid |
      | user@@double.com                       | invalid |
      | user name@example.com                  | invalid |
      | user@domain..com                       | invalid |
      | iqra.farooq+agent01@bytecorp.io        | valid   |
      | a.very-long.name@sub.domain.example.sa | valid   |
      | AGENT@BYTECORP.IO                      | valid   |
    When I have filled every required field with valid details
    And I enter "plainstring" into "Email Address"
    And I move focus out of "Email Address"
    Then the "Send Invite" button should be disabled
    And no invite request should be sent

  @negative
  Scenario: Verify that an email that already belongs to a user is rejected and creates nothing
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details using the "existing agent email"
    And I click "Send Invite"
    Then the invite request should be rejected as an already-existing email
    And the success modal should not be displayed
    And I should remain on the "Invite New Agent" page
    When I fill the form with valid details using the "superadmin's own email"
    And I click "Send Invite"
    Then the invite request should be rejected as an already-existing email
    And the success modal should not be displayed
    And no new agent should be created
