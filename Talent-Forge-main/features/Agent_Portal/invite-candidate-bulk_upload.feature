# RUN BY : npm run test:bulk-upload 
@agent-portal @bulk-upload
Feature: Agent Portal - Bulk Candidate Invitation
  # ==========================================================================
  # 1. BULK UPLOAD UI
  # ==========================================================================

  @positive @bulk-upload @TFF-87 @TFF-88 @TFF-314
  Scenario: Verify that the upload zone shows its instructions, template link and correct format hint
    Given the "Send Onboarding Invite" modal is open
    Then the bulk upload zone should display upload instructions
    And the text "Upload multiple candidates at once using our template" should be displayed
    And the upload hint should read "CSV, XLS, XLSX (max. 10MB)"
    And a "Download Template" link should be displayed
    When I click the "Download Template" link
    Then a candidate upload template file should be downloaded

  @positive @bulk-upload @TFF-36 @TFF-314 @needs-clarification
  Scenario: Verify that supported files upload by click or drag-and-drop and can be replaced or removed
    Given the "Send Onboarding Invite" modal is open
    When I upload a valid candidate file by clicking the upload zone
    Then the file should be accepted
    And the uploaded file name should be displayed
    And the "Send Invites" button should be enabled
    When I remove the uploaded file
    Then no uploaded file name should be displayed
    And the "Send Invites" button should be disabled
    When I drag and drop a valid candidate file onto the upload zone
    Then the file should be accepted
    And the uploaded file name should be displayed
    And each of these supported formats should be accepted without an upload error:
      | extension |
      | .csv      |
      | .xlsx     |
      | .xls      |
  # 2. BULK FILE VALIDATION
  #BUG LOGGED

  @negative @bulk-upload @TFF-36
  Scenario: Verify that unsupported and unusable files are rejected below the upload area
    Given the "Send Onboarding Invite" modal is open
    When I attempt to upload a candidate file with each of these extensions:
      | extension |
      | .pdf      |
      | .txt      |
      | .docx     |
      | .png      |
      | .json     |
      | .zip      |
      | .exe      |
    Then each should be rejected with "This file type is not allowed. Use one of the accepted formats listed below."
    And the error should appear immediately below the upload area
    And the "Send Invites" button should be disabled
    # Measured 2026-10-15: a .csv whose CONTENT is unusable passes the zone (extension check only)
    # and is refused with a clear error when Send Invites is pressed.
    Then each of these unusable files should be refused with an error before anything is sent:
      | file                                 |
      | binary content under a .csv name     |
      | a CSV with no candidate rows         |
      | a CSV where every email is malformed |

  @edge @bulk-upload @TFF-36
  Scenario: Verify that the 10MB size limit is enforced exactly at its boundary
    Given the "Send Onboarding Invite" modal is open
    When I upload a valid candidate file of size exactly "10MB"
    Then the file should be accepted
    And no upload error should be displayed
    When I upload a candidate file of size "10.1MB"
    Then the upload error "This file is too large. Maximum size is 10.0 MB." should be displayed
    When I upload a candidate file of size "11MB"
    Then the upload error "This file is too large. Maximum size is 10.0 MB." should be displayed
    And the error should appear immediately below the upload area
    And the "Send Invites" button should be disabled

  # ------------------------------------------------------------------------------------------
  # Added 2026-09-16, all four measured live through the real modal before being written.
  # Every one is READ-ONLY: no scenario below sends, so none creates a candidate.
  # ------------------------------------------------------------------------------------------

  # The zone swaps the drop target for the file card and takes the upload button AND the file
  # input with it, so while a file is held there is no control that can choose a second one. The
  # accept/replace scenario above is titled "replaced or removed" but only ever removes FIRST,
  # so the in-place replacement it claims has never been exercised - this is that gap.
  @negative @bulk-upload @TFF-36 @needs-clarification
  Scenario: Verify that the upload zone is withdrawn while a file is held, so a second file needs the first removed
    Given the "Send Onboarding Invite" modal is open
    When I upload a valid candidate file by clicking the upload zone
    Then the file should be accepted
    And the upload zone should offer no way to choose another file
    When I remove the uploaded file
    Then the upload zone should offer a way to choose another file again
    And the upload zone should accept a different file in place of the first

  # The header rule printed in the zone ("Do not change the column headers.") is enforced when the
  # file is SENT (measured 2026-10-15): a renamed header or a missing header row is refused with
  # "Invalid file format. Please upload a valid CSV file."; extra columns beside an intact `emails`
  # header are not a header change and are sent. The "sent" row invites real, permanent candidates.
  @negative @bulk-upload @creates-candidates @TFF-36 @TFF-314
  Scenario: Verify that a file ignoring the stated upload instructions is not accepted in silence
    Given the "Send Onboarding Invite" modal is open
    Then the upload instructions should require the template's own column header
    When I upload and send a candidate file with each of these structures:
      | structure                     | outcome |
      | a renamed email column header | refused |
      | no header row at all          | refused |
      | extra columns beside emails   | sent    |
    Then each structure should have the outcome the table expects, and never in silence

  # The exclusion rule in the direction nothing covered. The scenario above enters the chip
  # FIRST; here the file lands first and the chip is typed on top of it - and the email input
  # stays enabled throughout, so that state is genuinely reachable from both directions. The
  # second half is the recovery, which nothing asserted at all: clearing the chips must release
  # the gate and leave the file intact, or the agent's only way out is to start again.
  @negative @bulk-upload @TFF-36
  Scenario: Verify that the exclusion rule holds when the file is uploaded before the addresses are typed
    Given the "Send Onboarding Invite" modal is open
    And I have uploaded a valid candidate file
    When I enter the email "overlap.reverse@university.edu" as a chip
    Then the invite modal should refuse to combine typed addresses with an uploaded file
    When I remove all remaining email chips
    Then the uploaded file should still be held
    And the "Send Invites" button should be enabled

  # The chip half of this rule is asserted in Invite-candidate.feature ("closes every documented
  # way, and discards unsent input"); the uploaded file was never covered. A file that survived a
  # dismissal would be sent by whoever opened the modal next, believing it empty.
  @negative @bulk-upload @TFF-36
  Scenario: Verify that dismissing the invite modal discards the uploaded file
    Given the "Send Onboarding Invite" modal is open
    And I have uploaded a valid candidate file
    When I close the invite modal by "Cancel button"
    And I reopen the "Send Onboarding Invite" modal
    Then no uploaded file name should be displayed
    And the "Send Invites" button should be disabled
    And the upload zone should offer a way to choose another file again
    Given I have uploaded a valid candidate file
    When I close the invite modal by "X icon"
    And I reopen the "Send Onboarding Invite" modal
    Then no uploaded file name should be displayed
    And the "Send Invites" button should be disabled

  # The chip path has three failure scenarios (service, network, session) and the bulk path had
  # none - yet it posts to a DIFFERENT endpoint (.../bulk/file/, multipart). The request is
  # intercepted, so nothing is really sent and no candidate is created.
  @negative @bulk-upload @TFF-36
  Scenario: Verify that a failing invitation service is surfaced on the bulk upload path and sends nothing
    Given the "Send Onboarding Invite" modal is open
    And the invitation service will fail
    And I have uploaded a valid candidate file
    When I click "Send Invites"
    Then an invite error message should be displayed
    And the Invitation Success modal should not be displayed

  @edge @bulk-upload @creates-candidates @TFF-36
  Scenario: Verify that duplicate rows inside an uploaded file collapse to a single invitation
    Given the "Send Onboarding Invite" modal is open
    When I upload a candidate file containing "bulk.dupe@university.edu" 3 times
    And I click "Send Invites"
    Then exactly 1 invitation should be sent to "bulk.dupe@university.edu"

  @negative @bulk-upload @needs-clarification @TFF-36
  Scenario: Verify that typed addresses and an uploaded file cannot be combined in one send
    Given the "Send Onboarding Invite" modal is open
    And I have entered the email "overlap@university.edu" as a chip
    When I upload a candidate file containing "bulk.dupe@university.edu" 3 times and "overlap@university.edu" once
    Then the invite modal should refuse to combine typed addresses with an uploaded file
 

  # Expected behaviour (confirmed 2026-10-15): the valid rows are sent, the success message is shown,
  # and the malformed rows are reported as skipped - e.g. "2 rows skipped: row 2, row 4".
  @edge @bulk-upload @creates-candidates @TFF-36
  Scenario: Verify that a file mixing valid and invalid rows reports the bad rows and sends the good ones
    Given the "Send Onboarding Invite" modal is open
    When I upload a candidate file with 3 valid and 2 malformed emails
    Then the "Send Invites" button should be enabled
    When I click "Send Invites"
    Then the malformed rows should be reported as skipped
    And the success message "Emails sent successfully" should be displayed
    And exactly 3 invitations should be sent
  # @edge @bulk-upload @not-automatable @TFF-36 @needs-clarification
  # Scenario: A large file within the size limit is processed without a client timeout
  #   Given the "Send Onboarding Invite" modal is open
  #   When I upload a valid candidate file containing 1000 emails
  #   And I click "Send Invites"
  #   Then the invitations should be processed without a client timeout
  #   And the outcome for every row should be reported to me
  # ==========================================================================
  # 3. BULK SEND
  # ==========================================================================

  @positive @send-invite @bulk-upload @creates-candidates @TFF-36
  # Measured 2026-10-15: a send from In Progress (where these scenarios invite from) is confirmed
  # by the toast "Emails sent successfully"; the Invitation Success modal is the dashboard route's.
  Scenario: Verify that sending invites from a bulk upload confirms with a success message
    Given I am on the Agent Dashboard
    And the "Send Onboarding Invite" modal is open
    And I have uploaded a valid candidate file
    When I click "Send Invites"
    Then the success message "Emails sent successfully" should be displayed
  # Creates 3 permanent candidates and reads 3 invitations out of the live IMAP inbox.

  @e2e @positive @bulk-upload @creates-candidates @TFF-36 @TFF-410
  Scenario: Verify that a bulk upload onboards several candidates end to end
    Given I am logged in as an agent
    And I note the current total candidate count
    When I invite candidates by uploading a valid file containing 3 new emails
    Then the success message "Emails sent successfully" should be displayed
    And an invitation email should arrive for each of the 3 candidates
    And my total candidate count should have increased by 3
    And all 3 candidates should be listed in the "Invite Sent" tab
