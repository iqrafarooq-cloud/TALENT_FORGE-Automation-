/* eslint-disable no-console */
// probe-superadmin-agent-analytics.js - READ-ONLY. Maps the SuperAdmin Portal's
// Analytics > Agents dashboard: its sub-tabs, both global filters, every widget, the
// requests each one fires and the payload behind it. Clicks nothing that writes.
//
// Run:  node scripts/probe-superadmin-agent-analytics.js [--section dump|filters|widgets]
//       HEADED=true node scripts/probe-superadmin-agent-analytics.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';
const OUT = process.env.PROBE_OUT || path.resolve(__dirname, '..', 'reports', 'probe-agent-analytics');
const section = (process.argv.find((a, i) => process.argv[i - 1] === '--section')) || 'all';

const head = (t) => console.log(`\n================ ${t} ================`);

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
}

function recorder(page) {
  const calls = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/api\//.test(u) || r.request().method() === 'OPTIONS') return;
    const rec = { method: r.request().method(), url: u, status: r.status(), body: null };
    calls.push(rec);
    try { rec.body = await r.json(); } catch (_) { /* not json */ }
  });
  return calls;
}

async function dump(page) {
  return page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main') || document.body;
    return {
      url: location.href,
      title: c((main.querySelector('h1') || {}).innerText),
      testids: Array.from(main.querySelectorAll('[data-testid]')).map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('data-testid')}] ${c(e.innerText).slice(0, 60)}`),
      radios: Array.from(document.querySelectorAll('[role="radio"],[role="tab"]')).map((e) => `${e.getAttribute('role')} ${c(e.innerText)} checked=${e.getAttribute('aria-checked') || e.getAttribute('aria-selected')}`),
      buttons: Array.from(main.querySelectorAll('button,[role="button"],a')).map((b) => `${b.tagName.toLowerCase()} "${c(b.innerText).slice(0, 50)}" aria=${b.getAttribute('aria-label')} href=${b.getAttribute('href')} disabled=${b.disabled || b.getAttribute('aria-disabled')}`),
      headings: Array.from(main.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => `${h.tagName} ${c(h.innerText)}`),
      text: main.innerText,
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const calls = recorder(page);
  await login(page);
  head('landed');
  console.log(page.url());
  const nav = await page.evaluate(() => Array.from(document.querySelectorAll('nav a, aside a')).map((a) => `${a.innerText.replace(/\s+/g, ' ').trim()} -> ${a.getAttribute('href')}`));
  console.log(nav.join('\n'));

  await page.goto(`${ORIGIN}/agents-analytics`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  const d = await dump(page);
  head('dump');
  console.log(JSON.stringify({ ...d, text: undefined }, null, 2));
  head('text');
  console.log(d.text);
  await page.screenshot({ path: path.join(OUT, 'agents-analytics.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'calls-initial.json'), JSON.stringify(calls, null, 2));
  head('requests');
  for (const c of calls) console.log(c.status, c.method, c.url.replace(ORIGIN, ''));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
