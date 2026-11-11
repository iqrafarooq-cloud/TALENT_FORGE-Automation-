// probe-receipt-download.js — does the receipt viewer's in-modal Download control
// actually download a file (download event / new tab / direct navigation)? Dev-only.
//
//   node scripts/probe-receipt-download.js
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    const l = new LoginPage(page);
    await l.navigate();
    await l.emailInput.first().fill(EMAIL);
    await l.passwordInput.first().fill(PASSWORD);
    await l.submitButton.first().click();
    await page.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, { timeout: 90000, waitUntil: 'commit' });

    const sub = new SubscriptionPage(page);
    await sub.gotoSubscriptionTab();
    await sub.openFirstPaidReceipt();
    await page.waitForTimeout(3000);

    // What element is the modal's Download control — button or link?
    const modal = sub.receiptModal;
    const dlBtns = await modal.getByRole('button', { name: /download/i }).count();
    const dlLinks = await modal.getByRole('link', { name: /download/i }).count();
    console.log(`modal download: buttons=${dlBtns} links=${dlLinks}`);
    if (dlLinks) {
      console.log(`link href: ${((await modal.getByRole('link', { name: /download/i }).first().getAttribute('href')) || '').slice(0, 120)}`);
    }

    // Where does the zoom % live?
    const pctEl = modal.getByText(/^\d+%$/).first();
    console.log(`zoom % element count=${await modal.getByText(/^\d+%$/).count()} text="${await pctEl.innerText().catch(() => 'n/a')}"`);

    // Click Download and see whether a download event / popup fires.
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch((e) => `NO DOWNLOAD (${e.message.split('\n')[0]})`);
    const popup = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
    await sub.receiptDownloadButton.click();
    const got = await dl;
    if (typeof got === 'string') {
      console.log(got);
      const p = await popup;
      console.log(`popup: ${p ? p.url().slice(0, 120) : 'none'}`);
    } else {
      console.log(`download suggested filename: ${got.suggestedFilename()}`);
      const path = await got.path();
      const fs = require('fs');
      const buf = fs.readFileSync(path);
      console.log(`bytes=${buf.length} magic="${buf.slice(0, 5).toString('latin1')}"`);
    }
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
