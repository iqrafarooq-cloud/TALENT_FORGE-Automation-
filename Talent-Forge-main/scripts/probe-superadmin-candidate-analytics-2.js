/* eslint-disable no-console */
// probe-superadmin-candidate-analytics-2.js - READ-ONLY follow-up: the Candidates by University
// widget once a university is chosen (donut, table, insights, empty state), whether a duration
// change re-queries it and whether a reload keeps it; duration persistence across the Analytics
// tabs; chart hover tooltips; the Co-op / Tamheer tabs; the institutions payload's fields.
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const head = (t) => console.log(`\n================ ${t} ================`);
const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const short = (u) => u.replace(/^https:\/\/[^/]+\/core\/api\/v1/, '');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const calls = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\/(analytics|institutions)/.test(r.url()) || r.request().method() !== 'GET') return;
    const rec = { url: r.url(), status: r.status(), body: null };
    calls.push(rec);
    try { rec.body = await r.json(); } catch (_) { /* */ }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await page.goto(`${ORIGIN}/candidate-analytics`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  head('A. institutions payload');
  const inst = calls.find((x) => /institutions\/\?page=1&page_size=500/.test(x.url));
  console.log('count', inst && inst.body.count, 'results', inst && inst.body.results.length, 'keys', inst && Object.keys(inst.body.results[0]), JSON.stringify(inst && inst.body.results.slice(0, 2)));
  const uniCard = page.locator('.candidates-by-university-card');
  const input = page.locator('[data-testid="admin-analytics-candidates-university-input"]');
  const optionCount = async () => page.locator('[role="listbox"] [role="option"]').count();
  await input.click(); await page.waitForTimeout(1500);
  console.log('options rendered on open', await optionCount(), 'listbox', await page.locator('[role="listbox"]').count());
  await page.keyboard.press('Escape');

  async function pick(name) {
    const at = calls.length;
    await input.click(); await input.fill(''); await input.pressSequentially(name, { delay: 30 });
    await page.waitForTimeout(1500);
    await page.locator('[role="option"]', { hasText: name }).first().click();
    await page.waitForTimeout(4000);
    return calls.slice(at);
  }

  if (process.env.SKIP_UNI) { await go(); return; }
  head('B. a university with candidates');
  let got = await pick('Al Maarefa University');
  console.log(got.map((x) => short(x.url)));
  console.log('input value', await input.inputValue(), 'url', page.url());
  console.log('card', c(await uniCard.innerText()));
  console.log('donut paths', await uniCard.locator('.recharts-pie-sector, .recharts-sector').count());
  console.log('table rows', await uniCard.locator('table tbody tr, [role="row"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())));
  const sec = uniCard.locator('.recharts-pie-sector, .recharts-sector').first();
  if (await sec.count()) { await sec.hover().catch(() => {}); await page.waitForTimeout(700); console.log('donut hover', c(await page.locator('.recharts-tooltip-wrapper').first().innerText().catch(() => ''))); }

  head('C. duration change with a university chosen, then reload');
  const trig = page.locator('[data-testid="admin-analytics-candidates-duration-select"]');
  let at = calls.length;
  await trig.click(); await page.waitForTimeout(500);
  await page.locator('[role="dialog"]').last().getByText('Monthly', { exact: true }).click();
  await page.waitForTimeout(4000); await page.keyboard.press('Escape');
  console.log('after Monthly', calls.slice(at).map((x) => short(x.url)), 'input', await input.inputValue());
  console.log('card', c(await uniCard.innerText()).slice(0, 300));
  at = calls.length;
  await page.reload(); await page.waitForTimeout(8000);
  console.log('after reload url', page.url(), 'input', await input.inputValue(), calls.slice(at).filter((x) => /candidates/.test(x.url)).map((x) => short(x.url)));

  head('D. a university with no candidates in the period');
  const all = (inst && inst.body.results) || [];
  for (const u of all.slice(5, 60)) {
    got = await pick(u.name);
    const r = got.find((x) => /by-university/.test(x.url));
    if (r && r.body && r.body.total_candidates === 0) {
      console.log('empty uni', u.name, JSON.stringify(r.body).slice(0, 300));
      console.log('card', c(await uniCard.innerText()));
      break;
    }
  }

  await go(); await browser.close(); return;
  async function go() { let at; const trig = page.locator('[data-testid="admin-analytics-candidates-duration-select"]');
  head('E. duration persistence across Analytics tabs');
  await page.goto(`${ORIGIN}/candidate-analytics?duration=Quarterly`); await page.waitForTimeout(6000);
  if (!(await page.locator('[data-testid="admin-nav-analytics-agents-link"]').isVisible())) await page.locator('[data-testid="admin-nav-analytics-menu"]').click().catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('[data-testid="admin-nav-analytics-agents-link"]').click(); await page.waitForTimeout(5000);
  console.log('agents tab url', page.url());
  await page.locator('[data-testid="admin-nav-analytics-candidates-link"]').click(); await page.waitForTimeout(5000);
  console.log('back on candidates url', page.url());
  at = calls.length;
  await page.goto(`${ORIGIN}/candidate-analytics?duration=forever`); await page.waitForTimeout(6000);
  console.log('?duration=forever ->', page.url(), calls.slice(at).filter((x) => /candidates/.test(x.url)).map((x) => short(x.url)));
  console.log('trigger', c(await trig.innerText()));

  head('F. city chart, hover, scroll');
  await page.goto(`${ORIGIN}/candidate-analytics`); await page.waitForTimeout(8000);
  const city = page.locator('.candidates-by-city-card');
  console.log('bars', await city.locator('.recharts-bar-rectangle').count());
  const bar = city.locator('.recharts-bar-rectangle').first();
  const bb = await bar.boundingBox().catch(() => null);
  if (bb) { await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 }); await page.waitForTimeout(800); }
  console.log('city tooltip', await city.locator('.recharts-tooltip-wrapper').allInnerTexts());
  console.log('legend', await city.locator('.recharts-legend-item-text').allInnerTexts().catch(() => []));
  console.log('scrollers', await city.evaluate((el) => Array.from(el.querySelectorAll('*')).filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible').map((e) => `${e.className.slice(0, 60)} ${e.scrollHeight}/${e.clientHeight}`)));
  console.log('city table', await city.locator('table tr').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' | ').trim())));

  head('G. learning trend hover + coop tabs');
  const prog = page.locator('.candidate-progress-and-learning-activity-card');
  const surf = prog.locator('.recharts-surface').first();
  const sb = await surf.boundingBox();
  if (sb) { await page.mouse.move(sb.x + sb.width * 0.7, sb.y + sb.height / 2, { steps: 6 }); await page.waitForTimeout(800); }
  console.log('progress tooltip', await prog.locator('.recharts-tooltip-wrapper').allInnerTexts());
  console.log('progress legend', await prog.locator('.recharts-legend-item-text, [class*="legend"]').allInnerTexts().catch(() => []));
  const coop = page.locator('.co-op-and-tamheer-progress-card');
  console.log('coop before', await coop.locator('.recharts-bar-rectangle').count(), await coop.locator('.recharts-legend-item-text').allInnerTexts());
  at = calls.length;
  await page.locator('[data-testid="admin-analytics-candidates-tab-tamheer"]').click(); await page.waitForTimeout(1500);
  console.log('tamheer checked', await page.locator('[data-testid="admin-analytics-candidates-tab-tamheer"]').getAttribute('aria-checked'), 'reqs', calls.length - at, 'url', page.url());
  const cs = coop.locator('.recharts-surface').first(); const cb = await cs.boundingBox();
  if (cb) { await page.mouse.move(cb.x + cb.width * 0.45, cb.y + cb.height / 2, { steps: 6 }); await page.waitForTimeout(800); }
  console.log('coop tooltip (tamheer, ~May)', await coop.locator('.recharts-tooltip-wrapper').allInnerTexts());
  await page.reload(); await page.waitForTimeout(6000);
  console.log('after reload tab co-op checked', await page.locator('[data-testid="admin-analytics-candidates-tab-co-op"]').getAttribute('aria-checked'));
  await page.locator('[data-testid="admin-analytics-candidates-tab-tamheer"]').focus();
  console.log('keyboard: tamheer focusable', await page.evaluate(() => document.activeElement.getAttribute('data-testid')));
  }
})().catch((e) => { console.error(e); process.exit(1); });
