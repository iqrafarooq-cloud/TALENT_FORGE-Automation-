// probe-agent-management.js — measure, against the LIVE app, everything the superadmin
// "User Management > Agents" module does that Agent.feature is written against.
//
//   node scripts/probe-agent-management.js
//
// READ-ONLY. It opens the Update Email Address and Deactivate dialogs to read their
// contract and then CANCELS every one of them. It never clicks Update, Deactivate or
// Transfer & Deactivate, so it mutates nothing and costs nothing.
//
// Written because every assertion in Agent.feature needs a measured value, not a guessed
// one: the filter URL/API param spellings, the four tabs' column sets, the two deactivate
// variants, and the verbatim inline errors of the email modal.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const line = (t) => console.log(`\n${'='.repeat(16)} ${t} ${'='.repeat(16)}`);
const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;

// Every option the Filters modal offers, by the group it sits under. Kept here as the
// probe's own expectation so a REMOVED option shows up as a miss rather than silently
// shrinking the report.
const FILTER_GROUPS = {
  'Target Progress': ['1% - 25%', '26% - 50%', '51% - 75%', '76% - 100%'],
  'Candidate Count': ['0', '1-50', '51-100', '100+'],
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Record every agent-list API call so a URL param can be paired with the query the app
  // actually sends. The UI spelling and the API spelling differ (targetProgress vs
  // target_progress), and only the second one proves the filter reached the backend.
  const api = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/v1\/agent/.test(url) && req.method() === 'GET') api.push(url);
  });
  const sinceLast = () => api.splice(0, api.length);

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management|\/analytics/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // The grid paints SKELETON rows first — 10 [role=row]s whose cells are all empty — so a
  // read timed on the row COUNT reports 10 agents with no names. Every read here waits for
  // a row that actually holds an email, or for a genuine empty state, before trusting it.
  const settle = async (timeout = 25000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'))
          .filter((r) => !r.querySelector('[role="columnheader"]'));
        const filled = rows.filter((r) => /@/.test(r.innerText || '')).length;
        const empty = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
          .some((h) => /no results|no pending|no agents|not found/i.test(h.innerText || ''));
        return { rows: rows.length, filled, empty };
      });
      // NOT `state.rows === 0` — a page that has not rendered yet has zero rows too, so
      // treating that as settled returns instantly on a blank page, and navigating away
      // then cancels the list request that was still in flight (observed: every tab after
      // the first reported "API (none)" and no columns at all).
      if (state.filled > 0 || state.empty) return state;
      await page.waitForTimeout(400);
    }
    return { timedOut: true };
  };
  const goListing = async (qs = '') => {
    await page.goto(`${ORIGIN}/agents${qs}`);
    await page.waitForLoadState('domcontentloaded');
    await settle();
  };
  const readRows = () => page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'))
      .map((r) => {
        const h = r.querySelector('[role="rowheader"]');
        const paras = h ? Array.from(h.querySelectorAll('p')).map((p) => c(p.innerText)) : [];
        return {
          name: paras[0] || '',
          email: paras.find((p) => p.includes('@')) || '',
          cells: Array.from(r.querySelectorAll('[role="gridcell"]')).map((x) => c(x.innerText)),
          actions: Array.from(r.querySelectorAll('button,[role="button"]'))
            .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        };
      });
  });
  const headers = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="columnheader"]')).map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
  const filtersButtonLabel = () => page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const b = Array.from(document.querySelectorAll('button')).find((x) => /^filters\b/i.test(c(x.innerText)));
    return b ? c(b.innerText) : '(no Filters button)';
  });
  const emptyState = () => page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('h1,h2,h3,h4')).find((x) => /no results|no pending|no agents|not found/i.test(x.innerText));
    if (!h) return null;
    const wrap = h.parentElement || h;
    return (wrap.innerText || '').replace(/\s+/g, ' ').trim();
  });
  const openFilters = async () => {
    await page.getByRole('button', { name: /^filters/i }).first().click();
    await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
  };

  // ============ 1. Listing structure per tab ============
  for (const [tab, qs] of [['Active', ''], ['Invite Sent', '?tab=inviteSent'],
    ['Requires Attention', '?tab=requiresAttention'], ['Deactivated', '?tab=deactivated']]) {
    sinceLast();
    await goListing(qs);
    line(`TAB "${tab}"`);
    console.log('  url            :', page.url());
    console.log('  API            :', sinceLast().join('\n                   ') || '(none)');
    console.log('  columns        :', (await headers()).join(' | '));
    console.log('  Filters button :', await filtersButtonLabel());
    const rows = await readRows();
    console.log(`  rows           : ${rows.length}`);
    rows.slice(0, 3).forEach((r) => console.log(`    - ${r.name} <${r.email}> cells=${JSON.stringify(r.cells)} actions=${JSON.stringify(r.actions)}`));
    const es = await emptyState();
    if (es) console.log('  empty state    :', JSON.stringify(es));
    console.log('  pagination     :', await page.evaluate(() => {
      const n = document.querySelector('[aria-label*="Pagination" i]');
      return n ? n.innerText.replace(/\s+/g, ' ').trim() : '(none)';
    }));
  }

  // ============ 2. Search ============
  line('SEARCH');
  await goListing();
  const first = (await readRows())[0];
  console.log('  subject:', JSON.stringify(first && { name: first.name, email: first.email }));
  const searchProbe = async (term, label) => {
    sinceLast();
    const box = page.getByRole('searchbox').first();
    await box.fill('');
    await box.fill(term);
    // The box is debounced, and settle() would happily return on the PREVIOUS term's rows
    // (they still hold emails). Wait for the list request this term causes, then settle.
    await page.waitForResponse(
      (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 12000 },
    ).catch(() => {});
    await page.waitForTimeout(900);
    await settle();
    const rows = await readRows();
    console.log(`  ${label.padEnd(26)} term=${JSON.stringify(term)}`);
    console.log(`    url=${page.url()}`);
    console.log(`    api=${sinceLast().join(' , ') || '(none)'}`);
    console.log(`    rows=${rows.length} ${JSON.stringify(rows.slice(0, 3).map((r) => `${r.name} <${r.email}>`))}`);
    console.log(`    emptyState=${JSON.stringify(await emptyState())}`);
  };
  if (first) {
    await searchProbe(first.name, 'full name');
    await searchProbe(first.name.split(' ')[0], 'first word of name');
    await searchProbe(first.name.toUpperCase(), 'name UPPERCASED');
    await searchProbe(first.email, 'FULL EMAIL (TFF-532)');
    await searchProbe(first.email.split('@')[0], 'email local-part');
  }
  await searchProbe('ZZZNONEXISTENT999', 'no match');
  await searchProbe('   ', 'whitespace only');
  await searchProbe("a' OR 1=1 --", 'injection-ish string');
  await searchProbe('<script>x</script>', 'html-ish string');

  // ============ 3. Filters modal contract ============
  line('FILTERS MODAL — contract');
  await goListing();
  await openFilters();
  console.log(await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      groupTitles: Array.from(d.querySelectorAll('p')).map((p) => c(p.innerText)).filter(Boolean),
      checkboxes: Array.from(d.querySelectorAll('[role="checkbox"]')).map((x) => ({
        name: c(x.getAttribute('aria-label') || x.innerText),
        checked: x.getAttribute('aria-checked') === 'true' || x.checked === true,
      })),
      testids: Array.from(d.querySelectorAll('[data-testid]')).map((e) => `${e.getAttribute('data-testid')} <${e.tagName.toLowerCase()}>`),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
      comboboxes: Array.from(d.querySelectorAll('input[type="text"],[role="combobox"]')).map((i) => ({ ph: i.placeholder, value: i.value })),
    }, null, 2);
  }));

  // University combobox — options and whether it type-filters
  line('FILTERS MODAL — University combobox');
  await page.locator('[role="dialog"] button[aria-label="Show suggestions"]').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  console.log('  options on open:', await page.evaluate(() =>
    JSON.stringify(Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()))));
  const uniBox = page.locator('[role="dialog"] input[placeholder*="university" i]').first();
  await uniBox.fill('King');
  await page.waitForTimeout(1200);
  console.log('  options for "King":', await page.evaluate(() =>
    JSON.stringify(Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()))));
  await uniBox.fill('ZZZZNOSUCHUNI');
  await page.waitForTimeout(1200);
  console.log('  options for no-match:', await page.evaluate(() =>
    JSON.stringify(Array.from(document.querySelectorAll('[role="option"],[role="listbox"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()))));

  // ============ 4. Every filter option -> URL param + API param + rows ============
  line('FILTERS — one option at a time');
  for (const [group, options] of Object.entries(FILTER_GROUPS)) {
    for (const option of options) {
      await goListing();
      await openFilters();
      const slug = option.replace(/\s|%/g, '').replace(/^(\d+)-(\d+)$/, '$1-$2');
      const testid = `filters-${group === 'Target Progress' ? 'targetProgress' : 'candidateCount'}-${slug}-checkbox`;
      const box = page.locator(`[data-testid="${testid}"]`);
      const exists = await box.count();
      if (!exists) { console.log(`  ${group} / ${option}  -> NO TESTID "${testid}"`); continue; }
      await box.click();
      sinceLast();
      await page.locator('[data-testid="filters-apply-button"]').click();
      await settle();
      const rows = await readRows();
      console.log(`  ${group} / ${option}`);
      console.log(`    testid  = ${testid}`);
      console.log(`    url     = ${page.url()}`);
      console.log(`    api     = ${sinceLast().join(' , ') || '(none)'}`);
      console.log(`    badge   = ${await filtersButtonLabel()}   rows=${rows.length}`);
      console.log(`    values  = ${JSON.stringify(rows.slice(0, 6).map((r) => r.cells.slice(-3)))}`);
      if (!rows.length) console.log(`    empty   = ${JSON.stringify(await emptyState())}`);
    }
  }

  // ============ 5. Multi-select, combining groups, Clear All, Cancel ============
  line('FILTERS — multi-select within one group');
  await goListing();
  await openFilters();
  await page.locator('[data-testid="filters-candidateCount-0-checkbox"]').click();
  await page.locator('[data-testid="filters-candidateCount-1-50-checkbox"]').click();
  sinceLast();
  await page.locator('[data-testid="filters-apply-button"]').click();
  await page.waitForTimeout(2200);
  console.log('  url  =', page.url());
  console.log('  api  =', sinceLast().join(' , '));
  console.log('  badge=', await filtersButtonLabel());

  line('FILTERS — two groups at once');
  await goListing();
  await openFilters();
  await page.locator('[data-testid="filters-candidateCount-0-checkbox"]').click();
  await page.locator('[data-testid="filters-targetProgress-76-100-checkbox"]').click();
  sinceLast();
  await page.locator('[data-testid="filters-apply-button"]').click();
  await page.waitForTimeout(2200);
  console.log('  url  =', page.url());
  console.log('  api  =', sinceLast().join(' , '));
  console.log('  badge=', await filtersButtonLabel(), ' rows=', (await readRows()).length);

  line('FILTERS — reopening the modal shows the applied selection');
  await openFilters();
  console.log('  checked now:', await page.evaluate(() => JSON.stringify(
    Array.from(document.querySelectorAll('[role="dialog"] [role="checkbox"]'))
      .map((x) => ({ n: (x.getAttribute('aria-label') || '').trim(), c: x.getAttribute('aria-checked') })))));

  line('FILTERS — Clear All inside the modal');
  await page.locator('[data-testid="filters-clear-all-button"]').click();
  await page.waitForTimeout(800);
  console.log('  checked after Clear All:', await page.evaluate(() => JSON.stringify(
    Array.from(document.querySelectorAll('[role="dialog"] [role="checkbox"]'))
      .map((x) => x.getAttribute('aria-checked')))));
  console.log('  url still:', page.url());
  console.log('  dialog still open:', await page.locator('[role="dialog"]').isVisible());

  line('FILTERS — Cancel discards an unapplied selection');
  await goListing();
  await openFilters();
  await page.locator('[data-testid="filters-candidateCount-100+-checkbox"]').click();
  await page.locator('[role="dialog"] button:has-text("Cancel")').click();
  await page.waitForTimeout(1200);
  console.log('  url after Cancel :', page.url());
  console.log('  badge            :', await filtersButtonLabel());
  await openFilters();
  console.log('  checked on reopen:', await page.evaluate(() => JSON.stringify(
    Array.from(document.querySelectorAll('[role="dialog"] [role="checkbox"]')).map((x) => x.getAttribute('aria-checked')))));

  line('FILTERS — close methods');
  for (const method of ['X icon', 'Escape', 'backdrop']) {
    await goListing();
    await openFilters();
    if (method === 'X icon') await page.locator('[role="dialog"] button[aria-label="Close" i]').first().click().catch(() => {});
    if (method === 'Escape') await page.keyboard.press('Escape');
    if (method === 'backdrop') await page.mouse.click(6, 6);
    await page.waitForTimeout(1200);
    console.log(`  ${method.padEnd(10)} -> dialog visible: ${await page.locator('[role="dialog"]').isVisible().catch(() => 'err')}`);
  }

  // ============ 6. Filter + search together, and survival across tab switch / reload ============
  line('FILTER + SEARCH together, and persistence');
  await goListing();
  await openFilters();
  await page.locator('[data-testid="filters-candidateCount-0-checkbox"]').click();
  await page.locator('[data-testid="filters-apply-button"]').click();
  await page.waitForTimeout(2000);
  await page.getByRole('searchbox').first().fill('Nopromo');
  await page.waitForTimeout(2200);
  console.log('  url with both     :', page.url());
  console.log('  rows              :', (await readRows()).length);
  console.log('  badge             :', await filtersButtonLabel());
  await page.reload();
  await page.waitForTimeout(2500);
  console.log('  after RELOAD url  :', page.url());
  console.log('  after RELOAD badge:', await filtersButtonLabel());
  console.log('  search box holds  :', JSON.stringify(await page.getByRole('searchbox').first().inputValue()));
  await page.getByRole('radio', { name: /^Deactivated$/i }).click();
  await page.waitForTimeout(2500);
  console.log('  after TAB SWITCH url  :', page.url());
  console.log('  after TAB SWITCH badge:', await filtersButtonLabel());
  console.log('  search box holds      :', JSON.stringify(await page.getByRole('searchbox').first().inputValue()));

  // ============ 7. Pagination ============
  line('PAGINATION');
  await goListing();
  const pageText = () => page.evaluate(() => {
    const n = document.querySelector('[aria-label*="Pagination" i]');
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '(none)';
  });
  console.log('  page 1        :', await pageText());
  console.log('  prev disabled :', await page.getByRole('button', { name: /previous/i }).first().isDisabled());
  const p1 = (await readRows()).map((r) => r.email);
  sinceLast();
  await page.getByRole('button', { name: /next/i }).first().click();
  await page.waitForTimeout(2500);
  console.log('  page 2        :', await pageText());
  console.log('  api           :', sinceLast().join(' , '));
  console.log('  url           :', page.url());
  const p2 = (await readRows()).map((r) => r.email);
  console.log('  overlap p1/p2 :', p1.filter((e) => p2.includes(e)).length, 'of', p1.length);
  console.log('  prev disabled :', await page.getByRole('button', { name: /previous/i }).first().isDisabled());

  // ============ 8. View page ============
  line('VIEW PAGE');
  await goListing();
  const rowsForView = await readRows();
  const withCands = rowsForView.find((r) => Number(r.cells[2]) > 0) || rowsForView[0];
  await page.locator('[role="row"]', { hasText: withCands.email }).first()
    .getByRole('button', { name: /^view$/i }).click();
  await page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log('  url    :', page.url());
  console.log(await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      headerText: c((document.querySelector('main') || document.body).innerText).slice(0, 400),
      tabs: Array.from(document.querySelectorAll('[role="tab"],[role="radio"]')).map((t) => ({
        n: c(t.innerText), sel: t.getAttribute('aria-selected') || t.getAttribute('aria-checked'),
      })),
      topButtons: Array.from(document.querySelectorAll('main button, header button')).map((b) => c(b.innerText)).filter(Boolean).slice(0, 12),
    }, null, 2);
  }));
  for (const t of ['Candidates', 'Promo Tools', 'Activity Log']) {
    await page.getByRole('tab', { name: new RegExp(`^${t}$`, 'i') }).or(page.getByRole('radio', { name: new RegExp(`^${t}$`, 'i') })).first().click().catch(() => {});
    await page.waitForTimeout(2200);
    console.log(`  --- tab "${t}" url=${page.url()}`);
    console.log('     ', await page.evaluate(() => {
      const m = document.querySelector('main');
      return (m ? m.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 500);
    }));
  }

  line('VIEW PAGE — Edit Target modal');
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /edit target/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'NO DIALOG';
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      text: c(d.innerText),
      fields: Array.from(d.querySelectorAll('input,textarea')).map((i) => ({ type: i.type, ph: i.placeholder, value: i.value, min: i.min, max: i.max })),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
    }, null, 2);
  }));
  await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});

  // ============ 9. Update Email Address modal — verbatim validation ============
  line('UPDATE EMAIL ADDRESS modal (opened, read, CANCELLED — never saved)');
  await goListing();
  const target = (await readRows())[0];
  await page.locator('[role="row"]', { hasText: target.email }).first()
    .getByRole('button', { name: /^edit$/i }).click();
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  console.log('  subject:', target.email);
  console.log(await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      labels: Array.from(d.querySelectorAll('label')).map((l) => c(l.innerText)),
      fields: Array.from(d.querySelectorAll('input')).map((i) => ({ ph: i.placeholder, value: i.value, disabled: i.disabled, readOnly: i.readOnly })),
      buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
    }, null, 2);
  }));
  const emailCases = [
    ['notanemail', 'different@bytecorp.io', 'invalid format + mismatch'],
    ['a@b.io', 'c@d.io', 'valid but mismatched'],
    ['notanemail', 'notanemail', 'invalid format, matching'],
    ['', '', 'both empty'],
    ['   ', '   ', 'whitespace only'],
    ['qa.new+probe@bytecorp.io', 'qa.new+probe@bytecorp.io', 'valid & matching'],
    ['QA.New+PROBE@BYTECORP.IO', 'qa.new+probe@bytecorp.io', 'case-differing pair'],
    ['no@domain', 'no@domain', 'no TLD'],
    ['spaced out@bytecorp.io', 'spaced out@bytecorp.io', 'space inside local part'],
  ];
  for (const [a, b, label] of emailCases) {
    const res = await page.evaluate(async ([nv, cv]) => {
      const d = document.querySelector('[role="dialog"]');
      const ins = Array.from(d.querySelectorAll('input'));
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(ins[1], nv); set(ins[2], cv);
      await new Promise((r) => setTimeout(r, 700));
      const upd = Array.from(d.querySelectorAll('button')).find((x) => /^update$/i.test((x.innerText || '').trim()));
      const errs = Array.from(d.querySelectorAll('p,span,div')).filter((e) => {
        const t = (e.innerText || '').trim();
        return t && t.length < 160 && e.children.length === 0
          && /^rgb\((2[0-9]{2}|1[89][0-9]),/.test(getComputedStyle(e).color);
      }).map((e) => (e.innerText || '').trim());
      return { updateDisabled: upd.disabled, errors: Array.from(new Set(errs)) };
    }, [a, b]);
    console.log(`  ${label.padEnd(26)} new=${JSON.stringify(a)} confirm=${JSON.stringify(b)}`);
    console.log(`    Update disabled=${res.updateDisabled}  errors=${JSON.stringify(res.errors)}`);
  }
  // "Current Email Address" as the new one — needs the live value, so it is its own case.
  const cur = await page.evaluate(() => document.querySelectorAll('[role="dialog"] input')[0].value);
  const same = await page.evaluate(async (v) => {
    const d = document.querySelector('[role="dialog"]');
    const ins = Array.from(d.querySelectorAll('input'));
    const set = (el, x) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(ins[1], v); set(ins[2], v);
    await new Promise((r) => setTimeout(r, 700));
    const upd = Array.from(d.querySelectorAll('button')).find((x) => /^update$/i.test((x.innerText || '').trim()));
    return {
      updateDisabled: upd.disabled,
      errors: Array.from(d.querySelectorAll('p,span,div')).filter((e) => {
        const t = (e.innerText || '').trim();
        return t && t.length < 160 && e.children.length === 0 && /^rgb\((2[0-9]{2}|1[89][0-9]),/.test(getComputedStyle(e).color);
      }).map((e) => (e.innerText || '').trim()),
    };
  }, cur);
  console.log(`  ${'same as current'.padEnd(26)} new=${JSON.stringify(cur)}`);
  console.log(`    Update disabled=${same.updateDisabled}  errors=${JSON.stringify(same.errors)}`);
  console.log('  close methods:');
  for (const method of ['Escape', 'backdrop']) {
    if (method === 'Escape') await page.keyboard.press('Escape');
    if (method === 'backdrop') await page.mouse.click(6, 6);
    await page.waitForTimeout(1000);
    console.log(`    ${method} -> dialog visible: ${await page.locator('[role="dialog"]').isVisible().catch(() => 'err')}`);
    if (!(await page.locator('[role="dialog"]').isVisible().catch(() => false))) break;
  }
  await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});

  // ============ 10. Deactivate dialog — both variants ============
  line('DEACTIVATE dialog — both variants (opened, read, CANCELLED)');
  await goListing();
  const all = await readRows();
  const zero = all.find((r) => Number(r.cells[2]) === 0);
  const many = all.find((r) => Number(r.cells[2]) > 0);
  for (const [label, row] of [['0 candidates', zero], ['>=1 candidate', many]]) {
    if (!row) { console.log(`  ${label}: no such row on page 1`); continue; }
    sinceLast();
    await page.locator('[role="row"]', { hasText: row.email }).first()
      .getByRole('button', { name: /^deactivate account$/i }).click();
    await page.locator('[role="dialog"]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1800);
    console.log(`  --- ${label}: ${row.name} <${row.email}> candidates=${row.cells[2]}`);
    console.log('     api:', sinceLast().join(' , ') || '(none)');
    console.log('     ', await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return JSON.stringify({
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        body: c(d.innerText),
        fields: Array.from(d.querySelectorAll('input,[role="combobox"]')).map((i) => ({ ph: i.placeholder, value: i.value, disabled: i.disabled })),
        buttons: Array.from(d.querySelectorAll('button')).map((b) => ({ t: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
      });
    }));
    // For the transfer variant, what does the New Agent dropdown offer, and what did the
    // API say was available? That pair is the whole point — see the TRANSFER note below.
    const sugg = page.locator('[role="dialog"] button[aria-label="Show suggestions"]').first();
    if (await sugg.count()) {
      await sugg.click();
      await page.waitForTimeout(1500);
      console.log('     dropdown options:', await page.evaluate(() =>
        JSON.stringify(Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.replace(/\s+/g, ' ').trim()))));
      const uniCall = api.filter((u) => /university=/.test(u)).pop();
      console.log('     university API call:', uniCall || '(none seen)');
      if (uniCall) {
        const body = await page.evaluate(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'include' });
            const j = await r.json();
            const items = j.results || j.data || j || [];
            return JSON.stringify({
              count: j.count,
              statuses: items.map((i) => `${i.first_name} ${i.last_name} <${i.email}> ${i.status}`),
            });
          } catch (e) { return `fetch failed: ${e.message}`; }
        }, uniCall);
        console.log('     university API said:', body);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await page.locator('[role="dialog"] button:has-text("Cancel")').first().click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  line('DONE — nothing was saved, deactivated or transferred');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
