/* eslint-disable no-console */
// Two failures from the 2026-08-02 run point at the SAME suspicion — that readMemberCards() is
// misattributing a card's fields rather than the app being wrong:
//   * "searching 'AI Prompter' returned 0 card(s) and not 'Activity log'" — "Activity log" is
//     sidebar chrome, not a candidate name, so the reader appears to have taken a name from
//     outside the card.
//   * "the profile does not show the major shown on the card: 'AI Prompter'" — if `major` is
//     really the track (or a widget label), the public profile would legitimately not carry it
//     and the scenario is blaming the app for the reader's mistake.
//
// So this dumps, for the first community with members: what readMemberCards() returns, and
// beside it the RAW text of the corresponding card element, so the two can be compared by eye.
// Read-only. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityPage = require('../pages/CommunityPage');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await c.newPage();
  await p.goto(process.env.BASE_URL, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const cm = new CommunityPage(p);
  await cm.gotoList();
  const cards = await cm.readCards();
  const want = process.argv[2];
  const withMembers = want
    ? cards.find((x) => x.name.toLowerCase().includes(want.toLowerCase()))
    : (cards.find((x) => x.memberCount > 0) || cards[0]);
  if (!withMembers) throw new Error(`no community matched "${want}". Listed: ${cards.map((c) => c.name).join(', ')}`);
  console.log(`Community: "${withMembers.name}" (id ${withMembers.id}), card says ${withMembers.memberCount} members`);

  await cm.gotoCommunity(withMembers.id);
  const header = await cm.readHeader();
  console.log(`Header: ${JSON.stringify({ name: header.name, memberText: header.memberText, memberCount: header.memberCount })}`);

  const read = await cm.readMemberCards();
  console.log(`\nreadMemberCards() returned ${read.length}:`);
  read.forEach((m, i) => console.log(` ${i}. ${JSON.stringify(m)}`));

  // The raw DOM, grouped per "View Profile" CTA — every real candidate card has exactly one,
  // so walking up from the CTA is a card boundary the reader cannot argue with.
  const raw = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const ctas = Array.from(document.querySelectorAll('button,a'))
      .filter(vis)
      .filter((e) => /view profile/i.test(clean(e.textContent)));
    return ctas.map((cta) => {
      let el = cta;
      for (let i = 0; i < 8 && el.parentElement; i++) {
        el = el.parentElement;
        if (clean(el.textContent).length > 40) break;
      }
      return {
        cardText: clean(el.textContent).slice(0, 300),
        lines: Array.from(el.querySelectorAll('*'))
          .filter((n) => n.children.length === 0 && vis(n) && clean(n.textContent))
          .map((n) => clean(n.textContent)),
      };
    });
  });
  // If a "member" turns up that is plainly page chrome (the run of 2026-08-02 reported one
  // called "Activity log"), show the element the reader built it from, so the root-detection
  // rule can be fixed against what is really on the page rather than against a guess.
  for (const m of read) {
    if (!m.name || /^(activity log|notifications?|settings|dashboard|profile)$/i.test(m.name)) {
      // eslint-disable-next-line no-await-in-loop
      const info = await p.evaluate((nm) => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const h = Array.from(document.querySelectorAll('h1,h2,h3,h4')).find((x) => clean(x.textContent) === nm);
        if (!h) return 'heading not found on a re-query';
        const path = [];
        let el = h;
        for (let i = 0; i < 6 && el; i++) {
          path.push(`${el.tagName}.${(el.className || '').toString().slice(0, 60)}`);
          el = el.parentElement;
        }
        return { headingTag: h.tagName, ancestors: path };
      }, m.name);
      console.log(`\n!! SUSPECT MEMBER "${m.name}": ${JSON.stringify(info, null, 1)}`);
      console.log(`   its card text: ${JSON.stringify(m.text)}`);
    }
  }

  console.log(`\nRAW cards found via "View Profile" CTA: ${raw.length}`);
  raw.forEach((r, i) => {
    console.log(` ${i}. lines = ${JSON.stringify(r.lines)}`);
  });

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
