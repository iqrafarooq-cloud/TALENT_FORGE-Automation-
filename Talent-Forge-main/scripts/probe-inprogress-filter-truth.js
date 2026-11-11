// Are the three failing filter scenarios finding a PRODUCT bug or a suite bug?
//
// Each one fails on an arithmetic claim the suite makes about a whole population, and none of
// them can be judged from the rendered page - the answer is in the API's own counts. This asks
// the endpoint directly, per band and per state, and cross-tabulates the FULL population so a
// shortfall or an overlap is attributed to real rows rather than inferred from two totals.
// Read-only: no filter is applied through the UI, nothing is created, nothing is decided.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    const ip = new InProgressCandidatePage(page);
    ip.install();
    // The API is on a different host and wants a bearer token, so cookies alone answer 401. The
    // page's own request headers are the only place that token is observable without reaching
    // into storage the app is free to change.
    let authHeaders = null;
    page.on('request', (r) => {
      if (!authHeaders && /\/candidate\/in-progress\//.test(r.url())) {
        const h = r.headers();
        if (h.authorization) authHeaders = { authorization: h.authorization };
      }
    });
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await ip.navigate();

    if (!authHeaders) {
      line('no Authorization header was observed on the page load request');
      return;
    }
    // Ask the endpoint the same questions the page asks, with the page's own token, so this is
    // the same data the suite sees.
    const call = async (qs) =>
      page.evaluate(
        async ([u, h]) => {
          const r = await fetch(u, { headers: h });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        [`https://dev-api.talentforge.com.sa/core/api/v1/candidate/in-progress/${qs}`, authHeaders]
      );

    const all = await call('?page=1&page_size=1000&search=');
    if (all.status !== 200 || !all.body) {
      line(`could not read the population: HTTP ${all.status}`);
      return;
    }
    const rows = all.body.results || [];
    line(`\nPOPULATION  count=${all.body.count}  rowsReturned=${rows.length}`);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    line(`  by status: ${JSON.stringify(byStatus)}`);

    // ---- 1. Onboarding Incomplete duration bands ------------------------------------------
    const oi = rows.filter((r) => r.status === 'onboarding_incomplete');
    const bandTally = {};
    for (const r of oi) {
      const k = r.onboarding_days === undefined ? '<undefined>' : r.onboarding_days === null ? '<null>' : String(r.onboarding_days);
      bandTally[k] = (bandTally[k] || 0) + 1;
    }
    line(`\n=== ONBOARDING INCOMPLETE DURATION ===`);
    line(`  onboarding_incomplete rows in population: ${oi.length}`);
    line(`  onboarding_days values across them: ${JSON.stringify(bandTally, null, 1)}`);
    let bandSum = 0;
    for (const [label, param] of [['1-3 days', '1-3'], ['4-7 days', '4-7'], ['7+ days', '7+']]) {
      const res = await call(`?page=1&page_size=1&search=&onboarding_days=${encodeURIComponent(param)}`);
      bandSum += res.body ? res.body.count : 0;
      line(`  ${label.padEnd(9)} onboarding_days=${param.padEnd(4)} -> count=${res.body && res.body.count}`);
    }
    line(`  sum of the three bands = ${bandSum}  vs onboarding_incomplete population ${oi.length}  (shortfall ${oi.length - bandSum})`);
    const unbanded = oi.filter((r) => !['1-3', '4-7', '7+'].includes(String(r.onboarding_days)));
    line(`  rows in NO band: ${unbanded.length}`);
    for (const r of unbanded.slice(0, 12)) {
      line(`    ${r.email}  onboarding_days=${JSON.stringify(r.onboarding_days)}  status_detail=${JSON.stringify(r.status_detail)}`);
    }

    // ---- 2. Reminder Status states ---------------------------------------------------------
    line(`\n=== REMINDER STATUS ===`);
    const stateTally = {};
    for (const r of oi) {
      const k = r.reminder_status === undefined ? '<undefined>' : r.reminder_status === null ? '<null>' : String(r.reminder_status);
      stateTally[k] = (stateTally[k] || 0) + 1;
    }
    line(`  reminder_status values across the ${oi.length} onboarding_incomplete rows:`);
    line(`  ${JSON.stringify(stateTally, null, 1)}`);
    let stateSum = 0;
    for (const [label, param] of [['No Reminder Sent', 'none'], ['Recently Reminded', 'recent'], ['Multiple Reminders', 'multiple']]) {
      const res = await call(`?page=1&page_size=1&search=&reminder_status=${encodeURIComponent(param)}`);
      stateSum += res.body ? res.body.count : 0;
      line(`  ${label.padEnd(19)} reminder_status=${param.padEnd(9)} -> count=${res.body && res.body.count}`);
    }
    line(`  sum of the three states = ${stateSum}  vs population ${oi.length}  (overlap ${stateSum - oi.length})`);
    const both = oi.filter((r) => String(r.reminder_status || '').includes(',')).length;
    line(`  rows whose reminder_status is a COMMA LIST (in two states at once): ${both}`);

    // ---- 3. The e2e search + tab scenario ---------------------------------------------------
    line(`\n=== SEARCH + QUICK FILTER TAB ===`);
    const invite = rows.filter((r) => r.status === 'invite_sent');
    const named = rows.filter((r) => (r.name || '').trim());
    line(`  invite_sent rows: ${invite.length}, of which named: ${invite.filter((r) => (r.name || '').trim()).length}`);
    line(`  onboarding_incomplete rows: ${oi.length}, of which named: ${oi.filter((r) => (r.name || '').trim()).length}`);
    line(`  => a NAMED candidate can be invite_sent? ${invite.some((r) => (r.name || '').trim())}`);
    line(`  sample invite_sent emails: ${JSON.stringify(invite.slice(0, 3).map((r) => r.email))}`);
    line(`  sample named candidate:    ${JSON.stringify(named.slice(0, 1).map((r) => ({ name: r.name, email: r.email, status: r.status })))}`);
    // A term that matches BOTH statuses is what the scenario actually needs.
    const domainOf = (e) => String(e || '').split('@')[1] || '';
    const domains = {};
    for (const r of rows) {
      const d = domainOf(r.email);
      domains[d] = domains[d] || { invite_sent: 0, onboarding_incomplete: 0 };
      domains[d][r.status] = (domains[d][r.status] || 0) + 1;
    }
    line(`  email domains by status: ${JSON.stringify(domains, null, 1)}`);
  } catch (e) {
    line('ERR ' + e.stack);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
