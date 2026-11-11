// probe-audit-logs.js — the read-only map of SuperAdmin Portal > Audit Logs.
//
// >>> IT IS READ-ONLY AND SPENDS NOTHING. <<< An audit log has no create, edit or delete
// anywhere in the module; the only row action opens a dialog, which this closes again; and both
// exports are GETs whose files land in an OS temp directory, never in the repo. Run it as often
// as you like.
//
//   node scripts/probe-audit-logs.js
//
// EVERY string, URL param, API param and column name in pages/AuditLogsPage.js and in
// features/SuperAdmin_Portal/Audit-Logs.feature came from this. **Re-run it rather than
// reasoning about the DOM** — that is the rule this repo has paid for repeatedly, and twice in
// this module alone the DOM was not what it looked like (see sections 3 and 6).
//
// Sections:
//   1  page structure — controls, columns, row shape, test-id inventory
//   2  the filter modal — every option with its control type and whether it has a test id
//   3  filter wire params — URL vs API, per option, applied one at a time
//   4  search — which fields match, which visibly do not, and the edge cases
//   5  empty states — all three, verbatim, with their CTA
//   6  export — the menu, both files, their columns, and grid-vs-export field by field
//   7  the View log dialog — its fields, and what it omits
//   8  pagination

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const AuditLogsPage = require('../pages/AuditLogsPage');
const { readExport, asObjects } = require('../utils/spreadsheet');

const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;
const BASE = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');

const line = (s = '') => console.log(s);
const head = (n, t) => {
  line();
  line('='.repeat(90));
  line(`  ${n}. ${t}`);
  line('='.repeat(90));
};

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();
  const audit = new AuditLogsPage(page);
  audit.install();

  try {
    // ---- sign in ---------------------------------------------------------------------------
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], [data-testid="login-email-input"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.getByRole('button', { name: /^Log in$/i }).first().click();
    await page.waitForURL(/analytics|agents|candidate/, { timeout: 90000, waitUntil: 'commit' });

    await audit.navigate();

    // ==========================================================================================
    head(1, 'PAGE STRUCTURE');
    line(`url                ${page.url()}`);
    line(`columns            ${JSON.stringify(await audit.columnHeaders())}`);
    line(`rows rendered      ${await audit.rowCount()}`);
    line(`page_size asked    ${audit.requestedPageSize()}`);
    line(`list request       ${audit.lastRequestQuery()}`);
    line(`pagination shown   ${await audit.pagination.isVisible().catch(() => false)}`);

    // >>> THE PAGE ITSELF CARRIES NO data-testid AT ALL. <<< Printed as a count rather than
    // assumed, because "there is no test id" is exactly the sort of claim that quietly stops
    // being true and leaves every locator here more fragile than it needs to be.
    const testIds = await page.locator('main [data-testid]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid'))
    );
    line(`test ids in <main> ${testIds.length} ${JSON.stringify(testIds)}`);

    const firstRow = (await audit.readRows())[0];
    line(`first row          ${JSON.stringify(firstRow, null, 2)}`);

    // The row's interactive controls and whether a keyboard can reach them.
    const rowControls = await page.evaluate(() => {
      const r = document.querySelector('[role="row"]:has([role="rowheader"])');
      if (!r) return [];
      return [...r.querySelectorAll('button')].map((b) => ({
        label: (b.innerText || '').trim() || b.getAttribute('aria-label') || '(unnamed)',
        tabIndex: b.tabIndex,
        column: b.closest('[data-column-index]')?.getAttribute('data-column-index') ?? null,
      }));
    });
    line('row controls (tabIndex -1 means no keyboard user can reach it):');
    rowControls.forEach((c) => line(`   col ${String(c.column).padEnd(3)} tabIndex ${String(c.tabIndex).padEnd(3)} ${c.label}`));

    // ==========================================================================================
    head(2, 'FILTER MODAL');
    await audit.openFilters();
    const options = await audit.readFilterOptions();
    line('  idx  group          control   testid  label');
    options.forEach((o) =>
      line(
        `  ${String(o.index).padEnd(4)} ${String(o.group).padEnd(14)} ${String(o.control).padEnd(9)} `
        + `${(o.hasTestId ? 'yes' : 'NO ').padEnd(7)} ${o.text}`
      )
    );
    // The point of printing this: only the checkboxes carry a test id, so a testid-only reader
    // sees half the modal and any assertion counting options passes having inspected four.
    line(`  -> ${options.filter((o) => o.hasTestId).length} of ${options.length} options carry a data-testid`);
    await audit.closeFilters();

    // ==========================================================================================
    head(3, 'FILTER WIRE PARAMS (applied one at a time)');
    line('  option            url                       api');
    for (const group of AuditLogsPage.FILTER_GROUPS) {
      for (const label of group.options) {
        await audit.navigate();
        await audit.openFilters();
        await audit.selectFilterOption(label);
        const before = audit.requestCount();
        await audit.applyFilters();
        const sent = audit.requestsSince(before);
        const url = decodeURIComponent(page.url()).split('?')[1] || '(none)';
        const api = (sent.find((q) => /entity=|last_activity=/.test(q)) || '(none)').replace(/^\?/, '');
        line(`  ${label.padEnd(17)} ${url.padEnd(25)} ${api}`);
      }
    }

    // ==========================================================================================
    head(4, 'SEARCH');
    await audit.navigate();
    const sample = await audit.readRows();
    const terms = [
      ['Action By (name)', sample[0].actionBy],
      ['Action By (email)', sample[0].actionByEmail],
      ['Action Type', sample[0].actionType],
      ['Entity Name', sample.find((r) => r.entityName)?.entityName],
      ['IP Address', sample[0].ipAddress],
      ['Location', sample[0].location.split(',')[0]],
      ['Endpoint (NOT scoped)', sample[0].endpoint],
      ['Event Details (NOT scoped)', (sample[0].eventDetails || '').split(/[,;]/)[0]],
      ['nonsense', 'zzzzqqqnope12345'],
      ['uppercase', (sample[0].location.split(',')[0] || '').toUpperCase()],
      ['whitespace only', '   '],
      ['sql-ish', "' OR 1=1 --"],
      ['xss-ish', '<script>alert(1)</script>'],
    ];
    line('  what                        term                          rows  request sent');
    for (const [what, term] of terms) {
      if (!term) { line(`  ${what.padEnd(27)} (no sample value in the grid)`); continue; }
      const before = audit.requestCount();
      await audit.search(term);
      const rows = await audit.rowCount();
      const fired = audit.requestCount() - before;
      line(
        `  ${what.padEnd(27)} ${String(term).slice(0, 28).padEnd(29)} ${String(rows).padEnd(5)} `
        + `${fired ? audit.lastRequestQuery() : 'NONE — the app declined to send it'}`
      );
    }

    // ==========================================================================================
    head(5, 'EMPTY STATES (all three, verbatim)');
    // search only
    await audit.navigate();
    await audit.search('zzzzqqqnope12345');
    line(`  search only   ${JSON.stringify(await audit.readEmptyState(), null, 2)}`);

    // filters only — found by trying, not guessed: whichever entity has nothing in 24h.
    let filterEmpty = null;
    for (const entity of ['Community', 'Candidate', 'Configuration', 'Agent']) {
      await audit.navigate();
      await audit.openFilters();
      await audit.selectFilterOption(entity);
      await audit.selectFilterOption('Last 24 hours');
      await audit.applyFilters();
      if ((await audit.rowCount()) === 0) {
        filterEmpty = { entity, state: await audit.readEmptyState() };
        break;
      }
    }
    line(`  filters only  ${JSON.stringify(filterEmpty, null, 2)}`);

    // search + filter
    await audit.navigate();
    const named = sample.find((r) => r.entityName && r.entity !== 'Agent');
    if (named) {
      await audit.search(named.entityName);
      await audit.openFilters();
      await audit.selectFilterOption('Agent');
      await audit.applyFilters();
      line(`  both          ${JSON.stringify(await audit.readEmptyState(), null, 2)}`);
      // What the CTA actually clears — it says "filters" and clears the search too.
      if (await audit.clearAllFiltersCta().isVisible().catch(() => false)) {
        await audit.clearAllFiltersCta().click();
        await audit.settleRows();
        line(`  after Clear CTA -> url=${page.url()} search=${JSON.stringify(await audit.searchValue())} `
          + `badge=${await audit.appliedFilterCount()}`);
      }
    }

    // ==========================================================================================
    head(6, 'EXPORT');
    await audit.navigate();
    await audit.openExportMenu();
    line(`  menu offers   ${JSON.stringify(await audit.readExportOptions())}`);
    await audit.closeExportMenu();

    const rowsAtExport = await audit.readRows();
    const files = {};
    for (const format of ['CSV', 'Excel (.xlsx)']) {
      const r = await audit.exportAs(format);
      const parsed = readExport(r.filePath);
      files[format] = { ...r, parsed };
      line(`  ${format.padEnd(14)} file=${r.suggestedFilename} bytes=${r.bytes} cols=${parsed.header.length} rows=${parsed.rows.length}`);
      line(`  ${''.padEnd(14)} asked: ${r.requestQuery}`);
    }
    line(`  columns       ${JSON.stringify(files.CSV.parsed.header)}`);
    line(`  grid has      ${JSON.stringify(AuditLogsPage.COLUMNS)}`);
    const extra = files.CSV.parsed.header.filter((c) => !AuditLogsPage.COLUMNS.includes(c));
    line(`  EXPORT-ONLY   ${JSON.stringify(extra)}`);
    line(`  csv/xlsx same header: ${JSON.stringify(files.CSV.parsed.header) === JSON.stringify(files['Excel (.xlsx)'].parsed.header)}`);
    line(`  csv/xlsx same rows:   ${files.CSV.parsed.rows.length === files['Excel (.xlsx)'].parsed.rows.length}`);

    // >>> THE COMPARISON THAT MATTERS: the same log, on screen and in the file. <<<
    const e0 = asObjects(files.CSV.parsed)[0];
    const g0 = rowsAtExport[0];
    line('');
    line('  GRID vs EXPORT, field by field (row 1):');
    const cmp = [
      ['Date & Time', g0.dateTime, e0['Date & Time']],
      ['Action By', g0.actionBy, e0['Action By']],
      ['Action By Email', g0.actionByEmail, e0['Action By Email']],
      ['Action Type', g0.actionType, e0['Action Type']],
      ['Entity', g0.entity, e0.Entity],
      ['Entity Name', g0.entityName, e0['Entity Name']],
      ['Endpoint', g0.endpoint, e0.Endpoint],
      ['IP Address', g0.ipAddress, e0['IP Address']],
      ['Location', g0.location, e0.Location],
    ];
    cmp.forEach(([f, a, b]) => {
      const same = String(a).trim() === String(b || '').trim();
      line(`   ${same ? ' ' : '!'} ${f.padEnd(16)} screen=${JSON.stringify(a)}  export=${JSON.stringify(b)}`);
    });
    line(`     Actor Name duplicates Action By: ${e0['Actor Name'] === e0['Action By']}`);

    // Clean up the temp files this probe downloaded.
    Object.values(files).forEach((f) => {
      try { fs.rmSync(path.dirname(f.filePath), { recursive: true, force: true }); } catch (err) { /* best effort */ }
    });

    // ==========================================================================================
    head(7, 'VIEW LOG DIALOG');
    await audit.navigate();
    const noted = (await audit.readRows())[0];
    const urlBefore = page.url();
    const reqBefore = audit.requestCount();
    await audit.openLogDetails(0);
    const details = await audit.readLogDetails();
    line(`  title          ${JSON.stringify(details.title)}`);
    line(`  sections       ${JSON.stringify(details.sections)}`);
    line(`  fields         ${JSON.stringify(details.fields, null, 2)}`);
    line(`  url changed    ${page.url() !== urlBefore}`);
    line(`  requests fired ${audit.requestCount() - reqBefore}`);
    const shown = Object.keys(details.fields || {});
    line(`  grid columns the dialog OMITS: `
      + JSON.stringify(AuditLogsPage.COLUMNS.filter((c) => c !== 'Actions' && !shown.includes(c))));
    line(`  describes the clicked row: ${details.fields['Action Type'] === noted.actionType}`);
    await audit.closeLogDetails();
    line(`  closes on Escape: ${!(await audit.logDetailsDialog.isVisible().catch(() => false))}`);

    // ==========================================================================================
    head(8, 'PAGINATION');
    await audit.navigate();
    const page1 = (await audit.readRows())[0];
    await audit.goToNextPage();
    line(`  url after Next      ${page.url()}`);
    line(`  request after Next  ${audit.lastRequestQuery()}`);
    const page2 = (await audit.readRows())[0];
    line(`  rows differ         ${page1.dateTime !== page2.dateTime || page1.actionType !== page2.actionType}`);
    await audit.search('Community Created');
    line(`  search from page 2  url=${page.url()}`);
    line(`  request             ${audit.lastRequestQuery()}`);

    line();
    line('Done. Nothing was created, changed or deleted.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nPROBE FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
