// probe-company-combobox.js - the exact DOM of the Add Experience "Company Name" control.
//
// The Education form's three comboboxes are driven successfully by clicking the
// input[placeholder="Search"] and typing. The SAME approach on Company Name is
// intercepted by a react-aria <span data-placeholder="true">, so the popover never opens
// and the field returns 0 options for every term - which reads exactly like "the
// reference data holds no companies". This dumps the control so the difference between
// the two widgets is visible rather than guessed at.
//
// NEVER SAVES.
'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const CandidateProfilePage = require('../pages/CandidateProfilePage');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  try {
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.DOC_CANDIDATE_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.DOC_CANDIDATE_PASSWORD);
    await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
    await page.waitForURL(/dashboard|profile/i, { timeout: 60000 });

    const profile = new CandidateProfilePage(page);
    await profile.open();

    for (const [cat, label] of [['WORKEXPERIENCE', 'Company Name'], ['EDUCATION', 'University/Institution Name']]) {
      const dialog = await profile.openAddModal(cat);
      console.log(`\n================ ${cat} / "${label}" ================`);
      const html = await dialog.evaluate((d, lbl) => {
        const label = [...d.querySelectorAll('label')].find((l) => (l.textContent || '').includes(lbl));
        if (!label) return 'LABEL NOT FOUND';
        // The control is the label's parent block; print it whole so both widgets can be
        // compared side by side.
        let host = label.parentElement;
        for (let i = 0; i < 3 && host && !host.querySelector('input'); i++) host = host.parentElement;
        return (host || label).outerHTML;
      }, label);
      console.log(html.replace(/></g, '>\n<').slice(0, 4000));
      await profile.cancel();
      await page.waitForTimeout(400);
    }
  } catch (e) {
    console.error('PROBE FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
