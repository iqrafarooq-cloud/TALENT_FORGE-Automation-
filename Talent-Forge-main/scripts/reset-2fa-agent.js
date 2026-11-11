/* eslint-disable no-console */
// reset-2fa-agent.js — put the dedicated TWOFA_AGENT back to 2FA OFF, whatever state it is in.
//
// The 2FA feature's After hook does this automatically, but a KILLED run has no hook, and an
// agent left demanding an OTP cannot be logged into by anything that does not know its secret.
// So this is the manual recovery: it logs in (answering the login challenge if one appears),
// opens Security, and walks the disable flow.
//
// It needs the TOTP secret, because that is the only thing that can answer the challenge:
//   node scripts/reset-2fa-agent.js <BASE32_SECRET>
// The secret is printed by the 2FA scenarios (and attached to the report) precisely so a wedged
// fixture is recoverable. TWOFA_AGENT_SECRET in .env is used when no argument is given.
//
// A CODE IS SINGLE-USE. Submitting the same 6 digits twice inside one 30s window is rejected as
// "Incorrect OTP." even though the digits are right — which is how the first version of this
// script failed while looking like an app defect. consumeCode() below waits out the window after
// every submission so the next code is genuinely new.
require('dotenv').config();
const { chromium } = require('playwright');
const { totp, secondsRemaining } = require('../utils/totp');

const EMAIL = process.env.TWOFA_AGENT_EMAIL;
const PASSWORD = process.env.TWOFA_AGENT_PASSWORD;
const SECRET = process.argv[2] || process.env.TWOFA_AGENT_SECRET;
const APP = (process.env.BASE_URL || '').replace(/\/login\/?$/, '');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Codes already spent this run. A TOTP step lasts 30s, so two submissions inside one step would
// otherwise re-send the identical digits.
const spent = new Set();
async function freshUnusedCode(secret) {
  for (let i = 0; i < 4; i++) {
    const code = totp(secret);
    if (!spent.has(code) && secondsRemaining() >= 3) { spent.add(code); return code; }
    const wait = (secondsRemaining() + 1) * 1000;
    console.log(`  waiting ${Math.round(wait / 1000)}s for a new TOTP window...`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('could not obtain an unused TOTP code');
}

async function fillOtp(page, code) {
  const scope = (await page.locator('[role="dialog"]').count()) ? page.locator('[role="dialog"]') : page;
  const singles = scope.locator('input[maxlength="1"]');
  const n = await singles.count();
  if (n >= 6) {
    for (let i = 0; i < n; i++) await singles.nth(i).fill('');
    for (let i = 0; i < 6; i++) { await singles.nth(i).click({ force: true }); await singles.nth(i).fill(code[i]); }
  } else {
    const input = scope.locator('input[data-input-otp], input[maxlength="6"]').first();
    await input.click({ force: true });
    await input.fill('');
    await input.type(code, { delay: 60 });
  }
  await page.waitForTimeout(500);
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('TWOFA_AGENT_EMAIL / _PASSWORD are not set in .env');
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('response', async (r) => {
    if (!/2fa/i.test(r.url())) return;
    let b = ''; try { b = clean(await r.text()); } catch { /* */ }
    console.log(`  [api] ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${clean(r.request().postData() || '')} -> ${b.slice(0, 120)}`);
  });

  try {
    console.log(`logging in as ${EMAIL}`);
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);

    if (/\/verify-otp/.test(page.url())) {
      console.log('login 2FA challenge is up — answering it');
      if (!SECRET) throw new Error('2FA is ON and no secret was supplied. Pass it: node scripts/reset-2fa-agent.js <SECRET>');
      await fillOtp(page, await freshUnusedCode(SECRET));
      await page.getByRole('button', { name: /^verify$/i }).first().click();
      await page.waitForTimeout(8000);
    }
    console.log('landed on', page.url());

    await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /^security$/i }).first().click({ timeout: 30000 });
    await page.waitForTimeout(2500);
    const toggle = page.locator('input[role="switch"]').first();
    if (!(await toggle.isChecked())) { console.log('2FA is already OFF. Nothing to do.'); return; }

    console.log('turning 2FA off');
    await toggle.click({ force: true });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /turn off 2fa/i }).first().click();
    await page.waitForTimeout(2000);
    if (!SECRET) throw new Error('The disable step wants a code and no secret was supplied.');
    await fillOtp(page, await freshUnusedCode(SECRET));
    await page.getByRole('button', { name: /^confirm$/i }).first().click();
    await page.waitForTimeout(3500);
    console.log('  toast/feedback:', clean(await page.locator('[role="alert"]').first().innerText().catch(() => '(none)')));

    await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /^security$/i }).first().click({ timeout: 30000 });
    await page.waitForTimeout(2500);
    const final = await page.locator('input[role="switch"]').first().isChecked();
    console.log(`FINAL 2FA state: ${final ? 'STILL ON — NOT RESET' : 'OFF (clean)'}`);
    process.exitCode = final ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
