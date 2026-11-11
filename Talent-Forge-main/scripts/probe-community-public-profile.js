/* eslint-disable no-console */
// Does the public profile really omit the Major the candidate card shows?
//
// The scenario asserts name + major + track and fails only on major ("the profile does not show
// the major shown on the card: 'AI Prompter'"). Two readings the report cannot separate:
//   (a) the public profile genuinely does not carry the major — an app defect against AC 8.1
//   (b) it carries it under a different word or a truncation, and a body-text search misses it
// So this opens the first member's public profile and prints its whole visible text plus its
// field labels, letting the answer be read off the page instead of inferred. Read-only.
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
  const id = process.argv[2] || '37';
  await cm.gotoCommunity(id);
  const members = await cm.readMemberCards();
  const m = members[0];
  console.log(`Card 0: name="${m.name}" major="${m.major}" track="${m.track}" gradYear="${m.gradYear}"`);

  await p.locator('button,a').filter({ hasText: /view profile/i }).first().click();
  await p.waitForTimeout(4000);
  console.log(`\nProfile URL: ${p.url()}`);

  const body = await p.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim());
  console.log('\n=== VISIBLE PROFILE TEXT ===');
  console.log(body.slice(0, 2500));

  for (const field of [m.name, m.major, m.track, m.gradYear]) {
    if (!field || field === '—') continue;
    console.log(`\ncontains "${field}"? ${new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body)}`);
  }

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
