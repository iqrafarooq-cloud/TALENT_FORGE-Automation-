// Read-only. Follow-up to probe-agent-verifications-5.js:
//   date     - the Date Uploaded calendar popover, and what a picked range sends
//   order    - does the grid keep the order the server returned?
//   bigpage  - what ?page=99999 actually renders
//   empty    - the filter-only empty state and its "Clear all filters" CTA
//   relogin  - where a logged-out deep link lands after signing in
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const V = require('../pages/AgentVerificationsPage');

const only = (process.argv[2] || 'all').split(',');
const on = (k) => only.includes('all') || only.includes(k);

async function signIn(page) {
  const login = new LoginPage(page);
  if (!/\/login/.test(page.url())) await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const v = new V(page);
  v.install();

  if (on('relogin')) {
    await page.goto(`${v.url}?activeFilter=APPROVED&search=pdf`);
    await page.waitForURL(/login/, { timeout: 30000 });
    console.log('== RELOGIN redirected to', page.url());
    await signIn(page);
    await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 90000 });
    await page.waitForTimeout(3000);
    console.log('landed after sign-in', page.url());
  } else {
    await signIn(page);
    await page.waitForURL(/dashboard|candidates/, { timeout: 90000 });
  }

  if (on('order')) {
    await v.openWith({});
    const rows = await v.readRows();
    const last = await v.lastListResponse();
    console.log('== ORDER api ', JSON.stringify(last.results.map((r) => `${r.file_name}|${r.uploaded_on}`)));
    console.log('       ui  ', JSON.stringify(rows.map((r) => `${r.documentName}|${r.dateUploaded}`)));
    // a second identical load - is the UI order at least stable?
    await v.openWith({});
    const rows2 = await v.readRows();
    console.log('    ui again', JSON.stringify(rows2.map((r) => r.documentName)));
  }

  if (on('bigpage')) {
    await v.openWith({ page: 99999 });
    await page.waitForTimeout(2000);
    console.log('== BIGPAGE main', JSON.stringify((await page.locator('main').innerText()).slice(0, 500)));
    const res = (v.responses || []).slice(-1)[0];
    console.log('last parsed response', JSON.stringify(res && { q: res.query, count: res.count, n: res.results.length }));
    const r = await page.request.get('https://dev-api.talentforge.com.sa/core/api/v1/candidate/documents/all/?page=99999&page_size=10').catch((e) => e.message);
    console.log('raw api (no auth, just status)', r.status ? r.status() : r);
  }

  if (on('empty')) {
    // filter only, no search: pick a tab+type combination and a date range far in the future
    await v.openWith({ activeFilter: 'APPROVED', documentType: 'CERTIFICATION', startDate: '2099-01-01', endDate: '2099-01-02' });
    console.log('== EMPTY url', page.url(), 'query', await v.lastListQuery());
    console.log('empty', JSON.stringify(await v.readEmptyState()), 'rows', (await v.readRows()).length);
  }

  if (on('order2')) {
    await v.openWith({ page: 2 });
    const rows = await v.readRows();
    const last = await v.lastListResponse();
    console.log('== ORDER page 2 api', JSON.stringify(last.results.map((r) => `${r.file_name}|${r.uploaded_on}`)));
    console.log('                 ui', JSON.stringify(rows.map((r) => `${r.documentName}|${r.dateUploaded}`)));
  }

  if (on('date')) {
    // Pick a day in a calendar popover: navigate back `monthsBack`, click the day, then the
    // popover's OWN Apply (the popover stays open until then and blocks the other picker).
    const pickDay = async (which, monthsBack, day) => {
      await v.filterDialog.getByRole('button', { name: 'Calendar' }).nth(which).click();
      const pop = page.locator('[role="dialog"]').last();
      await pop.getByRole('button', { name: 'Apply' }).waitFor();
      for (let i = 0; i < monthsBack; i++) await pop.getByRole('button', { name: 'Previous' }).first().click();
      const heading = (await pop.innerText()).split('\n')[0];
      const cell = pop.locator(`[role="gridcell"] [aria-label*=" ${day}, "]`).filter({ hasNotText: /^$/ });
      const info = await pop.locator('[role="gridcell"] [role="button"]').evaluateAll((b) => b.filter((x) => !x.getAttribute('aria-disabled')).length);
      const target = pop.locator('[role="gridcell"] [role="button"]:not([aria-disabled="true"])').getByText(new RegExp(`^${day}$`)).first();
      const dis = await pop.locator('[role="gridcell"] [role="button"]').evaluateAll((b, d) => b.filter((x) => x.innerText.trim() === String(d)).map((x) => x.getAttribute('aria-label') + ' disabled=' + x.getAttribute('aria-disabled')), day);
      console.log(`  picker ${which} month "${heading}" enabled cells ${info}; day ${day}:`, JSON.stringify(dis));
      await target.click();
      await pop.getByRole('button', { name: 'Apply' }).click();
      await page.waitForTimeout(600);
      void cell;
    };
    await v.openWith({});
    await v.openFilters();
    await pickDay(0, 1, 10); // Sept 10
    await pickDay(1, 1, 20); // Sept 20
    console.log('groups', JSON.stringify(await v.filterDialog.locator('[role="group"]').evaluateAll((g) => g.map((x) => x.innerText.trim()))));
    await v.applyFilters();
    console.log('after apply url', page.url());
    console.log('query', await v.lastListQuery());
    const rows = await v.readRows();
    console.log('dates rendered', JSON.stringify(rows.map((r) => r.dateUploaded)), 'count', await v.lastListCount(), 'badge', await v.filtersBadge());
    await v.openFilters();
    console.log('reopened groups', JSON.stringify(await v.filterDialog.locator('[role="group"]').evaluateAll((g) => g.map((x) => x.innerText.trim()))));
    await v.clearAllFilters();
    console.log('after clear all url', page.url(), 'query', await v.lastListQuery(), 'groups', JSON.stringify(await v.filterDialog.locator('[role="group"]').evaluateAll((g) => g.map((x) => x.innerText.trim()))));
    await v.cancelFilters();
    // reload with the range in the URL
    await v.openWith({});
    await v.openFilters();
    await pickDay(0, 1, 10);
    await pickDay(1, 1, 20);
    await v.applyFilters();
    const u = page.url();
    const b = v.responseCountSync();
    await page.reload();
    await v.settleAgainstServer(b);
    console.log('reload url', page.url(), 'same', page.url() === u, 'query', await v.lastListQuery());
    // end before start: start Sep 20, then open end picker and check Sep 10
    await v.openWith({});
    await v.openFilters();
    await pickDay(0, 1, 20);
    await v.filterDialog.getByRole('button', { name: 'Calendar' }).nth(1).click();
    const pop = page.locator('[role="dialog"]').last();
    await pop.getByRole('button', { name: 'Apply' }).waitFor();
    await pop.getByRole('button', { name: 'Previous' }).first().click();
    const d10 = await pop.locator('[role="gridcell"] [role="button"]').evaluateAll((bs) => bs.filter((x) => x.innerText.trim() === '10').map((x) => x.getAttribute('aria-label') + ' disabled=' + x.getAttribute('aria-disabled')));
    console.log('== END BEFORE START: Sep 10 in end picker', JSON.stringify(d10));
    await pop.locator('[role="gridcell"] [role="button"]:not([aria-disabled="true"])').getByText(/^10$/).first().click().catch((e) => console.log('click err', e.message.split('\n')[0]));
    await pop.getByRole('button', { name: 'Apply' }).click().catch((e) => console.log('apply err', e.message.split('\n')[0]));
    await page.waitForTimeout(600);
    console.log('groups', JSON.stringify(await v.filterDialog.locator('[role="group"]').evaluateAll((g) => g.map((x) => x.innerText.trim()))), 'modal text tail', JSON.stringify((await v.filterDialog.innerText()).slice(-200)));
    const applyDisabled = await v.filterDialog.locator('[data-testid="filters-apply-button"]').isDisabled();
    console.log('Apply Filters disabled', applyDisabled);
    if (!applyDisabled) { await v.applyFilters(); console.log('applied query', await v.lastListQuery(), 'rows', (await v.readRows()).length, 'empty', JSON.stringify(await v.readEmptyState())); }
    // future range
    await v.openWith({});
    await v.openFilters();
    await v.filterDialog.getByRole('button', { name: 'Calendar' }).nth(0).click();
    const pf = page.locator('[role="dialog"]').last();
    await pf.getByRole('button', { name: 'Apply' }).waitFor();
    await pf.getByRole('button', { name: 'Next' }).first().click();
    const futureEnabled = await pf.locator('[role="gridcell"] [role="button"]').evaluateAll((bs) => bs.filter((x) => !x.getAttribute('aria-disabled')).length);
    console.log('== FUTURE month enabled cells', futureEnabled, 'heading', (await pf.innerText()).split('\n')[0]);
    await pf.getByRole('button', { name: 'Cancel' }).click();
  }

  if (on('single')) {
    const pick = async (which, nav, day) => {
      await v.filterDialog.getByRole('button', { name: 'Calendar' }).nth(which).click();
      const pop = page.locator('[role="dialog"]').last();
      await pop.getByRole('button', { name: 'Apply' }).waitFor();
      for (const dir of nav) await pop.getByRole('button', { name: dir }).first().click();
      await pop.locator('[role="gridcell"] [role="button"]:not([aria-disabled="true"])').getByText(new RegExp(`^${day}$`)).first().click();
      await pop.getByRole('button', { name: 'Apply' }).click();
      await page.waitForTimeout(500);
    };
    await v.openWith({});
    await v.openFilters();
    await pick(0, ['Previous'], 15);
    await pick(1, ['Previous'], 15);
    await v.applyFilters();
    console.log('== SINGLE DAY query', await v.lastListQuery(), 'dates', JSON.stringify((await v.readRows()).map((r) => r.dateUploaded)), 'count', await v.lastListCount());
    await v.openWith({});
    await v.openFilters();
    await pick(0, ['Next'], 10);
    await pick(1, ['Next'], 20);
    await v.applyFilters();
    console.log('== FUTURE RANGE query', await v.lastListQuery(), 'rows', (await v.readRows()).length, 'empty', JSON.stringify(await v.readEmptyState()));
    const cta = page.getByRole('button', { name: /clear all filters/i });
    console.log('CTA count', await cta.count());
    if (await cta.count()) {
      const b0 = v.responseCountSync();
      await cta.first().click();
      await v.settleAgainstServer(b0);
      console.log('after CTA url', page.url(), 'query', await v.lastListQuery(), 'rows', (await v.readRows()).length, 'badge', await v.filtersBadge());
    }
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
