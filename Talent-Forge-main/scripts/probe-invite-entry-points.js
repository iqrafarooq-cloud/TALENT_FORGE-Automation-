// Read-only probe of every documented entry point into the candidate invitation flow.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const P = require('../pages/CandidateOnboardingPage');

async function run(email, password, label) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, { timeout: 60000, waitUntil: 'commit' });
  const ob = new P(page);
  console.log(`\n########## ${label} (${email}) ##########`);

  await ob.gotoDashboard().catch(()=>{});
  await page.waitForTimeout(3000);
  await ob.dismissOpenModal().catch(()=>{});
  await page.waitForTimeout(500);
  const dashButtons = await page.getByRole('button').evaluateAll(e => e.map(b => (b.innerText||'').trim()).filter(Boolean));
  console.log('DASHBOARD buttons:', JSON.stringify([...new Set(dashButtons)]));
  console.log('DASHBOARD "Invite" texts:', JSON.stringify(await page.getByText(/invite/i).allInnerTexts().catch(()=>[])));

  await page.goto(new URL('/candidates/in-progress', process.env.BASE_URL).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const ipButtons = await page.getByRole('button').evaluateAll(e => e.map(b => (b.innerText||'').trim()).filter(Boolean));
  console.log('IN PROGRESS buttons:', JSON.stringify([...new Set(ipButtons)]));
  console.log('IN PROGRESS body sample:', (await page.locator('main').innerText().catch(()=> '')).replace(/\n+/g,' | ').slice(0, 900));
  await browser.close();
}

(async () => {
  await run(process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD, 'AGENT_EMAIL (has candidates)');
  await run(process.env.NO_CANDIDATE_AGENT_EMAIL, process.env.NO_CANDIDATE_AGENT_PASSWORD, 'NO_CANDIDATE_AGENT (zero)');
})().catch(e => { console.error('PROBE FAILED', e); process.exit(1); });
