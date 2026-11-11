/* eslint-disable no-console */
// probe-agent-view-profile-mutations.js - >>> IT WRITES. <<< Mints ONE throwaway agent (live
// superadmin invite + IMAP, no promo, no payment), then drives every committing action on its
// SuperAdmin profile and prints the request and the answer for each:
//
//   1. Edit Target saved with a valid value, then with each unusable value (what the SERVER does
//      with "0", "-5", "abc", "", "5.5", a huge number - the form does not gate any of them)
//   2. Deactivate from the profile header menu, then Re-activate from it
//
// The throwaway is abandoned afterwards (an agent cannot be deleted). Nothing else is touched.
//
// Run:  node scripts/probe-agent-view-profile-mutations.js
require('dotenv').config();
const { chromium } = require('playwright');
const { provisionAgentWithoutPromo, loginSuperadmin } = require('../utils/promoAgentProvision');

const ORIGIN = new URL(process.env.BASE_URL).origin;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const agent = await provisionAgentWithoutPromo(browser, { label: 'view-probe', firstName: 'Viewprobe', tagPrefix: 'agview' });
  console.log('throwaway:', agent.name, agent.email);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const log = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\//.test(r.url()) || r.request().method() === 'GET') return;
    let body = null;
    try { body = await r.text(); } catch (_) { /* */ }
    log.push(`${r.request().method()} ${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')} req=${r.request().postData()} res=${String(body).slice(0, 300)}`);
  });
  await loginSuperadmin(page);
  await page.goto(`${ORIGIN}/agents`);
  await page.waitForTimeout(4000);
  await page.locator('input[type="search"]').first().fill(agent.email);
  await page.waitForTimeout(4000);
  await page.locator('[role="row"]', { hasText: agent.email }).getByRole('button', { name: /^view$/i }).first().click();
  await page.waitForURL(/\/agents\/view\/\d+/);
  await page.waitForTimeout(6000);
  const id = page.url().match(/view\/(\d+)/)[1];
  console.log('profile', id);

  head('1. Edit Target');
  for (const v of ['25', '0', '-5', 'abc', '', '5.5', '99999999999', '   ', '12']) {
    log.length = 0;
    await page.getByRole('button', { name: /^edit target$/i }).first().click();
    const d = page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first();
    await d.waitFor();
    const input = d.locator('input').first();
    await input.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    if (v) await page.keyboard.type(v);
    const save = d.getByRole('button', { name: /^save changes$/i }).first();
    console.log(`\n[${JSON.stringify(v)}] held=${JSON.stringify(await input.inputValue())} saveEnabled=${await save.isEnabled()}`);
    if (await save.isEnabled()) await save.click();
    await page.waitForTimeout(3000);
    const toasts = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"],[role="status"],.Toastify__toast')).map((e) => (e.innerText || '').trim()).filter(Boolean));
    const errs = await d.evaluate((el) => Array.from(el.querySelectorAll('p,span')).map((e) => e.innerText).filter((t) => t && t.length < 120)).catch(() => '(dialog closed)');
    console.log('  requests:', log.join('\n            '));
    console.log('  toasts:', JSON.stringify(toasts), '| dialog open:', await d.isVisible().catch(() => false), '| dialog text:', JSON.stringify(errs));
    if (await d.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const t = clean(await page.locator('main').first().innerText()).match(/(\d+)% (\d+) of (\d+) Candidates Onboarded/);
    console.log('  target block:', t && t[0]);
  }
  await page.reload();
  await page.waitForTimeout(6000);
  console.log('after reload target block:', (clean(await page.locator('main').first().innerText()).match(/(\d+)% (\d+) of (\d+) Candidates Onboarded/) || [])[0]);

  head('2. Deactivate from the profile');
  log.length = 0;
  await page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
  await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: /^deactivate$/i }).first().click();
  const dd = page.locator('[role="dialog"]').last();
  await dd.waitFor();
  await dd.getByRole('button', { name: /^deactivate$/i }).first().click();
  await page.waitForTimeout(4000);
  console.log('requests:', log.join('\n          '));
  console.log('url:', page.url().replace(ORIGIN, ''));
  console.log('toasts:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"],[role="status"],.Toastify__toast')).map((e) => e.innerText))));
  console.log('header now:', clean(await page.locator('main').first().innerText()).slice(0, 220));
  await page.reload(); await page.waitForTimeout(6000);
  console.log('after reload header:', clean(await page.locator('main').first().innerText()).slice(0, 220));

  head('3. Re-activate from the profile');
  log.length = 0;
  await page.getByRole('button', { name: 'Open menu', exact: true }).first().click();
  await page.locator('[role="menu"] [role^="menuitem"]').first().click();
  const rd = page.locator('[role="dialog"]').last();
  await rd.waitFor();
  await rd.getByRole('button', { name: /^re-?activate account$/i }).first().click();
  await page.waitForTimeout(4000);
  console.log('requests:', log.join('\n          '));
  console.log('url:', page.url().replace(ORIGIN, ''));
  console.log('toasts:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"],[role="status"],.Toastify__toast')).map((e) => e.innerText))));
  console.log('header now:', clean(await page.locator('main').first().innerText()).slice(0, 220));

  head('4. Promo Tools: open Add from the profile tab (read the request on save)');
  await page.getByRole('radio', { name: 'Promo Tools' }).first().click();
  await page.waitForTimeout(3000);
  console.log('promo tab:', clean(await page.locator('main').first().innerText()).slice(180, 500));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
