
@community @community-candidate
Feature: Candidate — University Communities

  Background:
    Given I am logged in as a candidate
    And I am on the Community main page
  # ============================================================================
  # 1. REACHING THE MODULE
  # ============================================================================

  @positive
  Scenario: Verify that the Community module is reachable from the candidate sidebar and lists communities
    Then the sidebar should offer a "Community" entry
    When I open Community from the sidebar
    Then I should be on the Community main page
    And at least one community card should be listed
  # 1.2 — FAILS ON PURPOSE. TFF-521 is still open (To Do): the design places a BETA badge beside
  # the Community entry and the build renders none.

  @positive @known-issue
  Scenario: Verify that the Community sidebar entry carries its BETA badge
    Then the sidebar "Community" entry should carry a BETA badge
  # No AC covers this either way, which is exactly why it is worth one scenario: the sidebar
  # entry is rendered `cursor-not-allowed pointer-events-none` for a candidate whose profile is
  # incomplete, yet /community loads normally when typed into the address bar. Either the gate
  # means something and the route must honour it, or it does not and the sidebar should not
  # claim otherwise. Asserted as an inconsistency so a PO ruling has something to point at.

  @edge-case
  Scenario: Verify that the Community route and the Community sidebar entry agree on whether the module is available
    Then the sidebar "Community" entry should be either enabled, or disabled with the route also refusing access
  # ============================================================================
  # 2. COMMUNITY LISTING (AC 2)
  # ============================================================================
  # AC 2.2 lists four card elements. The fifth assertion is the one that matters most: the
  # superadmin's edit affordance must not leak onto a candidate's card. It is the same component
  # on the same route for both roles, so "it is not rendered for this role" is a real risk, not a
  # theoretical one.

  @positive
  Scenario: Verify that every community card shows its four elements and no management control
    Then every community card should show the following elements:
      | element                       |
      | University Logo/Profile Image |
      | University Name               |
      | Total Member Count            |
      | View Community CTA            |
    And every community card member count should read as "X Members"
    And no community card should offer an edit action
  # 2.2 — FAILS ON PURPOSE. AC 2.1 says the page "displays all created university communities"
  # and AC 2.3 says non-enrolled ones "remain viewable and accessible". Live 2026-07-31 the
  # candidate's listing totals 56 while the superadmin's totals 127; every community on the
  # candidate's first page has at least one member, while the superadmin's carries many with
  # none — so communities with no members appear to be hidden from candidates.
  #
  # The count is read from the listing's OWN total, not by counting cards, so this stays true
  # whatever page size the app settles on.

  @negative @known-issue
  Scenario: Verify that a candidate can see every community that exists on the platform
    Given I have noted how many communities the superadmin can see
    Then the candidate listing should offer that same number of communities
  # NEEDS AN ENROLLED CANDIDATE. AC 1.4 and AC 2.3 are one rule seen from two ends — the primary
  # university's card sorts first AND carries the label — so they are one scenario. The shared
  # candidate is enrolled nowhere, so this cannot run without a fixture whose Education section
  # names a university that has a community.

  @positive @not-automatable
  Scenario: Verify that a candidate's own university sorts first and carries the Your University label
    Given I am a candidate enrolled in at least one university community
    Then every community I am enrolled in should be listed above the communities I am not
    And each of those cards should display a "Your University" label
    And the label should appear on the card for my first education record
  # NEEDS AN ENROLLED CANDIDATE with two education records (AC 1.2).

  @positive @not-automatable
  Scenario: Verify that a candidate with several education records is enrolled in several communities
    Given I am a candidate with two education records naming universities that both have communities
    Then both of those communities should be listed as mine
    And I should be listed as a member of each of them
  # NEEDS AN ENROLLED CANDIDATE. AC 1.3 classifies by Education End Date, and TFF-361 was raised
  # for exactly this (a past end date still read as Student). Both directions in one scenario —
  # a rule with two branches needs both, and they share one fixture.

  @edge-case @not-automatable
  Scenario: Verify that a member is classified Student or Alumni by their education end date
    Given I am a candidate whose education end date is in the future
    Then I should be listed as a "Student" in that community
    When my education end date is changed to a date in the past
    Then I should be listed as an "Alumni" in that community
  # ============================================================================
  # 3. LISTING SEARCH (AC 5, applied to the listing)
  # ============================================================================

  @positive
  Scenario: Verify that the community listing search is case-insensitive, partial and space-trimming
    Given I have noted the name of a listed community
    When I search the communities for each of the following:
      | variation of that community's name | rule                           |
      | the exact name                     | an exact name matches          |
      | the name in upper case             | search is case-insensitive     |
      | a fragment of the name             | partial matching is supported  |
      | the name padded with spaces        | surrounding spaces are trimmed |
    Then that community should be listed for every one of them
  # 3.2 — FAILS ON PURPOSE. AC 8.2 specifies the heading, the body line and a "Clear all filters"
  # CTA. Live the listing renders "No communities found" with no body line and no CTA. TFF-383 is
  # still open on DEV and dev's own comment (2026-07-23) confirms the wording is deliberate — so
  # this is an AC-versus-build disagreement, and it stays red until one side is amended.

  @negative @known-issue
  Scenario: Verify that a listing search matching nothing shows the specified empty state and a CTA that restores the list
    When I search the communities for "zzzz-no-such-university"
    Then no community cards should be listed
    And the empty state heading "No results found" should be displayed
    And the empty state should display "We couldn't find any results matching your current search and filters."
    And a "Clear all filters" CTA should be offered
    When I clear the community search
    Then all communities should be listed again
  # NEEDS BACKEND STATE: a platform with zero communities. DEV carries 127 and no delete CTA
  # exists anywhere, so this state is unreachable. Note the copy is TFF-334's own (AC 8.1) and
  # differs from the superadmin's AC 2.1 wording for the same situation.

  @positive @not-automatable
  Scenario: Verify that the no-communities empty state is shown when none exist
    Given no communities exist on the platform
    Then the empty state heading "No communities available yet" should be displayed
    And the empty state should display "Communities will appear here once they are created."
  # ============================================================================
  # 4. UNIVERSITY COMMUNITY PAGE (AC 3, AC 4)
  # ============================================================================
  # AC 4.1's six header elements plus, again, the check that no management control leaks in.
  # The values are read back against the card the candidate clicked, so a header that renders
  # six populated boxes belonging to a DIFFERENT community still fails.

  @positive
  Scenario: Verify that View Community opens that community's page with its six header elements and no management control
    Given I have noted the name and member count of the first community card
    When I click "View Community" on that card
    Then I should be on the University Community page for that community
    And the community header should show the following elements:
      | element                  |
      | University Cover Image   |
      | University Profile Image |
      | University Name          |
      | University Description   |
      | Total Member Count       |
      | University Location      |
    And the header university name should be the one on the card I clicked
    And the header should offer no Edit Community control
  # 4.2 — FAILS ON PURPOSE, same defect as the superadmin side sees: on community 78 the listing
  # card reads 6 Members, the header reads 10 Members, and 6 candidate cards are listed. Asserted
  # from the candidate's session as well because the two portals render the header from the same
  # endpoint, and a fix that corrects one must correct both.

  @negative @known-issue
  Scenario: Verify that the member count agrees between the community card, the header and the members listed
    Given I have noted the name and member count of the first community card
    When I click "View Community" on that card
    Then the header member count should equal the count on its listing card
    And the header member count should equal the number of candidate cards listed across every page
  # ============================================================================
  # 5. MEMBER SEARCH (AC 5)
  # ============================================================================

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
  # 5.2 — REWRITTEN 2026-08-10, and the old version must NOT come back. It read
  #   @negative @known-issue
  #   Scenario: Verify that members can be found by Major and by Track Name, as AC 5.2 requires
  #     And I have noted the major and track of the first member
  #     When I search the members for that major and for that track in turn
  #     Then that member should be listed for both of them
  # which asserted a capability the product has decided NOT to build: name-only matching is
  # intended, TFF-330 is WON'T DO (PO-confirmed 2026-08-03), so AC 5.2 is what is wrong. Its two
  # step definitions were deleted with it — see the note in community.steps.js — because leaving
  # them meant uncommenting this file would resurrect the forbidden expectation.
  #
  # The superadmin file now enforces the OPPOSITE on the same shared steps, and this mirrors it: a
  # Major must find NOBODY, with the name search re-run as a control so a search box that matches
  # nothing cannot pass. The placeholder is a separate scenario because it is still red (the copy
  # says "or major") and Cucumber abandons a scenario at its first failure.

  @negative
  Scenario: Verify that the member search does not match a candidate's Major, which is not a searchable field
    Given I am on a community that has at least 1 member
    And I have noted the Major of a member who holds one
    When I search the members for that Major
    Then that member should not be listed
    When I clear the member search
    And I search the members for that member's name
    Then that member should be listed by name

  @negative @known-issue
  Scenario: Verify that the member search placeholder offers a search by candidate name only
    Given I am on a community that has at least 1 member
    Then the member search placeholder should offer a search by candidate name only
  # 5.3 — FAILS ON PURPOSE on one phrase. AC 8.2's line ends "...your current search and
  # filters."; the app renders "...your current search." TFF-355 was closed as DROPPED without
  # the AC being amended. Regression cover for TFF-337 (spacing) rides along, since it is the
  # same block.

  @negative @known-issue
  Scenario: Verify that a member search matching nobody shows the specified empty state, spaced correctly
    Given I am on a community that has at least 1 member
    When I search the members for "zzzz-no-such-candidate"
    Then no candidate cards should be listed
    And the empty state heading "No results found" should be displayed
    And the empty state should display "We couldn't find any results matching your current search and filters."
    And the no-results message should have vertical spacing above and below it
  # ============================================================================
  # 6. FILTERS (AC 6)
  # ============================================================================
  # AC 6.1's three filters, that each is multi-select, and each one's source. Grad Year is
  # asserted against TFF-334's OWN wording — "values based on available graduation years" — not
  # against TFF-264's fixed 2015→2032 range, because this file asserts this story. The
  # superadmin file asserts the fixed range, so if the two builds ever diverge, the two files
  # will say so independently.

  @positive
  Scenario: Verify that the three specified filters are offered and allow multiple selections
    Given I am on a community that has at least 1 member
    Then the following filters should be offered and allow multiple selections:
      | filter    |
      | Grad Year |
      | Majors    |
      | Members   |
    When I open the "Grad Year" filter
    Then every year offered should be a plausible graduation year
    When I open the "Members" filter
    Then the filter should offer exactly the options "Student" and "Alumni"

  @positive
  Scenario: Verify that multiple filters and a search apply together and narrow the member list
    Given I am on a community that has at least 2 members
    And I have noted the number of candidate cards listed
    When I select the first available option in the "Grad Year" filter
    And I select the first available option in the "Majors" filter
    Then every listed candidate card should match both selected filters
    And the member list request should have succeeded
    When I search the members for a fragment shared by several members
    Then every listed candidate card should match both the search and the filters
  # Regression for TFF-356 (fixed): "Clear all filters" removed the filters but left the search
  # text sitting in the box, so the list stayed filtered by a term the user thought they had
  # cleared. All three halves of AC 8.2's CTA behaviour in one scenario, because they are one
  # click and asserting them apart would cost three setups.

  @positive
  Scenario: Verify that Clear all filters removes the filters, clears the search input and restores the full list
    Given I am on a community that has at least 1 member
    And I have noted the number of candidate cards listed
    When I search the members for "zzzz-no-such-candidate"
    And I select the first available option in the "Grad Year" filter
    And I click "Clear all filters"
    Then the member search field should be empty
    And no filter should be applied
    And the number of candidate cards listed should be back to the noted count
  # 6.2 — FAILS ON PURPOSE. AC 6.3 requires applied search and filters to persist through
  # pagination, a page refresh and navigation within the same community page. Live they survive
  # none of it: the filters are not reflected in the URL, so a reload has nothing to restore and
  # the list comes back unfiltered.

  @negative @known-issue
  Scenario: Verify that an applied search and filter persist across a refresh and through pagination
    Given I am on a community that has at least 1 member
    When I search the members for a fragment shared by several members
    And I select the first available option in the "Grad Year" filter
    And I refresh the page
    Then the member search field should still hold that fragment
    And that filter should still be applied
    And the listed candidate cards should be the same as before the refresh
  # The other half of AC 6.3 — "Filters reset when the user leaves the community page entirely".
  # This one the build gets right, but only because it persists nothing at all, so it is asserted
  # separately from the persistence scenario above: merging them would let a build that persists
  # NOTHING pass half a scenario and a build that persists EVERYTHING pass the other half, with
  # neither result telling you which.

  @edge-case
  Scenario: Verify that filters reset once the candidate leaves the community page entirely
    Given I am on a community that has at least 1 member
    When I select the first available option in the "Grad Year" filter
    And I go back to the Community main page
    And I reopen that community
    Then no filter should be applied
    And all members should be listed again
  # ============================================================================
  # 7. CANDIDATE CARDS (AC 7)
  # ============================================================================

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
  # 7.2 — FAILS ON PURPOSE. AC 7.2 defines four labels and says several may appear at once. Live,
  # not one rendered on any card in any community inspected — including members at 100% track
  # progress with four completed courses. Same finding as the superadmin file's §11.2; asserted
  # in both because the card is rendered per role and a fix must reach both.

  @positive @known-issue
  Scenario: Verify that candidate cards display success labels, drawn only from the four defined values
    Given I am on a community that has at least 1 member
    Then at least one candidate card should display a success label
    And every success label shown should be one of "Course Completed, Certificate, Co-op Program, Tamheer Program"
    And a candidate with more than one achievement should show its labels without overlapping the card content
  # AC 7.3 opens the peer's PUBLIC profile. For a candidate viewing a PEER, the privacy half
  # carries more weight than it does for a superadmin — this is a user seeing another user.

  # FAILS ON PURPOSE, on the Major only — the same defect the superadmin file's §11.3 records
  # (the public profile omits the Major the card displays), asserted from this role too because
  # the profile is rendered per role and a fix must reach both.
  #
  # Privacy and the no-edit check come FIRST: Cucumber abandons at the first failure, and for a
  # candidate looking at a PEER those are the assertions worth protecting from a cosmetic red.
  @positive @known-issue
  Scenario: Verify that View Profile opens the matching public profile and exposes no private contact details
    Given I am on a community that has at least 1 member
    And I have noted the name, major and track of the first member
    When I click "View Profile" on that candidate card
    Then the candidate's public profile should be displayed
    And the public profile should not display the candidate's email address
    And the public profile should not display the candidate's phone number
    And the public profile should offer no control that edits that candidate
    And the public profile should show that candidate's name, major and track
  # ============================================================================
  # 8. ACCESS CONTROL
  # ============================================================================
  # The candidate's own side of the boundary the superadmin file asserts from the other end.
  # Kept here as well because this is the role that would actually attempt it.

  @negative
  Scenario: Verify that a candidate cannot reach the superadmin Community management pages
    When each of the following superadmin Community pages is opened directly:
      | page             | expected outcome |
      | Create Community | denied access    |
      | Edit Community   | denied access    |
    Then every one of them should have got its expected outcome
    And I should still be able to open the Community main page
  # ============================================================================
  # 9. END TO END
  # ============================================================================
  # The whole candidate journey in one pass, in the order a candidate actually works: arrive at
  # the directory, find a community, open it, narrow the members down, open a peer's profile,
  # and come back out to a clean list. It closes one loop nothing else covers — that returning
  # from a public profile lands back on the community with its state intact rather than on a
  # reset page or the directory.

  @end-to-end @positive
  Scenario: Verify the full candidate community journey from the directory to a peer's profile and back
    Then at least one community card should be listed
    Given I have noted the name and member count of the first community card
    When I search the communities for that community's name
    Then only that community should be listed
    When I click "View Community" on that card
    Then I should be on the University Community page for that community
    And the header university name should be the one on the card I clicked
    Given I have noted the name of the first member
    When I search the members for a fragment of that member's name
    Then that member should be listed
    And every listed candidate card should match the search term
    When I click "View Profile" on that candidate card
    Then the candidate's public profile should be displayed
    # Deliberately NOT the full name/major/track check here. The Major is a live defect (§7.3
    # owns it, @known-issue), and this journey's remaining value is the loop back out — that
    # returning from a public profile lands on the community with its state intact, which
    # nothing else covers. Asserting the Major here would abandon the scenario at this step and
    # take that closing loop down with it, for a defect already reported elsewhere.
    When I go back to the community
    Then I should be on the University Community page for that community
    When I click "Clear all filters"
    Then the member search field should be empty
    And all members should be listed again
