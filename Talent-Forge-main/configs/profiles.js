// Every named run selection the suite offers - the Playwright successor of cucumber.js's profiles.
//
// >>> THE TAG EXPRESSIONS BELOW WERE COPIED VERBATIM FROM cucumber.js WHEN CUCUMBER WAS REMOVED
//     (2026-10-06), and selection parity was measured per profile before it was deleted. Each
//     profile is DATA: a Cucumber-style tag expression, optionally the feature files it is limited
//     to, and optionally env defaults. configs/run-playwright.js applies it:
//
//       npm run test:dashboard          ->  node configs/run-playwright.js --profile agentDashboard
//       node configs/run-playwright.js --profile promo --tags "not @known-issue"   (ANDed, as before)
//
// HOW A PROFILE IS APPLIED. playwright-bdd filters by tag at GENERATION time, so the profile's
// expression (ANDed with NEVER_RUN in configs/playwright.config.js) decides which scenarios are
// compiled into .features-gen/<profile>/ at all. Boolean tag expressions therefore work exactly as
// they did under Cucumber - Playwright's own --grep could only approximate them with regexes.
//
// FIELDS
//   tags      Cucumber tag expression. Required.
//   paths     feature files (repo-relative) the profile is limited to. Omitted = every feature.
//   env       defaults for this profile only. A value the caller already exported always wins.
//   workers   a worker count this profile prefers when PARALLEL is not set.
//   listOnly  the scenarios cannot RUN (their steps are 'pending' stubs that Playwright would
//             report as PASSED) - the profile only lists them.
//
// WHAT CHANGED VS cucumber.js, ON PURPOSE:
//   default        also excludes @videosmoke. That feature exists only to prove the old Cucumber
//                  video hook wrote a .webm for a FAILING scenario, so it fails by design and was
//                  a permanent red in every default run. Run it by naming its file.
//   notAutomatable listOnly: true (see above).
//   docVerifyFast  its env defaults used to live in configs/run-tests.js (PROFILE_ENV_DEFAULTS).
//
// Adding a profile: add an entry here and an npm script calling --profile <name>. Then run
// `node scripts/check-profile-selection.js` to see what it selects.
const PROFILES = {
  default: {tags: "not @videosmoke and not @not-automatable and not @consumes-promo and not @creates-community and not @mutates-agent and not @mutates-email and not @mutates-candidate and not @doc-verification and not @candidate-e2e and not @bulk-upload and not @invite-candidate and not @submits-request and not @mutates-profile and not @commits-decision and not @creates-agent and not @mutates-notifications and not @impersonates-agent"},
  promoUsage: {tags: "@consumes-promo"},
  provision: {tags: "@provision and not @invite-candidate"},
  known: {tags: "@known-issue"},
  notAutomatable: {tags: "@not-automatable", listOnly: true},
  promo: {tags: "(@promo-lifecycle or @promo-tools) and not @not-automatable and not @consumes-promo"},
  promoAll: {tags: "(@promo-lifecycle or @promo-tools or @subscription) and not @not-automatable"},
  only: {tags: "not @not-automatable"},
  contactUs: {tags: "not @not-automatable",paths: ["features/Candidate_Portal/Contact-us.feature"]},
  contactUsReadOnly: {tags: "not @not-automatable and not @submits-request",paths: ["features/Candidate_Portal/Contact-us.feature"]},
  candidateViewProfile: {tags: "not @not-automatable",paths: ["features/Agent_Portal/candidate-view-profile.feature"]},
  candidateViewProfileReadOnly: {tags: "not @not-automatable and not @mutates-profile",paths: ["features/Agent_Portal/candidate-view-profile.feature"]},
  candidateDetails: {tags: "not @not-automatable",paths: ["features/Candidate_Portal/Candidate-Details.feature"]},
  candidateDetailsReadOnly: {tags: "not @not-automatable and not @mutates-profile",paths: ["features/Candidate_Portal/Candidate-Details.feature"]},
  auditLogs: {tags: "not @not-automatable",paths: ["features/SuperAdmin_Portal/Audit-Logs.feature"]},
  requireAttention: {tags: "not @not-automatable",paths: ["features/Agent_Portal/require-attention.feature"]},
  candidateDeactivated: {tags: "not @not-automatable",paths: ["features/Agent_Portal/candidate-deactivated.feature"]},
  verifications: {tags: "not @not-automatable",paths: ["features/Agent_Portal/verifications.feature"]},
  agentDashboard: {tags: "not @not-automatable",paths: ["features/Agent_Portal/Dashboard.feature"]},
  agentDashboardReadOnly: {tags: "not @not-automatable and not @commits-decision and not @creates-agent",paths: ["features/Agent_Portal/Dashboard.feature"]},
  agentSettings: {tags: "not @not-automatable",paths: ["features/Agent_Portal/account-settings-notifications.feature"]},
  agentSettingsReadOnly: {tags: "not @not-automatable and not @mutates-notifications",paths: ["features/Agent_Portal/account-settings-notifications.feature"]},
  activityLog: {tags: "not @not-automatable",paths: ["features/Agent_Portal/activity-log.feature"]},
  emptyState: {tags: "not @not-automatable",paths: ["features/Agent_Portal/Empty-state.feature"]},
  inProgress: {tags: "not @not-automatable and not @provision",paths: ["features/Agent_Portal/inprogress-search_filters.feature"]},
  candidateE2E: {tags: "not @not-automatable",paths: ["features/Agent_Portal/candidate_onboarding_e2e.feature"]},
  bulkUpload: {tags: "not @not-automatable",paths: ["features/Agent_Portal/invite-candidate-bulk_upload.feature"]},
  bulkUploadReadOnly: {tags: "not @not-automatable and not @send-invite and not @e2e and not @creates-candidates",paths: ["features/Agent_Portal/invite-candidate-bulk_upload.feature"]},
  inviteCandidate: {tags: "not @not-automatable",paths: ["features/Agent_Portal/Invite-candidate.feature"]},
  inviteCandidateReadOnly: {tags: "not @not-automatable and not @send-invite",paths: ["features/Agent_Portal/Invite-candidate.feature"]},
  welcomeOnboarding: {tags: "not @not-automatable and not @provision",paths: ["features/Agent_Portal/invite-candidate_welcome_onboarding.feature"]},
  welcomeOnboardingProvision: {tags: "@provision and not @not-automatable",paths: ["features/Agent_Portal/invite-candidate_welcome_onboarding.feature"]},
  community: {tags: "@community and not @not-automatable and not @creates-community"},
  communityCreate: {tags: "@creates-community"},
  agent: {tags: "@agent-management and not @not-automatable and not @mutates-agent and not @mutates-email and not @impersonates-agent"},
  editEmail: {tags: "@edit-email and not @mutates-email and not @not-automatable"},
  editEmailE2E: {tags: "@edit-email and @mutates-email"},
  candidateManagement: {tags: "@candidate-management and not @not-automatable and not @mutates-candidate"},
  candidateMutating: {tags: "@mutates-candidate"},
  agentMutating: {tags: "@mutates-agent"},
  userManagement: {tags: "(@agent-management or @candidate-management) and not @not-automatable and not @mutates-agent and not @mutates-email and not @mutates-candidate and not @impersonates-agent"},
  agentRowActions: {tags: "@agent-row-actions and not @not-automatable and not @impersonates-agent"},
  agentLoginAs: {tags: "@impersonates-agent"},
  agentAnalytics: {tags: "@agent-analytics and not @not-automatable"},
  candidateAnalytics: {tags: "@candidate-analytics and not @not-automatable"},
  agentView: {tags: "@agent-view and not @not-automatable and not @mutates-agent"},
  agentViewE2E: {tags: "@agent-view and @mutates-agent"},
  agentProfileCandidates: {tags: "@agent-profile-candidates and not @not-automatable and not @mutates-email"},
  agentProfileCandidatesE2E: {tags: "@agent-profile-candidates and @mutates-email"},
  superadminViewProfile: {tags: "not @not-automatable",paths: ["features/SuperAdmin_Portal/UserManagement/View-Profile.feature"]},
  userManagementEdges: {tags: "@user-management-edges and not @not-automatable"},
  agentEmails: {tags: "@agent-email and not @not-automatable",workers: 2},
  twofa: {tags: "@2fa and not @not-automatable"},
  changePassword: {tags: "@change-password and not @not-automatable"},
  docVerify: {tags: "@doc-verification and not @creates-profile-entry and not @mutates-document and not @not-automatable"},
  docVerifyUpload: {tags: "@creates-profile-entry"},
  docVerifyUi: {tags: "@doc-verification and not @creates-profile-entry and not @mutates-document and not @not-automatable"},
  docVerifyWalkthrough: {tags: "@doc-verification and @walkthrough"},
  docVerifyDecisions: {tags: "@doc-verification and @mutates-document"},
  docVerifyFast: {tags: "@doc-verification and not @creates-profile-entry and not @mutates-document and not @not-automatable", env: {DOC_UPLOAD_MODE: "api", HEADED: "false"}},
  docAll: {tags: "@doc-verification and not @not-automatable"},
  docLifecycle: {tags: "@status-lifecycle and not @not-automatable"},
  docLifecycleReadOnly: {tags: "@status-lifecycle and not @mutates-document and not @creates-profile-entry and not @not-automatable"},
  mocked: {tags: "@mocked"},
};

module.exports = { PROFILES };
