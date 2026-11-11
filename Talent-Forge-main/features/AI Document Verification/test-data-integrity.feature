# ============================================================================
# AI DOCUMENT VERIFICATION - TEST DATA INTEGRITY
#
# These validate the AUTOMATION'S FIXTURES, not the application. They are kept
# out of the seven functional files for exactly that reason: a red row here means
# the suite is about to test the wrong thing, which is a different message from
# "the product is wrong" and belongs in its own place in the report.
#
# They cost nothing - no upload, no AI call, no browser.
# ============================================================================

# EVERY SCENARIO NAME HERE STARTS WITH "Verify that ..." - the convention applied to
# this module on 2026-09-01, matching features/Promo_Code/. See the long note at the head
# of ai-document-verification.feature for the form and why a regex will not do the job.
@doc-verification @test-data
Feature: AI Document Verification Test Data Integrity

  # Sections 1-13 of the requirement, which hold the expected-results table,
  # never reached the automation author, so every `expected` block in
  # documents.json is null. The comparison engine reports those as PENDING and
  # counts them in their own column. THIS IS SUPPOSED TO FAIL until the table
  # lands: a suite that silently verifies nothing is the exact failure mode the
  # whole design guards against, and "pending" is never a pass. Filling the
  # blocks in requires no code change.
  @negative @known-issue @integrity
  Scenario: Verify that every test document has a recorded expected result
    Then no document in the test data should be missing its expected result

  # Three separate guards against three different ways the fixture set rots: a
  # file named but absent, a file present but unregistered (so it is never
  # exercised and nobody notices), and a TIME-SENSITIVE fixture that was correct
  # on the day it was built and is wrong on every other day. The last one is not
  # hypothetical - the certificate expiring "today" is a different test tomorrow,
  # and the failure names the exact command that rebuilds it.
  @positive @integrity
  Scenario: Verify that the test data files exist and time-sensitive fixtures are current
    Then every document file named in the test data should exist
    And no document file on disk should be missing a test data entry
    And no time-sensitive fixture should be out of date
