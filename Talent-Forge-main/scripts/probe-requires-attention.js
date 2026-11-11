// Read-only probe: the Agent Portal's Candidates > Requires Attention tab.
// Maps the tabs, columns, search, filter modal, row actions, the View
// destination, the Reminder History panel and pagination.
// COMMITS NOTHING: no reminder is ever sent; every dialog opened is dismissed.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);

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

  await page.goto(`${origin}/candidates/requires-attention`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  console.log('=== 1. URL / IDENTITY ===');
  console.log('url:', decodeURIComponent(page.url()));
  console.log('headings:', J(await page.$$eval('h1,h2,h3', (e) => e.map((x) => x.innerText.trim()).filter(Boolean))));

  console.log('\n=== 2. TABS (radiogroup) ===');
  console.log(
    J(
      await page.$$eval('[role="radiogroup"] [role="radio"], [role="radiogroup"] label', (els) =>
        els.map((e) => ({
          text: e.innerText.replace(/\s+/g, ' ').trim(),
          testid: e.getAttribute('data-testid'),
          checked: e.getAttribute('aria-checked'),
        }))
      )
    )
  );

  console.log('\n=== 3. COLUMN HEADERS ===');
  console.log(J(await page.$$eval('[role="columnheader"]', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))));

  console.log('\n=== 4. INPUTS ===');
  console.log(
    J(
      await page.$$eval('input', (els) =>
        els
          .map((e) => ({ testid: e.getAttribute('data-testid'), ph: e.placeholder, type: e.type }))
          .filter((e) => e.type !== 'hidden')
      )
    )
  );

  console.log('\n=== 5. GRID ROWS (first 3) ===');
  console.log(
    J(
      await page.$$eval('[role="row"]:has([role="rowheader"])', (rs) =>
        rs.slice(0, 3).map((r) => ({
          header: (r.querySelector('[role="rowheader"]') || {}).innerText,
          cells: [...r.querySelectorAll('[role="gridcell"]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
          actions: [...r.querySelectorAll('button')].map((b) => ({
            aria: b.getAttribute('aria-label'),
            testid: b.getAttribute('data-testid'),
            disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
          })),
        }))
      )
    )
  );

  console.log('\n=== 6. PER-TAB ===');
  for (const t of ['All', 'Warning', 'Critical']) {
    api.length = 0;
    const lbl = page.locator('[role="radiogroup"]').first().getByText(new RegExp(`^${t}$`, 'i')).first();
    if (!(await lbl.count())) {
      console.log(`TAB "${t}": NOT FOUND`);
      continue;
    }
    await lbl.click();
    await page.waitForTimeout(2500);
    const acts = await page.$$eval('[role="row"]:has([role="rowheader"])', (rs) =>
      rs.map((r) =>
        [...r.querySelectorAll('button')]
          .map(
            (b) =>
              `${b.getAttribute('aria-label') || b.getAttribute('data-testid')}${
                b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' ? '[DISABLED]' : ''
              }`
          )
          .join(' + ')
      )
    );
    console.log(`\nTAB "${t}" url=${decodeURIComponent(page.url())}`);
    console.log('  api:', J(api.filter((u) => /candidate/.test(u))));
    console.log('  rows=' + acts.length);
    console.log(
      '  cells:',
      J(
        await page.$$eval('[role="row"]:has([role="rowheader"])', (rs) =>
          rs.slice(0, 4).map((r) => [...r.querySelectorAll('[role="gridcell"]')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()))
        )
      )
    );
    console.log('  actions:', J([...new Set(acts)]));
  }

  console.log('\n=== 7. FILTER MODAL ===');
  const fb = page.locator('[data-testid="agent-candidates-filters-button"], button:has-text("Filters")').first();
  if (await fb.count()) {
    await fb.click();
    await page.waitForTimeout(1500);
    const dlg = page.getByRole('dialog').first();
    console.log('dialog text:', (await dlg.innerText().catch(() => '(none)')).replace(/\n+/g, ' | '));
    console.log(
      'labels:',
      J(
        await dlg
          .evaluate((d) =>
            [...d.querySelectorAll('label')].map((l) => ({
              text: l.innerText.replace(/\s+/g, ' ').trim(),
              testid: l.getAttribute('data-testid'),
              type: (l.querySelector('input') || {}).type,
            }))
          )
          .catch(() => [])
      )
    );
    console.log(
      'buttons:',
      J(
        await dlg
          .evaluate((d) => [...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim() || b.getAttribute('aria-label')))
          .catch(() => [])
      )
    );
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  } else console.log('NO Filters button on this tab');

  console.log('\n=== 8. PAGINATION ===');
  console.log(J(await page.$$eval('[role="navigation"], nav', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))));

  console.log('\n=== 9. REMINDER HISTORY PANEL ===');
  const rh = page.locator('[data-testid="agent-candidates-reminder-history-button"], button[aria-label="Reminder History"]');
  const n = await rh.count();
  console.log('reminder-history buttons:', n);
  let opened = false;
  for (let i = 0; i < n && !opened; i++) {
    if (!(await rh.nth(i).isEnabled().catch(() => false))) continue;
    await rh.nth(i).click();
    await page.waitForTimeout(2500);
    const d = page.getByRole('dialog').first();
    if (await d.isVisible().catch(() => false)) {
      opened = true;
      console.log('panel text:', (await d.innerText()).replace(/\n+/g, ' | '));
      console.log(
        'panel buttons:',
        J(await d.evaluate((x) => [...x.querySelectorAll('button')].map((b) => b.innerText.trim() || b.getAttribute('aria-label'))))
      );
      console.log('url while open:', decodeURIComponent(page.url()));
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  if (!opened) console.log('no ENABLED reminder-history button found');

  console.log('\n=== 10. VIEW DESTINATION ===');
  await page.waitForTimeout(1000);
  const vb = page.locator('[data-testid="agent-candidates-view-button"], button[aria-label="View"]').first();
  if (await vb.count()) {
    await vb.click();
    await page.waitForTimeout(4500);
    console.log('after View, url:', decodeURIComponent(page.url()));
    console.log('headings:', J(await page.$$eval('h1,h2,h3', (e) => e.map((x) => x.innerText.trim()).filter(Boolean))));
    console.log(
      'tabs on destination:',
      J(await page.$$eval('[role="radio"],[role="tab"]', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean)))
    );
    console.log(
      'back control:',
      J(await page.$$eval('button', (e) => e.map((x) => x.innerText.trim() || x.getAttribute('aria-label')).filter((t) => /back/i.test(t || ''))))
    );
  } else console.log('no View button');

  await browser.close();
})();
