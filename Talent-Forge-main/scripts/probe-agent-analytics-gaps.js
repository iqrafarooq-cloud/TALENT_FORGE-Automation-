/* eslint-disable no-console */
// probe-agent-analytics-gaps.js - READ-ONLY. Measures the Agents Analytics behaviours the
// feature file did not yet cover: the Avg. Candidates per Agent formula, dismissing and
// keyboard-driving both filter popovers, the 5th Agents Requiring Attention row, whether agent
// names are links, toggling a university off again, malformed ?university= values and chart
// hover tooltips. Drives the real AgentAnalyticsPage so probe and suite cannot disagree.
//
// Run: node scripts/probe-agent-analytics-gaps.js   (HEADED=true to watch)
require('dotenv').config();
const { chromium } = require('playwright');
const AgentAnalyticsPage = require('../pages/AgentAnalyticsPage');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const head = (t) => console.log(`\n================ ${t} ================`);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const ap = new AgentAnalyticsPage(page);
  ap.install();
  const reqs = [];
  page.on('request', (r) => { if (/\/api\//.test(r.url()) && r.method() !== 'OPTIONS') reqs.push(r.url()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  const first = await ap.open();

  head('A. Avg. Candidates per Agent formula');
  const ov = first.overview.body;
  console.log('overview', JSON.stringify(ov));
  for (const q of ['/candidate/?page=1&page_size=1&is_active=true', '/candidate/?page=1&page_size=1']) {
    const r = await ap.api(q);
    console.log(q, r.status, r.body && r.body.count);
  }
  const ro = await ap.readOverview();
  console.log('rendered overview', JSON.stringify(ro));

  head('B. Duration popover: Escape / outside click / keyboard');
  let at = reqs.length;
  await ap.openDuration();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  console.log('Escape closes:', !(await ap.popover().isVisible().catch(() => false)), 'requests:', reqs.length - at);
  await ap.openDuration();
  await page.mouse.click(5, 5);
  await page.waitForTimeout(800);
  console.log('outside click closes:', !(await ap.popover().isVisible().catch(() => false)), 'url', page.url());
  await ap.durationTrigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  console.log('Enter opens:', await ap.popover().isVisible().catch(() => false));
  const focusTrail = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press(i < 1 ? 'Tab' : 'ArrowDown');
    focusTrail.push(await page.evaluate(() => { const a = document.activeElement; return `${a.tagName} role=${a.getAttribute('role')} "${(a.innerText || '').trim().slice(0, 30)}"`; }));
  }
  console.log('focus trail', focusTrail);
  at = reqs.length;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log('Enter on focused option -> url', page.url(), 'new reqs', reqs.slice(at).filter((u) => /analytics/.test(u)).length);
  await page.keyboard.press('Escape');

  head('C. University popover: Escape / toggle off / keyboard');
  await ap.open();
  await ap.openUniversity();
  const opts = await ap.readUniversityOptions();
  console.log('options', JSON.stringify(opts).slice(0, 400));
  at = reqs.length;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  console.log('Escape closes:', !(await ap.popover().isVisible().catch(() => false)), 'reqs', reqs.length - at);
  await ap.openUniversity();
  const firstOpt = ap.universityOptions.first();
  const name = (await firstOpt.innerText()).trim();
  await firstOpt.click(); await page.waitForTimeout(2500);
  console.log('after check url', page.url(), 'trigger', await ap.triggerText('university'));
  await firstOpt.click(); await page.waitForTimeout(2500);
  console.log('after uncheck url', page.url(), 'trigger', await ap.triggerText('university'), 'name', name);
  await page.keyboard.press('Escape');
  await ap.universityTrigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const uTrail = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    uTrail.push(await page.evaluate(() => { const a = document.activeElement; return `${a.tagName} testid=${a.getAttribute('data-testid')} "${(a.innerText || a.value || '').trim().slice(0, 30)}"`; }));
  }
  console.log('university focus trail', uTrail);
  await page.keyboard.press('Space'); await page.waitForTimeout(2500);
  console.log('Space on focused -> url', page.url());
  await page.keyboard.press('Escape');
  await ap.open();
  await ap.openUniversity();
  await ap.searchUniversity('   ');
  console.log('whitespace search options', (await ap.readUniversityOptions()).length, 'popover', (await ap.popoverText()).slice(0, 120));
  await ap.searchUniversity("King's <script>");
  console.log('unsafe search popover', (await ap.popoverText()).slice(0, 120));
  await page.keyboard.press('Escape');

  head('D. Malformed university values');
  for (const q of ['?university=abc', '?university=', '?university=117,abc', '?duration=Monthly&university=-1']) {
    at = reqs.length;
    try {
      await page.goto(`${new URL(BASE).origin}/agents-analytics${q}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      const sent = reqs.slice(at).filter((u) => /agent\/analytics\/overview/.test(u));
      console.log(q, '-> url', page.url(), 'overview reqs', sent, 'trigger', await ap.triggerText('university'), 'text', (await page.locator('main').first().innerText()).replace(/\s+/g, ' ').slice(0, 150));
    } catch (e) { console.log(q, 'ERR', e.message); }
  }

  head('E. Attention scroll / names clickable / tooltips');
  await ap.open('?duration=Year-to-Date');
  const att = await ap.readAttention();
  console.log('attention', JSON.stringify(att).slice(0, 600));
  await ap.scrollAttention();
  const lastRowVisible = await ap.card('attention').locator('main').first().evaluate((m) => {
    const kids = Array.from(m.querySelectorAll('li, [class*="row"], [class*="item"]'));
    const r = m.getBoundingClientRect();
    return kids.map((k) => { const b = k.getBoundingClientRect(); return `${(k.innerText || '').replace(/\s+/g, ' ').slice(0, 40)} visible=${b.top >= r.top - 1 && b.bottom <= r.bottom + 1}`; });
  }).catch((e) => e.message);
  console.log('after scroll rows', lastRowVisible);
  for (const c of ['performing', 'attention', 'revenue', 'backlog']) {
    const links = await ap.card(c).locator('a, button, [role="link"], [role="button"]').evaluateAll((els) => els.map((e) => `${e.tagName} "${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}" href=${e.getAttribute('href')}`));
    console.log(c, 'controls', links);
  }
  // click the first top-performing agent name
  const perfName = (await ap.readTopPerforming()).rows?.[0]?.agent || null;
  if (perfName) {
    at = reqs.length;
    const u0 = page.url();
    await ap.card('performing').getByText(perfName, { exact: true }).first().click().catch((e) => console.log('click err', e.message));
    await page.waitForTimeout(2000);
    console.log('click name', perfName, 'url changed', page.url() !== u0, page.url(), 'reqs', reqs.slice(at));
  }
  for (const c of ['revenue', 'documents']) {
    const bar = ap.card(c).locator('.recharts-bar-rectangle, .recharts-line-dot, .recharts-dot').last();
    const tgt = ap.card(c).locator('.recharts-bar-rectangle, .recharts-line-dot, .recharts-dot, .recharts-active-dot').first(); const box = await tgt.boundingBox().catch(()=>null) || await ap.card(c).locator('.recharts-surface').first().boundingBox();
    if (box) { await page.mouse.move(box.x+2, box.y+2); await page.mouse.move(box.x + box.width/2, box.y + box.height/2, {steps:5}); await page.waitForTimeout(1000); }
    const tip = await page.locator('.recharts-tooltip-wrapper').evaluateAll((els) => els.map((e) => `${getComputedStyle(e).visibility} "${(e.innerText || '').replace(/\s+/g, ' ')}"`));
    console.log(c, 'tooltip', tip, 'bar count', await bar.count());
  }
  console.log('backlog', JSON.stringify(await ap.readBacklog()).slice(0, 500));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
