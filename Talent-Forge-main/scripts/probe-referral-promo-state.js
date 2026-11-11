// Read-only: dumps the referral agent's Promo Code widget + share modal, and what the
// app asks each share platform for (window.open recorder, not the popup's landing url).
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
require('dotenv').config();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  // Defaults to the referral agent; pass an email and password to inspect any other agent.
  const EMAIL = process.argv[2] || process.env.REFERRAL_AGENT_EMAIL;
  const PASSWORD = process.argv[3] || process.env.REFERRAL_AGENT_PASSWORD;
  console.log('signing in as:', EMAIL);
  await login.emailInput.first().fill(EMAIL);
  await login.passwordInput.first().fill(PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/verifications|\/activity-log/, { timeout: 90000, waitUntil: 'commit' });
  const ref = new ReferralCodesPage(page);
  await ref.navigate();

  for (const w of ['Agent Code', 'Promo Code']) {
    console.log(`\n--- ${w} widget ---`);
    console.log('  code       :', JSON.stringify(await ref.readCode(w).catch(e => 'ERR ' + e.message)));
    console.log('  copy icon  :', await ref.hasCopyIcon(w));
    console.log('  status pill:', JSON.stringify(await ref.widgetStatus(w)));
    console.log('  share btn enabled:', await ref.shareButton(w).isEnabled().catch(() => 'ERR'));
    console.log('  code class :', await ref.codeText(w).getAttribute('class').catch(() => null));
    console.log('  washed out :', await ref.isCodeWashedOut(w).catch(() => 'ERR'));
  }

  console.log('\n--- Promo Code share modal ---');
  await ref.openShareModal('Promo Code');
  console.log('  title   :', JSON.stringify(await ref.readModalTitle()));
  console.log('  message :', JSON.stringify(await ref.readModalMessage()));
  console.log('  code    :', JSON.stringify(await ref.readModalCode()));
  for (const f of ['Status', 'Discount', 'Usage Limit', 'Expires on', 'Expires On']) {
    console.log(`  ${f.padEnd(12)}:`, JSON.stringify(await ref.readPromoDetail(f)));
  }
  console.log('  share targets:', (await ref.shareTargets()).join(', ') || 'NONE');
  console.log('  copy CTA :', await ref.modalHasCopyCta());
  console.log('  modal class:', await ref.modal.getAttribute('class').catch(() => null));
  console.log('  modalCode class:', await ref.modalCode.getAttribute('class').catch(() => null));
  const allFields = await ref.promoDetailsFields();
  console.log('  Promo Details field labels:', JSON.stringify(allFields));

  // What does the app ASK each platform for? (window.open recorder)
  for (const p of ['Facebook', 'WhatsApp', 'LinkedIn', 'Twitter']) {
    await page.evaluate(() => {
      if (!window.__opens) { window.__opens = []; const real = window.open.bind(window);
        window.open = function (...a) { window.__opens.push(String(a[0])); return real(...a); }; }
      window.__opens.length = 0;
    });
    const pending = ctx.waitForEvent('page', { timeout: 12000 }).catch(() => null);
    await ref.shareTargetButton(p).click().catch(() => {});
    const popup = await pending;
    const asked = await page.evaluate(() => (window.__opens || [])[0] || null);
    let landed = null;
    if (popup) { landed = popup.url(); await popup.waitForTimeout(700).catch(() => {}); landed = popup.url(); await popup.close().catch(() => {}); }
    const dec = (u) => { let d = u; for (let i = 0; i < 4 && d; i++) { try { const n = decodeURIComponent(d); if (n === d) break; d = n; } catch { break; } } return d && d.replace(/\+/g, ' '); };
    console.log(`\n  ${p}:`);
    console.log('    app asks for :', dec(asked));
    console.log('    popup lands  :', dec(landed));
  }
  await browser.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
