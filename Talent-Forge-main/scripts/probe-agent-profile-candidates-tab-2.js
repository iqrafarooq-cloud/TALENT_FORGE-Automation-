/* eslint-disable no-console */
// probe-agent-profile-candidates-tab-2.js - READ-ONLY. Second pass over the agent profile's
// Candidates tab: the row markup the readers depend on, the row menu's two dialogs (Reassign
// candidate, Deactivate - both CANCELLED), the Edit modal's controls, a deactivated candidate's
// row on a profile, and pagination on an agent with more than one page.
//
// Run:  node scripts/probe-agent-profile-candidates-tab-2.js [--agent 1220]
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const AGENT = process.argv.find((a, i) => process.argv[i - 1] === '--agent') || '1220';
const head = (t) => console.log(`\n================ ${t} ================`);
const short = (o, n = 900) => String(JSON.stringify(o)).slice(0, n);

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates|agents-analytics|candidate-analytics)/, { timeout: 90000 });
}

function apiLog(page) {
  const log = [];
  let token = null;
  page.on('request', (r) => { const a = r.headers().authorization; if (a && /\/api\/v1\//.test(r.url())) token = a; });
  page.on('response', async (r) => {
    if (!/\/api\/v1\//.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* */ }
    log.push({ method: r.request().method(), path: r.url().replace(/^.*\/api\/v1/, ''), status: r.status(), body });
  });
  log.token = () => token;
  return log;
}

const dialogs = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
  .filter((d) => d.getBoundingClientRect().height > 0).map((d) => ({
    text: (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900),
    controls: Array.from(d.querySelectorAll('button,input,select,textarea')).map((b) => `${b.tagName.toLowerCase()}[${b.type || ''}] ${b.getAttribute('aria-label') || (b.innerText || '').trim() || b.placeholder || ''}${b.disabled ? ' (disabled)' : ''}`),
    selects: Array.from(d.querySelectorAll('select')).map((s) => Array.from(s.options).map((o) => o.text)),
  })));

async function openTab(page, id) {
  await page.goto(`${ORIGIN}/agents/view/${id}?tab=candidates`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
}

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const log = apiLog(page);
  await login(page);
  await openTab(page, AGENT);

  head('A. row markup');
  console.log(await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('main [role="row"]')).find((r) => !r.querySelector('[role="columnheader"]'));
    return { rowheaders: row.querySelectorAll('[role="rowheader"]').length, rowheaderText: (row.querySelector('[role="rowheader"]') || {}).innerText, cellRoles: Array.from(row.children).map((c) => c.getAttribute('role')), html: row.outerHTML.slice(0, 2500) };
  }));
  console.log('headers roles:', await page.evaluate(() => Array.from(document.querySelectorAll('main [role="columnheader"]')).map((h) => `${(h.innerText || '').trim()} sort=${h.getAttribute('aria-sort')} btn=${h.querySelectorAll('button').length}`)));

  const row = page.locator('main [role="row"]').filter({ has: page.locator('[role="gridcell"]') }).first();

  head('B. Edit modal');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForTimeout(1500);
  console.log(short(await dialogs(page), 2000));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  console.log('after Escape dialogs:', (await dialogs(page)).length);

  head('C. row menu -> Reassign candidate');
  log.length = 0;
  await row.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('menu items:', await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => `${(e.textContent || '').trim()} disabled=${e.getAttribute('aria-disabled')}`)));
  await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /reassign candidate/i }).first().click();
  await page.waitForTimeout(3000);
  console.log(short(await dialogs(page), 2500));
  log.forEach((l) => console.log(`  ${l.method} ${l.status} ${l.path} ${short(l.body, 300)}`));
  // the New Agent picker, opened then closed
  const combo = page.locator('[role="dialog"] input[role="combobox"], [role="dialog"] button[aria-haspopup]').first();
  if (await combo.count()) {
    log.length = 0;
    await combo.click().catch(() => {});
    await page.waitForTimeout(2500);
    console.log('options:', await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).slice(0, 12).map((o) => (o.innerText || '').replace(/\s+/g, ' ').trim())));
    log.forEach((l) => console.log(`  ${l.method} ${l.status} ${l.path}`));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.getByRole('button', { name: /^cancel$/i }).last().click().catch(() => {});
  await page.waitForTimeout(1200);
  console.log('after cancel dialogs:', (await dialogs(page)).length, 'non-GET:', log.filter((l) => l.method !== 'GET').length);

  head('D. row menu -> Deactivate');
  log.length = 0;
  await row.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /^deactivate$/i }).first().click();
  await page.waitForTimeout(2500);
  console.log(short(await dialogs(page), 2500));
  await page.getByRole('button', { name: /^cancel$/i }).last().click().catch(() => {});
  await page.waitForTimeout(1200);
  console.log('after cancel dialogs:', (await dialogs(page)).length, 'writes:', log.filter((l) => l.method !== 'GET').map((l) => l.path));

  head('E. keyboard: tab to the row and arrow to the actions');
  await page.locator('main input[type="search"]').first().focus();
  const stops = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press(i < 3 ? 'Tab' : 'ArrowRight');
    stops.push(await page.evaluate(() => { const a = document.activeElement; return `${a.tagName}${a.getAttribute('role') ? `[${a.getAttribute('role')}]` : ''} ${a.getAttribute('aria-label') || (a.innerText || '').trim().slice(0, 30)}`; }));
  }
  console.log(stops);

  head('F. a deactivated candidate on some agent profile, and pagination');
  const token = log.token();
  const api = async (p) => page.evaluate(async ([u, t]) => (await fetch(u, { headers: { authorization: t } })).json(), [`https://dev-api.talentforge.com.sa/core/api/v1${p}`, token]);
  const deact = await api('/candidate/?page=1&page_size=5&is_active=false');
  const d0 = (deact.results || [])[0];
  console.log('a deactivated candidate:', short(d0, 400));
  if (d0) {
    const ag = await api(`/agent/?page=1&page_size=5&search=${encodeURIComponent(d0.agent_email)}`);
    const a0 = (ag.results || []).find((a) => a.email === d0.agent_email) || (ag.results || [])[0];
    console.log('its agent:', a0 && a0.id, a0 && a0.email);
    if (a0) {
      await openTab(page, a0.id);
      await page.locator('main input[type="search"]').first().fill(d0.email);
      await page.waitForTimeout(3500);
      const r = page.locator('main [role="row"]').filter({ hasText: d0.email }).first();
      console.log('row:', (await r.innerText().catch(() => '(not listed)')).replace(/\s+/g, ' '));
      console.log('buttons:', await r.locator('button').evaluateAll((bs) => bs.map((b) => `${b.getAttribute('aria-label') || (b.innerText || '').trim()}${b.disabled ? ' (disabled)' : ''}`)).catch(() => []));
      if (await r.getByRole('button', { name: 'Open menu' }).count()) {
        await r.getByRole('button', { name: 'Open menu' }).click();
        await page.waitForTimeout(800);
        console.log('menu:', await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((e) => (e.textContent || '').trim())));
        await page.keyboard.press('Escape');
      }
    }
  }
  const big = (await api('/agent/?page=1&page_size=50&status=ACTIVE')).results || [];
  const many = big.filter((a) => (a.total_candidate_count || 0) > 10)[0];
  console.log('agent keys:', big[0] && Object.keys(big[0]));
  console.log('agent with >10:', many && many.id, many && many.email, many && many.total_candidate_count);
  if (many) {
    log.length = 0;
    await openTab(page, many.id);
    console.log('pager:', await page.evaluate(() => Array.from(document.querySelectorAll('main button[aria-label*="Page"]')).filter((b) => b.offsetParent).map((b) => `${b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}${b.getAttribute('aria-current') ? ' *' : ''}`)));
    log.length = 0;
    await page.getByRole('button', { name: 'Next Page' }).first().click().catch((e) => console.log('next fail', e.message.split('\n')[0]));
    await page.waitForTimeout(3500);
    console.log('after Next', page.url().replace(ORIGIN, ''), log.filter((l) => /candidates/.test(l.path)).map((l) => `${l.status} ${l.path} n=${l.body && l.body.results && l.body.results.length}`));
    console.log('pager:', await page.evaluate(() => Array.from(document.querySelectorAll('main button[aria-label*="Page"]')).filter((b) => b.offsetParent).map((b) => `${b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}${b.getAttribute('aria-current') ? ' *' : ''}`)));
    log.length = 0;
    await page.locator('main input[type="search"]').first().fill('a');
    await page.waitForTimeout(3500);
    console.log('search from page 2:', log.filter((l) => /candidates/.test(l.path)).map((l) => `${l.status} ${l.path}`));
    await page.reload();
    await page.waitForTimeout(7000);
    console.log('after reload: selected', await page.evaluate(() => Array.from(document.querySelectorAll('main [role="radio"][aria-checked="true"]')).map((t) => (t.innerText || '').trim())), 'search box', await page.locator('main input[type="search"]').first().inputValue());
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
