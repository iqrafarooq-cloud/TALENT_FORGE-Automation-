// Steps for features/SuperAdmin_Portal/Community/Community-Listing-And-Page-Values.feature - the
// SuperAdmin Community coverage pass of 2026-11-02. READ-ONLY: nothing is saved, every failure is
// a page.route() stub. Measured with scripts/probe-community-superadmin-gaps.js.
//
// Every value is compared with the response the app itself received - never with literals -
// because the listing (145 communities) and the member lists are shared, growing DEV data.
//
// Measured 2026-11-02:
//   listing   GET /community/?page=<n>&page_size=12[&search=]   -> {count, results[{id, name,
//             candidate_count, description, location, institution}]}. Page and search are NOT in
//             the URL; a page already fetched re-renders with NO request.
//   community GET /community/<id>/ -> {name, description, member_count, location}
//             GET /community/<id>/candidates/?page=<n>&page_size=12[&search=][&grad_year=]
//                 [&major=<field of study id>][&qualification=STUDENT|ALUMNI]
//   unknown   /community/view/<unknown> -> "404 Page not found"; /community/edit/<unknown> renders
//             an EMPTY Edit form (known issue)
//   "Majors" is the only filter trigger that is a <div tabindex=0> with no button role.
const { Given, When, Then, Before, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');

const PAGE_SIZE = 12;
const TABLE = { timeout: 300000 };
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// ==================== University fallback (no university left to create a community for) ====================

// MEASURED 2026-11-02: DEV holds NO university without a community -
// GET /institutions/?unassigned=true answers {count: 0}, and the Create form's University
// dropdown says "No institutions available for assignment.". Every scenario that FILLS the Create
// form (Save gating, clearing a field, the About University cap, a failed create, leaving the
// form) then fails before it reaches the rule it is about.
//
// So for those scenarios ONLY, and ONLY while the server has none, the unassigned-universities
// request is answered with two REAL universities (taken from communities on the listing) and the
// report says so. Two guarantees keep that honest:
//   - when the server does hold an unassigned university, its own answer passes through untouched;
//   - every POST to the community API is aborted in these scenarios, so a stand-in university can
//     never be saved (a scenario that stubs the save itself registers its route later and wins).
// @creates-community and @real-universities scenarios never get the stand-in: they are about the
// real list.
const INSTITUTIONS_RE = /\/api\/v1\/institutions\/\?.*unassigned=true/;

Before({ tags: '@community-admin and not @creates-community and not @real-universities' }, async function () {
  const world = this;
  world._cpgStandIn = null;
  await this.page.route(INSTITUTIONS_RE, async (route) => {
    const real = await route.fetch();
    let body = null;
    try { body = await real.json(); } catch (_) { /* not json */ }
    if (!body || body.count > 0) return route.fulfill({ response: real });
    const listUrl = new URL('/core/api/v1/community/?page=1&page_size=12', route.request().url()).toString();
    const list = await (await route.fetch({ url: listUrl })).json().catch(() => ({ results: [] }));
    const standIns = (list.results || []).map((c) => c.institution).filter(Boolean).slice(0, 2);
    const term = (new URL(route.request().url()).searchParams.get('search') || '').toLowerCase();
    const results = standIns.filter((i) => i.name.toLowerCase().includes(term));
    world._cpgStandIn = standIns.map((i) => i.name);
    return route.fulfill({ response: real, json: { count: results.length, next: null, previous: null, results } });
  });
  await this.page.route(/\/api\/v1\/community/, (route) => (route.request().method() === 'POST'
    ? route.abort('blockedbyclient')
    : route.fallback()));
});

After({ tags: '@community-admin and not @creates-community and not @real-universities' }, async function () {
  if (this._cpgStandIn && this._cpgStandIn.length) {
    await this.attach(`NO UNIVERSITY IS LEFT WITHOUT A COMMUNITY on this environment, so the Create form was offered stand-in universities (${this._cpgStandIn.join(', ')}). Every community POST was blocked, so nothing was created.`, 'text/plain');
  }
});

// ==================== Recorder ====================

// Installed before the scenario's first navigation, so requests that fire on load are seen.
function rec(world) {
  if (world._cpg) return world._cpg;
  // `pending` holds every body still being parsed: a response event handler is not awaited by
  // Playwright, so "the response arrived" is not "its body has been read".
  const r = { reqs: [], lists: [], details: [], members: [], posts: [], pending: [] };
  world.page.on('request', (q) => {
    const u = q.url();
    if (!/\/api\/v1\//.test(u) || /notifications|token\/refresh|auth\/me/.test(u)) return;
    r.reqs.push({ method: q.method(), url: u });
    if (q.method() !== 'GET' && /\/api\/v1\/community/.test(u)) r.posts.push(`${q.method()} ${u}`);
  });
  world.page.on('response', (res) => {
    const u = res.url();
    if (res.request().method() !== 'GET' || !/\/api\/v1\/community/.test(u)) return;
    // the slot is taken in arrival order, the body filled in when it has been read
    const entry = { url: u, status: res.status(), body: null };
    if (/\/api\/v1\/community\/\?/.test(u)) r.lists.push(entry);
    else if (/\/api\/v1\/community\/[^/]+\/candidates\//.test(u)) r.members.push(entry);
    else if (/\/api\/v1\/community\/[^/?]+\/$/.test(u)) r.details.push(entry);
    else return;
    r.pending.push(res.json().then((b) => { entry.body = b; }, () => {}));
  });
  world._cpg = r;
  return r;
}

const origin = () => new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
const params = (u) => new URL(u).searchParams;
const lastList = (world) => rec(world).lists[rec(world).lists.length - 1];
const lastMembers = (world) => rec(world).members[rec(world).members.length - 1];

// Runs an action and waits for the response it should cause. Resolves to null when none came
// (a page the app already fetched re-renders from cache).
async function withResponse(world, re, action, timeout = 20000) {
  const wait = world.page.waitForResponse((res) => re.test(res.url()) && res.request().method() === 'GET', { timeout }).catch(() => null);
  await action();
  const res = await wait;
  if (res) {
    // the recorder's handler may not have run yet - give it a tick, then await every parse
    await world.page.waitForTimeout(100);
    await Promise.all(rec(world).pending);
  }
  return res;
}

const LIST_RE = /\/api\/v1\/community\/\?/;
const MEMBERS_RE = /\/api\/v1\/community\/[^/]+\/candidates\//;
const pager = (world, label) => world.page.locator(`nav[aria-label="Pagination Navigation"] [aria-label="${label}"]:visible`).first();
const pageButton = (world, n) => world.page.locator(`[data-testid="pagination-page-${n}-button"]:visible`).first();

// ==================== Readers ====================

async function readListingCards(world) {
  return world.page.locator('main article').evaluateAll((as) => as.map((a) => {
    const name = (a.querySelector('h3') || {}).innerText || '';
    const m = (a.innerText || '').match(/(\d+)\s+(Members?)/);
    return { name: name.replace(/\s+/g, ' ').trim(), count: m ? Number(m[1]) : null, label: m ? m[0] : null };
  }));
}

// Polls until the rendered cards are the payload's, in order - the grid keeps the previous
// query's cards while the next is in flight.
async function settledListing(world, payload) {
  const want = (payload.results || []).map((c) => c.name);
  let cards = [];
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    cards = await readListingCards(world);
    if (JSON.stringify(cards.map((c) => c.name)) === JSON.stringify(want)) return cards;
    await world.page.waitForTimeout(400);
  }
  return cards;
}

async function readMemberCards(world) {
  return world.page.locator('main article').evaluateAll((as) => as.map((a) => {
    const lines = (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const name = ((a.querySelector('h3') || {}).innerText || '').replace(/\s+/g, ' ').trim();
    const i = lines.indexOf(name);
    const after = i >= 0 ? lines.slice(i + 1) : [];
    const year = after.find((l) => /^\d{4}$/.test(l)) || null;
    const major = after[0] && after[0] !== year && after[0] !== 'Track:' ? after[0] : null;
    const t = lines.indexOf('Track:');
    return { name, major, year, track: t >= 0 ? lines[t + 1] : null };
  }));
}

async function settledMembers(world, payload) {
  const want = (payload.results || []).map((m) => clean(`${m.user.firstname} ${m.user.lastname}`));
  let cards = [];
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    cards = await readMemberCards(world);
    if (JSON.stringify(cards.map((c) => c.name)) === JSON.stringify(want)) return cards;
    await world.page.waitForTimeout(400);
  }
  return cards;
}

async function readHeader(world) {
  const main = world.page.locator('main').first();
  const name = clean(await main.locator('h1').first().innerText().catch(() => ''));
  const lines = (await main.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
  const ci = lines.findIndex((l) => /^\d+\s+Members?$/.test(l));
  const ni = lines.indexOf(name);
  return {
    name,
    count: ci >= 0 ? Number(lines[ci].match(/\d+/)[0]) : null,
    countLabel: ci >= 0 ? lines[ci] : null,
    // a community with no location renders nothing there, so the next line is the filter bar
    location: ci >= 0 && lines[ci + 1] && !/^(Grad Years|Majors|Members)\d*$/.test(lines[ci + 1]) ? lines[ci + 1] : null,
    description: ni >= 0 && ci > ni ? clean(lines.slice(ni + 1, ci).join(' ')) : null,
  };
}

// Watches a window for a navigation, a dialog or a request after a click - an absence is never
// sampled once.
async function inert(world, locator, label) {
  const r = rec(world);
  const url = world.page.url();
  const before = r.reqs.length;
  await locator.click();
  await world.page.waitForTimeout(1500);
  const problems = [];
  if (world.page.url() !== url) problems.push(`${label} navigated to ${world.page.url()}`);
  const dialogs = await world.page.locator('[role="dialog"]:visible').count();
  if (dialogs) problems.push(`${label} opened ${dialogs} dialog(s)`);
  const sent = r.reqs.slice(before).map((q) => `${q.method} ${q.url}`);
  if (sent.length) problems.push(`${label} sent ${sent.join(', ')}`);
  if (world.page.url() !== url) await world.page.goto(url);
  return problems;
}

function fail(problems, context) {
  if (problems.length) throw new Error(`${context} (${problems.length}):\n- ${problems.join('\n- ')}`);
}

// ==================== LISTING ====================

Given('I have opened the Community listing', { timeout: 90000 }, async function () {
  rec(this);
  const res = await withResponse(this, LIST_RE, () => this.page.goto(`${origin()}/community`, { waitUntil: 'domcontentloaded' }), 45000);
  expect(res, 'the Community listing never requested its first page').toBeTruthy();
  const p = lastList(this);
  this._cpgFirstPage = p.body;
  this._cpgTotal = p.body.count;
  await settledListing(this, p.body);
});

Then('every community card should match the server on each of these listing pages:', TABLE, async function (table) {
  const problems = [];
  const singular = [];
  const last = Math.ceil(this._cpgTotal / PAGE_SIZE);
  for (const { page } of table.hashes()) {
    const n = page === 'last' ? last : Number(page);
    let payload;
    if (n === 1) {
      // the Given just loaded page 1, and a page already fetched re-renders with no request
      if (!(await pager(this, 'Previous Page').isDisabled())) await pageButton(this, 1).click();
      payload = this._cpgFirstPage;
    } else {
      const res = await withResponse(this, LIST_RE, () => pageButton(this, n).click());
      if (!res) { problems.push(`page ${n}: no request was sent`); continue; }
      payload = lastList(this).body;
      if (params(lastList(this).url).get('page') !== String(n)) problems.push(`page ${n}: the request asked for page ${params(lastList(this).url).get('page')}`);
    }
    const cards = await settledListing(this, payload);
    const want = payload.results;
    if (cards.length !== want.length) problems.push(`page ${n}: ${cards.length} card(s) rendered, the server sent ${want.length}`);
    want.forEach((c, i) => {
      const got = cards[i];
      if (!got) return;
      if (got.name !== c.name) problems.push(`page ${n} card ${i + 1}: shows "${got.name}", the server's card ${i + 1} is "${c.name}" (order kept?)`);
      if (got.count !== c.candidate_count) problems.push(`page ${n} "${c.name}": shows ${got.label}, the server says ${c.candidate_count}`);
      if (got.label === '1 Members') singular.push(`${c.name}: "1 Members"`);
    });
  }
  if (singular.length) await this.attach(`Recorded for the PO, not failed on - a count of one reads plural:\n${singular.join('\n')}`, 'text/plain');
  fail(problems, 'Community cards that do not match the server');
});

Then('the community listing should page 12 at a time with working Previous, Next and numbered pages', TABLE, async function () {
  const problems = [];
  const total = this._cpgTotal;
  const last = Math.ceil(total / PAGE_SIZE);
  const first = this._cpgFirstPage;
  if (first.results.length !== Math.min(PAGE_SIZE, total)) problems.push(`page 1 holds ${first.results.length}, expected ${Math.min(PAGE_SIZE, total)}`);
  const asked = params(rec(this).lists[0].url);
  if (asked.get('page_size') !== String(PAGE_SIZE)) problems.push(`the listing asked for page_size=${asked.get('page_size')}`);
  if (!(await pager(this, 'Previous Page').isDisabled())) problems.push('Previous is enabled on page 1');
  if (last < 2) { await this.attach(`only ${total} communities - one page, nothing to page`, 'text/plain'); return fail(problems, 'Listing paging'); }
  const go = async (label, locator, want) => {
    const res = await withResponse(this, LIST_RE, () => locator.click());
    const page = res ? params(res.url()).get('page') : null;
    if (page !== String(want)) problems.push(`${label} asked for page ${page}, expected ${want}`);
    if (res) await settledListing(this, lastList(this).body);
  };
  await go('Next', pager(this, 'Next Page'), 2);
  await go(`Page ${last}`, pageButton(this, last), last);
  const lastCards = await readListingCards(this);
  const remainder = total - PAGE_SIZE * (last - 1);
  if (lastCards.length !== remainder) problems.push(`the last page shows ${lastCards.length} card(s), ${total} communities leave ${remainder}`);
  if (!(await pager(this, 'Next Page').isDisabled())) problems.push('Next is enabled on the last page');
  if (last > 2) await go('Previous', pager(this, 'Previous Page'), last - 1);
  // a page the app already fetched re-renders from its cache, with no request
  const before = rec(this).reqs.length;
  await pageButton(this, 1).click();
  const cards = await settledListing(this, first);
  if (JSON.stringify(cards.map((c) => c.name)) !== JSON.stringify(first.results.map((c) => c.name))) problems.push('returning to page 1 did not show page 1\'s communities');
  const refetch = rec(this).reqs.slice(before).filter((q) => LIST_RE.test(q.url));
  await this.attach(`Returning to page 1: ${refetch.length ? `re-requested (${refetch.map((q) => q.url).join(', ')})` : 'served from cache, no request'}`, 'text/plain');
  fail(problems, 'Listing paging');
});

When('I go to page 2 of the Community listing', async function () {
  const res = await withResponse(this, LIST_RE, () => pageButton(this, 2).click());
  expect(res, 'Page 2 sent no request').toBeTruthy();
  this._cpgPage2 = lastList(this).body;
  await settledListing(this, this._cpgPage2);
});

When('I search the Community listing for the first word of the first community on that page', async function () {
  const name = this._cpgPage2.results[0].name;
  this._cpgTerm = name.split(/\s+/)[0];
  const box = this.page.getByRole('searchbox').first();
  await withResponse(this, LIST_RE, async () => { await box.fill(''); await box.pressSequentially(this._cpgTerm, { delay: 30 }); });
});

Then('the community search should ask the server for page 1 of that term and list only matching communities', async function () {
  const l = lastList(this);
  const p = params(l.url);
  const problems = [];
  if (p.get('search') !== this._cpgTerm) problems.push(`the request searched "${p.get('search')}", expected "${this._cpgTerm}"`);
  if (p.get('page') !== '1') problems.push(`the search asked for page ${p.get('page')}, expected page 1`);
  const cards = await settledListing(this, l.body);
  if (!cards.length) problems.push(`no community listed for "${this._cpgTerm}"`);
  const stray = cards.filter((c) => !c.name.toLowerCase().includes(this._cpgTerm.toLowerCase()));
  if (stray.length) problems.push(`listed without "${this._cpgTerm}" in the name: ${stray.map((c) => c.name).join(', ')}`);
  const pagerShown = await this.page.locator('nav[aria-label="Pagination Navigation"]:visible').count();
  if (l.body.count <= PAGE_SIZE && pagerShown) problems.push(`${l.body.count} result(s) fit one page but a pager is shown`);
  if (l.body.count > PAGE_SIZE && !pagerShown) problems.push(`${l.body.count} results need a pager and none is shown`);
  fail(problems, 'Community search from a later page');
});

When('I search the Community listing for only spaces', async function () {
  this._cpgBefore = rec(this).reqs.length;
  const box = this.page.getByRole('searchbox').first();
  await box.fill('');
  await box.pressSequentially('   ', { delay: 30 });
  await this.page.waitForTimeout(3000);
});

Then('no community listing request should have been sent and the first page should still be listed', async function () {
  const sent = rec(this).reqs.slice(this._cpgBefore).filter((q) => LIST_RE.test(q.url));
  expect(sent.map((q) => q.url), 'a whitespace-only search was sent to the server').toEqual([]);
  const cards = await readListingCards(this);
  expect(cards.map((c) => c.name)).toEqual(this._cpgFirstPage.results.map((c) => c.name));
});

Then('the Community listing URL should carry neither the page nor the search', async function () {
  const u = new URL(this.page.url());
  expect(u.pathname).toBe('/community');
  expect(u.search, 'the listing wrote its page or search into the URL').toBe('');
});

When('I reload the Community listing', { timeout: 90000 }, async function () {
  await withResponse(this, LIST_RE, () => this.page.reload({ waitUntil: 'domcontentloaded' }), 45000);
});

Then('the Community listing should be back on its first page with an empty search', async function () {
  const l = lastList(this);
  const p = params(l.url);
  expect(p.get('page'), 'the reload did not ask for page 1').toBe('1');
  expect(p.get('search') || '', 'the reload kept a search').toBe('');
  expect(await this.page.getByRole('searchbox').first().inputValue()).toBe('');
  await settledListing(this, l.body);
});

Then("clicking the first community card's university name should open nothing and send nothing", async function () {
  fail(await inert(this, this.page.locator('main article h3 button').first(), 'the university name'), 'The card name is not inert');
});

Then('Tab from the community search should reach Create Community, then the first card\'s Edit Community and View Community', async function () {
  const first = this._cpgFirstPage.results[0];
  await this.page.getByRole('searchbox').first().focus();
  const stops = [];
  for (let i = 0; i < 3; i++) {
    await this.page.keyboard.press('Tab');
    stops.push(await this.page.evaluate(() => {
      const e = document.activeElement;
      return { text: (e.innerText || e.getAttribute('aria-label') || '').trim(), href: e.getAttribute('href') };
    }));
  }
  const want = [
    { text: 'Create Community', href: '/community/create' },
    { text: 'Edit Community', href: `/community/edit/${first.id}` },
    { text: 'View Community', href: `/community/view/${first.id}` },
  ];
  expect(stops, 'the Tab order from the search box').toEqual(want);
});

When('I press Enter on the focused View Community link', { timeout: 60000 }, async function () {
  this._cpgOpened = this._cpgFirstPage.results[0];
  await this.page.keyboard.press('Enter');
});

Then('that community\'s page should open', { timeout: 60000 }, async function () {
  await this.page.waitForURL(new RegExp(`/community/view/${this._cpgOpened.id}$`), { timeout: 30000 });
  await expect(this.page.locator('main h1').first()).toHaveText(this._cpgOpened.name, { timeout: 20000 });
});

When('I open Community from the sidebar while on the Audit Logs page', { timeout: 90000 }, async function () {
  rec(this);
  await this.page.goto(`${origin()}/audit-logs`, { waitUntil: 'domcontentloaded' });
  await this.page.locator('nav a[href="/community"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await withResponse(this, LIST_RE, () => this.page.locator('nav a[href="/community"]').first().click(), 30000);
});

Then('the Community listing should open on its first page', async function () {
  await expect(this.page).toHaveURL(/\/community$/);
  const l = lastList(this);
  expect(l, 'the listing was never requested').toBeTruthy();
  expect(params(l.url).get('page')).toBe('1');
  const cards = await settledListing(this, l.body);
  expect(cards.length).toBe(l.body.results.length);
});

Then('each of these community listing failures should say "Something went wrong." rather than list no communities:', TABLE, async function (table) {
  const problems = [];
  for (const { failure } of table.hashes()) {
    await this.page.route(LIST_RE, (r) => (/network/i.test(failure)
      ? r.abort('internetdisconnected')
      : r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed"}' })));
    await this.page.goto(`${origin()}/community`, { waitUntil: 'domcontentloaded' });
    let text = '';
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      text = clean(await this.page.locator('main').first().innerText().catch(() => ''));
      if (/something went wrong/i.test(text)) break;
      await this.page.waitForTimeout(500);
    }
    await this.page.unroute(LIST_RE);
    if (!/Something went wrong\./.test(text)) problems.push(`${failure}: the page read "${text.slice(0, 160)}"`);
    if (/no communities/i.test(text)) problems.push(`${failure}: the failure is presented as "No communities"`);
    if (await this.page.locator('main article').count()) problems.push(`${failure}: community cards were rendered`);
  }
  fail(problems, 'Listing failures not reported');
});

// ==================== COMMUNITY PAGE ====================

async function openCommunity(world, pick, label) {
  rec(world);
  const lr = await withResponse(world, LIST_RE, () => world.page.goto(`${origin()}/community`, { waitUntil: 'domcontentloaded' }), 45000);
  expect(lr, 'the Community listing never loaded').toBeTruthy();
  const chosen = lastList(world).body.results.find(pick);
  if (!chosen) throw new Error(`no community on the listing's first page ${label}`);
  world._cpgCommunity = chosen;
  const mr = await withResponse(world, MEMBERS_RE, () => world.page.goto(`${origin()}/community/view/${chosen.id}`, { waitUntil: 'domcontentloaded' }), 45000);
  expect(mr, `community ${chosen.id} never requested its members`).toBeTruthy();
  world._cpgMembersPage1 = lastMembers(world).body;
  await world.attach(`Community: ${chosen.name} (id ${chosen.id}, ${chosen.candidate_count} on its listing card)`, 'text/plain');
}

Given('I have opened a community that has more than one page of members', { timeout: 150000 }, async function () {
  await openCommunity(this, (c) => c.candidate_count > PAGE_SIZE, `with more than ${PAGE_SIZE} members`);
  await settledMembers(this, this._cpgMembersPage1);
});

Given('I have opened a community that has no members', { timeout: 150000 }, async function () {
  await openCommunity(this, (c) => c.candidate_count === 0, 'with no members');
});

Then('the community header should match the server', async function () {
  const detail = rec(this).details.filter((d) => d.url.includes(`/community/${this._cpgCommunity.id}/`)).pop();
  expect(detail, 'the community itself was never requested').toBeTruthy();
  const d = detail.body;
  let h;
  const end = Date.now() + 15000;
  do { h = await readHeader(this); if (h.name === d.name) break; await this.page.waitForTimeout(400); } while (Date.now() < end);
  const problems = [];
  if (h.name !== d.name) problems.push(`name "${h.name}", the server says "${d.name}"`);
  if (h.count !== d.member_count) problems.push(`count ${h.countLabel}, the server says ${d.member_count}`);
  if (h.count !== this._cpgMembersPage1.count) problems.push(`count ${h.countLabel}, the member list holds ${this._cpgMembersPage1.count}`);
  if (h.count !== this._cpgCommunity.candidate_count) problems.push(`count ${h.countLabel}, its listing card said ${this._cpgCommunity.candidate_count}`);
  const loc = (d.location && d.location.location_name) || null;
  if (h.location !== loc) problems.push(`location "${h.location}", the server says "${loc}"`);
  const desc = clean(d.description);
  if ((h.description || '') !== desc) problems.push(`description "${h.description}", the server says "${desc}"`);
  await this.attach(JSON.stringify({ rendered: h, server: { name: d.name, member_count: d.member_count, location: loc, description: d.description } }, null, 2), 'application/json');
  fail(problems, 'Community header against the server');
});

function compareMembers(payload, cards, where) {
  const problems = [];
  if (cards.length !== payload.results.length) problems.push(`${where}: ${cards.length} card(s), the server sent ${payload.results.length}`);
  payload.results.forEach((m, i) => {
    const c = cards[i];
    if (!c) return;
    const name = clean(`${m.user.firstname} ${m.user.lastname}`);
    if (c.name !== name) problems.push(`${where} card ${i + 1}: "${c.name}", the server's member ${i + 1} is "${name}"`);
    if (m.major && c.major !== m.major) problems.push(`${where} "${name}": major "${c.major}", the server says "${m.major}"`);
    if (m.grad_year && c.year !== String(m.grad_year)) problems.push(`${where} "${name}": year "${c.year}", the server says ${m.grad_year}`);
  });
  return problems;
}

Then('every member card should match the server on the first and the last member page', TABLE, async function () {
  const problems = compareMembers(this._cpgMembersPage1, await settledMembers(this, this._cpgMembersPage1), 'page 1');
  const last = Math.ceil(this._cpgMembersPage1.count / PAGE_SIZE);
  if (last > 1) {
    const res = await withResponse(this, MEMBERS_RE, () => pageButton(this, last).click());
    if (!res) problems.push(`page ${last}: no request was sent`);
    else problems.push(...compareMembers(lastMembers(this).body, await settledMembers(this, lastMembers(this).body), `page ${last}`));
  }
  fail(problems, 'Member cards that do not match the server');
});

Then('the member list should page 12 at a time and a member search from the last page should return to page 1', TABLE, async function () {
  const problems = [];
  const total = this._cpgMembersPage1.count;
  const last = Math.ceil(total / PAGE_SIZE);
  if (this._cpgMembersPage1.results.length !== PAGE_SIZE) problems.push(`page 1 holds ${this._cpgMembersPage1.results.length} members`);
  if (!(await pager(this, 'Previous Page').isDisabled())) problems.push('Previous is enabled on page 1');
  let res = await withResponse(this, MEMBERS_RE, () => pager(this, 'Next Page').click());
  if (!res || params(res.url()).get('page') !== '2') problems.push(`Next asked for page ${res && params(res.url()).get('page')}`);
  // with exactly two pages, Next has already landed on the last one
  if (last > 2) {
    res = await withResponse(this, MEMBERS_RE, () => pageButton(this, last).click());
    if (!res || params(res.url()).get('page') !== String(last)) problems.push(`Page ${last} asked for page ${res && params(res.url()).get('page')}`);
  }
  const cards = await settledMembers(this, lastMembers(this).body);
  if (cards.length !== total - PAGE_SIZE * (last - 1)) problems.push(`the last page shows ${cards.length}, ${total} members leave ${total - PAGE_SIZE * (last - 1)}`);
  if (!(await pager(this, 'Next Page').isDisabled())) problems.push('Next is enabled on the last page');
  const term = clean(this._cpgMembersPage1.results[0].user.firstname).slice(0, 3);
  const box = this.page.getByTestId('admin-community-detail-search-input');
  res = await withResponse(this, MEMBERS_RE, async () => { await box.fill(''); await box.pressSequentially(term, { delay: 30 }); });
  const p = res ? params(res.url()) : new URLSearchParams();
  if (p.get('search') !== term) problems.push(`the member search sent search=${p.get('search')}, expected "${term}"`);
  if (p.get('page') !== '1') problems.push(`the member search from page ${last} asked for page ${p.get('page')}`);
  fail(problems, 'Member list paging');
});

When('I apply each of these member filters in turn:', TABLE, async function (table) {
  const applied = [];
  const triggerFor = (f) => ({
    'Grad Years': this.page.getByTestId('admin-community-detail-grad-years-filter-button'),
    Majors: this.page.locator('main').first().getByText(/^Majors\d*$/).first(),
    Members: this.page.getByTestId('admin-community-detail-members-filter-button'),
  }[f]);
  for (const { filter, option } of table.hashes()) {
    await triggerFor(filter).click();
    const dialog = this.page.locator('[role="dialog"]').last();
    await dialog.getByRole('checkbox').first().waitFor({ state: 'attached', timeout: 15000 });
    const box = option === 'the first option'
      ? dialog.getByRole('checkbox').first()
      : dialog.getByRole('checkbox', { name: option, exact: true });
    // The option's text is on a label; the checkbox's own value is just "on". Measured 2026-11-03:
    // each option now nests TWO labels - the inner one wraps only the checkbox box and has no text,
    // the outer one holds the option text - so take the nearest label that actually has text.
    // Majors differs: its option is a <button data-testid="...-option-checkbox"> around an empty
    // label, so a <button> host is accepted too.
    const label = box.locator('xpath=ancestor::*[self::label or self::button][normalize-space(.) != ""][1]');
    const name = await label.textContent();
    if (!clean(name)) throw new Error(`${filter}: the chosen option's label could not be read`);
    const res = await withResponse(this, MEMBERS_RE, () => label.click());
    applied.push({ filter, option: clean(name), url: res ? res.url() : null });
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(600);
  }
  this._cpgApplied = applied;
  await this.attach(applied.map((a) => `${a.filter} "${a.option}" -> ${a.url}`).join('\n'), 'text/plain');
});

Then('each filter should have sent its own parameter and the last request should carry all of them:', async function (table) {
  const problems = [];
  const all = this._cpgApplied;
  table.hashes().forEach(({ filter, parameter, value }) => {
    const a = all.find((x) => x.filter === filter);
    if (!a || !a.url) { problems.push(`${filter}: applying it sent no request`); return; }
    const got = params(a.url).get(parameter);
    const want = value === 'the option chosen' ? a.option : value;
    if (value === 'a number' ? !/^\d+$/.test(got || '') : got !== want) problems.push(`${filter}: ${parameter}=${got}, expected ${want}`);
    if (params(a.url).get('page') !== '1') problems.push(`${filter}: asked for page ${params(a.url).get('page')}`);
  });
  const lastUrl = all[all.length - 1].url;
  for (const { parameter } of table.hashes()) if (lastUrl && !params(lastUrl).get(parameter)) problems.push(`the last request dropped ${parameter}: ${lastUrl}`);
  // what is listed is what the last request returned
  const cards = await settledMembers(this, lastMembers(this).body);
  if (cards.length !== lastMembers(this).body.results.length) problems.push(`${cards.length} card(s) shown, the filtered request returned ${lastMembers(this).body.results.length}`);
  fail(problems, 'Member filter requests');
});

Then('the community URL should carry neither the member search nor the filters', async function () {
  const u = new URL(this.page.url());
  expect(u.pathname).toBe(`/community/view/${this._cpgCommunity.id}`);
  expect(u.search, 'the community page wrote its search or filters into the URL').toBe('');
});

When('I reload the community page', { timeout: 90000 }, async function () {
  await withResponse(this, MEMBERS_RE, () => this.page.reload({ waitUntil: 'domcontentloaded' }), 45000);
});

Then('the member list should be back on its first page with no search and no filter', async function () {
  const p = params(lastMembers(this).url);
  const kept = ['search', 'grad_year', 'major', 'qualification'].filter((k) => p.get(k));
  expect(kept, `the reload kept ${kept.join(', ')}`).toEqual([]);
  expect(p.get('page')).toBe('1');
  const triggers = await this.page.locator('main').first().getByText(/^(Grad Years|Majors|Members)\d+$/).allInnerTexts();
  expect(triggers, 'a filter trigger still shows a selection count').toEqual([]);
});

Then("clicking the header's name and location and the first member card's name, major and track should open nothing and send nothing", { timeout: 90000 }, async function () {
  const main = this.page.locator('main').first();
  const card = main.locator('article').first();
  const problems = [];
  problems.push(...await inert(this, main.locator('h1 button').first(), 'the community name'));
  const loc = (await readHeader(this)).location;
  if (loc) problems.push(...await inert(this, main.getByRole('button', { name: loc, exact: true }).first(), 'the location'));
  problems.push(...await inert(this, card.locator('h3 button').first(), 'the member name'));
  const btns = card.locator('button:not([data-testid])');
  const n = await btns.count();
  for (let i = 1; i < n; i++) problems.push(...await inert(this, btns.nth(i), `member card button "${clean(await btns.nth(i).innerText())}"`));
  fail(problems, 'Controls that are not inert');
});

Then('View Profile on the first member card should open that member\'s public profile', { timeout: 60000 }, async function () {
  const m = lastMembers(this).body.results[0];
  this._cpgBackTo = this.page.url();
  await this.page.getByTestId('admin-community-member-view-profile-button').first().click();
  await this.page.waitForURL(new RegExp(`/profile/${m.user.public_id}$`), { timeout: 30000 });
  await expect(this.page.locator('main').first()).toContainText(clean(`${m.user.firstname} ${m.user.lastname}`), { timeout: 20000 });
});

Then('the browser Back button should return to the same community page', { timeout: 60000 }, async function () {
  await this.page.goBack();
  await this.page.waitForURL(this._cpgBackTo, { timeout: 30000 });
  await expect(this.page.locator('main h1').first()).toHaveText(this._cpgCommunity.name, { timeout: 20000 });
});

Then('the community page\'s Edit Community should open that community\'s edit form and its Back should return to the listing', { timeout: 90000 }, async function () {
  const id = this._cpgCommunity.id;
  await expect(this.page.getByTestId('admin-community-detail-edit-button')).toHaveAttribute('href', `/community/edit/${id}`);
  await this.page.getByTestId('admin-community-detail-edit-button').click();
  await this.page.waitForURL(new RegExp(`/community/edit/${id}$`), { timeout: 30000 });
  await expect(this.page.getByTestId('admin-community-form-save-button')).toBeVisible({ timeout: 20000 });
  await this.page.goto(`${origin()}/community/view/${id}`, { waitUntil: 'domcontentloaded' });
  const res = await withResponse(this, LIST_RE, () => this.page.getByTestId('admin-community-detail-back-button').click(), 30000);
  await expect(this.page).toHaveURL(/\/community$/);
  expect(res && params(res.url()).get('page'), 'Back did not open the listing\'s first page').toBe('1');
});

Then('each of these community routes should show the "404 Page not found" page:', TABLE, async function (table) {
  const problems = [];
  for (const { route } of table.hashes()) {
    await this.page.goto(`${origin()}${route}`, { waitUntil: 'domcontentloaded' });
    let text = '';
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      text = clean(await this.page.locator('body').innerText().catch(() => ''));
      if (/404|page not found|edit community/i.test(text)) break;
      await this.page.waitForTimeout(500);
    }
    await this.page.waitForTimeout(1500);
    text = clean(await this.page.locator('body').innerText().catch(() => ''));
    if (!/Page not found/.test(text)) problems.push(`${route}: no "Page not found" - the page read "${text.slice(0, 200)}"`);
    if (await this.page.getByTestId('admin-community-form-save-button').count()) problems.push(`${route}: an edit form with Save was rendered`);
  }
  fail(problems, 'Routes that do not report a missing community');
});

Then('a failed load of that community should be reported as an error rather than as "Page not found"', { timeout: 90000 }, async function () {
  const id = this._cpgCommunity.id;
  const re = new RegExp(`/api/v1/community/${id}/$`);
  await this.page.route(re, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed"}' }));
  await this.page.goto(`${origin()}/community/view/${id}`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForTimeout(6000);
  const text = clean(await this.page.locator('body').innerText());
  await this.page.unroute(re);
  await this.attach(`Rendered on a 500: ${text.slice(0, 300)}`, 'text/plain');
  expect(text, 'a server error on an existing community is presented as a missing page').not.toMatch(/Page not found|does not exist/);
  expect(text).toMatch(/something went wrong|error|try again/i);
});

Then('a failed load of its member list should not present the community as having no members', { timeout: 90000 }, async function () {
  const id = this._cpgCommunity.id;
  const re = new RegExp(`/api/v1/community/${id}/candidates/`);
  await this.page.route(re, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed"}' }));
  await this.page.goto(`${origin()}/community/view/${id}`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForTimeout(6000);
  const text = clean(await this.page.locator('main').first().innerText());
  await this.page.unroute(re);
  await this.attach(`Rendered on a member-list 500: ${text.slice(0, 300)}`, 'text/plain');
  const problems = [];
  if (/No members yet/i.test(text)) problems.push('the failure is presented as "No members yet"');
  if (await this.page.locator('main article').count()) problems.push('member cards were rendered');
  if (!(await this.page.locator('main h1').first().innerText()).includes(this._cpgCommunity.name)) problems.push('the header did not render');
  fail(problems, 'Member list failure');
});

// ==================== CREATE / EDIT ====================

Then('the Create Community page should offer an Exit link back to the Community listing', async function () {
  const exit = this.page.getByTestId('admin-community-form-exit-button');
  await expect(exit, 'the Create Community page offers no Exit').toBeVisible({ timeout: 20000 });
  await expect(exit).toHaveText('Exit');
  await expect(exit).toHaveAttribute('href', '/community');
});

When('I leave the Create Community page by Exit', { timeout: 60000 }, async function () {
  this._cpgDialogs = [];
  this.page.on('dialog', (d) => { this._cpgDialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await this.page.getByTestId('admin-community-form-exit-button').click();
  await this.page.waitForURL(/\/community$/, { timeout: 30000 });
  await this.page.waitForTimeout(1500);
});

Then('no create request should have been sent and the community count should be unchanged', { timeout: 90000 }, async function () {
  expect(rec(this).posts, 'a community write was sent').toEqual([]);
  expect(this._cpgDialogs, 'leaving asked for confirmation').toEqual([]);
  expect(await this.page.locator('[role="dialog"]:visible').count(), 'leaving raised a dialog').toBe(0);
  // ask the server afresh rather than trusting a cached listing
  const res = await withResponse(this, LIST_RE, () => this.page.reload({ waitUntil: 'domcontentloaded' }), 45000);
  expect(res, 'the listing was not re-requested').toBeTruthy();
  expect(lastList(this).body.count, 'the number of communities changed').toBe(this._cpgTotal);
});

// ==================== END TO END ====================

When('I search the Community listing for that community\'s name', async function () {
  const box = this.page.getByRole('searchbox').first();
  await withResponse(this, LIST_RE, async () => { await box.fill(''); await box.pressSequentially(this._cpgCommunity.name, { delay: 20 }); });
  await settledListing(this, lastList(this).body);
});

Given('I have noted a community on the listing that has more than one page of members', async function () {
  const c = this._cpgFirstPage.results.find((x) => x.candidate_count > PAGE_SIZE);
  if (!c) throw new Error(`no community on the first page has more than ${PAGE_SIZE} members`);
  this._cpgCommunity = c;
});

When('I open View Community on that community\'s card', { timeout: 60000 }, async function () {
  const card = this.page.locator('main article').filter({ has: this.page.locator('h3', { hasText: this._cpgCommunity.name }) }).first();
  const res = await withResponse(this, MEMBERS_RE, () => card.getByRole('link', { name: 'View Community' }).click(), 30000);
  expect(res, 'the community page never requested its members').toBeTruthy();
  this._cpgMembersPage1 = lastMembers(this).body;
  await settledMembers(this, this._cpgMembersPage1);
});

When('I go to page 2 of its members', async function () {
  const res = await withResponse(this, MEMBERS_RE, () => pageButton(this, 2).click());
  expect(res && params(res.url()).get('page')).toBe('2');
  const problems = compareMembers(lastMembers(this).body, await settledMembers(this, lastMembers(this).body), 'page 2');
  fail(problems, 'Member page 2');
});

// ==================== EDIT: THE STORED IMAGES ====================
// Measured 2026-11-03 (read-only): an existing community's Edit form shows its stored cover with
// "Change photo" / "Remove photo" (admin-community-form-change-cover-button / -remove-cover-button)
// and its stored logo under an avatar-sized "Show photo options" button
// (admin-community-form-logo-actions-button). The logo's "Remove photo" is hover-revealed for a
// mouse; from the keyboard, Enter on the options button sets aria-expanded=true and reveals it,
// Tab reaches it and Enter removes the logo. Removing either image writes nothing - the change is
// only sent with Save - so a reload brings both stored images back.
// Shares world._communityForm with steps/community.js so both files drive one page object.
const CommunityFormPage = require('../pages/CommunityFormPage');
const editForm = (world) => {
  if (!world._communityForm) world._communityForm = new CommunityFormPage(world.page);
  return world._communityForm;
};

async function waitForBothStoredImages(world, timeout = 30000) {
  const f = editForm(world);
  const until = Date.now() + timeout;
  let previews = [];
  while (Date.now() < until) {
    previews = await f.imagePreviews();
    if (previews.some((p) => p.field === 'cover') && previews.some((p) => p.field === 'logo')) return previews;
    await world.page.waitForTimeout(500);
  }
  return previews;
}

Then('the Edit Community form should show the community\'s stored cover photo and logo', { timeout: 60000 }, async function () {
  const previews = await waitForBothStoredImages(this);
  const fields = previews.map((p) => p.field);
  expect(fields, `the Edit form should show the stored cover and logo; previews: ${JSON.stringify(previews)}`).toEqual(expect.arrayContaining(['cover', 'logo']));
  const tid = (t) => this.page.locator(`[data-testid="${t}"]`);
  await expect(tid('admin-community-form-change-cover-button'), 'a stored cover offers "Change photo"').toBeVisible();
  await expect(tid('admin-community-form-remove-cover-button'), 'a stored cover offers "Remove photo"').toBeVisible();
  await expect(tid('admin-community-form-logo-actions-button'), 'a stored logo offers its photo options').toHaveAttribute('aria-label', 'Show photo options');
});

Then('both image upload controls should be offered again', async function () {
  const tid = (t) => this.page.locator(`[data-testid="${t}"]`);
  const problems = [];
  if (!(await tid('admin-community-form-cover-upload-button').isVisible())) problems.push('the cover upload control ("Click to upload cover photo") did not come back');
  if (await tid('admin-community-form-change-cover-button').isVisible()) problems.push('"Change photo" is still offered for a removed cover');
  if (!(await tid('admin-community-form-logo-upload-button').isVisible())) problems.push('the logo upload control did not remain available');
  if (await tid('admin-community-form-logo-actions-button').isVisible()) problems.push('the logo\'s photo options are still offered for a removed logo');
  fail(problems, 'Upload controls after removing both stored images');
});

Then('no community write request should have been sent', async function () {
  expect(rec(this).posts, 'removing a stored image wrote to the server before Save').toEqual([]);
});

When('I reload the Edit Community page', { timeout: 90000 }, async function () {
  await this.page.reload({ waitUntil: 'domcontentloaded' });
});

Then('the stored logo\'s Remove photo should be reachable and usable from the keyboard', { timeout: 60000 }, async function () {
  await waitForBothStoredImages(this);
  const actions = this.page.locator('[data-testid="admin-community-form-logo-actions-button"]');
  const remove = this.page.locator('[data-testid="admin-community-form-remove-logo-button"]');
  const problems = [];
  await actions.focus();
  if ((await actions.getAttribute('aria-expanded')) !== 'false') problems.push('the photo options start expanded');
  await this.page.keyboard.press('Enter');
  await expect.poll(() => actions.getAttribute('aria-expanded'), { timeout: 5000 }).toBe('true').catch(() => problems.push('Enter on "Show photo options" did not expand it'));
  const shown = await remove.evaluate((b) => getComputedStyle(b.parentElement).opacity === '1').catch(() => false);
  if (!shown) problems.push('"Remove photo" stayed invisible after the options were opened from the keyboard');
  await this.page.keyboard.press('Tab');
  const focused = await this.page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  if (focused !== 'admin-community-form-remove-logo-button') problems.push(`Tab after opening the options focused "${focused}", not "Remove photo"`);
  await this.page.keyboard.press('Enter');
  await expect.poll(async () => editForm(this).hasPreview('Profile Photo'), { timeout: 8000 }).toBe(false).catch(() => problems.push('Enter on "Remove photo" did not remove the stored logo'));
  fail(problems, 'Removing the stored logo from the keyboard');
});
