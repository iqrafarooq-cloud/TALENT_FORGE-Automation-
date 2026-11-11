// Read-only probe #4: does the Contact Us form raise INLINE field errors at all, or is the
// disabled Submit its only feedback? SUBMITS NOTHING.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ContactUsPage = require('../pages/ContactUsPage');
const J = (o) => JSON.stringify(o, null, 1);

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
  await cu.openFromSidebar();

  const surfaces = async (label) => {
    const errs = await cu.errorSurfaces();
    const aria = await cu.modal.locator('[aria-invalid="true"]').count();
    const req = await cu.modal.locator('[required], [aria-required="true"]').count();
    console.log(`${label.padEnd(46)} submit=${(await cu.isSubmitEnabled()) ? 'ENABLED ' : 'disabled'} aria-invalid=${aria} required=${req} errors=${J(errs)}`);
  };

  console.log('=== A. DOES ANY INLINE ERROR EVER APPEAR? ===');
  await surfaces('on open, untouched');

  // focus then blur each control without entering anything - the classic "touched and empty" path
  await cu.descriptionInput.click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  await surfaces('description focused then blurred, empty');

  await (await cu.dropdownTrigger('category')).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await surfaces('category opened then dismissed, empty');

  await cu.fillDescription('typed then cleared');
  await page.waitForTimeout(400);
  await cu.fillDescription('');
  await page.waitForTimeout(900);
  await surfaces('description typed then cleared');

  await cu.fillDescription('   ');
  await page.waitForTimeout(900);
  await surfaces('description whitespace only');

  console.log('\n=== B. AT AND OVER THE 500 LIMIT ===');
  for (const n of [499, 500, 501, 600]) {
    await cu.fillDescription('A'.repeat(n));
    await page.waitForTimeout(500);
    console.log(`typed ${String(n).padStart(3)} -> held ${String((await cu.descriptionValue()).length).padStart(3)} | counter ${await cu.counterText()} | errors ${J(await cu.errorSurfaces())}`);
  }

  console.log('\n=== C. IS SUBMIT EVER CLICKABLE WHILE INCOMPLETE? ===');
  await cu.fillDescription('');
  await page.waitForTimeout(400);
  console.log('submit disabled attr:', await cu.submitButton.getAttribute('disabled'));
  console.log('submit aria-disabled:', await cu.submitButton.getAttribute('aria-disabled'));
  console.log('submit classes      :', (await cu.submitButton.getAttribute('class') || '').slice(0, 160));

  console.log('\n=== D. THE COUNTER AS THE DESCRIPTION GROWS ===');
  await cu.fillDescription('');
  for (const t of ['', 'a', 'hello', 'A'.repeat(250)]) {
    await cu.fillDescription(t);
    await page.waitForTimeout(300);
    console.log(`"${t.slice(0, 12)}${t.length > 12 ? '...' : ''}" (${t.length}) -> counter ${await cu.counterText()}`);
  }
  await b.close();
})();
