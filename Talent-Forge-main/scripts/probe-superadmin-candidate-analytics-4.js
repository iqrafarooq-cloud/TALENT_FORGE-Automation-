/* eslint-disable no-console */
// probe-superadmin-candidate-analytics-4.js - READ-ONLY. (1) per duration: the comparison labels
// and how many months each trend returns; (2) the University combobox search; (3) every widget
// with an EMPTY payload and with an HTTP 500 (page.route stubs - nothing reaches the server).
require('dotenv').config();
const { chromium } = require('playwright');

const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const EMPTY = {
  overview: { total_candidates: 0, total_candidates_change_percent: 0, active_candidates: 0, active_candidates_change: 0, in_onboarding_process: 0, in_onboarding_process_change: 0, requires_attention: 0, requires_attention_change: 0 },
  'by-city': { total_candidates: 0, city_breakdown: [], relocation_insights: [] },
  journey: { signed_up: 0, profile_complete: 0, track_started: 0, co_op_completed: 0, tamheer_completed: 0, track_completed: 0, placed: 0 },
  progress: { track_started: 0, track_started_change: 0, track_completed: 0, track_completed_change: 0, completion_rate: 0, completion_rate_change: 0, learning_activity_trend: [] },
  'coop-tamheer': { co_op_started: 0, co_op_started_change: 0, co_op_completed: 0, co_op_completed_change: 0, tamheer_started: 0, tamheer_started_change: 0, tamheer_completed: 0, tamheer_completed_change: 0, trend: { co_op_trend: [], tamheer_trend: [] } },
};
const CARDS = ['.total-agents-card', '.candidates-by-university-card', '.candidates-by-city-card', '.candidate-journey-full-card', '.candidate-progress-and-learning-activity-card', '.co-op-and-tamheer-progress-card'];

(async () => {
  const BASE = process.env.BASE_URL; const ORIGIN = new URL(BASE).origin;
  const b = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const bodies = {};
  page.on('response', async (r) => {
    const m = r.url().match(/analytics\/candidates\/([a-z-]+)\/\?duration=([a-z_]+)/);
    if (m) bodies[`${m[1]}|${m[2]}`] = await r.json().catch(() => null);
  });
  await page.goto(BASE);
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });

  console.log('=== per duration');
  for (const [q, api] of [['Monthly', 'current_month'], ['Quarterly', 'last_quarter'], ['Year-to-Date', 'ytd'], ['', 'yearly']]) {
    await page.goto(`${ORIGIN}/candidate-analytics${q ? `?duration=${q}` : ''}`); await page.waitForTimeout(7000);
    const labels = c(await page.locator('main').first().innerText()).match(/vs [a-z ]+?(?= [A-Z0-9]|$)/g);
    const prog = bodies[`progress|${api}`]; const co = bodies[`coop-tamheer|${api}`];
    console.log(q || 'Yearly', 'labels', [...new Set(labels || [])], 'progress months', prog && prog.learning_activity_trend.map((t) => t.month).join(','), 'coop months', co && co.trend.co_op_trend.length,
      'rendered x ticks', await page.locator('.candidate-progress-and-learning-activity-card .recharts-cartesian-axis-tick-labels').first().innerText().catch(() => ''));
  }

  console.log('=== university search');
  const input = page.locator('[data-testid="admin-analytics-candidates-university-input"]');
  for (const term of ['King', 'king saud', 'zzqq-none', '   ']) {
    await input.click(); await input.fill(''); await input.pressSequentially(term, { delay: 20 }); await page.waitForTimeout(1500);
    const opts = await page.locator('[role="listbox"] [role="option"]').allInnerTexts();
    console.log(JSON.stringify(term), opts.length, opts.slice(0, 5), 'listbox text', c(await page.locator('[role="listbox"]').innerText().catch(() => '(no listbox)')).slice(0, 80));
    await page.keyboard.press('Escape');
  }

  for (const mode of ['empty', '500']) {
    console.log(`=== ${mode}`);
    await page.route(/analytics\/candidates\/(overview|by-city|journey|progress|coop-tamheer|by-university)\//, (route) => {
      const key = route.request().url().match(/candidates\/([a-z-]+)\//)[1];
      if (mode === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"error"}' });
      const body = key === 'by-university' ? { total_candidates: 0, total_candidates_change_percent: 0, major_breakdown: [] } : EMPTY[key];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${ORIGIN}/candidate-analytics`); await page.waitForTimeout(7000);
    for (const sel of CARDS) console.log(sel, '::', c(await page.locator(sel).innerText().catch(() => '(absent)')).slice(0, 400));
    console.log('toast', c(await page.locator('.Toastify').innerText().catch(() => '')));
    await page.unroute(/analytics\/candidates\//);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
