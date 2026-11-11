/* eslint-disable no-console */
// probe-agent-analytics-total-agents.js - READ-ONLY. Explains the Total Agents figure: the
// dashboard's total_agents beside the Agents listing's count per status.
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
  const out = {};
  for (const d of ['', '?duration=current_month', '?duration=ytd', '?duration=yearly']) out[`dashboard total_agents ${d || '(default)'}`] = (await ap.api(`/agent/analytics/overview/${d}`)).body.total_agents;
  for (const s of ['ACTIVE', 'ATTENTION', 'INVITE_SENT', 'DEACTIVATED']) out[`listing ${s}`] = (await ap.api(`/agent/?status=${s}&page_size=1`)).body.count;
  out['listing ACTIVE+ATTENTION (the Active tab)'] = (await ap.api('/agent/?status=ACTIVE&status=ATTENTION&page_size=1')).body.count;
  out['listing all statuses'] = (await ap.api('/agent/?page_size=1')).body.count;
  console.log(out);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
