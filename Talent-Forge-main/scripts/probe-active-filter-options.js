// Read-only probe: the Active tab's Filters modal, option by option.
// For every option: its label exactly as rendered, its control type, the URL param Apply writes,
// the API params the list request carries, and the server count beside the rendered row count.
// Applies filters and clears them; changes nothing on any account.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const ActiveCandidatePage = require('../pages/ActiveCandidatePage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.fill(process.env.AGENT_EMAIL);
  await login.passwordInput.fill(process.env.AGENT_PASSWORD);
  await login.submitButton.click();
  await page.waitForURL(/dashboard|candidates/, { timeout: 90000 });
  const ac = new ActiveCandidatePage(page);
  await ac.navigate();
  await page.waitForTimeout(3000);
  await ac.openFilters();
  const labels = await ac.filterModal.evaluate((d) =>
    [...d.querySelectorAll('label')].map((l) => ({
      text: l.innerText.replace(/\s+/g, ' ').trim(),
      type: (l.querySelector('input') || {}).type || null,
      testid: l.getAttribute('data-testid'),
    }))
  );
  console.log('MODAL LABELS', JSON.stringify(labels, null, 1));
  console.log('MODAL TEXT', (await ac.filterModal.innerText()).replace(/\n+/g, ' | '));
  await page.keyboard.press('Escape');
  for (const l of labels) {
    await ac.navigate();
    await page.waitForTimeout(2500);
    await ac.openFilters();
    const resp = page.waitForResponse((r) => /\/candidate\/active\//.test(r.url()) && r.request().method() === 'GET', { timeout: 20000 }).catch(() => null);
    await ac.filterModal.locator('label').filter({ hasText: l.text }).first().click();
    await ac.applyFilters();
    const r = await resp;
    let count = null;
    if (r) { try { count = (await r.json()).count; } catch {} }
    await page.waitForTimeout(2500);
    console.log(JSON.stringify({ option: l.text, url: decodeURIComponent(page.url().split('?')[1] || ''), api: r ? decodeURIComponent(r.url().split('?')[1]) : 'NO REQUEST', count, rendered: await ac.rowCount() }));
  }
  await browser.close();
})();
