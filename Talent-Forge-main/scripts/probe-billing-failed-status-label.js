// probe-billing-failed-status-label.js — READ ONLY. What does the Subscription tab's Billing
// History render for a FAILED payment, and does the grid paint skeleton rows first?
//
//   node scripts/probe-billing-failed-status-label.js
//
// Two questions, and the second one has to be answered before the first means anything:
//
//  1. THE GRID PAINTS 10 EMPTY SKELETON ROWS BEFORE ITS DATA ARRIVES. They carry role="row" and
//     the grid is already visible, so "the grid is visible" and "it has rows" are both TRUE while
//     every cell is still blank - and a status read taken then returns "" for a perfectly good
//     Paid row. Any settle condition here must therefore key on CELL CONTENT, and on a cell that
//     exists whatever the status (the date), never on the status badge itself - waiting for the
//     badge would hang for exactly the case being investigated.
//  2. Only once settled is it meaningful to ask whether the app has a LABEL for a failed payment.
//     The app title-cases the API enum for PAID/PENDING/CANCELED, so this drives the stub with a
//     series of plausible failure tokens and reports the rendered cell for each.
//
// NOTE: the password key really is misspelled CANDIDTAE_PASSWORD in .env; steps/subscription.js
// reads the same key, so matching the typo is correct here rather than "fixing" one caller.
//
// READ ONLY: intercepts responses in the browser only. Changes nothing server-side.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const TOKENS = ['FAILED', 'PAYMENT_FAILED', 'DECLINED', 'FAILURE', 'UNPAID', 'ERROR', 'REFUNDED'];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const page = await (await browser.newContext()).newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.CANDIDATE_EMAIL);
  await login.passwordInput.first().fill(process.env.CANDIDTAE_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/getting-started|\/profile/, { timeout: 90000, waitUntil: 'commit' });

  const sub = new SubscriptionPage(page);

  // Settle on the DATE cell holding text - present on every row whatever the payment status.
  const settle = async () => {
    await sub.billingGrid.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => {
      const groups = document.querySelectorAll('[role="grid"] [role="rowgroup"]');
      const body = groups[groups.length - 1];
      const first = body && body.querySelector('[role="row"]');
      const date = first && first.querySelector('[data-column-index="0"]');
      return !!(date && date.textContent.trim().length);
    }, null, { timeout: 25000 }).catch(() => {});
  };
  const read0 = async () => ({
    cell: await sub.billingRowStatus(0).catch(() => '(unreadable)'),
    badge: await sub.billingRows.first().locator('.status-badge-label').innerText().catch(() => '(no badge)'),
    actions: await sub.billingRowActionStates(0).catch(() => ({})),
  });

  await sub.gotoSubscriptionTab();
  console.log('\n=== BEFORE settling (what the scenario currently reads) ===');
  await sub.billingGrid.waitFor({ state: 'visible', timeout: 20000 });
  console.log(`  row 0: ${JSON.stringify(await read0())}`);
  await settle();
  console.log('\n=== AFTER settling, REAL data ===');
  console.log(`  row 0: ${JSON.stringify(await read0())}`);
  console.log(`  all statuses: ${JSON.stringify(await sub.allBillingRowStatuses())}`);

  console.log('\n=== what the grid renders for each INJECTED status token (settled) ===');
  for (const token of TOKENS) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await sub.stubGracePeriod({ failedStatus: token });
    await sub.gotoSubscriptionTab();
    await settle();
    const got = await read0();
    console.log(`  ${token.padEnd(16)} -> cell=${JSON.stringify(got.cell)} badge=${JSON.stringify(got.badge)} actions=${JSON.stringify(got.actions)}`);
  }

  await browser.close();
})();
