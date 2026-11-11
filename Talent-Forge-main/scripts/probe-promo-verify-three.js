// probe-promo-verify-three.js — live ground truth for the three Promo Tools scenarios that the
// user reports passing MANUALLY while the suite reports them red:
//
//   A) "the Add modal gates Save until every required field is filled"
//        -> red with: after filling Value, Expiry Date: ENABLED while Usage Limit is still empty
//   B) "a disabled promo greys out ..."
//        -> red with: banner/parameters not greyed out, not blurred
//   C) "saving promo parameters confirms with the wording the AC specifies"
//        -> red with: no toast appeared at all (readToastText() === null)
//
// For each, this captures what the DOM ACTUALLY holds rather than asking a locator whether the
// expected thing is present — a locator for the expected state can only ever answer "absent",
// which is exactly how all three of these got recorded as app defects.
//
//   node scripts/probe-promo-verify-three.js
//
// SAFETY: Part A always CANCELS (the no-promo agent is the only Case-4 fixture and there is no UI
// to remove a promo). Parts B and C snapshot the promo's parameters first and restore them in a
// `finally`, so a crash mid-probe cannot leave the limited agent's promo disabled.
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');

const NOPROMO = process.env.REFERRAL_NOPROMO_AGENT_NAME || process.env.REFERRAL_NOPROMO_AGENT_EMAIL;
const UNLIMITED = process.env.PROMO_UNLIMITED_AGENT_NAME || process.env.PROMO_UNLIMITED_AGENT_EMAIL;
const LIMITED = process.env.PROMO_LIMITED_AGENT_NAME || process.env.PROMO_LIMITED_AGENT_EMAIL;

const isoDaysFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

// ---------------------------------------------------------------- modal field truth
// Every input the dialog holds, plus the dialog's own innerText so the positional
// assumption in the page object ("promo name, Value, Usage Limit") can be checked against the
// labels the app actually renders.
const dumpModal = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return null;
  const norm = (s) => (s || '').replace(/[ \t]+/g, ' ').trim();
  const save = [...dlg.querySelectorAll('button')].find((b) => /save changes/i.test(b.textContent || ''));
  return {
    lines: norm(dlg.innerText).split('\n').map((l) => l.trim()).filter(Boolean),
    save: save ? { disabled: save.disabled, ariaDisabled: save.getAttribute('aria-disabled') } : null,
    inputs: [...dlg.querySelectorAll('input')].map((el, i) => ({
      i,
      type: el.type,
      role: el.getAttribute('role'),
      value: el.value,
      placeholder: el.placeholder || null,
      name: el.name || null,
      id: el.id || null,
      disabled: el.disabled,
      required: el.required,
      ariaLabel: el.getAttribute('aria-label'),
      ariaInvalid: el.getAttribute('aria-invalid'),
      // Nearest ancestor text that is short enough to be a field label.
      near: (() => {
        let n = el.parentElement;
        for (let h = 0; n && h < 5; h += 1, n = n.parentElement) {
          const first = [...n.childNodes]
            .filter((c) => c.nodeType === 1 && !c.contains(el))
            .map((c) => norm(c.textContent))
            .find((t) => t && t.length <= 40);
          if (first) return first;
        }
        return null;
      })(),
    })),
  };
});

const reportModal = async (page, label) => {
  const m = await dumpModal(page);
  if (!m) return console.log(`  ${label}: NO DIALOG`);
  const save = m.save ? (m.save.disabled ? 'disabled' : 'ENABLED') : '(no Save button)';
  console.log(`\n  --- ${label} --- Save=${save}`);
  for (const f of m.inputs) {
    console.log(
      `    [${f.i}] type=${f.type}${f.role ? ` role=${f.role}` : ''} `
      + `value=${JSON.stringify(f.value)} ${f.disabled ? 'DISABLED ' : ''}`
      + `${f.required ? 'required ' : ''}placeholder=${JSON.stringify(f.placeholder)} `
      + `aria-label=${JSON.stringify(f.ariaLabel)} aria-invalid=${JSON.stringify(f.ariaInvalid)} `
      + `near=${JSON.stringify(f.near)}`
    );
  }
  return m;
};

// ---------------------------------------------------------------- visual-treatment truth
// Every element on the page carrying ANY greying / blurring / disabling signal, in whatever form.
// Deliberately not scoped to the two sections: the point is to find out whether the app applies
// the treatment somewhere the step is not looking (a wrapper, an overlay sibling, a descendant).
const dumpVisual = (page) => page.evaluate(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const all = [...document.querySelectorAll('body *')];
  const findExact = (re) => all.find((e) => re.test(norm(e.textContent)) && e.children.length <= 3);

  const chain = (start) => {
    const out = [];
    let el = start;
    for (let i = 0; el && i < 9; i += 1, el = el.parentElement) {
      const s = getComputedStyle(el);
      out.push({
        up: i,
        tag: el.tagName,
        cls: String(el.getAttribute('class') || '').slice(0, 170),
        opacity: s.opacity,
        filter: s.filter,
        backdropFilter: s.backdropFilter || s.webkitBackdropFilter || 'none',
      });
    }
    return out;
  };

  const signals = [];
  for (const el of all) {
    const s = getComputedStyle(el);
    const cls = String(el.getAttribute('class') || '');
    const op = parseFloat(s.opacity);
    const hits = [];
    if (!Number.isNaN(op) && op < 1) hits.push(`opacity=${s.opacity}`);
    if (s.filter && s.filter !== 'none') hits.push(`filter=${s.filter}`);
    const bd = s.backdropFilter || s.webkitBackdropFilter;
    if (bd && bd !== 'none') hits.push(`backdrop=${bd}`);
    if (/(^|\s|:)(blur|backdrop-blur|opacity-\d|grayscale|saturate-0|cursor-not-allowed|select-none)/i.test(cls)) {
      hits.push('class-signal');
    }
    if (hits.length) {
      signals.push({ tag: el.tagName, cls: cls.slice(0, 150), hits, text: norm(el.textContent).slice(0, 70) });
    }
  }

  const codeLbl = findExact(/^Promo Code$/i);
  const paramsLbl = findExact(/^Code Parameters$/i);
  return {
    bannerChain: codeLbl ? chain(codeLbl.parentElement) : null,
    paramsChain: paramsLbl ? chain(paramsLbl.parentElement) : null,
    signalCount: signals.length,
    signals: signals.slice(0, 40),
  };
});

const reportVisual = (label, v) => {
  console.log(`\n  --- ${label} ---`);
  console.log(`  elements carrying any grey/blur/disable signal: ${v.signalCount}`);
  for (const s of v.signals) {
    console.log(`    <${s.tag}> ${s.hits.join(' ')} class="${s.cls}" text="${s.text}"`);
  }
  for (const [name, ch] of [['banner', v.bannerChain], ['parameters', v.paramsChain]]) {
    console.log(`  ${name} ancestor chain:`);
    if (!ch) { console.log('    (label not found)'); continue; }
    for (const n of ch) {
      console.log(
        `    +${n.up} <${n.tag}> opacity=${n.opacity} filter=${n.filter} `
        + `backdrop=${n.backdropFilter} class="${n.cls}"`
      );
    }
  }
};

(async () => {
  for (const [k, v] of Object.entries({ NOPROMO, UNLIMITED, LIMITED })) {
    if (!v) throw new Error(`${k} is not configured in .env`);
  }

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

  // ================================================================ A. Add-modal gating
  hr('A. ADD MODAL — what each input really is, and when Save unlocks');
  const hasPromo = await admin.openPromoToolsAllowingEmpty(NOPROMO);
  if (hasPromo) {
    console.log(`  SKIPPED: ${NOPROMO} now HAS a promo code, so the Add modal cannot be opened.`);
  } else {
    await admin.openAddParameters();
    try {
      await reportModal(page, 'on open (nothing entered)');

      await admin.setValueAndBlur('15');
      await reportModal(page, 'after setValueAndBlur("15")   [page object writes inputs.nth(1)]');

      await admin.setExpiryDate(isoDaysFromToday(30));
      await page.waitForTimeout(600);
      await reportModal(page, `after setExpiryDate(${isoDaysFromToday(30)})`);

      await admin.setUsageLimitAndBlur('25');
      await reportModal(page, 'after setUsageLimitAndBlur("25")   [page object writes inputs.last()]');
    } finally {
      await admin.cancelEdit().catch(() => {});
      console.log('\n  CANCELLED — nothing created for the no-promo fixture.');
    }
  }

  // ================================================================ B. Save toast wording
  hr('B. SAVE TOAST — every node the app inserts when Save Changes is clicked');
  await admin.openPromoTools(UNLIMITED);
  const snapB = await admin.snapshotParameters();
  console.log(`  snapshot before editing: ${JSON.stringify(snapB)}`);
  try {
    await admin.openEditParameters();
    await admin.setExpiryDate(isoDaysFromToday(45));
    await page.waitForTimeout(400);
    console.log(`  Save is ${(await admin.isSaveEnabled()) ? 'ENABLED' : 'disabled'} before the click`);

    // Record every element inserted anywhere in the document from the moment of the click. The
    // toast auto-dismisses, so a post-hoc locator query is structurally unable to see it.
    await page.evaluate(() => {
      window.__added = [];
      window.__obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const text = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            window.__added.push({
              at: window.__added.length,
              tag: n.tagName,
              cls: String(n.getAttribute('class') || ''),
              role: n.getAttribute('role'),
              testid: n.getAttribute('data-testid'),
              text: text.slice(0, 160),
              html: n.outerHTML.slice(0, 300),
            });
          }
        }
      });
      window.__obs.observe(document.body, { childList: true, subtree: true });
    });

    await admin.saveButton.click();

    // Poll for anything that looks like a confirmation, so a short-lived toast is caught even if
    // the MutationObserver saw it as a text-only update rather than an inserted element.
    const seen = [];
    for (let i = 0; i < 24; i += 1) {
      const hit = await page.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('body *')]
          .filter((e) => e.children.length <= 2 && /success|updated|added|saved/i.test(norm(e.textContent)))
          .map((e) => ({
            tag: e.tagName,
            cls: String(e.getAttribute('class') || '').slice(0, 140),
            role: e.getAttribute('role'),
            testid: e.getAttribute('data-testid'),
            text: norm(e.textContent).slice(0, 160),
          }));
      });
      for (const h of hit) {
        if (!seen.some((s) => s.text === h.text && s.cls === h.cls)) seen.push({ ...h, atMs: i * 250 });
      }
      await page.waitForTimeout(250);
    }

    const added = await page.evaluate(() => {
      if (window.__obs) window.__obs.disconnect();
      return window.__added || [];
    });

    console.log(`\n  --- polled confirmation-looking elements (${seen.length}) ---`);
    for (const s of seen) {
      console.log(`    +${s.atMs}ms <${s.tag}> role=${s.role} testid=${s.testid} text=${JSON.stringify(s.text)}`);
      console.log(`      class="${s.cls}"`);
    }

    const toastish = added.filter((a) => /success|updated|added|saved/i.test(a.text));
    console.log(`\n  --- inserted nodes whose text looks like a confirmation (${toastish.length} of ${added.length} inserted) ---`);
    for (const a of toastish.slice(0, 12)) {
      console.log(`    <${a.tag}> role=${a.role} testid=${a.testid} text=${JSON.stringify(a.text)}`);
      console.log(`      class="${a.cls}"`);
      console.log(`      html=${a.html}`);
    }
    if (!toastish.length) {
      console.log('    NONE. First 12 inserted nodes, for context:');
      for (const a of added.slice(0, 12)) {
        console.log(`    <${a.tag}> role=${a.role} cls="${a.cls.slice(0, 90)}" text=${JSON.stringify(a.text.slice(0, 90))}`);
      }
    }

    // Does the page object's own locator match any of it?
    console.log(`\n  page object anyToast count now: ${await admin.anyToast.count()}`);
  } finally {
    const r = await admin.restoreParameters(snapB);
    console.log(`  restore(unlimited): ${JSON.stringify(r)}`);
  }

  // ================================================================ C. Disabled greying/blurring
  hr('C. DISABLED PROMO — is any grey/blur treatment applied, and where?');
  await admin.openPromoTools(LIMITED);
  const snapC = await admin.snapshotParameters();
  console.log(`  snapshot before disabling: ${JSON.stringify(snapC)}`);
  try {
    const active = await dumpVisual(page);
    reportVisual('ACTIVE (status on)', active);

    await admin.setStatusAndSave(false);
    await admin.refreshPromoTools();
    await page.waitForTimeout(1500);
    console.log(`\n  Status parameter now reads: ${JSON.stringify(await admin.readParameter('Status'))}`);

    const disabled = await dumpVisual(page);
    reportVisual('DISABLED (status off)', disabled);

    const key = (s) => `${s.tag}|${s.cls}|${s.hits.join(',')}`;
    const before = new Set(active.signals.map(key));
    const gained = disabled.signals.filter((s) => !before.has(key(s)));
    console.log(`\n  --- signals present ONLY while disabled (${gained.length}) ---`);
    for (const s of gained) {
      console.log(`    <${s.tag}> ${s.hits.join(' ')} class="${s.cls}" text="${s.text}"`);
    }
    if (!gained.length) {
      console.log('    NONE — the disabled render carries no greying/blurring signal the active one lacks.');
    }
    console.log(`\n  what the step's own reader sees: ${JSON.stringify(await admin.readSectionVisuals())}`);
    await page.screenshot({ path: 'reports/probe-promo-disabled.png', fullPage: true });
    console.log('  full-page screenshot: reports/probe-promo-disabled.png');
  } finally {
    const r = await admin.restoreParameters(snapC);
    console.log(`  restore(limited): ${JSON.stringify(r)}`);
    console.log(`  status after restore: ${JSON.stringify(await admin.readParameter('Status').catch(() => null))}`);
  }

  await context.close();
  await browser.close();
})().catch((e) => { console.error('\nPROBE FAILED:', e); process.exit(1); });
