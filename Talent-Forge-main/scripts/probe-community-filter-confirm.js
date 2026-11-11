/* eslint-disable no-console */
// AC 7.4 specifies that a filter selection takes effect only when CONFIRMED ("Apply Filters") and
// that dismissing the panel discards it ("Cancel"). The §10 scenario asserting that is @known-issue,
// so the claim on record is that the build has neither control — but the scenario cannot show that:
// it asserts the BEHAVIOUR (the rendered card count must not move) and abandons at its first failure,
// so it never reports whether an Apply button exists, nor what dismissing actually does.
//
// It prints four things, in this order:
//   1. EVERY control inside the open popover, so "there is no Apply button" is read off the DOM
//      rather than inferred from the list having moved.
//   2. What selecting an option does while the panel is STILL OPEN — the rendered count, the filter
//      chips, and WHAT THE SERVER ANSWERED.
//   3. The same after dismissing without confirming — does dismissal discard the selection?
//   4. Whether the member list narrows AT ALL, against a major listed members actually hold.
//
// TWO READERS, ALWAYS, AND THEY ARE PRINTED SIDE BY SIDE. Step 2 found the rendered count unchanged
// while the API returned the correctly filtered set — which is either the UI failing to re-render or
// `readMemberCards()` reading stale DOM, and those are different defects owned by different people.
// So every count is taken BOTH through the page object and by counting View Profile CTAs in the raw
// DOM, and polled over several seconds rather than read once. A single reader disagreeing with the
// server is not evidence; this module's own history is a list of second readers being the bug.
//
// Read-only. It clears whatever it applied in a finally block and never saves anything.
//
//   node scripts/probe-community-filter-confirm.js [communityId] [filterLabel]
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityPage = require('../pages/CommunityPage');

const FILTER = process.argv[3] || 'Majors';

async function popoverControls(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const host = document.querySelector('[role="dialog"]') || document.querySelector('[role="listbox"]');
    if (!host) return null;
    return Array.from(host.querySelectorAll('button,[role="button"],input,a')).filter(vis).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      text: clean(el.textContent).slice(0, 40),
      aria: el.getAttribute('aria-label'),
    }));
  });
}

// The independent reader: a member card is whatever carries a "View Profile" CTA. Deliberately not
// the page object's own derivation, so the two can disagree in the output.
async function rawMembers(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const ctas = Array.from(document.querySelectorAll('button,a')).filter(vis)
      .filter((x) => /view profile/i.test(clean(x.textContent)));
    return ctas.map((cta) => {
      let card = cta;
      for (let i = 0; i < 6 && card.parentElement; i += 1) {
        card = card.parentElement;
        if (card.querySelectorAll('button,a').length > 1 && clean(card.textContent).length > 30) break;
      }
      const head = card.querySelector('h1,h2,h3,h4,h5');
      return clean(head ? head.textContent : card.textContent).slice(0, 34);
    });
  });
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();

  const answers = [];
  p.on('response', async (r) => {
    if (!/\/candidates\/\?/.test(r.url())) return;
    const body = await r.json().catch(() => null);
    answers.push({
      q: r.url().replace(/^.*\/candidates\/\?/, ''),
      status: r.status(),
      count: body && typeof body.count === 'number' ? body.count : null,
      returned: body && Array.isArray(body.results) ? body.results.length : null,
    });
  });
  const since = () => answers.length;
  const answeredSince = (mark) => (answers.length > mark
    ? answers.slice(mark).map((a) => `[${a.status}] ?${a.q} -> count ${a.count}, ${a.returned} result(s)`).join('\n              ')
    : '(no /candidates/ request fired)');

  await p.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const cm = new CommunityPage(p);
  // Poll BOTH readers, so a slow re-render is distinguishable from one that never happens.
  const watch = async (label, seconds = 8) => {
    const series = [];
    for (let i = 0; i < seconds * 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const [pom, raw] = await Promise.all([cm.readMemberCards(), rawMembers(p)]);
      series.push(`${pom.length}/${raw.length}`);
      if (series.length > 3 && new Set(series.slice(-4)).size === 1) break;
      // eslint-disable-next-line no-await-in-loop
      await p.waitForTimeout(500);
    }
    const raw = await rawMembers(p);
    console.log(`  ${label}: readMemberCards()/rawDOM over time -> ${series.join(' ')}`);
    console.log(`  ${label}: names now -> ${raw.join(' | ') || '(none)'}`);
    return raw.length;
  };

  let cleanup = async () => {};
  try {
    console.log('Finding a community that lists members:');
    let baseline = 0;
    if (process.argv[2]) {
      await cm.gotoCommunity(process.argv[2]);
      baseline = (await rawMembers(p)).length;
    } else {
      await cm.gotoList();
      const cards = (await cm.readCards()).filter((x) => (x.memberCount || 0) > 0)
        .sort((a, b) => b.memberCount - a.memberCount);
      for (const card of cards.slice(0, 6)) {
        // eslint-disable-next-line no-await-in-loop
        await cm.gotoCommunity(card.id);
        // eslint-disable-next-line no-await-in-loop
        const n = (await rawMembers(p)).length;
        console.log(`  tried "${card.name}" (id ${card.id}, card says ${card.memberCount}) -> ${n} member card(s)`);
        if (n > 0) { baseline = n; break; }
      }
    }
    if (!baseline) { console.log('\nNo community listed any members — cannot probe.'); await b.close(); return; }

    cleanup = async () => {
      const clear = cm.clearAllControl();
      if (await clear.count().catch(() => 0)) {
        await clear.first().click({ timeout: 10000 }).catch(() => {});
        await cm.settle(1500);
      }
    };

    const held = (await cm.readMemberCards()).map((m) => m.major).filter((x) => x && x !== '—');
    console.log(`\nBASELINE: ${baseline} member card(s); majors held: ${held.join(', ') || '(none)'}`);
    console.log(`  filterState: ${JSON.stringify(await cm.filterState())}`);

    // ---- 1. is there an Apply / Cancel at all ----
    await cm.openFilter(FILTER);
    const controls = await popoverControls(p);
    console.log(`\n### 1. Controls inside the open "${FILTER}" popover`);
    (controls || []).forEach((x) => console.log(`  <${x.tag}${x.type ? ` type=${x.type}` : ''}> "${x.text}"${x.aria ? ` aria-label="${x.aria}"` : ''}`));
    const confirmish = (controls || []).filter((x) => /apply|cancel|done|confirm/i.test(`${x.text} ${x.aria || ''}`));
    console.log(`  --> Apply/Cancel-style controls: ${confirmish.length ? confirmish.map((x) => `"${x.text || x.aria}"`).join(', ') : 'NONE'}`);

    // ---- 2. selecting, panel still open ----
    // A major LISTED MEMBERS HOLD, so "the count did not move" cannot be explained by the filter
    // having matched nobody — which is what made the scenario's own assertion pass for free.
    const offered = (await cm.readOpenFilterOptions()).options;
    const subject = offered.find((o) => held.some((h) => h.toLowerCase() === o.toLowerCase())) || offered[0];
    const want = held.filter((h) => h.toLowerCase() === subject.toLowerCase()).length;
    let mark = since();
    const sel = await cm.selectFilterOptionByText(subject);
    console.log(`\n### 2. Selected "${subject}" (held by ${want} of the ${baseline} listed), panel STILL OPEN`);
    console.log(`  server:       ${answeredSince(mark)}`);
    await watch('  after select');
    console.log(`  filterState:  ${JSON.stringify(await cm.filterState())}`);
    console.log(`  selectFilterOption() reported: ${JSON.stringify(sel)}`);

    // ---- 3. dismissing without confirming ----
    mark = since();
    await cm.closeAnyPopover();
    await cm.settle(1500);
    console.log('\n### 3. After dismissing the panel WITHOUT confirming');
    console.log(`  server:       ${answeredSince(mark)}`);
    await watch('  after dismiss');
    console.log(`  filterState:  ${JSON.stringify(await cm.filterState())}`);

    console.log(`\n  AC 7.4 wants steps 2 and 3 to read back the baseline (${baseline} cards, no chip).`);
    console.log(`  A WORKING filter would show ${want} card(s) at step 2 or 3; an IGNORED one, ${baseline}.`);
  } finally {
    await cleanup();
    console.log(`\ncleaned up -> filterState=${JSON.stringify(await cm.filterState().catch(() => null))}`);
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
