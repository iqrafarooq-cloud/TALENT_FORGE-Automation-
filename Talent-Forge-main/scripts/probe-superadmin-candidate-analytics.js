/* eslint-disable no-console */
// probe-superadmin-candidate-analytics.js - READ-ONLY. Maps the SuperAdmin Portal's
// Analytics > Candidates dashboard (/candidate-analytics): every control with its test id, every
// request with its params and payload, each widget's rendered text, the duration options and
// what each sends, the university dropdown, the Co-op/Tamheer tabs and the tooltips.
// Clicks nothing that writes.
//
// Run: node scripts/probe-superadmin-candidate-analytics.js [--section dump|filters|widgets]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const OUT = path.resolve(__dirname, '..', 'reports', 'probe-candidate-analytics');
const section = process.argv.find((a, i) => process.argv[i - 1] === '--section') || 'all';
const head = (t) => console.log(`\n================ ${t} ================`);
const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const calls = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/api\//.test(u) || r.request().method() === 'OPTIONS') return;
    const rec = { method: r.request().method(), url: u, status: r.status(), body: null };
    calls.push(rec);
    try { rec.body = await r.json(); } catch (_) { /* not json */ }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });

  let at = calls.length;
  await page.goto(`${ORIGIN}/candidate-analytics`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const first = calls.slice(at).filter((x) => x.method === 'GET');

  if (section === 'all' || section === 'dump') {
    head('A. URL and requests on default load');
    console.log(page.url());
    first.forEach((x) => console.log(x.status, x.url.replace(/^https:\/\/[^/]+/, '')));
    fs.writeFileSync(path.join(OUT, 'default-payloads.json'), JSON.stringify(first, null, 2));
    head('B. Controls');
    const d = await page.evaluate(() => {
      const cl = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main') || document.body;
      return {
        testids: Array.from(document.querySelectorAll('[data-testid]')).map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('data-testid')}] "${cl(e.innerText).slice(0, 50)}"`),
        sections: Array.from(main.querySelectorAll('section')).map((s) => `${s.className.split(' ')[0]} :: ${cl(s.innerText).slice(0, 400)}`),
        buttons: Array.from(main.querySelectorAll('button,[role="button"],[role="tab"],[role="radio"],a')).map((b) => `${b.tagName.toLowerCase()} role=${b.getAttribute('role')} "${cl(b.innerText).slice(0, 40)}" aria=${b.getAttribute('aria-label')} sel=${b.getAttribute('aria-selected') || b.getAttribute('aria-checked')} disabled=${b.disabled || b.getAttribute('aria-disabled')} testid=${b.getAttribute('data-testid')}`),
        nav: Array.from(document.querySelectorAll('a[href*="analytics"]')).map((a) => `${cl(a.innerText)} -> ${a.getAttribute('href')}`),
      };
    });
    console.log(JSON.stringify(d, null, 1));
  }

  if (section === 'all' || section === 'filters') {
    head('C. Duration options and what each sends');
    const trig = page.locator('[data-testid*="duration"]').first();
    console.log('trigger', await trig.count(), c(await trig.innerText().catch(() => '')));
    await trig.click().catch((e) => console.log('click', e.message));
    await page.waitForTimeout(800);
    const dlg = page.locator('[role="dialog"]').last();
    console.log('popover', c(await dlg.innerText().catch(() => '')), await dlg.locator('.list-option, [role="option"]').evaluateAll((els) => els.map((e) => `${e.innerText.trim()} checked=${!!e.querySelector('svg')} aria=${e.getAttribute('aria-selected')}`)).catch(() => []));
    await page.keyboard.press('Escape');
    for (const label of ['Monthly', 'Quarterly', 'Year-to-Date', 'Yearly']) {
      await trig.click(); await page.waitForTimeout(500);
      at = calls.length;
      await page.locator('[role="dialog"]').last().getByText(label, { exact: true }).first().click().catch((e) => console.log('pick', label, e.message));
      await page.waitForTimeout(5000);
      await page.keyboard.press('Escape');
      console.log(label, '->', page.url(), '\n   ', [...new Set(calls.slice(at).map((x) => x.url.replace(/^https:\/\/[^/]+/, '')))].join('\n    '));
    }
    head('D. University dropdown');
    const ut = page.locator('[data-testid*="university"]').first();
    console.log('trigger', await ut.count(), c(await ut.innerText().catch(() => '')), await ut.evaluate((e) => e.outerHTML.slice(0, 300)).catch(() => ''));
    at = calls.length;
    await ut.click().catch((e) => console.log('uni click', e.message));
    await page.waitForTimeout(2500);
    const pop = page.locator('[role="dialog"], [role="listbox"]').last();
    console.log('popover', c(await pop.innerText().catch(() => '')).slice(0, 600));
    console.log('opts', await pop.locator('[role="option"], [data-testid*="option"], .list-option').evaluateAll((els) => els.slice(0, 12).map((e) => `${e.tagName} ${e.getAttribute('data-testid')} "${e.innerText.trim()}"`)).catch(() => []));
    console.log('reqs', calls.slice(at).map((x) => x.url.replace(/^https:\/\/[^/]+/, '')));
    const second = pop.locator('[role="option"], [data-testid*="option"], .list-option').nth(1);
    at = calls.length;
    await second.click().catch((e) => console.log('pick uni', e.message));
    await page.waitForTimeout(5000);
    console.log('after picking ->', page.url(), 'trigger', c(await ut.innerText().catch(() => '')), '\n', calls.slice(at).map((x) => `${x.status} ${x.url.replace(/^https:\/\/[^/]+/, '')}`).join('\n'));
    const uniCard = calls.slice(at).find((x) => /universit/i.test(x.url));
    if (uniCard) console.log('payload', JSON.stringify(uniCard.body).slice(0, 1500));
  }

  if (section === 'all' || section === 'widgets') {
    head('E. Widgets: text, tabs, tooltips');
    await page.goto(`${ORIGIN}/candidate-analytics`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    const secs = page.locator('main section');
    const n = await secs.count();
    for (let i = 0; i < n; i += 1) console.log(`--- section ${i}: ${(await secs.nth(i).getAttribute('class') || '').slice(0, 80)}\n${c(await secs.nth(i).innerText()).slice(0, 900)}`);
    const tabs = page.getByRole('tab').or(page.getByRole('radio'));
    console.log('tabs', await tabs.evaluateAll((els) => els.map((e) => `${e.getAttribute('role')} "${e.innerText.trim()}" sel=${e.getAttribute('aria-selected') || e.getAttribute('aria-checked')}`)));
    const tam = page.getByText('Tamheer', { exact: true }).first();
    at = calls.length;
    await tam.click().catch((e) => console.log('tamheer', e.message));
    await page.waitForTimeout(3000);
    console.log('tamheer reqs', calls.slice(at).map((x) => x.url.replace(/^https:\/\/[^/]+/, '')), 'url', page.url());
    const helps = page.locator('main section button:not([data-testid])');
    const hc = await helps.count();
    for (let i = 0; i < hc; i += 1) {
      const b = helps.nth(i);
      const txt = c(await b.innerText().catch(() => ''));
      if (txt) continue;
      await page.mouse.move(2, 2); await page.waitForTimeout(200);
      await b.hover().catch(() => {}); await page.waitForTimeout(800);
      console.log('help', i, 'aria', await b.getAttribute('aria-label'), 'tip', await page.locator('[role="tooltip"]').allInnerTexts());
    }
    const placed = page.getByText('Placed', { exact: true }).first();
    await page.mouse.move(2, 2);
    await placed.hover().catch(() => {}); await page.waitForTimeout(800);
    console.log('Placed tooltip', await page.locator('[role="tooltip"]').allInnerTexts(), 'html', await placed.evaluate((e) => e.parentElement.parentElement.outerHTML.slice(0, 500)).catch(() => ''));
    fs.writeFileSync(path.join(OUT, 'all-calls.json'), JSON.stringify(calls, null, 2));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
