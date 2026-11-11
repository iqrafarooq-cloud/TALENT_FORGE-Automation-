// probe-invite-duplicate-email.js — WHERE does the invite form report an email that
// already belongs to an agent? Read-only in the sense that matters: the invite is
// REJECTED by the server, so no agent is created.
//
// Written because `Verify that inviting an existing email tells the superadmin why it
// failed` was tagged @known-issue on the strength of an INLINE-only reader. It dumps
// every surface — the API answer, every `.text-error-primary` on the form, every toast,
// and any node anywhere on the page whose text names the duplicate — so "the app says
// nothing" and "the app says it somewhere else" cannot be confused.
require('dotenv').config();
const { chromium } = require('playwright');
const InviteAgentPage = require('../pages/InviteAgentPage');

const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;
const DUPLICATE = process.env.REFERRAL_AGENT_EMAIL || 'iqra.farooq+refagent@bytecorp.io';
const UNIVERSITY = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';
const line = console.log;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const responses = [];
  page.on('response', async (r) => {
    if (!/\/admin\/invite\/agent\/?$/.test(new URL(r.url()).pathname)) return;
    responses.push({ status: r.status(), body: await r.text().catch(() => '<unreadable>') });
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
    await invite.fillValidDetails({
      firstName: 'Dup', lastName: 'Check', email: DUPLICATE, university: UNIVERSITY, target: '5',
    });
    line(`\nfilled with duplicate email: ${DUPLICATE}`);
    line(`submit enabled before click: ${await invite.submitButton.isEnabled().catch(() => null)}`);

    await invite.submitButton.click();

    // Sample repeatedly: a toast auto-closes, an inline error does not.
    for (const wait of [1000, 2000, 3000, 5000, 8000]) {
      await page.waitForTimeout(wait === 1000 ? 1000 : 1000);
      line(`\n===== t=${wait}ms =====`);
      line(`  inline errorFor("Email Address"): ${JSON.stringify(await invite.errorFor('Email Address'))}`);
      line(`  allErrors():                     ${JSON.stringify(await invite.allErrors())}`);
      line(`  toastMessages():                 ${JSON.stringify(await invite.toastMessages())}`);
      const anywhere = await page.evaluate(() =>
        Array.from(document.querySelectorAll('body *'))
          .filter((e) => e.children.length === 0 && /already exist/i.test(e.innerText || ''))
          .map((e) => ({
            text: (e.innerText || '').trim(),
            tag: e.tagName.toLowerCase(),
            cls: e.className && e.className.toString().slice(0, 90),
            rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(e.getBoundingClientRect()),
          })));
      line(`  any node naming the duplicate:   ${JSON.stringify(anywhere, null, 2)}`);
    }

    const emailRect = await invite.field('Email Address').boundingBox().catch(() => null);
    line(`\nemail input box: ${JSON.stringify(emailRect)}`);
    line(`success modal visible: ${await invite.isSuccessModalVisible().catch((e) => 'ERR ' + e.message)}`);
    line(`still on invite page: ${await invite.isOnInvitePage()}`);
    line(`\ninvite responses: ${JSON.stringify(responses, null, 2)}`);
    await page.screenshot({ path: 'reports/probe-invite-duplicate-email.png', fullPage: true });
  } catch (e) {
    line('ERR ' + e.stack);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
