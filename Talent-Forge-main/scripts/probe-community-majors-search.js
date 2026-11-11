/* eslint-disable no-console */
// probe-community-majors-search.js — READ-ONLY. Two things probe-community-empty-states.js
// could not reach:
//
//   A. The Majors popover's OWN search box. Its options are rendered as <button>s, NOT <label>s
//      (measured 2026-08-03), so the first probe's "type a fragment of a real option" branch —
//      gated on `labels.length` — never ran. This one reads the buttons.
//      Also answers: is the list capped at 10, or does it scroll/grow?
//   B. The FILTER-only empty state. The first probe's two-filter combination still left 1 card,
//      so the empty state never rendered. This one selects a Major no member holds, which is
//      the reliable way to empty the list with a filter and nothing else.
//
// Plus the both-at-once case (search AND filter), because that is a THIRD possible wording and
// one existing scenario drives exactly that sequence.
require('dotenv').config();
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const HEADED = process.env.HEADED === 'true';

const dumpPopover = (page) => page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const pop = Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"]'))
    .filter(vis)
    .sort((a, b) => t(b.textContent).length - t(a.textContent).length)[0];
  if (!pop) return null;
  const scroller = Array.from(pop.querySelectorAll('*')).find((e) => e.scrollHeight > e.clientHeight + 8);
  return {
    role: pop.getAttribute('role'),
    optionButtons: Array.from(pop.querySelectorAll('button'))
      .filter(vis)
      .map((b) => t(b.textContent))
      .filter(Boolean)
      .filter((x) => !/^clear all$/i.test(x)),
    labels: Array.from(pop.querySelectorAll('label')).filter(vis).map((l) => t(l.textContent)).filter(Boolean),
    checkboxes: pop.querySelectorAll('input[type="checkbox"]').length,
    ctas: Array.from(pop.querySelectorAll('button')).filter(vis).map((b) => t(b.textContent)).filter((x) => /clear/i.test(x)),
    scrollable: scroller ? { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null,
    fullText: t(pop.innerText).slice(0, 500),
  };
});

const emptyState = (page) => page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const host = Array.from(document.querySelectorAll('section,div'))
    .filter(vis)
    .filter((e) => /^no\b/i.test(t(e.innerText)) && t(e.innerText).length < 400)
    .sort((a, b) => t(a.innerText).length - t(b.innerText).length)[0];
  const st = host ? getComputedStyle(host) : null;
  return {
    present: !!host,
    tag: host ? host.tagName : null,
    heading: host ? t((host.querySelector('h1,h2,h3,h4') || {}).textContent || '') : null,
    body: host ? t((host.querySelector('p') || {}).textContent || '') : null,
    fullText: host ? t(host.innerText) : null,
    spacingAbove: st ? parseFloat(st.paddingTop) + parseFloat(st.marginTop) : null,
    spacingBelow: st ? parseFloat(st.paddingBottom) + parseFloat(st.marginBottom) : null,
    clearCtas: Array.from(document.querySelectorAll('button,a'))
      .filter(vis)
      .map((b) => t(b.textContent))
      .filter((x) => /clear/i.test(x)),
    cards: Array.from(document.querySelectorAll('*'))
      .filter((e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')).length,
  };
});

async function closePopover(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5).catch(() => {});
  await page.waitForTimeout(900);
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const ID = process.argv[2] || '37';
  await page.goto(`${ORIGIN}/community/view/${ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const majorsOnCards = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('div,article,li'))
      .filter(vis)
      .filter((e) => /view profile/i.test(e.innerText || '') && /hours learned/i.test(e.innerText || '') && (e.innerText || '').length < 700)
      .map((e) => t(e.innerText).slice(0, 120));
  });
  console.log(`subject /community/view/${ID}; ${majorsOnCards.length} member card block(s) matched.`);
  console.log(majorsOnCards.slice(0, 4).join('\n'));

  // ================= A. Majors popover search =================
  console.log('\n================ A. Majors popover — its own search box ================');
  await page.getByText(/^Majors$/i).first().click({ timeout: 20000 });
  await page.waitForTimeout(1800);
  const opened = await dumpPopover(page);
  console.log('--- as opened ---');
  console.log(JSON.stringify(opened, null, 1));

  const popSearch = page.locator('[role="dialog"] input[type="text"], [role="listbox"] input[type="text"]').first();
  const target = (opened.optionButtons || []).find((o) => o.length > 5) || (opened.optionButtons || [])[0];
  const fragment = String(target || 'acc').slice(0, 4);

  console.log(`\n--- matching fragment "${fragment}" (from the real option "${target}") ---`);
  await popSearch.fill(fragment);
  await page.waitForTimeout(2200);
  const narrowed = await dumpPopover(page);
  console.log(JSON.stringify(narrowed, null, 1));

  console.log('\n--- a term matching nothing ---');
  await popSearch.fill('zzzz-no-such-major');
  await page.waitForTimeout(2200);
  console.log(JSON.stringify(await dumpPopover(page), null, 1));

  console.log('\n--- CASE-INSENSITIVITY: the fragment in upper case ---');
  await popSearch.fill(fragment.toUpperCase());
  await page.waitForTimeout(2000);
  const upper = await dumpPopover(page);
  console.log(JSON.stringify({ optionButtons: upper.optionButtons }, null, 1));

  console.log('\n--- MID-WORD fragment (substring, not prefix) ---');
  const mid = String(target || 'account').slice(2, 6);
  await popSearch.fill(mid);
  await page.waitForTimeout(2000);
  const midRes = await dumpPopover(page);
  console.log(JSON.stringify({ term: mid, optionButtons: midRes.optionButtons }, null, 1));

  // ================= B. Filter-only empty state =================
  console.log('\n================ B. filter-only empty state ================');
  // Pick a Major and confirm it empties the list. Searching for it inside the popover is also
  // what makes an obscure option reachable at all — the list renders only the first handful.
  const OBSCURE = process.argv[3] || 'Adult Education';
  await popSearch.fill(OBSCURE);
  await page.waitForTimeout(2200);
  const beforePick = await dumpPopover(page);
  console.log(`searched the popover for "${OBSCURE}" -> ${JSON.stringify(beforePick.optionButtons)}`);
  const pick = page.locator('[role="dialog"] button, [role="listbox"] button')
    .filter({ hasText: new RegExp(`^${OBSCURE}$`, 'i') })
    .first();
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /\/candidates\/\?/.test(r.url()), { timeout: 25000 }).catch(() => null),
    pick.click({ timeout: 15000 }).catch((e) => console.log('pick failed:', e.message.split('\n')[0])),
  ]);
  console.log('member list request:', resp ? `${resp.status()} ${resp.url().replace(/^.*v1/, '')}` : '(none captured)');
  await closePopover(page);
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await emptyState(page), null, 1));

  // ================= C. search AND filter together =================
  console.log('\n================ C. a search AND a filter, both non-matching ================');
  const memberSearch = page.locator('input[placeholder*="candidate name" i], input[type="search"]').first();
  await memberSearch.fill('zzzz-no-such-candidate');
  await page.waitForTimeout(4000);
  console.log(JSON.stringify(await emptyState(page), null, 1));

  // ================= D. does "Clear all filters" restore everything? =================
  console.log('\n================ D. the empty state CTA ================');
  const cta = page.getByRole('button', { name: /clear all filters/i }).or(page.getByText(/clear all filters/i)).first();
  if (await cta.count()) {
    await cta.click({ timeout: 15000 }).catch((e) => console.log('cta click failed:', e.message.split('\n')[0]));
    await page.waitForTimeout(4000);
    console.log(JSON.stringify({
      searchFieldAfter: await memberSearch.inputValue().catch(() => null),
      ...(await emptyState(page)),
      triggers: await page.evaluate(() => Array.from(document.querySelectorAll('button,[aria-expanded]'))
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => /^(grad years|majors|members)/i.test(t))),
    }, null, 1));
  } else {
    console.log('no "Clear all filters" CTA on screen at all.');
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
