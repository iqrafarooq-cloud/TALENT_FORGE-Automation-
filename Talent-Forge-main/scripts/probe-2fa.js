/* eslint-disable no-console */
// probe-2fa.js — discovery probe for the Security tab's Two-Factor Authentication card
// (Jira TFF-20, features/Agent_Portal/2FA.feature). READ-ONLY: it opens the setup modal,
// dumps what is really on screen at each step, and always CANCELS — nothing is enabled or
// disabled, and no OTP is ever submitted.
//
// Written because 2FA.feature was authored with no page object and no step definitions, so
// every locator in it had to be derived from the live build rather than guessed. The dump
// deliberately prints the WHOLE card / modal text plus every candidate control, rather than
// probing for the strings the feature file hopes to find — a locator for the expected wording
// can only ever answer "absent".
require('dotenv').config();
const { chromium } = require('playwright');

const EMAIL = process.env.TWOFA_AGENT_EMAIL || process.env.AGENT_CHANGEPASSWORD_EMAIL;
const PASSWORD = process.env.TWOFA_AGENT_PASSWORD || process.env.AGENT_CHANGEPASSWORD_OLD_PASSWORD;
const SETTINGS = (process.env.BASE_URL || '').replace(/\/login\/?$/, '/settings');

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function dumpDom(page, tag, root) {
  const data = await page.evaluate((sel) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = sel ? document.querySelector(sel) : document.body;
    if (!scope) return null;
    return {
      text: c(scope.innerText).slice(0, 1200),
      buttons: Array.from(scope.querySelectorAll('button,[role="button"]')).filter(vis).map((b) => ({
        text: c(b.textContent).slice(0, 60),
        aria: b.getAttribute('aria-label'),
        type: b.getAttribute('type'),
        disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
        cls: (b.className || '').toString().slice(0, 90),
      })),
      switches: Array.from(scope.querySelectorAll('input[type="checkbox"],[role="switch"],[role="checkbox"]')).map((s) => ({
        tag: s.tagName,
        role: s.getAttribute('role'),
        checked: s.checked !== undefined ? s.checked : s.getAttribute('aria-checked'),
        aria: s.getAttribute('aria-label'),
        name: s.getAttribute('name'),
        id: s.id,
        visible: vis(s),
        cls: (s.className || '').toString().slice(0, 90),
        parentCls: (s.parentElement && (s.parentElement.className || '').toString().slice(0, 90)) || '',
      })),
      inputs: Array.from(scope.querySelectorAll('input')).filter(vis).map((i) => ({
        type: i.type,
        maxlength: i.getAttribute('maxlength'),
        inputmode: i.getAttribute('inputmode'),
        placeholder: i.placeholder,
        value: i.value,
        name: i.getAttribute('name'),
        aria: i.getAttribute('aria-label'),
        focused: i === document.activeElement,
        cls: (i.className || '').toString().slice(0, 90),
      })),
      images: Array.from(scope.querySelectorAll('img,canvas,svg')).filter(vis).map((e) => ({
        tag: e.tagName,
        alt: e.getAttribute('alt'),
        src: (e.getAttribute('src') || '').slice(0, 80),
        aria: e.getAttribute('aria-label'),
        w: Math.round(e.getBoundingClientRect().width),
        h: Math.round(e.getBoundingClientRect().height),
        cls: (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').toString().slice(0, 70),
      })),
      testids: Array.from(scope.querySelectorAll('[data-testid]')).filter(vis).map((e) => e.getAttribute('data-testid')),
    };
  }, root || null);
  console.log(`\n================ ${tag} ================`);
  if (!data) return console.log('  (root not found)');
  console.log('--- TEXT ---\n' + data.text);
  console.log('--- buttons ---');
  data.buttons.forEach((b) => console.log(`   "${b.text}" aria=${b.aria} type=${b.type} disabled=${b.disabled} cls=${b.cls}`));
  console.log('--- switches/checkboxes ---');
  data.switches.forEach((s) => console.log(`   <${s.tag} role=${s.role}> checked=${s.checked} vis=${s.visible} aria=${s.aria} name=${s.name} id=${s.id} cls=${s.cls} parent=${s.parentCls}`));
  console.log('--- inputs ---');
  data.inputs.forEach((i) => console.log(`   type=${i.type} maxlen=${i.maxlength} inputmode=${i.inputmode} name=${i.name} aria=${i.aria} ph="${i.placeholder}" value="${i.value}" focused=${i.focused} cls=${i.cls}`));
  console.log('--- img/canvas/svg ---');
  data.images.forEach((e) => console.log(`   <${e.tag}> ${e.w}x${e.h} alt=${e.alt} aria=${e.aria} src=${e.src} cls=${e.cls}`));
  console.log('--- data-testid ---');
  console.log('   ' + (data.testids.length ? [...new Set(data.testids)].join(', ') : '(none)'));
  return data;
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Set AGENT_CHANGEPASSWORD_EMAIL / _OLD_PASSWORD (or TWOFA_AGENT_*) in .env');
  const b = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();

  const api = [];
  p.on('request', (r) => {
    if (/\/api\//.test(r.url()) && r.method() !== 'GET') api.push(`${r.method()} ${r.url()} ${clean(r.postData() || '').slice(0, 200)}`);
  });
  p.on('response', async (r) => {
    if (/2fa|two.?factor|otp|mfa|totp/i.test(r.url())) {
      let body = '';
      try { body = clean(await r.text()).slice(0, 400); } catch { /* stream */ }
      console.log(`[api] ${r.status()} ${r.request().method()} ${r.url()}  ${body}`);
    }
  });

  console.log(`logging in as ${EMAIL}`);
  await p.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(EMAIL);
  await p.locator('input[type="password"]').first().fill(PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 90000 }).catch(() => {});
  console.log('landed on', p.url());

  await p.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  // The tab strip itself — is Security a tab/radio, and does it carry a warning icon?
  await dumpDom(p, 'SETTINGS PAGE (whole body)');

  const security = p.getByRole('radio', { name: /^security$/i })
    .or(p.getByRole('tab', { name: /^security$/i }))
    .or(p.getByText(/^security$/i))
    .first();
  await security.click({ timeout: 30000 });
  await p.waitForTimeout(2500);
  await dumpDom(p, 'SECURITY TAB');

  // Where does the Security tab label's warning icon live? Print the tab label's own subtree.
  const tabHtml = await security.evaluate((el) => {
    const host = el.closest('label,[role="tab"],button,div') || el;
    return host.outerHTML.slice(0, 1500);
  }).catch(() => '(unreadable)');
  console.log('\n--- Security tab label outerHTML ---\n' + tabHtml);

  // The 2FA card's own subtree, located by its heading.
  const cardHtml = await p.evaluate(() => {
    const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const h = Array.from(document.querySelectorAll('*')).find((e) => /two.?factor authentication/i.test(c(e.textContent)) && e.children.length === 0);
    if (!h) return '(no Two-Factor heading found)';
    let host = h;
    for (let i = 0; i < 8 && host.parentElement; i++) {
      host = host.parentElement;
      if (host.querySelector('input[type="checkbox"],[role="switch"]')) break;
    }
    return host.outerHTML.slice(0, 4000);
  });
  console.log('\n--- 2FA CARD outerHTML ---\n' + cardHtml);

  // ---- open the setup / confirm modal (whatever the current state implies) ----
  const toggle = p.locator('[role="switch"], input[type="checkbox"]').first();
  const before = await toggle.evaluate((e) => (e.checked !== undefined ? e.checked : e.getAttribute('aria-checked'))).catch(() => 'n/a');
  console.log(`\ntoggle state before click: ${before}`);
  await toggle.click({ force: true, timeout: 20000 });
  await p.waitForTimeout(2500);
  await dumpDom(p, 'MODAL — STEP 1', '[role="dialog"]');
  const modalHtml = await p.locator('[role="dialog"]').first().evaluate((e) => e.outerHTML.slice(0, 6000)).catch(() => '(no dialog role)');
  console.log('\n--- MODAL outerHTML ---\n' + modalHtml);

  // ---- Next -> OTP step ----
  const next = p.getByRole('button', { name: /^next$/i }).first();
  if (await next.isVisible().catch(() => false)) {
    await next.click();
    await p.waitForTimeout(2000);
    await dumpDom(p, 'MODAL — OTP STEP', '[role="dialog"]');
    const otpHtml = await p.locator('[role="dialog"]').first().evaluate((e) => e.outerHTML.slice(0, 6000)).catch(() => '');
    console.log('\n--- OTP STEP outerHTML ---\n' + otpHtml);

    // Type 3 digits, then 6, and report the Confirm button both times.
    const boxes = p.locator('[role="dialog"] input');
    const n = await boxes.count();
    console.log(`\nOTP input count: ${n}`);
    const confirm = p.getByRole('button', { name: /^confirm$/i }).first();
    const readConfirm = async () => {
      const vis = await confirm.isVisible().catch(() => false);
      if (!vis) return '(no Confirm button)';
      return `disabled=${await confirm.isDisabled().catch(() => 'n/a')}`;
    };
    console.log('confirm with 0 digits:', await readConfirm());
    await p.keyboard.type('123');
    await p.waitForTimeout(500);
    console.log('confirm with 3 digits:', await readConfirm());
    console.log('values after typing 123:', JSON.stringify(await boxes.evaluateAll((els) => els.map((e) => e.value))));
    await p.keyboard.type('456');
    await p.waitForTimeout(500);
    console.log('confirm with 6 digits:', await readConfirm());
    console.log('values after typing 123456:', JSON.stringify(await boxes.evaluateAll((els) => els.map((e) => e.value))));
  } else {
    console.log('\n(no "Next" button on step 1 — dumping visible button names instead)');
  }

  console.log('\nAPI writes observed:');
  api.forEach((a) => console.log('  ' + a));

  // ---- always leave without changing anything ----
  const cancel = p.getByRole('button', { name: /^cancel$/i }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => {});
  await p.waitForTimeout(1500);
  const after = await p.locator('[role="switch"], input[type="checkbox"]').first()
    .evaluate((e) => (e.checked !== undefined ? e.checked : e.getAttribute('aria-checked'))).catch(() => 'n/a');
  console.log(`\ntoggle state after cancel: ${after} (must equal "${before}")`);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
