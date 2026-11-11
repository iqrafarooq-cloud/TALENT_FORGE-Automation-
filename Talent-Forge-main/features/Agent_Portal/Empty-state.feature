@empty-state
Feature: Agent Portal empty states

  Background:
    Given I am logged in as the empty agent
    # POSITIVE - each page tells the agent there is nothing yet

  @positive @smoke
  Scenario: Verify that the empty agent holds nothing on any listing
    Then no empty-state listing should render a single row:
      | page               |
      | Active Candidates  |
      | In Progress        |
      | Deactivated        |
      | Requires Attention |
      | Verifications      |

  @positive
  Scenario: Verify that the dashboard shows zero figures and an empty state on every section card
    When I open the empty agent's dashboard
    Then every empty-state KPI tile should read 0:
      | tile                   |
      | Total Candidates       |
      | Active Candidates      |
      | Onboarding in Progress |
      | Requires Attention     |
    And the empty-state Promo Code should read "-"
    And every dashboard card should show its empty state:
      | card                        | heading                                | body                                                                                                          | cta               |
      | Document Verification Queue | No documents to review yet             | Documents will show up here after candidates complete their onboarding and uploads.                           | -                 |
      | Requires Attention          | Nothing needs your attention right now | When a candidate needs follow-up (incomplete onboarding, pending documents, or payments), it'll show up here. | -                 |
      | Active Candidates           | No candidates yet                      | Candidates will appear here once they are invited to the portal.                                              | Invite Candidates |

  @positive
  Scenario: Verify that every dashboard period shows zero figures
    When I open the empty agent's dashboard
    Then every dashboard period should show zero figures:
      | period       |
      | Quarterly    |
      | Yearly       |
      | Year to Date |
      | Monthly      |

  @positive
  Scenario: Verify that every listing opens on its own tab-level empty state
    Then the Agent Portal empty states should read:
      | page               | tab | search | filter | heading                          | body                                                                                                    | cta               |
      | Active Candidates  | -   | -      | -      | No active candidates             | Candidates will appear here once they complete their onboarding process and move into an active status. | -                 |
      | In Progress        | -   | -      | -      | No candidates yet                | Start by inviting your first candidate or sharing your agent code.                                      | Invite Candidates |
      | Deactivated        | -   | -      | -      | No deactivated candidates        | Candidates who have been deactivated will appear here.                                                  | -                 |
      | Requires Attention | -   | -      | -      | No candidates requires attention | Candidates with warnings or critical issues will appear here if action is needed.                       | -                 |
      | Verifications      | -   | -      | -      | No documents to verify yet       | Uploaded documents from candidates will appear here once they're submitted for review.                  | -                 |

  @positive
  Scenario: Verify that every quick-filter tab explains its own empty state
    Then the Agent Portal empty states should read:
      | page               | tab                   | search | filter | heading                       | body                                                                                          | cta |
      | Active Candidates  | Subscribed            | -      | -      | No subscribed candidates      | Candidates will appear here once they complete subscription.                                  | -   |
      | Active Candidates  | Payment Due           | -      | -      | No payments pending           | Candidates with outstanding payments will appear here.                                        | -   |
      | Active Candidates  | Not Subscribed        | -      | -      | No unsubscribed candidates    | Candidates who haven't subscribed yet will appear here.                                       | -   |
      | In Progress        | Invite Sent           | -      | -      | No pending invites            | Candidates will appear here after you send them an invitation.                                | -   |
      | In Progress        | Onboarding Incomplete | -      | -      | No incomplete onboarding      | Candidates who haven’t finished onboarding will show up here.                                 | -   |
      | Requires Attention | Warning               | -      | -      | No warnings at the moment     | Candidates with minor issues that need attention will appear here.                            | -   |
      | Requires Attention | Critical              | -      | -      | No critical issues found      | Candidates with urgent or blocking issues will appear here.                                   | -   |
      | Verifications      | Needs Review          | -      | -      | No documents needs review     | You're all caught up. Documents needing review will show up here when candidates submit them. | -   |
      | Verifications      | Approved              | -      | -      | No approved documents yet     | Once you approve candidate documents, they'll appear here for reference.                      | -   |
      | Verifications      | Revision Required     | -      | -      | No documents require revision | Documents that need changes or re-uploads from candidates will appear here.                   | -   |

  @positive
  Scenario: Verify that the Activity Log never opens on a no-results message
      # Live data: the default range may hold this account's superadmin-impersonation entries or
      # nothing, depending on the calendar. Either is fine; "No results found" is not.
    When I open the empty agent's Activity Log with the "Last 7 days" range
    Then the Activity Log should list entries or show the empty state "No activity to show" / "Agents recent actions and updates will appear here."

  @positive @mocked
  Scenario: Verify that an Activity Log with no entries says so, and a range says it filtered
    Given the "agent activity log" request returns nothing
    Then the Agent Portal empty states should read:
      | page         | tab | search | filter        | heading             | body                                                        | cta               |
      | Activity Log | -   | -      | -             | No activity to show | Agents recent actions and updates will appear here.         | -                 |
      | Activity Log | -   | -      | Last 24 hours | No results found    | We couldn't find any results matching your current filters. | Clear all filters |

  @positive @mocked
  Scenario: Verify that an empty notifications bell says so
    Given the "notifications" request returns nothing
    When I open the notifications bell
    Then the notifications bell should read "No notifications yet!" and offer only "Go To Settings"

  @positive
  Scenario: Verify that the Invite Candidates CTA on an empty state opens the onboarding chooser
    Then each empty state's Invite Candidates CTA should open the onboarding chooser without sending anything:
      | page        | section           | empty heading     | chooser title                                   | chooser options                    |
      | Dashboard   | Active Candidates | No candidates yet | Choose how you want to onboard your candidates: | Invite via Email, Share Agent Code |
      | In Progress | -                 | No candidates yet | Choose how you want to onboard your candidates: | Invite via Email, Share Agent Code |

  @positive
  Scenario: Verify that clearing the query brings back the default empty state
    Then clearing each empty-state query should restore the default empty state:
      | page               | via               | query        | query heading    | query body                                                  | query cta         | heading                          | body                                                                                                    | cta               |
      | Active Candidates  | Clear all filters | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters | No active candidates             | Candidates will appear here once they complete their onboarding process and move into an active status. | -                 |
      | In Progress        | Clear all filters | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters | No candidates yet                | Start by inviting your first candidate or sharing your agent code.                                      | Invite Candidates |
      | Deactivated        | Clear all filters | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters | No deactivated candidates        | Candidates who have been deactivated will appear here.                                                  | -                 |
      | Requires Attention | Clear all filters | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters | No candidates requires attention | Candidates with warnings or critical issues will appear here if action is needed.                       | -                 |
      | Verifications      | Clear all filters | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters | No documents to verify yet       | Uploaded documents from candidates will appear here once they're submitted for review.                  | -                 |
      | Active Candidates  | clearing search   | zzqx-none    | No results found | We couldn't find any results matching your current search.  | -                 | No active candidates             | Candidates will appear here once they complete their onboarding process and move into an active status. | -                 |
      | In Progress        | clearing search   | zzqx-none    | No results found | We couldn't find any results matching your current search.  | -                 | No candidates yet                | Start by inviting your first candidate or sharing your agent code.                                      | Invite Candidates |
      | Deactivated        | clearing search   | zzqx-none    | No results found | We couldn't find any results matching your current search.  | -                 | No deactivated candidates        | Candidates who have been deactivated will appear here.                                                  | -                 |
      | Requires Attention | clearing search   | zzqx-none    | No results found | We couldn't find any results matching your current search.  | -                 | No candidates requires attention | Candidates with warnings or critical issues will appear here if action is needed.                       | -                 |
      | Verifications      | clearing search   | zzqx-none    | No results found | We couldn't find any results matching your current search.  | -                 | No documents to verify yet       | Uploaded documents from candidates will appear here once they're submitted for review.                  | -                 |

  @positive
  Scenario: Verify that a reload keeps the search-and-filter empty state
    Then a reload of each empty-state query should restore the same empty state:
      | page              | search    | heading          | body                                                                   |
      | Active Candidates | zzqx-none | No results found | We couldn't find any results matching your current search and filters. |
      | Verifications     | zzqx-none | No results found | We couldn't find any results matching your current search and filters. |

  @positive
  Scenario: Verify that "Clear all filters" on the Activity Log returns to the default range
    When I open the empty agent's Activity Log with the "Last 24 hours" range
    And I clear the Activity Log empty state "No results found" with "Clear all filters"
    Then the Activity Log range should be back to "Last 7 days"
    # =============================================================================================
    # NEGATIVE - a query that matches nothing, and a load that fails
    # =============================================================================================

  @negative
  Scenario: Verify that a search matching nothing says so and offers no filter CTA
    Then the Agent Portal empty states should read:
      | page               | tab | search    | filter | heading          | body                                                       | cta |
      | Active Candidates  | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | In Progress        | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Deactivated        | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Requires Attention | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Verifications      | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |

  @negative
  Scenario: Verify that a filter matching nothing says so and offers "Clear all filters"
    Then the Agent Portal empty states should read:
      | page               | tab | search | filter       | heading          | body                                                        | cta               |
      | Active Candidates  | -   | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | In Progress        | -   | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | Deactivated        | -   | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | Requires Attention | -   | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | Verifications      | -   | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |

  @negative
  Scenario: Verify that every filter option shows the filters empty state
    Then every filter option on each listing should show the filters empty state:
      | page               | heading          | body                                                        | cta               | badge     |
      | Active Candidates  | No results found | We couldn't find any results matching your current filters. | Clear all filters | Filters 1 |
      | In Progress        | No results found | We couldn't find any results matching your current filters. | Clear all filters | Filters 1 |
      | Deactivated        | No results found | We couldn't find any results matching your current filters. | Clear all filters | Filters 1 |
      | Requires Attention | No results found | We couldn't find any results matching your current filters. | Clear all filters | Filters 1 |
      | Verifications      | No results found | We couldn't find any results matching your current filters. | Clear all filters | Filters 1 |

  @negative
  Scenario: Verify that the Verifications date range shows the filters empty state
    Then the Agent Portal empty states should read:
      | page          | tab | search    | filter     | heading          | body                                                                   | cta               |
      | Verifications | -   | -         | date range | No results found | We couldn't find any results matching your current filters.            | Clear all filters |
      | Verifications | -   | zzqx-none | date range | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |

  @negative
  Scenario: Verify that a search and a filter together name both causes
    Then the Agent Portal empty states should read:
      | page               | tab | search    | filter       | heading          | body                                                                   | cta               |
      | Active Candidates  | -   | zzqx-none | first option | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | In Progress        | -   | zzqx-none | first option | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | Deactivated        | -   | zzqx-none | first option | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | Requires Attention | -   | zzqx-none | first option | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | Verifications      | -   | zzqx-none | first option | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |

  @negative
  Scenario: Verify that Activity Log ranges and searches matching nothing explain themselves
      # On this page the DEFAULT range counts as a filter in the copy, so a search alone reads
      # "...search and filters." (measured) - unlike every other listing.
    Then the Agent Portal empty states should read:
      | page         | tab | search    | filter        | heading          | body                                                                   | cta               |
      | Activity Log | -   | -         | Last 24 hours | No results found | We couldn't find any results matching your current filters.            | Clear all filters |
      | Activity Log | -   | zzqx-none | -             | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
      | Activity Log | -   | zzqx-none | This year     | No results found | We couldn't find any results matching your current search and filters. | Clear all filters |
    # EDGE CASES - tabs combined with a query, and what the URL and the input can hold

  @edge-case
  Scenario: Verify that a search on a quick-filter tab replaces the tab's own wording
    Then the Agent Portal empty states should read:
      | page               | tab         | search    | filter | heading          | body                                                       | cta |
      | Active Candidates  | Subscribed  | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | In Progress        | Invite Sent | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Requires Attention | Critical    | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Verifications      | Approved    | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |

  @edge-case
  Scenario: Verify that a filter on a quick-filter tab replaces the tab's own wording
    Then the Agent Portal empty states should read:
      | page               | tab                   | search | filter       | heading          | body                                                        | cta               |
      | Active Candidates  | Payment Due           | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | In Progress        | Onboarding Incomplete | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | Requires Attention | Warning               | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |
      | Verifications      | Revision Required     | -      | first option | No results found | We couldn't find any results matching your current filters. | Clear all filters |

  @edge-case
  Scenario: Verify that deep links land on the right empty state, including unusable values
    Then each empty-state deep link should land on:
      | link                                                 | heading                    | lands                                                |
      | /candidates/active?activeFilter=paymentDue           | No payments pending        | /candidates/active?activeFilter=paymentDue           |
      | /candidates/in-progress?activeFilter=invite_sent     | No pending invites         | /candidates/in-progress?activeFilter=invite_sent     |
      | /candidates/requires-attention?activeFilter=critical | No critical issues found   | /candidates/requires-attention?activeFilter=critical |
      | /verifications?activeFilter=approved                 | No approved documents yet  | /verifications?activeFilter=approved                 |
      | /candidates/active?activeFilter=bogus                | No active candidates       | /candidates/active?activeFilter=all                  |
      | /verifications?activeFilter=nope                     | No documents to verify yet | /verifications?activeFilter=all                      |
      | /candidates/active?page=5                            | No active candidates       | -                                                    |
      | /candidates/deactivated?search=%20%20%20             | No deactivated candidates  | /candidates/deactivated                              |

  @edge-case
  Scenario: Verify that typing only spaces is not treated as a search
    Then typing only spaces into each search should keep the default empty state:
      | page               | heading                          |
      | In Progress        | No candidates yet                |
      | Deactivated        | No deactivated candidates        |
      | Requires Attention | No candidates requires attention |
      | Verifications      | No documents to verify yet       |

  @edge-case @known-issue
  Scenario: Verify that typing only spaces on Active Candidates keeps its empty state
    Then typing only spaces into each search should keep the default empty state:
      | page              | heading              |
      | Active Candidates | No active candidates |

  @edge-case
  Scenario: Verify that an unsafe or non-latin search term shows a plain no-results state
    Then the Agent Portal empty states should read:
      | page              | tab | search                    | filter | heading          | body                                                       | cta |
      | Active Candidates | -   | <script>alert(1)</script> | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Deactivated       | -   | ' OR 1=1 --               | -      | No results found | We couldn't find any results matching your current search. | -   |
      | Verifications     | -   | محمد                      | -      | No results found | We couldn't find any results matching your current search. | -   |
    And no browser dialog should have opened during the empty-state checks
    # END TO END - an agent with nothing walks the portal through the sidebar

  @e2e
  Scenario: Verify that an agent with nothing is told so, and why, on every page they visit
    When I open the empty agent's dashboard
    Then every dashboard card should show its empty state:
      | card              | heading           | body                                                             | cta               |
      | Active Candidates | No candidates yet | Candidates will appear here once they are invited to the portal. | Invite Candidates |
    When I follow the sidebar to "In Progress"
    Then the current page should show the empty state "No candidates yet"
    When I apply the first filter on the current "In Progress" page
    Then the current empty state should read "No results found" / "We couldn't find any results matching your current filters." offering "Clear all filters"
    When I click the empty state's "Clear all filters"
    Then the current page should show the empty state "No candidates yet"
    When I search the current page for "zzqx-none"
    Then the current empty state should read "No results found" / "We couldn't find any results matching your current search." offering "-"
    When I clear the current search
    Then the current page should show the empty state "No candidates yet"
    When I follow the sidebar to "Active Candidates"
    Then the current page should show the empty state "No active candidates"
    When I follow the sidebar to "Deactivated"
    Then the current page should show the empty state "No deactivated candidates"
    When I follow the sidebar to "Requires Attention"
    Then the current page should show the empty state "No candidates requires attention"
    When I follow the sidebar to "Verifications"
    Then the current page should show the empty state "No documents to verify yet"
    When I search the current page for "zzqx-none"
    And I apply the first filter on the current "Verifications" page
    Then the current empty state should read "No results found" / "We couldn't find any results matching your current search and filters." offering "Clear all filters"

   

    # POSITIVE

    @positive @empty-profile
    Scenario: Verify that the empty candidate's header shows placeholders rather than figures
      When I open the empty candidate's profile on the "candidate-details" tab
      Then the empty candidate's profile should read:
        | after            | lines                                                                                                                      |
        | Reminder History | Empty Profile / Unverified / - / —% / Track Progress / — / Courses Completed / — / Hours Learned / — / Certificates Earned |
        # The header in reading order: name, verification pill, headline ("-" = unset), then the
        # four widgets, each VALUE above its caption. An uncomputed statistic is an em dash, not 0.
      And the empty candidate's Reminder History should be disabled

    @positive @empty-profile
    Scenario: Verify that every Candidate Details section of an empty candidate says so
      When I open the empty candidate's profile on the "candidate-details" tab
      Then the empty candidate's profile should read:
        | after                      | lines                                                                                |
        | Phone Number               | -                                                                                    |
        | Nationality                | -                                                                                    |
        | About Me                   | -                                                                                    |
        | Education                  | No education details added yet / This candidate hasn't added their education details |
        | Work Experience            | No work experience added yet / This candidate hasn't added their work experience     |
        | Certifications             | No certifications added yet / This candidate hasn't added their certifications       |
        | Interested Programs        | -                                                                                    |
        | Current City               | -                                                                                    |
        | Open to Relocation         | No                                                                                   |
        | Preferred Work Location(s) | -                                                                                    |
        | Desired Roles              | No desired roles selected / This candidate hasn't added their desired roles          |

    @positive @empty-profile
    Scenario: Verify that the Track Progress, Document Verification and Subscription tabs of an empty candidate say so
      When I open the empty candidate's profile on the "track-progress" tab
      Then the empty candidate's profile should read:
        | after          | lines                                                                                                      |
        | Track Progress | This candidate hasn't completed the psychometric assessment. A track will be assigned once results are in. |
      When I open the empty candidate's profile on the "document-verification" tab
      Then the empty candidate's profile should read:
        | after           | lines                                      |
        | Education       | No education documents uploaded yet.       |
        | Work Experience | No work experience documents uploaded yet. |
        | Certifications  | No certification documents uploaded yet.   |
      When I open the empty candidate's profile on the "subscription" tab
      Then the empty candidate's profile should read:
        | after                | lines                                                |
        | Subscription Details | This candidate does not have an active subscription. |

    @positive @empty-profile
    Scenario: Verify that the empty candidate's Activity Log tab lists entries or says it is empty
      # Signing up wrote two entries on 2026-10-13, so the default "Last 24 hours" range is
      # populated on the day the fixture is minted and empty from the next day on.
      When I open the empty candidate's profile on the "activity-log" tab
      Then the empty candidate's Activity Log should list entries or show the empty state "No activity to show" / "Your recent actions and updates will appear here as you use the platform."

    @positive @mocked @empty-profile
    Scenario: Verify that the empty candidate's Activity Log tab with no entries says so
      # Measured 2026-10-13 with the tab's request answered empty. Note the copy is written to the
      # candidate ("Your recent actions") although an AGENT is reading it - recorded, not failed on.
      Given the "candidate activity log" request returns nothing
      When I open the empty candidate's profile on the "activity-log" tab
      Then the empty candidate's Activity Log should list entries or show the empty state "No activity to show" / "Your recent actions and updates will appear here as you use the platform."
    # =============================================================================================
    # NEGATIVE AND EDGE CASES - a listing that is NOT empty still has empty states
    # =============================================================================================

    @edge-case @empty-profile
    Scenario: Verify that a tab with nobody on it shows its empty state while another tab lists the candidate
      Then the empty-profile agent's In Progress tabs should read:
        | tab                   | rows | heading            |
        | All                   |    1 | -                  |
        | Invite Sent           |    0 | No pending invites |
        | Onboarding Incomplete |    1 | -                  |

    @negative @empty-profile
    Scenario: Verify that a search matching nothing hides the listed candidate behind a no-results state
      Then the Agent Portal empty states should read:
        | page        | tab | search    | filter | heading          | body                                                       | cta |
        | In Progress | -   | zzqx-none | -      | No results found | We couldn't find any results matching your current search. | -   |
    # =============================================================================================
    # END TO END - every profile tab, reached by clicking
    # =============================================================================================

    @e2e @empty-profile
    Scenario: Verify that clicking through every tab of an empty candidate's profile shows its empty state
      Then clicking through the empty candidate's profile tabs each should read:
        | tab                   | after                | lines                                                                                                      |
        | Candidate Details     | Education            | No education details added yet / This candidate hasn't added their education details                       |
        | Track Progress        | Track Progress       | This candidate hasn't completed the psychometric assessment. A track will be assigned once results are in. |
        | Document Verification | Certifications       | No certification documents uploaded yet.                                                                   |
        | Subscription          | Subscription Details | This candidate does not have an active subscription.                                                       |
        | Candidate Details     | Desired Roles        | No desired roles selected / This candidate hasn't added their desired roles                                |
