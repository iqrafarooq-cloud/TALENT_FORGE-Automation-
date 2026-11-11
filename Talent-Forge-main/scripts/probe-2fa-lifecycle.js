/* eslint-disable no-console */
// probe-2fa-lifecycle.js — drive the WHOLE 2FA lifecycle on the dedicated TWOFA_AGENT and print
// what the app actually renders at each decision point, verbatim.
//
// This is the probe that answers the questions 2FA.feature asserts and nobody had measured:
//   - does a computed TOTP actually enable 2FA, and what does the success toast say?
//   - what does a WRONG code render — an inline message, a toast, or nothing? do the cells go red?
//   - what does an EXPIRED code (a genuinely valid code from four windows ago) render? is it told
//     apart from a wrong one at all?
//   - what does the disable flow look like — a confirmation step, an OTP step, or both?
//   - what does login look like once 2FA is on?
// Every string below is printed as found rather than searched for, because a locator for the
// wording the feature file HOPES to find can only ever answer "absent".
//
// It MUTATES the dedicated agent (that is the point) and always tries to leave 2FA OFF.
require('dotenv').config();
const { chromium } = require('playwright');
const { totp, freshTotp, invalidCode, extractSecret, secondsRemaining } = require('../utils/totp');

const EMAIL = process.env.TWOFA_AGENT_EMAIL;
const PASSWORD = process.env.TWOFA_AGENT_PASSWORD;
const SETTINGS = (process.env.BASE_URL || '').replace(/\/login\/?$/, '/settings');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function login(page, email, password) {
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
}

async function openSecurity(page) {
  await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: /^security$/i }).first().click({ timeout: 30000 });
  await page.waitForTimeout(1500);
}

const dialog = (page) => page.locator('[role="dialog"]').first();

async function dumpDialog(page, tag) {
  const d = dialog(page);
  const visible = await d.isVisible().catch(() => false);
  console.log(`\n---- ${tag} ----`);
  if (!visible) {
    console.log('  (no dialog on screen)');
    return null;
  }
  const text = clean(await d.innerText());
  console.log('  TEXT: ' + text);
  const buttons = await d.locator('button').evaluateAll((els) =>
    els.map((b) => ({ t: (b.textContent || '').replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'), dis: b.disabled }))
  );
  console.log('  BUTTONS: ' + JSON.stringify(buttons));
  return text;
}

// The OTP control is `input-otp`: ONE <input maxlength=6 data-input-otp> overlaying six
// <div aria-label="Enter digit N of 6"> cells. Typing with the keyboard alone does nothing —
// the input must be focused first.
async function enterOtp(page, code) {
  const input = page.locator('[role="dialog"] input[data-input-otp], [role="dialog"] input[maxlength="6"]').first();
  await input.click({ force: true });
  await input.fill('');
  await input.type(code, { delay: 60 });
  await page.waitForTimeout(400);
  const cells = await page.locator('[role="dialog"] [aria-label^="Enter digit"]').evaluateAll((els) =>
    els.map((e) => ({ text: (e.textContent || '').trim(), ring: getComputedStyle(e).getPropertyValue('--tw-ring-color') || '', cls: (e.className || '').toString().match(/ring-[\w-]+/g) }))
  );
  return { value: await input.inputValue(), cells };
}

async function confirmState(page) {
  const b = page.getByRole('button', { name: /^confirm$/i }).first();
  if (!(await b.isVisible().catch(() => false))) return '(absent)';
  return `disabled=${await b.isDisabled()}`;
}

async function pageFeedback(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    document.querySelectorAll('[role="alert"],[role="status"],[data-sonner-toast],.Toastify__toast,[class*="toast" i]').forEach((e) => {
      if (vis(e) && c(e.innerText)) out.push({ from: e.getAttribute('role') || e.tagName, text: c(e.innerText).slice(0, 200) });
    });
    // Anything red on screen — the honest way to find an inline error whose wording is unknown.
    document.querySelectorAll('p,span,div,small').forEach((e) => {
      if (!vis(e) || e.children.length) return;
      const col = getComputedStyle(e).color;
      const m = col.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110 && c(e.textContent)) {
        out.push({ from: `red-text ${col}`, text: c(e.textContent).slice(0, 200) });
      }
    });
    return out;
  });
}

async function report(page, tag) {
  await page.waitForTimeout(2500);
  console.log(`\n>>> FEEDBACK after ${tag}:`);
  const fb = await pageFeedback(page);
  if (!fb.length) console.log('   (nothing)');
  fb.forEach((f) => console.log(`   [${f.from}] ${f.text}`));
  await dumpDialog(page, `dialog after ${tag}`);
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Run `node scripts/provision-2fa-agent.js` first');
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  let secret = null;
  page.on('response', async (r) => {
    if (!/\/auth\/token\/2fa|verify|otp/i.test(r.url())) return;
    let body = '';
    try { body = clean(await r.text()); } catch { /* stream */ }
    console.log(`[api] ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  req=${clean(r.request().postData() || '')}  res=${body.slice(0, 300)}`);
    if (/manual_key|otpauth/.test(body)) { try { secret = extractSecret(JSON.parse(body)); } catch { /* not json */ } }
  });

  console.log(`### logging in as ${EMAIL}`);
  await login(page, EMAIL, PASSWORD);
  await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 90000 });
  console.log('landed on', page.url());

  await openSecurity(page);
  const toggle = page.locator('input[role="switch"]').first();
  console.log('2FA toggle state:', await toggle.isChecked());

  // ============ ENABLE ============
  console.log('\n\n========== ENABLE FLOW ==========');
  await toggle.click({ force: true });
  await page.waitForTimeout(2500);
  await dumpDialog(page, 'setup modal (step 1)');

  const modalSecret = clean(await dialog(page).innerText()).match(/\b[A-Z2-7]{16,}\b/);
  console.log('  manual key read off the MODAL:', modalSecret && modalSecret[0]);
  console.log('  secret read off the API      :', secret);
  const key = secret || (modalSecret && modalSecret[0]);

  await page.getByRole('button', { name: /^next$/i }).first().click();
  await page.waitForTimeout(1500);
  await dumpDialog(page, 'OTP step');
  console.log('  autofocus on the OTP input?', await page.locator('[role="dialog"] input[data-input-otp]').first().evaluate((e) => e === document.activeElement).catch(() => 'n/a'));
  console.log('  digit cells:', await page.locator('[role="dialog"] [aria-label^="Enter digit"]').count());
  console.log('  Confirm at 0 digits:', await confirmState(page));

  // -- partial code --
  console.log('\n-- typing 3 digits --');
  console.log('  ', JSON.stringify(await enterOtp(page, '123')));
  console.log('  Confirm at 3 digits:', await confirmState(page));

  // -- wrong code --
  console.log('\n-- WRONG code --');
  const wrong = invalidCode(key);
  console.log('  ', JSON.stringify(await enterOtp(page, wrong)));
  console.log('  Confirm at 6 digits:', await confirmState(page));
  await page.getByRole('button', { name: /^confirm$/i }).first().click();
  await report(page, `WRONG code ${wrong}`);
  console.log('  cells after wrong code:', JSON.stringify(await page.locator('[role="dialog"] [aria-label^="Enter digit"]').evaluateAll((els) => els.map((e) => (e.className || '').toString().match(/ring-[\w-]+/g)))));
  console.log('  toggle still off?', await toggle.isChecked().catch(() => 'n/a'));

  // -- expired code (four 30s windows back: genuinely valid two minutes ago) --
  console.log('\n-- EXPIRED code (T-120s) --');
  const expired = totp(key, { offsetSeconds: -120 });
  await enterOtp(page, expired);
  await page.getByRole('button', { name: /^confirm$/i }).first().click();
  await report(page, `EXPIRED code ${expired}`);

  // -- valid code --
  console.log('\n-- VALID code --');
  const { code, waitedMs } = await freshTotp(key);
  console.log(`  computed ${code} (waited ${waitedMs}ms, ${secondsRemaining()}s left in window)`);
  await enterOtp(page, code);
  await page.getByRole('button', { name: /^confirm$/i }).first().click();
  await report(page, `VALID code ${code}`);
  await page.waitForTimeout(2000);
  console.log('  toggle now:', await toggle.isChecked().catch(() => 'n/a'));
  console.log('  red warning icons left on screen:', await page.locator('svg.fill-error-600').count());

  // ============ LOGIN PROMPT ============
  console.log('\n\n========== LOGIN WITH 2FA ON ==========');
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await c2.newPage();
  p2.on('response', async (r) => {
    if (!/2fa|verify|token/i.test(r.url())) return;
    let body = ''; try { body = clean(await r.text()); } catch { /* */ }
    console.log(`[api2] ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} res=${body.slice(0, 200)}`);
  });
  await login(p2, EMAIL, PASSWORD);
  await p2.waitForTimeout(5000);
  console.log('  url after login:', p2.url());
  console.log('  BODY: ' + clean(await p2.locator('body').innerText()).slice(0, 600));
  console.log('  dialog?', await dumpDialog(p2, 'login 2FA prompt'));
  console.log('  digit cells:', await p2.locator('[aria-label^="Enter digit"]').count());
  const otpInput2 = p2.locator('input[data-input-otp], input[maxlength="6"]').first();
  console.log('  autofocused?', await otpInput2.evaluate((e) => e === document.activeElement).catch(() => 'n/a'));

  console.log('\n-- login: wrong code --');
  const wrong2 = invalidCode(key);
  await otpInput2.click({ force: true });
  await otpInput2.type(wrong2, { delay: 60 });
  await p2.waitForTimeout(500);
  const confirm2 = p2.getByRole('button', { name: /^confirm$|^verify$|^continue$|^submit$/i }).first();
  console.log('  confirm button:', await confirm2.textContent().catch(() => '(absent)'), 'disabled=', await confirm2.isDisabled().catch(() => 'n/a'));
  await confirm2.click().catch((e) => console.log('  click failed:', e.message.split('\n')[0]));
  await report(p2, 'login WRONG code');
  console.log('  url:', p2.url());

  console.log('\n-- login: navigate away attempt --');
  await p2.goto((process.env.BASE_URL || '').replace(/\/login\/?$/, '/dashboard'), { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(4000);
  console.log('  url after direct /dashboard:', p2.url());
  console.log('  BODY: ' + clean(await p2.locator('body').innerText()).slice(0, 300));

  console.log('\n-- login: valid code --');
  await login(p2, EMAIL, PASSWORD);
  await p2.waitForTimeout(5000);
  const v = await freshTotp(key);
  const otpInput3 = p2.locator('input[data-input-otp], input[maxlength="6"]').first();
  await otpInput3.click({ force: true });
  await otpInput3.fill('');
  await otpInput3.type(v.code, { delay: 60 });
  await p2.waitForTimeout(400);
  await p2.getByRole('button', { name: /^confirm$|^verify$|^continue$|^submit$/i }).first().click().catch(() => {});
  await p2.waitForTimeout(6000);
  console.log('  url after valid code:', p2.url());
  await c2.close();

  // ============ DISABLE ============
  console.log('\n\n========== DISABLE FLOW ==========');
  await openSecurity(page);
  const toggle2 = page.locator('input[role="switch"]').first();
  console.log('  toggle before:', await toggle2.isChecked());
  await toggle2.click({ force: true });
  await page.waitForTimeout(2500);
  await dumpDialog(page, 'disable confirmation');

  const turnOff = page.getByRole('button', { name: /turn off/i }).first();
  if (await turnOff.isVisible().catch(() => false)) {
    console.log('  clicking "Turn off 2FA"');
    await turnOff.click();
    await page.waitForTimeout(2000);
    await dumpDialog(page, 'after Turn off 2FA');
  }

  console.log('  digit cells on the disable step:', await page.locator('[role="dialog"] [aria-label^="Enter digit"]').count());
  if (await page.locator('[role="dialog"] input[data-input-otp]').count()) {
    console.log('\n-- disable: wrong code --');
    await enterOtp(page, invalidCode(key));
    await page.getByRole('button', { name: /^confirm$/i }).first().click();
    await report(page, 'disable WRONG code');
    console.log('  toggle still on?', await toggle2.isChecked().catch(() => 'n/a'));

    console.log('\n-- disable: valid code --');
    const d = await freshTotp(key);
    await enterOtp(page, d.code);
    await page.getByRole('button', { name: /^confirm$/i }).first().click();
    await report(page, 'disable VALID code');
  }
  await page.waitForTimeout(2500);
  await openSecurity(page);
  console.log('\nFINAL toggle state (must be false):', await page.locator('input[role="switch"]').first().isChecked().catch(() => 'n/a'));
  console.log('FINAL red warning icons:', await page.locator('svg.fill-error-600').count());

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
