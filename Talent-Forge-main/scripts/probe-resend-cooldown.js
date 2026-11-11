// >>> HOW LONG IS THE RESEND-INVITE COOLDOWN, AND WHAT MAKES THE ICON GO DISABLED?
//
// Nothing in this repo had measured it. InProgressCandidatePage.js says in as many words that
// "Resend is deliberately never clicked", and AgentsListingPage documents the superadmin resend
// dialog and its endpoint but nothing about a cooldown - so the answer was not derivable from the
// code, only from the running app.
//
// THERE ARE TWO DIFFERENT RESEND CONTROLS AND THEY MUST NOT BE CONFLATED:
//
//   agent      Agent Portal > Candidates > In Progress > row > Resend icon
//              [data-testid="agent-candidates-resend-invite-button"]
//   superadmin SuperAdmin > User Management > Agents > "Invite Sent" tab > row > Resend Invite,
//              which opens a "Resend Invitation" dialog -> POST /admin/invite/resend/agent/
//
// PASS ONE IS READ-ONLY AND COSTS NOTHING. It reports every resend control's disabled state plus
// anything that could carry a countdown (visible text, title, aria-label, tooltip on hover). If a
// row is ALREADY cooling down from an earlier action, that alone answers the question - and it can
// be watched to expiry without sending anything.
//
// --click SENDS A REAL EMAIL. Only then does it click one resend, and then it polls the control
// until it re-enables, timestamping every transition. No account is created either way: resending
// an invitation to an already-invited person creates nothing new.
//
// USAGE
//   node scripts/probe-resend-cooldown.js                     read-only, both surfaces
//   node scripts/probe-resend-cooldown.js --surface agent     one surface only
//   node scripts/probe-resend-cooldown.js --click             measure it properly (SENDS MAIL)
//   node scripts/probe-resend-cooldown.js --click --max 900   give up after N seconds (default 420)
require('dotenv').config();
const { chromium } = require('playwright');
const LoginPage = require('../pages/LoginPage');
const InProgressCandidatePage = require('../pages/InProgressCandidatePage');
const AgentsListingPage = require('../pages/AgentsListingPage');

const argv = process.argv.slice(2);
const CLICK = argv.includes('--click');
const MAX_S = Number((argv[argv.indexOf('--max') + 1] || '')) > 0
  ? Number(argv[argv.indexOf('--max') + 1]) : 420;
const ONLY = argv.includes('--surface') ? argv[argv.indexOf('--surface') + 1] : null;
const line = console.log;
const now = () => Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// Read a control's disabled-ness from EVERY source that could carry it, and report them all.
// The repo has been caught twice guessing one CSS property (the community greying, the disabled
// reminder icon whose opacity is 1 in both states and whose class list is byte-identical), so this
// deliberately does not pick a winner.
// >>> THESE MUST BE REAL FUNCTIONS, NOT STRINGS. Playwright evaluates a STRING as a JS
//     expression, so a string holding an arrow function evaluates to a function OBJECT, which is
//     not serialisable - it comes back as `undefined` and the probe reports nothing while looking
//     like it ran. That is exactly what the first run did: "countdown-shaped text: undefined" and
//     an empty per-row survey against 10 rows that were plainly there.
const STATE_FN = (btn) => {
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const host = btn.closest('[role="row"]') || btn.parentElement;
  return {
    disabledProp: btn.disabled === true,
    ariaDisabled: btn.getAttribute('aria-disabled'),
    cursor: cs.cursor,
    pointerEvents: cs.pointerEvents,
    opacity: cs.opacity,
    title: btn.getAttribute('title') || null,
    ariaLabel: btn.getAttribute('aria-label') || null,
    text: (btn.innerText || '').replace(/\s+/g, ' ').trim() || null,
    // A countdown is usually rendered as a sibling or on the row, not on the button itself.
    nearbyText: host ? (host.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
    classes: typeof btn.className === 'string' ? btn.className : null,
  };
};

// Anything on the page that looks like a countdown, wherever it lives. mm:ss, "in 60 seconds",
// "try again in ...", "wait ...". Reported verbatim - never matched against a string we hoped for,
// which could only ever answer "absent".
const COUNTDOWN_FN = () => {
  const out = [];
  const re = /(\d{1,2}:\d{2})|((?:in|after|wait|try again in)\s+\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes))/i;
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 120 && re.test(t)) out.push(t);
  }
  return Array.from(new Set(out));
};

async function signIn(page, email, password) {
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  await login.submitButton.first().click();
  await page.waitForURL(/dashboard|candidates|agents|admin/, { timeout: 60000, waitUntil: 'commit' });
}

// Watch the resend endpoints. The RESPONSE is the most authoritative source there is for a
// cooldown - a 429 with Retry-After, or a body naming the remaining seconds, beats any amount of
// DOM watching. Captured whether or not anything is clicked.
function watchApi(page, store) {
  page.on('response', async (res) => {
    if (!/invite\/resend|resend.*invite|invite\/candidate/i.test(res.url())) return;
    let body = null;
    try { body = (await res.text()).slice(0, 600); } catch (e) { /* body may be gone */ }
    store.push({
      at: new Date().toISOString(),
      url: res.url(),
      status: res.status(),
      retryAfter: res.headers()['retry-after'] || null,
      body,
    });
  });
}

/**
 * >>> SAMPLE FAST, IMMEDIATELY, BEFORE READING ANYTHING ELSE.
 *
 * The first measuring run reported "actionable again 5.6s after the resend" - but its first
 * sample was taken 5.6s in, after confirming a dialog, waiting 1.2s and reading toasts. So it
 * could not distinguish "never disabled" from "disabled for four seconds", and those are
 * different answers to the question being asked.
 *
 * This runs at 100ms from t0 for `windowMs`, and it is started BEFORE the toast/countdown reads
 * so nothing slow sits between the click and the first sample. It reports whether the control was
 * EVER seen disabled, and for how long.
 */
async function sampleFast(readState, t0, windowMs = 15000) {
  const seen = [];
  let everDisabled = false;
  let firstDisabledAt = null;
  let lastDisabledAt = null;
  const deadline = now() + windowMs;
  while (now() < deadline) {
    const s = await readState();
    if (s) {
      const off = s.disabledProp === true || s.ariaDisabled === 'true';
      if (off) {
        everDisabled = true;
        if (firstDisabledAt === null) firstDisabledAt = now() - t0;
        lastDisabledAt = now() - t0;
      }
      seen.push({ atMs: now() - t0, disabled: off, cursor: s.cursor, text: s.text });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { everDisabled, firstDisabledAt, lastDisabledAt, samples: seen.length, seen };
}

/** Poll a control until it is enabled again, or MAX_S elapses. Reports every transition. */
async function watchUntilEnabled(readState, t0) {
  let last = null;
  const transitions = [];
  const deadline = now() + MAX_S * 1000;
  while (now() < deadline) {
    const s = await readState();
    if (!s) { line(`    [${secs(now() - t0)}] control no longer present`); break; }
    const key = `${s.disabledProp}|${s.ariaDisabled}|${s.cursor}|${s.text}`;
    if (key !== last) {
      transitions.push({ atMs: now() - t0, state: s });
      line(`    [${secs(now() - t0)}] disabled=${s.disabledProp} aria=${s.ariaDisabled} `
        + `cursor=${s.cursor} text=${JSON.stringify(s.text)}`);
      last = key;
    }
    if (s.disabledProp === false && s.ariaDisabled !== 'true') {
      return { enabledAfterMs: now() - t0, transitions, timedOut: false };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { enabledAfterMs: null, transitions, timedOut: true };
}

// ---------------------------------------------------------------------------------------------
// Surface 1: the AGENT portal's In Progress resend icon
// ---------------------------------------------------------------------------------------------
async function agentSurface(browser, api) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watchApi(page, api);
  try {
    line('\n================ SURFACE: agent portal, In Progress > Resend icon ================');
    const ip = new InProgressCandidatePage(page);
    ip.install();
    await signIn(page, process.env.AGENT_EMAIL, process.env.AGENT_PASSWORD);
    await ip.navigate();
    // "Invite Sent" is the only tab where a resend can apply - the candidate has not signed up.
    await ip.clickQuickFilter('Invite Sent').catch(() => {});
    await page.waitForTimeout(3500);

    const btns = page.locator('[data-testid="agent-candidates-resend-invite-button"], button[aria-label="Resend"]');
    const n = await btns.count();
    line(`  resend controls on page 1: ${n}`);
    if (!n) { line('  none - nothing to measure on this surface.'); return; }

    const states = [];
    for (let i = 0; i < n; i += 1) {
      states.push(await btns.nth(i).evaluate(STATE_FN));
    }
    const disabled = states.filter((s) => s && (s.disabledProp || s.ariaDisabled === 'true'));
    line(`  already disabled: ${disabled.length} of ${n}`);
    states.slice(0, 6).forEach((s, i) => line(`    [${i}] ${s ? JSON.stringify({
      disabledProp: s.disabledProp, ariaDisabled: s.ariaDisabled, cursor: s.cursor,
      opacity: s.opacity, title: s.title, text: s.text, nearby: (s.nearbyText || '').slice(0, 90),
    }) : 'could not be read'}`));
    line(`  countdown-shaped text anywhere on the page: ${JSON.stringify(await page.evaluate(COUNTDOWN_FN))}`);

    // Hovering can reveal a tooltip that says why it is disabled / how long is left.
    if (disabled.length) {
      const idx = states.findIndex((s) => s && (s.disabledProp || s.ariaDisabled === 'true'));
      await btns.nth(idx).hover({ force: true }).catch(() => {});
      await page.waitForTimeout(1200);
      line(`  after hovering the disabled one - tooltips: ${JSON.stringify(
        await page.locator('[role="tooltip"], [data-tooltip], .tooltip').allInnerTexts().catch(() => [])
      )}`);
      line(`  countdown text after hover: ${JSON.stringify(await page.evaluate(COUNTDOWN_FN))}`);

      line('\n  >>> A CONTROL IS ALREADY COOLING DOWN - watching it to expiry, sending NOTHING.');
      const t0 = now();
      const r = await watchUntilEnabled(() => btns.nth(idx).evaluate(STATE_FN).catch(() => null), t0);
      line(r.timedOut
        ? `  still disabled after ${MAX_S}s (this is a LOWER BOUND, the cooldown started before the probe did)`
        : `  re-enabled after ${secs(r.enabledAfterMs)} of watching - again a LOWER BOUND on the full cooldown`);
      return;
    }

    if (!CLICK) {
      line('\n  every control is ENABLED, so there is no cooldown in progress to observe.');
      line('  Re-run with --click to send one real invitation email and measure it properly.');
      return;
    }

    // --- the measuring run ---------------------------------------------------------------
    //
    // >>> RESEND ONLY TO AN ADDRESS THIS SUITE OWNS. Row 0 is often someone else's test data -
    //     the read-only pass found ghazan+09@, muhammad.awwab@, gsubz@yopmail.com on page 1 - and
    //     a resend puts a real email in a real person's inbox. Prefer the project's own mailbox
    //     aliases, and refuse outright rather than mail a stranger to satisfy a measurement.
    const OURS = /(iqra\.farooq\+|test\.candidate|@iqra\.anonaddy\.com)/i;
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      const addr = ((states[i] && states[i].nearbyText) || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (addr && OURS.test(addr[0])) { pick = i; break; }
    }
    if (pick < 0) {
      line('\n  >>> NO SUITE-OWNED invite on page 1 - refusing to resend, it would email a stranger.');
      return;
    }
    line(`\n  >>> CLICKING RESEND on: ${JSON.stringify((states[pick].nearbyText || '').slice(0, 140))}`);
    const readIcon = () => btns.nth(pick).evaluate(STATE_FN).catch(() => null);

    // This surface puts a confirmation dialog in front of the resend, so the ROW icon's own click
    // sends nothing - t0 has to be the dialog's confirm. Getting that wrong is what made the first
    // run's "1.7s" meaningless: it timed from the icon click, through a dialog, to the first
    // sample, and sampled nothing in between.
    await btns.nth(pick).click();
    await page.waitForTimeout(700);
    const dlg = page.locator('[role="dialog"]').filter({ hasText: /resend/i }).first();
    let t0;
    let fast;
    if (await dlg.isVisible().catch(() => false)) {
      line(`  a confirmation dialog appeared: ${JSON.stringify((await dlg.innerText()).replace(/\s+/g, ' ').trim().slice(0, 200))}`);
      const clickPromise = dlg.getByRole('button', { name: /resend/i }).first().click();
      t0 = now();
      fast = await sampleFast(readIcon, t0, 15000);
      await clickPromise.catch(() => {});
    } else {
      // No dialog on this build: the icon click itself was the resend, and the sampling above
      // already missed the first 700ms. Say so rather than pretending otherwise.
      line('  no confirmation dialog - the icon click WAS the resend, so the first 0.7s is unsampled.');
      t0 = now();
      fast = await sampleFast(readIcon, t0, 15000);
    }

    line(`  fast sampling (100ms for 15s, ${fast.samples} samples): `
      + (fast.everDisabled
        ? `disabled from ${secs(fast.firstDisabledAt)} to ${secs(fast.lastDisabledAt)}`
        : '>>> NEVER OBSERVED DISABLED <<<'));
    line(`  toasts: ${JSON.stringify(await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => []))}`);
    line(`  countdown-shaped text right after: ${JSON.stringify(await page.evaluate(COUNTDOWN_FN))}`);

    if (!fast.everDisabled) {
      line('\n  >>> VERDICT: there is NO cooldown on this control. It stayed enabled for the whole');
      line('      15s after the resend, and the resend itself answered 200.');
    } else {
      line('  it WAS disabled - polling on to the moment it re-enables:');
      const r = await watchUntilEnabled(readIcon, t0);
      line(r.timedOut
        ? `\n  >>> STILL DISABLED after ${MAX_S}s.`
        : `\n  >>> COOLDOWN: ${secs(r.enabledAfterMs)} from the resend click to re-enable.`);
    }
  } catch (e) { line('  ERR ' + e.stack); }
  finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------------------------
// Surface 2: the SUPERADMIN "Invite Sent" tab's Resend Invite action
// ---------------------------------------------------------------------------------------------
async function superadminSurface(browser, api) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watchApi(page, api);
  try {
    line('\n================ SURFACE: superadmin, Agents > Invite Sent > Resend Invite ================');
    const agents = new AgentsListingPage(page);
    await signIn(page, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
    await agents.goto('Invite Sent');
    await agents.settle().catch(() => {});
    await page.waitForTimeout(2000);

    const rows = await agents.readRows().catch(() => []);
    line(`  pending invites on page 1: ${rows.length}`);
    if (!rows.length) { line('  no pending invites - nothing to measure here.'); return; }

    // >>> THE ROW ACTIONS ARE ICON-ONLY BUTTONS IN THE ROW ITSELF, not behind a "..." menu -
    //     AgentsListingPage.readRows() records that their label lives on aria-label because
    //     innerText is empty. So the Resend Invite icon's disabled state is readable straight off
    //     every row, with no menu to open, which is what makes a whole-page survey possible here.
    const iconFor = (needle) => agents.rowLocator(needle)
      .getByRole('button', { name: /^resend invite$/i }).first();

    // >>> FINDING: AgentsListingPage.readRows() RETURNS name AND email EMPTY ON THIS TAB.
    //     Its rowheader <p> extraction finds nothing here, though `text` plainly holds both
    //     ("Akhmas Khawaja akhmas.khawaja+6000@bytecorp.io Almoosa College ... Invite Sent"), so
    //     the Invite Sent tab's rowheader markup differs from the Active tab's. Recovered from
    //     `text` here, but the reader is worth fixing separately: anything addressing a PENDING
    //     invite by email through readRows() gets an empty needle today, and `rowLocator('')`
    //     matches the first row rather than failing.
    const emailOf = (r) => r.email
      || ((r.text || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [''])[0];

    line('\n  Resend Invite icon state, per pending invite:');
    const survey = [];
    for (const r of rows) {
      const needle = emailOf(r);
      if (!needle) { line(`    (row with no name/email: ${JSON.stringify(r.text).slice(0, 120)})`); continue; }
      let st = null;
      try { st = await iconFor(needle).evaluate(STATE_FN); } catch (e) { /* not on this row */ }
      survey.push({ needle, st });
      line(`    ${st ? (st.disabledProp || st.ariaDisabled === 'true' ? 'DISABLED' : 'enabled ') : 'no icon '}`
        + `  ${needle}${st ? `   cursor=${st.cursor} opacity=${st.opacity} title=${JSON.stringify(st.title)}` : ''}`);
    }
    line(`  countdown-shaped text on the page: ${JSON.stringify(await page.evaluate(COUNTDOWN_FN))}`);

    const coolingDown = survey.find((s) => s.st && (s.st.disabledProp || s.st.ariaDisabled === 'true'));
    if (coolingDown) {
      line(`\n  >>> ${coolingDown.needle} IS ALREADY DISABLED - watching it to expiry, sending NOTHING.`);
      await iconFor(coolingDown.needle).hover({ force: true }).catch(() => {});
      await page.waitForTimeout(1200);
      line(`  tooltips on hover: ${JSON.stringify(
        await page.locator('[role="tooltip"], [data-tooltip], .tooltip').allInnerTexts().catch(() => [])
      )}`);
      const t0 = now();
      const r = await watchUntilEnabled(
        () => iconFor(coolingDown.needle).evaluate(STATE_FN).catch(() => null), t0
      );
      line(r.timedOut
        ? `  still disabled after ${MAX_S}s - a LOWER BOUND; its cooldown began before this probe did`
        : `  re-enabled after ${secs(r.enabledAfterMs)} of watching - also a LOWER BOUND`);
      if (!CLICK) return;
    }

    // >>> RESEND ONLY TO AN ADDRESS THIS SUITE OWNS. Row 0 on either surface is often someone
    //     else's test data, and a resend puts a real email in a real person's inbox. Prefer the
    //     project's own mailbox aliases; refuse rather than mail a stranger.
    const OURS = /(iqra\.farooq\+|test\.candidate|@iqra\.anonaddy\.com)/i;
    const mine = survey.map((x) => x.needle).filter((e) => OURS.test(e));
    if (!mine.length) {
      line('\n  >>> NO SUITE-OWNED pending invite on page 1, so nothing is being resent here.');
      line('      Every address belongs to someone else and a resend would email them for real.');
      return;
    }
    const subjectEmail = mine[0];
    line(`\n  chosen subject (suite-owned): ${subjectEmail}`);
    const subject = { email: subjectEmail };
    const readAction = () => iconFor(subjectEmail).evaluate(STATE_FN).catch(() => null);

    if (!CLICK) {
      line('\n  read-only pass. Re-run with --click to resend one real invitation and time the cooldown.');
      return;
    }

    line(`\n  >>> RESENDING the invite for ${subject.email || subject.name}  (sends a real email)`);
    await agents.openResendDialog(subject.email || subject.name);
    line(`  dialog: ${JSON.stringify(await agents.resendDialogText())}`);

    // >>> t0 IS THE RESEND CLICK, NOT THE START OF THE INTERACTION. The first run set it before
    //     openResendDialog() and so reported "actionable again 5.6s after the resend" when 5.6s
    //     was mostly spent opening a dialog and reading its text. And nothing was sampled in that
    //     window, so a brief disable could not have been seen at all.
    //
    //     So: click the dialog's confirm WITHOUT awaiting its close, take t0, and start sampling
    //     at 100ms immediately. Toasts and countdown text are read AFTERWARDS - they are slow and
    //     must not sit between the click and the first sample.
    const confirmBtn = agents.resendDialog.getByRole('button', { name: /^resend invite$/i });
    const clickPromise = confirmBtn.click();
    const t0 = now();
    const fast = await sampleFast(readAction, t0, 15000);
    await clickPromise.catch(() => {});

    line(`  fast sampling (100ms for 15s, ${fast.samples} samples): `
      + (fast.everDisabled
        ? `disabled from ${secs(fast.firstDisabledAt)} to ${secs(fast.lastDisabledAt)}`
        : '>>> NEVER OBSERVED DISABLED <<<'));
    line(`  toasts: ${JSON.stringify(await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => []))}`);
    line(`  countdown-shaped text right after: ${JSON.stringify(await page.evaluate(COUNTDOWN_FN))}`);

    if (!fast.everDisabled) {
      line('\n  >>> VERDICT: there is NO cooldown on this control. It was enabled continuously');
      line('      across the whole 15s following the resend, and the resend itself answered 200.');
    } else {
      line('  it WAS disabled - polling on to the moment it re-enables:');
      const r = await watchUntilEnabled(readAction, t0);
      line(r.timedOut
        ? `\n  >>> STILL DISABLED after ${MAX_S}s.`
        : `\n  >>> COOLDOWN: ${secs(r.enabledAfterMs)} from the resend click to re-enable.`);
    }
  } catch (e) { line('  ERR ' + e.stack); }
  finally { await ctx.close(); }
}

(async () => {
  const api = [];
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  line(`resend-cooldown probe - mode: ${CLICK ? '>>> CLICK (SENDS REAL EMAIL) <<<' : 'read-only'}`
    + `, max wait ${MAX_S}s`);
  try {
    if (!ONLY || ONLY === 'agent') await agentSurface(browser, api);
    if (!ONLY || ONLY === 'superadmin') await superadminSurface(browser, api);
  } finally {
    line('\n================ resend/invite API traffic seen ================');
    if (!api.length) line('  (none - no resend request was made)');
    for (const r of api) {
      line(`  ${r.status}  ${r.url}`);
      if (r.retryAfter) line(`         >>> Retry-After: ${r.retryAfter}`);
      if (r.body) line(`         body: ${r.body}`);
    }
    line('\nNOTE: a 429 with Retry-After, or a body naming the remaining seconds, is far better\n'
      + 'evidence of the cooldown than any DOM watching - if one appears above, quote that.');
    await browser.close();
  }
})();
