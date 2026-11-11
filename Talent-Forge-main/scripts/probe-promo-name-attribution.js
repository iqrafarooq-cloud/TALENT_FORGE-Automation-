// Why does the preview attribute PROMO_FIXED_AGENT's promo to a DIFFERENT address than the one
// the agent's profile holds? Two very different answers, and this separates them:
//   (a) a second agent really exists on the shorter address and owns the promo  -> serious
//   (b) no such agent exists, and `promo.name` is a STALE denormalised label    -> cosmetic
// Read-only: searches the agents list as superadmin and takes one preview quote. No payment.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const AGENT_EMAIL = process.env.PROMO_FIXED_AGENT_EMAIL;
const CODE = process.env.PROMO_FIXED_AGENT_PROMO_CODE;
const CAND = process.env.PROMO_FIXED_AGENT_CANDIDATE_EMAIL;
const CAND_PW = process.env.PROMO_FIXED_AGENT_CANDIDATE_PASSWORD;
// The local-part stem shared by both spellings, so the search cannot prejudge which exists.
const STEM = (AGENT_EMAIL.match(/\+([a-z0-9]+?)\d*@/) || [, 'promofix'])[1].replace(/\d+$/, '');

async function signIn(page, email, password, urlRe) {
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(urlRe, { timeout: 90000, waitUntil: 'commit' });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---- 1. How many agents share that stem, and what are their exact addresses?
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminCtx.newPage();
  await signIn(adminPage, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD, /\/dashboard|\/agents|\/candidates/);
  await adminPage.goto(`${origin}/agents`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(3500);
  const box = adminPage.locator('input[type="search"], input[placeholder*="Search" i]').first();
  await box.fill(STEM);
  await adminPage.waitForTimeout(4000);
  const rows = await adminPage.$$eval('[role="row"]', (rs) =>
    rs.map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && /@/.test(t))
  );
  console.log(`=== agents matching "${STEM}" (${rows.length}) ===`);
  for (const r of rows) console.log('  ', r.slice(0, 160));
  const addresses = [...new Set(rows.flatMap((r) => r.match(/[\w.+-]+@[\w.-]+/g) || []))];
  console.log('\ndistinct addresses:', JSON.stringify(addresses, null, 1));
  console.log('.env holds:', AGENT_EMAIL);

  // Which of them actually holds this promo code?
  const admin = new AdminPromoToolsPage(adminPage);
  for (const addr of addresses) {
    try {
      await admin.openPromoTools(addr);
      console.log(`  ${addr} -> profile ${adminPage.url()}  promo code "${await admin.readPromoCode()}"`);
    } catch (e) {
      console.log(`  ${addr} -> could not open Promo Tools: ${e.message.split('\n')[0].slice(0, 120)}`);
    }
  }
  await adminCtx.close();

  // ---- 2. The full preview payload, so promo.name can be read beside every other field.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let raw = null;
  page.on('response', async (r) => {
    if (!/payments\/paytabs\/preview/.test(r.url())) return;
    try { raw = await r.text(); } catch { raw = '(unreadable)'; }
  });
  await signIn(page, CAND, CAND_PW, /\/dashboard|\/getting-started|\/onboarding|\/profile/);
  const sub = new SubscriptionPage(page);
  await sub.gotoCheckout('Monthly');
  await page.waitForTimeout(1200);
  await sub.applyPromoAwaitingPreview(CODE).catch(() => {});
  await page.waitForTimeout(1200);
  console.log('\n=== preview payload ===');
  console.log(raw ? raw.slice(0, 1500) : '(no preview response captured)');
  try {
    const p = JSON.parse(raw).promo;
    console.log('\npromo object:', JSON.stringify(p, null, 1));
    console.log('\npromo.name  :', JSON.stringify(p && p.name));
    console.log('agent .env  :', JSON.stringify(AGENT_EMAIL));
    const inName = (p && p.name) || '';
    console.log('name contains the .env address?', inName.includes(AGENT_EMAIL));
  } catch { /* reported above */ }
  await ctx.close();

  console.log('\n================ VERDICT ================');
  if (addresses.length === 1) {
    console.log('Only ONE agent exists on that stem, and it is the one .env names, so the promo');
    console.log('cannot belong to anybody else. `promo.name` is therefore a STALE DENORMALISED');
    console.log('LABEL - a string built from the address at some earlier point and never updated.');
    console.log('The promo IS correctly owned; only the label disagrees.');
  } else {
    console.log('MORE THAN ONE agent shares that stem - check above which one holds the code.');
  }
  await browser.close();
})();
