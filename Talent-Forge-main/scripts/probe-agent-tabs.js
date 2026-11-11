// probe-agent-tabs.js — answer, against the LIVE app, what the four Agents lifecycle tabs
// actually contain, and where the agents provisioned by the last Invite-agent run ended up.
//
//   node scripts/probe-agent-tabs.js
//
// Dumps:
//   1. whether /agents?tab=<param> really selects that tab on a cold load
//   2. the API call each tab fires (URL + query), and the raw status of the rows it returns
//   3. for each provisioned email: which tab(s) hold it and with what status
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AgentsListingPage = require('../pages/AgentsListingPage');

const EMAILS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'iqra.farooq+iams7dke974@bytecorp.io',   // scenario 1 — full lifecycle, ended Active
      'iqra.farooq+iams7dmhvy5@bytecorp.io',   // scenario 2 — resend, vanished from Invite Sent
      'iqra.farooq+iams7dx90512@bytecorp.io',  // scenario 14 — stopped at set-password
    ];

const TAG_PREFIX = process.env.INVITE_AGENT_TAG_PREFIX || 'ia';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const line = (t) => console.log(`\n${'='.repeat(14)} ${t} ${'='.repeat(14)}`);

// Mirror of agentInviteProvision's identity generator, so an email can be turned back into
// the surname the listing's (name-only) search box needs.
function surnameFor(email) {
  const tag = (email.split('@')[0].split('+')[1] || '');
  const stamp = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
  return `Qa${stamp.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const api = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\//.test(url)) return;
    if (!/agent/i.test(url)) return;
    if (res.request().method() !== 'GET') return;
    let body = '';
    try { body = await res.text(); } catch { /* stream gone */ }
    api.push({ url, status: res.status(), body: body.slice(0, 4000) });
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents|\/candidate|\/user-management/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const listing = new AgentsListingPage(page);

  // ---- 1 + 2: does ?tab= stick, and what does each tab ask the backend for ----
  for (const tab of ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated']) {
    api.length = 0;
    await listing.goto(tab);
    line(`TAB "${tab}" — url ${page.url()}`);
    console.log('selected tab reported by the radio group:', await listing.selectedTab());
    console.log('column headers:', (await listing.columnHeaders()).map(clean).join(' | '));
    for (const call of api) {
      console.log(`  API ${call.status} ${call.url}`);
    }
    const rows = await listing.readRows();
    console.log(`  rows on page 1: ${rows.length}`);
    rows.slice(0, 5).forEach((r) => console.log(`   - ${r.name} <${r.email}> status="${r.status}" cells=${JSON.stringify(r.cells)}`));
    // The raw status the API returns for those rows, which is what the tab filter keys on.
    const last = api[api.length - 1];
    if (last && /^[[{]/.test(last.body.trim())) {
      try {
        const json = JSON.parse(last.body);
        const items = Array.isArray(json) ? json : (json.results || json.data || json.items || []);
        console.log('  raw statuses from the API:', JSON.stringify(items.slice(0, 6).map((i) => ({
          email: i.email, status: i.status, state: i.state, is_active: i.is_active,
          invite_status: i.invite_status, onboarding: i.onboarding_status,
        }))));
      } catch { console.log('  (API body was not JSON)'); }
    }
  }

  // ---- 3: where each provisioned agent actually lives ----
  for (const email of EMAILS) {
    const surname = surnameFor(email);
    line(`AGENT ${email}  (search term "${surname}")`);
    for (const tab of ['Active', 'Invite Sent', 'Requires Attention', 'Deactivated']) {
      await listing.goto(tab);
      await listing.search(surname);
      const rows = await listing.readRows();
      const hit = rows.find((r) => (r.email || '').toLowerCase() === email.toLowerCase());
      console.log(
        `  ${tab.padEnd(20)} rows=${rows.length} ${hit ? `HIT status="${hit.status}" cells=${JSON.stringify(hit.cells)} actions=${JSON.stringify(hit.actions)}` : '—'}`
      );
    }
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
