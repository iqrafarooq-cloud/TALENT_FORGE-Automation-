# Candidate Onboarding flow (four steps) - Candidate Portal
#
# SCENARIOS ONLY. No step definitions exist yet, so the feature carries @not-implemented:
# playwright-bdd fails generation for the WHOLE suite on a single undefined step, and that tag
# keeps this file out of every profile until the steps are written. Remove it when they are.
#
# Scope: the four-step onboarding form opened from the Getting Started page (Step 1 Student or
# Graduate, Step 2 Education, Step 3 Experience, Step 4 Career interest mapping) and its
# confirmation modal. The Getting Started page itself is covered by Getting-started-flow.feature;
# only the hand-offs to and from it are asserted here. The old six-step wizard lives in
# features/Auth/Onboarding.feature and is not touched.
#
# Fixtures (to settle when implementing):
#   - Onboarding progress only moves forward and a candidate cannot be deleted, so every scenario
#     that saves or finishes onboarding signs up its own fresh candidate (@provision) and must stay
#     out of the default run.
#   - Majors, Areas of Interest and their career paths come from Super Admin configuration. Steps
#     must read the expected lists from the API the form itself calls, never from literals here.
#     "<major A>" / "<major B>" / "<other area>" are placeholders for values chosen at run time.
#   - "Editing until the test starts" needs a candidate who HAS started the test. The test is a
#     timed adaptive AI interview and cannot be started honestly by automation, so that state is
#     stubbed (@mocked); the real transition is @not-automatable.
#
# Open points (left as placeholders, ask the PO):
#   - The Experience type option list was missing from the requirement ("Full size"); the five
#     types named in Step 3's subtext are used until the real list is supplied.
#   - No maximum upload size is stated. "<max size>" is a placeholder.
#   - "Save and finish later" is said to exist on Steps 2 and 3, and also "at any step". Steps 1 and
#     4 are covered by a @needs-clarification scenario.
#   - Figma (node 2251-20850) could not be opened (no access). Wording below is the requirement's;
#     re-check visuals (borders, chips, pills, icons) against Figma once access is granted.

@candidate-onboarding @not-implemented
Feature: Candidate Portal - Onboarding flow
  As a candidate
  I want to tell TalentForge whether I am a student or a graduate, share my education and experience,
  and choose a career direction with up to three career paths in priority order
  So that my psychometric assessment and learning track are built around the careers I want to pursue

  # =============================================================================================
  # 1. Entry, stepper and footer
  # =============================================================================================

  @positive @provision
  Scenario: Verify that starting onboarding from Getting Started opens Step 1
    Given I am logged in as a newly registered candidate
    And I am on the Getting Started page
    When I click the Step 2 onboarding CTA
    Then the onboarding form should open at Step 1
    And the step indicator should read "Step 1 of 4"

  @positive @provision
  Scenario: Verify that every step shows its indicator, its pill and the right footer buttons
    Given I am logged in as a newly registered candidate
    When I walk through the onboarding steps with valid data
    Then each step should show the following:
      | step | indicator   | optional pill | footer buttons                       |
      | 1    | Step 1 of 4 | no            | Next                                 |
      | 2    | Step 2 of 4 | no            | Back, Save and Finish Later, Next    |
      | 3    | Step 3 of 4 | yes           | Back, Save and Finish Later, Next    |
      | 4    | Step 4 of 4 | no            | Back, Finish                         |

  # =============================================================================================
  # 2. Step 1 - Student or Graduate
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Step 1 renders its greeting, subtext and both cards with nothing selected
    Given I am logged in as a newly registered candidate
    When I open onboarding at Step 1
    Then the heading should read "Hello, {First name}!" with the candidate's own first name
    And the heading should end with a wave emoji
    And the subtext should read "Help us personalize your experience by telling us a bit about yourself. Which best describes you?"
    And these cards should be displayed with no card selected:
      | card     | description                                                  |
      | Student  | I'm currently enrolled at a university.                      |
      | Graduate | I've completed my degree and I'm looking for my next role.   |
    And the "Next" button should be disabled

  @positive @provision
  Scenario: Verify that selecting a card highlights it and enables Next
    Given I am on onboarding Step 1 as a new candidate
    When I select the "<card>" card
    Then the "<card>" card should have a highlighted blue border
    And the other card should not be highlighted
    And the "Next" button should be enabled

    Examples:
      | card     |
      | Student  |
      | Graduate |

  @edge-case @provision
  Scenario: Verify that only one Step 1 card can be selected at a time
    Given I am on onboarding Step 1 as a new candidate
    When I select the "Student" card
    And I select the "Graduate" card
    Then only the "Graduate" card should be selected
    When I select the "Graduate" card again
    Then the "Graduate" card should still be selected
    And the "Next" button should be enabled

  @positive @provision
  Scenario: Verify that the Step 1 answer is saved to the candidate profile
    Given I am on onboarding Step 1 as a new candidate
    When I select the "Graduate" card and click "Next"
    Then I should be on onboarding Step 2
    And the candidate profile should record the qualification as "Graduate"

  @negative @provision
  Scenario: Verify that Step 1 cannot be passed without a selection
    Given I am on onboarding Step 1 as a new candidate
    When I try to activate the disabled "Next" button by mouse and by keyboard
    Then I should remain on onboarding Step 1
    And no onboarding data should be saved

  # =============================================================================================
  # 3. Step 2 - Education
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Step 2 renders its heading and one empty Education card
    Given I am on onboarding Step 2 as a new "Student" candidate
    Then the heading should read "Great! Let's dive into your education."
    And the subtext should read "Tell us about your academic background so we can get you on the right track."
    And one "Education 1" card should be displayed with these fields:
      | field                              | type     | required |
      | University/Institution Name        | dropdown | yes      |
      | Degree                             | dropdown | yes      |
      | Field of Study/Major               | dropdown | yes      |
      | Start Date                         | month and year dropdowns | yes |
      | Graduation Date (or Expected)      | month and year dropdowns | yes |
      | Upload Transcript                  | upload   | no       |
    And the "+ Add education" control should be displayed
    And the "Next" button should be disabled

  @positive @provision
  Scenario: Verify that the Step 2 dropdowns are populated from the configured reference data
    Given I am on onboarding Step 2 as a new "Student" candidate
    Then the University/Institution Name options should match the institutions configured by the Super Admin
    And the Degree options should include "Bachelor's Degree (e.g., BA, BS)"
    And the Field of Study/Major options should match the configured majors

  @positive @provision
  Scenario: Verify that one complete education entry enables Next and is saved
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I complete Education 1 with valid data
    Then the "Next" button should be enabled
    When I click "Next"
    Then I should be on onboarding Step 3
    And the candidate profile should hold that education entry

  @negative @provision
  Scenario: Verify that each missing required education field keeps Next disabled
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I complete Education 1 leaving one required field empty at a time, then Next should stay disabled:
      | missing field                  |
      | University/Institution Name    |
      | Degree                         |
      | Field of Study/Major           |
      | Start Date month               |
      | Start Date year                |
      | Graduation Date month          |
      | Graduation Date year           |
    And no transcript should be needed for Next to enable

  @negative @provision
  Scenario: Verify that Step 2 cannot be skipped
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I leave every education field empty
    Then the "Next" button should be disabled
    And no skip control should be offered on Step 2

  @negative @provision
  Scenario: Verify that the graduation date must come after the start date
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I enter these dates on Education 1, the form should respond like this:
      | start    | graduation | result                               |
      | Sep 2024 | Jun 2024   | error shown, Next disabled           |
      | Sep 2024 | Sep 2024   | error shown, Next disabled           |
      | Sep 2024 | Oct 2024   | accepted                             |

  @positive @edge-case @provision
  Scenario Outline: Verify that the graduation date rule follows the Step 1 answer
    Given I am on onboarding Step 2 as a new "<status>" candidate
    When I enter a graduation date of <graduation> on Education 1
    Then the graduation date should be <result>

    Examples:
      | status   | graduation         | result   |
      | Student  | a future month     | accepted |
      | Student  | the current month  | accepted |
      | Student  | a past month       | accepted |
      | Graduate | a past month       | accepted |
      | Graduate | the current month  | accepted |
      | Graduate | next month         | rejected |
      | Graduate | a future year      | rejected |

  @edge-case @provision
  Scenario: Verify that changing Student to Graduate re-validates a future graduation date
    Given I have completed Step 1 as "Student" and Step 2 with a future graduation date
    When I go back to Step 1 and select "Graduate"
    And I click "Next"
    Then the future graduation date on Step 2 should be flagged as invalid
    And the "Next" button should be disabled until the date is a past or current month

  @positive @provision
  Scenario: Verify that "+ Add education" adds numbered entries and each can collapse and expand
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I click "+ Add education" twice
    Then the cards "Education 1", "Education 2" and "Education 3" should be displayed
    When I click the chevron on "Education 1"
    Then "Education 1" should collapse and keep its entered values
    When I click the chevron on "Education 1" again
    Then "Education 1" should expand with its values intact

  @positive @provision
  Scenario: Verify that only entries after the first can be removed
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I click "+ Add education"
    Then "Education 2" should offer a remove control
    And "Education 1" should not offer a remove control
    When I remove "Education 2"
    Then only "Education 1" should be displayed

  @negative @provision
  Scenario: Verify that a partly filled additional education entry blocks Next
    Given I am on onboarding Step 2 as a new "Student" candidate
    And I have completed Education 1 with valid data
    When I add "Education 2" and fill only its institution
    Then the "Next" button should be disabled
    When I remove "Education 2"
    Then the "Next" button should be enabled

  @positive @provision
  Scenario: Verify that several complete education entries are all saved
    Given I am on onboarding Step 2 as a new "Graduate" candidate
    When I complete Education 1 and Education 2 with valid data
    And I click "Next"
    Then the candidate profile should hold both education entries

  # =============================================================================================
  # 4. Uploads (transcript and experience letter share the same rules)
  # =============================================================================================

  @positive @provision
  Scenario Outline: Verify that a supported file uploads and shows its icon, name, size and remove control
    Given I am on onboarding Step <step> as a new "Student" candidate
    When I upload "<file>" to "<upload>"
    Then the upload should show a file icon, the file name, the file size and a red trash icon
    And no upload error should be displayed

    Examples:
      | step | upload                  | file              |
      | 2    | Upload Transcript       | transcript.pdf    |
      | 2    | Upload Transcript       | transcript.png    |
      | 2    | Upload Transcript       | transcript.jpg    |
      | 2    | Upload Transcript       | transcript.doc    |
      | 2    | Upload Transcript       | transcript.docx   |
      | 3    | Upload Experience Letter| letter.pdf        |
      | 3    | Upload Experience Letter| letter.docx       |

  @negative @provision
  Scenario: Verify that unsupported and oversized files are refused with an error
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I upload each of these files to "Upload Transcript", each should be refused with an error and not attached:
      | file                      | reason              |
      | transcript.txt            | unsupported type    |
      | transcript.xlsx           | unsupported type    |
      | transcript.zip            | unsupported type    |
      | transcript.exe            | unsupported type    |
      | transcript.jpeg           | unsupported type    |
      | over <max size>.pdf       | oversized           |

  @edge-case @provision
  Scenario: Verify that a file exactly at the size limit is accepted and one byte over is refused
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I upload a PDF of exactly <max size> to "Upload Transcript"
    Then the file should be attached
    When I remove it and upload a PDF of <max size> plus one byte
    Then it should be refused with an oversized-file error

  @edge-case @provision
  Scenario: Verify that a renamed file with a supported extension but foreign content is handled
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I upload a binary file renamed to "transcript.pdf"
    Then the result should be recorded for the PO

  @positive @provision
  Scenario: Verify that an uploaded file can be removed and replaced
    Given I am on onboarding Step 2 as a new "Student" candidate
    And I have uploaded "transcript.pdf" to "Upload Transcript"
    When I click the red trash icon
    Then the file should be removed and the upload area shown again
    When I upload "transcript.png"
    Then "transcript.png" should be attached
    And the saved education entry should carry "transcript.png" after Next

  @edge-case @provision
  Scenario: Verify that each education entry keeps its own transcript
    Given I am on onboarding Step 2 as a new "Student" candidate
    When I upload "transcript-a.pdf" to Education 1 and "transcript-b.pdf" to Education 2
    And I complete both entries and click "Next"
    Then each saved education entry should carry its own transcript

  # =============================================================================================
  # 5. Step 3 - Experience (optional)
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Step 3 renders its heading, Optional pill and one empty Experience card
    Given I am on onboarding Step 3 as a new candidate
    Then the heading should read "Got any hands-on experience?"
    And the subtext should read "This step is optional. Internships, co-op, Tamheer, part-time jobs and volunteering all count, and they help us tailor your track."
    And the "Optional" pill should be displayed next to the step indicator
    And one "Experience 1" card should be displayed with these fields:
      | field                              | type                     | required |
      | What type of experience is this?   | dropdown                 | yes      |
      | Company Name                       | text                     | yes      |
      | Role/Job Title                     | text                     | yes      |
      | I currently work here              | checkbox                 | no       |
      | Start Date                         | month and year dropdowns | yes      |
      | End Date                           | month and year dropdowns | yes      |
      | Upload Experience Letter           | upload                   | no       |
    And the "+ Add experience" control should be displayed

  @positive @provision
  Scenario: Verify that the experience type dropdown offers the configured static options
    Given I am on onboarding Step 3 as a new candidate
    When I open "What type of experience is this?"
    Then the options should be exactly the agreed static list
      # Placeholder until the list is supplied - Step 3's subtext names these:
      | option          |
      | Internship      |
      | Co-op           |
      | Tamheer         |
      | Part-time       |
      | Volunteering    |
    And no raw API value such as "co_op" should be displayed

  @positive @provision
  Scenario: Verify that Step 3 can be passed with no entries and no separate skip link exists
    Given I am on onboarding Step 3 as a new candidate
    Then no skip link should be displayed
    When I leave every experience field blank and click "Next"
    Then I should be on onboarding Step 4
    And no experience entry should be saved

  @positive @provision
  Scenario: Verify that a complete experience entry is saved
    Given I am on onboarding Step 3 as a new candidate
    When I complete Experience 1 with valid data
    And I click "Next"
    Then I should be on onboarding Step 4
    And the candidate profile should hold that experience entry

  @negative @provision
  Scenario: Verify that a partly filled experience entry blocks Next until it is complete
    Given I am on onboarding Step 3 as a new candidate
    When I fill only these experience fields, Next should be blocked and the missing required fields flagged:
      | filled fields                        |
      | What type of experience is this?     |
      | Company Name                         |
      | Role/Job Title                       |
      | Start Date                           |
      | Upload Experience Letter             |
      | Company Name, Role/Job Title         |
    When I then complete every required field
    Then the "Next" button should be enabled

  @edge-case @provision
  Scenario: Verify that clearing a partly filled entry lets Step 3 be skipped again
    Given I am on onboarding Step 3 as a new candidate
    And I have typed a company name on Experience 1
    When I clear the company name so every field is blank again
    And I click "Next"
    Then I should be on onboarding Step 4

  @positive @provision
  Scenario: Verify that "I currently work here" disables End Date and removes its requirement
    Given I am on onboarding Step 3 as a new candidate
    When I complete Experience 1 without an End Date
    Then the "Next" button should be disabled
    When I check "I currently work here"
    Then the End Date month and year should be disabled
    And the "Next" button should be enabled
    When I click "Next"
    Then the saved experience should be marked as current with no end date

  @edge-case @provision
  Scenario: Verify that unchecking "I currently work here" makes End Date required again
    Given I am on onboarding Step 3 as a new candidate
    And I have completed Experience 1 with "I currently work here" checked
    When I uncheck "I currently work here"
    Then the End Date month and year should be enabled and empty
    And the "Next" button should be disabled until an End Date is chosen

  @edge-case @provision
  Scenario: Verify that an End Date entered before checking "I currently work here" is not saved
    Given I am on onboarding Step 3 as a new candidate
    And I have completed Experience 1 with an End Date of "Mar 2025"
    When I check "I currently work here" and click "Next"
    Then the saved experience should have no end date

  @negative @provision
  Scenario: Verify that the experience end date cannot be before the start date
    Given I am on onboarding Step 3 as a new candidate
    When I enter these dates on Experience 1, the form should respond like this:
      | start    | end      | result                       |
      | Jun 2025 | Jan 2025 | error shown, Next disabled   |
      | Jun 2025 | Jun 2025 | accepted                     |
      | Jun 2025 | Dec 2025 | accepted                     |

  @negative @provision
  Scenario: Verify that whitespace-only text does not satisfy Company Name or Role/Job Title
    Given I am on onboarding Step 3 as a new candidate
    When I complete Experience 1 with "   " as the Company Name
    Then the "Next" button should be disabled
    When I complete Experience 1 with "   " as the Role/Job Title
    Then the "Next" button should be disabled

  @positive @provision
  Scenario: Verify that "+ Add experience" adds collapsible entries that are all saved
    Given I am on onboarding Step 3 as a new candidate
    When I complete Experience 1, click "+ Add experience" and complete Experience 2
    Then each Experience card should collapse and expand with its chevron, keeping its values
    When I click "Next"
    Then the candidate profile should hold both experience entries

  # =============================================================================================
  # 6. Back navigation keeps data
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Back never loses entered data
    Given I am logged in as a newly registered candidate
    And I have completed Step 1, Step 2 with an uploaded transcript, and Step 3 with one experience
    And I am on onboarding Step 4 with a direction and career paths selected
    When I click "Back" to each earlier step in turn and then "Next" back to Step 4
    Then Step 1 should still show my selected card
    And Step 2 should still show every education entry and the uploaded transcript
    And Step 3 should still show every experience entry
    And Step 4 should still show my direction and career paths in the same order

  @edge-case @provision
  Scenario: Verify that unsaved edits on the current step survive Back and Next
    Given I am on onboarding Step 3 as a new candidate
    And I have partly filled Experience 1
    When I click "Back" and then "Next"
    Then Experience 1 should still hold what I typed

  @edge-case @provision
  Scenario: Verify that the browser Back button does not discard onboarding data
    Given I am on onboarding Step 3 with Steps 1 and 2 completed
    When I press the browser Back button
    Then I should not lose any data entered in Steps 1 to 3

  # =============================================================================================
  # 7. Save and Finish Later / Continue Onboarding
  # =============================================================================================

  @positive @provision
  Scenario Outline: Verify that "Save and Finish Later" saves everything and records the step
    Given I am on onboarding Step <step> as a new candidate with the earlier steps completed
    And I have entered data on Step <step>
    When I click "Save and Finish Later"
    Then I should be on the Getting Started page
    And the onboarding button should read "Continue Onboarding"
    And the saved progress should record Step <step> as the step I stopped on
    And all data entered so far, including Step <step>'s, should be saved

    Examples:
      | step |
      | 2    |
      | 3    |

  @positive @provision
  Scenario Outline: Verify that "Continue Onboarding" reopens the exact step with saved data filled in
    Given I saved and left onboarding at Step <step>
    When I click "Continue Onboarding" on the Getting Started page
    Then the onboarding form should open at Step <step>
    And Step <step> should be pre-filled with what I saved
    And clicking "Back" should show the earlier steps pre-filled

    Examples:
      | step |
      | 2    |
      | 3    |

  @edge-case @provision
  Scenario: Verify that a partly filled Step 2 can still be saved for later
    Given I am on onboarding Step 2 as a new candidate
    And I have filled only the institution and degree of Education 1
    When I click "Save and Finish Later"
    Then I should be on the Getting Started page
    When I click "Continue Onboarding"
    Then Step 2 should reopen with the institution and degree filled and the rest empty
    And the "Next" button should be disabled

  @edge-case @provision
  Scenario: Verify that a saved upload is still attached after "Continue Onboarding"
    Given I uploaded "transcript.pdf" on Step 2 and clicked "Save and Finish Later"
    When I click "Continue Onboarding"
    Then Step 2 should show "transcript.pdf" with its icon, name, size and trash icon

  @edge-case @provision
  Scenario: Verify that save and continue can be repeated until onboarding is finished
    Given I am logged in as a newly registered candidate
    When I save and leave at Step 2, continue, save and leave at Step 3, continue, and finish Step 4
    Then each "Continue Onboarding" should have reopened at the step I left
    And onboarding should be complete with all data from every session

  @edge-case @provision
  Scenario: Verify that saved progress survives a logout and a new session
    Given I saved and left onboarding at Step 3
    When I log out and log back in
    And I click "Continue Onboarding"
    Then the onboarding form should open at Step 3 with my saved data

  @negative @provision
  Scenario: Verify that a failed save keeps the candidate on the form and does not report success
    Given I am on onboarding Step 2 with Education 1 completed
    And the onboarding save request will fail
    When I click "Save and Finish Later"
    Then an error should be displayed
    And I should remain on onboarding Step 2 with my data still entered

  @needs-clarification @provision
  Scenario: Verify where "Save and Finish Later" is offered on Steps 1 and 4
    # The requirement says Steps 2 and 3 have the CTA, and also "at any step". Ask the PO.
    Given I am logged in as a newly registered candidate
    When I open onboarding Steps 1 and 4
    Then the presence of "Save and Finish Later" on each should be recorded for the PO

  # =============================================================================================
  # 8. Step 4 - initial state, reveal and switching direction
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Step 4 lands with only the three direction cards and Finish disabled
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    Then the heading should read "Let's map out your career interests"
    And the subtext should read "Choose a direction, then pick 3 roles you'd like to work towards."
    And these direction cards should be displayed with none selected:
      | card                          | description                                                                |
      | Stick to my degree            | All 3 career paths matched to your <major A> major.                        |
      | My degree, plus something new | 2 career paths matched to your <major A> major, 1 from another field.      |
      | Explore something new         | All 3 career paths from one other field.                                   |
    And the "Which career paths interest you most?" section should not be displayed
    And no priority slots should be displayed
    And no Career Path dropdown should be displayed
    And the "Finish" button should be disabled

  @positive @provision
  Scenario Outline: Verify that selecting a direction reveals the matching career path section
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    When I select the "<direction>" direction
    Then the section "Which career paths interest you most?" should appear below the cards
    And its subtext should read "Choose up to 3, in order of priority. The career paths below are related to your selected area of interest."
    And the "1st choice", "2nd choice" and "3rd choice" slots should be displayed empty
    And the degree block should be <degree block>
    And the "Another Field" block should be <another field block>

    Examples:
      | direction                     | degree block                 | another field block           |
      | Stick to my degree            | shown, up to 3 selections    | not shown                     |
      | My degree, plus something new | shown, up to 2 selections    | shown, 1 selection            |
      | Explore something new         | not shown                    | shown, up to 3 selections     |

  @positive @provision
  Scenario: Verify that each empty slot shows a dashed border, a drag handle and its placeholder
    Given I am on onboarding Step 4 with the "Stick to my degree" direction selected
    Then each empty slot should have a dashed border, a drag handle and the placeholder "Add a career path from below"

  @edge-case @provision
  Scenario: Verify that only one direction card can be selected at a time
    Given I am on onboarding Step 4 as a new candidate
    When I select "Stick to my degree" and then "Explore something new"
    Then only "Explore something new" should be selected

  @positive @provision
  Scenario: Verify that switching direction updates the section below to the new selection
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    When I switch between the directions, the section below should match each one:
      | direction                     | degree block | another field block |
      | Stick to my degree            | shown        | not shown           |
      | My degree, plus something new | shown        | shown               |
      | Explore something new         | not shown    | shown               |
      | Stick to my degree            | shown        | not shown           |

  @needs-clarification @provision
  Scenario: Verify what happens to selected career paths when the direction is switched
    # The requirement says the section "updates to match"; it does not say whether selections that
    # still fit the new direction are kept. Recorded for the PO, then asserted once answered.
    Given I am on onboarding Step 4 with "Stick to my degree" and 3 degree career paths selected
    When I switch to "My degree, plus something new"
    Then no more than 2 degree career paths should remain selected
    And the selections kept or cleared should be recorded for the PO
    When I switch to "Explore something new"
    Then no degree career path should remain in the slots

  # =============================================================================================
  # 9. Option 1 - Stick to my degree
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Option 1 lists only career paths mapped to the candidate's major
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    When I select the "Stick to my degree" direction
    Then the section heading should read "Career paths for your <major A> major"
    And the helper line should read "Based on the major you added in your education." followed by a "Change major" link
    And the "Career Path" dropdown should show the placeholder "Select Career Path"
    And its options should be exactly the career paths mapped to "<major A>"

  @positive @provision
  Scenario: Verify that Option 1 allows three career paths, ranks them and shows them as chips
    Given I am on onboarding Step 4 with the "Stick to my degree" direction selected
    When I select career paths "A", "B" and "C" in that order
    Then they should be shown as chips with an X to remove each
    And the slots should read:
      | slot       | career path |
      | 1st choice | A           |
      | 2nd choice | B           |
      | 3rd choice | C           |
    And each filled slot should have a solid blue border and its slot label
    And the remaining dropdown options should be disabled
    And the "Finish" button should be enabled

  @negative @provision
  Scenario: Verify that Option 1 never accepts a fourth career path
    Given I am on onboarding Step 4 with "Stick to my degree" and 3 career paths selected
    When I try to select a fourth career path by mouse and by keyboard
    Then only 3 career paths should be selected
    And the slots should be unchanged

  @edge-case @provision
  Scenario: Verify that Option 1 with fewer than three career paths is handled per "up to 3"
    # Requirement says "Choose up to 3" in the slots and "pick 3 roles" in the subtext.
    Given I am on onboarding Step 4 with the "Stick to my degree" direction selected
    When I select 1 career path
    Then whether "Finish" is enabled should be recorded for the PO
    When I select 0 career paths
    Then the "Finish" button should be disabled

  @edge-case @provision
  Scenario: Verify that a major with fewer than three mapped career paths still lets the candidate proceed
    Given the candidate's major has fewer than 3 career paths configured
    And I am on onboarding Step 4 with the "Stick to my degree" direction selected
    Then every mapped career path should be selectable
    And the outcome for Finish should be recorded for the PO

  # =============================================================================================
  # 10. Option 2 - My degree, plus something new
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Option 2 shows a degree block limited to two and an Another Field block
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    When I select the "My degree, plus something new" direction
    Then the degree block should show the heading "Career paths for your <major A> major", the helper line and a "Change major" link
    And the degree "Career Path" dropdown should allow at most 2 selections
    And the "Another Field" block should show an "Area of Interest" dropdown with the placeholder "Select Area of Interest"
    And its "Career Path" dropdown should show the placeholder "Select Career Path" and be disabled

  @positive @provision
  Scenario: Verify that the Area of Interest list excludes the candidate's own degree field
    Given I am on onboarding Step 4 with "My degree, plus something new" selected and major "<major A>"
    When I open the "Area of Interest" dropdown
    Then "<major A>"'s field should not be listed
    And every other configured area should be listed

  @positive @provision
  Scenario: Verify that choosing an Area of Interest enables a single-select list of that area's paths
    Given I am on onboarding Step 4 with "My degree, plus something new" selected
    When I choose "<other area>" as the Area of Interest
    Then the "Another Field" Career Path dropdown should be enabled
    And its options should be exactly the career paths of "<other area>"
    And it should allow only 1 selection

  @positive @provision
  Scenario: Verify that Option 2 fills the slots with 2 degree paths and 1 from another field
    Given I am on onboarding Step 4 with "My degree, plus something new" selected
    When I select degree paths "A" and "B" and then "X" from "<other area>"
    Then the slots should read "1st choice" A, "2nd choice" B and "3rd choice" X
    And the "Finish" button should be enabled

  @edge-case @provision
  Scenario: Verify that rank follows selection order across both blocks in Option 2
    Given I am on onboarding Step 4 with "My degree, plus something new" selected
    When I select "X" from "<other area>" first and then degree paths "A" and "B"
    Then the slots should read "1st choice" X, "2nd choice" A and "3rd choice" B

  @negative @provision
  Scenario: Verify that Option 2 refuses a third degree path and a second another-field path
    Given I am on onboarding Step 4 with "My degree, plus something new" selected
    When I select 2 degree paths
    Then the remaining degree options should be disabled
    When I select 1 path from "<other area>"
    Then no second another-field path can be selected
    And no more than 3 career paths should be selected in total

  @negative @provision
  Scenario: Verify that Option 2 cannot be finished without exactly one path from another field
    Given I am on onboarding Step 4 with "My degree, plus something new" selected
    When I select 2 degree paths and no Area of Interest
    Then the "Finish" button should be disabled
    When I choose an Area of Interest but no career path from it
    Then the "Finish" button should be disabled

  @edge-case @provision
  Scenario: Verify that changing the Area of Interest in Option 2 clears its career path
    Given I am on onboarding Step 4 with "My degree, plus something new", 2 degree paths and "X" from "<other area>"
    When I change the Area of Interest to a different area
    Then "X" should be cleared from its slot
    And the 2 degree paths should remain selected
    And the Career Path dropdown should list the new area's paths

  # =============================================================================================
  # 11. Option 3 - Explore something new
  # =============================================================================================

  @positive @provision
  Scenario: Verify that Option 3 shows only the Another Field block with a multi-select of up to three
    Given I am on onboarding Step 4 as a new candidate with major "<major A>"
    When I select the "Explore something new" direction
    Then no degree block and no "Change major" link should be displayed
    And the "Another Field" block should show the "Area of Interest" dropdown
    And its "Career Path" dropdown should be disabled
    When I choose "<other area>" as the Area of Interest
    Then the Career Path dropdown should be enabled with "<other area>"'s career paths
    And it should allow up to 3 selections

  @positive @provision
  Scenario: Verify that Option 3 fills all three slots from one other field
    Given I am on onboarding Step 4 with "Explore something new" and "<other area>" chosen
    When I select career paths "X", "Y" and "Z"
    Then the slots should read "1st choice" X, "2nd choice" Y and "3rd choice" Z
    And the remaining options should be disabled
    And the "Finish" button should be enabled

  @negative @provision
  Scenario: Verify that changing the Area of Interest in Option 3 clears every selected path
    Given I am on onboarding Step 4 with "Explore something new" and 3 paths selected from "<other area>"
    When I change the Area of Interest to a different area
    Then every slot should be empty
    And the Career Path dropdown should list the new area's paths with nothing selected
    And the "Finish" button should be disabled

  @needs-clarification @provision
  Scenario: Verify whether Option 3 offers the candidate's own degree field as an Area of Interest
    # The exclusion is stated for Option 2 only. Recorded for the PO.
    Given I am on onboarding Step 4 with "Explore something new" selected and major "<major A>"
    When I open the "Area of Interest" dropdown
    Then whether "<major A>"'s field is listed should be recorded for the PO

  # =============================================================================================
  # 12. Priority slots - remove, reorder, truncation
  # =============================================================================================

  @positive @provision
  Scenario: Verify that removing a selection frees its slot and the rest move up
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I remove "A" using its chip's X
    Then the slots should read "1st choice" B, "2nd choice" C and an empty "3rd choice"
    And "A" should be selectable again in the dropdown
    When I select "D"
    Then "D" should fill the "3rd choice" slot

  @positive @provision
  Scenario: Verify that dragging a slot reorders the ranks while the labels stay fixed
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I drag the handle of "C" to the "1st choice" position
    Then the slots should read "1st choice" C, "2nd choice" A and "3rd choice" B
    And the slot labels should not have moved

  @positive @provision
  Scenario: Verify that the slots can be reordered with the keyboard alone
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I focus the drag handle of "C" with the keyboard and move it up twice
    Then the slots should read "1st choice" C, "2nd choice" A and "3rd choice" B
    And the new order should be announced to assistive technology

  @edge-case @provision
  Scenario: Verify that dragging a slot onto itself or outside the list changes nothing
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I drag "B" and drop it back on its own slot
    Then the order should be A, B, C
    When I drag "B" and drop it outside the slots
    Then the order should be A, B, C

  @edge-case @provision
  Scenario: Verify that a long career path name is truncated and shown in full on hover and tap
    Given a career path with a very long name is available to the candidate
    And I am on onboarding Step 4 with that career path selected
    Then its slot should show the name truncated with an ellipsis on one line
    When I hover over the slot
    Then the full name should be displayed
    When I tap the slot on a touch device
    Then the full name should be displayed

  @edge-case @provision
  Scenario: Verify that the final order, not the selection order, is what gets saved
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I reorder them to C, A, B and finish onboarding
    Then the saved career paths should be C as priority 1, A as priority 2 and B as priority 3

  # =============================================================================================
  # 13. Change major
  # =============================================================================================

  @positive @provision
  Scenario Outline: Verify that "Change major" is shown only for directions that use the major
    Given I am on onboarding Step 4 as a new candidate
    When I select the "<direction>" direction
    Then the "Change major" link should be <shown>

    Examples:
      | direction                     | shown     |
      | Stick to my degree            | shown     |
      | My degree, plus something new | shown     |
      | Explore something new         | not shown |

  @positive @provision
  Scenario: Verify that "Change major" returns to Step 2 with all data kept
    Given I am on onboarding Step 4 with "Stick to my degree" and paths selected
    When I click "Change major"
    Then I should be on onboarding Step 2
    And every education entry should still hold its saved values and transcript

  @positive @provision
  Scenario: Verify that a changed major reloads the degree paths and clears only the old degree selections
    Given I am on onboarding Step 4 with "My degree, plus something new", degree paths A and B from "<major A>" and "X" from "<other area>"
    When I click "Change major", change the major to "<major B>" and continue to Step 4
    Then the "My degree, plus something new" direction should still be selected
    And the degree heading should read "Career paths for your <major B> major"
    And the degree Career Path dropdown should list the career paths mapped to "<major B>"
    And A and B should be cleared and their slots emptied
    And "X" should still be selected from "<other area>"
    And Step 1 and Step 3 data should be unchanged

  @positive @provision
  Scenario: Verify that returning from "Change major" without changing it clears nothing
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I click "Change major", leave the major unchanged and continue to Step 4
    Then the slots should still read A, B and C in the same order
    And the "Stick to my degree" direction should still be selected

  @edge-case @provision
  Scenario: Verify that changing the major to one the Area of Interest already uses is handled
    Given I am on onboarding Step 4 with "My degree, plus something new" and "<other area>" chosen
    When I change my major to the field of "<other area>" and return to Step 4
    Then the Area of Interest list should exclude the new major's field
    And the conflicting Area of Interest selection should be handled and recorded for the PO

  @edge-case @provision
  Scenario: Verify that changing a major then changing it back still clears the old degree paths
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C from "<major A>"
    When I change the major to "<major B>", return to Step 4, then change it back to "<major A>" and return
    Then the degree Career Path dropdown should list "<major A>"'s paths
    And the slot state should be recorded for the PO

  @edge-case @provision
  Scenario: Verify which education entry's major drives Step 4 when there are several
    Given I have two education entries with different majors
    When I reach onboarding Step 4 and select "Stick to my degree"
    Then the major used should be recorded for the PO

  # =============================================================================================
  # 14. Finish and the confirmation modal
  # =============================================================================================

  @negative @provision
  Scenario: Verify that Finish does not open the modal while the screen is invalid
    Given I am on onboarding Step 4 as a new candidate
    When I select "My degree, plus something new" and only 1 degree path
    Then the "Finish" button should be disabled
    And forcing a click on "Finish" should not open the confirmation modal

  @positive @provision
  Scenario Outline: Verify that the confirmation modal summarises the chosen direction and paths
    Given I am on onboarding Step 4 with a valid "<direction>" selection
    When I click "Finish"
    Then the modal title should read "Finish Onboarding with these answers?" with an X in the top right
    And the body should read "Your psychometric test will be built around the career direction and career paths you chose. You can still edit them until you start the test."
    And "Career Direction" should read "<direction>"
    And "Area of Interest" should be <area of interest>
    And "Career Path, in order of priority" should show the selected paths as chips numbered 1, 2, 3 in slot order
    And the buttons "Keep Editing" (secondary) and "Finish Onboarding" (primary) should be displayed

    Examples:
      | direction                     | area of interest                |
      | Stick to my degree            | not shown                       |
      | My degree, plus something new | shown with the chosen area      |
      | Explore something new         | shown with the chosen area      |

  @positive @provision
  Scenario: Verify that the modal reflects a reordered priority
    Given I am on onboarding Step 4 with "Stick to my degree" and paths A, B and C selected
    When I reorder them to B, C, A and click "Finish"
    Then the modal chips should read 1 B, 2 C, 3 A

  @positive @provision
  Scenario Outline: Verify that Keep Editing and the X return to Step 4 with everything intact
    Given I have the confirmation modal open after a valid Step 4 selection
    When I close the modal with <control>
    Then the modal should close
    And I should be on onboarding Step 4 with the same direction, area and paths in the same order
    And onboarding should not be completed

    Examples:
      | control        |
      | Keep Editing   |
      | the X          |

  @edge-case @provision
  Scenario: Verify that Escape and an outside click on the modal are handled
    Given I have the confirmation modal open after a valid Step 4 selection
    When I press Escape
    Then the outcome should be recorded and onboarding should not be completed
    When I reopen the modal and click outside it
    Then the outcome should be recorded and onboarding should not be completed

  @positive @provision
  Scenario: Verify that Finish Onboarding saves all four steps and returns to Getting Started
    Given I have completed Steps 1 to 3 and have the confirmation modal open
    When I click "Finish Onboarding"
    Then I should be redirected to the Getting Started page
    And Step 2 should show as "Onboarding Completed"
    And the candidate profile should hold the Step 1 answer, every education and experience entry, the direction, the area of interest and the career paths in priority order

  @negative @provision
  Scenario: Verify that double-clicking Finish Onboarding completes onboarding only once
    Given I have the confirmation modal open after a valid Step 4 selection
    When I double-click "Finish Onboarding"
    Then only one completion request should be sent
    And I should be redirected to the Getting Started page once

  @negative @provision
  Scenario: Verify that a failed Finish Onboarding keeps the candidate's answers and reports the error
    Given I have the confirmation modal open after a valid Step 4 selection
    And the onboarding completion request will fail
    When I click "Finish Onboarding"
    Then an error should be displayed
    And onboarding should not be marked complete
    And my Step 4 answers should still be on screen

  # =============================================================================================
  # 15. Editing after completion, and access rules
  # =============================================================================================

  @positive @provision
  Scenario: Verify that the candidate can edit direction and career paths before starting the test
    Given I have finished onboarding but not started the test
    When I reopen my career direction and career paths
    And I change the direction and paths and save
    Then the new direction and paths should be saved in their priority order

  @negative @mocked
  Scenario: Verify that direction and career paths cannot be edited once the test has started
    Given I have finished onboarding and the test is reported as started
    When I try to edit my career direction and career paths
    Then no edit should be possible

  @not-automatable
  Scenario: Verify that the real start of the psychometric test locks the career choices
    Given I have finished onboarding
    When I start the psychometric test for real
    Then my direction and career paths should no longer be editable

  @negative
  Scenario: Verify that the onboarding form requires a signed-in candidate
    Given I am not logged in
    When I open the onboarding form URL directly
    Then I should be redirected to the login page

  @negative @provision
  Scenario: Verify that a later step cannot be opened by URL before earlier required steps are complete
    Given I am logged in as a newly registered candidate who has not completed Step 1
    When I open onboarding Step 4 directly by URL
    Then I should be shown Step 1 or the earliest incomplete step
    And no Step 4 data should be saveable

  @edge-case @provision
  Scenario: Verify that a reload on any step keeps the candidate on that step with saved data
    Given I am on onboarding Step 3 with Steps 1 and 2 completed
    When I reload the page
    Then I should be on onboarding Step 3 or the step recorded by the last save
    And no saved data should be lost

  @edge-case @provision
  Scenario: Verify that a long first name in the Step 1 greeting does not break the layout
    Given I am logged in as a newly registered candidate with a 40-character hyphenated first name
    When I open onboarding Step 1
    Then the heading should read "Hello, {First name}!" in full without overlapping the cards

  @edge-case @provision
  Scenario: Verify that every onboarding step is operable with the keyboard alone
    Given I am logged in as a newly registered candidate
    When I complete Steps 1 to 4 and the confirmation modal using only the keyboard
    Then onboarding should be completed

  # =============================================================================================
  # 16. End to end
  # =============================================================================================

  @positive @provision
  Scenario: Verify that a student completes onboarding end to end with "Stick to my degree"
    Given I have signed up and verified a new candidate account
    And I am on the Getting Started page
    When I start onboarding and select "Student"
    And I add one education entry with a future graduation date and a PDF transcript
    And I skip the experience step with every field blank
    And I select "Stick to my degree" and three career paths from my major
    And I click "Finish" and confirm with "Finish Onboarding"
    Then I should be on the Getting Started page with Step 2 completed and Step 3 active
    And my profile should hold every answer I gave

  @positive @provision
  Scenario: Verify that a graduate completes onboarding with "My degree, plus something new" after a save and resume
    Given I have signed up and verified a new candidate account
    When I start onboarding, select "Graduate" and add two education entries with past graduation dates
    And I add one experience with "I currently work here" checked and an experience letter
    And I click "Save and Finish Later" on Step 3
    Then the Getting Started button should read "Continue Onboarding"
    When I click "Continue Onboarding"
    Then Step 3 should reopen with my experience pre-filled
    When I continue to Step 4, select "My degree, plus something new", 2 degree paths and 1 path from another area
    And I reorder the slots by dragging and click "Finish"
    Then the modal should show the direction, the area of interest and the paths in the new order
    When I click "Keep Editing" and then "Finish" again and confirm with "Finish Onboarding"
    Then onboarding should be complete with every answer saved

  @positive @provision
  Scenario: Verify that a candidate changes major mid-way and completes onboarding with "Explore something new"
    Given I have signed up and verified a new candidate account
    When I complete Steps 1 to 3 and select "My degree, plus something new" with paths from "<major A>" and "<other area>"
    And I use "Change major" to switch to "<major B>" and return to Step 4
    Then the old degree paths should be cleared and the another-field path kept
    When I switch to "Explore something new", choose an Area of Interest and three paths
    And I finish and confirm onboarding
    Then the saved direction should be "Explore something new" with the three paths in priority order
    And Steps 1 and 3 should hold their original answers and Step 2 the major "<major B>"
