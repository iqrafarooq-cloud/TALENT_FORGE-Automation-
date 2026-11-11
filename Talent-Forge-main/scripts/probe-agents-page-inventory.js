/* eslint-disable no-console */
// probe-agents-page-inventory.js - READ-ONLY. Every control the SuperAdmin Agents page renders,
// per tab, beside the payload behind the rows - the inventory a coverage audit is checked against.
// Opens the Filters modal and cancels it; clicks column headers only to see whether they sort.
//
// Run:  node scripts/probe-agents-page-inventory.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL;
const ORIGIN = new URL(BASE).origin;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const log = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\/agent\/\?/.test(r.url())) return;
    let j = null; try { j = await r.json(); } catch (_) { /* */ }
    log.push({ url: r.url().replace(/^.*\/api\/v1/, ''), j });
  });
  await page.goto(BASE);
  await page.locator('input[type="email"]').fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/agents|candidate/, { timeout: 90000 });
  head('sidebar / document');
  await page.goto(`${ORIGIN}/agents`); await page.waitForTimeout(6000);
  console.log('title:', await page.title());
  console.log('nav links:', JSON.stringify(await page.locator('nav a, aside a').evaluateAll((as) => as.map((a) => `${a.innerText.trim()}->${a.getAttribute('href')}`))));
  for (const [tab, q] of [['Active', ''], ['Invite Sent', '?tab=inviteSent'], ['Requires Attention', '?tab=requiresAttention'], ['Deactivated', '?tab=deactivated']]) {
    head(tab);
    log.length = 0;
    await page.goto(`${ORIGIN}/agents${q}`); await page.waitForTimeout(6000);
    const last = log[log.length - 1];
    console.log('request:', last && last.url, 'count', last && last.j && last.j.count);
    console.log('first result:', JSON.stringify(last && last.j && last.j.results && last.j.results[0]).slice(0, 700));
    console.log('tab labels:', JSON.stringify(await page.locator('[role="radio"]').allInnerTexts()));
    console.log('headers:', JSON.stringify(await page.locator('[role="columnheader"]').evaluateAll((hs) => hs.map((h) => ({ t: h.innerText.trim(), sort: h.getAttribute('aria-sort'), btn: !!h.querySelector('button,svg') })))));
    console.log('row 1:', JSON.stringify(await page.locator('[role="row"]').nth(1).locator('[role="gridcell"],[role="rowheader"]').allInnerTexts()));
    console.log('main buttons:', JSON.stringify(await page.locator('main button').evaluateAll((bs) => [...new Set(bs.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean))].slice(0, 30))));
    console.log('selects/inputs:', JSON.stringify(await page.locator('main input, main select').evaluateAll((xs) => xs.map((x) => `${x.tagName}:${x.type}:${x.placeholder || x.name || ''}`))));
    // pagination text and page-size
    const t = clean(await page.locator('main').innerText());
    console.log('tail:', t.slice(-200));
    // header click sorts?
    const h = page.locator('[role="columnheader"]').nth(1);
    log.length = 0;
    await h.click().catch(() => {});
    await page.waitForTimeout(2500);
    console.log('after header click requests:', JSON.stringify(log.map((l) => l.url)), 'url', page.url().replace(ORIGIN, ''));
    // filter modal groups
    const fb = page.getByRole('button', { name: /^filters/i }).first();
    if (await fb.count()) {
      await fb.click(); await page.waitForTimeout(1500);
      const d = page.locator('[role="dialog"]').last();
      console.log('filters modal:', clean(await d.innerText()).slice(0, 600));
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    } else console.log('no Filters button');
    // help icons / tooltips in headers
    console.log('header icons:', JSON.stringify(await page.locator('[role="columnheader"] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.outerHTML.slice(0, 80)))));
  }
  head('profile: Candidates tab paging and Activity Log controls');
  await page.goto(`${ORIGIN}/agents?candidateCount=1-50`); await page.waitForTimeout(6000);
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first().getByRole('button', { name: /^view$/i }).click();
  await page.waitForURL(/view\/\d+/); await page.waitForTimeout(5000);
  await page.getByRole('radio', { name: 'Candidates' }).click(); await page.waitForTimeout(4000);
  console.log('cand tab controls:', JSON.stringify(await page.locator('main button, main input').evaluateAll((bs) => [...new Set(bs.map((b) => (b.innerText || b.getAttribute('aria-label') || b.placeholder || '').trim()).filter(Boolean))])));
  console.log('cand headers:', JSON.stringify(await page.locator('[role="columnheader"]').allInnerTexts()));
  await page.getByRole('radio', { name: 'Activity Log' }).click(); await page.waitForTimeout(4000);
  console.log('activity controls:', JSON.stringify(await page.locator('main button, main input').evaluateAll((bs) => [...new Set(bs.map((b) => (b.innerText || b.getAttribute('aria-label') || b.placeholder || '').trim()).filter(Boolean))])));
  console.log('activity text:', clean(await page.locator('main').innerText()).slice(200, 700));
  await page.getByRole('radio', { name: 'Promo Tools' }).click(); await page.waitForTimeout(3000);
  console.log('promo controls:', JSON.stringify(await page.locator('main button').evaluateAll((bs) => [...new Set(bs.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean))])));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
