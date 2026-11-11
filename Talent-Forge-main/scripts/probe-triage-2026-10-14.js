/* eslint-disable no-console */
// probe-triage-2026-10-14.js - READ-ONLY. Settles which of the failures from the 2026-10-14 run are
// product changes and which are the suite. Nothing is decided, sent or saved: decision dialogs
// are never opened past reading the panel, and the invite POST is STUBBED (route.fulfill 200) so
// the UI's reaction to a successful send can be read without creating a candidate.
//
//   V  Verifications: the tab slugs in the URL vs the status sent, an unknown slug, and which
//      buttons the review panel offers on a Needs Review document
//   I  Invite via Email: what the UI shows after a (stubbed) successful send from In Progress,
//      the header invite label, and the In Progress row action states
//   A  Activity Log: the empty-state wording for a search with no match on the default range
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL;
const ORIGIN = new URL(BASE).origin;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

async function login(page, email, pw) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90000 });
  await page.evaluate(() => sessionStorage.setItem('agent_welcome_shown', '1')).catch(() => {});
}

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const reqs = [];
  page.on('request', (r) => { if (/\/api\/v1\//.test(r.url())) reqs.push(r.url().replace(/^.*\/api\/v1/, '')); });
  await login(page, process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD);

  head('V1. verification tabs');
  await page.goto(`${ORIGIN}/verifications`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('landed', page.url().replace(ORIGIN, ''));
  const tabs = await page.locator('[role="radio"]').allInnerTexts();
  console.log('tabs', JSON.stringify(tabs.map(clean)));
  for (const t of tabs.map(clean)) {
    reqs.length = 0;
    await page.locator('[role="radio"]').filter({ hasText: t }).first().click();
    await page.waitForTimeout(3000);
    console.log(`  ${t}: url=${page.url().replace(ORIGIN, '')} req=${reqs.filter((r) => /documents\/all/.test(r)).pop()}`);
  }
  for (const v of ['NOT_A_REAL_STATUS', 'AWAITING', 'needs-review']) {
    reqs.length = 0;
    await page.goto(`${ORIGIN}/verifications?activeFilter=${v}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const sel = await page.evaluate(() => (Array.from(document.querySelectorAll('[role="radio"]')).find((x) => x.getAttribute('aria-checked') === 'true') || {}).innerText);
    console.log(`  ?activeFilter=${v} -> url=${page.url().replace(ORIGIN, '')} selected="${clean(sel)}" req=${reqs.filter((r) => /documents\/all/.test(r)).pop()}`);
  }

  head('V2. review panel on a Needs Review document');
  await page.goto(`${ORIGIN}/verifications`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const nr = page.locator('[role="radio"]').filter({ hasText: /need/i }).first();
  await nr.click(); await page.waitForTimeout(4000);
  const row = page.locator('[role="row"]').filter({ has: page.locator('[data-testid="agent-verifications-view-button"]') }).first();
  console.log('row:', clean(await row.innerText().catch(() => '(none)')));
  await row.locator('[data-testid="agent-verifications-view-button"]').click().catch((e) => console.log('view click', e.message));
  await page.waitForTimeout(9000);
  const dlg = page.locator('[role="dialog"]').last();
  console.log('panel buttons:', JSON.stringify(await dlg.locator('button').evaluateAll((bs) => bs.map((x) => `${(x.innerText || x.getAttribute('aria-label') || '').trim()}${x.getAttribute('data-testid') ? `[${x.getAttribute('data-testid')}]` : ''}${x.disabled ? '(dis)' : ''}`))));
  console.log('panel text:', clean(await dlg.innerText()).slice(0, 600));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);

  head('I1. In Progress header + rows');
  await page.goto(`${ORIGIN}/candidates/in-progress`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('invite buttons:', JSON.stringify(await page.getByRole('button', { name: /invite/i }).allInnerTexts()));
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[role="row"]')).slice(1, 8).map((r) => ({ t: (r.innerText || '').replace(/\s+/g, ' ').slice(0, 90), resend: (() => { const b = r.querySelector('[data-testid="agent-candidates-resend-invite-button"]'); return b ? (b.disabled ? 'disabled' : 'enabled') : 'absent'; })() })));
  rows.forEach((r) => console.log(' ', r.resend, '|', r.t));

  head('I2. stubbed successful send from In Progress');
  await page.route(/\/agent\/invite\/candidate\/bulk\/?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"detail":"Emails sent successfully"}' }));
  await page.getByRole('button', { name: /invite candidate/i }).first().click();
  await page.waitForTimeout(1500);
  console.log('after invite click, dialogs:', JSON.stringify((await page.locator('[role="dialog"]').allInnerTexts()).map((t) => clean(t).slice(0, 160))));
  const viaEmail = page.getByText(/invite via email/i).first();
  if (await viaEmail.count()) { await viaEmail.click(); await page.waitForTimeout(1500); }
  const input = page.locator('[data-testid="agent-invite-email-input"]');
  if (await input.count()) {
    await input.fill('iqra.farooq+stubbedtriage@bytecorp.io'); await input.press('Enter');
    reqs.length = 0;
    await page.getByRole('button', { name: /send invites?/i }).first().click();
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      samples.push(JSON.stringify({ dialogs: (await page.locator('[role="dialog"]').allInnerTexts()).map((t) => clean(t).slice(0, 140)), toasts: (await page.locator('.Toastify__toast, [role="status"], [role="alert"]').allInnerTexts().catch(() => [])).map(clean).filter(Boolean) }));
    }
    console.log('requests:', JSON.stringify(reqs.filter((r) => /invite/.test(r))));
    [...new Set(samples)].forEach((s) => console.log('  ', s));
  } else console.log('no invite email input found');
  await page.unroute(/\/agent\/invite\/candidate\/bulk\/?$/);

  head('A1. Activity Log search-only empty state');
  await page.goto(`${ORIGIN}/activity-log`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  console.log('url', page.url().replace(ORIGIN, ''));
  const box = page.locator('main input').first();
  await box.click(); await box.pressSequentially('zzqx-no-match', { delay: 40 });
  await page.waitForTimeout(4000);
  console.log('url', page.url().replace(ORIGIN, ''));
  console.log('text:', clean(await page.locator('main').first().innerText()).slice(-260));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
