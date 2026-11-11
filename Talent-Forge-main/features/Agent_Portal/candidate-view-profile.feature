@candidateViewProfile
Feature: Agent Portal - candidate View Profile

  Background:
    Given I am logged in as an agent for candidate profiles
  # 1. Reaching the profile, and the route

  @positive @candidate-profile
  Scenario: Verify that the View action opens the candidate profile from every listing that offers one
    When I open a candidate profile from each of these listings:
      | listing            |
      | active             |
      | deactivated        |
      | requires attention |
    Then each profile should have opened on the candidate-details tab
    And each profile should name the candidate whose row was clicked

  @positive @candidate-profile
  Scenario: Verify that opening the profile fetches that candidate's own profile payload
    When I open a candidate profile from the "active" listing
    Then opening the profile should have fetched that candidate's profile
    And the fetched profile should belong to the candidate in the URL

  @edge-case @candidate-profile
  Scenario: Verify that the profile route is reachable directly and survives a reload
    When I open a candidate profile from the "active" listing
    And I reload the profile
    Then the profile should still show the same candidate
    And the candidate-details tab should be the selected tab

  @positive @candidate-profile
  Scenario: Verify that Back leaves the profile and returns to the listing it was opened from
    When I open a candidate profile from the "active" listing
    And I click the profile Back control
    Then I should be back on the "active" listing
  # 2. The profile header and the four widgets

  @positive @candidate-profile
  Scenario: Verify that the profile header shows the candidate's identity on every listing
    When I open a candidate profile from each of these listings:
      | listing            |
      | active             |
      | deactivated        |
      | requires attention |
    Then each profile header should render the avatar band above the candidate's details
    And each profile header should show the name, status and location the payload holds

  @positive @candidate-profile
  Scenario: Verify that the profile renders the candidate's headline when they have one
    When I open the profile of the candidate who has a headline
    Then the header should render that candidate's headline

  @positive @candidate-profile
  Scenario: Verify that a candidate's profile photo is rendered when they have uploaded one
    When I open the profile of the candidate who has a profile photo
    Then the header should render that candidate's profile photo

  @positive @candidate-profile
  Scenario: Verify that the four progress widgets show the figures the payload holds
    When I open the profile of the candidate whose progress statistics are populated
    Then the four progress widgets should be displayed
    And each widget should show the figure its statistic holds

  @edge-case @candidate-profile
  Scenario: Verify that uncomputed progress statistics render an em dash rather than a zero
    When I open the profile of the candidate whose progress statistics are absent
    Then every progress widget should show the uncomputed-statistic placeholder
    And no progress widget should show a zero
  # 3. Candidate Details - what the candidate entered on their own portal

  @positive @candidate-profile
  Scenario: Verify that the Candidate Details tab shows all six sections on every listing
    When I open a candidate profile from each of these listings:
      | listing            |
      | active             |
      | deactivated        |
      | requires attention |
    Then each Candidate Details tab should show exactly these sections in order:
      | section                         |
      | Basic Information               |
      | Education                       |
      | Work Experience                 |
      | Certifications                  |
      | Work Preferences & Availability |
      | Desired Roles                   |

  @positive @candidate-profile
  Scenario: Verify that the Education the candidate entered is shown to their agent
    When I open the profile of the candidate with the fullest details
    Then every education entry the candidate recorded should be shown with its institution, degree, field and dates
    And every education entry that carries a document should offer it as a named attachment

  @positive @candidate-profile
  Scenario: Verify that the Work Experience the candidate entered is shown to their agent
    When I open the profile of the candidate with the fullest details
    Then every work experience entry should be shown with its designation, employment type, company and dates
    And an ongoing role should be shown as running to "Present"

  @positive @candidate-profile
  Scenario: Verify that the Certifications the candidate entered are shown to their agent
    When I open the profile of the candidate with the fullest details
    Then every certification should be shown with its name, issuing organisation and issue date

  @positive @candidate-profile
  Scenario: Verify that Work Preferences & Availability reflects the candidate's stored preferences
    When I open the profile of the candidate with the fullest details
    Then Work Preferences should show exactly these fields:
      | field                      |
      | Interested Programs        |
      | Current City               |
      | Open to Relocation         |
      | Preferred Work Location(s) |
    And the work preference values should match the candidate's stored preferences

  @positive @candidate-profile
  Scenario: Verify that Desired Roles lists every role the candidate selected
    When I open the profile of the candidate with the fullest details
    Then Desired Roles should list every role the candidate selected

  @positive @candidate-profile
  Scenario: Verify that a stored enum is rendered as a label rather than leaked raw
    When I open the profile of the candidate with the fullest details
    Then no section should render a raw underscored enum value

  @positive @candidate-profile
  Scenario: Verify that Basic Information shows the candidate's own stored details
    When I open the profile of the candidate with the fullest details
    Then Basic Information should show exactly these fields:
      | field          |
      | Email          |
      | Phone Number   |
      | Current Status |
      | Nationality    |
      | About Me       |
    And Basic Information should show the Current Status and About Me the candidate stored

  @negative @candidate-profile @known-issue @needs-clarification
  Scenario: Verify that Basic Information is not reported as empty while it holds a stored value
    When I open the profile of the candidate whose only basic information is their status
    Then Basic Information should not claim the candidate added nothing
    And Basic Information should show the Current Status the candidate stored

  @positive @candidate-profile
  Scenario: Verify that Basic Information shows what the candidate filled in and marks the rest unset
    When I open the profile of the candidate with the fullest details
    Then Basic Information should show exactly what the candidate stored:
      | field          | payload field     | enum |
      | Email          | user.email        | no   |
      | Phone Number   | user.phone_number | no   |
      | Nationality    | user.nationality  | no   |
      | Current Status | qualification     | yes  |
      | About Me       | about_me          | no   |
  # 4. The tab strip

  @positive @candidate-profile
  Scenario: Verify that the profile offers exactly the five tabs on every listing
    When I open a candidate profile from each of these listings:
      | listing            |
      | active             |
      | deactivated        |
      | requires attention |
    Then each profile should offer exactly these tabs in order:
      | tab                   |
      | Candidate Details     |
      | Track Progress        |
      | Document Verification |
      | Subscription          |
      | Activity Log          |

  @positive @candidate-profile
  Scenario: Verify that each tab selects, writes its own URL slug and queries only what it needs
    When I open a candidate profile from the "active" listing
    Then selecting each tab in turn should mark it selected and write its slug:
      | tab                   | slug                  |
      | Track Progress        | track-progress        |
      | Document Verification | document-verification |
      | Subscription          | subscription          |
      | Activity Log          | activity-log          |
      | Candidate Details     | candidate-details     |

  @positive @candidate-profile
  Scenario: Verify that the two payload-backed tabs re-render without re-querying the server
    When I open a candidate profile from the "active" listing
    And I select the "Document Verification" tab
    And I select the "Candidate Details" tab
    Then neither of those tab selections should have queried the server

  @edge-case @candidate-profile
  Scenario: Verify that a candidate with no learning track is handled rather than reported as broken
    When I open a candidate profile from the "active" listing
    And I select the "Track Progress" tab
    Then the Track Progress tab should be selected
    And the track request should have been answered without breaking the page

  @positive @candidate-profile
  Scenario: Verify that an empty tab slug falls back to the Candidate Details tab
    When I open a candidate profile from the "active" listing
    And I open the profile with the tab slug ""
    Then the profile should still render its tab strip
    And the profile should fall back to the "Candidate Details" tab with its panel rendered

  @negative @candidate-profile @known-issue @needs-clarification
  Scenario: Verify that an unrecognised tab slug falls back to the Candidate Details tab rather than selecting none
    When I open a candidate profile from the "active" listing
    And I open the profile with the tab slug "not-a-real-tab"
    Then the profile should still render its tab strip
    And the profile should fall back to the "Candidate Details" tab with its panel rendered

  @positive @candidate-profile
  Scenario: Verify that every document the candidate uploaded is listed under its own category
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    Then every document the candidate uploaded should be listed under its category
    And each document row should show its file name, status and upload date

  @positive @candidate-profile
  Scenario: Verify that each document's status is labelled as the agent-facing wording
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    Then each document's status label should match the status the payload holds

  @positive @candidate-profile
  Scenario: Verify that each document row offers the agent a way to view and to download it
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    Then each document row should offer a View and a Download action

  @positive @candidate-profile
  Scenario: Verify that a candidate who has uploaded nothing shows an empty state rather than rows
    When I open the profile of the candidate who has uploaded no documents
    And I select the "Document Verification" tab
    Then no document should be listed
    And every document category should show its own empty state

  @positive @candidate-profile
  Scenario: Verify that viewing a document opens it with its own record beside it
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    And I view the first document listed
    Then the document viewer should show that document's own record
    And the version shown should be the version the server holds
    And the document viewer should offer its preview, Download and zoom controls

  @positive @candidate-profile
  Scenario: Verify that the agent can enlarge a document they are reviewing
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    And I view the first document listed
    Then zooming in and out should change how large the document is drawn

  @positive @candidate-profile
  Scenario: Verify that a document can be downloaded from its row
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    And I download the first document from its row
    Then the downloaded file should be that document

  @positive @candidate-profile
  Scenario: Verify that a document can be downloaded from the viewer without losing the viewer
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    And I view the first document listed
    And I download that document from the viewer
    Then the downloaded file should be that document
    And the viewer should still be open

  @positive @candidate-profile
  Scenario Outline: Verify that the document viewer closes on <control> without changing the page
    When I open the profile of the candidate with the fullest details
    And I select the "Document Verification" tab
    And I view the first document listed
    And I close the document viewer with "<control>"
    Then the document viewer should be closed

    Examples:
      | control |
      | Close   |
      | Escape  |

  @positive @candidate-profile
  Scenario: Verify that Approve and Request Revision are offered only on a document that needs review
    When I open the profile of a candidate whose documents include one that needs review
    And I select the "Document Verification" tab
    Then the review decisions should be offered on a document that needs review and on no other
  # Subscription

  @positive @candidate-profile
  Scenario: Verify that a subscribed candidate's plan is shown with the figures the server holds
    When I open the profile of the subscribed candidate
    And I select the "Subscription" tab
    Then the Subscription tab should show exactly these fields:
      | field                |
      | Status               |
      | Subscription Started |
      | Current Subscription |
      | Total Fee            |
      | Next Billing Date    |
    And the subscription values should match the subscription the server holds

  @positive @candidate-profile
  Scenario: Verify that Total Fee states the amount charged rather than the plan list price
    When I open the profile of the subscribed candidate
    And I select the "Subscription" tab
    Then the Total Fee should state the amount that was charged, with its currency
#Activity Log and its duration filter

  @positive @candidate-profile
  Scenario: Verify that the Activity Log lists that candidate's activity newest first
    When I open the profile of the candidate with the fullest details
    And I select the "Activity Log" tab
    And I set the activity duration to "This year"
    Then every activity entry should show a headline, a description and a date
    And the activity entries should be ordered newest first
    And every activity entry should belong to the candidate whose profile is open

  @positive @candidate-profile
  Scenario: Verify that the activity duration filter offers exactly its six ranges
    When I open the profile of the candidate with the fullest details
    And I select the "Activity Log" tab
    Then the activity duration filter should default to "Last 24 hours"
    And the activity duration filter should offer exactly these ranges in order:
      | range         |
      | Last 24 hours |
      | Last 7 days   |
      | Last 30 days  |
      | Last 3 months |
      | Last 6 months |
      | This year     |

  @positive @candidate-profile
  Scenario: Verify that each duration is sent to the server as its own parameter
    When I open the profile of the candidate with the fullest details
    And I select the "Activity Log" tab
    Then choosing each duration should send its own value to the server:
      | range         | parameter     |
      | Last 7 days   | last_7_days   |
      | Last 30 days  | last_30_days  |
      | Last 3 months | last_3_months |
      | This year     | this_year     |

  @positive @candidate-profile
  Scenario: Verify that narrowing the duration never widens the activity returned
    When I open the profile of the candidate with the fullest details
    And I select the "Activity Log" tab
    And I set the activity duration to "This year"
    And I note how much activity is listed
    When I set the activity duration to "Last 24 hours"
    Then the activity listed should not have grown
  #BUG LOGGED

  @negative @candidate-profile @known-issue @needs-clarification
  Scenario: Verify that the activity duration survives a reload of the profile
    When I open the profile of the candidate with the fullest details
    And I select the "Activity Log" tab
    And I set the activity duration to "This year"
    Then the duration should be recorded wherever a reload can restore it
  # 8. Reminder History

  @positive @candidate-profile
  Scenario: Verify that the profile offers Reminder History for a candidate who has reminders
    When I open the profile of the candidate with the fullest details
    Then the profile Reminder History control should be offered
    And the profile Reminder History control should be enabled

  @positive @candidate-profile
  Scenario: Verify that Reminder History lists every reminder the server returned for that candidate
    When I open the profile of the candidate with the fullest details
    And I open the profile Reminder History
    Then the Reminder History dialog should name that candidate
    And the Reminder History dialog should list every reminder the server returned
    And each reminder should show what was sent and when

  @positive @candidate-profile
  Scenario: Verify that Reminder History opens as a dialog without leaving the profile
    When I open the profile of the candidate with the fullest details
    And I open the profile Reminder History
    Then the profile URL should not have changed
    When I close the Reminder History dialog with the "Close" control
    Then the Reminder History dialog should be closed
    And I should still be on that candidate's profile

  @edge-case @candidate-profile
  Scenario: Verify that Reminder History is not offered for a candidate who has none
    When I open the profile of the candidate who has no reminders
    Then the profile Reminder History control should be disabled
    And no Reminder History dialog should open on its own

  @positive @candidate-profile
  Scenario: Verify that Reminder History is reachable from the profile on every listing that offers a View
    When I open a candidate profile from each of these listings:
      | listing            |
      | active             |
      | deactivated        |
      | requires attention |
    Then each profile should offer a Reminder History control
  # 9. Differences between the listings, asserted rather than assumed

  @edge-case @candidate-profile
  Scenario: Verify that the In Progress listing offers no route into the candidate profile
    When I open the "in progress" listing
    Then the In Progress rows should offer no View control
    And the In Progress row actions should be reported
  # 11. End to end - the candidate fills their profile, the agent sees it

  @e2e @positive @candidate-profile @mutates-profile
  Scenario: Verify that a detail the candidate edits on their own portal reaches their agent's view
    Given I am signed in as the candidate whose profile the agent will view
    When I change my About Me on my own profile
    And I sign in as their agent and open that candidate's profile
    Then the agent's profile should show the About Me I just saved

  @e2e @positive @candidate-profile
  Scenario: Verify that an agent can review one candidate across every tab in a single visit
    When I open the profile of the candidate with the fullest details
    Then the profile header should identify that candidate
    When I select the "Candidate Details" tab
    Then the qualifications the candidate recorded should be shown
    When I select the "Document Verification" tab
    Then every document the candidate uploaded should be listed under its category
    When I select the "Subscription" tab
    Then the Subscription tab should report that candidate's subscription state
    When I select the "Activity Log" tab
    And I set the activity duration to "This year"
    Then every activity entry should belong to the candidate whose profile is open
    When I open the profile Reminder History
    Then the Reminder History dialog should name that candidate
