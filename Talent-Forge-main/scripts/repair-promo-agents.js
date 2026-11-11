// repair-promo-agents.js — put every dedicated promo agent's parameters back to what .env says
// they are.
//
//   node scripts/repair-promo-agents.js            # report only, changes nothing
//   node scripts/repair-promo-agents.js --fix      # write the .env values back
//
// WHY THIS EXISTS
// The promo features mutate real promos and restore them in an After hook. Until 2026-07-31 that
// restore captured Usage Limit and then silently dropped it, so any scenario that edited the
// limit left the new figure behind for good — the unlimited and fixed agents were found sitting
// on 500 and then 10 against the 10000 .env records. The leak is fixed in
// AdminPromoToolsPage.restoreParameters(), but nothing repairs state that has ALREADY drifted,
// and a drifted limit makes the tab-coherence scenario fail against .env in a way that reads
// exactly like an app defect.
//
// Run the report after any run that ended badly (a killed process skips the After hook entirely).
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const PREFIXES = ['PROMO_UNLIMITED_AGENT', 'PROMO_LIMITED_AGENT', 'PROMO_FIXED_AGENT'];
const FIX = process.argv.includes('--fix');

// The tab renders dd/mm/yyyy; setExpiryDate() takes YYYY-MM-DD. Parsed by hand rather than fed
// to Date(): "04/09/2026" is 4 September to this app and 9 April to Date(), and getting that
// backwards is the difference between "lapsed three days ago" and "fine for another seven months".
const parseTabDate = (s) => {
  const parts = String(s || '').trim().split('/');
  if (parts.length !== 3 || parts.some((x) => x.length < 1 || Number.isNaN(Number(x)))) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  return new Date(yyyy, mm - 1, dd);
};
const isoDaysFromToday = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const num = (s) => {
  const m = String(s == null ? '' : s).match(/-?[\d.,]+/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : null;
};

(async () => {
  const agents = PREFIXES.map((p) => ({
    prefix: p,
    name: process.env[`${p}_NAME`],
    email: process.env[`${p}_EMAIL`],
    code: process.env[`${p}_PROMO_CODE`],
    limit: Number(process.env[`${p}_PROMO_LIMIT`]),
    value: Number(process.env[`${p}_PROMO_VALUE`]),
    type: process.env[`${p}_PROMO_TYPE`] || 'Percentage Discount',
    referralCode: process.env[`${p}_REFERRAL_CODE`],
    candidateEmail: process.env[`${p}_CANDIDATE_EMAIL`],
  })).filter((a) => a.email);

  if (!agents.length) throw new Error('No PROMO_*_AGENT_* entries found in .env');

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 30 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  console.log(`superadmin signed in${FIX ? ' — WILL WRITE CHANGES' : ' — report only'}\n`);

  const admin = new AdminPromoToolsPage(page);
  let drifted = 0;

  for (const agent of agents) {
    // The identity block first, so this one command answers "which accounts is the suite driving?"
    // without anyone having to read .env. Redemption is ownership-scoped, so the agent and its
    // candidate are a pair — printing either alone is not enough to hand to a developer.
    console.log(`--- ${agent.prefix} (${agent.code}) ---`);
    console.log(`  ${'agent'.padEnd(15)} ${agent.name || '(unnamed)'} <${agent.email}>`);
    console.log(`  ${'candidate'.padEnd(15)} ${agent.candidateEmail || 'MISSING — run `npm run test:promo:candidates`'}`
      + `${agent.referralCode ? `  (signed up under agent code ${agent.referralCode})` : ''}`);
    try {
      await admin.openPromoTools(agent.name || agent.email);
    } catch (e) {
      console.log(`  could not open the tab: ${e.message.split('\n')[0]}\n`);
      continue;
    }

    const params = await admin.readAllParameters();
    // The PROMO CODE STRING is checked, not just the parameters. It used to be echoed from .env
    // and never compared, which left the worst drift invisible: an ORPHANED .env code (the agent's
    // real code having been regenerated) makes every redemption answer "Invalid or expired
    // promotion code" — the same message a disabled, expired or foreign code produces. That turns
    // the ownership scenario green while proving nothing, and turns every positive redemption
    // scenario red for a reason that looks like an app defect.
    const liveCode = await admin.readPromoCode().catch(() => null);
    const checks = [
      ['Promo Code', liveCode, agent.code, (a, b) => String(a || '').trim() === String(b || '').trim()],
      ['Status', (params.Status || '').trim(), 'Active', (a, b) => new RegExp(b, 'i').test(a)],
      ['Incentive Type', (params['Incentive Type'] || '').trim(), agent.type,
        (a, b) => new RegExp(b.replace(/\s+/g, '\\s*'), 'i').test(a)],
      ['Value', num(params.Value), agent.value, (a, b) => a === b],
      ['Usage Limit', num(params['Usage Limit']), agent.limit, (a, b) => a === b],
    ];

    const wrong = checks.filter(([, actual, want, ok]) => !ok(actual, want));
    for (const [field, actual, want] of checks) {
      const bad = wrong.find(([f]) => f === field);
      console.log(`  ${field.padEnd(15)} tab=${JSON.stringify(actual)}  .env=${JSON.stringify(want)}  ${bad ? '<-- DRIFTED' : 'ok'}`);
    }
    // Reported, never repaired. Expiry has no .env counterpart to restore to (provisioning sets
    // +365d from whenever the agent was minted), and Total Usage / revenue are server-owned. They
    // are printed because they are the other two reasons a perfectly-configured promo still gets
    // refused at checkout: a date in the past, or a limit already spent.
    const used = await admin.readTotalUsageCount();
    const limit = num(params['Usage Limit']);
    const { label, value: revenue } = await admin.readPromoRevenue();
    // A LAPSED EXPIRY IS DRIFT, NOT AN INFORMATIONAL FOOTNOTE. It was printed as the latter until
    // 2026-09-07, when PROMO_FIXED_AGENT sat on 04/09/2026 for three days: every scenario driving
    // that agent failed at checkout with the generic "Invalid or expired promotion code", and this
    // script reported "nothing to repair". Worse, a past date silently DISABLES Save Changes, so
    // --fix could not have written anything either - it would have reported "Save stayed disabled".
    const expiryText = (params['Expiry Date'] || '').trim();
    const expiryDate = parseTabDate(expiryText);
    const lapsed = expiryDate !== null && expiryDate < startOfToday();
    console.log(`  ${'Expiry Date'.padEnd(15)} tab=${JSON.stringify(expiryText)}  ${lapsed ? '<-- LAPSED: every redemption of this code is refused, and Save Changes is gated until it is extended' : 'ok'}`);
    console.log(`  ${'Total Usage'.padEnd(15)} tab=${JSON.stringify(used)} of ${JSON.stringify(limit)}  ${label ? `${label}=${JSON.stringify(revenue)}` : 'no revenue figure'}`);
    if (used !== null && limit !== null && used >= limit) {
      console.log('  <-- EXHAUSTED: every redemption of this code will be refused');
    }

    if (!wrong.length && !lapsed) { console.log('  nothing to repair\n'); continue; }
    drifted += 1;
    // A drifted CODE cannot be repaired from here: the app generates it and no control anywhere in
    // the portal renames one. The .env entry is what has to change, so say so instead of silently
    // "repairing" the four parameters around a code the suite will still fail on.
    if (wrong.some(([f]) => f === 'Promo Code')) {
      console.log(
        `  CANNOT REPAIR: ${agent.prefix}_PROMO_CODE in .env reads ${JSON.stringify(agent.code)} but `
        + `this agent's live code is ${JSON.stringify(liveCode)}. Promo codes are app-generated and `
        + 'cannot be renamed, so update .env to the live code (or re-provision this agent with '
        + `\`node scripts/provision-promo-agents.js ${agent.prefix}\`).\n`
      );
      continue;
    }
    if (!FIX) { console.log('  (re-run with --fix to correct)\n'); continue; }

    await admin.openEditParameters();
    // Extended BEFORE anything else: while the date is in the past the form gates Save, so every
    // other repair below would be typed in and then thrown away with the modal.
    if (lapsed) {
      const iso = isoDaysFromToday(365);
      await admin.setExpiryDate(iso);
      console.log(`  expiry ${expiryText} had lapsed -> extending to ${iso}`);
    }
    await admin.setStatus(true).catch(() => {});
    await admin.setIncentive(agent.type);
    await admin.setValue(String(agent.value));
    await admin.setUsageLimit(String(agent.limit));
    if (await admin.isSaveEnabled()) {
      await admin.saveChanges();
      await admin.openPromoTools(agent.name || agent.email);
      const after = await admin.readAllParameters();
      console.log(`  repaired -> Value ${JSON.stringify(after.Value)}, Usage Limit ${JSON.stringify(after['Usage Limit'])}, Status ${JSON.stringify(after.Status)}\n`);
    } else {
      await admin.cancelEdit();
      console.log('  Save stayed disabled — nothing written\n');
    }
  }

  console.log(drifted
    ? `${drifted} agent(s) had drifted parameters or a lapsed expiry.${FIX ? '' : ' Re-run with --fix.'}`
    : 'every promo agent matches .env.');

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nREPAIR FAILED:', e); process.exit(1); });
