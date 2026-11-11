/* eslint-disable no-console */
// probe-agent-view-per-tab.js - READ-ONLY. The SuperAdmin agent profile reached by View from
// EACH lifecycle tab that offers it (Active / Requires Attention / Deactivated), beside the
// server payload behind it. Every dialog opened here is cancelled; nothing is saved.
//
//   A. per tab: the listing row, the requests View fires, the header vs GET /agent/<id>/profile/,
//      the inline actions, the overflow menu, the Promo Tools tab and its request
//   B. the header dialogs from the profile (Deactivate on an active agent, Reactivate on a
//      deactivated one, Edit Target typed-then-cancelled-then-reopened) - all cancelled
//   C. edge routes: non-numeric id, id 0, trailing slash, a stubbed 500 on the profile request
//   D. two agents in turn: A, Back, B - does anything of A survive on B's profile
//
// Run:  node scripts/probe-agent-view-per-tab.js [--only A|B|C|D]
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toUpperCase();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);
const short = (o) => String(JSON.stringify(o)).slice(0, 600);
const TAB_PARAM = { Active: '', 'Requires Attention': '?tab=requires-attention', Deactivated: '?tab=deactivated' };

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
    if (!/\/api\/v1\//.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* */ }
    log.push({ method: r.request().method(), path: r.url().replace(/^.*\/api\/v1/, ''), status: r.status(), body });
  });
  return log;
}

async function openTab(page, tab) {
  await page.goto(`${ORIGIN}/agents`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  if (tab !== 'Active') {
    await page.getByRole('radio', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })).first().click();
    await page.waitForTimeout(4000);
  }
  console.log('listing url:', page.url().replace(ORIGIN, ''));
}

async function menuItems(page) {
  const opener = page.getByRole('button', { name: 'Open menu', exact: true }).first();
  if (!(await opener.count())) return '(no Open menu)';
  await opener.click();
  await page.waitForTimeout(800);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => (e.textContent || '').trim()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return items;
}

async function sectionA(page, log) {
  for (const tab of ['Active', 'Requires Attention', 'Deactivated']) {
    head(`A. View from ${tab}`);
    await openTab(page, tab);
    const listReq = log.filter((l) => /\/agent\/\?/.test(l.path)).pop();
    console.log('list request:', listReq && listReq.path, 'count', listReq && listReq.body && listReq.body.count);
    const row = page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first();
    if (!(await row.count())) { console.log('NO ROW WITH VIEW'); continue; }
    console.log('row:', clean(await row.innerText())); const em = (clean(await row.innerText()).match(/[\w.+-]+@[\w.-]+/) || [])[0]; console.log('row payload:', short(((listReq && listReq.body && listReq.body.results) || []).find((a) => a.email === em)));
    console.log('row buttons:', JSON.stringify(await row.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.innerText))));
    log.length = 0;
    await row.getByRole('button', { name: /^view$/i }).first().click();
    await page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
    await page.waitForTimeout(7000);
    console.log('profile url:', page.url().replace(ORIGIN, ''));
    log.filter((l) => l.method === 'GET').forEach((l) => console.log(`  ${l.status} ${l.path}`));
    const prof = log.find((l) => /^\/agent\/\d+\/profile\//.test(l.path));
    console.log('profile payload:', short(prof && prof.body));
    const lines = (await page.locator('main').first().innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
    const ft = lines.findIndex((l) => /^performance overview$/i.test(l));
    console.log('header lines:', JSON.stringify(lines.slice(0, ft > 0 ? ft : 10)));
    console.log('buttons in main:', JSON.stringify(await page.locator('main button').evaluateAll((bs) => bs.map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim() || b.getAttribute('aria-label')).filter(Boolean).slice(0, 25))));
    const et = page.getByRole('button', { name: /^edit target$/i }).first();
    console.log('Edit Target present:', await et.count(), 'enabled:', (await et.count()) ? await et.isEnabled() : null);
    console.log('menu:', JSON.stringify(await menuItems(page)));
    console.log('perf overview text:', clean(await page.locator('main').first().innerText()).slice(0, 900));
    log.length = 0;
    await page.getByRole('radio', { name: 'Promo Tools' }).first().click();
    await page.waitForTimeout(5000);
    log.filter((l) => l.method === 'GET').forEach((l) => console.log(`  promo ${l.status} ${l.path} -> ${short(l.body).slice(0, 300)}`));
    console.log('promo tab text:', clean(await page.locator('main').first().innerText()).slice(0, 700));
    log.length = 0;
    await page.getByRole('radio', { name: 'Candidates' }).first().click();
    await page.waitForTimeout(5000);
    log.filter((l) => l.method === 'GET').forEach((l) => console.log(`  cand ${l.status} ${l.path} count=${l.body && l.body.count}`));
    console.log('candidates text:', clean(await page.locator('main').first().innerText()).slice(0, 400));
  }
}

async function sectionB(page, log) {
  head('B1. Deactivate from an ACTIVE profile (cancelled)');
  await openTab(page, 'Active');
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first()
    .getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
  await page.waitForTimeout(700);
  log.length = 0;
  await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /^deactivate$/i }).first().click();
  await page.waitForTimeout(3000);
  const d = page.locator('[role="dialog"]').last();
  console.log('dialog:', clean(await d.innerText().catch(() => '(none)')));
  console.log('dialog buttons:', JSON.stringify(await d.locator('button').evaluateAll((bs) => bs.map((b) => ({ t: (b.innerText || b.getAttribute('aria-label') || '').trim(), dis: b.disabled })))));
  console.log('requests on open:', JSON.stringify(log.map((l) => `${l.method} ${l.status} ${l.path}`)));
  await d.getByRole('button', { name: /^cancel$/i }).first().click().catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(1500);
  console.log('after cancel url:', page.url().replace(ORIGIN, ''), 'dialogs:', await page.locator('[role="dialog"]').count());

  head('B2. Edit Target typed, cancelled, reopened');
  await page.getByRole('button', { name: /^edit target$/i }).first().click();
  await page.waitForTimeout(1200);
  const et = page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first();
  const input = et.locator('input').first();
  const before = await input.inputValue();
  console.log('dialog:', clean(await et.innerText()), '| value', before, '| attrs', JSON.stringify(await input.evaluate((i) => ({ type: i.type, maxLength: i.maxLength, inputMode: i.inputMode, name: i.name }))));
  await input.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('77');
  console.log('typed 77 -> held', await input.inputValue());
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('abc');
  console.log('typed abc -> held', JSON.stringify(await input.inputValue()));
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('12345678901234');
  console.log('typed 14 digits -> held', JSON.stringify(await input.inputValue()));
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('5.5');
  console.log('typed 5.5 -> held', JSON.stringify(await input.inputValue()));
  log.length = 0;
  await et.getByRole('button', { name: /^cancel$/i }).first().click();
  await page.waitForTimeout(1200);
  console.log('cancel requests:', JSON.stringify(log.filter((l) => l.method !== 'GET').map((l) => `${l.method} ${l.path}`)));
  await page.getByRole('button', { name: /^edit target$/i }).first().click();
  await page.waitForTimeout(1200);
  console.log('reopened value:', await page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first().locator('input').first().inputValue(), '(was', before, ')');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  console.log('after Escape dialogs:', await page.locator('[role="dialog"]').count());
  // X close?
  await page.getByRole('button', { name: /^edit target$/i }).first().click();
  await page.waitForTimeout(1000);
  const etd = page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first();
  console.log('Edit Target dialog buttons:', JSON.stringify(await etd.locator('button').evaluateAll((bs) => bs.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()))));
  await page.mouse.click(5, 5);
  await page.waitForTimeout(1000);
  console.log('after outside click dialogs:', await page.locator('[role="dialog"]').count());
  await page.keyboard.press('Escape');

  head('B3. Reactivate from a DEACTIVATED profile (cancelled)');
  await openTab(page, 'Deactivated');
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first()
    .getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  await page.waitForTimeout(6000);
  const menu = await menuItems(page);
  console.log('menu:', JSON.stringify(menu));
  await page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.locator('[role="menu"] [role^="menuitem"]').first().click();
  await page.waitForTimeout(2500);
  const r = page.locator('[role="dialog"]').last();
  console.log('dialog:', clean(await r.innerText().catch(() => '(none)')));
  console.log('dialog buttons:', JSON.stringify(await r.locator('button').evaluateAll((bs) => bs.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()))));
  await r.getByRole('button', { name: /^cancel$/i }).first().click().catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(1000);
  console.log('Edit Target on deactivated:', await page.getByRole('button', { name: /^edit target$/i }).count());
}

async function sectionC(page, log) {
  await openTab(page, 'Active');
  const row = page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first();
  await row.getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  const id = page.url().match(/view\/(\d+)/)[1];
  for (const p of ['abc', '0', '-1', `${id}/`, `${id}?tab=candidates&tab=activityLog`, `${id}abc`]) {
    head(`C. /agents/view/${p}`);
    log.length = 0;
    await page.goto(`${ORIGIN}/agents/view/${p}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    console.log('url:', page.url().replace(ORIGIN, ''));
    log.filter((l) => l.method === 'GET').forEach((l) => console.log(`  ${l.status} ${l.path}`));
    console.log('text:', clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 400));
  }
  head('C. stubbed 500 on the profile request');
  await page.route(/\/api\/v1\/agent\/\d+\/profile\//, (rt) => rt.fulfill({ status: 500, body: '{"detail":"boom"}', contentType: 'application/json' }));
  await page.goto(`${ORIGIN}/agents/view/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  console.log('text:', clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 500));
  console.log('toasts:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"],[role="status"],.Toastify__toast')).map((e) => e.innerText))));
  await page.unroute(/\/api\/v1\/agent\/\d+\/profile\//);
  head('C. stubbed 500 on target-progress');
  await page.route(/target-progress/, (rt) => rt.fulfill({ status: 500, body: '{"detail":"boom"}', contentType: 'application/json' }));
  await page.goto(`${ORIGIN}/agents/view/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  console.log('text:', clean(await page.locator('main').first().innerText().catch(() => '')).slice(0, 600));
  await page.unroute(/target-progress/);
}

async function sectionD(page, log) {
  head('D. two agents in turn');
  await openTab(page, 'Active');
  const rows = page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) });
  const a = clean(await rows.nth(0).innerText());
  const b = clean(await rows.nth(1).innerText());
  console.log('A:', a, '\nB:', b);
  await rows.nth(0).getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  await page.waitForTimeout(6000);
  await page.getByRole('link', { name: /^back$/i }).first().click();
  await page.waitForURL(/\/agents(\?|$)/);
  await page.waitForTimeout(4000);
  log.length = 0;
  await rows.nth(1).getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  // Sample the header EARLY to see whether A's details flash on B's profile.
  for (const t of [200, 800, 2000, 5000]) {
    await page.waitForTimeout(t);
    const lines = (await page.locator('main').first().innerText()).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);
    console.log(`  +${t}ms header:`, JSON.stringify(lines));
  }
  console.log('requests:', JSON.stringify(log.filter((l) => l.method === 'GET').map((l) => l.path)));
  head('D2. browser back/forward between profile tabs');
  await page.getByRole('radio', { name: 'Candidates' }).first().click(); await page.waitForTimeout(2500);
  await page.getByRole('radio', { name: 'Activity Log' }).first().click(); await page.waitForTimeout(2500);
  console.log('url:', page.url().replace(ORIGIN, ''));
  await page.goBack(); await page.waitForTimeout(3000);
  console.log('after back url:', page.url().replace(ORIGIN, ''), 'selected', clean(await page.evaluate(() => (Array.from(document.querySelectorAll('[role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText)));
  await page.goForward(); await page.waitForTimeout(3000);
  console.log('after forward url:', page.url().replace(ORIGIN, ''), 'selected', clean(await page.evaluate(() => (Array.from(document.querySelectorAll('[role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText)));
  head('D3. keyboard: Tab to the first row and Enter');
  await openTab(page, 'Requires Attention');
  const view = page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first().getByRole('button', { name: /^view$/i }).first();
  console.log('View attrs:', JSON.stringify(await view.evaluate((b) => ({ tabIndex: b.tabIndex, aria: b.getAttribute('aria-label'), tag: b.tagName }))));
  await view.focus();
  console.log('focused after focus():', await page.evaluate(() => (document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.innerText)) || ''));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  console.log('after Enter url:', page.url().replace(ORIGIN, ''));
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const log = apiLog(page);
  await login(page);
  if (!ONLY || ONLY === 'A') await sectionA(page, log);
  if (!ONLY || ONLY === 'B') await sectionB(page, log);
  if (!ONLY || ONLY === 'C') await sectionC(page, log);
  if (!ONLY || ONLY === 'D') await sectionD(page, log);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
