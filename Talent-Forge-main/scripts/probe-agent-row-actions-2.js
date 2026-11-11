// Every row action on every lifecycle tab of the SuperAdmin Agents listing, per ROW (not just the
// first), with its enabled state - plus what "Log in as agent" actually does.
//
//   node scripts/probe-agent-row-actions-2.js             # read-only: Log in as agent is clicked,
//                                                         # any confirmation is recorded and CANCELLED
//   node scripts/probe-agent-row-actions-2.js --confirm   # also goes through with the impersonation
//                                                         # of AGENT_EMAIL and records where it lands
//
// The impersonation target is AGENT_EMAIL only (its activity log already carries superadmin
// impersonation rows, so one more changes nothing anyone relies on).
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;
const CONFIRM = process.argv.includes('--confirm');
const TABS = ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated'];

async function rowButtons(page, listing, email) {
  const row = listing.rowLocator(email);
  return row.locator('button').evaluateAll((bs) => bs.map((b) => ({
    name: (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim(),
    disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    title: b.getAttribute('title'),
  })).filter((b) => b.name));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) writes.push(`${r.method()} ${r.url()}`); });
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    const listing = new AgentsListingPage(page);

    for (const tab of TABS) {
      await listing.runAndWaitForList(async () => { await listing.goto(tab); });
      await page.waitForTimeout(1200);
      const rows = (await listing.readRows()).filter((r) => r.email);
      line(`\n===== ${tab}: ${rows.length} rows on page 1 =====`);
      const shapes = {};
      for (const r of rows) {
        const btns = await rowButtons(page, listing, r.email);
        const key = btns.map((b) => `${b.name}${b.disabled ? '(disabled)' : ''}`).join(' | ');
        (shapes[key] = shapes[key] || []).push(r.email);
      }
      for (const [k, emails] of Object.entries(shapes)) line(`  ${emails.length} x [${k}]  e.g. ${emails[0]}`);
    }

    // ---- Log in as agent ----
    const target = process.env.AGENT_EMAIL;
    line(`\n===== Log in as agent on ${target} (confirm=${CONFIRM}) =====`);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
    await listing.search(target);
    await page.waitForTimeout(1500);
    const row = listing.rowLocator(target);
    await row.getByRole('button', { name: /open menu/i }).first().click();
    await page.waitForTimeout(800);
    const items = await page.locator('[role="menu"] [role^="menuitem"]').allInnerTexts();
    line(`  menu items: ${JSON.stringify(items)}`);
    const popupP = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    const before = page.url();
    const mark = writes.length;
    await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /log in as agent/i }).first().click();
    await page.waitForTimeout(3000);
    const popup = await popupP;
    const dialog = await page.locator('[role="dialog"]').last().isVisible().catch(() => false)
      ? await page.locator('[role="dialog"]').last().evaluate((d) => ({
        text: d.innerText.replace(/\s+/g, ' ').trim(),
        buttons: Array.from(d.querySelectorAll('button')).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()),
      }))
      : null;
    line(`  url before: ${before}`);
    line(`  url after : ${page.url()}`);
    line(`  popup     : ${popup ? popup.url() : 'none'}`);
    line(`  dialog    : ${JSON.stringify(dialog)}`);
    line(`  writes    : ${JSON.stringify(writes.slice(mark))}`);

    if (dialog && !CONFIRM) {
      const cancel = page.locator('[role="dialog"]').last().getByRole('button', { name: /cancel|close/i }).first();
      await cancel.click().catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(1500);
      line(`  cancelled -> url ${page.url()}, writes since click ${JSON.stringify(writes.slice(mark))}`);
    }
    if (dialog && CONFIRM) {
      const go = page.locator('[role="dialog"]').last().getByRole('button').filter({ hasNotText: /cancel|close/i }).last();
      line(`  confirming with "${(await go.innerText()).trim()}"`);
      const popup2P = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await go.click();
      await page.waitForTimeout(6000);
      const popup2 = await popup2P;
      const where = popup2 || page;
      if (popup2) await popup2.waitForLoadState('domcontentloaded').catch(() => {});
      await where.waitForTimeout(4000);
      line(`  landed    : ${where.url()} (popup=${!!popup2})`);
      line(`  page text : ${(await where.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700)}`);
      line(`  writes    : ${JSON.stringify(writes.slice(mark))}`);
      line(`  storage   : ${JSON.stringify(await where.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) })))}`);
      if (popup2) {
        line(`  superadmin tab still: ${page.url()}`);
      }
    }
    if (popup && !dialog) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.waitForTimeout(5000);
      line(`  popup landed: ${popup.url()}`);
      line(`  popup text  : ${(await popup.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700)}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
