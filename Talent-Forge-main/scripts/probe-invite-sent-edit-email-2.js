// probe-invite-sent-edit-email-2.js - the questions the first probe left open, on the SAME throwaway
// Invite Sent agent it created (pass its current address and both temporary passwords):
//   1. does the OLD invitation still sign in after the address changed?  2. does the NEW one?
//   3. what does Next do for each invalid input (validation runs on Next, not on typing)?
//   4. what does a second change inside the 2-minute re-invite cooldown do?
// Writes nothing except, in (4), a PATCH that the cooldown is expected to refuse.
//
//   node scripts/probe-invite-sent-edit-email-2.js <currentEmail> <oldEmail> <oldTempPw> <newTempPw> [--no-login]
require('dotenv').config();
const { chromium } = require('@playwright/test');
const AgentsListingPage = require('../pages/AgentsListingPage');
const LoginPage = require('../pages/LoginPage');
const { loginSuperadmin } = require('../utils/promoAgentProvision');

const [current, oldEmail, oldPw, newPw] = process.argv.slice(2);
const API = /dev-api\.talentforge\.com\.sa/;
const log = (...a) => console.log(...a);

async function tryLogin(browser, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(email);
    await login.passwordInput.first().fill(password);
    const resp = page.waitForResponse((r) => /\/auth\/token\/$/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await login.submitButton.first().click();
    const r = await resp;
    await page.waitForTimeout(4000);
    const body = r ? await r.text().catch(() => '') : '';
    const shown = (await page.locator('body').innerText()).match(/[^\n]*(invalid|credential|incorrect|expired|attempt)[^\n]*/i);
    return { status: r && r.status(), body: body.slice(0, 200), url: page.url(), shown: shown && shown[0] };
  } finally { await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch();
  if (!process.argv.includes('--no-login')) {
    log('OLD address + OLD temp pw :', JSON.stringify(await tryLogin(browser, oldEmail, oldPw)));
    log('NEW address + OLD temp pw :', JSON.stringify(await tryLogin(browser, current, oldPw)));
    log('NEW address + NEW temp pw :', JSON.stringify(await tryLogin(browser, current, newPw)));
  }

  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const writes = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!API.test(r.url()) || req.method() === 'GET') return;
    writes.push(`${req.method()} ${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, '')} res=${(await r.text().catch(() => '')).slice(0, 250)}`);
  });
  await loginSuperadmin(page);
  const L = new AgentsListingPage(page);
  const next = () => L.emailDialog.getByRole('button', { name: /^next$/i }).first();
  const red = () => page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /update email address/i.test(x.innerText));
    if (!d) return null;
    return Array.from(d.querySelectorAll('p,span,div')).filter((e) => !e.children.length && e.innerText.trim()
      && !/^(cancel|next|update)$/i.test(e.innerText.trim())
      && /^rgb\((2\d\d|1[89]\d),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color)).map((e) => e.innerText.trim());
  });
  const ariaInvalid = () => page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /update email address/i.test(x.innerText));
    return d ? Array.from(d.querySelectorAll('input')).map((i) => i.getAttribute('aria-invalid')) : null;
  });
  const typeInto = async (idx, v) => {
    const input = L.emailDialog.locator('input').nth(idx);
    await input.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    if (v) await page.keyboard.type(v);
  };
  const open = async () => {
    await L.goto('Invite Sent');
    await L.search(current);
    await L.openEmailDialog(current);
  };

  // The 2-minute re-invite cooldown after a change disables the row's Edit (and Resend?). Record the
  // row's buttons, then poll until Edit is enabled again.
  const rowButtons = async () => {
    await L.goto('Invite Sent');
    await L.search(current);
    return L.rowLocator(current).getByRole('button').evaluateAll((bs) => bs.map((b) => `${b.getAttribute('aria-label') || b.innerText.trim()}:${b.disabled ? 'disabled' : 'enabled'}`));
  };
  const t0 = Date.now();
  log('row buttons now:', JSON.stringify(await rowButtons()));
  for (;;) {
    const btns = await rowButtons();
    if (btns.some((b) => /^Edit:enabled/.test(b))) { log(`Edit enabled after ~${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(btns)); break; }
    if (Date.now() - t0 > 200000) { log('Edit still disabled after 200s'); break; }
    await page.waitForTimeout(10000);
  }

  const cases = [
    ['empty', '', ''],
    ['no-at', 'no-at-sign', 'no-at-sign'],
    ['no-tld', 'no@domain', 'no@domain'],
    ['spaced', 'spaced out@bytecorp.io', 'spaced out@bytecorp.io'],
    ['mismatch', 'valid.one@bytecorp.io', 'valid.two@bytecorp.io'],
    ['same-as-current', current, current],
    ['same-upper', current.toUpperCase(), current.toUpperCase()],
    ['whitespace', '   ', '   '],
    ['only-new', 'qa.only@bytecorp.io', ''],
    ['only-confirm', '', 'qa.only@bytecorp.io'],
    ['case-confirm', 'QA.Case@BYTECORP.IO', 'qa.case@bytecorp.io'],
    ['padded', '  qa.padded@bytecorp.io  ', '  qa.padded@bytecorp.io  '],
  ];
  for (const [name, a, b] of cases) {
    await open();
    await typeInto(1, a);
    await typeInto(2, b);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    const beforeNext = { red: await red(), nextDisabled: await next().isDisabled() };
    writes.length = 0;
    await next().click().catch(() => {});
    await page.waitForTimeout(1500);
    const resendOpen = await L.resendDialog.isVisible().catch(() => false);
    const resendText = resendOpen ? (await L.resendDialogText()).slice(0, 140) : null;
    log(`${name.padEnd(16)} blur:${JSON.stringify(beforeNext)} | afterNext: editOpen=${await L.emailDialog.isVisible().catch(() => false)} red=${JSON.stringify(await red())} aria=${JSON.stringify(await ariaInvalid())} resendOpen=${resendOpen} ${resendText || ''} writes=${writes.length}`);
    if (resendOpen) await L.resendDialog.getByRole('button', { name: /^cancel$/i }).click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // A second change inside the cooldown window.
  const inbox = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
  const [lp, dom] = inbox.split('@');
  const again = `${lp}+invsentagain${Date.now().toString(36)}@${dom}`;
  await open();
  await typeInto(1, again);
  await typeInto(2, again);
  await next().click();
  await L.resendDialog.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  writes.length = 0;
  const t = await L.captureToasts(async () => {
    await L.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
  }, { sampleMs: 7000 });
  log('\nSECOND CHANGE (cooldown?):', again, 'toasts', JSON.stringify(t));
  log('  writes:', writes.join('\n          '));
  await L.goto('Invite Sent');
  const r = await L.search(again);
  log('  listed by second address:', JSON.stringify(AgentsListingPage.agentsFrom(r.payload).map((x) => x.email)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
