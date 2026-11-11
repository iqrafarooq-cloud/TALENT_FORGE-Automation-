// Read-only probe #4: the last two unsettled questions on Candidates > Deactivated.
//
//  D. Is the TAB-LEVEL empty state ("this agent has no deactivated candidates") reachable, and
//     what does it say? The shared agent always has some, so it is measured against the
//     dedicated zero-candidate agent instead.
//  E. How does an agent get BACK to the listing from the profile the View action opens, and does
//     the filtered/searched listing survive the return? Probe #3 found no element whose text is
//     exactly "Back" - which contradicts what is recorded for this profile elsewhere, so it is
//     re-measured here with a wider net before anything is concluded from it.
//
// COMMITS NOTHING.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o);
const ROW = '[role="row"]:has([role="rowheader"])';
const SEARCH = '[data-testid="agent-candidates-deactivated-search-input"]';

async function signIn(page, email, password) {
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 90000, waitUntil: 'commit' });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ------------------------------------------------------------------ D. zero-candidate agent
  console.log('=== D. THE TAB-LEVEL EMPTY STATE, ON AN AGENT WITH NO CANDIDATES ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await signIn(page, process.env.NO_CANDIDATE_AGENT_EMAIL, process.env.NO_CANDIDATE_AGENT_PASSWORD);
      await page.goto(`${origin}/candidates/deactivated`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      await page.keyboard.press('Escape').catch(() => {});
      console.log('agent:', process.env.NO_CANDIDATE_AGENT_EMAIL);
      console.log('rows:', await page.locator(ROW).count());
      console.log('main text:', J((await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 400)));
      console.log('search input present:', await page.locator(SEARCH).count());
      console.log('filters button present:', await page.locator('[data-testid="agent-candidates-deactivated-filters-button"]').count());
    } catch (e) {
      console.log('could not measure the zero-candidate agent:', e.message);
    }
    await ctx.close();
  }

  // ------------------------------------------------------------------ E. getting back
  console.log('\n=== E. RETURNING TO THE LISTING FROM THE PROFILE ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page, process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD);

    await page.goto(`${origin}/candidates/deactivated?accountVerification=unverified`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const before = await page.locator(ROW).count();
    const beforeUrl = decodeURIComponent(page.url());
    console.log('filtered listing:', beforeUrl, ' rows:', before);

    await page.locator('[data-testid="agent-candidates-view-button"]').first().click();
    await page.waitForURL(/view-profile/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(7000);
    console.log('profile url:', decodeURIComponent(page.url()));

    console.log(
      'anything whose text CONTAINS "Back":',
      J(
        await page.locator('body *').evaluateAll((els) =>
          els
            .filter((e) => e.children.length === 0 && /back/i.test(e.innerText || ''))
            .slice(0, 10)
            .map((e) => ({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 30), tabIndex: e.tabIndex, cls: (e.getAttribute('class') || '').slice(0, 70) }))
        )
      )
    );
    console.log(
      'svg/icon controls in the first 200px of <main>:',
      J(
        await page.locator('main svg').evaluateAll((es) =>
          es.slice(0, 6).map((e) => {
            const r = e.getBoundingClientRect();
            return { cls: (e.getAttribute('class') || '').slice(0, 50), top: Math.round(r.top), inButton: Boolean(e.closest('button')), aria: e.getAttribute('aria-label') };
          })
        )
      )
    );

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    console.log('after browser Back -> url:', decodeURIComponent(page.url()), ' rows:', await page.locator(ROW).count());
    console.log('filter still applied in the URL:', /accountVerification=unverified/.test(page.url()));
    const fb = page.locator('[data-testid="agent-candidates-deactivated-filters-button"]').first();
    console.log('Filters badge after Back:', J((await fb.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()));

    console.log('\n--- and with a SEARCH rather than a filter ---');
    await page.goto(`${origin}/candidates/deactivated`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const rowsNow = await page.locator(ROW).evaluateAll((rs) => rs.map((r) => ((r.querySelector('[role="rowheader"]') || {}).innerText || '').replace(/\s+/g, ' ').trim()));
    const term = (rowsNow[0] || '').split(/\s(?=\S+@)/)[0];
    await page.locator(SEARCH).first().fill(term);
    await page.waitForTimeout(3000);
    console.log('searched', J(term), '-> url:', decodeURIComponent(page.url()).split('?')[1], ' rows:', await page.locator(ROW).count());
    await page.locator('[data-testid="agent-candidates-view-button"]').first().click();
    await page.waitForURL(/view-profile/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    console.log('after Back -> url:', decodeURIComponent(page.url()), ' rows:', await page.locator(ROW).count());
    console.log('search box holds:', J(await page.locator(SEARCH).first().inputValue().catch(() => null)));

    await ctx.close();
  }

  await browser.close();
})().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
