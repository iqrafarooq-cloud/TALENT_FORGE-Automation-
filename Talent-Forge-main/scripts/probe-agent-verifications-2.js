// Read-only probe #2 for /verifications: the three behaviours probe #1 leaves open -
// the row Download, the panel's "View profile" control, and what the candidate name/email
// buttons in a row actually do. COMMITS NOTHING and submits no decision.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const J = (o) => JSON.stringify(o, null, 1);
const ROW = 'tbody tr';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const settle = (ms = 3500) => page.waitForTimeout(ms);

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.AGENT_EMAIL);
  await login.passwordInput.first().fill(process.env.AGENT_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard|\/candidates|\/getting-started|\/verifications/, { timeout: 90000, waitUntil: 'commit' });

  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(5000);

  console.log('=== A. ROW DOWNLOAD ===');
  const rowName = (await page.locator(ROW + ' td').first().innerText()).trim();
  console.log('row 0 document:', rowName);
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
  await page.locator(ROW + ':first-child [data-testid="agent-verifications-download-button"]').click();
  const got = await dl;
  console.log('download event  :', got ? 'YES' : 'no');
  if (got) {
    console.log('suggestedFilename:', got.suggestedFilename());
    console.log('matches row name?:', got.suggestedFilename() === rowName);
    console.log('url host         :', (() => { try { return new URL(got.url()).host; } catch { return got.url().slice(0, 40); } })());
    console.log('url has signature:', /X-Amz-Signature/.test(got.url()));
  }
  const p = await popup;
  console.log('popup opened    :', p ? p.url().slice(0, 60) : 'no');
  if (p) await p.close().catch(() => {});
  console.log('dialogs after DL:', await page.locator('[role="dialog"]').count());
  console.log('url after DL    :', decodeURIComponent(page.url()).replace(origin, ''));

  console.log('\n=== B. ROW candidate name / email buttons ===');
  const info = await page.$$eval(ROW + ':first-child td:nth-child(2) button', (bs) => bs.map((b) => ({
    text: b.innerText.trim(), tag: b.tagName, tabIndex: b.tabIndex,
    ariaLabel: b.getAttribute('aria-label'), type: b.getAttribute('type'),
    canProgrammaticallyFocus: (() => { b.focus(); return document.activeElement === b; })(),
  })));
  console.log(J(info));
  const urlBefore = page.url();
  await page.locator(ROW + ':first-child td:nth-child(2) button').first().click();
  await settle(2500);
  console.log('after clicking the NAME -> url:', decodeURIComponent(page.url()).replace(origin, ''));
  console.log('                        -> navigated?', page.url() !== urlBefore, '| dialogs:', await page.locator('[role="dialog"]').count());

  console.log('\n--- real Tab walk over the first row (is the name reachable?) ---');
  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4500);
  await page.locator('input[type="search"]').focus();
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return (a.tagName + ':' + (a.getAttribute('aria-label') || a.getAttribute('data-testid') || a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 34));
    }));
  }
  console.log('focus stops:', J(stops));
  console.log('did focus ever land on the candidate name/email?', stops.some((s) => /Ghazan|bytecorp|Abdul|Candidate Tester/i.test(s)));
  console.log('did focus land on View / Download?', stops.some((s) => /View|Download/i.test(s)));

  console.log('\n=== C. PANEL "View profile" -> WHOSE profile does it open? ===');
  // The question this section exists to answer is NOT "does it navigate" - probe #1 already shows
  // that. It is "does it open the profile of the candidate who uploaded THIS document", which a
  // URL-shape check cannot tell from a panel that always opens the first row's candidate.
  const profileRequests = [];
  page.on('request', (r) => {
    const m = /\/candidate\/profile\/(\d+)\//.exec(r.url());
    if (m && r.method() === 'GET') profileRequests.push(m[1]);
  });

  await page.goto(origin + '/verifications?activeFilter=ALL', { waitUntil: 'domcontentloaded' });
  await settle(4500);

  // Take the uploader off the ROW first, so the comparison has a source outside the panel too.
  const rowUploader = (await page.locator(ROW + ' td:nth-child(2)').first().innerText())
    .split('\n').map((s) => s.trim()).filter(Boolean);
  console.log('row 2nd cell (uploader):', J(rowUploader));

  await page.locator(ROW + ':first-child [data-testid="agent-verifications-view-button"]').click();
  const panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  await settle(3000);

  const panelText = await panel.innerText();
  const panelUploader = (/Uploaded By\s*\n+([\s\S]*?)\n\s*\n/.exec(panelText) || [, ''])[1]
    .split('\n').map((s) => s.trim()).filter(Boolean);
  console.log('panel "Uploaded By" block:', J(panelUploader));

  const dl2 = page.waitForEvent('download', { timeout: 25000 }).catch(() => null);
  await panel.getByRole('button', { name: /^Download$/ }).click();
  const got2 = await dl2;
  console.log('panel Download event:', got2 ? got2.suggestedFilename() : 'no');
  console.log('panel still open after Download?', await panel.isVisible());

  const viewProfile = panel.getByRole('button', { name: 'View profile' });
  console.log('"View profile" control:', J(await viewProfile.evaluateAll((bs) => bs.map((b) => ({
    tag: b.tagName, aria: b.getAttribute('aria-label'), text: b.innerText.trim(),
    testid: b.getAttribute('data-testid'), tabIndex: b.tabIndex,
  })))));

  profileRequests.length = 0;
  const before = page.url();
  await viewProfile.click();
  await page.waitForURL(/\/candidates\/\d+\/view-profile/, { timeout: 45000 }).catch(() => {});
  await settle(6000);

  const landedId = (/\/candidates\/(\d+)\/view-profile/.exec(page.url()) || [, null])[1];
  console.log('after "View profile" -> url:', decodeURIComponent(page.url()).replace(origin, ''));
  console.log('                     -> navigated?', page.url() !== before);
  console.log('                     -> candidate id in URL:', landedId);
  console.log('                     -> profile payloads fetched:', J(profileRequests));
  console.log('                     -> heading:', await page.locator('h1').first().innerText().catch(() => null));

  // The five tabs are role=radio, NOT role=tab - so this is the same strip candidate-view-profile
  // asserts, and reading it here is what proves the destination is that same screen.
  const tabs = await page.locator('[role="radiogroup"] [role="radio"]')
    .evaluateAll((rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  console.log('                     -> tab strip:', J(tabs));

  const header = (await page.locator('.profile-basic-details, main').first().innerText().catch(() => ''))
    .split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  console.log('                     -> header lines:', J(header));

  const uploaderName = panelUploader[0] || rowUploader[0] || '';
  console.log('\n   VERDICT: does the profile belong to the document uploader?');
  console.log('     uploader per panel :', JSON.stringify(uploaderName));
  console.log('     profile header says:', JSON.stringify(header[0] || ''));
  console.log('     names agree        :', header.some((l) => l && uploaderName && l.includes(uploaderName)));

  console.log('\n=== D. panel keyboard reachability of its controls ===');
  await page.goto(origin + '/verifications?activeFilter=AWAITING', { waitUntil: 'domcontentloaded' });
  await settle(4500);
  await page.locator(ROW + ':first-child [data-testid="agent-verifications-view-button"]').click();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  await settle(3000);
  console.log(J(await panel.locator('button').evaluateAll((bs) => bs.map((b) => ({
    label: (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28),
    tabIndex: b.tabIndex,
  })))));
  await page.keyboard.press('Escape');

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
