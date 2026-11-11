// Read-only probe: the markup of the Referral Codes widgets' code values on the agent dashboard,
// so the value locator in pages/ReferralCodesPage.js can be checked against what is rendered.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.fill(process.env.REFERRAL_AGENT_EMAIL);
  await login.passwordInput.fill(process.env.REFERRAL_AGENT_PASSWORD);
  await login.submitButton.click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  await page.getByText('Referral Codes').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => [...document.querySelectorAll('p')]
    .filter((p) => ['Agent Code', 'Promo Code'].includes(p.innerText.trim()))
    .map((label) => {
      const host = label.closest('div.flex-1') || label.parentElement.parentElement;
      return {
        label: label.innerText.trim(),
        hostClass: host && host.className,
        texts: host ? [...host.querySelectorAll('p,span,h1,h2,h3,h4,div')].filter((e) => !e.children.length && e.innerText.trim())
          .map((e) => ({ tag: e.tagName, cls: e.className, text: e.innerText.trim(), testid: e.getAttribute('data-testid') })) : [],
      };
    }));
  console.log(JSON.stringify(out, null, 1));
  // The Promo Code widget's Share Code modal: open it, dump it, close it. Shares nothing.
  await page.getByRole('button', { name: /share code/i }).last().click();
  await page.waitForTimeout(2500);
  const dialogs = await page.evaluate(() => [...document.querySelectorAll('[role=dialog], [data-testid*=modal]')].map((d) => ({
    role: d.getAttribute('role'), testid: d.getAttribute('data-testid'),
    headings: [...d.querySelectorAll('h1,h2,h3,h4,[role=heading],p')].slice(0, 8).map((h) => `${h.tagName}.${h.className} | ${h.innerText.trim().slice(0, 60)}`),
  })));
  console.log(JSON.stringify(dialogs, null, 1));
  await page.keyboard.press('Escape');
  await browser.close();
})();
