// provision-promo-agents.js — one-off provisioning for the three dedicated promo agents that
// features/Promo_Code/ runs against.
//
// WHY A SCRIPT AND NOT A @provision SCENARIO
// The promo features need agent accounts whose promo codes carry SPECIFIC usage limits, and they
// need to log in AS those agents (the promo must be visible on their own dashboard). Neither can
// be produced inside a scenario cheaply:
//   * "Invite Sent" -> accepted is one-way, so an agent can only be onboarded once;
//   * the Promo Code Name is app-generated and read-only everywhere (invite form, Add / Edit Code
//     Parameters), so the code cannot be chosen — it has to be READ BACK after creation and
//     written into .env;
//   * every invite mail lands on the same inbox, so this must run serially.
// So the accounts are provisioned ONCE by hand with this script, their generated codes are pasted
// into .env, and the features then run against stable accounts on every run.
//
// The invite/accept mechanics themselves live in features/support/promoAgentProvision.js, because
// the usage-limit scenario needs the same flow at RUNTIME to mint a throwaway agent it is going to
// exhaust. This script is now just the spec list and the .env block printer.
//
// WHAT IT CREATES (verified against the live DEV invite form, 2026-07-30):
//   PROMO_UNLIMITED_AGENT  Percentage Discount 20%   usage limit 10000  expiry +365d
//   PROMO_LIMITED_AGENT    Percentage Discount 20%   usage limit 2      expiry +365d
//   PROMO_FIXED_AGENT      Fixed Amount SAR 50       usage limit 10000  expiry +365d
//
// On the FIXED agent: the other two cover Percentage Discount only, so a flat-amount promo was
// never exercised past the invite form. SAR 50 sits well under the SAR 155 Monthly subtotal, so a
// redemption leaves an unambiguous SAR 105 due, and 50 is not a percentage of 155 — a discount
// computed the wrong way cannot coincidentally match.
//
// On "unlimited": the product has NO unlimited option. Usage Limit is a required integer with a
// minimum of 1 on the invite form, in "Add Code Parameters" and in "Edit Code Parameters" — all
// three checked live — and neither TFF-42 nor TFF-43 specifies one. A limit of 10000 is therefore
// the agreed stand-in for "effectively unlimited": it can never be exhausted by the suite, so it
// behaves as unlimited for every test that needs an always-redeemable code.
//
// On PROMO_LIMITED_AGENT's limit of 2: it is NO LONGER spent by the suite. The exhaustion scenario
// now provisions its own throwaway agent at runtime (usage limit 1) rather than consuming this
// one, so these two uses stay in reserve for manual investigation.
//
// Usage:  node scripts/provision-promo-agents.js [ENV_PREFIX ...]
// Then paste the printed block into .env.
require('dotenv').config();
const { chromium } = require('playwright');
const { provisionPromoAgent, parsePromoSpec } = require('../utils/promoAgentProvision');

const NEW_PASSWORD = process.env.INVITE_AGENT_NEW_PASSWORD;

// The accounts to create. `envPrefix` is what the printed .env block is keyed on.
const SPECS = [
  {
    envPrefix: 'PROMO_UNLIMITED_AGENT',
    tagPrefix: 'promounl',
    firstName: 'Unlimited',
    promo: 'Percentage Discount of 20',
    usageLimit: '10000',
    note: 'effectively unlimited — 10000 uses, never exhausted by the suite',
  },
  {
    envPrefix: 'PROMO_LIMITED_AGENT',
    tagPrefix: 'promoltd',
    firstName: 'Limited',
    promo: 'Percentage Discount of 20',
    usageLimit: '2',
    note: 'limited — 2 uses held in reserve; the suite no longer spends them',
  },
  {
    envPrefix: 'PROMO_FIXED_AGENT',
    tagPrefix: 'promofix',
    firstName: 'Fixed',
    promo: 'Fixed Amount of 50',
    usageLimit: '10000',
    note: 'flat SAR 50 off — the only Fixed Amount promo in the suite',
  },
];

(async () => {
  if (!NEW_PASSWORD) {
    throw new Error('Missing INVITE_AGENT_NEW_PASSWORD in .env');
  }

  // Provision a SUBSET when env prefixes are passed as arguments:
  //   node scripts/provision-promo-agents.js PROMO_FIXED_AGENT
  // Without this the script re-invites every spec, minting NEW promo codes for agents that are
  // already recorded in .env and silently orphaning the ones the features run against.
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const specs = wanted.length ? SPECS.filter((s) => wanted.includes(s.envPrefix)) : SPECS;
  if (!specs.length) {
    throw new Error(
      `No spec matched ${JSON.stringify(wanted)}. Known: ${SPECS.map((s) => s.envPrefix).join(', ')}.`
    );
  }
  if (!wanted.length) {
    console.log(
      'Provisioning ALL specs — this mints new promo codes for every agent and the existing\n'
      + '.env entries become orphaned. Pass an env prefix to provision just one, e.g.\n'
      + '  node scripts/provision-promo-agents.js PROMO_FIXED_AGENT\n'
    );
  }
  console.log(`provisioning: ${specs.map((s) => s.envPrefix).join(', ')}\n`);

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 40 });
  const created = [];

  try {
    for (const spec of specs) {
      console.log(`--- ${spec.envPrefix} (${spec.note}) ---`);
      const agent = await provisionPromoAgent(browser, spec);
      console.log(`  invited ${agent.email}  promo ${agent.code}  limit ${spec.usageLimit}`);
      console.log('  invite accepted\n');
      created.push({ spec, agent });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\n================ paste into .env ================\n');
  console.log('#PROMO CODE LIFECYCLE — DEDICATED AGENTS, invited from the superadmin portal');
  console.log(`# Provisioned ${new Date().toISOString().slice(0, 10)} by scripts/provision-promo-agents.js.`);
  console.log('# Promo Code Name is app-generated and read-only everywhere, so these codes are');
  console.log('# whatever the app assigned at invite time and cannot be renamed.');
  for (const c of created) {
    const p = c.spec.envPrefix;
    // Derived from the spec, never hardcoded — the block previously printed
    // "Percentage Discount 20%" for every agent, which would have silently mislabelled the
    // Fixed Amount one and put the wrong _PROMO_VALUE in .env.
    const { type, value } = parsePromoSpec(c.spec.promo);
    const shown = type === 'Fixed Amount' ? `Fixed Amount SAR ${value}` : `Percentage Discount ${value}%`;
    console.log('#');
    console.log(`# ${c.agent.code} -- ${shown} -- usage limit ${c.spec.usageLimit} -- ${c.spec.note}`);
    console.log(`${p}_EMAIL=${c.agent.email}`);
    console.log(`${p}_PASSWORD=${NEW_PASSWORD}`);
    console.log(`${p}_NAME=${c.agent.name}`);
    console.log(`${p}_PROMO_CODE=${c.agent.code}`);
    console.log(`${p}_PROMO_LIMIT=${c.spec.usageLimit}`);
    console.log(`${p}_PROMO_VALUE=${value}`);
    console.log(`${p}_PROMO_TYPE=${type}`);
  }
  console.log('\n=================================================\n');
})().catch((e) => {
  console.error('\nPROVISIONING FAILED:', (e && e.message) || e);
  process.exit(1);
});
