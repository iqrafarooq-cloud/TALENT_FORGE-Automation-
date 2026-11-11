// probe-subscription-gaps.js — verify the app's real behaviour for the Subscription
// scenarios that are not automated yet, so assertions are written against observed
// copy/DOM rather than assumptions. Dev-only utility.
//
//   node scripts/probe-subscription-gaps.js
//
// Checks:
//   1. GATEWAY ERROR  — abort POST /payments/paytabs/initiate/ and capture the toast
//   2. NON-PAID ROWS  — are Pending/Canceled receipt actions really disabled (unmocked)?
//   3. INVOICE BACK   — where does the invoice "Back" button go?
//   4. EMAIL FORMAT   — what does an invalid email on the invoice produce?
//   5. VALID PROMO    — does TEST200 recalculate the INITIAL invoice totals?
//   6. RECEIPT ZOOM   — does zoom in/out actually change the rendered document?
//   7. CHANGE PLAN    — does the modal's Cancel button close it?
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const SubscriptionPage = require('../pages/SubscriptionPage');

const EMAIL = process.env.CANDIDATE_EMAIL;
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

const line = (t) => console.log(`\n=============== ${t} ===============`);

async function login(page) {
  const l = new LoginPage(page);
  await l.navigate();
  await l.emailInput.first().fill(EMAIL);
  await l.passwordInput.first().fill(PASSWORD);
  await l.submitButton.first().click();
  await page.waitForURL(/\/getting-started|\/dashboard|\/profile|\/my-track/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sub = new SubscriptionPage(page);

  try {
    await login(page);

    // ---------- 1. Gateway connection error ----------
    line('1. GATEWAY ERROR (initiate aborted)');
    await sub.gotoCheckout('Monthly');
    let aborted = 0;
    await page.route('**/payments/paytabs/initiate/**', async (route) => {
      aborted++;
      await route.abort('connectionfailed');
    });
    const before = page.url();
    await sub.continueButton.click();
    await page.waitForTimeout(6000);
    console.log(`aborted calls: ${aborted}`);
    console.log(`url before: ${before}`);
    console.log(`url after : ${page.url()}`);
    const bodyTxt = (await page.locator('body').innerText().catch(() => '')) || '';
    // Show any line that reads like a toast/error.
    const errLines = bodyTxt
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /went wrong|connection|try again|error|failed|unsuccessful/i.test(s));
    console.log(`error-ish lines: ${JSON.stringify(errLines)}`);
    // notistack renders toasts in a container; dump it directly.
    const toast = await page
      .locator('[class*="notistack"], [role="alert"], [class*="Toast"], [class*="toast"]')
      .allInnerTexts()
      .catch(() => []);
    console.log(`toast containers: ${JSON.stringify(toast.map((t) => t.replace(/\s+/g, ' ').trim()))}`);
    console.log(`Continue still visible: ${await sub.continueButton.isVisible().catch(() => false)}`);
    await page.unroute('**/payments/paytabs/initiate/**');

    // ---------- 3. Invoice Back ----------
    line('3. INVOICE BACK BUTTON');
    await sub.gotoCheckout('Monthly');
    await sub.backButton.click();
    await page.waitForTimeout(3000);
    console.log(`after Back, url = ${page.url()}`);

    // ---------- 4. Invalid email format on the invoice ----------
    line('4. INVALID EMAIL FORMAT');
    await sub.gotoCheckout('Monthly');
    for (const bad of ['notanemail', 'a@b', 'a@b.']) {
      await sub.emailInput.fill(bad);
      await sub.firstNameInput.click(); // blur
      await page.waitForTimeout(800);
      const enabled = await sub.continueButton.isEnabled().catch(() => null);
      const txt = (await page.locator('body').innerText().catch(() => '')) || '';
      const errs = txt
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => /email/i.test(s) && /valid|invalid|required|format/i.test(s));
      console.log(`  "${bad}" -> Continue ${enabled ? 'ENABLED' : 'disabled'}; errors ${JSON.stringify(errs)}`);
    }

    // ---------- 5. Valid promo on the INITIAL invoice ----------
    line('5. VALID PROMO TEST200 ON INITIAL INVOICE');
    await sub.gotoCheckout('Monthly');
    const readRow = async (label) => {
      const el = page.getByText(new RegExp(`^${label}$`, 'i')).first();
      const parent = el.locator('xpath=..');
      return ((await parent.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    };
    console.log(`  before: ${await readRow('Subtotal')} | ${await readRow('Total due today')}`);
    await sub.applyPromo('TEST200');
    await page.waitForTimeout(4000);
    console.log(`  after : ${await readRow('Subtotal')} | ${await readRow('Total due today')}`);
    console.log(`  Remove visible: ${await sub.promoRemoveButton.isVisible().catch(() => false)}`);
    console.log(`  promo error visible: ${await sub.promoError.isVisible().catch(() => false)}`);
    const invTxt = (await page.locator('body').innerText().catch(() => '')) || '';
    console.log(
      `  discount-ish lines: ${JSON.stringify(
        invTxt.split('\n').map((s) => s.trim()).filter((s) => /discount|off|promo|credit/i.test(s))
      )}`
    );

    // ---------- 2 + 6 + 7. Subscription tab bits ----------
    line('2. NON-PAID ROW ACTIONS (unmocked, real statuses)');
    await sub.gotoSubscriptionTab();
    await page.waitForTimeout(3000);
    const rows = sub.billingRows;
    const nRows = await rows.count();
    for (let i = 0; i < nRows; i++) {
      const row = rows.nth(i);
      const cells = await row.locator('[role="gridcell"]').allInnerTexts().catch(() => []);
      const status = (cells[2] || '').replace(/\s+/g, ' ').trim();
      const acts = row.locator('button, a');
      const m = await acts.count();
      const st = [];
      for (let j = 0; j < m; j++) {
        const a = acts.nth(j);
        const name = (await a.getAttribute('aria-label')) || (await a.innerText().catch(() => '')) || '?';
        st.push(`${name.trim() || '?'}=${(await a.isEnabled().catch(() => null)) ? 'ENABLED' : 'disabled'}`);
      }
      console.log(`  row ${i} status="${status}" -> ${st.join(', ') || '(no actions)'}`);
    }

    line('6. RECEIPT ZOOM CONTROLS');
    await sub.openFirstPaidReceipt();
    const docSel = '[role="dialog"] canvas, [role="dialog"] .react-pdf__Page, [role="dialog"] iframe, [role="dialog"] embed, [role="dialog"] object';
    const dims = async () => {
      const el = page.locator(docSel).first();
      if (!(await el.count())) return '(no document element)';
      const box = await el.boundingBox().catch(() => null);
      const style = (await el.getAttribute('style')) || '';
      return `box=${box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'null'} style="${style.slice(0, 120)}"`;
    };
    console.log(`  initial : ${await dims()}`);
    const zoomTxt = await page.locator('[role="dialog"]').first().innerText().catch(() => '');
    console.log(`  modal text: ${JSON.stringify(zoomTxt.replace(/\s+/g, ' ').trim().slice(0, 400))}`);
    await sub.receiptZoomIn.click();
    await page.waitForTimeout(1500);
    console.log(`  zoom in : ${await dims()}`);
    await sub.receiptZoomIn.click();
    await page.waitForTimeout(1500);
    console.log(`  zoom in2: ${await dims()}`);
    await sub.receiptZoomOut.click();
    await page.waitForTimeout(1500);
    console.log(`  zoom out: ${await dims()}`);
    // Any percentage indicator?
    const pct = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).match(/\d+\s*%/g);
    console.log(`  zoom % indicators: ${JSON.stringify(pct)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    line('7. CHANGE PLAN MODAL CANCEL');
    await sub.gotoSubscriptionTab();
    await sub.openChangePlan();
    const opts = await sub.changePlanOptions.allInnerTexts().catch(() => []);
    console.log(`  offered options: ${JSON.stringify(opts.map((o) => o.replace(/\s+/g, ' ').trim()))}`);
    console.log(`  Cancel visible: ${await sub.changePlanCancel.isVisible().catch(() => false)}`);
    await sub.changePlanCancel.click();
    await page.waitForTimeout(1500);
    console.log(`  modal hidden after Cancel: ${await sub.changePlanModal.isHidden().catch(() => null)}`);
    console.log(`  still on subscription tab: ${/selectedTab=subscription/.test(page.url())}`);
    console.log(`  state: ${await sub.currentState()}`);
  } catch (e) {
    console.error('PROBE ERROR:', e.message, e.stack);
  } finally {
    await browser.close();
  }
})();
