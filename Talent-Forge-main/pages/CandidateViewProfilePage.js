const BasePage = require('./BasePage');

// The AGENT PORTAL's candidate profile - the screen the "View" row action opens from the
// Candidates listings: `/candidates/<id>/view-profile?selectedTab=<slug>`.
//
// >>> THIS IS THE THIRD "CANDIDATE PROFILE" PAGE OBJECT IN THE REPO AND THEY ARE NOT
//     INTERCHANGEABLE. Picking the wrong one drives a different portal. <<<
//   - CandidateDetailsPage    the CANDIDATE's own `/profile?selectedTab=candidate-details`, which
//                             they EDIT. Six sections with modals, Save gating, validation.
//   - CandidateProfilePage    the same candidate route, but used only as a means to get a file
//                             onto the account for the document-verification module.
//   - CandidateDetailPanelPage the SUPERADMIN's View DRAWER on /candidates. No route of its own.
//   - THIS ONE               the AGENT's read-only view of one of THEIR candidates. A real route,
//                             five tabs, and nothing anywhere on it that writes.
//
// Everything here is READ-ONLY BY DISCIPLINE - and that wording changed on 2026-09-17, because
// the claim it replaces ("the page offers no decision control") IS FALSE, and it was the stated
// reason the whole feature is safe in the default run.
//
// >>> THE DOCUMENT VIEWER CARRIES Approve AND Request Revision, AND EITHER COMMITS
//     IRREVERSIBLY. <<< Measured: opening a "Needs Review" document from the Document
// Verification tab raises a dialog offering `agent-approve-button` and
// `agent-request-revision-button` - the same controls, under the same test ids, that
// /verifications uses, because it is the same panel component. Nothing in the product reverses
// either decision.
//
// What IS true, and what the default run actually rests on:
//   - the tab, its rows, both row actions, the viewer, its zoom and its Download are all reads;
//   - OPENING the viewer fires no request at all and writes nothing;
//   - so a scenario may open the viewer, read it and close it, and MUST NOT click those two.
// No method on this page object clicks either one, deliberately: the only scenario that commits
// a decision carries @mutates-document, is excluded from every routine profile, and drives the
// control through a label-verified click of its own. Do not add a generic decide() here.
//
// The header's two controls are still an (inert) icon button and "Reminder History", and the
// only per-row controls on Document Verification are still View and Download.
//
// ----------------------------------------------------------------------------------------------
// MEASURED 2026-09-17 (agent faran.mustafa@bytecorp.io). Re-run
// `node scripts/probe-candidate-view-profile.js` rather than reasoning about the DOM.
//
// >>> THERE IS NOT ONE `data-testid` ON THE WHOLE PAGE. <<< Measured: 0, on every tab. So every
// locator here is either a role+accessible-name or one of the app's own structural class hooks
// (`.profile-basic-details`, `.top-right-buttons-container`, `.education-section`, ...). Those
// class names ARE the stable contract on this screen; a `data-testid` selector written here
// would match nothing. The listing BEHIND it does carry testids
// (`agent-candidates-view-button`), which is why openFrom() can use one and nothing else can.
//
// >>> AND NEVER USE A react-aria ELEMENT ID. <<< They look tempting (`#react-aria2477098970-_r_b3_`
// on the header's icon button) and they are REGENERATED ON EVERY RENDER. Observed while probing:
// an id captured moments earlier resolved to the header AVATAR MENU after a tab change, so a
// click "on the link button" opened the profile dropdown instead - a wrong-element resolution
// that reads as the app misbehaving. Same trap class as a comma-separated locator union
// resolving in DOM order.
//
// ROUTE, AND THE TRAILING SLASH THAT DIFFERS BETWEEN LISTINGS:
//     Active      /candidates/<id>/view-profile?selectedTab=candidate-details
//     Deactivated /candidates/<id>/view-profile?selectedTab=candidate-details
//     Requires    /candidates/<id>/view-profile/?selectedTab=candidate-details   <-- extra "/"
// Both forms are live TODAY, so every URL assertion here tolerates both (VIEW_PROFILE_URL). A
// step pinning one form would be red from whichever listing uses the other, which says nothing
// about the product.
//
// WHICH TAB FIRES WHAT (measured; an absence here is an assertion, not a gap):
//     opening the profile     GET /candidate/profile/<id>/   <-- feeds the header, the four
//                             widgets, ALL SIX Candidate Details sections AND the whole of
//                             Document Verification
//     Candidate Details       no request - it re-renders the payload above
//     Document Verification   no request - likewise
//     Track Progress          GET /tracks/candidate/<id>/     -> 404 when the candidate has no
//                             track, and THAT IS THE NORMAL ANSWER. A scenario treating it as a
//                             failure would report every track-less candidate as broken.
//     Subscription            GET /subscription/current/<id>/  +  GET /plans/
//     Activity Log            GET /analytics/candidates/activity-logs/<id>/
//                                 ?page=1&page_size=10&duration=<value>
//     Reminder History        GET /agent/candidate/<id>/reminders/?page=1&page_size=10
// ----------------------------------------------------------------------------------------------

// A candidate row on any of the agent's listings.
const LISTING_ROW = '[role="row"]:has([role="rowheader"])';

// Tolerates the trailing-slash difference above.
const VIEW_PROFILE_URL = /\/candidates\/\d+\/view-profile\/?(\?|$)/;

class CandidateViewProfilePage extends BasePage {
  constructor(page) {
    super(page);
    const app = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(
      /\/login\/?$/,
      ''
    );
    this.origin = app;

    // ---------------------------------------------------------------- the listings that open it
    //
    // >>> IN PROGRESS IS ABSENT ON PURPOSE - IT HAS NO VIEW CONTROL. <<< Measured 2026-09-17:
    // its row actions are Resend + Reminder History, so the profile is UNREACHABLE from it. That
    // is asserted as a rule by its own scenario rather than left as a silent gap in this map; if
    // a View is added there later, that scenario goes red and this map gains a fourth entry.
    this.listings = {
      active: { url: `${app}/candidates/active`, heading: /Candidates\s*-\s*Active/i },
      deactivated: {
        url: `${app}/candidates/deactivated`,
        heading: /Candidates\s*-\s*Deactivated/i,
      },
      'requires attention': {
        url: `${app}/candidates/requires-attention`,
        heading: /Candidates\s*-\s*Requires Attention/i,
      },
      'in progress': {
        url: `${app}/candidates/in-progress`,
        heading: /Candidates\s*-\s*In Progress/i,
        noViewControl: true,
      },
    };

    this.listingRows = page.locator(LISTING_ROW);
    this.listingViewButtons = page.getByTestId('agent-candidates-view-button');
    this.listingSearch = page.getByRole('searchbox');

    // ---------------------------------------------------------------- profile chrome
    this.main = page.locator('main').first();
    this.pageHeading = page.getByRole('heading', { level: 1 });

    // The avatar band. `.profile-image-container` is present whatever the candidate has; the
    // <img alt="Profile photo"> inside it exists ONLY when profile_image is set - with no image
    // the app renders a placeholder and there is no <img> at all (measured both ways). So the
    // container is what proves the band rendered, and the img is what proves a photo was used.
    this.avatarBand = page.locator('.profile-images-container');
    this.avatarContainer = page.locator('.profile-image-container');
    this.avatarImage = this.avatarBand.getByRole('img', { name: /profile photo/i });

    // >>> "Back" IS A <p>, NOT A BUTTON OR A LINK. <<< It carries cursor:pointer and a chevron
    // svg, sits at tabIndex -1, and CANNOT BE FOCUSED even by calling focus() on it - so it is
    // unreachable by keyboard and invisible to assistive technology. Located by text inside the
    // avatar band, because there is nothing else to locate it by. See auditControls().
    this.backControl = this.avatarBand.locator('p', { hasText: /^\s*Back\s*$/ }).first();

    this.identityBlock = page.locator('.profile-basic-details');
    this.nameContainer = page.locator('.profile-basic-details .name-container');

    // The two header controls, in DOM order: [0] an icon-only button carrying a link/chain svg
    // and NO accessible name, [1] "Reminder History". Scoped to the app's own container class
    // rather than indexed off `main`, so the page shell's own buttons cannot be picked up.
    this.headerActions = page.locator('.top-right-buttons-container');
    this.headerActionButtons = this.headerActions.locator('button');
    this.reminderHistoryButton = this.headerActions.getByRole('button', {
      name: /reminder history/i,
    });

    // ---------------------------------------------------------------- tab strip
    //
    // >>> THE TABS ARE role="radio" INSIDE A role="radiogroup", NOT role="tab". <<< A
    // getByRole('tab') reader finds NOTHING on a strip that plainly renders five tabs. (The
    // candidate's own profile and the superadmin drawer do the same thing.)
    //
    // One consequence worth knowing for the a11y audit: a radiogroup is ONE tab stop for all
    // five, with arrow keys moving inside it. That is correct behaviour, not a defect.
    this.tabStrip = page.locator('[role="radiogroup"]').first();
    this.tabs = this.tabStrip.locator('[role="radio"]');

    // ---------------------------------------------------------------- Candidate Details sections
    //
    // Each section is `.details-section` plus its own modifier class, and the heading <p> is a
    // sibling of a nested <main> holding the body. NOTE the Work Preferences section's class is
    // `location-preferences-section` - it does NOT follow its heading, and guessing
    // `work-preferences-section` yields a reader that can only ever answer "absent".
    this.sectionHosts = {
      'Basic Information': page.locator('.basic-information-section'),
      Education: page.locator('.education-section'),
      'Work Experience': page.locator('.work-experience-section'),
      Certifications: page.locator('.certifications-section'),
      'Work Preferences & Availability': page.locator('.location-preferences-section'),
      'Desired Roles': page.locator('.desired-roles-section'),
    };

    // ---------------------------------------------------------------- Activity Log
    this.activityHeading = this.main.locator('p', { hasText: /^\s*Activity Log\s*$/ }).first();
    // The react-aria duration Select: a trigger <button> plus a hidden mirror <select> that
    // carries the real option VALUES (the visible popover only carries labels).
    this.activityDurationMirror = this.main.locator('select').first();
    this.activityDurationTrigger = this.main
      .locator('button')
      .filter({ hasText: /Last 24 hours|Last 7 days|Last 30 days|Last 3 months|Last 6 months|This year/ })
      .first();
    // The app's own row container, one per activity entry. Counting these is what stops the
    // reader drifting from what the page shows - see readActivityEntries().
    this.activityRows = page.locator('.activity-log-item');

    // ---------------------------------------------------------------- Reminder History dialog
    this.reminderHistoryPanel = page
      .locator('[role="dialog"]')
      .filter({ hasText: /Reminder History/i })
      .first();
  }

  // The five tabs, their rendered labels and the slug each one writes to ?selectedTab=.
  static TABS = [
    { label: 'Candidate Details', slug: 'candidate-details' },
    { label: 'Track Progress', slug: 'track-progress' },
    { label: 'Document Verification', slug: 'document-verification' },
    { label: 'Subscription', slug: 'subscription' },
    { label: 'Activity Log', slug: 'activity-log' },
  ];

  // The six Candidate Details sections, in the order the page renders them.
  static SECTIONS = [
    'Basic Information',
    'Education',
    'Work Experience',
    'Certifications',
    'Work Preferences & Availability',
    'Desired Roles',
  ];

  // The four header widgets. `suffix` is what the app appends to the figure; only the first
  // carries one. `statKey` is the field in the profile payload's `stats` block that feeds it.
  static WIDGETS = [
    { label: 'Track Progress', statKey: 'track_progress', suffix: '%' },
    { label: 'Courses Completed', statKey: 'courses_completed', suffix: '' },
    { label: 'Hours Learned', statKey: 'hours_learned', suffix: '' },
    { label: 'Certificates Earned', statKey: 'certifications_earned', suffix: '' },
  ];

  // The Activity Log duration filter. `value` is BOTH the mirror <select>'s value AND the
  // `duration` query parameter the app sends - measured, and unusual: on the Requires Attention
  // and SuperAdmin Candidates filter modals not one option's URL value equals its API value.
  //
  // The mirror additionally carries a BLANK option (value "", label " ") which the popover does
  // NOT offer, so it is not user-selectable and is not a defect. Recorded so nobody reports it.
  static DURATIONS = [
    { label: 'Last 24 hours', value: 'last_24_hours', days: 1 },
    { label: 'Last 7 days', value: 'last_7_days', days: 7 },
    { label: 'Last 30 days', value: 'last_30_days', days: 30 },
    { label: 'Last 3 months', value: 'last_3_months', days: 90 },
    { label: 'Last 6 months', value: 'last_6_months', days: 180 },
    { label: 'This year', value: 'this_year', days: 365 },
  ];

  // Document status: ONE API value can be rendered three different ways across the product, so
  // the mapping is written down rather than guessed. `AWAITING` is "Needs Review" here (the
  // agent pill), "Need Review" on the verifications filter tab, and "Awaiting Verification" in
  // the API schema's own description.
  static DOCUMENT_STATUS_LABEL = {
    APPROVED: 'Approved',
    REVISION: 'Revision Required',
    AWAITING: 'Needs Review',
  };

  // The Subscription tab's five fields, and the payload field each one must equal.
  //
  // >>> "Total Fee" IS THE AMOUNT CHARGED, NOT THE PLAN PRICE. <<< Measured: a Yearly Plan whose
  // `plan_price` is 1500 renders `895 SAR`, which is `payment.amount` after a promo. Asserting it
  // against plan_price would be red on a correct render; asserting it against "some number on the
  // page" would pass on the wrong one. See readSubscription().
  static SUBSCRIPTION_FIELDS = [
    'Status',
    'Subscription Started',
    'Current Subscription',
    'Total Fee',
    'Next Billing Date',
  ];

  // The labels each labelled section is contracted to render, in the order the page renders
  // them. readLabelledFields() reads values as "everything between this label and the next", so
  // this map is the reader's contract as well as the assertion's - see the note there.
  static FIELD_LABELS = {
    'Basic Information': [
      'Email',
      'Phone Number',
      'Current Status',
      'Nationality',
      'About Me',
    ],
    'Work Preferences & Availability': [
      'Interested Programs',
      'Current City',
      'Open to Relocation',
      'Preferred Work Location(s)',
    ],
  };

  // >>> TWO DIFFERENT PLACEHOLDER CHARACTERS, MEANING TWO DIFFERENT THINGS. <<< An unset profile
  // FIELD renders an ASCII hyphen "-"; an uncomputed STATISTIC renders an em dash "—" (widgets,
  // when `stats` is null). The candidate's own profile draws the same distinction. A reader that
  // conflates them reports an empty field as a missing statistic.
  static UNSET_FIELD = '-';
  static UNCOMPUTED_STAT = '—';

  // ---------------------------------------------------------------- request log
  //
  // Installed once per scenario from hooks.js / PagesFixture.js, BEFORE the first navigation,
  // for the same reason InProgressCandidatePage's and RequiresAttentionPage's are - and here the
  // reason is sharper than usual:
  //
  //   TWO OF THE BEHAVIOURS ASSERTED ARE TABS THAT CORRECTLY FIRE NO REQUEST AT ALL. Candidate
  //   Details and Document Verification both re-render the payload fetched when the profile
  //   opened. A `waitForResponse` there resolves to null, which is indistinguishable from a
  //   timeout, a slow network or a listener attached too late - and the absence IS the
  //   assertion. A running log tells "nothing was sent" from "something was sent and I missed
  //   it".
  //
  // The log is never reset mid-scenario; steps take an index baseline instead, so a step can ask
  // what was sent AFTER a given point without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.responses = [];

    this.page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      const url = req.url();
      if (!/\/core\/api\/v1\//.test(url)) return;
      // The notifications bell polls continuously (measured: dozens of calls a minute), which
      // would bury every request this page actually made.
      if (/\/notifications\//.test(url)) return;
      this.requests.push({ at: Date.now(), url });
    });

    // Responses are captured separately because the profile payload is the ground truth every
    // cross-portal assertion compares against, and it is fetched once, when the profile opens.
    //
    // >>> READING A BODY IS ASYNCHRONOUS AND PLAYWRIGHT DOES NOT AWAIT AN EVENT HANDLER. <<<
    // So `await page.waitForResponse(...)` resolves when the RESPONSE ARRIVES, not when this
    // handler has finished parsing it - and a step reading profilePayload() straight afterwards
    // got `null` on a profile that had loaded perfectly well. Measured on the first full run of
    // this feature: two scenarios failed reporting that the profile "was not fetched" and that
    // "no payload was captured", which reads as the app not making the call.
    //
    // Every parse is therefore tracked as a promise and `flush()` awaits the outstanding ones.
    // The settle points call it, so by the time any step runs the bodies are in.
    this._pending = [];
    this.page.on('response', (res) => {
      const url = res.url();
      if (!/\/core\/api\/v1\//.test(url) || /\/notifications\//.test(url)) return;
      const entry = { at: Date.now(), url, status: res.status(), body: null };
      this.responses.push(entry);

      const assignTo = (() => {
        if (/\/candidate\/profile\/\d+\/(\?|$)/.test(url)) return '_profilePayload';
        if (/\/subscription\/current\/\d+\/(\?|$)/.test(url)) return '_subscriptionPayload';
        if (/\/activity-logs\/\d+\//.test(url)) return '_activityPayload';
        return null;
      })();
      if (!assignTo || res.status() !== 200) return;

      const parsed = res
        .json()
        .then((body) => {
          entry.body = body;
          this[assignTo] = body;
        })
        .catch(() => {});
      this._pending.push(parsed);
      // Keep the list from growing without bound over a long scenario.
      parsed.finally(() => {
        this._pending = this._pending.filter((p) => p !== parsed);
      });
    });
  }

  // Await every response body still being parsed. Called from the settle points, so a step never
  // has to know that a body arrives after its response does.
  async flush() {
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 3 && this._pending && this._pending.length; i += 1) {
      await Promise.all([...this._pending]).catch(() => {});
    }
    /* eslint-enable no-await-in-loop */
  }

  requestCount() {
    return (this.requests || []).length;
  }

  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline);
  }

  // Every request the page made since `baseline`, with the noise already gone, as bare paths -
  // what a failure message should quote.
  pathsSince(baseline = 0) {
    return this.requestsSince(baseline).map((r) => r.url.replace(/^.*\/core\/api\/v1\//, ''));
  }

  responsesSince(baseline = 0) {
    return (this.responses || []).slice(baseline);
  }

  responseCount() {
    return (this.responses || []).length;
  }

  // The profile payload the app itself fetched. THE GROUND TRUTH for every "the agent portal
  // shows what the candidate entered" assertion: it is the candidate's own stored profile, so
  // comparing the rendering against it tests the rendering rather than testing the suite's
  // ability to re-describe the app.
  profilePayload() {
    return this._profilePayload || null;
  }

  subscriptionPayload() {
    return this._subscriptionPayload || null;
  }

  activityPayload() {
    return this._activityPayload || null;
  }

  // ---------------------------------------------------------------- opening the profile

  async openListing(which) {
    const spec = this.listings[String(which).toLowerCase()];
    if (!spec) {
      throw new Error(
        `unknown listing "${which}" - known: ${Object.keys(this.listings).join(', ')}`
      );
    }
    await this.page.goto(spec.url, { waitUntil: 'domcontentloaded' });
    await this.settleListing();
    return spec;
  }

  // The listing grid paints its rows a tick after the row skeleton, so a read taken on the grid
  // being visible finds rows with empty cells. Keys on "@" appearing in the first Candidate
  // cell, which every row has whatever its status - and resolves on rows OR an empty state, so a
  // genuinely empty listing does not hang.
  async settleListing(timeout = 25000) {
    const until = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      const rows = await this.listingRows.count().catch(() => 0);
      if (rows > 0) {
        const first = await this.listingRows
          .first()
          .innerText()
          .catch(() => '');
        if (first.includes('@')) return { rows, settled: true };
      }
      const body = await this.main.innerText().catch(() => '');
      if (/no candidates|nothing here yet|no results found/i.test(body)) {
        return { rows: 0, settled: true, empty: true };
      }
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return { rows: await this.listingRows.count().catch(() => 0), settled: false };
  }

  async listingHasViewControl() {
    return (await this.listingViewButtons.count()) > 0;
  }

  // The row actions offered on a listing row, by accessible name. Used by the scenario that
  // asserts In Progress offers no View - it reports what IS offered, so a red row says what the
  // product does instead of only what it does not.
  async listingRowActions(index = 0) {
    const row = this.listingRows.nth(index);
    const buttons = row.locator('button');
    const n = await buttons.count();
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const b = buttons.nth(i);
      /* eslint-disable no-await-in-loop */
      const name = (await b.getAttribute('aria-label')) || (await b.innerText()).trim();
      const testid = await b.getAttribute('data-testid');
      const disabled = await b.isDisabled().catch(() => false);
      /* eslint-enable no-await-in-loop */
      // The candidate name and email in the rowheader are themselves <button>s; only the
      // Actions-column controls carry an aria-label or a testid.
      if (testid || (await b.getAttribute('aria-label'))) out.push({ name, testid, disabled });
    }
    return out;
  }

  // Search the listing for a candidate, so a subject is found by IDENTITY rather than by
  // position. These lists run to several pages, so taking row 0 and hoping is how a scenario
  // ends up driving whichever candidate happens to sort first that day.
  async searchListing(term) {
    // Not every listing has a search box - the Deactivated one renders none. A bare fill() there
    // waits out its whole timeout and reports `locator.fill: Timeout`, which reads as a broken
    // selector rather than as a control the page does not have.
    if ((await this.listingSearch.count()) === 0) {
      throw new Error(
        `this listing has no search box, so a candidate cannot be found on it by address`
          + ` ("${term}"). Open the profile without an email to take the first row, or drive this`
          + ' fixture from a listing that has a search.'
      );
    }
    await this.listingSearch.fill(String(term));
    // The search is debounced ~1s.
    await this.page.waitForTimeout(1500);
    await this.settleListing();
  }

  // Open the profile of a named candidate, or of the first row when `email` is null.
  //
  // Returns the candidate the profile was opened FOR, which every step attaches to the report:
  // with a fixture that falls back to the first row, a red row is otherwise not reproducible.
  async openProfile({ listing, email = null } = {}) {
    const spec = await this.openListing(listing);
    if (spec.noViewControl) {
      throw new Error(
        `the "${listing}" listing offers no View control, so no profile can be opened from it`
      );
    }

    let subject = email;
    if (email) {
      await this.searchListing(email);
      const rows = await this.listingRows.count();
      if (rows === 0) {
        throw new Error(
          `no row on the "${listing}" listing matched "${email}" - the fixture may not be a`
            + ' candidate of this agent, or may not be on this listing'
        );
      }
    }

    const firstRow = await this.listingRows
      .first()
      .innerText()
      .catch(() => '');
    const match = firstRow.match(/[\w.+-]+@[\w.-]+/);
    if (!subject && match) [subject] = match;

    const response = this.page
      .waitForResponse(
        (r) => /\/candidate\/profile\/\d+\/$/.test(r.url()) && r.status() === 200,
        { timeout: 40000 }
      )
      .catch(() => null);

    await this.listingViewButtons.first().click();
    await this.page.waitForURL(VIEW_PROFILE_URL, { timeout: 40000 });
    await response;
    await this.settleProfile();

    return { listing, subject, candidateId: this.candidateIdFromUrl(), url: this.page.url() };
  }

  // Straight to a candidate's profile by id, for a scenario that already knows which one it
  // wants and is not asserting anything about the route in.
  async gotoProfile(candidateId, slug = 'candidate-details') {
    const response = this.page
      .waitForResponse(
        (r) => /\/candidate\/profile\/\d+\/$/.test(r.url()) && r.status() === 200,
        { timeout: 40000 }
      )
      .catch(() => null);
    await this.page.goto(
      `${this.origin}/candidates/${candidateId}/view-profile?selectedTab=${slug}`,
      { waitUntil: 'domcontentloaded' }
    );
    await response;
    await this.settleProfile();
    return this.page.url();
  }

  candidateIdFromUrl() {
    const m = this.page.url().match(/\/candidates\/(\d+)\/view-profile/);
    return m ? Number(m[1]) : null;
  }

  // >>> THE TAB STRIP PAINTS SECONDS AFTER THE HEADING. <<< A single read four seconds in
  // returned the page shell only and reported all five tabs as missing on a profile that renders
  // them a moment later. So the settle waits for the strip to hold all five, not for the
  // heading - the heading arriving is not evidence the profile has.
  async settleProfile(timeout = 30000) {
    await this.pageHeading.waitFor({ state: 'visible', timeout }).catch(() => {});
    const until = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      const n = await this.tabs.count().catch(() => 0);
      if (n >= CandidateViewProfilePage.TABS.length) {
        const name = await this.nameContainer.innerText().catch(() => '');
        if (name.trim()) {
          // The bodies of anything fetched while the profile loaded must be in before a step
          // reads profilePayload() - see the note in install().
          await this.flush();
          return true;
        }
      }
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return false;
  }

  currentSlug() {
    const m = this.page.url().match(/[?&]selectedTab=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ---------------------------------------------------------------- header

  // The profile header, read STRUCTURALLY - each part from its own element, never by position.
  //
  //   .name-container > p / span                 name / status pill
  //   p.description-text                         headline (an EMPTY <p> when there is none)
  //   .detail-items-container > div > p          [0] location ("-" when unset),
  //                                              [1..] programme preferences, e.g.
  //                                              "Open to Co-Op Programs" (only when set)
  //
  // >>> IT USED TO BE POSITIONAL, AND THE PROGRAMME LINE BROKE IT (measured 2026-10-06,
  //     scripts/probe-profile-header-structure.js). It took "the last line before the widgets"
  //     as the location and "the line before that" as the headline. A candidate with
  //     is_co_op_preferred then read headline "Al Baha" and location "Open to Co-Op Programs" -
  //     and the header scenario reported the APP as disagreeing with the payload on a header that
  //     was entirely correct. Before that, the widget row's value-above-label layout had shifted
  //     the same positional read by one. Reading each element by what it is ends both.
  async readHeader() {
    const lines = (await this.identityBlock.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    const name = await this.nameContainer.locator('p').first().innerText().catch(() => '');
    const pill = await this.nameContainer.locator('span').first().innerText().catch(() => '');
    const parts = await this.identityBlock.evaluate((root) => {
      const text = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
      const items = [...root.querySelectorAll('.detail-items-container > div:not(.divider)')]
        .map((d) => text(d))
        .filter(Boolean);
      return { headline: text(root.querySelector('p.description-text')), items };
    }).catch(() => ({ headline: '', items: [] }));

    // >>> READ src ONLY WHEN AN IMAGE IS THERE. A candidate with no photo renders INITIALS, not an
    //     <img>, and getAttribute() on a missing element WAITS - the full 30s action timeout - before
    //     the .catch() answers null. Measured 2026-10-06: that wait alone pushed the Active tab's
    //     60s profile step over its budget on a profile that had rendered in 0.8s.
    const hasAvatarImage = await this.avatarImage.isVisible().catch(() => false);
    return {
      name: name.trim(),
      statusPill: pill.trim(),
      headline: parts.headline || null,
      location: parts.items.length ? parts.items[0] : null,
      // The programme-preference line(s) after the location, e.g. "Open to Co-Op Programs".
      programmes: parts.items.slice(1),
      hasAvatarBand: await this.avatarBand.isVisible().catch(() => false),
      hasAvatarImage,
      avatarImageSrc: hasAvatarImage
        ? (await this.avatarImage.getAttribute('src', { timeout: 5000 }).catch(() => null)) || null
        : null,
      identityLines: lines,
    };
  }

  // The four widgets, each as the figure the page shows beside its label.
  //
  // Read structurally: the widget is the host whose label <p> is preceded by a <p> holding the
  // figure. "Track Progress" is deliberately NOT matched by label alone anywhere on this page -
  // it is also the name of a TAB, so a bare text lookup resolves to the tab strip.
  async readWidgets() {
    return this.main.evaluate((root, labels) => {
      const out = {};
      labels.forEach((label) => {
        const lab = [...root.querySelectorAll('p')].find(
          (p) => p.innerText.trim() === label && p.previousElementSibling
        );
        if (!lab) {
          out[label] = null;
          return;
        }
        const host = lab.parentElement;
        const ps = [...host.querySelectorAll('p')].map((p) => p.innerText.trim());
        const idx = ps.indexOf(label);
        out[label] = idx > 0 ? ps[idx - 1] : null;
      });
      return out;
    }, CandidateViewProfilePage.WIDGETS.map((w) => w.label));
  }

  // The header's two controls, with whatever accessible name each one has.
  async readHeaderActions() {
    const n = await this.headerActionButtons.count();
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const b = this.headerActionButtons.nth(i);
      /* eslint-disable no-await-in-loop */
      out.push({
        index: i,
        text: (await b.innerText()).trim(),
        ariaLabel: await b.getAttribute('aria-label'),
        title: await b.getAttribute('title'),
        disabled: await b.isDisabled().catch(() => false),
        hasIcon: (await b.locator('svg').count()) > 0,
      });
      /* eslint-enable no-await-in-loop */
    }
    return out;
  }

  // ---------------------------------------------------------------- tabs

  async tabLabels() {
    return (await this.tabs.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  }

  async selectedTabLabel() {
    const n = await this.tabs.count();
    for (let i = 0; i < n; i += 1) {
      /* eslint-disable no-await-in-loop */
      if ((await this.tabs.nth(i).getAttribute('aria-checked')) === 'true') {
        return (await this.tabs.nth(i).innerText()).trim();
      }
      /* eslint-enable no-await-in-loop */
    }
    return null;
  }

  // Select a tab and report every request it caused, so a step can assert BOTH that a tab
  // queried what it should and that a tab which should query nothing queried nothing.
  async selectTab(label) {
    const baseline = this.requestCount();
    const tab = this.tabs.filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    await tab.click();
    // Give the tab time to fire whatever it is going to fire. An absence cannot be waited for,
    // only watched, so this is a fixed window rather than a waitForResponse.
    await this.page.waitForTimeout(2500);
    await this.waitForTabBody(label);
    await this.flush();
    return {
      label,
      slug: this.currentSlug(),
      selected: await this.selectedTabLabel(),
      requests: this.pathsSince(baseline),
    };
  }

  // Each tab's body arrives after the tab is marked selected. What identifies "arrived" differs
  // per tab, and Track Progress renders NOTHING at all for a candidate with no track - so it
  // has no settle condition and must not be given one, or the wait would time out on the normal
  // case.
  async waitForTabBody(label, timeout = 25000) {
    const until = Date.now() + timeout;
    const ready = async () => {
      if (/candidate details/i.test(label)) {
        return (await this.sectionHosts['Basic Information'].count()) > 0;
      }
      if (/document verification/i.test(label)) {
        const body = await this.main.innerText().catch(() => '');
        return /Uploaded on|Nothing here yet|No documents/i.test(body);
      }
      if (/subscription/i.test(label)) {
        const body = await this.main.innerText().catch(() => '');
        return /Subscription Details|Nothing here yet|No subscription/i.test(body);
      }
      if (/activity log/i.test(label)) {
        return (await this.activityHeading.count()) > 0;
      }
      return true;
    };
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      if (await ready()) return true;
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return false;
  }

  // ---------------------------------------------------------------- Candidate Details

  async sectionHeadings() {
    const present = [];
    for (const name of CandidateViewProfilePage.SECTIONS) {
      /* eslint-disable no-await-in-loop */
      if ((await this.sectionHosts[name].count()) > 0) present.push(name);
      /* eslint-enable no-await-in-loop */
    }
    return present;
  }

  // One section's body as text, plus whether it is showing its empty state.
  async readSection(name) {
    const host = this.sectionHosts[name];
    if (!host) throw new Error(`unknown section "${name}"`);
    if ((await host.count()) === 0) return { name, found: false };
    const text = await host.innerText();
    const lines = text
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t !== name);
    return {
      name,
      found: true,
      text,
      lines,
      isEmptyState: /Nothing here yet/i.test(text),
    };
  }

  async readAllSections() {
    const out = {};
    for (const name of CandidateViewProfilePage.SECTIONS) {
      /* eslint-disable no-await-in-loop */
      out[name] = await this.readSection(name);
      /* eslint-enable no-await-in-loop */
    }
    return out;
  }

  // Basic Information renders as label/value pairs. Returns them as a map.
  //
  // >>> Email AND Phone Number ARE ALWAYS "-" HERE. <<< The agent's profile payload carries
  // neither field, so the section cannot populate them for anybody - while the listing one click
  // behind displays the email. Measured on every candidate looked at. Asserted by its own
  // scenario; do not "fix" a reader over it.
  // The labelled fields a section renders, as a map.
  //
  // >>> THE TWO LABELLED SECTIONS ARE MARKED UP DIFFERENTLY, AND TWO READERS BUILT ON THE DOM
  //     SHAPE EACH BROKE ON THE OTHER. <<< Measured while building this file:
  //       Basic Information   ONE wrapper holding all ten lines (label, value, label, value...)
  //       Work Preferences    one wrapper PER field - and "Preferred Work Location(s)" WRAPS its
  //                           value, because it can hold several locations
  //     A reader requiring "exactly two <p> children" silently skipped Preferred Work
  //     Location(s); a reader taking "the first line of each wrapper" collapsed the whole of
  //     Basic Information into one entry. Both reported fields as missing from sections
  //     rendering them perfectly well.
  //
  // So the reader works from the LABELS the section is contracted to show, and takes each
  // value as everything between that label and the next one. That is independent of the markup,
  // it handles a multi-line value, and a label the app stops rendering is genuinely absent from
  // the result rather than being silently merged into its neighbour.
  async readLabelledFields(sectionName) {
    const host = this.sectionHosts[sectionName];
    if ((await host.count()) === 0) return null;
    const labels = CandidateViewProfilePage.FIELD_LABELS[sectionName];
    if (!labels) throw new Error(`no field-label contract recorded for section "${sectionName}"`);

    const lines = (await host.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t !== sectionName);

    const out = {};
    const positions = labels
      .map((label) => ({ label, at: lines.indexOf(label) }))
      .filter((p) => p.at !== -1)
      .sort((a, b) => a.at - b.at);

    positions.forEach((p, i) => {
      const next = i + 1 < positions.length ? positions[i + 1].at : lines.length;
      out[p.label] = lines.slice(p.at + 1, next).join(', ');
    });
    return out;
  }

  // The attachment links a Candidate Details section carries: the filename the page shows and
  // the href behind it.
  //
  // >>> THE href IS A PRESIGNED S3 URL AND ITS X-Amz-Signature IS A CREDENTIAL. <<< It is
  // stripped here rather than at each call site, so it cannot reach a report or a log by
  // somebody forgetting. The path is kept, because that is what identifies the document.
  async readAttachments(sectionName) {
    const host = this.sectionHosts[sectionName];
    if ((await host.count()) === 0) return [];
    const links = host.locator('a');
    const n = await links.count();
    const out = [];
    for (let i = 0; i < n; i += 1) {
      /* eslint-disable no-await-in-loop */
      const name = (await links.nth(i).innerText()).trim();
      const href = (await links.nth(i).getAttribute('href')) || '';
      /* eslint-enable no-await-in-loop */
      out.push({ fileName: name, href: CandidateViewProfilePage.redact(href) });
    }
    return out;
  }

  static redact(url) {
    return String(url).replace(/([?&](X-Amz-Signature|X-Amz-Credential)=)[^&]*/gi, '$1<redacted>');
  }

  // ---------------------------------------------------------------- Document Verification

  // >>> THE ROW HAS THE APP'S OWN CLASS, AND THE READER THIS REPLACES NEVER REACHED THE ACTIONS.
  //     <<< Measured 2026-09-17, one row:
  //
  //     main.section-main
  //       .documents-list-items-container
  //         .document-list-item                       <- ONE per document
  //           div.rounded-full > svg                  <- file-TYPE icon. cursor:auto, NOT an action
  //           div
  //             div > button > p                      <- the file name (a real <button>, tabIndex 0)
  //             div.status-badge > span.status-badge-label    <- "Needs Review" / "Approved" / ...
  //             p                                     <- "Uploaded on Aug 5, 2026"
  //           div[margin-inline-start:auto]           <- THE ACTIONS: two bare <svg>
  //                                                      [0] View   [1] Download
  //
  // The reader this replaces derived a row by climbing from the "Uploaded on" line to the
  // nearest ancestor holding a <button> - and THE FILE NAME IS ITSELF A BUTTON, so the climb
  // stopped one level early, inside the details column and outside the actions container. Every
  // row therefore came back with `iconControls: []` on a tab that renders two actions per row,
  // so an assertion about a row action built on it would have passed having inspected nothing.
  // Same class as the community module's card reader answering a constant 7 for a list of 12.
  //
  // Rows now come from the app's own row class, which cannot drift from what the page shows.
  // Note the container is PLURAL (`documents-list-items-container`) and the row SINGULAR, so a
  // `[class*="list-item"]` union matches both and a one-row group resolves to two elements - the
  // exact trap that cost a fixture entry in the candidate-portal module.
  async readDocumentGroups() {
    return this.main.evaluate((root, groupNames) => {
      const groups = {};
      groupNames.forEach((g) => {
        const head = [...root.querySelectorAll('p')].find((p) => p.innerText.trim() === g);
        if (!head) return;
        let host = head.parentElement;
        for (let i = 0; i < 4 && host && !host.querySelector('main'); i += 1) {
          host = host.parentElement;
        }
        const body = host ? host.querySelector('main') : null;
        if (!body) return;

        const rows = [...body.querySelectorAll('.document-list-item')].map((row) => {
          const fileBtn = row.querySelector('button');
          const pill = row.querySelector('.status-badge-label');
          const uploaded = [...row.querySelectorAll('p')]
            .map((p) => p.innerText.trim())
            .find((t) => /^Uploaded on\s+/i.test(t));
          const actionHost = [...row.children].find((c) =>
            /margin-inline-start:auto/.test(c.getAttribute('class') || '')
          );
          const actions = actionHost
            ? [...actionHost.querySelectorAll('svg')]
            : [...row.querySelectorAll('svg')].filter(
                (s) => getComputedStyle(s).cursor === 'pointer'
              );
          return {
            fileName: fileBtn ? fileBtn.innerText.trim() : null,
            status: pill ? pill.innerText.trim() : null,
            uploadedOn: uploaded ? uploaded.replace(/^Uploaded on\s+/i, '').trim() : null,
            // Every action, and whether anything but a mouse can get to it.
            actions: actions.map((s) => ({
              ariaHidden: s.getAttribute('aria-hidden'),
              role: s.getAttribute('role'),
              ariaLabel: s.getAttribute('aria-label'),
              inButton: !!s.closest('button'),
              inAnchor: !!s.closest('a'),
              parentTabIndex: s.parentElement ? s.parentElement.tabIndex : null,
              cursor: getComputedStyle(s).cursor,
            })),
          };
        });

        // The group's own empty state, read ONLY when the group has no rows - so a group that
        // renders rows can never be reported as empty by a stray line of copy.
        const bodyText = (body.innerText || '').trim();
        groups[g] = { rows, emptyState: rows.length ? null : bodyText || null };
      });
      return groups;
    }, ['Education', 'Work Experience', 'Certifications']);
  }

  // The GROUP-level empty states, verbatim (measured on a candidate holding no documents at
  // all). >>> THERE IS NO TAB-LEVEL EMPTY STATE. <<< All three groups render, each with its own
  // line, so a reader looking for one "no documents" message answers "absent" on a tab that is
  // behaving perfectly.
  static DOCUMENT_EMPTY_STATE = {
    Education: 'No education documents uploaded yet.',
    'Work Experience': 'No work experience documents uploaded yet.',
    Certifications: 'No certification documents uploaded yet.',
  };

  // The two per-row actions, in the order the page renders them.
  static DOCUMENT_ROW_ACTIONS = ['View', 'Download'];

  documentRows() {
    return this.main.locator('.document-list-item');
  }

  // Exactly one row, or refuse. "It took the first one" is not a recovery worth making when the
  // next thing the caller does is open or download that document - and these file names repeat
  // across uploads (the server appends its own suffix), so a partial match is genuinely
  // ambiguous rather than merely untidy.
  async documentRowFor(fileName) {
    const rows = this.documentRows().filter({ hasText: fileName });
    const n = await rows.count();
    if (n !== 1) {
      const all = await this.documentRows().allInnerTexts();
      throw new Error(
        `"${fileName}" matched ${n} document rows, so the row is ambiguous. Rows on this tab:\n`
          + all.map((t) => `  - ${t.replace(/\n+/g, ' | ')}`).join('\n')
      );
    }
    return rows.first();
  }

  // The actions container is a Tailwind arbitrary-property class, not a semantic hook, so it is
  // the first candidate and never the only evidence: every click through it VERIFIES what it got
  // (the viewer names the document that was asked for, a download actually starts). If the two
  // are ever reordered, that check fails loudly instead of quietly downloading when asked to
  // view - the same discipline as submitDecision() refusing a control whose label disagrees.
  rowActions(row) {
    return row.locator('div[class*="margin-inline-start:auto"] svg');
  }

  // ---------------------------------------------------------------- the document viewer
  //
  // A dialog raised by a row's View action. THE URL DOES NOT CHANGE, and opening it fires NO
  // request - the tab already holds everything from the profile payload - so its arrival is
  // waited for on the render and never on a response.
  //
  // MEASURED CONTRACT (2026-09-17):
  //   heading         "Document Verification"        (the same words as the tab)
  //   zoom            "100%" between two icon buttons, aria-label "Zoom out" / "Zoom in"
  //   Download        a real <button>: the file downloads and THE DIALOG STAYS OPEN
  //   Document Information    Document Name / Document Type / Date Uploaded / Status / Version
  //   Version         "v1.0" on a first upload
  //   Flagged for     the AI findings, attributed to "Automated System Message"
  //   Request Revision + Approve    ONLY when Status is "Needs Review"   <- NEVER CLICKED HERE
  //   Close           aria-label "Close"; Escape closes it too
  //
  // Scoped by "Document Information" rather than by being the last dialog: the profile can have
  // another dialog open (Reminder History), and a viewer assertion that read whichever dialog
  // happened to be last would report the wrong surface.
  get documentViewer() {
    return this.page
      .locator('[role="dialog"]')
      .filter({ hasText: /Document Information/ })
      .last();
  }

  async openDocumentViewer(fileName) {
    const row = await this.documentRowFor(fileName);
    await this.rowActions(row).nth(0).click();
    await this.documentViewer.waitFor({ state: 'visible', timeout: 30000 });
    // The frame paints before the information block, so waiting on the dialog alone returns a
    // viewer with empty fields - indistinguishable from one that failed to load.
    await this.documentViewer
      .getByText('Document Information', { exact: false })
      .waitFor({ timeout: 30000 });

    const shown = await this.readDocumentViewer();
    const norm = CandidateViewProfilePage.norm;
    if (shown.documentName && norm(shown.documentName) !== norm(fileName)) {
      throw new Error(
        `the View action on "${fileName}" opened "${shown.documentName}" instead. A viewer that `
          + 'always shows the same document is a disclosure problem as much as a rendering one, '
          + 'so this refuses rather than reading on.'
      );
    }
    return shown;
  }

  async readDocumentViewer() {
    const dlg = this.documentViewer;
    const text = (await dlg.innerText()).replace(/\r/g, '');
    // Label and value are separated by a BLANK line, so a value is not simply "the next line" of
    // the raw text. Reading the non-empty lines in order sidesteps that and any future spacing.
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const field = (label) => {
      const i = lines.indexOf(label);
      return i === -1 || i + 1 >= lines.length ? null : lines[i + 1];
    };
    // >>> "Flagged for" IS FOLLOWED BY A SECOND BLOCK, AND THE FIRST VERSION OF THIS READER
    //     SWALLOWED IT. <<< A decided document also renders "Comment History" - the stored
    // comment, its author ("AI review" / "Agent") and a timestamp - and a reader that slices
    // from "Flagged for" to the end returned all of that as AI findings. It was only invisible
    // because the slice stopped at the decision buttons, which a DECIDED document does not have,
    // so it mis-read exactly the documents it was most likely to be asked about.
    const sectionEnd = /^(Comment History|Request Revision|Approve)$/;
    const after = (label) => {
      const at = lines.indexOf(label);
      if (at === -1) return [];
      const stop = lines.findIndex((l, i) => i > at && sectionEnd.test(l));
      return lines.slice(at + 1, stop === -1 ? lines.length : stop);
    };
    const flagged = after('Flagged for');
    const comments = after('Comment History');
    const attributed = /^(Automated System Message|Agent|AI review)$/i;

    return {
      heading: lines[0] || null,
      documentName: field('Document Name'),
      documentType: field('Document Type'),
      dateUploaded: field('Date Uploaded'),
      status: field('Status'),
      version: field('Version'),
      zoom: (text.match(/(\d{1,3})\s?%/) || [null, null])[1],
      flaggedFor: flagged.filter((l) => !attributed.test(l)),
      flaggedBy: flagged.find((l) => attributed.test(l)) || null,
      // The stored comment block, kept apart from the AI findings above. Its author line is the
      // product's answer to "who flagged this" - measured as "AI review" on an AI finding and
      // "Agent" on an agent's own note.
      commentHistory: comments.filter((l) => !attributed.test(l)),
      commentBy: comments.find((l) => attributed.test(l)) || null,
      // Every control the dialog offers, so a red row says what WAS there rather than only what
      // was missing.
      buttons: await dlg.evaluate((d) =>
        [...d.querySelectorAll('button')].map(
          (b) => (b.innerText || '').trim() || b.getAttribute('aria-label') || '(unnamed)'
        )
      ),
      hasApprove: (await dlg.getByTestId('agent-approve-button').count()) > 0,
      hasRequestRevision: (await dlg.getByTestId('agent-request-revision-button').count()) > 0,
      hasDownload: (await dlg.getByRole('button', { name: /^download$/i }).count()) > 0,
      hasZoomIn: (await dlg.getByRole('button', { name: /zoom in/i }).count()) > 0,
      hasZoomOut: (await dlg.getByRole('button', { name: /zoom out/i }).count()) > 0,
      // The preview itself: an <img> for an image, a react-pdf canvas for a PDF.
      preview: await dlg.evaluate((d) => ({
        images: [...d.querySelectorAll('img')].length,
        canvases: d.querySelectorAll('canvas').length,
        reactPdf: d.querySelectorAll('.react-pdf__Document, .react-pdf__Page').length,
      })),
      fullText: text,
    };
  }

  async documentZoomLevel() {
    const m = (await this.documentViewer.innerText()).match(/(\d{1,3})\s?%/);
    return m ? Number(m[1]) : null;
  }

  // Measured: 100 -> 125 -> 150 stepping in, and a floor of 50 where "Zoom out" is DISABLED. A
  // step that clicked a disabled control would wait out its timeout and report a broken locator,
  // so the disabled state is returned as a fact instead of being walked into.
  async zoomDocument(direction) {
    const btn = this.documentViewer.getByRole('button', {
      name: direction === 'in' ? /zoom in/i : /zoom out/i,
    });
    const before = await this.documentZoomLevel();
    if (await btn.isDisabled()) return { direction, before, after: before, wasDisabled: true };
    await btn.click();
    // Poll for the change rather than sampling once: one read taken immediately cannot tell a
    // control that did nothing from one whose re-render has not landed yet.
    const until = Date.now() + 5000;
    let after = before;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      after = await this.documentZoomLevel();
      if (after !== before) break;
      await this.page.waitForTimeout(150);
    }
    /* eslint-enable no-await-in-loop */
    return { direction, before, after, wasDisabled: false };
  }

  async downloadDocumentFromRow(fileName) {
    const row = await this.documentRowFor(fileName);
    const waiter = this.page.waitForEvent('download', { timeout: 30000 });
    await this.rowActions(row).nth(1).click();
    const dl = await waiter;
    return {
      suggestedFilename: dl.suggestedFilename(),
      url: CandidateViewProfilePage.redact(dl.url()),
    };
  }

  async downloadDocumentFromViewer() {
    const waiter = this.page.waitForEvent('download', { timeout: 30000 });
    await this.documentViewer.getByRole('button', { name: /^download$/i }).click();
    const dl = await waiter;
    return {
      suggestedFilename: dl.suggestedFilename(),
      url: CandidateViewProfilePage.redact(dl.url()),
      viewerStillOpen: (await this.documentViewer.count()) > 0,
    };
  }

  async closeDocumentViewer(via = 'Close') {
    if (/escape/i.test(via)) await this.page.keyboard.press('Escape');
    else await this.documentViewer.getByRole('button', { name: /^close$/i }).click();
    await this.documentViewer.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return (await this.documentViewer.count()) === 0;
  }

  // ---------------------------------------------------------------- Subscription

  async readSubscription() {
    const body = await this.main.innerText();
    const fields = await this.main.evaluate((root, names) => {
      const out = {};
      names.forEach((label) => {
        const lab = [...root.querySelectorAll('p')].find((p) => p.innerText.trim() === label);
        if (!lab) {
          out[label] = null;
          return;
        }
        // The value is the sibling <span>/<p> beside the label inside the same wrapper.
        const host = lab.parentElement;
        const texts = [...host.children]
          .map((c) => c.innerText && c.innerText.trim())
          .filter((t) => t && t !== label);
        out[label] = texts.length ? texts[0] : null;
      });
      return out;
    }, CandidateViewProfilePage.SUBSCRIPTION_FIELDS);
    return {
      heading: /Subscription Details/i.test(body) ? 'Subscription Details' : null,
      fields,
      isEmptyState: /Nothing here yet/i.test(body),
    };
  }

  // ---------------------------------------------------------------- Activity Log

  // The duration options the app really offers, read off the react-aria POPOVER (the labels a
  // user can choose) and off the hidden mirror <select> (the values it will send).
  //
  // Both are read because they answer different questions, and the mirror carries one entry the
  // popover does not - a blank option. Reporting the mirror alone would invent a seventh option
  // nobody can select.
  async readDurationOptions() {
    const mirror = await this.activityDurationMirror.evaluate((s) =>
      [...s.options].map((o) => ({ value: o.value, label: (o.label || o.text || '').trim() }))
    );
    await this.activityDurationTrigger.click();
    const listbox = this.page.locator('[role="listbox"]').first();
    await listbox.waitFor({ state: 'visible', timeout: 15000 });
    const offered = (await listbox.getByRole('option').allInnerTexts()).map((t) => t.trim());
    await this.page.keyboard.press('Escape');
    await listbox.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return { offered, mirror, selected: await this.selectedDuration() };
  }

  async selectedDuration() {
    return (await this.activityDurationTrigger.innerText()).trim();
  }

  async selectedDurationValue() {
    return this.activityDurationMirror.evaluate((s) => s.value).catch(() => null);
  }

  // Choose a duration and report the request it produced.
  //
  // >>> SELECT BY role=option AND BY NAME, NEVER BY INDEXING THE POPOVER. <<< react-aria renders
  // a zero-content <button aria-label="Dismiss"> BEFORE the listbox and another after it, so a
  // locator union like '[role="dialog"] button, [role="option"]' resolves to Dismiss first and
  // every click is intercepted. (The community module lost four scenarios to exactly this.)
  async selectDuration(label) {
    const baseline = this.requestCount();
    const wanted = CandidateViewProfilePage.DURATIONS.find(
      (d) => d.label.toLowerCase() === String(label).toLowerCase()
    );
    if (!wanted) {
      throw new Error(
        `unknown duration "${label}" - known: `
          + CandidateViewProfilePage.DURATIONS.map((d) => d.label).join(', ')
      );
    }
    const response = this.page
      .waitForResponse((r) => /\/activity-logs\/\d+\//.test(r.url()), { timeout: 30000 })
      .catch(() => null);

    await this.activityDurationTrigger.click();
    const listbox = this.page.locator('[role="listbox"]').first();
    await listbox.waitFor({ state: 'visible', timeout: 15000 });
    await listbox.getByRole('option', { name: new RegExp(`^\\s*${wanted.label}\\s*$`, 'i') }).click();
    await listbox.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const res = await response;
    await this.settleActivity();
    await this.flush();

    return {
      label: wanted.label,
      value: wanted.value,
      requests: this.pathsSince(baseline),
      requestedUrl: res ? res.url() : null,
      sentDuration: res ? (res.url().match(/[?&]duration=([^&]*)/) || [])[1] || null : null,
      payload: res ? await res.json().catch(() => null) : null,
      url: this.page.url(),
    };
  }

  // The list paints after its request answers, so a read taken on the heading finds nothing.
  // Resolves on entries OR the empty state.
  async settleActivity(timeout = 20000) {
    const until = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      const entries = await this.readActivityEntries();
      if (entries.length) return true;
      const body = await this.main.innerText().catch(() => '');
      if (/No activity to show/i.test(body)) return true;
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return false;
  }

  // Activity entries: ONE per `.activity-log-item`, which is the app's own row container.
  //
  // >>> DO NOT DE-DUPLICATE BY CONTENT, AND DO NOT WALK THE DESCENDANTS LOOKING FOR DATES. <<<
  // The first version of this reader did both and UNDER-COUNTED 10 rows as 5. Two faults:
  //
  //  1. Walking every leaf that looks like a date and climbing to "a host holding three <p>s"
  //     reaches the same row from several ancestors, so it needed de-duplication...
  //  2. ...and de-duplicating on `headline|description|date` then collapsed rows that are
  //     GENUINELY DISTINCT. This tab renders only the DATE and discards the time, so two
  //     different events on one day with the same headline and description are rendered
  //     IDENTICALLY - measured: `Course Completed / Brand Management course completed
  //     successfully / Jul 23, 2026` three times over. Collapsing them hides real activity and
  //     would make the "every entry the server returned is rendered" assertion pass while
  //     rendering half of them.
  //
  // That is the same class of defect as the community module's `readMemberCards()`, which
  // answered a constant 7 on a list of 12 and made two scenarios pass having proved nothing.
  // Counting the app's own row elements cannot drift from what the page shows.
  async readActivityEntries() {
    return this.main.evaluate(() =>
      [...document.querySelectorAll('.activity-log-item')].map((row) => {
        const ps = [...row.querySelectorAll('p')].map((p) => p.innerText.trim()).filter(Boolean);
        const DATE = /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/;
        const dateIdx = ps.findIndex((t) => DATE.test(t));
        return {
          headline: ps[0] || null,
          description: ps[1] || null,
          date: dateIdx === -1 ? null : ps[dateIdx],
          lines: ps,
        };
      })
    );
  }

  async readActivityEmptyState() {
    const body = await this.main.innerText();
    if (!/No activity to show/i.test(body)) return null;
    const lines = body
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const i = lines.findIndex((l) => /No activity to show/i.test(l));
    return { heading: lines[i], body: lines[i + 1] || null };
  }

  // ---------------------------------------------------------------- Reminder History

  // Open the profile's own Reminder History dialog.
  //
  // >>> THE DIALOG OPENS EMPTY AND ITS ENTRIES ARRIVE AFTERWARDS. <<< It is visible with only
  // its heading while GET /agent/candidate/<id>/reminders/ is in flight. A read on `visible`
  // therefore returns ZERO entries for a candidate holding ten - "this candidate has no
  // reminders" being precisely the conclusion this reader must never reach by accident. So the
  // response is awaited and the render polled up to the count the server returned, and the
  // payload is handed back so a step can compare the two.
  async openReminderHistory() {
    const response = this.page
      .waitForResponse(
        (r) => /\/candidate\/\d+\/reminders\//.test(r.url()) && r.request().method() === 'GET',
        { timeout: 30000 }
      )
      .catch(() => null);
    const urlBefore = this.page.url();
    await this.reminderHistoryButton.click();
    await this.reminderHistoryPanel.waitFor({ state: 'visible', timeout: 20000 });

    const res = await response;
    const payload = res ? await res.json().catch(() => null) : null;
    const fetched = payload && Array.isArray(payload.results) ? payload.results.length : null;

    if (fetched) {
      const until = Date.now() + 15000;
      /* eslint-disable no-await-in-loop */
      while (Date.now() < until) {
        const { entries } = await this.readReminderHistory();
        if (entries.length >= fetched) break;
        await this.page.waitForTimeout(250);
      }
      /* eslint-enable no-await-in-loop */
    }
    await this.flush();
    return { payload, fetched, urlBefore, urlAfter: this.page.url() };
  }

  async reminderHistoryEnabled() {
    return this.reminderHistoryButton.isEnabled().catch(() => false);
  }

  // The dialog's contents.
  //
  // >>> ENTRIES ARE DERIVED FROM THE <li> ELEMENTS, NOT BY PARSING THE TEXT. <<< The app renders
  // "Sent" and the timestamp on SEPARATE lines, and a reader looking for them on one line
  // ("Sent • <date>") matches nothing and returns an empty history - which is how the sibling
  // reader in RequiresAttentionPage came to report a candidate with ten reminders as having
  // none. One <li> per reminder is the structure; the text inside it is what varies.
  async readReminderHistory() {
    const panel = this.reminderHistoryPanel;
    const lines = (await panel.innerText())
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    const entries = await panel.evaluate((el) =>
      [...el.querySelectorAll('li')].map((li) => {
        const parts = li.innerText
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean);
        // [title, "Sent", "<date> - <time>"] today; tolerate a one-line "Sent • <date>" too, so
        // a layout change back does not silently empty this reader.
        const sentIdx = parts.findIndex((p) => /^Sent\b/i.test(p));
        let sent = null;
        if (sentIdx !== -1) {
          const inline = parts[sentIdx].match(/^Sent\s*[•·-]\s*(.+)$/i);
          sent = inline ? inline[1].trim() : parts[sentIdx + 1] || null;
        }
        return { title: parts[0] || null, sent };
      })
    );

    return {
      lines,
      // The dialog titles itself with the candidate's name, then "Reminder History".
      candidate: lines[0] || null,
      heading: lines.find((t) => /^Reminder History$/i.test(t)) || null,
      entries,
      hasViewMore: lines.some((t) => /^View more$/i.test(t)),
      // Shown only when the page returned is the whole history.
      showingAll: lines.some((t) => /Showing all reminders sent to this candidate/i.test(t)),
    };
  }

  async closeReminderHistory(method = 'Close') {
    if (/escape/i.test(method)) await this.page.keyboard.press('Escape');
    else if (/backdrop/i.test(method)) await this.page.mouse.click(5, 5);
    else {
      await this.reminderHistoryPanel
        .getByRole('button', { name: /^Close$/i })
        .first()
        .click();
    }
    await this.reminderHistoryPanel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // Watch a WINDOW rather than sampling once - "not visible" is also true of a dialog the app
  // has not rendered yet, and the step using this exists to prove an absence.
  async reminderHistoryStaysClosed(windowMs = 2500) {
    const until = Date.now() + windowMs;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < until) {
      if (await this.reminderHistoryPanel.isVisible().catch(() => false)) return false;
      await this.page.waitForTimeout(200);
    }
    /* eslint-enable no-await-in-loop */
    return true;
  }

  // ---------------------------------------------------------------- Back

  async clickBack() {
    await this.backControl.click();
    await this.page.waitForURL((u) => !VIEW_PROFILE_URL.test(String(u)), { timeout: 20000 });
    return this.page.url();
  }

  // ---------------------------------------------------------------- accessibility
  //
  // A REAL Tab walk, plus a CONTROL. Two presses per stop would be cheaper and would prove
  // nothing: "nothing focused" is also what a broken walk reports, so the audit additionally
  // checks that a control known to be focusable IS focused. Without that, every finding here
  // could be the probe's own failure. (The dashboard "View all" finding is measured the same
  // way, for the same reason.)
  async auditKeyboard(presses = 60) {
    await this.page.evaluate(() => document.body.focus());
    const stops = [];
    for (let i = 0; i < presses; i += 1) {
      /* eslint-disable no-await-in-loop */
      await this.page.keyboard.press('Tab');
      stops.push(
        await this.page.evaluate(() => {
          const a = document.activeElement;
          if (!a) return null;
          return {
            tag: a.tagName,
            name: (a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 40),
            cls: (a.getAttribute('class') || '').slice(0, 40),
          };
        })
      );
      /* eslint-enable no-await-in-loop */
    }

    const control = await this.page.evaluate(() => {
      const rh = [...document.querySelectorAll('button')].find((b) =>
        /Reminder History/i.test(b.innerText)
      );
      if (!rh) return { found: false };
      rh.focus();
      return { found: true, focused: document.activeElement === rh, tabIndex: rh.tabIndex };
    });

    const back = await this.page.evaluate(() => {
      const p = [...document.querySelectorAll('p')].find((e) => /^Back$/.test(e.innerText.trim()));
      if (!p) return { found: false };
      p.focus();
      return {
        found: true,
        tag: p.tagName,
        tabIndex: p.tabIndex,
        focusableProgrammatically: document.activeElement === p,
        inButton: !!p.closest('button'),
        inAnchor: !!p.closest('a'),
        role: p.getAttribute('role'),
        ariaLabel: p.getAttribute('aria-label'),
      };
    });

    const named = stops.filter(Boolean).map((s) => `${s.tag}:${s.name || '(no name)'}`);
    return {
      presses,
      distinctStops: [...new Set(named)],
      // A stop is only "Back" if the FOCUSED element is Back itself. Matching the text loosely
      // also matches BODY, whose innerText contains the whole page - which is how a first pass
      // at this reported Back as reachable when it is not.
      backFocused: stops.some((s) => s && s.tag === 'P' && /^Back$/.test(s.name)),
      unnamedFocusStops: named.filter((n) => /\(no name\)$/.test(n)).length,
      control,
      back,
    };
  }

  // Every clickable control on the current tab, classified by whether assistive technology and a
  // keyboard can reach it. Used by the Document Verification audit, where the two per-row
  // controls are bare <svg aria-hidden="true"> outside any button or anchor.
  async auditClickableIcons() {
    return this.main.evaluate((root) => {
      const out = [];
      [...root.querySelectorAll('svg')].forEach((s) => {
        if (getComputedStyle(s).cursor !== 'pointer') return;
        const host = s.parentElement;
        out.push({
          ariaHidden: s.getAttribute('aria-hidden'),
          role: s.getAttribute('role'),
          inButton: !!s.closest('button'),
          inAnchor: !!s.closest('a'),
          hostTag: host ? host.tagName : null,
          hostTabIndex: host ? host.tabIndex : null,
          hostRole: host ? host.getAttribute('role') : null,
          hostAriaLabel: host ? host.getAttribute('aria-label') : null,
        });
      });
      return {
        total: out.length,
        // Reachable means: inside a real button/anchor, or itself given a role and a tab stop.
        unreachable: out.filter(
          (o) => !o.inButton && !o.inAnchor && (o.hostTabIndex === null || o.hostTabIndex < 0)
        ).length,
        hiddenFromAt: out.filter((o) => o.ariaHidden === 'true' && !o.inButton && !o.inAnchor)
          .length,
        controls: out,
      };
    });
  }

  // Is the profile page's icon-only header button inert? Verified the way the finding was
  // measured: clipboard API, execCommand, a request, a navigation, a dialog and a toast - all
  // instrumented BEFORE the click, because "no toast" read afterwards is also true of one that
  // came and went.
  async probeHeaderIconButton() {
    await this.page.evaluate(() => {
      window.__clipWrites = [];
      if (navigator.clipboard) {
        const orig = navigator.clipboard.writeText;
        navigator.clipboard.writeText = function (t) {
          window.__clipWrites.push(String(t));
          return orig ? orig.call(navigator.clipboard, t).catch(() => {}) : Promise.resolve();
        };
      }
      window.__execCommands = [];
      const oe = document.execCommand;
      document.execCommand = function (c) {
        window.__execCommands.push(c);
        return oe ? oe.apply(document, arguments) : false;
      };
    });

    const baseline = this.requestCount();
    const urlBefore = this.page.url();
    await this.headerActionButtons.first().click();
    await this.page.waitForTimeout(2000);

    const observed = await this.page.evaluate(() => ({
      clipboardWrites: window.__clipWrites || [],
      execCommands: window.__execCommands || [],
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) =>
        d.innerText.slice(0, 120)
      ),
      alerts: [...document.querySelectorAll('[role="alert"],[role="status"]')]
        .map((t) => t.innerText.trim())
        .filter(Boolean),
    }));

    return {
      ...observed,
      requests: this.pathsSince(baseline),
      urlBefore,
      urlAfter: this.page.url(),
      navigated: urlBefore !== this.page.url(),
    };
  }

  // ---------------------------------------------------------------- payload helpers
  //
  // These derive the EXPECTED rendering from the candidate's own stored profile. They are
  // deliberately thin: they format a date and title-case a token, and nothing else. A helper
  // clever enough to reproduce the app's whole rendering would agree with the app by
  // construction and could not catch it being wrong - so every assertion compares the parts
  // that are unambiguous (the institution name as stored, the month and year of a stored date)
  // rather than re-deriving a whole sentence.

  static MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  // "2020-09-01" -> { month: 'September', year: '2020' }. Built from the ISO parts rather than
  // through `new Date()`, which shifts a date-only value by the runner's timezone and can report
  // the previous month.
  static isoMonthYear(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    return { month: CandidateViewProfilePage.MONTHS[Number(m[2]) - 1], year: m[1] };
  }

  // "STUDENT" -> "Student", "internship" -> "Internship", "co_op" -> "Co-op".
  //
  // Used ONLY to build the expected string for an assertion, never to normalise the app's own
  // output before comparing - normalising both sides is how a raw-enum leak (the candidate
  // portal renders "co_op" in one place) stops being detectable.
  // Measured forms: STUDENT -> "Student", internship -> "Internship", co_op -> "Co-op".
  // Note the LAST of those: only the first word is capitalised and the underscore becomes a
  // hyphen, so a naive word-by-word title case yields "Co-Op" and the assertion fails against a
  // correct render.
  static titleCaseEnum(value) {
    if (value === null || value === undefined || value === '') return null;
    const words = String(value).toLowerCase().split(/[_\s]+/).filter(Boolean);
    if (!words.length) return null;
    const [first, ...rest] = words;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join('-');
  }

  // Normalise for comparison: collapse whitespace and fold the typographic characters that make
  // two identical-looking strings unequal. Deliberately does NOT fold "-" into "—": those two
  // characters mean different things on this page (see UNSET_FIELD / UNCOMPUTED_STAT).
  static norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/ /g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = CandidateViewProfilePage;
