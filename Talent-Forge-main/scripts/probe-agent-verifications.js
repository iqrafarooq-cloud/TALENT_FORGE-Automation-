// Read-only probe: the Agent Portal's Verifications page at /verifications.
//
// Maps the route, the four status tabs, the search box, the Filters modal (both groups), the
// columns, both row actions, the Document Verification panel (its fields, the react-pdf viewer,
// the zoom control, Download and the decision controls), the empty states and pagination.
//
// >>> IT COMMITS NOTHING. <<< Every dialog it opens it dismisses, and it NEVER clicks a submit
// control inside a decision dialog - Approve and Request Revision are irreversible and nothing
// in the product undoes either. The decision dialogs are opened only to read their contract and
// their mandatory-reason gate, then cancelled.
//
// Usage:  node scripts/probe-agent-verifications.js [--no-zoom] [--no-viewer]
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);
const ROW = 'tbody tr';
const args = process.argv.slice(2);
const SKIP_ZOOM = args.includes('--no-zoom');
const SKIP_VIEWER = args.includes('--no-viewer');

const TABS = {
  ALL: 'agent-verifications-tab-all',
  AWAITING: 'agent-verifications-tab-awaiting-verification',
  APPROVED: 'agent-verifications-tab-approved',
  REVISION: 'agent-verifications-tab-revision-required',
};

const short = (u) => String(u).replace(/^.*documents\/all\//, '');
const rel = (u) => decodeURIComponent(String(u)).replace(origin + '/verifications', '').replace(origin, '');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const api = [];
  page.on('request', (r) => {
    if (/\/api\/v1\//.test(r.url()) && r.method() === 'GET') api.push(decodeURIComponent(r.url()));
  });
  const listReqs = () => api.filter((u) => /candidate\/documents\/all/.test(u));
  const settle = (ms = 4000) => page.waitForTimeout(ms);

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started|\/verifications/, { timeout: 90000, waitUntil: 'commit' });

  api.length = 0;
  await page.goto(origin + '/verifications', { waitUntil: 'domcontentloaded' });
  await settle(6000);

  console.log('=== 1. ROUTE / IDENTITY ===');
  console.log('landed url:', rel(page.url()));
  console.log('heading   :', await page.locator('h1').first().innerText().catch(() => null));
  console.log('grid name :', await page.locator('[role="grid"]').first().getAttribute('aria-label').catch(() => null));
  console.log('list req  :', J(listReqs().map(short)));
  console.log('testids   :', J(await page.$$eval('[data-testid]', (es) => [...new Set(es.map((e) => e.getAttribute('data-testid')))])));

  console.log('\n=== 2. TAB STRIP ===');
  console.log(J(await page.$$eval('[role="radiogroup"] [role="radio"]', (rs) => rs.map((r) => ({
    text: r.innerText.replace(/\s+/g, ' ').trim(),
    testid: r.getAttribute('data-testid'),
    checked: r.getAttribute('aria-checked'),
  })))));
  console.log('elements with role=tab:', await page.locator('[role="tab"]').count());

  console.log('\n=== 3. COLUMNS + ROW SHAPE ===');
  console.log('columns:', J(await page.$$eval('[role="columnheader"]', (e) => e.map((x) => x.innerText.trim()))));
  console.log('cells of row 0 (index:role:text):', J(await page.$$eval(ROW + ':first-child td', (cs) =>
    cs.map((c, i) => i + ':' + c.getAttribute('role') + ':' + c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)))));
  console.log('row 0 actions:', J(await page.$$eval(ROW + ':first-child td:last-child button', (bs) =>
    bs.map((b) => ({ aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), text: b.innerText.trim(), disabled: b.disabled })))));
  console.log('uploaded-by cell controls:', J(await page.$$eval(ROW + ':first-child td:nth-child(2) button', (bs) =>
    bs.map((b) => ({ text: b.innerText.trim(), tabIndex: b.tabIndex })))));

  console.log('\n=== 4. EACH TAB: URL param vs API param ===');
  for (const status of Object.keys(TABS)) {
    api.length = 0;
    await page.locator('[data-testid="' + TABS[status] + '"]').click();
    await settle(3500);
    const req = listReqs().pop() || '(none)';
    const statuses = await page.$$eval(ROW + ' td:nth-child(5)', (cs) => [...new Set(cs.map((c) => c.innerText.trim()))]);
    console.log(status.padEnd(9) + ' url=' + rel(page.url()));
    console.log(''.padEnd(9) + ' api=' + short(req));
    console.log(''.padEnd(9) + ' rows=' + (await page.locator(ROW).count()) + ' statuses=' + J(statuses));
  }

  console.log('\n=== 5. FILTERS MODAL ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4000);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await settle(1200);
  let dlg = page.locator('[role="dialog"]').last();
  console.log('full text:', JSON.stringify(await dlg.innerText()));
  console.log('labels   :', J(await dlg.locator('label').evaluateAll((ls) => ls.map((l) => {
    const i = l.querySelector('input');
    return { text: l.innerText.replace(/\s+/g, ' ').trim(), type: i ? i.type : null, testid: l.getAttribute('data-testid'), pressable: l.hasAttribute('data-react-aria-pressable') };
  }))));
  console.log('buttons  :', J(await dlg.locator('button').evaluateAll((bs) => bs.map((b) => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), disabled: b.disabled })))));
  console.log('inputs   :', J(await dlg.locator('input').evaluateAll((is) => is.map((i) => ({ type: i.type, placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label'), ariaHidden: i.getAttribute('aria-hidden'), tabIndex: i.tabIndex })))));

  console.log('\n--- 5b. each document-type option: URL param vs API param ---');
  await dlg.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
  await settle(800);
  const TYPES = [['Transcript', 'EDUCATION'], ['Experience Letter', 'WORKEXPERIENCE'], ['Certification', 'CERTIFICATION']];
  for (const pair of TYPES) {
    await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
    await settle(3500);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await settle(1000);
    const d = page.locator('[role="dialog"]').last();
    api.length = 0;
    await d.locator('label[data-testid="filters-documentType-' + pair[1] + '-checkbox"]').click();
    await d.locator('[data-testid="filters-apply-button"]').click();
    await settle(3500);
    const types = await page.$$eval(ROW + ' td:nth-child(3)', (cs) => [...new Set(cs.map((c) => c.innerText.trim()))]);
    const badge = (await page.getByRole('button', { name: /^Filters/ }).innerText()).replace(/\s+/g, ' ').trim();
    console.log(pair[0].padEnd(18) + ' url=' + rel(page.url()));
    console.log(''.padEnd(18) + ' api=' + short(listReqs().pop() || '(none)'));
    console.log(''.padEnd(18) + ' renderedTypes=' + J(types) + ' badge=' + JSON.stringify(badge));
  }

  console.log('\n--- 5c. two options in one group, reopen, Clear All ---');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(3500);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await settle(1000);
  dlg = page.locator('[role="dialog"]').last();
  api.length = 0;
  await dlg.locator('label[data-testid="filters-documentType-EDUCATION-checkbox"]').click();
  await dlg.locator('label[data-testid="filters-documentType-CERTIFICATION-checkbox"]').click();
  await dlg.locator('[data-testid="filters-apply-button"]').click();
  await settle(3500);
  console.log('union url  :', rel(page.url()));
  console.log('union api  :', short(listReqs().pop() || ''));
  console.log('union types:', J(await page.$$eval(ROW + ' td:nth-child(3)', (cs) => [...new Set(cs.map((c) => c.innerText.trim()))])));
  console.log('union badge:', JSON.stringify((await page.getByRole('button', { name: /^Filters/ }).innerText()).replace(/\s+/g, ' ').trim()));

  await page.getByRole('button', { name: /^Filters/ }).click();
  await settle(1200);
  dlg = page.locator('[role="dialog"]').last();
  console.log('checked on reopen:', J(await dlg.locator('input[type=checkbox]').evaluateAll((is) => is.map((i) => i.checked))));
  api.length = 0;
  await dlg.locator('[data-testid="filters-clear-all-button"]').click();
  await settle(2500);
  console.log('after Clear All -> url:', rel(page.url()) || '(bare)', '| dialogs open:', await page.locator('[role="dialog"]').count());
  console.log('                -> badge:', JSON.stringify((await page.getByRole('button', { name: /^Filters/ }).innerText()).replace(/\s+/g, ' ').trim()));
  console.log('                -> api  :', short(listReqs().pop() || '(none)'));

  console.log('\n=== 6. SEARCH ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4000);
  const box = page.locator('input[type="search"]');
  console.log('placeholder:', await box.getAttribute('placeholder'));
  console.log('testid     :', await box.getAttribute('data-testid'));
  const firstDoc = (await page.locator(ROW + ' td').first().innerText()).trim();
  const firstUploader = (await page.locator(ROW + ' td:nth-child(2)').first().innerText()).split('\n')[0].trim();
  console.log('subject doc      :', firstDoc);
  console.log('subject uploader :', firstUploader);
  const terms = [firstDoc.slice(0, 12), firstDoc.slice(0, 12).toUpperCase(), firstUploader, '   ', 'zzz-no-such-doc', firstDoc.slice(3, 11)];
  for (const term of terms) {
    api.length = 0;
    await box.fill('');
    await settle(1800);
    await box.fill(term);
    await settle(2600);
    const req = listReqs().pop() || '(no request)';
    const m = /[?&]search=([^&]*)/.exec(req);
    const urlM = /[?&]search=([^&]*)/.exec(decodeURIComponent(page.url()));
    const rows = await page.locator(ROW).count();
    console.log('term=' + JSON.stringify(term).padEnd(24) + ' rows=' + String(rows).padEnd(3)
      + ' urlSearch=' + JSON.stringify(urlM ? urlM[1] : '(absent)')
      + ' apiSearch=' + (m ? JSON.stringify(m[1]) : '(NO REQUEST)'));
    if (rows === 0) console.log('   empty state:', JSON.stringify((await page.locator('main').innerText()).replace(/\s+/g, ' ').trim().split('Filters').pop().trim()));
  }

  console.log('\n=== 7. PAGINATION ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4000);
  const nav = page.locator('nav[aria-label*="Pagination" i]');
  console.log('nav count (scoping hazard):', await page.locator('nav').count());
  console.log('pager items:', J(await nav.locator('li,button').evaluateAll((es) => es.map((e) => ({ text: e.innerText.trim(), aria: e.getAttribute('aria-label'), disabled: e.disabled })))));
  api.length = 0;
  await nav.getByRole('button', { name: /next/i }).click();
  await settle(3500);
  console.log('after Next -> url:', rel(page.url()));
  console.log('           -> api:', short(listReqs().pop() || ''));
  console.log('           -> Previous disabled?', await nav.getByRole('button', { name: /previous/i }).isDisabled());
  api.length = 0;
  await page.locator('input[type="search"]').fill('a');
  await settle(3200);
  console.log('search from page 2 -> url:', rel(page.url()));
  console.log('                   -> api:', short(listReqs().pop() || ''));

  if (!SKIP_VIEWER) {
    console.log('\n=== 8. THE DOCUMENT VERIFICATION PANEL ===');
    for (const status of ['AWAITING', 'APPROVED', 'REVISION']) {
      await page.goto(origin + '/verifications?activeFilter=' + status, { waitUntil: 'domcontentloaded' });
      await settle(4000);
      if (!(await page.locator(ROW).count())) { console.log('\n--- ' + status + ': no rows to open ---'); continue; }
      const urlBefore = page.url();
      api.length = 0;
      const t0 = Date.now();
      await page.locator(ROW + ':first-child [data-testid="agent-verifications-view-button"]').click();
      const panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
      await panel.waitFor({ state: 'visible', timeout: 30000 });
      const panelAt = Date.now() - t0;
      await panel.locator('canvas.react-pdf__Page__canvas').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
      const renderedAt = Date.now() - t0;
      console.log('\n--- ' + status + ' ---');
      console.log('url changed?      :', page.url() !== urlBefore, '|', rel(page.url()));
      console.log('requests on open  :', J(api.filter((u) => !/notifications/.test(u)).map((u) => u.replace(/^.*api\/v1\//, ''))));
      console.log('panel visible (ms):', panelAt, '| first canvas (ms):', renderedAt);
      console.log('panel text        :', JSON.stringify(await panel.innerText()));
      console.log('buttons           :', J(await panel.locator('button').evaluateAll((bs) => bs.map((b) => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), disabled: b.disabled })))));
      console.log('react-pdf         :', J(await panel.evaluate((p) => ({
        documents: p.querySelectorAll('.react-pdf__Document').length,
        pages: p.querySelectorAll('.react-pdf__Page').length,
        canvases: p.querySelectorAll('canvas.react-pdf__Page__canvas').length,
        loading: p.querySelectorAll('.react-pdf__message--loading').length,
        error: p.querySelectorAll('.react-pdf__message--error').length,
      }))));
      console.log('decision controls :', J({
        requestRevision: await panel.locator('[data-testid="agent-request-revision-button"]').count(),
        approve: await panel.locator('[data-testid="agent-approve-button"]').count(),
      }));

      if (status === 'AWAITING') {
        console.log('\n   --- decision dialogs: OPENED AND CANCELLED, never submitted ---');
        for (const decision of ['revision', 'approve']) {
          const trigger = decision === 'approve' ? '[data-testid="agent-approve-button"]' : '[data-testid="agent-request-revision-button"]';
          await panel.locator(trigger).click();
          await settle(1300);
          const dd = page.locator('[role="dialog"]').last();
          console.log('   ' + decision + ' dialog text:', JSON.stringify(await dd.innerText()));
          console.log('   ' + decision + ' buttons    :', J(await dd.locator('button').evaluateAll((bs) => bs.map((b) => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), testid: b.getAttribute('data-testid'), disabled: b.disabled })))));
          const field = dd.locator('textarea, input[type="text"]').first();
          console.log('   ' + decision + ' field      :', J(await field.evaluate((f) => ({ tag: f.tagName, placeholder: f.placeholder, maxLength: f.maxLength, required: f.required })).catch(() => null)));
          const label = decision === 'approve' ? /^Approve Document$/i : /^Request Revision$/i;
          const submit = dd.locator('button').filter({ hasText: label }).first();
          for (const reason of [null, '   ', 'x', 'A genuine reason for this decision']) {
            if (reason !== null) { await field.fill(reason); await settle(700); }
            console.log('      reason=' + JSON.stringify(reason === null ? '(untouched)' : reason).padEnd(38)
              + ' submitDisabled=' + await submit.isDisabled().catch(() => 'n/a'));
          }
          await dd.locator('button').filter({ hasText: /^Cancel$/i }).first().click().catch(() => page.keyboard.press('Escape'));
          await settle(1300);
          console.log('   ' + decision + ' after Cancel -> dialogs on page:', await page.locator('[role="dialog"]').count());
        }
      }

      if (status === 'AWAITING' && !SKIP_ZOOM) {
        console.log('\n   --- zoom (every click re-renders EVERY canvas, so this is slow) ---');
        const zin = panel.getByRole('button', { name: 'Zoom in' });
        const zout = panel.getByRole('button', { name: 'Zoom out' });
        const lvl = async () => ((await panel.innerText()).match(/(\d+)%/) || [])[1];
        console.log('      initial:', await lvl());
        for (let i = 0; i < 5; i++) { const t = Date.now(); await zin.click(); await settle(600); console.log('      in  -> ' + await lvl() + '% (' + (Date.now() - t) + 'ms) disabled=' + await zin.isDisabled()); }
        for (let i = 0; i < 7; i++) { const t = Date.now(); await zout.click(); await settle(600); console.log('      out -> ' + await lvl() + '% (' + (Date.now() - t) + 'ms) disabled=' + await zout.isDisabled()); }
      }

      console.log('   close control:', J(await panel.getByRole('button', { name: /close/i }).evaluateAll((bs) => bs.map((b) => ({ aria: b.getAttribute('aria-label'), tabIndex: b.tabIndex })))));
      await panel.getByRole('button', { name: /close/i }).first().click().catch(() => page.keyboard.press('Escape'));
      await settle(1300);
      console.log('   after Close -> dialogs:', await page.locator('[role="dialog"]').count(), '| url:', rel(page.url()));

      await page.goto(origin + '/verifications?activeFilter=' + status, { waitUntil: 'domcontentloaded' });
      await settle(3000);
      if (await page.locator(ROW).count()) {
        await page.locator(ROW + ':first-child [data-testid="agent-verifications-view-button"]').click();
        await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await settle(1500);
        await page.keyboard.press('Escape');
        await settle(1300);
        console.log('   Escape closes the panel?', (await page.locator('[role="dialog"]').count()) === 0);
      }
    }
  }

  console.log('\n=== 9. EDGE: unrecognised / empty activeFilter ===');
  for (const q of ['', '?activeFilter=', '?activeFilter=NOT_A_REAL_STATUS', '?activeFilter=approved']) {
    api.length = 0;
    await page.goto(origin + '/verifications' + q, { waitUntil: 'domcontentloaded' });
    await settle(3500);
    const checked = await page.$$eval('[role="radio"]', (rs) => rs.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.innerText.trim()));
    console.log('supplied=' + JSON.stringify(q).padEnd(34) + ' url=' + (rel(page.url()) || '(bare)'));
    console.log(''.padEnd(43) + ' checkedTab=' + J(checked) + ' rows=' + await page.locator(ROW).count());
    console.log(''.padEnd(43) + ' api=' + short(listReqs().pop() || '(none)'));
  }

  console.log('\n=== 10. ACCESSIBILITY of the row actions ===');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4000);
  console.log(J(await page.$$eval(ROW + ' td:last-child button', (bs) => bs.slice(0, 4).map((b) => ({
    tag: b.tagName, aria: b.getAttribute('aria-label'), tabIndex: b.tabIndex, testid: b.getAttribute('data-testid'),
    svgAriaHidden: b.querySelector('svg') ? b.querySelector('svg').getAttribute('aria-hidden') : null,
  })))));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
