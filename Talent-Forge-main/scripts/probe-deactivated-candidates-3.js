// Read-only probe #3: the three things probes #1 and #2 left unsettled on
// Agent Portal > Candidates > Deactivated.
//
//  A. Does the search really match an EMAIL, and is a "+" in the address handled?
//     Probe #2 searched an address containing "+" and got the WHOLE list back, which is either
//     an encoding defect or a search that does not match emails at all. A "+" in a query string
//     decodes as a space, so the two explanations are indistinguishable without a control: an
//     address with no "+" in it.
//  B. The server's own `count` beside the rendered row count, unfiltered and for the union of
//     two options in one group - probe #2 saw a union return MORE rows than the unfiltered list.
//  C. Whether the profile this listing opens carries a Back control, and whether the listing
//     can ever be empty (i.e. is the tab-level empty state reachable at all).
//
// COMMITS NOTHING.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o);
const ROW = '[role="row"]:has([role="rowheader"])';
const SEARCH = '[data-testid="agent-candidates-deactivated-search-input"]';
const FILTERS_BTN = '[data-testid="agent-candidates-deactivated-filters-button"]';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const responses = [];
  page.on('response', async (r) => {
    if (!/\/candidate\/deactivated\//.test(r.url())) return;
    let body = null;
    try {
      body = await r.json();
    } catch { /* not json */ }
    responses.push({
      query: decodeURIComponent(r.url().split('/deactivated/')[1] || ''),
      status: r.status(),
      count: body && typeof body.count === 'number' ? body.count : null,
      results: body && Array.isArray(body.results) ? body.results.length : null,
      emails: body && Array.isArray(body.results) ? body.results.map((x) => (x.user || {}).email || x.email || null) : null,
    });
  });
  const since = () => {
    const n = responses.length;
    return () => responses.slice(n);
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
    page.locator(ROW).evaluateAll((rs) => rs.map((r) => ((r.querySelector('[role="rowheader"]') || {}).innerText || '').replace(/\s+/g, ' ').trim()));

  // ---------------------------------------------------------------- A. email search
  await goto();
  const all = await rowText();
  console.log('=== A. EMAIL SEARCH, WITH A CONTROL ===');
  console.log('unfiltered rows:', all.length);
  console.log('candidates:', J(all));
  const serverTotal = responses.filter((r) => r.count !== null).slice(-1)[0];
  console.log('server said:', J(serverTotal));

  const emails = all.map((t) => (t.match(/\S+@\S+/) || [''])[0]).filter(Boolean);
  const withPlus = emails.find((e) => e.includes('+'));
  const noPlus = emails.find((e) => !e.includes('+'));
  console.log('an address WITH a "+":', J(withPlus), '   an address WITHOUT one:', J(noPlus));

  const search = page.locator(SEARCH).first();
  for (const [label, term] of [
    ['email WITHOUT "+"', noPlus],
    ['email WITH "+"', withPlus],
    ['local part before "+"', withPlus ? withPlus.split('+')[0] : null],
    ['domain only', '@bytecorp.io'],
  ]) {
    if (!term) {
      console.log(`${label.padEnd(22)} (no such fixture on this tab)`);
      continue;
    }
    await search.fill('');
    await page.waitForTimeout(1800);
    const get = since();
    await search.fill(term);
    await page.waitForTimeout(2800);
    const seen = get().filter((r) => r.count !== null).slice(-1)[0] || {};
    console.log(`${label.padEnd(22)} term=${J(term)} rendered=${await rows()} serverCount=${seen.count} sent=${J(seen.query)}`);
  }
  await search.fill('');
  await page.waitForTimeout(2200);

  // ---------------------------------------------------------------- B. union arithmetic
  console.log('\n=== B. UNION OF TWO OPTIONS IN ONE GROUP vs THE UNFILTERED COUNT ===');
  const dialog = () => page.getByRole('dialog').first();
  const labels = () => dialog().locator('label');
  const labelTexts = () => labels().evaluateAll((ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()));
  const openFilters = async () => {
    await page.locator(FILTERS_BTN).first().click();
    await dialog().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
  };
  const pick = async (o) => {
    const i = (await labelTexts()).findIndex((t) => t === o);
    await labels().nth(i).click();
    await page.waitForTimeout(350);
  };
  const apply = async () => {
    await dialog().getByRole('button', { name: /^Apply Filters$/ }).click();
    await page.waitForTimeout(2800);
  };
  const report = async (label, get) => {
    const seen = get().filter((r) => r.count !== null).slice(-1)[0] || {};
    console.log(`${label.padEnd(34)} serverCount=${String(seen.count).padEnd(4)} results=${String(seen.results).padEnd(4)} rendered=${await rows()}  sent=${J(seen.query)}`);
  };

  await goto();
  let g = since();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await report('unfiltered', g);
  for (const combo of [['Subscribed'], ['Not Subscribed'], ['Payment Due'], ['Subscribed', 'Not Subscribed'], ['Subscribed', 'Not Subscribed', 'Payment Due']]) {
    await goto();
    await openFilters();
    for (const o of combo) await pick(o);
    g = since();
    await apply();
    await report(combo.join(' + '), g);
  }

  // ---------------------------------------------------------------- C. profile Back, empty state
  console.log('\n=== C1. THE PROFILE THIS LISTING OPENS ===');
  await goto();
  const target = (await rowText())[0];
  await page.locator('[data-testid="agent-candidates-view-button"]').first().click();
  await page.waitForURL(/view-profile/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  console.log('row:', J(target), '-> url:', decodeURIComponent(page.url()));
  console.log(
    'every element whose text is exactly "Back":',
    J(await page.locator('body').evaluateAll((bs) => {
      const out = [];
      const walk = (el) => {
        for (const c of el.children) {
          if (c.children.length === 0 && (c.innerText || '').trim() === 'Back') {
            out.push({ tag: c.tagName, tabIndex: c.tabIndex, cls: (c.getAttribute('class') || '').slice(0, 70) });
          }
          walk(c);
        }
      };
      bs.forEach(walk);
      return out;
    }))
  );
  console.log('status pill candidates:', J(await page.locator('main span, main p').evaluateAll((es) => es.map((e) => e.innerText.trim()).filter((t) => /^(Verified|Unverified|Active|Deactivated|Inactive)$/i.test(t)))));

  console.log('\n=== C2. IS THE TAB-LEVEL EMPTY STATE REACHABLE? ===');
  await goto();
  console.log('deactivated candidates on this agent right now:', await rows());
  console.log('-> a "no deactivated candidates at all" state can only be observed on an agent with none.');

  console.log('\n=== C3. THE NO-RESULTS STATE, VERBATIM ===');
  await page.locator(SEARCH).first().fill('ZZZNONEXISTENT999');
  await page.waitForTimeout(2800);
  console.log(J((await page.locator('main').innerText()).replace(/\s+/g, ' ').trim()));
  console.log('is a "Clear all filters" CTA offered?', await page.getByRole('button', { name: /clear all filters/i }).count());

  console.log('\n=== C4. SEARCH BOX WHILE EMPTY-STATE IS SHOWING ===');
  console.log('search input still usable:', await page.locator(SEARCH).first().isEnabled());
  console.log('Filters button still usable:', await page.locator(FILTERS_BTN).first().isEnabled());

  await browser.close();
})().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
