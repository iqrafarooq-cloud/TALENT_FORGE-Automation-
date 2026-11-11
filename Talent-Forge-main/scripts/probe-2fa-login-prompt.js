/* eslint-disable no-console */
// probe-2fa-login-prompt.js — the login-time 2FA challenge at /verify-otp, and the disable flow.
//
// probe-2fa-lifecycle.js established the settings-side contract but died on the login prompt:
// it is a full PAGE at /verify-otp, not a dialog, and it renders NO `[aria-label^="Enter digit"]`
// cells and no `input[data-input-otp]` — so whatever control it uses is a different one from the
// setup modal's. This dumps it without assuming anything, then exercises wrong/valid codes and
// the bypass attempt, and finally turns 2FA back OFF so the fixture is left clean.
//
// It ALWAYS attempts the disable, in a finally block — a probe that leaves the dedicated agent
// demanding an OTP is a probe that has broken its own fixture.
require('dotenv').config();
const { chromium } = require('playwright');
const { freshTotp, invalidCode, extractSecret } = require('../utils/totp');

const EMAIL = process.env.TWOFA_AGENT_EMAIL;
const PASSWORD = process.env.TWOFA_AGENT_PASSWORD;
const APP = (process.env.BASE_URL || '').replace(/\/login\/?$/, '');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// The secret is only handed out at SETUP time, so it must be carried across from the enable that
// is already in place. It is passed in on argv (printed by probe-2fa-lifecycle.js), or a fresh
// one is minted by disabling and re-enabling.
const SECRET = process.argv[2];

async function login(page) {
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
}

async function dumpPage(page, tag) {
  console.log(`\n================ ${tag} ================`);
  console.log('URL:', page.url());
  const d = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return {
      text: c(document.body.innerText).slice(0, 800),
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(vis).map((h) => c(h.textContent)),
      inputs: Array.from(document.querySelectorAll('input')).map((i) => ({
        type: i.type, maxlength: i.getAttribute('maxlength'), inputmode: i.getAttribute('inputmode'),
        aria: i.getAttribute('aria-label'), name: i.getAttribute('name'), id: i.id,
        otp: i.getAttribute('data-input-otp'), autocomplete: i.getAttribute('autocomplete'),
        visible: vis(i), focused: i === document.activeElement, value: i.value,
        cls: (i.className || '').toString().slice(0, 80),
      })),
      cells: Array.from(document.querySelectorAll('[aria-label*="digit" i],[data-input-otp-container] > div')).map((e) => ({
        aria: e.getAttribute('aria-label'), text: c(e.textContent),
        ring: (e.className || '').toString().match(/ring-[\w-]+/g),
      })),
      buttons: Array.from(document.querySelectorAll('button')).filter(vis).map((b) => ({
        t: c(b.textContent), aria: b.getAttribute('aria-label'), dis: b.disabled,
      })),
      activeElement: (() => { const a = document.activeElement; return a ? `${a.tagName} ${a.getAttribute('aria-label') || c(a.textContent).slice(0, 30)}` : 'none'; })(),
    };
  });
  console.log('TEXT:', d.text);
  console.log('HEADINGS:', JSON.stringify(d.headings));
  console.log('INPUTS:'); d.inputs.forEach((i) => console.log('  ', JSON.stringify(i)));
  console.log('CELLS:', JSON.stringify(d.cells));
  console.log('BUTTONS:', JSON.stringify(d.buttons));
  console.log('activeElement:', d.activeElement);
  return d;
}

async function feedback(page, tag) {
  await page.waitForTimeout(2500);
  const fb = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    document.querySelectorAll('[role="alert"],[role="status"]').forEach((e) => { if (vis(e) && c(e.innerText)) out.push(`[${e.getAttribute('role')}] ${c(e.innerText).slice(0, 160)}`); });
    document.querySelectorAll('p,span,div,small').forEach((e) => {
      if (!vis(e) || e.children.length) return;
      const m = getComputedStyle(e).color.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110 && c(e.textContent)) out.push(`[red] ${c(e.textContent).slice(0, 160)}`);
    });
    return [...new Set(out)];
  });
  console.log(`>>> feedback after ${tag}: ${fb.length ? fb.join(' | ') : '(nothing)'}`);
}

// TWO DIFFERENT OTP CONTROLS EXIST, and a reader that knows only one silently times out on the
// other. The SETUP MODAL uses `input-otp`: one <input maxlength=6 data-input-otp> overlaying six
// presentational <div aria-label="Enter digit N of 6"> cells. The LOGIN CHALLENGE at /verify-otp
// uses six REAL <input type=text maxlength=1 inputmode=numeric> boxes and no cells at all.
async function typeOtp(page, code) {
  const scope = (await page.locator('[role="dialog"]').count()) ? page.locator('[role="dialog"]') : page;
  const singles = scope.locator('input[maxlength="1"]');
  const n = await singles.count();
  if (n) {
    for (let i = 0; i < n; i++) await singles.nth(i).fill('');
    for (let i = 0; i < Math.min(code.length, n); i++) {
      await singles.nth(i).click({ force: true });
      await singles.nth(i).fill(code[i]);
    }
    await page.waitForTimeout(400);
    return (await singles.evaluateAll((els) => els.map((e) => e.value))).join('');
  }
  const input = scope.locator('input[data-input-otp], input[maxlength="6"], input[autocomplete="one-time-code"]').first();
  await input.waitFor({ state: 'attached', timeout: 20000 });
  await input.click({ force: true }).catch(() => input.focus());
  await input.fill('');
  await input.type(code, { delay: 60 });
  await page.waitForTimeout(400);
  return input.inputValue();
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let secret = SECRET;

  page.on('response', async (r) => {
    if (!/2fa|verify|otp/i.test(r.url())) return;
    let b = ''; try { b = clean(await r.text()); } catch { /* */ }
    console.log(`[api] ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} req=${clean(r.request().postData() || '')} res=${b.slice(0, 260)}`);
    if (/manual_key|otpauth/.test(b)) { try { secret = extractSecret(JSON.parse(b)); console.log('  (captured secret)'); } catch { /* */ } }
  });

  try {
    console.log(`logging in as ${EMAIL}`);
    await login(page);
    await page.waitForTimeout(6000);
    const d = await dumpPage(page, 'LOGIN 2FA CHALLENGE');

    // The OTP control may mount late; re-read after a beat.
    await page.waitForTimeout(3000);
    await dumpPage(page, 'LOGIN 2FA CHALLENGE (after 3s)');

    // Print the whole card's HTML so a control with no recognisable attribute is still visible.
    const cardHtml = await page.evaluate(() => {
      const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const h = Array.from(document.querySelectorAll('h1,h2,h3')).find((e) => /authenticator|verification|6-digit/i.test(c(e.textContent)));
      let host = h || document.body;
      for (let i = 0; i < 5 && host.parentElement && host !== document.body; i++) host = host.parentElement;
      return host.outerHTML.slice(0, 5000);
    });
    console.log('\n--- challenge card outerHTML ---\n' + cardHtml);

    if (!secret) {
      console.log('\nNo secret available (pass it on argv). Cannot complete the code paths.');
    } else {
      console.log('\n-- WRONG code --');
      console.log('  typed:', await typeOtp(page, invalidCode(secret)));
      const submit = page.getByRole('button', { name: /^verify$|^confirm$|^continue$|^submit$/i }).first();
      console.log('  submit button:', clean(await submit.textContent().catch(() => '')), 'disabled=', await submit.isDisabled().catch(() => 'n/a'));
      await submit.click().catch((e) => console.log('  click failed:', e.message.split('\n')[0]));
      await feedback(page, 'WRONG code');
      console.log('  url:', page.url());
      console.log('  cell rings:', JSON.stringify(await page.locator('[aria-label*="digit" i]').evaluateAll((els) => els.map((e) => (e.className || '').toString().match(/ring-[\w-]+/g)))));

      console.log('\n-- partial code / submit gating --');
      await typeOtp(page, '12345');
      console.log('  submit at 5 digits: disabled=', await submit.isDisabled().catch(() => 'n/a'));
      await typeOtp(page, '123456');
      console.log('  submit at 6 digits: disabled=', await submit.isDisabled().catch(() => 'n/a'));

      console.log('\n-- BYPASS attempt: navigate straight to /dashboard --');
      await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      console.log('  url:', page.url());
      console.log('  body:', clean(await page.locator('body').innerText()).slice(0, 300));

      console.log('\n-- VALID code --');
      await login(page);
      await page.waitForTimeout(6000);
      const v = await freshTotp(secret);
      console.log('  typed:', await typeOtp(page, v.code));
      await page.getByRole('button', { name: /^verify$|^confirm$/i }).first().click().catch(() => {});
      await page.waitForTimeout(8000);
      console.log('  url after valid code:', page.url());
      console.log('  body:', clean(await page.locator('body').innerText()).slice(0, 200));
    }
  } finally {
    // ---- ALWAYS put the fixture back: 2FA OFF ----
    console.log('\n\n========== RESTORE: turning 2FA OFF ==========');
    try {
      if (/\/verify-otp/.test(page.url()) && secret) {
        const v = await freshTotp(secret);
        await typeOtp(page, v.code);
        await page.getByRole('button', { name: /^verify$|^confirm$/i }).first().click().catch(() => {});
        await page.waitForTimeout(8000);
      }
      await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('radio', { name: /^security$/i }).first().click({ timeout: 30000 });
      await page.waitForTimeout(2000);
      const toggle = page.locator('input[role="switch"]').first();
      console.log('  toggle currently:', await toggle.isChecked());
      if (await toggle.isChecked()) {
        await toggle.click({ force: true });
        await page.waitForTimeout(2500);
        await dumpPage(page, 'DISABLE CONFIRMATION');
        const off = page.getByRole('button', { name: /turn off/i }).first();
        if (await off.isVisible().catch(() => false)) { await off.click(); await page.waitForTimeout(2500); }
        await dumpPage(page, 'DISABLE STEP 2');
        if (secret && (await page.locator('[role="dialog"] input[maxlength="6"], [role="dialog"] input[maxlength="1"], input[data-input-otp]').count())) {
          const v = await freshTotp(secret);
          await typeOtp(page, v.code);
          await page.getByRole('button', { name: /^confirm$|^verify$/i }).first().click().catch(() => {});
          await feedback(page, 'disable VALID code');
        }
        await page.waitForTimeout(3000);
      }
      await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('radio', { name: /^security$/i }).first().click({ timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
      console.log('  FINAL toggle state (want false):', await page.locator('input[role="switch"]').first().isChecked().catch(() => 'n/a'));
    } catch (e) {
      console.log('  RESTORE FAILED:', e.message.split('\n')[0]);
      console.log('  !! The 2FA fixture may still have 2FA ENABLED. Secret:', secret);
    }
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
