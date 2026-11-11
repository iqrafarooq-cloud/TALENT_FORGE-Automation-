// probe-promo-tab-load-race.js — READ ONLY. Does the Promo Tools tab of an agent that HAS a promo
// transiently render the no-promo empty state while it loads?
//
//   node scripts/probe-promo-tab-load-race.js
//
// Why. openPromoToolsAllowingEmpty() decides "does this agent have a promo" by racing the "Edit
// parameters" button against the "Add Promo Code" CTA and then reading editParametersButton
// .isVisible() — which does NOT wait. If the tab paints its empty state first and swaps in the promo
// once the fetch lands, that read is taken during the empty render and answers `false` for an agent
// that plainly has a promo. Every downstream symptom of the two Case 4 failures follows from that:
// the empty-state assertion (isVisible, also no wait) passes, the Add CTA is clicked, and by the
// time the modal opens the data HAS landed — so it opens titled "Edit Code Parameters", prefilled.
//
// Samples the tab every 150ms from the moment the tab is clicked, on an agent known to hold a promo.
// READ ONLY: never opens a modal, never saves.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const WITH_PROMO = process.env.PROMO_UNLIMITED_AGENT_NAME || process.env.PROMO_UNLIMITED_AGENT_EMAIL;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 0 });
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

  await admin.openAgent(WITH_PROMO);
  console.log(`\n=== ${page.url()} — an agent that HOLDS a promo (${WITH_PROMO}) ===`);
  await admin.promoToolsTab.click();

  const t0 = Date.now();
  for (let i = 0; i < 24; i += 1) {
    const [edit, add, msg, addCount] = await Promise.all([
      admin.editParametersButton.isVisible().catch(() => null),
      admin.addPromoCodeButton.isVisible().catch(() => null),
      admin.noPromoEmptyState.isVisible().catch(() => null),
      page.getByRole('button', { name: /add promo code/i }).count().catch(() => null),
    ]);
    console.log(`  t+${String(Date.now() - t0).padStart(5)}ms  editParameters=${edit}  addCTA=${add}  `
      + `"No code parameters set"=${msg}  /add promo code/i controls=${addCount}`);
    await page.waitForTimeout(150);
  }

  // What openPromoToolsAllowingEmpty() itself answers — the question the Given step asks. Run
  // against BOTH an agent that holds a promo (must answer true) and the no-promo fixture (must
  // answer false), because a settle that simply waits longer would get the first right and the
  // second wrong.
  const check = async (label, term, truth) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const verdict = await admin.openPromoToolsAllowingEmpty(term);
      const empty = await admin.readEmptyState();
      console.log(`\n  ${label} attempt ${attempt}: hasPromo=${verdict} (truth: ${truth}) `
        + `${verdict === truth ? 'OK' : '<-- WRONG'}  api=${admin.promotionPayloadSummary()}  `
        + `readEmptyState()=${JSON.stringify(empty)}`);
    }
  };
  await check('agent WITH promo   ', WITH_PROMO, true);
  await check('no-promo fixture   ', process.env.REFERRAL_NOPROMO_AGENT_EMAIL, false);

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
