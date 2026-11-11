/* eslint-disable no-console */
// probe-community-superadmin.js — DEV-ONLY discovery script for the Super Admin Community
// module (TFF-264). Logs in as the superadmin, walks Community -> Create Community ->
// View Community -> Edit Community and dumps everything a Page Object needs: real URLs,
// field labels, placeholders, dropdown option sets, button states, empty-state copy.
//
// IT NEVER CLICKS SAVE. Saving a community permanently consumes a university (AC 3.1 only
// offers universities WITHOUT an active community, and the AC describes no delete CTA), so
// this script stops at the point of persistence on purpose.
//
//   node scripts/probe-community-superadmin.js
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;

const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

async function step(name, fn) {
  try {
    const value = await fn();
    out[name] = value;
    return value;
  } catch (err) {
    console.log(`  !! ${name} failed: ${err.message.split('\n')[0]}`);
    out[name] = { error: err.message.split('\n')[0] };
    return null;
  }
}

// Dump every interactive/labelled thing on the current screen, structurally.
async function describeScreen(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis);

    return {
      url: location.href,
      headings: pick('h1,h2,h3,h4').map((h) => `${h.tagName}: ${txt(h)}`),
      buttons: pick('button').map((b) => ({
        text: txt(b),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        testid: b.getAttribute('data-testid'),
        type: b.getAttribute('type'),
      })),
      links: pick('a').map((a) => ({ text: txt(a), href: a.getAttribute('href') })).slice(0, 40),
      inputs: pick('input,textarea,select').map((i) => ({
        tag: i.tagName,
        type: i.getAttribute('type'),
        name: i.getAttribute('name'),
        id: i.id,
        placeholder: i.getAttribute('placeholder'),
        accept: i.getAttribute('accept'),
        maxlength: i.getAttribute('maxlength'),
        required: i.required || i.getAttribute('aria-required') === 'true',
        testid: i.getAttribute('data-testid'),
        role: i.getAttribute('role'),
        value: (i.value || '').slice(0, 60),
        readonly: i.readOnly,
      })),
      labels: pick('label').map(txt),
      testids: Array.from(new Set(pick('[data-testid]').map((e) => e.getAttribute('data-testid')))),
      // Anything that looks like a combobox/dropdown trigger but is not an <input>.
      comboboxes: pick('[role="combobox"],[role="button"][aria-haspopup],[aria-haspopup="listbox"]')
        .map((e) => ({ tag: e.tagName, text: txt(e), testid: e.getAttribute('data-testid') })),
      // Required-marker asterisks, to tell required from optional fields.
      asterisks: pick('*')
        .filter((e) => e.children.length === 0 && /^\*$/.test((e.textContent || '').trim()))
        .map((e) => txt(e.parentElement || e)),
      bodyText: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 2500),
    };
  });
}

async function openDropdownAndListOptions(page, triggerText) {
  const trigger = page
    .locator(`[role="combobox"]`)
    .filter({ hasText: new RegExp(triggerText, 'i') })
    .or(page.getByRole('button', { name: new RegExp(triggerText, 'i') }))
    .or(page.locator('div,button').filter({ hasText: new RegExp(`^${triggerText}$`, 'i') }))
    .first();
  await trigger.click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const options = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const nodes = Array.from(
      document.querySelectorAll('[role="option"],[role="menuitem"],li[data-value],li[role],ul li')
    ).filter(vis);
    return {
      count: nodes.length,
      selectors: Array.from(new Set(nodes.map((n) => `${n.tagName}[role=${n.getAttribute('role')}]`))),
      values: nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  return options;
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();

  // Record every community-ish request so the POM can wait on the real endpoints.
  const requests = [];
  page.on('request', (r) => {
    if (/communit/i.test(r.url())) requests.push(`${r.method()} ${r.url().replace(ORIGIN, '')}`);
  });
  const responses = [];
  page.on('response', (r) => {
    if (/communit/i.test(r.url())) responses.push(`${r.status()} ${r.request().method()} ${r.url().replace(ORIGIN, '')}`);
  });

  hr('LOGIN');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });
  console.log(`landed on ${page.url()}`);

  hr('SIDEBAR / NAVIGATION');
  await step('sidebar', async () =>
    page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return Array.from(document.querySelectorAll('a,button'))
        .filter(vis)
        .map((e) => ({ text: (e.textContent || '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') }))
        .filter((e) => e.text && e.text.length < 40);
    })
  );
  console.log(JSON.stringify(out.sidebar, null, 1).slice(0, 2500));

  hr('COMMUNITY MAIN PAGE');
  // Try the nav link first, fall back to direct URLs.
  let reached = false;
  for (const attempt of [
    async () => {
      await page.getByRole('link', { name: /^community$/i }).first().click({ timeout: 8000 });
    },
    async () => {
      await page.getByText(/^community$/i).first().click({ timeout: 8000 });
    },
    async () => page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' }),
    async () => page.goto(`${ORIGIN}/communities`, { waitUntil: 'domcontentloaded' }),
  ]) {
    try {
      await attempt();
      await page.waitForTimeout(2500);
      if (/communit/i.test(page.url())) {
        reached = true;
        break;
      }
    } catch { /* try the next route */ }
  }
  console.log(`community url: ${page.url()} (reached=${reached})`);
  await step('communityMain', () => describeScreen(page));
  console.log(JSON.stringify(out.communityMain, null, 1).slice(0, 6000));

  hr('COMMUNITY CARD MARKUP (first card)');
  await step('firstCardHtml', async () =>
    page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Smallest element containing both a member count and a View Community CTA.
      const all = Array.from(document.querySelectorAll('div,article,li,section')).filter(vis);
      const cards = all.filter((e) => {
        const t = e.innerText || '';
        return /members?/i.test(t) && /view community/i.test(t) && t.length < 400;
      });
      cards.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      const c = cards[0];
      return c
        ? { count: cards.length, text: c.innerText.replace(/\s+/g, ' ').trim(), html: c.outerHTML.slice(0, 3000) }
        : { count: 0 };
    })
  );
  console.log(JSON.stringify(out.firstCardHtml, null, 1).slice(0, 3500));

  hr('CREATE COMMUNITY PAGE');
  await step('createNav', async () => {
    await page
      .getByRole('button', { name: /create community/i })
      .or(page.getByRole('link', { name: /create community/i }))
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(2500);
    return page.url();
  });
  console.log(`create url: ${page.url()}`);
  await step('createForm', () => describeScreen(page));
  console.log(JSON.stringify(out.createForm, null, 1).slice(0, 7000));

  hr('UNIVERSITY DROPDOWN');
  await step('universityOptions', () => openDropdownAndListOptions(page, 'university'));
  console.log(JSON.stringify(out.universityOptions, null, 1).slice(0, 4000));

  hr('LOCATION DROPDOWN');
  await step('locationOptions', () => openDropdownAndListOptions(page, 'location'));
  console.log(JSON.stringify(out.locationOptions, null, 1).slice(0, 4000));

  hr('BACK TO LISTING -> VIEW COMMUNITY');
  await step('viewCommunity', async () => {
    await page.goto(out.communityMain.url || `${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /view community/i })
      .or(page.getByRole('link', { name: /view community/i }))
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(3000);
    return page.url();
  });
  console.log(`view url: ${page.url()}`);
  await step('communityDetail', () => describeScreen(page));
  console.log(JSON.stringify(out.communityDetail, null, 1).slice(0, 7000));

  hr('CANDIDATE CARD MARKUP (first card)');
  await step('candidateCardHtml', async () =>
    page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const all = Array.from(document.querySelectorAll('div,article,li,section')).filter(vis);
      const cards = all.filter((e) => /view profile/i.test(e.innerText || '') && (e.innerText || '').length < 500);
      cards.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      const c = cards[0];
      return c
        ? { count: cards.length, text: c.innerText.replace(/\s+/g, ' ').trim(), html: c.outerHTML.slice(0, 3500) }
        : { count: 0 };
    })
  );
  console.log(JSON.stringify(out.candidateCardHtml, null, 1).slice(0, 4000));

  hr('FILTER PANEL');
  await step('filterPanel', async () => {
    await page
      .getByRole('button', { name: /^filters?$/i })
      .or(page.getByText(/^filters?$/i))
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(1800);
    return describeScreen(page);
  });
  console.log(JSON.stringify(out.filterPanel, null, 1).slice(0, 6000));

  hr('EDIT COMMUNITY');
  await step('editCommunity', async () => {
    await page
      .getByRole('button', { name: /edit community/i })
      .or(page.getByRole('link', { name: /edit community/i }))
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(2500);
    return describeScreen(page);
  });
  console.log(JSON.stringify(out.editCommunity, null, 1).slice(0, 7000));

  hr('COMMUNITY NETWORK TRAFFIC');
  console.log(Array.from(new Set(requests)).join('\n'));
  console.log('---');
  console.log(Array.from(new Set(responses)).join('\n'));

  require('fs').writeFileSync(
    require('path').join(__dirname, '..', 'reports', 'probe-community-superadmin.json'),
    JSON.stringify({ out, requests, responses }, null, 2)
  );
  hr('DONE — full dump written to reports/probe-community-superadmin.json');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
