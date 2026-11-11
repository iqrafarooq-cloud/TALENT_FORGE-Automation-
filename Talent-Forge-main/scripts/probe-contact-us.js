// Read-only probe: the Candidate Portal's "Contact Us" modal (sidebar -> Contact Us).
// SUBMITS NOTHING - every dropdown is opened and read, the form is never sent.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => { if (/\/api\/v1\//.test(r.url())) reqs.push(`${r.method()} ${decodeURIComponent(r.url())}`); });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.CONTACTUS_EMAIL);
  await login.passwordInput.first().fill(process.env.CONTACTUS_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  // At >=1440px the sidebar is permanently rendered; narrower it is behind "Open menu".
  const openModal = async () => {
    const burger = page.getByRole('button', { name: /open menu/i });
    if (await burger.count()) { await burger.click(); await page.waitForTimeout(600); }
    await page.locator('nav button, aside button').filter({ hasText: 'Contact Us' }).first().click();
    await page.waitForTimeout(1200);
  };
  await openModal();
  const modal = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();

  console.log('=== 1. MODAL CONTRACT ===');
  console.log('text:\n' + (await modal.innerText()).replace(/\n{2,}/g, '\n'));
  console.log('\nheading:', await modal.locator('h1,h2,h3').allInnerTexts());
  console.log('testids:', J(await modal.locator('[data-testid]').evaluateAll((e) => e.map((x) => x.tagName + ' :: ' + x.getAttribute('data-testid')))));
  console.log('controls:', J(await modal.locator('input,textarea,select,button').evaluateAll((els) => els.map((e) => ({ tag: e.tagName, type: e.type, name: e.name, ph: e.placeholder, maxlength: e.getAttribute('maxlength'), accept: e.getAttribute('accept'), disabled: e.disabled, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), aria: e.getAttribute('aria-label') })))));

  console.log('\n=== 2. CATEGORY -> ISSUE DEPENDENCY MATRIX ===');
  const catBtn = modal.locator('button').nth(1);
  const cats = await modal.locator('select').first().evaluate((s) => [...s.options].map((o) => ({ v: o.value, t: o.text.trim() })).filter((o) => o.v));
  for (const c of cats) {
    await catBtn.click();
    await page.waitForTimeout(400);
    await page.locator(`[role="option"][id$="option-${c.v}"]`).click();
    await page.waitForTimeout(900);
    const m = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
    const state = await m.locator('select').evaluateAll((sels) => ({
      selectCount: sels.length,
      cat: sels[0].value,
      issueDisabled: sels[1] ? sels[1].disabled : 'NO SECOND SELECT AT ALL',
      issues: sels[1] ? [...sels[1].options].map((o) => o.text.trim()).filter(Boolean) : [],
    }));
    console.log(`${c.t} (${c.v}) ->`, J(state));
  }

  console.log('\n=== 3. SUBMIT GATING ===');
  const m = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
  const submit = m.locator('button[type="submit"]');
  const report = async (label) => console.log(label, '| submit disabled:', await submit.isDisabled(), '| counter:', (await m.locator('p', { hasText: /\/500/ }).first().innerText().catch(() => 'n/a')));
  await report('category only              ');
  console.log('visible field labels now:', (await m.innerText()).replace(/\s{2,}/g, ' | ').slice(0, 300));
  if (await m.locator('select').count() > 1) {
    await m.locator('button').nth(2).click(); await page.waitForTimeout(400);
    const firstIssue = page.locator('[role="option"]').first();
    const firstIssueText = await firstIssue.innerText();
    await firstIssue.click(); await page.waitForTimeout(700);
    await report(`+ issue "${firstIssueText.trim()}"`);
  } else {
    console.log('   (no issue dropdown rendered for this category)');
  }
  const ta = m.locator('textarea');
  await ta.fill('   '); await page.waitForTimeout(400);
  await report('+ whitespace-only description');
  await ta.fill('The assessment timer froze halfway through section two.'); await page.waitForTimeout(400);
  await report('+ real description         ');
  await ta.fill('x'); await page.waitForTimeout(300);
  await report('+ 1-char description       ');

  console.log('\n=== 4. DESCRIPTION CAP ===');
  await ta.fill('A'.repeat(600)); await page.waitForTimeout(400);
  console.log('typed 600 ->', (await ta.inputValue()).length, 'chars held | counter:', await m.locator('p', { hasText: /\/500/ }).first().innerText());

  console.log('\n=== 5. CLOSE / CANCEL CONTROLS ===');
  console.log('buttons in footer/header:', J(await m.locator('button').evaluateAll((e) => e.map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim()).filter(Boolean))));

  console.log('\n=== 6. API TRAFFIC SEEN (nothing submitted) ===');
  console.log(J([...new Set(reqs)].filter((r) => !/token|notifications|stats/.test(r)).slice(0, 30)));
  await browser.close();
})();
