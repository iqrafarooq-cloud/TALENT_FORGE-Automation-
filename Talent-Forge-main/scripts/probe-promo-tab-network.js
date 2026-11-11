// probe-promo-tab-network.js — READ ONLY. Which request does the Promo Tools tab wait on, so the
// suite can wait on the same thing instead of reading a half-painted tab?
//
//   node scripts/probe-promo-tab-network.js
//
// probe-promo-tab-load-race.js established that the tab paints the no-promo empty state for ~1s on
// an agent that HAS a promo. The suite needs a settle signal that distinguishes "still loading" from
// "genuinely has no promo" — and the only honest one is the response that decides the render.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const WITH_PROMO = process.env.PROMO_UNLIMITED_AGENT_NAME || process.env.PROMO_UNLIMITED_AGENT_EMAIL;
const WITHOUT_PROMO = process.env.REFERRAL_NOPROMO_AGENT_EMAIL;

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

  const watch = async (label, term) => {
    await admin.openAgent(term);
    console.log(`\n=== ${label}: ${page.url()} ===`);
    const seen = [];
    const onResponse = async (res) => {
      const u = res.url();
      if (!/\/api\/|promo|agent/i.test(u)) return;
      let body = '';
      try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 220); } catch { body = '(unreadable)'; }
      seen.push(`  ${String(res.status())} ${u.replace(/^https?:\/\/[^/]+/, '')}\n      ${body}`);
    };
    page.on('response', onResponse);
    await admin.promoToolsTab.click();
    await page.waitForTimeout(5000);
    page.off('response', onResponse);
    console.log(seen.join('\n') || '  (no matching requests — the tab renders from data already fetched)');
  };

  await watch('agent WITH a promo', WITH_PROMO);
  await watch('agent WITHOUT a promo', WITHOUT_PROMO);

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
