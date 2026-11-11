// Read-only probe: the candidate View Profile header (.profile-basic-details) dumped element by
// element on the first candidate of each listing, beside the payload fields it should render.
// Written to settle how the location line is marked up now that the header also shows an
// "Open to <programme>" line. Opens profiles; writes nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const CandidateViewProfilePage = require('../pages/CandidateViewProfilePage');

const LISTINGS = {
  active: '/candidates/active',
  deactivated: '/candidates/deactivated',
  'requires attention': '/candidates/requires-attention',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const vp = new CandidateViewProfilePage(page);
  vp.install();
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.fill(process.env.AGENT_EMAIL);
  await login.passwordInput.fill(process.env.AGENT_PASSWORD);
  await login.submitButton.click();
  await page.waitForURL(/dashboard|candidates/, { timeout: 90000 });
  const origin = new URL(process.env.BASE_URL).origin;

  for (const [name, route] of Object.entries(LISTINGS)) {
    await page.goto(origin + route);
    await page.locator('[data-testid="agent-candidates-view-button"]').first().click({ timeout: 30000 });
    await vp.settleProfile(30000);
    const p = vp.profilePayload() || {};
    const dom = await page.locator('.profile-basic-details').evaluate((root) => {
      const rows = [];
      const walk = (el, depth) => {
        for (const c of el.children) {
          const own = [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
          rows.push(`${'  '.repeat(depth)}<${c.tagName.toLowerCase()} class="${c.className && c.className.baseVal === undefined ? c.className : ''}">${own ? ` "${own}"` : ''}`);
          if (depth < 6) walk(c, depth + 1);
        }
      };
      walk(root, 0);
      return { innerText: root.innerText.split('\n').map((s) => s.trim()).filter(Boolean), rows };
    });
    console.log(`\n===== ${name} :: ${page.url()}`);
    console.log('payload:', JSON.stringify({
      headline: p.headline,
      location: p.current_location && p.current_location.location_name,
      tamheer: p.interested_in_tamheer,
      coop: p.is_co_op_preferred,
    }));
    console.log('innerText lines:', JSON.stringify(dom.innerText.slice(0, 8)));
    console.log(dom.rows.filter((r) => !/<(svg|path|g|circle|rect)/.test(r)).slice(0, 40).join('\n'));
    console.log('readHeader():', JSON.stringify(await vp.readHeader().then((h) => ({ headline: h.headline, location: h.location }))));
  }
  await browser.close();
})();
