// probe-provision-nonpaid-rows.js — how do you MAKE a non-Paid billing row?
//
// Phase 1 (shared, already-subscribed account): capture the body of the 422 that
//   POST /payments/paytabs/initiate/ answers with, so the healing step can explain itself.
// Phase 2 (FRESH never-subscribed account): the real experiment —
//   A) initiate a PayTabs session, then ABANDON it (navigate away)  -> PENDING?
//   B) initiate a PayTabs session, then CANCEL it on the gateway    -> CANCELED?
//
// Reads /payments/ and /subscription/current/ by intercepting the app's OWN requests (the
// API needs the app's auth header, so a bare in-page fetch with credentials:'include' 401s).
// Dev-only. Phase 2 signs up a real candidate over IMAP, so allow a few minutes.
//
//   node scripts/probe-provision-nonpaid-rows.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

const tally = (rows) => rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});

// Load the Subscription tab and harvest the payments + subscription payloads it fetches.
async function readState(page, sub, label) {
  const payments = page
    .waitForResponse((r) => /\/payments\/(\?|$)/.test(r.url()) && r.ok(), { timeout: 45000 })
    .catch(() => null);
  const current = page
    .waitForResponse((r) => /\/subscription\/current\//.test(r.url()), { timeout: 45000 })
    .catch(() => null);
  await sub.gotoSubscriptionTab();
  const [pRes, cRes] = [await payments, await current];
  const pJson = pRes ? await pRes.json().catch(() => null) : null;
  const cJson = cRes && cRes.ok() ? await cRes.json().catch(() => null) : null;
  const rows = pJson ? (pJson.results || []).map((r) => ({ id: r.id, status: r.status, amount: r.amount })) : [];
  const plan = cJson
    ? { plan: cJson.plan_name, state: cJson.status }
    : { httpStatus: cRes ? cRes.status() : 'no call' };
  console.log(`   [${label}] payments count=${pJson ? pJson.count : '?'} ${JSON.stringify(tally(rows))} plan=${JSON.stringify(plan)}`);
  return { rows, plan };
}

// Click invoice Continue and report what POST /payments/paytabs/initiate/ answered.
async function initiate(page, sub) {
  const call = page
    .waitForResponse((r) => /\/payments\/paytabs\/initiate\//.test(r.url()), { timeout: 90000 })
    .catch(() => null);
  await sub.continueButton.click();
  const res = await call;
  if (!res) return { status: 'NO CALL', body: '' };
  const body = (await res.text().catch(() => '')) || '';
  return { status: res.status(), body: body.slice(0, 400) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---------------- Phase 1: the shared, already-subscribed account ----------------
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  try {
    console.log('\n################ PHASE 1 — shared (already subscribed) ################');
    const l = new LoginPage(page1);
    await l.navigate();
    await l.emailInput.first().fill(EMAIL);
    await l.passwordInput.first().fill(PASSWORD);
    await l.submitButton.first().click();
    await page1.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, { timeout: 90000, waitUntil: 'commit' });

    const sub = new SubscriptionPage(page1);
    await readState(page1, sub, 'baseline');
    await sub.gotoCheckout('monthly');
    const r = await initiate(page1, sub);
    console.log(`   initiate -> ${r.status}`);
    console.log(`   body: ${r.body}`);
    console.log(`   url after: ${page1.url().slice(0, 70)}`);
  } catch (e) {
    console.error('PHASE 1 ERROR:', e.message);
  } finally {
    await ctx1.close();
  }

  // ---------------- Phase 2: a FRESH never-subscribed account ----------------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  try {
    console.log('\n################ PHASE 2 — fresh never-subscribed ################');
    const sub = new SubscriptionPage(page2);
    const world = { page: page2, pages: { subscription: sub } };
    console.log('   provisioning a fresh candidate (signup + IMAP verify)…');
    const email = await provisionFreshCandidate(world);
    console.log(`   provisioned: ${email}`);

    const before = await readState(page2, sub, 'fresh baseline');

    // NOTE the order: CANCEL first, on an account with ZERO prior payments. That is the exact
    // situation the self-healing step hits, and where it failed — the earlier probe ran abandon
    // first, so a Pending row already existed and masked whatever this exposes.
    console.log('\n   --- B) initiate, then Cancel on the PayTabs page (FIRST, zero prior rows) ---');
    await sub.gotoCheckout('monthly');
    const rB = await initiate(page2, sub);
    console.log(`   initiate -> ${rB.status} ${rB.body.slice(0, 200)}`);
    await page2.waitForURL(/paytabs\./i, { timeout: 90000 }).catch(() => {});
    console.log(`   landed on: ${page2.url().slice(0, 60)}`);
    page2.once('dialog', (d) => d.accept().catch(() => {}));
    await sub.paytabsCancelLink
      .click()
      .catch((e) => console.log(`   cancel click failed: ${e.message.split('\n')[0]}`));
    await page2.waitForURL(/talentforge\.com\.sa/i, { timeout: 90000, waitUntil: 'commit' }).catch(() => {});
    console.log(`   returned to: ${page2.url().slice(0, 90)}`);
    const afterB = await readState(page2, sub, 'after cancel');
    const newB = afterB.rows.filter((x) => !before.rows.some((b) => b.id === x.id));
    console.log(`   >>> NEW ROW(S) from CANCEL: ${JSON.stringify(newB)}`);
    // Is the row in the API but NOT in the DOM? That would mean the never-subscribed paywall
    // simply does not render Billing History, and the healing must assert against the API.
    console.log(`   DOM rows now: ${JSON.stringify(await sub.allBillingRowStatuses())}`);
    console.log(`   billingGrid visible? ${await sub.billingGrid.isVisible().catch(() => 'err')}`);
    console.log(`   billingHistoryHeading visible? ${await sub.billingHistoryHeading.isVisible().catch(() => 'err')}`);

    // ---- A) initiate then ABANDON ----
    console.log('\n   --- A) initiate, then abandon (navigate away) ---');
    await sub.gotoCheckout('monthly');
    const rA = await initiate(page2, sub);
    console.log(`   initiate -> ${rA.status} ${rA.body.slice(0, 200)}`);
    await page2.waitForURL(/paytabs\./i, { timeout: 90000 }).catch(() => {});
    console.log(`   landed on: ${page2.url().slice(0, 60)}`);
    const afterA = await readState(page2, sub, 'after abandon');
    const newA = afterA.rows.filter((x) => !afterB.rows.some((b) => b.id === x.id));
    console.log(`   >>> NEW ROW(S) from ABANDON: ${JSON.stringify(newA)}`);
    console.log(`   DOM rows now: ${JSON.stringify(await sub.allBillingRowStatuses())}`);
    console.log(`   billingGrid visible? ${await sub.billingGrid.isVisible().catch(() => 'err')}`);

    // What the UI renders for each new row.
    console.log('\n   --- rendered labels + action states ---');
    for (const status of ['Pending', 'Canceled']) {
      const rows = sub.rowsWithStatus(status);
      const n = await rows.count();
      let detail = '';
      if (n) {
        const a = sub.receiptActionsIn(rows.first());
        detail = ` | View enabled=${await a.View.isEnabled()} Download enabled=${await a.Download.isEnabled()}`;
      }
      console.log(`   rowsWithStatus("${status}") -> ${n}${detail}`);
    }
  } catch (e) {
    console.error('PHASE 2 ERROR:', e.message);
  } finally {
    await ctx2.close();
    await browser.close();
  }
})();
