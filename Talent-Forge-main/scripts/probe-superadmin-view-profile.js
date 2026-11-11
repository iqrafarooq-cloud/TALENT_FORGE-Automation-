/* eslint-disable no-console */
// probe-superadmin-view-profile.js - READ-ONLY. What the SuperAdmin "View" action really shows,
// beside the server payload behind it, for BOTH the agent profile (/agents/view/<id>) and the
// candidate drawer (/candidates, View). Opens nothing that writes, saves nothing.
//
//   A. agent profile: the header vs GET /agent/<id>/profile/, each period selector and the
//      request it fires, the Candidates tab vs its own request, the Activity Log periods, a
//      reload on each ?tab= deep link
//   B. candidate drawer: the header and the four figures vs GET /candidate/profile/<id>/, which
//      tab a REOPENED drawer starts on, and whether Documents agrees with the payload
//
// Run:  node scripts/probe-superadmin-view-profile.js [--only agent|candidate]
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toLowerCase();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates|agents-analytics|candidate-analytics)/, { timeout: 90000 });
}

function apiLog(page) {
  const log = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\//.test(r.url()) || r.request().method() !== 'GET') return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* */ }
    log.push({ path: r.url().replace(/^.*\/api\/v1/, ''), status: r.status(), body });
  });
  return log;
}

const short = (o) => String(JSON.stringify(o)).slice(0, 700);

async function probeAgent(page) {
  const log = apiLog(page);
  await page.goto(`${ORIGIN}/agents`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // An agent WITH candidates, from the listing's own filter.
  log.length = 0;
  await page.goto(`${ORIGIN}/agents?candidateCount=1-50`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const row = page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first();
  console.log('row:', clean(await row.innerText()));
  log.length = 0;
  await row.getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  await page.waitForTimeout(7000);
  const id = page.url().match(/view\/(\d+)/)[1];
  head(`A1. agent ${id}: requests on open`);
  log.forEach((l) => console.log(`${l.status} ${l.path}`));
  const prof = log.find((l) => /\/agent\/\d+\/profile\//.test(l.path));
  console.log('profile payload:', short(prof && prof.body));
  const tp = log.find((l) => /target-progress/.test(l.path));
  console.log('target-progress payload:', short(tp && tp.body));
  const pv = log.find((l) => /pending-verifications/.test(l.path));
  console.log('pending-verifications payload:', short(pv && pv.body));
  console.log('header text:', clean(await page.locator('main').first().innerText()).slice(0, 900));

  head('A2. target-progress period selector');
  // The FIRST period trigger is Target Progress's. Re-located every time: its label changes.
  const tpTrigger = () => page.locator('main button').filter({ hasText: /^(Monthly|Quarterly|Yearly|Year to Date)$/ }).first();
  for (const label of ['Quarterly', 'Yearly', 'Year to Date', 'Monthly']) {
    log.length = 0;
    await tpTrigger().click();
    await page.waitForTimeout(600);
    await page.getByRole('option', { name: label, exact: true }).first().click();
    await page.waitForTimeout(3500);
    const tpl = log.filter((l) => /target-progress/.test(l.path));
    console.log(`  ${label}: ${JSON.stringify(tpl.map((l) => `${l.path} -> ${short(l.body)}`))}`);
    console.log(`     rendered: ${clean(await page.locator('main').first().innerText()).match(/Target Progress.{0,120}/)?.[0]}`);
  }
  head('A3. Candidates tab');
  log.length = 0;
  await page.getByRole('radio', { name: 'Candidates' }).first().click();
  await page.waitForTimeout(6000);
  log.forEach((l) => console.log(`${l.status} ${l.path} count=${l.body && l.body.count}`));
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]')).map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140)));
  console.log('rows:', rows.length, rows.slice(0, 3));
  console.log('search box?', await page.locator('main input[type="search"], main input[placeholder*="Search" i]').count());
  console.log('row buttons:', JSON.stringify(await page.locator('[role="row"]').nth(1).locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.innerText))));
  console.log('pager:', JSON.stringify(await page.locator('main [aria-label^="Page " i]:visible, main [aria-label$=" Page" i]:visible').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))));
  console.log('url:', page.url());
  const email1 = (rows[0] || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (email1) {
    const term = email1[0].split('@')[0].slice(0, 12);
    log.length = 0;
    await page.locator('main input[type="search"], main input[placeholder*="Search" i]').first().fill(term);
    await page.waitForTimeout(3500);
    console.log(`search "${term}" ->`, JSON.stringify(log.map((l) => `${l.status} ${l.path} count=${l.body && l.body.count}`)), 'url', page.url().replace(ORIGIN, ''));
    log.length = 0;
    await page.locator('main input[type="search"], main input[placeholder*="Search" i]').first().fill('zzzz-no-such-candidate');
    await page.waitForTimeout(3500);
    console.log('no-match ->', JSON.stringify(log.map((l) => `${l.status} ${l.path} count=${l.body && l.body.count}`)), clean(await page.locator('main').first().innerText()).slice(-200));
    await page.locator('main input[type="search"], main input[placeholder*="Search" i]').first().fill('');
    await page.waitForTimeout(3500);
    log.length = 0;
    const urlBefore = page.url();
    await page.locator('[role="row"]').nth(1).getByRole('button', { name: /^view$/i }).first().click();
    await page.waitForTimeout(5000);
    console.log('row View -> url', page.url().replace(ORIGIN, ''), 'same?', page.url() === urlBefore, 'dialogs', await page.locator('[role="dialog"]').count());
    console.log('   requests', JSON.stringify(log.map((l) => `${l.status} ${l.path}`)));
    console.log('   dialog text', clean(await page.locator('[role="dialog"]').last().innerText().catch(() => '')).slice(0, 300));
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  }

  head('A4. Activity Log periods');
  log.length = 0;
  await page.getByRole('radio', { name: 'Activity Log' }).first().click();
  await page.waitForTimeout(5000);
  log.forEach((l) => console.log(`${l.status} ${l.path} count=${l.body && l.body.count}`));
  console.log('text:', clean(await page.locator('main').first().innerText()).slice(0, 500));
  const trig = page.locator('main button').filter({ hasText: /^Last 7 Days$|^Last 24 Hours$/i }).first();
  console.log('period trigger:', await trig.count() ? await trig.innerText() : '(none)');
  if (await trig.count()) {
    log.length = 0;
    await trig.click(); await page.waitForTimeout(600);
    console.log('options:', JSON.stringify(await page.getByRole('option').allInnerTexts()));
    await page.getByRole('option', { name: /this year/i }).first().click().catch(() => {});
    await page.waitForTimeout(3500);
    console.log('This Year ->', JSON.stringify(log.map((l) => `${l.status} ${l.path} count=${l.body && l.body.count}`)));
    console.log('url after period:', page.url());
  }

  head('A5. reload on each ?tab= deep link');
  for (const t of ['', '?tab=candidates', '?tab=promoTools', '?tab=activityLog', '?tab=bogus']) {
    await page.goto(`${ORIGIN}/agents/view/${id}${t}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const sel = await page.evaluate(() => (Array.from(document.querySelectorAll('[role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText);
    console.log(`${t || '(none)'} -> selected "${clean(sel)}" url=${page.url().replace(ORIGIN, '')}`);
  }
}

async function probeCandidate(page) {
  const log = apiLog(page);
  log.length = 0;
  await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const listing = log.find((l) => /\/candidate\/\?/.test(l.path));
  console.log('first listing row payload:', short(listing && listing.body && listing.body.results && listing.body.results[0]));
  const row = page.locator('[role="row"]').filter({ has: page.locator('button[aria-label="View"]') }).first();
  console.log('row:', clean(await row.innerText()));
  for (const pass of [1, 2]) {
    log.length = 0;
    await row.locator('button[aria-label="View"]').first().click();
    await page.waitForTimeout(6000);
    const dlg = page.locator('[role="dialog"]').last();
    head(`B${pass}. drawer open #${pass}`);
    log.forEach((l) => console.log(`${l.status} ${l.path}`));
    const prof = log.find((l) => /\/candidate\/profile\/\d+\//.test(l.path));
    if (pass === 1) console.log('profile payload keys:', prof && Object.keys(prof.body || {}).join(','), '\n', short(prof && prof.body));
    console.log('drawer text:', clean(await dlg.innerText()).slice(0, 700));
    console.log('selected tab:', clean(await page.evaluate(() => (Array.from(document.querySelectorAll('[role="dialog"] [role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText)));
    if (pass === 1) {
      await dlg.locator('[role="radio"]').filter({ hasText: 'Subscription' }).first().click().catch(() => {});
      await page.waitForTimeout(3000);
      console.log('after selecting Subscription:', clean(await page.evaluate(() => (Array.from(document.querySelectorAll('[role="dialog"] [role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText)));
      await dlg.locator('[role="radio"]').filter({ hasText: 'Documents' }).first().click().catch(() => {});
      await page.waitForTimeout(2000);
      console.log('documents text:', clean(await dlg.innerText()).slice(0, 500));
      console.log('payload documents:', short(prof && prof.body && (prof.body.documents || prof.body.candidate_documents)));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await login(page);
  if (ONLY !== 'candidate') await probeAgent(page);
  if (ONLY !== 'agent') await probeCandidate(page);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
