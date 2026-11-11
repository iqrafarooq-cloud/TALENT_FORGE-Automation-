// Step definitions for features/Agent_Portal/activity-log.feature -
// Agent Portal > Activity Log (/activity-log): its SEARCH box and its DATE-RANGE filter, the two
// together, the empty state, and the infinite scroll a new query resets.
//
// >>> EVERY PHRASE HERE IS DELIBERATELY WORDED "... Activity Log ..." OR "... date-range ...".
// Cucumber loads every step file into ONE global registry, so a phrase defined twice is an
// AMBIGUOUS step - which counts as neither a pass nor a failure and is easy to miss in the
// summary (playwright-bdd fails generation on it instead). Two neighbours make this a real
// hazard rather than a theoretical one:
//   * steps/audit-logs.js owns the SuperAdmin audit trail, which is also a searchable,
//     filterable log - "the search box should be displayed", "no entry should be listed" and
//     friends would collide immediately, and every one of its steps is bound to
//     this.pages.auditLogs, so it would drive the wrong page even if the wording were free.
//   * steps/candidate-view-profile.js owns an "Activity Log" TAB on a candidate's profile, with
//     the same six duration options and the same .activity-log-item markup. Its steps are bound
//     to this.pages.candidateViewProfile and would assert against a different account entirely.
//
// Exactly ONE phrase is reused, and only because it is genuinely page-agnostic - it touches no
// page object at all:
//     Given I am logged in as an agent      (steps/active-candidate.js, via resilientSignIn)
//
// >>> NOTHING IN THIS FILE WRITES. <<< The toolbar holds two controls, neither of which mutates
// anything, and the list has no row action at all. So no scenario here can change an account,
// spend a fixture, send an email or make a payment - which is what makes the whole feature safe
// in the default run. There is no cleanup hook because there is nothing to clean up.
//
// >>> EVERY TABLE-DRIVEN STEP CARRIES AN EXPLICIT { timeout }. <<<
// features/support/hooks.js calls setDefaultTimeout(60000) and THAT OVERRIDES the profile's own
// `timeout` - this profile asks for 300000 and gets 60000. A step that applies six date ranges,
// each costing a debounce plus a round trip, is many times a normal step's work, so without a
// budget of its own it is killed part way and reports "function timed out" - which says nothing
// about the app and hides however many rows had already passed. This trap has now bitten five
// areas in this repo; do not add a table step here without one.

const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const ActivityLogPage = require('../pages/ActivityLogPage');

// Per-step budgets, sized to the work inside each one rather than guessed. A search costs a
// ~1.2s debounce plus a round trip; a date range costs a popover plus a round trip.
const TABLE = 300000; // six ranges, or five searches, in one step
const SLOW = 180000; // a handful of queries, or a scroll walk
const STEP = 90000; // one query

const al = (world) => world.pages.activityLog;

// Attach evidence to the report. Every assertion that measured something attaches what it saw:
// on a red row it is the evidence, on a green one it is the record of what the app did that day,
// which is what makes a later change diagnosable rather than mysterious.
async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// The timestamp format this surface renders, measured: "Sep 21, 2026 - 12:34 PM".
// >>> IT RENDERS THE TIME. <<< The candidate view-profile's Activity Log tab discards it and
// shows the date alone (recorded there as a finding), so a pattern carried over from that module
// would fail against a correct render here.
const TIMESTAMP_RE = /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)$/i;

// Expanded by the safe-handling table. Spelt out as a sentinel rather than 300 literal
// characters so the feature file stays readable and the intent is obvious.
function expandTerm(raw) {
  if (raw === '<<300 chars>>') return 'a'.repeat(300);
  return raw;
}

// The words in a headline that are safe to search by.
//
// >>> THE SEARCH ALSO MATCHES THE ACTOR'S NAME AND EMAIL, WHICH NO ENTRY DISPLAYS. <<< Every row
// in an agent's own log shares one actor, so a term that happens to be a substring of it matches
// nearly everything - and then "every listed entry contains the term" would fail against a
// search that is working exactly as built. Words overlapping the signed-in agent's identity are
// therefore excluded when a term is DERIVED from the data, and the one scenario that is about
// the actor searches for it deliberately.
function safeWordsFrom(headline, identity) {
  const ident = String(identity || '').toLowerCase();
  return String(headline || '')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length >= 4)
    .filter((w) => !ident.includes(w.toLowerCase()));
}


// >>> NO SEARCH TERM IN THIS FILE IS A LITERAL ANY MORE. <<< This is a live, growing log on a
// shared account and the narrow ranges roll forward with the clock, so a hardcoded word ("Invite"
// until 2026-10-14) holds only while the account happens to have that kind of event in range.
// The feature writes the sentinel below and every {string} step resolves it to a term derived
// from the account's OWN recent activity by the Given that chooses one.
const DERIVED_TERM = '<<recent activity term>>';
function resolveTerm(world, raw) {
  const s = String(raw == null ? '' : raw);
  if (!s.includes(DERIVED_TERM)) return s;
  if (!world.alDerivedTerm) {
    throw new Error(
      `the feature uses ${DERIVED_TERM} but no term was derived - add `
      + '"Given I have chosen a search term from the agent\'s recent activity" before it'
    );
  }
  return s.split(DERIVED_TERM).join(world.alDerivedTerm);
}

// The local part of the signed-in agent's address, which is also (for this fixture) their given
// name. Used only by the scenario that searches for the actor on purpose.
function agentIdentity() {
  const email = process.env.AGENT_EMAIL || '';
  const local = email.split('@')[0] || '';
  return { email, local, firstName: local.split(/[.+_-]/)[0] || local };
}

// ==================== Background ====================

Given('I am on the Activity Log page', { timeout: SLOW }, async function () {
  await al(this).navigate();
});

// Picks the term from the NARROWEST range that has activity (Last 30 days, then This year), so a
// scenario that later narrows to 30 days still has rows to match. Restores the default page
// afterwards, so the scenario continues from the state the Background left it in.
Given('I have chosen a search term from the agent\'s recent activity', { timeout: SLOW }, async function () {
  const page = al(this);
  const identity = agentIdentity();
  const ident = `${identity.local} ${identity.email}`;
  const tried = [];
  /* eslint-disable no-await-in-loop */
  for (const duration of ['last_30_days', 'this_year']) {
    await page.navigate({ [ActivityLogPage.URL_PARAMS.duration]: duration });
    const entries = await page.readEntries();
    const words = entries.flatMap((e) => safeWordsFrom(e.headline, ident));
    tried.push({ duration, entries: entries.length, words: [...new Set(words)] });
    if (words.length) {
      // The word shared by the most listed entries, so the term matches more than one row.
      const freq = words.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
      this.alDerivedTerm = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      break;
    }
  }
  /* eslint-enable no-await-in-loop */
  await record(this, 'search term derived from recent activity', { tried, chosen: this.alDerivedTerm || null });
  expect(
    this.alDerivedTerm,
    'no usable search term in the last 30 days or this year - AGENT_EMAIL has no activity whose '
    + 'headline holds a 4+ character word outside the agent\'s own name/email'
  ).toBeTruthy();
  await page.navigate();
});

// ==================== SECTION 1 - the page and its two controls ====================

Then('the Activity Log heading should be displayed', async function () {
  await expect(al(this).pageHeading).toBeVisible();
});

Then('the Activity Log search box should be displayed', async function () {
  await expect(al(this).searchInput).toBeVisible();
});

Then('the Activity Log date-range filter should be displayed', async function () {
  await expect(al(this).durationTrigger).toBeVisible();
});

// Asserted as a RULE, not as trivia. Every other listing in the Agent Portal opens a Filters
// modal, so "there is no Filters button here" is what stops somebody porting a filter-modal
// assertion onto this page - and if one is ever added, this goes red and says so.
Then('the Activity Log should offer no separate Filters button', async function () {
  const page = al(this);
  const seen = await this.page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return { mainMissing: true };
    return {
      buttons: [...main.querySelectorAll('button')].map((b) =>
        (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()
      ),
      mentionsFilter: /filter/i.test(main.innerText),
    };
  });
  await record(this, 'Activity Log toolbar controls', seen);

  const filterish = (seen.buttons || []).filter((b) => /filter/i.test(b));
  expect(
    filterish,
    'the Activity Log toolbar gained a Filters control. Its only filter has always been the '
    + 'date-range dropdown, so a new one needs its own coverage - and every assertion in this '
    + 'file that treats the date range as "the filter" needs re-reading.'
  ).toEqual([]);
  expect(
    seen.mentionsFilter,
    'the word "filter" now appears inside <main> on the Activity Log. It did not when this was '
    + 'measured (checked at 1280, 1600 and 1920 wide), so something filter-shaped has been added.'
  ).toBeFalsy();

  // Recorded on every run so the toolbar's shape is on the record even when green.
  expect(await page.durationTrigger.isVisible()).toBeTruthy();
});

When('I open the Activity Log date-range filter', async function () {
  await al(this).openDurationMenu();
});

Then('the date-range filter should offer exactly these ranges in order:', async function (dataTable) {
  const want = dataTable.raw().map((r) => r[0].trim());
  const got = await al(this).readDurationOptions();
  await record(this, 'date-range options offered', got);

  // EXACTLY, and in order. A tolerant check would let a seventh range appear unnoticed, and the
  // order is what the filter table in the feature file indexes against.
  expect(got.map((o) => o.label)).toEqual(want);

  // The aria-hidden mirror is read too, and compared. It carries a BLANK option the popover does
  // NOT offer - measured, not user-selectable, and NOT a defect (the identical mirror on the
  // candidate view-profile tab was checked and recorded there). It is compared here so that a
  // real divergence between the two - a range the mirror knows and the popover hides - would be
  // visible rather than invisible.
  const mirror = await al(this).readMirrorOptions();
  await record(this, 'aria-hidden mirror <select> (the blank option is expected)', mirror);
  const mirrorLabels = (mirror.options || []).map((o) => o.label).filter(Boolean);
  expect(mirrorLabels).toEqual(want);
});

Then('the date-range filter should mark the applied range as selected', async function () {
  const page = al(this);
  const applied = await page.currentDurationLabel();
  const options = await page.readDurationOptions();
  const selected = options.filter((o) => o.selected).map((o) => o.label);
  await record(this, 'applied range vs the option marked selected', { applied, selected });

  expect(
    selected,
    'exactly one range should be marked selected in the popover, and it should be the one the '
    + 'trigger is showing. More than one, or none, means the control and its menu disagree about '
    + 'what is applied.'
  ).toEqual([applied]);
  await page.closeDurationMenu();
});

Then('the date-range filter should show {string}', async function (label) {
  await expect
    .poll(async () => (await al(this).currentDurationLabel()).trim(), {
      message: `the date-range filter never showed "${label}"`,
      timeout: 15000,
    })
    .toBe(label);
});

Then('the Activity Log request should carry the date range {string}', async function (value) {
  const query = await al(this).lastListQuery();
  await record(this, 'last Activity Log list query', query);
  expect(
    query,
    'no Activity Log list request has been made at all, so there is nothing to read the date '
    + 'range off. That is a different finding from the wrong range being sent.'
  ).not.toBeNull();
  expect(query).toContain(`duration=${value}`);
});

Then('the Activity Log URL should carry the date range {string}', async function (value) {
  const params = al(this).urlParams();
  await record(this, 'Activity Log URL parameters', params);
  expect(params[ActivityLogPage.URL_PARAMS.duration]).toBe(value);
});

Then('the Activity Log URL should carry no date-range parameter', async function () {
  const params = al(this).urlParams();
  await record(this, 'Activity Log URL parameters', params);
  expect(
    params[ActivityLogPage.URL_PARAMS.duration],
    'the page wrote a date-range parameter to the URL before anything was chosen. Measured, it '
    + 'writes nothing until the range is changed.'
  ).toBeUndefined();
});

// ==================== SECTION 2 - the date-range filter ====================

Then(
  'applying each date range should carry its value to the URL and to the server:',
  { timeout: TABLE },
  async function (dataTable) {
    const page = al(this);
    const rows = dataTable.hashes();
    const problems = [];
    const trace = [];

    for (const row of rows) {
      /* eslint-disable no-await-in-loop */
      const res = await page.selectDuration(row.range);
      const params = page.urlParams();
      const urlValue = params[ActivityLogPage.URL_PARAMS.duration];
      const query = res ? res.query : await page.lastListQuery();
      const label = await page.currentDurationLabel();

      const seen = {
        range: row.range,
        triggerLabel: label,
        urlValue,
        apiQuery: query,
        serverCount: res ? res.count : null,
        rendered: await page.rowCount(),
      };
      trace.push(seen);

      if (label !== row.range) {
        problems.push(`${row.range}: the trigger reads "${label}" after choosing it`);
      }
      if (urlValue !== row['url value']) {
        problems.push(
          `${row.range}: URL carries ${ActivityLogPage.URL_PARAMS.duration}="${urlValue}", expected "${row['url value']}"`
        );
      }
      if (!query || !query.includes(`duration=${row['api value']}`)) {
        problems.push(
          `${row.range}: the request carried "${query}", which does not include duration=${row['api value']}`
        );
      }
      /* eslint-enable no-await-in-loop */
    }

    await record(this, 'date range -> URL value -> API value, per range', trace);
    expect(
      problems,
      'The URL value and the API value are asserted SEPARATELY on purpose. They are equal on '
      + 'this surface, which is the reverse of every filter modal in this product - so checking '
      + 'only the URL would pass on a front end that rewrites the address bar and queries the '
      + 'server for something else, and that cannot be caught by reading the rendered entries.\n'
      + problems.join('\n')
    ).toEqual([]);
  }
);

// Relational, so it needs no expectation about how much activity the account holds and cannot go
// stale as the log grows. It is also genuinely falsifiable - see the second assertion.
Then(
  'the entry totals for the six date ranges should never decrease as the range widens',
  { timeout: TABLE },
  async function () {
    const page = al(this);
    const totals = [];
    for (const d of ActivityLogPage.DURATIONS) {
      /* eslint-disable no-await-in-loop */
      const res = await page.selectDuration(d.label);
      totals.push({
        label: d.label,
        count: res ? res.count : await page.lastListCount(),
      });
      /* eslint-enable no-await-in-loop */
    }
    await record(this, 'server totals per date range, narrowest first', totals);

    const problems = [];
    for (let i = 1; i < totals.length; i += 1) {
      if (totals[i].count < totals[i - 1].count) {
        problems.push(
          `${totals[i].label} returned ${totals[i].count}, fewer than ${totals[i - 1].label}'s `
          + `${totals[i - 1].count} - a wider window cannot hold less than a narrower one`
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);

    // >>> WITHOUT THIS, A FILTER THAT WAS IGNORED ENTIRELY WOULD PASS. <<< Six identical figures
    // satisfy "never decreases" perfectly. The only honest exception is an account whose whole
    // history fits inside the narrowest window, which is reported rather than silently allowed.
    const narrowest = totals[0].count;
    const widest = totals[totals.length - 1].count;
    if (widest === narrowest) {
      await record(
        this,
        'every range returned the same total, so the narrowing itself is NOT under test here',
        { totals, note: 'either the filter is ignored, or this account\'s whole history is under 24h old' }
      );
    }
    expect(
      widest >= narrowest,
      `the widest range returned ${widest} and the narrowest ${narrowest}`
    ).toBeTruthy();
    expect(
      widest,
      'every date range returned the SAME total, so this scenario proved nothing about '
      + 'narrowing. On an account with more than a day of history that means the filter is not '
      + 'being applied at all; on a brand-new account it means there is nothing to narrow. Check '
      + 'the attached totals before reading it either way.'
    ).toBeGreaterThan(narrowest);
  }
);

When('I select the {string} date range', { timeout: STEP }, async function (label) {
  const res = await al(this).selectDuration(label);
  this.alLastDuration = label;
  this.alLastResponse = res;
});

// Deliberately a DIFFERENT phrase from the one above, because it asserts the opposite thing: it
// must not require a request, since the app correctly makes none.
When('I re-select the {string} date range', { timeout: STEP }, async function (label) {
  this.alReselect = await al(this).selectDurationWatchingRequests(label);
});

Then('no further Activity Log request should have been sent', async function () {
  const seen = this.alReselect;
  await record(this, 're-selecting the applied range', seen);
  expect(
    seen,
    'this step reads what the previous "I re-select ..." step recorded, and nothing was recorded'
  ).toBeTruthy();
  expect(
    seen.requests,
    'the app re-queried the server for a range that was already applied. The absence of that '
    + 'request is the assertion here, which is why the request log runs from before the first '
    + 'navigation - a waitForResponse would resolve to null and read identically to a timeout.'
  ).toEqual([]);
});

When('I note the Activity Log total', async function () {
  const total = await al(this).lastListCount();
  expect(
    total,
    'no Activity Log list response has been captured, so there is no total to note. That is a '
    + 'suite problem (the log is installed before the first navigation), not an app one.'
  ).not.toBeNull();
  this.alNotedTotal = total;
  this.alNotedRendered = await al(this).rowCount();
  await record(this, 'noted Activity Log total', {
    serverCount: this.alNotedTotal,
    rendered: this.alNotedRendered,
  });
});

Then('the Activity Log total should be no greater than the noted total', async function () {
  const now = await al(this).lastListCount();
  await record(this, 'total after narrowing vs noted total', { noted: this.alNotedTotal, now });
  expect(now, 'no list response was captured after the narrowing').not.toBeNull();
  // Compared on the SERVER's count, never the rendered row count: the render is capped at
  // page_size, so two results differing only past the first page look identical on screen.
  expect(now).toBeLessThanOrEqual(this.alNotedTotal);
});

Then('the Activity Log total should equal the noted total', async function () {
  const now = await al(this).lastListCount();
  await record(this, 'restored total vs noted total', { noted: this.alNotedTotal, now });
  expect(
    now,
    `the total was ${this.alNotedTotal} when it was noted and is ${now} now. This is a LIVE, `
    + 'GROWING log on a shared DEV account, so a difference of one or two seconds apart can mean '
    + 'the account simply gained an entry - check the attached figures before reading it as the '
    + 'view failing to restore.'
  ).toBe(this.alNotedTotal);
});

Then('every rendered entry should be one the server returned', async function () {
  const page = al(this);
  const res = await page.lastListResponse();
  expect(res, 'no list response was captured').not.toBeNull();
  const rendered = await page.readEntries();
  const returned = res.results.map((r) => String(r.headline || ''));

  await record(this, 'rendered vs returned', {
    rendered: rendered.length,
    returned: returned.length,
    serverCount: res.count,
  });

  // The render is capped at page_size, so it matches results.length - never `count`.
  expect(
    rendered.length,
    `the page rendered ${rendered.length} entries for a payload of ${returned.length}. The list `
    + 'keeps the previous query\'s rows while the next is in flight, so a mismatch here usually '
    + 'means a settle was skipped - but it is asserted because the alternative reading, that the '
    + 'page is showing entries the server did not send, is far worse.'
  ).toBe(returned.length);

  const strays = rendered.filter((e) => !returned.includes(e.headline)).map((e) => e.headline);
  expect(strays, `entries on screen that the server did not return: ${strays.join(', ')}`).toEqual([]);
});

Then('every entry the server returned should be rendered', async function () {
  const page = al(this);
  const res = await page.lastListResponse();
  expect(res, 'no list response was captured').not.toBeNull();
  const rendered = await page.readEntries();

  await record(this, 'returned vs rendered', {
    returned: res.results.length,
    rendered: rendered.length,
    serverCount: res.count,
  });

  // >>> COUNTED, NEVER DE-DUPLICATED. <<< Entries that are genuinely distinct can render
  // identically, so a reader that collapsed duplicate text would hide real activity and let this
  // pass with half the payload missing - which is exactly what happened to readMemberCards() in
  // the community module, and to the first version of this same reader on the candidate profile.
  expect(
    rendered.length,
    `the server returned ${res.results.length} entries and the page rendered ${rendered.length}`
  ).toBe(res.results.length);
});

Then('every rendered entry should carry a headline, a description and a timestamp', async function () {
  const rendered = await al(this).readEntries();
  expect(rendered.length, 'no entries are rendered, so there is nothing to check').toBeGreaterThan(0);

  const problems = [];
  rendered.forEach((e, i) => {
    if (!e.headline) problems.push(`entry ${i}: no headline`);
    if (!e.description) problems.push(`entry ${i}: no description`);
    if (!e.timestamp) problems.push(`entry ${i}: no timestamp`);
    else if (!TIMESTAMP_RE.test(e.timestamp)) {
      problems.push(`entry ${i}: timestamp "${e.timestamp}" is not "MMM D, YYYY - h:mm AM"`);
    }
  });

  await record(this, 'rendered entries', rendered.slice(0, 10));
  expect(
    problems,
    'A timestamp carrying no TIME would be a regression worth knowing about: this surface renders '
    + 'it, while the candidate view-profile Activity Log tab discards it (recorded there as a '
    + 'finding), and two entries a minute apart are indistinguishable without it.\n'
    + problems.join('\n')
  ).toEqual([]);
});

Then(
  'dismissing the date-range popover should change nothing, by each of these routes:',
  { timeout: SLOW },
  async function (dataTable) {
    const page = al(this);
    const routes = dataTable.raw().map((r) => r[0].trim());
    const before = await page.currentDurationLabel();
    const problems = [];
    const trace = [];

    for (const route of routes) {
      /* eslint-disable no-await-in-loop */
      await page.openDurationMenu();
      const reqBase = page.requestCount();

      if (/escape/i.test(route)) {
        await this.page.keyboard.press('Escape');
      } else if (/outside/i.test(route)) {
        // The top-left corner of the viewport is page chrome, never an option.
        await this.page.mouse.click(5, 5);
      } else {
        throw new Error(`unknown dismissal route "${route}" - the step knows Escape and outside click`);
      }

      await this.page.waitForTimeout(800);
      const stillOpen = await page.durationMenuIsOpen();
      const after = await page.currentDurationLabel();
      const fired = page.requestsSince(reqBase);
      trace.push({ route, stillOpen, labelBefore: before, labelAfter: after, requests: fired });

      if (stillOpen) problems.push(`${route}: the popover stayed open`);
      if (after !== before) problems.push(`${route}: the applied range changed from "${before}" to "${after}"`);
      if (fired.length) problems.push(`${route}: dismissing re-queried the server (${fired.join(' | ')})`);
      /* eslint-enable no-await-in-loop */
    }

    await record(this, 'popover dismissal routes', trace);
    expect(problems, problems.join('\n')).toEqual([]);
  }
);

When(
  'I open the Activity Log with the date range {string} and the search term {string}',
  { timeout: SLOW },
  async function (duration, rawTerm) {
    const term = resolveTerm(this, rawTerm);
    await al(this).navigate({
      [ActivityLogPage.URL_PARAMS.duration]: duration,
      [ActivityLogPage.URL_PARAMS.search]: term,
    });
    this.alSearchTerm = term.trim();
  }
);

// >>> ONE COLLECTING STEP, NOT TWO SCENARIOS. <<< The unusable date-range values are independent
// cases of one rule and they fail independently. As two scenarios, Cucumber's
// abandon-at-first-failure meant a break in the unrecognised-value case said nothing about
// whether the empty-value case still worked. This walks every row, records what each one did,
// and reports them together.
//
// It asserts all THREE facts per row - the control's label, the value that reached the server,
// and that something actually rendered - because they fail independently and send a developer to
// different places: a filter that shows the right label while querying the wrong range is a very
// different defect from one that renders the chrome above nothing. The candidate portal's own
// profile HAS that second defect with an unrecognised ?selectedTab=, which is why it is checked.
//
// The URL being left holding the rejected value is RECORDED, not failed on - no AC settles
// whether the app should rewrite it, and failing here would make the file permanently red over a
// question for the PO.
Then(
  'each of these date-range values should fall back to the default:',
  { timeout: TABLE },
  async function (table) {
    const page = al(this);
    const problems = [];
    const trace = [];
    const wantLabel = ActivityLogPage.DEFAULT_DURATION.label;
    const wantValue = ActivityLogPage.DEFAULT_DURATION.apiValue;

    for (const row of table.hashes()) {
      const supplied = row['date range'] || '';
      const label = `${JSON.stringify(supplied)} (${row['why it matters']})`;

      /* eslint-disable no-await-in-loop */
      await page.navigate({ duration: supplied });
      const shown = (await page.currentDurationLabel()).trim();
      const query = await page.lastListQuery();
      const rendered = await page.rowCount();
      const empty = await page.readEmptyState();
      const url = page.urlParams();
      /* eslint-enable no-await-in-loop */

      trace.push(
        `${label}: control reads ${JSON.stringify(shown)}, request was ${JSON.stringify(query)}, `
        + `rendered=${rendered}, emptyState=${Boolean(empty)}, url=${JSON.stringify(url)}`
      );

      if (shown !== wantLabel) {
        problems.push(
          `${label}: the control reads ${JSON.stringify(shown)} rather than falling back to `
          + `${JSON.stringify(wantLabel)}`
        );
      }
      if (query === null || query === undefined) {
        problems.push(
          `${label}: no Activity Log list request was made at all, so there is nothing to read the `
          + 'date range off. That is a different finding from the wrong range being sent.'
        );
      } else if (!String(query).includes(`duration=${wantValue}`)) {
        problems.push(
          `${label}: the request was ${JSON.stringify(query)} rather than carrying `
          + `duration=${wantValue}. A control showing the default while the server is asked for `
          + 'something else is worse than no fallback at all.'
        );
      }
      if (!(rendered > 0 || empty)) {
        problems.push(
          `${label}: the page rendered neither entries nor its empty state - it is showing the `
          + 'chrome above nothing. That is the shape of defect the candidate portal\'s own profile '
          + 'has with an unrecognised ?selectedTab=, and this route is expected NOT to have it.'
        );
      }
    }

    await record(this, 'unusable date-range values', {
      rows: trace,
      recordedNotFailedOn:
        'The URL is left holding the rejected value rather than being rewritten to the range the '
        + 'app actually applied. No AC settles whether it should be rewritten, so it is reported '
        + 'here rather than failed on. Question for the PO.',
    });
    expect(problems, problems.join('\n')).toEqual([]);
  }
);

// ==================== SECTION 3 - the search ====================

When('I search the Activity Log for {string}', { timeout: STEP }, async function (rawTerm) {
  const term = resolveTerm(this, rawTerm);
  await al(this).searchFor(term);
  // The term the app is expected to have applied. Trimmed, because the control trims - measured.
  this.alSearchTerm = term.trim();
  this.alSearchRaw = term;
});

// Derived from the data rather than hardcoded, so it cannot go stale as this live, growing log
// changes. Words overlapping the agent's own identity are excluded - see safeWordsFrom().
When('I search the Activity Log by a word from the first entry', { timeout: STEP }, async function () {
  const page = al(this);
  const entries = await page.readEntries();
  expect(
    entries.length,
    'no entries are listed, so no term can be derived from one. Widen the range, or point '
    + 'AGENT_EMAIL at an account that has some activity.'
  ).toBeGreaterThan(0);

  const identity = agentIdentity();
  const ident = `${identity.local} ${identity.email}`;
  const words = safeWordsFrom(entries[0].headline, ident);
  expect(
    words.length,
    `no usable term in the first entry's headline "${entries[0].headline}". A term is usable if `
    + 'it is 4+ characters and is NOT a substring of the signed-in agent\'s name or email - the '
    + 'search matches the actor too, so an overlapping word matches nearly every entry and '
    + '"every listed entry contains the term" would fail against a search that works correctly.'
  ).toBeGreaterThan(0);

  const term = words[0];
  await page.searchFor(term);
  this.alSearchTerm = term;
  await record(this, 'term derived from the first entry', {
    headline: entries[0].headline,
    candidates: words,
    used: term,
  });
});

When('I search the Activity Log by the signed-in agent\'s own name', { timeout: STEP }, async function () {
  const identity = agentIdentity();
  expect(identity.firstName, 'AGENT_EMAIL is not set, so there is no name to search by').toBeTruthy();
  await al(this).searchFor(identity.firstName);
  this.alSearchTerm = identity.firstName;
  this.alActorTerm = identity;
});

When('I clear the Activity Log search', { timeout: STEP }, async function () {
  await al(this).clearSearch();
  this.alSearchTerm = null;
});

Then('the Activity Log URL should carry the search term', async function () {
  const params = al(this).urlParams();
  await record(this, 'Activity Log URL parameters', params);
  // URLSearchParams, never decodeURIComponent: the latter does not turn "+" back into a space,
  // so a multi-word term compared that way can never match a URL that correctly encodes it.
  expect(params[ActivityLogPage.URL_PARAMS.search]).toBe(this.alSearchTerm);
});

Then('the Activity Log URL should carry the search term {string}', async function (raw) {
  const expected = resolveTerm(this, raw).trim();
  const params = al(this).urlParams();
  await record(this, 'Activity Log URL parameters', params);
  expect(params[ActivityLogPage.URL_PARAMS.search]).toBe(expected);
});

Then('the Activity Log request should carry the search term', async function () {
  const query = await al(this).lastListQuery();
  await record(this, 'last Activity Log list query', query);
  expect(query, 'no Activity Log list request has been made at all').not.toBeNull();
  expect(query).toContain(`${ActivityLogPage.API_PARAMS.search}=${this.alSearchTerm}`);
});

Then('the Activity Log request should carry the search term {string}', async function (raw) {
  const expected = resolveTerm(this, raw).trim();
  const query = await al(this).lastListQuery();
  await record(this, 'last Activity Log list query', query);
  expect(query, 'no Activity Log list request has been made at all').not.toBeNull();
  expect(query).toContain(`${ActivityLogPage.API_PARAMS.search}=${expected}`);
});

Then('the Activity Log URL should carry no search parameter', async function () {
  const params = al(this).urlParams();
  await record(this, 'Activity Log URL parameters', params);
  expect(
    params[ActivityLogPage.URL_PARAMS.search],
    `the URL still carries ${ActivityLogPage.URL_PARAMS.search}="${params[ActivityLogPage.URL_PARAMS.search]}"`
  ).toBeUndefined();
});

Then('the Activity Log request should carry no search parameter', async function () {
  const query = await al(this).lastListQuery();
  await record(this, 'last Activity Log list query', query);
  expect(query, 'no Activity Log list request has been made at all').not.toBeNull();
  expect(
    /(^|&)search=/.test(query),
    `the request carried "${query}", which includes a search parameter when none should be applied`
  ).toBeFalsy();
});

Then('at least one entry should be listed', async function () {
  const page = al(this);
  const count = await page.rowCount();
  if (!count) await record(this, 'empty state on screen', await page.readEmptyState());
  expect(
    count,
    'no entries are listed. Where the term was hardcoded in the Gherkin this may simply mean the '
    + 'account no longer holds a matching entry - check the attached query and pick a term that '
    + 'does, rather than reading it as a broken search.'
  ).toBeGreaterThan(0);
});

Then('no entry should be listed', async function () {
  const page = al(this);
  await expect
    .poll(async () => page.rowCount(), { message: 'entries are still listed', timeout: 15000 })
    .toBe(0);
});

Then('every listed entry should match the Activity Log search term', async function () {
  const page = al(this);
  const term = String(this.alSearchTerm || '');
  expect(term, 'no search term has been applied, so there is nothing to match against').toBeTruthy();

  const entries = await page.readEntries();
  // A step that passes having inspected nothing is worse than one that fails: it retires the
  // assertion silently. Same rule as "non-paid billing rows should have disabled receipt
  // actions", which used to log "nothing to assert" and pass.
  expect(
    entries.length,
    `no entries are listed for "${term}", so this step would pass having checked nothing`
  ).toBeGreaterThan(0);

  const strays = entries
    .filter((e) => !e.text.toLowerCase().includes(term.toLowerCase()))
    .map((e) => e.text.slice(0, 100));

  await record(this, `entries listed for "${term}"`, {
    term,
    listed: entries.length,
    sample: entries.slice(0, 5).map((e) => e.text.slice(0, 100)),
  });

  expect(
    strays,
    'Entries were listed that do not show the term anywhere. NOTE the search also matches the '
    + 'actor\'s name and email, which no entry displays - so this is only a defect for a term '
    + 'that does NOT overlap the signed-in agent\'s identity, which is what safeWordsFrom() '
    + 'guarantees for a derived term. Check the term before filing.\n'
    + strays.join('\n')
  ).toEqual([]);
});

Then(
  'these variations of a term taken from the first entry should agree with one another:',
  { timeout: TABLE },
  async function (dataTable) {
    const page = al(this);
    const entries = await page.readEntries();
    expect(entries.length, 'no entries are listed, so no term can be derived').toBeGreaterThan(0);

    const identity = agentIdentity();
    const words = safeWordsFrom(entries[0].headline, `${identity.local} ${identity.email}`);
    expect(words.length, `no usable term in "${entries[0].headline}"`).toBeGreaterThan(0);
    const base = words[0];

    // A mid-word slice is a strict SUPERSET of the whole word (everything containing "Invite"
    // contains "nvit"), which is why its expectation is ">=" and not "=".
    const slice = base.length >= 5 ? base.slice(1, base.length - 1) : base.slice(1);

    const variants = {
      'as typed': base,
      'lower case': base.toLowerCase(),
      'upper case': base.toUpperCase(),
      'mid-word slice': slice,
    };

    const results = {};
    for (const row of dataTable.hashes()) {
      /* eslint-disable no-await-in-loop */
      const term = variants[row.variation];
      if (term === undefined) {
        throw new Error(
          `unknown variation "${row.variation}" - the step knows: ${Object.keys(variants).join(', ')}`
        );
      }
      const res = await page.searchFor(term);
      results[row.variation] = {
        term,
        count: res ? res.count : await page.lastListCount(),
        rendered: await page.rowCount(),
      };
      /* eslint-enable no-await-in-loop */
    }

    await record(this, 'search variations, compared against EACH OTHER rather than a fixed number', {
      derivedFrom: entries[0].headline,
      base,
      results,
    });

    const baseline = results['as typed'];
    expect(
      baseline.count,
      `the baseline term "${base}" matched nothing, so every comparison below it is vacuous`
    ).toBeGreaterThan(0);

    const problems = [];
    if (results['lower case'] && results['lower case'].count !== baseline.count) {
      problems.push(
        `lower case "${results['lower case'].term}" returned ${results['lower case'].count}, `
        + `the term as typed returned ${baseline.count} - the search is case SENSITIVE`
      );
    }
    if (results['upper case'] && results['upper case'].count !== baseline.count) {
      problems.push(
        `upper case "${results['upper case'].term}" returned ${results['upper case'].count}, `
        + `the term as typed returned ${baseline.count} - the search is case SENSITIVE`
      );
    }
    if (results['mid-word slice'] && results['mid-word slice'].count < baseline.count) {
      problems.push(
        `the mid-word slice "${results['mid-word slice'].term}" returned `
        + `${results['mid-word slice'].count}, FEWER than the whole word's ${baseline.count}. `
        + 'Everything containing the whole word contains the slice, so the slice cannot match '
        + 'less - the search is anchored to word starts rather than matching mid-word.'
      );
    }

    expect(problems, problems.join('\n')).toEqual([]);
  }
);

Then('the Activity Log page should still be usable', async function () {
  const page = al(this);
  await expect(page.searchInput).toBeVisible();
  await expect(page.durationTrigger).toBeVisible();
  await expect(page.pageHeading).toBeVisible();
});

Then('each of these search terms should be handled safely:', { timeout: TABLE }, async function (dataTable) {
  const page = al(this);

  // A native dialog would be the loudest possible evidence that a term was executed rather than
  // searched. Playwright dismisses dialogs automatically, so without a listener one would leave
  // no trace at all.
  const dialogs = [];
  const onDialog = (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
  };
  this.page.on('dialog', onDialog);

  const problems = [];
  const trace = [];
  try {
    for (const row of dataTable.hashes()) {
      /* eslint-disable no-await-in-loop */
      const term = expandTerm(row.term);
      const seen = await page.searchWatchingRequests(term);
      const last = seen.responses.length ? seen.responses[seen.responses.length - 1] : null;

      // Nothing the term contains may end up as live markup.
      const injected = await this.page.evaluate(() => {
        const main = document.querySelector('main');
        return main ? main.querySelectorAll('script').length : -1;
      });

      const entry = {
        label: row.label,
        termLength: term.length,
        requests: seen.requests,
        status: last ? last.status : null,
        count: last ? last.count : null,
        rendered: seen.rendered,
        scriptsInMain: injected,
      };
      trace.push(entry);

      if (!seen.requests.length) {
        problems.push(`${row.label}: the app sent no request at all, so the term was never handled`);
      }
      if (last && last.status >= 500) {
        problems.push(`${row.label}: the server answered ${last.status} - the term crashed the endpoint`);
      }
      if (injected > 0) {
        problems.push(`${row.label}: ${injected} <script> element(s) are now inside <main>`);
      }
      /* eslint-enable no-await-in-loop */
    }

    if (dialogs.length) {
      problems.push(`a native dialog was raised: ${JSON.stringify(dialogs)}`);
    }

    await record(this, 'terms the log cannot contain, and how each was handled', {
      trace,
      dialogs,
    });

    // The page has to survive all five, not merely answer them.
    await expect(page.searchInput).toBeVisible();
    await expect(page.durationTrigger).toBeVisible();

    expect(
      problems,
      'Every case is collected and reported together rather than one at a time: Cucumber '
      + 'abandons a scenario at its first failing step, and five independent inputs reported '
      + 'singly would hide whether they share a cause.\n'
      + problems.join('\n')
    ).toEqual([]);
  } finally {
    this.page.off('dialog', onDialog);
  }
});

Then('the Activity Log search box should be empty', async function () {
  expect(await al(this).searchValue()).toBe('');
});

Then('the Activity Log search box should contain {string}', async function (raw) {
  const expected = resolveTerm(this, raw);
  await expect
    .poll(async () => al(this).searchValue(), {
      message: `the search box never held "${expected}"`,
      timeout: 15000,
    })
    .toBe(expected);
});

// RECORDED, NOT FAILED ON. It asserts what the build DOES - the actor is searchable - so it goes
// red if that capability disappears, and attaches the question rather than a preference.
Then('the fields the search matched should be reported for the PO', async function () {
  const page = al(this);
  const identity = this.alActorTerm || agentIdentity();
  const entries = await page.readEntries();
  const res = await page.lastListResponse();

  const showingTheTerm = entries.filter((e) =>
    e.text.toLowerCase().includes(String(identity.firstName).toLowerCase())
  ).length;

  const payloadActors = res
    ? [...new Set(res.results.map((r) => `${r.actor_name || ''} <${r.actor_email || ''}>`))]
    : [];

  await record(
    this,
    'FINDING (recorded, not failed on): the search matches fields no entry displays',
    {
      term: identity.firstName,
      entriesListed: entries.length,
      entriesVisiblyContainingTheTerm: showingTheTerm,
      serverTotal: res ? res.count : null,
      actorsInThePayload: payloadActors,
      placeholder: 'Search...',
      question:
        'The search matches the actor name and actor email, neither of which appears anywhere on '
        + 'an entry, and the placeholder is a bare "Search..." that promises nothing. An agent '
        + 'has no way to know what the box searches. Should the placeholder name the fields, or '
        + 'should the search be narrowed to what is displayed?',
    }
  );

  expect(
    entries.length,
    `searching the agent's own name ("${identity.firstName}") returned nothing. That is a `
    + 'REGRESSION in a capability agents may be relying on, not the recorded finding - the actor '
    + 'was searchable when this was measured.'
  ).toBeGreaterThan(0);
});

// ==================== SECTION 5 - the empty state ====================

Then('the Activity Log empty state should be displayed', async function () {
  const state = await al(this).readEmptyState();
  await record(this, 'empty state as rendered', state);
  expect(state, 'no empty state is on screen').not.toBeNull();
  expect(state.heading).toBeTruthy();
});

Then('the Activity Log empty state should not be displayed', async function () {
  // Watches a WINDOW rather than sampling once: "not visible" is also true of an empty state the
  // app has not finished removing, and of one it is about to render.
  await expect
    .poll(async () => al(this).readEmptyState(), {
      message: 'the empty state is still on screen',
      timeout: 15000,
    })
    .toBeNull();
});

Then('the Activity Log entry list should not be rendered at all', async function () {
  const present = await al(this).hasItemsContainer();
  await record(this, 'entry list container present while empty?', { present });
  expect(
    present,
    'the entry list container is still in the DOM beside the empty state. It is removed entirely '
    + 'when there is nothing to list - measured - and leaving an empty list container behind is '
    + 'how a stale row survives into the next query.'
  ).toBeFalsy();
});

// >>> THE EMPTY-STATE REQUIREMENT, as requested 2026-10-15. <<<
//  1. search-only, date-range-only and combined states each use their specified copy;
//  2. any state with a date range says no results match the current filters;
//  3. "Clear all filters" is offered for each narrowed state, including search only;
//  4. the component keeps one position whether or not a search is applied.
// Each rule is its own scenario, and every one of them drives the SAME states through
// driveEmptyStates(), so a red row on one rule cannot be blamed on a different setup.
//
// The default range is NOT a filter: Last 7 days is what the page opens on, and an empty list with
// nothing narrowing it is the tab-level "No activity to show" (measured). So "range only" means a
// NON-default range.

const isNone = (v) => !v || v.trim() === '-' || v.trim() === '';

function durationFor(label) {
  const d = ActivityLogPage.DURATIONS.find((x) => x.label === label.trim());
  if (!d) throw new Error(`"${label}" is not one of the six date ranges`);
  return d;
}

// Deep-links each row's state and reads the empty state it renders. A row with NO search cannot
// be made empty by data (see stubEmptyList), so only that row is answered by the stub - and the
// row says so in the report. Rows WITH a search use the live server and an unmatchable term.
async function driveEmptyStates(world, rows) {
  const page = al(world);
  const out = [];
  /* eslint-disable no-await-in-loop */
  for (const row of rows) {
    const params = {};
    if (!isNone(row.range)) params[ActivityLogPage.URL_PARAMS.duration] = durationFor(row.range).urlValue;
    if (!isNone(row.search)) params[ActivityLogPage.URL_PARAMS.search] = row.search;
    const stubbed = isNone(row.search);
    if (stubbed) await page.stubEmptyList();
    try {
      await page.navigate(params);
      let state = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        state = await page.readEmptyState();
        if (state) break;
        await world.page.waitForTimeout(250);
      }
      out.push({ ...row, params, stubbed, state, rows: await page.rowCount() });
    } finally {
      if (stubbed) await page.unstubEmptyList();
    }
  }
  /* eslint-enable no-await-in-loop */
  await record(world, 'empty states driven', out.map(({ state, ...r }) => ({
    ...r,
    heading: state && state.heading,
    body: state && state.body,
    cta: state && state.cta,
    variant: state && state.variant,
    geometry: state && state.geometry,
  })));
  return out;
}

// VERBATIM, per the requested copy: heading, message and the Clear All button (or its
// ABSENCE, written "-") are each compared EXACTLY - not `includes` - so a sub-line added later, a
// reworded message or a button appearing where it should not all go red. Whitespace is collapsed
// and typographic apostrophes folded to ASCII, so a curly-vs-straight quote is not a failure;
// the raw text is attached so a genuine change is still visible. Collected and thrown once, so a
// red run names every state that is wrong rather than only the first.
const fold = (t) => String(t == null ? '' : t)
  .replace(/[‘’ʼ]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

Then(
  'the Activity Log empty state should read exactly as follows:',
  { timeout: TABLE },
  async function (dataTable) {
    const results = await driveEmptyStates(this, dataTable.hashes());
    const problems = [];
    for (const r of results) {
      const tag = `[${r.applied}]`;
      if (!r.state) {
        problems.push(`${tag} no empty state rendered at all (${r.rows} rows listed)`);
        continue;
      }
      if (fold(r.state.heading) !== fold(r.heading)) {
        problems.push(`${tag} heading: expected "${r.heading}", got "${r.state.heading}"`);
      }
      if (fold(r.state.body) !== fold(r.message)) {
        problems.push(`${tag} message: expected "${r.message}", got "${r.state.body}"`);
      }
      const wantCta = isNone(r['clear all']) ? [] : [fold(r['clear all'])];
      const gotCta = (r.state.cta || []).map(fold);
      if (JSON.stringify(gotCta) !== JSON.stringify(wantCta)) {
        problems.push(
          `${tag} button: expected ${wantCta.length ? `"${wantCta[0]}"` : 'NO button'}, `
          + `got ${gotCta.length ? JSON.stringify(gotCta) : 'no button'}`
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  }
);

When('I click Clear All in the Activity Log empty state', { timeout: STEP }, async function () {
  this.alClearAllQueries = await al(this).clickClearAll();
  await record(this, 'requests the Clear All click produced', this.alClearAllQueries);
});

When('I note the Activity Log empty state', async function () {
  this.alNotedEmpty = await al(this).readEmptyState();
  await record(this, 'noted empty state', this.alNotedEmpty);
  expect(this.alNotedEmpty, 'there is no empty state on screen to note').not.toBeNull();
});

Then('the Activity Log empty state should be the noted one', async function () {
  let now = null;
  await expect
    .poll(async () => {
      now = await al(this).readEmptyState();
      return !!now;
    }, { message: 'no empty state after the refresh', timeout: 15000 })
    .toBe(true);
  await record(this, 'empty state after the refresh', now);
  const was = this.alNotedEmpty;
  expect({ heading: now.heading, body: now.body, cta: now.cta })
    .toEqual({ heading: was.heading, body: was.body, cta: was.cta });
});

// Each row: start from a clean page, apply the row THROUGH THE CONTROLS (not a deep link - the
// point is that what the agent chose is written somewhere a refresh can restore it), refresh,
// and check every place the state lives: the URL, both controls, and the request the refreshed
// page actually sent. Collected and thrown once, so a red run says WHICH selection is lost.
Then(
  'each of these selections should survive a page refresh:',
  { timeout: TABLE },
  async function (dataTable) {
    const page = al(this);
    const problems = [];
    const evidence = [];
    /* eslint-disable no-await-in-loop */
    for (const row of dataTable.hashes()) {
      const tag = `[${row.selection}]`;
      await page.navigate();
      if (!isNone(row.range)) {
        // Re-picking the range already applied fires nothing, so to choose the DEFAULT on purpose
        // the agent has to have moved off it first.
        if (row.range.trim() === ActivityLogPage.DEFAULT_DURATION.label) await page.selectDuration('This year');
        await page.selectDuration(row.range.trim());
      }
      const rowSearch = isNone(row.search) ? '' : resolveTerm(this, row.search);
      if (rowSearch) await page.searchFor(rowSearch);
      await page.flush();
      const before = { url: this.page.url(), count: await page.lastListCount() };

      const baseline = await page.responseCount();
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await page.settleAgainstServer(baseline);

      const wantRange = isNone(row.range) ? ActivityLogPage.DEFAULT_DURATION.label : row.range.trim();
      const wantApi = durationFor(wantRange).apiValue;
      const wantSearch = rowSearch.trim();
      const after = {
        url: this.page.url(),
        label: (await page.currentDurationLabel()).trim(),
        searchBox: await page.searchValue(),
        query: await page.lastListQuery(),
        count: await page.lastListCount(),
      };
      evidence.push({ selection: row.selection, before, after });

      const q = after.query || '';
      if (after.url !== before.url) problems.push(`${tag} the URL changed on refresh: ${before.url} -> ${after.url}`);
      if (after.label !== wantRange) problems.push(`${tag} the date-range filter shows "${after.label}" after refresh, expected "${wantRange}"`);
      if (after.searchBox !== wantSearch) problems.push(`${tag} the search box holds "${after.searchBox}" after refresh, expected "${wantSearch}"`);
      if (!q.includes(`duration=${wantApi}`)) problems.push(`${tag} the refreshed page queried "${q}", without duration=${wantApi}`);
      if (wantSearch && !q.includes(`search=${wantSearch}`)) problems.push(`${tag} the refreshed page queried "${q}", without search=${wantSearch}`);
      if (!wantSearch && /(^|&)search=/.test(q)) problems.push(`${tag} the refreshed page sent a search nobody applied: "${q}"`);
      if (after.count !== before.count) problems.push(`${tag} the total changed on refresh: ${before.count} -> ${after.count}`);
    }
    /* eslint-enable no-await-in-loop */
    await record(this, 'selections before and after refresh', evidence);
    expect(problems, problems.join('\n')).toEqual([]);
  }
);

// ==================== SECTION 6 - paging ====================

When('I scroll the Activity Log to the end twice', { timeout: SLOW }, async function () {
  this.alScrollPasses = await al(this).scrollForMore(2);
  await record(this, 'infinite-scroll passes', this.alScrollPasses);
});

Then('each scroll should have requested the next page in order', async function () {
  const passes = this.alScrollPasses || [];
  expect(passes.length, 'no scroll passes were recorded').toBeGreaterThan(0);

  const problems = [];
  passes.forEach((p, i) => {
    const wanted = `page=${i + 2}`;
    if (!p.queries.length) {
      problems.push(`pass ${p.pass}: scrolling to the end fetched nothing`);
    } else if (!p.queries.some((q) => q.includes(wanted))) {
      problems.push(
        `pass ${p.pass}: expected a request for ${wanted}, got ${p.queries.join(' | ')}. A build `
        + 're-requesting page 1 forever would satisfy "a request was made", which is why the '
        + 'page NUMBER is asserted.'
      );
    }
  });

  expect(problems, problems.join('\n')).toEqual([]);
});

Then('the number of entries listed should have grown with each scroll', async function () {
  const passes = this.alScrollPasses || [];
  const problems = passes
    .filter((p) => p.after <= p.before)
    .map((p) => `pass ${p.pass}: ${p.before} entries before, ${p.after} after - nothing was appended`);

  expect(
    problems,
    'The list APPENDS - measured, 10 entries growing to 70 over six fetches. A page that fetched '
    + 'the next page and then REPLACED the list with it would satisfy the request assertion above '
    + 'and lose everything the agent had already scrolled past.\n'
    + problems.join('\n')
  ).toEqual([]);
});

// Asserted as a RULE with its justification attached, not as a bare absence: there is no
// pagination control BECAUSE the list pages by scrolling, and reading the absence on its own is
// how "10 of 514 entries are unreachable" nearly got filed.
Then('the Activity Log should offer no pagination control', async function () {
  const seen = await this.page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return { mainMissing: true };
    return {
      navs: [...main.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label') || '(unnamed)'),
      buttons: [...main.querySelectorAll('button')].map((b) =>
        (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()
      ),
    };
  });
  await record(this, 'controls in <main> (pagination check)', seen);

  const pagerish = (seen.buttons || []).filter((b) => /^(next|previous|prev|page \d+|\d+)$/i.test(b));
  expect(
    pagerish,
    'a pagination control appeared on the Activity Log. That is not automatically a defect - but '
    + 'this listing pages by SCROLLING (measured: it appends), so a pager beside it means the '
    + 'paging model changed and the scroll scenarios need re-measuring.\n'
    + `controls seen: ${pagerish.join(', ')}`
  ).toEqual([]);
  expect(seen.navs, 'a <nav> appeared inside <main>').toEqual([]);
});

Then('the server should report more entries than the page renders', async function () {
  const page = al(this);
  const total = await page.lastListCount();
  const rendered = await page.rowCount();
  await record(this, 'server total vs rendered', { total, rendered });

  expect(total, 'no list response was captured').not.toBeNull();
  expect(
    total,
    `the server reports ${total} entries and the page renders ${rendered}. With no more entries `
    + 'than fit on one page there is nothing for the scroll to fetch, so this scenario proves '
    + 'nothing about paging - widen the range, or use an account with more activity.'
  ).toBeGreaterThan(rendered);
});

Then('the Activity Log request should carry the first page', async function () {
  const query = await al(this).lastListQuery();
  await record(this, 'last Activity Log list query', query);
  expect(query, 'no Activity Log list request has been made at all').not.toBeNull();
  expect(
    query,
    `the request carried "${query}". A new query has to restart at page 1 - continuing from the `
    + 'page the agent had scrolled to would strand them in the middle of a different result set.'
  ).toContain('page=1');
});

Then('the Activity Log should be scrolled back to the top', async function () {
  const top = await al(this).scrollTop();
  await record(this, 'scroll position after a new query', { scrollTop: top });
  // A few pixels of momentum is not a failure; being left hundreds of pixels down a list that
  // has just been replaced is.
  expect(top, `the list is still scrolled to ${top}px after a new query`).toBeLessThan(50);
});

// ==================== SECTION 7 - end to end ====================

When('I note the Activity Log URL', async function () {
  this.alNotedUrl = this.page.url();
  await record(this, 'noted Activity Log URL', this.alNotedUrl);
});

When('I reload the Activity Log', { timeout: SLOW }, async function () {
  const page = al(this);
  const baseline = await page.responseCount();
  await this.page.reload({ waitUntil: 'domcontentloaded' });
  await page.settleAgainstServer(baseline);
});

Then('the Activity Log URL should be the noted URL', async function () {
  expect(this.page.url()).toBe(this.alNotedUrl);
});
