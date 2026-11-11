const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const {
  listing, profile, clean, lc, fail, recorder, mark, markWrites, waitFor, rawAgents, toSubject,
  loadTab, viewFromTab, dismiss, toastsWithin,
} = require('./agent-view-profile');
const { waitForProfileCandidates } = require('./agent-reassign');

// Step definitions for Agent-Listing-Values-And-Reassign.feature - what the 2026-10-22 A-to-Z
// audit of the Agents page found uncovered (scripts/probe-agents-page-inventory.js). The recorder
// and helpers are steps/agent-view-profile.js's, so both files read one log. Measured:
//   cells    Active: Status reads "Active" for ACTIVE and ATTENTION alike, Total Candidates =
//            total_candidate_count, Monthly Target Progress = monthly_progress.percentage + "%";
//            Requires Attention: Issue / Severity = attention_details, Last Activity = the date of
//            last_login; Deactivated: Transferred Candidates to = transferred_candidates_to name +
//            email, or "—" twice when null
//   filters  the same modal on every tab; the request carries the tab's status AND the filter
//   profile  Candidates tab rows carry "Select candidate" checkboxes (+ "Select all candidates on
//            this page"); a selection shows "N of M selected." with "Reassign candidates" and
//            "Clear selection", and fires nothing. Reassign Candidate: university locked, New
//            Agent combobox -> GET /agent/?university=<id>&status=ACTIVE&status=ATTENTION[&search=],
//            never the source agent, Reassign disabled until one is chosen

// The date the app renders for an ISO timestamp, computed IN THE PAGE so the browser's own
// timezone decides the calendar day, exactly as the app's render does.
async function renderedDate(world, iso) {
  return world.page.evaluate((v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), iso);
}

// ==================== Listing values ====================

Then("every row on the first page of each tab should show the server's values:", { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { tab } of table.hashes()) {
    const result = await loadTab(this, tab);
    const agents = rawAgents(result);
    if (!agents.length) { problems.push(`${tab}: the server listed no agents, nothing to compare`); continue; }
    const rows = await listing(this).readRows();
    let compared = 0;
    for (const a of agents) {
      const row = rows.find((r) => lc(r.email) === lc(a.email));
      const at = (s) => `${tab} ${a.email}: ${s}`;
      if (!row) { problems.push(at('the server lists this agent, the grid does not')); continue; }
      compared += 1;
      const name = clean(`${a.first_name || ''} ${a.last_name || ''}`);
      if (lc(row.name) !== lc(name)) problems.push(at(`name shows "${row.name}", the server says "${name}"`));
      if (lc(row.cells[0]) !== lc(a.institution_name)) problems.push(at(`university shows "${row.cells[0]}", the server says "${a.institution_name}"`));
      if (tab === 'Active') {
        if (row.cells[1] !== 'Active') problems.push(at(`status shows "${row.cells[1]}" for ${a.status}`));
        if (Number(row.cells[2]) !== Number(a.total_candidate_count)) problems.push(at(`Total Candidates shows ${row.cells[2]}, the server says ${a.total_candidate_count}`));
        const pct = Math.round(Number((a.monthly_progress || {}).percentage || 0));
        if (row.cells[3] !== `${pct}%`) problems.push(at(`progress shows "${row.cells[3]}", the server says ${pct}%`));
      } else if (tab === 'Invite Sent') {
        if (row.cells[1] !== 'Invite Sent') problems.push(at(`status shows "${row.cells[1]}"`));
      } else if (tab === 'Requires Attention') {
        const att = a.attention_details || {};
        if (row.cells[1] !== clean(att.issue)) problems.push(at(`issue shows "${row.cells[1]}", the server says "${att.issue}"`));
        if (row.cells[2] !== clean(att.severity)) problems.push(at(`severity shows "${row.cells[2]}", the server says "${att.severity}"`));
        const want = a.last_login ? await renderedDate(this, a.last_login) : '—';
        if (row.cells[3] !== want) problems.push(at(`Last Activity shows "${row.cells[3]}", last_login ${a.last_login} is ${want}`));
      } else if (tab === 'Deactivated') {
        if (row.cells[1] !== 'Deactivated') problems.push(at(`status shows "${row.cells[1]}"`));
        const t = a.transferred_candidates_to;
        const want = t ? clean(`${t.name} ${t.email}`) : '— —';
        if (clean(row.cells[2]) !== want) problems.push(at(`Transferred Candidates to shows "${row.cells[2]}", the server says "${want}"`));
      }
    }
    if (compared < agents.length) problems.push(`${tab}: only ${compared} of ${agents.length} server rows were rendered`);
    report.push(`${tab}: compared ${compared} rows (count ${result.payload && result.payload.count})`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'An Agents tab does not show the server\'s values:');
});

Given('I have found a deactivated agent whose candidates were transferred', { timeout: 240000 }, async function () {
  recorder(this);
  let pick = null;
  for (let page = 1; page <= 10 && !pick; page += 1) {
    const result = await loadTab(this, 'Deactivated', page > 1 ? `page=${page}` : '');
    pick = rawAgents(result).find((a) => a.transferred_candidates_to);
    if (!result.payload || !result.payload.next) break;
  }
  if (!pick) throw new Error('No deactivated agent on the first 10 pages had its candidates transferred - a missing fixture, not an app defect.');
  this._agent = toSubject(pick);
  this.attach(`Deactivated ${pick.email} transferred to ${JSON.stringify(pick.transferred_candidates_to)}`, 'text/plain');
});

Then("that deactivated agent's row should name the receiving agent the server holds", { timeout: 90000 }, async function () {
  const result = await listing(this).search(this._agent.email, { tab: 'Deactivated' });
  const listed = rawAgents(result).find((a) => lc(a.email) === lc(this._agent.email));
  expect(listed && listed.transferred_candidates_to, 'the server no longer holds a receiver for this agent').toBeTruthy();
  const row = (await listing(this).readRows()).find((r) => lc(r.email) === lc(this._agent.email));
  expect(row, `${this._agent.email} is not rendered on the Deactivated tab`).toBeTruthy();
  const t = listed.transferred_candidates_to;
  expect(clean(row.cells[2]), 'the row does not name the receiving agent').toBe(clean(`${t.name} ${t.email}`));
});

Then("each filter applied on a tab should be sent with that tab's status and honoured:", { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const row of table.hashes()) {
    await loadTab(this, row.tab);
    await listing(this).openFilters();
    await listing(this).selectFilterOption(row.group, row.option);
    const result = await listing(this).applyFilters();
    const at = (s) => `${row.tab} / ${row.group} ${row.option}: ${s}`;
    if (!result.requestFired) { problems.push(at('Apply sent no request')); continue; }
    const url = this.page.url();
    const req = result.requestUrl;
    if (!url.includes(row.url)) problems.push(at(`the URL does not carry ${row.url} (${url})`));
    if (!req.includes(row.api)) problems.push(at(`the request does not carry ${row.api} (${req})`));
    const statuses = new URL(req).searchParams.getAll('status');
    if (statuses.join(',') !== row.status) problems.push(at(`the request asks for status ${statuses.join(',')}, the tab is ${row.status}`));
    const [lo, hi] = row.option.split('-').map(Number);
    const fits = (a) => {
      const n = Number(a.total_candidate_count);
      return (hi === undefined ? n === lo : n >= lo && n <= hi) && a.status === row.status;
    };
    const bad = rawAgents(result).filter((a) => !fits(a));
    if (bad.length) problems.push(at(`${bad.length} agent(s) returned do not satisfy it: ${bad.slice(0, 3).map((a) => `${a.email}:${a.status}:${a.total_candidate_count}`).join(', ')}`));
    report.push(`${row.tab}: ${req.replace(/^.*\/api\/v1/, '')} -> ${result.payload && result.payload.count}`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A filter was not applied correctly on a non-Active tab:');
});

function headerHelpIcon(world, column) {
  return world.page.locator('[role="columnheader"]').filter({ hasText: column }).first().locator('button').first();
}

// Polls for the tooltip rather than reading once: it opens ~300-400ms after the pointer enters.
async function tooltipWithin(world, ms) {
  const tip = world.page.locator('[role="tooltip"]');
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const texts = (await tip.allInnerTexts()).map(clean).filter(Boolean);
    if (texts.length) return texts;
    await world.page.waitForTimeout(150);
  }
  return [];
}

// Hover: the pointer must ENTER the icon from somewhere else - react-aria opens nothing when the
// hover is the page's first mouse event (measured: never opens, vs 400ms after moving away first).
// Keyboard: a programmatic focus() is not keyboard modality and opens nothing either; the real
// route is the grid's own model - Tab lands on the first row, ArrowUp into the header row, then
// ArrowRight cell by cell until the icon itself has focus.
Then('the help icon on the {string} column should show {string} on hover and on keyboard focus', { timeout: 90000 }, async function (column, expected) {
  const icon = headerHelpIcon(this, column);
  await expect(icon, `the "${column}" header carries no help icon`).toBeVisible({ timeout: 15000 });
  const problems = [];
  const check = (route, texts) => {
    if (!texts.length) problems.push(`${route}: no tooltip opened`);
    else if (!texts.some((t) => t === clean(expected))) problems.push(`${route}: the tooltip read ${JSON.stringify(texts)}`);
  };

  await this.page.mouse.move(5, 5);
  await this.page.waitForTimeout(500);
  await icon.hover();
  const onHover = await tooltipWithin(this, 4000);
  check('hover', onHover);

  await this.page.mouse.move(5, 5);
  await this.page.waitForTimeout(800);
  await this.page.getByRole('button', { name: /^filters/i }).first().focus();
  await this.page.keyboard.press('Tab');
  await this.page.keyboard.press('ArrowUp');
  const isIcon = () => icon.evaluate((b) => b === document.activeElement);
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await this.page.keyboard.press('ArrowRight');
    reached = await isIcon();
  }
  let onFocus = [];
  let describedBy = null;
  if (!reached) problems.push('keyboard: the icon could not be reached from the header row with the arrow keys');
  else {
    onFocus = await tooltipWithin(this, 4000);
    describedBy = await icon.getAttribute('aria-describedby');
    check('keyboard focus', onFocus);
  }
  this.attach(`"${column}" help icon: hover=${JSON.stringify(onHover)} keyboard=${JSON.stringify(onFocus)} aria-describedby=${describedBy}`, 'text/plain');
  fail(problems, `The help icon on "${column}" does not explain the column:`);
});

Then('the help icon on the {string} column should have an accessible name', { timeout: 60000 }, async function (column) {
  const icon = headerHelpIcon(this, column);
  await expect(icon, `the "${column}" header carries no help icon`).toBeVisible({ timeout: 15000 });
  const attrs = await icon.evaluate((b) => ({
    ariaLabel: b.getAttribute('aria-label'),
    labelledBy: b.getAttribute('aria-labelledby'),
    title: b.getAttribute('title'),
    text: (b.innerText || '').trim(),
  }));
  this.attach(`"${column}" help icon attributes: ${JSON.stringify(attrs)}`, 'text/plain');
  const name = clean(attrs.ariaLabel || attrs.title || attrs.text || (attrs.labelledBy ? 'labelled' : ''));
  fail(name ? [] : ['the icon button has no aria-label, aria-labelledby, title or text - a screen reader announces only "button"'],
    `The help icon on "${column}" has no accessible name:`);
});

When('I open {string} from the sidebar', { timeout: 60000 }, async function (label) {
  await this.page.locator('nav a, aside a').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first().click();
  await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 });
  await listing(this).settle();
});

Then('the Agents listing should open on its {string} tab', async function (tab) {
  const url = new URL(this.page.url());
  expect(url.pathname, 'the sidebar did not open /agents').toBe('/agents');
  expect(url.searchParams.get('tab'), 'the listing kept a tab parameter').toBeNull();
  expect(clean(await this.page.locator('[role="radio"][aria-checked="true"]').first().innerText())).toBe(tab);
});

// ==================== Edit on the profile's Candidates tab ====================

const emailDialog = (world) => world.page.locator('[role="dialog"]').filter({ hasText: /update email address/i }).last();

Then('Edit on the first candidate should open the email change for that candidate with its address locked', { timeout: 60000 }, async function () {
  await waitForProfileCandidates(this);
  const first = (await profile(this).readCandidatesTab()).rows[0];
  this._avDialogWrites = markWrites(this);
  this._avUrlBefore = this.page.url();
  await this.page.locator('[role="row"]', { hasText: first.email }).first().getByRole('button', { name: /^edit$/i }).first().click();
  await emailDialog(this).waitFor({ state: 'visible', timeout: 20000 });
  const current = emailDialog(this).locator('input').first();
  expect(await current.inputValue(), 'the current address is not the candidate whose row was clicked').toBe(first.email);
  const locked = (await current.isDisabled()) || (await current.getAttribute('readonly')) !== null;
  expect(locked, 'the current address can be edited').toBe(true);
});

Then('cancelling that email change should send nothing and leave the profile on its Candidates tab', { timeout: 60000 }, async function () {
  await emailDialog(this).getByRole('button', { name: /^cancel$/i }).first().click();
  await emailDialog(this).waitFor({ state: 'hidden', timeout: 10000 });
  expect(this._avWrites.slice(this._avDialogWrites), 'cancelling sent a request').toEqual([]);
  expect(this.page.url()).toBe(this._avUrlBefore);
  expect(await profile(this).selectedTab()).toBe('Candidates');
});

// ==================== Activity Log empty state ====================

const ACTIVITY_EMPTY = { heading: 'No activity to show', body: 'Agents recent actions and updates will appear here.' };

Then("each Activity Log period should render the server's entries or say there is no activity:", { timeout: 300000 }, async function (table) {
  const problems = [];
  const report = [];
  let empties = 0;
  for (const { period, duration } of table.hashes()) {
    const trigger = this.page.locator('main button').filter({ hasText: /^(Last \d+ (hours|days|months)|This year)$/i }).first();
    if (clean(await trigger.innerText()) !== period) {
      await trigger.click();
      await this.page.getByRole('option', { name: new RegExp(`^${period}$`, 'i') }).first().click();
    }
    const hit = await waitFor(this, new RegExp(`^/analytics/agents/activity-logs/\\d+/\\?.*duration=${duration}`), { timeout: 15000 });
    if (!hit) { problems.push(`${period}: no request for duration=${duration}`); continue; }
    await this.page.waitForTimeout(1500);
    const text = clean(await this.page.locator('main').first().innerText());
    const entries = (await profile(this).readActivityLog()).entryDates.length;
    const count = hit.body && hit.body.count;
    report.push(`${period}: server ${count}, rendered ${entries}`);
    if (!count) {
      empties += 1;
      if (!text.includes(ACTIVITY_EMPTY.heading) || !text.includes(ACTIVITY_EMPTY.body)) problems.push(`${period}: the server holds nothing, the empty state is not shown ("${text.slice(-160)}")`);
      if (entries) problems.push(`${period}: the server holds nothing, ${entries} entries are rendered`);
    } else {
      if (!entries) problems.push(`${period}: the server holds ${count} entries, none are rendered`);
      if (text.includes(ACTIVITY_EMPTY.heading)) problems.push(`${period}: entries exist but the empty state is shown`);
    }
  }
  this.attach(report.join('\n'), 'text/plain');
  if (!empties) problems.push('no period was empty for this agent, so the empty state was never observed - the fixture (first Deactivated agent) has drifted');
  fail(problems, 'The Activity Log does not render the server\'s entries or its empty state:');
});

