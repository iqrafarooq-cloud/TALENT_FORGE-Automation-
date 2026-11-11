// probe-upgrade-promo.js — reproduce the "@e2e @change-plan @upgrade @payment @provision"
// failure: after applying a promo on the UPGRADE invoice, Continue never reaches PayTabs
// (payWithTestCard times out waiting for the card-number field).
//
// Dev-only. Provisions a fresh candidate, subscribes+pays Monthly, then walks the
// upgrade-to-Yearly path one stage at a time, dumping URL / totals / button state after
// each so we can see WHERE it stalls.
//
//   node scripts/probe-upgrade-promo.js
require('dotenv').config();
const { chromium } = require('playwright');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate, subscribeAndPay } = require('../utils/subscriptionProvision');

// PROBE_PROMO=none -> skip the promo entirely (isolates whether the promo triggers the 500).
const PROMO = process.env.PROBE_PROMO === 'none' ? null : (process.env.PROBE_PROMO || 'TEST200');
const TARGET = process.env.PROBE_TARGET_PLAN || 'Yearly';

const log = (...a) => console.log('[probe]', ...a);

async function dump(page, label) {
  log(`--- ${label} ---`);
  log('    url:', page.url());
  for (const [name, re] of [
    ['Subtotal', /^Subtotal$/i],
    ['Total due today', /^Total due today$/i],
    ['Discount', /^discount\b/i],
  ]) {
    const el = page.getByText(re).first();
    if (await el.isVisible().catch(() => false)) {
      const val = await el.locator('xpath=following-sibling::*[1]').textContent().catch(() => '');
      log(`    ${name}:`, (val || '').trim() || '(no sibling value)');
    }
  }
  const cont = page.getByRole('button', { name: /^continue$/i }).first();
  if (await cont.isVisible().catch(() => false)) {
    log('    Continue: visible, enabled =', await cont.isEnabled().catch(() => '?'));
  } else {
    log('    Continue: not visible');
  }
  const remove = page.getByRole('button', { name: /^remove$/i }).first();
  log('    promo Remove visible:', await remove.isVisible().catch(() => false));
  const err = page.getByText(/invalid or expired promotion code/i).first();
  log('    promo error visible:', await err.isVisible().catch(() => false));
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (r) => {
    const u = r.url();
    if (!/promo|coupon|subscri|checkout|payment|paytabs/i.test(u)) return;
    log('    <net>', r.status(), r.request().method(), u.slice(0, 140));
    if (r.status() >= 400) {
      const reqBody = r.request().postData();
      if (reqBody) log('        req :', reqBody.slice(0, 400));
      const body = await r.text().catch(() => '');
      log('        resp:', body.slice(0, 500));
    }
  });

  const world = { page, pages: { subscription: new SubscriptionPage(page) } };
  const sub = world.pages.subscription;

  try {
    log('provisioning fresh candidate...');
    await provisionFreshCandidate(world);
    log('fresh candidate:', world._freshEmail);

    log('subscribing + paying Monthly...');
    await subscribeAndPay(world, 'Monthly');
    log('Monthly active.');

    await sub.gotoSubscriptionTab();
    log('state:', await sub.currentState());

    log('opening Change Plan modal...');
    await sub.openChangePlan();
    log('choosing', TARGET, 'and continuing...');
    await sub.chooseChangePlan(TARGET);
    await page.waitForURL(/\/subscribe\/checkout/, { timeout: 30000 });
    await dump(page, 'on upgrade invoice (pre-promo)');

    if (PROMO) {
      log('applying promo', PROMO, '...');
      await sub.applyPromo(PROMO);
      // Deliberately DO NOT wait — mirror the current upgradeWithPayment() timing.
      await dump(page, 'immediately after Apply click (what upgradeWithPayment sees)');

      await page.waitForTimeout(3000);
      await dump(page, '3s after Apply');
    } else {
      log('NO promo (PROBE_PROMO=none) — isolating the upgrade path');
    }

    log('clicking Continue...');
    await sub.continueButton.click();

    for (const ms of [2000, 5000, 10000, 15000]) {
      await page.waitForTimeout(ms);
      log(`+${ms}ms -> url:`, page.url());
      if (/paytabs/i.test(page.url())) { log('REACHED PAYTABS'); break; }
    }

    if (!/paytabs/i.test(page.url())) {
      await dump(page, 'STALLED — never reached PayTabs');
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      log('--- visible page text (first 1500 chars) ---');
      log(body.slice(0, 1500));
      await page.screenshot({ path: 'reports/probe-upgrade-promo-stalled.png', fullPage: true });
      log('screenshot -> reports/probe-upgrade-promo-stalled.png');
    }
  } catch (e) {
    log('ERROR:', e.message);
    log('url at error:', page.url());
    await page.screenshot({ path: 'reports/probe-upgrade-promo-error.png', fullPage: true }).catch(() => {});
  } finally {
    await page.waitForTimeout(2000);
    await context.close();
    await browser.close();
  }
})();
