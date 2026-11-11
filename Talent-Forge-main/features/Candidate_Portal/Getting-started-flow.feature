# Getting Started flow - Candidate Portal
#
# SCENARIOS ONLY. No step definitions exist yet, so the feature carries @not-implemented:
# playwright-bdd fails generation for the WHOLE suite on a single undefined step, and that tag
# keeps this file out of every profile until the steps are written. Remove it when they are.
#
# Fixtures (to settle when implementing):
#   - Every state here belongs to ONE candidate's onboarding progress, which only moves forward,
#     so each scenario that changes progress signs up its own fresh candidate (@provision).
#     A candidate cannot be deleted, so those scenarios must stay out of the default run.
#   - The psychometric test is a timed adaptive AI interview plus MCQs and cannot be completed
#     honestly by automation. Post-test states are driven by stubbing the progress response
#     (@mocked); the real transition is @not-automatable.
#   - Figma (node 2251-20850) could not be opened (no access). Wording below is the requirement's;
#     re-check visual details (colours, icons, illustration) against Figma once access is granted.

@getting-started @not-implemented
Feature: Candidate Portal - Getting Started flow
  As a newly registered candidate
  I want to see my onboarding progress, complete the required steps in order, and track my profile completion
  So that I can unlock my track

  # =============================================================================================
  # 1. Landing and page layout
  # =============================================================================================

  @positive @provision
  Scenario: Verify that a newly signed-up candidate lands on the Getting Started page
    Given I have signed up and verified a new candidate account
    When I log in as that candidate for the first time
    Then I should be on the Getting Started page
    And none of the previous six onboarding screens should be displayed

  @positive @provision
  Scenario: Verify that the Getting Started page renders its documented layout
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the page header title should read "Getting Started"
    And the heading should read "Welcome, {First Name}!" with the candidate's own first name
    And the heading should end with a wave emoji
    And the subtext should read "Complete your onboarding and psychometric test to unlock your personalized track."
    And a dashed divider should be displayed below the subtext
    And the four step cards should be displayed below the divider
    And the "What's waiting for you" section should be displayed
    And the profile card should be displayed on the right of the page

  @positive @provision
  Scenario: Verify that the four step cards are shown in one row, in order, each with its full content
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the step cards should be displayed in a single row in this order:
      | step   | title                        | description                                                  |
      | Step 1 | Create your account          | Sign up and get into the portal.                             |
      | Step 2 | Complete Your Onboarding     | <as specified>                                               |
      | Step 3 | Take the psychometric test   | An AI interview and short questions that reveal your strengths. |
      | Step 4 | Get your personalized track  | Courses and assessments matched to your roles and results.   |
    And every step card should contain an illustration, a "Step {N}" label, a title, a description and a status line at the bottom

  # =============================================================================================
  # 2. Card states on a brand-new account
  # =============================================================================================

  @positive @provision
  Scenario: Verify that a new candidate sees Step 1 completed, Step 2 active and Steps 3 and 4 locked
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the step cards should be in these states:
      | step   | state     | status line                          |
      | Step 1 | Completed | Signed In                            |
      | Step 2 | Active    | <Step 2 CTA, as specified>           |
      | Step 3 | Locked    | Take the test                        |
      | Step 4 | Locked    | Built from your results              |
    And exactly one step card should be active

  @positive @provision
  Scenario: Verify that each card state renders its documented visual treatment
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the "Completed" card should show a green check icon and green status text
    And the "Active" card should be in full colour with a blue CTA and an arrow
    And every "Locked" card should be greyed out with a faded illustration, grey text and a grey CTA
    And the Step 3 "Take the test" CTA and its arrow should be grey while Step 3 is locked
    And Step 4 should show a layers icon beside the label "Built from your results"

  # =============================================================================================
  # 3. Step 2 - Complete Your Onboarding
  # =============================================================================================

  @positive @provision
  Scenario: Verify that the active Step 2 CTA opens the onboarding flow at its first step
    Given I am logged in as a newly registered candidate
    And I am on the Getting Started page
    When I click the Step 2 CTA
    Then the onboarding flow should open at "Current status"
    And the onboarding flow should have exactly four steps: "Current status", "Education", "Work experience", "Career interests"

  @positive @provision
  Scenario: Verify that "Save and finish later" on every onboarding step saves progress and returns to Getting Started
    Given I am logged in as a newly registered candidate
    Then on each onboarding step "Save and finish later" should save the data and return me to Getting Started:
      | onboarding step  |
      | Current status   |
      | Education        |
      | Work experience  |
      | Career interests |
    And each saved value should still be present when that step is reopened

  @positive @provision
  Scenario: Verify that an incomplete onboarding shows "Complete Onboarding" and resumes from the last saved step
    Given I am logged in as a newly registered candidate
    And I have completed the onboarding steps up to "Education" and chosen "Save and finish later"
    When I open the Getting Started page
    Then the Step 2 CTA should read "Complete Onboarding"
    And Step 2 should still be the only active card
    And Step 3 should still be locked
    When I click "Complete Onboarding"
    Then the onboarding flow should resume at "Work experience"
    And the data I saved on the earlier steps should be retained

  @positive @provision
  Scenario: Verify that finishing onboarding returns to Getting Started with Step 2 completed and Step 3 active
    Given I am logged in as a newly registered candidate
    When I complete all four onboarding steps and click "Finish Onboarding"
    Then I should be on the Getting Started page
    And Step 2 should show "Onboarding Completed" with a green check mark and green status text
    And Step 3 should be the only active card
    And Step 3 should display a blue "Take the test" CTA with an arrow
    And Step 4 should still be locked

  @positive @provision
  Scenario: Verify that the active Step 3 CTA starts the psychometric test
    Given I am logged in as a candidate who has completed onboarding
    And I am on the Getting Started page
    When I click "Take the test"
    Then the psychometric test should open

  # =============================================================================================
  # 4. Step 4 - Get your personalized track
  # =============================================================================================

  @positive @mocked
  Scenario: Verify that completing the psychometric test makes Step 4 active without a CTA
    Given I am logged in as a candidate who has completed onboarding
    And the candidate's progress reports the psychometric test as completed
    When I open the Getting Started page
    Then Step 3 should be shown as completed
    And Step 4 should be the only active card
    And Step 4 should display no CTA or button
    And the personalized track should be available

  # =============================================================================================
  # 5. Profile card and checklist
  # =============================================================================================

  @positive @provision
  Scenario: Verify that the profile card shows the candidate's initials, first name and email
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the profile card should show the candidate's initials derived from their first and last name
    And the profile card should show the candidate's first name
    And the profile card should show the candidate's email address

  @positive @provision
  Scenario: Verify that a new candidate's checklist lists every item in order with its initial state
    Given I am logged in as a newly registered candidate
    When I open the Getting Started page
    Then the profile checklist should show these items in order:
      | item                       | state      | chevron | clickable |
      | Create your account        | completed  | no      | no        |
      | Add your current status    | incomplete | yes     | yes       |
      | Add your education         | incomplete | yes     | yes       |
      | Add your work experience   | incomplete | yes     | yes       |
      | Pick your career interests | incomplete | yes     | yes       |
    And a completed item should show a green check mark
    And an incomplete item should show a dashed circle

  @positive @provision
  Scenario: Verify that each checklist item opens its own onboarding step with the previously saved data
    Given I am logged in as a candidate who has saved every onboarding step without finishing
    Then clicking each checklist item should open its onboarding step pre-filled with the saved data:
      | item                       | onboarding step  |
      | Add your current status    | Current status   |
      | Add your education         | Education        |
      | Add your work experience   | Work experience  |
      | Pick your career interests | Career interests |

  @positive @provision
  Scenario: Verify that a completed checklist item shows a green check and keeps its chevron
    Given I am logged in as a newly registered candidate
    And I have saved the "Education" onboarding step
    When I open the Getting Started page
    Then the "Add your education" checklist item should show a green check mark
    And the "Add your education" checklist item should still show its chevron
    And the "Add your education" checklist item should still open the "Education" step

  # =============================================================================================
  # 6. Negative - locked, completed and out-of-order access
  # =============================================================================================

  @negative @provision
  Scenario: Verify that locked and completed cards cannot be activated
    Given I am logged in as a newly registered candidate
    And I am on the Getting Started page
    Then clicking each of these cards should change nothing, navigate nowhere and send no request:
      | step   | state     |
      | Step 1 | Completed |
      | Step 3 | Locked    |
      | Step 4 | Locked    |

  @negative @provision
  Scenario: Verify that a completed Step 2 is no longer clickable
    Given I am logged in as a candidate who has completed onboarding
    And I am on the Getting Started page
    When I click the Step 2 card
    Then the onboarding flow should not open
    And I should remain on the Getting Started page

  @negative @provision
  Scenario: Verify that the "Create your account" checklist item is not clickable
    Given I am logged in as a newly registered candidate
    And I am on the Getting Started page
    When I click the "Create your account" checklist item
    Then nothing should open and I should remain on the Getting Started page

  @negative @provision
  Scenario: Verify that the psychometric test cannot be reached by URL before onboarding is completed
    Given I am logged in as a newly registered candidate
    When I navigate directly to the psychometric test URL
    Then the test should not start
    And I should be returned to the Getting Started page with Step 3 still locked

  @negative @provision
  Scenario: Verify that Step 2 does not complete while any onboarding step is unfinished
    Given I am logged in as a newly registered candidate
    And I have saved three of the four onboarding steps
    When I open the Getting Started page
    Then Step 2 should still read "Complete Onboarding"
    And Step 3 should still be locked
    And the unfinished checklist item should still show a dashed circle

  @negative
  Scenario: Verify that the Getting Started page requires a signed-in candidate
    Given I am not logged in
    When I navigate directly to the Getting Started page
    Then I should be redirected to the login page

  @negative @mocked
  Scenario: Verify that a failed progress load is not presented as a brand-new account
    Given I am logged in as a candidate who has completed onboarding
    And the candidate progress request will fail with a server error
    When I open the Getting Started page
    Then an error should be shown instead of the step cards
    And Step 2 should not be shown as active

  # =============================================================================================
  # 7. Edge cases
  # =============================================================================================

  @edge-case @provision
  Scenario: Verify that the resume point matches whichever step was saved last
    Given I am logged in as a newly registered candidate
    Then "Complete Onboarding" should resume at the step after the last one saved:
      | last saved step  | resumes at       |
      | Current status   | Education        |
      | Education        | Work experience  |
      | Work experience  | Career interests |

  @edge-case @provision
  Scenario: Verify that steps completed out of order through the checklist are tracked correctly
    Given I am logged in as a newly registered candidate
    When I save "Pick your career interests" from its checklist item before any other step
    Then the "Pick your career interests" checklist item should show a green check mark
    And the other three onboarding checklist items should still be incomplete
    And Step 2 should still read "Complete Onboarding"

  @edge-case @provision
  Scenario: Verify that the progress survives a reload, a new session and the browser Back button
    Given I am logged in as a newly registered candidate
    And I have saved the "Education" onboarding step
    Then the Getting Started page should show the same progress after a reload
    And the Getting Started page should show the same progress after logging out and back in
    And returning from the onboarding flow with the browser Back button should show the same progress

  @edge-case @provision
  Scenario: Verify that a long or accented first name renders correctly in the heading and profile card
    Given I have signed up a new candidate named "Abdul-Rahmaan Maximiliano" "Al-Qahtani"
    When I open the Getting Started page
    Then the heading should read "Welcome, Abdul-Rahmaan Maximiliano!" without truncating or overflowing
    And the profile card should show the initials "AA"
    And the step cards should remain in a single row

  @edge-case @provision
  Scenario: Verify that the active CTA is operable by keyboard and locked cards are not focusable
    Given I am logged in as a newly registered candidate
    And I am on the Getting Started page
    When I Tab to the Step 2 CTA and press Enter
    Then the onboarding flow should open
    And no locked card should be reachable by the Tab key

  @edge-case @provision
  Scenario: Verify that progress made in one tab is shown in another after a reload
    Given I am logged in as a newly registered candidate in two browser tabs
    When I finish onboarding in the first tab
    And I reload the Getting Started page in the second tab
    Then the second tab should show Step 2 completed and Step 3 active

  # =============================================================================================
  # 8. End to end
  # =============================================================================================

  @positive @provision
  Scenario: Verify that a candidate completes onboarding end to end from signup to an unlocked test
    Given I have signed up and verified a new candidate account
    When I log in as that candidate for the first time
    Then I should be on the Getting Started page with Step 2 active
    When I click the Step 2 CTA and complete "Current status" and "Education"
    And I choose "Save and finish later"
    Then I should be on the Getting Started page
    And the "Add your current status" and "Add your education" checklist items should show green check marks
    And the Step 2 CTA should read "Complete Onboarding"
    When I click "Complete Onboarding"
    Then the onboarding flow should resume at "Work experience"
    When I complete "Work experience" and "Career interests" and click "Finish Onboarding"
    Then I should be on the Getting Started page
    And Step 2 should show "Onboarding Completed"
    And every checklist item should show a green check mark
    And Step 3 should be active with a blue "Take the test" CTA
    And Step 4 should still be locked

  @positive @provision
  Scenario: Verify that a candidate completes onboarding entirely through the profile checklist
    Given I am logged in as a newly registered candidate
    When I open and save each onboarding checklist item in turn from the Getting Started page
    Then every checklist item should show a green check mark
    And Step 2 should show "Onboarding Completed"
    And Step 3 should be the only active card

  @positive @not-automatable
  Scenario: Verify that taking the psychometric test unlocks the personalized track end to end
    Given I am logged in as a candidate who has completed onboarding
    When I take and submit the psychometric test
    And I return to the Getting Started page
    Then Steps 1, 2 and 3 should be shown as completed
    And Step 4 should be active with no CTA
    And my personalized track should be available
