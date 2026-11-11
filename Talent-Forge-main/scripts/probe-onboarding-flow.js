// probe-onboarding-flow.js - the whole modal stack driven the way the scenarios drive it, on a
// zero-candidate agent so the welcome modal is in play. Read-only: never sends an invite.
require('dotenv').config();
const { chromium } = require('playwright');
const line = console.log;

const WELCOME = /Welcome,/;
const CHOOSER = /Choose how you want to onboard/;

async function dialogs(page) {
  const d = page.locator('[role="dialog"]');
  const out = [];
  for (let i = 0; i < await d.count(); i++) {
    const el = d.nth(i);
    if (await el.isVisible().catch(() => false)) out.push((await el.innerText()).replace(/\n+/g, ' | ').slice(0, 120));
  }
  return out;
}
async function state(page, label) {
  await page.waitForTimeout(1200);
  line(`  ${label.padEnd(46)} -> ${JSON.stringify(await dialogs(page))}  url=${new URL(page.url()).pathname}`);
}

async function freshLogin(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });
  await page.locator('[role="dialog"]').filter({ hasText: WELCOME }).first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  return { ctx, page };
}

const E = process.env.PROMO_LIMITED_AGENT_EMAIL, P = process.env.PROMO_LIMITED_AGENT_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // --- 1. welcome -> chooser, then outside click on the chooser
    let { ctx, page } = await freshLogin(browser, E, P);
    line('\n===== 1. welcome -> Onboard Candidates -> chooser -> outside click =====');
    await state(page, 'after login');
    await page.locator('[data-testid="agent-onboard-candidates-button"]').click();
    await state(page, 'after Onboard Candidates');
    await page.mouse.click(6, 6);
    await state(page, 'after outside click on the chooser');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await state(page, 'after refresh');
    await ctx.close();

    // --- 2. chooser -> invite modal, and the chooser's X icon
    ({ ctx, page } = await freshLogin(browser, E, P));
    line('\n===== 2. chooser -> Invite via Email (Send Onboarding Invite modal) =====');
    await page.locator('[data-testid="agent-onboard-candidates-button"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="agent-send-onboarding-invite-option"]').click();
    await page.waitForTimeout(1500);
    const inv = page.locator('[role="dialog"]').first();
    line(`  TEXT: ${JSON.stringify((await inv.innerText()).replace(/\n+/g, ' | '))}`);
    const ih = await inv.evaluate((e) => e.outerHTML);
    line(`  HTML:\n${ih.slice(0, 6000)}`);
    line('\n  buttons + inputs:');
    for (const sel of ['button', 'input', 'textarea']) {
      const l = inv.locator(sel);
      for (let i = 0; i < await l.count(); i++) {
        const el = l.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        line(`   ${sel}[${i}] ` + JSON.stringify(await el.evaluate((e) => ({
          text: (e.innerText || '').trim().slice(0, 40), aria: e.getAttribute('aria-label'),
          testid: e.getAttribute('data-testid'), ph: e.getAttribute('placeholder'),
          type: e.getAttribute('type'), disabled: e.disabled === true || e.getAttribute('data-disabled') !== null,
        }))));
      }
    }
    // back arrow from the invite modal
    await inv.locator('button[aria-label="Back"]').click();
    await state(page, 'invite modal: after Back');
    await ctx.close();

    // --- 3. chooser's X icon, and the Share Agent Code modal's Back / X
    ({ ctx, page } = await freshLogin(browser, E, P));
    line('\n===== 3. chooser X icon; agent-code Back and X =====');
    await page.locator('[data-testid="agent-onboard-candidates-button"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[role="dialog"] button[aria-label="Close"]').click();
    await state(page, 'chooser: after X');
    // reopen from the Candidates page
    await page.goto(new URL('/candidates/in-progress', process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /^invite candidate$/i }).first().click();
    await state(page, 'after Invite Candidate on /candidates');
    await page.locator('[data-testid="agent-share-agent-code-option"]').click();
    await state(page, 'after Share Agent Code card');
    line(`  code: ${JSON.stringify(await page.locator('[data-testid="agent-code-text-area"]').innerText())}`);
    await page.locator('[role="dialog"] button[aria-label="Back"]').click();
    await state(page, 'agent code: after Back');
    await page.locator('[data-testid="agent-share-agent-code-option"]').click();
    await page.waitForTimeout(800);
    await page.locator('[role="dialog"] button[aria-label="Close"]').click();
    await state(page, 'agent code: after X');
    await ctx.close();

    // --- 4. social share: what does each button do?
    ({ ctx, page } = await freshLogin(browser, E, P));
    line('\n===== 4. social share targets =====');
    await page.locator('[data-testid="agent-onboard-candidates-button"]').click();
    await page.waitForTimeout(900);
    await page.locator('[data-testid="agent-share-agent-code-option"]').click();
    await page.waitForTimeout(1200);
    for (const name of ['Facebook', 'WhatsApp', 'LinkedIn', 'Twitter']) {
      const btn = page.locator('[role="dialog"]').getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
      const popup = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
      await btn.click();
      const p = await popup;
      if (p) { await p.waitForTimeout(1500); line(`  ${name}: opened ${p.url().slice(0, 220)}`); await p.close(); }
      else line(`  ${name}: NO popup opened (url now ${page.url().slice(0, 120)})`);
      await page.waitForTimeout(600);
    }
    await ctx.close();
  } catch (e) { line('ERR ' + e.stack); }
  finally { await browser.close(); }
})();
