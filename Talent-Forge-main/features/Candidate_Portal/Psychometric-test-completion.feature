# Psychometric Test Completion and Analysis - Candidate Portal
#
# SCENARIOS ONLY. No step definitions exist yet, so the feature carries @not-implemented:
# playwright-bdd fails generation for the WHOLE suite on a single undefined step, and that tag
# keeps this file out of every profile until the steps are written. Remove it when they are.
#
# Scope: what the candidate sees from the moment the test is finished - the "Psychometric Test
# Completed" pop-up, the right-side card swapping from Profile to "Your Test Results" (Analyzing...),
# the non-dismissible "Test Results Ready" modal, and the hand-off to the detailed results screen.
# The detailed screen's full content and the report itself belong to Story 3 (Test Results and
# Report); only what this story states about them is asserted here.
#
# Fixtures (to settle when implementing):
#   - The psychometric test is a TIMED ADAPTIVE AI INTERVIEW plus MCQs and cannot be completed
#     honestly by automation. Every post-test state here is therefore driven by stubbing the
#     responses the Getting Started page reads (test status, analysis status, results) - @mocked.
#     The one real journey through the test is @not-automatable.
#   - "Analysis completes" is simulated by flipping the stubbed analysis status from in-progress to
#     complete WHILE THE PAGE IS OPEN, which is what proves the modal opens with no refresh. Find out
#     how the page learns about it (polling, websocket, push notification) before implementing;
#     the stub has to use the same channel.
#   - Persistence across logout / tab close / power off is a SERVER-side flag ("results viewed").
#     The stub must answer "results ready, not yet viewed" on a fresh context; a scenario that only
#     reloads one tab cannot tell a server flag from sessionStorage (see the welcome-modal lesson
#     in CLAUDE.md).
#   - A candidate's progress only moves forward and cannot be deleted, so any scenario that needs a
#     real account in a real state signs up its own (@provision).
#   - Figma (node 2251-20850) could not be opened (no access). Wording is the requirement's; check
#     icons, star rendering and layout against Figma once access is granted.
#
# Open points (ask the PO):
#   - The "level" values and how the overall score maps to a level are not specified.
#   - Star rating for a fractional score (e.g. 3.5) - half stars, or rounded?
#   - What the card shows if analysis FAILS or takes far longer than 60 seconds.
#   - The completion pop-up's own dismissal (X, Escape, outside click) is not specified; only
#     the results-ready modal is stated to be non-dismissible.

@psychometric-completion @not-implemented
Feature: Candidate Portal - Psychometric test completion and analysis
  As a Candidate
  I want to see a clear confirmation and status update after I complete the psychometric test
  So that I know my answers were received and my results are being prepared

  # =============================================================================================
  # 1. Before the test - the right-side Profile card
  # =============================================================================================

  @positive @provision
  Scenario: Verify that the Profile card is on the right side before the test is completed
    Given I am logged in as a candidate who has completed onboarding but not taken the test
    When I open the Getting Started page
    Then the Profile card should be displayed on the right side
    And the "Your Test Results" card should not be displayed
    And neither the "Psychometric Test Completed" pop-up nor the results-ready modal should be displayed

  @negative @mocked
  Scenario: Verify that a test that was started but not finished shows no completion pop-up or results card
    Given I am logged in as a candidate whose test is reported as started but not finished
    When I open the Getting Started page
    Then the Profile card should be displayed on the right side
    And the "Psychometric Test Completed" pop-up should not be displayed
    And the "Your Test Results" card should not be displayed

  # =============================================================================================
  # 2. Pop-up 1 - Psychometric Test Completed
  # =============================================================================================

  @positive @mocked
  Scenario: Verify that finishing the test shows the completion pop-up with its icon, message and button
    Given I am logged in as a candidate whose test has just been finished
    When I land on the Getting Started page after the test
    Then the "Psychometric Test Completed" pop-up should be displayed
    And it should show a check icon
    And its message should read "Psychometric test completed successfully! We’re analyzing your responses to generate your results. This may take a few moments, we’ll notify you once they’re ready."
    And it should offer a "Got it!" button

  @positive @mocked
  Scenario: Verify that "Got it!" closes the pop-up and keeps the candidate on Getting Started with the analyzing card
    Given the "Psychometric Test Completed" pop-up is displayed
    When I click "Got it!"
    Then the pop-up should close
    And I should still be on the Getting Started page
    And the URL should not have changed
    And the "Your Test Results" card should be displayed in the Analyzing state

  @negative @mocked
  Scenario: Verify that the Profile card is not replaced while the completion pop-up is still open
    Given the "Psychometric Test Completed" pop-up is displayed
    Then the card behind the pop-up should be recorded
    And the "Your Test Results" card should be displayed only once "Got it!" has been clicked

  @edge-case @mocked
  Scenario: Verify that the completion pop-up is shown once and not again after "Got it!"
    Given I have clicked "Got it!" on the "Psychometric Test Completed" pop-up
    When I reload the Getting Started page
    Then the "Psychometric Test Completed" pop-up should not be displayed again
    And the "Your Test Results" card should still be displayed in the Analyzing state
    When I log out, log back in and open the Getting Started page
    Then the "Psychometric Test Completed" pop-up should not be displayed again

  @edge-case @mocked
  Scenario: Verify where the completion pop-up appears if the candidate leaves before clicking "Got it!"
    Given the "Psychometric Test Completed" pop-up is displayed
    When I reload the page without clicking "Got it!"
    Then whether the pop-up is shown again should be recorded for the PO
    And the "Your Test Results" card or the pop-up should be displayed, never the Profile card alone

  @needs-clarification @mocked
  Scenario: Verify how the completion pop-up responds to other dismissal routes
    # Only "Got it!" is specified. Recorded for the PO, then asserted once answered.
    Given the "Psychometric Test Completed" pop-up is displayed
    When I try to close it with the Escape key, an outside click and any close icon
    Then the outcome of each route should be recorded for the PO
    And whichever route closes it should leave me on Getting Started with the analyzing card

  @edge-case @mocked
  Scenario: Verify that the completion pop-up is operable with the keyboard alone
    Given the "Psychometric Test Completed" pop-up is displayed
    Then keyboard focus should move into the pop-up
    When I press Tab until "Got it!" is focused and press Enter
    Then the pop-up should close and focus should return to the page

  # =============================================================================================
  # 3. Right-side card - Your Test Results (Analyzing...)
  # =============================================================================================

  @positive @mocked
  Scenario: Verify that the Your Test Results card replaces the Profile card in the same position
    Given I have noted the position and size of the Profile card before the test
    And I have finished the test and clicked "Got it!"
    Then the Profile card should no longer be displayed
    And the "Your Test Results" card should be displayed in the same position on the right side

  @positive @mocked
  Scenario: Verify that the analyzing card shows its title, clock icon and message
    Given I have finished the test and clicked "Got it!"
    Then the "Your Test Results" card should show the title "Analyzing..."
    And it should show a clock icon
    And its message should read "We’re reviewing your answers to build your psychometric profile. This takes about 60 seconds, and your results will open when they’re ready."

  @positive @mocked
  Scenario: Verify that the analyzing card stays in place across a reload and a new session while analysis runs
    Given my test analysis is still in progress
    When I reload the Getting Started page
    Then the "Your Test Results" card should show "Analyzing..."
    When I log out, log back in and open the Getting Started page
    Then the "Your Test Results" card should show "Analyzing..."
    And the Profile card should not be displayed

  @negative @mocked
  Scenario: Verify that the results-ready modal does not open while analysis is still in progress
    Given my test analysis is still in progress
    When I stay on the Getting Started page for 30 seconds
    Then the results-ready modal should not be displayed
    And the card should still show "Analyzing..."

  @negative @mocked
  Scenario: Verify how a failed analysis is presented to the candidate
    # Not specified - the card must not stay on "Analyzing..." for ever or show empty results.
    Given my test analysis is reported as failed
    When I open the Getting Started page
    Then the results-ready modal should not be displayed
    And what the card shows should be recorded for the PO

  @edge-case @mocked
  Scenario: Verify what the candidate sees when analysis takes much longer than 60 seconds
    Given my test analysis is still in progress after 5 minutes
    When I stay on the Getting Started page
    Then the card should not claim the results are ready
    And what the card shows should be recorded for the PO

  @negative @mocked
  Scenario: Verify that a failed status request is not presented as "Analyzing..." or as results
    Given the request for my test status will fail
    When I open the Getting Started page
    Then the results-ready modal should not be displayed
    And no score or level should be displayed
    And what the right side shows should be recorded for the PO

  # =============================================================================================
  # 4. Pop-up 2 - Test Results Ready (opens automatically)
  # =============================================================================================

  @positive @mocked
  Scenario: Verify that the results-ready modal opens automatically when analysis completes, with no refresh
    Given I am on the Getting Started page with the "Your Test Results" card showing "Analyzing..."
    When the analysis completes while the page is open
    Then the results-ready modal should open within the expected time without any reload or click
    And no page navigation should have happened

  @positive @mocked
  Scenario: Verify that the results-ready modal shows the trophy, greeting, title, summary and CTA
    Given my test results are ready and the results-ready modal is displayed
    Then it should show a trophy icon
    And the greeting should read "Great job, {Candidate Name}!" with the candidate's own name
    And the title should read "Your test results are ready!"
    And the Psychometric Profile summary should show the candidate's level
    And it should show the score out of 5 with a star rating
    And it should show a short feedback note
    And a "View Full Feedback" button should be displayed

  @positive @mocked
  Scenario: Verify that the modal's summary matches the results the server returned
    Given my test results are ready with level "<level>", score <score> and a feedback note
    When the results-ready modal is displayed
    Then the level should read "<level>"
    And the score should read "<score> / 5"
    And the star rating should represent <score> out of 5
    And the feedback note should match the server's note exactly

  @edge-case @mocked
  Scenario: Verify that the star rating is correct at the bounds and for a fractional score
    Given the results-ready modal is displayed, it should render each score like this:
      | score | stars                                   |
      | 0     | no filled stars                         |
      | 1     | 1 filled star                           |
      | 3.5   | recorded for the PO (half star or rounded) |
      | 5     | 5 filled stars                          |

  @edge-case @mocked
  Scenario: Verify that a long name and a long feedback note do not break the modal
    Given my name is 40 characters long and hyphenated
    And my feedback note is 500 characters long
    When the results-ready modal is displayed
    Then the greeting should show my full name without overflowing the modal
    And the feedback note should be readable and the "View Full Feedback" button visible

  # =============================================================================================
  # 5. Results-ready modal - non-dismissible and blocks navigation
  # =============================================================================================

  @negative @mocked
  Scenario: Verify that the results-ready modal cannot be dismissed by any route
    Given my test results are ready and the results-ready modal is displayed
    Then no close icon should be displayed on the modal
    When I try to dismiss it in each of these ways, it should stay open:
      | route                                 |
      | press Escape                          |
      | click outside the modal               |
      | press Tab past the last control       |
      | press the browser Back button         |
    And no request marking the results as viewed should have been sent

  @negative @mocked
  Scenario: Verify that the candidate cannot reach other pages while the results-ready modal is pending
    Given my test results are ready and the results-ready modal is displayed
    When I try to reach each of these destinations, the results-ready modal should still block the page:
      | destination                              |
      | the Getting Started page by sidebar link |
      | the Getting Started page by URL          |
      | the Profile page by URL                  |
      | the Dashboard by URL                     |
      | any sidebar link                         |
    And the page behind the modal should not be interactive

  @edge-case @mocked
  Scenario: Verify that keyboard focus is trapped inside the results-ready modal
    Given my test results are ready and the results-ready modal is displayed
    When I press Tab repeatedly
    Then focus should cycle only through the modal's controls
    And no control on the page behind the modal should receive focus

  # =============================================================================================
  # 6. Results-ready modal - persistence
  # =============================================================================================

  @positive @mocked
  Scenario Outline: Verify that the results-ready modal comes back after <interruption>
    Given my test results are ready and the results-ready modal is displayed
    And I have not clicked "View Full Feedback"
    When <interruption> and I return to the platform
    Then the results-ready modal should be displayed again
    And it should show the same level, score and feedback note

    Examples:
      | interruption                                         |
      | I reload the page                                    |
      | I close the browser tab and open the portal again    |
      | I log out and log back in                            |
      | I sign in from a new browser with no stored data     |

  @edge-case @mocked
  Scenario: Verify that the results-ready modal survives a network disconnect
    Given my test results are ready and the results-ready modal is displayed
    When the network goes offline
    Then the results-ready modal should stay displayed
    When the network comes back and I reload
    Then the results-ready modal should be displayed again

  @not-automatable
  Scenario: Verify that the results-ready modal comes back after the device powers off
    Given my test results are ready and the results-ready modal is displayed
    When the device is powered off and on again and I return to the platform
    Then the results-ready modal should be displayed again

  @edge-case @mocked
  Scenario: Verify that results that became ready while the candidate was away open on the next visit
    Given I logged out while my test analysis was in progress
    And the analysis has since completed
    When I log back in
    Then the results-ready modal should be displayed straight away
    And the "Analyzing..." card should not be displayed

  @edge-case @mocked
  Scenario: Verify that a second open tab also shows the results-ready modal
    Given I have the Getting Started page open in two tabs with analysis in progress
    When the analysis completes
    Then the results-ready modal should open in both tabs
    When I click "View Full Feedback" in one tab
    Then the other tab should not let me use the platform without the modal until it is reloaded, and the outcome should be recorded

  # =============================================================================================
  # 7. View Full Feedback and the detailed results screen
  # =============================================================================================

  @positive @mocked
  Scenario: Verify that "View Full Feedback" opens the detailed Psychometric Test Results screen
    Given my test results are ready and the results-ready modal is displayed
    When I click "View Full Feedback"
    Then the results-ready modal should close
    And I should be on the detailed Psychometric Test Results screen
    And a request marking the results as viewed should have been sent once

  @positive @mocked
  Scenario: Verify that the modal does not return once "View Full Feedback" has been clicked
    Given I have clicked "View Full Feedback" on the results-ready modal
    When I go to the Getting Started page
    Then the results-ready modal should not be displayed
    When I log out, log back in and open the Getting Started page
    Then the results-ready modal should not be displayed

  @negative @mocked
  Scenario: Verify that a failed "results viewed" request keeps the modal pending
    Given my test results are ready and the results-ready modal is displayed
    And the request marking the results as viewed will fail
    When I click "View Full Feedback"
    Then the outcome should be recorded for the PO
    And on my next visit the results-ready modal should be displayed again

  @negative @mocked
  Scenario: Verify that double-clicking "View Full Feedback" opens the results screen once
    Given my test results are ready and the results-ready modal is displayed
    When I double-click "View Full Feedback"
    Then I should be on the detailed Psychometric Test Results screen
    And only one "results viewed" request should have been sent

  @positive @mocked
  Scenario: Verify that the detailed screen shows the overall score, level and the four skills
    Given I am on the detailed Psychometric Test Results screen
    Then the overall psychometric score and level should be displayed
    And each of these skills should show a score out of 5, a star rating and a feedback note:
      | skill                       |
      | Problem Solving             |
      | Communication               |
      | Decision Making             |
      | Teamwork and Collaboration  |
    And a "Download Report" link and a "Back to Dashboard" button should be displayed

  @positive @mocked
  Scenario: Verify that every figure on the detailed screen matches the server and the modal
    Given my test results were returned with an overall score, a level and four skill scores
    When I open the detailed Psychometric Test Results screen from the results-ready modal
    Then the overall score and level should match the server and the modal summary
    And each skill's score, stars and feedback note should match the server

  @positive @provision
  Scenario: Verify that "Download Report" downloads the candidate's report as a PDF
    # Needs a candidate with real results, or a stubbed report URL (@mocked) if none exists.
    Given I am on the detailed Psychometric Test Results screen
    When I click "Download Report"
    Then a file should be downloaded
    And it should be a valid PDF (starting with "%PDF")
    And it should name the candidate and state the same overall score and level as the screen
    And I should stay on the results screen

  @negative @mocked
  Scenario: Verify that a failed report download is reported rather than saving a broken file
    Given I am on the detailed Psychometric Test Results screen
    And the report request will fail
    When I click "Download Report"
    Then an error should be displayed
    And no file, or no non-PDF file, should be saved

  @positive @mocked
  Scenario: Verify that "Back to Dashboard" goes to the main Candidate Dashboard
    Given I am on the detailed Psychometric Test Results screen
    When I click "Back to Dashboard"
    Then I should be on the main Candidate Dashboard
    And the results-ready modal should not be displayed

  @negative
  Scenario: Verify that the results screen requires a signed-in candidate
    Given I am not logged in
    When I open the Psychometric Test Results screen URL directly
    Then I should be redirected to the login page

  @negative @provision
  Scenario: Verify that a candidate without results cannot open the results screen
    Given I am logged in as a candidate who has not taken the test
    When I open the Psychometric Test Results screen URL directly
    Then no score, level or report should be displayed
    And I should be sent to the Getting Started page or shown an appropriate message

  @negative @mocked
  Scenario: Verify that a candidate cannot see another candidate's results
    Given I am logged in as a candidate with results
    When I open the results screen and report URLs for another candidate's id
    Then no other candidate's score, level or report should be returned

  # =============================================================================================
  # 8. End to end
  # =============================================================================================

  @positive @mocked
  Scenario: Verify the whole post-test journey from completion to the Candidate Dashboard
    Given I am logged in as a candidate whose test has just been finished
    When I land on the Getting Started page after the test
    Then the "Psychometric Test Completed" pop-up should be displayed
    When I click "Got it!"
    Then the "Your Test Results" card should replace the Profile card showing "Analyzing..."
    When the analysis completes while the page is open
    Then the results-ready modal should open automatically with my level, score and feedback note
    And it should not be dismissible
    When I log out and log back in
    Then the results-ready modal should be displayed again
    When I click "View Full Feedback"
    Then the detailed results screen should show my overall score, level and the four skills
    When I click "Download Report"
    Then my report should download as a PDF
    When I click "Back to Dashboard"
    Then I should be on the main Candidate Dashboard
    And the results-ready modal should not come back

  @positive @mocked
  Scenario: Verify the journey for a candidate who leaves during analysis and returns after it finishes
    Given I have finished the test and clicked "Got it!"
    And the "Your Test Results" card shows "Analyzing..."
    When I close the browser tab
    And the analysis completes while I am away
    And I open the portal again and log in
    Then the results-ready modal should be displayed straight away
    When I click "View Full Feedback"
    Then I should be on the detailed Psychometric Test Results screen

  @not-automatable
  Scenario: Verify the real journey from taking the psychometric test to viewing the results
    Given I am logged in as a candidate who has completed onboarding
    When I take and finish the real psychometric test
    Then the "Psychometric Test Completed" pop-up should be displayed
    When I click "Got it!"
    Then the "Your Test Results" card should show "Analyzing..."
    And within about 60 seconds the results-ready modal should open automatically
    When I click "View Full Feedback"
    Then the detailed results screen should show my real results
