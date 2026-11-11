/* eslint-disable no-console */
// probe-reassign-candidates.js - READ-ONLY. The Reassign candidates feature on the SuperAdmin agent
// profile's Candidates tab, measured against its requirement. Reassign is never confirmed: every
// modal is cancelled.
//
//   A. the audit log: entries a reassignment left behind, and their Log Details drawer
//   B. the selection bar on a small agent: its count, its dismiss control, the modal wording for
//      one and for several candidates
//   C. an agent holding MORE than one page of candidates: the master checkbox, the
//      "Select all [N] candidates assigned to [Agent]" prompt, the all-pages bar and modal
//   D. the New Agent picker: which statuses and universities it offers
//
// Run:  node scripts/probe-reassign-candidates.js [--only A|B|C|D]
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL;
const ORIGIN = new URL(BASE).origin;
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') || '').toUpperCase();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const head = (t) => console.log(`\n================ ${t} ================`);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const log = [];
  page.on('response', async (r) => {
    if (!/\/api\/v1\//.test(r.url())) return;
    let j = null; try { j = await r.json(); } catch (_) { /* */ }
    log.push({ m: r.request().method(), u: r.url().replace(/^.*\/api\/v1/, ''), s: r.status(), j });
  });
  await page.goto(BASE);
  await page.locator('input[type="email"]').fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/agents|candidate/, { timeout: 90000 });

  if (!ONLY || ONLY === 'A') {
    head('A. audit log entries for a reassignment');
    for (const term of ['reassign', 'Reassign', 'promoexh']) {
      log.length = 0;
      await page.goto(`${ORIGIN}/audit-logs?search=${encodeURIComponent(term)}`); await page.waitForTimeout(6000);
      const hit = log.find((l) => /audit-logs\/\?/.test(l.u));
      console.log(`search "${term}" -> ${hit && hit.u} count ${hit && hit.j && hit.j.count}`);
      if (hit && hit.j && hit.j.results && hit.j.results.length) console.log('  first:', JSON.stringify(hit.j.results[0]).slice(0, 900));
    }
    // the filter modal's Entity / action options
    log.length = 0;
    await page.goto(`${ORIGIN}/audit-logs`); await page.waitForTimeout(6000);
    const all = log.find((l) => /audit-logs\/\?/.test(l.u));
    const types = [...new Set(((all && all.j && all.j.results) || []).map((r) => r.action_type || r.action))];
    console.log('action types on page 1:', JSON.stringify(types));
    await page.goto(`${ORIGIN}/audit-logs?search=reassign`); await page.waitForTimeout(6000);
    console.log('grid row 1:', JSON.stringify(await page.locator('[role="row"]:has([role="rowheader"])').first().locator('[role="gridcell"],[role="rowheader"]').allInnerTexts()));
    const view = page.getByRole('button', { name: /view log/i }).first();
    if (await view.count()) {
      await view.click(); await page.waitForTimeout(2500);
      const d = page.locator('[role="dialog"]').filter({ hasText: /log details/i }).first();
      console.log('drawer:', clean(await d.innerText()));
      await page.keyboard.press('Escape');
    }
  }

  async function openProfile(id) {
    log.length = 0;
    await page.goto(`${ORIGIN}/agents/view/${id}?tab=candidates`); await page.waitForTimeout(7000);
  }
  const boxes = () => page.getByRole('checkbox', { name: /^select candidate$/i });
  const barText = async () => clean(await page.locator('main').first().innerText()).match(/(\d+ of \d+ selected\.|All \d+ candidates[^.]*\.|Select all \d+ candidates[^.]*)/g);

  if (!ONLY || ONLY === 'B') {
    head('B. small agent (1220): bar, dismiss, modal wording');
    await openProfile(1220);
    await boxes().nth(0).click({ force: true }); await page.waitForTimeout(800);
    console.log('one:', JSON.stringify(await barText()));
    const bar = page.getByText(/selected\./).first().locator('xpath=ancestor::div[1]');
    console.log('bar html:', (await bar.evaluate((e) => e.parentElement.outerHTML)).slice(0, 900));
    console.log('bar buttons:', JSON.stringify(await page.locator('main button').evaluateAll((bs) => bs.map((b) => `${(b.innerText || '').trim()}|${b.getAttribute('aria-label')}`).filter((t) => /clear|reassign|close|dismiss/i.test(t)))));
    await page.getByRole('button', { name: /reassign candidates/i }).click(); await page.waitForTimeout(2500);
    console.log('modal one:', clean(await page.locator('[role="dialog"]').last().innerText()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    await boxes().nth(1).click({ force: true }); await page.waitForTimeout(800);
    console.log('two:', JSON.stringify(await barText()));
    await page.getByRole('button', { name: /reassign candidates/i }).click(); await page.waitForTimeout(2500);
    console.log('modal two:', clean(await page.locator('[role="dialog"]').last().innerText()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    await page.getByRole('checkbox', { name: /select all/i }).first().click({ force: true }); await page.waitForTimeout(800);
    console.log('all on page (agent has <= 10):', JSON.stringify(await barText()));
    await page.getByRole('button', { name: /reassign candidates/i }).click(); await page.waitForTimeout(2500);
    console.log('modal all-page:', clean(await page.locator('[role="dialog"]').last().innerText()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  }

  if (!ONLY || ONLY === 'C') {
    head('C. agent with more than one page of candidates');
    let big = null;
    for (const range of ['51-100', '100+', '1-50']) {
      log.length = 0;
      await page.goto(`${ORIGIN}/agents?candidateCount=${encodeURIComponent(range)}`); await page.waitForTimeout(5000);
      const l = log.find((x) => /\/agent\/\?/.test(x.u));
      big = ((l && l.j && l.j.results) || []).filter((a) => a.total_candidate_count > 10).sort((a, b) => b.total_candidate_count - a.total_candidate_count)[0];
      if (big) break;
    }
    if (!big) { console.log('NO agent with > 10 candidates on the first page of any bucket'); }
    else {
      console.log('agent:', big.id, big.email, big.first_name, big.last_name, 'total', big.total_candidate_count);
      await openProfile(big.id);
      const cand = log.filter((x) => /candidates\/\?page=1&page_size=10/.test(x.u)).pop();
      console.log('candidates count (all statuses):', cand && cand.j && cand.j.count, '| active count req:', JSON.stringify(log.filter((x) => /is_active=true/.test(x.u)).map((x) => x.j && x.j.count)));
      console.log('pager:', clean(await page.locator('main').first().innerText()).slice(-120));
      await page.getByRole('checkbox', { name: /select all/i }).first().click({ force: true }); await page.waitForTimeout(1200);
      console.log('select all on page:', JSON.stringify(await barText()));
      console.log('buttons now:', JSON.stringify(await page.locator('main button').evaluateAll((bs) => bs.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter((t) => /select|clear|reassign|close/i.test(t)))));
      const prompt = page.getByText(/^Select all \d+ candidates/).first();
      if (await prompt.count()) {
        log.length = 0;
        await prompt.click(); await page.waitForTimeout(2000);
        console.log('after prompt:', JSON.stringify(await barText()), 'reqs', JSON.stringify(log.filter((x) => x.m !== 'GET' || /candidates/.test(x.u)).map((x) => `${x.m} ${x.u}`)));
        await page.getByRole('button', { name: /reassign candidates/i }).click(); await page.waitForTimeout(2500);
        console.log('modal all:', clean(await page.locator('[role="dialog"]').last().innerText()));
        await page.keyboard.press('Escape'); await page.waitForTimeout(800);
        // deselect one row while "all" is selected
        await boxes().nth(0).click({ force: true }); await page.waitForTimeout(1000);
        console.log('after unticking one row from all:', JSON.stringify(await barText()));
        // page 2 keeps selection?
        await page.getByRole('checkbox', { name: /select all/i }).first().click({ force: true }); await page.waitForTimeout(800);
        console.log('re-tick page:', JSON.stringify(await barText()));
      } else console.log('no "Select all N" prompt shown');
      // selection survives paging?
      const next = page.getByRole('button', { name: /next page/i }).first();
      if (await next.count() && await next.isEnabled()) {
        await next.click(); await page.waitForTimeout(3000);
        console.log('page 2 bar:', JSON.stringify(await barText()), 'checked:', JSON.stringify(await boxes().evaluateAll((cs) => cs.map((c) => c.checked))));
      }
    }
  }

  if (!ONLY || ONLY === 'D') {
    head('D. New Agent picker scope');
    await openProfile(1220);
    await boxes().nth(0).click({ force: true });
    log.length = 0;
    await page.getByRole('button', { name: /reassign candidates/i }).click(); await page.waitForTimeout(3000);
    const req = log.find((x) => /\/agent\/\?.*university=/.test(x.u));
    console.log('picker request:', req && req.u, 'count', req && req.j && req.j.count);
    console.log('statuses returned:', JSON.stringify([...new Set(((req && req.j && req.j.results) || []).map((a) => a.status))]), 'universities:', JSON.stringify([...new Set(((req && req.j && req.j.results) || []).map((a) => a.institution_name))]));
    // a deactivated KSU agent by name must not be offered
    const cb = page.locator('[role="dialog"] input[role="combobox"]').first();
    for (const term of ['Lifecycle', 'Zayd']) {
      log.length = 0; await cb.fill(''); await cb.pressSequentially(term, { delay: 40 }); await page.waitForTimeout(3000);
      const r = log.find((x) => /search=/.test(x.u));
      console.log(`"${term}" -> ${r && r.u} count ${r && r.j && r.j.count} statuses ${JSON.stringify([...new Set(((r && r.j && r.j.results) || []).map((a) => a.status))])} options ${JSON.stringify((await page.getByRole('option').allInnerTexts()).slice(0, 4))}`);
    }
    // the X on the modal
    console.log('modal buttons:', JSON.stringify(await page.locator('[role="dialog"]').last().locator('button').evaluateAll((bs) => bs.map((b) => `${(b.innerText || '').trim()}|${b.getAttribute('aria-label')}|${b.getAttribute('data-testid')}`))));
    await page.keyboard.press('Escape');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
