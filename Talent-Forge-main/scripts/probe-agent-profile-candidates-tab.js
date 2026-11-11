/* eslint-disable no-console */
// probe-agent-profile-candidates-tab.js - READ-ONLY. The SuperAdmin agent profile's Candidates
// tab (/agents/view/<id>?tab=candidates) mapped as a page: columns, row actions per row, what
// each action opens (every dialog is cancelled, no Save/Resend/Reassign is ever clicked),
// search, pagination, selection, the requests behind it and its unusual URL values.
//
// Run:  node scripts/probe-agent-profile-candidates-tab.js [--agent 1220]
require('dotenv').config();
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const AGENT = process.argv.find((a, i) => process.argv[i - 1] === '--agent') || '1220';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);
const short = (o, n = 700) => String(JSON.stringify(o)).slice(0, n);

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

const dialogsText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
  .filter((d) => d.getBoundingClientRect().height > 0).map((d) => (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600)));

async function readGrid(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('main [role="grid"], main table');
    if (!grid) return { grid: false };
    const cols = Array.from(grid.querySelectorAll('[role="columnheader"], th')).map((c) => (c.innerText || '').trim());
    const rows = Array.from(grid.querySelectorAll('[role="row"], tbody tr')).filter((r) => !r.querySelector('[role="columnheader"], th'));
    return {
      grid: true,
      label: grid.getAttribute('aria-label'),
      cols,
      rows: rows.map((r) => ({
        cells: Array.from(r.querySelectorAll('[role="rowheader"],[role="gridcell"],td')).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()),
        buttons: Array.from(r.querySelectorAll('button,[role="checkbox"],input[type="checkbox"]')).map((b) => ({
          label: b.getAttribute('aria-label') || (b.innerText || '').trim() || b.type || b.tagName,
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
          testid: b.getAttribute('data-testid'),
        })),
      })),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const log = apiLog(page);
  await login(page);

  head('1. open the tab');
  log.length = 0;
  await page.goto(`${ORIGIN}/agents/view/${AGENT}?tab=candidates`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  console.log('url:', page.url().replace(ORIGIN, ''));
  log.filter((l) => l.method === 'GET').forEach((l) => console.log(`  ${l.status} ${l.path}`));
  const listReq = log.filter((l) => /\/candidates\/\?/.test(l.path)).pop();
  console.log('candidates payload count:', listReq && listReq.body && listReq.body.count);
  console.log('first result:', short(listReq && listReq.body && listReq.body.results && listReq.body.results[0], 1500));
  console.log('result keys:', listReq && listReq.body && listReq.body.results && listReq.body.results[0] && Object.keys(listReq.body.results[0]));
  console.log('statuses:', JSON.stringify(((listReq && listReq.body && listReq.body.results) || []).map((r) => [r.email || (r.user && r.user.email), r.status || r.account_status, r.is_active])));
  await page.screenshot({ path: path.join('reports', 'probe-agent-profile-candidates-tab.png'), fullPage: true });

  head('2. tab panel text + controls');
  const panel = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      text: (main.innerText || '').replace(/\n+/g, ' | ').slice(0, 3000),
      inputs: Array.from(main.querySelectorAll('input')).map((i) => ({ type: i.type, ph: i.placeholder, aria: i.getAttribute('aria-label'), testid: i.getAttribute('data-testid') })),
      buttons: Array.from(main.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean),
      tabs: Array.from(main.querySelectorAll('[role="radio"],[role="tab"]')).map((t) => `${(t.innerText || '').trim()}${t.getAttribute('aria-checked') === 'true' || t.getAttribute('aria-selected') === 'true' ? ' *' : ''}`),
      navs: Array.from(document.querySelectorAll('nav')).map((n) => `${n.getAttribute('aria-label')}: ${(n.innerText || '').replace(/\s+/g, ' ').slice(0, 120)}`),
    };
  });
  console.log(JSON.stringify(panel, null, 1));

  head('3. grid');
  const g = await readGrid(page);
  console.log(JSON.stringify(g, null, 1).slice(0, 6000));

  head('4. each row action opened and cancelled (first row)');
  const firstRow = page.locator('main [role="row"]').filter({ has: page.locator('[role="gridcell"]') }).first();
  const labels = await firstRow.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || (b.innerText || '').trim()));
  console.log('first row buttons:', labels);
  for (const lab of labels) {
    if (!lab || /@/.test(lab)) continue;
    const btn = firstRow.getByRole('button', { name: lab, exact: true }).first();
    if (!(await btn.count()) || await btn.isDisabled()) { console.log(`-- ${lab}: disabled/absent`); continue; }
    log.length = 0;
    const url0 = page.url();
    await btn.click().catch((e) => console.log('click failed', e.message.split('\n')[0]));
    await page.waitForTimeout(3000);
    console.log(`-- ${lab}: url ${page.url().replace(ORIGIN, '')} | dialogs ${short(await dialogsText(page), 900)}`);
    console.log('   menu:', await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => (e.textContent || '').trim())));
    log.forEach((l) => console.log(`   ${l.method} ${l.status} ${l.path}`));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const close = page.getByRole('button', { name: /^(cancel|close)$/i });
    if (await close.count()) await close.first().click().catch(() => {});
    if (page.url() !== url0) { await page.goto(url0); await page.waitForTimeout(6000); }
    await page.waitForTimeout(800);
  }

  head('5. search');
  const search = page.locator('main input[type="search"], main input[placeholder*="earch" i]').first();
  if (await search.count()) {
    for (const term of ['zzzz-no-match-zz', '   ']) {
      log.length = 0;
      await search.fill('');
      await search.pressSequentially(term, { delay: 30 });
      await page.waitForTimeout(3000);
      console.log(`term "${term}" url ${page.url().replace(ORIGIN, '')} req ${log.map((l) => l.path).join(' ; ')}`);
      console.log('  main:', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(-400));
    }
    await search.fill('');
    await page.waitForTimeout(3000);
  } else console.log('no search box');

  head('6. pagination');
  const pager = await page.evaluate(() => Array.from(document.querySelectorAll('main button[aria-label^="Page"], main button[aria-label*="Page"]')).map((b) => `${b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}${b.getAttribute('aria-current') ? ' *' : ''}`));
  console.log(pager);
  const next = page.getByRole('button', { name: 'Next Page' }).first();
  if (await next.count() && !(await next.isDisabled())) {
    log.length = 0;
    await next.click();
    await page.waitForTimeout(4000);
    console.log('after Next url', page.url().replace(ORIGIN, ''), log.map((l) => `${l.status} ${l.path}`));
  }

  head('7. edge URLs');
  for (const q of ['?tab=candidates&page=abc', '?tab=candidates&page=999', '?tab=CANDIDATES', '?tab=candidates&search=abc']) {
    log.length = 0;
    await page.goto(`${ORIGIN}/agents/view/${AGENT}${q}`);
    await page.waitForTimeout(6000);
    const sel = await page.evaluate(() => Array.from(document.querySelectorAll('main [role="radio"][aria-checked="true"]')).map((t) => (t.innerText || '').trim()));
    console.log(`${q} -> ${page.url().replace(ORIGIN, '')} selected ${sel} req ${log.filter((l) => /candidates/.test(l.path)).map((l) => `${l.status} ${l.path}`).join(' ; ')}`);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
