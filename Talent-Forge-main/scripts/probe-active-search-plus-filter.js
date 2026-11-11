// Read-only probe: does search + filter TOGETHER actually narrow the Active tab,
// and does the table reflect BOTH constraints?
// The @e2e scenario's final step is tolerant ("matching results OR an empty
// state"), so this measures which branch it takes and whether the rows really
// satisfy the search term AND the Unverified filter.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ActiveCandidatePage = require('../pages/ActiveCandidatePage');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });

  const ac = new ActiveCandidatePage(page);
  await ac.navigate();
  await page.waitForTimeout(3000);

  const report = async (label) => {
    const rows = await ac.visibleRowHeaders();
    const verif = await ac.columnValues(0); // 0 = Account Verification
    console.log(`\n== ${label}`);
    console.log('   url        :', decodeURIComponent(page.url()));
    console.log('   rowCount   :', await ac.rowCount());
    console.log('   verifCells :', JSON.stringify(verif));
    console.log('   firstRows  :', JSON.stringify(rows.slice(0, 3)));
    return { rows, verif };
  };

  await report('BASELINE (no search, no filter)');

  const { name, email } = await ac.firstCandidate();
  const term = name.split(/\s+/)[0];
  console.log(`\n   first candidate -> name="${name}" email="${email}"  => search term "${term}"`);

  await ac.search(term);
  await page.waitForTimeout(800);
  const afterSearch = await report(`AFTER SEARCH "${term}"`);

  await ac.openFilters();
  await ac.selectFilterOption('Unverified');
  await ac.applyFilters();
  await page.waitForTimeout(1200);
  const afterBoth = await report('AFTER SEARCH + Unverified FILTER');

  // Did the pairing actually constrain anything?
  const lower = term.toLowerCase();
  const matches = (s) => s.toLowerCase().includes(lower);
  console.log('\n== VERDICT');
  console.log('   search narrowed?  ', afterSearch.rows.length, 'rows vs baseline');
  console.log('   every row matches search term? ', afterBoth.rows.every(matches));
  console.log('   every row Unverified?          ',
    afterBoth.verif.length > 0 && afterBoth.verif.every((v) => /unverified/i.test(v)));
  console.log('   branch the last step takes:    ',
    afterBoth.rows.length > 0 ? 'MATCHING RESULTS' : 'EMPTY STATE');
  console.log('   search term still in the box?  ', JSON.stringify(await ac.getSearchValue()));

  await browser.close();
})();
