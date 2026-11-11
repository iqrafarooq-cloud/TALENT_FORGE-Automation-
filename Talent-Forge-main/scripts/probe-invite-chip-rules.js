// Read-only probe of the chip input's commit keys, trimming, duplicates and validation.
// SENDS NOTHING.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const P = require('../pages/CandidateOnboardingPage');

const MALFORMED = ['invalid-email','missing@','@nodomain.com','no.at.symbol.com','spaced name@domain.com',
  'double@@domain.com','trailing.dot@domain.','user@domain','user@.com','user@-domain.com','',
  "<script>alert('xss')</script>@x.com"];
const VALID = ['candidate@gmail.com','student@mail.eng.university.edu',
  'a'.repeat(64)+'@university.edu','  padded@university.edu  '];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
  const ob = new P(page);
  await ob.openChooserFromCandidates();
  await ob.chooseMethod('Invite via Email');
  await ob.inviteModal.waitFor({ state: 'visible', timeout: 20000 });

  const chips = () => ob.inviteModal.locator('button[aria-label^="Remove "]')
    .evaluateAll(els => els.map(e => e.getAttribute('aria-label').replace(/^Remove /, '')));
  const err = () => ob.inviteModal.locator('[role="alert"]').allInnerTexts();
  const val = () => ob.inviteEmailInput.inputValue();
  const clearAll = async () => {
    for (;;) {
      const b = ob.inviteModal.locator('button[aria-label^="Remove "]').first();
      if (!(await b.count())) break;
      await b.click(); await page.waitForTimeout(150);
    }
    await ob.inviteEmailInput.fill(''); await page.waitForTimeout(200);
  };

  const commit = async (email, key) => {
    await ob.inviteEmailInput.fill(email);
    if (key === 'Space') await ob.inviteEmailInput.press(' ');
    else if (key) await ob.inviteEmailInput.press(key);
    await page.waitForTimeout(500);
    return { chips: await chips(), value: await val(), errors: await err(),
             send: await ob.sendInvitesButton.isEnabled() };
  };

  console.log('EMPTY-STATE Space:', JSON.stringify(await commit('space.only@university.edu','Space')));
  await clearAll();
  console.log('Tab:', JSON.stringify(await commit('tab.key@university.edu','Tab')));
  await clearAll();
  console.log('Comma:', JSON.stringify(await commit('comma.key@university.edu',',')));
  await clearAll();
  // paste
  await ob.inviteEmailInput.click();
  await page.keyboard.insertText('pasted@university.edu');
  await page.waitForTimeout(300);
  console.log('PASTE then Enter:', JSON.stringify(await commit('pasted@university.edu','Enter')));
  await clearAll();
  console.log('TRIM:', JSON.stringify(await commit('  padded@university.edu  ','Enter')));
  await clearAll();
  // duplicates
  for (const e of ['dupe@university.edu','dupe@university.edu','Dupe@University.edu']) await commit(e,'Enter');
  console.log('DUPES:', JSON.stringify(await chips()));
  await clearAll();
  console.log('--- MALFORMED ---');
  for (const e of MALFORMED) {
    const r = await commit(e,'Enter');
    console.log(JSON.stringify({ input: e, ...r }));
    await clearAll();
  }
  console.log('--- VALID ---');
  for (const e of VALID) {
    const r = await commit(e,'Enter');
    console.log(JSON.stringify({ input: e, ...r }));
  }
  console.log('FINAL CHIPS:', JSON.stringify(await chips()));
  await browser.close();
})().catch(e => { console.error('PROBE FAILED', e); process.exit(1); });
