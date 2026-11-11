@superadmin @agent-management @agent-view @reassign-candidates
Feature: SuperAdmin User Management - Reassign candidates from an agent's profile

  Background:
    Given I am logged in as the superadmin
  # ==================== SELECTION ====================

  @positive @smoke
  Scenario: Verify that every candidate row can be selected and the selection bar counts the current page
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    Then every candidate row should carry a checkbox and the header a master checkbox
    And selecting the profile's candidates should count the selection and offer Reassign and Clear selection, sending nothing

  @positive
  Scenario: Verify that a full page can be extended to every candidate the agent holds
    Given I have picked an agent who holds more than one page of candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I tick the master checkbox on the profile's Candidates tab
    Then the selection bar should read "10 of 10 selected."
    And the bar should offer "Select all [N] candidates assigned to [Agent Name]" for that agent's total
    When I choose to select every candidate assigned to the agent
    Then the selection bar should read "All [N] candidates assigned to [Agent Name] are selected."
    And selecting should have sent nothing to the server

  @edge-case
  Scenario: Verify that the select-all prompt is not offered when every candidate fits on one page
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I tick the master checkbox on the profile's Candidates tab
    Then the bar should offer no "Select all" prompt

  @edge-case
  Scenario: Verify that unticking one candidate after selecting all no longer claims every candidate is selected
    Given I have picked an agent who holds more than one page of candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I tick the master checkbox on the profile's Candidates tab
    And I choose to select every candidate assigned to the agent
    And I untick the first candidate on the profile
    Then the selection bar should read "9 of 10 selected."

  @edge-case @needs-clarification
  Scenario: Verify that a selection does not carry over to the next page of candidates
    Given I have picked an agent who holds more than one page of candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I tick the master checkbox on the profile's Candidates tab
    And I go to the next page of the profile's candidates
    Then no candidate on that page should be selected and no selection bar should be shown

  @edge-case
  Scenario: Verify that an agent with no candidates offers nothing to select or reassign
    Given I have picked an agent on the "Active" tab who holds no candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    Then the profile's Candidates tab should offer no checkbox and no "Reassign candidates"
  # ==================== THE REASSIGN CANDIDATE MODAL ====================

  @positive
  Scenario: Verify that the modal describes exactly what is being reassigned for one, several and all candidates
    Given I have picked an agent who holds more than one page of candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    Then the Reassign Candidate modal should describe each selection:
      | selection | wording                                                                                                                   |
      | one       | You’re reassigning [Candidate Name] from [Agent Name] to another agent within the same university hub.                    |
      | several   | You’re reassigning [N] selected candidates from [Agent Name] to another agent within the same university hub.             |
      | all       | You’re reassigning all [N] candidates currently assigned to [Agent Name] to another agent within the same university hub. |

  @positive
  Scenario: Verify that the modal locks the university to the agent's own and requires a New Agent before Reassign
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I select the first candidate on the profile and choose "Reassign candidates"
    Then the Reassign Candidate dialog should name that candidate and the agent
    And the Reassign Candidate dialog should lock the university to the agent's own
    And the New Agent field should be marked required
    And "Reassign" should stay disabled until a new agent is chosen

  @negative
  Scenario: Verify that leaving the modal any way reassigns nothing and keeps the selection
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I select the first candidate on the profile and choose "Reassign candidates"
    Then leaving the Reassign Candidate dialog each of these ways should send nothing and keep the selection:
      | method |
      | Cancel |
      | X icon |
      | Escape |
    And the agent's candidates should be unchanged on the server
  # ==================== THE NEW AGENT PICKER ====================

  @positive
  Scenario: Verify that the New Agent picker offers only active agents of the same university, never the source agent
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I select the first candidate on the profile and choose "Reassign candidates"
    Then the Reassign agent picker should ask the server for the university's active agents
    And searching the Reassign agent picker should be sent to the server and offer only matching agents
    And the Reassign agent picker should never offer the agent the candidate is leaving
    And the Reassign agent picker should never offer an agent of that university who is:
      | tab         |
      | Deactivated |
      | Invite Sent |

  @negative @known-issue
  Scenario: Verify that the New Agent picker lets the superadmin reach every active agent of the university
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I select the first candidate on the profile and choose "Reassign candidates"
    Then the Reassign agent picker should be able to list every active agent of the university

  @negative @known-issue
  Scenario: Verify that a New Agent search matching nobody says the search found nothing
    Given I have picked an agent on the "Active" tab who holds candidates
    When I view that agent from the "Active" tab and record what the server sends
    And I open the "Candidates" profile tab
    And I select the first candidate on the profile and choose "Reassign candidates"
    Then a Reassign agent search matching nobody should say the search found nothing, not that the university has no agents
  # ==================== AUDIT LOG (read-only, an existing entry) ====================

  @positive
  Scenario: Verify that a reassignment in the Audit Log opens Log Details with the entity and the transfer
    Given I have found the latest candidate reassignment in the Audit Log
    When I open that reassignment's Log Details
    Then Log Details should show that reassignment as the server recorded it
  # ==================== END TO END (committing, throwaway agents) ====================

  @positive @e2e @mutates-agent @provision
  Scenario: Verify that candidates reassigned from the profile move between agents at once and are audited
    Given I have provisioned a throwaway agent to manage from its profile
    And I have found an abandoned throwaway agent holding candidates to reassign from
    When I reassign the first 2 candidates of the original agent to the throwaway agent
    Then the Reassign modal should have said "You’re reassigning 2 selected candidates from [Agent Name] to another agent within the same university hub."
    And the reassignment should be confirmed by the server
    And the original agent's Candidates tab should drop the moved candidates without a reload
    And the moved candidates should be listed on the throwaway agent's profile and no longer on the original agent's
    And the Audit Log should record 2 candidates moved from the original agent to the throwaway agent
    When I reassign the first moved candidate back to the original agent
    Then the Reassign modal should have said "You’re reassigning [Candidate Name] from [Agent Name] to another agent within the same university hub."
    And the reassignment should be confirmed by the server
    And the Audit Log should record 1 candidate moved from the throwaway agent to the original agent
    When I reassign the remaining moved candidate back to the original agent
    Then the reassignment should be confirmed by the server
    And every moved candidate should be listed on the original agent's profile again
