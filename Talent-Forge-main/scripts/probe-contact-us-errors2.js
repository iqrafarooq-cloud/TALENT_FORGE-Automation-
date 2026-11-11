// Read-only probe #5: WHEN exactly does "Description is required." appear?
//
// Probe #4 answered this wrongly by running every case against ONE modal: the first case focused
// and blurred the field, so every later case inherited a field the form already considered
// "touched". Each case here gets a FRESH modal, and the blur is applied explicitly, so the rule
// is measured rather than inherited. SUBMITS NOTHING.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ContactUsPage = require('../pages/ContactUsPage');

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const l = new LoginPage(page);
  await l.navigate();
  await l.emailInput.first().fill(process.env.CONTACTUS_EMAIL);
  await l.passwordInput.first().fill(process.env.CONTACTUS_PASSWORD);
  await l.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  const cu = new ContactUsPage(page);

  const cases = [
    ['focus then blur, never typed', async () => {
      await cu.descriptionInput.click();
      await page.keyboard.press('Tab');
    }],
    ['type then clear, NO blur', async () => {
      await cu.fillDescription('something');
      await cu.fillDescription('');
    }],
    ['type then clear, THEN blur', async () => {
      await cu.fillDescription('something');
      await cu.fillDescription('');
      await cu.descriptionInput.click();
      await page.keyboard.press('Tab');
    }],
    ['spaces only, NO blur', async () => {
      await cu.fillDescription('   ');
    }],
    ['spaces only, THEN blur', async () => {
      await cu.fillDescription('   ');
      await cu.descriptionInput.click();
      await page.keyboard.press('Tab');
    }],
    ['blur empty, then type spaces (does the message survive?)', async () => {
      await cu.descriptionInput.click();
      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);
      await cu.fillDescription('   ');
    }],
    ['blur empty, then type real text (does it clear?)', async () => {
      await cu.descriptionInput.click();
      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);
      await cu.fillDescription('a real description');
    }],
  ];

  for (const [label, act] of cases) {
    // A FRESH modal per case - this is the whole point of the probe.
    if (await cu.isOpen()) await cu.close('cancel');
    await cu.openFromSidebar();
    await act();
    await page.waitForTimeout(1200);
    const errs = await cu.errorSurfaces();
    const submit = await cu.isSubmitEnabled();
    console.log(
      `${label.padEnd(52)} error=${JSON.stringify(errs).padEnd(32)} submit=${submit ? 'ENABLED' : 'disabled'}`
    );
  }
  await b.close();
})();
