/* eslint-disable no-console */
// probe-community-superadmin-gaps.js - READ-ONLY. The SuperAdmin Community behaviour the older
// community probes never measured (2026-11-02 coverage pass):
//
//   listing   - paging (12 per page), the last page, search from a later page, URL/reload, the
//               card name button, server order, a failed list load
//   community - the header and the member list against GET /community/<id>/ and .../candidates/,
//               member paging, search/filter request params, reload, the Majors trigger, member
//               card buttons, View Profile route, Back, an unknown id, failed loads
//   create    - the page's own controls and what leaving it does
//
// It commits NOTHING: nothing is saved, every 500 is a page.route() stub.
//
// Run:  node scripts/probe-community-superadmin-gaps.js [--only listing|community|create|errors]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toLowerCase();
const OUT = process.env.PROBE_OUT || path.join(__dirname, '..', 'reports', 'probe-community-superadmin-gaps.json');
const out = {};
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const wait = (page, ms) => page.waitForTimeout(ms);

async function login(page) {
  for (let i = 0; i < 3; i++) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).click();
    try { await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 }); return; } catch (_) { /* stall */ }
  }
  throw new Error('superadmin sign-in stalled 3 times');
}

function recorder(page) {
  const reqs = [];
  const bodies = [];
  page.on('request', (r) => {
    if (/\/api\//.test(r.url()) && !/notifications|token\/refresh|auth\/me/.test(r.url())) reqs.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
  });
  page.on('response', async (r) => {
    if (!/\/community\//.test(r.url()) || r.request().method() !== 'GET') return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* not json */ }
    bodies.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status(), body });
  });
  return { reqs, bodies, take: () => reqs.splice(0) };
}

const pg = (page, n) => page.locator(`[data-testid="pagination-page-${n}-button"]:visible`);
const cardNames = (page) => page.locator('main article h3').allInnerTexts();
const memberNames = (page) => page.locator('main article h3').allInnerTexts();

async function listing(page, rec) {
  const o = {};
  await page.goto(`${ORIGIN}/community`); await wait(page, 4000); rec.take();
  const first = rec.bodies.filter((b) => /\/community\/\?/.test(b.url)).pop();
  o.count = first && first.body && first.body.count;
  o.serverOrder = first && first.body.results.map((r) => r.name);
  o.renderedOrder = await cardNames(page);
  o.cardCounts = await page.locator('main article').evaluateAll((as) => as.map((a) => (a.innerText.match(/(\d+)\s+Members?/) || [])[0]));
  o.serverCounts = first && first.body.results.map((r) => r.candidate_count);
  const lastPage = Math.ceil(o.count / 12);
  o.pagerLabels = await page.locator('nav[aria-label="Pagination Navigation"] [role=listitem]:visible').allInnerTexts();
  o.prevDisabledOnFirst = await page.locator('[data-testid="pagination-previous-button"]:visible').isDisabled();
  await pg(page, lastPage).click(); await wait(page, 3000);
  o.last = { page: lastPage, reqs: rec.take(), cards: (await cardNames(page)).length, nextDisabled: await page.locator('[data-testid="pagination-next-button"]:visible').isDisabled(), url: page.url() };
  await page.locator('[data-testid="pagination-previous-button"]:visible').click(); await wait(page, 3000);
  o.previous = { reqs: rec.take() };
  await pg(page, 1).click(); await wait(page, 3000);
  o.backToPage1 = { reqs: rec.take() };
  // the card's university name button
  const before = page.url();
  await page.locator('main article h3 button').first().click(); await wait(page, 1500);
  o.nameClick = { moved: page.url() !== before, reqs: rec.take(), dialogs: await page.locator('[role=dialog]').count() };
  // keyboard: Tab from the search box to the first card link
  await page.getByRole('searchbox').focus();
  const stops = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => `${document.activeElement.tagName}|${(document.activeElement.innerText || document.activeElement.getAttribute('aria-label') || '').trim().slice(0, 30)}|${document.activeElement.getAttribute('href') || ''}`)); }
  o.tabStops = stops;
  // whitespace-only search
  await page.getByRole('searchbox').fill('   '); await wait(page, 3000);
  o.whitespace = { reqs: rec.take(), cards: (await cardNames(page)).length };
  await page.getByRole('searchbox').fill(''); await wait(page, 2500); rec.take();
  // sidebar link from another page
  await page.goto(`${ORIGIN}/audit-logs`); await wait(page, 3000);
  await page.locator('nav a[href="/community"]').click(); await wait(page, 3000);
  o.sidebar = { url: page.url(), cards: (await cardNames(page)).length, reqs: rec.take() };
  // Create Community link
  await page.getByRole('link', { name: 'Create Community' }).click(); await wait(page, 3000);
  o.createLink = { url: page.url(), reqs: rec.take() };
  out.listing = o;
}

async function community(page, rec) {
  const o = {};
  await page.goto(`${ORIGIN}/community/view/37`); await wait(page, 6000);
  o.loadReqs = rec.take();
  const detail = rec.bodies.find((b) => /\/community\/37\/$/.test(b.url));
  o.detail = detail && { status: detail.status, keys: Object.keys(detail.body || {}), name: detail.body.name, count: detail.body.candidate_count, location: detail.body.location, description: detail.body.description };
  const members = rec.bodies.filter((b) => /\/community\/37\/candidates\//.test(b.url)).pop();
  o.memberCount = members && members.body.count;
  o.memberServer = members && members.body.results.map((m) => ({ name: `${m.user.firstname} ${m.user.lastname}`, major: m.major, year: m.grad_year, hasEmail: !!m.user.email, hasPhone: m.user.phone_number != null }));
  o.memberRendered = await page.locator('main article').evaluateAll((as) => as.map((a) => a.innerText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6).join(' | ')));
  o.headerText = clean(await page.locator('main').first().innerText()).slice(0, 200);
  // member paging
  await pg(page, 2).click(); await wait(page, 3000);
  o.memberPage2 = { reqs: rec.take(), url: page.url(), first: (await memberNames(page))[0] };
  const lastPage = Math.ceil(o.memberCount / 12);
  await pg(page, lastPage).click(); await wait(page, 3000);
  o.memberLast = { reqs: rec.take(), cards: await page.getByTestId('admin-community-member-view-profile-button').count(), nextDisabled: await page.locator('[data-testid="pagination-next-button"]:visible').isDisabled() };
  await page.getByTestId('admin-community-detail-search-input').fill('ali'); await wait(page, 3000);
  o.searchFromLast = { reqs: rec.take(), url: page.url(), cards: await page.getByTestId('admin-community-member-view-profile-button').count(), pager: await page.locator('nav[aria-label="Pagination Navigation"]').count() };
  await page.reload(); await wait(page, 5000);
  o.searchAfterReload = { box: await page.getByTestId('admin-community-detail-search-input').inputValue(), reqs: rec.take().filter((r) => /candidates/.test(r)) };
  // filters - one option each, record the request
  const filters = {};
  for (const [label, trigger] of [['Grad Years', page.getByTestId('admin-community-detail-grad-years-filter-button')], ['Majors', page.locator('main').getByText(/^Majors\d*$/).first()], ['Members', page.getByTestId('admin-community-detail-members-filter-button')]]) {
    await trigger.click(); await wait(page, 1500);
    const openReqs = rec.take();
    const dialog = page.locator('[role=dialog]').last();
    const options = await dialog.locator('label').allInnerTexts();
    await dialog.locator('label').first().click(); await wait(page, 3000);
    filters[label] = { openReqs, options: options.slice(0, 6), optionCount: options.length, applyReqs: rec.take(), url: page.url() };
    await page.keyboard.press('Escape'); await wait(page, 800);
  }
  o.filters = filters;
  o.triggers = await page.locator('main').getByText(/^(Grad Years|Majors|Members)\d*$/).allInnerTexts();
  o.majorsTrigger = await page.locator('main').getByText(/^Majors\d*$/).first().evaluate((e) => { const host = e.closest('button, [role=button], [tabindex]'); return { tag: e.tagName, host: host ? `${host.tagName}|role=${host.getAttribute('role')}|tabindex=${host.getAttribute('tabindex')}` : null, html: (e.parentElement || e).outerHTML.slice(0, 300) }; });
  await page.reload(); await wait(page, 5000);
  o.filtersAfterReload = { triggers: await page.locator('main').getByText(/^(Grad Years|Majors|Members)\d*$/).allInnerTexts(), reqs: rec.take().filter((r) => /candidates/.test(r)) };
  // member card buttons
  const card = page.locator('main article').first();
  const btns = card.locator('h3 button, button:not([data-testid])');
  const results = [];
  for (let i = 0; i < Math.min(await btns.count(), 4); i++) {
    const b = btns.nth(i);
    const label = clean(await b.innerText());
    const before = page.url();
    await b.click().catch(() => {}); await wait(page, 1200);
    results.push({ label, moved: page.url() !== before, reqs: rec.take(), dialogs: await page.locator('[role=dialog]').count() });
    if (page.url() !== before) { await page.goto(before); await wait(page, 4000); rec.take(); }
  }
  o.memberCardButtons = results;
  // header name / location buttons
  const headerBtns = [];
  for (const b of await page.locator('main h1 button, main button').filter({ hasText: /Arid Universit|Al Khobar/ }).all()) {
    const label = clean(await b.innerText()); const before = page.url();
    await b.click().catch(() => {}); await wait(page, 1000);
    headerBtns.push({ label, moved: page.url() !== before, reqs: rec.take() });
  }
  o.headerButtons = headerBtns;
  // View Profile route
  await page.getByTestId('admin-community-member-view-profile-button').first().click(); await wait(page, 4000);
  o.viewProfile = { url: page.url(), reqs: rec.take(), text: clean(await page.locator('main').first().innerText()).slice(0, 300) };
  await page.goBack(); await wait(page, 4000);
  o.afterBack = { url: page.url(), reqs: rec.take() };
  // Back link
  await page.getByTestId('admin-community-detail-back-button').click(); await wait(page, 3000);
  o.backLink = { url: page.url(), reqs: rec.take() };
  // unknown ids
  for (const p of ['/community/view/999999', '/community/edit/999999', '/community/view/abc']) {
    await page.goto(`${ORIGIN}${p}`); await wait(page, 5000);
    o[`unknown ${p}`] = { url: page.url(), reqs: rec.take(), text: clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 300) };
  }
  out.community = o;
}

async function create(page, rec) {
  const o = {};
  await page.goto(`${ORIGIN}/community/create`); await wait(page, 5000);
  o.loadReqs = rec.take();
  o.controls = await page.locator('main button, main a').evaluateAll((els) => els.map((e) => `${e.tagName}|${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40)}|${e.getAttribute('href') || ''}|${e.getAttribute('data-testid') || ''}|disabled=${e.disabled || e.getAttribute('aria-disabled')}`));
  o.text = clean(await page.locator('main').first().innerText()).slice(0, 600);
  const back = page.locator('main a, main button').filter({ hasText: /^(Back|Cancel)$/ });
  o.backCount = await back.count();
  if (o.backCount) { await back.first().click(); await wait(page, 3000); o.back = { url: page.url(), reqs: rec.take(), dialogs: await page.locator('[role=dialog]').allInnerTexts() }; }
  // edit page controls
  await page.goto(`${ORIGIN}/community/edit/37`); await wait(page, 5000);
  o.editReqs = rec.take();
  o.editControls = await page.locator('main button, main a').evaluateAll((els) => els.map((e) => `${e.tagName}|${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40)}|${e.getAttribute('href') || ''}|${e.getAttribute('data-testid') || ''}`));
  const eback = page.locator('main a, main button').filter({ hasText: /^(Back|Cancel)$/ });
  if (await eback.count()) { await eback.first().click(); await wait(page, 3000); o.editBack = { url: page.url(), reqs: rec.take() }; }
  out.create = o;
}

async function errors(page, rec) {
  const o = {};
  for (const [name, pathName, re] of [
    ['listing 500', '/community', /\/api\/v1\/community\/\?/],
    ['detail 500', '/community/view/37', /\/api\/v1\/community\/37\/$/],
    ['members 500', '/community/view/37', /\/api\/v1\/community\/37\/candidates\//],
  ]) {
    await page.route(re, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed"}' }));
    await page.goto(`${ORIGIN}${pathName}`); await wait(page, 6000);
    o[name] = { text: clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 400), toasts: await page.locator('[data-sonner-toast], [role=status], [role=alert]').allInnerTexts(), reqs: rec.take() };
    await page.unroute(re);
  }
  // offline listing
  await page.route(/\/api\/v1\/community\/\?/, (r) => r.abort('internetdisconnected'));
  await page.goto(`${ORIGIN}/community`); await wait(page, 6000);
  o['listing offline'] = { text: clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 300), toasts: await page.locator('[data-sonner-toast], [role=status], [role=alert]').allInnerTexts() };
  await page.unroute(/\/api\/v1\/community\/\?/);
  out.errors = o;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const rec = recorder(page);
  await login(page);
  for (const [k, fn] of Object.entries({ listing, community, create, errors })) {
    if (ONLY && ONLY !== k) continue;
    try { await fn(page, rec); } catch (e) { out[`${k} FAILED`] = e.message.split('\n')[0]; }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, (k, v) => (typeof v === 'string' ? v.replace(/X-Amz-Signature=[^&"]+/g, 'X-Amz-Signature=<redacted>') : v), 2));
  console.log('wrote', OUT);
  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
