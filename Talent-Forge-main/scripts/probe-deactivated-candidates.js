// Read-only probe: the Agent Portal's Candidates > Deactivated tab.
// Maps the route, heading, columns, search, the filter modal, row actions, the View
// destination, the empty states and pagination.
// COMMITS NOTHING: every dialog opened is dismissed; nothing is reactivated.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);
const ROW = '[role="row"]:has([role="rowheader"])';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const api = [];
  page.on('request', (r) => {
    if (/\/api\/v1\//.test(r.url()) && r.method() === 'GET') api.push(decodeURIComponent(r.url()));
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });

  api.length = 0;
  await page.goto(`${origin}/candidates/deactivated`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  console.log('=== 1. URL / IDENTITY ===');
  console.log('url:', decodeURIComponent(page.url()));
  console.log('headings:', J(await page.$$eval('h1,h2,h3,h4', (e) => e.map((x) => x.innerText.trim()).filter(Boolean))));
  console.log('list requests:', J(api.filter((u) => /candidate/i.test(u))));

  console.log('\n=== 2. RADIOGROUPS / TAB STRIPS ===');
  console.log(J(await page.$$eval('[role="radiogroup"]', (gs) => gs.map((g) => ({
    items: [...g.querySelectorAll('[role="radio"],label')].map((e) => ({
      text: e.innerText.replace(/\s+/g, ' ').trim(),
      testid: e.getAttribute('data-testid'),
      checked: e.getAttribute('aria-checked'),
    })),
  })))));

  console.log('\n=== 3. COLUMN HEADERS ===');
  console.log(J(await page.$$eval('[role="columnheader"]', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))));

  console.log('\n=== 4. INPUTS ===');
  console.log(J(await page.$$eval('input', (els) => els
    .map((e) => ({ testid: e.getAttribute('data-testid'), ph: e.placeholder, type: e.type }))
    .filter((e) => e.type !== 'hidden'))));

  console.log('\n=== 5. GRID ROWS (first 3) ===');
  console.log(J(await page.$$eval(ROW, (rs) => rs.slice(0, 3).map((r) => ({
    header: (r.querySelector('[role="rowheader"]') || {}).innerText,
    cells: [...r.querySelectorAll('[role="gridcell"]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
    buttons: [...r.querySelectorAll('button')].map((b) => ({
      aria: b.getAttribute('aria-label'),
      testid: b.getAttribute('data-testid'),
      text: b.innerText.replace(/\s+/g, ' ').trim(),
      disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
    })),
    svgOutsideButton: [...r.querySelectorAll('svg')].filter((s) => !s.closest('button')).length,
  })))));
  console.log('row count:', await page.locator(ROW).count());

  console.log('\n=== 6. PAGE-LEVEL BUTTONS ===');
  console.log(J(await page.$$eval('main button, [role="main"] button', (els) => els.slice(0, 40).map((e) => ({
    text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 40),
    testid: e.getAttribute('data-testid'),
    aria: e.getAttribute('aria-label'),
  })))));

  console.log('\n=== 7. FILTER MODAL ===');
  const filtersBtn = page.locator('[data-testid="agent-candidates-filters-button"], button:has-text("Filters")').first();
  console.log('filters button present:', await filtersBtn.count());
  if (await filtersBtn.count()) {
    await filtersBtn.click();
    await page.waitForTimeout(1500);
    const dlg = page.getByRole('dialog').first();
    console.log('dialog text:', JSON.stringify((await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)));
    console.log('labels in DOM order:', J(await dlg.locator('label').evaluateAll( (ls) => ls.map((l, i) => ({
      i,
      text: l.innerText.replace(/\s+/g, ' ').trim(),
      testid: l.getAttribute('data-testid'),
      inputType: (l.querySelector('input') || {}).type || (l.getAttribute('data-react-aria-pressable') !== null ? 'react-aria-pressable' : null),
      role: (l.querySelector('[role]') || {}).getAttribute ? l.querySelector('[role]').getAttribute('role') : null,
    })))));
    console.log('dialog headings:', J(await dlg.locator('h1,h2,h3,h4,h5,p,span').evaluateAll( (e) => e.map((x) => x.innerText.trim()).filter((t) => t && t.length < 40)).catch(() => [])));
    console.log('dialog buttons:', J(await dlg.locator('button').evaluateAll( (e) => e.map((x) => ({ text: x.innerText.replace(/\s+/g,' ').trim(), aria: x.getAttribute('aria-label') })))));
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
    console.log('dialog visible after Escape:', await dlg.isVisible().catch(() => false));
  }

  console.log('\n=== 8. PAGINATION ===');
  console.log(J(await page.$$eval('nav', (ns) => ns.map((n) => ({
    aria: n.getAttribute('aria-label'),
    text: n.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
  })))));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
