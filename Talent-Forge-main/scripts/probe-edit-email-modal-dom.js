// probe-edit-email-modal-dom.js - the Update Email Address modal's DOM, dumped whole.
//
//   node scripts/probe-edit-email-modal-dom.js
//
// READ-ONLY: it opens the modal on the first Active agent and closes the browser. It never
// types in a field and never clicks Update.
//
// Written because `readEmailDialog()` reported the modal's field captions as `[]` on a modal
// that plainly renders all three - the class of reader that can only ever answer "absent".
// This prints what element each caption actually IS, so the reader can be built from the
// markup rather than from an assumption about it.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AgentsListingPage = require('../pages/AgentsListingPage');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management|\/analytics|\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  const listing = new AgentsListingPage(page);
  const result = await listing.runAndWaitForList(async () => { await listing.goto('Active'); });
  const agent = AgentsListingPage.agentsFrom(result.payload).find((r) => r.email && !r.pendingEmail);
  console.log('AGENT:', JSON.stringify({ name: agent.name, email: agent.email }));
  await listing.search(agent.name);
  await listing.openEmailDialog(agent.email);

  const dump = await page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((d) => /update email address/i.test(d.innerText || ''));
    if (!dialog) return { none: true };
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return {
      labelEls: Array.from(dialog.querySelectorAll('label')).map((l) => ({
        text: c(l.innerText), htmlFor: l.getAttribute('for'), cls: l.className,
      })),
      inputs: Array.from(dialog.querySelectorAll('input')).map((i) => ({
        id: i.id, name: i.name, placeholder: i.placeholder, value: i.value,
        disabled: i.disabled, readOnly: i.readOnly,
        ariaLabel: i.getAttribute('aria-label'), ariaLabelledby: i.getAttribute('aria-labelledby'),
      })),
      leafText: Array.from(dialog.querySelectorAll('p,span,div,h1,h2,h3,h4,legend'))
        .filter((e) => !e.children.length && c(e.innerText))
        .map((e) => ({ tag: e.tagName, text: c(e.innerText), cls: e.className })),
      buttons: Array.from(dialog.querySelectorAll('button')).map((b) => ({
        text: c(b.innerText), aria: b.getAttribute('aria-label'), disabled: b.disabled,
      })),
      html: dialog.outerHTML,
    };
  });
  const { html, ...rest } = dump;
  console.log(JSON.stringify(rest, null, 1));
  console.log('\n==================== outerHTML ====================\n');
  console.log(html);
  await browser.close();
})();
