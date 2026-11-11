// probe-assessment-surface.js - what IS the psychometric assessment, and can it be automated?
//
// candidate_onboarding_e2e.feature scenario 2 ends with "the candidate completes the psychometric
// assessment" and then expects the candidate to move from Candidates > In Progress to Active.
// Nothing in the suite supports an assessment, and /assessment and /psychometric both render an
// empty body - so this drives the real candidate to /getting-started and dumps whatever the app
// offers, plus how the AGENT's In Progress row describes the same candidate.
//
// Read-only on the agent side. On the candidate side it SKIPS onboarding (leaving the profile
// incomplete) rather than completing it, so the pre-completion status is observable too.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const OnboardingPage = require('../pages/OnboardingPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const line = console.log;

const EMAIL = process.argv[2];
const PW = process.env.SIGNUP_PASSWORD || 'StrongPass123!';
if (!EMAIL) { line('usage: node scripts/probe-assessment-surface.js <candidate-email>'); process.exit(1); }

async function body(page) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, ' | ');
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---- candidate side ----
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cp = await cctx.newPage();
  try {
    const login = new LoginPage(cp);
    await login.navigate();
    await login.emailInput.first().fill(EMAIL);
    await login.passwordInput.first().fill(PW);
    await login.submitButton.first().click();
    await cp.waitForURL(/onboarding|getting-started|dashboard/, { timeout: 90000, waitUntil: 'commit' });
    await cp.waitForTimeout(4000);
    line(`after login: ${cp.url()}`);

    if (/\/onboarding/.test(cp.url())) {
      const onb = new OnboardingPage(cp);
      line('skipping the 6 onboarding steps...');
      await onb.skipAllSteps().catch((e) => line('  skipAllSteps: ' + e.message.split('\n')[0]));
      await cp.waitForTimeout(4000);
    }
    line(`\n===== /getting-started =====\n${(await body(cp)).slice(0, 1800)}`);

    line('\n===== every visible CTA there =====');
    const b = cp.locator('button, a[href]');
    for (let i = 0; i < await b.count(); i++) {
      const el = b.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const info = await el.evaluate((e) => ({
        tag: e.tagName, text: (e.innerText || '').trim().slice(0, 50),
        href: e.getAttribute('href'), testid: e.getAttribute('data-testid'),
      }));
      if (info.text) line('  ' + JSON.stringify(info));
    }

    // Follow the assessment CTA if there is one, and dump what it opens.
    const cta = cp.getByRole('button', { name: /assessment|start test|take.*test|psychometric/i })
      .or(cp.getByRole('link', { name: /assessment|start test|take.*test|psychometric/i })).first();
    if (await cta.count() && await cta.isVisible().catch(() => false)) {
      line(`\n>>> assessment CTA found: ${JSON.stringify((await cta.innerText()).trim())} - opening it`);
      await cta.click();
      await cp.waitForTimeout(6000);
      line(`  url: ${cp.url()}`);
      line(`  body:\n${(await body(cp)).slice(0, 2500)}`);
    } else {
      line('\n>>> NO assessment CTA is offered on /getting-started');
    }
  } catch (e) { line('CANDIDATE ERR ' + e.message); }
  finally { await cctx.close(); }

  // ---- agent side: how is this candidate described? ----
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await actx.newPage();
  try {
    const ip = new InProgressCandidatePage(ap);
    ip.install();
    const login = new LoginPage(ap);
    await login.navigate();
    await login.emailInput.first().fill(process.env.AGENT_EMAIL);
    await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
    await login.submitButton.first().click();
    await ap.waitForURL(/dashboard|candidates/, { timeout: 60000, waitUntil: 'commit' });
    await ip.navigate();
    await ap.waitForTimeout(2500);
    await ip.search(EMAIL).catch(async () => { await ip.searchInput.fill(EMAIL); await ap.waitForTimeout(3000); });
    await ap.waitForTimeout(3500);
    line('\n===== agent In Progress row for this candidate =====');
    line(JSON.stringify(await ip.readRows(), null, 1).slice(0, 1500));
    const raw = ip.lastRows && ip.lastRows();
    line('\n===== the API payload behind it =====');
    line(JSON.stringify(raw, null, 1).slice(0, 2000));
  } catch (e) { line('AGENT ERR ' + e.message); }
  finally { await actx.close(); }

  await browser.close();
})();
