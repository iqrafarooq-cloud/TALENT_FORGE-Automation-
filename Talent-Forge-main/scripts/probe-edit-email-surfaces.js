// probe-edit-email-surfaces.js - where does Edit > "Update Email Address" exist, and what
// does a PENDING (unverified) email change look like on the listing?
//
//   node scripts/probe-edit-email-surfaces.js
//
// READ-ONLY. Opens dialogs and closes them. Never clicks Update.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const line = (t) => console.log(`\n${'='.repeat(18)} ${t} ${'='.repeat(18)}`);
const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const api = [];
  page.on('request', (r) => { if (/\/api\/v1\//.test(r.url())) api.push(`${r.method()} ${r.url()}`); });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management|\/analytics|\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(3000);

  line('LANDED');
  console.log(page.url());

  line('SIDEBAR NAV');
  console.log(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
    .map((a) => `${a.getAttribute('href')} :: ${(a.innerText || '').replace(/\s+/g, ' ').trim()}`)
    .filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 40)), null, 1));

  const settle = async (timeout = 25000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'))
          .filter((r) => !r.querySelector('[role="columnheader"]'));
        return {
          rows: rows.length,
          filled: rows.filter((r) => /@/.test(r.innerText || '')).length,
          empty: Array.from(document.querySelectorAll('h1,h2,h3,h4')).some((h) => /no results|no pending|no agents|not found|no candidates/i.test(h.innerText || '')),
        };
      });
      if (s.filled > 0 || s.empty) return s;
      await page.waitForTimeout(400);
    }
    return null;
  };

  // Dump every data row: its text, the colour each email is painted, and every attribute
  // that could carry a tooltip. Colour is read rather than a class guessed at - the repo has
  // paid for guessed CSS twice.
  const dumpRows = async (limit = 6) => page.evaluate((n) => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'));
    return rows.slice(0, n).map((r) => {
      const emailEl = Array.from(r.querySelectorAll('p,span,div,a'))
        .filter((e) => /@/.test(e.innerText || '') && !e.children.length)[0];
      return {
        text: c(r.innerText).slice(0, 180),
        actions: Array.from(r.querySelectorAll('button')).map((b) => c(b.getAttribute('aria-label')) || c(b.innerText) || c(b.getAttribute('data-testid'))),
        email: emailEl ? {
          text: c(emailEl.innerText),
          color: getComputedStyle(emailEl).color,
          className: emailEl.className,
          title: emailEl.getAttribute('title'),
          parentHtml: c(emailEl.parentElement ? emailEl.parentElement.outerHTML : '').slice(0, 400),
        } : null,
      };
    });
  }, limit);

  // ---------- AGENTS: every tab ----------
  for (const tab of ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated']) {
    line(`AGENTS > ${tab}`);
    await page.goto(`${ORIGIN}/agents`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const t = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).first();
    if (await t.count()) { await t.click(); } else {
      const alt = page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).first();
      if (await alt.count()) await alt.click();
    }
    await page.waitForTimeout(2000);
    console.log('settled:', JSON.stringify(await settle()));
    console.log(JSON.stringify(await dumpRows(4), null, 1));
  }

  // ---------- CANDIDATES (superadmin) ----------
  for (const route of ['/candidates', '/candidates/active', '/candidates/all', '/user-management/candidates']) {
    line(`CANDIDATES ROUTE ${route}`);
    await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('nav failed', e.message));
    await page.waitForTimeout(2500);
    console.log('url:', page.url());
    console.log('headings:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => (h.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8))));
    console.log('tabs:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"],[role="radio"]')).map((t) => (t.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))));
    console.log('settled:', JSON.stringify(await settle(15000)));
    console.log(JSON.stringify(await dumpRows(4), null, 1));
  }

  line('API CALLS SEEN');
  console.log(JSON.stringify(Array.from(new Set(api)).slice(-40), null, 1));

  await page.waitForTimeout(1000);
  await browser.close();
})();
