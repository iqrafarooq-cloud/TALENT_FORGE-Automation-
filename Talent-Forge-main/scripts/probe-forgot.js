// Dev-only probe: walk the full forgot->reset flow on the live app and dump the
// DOM shape of the /forgot-password and /reset-password pages so selectors can be
// written accurately. Does NOT submit a new password (stops before final submit).
require('dotenv').config();
const { chromium } = require('playwright');
const { latestUid, waitForEmail } = require('../utils/gmailClient');

const LOGIN_URL = process.env.BASE_URL;
const FORGOT_EMAIL = process.env.FORGOT_EMAIL;

async function dump(page, label) {
  const info = await page.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      url: location.href,
      title: document.title,
      inputs: q('input').map((i) => ({
        name: i.name, type: i.type, id: i.id,
        placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label'),
        testid: i.getAttribute('data-testid'),
      })),
      buttons: q('button').map((b) => ({
        text: (b.innerText || '').trim().slice(0, 40),
        ariaLabel: b.getAttribute('aria-label'),
        type: b.type, disabled: b.disabled,
        testid: b.getAttribute('data-testid'),
      })),
      headings: q('h1,h2,h3,h4').map((h) => (h.innerText || '').trim()).filter(Boolean),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
    };
  });
  console.log(`\n================ ${label} ================`);
  console.log(JSON.stringify(info, null, 2));
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const page = await browser.newPage();

  console.log('navigating to login:', LOGIN_URL);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Click the Forgot Password affordance.
  const forgot = page.getByRole('button', { name: /forgot password/i })
    .or(page.getByText(/^forgot password\??$/i)).first();
  await forgot.click();
  await page.waitForURL(/forgot-password/i, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dump(page, 'FORGOT PASSWORD PAGE');

  // Baseline before triggering the email.
  const baseline = await latestUid({ subject: 'Reset your Talentforge password', to: FORGOT_EMAIL });
  console.log('\nbaseline uid:', baseline);

  // Fill email + submit.
  const emailField = page.locator('input[type="email"], input[name="email"], input[type="text"]').first();
  await emailField.fill(FORGOT_EMAIL);
  const submit = page.getByRole('button', { name: /send|reset|submit|continue/i }).first();
  await submit.click();
  await page.waitForTimeout(3000);
  await dump(page, 'FORGOT PASSWORD - AFTER SUBMIT (success message)');

  // Wait for fresh reset email.
  console.log('\nwaiting for reset email...');
  const { uid, link } = await waitForEmail('resetPassword', { to: FORGOT_EMAIL, afterUid: baseline, timeoutMs: 120000 });
  console.log('got email uid', uid, 'link:', link);

  // Open reset page.
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dump(page, 'RESET PASSWORD PAGE');

  console.log('\nprobe complete — leaving browser open 8s');
  await page.waitForTimeout(8000);
  await browser.close();
})().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
