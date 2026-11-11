// Read-only probe for the Agent Portal dashboard (/dashboard). Writes NOTHING: it signs in as
// AGENT_EMAIL, reads every widget beside the payload the app fetched for it, walks the four
// periods, opens the review panel and closes it, and stubs the list/stats endpoints in its own page
// to capture the empty and failed renders. No decision is committed and no invite is sent.
//
//   node scripts/probe-agent-dashboard.js            # everything
//   node scripts/probe-agent-dashboard.js --no-stubs # skip the empty/failed renders
//
// It drives the REAL DashboardPage rather than its own copy of the readers, so the probe and the
// suite cannot disagree about what the page says.
require('dotenv').config();
const { chromium } = require('playwright');
const DashboardPage = require('../pages/DashboardPage');
const LoginPage = require('../pages/LoginPage');

const noStubs = process.argv.includes('--no-stubs');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const d = new DashboardPage(page);
  d.install();
  const out = {};
  try {
    const login = new LoginPage(page);
    await page.goto(process.env.BASE_URL);
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/\/dashboard/, { timeout: 90000 });

    out.loaded = Object.fromEntries(Object.entries(await d.openDashboard()).map(([k, v]) => [k, v && v.url]));
    out.documentStatus = d.lastDocumentStatus;
    await page.keyboard.press('Escape');
    out.kpis = await d.readKpis();
    out.stats = await d.latestBody('stats');
    out.periodOptions = await d.readPeriodOptions();
    out.periods = [];
    for (const { label } of DashboardPage.PERIODS) {
      const { response } = await d.choosePeriod(label);
      const k = await d.readKpis();
      out.periods.push({ label, url: response && response.url, body: response && response.body, target: k.target, tiles: k.tiles });
    }
    out.tooltip = await d.hoverTargetInfo();
    for (const title of Object.keys(DashboardPage.EMPTY_STATES)) {
      out[title] = { count: await d.cardCount(title), viewAll: await d.cardHasViewAll(title) };
    }
    out.queue = await d.readQueueRows();
    out.attention = await d.readAttentionRows();
    out.activeColumns = await d.readActiveColumns();
    out.active = await d.readActiveRows();
    out.sections = await d.sectionOrder();
    out.overflow = await d.horizontalOverflow();

    if (!noStubs) {
      for (const [name, handler] of Object.entries({
        empty: (r) => r.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }),
        failed: (r) => r.fulfill({ status: 500, json: { detail: 'probe' } }),
      })) {
        await page.route(/\/candidate\/(documents\/all|requires-attention|active)\//, handler);
        await d.openDashboard().catch(() => {});
        await page.keyboard.press('Escape');
        out[`cards_${name}`] = {};
        for (const title of Object.keys(DashboardPage.EMPTY_STATES)) out[`cards_${name}`][title] = await d.readEmptyState(title);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    }
  } finally {
    console.log(JSON.stringify(out, (k, v) => (k === 'file' ? '(presigned url redacted)' : v), 2));
    await browser.close();
  }
})();
