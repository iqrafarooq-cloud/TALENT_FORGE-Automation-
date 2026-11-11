// Dev-only probe: READ-ONLY. Opens the Notify ("Send Reminder") dialog for every agent on the
// Requires Attention tab and prints the reminder type it offers, then CANCELS. It never clicks
// Send Reminder, so it sends no mail and changes nothing.
//
// THE QUESTION IT ANSWERS. Three of the Figma agent templates are reminders that no message in
// a 90-day inbox sweep matches - Verification Delay, Document Review Activity, and (as its own
// wording) Monthly Target Delay. Whether those are UNREACHABLE or merely UNTRIGGERED depends on
// one thing nobody has measured: does this dialog offer a FIXED type, or one derived from why
// the agent is flagged? If the type follows the flag reason, an agent flagged on verifications
// would offer the verification-delay reminder and the template is reachable. If it is hardcoded
// to "Monthly Target Delay Reminder", the other two cannot be sent from the portal at all and
// the scenarios asserting them are @known-issue against a real gap.
//
// It also prints each agent's EMAIL, because a reminder scenario can only assert the delivered
// mail for an agent whose address lands on the inbox the suite reads (iqra.farooq+<tag>@...).
// An agent on an anonaddy alias is unusable: anonaddy strips the +alias, so two agents' mail
// cannot be told apart.
//
// Usage: node scripts/probe-agent-notify-reminder-types.js [maxAgents]
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const LoginPage = require('../pages/LoginPage');

const MAX = Number(process.argv[2] || 8);
const INBOX = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
const [INBOX_LOCAL, INBOX_DOMAIN] = INBOX.split('@');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
    await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/\/(dashboard|agents|home)/, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const listing = new AgentsListingPage(page);
    await listing.goto('Requires Attention');
    await listing.settle();

    const rows = await listing.readRows();
    console.log(`Requires Attention holds ${rows.length} row(s) on page 1\n`);

    const results = [];
    for (const row of rows.slice(0, MAX)) {
      // The row text carries the email; pull it out so the reminder's deliverability is visible.
      const email = (row.text.match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0];
      const readable = email.startsWith(`${INBOX_LOCAL}+`) && email.endsWith(`@${INBOX_DOMAIN}`);
      let info = { email, readable, actions: row.actions };
      if (!row.actions.some((a) => /notify/i.test(a))) {
        info.note = 'no Notify action on this row';
        results.push(info);
        continue;
      }
      try {
        await listing.openNotifyDialog(email || row.text.slice(0, 40));
        const dialog = await listing.readNotifyDialog();
        info.heading = dialog && dialog.heading;
        info.hasMessagePreview = dialog && dialog.hasMessagePreview;
        info.body = dialog && dialog.body;
        info.buttons = dialog && dialog.buttons.map((b) => `${b.label}${b.disabled ? ' (disabled)' : ''}`);
        // Is the type a fixed label, or a control offering a choice?
        info.typeControls = await page.evaluate(() => {
          const d = Array.from(document.querySelectorAll('[role="dialog"]'))
            .find((x) => /send reminder/i.test(x.innerText || ''));
          if (!d) return null;
          return {
            selects: Array.from(d.querySelectorAll('select')).map((s) => ({
              options: Array.from(s.options).map((o) => o.text.trim()),
            })),
            radios: Array.from(d.querySelectorAll('input[type=radio]')).length,
            comboboxes: Array.from(d.querySelectorAll('[role="combobox"],[aria-haspopup="listbox"]'))
              .map((c) => (c.innerText || c.value || '').trim()),
          };
        });
        await listing.cancelNotifyDialog();
      } catch (error) {
        info.error = error.message.split('\n')[0];
        await listing.cancelDialog().catch(() => {});
      }
      results.push(info);
    }

    console.log('='.repeat(96));
    for (const r of results) {
      console.log(`\nAGENT: ${r.email || '(email not found in row)'}   mail readable by the suite: ${r.readable ? 'YES' : 'NO'}`);
      if (r.note) { console.log(`  ${r.note}`); continue; }
      if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
      console.log(`  heading         : ${r.heading}`);
      console.log(`  message preview : ${r.hasMessagePreview}`);
      console.log(`  buttons         : ${JSON.stringify(r.buttons)}`);
      console.log(`  type controls   : ${JSON.stringify(r.typeControls)}`);
      console.log(`  body            : ${r.body}`);
    }
    console.log('\n' + '='.repeat(96));
    const bodies = results.filter((r) => r.body).map((r) => r.body);
    const distinct = [...new Set(bodies.map((b) => (b.match(/reminder type[:\s]*([^\n]*)/i) || [, ''])[1] || b))];
    console.log(`VERDICT: ${bodies.length} dialog(s) read; ${distinct.length} distinct reminder wording(s).`);
    console.log(distinct.length <= 1
      ? '  -> the type looks FIXED, so the other reminder templates cannot be sent from this dialog.'
      : '  -> the type VARIES by agent, so it likely follows the flag reason.');
    const readableCount = results.filter((r) => r.readable && r.body).length;
    console.log(`  ${readableCount} of them are on an address the suite can read mail for.`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
