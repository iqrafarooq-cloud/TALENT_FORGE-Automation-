// Dev-only probe: discover (a) rate-limit behavior on repeated reset requests,
// (b) Resend Email cooldown on the check-email screen, (c) how the forgot form
// treats a space-padded / upper-cased email.
require('dotenv').config();
const { chromium } = require('playwright');

const FORGOT_EMAIL = process.env.FORGOT_EMAIL;

async function snap(page, label) {
  const s = await page.evaluate(() => ({
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).map((h) => h.innerText.trim()).filter(Boolean),
    buttons: Array.from(document.querySelectorAll('button')).map((b) => ({ t: b.innerText.trim(), disabled: b.disabled })).filter((b) => b.t),
    alerts: Array.from(document.querySelectorAll('[role="alert"], .notistack-Snackbar, .MuiAlert-message')).map((a) => a.innerText.trim()),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 350),
  }));
  console.log(`\n--- ${label} ---\n${JSON.stringify(s, null, 2)}`);
}

(async () => {
  const origin = new URL(process.env.BASE_URL).origin;
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const page = await browser.newPage();

  // (C) space-padded + uppercase email format handling on the forgot page.
  await page.goto(`${origin}/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const email = page.locator('input[name="email"], input[type="email"], input[type="text"]').first();
  const send = page.getByRole('button', { name: /send reset email|send reset|reset email/i }).first();

  await email.fill('  ' + FORGOT_EMAIL.toUpperCase() + '  ');
  await email.blur();
  await page.waitForTimeout(600);
  console.log('\n[C] padded+upper email -> Send disabled?', await send.isDisabled());

  // (A) repeated requests -> rate limit?
  await email.fill(FORGOT_EMAIL);
  for (let i = 1; i <= 5; i++) {
    if (await send.isDisabled()) { console.log(`[A] attempt ${i}: send disabled, stopping`); break; }
    await send.click();
    await page.waitForTimeout(2500);
    await snap(page, `[A] after submit #${i}`);
    // If we advanced to check-email, (B) inspect Resend cooldown then go back and retry.
    if (/check-email/i.test(page.url())) {
      const resend = page.getByRole('button', { name: /resend email/i }).first();
      console.log(`[B] resend disabled right after landing? ${await resend.isDisabled()}`);
      // click resend a couple times fast
      for (let r = 1; r <= 3; r++) {
        if (await resend.count()) {
          const dis = await resend.isDisabled();
          console.log(`[B] resend attempt ${r}: disabled=${dis}, label="${(await resend.innerText()).trim()}"`);
          if (!dis) { await resend.click(); await page.waitForTimeout(1500); await snap(page, `[B] after resend #${r}`); }
        }
      }
      // go back to forgot to try another fresh request
      await page.goto(`${origin}/forgot-password`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await email.fill(FORGOT_EMAIL);
    }
  }

  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
