// Text extraction for downloaded receipt PDFs.
//
// WHY THIS EXISTS. Until now every receipt assertion stopped at the file being a *real* PDF —
// HTTP 200, a `receipt….pdf` href, more than 1000 bytes, a `%PDF-` magic header — and the
// amount was cross-checked only between the receipt viewer's "Receipt information" panel and
// the billing-history row. Both of those are rendered by the same frontend from the same API
// payload, so agreeing with each other says nothing about whether the figure is right, and the
// PDF the candidate actually keeps was never read at all. The old comment in
// subscription.steps.js said so outright ("the PDF's text streams are compressed").
//
// They are compressed, but that is only an obstacle to a hand-rolled reader: pdf-parse is
// pdfjs-based and inflates them like any viewer would. So the file's contents are now readable
// and are asserted against what the candidate was actually charged.
//
// Note the API shape — pdf-parse v2 is a CLASS, not the v1 callable module: `new PDFParse({data})`
// then `await parser.getText()`. Verified locally against a hand-built PDF before use.

const { PDFParse } = require('pdf-parse');

// { text, pages, error } — never throws. A receipt that cannot be parsed is a *reportable
// finding*, not a crash: callers put `error` in their failure message so "the PDF is unreadable"
// and "the PDF says the wrong amount" read as the different defects they are.
async function extractPdfText(bytes) {
  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(bytes) });
    const result = await parser.getText();
    return {
      text: String(result.text || ''),
      pages: result.total || (result.pages || []).length || 0,
      error: null,
    };
  } catch (err) {
    return { text: '', pages: 0, error: err.message || String(err) };
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

// Every money-shaped token in a blob of text, as numbers.
//
// Deliberately currency-agnostic and format-agnostic: the same figure is rendered "SAR 155.00"
// on the receipt panel, "SAR 155" in the billing row and "1,500.0" on a Yearly invoice, and a
// reader that insists on one of those shapes reports a false mismatch. Thousands separators are
// stripped; a bare integer matches its own 2-decimal rendering because both parse to the same
// number.
function amountsIn(text) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const n = parseFloat(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// Does `text` state `amount` anywhere? Tolerance is one halala, so 124 / 124.0 / 124.00 all match.
function statesAmount(text, amount) {
  if (amount === null || amount === undefined) return false;
  return amountsIn(text).some((n) => Math.abs(n - amount) < 0.01);
}

// A short, readable excerpt for the failure message / report attachment. Receipt PDFs are one
// page of labelled fields, so collapsing whitespace keeps the whole thing legible in a report.
function excerpt(text, limit = 1200) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// ---------------------------------------------------------------------------------------------
// >>> THE RECEIPT'S CURRENCY SYMBOL IS VECTOR ARTWORK, NOT TEXT, AND NO TEXT READER CAN SEE IT <<<
//
// Measured 2026-09-16 on REC-007557 against REC-007228 (July), same template, same generator:
//
//   July:      glyph gid7 = "$" (U+24) then the digits — SEVEN glyphs, extracts as "$155.00"
//   September: glyph gid3 = " " (U+20) then the digits — SIX glyphs, extracts as " 77.50"
//
// and yet the September page plainly RENDERS a Saudi Riyal mark before every amount. It is drawn
// as PATHS: the operator census shows 15 more `constructPath` ops than July (3 per amount, 5
// amounts) with matching clips and transforms, and zero image operators. So there is no character
// there at all — `getTextContent()` is not missing it, there is nothing to miss.
//
// THIS COST A WRONG DIAGNOSIS. The suite reported "the receipt states every figure with NO currency
// at all" and it was filed as a product defect, when the product had in fact just been FIXED — the
// "$" was replaced with the official riyal sign. A reader that can only answer "absent" is exactly
// the trap this repo records elsewhere (readMemberCards, uploadedFileName, the promo save toast);
// here the reader was right about the text layer and wrong about the document.
//
// So the currency is established STRUCTURALLY instead: does a glyph-sized vector mark sit
// immediately to the left of each bare amount, where a currency symbol belongs? That is what
// distinguishes "priced with a drawn symbol" from "priced in nothing at all", which the text layer
// renders identical.
//
// Returns { amounts, marked, unmarked, marks, error }. On ANY failure to inspect it returns
// `error` and leaves the counts null — the caller must then report the currency as UNVERIFIED
// rather than absent. Reporting "no currency" when the check could not run is the whole bug above.

const mulMatrix = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// A bare amount is one the text layer shows with no currency on it — "77.50", "1,500.00". An
// amount that still carries its symbol ("$155.00") is not bare and needs no mark beside it, which
// is why the July control legitimately reports zero bare amounts.
const BARE_AMOUNT = /^\s*[\d,]+\.\d{2}\s*$/;

// Glyph-sized: a currency mark is about a character wide and tall. The table's own cell rules are
// zero-width verticals ~29 units tall and are excluded by the width test, so a receipt whose only
// vector art is its table borders reports `marked: 0` and correctly reads as having no symbol.
const GLYPH_MAX = 30;
const GLYPH_MIN_WIDTH = 1;
const LEFT_GAP = 60;

async function currencyMarks(bytes) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err) {
    return { amounts: null, marked: null, unmarked: null, marks: [], error: `pdfjs unavailable (${err.message})` };
  }
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    let amounts = 0;
    let marked = 0;
    const marks = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      /* eslint-disable no-await-in-loop */
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();
      const tc = await page.getTextContent();
      /* eslint-enable no-await-in-loop */

      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      const boxes = [];
      ops.fnArray.forEach((fn, i) => {
        const a = ops.argsArray[i];
        if (fn === pdfjs.OPS.save) { stack.push(ctm.slice()); return; }
        if (fn === pdfjs.OPS.restore) { ctm = stack.pop() || ctm; return; }
        if (fn === pdfjs.OPS.transform) { ctm = mulMatrix(a, ctm); return; }
        if (fn !== pdfjs.OPS.constructPath) return;
        // pdfjs has moved the bounding box between versions; take whichever shape is present and
        // simply skip a path we cannot place rather than guessing at coordinates.
        const mm = a[2] || (a[1] && a[1].minMax);
        if (!mm || mm.length < 4) return;
        const [x0, y0] = applyMatrix(ctm, mm[0], mm[1]);
        const [x1, y1] = applyMatrix(ctm, mm[2], mm[3]);
        boxes.push({
          x: Math.min(x0, x1), X: Math.max(x0, x1), y: Math.min(y0, y1), Y: Math.max(y0, y1),
        });
      });

      tc.items.filter((it) => BARE_AMOUNT.test(it.str)).forEach((it) => {
        amounts += 1;
        const x = it.transform[4];
        const y = it.transform[5];
        const hit = boxes.find((b) => b.X <= x + 2 && b.X > x - LEFT_GAP
          && b.Y > y - 6 && b.y < y + (it.height || 10) + 6
          && (b.X - b.x) >= GLYPH_MIN_WIDTH && (b.X - b.x) <= GLYPH_MAX && (b.Y - b.y) <= GLYPH_MAX);
        if (hit) {
          marked += 1;
          marks.push(`${it.str.trim()}: mark ${(hit.X - hit.x).toFixed(1)}x${(hit.Y - hit.y).toFixed(1)} `
            + `at gap ${(x - hit.X).toFixed(1)}`);
        }
      });
    }
    return { amounts, marked, unmarked: amounts - marked, marks, error: null };
  } catch (err) {
    return { amounts: null, marked: null, unmarked: null, marks: [], error: err.message || String(err) };
  }
}

module.exports = {
  extractPdfText, amountsIn, statesAmount, excerpt, currencyMarks,
};
