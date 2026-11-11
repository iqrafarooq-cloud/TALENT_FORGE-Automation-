// Probe: xls/xlsx acceptance, drag-and-drop, and WHERE the server's 422 refusal surfaces.
const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs'); const os = require('os'); const path = require('path');
const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulkfmt-'));
const write = (n, c) => { const p = path.join(tmp, n); fs.writeFileSync(p, c); return p; };

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const page = await (await browser.newContext()).newPage();
  try {
    await page.goto(new URL('/login', BASE).href, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
    await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
    await page.goto(new URL('/candidates/in-progress', BASE).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.locator('[data-testid="agent-invite-candidate-button"]').or(page.getByRole('button', { name: /invite candidate/i })).first().click({ timeout: 60000 });
    await page.waitForTimeout(1200);
    const card = page.locator('[data-testid="agent-send-onboarding-invite-option"]').first();
    if (await card.isVisible().catch(() => false)) await card.click();
    await page.waitForTimeout(1500);
    const d = page.locator('[role="dialog"]').last();
    const zone = d.locator('[data-testid="agent-invite-csv-dropzone"]');
    const send = d.locator('[data-testid="agent-send-invites-button"]');

    async function settle() {
      const dl = Date.now() + 20000;
      while (Date.now() < dl) { const t = await zone.innerText().catch(() => ''); if (!/%|remaining/i.test(t)) break; await page.waitForTimeout(400); }
      await page.waitForTimeout(600);
    }
    async function remove() {
      const del = zone.locator('button[aria-label="Delete"]').first();
      if (await del.isVisible().catch(() => false)) { await del.click(); await page.waitForTimeout(1000); }
    }
    async function report(label) {
      const t = await zone.innerText();
      console.log(`\n### ${label}\n  sendDisabled=${await send.isDisabled()}\n  fileNameShown=${JSON.stringify((t.match(/\n\n(\S+\.(?:csv|xls|xlsx|pdf|txt|docx|png|json|zip|exe))\n/i)||[])[1]||null)}\n  errorish=${JSON.stringify(t.split('\n').filter((l)=>/not allowed|too large|invalid|error|must|only/i.test(l)))}`);
    }

    for (const [name, content] of [['a.csv','emails\nx1@bytecorp.io\n'], ['a.xlsx','PK\x03\x04fake'], ['a.xls','\xd0\xcf\x11\xe0fake'], ['a.txt','emails\nx@y.io'], ['a.docx','PK\x03\x04doc'], ['a.png','\x89PNG\r\n'], ['a.json','{}'], ['a.zip','PK\x03\x04'], ['a.exe','MZ']]) {
      await remove();
      await d.locator('input[type="file"]').first().setInputFiles(write(name, content));
      await settle();
      await report(name);
    }

    // ---- drag and drop ----
    await remove();
    const dropTarget = zone.locator('[data-dropzone="true"]').first();
    const buf = fs.readFileSync(write('drag.csv', 'emails\ndrag1@bytecorp.io\n'));
    const dt = await page.evaluateHandle(({ name, b64, type }) => {
      const dt = new DataTransfer();
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      dt.items.add(new File([arr], name, { type }));
      return dt;
    }, { name: 'drag.csv', b64: buf.toString('base64'), type: 'text/csv' });
    await dropTarget.dispatchEvent('dragenter', { dataTransfer: dt });
    await dropTarget.dispatchEvent('dragover', { dataTransfer: dt });
    await dropTarget.dispatchEvent('drop', { dataTransfer: dt });
    await settle();
    await report('DRAG AND DROP drag.csv');

    // ---- server 422 surface ----
    await remove();
    await d.locator('input[type="file"]').first().setInputFiles(write('fake.csv', Buffer.from([0,1,2,255,254,65])));
    await settle();
    const posted = page.waitForResponse((r) => /bulk\/file/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await send.click();
    const resp = await posted;
    console.log('\n### 422 SURFACE  status=', resp && resp.status());
    for (const ms of [300, 900, 2000, 4000]) {
      await page.waitForTimeout(ms);
      const toasts = await page.locator('[role="status"], [role="alert"], [data-sonner-toast], .Toastify__toast, [class*="toast" i]').allInnerTexts().catch(() => []);
      console.log(`  +${ms}ms toasts=${JSON.stringify(toasts.filter(Boolean))}`);
      console.log(`  +${ms}ms modalErrors=${JSON.stringify((await d.innerText()).split('\n').filter((l)=>/not|invalid|error|fail/i.test(l)))}`);
    }
  } catch (e) { console.log('ERROR', e.message); } finally { await browser.close(); }
})();
