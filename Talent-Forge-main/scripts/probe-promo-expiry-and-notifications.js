// probe-promo-expiry-and-notifications.js — find out what the two @not-automatable buckets
// in features/Promo_Code/Promo-Code-Lifecycle.feature actually need.
//
//   node scripts/probe-promo-expiry-and-notifications.js
//
// Answers three questions, all against the LIMITED promo agent:
//   [SAVE]    which request does "Save Changes" in Promo Tools > Edit Code Parameters fire,
//             and what does its payload look like?
//   [PAST]    the modal silently disables Save for an expiry date before today. Does the
//             API itself accept a past date when called directly with the superadmin's
//             session? If it does, "its expiry date passes" is automatable for real
//             instead of being living spec.
//   [NOTIF]   is there an in-app notification centre (header bell), what does it call, and
//             what does it render — for BOTH the superadmin and the agent?
//
// Read-only apart from [SAVE]/[PAST], which change the promo's expiry date and then put the
// original value back.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const AGENT_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.PROMO_LIMITED_AGENT_PASSWORD;
const AGENT_NAME = process.env.PROMO_LIMITED_AGENT_NAME;

const isApi = (url) =>
  /\/api\/|\/v\d\//i.test(url) && !/\.(js|css|png|jpe?g|svg|woff2?|ico|map)(\?|$)/i.test(url);

function watch(page, sink) {
  page.on('request', (req) => {
    if (!isApi(req.url())) return;
    if (req.method() === 'GET') return;
    sink.push({ kind: 'req', method: req.method(), url: req.url(), post: req.postData() });
  });
  page.on('response', async (res) => {
    if (!isApi(res.url())) return;
    if (!/json/i.test(res.headers()['content-type'] || '')) return;
    let body = '';
    try { body = JSON.stringify(await res.json()); } catch { return; }
    sink.push({ kind: 'res', method: res.request().method(), status: res.status(), url: res.url(), body });
  });
}

function dump(sink, tag, { getOnly = false } = {}) {
  console.log(`\n=============== ${tag} ===============`);
  for (const e of sink) {
    if (e.kind === 'req') console.log(`  -> ${e.method} ${e.url}\n     ${String(e.post || '').slice(0, 600)}`);
    else if (getOnly || e.method !== 'GET') console.log(`  <- ${e.status} ${e.method} ${e.url}\n     ${e.body.slice(0, 900)}`);
  }
  sink.length = 0;
}

async function login(browser, email, password, urlRe) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(urlRe, { timeout: 90000, waitUntil: 'commit' });
  return { context, page };
}

// Everything the header bell could be, most stable first.
const BELL = 'header button[aria-label*="notification" i], button[aria-label*="notification" i],'
  + ' header button[aria-haspopup][aria-label], [data-testid*="notification" i]';

async function probeNotifications(page, tag) {
  const sink = [];
  page.on('response', async (res) => {
    if (!/notification/i.test(res.url())) return;
    let body = '';
    try { body = JSON.stringify(await res.json()); } catch { return; }
    sink.push({ status: res.status(), url: res.url(), body });
  });

  const bell = page.locator(BELL).first();
  const present = await bell.isVisible().catch(() => false);
  console.log(`\n=============== NOTIF (${tag}) ===============`);
  console.log(`  bell visible: ${present}`);
  if (!present) {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('header button, nav button')]
        .map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 30))
        .filter(Boolean));
    console.log(`  header buttons: ${JSON.stringify(labels)}`);
    return;
  }
  await bell.click();
  await page.waitForTimeout(3000);
  const panel = await page.evaluate(() => {
    const pick = document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]');
    return pick ? (pick.innerText || '').slice(0, 1500) : null;
  });
  console.log(`  panel text:\n${panel ? panel.split('\n').map((l) => `    ${l}`).join('\n') : '    (no panel found)'}`);
  for (const e of sink) console.log(`  <- ${e.status} ${e.url}\n     ${e.body.slice(0, 1200)}`);
  await page.keyboard.press('Escape').catch(() => {});
}

(async () => {
  for (const [k, v] of Object.entries({ SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, AGENT_EMAIL, AGENT_PASSWORD })) {
    if (!v) throw new Error(`Missing ${k} in .env`);
  }
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    // ---------------- superadmin ----------------
    const admin = await login(browser, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/);
    const sink = [];
    watch(admin.page, sink);

    const promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    const agentUrl = admin.page.url();
    const agentId = (agentUrl.match(/\/agents\/view\/(\d+)/) || [])[1];
    console.log(`\nagent detail URL: ${agentUrl}  (id ${agentId})`);
    console.log(`parameters: ${JSON.stringify(await promo.readAllParameters())}`);
    sink.length = 0;

    // --- [SAVE] what does a legitimate save fire? Nudge the expiry a day forward. ---
    const snap = await promo.snapshotParameters();
    console.log(`snapshot: ${JSON.stringify(snap)}`);
    const plusDay = new Date(`${snap.expiry || '2027-01-01'}T00:00:00Z`);
    plusDay.setUTCDate(plusDay.getUTCDate() - 1);
    const nudged = plusDay.toISOString().slice(0, 10);

    await promo.openEditParameters();
    await promo.setExpiryDate(nudged);
    console.log(`\n[SAVE] set expiry ${snap.expiry} -> ${nudged}; Save enabled: ${await promo.isSaveEnabled()}`);
    await promo.saveChanges().catch((e) => console.log(`  saveChanges: ${e.message.split('\n')[0]}`));
    await admin.page.waitForTimeout(2500);
    dump(sink, 'SAVE');

    // --- does the modal really disable Save for a past date? ---
    await promo.openEditParameters();
    await promo.setExpiryDate('2020-01-01');
    console.log(`[PAST-UI] expiry 2020-01-01 -> Save enabled: ${await promo.isSaveEnabled()}`);
    await promo.cancelEdit();

    // --- [PAST] call the app's own API directly with a past date ---
    // The endpoint + payload shape come from [SAVE] above; try the shapes we saw.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pastIso = yesterday.toISOString().slice(0, 10);
    const attempts = await admin.page.evaluate(async ({ id, pastIso }) => {
      const out = [];
      const paths = [
        `/core/api/v1/agents/${id}/promo-code/`,
        `/core/api/v1/agents/${id}/promo/`,
        `/core/api/v1/promo-codes/${id}/`,
        `/core/api/v1/agents/${id}/`,
      ];
      const bodies = [
        { expiry_date: pastIso },
        { expires_at: pastIso },
        { promo_code: { expiry_date: pastIso } },
      ];
      for (const p of paths) {
        for (const method of ['PATCH', 'PUT']) {
          for (const b of bodies) {
            try {
              const r = await fetch(p, {
                method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(b),
              });
              const t = await r.text();
              out.push(`${method} ${p} ${JSON.stringify(b)} -> ${r.status} ${t.slice(0, 200)}`);
            } catch (e) {
              out.push(`${method} ${p} -> threw ${e.message}`);
            }
          }
        }
      }
      return out;
    }, { id: agentId, pastIso });
    console.log('\n=============== PAST (direct API) ===============');
    for (const a of attempts) console.log(`  ${a}`);

    // --- put the expiry back ---
    const back = await promo.restoreParameters(snap);
    console.log(`\nrestore: ${JSON.stringify(back)}  now: ${JSON.stringify(await promo.readAllParameters())}`);

    await probeNotifications(admin.page, 'superadmin');
    await admin.context.close();

    // ---------------- agent ----------------
    const agent = await login(browser, AGENT_EMAIL, AGENT_PASSWORD,
      /\/dashboard|\/candidates|\/verifications|\/activity-log|\/set-password/);
    console.log(`\nagent landed on: ${agent.page.url()}`);
    await probeNotifications(agent.page, 'agent');
    await agent.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
