// The Notify (Requires Attention) and Resend Invite (Invite Sent) row dialogs: their contract and
// every way out. Read-only unless --resend, which confirms ONE resend on an abandoned "+invsent"
// throwaway and then reads the row's actions during the cooldown.
//   node scripts/probe-agent-row-dialogs.js [--resend]
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('response', async (r) => {
    if (r.request().method() !== 'GET' && /\/api\//.test(r.url())) {
      let b = ''; try { b = (await r.text()).slice(0, 200); } catch (e) { /* */ }
      net.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname} -> ${b}`);
    }
  });
  const top = () => page.locator('[role="dialog"]').last();
  const dump = async () => (await top().isVisible().catch(() => false)) ? top().evaluate((d) => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return { text: c(d.innerText), buttons: Array.from(d.querySelectorAll('button')).map((b) => `${c(b.innerText) || b.getAttribute('aria-label')}${b.disabled ? '(disabled)' : ''}`) };
  }) : null;
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    const listing = new AgentsListingPage(page);

    for (const [tab, action] of [['Requires Attention', 'Notify'], ['Invite Sent', 'Resend Invite']]) {
      await listing.runAndWaitForList(async () => { await listing.goto(tab); });
      await page.waitForTimeout(1200);
      const rows = (await listing.readRows()).filter((r) => /\+(edmail|editagent|invsent)/.test(r.email || ''));
      const email = rows[0].email;
      line(`\n===== ${tab} > ${action} on ${email} =====`);
      for (const how of ['Cancel', 'X', 'Escape', 'outside']) {
        await listing.rowLocator(email).getByRole('button', { name: action, exact: true }).first().click();
        await page.waitForTimeout(900);
        if (how === 'Cancel') line(`  contract: ${JSON.stringify(await dump())}`);
        const mark = net.length;
        if (how === 'Cancel') await top().getByRole('button', { name: /^cancel$/i }).last().click();
        else if (how === 'X') await top().getByRole('button', { name: /^(close|cancel)$/i }).first().click();
        else if (how === 'Escape') await page.keyboard.press('Escape');
        else await page.mouse.click(5, 5);
        await page.waitForTimeout(1200);
        const open = await top().isVisible().catch(() => false);
        line(`  leave via ${how}: closed=${!open} writes=${JSON.stringify(net.slice(mark))}`);
        if (open) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
      }
      if (tab === 'Invite Sent' && process.argv.includes('--resend')) {
        await listing.rowLocator(email).getByRole('button', { name: action, exact: true }).first().click();
        await page.waitForTimeout(900);
        const mark = net.length;
        await top().getByRole('button', { name: /^resend invite$/i }).click();
        await page.waitForTimeout(4000);
        line(`  RESEND confirmed: writes=${JSON.stringify(net.slice(mark))}`);
        line(`  toasts: ${JSON.stringify(await page.locator('.Toastify__toast, [role="status"], [role="alert"]').allInnerTexts())}`);
        await listing.runAndWaitForList(async () => { await listing.goto('Invite Sent'); });
        await listing.search(email); await page.waitForTimeout(1500);
        const btns = await listing.rowLocator(email).locator('button').evaluateAll((bs) => bs.map((b) => `${(b.getAttribute('aria-label') || b.innerText || '').trim()}${b.disabled ? '(disabled)' : ''}`));
        line(`  row right after: ${JSON.stringify(btns)}`);
        const resendBtn = listing.rowLocator(email).getByRole('button', { name: 'Resend Invite', exact: true }).first();
        if (!(await resendBtn.isDisabled())) {
          const m2 = net.length;
          await resendBtn.click(); await page.waitForTimeout(900);
          line(`  second resend dialog: ${JSON.stringify(await dump())}`);
          await top().getByRole('button', { name: /^resend invite$/i }).click().catch(() => {});
          await page.waitForTimeout(3000);
          line(`  second resend: writes=${JSON.stringify(net.slice(m2))}`);
          line(`  toasts: ${JSON.stringify(await page.locator('.Toastify__toast, [role="status"], [role="alert"]').allInnerTexts())}`);
        }
        const hover = await listing.rowLocator(email).getByRole('button', { name: 'Resend Invite', exact: true }).first()
          .evaluate((b) => ({ title: b.title, describedby: b.getAttribute('aria-describedby') }));
        line(`  disabled-resend hint attrs: ${JSON.stringify(hover)}`);
      }
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
