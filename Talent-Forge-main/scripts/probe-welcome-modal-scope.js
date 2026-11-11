// probe-welcome-modal-scope.js - what scope does dismissing the welcome modal have? Per page
// load, per auth token, or per browser context? Two scenarios in
// invite-candidate_welcome_onboarding.feature turn on the answer.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;
const EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL, PASSWORD = process.env.PROMO_LIMITED_AGENT_PASSWORD;

async function login(page) {
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
}

// Poll for up to 20s: "the modal is absent" must be a settled fact, not a read taken too early.
async function modalUp(page, waitMs = 20000) {
  const dlg = page.locator('[role="dialog"]').filter({ hasText: /Welcome,/ }).first();
  try { await dlg.waitFor({ state: 'visible', timeout: waitMs }); return true; } catch { return false; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on('request', (r) => {
    if (/talentforge/.test(r.url()) && !/\.(js|css|png|svg|woff2?)/.test(r.url())) {
      calls.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${(r.postData() || '').slice(0, 120)}`);
    }
  });
  try {
    await login(page);
    line(`1. after first login: modal up = ${await modalUp(page)}`);

    calls.length = 0;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    line(`2. after Escape: modal up = ${await modalUp(page, 3000)}`);
    line(`   requests fired by the dismissal: ${JSON.stringify(calls, null, 1)}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    line(`3. after reload (same context, same token): modal up = ${await modalUp(page)}`);

    await page.goto(new URL('/candidates/in-progress', process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.goto(new URL('/dashboard', process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' });
    line(`4. after navigating away and back: modal up = ${await modalUp(page)}`);

    // Log out through the UI, then log back in on the SAME context.
    await page.locator('header button[aria-haspopup="menu"]:not([aria-label]), header button.rounded-full:not([aria-label])').first().click().catch(() => {});
    await page.waitForTimeout(1000);
    const out = page.getByRole('menuitemradio', { name: /log ?out/i }).or(page.getByRole('menuitem', { name: /log ?out/i })).first();
    if (await out.isVisible().catch(() => false)) {
      await out.click();
      await page.waitForURL(/login/, { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(1500);
      await login(page);
      line(`5. after UI logout + login again (same context, NEW token): modal up = ${await modalUp(page)}`);
    } else {
      line('5. could not find the logout menu item; skipped');
    }

    // Clearing cookies only, same context.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await ctx.clearCookies();
    await login(page);
    line(`6. after clearCookies + login (same context): modal up = ${await modalUp(page)}`);
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
