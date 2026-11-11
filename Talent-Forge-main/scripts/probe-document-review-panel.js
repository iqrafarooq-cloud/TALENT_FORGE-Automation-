// probe-document-review-panel.js - what the agent's "Document Verification" panel is
// actually built from.
//
//     node scripts/probe-document-review-panel.js            # first flagged document
//     node scripts/probe-document-review-panel.js NAME-03    # a document by name fragment
//
// Read-only: it opens the panel and closes the browser. It never opens a decision dialog
// and never submits anything.
//
// This exists because "the original document is displayed" is an AC requirement and the
// element that displays it cannot be guessed. A first attempt asserted
// `iframe, embed, object, canvas, img[src*="documents"]` and found nothing on a panel
// that was plainly rendering the document on screen - the same class of mistake CLAUDE.md
// records for the disabled-promo greying and the save toast, where a locator built from
// an assumption could only ever answer "absent".
//
// It prints every element in the panel with a usable box, largest first, so the real
// viewer is identifiable rather than inferred.

'use strict';

require('dotenv').config();

const { chromium } = require('playwright');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

(async () => {
  const term = process.argv[2] || '';
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const mutations = [];
  page.on('request', (r) => {
    if (/\/core\/api\//.test(r.url()) && r.method() !== 'GET' && !/auth\/token/.test(r.url())) {
      mutations.push(`${r.method()} ${r.url()}`);
    }
  });

  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 60000 });
  await page.fill('input[type="email"], input[name="email"]', process.env.DOC_AGENT_EMAIL);
  await page.fill('input[type="password"], input[name="password"]', process.env.DOC_AGENT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 90000 });

  await page.goto(`${APP}/verifications?activeFilter=ALL`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (term) {
    await page.fill('input[placeholder*="Search" i]', term);
    await page.waitForTimeout(3000);
  }

  await page.locator('[data-testid="agent-verifications-view-button"]').first().click();
  const panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  // Sample the viewer every 500ms so "the panel is open", "the PDF is still loading" and
  // "a page has rendered" can be told apart. That distinction is the whole point: a naive
  // wait reads the loader and reports the document as absent.
  console.log("=== react-pdf render timeline ===");
  const t0 = Date.now();
  let settledAt = null;
  for (let i = 0; i < 60; i++) {
    const st = await panel.evaluate(() => ({
      loading: !!document.querySelector(".react-pdf__message--loading"),
      error: !!document.querySelector(".react-pdf__message--error"),
      pages: document.querySelectorAll(".react-pdf__Page").length,
      canvases: document.querySelectorAll(".react-pdf__Document canvas").length,
      textLayers: document.querySelectorAll(".react-pdf__Page__textContent").length,
    }));
    if (i % 4 === 0 || (!st.loading && !settledAt)) {
      console.log(`  +${String(Date.now() - t0).padStart(6)}ms  loading=${st.loading} error=${st.error} pages=${st.pages} canvases=${st.canvases} textLayers=${st.textLayers}`);
    }
    if (!st.loading && (st.canvases > 0 || st.pages > 0)) { settledAt = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  console.log(settledAt === null ? "  NEVER SETTLED within 30s" : `  settled after ${settledAt}ms`);

  console.log('=========================================================');
  console.log(' every element in the panel with a usable box, largest first');
  console.log('=========================================================');
  const boxes = await panel.evaluate((root) => {
    const out = [];
    for (const e of root.querySelectorAll('*')) {
      const r = e.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      out.push({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role'),
        testid: e.getAttribute('data-testid'),
        cls: (e.className || '').toString().slice(0, 70),
        src: e.getAttribute('src') || e.getAttribute('data') || null,
        w: Math.round(r.width),
        h: Math.round(r.height),
        kids: e.children.length,
        textLen: (e.textContent || '').length,
      });
    }
    return out.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 25);
  });
  for (const b of boxes) {
    console.log(
      `  ${String(b.w).padStart(4)}x${String(b.h).padStart(4)}  ${b.tag.padEnd(8)}` +
        `${(b.testid ? `[${b.testid}]` : '').padEnd(22)} kids=${String(b.kids).padEnd(3)} text=${String(b.textLen).padEnd(6)}` +
        `${b.src ? ' src=' + b.src.slice(0, 60) : ''}  ${b.cls}`
    );
  }

  console.log('\n=========================================================');
  console.log(' viewer-ish elements specifically');
  console.log('=========================================================');
  for (const sel of ['iframe', 'embed', 'object', 'canvas', 'img', 'svg', '[class*="pdf" i]', '[class*="viewer" i]', '[class*="page" i]']) {
    const n = await panel.locator(sel).count();
    if (!n) continue;
    const first = panel.locator(sel).first();
    const box = await first.boundingBox().catch(() => null);
    console.log(`  ${sel.padEnd(22)} count=${String(n).padEnd(4)} first box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'none'}`);
  }

  console.log('\n=========================================================');
  console.log(' panel text (first 900 chars)');
  console.log('=========================================================');
  console.log((await panel.innerText()).slice(0, 900));

  console.log('\nNON-GET api calls (must be empty):', mutations.length ? mutations : '(none)');
  await browser.close();
})();
