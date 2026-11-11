/* eslint-disable no-console */
// probe-superadmin-user-mgmt-edges.js - READ-ONLY. The edge cases of the SuperAdmin Portal's
// User Management listings (Agents AND Candidates) that the main probes do not cover:
//
//   1. unusable URL params (?page=abc / 0 / -1 / 99999, an unknown tab value)
//   2. the LAST page (Next disabled, remainder rows) and a numbered page control
//   3. a failed list load (a stubbed 500 / an aborted request) - what the superadmin is told
//   4. row ORDER - the server's order beside the grid's order on page 1
//   5. a deep link to an agent profile that does not exist
//   6. access control - an AGENT and a CANDIDATE session opening /agents and /candidates
//
// It commits NOTHING: no dialog is confirmed, nothing is saved. The 500 is a page.route() stub,
// so the server is never asked to fail.
//
// Run:  node scripts/probe-superadmin-user-mgmt-edges.js
//       HEADED=true node scripts/probe-superadmin-user-mgmt-edges.js
//       node scripts/probe-superadmin-user-mgmt-edges.js --only agents|candidates|access
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toLowerCase();

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

const SURFACES = {
  agents: { path: '/agents', api: /\/api\/v1\/agent\/?\?/, tabParam: 'tab' },
  candidates: { path: '/candidates', api: /\/api\/v1\/candidate\/\?/, tabParam: 'accountTab' },
};

async function login(page, email, password, landed = /\/(agents|candidates|dashboard|agents-analytics|candidate-analytics|onboarding|getting-started)/) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(landed, { timeout: 90000 });
}

function recorder(page, re) {
  const seen = [];
  page.on('response', async (r) => {
    if (!re.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* not json */ }
    seen.push({ url: r.url(), status: r.status(), body });
  });
  return seen;
}

async function readState(page) {
  return page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'));
    const nav = Array.from(document.querySelectorAll('nav'))
      .find((n) => /previous|next/i.test(n.innerText || ''));
    const navButtons = nav ? Array.from(nav.querySelectorAll('button')).map((b) => ({
      t: c(b.innerText) || b.getAttribute('aria-label'), dis: b.disabled, cur: b.getAttribute('aria-current'),
    })) : [];
    const emptyH = Array.from(document.querySelectorAll('main h3, main h2'))
      .map((h) => c(h.innerText)).filter(Boolean);
    return {
      url: location.pathname + location.search,
      selectedTab: c((Array.from(document.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true') || {}).innerText),
      rowCount: rows.length,
      firstCells: rows.slice(0, 10).map((r) => c((r.querySelector('[role="rowheader"], [role="gridcell"]') || r).innerText).slice(0, 60)),
      nav: navButtons,
      headings: emptyH.slice(0, 4),
      mainTextTail: c((document.querySelector('main') || document.body).innerText).slice(0, 400),
    };
  });
}

const resultsOf = (b) => (b && (b.results || b.data || [])) || [];
const nameOf = (x) => clean(x.name || [x.firstname || (x.user && x.user.firstname), x.lastname || (x.user && x.user.lastname)].filter(Boolean).join(' ')
  || (x.user && x.user.email) || x.email);

async function probeSurface(page, key) {
  const s = SURFACES[key];
  const seen = recorder(page, s.api);
  const go = async (q) => {
    seen.length = 0;
    await page.goto(`${ORIGIN}${s.path}${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const st = await readState(page);
    const last = seen[seen.length - 1];
    return { ...st, request: last ? last.url.replace(/^.*\/api\/v1/, '') : '(none)', status: last && last.status, count: last && last.body && last.body.count };
  };

  head(`${key.toUpperCase()} 1. unusable URL params`);
  for (const q of ['', '?page=abc', '?page=0', '?page=-1', '?page=99999', `?${s.tabParam}=bogus`, `?${s.tabParam}=`, `?${s.tabParam}=ACTIVE`]) {
    const r = await go(q);
    console.log(`${q || '(none)'}\n   url=${r.url} tab="${r.selectedTab}" rows=${r.rowCount} req=${r.request} status=${r.status} count=${r.count}\n   headings=${JSON.stringify(r.headings)}${r.rowCount === 0 ? ` text=${r.mainTextTail.slice(-250)}` : ''} nav=${JSON.stringify(r.nav.map((b) => `${b.t}${b.dis ? '(dis)' : ''}${b.cur ? '*' : ''}`))}`);
  }

  head(`${key.toUpperCase()} 2. last page + numbered page`);
  const first = await go('');
  const count = first.count;
  const pageSize = Number((first.request.match(/page_size=(\d+)/) || [])[1]) || 10;
  const lastPage = Math.max(1, Math.ceil((count || 0) / pageSize));
  console.log(`count=${count} page_size=${pageSize} -> last page ${lastPage}`);
  const numbered = first.nav.filter((b) => /^\d+$/.test(b.t || ''));
  console.log(`numbered controls on page 1: ${numbered.map((b) => b.t).join(',')}`);
  if (numbered.length > 1) {
    seen.length = 0;
    const btn = page.locator('nav').filter({ hasText: /next/i }).locator('button').filter({ hasText: new RegExp(`^${numbered[1].t}$`) }).first();
    console.log(`page-2 control: aria-label=${await btn.getAttribute('aria-label')} name=${JSON.stringify(await btn.evaluate((b) => b.outerHTML.slice(0, 200)))}`);
    await btn.click();
    await page.waitForTimeout(4000);
    const r = await readState(page);
    console.log(`clicked "${numbered[1].t}" -> url=${r.url} req=${(seen[seen.length - 1] || {}).url} rows=${r.rowCount}`);
  }
  const lp = await go(`?page=${lastPage}`);
  console.log(`?page=${lastPage} -> url=${lp.url} rows=${lp.rowCount} (expect ${count - (lastPage - 1) * pageSize}) req=${lp.request} nav=${JSON.stringify(lp.nav.map((b) => `${b.t}${b.dis ? '(dis)' : ''}${b.cur ? '*' : ''}`))}`);

  head(`${key.toUpperCase()} 3. row order: server vs grid`);
  const o = await go('');
  const payload = (seen[seen.length - 1] || {}).body;
  console.log('server :', resultsOf(payload).slice(0, 10).map(nameOf).join(' | '));
  console.log('grid   :', o.firstCells.join(' | '));

  head(`${key.toUpperCase()} 4. failed load (stubbed 500, then aborted)`);
  for (const mode of ['500', 'abort']) {
    await page.route(s.api, (route) => (mode === 'abort'
      ? route.abort('internetdisconnected')
      : route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stub"}' })));
    const r = await go('');
    console.log(`${mode}: rows=${r.rowCount} headings=${JSON.stringify(r.headings)}\n   text: ${r.mainTextTail}`);
    const toasts = await page.locator('.Toastify__toast, [role="alert"], [role="status"]').allInnerTexts().catch(() => []);
    console.log(`   toasts: ${JSON.stringify(toasts.map(clean))}`);
    await page.unroute(s.api);
  }
}

async function probeProfileDeepLink(page) {
  head('AGENTS 5. deep link to an unknown agent profile');
  for (const id of ['99999999', 'abc']) {
    const calls = [];
    const h = (r) => { if (/\/api\/v1\//.test(r.url())) calls.push(`${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')}`); };
    page.on('response', h);
    await page.goto(`${ORIGIN}/agents/view/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    page.off('response', h);
    const st = await readState(page);
    console.log(`/agents/view/${id} -> url=${st.url}\n   calls=${JSON.stringify(calls.filter((c) => /agent/.test(c)).slice(0, 6))}\n   text: ${st.mainTextTail}`);
  }
}

async function probeAccess(browser) {
  head('6. access control for non-superadmin roles');
  const roles = [
    ['agent', process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD],
    ['candidate', process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL, process.env.CANDIDATE_DETAILS_PASSWORD || process.env.CONTACTUS_PASSWORD],
  ];
  for (const [role, email, pw] of roles) {
    if (!email || !pw) { console.log(`${role}: no credentials in .env`); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    const page = await ctx.newPage();
    try {
      await login(page, email, pw);
      for (const path of ['/agents', '/candidates', '/agents/view/1', '/agents/invite']) {
        const calls = [];
        page.on('response', (r) => { if (/\/api\/v1\/(agent|candidate)\/?\?/.test(r.url())) calls.push(`${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')}`); });
        await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        const st = await readState(page);
        console.log(`${role} ${path} -> url=${st.url} rows=${st.rowCount} adminCalls=${JSON.stringify(calls.slice(0, 2))}\n   text: ${st.mainTextTail.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`${role}: ${e.message}`);
    }
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  if (ONLY !== 'access') {
    await login(page, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
    if (!ONLY || ONLY === 'agents') { await probeSurface(page, 'agents'); await probeProfileDeepLink(page); }
    if (!ONLY || ONLY === 'candidates') await probeSurface(page, 'candidates');
  }
  if (!ONLY || ONLY === 'access') await probeAccess(browser);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
