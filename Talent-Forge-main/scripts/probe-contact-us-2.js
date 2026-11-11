// Read-only probe #2: the Contact Us modal's BEHAVIOUR - dependency reset, dismissal
// routes, whether a draft survives a reopen, and the screenshot upload rules.
// SUBMITS NOTHING.
require('dotenv').config();
const path = require('path');
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const J = (o) => JSON.stringify(o, null, 1);
const FIX = (f) => path.join(__dirname, '..', 'images to upload for testing', f);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const posts = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /api\/v1/.test(r.url()) && !/token/.test(r.url())) posts.push(r.method() + ' ' + r.url()); });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.CONTACTUS_EMAIL);
  await login.passwordInput.first().fill(process.env.CONTACTUS_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  const modal = () => page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
  const open = async () => {
    const b = page.getByRole('button', { name: /open menu/i });
    if (await b.count()) { await b.click(); await page.waitForTimeout(500); }
    await page.locator('nav button, aside button').filter({ hasText: 'Contact Us' }).first().click();
    await page.waitForTimeout(1200);
  };
  const pickCat = async (v) => { await modal().locator('button').nth(1).click(); await page.waitForTimeout(400); await page.locator(`[role="option"][id$="option-${v}"]`).click(); await page.waitForTimeout(800); };
  const pickIssue = async (n = 1) => { await modal().locator('button').nth(2).click(); await page.waitForTimeout(400); const o = page.locator('[role="option"]').nth(n); const t = await o.innerText(); await o.click(); await page.waitForTimeout(700); return t.trim(); };
  const issueValue = async () => modal().locator('select').nth(1).inputValue().catch(() => 'n/a');

  await open();
  console.log('=== A. REACHABLE FROM EVERY PAGE? ===');
  console.log('opened from /dashboard:', await modal().isVisible());

  console.log('\n=== B. CHANGING CATEGORY RESETS THE ISSUE? ===');
  await pickCat('technicalIssue');
  const chosen = await pickIssue(1);
  console.log(`picked issue "${chosen}" -> select value:`, await issueValue());
  await pickCat('documents');
  console.log('after switching category to Documents -> issue value:', await issueValue(), '| button label:', (await modal().locator('button').nth(2).innerText()).trim());
  console.log('submit disabled:', await modal().locator('button[type="submit"]').isDisabled());

  console.log('\n=== C. DISMISSAL ROUTES + DRAFT RETENTION ===');
  await modal().locator('textarea').fill('draft text that must not survive');
  await page.waitForTimeout(300);
  for (const [label, act] of [
    ['Escape', async () => page.keyboard.press('Escape')],
    ['Cancel', async () => modal().locator('button', { hasText: /^Cancel$/ }).click()],
    ['X (Close)', async () => modal().locator('button[aria-label="Close"]').click()],
  ]) {
    if (!(await modal().count())) await open();
    if (!(await modal().locator('textarea').inputValue())) { await pickCat('documents'); await modal().locator('textarea').fill('draft text that must not survive'); await page.waitForTimeout(300); }
    await act().catch((e) => console.log(label, 'ERROR', e.message.slice(0, 80)));
    await page.waitForTimeout(900);
    const gone = (await modal().count()) === 0 || !(await modal().isVisible().catch(() => false));
    console.log(`${label.padEnd(10)} -> closed: ${gone}`);
    if (gone) {
      await open();
      console.log(`${' '.repeat(10)}    reopened: category="${(await modal().locator('button').nth(1).innerText()).trim()}" description="${await modal().locator('textarea').inputValue()}"`);
    }
  }

  console.log('\n=== D. SCREENSHOT UPLOAD RULES ===');
  if (!(await modal().count())) await open();
  const fileInput = modal().locator('input[type="file"]');
  for (const f of ['less than 5MB.png', 'Exact10MB.png', '11Mb size.jpg', 'docx file.docx']) {
    const before = (await modal().innerText()).replace(/\s+/g, ' ');
    await fileInput.setInputFiles(FIX(f)).catch((e) => console.log('  setInputFiles refused:', e.message.slice(0, 90)));
    await page.waitForTimeout(2500);
    const after = (await modal().innerText()).replace(/\s+/g, ' ');
    const added = after.replace(before, '').trim();
    console.log(`\n  ${f}`);
    console.log('   delta text :', added.slice(0, 240) || '(none)');
    console.log('   alerts     :', J(await modal().locator('[role="alert"]').allInnerTexts().catch(() => [])));
    console.log('   remove btn :', await modal().locator('button[aria-label*="remove" i], button[aria-label*="delete" i]').count());
    console.log('   submit dis :', await modal().locator('button[type="submit"]').isDisabled());
  }
  console.log('\n  full modal text after uploads:\n', (await modal().innerText()).replace(/\n{2,}/g, '\n'));

  console.log('\n=== E. NOTHING WAS SUBMITTED ===');
  console.log(J(posts));
  await browser.close();
})();
