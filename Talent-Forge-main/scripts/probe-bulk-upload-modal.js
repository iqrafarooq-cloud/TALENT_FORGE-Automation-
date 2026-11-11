// Probe: the Invite via Email modal's BULK UPLOAD zone. Read-only - opens the modal, dumps its
// HTML and every control, clicks Download Template and reports the download, then walks away.
// Never sends an invite.
const { chromium } = require('playwright');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';

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
    await page.locator('[data-testid="agent-invite-candidate-button"]')
      .or(page.getByRole('button', { name: /^\+?\s*invite candidate$/i })).first().click();
    await page.waitForTimeout(1500);
    // chooser -> Invite via Email
    const card = page.locator('[data-testid="agent-send-onboarding-invite-option"]').first();
    if (await card.isVisible().catch(() => false)) await card.click();
    await page.waitForTimeout(2000);

    const dialogs = page.locator('[role="dialog"]');
    const n = await dialogs.count();
    console.log('=== dialogs open:', n);
    const modal = dialogs.nth(n - 1);
    console.log('=== TEXT ===\n' + (await modal.innerText()));
    console.log('=== HTML ===\n' + (await modal.innerHTML()));

    console.log('=== file inputs ===');
    console.log(JSON.stringify(await modal.locator('input[type="file"]').evaluateAll((els) => els.map((e) => ({
      accept: e.accept, multiple: e.multiple, cls: e.className, id: e.id, testid: e.getAttribute('data-testid'), name: e.name,
      hidden: e.offsetParent === null,
    }))), null, 2));

    console.log('=== buttons/links ===');
    console.log(JSON.stringify(await modal.locator('button, a').evaluateAll((els) => els.map((e) => ({
      tag: e.tagName, text: (e.innerText || '').trim().slice(0, 60), testid: e.getAttribute('data-testid'),
      aria: e.getAttribute('aria-label'), disabled: e.disabled === true, href: e.getAttribute('href'),
    }))), null, 2));

    // Download Template
    const tmpl = modal.getByRole('button', { name: /download template/i })
      .or(modal.getByRole('link', { name: /download template/i })).first();
    if (await tmpl.isVisible().catch(() => false)) {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
        tmpl.click(),
      ]);
      if (dl) {
        const out = path.join(process.cwd(), 'reports', 'probe-template-' + dl.suggestedFilename());
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await dl.saveAs(out);
        console.log('=== DOWNLOAD:', dl.suggestedFilename(), fs.statSync(out).size, 'bytes ->', out);
        console.log('--- head of file ---');
        console.log(fs.readFileSync(out).slice(0, 400).toString('utf8').replace(/[^\x20-\x7e\n,]/g, '.'));
      } else {
        console.log('=== NO DOWNLOAD EVENT. url now:', page.url());
      }
    } else {
      console.log('=== no Download Template control found');
    }
  } catch (e) {
    console.log('ERROR', e.message);
  } finally {
    await browser.close();
  }
})();
