@candidate-management @superadmin @candidate-listing-values
Feature: SuperAdmin User Management - Candidates: cell values, row entry points, help and email icons, search scope, keyboard and sidebar

  # Closes the gaps left by the other Candidates files (review of 2026-11-02). Everything here is
  # READ-ONLY: dialogs are opened and dismissed, nothing is confirmed, so the file is in the
  # default run. Every value is compared with the response the app itself received - never with
  # literals - because the listing is shared, growing DEV data.
  #
  # Measured 2026-11-02 (read-only probes):
  #   - payload per row: full_name, email, is_verified, is_email_verified, pending_documents_count,
  #     subscription_status, last_login, agent_name, agent_email, account_status, pending_email
  #   - the Candidate and Agent cells hold two real <button>s each (name, email) that do nothing
  #   - the "Account Verification" header carries an unnamed help icon whose tooltip reads
  #     "Candidates earn the Verified badge once their transcript is reviewed and approved."
  #   - a warning icon appears beside the candidate's email on EVERY row whose is_email_verified
  #     is false, and its tooltip reads "Email update will take effect once the new email is
  #     verified by the candidate." although those rows hold no pending change (pending_email null)
  #   - the search matches the candidate's own name and email, word by word, never the Agent column

  Background:
    Given I am logged in as the superadmin

  # ==================== CELL VALUES ====================

  @positive
  Scenario: Verify that every candidate row shows the server's values in every column
    Then every candidate row should show the server's values on each of these pages:
      | tab         | page |
      | All         | 1    |
      | Active      | 1    |
      | Deactivated | 1    |
      | All         | 2    |

  @positive
  Scenario: Verify that every verification and subscription state is rendered with its own label
    Then each of these candidate filters should list only rows rendering its label:
      | group                       | option         | column               | label          |
      | Account Verification Status | Verified       | Account Verification | Verified       |
      | Account Verification Status | Unverified     | Account Verification | Unverified     |
      | Subscription Status         | Subscribed     | Subscription Status  | Subscribed     |
      | Subscription Status         | Not Subscribed | Subscription Status  | Not Subscribed |
      | Subscription Status         | Payment Due    | Subscription Status  | Payment Due    |

  # ==================== ROW ENTRY POINTS ====================

  # Measured: all four are focusable <button>s and none of them does anything. Asserted as
  # measured; ask the PO whether the agent's name should open that agent's profile.
  @positive @needs-clarification
  Scenario: Verify that the candidate's and the agent's name and email in a row open nothing
    Given I am on the "All" candidates tab
    Then clicking each of these in the first candidate row should open nothing and send nothing:
      | cell      | part  |
      | Candidate | name  |
      | Candidate | email |
      | Agent     | name  |
      | Agent     | email |

  # ==================== ACCOUNT VERIFICATION HELP ICON ====================

  @positive
  Scenario: Verify that the help icon on the "Account Verification" column explains the column on hover and keyboard focus
    Given I am on the "All" candidates tab
    Then the help icon on the "Account Verification" column should show "Candidates earn the Verified badge once their transcript is reviewed and approved." on hover and on keyboard focus

  @negative @known-issue
  Scenario: Verify that the help icon on the "Account Verification" column has an accessible name
    Given I am on the "All" candidates tab
    Then the help icon on the "Account Verification" column should have an accessible name

  # ==================== EMAIL WARNING ICON ====================

  @positive
  Scenario: Verify that the email warning icon appears exactly on candidates whose email is not verified or has a change pending
    Then the email warning icon should appear exactly on the rows the server marks as unverified or pending

  # The icon is shown for an unverified sign-up email, but its tooltip describes a pending email
  # CHANGE that does not exist. Ask the PO for the intended wording.
  @negative @known-issue @needs-clarification
  Scenario: Verify that the warning icon on an unverified email does not claim an email update is pending
    Given I have found a candidate whose email is unverified with no change pending
    Then that candidate's email warning icon should not describe a pending email update

  @negative @known-issue
  Scenario: Verify that the email warning icon has an accessible name
    Given I have found a candidate whose email is unverified with no change pending
    Then that candidate's email warning icon should have an accessible name

  # ==================== SEARCH SCOPE ====================

  # Same wording the PO confirmed as intended on Requires Attention and Deactivated, although the
  # search also matches an email.
  @positive
  Scenario: Verify that the candidate search placeholder reads "Search by candidate name..."
    Given I am on the "All" candidates tab
    Then the candidate search placeholder should read "Search by candidate name..."

  @negative
  Scenario: Verify that searching for an agent finds only candidates whose own name or email matches
    Given I have noted a candidate whose own name and email do not mention their agent
    Then searching the candidates for that candidate's agent should return only candidates matching in their own name or email:
      | term             |
      | agent email      |
      | agent full name  |

  # ==================== KEYBOARD ====================

  @positive
  Scenario: Verify that every row action can be reached with the arrow keys and opened with Enter
    Then each candidate row action should be reachable by keyboard and open its dialog, sending nothing:
      | tab         | action             | opens                         |
      | All         | View               | Candidate Details             |
      | All         | Edit               | Update Email Address          |
      | All         | Deactivate account | Deactivate Candidate Account  |
      | Deactivated | Reactivate Account | Re-activate Account           |

  # ==================== SIDEBAR ====================

  @positive
  Scenario: Verify that the Candidates link under User Management opens the Candidates listing on its All tab
    Given I am on the Agents listing
    When I open Candidates from the User Management sidebar
    Then the Candidates listing should open on its All tab with no search or filter

  # Measured 2026-11-02 (twice): the URL becomes a bare /candidates, but the screen stays on the
  # Deactivated tab with the search and the filter applied and no list request is sent - the same
  # defect the Agents listing's sidebar link has.
  @negative @known-issue
  Scenario: Verify that the sidebar Candidates link resets a searched and filtered Deactivated view
    Given I am on the "Deactivated" candidates tab
    And I have searched and filtered the Deactivated candidates
    When I open Candidates from the User Management sidebar
    Then the Candidates listing should open on its All tab with no search or filter

  # ==================== END TO END ====================

  @positive @e2e
  Scenario: Verify that a candidate found by search shows the same identity in the row and in the drawer opened by keyboard
    Given I have noted the first candidate on the "All" tab
    When I search the candidates for that candidate's full email
    Then the searched candidate's row should show the server's values
    When I open that candidate's View from the keyboard
    Then the drawer should show the same name and verification as the row
    When I press Escape to close the candidate drawer
    Then the candidate search box should still hold the search term
    And the searched candidate's row should show the server's values
