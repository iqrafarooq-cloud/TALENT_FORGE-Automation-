// probe-agent-filter-truth.js — does the Agents listing REALLY filter, or did the first
// probe read stale rows?
//
//   node scripts/probe-agent-filter-truth.js
//
// WHY THIS EXISTS. probe-agent-management.js reported the identical 10 rows for all eight
// filter options, which reads as "the backend ignores target_progress and candidate_count".
// But its read was timed on "a row holding an email exists", and the PREVIOUS page's rows
// satisfy that the instant Apply is clicked — so the same unfiltered page could have been
// read eight times. That is a reader bug, not an app bug, and the two are indistinguishable
// from the output.
//
// This probe removes the ambiguity by never trusting the DOM for the verdict: it waits for
// the filtered response, parses THAT, and reports the server's own numbers beside the
// rendered ones. The server's answer is what decides whether the filter works; the DOM
// comparison only says whether the page rendered what it was given.
//
// READ-ONLY. Mutates nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const ORIGIN = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
const line = (t) => console.log(`\n${'='.repeat(16)} ${t} ${'='.repeat(16)}`);

// option label -> [testid slug, URL param value, predicate the returned agents must satisfy]
const CASES = [
  ['Target Progress', '1% - 25%', 'targetProgress', '1-25', (a) => pct(a) >= 1 && pct(a) <= 25],
  ['Target Progress', '26% - 50%', 'targetProgress', '26-50', (a) => pct(a) >= 26 && pct(a) <= 50],
  ['Target Progress', '51% - 75%', 'targetProgress', '51-75', (a) => pct(a) >= 51 && pct(a) <= 75],
  ['Target Progress', '76% - 100%', 'targetProgress', '76-100', (a) => pct(a) >= 76 && pct(a) <= 100],
  ['Candidate Count', '0', 'candidateCount', '0', (a) => cnt(a) === 0],
  ['Candidate Count', '1-50', 'candidateCount', '1-50', (a) => cnt(a) >= 1 && cnt(a) <= 50],
  ['Candidate Count', '51-100', 'candidateCount', '51-100', (a) => cnt(a) >= 51 && cnt(a) <= 100],
  ['Candidate Count', '100+', 'candidateCount', '100+', (a) => cnt(a) > 100],
];
const pct = (a) => Number((a.monthly_progress || {}).percentage ?? -1);
const cnt = (a) => Number(a.total_candidate_count ?? -1);
const slugFor = (option) => option.replace(/\s|%/g, '');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management|\/analytics/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const readRendered = () => page.evaluate(() => {
    const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]') && /@/.test(r.innerText || ''))
      .map((r) => {
        const cells = Array.from(r.querySelectorAll('[role="gridcell"]')).map((x) => c(x.innerText));
        const h = r.querySelector('[role="rowheader"]');
        const paras = h ? Array.from(h.querySelectorAll('p')).map((p) => c(p.innerText)) : [];
        return { email: paras.find((p) => p.includes('@')) || '', candidates: cells[2], progress: cells[3] };
      });
  });

  line('BASELINE — no filter');
  const basePromise = page.waitForResponse((r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET');
  await page.goto(`${ORIGIN}/agents`);
  const baseBody = await (await basePromise).json();
  await page.waitForTimeout(2500);
  console.log(`  server count=${baseBody.count} returned=${baseBody.results.length}`);
  console.log('  server rows :', baseBody.results.map((a) => `${a.email} cand=${cnt(a)} pct=${pct(a)}`).join('\n                '));
  console.log('  rendered    :', JSON.stringify(await readRendered()));

  for (const [group, option, urlParam, urlValue, predicate] of CASES) {
    line(`FILTER ${group} = "${option}"`);
    // Drive it through the URL, which is exactly what Apply Filters produces (verified in
    // probe-agent-management.js). Doing it this way means the response is unambiguously the
    // filtered one — there is no prior page whose rows could be mistaken for it.
    const respPromise = page.waitForResponse(
      (r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 30000 },
    );
    await page.goto(`${ORIGIN}/agents?${urlParam}=${encodeURIComponent(urlValue)}`);
    let body;
    let sentUrl = '(no request)';
    try {
      const resp = await respPromise;
      sentUrl = resp.url();
      body = await resp.json();
    } catch (e) {
      console.log('  no list request seen:', e.message);
      continue;
    }
    await page.waitForTimeout(2800);

    const agents = body.results || [];
    const violating = agents.filter((a) => !predicate(a));
    console.log(`  request sent : ${sentUrl}`);
    console.log(`  param reached the API: ${/target_progress|candidate_count/.test(sentUrl) ? 'YES' : 'NO'}`);
    console.log(`  server count=${body.count} returned=${agents.length}`);
    console.log(`  agents the SERVER returned that do NOT satisfy "${option}": ${violating.length} of ${agents.length}`);
    violating.slice(0, 6).forEach((a) => console.log(`    - ${a.email} candidates=${cnt(a)} progress=${pct(a)}%`));
    const rendered = await readRendered();
    console.log(`  rendered rows: ${rendered.length}  ${JSON.stringify(rendered.slice(0, 4))}`);
    // Does the DOM agree with the payload it was handed? A mismatch here would mean the
    // rendering is stale, which is a different defect from the server ignoring the filter.
    const serverEmails = agents.map((a) => a.email).sort().join(',');
    const domEmails = rendered.map((r) => r.email).sort().join(',');
    console.log(`  DOM matches payload: ${serverEmails === domEmails ? 'yes' : `NO\n    server=${serverEmails}\n    dom   =${domEmails}`}`);
    console.log(`  VERDICT: ${violating.length === 0
      ? 'filter honoured'
      : `SERVER IGNORED THE FILTER (${violating.length}/${agents.length} rows violate it)`}`);
  }

  // A filter that is honoured must also be able to return FEWER than a full page. If every
  // option returns exactly page_size rows with the same total, that alone is suspicious.
  line('TOTALS PER OPTION (a working filter should move `count`)');
  for (const [, option, urlParam, urlValue] of CASES) {
    const p = page.waitForResponse((r) => /\/api\/v1\/agent\/\?/.test(r.url()) && r.request().method() === 'GET', { timeout: 30000 });
    await page.goto(`${ORIGIN}/agents?${urlParam}=${encodeURIComponent(urlValue)}`);
    try {
      const b = await (await p).json();
      console.log(`  ${String(option).padEnd(12)} -> count=${b.count}`);
    } catch { console.log(`  ${String(option).padEnd(12)} -> no response`); }
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
