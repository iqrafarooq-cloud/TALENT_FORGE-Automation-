/* eslint-disable no-console */
// THE HAZARD CommunityFormPage.saveButton FILTERS OUT AND THE GENERIC STEP DOES NOT.
//
// pages/CommunityFormPage.js:95 says outright: "Save is the form's submit; the crop modal also
// renders a 'Save', hence the type filter." The generic step in steps/signup.js is
// getByRole('button', {name:/save/i}).first() - no type filter, resolved in DOM ORDER. This
// probe opens the crop modal and leaves it open, then prints both resolutions. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');
const { imageFile } = require('../utils/imageFixtures');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();
  await p.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const f = new CommunityFormPage(p);
  await f.gotoCreate();

  // Put a valid cover on the file input WITHOUT confirming the crop, so the modal stays open.
  const file = imageFile('JPG', 8, 'cover');
  await f.fileInputs.first().setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await p.waitForTimeout(4000);

  const report = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('button'))
      .map((el, domIndex) => ({ domIndex, el }))
      .filter(({ el }) => /save/i.test(t(el)))
      .map(({ domIndex, el }) => ({
        domIndex, text: t(el), type: el.getAttribute('type'),
        disabled: el.disabled, visible: vis(el), inDialog: !!el.closest('[role="dialog"]'),
      }));
  });
  console.log(`\ncrop modal open? ${await p.locator('[role="dialog"]').first().isVisible().catch(() => false)}`);
  console.log(`every /save/i button, DOM order:\n${JSON.stringify(report, null, 1)}`);

  const generic = p.getByRole('button', { name: /save/i }).first();
  console.log(`\ngeneric step  getByRole(button,/save/i).first() -> ` + JSON.stringify({
    matches: await p.getByRole('button', { name: /save/i }).count(),
    text: (await generic.textContent() || '').trim(),
    type: await generic.getAttribute('type'),
    disabled: await generic.isDisabled(),
    inDialog: await generic.evaluate((el) => !!el.closest('[role="dialog"]')),
  }));
  console.log(`page object   f.saveButton                      -> ` + JSON.stringify({
    text: (await f.saveButton.textContent() || '').trim(),
    type: await f.saveButton.getAttribute('type'),
    disabled: await f.saveButton.isDisabled(),
    inDialog: await f.saveButton.evaluate((el) => !!el.closest('[role="dialog"]')),
  }));

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
