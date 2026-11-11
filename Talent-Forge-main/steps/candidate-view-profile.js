// Step definitions for features/Agent_Portal/candidate-view-profile.feature -
// the AGENT PORTAL's candidate profile at /candidates/<id>/view-profile, reached by the "View"
// row action on the Active, Deactivated and Requires Attention listings.
//
// >>> EVERY PHRASE HERE IS WORDED FOR THIS SURFACE ("the profile Reminder History control",
//     "each Candidate Details tab ..."). <<< Cucumber loads every step file into ONE global
// registry, so a phrase defined twice is an AMBIGUOUS step - neither a pass nor a failure, and
// easy to miss in the summary (playwright-bdd fails generation on it instead). Three files
// already own vocabulary that looks reusable and is not:
//   - steps/active-candidate.js     owns the Active listing's phrases, all bound to
//                                   this.pages.activeCandidate
//   - steps/require-attention.js    owns "Requires Attention ..." and its own Reminder History
//                                   phrases, bound to this.pages.requiresAttention
//   - steps/candidate-details.js    owns the CANDIDATE's own profile ("Basic Information should
//                                   ..."), bound to this.pages.candidateDetails
// Reusing any of those would drive the wrong page object, and so pass or fail against the wrong
// screen. Only the generic, page-object-free phrases are shared - and the agent login is
// deliberately re-worded here rather than reusing active-candidate.js's, because this feature
// must not depend on a Background that navigates to the Active tab.
//
// NOTHING HERE MUTATES ANYTHING except the single @mutates-profile end-to-end scenario at the
// foot of the file, which edits the fixture candidate's About Me on the CANDIDATE portal and
// restores it in the After hook.
//
// MULTI-CASE STEPS COLLECT AND THROW ONCE. Cucumber abandons a scenario at its first failing
// step, and the listing tables here carry three subjects apiece - reporting only the first
// would hide whether the other two share a cause.

const { Given, When, Then, After, Before } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const { resilientSignIn } = require('../utils/resilientSignIn');
const CandidateViewProfilePage = require('../pages/CandidateViewProfilePage');

const P = CandidateViewProfilePage;

const AGENT_EMAIL = process.env.AGENT_EMAIL;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD;

// ---------------------------------------------------------------------------- fixtures
//
// Each subject is PINNED in .env and FALLS BACK to "whatever the listing offers" when the key is
// unset, so a fresh checkout still runs. Every step attaches the candidate it actually drove:
// with a fallback in play a red row is otherwise not reproducible.
//
// The fallbacks are not arbitrary - they are resolved by SEARCHING the listing for a candidate
// whose payload satisfies the property the scenario needs (a headline, a photo, populated
// stats), because "row 0" changes between runs and these listings run to several pages.
const FIXTURES = {
  // The candidate whose Candidate Details are fullest: education, work experience,
  // certifications, roles, preferences and a non-empty About Me.
  fullest: process.env.VIEWPROFILE_FULL_CANDIDATE_EMAIL,
  // Has a `headline`, which most candidates do not.
  headline: process.env.VIEWPROFILE_HEADLINE_CANDIDATE_EMAIL,
  // Has a `profile_image`.
  photo: process.env.VIEWPROFILE_PHOTO_CANDIDATE_EMAIL,
  // `stats` populated (non-null).
  stats: process.env.VIEWPROFILE_STATS_CANDIDATE_EMAIL,
  // `stats: null`, so the widgets render their placeholder.
  noStats: process.env.VIEWPROFILE_NOSTATS_CANDIDATE_EMAIL,
  // Holds a subscription.
  subscribed: process.env.VIEWPROFILE_SUBSCRIBED_CANDIDATE_EMAIL,
  // `has_reminders: false`.
  noReminders: process.env.VIEWPROFILE_NO_REMINDER_CANDIDATE_EMAIL,
  // A candidate with a Current Status but an empty About Me - the pair the Basic Information
  // defect turns on.
  statusOnly: process.env.VIEWPROFILE_STATUSONLY_CANDIDATE_EMAIL,
  // Has uploaded NO document at all, so Document Verification renders its three empty states.
  // Left unpinned on purpose - see the step that resolves it.
  noDocuments: process.env.VIEWPROFILE_NODOCS_CANDIDATE_EMAIL,
  // Holds a document awaiting review AND one that has already been decided, so the review
  // decisions can be checked in BOTH directions on one candidate.
  mixedDocs: process.env.VIEWPROFILE_MIXEDDOCS_CANDIDATE_EMAIL,
};

// Every document the profile payload holds, in one list. The tab groups them by the entry that
// carries them (an education, a job, a certification) and a document only exists as a property
// of such an entry - there is no documents[] array on the payload.
const documentsIn = (p) =>
  [...(p.educations || []), ...(p.work_experiences || []), ...(p.certifications || [])]
    .filter((e) => e.document)
    .map((e) => e.document);

// The candidate the @mutates-profile scenario signs in as. It must be a candidate OF the agent
// under test, or the agent cannot open its profile at all.
const E2E_CANDIDATE_EMAIL = process.env.VIEWPROFILE_E2E_CANDIDATE_EMAIL;
const E2E_CANDIDATE_PASSWORD = process.env.VIEWPROFILE_E2E_CANDIDATE_PASSWORD;

const vp = (world) => world.pages.candidateViewProfile;

// ---------------------------------------------------------------------------- signing in
//
// >>> THIS ENVIRONMENT STALLS A LOGIN: IT STAYS ON /login WITH NO ERROR AND NEVER NAVIGATES.
//     THE FIX IS TO RETRY A FRESH ATTEMPT, NOT TO WAIT LONGER. <<<
//
// Measured twice on full runs of this feature - 2 of 45 scenarios, then 1 of 45 - each dying in
// the Background with `page.waitForURL: Timeout ... waiting for navigation until "commit"`, and
// each passing immediately when re-run alone. My first fix was to raise the wait from 60s to
// 120s. THAT WAS THE WRONG FIX AND IT FAILED: the next run blew through 120s too, because a
// stalled attempt never completes however long you wait - it just makes the run slower before
// reporting the same thing.
//
// steps/change-password.js already had this diagnosed and written down ("This environment
// occasionally stalls a login (stays on /login with no error) - those attempts are retried
// rather than treated as a failure"), so this is that pattern rather than a new invention. It is
// deliberately a reduced version: that file walks several candidate PASSWORDS because it rotates
// one, whereas here there is a single known password, so the only thing being retried is the
// stall.
//
// Each attempt is bounded and classified:
//   left /login            -> accepted
//   an error on the page   -> rejected; fail NOW and quote it (retrying a wrong password or a
//                             rate-limited account just deepens a lockout - see change-password)
//   still on /login, quiet -> stalled; re-navigate, re-fill, re-submit
// >>> THE HARDENED SIGN-IN NOW LIVES IN utils/resilientSignIn.js. <<<
// It was defined here, while steps/active-candidate.js - whose `I am logged in as an agent` is
// the Background of three other features - had a bare waitForURL and no retry at all. Two copies
// of a login is how they drift, and a fixed flake going on failing everywhere else is what
// actually happened. One implementation now; the whole rationale (why a bigger timeout is the
// WRONG fix, and why a rejection must never be retried) is written down there.
//
// This wrapper keeps the positional signature the steps below already call.
async function signIn(world, email, password, landedOn, attempts = 3) {
  return resilientSignIn(world, email, password, { landedOn, attempts });
}


// >>> EVERY STEP THAT DOES MORE THAN ONE PAGE'S WORK CARRIES AN EXPLICIT { timeout }. <<<
// features/support/hooks.js calls setDefaultTimeout(60000), and THAT OVERRIDES every profile's
// own `timeout` - this profile asks for 300000 and gets 60000. A step that opens three profiles
// across three listings, or walks a five-row tab table, is many times a normal step's work, so
// it is killed part way and reports "function timed out", which says nothing about the app and
// hides however many table rows had already passed. Measured on the first run of this file: the
// three-listing step died at exactly 60s.
//
// An internal wait longer than the step budget is not a slow test, it is a test that CANNOT
// pass. Give any new multi-subject step here a budget bigger than the work inside it.
const SLOW = { timeout: 240000 }; // opens one or more profiles from a listing
const TABLE = { timeout: 180000 }; // walks a table against one already-open profile
const AUDIT = { timeout: 180000 }; // a real 50-60 press Tab walk

async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// Throw once, listing every problem, with the subject named on each line.
function reportAll(problems, headline) {
  if (!problems.length) return;
  throw new Error(`${headline}\n  - ${problems.join('\n  - ')}`);
}

// Find a candidate on a listing satisfying `predicate(profilePayload)`, by walking the rows and
// reading each one's profile. Used only when a fixture key is unset.
//
// It reads the PAYLOAD rather than the rendered row, because every property these scenarios need
// (a headline, a photo, populated stats) is invisible in the grid.
async function resolveFixture(world, key, predicate, { listing = 'active', limit = 14 } = {}) {
  const page = vp(world);
  if (FIXTURES[key]) {
    const opened = await page.openProfile({ listing, email: FIXTURES[key] });
    await record(world, `fixture "${key}" (pinned in .env)`, opened);
    return opened;
  }

  await page.openListing(listing);
  const rows = await page.listingRows.count();
  const emails = [];
  for (let i = 0; i < Math.min(rows, limit); i += 1) {
    /* eslint-disable no-await-in-loop */
    const text = await page.listingRows.nth(i).innerText();
    /* eslint-enable no-await-in-loop */
    const m = text.match(/[\w.+-]+@[\w.-]+/);
    if (m) emails.push(m[0]);
  }

  const rejected = [];
  for (const email of emails) {
    /* eslint-disable no-await-in-loop */
    const opened = await page.openProfile({ listing, email });
    const payload = page.profilePayload();
    if (payload && predicate(payload)) {
      await record(world, `fixture "${key}" (resolved by scan - PIN IT IN .env)`, {
        ...opened,
        hint: `set VIEWPROFILE_${key.toUpperCase()}_CANDIDATE_EMAIL=${email}`,
      });
      return opened;
    }
    rejected.push(email);
    /* eslint-enable no-await-in-loop */
  }

  throw new Error(
    `no candidate on the "${listing}" listing satisfies the "${key}" fixture requirement.\n`
      + `  inspected: ${rejected.join(', ') || '(none)'}\n`
      + `  pin one with VIEWPROFILE_${key.toUpperCase()}_CANDIDATE_EMAIL in .env`
  );
}

// ==================== Background ====================

Given('I am logged in as an agent for candidate profiles', { timeout: 150000 }, async function () {
  if (!AGENT_EMAIL || !AGENT_PASSWORD) {
    throw new Error('Missing AGENT_EMAIL / AGENT_PASSWORD in .env');
  }
  // Retries a stalled attempt rather than waiting longer - see signIn().
  await signIn(this, AGENT_EMAIL, AGENT_PASSWORD, /\/dashboard|\/candidates|\/getting-started/);
  this.vpAgent = AGENT_EMAIL;
});

// ==================== opening the profile ====================

When('I open a candidate profile from the {string} listing', SLOW, async function (listing) {
  this.vpOpened = await vp(this).openProfile({ listing });
  this.vpListing = listing;
  await record(this, `opened the profile from the "${listing}" listing`, this.vpOpened);
});

When('I open a candidate profile from each of these listings:', SLOW, async function (dataTable) {
  const page = vp(this);
  const rows = dataTable.hashes();
  this.vpVisits = [];
  const problems = [];

  for (const { listing } of rows) {
    /* eslint-disable no-await-in-loop */
    try {
      const opened = await page.openProfile({ listing });
      const visit = {
        ...opened,
        header: await page.readHeader(),
        widgets: await page.readWidgets(),
        tabs: await page.tabLabels(),
        selectedTab: await page.selectedTabLabel(),
        slug: page.currentSlug(),
        sections: await page.sectionHeadings(),
        headerActions: await page.readHeaderActions(),
        reminderHistoryEnabled: await page.reminderHistoryEnabled(),
        payload: page.profilePayload(),
      };
      this.vpVisits.push(visit);
    } catch (e) {
      problems.push(`${listing}: could not open a profile - ${e.message.split('\n')[0]}`);
    }
    /* eslint-enable no-await-in-loop */
  }

  await record(
    this,
    'profiles opened, one per listing',
    this.vpVisits.map((v) => ({
      listing: v.listing,
      candidate: v.subject,
      candidateId: v.candidateId,
      url: v.url,
      selectedTab: v.selectedTab,
      tabs: v.tabs,
      sections: v.sections,
      header: v.header,
      widgets: v.widgets,
    }))
  );
  reportAll(problems, 'a listing did not open a candidate profile:');
  expect(this.vpVisits.length, 'no profile was opened at all').toBeGreaterThan(0);
});

When('I open the {string} listing', SLOW, async function (listing) {
  this.vpListingSpec = await vp(this).openListing(listing);
  this.vpListing = listing;
});

// Reuses the profile already open when there is one, so the scenario that checks TWO slugs (an
// empty control, then an unknown value) costs one listing walk rather than two.
When('I open the profile with the tab slug {string}', SLOW, async function (slug) {
  const page = vp(this);
  const opened = this.vpOpened || (await page.openProfile({ listing: 'active' }));
  await page.gotoProfile(opened.candidateId, slug);
  this.vpOpened = opened;
  this.vpRequestedSlug = slug;
  await record(this, `opened with ?selectedTab=${slug}`, {
    requestedSlug: slug,
    // The app REWRITES the URL when it falls back, so the landing URL is itself the evidence
    // for which slug it decided on.
    landedOn: this.page.url(),
    slugAfter: page.currentSlug(),
  });
});

When('I reload the profile', SLOW, async function () {
  const before = this.page.url();
  const response = this.page
    .waitForResponse((r) => /\/candidate\/profile\/\d+\/$/.test(r.url()) && r.status() === 200, {
      timeout: 40000,
    })
    .catch(() => null);
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await response;
  await vp(this).settleProfile();
  await record(this, 'reloaded the profile', { before, after: this.page.url() });
});

When('I click the profile Back control', TABLE, async function () {
  this.vpUrlAfterBack = await vp(this).clickBack();
  await record(this, 'clicked Back', { landedOn: this.vpUrlAfterBack });
});

// ---- fixture-selected subjects

When('I open the profile of the candidate with the fullest details', SLOW, async function () {
  this.vpOpened = await resolveFixture(
    this,
    'fullest',
    (p) =>
      (p.educations || []).length > 0
      && (p.work_experiences || []).length > 0
      && (p.certifications || []).length > 0
      && (p.roles || []).length > 0
      && !!p.about_me
  );
  this.vpPayload = vp(this).profilePayload();
});

When('I open the profile of the candidate who has a headline', SLOW, async function () {
  this.vpOpened = await resolveFixture(this, 'headline', (p) => !!p.headline);
  this.vpPayload = vp(this).profilePayload();
});

When('I open the profile of the candidate who has a profile photo', SLOW, async function () {
  this.vpOpened = await resolveFixture(
    this,
    'photo',
    (p) => !!(p.profile_image || (p.user && p.user.profile_image)),
    // The one candidate measured to have a photo sits on Requires Attention, so that listing is
    // scanned as well before the fixture is declared unavailable.
    { listing: 'requires attention' }
  );
  this.vpPayload = vp(this).profilePayload();
});

When(
  'I open the profile of the candidate whose progress statistics are populated',
  SLOW,
  async function () {
    this.vpOpened = await resolveFixture(this, 'stats', (p) => p.stats !== null);
    this.vpPayload = vp(this).profilePayload();
  }
);

When('I open the profile of the candidate whose progress statistics are absent', SLOW, async function () {
  this.vpOpened = await resolveFixture(this, 'noStats', (p) => p.stats === null);
  this.vpPayload = vp(this).profilePayload();
});

// The subscribed candidate cannot be resolved from the profile payload - it carries no
// subscription data at all (the Subscription tab fetches its own). The LISTING does, in its
// Subscription Status column, so the subject is chosen there.
//
// >>> "Not Subscribed" CONTAINS "Subscribed". <<< A substring test on the row text picks an
// unsubscribed candidate and the scenario then fails against a correct empty state, so the
// negative is excluded explicitly.
When('I open the profile of the subscribed candidate', SLOW, async function () {
  const page = vp(this);
  if (FIXTURES.subscribed) {
    this.vpOpened = await page.openProfile({ listing: 'active', email: FIXTURES.subscribed });
    await record(this, 'fixture "subscribed" (pinned in .env)', this.vpOpened);
  } else {
    await page.openListing('active');
    const rows = await page.listingRows.count();
    let chosen = null;
    const inspected = [];
    for (let i = 0; i < rows; i += 1) {
      /* eslint-disable no-await-in-loop */
      const text = await page.listingRows.nth(i).innerText();
      /* eslint-enable no-await-in-loop */
      const email = (text.match(/[\w.+-]+@[\w.-]+/) || [])[0];
      const subscribed = /\bSubscribed\b/.test(text) && !/\bNot Subscribed\b/.test(text);
      inspected.push({ email, subscribed });
      if (subscribed && email) {
        chosen = email;
        break;
      }
    }
    if (!chosen) {
      throw new Error(
        'no candidate on page 1 of the Active listing shows Subscription Status "Subscribed".\n'
          + `  inspected: ${JSON.stringify(inspected)}\n`
          + '  pin one with VIEWPROFILE_SUBSCRIBED_CANDIDATE_EMAIL in .env'
      );
    }
    this.vpOpened = await page.openProfile({ listing: 'active', email: chosen });
    await record(this, 'fixture "subscribed" (resolved from the listing - PIN IT IN .env)', {
      ...this.vpOpened,
      hint: `set VIEWPROFILE_SUBSCRIBED_CANDIDATE_EMAIL=${chosen}`,
    });
  }
  this.vpPayload = vp(this).profilePayload();
});

When('I open the profile of the candidate who has no reminders', SLOW, async function () {
  this.vpOpened = await resolveFixture(this, 'noReminders', (p) => p.has_reminders === false);
  this.vpPayload = vp(this).profilePayload();
});

When(
  'I open the profile of the candidate whose only basic information is their status',
  SLOW,
  async function () {
    // The defect's precondition: a stored qualification AND an empty about_me.
    this.vpOpened = await resolveFixture(
      this,
      'statusOnly',
      (p) => !!p.qualification && !p.about_me
    );
    this.vpPayload = vp(this).profilePayload();
  }
);

// ==================== 1. route ====================

Then('each profile should have opened on the candidate-details tab', async function () {
  const problems = [];
  for (const v of this.vpVisits) {
    if (v.slug !== 'candidate-details') {
      problems.push(`${v.listing}: opened on ?selectedTab=${v.slug}, expected candidate-details`);
    }
    if (v.selectedTab !== 'Candidate Details') {
      problems.push(`${v.listing}: the selected tab is "${v.selectedTab}"`);
    }
  }
  reportAll(problems, 'the View action did not open on the Candidate Details tab:');
});

// A profile that always rendered the FIRST candidate would satisfy every other assertion in this
// file. Comparing the rendered name against the row that was clicked is what rules that out -
// the same class of bug as a drawer that always shows row 0.
Then('each profile should name the candidate whose row was clicked', async function () {
  const problems = [];
  for (const v of this.vpVisits) {
    const payload = v.payload;
    if (!payload) {
      problems.push(`${v.listing}: no profile payload was captured, so nothing can be compared`);
      continue;
    }
    const expected = `${payload.user.firstname || ''} ${payload.user.lastname || ''}`.trim();
    if (P.norm(v.header.name) !== P.norm(expected)) {
      problems.push(
        `${v.listing}: the header reads "${v.header.name}" but the fetched profile is for "${expected}"`
      );
    }
    if (payload.user.id !== v.candidateId) {
      problems.push(
        `${v.listing}: the URL names candidate ${v.candidateId} but the payload is for ${payload.user.id}`
      );
    }
  }
  reportAll(problems, 'a profile did not name the candidate whose row was clicked:');
});

Then("opening the profile should have fetched that candidate's profile", async function () {
  const page = vp(this);
  const paths = page.pathsSince(0);
  // Tolerant of a query string: the assertion is that the profile was fetched, not that the app
  // sent it with no parameters, and pinning the bare form would be red the day one is added.
  const fetched = paths.filter((p) => /^candidate\/profile\/\d+\/(\?|$)/.test(p));
  await record(this, 'requests made while opening the profile', paths);
  expect(
    fetched.length,
    `expected a GET candidate/profile/<id>/ when the profile opened; saw: ${paths.join(', ')}`
  ).toBeGreaterThan(0);
  expect(page.profilePayload(), 'the profile payload was not captured').toBeTruthy();
});

Then('the fetched profile should belong to the candidate in the URL', async function () {
  const page = vp(this);
  const payload = page.profilePayload();
  const idInUrl = page.candidateIdFromUrl();
  await record(this, 'identity check', {
    idInUrl,
    payloadUserId: payload && payload.user && payload.user.id,
  });
  expect(payload.user.id, 'the fetched profile is for a different candidate than the URL names')
    .toBe(idInUrl);
});

Then('the profile should still show the same candidate', async function () {
  const page = vp(this);
  const header = await page.readHeader();
  const payload = page.profilePayload();
  const expected = `${payload.user.firstname || ''} ${payload.user.lastname || ''}`.trim();
  await record(this, 'after reload', { header, expected, url: this.page.url() });
  expect(page.candidateIdFromUrl(), 'the reload changed which candidate is open').toBe(
    this.vpOpened.candidateId
  );
  expect(P.norm(header.name)).toBe(P.norm(expected));
});

Then('the candidate-details tab should be the selected tab', async function () {
  const selected = await vp(this).selectedTabLabel();
  expect(selected, 'Candidate Details is not the selected tab').toBe('Candidate Details');
});

Then('I should be back on the {string} listing', async function (listing) {
  const spec = vp(this).listings[String(listing).toLowerCase()];
  await record(this, 'after Back', { url: this.page.url() });
  expect(this.page.url(), `Back did not return to the ${listing} listing`).not.toMatch(
    /\/view-profile/
  );
  await expect(vp(this).pageHeading).toContainText(
    spec.heading,
    { timeout: 20000 }
  );
});

// ==================== 2. header and widgets ====================

Then(
  "each profile header should render the avatar band above the candidate's details",
  async function () {
    const problems = [];
    for (const v of this.vpVisits) {
      if (!v.header.hasAvatarBand) problems.push(`${v.listing}: no avatar band rendered`);
    }
    reportAll(problems, 'the profile header did not render its avatar band:');
  }
);

Then(
  'each profile header should show the name, status and location the payload holds',
  async function () {
    const problems = [];
    for (const v of this.vpVisits) {
      const p = v.payload;
      if (!p) {
        problems.push(`${v.listing}: no payload captured`);
        continue;
      }
      const name = `${p.user.firstname || ''} ${p.user.lastname || ''}`.trim();
      if (P.norm(v.header.name) !== P.norm(name)) {
        problems.push(`${v.listing}: name reads "${v.header.name}", payload holds "${name}"`);
      }
      // The pill carries VERIFICATION status, not account status - see the deactivated-profile
      // scenario for why that distinction matters.
      const expectedPill = p.is_verified ? 'Verified' : 'Unverified';
      if (P.norm(v.header.statusPill) !== expectedPill) {
        problems.push(
          `${v.listing}: status pill reads "${v.header.statusPill}", `
            + `is_verified=${p.is_verified} so it should read "${expectedPill}"`
        );
      }
      const loc = p.current_location && p.current_location.location_name;
      if (loc && P.norm(v.header.location) !== P.norm(loc)) {
        problems.push(
          `${v.listing}: location reads "${v.header.location}", payload holds "${loc}"`
        );
      }
    }
    reportAll(problems, "the profile header disagreed with the candidate's stored profile:");
  }
);

Then("the header should render that candidate's headline", async function () {
  const header = await vp(this).readHeader();
  const expected = this.vpPayload.headline;
  await record(this, 'headline', { rendered: header.headline, stored: expected, header });
  expect(expected, 'the resolved fixture has no headline, so nothing is under test').toBeTruthy();
  expect(P.norm(header.headline), 'the stored headline is not rendered in the header').toBe(
    P.norm(expected)
  );
});

Then("the header should render that candidate's profile photo", async function () {
  const header = await vp(this).readHeader();
  const stored = this.vpPayload.profile_image || (this.vpPayload.user || {}).profile_image;
  await record(this, 'profile photo', {
    renderedSrc: P.redact(header.avatarImageSrc || ''),
    storedSrc: P.redact(stored || ''),
    hasAvatarImage: header.hasAvatarImage,
  });
  expect(stored, 'the resolved fixture has no profile_image, so nothing is under test').toBeTruthy();
  expect(header.hasAvatarImage, 'no profile photo is rendered for a candidate who has one').toBe(
    true
  );
  // Compare the PATH, not the whole URL - a presigned or CDN-rewritten src legitimately differs
  // in its query while naming the same object.
  const file = String(stored).split('?')[0].split('/').pop();
  expect(header.avatarImageSrc, `the rendered photo is not the stored one (${file})`).toContain(
    file
  );
});

Then('the four progress widgets should be displayed', async function () {
  const widgets = await vp(this).readWidgets();
  await record(this, 'widgets', widgets);
  const missing = P.WIDGETS.filter((w) => widgets[w.label] === null).map((w) => w.label);
  expect(missing, `these widgets did not render: ${missing.join(', ')}`).toHaveLength(0);
});

Then('each widget should show the figure its statistic holds', async function () {
  const widgets = await vp(this).readWidgets();
  const stats = this.vpPayload.stats;
  await record(this, 'widgets vs stats', { widgets, stats });
  expect(stats, 'the resolved fixture has no stats, so nothing is under test').toBeTruthy();

  const problems = [];
  for (const w of P.WIDGETS) {
    const expected = `${stats[w.statKey]}${w.suffix}`;
    if (P.norm(widgets[w.label]) !== P.norm(expected)) {
      problems.push(
        `${w.label}: shows "${widgets[w.label]}", stats.${w.statKey}=${stats[w.statKey]} `
          + `so it should show "${expected}"`
      );
    }
  }
  reportAll(problems, 'a progress widget disagreed with the statistic behind it:');
});

Then('every progress widget should show the uncomputed-statistic placeholder', async function () {
  const widgets = await vp(this).readWidgets();
  await record(this, 'widgets (stats absent)', { widgets, stats: this.vpPayload.stats });
  expect(this.vpPayload.stats, 'the resolved fixture HAS stats, so nothing is under test').toBeNull();

  const problems = [];
  for (const w of P.WIDGETS) {
    const expected = `${P.UNCOMPUTED_STAT}${w.suffix}`;
    if (P.norm(widgets[w.label]) !== expected) {
      problems.push(`${w.label}: shows "${widgets[w.label]}", expected "${expected}"`);
    }
  }
  reportAll(problems, 'an uncomputed statistic did not render the em-dash placeholder:');
});

// A zero and an unknown are different facts. A widget showing 0 for a candidate whose statistics
// have never been computed tells the agent the candidate has done nothing, which is not known.
Then('no progress widget should show a zero', async function () {
  const widgets = await vp(this).readWidgets();
  const zeros = P.WIDGETS.filter((w) => /^0%?$/.test(P.norm(widgets[w.label]))).map((w) => w.label);
  expect(
    zeros,
    `these widgets show a zero where the statistic is uncomputed: ${zeros.join(', ')}`
  ).toHaveLength(0);
});

Then('the profile header should identify that candidate', async function () {
  const page = vp(this);
  const header = await page.readHeader();
  const p = page.profilePayload();
  const name = `${p.user.firstname || ''} ${p.user.lastname || ''}`.trim();
  await record(this, 'header', header);
  expect(P.norm(header.name)).toBe(P.norm(name));
  expect(header.hasAvatarBand, 'the avatar band did not render').toBe(true);
});

// ==================== 3. Candidate Details ====================

Then('each Candidate Details tab should show exactly these sections in order:', async function (
  dataTable
) {
  const expected = dataTable.hashes().map((r) => r.section);
  const problems = [];
  for (const v of this.vpVisits) {
    if (JSON.stringify(v.sections) !== JSON.stringify(expected)) {
      problems.push(
        `${v.listing}: sections are [${v.sections.join(', ')}], expected [${expected.join(', ')}]`
      );
    }
  }
  reportAll(problems, 'the Candidate Details sections differ from the expected set:');
});

Then(
  'every education entry the candidate recorded should be shown with its institution, degree, field and dates',
  async function () {
    const section = await vp(this).readSection('Education');
    const stored = this.vpPayload.educations || [];
    await record(this, 'Education', { rendered: section.lines, stored });
    expect(stored.length, 'the fixture records no education, so nothing is under test')
      .toBeGreaterThan(0);

    const text = P.norm(section.text);
    const problems = [];
    stored.forEach((e, i) => {
      const want = [
        ['institution', e.institution_name],
        ['degree', e.degree_name],
        ['field of study', e.field_of_study_name],
      ];
      want.forEach(([what, value]) => {
        if (value && !text.includes(P.norm(value))) {
          problems.push(`entry ${i + 1}: the ${what} "${value}" is not shown`);
        }
      });
      // Dates are asserted as the MONTH and YEAR the stored value holds, rather than by
      // re-deriving the app's whole date sentence - a helper clever enough to reproduce the
      // formatting would agree with the app by construction.
      [
        ['start', e.start_date],
        ['end', e.end_date],
      ].forEach(([which, iso]) => {
        const my = P.isoMonthYear(iso);
        if (my && !(text.includes(my.month) && text.includes(my.year))) {
          problems.push(
            `entry ${i + 1}: the ${which} date ${iso} should render as ${my.month} ${my.year}`
          );
        }
      });
    });
    reportAll(problems, "the Education section does not show what the candidate recorded:");
  }
);

Then(
  'every education entry that carries a document should offer it as a named attachment',
  async function () {
    const attachments = await vp(this).readAttachments('Education');
    const stored = (this.vpPayload.educations || []).filter((e) => e.document);
    await record(this, 'Education attachments', { rendered: attachments, storedCount: stored.length });

    const problems = [];
    stored.forEach((e) => {
      const hit = attachments.find((a) => P.norm(a.fileName) === P.norm(e.document.file_name));
      if (!hit) {
        problems.push(
          `"${e.document.file_name}" is stored against ${e.institution_name} but is not offered`
        );
        return;
      }
      // A filename rendered as plain text would satisfy a text check while giving the agent
      // nothing to open.
      if (!hit.href) problems.push(`"${e.document.file_name}" is shown but is not a link`);
    });
    reportAll(problems, 'a stored education document is not offered as an attachment:');
  }
);

Then(
  'every work experience entry should be shown with its designation, employment type, company and dates',
  async function () {
    const section = await vp(this).readSection('Work Experience');
    const stored = this.vpPayload.work_experiences || [];
    await record(this, 'Work Experience', { rendered: section.lines, stored });
    expect(stored.length, 'the fixture records no work experience').toBeGreaterThan(0);

    const text = P.norm(section.text);
    const problems = [];
    stored.forEach((w, i) => {
      if (w.designation && !text.includes(P.norm(w.designation))) {
        problems.push(`entry ${i + 1}: the designation "${w.designation}" is not shown`);
      }
      if (w.company_name && !text.includes(P.norm(w.company_name))) {
        problems.push(`entry ${i + 1}: the company "${w.company_name}" is not shown`);
      }
      const type = P.titleCaseEnum(w.experience);
      if (type && !text.includes(type)) {
        problems.push(
          `entry ${i + 1}: employment type "${w.experience}" should render as "${type}" `
            + `- not found in: ${section.lines.join(' | ')}`
        );
      }
      const my = P.isoMonthYear(w.start_date);
      if (my && !(text.includes(my.month) && text.includes(my.year))) {
        problems.push(`entry ${i + 1}: start date ${w.start_date} should render as ${my.month} ${my.year}`);
      }
    });
    reportAll(problems, 'the Work Experience section does not show what the candidate recorded:');
  }
);

Then('an ongoing role should be shown as running to {string}', async function (word) {
  const section = await vp(this).readSection('Work Experience');
  const ongoing = (this.vpPayload.work_experiences || []).filter((w) => w.is_current || !w.end_date);
  await record(this, 'ongoing roles', { ongoingCount: ongoing.length, rendered: section.lines });
  expect(ongoing.length, 'the fixture records no ongoing role, so nothing is under test')
    .toBeGreaterThan(0);
  expect(
    P.norm(section.text),
    `an ongoing role should be shown as running to "${word}"`
  ).toContain(word);
});

Then(
  'every certification should be shown with its name, issuing organisation and issue date',
  async function () {
    const section = await vp(this).readSection('Certifications');
    const stored = this.vpPayload.certifications || [];
    await record(this, 'Certifications', { rendered: section.lines, stored });
    expect(stored.length, 'the fixture records no certification').toBeGreaterThan(0);

    const text = P.norm(section.text);
    const problems = [];
    stored.forEach((c, i) => {
      if (c.name && !text.includes(P.norm(c.name))) {
        problems.push(`entry ${i + 1}: the name "${c.name}" is not shown`);
      }
      if (c.issued_by && !text.includes(P.norm(c.issued_by))) {
        problems.push(`entry ${i + 1}: the issuing organisation "${c.issued_by}" is not shown`);
      }
      const my = P.isoMonthYear(c.issue_date);
      if (my && !(text.includes(my.month) && text.includes(my.year))) {
        problems.push(
          `entry ${i + 1}: issue date ${c.issue_date} should render as ${my.month} ${my.year}`
        );
      }
    });
    reportAll(problems, 'the Certifications section does not show what the candidate recorded:');
  }
);

Then('Work Preferences should show exactly these fields:', async function (dataTable) {
  const expected = dataTable.hashes().map((r) => r.field);
  const fields = await vp(this).readLabelledFields('Work Preferences & Availability');
  await record(this, 'Work Preferences fields', fields);
  const got = Object.keys(fields || {});
  const missing = expected.filter((f) => !got.includes(f));
  expect(
    missing,
    `these Work Preferences fields are missing: ${missing.join(', ')} (saw: ${got.join(', ')})`
  ).toHaveLength(0);
});

Then("the work preference values should match the candidate's stored preferences", async function () {
  const fields = await vp(this).readLabelledFields('Work Preferences & Availability');
  const p = this.vpPayload;
  await record(this, 'Work Preferences vs payload', {
    fields,
    stored: {
      current_location: p.current_location,
      preferred_locations: p.preferred_locations,
      interested_in_relocation: p.interested_in_relocation,
      interested_in_tamheer: p.interested_in_tamheer,
      is_co_op_preferred: p.is_co_op_preferred,
    },
  });

  const problems = [];

  const city = p.current_location && p.current_location.location_name;
  if (city && P.norm(fields['Current City']) !== P.norm(city)) {
    problems.push(`Current City shows "${fields['Current City']}", stored "${city}"`);
  }

  const expectRelocation = p.interested_in_relocation ? 'Yes' : 'No';
  if (P.norm(fields['Open to Relocation']) !== expectRelocation) {
    problems.push(
      `Open to Relocation shows "${fields['Open to Relocation']}", `
        + `interested_in_relocation=${p.interested_in_relocation} so it should read "${expectRelocation}"`
    );
  }

  // Preferred locations: every stored location must appear. An unset list renders the
  // unset-field placeholder, which is correct and is asserted as such.
  const locs = (p.preferred_locations || []).map((l) => l.location_name);
  const prefValue = P.norm(fields['Preferred Work Location(s)']);
  if (!locs.length) {
    if (prefValue !== P.UNSET_FIELD) {
      problems.push(
        `Preferred Work Location(s) shows "${prefValue}" but none is stored, `
          + `so it should show "${P.UNSET_FIELD}"`
      );
    }
  } else {
    locs.forEach((l) => {
      if (!prefValue.includes(P.norm(l))) {
        problems.push(`Preferred Work Location(s) does not include the stored "${l}"`);
      }
    });
  }

  // Interested Programs is derived from two booleans; neither set renders the placeholder.
  //
  // >>> MATCHED CASE-INSENSITIVELY ON PURPOSE, AND THE RENDERING IS RECORDED INSTEAD. <<<
  // The product spells the co-op programme TWO ways: Interested Programs renders **"Co-Op"**
  // (capital O) while the Work Experience section renders **"Co-op"** for the employment type of
  // the same name. Measured on one candidate showing "Co-Op, Tamheer". Pinning either spelling
  // would make this step red on a capitalisation nit and bury the assertion that matters -
  // whether the programme the candidate opted into is listed at all - so the presence is
  // asserted and the inconsistency is attached for the PO.
  const programs = [];
  if (p.interested_in_tamheer) programs.push('Tamheer');
  if (p.is_co_op_preferred) programs.push('Co-op');
  const progValue = P.norm(fields['Interested Programs']);
  if (!programs.length) {
    if (progValue !== P.UNSET_FIELD) {
      problems.push(
        `Interested Programs shows "${progValue}" but neither Tamheer nor Co-op is stored, `
          + `so it should show "${P.UNSET_FIELD}"`
      );
    }
  } else {
    programs.forEach((prog) => {
      if (!progValue.toLowerCase().includes(prog.toLowerCase())) {
        problems.push(`Interested Programs does not include "${prog}", which is stored as true`);
      }
    });
    if (p.is_co_op_preferred && progValue.includes('Co-Op')) {
      await record(
        this,
        'FOR THE PO: the co-op programme is spelled two ways in one product',
        `Interested Programs renders "Co-Op" (capital O); the Work Experience section renders`
          + ' "Co-op" for the employment type of the same name. Rendered here: '
          + `"${progValue}"`
      );
    }
  }

  reportAll(problems, "Work Preferences disagreed with the candidate's stored preferences:");
});

Then('Desired Roles should list every role the candidate selected', async function () {
  const section = await vp(this).readSection('Desired Roles');
  const stored = (this.vpPayload.roles || []).map((r) => r.name);
  await record(this, 'Desired Roles', { rendered: section.lines, stored });
  expect(stored.length, 'the fixture records no desired role').toBeGreaterThan(0);

  // Role names are stored UPPERCASE ("DATA ANALYST") and rendered in title case, so the
  // comparison is case-insensitive on the role name itself - but the COUNT is asserted too, so a
  // page rendering only the first role is caught.
  const text = P.norm(section.text).toLowerCase();
  const problems = [];
  stored.forEach((name) => {
    if (!text.includes(P.norm(name).toLowerCase())) {
      problems.push(`the stored role "${name}" is not listed`);
    }
  });
  if (section.lines.length < stored.length) {
    problems.push(
      `${stored.length} roles are stored but only ${section.lines.length} lines are rendered`
    );
  }
  reportAll(problems, 'Desired Roles does not list every stored role:');
});

// A raw enum reaching the screen is a defect wherever it happens. The candidate's own portal
// leaks `co_op` in one place; this locks the agent side against the same regression.
Then('no section should render a raw underscored enum value', async function () {
  const sections = await vp(this).readAllSections();
  const offenders = [];
  Object.values(sections).forEach((s) => {
    if (!s.found) return;
    s.lines.forEach((line) => {
      // A lowercase token joined by underscores, e.g. co_op / work_experience / not_specified.
      if (/\b[a-z]+(_[a-z]+)+\b/.test(line)) offenders.push(`${s.name}: "${line}"`);
    });
  });
  await record(this, 'raw-enum scan', { offenders });
  reportAll(offenders, 'a raw underscored enum value is rendered instead of a label:');
});

Then('Basic Information should show exactly these fields:', async function (dataTable) {
  const expected = dataTable.hashes().map((r) => r.field);
  const section = await vp(this).readSection('Basic Information');
  const fields = await vp(this).readLabelledFields('Basic Information');
  await record(this, 'Basic Information', { fields, lines: section.lines });
  expect(
    section.isEmptyState,
    'Basic Information is showing its empty state, so its fields cannot be checked'
  ).toBe(false);
  const got = Object.keys(fields || {});
  const missing = expected.filter((f) => !got.includes(f));
  expect(
    missing,
    `these Basic Information fields are missing: ${missing.join(', ')} (saw: ${got.join(', ')})`
  ).toHaveLength(0);
});

Then(
  'Basic Information should show the Current Status and About Me the candidate stored',
  async function () {
    const fields = await vp(this).readLabelledFields('Basic Information');
    const p = this.vpPayload;
    const expectedStatus = P.titleCaseEnum(p.qualification);
    await record(this, 'Basic Information vs payload', {
      fields,
      stored: { qualification: p.qualification, about_me: p.about_me },
      expectedStatus,
    });

    const problems = [];
    if (expectedStatus && P.norm(fields['Current Status']) !== expectedStatus) {
      problems.push(
        `Current Status shows "${fields['Current Status']}", qualification="${p.qualification}" `
          + `so it should read "${expectedStatus}"`
      );
    }
    if (p.about_me && P.norm(fields['About Me']) !== P.norm(p.about_me)) {
      problems.push(`About Me shows "${fields['About Me']}", stored "${p.about_me}"`);
    }
    reportAll(problems, "Basic Information disagreed with the candidate's stored details:");
  }
);

Then('Basic Information should not claim the candidate added nothing', async function () {
  const section = await vp(this).readSection('Basic Information');
  const p = this.vpPayload;
  await record(this, 'Basic Information empty-state check', {
    isEmptyState: section.isEmptyState,
    rendered: section.lines,
    stored: { qualification: p.qualification, about_me: p.about_me },
  });

  // >>> THE PREMISE IS GUARDED FIRST, AND THIS STEP PASSED VACUOUSLY FOR WANT OF IT. <<<
  // The defect is "the section claims nothing was added WHILE a value is stored", so it only
  // means anything on a candidate who has a `qualification` and an EMPTY `about_me`. The pinned
  // fixture's about_me changed from null to "I'm a Tester" between being chosen and being run -
  // somebody edited that candidate - and the step then asserted `isEmptyState === false`, which
  // was trivially true because the section now had an About Me to render. It reported PASSED
  // having tested nothing at all.
  //
  // A step that goes green on a lost premise is worse than one that fails, because it retires
  // the assertion silently. Both halves of the premise are therefore asserted before the
  // behaviour, and they fail with a message that says to re-resolve the fixture rather than
  // pointing at the app.
  expect(
    p.qualification,
    'this scenario needs a candidate who HAS stored a Current Status - the resolved fixture has'
      + ' no `qualification`, so there is nothing for the section to be hiding'
  ).toBeTruthy();
  expect(
    p.about_me || '',
    `this scenario needs a candidate whose about_me is EMPTY - the resolved fixture holds`
      + ` ${JSON.stringify(p.about_me)}, so Basic Information renders its table and the gating`
      + ' under test is not exercised. Re-resolve the fixture (leave'
      + ' VIEWPROFILE_STATUSONLY_CANDIDATE_EMAIL unset and the step will scan for one).'
  ).toBe('');

  expect(
    section.isEmptyState,
    `Basic Information claims the candidate added nothing, but their stored profile holds`
      + ` qualification="${p.qualification}" (about_me is ${JSON.stringify(p.about_me)}).`
      + ' The section appears to be gated on about_me alone, hiding the Current Status the'
      + ' candidate did provide.'
  ).toBe(false);
});

Then('Basic Information should show the Current Status the candidate stored', async function () {
  const fields = await vp(this).readLabelledFields('Basic Information');
  const expected = P.titleCaseEnum(this.vpPayload.qualification);
  await record(this, 'Current Status', { fields, expected });
  expect(fields, 'Basic Information rendered no labelled fields at all').toBeTruthy();
  expect(P.norm(fields['Current Status'])).toBe(expected);
});

// >>> THE AGENT SHOWS WHAT THE CANDIDATE FILLED IN, AND MARKS THE REST UNSET. <<<
// This is the linkage rule, asserted in BOTH directions per field, which is what makes it
// falsifiable: a field the candidate stored must be rendered WITH THAT VALUE, and a field they
// left empty must render the unset placeholder rather than a value from somewhere else.
//
// >>> IT REPLACED A STEP THAT REPORTED A PRODUCT DEFECT THAT DOES NOT EXIST. <<< The old step
// asked "which rendered rows have no source field in the payload" by testing
// `Object.keys(payload)` - the TOP LEVEL only - and Nationality lives at `user.nationality`.
// So it concluded the agent view "can never populate" a field the payload carries perfectly well,
// and the scenario sat `@known-issue` against a build that was right. Measured 2026-09-22:
//
//     user.* = id, public_id, firstname, lastname, profile_image, email, phone_number, nationality
//     user.email       "faran.mustafa+26@bytecorp.io"  -> rendered as the address
//     user.phone_number null                            -> rendered "-"   (candidate never added it)
//     user.nationality  null                            -> rendered "-"   (candidate never added it)
//
// A reader that looks in the wrong place can only ever answer "absent", and absence read as a
// defect is how this one was filed. Resolve by PATH, not by top-level key.
Then(
  'Basic Information should show exactly what the candidate stored:',
  TABLE,
  async function (table) {
    const page = vp(this);
    const fields = await page.readLabelledFields('Basic Information');
    const payload = page.profilePayload();
    expect(payload, 'the profile payload was never captured, so there is nothing to compare against')
      .toBeTruthy();

    // `user.email` -> payload.user.email. Written out rather than flattened, because the whole
    // point of this step is that the nesting is where the last reader went wrong.
    const at = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), payload);

    const problems = [];
    const trace = [];

    for (const row of table.hashes()) {
      const label = row.field;
      const stored = at(row['payload field']);
      const rendered = fields[label];

      if (rendered === undefined) {
        problems.push(`${label}: the section renders no such row at all`);
        trace.push(`${label}: NOT RENDERED (stored ${JSON.stringify(stored)})`);
        continue;
      }

      const shown = P.norm(rendered);
      const isUnset = shown === P.UNSET_FIELD || shown === '';
      // The enum fields render Title-Cased; everything else renders as stored.
      const expected = row.enum === 'yes' ? P.titleCaseEnum(stored) : stored;
      const candidateFilledItIn = stored !== null && stored !== undefined && String(stored).trim() !== '';

      trace.push(
        `${label}: stored=${JSON.stringify(stored)} rendered=${JSON.stringify(rendered)} `
        + `candidateFilledItIn=${candidateFilledItIn}`
      );

      if (candidateFilledItIn) {
        // The candidate DID fill it in, so the agent must be shown it.
        if (isUnset) {
          problems.push(
            `${label}: the candidate stored ${JSON.stringify(stored)} but the agent is shown `
            + `"${rendered}" - a value the candidate entered is not reaching their agent`
          );
        } else if (P.norm(expected) !== shown) {
          problems.push(
            `${label}: the candidate stored ${JSON.stringify(expected)} but the agent is shown `
            + `${JSON.stringify(rendered)}`
          );
        }
      } else if (!isUnset) {
        // The candidate left it empty, so the agent must NOT be shown a value for it.
        problems.push(
          `${label}: the candidate has not filled this in (payload ${JSON.stringify(stored)}) yet `
          + `the agent is shown ${JSON.stringify(rendered)} - the two portals disagree about `
          + 'whether this candidate supplied it'
        );
      }
    }

    await record(this, 'Basic Information against what the candidate stored', {
      rendered: fields,
      rows: trace,
      note:
        'A field the candidate has not filled in renders the unset placeholder "-". That is the '
        + 'product\'s own convention for an unset field and is asserted as correct, not as a gap.',
    });

    reportAll(problems, 'Basic Information does not match what the candidate stored:');
  }
);

Then('the qualifications the candidate recorded should be shown', async function () {
  const sections = await vp(this).readAllSections();
  const p = vp(this).profilePayload();
  const problems = [];
  const check = (name, stored, field) => {
    if (!stored.length) return;
    const text = P.norm(sections[name].text);
    stored.forEach((item) => {
      const v = item[field];
      if (v && !text.includes(P.norm(v))) problems.push(`${name}: "${v}" is not shown`);
    });
  };
  check('Education', p.educations || [], 'institution_name');
  check('Work Experience', p.work_experiences || [], 'company_name');
  check('Certifications', p.certifications || [], 'name');
  await record(
    this,
    'qualifications',
    Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.lines]))
  );
  reportAll(problems, 'a qualification the candidate recorded is not shown:');
});

// ==================== 4. tabs ====================

Then('each profile should offer exactly these tabs in order:', async function (dataTable) {
  const expected = dataTable.hashes().map((r) => r.tab);
  const problems = [];
  for (const v of this.vpVisits) {
    if (JSON.stringify(v.tabs) !== JSON.stringify(expected)) {
      problems.push(`${v.listing}: tabs are [${v.tabs.join(', ')}], expected [${expected.join(', ')}]`);
    }
  }
  reportAll(problems, 'the profile tab strip differs from the expected set:');
});

Then('selecting each tab in turn should mark it selected and write its slug:', TABLE, async function (
  dataTable
) {
  const page = vp(this);
  const problems = [];
  const trace = [];
  for (const row of dataTable.hashes()) {
    /* eslint-disable no-await-in-loop */
    const result = await page.selectTab(row.tab);
    trace.push(result);
    if (result.selected !== row.tab) {
      problems.push(`${row.tab}: after clicking it, the selected tab is "${result.selected}"`);
    }
    if (result.slug !== row.slug) {
      problems.push(`${row.tab}: wrote ?selectedTab=${result.slug}, expected ${row.slug}`);
    }
    /* eslint-enable no-await-in-loop */
  }
  await record(this, 'tab selection trace', trace);
  reportAll(problems, 'a tab did not select or did not write its own slug:');
});

When('I select the {string} tab', TABLE, async function (tab) {
  this.vpTabResult = await vp(this).selectTab(tab);
  this.vpTabResults = this.vpTabResults || [];
  this.vpTabResults.push(this.vpTabResult);
  await record(this, `selected the "${tab}" tab`, this.vpTabResult);
});

Then('neither of those tab selections should have queried the server', async function () {
  const problems = [];
  for (const r of this.vpTabResults || []) {
    // The profile payload fetch belongs to opening the profile, not to a tab selection; any
    // request at all AFTER the tab was clicked is what this asserts against.
    if (r.requests.length) {
      problems.push(`${r.label}: fired ${r.requests.length} request(s): ${r.requests.join(', ')}`);
    }
  }
  await record(this, 'requests per tab selection', this.vpTabResults);
  reportAll(
    problems,
    'a tab that re-renders the already-fetched profile payload queried the server:'
  );
});

Then('the Track Progress tab should be selected', async function () {
  const selected = await vp(this).selectedTabLabel();
  expect(selected).toBe('Track Progress');
});

// A 404 from /tracks/candidate/<id>/ is the NORMAL answer for a candidate with no learning
// track. The assertion is that the page handled it - the tab stays selected and the profile
// chrome survives - not that the request succeeded.
Then('the track request should have been answered without breaking the page', async function () {
  const page = vp(this);
  const trackCalls = page
    .responsesSince(0)
    .filter((r) => /\/tracks\/candidate\/\d+\//.test(r.url));
  await record(this, 'track requests', {
    calls: trackCalls.map((r) => ({ url: r.url.replace(/^.*\/core\/api\/v1\//, ''), status: r.status })),
    note: 'a 404 here means the candidate has no track and is the expected answer',
  });
  expect(trackCalls.length, 'the Track Progress tab fired no track request').toBeGreaterThan(0);
  expect(
    trackCalls.every((r) => r.status === 200 || r.status === 404),
    `the track request answered ${trackCalls.map((r) => r.status).join(', ')}`
  ).toBe(true);
  // The chrome must survive whatever the track endpoint said.
  expect(await page.tabs.count(), 'the tab strip did not survive the track response').toBe(
    P.TABS.length
  );
  const header = await page.readHeader();
  expect(header.name, 'the profile header did not survive the track response').toBeTruthy();
});

Then('the profile should still render its tab strip', async function () {
  const page = vp(this);
  const tabs = await page.tabLabels();
  await record(this, 'tab strip after an unrecognised slug', {
    slug: this.vpRequestedSlug,
    url: this.page.url(),
    tabs,
  });
  expect(tabs, 'the tab strip did not render').toHaveLength(P.TABS.length);
});

// >>> ONE COLLECTING STEP, NOT THREE. <<< The three facts below fail INDEPENDENTLY and cucumber
// abandons a scenario at its first failing step, so consecutive `Then`s could only ever report
// whichever failed first - and the live defect fails two of them. Reported together, a red row
// says which tab (if any) the app chose AND whether a panel rendered, which are different
// severities: "the strip is there but nothing is chosen" and "nothing is shown at all" send a
// developer to different places.
//
// The expected tab is a parameter rather than "any tab": Candidate Details is where the profile
// opens from every listing and where an empty slug already lands, so falling back anywhere else
// is a defect in its own right.
Then(
  'the profile should fall back to the {string} tab with its panel rendered',
  TABLE,
  async function (expected) {
    const page = vp(this);
    const states = [];
    const n = await page.tabs.count();
    for (let i = 0; i < n; i += 1) {
      /* eslint-disable no-await-in-loop */
      states.push({
        tab: (await page.tabs.nth(i).innerText()).trim(),
        checked: (await page.tabs.nth(i).getAttribute('aria-checked')) === 'true',
      });
      /* eslint-enable no-await-in-loop */
    }
    const selected = states.filter((s) => s.checked).map((s) => s.tab);

    // >>> THE PANEL IS DERIVED STRUCTURALLY, VIA THE PAGE OBJECT'S OWN PER-TAB READINESS. <<<
    // A text scan of `main` cannot do this job: `main` CONTAINS the tab strip, so a marker like
    // /Activity Log/ matches the tab's own label and reports a panel on a page rendering none.
    // Measured 2026-09-17 - that is exactly what the first version of this step did, answering
    // "a panel rendered" for a body of 226 characters that was entirely chrome.
    const sections = await page.sectionHeadings();
    const body = await page.main.innerText();
    const hasPanel = await page.waitForTabBody(expected, 8000);

    await record(this, `fallback for ?selectedTab=${this.vpRequestedSlug}`, {
      requestedSlug: this.vpRequestedSlug,
      // The app REWRITES the URL when it falls back, so where it landed is itself the evidence
      // for which slug it decided on.
      url: this.page.url(),
      slugAfter: page.currentSlug(),
      tabs: states,
      selected,
      sectionsRendered: sections,
      bodyLength: body.length,
    });

    const problems = [];
    if (selected.length !== 1) {
      problems.push(
        `${selected.length} of ${states.length} tabs are selected`
          + `${selected.length ? ` (${selected.join(', ')})` : ''}`
          + ' - an unusable slug should still leave the profile on a tab'
      );
    }
    if (!selected.includes(expected)) {
      problems.push(
        `the selected tab is ${selected.join(', ') || '(none)'}, not the default "${expected}"`
      );
    }
    if (!hasPanel) {
      problems.push(
        'no tab panel rendered at all - the agent is left with the header, the widget row and a'
          + ' tab strip above an empty body'
      );
    }
    reportAll(
      problems,
      `?selectedTab=${this.vpRequestedSlug} did not fall back to the "${expected}" tab.`
        + ' An EMPTY value falls back correctly (its own scenario asserts that), so the fallback'
        + ' exists and simply does not cover an unknown value:'
    );
  }
);

// ==================== 5. Document Verification ====================
//
// WHAT THIS TAB IS, in one line: the documents the CANDIDATE uploaded on their own portal,
// grouped Education / Work Experience / Certifications, each row carrying a View and a Download
// action. A candidate who has uploaded nothing gets an empty state per group, not a row.
//
// >>> THE VIEWER CARRIES Approve AND Request Revision, AND NOTHING HERE MAY CLICK THEM. <<<
// They appear only on a "Needs Review" document and either one commits irreversibly. Every step
// below OPENS the viewer, READS it and CLOSES it - which fires no request at all - and the
// gating is asserted by observing which controls are offered, never by using one. The single
// scenario that does commit a decision carries @mutates-document, is excluded from every
// routine profile, and lives at the foot of this file.

When('I open the profile of the candidate who has uploaded no documents', SLOW, async function () {
  // Deliberately NOT pinned by default. "Has uploaded nothing" is a state the product LEAVES -
  // the candidate uploads one document and the fixture is gone - so pinning it is the
  // DATE-08/noStats mistake. The resolver scans for a payload holding no document at all and
  // attaches which candidate it drove.
  this.vpOpened = await resolveFixture(this, 'noDocuments', (p) =>
    documentsIn(p).length === 0
  );
  this.vpPayload = vp(this).profilePayload();
});

When(
  'I open the profile of a candidate whose documents include one that needs review',
  SLOW,
  async function () {
    // The gating scenario needs BOTH cases on one candidate, or it can only check half its own
    // claim. The predicate therefore demands a document awaiting review AND one that is not, and
    // the step below refuses to pass if the resolved candidate somehow lacks either.
    this.vpOpened = await resolveFixture(this, 'mixedDocs', (p) => {
      const docs = documentsIn(p);
      return docs.some((d) => d.status === 'AWAITING') && docs.some((d) => d.status !== 'AWAITING');
    });
    this.vpPayload = vp(this).profilePayload();
  }
);

Then('every document the candidate uploaded should be listed under its category', async function () {
  const groups = await vp(this).readDocumentGroups();
  const p = vp(this).profilePayload();
  const expected = {
    Education: (p.educations || []).filter((e) => e.document).map((e) => e.document),
    'Work Experience': (p.work_experiences || []).filter((w) => w.document).map((w) => w.document),
    Certifications: (p.certifications || []).filter((c) => c.document).map((c) => c.document),
  };
  await record(this, 'Document Verification', { rendered: groups, expected });

  const problems = [];
  Object.entries(expected).forEach(([group, docs]) => {
    const rows = (groups[group] || {}).rows || [];
    docs.forEach((d) => {
      if (!rows.find((r) => P.norm(r.fileName) === P.norm(d.file_name))) {
        problems.push(`${group}: "${d.file_name}" is stored but not listed`);
      }
    });
    // A document listed under the wrong category is as wrong as one missing.
    rows.forEach((r) => {
      if (!docs.find((d) => P.norm(d.file_name) === P.norm(r.fileName))) {
        problems.push(`${group}: "${r.fileName}" is listed but is not a stored ${group} document`);
      }
    });
  });
  reportAll(problems, 'the Document Verification tab does not list the stored documents:');
  this.vpDocGroups = groups;
});

Then('each document row should show its file name, status and upload date', async function () {
  const groups = this.vpDocGroups || (await vp(this).readDocumentGroups());
  const problems = [];
  let rowsSeen = 0;
  Object.entries(groups).forEach(([group, g]) => {
    (g.rows || []).forEach((r, i) => {
      rowsSeen += 1;
      if (!r.fileName) problems.push(`${group} row ${i + 1}: no file name`);
      if (!r.status) problems.push(`${group} row ${i + 1}: no status label`);
      if (!r.uploadedOn) problems.push(`${group} row ${i + 1}: no upload date`);
    });
  });
  // A step that reports green having inspected nothing is worse than a red one: it retires the
  // assertion silently. The premise is that this candidate HAS documents.
  expect(
    rowsSeen,
    'no document rows were listed at all, so this step inspected nothing - re-resolve the'
      + ' fixture, it is meant to be a candidate who has uploaded documents'
  ).toBeGreaterThan(0);
  reportAll(problems, 'a document row is missing part of its record:');
});

Then("each document's status label should match the status the payload holds", async function () {
  const groups = await vp(this).readDocumentGroups();
  const p = vp(this).profilePayload();
  const stored = documentsIn(p);
  const rows = Object.values(groups).flatMap((g) => g.rows || []);
  await record(this, 'status labels', {
    rows: rows.map((r) => ({ file: r.fileName, status: r.status })),
    stored: stored.map((d) => ({ file: d.file_name, status: d.status })),
    mapping: P.DOCUMENT_STATUS_LABEL,
  });

  const problems = [];
  stored.forEach((d) => {
    const row = rows.find((r) => P.norm(r.fileName) === P.norm(d.file_name));
    if (!row) return;
    const expected = P.DOCUMENT_STATUS_LABEL[d.status];
    if (!expected) {
      problems.push(
        `"${d.file_name}": the payload status "${d.status}" has no known agent-facing label`
      );
      return;
    }
    if (P.norm(row.status) !== expected) {
      problems.push(
        `"${d.file_name}": labelled "${row.status}", payload status ${d.status} so it should read "${expected}"`
      );
    }
  });
  reportAll(problems, "a document's status label does not match the status behind it:");
});

Then('each document row should offer a View and a Download action', async function () {
  const groups = await vp(this).readDocumentGroups();
  const rows = Object.values(groups).flatMap((g) => g.rows || []);
  await record(
    this,
    'row actions',
    rows.map((r) => ({ file: r.fileName, actions: r.actions.length, detail: r.actions }))
  );

  expect(
    rows.length,
    'no document rows were listed, so there were no row actions to inspect'
  ).toBeGreaterThan(0);

  const problems = [];
  rows.forEach((r) => {
    // EXACTLY two, not "at least two": an extra control on a row that can approve or reject
    // somebody's qualification is a finding, not a bonus.
    if (r.actions.length !== P.DOCUMENT_ROW_ACTIONS.length) {
      problems.push(
        `"${r.fileName}": ${r.actions.length} row actions, expected ${P.DOCUMENT_ROW_ACTIONS.length}`
          + ` (${P.DOCUMENT_ROW_ACTIONS.join(' then ')})`
      );
    }
  });
  reportAll(problems, 'a document row does not offer the two row actions:');
});

Then('every document category should show its own empty state', async function () {
  const groups = await vp(this).readDocumentGroups();
  await record(this, 'empty states', groups);

  const problems = [];
  Object.entries(P.DOCUMENT_EMPTY_STATE).forEach(([group, wording]) => {
    const g = groups[group];
    if (!g) {
      problems.push(`the "${group}" category is not rendered at all`);
      return;
    }
    if ((g.rows || []).length) {
      problems.push(
        `"${group}" lists ${g.rows.length} document(s), so this candidate is not the empty-state`
          + ' fixture - re-resolve it'
      );
      return;
    }
    // Compared EXACTLY. An `includes` check would go on passing if the line were replaced by a
    // longer one that said something else entirely.
    if (P.norm(g.emptyState) !== P.norm(wording)) {
      problems.push(`"${group}" reads "${g.emptyState}", expected "${wording}"`);
    }
  });
  reportAll(problems, 'the Document Verification empty states are not what the app renders:');
});

Then('no document should be listed', async function () {
  const groups = await vp(this).readDocumentGroups();
  const rows = Object.values(groups).flatMap((g) => g.rows || []);
  expect(
    rows.map((r) => r.fileName),
    'the tab listed document rows for a candidate whose payload holds no document'
  ).toEqual([]);
});

// ---------------------------------------------------------------------------- the viewer

When('I view the first document listed', TABLE, async function () {
  const groups = await vp(this).readDocumentGroups();
  const first = Object.values(groups).flatMap((g) => g.rows || [])[0];
  expect(first, 'there is no document on this tab to view').toBeTruthy();
  this.vpDocument = first;
  this.vpViewer = await vp(this).openDocumentViewer(first.fileName);
  await record(this, `viewer for "${first.fileName}"`, {
    ...this.vpViewer,
    fullText: undefined,
  });
});

Then("the document viewer should show that document's own record", async function () {
  const v = this.vpViewer;
  const row = this.vpDocument;
  const stored = documentsIn(vp(this).profilePayload()).find(
    (d) => P.norm(d.file_name) === P.norm(row.fileName)
  );

  const problems = [];
  if (P.norm(v.documentName) !== P.norm(row.fileName)) {
    problems.push(`it names "${v.documentName}", the row named "${row.fileName}"`);
  }
  if (P.norm(v.status) !== P.norm(row.status)) {
    problems.push(`its status reads "${v.status}", the row's pill reads "${row.status}"`);
  }
  if (stored && P.DOCUMENT_STATUS_LABEL[stored.status]
    && P.norm(v.status) !== P.norm(P.DOCUMENT_STATUS_LABEL[stored.status])) {
    problems.push(
      `its status reads "${v.status}" while the payload holds ${stored.status}`
        + ` (which renders as "${P.DOCUMENT_STATUS_LABEL[stored.status]}")`
    );
  }
  if (!v.documentType) problems.push('it shows no Document Type');
  if (!v.dateUploaded) problems.push('it shows no Date Uploaded');

  // The VERSION is what a resubmission moves, so a viewer that omits it leaves the agent unable
  // to tell a re-uploaded document from the one they rejected. Asserted as a well-formed version
  // rather than a pinned value: v1.0 is only true of a document nobody has revised.
  if (!v.version) problems.push('it shows no Version at all');
  else if (!/^v\d+\.\d+$/i.test(v.version)) {
    problems.push(`its Version reads "${v.version}", which is not the vN.N form the app uses`);
  }
  reportAll(problems, 'the document viewer does not describe the document it was opened for:');
});

// >>> THIS IS WHERE A RESUBMISSION BECOMES VISIBLE TO THE AGENT. <<<
//
// The rule, measured 2026-09-17 on three documents of one candidate: the payload carries
// `document.version` as an INTEGER and the viewer renders it as `v<n>.0`.
//
//     version 1  ->  "v1.0"        (a first upload)
//     version 3  ->  "v3.0"        (a document re-uploaded twice after revision requests)
//
// So when an agent requests a revision and the candidate uploads a replacement, the number the
// agent is shown goes up. That INCREMENT is a server behaviour driven from the candidate portal
// and it belongs to the document-verification lifecycle module, which already owns upload -> AI
// -> agent decision and pays the irreversible cost of committing one. What this screen owes the
// agent is that it reports the version the server actually holds - and a viewer that hardcoded
// "v1.0" would look perfectly healthy without this step, because two of the three documents
// measured really are version 1.
Then('the version shown should be the version the server holds', async function () {
  const v = this.vpViewer;
  const stored = documentsIn(vp(this).profilePayload()).find(
    (d) => P.norm(d.file_name) === P.norm(this.vpDocument.fileName)
  );
  expect(stored, `"${this.vpDocument.fileName}" is not in the profile payload`).toBeTruthy();
  await record(this, 'version', {
    file: stored.file_name,
    storedVersion: stored.version,
    rendered: v.version,
    expected: `v${stored.version}.0`,
  });
  expect(
    P.norm(v.version),
    `the viewer shows "${v.version}" for a document the server records at version`
      + ` ${stored.version}. A document that has been revised and re-uploaded must show the`
      + ' higher number, or the agent cannot tell a replacement from the copy they rejected.'
  ).toBe(P.norm(`v${stored.version}.0`));
});

Then('the document viewer should offer its preview, Download and zoom controls', async function () {
  const v = this.vpViewer;
  const problems = [];
  // The preview is an <img> for an image and a react-pdf canvas for a PDF, so neither alone is
  // the evidence - what matters is that SOMETHING was rendered rather than an empty frame.
  if (!v.preview.images && !v.preview.canvases && !v.preview.reactPdf) {
    problems.push('it rendered no preview at all - no image, no canvas and no react-pdf page');
  }
  if (!v.hasDownload) problems.push('it offers no Download control');
  if (!v.hasZoomIn) problems.push('it offers no "Zoom in" control');
  if (!v.hasZoomOut) problems.push('it offers no "Zoom out" control');
  if (v.zoom === null || v.zoom === undefined) problems.push('it shows no zoom level');
  reportAll(
    problems,
    `the document viewer is missing part of its contract (it offered: ${v.buttons.join(', ')}):`
  );
});

// One collecting step rather than a chain of When/Then pairs. Cucumber abandons a scenario at
// its first failing step, so "zoom in" failing would hide whether zoom out works at all - and
// the floor behaviour below is the half most likely to regress.
Then('zooming in and out should change how large the document is drawn', TABLE, async function () {
  const page = vp(this);
  const trace = [];
  const problems = [];

  const zoomedIn = await page.zoomDocument('in');
  trace.push(zoomedIn);
  if (zoomedIn.after <= zoomedIn.before) {
    problems.push(`"Zoom in" left the level at ${zoomedIn.after}% (it was ${zoomedIn.before}%)`);
  }

  const zoomedOut = await page.zoomDocument('out');
  trace.push(zoomedOut);
  if (zoomedOut.after >= zoomedOut.before) {
    problems.push(`"Zoom out" left the level at ${zoomedOut.after}% (it was ${zoomedOut.before}%)`);
  }

  // Down to the floor. Measured 2026-09-17: it stops at 50% and DISABLES the control, which is
  // the right behaviour and is asserted so that a build which instead kept shrinking, or threw,
  // is caught. A disabled control is reported as a fact rather than clicked into a timeout.
  let guard = 0;
  let floor = zoomedOut;
  /* eslint-disable no-await-in-loop */
  while (guard < 8 && !floor.wasDisabled) {
    floor = await page.zoomDocument('out');
    trace.push(floor);
    guard += 1;
    if (!floor.wasDisabled && floor.after === floor.before) break;
  }
  /* eslint-enable no-await-in-loop */
  if (!floor.wasDisabled) {
    problems.push(
      `"Zoom out" never reached a floor - it was still enabled at ${floor.after}% after ${guard}`
        + ' further clicks'
    );
  }

  const stillThere = await vp(this).readDocumentViewer();
  if (!stillThere.preview.images && !stillThere.preview.canvases && !stillThere.preview.reactPdf) {
    problems.push('the preview disappeared while zooming');
  }

  await record(this, 'zoom', trace);
  reportAll(problems, 'the document viewer does not zoom:');
});

When('I download that document from the viewer', TABLE, async function () {
  this.vpDownload = await vp(this).downloadDocumentFromViewer();
  await record(this, 'download (from the viewer)', this.vpDownload);
});

When('I download the first document from its row', TABLE, async function () {
  const groups = await vp(this).readDocumentGroups();
  const first = Object.values(groups).flatMap((g) => g.rows || [])[0];
  expect(first, 'there is no document on this tab to download').toBeTruthy();
  this.vpDocument = first;
  this.vpDownload = await vp(this).downloadDocumentFromRow(first.fileName);
  await record(this, `download (from the row for "${first.fileName}")`, this.vpDownload);
});

Then('the downloaded file should be that document', async function () {
  // Asserted on the file the browser was handed, not on "a download happened": a Download that
  // delivers the wrong candidate's document is a disclosure problem, and a download event alone
  // passes on any file at all - including an HTML error page served under the right name.
  expect(
    P.norm(this.vpDownload.suggestedFilename),
    `the download delivered "${this.vpDownload.suggestedFilename}" for the row named`
      + ` "${this.vpDocument.fileName}"`
  ).toBe(P.norm(this.vpDocument.fileName));
});

Then('the viewer should still be open', async function () {
  expect(
    this.vpDownload.viewerStillOpen,
    'downloading closed the viewer, so the agent is thrown out of the document they were reading'
  ).toBe(true);
});

When('I close the document viewer with {string}', TABLE, async function (via) {
  this.vpViewerClosed = await vp(this).closeDocumentViewer(via);
});

Then('the document viewer should be closed', async function () {
  expect(this.vpViewerClosed, 'the document viewer was still on screen').toBe(true);
  // The viewer is a dialog, not a route - so nothing about the URL may have changed either.
  expect(vp(this).page.url(), 'closing the viewer changed the URL').toMatch(
    /selectedTab=document-verification/
  );
});

// ---------------------------------------------------------------------------- the decisions
//
// READ-ONLY. It opens every document's viewer and reads which controls are offered. It clicks
// neither of them, and no page-object method exists that would.
Then(
  'the review decisions should be offered on a document that needs review and on no other',
  { timeout: 300000 },
  async function () {
    const page = vp(this);
    const groups = await page.readDocumentGroups();
    const rows = Object.values(groups).flatMap((g) => g.rows || []);
    const needsReview = P.DOCUMENT_STATUS_LABEL.AWAITING;

    const seen = [];
    const problems = [];
    for (const row of rows) {
      /* eslint-disable no-await-in-loop */
      const v = await page.openDocumentViewer(row.fileName);
      const shouldDecide = P.norm(row.status) === P.norm(needsReview);
      seen.push({
        file: row.fileName,
        status: row.status,
        approve: v.hasApprove,
        requestRevision: v.hasRequestRevision,
        buttons: v.buttons,
      });
      if (shouldDecide && !(v.hasApprove && v.hasRequestRevision)) {
        problems.push(
          `"${row.fileName}" is "${row.status}" but offers`
            + ` Approve=${v.hasApprove} / Request Revision=${v.hasRequestRevision}, so the agent`
            + ' cannot act on a document that is waiting for them'
        );
      }
      if (!shouldDecide && (v.hasApprove || v.hasRequestRevision)) {
        problems.push(
          `"${row.fileName}" is "${row.status}" and still offers`
            + ` Approve=${v.hasApprove} / Request Revision=${v.hasRequestRevision} - a document`
            + ' that has already been decided can be decided again'
        );
      }
      await page.closeDocumentViewer();
      /* eslint-enable no-await-in-loop */
    }
    await record(this, 'decision controls per document', seen);

    // >>> BOTH HALVES OF THE PREMISE ARE ASSERTED FIRST. <<< Without this the step goes GREEN on
    // a candidate holding no document that needs review, having proved nothing - which is the
    // failure mode that let the Basic Information scenario pass for a fortnight on a fixture
    // that had drifted. A missing premise is a fixture problem and must say so, not look like a
    // working feature.
    expect(
      seen.filter((s) => P.norm(s.status) === P.norm(needsReview)).length,
      `none of this candidate's ${seen.length} document(s) is "${needsReview}", so the positive`
        + ' half of this rule was not under test - re-resolve the fixture'
    ).toBeGreaterThan(0);
    expect(
      seen.filter((s) => P.norm(s.status) !== P.norm(needsReview)).length,
      `every one of this candidate's ${seen.length} document(s) is "${needsReview}", so the`
        + ' "and on no other" half was not under test - re-resolve the fixture'
    ).toBeGreaterThan(0);

    reportAll(problems, 'the review decisions are not gated on the document needing review:');
  }
);

// ==================== 6. Subscription ====================

Then('the Subscription tab should show exactly these fields:', async function (dataTable) {
  const expected = dataTable.hashes().map((r) => r.field);
  const sub = await vp(this).readSubscription();
  await record(this, 'Subscription tab', sub);
  expect(
    sub.isEmptyState,
    'the Subscription tab is showing its empty state - the resolved candidate holds no'
      + ' subscription, so this scenario has no subject'
  ).toBe(false);
  const missing = expected.filter((f) => !sub.fields[f]);
  expect(
    missing,
    `these Subscription fields are missing or empty: ${missing.join(', ')}`
  ).toHaveLength(0);
});

Then('the subscription values should match the subscription the server holds', async function () {
  const sub = await vp(this).readSubscription();
  const payload = vp(this).subscriptionPayload();
  await record(this, 'Subscription vs payload', { rendered: sub.fields, payload });
  expect(payload, 'no subscription payload was captured, so nothing can be compared').toBeTruthy();

  const problems = [];

  // Status: the API says ACTIVE, the tab says "Subscribed" - a third naming for one state. The
  // mapping is asserted rather than the raw value, so a build that started leaking "ACTIVE"
  // would be caught.
  if (payload.status === 'ACTIVE' && !/subscribed/i.test(sub.fields.Status || '')) {
    problems.push(`Status shows "${sub.fields.Status}" for an ACTIVE subscription`);
  }

  if (payload.plan_name && P.norm(sub.fields['Current Subscription']) !== P.norm(payload.plan_name)) {
    problems.push(
      `Current Subscription shows "${sub.fields['Current Subscription']}", `
        + `plan_name is "${payload.plan_name}"`
    );
  }

  // Dates: compared by their components, because the grid's format has been seen more than one
  // way across this product and a literal comparison would be red on a formatting choice.
  const dateMatches = (rendered, iso) => {
    const my = P.isoMonthYear(iso);
    if (!my) return true;
    const day = String(Number(iso.slice(8, 10)));
    const r = P.norm(rendered);
    return r.includes(my.year) && r.includes(day) && r.slice(0, 3) === my.month.slice(0, 3);
  };
  if (!dateMatches(sub.fields['Subscription Started'], payload.subscription_start_date)) {
    problems.push(
      `Subscription Started shows "${sub.fields['Subscription Started']}", `
        + `subscription_start_date is ${payload.subscription_start_date}`
    );
  }
  if (!dateMatches(sub.fields['Next Billing Date'], payload.renewal_date)) {
    problems.push(
      `Next Billing Date shows "${sub.fields['Next Billing Date']}", `
        + `renewal_date is ${payload.renewal_date}`
    );
  }

  reportAll(problems, 'the Subscription tab disagreed with the subscription the server holds:');
});

Then('the Total Fee should state the amount that was charged, with its currency', async function () {
  const sub = await vp(this).readSubscription();
  const payload = vp(this).subscriptionPayload();
  const charged = payload.payment && payload.payment.amount;
  const currency = payload.currency || 'SAR';
  await record(this, 'Total Fee', {
    rendered: sub.fields['Total Fee'],
    chargedAmount: charged,
    planPrice: payload.plan_price,
    currency,
  });
  expect(charged, 'the subscription payload records no payment amount').toBeTruthy();

  const shown = P.norm(sub.fields['Total Fee']);
  const digits = (shown.match(/[\d.,]+/g) || []).map((n) => Number(n.replace(/,/g, '')));

  // The amount CHARGED, not the plan's list price. Both are numbers on the same payload, so a
  // check for "a number appears" would pass on either.
  expect(
    digits.some((n) => Math.abs(n - Number(charged)) < 0.01),
    `Total Fee shows "${shown}" but the amount charged was ${charged} ${currency}`
      + ` (the plan's list price is ${payload.plan_price} - if the figure shown is that, the tab`
      + ' is reporting list price where it says fee)'
  ).toBe(true);
  expect(shown, `Total Fee shows "${shown}" with no currency`).toContain(currency);
});

Then("the Subscription tab should report that candidate's subscription state", async function () {
  const sub = await vp(this).readSubscription();
  const payload = vp(this).subscriptionPayload();
  await record(this, 'subscription state', { rendered: sub, payload: payload && payload.status });
  // Tolerant on purpose: this is the end-to-end walk, and whether the candidate holds a
  // subscription is not this scenario's premise. What it asserts is that the tab reports
  // SOMETHING coherent rather than rendering blank.
  const said = sub.isEmptyState || Object.values(sub.fields).some(Boolean);
  expect(said, 'the Subscription tab rendered neither a subscription nor an empty state').toBe(true);
});

// ==================== 7. Activity Log ====================

When('I set the activity duration to {string}', TABLE, async function (label) {
  this.vpDuration = await vp(this).selectDuration(label);
  await record(this, `set the activity duration to "${label}"`, {
    ...this.vpDuration,
    payload: undefined,
    count: this.vpDuration.payload && this.vpDuration.payload.count,
  });
});

Then('every activity entry should show a headline, a description and a date', async function () {
  const entries = await vp(this).readActivityEntries();
  const payload = vp(this).activityPayload();
  await record(this, 'activity entries', { rendered: entries, serverCount: payload && payload.count });
  expect(entries.length, 'no activity entries were rendered').toBeGreaterThan(0);

  const problems = [];
  entries.forEach((e, i) => {
    if (!e.headline) problems.push(`entry ${i + 1}: no headline`);
    if (!e.description) problems.push(`entry ${i + 1}: no description`);
    if (!e.date) problems.push(`entry ${i + 1}: no date`);
  });
  // Every entry the server returned on this page must be rendered - compared against
  // results.length, never `count`, because the endpoint pages at 10 and a higher count is
  // correct.
  if (payload && Array.isArray(payload.results)) {
    const shown = entries.length;
    if (shown < payload.results.length) {
      problems.push(
        `the server returned ${payload.results.length} entries on this page but ${shown} are rendered`
      );
    }
  }
  reportAll(problems, 'an activity entry is incomplete:');
});

Then('the activity entries should be ordered newest first', async function () {
  const payload = vp(this).activityPayload();
  expect(payload && payload.results, 'no activity payload was captured').toBeTruthy();
  const times = payload.results.map((r) => new Date(r.created_at).getTime());
  await record(this, 'ordering', {
    createdAt: payload.results.map((r) => r.created_at),
  });
  const descending = times.every((t, i) => i === 0 || times[i - 1] >= t);
  expect(descending, `activity is not ordered newest first: ${payload.results.map((r) => r.created_at).join(' | ')}`)
    .toBe(true);
});

// A log that always showed the first candidate's activity would satisfy every other assertion
// here. The actor is what rules that out.
Then(
  'every activity entry should belong to the candidate whose profile is open',
  TABLE,
  async function () {
    const page = vp(this);
    const payload = page.activityPayload();
    const candidateId = page.candidateIdFromUrl();
    expect(payload && payload.results, 'no activity payload was captured').toBeTruthy();
    const foreign = payload.results.filter((r) => r.actor && r.actor !== candidateId);
    const wrongAudience = payload.results.filter((r) => r.audience && r.audience !== 'CANDIDATE');
    await record(this, 'activity ownership', {
      candidateId,
      entries: payload.results.length,
      actors: [...new Set(payload.results.map((r) => r.actor))],
      audiences: [...new Set(payload.results.map((r) => r.audience))],
    });
    expect(
      foreign,
      `${foreign.length} activity entries belong to another candidate (actors: `
        + `${[...new Set(foreign.map((r) => r.actor))].join(', ')}) while candidate ${candidateId}'s`
        + ' profile is open'
    ).toHaveLength(0);
    expect(
      wrongAudience,
      `${wrongAudience.length} entries are not candidate-audience events: `
        + `${[...new Set(wrongAudience.map((r) => r.audience))].join(', ')}`
    ).toHaveLength(0);
  }
);

Then('the activity duration filter should default to {string}', async function (label) {
  const selected = await vp(this).selectedDuration();
  await record(this, 'default duration', { selected });
  expect(P.norm(selected)).toBe(label);
});

Then('the activity duration filter should offer exactly these ranges in order:', TABLE, async function (
  dataTable
) {
  const expected = dataTable.hashes().map((r) => r.range);
  const options = await vp(this).readDurationOptions();
  await record(this, 'duration options', options);
  expect(
    options.offered,
    `the duration filter offers [${options.offered.join(', ')}], expected [${expected.join(', ')}]`
  ).toEqual(expected);
});

Then('choosing each duration should send its own value to the server:', TABLE, async function (dataTable) {
  const page = vp(this);
  const problems = [];
  const trace = [];
  for (const row of dataTable.hashes()) {
    /* eslint-disable no-await-in-loop */
    const result = await page.selectDuration(row.range);
    trace.push({
      range: row.range,
      sentDuration: result.sentDuration,
      requestedUrl: result.requestedUrl && result.requestedUrl.replace(/^.*\/core\/api\/v1\//, ''),
      url: result.url,
    });
    if (!result.requestedUrl) {
      problems.push(`${row.range}: no activity-log request was sent at all`);
    } else if (result.sentDuration !== row.parameter) {
      problems.push(
        `${row.range}: the app sent duration=${result.sentDuration}, expected ${row.parameter}`
      );
    }
    /* eslint-enable no-await-in-loop */
  }
  await record(this, 'duration -> parameter trace', trace);
  reportAll(problems, 'a duration was not sent to the server as its own value:');
});

When('I note how much activity is listed', async function () {
  const payload = vp(this).activityPayload();
  this.vpActivityBaseline = {
    rendered: (await vp(this).readActivityEntries()).length,
    serverCount: payload ? payload.count : null,
    duration: await vp(this).selectedDuration(),
  };
  await record(this, 'activity baseline', this.vpActivityBaseline);
});

Then('the activity listed should not have grown', async function () {
  const payload = vp(this).activityPayload();
  const now = {
    rendered: (await vp(this).readActivityEntries()).length,
    serverCount: payload ? payload.count : null,
    duration: await vp(this).selectedDuration(),
  };
  await record(this, 'activity after narrowing', { before: this.vpActivityBaseline, after: now });
  // Relational, so it needs no fixed expectation about how much activity the account holds.
  expect(
    now.serverCount,
    `narrowing from "${this.vpActivityBaseline.duration}" to "${now.duration}" returned MORE`
      + ` activity (${now.serverCount} vs ${this.vpActivityBaseline.serverCount})`
  ).toBeLessThanOrEqual(this.vpActivityBaseline.serverCount);
});

// The duration is sent to the server but written nowhere a reload can read it, so an agent who
// reloads silently drops back to "Last 24 hours". Recorded against the rule rather than against
// the measurement, so it goes green whichever way the product settles it.
Then('the duration should be recorded wherever a reload can restore it', SLOW, async function () {
  const chosen = await vp(this).selectedDuration();
  const url = this.page.url();
  const sent = this.vpDuration && this.vpDuration.sentDuration;
  await record(this, 'duration persistence', {
    chosen,
    url,
    sentToServer: sent,
    urlCarriesDuration: /duration=/.test(url),
  });

  const before = chosen;
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await vp(this).settleProfile();
  await vp(this).waitForTabBody('Activity Log');
  const after = await vp(this).selectedDuration().catch(() => null);
  await record(this, 'duration after reload', { before, after });

  expect(
    P.norm(after),
    `the duration filter was set to "${before}" and a reload returned it to "${after}".`
      + ' The chosen range is sent to the server as a `duration` parameter but written nowhere'
      + ' the page can restore it from, so the URL cannot be shared or reloaded and the agent'
      + ' silently drops back to the default.'
  ).toBe(P.norm(before));
});

// ==================== 8. Reminder History ====================

Then('the profile Reminder History control should be offered', async function () {
  await expect(vp(this).reminderHistoryButton).toBeVisible({ timeout: 20000 });
});

Then('the profile Reminder History control should be enabled', async function () {
  const page = vp(this);
  const enabled = await page.reminderHistoryEnabled();
  const payload = page.profilePayload();
  await record(this, 'reminder control', { enabled, has_reminders: payload.has_reminders });
  expect(
    payload.has_reminders,
    'the resolved fixture has no reminders, so nothing is under test'
  ).toBe(true);
  expect(enabled, 'Reminder History is disabled for a candidate who has reminders').toBe(true);
});

Then('the profile Reminder History control should be disabled', async function () {
  const page = vp(this);
  const enabled = await page.reminderHistoryEnabled();
  const payload = page.profilePayload();
  await record(this, 'reminder control', { enabled, has_reminders: payload.has_reminders });
  expect(payload.has_reminders, 'the resolved fixture HAS reminders, so nothing is under test')
    .toBe(false);
  expect(enabled, 'Reminder History is enabled for a candidate who has no reminders').toBe(false);
});

Then('no Reminder History dialog should open on its own', async function () {
  const stayed = await vp(this).reminderHistoryStaysClosed(3000);
  expect(stayed, 'a Reminder History dialog opened without being asked for').toBe(true);
});

Then('each profile should offer a Reminder History control', async function () {
  const problems = [];
  for (const v of this.vpVisits) {
    const rh = v.headerActions.find((a) => /reminder history/i.test(a.text));
    if (!rh) {
      problems.push(
        `${v.listing}: no Reminder History control - header offers `
          + `[${v.headerActions.map((a) => a.text || '(unnamed)').join(', ')}]`
      );
      continue;
    }
    // Enablement tracks has_reminders and is asserted by its own scenarios; here the control
    // only has to be OFFERED.
    const expectedEnabled = !!(v.payload && v.payload.has_reminders);
    if (rh.disabled === expectedEnabled) {
      problems.push(
        `${v.listing}: Reminder History is ${rh.disabled ? 'disabled' : 'enabled'} while`
          + ` has_reminders=${expectedEnabled}`
      );
    }
  }
  reportAll(problems, 'the profile did not offer a usable Reminder History control:');
});

When('I open the profile Reminder History', TABLE, async function () {
  this.vpReminders = await vp(this).openReminderHistory();
  this.vpReminderRender = await vp(this).readReminderHistory();
  await record(this, 'reminder history', {
    fetched: this.vpReminders.fetched,
    serverCount: this.vpReminders.payload && this.vpReminders.payload.count,
    urlBefore: this.vpReminders.urlBefore,
    urlAfter: this.vpReminders.urlAfter,
    rendered: this.vpReminderRender.entries,
    showingAll: this.vpReminderRender.showingAll,
    hasViewMore: this.vpReminderRender.hasViewMore,
  });
});

// A dialog that always showed the first candidate's history is a disclosure problem as much as a
// rendering one, and it is invisible unless the name is compared against the candidate open.
Then('the Reminder History dialog should name that candidate', async function () {
  const page = vp(this);
  const payload = page.profilePayload();
  const expected = `${payload.user.firstname || ''} ${payload.user.lastname || ''}`.trim();
  const render = this.vpReminderRender || (await page.readReminderHistory());
  await record(this, 'dialog subject', { named: render.candidate, expected });
  expect(render.heading, 'the dialog is not titled "Reminder History"').toBeTruthy();
  expect(P.norm(render.candidate)).toBe(P.norm(expected));
});

Then('the Reminder History dialog should list every reminder the server returned', async function () {
  const render = this.vpReminderRender;
  const payload = this.vpReminders.payload;
  expect(payload && payload.results, 'no reminders payload was captured').toBeTruthy();
  await record(this, 'reminders rendered vs fetched', {
    rendered: render.entries.length,
    fetched: payload.results.length,
    serverTotal: payload.count,
    showingAll: render.showingAll,
    hasViewMore: render.hasViewMore,
  });

  // Compared against results.length, NEVER `count`: the endpoint pages at 10, so a higher count
  // is correct and the dialog legitimately shows one page of it.
  expect(
    render.entries.length,
    `the server returned ${payload.results.length} reminders on this page but`
      + ` ${render.entries.length} are rendered`
  ).toBe(payload.results.length);

  // And the dialog must be honest about whether that is everything. It offers "View more" when
  // truncated and says "Showing all reminders sent to this candidate" only when complete.
  const truncated = payload.count > payload.results.length;
  if (truncated) {
    expect(
      render.hasViewMore,
      `${payload.count} reminders exist but only ${payload.results.length} are shown, and the`
        + ' dialog offers no way to see the rest'
    ).toBe(true);
  } else {
    expect(
      render.showingAll,
      'the whole history is shown but the dialog does not say so'
    ).toBe(true);
  }
});

Then('each reminder should show what was sent and when', async function () {
  const render = this.vpReminderRender;
  const problems = [];
  render.entries.forEach((e, i) => {
    if (!e.title) problems.push(`reminder ${i + 1}: no title`);
    // A history of bare titles with no timestamps is not a history, and a presence check on
    // either alone passes on one.
    if (!e.sent) problems.push(`reminder ${i + 1} ("${e.title}"): no sent date`);
  });
  await record(this, 'reminder entries', render.entries);
  expect(render.entries.length, 'the dialog listed no reminders').toBeGreaterThan(0);
  reportAll(problems, 'a reminder entry does not say what was sent and when:');
});

Then('the profile URL should not have changed', async function () {
  await record(this, 'url', { before: this.vpReminders.urlBefore, after: this.vpReminders.urlAfter });
  expect(
    this.vpReminders.urlAfter,
    'opening Reminder History changed the URL, so it is not a dialog'
  ).toBe(this.vpReminders.urlBefore);
});

When('I close the Reminder History dialog with the {string} control', async function (control) {
  await vp(this).closeReminderHistory(control);
});

Then('the Reminder History dialog should be closed', async function () {
  const stayed = await vp(this).reminderHistoryStaysClosed(2000);
  expect(stayed, 'the Reminder History dialog is still open').toBe(true);
});

Then("I should still be on that candidate's profile", async function () {
  const page = vp(this);
  await record(this, 'url', { url: this.page.url() });
  expect(this.page.url()).toMatch(/\/view-profile/);
  expect(page.candidateIdFromUrl()).toBe(this.vpOpened.candidateId);
});

// ==================== 9. listing differences ====================

Then('the In Progress rows should offer no View control', async function () {
  const page = vp(this);
  await page.settleListing();
  const hasView = await page.listingHasViewControl();
  this.vpInProgressActions = await page.listingRowActions(0);
  await record(this, 'In Progress row actions', this.vpInProgressActions);
  expect(
    hasView,
    'the In Progress listing now offers a View control. The profile is reachable from it, so it'
      + ' should be added to the listing tables in this feature file and to'
      + " CandidateViewProfilePage's `listings` map."
  ).toBe(false);
});

Then('the In Progress row actions should be reported', async function () {
  const actions = this.vpInProgressActions || [];
  expect(actions.length, 'the In Progress rows offer no row actions at all').toBeGreaterThan(0);
  await record(
    this,
    'what In Progress offers instead of View',
    actions.map((a) => `${a.name}${a.disabled ? ' (disabled)' : ''}`)
  );
});

// ==================== 10. accessibility - REMOVED 2026-09-17 ====================
//
// Four scenarios and five step definitions were removed on request: the profile Back control's
// keyboard reachability, the header icon control's missing accessible name, that same control
// being inert, and the Document Verification row actions being mouse-only. Each asserted a
// measured WCAG failure and none was flaky - what they found is written down at section 10 of
// the feature file.
//
// The page object deliberately KEEPS auditKeyboard(), auditClickableIcons(),
// readHeaderActions() and probeHeaderIconButton(): `node scripts/probe-candidate-view-profile.js`
// still reports all of it, so the evidence is one read-only command away if these are wanted
// back, and nothing had to be rewritten to delete the scenarios.

// ==================== 11. end to end ====================

Given('I am signed in as the candidate whose profile the agent will view', SLOW, async function () {
  if (!E2E_CANDIDATE_EMAIL || !E2E_CANDIDATE_PASSWORD) {
    throw new Error(
      'Missing VIEWPROFILE_E2E_CANDIDATE_EMAIL / VIEWPROFILE_E2E_CANDIDATE_PASSWORD in .env.'
        + ' This scenario edits a candidate profile on the candidate portal and then reads it'
        + " back on the agent portal, so it needs a candidate OF this agent whose password the"
        + ' suite knows.'
    );
  }
  await signIn(
    this,
    E2E_CANDIDATE_EMAIL,
    E2E_CANDIDATE_PASSWORD,
    /\/dashboard|\/profile|\/getting-started|\/onboarding/
  );
  this.vpE2eCandidate = E2E_CANDIDATE_EMAIL;
});

When('I change my About Me on my own profile', SLOW, async function () {
  const details = this.pages.candidateDetails;
  await details.open();

  const before = await details.profile();
  this.vpAboutMeOriginal = before.about_me;
  this.vpAboutMeNew = `Automation check ${Date.now()}`;
  // Arm the restore BEFORE the write, so a scenario that dies mid-save still puts it back.
  this.vpRestoreAboutMe = true;

  await details.openEditModal('Basic Information');
  await details.waitForModal();
  // typeInto() rather than fill(): this form validates on blur and a programmatic value set
  // does not run the validator, so a fill() can leave Save gated for reasons nothing reports.
  await details.typeInto(details.basicField('aboutMe'), this.vpAboutMeNew);
  await details.blur();
  await details.waitForSaveEnabled();
  await details.save();

  const after = await details.profile();
  await record(this, 'About Me changed on the candidate portal', {
    candidate: this.vpE2eCandidate,
    before: this.vpAboutMeOriginal,
    requested: this.vpAboutMeNew,
    storedAfterSave: after.about_me,
  });
  // The save is verified against the SERVER, not against a second DOM read - the sections
  // re-render from a fresh GET, so a DOM read cannot tell "the server stored it" from "React
  // still holds what I typed".
  expect(P.norm(after.about_me), 'the candidate portal did not store the new About Me').toBe(
    P.norm(this.vpAboutMeNew)
  );
});

When("I sign in as their agent and open that candidate's profile", SLOW, async function () {
  // A fresh context would be cleaner but the app holds one session per context, so signing out
  // and back in on this page is what keeps the scenario to a single browser context.
  await this.page.context().clearCookies();
  await signIn(this, AGENT_EMAIL, AGENT_PASSWORD, /\/dashboard|\/candidates|\/getting-started/);

  this.vpOpened = await vp(this).openProfile({
    listing: 'active',
    email: this.vpE2eCandidate,
  });
  this.vpPayload = vp(this).profilePayload();
  await record(this, "opened the candidate's profile as the agent", this.vpOpened);
});

// >>> THE AGENT VIEW HAS TWO PLACES THIS TEXT CAN LAND, AND PINNING ONE WOULD BE A GUESS. <<<
//
// This step used to demand Basic Information. Measured 2026-09-17 on two candidates, that is at
// best half the story:
//
//   candidate 10849   about_me "nil"       headline "nil"    -> renders UNDER THE NAME *and* in
//                                                               Basic Information
//   candidate 10880   about_me "I am SDET" headline null     -> renders in Basic Information only
//
// So the line under the candidate's name is `headline`, the Basic Information row is
// `about_me`, and one candidate carries the same text in both. Which of the two the CANDIDATE
// PORTAL writes when they fill in About Me is the one thing nobody has measured - this scenario
// has never run, because it needs a candidate of this agent whose password the suite knows.
//
// It therefore asserts the rule that is actually worth having - THE TEXT REACHES THE AGENT - and
// reports WHICH surface carried it, plus both payload fields. Pinning Basic Information would go
// red on a correct build if the candidate portal writes the headline; pinning the header would
// go red on the reverse. The first real run settles it, and the attachment says which to tighten
// this to.
Then("the agent's profile should show the About Me I just saved", async function () {
  const page = vp(this);
  const saved = this.vpAboutMeNew;
  const header = await page.readHeader();
  const fields = await page.readLabelledFields('Basic Information');
  const section = await page.readSection('Basic Information');
  const payload = page.profilePayload() || {};

  const inHeader = P.norm(header.headline) === P.norm(saved);
  const inBasicInfo = P.norm(fields && fields['About Me']) === P.norm(saved);

  await record(this, 'About Me as the agent sees it', {
    saved,
    surfaceThatCarriedIt: inHeader && inBasicInfo
      ? 'BOTH the header line under the name and Basic Information'
      : (inHeader && 'the header line under the name')
        || (inBasicInfo && 'the Basic Information "About Me" row')
        || 'NEITHER',
    headerLineUnderTheName: header.headline,
    basicInformationAboutMe: fields && fields['About Me'],
    payload: { about_me: payload.about_me, headline: payload.headline },
    sectionLines: section.lines,
  });

  expect(
    inHeader || inBasicInfo,
    `the About Me saved on the candidate portal has not reached the agent's profile.`
      + ` Saved: "${saved}". The header line under the name reads "${header.headline}" and the`
      + ` Basic Information "About Me" row reads "${fields && fields['About Me']}".`
      + ` The payload holds about_me="${payload.about_me}" headline="${payload.headline}" - so`
      + ' if both are null the candidate-portal save did not persist, and if one holds the text'
      + ' but neither surface shows it, the agent view is dropping a value it was given.'
  ).toBe(true);
});

// ==================== hooks ====================

// Pin every scenario in this feature to the agent under test, so nothing here can drive another
// account by accident.
Before({ tags: '@candidateViewProfile' }, async function () {
  this.vpFeature = true;
});

// Restore the About Me the end-to-end scenario changed.
//
// The hook re-reads the value from the SERVER afterwards rather than trusting the save's return
// value, and it NEVER THROWS - a failed restore is attached loudly instead, because masking the
// scenario's own failure with a cleanup error sends whoever reads the report after the wrong
// problem. The attach is AWAITED: an un-awaited attach from an After hook is dropped when the
// world is torn down, which is how one module's "could not restore" warning never reached a
// single report.
After({ tags: '@mutates-profile and @candidateViewProfile' }, async function () {
  if (!this.vpRestoreAboutMe) return;
  const original = this.vpAboutMeOriginal;
  try {
    // Sign back in as the candidate to undo their own profile change.
    await this.page.context().clearCookies();
    await signIn(
      this,
      E2E_CANDIDATE_EMAIL,
      E2E_CANDIDATE_PASSWORD,
      /\/dashboard|\/profile|\/getting-started|\/onboarding/
    );

    const details = this.pages.candidateDetails;
    await details.open();
    await details.openEditModal('Basic Information');
    await details.waitForModal();
    await details.typeInto(details.basicField('aboutMe'), original || '');
    await details.blur();
    await details.save();

    const after = await details.profile();
    const restored = P.norm(after.about_me) === P.norm(original || '');
    await this.attach(
      `RESTORE About Me for ${E2E_CANDIDATE_EMAIL}\n`
        + `${restored ? 'restored' : '>>> NOT RESTORED <<<'}\n`
        + `wanted: ${JSON.stringify(original)}\nserver now holds: ${JSON.stringify(after.about_me)}`,
      'text/plain'
    );
  } catch (e) {
    await this.attach(
      `>>> COULD NOT RESTORE About Me for ${E2E_CANDIDATE_EMAIL} <<<\n`
        + `it should be ${JSON.stringify(original)}.\n`
        + `Set it back by hand on the candidate portal.\n${e.message}`,
      'text/plain'
    );
  }
});
