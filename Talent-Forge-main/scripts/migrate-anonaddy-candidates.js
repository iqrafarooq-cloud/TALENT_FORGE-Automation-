/* eslint-disable no-console */
// migrate-anonaddy-candidates.js - moves the long-lived candidate fixtures off anonaddy and onto
// the bytecorp inbox WITHOUT replacing the accounts (2026-10-14: anonaddy is no longer used).
//
// Just rewriting the address in .env would point the suite at accounts that do not exist. So for
// each key below it uses the product's own flow and keeps the SAME account, with its
// subscription, its owning promo agent and its password:
//
//   1. superadmin > Candidates > Edit > Update Email Address -> a fresh iqra.farooq+<tag>@bytecorp.io
//   2. read "Verify your new Talentforge email address" off the bytecorp IMAP inbox
//   3. open the link in an isolated context and require "Email address confirmed ... now active"
//   4. PROVE the account signs in at the new address with its unchanged .env password
//   5. only then rewrite that one .env key (the rest of the file is left byte-for-byte)
//
// Idempotent: a key whose value is already on bytecorp is skipped, and the .env write happens
// per key, so a run that dies half way leaves every finished key correct.
//
// Run:  node scripts/migrate-anonaddy-candidates.js            (every key still on anonaddy)
//       node scripts/migrate-anonaddy-candidates.js CANDIDATE_EMAIL
//       node scripts/migrate-anonaddy-candidates.js --dry-run  (lists what it would do)
//       node scripts/migrate-anonaddy-candidates.js KEY --resume <new address>
//         finishes a change already requested (pending) for KEY: reads that address's
//         verification mail, confirms, proves the login, writes .env. Requests nothing new.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { chromium } = require('playwright');
const CandidatesListingPage = require('../pages/CandidatesListingPage');
const { latestUid, waitForEmail } = require('../utils/gmailClient');
const { resolveVerifyUrl } = require('../utils/onboardingProvision');

const ENV_PATH = path.resolve(__dirname, '..', '.env');
const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa/login';
const INBOX = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
const DRY = process.argv.includes('--dry-run');
const RESUME = (process.argv.find((a, i) => process.argv[i - 1] === '--resume') || '').trim();
const ONLY = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--resume');
if (RESUME && ONLY.length !== 1) throw new Error('--resume needs exactly one KEY');

// key -> { password key, alias tag }
const FIXTURES = {
  // .env spells this one CANDIDTAE_PASSWORD (a long-standing typo the steps also accept).
  CANDIDATE_EMAIL: { pw: ['CANDIDTAE_PASSWORD', 'CANDIDATE_PASSWORD'], tag: 'sharedcandidate' },
  PROMO_UNLIMITED_AGENT_CANDIDATE_EMAIL: { pw: 'PROMO_UNLIMITED_AGENT_CANDIDATE_PASSWORD', tag: 'promounlimitedcand' },
  PROMO_LIMITED_AGENT_CANDIDATE_EMAIL: { pw: 'PROMO_LIMITED_AGENT_CANDIDATE_PASSWORD', tag: 'promolimitedcand' },
  PROMO_FIXED_AGENT_CANDIDATE_EMAIL: { pw: 'PROMO_FIXED_AGENT_CANDIDATE_PASSWORD', tag: 'promofixedcand' },
};

function newAddressFor(tag) {
  const [local, domain] = INBOX.split('@');
  // A run-unique suffix: a fixed alias would already be registered after a failed attempt and
  // the change would then be refused as a duplicate.
  return `${local}+${tag}${Date.now().toString(36)}@${domain}`;
}

// Rewrites ONE key in place. Never prints the file - it holds credentials.
function writeEnvKey(key, value) {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (!re.test(text)) throw new Error(`${key} is not in .env`);
  fs.writeFileSync(ENV_PATH, text.replace(re, `${key}=${value}`));
}

async function signIn(page, email, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
}

async function canSignIn(browser, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await signIn(page, email, password);
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
    return { ok: true, landed: new URL(page.url()).pathname };
  } catch (e) {
    const text = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    return { ok: false, landed: page.url(), text };
  } finally {
    await ctx.close();
  }
}

async function migrate(browser, admin, key) {
  const { pw, tag } = FIXTURES[key];
  const oldEmail = process.env[key];
  const pwKeys = [].concat(pw);
  const password = pwKeys.map((k) => process.env[k]).find(Boolean);
  if (!oldEmail) return console.log(`${key}: not set - skipped`);
  if (!/anonaddy/i.test(oldEmail)) return console.log(`${key}: already ${oldEmail} - skipped`);
  if (!password) throw new Error(`${key}: ${pwKeys.join(' / ')} is not set, so the migrated login could not be proved`);
  const fresh = RESUME || newAddressFor(tag);
  console.log(`
${key}: ${oldEmail} -> ${fresh}${RESUME ? ' (resuming a pending change)' : ''}`);
  if (DRY) return;

  // 1. request the change (skipped when resuming one already requested)
  const baseline = RESUME ? 0 : await requestChange(admin, key, oldEmail, fresh);

  // 2. the verification mail on the bytecorp inbox
  const mail = await waitForEmail('agentEmailVerify', { to: fresh, afterUid: baseline, timeoutMs: 240000, pollMs: 6000 });
  console.log(`  verification mail: "${mail.parsed.subject}"`);
  if (!mail.link) throw new Error(`${key}: the verification mail carries no link`);
  await confirmAndPersist(browser, key, fresh, password, mail.link);
}

async function requestChange(admin, key, oldEmail, fresh) {
  const listing = new CandidatesListingPage(admin);
  await listing.goto('All');
  await listing.search(oldEmail, { tab: 'All' });
  const baseline = await latestUid({ subject: 'Verify your new Talentforge email address', to: fresh }).catch(() => 0);
  await listing.openEmailDialog(oldEmail);
  const dialog = await listing.readEmailDialog();
  if (dialog && dialog.pending) throw new Error(`${key}: an email change is already pending for ${oldEmail} - resolve it first`);
  await listing.fillNewEmail(fresh, fresh);
  const result = await listing.submitEmailUpdate();
  console.log(`  submitted: toasts=${JSON.stringify(result.toasts)} stillOpen=${result.dialogStillOpen}`);
  if (!result.submitted || result.dialogStillOpen) throw new Error(`${key}: the change was not accepted - ${result.gatedBecause || JSON.stringify(result.toasts)}`);
  return baseline;
}

async function confirmAndPersist(browser, key, fresh, password, link) {
  // 3. confirm as the recipient, in an isolated context. The SendGrid wrapper host has been seen
  //    failing DNS on this machine, so the link is retried, then resolved to the app URL directly.
  const vctx = await browser.newContext();
  const vpage = await vctx.newPage();
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    const target = i < 2 ? link : await resolveVerifyUrl(link);
    opened = await vpage.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 }).then(() => true).catch((e) => {
      console.log(`  opening the link failed (attempt ${i + 1}): ${e.message.split(String.fromCharCode(10))[0].slice(0, 120)}`);
      return false;
    });
    if (!opened) await vpage.waitForTimeout(10000);
  }
  let pinned = null;
  if (!opened) {
    // Last resort: this machine's DNS resolver has been seen failing on the SendGrid link-branding
    // host while public DNS resolves it. Resolve it via 8.8.8.8 and pin it for ONE browser.
    await vctx.close();
    const host = new URL(link).hostname;
    const resolver = new dns.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    const ip = (await resolver.resolve4(host).catch(() => []))[0];
    if (!ip) throw new Error(`${key}: ${host} does not resolve even via public DNS - re-run with --resume ${fresh}`);
    console.log(`  local DNS cannot resolve ${host}; pinning it to ${ip} (public DNS) for the verification browser`);
    pinned = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${host} ${ip}`] });
    const pctx = await pinned.newContext();
    const ppage = await pctx.newPage();
    await ppage.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await ppage.waitForTimeout(5000);
    const landing = (await ppage.innerText('body')).replace(/\s+/g, ' ').trim();
    await pinned.close();
    return finish(browser, key, fresh, password, landing);
  }
  await vpage.waitForTimeout(5000);
  const landing = (await vpage.innerText('body')).replace(/\s+/g, ' ').trim();
  await vctx.close();
  return finish(browser, key, fresh, password, landing);
}

async function finish(browser, key, fresh, password, landing) {
  console.log(`  verification page: ${landing.slice(0, 160)}`);
  if (!/confirmed|now active/i.test(landing)) throw new Error(`${key}: the verification page did not confirm the change`);

  // 4. prove the login moved with the address
  const signin = await canSignIn(browser, fresh, password);
  console.log(`  sign-in at the new address: ${signin.ok ? `OK -> ${signin.landed}` : `FAILED (${signin.text})`}`);
  if (!signin.ok) throw new Error(`${key}: the account does not sign in at ${fresh} - .env NOT updated. Its address in the app is now ${fresh}.`);

  // 5. persist
  writeEnvKey(key, fresh);
  console.log(`  .env ${key} updated`);
}

(async () => {
  const keys = (ONLY.length ? ONLY : Object.keys(FIXTURES)).filter((k) => FIXTURES[k]);
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const admin = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await signIn(admin, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
  await admin.waitForURL(/\/(agents|candidates|agents-analytics|candidate-analytics)/, { timeout: 90000 });
  const failures = [];
  for (const key of keys) {
    try { await migrate(browser, admin, key); } catch (e) { failures.push(e.message); console.log(`  ERROR ${e.message}`); }
  }
  await browser.close();
  if (failures.length) { console.log(`\n${failures.length} key(s) not migrated.`); process.exit(1); }
  console.log('\nDone.');
})().catch((e) => { console.error(e); process.exit(1); });
