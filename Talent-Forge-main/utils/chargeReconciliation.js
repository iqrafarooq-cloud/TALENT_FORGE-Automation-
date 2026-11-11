// Reconciling what a candidate was CHARGED against every place that figure is later reported.
//
// WHY THIS EXISTS. The suite could assert that a promo discount was calculated and described
// correctly on the invoice, and (in Promo-Code-Lifecycle §5) that the superadmin's revenue figure
// summed the invoice totals. Between those two points there was nothing: `payWithTestCard()` just
// filled in a card, so no assertion anywhere covered
//
//   invoice total  ->  the amount handed to the gateway  ->  the billing-history row
//                  ->  the receipt panel  ->  the receipt PDF the candidate keeps
//
// A promo that renders a correct discount line and then bills list price passed every scenario
// except §5's revenue step; the two other paid-with-promo scenarios (Subscription.feature's
// upgrade-and-pay, Referral-Codes.feature §201) asserted only that a success modal appeared.
//
// EVERY FUNCTION HERE COLLECTS PROBLEMS RATHER THAN THROWING. That is the project convention for
// a reason that matters doubly here: these run inside `@consumes-promo` scenarios that spend real
// payments, and Cucumber abandons a scenario at its first failing step. Gathering the evidence
// non-fatally during the payment and asserting it in a later step keeps a mismatch in the *record*
// from taking down the usage/revenue/exhaustion assertions that the same two payments paid for.

const {
  extractPdfText, statesAmount, amountsIn, excerpt, currencyMarks,
} = require('./pdfText');

// Evidence that the gateway asked the candidate for `charged`, gathered while they are sitting on
// the PayTabs page. `collector` is a SubscriptionPage.watchGatewayCalls() handle and `pageRead` a
// SubscriptionPage.readGatewayAmount() reading — the caller has to take that one while the browser
// is still ON the gateway, i.e. before the card is submitted.
//
// WHERE THE EVIDENCE COMES FROM, and why not from the API. Established live 2026-07-31
// (scripts/probe-gateway-amount.js): the app's own payment call answers `201` with an EMPTY body and
// posts `{plan_id, billing_cycle, promo_code}` — no amount anywhere. The backend computes the charge
// and talks to PayTabs itself, and the browser gets an opaque page token. So the amount is only
// observable on the gateway's own page ("Payment details ﷼155.00 PAY NOW"), which is also the right
// thing to assert: it is the figure the candidate reads before authorising the payment.
//
// The first version of this function expected an amount in the API response and reported "the amount
// could not be read" on a healthy checkout. Do not reintroduce that — a missing API amount is how
// this app works, not a defect.
//
// { pageAmount, currencyAmounts, allAmounts, promoSent, calls, problems }
async function collectGatewayEvidence({ subs, collector, charged, subtotal, pageRead, expectPromo }) {
  const calls = collector.calls().map((c) => `${c.path} -> ${c.status} ${JSON.stringify(c.request || {})}`);
  const promoSent = collector.promoSent();
  const page = pageRead || (await subs.readGatewayAmount().catch(() => ({
    amount: null, currencyAmounts: [], allAmounts: [], text: '', painted: false,
  })));
  const problems = [];
  const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 0.01;
  const anyNear = (list, want) => (list || []).some((n) => Math.abs(n - want) < 0.01);

  if (page.amount !== null) {
    if (!near(page.amount, charged)) {
      const listPrice = subtotal !== null && subtotal !== undefined && near(page.amount, subtotal)
        ? ` That is the plan's LIST price (SAR ${subtotal}) — the discount is shown on the invoice `
          + 'but not in what the candidate is actually asked to pay.'
        : '';
      problems.push(
        `the invoice said SAR ${charged} was due, but the PayTabs page asks for `
        + `${page.amount}.${listPrice}`
      );
    }
  } else if (!anyNear(page.allAmounts, charged)) {
    // If the charged figure appears on the page but not against a currency marker this reader
    // knows, the gateway has simply been re-skinned — the amount is right, so that is not a
    // problem. Only a page with no trace of it at all is.
    problems.push(
      'the PayTabs page displays no amount this reader can find, so what the candidate was asked to '
      + `pay could not be verified (card form painted: ${page.painted}; numbers seen: `
      + `${(page.allAmounts || []).slice(0, 12).join(' / ') || 'none'}; page text: ${page.text})`
    );
  }

  // The promo code is the one thing the app's own payment call DOES carry, so whether the discount
  // was even submitted is checkable independently of the gateway's rendering.
  if (expectPromo) {
    if (!promoSent) {
      problems.push(
        `the payment call carried no promo code at all, although the invoice was quoted with `
        + `"${expectPromo}" applied (${calls.join(' ; ') || 'no matching call observed'})`
      );
    } else if (promoSent.toUpperCase() !== String(expectPromo).toUpperCase()) {
      problems.push(`the payment call carried promo code "${promoSent}", expected "${expectPromo}"`);
    }
  }

  return {
    pageAmount: page.amount,
    currencyAmounts: page.currencyAmounts || [],
    allAmounts: page.allAmounts || [],
    gatewayText: page.text,
    promoSent,
    calls,
    problems,
  };
}

// After the payment: does the record the candidate keeps state `charged`?
//
// Checks four independent surfaces, and note what each is worth. The billing row and the receipt
// panel are both rendered by the frontend from the same API payload, so their agreeing with each
// other proves only that the rendering is consistent — which is all the old
// `the receipt information should match that billing row` step ever established. The PDF is a
// separate artefact produced server-side, and `charged` is a figure captured from the invoice
// BEFORE the payment, so those two comparisons are the ones with teeth.
//
// THE THREE PROBLEM LISTS ARE KEPT APART on purpose. `problems` covers the in-app record (the
// billing row and the receipt panel); `pdfProblems` covers what the downloaded file STATES as the
// charge; `pdfCurrencyProblems` covers the file's currency labelling. They are different artefacts
// (or, for the last two, different defects in one artefact) — so a caller asserts them in separate
// steps and the report shows which one disagrees, instead of one red row that implies all of them
// are broken. `problems` therefore does NOT include the PDF's findings; `allProblems()` is there for
// anything that wants them together.
//
// Currency is separated from the arithmetic because it fires on EVERY receipt (M8 finding 3, live
// 2026-07-31) — leaving it in `pdfProblems` makes every receipt scenario permanently red and hides
// the one verdict those scenarios exist to report: whether the stated total equals the charge.
//
// { row, panel, pdf, problems, pdfProblems, pdfCurrencyProblems, allProblems() }. Opens the receipt
// viewer as a side effect.
async function collectRecordEvidence({ subs, charged, planName }) {
  const problems = [];
  const pdfProblems = [];
  const pdfCurrencyProblems = [];
  const result = (extra) => ({
    row: null, panel: null, pdf: null, ...extra, problems, pdfProblems, pdfCurrencyProblems,
    allProblems: () => [...problems, ...pdfProblems, ...pdfCurrencyProblems],
  });
  await subs.gotoSubscriptionTabWithBilling();

  const rows = await subs.paidRowsData();
  if (rows.length === 0) {
    problems.push('the Subscription tab lists no Paid billing row at all after the payment');
    return result({});
  }

  // Matched by amount, not by position — see SubscriptionPage.paidRowsData().
  const row = await subs.paidRowForAmount(charged);
  if (!row) {
    problems.push(
      `no Paid billing row is charged SAR ${charged}; the rows read `
      + `${rows.map((r) => `${r.plan} ${r.amountText}`).join(' | ')}`
    );
    // Fall through on the newest row anyway: the receipt of whatever WAS recorded is the most
    // useful thing to put in front of whoever reads the failure.
  }
  const target = row || rows[0];
  if (planName && target.plan && !new RegExp(planName, 'i').test(target.plan)) {
    problems.push(`the billing row reads plan "${target.plan}", expected "${planName}"`);
  }

  let panel = null;
  try {
    await subs.openReceiptForPaidRow(target.index);
    panel = await subs.readReceiptPanel();
    if (panel.amount === null || Math.abs(panel.amount - target.amount) > 0.01) {
      problems.push(
        `the receipt panel states ${panel.amountText || '(nothing)'} while its billing row states `
        + `${target.amountText}`
      );
    }
    if (row && (panel.amount === null || Math.abs(panel.amount - charged) > 0.01)) {
      problems.push(`the receipt panel states ${panel.amountText || '(nothing)'}, expected SAR ${charged}`);
    }
  } catch (err) {
    problems.push(`the receipt viewer could not be opened for that row: ${err.message}`);
  }
  // Close the viewer before going back to the grid — its overlay sits over the row whose Download
  // href is read next.
  await subs.page.keyboard.press('Escape').catch(() => {});
  await subs.receiptModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // ---- The file itself — findings kept in their own list, see the note above ----
  let pdf = null;
  const fetched = await subs.fetchReceiptForPaidRow(target.index).catch((err) => ({ error: err.message }));
  if (fetched.error) {
    pdfProblems.push(`the receipt file could not be fetched: ${fetched.error}`);
  } else if (!fetched.href) {
    pdfProblems.push('that Paid row\'s Download control carries no href, so there is no receipt file behind it');
  } else if (fetched.status !== 200) {
    pdfProblems.push(`the receipt file answered HTTP ${fetched.status} (${fetched.href.slice(0, 80)})`);
  } else {
    pdf = await verifyPdfStatesCharge(fetched.bytes, { charged, planName, row: target });
    pdfProblems.push(...pdf.problems);
    pdfCurrencyProblems.push(...pdf.currencyProblems);
  }

  return result({ row: target, rowMatched: Boolean(row), panel, pdf });
}

// The receipt PDF's labelled money fields, as the live template renders them (captured
// 2026-07-31, scripts/probe-receipt-pdf-contents.js, three receipts at three amounts):
//
//   Fee Receipt Format | Receipt No: REC-007251 | Date: July 23, 2026 | Received from: <name>
//   Amount: $354.45 | For: Yearly Plan subscription (annual)
//   Description / Amount | Base Fee $1,500.00 | Taxes/Fees $0.00 | Discounts (if any) $750.00
//   Total Amount Paid $750.00
//
// Reading the fields BY LABEL rather than asking "does the charged amount appear anywhere" is the
// whole point, and the live data is why: on that receipt the header states $354.45 (right) while
// "Total Amount Paid" states $750.00 (wrong). A presence check over the whole document passes on
// a file that contradicts itself. Same reasoning as SubscriptionPage.readDiscountLine().
//
// "Amount" requires its colon so the table's own "Description Amount" heading cannot match it.
function parseReceiptFields(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  // Every way this product has been seen to mark a riyal, not just the two the template has used.
  // ﷼ (U+FDFC) is what the PayTabs page itself renders, and U+20C0 is the 2025 Saudi riyal sign —
  // so the day the receipt template marks its currency at all, it is as likely to use one of those
  // as the word "SAR". Leaving them out is not a harmless omission: the prefix is optional, so an
  // unrecognised symbol does not merely go unnoticed, it sits between the label and the digits and
  // every field comes back null — which the caller reports as "the template no longer has a Total
  // Amount Paid field this reader recognises". A FIX to the currency would have read as a second,
  // larger defect. Verified against a synthetic ﷼ receipt before this list was widened.
  const money = '(?:SAR|SR|USD|\\$|﷼|⃀|ر\\.?س)?\\s*([\\d,]+(?:\\.\\d+)?)';
  const grab = (label) => {
    const m = flat.match(new RegExp(`${label}\\s*:?\\s*${money}`, 'i'));
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  };
  const dateMatch = flat.match(/Date\s*:\s*([^|]{3,30}?)(?:\s+Received|\s+Amount|$)/i);
  return {
    headerAmount: grab('Amount\\s*:'),
    baseFee: grab('Base Fee'),
    taxes: grab('Taxes\\/?Fees'),
    discounts: grab('Discounts(?:\\s*\\(if any\\))?'),
    totalPaid: grab('Total Amount Paid'),
    date: dateMatch ? dateMatch[1].trim() : null,
    // 'SAR' | '$' | null. Anything that names the riyal counts as SAR — the word, either riyal
    // symbol, "SR", or the Arabic ر.س — because the assertion is that the plan is priced in SAR,
    // not that it is priced in one particular spelling of SAR. `\bSR\b` is anchored so it cannot
    // match inside a word.
    //
    // null is its own answer and must not collapse into either of the others: measured
    // 2026-09-09 (REC-007531) and again 2026-09-16 (REC-007557), the template dropped its "$"
    // WITHOUT adding SAR, so the receipt states bare figures. Reported as `currency === null`, the
    // caller can say that outright; folded into "not $", it would have passed silently.
    currency: /SAR|\bSR\b|﷼|⃀|ر\.?س/i.test(flat) ? 'SAR' : (/\$/.test(flat) ? '$' : null),
  };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

// { day+month numbers, 2-digit year } from either "23/07/26" or "July 23, 2026".
//
// Order-agnostic on purpose: the billing grid's own format has been observed as both MM/DD/YY and
// DD/MM/YY (SUBSCRIPTION_JIRA_VS_APP.md M4 vs 2026-07-31), so a reader that assumes one of them
// reports a false mismatch on the other. Comparing the SET of the two numbers plus the year is what
// both renderings genuinely have in common.
function dateParts(s) {
  const str = String(s || '');
  // A slash date's LAST component is the year, whether it is written "26" or "2026". Inferring the
  // year from "> 31" instead treats a two-digit year as a third day/month component, which reported
  // every receipt as date-mismatched — including correct ones.
  const slash = str.match(/(\d{1,4})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    return {
      parts: [...new Set([Number(slash[1]), Number(slash[2])])].sort((a, b) => a - b),
      year: Number(slash[3]) % 100,
    };
  }
  const nums = (str.match(/\d+/g) || []).map(Number);
  const monthIdx = MONTHS.findIndex((m) => new RegExp(m, 'i').test(str));
  const year = nums.find((n) => n > 31);
  const small = nums.filter((n) => n <= 31);
  const parts = monthIdx >= 0 ? [...small, monthIdx + 1] : small;
  return { parts: [...new Set(parts)].sort((a, b) => a - b), year: year === undefined ? null : year % 100 };
}

// Read a receipt PDF and check that what it STATES is what the candidate was charged.
//
// `problems` distinguishes outcomes that are different defects: the file is not a PDF; it is a PDF
// with no extractable text (an image-only receipt — unverifiable, so it is reported rather than
// passed over); its labelled total disagrees with the charge; or it disagrees with ITSELF.
//
// `currencyProblems` is returned SEPARATELY, and only ever holds the "$ on a product sold in SAR"
// finding. It is a different defect from a wrong total and it fires on every receipt, so a caller
// asserts it in its own step — see the note on collectRecordEvidence.
async function verifyPdfStatesCharge(bytes, { charged, planName, row } = {}) {
  const problems = [];
  const currencyProblems = [];
  // Evidence about a currency symbol DRAWN rather than written — see the null branch below.
  let currencyNote = null;
  const header = bytes.slice(0, 5).toString('latin1');
  if (header !== '%PDF-') {
    problems.push(`the downloaded receipt is not a PDF (it begins "${header}", ${bytes.length} bytes)`);
    return { text: '', pages: 0, problems, currencyProblems, amounts: [] };
  }
  if (bytes.length <= 1000) {
    problems.push(`the receipt PDF is only ${bytes.length} bytes, which is too small to be a real receipt`);
  }

  const { text, pages, error } = await extractPdfText(bytes);
  if (error) {
    problems.push(`the receipt PDF could not be parsed (${error}), so its contents are unverified`);
    return { text: '', pages, problems, currencyProblems, amounts: [] };
  }
  if (!text.replace(/[\s-]|\d+ of \d+/g, '')) {
    problems.push(
      'the receipt PDF carries no extractable text, so what it states cannot be verified — it is '
      + 'likely rendered as an image'
    );
    return { text, pages, problems, currencyProblems, amounts: [] };
  }

  const amounts = amountsIn(text);
  const f = parseReceiptFields(text);
  const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.01;

  if (charged !== null && charged !== undefined) {
    // The figure the document presents AS the total. This is the one that matters: it is what the
    // candidate, and anyone they show the receipt to, will read as the amount paid.
    if (f.totalPaid === null && f.headerAmount === null) {
      // Template changed shape — fall back to the weaker whole-document check rather than going
      // silent, and say which one ran.
      if (!statesAmount(text, charged)) {
        problems.push(
          `the receipt PDF states no "Total Amount Paid" or "Amount:" field this reader recognises, `
          + `and SAR ${charged} does not appear anywhere in it either; the figures it states are `
          + `${amounts.slice(0, 20).join(' / ')}`
        );
      }
    } else {
      if (f.totalPaid !== null && !near(f.totalPaid, charged)) {
        // Name the arithmetic the template actually did. Live 2026-07-31 it computes
        // Base Fee − Discounts and has no line for a pro-rata plan credit at all, so every
        // credited payment's total is overstated by exactly the credit.
        const viaBase = near(f.baseFee - (f.discounts || 0) + (f.taxes || 0), f.totalPaid)
          ? ' That is exactly Base Fee − Discounts (+ Taxes), so the receipt has no line for the '
            + 'pro-rata plan credit and its total omits it.'
          : '';
        problems.push(
          `the receipt PDF states "Total Amount Paid" ${f.totalPaid}, but the candidate was charged `
          + `SAR ${charged} (Base Fee ${f.baseFee}, Taxes ${f.taxes}, Discounts ${f.discounts}).${viaBase}`
        );
      }
      if (f.headerAmount !== null && !near(f.headerAmount, charged)) {
        problems.push(
          `the receipt PDF's "Amount:" field states ${f.headerAmount}, but the candidate was charged `
          + `SAR ${charged}`
        );
      }
      // Self-contradiction, which needs no external expectation at all: one document, two totals.
      if (f.totalPaid !== null && f.headerAmount !== null && !near(f.totalPaid, f.headerAmount)) {
        problems.push(
          `the receipt PDF contradicts itself — its "Amount:" field states ${f.headerAmount} while `
          + `"Total Amount Paid" states ${f.totalPaid}`
        );
      }
    }
  }

  if (f.currency === '$') {
    currencyProblems.push(
      'the receipt PDF prices everything in "$" although the plan is sold in SAR and the same '
      + 'document signs off "Talent Forge Saudi Arabia"'
    );
  } else if (f.currency === null) {
    // NO CURRENCY IN THE TEXT LAYER IS NOT THE SAME AS NO CURRENCY ON THE DOCUMENT, and reading it
    // that way produced a wrong bug report. Since 2026-09-16 the receipt prices every figure with
    // the Saudi Riyal sign DRAWN AS VECTOR PATHS (see the long note on currencyMarks()), so the
    // text layer states "Amount: 77.50" for a page that visibly reads "Amount: ⃀ 77.50".
    //
    // So the drawn mark is what settles it, and the three outcomes are kept apart because they are
    // three different findings:
    //   marks found     -> priced in SAR with a drawn symbol. NOT a defect. Recorded, because a
    //                      symbol no text extraction can see is still worth telling dev about:
    //                      copy-paste, search and screen readers all lose the currency.
    //   no marks        -> genuinely priced in nothing. The original finding, still a defect.
    //   check unusable  -> UNVERIFIED, reported as such. Never "absent" — assuming absence from a
    //                      check that could not run is exactly how this was misdiagnosed.
    const drawn = await currencyMarks(bytes);
    currencyNote = drawn;
    if (drawn.error || drawn.amounts === null) {
      currencyProblems.push(
        'the receipt PDF states no currency in its text layer, and whether one is DRAWN could not '
        + `be checked (${drawn.error || 'no result'}), so the currency is unverified rather than absent`
      );
    } else if (drawn.amounts === 0) {
      // The text layer states figures (they were parsed above) but the structural pass found no
      // amount to inspect, so the two readers disagree and neither verdict is trustworthy. Still a
      // failure — an unverified currency must not pass — but worded as what it is, so nobody files
      // "the receipt prices the plan in nothing" off a reader that did not run properly.
      currencyProblems.push(
        'the receipt PDF states no currency in its text layer, and the structural pass found no '
        + 'amount to inspect, so whether a symbol is drawn could not be established — the currency '
        + 'is unverified rather than known to be absent'
      );
    } else if (drawn.marked < drawn.amounts) {
      currencyProblems.push(
        `the receipt PDF prices ${drawn.unmarked} of its ${drawn.amounts} amounts with no currency `
        + 'at all — the text layer carries none and no symbol is drawn beside them either '
        + `(${drawn.marks.join('; ') || 'no marks found'})`
      );
    }
  }
  if (planName && !new RegExp(planName, 'i').test(text)) {
    problems.push(`the receipt PDF does not name the "${planName}" plan`);
  }
  // Calendar date, compared as a SET of components — see dateParts().
  if (row && row.date) {
    const want = dateParts(row.date);
    const got = dateParts(f.date || text);
    const missing = want.parts.filter((p) => !got.parts.includes(p));
    if (missing.length || (want.year !== null && got.year !== null && want.year !== got.year)) {
      problems.push(
        `the receipt PDF's date (${f.date || 'not found'}) does not match the billing row's `
        + `(${row.date})`
      );
    }
  }

  return { text, pages, problems, currencyProblems, currencyNote, amounts, fields: f };
}

// One report attachment describing everything that was reconciled, pass or fail. Deliberately
// verbose: the point of these scenarios is that a red run is actionable without re-running them,
// and re-running one costs a live signup and a real payment.
function describeReconciliation({ label, account, subtotal, discount, charged, gateway, record }) {
  // NAME THE ACCOUNT. These scenarios provision a throwaway candidate per run, so without this a
  // red row cannot be traced back to the account that produced it - recovering one meant decoding
  // the base36 timestamp out of the signup alias against the agent's candidate list. Same reason
  // the promo module attaches its agent/candidate pairing.
  const lines = [`${label}: subtotal SAR ${subtotal}, discount SAR ${discount}, charged SAR ${charged}.`];
  if (account) lines.push(`Account: ${account}.`);
  if (gateway) {
    lines.push(
      `Gateway: the PayTabs page asked for ${gateway.pageAmount === null ? '(no amount found)' : gateway.pageAmount}`
      + `; promo code sent with the payment call: ${gateway.promoSent || '(none)'}`
      + `; calls [${gateway.calls.join(' ; ')}]`
      + `; other numbers on the page [${(gateway.allAmounts || []).slice(0, 12).join(', ')}].`
    );
  }
  if (record) {
    if (record.row) lines.push(`Billing row: ${record.row.plan} / ${record.row.amountText} / ${record.row.date}.`);
    if (record.panel) lines.push(`Receipt panel: ${record.panel.plan} / ${record.panel.amountText} / ${record.panel.date}.`);
    if (record.pdf) {
      lines.push(`Receipt PDF (${record.pdf.pages} page(s)), amounts stated [${record.pdf.amounts.slice(0, 20).join(', ')}].`);
      // Recorded on a PASS as well as a failure: the currency symbol is vector artwork, so the
      // text excerpt below shows bare figures on a page that visibly prices them in SAR. Without
      // this line the attachment reads like the "priced in nothing" defect that was filed in error.
      const note = record.pdf.currencyNote;
      if (note && note.amounts) {
        lines.push(
          `Receipt PDF currency: none in the text layer; a symbol is DRAWN (vector paths) beside `
          + `${note.marked} of ${note.amounts} amounts [${note.marks.join(' ; ')}] — so the text `
          + 'excerpt below states bare figures for a page that reads "⃀ 77.50".'
        );
      } else if (note && note.error) {
        lines.push(`Receipt PDF currency: not in the text layer, and the drawn-symbol check failed (${note.error}).`);
      }
      lines.push(`PDF text: ${excerpt(record.pdf.text, 900)}`);
    }
  }
  const recordProblems = (record && record.problems) || [];
  const pdfProblems = (record && record.pdfProblems) || [];
  const currencyProblems = (record && record.pdfCurrencyProblems) || [];
  const problems = [...((gateway && gateway.problems) || []), ...recordProblems];
  lines.push(problems.length ? `PROBLEMS (in-app record): ${problems.join(' | ')}` : 'In-app record: no discrepancies.');
  if (record) {
    lines.push(pdfProblems.length
      ? `PROBLEMS (receipt PDF, the amount it states): ${pdfProblems.join(' | ')}`
      : 'Receipt PDF, the amount it states: no discrepancies.');
    lines.push(currencyProblems.length
      ? `PROBLEMS (receipt PDF, currency): ${currencyProblems.join(' | ')}`
      : 'Receipt PDF currency: SAR, as sold.');
  }
  return lines.join('\n');
}

module.exports = {
  collectGatewayEvidence,
  collectRecordEvidence,
  verifyPdfStatesCharge,
  describeReconciliation,
};
