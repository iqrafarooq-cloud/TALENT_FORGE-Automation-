// Read-only. Re-measures the three things that moved after 2026-09-22: the tab labels, the
// Filters modal's groups, and whether a Revision Required document still withholds the decision
// controls (and whether that depends on WHO set it). Opens dialogs and closes them; never decides.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const AgentVerificationsPage = require('../pages/AgentVerificationsPage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const v = new AgentVerificationsPage(page);
  if (v.install) await v.install();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/dashboard|candidates/, { timeout: 90000 });

  const listReqs = [];
  page.on('request', (r) => { if (/candidate\/documents\/all/.test(r.url())) listReqs.push(r.url()); });

  await v.openWith({});
  console.log('TABS', JSON.stringify(await v.readTabs()));

  await v.openFilters();
  const html = await v.filterDialog.evaluate((d) => d.innerText);
  console.log('FILTER TEXT\n' + html);
  console.log('OPTIONS', JSON.stringify(await v.readFilterOptions()));
  // Status filter: url + api param
  const before = listReqs.length;
  await v.selectFilterOption('Approved');
  await v.applyFilters();
  console.log('URL after Status=Approved', page.url());
  console.log('API', listReqs.slice(before).join('\n'));
  const rows = await v.readRows();
  console.log('rows statuses', JSON.stringify(rows.map((r) => r.status)));

  for (const status of ['REVISION', 'AWAITING']) {
    await v.openWith({ activeFilter: status });
    const rs = await v.readRows();
    console.log(`\n== ${status}: ${rs.length} rows`);
    for (let i = 0; i < Math.min(4, rs.length); i++) {
      await v.openRow(i);
      const offered = await v.decisionControlsOffered();
      const panel = await v.readPanel();
      console.log(i, rs[i].name, '| panel status', panel.status, '| offered', JSON.stringify(offered),
        '| comments', JSON.stringify((panel.commentHistory || []).map((c) => c.source || c.author || c)).slice(0, 200));
      await v.closePanel();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
