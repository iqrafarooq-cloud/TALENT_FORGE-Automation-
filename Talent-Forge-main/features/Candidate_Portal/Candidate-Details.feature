@candidate-details
Feature: Candidate Portal - Profile > Candidate Details

  Background:
    Given I am logged in as the Candidate Details candidate
    And I am on the Candidate Details tab
  # ------------------------------------------------------------------------------------------
  # 1. THE PAGE ITSELF
  # ------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the Candidate Details tab renders its documented contract
    Then the profile header should be displayed
    And the profile tab strip should offer exactly:
      | tab               |
      | Candidate Details |
      | Documents         |
      | Subscription      |
      | Activity Log      |
    And the Candidate Details tab should be the selected tab
    And the Candidate Details page should render exactly these sections, in order:
      | section                         | add | edit |
      | Basic Information               | no  | yes  |
      | Education                       | yes | yes  |
      | Work Experience                 | yes | yes  |
      | Certifications                  | yes | yes  |
      | Work Preferences & Availability | no  | yes  |
      | Desired Roles                   | no  | yes  |

  @positive
  Scenario: Verify that every section renders the value the profile payload actually holds
    Then each of these fields should render the value its payload field holds:
      | section                         | label                      | payload field                  |
      | Basic Information               | Email                      | user.email                     |
      | Basic Information               | Phone Number               | user.phone_number              |
      | Basic Information               | Nationality                | user.nationality               |
      | Basic Information               | Current Status             | qualification                  |
      | Basic Information               | About Me                   | about_me                       |
      | Work Preferences & Availability | Current City               | current_location.location_name |
      | Work Preferences & Availability | Open to Relocation         | interested_in_relocation       |
      | Work Preferences & Availability | Preferred Work Location(s) | preferred_locations            |
    And the profile header should name the candidate the payload names
    And the verification badge should agree with the payload
    And every Education, Work Experience and Certification entry should match its payload entry

  @edge-case
  Scenario: Verify that an unset field and an uncomputed statistic render their own distinct placeholders
    Then every unset Basic Information field should render "-"
    And an empty Preferred Work Location(s) list should render "-"
    And every profile statistic should render a figure or the placeholder "—"
    And the statistic placeholder should not be the same string as the empty-field placeholder

  @positive
  Scenario: Verify that each tab writes its own URL and can be opened directly from it
    Then selecting each tab should put its own value in the URL:
      | tab               | selectedTab       |
      | Documents         | documents         |
      | Subscription      | subscription      |
      | Activity Log      | activity-log      |
      | Candidate Details | candidate-details |
    And opening each of those URLs directly should select that same tab

  @negative @edge-case @known-issue
  Scenario: Verify that an unrecognised tab value falls back to a tab rather than selecting none
    When I open the profile with no tab value at all
    Then the Candidate Details tab should be the selected tab
    When I open the profile with the tab value "not-a-tab"
    Then some tab should be selected
  # ------------------------------------------------------------------------------------------
  # 2. BASIC INFORMATION - the contract, the gate and the validation
  # ------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that the Basic Information form renders its documented contract with Email locked
    When I open the "Basic Information" edit form
    Then the modal should be titled "Basic Information"
    And the Basic Information form should offer exactly these fields:
      | field       | control  | required | editable |
      | First Name  | text     | yes      | yes      |
      | Last Name   | text     | yes      | yes      |
      | Email       | email    | yes      | no       |
      | Phone       | tel      | no       | yes      |
      | Nationality | combobox | no       | yes      |
      | Bio         | text     | yes      | yes      |
      | About Me    | textarea | yes      | yes      |
    And the Basic Information form should offer a profile photo control
    And the Save button should be disabled

  @positive @negative
  Scenario: Verify that Save is gated by a changed, valid form and by nothing less
    When I open the "Basic Information" edit form
    Then the Save button should be disabled
    When I change "First Name" to "Gated"
    Then the Save button should be enabled
    When I change "First Name" back to its original value
    Then the Save button should be disabled

  @negative @known-issue
  Scenario: Verify that clearing any required field explains itself and re-gates Save
    When I open the "Basic Information" edit form
    Then clearing each required field should raise its own inline error and disable Save:
      | field      |
      | First Name |
      | Last Name  |
      | Bio        |
      | About Me   |

  @negative @known-issue
  Scenario: Verify that whitespace does not satisfy a required field
    When I open the "Basic Information" edit form
    Then a whitespace-only value should be refused for each required field:
      | field      |
      | First Name |
      | Last Name  |

  @edge-case
  Scenario: Verify that Cancel discards the draft and changes nothing
    When I open the "Basic Information" edit form
    And I change "Bio" to "This draft must never be saved"
    And I close the form with "cancel"
    Then no profile request should have been sent
    When I open the "Basic Information" edit form
    Then "Bio" should hold its original value
    And the Save button should be disabled

  @edge-case
  Scenario: Verify that every dismissal route closes the form and sends nothing
    Then each of these dismissal routes should close the form without sending anything:
      | route  |
      | cancel |
      | x      |
      | escape |

  @edge-case @needs-clarification
  Scenario: Verify what the phone number field accepts
    When I open the "Basic Information" edit form
    Then the phone field should handle each of these inputs:
      | typed    | note                           |
      | abcdefgh | letters should not be accepted |
      |        1 | a one-digit number             |
  # ------------------------------------------------------------------------------------------
  # 3. THE THREE LIST SECTIONS - add forms and manage lists
  # ------------------------------------------------------------------------------------------

  @positive
  Scenario: Verify that each Add form renders the contract its section needs
    Then each Add form should render its documented contract:
      | section         | title             | required fields                                     |
      | Education       | Add Education     | University/Institution Name, Degree, Field of Study |
      | Work Experience | Add Experience    | Company Name, Role/Job Title                        |
      | Certifications  | Add Certification | Certificate Name, Issuing Organization              |
    And every Add form should open with its Save button disabled
    And every Add form should offer a document upload accepting ".pdf,.jpg,.jpeg,.png"

  @positive
  Scenario: Verify that each manage list lists every entry with its own edit and delete controls
    Then each manage list should list exactly the entries the payload holds:
      | section         |
      | Education       |
      | Work Experience |
      | Certifications  |
    And every listed entry should offer its own edit and delete control
    And every manage list should offer a control for adding another entry

  @negative @known-issue
  Scenario: Verify that the manage list labels an employment type the way the section does
    Then the Work Experience manage list should render each entry's employment type as a label, not an enum

  @negative @needs-clarification
  Scenario: Verify that the upload control advertises only the formats the server will accept
    Then the formats each Add form advertises should be the formats the document endpoint accepts

  @negative @known-issue
  Scenario: Verify that the per-entry controls in a manage list are reachable by assistive technology
    When I open the "Certifications" edit form
    Then every per-entry control in the manage list should be reachable by assistive technology

  @negative @known-issue
  Scenario: Verify that a manage list modal's close control is reachable by assistive technology
    When I open the "Certifications" edit form
    Then the modal close control should be reachable by assistive technology

  @edge-case @needs-clarification
  Scenario: Verify what the Candidate Details tab tells a candidate about an attachment's verification
    Then each attachment listed should be reported alongside the status its document actually holds
  # ------------------------------------------------------------------------------------------
  # 6. SAVING FOR REAL - @mutates-profile, excluded from the default run
  # ------------------------------------------------------------------------------------------

  @positive @mutates-profile
  Scenario: Verify that editing Basic Information saves, confirms and survives a reload
    When I open the "Basic Information" edit form
    And I change "Bio" to a uniquely marked value
    And I save the form
    Then the save should be accepted by the server
    And a save confirmation should be displayed
    And the form should close
    When I reload the Candidate Details tab
    Then "headline" in the payload should hold that marked value
    And the profile header should render that marked value

  @positive @mutates-profile
  Scenario: Verify that a Work Preferences change saves and survives a reload
    When I open the "Work Preferences & Availability" edit form
    And I switch "Open to Relocation" to the other answer
    And I save the form
    Then the save should be accepted by the server
    And a save confirmation should be displayed
    When I reload the Candidate Details tab
    Then "interested_in_relocation" in the payload should have changed
    And the "Work Preferences & Availability" section should render the new answer

  @positive @mutates-profile @end-to-end
  Scenario: Verify that a certification can be added with a document, listed, edited and deleted
    When I add a certification with a document attached
    Then the entry should be accepted by the server
    And a save confirmation should be displayed
    And that certification should be listed in the Certifications section
    And the created entry should carry the document that was attached
    When I open the "Certifications" edit form
    Then that certification should be listed in the manage list
    When I delete that certification
    Then I should be asked to confirm before anything is deleted
    When I confirm the deletion
    Then the deletion should be accepted by the server
    And that certification should no longer be listed
    And the document it carried should have been deleted with it

  @positive @mutates-profile @end-to-end
  Scenario: Verify that an education entry can be added end to end and removed again
    When I add an education entry
    Then the entry should be accepted by the server
    And that education entry should be listed in the Education section
    When I remove the education entry I added
    Then that education entry should no longer be listed

  @edge-case @mutates-profile
  Scenario: Verify that cancelling the delete confirmation deletes nothing
    When I add a certification without a document
    And I open the "Certifications" edit form
    And I delete that certification
    And I cancel the deletion
    Then no delete request should have been sent
    And that certification should still be listed
    When I remove that certification
    Then that certification should no longer be listed
