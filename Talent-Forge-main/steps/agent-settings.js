// Agent Portal > Account Settings and the header notifications panel.
// Feature: features/Agent_Portal/account-settings-notifications.feature
// Page object: pages/AgentSettingsPage.js (this.pages.agentSettings)
//
// Every expectation is read from the payload the app fetched (GET /auth/settings/,
// GET /notifications/) - nothing about the fixture agent is written into the feature file.
// Multi-case steps collect every problem and throw once: a scenario stops at its first failing
// step, so reporting only the first case would hide whether the rest share a cause.
const { Then, When } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');

const STEP = 90000;
const TABLE = 240000;
const s = (world) => world.pages.agentSettings;
const notes = (world) => {
  if (!world._agentSettings) world._agentSettings = {};
  return world._agentSettings;
};

async function record(world, title, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await world.attach(`${title}\n${body}`, 'text/plain');
}

// An unset field is rendered as a placeholder; which one has not been specified, so either is accepted.
const isPlaceholder = (v) => v === undefined || v === '' || v === '-' || v === '—';
const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function generalProblems(rendered, payload) {
  const map = [
    ['First Name', 'firstname'],
    ['Last Name', 'lastname'],
    ['Email', 'email'],
    ['Phone Number', 'phone_number'],
    ['Nationality', 'nationality'],
  ];
  const problems = [];
  for (const [label, field] of map) {
    const stored = payload[field];
    const shown = rendered[label];
    if (stored === null || stored === undefined || stored === '') {
      if (!isPlaceholder(shown)) problems.push(`${label}: nothing is stored (${field}=${JSON.stringify(stored)}) but the page shows "${shown}"`);
    } else if (norm(shown) !== norm(stored)) {
      problems.push(`${label}: the server holds "${stored}" (${field}) but the page shows "${shown}"`);
    }
  }
  return problems;
}

// ============================== SECTION 1 - Account Settings ==============================

When('I open Account Settings', { timeout: STEP }, async function () {
  notes(this).mark = s(this).mark();
  const payload = await s(this).open();
  expect(payload, 'GET /auth/settings/ was never answered, so there is nothing to compare the page against').toBeTruthy();
  notes(this).payload = payload;
});

Then('the Account Settings tabs should be exactly {string}', async function (csv) {
  const want = csv.split(',').map((t) => t.trim());
  const got = await s(this).tabLabels();
  await record(this, 'Account Settings tabs', got);
  expect(got).toEqual(want);
});

Then('the {string} Account Settings tab should be selected', async function (name) {
  await expect.poll(() => s(this).selectedTab(), { timeout: 10000 }).toBe(name);
});

When('I choose the {string} Account Settings tab', { timeout: STEP }, async function (name) {
  await s(this).selectTab(name);
});

When('I choose each Account Settings tab in turn', { timeout: STEP }, async function () {
  const seen = [];
  for (const name of await s(this).tabLabels()) {
    /* eslint-disable no-await-in-loop */
    await s(this).selectTab(name);
    seen.push({ name, selected: await s(this).selectedTab(), path: new URL(this.page.url()).pathname, text: await s(this).mainText() });
    /* eslint-enable no-await-in-loop */
  }
  notes(this).tabWalk = seen;
});

Then('each Account Settings tab should render its own sections and the URL should stay on settings', async function () {
  const want = {
    General: ['Basic Information', 'Account Preferences'],
    Notifications: ['Email notifications'],
    Security: ['Password', 'Two-Factor Authentication'],
  };
  const problems = [];
  for (const t of notes(this).tabWalk || []) {
    if (t.selected !== t.name) problems.push(`${t.name}: choosing it left "${t.selected}" selected`);
    if (t.path !== '/settings') problems.push(`${t.name}: the route changed to ${t.path}`);
    for (const section of want[t.name] || []) {
      if (!t.text.includes(section)) problems.push(`${t.name}: does not render "${section}"`);
    }
    // A section belonging to ANOTHER tab bleeding through is as wrong as a missing one.
    for (const [other, sections] of Object.entries(want)) {
      if (other === t.name) continue;
      for (const section of sections) {
        if (section === 'Password' || section === 'Email notifications') continue; // also substrings elsewhere
        if (t.text.includes(section)) problems.push(`${t.name}: also renders "${section}", which belongs to ${other}`);
      }
    }
  }
  await record(this, 'tab walk', (notes(this).tabWalk || []).map(({ text, ...rest }) => rest));
  expect(problems, problems.join('\n')).toEqual([]);
});

Then("the General tab should show the agent's stored first name, last name, email, phone and nationality", { timeout: STEP }, async function () {
  const payload = (await s(this).settingsPayload()) || notes(this).payload;
  const rendered = await s(this).readGeneral();
  await record(this, 'General tab vs GET /auth/settings/', { rendered, stored: payload });
  const problems = generalProblems(rendered, payload);
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('the email notifications switch should match the stored preference', async function () {
  const payload = notes(this).payload;
  const sw = s(this).emailSwitch();
  await sw.waitFor({ state: 'attached', timeout: 10000 });
  const checked = await sw.isChecked();
  await record(this, 'email notifications', { rendered: checked, stored: payload.email_notifications_enabled });
  expect(checked).toBe(Boolean(payload.email_notifications_enabled));
});

Then('the Security tab should reflect the stored two-factor state and password date', async function () {
  const payload = notes(this).payload;
  const problems = [];
  const sw = s(this).twoFactorSwitch();
  const checked = (await sw.count()) ? await sw.isChecked() : null;
  if (checked !== Boolean(payload.two_factor_enabled)) {
    problems.push(`two-factor switch reads ${checked} but the server holds two_factor_enabled=${payload.two_factor_enabled}`);
  }
  const text = await s(this).mainText();
  if (payload.password_updated_at) {
    // The UTC day and the browser-local day can differ; either is a correct rendering of the stored instant.
    const d = new Date(payload.password_updated_at);
    const fmt = (tz) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz });
    const candidates = [...new Set([fmt('UTC'), fmt(undefined), fmt('Asia/Riyadh')])];
    if (!candidates.some((c) => text.includes(`Last updated ${c}`))) {
      problems.push(`password_updated_at is ${payload.password_updated_at}; expected "Last updated <${candidates.join(' | ')}>" in: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  await record(this, 'Security tab vs server', { twoFactor: { rendered: checked, stored: payload.two_factor_enabled }, password_updated_at: payload.password_updated_at });
  expect(problems, problems.join('\n')).toEqual([]);
});

When('I open the {string} Account Settings edit modal', { timeout: STEP }, async function (which) {
  if (!notes(this).mark) notes(this).mark = s(this).mark();
  await s(this).openEdit(which);
});

Then("the Basic Information modal should hold the agent's stored values", async function () {
  const p = notes(this).payload;
  const m = await s(this).readBasicModal();
  await record(this, 'Basic Information modal vs server', { modal: m, stored: p });
  const problems = [];
  const pairs = [['firstName', 'firstname'], ['lastName', 'lastname'], ['email', 'email'], ['phone', 'phone_number'], ['nationality', 'nationality']];
  for (const [k, f] of pairs) {
    const stored = p[f] == null ? '' : p[f];
    if (norm(m[k]) !== norm(stored)) problems.push(`${k}: the modal holds "${m[k]}" but the server holds "${stored}" (${f})`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('the Basic Information modal should lock the email and start with Save disabled', async function () {
  const m = await s(this).readBasicModal();
  expect(m.emailDisabled, 'the email field is editable here').toBe(true);
  expect(m.saveDisabled, 'Save is enabled on a modal nobody has changed').toBe(true);
  await s(this).closeDialogBy('Cancel');
});

Then('the Basic Information modal should behave as follows on each close route:', { timeout: TABLE }, async function (table) {
  const page = s(this);
  const p = notes(this).payload;
  const problems = [];
  const trace = [];
  /* eslint-disable no-await-in-loop */
  for (const { route } of table.hashes()) {
    await page.openEdit('basic');
    const opened = await page.readBasicModal();
    // A change derived from the stored value, so it is always a real change whatever the name is.
    await page.typeInto('firstName', `${p.firstname || 'Agent'}x`);
    const afterEdit = await page.saveButton().isDisabled();
    await page.typeInto('firstName', '');
    const afterClear = await page.saveButton().isDisabled();
    await page.closeDialogBy(route);
    const closed = await page.dialogStaysClosed();
    trace.push({ route, saveOnOpen: !opened.saveDisabled, saveAfterValidEdit: !afterEdit, saveAfterClearingRequired: !afterClear, closed });
    if (!opened.saveDisabled) problems.push(`[${route}] Save is enabled before anything changed`);
    if (afterEdit) problems.push(`[${route}] Save stayed disabled after a valid change to First Name`);
    if (!afterClear) problems.push(`[${route}] Save is enabled with the required First Name empty`);
    if (!closed) problems.push(`[${route}] the modal did not close`);
  }
  /* eslint-enable no-await-in-loop */
  await record(this, 'Basic Information gating per close route', trace);
  expect(problems, problems.join('\n')).toEqual([]);
});

Then('no Account Settings change should have been sent to the server', async function () {
  const writes = s(this).writesSince(notes(this).mark || { writes: 0 });
  await record(this, 'writes since Account Settings opened', writes);
  expect(writes, `the page wrote although nothing was saved: ${JSON.stringify(writes)}`).toEqual([]);
});

When('I note the time zone Account Settings shows', async function () {
  const g = await s(this).readGeneral();
  notes(this).timeZone = g['Time Zone'];
  expect(notes(this).timeZone, 'the General tab shows no Time Zone').toBeTruthy();
});

// RED today (measured 2026-10-14): the page shows "Arabia Standard Time (GMT+3 - Riyadh)" while the
// modal's control opens on the FIRST of 418 zones ("Acre Standard Time (GMT-5 - Eirunepe)"), and
// GET /auth/settings/ carries no time-zone field at all. So saving the modal untouched would change
// the agent's zone, and it is unclear where the displayed zone is stored. Question for the PO / dev.
Then('the Account Preferences modal should preselect the noted time zone', async function () {
  const m = await s(this).readPrefsModal();
  const payload = notes(this).payload;
  await record(this, 'Account Preferences modal', {
    pageShows: notes(this).timeZone,
    modal: m,
    serverHasTimeZoneField: Object.keys(payload).some((k) => /zone|tz/i.test(k)),
  });
  await s(this).closeDialogBy('Escape');
  expect(norm(m.selectedText), `the page shows "${notes(this).timeZone}" but the modal opens on "${m.selectedText}" (${m.value})`)
    .toBe(norm(notes(this).timeZone));
});

// ============================== SECTION 2 - the notifications panel ==============================

When('I open the notifications panel', { timeout: STEP }, async function () {
  notes(this).bellMark = await s(this).openBell();
});

Then("the notifications panel tabs should each render the server's list:", { timeout: TABLE }, async function (table) {
  const page = s(this);
  const problems = [];
  const trace = [];
  /* eslint-disable no-await-in-loop */
  for (const row of table.hashes()) {
    const unreadOnly = /unread/i.test(row.filter);
    const pred = (r) => (r.query.get('is_read') === 'false') === unreadOnly && (r.query.get('page') || '1') === '1';
    const before = page.mark();
    await page.bellTab(row.tab).click();
    // The panel prefetches both lists, so a tab may legitimately re-render one it already holds.
    const resp = (await page.waitFor('notifications', pred, before.responses, 8000)) || (await page.latest('notifications', pred));
    if (!resp) { problems.push(`[${row.tab}] no ${row.filter} notifications request was ever made`); continue; }
    const want = resp.body.results.map((n) => norm(n.title));
    const items = await page.settleItems(want.length);
    const got = items.map((i) => norm(i.title));
    trace.push({ tab: row.tab, query: resp.query.toString(), serverCount: resp.body.count, want, got });
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`[${row.tab}] renders ${JSON.stringify(got)} but the ${row.filter} request returned ${JSON.stringify(want)}`);
    }
    if (unreadOnly) {
      const readOnes = items.filter((i) => !i.hasMarkAsRead).length;
      if (readOnes) problems.push(`[${row.tab}] ${readOnes} listed item(s) offer no "Mark as read", i.e. are already read`);
      const label = await page.unreadLabelCount();
      if (label !== resp.body.count) problems.push(`[${row.tab}] the tab label says ${label} but the server counts ${resp.body.count} unread`);
    }
  }
  /* eslint-enable no-await-in-loop */
  await record(this, 'notifications tabs vs server', trace);
  expect(problems, problems.join('\n')).toEqual([]);
});

When('I load more notifications', { timeout: STEP }, async function () {
  const page = s(this);
  const first = await page.latest('notifications', (r) => !r.query.get('is_read') && (r.query.get('page') || '1') === '1');
  notes(this).firstPage = first && first.body;
  notes(this).beforeLoad = await page.settleItems(first ? first.body.results.length : 10);
  notes(this).loadMark = page.mark();
  await page.panel.getByRole('button', { name: /load more/i }).click();
});

Then('the notifications panel should request the next page and append exactly what it returned', { timeout: STEP }, async function () {
  const page = s(this);
  const resp = await page.waitFor('notifications', (r) => r.query.get('page') === '2', notes(this).loadMark.responses, 20000);
  expect(resp, 'Load more requested no page=2').toBeTruthy();
  const before = notes(this).beforeLoad.map((i) => norm(i.title));
  const added = resp.body.results.map((n) => norm(n.title));
  const items = (await page.settleItems(before.length + added.length)).map((i) => norm(i.title));
  await record(this, 'Load more', { query: resp.query.toString(), before: before.length, added, after: items.length });
  expect(items.slice(0, before.length), 'the first page changed when more was loaded').toEqual(before);
  expect(items.slice(before.length), 'what was appended is not what page 2 returned').toEqual(added);
});

When('I follow Go To Settings from the notifications panel', { timeout: STEP }, async function () {
  await s(this).panel.getByRole('link', { name: /go to settings/i }).click();
  await this.page.waitForURL(/\/settings/, { timeout: 20000 });
});

Then('I should be on Account Settings with the {string} tab selected', async function (name) {
  expect(new URL(this.page.url()).pathname).toBe('/settings');
  await expect.poll(() => s(this).selectedTab(), { timeout: 15000 }).toBe(name);
});

Then('the notifications panel should be closed', async function () {
  await expect(this.page.locator('[role="dialog"]:visible').filter({ hasText: /Mark All As Read/i })).toHaveCount(0, { timeout: 10000 });
});

Then('the notifications panel should close on each route without marking anything read:', { timeout: TABLE }, async function (table) {
  const page = s(this);
  const problems = [];
  /* eslint-disable no-await-in-loop */
  for (const [i, { route }] of table.hashes().entries()) {
    if (i > 0) await page.openBell();
    const m = page.mark();
    if (route === 'Escape') await this.page.keyboard.press('Escape');
    else if (route === 'close control') await page.panel.getByRole('button', { name: /close notifications/i }).click();
    else throw new Error(`unknown route "${route}"`);
    const gone = await this.page.locator('[role="dialog"]:visible').filter({ hasText: /Mark All As Read/i }).count() === 0
      || await this.page.locator('[role="dialog"]:visible').filter({ hasText: /Mark All As Read/i }).first()
        .waitFor({ state: 'hidden', timeout: 8000 }).then(() => true).catch(() => false);
    const writes = page.writesSince(m);
    if (!gone) problems.push(`[${route}] the panel did not close`);
    if (writes.length) problems.push(`[${route}] closing the panel wrote to the server: ${JSON.stringify(writes)}`);
  }
  /* eslint-enable no-await-in-loop */
  expect(problems, problems.join('\n')).toEqual([]);
});

// RECORDED, NOT FAILED ON. Measured 2026-10-14: AGENT_EMAIL is also a candidate (auth/me
// available_roles CANDIDATE + AGENT) and its AGENT-role bell lists candidate-facing items ("Your
// subscription has expired", "Your agent reminded you ..."). Whether the bell should filter by the
// active role is a product question, so the payload's audience-ish fields are attached for the PO.
Then('the audience of the listed notifications should be reported for the PO', async function () {
  const resp = await s(this).latest('notifications');
  expect(resp, 'no notifications payload was captured').toBeTruthy();
  const results = resp.body.results || [];
  const keys = [...new Set(results.flatMap((n) => Object.keys(n)))];
  const audienceKeys = keys.filter((k) => /audience|role|recipient|type|category/i.test(k));
  const summary = results.map((n) => Object.fromEntries([['title', n.title], ...audienceKeys.map((k) => [k, n[k]])]));
  await record(this, 'notification audience (for the PO - the agent bell lists candidate-facing items)', { keys, audienceKeys, summary });
  expect(results.length, 'the panel listed no notifications to report on').toBeGreaterThan(0);
});

When("I note the server's unread notification count", async function () {
  const r = await s(this).latest('notifications', (x) => x.query.get('is_read') === 'false');
  expect(r, 'no unread request was captured').toBeTruthy();
  notes(this).unreadBefore = r.body.count;
  expect(notes(this).unreadBefore, 'there is no unread notification to mark').toBeGreaterThan(0);
});

When('I mark the first unread notification as read', { timeout: STEP }, async function () {
  const page = s(this);
  await page.bellTab('Unread').click();
  await page.panel.getByRole('button', { name: /^Mark as read$/i }).first().waitFor({ state: 'visible', timeout: 15000 });
  notes(this).markMark = page.mark();
  await page.panel.getByRole('button', { name: /^Mark as read$/i }).first().click();
  await expect.poll(() => page.writesSince(notes(this).markMark).length, { message: 'Mark as read sent nothing', timeout: 15000 }).toBeGreaterThan(0);
});

Then("the server's unread notification count should be one lower", { timeout: STEP }, async function () {
  const page = s(this);
  const want = notes(this).unreadBefore - 1;
  // Re-ask the server through the UI: reopen the panel, which refetches the unread list.
  await this.page.keyboard.press('Escape');
  const m = await page.openBell();
  const r = await page.waitFor('notifications', (x) => x.query.get('is_read') === 'false', m.responses, 20000);
  await record(this, 'unread count', { before: notes(this).unreadBefore, after: r && r.body.count, writes: page.writesSince(notes(this).markMark) });
  expect(r && r.body.count).toBe(want);
  notes(this).unreadAfter = r.body.count;
});

Then('the Unread tab label should show the new count', async function () {
  await expect.poll(() => s(this).unreadLabelCount(), { timeout: 10000 }).toBe(notes(this).unreadAfter);
});
