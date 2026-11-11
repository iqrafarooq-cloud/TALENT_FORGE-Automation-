/* eslint-disable no-console */
// probe-agent-analytics-default-period.js - READ-ONLY. The default Agents Analytics load sends no
// duration at all. This asks the server for the same widgets with no duration and with each
// duration, and prints which one the no-duration answer matches.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentAnalyticsPage = require('../pages/AgentAnalyticsPage');

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  const ap = new AgentAnalyticsPage(page); ap.install();
  await page.goto(process.env.BASE_URL);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await page.waitForTimeout(6000);
  for (const key of ['overview', 'revenue', 'documents/trend']) {
    const none = JSON.stringify((await ap.api(`/agent/analytics/${key}/`)).body);
    const out = { key };
    for (const d of ['current_month', 'last_quarter', 'yearly', 'ytd']) out[d] = JSON.stringify((await ap.api(`/agent/analytics/${key}/?duration=${d}`)).body) === none;
    console.log(out, none.slice(0, 160));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
