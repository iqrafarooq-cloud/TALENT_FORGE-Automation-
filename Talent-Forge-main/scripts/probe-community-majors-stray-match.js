/* eslint-disable no-console */
// probe-community-majors-stray-match.js — READ-ONLY. Characterises one finding before a scenario
// is written to assert it.
//
// Measured 2026-08-03: searching the Majors filter popover for "AI p" returns three options —
// "AI prompter", "Ai prompter" and "Supply Chain Management". The third contains the term neither
// as a substring, nor case-insensitively, nor with spaces stripped, nor as a subsequence. A filter
// list that offers a value the user did not search for is a real defect, but a scenario should not
// assert it until it is known to be reproducible and its shape is understood — otherwise the
// failure message tells whoever reads the report less than this script does.
//
// Prints, for a spread of terms: every option returned, and which of them fail each candidate
// matching rule. If a term returns options that fail ALL of them, the list is not being filtered
// by the option's own name.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const lc = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Is `term` a subsequence of `text`? Checked because a fuzzy matcher is the usual explanation for
// a result that has no substring in common with the query.
const isSubsequence = (term, text) => {
  let i = 0;
  for (const ch of text) if (ch === term[i]) i += 1;
  return i === term.length;
};

const verdicts = (term, option) => {
  const t = lc(term);
  const o = lc(option);
  return {
    substring: o.includes(t),
    spacesStripped: o.replace(/\s+/g, '').includes(t.replace(/\s+/g, '')),
    anyWordPrefix: o.split(/\s+/).some((w) => w.startsWith(t.split(/\s+/)[0])),
    subsequence: isSubsequence(t, o),
  };
};

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
  await c.gotoCommunity(process.argv[2] || '37');
  await page.waitForTimeout(3000);
  await c.openFilter('Majors');

  // HYPOTHESIS UNDER TEST: the search splits the term on whitespace and requires every token to
  // appear ANYWHERE in the option, instead of matching the term as typed. That would explain
  // "Supply Chain Management" for "AI p" — it contains "ai" (ch-AI-n) and "p" (su-P-ply) — and it
  // predicts that "z a" and "a z" return the same set, and that a two-token term returns options
  // containing both tokens in either order.
  const TERMS = process.env.TERMS
    ? process.env.TERMS.split('|')
    : ['AI p', 'AI pr', 'ai prompter', 'Acc', 'Account', 'Arab', 'Supply', 'Engineering', 'z', 'Med', 'Law'];
  for (const term of TERMS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await c.searchInOpenFilter(term);
    const rows = r.options.map((o) => ({ option: o, ...verdicts(term, o) }));
    const total = rows.filter((x) => !x.substring && !x.spacesStripped && !x.anyWordPrefix && !x.subsequence);
    console.log(`\nterm ${JSON.stringify(term)} -> ${r.count} option(s)`);
    for (const row of rows) {
      const flags = Object.entries(row).filter(([k, v]) => k !== 'option' && v).map(([k]) => k);
      console.log(`   ${flags.length ? '   ' : '>> '}${JSON.stringify(row.option).padEnd(34)} matches by: ${flags.join(', ') || 'NOTHING'}`);
    }
    if (total.length) console.log(`   ** ${total.length} option(s) match the term by no rule at all: ${JSON.stringify(total.map((x) => x.option))}`);
  }

  // Is the stray stable, or does it move? Repeat the one term that produced it.
  console.log('\n=== repeatability of the "AI p" result (3 passes) ===');
  for (const i of [1, 2, 3]) {
    // eslint-disable-next-line no-await-in-loop
    await c.clearOpenFilterSearch();
    // eslint-disable-next-line no-await-in-loop
    const r = await c.searchInOpenFilter('AI p');
    console.log(`  pass ${i}: ${JSON.stringify(r.options)}`);
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
