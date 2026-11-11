// Read-only probe #2: the BEHAVIOUR of Agent Portal > Candidates > Deactivated.
//
// Search (name / email / partial / case / blank), every filter option's URL param beside the
// API param it produces, multi-select, the radio group, Clear All, the empty state, the View
// destination and pagination.
//
// COMMITS NOTHING - every dialog it opens it dismisses, and there is no reactivate control on
// this surface at all, so nothing here can change an account.
//
// It drives the REAL page object nowhere on purpose: this is the discovery pass that the page
// object is written FROM. Probe #1 (scripts/probe-deactivated-candidates.js) maps the
// structure; this one maps what the controls do.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);
const ROW = '[role="row"]:has([role="rowheader"])';
const LIST = /\/candidate\/deactivated\//;
const FILTERS_BTN = '[data-testid="agent-candidates-deactivated-filters-button"]';
const SEARCH = '[data-testid="agent-candidates-deactivated-search-input"]';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const api = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') return;
    if (!LIST.test(r.url())) return;
    api.push(decodeURIComponent(r.url().split('/deactivated/')[1] || ''));
  });
  const since = () => {
    const n = api.length;
    return () => api.slice(n);
  };

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });

  const goto = async (suffix) => {
    await page.goto(`${origin}/candidates/deactivated${suffix || ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  };
  const rows = () => page.locator(ROW).count();
  const rowText = () =>
    page
      .locator(ROW)
      .evaluateAll((rs) => rs.map((r) => ((r.querySelector('[role="rowheader"]') || {}).innerText || '').replace(/\s+/g, ' ').trim()));
  const query = () => decodeURIComponent(page.url()).split('?')[1] || '(none)';
  const mainText = async () => (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const dialog = () => page.getByRole('dialog').first();
  const labels = () => dialog().locator('label');
  const labelTexts = () => labels().evaluateAll((ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()));
  const selected = () =>
    labels()
      .evaluateAll((ls) =>
        ls
          .map((l) => ({ t: l.innerText.replace(/\s+/g, ' ').trim(), on: Boolean((l.querySelector('input') || {}).checked) }))
          .filter((x) => x.on)
      )
      .catch(() => 'dialog not open');
  const openFilters = async () => {
    await page.locator(FILTERS_BTN).first().click();
    await dialog().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
  };
  const pick = async (option) => {
    const i = (await labelTexts()).findIndex((t) => t === option);
    if (i < 0) throw new Error(`no filter option labelled "${option}"`);
    await labels().nth(i).click();
    await page.waitForTimeout(350);
  };
  const apply = async () => {
    await dialog().getByRole('button', { name: /^Apply Filters$/ }).click();
    await page.waitForTimeout(2600);
  };
  const badge = async () => (await page.locator(FILTERS_BTN).first().innerText()).replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------------ 0. baseline
  await goto();
  const all = await rowText();
  console.log('=== 0. BASELINE ===');
  console.log('url:', decodeURIComponent(page.url()));
  console.log('rows:', all.length);
  console.log('candidates:', J(all));
  console.log(
    'svg NOT inside a button, first row:',
    J(
      await page
        .locator(ROW)
        .first()
        .locator('svg')
        .evaluateAll((ss) =>
          ss
            .filter((s) => s.closest('button') === null)
            .map((s) => ({ cls: s.getAttribute('class'), parentTag: s.parentElement.tagName, aria: s.getAttribute('aria-label'), hidden: s.getAttribute('aria-hidden') }))
        )
    )
  );

  const first = all[0] || '';
  const name = first.split(/\s(?=\S+@)/)[0] || first;
  const email = (first.match(/\S+@\S+/) || [''])[0];

  // ------------------------------------------------------------------ 1. search
  console.log('\n=== 1. SEARCH VARIATIONS ===');
  console.log('subject name:', JSON.stringify(name), ' email:', JSON.stringify(email));
  const search = page.locator(SEARCH).first();
  const variations = [
    ['exact name', name],
    ['name UPPER', name.toUpperCase()],
    ['name lower', name.toLowerCase()],
    ['full email', email],
    ['partial email 8', email.slice(0, 8)],
    ['partial name 4', name.slice(0, 4)],
    ['no match', 'ZZZNONEXISTENT999'],
    ['whitespace only', '   '],
  ];
  for (const [label, term] of variations) {
    await search.fill('');
    await page.waitForTimeout(1800);
    const get = since();
    await search.fill(term);
    await page.waitForTimeout(2800);
    console.log(
      `${label.padEnd(17)} rows=${String(await rows()).padEnd(3)} url=${JSON.stringify(query())} sent=${J(get()).replace(/\s+/g, ' ')}`
    );
  }
  console.log('main text while no-match is on screen:');
  await search.fill('ZZZNONEXISTENT999');
  await page.waitForTimeout(2800);
  console.log(JSON.stringify((await mainText()).slice(0, 500)));
  await search.fill('');
  await page.waitForTimeout(2200);

  // ------------------------------------------------------------------ 2. every filter option
  console.log('\n=== 2. FILTER OPTIONS: URL param vs API param ===');
  for (const opt of ['Verified', 'Unverified', '0', '1-2', '3+', 'Subscribed', 'Not Subscribed', 'Payment Due']) {
    await goto();
    await openFilters();
    await pick(opt);
    const get = since();
    await apply();
    console.log(
      `${opt.padEnd(15)} url=${JSON.stringify(query())}  sent=${J(get()).replace(/\s+/g, ' ')}  rows=${await rows()}  badge=${JSON.stringify(await badge())}`
    );
  }

  // ------------------------------------------------------------------ 3. two options, one checkbox group
  console.log('\n=== 3. TWO OPTIONS IN ONE CHECKBOX GROUP ===');
  await goto();
  await openFilters();
  await pick('Subscribed');
  await pick('Not Subscribed');
  let get = since();
  await apply();
  console.log('url:', query());
  console.log('sent:', J(get()).replace(/\s+/g, ' '));
  console.log('badge:', JSON.stringify(await badge()), ' rows:', await rows());

  // ------------------------------------------------------------------ 4. the radio group
  console.log('\n=== 4. PENDING DOCUMENTS IS A RADIO GROUP ===');
  await goto();
  await openFilters();
  await pick('1-2');
  console.log('after picking 1-2 :', J(await selected()));
  await pick('3+');
  console.log('after picking 3+  :', J(await selected()));
  console.log('can a selected radio be un-picked? clicking 3+ again:');
  await pick('3+');
  console.log('                  :', J(await selected()));

  // ------------------------------------------------------------------ 5. two groups -> badge
  console.log('\n=== 5. ONE OPTION IN EACH OF TWO GROUPS ===');
  await goto();
  await openFilters();
  await pick('Unverified');
  await pick('Not Subscribed');
  get = since();
  await apply();
  console.log('url:', query());
  console.log('sent:', J(get()).replace(/\s+/g, ' '));
  console.log('badge:', JSON.stringify(await badge()), ' rows:', await rows());

  // ------------------------------------------------------------------ 6. Clear All / Cancel
  console.log('\n=== 6. CLEAR ALL ===');
  await openFilters();
  console.log('selections on reopen:', J(await selected()));
  await dialog().getByRole('button', { name: /^Clear All$/ }).click();
  await page.waitForTimeout(1500);
  const stillOpen = await dialog().isVisible().catch(() => false);
  console.log('dialog still open after Clear All:', stillOpen, ' url:', query());
  if (stillOpen) console.log('selections after Clear All:', J(await selected()));

  console.log('\n=== 6b. CANCEL DISCARDS ===');
  await goto();
  await openFilters();
  await pick('Verified');
  await dialog().getByRole('button', { name: /^Cancel$/ }).click();
  await page.waitForTimeout(1200);
  console.log('dialog visible:', await dialog().isVisible().catch(() => false), ' url:', query());
  await openFilters();
  console.log('selections on reopen after Cancel:', J(await selected()));
  await page.keyboard.press('Escape');

  // ------------------------------------------------------------------ 7. filter + search together
  console.log('\n=== 7. FILTER + SEARCH TOGETHER ===');
  await goto();
  await openFilters();
  await pick('Unverified');
  get = since();
  await apply();
  console.log('filter only  rows:', await rows(), ' sent:', J(get()).replace(/\s+/g, ' '));
  get = since();
  await page.locator(SEARCH).first().fill(name);
  await page.waitForTimeout(2800);
  console.log('plus search  rows:', await rows(), ' url:', query(), ' sent:', J(get()).replace(/\s+/g, ' '));

  console.log('\n=== 7b. A COMBINATION MATCHING NOTHING ===');
  await goto();
  await openFilters();
  await pick('Subscribed');
  await pick('Payment Due');
  get = since();
  await apply();
  console.log('rows:', await rows(), ' sent:', J(get()).replace(/\s+/g, ' '));
  console.log('main:', JSON.stringify((await mainText()).slice(0, 400)));

  // ------------------------------------------------------------------ 8. reload / deep link
  console.log('\n=== 8. DEEP LINK + RELOAD ===');
  get = since();
  await goto('?accountVerification=unverified');
  console.log('deep link url:', query(), ' sent:', J(get()).replace(/\s+/g, ' '), ' rows:', await rows());
  await openFilters();
  console.log('selections reflected from the URL:', J(await selected()));
  await page.keyboard.press('Escape');
  get = since();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  console.log('after reload url:', query(), ' sent:', J(get()).replace(/\s+/g, ' '), ' rows:', await rows());

  // ------------------------------------------------------------------ 9. View
  console.log('\n=== 9. VIEW DESTINATION ===');
  await goto();
  const target = (await rowText())[0];
  await page.locator('[data-testid="agent-candidates-view-button"]').first().click();
  await page.waitForTimeout(5000);
  console.log('row:', JSON.stringify(target));
  console.log('-> url:', decodeURIComponent(page.url()));
  console.log('headings:', J(await page.locator('h1,h2,h3').evaluateAll((e) => e.map((x) => x.innerText.trim()).filter(Boolean).slice(0, 8))));
  console.log(
    'tab strip:',
    J(await page.locator('[role="radiogroup"] [role="radio"]').evaluateAll((e) => e.map((x) => ({ t: x.innerText.replace(/\s+/g, ' ').trim(), checked: x.getAttribute('aria-checked') }))))
  );
  console.log('status pill / header text:', JSON.stringify((await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)));
  console.log(
    'Back control:',
    J(await page.getByText(/^Back$/).evaluateAll((e) => e.map((x) => ({ tag: x.tagName, tabIndex: x.tabIndex, cls: (x.getAttribute('class') || '').slice(0, 60) }))))
  );

  console.log('\n=== 9b. BACK RETURNS TO THE LISTING ===');
  const back = page.getByText(/^Back$/).first();
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(3000);
    console.log('after Back:', decodeURIComponent(page.url()));
  } else {
    console.log('no Back control found');
  }

  // ------------------------------------------------------------------ 10. pagination
  console.log('\n=== 10. PAGINATION ===');
  await goto();
  console.log(
    'navs named pagination:',
    J(await page.locator('[aria-label*="agination" i]').evaluateAll((ns) => ns.map((n) => n.innerText.replace(/\s+/g, ' ').trim())))
  );
  console.log('Next/Previous controls:', await page.getByRole('button', { name: /^(Next|Previous)$/i }).count());
  console.log('total rows on the tab:', await rows());
  console.log('page_size the app asks for:', J(api.filter((q) => /page_size/.test(q)).slice(-1)));

  await browser.close();
})().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
