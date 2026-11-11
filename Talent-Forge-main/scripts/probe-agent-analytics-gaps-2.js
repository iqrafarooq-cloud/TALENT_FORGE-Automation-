/* eslint-disable no-console */
// probe-agent-analytics-gaps-2.js - READ-ONLY follow-up to probe-agent-analytics-gaps.js:
// what the widgets are asked for after a university is UNCHECKED, Avg. Candidates per Agent
// per duration against the active-candidate count, arrow-key choice of a duration, and what the
// unlabelled button in Verification Backlog Alerts is.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentAnalyticsPage = require('../pages/AgentAnalyticsPage');
const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const ap = new AgentAnalyticsPage(page); ap.install();
  const reqs = []; page.on('request', (r) => { if (/agent\/analytics\/overview/.test(r.url())) reqs.push(r.url()); });
  await page.goto(BASE); await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await ap.open('?duration=Year-to-Date');
  console.log('--- uncheck');
  await ap.openUniversity(); const o = ap.universityOptions.first();
  await o.click(); await page.waitForTimeout(3000); let at = reqs.length;
  await o.click(); await page.waitForTimeout(4000);
  console.log('after uncheck url', page.url(), 'overview reqs', reqs.slice(at), 'checked', await o.getAttribute('aria-checked'), await o.innerHTML().then((h) => /check/i.test(h)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
  console.log('after closing url', page.url(), 'totalAgents', (await ap.readOverview()).totalAgents);
  at = reqs.length; await page.reload(); await page.waitForTimeout(7000);
  console.log('after reload reqs', reqs.slice(at), 'trigger', await ap.triggerText('university'));
  console.log('--- avg candidates');
  const act = (await ap.api('/candidate/?page=1&page_size=1&is_active=true')).body.count;
  for (const d of ['current_month', 'last_quarter', 'yearly', 'ytd']) {
    const r = (await ap.api(`/agent/analytics/overview/?duration=${d}`)).body;
    console.log(d, 'agents', r.total_agents, 'avg', r.avg_candidates_per_agent, 'active candidates', act, 'expected', (act / r.total_agents).toFixed(2));
  }
  console.log('--- duration arrows');
  await ap.open('?duration=Year-to-Date');
  await ap.durationTrigger.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 2; i += 1) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); }
  const act2 = await page.evaluate(() => ({ el: document.activeElement.outerHTML.slice(0, 200), ad: document.activeElement.getAttribute('aria-activedescendant') }));
  console.log('after 2x ArrowDown', act2);
  await page.keyboard.press('Enter'); await page.waitForTimeout(3000); console.log('url', page.url());
  console.log('--- backlog buttons');
  console.log(await ap.card('backlog').locator('button').evaluateAll((b) => b.map((e) => e.outerHTML.slice(0, 300))));
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  console.log('tooltip', await page.locator('[role="tooltip"]').allInnerTexts());
  console.log('attention help', await ap.card('attention').locator('button').evaluateAll((b) => b.map((e) => `${e.getAttribute('aria-label')} "${e.innerText}"`)));
  console.log('all unnamed buttons on page', await page.locator('main button').evaluateAll((b) => b.filter((e) => !(e.innerText || '').trim() && !e.getAttribute('aria-label')).map((e) => e.closest('section')?.className.slice(0, 60))));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
