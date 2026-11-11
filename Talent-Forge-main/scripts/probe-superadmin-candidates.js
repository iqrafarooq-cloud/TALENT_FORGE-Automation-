/* eslint-disable no-console */
// probe-superadmin-candidates.js - READ-ONLY. The one command that answers "what does the
// SuperAdmin Portal's Candidates page actually do?"
//
// It commits NOTHING: no deactivation, no reactivation, no email change, no email sent. Every
// dialog it opens it dismisses again, and the two lifecycle dialogs (Deactivate / Reactivate)
// are inspected with their confirm button never clicked.
//
// WHY IT EXISTS. The candidate listing LOOKS like the agents listing and is not the same
// screen. Writing the feature files against the agents' shape would have produced locators
// that resolve to nothing and assertions describing a different product. The five differences
// that matter, all measured here:
//
//   1. View is a DRAWER, not a route. The URL stays /candidates - there is no
//      /candidates/view/<id>, no ?tab= per panel tab, and no Back control.
//   2. TWO of the five filter groups are single-select RADIOS (Pending Documents, Last
//      Activity). A second option there REPLACES the first instead of unioning with it.
//   3. Deactivation requires a REASON, and picking "Other" reveals a second required field.
//   4. Not one filter's API param equals its URL param - see the table in section 3.
//   5. The row actions are icon buttons with an aria-label and NO inner text.
//
// Run:  node scripts/probe-superadmin-candidates.js
//       HEADED=true node scripts/probe-superadmin-candidates.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);
const rx = (s) => new RegExp(`^${String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });
}

// Every candidate-list request the page fires, so a URL param can be printed beside the API
// param it produces. Both are asserted in the feature files, and they agree in no case.
function armListRecorder(page) {
  const seen = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/candidate\/\?/.test(r.url())) seen.push(r.url());
  });
  return seen;
}

const settle = (page, ms = 3500) => page.waitForTimeout(ms);

async function readGrid(page) {
  return page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]'));
    return {
      columns: Array.from(document.querySelectorAll('[role="columnheader"]')).map((h) => c(h.innerText)),
      rowCount: rows.length,
      tab: c((Array.from(document.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true') || {}).innerText),
      // Icon buttons: an aria-label and NO inner text, so a text locator finds nothing on a
      // row that plainly offers all three actions.
      firstRowActions: rows[0]
        ? Array.from(rows[0].querySelectorAll('button')).map((b) => b.getAttribute('aria-label')).filter(Boolean)
        : [],
      firstRow: rows[0] ? c(rows[0].innerText) : null,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const calls = armListRecorder(page);
  await login(page);

  // ---------- 1. Structure ----------
  head('1. /candidates - structure, tabs, columns, row actions');
  await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  console.log(JSON.stringify(await readGrid(page), null, 2));
  console.log('search placeholder:',
    JSON.stringify(await page.locator('input[type="search"]').first().getAttribute('placeholder')));

  for (const tab of ['Active', 'Deactivated']) {
    await page.goto(`${ORIGIN}/candidates?accountTab=${tab.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const g = await readGrid(page);
    console.log(`\n  ${tab} tab -> actions ${JSON.stringify(g.firstRowActions)}`);
    console.log(`  ${tab} tab -> columns ${JSON.stringify(g.columns)}`);
  }

  // ---------- 2. The Filters modal ----------
  head('2. Apply Filters - five groups, and TWO of them are single-select radios');
  await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByRole('button', { name: /^filters/i }).first().click();
  await page.waitForTimeout(1200);
  console.log(JSON.stringify(await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    return {
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      footer: Array.from(d.querySelectorAll('button')).map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))),
      groups: Array.from(d.querySelectorAll('p.font-bold')).map((p) => ({
        group: c(p.innerText),
        // The control TYPE is the finding. A selected radio also cannot be un-selected by
        // clicking it again, which is what Clear All exists for in those two groups.
        control: (p.parentElement.querySelector('input') || {}).type,
        options: Array.from(p.parentElement.querySelectorAll('label')).map((l) => ({
          label: c(l.innerText), testid: l.getAttribute('data-testid'),
        })),
      })),
    };
  }), null, 2));
  await page.keyboard.press('Escape');

  // ---------- 3. Every filter option's URL param AND its API param ----------
  head('3. filter option -> URL param -> API param (measured one option at a time)');
  const OPTIONS = [
    ['Status', 'Active'], ['Status', 'Deactivated'],
    ['Account Verification Status', 'Verified'], ['Account Verification Status', 'Unverified'],
    ['Pending Documents', '0'], ['Pending Documents', '1-2'], ['Pending Documents', '3+'],
    ['Subscription Status', 'Subscribed'], ['Subscription Status', 'Not Subscribed'],
    ['Subscription Status', 'Payment Due'],
    ['Last Activity', 'Last 24 hours'], ['Last Activity', 'Last 7 days'],
    ['Last Activity', 'Last 30 days'], ['Last Activity', '30+ days'],
  ];
  const table = [];
  for (const [group, option] of OPTIONS) {
    await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2500);
    await page.getByRole('button', { name: /^filters/i }).first().click();
    await page.waitForTimeout(1000);
    // >>> A REAL POINTER CLICK, NEVER element.click(). <<< The checkbox labels carry
    // data-react-aria-pressable, and a scripted .click() on them is a SILENT NO-OP: the
    // option looks selected to nobody and Apply produces a URL with the param missing. The
    // RADIO labels do respond to a scripted click, which is exactly what made this
    // confusing - a mixed probe reported the two radio groups working and the three
    // checkbox groups ignored, i.e. an app defect that does not exist.
    const before = calls.length;
    await page.locator('[role="dialog"]').last().locator('label')
      .filter({ hasText: rx(option) }).first()
      .click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="filters-apply-button"]').click();
    await page.waitForTimeout(2500);
    table.push({
      group,
      option,
      url: decodeURIComponent(new URL(page.url()).search),
      api: decodeURIComponent((calls.slice(before).pop() || '').replace(/^.*\/candidate\//, '')),
    });
  }
  console.table(table);

  // ---------- 4. Search ----------
  head('4. search - what it matches, and what it does with whitespace');
  for (const term of ['Hassan', 'uat.candidate1540@talentforge.test', 'HASSAN al-saud',
    'ZZZNONEXISTENT999', "a' OR 1=1 --", '<script>x</script>', '   ']) {
    await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2500);
    const before = calls.length;
    await page.locator('input[type="search"]').first().fill(term);
    await page.waitForTimeout(3200);
    const g = await readGrid(page);
    const empty = await page.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h3,h4,p'))
      .map((h) => (h.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /no results|couldn'?t find/i.test(t)));
    console.log(`\n  ${JSON.stringify(term)}`);
    console.log(`    url   ${decodeURIComponent(new URL(page.url()).search) || '(none)'}`);
    console.log(`    api   ${decodeURIComponent(calls.slice(before).pop() || '(no request)').replace(/^.*\/candidate\//, '')}`);
    console.log(`    rows  ${g.rowCount}   empty state ${JSON.stringify(empty)}`);
  }

  // ---------- 5. The empty states ----------
  head('5. empty states - search vs filters, and their CTAs');
  for (const [what, url] of [
    ['search', `${ORIGIN}/candidates?search=ZZZNONEXISTENT999`],
    ['filters', `${ORIGIN}/candidates?status=deactivated&pendingDocuments=3plus&subscriptionStatus=paymentDue`],
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settle(page, 4000);
    console.log(`\n  ${what}: ${JSON.stringify(await page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const m = document.querySelector('main');
      return {
        text: c(m.innerText),
        ctas: Array.from(m.querySelectorAll('button')).map((b) => c(b.innerText)).filter(Boolean),
      };
    }), null, 2)}`);
  }

  // ---------- 6. The View drawer ----------
  head('6. View - a DRAWER, not a route. The URL never changes.');
  await page.goto(`${ORIGIN}/candidates?search=uat.candidate1540@talentforge.test`, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);
  const urlBefore = page.url();
  await page.locator('[role="row"]').nth(1).locator('[aria-label="View"]').click();
  await page.waitForTimeout(3500);
  console.log(`  url before ${urlBefore}`);
  console.log(`  url after  ${page.url()}   <-- unchanged: there is no /candidates/view/<id>`);
  console.log(JSON.stringify(await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    return {
      tabs: Array.from(d.querySelectorAll('[role="radio"]')).map((r) => c(r.innerText)),
      selected: c((Array.from(d.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true') || {}).innerText),
      // No Deactivate / Reactivate / Log in as control anywhere in the drawer: every
      // lifecycle action lives ONLY on the listing row.
      buttons: Array.from(d.querySelectorAll('button'))
        .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      header: c(d.innerText).slice(0, 300),
    };
  }), null, 2));

  for (const tab of ['Candidate Details', 'Track Progress', 'Documents', 'Subscription', 'Activity Log']) {
    const fired = [];
    const onReq = (r) => {
      if (/\/api\/v1\//.test(r.url()) && !/notifications/.test(r.url())) fired.push(r.url());
    };
    page.on('request', onReq);
    await page.locator('[role="dialog"]').last().getByRole('radio', { name: tab, exact: true }).click();
    await page.waitForTimeout(2800);
    page.off('request', onReq);
    const body = await page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
      return c(d.innerText).replace(/^.*?Activity Log/, '').slice(0, 700);
    });
    console.log(`\n  --- ${tab} ---`);
    console.log(`  requests: ${JSON.stringify(fired.map((u) => u.replace(/^.*\/api\/v1\//, '')))}`);
    console.log(`  body:     ${body}`);
  }
  await page.keyboard.press('Escape');

  // ---------- 7. Deactivate - inspected, NEVER confirmed ----------
  head('7. Deactivate Candidate Account - the reason gate. NOTHING IS CONFIRMED.');
  await page.goto(`${ORIGIN}/candidates`, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);
  await page.locator('[role="row"]').nth(1).locator('[aria-label="Deactivate account"]').click();
  await page.waitForTimeout(1800);
  console.log(JSON.stringify(await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    const sel = d.querySelector('select');
    return {
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      text: c(d.innerText),
      reasons: sel ? Array.from(sel.options).map((o) => ({ value: o.value, label: c(o.text) })) : null,
      buttons: Array.from(d.querySelectorAll('button'))
        .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
    };
  }), null, 2));

  // The gate, one reason at a time. "Other" is the interesting one: it REVEALS a required
  // textarea and re-disables confirm, so a scenario that picks a reason and expects to be
  // able to confirm is right for five of the six and wrong for the sixth.
  console.log('\n  reason -> confirm enabled?');
  console.log(JSON.stringify(await page.evaluate(async () => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    const sel = d.querySelector('select');
    const setSel = (v) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const confirm = () => Array.from(Array.from(document.querySelectorAll('[role="dialog"]')).pop()
      .querySelectorAll('button')).find((b) => /^Deactivate Account$/i.test(c(b.innerText)));
    const perReason = [];
    for (const o of Array.from(sel.options).filter((x) => x.value)) {
      setSel(o.value); await sleep(700);
      const dd = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
      perReason.push({
        reason: c(o.text),
        confirmDisabled: confirm().disabled,
        textareas: dd.querySelectorAll('textarea').length,
      });
    }
    // And the free-text gate under "Other": whitespace alone must not satisfy it.
    const ta = Array.from(document.querySelectorAll('[role="dialog"]')).pop().querySelector('textarea');
    const setTa = (v) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const otherGate = [];
    for (const v of ['', '   ', 'a real reason']) {
      setTa(v); await sleep(600);
      otherGate.push({ value: JSON.stringify(v), confirmDisabled: confirm().disabled });
    }
    return { perReason, otherTextarea: { placeholder: ta.placeholder, required: ta.required }, otherGate };
  }), null, 2));
  await page.keyboard.press('Escape');

  // ---------- 8. Reactivate - inspected, NEVER confirmed ----------
  head('8. Reactivate Account - NOTHING IS CONFIRMED.');
  await page.goto(`${ORIGIN}/candidates?accountTab=deactivated`, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);
  await page.locator('[role="row"]').nth(1).locator('[aria-label="Reactivate Account"]').click();
  await page.waitForTimeout(1800);
  console.log(JSON.stringify(await page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    return {
      heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
      text: c(d.innerText),
      buttons: Array.from(d.querySelectorAll('button'))
        .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled })),
      fields: d.querySelectorAll('input,select,textarea').length,
    };
  }), null, 2));
  await page.keyboard.press('Escape');

  console.log('\nDone. Nothing was committed: no deactivation, no reactivation, no email, no edit.\n');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
