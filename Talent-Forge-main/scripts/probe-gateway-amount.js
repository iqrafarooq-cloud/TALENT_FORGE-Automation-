// probe-gateway-amount.js — What is OBSERVABLE about the amount handed to PayTabs?
//
// The suite never asserted it. `payWithTestCard()` fills in a card, and nothing checked that the
// gateway had been asked for the DISCOUNTED figure — so a promo that renders a correct discount
// line and then bills list price satisfied every assertion except the superadmin revenue
// reconciliation in Promo-Code-Lifecycle §5.
//
// Adding that assertion needs ground truth first, because what the app sends to PayTabs server-side
// is not visible from the browser at all: the app POSTs to its own API, the backend talks to the
// gateway, and the browser is handed a redirect. So this probe dumps every observable source —
//
//   1. the initiate/change response body (does it name an amount, and under what key?)
//   2. the request payload the app posted
//   3. the redirect URL's query string
//   4. the rendered PayTabs page, read AFTER its card form appears
//
// — for one live checkout, and then walks away. Costs a fresh signup + IMAP verification and
// leaves a Pending row. NO PAYMENT is made: the session is abandoned at the card form.
//
//   node scripts/probe-gateway-amount.js            # Monthly, no promo
//   node scripts/probe-gateway-amount.js quarterly  # a different subtotal
require('dotenv').config();
const { chromium } = require('playwright');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

const PLAN = (process.argv[2] || 'monthly').toLowerCase();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const sub = new SubscriptionPage(page);

  // Everything the app posts to its own payment endpoints, request and response.
  const traffic = [];
  page.on('response', async (res) => {
    const path = (() => { try { return new URL(res.url()).pathname; } catch { return ''; } })();
    if (!/\/(payments\/paytabs\/initiate|subscription\/change)\/?$/.test(path)) return;
    if (res.request().method() !== 'POST') return;
    traffic.push({
      path,
      status: res.status(),
      request: res.request().postData() || null,
      response: (await res.text().catch(() => '')) || null,
    });
  });

  try {
    // A never-subscribed candidate: the initiate call only reaches the gateway on one.
    const world = { browser, context: ctx, page, pages: { subscription: sub } };
    await provisionFreshCandidate(world);
    console.log(`\nFresh candidate: ${world._freshEmail}`);

    await sub.gotoCheckout(PLAN);
    const totals = await sub.readInvoiceTotals();
    console.log(`Invoice (${PLAN}):`, JSON.stringify(totals));

    const body = await sub.initiatePayTabsSession(PLAN);
    console.log('\n--- 1/2. initiate request + response ---');
    traffic.forEach((t) => {
      console.log(`  ${t.path} -> ${t.status}`);
      console.log(`    request : ${String(t.request).slice(0, 400)}`);
      console.log(`    response: ${String(t.response).slice(0, 800)}`);
    });
    console.log(`  parsed body keys: ${Object.keys(body || {}).join(', ')}`);

    console.log('\n--- 3. redirect URL ---');
    console.log(`  ${page.url()}`);

    console.log('\n--- 4. the rendered PayTabs page ---');
    // readGatewayAmount() waits for the card form itself: the URL commits well before the gateway
    // paints, and reading too early returns an empty body — which is exactly how the first version
    // of the new step reported "no amounts on the PayTabs page" for a page that shows them.
    const read = await sub.readGatewayAmount();
    console.log(`  card form visible: ${read.painted}`);
    console.log(`  currency-marked amount: ${read.amount === null ? '(none)' : read.amount}`);
    console.log(`  every number on the page: ${read.allAmounts.join(', ') || '(none)'}`);
    console.log(`  page text: ${read.text}`);

    // Walk away — this leaves a Pending row and charges nothing.
    await sub.abandonPayTabsSession();
    console.log('\nSession abandoned (Pending row, no charge).');
  } catch (err) {
    console.error('PROBE FAILED:', err.message);
  } finally {
    await browser.close();
  }
})();
