// Read-only probe: what the Active tab's View action lands on, sampled over time, and what the
// profile's "Back" control and the browser Back do. Writes nothing.
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
  await ac.clickQuickFilter('Subscribed');
  await page.waitForTimeout(2500);
  await ac.openFirstCandidateProfile();
  const t0 = Date.now();
  for (const at of [500, 2000, 5000, 10000]) {
    await page.waitForTimeout(at - (Date.now() - t0) > 0 ? at - (Date.now() - t0) : 0);
    const snap = await page.evaluate(() => ({
      url: location.href,
      headings: [...document.querySelectorAll('h1,h2,h3,[role=heading]')].map((h) => `${h.tagName}:${h.innerText.trim()}`).slice(0, 8),
      radios: [...document.querySelectorAll('[role=radio]')].map((r) => r.innerText.trim()),
      backs: [...document.querySelectorAll('*')].filter((e) => e.children.length < 3 && /^\s*back\s*$/i.test(e.innerText || '')).map((e) => `${e.tagName}.${e.className}`).slice(0, 5),
    }));
    console.log(`+${Date.now() - t0}ms`, JSON.stringify(snap));
  }
  await browser.close();
})();
