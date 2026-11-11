// probe-verification-load-timing.js - where the time actually goes when a document
// verification scenario starts up.
//
//     node scripts/probe-verification-load-timing.js          # as the suite runs it
//     HEADED=false node scripts/probe-verification-load-timing.js
//     SLOWMO=0 HEADED=false node scripts/probe-verification-load-timing.js
//
// Read-only. Times each phase separately so "the portal loads very late" can be
// attributed rather than guessed at: browser launch, the login page painting, the
// credential round trip, the dashboard settling, the queue navigation, the table
// appearing, and the react-pdf render.
//
// It also reports what the SUITE's own defaults do to each phase - headed mode with
// slowMo, and every waitForLoadState('networkidle') - because those are ours, not the
// app's, and they are the first things to question.

'use strict';

require('dotenv').config();

const { chromium } = require('playwright');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');
const headed = process.env.HEADED !== 'false';
const slowMo = process.env.SLOWMO !== undefined ? Number(process.env.SLOWMO) : headed ? 50 : 0;

const marks = [];
let last = Date.now();
function mark(label) {
  const now = Date.now();
  marks.push({ label, ms: now - last });
  last = now;
  console.log(`  ${String(marks[marks.length - 1].ms).padStart(7)}ms  ${label}`);
}

(async () => {
  console.log('=========================================================');
  console.log(` headed=${headed}  slowMo=${slowMo}ms  (the suite's defaults are headed=true, slowMo=50)`);
  console.log('=========================================================');

  const t0 = Date.now();
  last = t0;

  const browser = await chromium.launch({ headless: !headed, slowMo });
  mark('chromium launch');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  mark('context + page');

  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  mark('goto /login (domcontentloaded)');

  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 60000 });
  mark('login form painted');

  await page.waitForLoadState('networkidle').catch(() => {});
  mark("login page networkidle  <-- OURS, not the app's");

  await page.fill('input[type="email"], input[name="email"]', process.env.DOC_AGENT_EMAIL);
  await page.fill('input[type="password"], input[name="password"]', process.env.DOC_AGENT_PASSWORD);
  mark('fill credentials');

  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 90000 });
  mark('submit -> left /login');

  await page.waitForLoadState('networkidle').catch(() => {});
  mark("dashboard networkidle  <-- OURS");

  await page.goto(`${APP}/verifications?activeFilter=ALL`, { waitUntil: 'domcontentloaded' });
  mark('goto /verifications (domcontentloaded)');

  await page.locator('table[role="grid"], table').first().waitFor({ state: 'visible', timeout: 30000 });
  mark('queue table visible');

  await page.waitForLoadState('networkidle').catch(() => {});
  mark("queue networkidle  <-- OURS");

  await page.locator('[data-testid="agent-verifications-view-button"]').first().click();
  const panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  mark('review panel visible');

  await panel.locator('.react-pdf__Page, canvas.react-pdf__Page__canvas').first().waitFor({ timeout: 60000 }).catch(() => {});
  mark('react-pdf page rendered');

  const total = Date.now() - t0;
  console.log('=========================================================');
  console.log(` TOTAL ${total}ms (${(total / 1000).toFixed(1)}s) to a fully rendered review panel`);
  console.log('');
  const ours = marks.filter((m) => m.label.includes('OURS')).reduce((a, m) => a + m.ms, 0);
  const launch = marks.filter((m) => /launch|context/.test(m.label)).reduce((a, m) => a + m.ms, 0);
  console.log(` of which:`);
  console.log(`   ${String(launch).padStart(7)}ms  browser startup (once per RUN, not per scenario)`);
  console.log(`   ${String(ours).padStart(7)}ms  our own networkidle waits`);
  console.log(`   ${String(total - ours - launch).padStart(7)}ms  the app`);
  console.log('=========================================================');

  await browser.close();
})();
