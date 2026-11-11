/* eslint-disable no-console */
// probe-community-readers.js — READ-ONLY. Drives the REWRITTEN CommunityPage readers against
// every empty state, so the feature file can be written against measured output rather than
// against what the readers are supposed to return.
//
// Specifically it answers, for each of the four states:
//   * what readEmptyState() reports as heading / body / fullText
//   * what it reports as clearCtas — the CTA is present only when a FILTER is applied
//   * what the GEOMETRIC spacing measurement gives, which is what replaced a padding+margin read
//     that returned 64px or -40px for the same visual state depending on which block won a sort
// and for the Majors popover:
//   * that searchInOpenFilter() narrows the list, is case-insensitive, matches mid-word, and
//     whether every option it returns actually contains the term
//   * what readFilterPopoverEmptyState() reports when nothing matches
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const lc = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

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

  console.log('\n=============== 1. listing search matches nothing ===============');
  await c.gotoList();
  await c.search('zzzz-no-such-university');
  console.log(`cards: ${(await c.readCards()).length}`);
  console.log(JSON.stringify(await c.readEmptyState(), null, 1));

  const ID = process.argv[2] || '37';
  await c.gotoCommunity(ID);
  await page.waitForTimeout(3000);

  console.log('\n=============== 2. member SEARCH matches nothing ===============');
  await c.searchMembers('zzzz-no-such-candidate');
  console.log(`member cards: ${(await c.readMemberCards()).length}`);
  console.log(JSON.stringify(await c.readEmptyState(), null, 1));
  await c.clearMemberSearch();
  await page.waitForTimeout(2000);

  console.log('\n=============== 3. Majors popover — its own search ===============');
  await c.openFilter('Majors');
  const opened = await c.readOpenFilterOptions();
  console.log(`opened: shape=${opened.shape} hasOwnSearch=${opened.hasOwnSearch} ${opened.count} option(s)`);
  console.log(`  ${JSON.stringify(opened.options)}`);

  const subject = (opened.options || []).find((o) => o.length > 6) || (opened.options || [])[0];
  for (const term of [String(subject).slice(0, 4), String(subject).slice(0, 4).toUpperCase(), String(subject).slice(2, 6).trim(), 'zzzz-no-such-major']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await c.searchInOpenFilter(term);
    const strays = r.options.filter((o) => !lc(o).includes(lc(term)));
    console.log(`\n  term ${JSON.stringify(term)} -> ${r.count} option(s), issuedRequest=${r.issuedRequest}`);
    console.log(`    ${JSON.stringify(r.options)}`);
    if (strays.length) console.log(`    STRAYS (do not contain the term): ${JSON.stringify(strays)}`);
    console.log(`    popover empty state: ${JSON.stringify(r.emptyState)}`);
  }
  await c.clearOpenFilterSearch();
  await c.closeAnyPopover();

  console.log('\n=============== 4. FILTER only matches nothing ===============');
  await c.openFilter('Majors');
  const pick = await c.searchInOpenFilter('Adult Education');
  console.log(`searched for "Adult Education" -> ${JSON.stringify(pick.options)}`);
  const applied = await c.selectFilterOption(0);
  console.log(`applied ${JSON.stringify(applied)}`);
  await c.closeAnyPopover();
  await c.settle(2000);
  console.log(`member cards: ${(await c.readMemberCards()).length}`);
  console.log(JSON.stringify(await c.readEmptyState(), null, 1));
  console.log(`filterState: ${JSON.stringify(await c.filterState())}`);

  console.log('\n=============== 5. SEARCH AND FILTER together ===============');
  await c.searchMembers('zzzz-no-such-candidate');
  console.log(JSON.stringify(await c.readEmptyState(), null, 1));

  console.log('\n=============== 6. "Clear all filters" restores everything ===============');
  const cta = c.clearAllFiltersCta();
  console.log(`CTA present: ${await cta.count()}`);
  await cta.click({ timeout: 20000 }).catch((e) => console.log('click failed:', e.message.split('\n')[0]));
  await c.settle(2500);
  console.log(JSON.stringify({
    searchField: await c.memberSearchInput.inputValue().catch(() => null),
    cards: (await c.readMemberCards()).length,
    filterState: await c.filterState(),
    anyFilterApplied: await c.anyFilterApplied(),
    emptyState: await c.readEmptyState(),
  }, null, 1));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
