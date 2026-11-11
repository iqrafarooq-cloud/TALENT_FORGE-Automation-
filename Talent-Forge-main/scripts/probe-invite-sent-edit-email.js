// probe-invite-sent-edit-email.js - the Invite Sent tab's Edit > Update Email Address flow, measured
// end to end on ONE throwaway agent this script invites (never accepts) and then abandons.
//
// COSTS: one superadmin invite (one "Join Talentforge" mail) + one resend to a fresh address (a
// second mail). No payment. It never touches an existing agent: every check runs on the throwaway,
// so nothing shared is ever submitted.
//
//   node scripts/probe-invite-sent-edit-email.js            # full run, commits the resend
//   node scripts/probe-invite-sent-edit-email.js --no-commit # stops before Resend Invite
require('dotenv').config();
const { chromium } = require('@playwright/test');
const AgentsListingPage = require('../pages/AgentsListingPage');
const { loginSuperadmin, inviteWithPromo } = require('../utils/promoAgentProvision');
const { waitForInviteMail, baselineInviteMail } = require('../utils/agentInviteProvision');

const COMMIT = !process.argv.includes('--no-commit');
const API = /dev-api\.talentforge\.com\.sa/;
const log = (...a) => console.log(...a);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const writes = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!API.test(r.url()) || req.method() === 'GET') return;
    let body = '';
    try { body = (await r.text()).slice(0, 400); } catch (e) { body = '(unreadable)'; }
    writes.push(`${req.method()} ${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, '')} req=${(req.postData() || '').slice(0, 300)} res=${body}`);
  });

  await loginSuperadmin(page);
  const { identity, baseline } = await inviteWithPromo(page, { promo: 'unchecked', firstName: 'Invsent', tagPrefix: 'invsent' });
  log('THROWAWAY:', identity.firstName, identity.lastName, identity.email);
  const first = await waitForInviteMail(identity.email, { afterUid: baseline, timeoutMs: 240000 });
  log('original invite mail uid', first.uid, 'to', first.to, 'temp pw present', !!first.tempPassword);

  const L = new AgentsListingPage(page);
  const nextBtn = () => L.emailDialog.getByRole('button', { name: /^(next|update)$/i }).first();
  const reopen = async () => {
    await L.goto('Invite Sent');
    await L.search(identity.email);
    await L.openEmailDialog(identity.email);
  };
  const redText = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] p,[role="dialog"] span'))
    .filter((e) => !e.children.length && /^rgb\((2\d\d|1[89]\d),/.test(getComputedStyle(e).color))
    .map((e) => e.innerText.trim()).filter((t) => t && !/^(cancel|update|next)$/i.test(t)));

  await reopen();
  const s0 = await L.readEmailDialog();
  log('\nFORM:', JSON.stringify({ heading: s0.heading, fields: s0.fields, buttons: s0.buttons, errors: s0.errors }));
  log('primary label', await nextBtn().innerText(), 'disabled', await nextBtn().isDisabled());

  const cases = [
    ['no-at', 'no-at-sign', 'no-at-sign'],
    ['no-tld', 'no@domain', 'no@domain'],
    ['spaced', 'spaced out@bytecorp.io', 'spaced out@bytecorp.io'],
    ['mismatch', 'valid.one@bytecorp.io', 'valid.two@bytecorp.io'],
    ['same-as-current', identity.email, identity.email],
    ['same-upper', identity.email.toUpperCase(), identity.email.toUpperCase()],
    ['whitespace', '   ', '   '],
    ['only-new', 'qa.only@bytecorp.io', ''],
    ['only-confirm', '', 'qa.only@bytecorp.io'],
    ['case-confirm', 'QA.Case@BYTECORP.IO', 'qa.case@bytecorp.io'],
    ['padded', '  qa.padded@bytecorp.io  ', '  qa.padded@bytecorp.io  '],
  ];
  for (const [name, a, b] of cases) {
    await L.fillNewEmail(a, b);
    const s = await L.readEmailDialog();
    log(`case ${name.padEnd(16)} next disabled=${await nextBtn().isDisabled()} errors=${JSON.stringify(s.errors)}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const existing = [
    ['existing-agent', process.env.AGENT_EMAIL],
    ['existing-agent-upper', String(process.env.AGENT_EMAIL).toUpperCase()],
    ['existing-candidate', process.env.CONTACTUS_EMAIL],
  ];
  for (const [name, addr] of existing) {
    await reopen();
    await L.fillNewEmail(addr, addr);
    log(`\n${name} ${addr}: next disabled=${await nextBtn().isDisabled()}`);
    writes.length = 0;
    const toasts = await L.captureToasts(async () => { await nextBtn().click(); }, { sampleMs: 6000 });
    const resendOpen = await L.resendDialog.isVisible().catch(() => false);
    log(`  after Next: toasts=${JSON.stringify(toasts)} editOpen=${await L.emailDialog.isVisible().catch(() => false)} resendOpen=${resendOpen} red=${JSON.stringify(await redText())}`);
    if (resendOpen) {
      log('  resend dialog:', await L.resendDialogText());
      const t2 = await L.captureToasts(async () => {
        await L.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
      }, { sampleMs: 6000 });
      log(`  after Resend Invite: toasts=${JSON.stringify(t2)} resendOpen=${await L.resendDialog.isVisible().catch(() => false)} editOpen=${await L.emailDialog.isVisible().catch(() => false)} red=${JSON.stringify(await redText())}`);
    }
    log('  writes:', writes.join('\n          ') || '(none)');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }

  const inbox = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
  const [lp, dom] = inbox.split('@');
  const fresh = `${lp}+invsentnew${Date.now().toString(36)}@${dom}`;
  for (const exit of ['Cancel', 'X', 'Escape']) {
    await reopen();
    await L.fillNewEmail(fresh, fresh);
    writes.length = 0;
    await nextBtn().click();
    await L.resendDialog.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (exit === 'Cancel') {
      log('\nRESEND DIALOG:', await L.resendDialogText().catch(() => '(not open)'));
      log('  buttons:', JSON.stringify(await L.resendDialog.locator('button').evaluateAll((bs) => bs.map((b) => b.innerText.trim() || b.getAttribute('aria-label')))));
      log('  edit modal still attached/visible while resend open:', await L.emailDialog.isVisible().catch(() => false));
      log('  writes on Next:', writes.join(' | ') || '(none)');
      await L.resendDialog.getByRole('button', { name: /^cancel$/i }).click();
    }
    if (exit === 'X') await L.resendDialog.getByRole('button', { name: /close/i }).first().click();
    if (exit === 'Escape') await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    log(`exit ${exit}: resendOpen=${await L.resendDialog.isVisible().catch(() => false)} editOpen=${await L.emailDialog.isVisible().catch(() => false)} writes=${writes.length}`);
    if (await L.emailDialog.isVisible().catch(() => false)) {
      const s = await L.readEmailDialog();
      log('  edit modal values after exit:', JSON.stringify(s.values));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
  }
  await L.goto('Invite Sent');
  const r0 = await L.search(identity.email);
  log('after exits, server row:', JSON.stringify(AgentsListingPage.agentsFrom(r0.payload).map((a) => ({ email: a.email, pending: a.pendingEmail, status: a.status }))));

  if (!COMMIT) { await browser.close(); return; }
  await reopen();
  await L.fillNewEmail(fresh, fresh);
  await nextBtn().click();
  await L.resendDialog.waitFor({ state: 'visible', timeout: 15000 });
  const base2 = await baselineInviteMail(fresh);
  writes.length = 0;
  const toasts = await L.captureToasts(async () => {
    await L.resendDialog.getByRole('button', { name: /^resend invite$/i }).click();
  }, { sampleMs: 7000 });
  log('\nCOMMIT toasts:', JSON.stringify(toasts), 'resendOpen', await L.resendDialog.isVisible().catch(() => false));
  log('  writes:', writes.join('\n          '));
  for (const tab of ['Invite Sent', 'Active']) {
    await L.goto(tab);
    const a = await L.search(fresh);
    const aRows = AgentsListingPage.agentsFrom(a.payload).map((x) => ({ e: x.email, p: x.pendingEmail, s: x.status }));
    const rowState = await L.readRowEmailState(fresh).catch((e) => e.message);
    const b = await L.search(identity.email);
    const bRows = AgentsListingPage.agentsFrom(b.payload).map((x) => ({ e: x.email, p: x.pendingEmail }));
    log(`  ${tab}: by new=${JSON.stringify(aRows)} row=${JSON.stringify(rowState)} by old=${JSON.stringify(bRows)}`);
  }
  const mail = await waitForInviteMail(fresh, { afterUid: base2, timeoutMs: 240000 }).catch((e) => ({ error: e.message }));
  log('  new invite mail:', JSON.stringify({ uid: mail.uid, to: mail.to, subject: mail.subject, tempPw: !!mail.tempPassword, cta: mail.hasSignInCta, error: mail.error }));
  log('  same temp password as original?', mail.tempPassword === first.tempPassword);
  log(`\nCREDS: old=${identity.email} / ${first.tempPassword}   new=${fresh} / ${mail.tempPassword}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
