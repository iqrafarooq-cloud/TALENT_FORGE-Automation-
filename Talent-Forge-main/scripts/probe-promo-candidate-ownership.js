// >>> THE ONE COMMAND THAT ANSWERS "why is this promo refused for its OWN candidate?" <<<
//
//   node scripts/probe-promo-candidate-ownership.js
//
// Promo redemption is OWNERSHIP-SCOPED, and EVERY invalid state - unknown, disabled, expired,
// exhausted, foreign - renders the SAME candidate-facing message and the same
// 422 ["Invalid or Expired promotion code."]. So a refusal on its own never says which one you
// are looking at, and "npm run test:promo:repair" CANNOT tell you either: it compares the promo
// code and its four parameters, and the "signed up under agent code X" line it prints is ECHOED
// FROM .env rather than verified against the app. It will report "nothing to repair" while a
// candidate fixture is orphaned.
//
// MEASURED 2026-09-09, which is why this exists: PROMO_LIMITED_AGENT_CANDIDATE_EMAIL was not a
// candidate of the limited agent at all. Its promo was Active, inside its expiry, 1 of 2 uses
// spent, the agent code in .env matched the live one, and the candidate was never-subscribed
// with zero billing rows - every parameter healthy - and the code was still refused. Two
// promo-usage scenarios failed on it and read exactly like a product defect. Raising the usage
// limit 2 -> 5 changed nothing, which is what ruled the limit out; all three candidates being
// Unverified with zero billing rows is what ruled out "this one already redeemed".
//
// The remedy is: node scripts/provision-promo-candidates.js <PREFIX> --force
//
// For each promo fixture it reports:
//   * the agent's LIVE Agent Code off its own dashboard, against .env's _REFERRAL_CODE
//   * whether that fixture's candidate appears in that agent's OWN candidate list  <-- the answer
//
// Read-only: it signs in as each agent and searches. It writes nothing and pays nothing.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const FIXTURES = ['PROMO_UNLIMITED_AGENT', 'PROMO_LIMITED_AGENT', 'PROMO_FIXED_AGENT'];
const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const problems = [];

  for (const prefix of FIXTURES) {
    const agentEmail = process.env[`${prefix}_EMAIL`];
    const agentPw = process.env[`${prefix}_PASSWORD`];
    const envCode = process.env[`${prefix}_REFERRAL_CODE`];
    const candEmail = process.env[`${prefix}_CANDIDATE_EMAIL`];
    console.log(`\n=========== ${prefix} ===========`);
    console.log('  agent:              ', agentEmail);
    console.log('  .env _REFERRAL_CODE:', envCode);
    console.log('  candidate expected: ', candEmail);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const login = new LoginPage(page);
      await login.navigate();
      await login.emailInput.first().fill(agentEmail);
      await login.passwordInput.first().fill(agentPw);
      await login.submitButton.first().click();
      await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, {
        timeout: 90000,
        waitUntil: 'commit',
      });

      // The agent's own Agent Code, off the Referral Codes section of its own dashboard. The app
      // generates it on invite acceptance and only this screen renders it, which is why
      // provision-promo-agents.js could never report it.
      await page.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const dash = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const m = dash.match(/Agent Code\s*:?\s*([A-Z0-9]{6})\b/);
      const liveCode = m ? m[1] : null;
      console.log('  LIVE Agent Code:    ', liveCode || '(not found)');
      if (liveCode && envCode && liveCode !== envCode) {
        console.log(`  >>> CODE MISMATCH: .env=${envCode} live=${liveCode}`);
        problems.push(`${prefix}: .env _REFERRAL_CODE ${envCode} but the agent's live code is ${liveCode}`);
      }

      // The question that matters: does this agent actually OWN that candidate? Searched, never
      // scanned - these lists run to many pages, so reading page 1 would report a real candidate
      // as absent.
      let found = null;
      for (const route of ['/candidates/active', '/candidates/in-progress']) {
        await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        const box = page
          .locator('[data-testid="agent-candidates-search-input"], input[type="search"]')
          .first();
        if (!(await box.count())) continue;
        await box.fill(candEmail);
        await page.waitForTimeout(3500);
        const rows = await page.$$eval(
          '[role="row"]:has([role="rowheader"]) [role="rowheader"]',
          (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
        );
        if (rows.some((r) => r.includes(candEmail))) {
          found = route;
          break;
        }
      }
      if (found) {
        console.log('  OWNERSHIP:           ok - listed on', found);
      } else {
        console.log('  OWNERSHIP:           >>> NOT A CANDIDATE OF THIS AGENT <<<');
        console.log('    Its promo will be refused with the generic "Invalid or expired');
        console.log('    promotion code" however healthy every parameter looks. Remedy:');
        console.log(`    node scripts/provision-promo-candidates.js ${prefix} --force`);
        problems.push(`${prefix}: ${candEmail} is not a candidate of that agent - promo cannot be redeemed`);
      }
    } catch (e) {
      console.log('  THREW:', e.message.split('\n')[0].slice(0, 200));
      problems.push(`${prefix}: probe threw - ${e.message.split('\n')[0].slice(0, 120)}`);
    }
    await ctx.close();
  }

  console.log('\n================ VERDICT ================');
  if (problems.length) {
    console.log(`${problems.length} fixture problem(s):`);
    for (const p of problems) console.log('  -', p);
  } else {
    console.log('Every promo agent owns its candidate and every agent code matches .env.');
    console.log('So a promo refusal is NOT an ownership problem - check status, expiry and usage');
    console.log('with `npm run test:promo:repair`.');
  }

  await browser.close();
})();
