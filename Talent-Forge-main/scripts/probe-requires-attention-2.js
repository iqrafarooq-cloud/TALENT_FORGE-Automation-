// Read-only probe #2 for Agent Portal > Candidates > Requires Attention: the BEHAVIOUR, where
// probe-requires-attention.js maps the STRUCTURE. Between them they are the source of every
// string, URL param and API param asserted in features/Agent_Portal/require-attention.feature.
//
// COMMITS NOTHING. It opens the filter modal and the Reminder History dialog and dismisses
// both; there is no Send Reminder control on this tab at all, so nothing here can send a
// reminder, and nothing it does creates, deletes or mutates a row.
//
// It answers, in order:
//   1. does the search match an EMAIL, a partial term, and is it case-insensitive?  (the
//      placeholder says "candidate name..." only, which is the divergence the feature records)
//   2. is a whitespace-only term sent to the server?
//   3. does pagination request page 2, and does a search from page 2 reset to page 1?
//   4. can a severity tab be deep-linked, and does it survive a reload?
//   5. does a second Last Activity choice REPLACE the first? (it is a radio group)
//   6. >>> is a Severity FILTER honoured on a severity TAB? <<<  It is not - and the two
//      paths differ: clicking Apply fires NO request, while RELOADING the same URL fires one
//      carrying the TAB's value. Reporting those as one behaviour would send a developer after
//      a click handler that never fires.
//   7. does Clear All clear the URL as well as the selections?
//   8. the Reminder History dialog: what it lists, that the URL does not change, and that it
//      closes by both Close and the backdrop.
//   9. the filter groups, options, control types and test-ids as rendered.
//
// >>> IT DRIVES THE REAL PAGE OBJECT, NOT ITS OWN COPY OF THE LOCATORS. <<< That is the whole
// point: a probe with its own readers can agree with itself while disagreeing with the suite,
// which is how the community module's readMemberCards() under-count went unnoticed. Anything
// this probe can do, a step can do.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const RequiresAttentionPage = require('../pages/RequiresAttentionPage');

const J = (o) => JSON.stringify(o);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });

  const ra = new RequiresAttentionPage(page);
  ra.install();
  const q = () => J(ra.lastRequestQuery());
  const params = () => decodeURIComponent(page.url()).split('?')[1] || '(none)';

  await ra.navigate();
  const first = await ra.firstCandidate();
  console.log('=== 1. SEARCH ===');
  console.log('  first candidate:', J(first), 'rows:', await ra.rowCount());
  console.log('  placeholder:', J(await ra.searchPlaceholder()));

  for (const [label, term] of [
    ['name', first.name.split(/\s+/)[0]],
    ['name UPPER', first.name.toUpperCase()],
    ['name lower', first.name.toLowerCase()],
    ['full email', first.email],
    ['partial email', first.email.split('@')[0].slice(0, 8)],
    ['no match', 'ZZZNONEXISTENT999'],
  ]) {
    await ra.clearSearch();
    await ra.search(term);
    console.log(`  ${label.padEnd(14)} ${J(term).padEnd(32)} -> rows ${await ra.rowCount()}  api ${q()}`);
  }
  console.log('  empty state:', J(await ra.readEmptyState()));

  console.log('\n=== 2. WHITESPACE-ONLY SEARCH ===');
  await ra.clearSearch();
  await ra.search('   ');
  console.log('  rows:', await ra.rowCount(), 'url:', params(), 'api:', q());
  console.log('  (the outcome is correct - the list is unfiltered - the divergence is that the '
    + 'request is made at all)');

  console.log('\n=== 3. PAGINATION ===');
  await ra.navigate();
  console.log('  rendered:', J((await ra.pagination.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()));
  const next = ra.pagination.getByRole('button', { name: /Next/i }).first();
  if (await next.count()) {
    await next.click();
    await ra.settleRows();
    await page.waitForTimeout(600);
    console.log('  after Next     -> url', params(), 'api', q(), 'rows', await ra.rowCount());
    await ra.search(first.name.split(/\s+/)[0]);
    console.log('  search from p2 -> url', params(), 'api', q(), '(should reset to page=1)');
  } else console.log('  no Next control');

  console.log('\n=== 4. TAB DEEP-LINK + RELOAD ===');
  await ra.loadUrlCapturingRequest(`${ra.url}?activeFilter=critical`);
  console.log('  deep-link  -> api', q(), 'Critical active?', await ra.isTabActive('Critical'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ra.settleRows();
  console.log('  reload     -> url', params(), 'api', q(), 'Critical active?', await ra.isTabActive('Critical'));

  console.log('\n=== 5. LAST ACTIVITY IS A RADIO GROUP ===');
  await ra.navigate();
  await ra.openFilters();
  await ra.selectFilterOption('Last 7 days');
  await ra.selectFilterOption('Last 30 days');
  console.log('  after picking both, selected:',
    J((await ra.readFilterOptions()).filter((o) => o.checked).map((o) => o.text)));
  await ra.applyFilters();
  console.log('  url:', params(), 'api:', q(), 'badge:', await ra.appliedFilterCount());

  console.log('\n=== 6. SEVERITY FILTER ON A SEVERITY TAB  <-- THE DEFECT ===');
  await ra.navigate();
  await ra.clickTab('Critical');
  await ra.openFilters();
  await ra.selectFilterOption('Warning');
  const before = ra.requestCount();
  await ra.applyFilters();
  console.log('  clicking Apply -> url', params(),
    '| requests fired:', J(ra.requestsSince(before)),
    '| badge:', await ra.appliedFilterCount(),
    '| severities shown:', J([...new Set((await ra.readRows()).map((r) => r.severity))]));
  const beforeReload = ra.requestCount();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ra.settleRows();
  console.log('  reloading it   -> url', params(),
    '| requests fired:', J(ra.requestsSince(beforeReload)),
    '| severities shown:', J([...new Set((await ra.readRows()).map((r) => r.severity))]));
  console.log('  On the ALL tab the same filter applies correctly - that is what localises it.');

  console.log('\n=== 7. CLEAR ALL ===');
  await ra.navigate();
  await ra.openFilters();
  await ra.selectFilterOption('Critical');
  await ra.applyFilters();
  await ra.openFilters();
  await ra.clearAllFilters();
  console.log('  selected:', await ra.selectedFilterCount(), 'url:', params(),
    'modal still open:', await ra.filterModal.isVisible());
  await ra.cancelFilters();

  console.log('\n=== 8. REMINDER HISTORY ===');
  await ra.navigate();
  const urlBefore = page.url();
  const fetch = await ra.openReminderHistory(0);
  const history = await ra.readReminderHistory();
  console.log('  endpoint:', fetch.endpoint);
  console.log('  server returned:', fetch.fetched, '| rendered entries:', history.entries.length);
  console.log('  candidate:', J(history.candidate), '| heading:', J(history.heading),
    '| View more:', history.hasViewMore);
  console.log('  first 3:', J(history.entries.slice(0, 3)));
  console.log('  URL unchanged while open:', page.url() === urlBefore);
  await ra.closeReminderHistory('Close');
  console.log('  Close closes it:', !(await ra.reminderHistoryPanel.isVisible().catch(() => false)));
  await ra.openReminderHistory(0);
  await ra.closeReminderHistory('backdrop');
  console.log('  backdrop closes it:', !(await ra.reminderHistoryPanel.isVisible().catch(() => false)));

  console.log('\n=== 9. FILTER MODAL AS RENDERED ===');
  await ra.navigate();
  console.log('  columns:', J(await ra.columnHeaders()));
  console.log('  tabs:', J(await ra.tabLabels()));
  await ra.openFilters();
  console.log('  groups:', J(await ra.readFilterGroups()));
  for (const o of await ra.readFilterOptions()) {
    console.log(`    ${String(o.index).padStart(2)} ${o.text.padEnd(16)} ${String(o.control).padEnd(9)} ${o.testid || '(no test-id)'}`);
  }
  await ra.cancelFilters();

  await browser.close();
})();
