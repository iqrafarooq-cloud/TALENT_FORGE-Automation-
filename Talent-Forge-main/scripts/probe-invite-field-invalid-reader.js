// NEGATIVE CONTROL for `the "<field>" field should not be marked as invalid`.
// A reader that cannot fail is worse than none, so this runs the STEP'S OWN reader
// (InviteAgentPage.fieldErrorState) against the app's genuine error render and against the
// duplicate-email refusal, and prints what the step would conclude in each.
require('dotenv').config();
const { chromium } = require('playwright');
const InviteAgentPage = require('../pages/InviteAgentPage');

const DUPLICATE = process.env.REFERRAL_AGENT_EMAIL || 'iqra.farooq+refagent@bytecorp.io';
const UNIVERSITY = process.env.INVITE_AGENT_UNIVERSITY || 'King Saud University';
const line = console.log;

// The exact predicate the step applies.
function verdict(state) {
  const problems = [];
  if (state.inlineError) problems.push(`inline error "${state.inlineError}"`);
  if (state.ariaInvalid) problems.push('aria-invalid=true');
  if (state.ringDiffersFromControl) problems.push(`ring ${state.ring.match(/rgb\([^)]*\)(?=\s+0px 0px 0px 1px inset)/) || '?'} vs control ${state.controlRing.match(/rgb\([^)]*\)(?=\s+0px 0px 0px 1px inset)/) || '?'}`);
  return problems;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
    await page.waitForTimeout(2500);

    const invite = new InviteAgentPage(page);
    await invite.goto();

    await invite.enter('Email Address', 'not-an-email');
    await invite.blur('Email Address');
    await page.waitForTimeout(800);
    const bad = verdict(await invite.fieldErrorState('Email Address'));
    line(`\nA) app's own INVALID render  -> step ${bad.length ? 'FAILS' : 'PASSES'}: ${JSON.stringify(bad)}`);

    await invite.enter('Email Address', '');
    await invite.fillValidDetails({ firstName: 'Dup', lastName: 'Check', email: DUPLICATE, university: UNIVERSITY, target: '5' });
    await invite.submitButton.click();
    await page.waitForTimeout(3000);
    const dup = verdict(await invite.fieldErrorState('Email Address'));
    line(`B) after the duplicate 422   -> step ${dup.length ? 'FAILS' : 'PASSES'}: ${JSON.stringify(dup)}`);
    line(`\nreader discriminates the two states: ${(bad.length > 0) && (dup.length === 0)}`);
  } catch (e) { line('ERR ' + e.stack); }
  finally { await ctx.close(); await browser.close(); }
})();
