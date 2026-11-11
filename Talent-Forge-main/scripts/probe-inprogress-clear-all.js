// What does Clear All really do to the filter modal, and what is left on screen afterwards?
//
// `When I clear all filters` times out. Three candidate causes are indistinguishable from the
// error - Clear All never fires a request so `waitForResults()` waits forever, the modal closes
// itself so `cancelFilters()` waits for a Cancel that is gone, or the modal stays open and Cancel
// is not where the page object looks. This dumps each stage separately so the answer is read
// rather than guessed. Read-only: applies a filter, clears it, changes no account state.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const line = console.log;

const dumpFooter = async (page) =>
  page
    .locator('[role="dialog"]')
    .first()
    .evaluate((d) => ({
      buttons: [...d.querySelectorAll('button')].map((b) => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
        testId: b.getAttribute('data-testid'),
        ariaLabel: b.getAttribute('aria-label'),
        disabled: b.disabled === true,
        visible: !!(b.offsetWidth || b.offsetHeight),
      })),
    }))
    .catch((e) => ({ error: String(e.message || e) }));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => {
    if (/in-progress/.test(r.url())) requests.push(`${new Date().toISOString().slice(11, 23)}  ${r.url()}`);
  });
  try {
    const ip = new InProgressCandidatePage(page);
    ip.install();
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await ip.navigate();

    await page.waitForTimeout(3000);
    const baseline = ip.lastCount();
    line(`\nUNFILTERED baseline count=${baseline}  rows=${await ip.rowCount()}`);

    await ip.openFilters();
    await ip.selectFilterOption('Status', 'Invite Sent');
    await ip.applyFilters();
    line(`\nafter Apply    url=${page.url()}  modalOpen=${await ip.isFilterModalOpen()}  count=${ip.lastCount()}`);

    await ip.openFilters();
    line(`\nmodal reopened, footer BEFORE Clear All:`);
    line(JSON.stringify(await dumpFooter(page), null, 1));

    const before = requests.length;
    await ip.clearAllButton.click();
    line(`\nclicked Clear All`);
    for (const ms of [500, 1000, 2000, 4000]) {
      await page.waitForTimeout(ms === 500 ? 500 : ms / 2);
      line(
        `  +${ms}ms  url=${page.url()}\n           modalOpen=${await ip.isFilterModalOpen()}` +
          `  newRequests=${requests.length - before}  count=${ip.lastCount()}`
      );
    }
    line(`\nfooter AFTER Clear All:`);
    line(JSON.stringify(await dumpFooter(page), null, 1));
    line(`\nrequests seen:\n${requests.join('\n')}`);
    line(`\nactive quick filter (modal still up): ${await ip.activeQuickFilter()}`);

    // Does APPLY commit the cleared state?
    line('\n--- clicking Apply Filters after Clear All ---');
    const beforeApply = requests.length;
    await ip.applyFiltersButton.click();
    await page.waitForTimeout(4000);
    line(`  modalOpen=${await ip.isFilterModalOpen()}  newRequests=${requests.length - beforeApply}`);
    line(`  lastRequestParams=${JSON.stringify(ip.lastRequestParams())}  count=${ip.lastCount()}  rows=${await ip.rowCount()}`);
    line(`  activeQuickFilter=${await ip.activeQuickFilter()}  filtersBadge=${await ip.appliedFilterCount()}`);

    // Then close it the way a user would, and re-read.
    if (await ip.isFilterModalOpen()) {
      await ip.closeFilterModal('X icon').catch(async (e) => {
        line(`  X icon failed: ${e.message}`);
        await ip.closeFilterModal('Escape').catch((e2) => line(`  Escape failed: ${e2.message}`));
      });
    }
    await page.waitForTimeout(1500);
    line(`\nafter closing  url=${page.url()}  modalOpen=${await ip.isFilterModalOpen()}`);
    line(`  active quick filter: ${await ip.activeQuickFilter()}`);
    line(`  rows=${await ip.rowCount()}  count=${ip.lastCount()}  filtersBadge=${await ip.appliedFilterCount()}`);
    line(`  baseline was ${baseline} -> restored? ${ip.lastCount() === baseline}`);
    const statuses = [...new Set((await ip.readRows()).map((r) => r.status))];
    line(`  distinct statuses still listed: ${JSON.stringify(statuses)}`);

    // Is the stale list only client-side? A reload asks the server the same question afresh.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    line(`\nafter reload  count=${ip.lastCount()}  rows=${await ip.rowCount()}  params=${JSON.stringify(ip.lastRequestParams())}`);
  } catch (e) {
    line('ERR ' + e.stack);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
