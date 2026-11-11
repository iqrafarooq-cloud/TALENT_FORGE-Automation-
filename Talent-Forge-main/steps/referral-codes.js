const { Given, When, Then, Before, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ReferralCodesPage = require('../pages/ReferralCodesPage');
const AdminPromoToolsPage = require('../pages/AdminPromoToolsPage');
const { provisionFreshCandidate } = require('../utils/subscriptionProvision');
const video = require('../utils/videoRecorder');
require('dotenv').config();

// NOTE ON ACCOUNTS: this feature runs as its OWN agent, not the shared AGENT_EMAIL the
// rest of the suite uses. Two accounts, both invited from the superadmin portal on
// 2026-07-28 (Agents > Invite Agent):
//
//   REFERRAL_AGENT_*         promo CODEHFA8X3Y — 20% — expiry 28/07/2027 — usage limit 100
//   REFERRAL_NOPROMO_AGENT_* invited with "Add promo code" UNCHECKED (AC 5 empty state)
//
// Why not just repoint AGENT_EMAIL: these accounts are brand new and carry no candidates,
// so Dashboard / Active-candidate / Requires-attention / 2FA would all fail on them. The
// split keeps this feature's account state independent of the rest of the suite.
//
// `I am logged in as an agent` (active-candidate.steps.js) is NOT reused or redefined
// here — it logs in as the shared agent. This file defines its own login steps.

const AGENT_EMAIL = process.env.REFERRAL_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.REFERRAL_AGENT_PASSWORD;
const NOPROMO_EMAIL = process.env.REFERRAL_NOPROMO_AGENT_EMAIL;
// The Expired-promo fixture, used by ONE scenario. See the .env block for why it is a third
// account and not a state set on REFERRAL_AGENT.
const EXPIRED_EMAIL = process.env.REFERRAL_EXPIRED_AGENT_EMAIL;
const EXPIRED_PASSWORD = process.env.REFERRAL_EXPIRED_AGENT_PASSWORD;
const NOPROMO_PASSWORD = process.env.REFERRAL_NOPROMO_AGENT_PASSWORD;
// This agent's own Agent Code — the code fresh candidates sign up under so they really
// belong to the agent whose promo is under test. Asserted against the dashboard at runtime
// rather than trusted, so a stale .env fails loudly instead of testing the wrong agent.
const REFERRAL_AGENT_CODE = process.env.REFERRAL_SIGNUP_AGENT_CODE;
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
// Where the agent lands after login. Kept in sync with the other agent login steps.
const AGENT_POST_LOGIN = /\/dashboard|\/candidates|\/verifications|\/activity-log/;

const ref = (world) => world.pages.referralCodes;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The four share endpoints, verified live 2026-07-28. Facebook is listed for
// completeness — it opens share_channel with NO message payload (see @known-issue).
const SHARE_HOSTS = {
  whatsapp: /(?:api|web|wa)\.whatsapp\.com|wa\.me/i,
  linkedin: /linkedin\.com/i,
  facebook: /facebook\.com/i,
  twitter: /(?:^|\/\/|\.)(?:x|twitter)\.com/i,
  x: /(?:^|\/\/|\.)(?:x|twitter)\.com/i,
};

// Clipboard reads need an explicit grant, and the grant is per-ORIGIN, so it can only be
// made once the target origin is known. Chromium also treats clipboard-read as a
// separate permission from clipboard-write.
async function grantClipboard(world) {
  const origin = new URL(world.page.url()).origin;
  await world.context
    .grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    .catch(() => {});
}

// ==================== Background ====================

// Log an agent in on THIS scenario's page. Named accounts are passed in rather than read
// inside, so the two login steps below cannot drift apart.
async function loginAsAgent(world, email, password, label) {
  if (!email || !password) {
    throw new Error(
      `Missing ${label} credentials in .env. This feature runs as its own agent — set `
      + 'REFERRAL_AGENT_EMAIL / REFERRAL_AGENT_PASSWORD (and REFERRAL_NOPROMO_AGENT_* for the '
      + 'empty-state scenario).'
    );
  }
  const login = new LoginPage(world.page);
  await login.navigate();
  await login.emailInput.first().fill(email);
  await login.passwordInput.first().fill(password);
  // >>> THE LOGIN SUBMIT IS SOMETIMES A NO-OP, AND IT COST 4 OF 26 SCENARIOS ON ONE RUN. <<<
  // Measured on a full run 2026-09-08: four scenarios failed in this Background step with
  // `page.waitForURL: Timeout 90000ms exceeded`, and the failure screenshots show the login form
  // still filled in CORRECTLY, with no error of any kind and no rate-limit banner - so the app
  // never rejected the credentials and never answered; the click simply did not take effect. The
  // button exists in the DOM before React attaches its handler, so an early click is swallowed.
  // Every one of the 22 scenarios that got past this step passed, which is what localises the
  // fault to the submit rather than to the account or the session.
  //
  // So the click is retried while we are still on /login AND the page has rendered no error. A
  // genuine rejection DOES render one, and is NOT retried - that is what stops this masking a
  // wrong password or a locked account, and it matters here because repeated failed sign-ins are
  // rate limited per account (see the Change-Password notes in CLAUDE.md): a blind retry loop
  // would turn one bad credential into an hour-long lockout.
  // The per-attempt wait is deliberately UNIFORM and the total is kept inside the step's own
  // timeout. A first version gave the last attempt the original 90s, which made the worst case
  // 20+20+90 = 130s against a 120000ms step timeout - so the third attempt could never finish and
  // the step died as `function timed out` instead of retrying. That is strictly worse than the
  // flake it was fixing, because the message no longer names the login at all. 3 x 30s keeps the
  // same overall budget as the single 90s wait it replaced and leaves ~30s of headroom for the
  // navigate and the two fills above.
  const attempts = 3;
  const perAttemptTimeout = 30000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await login.submitButton.first().click();
    const last = attempt === attempts;
    try {
      await world.page.waitForURL(AGENT_POST_LOGIN, {
        timeout: perAttemptTimeout,
        waitUntil: 'commit',
      });
      break;
    } catch (err) {
      const alertText = ((await login.alert.first().innerText().catch(() => '')) || '').trim();
      const stillOnLogin = /login/.test(new URL(world.page.url()).pathname);
      if (!last && !alertText && stillOnLogin) continue;
      const why = alertText
        ? 'the page reported: ' + JSON.stringify(alertText)
        : 'the page reported no error at all, so the submit was never accepted.';
      throw new Error(
        label + ' (' + email + ') did not reach the dashboard after ' + attempt
        + ' submit attempt(s). url=' + world.page.url() + ' - ' + why
      );
    }
  }
  // A newly invited agent is forced through /set-password on FIRST login only. If that
  // screen appears the account has never been used, so say so rather than time out later
  // on a dashboard that never renders.
  if (/\/set-password/.test(world.page.url())) {
    throw new Error(
      `${label} (${email}) was bounced to /set-password, so its invite has not been accepted `
      + 'yet. Log in once by hand with the temporary password from the "Join Talentforge" '
      + `invite email and set it to the password in .env.`
    );
  }
}

Given('I am logged in as the referral agent', { timeout: 120000 }, async function () {
  await loginAsAgent(this, AGENT_EMAIL, AGENT_PASSWORD, 'the referral agent');
});

// The AC 5 empty state needs an agent with NO promo assigned — impossible to produce on an
// agent that has one (Promo Code Name is read-only everywhere), so it runs as the second
// invited account instead. Overrides the Background's session on the same page.
Given('I am logged in as the agent with no promo code assigned', { timeout: 120000 }, async function () {
  await loginAsAgent(this, NOPROMO_EMAIL, NOPROMO_PASSWORD, 'the no-promo agent');
});

// The Expired promo state is UNREACHABLE on the other two accounts: Edit Code Parameters
// silently gates Save Changes for any past expiry date, so the suite cannot set one, and
// backdating through the app's PATCH would leave the fixture hard to repair through the UI.
// So this reads a third account that already holds an expired promo. It is deliberately used
// by ONE scenario - nothing else in this file should sign in as it, because its promo is
// unusable by design and every redemption or Active-state assertion would fail on it.
Given('I am logged in as the agent with an expired promo code', { timeout: 120000 }, async function () {
  await loginAsAgent(this, EXPIRED_EMAIL, EXPIRED_PASSWORD, 'the expired-promo agent');
});

Given('I am on the Agent Dashboard', async function () {
  await ref(this).navigate();
  await grantClipboard(this);
});

When('I reload the Agent Dashboard', async function () {
  await ref(this).navigate();
});

// ==================== Section structure (AC 1) ====================

// NOTE: `the "<x>" section should be visible` is NOT defined here. An identical generic
// step already exists in subscription.steps.js:649 and Cucumber matches step text globally,
// so defining it in both files made the step AMBIGUOUS — which failed this feature's section
// scenario AND 8 unrelated Subscription billing-history scenarios. The shared definition is
// reused instead.

Then('the section should contain the following widgets:', async function (dataTable) {
  const problems = [];
  for (const { widget } of dataTable.hashes()) {
    try {
      await expect(ref(this).widgetLabel(widget)).toBeVisible({ timeout: 15000 });
    } catch {
      problems.push(`"${widget}" widget is not rendered in the Referral Codes section`);
    }
  }
  expect(problems, problems.join(' | ')).toEqual([]);
});

Then('the {string} widget should display a non-empty code', async function (widget) {
  const code = await ref(this).readCode(widget);
  expect(code, `code shown on the "${widget}" widget`).toMatch(/\S/);
  // Guard against the label bleeding into the value if the DOM shifts.
  expect(code.toLowerCase(), `"${widget}" code should not be the label itself`)
    .not.toBe(widget.toLowerCase());
  this._codes = this._codes || {};
  this._codes[widget] = code;
});

Then('the {string} widget should display a copy icon', async function (widget) {
  await expect(ref(this).copyIcon(widget), `copy icon on the "${widget}" widget`)
    .toBeVisible({ timeout: 15000 });
});

Then('the {string} widget should not display a copy icon', async function (widget) {
  expect(
    await ref(this).hasCopyIcon(widget),
    `copy icon on the "${widget}" widget should be hidden`
  ).toBeFalsy();
});

Then('the {string} widget should display a {string} CTA', async function (widget, cta) {
  await expect(
    ref(this).widget(widget).getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first(),
    `"${cta}" CTA on the "${widget}" widget`
  ).toBeVisible({ timeout: 15000 });
});

Then('the {string} widget should not display a {string} CTA', async function (widget, cta) {
  await expect(
    ref(this).widget(widget).getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first()
  ).toBeHidden({ timeout: 10000 });
});

Then('the {string} CTA on the {string} widget should be enabled', async function (cta, widget) {
  const btn = ref(this).widget(widget).getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first();
  await expect(btn, `"${cta}" on the "${widget}" widget`).toBeEnabled({ timeout: 15000 });
});

Then('the {string} CTA on the {string} widget should be disabled', async function (cta, widget) {
  const btn = ref(this).widget(widget).getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first();
  await expect(btn, `"${cta}" on the "${widget}" widget`).toBeDisabled({ timeout: 15000 });
});

Then('the copy icon on the {string} widget should be disabled', async function (widget) {
  await expect(ref(this).copyIcon(widget)).toBeDisabled({ timeout: 15000 });
});

Then('the {string} widget should display the code washed out', async function (widget) {
  const washed = await ref(this).isCodeWashedOut(widget);
  const cls = (await ref(this).codeText(widget).getAttribute('class')) || '';
  expect(washed, `"${widget}" code should render in the washed-out/disabled treatment (class="${cls}")`)
    .toBeTruthy();
});

Then('the {string} widget should show the status pill {string}', async function (widget, status) {
  const pill = await ref(this).widgetStatus(widget);
  expect(pill, `status pill on the "${widget}" widget`).toBeTruthy();
  expect(pill).toMatch(new RegExp(escapeRegExp(status), 'i'));
});

// AC 5 specifies the empty state as a DESIGN IMAGE with no quoted copy, so there is no
// wording to assert. What is checkable is that the widget shows no redeemable code. The
// build renders a bare "-" (verified live 2026-07-28 on the no-promo agent) — accepted here
// as a placeholder; whether it matches the mockup needs a visual comparison, which is
// recorded in REFERRAL_CODES_JIRA_VS_APP.md rather than asserted.
// The negative twin, for the EXPIRED state. Measured 2026-09-08 on an agent whose promo had
// expired the day before: the widget holds ZERO span.rounded-full, so there is no pill to read -
// and `widgetStatus()` returning null is the app rendering nothing, not the reader missing it
// (the same reader finds the "Disabled" pill on a disabled promo, which is what proves it works).
Then('the {string} widget should not show a status pill', async function (widget) {
  const pill = await ref(this).widgetStatus(widget);
  expect(
    pill,
    `the "${widget}" widget should render no status pill, but it shows "${pill}"`
  ).toBeNull();
});

// Negative twin of the washed-out reader. Asserted rather than assumed because "not washed out"
// is the whole finding here: an expired code is painted in the live brand colour.
Then('the {string} widget should not display the code washed out', async function (widget) {
  const washed = await ref(this).isCodeWashedOut(widget);
  const cls = (await ref(this).codeText(widget).getAttribute('class')) || '';
  expect(
    washed,
    `the "${widget}" code should render in the LIVE treatment, but it is washed out (class="${cls}")`
  ).toBeFalsy();
});

Then('the {string} widget should show the no-promo empty state', async function (widget) {
  const w = ref(this).widget(widget);
  await expect(w).toBeVisible({ timeout: 15000 });
  const code = ((await ref(this).readCode(widget).catch(() => '')) || '').trim();
  const txt = ((await w.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const isPlaceholder = /^[-–—]$/.test(code) || code === '' || /^n\/?a$/i.test(code);
  const explains = /no promo code|not (yet )?(been )?assigned|no code assigned/i.test(txt);
  expect(
    isPlaceholder || explains,
    `the "${widget}" widget should show an empty state, but it renders the code "${code}" `
    + `(widget text: "${txt}")`
  ).toBeTruthy();
  this._emptyStateRendering = isPlaceholder && !explains ? `placeholder "${code}"` : 'message';
});

Then('the {string} widget should still be fully enabled', async function (widget) {
  await expect(ref(this).codeText(widget)).toBeVisible({ timeout: 15000 });
  await expect(ref(this).copyIcon(widget)).toBeVisible({ timeout: 15000 });
  await expect(ref(this).shareButton(widget)).toBeEnabled({ timeout: 15000 });
});

// ==================== Copy (AC 2, AC 3) ====================

When('I copy the {string} from its widget', async function (widget) {
  await grantClipboard(this);
  this._expectedCode = await ref(this).readCode(widget);
  await ref(this).copyFromWidget(widget);
});

Then('the clipboard should hold the {string} shown in the widget', async function (widget) {
  const expected = this._expectedCode || (await ref(this).readCode(widget));
  const actual = await ref(this).readClipboard();
  if (actual === null) {
    throw new Error(
      `Could not read the clipboard to verify the "${widget}" copy action. The browser denied `
      + 'clipboard-read for this origin, so the copy could not be proven — it was NOT verified '
      + 'by any weaker fallback on purpose.'
    );
  }
  expect(actual.trim(), `clipboard after copying the "${widget}"`).toBe(expected);
});

When('I click {string} in the share modal', async function (label) {
  await grantClipboard(this);
  this._modalCode = await ref(this).readModalCode();
  await ref(this)
    .modal.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') })
    .first()
    .click();
});

Then('the clipboard should hold the code shown in the share modal', async function () {
  const expected = this._modalCode || (await ref(this).readModalCode());
  const actual = await ref(this).readClipboard();
  if (actual === null) {
    throw new Error(
      'Could not read the clipboard to verify the modal Copy Code action — the browser denied '
      + 'clipboard-read for this origin.'
    );
  }
  expect(actual.trim(), 'clipboard after the modal Copy Code').toBe(expected);
});

// The build gives no toast for a copy — the CTA's own label flips to "Copied!".
Then('the share modal copy button should confirm with {string}', async function (confirm) {
  await expect(
    ref(this).modal.getByRole('button', { name: new RegExp(escapeRegExp(confirm), 'i') }).first(),
    `copy CTA should confirm with "${confirm}"`
  ).toBeVisible({ timeout: 10000 });
});

// ==================== Share modal (AC 2, AC 3) ====================

When('I open the {string} share modal', async function (widget) {
  this._widget = widget;
  this._widgetCode = await ref(this).readCode(widget);
  await ref(this).openShareModal(widget);
});

Then('the share modal title should be {string}', async function (title) {
  expect((await ref(this).readModalTitle()).trim()).toBe(title);
});

Then('the share modal should show the same code as the {string} widget', async function (widget) {
  const inModal = await ref(this).readModalCode();
  const inWidget = this._widgetCode || (await ref(this).readCode(widget));
  expect(inModal, `code in the share modal vs the "${widget}" widget`).toBe(inWidget);
});

Then('the share modal should show a {string} CTA', async function (cta) {
  await expect(
    ref(this).modal.getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first(),
    `"${cta}" CTA in the share modal`
  ).toBeVisible({ timeout: 15000 });
});

Then('the share modal should not show a {string} CTA', async function (cta) {
  await expect(
    ref(this).modal.getByRole('button', { name: new RegExp(escapeRegExp(cta), 'i') }).first()
  ).toBeHidden({ timeout: 10000 });
});

Then('the share modal message should be {string}', async function (message) {
  const actual = await ref(this).readModalMessage();
  expect(actual, 'share modal guidance/state message').toBe(message);
});

Then('the share modal message should state the code expired on its expiry date', async function () {
  const msg = await ref(this).readModalMessage();
  const expiry = await ref(this).readPromoDetail('Expires on');
  expect(msg, 'expired-state modal message').toMatch(/expired on/i);
  expect(msg, 'expired-state message should name the expiry date and say it cannot be shared or redeemed')
    .toMatch(/can no longer be shared or redeemed/i);
  if (expiry) expect(msg).toContain(expiry);
});

Then('the share modal should offer the following share targets:', async function (dataTable) {
  const wanted = dataTable.hashes().map((r) => r.platform);
  const found = await ref(this).shareTargets();
  const missing = wanted.filter(
    (w) => !found.some((f) => f.toLowerCase() === w.toLowerCase())
      // The AC calls it "X (Twitter)"; the build labels the button "Twitter".
      && !(/^(x|twitter)$/i.test(w) && found.some((f) => /^(x|twitter)$/i.test(f)))
  );
  expect(missing, `share targets missing from the modal (found: ${found.join(', ') || 'none'})`)
    .toEqual([]);
});

Then('the share modal should not offer any share targets', async function () {
  const found = await ref(this).shareTargets();
  expect(found, 'a disabled promo code must expose no share targets').toEqual([]);
});

Then('the share modal should show a {string} panel with the following fields:', async function (panel, dataTable) {
  await expect(
    ref(this).modal.getByText(new RegExp(`^${escapeRegExp(panel)}$`, 'i')).first(),
    `"${panel}" panel`
  ).toBeVisible({ timeout: 15000 });
  const problems = [];
  for (const { field } of dataTable.hashes()) {
    const visible = await ref(this)
      .modal.getByText(new RegExp(`^${escapeRegExp(field)}$`, 'i'))
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) problems.push(`"${field}" is missing from the ${panel} panel`);
  }
  expect(problems, problems.join(' | ')).toEqual([]);
});

Then('the share modal should show a {string} field', async function (field) {
  await expect(
    ref(this).modal.getByText(new RegExp(`^${escapeRegExp(field)}$`)).first(),
    `"${field}" field (exact casing) in the share modal`
  ).toBeVisible({ timeout: 15000 });
});

Then('the share modal should be rendered in a disabled state', async function () {
  // AC 4: the WHOLE modal is meant to read as greyed out. Take the modal's own body
  // text colour plus the code panel as the signal.
  const code = ref(this).modalCode;
  const cls = (await code.getAttribute('class').catch(() => '')) || '';
  const greyed = /text-gray-(300|400|500)|opacity-(40|50|60)/.test(cls)
    || /opacity-(40|50|60)/.test((await ref(this).modal.getAttribute('class').catch(() => '')) || '');
  expect(
    greyed,
    `expected the disabled promo modal to be greyed out; the code renders with class="${cls}" `
    + 'and the modal itself carries no disabled/opacity treatment'
  ).toBeTruthy();
});

// ==================== Promo Details (AC 3) ====================

Then('the promo {string} should be {string}', async function (field, expected) {
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toMatch(new RegExp(escapeRegExp(expected), 'i'));
});

Then('the promo {string} should be one of {string}', async function (field, csv) {
  const allowed = csv.split(',').map((s) => s.trim()).filter(Boolean);
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toBeTruthy();
  expect(
    allowed.some((a) => new RegExp(`^${escapeRegExp(a)}$`, 'i').test(actual.trim())),
    `promo "${field}" was "${actual}", expected one of: ${allowed.join(', ')}`
  ).toBeTruthy();
});

Then('the promo {string} should read as a percentage or a SAR amount', async function (field) {
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toBeTruthy();
  expect(
    actual,
    `promo "${field}" should be a percentage (e.g. "20% off") or a fixed amount (e.g. "100 SAR")`
  ).toMatch(/(\d+(?:\.\d+)?\s*%)|(\d+(?:\.\d+)?\s*SAR)|(SAR\s*\d+)/i);
});

Then('the promo {string} should read as {string}', async function (field, shape) {
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toBeTruthy();
  // "<used> of <limit>" is the shape the build ships; "X / Y Successful Uses" is the
  // literal AC wording (asserted by the @known-issue scenario).
  const pattern = /successful uses/i.test(shape)
    ? /^\d+\s*\/\s*\d+\s+Successful Uses$/i
    : /^\d+\s+of\s+\d+$/i;
  expect(actual, `promo "${field}" should read as "${shape}"`).toMatch(pattern);
});

Then('the promo {string} should read as a used count of a limit', async function (field) {
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toBeTruthy();
  expect(actual, `promo "${field}" should read as "<used> of <limit>"`)
    .toMatch(/^\d+\s+of\s+\d+$/i);
});

Then('the promo {string} should be a DD\\/MM\\/YYYY date', async function (field) {
  const actual = await ref(this).readPromoDetail(field);
  expect(actual, `promo "${field}"`).toBeTruthy();
  expect(actual, `promo "${field}" should be a DD/MM/YYYY date`).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  const [dd, mm] = actual.split('/').map(Number);
  expect(dd >= 1 && dd <= 31, `day "${dd}" out of range in "${actual}"`).toBeTruthy();
  expect(mm >= 1 && mm <= 12, `month "${mm}" out of range in "${actual}"`).toBeTruthy();
});

// ==================== Social sharing (AC 6) ====================

When('I share via {string} from the share modal', async function (platform) {
  this._sharePlatform = platform;
  this._shareUrl = await ref(this).shareVia(platform);
  this._shareEvidence = ref(this).lastShare;
  this.attach(JSON.stringify(this._shareEvidence, null, 2), 'application/json');
});

Then('a share window should open on {string}', async function (host) {
  expect(this._shareUrl, 'no share window URL was captured').toBeTruthy();
  // Keyed on the PLATFORM, not on the first dot-token of the expected host. Deriving the key
  // from the host is what broke the moment this assertion started reading the url the app
  // OPENS rather than where the popup landed: WhatsApp's own share endpoint is `wa.me`, so
  // "api.whatsapp.com" resolved to SHARE_HOSTS[api] (undefined), fell back to a literal match
  // on the expected host, and failed against a perfectly correct `wa.me/?text=...`. SHARE_HOSTS
  // is already keyed by platform and each entry admits every endpoint that platform legitimately
  // uses, which is exactly the distinction this step needs.
  const pattern = SHARE_HOSTS[String(this._sharePlatform).toLowerCase()]
    || new RegExp(escapeRegExp(host), 'i');
  expect(
    this._shareUrl,
    `share window opened on "${this._shareUrl}", expected the ${this._sharePlatform} endpoint (${host})`
  ).toMatch(pattern);
});

Then('the prefilled share text should contain the {string}', async function (widget) {
  const code = this._widgetCode || (await ref(this).readCode(widget));
  // The assertion is about the url the APP OPENED. The landing url is reported beside it, and
  // flagged when it is all we have, so a platform discarding a correctly formed share stays
  // distinguishable from the app never sending one - the confusion that made this @known-issue.
  const ev = this._shareEvidence || {};
  const NLQ = String.fromCharCode(10);
  const caveat = ev.fromWindowOpen
    ? ''
    : ' Read from the popup landing url, NOT from window.open, so the platform may have dropped it.';
  const text = ReferralCodesPage.shareTextFrom(this._shareUrl || '');
  expect(
    text,
    `the ${this._sharePlatform} share url the app opened carries no "${code}" - nothing for the `
    + `candidate to paste.${caveat}`
    + `${NLQ}  the app opened      : ${ev.requestedUrl || '(nothing captured)'}`
    + `${NLQ}  the popup landed on : ${ev.landedOn || '(no popup)'}`
  ).toContain(code);
});

// ==================== Promo state (AC 4) ====================

// Read-only precondition: assert the promo is in the given state, and say plainly what
// to do when it is not, rather than silently passing.
Given('my promo code status is {string}', async function (status) {
  await ref(this).openShareModal('Promo Code');
  const actual = await ref(this).readPromoDetail('Status');
  await ref(this).closeShareModal();
  if (!actual || !new RegExp(`^${escapeRegExp(status)}$`, 'i').test(actual.trim())) {
    throw new Error(
      `This scenario needs the agent's promo code to be "${status}" but it is `
      + `"${actual || '(not shown)'}". Set it on the superadmin portal: Agents > `
      + `${AGENT_EMAIL} > Promo Tools > Edit parameters. Note an EXPIRED promo cannot be set `
      + 'there — Save Changes is disabled for any past expiry date.'
    );
  }
});

// The promo is a FINITE resource: this agent's carries a usage limit of 100, and every
// completed redemption burns one. Without this guard an exhausted promo surfaces as an
// opaque "promo rejected by the API" failure in the redemption scenario, which reads like a
// product bug. Check it up front and name the numbers instead.
Given('my promo code has uses remaining', async function () {
  await ref(this).openShareModal('Promo Code');
  const raw = await ref(this).readPromoDetail('Usage Limit');
  const status = await ref(this).readPromoDetail('Status');
  await ref(this).closeShareModal();

  const nums = numbersIn(raw || '');
  expect(
    nums.length >= 2,
    `could not read a used/limit pair from the promo "Usage Limit" (got "${raw}")`
  ).toBeTruthy();
  const [used, limit] = nums;
  this._usedBefore = used;
  this._usageLimit = limit;
  if (used >= limit) {
    throw new Error(
      `This agent's promo code is EXHAUSTED — ${used} of ${limit} uses are spent, so no further `
      + 'candidate can redeem it and the redemption scenarios below cannot pass. Raise Usage '
      + `Limit on the superadmin portal (Agents > ${AGENT_EMAIL} > Promo Tools > Edit `
      + 'parameters), or invite a fresh agent with a new promo and repoint '
      + 'REFERRAL_AGENT_* / REFERRAL_SIGNUP_AGENT_CODE in .env.'
    );
  }
  expect(status, 'promo status').toMatch(/active/i);
});

// ==================== Superadmin leg (own browser context) ====================

// Open a SECOND browser context and log the superadmin in there. The app holds one
// session per context, and an agent session on /agents/view/<id> is bounced to
// /unauthorized — so the two roles cannot share this scenario's context.
async function superadminContext(world) {
  if (world._adminPromo) return world._adminPromo;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error('Missing SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in .env');
  }
  const context = await world.browser.newContext(video.contextOptions());
  const page = video.track(world, await context.newPage(), 'superadmin');
  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(SUPERADMIN_EMAIL);
  await login.passwordInput.first().fill(SUPERADMIN_PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/agents-analytics|\/agents|\/dashboard|\/candidate-analytics/, {
    timeout: 90000,
    waitUntil: 'commit',
  });
  world._adminContext = context;
  world._adminPromo = new AdminPromoToolsPage(page);
  return world._adminPromo;
}

When('the superadmin opens my Promo Tools tab', { timeout: 120000 }, async function () {
  this._agentCode = await ref(this).readCode('Agent Code');
  this._promoCode = await ref(this).readCode('Promo Code');
  const admin = await superadminContext(this);
  await admin.openPromoTools(AGENT_EMAIL);
});

Then('the promo code on the superadmin Promo Tools tab should equal my {string}', async function (widget) {
  const admin = this._adminPromo;
  const onAdmin = await admin.readPromoCode();
  const onAgent = this._promoCode || (await ref(this).readCode(widget));
  expect(onAdmin, `promo code on the superadmin Promo Tools tab vs the agent's "${widget}" widget`)
    .toBe(onAgent);
});

// Compare each superadmin "Code Parameters" field with its counterpart in the agent's
// share modal. The two surfaces format the same data differently, so compare on the
// meaningful part: Value "20%" vs Discount "20% off", Usage Limit "921" vs "0 of 921".
Then('the promo parameters on the superadmin tab should match my share modal:', async function (dataTable) {
  const admin = this._adminPromo;
  const adminParams = await admin.readAllParameters();
  await ref(this).openShareModal('Promo Code');

  const problems = [];
  for (const row of dataTable.hashes()) {
    const adminField = row['superadmin field'];
    const agentField = row['agent modal field'];
    const adminValue = (adminParams[adminField] || '').trim();
    const agentValue = ((await ref(this).readPromoDetail(agentField)) || '').trim();

    if (!adminValue || !agentValue) {
      problems.push(
        `could not read ${adminField}="${adminValue}" / ${agentField}="${agentValue}"`
      );
      continue;
    }
    const a = numbersIn(adminValue);
    const b = numbersIn(agentValue);
    const ok = adminField === 'Usage Limit'
      // "921" must appear as the LIMIT in "0 of 921".
      ? b[b.length - 1] === a[a.length - 1]
      : adminField === 'Status'
        ? adminValue.toLowerCase() === agentValue.toLowerCase()
        : a.every((n) => b.includes(n));
    if (!ok) {
      problems.push(
        `superadmin ${adminField}="${adminValue}" does not match agent ${agentField}="${agentValue}"`
      );
    }
  }
  await ref(this).closeShareModal();
  expect(problems, problems.join(' | ')).toEqual([]);
});

function numbersIn(s) {
  return (String(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// Provision the Disabled state for real, and remember enough to put it back.
Given('the superadmin has disabled my promo code', { timeout: 180000 }, async function () {
  const admin = await superadminContext(this);
  await admin.openPromoTools(AGENT_EMAIL);
  this._promoSnapshot = await admin.snapshotParameters();
  this._promoNeedsRestore = true;
  await admin.openEditParameters();
  await admin.setStatus(false);
  await admin.saveChanges();
  const status = await admin.readParameter('Status');
  expect(status, 'promo status on the superadmin tab after disabling').toMatch(/disabled/i);
});

// Restore the promo whatever happened, then close the admin context. Runs for every
// scenario that touched it; reports a failed restore loudly (a promo left disabled on
// DEV would silently break the Active-state scenarios on the next run) without masking
// the scenario's own result.
// Scoped to the FEATURE tag, not @e2e. No scenario in Referral-Codes.feature is tagged
// @e2e, so the previous scope never matched and the promo was left DISABLED on DEV after
// any of the three scenarios that disable it — which then broke the Active-state and
// redemption scenarios on the next run for a reason that looked nothing like the cause.
After({ tags: '@referral-codes', timeout: 180000 }, async function () {
  if (this._promoNeedsRestore && this._adminPromo) {
    const result = await this._adminPromo.restoreParameters(this._promoSnapshot);
    if (!result.restored) {
      this.attach(
        `WARNING: could not restore this agent's promo code to its original state `
        + `(${result.reason}). Restore it by hand on the superadmin portal: Agents > `
        + `${AGENT_EMAIL} > Promo Tools > Edit parameters -> Status ON, expiry `
        + `${this._promoSnapshot && this._promoSnapshot.expiry}.`,
        'text/plain'
      );
    }
  }
  if (this._adminContext) {
    await this._adminContext.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await this._adminContext.close().catch(() => {});
    this._adminContext = null;
    this._adminPromo = null;
  }
});

// ==================== RBAC ====================

When('I navigate directly to the superadmin agent detail page', async function () {
  const origin = new URL(this.page.url()).origin;
  await this.page.goto(`${origin}/agents/view/1`, { waitUntil: 'domcontentloaded' });
  // The bounce to /unauthorized is client-side, so give the router a moment.
  await this.page
    .waitForURL(/\/unauthorized|\/dashboard|\/login/, { timeout: 20000, waitUntil: 'commit' })
    .catch(() => {});
});

Then('I should be denied access', async function () {
  const url = this.page.url();
  const body = ((await this.page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const denied = /\/unauthorized|\/login/.test(url)
    || /access denied|do not have permission|not authorized|unauthorized/i.test(body);
  expect(
    denied,
    `an agent session should not be able to open the superadmin agent detail page, but landed `
    + `on ${url} showing "${body.slice(0, 160)}"`
  ).toBeTruthy();
  // And it must not leak the promo tooling.
  expect(body, 'the agent must not see the superadmin promo tooling').not.toMatch(/Edit parameters|Code Parameters/i);
});

// ==================== Candidate redemption ====================

Given('I have noted my {string} from the dashboard', async function (widget) {
  this._promoCode = await ref(this).readCode(widget);
  await ref(this).openShareModal(widget);
  this._promoDiscount = await ref(this).readPromoDetail('Discount');
  this._promoUsage = await ref(this).readPromoDetail('Usage Limit');
  await ref(this).closeShareModal();
  expect(this._promoCode, `"${widget}" read from the dashboard`).toMatch(/\S/);
});

// Baseline BOTH counters before the redemption. The superadmin "Total Usage" is snapshotted
// here too rather than assumed equal to the agent-side used count: they are two different
// surfaces, and asserting a delta against the wrong baseline would either mask a broken
// counter or invent a failure.
Given('I have noted my promo {string} used count', { timeout: 180000 }, async function (field) {
  await ref(this).openShareModal('Promo Code');
  const raw = await ref(this).readPromoDetail(field);
  await ref(this).closeShareModal();
  const used = numbersIn(raw || '')[0];
  expect(Number.isFinite(used), `used count parsed from "${field}" = "${raw}"`).toBeTruthy();
  this._usedBefore = used;

  const admin = await superadminContext(this);
  await admin.openPromoTools(AGENT_EMAIL);
  const adminRaw = await admin.readParameter('Total Usage');
  const adminUsed = numbersIn(adminRaw || '')[0];
  expect(
    Number.isFinite(adminUsed),
    `superadmin "Total Usage" parsed from "${adminRaw}"`
  ).toBeTruthy();
  this._adminUsageBefore = adminUsed;
});

// Sign a brand-new candidate up under THIS agent's code, in its own context so the
// agent session stays live for the assertions that follow. The code is READ OFF THE
// DASHBOARD and cross-checked against REFERRAL_SIGNUP_AGENT_CODE, so a stale .env fails
// loudly here instead of quietly attributing the candidate to a different agent.
async function signUpCandidateUnderThisAgent(world) {
  if (world._candidate) return world._candidate;
  const agentCode = (await ref(world).readCode('Agent Code')).trim();
  const configured = (REFERRAL_AGENT_CODE || '').trim();
  if (!configured || configured.toUpperCase() !== agentCode.toUpperCase()) {
    throw new Error(
      `REFERRAL_SIGNUP_AGENT_CODE is "${configured || '(unset)'}" but the logged-in referral `
      + `agent's Agent Code is "${agentCode}". Point REFERRAL_SIGNUP_AGENT_CODE at this agent so `
      + 'the provisioned candidate really belongs to the agent whose promo is under test.'
    );
  }

  const context = await world.browser.newContext(video.contextOptions());
  const page = video.track(world, await context.newPage(), 'candidate');
  const SubscriptionPage = require('../pages/SubscriptionPage');
  // provisionFreshCandidate drives world.page / world.pages.subscription, so hand it a
  // lightweight world bound to the candidate's own page.
  const candidateWorld = {
    page,
    context,
    browser: world.browser,
    pages: { subscription: new SubscriptionPage(page) },
  };
  await provisionFreshCandidate(candidateWorld, { agentCode });
  world._candidateContext = context;
  world._candidate = candidateWorld;
  return candidateWorld;
}

Given('a fresh candidate has signed up under my agent code', { timeout: 300000 }, async function () {
  await signUpCandidateUnderThisAgent(this);
});

When('that candidate opens the invoice for the {string} plan', { timeout: 120000 }, async function (plan) {
  const sub = this._candidate.pages.subscription;
  await sub.gotoCheckout(plan);
  this._subtotalBefore = await sub.amountFor('Subtotal').catch(() => null);
});

When('that candidate applies my promo code', { timeout: 120000 }, async function () {
  const sub = this._candidate.pages.subscription;
  this._promoResult = await sub.applyPromoAwaitingPreview(this._promoCode);
});

// Named "for that candidate" on purpose: subscription.steps.js:307 already owns the bare
// `the promo code should be accepted`, and that one asserts against the CANDIDATE world's own
// subscription page. This assertion is about the separately-provisioned candidate in its own
// browser context plus the preview API's verdict, so the two cannot share a definition —
// giving them the same text made both ambiguous and unrunnable.
Then('the promo code should be accepted for that candidate', async function () {
  const r = this._promoResult || {};
  expect(
    r.rejected,
    `the agent's own promo code "${this._promoCode}" was rejected by the API `
    + `(${r.status}${r.body ? `: ${String(r.body).slice(0, 200)}` : ''}). A live promo assigned to `
    + 'this agent must be redeemable by their candidate.'
  ).toBeFalsy();
  const sub = this._candidate.pages.subscription;
  await expect(sub.promoError, 'inline promo error').toBeHidden({ timeout: 10000 });
});

Then('a discount matching my promo value should be applied to the invoice', async function () {
  const sub = this._candidate.pages.subscription;
  await expect(sub.discountLine, 'discount line on the invoice').toBeVisible({ timeout: 20000 });
  const line = ((await sub.discountLine.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const promoNums = numbersIn(this._promoDiscount || '');
  if (promoNums.length) {
    expect(
      line,
      `invoice discount line "${line}" should reflect the promo's configured value `
      + `"${this._promoDiscount}"`
    ).toMatch(new RegExp(promoNums[0].toString().replace('.', '\\.')));
  }
});

Then('the total due should be less than the subtotal', async function () {
  const sub = this._candidate.pages.subscription;
  const subtotal = await sub.amountFor('Subtotal');
  const total = await sub.amountFor('Total due today');
  const n = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
  expect(
    n(total) < n(subtotal),
    `total due (${total}) should be below the subtotal (${subtotal}) once the promo is applied`
  ).toBeTruthy();
});

// The usage counter is the agent-facing proof a redemption landed, and it only moves on a
// COMPLETED payment — so this really does charge the PayTabs test card and really does burn
// one of the promo's 100 uses. That is why the scenario carries @consumes-promo and is
// excluded from the default run (see cucumber.js).
When('a candidate of mine subscribes using my promo code and pays', { timeout: 600000 }, async function () {
  const promo = this._promoCode || (await ref(this).readCode('Promo Code'));
  const candidate = await signUpCandidateUnderThisAgent(this);
  const sub = candidate.pages.subscription;

  await sub.gotoCheckout('Monthly');
  const applied = await sub.applyPromoAwaitingPreview(promo);
  if (applied.rejected) {
    throw new Error(
      `The agent's promo "${promo}" was rejected at the invoice (${applied.status}`
      + `${applied.body ? `: ${String(applied.body).slice(0, 200)}` : ''}), so no redemption `
      + 'could be completed and the usage counter cannot move.'
    );
  }
  await expect(sub.discountLine, 'discount line before paying').toBeVisible({ timeout: 20000 });

  await sub.payWithTestCard();
  await sub.successTitle.waitFor({ state: 'visible', timeout: 60000 });
  this._paidWithPromo = promo;
});

// The counter is written by the payment webhook, so it can trail the redirect back from
// PayTabs by a few seconds. Re-read a handful of times before failing — but assert the exact
// expected value, never "greater than", so a double-count is a failure too.
Then('my promo {string} used count should have increased by 1', { timeout: 180000 }, async function (field) {
  const want = this._usedBefore + 1;
  let raw = null;
  let now = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await ref(this).navigate();
    await ref(this).openShareModal('Promo Code');
    raw = await ref(this).readPromoDetail(field);
    await ref(this).closeShareModal();
    now = numbersIn(raw || '')[0];
    if (now === want) break;
    await this.page.waitForTimeout(5000);
  }
  expect(
    now,
    `promo "${field}" used count after one completed redemption (read "${raw}"); it was `
    + `${this._usedBefore} before the payment`
  ).toBe(want);
});

Then('the superadmin {string} for my promo should have increased by 1', { timeout: 180000 }, async function (field) {
  const want = this._adminUsageBefore + 1;
  const admin = await superadminContext(this);
  let raw = null;
  let now = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await admin.openPromoTools(AGENT_EMAIL);
    raw = await admin.readParameter(field);
    now = numbersIn(raw || '')[0];
    if (now === want) break;
    await this.page.waitForTimeout(5000);
  }
  expect(
    now,
    `superadmin "${field}" after one completed redemption (read "${raw}"); it was `
    + `${this._adminUsageBefore} before the payment`
  ).toBe(want);
});

// Close the candidate context opened by the redemption scenarios.
After(async function () {
  if (this._candidateContext) {
    await this._candidateContext.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await this._candidateContext.close().catch(() => {});
    this._candidateContext = null;
    this._candidate = null;
  }
});
