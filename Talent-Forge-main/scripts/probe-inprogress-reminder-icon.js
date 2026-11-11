// Is the reminder-history icon DISABLED on a candidate the app classifies "No Reminder Sent"?
//
// The user's claim: that disabled icon IS the app's visible marker of the no-reminder state, and
// an enabled icon on such a row is the contradiction worth asserting. Nothing else on the row
// renders anything about reminders, so this is the only DOM surface the Reminder Status filter
// can be checked against. Read-only - opens no panel, sends no reminder.
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
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });

    for (const option of ['No Reminder Sent', 'Recently Reminded (Last 48 hours)', 'Multiple Reminders']) {
      await ip.navigate();
      await ip.openFilters();
      await ip.selectFilterOption('Reminder Status', option);
      await ip.applyFilters();
      const api = ip.lastRows();
      const rendered = await ip.readRows();
      line(`\n===== "${option}"  submitted=${JSON.stringify(ip.lastRequestParams().reminder_status)} count=${ip.lastCount()} rendered=${rendered.length} =====`);
      if (!rendered.length) {
        line(`  empty state: ${await ip.emptyStateKind()}`);
        continue;
      }
      const dump = await page.$$eval('[role="row"]:has([role="rowheader"])', (rows) =>
        rows.map((r) => {
          const rh = r.querySelector('[role="rowheader"]');
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const email = [...(rh ? rh.querySelectorAll('p') : [])]
            .map((p) => (p.textContent || '').trim())
            .find((t) => emailRe.test(t)) || '';
          const btn =
            r.querySelector('[data-testid="agent-candidates-reminder-history-button"]') ||
            r.querySelector('button[aria-label="Reminder History"]');
          if (!btn) return { email, button: null };
          const cs = getComputedStyle(btn);
          return {
            email,
            outerHTML: btn.outerHTML.slice(0, 400),
            disabledProp: btn.disabled === true,
            disabledAttr: btn.hasAttribute('disabled'),
            ariaDisabled: btn.getAttribute('aria-disabled'),
            className: btn.className,
            opacity: cs.opacity,
            pointerEvents: cs.pointerEvents,
            cursor: cs.cursor,
            svgClass: btn.querySelector('svg') ? btn.querySelector('svg').getAttribute('class') : null,
          };
        })
      );
      for (const d of dump) {
        const row = api.find((a) => (a.email || '').toLowerCase() === (d.email || '').toLowerCase()) || {};
        line(
          `  ${d.email}\n     api: reminder_status=${row.reminder_status} has_reminders=${row.has_reminders}` +
            `\n     btn: disabledProp=${d.disabledProp} disabledAttr=${d.disabledAttr} aria-disabled=${d.ariaDisabled}` +
            ` opacity=${d.opacity} pointerEvents=${d.pointerEvents} cursor=${d.cursor}` +
            `\n     class=${JSON.stringify(d.className)}\n     html=${JSON.stringify(d.outerHTML)}`
        );
      }
    }
  } catch (e) {
    line('ERR ' + e.stack);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
