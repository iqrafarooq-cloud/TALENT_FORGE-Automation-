// provision-no-candidate-agent.js — mint a DEDICATED agent that has never invited a candidate,
// and print the .env block to paste in.
//
// WHY THIS EXISTS
// Two unrelated groups of scenarios need an agent whose candidate count is 0:
//   * features/Agent_Portal/inprogress-search_filters.feature — the In Progress empty state
//   * features/Agent_Portal/invite-candidate_welcome_onboarding.feature — the first-time welcome
//     modal, which the app renders for any agent with 0 candidates
// Both used to borrow REFERRAL_NOPROMO_AGENT, which exists for a completely different property
// (it has no PROMO CODE, for TFF-43 §10). That double duty is what made it fragile: on
// 2026-08-27 a scenario in candidate_onboarding_e2e.feature sent a real invitation as that agent
// and its candidate count went to 1 — permanently, because THERE IS NO WAY TO DELETE A CANDIDATE.
// Both groups of scenarios broke at once, for a reason that looks nothing like the cause.
//
// So the zero-candidate property gets its own account. REFERRAL_NOPROMO_AGENT keeps only the
// no-promo property, which nothing here can spend.
//
// >>> THE ACCOUNT THIS MINTS IS SPENT THE FIRST TIME ANYTHING INVITES AS IT. <<< Nothing in the
// suite should: `inviteFixtureGuard()` in invite-candidate.steps.js refuses to send as any agent
// that was not provisioned by the running scenario. If you ever need to re-mint one, run this
// again and replace the .env block.
//
// Costs one live superadmin invite + one IMAP round trip. No payments.
require('dotenv').config();
const { chromium } = require('playwright');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    console.log('Inviting a fresh agent (no promo code, no candidates)...');
    const agent = await provisionAgentWithoutPromo(browser, {
      label: 'no-candidate-fixture',
      firstName: 'Nocand',
      tagPrefix: 'nocand',
    });

    // Prove the property the fixture exists for, rather than assuming a fresh agent has it.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(agent.email);
    await page.locator('input[name="password"]').first().fill(agent.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard/, { timeout: 90000, waitUntil: 'commit' });
    const welcomeUp = await page
      .locator('[role="dialog"]')
      .filter({ hasText: /Everything starts with onboarding your candidates/i })
      .first()
      .waitFor({ state: 'visible', timeout: 40000 })
      .then(() => true)
      .catch(() => false);
    const total = await page.evaluate(() => {
      for (const el of document.querySelectorAll('p, h3')) {
        if ((el.textContent || '').trim() !== 'Total Candidates') continue;
        const next = el.nextElementSibling;
        const raw = next ? (next.textContent || '').trim() : null;
        if (raw && /^-?[\d,]+$/.test(raw)) return raw;
      }
      return null;
    });
    await ctx.close();

    console.log('\nVerified against the live app:');
    console.log(`  Total Candidates:            ${JSON.stringify(total)}`);
    console.log(`  first-time welcome modal up: ${welcomeUp}`);
    if (total !== '0' || !welcomeUp) {
      console.log('\n!! This account does NOT have the property the fixture needs. Do not record it.');
      process.exitCode = 1;
      return;
    }

    console.log('\nPaste this into .env (replacing any earlier NO_CANDIDATE_AGENT_* block):\n');
    console.log(`NO_CANDIDATE_AGENT_EMAIL=${agent.email}`);
    console.log(`NO_CANDIDATE_AGENT_PASSWORD=${agent.password}`);
    console.log(`NO_CANDIDATE_AGENT_NAME=${agent.name}`);
  } catch (err) {
    console.error('FAILED: ' + err.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
