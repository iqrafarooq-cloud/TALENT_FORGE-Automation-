# #ALL PASSED
# @onboarding @shared-inbox @creates-accounts
# Feature: Onboarding Flow
#   # Reaching the onboarding wizard requires a brand-new, email-verified, logged-in
#   # account, and finishing (or fully skipping) onboarding is one-way per account.
#   # The Background therefore provisions a fresh account for every scenario:
#   # signup -> IMAP email verification -> login -> /onboarding.

#   Background:
#     Given a new verified user has reached the onboarding screen
#   # ==================== POSITIVE / END-TO-END ====================

#   @e2e @positive
#   Scenario: User completes all 6 onboarding steps and reaches Getting Started
#     Then the onboarding "Step 1 of 6" should be displayed
#     When the user selects the "Student" profile type
#     And the user proceeds to the next onboarding step
#     When the user fills in the education details
#     And the user proceeds to the next onboarding step
#     When the user fills in the work experience details
#     And the user proceeds to the next onboarding step
#     When the user fills in the certification details
#     And the user proceeds to the next onboarding step
#     When the user fills in the work preferences details
#     And the user proceeds to the next onboarding step
#     When the user selects role interests
#     And the user finishes onboarding
#     Then the user should land on the getting started page
#     And the profile completion should not be "0%"
#   # ==================== SKIP ALL ====================

#   @skip-all-steps @positive
#   Scenario: User skips every step and still lands on the Getting Started page
#     When the user skips all onboarding steps
#     Then the user should land on the getting started page
#     And the profile completion should be "0%"
#   # ==================== NEGATIVE / VALIDATION ====================

#   @negative
#   Scenario: Step 1 - Next stays disabled until a profile type is chosen
#     Then the onboarding "Step 1 of 6" should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user selects the "Student" profile type
#     Then the onboarding "Next" button should be enabled

#   @negative
#   Scenario: Step 2 - Next stays disabled until required education details are filled
#     When the user selects the "Student" profile type
#     And the user proceeds to the next onboarding step
#     Then the onboarding "Step 2 of 6" should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user fills in the education details
#     Then the onboarding "Next" button should be enabled

#   @negative
#   Scenario: Step 3 - "I currently work here" removes the End Date and enables Next
#     When the user skips to onboarding step 3
#     Then the onboarding "Step 3 of 6" should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user fills in the work experience details
#     Then the End Date fields should not be displayed
#     And the onboarding "Next" button should be enabled

#   @negative
#   Scenario: Step 4 - Next stays disabled until required certification details are filled
#     When the user skips to onboarding step 4
#     Then the onboarding "Step 4 of 6" should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user fills in the certification details
#     Then the onboarding "Next" button should be enabled

#   @negative
#   Scenario: Step 5 - location is required and opting to relocate reveals preferred locations
#     When the user skips to onboarding step 5
#     Then the onboarding "Step 5 of 6" should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user selects the location "Riyadh"
#     Then the onboarding "Next" button should be enabled
#     When the user selects "Yes" for relocation
#     Then the Preferred Work Location(s) field should be displayed
#     And the onboarding "Next" button should be disabled
#     When the user selects the preferred work location "Jeddah"
#     Then the onboarding "Next" button should be enabled

#   @negative
#   Scenario: Step 6 - Finish stays disabled until at least one role interest is selected
#     When the user skips to onboarding step 6
#     Then the onboarding "Step 6 of 6" should be displayed
#     And the onboarding "Finish" button should be disabled
#     When the user selects role interests
#     Then the onboarding "Finish" button should be enabled
