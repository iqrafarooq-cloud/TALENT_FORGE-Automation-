/* eslint-disable no-console */
// Which preview belongs to which image field, and which "Remove photo" button removes which?
//
// Two suite defects need this answered from the DOM rather than guessed:
//   1. hasPreview('Cover Photo') returns true if ANY preview is on screen, so the profile's
//      preview makes a REMOVED cover look present.
//   2. removeImage() picks the remove button by INDEX (nth(0) = cover, nth(1) = profile),
//      which is the "picking by index is a guess that fails silently" antipattern the upload
//      code in the same Page Object already warns against.
//
// Dumps every preview <img> with its geometry and ancestor chain, and every remove/change
// control with its own geometry, so the two can be bound by containment or proximity instead.
// Uploads both images, removes one, and dumps again. NEVER SAVES.
require('dotenv').config();
const { chromium } = require('playwright');
const CommunityFormPage = require('../pages/CommunityFormPage');

const SNAPSHOT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // A short, readable identity for an element's ancestors — enough to see whether the cover
  // preview and a given remove button share a container.
  const chain = (el) => {
    const out = [];
    let n = el;
    for (let i = 0; i < 6 && n && n !== document.body; i += 1) {
      out.push(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}.${(n.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`);
      n = n.parentElement;
    }
    return out;
  };

  const previews = Array.from(document.querySelectorAll('img')).filter(vis)
    .filter((i) => /^blob:|^data:/.test(i.src) || /community\/(logos|background-images)/.test(i.src))
    .map((i) => ({
      kind: /^blob:|^data:/.test(i.src) ? 'blob' : 'remote',
      alt: i.alt || null,
      box: box(i),
      radius: getComputedStyle(i).borderRadius,
      chain: chain(i),
    }));

  const controls = Array.from(document.querySelectorAll('button,a')).filter(vis)
    .filter((b) => /change|edit|remove|delete|upload/i.test(`${t(b)} ${b.getAttribute('aria-label') || ''}`))
    .map((b) => ({
      text: t(b),
      aria: b.getAttribute('aria-label'),
      box: box(b),
      chain: chain(b),
    }));

  return { previews, controls };
};

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await c.newPage();
  const BASE = process.env.BASE_URL;
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type="email"],input[name="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await p.locator('input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  const f = new CommunityFormPage(p);
  await f.gotoCreate();

  const dump = async (tag) => {
    const s = await p.evaluate(SNAPSHOT);
    console.log(`\n############ ${tag}`);
    console.log('PREVIEWS:');
    s.previews.forEach((v, i) => console.log(` [${i}] ${v.kind} alt=${JSON.stringify(v.alt)} box=${JSON.stringify(v.box)} radius=${v.radius}\n      chain=${v.chain.join(' < ')}`));
    console.log('CONTROLS:');
    s.controls.forEach((v, i) => console.log(` [${i}] "${v.text}" aria=${JSON.stringify(v.aria)} box=${JSON.stringify(v.box)}\n      chain=${v.chain.join(' < ')}`));
  };

  await dump('fresh form');

  console.log('\n>> upload COVER (JPG 8)');
  console.log(JSON.stringify(await f.uploadImage('Cover Photo', 'JPG', 8)));
  await dump('after cover only');

  console.log('\n>> upload PROFILE (PNG 5)');
  console.log(JSON.stringify(await f.uploadImage('Profile Photo', 'PNG', 5)));
  await dump('after both');

  // Click each remove button by index and report what actually disappeared — the only way to
  // learn which button owns which image without trusting the order.
  const removes = p.getByRole('button', { name: /remove( photo)?|delete/i });
  const n = await removes.count();
  console.log(`\n>> ${n} remove control(s); clicking index 0`);
  await removes.nth(0).click({ timeout: 10000 });
  await p.waitForTimeout(1200);
  await dump('after clicking remove[0]');

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
