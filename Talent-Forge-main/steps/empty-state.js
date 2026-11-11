// Step definitions for features/Agent_Portal/Empty-state.feature - every empty state the Agent
// Portal renders, read as an agent that holds NOTHING (NO_CANDIDATE_AGENT, iqra.farooq+211@).
//
// >>> NOTHING HERE WRITES, AND NOTHING HERE MAY INVITE. <<< The zero-candidate state of that
// account is the whole fixture, and one invitation spends it permanently (a candidate cannot be
// deleted). The two "Invite Candidates" CTAs are asserted PRESENT and are never clicked.
//
// >>> EVERY PHRASE IS WORDED "... empty state(s) ..." / "the empty agent ...". <<< playwright-bdd
// loads every step file into ONE registry and fails generation on an ambiguous phrase, and the
// neighbouring listing files (active-candidate.js, require-attention.js, candidate-deactivated.js,
// verifications.js, activity-log.js) each own an empty-state vocabulary bound to THEIR page
// object and THEIR account.
//
// >>> ONE TABLE STEP DRIVES EVERY LISTING. <<< Each row is a fresh navigation plus the actions it
// names, and the step collects every mismatch across every row and throws ONCE: a scenario per
// row would cost a login each and, abandoning at the first failure, never say whether the reds
// share a cause.

const { Given, When, Then, Before } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const { resilientSignIn } = require('../utils/resilientSignIn');
const AgentEmptyStatePage = require('../pages/AgentEmptyStatePage');

const EMAIL = (process.env.NO_CANDIDATE_AGENT_EMAIL || '').trim();
const PASSWORD = process.env.NO_CANDIDATE_AGENT_PASSWORD;

const TABLE = { timeout: 600000 };
const none = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-';
const ctaList = (v) => (none(v) ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
// A local calendar date, n days back. Built from the local clock, not toISOString(), which is UTC
// and names yesterday for a run in the early hours in Riyadh/Karachi.
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The second fixture: a dedicated agent with ONE candidate who signed up, verified and did nothing
// else. Minted by scripts/provision-empty-profile-candidate.js (2026-10-13) precisely so that
// NO_CANDIDATE_AGENT never has to invite anyone.
const PROFILE_AGENT_EMAIL = (process.env.EMPTY_PROFILE_AGENT_EMAIL || '').trim();
const PROFILE_AGENT_PASSWORD = process.env.EMPTY_PROFILE_AGENT_PASSWORD;
const PROFILE_CANDIDATE_ID = (process.env.EMPTY_PROFILE_CANDIDATE_ID || '').trim();
const PROFILE_CANDIDATE_EMAIL = (process.env.EMPTY_PROFILE_CANDIDATE_EMAIL || '').trim();

function es(world) {
  if (!world._emptyStatePage) world._emptyStatePage = new AgentEmptyStatePage(world.page);
  return world._emptyStatePage;
}

// Playwright auto-dismisses a native dialog when nothing listens, so an executed `alert(...)` from
// an unsafe search term would leave no trace at all. Recorded here, asserted by its own step.
function watchDialogs(world) {
  world._esDialogs = [];
  world.page.on('dialog', (d) => { world._esDialogs.push(d.message()); d.dismiss().catch(() => {}); });
}

async function attachJson(world, name, data) {
  const relogins = world._emptyStatePage && world._emptyStatePage.relogins;
  if (relogins) data = { sessionRecoveredTimes: relogins, data };
  await world.attach(JSON.stringify({ [name]: data }, null, 2), 'application/json');
}

/**
 * Drive one table row: open the page, take the tab / search / filter actions it names, and read
 * the empty state it lands on. Returns { read, applied, badge }.
 */
async function driveRow(world, row) {
  const p = es(world);
  await p.open(row.page);
  const applied = {};
  if (!none(row.tab)) await p.selectTab(row.page, row.tab);
  if (!none(row.filter)) {
    if (row.filter === 'date range') {
      // Verifications' Date Uploaded range - two calendar-only react-aria pickers, driven by the
      // helpers verifications.feature already owns rather than a second copy of them.
      await p.settle();
      const v = world.pages.agentVerifications;
      await v.openFilters();
      await v.pickDate('start', isoDaysAgo(7));
      await v.pickDate('end', isoDaysAgo(0));
      await v.applyFilters({ settle: false });
      applied.filter = `${isoDaysAgo(7)} to ${isoDaysAgo(0)}`;
    } else if (row.page === 'Activity Log') {
      await p.selectActivityRange(row.filter);
      applied.filter = row.filter;
    } else {
      applied.filter = await p.applyFirstFilter(row.page);
    }
  }
  if (!none(row.search)) await p.search(row.search);
  const read = await p.waitForEmptyState(row.heading, 20000, row.body || null);
  const badge = !none(row.filter) && row.page !== 'Activity Log' ? await p.filtersBadge(row.page) : null;
  return { read, applied, badge };
}

function compareRow(row, { read, badge }) {
  const where = `${row.page}${none(row.tab) ? '' : ` > ${row.tab}`}${none(row.search) ? '' : ` + search "${row.search}"`}${none(row.filter) ? '' : ` + filter "${row.filter}"`}`;
  const problems = [];
  if (read.heading !== row.heading) problems.push(`${where}: heading "${read.heading}", expected "${row.heading}"`);
  if (read.body !== row.body) problems.push(`${where}: body "${read.body}", expected "${row.body}"`);
  if (read.count > 1) problems.push(`${where}: ${read.count} empty states rendered at once`);
  const want = ctaList(row.cta);
  if (!sameSet(read.ctas, want)) problems.push(`${where}: CTAs [${read.ctas.join(', ')}], expected [${want.join(', ')}]`);
  if (badge !== null && !/^Filters 1$/.test(badge)) problems.push(`${where}: Filters badge "${badge}", expected "Filters 1"`);
  return problems;
}

// ==================== Background ====================

Before({ tags: '@empty-state' }, async function (scenario) {
  this._emptyStateScenarioTags = (scenario.pickle.tags || []).map((tag) => tag.name);
});

Given('I am logged in as the empty agent', { timeout: 150000 }, async function () {
  const profileFixture = (this._emptyStateScenarioTags || []).includes('@empty-profile');
  const email = profileFixture ? PROFILE_AGENT_EMAIL : EMAIL;
  const password = profileFixture ? PROFILE_AGENT_PASSWORD : PASSWORD;
  if (!email || !password || (profileFixture && !PROFILE_CANDIDATE_ID)) {
    const fixture = profileFixture ? 'EMPTY_PROFILE_AGENT_EMAIL / _PASSWORD / EMPTY_PROFILE_CANDIDATE_ID' : 'NO_CANDIDATE_AGENT_EMAIL / NO_CANDIDATE_AGENT_PASSWORD';
    throw new Error(`Missing ${fixture} in .env`);
  }
  await es(this).suppressWelcomeModal();
  if (!profileFixture) watchDialogs(this);
  await resilientSignIn(this, email, password, { landedOn: /\/dashboard|\/candidates|\/getting-started/ });
  es(this).relogin = () => resilientSignIn(this, email, password, { landedOn: /\/dashboard|\/candidates|\/getting-started/ });
});

// ==================== Dashboard ====================

When('I open the empty agent\'s dashboard', { timeout: 60000 }, async function () {
  await es(this).openDashboard();
});

Then('every empty-state KPI tile should read 0:', TABLE, async function (dataTable) {
  const problems = [];
  const seen = {};
  for (const { tile } of dataTable.hashes()) {
    const v = await es(this).readKpi(tile);
    seen[tile] = v;
    if (v !== '0') problems.push(`KPI "${tile}" reads ${v === null ? 'no figure' : `"${v}"`}, expected "0"`);
  }
  await attachJson(this, 'empty-dashboard-kpis', seen);
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('the empty-state Promo Code should read {string}', async function (want) {
  const got = await es(this).readPromoCode();
  expect(got, `Promo Code on the Referral Codes card reads "${got}"`).toBe(want);
});

Then('every dashboard card should show its empty state:', TABLE, async function (dataTable) {
  const problems = [];
  const seen = {};
  for (const row of dataTable.hashes()) {
    let read = null;
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      read = await es(this).readDashboardCard(row.card);
      if (read && read.heading === row.heading) break;
      await this.page.waitForTimeout(500);
    }
    seen[row.card] = read;
    if (!read) { problems.push(`card "${row.card}": no empty state found`); continue; }
    if (read.heading !== row.heading) problems.push(`card "${row.card}": heading "${read.heading}", expected "${row.heading}"`);
    if (read.body !== row.body) problems.push(`card "${row.card}": body "${read.body}", expected "${row.body}"`);
    const want = ctaList(row.cta);
    if (!sameSet(read.ctas, want)) problems.push(`card "${row.card}": CTAs [${read.ctas.join(', ')}], expected [${want.join(', ')}]`);
  }
  await attachJson(this, 'empty-dashboard-cards', seen);
  expect(problems, problems.join('\n')).toEqual([]);
});

// ==================== Listings ====================

Then('the Agent Portal empty states should read:', TABLE, async function (dataTable) {
  const problems = [];
  const evidence = [];
  for (const row of dataTable.hashes()) {
    try {
      const got = await driveRow(this, row);
      evidence.push({ row, ...got, url: this.page.url() });
      problems.push(...compareRow(row, got));
    } catch (e) {
      problems.push(`${row.page}: could not drive the row - ${e.message.split('\n')[0]}`);
    }
  }
  await attachJson(this, 'empty-states', evidence);
  expect(problems, `${problems.length} empty-state mismatch(es):\n${problems.join('\n')}`).toEqual([]);
});

Then('no empty-state listing should render a single row:', TABLE, async function (dataTable) {
  // Guards the premise every other step rests on: the fixture really holds nothing. If a
  // candidate or document ever reaches this account, the tab-level wordings stop being
  // reachable and the scenarios would report a wording "defect" for what is a spent fixture.
  const problems = [];
  for (const { page } of dataTable.hashes()) {
    await es(this).open(page);
    await this.page.waitForTimeout(3000);
    const n = await es(this).rowCount();
    if (n > 0) problems.push(`${page}: ${n} row(s) listed - ${EMAIL} is no longer an empty account`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('clearing each empty-state query should restore the default empty state:', TABLE, async function (dataTable) {
  // Covers the two ways out of a no-results state. "Clear all filters" must drop the filter
  // (URL, badge AND message), and emptying the search box must bring the tab-level copy back -
  // a stale "No results found" over a cleared query tells the agent their query is still on.
  // EVERY expected message comes from the table: the query state on the way in AND the default
  // state on the way out, so both can be checked by eye on the page the row names.
  const problems = [];
  const evidence = [];
  for (const row of dataTable.hashes()) {
    const p = es(this);
    const where = `${row.page} via ${row.via}`;
    try {
      await p.open(row.page);
      if (row.query === 'first option') await p.applyFirstFilter(row.page);
      else await p.search(row.query);
      const mid = await p.waitForEmptyState(row['query heading'], 20000, row['query body']);
      problems.push(...compareRow({ ...row, heading: row['query heading'], body: row['query body'], cta: row['query cta'], filter: '-', search: '-' }, { read: mid, badge: null })
        .map((m) => `${where} (before clearing): ${m.replace(/^[^:]*: /, '')}`));
      if (row.via === 'Clear all filters') await p.clickCta('Clear all filters');
      else await p.clearSearch();
      const read = await p.waitForEmptyState(row.heading, 20000, row.body);
      const badge = await p.filtersBadge(row.page);
      evidence.push({ row, mid, read, badge, url: this.page.url() });
      problems.push(...compareRow({ ...row, filter: '-', search: '-' }, { read, badge: null })
        .map((m) => `${where} (after clearing): ${m.replace(/^[^:]*: /, '')}`));
      if (badge !== 'Filters') problems.push(`${where}: Filters badge "${badge}" after clearing, expected "Filters"`);
      const params = new URL(this.page.url()).searchParams;
      if (params.get('search')) problems.push(`${where}: URL still carries search=${params.get('search')}`);
    } catch (e) {
      problems.push(`${where}: could not drive the row - ${e.message.split('\n')[0]}`);
    }
  }
  await attachJson(this, 'empty-states-cleared', evidence);
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('a reload of each empty-state query should restore the same empty state:', TABLE, async function (dataTable) {
  const problems = [];
  for (const row of dataTable.hashes()) {
    const p = es(this);
    const where = `${row.page} + search "${row.search}" + filter`;
    try {
      await p.open(row.page);
      await p.applyFirstFilter(row.page);
      await p.search(row.search);
      await p.waitForEmptyState(row.heading, 20000, row.body);
      const before = this.page.url();
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      const read = await p.waitForEmptyState(row.heading, 20000, row.body);
      if (this.page.url() !== before) problems.push(`${where}: URL changed on reload ${before} -> ${this.page.url()}`);
      if (read.heading !== row.heading || read.body !== row.body) {
        problems.push(`${where}: after reload "${read.heading}" / "${read.body}", expected "${row.heading}" / "${row.body}"`);
      }
      const value = await p.searchInput().inputValue();
      if (value !== row.search) problems.push(`${where}: search box holds "${value}" after reload`);
    } catch (e) {
      problems.push(`${where}: could not drive the row - ${e.message.split('\n')[0]}`);
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// ==================== Activity Log ====================

When('I open the empty agent\'s Activity Log with the {string} range', { timeout: 60000 }, async function (label) {
  await es(this).open('Activity Log');
  await es(this).selectActivityRange(label);
});

When('I clear the Activity Log empty state {string} with {string}', { timeout: 60000 }, async function (heading, label) {
  const read = await es(this).waitForEmptyState(heading);
  expect(read.heading, `the Activity Log shows "${read.heading} / ${read.body}"`).toBe(heading);
  await es(this).clickCta(label);
});

Then('the Activity Log should list entries or show the empty state {string} \\/ {string}', { timeout: 60000 }, async function (heading, body) {
  // The default range (Last 7 days) holds the superadmin-impersonation entries on this account
  // until they age out, so whether it is EMPTY depends on the calendar. Either branch is
  // asserted: entries render, OR the page shows exactly the Activity Log's own "nothing here"
  // message from the feature - never "No results found", which would blame a query nobody made.
  const p = es(this);
  await this.page.waitForTimeout(4000);
  const rows = await p.rowCount();
  const read = await p.readEmptyState();
  await attachJson(this, 'activity-log-default', { rows, read, url: this.page.url() });
  if (rows > 0) return;
  expect(`${read.heading} / ${read.body}`, 'the default Activity Log is empty and shows the wrong message').toBe(`${heading} / ${body}`);
});

Then('the Activity Log range should be back to {string}', async function (label) {
  await expect.poll(() => new URL(this.page.url()).searchParams.get('duration'), { timeout: 15000 })
    .toBe(label.toLowerCase().replace(/ /g, '_'));
});

// ==================== Every filter option ====================

Then('every filter option on each listing should show the filters empty state:', { timeout: 900000 }, async function (dataTable) {
  // The "filter only" scenario applies the FIRST option. On an empty account every option ought
  // to narrow to the same message, but that is an inference until each one is driven - a single
  // option wired to a different empty state, or failing to apply at all, would hide behind it.
  // The expected heading, body, CTA and badge for each page come from the table.
  const problems = [];
  const evidence = [];
  for (const row of dataTable.hashes()) {
    const { page } = row;
    const p = es(this);
    await p.open(page);
    const labels = await p.filterOptionLabels(page);
    if (labels.length === 0) problems.push(`${page}: the Filters modal offered no options`);
    for (let i = 0; i < labels.length; i++) {
      const where = `${page} > filter option #${i + 1} "${labels[i]}"`;
      try {
        await p.open(page);
        await p.applyFilterOption(page, i);
        const read = await p.waitForEmptyState(row.heading, 20000, row.body);
        const badge = await p.filtersBadge(page);
        evidence.push({ page, option: labels[i], read, badge, url: this.page.url() });
        if (read.heading !== row.heading || read.body !== row.body) problems.push(`${where}: "${read.heading}" / "${read.body}", expected "${row.heading}" / "${row.body}"`);
        const want = ctaList(row.cta);
        if (!sameSet(read.ctas, want)) problems.push(`${where}: CTAs [${read.ctas.join(', ')}], expected [${want.join(', ')}]`);
        if (badge !== row.badge) problems.push(`${where}: badge "${badge}", expected "${row.badge}"`);
      } catch (e) {
        problems.push(`${where}: could not drive it - ${e.message.split('\n')[0]}`);
      }
    }
  }
  await attachJson(this, 'empty-states-every-filter-option', evidence);
  expect(problems, `${problems.length} filter option(s) wrong:\n${problems.join('\n')}`).toEqual([]);
});

// ==================== Dashboard periods ====================

Then('every dashboard period should show zero figures:', TABLE, async function (dataTable) {
  // Reuses DashboardPage.choosePeriod(), which waits for THAT period's stats response before
  // reading - a band read straight after the click still shows the previous period.
  const dash = this.pages.dashboard;
  const problems = [];
  const evidence = [];
  for (const { period } of dataTable.hashes()) {
    await dash.choosePeriod(period);
    const k = await dash.readKpis();
    evidence.push({ period, shown: k.period, total: k.total, tiles: k.tiles.map((t) => [t.label, t.valueRaw]) });
    if (k.period !== period) problems.push(`${period}: the selector reads "${k.period}"`);
    if (k.total.value !== 0) problems.push(`${period}: Total Candidates reads "${k.total.valueRaw}"`);
    for (const t of k.tiles) if (t.value !== 0) problems.push(`${period}: ${t.label} reads "${t.valueRaw}"`);
  }
  await attachJson(this, 'empty-dashboard-periods', evidence);
  expect(problems, problems.join('\n')).toEqual([]);
});

// ==================== A candidate who has done nothing ====================

Given('I am logged in as the empty-profile agent', { timeout: 150000 }, async function () {
  if (!PROFILE_AGENT_EMAIL || !PROFILE_AGENT_PASSWORD || !PROFILE_CANDIDATE_ID) {
    throw new Error('Missing EMPTY_PROFILE_AGENT_EMAIL / _PASSWORD / EMPTY_PROFILE_CANDIDATE_ID in .env - run `node scripts/provision-empty-profile-candidate.js` (it resumes from whatever .env already holds).');
  }
  await es(this).suppressWelcomeModal();
  await resilientSignIn(this, PROFILE_AGENT_EMAIL, PROFILE_AGENT_PASSWORD, { landedOn: /\/dashboard|\/candidates|\/getting-started/ });
  es(this).relogin = () => resilientSignIn(this, PROFILE_AGENT_EMAIL, PROFILE_AGENT_PASSWORD, { landedOn: /\/dashboard|\/candidates|\/getting-started/ });
});

When('I open the empty candidate\'s profile on the {string} tab', { timeout: 60000 }, async function (tab) {
  await es(this).openProfile(PROFILE_CANDIDATE_ID, tab);
});

Then('the empty candidate\'s profile should read:', TABLE, async function (dataTable) {
  // Each row: the section/panel label, then the exact lines that follow its LAST occurrence.
  // Lines are compared exactly - a placeholder ("-") and a statistic's em dash ("—") mean
  // different things on this screen, so no normalisation is applied to either side.
  const problems = [];
  const evidence = [];
  for (const row of dataTable.hashes()) {
    const want = row.lines.split(' / ').map((l) => l.trim());
    const got = await es(this).linesAfter(row.after, want.length);
    evidence.push({ after: row.after, want, got });
    if (!got) { problems.push(`"${row.after}": the label never rendered`); continue; }
    want.forEach((w, i) => {
      if (got[i] !== w) problems.push(`"${row.after}" line ${i + 1}: "${got[i]}", expected "${w}"`);
    });
  }
  await attachJson(this, 'empty-profile', { candidate: PROFILE_CANDIDATE_EMAIL, rows: evidence });
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('the empty candidate\'s Reminder History should be disabled', async function () {
  // Enablement tracks has_reminders; a candidate nobody has reminded has nothing to open.
  await expect(this.page.locator('main').first().getByRole('button', { name: 'Reminder History' })).toBeDisabled({ timeout: 15000 });
});

Then('the empty candidate\'s Activity Log should list entries or show the empty state {string} \\/ {string}', { timeout: 60000 }, async function (heading, body) {
  // Signing up writes "Candidate Invitation Accepted" and "Email Change Verified" entries, so the
  // default "Last 24 hours" range is populated on the day the fixture is minted and empty from
  // the next day on. Either branch is asserted: entries render, or exactly the expected message.
  const p = es(this);
  await this.page.waitForTimeout(4000);
  const items = await this.page.locator('main .activity-log-item').count();
  const read = await p.readEmptyState();
  await attachJson(this, 'empty-profile-activity-log', { items, read });
  if (items > 0) return;
  expect(`${read.heading} / ${read.body}`, 'the empty candidate\'s Activity Log tab shows the wrong message').toBe(`${heading} / ${body}`);
});

// ==================== Edge cases: what the URL and the input can hold ====================

Then('each empty-state deep link should land on:', TABLE, async function (dataTable) {
  // A URL is a second way into every state: a shared link, a bookmark, a reload. An unknown tab
  // value, an out-of-range page or a whitespace-only search must still land on a sensible empty
  // state - and the URL it settles on is part of that, so a rejected value is not left behind.
  const problems = [];
  const evidence = [];
  const base = String(process.env.BASE_URL).replace(/\/login\/?$/, '');
  for (const row of dataTable.hashes()) {
    await this.page.goto(`${base}${row.link}`, { waitUntil: 'domcontentloaded' });
    const read = await es(this).waitForEmptyState(row.heading);
    const u = new URL(this.page.url());
    const landed = `${u.pathname}${u.search}`;
    evidence.push({ row, read, landed });
    if (read.heading !== row.heading) problems.push(`${row.link}: heading "${read.heading}", expected "${row.heading}"`);
    if (!none(row.lands) && landed !== row.lands) problems.push(`${row.link}: landed on ${landed}, expected ${row.lands}`);
  }
  await attachJson(this, 'empty-state-deep-links', evidence);
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('typing only spaces into each search should keep the default empty state:', TABLE, async function (dataTable) {
  // Not driven through search(), which demands the term reach the URL: a whitespace-only term
  // correctly does NOT, and that absence is half of what is asserted here.
  const problems = [];
  for (const row of dataTable.hashes()) {
    const p = es(this);
    await p.open(row.page);
    await p.settle();
    const input = p.searchInput();
    await input.click();
    await input.pressSequentially('   ', { delay: 30 });
    await this.page.waitForTimeout(3000); // past the debounce: a search would have fired by now
    const read = await p.readEmptyState();
    if (read.heading !== row.heading) problems.push(`${row.page}: "${read.heading}" / "${read.body}" after typing spaces, expected "${row.heading}"`);
    if (p.searchParam()) problems.push(`${row.page}: a whitespace search reached the URL as "${p.searchParam()}"`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('no browser dialog should have opened during the empty-state checks', async function () {
  expect(this._esDialogs || [], `a native dialog opened: ${JSON.stringify(this._esDialogs)}`).toEqual([]);
  const injected = await this.page.evaluate(() => [...document.querySelectorAll('main script')].length);
  expect(injected, 'a search term was rendered as a <script> element').toBe(0);
});

// ==================== The CTA an empty state offers ====================

Then('each empty state\'s Invite Candidates CTA should open the onboarding chooser without sending anything:', TABLE, async function (dataTable) {
  // OPENED AND CLOSED ONLY. Nothing past the chooser is clicked: an invitation would spend the
  // zero-candidate fixture permanently. The POST watch proves the chooser sends nothing itself.
  // Every expected string - the empty state, the chooser title, its two options - is in the table.
  const problems = [];
  for (const row of dataTable.hashes()) {
    const p = es(this);
    const where = `${row.page}${none(row.section) ? '' : ` > ${row.section} card`}`;
    const readState = async () => (none(row.section) ? p.readEmptyState() : p.readDashboardCard(row.section));
    if (row.page === 'Dashboard') await p.openDashboard(); else await p.open(row.page);
    if (none(row.section)) await p.waitForEmptyState(row['empty heading']);
    else await expect.poll(async () => ((await readState()) || {}).heading, { timeout: 20000 }).toBe(row['empty heading']).catch(() => {});
    const before = await readState();
    if (!before || before.heading !== row['empty heading']) {
      problems.push(`${where}: empty state reads "${before && before.heading}", expected "${row['empty heading']}"`);
      continue;
    }
    const posts = [];
    const onReq = (r) => { if (r.method() === 'POST' && /invite/i.test(r.url())) posts.push(r.url()); };
    this.page.on('request', onReq);
    try {
      await this.page.locator('main').first().getByRole('button', { name: 'Invite Candidates', exact: true }).click({ timeout: 30000 });
      const chooser = this.page.locator('[role="dialog"]').filter({ hasText: row['chooser title'] }).last();
      if (!(await chooser.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false))) {
        problems.push(`${where}: the CTA opened no dialog titled "${row['chooser title']}"`);
        continue;
      }
      const text = await chooser.innerText();
      for (const want of row['chooser options'].split(',').map((x) => x.trim())) {
        if (!text.includes(want)) problems.push(`${where}: the chooser does not offer "${want}"`);
      }
      await this.page.keyboard.press('Escape');
      if (!(await chooser.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false))) problems.push(`${where}: Escape did not close the chooser`);
    } finally {
      this.page.off('request', onReq);
    }
    if (posts.length) problems.push(`${where}: opening the chooser sent an invitation request: ${posts.join(', ')}`);
    const after = await readState();
    if (!after || after.heading !== row['empty heading']) problems.push(`${where}: the empty state did not survive opening and closing the chooser ("${after && after.heading}")`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// ==================== Mocked: states today's data cannot show ====================
//
// @mocked, like the promo module's preview stub. Both agents genuinely HOLD a notification and
// activity entries, so the empty bell and the Activity Log's own "nothing here" wording are only
// observable by answering the app's request with an empty page. Everything else is real.

const EMPTY_PAGE = JSON.stringify({ count: 0, next: null, previous: null, results: [] });

Given('the {string} request returns nothing', async function (what) {
  const re = {
    notifications: /\/notifications\/(\?|$)/,
    'agent activity log': /\/analytics\/agents\/activity-logs\//,
    'candidate activity log': /\/analytics\/candidates\/activity-logs\//,
  }[what];
  if (!re) throw new Error(`No stub for "${what}"`);
  await this.page.route((u) => re.test(u.toString()), (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_PAGE })
    : r.continue()));
});

When('I open the notifications bell', { timeout: 60000 }, async function () {
  await es(this).openDashboard();
  await this.page.getByRole('button', { name: 'Notifications' }).first().click({ timeout: 30000 });
});

Then('the notifications bell should read {string} and offer only {string}', { timeout: 30000 }, async function (message, link) {
  const panel = this.page.locator('[role="dialog"]').filter({ hasText: 'Notifications' }).last();
  await expect(panel.getByText(message, { exact: true }), `the bell does not say "${message}"`).toBeVisible({ timeout: 15000 });
  const controls = await panel.locator('a, button').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()).filter(Boolean));
  await attachJson(this, 'empty-bell', { controls, text: await panel.innerText() });
  expect(controls, `the empty bell offers ${JSON.stringify(controls)}`).toEqual([link]);
});

// ==================== Rule 2: a listing that is NOT empty, with empty tabs ====================

Then('the empty-profile agent\'s In Progress tabs should read:', TABLE, async function (dataTable) {
  // The opposite edge from Rule 1: an agent who HAS a candidate. A tab that holds nobody must
  // still show its own empty state, and a tab that holds the candidate must show the row and no
  // empty state at all - two messages for one list would be its own defect.
  const problems = [];
  for (const row of dataTable.hashes()) {
    const p = es(this);
    await p.open('In Progress');
    if (row.tab !== 'All') await p.selectTab('In Progress', row.tab);
    const want = Number(row.rows);
    if (want > 0) {
      await expect.poll(() => p.rowCount(), { timeout: 20000 }).toBe(want).catch(() => {});
      const n = await p.rowCount();
      const read = await p.readEmptyState();
      if (n !== want) problems.push(`In Progress > ${row.tab}: ${n} row(s), expected ${want}`);
      if (read.heading) problems.push(`In Progress > ${row.tab}: shows "${read.heading}" beside its ${n} row(s)`);
      const text = await this.page.locator('main').first().innerText();
      if (!text.includes(PROFILE_CANDIDATE_EMAIL)) problems.push(`In Progress > ${row.tab}: the candidate ${PROFILE_CANDIDATE_EMAIL} is not listed`);
    } else {
      const read = await p.waitForEmptyState(row.heading);
      if (read.heading !== row.heading) problems.push(`In Progress > ${row.tab}: "${read.heading}", expected "${row.heading}"`);
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('clicking through the empty candidate\'s profile tabs each should read:', TABLE, async function (dataTable) {
  // End to end by CLICKING each tab (the other scenarios open a tab by its URL), so the tab strip
  // itself is part of what is proven.
  const problems = [];
  await es(this).openProfile(PROFILE_CANDIDATE_ID, 'candidate-details');
  for (const row of dataTable.hashes()) {
    await this.page.getByRole('radio', { name: row.tab, exact: true }).click();
    const want = row.lines.split(' / ').map((l) => l.trim());
    const got = await es(this).linesAfter(row.after, want.length);
    want.forEach((w, i) => {
      if (!got || got[i] !== w) problems.push(`${row.tab} > "${row.after}" line ${i + 1}: "${got && got[i]}", expected "${w}"`);
    });
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// ==================== End to end: moving through the portal by clicking ====================
//
// The table steps above open each page by URL so every row starts clean. These act on whatever
// page is CURRENTLY open, so a journey can be written the way an agent moves: sidebar, search,
// filter, the empty state's own CTA, back again.

const SIDEBAR_LINK = {
  Dashboard: 'Dashboard',
  'Active Candidates': 'Active',
  'In Progress': 'In Progress',
  Deactivated: 'Deactivated',
  'Requires Attention': 'Requires Attention',
  Verifications: 'Verifications',
  'Activity Log': 'Activity Log',
};
const CANDIDATE_PAGES = ['Active Candidates', 'In Progress', 'Deactivated', 'Requires Attention'];

When('I follow the sidebar to {string}', { timeout: 60000 }, async function (name) {
  const label = SIDEBAR_LINK[name];
  if (!label) throw new Error(`No sidebar entry for "${name}". Known: ${Object.keys(SIDEBAR_LINK).join(', ')}`);
  const link = this.page.locator(`a[href^="/"]`).filter({ hasText: new RegExp(`^${label}$`) }).first();
  // The four candidate listings sit under a collapsible "Candidates" group (a button, not a link).
  if (CANDIDATE_PAGES.includes(name) && !(await link.isVisible().catch(() => false))) {
    await this.page.getByRole('button', { name: /^Candidates/ }).first().click();
  }
  await link.click();
  if (name !== 'Dashboard') {
    const { path } = es(this).spec(name);
    await this.page.waitForURL((u) => u.pathname.startsWith(path), { timeout: 30000 });
  }
});

Then('the current page should show the empty state {string}', { timeout: 30000 }, async function (heading) {
  const read = await es(this).waitForEmptyState(heading);
  expect(read.heading, `the page shows "${read.heading} / ${read.body}"`).toBe(heading);
});

Then('the current empty state should read {string} \\/ {string} offering {string}', { timeout: 30000 }, async function (heading, body, cta) {
  const read = await es(this).waitForEmptyState(heading, 20000, body);
  expect(`${read.heading} / ${read.body}`, 'the current page shows the wrong empty state').toBe(`${heading} / ${body}`);
  expect(read.ctas, `CTAs offered: ${JSON.stringify(read.ctas)}`).toEqual(ctaList(cta));
});

When('I search the current page for {string}', { timeout: 60000 }, async function (term) {
  await es(this).search(term);
});

When('I apply the first filter on the current {string} page', { timeout: 60000 }, async function (name) {
  await es(this).applyFirstFilter(name);
});

When('I clear the current search', { timeout: 30000 }, async function () {
  await es(this).clearSearch();
});

When('I click the empty state\'s {string}', { timeout: 30000 }, async function (label) {
  await es(this).clickCta(label);
});
