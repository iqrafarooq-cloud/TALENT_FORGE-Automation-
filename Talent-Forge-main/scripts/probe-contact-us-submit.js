// SUBMITS ONE REAL CONTACT-US REQUEST. Run deliberately - it raises a real support
// request against the candidate's assigned agent and CANNOT be withdrawn from the UI.
// Captures the endpoint, the payload, the response, the success surface, and then
// sweeps the mailbox for whatever mail it produced (by BODY, not by a guessed subject).
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const J = (o) => JSON.stringify(o, null, 1);
const MARK = `AUTOMATION PROBE ${Date.now()}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const posts = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /api\/v1/.test(r.url())) posts.push({ url: r.url(), method: r.method(), headers: Object.keys(r.headers()), body: (r.postData() || '').slice(0, 1500) }); });
  page.on('response', async (r) => { if (r.request().method() !== 'GET' && /api\/v1/.test(r.url()) && !/token/.test(r.url())) console.log('RESPONSE', r.status(), r.url(), (await r.text().catch(() => '')).slice(0, 500)); });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.CONTACTUS_EMAIL);
  await login.passwordInput.first().fill(process.env.CONTACTUS_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  const burger = page.getByRole('button', { name: /open menu/i });
  if (await burger.count()) { await burger.click(); await page.waitForTimeout(600); }
  await page.locator('nav button, aside button').filter({ hasText: 'Contact Us' }).first().click();
  await page.waitForTimeout(1200);
  let m = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();

  await m.locator('button').nth(1).click(); await page.waitForTimeout(400);
  await page.locator('[role="option"][id$="option-technicalIssue"]').click(); await page.waitForTimeout(900);
  m = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
  await m.locator('button').nth(2).click(); await page.waitForTimeout(400);
  await page.locator('[role="option"]').filter({ hasText: 'Page not loading' }).first().click(); await page.waitForTimeout(700);
  m = page.locator('[role="dialog"]').filter({ hasText: 'Need help?' }).first();
  await m.locator('textarea').fill(`${MARK} - ignore. Automated end-to-end check of the Contact Us form.`);
  await page.waitForTimeout(500);

  console.log('=== submitting ===', MARK);
  await m.locator('button[type="submit"]').click();
  await page.waitForTimeout(6000);

  console.log('\n=== POST(s) made ===');
  console.log(J(posts.filter((p) => !/token/.test(p.url))));
  console.log('\n=== success surface ===');
  console.log('dialogs on screen:', J(await page.locator('[role="dialog"]').evaluateAll((d) => d.map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300)))));
  console.log('alerts/toasts:', J(await page.locator('[role="alert"], .Toastify, [class*="toast" i]').evaluateAll((d) => d.map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))));
  await page.screenshot({ path: 'reports/probe-contact-us-submitted.png', fullPage: true });
  await browser.close();

  console.log('\n=== mailbox sweep (last 40 messages, unfiltered) ===');
  const client = new ImapFlow({ host: process.env.IMAP_HOST, port: 993, secure: true, auth: { user: process.env.MAILBOX_EMAIL, pass: process.env.MAILBOX_PASSWORD }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const total = client.mailbox.exists;
    for await (const msg of client.fetch(`${Math.max(1, total - 39)}:*`, { envelope: true, source: true })) {
      const parsed = await simpleParser(msg.source);
      const body = `${parsed.text || ''}`;
      const hit = body.includes(MARK) || /contact us|support request|help request|new request/i.test(parsed.subject || '');
      if (hit) {
        console.log(`\n--- uid ${msg.uid} | ${parsed.date && parsed.date.toISOString()} ---`);
        console.log('SUBJECT :', parsed.subject);
        console.log('FROM    :', parsed.from && parsed.from.text);
        console.log('TO      :', parsed.to && parsed.to.text);
        console.log('MARKED  :', body.includes(MARK));
        console.log('BODY    :', body.replace(/\n{2,}/g, '\n').slice(0, 1200));
      }
    }
    console.log('\n(recent subjects for context)');
    for await (const msg of client.fetch(`${Math.max(1, total - 14)}:*`, { envelope: true })) {
      console.log(msg.uid, '|', msg.envelope.date && msg.envelope.date.toISOString(), '|', msg.envelope.subject, '| to:', (msg.envelope.to || []).map((a) => a.address).join(','));
    }
  } finally { lock.release(); await client.logout(); }
})();
