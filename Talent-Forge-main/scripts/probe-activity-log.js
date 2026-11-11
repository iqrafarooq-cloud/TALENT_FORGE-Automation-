// Read-only probe: the Agent Portal's Activity Log (/activity-log).
//
// Maps the route, the two toolbar controls, every date range beside the URL value and the API
// value it produces, what the search matches, the debounce, the empty state, the infinite
// scroll, and the edge cases (an unrecognised range, an empty range, a whitespace-only term,
// and four terms the log cannot contain).
//
// >>> IT WRITES NOTHING. <<< The toolbar holds a search box and a dropdown, neither of which
// mutates anything, and the list has no row action at all. There is nothing on this page to
// spend, so the probe can be re-run freely.
//
// It drives the REAL page object rather than its own copy of the readers, deliberately: a probe
// with its own readers can agree with itself while disagreeing with the suite, which is how the
// community module's readMemberCards() under-count went unnoticed for weeks.
//
//   node scripts/probe-activity-log.js
//   node scripts/probe-activity-log.js --no-scroll     (skip the infinite-scroll walk)
//   node scripts/probe-activity-log.js --terms         (only the search-term table)
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ActivityLogPage = require('../pages/ActivityLogPage');

const J = (o) => JSON.stringify(o, null, 1);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const only = (name) => argv.some((a) => a.startsWith('--')) && !has(`--${name}`) && argv.includes('--terms');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  // 1440x900: the Create Community form taught this repo that layout-dependent behaviour has to
  // be reproduced at a realistic size. The toolbar was checked at 1280, 1600 and 1920 and is the
  // same at all three, so any of them is honest here.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, {
    timeout: 90000,
    waitUntil: 'commit',
  });

  const al = new ActivityLogPage(page);
  al.install();
  await al.navigate();

  console.log('=== 1. ROUTE, IDENTITY AND THE TOOLBAR ===');
  console.log('url            :', decodeURIComponent(page.url()));
  console.log('heading        :', (await al.pageHeading.innerText()).trim());
  console.log('default range  :', await al.currentDurationLabel());
  console.log('first request  :', await al.lastListQuery());
  console.log(
    'toolbar        :',
    J(
      await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          buttons: [...main.querySelectorAll('button')].map((b) =>
            (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()
          ),
          inputs: [...main.querySelectorAll('input')].map((i) => ({
            type: i.type,
            placeholder: i.placeholder,
            aria: i.getAttribute('aria-label'),
            maxlength: i.getAttribute('maxlength'),
          })),
          // THERE IS NO FILTERS BUTTON AND THE WORD DOES NOT APPEAR. Worth printing, because
          // every other Agent Portal listing has one and an assertion is easy to port across.
          mentionsFilter: /filter/i.test(main.innerText),
          testids: [...main.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')),
        };
      })
    )
  );

  console.log('\n=== 2. THE DATE-RANGE POPOVER ===');
  console.log('options offered:', J(await al.readDurationOptions()));
  await al.closeDurationMenu();
  // The aria-hidden mirror carries a BLANK option the popover does not offer. It is NOT
  // user-selectable and NOT a defect - printed so nobody reports it a second time.
  console.log('aria-hidden mirror (the blank option is expected):', J(await al.readMirrorOptions()));

  if (!only('terms')) {
    console.log('\n=== 3. EACH RANGE: URL VALUE vs API VALUE vs SERVER TOTAL ===');
    console.log('(totals must never decrease as the window widens - that is the relational check)');
    for (const d of ActivityLogPage.DURATIONS) {
      /* eslint-disable no-await-in-loop */
      const res = await al.selectDuration(d.label);
      const params = al.urlParams();
      console.log(
        `${d.label.padEnd(14)} url=${String(params.duration).padEnd(14)} api=${(res ? res.query : '(none)')
          .replace(/^\?/, '')
          .padEnd(56)} count=${res ? res.count : '-'} rendered=${await al.rowCount()}`
      );
      /* eslint-enable no-await-in-loop */
    }

    console.log('\n=== 3b. RE-SELECTING THE RANGE ALREADY APPLIED ===');
    const again = await al.selectDurationWatchingRequests('This year');
    console.log('requests fired:', J(again.requests), again.requests.length ? '<-- UNEXPECTED' : '(none, as measured)');
  }

  console.log('\n=== 4. THE SEARCH ===');
  await al.selectDuration('This year');
  const unfiltered = await al.lastListCount();
  console.log('unfiltered total (This year):', unfiltered);

  const identity = (process.env.AGENT_EMAIL || '').split('@')[0];
  const first = (await al.readEntries())[0];
  const derived = String(first ? first.headline : '')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length >= 4 && !identity.toLowerCase().includes(w.toLowerCase()))[0];
  console.log('first entry      :', J(first));
  console.log('derived term     :', derived);

  const terms = [
    ['derived, as typed', derived],
    ['derived, lower', derived && derived.toLowerCase()],
    ['derived, UPPER', derived && derived.toUpperCase()],
    ['derived, mid-word', derived && derived.slice(1, -1)],
    ['leading/trailing space', `  ${derived}  `],
    ['whitespace only', '   '],
    ['actor first name', identity.split(/[.+_-]/)[0]],
    ['actor full email', process.env.AGENT_EMAIL],
    ['no match', 'zzzz-no-such-activity-zzzz'],
    ['300 characters', 'a'.repeat(300)],
    ['sql fragment', "' OR 1=1 --"],
    ['script tag', '<script>alert(1)</script>'],
    ['non-latin script', '日本語'],
    ['percent escapes', '%26%3D'],
  ].filter(([, t]) => t !== undefined && t !== null && t !== '');

  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));

  console.log('\nterm'.padEnd(26), 'urlParam'.padEnd(24), 'apiQuery'.padEnd(46), 'status count rendered');
  for (const [label, term] of terms) {
    /* eslint-disable no-await-in-loop */
    const t0 = Date.now();
    const seen = await al.searchWatchingRequests(term);
    const last = seen.responses.length ? seen.responses[seen.responses.length - 1] : null;
    const urlParam = al.urlParams()[ActivityLogPage.URL_PARAMS.search];
    console.log(
      label.padEnd(26),
      String(urlParam === undefined ? '(absent)' : urlParam).slice(0, 23).padEnd(24),
      String(last ? last.query : '(no request)').replace(/^\?/, '').slice(0, 45).padEnd(46),
      `${last ? last.status : '-'}   ${last ? last.count : '-'}   ${seen.rendered}`,
      seen.requests.length === 0 ? ' <-- NO REQUEST' : '',
      Date.now() - t0 > 0 ? '' : ''
    );
    /* eslint-enable no-await-in-loop */
  }
  console.log('native dialogs raised by any term:', J(dialogs), dialogs.length ? '<-- A TERM WAS EXECUTED' : '(none)');

  console.log('\n=== 5. THE EMPTY STATE ===');
  await al.searchFor('zzzz-no-such-activity-zzzz');
  console.log('after a search matching nothing:', J(await al.readEmptyState()));
  console.log('entry-list container still in the DOM?', await al.hasItemsContainer());
  console.log(
    'NOTE: this is the TAB-LEVEL copy, used here for a SEARCH that matched nothing. One message,'
    + '\n      two causes - that is the @known-issue. The missing apostrophe in "Agents recent'
    + '\n      actions" is a second, separate finding.'
  );
  await al.clearSearch();

  console.log('\n=== 6. SEARCH AND RANGE TOGETHER ===');
  await al.selectDuration('This year');
  const wide = await al.searchFor('Invite');
  await al.selectDuration('Last 30 days');
  const narrow = await al.lastListResponse();
  console.log('this_year   + Invite:', wide ? `${wide.count} (${wide.query})` : '(no response)');
  console.log('last_30_days+ Invite:', narrow ? `${narrow.count} (${narrow.query})` : '(no response)');
  console.log('URL carries both    :', J(al.urlParams()));

  if (!has('--no-scroll') && !only('terms')) {
    console.log('\n=== 7. INFINITE SCROLL (there is NO pagination control, and none is needed) ===');
    await al.clearSearch();
    await al.selectDuration('This year');
    const total = await al.lastListCount();
    console.log('server total:', total, '| rendered on load:', await al.rowCount());
    console.log('scroll passes:', J(await al.scrollForMore(3)));
    console.log(
      'pagination controls in <main>:',
      J(
        await page.evaluate(() => {
          const main = document.querySelector('main');
          return {
            navs: [...main.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label') || '(unnamed)'),
            pagerButtons: [...main.querySelectorAll('button')]
              .map((b) => (b.innerText || '').trim())
              .filter((t) => /^(next|previous|prev|page \d+|\d+)$/i.test(t)),
          };
        })
      )
    );
  }

  console.log('\n=== 8. EDGE CASES IN THE URL ===');
  for (const value of ['not_a_real_range', '']) {
    /* eslint-disable no-await-in-loop */
    await al.navigate({ duration: value });
    console.log(
      `?duration=${JSON.stringify(value).padEnd(20)} -> trigger "${await al.currentDurationLabel()}"`,
      `| request ${await al.lastListQuery()}`,
      `| url still "${al.urlParams().duration === undefined ? '(absent)' : al.urlParams().duration}"`,
      `| rendered ${await al.rowCount()}`
    );
    /* eslint-enable no-await-in-loop */
  }

  console.log('\n=== 9. A DEEP LINK CARRYING BOTH ===');
  await al.navigate({ duration: 'last_30_days', activityLogSearch: 'Invite' });
  console.log('trigger      :', await al.currentDurationLabel());
  console.log('search box   :', JSON.stringify(await al.searchValue()));
  console.log('request      :', await al.lastListQuery());
  console.log('rendered     :', await al.rowCount());

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
