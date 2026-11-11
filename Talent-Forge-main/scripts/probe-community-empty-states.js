/* eslint-disable no-console */
// probe-community-empty-states.js — READ-ONLY. Captures, verbatim, every empty state the
// Community module renders, plus the Majors filter's own search box.
//
// WHY IT EXISTS. The superadmin feature file asserted ONE wording for three different surfaces
// ("No results found" + "We couldn't find any results matching your current search and filters."
// + a "Clear all filters" CTA). The build renders three DIFFERENT copies, and a locator written
// for the expected wording can only ever answer "absent" — so the only honest way to fix the
// assertions is to collect every visible string the app puts on screen and read them.
//
// Four surfaces:
//   1. /community  search matching nothing              (superadmin listing)
//   2. /community/create  university dropdown, no match (the type-to-filter combobox)
//   3. /community/view/<id>  member search matching nothing
//   4. /community/view/<id>  a filter combination matching nothing
//   5. the Majors popover's OWN search box — matching and non-matching
//
// Makes no change of any kind: no save, no create, no edit.
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Everything visible that could be an empty state, reported without filtering for the wording
// we hope to find. Blocks are returned smallest-first so the innermost message box is obvious.
async function readEmptyish(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const blocks = Array.from(document.querySelectorAll('div,section,p,h1,h2,h3,h4,span'))
      .filter(vis)
      .map((e) => ({ e, text: t(e.innerText || e.textContent) }))
      .filter(({ text }) => text && text.length < 300 && /\bno\b|couldn'?t|not found|nothing|empty/i.test(text))
      .map(({ e, text }) => {
        const st = getComputedStyle(e);
        return {
          tag: e.tagName,
          text,
          len: text.length,
          padTop: st.paddingTop,
          padBottom: st.paddingBottom,
          marTop: st.marginTop,
          marBottom: st.marginBottom,
        };
      })
      .sort((a, b) => a.len - b.len);
    // Dedupe by text, keeping the smallest host for each.
    const seen = new Set();
    const uniq = [];
    for (const b of blocks) {
      if (seen.has(b.text)) continue;
      seen.add(b.text);
      uniq.push(b);
    }
    return {
      blocks: uniq.slice(0, 10),
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
        .filter(vis)
        .map((h) => t(h.textContent))
        .filter(Boolean),
      clearCtas: Array.from(document.querySelectorAll('button,a'))
        .filter(vis)
        .map((b) => t(b.textContent))
        .filter((x) => /clear/i.test(x)),
      allCtas: Array.from(document.querySelectorAll('button'))
        .filter(vis)
        .map((b) => t(b.textContent))
        .filter(Boolean)
        .slice(0, 40),
    };
  });
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  await login(page);

  // ---------- 1. Listing search with no match ----------
  console.log('\n================ 1. /community — search matching nothing ================');
  await page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const searchBox = page.locator('input[placeholder*="Search by university" i], input[type="search"]').first();
  console.log('search placeholder:', JSON.stringify(await searchBox.getAttribute('placeholder')));
  await searchBox.fill('zzzz-no-such-university');
  await page.waitForTimeout(4000);
  console.log(JSON.stringify(await readEmptyish(page), null, 1));

  // ---------- 2. Create page — university dropdown with no match ----------
  console.log('\n================ 2. /community/create — university dropdown, no match ================');
  await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const uni = page.locator('input[placeholder*="Select University" i]').or(page.locator('input[role="combobox"]').first()).first();
  await uni.click();
  await page.waitForTimeout(1200);
  await uni.fill('zzzz-no-such-university');
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const pops = Array.from(document.querySelectorAll('[role="listbox"],[role="dialog"],[role="presentation"]')).filter(vis);
    return {
      options: Array.from(document.querySelectorAll('[role="option"]')).filter(vis).map((o) => t(o.textContent)),
      popovers: pops.map((p) => ({ role: p.getAttribute('role'), text: t(p.innerText).slice(0, 200) })),
    };
  }), null, 1));
  console.log('--- page-level "no ..." blocks on the create page ---');
  console.log(JSON.stringify((await readEmptyish(page)).blocks, null, 1));

  // ---------- pick a community with members ----------
  await page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const withMembers = await page.evaluate(() => {
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('article'))
      .map((a) => {
        const view = a.querySelector('a[href^="/community/view/"]');
        const m = t(a.innerText).match(/(\d[\d,]*)\s*Members?/i);
        return {
          id: view ? view.getAttribute('href').split('/').pop() : null,
          name: t((a.querySelector('h1,h2,h3,h4') || {}).textContent || ''),
          count: m ? Number(m[1].replace(/,/g, '')) : 0,
        };
      })
      .filter((c) => c.id && c.count > 0)
      .sort((a, b) => b.count - a.count);
  });
  console.log('\ncommunities on page 1 with members:', JSON.stringify(withMembers.slice(0, 5)));
  const subject = withMembers[0];
  if (!subject) {
    console.log('NO community with members on page 1 — stopping here.');
    await browser.close();
    return;
  }
  await page.goto(`${ORIGIN}/community/view/${subject.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log(`\nsubject: "${subject.name}" (id ${subject.id}, card says ${subject.count})`);

  // ---------- 3. Member search with no match ----------
  console.log('\n================ 3. /community/view — member search matching nothing ================');
  const memberSearch = page.locator('input[placeholder*="candidate name" i], input[type="search"]').first();
  console.log('member search placeholder:', JSON.stringify(await memberSearch.getAttribute('placeholder')));
  await memberSearch.fill('zzzz-no-such-candidate');
  await page.waitForTimeout(4500);
  console.log(JSON.stringify(await readEmptyish(page), null, 1));
  await memberSearch.fill('');
  await page.waitForTimeout(3500);

  // ---------- 5. Majors popover's own search box ----------
  // Done BEFORE the filter empty state, because that one leaves filters applied.
  console.log('\n================ 5. Majors popover — its own search box ================');
  await page.getByText(/^Majors$/i).first().click({ timeout: 20000 }).catch((e) => console.log('open failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(1800);
  const dumpPopover = () => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const pop = Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"]'))
      .filter(vis)
      .sort((a, b) => t(b.textContent).length - t(a.textContent).length)[0];
    if (!pop) return null;
    return {
      role: pop.getAttribute('role'),
      labels: Array.from(pop.querySelectorAll('label')).filter(vis).map((l) => t(l.textContent)).filter(Boolean),
      buttons: Array.from(pop.querySelectorAll('button')).filter(vis).map((b) => t(b.textContent)).filter(Boolean),
      inputs: Array.from(pop.querySelectorAll('input')).map((i) => ({
        type: i.getAttribute('type'), placeholder: i.getAttribute('placeholder'), value: i.value, visible: vis(i),
      })),
      fullText: t(pop.innerText).slice(0, 400),
    };
  });
  const before = await dumpPopover();
  console.log('--- popover as opened ---');
  console.log(JSON.stringify(before, null, 1));

  const popSearch = page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type]), [role="listbox"] input').first();
  const hasPopSearch = await popSearch.count();
  console.log('popover has its own search input:', !!hasPopSearch);
  if (hasPopSearch && before && before.labels.length) {
    // A fragment of a REAL option, so "the list narrowed" is distinguishable from "it emptied".
    const target = before.labels.find((l) => clean(l).length > 4) || before.labels[0];
    const fragment = clean(target).slice(0, 4);
    console.log(`\n--- typing the fragment "${fragment}" (from the real option "${target}") ---`);
    await popSearch.fill(fragment);
    await page.waitForTimeout(2000);
    console.log(JSON.stringify(await dumpPopover(), null, 1));

    console.log('\n--- typing a term that matches nothing ---');
    await popSearch.fill('zzzz-no-such-major');
    await page.waitForTimeout(2000);
    console.log(JSON.stringify(await dumpPopover(), null, 1));
    console.log('--- page-level blocks while the popover shows no match ---');
    console.log(JSON.stringify((await readEmptyish(page)).blocks, null, 1));
    await popSearch.fill('');
    await page.waitForTimeout(1500);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5).catch(() => {});
  await page.waitForTimeout(1500);

  // ---------- 4. Filter combination with no match ----------
  console.log('\n================ 4. /community/view — a filter combination matching nothing ================');
  // First Grad Year + last Major: opposite ends of two lists, so an empty intersection is likely.
  await page.getByRole('button', { name: /^Grad Years$/i }).first().click({ timeout: 20000 }).catch((e) => console.log('grad open failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(1500);
  await page.locator('[role="dialog"] label, [role="listbox"] label').first().click({ timeout: 15000 }).catch((e) => console.log('grad select failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5).catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText(/^Majors$/i).first().click({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const majorTargets = page.locator('[role="dialog"] label, [role="dialog"] button, [role="listbox"] label');
  const n = await majorTargets.count();
  await majorTargets.nth(Math.max(0, n - 1)).click({ timeout: 15000 }).catch((e) => console.log('major select failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5).catch(() => {});
  await page.waitForTimeout(3000);
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')).length);
  console.log('candidate cards left after the two filters:', cards);
  console.log(JSON.stringify(await readEmptyish(page), null, 1));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
