/* eslint-disable no-console */
// probe-agents-pagination-full.js - READ-ONLY. The SuperAdmin Agents listing's pager, measured
// end to end so every pagination scenario in Agent-Search-Filters-View.feature rests on a reading:
// the pager on each tab, what each control requests and writes to the URL, the numbered controls
// and any ellipsis, the summary text, and what a search, a filter, a tab switch, a reload and
// browser Back/Forward do to the page. Nothing is saved; the Filters modal is applied and cleared.
//
// Run:  node scripts/probe-agents-pagination-full.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const head = (t) => console.log(`\n================ ${t} ================`);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const reqs = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\/agent\/\?/.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* */ }
    reqs.push({ url: r.url().replace(/^.*\/api\/v1/, ''), count: body && body.count, n: body && body.results && body.results.length, first: body && body.results && body.results[0] && body.results[0].email });
  });
  const pager = () => page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null;
    const btns = Array.from(document.querySelectorAll('main button[aria-label$="Page"], main button[aria-label^="Page "]')).filter(vis);
    const nav = document.querySelector('main nav') || null;
    return {
      controls: btns.map((b) => `${b.getAttribute('aria-label')}${b.disabled ? '(dis)' : ''}${b.getAttribute('aria-current') ? '*' : ''}`),
      navLabel: nav && nav.getAttribute('aria-label'),
      navText: nav && (nav.innerText || '').replace(/\s+/g, ' ').trim(),
      ellipsis: Array.from(document.querySelectorAll('main *')).filter((e) => !e.children.length && /^(\.\.\.|…)$/.test((e.textContent || '').trim()) && vis(e)).length,
      summary: Array.from(document.querySelectorAll('main p, main span')).map((e) => (e.textContent || '').trim()).filter((t) => /\bof\b.*\d|showing|page \d/i.test(t) && t.length < 80).slice(0, 4),
      rows: Array.from(document.querySelectorAll('main [role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]') && /@/.test(r.innerText)).length,
      hiddenDup: Array.from(document.querySelectorAll('main button[aria-label^="Page "]')).filter((b) => !vis(b)).length,
    };
  });
  const step = async (label, fn, wait = 3500) => {
    reqs.length = 0;
    await fn();
    await page.waitForTimeout(wait);
    console.log(`-- ${label}\n   url ${page.url().replace(ORIGIN, '')}\n   req ${JSON.stringify(reqs)}\n   pager ${JSON.stringify(await pager())}`);
  };

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates)/, { timeout: 90000 });

  head('A. Active tab pager');
  await step('open /agents', () => page.goto(`${ORIGIN}/agents`), 6000);
  await step('Next', () => page.locator('main button[aria-label="Next Page"]:visible').first().click());
  await step('Next again', () => page.locator('main button[aria-label="Next Page"]:visible').first().click());
  await step('Page 1 numbered', () => page.locator('main button[aria-label="Page 1"]:visible').first().click());
  await step('Previous on page 1 (should be disabled)', async () => {
    console.log('   prev disabled?', await page.locator('main button[aria-label="Previous Page"]:visible').first().isDisabled());
  }, 300);
  const labels = (await pager()).controls;
  const lastLabel = labels.filter((l) => /^Page \d+/.test(l)).pop();
  await step(`last numbered (${lastLabel})`, () => page.locator(`main button[aria-label="${lastLabel.replace(/\(dis\)|\*/g, '')}"]:visible`).first().click());
  await step('Previous from there', () => page.locator('main button[aria-label="Previous Page"]:visible').first().click());

  head('B. URL, reload, Back/Forward');
  await step('goto ?page=3', () => page.goto(`${ORIGIN}/agents?page=3`), 6000);
  await step('reload', () => page.reload(), 6000);
  await step('Next (to 4)', () => page.locator('main button[aria-label="Next Page"]:visible').first().click());
  await step('browser Back', () => page.goBack(), 4000);
  await step('browser Forward', () => page.goForward(), 4000);

  head('C. search / filter / tab switch from a later page');
  await step('goto ?page=3', () => page.goto(`${ORIGIN}/agents?page=3`), 6000);
  await step('search "a"', async () => {
    const s = page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
    await s.fill('a');
  }, 4500);
  await step('clear search', async () => {
    const s = page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
    await s.fill('');
  }, 4500);
  await step('goto ?page=3 then open Filters, pick first option, Apply', async () => {
    await page.goto(`${ORIGIN}/agents?page=3`);
    await page.waitForTimeout(5000);
    reqs.length = 0;
    await page.getByRole('button', { name: /^filters/i }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('[role="dialog"] label').first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^apply/i }).first().click();
  }, 4500);
  await step('goto ?page=3 then switch to Deactivated tab', async () => {
    await page.goto(`${ORIGIN}/agents?page=3`);
    await page.waitForTimeout(5000);
    reqs.length = 0;
    await page.getByRole('radio', { name: 'Deactivated', exact: true }).first().click();
  }, 4500);

  head('D. each tab');
  for (const t of ['Invite Sent', 'Requires Attention', 'Deactivated']) {
    await step(`tab ${t}`, async () => {
      await page.goto(`${ORIGIN}/agents`);
      await page.waitForTimeout(5000);
      reqs.length = 0;
      await page.getByRole('radio', { name: t, exact: true }).first().click();
    }, 4500);
    const pg = await pager();
    if (pg.controls.some((c) => /^Next Page$/.test(c))) await step(`${t} Next`, () => page.locator('main button[aria-label="Next Page"]:visible').first().click());
  }

  head('E. a search narrowing to one page');
  await step('search an exact email', async () => {
    await page.goto(`${ORIGIN}/agents`);
    await page.waitForTimeout(5000);
    reqs.length = 0;
    await page.locator('main input[type="search"], main input[placeholder*="Search" i]').first().fill(process.env.AGENT_EMAIL || 'refagent');
  }, 4500);

  head('F. keyboard on the pager');
  await page.goto(`${ORIGIN}/agents`);
  await page.waitForTimeout(5000);
  const next = page.locator('main button[aria-label="Next Page"]:visible').first();
  await next.focus();
  console.log('focused:', await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
  await step('Enter on focused Next', () => page.keyboard.press('Enter'));
  await page.keyboard.press('Shift+Tab');
  console.log('after Shift+Tab focused:', await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.innerText));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
