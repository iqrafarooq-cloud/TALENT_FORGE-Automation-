/* eslint-disable no-console */
// probe-community-universities-left.js — READ-ONLY, and the answer to "can I afford to run
// `@creates-community`?"
//
// Saving a community PERMANENTLY CONSUMES A UNIVERSITY: AC 3.1 offers only universities without an
// active community, and the module exposes no delete CTA anywhere, so nothing gives one back.
// CLAUDE.md says to check how many the Create dropdown still offers before spending them — this is
// the command for it. Nothing here saves, and nothing here types into the form.
//
// WHAT IT CAN AND CANNOT TELL YOU. University/Institute Name is a type-to-filter combobox that
// renders 12 options at a time and does NOT grow on scroll, so an open dropdown gives a FLOOR, not
// a count: 12 means "at least 12 remain", while fewer than 12 IS the remaining count. To get past
// the cap it also probes a few letters and unions the results — still a floor, but a much higher
// one, and enough to distinguish "plenty left" from "nearly out".
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CommunityPage = require('../pages/CommunityPage');
const CommunityFormPage = require('../pages/CommunityFormPage');

const LETTERS = (process.env.LETTERS || 'a,b,c,e,i,k,m,n,r,s,t,u').split(',');

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
  const existing = await c.readTotalCount().catch(() => null);
  console.log(`communities that already exist (listing's own total): ${existing === null ? '?' : existing}`);

  const f = new CommunityFormPage(page);
  await f.gotoCreate();
  await f.openUniversityDropdown();
  const open = await f.readOptions();
  console.log(`\nuniversities offered on OPEN: ${open.length}`
    + (open.length >= 12 ? '  (at the 12 cap — this is a FLOOR)' : '  (under the cap — this IS how many remain)'));
  console.log('  ' + open.join(' | '));

  if (open.length >= 12) {
    console.log('\nprobing letters to get past the cap (each result is also capped at 12):');
    const union = new Set(open);
    for (const letter of LETTERS) {
      // eslint-disable-next-line no-await-in-loop
      const got = await f.filterUniversityDropdown(letter);
      got.forEach((g) => union.add(g));
      console.log(`  "${letter}" -> ${got.length} option(s), union now ${union.size}`);
    }
    // If no letter surfaced anything the open list did not already hold, the cap was never actually
    // binding and the open list is the whole remaining set. That turns the floor into a count — worth
    // saying explicitly, because "at least 12" and "exactly 12" lead to different decisions.
    const grewPastOpen = union.size > open.length;
    console.log(`\n${grewPastOpen ? 'AT LEAST' : 'EXACTLY'} ${union.size} universities remain without a community.`);
    if (!grewPastOpen) {
      console.log('  (No letter surfaced anything beyond the 12 shown on open, so the cap was not');
      console.log('   binding and this is the full remaining set — not merely a floor. Caveat: only');
      console.log(`   these letters were probed — ${LETTERS.join(',')} — so a name containing none of`);
      console.log('   them would be missed. Override with LETTERS=... to widen.)');
    }
    console.log(union.size > 20
      ? 'Plenty of headroom — a @creates-community run is affordable.'
      : 'GETTING LOW — spend these deliberately; each create scenario burns one for good.');
  }

  console.log('\nNothing was saved. The form was never submitted.');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
