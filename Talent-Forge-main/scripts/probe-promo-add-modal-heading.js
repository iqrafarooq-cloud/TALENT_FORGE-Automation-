// probe-promo-add-modal-heading.js — READ ONLY. Why do the two Case 4 scenarios fail in a full run
// and pass when run on their own?
//
//   node scripts/probe-promo-add-modal-heading.js
//
// Two failures to explain, both from reports/cucumber-report.json (2026-08-01 18:25):
//   1. `modal is titled "Edit Code Parameters", not "Add Code Parameters"` — while every other field
//      in the inventory was exactly right.
//   2. `cancelling the Add Code Parameters modal created a promo for NoPromo QA` — while a targeted
//      re-run of the same scenario an hour later found the agent still empty.
//
// FIRST PASS ALREADY ANSWERED (2): the suite searches the agents list for the NAME "NoPromo QA",
// and that matches TEN rows — every throwaway `provisionAgentWithoutPromo()` has ever minted is
// named "Nopromo Qa<random>", so "nopromo qa" is a prefix of all of them. `.first()` resolved to
// /agents/view/1069, a throwaway, not the /agents/view/1021 fixture `.env` records.
//
// This pass answers (1): which control the "Add Promo Code" locator actually resolves to, and what
// heading each candidate opens.
//
// READ ONLY: opens modals and cancels. Never clicks Save.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const BY_EMAIL = process.env.REFERRAL_NOPROMO_AGENT_EMAIL;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  const admin = new AdminPromoToolsPage(page);

  // Drive the fixture `.env` records, by EMAIL, so the ambiguous-name problem cannot confuse this.
  const hasPromo = await admin.openPromoToolsAllowingEmpty(BY_EMAIL);
  console.log(`\n=== ${page.url()} (REFERRAL_NOPROMO_AGENT_EMAIL) — has promo: ${hasPromo} ===`);
  console.log(`  empty state: ${JSON.stringify(await admin.readEmptyState())}`);
  await page.waitForTimeout(2000);

  // ---- Every control the "Add Promo Code" locator could resolve to ----
  const candidates = page.getByRole('button', { name: /add promo code/i });
  const n = await candidates.count();
  console.log(`\n=== controls matching /add promo code/i: ${n} ===`);
  for (let i = 0; i < n; i += 1) {
    const c = candidates.nth(i);
    const info = await c.evaluate((el) => ({
      tag: el.tagName,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      aria: el.getAttribute('aria-label'),
      cls: (el.className || '').toString().slice(0, 90),
      box: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
      parentText: (el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })).catch(() => null);
    console.log(`  [${i}] ${JSON.stringify(info)}`);
  }
  console.log(`  data-testid="add-promo-code" count: ${await page.locator('[data-testid="add-promo-code"]').count()}`);

  // ---- Open each one and read the heading it produces ----
  for (let i = 0; i < n; i += 1) {
    console.log(`\n=== opening candidate [${i}] ===`);
    await candidates.nth(i).click({ timeout: 20000 }).catch((e) => console.log(`  click failed: ${e.message.split('\n')[0]}`));
    const opened = await admin.modal.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!opened) { console.log('  no dialog opened'); continue; }
    const dialogs = await page.locator('[role="dialog"]').count();
    const nameField = admin.modal.locator('input[type="text"]').first();
    const sample = async (label) => {
      const headings = await admin.modal.getByRole('heading').allInnerTexts().catch(() => []);
      console.log(`  ${label.padEnd(9)} dialogs=${dialogs} headings=${JSON.stringify(headings.map((h) => h.trim()))} `
        + `name=${JSON.stringify(await nameField.inputValue().catch(() => null))} `
        + `expiry=${JSON.stringify(await admin.expiryDateInput.inputValue().catch(() => null))} `
        + `usage=${JSON.stringify(await admin.modal.locator('input[type="text"]').last().inputValue().catch(() => null))} `
        + `save=${await admin.saveButton.isEnabled().catch(() => null)}`);
    };
    await sample('t+0');
    for (const ms of [500, 1000, 1500, 2500, 4000]) {
      await page.waitForTimeout(500);
      await sample(`t+${ms}`);
    }
    await admin.cancelEdit();
    await page.waitForTimeout(1200);
  }

  const after = await admin.openPromoToolsAllowingEmpty(BY_EMAIL);
  console.log(`\n=== after opening those modals and CANCELLING, agent has promo: ${after} ===`);
  console.log(`  empty state now: ${JSON.stringify(await admin.readEmptyState())}`);

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
