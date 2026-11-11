// The Filters modal's University combobox: how many options at each step, and what does
// clicking "Show suggestions" a SECOND time do? Read-only - no filter is ever applied.
require('dotenv').config();
const { chromium } = require('playwright');
const AgentsListingPage = require('../pages/AgentsListingPage');
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);

    const listing = new AgentsListingPage(page);
    await listing.runAndWaitForList(async () => { await listing.goto('Active'); });

    const state = async (label) => {
      const opts = await listing.universityOptions();
      const expanded = await page.evaluate(() => {
        const b = document.querySelector('[role="dialog"] button[aria-label="Show suggestions" i]');
        const i = document.querySelector('[role="dialog"] input[placeholder*="university" i]');
        return {
          btnExpanded: b ? b.getAttribute('aria-expanded') : null,
          inputExpanded: i ? i.getAttribute('aria-expanded') : null,
          inputValue: i ? i.value : null,
          listboxes: document.querySelectorAll('[role="listbox"]').length,
        };
      });
      line('  ' + label.padEnd(34) + ' options=' + String(opts.length).padEnd(4)
        + ' expanded(btn/input)=' + expanded.btnExpanded + '/' + expanded.inputExpanded
        + ' listboxes=' + expanded.listboxes + ' value=' + JSON.stringify(expanded.inputValue));
      return opts;
    };

    await listing.openFilters();
    line('\n--- Filters modal open ---');
    await state('before opening suggestions');

    await listing.openUniversitySuggestions();
    await state('after openUniversitySuggestions #1');

    await listing.typeUniversity('King');
    const afterType = await state('after typeUniversity("King") [fill]');
    line('    sample: ' + JSON.stringify(afterType.slice(0, 4)));

    await listing.openUniversitySuggestions();
    await state('after openUniversitySuggestions #2  <-- what the failing step does');

    await listing.openUniversitySuggestions();
    await state('after openUniversitySuggestions #3');

    // Does the control need real keystrokes, or is fill() enough?
    await listing.universityCombobox.fill('');
    await page.waitForTimeout(800);
    await state('after clearing');
    await listing.universityCombobox.click();
    await listing.universityCombobox.pressSequentially('King', { delay: 60 });
    await page.waitForTimeout(1200);
    const typed = await state('after pressSequentially("King")');
    line('    sample: ' + JSON.stringify(typed.slice(0, 4)));
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
