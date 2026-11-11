// Read-only probe #3 for /verifications: the ONE question probes #1 and #2 left genuinely open -
// are the row's View / Download actions operable from the keyboard?
//
// >>> THIS EXISTS BECAUSE A TAB-ONLY WALK ANSWERS "NO" ON A GRID THAT IS PERFECTLY FINE. <<<
// react-aria tables use a roving tabindex: the ROW is a single tab stop and the cells inside it
// are reached with the ARROW KEYS. A 40-press Tab walk therefore never lands on View or
// Download, which reads as "the row actions are unreachable" - the same wrong conclusion the
// dashboard "View all" audit would have reached if it had not taken a control.
//
// So this walks Tab to the row and then drives the grid the way its own interaction model says
// to, and reports BOTH answers separately.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);

const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return 'none';
  return a.tagName + '[' + (a.getAttribute('role') || '-') + ']:'
    + (a.getAttribute('aria-label') || a.getAttribute('data-testid') || a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const settle = (ms = 3500) => page.waitForTimeout(ms);

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started|\/verifications/, { timeout: 90000, waitUntil: 'commit' });
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(5000);

  console.log('=== 1. Tab to the grid ===');
  await page.locator('input[type="search"]').focus();
  let landedOnRow = false;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const a = await active(page);
    if (/^TR\[row\]/.test(a)) { console.log('reached the row after ' + (i + 1) + ' Tab presses:', a.slice(0, 60)); landedOnRow = true; break; }
  }
  if (!landedOnRow) { console.log('never reached a row by Tab'); }

  console.log('\n=== 2. ARROW-KEY navigation inside the row (the grid interaction model) ===');
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(220);
    seen.push(await active(page));
  }
  console.log(J(seen));
  console.log('did ArrowRight reach the Actions cell?', seen.some((s) => /Actions|View|Download/i.test(s)));

  console.log('\n=== 3. from the Actions CELL, can the two buttons be focused? ===');
  const inCell = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    inCell.push('ArrowDown -> ' + await active(page));
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    inCell.push('Tab -> ' + await active(page));
  }
  console.log(J(inCell));

  console.log('\n=== 4. DIRECT: can View be focused and activated by keyboard at all? ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4500);
  const view = page.locator('tbody tr:first-child [data-testid="agent-verifications-view-button"]');
  await view.focus().catch(() => {});
  console.log('after .focus() the active element is:', await active(page));
  console.log('is it the View button?', await view.evaluate((b) => document.activeElement === b).catch(() => false));
  await page.keyboard.press('Enter');
  await settle(2500);
  console.log('Enter on the focused View -> dialogs open:', await page.locator('[role="dialog"]').count());
  await page.keyboard.press('Escape');
  await settle(1200);

  console.log('\n=== 5. Download by keyboard ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4500);
  const down = page.locator('tbody tr:first-child [data-testid="agent-verifications-download-button"]');
  await down.focus().catch(() => {});
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.keyboard.press('Enter');
  const got = await dl;
  console.log('Enter on the focused Download -> download:', got ? got.suggestedFilename() : 'NONE');

  console.log('\n=== 5b. THE DECIDING TEST: arrow to each action, then press Enter ===');
  for (const want of ['View', 'Download']) {
    await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
    await settle(4500);
    await page.locator('input[type="search"]').focus();
    for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); if (/^TR\[row\]/.test(await active(page))) break; }
    let reached = false;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(220);
      if (new RegExp(':' + want + '$').test(await active(page))) { reached = true; break; }
    }
    console.log(want + ': reached by arrow keys?', reached, '| focused:', await active(page));
    if (!reached) continue;
    if (want === 'View') {
      await page.keyboard.press('Enter');
      await settle(3000);
      console.log('  Enter -> dialogs open:', await page.locator('[role="dialog"]').count());
      await page.keyboard.press('Escape');
    } else {
      const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await page.keyboard.press('Enter');
      const g = await dl;
      console.log('  Enter -> download:', g ? g.suggestedFilename() : 'NONE');
    }
  }

  console.log('\n=== 6. the row itself: does Enter on the row open anything? ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4500);
  await page.locator('tbody tr').first().focus().catch(() => {});
  console.log('row focused:', await active(page));
  await page.keyboard.press('Enter');
  await settle(2000);
  console.log('Enter on the row -> dialogs:', await page.locator('[role="dialog"]').count(), '| url:', decodeURIComponent(page.url()).replace(origin, ''));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
