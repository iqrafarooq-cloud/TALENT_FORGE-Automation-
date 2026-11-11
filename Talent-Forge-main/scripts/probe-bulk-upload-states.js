// Probe: what the bulk upload zone does after a file is set. Read-only: it NEVER clicks Send
// Invites, so no invitation is sent. Uploads a valid CSV, an unsupported type, an oversized file
// and a malformed one, dumping the zone's rendered text + control state after each.
const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulkprobe-'));

function write(name, content) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== 'true' });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await page.goto(new URL('/login', BASE).href, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.AGENT_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.AGENT_PASSWORD);
    await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
    await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
    await page.goto(new URL('/candidates/in-progress', BASE).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    async function openModal() {
      await page.locator('[data-testid="agent-invite-candidate-button"]')
        .or(page.getByRole('button', { name: /^\+?\s*invite candidate$/i })).first().click();
      await page.waitForTimeout(1200);
      const card = page.locator('[data-testid="agent-send-onboarding-invite-option"]').first();
      if (await card.isVisible().catch(() => false)) await card.click();
      await page.waitForTimeout(1500);
    }
    async function closeModal() {
      const d = page.locator('[role="dialog"]').last();
      await d.locator('button[aria-label="Close"]').first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    }

    async function state(label) {
      const d = page.locator('[role="dialog"]').last();
      const zone = d.locator('[data-testid="agent-invite-csv-dropzone"]');
      const text = await zone.innerText().catch(() => '(no zone)');
      const send = d.locator('[data-testid="agent-send-invites-button"]');
      const disabled = await send.isDisabled().catch(() => null);
      const modalText = await d.innerText().catch(() => '');
      console.log(`\n########## ${label} ##########`);
      console.log('--- zone text ---\n' + text);
      const extra = modalText.replace(text, '').trim();
      console.log('--- rest of modal ---\n' + extra);
      console.log('--- sendDisabled:', disabled);
      console.log('--- zone buttons ---');
      console.log(JSON.stringify(await zone.locator('button, a').evaluateAll((els) => els.map((e) => ({
        text: (e.innerText || '').trim().slice(0, 40), aria: e.getAttribute('aria-label'), testid: e.getAttribute('data-testid'),
      }))), null, 2));
    }

    async function removeFile() {
      const d = page.locator('[role="dialog"]').last();
      const del = d.locator('[data-testid="agent-invite-csv-dropzone"] button[aria-label="Delete"]').first();
      if (await del.isVisible().catch(() => false)) { await del.click(); await page.waitForTimeout(1200); }
    }
    async function setFile(p) {
      const d = page.locator('[role="dialog"]').last();
      if (!(await d.locator('input[type="file"]').count())) await removeFile();
      await d.locator('input[type="file"]').first().setInputFiles(p, { timeout: 15000 });
      const zone = d.locator('[data-testid="agent-invite-csv-dropzone"]');
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const t = await zone.innerText().catch(() => '');
        if (!/%|remaining/i.test(t)) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1200);
    }

    const goodCsv = write('good.csv', 'emails\nbulk.probe1@bytecorp.io\nbulk.probe2@bytecorp.io\n');
    const pdf = write('bad.pdf', '%PDF-1.4\n% probe\n');
    const bigCsv = write('big.csv', 'emails\n' + 'a@b.io\n'.repeat(20) + 'x'.repeat(11 * 1024 * 1024));
    const emptyCsv = write('empty.csv', 'emails\n');
    const badRows = write('malformed.csv', 'emails\nnot-an-email\nalso bad\n');
    const mixed = write('mixed.csv', 'emails\nm1@bytecorp.io\nnope\nm2@bytecorp.io\nbad@\nm3@bytecorp.io\n');
    const fakeCsv = write('fake.csv', '\x00\x01\x02binary rubbish not csv\xff\xfe');

    await openModal();
    await state('BASELINE (nothing uploaded)');
    await setFile(goodCsv);
    await state('AFTER valid CSV');

    // try removing
    const d = page.locator('[role="dialog"]').last();
    const remove = d.locator('button[aria-label*="remove" i], button[aria-label*="delete" i], button[aria-label*="close" i]').last();
    console.log('\n=== remove candidates found:', await d.locator('[data-testid="agent-invite-csv-dropzone"] button').count());

    await removeFile(); await state('AFTER removing the file');
    await setFile(pdf);
    await state('AFTER .pdf');
    await removeFile();
    await setFile(bigCsv);
    await state('AFTER 11MB csv');
    await removeFile();
    await setFile(emptyCsv);
    await state('AFTER empty csv (header only)');
    await removeFile();
    await setFile(badRows);
    await state('AFTER all-malformed csv');
    await removeFile();
    await setFile(fakeCsv);
    await state('AFTER fake.csv (binary content)');
    await removeFile();
    await setFile(mixed);
    await state('AFTER mixed 3 valid / 2 malformed');

    // does the chip input coexist?
    await d.locator('[data-testid="agent-invite-email-input"]').fill('overlap@university.edu');
    await d.locator('[data-testid="agent-invite-email-input"]').press('Enter');
    await page.waitForTimeout(800);
    await state('AFTER also adding a chip');
    await closeModal();
  } catch (e) {
    console.log('ERROR', e.message, e.stack);
  } finally {
    await browser.close();
  }
})();
