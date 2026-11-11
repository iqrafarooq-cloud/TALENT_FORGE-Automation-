// probe-promo-nopromo-fixture-state.js — READ ONLY. Does either no-promo fixture agent now hold a
// promo code, and does merely OPENING the Add modal create one?
//
//   node scripts/probe-promo-nopromo-fixture-state.js
//
// Why this exists. The Add-modal scenario only ever cancels, yet its final assertion reported that
// a promo had been created for the no-promo agent — while the scenario's own opening step had
// already confirmed the agent had none. Something between those two points creates the record. The
// prime suspect is the promo code NAME: the modal opens showing "—" and about a second later the
// app fills in a generated code (PROMOHKMSBR, PROMO5GXTVY, PROMO2VZTYJ...), which looks like a
// server-side create rather than a client-side placeholder — and would also explain where the
// Expiry Date (+45 days) and Usage Limit (30) that appear unbidden in that form come from.
//
// Complicating this: CLAUDE.md records that REFERRAL_NOPROMO_AGENT_NAME and
// REFERRAL_NOPROMO_AGENT_EMAIL resolve to DIFFERENT agents (/agents/view/1058 vs /agents/view/1021).
// The suite drives the NAME. So both are checked here, and the agent id is printed for each.
//
// READ ONLY: opens tabs, opens the Add modal once, waits, and cancels. It never clicks Save.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const BY_NAME = process.env.REFERRAL_NOPROMO_AGENT_NAME;
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

  const inspect = async (label, term) => {
    if (!term) return console.log(`\n${label}: not configured in .env`);
    console.log(`\n=== ${label}: "${term}" ===`);
    const hasPromo = await admin.openPromoToolsAllowingEmpty(term);
    console.log(`  url            : ${page.url()}`);
    console.log(`  has promo      : ${hasPromo}`);
    const empty = await admin.readEmptyState();
    console.log(`  empty state    : ${JSON.stringify(empty)}`);
    if (hasPromo) {
      console.log(`  promo code     : ${JSON.stringify(await admin.readPromoCode().catch(() => null))}`);
      for (const f of ['Status', 'Incentive Type', 'Value', 'Expiry Date', 'Usage Limit']) {
        console.log(`  ${f.padEnd(15)}: ${JSON.stringify(await admin.readParameter(f).catch(() => null))}`);
      }
    }
    return hasPromo;
  };

  const nameHas = await inspect('by REFERRAL_NOPROMO_AGENT_NAME (what the suite drives)', BY_NAME);
  await inspect('by REFERRAL_NOPROMO_AGENT_EMAIL (what .env records)', BY_EMAIL);

  // Does opening the modal create the record? Only worth asking on an agent that still has none.
  const stillEmpty = nameHas === false ? BY_NAME : (await inspect('re-check email fixture', BY_EMAIL)) === false ? BY_EMAIL : null;
  console.log('\n=== does merely OPENING the Add modal create a promo? ===');
  if (!stillEmpty) {
    console.log('  SKIPPED — neither fixture is empty any more, so the question cannot be asked '
      + 'without a throwaway agent.');
  } else {
    await admin.openPromoToolsAllowingEmpty(stillEmpty);
    await admin.openAddParameters();
    const nameField = admin.modal.locator('input[type="text"]').first();
    for (const ms of [0, 1500, 3000]) {
      if (ms) await page.waitForTimeout(1500);
      console.log(`  t+${ms}ms  promo name field = ${JSON.stringify(await nameField.inputValue().catch(() => null))}`);
    }
    await admin.cancelEdit();
    await page.waitForTimeout(1000);
    const after = await admin.openPromoToolsAllowingEmpty(stillEmpty);
    console.log(`  after opening the modal and CANCELLING, agent has promo: ${after}`);
    console.log(`  empty state now: ${JSON.stringify(await admin.readEmptyState())}`);
    if (after) {
      console.log(`  promo code left behind: ${JSON.stringify(await admin.readPromoCode().catch(() => null))}`);
      console.log('  ^^ opening the Add modal CREATES the promo server-side. Cancel does not undo it.');
    }
  }

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
