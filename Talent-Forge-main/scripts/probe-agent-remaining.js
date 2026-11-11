// probe-agent-remaining.js — the questions the first two probes left open.
//
//   node scripts/probe-agent-remaining.js
//
//   1. does the Filters modal restore the APPLIED selection when reopened?
//      (probe-agent-management.js read `[role="checkbox"]`, which matches nothing here —
//       they are real <input type="checkbox">, so its "checked: []" proved nothing)
//   2. the University filter — its URL/API param and whether it really narrows
//   3. do two groups intersect (AND) or union (OR)?
//   4. the Edit Target modal on the view page
//   5. the Deactivated tab's Reactivate action and the Requires Attention tab's Notify
//   6. the transfer dropdown's "No agents available" vs what the API returns
//
// READ-ONLY: every dialog it opens is cancelled. It never reactivates, notifies, saves a
// target or transfers anything.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
const line = (t) => console.log(`\n${'='.repeat(16)} ${t} ${'='.repeat(16)}`);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const api = [];
  page.on('request', (r) => { if (/\/api\/v1\/agent/.test(r.url()) && r.method() === 'GET') api.push(r.url()); });
  const drain = () => api.splice(0, api.length);

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management|\/analytics/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const listLoaded = () => page.waitForResponse(
    (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET', { timeout: 30000 },
  ).catch(() => null);
  const go = async (qs = '') => {
    const p = listLoaded();
    await page.goto(`${ORIGIN}/agents${qs}`);
    await p;
    await page.waitForTimeout(2200);
  };
  const openFilters = async () => {
    await page.getByRole('button', { name: /^filters/i }).first().click();
    await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
  };
  // The real checkbox state, read from the inputs rather than a [role] attribute.
  const checkedState = () => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'NO DIALOG';
    return Array.from(d.querySelectorAll('label[data-testid]')).map((l) => ({
      testid: l.getAttribute('data-testid'),
      checked: (l.querySelector('input[type="checkbox"]') || {}).checked,
      ariaChecked: (l.querySelector('input[type="checkbox"]') || {}).getAttribute
        ? l.querySelector('input[type="checkbox"]').getAttribute('aria-checked') : null,
    }));
  });
  const rowsNow = () => page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]') && /@/.test(r.innerText || ''))
      .map((r) => {
        const cells = Array.from(r.querySelectorAll('[role="gridcell"]')).map((x) => c(x.innerText));
        return { uni: cells[0], candidates: cells[2], progress: cells[3], actions: Array.from(r.querySelectorAll('button')).map((b) => c(b.getAttribute('aria-label')) || c(b.innerText)).filter(Boolean) };
      });
  });

  // ---- 1. Does the modal restore the applied selection? ----
  line('1. Filters modal — does it restore the APPLIED selection on reopen?');
  await go();
  await openFilters();
  console.log('  fresh open      :', JSON.stringify(await checkedState()));
  await page.locator('[data-testid="filters-candidateCount-1-50-checkbox"]').click();
  await page.locator('[data-testid="filters-targetProgress-76-100-checkbox"]').click();
  console.log('  after 2 clicks  :', JSON.stringify(await checkedState()));
  const applied = listLoaded();
  await page.locator('[data-testid="filters-apply-button"]').click();
  await applied;
  await page.waitForTimeout(2200);
  console.log('  url             :', page.url());
  await openFilters();
  console.log('  REOPENED        :', JSON.stringify(await checkedState()));
  console.log('  -> restores applied selection:',
    (await checkedState()).filter((c) => c.checked).length === 2 ? 'YES' : 'NO');

  // ---- 2. Clear All: does it clear the URL/results too, or only the modal? ----
  line('2. Clear All inside the modal (with filters already applied)');
  await page.locator('[data-testid="filters-clear-all-button"]').click();
  await page.waitForTimeout(1500);
  console.log('  checked after Clear All:', JSON.stringify((await checkedState()).map((c) => c.checked)));
  console.log('  url now                :', page.url());
  console.log('  dialog still open      :', await page.locator('[role="dialog"]').isVisible().catch(() => 'err'));
  const afterApply = listLoaded();
  await page.locator('[data-testid="filters-apply-button"]').click().catch(() => {});
  await afterApply;
  await page.waitForTimeout(2000);
  console.log('  url after Apply        :', page.url());
  console.log('  Filters button         :', await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /^filters/i.test(x.innerText));
    return b ? b.innerText.replace(/\s+/g, ' ').trim() : '(none)';
  }));

  // ---- 3. Empty-state "Clear All" on the page (not the modal) ----
  line('3. The empty state\'s own Clear All CTA');
  await go('?targetProgress=1-25');
  console.log('  rows:', (await rowsNow()).length);
  console.log('  empty state:', await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('h1,h2,h3,h4')).find((x) => /no results/i.test(x.innerText));
    return h ? (h.parentElement || h).innerText.replace(/\s+/g, ' ').trim() : '(none)';
  }));
  const cleared = listLoaded();
  await page.getByRole('button', { name: /^clear all$/i }).first().click();
  await cleared;
  await page.waitForTimeout(2200);
  console.log('  after page Clear All -> url:', page.url(), ' rows:', (await rowsNow()).length);

  // ---- 4. University filter ----
  line('4. University filter — param and narrowing');
  await go();
  await openFilters();
  await page.locator('[role="dialog"] button[aria-label="Show suggestions"]').first().click();
  await page.waitForTimeout(1200);
  const uniOptions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()));
  console.log('  first options:', JSON.stringify(uniOptions.slice(0, 3)), `(${uniOptions.length} shown)`);
  const chosen = uniOptions.find((o) => /Al-Riyada/i.test(o)) || uniOptions[0];
  await page.getByRole('option', { name: chosen, exact: true }).first().click().catch(async () => {
    await page.locator('[role="option"]').filter({ hasText: chosen }).first().click();
  });
  await page.waitForTimeout(900);
  console.log('  chose:', JSON.stringify(chosen));
  console.log('  combobox holds:', JSON.stringify(await page.locator('[role="dialog"] input[placeholder*="university" i]').inputValue().catch(() => 'n/a')));
  drain();
  const uniApplied = listLoaded();
  await page.locator('[data-testid="filters-apply-button"]').click();
  await uniApplied;
  await page.waitForTimeout(2500);
  console.log('  url  :', page.url());
  console.log('  api  :', drain().join(' , '));
  const uniRows = await rowsNow();
  console.log(`  rows : ${uniRows.length}`);
  console.log('  universities returned:', JSON.stringify([...new Set(uniRows.map((r) => r.uni))]));
  console.log('  -> all rows are the chosen university:',
    uniRows.length && uniRows.every((r) => r.uni === chosen) ? 'YES' : 'NO');

  // ---- 5. Two groups: AND or OR? ----
  line('5. Two groups at once — intersection or union?');
  const combo = listLoaded();
  await page.goto(`${ORIGIN}/agents?candidateCount=1-50&targetProgress=76-100`);
  const comboBody = await (await combo).json().catch(() => null);
  await page.waitForTimeout(2500);
  if (comboBody) {
    console.log(`  count=${comboBody.count}`);
    comboBody.results.forEach((a) => console.log(`    ${a.email} cand=${a.total_candidate_count} pct=${(a.monthly_progress || {}).percentage}`));
    const bothHold = comboBody.results.every((a) => a.total_candidate_count >= 1 && a.total_candidate_count <= 50
      && (a.monthly_progress || {}).percentage >= 76);
    console.log(`  every row satisfies BOTH groups: ${bothHold ? 'YES (AND)' : 'NO (union or ignored)'}`);
  }

  // ---- 6. Row actions per tab, and the Reactivate / Notify dialogs ----
  line('6. Deactivated tab — Reactivate');
  await go('?tab=deactivated');
  console.log('  actions on row 1:', JSON.stringify((await rowsNow())[0]));
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^reactivate$/i }) }).first()
    .getByRole('button', { name: /^reactivate$/i }).click();
  await page.waitForTimeout(1800);
  console.log('  dialog:', await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'NO DIALOG (acted immediately?)';
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      body: c(d.innerText),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
    });
  }));
  await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});
  await page.waitForTimeout(800);

  line('6b. Requires Attention tab — Notify');
  await go('?tab=requiresAttention');
  console.log('  actions on row 1:', JSON.stringify((await rowsNow())[0]));
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^notify$/i }) }).first()
    .getByRole('button', { name: /^notify$/i }).click();
  await page.waitForTimeout(1800);
  console.log('  dialog/toast:', await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const toasts = Array.from(document.querySelectorAll('.Toastify__toast,[role="status"],[role="alert"]')).map((t) => c(t.innerText)).filter(Boolean);
    if (!d) return JSON.stringify({ dialog: 'NONE', toasts });
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      body: c(d.innerText).slice(0, 400),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))),
      toasts,
    });
  }));
  await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});

  // ---- 7. Edit Target modal on the view page ----
  line('7. View page — Edit Target modal');
  await go();
  await page.locator('[role="row"]').filter({ has: page.getByRole('button', { name: /^view$/i }) }).first()
    .getByRole('button', { name: /^view$/i }).click();
  await page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('  url:', page.url());
  await page.getByRole('button', { name: /edit target/i }).first().click();
  await page.waitForTimeout(1800);
  console.log('  modal:', await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'NO DIALOG';
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      text: c(d.innerText),
      fields: Array.from(d.querySelectorAll('input,textarea')).map((i) => ({ type: i.type, ph: i.placeholder, value: i.value, min: i.min, max: i.max })),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
      testids: Array.from(d.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')),
    }, null, 2);
  }));
  // Gating: what does it do with an empty / zero / negative / huge target?
  for (const v of ['', '0', '-5', '999999', 'abc', '3']) {
    const res = await page.evaluate(async (val) => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no dialog';
      const inp = d.querySelector('input');
      if (!inp) return 'no input';
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(inp, val); inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      const c = (x) => String(x || '').replace(/\s+/g, ' ').trim();
      const save = Array.from(d.querySelectorAll('button')).find((b) => /save|update|confirm/i.test(b.innerText));
      return JSON.stringify({
        held: inp.value,
        saveLabel: save ? c(save.innerText) : '(none)',
        saveDisabled: save ? save.disabled : null,
        errors: Array.from(d.querySelectorAll('p,span,div')).filter((e) => {
          const t = c(e.innerText);
          return t && t.length < 120 && e.children.length === 0 && /^rgb\((2[0-9]{2}|1[89][0-9]),/.test(getComputedStyle(e).color);
        }).map((e) => c(e.innerText)),
      });
    }, v);
    console.log(`    target=${JSON.stringify(v)} -> ${res}`);
  }
  await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});

  // ---- 8. The transfer dropdown vs the API ----
  line('8. Transfer dropdown vs the university API');
  await go();
  const withCands = (await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const r = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((x) => !x.querySelector('[role="columnheader"]') && /@/.test(x.innerText))
      .map((x) => {
        const cells = Array.from(x.querySelectorAll('[role="gridcell"]')).map((y) => c(y.innerText));
        const h = x.querySelector('[role="rowheader"]');
        return { email: (h ? Array.from(h.querySelectorAll('p')).map((p) => c(p.innerText)) : []).find((p) => p.includes('@')), candidates: Number(cells[2]) };
      }).find((x) => x.candidates > 0);
    return r;
  }));
  console.log('  subject:', JSON.stringify(withCands));
  if (withCands) {
    drain();
    await page.locator('[role="row"]', { hasText: withCands.email }).first()
      .getByRole('button', { name: /^deactivate account$/i }).click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    await page.waitForTimeout(2500);
    const calls = api.slice();
    await page.locator('[role="dialog"] button[aria-label="Show suggestions"]').first().click();
    await page.waitForTimeout(1800);
    console.log('  dropdown says:', await page.evaluate(() =>
      JSON.stringify(Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()))));
    const uniCall = calls.concat(api).find((u) => /university=/.test(u));
    console.log('  university call:', uniCall || '(none)');
    if (uniCall) {
      console.log('  API returned  :', await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          const j = await r.json();
          return JSON.stringify({
            count: j.count,
            agents: (j.results || []).map((a) => `${a.first_name} ${a.last_name} <${a.email}> status=${a.status}`),
          }, null, 2);
        } catch (e) { return `fetch failed: ${e.message}`; }
      }, uniCall));
    }
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});
  }

  line('DONE — nothing mutated');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
