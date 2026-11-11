// Is the Email Address field painted as INVALID after a duplicate-email refusal?
// "Red" has no absolute value to test a single render against, so this captures the
// field in three states and compares them: clean, genuinely-invalid (the app's own error
// render), and after the duplicate 422.
require('dotenv').config();
const { chromium } = require('playwright');
const InviteAgentPage = require('../pages/InviteAgentPage');
const path = require('path');

const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;
const DUPLICATE = process.env.REFERRAL_AGENT_EMAIL || 'iqra.farooq+refagent@bytecorp.io';
const UNIVERSITY = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';
const line = console.log;

async function fieldState(invite, label) {
  const el = invite.field('Email Address');
  const style = await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return {
      ariaInvalid: n.getAttribute('aria-invalid'),
      dataInvalid: n.getAttribute('data-invalid'),
      required: n.getAttribute('aria-required'),
      className: (n.className || '').toString(),
      borderColor: cs.borderColor,
      borderTopColor: cs.borderTopColor,
      outlineColor: cs.outlineColor,
      color: cs.color,
      background: cs.backgroundColor,
      wrapperClass: n.closest('div') ? (n.closest('div').className || '').toString() : null,
      wrapperRing: n.closest('div') ? getComputedStyle(n.closest('div')).boxShadow : null,
      peerRing: (() => { const other = document.querySelector('input[placeholder="e.g. Alex"]'); return other && other.closest('div') ? getComputedStyle(other.closest('div')).boxShadow : null; })(),
    };
  });
  const inline = await invite.errorFor('Email Address');
  line(`\n--- ${label} ---`);
  line(`  inline error : ${JSON.stringify(inline)}`);
  line(`  aria-invalid : ${JSON.stringify(style.ariaInvalid)}   data-invalid: ${JSON.stringify(style.dataInvalid)}`);
  line(`  borderColor  : ${style.borderTopColor}`);
  line(`  wrapper ring : ${style.wrapperRing}`);
  line(`  FirstName ring: ${style.peerRing}`);
  line(`  class        : ${style.className}`);
  line(`  wrapperClass : ${style.wrapperClass}`);
  return { label, inline, ...style };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const responses = [];
  page.on('response', async (r) => {
    if (!/\/admin\/invite\/agent\/?$/.test(new URL(r.url()).pathname)) return;
    responses.push({ status: r.status(), body: await r.text().catch(() => '?') });
  });

  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);

    const invite = new InviteAgentPage(page);
    await invite.goto();

    // 1. clean
    const clean = await fieldState(invite, 'CLEAN (untouched)');

    // 2. the app's OWN error render, for comparison
    await invite.enter('Email Address', 'not-an-email');
    await invite.blur('Email Address');
    await page.waitForTimeout(800);
    const invalid = await fieldState(invite, 'INVALID EMAIL (app error render)');

    // 3. after the duplicate 422
    await invite.enter('Email Address', '');
    await invite.fillValidDetails({
      firstName: 'Dup', lastName: 'Check', email: DUPLICATE, university: UNIVERSITY, target: '5',
    });
    await invite.submitButton.click();
    await page.waitForTimeout(3000);
    const dup = await fieldState(invite, 'AFTER DUPLICATE 422');

    line(`\ntoasts: ${JSON.stringify(await invite.toastMessages())}`);
    line(`responses: ${JSON.stringify(responses)}`);
    line(`\n===== VERDICT =====`);
    line(`  duplicate ring === clean ring       : ${dup.wrapperRing === clean.wrapperRing}`);
  line(`  duplicate ring === invalid ring     : ${dup.wrapperRing === invalid.wrapperRing}`);
  line(`  duplicate ring === FirstName ring   : ${dup.wrapperRing === dup.peerRing}`);
  line(`  invalid  ring === FirstName ring    : ${invalid.wrapperRing === invalid.peerRing}`);
  line(`  duplicate border === clean border   : ${dup.borderTopColor === clean.borderTopColor}`);
    line(`  duplicate border === invalid border : ${dup.borderTopColor === invalid.borderTopColor}`);
    line(`  duplicate aria-invalid              : ${JSON.stringify(dup.ariaInvalid)} (invalid render was ${JSON.stringify(invalid.ariaInvalid)})`);
    line(`  duplicate inline error              : ${JSON.stringify(dup.inline)}`);
    await page.screenshot({ path: 'reports/probe-invite-duplicate-field-state.png', fullPage: true });
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
