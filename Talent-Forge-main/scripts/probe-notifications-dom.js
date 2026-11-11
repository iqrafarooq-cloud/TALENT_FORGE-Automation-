// probe-notifications-dom.js — the header notification centre's real DOM, so
// NotificationsPage.js can be built on selectors that exist rather than guessed ones.
//
//   node scripts/probe-notifications-dom.js
//
// Read-only. Prints, for the LIMITED promo agent (whose bell already holds real
// "Your promo code has been disabled/resumed" entries):
//   the bell button, the panel container, the All / Unread tabs, and the repeating
//   item element with its title/body/timestamp — plus the notifications API call.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const calls = [];
    page.on('response', async (r) => {
      if (!/notification/i.test(r.url())) return;
      let body = '';
      try { body = JSON.stringify(await r.json()); } catch { /* non-json */ }
      calls.push(`${r.request().method()} ${r.status()} ${r.url()}\n     ${body.slice(0, 800)}`);
    });

    const lp = new LoginPage(page);
    await lp.navigate();
    await lp.emailInput.first().fill(process.env.PROMO_LIMITED_AGENT_EMAIL);
    await lp.passwordInput.first().fill(process.env.PROMO_LIMITED_AGENT_PASSWORD);
    await lp.submitButton.first().click();
    await page.waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' });
    await page.waitForTimeout(3000);

    console.log('=============== BELL CANDIDATES ===============');
    console.log(JSON.stringify(await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => /notif|bell/i.test(`${b.getAttribute('aria-label')} ${b.className} ${b.id} ${b.getAttribute('data-testid')}`))
        .map((b) => ({
          label: b.getAttribute('aria-label'),
          testid: b.getAttribute('data-testid'),
          cls: (b.className || '').slice(0, 90),
          haspopup: b.getAttribute('aria-haspopup'),
          inHeader: !!b.closest('header'),
          badge: (b.textContent || '').trim().slice(0, 12),
        }))), null, 2));

    // A modal can be sitting over the dashboard a few seconds after login; it intercepts the
    // bell click. Report what it is, then get rid of it.
    const overlay = page.locator('div.fixed.inset-0').filter({ hasText: /./ }).first();
    if (await overlay.isVisible().catch(() => false)) {
      console.log('\n=============== BLOCKING OVERLAY ===============');
      console.log((await overlay.innerText().catch(() => '')).slice(0, 600));
      console.log(JSON.stringify(await page.evaluate(() => {
        const o = document.querySelector('div.fixed.inset-0');
        return o ? [...o.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)) : null;
      })));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      console.log(`overlay still visible after Escape: ${await overlay.isVisible().catch(() => false)}`);
    }

    await page.locator('button[aria-label*="notification" i]').first().click();
    await page.waitForTimeout(3500);

    console.log('\n=============== PANEL ===============');
    console.log(JSON.stringify(await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]');
      if (!panel) return { found: false };
      const desc = (el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        testid: el.getAttribute('data-testid'),
        cls: (el.getAttribute('class') || '').slice(0, 110),
      });
      // The repeating item: the deepest element type that occurs many times and whose text
      // contains a promo title.
      const all = [...panel.querySelectorAll('*')];
      const promoTitles = all.filter((e) => /^Your promo code has been (disabled|resumed)$/i.test((e.textContent || '').trim()));
      const items = promoTitles.map((t) => {
        // Walk up until the block also carries the body sentence + a timestamp.
        let n = t;
        for (let i = 0; i < 6 && n.parentElement; i += 1) {
          n = n.parentElement;
          const txt = (n.innerText || '');
          if (/promo code/i.test(txt) && /(ago|Today|Yesterday)/i.test(txt)) break;
        }
        return { title: (t.textContent || '').trim(), titleEl: desc(t), itemEl: desc(n), text: (n.innerText || '').replace(/\n+/g, ' | ').slice(0, 200) };
      });
      return {
        found: true,
        panel: desc(panel),
        tabs: [...panel.querySelectorAll('[role="tab"], button')]
          .map((b) => ({ role: b.getAttribute('role'), text: (b.textContent || '').trim().slice(0, 30) }))
          .filter((b) => b.text),
        itemCount: promoTitles.length,
        items: items.slice(0, 3),
      };
    }), null, 2));

    console.log('\n=============== API ===============');
    for (const c of calls) console.log(`  ${c}`);
    await context.close();
  } finally {
    await browser.close();
  }
})();
