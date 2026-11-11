/* eslint-disable no-console */
// probe-community-pagination.js — READ-ONLY. Answers ONE question: does CommunityPage.nextPage
// actually resolve to the listing's next-page control?
//
// WHY IT EXISTS. `Given I have noted a community that is not on the first page of the listing`
// reported "the unfiltered listing offers no next page (12 card(s) on page 1)" on a listing that is
// documented as holding ~127 communities across ~11 pages. `nextPage` is
// `getByRole('button', { name: /^next$/i })`, an EXACT-name match, and collectAllPages() gates on
// the same locator:
//     const canGo = (await this.nextPage.count()) && !(await this.nextPage.isDisabled()...)
//     if (!canGo) break;
// so if it resolves to nothing, every "across every page" reader silently stops after page one and
// still reports a confident total. That would make the member-count scenario, the no-description
// fixture search and the cross-page search assertion all quietly wrong rather than red — which is
// exactly the failure mode this module keeps getting bitten by.
//
// So this dumps every plausible pagination control with its tag, role, accessible name, aria-label,
// text and disabled state, then reports what the CURRENT locator finds and whether walking pages
// actually advances the cards.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const c = new CommunityPage(page);
  await c.gotoList();

  console.log('\n=============== 1. what the listing renders ===============');
  console.log('url  :', page.url());
  console.log('cards:', (await c.readCards()).length);
  console.log('listing total (off the API):', await c.readTotalCount().catch((e) => `ERROR ${e.message}`));

  console.log('\n=============== 2. every candidate pagination control ===============');
  const controls = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('button, a, [role="button"], li'))
      .filter(vis)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: clean(el.innerText).slice(0, 40),
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        cls: clean(el.className).slice(0, 70),
        svgOnly: !clean(el.innerText) && !!el.querySelector('svg'),
      }))
      // Anything that smells like paging: a page number, a next/prev word, or a bare icon button.
      .filter((x) => /^\d{1,3}$/.test(x.text)
        || /next|prev|previous|page|»|«|›|‹/i.test(`${x.text} ${x.ariaLabel || ''} ${x.title || ''}`)
        || x.svgOnly);
  });
  controls.forEach((x) => console.log(' ', JSON.stringify(x)));
  if (!controls.length) console.log('  (nothing matched — the listing may not paginate at this size)');

  console.log('\n=============== 3. what the CURRENT locators resolve to ===============');
  console.log('nextPage.count():', await c.nextPage.count());
  console.log('prevPage.count():', await c.prevPage.count());
  for (const [label, loc] of [
    ['getByRole button /^next$/i', page.getByRole('button', { name: /^next$/i })],
    ['getByRole button /next/i', page.getByRole('button', { name: /next/i })],
    ['aria-label*=next', page.locator('[aria-label*="next" i]')],
    ['link /next/i', page.getByRole('link', { name: /next/i })],
    ['button title*=next', page.locator('button[title*="next" i]')],
    ['nav button count', page.locator('nav button, [role="navigation"] button')],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    console.log(`  ${label.padEnd(28)} -> ${await loc.count()}`);
  }

  console.log('\n=============== 4. does paging actually advance? ===============');
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const names = (await c.readCards()).map((x) => x.name);
    seen.push(names);
    console.log(`  page ${i + 1}: ${names.length} card(s) — ${names.slice(0, 3).join(' | ')}`);
    // eslint-disable-next-line no-await-in-loop
    const n = await c.nextPage.count();
    if (!n) { console.log('  nextPage resolved to nothing — collectAllPages() would BREAK here.'); break; }
    // eslint-disable-next-line no-await-in-loop
    if (await c.nextPage.isDisabled().catch(() => true)) { console.log('  nextPage is disabled — end of the listing.'); break; }
    // eslint-disable-next-line no-await-in-loop
    await c.nextPage.click();
    // eslint-disable-next-line no-await-in-loop
    await c.settle(1500);
  }
  const flat = seen.flat();
  console.log(`  distinct names across ${seen.length} page read(s): ${new Set(flat).size} of ${flat.length}`);

  console.log('\n=============== 5. collectAllPages() as the suite calls it ===============');
  await c.gotoList();
  const all = await c.collectAllPages(() => c.readCards(), 12);
  console.log(`  collectAllPages returned ${all.length} card(s); distinct: ${new Set(all.map((x) => x.name)).size}`);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
