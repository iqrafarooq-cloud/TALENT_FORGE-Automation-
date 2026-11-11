#ALL PASSED
@agent-management @superadmin @edit-email
Feature: SuperAdmin User Management - Edit / Update Email Address

  Background:
    Given I am logged in as the superadmin
  # ==================== 1. WHERE THE ACTION EXISTS ====================

  @positive
  Scenario: Verify that the Edit action is offered on every listing and tab that supports it
    Given I am on the Agents listing
    Then the row Edit action should be offered as follows:
      | listing    | tab                | edit     |
      | Agents     | Active             | yes      |
      | Agents     | Invite Sent        | yes      |
      | Agents     | Requires Attention | no       |
      | Agents     | Deactivated        | no       |
      | Candidates | All                | yes      |
      | Candidates | Active             | yes      |
      | Candidates | Deactivated        | disabled |
  # ==================== 2. THE FORM'S CONTRACT, ON BOTH LISTINGS ====================

  @positive
  Scenario: Verify that Edit opens the Update Email Address modal with the current address locked
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    Then the modal heading should be "Update Email Address"
    And the modal should show the fields:
      | Current Email Address |
      | New Email Address     |
      | Confirm Email Address |
    And the current email address should be that agent's email
    And the current email address field should not be editable
    And the modal primary button should read "Update"
    And the modal "Update" button should be disabled
    And the modal should offer "Cancel" and "Update"

  @positive
  Scenario: Verify that the Candidates listing offers the same modal under its own field labels
    Given I have noted the first candidate on the "All" tab
    When I open the Update Email Address modal for that record
    Then the modal heading should be "Update Email Address"
    And the modal should show the fields:
      | Current Email     |
      | New Email Address |
      | Confirm New Email |
    And the current email address should be that record's email
    And the current email address field should not be editable
    And the modal primary button should read "Update"
    And the modal "Update" button should be disabled
    And the modal should offer "Cancel" and "Update"

  @positive
  Scenario: Verify that both editable fields start empty and carry their own placeholders
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    Then the New and Confirm email fields should be empty
    And the "New Email Address" field placeholder should read "Enter your new email"
    And the "Confirm Email Address" field placeholder should read "Re-enter your new email"
  # ==================== 3. VALIDATION ====================

  @negative
  Scenario: Verify that the Agents modal refuses every invalid combination with its own message
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    Then each invalid email combination should be refused with its own message:
      | newEmail               | confirmEmail           | message                             |
      | notanemail             | notanemail             | Please enter a valid email address. |
      | no@domain              | no@domain              | Please enter a valid email address. |
      | spaced out@bytecorp.io | spaced out@bytecorp.io | Please enter a valid email address. |
      | valid.one@bytecorp.io  | valid.two@bytecorp.io  | The emails do not match.            |
      | THE RECORD'S OWN EMAIL | THE RECORD'S OWN EMAIL | New email must be different         |
    And the modal "Update" button should be disabled

  @negative @needs-clarification
  Scenario: Verify that the Candidates modal refuses every invalid combination with its own message
    Given I have noted the first candidate on the "All" tab
    When I open the Update Email Address modal for that record
    Then each invalid email combination should be refused with its own message:
      | newEmail               | confirmEmail           | message                             |
      | notanemail             | notanemail             | Please enter a valid email address. |
      | no@domain              | no@domain              | Please enter a valid email address. |
      | valid.one@bytecorp.io  | valid.two@bytecorp.io  | The emails do not match.            |
      | THE RECORD'S OWN EMAIL | THE RECORD'S OWN EMAIL | New email must be different.        |
    And the modal "Update" button should be disabled

  @edge-case
  Scenario: Verify that an empty or whitespace-only address gates Update without an error message
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "" as the new email and "" as the confirmation
    Then the modal "Update" button should be disabled
    And no inline error should be shown in the modal
    When I enter "   " as the new email and "   " as the confirmation
    Then the modal "Update" button should be disabled
    And no inline error should be shown in the modal

  @positive
  Scenario: Verify that Update is enabled only once the address is valid, matching and different
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "qa.agent.rename@bytecorp.io" as the new email and "qa.agent.rename@bytecorp.io" as the confirmation
    Then no inline error should be shown in the modal
    And the modal "Update" button should be enabled
    When I enter "qa.agent.rename@bytecorp.io" as the new email and "qa.agent.other@bytecorp.io" as the confirmation
    Then the modal "Update" button should be disabled
    And the modal should show the inline error "The emails do not match."

  @edge-case
  Scenario: Verify that a confirmation differing only in letter case counts as matching
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "QA.Agent.Case@BYTECORP.IO" as the new email and "qa.agent.case@bytecorp.io" as the confirmation
    Then the modal should not show the inline error "The emails do not match."
    And the modal "Update" button should be enabled

  @negative
  Scenario: Verify that filling only one of the two address fields never enables Update
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "qa.partial@bytecorp.io" as the new email and "" as the confirmation
    Then the modal "Update" button should be disabled
    And no inline error should be shown in the modal
    When I enter "" as the new email and "qa.partial@bytecorp.io" as the confirmation
    Then the modal "Update" button should be disabled
    And the modal should show the inline error "The emails do not match."

  @edge-case
  Scenario: Verify that the record's current address is refused whatever case it is typed in
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter that agent's own email address in upper case in both fields
    Then the modal should show the inline error "New email must be different"
    And the modal "Update" button should be disabled

  @edge-case @needs-clarification
  Scenario: Verify that an address padded with spaces is accepted and kept untrimmed
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "  qa.padded@bytecorp.io  " as the new email and "  qa.padded@bytecorp.io  " as the confirmation
    Then no inline error should be shown in the modal
    And the modal "Update" button should be enabled
    And the new email field should still hold "  qa.padded@bytecorp.io  "
  # ==================== 4. SERVER-SIDE REFUSALS ====================

  @negative
  Scenario: Verify that an address already registered to another account is refused
    Given I am on the Agents listing
    And I have noted an Active agent that can be offered an email change
    When I open the Update Email Address modal for that agent
    And I enter "faran.mustafa@bytecorp.io" as the new email and "faran.mustafa@bytecorp.io" as the confirmation
    Then the modal "Update" button should be enabled
    When I submit the Update Email Address form
    Then the update should be refused with the message "An account with this email already exists."
    And the Update Email Address modal should still be open
    And that agent should still be listed with the original email address
  # ==================== 5. LEAVING THE MODAL WITHOUT SUBMITTING ====================

  @positive
  Scenario: Verify that cancelling the Update Email Address modal leaves the agent unchanged
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "qa.discarded@bytecorp.io" as the new email and "qa.discarded@bytecorp.io" as the confirmation
    And I cancel the Update Email Address modal
    Then the Update Email Address modal should not be visible
    And that agent should still be listed with the original email address

  @positive
  Scenario: Verify that the X icon and Escape both close the modal and discard what was typed
    Given I am on the Agents listing
    And I have noted the first Active agent with no email change pending
    When I open the Update Email Address modal for that agent
    And I enter "qa.discarded.icon@bytecorp.io" as the new email and "qa.discarded.icon@bytecorp.io" as the confirmation
    And I close the Update Email Address modal with the X icon
    Then the Update Email Address modal should not be visible
    When I open the Update Email Address modal for that agent
    Then the New and Confirm email fields should be empty
    And the modal "Update" button should be disabled
    When I enter "qa.discarded.esc@bytecorp.io" as the new email and "qa.discarded.esc@bytecorp.io" as the confirmation
    And I dismiss the Update Email Address modal with Escape
    Then the Update Email Address modal should not be visible
    When I open the Update Email Address modal for that agent
    Then the New and Confirm email fields should be empty
    When I cancel the Update Email Address modal
    Then that agent should still be listed with the original email address

  @positive
  Scenario: Verify that cancelling on the Candidates listing leaves that candidate unchanged
    Given I have noted the first candidate on the "All" tab
    When I open the Update Email Address modal for that record
    And I enter "qa.candidate.discarded@bytecorp.io" as the new email and "qa.candidate.discarded@bytecorp.io" as the confirmation
    And I close the Update Email Address modal with the X icon
    Then the Update Email Address modal should not be visible
    And that record should still be listed with the original email address
  # ==================== 6. THE PENDING STATE ====================

  @positive @mutates-email @provision
  Scenario: Verify that a submitted change marks the address as awaiting verification
    Given I have provisioned a throwaway agent for the email-change walkthrough
    When I open the Update Email Address modal for that record
    And I change that record's email to a fresh address on the test inbox
    Then the update should be accepted with the message "Verification email sent to the updated email."
    And the Update Email Address modal should not be visible
    And the listing should show that address in red with a warning icon
    And the listing should still show the original address as the live one
    And the server should record the new address as pending verification

  @positive @mutates-email @provision
  Scenario: Verify that the warning icon explains why the address is marked
    Given I have provisioned a throwaway agent for the email-change walkthrough
    When I open the Update Email Address modal for that record
    And I change that record's email to a fresh address on the test inbox
    Then the listing should show that address in red with a warning icon
    And hovering the warning icon should read "Email update will take effect once the new email is verified by the agent."
  # ==================== 7. EDITING AN ADDRESS THAT IS ALREADY PENDING ====================

  @positive @mutates-email @provision
  Scenario: Verify that re-opening Edit on a pending change shows the pending notice, not the form
    Given I have provisioned a throwaway agent for the email-change walkthrough
    When I open the Update Email Address modal for that record
    And I change that record's email to a fresh address on the test inbox
    Then the server should record the new address as pending verification
    When I open the Update Email Address modal for that record
    Then the modal should say an email update is already pending
    And the pending notice should name the live address and the pending one
    And the pending notice should say it is awaiting verification and offer "Edit Email"
    When I choose "Edit Email" on the pending notice
    Then the form should reopen with the live address as the current email
    And the modal "Update" button should be disabled
    When I cancel the Update Email Address modal
    Then the Update Email Address modal should not be visible

  @positive @e2e @mutates-email @provision
  Scenario: Verify that an email change completes once the recipient verifies the new address
    Given I have provisioned a throwaway agent for the email-change walkthrough
    When I open the Update Email Address modal for that record
    And I change that record's email to a fresh address on the test inbox
    Then the update should be accepted with the message "Verification email sent to the updated email."
    And the listing should show that address in red with a warning icon
    And the server should record the new address as pending verification
    And a verification email should be delivered to the new address
    When the recipient opens the verification link
    Then the verification page should confirm the address is now active
    And the listing should show the new address with no pending marker
    And opening the same link again should report it invalid or expired
  # ==================== 8. INVITE SENT: CHANGE THE ADDRESS AND RESEND THE INVITATION ====================

  @positive
  Scenario: Verify that Edit on an agent who has not claimed their invite opens the form with a Next step
    Given I have noted the first agent listed on the "Invite Sent" tab
    When I open the Update Email Address modal for that record
    Then the modal heading should be "Update Email Address"
    And the modal should show the fields:
      | Current Email Address |
      | New Email Address     |
      | Confirm Email Address |
    And the current email address should be that record's email
    And the current email address field should not be editable
    And the New and Confirm email fields should be empty
    And the "New Email Address" field placeholder should read "Enter your new email"
    And the "Confirm Email Address" field placeholder should read "Re-enter your new email"
    And the modal primary button should read "Next"
    And the modal should offer "Cancel" and "Next"

  @positive
  Scenario: Verify that Next asks to resend the invitation to the new address before changing anything
    Given I have noted the first agent listed on the "Invite Sent" tab
    When I open the Update Email Address modal for that record
    And I enter "qa.invitesent.rename@bytecorp.io" as the new email and "qa.invitesent.rename@bytecorp.io" as the confirmation
    And I press Next on the Update Email Address modal
    Then the form should have been replaced by the Resend Invitation dialog
    And the Resend Invitation dialog should read:
      | Resend Invitation                                                                                                              |
      | You’re about to resend the invitation to the updated email address:                                                            |
      | qa.invitesent.rename@bytecorp.io                                                                                               |
      | They’ll receive a new email with the signup link. Any previous invite links sent to the old email address will no longer work. |
    And the Resend Invitation dialog should offer "Cancel", "Resend Invite" and a close icon
    And no email change should have been sent to the server

  @positive
  Scenario: Verify that leaving the form or the Resend Invitation dialog any way changes nothing
    Given I have noted the first agent listed on the "Invite Sent" tab
    Then leaving each dialog each way should change nothing and send nothing:
      | dialog            | way out    |
      | the form          | Cancel     |
      | the form          | the X icon |
      | the form          | Escape     |
      | Resend Invitation | Cancel     |
      | Resend Invitation | the X icon |
      | Resend Invitation | Escape     |
    And that record should still be listed with the original email address

  @negative
  Scenario: Verify that Next is disabled by default and enabled only for a valid, matching, different address
    Given I have noted the first agent listed on the "Invite Sent" tab
    Then the Next button should be in this state for each input:
      | new email                       | confirmation                    | Next     |
      | <empty>                         | <empty>                         | disabled |
      | <spaces>                        | <spaces>                        | disabled |
      | no-at-sign                      | no-at-sign                      | disabled |
      | valid.one@bytecorp.io           | valid.two@bytecorp.io           | disabled |
      | <current>                       | <current>                       | disabled |
      | qa.only@bytecorp.io             | <empty>                         | disabled |
      | <empty>                         | qa.only@bytecorp.io             | disabled |
      | qa.invitesent.valid@bytecorp.io | qa.invitesent.valid@bytecorp.io | enabled  |

  @negative
  Scenario: Verify that the Invite Sent form stops an unusable address with its own message before the resend step
    Given I have noted the first agent listed on the "Invite Sent" tab
    Then each unusable address should be stopped on the form before the resend step:
      | new email               | confirmation            | message                             |
      | no-at-sign              | no-at-sign              | Please enter a valid email address. |
      | no@domain               | no@domain               | Please enter a valid email address. |
      | spaced out@bytecorp.io  | spaced out@bytecorp.io  | Please enter a valid email address. |
      | valid.one@bytecorp.io   | valid.two@bytecorp.io   | The emails do not match.            |
      | <current>               | <current>               | New email must be different         |
      | <current in upper case> | <current in upper case> | New email must be different         |
      | qa.only@bytecorp.io     | <empty>                 | -                                   |
      | <empty>                 | qa.only@bytecorp.io     | -                                   |

  @edge-case @needs-clarification
  Scenario: Verify that a confirmation differing only in letter case counts as matching on the Invite Sent tab
    Given I have noted the first agent listed on the "Invite Sent" tab
    When I open the Update Email Address modal for that record
    And I enter "QA.InviteSent.Case@BYTECORP.IO" as the new email and "qa.invitesent.case@bytecorp.io" as the confirmation
    And I press Next on the Update Email Address modal
    Then the form should have been replaced by the Resend Invitation dialog

  @negative @mutates-email @provision @needs-clarification
  Scenario: Verify that an address the server cannot use is refused with a message saying why
    Given I have invited a throwaway agent who has not claimed the invite
    Then each of these addresses should be refused when the invitation is resent, with its toast:
      | new email                             | toast                                      |
      | <another agent's email>               | An account with this email already exists. |
      | <another agent's email in upper case> | An account with this email already exists. |
      | <a candidate's email>                 | An account with this email already exists. |
    And that record should still be listed with the original email address

  @positive @e2e @mutates-email @provision
  Scenario: Verify that changing an un-claimed agent's email resends the invitation to the new address
    Given I have invited a throwaway agent who has not claimed the invite
    When I open the Update Email Address modal for that record
    And I enter a fresh address on the test inbox as the new email and confirmation
    And I press Next on the Update Email Address modal
    Then the Resend Invitation dialog should name the new address
    When I confirm Resend Invite
    Then the change should be accepted with the toast "Verification email sent to the updated email."
    And the server should have changed the address straight away rather than holding it pending
    And the Invite Sent tab should list the agent at the new address with no pending marker
    And the agent should no longer be listed at the original address
    And the row's Edit action should be disabled while the re-invite cooldown runs
    And an invitation email should be delivered to the new address
    And the original invitation should no longer sign in
    And the new invitation should sign in and ask the agent to set a password
  #BUG LOGGED

  @negative @known-issue @mutates-email @provision
  Scenario: Verify that resending to a new address makes only the one request it needs
    Given I have invited a throwaway agent who has not claimed the invite
    When I open the Update Email Address modal for that record
    And I enter a fresh address on the test inbox as the new email and confirmation
    And I press Next on the Update Email Address modal
    And I confirm Resend Invite
    Then the change should be accepted with the toast "Verification email sent to the updated email."
    And no other invitation request should have been made after the change
