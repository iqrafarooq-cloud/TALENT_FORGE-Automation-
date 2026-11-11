// probe-onboarding-reopen-loop.js - the card-and-text-link table drives openChooserFromDashboard
// FOUR times in one scenario, and the fourth pass reported the WELCOME modal where the Share
// Agent Code modal should have been. This replays exactly that loop through the real page object
// and dumps every dialog on screen at each step, so the cause is measured rather than guessed.
//
// Read-only: it opens modals only.
require('dotenv').config();
const { chromium } = require('playwright');
const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');
const line = console.log;

async function dialogs(page) {
  const d = page.locator('[role="dialog"]');
  const out = [];
  for (let i = 0; i < await d.count(); i++) {
    const el = d.nth(i);
    out.push({
      i,
      visible: await el.isVisible().catch(() => false),
      text: (await el.innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 70),
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const ob = new CandidateOnboardingPage(page);
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_EMAIL);
    await page.locator('input[name="password"]').first().fill(process.env.REFERRAL_NOPROMO_AGENT_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' });

    const plan = [
      ['Invite via Email', 'card'], ['Invite via Email', 'link'],
      ['Share Agent Code', 'card'], ['Share Agent Code', 'link'],
    ];
    for (const [method, via] of plan) {
      line(`\n===== pass: ${method} via its ${via} =====`);
      const t0 = Date.now();
      await ob.openChooserFromDashboard();
      line(`  openChooserFromDashboard took ${Date.now() - t0}ms; flag=${JSON.stringify(await ob.welcomeSuppressionFlag())}`);
      line(`  dialogs after opening the chooser: ${JSON.stringify(await dialogs(page))}`);
      let err = null;
      try {
        await ob.chooseMethod(method, { via });
      } catch (e) { err = e.message.split('\n')[0]; }
      line(`  chooseMethod error: ${JSON.stringify(err)}`);
      line(`  dialogs after chooseMethod:        ${JSON.stringify(await dialogs(page))}`);
      line(`  openModal() says: ${JSON.stringify(await ob.openModal())}   renderedTitle: ${JSON.stringify(await ob.renderedTitle())}`);
      line(`  per-modal isVisible: ${JSON.stringify({
        welcome: await ob.modal('welcome').isVisible().catch(() => 'err'),
        chooser: await ob.modal('chooser').isVisible().catch(() => 'err'),
        agentCode: await ob.modal('agentCode').isVisible().catch(() => 'err'),
        invite: await ob.modal('invite').isVisible().catch(() => 'err'),
      })}`);
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
