/* eslint-disable no-console */
// provision-2fa-agent.js — mint the ONE dedicated agent that features/Agent_Portal/2FA.feature
// drives, and record it in .env as TWOFA_AGENT_EMAIL / _PASSWORD / _NAME.
//
// WHY A DEDICATED ACCOUNT IS NOT OPTIONAL HERE
// Every other feature that logs in as an agent (Dashboard, Active-candidate, Verification,
// Change-Password, Referral-Codes) does so with a plain email+password POST. The moment 2FA is
// enabled on an account, that login grows a mandatory OTP step — so a 2FA run that dies between
// "toggle on" and "toggle off" would leave the shared AGENT_EMAIL account demanding a code every
// other feature has no idea how to supply, and the whole suite would go red at its Background.
// The 2FA scenarios restore state in an After hook, but a hook is a mitigation, not a guarantee
// (a killed run has no hook at all).
//
// So: one agent, invited once, whose ONLY job is to have 2FA turned on and off. Nothing else in
// the suite logs in as it, so wedging it can cost at most this one feature.
//
// Idempotent: refuses to overwrite an existing TWOFA_AGENT_EMAIL unless --force is passed, so
// re-running by mistake cannot orphan the account the suite is actually driving.
//
// Cost: one live superadmin invite + one IMAP round trip for the invite mail + a set-password
// walk. No payment. Run it once:  node scripts/provision-2fa-agent.js
require('dotenv').config();
const { chromium } = require('playwright');
const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');
const { updateEnv, ENV_PATH } = require('../utils/envWriter');

(async () => {
  const force = process.argv.includes('--force');
  if (process.env.TWOFA_AGENT_EMAIL && !force) {
    console.log(`TWOFA_AGENT_EMAIL is already set to ${process.env.TWOFA_AGENT_EMAIL}.`);
    console.log('Nothing done. Pass --force to invite a replacement (the old one is abandoned, not deleted).');
    return;
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  try {
    console.log('Inviting a fresh agent for the 2FA feature (no promo code)...');
    const agent = await provisionAgentWithoutPromo(browser, {
      label: '2fa',
      firstName: 'Twofa',
      tagPrefix: 'twofa',
    });

    updateEnv('TWOFA_AGENT_EMAIL', agent.email);
    updateEnv('TWOFA_AGENT_PASSWORD', agent.password);
    updateEnv('TWOFA_AGENT_NAME', agent.name);

    console.log(`\nWritten to ${ENV_PATH}:`);
    console.log(`TWOFA_AGENT_EMAIL=${agent.email}`);
    console.log(`TWOFA_AGENT_PASSWORD=${agent.password}`);
    console.log(`TWOFA_AGENT_NAME=${agent.name}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
