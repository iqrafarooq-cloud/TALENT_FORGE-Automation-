@community @community-admin @community-pages
Feature: Super Admin - Communities: listing and community page against the server, paging, filters, navigation and failures

  # Closes the gaps left by Community.feature (coverage pass of 2026-11-02). Everything here is
  # READ-ONLY: nothing is saved and every failure is a page.route() stub, so the file is in the
  # default run. Every value is compared with the response the app itself received - never with
  # literals - because the listing and the member lists are shared, growing DEV data.
  #
  # Measured 2026-11-02 (scripts/probe-community-superadmin-gaps.js, read-only):
  #   - the listing asks GET /community/?page=<n>&page_size=12[&search=]; 145 communities, 13 pages
  #   - a community page asks GET /community/<id>/ and /community/<id>/candidates/?page=&page_size=12
  #   - the member filters send grad_year=<year>, major=<field of study id>, qualification=STUDENT
  #   - neither page writes its page, search or filters into the URL, so a reload clears them
  #   - the card, header and member-card name/major/track buttons do nothing
  #   - Create and Edit leave by an "Exit" link with no confirmation
  #   - NO university is left without a community on DEV, so the Create form is fed stand-ins
  #     while filling it (steps/community-pages.js explains; nothing can be saved)
  #   - /community/edit/<unknown id> renders an empty Edit form; /community/view/<unknown id> a 404
  #   - a server error on GET /community/<id>/ is shown as "404 Page not found"

  Background:
    Given I am logged in as the superadmin

  # ==================== LISTING: VALUES AND PAGING ====================

  @positive
  Scenario: Verify that every community card shows the server's name and member count in the server's order
    Given I have opened the Community listing
    Then every community card should match the server on each of these listing pages:
      | page |
      | 1    |
      | 2    |
      | last |

  @positive
  Scenario: Verify that the community listing pages 12 at a time with working Previous, Next and numbered pages
    Given I have opened the Community listing
    Then the community listing should page 12 at a time with working Previous, Next and numbered pages

  @positive
  Scenario: Verify that a community search from a later page asks for page 1 and lists only matching communities
    Given I have opened the Community listing
    When I go to page 2 of the Community listing
    And I search the Community listing for the first word of the first community on that page
    Then the community search should ask the server for page 1 of that term and list only matching communities

  @edge-case
  Scenario: Verify that a whitespace-only community search sends nothing and keeps the full listing
    Given I have opened the Community listing
    When I search the Community listing for only spaces
    Then no community listing request should have been sent and the first page should still be listed

  # Measured: neither the page nor the search reaches the URL, so a reload (or a shared link)
  # always opens page 1 unfiltered. Asserted as measured - ask the PO whether it should persist.
  @edge-case @needs-clarification
  Scenario: Verify that the community listing keeps its page and search out of the URL, so a reload returns to the first page
    Given I have opened the Community listing
    When I go to page 2 of the Community listing
    And I search the Community listing for the first word of the first community on that page
    Then the Community listing URL should carry neither the page nor the search
    When I reload the Community listing
    Then the Community listing should be back on its first page with an empty search

  # ==================== LISTING: ENTRY POINTS AND KEYBOARD ====================

  # Measured: the university name on a card is a <button> that does nothing. Ask the PO whether it
  # should open the community, like View Community does.
  @positive @needs-clarification
  Scenario: Verify that a community card's university name opens nothing
    Given I have opened the Community listing
    Then clicking the first community card's university name should open nothing and send nothing

  @positive
  Scenario: Verify that the community listing can be worked from the keyboard
    Given I have opened the Community listing
    Then Tab from the community search should reach Create Community, then the first card's Edit Community and View Community
    When I press Enter on the focused View Community link
    Then that community's page should open

  @positive
  Scenario: Verify that the sidebar Community link opens the listing on its first page
    When I open Community from the sidebar while on the Audit Logs page
    Then the Community listing should open on its first page

  @negative
  Scenario: Verify that a failed or unreachable listing load says "Something went wrong." instead of listing no communities
    Given I have opened the Community listing
    Then each of these community listing failures should say "Something went wrong." rather than list no communities:
      | failure       |
      | server error  |
      | network error |

  # ==================== COMMUNITY PAGE: VALUES AND PAGING ====================

  @positive
  Scenario: Verify that the community header shows the server's name, location, description and member count
    Given I have opened a community that has more than one page of members
    Then the community header should match the server

  @edge-case
  Scenario: Verify that the header of a community with no members matches the server
    Given I have opened a community that has no members
    Then the community header should match the server

  @positive
  Scenario: Verify that every member card shows the server's name, major and graduation year on the first and last member page
    Given I have opened a community that has more than one page of members
    Then every member card should match the server on the first and the last member page

  @positive
  Scenario: Verify that the member list pages 12 at a time and a member search from the last page returns to page 1
    Given I have opened a community that has more than one page of members
    Then the member list should page 12 at a time and a member search from the last page should return to page 1

  # ==================== COMMUNITY PAGE: FILTERS AND URL ====================

  @positive
  Scenario: Verify that each member filter sends its own request parameter and the filters combine in one request
    Given I have opened a community that has more than one page of members
    When I apply each of these member filters in turn:
      | filter     | option           |
      | Grad Years | the first option |
      | Majors     | the first option |
      | Members    | Student          |
    Then each filter should have sent its own parameter and the last request should carry all of them:
      | filter     | parameter     | value             |
      | Grad Years | grad_year     | the option chosen |
      | Majors     | major         | a number          |
      | Members    | qualification | STUDENT           |

  # Measured: the member search and filters never reach the URL and a reload clears both.
  # Asserted as measured - ask the PO whether a filtered member view should be shareable.
  @edge-case @needs-clarification
  Scenario: Verify that the member search and filters stay out of the URL, so a reload clears them
    Given I have opened a community that has more than one page of members
    When I apply each of these member filters in turn:
      | filter     | option           |
      | Grad Years | the first option |
    Then the community URL should carry neither the member search nor the filters
    When I reload the community page
    Then the member list should be back on its first page with no search and no filter

  # ==================== COMMUNITY PAGE: NAVIGATION ====================

  # Measured: the header's name and location and the member card's name, major and track are
  # <button>s that do nothing. Asserted as measured - ask the PO whether any should navigate.
  @positive @needs-clarification
  Scenario: Verify that the header and member card text buttons open nothing
    Given I have opened a community that has more than one page of members
    Then clicking the header's name and location and the first member card's name, major and track should open nothing and send nothing

  @positive
  Scenario: Verify that View Profile opens the member's public profile and the browser Back returns to the community
    Given I have opened a community that has more than one page of members
    Then View Profile on the first member card should open that member's public profile
    And the browser Back button should return to the same community page

  @positive
  Scenario: Verify that the community page's Edit Community and Back controls go where they say
    Given I have opened a community that has more than one page of members
    Then the community page's Edit Community should open that community's edit form and its Back should return to the listing

  # ==================== COMMUNITY PAGE: UNKNOWN IDS AND FAILURES ====================

  @negative
  Scenario: Verify that an unknown or malformed community id shows the "Page not found" page
    Then each of these community routes should show the "404 Page not found" page:
      | route                  |
      | /community/view/999999 |
      | /community/view/abc    |

  # Measured: /community/edit/999999 renders the whole Edit form, empty, with Save - the request
  # for the community answers 404 and the page ignores it.
  @negative @known-issue
  Scenario: Verify that editing an unknown community id shows the "Page not found" page instead of an empty form
    Then each of these community routes should show the "404 Page not found" page:
      | route                  |
      | /community/edit/999999 |

  @negative @known-issue
  Scenario: Verify that a server error loading a community is reported as an error rather than as a missing page
    Given I have opened a community that has more than one page of members
    Then a failed load of that community should be reported as an error rather than as "Page not found"

  @negative
  Scenario: Verify that a failed member list load is not presented as a community with no members
    Given I have opened a community that has more than one page of members
    Then a failed load of its member list should not present the community as having no members

  # ==================== CREATE / EDIT: LEAVING ====================

  # Measured: both forms carry an "Exit" link (admin-community-form-exit-button -> /community) and
  # leaving a filled form asks for no confirmation. Asserted as measured - ask the PO whether
  # discarding typed details without a warning is intended.
  @edge-case @needs-clarification
  Scenario: Verify that leaving a filled Create Community form by Exit creates nothing and asks nothing
    Given I have opened the Community listing
    When I open the Create Community page
    Then the Create Community page should offer an Exit link back to the Community listing
    When I fill every required field with valid details
    And I leave the Create Community page by Exit
    Then no create request should have been sent and the community count should be unchanged

  # ==================== EDIT: THE STORED IMAGES ====================

  # Measured 2026-11-03: an existing community's cover and logo can each be removed on the Edit
  # form; nothing is written until Save, so a reload brings both back. Nothing is saved here.
  @edge-case
  Scenario: Verify that removing a community's stored cover and logo re-offers both uploads, gates Save and writes nothing
    Given I have opened the Community listing
    When I open Edit Community for the first community
    Then the Edit Community form should show the community's stored cover photo and logo
    When I remove the "Cover Photo" image
    And I remove the "Profile Photo" image
    Then no preview should be displayed for either image field
    And both image upload controls should be offered again
    And the community Save button should be disabled
    And no community write request should have been sent
    When I reload the Edit Community page
    Then the Edit Community form should show the community's stored cover photo and logo

  # The logo's "Remove photo" only appears on hover for a mouse; this checks the keyboard route.
  @positive
  Scenario: Verify that a community's stored logo can be removed from the keyboard
    Given I have opened the Community listing
    When I open Edit Community for the first community
    Then the stored logo's Remove photo should be reachable and usable from the keyboard
    And no community write request should have been sent

  # ==================== END TO END ====================

  @positive @e2e
  Scenario: Verify that a superadmin can find a community, page and filter its members, open a member's profile and come back
    Given I have opened the Community listing
    And I have noted a community on the listing that has more than one page of members
    When I search the Community listing for that community's name
    And I open View Community on that community's card
    Then the community header should match the server
    When I go to page 2 of its members
    And I apply each of these member filters in turn:
      | filter  | option  |
      | Members | Student |
    Then each filter should have sent its own parameter and the last request should carry all of them:
      | filter  | parameter     | value   |
      | Members | qualification | STUDENT |
    And View Profile on the first member card should open that member's public profile
    And the browser Back button should return to the same community page
    And the community page's Edit Community should open that community's edit form and its Back should return to the listing
