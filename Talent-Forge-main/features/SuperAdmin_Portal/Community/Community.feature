@community @community-admin
Feature: Super Admin — University Communities

  Background:
    Given I am logged in as the superadmin
    And I am on the Community main page
  # 2. CREATE COMMUNITY — FIELDS AND DROPDOWNS 

  @positive
  Scenario: Verify that the Create Community form shows every field with the right requiredness and placeholder
    When I open the Create Community page
    Then the Create Community form should show the following fields:
      | field                     | requiredness | placeholder must refer to           |
      | Cover Photo               | required     | cover photo                         |
      | Profile Photo             | required     | logo or profile photo               |
      | University/Institute Name | required     | university or institute             |
      | Location                  | required     | location or city or Riyadh or Saudi |
      | About University          | optional     | the community or a welcome          |
    And the upload hint should state the accepted formats and the size limit
    And the form should identify the community by its university
    And the form should offer no community type other than university

  # @real-universities: runs on the server's own list, never on the stand-in universities that
  # steps/community-pages.js offers while DEV has none left (see the note there). With none left
  # the dropdown must say "No institutions available for assignment." and offer nothing.
  @positive @real-universities
  Scenario: Verify that University/Institute Name excludes universities that already have a community
    Given I have noted the university of an existing community
    When I open the Create Community page
    And I open the community university dropdown
    Then every listed university should be one without an active community
    When I search the university dropdown for that community's university
    Then no university option should be offered

  @positive
  Scenario: Verify that University/Institute Name is single-select
    When I open the Create Community page
    And I select the first available university
    And I select a different available university
    Then only the second university should be selected

  @positive
  Scenario: Verify that Location offers every configured location and accepts only one
    When I open the Create Community page
    And I open the community location dropdown
    Then the "Location" dropdown should offer every location named in the AC
    And any location offered beyond the AC list should be reported
    When I select the location "Riyadh"
    And I select the location "Jeddah"
    Then the "Location" field should hold "Jeddah"
    And the "Location" field should not hold "Riyadh"

  @edge-case
  Scenario: Verify that About University is optional, multi-line and silently capped at 300 characters
    When I open the Create Community page
    And I fill every required field with valid details
    And I leave "About University" empty
    Then the About University field should be empty
    Then no validation error should be shown for "About University"
    And the community Save button should be enabled
    When I type a three-line description into "About University"
    Then the About University field should hold three lines
    When I type 301 characters into "About University"
    Then the About University field should hold exactly 300 characters
    When I paste 400 characters into "About University"
    Then the About University field should hold exactly 300 characters
    And no validation error should be shown for "About University"
    And the community Save button should be enabled
  # 3. CREATE COMMUNITY — IMAGE UPLOADS

  @positive
  Scenario: Verify that both image fields accept JPG and PNG by picker and by drag-and-drop
    When I open the Create Community page
    Then each image field should accept only JPG and PNG file types
    When I upload the following images:
      | field         | format | size MB | method        |
      | Cover Photo   | JPG    |       8 | picker        |
      | Cover Photo   | PNG    |       5 | drag and drop |
      | Profile Photo | PNG    |       6 | picker        |
      | Profile Photo | JPG    |       8 | drag and drop |
    Then a preview should be displayed for every uploaded image
    And no validation error should be displayed for either image field

  @negative
  Scenario: Verify that both image fields reject unsupported formats and oversized files with the message the build shows
    When I open the Create Community page
    And I upload the following images:
      | field         | format | size MB | method | expected error                           |
      | Cover Photo   | GIF    |       1 | picker | Cover must be a JPG or PNG image.        |
      | Cover Photo   | PDF    |       1 | picker | Cover must be a JPG or PNG image.        |
      | Cover Photo   | DOCX   |       1 | picker | Cover must be a JPG or PNG image.        |
      | Profile Photo | SVG    |       1 | picker | Logo must be a JPG or PNG image.         |
      | Profile Photo | WEBP   |       1 | picker | Logo must be a JPG or PNG image.         |
      | Cover Photo   | JPG    |      11 | picker | File is too large. Maximum size is 10MB. |
      | Cover Photo   | PNG    |      25 | picker | File is too large. Maximum size is 10MB. |
      | Profile Photo | JPG    |      11 | picker | File is too large. Maximum size is 10MB. |
    Then each rejected upload should show its expected error as a toast
    And no preview should be displayed for any rejected image
    And the community Save button should be disabled

  @edge-case
  Scenario: Verify that an image of exactly 10 MB is accepted, being the stated maximum
    When I open the Create Community page
    And I upload the following images:
      | field         | format | size MB | method |
      | Cover Photo   | JPG    |      10 | picker |
      | Profile Photo | PNG    |      10 | picker |
    Then each upload should have sent exactly 10485760 bytes
    And a preview should be displayed for every uploaded image
    And no validation error should be displayed for either image field

  @edge-case
  Scenario: Verify that an uploaded image can be replaced and removed, with a pointer cursor on both controls
    When I open the Create Community page
    And I upload the following images:
      | field         | format | size MB | method |
      | Cover Photo   | JPG    |       8 | picker |
      | Profile Photo | JPG    |       8 | picker |
    Then each image field's edit and remove controls should be visible with a pointer cursor
    When I replace each uploaded image with a different valid image
    Then each preview should show the replacement image
    When I remove the "Cover Photo" image
    Then no preview should be displayed for "Cover Photo"
    And the community Save button should be disabled
  # ============================================================================
  # 4. CREATE COMMUNITY — VALIDATION AND SAVE GATING (AC 3.2, AC 11)

  @positive
  Scenario: Verify that Save is disabled on a fresh form and enables only when every required field is valid
    When I open the Create Community page
    Then the community Save button should be disabled
    When I fill the required fields one at a time:
      | field                     |
      | Cover Photo               |
      | Profile Photo             |
      | University/Institute Name |
      | Location                  |
    Then the "Save" button should have stayed disabled until the last field was filled
    And the community Save button should be enabled

  @negative
  Scenario: Verify that clearing any required field shows its exact inline error and re-gates Save
    When I open the Create Community page
    And I fill every required field with valid details
    Then the "Save" button should be enabled
    When I clear each required field in turn and read its error:
      | field                     | expected error                         |
      | Cover Photo               | Cover photo is required.               |
      | Profile Photo             | Profile photo is required.             |
      | University/Institute Name | University/Institute name is required. |
      | Location                  | Location is required.                  |
    Then each cleared field should have shown its expected error inline, not as a toast
    And the "Save" button should be disabled after each field was cleared

  @positive @edge-case @creates-community
  Scenario: Verify that double-clicking Save creates exactly one community, shows the complete success modal, and Create New Community reopens an empty form
    When I open the Create Community page
    And I fill every required field with valid details
    And I double-click the Save button
    Then the community success modal "Community created successfully!" should be displayed
    And the community success modal should display "You can now view your community directory or continue building your communities."
    And the community success modal should not mention an agent
    And the community success modal should offer the CTAs "Create New Community" and "Go to Community"
    When I click "Create New Community" in the community success modal
    Then I should be on the Create Community page
    And every Create Community field should be empty
    And no preview should be displayed for either image field
    And the "Save" button should be disabled
    When I search the communities for that university
    Then exactly one community should be listed for that university
  # 6. COMMUNITY MAIN PAGE — CARDS AND SEARCH 

  @positive
  Scenario: Verify that every community card shows its five elements and the search uses the specified placeholder
    Then every community card should show the following elements:
      | element                  |
      | University Profile Photo |
      | University Name          |
      | Member Count             |
      | Edit Icon                |
      | View Community CTA       |
    And every community card member count should read as "X Members"
    And the community search placeholder should be "Search by university name"

  @positive
  Scenario: Verify that the community search is case-insensitive, partial and space-trimming, and matches only the university name
    Given I have noted the name and location of an existing community
    When I search the communities for each of the following:
      | variation of that community's name | rule                           |
      | the exact name                     | an exact name matches          |
      | the name in upper case             | search is case-insensitive     |
      | a fragment of the name             | partial matching is supported  |
      | the name padded with spaces        | surrounding spaces are trimmed |
    Then that community should be listed for every one of them
    When I search the communities for that community's location
    Then that community should not be listed
    Given I have noted a community that is not on the first page of the listing
    When I search the communities for that community's name
    Then that community should be listed

  @negative
  Scenario: Verify that a community search matching nothing shows the no-communities empty state and that clearing it restores the list
    When I search the communities for "zzzz-no-such-university"
    Then no community cards should be listed
    And the empty state heading "No communities found" should be displayed
    And the empty state should read exactly "No communities found"
    And no empty-state clear CTA should be offered
    When I clear the community search
    Then the community search field should be empty
    And all communities should be listed again

  @edge-case
  Scenario: Verify that the community search handles special characters safely and keeps the page usable
    When I search the communities for each of the following terms:
      | term                      |
      | %                         |
      | _                         |
      | '                         |
      | "                         |
      | <script>alert(1)</script> |
      | ' OR 1=1 --               |
      | 你好                      |
    Then no error should be displayed for any of them
    And no term should be reflected into the page as markup
    And the page should remain usable

  @positive @negative
  Scenario: Verify that the card's edit icon opens Edit Community pre-filled with exactly four editable fields, and that Save stays gated until a real change is made and reverted
    When I click the edit icon on the first community card
    Then I should be on the Edit Community page for that community
    And the form should be pre-filled with that community's details
    And the following fields should be editable:
      | field            |
      | Cover Photo      |
      | Profile Photo    |
      | Location         |
      | About University |
    And the university should not be changeable to a different university
    And the "Save" button should be disabled
    When I select the location it already holds
    Then the "Save" button should be disabled
    When I note the current location
    And I select a different location
    Then the "Save" button should be enabled
    When I select the original location again
    Then the "Save" button should be disabled

  @positive @mutates-community
  Scenario: Verify that editing a community saves each field, shows the success toast and survives a reload
    Given I have noted the current details of the first community
    When I open Edit Community for that community
    And I change the following fields:
      | field            |
      | Location         |
      | About University |
      | Cover Photo      |
      | Profile Photo    |
    And I click "Save"
    Then the community toast "Community updated successfully." should be displayed
    When I refresh the page
    And I reopen that community for editing
    Then every changed field should hold its new value

  @negative
  Scenario: Verify that Edit Community enforces the same validation rules as Create Community
    When I open Edit Community for the first community
    And I upload the following images:
      | field       | format | size MB | method |
      | Cover Photo | GIF    |       1 | picker |
    Then the upload should have been rejected
    When I upload the following images:
      | field       | format | size MB | method |
      | Cover Photo | JPG    |      11 | picker |
    Then the upload should have been rejected
    When I type 400 characters into "About University"
    Then the About University field should hold exactly 300 characters
    When I remove the "Cover Photo" image
    Then the community Save button should be disabled

  @positive
  Scenario: Verify that leaving Edit Community without saving discards the change
    When I open Edit Community for the first community
    And I change the about university to "Discard me."
    And I leave the page without saving
    And I reopen that community for editing
    Then the about university should not be "Discard me."
  # 8. UNIVERSITY COMMUNITY PAGE

  @positive
  Scenario: Verify that the community header shows its seven elements with this community's configured values
    Given I have noted the current details of the first community
    When I click "View Community" on the first community card
    Then I should be on the University Community page for that community
    And the community header should show the following elements:
      | element            |
      | Cover Photo        |
      | Profile Picture    |
      | University Name    |
      | About University   |
      | Member Count       |
      | Location           |
      | Edit Community CTA |
    And the header member count should read as "X Members"
    And the header should show that community's configured university name, location and description

  @negative
  Scenario: Verify that the member count agrees across the listing card, the header and the members listed
    Given I have noted the member count on the first community card
    When I open that community
    Then the header member count should equal the count on its listing card
    And the header member count should equal the number of candidate cards listed across every page

  @edge-case
  Scenario: Verify that a community saved without a description renders a clean header
    Given I have found a community with no About University text
    When I open that community
    Then the community header should show its university name
    And the community header should show its location
    And the header should not display a broken or placeholder description
  # 9. UNIVERSITY COMMUNITY PAGE — MEMBER SEARCH (AC 6.2)

  @positive
  Scenario: Verify that a member can be found by name regardless of case, partial input or surrounding spaces
    Given I am on a community that has at least 2 members
    And I have noted the name of the first member
    When I search the members for each of the following:
      | variation of that member's name | rule                           |
      | the exact name                  | an exact name matches          |
      | the name in upper case          | search is case-insensitive     |
      | a fragment of the name          | partial matching is supported  |
      | the name padded with spaces     | surrounding spaces are trimmed |
    Then that member should be listed for every one of them
    And every listed candidate card should match the search term

  @negative
  Scenario: Verify that the member search does not match a candidate's Major, which is not a searchable field
    Given I am on a community that has at least 1 member
    And I have noted the Major of a member who holds one
    When I search the members for that Major
    Then that member should not be listed
    When I clear the member search
    And I search the members for that member's name
    Then that member should be listed by name

  # FIXED by 2026-11-02 (the placeholder now reads "Search by candidate name..."): a regression lock.
  @negative
  Scenario: Verify that the member search placeholder offers a search by candidate name only
    Given I am on a community that has at least 1 member
    Then the member search placeholder should offer a search by candidate name only

  @negative
  Scenario: Verify that a member search matching nobody shows the search empty state, spaced correctly, and can be cleared
    Given I am on a community that has at least 1 member
    When I search the members for "zzzz-no-such-candidate"
    Then no candidate cards should be listed
    And the empty state heading "No results found" should be displayed
    And the empty state should display "We couldn't find any results matching your current search."
    And no empty-state clear CTA should be offered
    And the no-results message should have vertical spacing above and below it
    When I clear the member search
    Then all members should be listed again

  @negative
  Scenario: Verify that a filter matching nobody names the filters in its empty state and offers a CTA that clears the search too
    Given I am on a community that has at least 1 member
    And I have noted the number of candidate cards listed
    When I apply a filter combination that no member satisfies
    Then no candidate cards should be listed
    And the empty state heading "No results found" should be displayed
    And the empty state should display "We couldn't find any results matching your current filters."
    And a "Clear all filters" CTA should be offered
    When I search the members for "zzzz-no-such-candidate"
    Then the empty state should display "We couldn't find any results matching your current search and filters."
    When I click "Clear all filters"
    Then the member search field should be empty
    And no filter should be applied
    And all members should be listed again
    And the number of candidate cards listed should be back to the noted count
  # 10. UNIVERSITY COMMUNITY PAGE — FILTERS (AC 7)

  @positive
  Scenario: Verify that the three specified filters are offered, are multi-select, and carry the specified options
    Given I am on a community that has at least 1 member
    Then the following filters should be offered and allow multiple selections:
      | filter          |
      | Graduation Year |
      | Majors          |
      | Member Type     |
    When I open the "Graduation Year" filter
    Then the filter should offer every year from "2015" to "2032"
    And the filter should offer exactly 18 options
    When I open the "Member Type" filter
    Then the filter should offer exactly the options "Student" and "Alumni"
    When I open the "Majors" filter
    Then the filter should offer options sourced from the configured Field of Study list

  @positive
  Scenario: Verify that applying each filter on its own narrows the member list without erroring, offers Clear All every time, and that Clear All then restores the full list
    Given I am on a community that has at least 1 member
    And I have noted the number of candidate cards listed
    When I apply the first available option in each of the following filters in turn:
      | filter          |
      | Graduation Year |
      | Majors          |
      | Member Type     |
    Then no "Something went wrong" error should be displayed for any of them
    And every member list request should have succeeded
    And every listed candidate card should match the filter that was applied
    And a "Clear All" control should have been offered with a pointer cursor for every one of them
    When I click "Clear All"
    Then no filter should be applied
    And the number of candidate cards listed should be back to the noted count

  @positive
  Scenario: Verify that multiple filters and a search all apply together
    Given I am on a community that has at least 2 members
    When I select the first available option in the "Graduation Year" filter
    And I select the first available option in the "Majors" filter
    And I select "Student" in the "Member Type" filter
    Then every listed candidate card should match all three selected filters
    When I search the members for a fragment shared by several members
    Then every listed candidate card should match both the search and the filters


  @positive
  Scenario: Verify that the Majors filter's own search box narrows its options, matches case-insensitively and mid-word, and says so when nothing matches
    Given I am on a community that has at least 1 member
    When I open the "Majors" filter
    Then the "Majors" filter should offer a search box of its own
    And the filter should offer options sourced from the configured Field of Study list
    When I search the open filter for a word from the first option
    Then fewer options should be offered than before the search
    And every option offered should contain what was searched for
    And the search should have filtered the options without issuing a request
    When I search the open filter for that word in upper case
    Then the same options should be offered as for the lower-case word
    When I search the open filter for a fragment from the middle of that word
    Then every option offered should contain what was searched for
    When I search the open filter for "zzzz-no-such-major"
    Then no options should be offered
    And the filter popover should report "No results found"
    When I clear the open filter's search box
    Then every option offered before the search should be offered again

  # The current build tokenizes whitespace-separated searches and matches every token anywhere
  # in an option. This is intentionally separate from the positive single-word search coverage;
  # the AC does not define whether multi-word input should be phrase-based or token-based.
  # @positive @needs-clarification
  Scenario: Verify that the Majors filter search matches every typed token
    Given I am on a community that has at least 1 member
    When I open the "Majors" filter
    And I search the open filter for each of the following:
      | term    |
      | Acc     |
      | Arab    |
      | AI p    |
      | ing acc |
    Then every option offered should contain every token from the search term
  # ============================================================================
  # 11. CANDIDATE PROFILE CARDS (AC 8)

  @positive
  Scenario: Verify that every candidate card shows its seven elements with sane widget values
    Given I am on a community that has at least 1 member
    Then every candidate card should show the following elements:
      | element                  |
      | Profile Picture          |
      | Candidate Name           |
      | Major                    |
      | Track Name               |
      | Track Progress Widget    |
      | Courses Completed Widget |
      | Hours Learned Widget     |
    And every candidate card should offer a "View Profile" CTA
    And every track progress value should be between "0" and "100" percent
    And every courses completed value should be a non-negative whole number
    And every hours learned value should be a non-negative number

  # @positive @known-issue
  # Scenario: Verify that candidate cards display success labels, drawn only from the four defined values
  #   Given I am on a community that has at least 1 member
  #   Then at least one candidate card should display a success label
  #   And every success label shown should be one of "Course Completed, Certificate, Co-op Program, Tamheer Program"
  #   And a candidate with more than one achievement should show its labels without overlapping the card content

  @positive
  Scenario: Verify that View Profile opens the matching public profile and exposes no private contact details
    Given I am on a community that has at least 1 member
    And I have noted the name of the first member
    When I click "View Profile" on that candidate card
    Then the candidate's public profile should be displayed
    And the public profile should not display the candidate's email address
    And the public profile should not display the candidate's phone number
  # ============================================================================
  # 12. AUTOMATIC COMMUNITY ENROLLMENT (AC 9) — ALL @not-automatable

  @positive @not-automatable
  Scenario: Verify that a candidate is enrolled automatically as soon as they meet all five conditions
    Given a candidate whose university matches an existing community
    And that candidate is Active, with profile and onboarding complete
    And that candidate has not completed the psychometric assessment
    When I open that university's community
    Then that candidate should not be listed as a member
    When that candidate completes the psychometric assessment
    And I reopen that university's community
    Then that candidate should be listed as a member
    And the header member count should have increased by 1
    And no manual action should have been required to add them

  @negative @not-automatable
  Scenario: Verify that a candidate failing any one enrollment condition is not enrolled
    Given a candidate whose university matches an existing community
    When each of the following conditions is unmet in turn:
      | unmet condition                       |
      | completed their profile               |
      | completed onboarding                  |
      | completed the psychometric assessment |
      | an Active status                      |
    Then that candidate should not be listed as a member for any of them

  @edge-case @not-automatable
  Scenario: Verify that a candidate whose university has no community is not enrolled anywhere
    Given a candidate whose university has no community on the platform
    When I open every community
    Then that candidate should not be listed in any of them
  # 13. EMPTY STATE — NO MEMBERS (AC 10.2)

  @positive
  Scenario: Verify that a community with no members shows the no-members empty state, distinct from no-results
    Given I have found a community with no members
    When I open that community
    Then the empty state heading "No members yet" should be displayed
    And the empty state should display "Eligible candidates from this university will appear here automatically."
    And no candidate cards should be listed
    And the header member count should read "0 Members"
    And the empty state heading should not be "No results found"
  # ============================================================================
  # 14. FAILURE HANDLING (not in the AC — asserted as must-not-corrupt)

  # Re-enabled 2026-11-02. Every POST to the community API is stubbed (server error / aborted), so
  # the save never reaches the server and no university is consumed.
  @negative @mocked
  Scenario: Verify that a failed create shows an error, creates no community and keeps the form intact
    When I open the Create Community page
    And I fill every required field with valid details
    And the create community request will fail with each of the following:
      | failure       |
      | server error  |
      | network error |
    Then an error should be surfaced for every one of them
    And no community success modal should be displayed
    And no community should have been created
    And the Create Community page should remain usable with my entered details intact

  @negative @mocked
  Scenario: Verify that a failed edit save leaves the stored community unchanged
    When I open Edit Community for the first community
    And the update community request will fail with a server error
    And I change the about university to "Should not persist."
    And I click "Save"
    Then an error should be surfaced
    And the community toast "Community updated successfully." should not be displayed
    When I reopen that community for editing
    Then the about university should not be "Should not persist."

  # Passed in full on 2026-11-02, so the @known-issue tag came off: a regression lock.
  @negative
  Scenario: Verify that only a superadmin can reach the Community management pages
    When each of the following roles opens each superadmin Community page directly:
      | role                     | page             | expected outcome        |
      | logged in as an agent    | Community        | accessible without management controls |
      | logged in as an agent    | Create Community | denied access           |
      | logged in as a candidate | Create Community | denied access           |
      | logged in as a candidate | Edit Community   | denied access           |
      | not logged in            | Community        | taken to the login page |
      | not logged in            | Create Community | taken to the login page |
    Then every one of them should have got its expected outcome
  # ============================================================================
  # 16. END TO END — CONSUMES A UNIVERSITY

  @end-to-end @positive @creates-community
  #RUN BY : npm run test:community-create
  Scenario: Verify that the full superadmin community lifecycle works from creation to a verified edit
    When I open the Create Community page
    And I note the list of available universities
    And I fill every required field with valid details
    And I enter "   Automation-created community for TFF-264.   " into "About University"
    And I click "Save"
    Then the community success modal "Community created successfully!" should be displayed
    When I click "Go to Community" in the community success modal
    Then I should be on the Community main page
    When I search the communities for that university
    Then only that community should be listed
    And that community card should show the university name I selected
    And that community card should show "0 Members"
    When I click "View Community" on that community card
    Then the header should show that community's configured university name, location and description
    And the header description should be "Automation-created community for TFF-264."
    And the empty state heading "No members yet" should be displayed
    When I click "Edit Community"
    Then the "Save" button should be disabled
    When I select a different location
    And I change the about university to "Corrected description for TFF-264."
    And I click "Save"
    Then the community toast "Community updated successfully." should be displayed
    When I refresh the page
    And I reopen that community
    Then the header location should be the location I selected second
    And the header description should be "Corrected description for TFF-264."
    When I open the Create Community page
    And I open the community university dropdown
    Then the university I just used should no longer be available
