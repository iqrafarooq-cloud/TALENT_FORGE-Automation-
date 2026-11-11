#test:doc-verify:fast --- run the whole module. 
# AI DOCUMENT VERIFICATION - THE WHOLE MODULE IN ONE FILE
#
#     npm run test:doc-verify:ui        the routine run (excludes the costly tags)
#     npm run test:doc-lifecycle        the status lifecycle, both portals
#     npm run test:doc-verify:decisions COMMITS REAL AGENT DECISIONS
#     npm run test:doc-verify:upload    PERMANENT profile entries
#     npm run test:doc-verify:walkthrough  one document, visibly, end to end#
@doc-verification
Feature: AI Document Verification

  Background:
    Given the candidate has a valid account
    And the candidate has provided their legal first and last name
    And the AI verification service is available
  # SECTION 1 OF 8: THE SIX VERIFICATION CRITERIA
  # AI DOCUMENT VERIFICATION - CORE CRITERIA

  @positive @identity @core-criteria
  Scenario: Verify that a document is approved when the legal name matches the candidate
    Given the candidate has uploaded a transcript naming the applicant
    When the AI verifies the document
    Then the identity verification should pass
    And the document should not be flagged for a name mismatch

  @negative @identity @core-criteria
  Scenario Outline: Verify that a document is flagged when an applicant name component does not match
    Given the candidate has uploaded a transcript whose <name_component> differs from the applicant
    When the AI verifies the document
    Then the document should not be automatically approved
    And a name mismatch should be reported

    Examples:
      | name_component  |
      | first name      |
      | last name       |
      | full legal name |

  @edge-case @identity @core-criteria
  Scenario Outline: Verify that harmless name formatting differences do not cause a mismatch
    Given the candidate has uploaded a transcript naming the applicant with <variation>
    When the AI verifies the document
    Then the identity verification should pass
    And the document should not be flagged for a name mismatch

    Examples:
      | variation                |
      | different capitalisation |
      | extra spaces             |
      | a missing space          |

  @edge-case @identity @core-criteria
  Scenario Outline: Verify that name variations requiring a product rule receive a consistent verdict
    Given the candidate has uploaded a transcript naming the applicant with <variation>
    When the AI verifies the document
    Then the identity verification should reach a definite verdict
    And the reason should explain how the name was compared

    Examples:
      | variation           |
      | reversed name order |
      | missing middle name |
  # ==========================================================================
  # CROSS-DOCUMENT NAME VALIDATION
  # ==========================================================================

  @positive @cross-validation @core-criteria
  Scenario: Verify that cross-document validation passes when names are consistent
    Given the candidate has already submitted a document in their legal name
    And the candidate has uploaded a transcript naming the applicant
    When the AI verifies the document
    Then the cross-document name verification should pass
    And no name mismatch should be reported

  @negative @cross-validation @core-criteria
  Scenario: Verify that a document is flagged when its name conflicts with another submitted document
    Given the candidate has already submitted a document in their legal name
    And the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the cross-document name verification should fail
    And the reason should identify the conflicting document

  @edge-case @cross-validation @core-criteria
  Scenario: Verify that cross-document validation records all name sources used for the verdict
    Given the candidate has already submitted a document in their legal name
    And the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the verification result should belong to the document uploaded in this run
    And the declared legal name should be recorded
    And the name extracted from the current document should be recorded
    And the names from the candidate's other documents should be recorded
    And the cross-document consistency verdict should follow from those names
  # ==========================================================================
  # ISSUING INSTITUTION
  # ==========================================================================

  @positive @institution @core-criteria
  Scenario: Verify that a document from a recognised issuing institution is approved
    Given the candidate has uploaded a transcript
    And the issuing institution is recognised
    When the AI verifies the document
    Then the issuing institution validation should pass

  @negative @institution @core-criteria
  Scenario Outline: Verify that a document is flagged when the issuing institution is invalid
    Given the candidate has uploaded a transcript with <issuer_condition>
    When the AI verifies the document
    Then the document should not be automatically approved
    And the issuing institution validation should fail

    Examples:
      | issuer_condition            |
      | an unrecognised institution |
      | no issuing institution      |
  # ==========================================================================
  # DATE VALIDATION
  # ==========================================================================

  @positive @date-validation @core-criteria
  Scenario: Verify that a document containing logically valid dates is approved
    Given the candidate has uploaded a transcript
    And all document dates are logically valid
    When the AI verifies the document
    Then the date validation should pass

  @positive @edge-case @date-validation @core-criteria
  Scenario Outline: Verify that valid current documents may contain a non-past expiry date
    Given the candidate has uploaded a certificate
    And the document is currently active with an expiry date that is <expiry_condition>
    When the AI verifies the document
    Then the date validation should pass
    And the document should not be flagged because of the expiry date

    Examples:
      | expiry_condition |
      | in the future    |
      | today            |

  @negative @date-validation @core-criteria
  Scenario Outline: Verify that a document containing an invalid date relationship is flagged
    Given the candidate has uploaded a document with <date_problem>
    When the AI verifies the document
    Then the document should not be automatically approved
    And the date validation should fail

    Examples:
      | date_problem                         |
      | a graduation date in the future      |
      | an expiry date before the issue date |

  @negative @date-validation @known-issue @core-criteria
  Scenario: Verify that a document with a future issue date is flagged
    Given the candidate has uploaded a certificate with an issue date in the future
    When the AI verifies the document
    Then the document should not be automatically approved
    And the date validation should fail

  @negative @date-validation @known-issue @core-criteria
  Scenario: Verify that a document containing a malformed date is flagged
    Given the candidate has uploaded a transcript with a malformed date
    When the AI verifies the document
    Then the document should not be automatically approved
    And the date validation should fail
  # ==========================================================================
  # TRANSCRIPT CONTENT
  # ==========================================================================

  @positive @transcript @core-criteria
  Scenario: Verify that a transcript containing all required academic information is approved
    Given the candidate has uploaded a transcript
    And the transcript contains the degree awarded
    And the transcript contains the major or field of study
    And the transcript contains a valid graduation or conferral date
    When the AI verifies the document
    Then the transcript content verification should pass

  @negative @transcript @core-criteria
  Scenario Outline: Verify that a transcript is flagged when a required academic field is missing
    Given the candidate has uploaded a transcript with <missing_field>
    When the AI verifies the document
    Then the document should not be automatically approved
    And the transcript content verification should fail

    Examples:
      | missing_field                   |
      | no degree awarded               |
      | no major or field of study      |
      | no graduation or conferral date |

  @negative @transcript @core-criteria
  Scenario: Verify that every missing transcript field is reported when multiple fields are absent
    Given the candidate has uploaded a transcript missing several required fields
    When the AI verifies the document
    Then the document should not be automatically approved
    And the transcript content verification should fail
    And every missing required field should be reported

  @positive @transcript @core-criteria
  Scenario: Verify that transcript content rules are not applied to a work experience letter
    Given the candidate has uploaded a work experience letter
    When the AI verifies the document
    Then the transcript content criterion should not have been applied
  # AUTHENTICITY AND TAMPER-PROOFING

  @positive @authenticity @not-automatable @core-criteria
  Scenario: Verify that an authentic e-transcript with a valid digital certificate is approved
    Given the candidate has uploaded an e-transcript with a valid digital certificate
    When the AI verifies the document
    Then the authenticity verification should pass

  @negative @authenticity @core-criteria
  Scenario Outline: Verify that an e-transcript is flagged when its digital certificate is invalid
    Given the candidate has uploaded an e-transcript with <certificate_condition>
    When the AI verifies the document
    Then the document should not be automatically approved
    And the authenticity verification should not pass

    Examples:
      | certificate_condition  |
      | an invalid certificate |
      | no digital certificate |

  @negative @authenticity @core-criteria
  Scenario: Verify that a document showing visible tampering is flagged
    Given the candidate has uploaded a transcript showing visible tampering
    When the AI verifies the document
    Then the document should not be automatically approved
    And the authenticity verification should not pass
  # ==========================================================================
  # DOCUMENT READABILITY
  # ==========================================================================

  @edge-case @document @core-criteria
  Scenario: Verify that an unreadable document is not judged confidently
    Given the candidate has uploaded a document too degraded to read
    When the AI verifies the document
    Then the document should not be automatically approved
    And no criterion should be judged confidently on the unreadable document

  @edge-case @document @core-criteria
  Scenario: Verify that a blurry document is read when its content remains legible
    Given the candidate has uploaded a blurry but legible document
    When the AI verifies the document
    Then the AI should have extracted the applicant name from the document
  # SECTION 2 OF 8: UPLOAD AND FILE VALIDATION
  # AI DOCUMENT VERIFICATION - UPLOAD AND FILE VALIDATION

  @positive @upload-ui @creates-profile-entry @upload-validation
  Scenario Outline: Verify that a candidate can upload supported documents through the profile sections
    When the candidate adds a <profile_entry> with a <document_type> through the profile
    Then the upload should have been accepted
    And the document should appear in the candidate's Documents tab

    Examples:
      | profile_entry   | document_type     |
      | education       | transcript        |
      | work experience | experience letter |
      | certification   | certificate       |

  @negative @upload-ui @accessibility @upload-validation
  Scenario: Verify that the document upload controls are accessible to keyboard and assistive technology
    When the candidate opens the profile details tab
    Then every document upload control should be reachable by keyboard
    And every document upload control should have an accessible name
  # ==========================================================================
  # FILE CONTENT
  # ==========================================================================

  @negative @document @upload-validation
  Scenario: Verify that a blank document is not approved
    Given the candidate has uploaded a blank document
    When the AI verifies the document
    Then the document should not be automatically approved
    And the AI should report that it found nothing to verify
  # ==========================================================================
  # FILE FORMAT AND SIZE
  # ==========================================================================

  @positive @file-validation @upload-validation
  Scenario: Verify that all supported document formats are accepted
    Given the candidate has uploaded a document in each allowed format
    Then every allowed format should have been accepted

  @negative @file-validation @upload-validation
  Scenario: Verify that a disallowed document format is refused with an explanation
    Given the candidate has uploaded a document in a disallowed format
    Then the upload should have been refused
    And the refusal should identify the accepted formats

  @negative @file-validation @upload-validation
  Scenario: Verify that JPEG follows the documented upload format policy
    Given the candidate has uploaded a JPEG document
    Then the upload should have been refused
    And the refusal should identify the accepted formats

  @negative @file-validation @known-issue @upload-validation
  Scenario: Verify that a document exceeding the upload size limit is refused
    Given the candidate has uploaded a document over the size limit
    Then the upload should have been refused
  # AI PROCESSING

  @edge-case @file-validation @upload-validation
  Scenario: Verify that an AI processing failure is returned as an error rather than a verdict
    Given the candidate has uploaded a document the AI cannot process
    When the AI attempts to verify the document
    Then an AI processing error should be reported
    And the result should be reported as an error rather than as a verification verdict

  @edge-case @file-validation @upload-validation
  Scenario: Verify that an uploaded document is served through a time-limited link
    Given the candidate has uploaded a certificate
    When the AI verifies the document
    Then the document should be served by a time-limited presigned link
  # SECTION 3 OF 8: AUTOMATIC APPROVAL
  # AI DOCUMENT VERIFICATION - AUTO APPROVAL

  @positive @auto-approval
  Scenario: Verify that a valid transcript is automatically approved without agent action
    Given the candidate has uploaded a transcript
    And the candidate's legal name matches the name on the document
    And the issuing institution is recognised
    And the transcript contains the degree awarded
    And the transcript contains the major or field of study
    And the transcript contains a valid graduation or conferral date
    When the AI verifies the document
    Then the verification result should belong to the document uploaded in this run
    And the document status should be "Approved"
    And no agent action should be required
  # WORK EXPERIENCE

  @positive @auto-approval
  Scenario: Verify that a valid work experience letter is automatically approved
    Given the candidate has uploaded a work experience letter
    And the candidate's legal name matches the name on the document
    And the issuing organisation is recognised
    And all document dates are logically valid
    When the AI verifies the document
    Then the document status should be "Approved"
    And no agent action should be required
  # CERTIFICATE

  @positive @auto-approval
  Scenario: Verify that a valid certificate is automatically approved
    Given the candidate has uploaded a certificate
    And the candidate's legal name matches the name on the document
    And the issuing organisation is recognised
    And all document dates are logically valid
    When the AI verifies the document
    Then the document status should be "Approved"
    And no agent action should be required
  # MULTIPLE DOCUMENTS

  @edge-case @multiple-documents @auto-approval
  Scenario: Verify that each uploaded document receives an independent verification result
    Given the candidate has uploaded a valid transcript
    And the candidate has uploaded a work experience letter naming a different person
    And the candidate has uploaded a valid certificate
    When the AI verifies all uploaded documents
    Then each document should carry its own verification result
    And only the document naming a different person should be flagged for a name mismatch

  @positive @e2e @multiple-documents @auto-approval
  Scenario: Verify that multiple valid documents are approved without agent action
    Given the candidate has uploaded a valid transcript
    And the candidate has uploaded a valid work experience letter
    And the candidate has uploaded a valid certificate
    When the AI verifies all uploaded documents
    Then every document should have the status "Approved"
    And no agent action should be required for any document
  # SECTION 4 OF 8: AGENT REVIEW AND THE VERIFICATION QUEUE
  # AI DOCUMENT VERIFICATION - AGENT REVIEW AND QUEUE

  @positive @agent-review
  Scenario: Verify that the agent sees the document and all AI findings in the review screen
    Given a document has been flagged by the AI
    When the agent opens that document in the review screen
    Then the original document should be displayed
    And the AI verification summary should be displayed
    And every failed criterion should be listed with its reason
    And the summary should show that it was flagged by the automated system

  @positive @agent-review
  Scenario: Verify that the agent decision controls become available only after a meaningful reason is entered
    Given a document has been flagged by the AI
    When the agent opens that document in the review screen
    And the agent opens the revision decision
    Then the decision cannot be submitted with no reason
    And the decision cannot be submitted with only spaces
    When the agent enters a meaningful reason
    Then the decision should become enabled

  @negative @agent-review
  Scenario: Verify that an approval cannot be submitted without a meaningful reason
    Given a document has been flagged by the AI
    When the agent opens that document in the review screen
    And the agent opens the approval decision
    Then the decision cannot be submitted with no reason
    And the decision cannot be submitted with only spaces

  @negative @agent-review
  Scenario: Verify that the agent cannot make another decision after a document is already decided
    Given a document that has already been decided
    When the agent opens that document in the review screen
    Then no decision controls should be offered
  # VERIFICATION QUEUE

  @positive @queue @agent-review
  Scenario: Verify that the agent can search the verification queue by document name
    Given the candidate has uploaded a transcript
    When the agent opens the verification queue
    And the agent searches the queue for that document
    Then only documents matching the search should be listed

  @positive @queue @agent-review
  Scenario: Verify that the agent can filter the verification queue by status
    When the agent opens the verification queue
    And the agent filters the queue by "Needs Review"
    Then every listed row should carry that status

  @negative @queue @agent-review
  Scenario: Verify that the verification queue shows an empty state when there are no matches
    When the agent opens the verification queue
    And the agent searches for a document name that cannot exist
    Then the queue should list no documents
    And the queue should show an empty state

  @positive @queue @multiple-documents @agent-review
  Scenario: Verify that the verification queue keeps each document's status independent
    Given the candidate has uploaded a valid transcript
    And the candidate has uploaded a work experience letter naming a different person
    And the candidate has uploaded a valid certificate
    When the AI verifies all uploaded documents
    And the agent opens the verification queue
    Then each uploaded document should appear with its own status
    And the queue should offer filters for the statuses it displays
  # SECTION 5 OF 8: WHAT THE CANDIDATE IS TOLD
  # AI DOCUMENT VERIFICATION - CANDIDATE RESULTS

  @positive @candidate
  Scenario: Verify that the candidate sees Need Review before an agent decision
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the candidate should see the document as Need Review
    And the candidate should not yet be shown an agent decision remark
  # REVISION RESULT

  @positive @known-issue @candidate
  Scenario: Verify that the candidate sees the final revision result and reviewer information
    Given the candidate has a document that was marked for revision
    When the candidate opens that document
    Then the candidate should see that the document requires revision
    And the candidate should see the reason it was flagged
    And the candidate should see who made the decision
    And the candidate should see the AI findings that led to the decision
  # STATUS CONSISTENCY

  @negative @known-issue @wording @candidate
  Scenario: Verify that the candidate and agent portals use consistent status wording
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the status wording should agree across the candidate and agent portals
  # SECTION 6 OF 8: RESUBMISSION AND THE CORRECTION LOOP

  @positive @resubmission
  Scenario: Verify that a corrected resubmission starts a new verification cycle and clears the old finding
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    And the candidate resubmits a corrected document with the matching legal name
    Then the corrected document should be accepted
    And a new AI verification cycle should start
    And the superseded name mismatch should no longer be reported
    And the new verification result should be shown
  # UNCHANGED INVALID DOCUMENT

  @negative @resubmission
  Scenario: Verify that resubmitting the same invalid document fails the same criterion again
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    And the candidate resubmits the same document unchanged
    Then the document should not be automatically approved
    And the same criterion should fail again
  # RESULT IS NOT REUSED

  @edge-case @resubmission
  Scenario: Verify that a corrected resubmission does not reuse the previous verification result
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    And the candidate resubmits a corrected document with the matching legal name
    Then a new AI verification cycle should start
    And the previous verification result should not be reused
    And the version shown to the agent should have increased
  # SECTION 7 OF 8: THE STATUS LIFECYCLE, END TO END ON BOTH PORTALS
  # ORDERING INSIDE EACH SCENARIO IS LOAD-BEARING

  @positive @lifecycle @needs-review @status-lifecycle
  Scenario: Verify that a newly uploaded document reaches Need Review on both portals
    Given the candidate uploads a document that the AI cannot decide on its own
    When the AI verifies the document
    Then the document status should be "Needs Review"
    And the document should be listed on the candidate Documents tab with status "Needs Review"
    And the document should be listed under the correct section of the candidate Documents tab
    And the agent verification queue should show that document with status "Needs Review"
    And the document should be listed under the agent "Needs Review" filter tab
    And no decision comment should be shown to the candidate yet

  @negative @lifecycle @needs-review @status-lifecycle
  Scenario: Verify that a name mismatch is left for an agent rather than auto-rejected
    Given the candidate uploads the name-mismatch lifecycle document
    When the AI verifies the document
    Then a name mismatch should be reported
    And the document status should be "Needs Review"
    And the status should have been chosen by the AI rather than by an agent
  # 2. AGENT REQUESTS A REVISION - THE AGENT'S COMMENT REACHES THE CANDIDATE

  @positive @lifecycle @agent-decision @mutates-document @status-lifecycle
  Scenario: Verify that an agent's revision request shows the candidate the agent's comment
    Given the candidate uploads a document that the AI cannot decide on its own
    And the AI has verified the document
    And the document status should be "Needs Review"
    When the agent requests a revision on that document with a unique reason
    Then the document status should be "Revision Required"
    And the agent verification queue should show that document with status "Revision Required"
    And the document should be listed on the candidate Documents tab with status "Revision Required"
    When the candidate opens the verification panel for that document
    Then the candidate should be shown the agent's reason attributed to the agent
    And the candidate should not be shown the AI findings as the reason for the revision
    And the candidate panel status should read "Revision Required"
  # 3. AGENT APPROVES - STATUS UPDATES AND THE AGENT'S COMMENT REACHES THE CANDIDATE

  @positive @lifecycle @agent-decision @mutates-document @status-lifecycle
  Scenario: Verify that an agent's approval shows the candidate the approval
    Given the candidate uploads a document that the AI cannot decide on its own
    And the AI has verified the document
    And the document status should be "Needs Review"
    When the agent approves that document with a unique reason
    Then the document status should be "Approved"
    And the agent verification queue should show that document with status "Approved"
    And the document should be listed on the candidate Documents tab with status "Approved"
    When the candidate opens the verification panel for that document
    Then the candidate panel status should read "Approved"
    And the candidate should be shown the agent's reason attributed to the agent
  # 4. THE AI DECIDES ON ITS OWN - AND ITS OWN COMMENT IS WHAT THE CANDIDATE SEES

  @negative @lifecycle @ai-decision @status-lifecycle
  Scenario: Verify that a document the AI rejects itself carries the AI's own explanation
    Given the candidate uploads the auto-rejected lifecycle document
    When the AI verifies the document
    Then the document status should be "Revision Required"
    And the status should have been chosen by the AI rather than by an agent
    And the candidate should be shown a revision reason attributed to the automated system
    And that reason should repeat the criteria the AI failed
    And the document should be listed on the candidate Documents tab with status "Revision Required"

  @positive @lifecycle @ai-decision @known-issue @status-lifecycle
  Scenario: Verify that a clean document is auto-approved by the AI with no agent action and no comment
    Given the candidate uploads the auto-approved lifecycle document
    When the AI verifies the document
    Then the document status should be "Approved"
    And every AI criterion should have passed
    And the status should have been chosen by the AI rather than by an agent
    And no decision comment should be shown to the candidate yet
    And the document should be listed on the candidate Documents tab with status "Approved"
  # 5. THE THREE END STATES SIDE BY SIDE

  @positive @lifecycle @multiple-documents @status-lifecycle
  Scenario: Verify that the three lifecycle documents hold independent statuses on both portals
    Given the candidate uploads all three lifecycle documents
    When the AI verifies all uploaded documents
    Then each document should carry its own status on the candidate Documents tab
    And each document should carry the same status in the agent verification queue
    And the status wording should agree across the candidate and agent portals for each document
  # 6. THE SURFACES THEMSELVES - ASSERTED WITHOUT ANY WORKAROUND

  @negative @lifecycle @surface @known-issue @status-lifecycle
  Scenario: Verify that the candidate can reach the verification reason for every document, not just four
    Given the candidate has more documents than the dashboard block displays
    When the candidate opens the dashboard documents block
    Then the block should offer a way to reach every document
    And the verification reason should be reachable for the most recently uploaded document

  @negative @lifecycle @surface @known-issue @needs-clarification @status-lifecycle
  Scenario: Verify that selecting a document on the candidate Documents tab opens its details
    Given the candidate uploads a document that the AI cannot decide on its own
    And the AI has verified the document
    When the candidate selects that document on the Documents tab
    Then the document's verification details should be shown

  @negative @lifecycle @surface @creates-profile-entry @mutates-document @status-lifecycle
  Scenario: Verify that an approved document remains visible to the candidate
    Given the candidate uploads the auto-approved lifecycle document through the profile form
    And the AI has verified the document
    When the agent approves that document with a unique reason
    Then the document status should be "Approved"
    And the document should still be returned by the candidate's own documents endpoint
    And the document should be listed on the candidate Documents tab with status "Approved"
  # AI DOCUMENT VERIFICATION - END TO END
  #     SLOWMO=400 npm run test:doc-verify:walkthrough

  @negative @identity @e2e
  Scenario: Verify that a name mismatch is flagged, reviewed and cleared after correction
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the document should not be automatically approved
    And a name mismatch should be reported
    When the agent opens that document in the review screen
    Then the failed identity criterion should be listed with its reason
    And the summary should show that it was flagged by the automated system
    When the candidate resubmits a corrected document with the matching legal name
    Then a new AI verification cycle should start
    And the superseded name mismatch should no longer be reported
  # INSTITUTION -> AGENT REVIEW

  @negative @institution @e2e
  Scenario: Verify that an unrecognised institution is flagged and explained to the agent
    Given the candidate has uploaded a transcript from an unrecognised institution
    When the AI verifies the document
    Then the document should not be automatically approved
    And the issuing institution validation should fail
    When the agent opens that document in the review screen
    Then the failed institution criterion should be listed with its reason
  # AGENT REVISION -> CANDIDATE
  # @known-issue: measured twice on 2026-08-25, once per decision type on two

  @positive @agent-review @mutates-document @known-issue @e2e
  Scenario: Verify that an agent's revision request reaches the candidate as a revision decision
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    And the agent requests a revision on that document with a reason
    Then the document status should be "Revision Required"
    When the candidate opens that document
    Then the candidate should see that the document requires revision
    And the candidate should see the reason the agent gave
    And the candidate should see that an agent made the decision
  # AGENT APPROVAL -> CANDIDATE

  @positive @agent-review @mutates-document @known-issue @e2e
  Scenario: Verify that an agent's approval of a flagged document reaches the candidate as the final outcome
    Given the candidate has uploaded a transcript naming a different person
    When the AI verifies the document
    Then the document should not be automatically approved
    When the agent opens that document in the review screen
    Then the failed criteria should be listed with their reasons
    When the agent approves that document with a reason
    Then the document status should be "Approved"
    When the candidate opens that document
    Then the candidate should see that the document was approved
    And the earlier flagged result should no longer be active
    And the candidate should see the reason the agent gave
    And the candidate should see that an agent made the decision
    And the candidate should see the AI findings that led to the decision
    And the candidate should be notified of the decision
    And the notification should be visible in the candidate notification centre
  # COMPLETE CANDIDATE -> AI -> AGENT FLOW

  @positive @walkthrough @creates-profile-entry @e2e
  Scenario: Verify that a candidate upload flows through AI verification to agent review
    When the candidate uploads a transcript naming a different person through the profile form
    Then the document should appear in the candidate's Documents tab
    When the AI verifies the document
    Then the verification result should belong to the document uploaded in this run
    And the document should not be automatically approved
    And a name mismatch should be reported
    When the agent opens that document in the review screen
    Then the original document should be displayed
    And the AI verification summary should be displayed
    And the failed criteria should be listed with their reasons
    And the summary should show that it was flagged by the automated system
