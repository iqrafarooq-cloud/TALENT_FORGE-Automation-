// probe-receipt-pdf-contents.js — Can the receipt PDF actually be READ, and does it state what
// the billing row states?
//
// Every receipt assertion in the suite used to stop at "it is a real PDF" (HTTP 200, %PDF- header,
// >1000 bytes) on the stated grounds that "the PDF's text streams are compressed". This probe
// answers the question that comment closed off: it downloads the first Paid row's receipt, extracts
// its text with the same helper the new step uses, and prints the text next to the row and the
// receipt panel — so the step's assertions are written against what the file really contains rather
// than against a guess.
//
// Also reports whether the file is text-bearing at all: an image-only receipt is unverifiable and
// the step needs to say so distinctly, rather than reading as "the amount is wrong".
//
//   node scripts/probe-receipt-pdf-contents.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');
const { extractPdfText, amountsIn, excerpt } = require('../utils/pdfText');
const { verifyPdfStatesCharge } = require('../utils/chargeReconciliation');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  try {
    const l = new LoginPage(page);
    await l.navigate();
    await l.emailInput.first().fill(EMAIL);
    await l.passwordInput.first().fill(PASSWORD);
    await l.submitButton.first().click();
    await page.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, {
      timeout: 90000,
      waitUntil: 'commit',
    });

    const sub = new SubscriptionPage(page);
    await sub.gotoSubscriptionTabWithBilling();

    const rows = await sub.paidRowsData();
    console.log(`\nPaid billing rows (${rows.length}):`);
    rows.forEach((r) => console.log(`  #${r.index}  ${r.plan} | ${r.amountText} (${r.amount}) | ${r.date}`));
    if (rows.length === 0) {
      console.log('No Paid row on this account — nothing to read.');
      return;
    }

    // EVERY paid row, not just the first: one receipt cannot distinguish "this payment was
    // recorded wrongly" from "the receipt template carries hardcoded figures". Three rows at three
    // different amounts can.
    for (const r of rows) {
      const f = await sub.fetchReceiptForPaidRow(r.index);
      const { text: t, error: e } = await extractPdfText(f.bytes);
      console.log(`\n=== row #${r.index} ${r.plan} ${r.amountText} (${r.date}) -> HTTP ${f.status}, ${f.bytes.length}B ===`);
      console.log(e ? `EXTRACTION FAILED: ${e}` : excerpt(t, 1400));
    }

    const row = rows[0];
    await sub.openReceiptForPaidRow(row.index);
    const panel = await sub.readReceiptPanel();
    console.log('\nReceipt panel:', JSON.stringify(panel));

    const fetched = await sub.fetchReceiptForPaidRow(row.index);
    console.log(`\nReceipt file: HTTP ${fetched.status}, ${fetched.bytes.length} bytes`);
    console.log(`  href: ${fetched.href.slice(0, 140)}`);
    console.log(`  magic: ${JSON.stringify(fetched.bytes.slice(0, 5).toString('latin1'))}`);

    const { text, pages, error } = await extractPdfText(fetched.bytes);
    if (error) {
      console.log(`\nEXTRACTION FAILED: ${error}`);
      return;
    }
    const amounts = amountsIn(text);
    console.log(`\nExtracted ${text.length} chars from ${pages} page(s).`);
    console.log(`Amounts stated in the PDF: ${amounts.join(', ') || '(none)'}`);
    console.log(`\n--- PDF TEXT ---\n${excerpt(text, 4000)}\n----------------`);

    // Run the SAME reader the step uses, rather than a second inline copy of the rules — two
    // readers drift, and then the probe and the report disagree about what the file says.
    const verdict = await verifyPdfStatesCharge(fetched.bytes, {
      charged: row.amount,
      planName: (row.plan || '').replace(/\s*plan\s*$/i, '').trim() || null,
      row,
    });
    console.log('\nParsed receipt fields:', JSON.stringify(verdict.fields));
    console.log('\nVerdict against the billing row:');
    console.log(verdict.problems.length
      ? verdict.problems.map((p) => `  - ${p}`).join('\n')
      : '  no discrepancies');
  } catch (err) {
    console.error('PROBE FAILED:', err.message);
  } finally {
    await browser.close();
  }
})();
