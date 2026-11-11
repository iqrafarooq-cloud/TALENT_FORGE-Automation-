#ALL PASSED
@invite-agent @superadmin
Feature: Super Admin — Invite New Agent (Submit lifecycle, resend, provisioning)

  Background:
    Given I am logged in as the superadmin
    And I am on the "Agents" tab of User Management

  @e2e @positive @provision @agent-email
  Scenario: Verify that the full invite lifecycle works from submit through the invitation email to Active
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details and a unique agent email padded with spaces
    And I complete the promo section as "Percentage Discount of 20"
    Then the "Send Invite" button should be enabled
    When I click "Send Invite"
    Then the success modal "Agent invited successfully!" should be displayed
    And the success modal should offer the following CTAs:
      | cta              |
      | Invite New Agent |
      | Go to Agents     |
    # --- the modal's reset CTA hands back a clean form ---
    When I click "Invite New Agent" in the success modal
    Then I should be on the "Invite New Agent" page
    And every form field should be empty
    And the checkbox "Add promo code for this agent" should be unchecked
    And the "Send Invite" button should be disabled
    # --- the invite is pending, ONLY pending, and stored without the padding ---
    When I return to the Agents listing as the superadmin
    Then the invited agent should be listed on the "Invite Sent" tab
    And the listed row should show the status "Invite Sent"
    And the listed row should show my details with the padding trimmed
    And the listed row should show the university I selected
    And the row actions available for the invited agent should be "Edit, Resend Invite"
    And the invited agent should not be listed on the "Active" tab
    # --- the invitation mail hands over a working account ---
    When I open the newest "Join Talentforge" email for that agent
    Then the email should be from "noreply@talentforge.com.sa"
    And the email should be addressed to the email I submitted
    And the email should contain a temporary password
    And the email should contain a sign-in CTA
    # --- the agent accepts and onboards itself ---
    When that agent signs in with the temporary password
    Then that agent should be redirected to the set-password screen
    When that agent sets a new password
    And that agent signs in with the new password
    Then that agent should reach the Agent Dashboard
    And the dashboard should greet that agent by their first name
    # --- and the listing follows the agent across the lifecycle ---
    When I return to the Agents listing as the superadmin
    Then the invited agent should move to the "Active" tab
    And the listed row should show the status "Active"
    And the invited agent should no longer be listed on the "Invite Sent" tab
    And exactly one agent should exist with that email

  @e2e @positive @negative @provision
  Scenario: Verify that a pending invite can be resent, and that cancelling the confirmation sends nothing
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details and a unique agent email
    And I click "Send Invite"
    Then the success modal "Agent invited successfully!" should be displayed
    When I click "Go to Agents" in the success modal
    Then I should be on the Agents listing page
    And the invited agent should be listed on the "Invite Sent" tab
    # --- read the first invitation mail, so "a NEW mail arrived" below is provable ---
    When I open the newest "Join Talentforge" email for that agent
    # --- cancelling sends nothing ---
    When I click "Resend Invite" for the invited agent
    Then a "Resend Invitation" confirmation should be displayed naming that agent
    When I cancel the resend confirmation
    Then no resend request should be sent
    And the invited agent should still be listed on the "Invite Sent" tab
    # --- confirming re-sends the invitation ---
    When I click "Resend Invite" for the invited agent
    And I confirm the resend
    Then the toast "Invite re-sent successfully." should be displayed
    And a new "Join Talentforge" email should arrive for that agent
  # A slow backend must not let an impatient double-click create two agents or two promos.

  @e2e @edge-case @provision
  Scenario: Verify that double-clicking Send Invite creates only one agent
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details and a unique agent email
    And I double-click "Send Invite"
    Then the success modal "Agent invited successfully!" should be displayed
    And exactly one invite request should have been sent
    And exactly one agent should exist with that email

  @edge-case
  Scenario: Verify that leaving the invite page by refresh or by Exit submits nothing and discards the draft
    Given I am on the "Invite New Agent" page
    And I have filled every required field with valid details
    When I refresh the page
    Then no new agent should be created
    And I should still be on the "Invite New Agent" page
    And every form field should be empty
    When I have filled every required field with valid details
    And I click "Exit"
    Then I should be on the Agents listing page
    And no new agent should be created
    When I click "Invite Agent"
    Then I should be on the "Invite New Agent" page
    And every form field should be empty

  @negative @needs-clarification
  Scenario: Verify that inviting an existing email tells the superadmin why it failed
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details using the "existing agent email"
    And I click "Send Invite"
    Then the invite request should be rejected as an already-existing email
    And the success modal should not be displayed
    And the toast "An agent with this email already exists." should be displayed
    And I should still be on the "Invite New Agent" page
    And no validation error should be displayed for "Email Address"
    And the "Email Address" field should not be marked as invalid
  #BUG LOGGED

  @negative @known-issue
  Scenario: Verify that an existing email in upper case is rejected as a duplicate
    Given I am on the "Invite New Agent" page
    When I fill the form with valid details using the "existing agent email in upper case"
    And I click "Send Invite"
    Then the invite request should be rejected as an already-existing email
    And the success modal should not be displayed
  #FIXED & VERIFIED 

  @edge-case @known-issue
  Scenario: Verify that unticking the promo checkbox discards the promo details
    Given I am on the "Invite New Agent" page
    And I have filled the promo details with a "Percentage Discount" of "20"
    When I uncheck "Add promo code for this agent"
    And I check "Add promo code for this agent"
    Then "Value" should be empty
    And "Expiry Date" should be empty
    And "Usage Limit" should be empty
   #FIXED & VERIFIED 

  @negative @known-issue
  Scenario: Verify that the performance target rejects a fractional value
    Given I am on the "Invite New Agent" page
    When I type "1.5" into "Numeric Performance Target (Monthly)"
    Then "Numeric Performance Target (Monthly)" should hold "15"
   #FIXED & VERIFIED 

  @negative @known-issue
  Scenario: Verify that an email address without a top-level domain is rejected
    Given I am on the "Invite New Agent" page
    When I enter "user@nodot" into "Email Address"
    And I move focus out of "Email Address"
    Then the email address should be treated as "invalid"

  @e2e @positive @provision
  Scenario: Verify that an agent counts as Active on accepting the invite, before setting a password
    Given I have just invited an agent successfully
    When that agent signs in with the temporary password
    And that agent stops at the set-password screen
    Then the invited agent should move to the "Active" tab
    And the listed row should show the status "Active"
    And the invited agent should no longer be listed on the "Invite Sent" tab
   #FIXED & VERIFIED 

  @e2e @negative @known-issue @provision
  Scenario: Verify that a resent invite stays pending and does not activate the agent
    Given I have just invited an agent successfully
    And the invited agent should be listed on the "Invite Sent" tab
    When I click "Resend Invite" for the invited agent
    And I confirm the resend
    Then the toast "Invite re-sent successfully." should be displayed
    And the invited agent should still be listed on the "Invite Sent" tab
    And the invited agent should not be listed on the "Active" tab
