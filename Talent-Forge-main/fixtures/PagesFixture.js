// The `pages` fixture — the playwright-bdd replacement for the page-object wiring that
// used to live in features/support/hooks.js's `Before` block.
//
// WHY A FIXTURE AND NOT A HOOK. Cucumber gave every scenario one `World` and one hook that
// built the whole page-object set onto `this.pages`. Playwright has no such hook: a scenario
// gets whatever FIXTURES it asks for, set up before the test body and torn down after. So the
// wiring becomes a fixture, and `world.pages` (see WorldFixture.js) is fed from it — which is
// what keeps every existing `this.pages.dashboard` step working untouched.
//
// >>> THE SET HERE IS DELIBERATELY IDENTICAL TO WHAT hooks.js WIRED, INCLUDING THE OMISSIONS.
//     Three page objects are NOT here and must not be added:
//       - LoginPage            — step files construct it against whichever page they are
//                                driving (the agent's, the superadmin's, an invited agent's),
//                                so a single shared instance would be wrong.
//       - AdminPromoToolsPage  — drives the SUPERADMIN portal, which needs its own browser
//                                context (the app holds one session per context, and an agent
//                                session on /agents/view/<id> is bounced to /unauthorized).
//                                referral-codes.steps.js / promo-lifecycle.steps.js open that
//                                context on demand and close it in their own After hook.
//       - NotificationsPage    — role-agnostic and opened on demand by the features that read
//                                a bell, against whichever session they already hold.
//     Adding any of them here would bind them to the scenario's own page and silently change
//     which session those features drive.
const { test: base } = require('playwright-bdd');

const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const DashboardPage = require('../pages/DashboardPage');
const SignupPage = require('../pages/SignupPage');
const OnboardingPage = require('../pages/OnboardingPage');
const ActiveCandidatePage = require('../pages/ActiveCandidatePage');
const RequiresAttentionPage = require('../pages/RequiresAttentionPage');
const DeactivatedCandidatePage = require('../pages/DeactivatedCandidatePage');
const ActivityLogPage = require('../pages/ActivityLogPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const ChangePasswordPage = require('../pages/ChangePasswordPage');
const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
const InviteAgentPage = require('../pages/InviteAgentPage');
const AgentsListingPage = require('../pages/AgentsListingPage');
const AgentProfilePage = require('../pages/AgentProfilePage');
const CandidatesListingPage = require('../pages/CandidatesListingPage');
const AgentProfileCandidatesPage = require('../pages/AgentProfileCandidatesPage');
const CandidateDetailPanelPage = require('../pages/CandidateDetailPanelPage');
const CommunityPage = require('../pages/CommunityPage');
const CommunityFormPage = require('../pages/CommunityFormPage');
const TwoFactorAuthPage = require('../pages/TwoFactorAuthPage');
const AgentVerificationsPage = require('../pages/AgentVerificationsPage');
const CandidateDocumentsPage = require('../pages/CandidateDocumentsPage');
const CandidateProfilePage = require('../pages/CandidateProfilePage');
const ContactUsPage = require('../pages/ContactUsPage');
const CandidateDetailsPage = require('../pages/CandidateDetailsPage');
const CandidateViewProfilePage = require('../pages/CandidateViewProfilePage');
const AuditLogsPage = require('../pages/AuditLogsPage');
const AgentSettingsPage = require('../pages/AgentSettingsPage');
const AgentAnalyticsPage = require('../pages/AgentAnalyticsPage');
const CandidateAnalyticsPage = require('../pages/CandidateAnalyticsPage');

const test = base.extend({
  pages: async ({ page }, use) => {
    const pages = {
      forgotPassword: new ForgotPasswordPage(page),
      dashboard: new DashboardPage(page),
      signup: new SignupPage(page),
      onboarding: new OnboardingPage(page),
      activeCandidate: new ActiveCandidatePage(page),
      // Candidates > In Progress. Its own page object rather than a mode on
      // ActiveCandidatePage: the two tabs share a shell but not a single column, filter
      // group, empty state or row action.
      inProgress: new InProgressCandidatePage(page),
      // Candidates > Requires Attention - three severity tabs, its own three filter
      // groups, two distinct empty states, and only two row actions (no bell).
      requiresAttention: new RequiresAttentionPage(page),
      // Candidates > Deactivated - no tab strip at all, its own three filter groups (one
      // of them a radio group), and exactly ONE row action: View. No reactivate control
      // anywhere, which is what keeps the whole area read-only.
      deactivatedCandidate: new DeactivatedCandidatePage(page),
      // Activity Log - the agent's OWN activity trail at /activity-log. Not a grid: no
      // columns, no rows, no row action. Two controls (a search box and a date-range
      // dropdown) and infinite scroll instead of a pager.
      activityLog: new ActivityLogPage(page),
      // The Agent Portal's candidate-onboarding modal stack: the first-time welcome modal,
      // the "Choose how you want to onboard your candidates:" chooser, and the Agent Code /
      // Invite via Email modals it opens.
      candidateOnboarding: new CandidateOnboardingPage(page),
      changePassword: new ChangePasswordPage(page),
      subscription: new SubscriptionPage(page),
      referralCodes: new ReferralCodesPage(page),
      inviteAgent: new InviteAgentPage(page),
      agentsListing: new AgentsListingPage(page),
      agentProfile: new AgentProfilePage(page),
      // The SUPERADMIN's candidate list at /candidates; the agent portal's own lists are
      // activeCandidate / inProgress above.
      candidatesListing: new CandidatesListingPage(page),
      // The agent profile's Candidates tab (/agents/view/<id>?tab=candidates). It reuses the
      // Candidates listing's dialog readers - see the header of AgentProfileCandidatesPage.
      agentProfileCandidates: new AgentProfileCandidatesPage(page),
      // The candidate View drawer opened by the listing's "View" row action. It has no
      // route of its own - see the header of CandidateDetailPanelPage.
      candidateDetailPanel: new CandidateDetailPanelPage(page),
      // Community runs on the scenario's own page for BOTH roles — /community and
      // /community/view/<id> are the same two routes for the superadmin and the candidate.
      community: new CommunityPage(page),
      communityForm: new CommunityFormPage(page),
      twoFactorAuth: new TwoFactorAuthPage(page),
      // AI document verification spans both portals over the same two surfaces.
      agentVerifications: new AgentVerificationsPage(page),
      candidateDocuments: new CandidateDocumentsPage(page),
      // Profile > Candidate Details is where documents are UPLOADED; CandidateDocumentsPage
      // only READS what already exists.
      candidateProfile: new CandidateProfilePage(page),
      // Candidate Portal > Contact Us. A modal opened from the sidebar, not a route.
      contactUs: new ContactUsPage(page),
      // Candidate Portal > Profile > Candidate Details. Distinct from candidateProfile above -
      // see the header of CandidateDetailsPage.js for why the two are deliberately separate.
      candidateDetails: new CandidateDetailsPage(page),
      // The AGENT PORTAL's read-only view of one of their candidates -
      // /candidates/<id>/view-profile, opened by the "View" row action. Distinct from BOTH
      // candidateDetails (the candidate's own editable profile) and candidateDetailPanel (the
      // superadmin's drawer) - see the header of CandidateViewProfilePage.js.
      candidateViewProfile: new CandidateViewProfilePage(page),
      // SuperAdmin Portal > Audit Logs. One role, one page, no second context.
      auditLogs: new AuditLogsPage(page),
      // Agent Portal > Account Settings and the header notifications panel.
      agentSettings: new AgentSettingsPage(page),
      // SuperAdmin Portal > Analytics > Agents (/agents-analytics) - the superadmin's landing page.
      agentAnalytics: new AgentAnalyticsPage(page),
      // SuperAdmin Portal > Analytics > Candidates (/candidate-analytics).
      candidateAnalytics: new CandidateAnalyticsPage(page),
    };

    // >>> HAS TO HAPPEN BEFORE THE FIRST NAVIGATION. The reminder state and both duration
    //     bands exist ONLY in the In Progress list endpoint's payload (the table renders
    //     neither), so a response missed because the listener was attached late is an
    //     assertion that cannot be made at all. A fixture is set up before the test body
    //     runs, which is exactly the guarantee hooks.js's `Before` used to give.
    pages.inProgress.install();
    // Same reason, and additionally: the Requires Attention defect under test is an action
    // that fires NO request, which a late listener cannot distinguish from a missed one.
    pages.requiresAttention.install();
    // Same reason, plus one of its own: this log also captures the profile payload of
    // whichever candidate the View action opened, which is the only thing that can answer
    // "did View open the RIGHT candidate" rather than merely "a profile opened".
    pages.deactivatedCandidate.install();
    // Sharpest form of the same reason: TWO of the Activity Log behaviours asserted are an
    // action that correctly fires NO request (re-picking the applied range, clearing an
    // already-empty search), and an absence cannot be measured by a listener attached late.
    pages.activityLog.install();
    // The dashboard compares every render against the payload the app fetched, and asserts that
    // some actions fire no request - so its log must run before the first navigation too.
    pages.dashboard.install();
    // Same reason again: a whitespace-only search and opening the View log dialog both
    // correctly fire NO request, and that absence is the assertion - so the log has to be
    // running before the first navigation for it to mean anything.
    pages.auditLogs.install();
    // Opening and cancelling a Settings edit modal must WRITE nothing - an absence, so the log
    // has to be running before the first navigation for it to mean anything.
    pages.agentSettings.install();
    // The dashboard fires all nine widget requests on its first paint (the superadmin LANDS here),
    // and every assertion compares a render with the response behind it.
    pages.agentAnalytics.install();
    // Same reason for the Candidates dashboard: five widget requests fire on its first paint.
    pages.candidateAnalytics.install();
    // Sharpest form of the same reason: TWO of the agent profile's tabs correctly fire NO
    // request at all (Candidate Details and Document Verification re-render the payload
    // fetched when the profile opened), and that absence is the assertion. The log also
    // captures the profile payload every cross-portal comparison is made against.
    pages.candidateViewProfile.install();
    // Same again for the Verifications queue: re-picking the applied tab and opening the review
    // panel both correctly fire NO request, and those absences are the assertion.
    pages.agentVerifications.install();

    await use(pages);
  },
});

module.exports = { test };
