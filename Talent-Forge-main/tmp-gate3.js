require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('./pages/LoginPage');
const CandidateDetailsPage = require('./pages/CandidateDetailsPage');
(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const save = async () => page.locator('[role="dialog"]').last().evaluate((el) => {
    const btn = [...el.querySelectorAll('button')].find((x) => /^save/i.test(x.innerText.trim()));
    return btn ? btn.disabled : 'none';
  });
  try {
    const l = new LoginPage(page);
    await l.navigate();
    await l.emailInput.first().fill(process.env.VIEWPROFILE_E2E_CANDIDATE_EMAIL);
    await l.passwordInput.first().fill(process.env.VIEWPROFILE_E2E_CANDIDATE_PASSWORD);
    await l.submitButton.first().click();
    await page.waitForURL(/\/dashboard|\/profile|\/getting-started|\/onboarding/, { timeout: 60000, waitUntil: 'commit' });
    const d = new CandidateDetailsPage(page);
    await d.open();
    await d.openEditModal('Basic Information');
    await d.waitForModal();
    const dlg = page.locator('[role="dialog"]').last();

    const phone = dlg.getByPlaceholder(/phone/i).first();
    await phone.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('+966512345678');
    await d.blur();
    await page.waitForTimeout(1500);
    console.log('after a valid-looking phone:', await save());

    await d.typeInto(d.basicField('aboutMe'), 'Automation check ' + Date.now());
    await d.blur();
    await page.waitForTimeout(1500);
    console.log('then About Me:', await save());
    console.log('errors:', await dlg.evaluate((el) => [...el.querySelectorAll('[role="alert"],.text-error-primary')].map((e)=>e.textContent.trim()).filter(Boolean)));
    console.log('phone value now:', await phone.inputValue());
  } catch (e) { console.error('FAILED', e.message); } finally { await b.close(); }
})();
