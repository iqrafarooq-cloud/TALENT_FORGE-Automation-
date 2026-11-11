// probe-promo-invoice-math.js — establish the GROUND TRUTH for every number the invoice
// renders once a promo is applied, so the arithmetic assertions can be written against what
// the app really does rather than against what the POM currently happens to read.
//
//   node scripts/probe-promo-invoice-math.js
//
// Answers, for the shared candidate:
//   [LINES]  the complete totals block on each plan's invoice — is there a VAT/tax line? a
//            plan-credit line? what EXACTLY does the discount line say for a percentage promo
//            vs a fixed-amount one?
//   [MATH]   Subtotal / discount / Total due today for Monthly, Quarterly and Yearly, with the
//            20% promo and the SAR 50 fixed promo in turn. The suite only ever exercised
//            Monthly, so a discount computed off a hardcoded 155 has never been visible.
//   [API]    the preview response body for each of those, which is the server's own view of
//            the same numbers — the authoritative answer when the DOM and the arithmetic
//            disagree.
//   [CREDIT] the change/upgrade invoice (mode=change): the pro-rata credit line, and whether a
//            percentage promo is taken on the GROSS subtotal or on subtotal-minus-credit.
//
// Read-only: applies and removes promo codes on an invoice, never clicks Continue, never pays.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const CANDIDATE_EMAIL = process.env.CANDIDATE_EMAIL;
// NOTE the typo — it is spelled CANDIDTAE_PASSWORD in .env and the whole suite reads it that way.
const CANDIDATE_PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

const PROMOS = [
  { label: 'percentage 20%', code: process.env.PROMO_UNLIMITED_AGENT_PROMO_CODE, type: 'Percentage Discount', value: 20 },
  { label: 'fixed SAR 50', code: process.env.PROMO_FIXED_AGENT_PROMO_CODE, type: 'Fixed Amount', value: 50 },
];

const PREVIEW = /\/(payments\/paytabs|subscription\/change)\/preview\/?$/;

const num = (s) => {
  const m = String(s == null ? '' : s).match(/-?[\d.,]+/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
};

// Every "<label> <amount>" pair in the invoice's totals area, in render order. Derived
// structurally rather than by class: take the block that holds "Total due today" and read its
// rows. That is exactly what a real assertion will have to do, so the probe proves the approach
// as well as the numbers.
async function readTotalsBlock(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div,section,li,tr'));
    const holders = all.filter((el) => /total due today/i.test(el.textContent || ''));
    if (!holders.length) return { found: false, rows: [], raw: '' };
    // The SMALLEST element that still contains the subtotal as well — i.e. the totals card.
    const card = holders
      .filter((el) => /subtotal/i.test(el.textContent || ''))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
      || holders.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    const raw = (card.innerText || '').trim();
    // A row is a line carrying a label and an amount.
    const rows = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.*?)\s*(-?\s*SAR\s*[\d.,]+|-?[\d.,]+)\s*$/i);
        return m ? { label: m[1].trim(), amount: m[2].replace(/\s+/g, ' ').trim() } : { label: line, amount: null };
      });
    return { found: true, rows, raw };
  });
}

function show(tag, block) {
  console.log(`  ${tag}`);
  if (!block.found) { console.log('    (no totals card found)'); return; }
  for (const r of block.rows) {
    console.log(`      ${r.label.padEnd(34)} ${r.amount === null ? '(no amount on this line)' : r.amount}`);
  }
}

function verdict(block, promo) {
  if (!block.found) return '    VERDICT: no totals card';
  const get = (re) => {
    const row = block.rows.find((r) => re.test(r.label) && r.amount !== null);
    return row ? num(row.amount) : null;
  };
  const subtotal = get(/^subtotal$/i);
  const total = get(/^total due today$/i);
  const discountRow = block.rows.find((r) => /^discount/i.test(r.label));
  const creditRow = block.rows.find((r) => /credit/i.test(r.label));
  const vatRow = block.rows.find((r) => /vat|tax/i.test(r.label));
  const shownDiscount = discountRow && discountRow.amount !== null ? Math.abs(num(discountRow.amount)) : null;
  const credit = creditRow && creditRow.amount !== null ? Math.abs(num(creditRow.amount)) : null;
  const implied = subtotal !== null && total !== null ? Number((subtotal - total).toFixed(2)) : null;

  const out = [];
  out.push(`    subtotal=${subtotal}  total=${total}  discount line=${shownDiscount}  credit=${credit}  vat=${vatRow ? vatRow.amount : 'NONE'}`);
  out.push(`    implied discount (subtotal-total) = ${implied}`);
  if (promo) {
    const onGross = promo.type === 'Fixed Amount'
      ? Math.min(promo.value, subtotal)
      : Number(((subtotal * promo.value) / 100).toFixed(2));
    out.push(`    expected off GROSS subtotal      = ${onGross}`);
    if (credit !== null) {
      const net = Number((subtotal - credit).toFixed(2));
      const onNet = promo.type === 'Fixed Amount'
        ? Math.min(promo.value, net)
        : Number(((net * promo.value) / 100).toFixed(2));
      out.push(`    expected off NET (subtotal-credit=${net}) = ${onNet}`);
    }
    if (shownDiscount !== null && implied !== null && Math.abs(shownDiscount - implied) > 0.01) {
      out.push(`    !! the DISCOUNT LINE (${shownDiscount}) and the TOTAL (implies ${implied}) DISAGREE`);
    }
  }
  return out.join('\n');
}

async function apply(page, sub, code) {
  const wait = page.waitForResponse((r) => PREVIEW.test(new URL(r.url()).pathname), { timeout: 25000 }).catch(() => null);
  await sub.applyPromo(code);
  const res = await wait;
  await page.waitForTimeout(1800);
  let body = '';
  if (res) body = (await res.text().catch(() => '')) || '';
  return { status: res ? res.status() : null, body };
}

async function clearPromo(page, sub) {
  if (await sub.promoRemoveButton.isVisible().catch(() => false)) {
    await sub.promoRemoveButton.click();
    await page.waitForTimeout(1500);
  }
}

(async () => {
  if (!CANDIDATE_EMAIL || !CANDIDATE_PASSWORD) throw new Error('CANDIDATE_EMAIL / CANDIDTAE_PASSWORD missing from .env');
  for (const p of PROMOS) if (!p.code) throw new Error(`missing promo code for "${p.label}" in .env`);

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(CANDIDATE_EMAIL);
  await login.passwordInput.first().fill(CANDIDATE_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/profile|\/learning|\/subscribe|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });
  console.log(`logged in as ${CANDIDATE_EMAIL} -> ${page.url()}`);

  const sub = new SubscriptionPage(page);

  for (const plan of ['Monthly', 'Quarterly', 'Yearly']) {
    console.log(`\n=================== SUBSCRIBE INVOICE — ${plan} ===================`);
    try {
      await sub.gotoCheckout(plan);
    } catch (e) {
      console.log(`  could not open the ${plan} invoice: ${e.message.split('\n')[0]}`);
      continue;
    }
    const bare = await readTotalsBlock(page);
    show('[LINES] no promo applied:', bare);
    console.log(verdict(bare, null));

    for (const promo of PROMOS) {
      await clearPromo(page, sub);
      const { status, body } = await apply(page, sub, promo.code);
      const after = await readTotalsBlock(page);
      console.log('');
      show(`[MATH] ${promo.label} (${promo.code}) — preview HTTP ${status}:`, after);
      console.log(verdict(after, promo));
      console.log(`    [API] ${body.slice(0, 700)}`);
    }
    await clearPromo(page, sub);
  }

  // ---- the change/upgrade invoice: pro-rata credit + promo ----
  console.log('\n=================== CHANGE INVOICE — Yearly (mode=change) ===================');
  try {
    await sub.gotoCheckout('Yearly', true);
    const bare = await readTotalsBlock(page);
    show('[CREDIT] no promo applied:', bare);
    console.log(verdict(bare, null));
    for (const promo of PROMOS) {
      await clearPromo(page, sub);
      const { status, body } = await apply(page, sub, promo.code);
      const after = await readTotalsBlock(page);
      console.log('');
      show(`[CREDIT] ${promo.label} (${promo.code}) — preview HTTP ${status}:`, after);
      console.log(verdict(after, promo));
      console.log(`    [API] ${body.slice(0, 700)}`);
    }
    await clearPromo(page, sub);
  } catch (e) {
    console.log(`  change invoice unavailable: ${e.message.split('\n')[0]}`);
  }

  await context.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
