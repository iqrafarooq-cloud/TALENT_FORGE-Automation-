// probe-cancel-aftermath.js — after a PayTabs session is CANCELLED on a never-subscribed
// account, where does the app actually leave you, and is the CANCELED row visible anywhere?
//
// The healing step failed here: post-cancel, loading the Subscription tab fired neither
// GET /payments/ nor GET /subscription/current/, and the following navigation timed out. This
// pins down (a) the URL after each hop, (b) what the tab renders, (c) whether the row exists in
// the API at all, and (d) whether a hard reload recovers it. Dev-only; real signup over IMAP.
//
//   node scripts/probe-cancel-aftermath.js
require('dotenv').config();
const { chromium } = require('playwright');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Log every relevant API call so "no call" vs "called and empty" is unambiguous.
  const calls = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/\/payments\/|\/subscription\/current\/|\/auth\/me\//.test(u)) {
      calls.push(`${r.request().method()} ${new URL(u).pathname} -> ${r.status()}`);
    }
  });
  const drainCalls = (label) => {
    console.log(`   [api ${label}] ${calls.length ? calls.join(' | ') : '(none)'}`);
    calls.length = 0;
  };

  try {
    const sub = new SubscriptionPage(page);
    const world = { page, pages: { subscription: sub } };
    console.log(`provisioned: ${await provisionFreshCandidate(world)}`);

    console.log('\n--- initiate a session ---');
    const body = await sub.initiatePayTabsSession('monthly');
    console.log(`   initiate body: ${JSON.stringify(body)}`);
    console.log(`   on gateway: ${page.url().slice(0, 60)}`);
    calls.length = 0;

    console.log('\n--- cancel on the gateway ---');
    await sub.cancelPayTabsSession();
    console.log(`   URL after cancel: ${page.url()}`);
    drainCalls('after cancel');
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    console.log(`   page text: ${bodyText.replace(/\s+/g, ' ').trim().slice(0, 200)}`);

    console.log('\n--- open the Subscription tab (as the healing step does) ---');
    await sub.gotoSubscriptionTabWithBilling();
    console.log(`   URL: ${page.url()}`);
    drainCalls('after tab');
    console.log(`   grid visible=${await sub.billingGrid.isVisible().catch(() => 'err')} heading visible=${await sub.billingHistoryHeading.isVisible().catch(() => 'err')}`);
    console.log(`   DOM statuses: ${JSON.stringify(await sub.allBillingRowStatuses())}`);
    const tabText = (await page.locator('body').innerText().catch(() => '')) || '';
    console.log(`   tab text: ${tabText.replace(/\s+/g, ' ').trim().slice(0, 300)}`);

    console.log('\n--- hard reload, then re-check ---');
    const payments = page
      .waitForResponse((r) => /\/payments\/(\?|$)/.test(r.url()) && r.ok(), { timeout: 45000 })
      .catch(() => null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const pRes = await payments;
    console.log(`   URL: ${page.url()}`);
    drainCalls('after reload');
    if (pRes) {
      const j = await pRes.json().catch(() => null);
      console.log(`   API payments: ${JSON.stringify((j && j.results || []).map((r) => ({ id: r.id, status: r.status })))}`);
    } else {
      console.log('   API payments: NO /payments/ CALL EVEN AFTER RELOAD');
    }
    await sub.billingRows.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    console.log(`   grid visible=${await sub.billingGrid.isVisible().catch(() => 'err')}`);
    console.log(`   DOM statuses: ${JSON.stringify(await sub.allBillingRowStatuses())}`);
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
