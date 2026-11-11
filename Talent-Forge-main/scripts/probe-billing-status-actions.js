// probe-billing-status-actions.js — Billing History receipt actions by payment status.
// Dumps every row's status label + the exact DOM of its View/Download controls, then
// exercises the SubscriptionPage.rowsWithStatus / receiptActionsIn helpers so their
// locators are proven against the live grid. Dev-only.
//
//   node scripts/probe-billing-status-actions.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  // Capture the raw payments payload so the API status enum can be compared with the label.
  const apiRows = [];
  page.on('response', async (res) => {
    if (!/\/payments\/\?|\/payments\/$/.test(res.url()) || !res.ok()) return;
    try {
      const j = await res.json();
      for (const r of j.results || []) {
        apiRows.push({ status: r.status, amount: r.amount, receipt: r.receipt_document ? 'yes' : 'null' });
      }
    } catch { /* not json */ }
  });

  try {
    const l = new LoginPage(page);
    await l.navigate();
    await l.emailInput.first().fill(EMAIL);
    await l.passwordInput.first().fill(PASSWORD);
    await l.submitButton.first().click();
    await page.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, {
      timeout: 90000,
      waitUntil: 'commit',
    });

    const sub = new SubscriptionPage(page);
    await sub.gotoSubscriptionTab();
    await sub.billingGrid.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(2000);

    const n = await sub.billingRows.count();
    console.log(`\n=== ${n} billing row(s) — raw DOM ===\n`);

    for (let i = 0; i < n; i++) {
      const row = sub.billingRows.nth(i);
      const cells = await row.locator('[role="gridcell"], [role="rowheader"]').allInnerTexts();
      console.log(`--- row ${i} | cells: ${JSON.stringify(cells.map((c) => c.replace(/\s+/g, ' ').trim()))}`);

      const actions = row.locator('button, a, [role="button"]');
      const m = await actions.count();
      if (!m) console.log('    (no button/a/[role=button] found in this row)');
      for (let j = 0; j < m; j++) {
        const info = await actions.nth(j).evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute('aria-label'),
            disabledAttr: el.hasAttribute('disabled'),
            ariaDisabled: el.getAttribute('aria-disabled'),
            href: (el.getAttribute('href') || '').slice(0, 50),
            pointerEvents: cs.pointerEvents,
            opacity: cs.opacity,
          };
        });
        const enabled = await actions.nth(j).isEnabled().catch(() => 'err');
        console.log(`    [${j}] ${JSON.stringify(info)} playwrightIsEnabled=${enabled}`);
      }
    }

    // ---- Exercise the POM helpers the step definitions rely on ----
    console.log(`\n=== POM helper check: rowsWithStatus() + receiptActionsIn() ===`);
    for (const status of ['Paid', 'Pending', 'Canceled', 'Cancelled', 'Payment Failed']) {
      const rows = sub.rowsWithStatus(status);
      const count = await rows.count();
      let detail = '';
      if (count) {
        const a = sub.receiptActionsIn(rows.first());
        const vCount = await a.View.count();
        const dCount = await a.Download.count();
        const vEnabled = vCount ? await a.View.isEnabled() : 'n/a';
        const dEnabled = dCount ? await a.Download.isEnabled() : 'n/a';
        const dHref = dCount ? (await a.Download.getAttribute('href')) : null;
        detail = ` | first row: View(found=${vCount},enabled=${vEnabled}) Download(found=${dCount},enabled=${dEnabled},href=${dHref ? 'yes' : 'none'})`;
      }
      console.log(`  rowsWithStatus("${status}") -> ${count} row(s)${detail}`);
    }

    console.log(`\n=== API /payments/ statuses ===`);
    console.log(apiRows.length ? JSON.stringify(apiRows.map((r) => r.status)) : '(none captured)');
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
