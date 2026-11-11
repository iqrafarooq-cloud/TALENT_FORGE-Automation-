// Read-only probe: what does the Active tab's "Candidate" rowheader actually render?
// Answers whether the email is present, and in what element — the assumption
// firstCandidate() makes (a <p> containing '@') had never been measured.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ActiveCandidatePage = require('../pages/ActiveCandidatePage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });

  const ac = new ActiveCandidatePage(page);
  await ac.navigate();
  await page.waitForTimeout(4000);

  console.log('URL:', page.url());
  console.log('rowCount:', await ac.rowCount());

  const dump = await page.$$eval('[role="row"]:has([role="rowheader"]) [role="rowheader"]', els =>
    els.slice(0, 3).map(e => ({
      innerText: e.innerText,
      pTags: [...e.querySelectorAll('p')].map(p => p.textContent.trim()),
      html: e.innerHTML.slice(0, 700),
    }))
  );
  console.log(JSON.stringify(dump, null, 2));

  // Does an email appear anywhere in a data row?
  const rowText = await page.$$eval('[role="row"]:has([role="rowheader"])', rows =>
    rows.slice(0, 3).map(r => r.innerText.replace(/\n/g, ' | '))
  );
  console.log('ROW TEXT:', JSON.stringify(rowText, null, 2));

  await browser.close();
})();
