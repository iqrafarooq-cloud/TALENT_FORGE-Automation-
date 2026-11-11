/* eslint-disable no-console */
// probe-community-check-created.js — READ-ONLY. Answers "how many communities exist for university
// X?" without re-running a @creates-community scenario.
//
// WHY. Those scenarios each burn a university permanently and there are only ~10 left. When one dies
// AFTER its POST but BEFORE its assertion — as both did on 2026-08-03, on a step that searched the
// listing from the wrong page — the university is spent and the question it was asked is still
// unanswered. In particular "double-clicking Save creates exactly ONE community" is precisely the
// kind of thing a duplicate would prove, and it is readable off the listing afterwards for free.
//
// Usage: node scripts/probe-community-check-created.js "Bahria" "Bahria University Karachi"
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');

const TERMS = process.argv.slice(2);
const lc = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  if (!TERMS.length) { console.error('Pass one or more university names.'); process.exit(1); }
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
  console.log('listing total:', await c.readTotalCount().catch(() => '?'), '\n');

  for (const term of TERMS) {
    // eslint-disable-next-line no-await-in-loop
    await c.gotoList();
    // eslint-disable-next-line no-await-in-loop
    await c.search(term);
    // eslint-disable-next-line no-await-in-loop
    const cards = await c.readCards();
    const exact = cards.filter((x) => lc(x.name) === lc(term));
    console.log(`"${term}"`);
    console.log(`  cards returned : ${cards.length} — ${cards.map((x) => `${x.name} [${x.memberText || 'no count'}] id=${x.id}`).join(' | ') || '(none)'}`);
    console.log(`  EXACT matches  : ${exact.length} ${exact.length === 1 ? '(one community — no duplicate)' : exact.length === 0 ? '(NONE — was it really created?)' : '*** DUPLICATE — AC 3.1 allows one per university ***'}`);
    console.log('');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
