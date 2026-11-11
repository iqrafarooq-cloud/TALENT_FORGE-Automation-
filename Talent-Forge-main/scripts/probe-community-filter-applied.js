/* eslint-disable no-console */
// `no filter should be applied` fails right after a successful "Clear All" click. Either the
// app does not clear (a defect) or anyFilterApplied() answers "yes" unconditionally.
//
// The reader treats EVERY visible [aria-expanded] element whose text is not one of three bare
// labels as evidence of a selection. The community page also renders sidebar and account menus,
// and any of those carrying aria-expanded would satisfy that on a page with no filter applied
// at all — making the reader incapable of ever returning false.
//
// So this prints, on a FRESH page (nothing applied) and again with one filter applied, exactly
// what the reader is looking at: the Clear All flag and every [aria-expanded] element it counts
// as a chip. If the fresh page already reports true, the reader is the bug. Read-only.
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
  await cm.gotoCommunity(process.argv[2] || '37');

  const dump = async (tag) => {
    const raw = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return {
        clearAll: Array.from(document.querySelectorAll('button,a')).filter(vis)
          .filter((x) => /^clear all$/i.test(clean(x.textContent))).length,
        ariaExpanded: Array.from(document.querySelectorAll('[aria-expanded]')).filter(vis)
          .map((e) => ({ tag: e.tagName, text: clean(e.textContent).slice(0, 60), expanded: e.getAttribute('aria-expanded') })),
      };
    });
    console.log(`\n### ${tag}`);
    console.log(` anyFilterApplied() -> ${await cm.anyFilterApplied()}`);
    console.log(` visible "Clear all" controls: ${raw.clearAll}`);
    console.log(' [aria-expanded] elements the reader inspects:');
    raw.ariaExpanded.forEach((e) => console.log(`   - <${e.tag} aria-expanded=${e.expanded}> "${e.text}"`));
  };

  await dump('FRESH — nothing applied');

  await cm.openFilter('Member Type');
  console.log('\nselected:', JSON.stringify(await cm.selectFilterOption(0)));
  await cm.closeAnyPopover();
  await dump('ONE filter applied');

  await cm.clearAllControl().click({ timeout: 15000 }).catch((e) => console.log('clear click failed:', e.message.split('\n')[0]));
  await cm.settle(1500);
  await dump('AFTER clicking Clear All');

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
