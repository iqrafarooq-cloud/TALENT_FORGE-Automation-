/* eslint-disable no-console */
// probe-community-controls.js — second-pass discovery for the Super Admin Community module.
// probe-community-superadmin.js mapped the pages; this one answers the questions that
// changed what the feature file can honestly assert:
//
//   A  Where is the Profile Photo control on Create? (only ONE file input was visible)
//   B  Does the Location dropdown really offer all 28 AC values?
//   C  Is the University dropdown searchable / longer than the 12 it renders?
//   D  What are the three filter dropdowns, their options, and is there an Apply/Cancel/Clear All?
//   E  Is About University marked required, when AC 3.1 E says optional?
//   F  Header member count vs cards listed vs the listing card's count (they disagreed)
//   G  Search: does it span pages, and what is the no-results copy?
//   H  Are success labels rendered on any candidate card?
//   I  Can the AC 11 required-field inline errors be reached at all, given Save is gated?
//   J  Is University/Institution Name editable on the Edit page? (AC 5.1 omits it)
//
// NEVER SAVES. Saving consumes a university permanently (AC 3.1, no delete CTA).
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

async function step(name, fn) {
  try {
    out[name] = await fn();
  } catch (err) {
    out[name] = { error: err.message.split('\n')[0] };
    console.log(`  !! ${name}: ${out[name].error}`);
  }
  console.log(JSON.stringify(out[name], null, 1).slice(0, 4000));
  return out[name];
}

// Read every visible [role=option] currently on screen (react-aria renders them in a portal).
const readOptions = (page) =>
  page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll('[role="option"]')).filter(vis);
    return {
      count: nodes.length,
      values: nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()),
      multiSelectable: Array.from(document.querySelectorAll('[role="listbox"]')).map((l) => ({
        ariaMulti: l.getAttribute('aria-multiselectable'),
        hasCheckbox: !!l.querySelector('input[type="checkbox"],[role="checkbox"]'),
      })),
    };
  });

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();
  const api = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (/\/api\/v1\/community/.test(u)) {
      let body = null;
      try {
        body = await r.json();
      } catch { /* not json */ }
      api.push({ status: r.status(), url: u.replace(/^.*\/api\/v1/, ''), body });
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  // ---------------------------------------------------------------- A / E / I
  hr('A+E+I — CREATE FORM: photo controls, requiredness markers, error reachability');
  await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await step('createControls', () =>
    page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const t = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      // Every file input, visible or not — the profile-photo one may be hidden behind an avatar.
      const files = Array.from(document.querySelectorAll('input[type="file"]')).map((f, i) => {
        const label = f.closest('label') || document.querySelector(`label[for="${f.id}"]`);
        // Walk up for the nearest block of text that names this control.
        let ctx = f.parentElement;
        for (let d = 0; d < 5 && ctx; d += 1) {
          if (t(ctx).length > 3) break;
          ctx = ctx.parentElement;
        }
        return {
          index: i,
          id: f.id,
          accept: f.getAttribute('accept'),
          multiple: f.multiple,
          visible: vis(f),
          labelText: label ? t(label).slice(0, 120) : null,
          contextText: ctx ? t(ctx).slice(0, 200) : null,
        };
      });
      // Requiredness: does each field's label carry a visible asterisk?
      const labels = Array.from(document.querySelectorAll('label')).map((l) => ({
        text: t(l),
        html: l.innerHTML.slice(0, 300),
        asteriskVisible: Array.from(l.querySelectorAll('*'))
          .filter((e) => /^\*$/.test((e.textContent || '').trim()))
          .some(vis),
      }));
      return { files, labels };
    })
  );

  // Touch-and-blur each field to see whether inline errors appear without submitting.
  await step('blurErrors', async () => {
    const uni = page.locator('input[role="combobox"]').first();
    await uni.click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.locator('h2').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    return page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return Array.from(document.querySelectorAll('p,span,div'))
        .filter((e) => e.children.length === 0 && vis(e))
        .map((e) => (e.textContent || '').trim())
        .filter((s) => /required|must|supported|exceed|invalid/i.test(s));
    });
  });

  // ---------------------------------------------------------------- B / C
  hr('B — LOCATION dropdown (expect 28 per AC 3.1 D)');
  await step('locationOptions', async () => {
    const loc = page.locator('input[placeholder*="Riyadh, Saudi Arabia" i]').first();
    await loc.click();
    await page.waitForTimeout(1500);
    // Scroll the listbox to the bottom in case it virtualises.
    await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"]');
      if (lb) lb.scrollTop = lb.scrollHeight;
    });
    await page.waitForTimeout(600);
    const res = await readOptions(page);
    await page.keyboard.press('Escape');
    return res;
  });

  hr('C — UNIVERSITY dropdown: searchable? longer than 12?');
  await step('universityDropdown', async () => {
    const uni = page.locator('input[placeholder="Select University"]').first();
    await uni.click();
    await page.waitForTimeout(1500);
    const initial = await readOptions(page);
    await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"]');
      if (lb) lb.scrollTop = lb.scrollHeight;
    });
    await page.waitForTimeout(900);
    const afterScroll = await readOptions(page);
    // Type a fragment to see whether it filters (i.e. it is a real combobox, not a plain list).
    await uni.fill('uni');
    await page.waitForTimeout(1500);
    const filtered = await readOptions(page);
    await uni.fill('');
    await page.waitForTimeout(800);
    // Does a university that ALREADY has a community appear? (AC 3.1 says it must not.)
    await uni.fill('Al Asala');
    await page.waitForTimeout(1500);
    const withCommunity = await readOptions(page);
    await uni.fill('');
    await page.keyboard.press('Escape');
    return { initial, afterScroll, filtered, withCommunity };
  });

  // ---------------------------------------------------------------- D / F / G / H
  hr('F — MEMBER COUNTS: listing card vs header vs cards listed vs API');
  await step('memberCounts', async () => {
    await page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const listing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('article'))
        .map((a) => {
          const name = a.querySelector('h3');
          const view = a.querySelector('a[href^="/community/view/"]');
          return {
            name: name ? name.textContent.trim() : null,
            count: (a.innerText.match(/(\d+)\s*Members?/i) || [])[1],
            id: view ? view.getAttribute('href').split('/').pop() : null,
          };
        })
        .filter((x) => x.name)
    );
    const target = listing.find((c) => Number(c.count) > 0) || listing[0];
    await page.goto(`${ORIGIN}/community/view/${target.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const header = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        headerCount: (body.match(/(\d+)\s*Members?/i) || [])[1],
        cardsListed: document.querySelectorAll('button[type="button"] span[data-text]').length
          ? Array.from(document.querySelectorAll('span[data-text]')).filter(
              (s) => /view profile/i.test(s.textContent)
            ).length
          : 0,
        pagination: /Previous|Next/.test(body),
      };
    });
    return { listingCard: target, header };
  });

  hr('H — SUCCESS LABELS anywhere on candidate cards?');
  await step('successLabels', () =>
    page.evaluate(() => {
      const body = document.body.innerText;
      const wanted = ['Course Completed', 'Certificate', 'Co-op Program', 'Tamheer Program'];
      return { present: wanted.filter((w) => body.includes(w)), bodySample: body.slice(0, 400) };
    })
  );

  hr('D — FILTER CONTROLS: Grad Years / Majors / Members');
  for (const name of ['Grad Years', 'Majors', 'Members']) {
    // eslint-disable-next-line no-await-in-loop
    await step(`filter_${name.replace(/\s+/g, '')}`, async () => {
      const btn = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
      await btn.click({ timeout: 10000 });
      await page.waitForTimeout(1500);
      const opts = await readOptions(page);
      const panel = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return {
          buttons: Array.from(document.querySelectorAll('button'))
            .filter(vis)
            .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((t) => /apply|clear|cancel|reset|done/i.test(t)),
          checkboxes: document.querySelectorAll('[role="option"] input[type="checkbox"],[role="option"] [role="checkbox"]').length,
          dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(vis).length,
        };
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      return { options: opts, panel };
    });
  }

  hr('G — MEMBER SEARCH: no-results copy, and does it match a Major? (TFF-330)');
  await step('memberSearch', async () => {
    const search = page.locator('input[type="search"]').first();
    const result = {};
    // A major that IS on a card, per the first probe.
    for (const [key, term] of [
      ['byName', 'iqra'],
      ['byMajor', 'Accounting'],
      ['byTrack', 'Marketing'],
      ['noMatch', 'zzzz-no-such-candidate'],
      ['padded', '   iqra   '],
      ['upper', 'IQRA'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await search.fill(term);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2200);
      // eslint-disable-next-line no-await-in-loop
      result[key] = await page.evaluate(() => {
        const names = Array.from(document.querySelectorAll('h3')).map((h) => h.textContent.trim());
        return {
          cards: Array.from(document.querySelectorAll('span[data-text]')).filter((s) =>
            /view profile/i.test(s.textContent)
          ).length,
          names: names.slice(1),
          emptyState: (document.body.innerText.match(/No [^\n]*\n[^\n]*/i) || [])[0],
        };
      });
    }
    await search.fill('');
    return result;
  });

  hr('G2 — MAIN PAGE SEARCH across pages + no-results copy');
  await step('mainSearch', async () => {
    await page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const search = page.locator('input[type="search"]').first();
    const result = {};
    for (const [key, term] of [
      ['exact', 'King Saud'],
      ['lower', 'arid universit'],
      ['partial', 'Arid'],
      ['padded', '   Arid   '],
      ['byLocation', 'Riyadh'],
      ['noMatch', 'zzzz-no-such-university'],
      ['special', "' OR 1=1 --"],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await search.fill(term);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2200);
      // eslint-disable-next-line no-await-in-loop
      result[key] = await page.evaluate(() => ({
        cards: document.querySelectorAll('article').length,
        names: Array.from(document.querySelectorAll('article h3')).map((h) => h.textContent.trim()),
        emptyState: /no results|no communit/i.test(document.body.innerText)
          ? document.body.innerText.split('\n').filter((l) => /no results|no communit|clear all/i.test(l))
          : null,
      }));
    }
    return result;
  });

  // ---------------------------------------------------------------- J
  hr('J — EDIT: is University/Institution Name actually editable?');
  await step('editUniversityField', async () => {
    await page.goto(`${ORIGIN}/community/edit/${out.memberCounts.listingCard.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const uni = page.locator('input[placeholder="Select University"]').first();
    const before = await uni.evaluate((e) => ({
      value: e.value,
      disabled: e.disabled,
      readOnly: e.readOnly,
      ariaDisabled: e.getAttribute('aria-disabled'),
      pointerEvents: getComputedStyle(e).pointerEvents,
    }));
    let opened = null;
    try {
      await uni.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      opened = await readOptions(page);
      await page.keyboard.press('Escape');
    } catch (e) {
      opened = { error: e.message.split('\n')[0] };
    }
    const saveBefore = await page
      .getByRole('button', { name: /^save/i })
      .first()
      .isDisabled();
    return { before, openedDropdown: opened, saveDisabledOnOpen: saveBefore };
  });

  fs.writeFileSync(
    path.join(__dirname, '..', 'reports', 'probe-community-controls.json'),
    JSON.stringify({ out, api: api.slice(-25) }, null, 2)
  );
  hr('DONE — reports/probe-community-controls.json');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
