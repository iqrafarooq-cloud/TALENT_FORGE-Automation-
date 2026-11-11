// probe-heal-nonpaid-rows.js — exercise the SELF-HEALING path of
// subscriptionProvision.provisionNonPaidRow for real.
//
// On the shared candidate the healing never fires (it already has Pending and Canceled rows),
// so this drives it on a FRESH never-subscribed candidate where both must be minted. Proves
// the full production code path: initiate -> end session -> row appears with the right status
// and disabled receipt actions. Dev-only; signs up a real candidate over IMAP (a few minutes).
//
//   node scripts/probe-heal-nonpaid-rows.js
require('dotenv').config();
const { chromium } = require('playwright');
const SubscriptionPage = require('../pages/SubscriptionPage');
const {
  provisionFreshCandidate,
  provisionNonPaidRow,
} = require('../utils/subscriptionProvision');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let failures = 0;
  try {
    const sub = new SubscriptionPage(page);
    const world = { page, pages: { subscription: sub } };

    // Provision FIRST so the fast path finds nothing and the healing is forced to run.
    console.log('provisioning a fresh never-subscribed candidate…');
    console.log(`provisioned: ${await provisionFreshCandidate(world)}`);

    for (const status of ['Canceled', 'Pending']) {
      console.log(`\n=== provisionNonPaidRow(world, "${status}") ===`);
      const r = await provisionNonPaidRow(world, status);
      console.log(`   -> ${JSON.stringify(r)}`);
      if (!r.healed) {
        console.log(`   !! expected healed:true on a fresh account`);
        failures++;
      }

      // The row must render with BOTH receipt actions disabled and no receipt href.
      const rows = sub.rowsWithStatus(status);
      const n = await rows.count();
      console.log(`   rendered "${status}" rows: ${n}`);
      if (!n) { failures++; continue; }
      const a = sub.receiptActionsIn(rows.first());
      const view = await a.View.isEnabled();
      const dl = await a.Download.isEnabled();
      const href = await a.Download.getAttribute('href').catch(() => null);
      console.log(`   View enabled=${view} | Download enabled=${dl} | href=${href || 'none'}`);
      if (view || dl || href) {
        console.log('   !! a minted non-Paid row has live receipt actions');
        failures++;
      }
    }

    // Idempotence: a second call must NOT mint again (fast path).
    console.log('\n=== idempotence: call again for "Canceled" ===');
    const again = await provisionNonPaidRow(world, 'Canceled');
    console.log(`   -> ${JSON.stringify(again)}`);
    if (again.healed) { console.log('   !! healed twice — not idempotent'); failures++; }

    // "Cancelled" (double L) must normalise to the real label, not mint a second row.
    console.log('\n=== spelling: "Cancelled" (double L) normalises ===');
    const spelled = await provisionNonPaidRow(world, 'Cancelled');
    console.log(`   -> ${JSON.stringify(spelled)}`);
    if (spelled.label !== 'Canceled' || spelled.healed) {
      console.log('   !! double-L spelling did not normalise to the existing Canceled row');
      failures++;
    }

    console.log(`\n=== final statuses on the minted account: ${JSON.stringify(await sub.allBillingRowStatuses())}`);
    console.log(failures === 0 ? '\nALL HEALING CHECKS PASSED' : `\n${failures} HEALING CHECK(S) FAILED`);
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
  if (failures) process.exitCode = 1;
})();
