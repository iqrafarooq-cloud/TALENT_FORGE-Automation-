/* eslint-disable no-console */
// probe-superadmin-candidate-drawer.js - READ-ONLY. The SuperAdmin Candidates listing's View
// drawer, tab by tab, beside the payload behind each tab - plus the Documents tab's row actions
// (View opens the viewer, Download delivers a file) and the listing pager. Every dialog is closed;
// any decision control in the viewer is only LISTED, never clicked.
//
// Run:  node scripts/probe-superadmin-candidate-drawer.js [--only A|B|C|D]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const ORIGIN = new URL(BASE).origin;
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toUpperCase();
const head = (t) => console.log(`\n================ ${t} ================`);
const short = (o, n = 900) => String(JSON.stringify(o)).slice(0, n);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const log = [];
  let token = null;
  page.on('request', (r) => { const a = r.headers().authorization; if (a && /\/api\/v1\//.test(r.url())) token = a; });
  page.on('response', async (r) => {
    if (!/\/api\/v1\//.test(r.url()) || /notifications|auth\/me/.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* */ }
    log.push({ m: r.request().method(), path: r.url().replace(/^.*\/api\/v1/, ''), status: r.status(), body });
  });
  const api = async (p) => page.evaluate(async ([u, t]) => { const r = await fetch(u, { headers: { authorization: t } }); return { status: r.status, body: await r.json().catch(() => null) }; },
    [`https://dev-api.talentforge.com.sa/core/api/v1${p}`, token]);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|candidates)/, { timeout: 90000 });
  await page.goto(`${ORIGIN}/candidates`);
  await page.waitForTimeout(6000);

  // ---- choose subjects from live data
  const subs = (await api('/candidate/?page=1&page_size=50&subscription_status=subscribed')).body.results || [];
  const withDocs = [];
  const pool = [...((await api('/candidate/?page=1&page_size=20&pending_documents=1-2')).body.results || []), ...((await api('/candidate/?page=1&page_size=20&pending_documents=3%2B')).body.results || [])];
  console.log('pending-doc candidates:', pool.length);
  for (const c of pool) {
    const p = await api(`/candidate/profile/${c.id}/`);
    const b = p.body || {};
    const docs = ['education', 'work_experience', 'certifications'].flatMap((k) => (b[k] || []).map((e) => e.document).filter(Boolean));
    if (docs.length >= 1) withDocs.push({ c, docs, keys: Object.keys(b) });
    if (withDocs.length >= 2) break;
  }
  console.log('subscribed candidates:', subs.slice(0, 3).map((c) => `${c.id} ${c.email}`));
  console.log('candidates with >=2 documents:', withDocs.map((x) => `${x.c.id} ${x.c.email} docs=${x.docs.length}`));
  if (withDocs[0]) console.log('profile keys:', withDocs[0].keys, '\nfirst document:', short(withDocs[0].docs[0], 1200));

  const openDrawer = async (email) => {
    const box = page.locator('main input[type="search"], main input[placeholder*="Search" i]').first();
    await box.fill(email);
    await page.waitForTimeout(3500);
    const row = page.locator('main [role="row"]').filter({ hasText: email }).first();
    log.length = 0;
    await row.getByRole('button', { name: 'View', exact: true }).click();
    await page.waitForTimeout(4000);
  };
  const panelText = () => page.evaluate(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /candidate details/i.test(x.innerText)); return d ? d.innerText.replace(/\n+/g, ' | ') : null; });
  const openTab = async (name) => { log.length = 0; await page.locator('[role="dialog"] [role="radio"]').filter({ hasText: name }).first().click(); await page.waitForTimeout(3500); };

  if (!ONLY || ONLY === 'A') {
    head('A. Documents tab: rows, actions, viewer, download');
    const subj = withDocs[0];
    await openDrawer(subj.c.email);
    await openTab('Documents');
    console.log('panel:', (await panelText()).slice(0, 1500));
    console.log('requests:', log.map((l) => `${l.status} ${l.path}`));
    const rows = await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /candidate details/i.test(x.innerText));
      return Array.from(d.querySelectorAll('[class*="document-list-item"], li')).slice(0, 8).map((r) => ({
        cls: r.className.slice(0, 80), text: (r.innerText || '').replace(/\s+/g, ' ').trim(),
        controls: Array.from(r.querySelectorAll('button, a, svg')).map((e) => `${e.tagName.toLowerCase()} label=${e.getAttribute('aria-label')} testid=${e.getAttribute('data-testid')} role=${e.getAttribute('role')} tabindex=${e.getAttribute('tabindex')} href=${e.getAttribute('href') ? 'yes' : ''} cls=${String(e.getAttribute('class') || '').slice(0, 40)}`),
      }));
    });
    console.log('rows:', JSON.stringify(rows, null, 1).slice(0, 5000));
    // try a "View" control: button named View, else first svg in the row's action area
    const dlg = page.locator('[role="dialog"]').filter({ hasText: /candidate details/i }).first();
    for (const target of ['name', 'view', 'download']) {
      log.length = 0;
      const row = dlg.locator('.document-list-item').last();
      const el = target === 'name' ? row.locator('button').first()
        : row.locator(`[data-testid="candidate-profile-document-${target}-button"]`).first();
      const dl = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
      const popup = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
      await el.click().catch((e) => console.log(target, 'click failed', e.message.split(String.fromCharCode(10))[0]));
      await page.waitForTimeout(5000);
      const d = await dl;
      const pop = await popup;
      const dialogs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map((x) => ({
        text: (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900),
        buttons: Array.from(x.querySelectorAll('button')).map((b) => `${b.getAttribute('aria-label') || b.innerText.trim()}${b.disabled ? '(dis)' : ''}${b.getAttribute('data-testid') ? '#' + b.getAttribute('data-testid') : ''}`),
        pdfPages: x.querySelectorAll('.react-pdf__Page').length, imgs: Array.from(x.querySelectorAll('img')).map((i) => (i.getAttribute('src') || '').slice(0, 60)),
      })));
      console.log(`-- ${target}: dialogs=${dialogs.length} popup=${pop ? pop.url().slice(0, 90) : 'none'} download=${d ? d.suggestedFilename() : 'none'}`);
      if (dialogs.length > 1) console.log('   viewer:', JSON.stringify(dialogs[dialogs.length - 1], null, 1));
      console.log('   requests:', log.map((l) => `${l.m} ${l.status} ${l.path}`));
      if (d) { const f = path.join(require('os').tmpdir(), d.suggestedFilename()); await d.saveAs(f); console.log('   file', fs.statSync(f).size, 'bytes, magic', fs.readFileSync(f).subarray(0, 8).toString('hex')); }
      if (pop) await pop.close();
      if (dialogs.length > 1) {
        const v = page.locator('[role="dialog"]').last();
        const vdl = v.getByRole('button', { name: /download/i }).first();
        if (target === 'view' && await vdl.count()) {
          const d2p = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
          await vdl.click(); const d2 = await d2p;
          console.log('   viewer Download ->', d2 ? d2.suggestedFilename() : 'none', 'viewer still open:', await v.isVisible());
          for (const z of ['Zoom in', 'Zoom out']) { const zb = v.getByRole('button', { name: z }); if (await zb.count()) { await zb.click(); await page.waitForTimeout(1500); console.log('   after', z, (await v.innerText()).match(/\d+%/g)); } }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        console.log('   after Escape dialogs:', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length));
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    console.log('dialogs after Escape:', await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.innerText.slice(0, 60))));
    // row-level download, if any
    const rowDl = dlg.getByRole('button', { name: /download/i }).first();
    console.log('row-level download button count:', await rowDl.count());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  if (!ONLY || ONLY === 'B') {
    head('B. every tab beside its payload (a subscribed candidate)');
    const s = subs[0] || withDocs[0].c;
    await openDrawer(s.email);
    console.log('header+kpis+details:', (await panelText()).slice(0, 1600));
    console.log('requests:', log.map((l) => `${l.status} ${l.path} ${short(l.body, 500)}`));
    for (const t of ['Track Progress', 'Documents', 'Subscription', 'Activity Log', 'Candidate Details']) {
      await openTab(t);
      console.log(`-- ${t}:`, (await panelText()).replace(/^.*?Activity Log \|/, '').slice(0, 900));
      console.log('   requests:', log.map((l) => `${l.status} ${l.path} ${short(l.body, 700)}`));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  if (!ONLY || ONLY === 'C') {
    head('C. a candidate WITH a track');
    const scan = []; for (let pg = 1; pg <= 6; pg += 1) scan.push(...(((await api(`/candidate/?page=${pg}&page_size=100&subscription_status=subscribed`)).body || {}).results || []));
    console.log('scanning', scan.length, 'subscribed candidates for a track');
    for (const c of scan) {
      const t = await api(`/tracks/candidate/${c.id}/`);
      if (t.status === 200) {
        console.log('candidate with track:', c.id, c.email, short(t.body, 1500));
        await openDrawer(c.email);
        await openTab('Track Progress');
        console.log('tab:', (await panelText()).replace(/^.*?Activity Log \|/, '').slice(0, 1500));
        await page.keyboard.press('Escape');
        break;
      }
    }
  }

  if (!ONLY || ONLY === 'D') {
    head('D. Candidates listing pager + Activity Log duration on the drawer');
    log.length = 0;
    await page.goto(`${ORIGIN}/candidates`);
    await page.waitForTimeout(6000);
    const pager = async () => page.evaluate(() => { const nav = Array.from(document.querySelectorAll('main nav')).find((n) => /pagination/i.test(n.getAttribute('aria-label') || '')); return nav ? nav.innerText.replace(/\s+/g, ' ') : null; });
    console.log('url', page.url().replace(ORIGIN, ''), 'pager', await pager(), 'req', log.filter((l) => /\/candidate\/\?/.test(l.path)).map((l) => `${l.path} count=${l.body && l.body.count}`));
    for (const q of ['?page=2', '?page=5', '?accountTab=deactivated&page=2', '?page=99999']) {
      log.length = 0;
      await page.goto(`${ORIGIN}/candidates${q}`);
      await page.waitForTimeout(5000);
      console.log(q, '->', page.url().replace(ORIGIN, ''), 'pager', await pager(), 'req', log.filter((l) => /\/candidate\/\?/.test(l.path)).map((l) => `${l.status} ${l.path}`), '| main tail:', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(-120));
    }
    const h0 = await page.evaluate(() => history.length);
    await page.goto(`${ORIGIN}/candidates`);
    await page.waitForTimeout(5000);
    const h1 = await page.evaluate(() => history.length);
    await page.locator('main button[aria-label="Next Page"]:visible').first().click();
    await page.waitForTimeout(3000);
    await page.locator('main button[aria-label="Next Page"]:visible').first().click();
    await page.waitForTimeout(3000);
    console.log('history', h0, h1, await page.evaluate(() => history.length), page.url().replace(ORIGIN, ''));
    await page.locator('main input[type="search"], main input[placeholder*="Search" i]').first().fill('a');
    await page.waitForTimeout(3500);
    console.log('search from page 3 ->', page.url().replace(ORIGIN, ''));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
