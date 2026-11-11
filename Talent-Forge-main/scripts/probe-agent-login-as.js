// "Log in as agent" (Active tab > Open menu) end to end: the "Verify your identity" dialog, its
// gating, its ways out, ONE wrong password, and - only with --confirm - the real impersonation.
//
//   node scripts/probe-agent-login-as.js [agent-email] [--confirm] [--wrong]
//
// Default target is an ABANDONED throwaway agent (an Active "+edmail"/"+editagent" one), never a
// fixture. --wrong submits ONE wrong superadmin password (sign-in failures are rate limited per
// account, so never loop this).
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;
const CONFIRM = process.argv.includes('--confirm');
const WRONG = process.argv.includes('--wrong');
const argEmail = process.argv.slice(2).find((a) => a.includes('@'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('response', async (r) => {
    const q = r.request();
    if (q.method() !== 'GET' && /\/api\//.test(r.url())) {
      let body = ''; try { body = (await r.text()).slice(0, 300); } catch (e) { /* */ }
      net.push(`${q.method()} ${r.status()} ${new URL(r.url()).pathname} ${(q.postData() || '').replace(/"password":"[^"]*"/, '"password":"***"').slice(0, 120)} -> ${body}`);
    }
  });
  const dlg = () => page.locator('[role="dialog"]').filter({ hasText: /verify your identity/i }).first();
  const state = async () => (await dlg().isVisible().catch(() => false)) ? dlg().evaluate((d) => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const pw = d.querySelector('input');
    const confirm = Array.from(d.querySelectorAll('button')).find((b) => /^confirm$/i.test(c(b.innerText)));
    return {
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      lines: Array.from(d.querySelectorAll('p,label,span')).filter((e) => !e.children.length && c(e.innerText)).map((e) => c(e.innerText)),
      input: pw && { type: pw.type, placeholder: pw.placeholder, value: pw.value, autocomplete: pw.autocomplete, required: pw.required },
      confirmDisabled: confirm ? confirm.disabled : null,
      buttons: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || b.getAttribute('aria-label')),
      errors: Array.from(d.querySelectorAll('p,span,div')).filter((e) => !e.children.length && c(e.innerText) && !e.closest('button')
        && /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color)).map((e) => c(e.innerText)),
    };
  }) : null;

  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    const listing = new AgentsListingPage(page);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
    await page.waitForTimeout(1200);
    let target = argEmail;
    if (!target) {
      const rows = (await listing.readRows()).filter((r) => /\+(edmail|editagent)/.test(r.email || ''));
      target = rows[0] && rows[0].email;
    }
    line(`target: ${target}`);
    await listing.search(target);
    await page.waitForTimeout(1500);

    const open = async () => {
      await listing.rowLocator(target).getByRole('button', { name: /open menu/i }).first().click();
      await page.waitForTimeout(600);
      await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /log in as agent/i }).first().click();
      await dlg().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
    };
    const pw = () => dlg().locator('input').first();

    await open();
    line(`\nON OPEN: ${JSON.stringify(await state(), null, 1)}`);
    line(`focused: ${await page.evaluate(() => document.activeElement && (document.activeElement.tagName + ' ' + (document.activeElement.type || '')))}`);
    for (const v of ['   ', 'x']) {
      await pw().fill(''); await pw().pressSequentially(v); await page.waitForTimeout(400);
      const s = await state(); line(`typed ${JSON.stringify(v)} -> confirmDisabled=${s.confirmDisabled} errors=${JSON.stringify(s.errors)}`);
    }
    await pw().fill(''); await pw().pressSequentially('abc'); await pw().press('Tab'); await pw().fill(''); await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    line(`cleared+blurred -> ${JSON.stringify(await state())}`);
    // show/hide
    await pw().fill('peekaboo');
    const toggle = dlg().getByRole('button', { name: /show password|hide password/i }).first();
    line(`toggle label before: ${await toggle.getAttribute('aria-label')} type=${await pw().getAttribute('type')}`);
    await toggle.click(); await page.waitForTimeout(300);
    line(`toggle label after : ${await toggle.getAttribute('aria-label')} type=${await pw().getAttribute('type')}`);

    // ways out
    for (const how of ['Cancel', 'X', 'Escape', 'outside']) {
      if (!(await dlg().isVisible().catch(() => false))) await open();
      await pw().fill('typed-before-leaving');
      const mark = net.length;
      if (how === 'Cancel') await dlg().getByRole('button', { name: /^cancel$/i }).last().click();
      else if (how === 'X') await dlg().getByRole('button', { name: /^(close|cancel)$/i }).first().click();
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.mouse.click(5, 5);
      await page.waitForTimeout(1200);
      const vis = await dlg().isVisible().catch(() => false);
      line(`leave via ${how}: closed=${!vis} url=${page.url()} writes=${JSON.stringify(net.slice(mark))}`);
      if (vis) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
      if (!(await dlg().isVisible().catch(() => false))) {
        await open();
        line(`  reopened, password field holds: ${JSON.stringify(await pw().inputValue())}`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      }
    }
    line(`X candidates: ${JSON.stringify(await (async () => { await open(); const s = await state(); return s.buttons; })())}`);

    if (WRONG) {
      const mark = net.length;
      await pw().fill('Definitely-Wrong-Pass-1!');
      await dlg().getByRole('button', { name: /^confirm$/i }).click();
      await page.waitForTimeout(3000);
      line(`\nWRONG PASSWORD: dialog=${JSON.stringify(await state())} url=${page.url()}`);
      line(`  toasts: ${JSON.stringify(await page.locator('.Toastify__toast, [role="alert"], [role="status"]').allInnerTexts())}`);
      line(`  net: ${JSON.stringify(net.slice(mark), null, 1)}`);
    }

    if (CONFIRM) {
      if (!(await dlg().isVisible().catch(() => false))) await open();
      const mark = net.length;
      const popupP = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await pw().fill(process.env.SUPERADMIN_PASSWORD);
      await dlg().getByRole('button', { name: /^confirm$/i }).click();
      const popup = await popupP;
      const where = popup || page;
      await where.waitForLoadState('domcontentloaded').catch(() => {});
      await where.waitForTimeout(7000);
      line(`\nCONFIRMED: popup=${!!popup} landed=${where.url()}`);
      line(`  superadmin tab: ${page.url()}`);
      line(`  net: ${JSON.stringify(net.slice(mark), null, 1)}`);
      line(`  text: ${(await where.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 900)}`);
      // ---- step 2: Reason for access ----
      const step = () => page.locator('[role="dialog"]').last();
      const dump = async (tag) => {
        const d = await step().evaluate((el) => {
          const c = (x) => String(x || '').replace(/\s+/g, ' ').trim();
          return {
            heading: c((el.querySelector('h1,h2,h3') || {}).innerText),
            text: c(el.innerText),
            selects: Array.from(el.querySelectorAll('select')).map((x) => ({ name: x.name, value: x.value, options: Array.from(x.options).map((o) => o.text) })),
            inputs: Array.from(el.querySelectorAll('input:not([type=hidden]),textarea')).map((x) => ({ tag: x.tagName, type: x.type, ph: x.placeholder, max: x.maxLength, value: x.value })),
            buttons: Array.from(el.querySelectorAll('button')).map((b) => `${c(b.innerText) || b.getAttribute('aria-label')}${b.disabled ? '(disabled)' : ''}`),
            errors: Array.from(el.querySelectorAll('p,span,div')).filter((e) => !e.children.length && c(e.innerText) && !e.closest('button')
              && /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color)).map((e) => c(e.innerText)),
          };
        }).catch((e) => ({ err: e.message }));
        line(`  [${tag}] ${JSON.stringify(d)}`);
        return d;
      };
      await dump('reason on open');
      const trigger = step().getByRole('button', { name: /select a reason|reason/i }).first();
      const pick = async (label) => {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(500);
        const opt = page.getByRole('option', { name: label, exact: true }).first();
        if (await opt.count()) await opt.click();
        else await step().locator('select').first().selectOption({ label }).catch((e) => line('  select failed ' + e.message));
        await page.waitForTimeout(600);
      };
      await pick('Other');
      await dump('reason = Other');
      const other = step().locator('textarea, input[type="text"]').first();
      if (await other.count()) {
        await other.fill('   '); await other.press('Tab'); await page.waitForTimeout(400); await dump('Other = spaces');
        await other.fill('a'.repeat(600)); await page.waitForTimeout(400);
        line(`  Other field holds ${(await other.inputValue()).length} chars`);
      }
      await pick('Troubleshooting an issue');
      await dump('reason = Troubleshooting');
      if (process.argv.includes('--through')) {
        const mark2 = net.length;
        const popup3P = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
        await step().getByRole('button', { name: /^next$/i }).click();
        await page.waitForTimeout(2500);
        await dump('after Next');
        line(`  net after Next: ${JSON.stringify(net.slice(mark2), null, 1)}`);
        if (process.argv.includes('--back')) {
          await step().getByRole('button', { name: /^back$/i }).click();
          await page.waitForTimeout(800);
          await dump('after Back');
          await step().getByRole('button', { name: /^next$/i }).click();
          await page.waitForTimeout(800);
          await dump('Next again');
        }
        // if there is a further confirm step, go through it
        const go = step().getByRole('button', { name: /^(start|confirm|log in|continue|proceed|access|start session)/i }).last();
        if (await go.isVisible().catch(() => false)) {
          line(`  pressing "${(await go.innerText()).trim()}"`);
          await go.click();
        }
        const popup3 = await popup3P;
        const w = popup3 || page;
        await w.waitForLoadState('domcontentloaded').catch(() => {});
        await w.waitForTimeout(8000);
        line(`  IMPERSONATION landed: popup=${!!popup3} url=${w.url()}`);
        line(`  net: ${JSON.stringify(net.slice(mark2), null, 1)}`);
        line(`  text: ${(await w.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1200)}`);
        if (process.argv.includes('--end')) {
          const markE = net.length;
          await w.keyboard.press('Escape'); await w.waitForTimeout(800);
          await w.getByRole('button', { name: /^end session$/i }).click();
          await w.waitForTimeout(1500);
          const d = await w.locator('[role="dialog"]').last().isVisible().catch(() => false)
            ? (await w.locator('[role="dialog"]').last().innerText()).replace(/\s+/g, ' ') : null;
          line(`  END SESSION dialog: ${JSON.stringify(d)}`);
          if (d) {
            const btns = await w.locator('[role="dialog"]').last().locator('button').allInnerTexts();
            line(`  its buttons: ${JSON.stringify(btns)}`);
            await w.locator('[role="dialog"]').last().getByRole('button', { name: /back to agent profile|end session|confirm|yes/i }).last().click();
          }
          await w.waitForTimeout(6000);
          line(`  after End Session: url=${w.url()}`);
          line(`  net: ${JSON.stringify(net.slice(markE))}`);
          line(`  text: ${(await w.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
          // audit trail
          await w.goto(new URL('/audit-logs', w.url()).toString()).catch(() => {});
          await w.waitForTimeout(6000);
          line(`  AUDIT LOGS url=${w.url()} top: ${(await w.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 900)}`);
        }
        if (popup3) { await page.waitForTimeout(1000); line(`  superadmin tab now: ${page.url()}`); }
        const exitBtn = w.getByRole('button', { name: /exit|end|stop|return/i });
        line(`  exit-ish buttons: ${JSON.stringify(await exitBtn.allInnerTexts().catch(() => []))}`);
      }
      const banner = await where.locator('text=/impersonat|logged in as|viewing as|exit|return to/i').allInnerTexts().catch(() => []);
      line(`  banner-ish: ${JSON.stringify(banner.slice(0, 6))}`);
      const me = await where.evaluate(async () => {
        const r = await fetch('https://dev-api.talentforge.com.sa/core/api/v1/auth/me/', { credentials: 'include' }).catch(() => null);
        return r ? `${r.status}` : 'n/a';
      });
      line(`  auth/me from that tab (cookie only): ${me}`);
      if (popup) {
        await page.bringToFront(); await page.reload(); await page.waitForTimeout(4000);
        line(`  superadmin tab after reload: ${page.url()} text=${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
