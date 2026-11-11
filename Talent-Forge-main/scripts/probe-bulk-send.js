// Probe: what SENDING a bulk file does. Sends an EMPTY file and an ALL-MALFORMED file only -
// neither can create a candidate - and logs the request/response so the endpoint and the error
// surface are known without spending real invitations.
const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs'); const os = require('os'); const path = require('path');
const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulksend-'));
const write = (n, c) => { const p = path.join(tmp, n); fs.writeFileSync(p, c); return p; };

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /invite|candidate|bulk|upload/i.test(r.url())) seen.push({ url: r.url(), method: r.method(), post: (r.postData() || '').slice(0, 600) }); });
  page.on('response', async (r) => {
    if (r.request().method() !== 'GET' && /invite|candidate|bulk|upload/i.test(r.url())) {
      const body = await r.text().catch(() => '(unreadable)');
      console.log('>>> RESPONSE', r.status(), r.url(), '\n', body.slice(0, 1200));
    }
  });
  try {
    await page.goto(new URL('/login', BASE).href, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
    await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });

    async function sendFile(label, file) {
      await page.goto(new URL('/candidates/in-progress', BASE).href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.locator('[data-testid="agent-invite-candidate-button"]').or(page.getByRole('button', { name: /^\+?\s*invite candidate$/i })).first().click();
      await page.waitForTimeout(1200);
      const card = page.locator('[data-testid="agent-send-onboarding-invite-option"]').first();
      if (await card.isVisible().catch(() => false)) await card.click();
      await page.waitForTimeout(1500);
      const d = page.locator('[role="dialog"]').last();
      await d.locator('input[type="file"]').first().setInputFiles(file);
      const zone = d.locator('[data-testid="agent-invite-csv-dropzone"]');
      const dl = Date.now() + 25000;
      while (Date.now() < dl) { const t = await zone.innerText().catch(() => ''); if (!/%|remaining/i.test(t)) break; await page.waitForTimeout(400); }
      console.log(`\n########## SENDING ${label} ##########`);
      seen.length = 0;
      await d.locator('[data-testid="agent-send-invites-button"]').click();
      await page.waitForTimeout(8000);
      console.log('--- requests ---\n' + JSON.stringify(seen, null, 2));
      const dialogs = page.locator('[role="dialog"]');
      const n = await dialogs.count();
      console.log('--- dialogs now:', n);
      for (let i = 0; i < n; i++) console.log(`--- dialog ${i} ---\n` + (await dialogs.nth(i).innerText().catch(() => '')));
      console.log('--- page toasts ---\n' + (await page.locator('[role="status"], [role="alert"], .Toastify, [class*="toast" i]').allInnerTexts().catch(() => [])).join(' | '));
      await page.keyboard.press('Escape').catch(() => {});
    }

    await sendFile('EMPTY csv (header only)', write('empty.csv', 'emails\n'));
    await sendFile('ALL-MALFORMED csv', write('malformed.csv', 'emails\nnot-an-email\nalso bad\n'));
    await sendFile('FAKE csv (binary content)', write('fake.csv', Buffer.from([0, 1, 2, 255, 254, 65, 66])));
  } catch (e) { console.log('ERROR', e.message); } finally { await browser.close(); }
})();
