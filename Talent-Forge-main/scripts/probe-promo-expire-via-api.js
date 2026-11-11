// probe-promo-expire-via-api.js — can a promo be pushed PAST its expiry date?
//
//   node scripts/probe-promo-expire-via-api.js
//
// The Edit Code Parameters modal silently disables "Save Changes" for any expiry date
// before today, so the UI cannot produce an expired promo. But the save itself is a plain
//   PATCH https://dev-api.talentforge.com.sa/core/api/v1/agents/<id>/promotion/
//   {"expiry_date":"YYYY-MM-DD"}
// (captured by scripts/probe-promo-expiry-and-notifications.js). If the API accepts a past
// date, "its expiry date passes" stops being living spec and becomes a real, automatable
// lifecycle transition — the same technique the suite already uses for other states it
// cannot reach through the UI.
//
// Prints, for the LIMITED promo agent:
//   [AUTH]    where the app keeps its access token
//   [PAST]    the API's answer to a yesterday expiry date
//   [EFFECT]  what the superadmin tab, the agent's own widget and a candidate redemption
//             then report — status, warning icon, in-app notification, inline error
// and RESTORES the original expiry date before exiting, whatever happens.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const AGENT_EMAIL = process.env.PROMO_LIMITED_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.PROMO_LIMITED_AGENT_PASSWORD;
const AGENT_NAME = process.env.PROMO_LIMITED_AGENT_NAME;
const AGENT_CODE = process.env.PROMO_LIMITED_AGENT_PROMO_CODE;

const API = 'https://dev-api.talentforge.com.sa';

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

// Find the access token wherever the app parked it.
async function findToken(page) {
  return page.evaluate(() => {
    const out = [];
    for (const store of ['localStorage', 'sessionStorage']) {
      const s = window[store];
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        const v = s.getItem(k) || '';
        // A JWT, raw or nested in a JSON blob.
        const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
        if (m) out.push({ store, key: k, token: m[0] });
      }
    }
    return out;
  });
}

async function apiCall(page, token, method, path, body) {
  return page.evaluate(async ({ url, method, body, token }) => {
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 700) };
  }, { url: `${API}${path}`, method, body, token });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  let promo = null;
  let snap = null;
  try {
    const admin = await login(browser, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD,
      /\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/);
    promo = new AdminPromoToolsPage(admin.page);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    const agentId = (admin.page.url().match(/\/agents\/view\/(\d+)/) || [])[1];
    snap = await promo.snapshotParameters();
    console.log(`agent id ${agentId}  snapshot ${JSON.stringify(snap)}`);

    const tokens = await findToken(admin.page);
    console.log(`\n=============== AUTH ===============`);
    console.log(tokens.length
      ? tokens.map((t) => `  ${t.store}.${t.key} = ${t.token.slice(0, 24)}…`).join('\n')
      : '  no JWT in web storage — the session must be cookie-based');
    const token = tokens.length ? tokens[0].token : null;

    console.log(`\n=============== PAST ===============`);
    const yesterday = isoOffset(-1);
    let r = await apiCall(admin.page, token, 'PATCH', `/core/api/v1/agents/${agentId}/promotion/`, { expiry_date: yesterday });
    console.log(`  PATCH expiry_date=${yesterday} -> ${r.status}\n     ${r.body}`);

    if (r.status >= 400) {
      // Fall back to today, and to a full-object PATCH, to learn what the API will take.
      r = await apiCall(admin.page, token, 'PATCH', `/core/api/v1/agents/${agentId}/promotion/`, { expiry_date: isoOffset(0) });
      console.log(`  PATCH expiry_date=${isoOffset(0)} (today) -> ${r.status}\n     ${r.body}`);
      r = await apiCall(admin.page, token, 'PATCH', `/core/api/v1/agents/${agentId}/promotion/`,
        { expiry_date: yesterday, status: 'Active', incentive_type: 'PERCENTAGE_DISCOUNT', incentive_value: 20, usage_limit: 2 });
      console.log(`  PATCH full object, expiry_date=${yesterday} -> ${r.status}\n     ${r.body}`);
    }

    // What does the API now report, and what does the tab render?
    const readBack = await apiCall(admin.page, token, 'GET', `/core/api/v1/agents/${agentId}/promotion/`);
    console.log(`  GET promotion -> ${readBack.status}\n     ${readBack.body}`);

    console.log(`\n=============== EFFECT (superadmin tab) ===============`);
    await promo.openPromoTools(AGENT_NAME || AGENT_EMAIL);
    console.log(`  parameters: ${JSON.stringify(await promo.readAllParameters())}`);
    console.log(`  warning icons: ${JSON.stringify(await promo.warningIcons())}`);

    // Superadmin's own in-app notifications, unread first.
    const notif = await apiCall(admin.page, token, 'GET', '/core/api/v1/notifications/?page=1&page_size=20');
    console.log(`\n=============== EFFECT (superadmin notifications) ===============`);
    console.log(`  ${notif.status}\n     ${notif.body}`);

    // ---- agent side ----
    const agent = await login(browser, AGENT_EMAIL, AGENT_PASSWORD, /\/dashboard|\/candidates|\/verifications|\/activity-log/);
    const agentTokens = await findToken(agent.page);
    const agentToken = agentTokens.length ? agentTokens[0].token : null;
    const agentNotif = await apiCall(agent.page, agentToken, 'GET', '/core/api/v1/notifications/?page=1&page_size=20');
    console.log(`\n=============== EFFECT (agent notifications) ===============`);
    console.log(`  ${agentNotif.status}\n     ${agentNotif.body.slice(0, 1500)}`);
    await agent.context.close();

    // ---- candidate redemption ----
    const candEmail = process.env.CANDIDATE_EMAIL;
    const candPass = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;
    if (candEmail && candPass) {
      const cand = await login(browser, candEmail, candPass, /\/dashboard|\/profile|\/jobs|\/onboarding/);
      const SubscriptionPage = require('../pages/SubscriptionPage');
      const subs = new SubscriptionPage(cand.page);
      await subs.gotoPlans().catch(() => {});
      await subs.selectPlan('Monthly').catch((e) => console.log(`  selectPlan: ${e.message.split('\n')[0]}`));
      const res = await subs.applyPromoAwaitingPreview(AGENT_CODE).catch((e) => ({ error: e.message }));
      console.log(`\n=============== EFFECT (candidate redemption) ===============`);
      console.log(`  ${JSON.stringify(res).slice(0, 600)}`);
      const err = await cand.page.locator('text=/invalid or expired/i').first().isVisible().catch(() => false);
      console.log(`  inline "Invalid or expired promotion code" visible: ${err}`);
      await cand.context.close();
    }
  } catch (e) {
    console.error(`\nPROBE FAILED: ${e.message}`);
  } finally {
    if (promo && snap) {
      const back = await promo.restoreParameters(snap).catch((e) => ({ restored: false, reason: e.message }));
      console.log(`\nRESTORE: ${JSON.stringify(back)}`);
      if (!back.restored) {
        console.log(`  !! RESTORE THE EXPIRY DATE BY HAND: ${AGENT_NAME} > Promo Tools > Edit parameters > ${snap.expiry}`);
      }
    }
    await browser.close();
  }
})();
