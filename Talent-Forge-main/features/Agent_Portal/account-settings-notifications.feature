@agent-settings
Feature: Agent Portal - Account Settings and the notifications panel

  # The two Agent Portal surfaces nothing else covered: Account Settings > General and > Notifications
  # (Security's Password and Two-Factor cards are owned by Change-Password.feature and 2FA.feature and
  # are only cross-checked against the server here), and the header notifications panel beyond its
  # unread count (owned by Dashboard.feature).
  #
  # NOTHING HERE IS A LITERAL. Every expected value is read from the payload the app fetched -
  # GET /auth/settings/ and GET /notifications/ - so a change to the fixture agent's name, phone or
  # notifications cannot make a scenario stale.
  #
  # Everything is read-only except the one @mutates-notifications scenario, which marks a single
  # notification as read (harmless, but irreversible), and is excluded from the default run.

  Background:
    Given I am logged in as an agent

  # SECTION 1 - ACCOUNT SETTINGS

  @positive @smoke
  Scenario: Verify that Account Settings offers three tabs and opens on General without changing the route
    When I open Account Settings
    Then the Account Settings tabs should be exactly "General, Notifications, Security"
    And the "General" Account Settings tab should be selected
    When I choose each Account Settings tab in turn
    Then each Account Settings tab should render its own sections and the URL should stay on settings

  @positive
  Scenario: Verify that General shows exactly the basic information the server holds for the agent
    When I open Account Settings
    Then the General tab should show the agent's stored first name, last name, email, phone and nationality

  @positive
  Scenario: Verify that the Notifications and Security tabs reflect the agent's stored preferences
    When I open Account Settings
    And I choose the "Notifications" Account Settings tab
    Then the email notifications switch should match the stored preference
    When I choose the "Security" Account Settings tab
    Then the Security tab should reflect the stored two-factor state and password date

  @positive
  Scenario: Verify that the Basic Information modal opens pre-filled from the server with the email locked
    When I open Account Settings
    And I open the "basic" Account Settings edit modal
    Then the Basic Information modal should hold the agent's stored values
    And the Basic Information modal should lock the email and start with Save disabled

  @negative
  Scenario: Verify that the Basic Information modal gates Save on a valid change and discards it on every close route
    When I open Account Settings
    Then the Basic Information modal should behave as follows on each close route:
      | route  |
      | Cancel |
      | Escape |
    And no Account Settings change should have been sent to the server
    And the General tab should show the agent's stored first name, last name, email, phone and nationality

  @negative @known-issue @needs-clarification
  Scenario: Verify that the Account Preferences modal opens on the time zone the page shows
    When I open Account Settings
    And I note the time zone Account Settings shows
    And I open the "preferences" Account Settings edit modal
    Then the Account Preferences modal should preselect the noted time zone
    And no Account Settings change should have been sent to the server

  # SECTION 2 - THE NOTIFICATIONS PANEL

  @positive
  Scenario: Verify that each notifications tab renders the list its own request returned
    When I open the notifications panel
    Then the notifications panel tabs should each render the server's list:
      | tab    | filter      |
      | Unread | unread only |
      | All    | everything  |

  @positive
  Scenario: Verify that Load more appends the next page of notifications in order
    When I open the notifications panel
    And I load more notifications
    Then the notifications panel should request the next page and append exactly what it returned

  @positive
  Scenario: Verify that Go To Settings leaves the panel for the Notifications settings tab
    When I open the notifications panel
    And I follow Go To Settings from the notifications panel
    Then I should be on Account Settings with the "Notifications" tab selected
    And the notifications panel should be closed

  @positive
  Scenario: Verify that the notifications panel closes on Escape and on its close control without marking anything read
    When I open the notifications panel
    Then the notifications panel should close on each route without marking anything read:
      | route         |
      | Escape        |
      | close control |

  @edge-case @needs-clarification
  Scenario: Verify that the notifications shown to an agent record the audience they are addressed to
    When I open the notifications panel
    Then the audience of the listed notifications should be reported for the PO

  @positive @mutates-notifications
  Scenario: Verify that marking one notification as read removes it from Unread and lowers the count by one
    When I open the notifications panel
    And I note the server's unread notification count
    And I mark the first unread notification as read
    Then the server's unread notification count should be one lower
    And the Unread tab label should show the new count
