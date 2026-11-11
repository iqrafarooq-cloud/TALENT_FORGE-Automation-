// probe-candidate-setup-link.js - resolve the candidate invitation's "Set up my account" link and
// dump the page it lands on: the URL, its query, and every form field with whatever value the app
// has pre-filled.
//
// Five scenarios in candidate_onboarding_e2e.feature turn on this page arriving with the invited
// email and the agent code already filled in. Read-only: it fills nothing and submits nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const { makeClient } = require('../utils/gmailClient');
const { simpleParser } = require('mailparser');
const { resolveVerifyUrl } = require('../utils/onboardingProvision');
const line = console.log;

const TARGET = process.argv[2];
if (!TARGET) { line('usage: node scripts/probe-candidate-setup-link.js <invited-email>'); process.exit(1); }

// Follow the SendGrid wrapper to whatever the app URL turns out to be. resolveVerifyUrl() stops
// early on /verify-email, which is the CANDIDATE-SIGNUP flow's landing page - an invite may land
// somewhere else entirely, so the chain is also followed generically here and both are reported.
async function followAll(startUrl, maxHops = 8) {
  const chain = [startUrl];
  let url = startUrl;
  for (let i = 0; i < maxHops; i++) {
    let res;
    try { res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } }); }
    catch (e) { chain.push(`<<fetch failed: ${e.message}>>`); break; }
    const loc = res.headers.get('location');
    chain.push(`  ${res.status} -> ${loc || '(no location)'}`);
    if (res.status >= 300 && res.status < 400 && loc) { url = loc; continue; }
    break;
  }
  return { finalUrl: url, chain };
}

(async () => {
  // 1. find the invite mail
  const c = makeClient(); await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  let link = null;
  try {
    const uids = await c.search({ to: TARGET }, { uid: true });
    line(`messages to ${TARGET}: ${uids.length}`);
    for (const uid of uids.sort((a, b) => b - a)) {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      const p = await simpleParser(msg.source);
      line(`  uid=${uid} subject=${JSON.stringify(p.subject)}`);
      const links = [...new Set([...(p.html || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]))]
        .filter((l) => /ls\/click|talentforge\.com\.sa/.test(l) && !/s3\.|\/wf\/open/.test(l));
      if (links.length) { link = links[0]; break; }
    }
  } finally { lock.release(); await c.logout(); }
  if (!link) { line('no setup link found'); process.exit(1); }
  line(`\nCTA link: ${link.slice(0, 200)}...`);

  const { finalUrl, chain } = await followAll(link);
  line('\n=== redirect chain ===');
  chain.forEach((s) => line('  ' + s));
  line(`\nresolved to: ${finalUrl}`);
  line(`resolveVerifyUrl() says: ${await resolveVerifyUrl(link)}`);
  try {
    const u = new URL(finalUrl);
    line(`  path: ${u.pathname}`);
    u.searchParams.forEach((v, k) => line(`  query ${k} = ${JSON.stringify(v.slice(0, 80))}`));
  } catch {}

  // 2. open it in a clean browser and dump the form
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    line(`\n=== landed on: ${page.url()} ===`);
    line(`heading/body text:\n${(await page.locator('body').innerText()).slice(0, 1800)}`);
    line('\n=== every form control, with its pre-filled value ===');
    const inputs = page.locator('input, select, textarea');
    for (let i = 0; i < await inputs.count(); i++) {
      const el = inputs.nth(i);
      line('  ' + JSON.stringify(await el.evaluate((e) => ({
        tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name'),
        placeholder: e.getAttribute('placeholder'), value: e.value,
        readonly: e.readOnly, disabled: e.disabled, testid: e.getAttribute('data-testid'),
        visible: !!(e.offsetWidth || e.offsetHeight),
      }))));
    }
    line('\n=== buttons ===');
    const b = page.locator('button');
    for (let i = 0; i < await b.count(); i++) {
      const el = b.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      line('  ' + JSON.stringify(await el.evaluate((e) => ({ text: (e.innerText || '').trim().slice(0, 40), testid: e.getAttribute('data-testid'), disabled: e.disabled }))));
    }
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
