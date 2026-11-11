// Why selectFromSearch() cannot fill "University/Institution Name" on the Education add form,
// when the same method fills Degree and Field of Study on the same form.
//
// Dumps the label text the form actually renders, the control each label owns, and what happens
// at each stage of opening / typing / choosing. NEVER SAVES.
//
// Usage: node scripts/probe-education-institution-field.js

'use strict';

require('dotenv').config();

const { chromium } = require('playwright');
const CandidateProfilePage = require('../pages/CandidateProfilePage');

const APP = process.env.DOC_APP_BASE_URL || 'https://dev.talentforge.com.sa';

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.DOC_CANDIDATE_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.DOC_CANDIDATE_PASSWORD);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
    await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 });

    const profile = new CandidateProfilePage(page);
    await profile.open();
    await profile.openAddModal('EDUCATION');

    // 1. What labels does the form actually render, and what control does each own?
    const layout = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') || document.body;
      return [...d.querySelectorAll('label')].map((l) => {
        const text = (l.textContent || '').replace(/\s+/g, ' ').trim();
        // The first form control after this label, in document order.
        const walker = document.createTreeWalker(d, NodeFilter.SHOW_ELEMENT);
        let seen = false;
        let ctrl = null;
        while (walker.nextNode()) {
          const n = walker.currentNode;
          if (n === l) { seen = true; continue; }
          if (!seen) continue;
          if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(n.tagName)) { ctrl = n; break; }
        }
        return {
          label: text,
          control: ctrl
            ? {
                tag: ctrl.tagName.toLowerCase(),
                type: ctrl.type || null,
                placeholder: ctrl.placeholder || null,
                role: ctrl.getAttribute('role'),
                text: (ctrl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
                value: ctrl.value !== undefined ? ctrl.value : null,
              }
            : null,
        };
      });
    });
    console.log('='.repeat(78));
    console.log(' LABELS AND THE CONTROL EACH ONE OWNS');
    console.log('='.repeat(78));
    for (const l of layout) {
      console.log(`  "${l.label}"`);
      console.log(`      -> ${l.control ? JSON.stringify(l.control) : '(no control found)'}`);
    }

    // 2. Does the xpath selectFromSearch() uses resolve at all before the popover is opened?
    const XPATH = (label) =>
      `xpath=//label[contains(normalize-space(.), ${JSON.stringify(label)})]/following::input[@placeholder='Search'][1]`;
    for (const label of ['University/Institution Name', 'Degree', 'Field of Study']) {
      const n = await page.locator(XPATH(label)).count();
      console.log(`\n  selectFromSearch xpath for "${label}" resolves to ${n} node(s) BEFORE opening anything`);
    }

    // 3. Open the institution control the way a person would, then look again.
    console.log('\n' + '='.repeat(78));
    console.log(' OPENING THE INSTITUTION CONTROL');
    console.log('='.repeat(78));
    const instLabel = page
      .locator('xpath=//label[contains(normalize-space(.), "Institution") or contains(normalize-space(.), "University")]')
      .first();
    const labelText = (await instLabel.textContent().catch(() => null)) || '(none)';
    console.log('  label found: ' + JSON.stringify(labelText.replace(/\s+/g, ' ').trim()));

    // The committed-value input that sits under this label.
    const valueInput = page
      .locator('xpath=//label[contains(normalize-space(.), "Institution") or contains(normalize-space(.), "University")]/following::input[1]')
      .first();
    console.log('  its first following input: placeholder=' + JSON.stringify(await valueInput.getAttribute('placeholder')));
    await valueInput.click({ timeout: 10000 }).catch((e) => console.log('  click threw: ' + e.message.split('\n')[0]));
    await page.waitForTimeout(1200);

    const afterOpen = await page.evaluate(() => {
      const searches = [...document.querySelectorAll('input[placeholder="Search"]')].map((i) => ({
        visible: !!(i.offsetParent || i.getClientRects().length),
        value: i.value,
      }));
      const opts = [...document.querySelectorAll('[role="option"], [role="listbox"] li')]
        .map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return { searches, optionCount: opts.length, firstOptions: opts.slice(0, 8) };
    });
    console.log('  Search inputs on page now: ' + JSON.stringify(afterOpen.searches));
    console.log('  options rendered: ' + afterOpen.optionCount);
    console.log('  first few: ' + JSON.stringify(afterOpen.firstOptions));

    // 4. Type and see what the list narrows to.
    const search = page.locator('input[placeholder="Search"]:visible').first();
    if (await search.count()) {
      await search.fill('King Saud');
      await page.waitForTimeout(2000);
      const narrowed = await page.evaluate(() =>
        [...document.querySelectorAll('[role="option"], [role="listbox"] li')]
          .map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      );
      console.log('\n  after typing "King Saud" -> ' + narrowed.length + ' option(s): ' + JSON.stringify(narrowed.slice(0, 10)));
      console.log('  NOTE: "King Saud University" is a SUBSTRING of "King Saud University (KSU)",');
      console.log('        so a hasText filter matches both and .first() picks by DOM order.');

      const exact = page.getByRole('option', { name: 'King Saud University', exact: true });
      console.log('  exact-name option count: ' + (await exact.count()));
      if (await exact.count()) {
        await exact.first().click();
        await page.waitForTimeout(800);
        console.log('  after clicking the exact option, committed value = ' + JSON.stringify(await valueInput.inputValue().catch(() => null)));
        console.log('  Save enabled now? ' + (await profile.saveIsEnabled()));
      }
    } else {
      console.log('\n  NO visible Search input after opening - the popover did not open on click.');
    }

    console.log('\nCancelling - nothing saved.');
    await profile.cancel().catch(() => {});
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
    await page.screenshot({ path: 'reports/probe-institution-field.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
