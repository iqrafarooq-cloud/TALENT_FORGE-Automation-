const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

const { resilientSignIn } = require('../utils/resilientSignIn');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');

// Step definitions for the two SuperAdmin User Management edge-case files:
//   features/SuperAdmin_Portal/UserManagement/Agent-Listing-Edge-Cases.feature
//   features/SuperAdmin_Portal/UserManagement/Candidate-Listing-Edge-Cases.feature
// plus the throwaway-agent Given used by Agent-Deactivate-Reactivate.feature's @mutates-agent
// round trip.
//
// The two listings are the same kind of screen (a react-aria grid + a numbered pager over a paged
// GET), so ONE implementation drives both through the SURFACES table below, and every phrase names
// the listing ("Agents" / "Candidates") so the step registry stays unambiguous. Measured
// 2026-10-14 with scripts/probe-superadmin-user-mgmt-edges.js (read-only).
//
// RULES THIS FILE FOLLOWS, all paid for elsewhere in this repo:
//  - Every expectation is DERIVED from the server's own answer at run time (count, page_size,
//    the order of `results`). No name, count or page number is hardcoded - the lists are shared,
//    growing DEV data.
//  - A read is taken only after the grid has rendered what the response it is asserting about
//    returned. The grid keeps the previous query's rows while the next is in flight, so a read
//    after a fixed delay reports the OLD list as the new one.
//  - A step driven by a table collects every row's problem and throws once.

const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;

const SURFACES = {
  agents: {
    label: 'Agents',
    path: '/agents',
    api: /\/api\/v1\/agent\/\?/,
    tabParam: 'tab',
    defaultTab: 'Active',
    // The Active tab asks for both statuses; it is how "fell back to Active" is told apart from
    // "fell back to some other tab" on the wire.
    defaultRequest: (u) => u.searchParams.getAll('status').sort().join(',') === 'ACTIVE,ATTENTION',
  },
  candidates: {
    label: 'Candidates',
    path: '/candidates',
    api: /\/api\/v1\/candidate\/\?/,
    tabParam: 'accountTab',
    defaultTab: 'All',
    // The All tab sends no is_active at all - an absence, not a value.
    defaultRequest: (u) => !u.searchParams.has('is_active'),
  },
};

function surfaceOf(name) {
  const s = SURFACES[String(name).trim().toLowerCase()];
  if (!s) throw new Error(`Unknown listing "${name}" - expected "Agents" or "Candidates".`);
  return s;
}

function fail(problems, context) {
  if (problems.length) {
    throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
  }
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const resultsOf = (body) => (body && (body.results || body.data || body.items)) || [];
const emailOf = (x) => String((x && (x.email || (x.user && x.user.email))) || '').toLowerCase();

// The failure copy each listing renders for a list it could not load, as measured. Matched on the
// SHAPE of a failure message rather than a pinned sentence, so a rewording does not read as the
// failure handling disappearing.
const FAILURE_RE = /unable to load|could not be loaded|couldn'?t load|failed to load|something went wrong/i;
// The "nothing matched" copy. A failed load rendered with this is the defect being asserted.
const NO_RESULTS_RE = /no results found|couldn'?t find any results/i;

// ==================== Reading the screen ====================

async function readScreen(page) {
  return page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'));
    return {
      url: location.pathname + location.search,
      selectedTab: c((Array.from(document.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true') || {}).innerText),
      emails: rows.map((r) => ((r.innerText || '').match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0].toLowerCase()),
      rowCount: rows.length,
      text: c((document.querySelector('main') || document.body).innerText),
    };
  });
}

// Wait for the response to a navigation/action, then for the grid to render exactly what that
// response returned (or, for a failed/empty answer, for the grid to hold no rows). Returns the
// response alongside the settled screen.
async function runAndSettle(world, surface, action, { timeout = 45000 } = {}) {
  const page = world.page;
  const pending = page.waitForResponse(
    (r) => surface.api.test(r.url()) && r.request().method() === 'GET', { timeout },
  ).catch(() => null);
  // A stubbed abort produces no response at all, so the failed request is caught as well.
  const failed = page.waitForEvent('requestfailed',
    { predicate: (r) => surface.api.test(r.url()), timeout }).catch(() => null);
  await action();
  const response = await Promise.race([pending, failed.then((r) => (r ? { aborted: r } : null))]);
  let status = null;
  let body = null;
  let requestUrl = '';
  if (response && response.aborted) {
    requestUrl = response.aborted.url();
    status = 'aborted';
  } else if (response) {
    requestUrl = response.url();
    status = response.status();
    body = await response.json().catch(() => null);
  }
  const want = status === 200 ? resultsOf(body).length : 0;
  const deadline = Date.now() + 25000;
  let screen = await readScreen(page);
  while (Date.now() < deadline) {
    const settled = status === 200
      ? screen.rowCount === want && screen.emails.filter(Boolean).length === want
      : screen.rowCount === 0 && (FAILURE_RE.test(screen.text) || NO_RESULTS_RE.test(screen.text));
    if (settled) break;
    await page.waitForTimeout(400);
    screen = await readScreen(page);
  }
  const result = { surface, status, body, requestUrl, results: resultsOf(body), screen };
  world._um = result;
  return result;
}

async function openListing(world, surface, query = '') {
  return runAndSettle(world, surface, async () => {
    await world.page.goto(`${ORIGIN}${surface.path}${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  });
}

function current(world, surface) {
  if (!world._um || world._um.surface !== surface) {
    throw new Error(`The ${surface.label} listing has not been opened in this scenario yet.`);
  }
  return world._um;
}

function pageSizeOf(result) {
  const size = Number(new URL(result.requestUrl).searchParams.get('page_size'));
  return Number.isFinite(size) && size > 0 ? size : 10;
}

function pageOf(result) {
  return Number(new URL(result.requestUrl).searchParams.get('page')) || 1;
}

function lastPageOf(world, surface) {
  const first = world._umFirst && world._umFirst[surface.label];
  if (!first || !Number.isFinite(first.body && first.body.count)) {
    throw new Error(`The ${surface.label} listing's first answer carried no count, so the last page cannot be derived.`);
  }
  const size = pageSizeOf(first);
  return { count: first.body.count, size, last: Math.max(1, Math.ceil(first.body.count / size)) };
}

// >>> THE NUMBERED PAGER CONTROLS ARE <button role="listitem" aria-label="Page <n>">. <<<
// The explicit role overrides the button role, so getByRole('button', { name: 'Page 2' }) finds
// NOTHING on a pager that plainly renders it (measured 2026-10-14, both listings). The pager also
// renders a hidden duplicate set for narrow screens, so every control is taken :visible. Previous
// and Next are labelled "Previous Page" / "Next Page".
function pagerControl(page, label) {
  return page.locator(`main [aria-label="${label}" i]:visible`).first();
}

// ==================== Navigation ====================

Given('I have opened the {string} listing', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const result = await openListing(this, surface);
  expect(result.status, `the ${surface.label} list answered ${result.status}`).toBe(200);
  this._umFirst = { ...(this._umFirst || {}), [surface.label]: result };
  this.attach(`${surface.label}: count=${result.body && result.body.count} page_size=${pageSizeOf(result)} `
    + `request=${result.requestUrl}`, 'text/plain');
});

When('I choose page {int} from the {string} pager', { timeout: 90000 }, async function (n, name) {
  const surface = surfaceOf(name);
  // The pager's numbered controls are named "Page <n>" (aria-label) - their visible digit is not
  // their accessible name, so a getByRole(name: '2') finds nothing.
  const control = pagerControl(this.page, `Page ${n}`);
  await expect(control, `the ${surface.label} pager offers no "Page ${n}" control`).toBeVisible({ timeout: 20000 });
  await runAndSettle(this, surface, () => control.click());
});

When('I open the last page of the {string} listing', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const { last } = lastPageOf(this, surface);
  const result = await openListing(this, surface, `?page=${last}`);
  expect(result.status, `page ${last} answered ${result.status}`).toBe(200);
});

When('I open the {string} listing one page beyond its last page', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const { last } = lastPageOf(this, surface);
  const result = await openListing(this, surface, `?page=${last + 1}`);
  this.attach(`?page=${last + 1} -> status ${result.status}\nrendered: ${result.screen.text.slice(0, 400)}`, 'text/plain');
});

When('I reload the {string} listing', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  await runAndSettle(this, surface, () => this.page.reload({ waitUntil: 'domcontentloaded' }));
});

When('I note the rows on the {string} listing', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  this._umNoted = { url: result.screen.url, page: pageOf(result), emails: result.screen.emails.slice() };
  expect(this._umNoted.emails.filter(Boolean).length, 'there are no rows to note').toBeGreaterThan(0);
});

// ==================== URL edge cases ====================

Then('opening the {string} listing with each page value should fall back to the first page:',
  { timeout: 300000 }, async function (name, table) {
    const surface = surfaceOf(name);
    const problems = [];
    const report = [];
    for (const { page: value } of table.hashes()) {
      const result = await openListing(this, surface, `?page=${encodeURIComponent(value)}`);
      const asked = result.requestUrl ? pageOf(result) : null;
      report.push(`page=${JSON.stringify(value)} -> status ${result.status}, requested page ${asked}, rows ${result.screen.rowCount}`);
      if (result.status !== 200) {
        problems.push(`page=${JSON.stringify(value)}: the list answered ${result.status} instead of falling back`);
        continue;
      }
      if (asked !== 1) problems.push(`page=${JSON.stringify(value)}: the app requested page ${asked}, not page 1`);
      if (result.screen.rowCount === 0) problems.push(`page=${JSON.stringify(value)}: no rows were listed`);
      const current1 = await pagerControl(this.page, 'Page 1').getAttribute('aria-current', { timeout: 5000 }).catch(() => null);
      if (!current1) problems.push(`page=${JSON.stringify(value)}: the pager does not mark page 1 as current`);
    }
    // The URL keeps the unusable value (measured) - recorded, not asserted; the listing is right.
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, `${surface.label}: an unusable page number did not fall back to the first page:`);
  });

Then('opening the {string} listing with each tab value should fall back to {string}:',
  { timeout: 300000 }, async function (name, expectedTab, table) {
    const surface = surfaceOf(name);
    const problems = [];
    const report = [];
    for (const row of table.hashes()) {
      const value = row.value || '';
      const result = await openListing(this, surface, `?${surface.tabParam}=${encodeURIComponent(value)}`);
      const tab = result.screen.selectedTab;
      const onDefault = result.requestUrl ? surface.defaultRequest(new URL(result.requestUrl)) : false;
      report.push(`${surface.tabParam}=${JSON.stringify(value)} -> tab "${tab}", request ${result.requestUrl.replace(/^.*\/api\/v1/, '')}`);
      if (tab !== expectedTab) problems.push(`${JSON.stringify(value)}: the selected tab is "${tab}", not "${expectedTab}"`);
      if (!onDefault) problems.push(`${JSON.stringify(value)}: the request is not the ${expectedTab} tab's query`);
      if (result.status !== 200 || result.screen.rowCount === 0) {
        problems.push(`${JSON.stringify(value)}: the list answered ${result.status} with ${result.screen.rowCount} rows`);
      }
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, `${surface.label}: an unrecognised tab value did not fall back to "${expectedTab}":`);
  });

// ==================== Paging ====================

Then('the {string} listing should show page {int} of the server\'s results', async function (name, n) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  expect(pageOf(result), `the app requested page ${pageOf(result)}`).toBe(n);
  expect(new URL(this.page.url()).searchParams.get('page'), 'the URL does not record the page').toBe(String(n));
  // Compared as a SET: the Candidates grid re-sorts the server's page (its own @known-issue
  // scenario), and that must not be reported as the wrong page being shown.
  expect([...result.screen.emails].sort(), 'the grid does not show the rows the server returned for that page')
    .toEqual(result.results.map(emailOf).sort());
});

Then('none of the first page\'s rows should be listed again on the {string} listing', async function (name) {
  const surface = surfaceOf(name);
  const first = (this._umFirst && this._umFirst[surface.label]) || null;
  expect(first, 'the first page was never read').toBeTruthy();
  const seen = new Set(first.results.map(emailOf));
  const repeated = current(this, surface).screen.emails.filter((e) => e && seen.has(e));
  expect(repeated, 'rows from page 1 appear again on the page that was chosen').toEqual([]);
});

Then('the {string} listing should list exactly the remainder of the server\'s count', async function (name) {
  const surface = surfaceOf(name);
  const { count, size, last } = lastPageOf(this, surface);
  const expected = count - (last - 1) * size;
  const result = current(this, surface);
  this.attach(`count=${count} page_size=${size} last page=${last} -> expected ${expected} rows`, 'text/plain');
  expect(result.screen.rowCount, `the last page (${last}) should hold ${expected} rows`).toBe(expected);
  // Compared as a SET: ordering has its own scenario, and a reorder must not be reported as the
  // remainder being wrong.
  expect([...result.screen.emails].sort(), 'the last page does not show the rows the server returned')
    .toEqual(result.results.map(emailOf).sort());
  if (result.screen.emails.join() !== result.results.map(emailOf).join()) {
    this.attach(`NOTE: the last page renders the server's rows in a different order
  server: ${result.results.map(emailOf).join(', ')}
  grid  : ${result.screen.emails.join(', ')}`, 'text/plain');
  }
});

Then('the {string} pager should disable {string} and enable {string}', async function (name, off, on) {
  const offBtn = pagerControl(this.page, `${off} Page`);
  const onBtn = pagerControl(this.page, `${on} Page`);
  await expect(offBtn, `"${off}" is enabled on the last ${name} page`).toBeDisabled({ timeout: 15000 });
  await expect(onBtn, `"${on}" is disabled on the last ${name} page`).toBeEnabled({ timeout: 15000 });
});

// ==================== Paging, part 2: the pager as a control (added 2026-10-26) ====================
//
// MEASURED 2026-10-26 on the Agents listing (scripts/probe-agents-pagination-full.js, read-only):
//   - page_size 10; the page is written to the URL as ?page=<n> (page 1 writes NO param) and the
//     request asks for that page with the tab's own status filter.
//   - the pager is "Pagination Navigation": Previous Page | Page 1 .. | … | Page <last> | Next Page,
//     a window of five numbers plus the first and last with an ellipsis for each gap
//     ("1 2 3 4 5 … 35", "1 … 3 4 5 … 35", "1 … 31 32 33 34 35").
//   - every tab pages its OWN list; a search, an applied filter or a tab switch from a later page
//     goes back to page 1 and drops ?page=; a reload keeps the page; a result that fits on one page
//     renders NO pager at all.
//   - changing page REPLACES the browser history entry instead of adding one (Back after paging
//     leaves the listing's earlier pages behind) - asserted as measured, @needs-clarification.
//   - a page already fetched is re-rendered from the app's cache with NO request (Page 1 after
//     Next), so those navigations are settled on the grid, not on a response.

async function readPager(page) {
  return page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const nav = Array.from(document.querySelectorAll('main nav')).find((n) => vis(n) && /pagination/i.test(n.getAttribute('aria-label') || ''));
    if (!nav) return null;
    const numbers = Array.from(nav.querySelectorAll('[aria-label^="Page "]')).filter(vis).map((b) => ({
      n: Number((b.getAttribute('aria-label') || '').replace(/\D+/g, '')),
      current: Boolean(b.getAttribute('aria-current')),
    }));
    return {
      label: nav.getAttribute('aria-label'),
      numbers,
      current: (numbers.find((x) => x.current) || {}).n || null,
      ellipses: Array.from(nav.querySelectorAll('*')).filter((e) => !e.children.length && vis(e) && /^(\.\.\.|…)$/.test((e.textContent || '').trim())).length,
      text: (nav.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });
}

// The grid after an action that may be answered from the app's cache (no request): poll until the
// pager marks `n` current and the grid holds rows.
async function settleOnPage(world, surface, action, n) {
  const before = world._um;
  const result = await runAndSettle(world, surface, action, { timeout: 12000 });
  if (!result.requestUrl) {
    const deadline = Date.now() + 15000;
    let pager = await readPager(world.page);
    while (Date.now() < deadline && !(pager && pager.current === n)) {
      await world.page.waitForTimeout(400);
      pager = await readPager(world.page);
    }
    world._um = { ...(before || {}), surface, screen: await readScreen(world.page), cached: true };
  }
  return world._um;
}

function pagerName(label) {
  const l = String(label).trim().toLowerCase();
  if (l === 'next' || l === 'previous') return `${l[0].toUpperCase()}${l.slice(1)} Page`;
  return label;
}

When('I go to the {string} page of the {string} listing', { timeout: 90000 }, async function (which, name) {
  const surface = surfaceOf(name);
  const control = pagerControl(this.page, pagerName(which));
  await expect(control, `the ${surface.label} pager offers no enabled "${which}"`).toBeEnabled({ timeout: 20000 });
  current(this, surface);
  // Read off the URL, not the last request: a page re-rendered from the app's cache (after a
  // browser Back, say) makes no request to read it from.
  const was = Number(new URL(this.page.url()).searchParams.get('page')) || 1;
  await settleOnPage(this, surface, () => control.click(), /next/i.test(which) ? was + 1 : was - 1);
});

When('I open the {string} listing at page {int}', { timeout: 120000 }, async function (name, n) {
  const surface = surfaceOf(name);
  const result = await openListing(this, surface, `?page=${n}`);
  expect(result.status, `page ${n} answered ${result.status}`).toBe(200);
  if (!this._umFirst || !this._umFirst[surface.label]) this._umFirst = { ...(this._umFirst || {}), [surface.label]: result };
});

Then('the {string} pager should mark page {int} as the current page', async function (name, n) {
  const pager = await readPager(this.page);
  expect(pager, `the ${name} listing renders no pager`).toBeTruthy();
  this.attach(`Pager: ${pager.text} (current ${pager.current})`, 'text/plain');
  expect(pager.current, `the ${name} pager marks ${pager.current} as current`).toBe(n);
  expect(pager.numbers.filter((x) => x.current).length, 'more than one page is marked current').toBe(1);
});

// A control at the end of the range must be disabled AND inert: clicking it (forced past the
// disabled state) may send nothing and must not move the page.
Then('the {string} pager should disable {string} and pressing it should change nothing', { timeout: 60000 }, async function (name, which) {
  const surface = surfaceOf(name);
  const control = pagerControl(this.page, pagerName(which));
  await expect(control, `"${which}" is enabled here`).toBeDisabled({ timeout: 15000 });
  const before = await readScreen(this.page);
  const sent = [];
  const watch = (r) => { if (surface.api.test(r.url())) sent.push(r.url()); };
  this.page.on('request', watch);
  await control.click({ force: true }).catch(() => {});
  await this.page.waitForTimeout(2500);
  this.page.off('request', watch);
  const after = await readScreen(this.page);
  expect(sent, `pressing the disabled "${which}" sent ${JSON.stringify(sent)}`).toEqual([]);
  expect(after.url, `pressing the disabled "${which}" moved the listing`).toBe(before.url);
  expect(after.emails).toEqual(before.emails);
});

// The window rule, derived from the server's count rather than pinned: the first and the last page
// are always offered, so are the current page and its neighbours, the numbers ascend without
// repeating, and every gap in them is shown as exactly one ellipsis.
Then('the {string} pager should offer the first and last pages, the current page and its neighbours, and an ellipsis for each gap',
  async function (name) {
    const surface = surfaceOf(name);
    const { last } = lastPageOf(this, surface);
    const pager = await readPager(this.page);
    expect(pager, `the ${surface.label} listing renders no pager`).toBeTruthy();
    const nums = pager.numbers.map((x) => x.n);
    const cur = pager.current;
    const problems = [];
    const want = [1, last, cur, cur - 1, cur + 1].filter((n) => n >= 1 && n <= last);
    for (const n of want) if (!nums.includes(n)) problems.push(`page ${n} is not offered`);
    if (nums.some((n, i) => i && n <= nums[i - 1])) problems.push(`the page numbers are not ascending and unique: ${nums.join(' ')}`);
    if (nums.some((n) => n < 1 || n > last)) problems.push(`a page outside 1..${last} is offered: ${nums.join(' ')}`);
    const gaps = nums.filter((n, i) => i && n - nums[i - 1] > 1).length;
    if (pager.ellipses !== gaps) problems.push(`${gaps} gap(s) in ${nums.join(' ')} but ${pager.ellipses} ellipsis shown`);
    this.attach(`last page ${last}, current ${cur}: ${pager.text}`, 'text/plain');
    fail(problems, `The ${surface.label} pager does not lay out its pages as expected:`);
  });

Then('the {string} pager should not be shown', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  const pager = await readPager(this.page);
  const count = result.body && result.body.count;
  this.attach(`count ${count}, page_size ${result.requestUrl ? pageSizeOf(result) : '?'}, pager ${pager && pager.text}`, 'text/plain');
  expect(count, 'the premise is broken: the result does not fit on one page').toBeLessThanOrEqual(pageSizeOf(result));
  expect(pager, `a pager is shown for ${count} result(s) that fit on one page: ${pager && pager.text}`).toBeNull();
});

Then('the {string} listing should be back on page 1 with no page in the URL', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  const problems = [];
  // Page 1 already fetched is re-rendered from the app's cache with NO request; the URL and the
  // pager below still say which page is shown.
  if (result.requestUrl && pageOf(result) !== 1) problems.push(`the app requested page ${pageOf(result)}`);
  const urlPage = new URL(this.page.url()).searchParams.get('page');
  if (urlPage && urlPage !== '1') problems.push(`the URL still says page=${urlPage}`);
  const pager = await readPager(this.page);
  if (pager && pager.current !== 1) problems.push(`the pager marks page ${pager.current} as current`);
  if (result.requestUrl && result.status === 200 && JSON.stringify([...result.screen.emails].sort()) !== JSON.stringify(result.results.map(emailOf).sort())) {
    problems.push('the grid does not show the rows the server returned');
  }
  fail(problems, `${surface.label}: the listing did not go back to page 1:`);
});

When('I search the {string} listing for {string}', { timeout: 90000 }, async function (name, term) {
  const surface = surfaceOf(name);
  const box = this.page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
  await runAndSettle(this, surface, () => box.fill(term));
});

When('I search the {string} listing for the first email on this page', { timeout: 90000 }, async function (name) {
  const surface = surfaceOf(name);
  const email = current(this, surface).screen.emails.find(Boolean);
  expect(email, 'no row on this page carries an email').toBeTruthy();
  const box = this.page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
  await runAndSettle(this, surface, () => box.fill(email));
});

When('I clear the {string} listing search', { timeout: 90000 }, async function (name) {
  const surface = surfaceOf(name);
  const box = this.page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
  await runAndSettle(this, surface, () => box.fill(''));
});

// Generic over both listings: the Filters trigger, the first option the modal offers, Apply.
// Opened through each listing's own page object, whose trigger locator the filter scenarios already
// prove; a generic getByRole on "Filters" hung on this page while the button was plainly visible.
When('I apply the first filter option on the {string} listing', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const pageObject = surface === SURFACES.agents ? this.pages.agentsListing : this.pages.candidatesListing;
  await pageObject.openFilters();
  // Both modals tag their checkbox options `filters-<group>-<option>-checkbox` and their Apply
  // `filters-apply-button`; a bare `label` can resolve to a group caption or a radio.
  const option = this.page.locator('[role="dialog"] label[data-testid^="filters-"][data-testid$="-checkbox"]').first();
  await option.waitFor({ state: 'visible', timeout: 20000 });
  const label = clean(await option.innerText());
  await option.click();
  this.attach(`Applied filter option: ${label}`, 'text/plain');
  await runAndSettle(this, surface, () => this.page.locator('[data-testid="filters-apply-button"]').first().click());
});

When('I switch the {string} listing to the {string} tab', { timeout: 90000 }, async function (name, tab) {
  const surface = surfaceOf(name);
  await runAndSettle(this, surface, () => this.page.getByRole('radio', { name: tab, exact: true }).first().click());
});

// Each tab pages its own list. The tab's status filter must travel with the page request, or page
// 2 of a tab would silently be page 2 of some other list.
Then('each {string} tab should page through its own list:', { timeout: 420000 }, async function (name, table) {
  const surface = surfaceOf(name);
  const problems = [];
  const report = [];
  // `status` (Agents: the tab's status list) or `query` (Candidates: "is_active=false", or
  // "no is_active" for the All tab, which sends none) names the tab's filter on the wire.
  const tabQuery = (u) => {
    const sp = new URL(u).searchParams;
    return { status: sp.getAll('status').sort().join(','), isActive: sp.has('is_active') ? `is_active=${sp.get('is_active')}` : 'no is_active' };
  };
  const matches = (q, row) => (row.status ? q.status === row.status : q.isActive === row.query);
  for (const row of table.hashes()) {
    const { tab, url } = row;
    await openListing(this, surface);
    let first = await runAndSettle(this, surface, () => this.page.getByRole('radio', { name: tab, exact: true }).first().click(), { timeout: 15000 });
    if (!first.requestUrl) first = await openListing(this, surface, url ? `?${surface.tabParam}=${url}` : '');
    if (!matches(tabQuery(first.requestUrl), row)) problems.push(`${tab}: page 1 asked for ${JSON.stringify(tabQuery(first.requestUrl))}, not ${row.status || row.query}`);
    const count = first.body && first.body.count;
    if (!(count > pageSizeOf(first))) {
      report.push(`${tab}: ${count} agents fit on one page`);
      if (await readPager(this.page)) problems.push(`${tab}: a pager is shown for ${count} agents`);
      continue;
    }
    const seen = new Set(first.results.map(emailOf));
    const next = await runAndSettle(this, surface, () => pagerControl(this.page, 'Next Page').click());
    const u = new URL(next.requestUrl);
    const q = new URL(this.page.url()).searchParams;
    report.push(`${tab}: ${count} agents; Next -> ${next.requestUrl.replace(/^.*\/api\/v1/, '')}, url ${this.page.url().replace(/^https?:\/\/[^/]+/, '')}`);
    if (pageOf(next) !== 2) problems.push(`${tab}: Next asked for page ${pageOf(next)}`);
    if (!matches(tabQuery(next.requestUrl), row)) problems.push(`${tab}: page 2 dropped the tab's filter (${u.search})`);
    if (q.get('page') !== '2') problems.push(`${tab}: the URL does not record page 2`);
    if (url && q.get(surface.tabParam) !== url) problems.push(`${tab}: the URL lost the tab (${surface.tabParam}=${q.get(surface.tabParam)})`);
    if (JSON.stringify([...next.screen.emails].sort()) !== JSON.stringify(next.results.map(emailOf).sort())) problems.push(`${tab}: page 2 does not show the server's rows`);
    const repeated = next.screen.emails.filter((e) => e && seen.has(e));
    if (repeated.length) problems.push(`${tab}: page 2 repeats ${JSON.stringify(repeated)} from page 1`);
    const pager = await readPager(this.page);
    if (!pager || pager.current !== 2) problems.push(`${tab}: the pager marks ${pager && pager.current} as current`);
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, `${surface.label}: a tab does not page through its own list:`);
});

// MEASURED: changing page replaces the history entry (history.length does not grow), so browser
// Back from page 3 does not go to page 2. Asserted as measured; ask the PO which is intended.
Then('changing page on the {string} listing should not add a browser history entry', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const before = await this.page.evaluate(() => window.history.length);
  for (const n of [2, 3]) {
    await runAndSettle(this, surface, () => pagerControl(this.page, 'Next Page').click());
    expect(new URL(this.page.url()).searchParams.get('page'), `Next did not reach page ${n}`).toBe(String(n));
  }
  const after = await this.page.evaluate(() => window.history.length);
  this.attach(`history.length ${before} -> ${after} across two page changes`, 'text/plain');
  expect(after, `paging added ${after - before} history entr${after - before === 1 ? 'y' : 'ies'}`).toBe(before);
});

// Every pager control is a real, focusable button: reached by focus, operated by Enter and Space.
Then('the {string} pager should be operable from the keyboard', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const problems = [];
  const press = async (label, key, want) => {
    const control = pagerControl(this.page, label);
    await control.focus();
    const focused = await this.page.evaluate(() => ({ label: document.activeElement.getAttribute('aria-label'), tabIndex: document.activeElement.tabIndex }));
    if (focused.label !== label) { problems.push(`"${label}" cannot take focus (focus is on ${focused.label})`); return; }
    if (focused.tabIndex < 0) problems.push(`"${label}" is out of the Tab order (tabIndex ${focused.tabIndex})`);
    await settleOnPage(this, surface, () => this.page.keyboard.press(key), want);
    const pager = await readPager(this.page);
    if (!pager || pager.current !== want) problems.push(`${key} on "${label}" left page ${pager && pager.current}, not ${want}`);
  };
  await press('Next Page', 'Enter', 2);
  await press('Page 3', 'Enter', 3);
  await press('Previous Page', ' ', 2);
  fail(problems, `${surface.label}: the pager cannot be operated from the keyboard:`);
});

When('I note this as the first page of the {string} listing', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  expect(result.requestUrl ? pageOf(result) : 1, 'the listing is not on its first page').toBe(1);
  this._umFirst = { ...(this._umFirst || {}), [surface.label]: result };
});

Then('the {string} listing should show the first page it showed before', async function (name) {
  const surface = surfaceOf(name);
  const first = this._umFirst && this._umFirst[surface.label];
  expect(first, 'the first page was never read').toBeTruthy();
  const screen = await readScreen(this.page);
  expect([...screen.emails].sort(), 'going back to page 1 shows different rows').toEqual([...first.screen.emails].sort());
});

// Checked on page 1 AND on the second-to-last page: measured 2026-10-14, the candidate grid kept
// the server's order on page 1 purely by coincidence and re-ordered page 222 completely. One page
// cannot tell "keeps the order" from "happens to agree here".
Then('the {string} grid should list its rows in the server\'s order on the first and a later page',
  { timeout: 180000 }, async function (name) {
    const surface = surfaceOf(name);
    const { last } = lastPageOf(this, surface);
    const pages = [1, Math.max(2, last - 1)].filter((n, i, a) => n <= last && a.indexOf(n) === i);
    const problems = [];
    const report = [];
    for (const n of pages) {
      const result = await openListing(this, surface, n === 1 ? '' : `?page=${n}`);
      const server = result.results.map(emailOf);
      report.push(`page ${n}\n  server: ${server.join(', ')}\n  grid  : ${result.screen.emails.join(', ')}`);
      if (server.length < 2) continue;
      if (result.screen.emails.join() !== server.join()) {
        problems.push(`page ${n}: the grid re-orders the ${server.length} rows the server sent`
          + `\n     server: ${server.join(', ')}\n     grid  : ${result.screen.emails.join(', ')}`);
      }
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, `${surface.label}: the grid does not keep the order the server returns:`);
  });

// ==================== Failures ====================

async function stub(world, surface, cause) {
  await world.page.route(surface.api, (route) => (String(cause).toLowerCase() === 'offline'
    ? route.abort('internetdisconnected')
    : route.fulfill({ status: Number(cause), contentType: 'application/json', body: '{"detail":"stubbed failure"}' })));
}

Given('the {string} list request will answer {string}', async function (name, cause) {
  await stub(this, surfaceOf(name), cause);
});

When('I open the {string} listing expecting a failure', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  await openListing(this, surface);
  await this.page.unroute(surface.api);
});

Then('a failed {string} list load should be reported as a failure for each cause:',
  { timeout: 300000 }, async function (name, table) {
    const surface = surfaceOf(name);
    const problems = [];
    const report = [];
    for (const { cause } of table.hashes()) {
      await stub(this, surface, cause);
      const result = await openListing(this, surface);
      await this.page.unroute(surface.api);
      const text = result.screen.text;
      report.push(`${cause}: status ${result.status}, rows ${result.screen.rowCount}\n   ${text.slice(0, 300)}`);
      if (result.screen.rowCount !== 0) problems.push(`${cause}: ${result.screen.rowCount} rows are listed for a load that failed`);
      if (!FAILURE_RE.test(text)) problems.push(`${cause}: nothing on screen says the list could not be loaded`);
      if (NO_RESULTS_RE.test(text)) {
        problems.push(`${cause}: the failure is presented as "no results" - "${(text.match(/no results found[^.]*\.?[^.]*\./i) || [''])[0]}" - `
          + 'so the superadmin is told nothing matched when nothing was loaded');
      }
    }
    this.attach(report.join('\n'), 'text/plain');
    fail(problems, `${surface.label}: a failed list load is not reported as a failure:`);
  });

Then('the {string} failure message should name {string} and not {string}', async function (name, want, not) {
  const surface = surfaceOf(name);
  const text = current(this, surface).screen.text;
  const sentence = (text.match(/unable to load[^.]*\./i) || [text.slice(0, 200)])[0];
  this.attach(`Failure copy on the ${surface.label} listing: ${sentence}`, 'text/plain');
  expect(sentence, `the ${surface.label} listing shows no failure message`).toMatch(FAILURE_RE);
  expect(sentence, `the ${surface.label} listing's failure message names "${not}": "${sentence}"`)
    .not.toMatch(new RegExp(`\\b${not}\\b`, 'i'));
  expect(sentence, `the ${surface.label} listing's failure message does not name "${want}": "${sentence}"`)
    .toMatch(new RegExp(`\\b${want}\\b`, 'i'));
});

Then('the {string} listing should not blame the connection for a page that does not exist', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  expect(result.screen.text,
    `a page beyond the last (server answered ${result.status}) is reported as a connection problem: `
    + `"${(result.screen.text.match(/unable to load[^.]*\.[^.]*\./i) || [''])[0]}". `
    + 'It should fall back to the last page or say the page does not exist.')
    .not.toMatch(/check your connection/i);
});

When('I open the {string} listing with the page value {string}', { timeout: 120000 }, async function (name, value) {
  const surface = surfaceOf(name);
  const result = await openListing(this, surface, `?page=${encodeURIComponent(value)}`);
  this.attach(`?page=${value} -> request ${result.requestUrl.replace(/^.*\/api\/v1/, '')} status ${result.status}\n`
    + `rendered: ${result.screen.text.slice(0, 300)}`, 'text/plain');
});

When('I open the {string} listing far beyond its last page', { timeout: 120000 }, async function (name) {
  const surface = surfaceOf(name);
  const { last } = lastPageOf(this, surface);
  // Far enough past the end that the list growing during the run cannot make it a real page.
  const result = await openListing(this, surface, `?page=${last + 100}`);
  this.attach(`?page=${last + 100} (last page ${last}) -> status ${result.status}\nrendered: ${result.screen.text.slice(0, 300)}`, 'text/plain');
});

// MEASURED 2026-10-26: a page the server answers 404 for renders "404 Page not found / The page you
// requested does not exist." (it used to blame the connection - that @known-issue is fixed).
Then('the {string} listing should say the page does not exist and list no rows', async function (name) {
  const surface = surfaceOf(name);
  const deadline = Date.now() + 20000;
  let screen = await readScreen(this.page);
  while (Date.now() < deadline && !/page not found|does not exist/i.test(screen.text)) {
    await this.page.waitForTimeout(500);
    screen = await readScreen(this.page);
  }
  expect(screen.text, `the ${surface.label} listing does not say the page does not exist: ${screen.text.slice(0, 300)}`)
    .toMatch(/page not found|does not exist/i);
  expect(screen.text).not.toMatch(/check your connection/i);
  expect(screen.emails.filter(Boolean), 'rows are listed on a page that does not exist').toEqual([]);
});

Then('the {string} listing should not claim a search or filter is applied', async function (name) {
  const surface = surfaceOf(name);
  const result = current(this, surface);
  const url = new URL(this.page.url());
  const params = [...url.searchParams.keys()].filter((k) => k !== 'page');
  expect(params, 'the premise is broken: a search or filter IS applied').toEqual([]);
  expect(result.screen.text,
    `with no search or filter applied, a page beyond the last (server answered ${result.status}) reads: `
    + `"${(result.screen.text.match(/no results found[^.]*\.?[^.]*\./i) || [''])[0]}"`)
    .not.toMatch(/current search|current filters|search and filters/i);
});

// ==================== A profile that does not exist ====================

async function openMissingProfile(world, id) {
  await world.page.goto(`${ORIGIN}/agents/view/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const deadline = Date.now() + 25000;
  let text = '';
  while (Date.now() < deadline) {
    text = clean(await world.page.locator('main').first().innerText().catch(() => ''));
    if (/profile not found/i.test(text)) break;
    await world.page.waitForTimeout(500);
  }
  return text;
}

Then('opening an agent profile that does not exist should say {string} for each id:',
  { timeout: 180000 }, async function (message, table) {
    const problems = [];
    for (const { id } of table.hashes()) {
      const text = await openMissingProfile(this, id);
      this.attach(`/agents/view/${id}: ${text.slice(0, 300)}`, 'text/plain');
      if (!text.toLowerCase().includes(message.toLowerCase())) problems.push(`/agents/view/${id} does not say "${message}"`);
    }
    fail(problems, 'A profile that does not exist is not reported as such:');
  });

When('I open the profile of an agent that does not exist', { timeout: 90000 }, async function () {
  // A numeric id far beyond any real one (agent ids are in the low thousands), varied per run so
  // no cache can answer for it.
  this._missingProfileText = await openMissingProfile(this, String(10 ** 8 + Date.now() % 1000));
});

// Measured 2026-10-20: every /agent/<id>/... request answers 404, the page says "Profile not
// found." and still renders the four tabs - by design, they render on every profile. With no data
// each chart must show its own empty state, and nothing on the page may name an agent.
Then('the missing agent profile should say it was not found and show its empty states', async function () {
  const text = this._missingProfileText || '';
  this.attach(`missing profile render: ${text.slice(0, 1500)}`, 'text/plain');
  const problems = [];
  if (!/profile not found/i.test(text)) problems.push('the page does not say "Profile not found"');
  for (const chart of ['candidate onboarding', 'revenue impact']) {
    if (!new RegExp(`no data to display for ${chart}`, 'i').test(text)) {
      problems.push(`the ${chart} chart does not show its empty state ("No data to display for ${chart}")`);
    }
  }
  // A real profile's identity block carries the agent's email and "Edit Target"; neither may render here.
  for (const marker of ['Edit Target', '@']) {
    if (text.includes(marker)) problems.push(`the page renders agent identity ("${marker}") for a profile that does not exist`);
  }
  fail(problems, 'A profile that does not exist is not presented as empty:');
});

// ==================== Access ====================

const ROLES = {
  agent: () => ({ email: process.env.AGENT_EMAIL, password: process.env.AGENT_PASSWORD, landed: /\/dashboard|\/candidates|\/getting-started/ }),
  // A READ-ONLY use of the Candidate Details / Contact Us fixture: it only signs in and navigates.
  candidate: () => ({
    email: process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL,
    password: process.env.CANDIDATE_DETAILS_PASSWORD || process.env.CONTACTUS_PASSWORD,
    landed: /\/dashboard|\/profile|\/onboarding|\/getting-started|\/track/,
  }),
};

// Each role signs in in its OWN context, so the superadmin session the Background opened is not
// disturbed and nothing is carried between roles.
async function asRole(world, role, visit) {
  const creds = ROLES[role] && ROLES[role]();
  if (!creds || !creds.email || !creds.password) throw new Error(`No credentials in .env for the "${role}" role.`);
  const context = await world.browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const adminCalls = [];
  page.on('request', (r) => {
    if (SURFACES.agents.api.test(r.url()) || SURFACES.candidates.api.test(r.url())) adminCalls.push(r.url());
  });
  try {
    await resilientSignIn({ page, attach: world.attach.bind(world) }, creds.email, creds.password, { landedOn: creds.landed });
    return await visit(page, adminCalls);
  } finally {
    await context.close().catch(() => {});
  }
}

async function visitPath(page, path) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForURL(/.*/, { timeout: 5000 }).catch(() => {});
  const deadline = Date.now() + 15000;
  let text = '';
  while (Date.now() < deadline) {
    text = clean(await page.locator('body').innerText().catch(() => ''));
    if (/access denied|permission/i.test(text) || !new RegExp(`${path}($|\\?)`).test(page.url())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  return { url: new URL(page.url()).pathname, text };
}

Then('each of these roles should be refused the agent management pages:', { timeout: 400000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { role } of table.hashes()) {
    await asRole(this, role, async (page, adminCalls) => {
      for (const path of ['/agents', '/agents/invite', '/agents/view/1']) {
        adminCalls.length = 0;
        const { url, text } = await visitPath(page, path);
        report.push(`${role} ${path} -> ${url}: ${text.slice(0, 120)}`);
        if (!/access denied/i.test(text)) problems.push(`${role} opening ${path} landed on ${url} and was not told access is denied`);
        if (adminCalls.length) problems.push(`${role} opening ${path} fired the superadmin list request ${adminCalls[0]}`);
      }
    });
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A non-superadmin role reached the agent management pages:');
});

Then('the candidate management listing should be closed to each of these roles:', { timeout: 400000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { role, expected } of table.hashes()) {
    await asRole(this, role, async (page, adminCalls) => {
      adminCalls.length = 0;
      const { url, text } = await visitPath(page, '/candidates');
      report.push(`${role} /candidates -> ${url}: ${text.slice(0, 120)}`);
      // Whichever way the role is turned away, the SUPERADMIN list (every candidate on the
      // platform) must never be requested - that is the disclosure this scenario guards.
      if (adminCalls.length) problems.push(`${role}: the superadmin candidate list was requested (${adminCalls[0]})`);
      if (/access denied/i.test(expected) && !/access denied/i.test(text)) {
        problems.push(`${role}: expected "Access denied", landed on ${url}`);
      }
      if (/own listing/i.test(expected) && (url === '/candidates' || /access denied/i.test(text))) {
        problems.push(`${role}: expected a redirect to the agent's own candidate listing, landed on ${url}`);
      }
    });
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The candidate management listing was not closed to a non-superadmin role:');
});

// Measured 2026-11-03: an agent opening /audit-logs is sent to /unauthorized ("Access denied")
// and the superadmin audit-log list is never requested.
Then('each of these roles should be refused the Audit Logs page:', { timeout: 400000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { role } of table.hashes()) {
    await asRole(this, role, async (page) => {
      const auditCalls = [];
      page.on('request', (r) => { if (/\/analytics\/admin\/audit-logs\//.test(r.url())) auditCalls.push(r.url()); });
      const { url, text } = await visitPath(page, '/audit-logs');
      report.push(`${role} /audit-logs -> ${url}: ${text.slice(0, 120)}`);
      if (!/access denied/i.test(text)) problems.push(`${role} opening /audit-logs landed on ${url} and was not told access is denied`);
      if (auditCalls.length) problems.push(`${role} opening /audit-logs fired the audit-log list request ${auditCalls[0]}`);
    });
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A non-superadmin role reached the Audit Logs page:');
});

// The superadmin's Agents Analytics dashboard. Whichever way a role is turned away, none of the
// platform-wide analytics requests may be made in its session.
Then('each of these roles should be refused the Agents Analytics dashboard:', { timeout: 400000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { role } of table.hashes()) {
    await asRole(this, role, async (page) => {
      const calls = [];
      page.on('request', (r) => { if (/\/api\/v1\/agent\/analytics\//.test(r.url())) calls.push(r.url()); });
      const { url, text } = await visitPath(page, '/agents-analytics');
      report.push(`${role} /agents-analytics -> ${url}: ${text.slice(0, 120)}`);
      // Two measured refusals: an agent gets "Access denied" at /unauthorized; a candidate is sent
      // to its own portal (/getting-started). Either is a refusal - staying on the route is not.
      const leftRoute = !/\/agents-analytics/.test(new URL(url, 'https://x').pathname);
      if (!/access denied/i.test(text) && !leftRoute) problems.push(`${role} opening /agents-analytics stayed on ${url} and was not told access is denied`);
      if (calls.length) problems.push(`${role} opening /agents-analytics fired the analytics request ${calls[0]}`);
    });
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A non-superadmin role reached the Agents Analytics dashboard:');
});

// The superadmin's Candidates Analytics dashboard: same rule as Agents Analytics above.
Then('each of these roles should be refused the Candidates Analytics dashboard:', { timeout: 400000 }, async function (table) {
  const problems = [];
  const report = [];
  for (const { role } of table.hashes()) {
    await asRole(this, role, async (page) => {
      const calls = [];
      page.on('request', (r) => { if (/\/api\/v1\/analytics\/candidates\//.test(r.url())) calls.push(r.url()); });
      const { url, text } = await visitPath(page, '/candidate-analytics');
      report.push(`${role} /candidate-analytics -> ${url}: ${text.slice(0, 120)}`);
      const leftRoute = !/\/candidate-analytics/.test(url);
      if (!/access denied/i.test(text) && !leftRoute) problems.push(`${role} opening /candidate-analytics stayed on ${url} and was not told access is denied`);
      if (calls.length) problems.push(`${role} opening /candidate-analytics fired the analytics request ${calls[0]}`);
    });
  }
  await this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'A non-superadmin role reached the Candidates Analytics dashboard:');
});

// ==================== End to end ====================

When('I open the first agent listed on the current page', { timeout: 90000 }, async function () {
  const email = (this._umNoted && this._umNoted.emails.find(Boolean)) || '';
  expect(email, 'no agent was noted on the current page').toBeTruthy();
  const row = this.page.locator('[role="row"]', { hasText: email }).first();
  await row.getByRole('button', { name: /^view$/i }).first().click();
  await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
});

When('I go back from the agent profile with the browser', { timeout: 120000 }, async function () {
  await runAndSettle(this, SURFACES.agents, () => this.page.goBack({ waitUntil: 'domcontentloaded' }));
});

When('I view and close the first candidate listed on the current page', { timeout: 120000 }, async function () {
  const email = (this._umNoted && this._umNoted.emails.find(Boolean)) || '';
  expect(email, 'no candidate was noted on the current page').toBeTruthy();
  await this.pages.candidatesListing.openCandidatePanel(email);
  await this.pages.candidateDetailPanel.waitForOpen();
  await this.pages.candidateDetailPanel.close();
  this._um = { ...this._um, screen: await readScreen(this.page) };
});

Then('the {string} listing should be back on the same page with the same rows', async function (name) {
  const surface = surfaceOf(name);
  const noted = this._umNoted;
  expect(noted, 'no rows were noted to compare against').toBeTruthy();
  const screen = current(this, surface).screen;
  expect(screen.url, 'the listing did not return to the URL it was left on').toBe(noted.url);
  expect(screen.emails, 'the listing returned with different rows').toEqual(noted.emails);
});

// ==================== Throwaway agent for the @mutates-agent round trip ====================

// The round trip used to reactivate whichever agent happened to be first on the Deactivated tab -
// somebody's real account. It now invites an agent of its own (no promo, no payment) and abandons
// it; an agent cannot be deleted, and the @mutates-agent After hook in steps/agent.js leaves it
// deactivated if the run dies half way.
Given('I have provisioned a throwaway agent to deactivate', { timeout: 600000 }, async function () {
  const agent = await provisionAgentWithoutPromo(this.browser, {
    label: 'agent-lifecycle-throwaway',
    firstName: 'Lifecycle',
    tagPrefix: 'aglife',
  });
  this._agent = { name: agent.name, email: agent.email, university: agent.university || '', candidates: 0, progress: null, cells: [] };
  this.attach(`Provisioned throwaway agent ${agent.name} <${agent.email}> - abandoned after the scenario.`, 'text/plain');
  await this.pages.agentsListing.goto('Active');
  await this.pages.agentsListing.waitForAgentOnTab('Active', { name: agent.name, email: agent.email });
});

// ==================== Deactivate dialog: dismissal, transfer picker ====================
// All READ-ONLY: a receiver may be chosen to observe the gate, but the dialog is always
// cancelled - "Transfer & Deactivate" moves real candidates and nothing in the portal undoes it.

const listing = (world) => world.pages.agentsListing;

async function dismissDialog(world, dialog, how) {
  const method = String(how).trim().toLowerCase();
  if (method === 'x icon') {
    const close = dialog.getByRole('button', { name: /^close$/i }).first();
    if (!(await close.count())) return `no X close control in the dialog`;
    await close.click();
  } else if (method === 'escape') {
    await world.page.keyboard.press('Escape');
  } else if (method === 'cancel') {
    await dialog.getByRole('button', { name: /^cancel$/i }).first().click();
  } else {
    throw new Error(`Unknown dismissal "${how}" - expected Cancel, X icon or Escape.`);
  }
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  return (await dialog.isVisible().catch(() => false)) ? `the dialog is still open after ${how}` : null;
}

Then('the Deactivate dialog should close via each of these, leaving the agent active:',
  { timeout: 400000 }, async function (table) {
    const agent = this._agent;
    expect(agent, 'no agent has been noted').toBeTruthy();
    const problems = [];
    for (const { method } of table.hashes()) {
      await listing(this).goto('Active');
      await listing(this).search(agent.name);
      await listing(this).openDeactivateDialog(agent.email);
      const problem = await dismissDialog(this, listing(this).deactivateDialog, method);
      if (problem) { problems.push(`${method}: ${problem}`); await listing(this).cancelDeactivateDialog().catch(() => {}); }
    }
    const where = await listing(this).whereIsAgent({ name: agent.name, email: agent.email });
    if (!where.some((w) => w.tab === 'Active')) problems.push(`${agent.email} is no longer on the Active tab: ${JSON.stringify(where)}`);
    fail(problems, 'The Deactivate dialog cannot be dismissed by every documented route:');
  });

Then('the Reactivate dialog should close via each of these, leaving the agent deactivated:',
  { timeout: 400000 }, async function (table) {
    const agent = this._agent;
    expect(agent, 'no agent has been noted').toBeTruthy();
    const problems = [];
    for (const { method } of table.hashes()) {
      await listing(this).goto('Deactivated');
      await listing(this).search(agent.name);
      await listing(this).openReactivateDialog(agent.email);
      const dialog = this.page.locator('[role="dialog"]').filter({ hasText: /re-?activate account/i }).first();
      const problem = await dismissDialog(this, dialog, method);
      if (problem) { problems.push(`${method}: ${problem}`); await listing(this).cancelReactivateDialog().catch(() => {}); }
    }
    const where = await listing(this).whereIsAgent({ name: agent.name, email: agent.email });
    if (!where.some((w) => w.tab === 'Deactivated')) problems.push(`${agent.email} is no longer on the Deactivated tab: ${JSON.stringify(where)}`);
    fail(problems, 'The Reactivate dialog cannot be dismissed by every documented route:');
  });

Then('the receiving agent picker should not offer that agent itself', { timeout: 60000 }, async function () {
  const agent = this._agent;
  const picker = await listing(this).transferAgentOptions();
  this._pickerOffered = picker.offered;
  this.attach(`Picker offered ${picker.offered.length}: ${JSON.stringify(picker.offered.slice(0, 15))}`, 'text/plain');
  expect(picker.pickerPresent, 'the dialog has no receiving-agent picker').toBe(true);
  const self = picker.offered.filter((o) => o.toLowerCase().includes(agent.email.toLowerCase())
    || (agent.name && o.toLowerCase().startsWith(agent.name.toLowerCase())));
  expect(self, `${agent.name} is offered as the receiver of their own candidates`).toEqual([]);
  await listing(this).closeTransferSuggestions();
});

When('I choose the first receiving agent offered', { timeout: 60000 }, async function () {
  const trigger = listing(this).deactivateDialog.locator('button[aria-label="Show suggestions" i]').first();
  await trigger.click();
  const option = this.page.locator('[role="option"]').filter({ hasNotText: /no agents available|no other agents/i }).first();
  await expect(option, 'the picker offers no receiving agent to choose').toBeVisible({ timeout: 15000 });
  this._chosenReceiver = clean(await option.innerText());
  await option.click();
  await this.page.waitForTimeout(800);
  this._deactivate = await listing(this).readDeactivateDialog();
  this.attach(`Chose receiver: ${this._chosenReceiver}`, 'text/plain');
});

When('I reopen the Deactivate dialog for that agent', { timeout: 120000 }, async function () {
  await listing(this).openDeactivateDialog(this._agent.email);
  this._deactivate = await listing(this).readDeactivateDialog();
});

Then('the receiving agent picker should be empty', async function () {
  const value = await listing(this).deactivateDialog.locator('input[placeholder*="select an agent" i]').first()
    .inputValue().catch(() => null);
  expect(value, 'the picker is not present').not.toBeNull();
  expect(value, `the reopened dialog still holds "${value}" from the previous visit`).toBe('');
});
