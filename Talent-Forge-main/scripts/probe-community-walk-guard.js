/* eslint-disable no-console */
// probe-community-walk-guard.js — READ-ONLY. Proves collectAllPages()'s completeness guard actually
// FIRES on the bug it was written for, instead of only looking like it would.
//
// WHY THIS EXISTS. The first version of the guard defined `complete` as "did not hit the max cap",
// which meant the exit condition "no next-page control was found" — the exact string produced by the
// broken `getByRole('button', {name: /^next$/i})` locator — counted as a COMPLETE walk. The
// assertion would have passed on the very defect it was added to catch, and nothing in a green run
// would have said so. A guard that has never been observed failing is not a guard.
//
// So this runs the same walk twice against the same page:
//   A. with the CURRENT locator            -> expect complete, 127 items, 11 pages
//   B. with the OLD BROKEN locator injected -> expect NOT complete, 12 items, 1 page
// Case B is the regression test. If it reports complete, the guard is useless again.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const c = new CommunityPage(page);

  console.log('\n===== A. current locator =====');
  await c.gotoList();
  const a = await c.collectAllPages(() => c.readCards(), 16);
  console.log(`  items: ${a.length}`);
  console.log(`  walk : ${c.walkSummary()}`);
  console.log(`  complete: ${c.lastWalk.complete}`);

  console.log('\n===== B. the OLD broken locator, re-injected =====');
  await c.gotoList();
  // Exactly what it used to be: an anchored name match against a button whose accessible name is
  // "Next Page", so it resolves to nothing.
  c.nextPage = page.getByRole('button', { name: /^next$/i }).first();
  const b = await c.collectAllPages(() => c.readCards(), 16);
  console.log(`  items: ${b.length}`);
  console.log(`  walk : ${c.walkSummary()}`);
  console.log(`  complete: ${c.lastWalk.complete}`);

  console.log('\n===== VERDICT =====');
  const ok = a.length > b.length && c.lastWalk.complete === false;
  console.log(ok
    ? `  PASS — the guard distinguishes them (${a.length} complete vs ${b.length} flagged truncated).`
    : '  FAIL — the guard did NOT flag the broken-locator walk. It would hide this defect again.');

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
