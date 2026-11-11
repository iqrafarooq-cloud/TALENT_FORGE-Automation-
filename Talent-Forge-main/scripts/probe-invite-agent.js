// probe-invite-agent.js — discover the live DOM of the SUPERADMIN
// "User Management > Agents > Invite New Agent" flow (TFF Invite Agent AC), so
// InviteAgentPage.js can be built on verified selectors instead of guesses.
//
//   node scripts/probe-invite-agent.js
//
// Dumps, in order:
//   1. where the superadmin lands after login + the left-nav entries
//   2. the User Management sub-tabs and the Invite Agents CTA
//   3. the Invite New Agent route + every section heading
//   4. every form control (tag/type/name/placeholder/required/aria) + its label
//   5. the University Affiliation dropdown options
//   6. the promo section BEFORE and AFTER ticking "Add promo code for this agent"
//   7. the Expiry Date picker internals (disabled days, Apply button)
//   8. the universities configured under Configuration, for the cross-check step
// Screenshots land in the scratchpad dir printed at the end.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');

const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;
const OUT = process.env.PROBE_OUT || path.join(__dirname, '..', 'reports', 'probe-invite-agent');

const line = (t) => console.log(`\n${'='.repeat(12)} ${t} ${'='.repeat(12)}`);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

// Dump every form control on the page together with its accessible label.
async function dumpControls(page, label) {
  line(`CONTROLS — ${label}`);
  const rows = await page.evaluate(() => {
    const labelFor = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const id = el.id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l) return l.innerText;
      }
      const wrap = el.closest('label');
      if (wrap) return wrap.innerText;
      // MUI/Tailwind forms: the label is usually the previous text node in the field group.
      let n = el.parentElement;
      for (let i = 0; i < 4 && n; i += 1, n = n.parentElement) {
        const t = Array.from(n.querySelectorAll('label, p, span'))
          .map((x) => x.innerText)
          .find((x) => x && x.trim().length && x.trim().length < 60);
        if (t) return t;
      }
      return '';
    };
    return Array.from(document.querySelectorAll('input, select, textarea, button, [role="checkbox"], [role="radio"], [role="combobox"], [role="switch"]'))
      .filter((el) => el.offsetParent !== null || el.type === 'hidden' || getComputedStyle(el).position === 'fixed')
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        testid: el.getAttribute('data-testid') || '',
        placeholder: el.getAttribute('placeholder') || '',
        value: el.value !== undefined ? String(el.value).slice(0, 40) : '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        maxlength: el.getAttribute('maxlength') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        label: (labelFor(el) || '').replace(/\s+/g, ' ').trim().slice(0, 70),
        cls: (el.className || '').toString().slice(0, 90),
      }));
  });
  rows.forEach((r) => console.log(JSON.stringify(r)));
  return rows;
}

async function dumpHeadings(page, label) {
  line(`HEADINGS / SECTIONS — ${label}`);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => `${el.tagName}: ${(el.innerText || '').replace(/\s+/g, ' ').trim()}`)
  );
  rows.forEach((r) => console.log(r));
  return rows;
}

// The section titles in this form are NOT semantic headings in every build, so also
// print any short bold-ish text block that looks like a section title.
async function dumpSectionCandidates(page) {
  line('SECTION-TITLE CANDIDATES (non-heading text)');
  const rows = await page.evaluate(() => {
    const wanted = /basic info|university & performance|university and performance|performance targets|promo code details/i;
    return Array.from(document.querySelectorAll('div,p,span,h1,h2,h3,h4,legend'))
      .filter((el) => el.offsetParent !== null && wanted.test(el.innerText || '') && (el.innerText || '').length < 120)
      .map((el) => `${el.tagName}.${(el.className || '').toString().slice(0, 60)} :: ${(el.innerText || '').replace(/\s+/g, ' ').trim()}`);
  });
  [...new Set(rows)].forEach((r) => console.log(r));
}

async function dumpErrors(page, label) {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('p,span,div,[role="alert"]'))
      .filter((el) => el.offsetParent !== null && el.children.length === 0)
      .map((el) => ({ t: (el.innerText || '').replace(/\s+/g, ' ').trim(), c: (el.className || '').toString() }))
      .filter((r) => /required|invalid|must be|please select|valid |already exists|at least/i.test(r.t) && r.t.length < 90)
  );
  if (rows.length) {
    line(`VALIDATION TEXT — ${label}`);
    [...new Set(rows.map((r) => `${r.t}   [class=${r.c.slice(0, 70)}]`))].forEach((r) => console.log(r));
  }
  return rows;
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Record the invite request/response shape too — the @mocked failure scenarios need
  // the exact URL to intercept.
  const calls = [];
  page.on('request', (r) => {
    if (/\/api\//i.test(r.url()) && r.method() !== 'GET') calls.push(`${r.method()} ${r.url()}`);
  });

  try {
    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(EMAIL);
    await login.passwordInput.first().fill(PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics|\/user-management/, {
      timeout: 90000,
      waitUntil: 'commit',
    });
    await page.waitForLoadState('domcontentloaded');
    line('POST-LOGIN');
    console.log('url:', page.url());
    await shot(page, '01-post-login');

    line('LEFT NAV');
    const nav = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a, aside a, nav button, aside button, [role="navigation"] a'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => `${(el.innerText || '').replace(/\s+/g, ' ').trim()}  ->  ${el.getAttribute('href') || '(button)'}`)
    );
    [...new Set(nav)].forEach((r) => console.log(r));

    // ---- User Management ----
    const um = page
      .getByRole('link', { name: /user management/i })
      .or(page.getByRole('button', { name: /user management/i }))
      .or(page.getByText(/^User Management$/i))
      .first();
    if (await um.isVisible().catch(() => false)) {
      await um.click();
      await page.waitForLoadState('domcontentloaded');
    } else {
      console.log('!! No "User Management" nav entry found — trying /agents directly');
      const origin = new URL(page.url()).origin;
      await page.goto(`${origin}/agents`, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(2500);
    line('USER MANAGEMENT');
    console.log('url:', page.url());
    await dumpHeadings(page, 'user management');
    line('SUB-TABS (role=tab / radio / links)');
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"], [role="radio"], [role="tablist"] *, button'))
        .filter((el) => el.offsetParent !== null && /^(agents|candidates)$/i.test((el.innerText || '').trim()))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          text: (el.innerText || '').trim(),
          selected: el.getAttribute('aria-selected') || el.getAttribute('data-state') || '',
          checked: el.getAttribute('aria-checked') || '',
          cls: (el.className || '').toString().slice(0, 80),
        }))
    );
    tabs.forEach((t) => console.log(JSON.stringify(t)));
    line('INVITE CTA CANDIDATES');
    const ctas = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a'))
        .filter((el) => el.offsetParent !== null && /invite/i.test(el.innerText || ''))
        .map((el) => `${el.tagName} "${(el.innerText || '').replace(/\s+/g, ' ').trim()}" href=${el.getAttribute('href') || '-'} testid=${el.getAttribute('data-testid') || '-'}`)
    );
    [...new Set(ctas)].forEach((r) => console.log(r));
    await shot(page, '02-user-management');

    // ---- Invite New Agent ----
    const invite = page
      .getByRole('button', { name: /invite agents?/i })
      .or(page.getByRole('link', { name: /invite agents?/i }))
      .first();
    await invite.click();
    await page.waitForTimeout(3000);
    line('INVITE NEW AGENT PAGE');
    console.log('url:', page.url());
    await dumpHeadings(page, 'invite new agent');
    await dumpSectionCandidates(page);
    await dumpControls(page, 'invite new agent (fresh)');
    await shot(page, '03-invite-form');

    // Required markers — the AC says five fields are "marked required".
    line('REQUIRED-MARKER RENDERING (labels containing *)');
    const stars = await page.evaluate(() =>
      Array.from(document.querySelectorAll('label, p, span'))
        .filter((el) => el.offsetParent !== null && /\*/.test(el.innerText || '') && (el.innerText || '').length < 70)
        .map((el) => `${el.tagName}: ${(el.innerText || '').replace(/\s+/g, ' ').trim()}`)
    );
    [...new Set(stars)].forEach((r) => console.log(r));

    // ---- University Affiliation dropdown ----
    line('UNIVERSITY AFFILIATION DROPDOWN');
    const uni = page
      .getByRole('combobox', { name: /university/i })
      .or(page.locator('select'))
      .or(page.getByText(/select university|university affiliation/i))
      .first();
    console.log('trigger visible:', await uni.isVisible().catch(() => false));
    await uni.click().catch((e) => console.log('click failed:', e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    const options = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [role="menuitem"], option'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => `${el.getAttribute('role') || el.tagName}: ${(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()}`)
    );
    console.log(`options (${options.length}):`);
    options.forEach((o) => console.log('  ', o));
    await shot(page, '04-university-dropdown');
    await page.keyboard.press('Escape').catch(() => {});

    // ---- Promo section: before / after the checkbox ----
    line('PROMO CHECKBOX');
    const promoCb = page
      .getByRole('checkbox', { name: /add promo code/i })
      .or(page.locator('input[type="checkbox"]'))
      .first();
    console.log('checkbox visible:', await promoCb.isVisible().catch(() => false),
      'checked:', await promoCb.isChecked().catch(() => null));
    const beforeText = clean(await page.locator('body').innerText());
    console.log('promo field labels present BEFORE tick:',
      ['Promo Code Name', 'Incentive Type', 'Value', 'Expiry Date', 'Usage Limit']
        .filter((f) => beforeText.includes(f)));

    await promoCb.check({ force: true }).catch(async () => {
      await page.getByText(/add promo code for this agent/i).first().click().catch(() => {});
    });
    await page.waitForTimeout(1500);
    await dumpControls(page, 'invite new agent (promo ticked)');
    await dumpSectionCandidates(page);
    await shot(page, '05-promo-expanded');

    line('INCENTIVE TYPE RADIOS');
    const radios = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="radio"], [role="radio"]'))
        .map((el) => ({
          value: el.getAttribute('value') || '',
          checked: el.checked || el.getAttribute('aria-checked') === 'true',
          label: (el.closest('label') && el.closest('label').innerText || '').replace(/\s+/g, ' ').trim(),
          name: el.getAttribute('name') || '',
        }))
    );
    radios.forEach((r) => console.log(JSON.stringify(r)));

    // Value suffix (% vs SAR) per incentive type.
    for (const type of [/percentage/i, /fixed/i]) {
      const radio = page.locator('input[type="radio"]').filter({ hasNot: page.locator('none') });
      const byLabel = page.getByRole('radio', { name: type }).first();
      const target = (await byLabel.isVisible().catch(() => false)) ? byLabel : radio.first();
      await target.check({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
      const suffixes = await page.evaluate(() =>
        Array.from(document.querySelectorAll('span,p,div'))
          .filter((el) => el.offsetParent !== null && el.children.length === 0 && /^(%|SAR)$/i.test((el.innerText || '').trim()))
          .map((el) => `${(el.innerText || '').trim()}  [class=${(el.className || '').toString().slice(0, 70)}]`)
      );
      console.log(`suffix after selecting ${type} ->`, [...new Set(suffixes)]);
    }

    // ---- Expiry Date picker ----
    line('EXPIRY DATE PICKER');
    const expiry = page
      .getByPlaceholder(/DD\/MM\/YYYY/i)
      .or(page.locator('input[type="date"]'))
      .or(page.getByRole('textbox', { name: /expiry/i }))
      .first();
    const expiryInfo = await expiry.evaluate((el) => ({
      tag: el.tagName, type: el.type, placeholder: el.placeholder, readOnly: el.readOnly,
      color: getComputedStyle(el).color, cls: el.className.toString().slice(0, 90),
    })).catch((e) => ({ error: e.message.split('\n')[0] }));
    console.log('expiry input:', JSON.stringify(expiryInfo));
    await expiry.click().catch(() => {});
    await page.waitForTimeout(1500);
    const cal = await page.evaluate(() => {
      const pop = document.querySelector('[role="dialog"], .rdp, [class*="calendar" i], [class*="datepicker" i]');
      if (!pop) return null;
      const btns = Array.from(pop.querySelectorAll('button'));
      return {
        popCls: (pop.className || '').toString().slice(0, 100),
        role: pop.getAttribute('role') || '',
        buttonSample: btns.slice(0, 12).map((b) => ({
          t: (b.innerText || '').trim().slice(0, 14),
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
          label: b.getAttribute('aria-label') || '',
          cls: (b.className || '').toString().slice(0, 60),
        })),
        hasApply: btns.some((b) => /apply/i.test(b.innerText || '')),
        disabledDayCount: btns.filter((b) => b.disabled && /^\d+$/.test((b.innerText || '').trim())).length,
        navLabels: btns.filter((b) => !/^\d+$/.test((b.innerText || '').trim()))
          .map((b) => `${(b.innerText || '').trim() || b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}`),
      };
    });
    console.log('calendar popover:', JSON.stringify(cal, null, 2));
    await shot(page, '06-expiry-calendar');
    await page.keyboard.press('Escape').catch(() => {});

    // ---- Submit CTA + Exit ----
    line('FORM CTAs');
    const footer = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => `"${(el.innerText || '').replace(/\s+/g, ' ').trim()}" type=${el.getAttribute('type') || '-'} disabled=${el.disabled} testid=${el.getAttribute('data-testid') || '-'} cls=${(el.className || '').toString().slice(0, 70)}`)
    );
    [...new Set(footer)].forEach((r) => console.log(r));

    // ---- Validation: submit an empty-ish form to capture real error copy ----
    line('VALIDATION PROBE — blur/clear each basic field');
    const byLabelOrPlaceholder = (re) => page
      .getByLabel(re)
      .or(page.getByPlaceholder(re))
      .or(page.getByRole('textbox', { name: re }))
      .first();
    for (const [name, re, val] of [
      ['First Name', /first name/i, 'Aisha'],
      ['Last Name', /last name/i, 'Fahad'],
      ['Performance Target', /performance target|numeric performance/i, '10'],
    ]) {
      const f = byLabelOrPlaceholder(re);
      if (!(await f.isVisible().catch(() => false))) { console.log(`  ${name}: NOT FOUND`); continue; }
      await f.fill(val).catch(() => {});
      await f.fill('').catch(() => {});
      await page.keyboard.press('Tab');
      await page.waitForTimeout(600);
      console.log(`  after clearing ${name}:`);
      await dumpErrors(page, name);
    }

    // Character filtering — what the fields actually retain.
    line('INPUT FILTERING PROBE');
    for (const [name, re, typed] of [
      ['First Name', /first name/i, 'Aisha123'],
      ['First Name', /first name/i, 'Ais@ha!'],
      ['Last Name', /last name/i, "O'Brien<>"],
      ['Performance Target', /performance target|numeric performance/i, '1.5'],
      ['Performance Target', /performance target|numeric performance/i, '-5'],
    ]) {
      const f = byLabelOrPlaceholder(re);
      if (!(await f.isVisible().catch(() => false))) continue;
      await f.fill('').catch(() => {});
      await f.type(typed, { delay: 30 }).catch(() => {});
      console.log(`  typed "${typed}" into ${name} -> holds "${await f.inputValue().catch(() => '?')}"`);
    }

    // ---- Configuration: the universities list for the cross-check step ----
    line('CONFIGURATION — universities');
    const origin = new URL(page.url()).origin;
    for (const route of ['/configuration', '/settings/configuration', '/config']) {
      await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2000);
      if (!/not found|404|unauthorized/i.test(await page.locator('body').innerText().catch(() => ''))) {
        console.log('reached:', page.url());
        const heads = await dumpHeadings(page, `configuration ${route}`);
        const uniTab = page.getByText(/universit/i).first();
        if (await uniTab.isVisible().catch(() => false)) {
          await uniTab.click().catch(() => {});
          await page.waitForTimeout(2000);
        }
        const rows = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="row"], tbody tr, li'))
            .filter((el) => el.offsetParent !== null)
            .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
            .filter((t) => t && t.length < 120)
        );
        console.log(`config rows (${rows.length}):`);
        rows.slice(0, 60).forEach((r) => console.log('  ', r));
        await shot(page, '07-configuration');
        if (heads.length) break;
      } else {
        console.log(`${route} -> not reachable`);
      }
    }

    line('NON-GET API CALLS SEEN');
    [...new Set(calls)].forEach((c) => console.log(c));
    console.log('\nScreenshots:', OUT);
  } catch (err) {
    console.error('\nPROBE FAILED:', err.message);
    await shot(page, 'ZZ-failure');
    console.error('url at failure:', page.url());
  } finally {
    await browser.close();
  }
})();
