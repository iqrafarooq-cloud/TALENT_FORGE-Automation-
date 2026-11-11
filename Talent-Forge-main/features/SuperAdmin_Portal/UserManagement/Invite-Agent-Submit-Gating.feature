#ALL PASSED
#(Just the Send Invite CTA enable/disable logic across the whole form)
@invite-agent @superadmin
Feature: Super Admin — Invite New Agent (Send Invite CTA gating)

  Background:
    Given I am logged in as the superadmin
    And I am on the "Agents" tab of User Management

  @positive @negative
  Scenario: Verify that Send Invite stays gated until every required field — promo included — is complete
    Given I am on the "Invite New Agent" page
    Then the "Send Invite" button should be disabled
    And the submit CTA text should be exactly "Send Invite"
    When I have filled every required field except "University Affiliation"
    Then the "Send Invite" button should be disabled
    When I select the university "King Saud University"
    Then the "Send Invite" button should be enabled
    And clearing each of the following fields should disable "Send Invite" until it is restored:
      | field                                | value                     |
      | First Name                           | Aisha                     |
      | Last Name                            | AlFahad                   |
      | Email Address                        | aisha.alfahad@bytecorp.io |
      | Numeric Performance Target (Monthly) |                        10 |
    When I check "Add promo code for this agent"
    Then the "Send Invite" button should be disabled
    When I select the incentive type "Percentage Discount"
    And I enter "20" into "Value"
    And I enter "100" into "Usage Limit"
    Then "Expiry Date" should be empty
    And the "Send Invite" button should be disabled
    When I select an expiry date 30 days from today
    Then the "Send Invite" button should be enabled
    And clearing each of the following fields should disable "Send Invite" until it is restored:
      | field       | value |
      | Value       |    20 |
      | Usage Limit |   100 |
    When I select the incentive type "Fixed Amount"
    And I enter "200" into "Value"
    Then the "Send Invite" button should be enabled
