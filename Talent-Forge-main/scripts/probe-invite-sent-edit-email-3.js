// probe-invite-sent-edit-email-3.js - for one throwaway Invite Sent agent (pass its CURRENT address):
//   * the full modal text + every non-label text node's colour after Next, for the inputs that keep
//     the modal open (mismatch / same address / case-differing confirmation) - is ANY message shown?
//   * what Resend Invite does when the Resend dialog was opened for an INVALID address or for the
//     current address in upper case (the server's answer and the row afterwards).
// Waits out the re-invite cooldown first (Edit is disabled while it runs).
//
//   node scripts/probe-invite-sent-edit-email-3.js <currentEmail>
require('dotenv').config();
const { chromium } = require('@playwright/test');
const AgentsListingPage = require('../pages/AgentsListingPage');
const { loginSuperadmin } = require('../utils/promoAgentProvision');

const current = process.argv[2];
const API = /dev-api\.talentforge\.com\.sa/;
const log = (...a) => console.log(...a);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const writes = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!API.test(r.url()) || req.method() === 'GET') return;
    writes.push(`${req.method()} ${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, '')} req=${(req.postData() || '').slice(0, 200)} res=${(await r.text().catch(() => '')).slice(0, 250)}`);
  });
  await loginSuperadmin(page);
  const L = new AgentsListingPage(page);
  const next = () => L.emailDialog.getByRole('button', { name: /^next$/i }).first();
  const typeInto = async (idx, v) => {
    const input = L.emailDialog.locator('input').nth(idx);
    await input.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    if (v) await page.keyboard.type(v);
  };
  const open = async () => {
    const t0 = Date.now();
    for (;;) {
      await L.goto('Invite Sent');
      await L.search(current);
      const edit = L.rowLocator(current).getByRole('button', { name: /^edit$/i }).first();
      if (!(await edit.isDisabled().catch(() => true))) break;
      if (Date.now() - t0 > 200000) throw new Error('Edit stayed disabled');
      await page.waitForTimeout(10000);
    }
    await L.openEmailDialog(current);
  };
  const dump = () => page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /update email address/i.test(x.innerText));
    if (!d) return null;
    return {
      text: d.innerText.replace(/\s+/g, ' '),
      nodes: Array.from(d.querySelectorAll('p,span,small,div')).filter((e) => !e.children.length && e.innerText.trim())
        .map((e) => `${e.innerText.trim()} [${getComputedStyle(e).color}]`),
      describedBy: Array.from(d.querySelectorAll('input')).map((i) => i.getAttribute('aria-describedby')),
    };
  });

  for (const [name, a, b] of [
    ['mismatch', 'valid.one@bytecorp.io', 'valid.two@bytecorp.io'],
    ['same-as-current', current, current],
    ['case-confirm', 'QA.Case@BYTECORP.IO', 'qa.case@bytecorp.io'],
  ]) {
    await open();
    await typeInto(1, a);
    await typeInto(2, b);
    await next().click();
    await page.waitForTimeout(1500);
    log(`\n${name}:`, JSON.stringify(await dump()));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  for (const [name, a] of [['commit-invalid', 'no-at-sign'], ['commit-upper-current', current.toUpperCase()]]) {
    await open();
    await typeInto(1, a);
    await typeInto(2, a);
    await next().click();
    await L.resendDialog.waitFor({ state: 'visible', timeout: 15000 });
    writes.length = 0;
    const t = await L.captureToasts(async () => {
      await L.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
    }, { sampleMs: 7000 });
    log(`\n${name} (${a}): toasts=${JSON.stringify(t)} resendOpen=${await L.resendDialog.isVisible().catch(() => false)} editOpen=${await L.emailDialog.isVisible().catch(() => false)}`);
    log('  writes:', writes.join('\n          ') || '(none)');
    await page.keyboard.press('Escape').catch(() => {});
    await L.goto('Invite Sent');
    const r = await L.search(current);
    log('  row now:', JSON.stringify(AgentsListingPage.agentsFrom(r.payload).map((x) => ({ e: x.email, p: x.pendingEmail, s: x.status }))));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
