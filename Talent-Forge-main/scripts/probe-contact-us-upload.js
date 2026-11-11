// Read-only probe #3: the Contact Us screenshot upload - what the card renders, what the
// remove control really is, and how each file class is treated. SUBMITS NOTHING.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const J = (o) => JSON.stringify(o, null, 1);
const FIX = (f) => path.join(__dirname, '..', 'images to upload for testing', f);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.CONTACTUS_EMAIL);
  await login.passwordInput.first().fill(process.env.CONTACTUS_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(3000);
  const modal = () => page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
  const b = page.getByRole('button', { name: /open menu/i });
  if (await b.count()) { await b.click(); await page.waitForTimeout(500); }
  await page.locator('nav button, aside button').filter({ hasText: 'Contact Us' }).first().click();
  await page.waitForTimeout(1500);

  console.log('file input attrs:', J(await modal().locator('input[type="file"]').evaluateAll((e) => e.map((x) => ({ accept: x.accept, multiple: x.multiple, cls: x.className })))));

  for (const f of ['less than 5MB.png', 'Exact10MB.png', '11Mb size.jpg', 'docx file.docx', 'Screenshot 2026-07-24 184947_ZeeResizer.png']) {
    const bytes = fs.statSync(FIX(f)).size;
    console.log(`\n========== ${f} (${bytes} bytes = ${(bytes / 1048576).toFixed(2)} MB) ==========`);
    try {
      await modal().locator('input[type="file"]').setInputFiles(FIX(f), { timeout: 15000 });
    } catch (e) {
      console.log('  setInputFiles threw:', e.message.split('\n')[0]);
      continue;
    }
    await page.waitForTimeout(3000);
    const m = modal();
    console.log('  modal tail  :', (await m.innerText()).split('Upload Screenshot')[1]?.replace(/\s+/g, ' ').trim().slice(0, 200));
    console.log('  alerts      :', J(await m.locator('[role="alert"]').allInnerTexts().catch(() => [])));
    console.log('  page toasts :', J(await page.locator('.Toastify__toast').allInnerTexts().catch(() => [])));
    console.log('  buttons now :', J(await m.locator('button').evaluateAll((els) => els.map((x) => ({ t: (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 25), aria: x.getAttribute('aria-label'), type: x.type })))));
    // remove whatever was accepted, so the next file is judged on its own
    const del = m.locator('button[aria-label="Delete"], button[aria-label*="remove" i]');
    if (await del.count()) { await del.last().click(); await page.waitForTimeout(1200); console.log('  removed     : yes ->', (await modal().innerText()).includes('or drag and drop') ? 'dropzone restored' : 'dropzone NOT restored'); }
    else console.log('  removed     : no remove control found');
  }
  await browser.close();
})();
