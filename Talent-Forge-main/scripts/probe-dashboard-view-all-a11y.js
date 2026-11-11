// >>> THE ONE COMMAND THAT ANSWERS "can a keyboard user reach the dashboard's View all links?" <<<
//
// READ-ONLY: it signs in, walks the dashboard with the keyboard and navigates. It sends nothing,
// creates nothing and spends no fixture.
//
// Written because "the markup has no tabindex" is an inference, and an accessibility finding
// handed to dev needs measurement. Four independent checks, and the LAST one is the control that
// stops the whole thing being a harness artefact:
//   1. a REAL Tab walk (80 presses, enough to cycle the page twice) recording every focus stop;
//   2. programmatic focus() - a <span> with no tabindex cannot be focused even by script;
//   3. Enter and Space on it, in case activation worked without focus;
//   4. CONTROL - a real <button> on the same page ("Share Code"), which must focus with
//      tabIndex 0. Without this, "nothing focused" could just mean the walk was broken.
//
// Measured 2026-09-09 on AGENT_EMAIL: the walk never reaches a "View all" in two full cycles,
// focus() fails (tabIndex -1), Enter and Space do nothing, and the control focuses fine. The
// accessibility tree exposes each link as `generic` rather than `link`/`button` (read separately,
// via a Playwright a11y snapshot). Every destination IS keyboard-reachable through the sidebar's
// real <a href> links, so the defect blocks the shortcut and not the listings.
// READ-ONLY. Can a keyboard user reach the dashboard's "View all" links?
// A REAL Tab walk, plus Enter/Space activation attempts. Navigates only; changes nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const l = new LoginPage(page); await l.navigate();
  await l.emailInput.first().fill(process.env.AGENT_EMAIL);
  await l.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await l.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
  await page.goto('https://dev.talentforge.com.sa/dashboard');
  await page.waitForTimeout(7000);

  const describe = () => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { tag: 'BODY' };
    return {
      tag: a.tagName, role: a.getAttribute('role'),
      label: (a.getAttribute('aria-label') || (a.innerText || '').trim().slice(0, 34) || null),
      isViewAll: (a.textContent || '').trim() === 'View all',
      insideViewAllHost: !!a.closest('div.cursor-pointer') && (a.innerText || '').includes('View all'),
    };
  });

  await page.locator('body').click({ position: { x: 2, y: 2 } });   // start focus at the top
  const walk = [];
  let reached = false;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const d = await describe();
    walk.push(d);
    if (d.isViewAll || d.insideViewAllHost) { reached = true; break; }
  }

  const labels = walk.map(w => `${w.tag}${w.role ? '[' + w.role + ']' : ''}:${w.label || ''}`);
  console.log('TAB STOPS (' + walk.length + '):');
  console.log(JSON.stringify(labels, null, 1));
  console.log('\n>>> DID TAB EVER REACH A "View all"? ', reached);

  // Could a keyboard user activate it even if they somehow focused it? Force focus and try both keys.
  const forced = await page.evaluate(async () => {
    const span = [...document.querySelectorAll('main span')]
      .find(e => !e.children.length && (e.textContent || '').trim() === 'View all');
    if (!span) return { error: 'not found' };
    span.focus();
    return { focusedAfterProgrammaticFocus: document.activeElement === span, tabIndexProp: span.tabIndex };
  });
  console.log('\nPROGRAMMATIC focus():', JSON.stringify(forced));

  const before = page.url();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const afterEnter = page.url();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  console.log('Enter navigated?', afterEnter !== before, '| Space navigated?', page.url() !== afterEnter,
              '| url now', page.url());

  // Control: does a real control on the same page behave properly under the keyboard?
  await page.goto('https://dev.talentforge.com.sa/dashboard');
  await page.waitForTimeout(5000);
  const control = await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(e => (e.innerText || '').trim() === 'Share Code');
    if (!b) return { error: 'no Share Code button' };
    b.focus();
    return { tag: b.tagName, focused: document.activeElement === b, tabIndex: b.tabIndex };
  });
  console.log('\nCONTROL (a real <button> on the same page):', JSON.stringify(control));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
