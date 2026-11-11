// probe-onboarding-methods.js - discover the agent dashboard's candidate-onboarding modal stack:
// the entry control, the "Choose how you want to onboard your candidates:" chooser, and the
// Share Agent Code / Send Onboarding Invite modals it opens.
//
// Read-only: it opens modals and closes them. It NEVER clicks Send Invites, so nothing is
// invited and no fixture is disturbed.
require('dotenv').config();
const { chromium } = require('playwright');

const EMAIL = process.env.AGENT_EMAIL;
const PASSWORD = process.env.AGENT_PASSWORD;

function line(t) { console.log(t); }

async function dumpDialogs(page, label) {
  line(`\n===== ${label} =====`);
  const dialogs = page.locator('[role="dialog"]');
  const n = await dialogs.count();
  line(`role=dialog count: ${n}`);
  for (let i = 0; i < n; i++) {
    const d = dialogs.nth(i);
    const visible = await d.isVisible().catch(() => false);
    line(`\n-- dialog[${i}] visible=${visible}`);
    if (!visible) continue;
    line(`   text: ${JSON.stringify((await d.innerText().catch(() => '')).replace(/\n/g, ' | '))}`);
    const html = await d.evaluate((el) => el.outerHTML).catch(() => '');
    line(`   html (${html.length} chars):\n${html.slice(0, 6000)}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|candidates|getting-started/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(4000);
    line(`URL after login: ${page.url()}`);

    await dumpDialogs(page, 'immediately after login (welcome modal?)');

    // Every button on the dashboard, so the entry control is visible rather than guessed.
    line('\n===== all visible buttons on the dashboard =====');
    const buttons = page.locator('button, [role="button"], a');
    const bn = await buttons.count();
    for (let i = 0; i < bn; i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const txt = (await b.innerText().catch(() => '')).trim().replace(/\n/g, ' / ');
      const aria = await b.getAttribute('aria-label').catch(() => null);
      const tid = await b.getAttribute('data-testid').catch(() => null);
      if (!txt && !aria) continue;
      line(`  [${i}] text=${JSON.stringify(txt.slice(0, 60))} aria=${JSON.stringify(aria)} testid=${JSON.stringify(tid)}`);
    }

    line('\n===== page text =====');
    line((await page.locator('body').innerText()).slice(0, 3000));
  } catch (err) {
    line(`PROBE ERROR: ${err.message}`);
  } finally {
    await context.close();
    await browser.close();
  }
})();
