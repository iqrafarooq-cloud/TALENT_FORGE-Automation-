// Read-only probe: what does the Active tab's Actions column contain, on EVERY
// quick-filter tab, and is the reminder-history control disabled when no
// reminder has been sent? Opens no modal and sends no reminder.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ActiveCandidatePage = require('../pages/ActiveCandidatePage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });

  const ac = new ActiveCandidatePage(page);
  await ac.navigate();
  await page.waitForTimeout(3000);

  // Is there an Actions column header at all?
  const headers = await page.$$eval('[role="columnheader"]', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
  );
  console.log('COLUMN HEADERS:', JSON.stringify(headers));

  for (const tab of ['All', 'Subscribed', 'Payment Due', 'Not Subscribed']) {
    await ac.clickQuickFilter(tab);
    await page.waitForTimeout(2500);
    const rows = await ac.rowCount();

    // Every control in the LAST gridcell of each row = the Actions cell.
    const actions = await page.$$eval('[role="row"]:has([role="rowheader"])', (rs) =>
      rs.slice(0, 4).map((r) => {
        const cells = r.querySelectorAll('[role="gridcell"]');
        const last = cells[cells.length - 1];
        if (!last) return null;
        return [...last.querySelectorAll('button, [role="button"], a, svg')]
          .filter((el) => el.tagName.toLowerCase() !== 'svg' || !el.closest('button'))
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            aria: el.getAttribute('aria-label'),
            testid: el.getAttribute('data-testid'),
            disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
            title: el.getAttribute('title'),
            cls: (el.getAttribute('class') || '').slice(0, 60),
          }));
      })
    );
    console.log(`\n== TAB "${tab}"  url=${decodeURIComponent(page.url())}  rows=${rows}`);
    console.log(JSON.stringify(actions, null, 1));
  }

  await browser.close();
})();
