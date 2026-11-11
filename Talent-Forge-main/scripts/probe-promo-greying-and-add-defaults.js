// probe-promo-greying-and-add-defaults.js — the two questions probe-promo-verify-three.js left open.
//
//   node scripts/probe-promo-greying-and-add-defaults.js
//
// [A] ADD MODAL DEFAULTS. The first probe showed that after setValueAndBlur("15") the Add modal
//     ALSO held a promo code name, an expiry date (+45d) and a usage limit of 30 — none of which
//     the test typed. Either the app self-populates those defaults asynchronously a moment after
//     the modal opens, or it does it in response to the first interaction. The difference decides
//     whether "Save Changes should be disabled on the freshly opened modal" is a real assertion or
//     a race that happens to win: if Save enables with NOTHING touched, a promo can be saved
//     without the superadmin entering anything. So: open the modal and touch NOTHING for 6s.
//
// [B] "GREYED OUT". The first probe reported no opacity, no blur() and no muting class in either
//     state, and concluded the app applies no treatment — but its screenshot shows the promo code
//     rendered in GREY. That scan was blind to a treatment applied through `color`, which is what
//     "greyed out" most naturally means. This diffs the computed COLOUR of every text node in the
//     banner and Code Parameters cards between Active and Disabled, and screenshots both.
//
// SAFETY: [A] always cancels. [B] snapshots the promo first and restores it in a `finally`.
require('dotenv').config();
const fs = require('fs');
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const NOPROMO = process.env.REFERRAL_NOPROMO_AGENT_NAME || process.env.REFERRAL_NOPROMO_AGENT_EMAIL;
const LIMITED = process.env.PROMO_LIMITED_AGENT_NAME || process.env.PROMO_LIMITED_AGENT_EMAIL;
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

// Every text-bearing element inside the two promo cards, with the colour it is painted in.
// Keyed by "card|text" so the same row can be compared across the two states.
const dumpText = (page) => page.evaluate(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const all = [...document.querySelectorAll('body *')];
  const findExact = (re) => all.find((e) => re.test(norm(e.textContent)) && e.children.length <= 3);

  const cardOf = (label, hops) => {
    let el = label;
    for (let i = 0; el && i < hops; i += 1) el = el.parentElement;
    return el;
  };
  const codeLbl = findExact(/^Promo Code$/i);
  const paramsLbl = findExact(/^Code Parameters$/i);
  const cards = {
    banner: codeLbl ? cardOf(codeLbl.parentElement, 1) : null,
    parameters: paramsLbl ? paramsLbl.parentElement : null,
  };

  const out = {};
  for (const [name, card] of Object.entries(cards)) {
    if (!card) { out[name] = null; continue; }
    const rows = [];
    for (const el of card.querySelectorAll('*')) {
      // Leaf-ish elements only, so a value is reported once rather than once per wrapper.
      const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
      if (!own) continue;
      const s = getComputedStyle(el);
      rows.push({
        text: own.slice(0, 40),
        tag: el.tagName,
        color: s.color,
        fill: s.webkitTextFillColor || null,
        opacity: s.opacity,
        filter: s.filter,
        cls: String(el.getAttribute('class') || '').slice(0, 120),
      });
    }
    out[name] = { cardClass: String(card.getAttribute('class') || '').slice(0, 200), rows };
  }
  return out;
});

const shotPanel = async (page, path) => {
  const main = page.locator('main').first();
  await main.screenshot({ path }).catch(async () => { await page.screenshot({ path, fullPage: true }); });
  console.log(`  screenshot: ${path}`);
};

(async () => {
  if (!NOPROMO || !LIMITED) throw new Error('REFERRAL_NOPROMO_AGENT_* / PROMO_LIMITED_AGENT_* missing from .env');
  fs.mkdirSync('reports', { recursive: true });

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false', slowMo: 20 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(process.env.SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(process.env.SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  const admin = new AdminPromoToolsPage(page);

  // ============================================================ A. Add modal, untouched
  hr('A. ADD MODAL LEFT COMPLETELY UNTOUCHED — do defaults arrive on their own?');
  const hasPromo = await admin.openPromoToolsAllowingEmpty(NOPROMO);
  if (hasPromo) {
    console.log(`  SKIPPED: ${NOPROMO} now has a promo code.`);
  } else {
    await admin.openAddParameters();
    try {
      let elapsed = 0;
      for (const ms of [0, 500, 1000, 2000, 4000, 6000]) {
        if (ms > elapsed) { await page.waitForTimeout(ms - elapsed); elapsed = ms; }
        const snap = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          const save = [...dlg.querySelectorAll('button')].find((b) => /save changes/i.test(b.textContent || ''));
          return {
            save: save ? (save.disabled ? 'disabled' : 'ENABLED') : '?',
            inputs: [...dlg.querySelectorAll('input')]
              .filter((el) => el.type === 'text' || el.type === 'date')
              .map((el) => `${el.type}=${JSON.stringify(el.value)}`),
          };
        });
        console.log(`  t+${String(ms).padStart(4)}ms  Save=${snap.save.padEnd(8)} ${snap.inputs.join('  ')}`);
      }
      console.log('\n  (no click, no typing, no focus change happened above)');
    } finally {
      await admin.cancelEdit().catch(() => {});
      console.log('  CANCELLED — nothing created for the no-promo fixture.');
    }
  }

  // ============================================================ B. "Greyed out" as colour
  hr('B. DISABLED PROMO — is the greying done with COLOUR rather than opacity/filter?');
  await admin.openPromoTools(LIMITED);
  const snap = await admin.snapshotParameters();
  console.log(`  snapshot before disabling: ${JSON.stringify(snap)}`);
  try {
    await page.waitForTimeout(800);
    const active = await dumpText(page);
    await shotPanel(page, 'reports/probe-promo-ACTIVE.png');

    await admin.setStatusAndSave(false);
    await admin.refreshPromoTools();
    await page.waitForTimeout(1500);
    console.log(`  Status now reads: ${JSON.stringify(await admin.readParameter('Status'))}`);
    const disabled = await dumpText(page);
    await shotPanel(page, 'reports/probe-promo-DISABLED.png');

    for (const card of ['banner', 'parameters']) {
      console.log(`\n  --- ${card}: colour per row, Active -> Disabled ---`);
      const a = (active[card] && active[card].rows) || [];
      const d = (disabled[card] && disabled[card].rows) || [];
      console.log(`  card class ACTIVE  : ${(active[card] || {}).cardClass}`);
      console.log(`  card class DISABLED: ${(disabled[card] || {}).cardClass}`);
      const byText = new Map(a.map((r) => [r.text, r]));
      let changed = 0;
      for (const r of d) {
        const before = byText.get(r.text);
        const was = before ? before.color : '(absent while active)';
        const flag = before && before.color !== r.color ? 'CHANGED' : '       ';
        if (flag.trim()) changed += 1;
        console.log(`    ${flag} "${r.text}"  ${was}  ->  ${r.color}   opacity=${r.opacity} filter=${r.filter}`);
      }
      console.log(`  rows whose colour changed: ${changed} of ${d.length}`);
    }
  } finally {
    const r = await admin.restoreParameters(snap);
    console.log(`\n  restore(limited): ${JSON.stringify(r)}`);
    console.log(`  status after restore: ${JSON.stringify(await admin.readParameter('Status').catch(() => null))}`);
  }

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
