// Read-only. Measures the Verifications behaviours the feature did NOT yet cover: default order,
// sortable headers, the Date Uploaded controls, pagination past page 2, row + panel Download by
// mouse, the row's candidate buttons, decision-dialog X/Escape, reload restoring the view, a
// filter combination matching nothing, a server error, and logged-out access.
// Opens dialogs and cancels them; NEVER decides a document.
//
//   node scripts/probe-agent-verifications-5.js [order,date,page,download,cand,dialog,reload,error]
require('dotenv').config();
const fs = require('fs');
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const V = require('../pages/AgentVerificationsPage');

const only = (process.argv[2] || 'all').split(',');
const on = (k) => only.includes('all') || only.includes(k);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const v = new V(page);
  v.install();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/dashboard|candidates/, { timeout: 90000 });
  await v.openWith({});

  if (on('order')) {
    const rows = await v.readRows();
    console.log('== ORDER first page dates', JSON.stringify(rows.map((r) => r.dateUploaded)));
    console.log('API query', await v.lastListQuery());
    const last = await v.lastListResponse();
    console.log('result keys', Object.keys((last.results || [])[0] || {}).join(','));
    console.log(
      'API date fields',
      JSON.stringify(
        (last.results || []).slice(0, 10).map((r) =>
          Object.fromEntries(Object.entries(r).filter(([k]) => /date|created|upload|_at/i.test(k)))
        )
      )
    );
    const heads = await page.locator('[role="columnheader"]').evaluateAll((hs) =>
      hs.map((h) => ({
        t: h.innerText.trim(),
        sort: h.getAttribute('aria-sort'),
        btn: !!h.querySelector('button'),
        tab: h.tabIndex,
        cursor: getComputedStyle(h).cursor,
      }))
    );
    console.log('HEADERS', JSON.stringify(heads));
    const b = v.requestCount();
    await page.locator('[role="columnheader"]').filter({ hasText: 'Date Uploaded' }).first().click().catch((e) => console.log('hdr click err', e.message));
    await page.waitForTimeout(2000);
    console.log('after header click requests', JSON.stringify(v.requestsSince(b)), 'url', page.url());
  }

  if (on('date')) {
    await v.openWith({});
    await v.openFilters();
    const html = await v.filterDialog.evaluate((d) => {
      const lab = [...d.querySelectorAll('label')].find((l) => /Start Date/.test(l.innerText));
      let host = lab;
      for (let i = 0; i < 3 && host && host.parentElement; i++) host = host.parentElement;
      return host ? host.outerHTML.replace(/\s+/g, ' ').slice(0, 3500) : 'none';
    });
    console.log('== DATE HTML', html);
    const segs = await v.filterDialog.locator('[role="spinbutton"]').evaluateAll((s) =>
      s.map((x) => ({ label: x.getAttribute('aria-label'), val: x.getAttribute('aria-valuetext'), txt: x.innerText }))
    );
    console.log('SEGMENTS', JSON.stringify(segs));
    const inputs = await v.filterDialog.locator('input').evaluateAll((s) =>
      s.map((x) => ({ type: x.type, name: x.name, ph: x.placeholder, hidden: x.getAttribute('aria-hidden'), val: x.value, ro: x.readOnly }))
    );
    console.log('INPUTS', JSON.stringify(inputs));
    const btns = await v.filterDialog.locator('button').evaluateAll((s) => s.map((x) => (x.getAttribute('aria-label') || x.innerText).trim()));
    console.log('BUTTONS', JSON.stringify(btns));
    await v.cancelFilters();
  }

  if (on('page')) {
    await v.openWith({});
    const pg = await v.readPagination();
    console.log('== PAGINATION', JSON.stringify(pg.raw), 'count', await v.lastListCount());
    const b = v.responseCountSync();
    await v.pagination.getByRole('button', { name: /^Page 3$/ }).click().catch((e) => console.log('p3 err', e.message));
    await v.settleAgainstServer(b);
    console.log('after Page 3 click query', await v.lastListQuery(), 'url', page.url());
    const total = await v.lastListCount();
    const lastPage = Math.ceil(total / 10);
    await v.openWith({ page: lastPage });
    console.log(`deep link page=${lastPage} query`, await v.lastListQuery(), 'url', page.url(), 'rows', (await v.readRows()).length);
    console.log('pagination at last', JSON.stringify((await v.readPagination()).raw));
    await v.openWith({ page: 99999 });
    console.log('deep link page=99999 query', await v.lastListQuery(), 'url', page.url(), 'rows', (await v.readRows()).length, 'empty', JSON.stringify(await v.readEmptyState()));
    await v.openWith({ page: 'abc' });
    console.log('deep link page=abc query', await v.lastListQuery(), 'url', page.url(), 'rows', (await v.readRows()).length);
  }

  if (on('download')) {
    await v.openWith({});
    const rows = await v.readRows();
    const url0 = page.url();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      v.rows.nth(0).locator('[data-testid="agent-verifications-download-button"]').click(),
    ]);
    console.log('== ROW DOWNLOAD row', rows[0].documentName, '-> file', dl && dl.suggestedFilename(), 'url changed', page.url() !== url0, 'pages', ctx.pages().length);
    if (dl) {
      const p = await dl.path();
      console.log('bytes', fs.statSync(p).size, 'head', JSON.stringify(fs.readFileSync(p).slice(0, 5).toString()));
    }
    await v.openRow(0);
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      v.panel.getByRole('button', { name: /^Download$/ }).click(),
    ]);
    console.log('PANEL DOWNLOAD -> file', dl2 && dl2.suggestedFilename(), 'panel still open', await v.panelOpen());
    await v.closePanel();
  }

  if (on('cand')) {
    await v.openWith({});
    const cell = v.rows.nth(0).locator('td').nth(1);
    console.log('== CAND cell buttons', JSON.stringify(await cell.locator('button').evaluateAll((b) => b.map((x) => x.innerText.trim()))));
    const url0 = page.url();
    await cell.locator('button').first().click().catch((e) => console.log('err', e.message));
    await page.waitForTimeout(2500);
    console.log('after name click url', page.url(), 'changed', page.url() !== url0, 'dialogs', await page.locator('[role="dialog"]').count());
  }

  if (on('dialog')) {
    await v.openWith({ activeFilter: 'AWAITING' });
    await v.openRow(0);
    for (const d of ['Request Revision', 'Approve']) {
      if (!(await v.panelOpen())) await v.openRow(0);
      await v.openDecisionDialog(d);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      console.log(`== ${d} after Escape: decision open`, await v.decisionDialogIsOpen(d), 'panel open', await v.panelOpen());
      if (!(await v.panelOpen())) await v.openRow(0);
      await v.openDecisionDialog(d);
      const top = page.locator('[role="dialog"]').last();
      console.log('decision dialog buttons', JSON.stringify(await top.locator('button').evaluateAll((b) => b.map((x) => (x.getAttribute('aria-label') || x.innerText).trim()))));
      await top.getByRole('button', { name: /close/i }).first().click().catch((e) => console.log('X err', e.message));
      await page.waitForTimeout(800);
      console.log(`${d} after X: decision open`, await v.decisionDialogIsOpen(d), 'panel open', await v.panelOpen());
      if (!(await v.panelOpen())) await v.openRow(0);
      await v.openDecisionDialog(d);
      await page.locator('[role="dialog"]').last().locator('textarea').fill('draft reason');
      await page.locator('[role="dialog"]').last().getByRole('button', { name: /^Cancel$/ }).click();
      await page.waitForTimeout(600);
      await v.openDecisionDialog(d);
      console.log(`${d} reopened textarea value`, JSON.stringify(await page.locator('[role="dialog"]').last().locator('textarea').inputValue()));
      await page.locator('[role="dialog"]').last().getByRole('button', { name: /^Cancel$/ }).click();
      await page.waitForTimeout(600);
    }
    await v.closePanel();
  }

  if (on('reload')) {
    await v.openWith({ activeFilter: 'APPROVED' });
    await v.searchFor('pdf');
    await v.openFilters();
    await v.selectFilterOption('Transcript');
    await v.applyFilters();
    const before = page.url();
    const q1 = await v.lastListQuery();
    const b = v.responseCountSync();
    await page.reload();
    await v.settleAgainstServer(b);
    await v.settleList();
    console.log('== RELOAD url before', before, '\n after', page.url(), '\n query', q1, '->', await v.lastListQuery(), '\n search box', await v.searchValue(), 'tab', JSON.stringify((await v.selectedTab()).selected), 'badge', await v.filtersBadge());
    await v.openWith({ activeFilter: 'APPROVED', documentType: 'CERTIFICATION', search: 'zzznomatchzzz' });
    console.log('filter+search empty', JSON.stringify(await v.readEmptyState()));
    console.log('main buttons', JSON.stringify(await page.locator('main button').evaluateAll((b) => b.map((x) => x.innerText.trim()).filter(Boolean).slice(0, 25))));
  }

  if (on('error')) {
    await page.route('**/candidate/documents/all/**', (r) => r.fulfill({ status: 500, body: '{"detail":"boom"}', contentType: 'application/json' }));
    await page.goto(v.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('== 500 main text', JSON.stringify((await page.locator('main').innerText()).slice(0, 600)));
    console.log('alerts/toasts', JSON.stringify(await page.locator('[role="alert"], [role="status"], .Toastify__toast').evaluateAll((t) => t.map((x) => x.innerText.trim()).filter(Boolean))));
    await page.unroute('**/candidate/documents/all/**');
    await page.route('**/candidate/documents/all/**', (r) => r.abort('internetdisconnected'));
    await page.goto(v.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('== OFFLINE main text', JSON.stringify((await page.locator('main').innerText()).slice(0, 600)));
    await page.unroute('**/candidate/documents/all/**');
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await p2.goto(v.url);
    await p2.waitForTimeout(5000);
    console.log('== LOGGED OUT /verifications ->', p2.url());
    await p2.goto(`${v.url}?activeFilter=APPROVED&search=abc`);
    await p2.waitForTimeout(4000);
    console.log('logged out deep link ->', p2.url());
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
