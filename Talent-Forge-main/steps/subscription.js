const { Given, When, Then, Before } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const {
  provisionFreshCandidate,
  subscribeAndPay,
  provisionNonPaidRow,
  ensurePlanBelow,
} = require('../utils/subscriptionProvision');
const {
  collectGatewayEvidence,
  collectRecordEvidence,
  verifyPdfStatesCharge,
  describeReconciliation,
} = require('../utils/chargeReconciliation');
const { excerpt: pdfExcerpt } = require('../utils/pdfText');
require('dotenv').config();

// NOTE ON REUSED STEPS: the generic steps `I click {string}` (change-password.steps.js)
// and `the {string} button should be enabled|disabled` (signup.steps.js) already exist
// project-wide and resolve by button name — this file deliberately does NOT redefine
// them (that would make Cucumber ambiguous). The Subscription feature uses them for
// "Continue" and "Keep My Plan".

const CANDIDATE_EMAIL = process.env.CANDIDATE_EMAIL;
// .env spells the var CANDIDTAE_PASSWORD (typo); accept the correct spelling too.
const CANDIDATE_PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Condense an assertion error to a one-line headline.
//
// The table-driven steps in this file replaced Scenario Outlines, so a single step now covers
// what used to be 2-3 separate report rows. To keep that from hiding failures, each of them
// checks EVERY row and collects the problems instead of throwing on the first — and Playwright's
// assertion errors are multi-line (locator dump, expected/received, call log), which would make
// a joined message unreadable. Keep the first few lines only.
function brief(err) {
  return String((err && err.message) || err)
    .split('\n')
    .slice(0, 3)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Extract the "SAR ..." amount from the row that holds a given label.
async function readAmount(page, label) {
  const labelEl = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, 'i')).first();
  await labelEl.waitFor({ state: 'visible', timeout: 15000 });
  const rowText = (await labelEl.locator('xpath=..').innerText().catch(() => '')) || '';
  const m = rowText.match(/SAR[\s ]*[\d.,]+/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : rowText.trim();
}

function amountToNumber(s) {
  const m = String(s).match(/[\d.,]+/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
}

const sub = (world) => world.pages.subscription;

// ==================== Background ====================

const POST_LOGIN_URL = /\/getting-started|\/dashboard|\/profile|\/my-track/;

// @provision scenarios need a FRESH, never-subscribed candidate (the shared
// account is already subscribed). This flag flips the Background login to
// provision one instead. Set before any step runs.
Before({ tags: '@provision' }, function () {
  this._provisionFresh = true;
});

// Candidate login. The dev environment's login redirect is occasionally slow, so
// wait generously and retry the submit once if we are still on /login — this keeps
// the per-scenario re-login (project convention) from flaking on a slow response.
Given('I am logged in as a candidate', { timeout: 300000 }, async function () {
  // @provision scenarios sign up a fresh, never-subscribed candidate instead of
  // logging in as the shared (already-subscribed) account.
  if (this._provisionFresh) {
    await provisionFreshCandidate(this);
    return;
  }
  if (!CANDIDATE_EMAIL || !CANDIDATE_PASSWORD) {
    throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  }
  const loginPage = new LoginPage(this.page);
  await loginPage.navigate();
  await loginPage.emailInput.first().fill(CANDIDATE_EMAIL);
  await loginPage.passwordInput.first().fill(CANDIDATE_PASSWORD);
  await loginPage.submitButton.first().click();
  try {
    await this.page.waitForURL(POST_LOGIN_URL, { timeout: 90000, waitUntil: 'commit' });
  } catch (e) {
    // Still on /login: the click may not have registered, or the response stalled.
    if (/\/login/.test(this.page.url())) {
      await loginPage.submitButton.first().click().catch(() => {});
      await this.page.waitForURL(POST_LOGIN_URL, { timeout: 60000, waitUntil: 'commit' });
    } else {
      throw e;
    }
  }
});

// ==================== Plan selection ====================

When('I open the subscription plans screen', async function () {
  await sub(this).gotoPlans();
});

Then('the following plans should be displayed:', async function (dataTable) {
  for (const { plan, price, frequency } of dataTable.hashes()) {
    await expect(
      this.page.getByText(new RegExp(`^${plan} Plan$`, 'i')).first(),
      `plan name "${plan} Plan"`
    ).toBeVisible({ timeout: 15000 });
    await expect(
      this.page.getByText(price, { exact: false }).first(),
      `price "${price}"`
    ).toBeVisible();
    await expect(
      this.page.getByText(frequency, { exact: false }).first(),
      `frequency "${frequency}"`
    ).toBeVisible();
  }
});

Then('the {string} plan should show the badge {string}', async function (_plan, badge) {
  await expect(this.page.getByText(new RegExp(`^${escapeRegExp(badge)}$`, 'i')).first()).toBeVisible();
});

Then('the {string} plan should show a savings percentage', async function (plan) {
  const card = sub(this).planCard(plan);
  const txt = (await card.innerText().catch(() => '')) || '';
  expect(txt, `"${plan}" card should mention a savings %`).toMatch(/\d+(\.\d+)?%/);
});

Then('the {string} plan card should contain {string}', async function (plan, text) {
  const card = sub(this).planCard(plan);
  await expect(card, `"${plan}" card should contain "${text}"`).toContainText(
    new RegExp(escapeRegExp(text), 'i'),
    { timeout: 10000 }
  );
});

When('I select the {string} plan', async function (plan) {
  await sub(this).selectPlan(plan);
});

// Replaces a Scenario Outline over Monthly/Quarterly/Yearly: all three plans are walked in one
// scenario (returning to the plan-selection screen between them), so the Background login runs
// once instead of three times and the report shows one row. Needs its own timeout — three
// navigations do not fit the 60s default.
Then('selecting each of the following plans should open its own invoice:', { timeout: 180000 }, async function (dataTable) {
  const plans = dataTable.hashes().map((row) => row.plan);
  const problems = [];
  for (const [i, plan] of plans.entries()) {
    try {
      // The first pass reuses the plans screen the preceding When step already opened.
      if (i > 0) await sub(this).gotoPlans();
      await sub(this).selectPlan(plan);
      await expect(this.page, `${plan}: invoice URL`).toHaveURL(/\/subscribe\/checkout/, { timeout: 15000 });
      await expect(
        this.page.getByText(new RegExp(`^Subscribe to ${escapeRegExp(plan)} Plan$`, 'i')).first(),
        `${plan}: invoice heading`
      ).toBeVisible({ timeout: 15000 });
    } catch (e) {
      problems.push(`${plan}: ${brief(e)}`);
    }
  }
  expect(problems, `plans that did not open their own invoice — ${problems.join(' | ')}`).toEqual([]);
});

Then('I should be on the invoice screen', async function () {
  await expect(this.page).toHaveURL(/\/subscribe\/checkout/, { timeout: 15000 });
});

// The plan-selection screen is /subscribe WITHOUT the /checkout segment; assert on the
// rendered plan cards too so a bare URL match can't pass on a half-loaded page.
Then('I should be on the plan-selection screen', async function () {
  await expect(this.page).toHaveURL(/\/subscribe(?!\/checkout)/, { timeout: 15000 });
  await expect(sub(this).selectPlanButtons.first()).toBeVisible({ timeout: 30000 });
});

When('I click the invoice Back button', async function () {
  await sub(this).backButton.click();
});

// ==================== Invoice ====================

When('I open the invoice for the {string} plan', async function (plan) {
  await sub(this).gotoCheckout(plan);
});

Given('I am on the invoice for the {string} plan', async function (plan) {
  await sub(this).gotoCheckout(plan);
});

Then('the invoice heading should read {string}', async function (heading) {
  await expect(
    this.page.getByText(new RegExp(`^${escapeRegExp(heading)}$`, 'i')).first()
  ).toBeVisible({ timeout: 15000 });
});

Then('the {string} amount should be {string}', async function (label, expected) {
  const actual = await readAmount(this.page, label);
  // Compare numerically so "SAR 155.0" == "SAR 155.00".
  expect(amountToNumber(actual), `${label} (${actual})`).toBe(amountToNumber(expected));
});

Then('the {string} amount should be less than {string}', async function (label, ceiling) {
  const actual = await readAmount(this.page, label);
  expect(amountToNumber(actual)).toBeLessThan(amountToNumber(ceiling));
});

Then('{string} should be shown as the payment method', async function (method) {
  await expect(this.page.getByText(new RegExp(`^${escapeRegExp(method)}$`, 'i')).first()).toBeVisible();
});

Then('a plan credit line should be shown', async function () {
  await expect(sub(this).planCreditLabel).toBeVisible({ timeout: 15000 });
});

// The pro-rata arithmetic itself, which "the total is less than the subtotal" never checked —
// any credit of any size satisfies that, including one computed wrongly. The credit is what the
// candidate is being told they are getting back for the unused part of their current plan, so
// the total has to reconcile with it exactly.
Then('the total due should be the subtotal minus the plan credit', async function () {
  const totals = await sub(this).readInvoiceTotals();
  const { subtotal, total, credit } = totals;
  expect(credit, 'no plan credit line is rendered on this invoice').not.toBeNull();
  const discount = totals.discount.present && totals.discount.amount !== null
    ? totals.discount.amount
    : 0;
  const expected = Number(Math.max(0, subtotal - credit - discount).toFixed(2));
  expect(
    total,
    `Total due today should be the SAR ${subtotal} subtotal minus the SAR ${credit} plan credit`
    + `${discount ? ` minus the SAR ${discount} promo discount` : ''} = SAR ${expected}; the `
    + `invoice shows SAR ${total}`
  ).toBeCloseTo(expected, 2);
});

// Replaces a Scenario Outline over the three plans: opens each plan's invoice in turn and checks
// its totals plus the customer/payment form. Every plan is checked even if an earlier one fails,
// so the report names all the broken plans at once.
Then(
  'each of the following plan invoices should show its totals and a complete customer form:',
  { timeout: 180000 },
  async function (dataTable) {
    const s = sub(this);
    const problems = [];
    for (const { plan, amount } of dataTable.hashes()) {
      try {
        await s.gotoCheckout(plan);
        await expect(
          this.page.getByText(new RegExp(`^Subscribe to ${escapeRegExp(plan)} Plan$`, 'i')).first(),
          'invoice heading'
        ).toBeVisible({ timeout: 15000 });
        for (const label of ['Subtotal', 'Total due today']) {
          const actual = await readAmount(this.page, label);
          // Compare numerically so "SAR 155.0" == "SAR 155.00".
          expect(amountToNumber(actual), `${label} (${actual})`).toBe(amountToNumber(amount));
        }
        await expect(s.paymentMethodLabel, 'PayTabs as the payment method').toBeVisible({ timeout: 10000 });
        for (const field of ['First Name', 'Last Name']) {
          const value = await fieldFor(this, field).inputValue();
          expect(value.trim(), `${field} should be pre-filled`).not.toBe('');
        }
        expect(await s.emailInput.inputValue(), 'Email Address').toContain(CANDIDATE_EMAIL);
        // 150, not the 250 in the written AC: capping the textarea at 150 IS the fix that
        // closed TFF-442/443 ("Billing Address accepts >150 chars / causes overflow"), so the
        // app is correct here and the 250 was stale. Kept in sync with the @boundary scenario.
        await expect(s.billingAddressInput, 'billing address maxlength').toHaveAttribute('maxlength', '150');
      } catch (e) {
        problems.push(`${plan}: ${brief(e)}`);
      }
    }
    expect(problems, `plan invoices with problems — ${problems.join(' | ')}`).toEqual([]);
  }
);

// ---- Yearly-upgrade toggle ----

Then('the yearly-upgrade toggle should be visible', async function () {
  await expect(sub(this).yearlyToggle).toBeVisible({ timeout: 15000 });
});

Then('the yearly-upgrade toggle should not be visible', async function () {
  await expect(sub(this).yearlyToggle).toHaveCount(0, { timeout: 10000 });
});

Then('the yearly-upgrade toggle should read {string}', async function (text) {
  await expect(sub(this).yearlyToggleSaveText).toContainText(new RegExp(escapeRegExp(text), 'i'), {
    timeout: 10000,
  });
});

When('I switch the yearly-upgrade toggle on', async function () {
  await sub(this).setYearlyToggle(true);
});

When('I switch the yearly-upgrade toggle off', async function () {
  await sub(this).setYearlyToggle(false);
});

Then('the plan sub-card should show {string}', async function (text) {
  // The sub-card is the block holding the plan's frequency line ("Billed …"); locate
  // it by that content and read its parent so the toggle's own "with yearly plan"
  // label cannot produce a false match, and neither can the "Subscribe to Yearly Plan"
  // heading. (Known-issue M1: on yearly toggle the sub-card is NOT updated.)
  const card = this.page.getByText(/^Billed /i).first().locator('xpath=..');
  await expect(card).toContainText(new RegExp(escapeRegExp(text), 'i'), { timeout: 10000 });
});

// ==================== Promo code ====================

When('I open the promo code field', async function () {
  await sub(this).openPromo();
});

When('I enter the promo code {string}', async function (code) {
  await sub(this).openPromo();
  await sub(this).promoInput.fill(code);
});

When('I apply the promo code {string}', async function (code) {
  await sub(this).applyPromo(code);
});

Then('the promo code should be accepted', async function () {
  // A valid code collapses the field to an applied chip with a Remove CTA and no error.
  await expect(sub(this).promoRemoveButton).toBeVisible({ timeout: 10000 });
  await expect(sub(this).promoError).toBeHidden({ timeout: 5000 });
});

Then('a {string} promo action should be available', async function (_label) {
  await expect(sub(this).promoRemoveButton).toBeVisible({ timeout: 10000 });
});

When('I remove the applied promo code', async function () {
  await sub(this).promoRemoveButton.click();
});

When('I modify the promo code by appending {string}', async function (chars) {
  const current = await sub(this).promoInput.inputValue();
  await sub(this).promoInput.fill(current + chars);
});

Then('the promo error {string} should be displayed', async function (msg) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(msg), 'i')).first()).toBeVisible({
    timeout: 10000,
  });
});

Then('the promo error {string} should not be displayed', async function (msg) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(msg), 'i')).first()).toBeHidden({
    timeout: 10000,
  });
});

Then('the {string} promo button should be disabled', async function (_label) {
  await expect(sub(this).promoApplyButton).toBeDisabled({ timeout: 10000 });
});

Then('the {string} promo button should be enabled', async function (_label) {
  await expect(sub(this).promoApplyButton).toBeEnabled({ timeout: 10000 });
});

Then('the promo code entry should be reset to the {string} link', async function (_label) {
  await expect(sub(this).addPromoLink).toBeVisible({ timeout: 10000 });
});

Then('the promo code input should have a max length of {int}', async function (max) {
  await expect(sub(this).promoInput).toHaveAttribute('maxlength', String(max));
});

When('I type {string} into the promo code field', async function (text) {
  await sub(this).promoInput.fill(text);
});

Then('the promo code field should only contain alphanumeric characters', async function () {
  const value = await sub(this).promoInput.inputValue();
  expect(value, `promo value "${value}"`).toMatch(/^[a-z0-9]*$/i);
});

Then('the promo code field value should be at most {int} characters', async function (max) {
  const value = await sub(this).promoInput.inputValue();
  expect(value.length).toBeLessThanOrEqual(max);
});

// No discount line has two very different causes, so name which one happened instead of
// timing out on an invisible locator (verified live 2026-07-28):
//   a) the backend REJECTED the code — POST .../preview/ answers 422 ["Invalid promo code."]
//      on both the subscribe and the change/upgrade invoice, i.e. the code is dead in this
//      environment. That is test-data, not an app defect, and needs a live code from dev.
//   b) the code was accepted (200) and the app still renders no discount — the real defect.
// Either way the app ALSO renders the applied-promo chip + "Remove" with no field-level error
// and dumps "Invalid promo code." at the foot of the page, so the UI reads as discounted while
// the total is unchanged — that part is an app bug regardless of which cause is in play.
Then('a discount line should be shown below the subtotal', async function () {
  const discount = this.page.getByText(/discount/i).first();
  if (await discount.isVisible().catch(() => false)) return;

  const rejected = await this.page
    .getByText(/invalid promo code|invalid or expired promotion code/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (rejected) {
    const promo = await sub(this).promoInput.inputValue().catch(() => '');
    throw new Error(
      `No discount line: the backend REJECTED the promo code${promo ? ` "${promo}"` : ''} `
      + '(POST .../preview/ -> 422 "Invalid promo code."), so no discount can be applied. '
      + 'The invoice nevertheless shows the code as applied (chip + Remove) with no error on '
      + 'the field itself. Needs a promo code that is live in this environment; see '
      + 'features/Candidate_Portal/SUBSCRIPTION_JIRA_VS_APP.md.'
    );
  }
  await expect(discount, 'discount line below the subtotal').toBeVisible({ timeout: 10000 });
});

// ==================== Customer information ====================

Then('the {string} field should not be empty', async function (field) {
  const value = await fieldFor(this, field).inputValue();
  expect(value.trim(), `${field} should be pre-filled`).not.toBe('');
});

Then('the {string} field should contain the candidate email', async function (_field) {
  const value = await sub(this).emailInput.inputValue();
  expect(value).toContain(CANDIDATE_EMAIL);
});

When('I clear the {string} field', async function (field) {
  await fieldFor(this, field).fill('');
});

// Replaces a Scenario Outline over the three required fields — and is STRONGER than the outline
// it replaces. That version reloaded the invoice per example, so each example only ever saw one
// empty field; here the other fields are restored to their original values before each one is
// cleared, which proves Continue is disabled by THAT field rather than by emptiness left over
// from the previous row. Continue is asserted ENABLED with everything filled first: without that
// premise the disabled checks below could all pass vacuously.
Then(
  'clearing each of the following required fields should disable Continue:',
  { timeout: 120000 },
  async function (dataTable) {
    const s = sub(this);
    const ALL = ['First Name', 'Last Name', 'Email Address'];
    const original = {};
    for (const field of ALL) original[field] = await fieldFor(this, field).inputValue();

    await expect(s.continueButton, 'Continue with every required field filled').toBeEnabled({ timeout: 10000 });

    const problems = [];
    for (const { field } of dataTable.hashes()) {
      try {
        for (const [name, value] of Object.entries(original)) await fieldFor(this, name).fill(value);
        await fieldFor(this, field).fill('');
        await expect(s.continueButton).toBeDisabled({ timeout: 10000 });
      } catch (e) {
        problems.push(`"${field}" empty but Continue was not disabled: ${brief(e)}`);
      }
    }
    expect(problems, `required-field checks — ${problems.join(' | ')}`).toEqual([]);
  }
);

function fieldFor(world, field) {
  const s = sub(world);
  const key = field.trim().toLowerCase();
  if (key.startsWith('first')) return s.firstNameInput;
  if (key.startsWith('last')) return s.lastNameInput;
  if (key.startsWith('email')) return s.emailInput;
  throw new Error(`Unknown customer field "${field}"`);
}

// Edit a customer field and confirm the change is reflected in the field value.
When('I change the {string} field to {string}', async function (field, value) {
  await fieldFor(this, field).fill(value);
});

Then('the {string} field should show {string}', async function (field, value) {
  await expect(fieldFor(this, field)).toHaveValue(value);
});

// Clear a required field and blur it (focus another field) so its inline error fires.
When('I clear the {string} field and move away', async function (field) {
  await fieldFor(this, field).fill('');
  const other = /first/i.test(field) ? sub(this).emailInput : sub(this).firstNameInput;
  await other.click();
});

Then('a validation error {string} should be shown', async function (msg) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(msg), 'i')).first()).toBeVisible({
    timeout: 10000,
  });
});

// Blur a customer field so its inline validation fires. (Distinct from "clear … and move
// away", which also empties the field.)
When('I move focus away from the {string} field', async function (field) {
  const target = /email/i.test(field) ? sub(this).firstNameInput : sub(this).emailInput;
  await target.click();
  await this.page.waitForTimeout(600);
});

// Same disjunctive contract as the login/signup validation steps (see CLAUDE.md): either
// inline helper text appears OR Continue is disabled — both are acceptable feedback.
async function invoiceEmailFeedback(world) {
  const inlineError = world.page
    .getByText(/valid email|invalid email|email .*(?:invalid|not valid|format)/i)
    .first();
  const hasInline = await inlineError.isVisible().catch(() => false);
  const continueDisabled = await sub(world).continueButton.isDisabled().catch(() => false);
  return { hasInline, continueDisabled, rejected: hasInline || continueDisabled };
}

// Named "invoice email field" so it cannot collide with login.step.js's email step.
Then('a validation message should be shown for the invoice email field', async function () {
  const { rejected } = await invoiceEmailFeedback(this);
  expect(rejected, 'expected either an inline email-format error or a disabled Continue button').toBe(true);
});

// Replaces a Scenario Outline over the three malformed addresses. This is a @known-issue
// scenario (the app accepts all of them today), so collecting every address rather than
// throwing on the first matters: one run reports the full extent of the defect.
Then(
  'each of the following malformed email addresses should be rejected:',
  { timeout: 120000 },
  async function (dataTable) {
    const s = sub(this);
    const accepted = [];
    for (const { email } of dataTable.hashes()) {
      await s.emailInput.fill(email);
      // Blur onto another field so the inline validation fires.
      await s.firstNameInput.click();
      await this.page.waitForTimeout(600);
      const { rejected } = await invoiceEmailFeedback(this);
      if (!rejected) accepted.push(`"${email}"`);
    }
    expect(
      accepted,
      `accepted with no inline error and Continue still enabled: ${accepted.join(', ')}`
    ).toEqual([]);
  }
);

Then('the billing address field should accept up to {int} characters', async function (max) {
  const el = sub(this).billingAddressInput;
  await el.fill('x'.repeat(max));
  expect((await el.inputValue()).length, `should hold ${max} chars`).toBe(max);
});

Then('typing beyond {int} characters into the billing address is blocked', async function (max) {
  const el = sub(this).billingAddressInput;
  await el.fill('y'.repeat(max + 60));
  const len = (await el.inputValue()).length;
  expect(len, `value should be capped at ${max}, got ${len}`).toBeLessThanOrEqual(max);
});

Then('the billing address field should have a max length of {int}', async function (max) {
  await expect(sub(this).billingAddressInput).toHaveAttribute('maxlength', String(max));
});

// ==================== Payment / PayTabs ====================

When('I click the invoice {string} button', async function (_label) {
  await sub(this).continueButton.click();
});

Then('I should be redirected to the PayTabs payment gateway', async function () {
  await this.page.waitForURL(/paytabs\./i, { timeout: 60000 });
  expect(this.page.url()).toMatch(/paytabs\./i);
});

// hooks.js calls setDefaultTimeout(60000), which overrides the provision profile's
// 300s config timeout — so this step needs its own. payWithTestCard waits up to
// 30s for the card form + 150s for the sandbox redirect back, i.e. 180s worst case.
When('I complete payment on PayTabs with the test card', { timeout: 300000 }, async function () {
  await sub(this).payWithTestCard();
});

// Expired card (12/25): PayTabs refuses it in its own form and never redirects, so the
// step only submits — the assertions below read the gateway page.
When('I submit an expired card on PayTabs', { timeout: 120000 }, async function () {
  await sub(this).submitExpiredCard();
});

Then('the PayTabs error {string} should be shown', async function (msg) {
  await expect(sub(this).paytabsFormErrorFor(escapeRegExp(msg))).toBeVisible({ timeout: 30000 });
});

// The gateway rejected the card before processing, so the browser must still be on the
// PayTabs payment page — proof no charge was attempted and the app was never called back.
Then('I should remain on the PayTabs payment page', async function () {
  expect(this.page.url(), 'should still be on the PayTabs gateway').toMatch(/paytabs\./i);
  await expect(sub(this).paytabsPayNow).toBeVisible();
});

// Reach PayTabs from the invoice, fill the card, then cancel — the app returns to the
// invoice with the "Payment unsuccessful" toast. Verified live 2026-07-22.
When('payment fails on PayTabs', { timeout: 120000 }, async function () {
  await sub(this).cancelPaymentOnPayTabs();
});

// @mocked — the sandbox gateway cannot be made unreachable for real, so the
// session-create call (POST /payments/paytabs/initiate/) is aborted at the network
// layer. Nothing is fabricated: the genuine request simply never completes.
Given('the payment gateway is unreachable', async function () {
  await sub(this).stubGatewayUnreachable();
});

Then('the success modal titled {string} should be shown', async function (title) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(title), 'i')).first()).toBeVisible({
    timeout: 30000,
  });
});

Then('a/the {string} CTA should be shown', async function (label) {
  const cta = this.page
    .getByRole('link', { name: new RegExp(escapeRegExp(label), 'i') })
    .or(this.page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }))
    .first();
  await expect(cta).toBeVisible({ timeout: 15000 });
});

When('I return to the Subscription tab from the success modal', async function () {
  await this.page.getByRole('button', { name: /^back$/i }).first().click();
  await this.page.waitForURL(/selectedTab=subscription/, { timeout: 30000 });
});

Then('an error toast {string} should be shown', async function (msg) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(msg), 'i')).first()).toBeVisible({
    timeout: 15000,
  });
});

// >>> THE EXPECTED ADDRESS IS WHOEVER IS SIGNED IN, NOT THE SHARED CONSTANT. <<< The healing
// Given `my subscription is on a plan below "<plan>"` provisions and signs in as a BRAND NEW
// candidate whenever the shared account has drifted up to the top tier, and records it on
// world._freshEmail. Pinning CANDIDATE_EMAIL therefore failed with
//   Expected substring: "candidates@iqra.anonaddy.com"
//   Received string:    "candidates+submtr2krsd5zfw@iqra.anonaddy.com"
// on an invoice that had retained the customer details perfectly - it reported the very defect
// this step exists to catch, on a run where nothing was wrong.
Then('I should remain on the invoice with my details retained', async function () {
  await expect(this.page).toHaveURL(/\/subscribe\/checkout/, { timeout: 15000 });
  await expect(sub(this).continueButton).toBeVisible({ timeout: 10000 });
  // Customer info survives the aborted payment.
  expect((await sub(this).firstNameInput.inputValue()).trim(), 'first name retained').not.toBe('');
  const signedInAs = this._freshEmail || CANDIDATE_EMAIL;
  expect(
    await sub(this).emailInput.inputValue(),
    `the invoice should still carry the signed-in candidate (${signedInAs})`
  ).toContain(signedInAs);
});

// POST /payments/paytabs/initiate/ is the ONLY path that creates a subscription or a
// plan change, so "nothing was created" is provable by showing that (a) the app did try
// it, (b) no attempt ever reached the server, and (c) the browser never reached the
// gateway — no payment page was ever presented.
Then('no new subscription should have been created', async function () {
  const s = sub(this);
  expect(s.gatewayAttempts, 'the app should have attempted the gateway session').toBeGreaterThan(0);
  expect(s.gatewaySuccesses, 'no gateway session should have reached the server').toBe(0);
  expect(this.page.url(), 'browser should never have reached PayTabs').not.toMatch(/paytabs\./i);
});

// ==================== Subscription tab ====================

When('I open the Subscription tab', async function () {
  await sub(this).gotoSubscriptionTab();
});

Then('my subscription state should be {string}', async function (state) {
  // Poll — the tab re-renders after a cancel/resubscribe action, so the state can
  // take a moment to settle (Resubscribe CTA appearing, etc.).
  await expect
    .poll(async () => sub(this).currentState(), { timeout: 15000, message: 'subscription tab state' })
    .toBe(state);
});

// MOVED to steps/common.js (the suite-wide owner of generic phrases) during the playwright-bdd
// migration. `the "<x>" section should be visible` matches rendered text and nothing else, so it
// is page-agnostic - and Referral-Codes.feature was borrowing it from here through Cucumber's ONE
// global step registry. playwright-bdd generates from steps/ only, so a generic definition owned
// by a feature-specific file is unreachable from any other feature. Bodies moved verbatim.


Then('an {string} date should be shown', async function (label) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(label), 'i')).first()).toBeVisible({
    timeout: 15000,
  });
});

// Plan-agnostic: any current-plan date line — "Auto-renews on", a scheduled-change
// notice ("Changes to … on"), or "Expires on" — so the assertion holds whether the
// account is plainly active, has a scheduled downgrade (Case 3), or is cancelled.
Then('a current-plan date should be shown', async function () {
  await expect(sub(this).anyPlanDate).toBeVisible({ timeout: 15000 });
});

Then('the {string} heading should be shown', async function (heading) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(heading), 'i')).first()).toBeVisible({
    timeout: 15000,
  });
});

Then('a {string} action should be available', async function (label) {
  const btn = this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`, 'i') }).first();
  await expect(btn).toBeVisible({ timeout: 15000 });
  await expect(btn).toBeEnabled();
});

Then('the current plan should be {string}', async function (plan) {
  await expect(sub(this).currentSubscriptionHeading).toBeVisible({ timeout: 15000 });
  await expect(this.page.getByText(new RegExp(escapeRegExp(plan), 'i')).first()).toBeVisible();
});

// ==================== Billing history ====================

Then('the billing history table should display the following columns:', async function (dataTable) {
  const grid = sub(this).billingGrid;
  await expect(grid).toBeVisible({ timeout: 15000 });
  for (const [column] of dataTable.raw()) {
    await expect(
      grid.locator('[role="columnheader"]', { hasText: new RegExp(escapeRegExp(column), 'i') }).first(),
      `column "${column}"`
    ).toBeVisible({ timeout: 10000 });
  }
});

Then('at least one billing row should have status {string}', async function (status) {
  const cell = sub(this)
    .billingGrid.locator('[role="gridcell"]', { hasText: new RegExp(`^${escapeRegExp(status)}$`, 'i') })
    .first();
  await expect(cell).toBeVisible({ timeout: 15000 });
});

Then('the {string} billing row should have enabled receipt View and Download actions', async function (_status) {
  await expect(sub(this).receiptViewButtons.first()).toBeEnabled({ timeout: 15000 });
  await expect(sub(this).receiptDownloadLinks.first()).toBeVisible();
});

Then('the {string} billing row amount should be shown with two decimals', async function (_status) {
  const amountCell = sub(this).billingGrid.locator('[role="gridcell"]', { hasText: /SAR/i }).first();
  const txt = (await amountCell.innerText()).trim();
  expect(txt, `amount cell "${txt}" should show 2 decimals`).toMatch(/SAR\s*[\d,]+\.\d{2}\b/);
});

Then('the {string} billing row date should be in {string} format', async function (_status, _fmt) {
  const dateCell = sub(this).billingGrid.getByText(/\d{1,2}\/\d{1,2}\/\d{2,4}/).first();
  await dateCell.waitFor({ state: 'visible', timeout: 15000 });
  const txt = (await dateCell.innerText()).trim();
  const parts = (txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/) || []).slice(1).map(Number);
  expect(parts.length, `date "${txt}" should parse as d/m/y`).toBe(3);
  const [dd, mm] = parts;
  // DD/MM/YY requires the 1st field to be a valid day (<=31) and 2nd a valid month (<=12).
  expect(dd <= 31 && mm >= 1 && mm <= 12, `date "${txt}" should be DD/MM/YY`).toBeTruthy();
});

// ==================== Change plan ====================

When('I open the Change Plan modal', async function () {
  await sub(this).openChangePlan();
});

Then('the Change Plan modal should show the current plan', async function () {
  await expect(sub(this).changePlanModal.getByText(/current plan/i).first()).toBeVisible({ timeout: 10000 });
});

Then('the Change Plan modal should offer the two non-current plans', async function () {
  const modal = sub(this).changePlanModal;
  // Plan option cards each render a "SAR ###" price; Cancel/Continue do not.
  const options = modal.locator('button', { hasText: /SAR/i });
  await expect(options.first(), 'plan option cards should render').toBeVisible({ timeout: 10000 });
  const count = await options.count();
  expect(count, 'two non-current plan options').toBeGreaterThanOrEqual(2);
});

Then('the first offered plan should be pre-selected', async function () {
  // Plan-agnostic: the first offered (non-current) plan is highlighted, whatever
  // tier the account is currently on.
  const selected = await sub(this).isFirstChangeOptionSelected();
  expect(selected, 'the first offered plan should be pre-selected').toBeTruthy();
});

// Regex, not a Cucumber expression: "/" is the alternation operator in Cucumber
// expressions, so a literal slash needs a "\/" escape that IDE Gherkin plugins
// mis-parse and report as an undefined step. A regex is unambiguous to both.
Then(/^the Change Plan modal should show the upgrade\/downgrade note$/, async function () {
  await expect(
    sub(this).changePlanModal.getByText(/credited toward upgrades|downgrades are non-refundable/i).first()
  ).toBeVisible({ timeout: 10000 });
});

When('I dismiss the Change Plan modal', async function () {
  await sub(this).changePlanCancel.click();
});

Then('the Change Plan modal should close', async function () {
  await expect(sub(this).changePlanModal).toBeHidden({ timeout: 10000 });
});

When('I choose the {string} plan and continue', async function (plan) {
  await sub(this).changePlanOption(plan).click();
  await sub(this).changePlanContinue.click();
  await this.page.waitForURL(/\/subscribe\/checkout/, { timeout: 30000 });
});

// Provision fresh + subscribe + pay so the account is ACTIVE with a Paid billing
// row before the scenario body runs (upgrade / billing-history need this state).
Given('I have an active {string} subscription', { timeout: 300000 }, async function (plan) {
  await subscribeAndPay(this, plan);
});

// Guard for the upgrade scenarios: an upgrade TO a plan only exists while the account is on a
// lower tier, and the shared candidate's tier drifts between runs (a real upgrade in an earlier
// run can leave it on Yearly, where the Change Plan modal offers no Yearly option at all).
// No-op and fast when the tier is already below the target; see
// subscriptionProvision.ensurePlanBelow for what a healing run costs.
Given('my subscription is on a plan below {string}', { timeout: 600000 }, async function (plan) {
  const { healed, plan: from } = await ensurePlanBelow(this, plan);
  console.log(
    healed
      ? `[heal] account was not below "${plan}" — subscribed a fresh candidate to "${from}"`
      : `[heal] account already on "${from}" (below "${plan}") — nothing provisioned`
  );
});

// ---- Real upgrade (destructive) ----
When('I upgrade to the {string} plan with promo code {string} and pay', { timeout: 300000 }, async function (plan, promo) {
  this._chargeEvidence = { ...(await sub(this).upgradeWithPayment(plan, { promo })), plan, promo };
});

Then('the plan changed successfully modal should be shown', async function () {
  await expect(sub(this).planChangedModal).toBeVisible({ timeout: 30000 });
});

// ---- Real downgrade (destructive, schedules for cycle end) ----
When('I schedule a downgrade to the {string} plan', async function (plan) {
  await sub(this).scheduleDowngrade(plan);
});

Then('a plan change scheduled modal should be shown', async function () {
  await expect(sub(this).scheduledModal).toBeVisible({ timeout: 15000 });
});

Then('the subscription tab should show a scheduled change to {string}', async function (plan) {
  if (await sub(this).scheduledGotIt.isVisible().catch(() => false)) {
    await sub(this).scheduledGotIt.click();
  }
  await expect(sub(this).scheduledChangeNotice).toBeVisible({ timeout: 15000 });
  await expect(sub(this).scheduledChangeNotice).toContainText(new RegExp(escapeRegExp(plan), 'i'));
});

// Known-issue M2: the credit label repeats "Plan" (e.g. "Quarterly Plan Plan Credit").
Then('the plan credit label should not duplicate the word {string}', async function (word) {
  const label = sub(this).planCreditLabel;
  await label.waitFor({ state: 'visible', timeout: 15000 });
  const txt = (await label.innerText()).trim();
  const re = new RegExp(`${escapeRegExp(word)}\\s+${escapeRegExp(word)}`, 'i');
  expect(re.test(txt), `credit label "${txt}" should not repeat "${word}"`).toBe(false);
});

// ==================== Cancel ====================

When('I open the Cancel Subscription modal', async function () {
  await sub(this).openCancelModal();
});

Then('the cancel modal title {string} should be shown', async function (title) {
  await expect(
    sub(this).cancelModal.getByRole('heading', { name: new RegExp(escapeRegExp(title), 'i') }).first()
  ).toBeVisible({ timeout: 10000 });
});

Then('the cancel modal should mention retained access until the billing end date', async function () {
  await expect(sub(this).cancelModal.getByText(/full access until/i).first()).toBeVisible({
    timeout: 10000,
  });
});

Then('the cancel modal should offer {string} and a confirm-cancel action', async function (keepLabel) {
  await expect(
    sub(this).cancelModal.getByRole('button', { name: new RegExp(escapeRegExp(keepLabel), 'i') }).first()
  ).toBeVisible();
  await expect(sub(this).confirmCancelButton).toBeVisible();
});

Then('the cancel modal should close', async function () {
  await expect(sub(this).cancelModal).toBeHidden({ timeout: 10000 });
});

When('I confirm cancellation of my subscription', async function () {
  await sub(this).confirmCancel();
});

Then('the current subscription should show an {string} date', async function (label) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(label), 'i')).first()).toBeVisible({
    timeout: 15000,
  });
});

Then('the post-cancellation info text should be shown', async function () {
  await expect(sub(this).postCancelInfoText).toBeVisible({ timeout: 15000 });
});

// Resubscribe BEFORE expiry — re-enables auto-renewal via the confirm modal and
// returns the tab to the active state (see M7 note: the app does NOT route to the
// plans screen with a future start date as the written AC11-17 describes).
When('I resubscribe to my plan', async function () {
  await sub(this).resubscribe();
});

// ==================== Receipt viewer ====================

When('I open the first paid receipt', async function () {
  // Capture the row's data first so a later step can cross-check the viewer against it.
  this.paidRowData = await sub(this).firstPaidRowData();
  await sub(this).openFirstPaidReceipt();
});

Then('the receipt viewer should offer a download control', async function () {
  await expect(sub(this).receiptDownloadButton).toBeVisible({ timeout: 10000 });
});

// Cross-check the "Receipt information" panel against the billing row it was opened from.
Then('the receipt information should match that billing row', async function () {
  const row = this.paidRowData;
  expect(row, 'billing row data captured on open').toBeTruthy();
  const plan = await sub(this).receiptPanelValue('Plan Type');
  const amount = await sub(this).receiptPanelValue('Amount');
  const date = await sub(this).receiptPanelValue('Date Issued');
  expect(plan, 'plan type').toBe(row.plan);
  // Amounts compared numerically (row "SAR 45" vs panel "SAR 45").
  expect(amountToNumber(amount), 'amount').toBe(amountToNumber(row.amount));
  // The row date ("7/22/26 15:11 AST") and panel date ("7/22/26, 5:11 PM") share the
  // calendar date — assert that day/month/year appear in both.
  const dmy = (row.date.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || [''])[0];
  expect(date, `panel date should include ${dmy}`).toContain(dmy);
});

Then('the first paid billing row Download should point to a receipt file', async function () {
  const link = sub(this).firstPaidRow().getByRole('link', { name: /download/i }).first();
  await expect(link).toBeVisible({ timeout: 10000 });
  const href = (await link.getAttribute('href')) || '';
  expect(href, `download href "${href}"`).toMatch(/receipt.*\.pdf/i);
});

// FAILS when there is nothing to check, rather than returning green.
//
// This used to log "nothing to assert" and pass. The shared candidate does carry Pending and
// Canceled rows today (3 Paid / 2 Pending / 4 Canceled, probe-billing-status-actions.js), but that
// is account state, not a guarantee — and a scenario that reports PASSED having asserted nothing is
// worse than one that reports a missing precondition, because the report gives no hint that AC23
// went unverified. `provisionNonPaidRow` (subscriptionProvision.js) is how a row is created if the
// account ever loses them.
Then('non-paid billing rows should have disabled receipt actions', async function () {
  const rows = sub(this).nonPaidRows();
  const n = await rows.count();
  expect(
    n,
    'this account has no Pending/Canceled billing row, so AC23\'s rule for non-Paid rows could not '
    + 'be verified at all. Create one with `provisionNonPaidRow` (an abandoned PayTabs session '
    + 'leaves a Pending row) rather than letting this pass vacuously.'
  ).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const actions = row.locator('button[aria-label="View"], button[aria-label="Download"]');
    const m = await actions.count();
    for (let j = 0; j < m; j++) {
      await expect(actions.nth(j), `non-paid row ${i} action ${j} disabled`).toBeDisabled();
    }
  }
});

// ---- Per-status receipt-action rule (AC23), for "Pending" and "Canceled" ----
//
// These four steps replace what used to be a Scenario Outline over the two statuses. The
// status list is declared ONCE — in the Given below — and stashed on the world, so the
// assertions that follow iterate it without the feature file repeating the same table three
// times, and the (potentially very expensive) healing Given runs once per run rather than
// once per status.
function nonPaidStatuses(world) {
  const list = world.nonPaidStatuses;
  if (!list || !list.length) {
    throw new Error(
      'No billing statuses on this scenario — the "payment rows exist in my billing history '
      + 'with the statuses:" Given must run first.'
    );
  }
  return list;
}

// Self-healing precondition: guarantee a row of EACH listed status exists so the assertions
// below have something real to bite on. No-op (and fast) per status when the account already
// has one; otherwise mints one for real — see subscriptionProvision.provisionNonPaidRow for
// the mechanics and the @provision-style constraints a healing run inherits.
//
// The timeout covers the worst case: healing may include a full signup + IMAP email
// verification (~7 min) for the FIRST status, after which provisionFreshCandidate is
// idempotent for this scenario, so any further status only costs another gateway session.
Given('payment rows exist in my billing history with the statuses:', { timeout: 600000 }, async function (dataTable) {
  this.nonPaidStatuses = dataTable.raw().map(([status]) => String(status).trim()).filter(Boolean);
  for (const status of this.nonPaidStatuses) {
    const { label, healed, rows } = await provisionNonPaidRow(this, status);
    console.log(
      healed
        ? `[heal] no "${label}" billing row found — minted one on a freshly provisioned candidate (now ${rows})`
        : `[heal] "${label}" billing row already present (${rows}) — nothing provisioned`
    );
  }
});

// Strict on purpose, unlike the lenient catch-all above: a status with no row FAILS rather
// than silently passing. Every status is checked before reporting, so a run tells you about
// all of the missing ones at once.
Then('each of those statuses should have at least one billing row', async function () {
  const s = sub(this);
  await expect(s.billingGrid).toBeVisible({ timeout: 15000 });
  // The grid paints 10 blank skeleton rows while GET /payments/ is in flight, and count() does
  // not auto-wait — without this the check reads 10 empty statuses and calls every status
  // missing. `When I open the Subscription tab` uses the plain navigation, so the wait belongs
  // here rather than only in gotoSubscriptionTabWithBilling.
  await s.waitForBillingRowsLoaded();
  const missing = [];
  for (const status of nonPaidStatuses(this)) {
    if ((await s.rowsWithStatus(status).count()) === 0) missing.push(status);
  }
  if (missing.length) {
    const seen = await s.allBillingRowStatuses();
    expect(
      missing,
      `no billing row found for ${missing.map((m) => `"${m}"`).join(', ')} — rendered statuses: `
      + `${seen.length ? seen.map((x) => `"${x}"`).join(', ') : '(no rows)'}`
    ).toEqual([]);
  }
});

// Stricter than the catch-all in two further ways: EVERY matching row is checked rather than
// whichever happens to be first, and both controls must actually be PRESENT — a row that
// dropped its icons entirely would otherwise satisfy "not enabled".
//
// `disabled` is the only trustworthy signal here: the app leaves pointer-events:auto and
// opacity:1 on the disabled icons, so a visual check would wrongly read them as active
// (verified live 2026-07-27, scripts/probe-billing-status-actions.js).
Then('every one of those rows should have disabled receipt View and Download actions', async function () {
  const s = sub(this);
  await expect(s.billingGrid).toBeVisible({ timeout: 15000 });
  await s.waitForBillingRowsLoaded();

  const problems = [];
  let checked = 0;
  for (const status of nonPaidStatuses(this)) {
    const rows = s.rowsWithStatus(status);
    const n = await rows.count();
    checked += n;
    for (let i = 0; i < n; i++) {
      const actions = s.receiptActionsIn(rows.nth(i));
      for (const [name, locator] of Object.entries(actions)) {
        if ((await locator.count()) === 0) {
          problems.push(`${status} row ${i}: ${name} control is missing`);
          continue;
        }
        if (await locator.isEnabled().catch(() => true)) {
          problems.push(`${status} row ${i}: ${name} is ENABLED (expected disabled)`);
        }
      }
    }
  }
  expect(problems, `${checked} row(s) checked — ${problems.join(' | ')}`).toEqual([]);
});

// A disabled icon is only half the rule — a non-Paid row must not carry a reachable receipt
// URL either. On a Paid row Download is an <a href="…/receipt….pdf">; on Pending/Canceled the
// app swaps it for a <button> with no href, so any href here means a receipt leaked onto a row
// that was never paid for.
Then('none of those rows should expose a receipt download link', async function () {
  const s = sub(this);
  // Same skeleton race — on blank rows there is no href to find, so this would pass vacuously.
  await s.waitForBillingRowsLoaded();
  const leaked = [];
  for (const status of nonPaidStatuses(this)) {
    const rows = s.rowsWithStatus(status);
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const href = await s.receiptActionsIn(rows.nth(i)).Download.getAttribute('href').catch(() => null);
      if (href) leaked.push(`${status} row ${i} -> ${href}`);
    }
  }
  expect(leaked, `non-paid rows must not link a receipt — ${leaked.join(' | ')}`).toEqual([]);
});

Then('the receipt viewer should be visible', async function () {
  await expect(sub(this).receiptModal).toBeVisible({ timeout: 10000 });
});

Then('the receipt viewer should offer zoom in and zoom out controls', async function () {
  await expect(sub(this).receiptZoomIn).toBeVisible({ timeout: 10000 });
  await expect(sub(this).receiptZoomOut).toBeVisible();
});

// ---- Zoom is asserted FUNCTIONALLY (not just present) via the viewer's own % readout ----

Then('the receipt viewer should show a zoom level of {string}', async function (level) {
  await expect(sub(this).receiptZoomLevel).toHaveText(level, { timeout: 15000 });
  this.receiptZoom = await sub(this).receiptZoomPercent();
});

When('I zoom the receipt in', async function () {
  this.receiptZoom = await sub(this).receiptZoomPercent();
  await sub(this).receiptZoomIn.click();
});

When('I zoom the receipt out', async function () {
  this.receiptZoom = await sub(this).receiptZoomPercent();
  await sub(this).receiptZoomOut.click();
});

Then('the receipt zoom level should have increased', async function () {
  const before = this.receiptZoom;
  await expect
    .poll(async () => sub(this).receiptZoomPercent(), { timeout: 10000, message: 'receipt zoom %' })
    .toBeGreaterThan(before);
});

Then('the receipt zoom level should return to {string}', async function (level) {
  await expect(sub(this).receiptZoomLevel).toHaveText(level, { timeout: 10000 });
});

// The viewer's own Download control (distinct from the billing row's Download link) must
// deliver a real PDF, not just be clickable.
Then('the receipt viewer download control should deliver a valid PDF', async function () {
  const { name, bytes } = await sub(this).downloadReceiptFromViewer();
  expect(name, `downloaded filename "${name}"`).toMatch(/\.pdf$/i);
  expect(bytes.length, 'downloaded PDF byte length').toBeGreaterThan(1000);
  expect(bytes.slice(0, 5).toString('latin1'), 'PDF magic header').toBe('%PDF-');
});

Then('the receipt information panel should show the plan type and amount', async function () {
  const modal = sub(this).receiptModal;
  await expect(modal.getByText(/receipt information/i).first()).toBeVisible({ timeout: 10000 });
  await expect(modal.getByText(/plan type/i).first()).toBeVisible();
  await expect(modal.getByText(/SAR/i).first()).toBeVisible();
});

// The embedded PDF should render (no "Failed to load document"). Observed intermittently
// failing during manual exploration but rendering in automated runs — see
// SUBSCRIPTION_JIRA_VS_APP.md. Kept as @known-issue pending dev confirmation.
Then('the receipt document should render without a load error', async function () {
  await expect(sub(this).receiptModal.getByText(/failed to load document/i)).toHaveCount(0, {
    timeout: 10000,
  });
});

// Download the first Paid row's receipt and confirm it is a real, non-empty PDF —
// i.e. the file actually opens (no "PDF not available"/error page is served). The
// amount itself is asserted separately via the receipt viewer panel (which cross-
// checks the billing row), since the PDF's text streams are compressed.
Then('the receipt download should return a valid PDF', async function () {
  const link = sub(this).firstPaidRow().getByRole('link', { name: /download/i }).first();
  const href = (await link.getAttribute('href')) || '';
  expect(href, `download href "${href.slice(0, 60)}"`).toMatch(/receipt.*\.pdf/i);
  const resp = await this.page.request.get(href);
  expect(resp.status(), 'receipt download HTTP status').toBe(200);
  const body = await resp.body();
  expect(body.length, 'receipt PDF byte length').toBeGreaterThan(1000);
  expect(body.slice(0, 5).toString('latin1'), 'PDF magic header').toBe('%PDF-');
});

// ---- The receipt FILE's contents (not just that it is a file) ----
//
// Every other receipt assertion in this file stops at "it is a real PDF": HTTP 200, a
// `receipt….pdf` href, >1000 bytes, a `%PDF-` header. And `the receipt information should match
// that billing row` compares the viewer panel with the grid row — two renders the same frontend
// produced from the same payload, so their agreeing proves the rendering is self-consistent and
// nothing about whether the figure is right.
//
// This step reads the document itself. The old code declined to, on the grounds that "the PDF's
// text streams are compressed" — true, and no obstacle to a pdfjs-based parser, which inflates
// them exactly as the viewer does.
Then('the receipt PDF should state the same amount, plan and date as that billing row', async function () {
  const row = this.paidRowData;
  expect(row, 'billing row data captured when the receipt was opened').toBeTruthy();
  const amount = amountToNumber(row.amount);
  const fetched = await sub(this).fetchReceiptForPaidRow(0);
  expect(fetched.href, 'that Paid row\'s Download control carries a receipt href').toBeTruthy();
  expect(fetched.status, `receipt download HTTP status for ${fetched.href.slice(0, 80)}`).toBe(200);

  const pdf = await verifyPdfStatesCharge(fetched.bytes, {
    charged: amount,
    planName: (row.plan || '').replace(/\s*plan\s*$/i, '').trim() || null,
    row,
  });
  await this.attach(
    `Billing row: ${row.plan} / ${row.amount} / ${row.date}\n`
    + `Receipt PDF (${pdf.pages} page(s)) states amounts [${pdf.amounts.slice(0, 20).join(', ')}]\n`
    + `PDF text: ${pdfExcerpt(pdf.text, 900)}`,
    'text/plain'
  );
  expect(
    pdf.problems,
    `the receipt PDF behind the "${row.plan} ${row.amount}" billing row does not agree with it — `
    + `${pdf.problems.join(' | ')}`
  ).toEqual([]);
});

// ==================== Reconciling a real payment against its record ====================
//
// Used by the paid promo flows. `_chargeEvidence` is captured by the When step that pays (the
// amount can only be read off the invoice BEFORE the redirect — the success modal does not restate
// it), and asserted here, afterwards, so a discrepancy in the gateway or in the record cannot
// abandon the scenario before its other assertions have run. These scenarios spend real money;
// losing the rest of a run to a first failure is expensive.

Then('the gateway should have been asked for the discounted amount', async function () {
  const ev = this._chargeEvidence;
  expect(ev, 'no payment was recorded in this scenario, so there is nothing to reconcile').toBeTruthy();
  const gateway = await collectGatewayEvidence({
    subs: sub(this),
    collector: ev.collector,
    charged: ev.charged,
    subtotal: ev.totals.subtotal,
    pageRead: ev.pageRead,
    expectPromo: ev.promo || null,
  });
  this._chargeEvidence.gateway = gateway;
  await this.attach(
    describeReconciliation({
      // whoever this run actually signed in as — a throwaway per run for the @provision flows
      account: this._freshEmail || CANDIDATE_EMAIL,
      // Named from the evidence, not hardcoded: this step now serves the first-subscribe flow too,
      // and the attachment read "Upgrade payment" on a payment that was not an upgrade.
      label: `Payment for the ${ev.plan || 'selected'} plan${ev.promo ? ` with promo ${ev.promo}` : ''}`,
      subtotal: ev.totals.subtotal,
      discount: ev.totals.discount && ev.totals.discount.amount,
      charged: ev.charged,
      gateway,
    }),
    'text/plain'
  );
  expect(
    gateway.problems,
    `the invoice said SAR ${ev.charged} was due after the promo discount, but the payment handed to `
    + `the gateway does not agree — ${gateway.problems.join(' | ')}`
  ).toEqual([]);
});

// TWO STEPS, NOT ONE — the in-app record and the downloaded file are asserted apart.
//
// A scenario that makes a real payment cannot be split into two scenarios (the second would need a
// second charge), so the separation is at step level instead: the first step covers the billing row
// and the receipt panel, the second covers the PDF. Today only the PDF is wrong, and one combined
// step would print a single red row implying the whole record is broken. The evidence is gathered
// once, by the first step, and stashed for the second.
Then('the billing record should show the amount that was charged', { timeout: 180000 }, async function () {
  const ev = this._chargeEvidence;
  expect(ev, 'no payment was recorded in this scenario, so there is nothing to reconcile').toBeTruthy();
  const record = await collectRecordEvidence({
    subs: sub(this),
    charged: ev.charged,
    planName: ev.plan || null,
  });
  this._chargeEvidence.record = record;
  await this.attach(
    describeReconciliation({
      // whoever this run actually signed in as — a throwaway per run for the @provision flows
      account: this._freshEmail || CANDIDATE_EMAIL,
      label: 'Payment record',
      subtotal: ev.totals.subtotal,
      discount: ev.totals.discount && ev.totals.discount.amount,
      charged: ev.charged,
      record,
    }),
    'text/plain'
  );
  expect(
    record.problems,
    `the candidate was charged SAR ${ev.charged}, but the billing row / receipt panel does not say so `
    + `— ${record.problems.join(' | ')}`
  ).toEqual([]);
});

Then('the receipt PDF for that payment should state the amount that was charged', async function () {
  const ev = this._chargeEvidence;
  expect(ev, 'no payment was recorded in this scenario, so there is nothing to reconcile').toBeTruthy();
  const record = ev.record;
  expect(
    record,
    'the receipt evidence was never gathered — this step reuses what "the billing record should show '
    + 'the amount that was charged" collected, so that step has to run first'
  ).toBeTruthy();
  if (record.pdf) {
    await this.attach(
      `Receipt PDF (${record.pdf.pages} page(s)) for a charge of SAR ${ev.charged}\n`
      + `Parsed fields: ${JSON.stringify(record.pdf.fields)}\n`
      + `PDF text: ${pdfExcerpt(record.pdf.text, 900)}`,
      'text/plain'
    );
  }
  expect(
    record.pdfProblems,
    `the candidate was charged SAR ${ev.charged}, but the receipt PDF they keep does not say so — `
    + `${record.pdfProblems.join(' | ')}`
  ).toEqual([]);
});

// Currency is its own step because it is its own defect, and because it fires on EVERY receipt
// (M8 finding 3): asserted together with the arithmetic it would make every receipt scenario
// permanently red and hide whether the stated total actually matched the charge. Place it AFTER the
// arithmetic step — Cucumber abandons a scenario at its first failure, so the order decides which
// verdict a red run reports.
Then('the receipt PDF for that payment should price the plan in SAR', async function () {
  const ev = this._chargeEvidence;
  expect(ev, 'no payment was recorded in this scenario, so there is nothing to reconcile').toBeTruthy();
  const record = ev.record;
  expect(
    record,
    'the receipt evidence was never gathered — this step reuses what "the billing record should show '
    + 'the amount that was charged" collected, so that step has to run first'
  ).toBeTruthy();
  expect(
    record.pdfCurrencyProblems,
    `the plan is sold in SAR, but ${record.pdfCurrencyProblems.join(' | ')}`
  ).toEqual([]);
});

// ==================== Grace period (@mocked) ====================

// @mocked — there is no UI path to fail an auto-renewal. The REAL subscription payloads
// are fetched and only the grace-period fields are patched (status=GRACE_PERIOD,
// payment_failed, grace_period_end, retry_count), plus the newest billing row is flipped
// to a FAILED payment. Everything else the tab renders is the account's genuine data.
Given('my auto-renewal payment has failed', async function () {
  await sub(this).stubGracePeriod();
});

Then('a {string} toast should be shown', async function (msg) {
  await expect(this.page.getByText(new RegExp(escapeRegExp(msg), 'i')).first()).toBeVisible({
    timeout: 15000,
  });
});

Then('a payment-failure warning with an {string} CTA should be shown', async function (label) {
  await expect(sub(this).gracePeriodWarning, 'grace-period warning text').toBeVisible({
    timeout: 15000,
  });
  const cta = this.page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first();
  await expect(cta, `"${label}" CTA`).toBeVisible({ timeout: 10000 });
  await expect(cta).toBeEnabled();
});

// The warning must tell the candidate the deadline — assert the grace-period end date the
// stub injected actually appears in the copy (e.g. "…before Aug 5, 2026 to keep…").
Then('the grace-period warning should name the grace-period end date', async function () {
  const s = sub(this);
  const [y, m, d] = s.graceEnd.split('-').map(Number);
  // The app renders "MMM D, YYYY" (e.g. "Aug 5, 2026").
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  const txt = (await s.gracePeriodWarning.innerText()).replace(/\s+/g, ' ').trim();
  const re = new RegExp(`${month}\\s*0?${d},?\\s*${y}`, 'i');
  expect(re.test(txt), `warning "${txt}" should name the grace-period end ${month} ${d}, ${y}`).toBe(true);
});

// The old M8/M9 "known issue" recorded here — a failed payment rendering an EMPTY Status cell
// with its receipt actions still ENABLED — was NOT a product defect. Both halves were the
// suite's own (measured 2026-09-07, scripts/probe-billing-failed-status-label.js):
//   * the empty cell: stubGracePeriod() injected status "FAILED", which is not in the API's
//     enum at all (StatusDcaEnum is PAID/PENDING/DECLINED/CANCELED). The app renders nothing
//     for a value it does not know. With the real token it renders "Declined".
//   * the enabled actions: read off SKELETON rows before the grid had data. Settled, a declined
//     row's View and Download are both disabled, exactly like Pending and Canceled.
// Both problems are still COLLECTED rather than thrown one at a time, so a single run reports
// the label and the actions together instead of stopping at whichever fails first.
Then('the billing history should show a {string} row with disabled receipt actions', async function (status) {
  const s = sub(this);
  // Not `expect(billingGrid).toBeVisible()` — the grid is visible while it is still painting
  // ten blank skeleton rows, and a read taken then reports every row as unlabelled.
  await s.waitForBillingRows();
  const problems = [];

  const actual = await s.billingRowStatus(0);
  if (!new RegExp(escapeRegExp(status), 'i').test(actual)) {
    problems.push(`status cell reads "${actual}" instead of "${status}"`);
  }

  const states = await s.billingRowActionStates(0);
  const enabled = Object.entries(states)
    .filter(([, isEnabled]) => isEnabled)
    .map(([name]) => name);
  if (enabled.length) {
    problems.push(`receipt actions still enabled: ${enabled.join(', ')}`);
  }

  expect(problems, `failed billing row — ${problems.join(' | ')}`).toEqual([]);
});

// ============ Downgrade activation & post-expiry resubscribe (@mocked) ============

// The tab renders dates as "MMM D, YYYY" (e.g. "Aug 26, 2026"). Build a matcher for a
// yyyy-mm-dd date in that rendered form (the day may or may not be zero-padded).
function appDateRegExp(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return new RegExp(`${month}\\s*0?${d},?\\s*${y}`, 'i');
}

// @mocked — TFF-405 AC25-27. The scheduled downgrade activates on a FUTURE cycle-end date,
// which cannot be reached without backend time control, so the real payload is patched into
// the shape the backend returns AFTER activation (see stubDowngradeActivated). This asserts
// the UI contract only: it does NOT verify that the backend performs the switch on time.
Given('my scheduled downgrade to the {string} plan has activated', async function (plan) {
  await sub(this).stubDowngradeActivated({ to: plan });
});

// Scoped to the Current Subscription card — the Billing History grid repeats plan names
// and amounts, so an unscoped match could pass on a past-payment row.
Then('the current plan card should read {string} billed as {string} at {string}', async function (plan, cycle, price) {
  const panel = sub(this).currentPlanPanel;
  await expect(panel, 'Current Subscription card').toBeVisible({ timeout: 15000 });
  for (const [what, value] of [['plan name', plan], ['billing cycle', cycle], ['price', price]]) {
    await expect(
      panel.getByText(new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, 'i')).first(),
      `current plan ${what} "${value}"`
    ).toBeVisible({ timeout: 10000 });
  }
});

// Activation rolls the billing period over to the newly-active tier, so the tab must show
// that tier's next renewal date rather than the old plan's.
Then('the current plan should auto-renew on the new cycle-end date', async function () {
  const s = sub(this);
  const expected = appDateRegExp(s.activatedRenewalDate);
  await expect(s.autoRenewText, '"Auto-renews on" line').toBeVisible({ timeout: 15000 });
  const txt = (await s.autoRenewText.innerText()).replace(/\s+/g, ' ').trim();
  expect(
    expected.test(txt),
    `renewal line "${txt}" should name the new cycle-end date ${s.activatedRenewalDate}`
  ).toBe(true);
});

// Once the change has been applied there is nothing pending, so the tab must stop
// advertising a scheduled change.
Then('no scheduled plan change should be shown', async function () {
  await expect(sub(this).scheduledChangeNotice, 'scheduled-change notice').toBeHidden({
    timeout: 10000,
  });
});

// @mocked — TFF-406 Scenario B. A cancelled plan only expires once its end date passes.
// Rather than time-travel, the terminal state is reproduced: the subscription record is
// gone, so /subscription/current/ 404s and /auth/me/ reports is_subscribed=false (see
// stubExpiredSubscription). Billing history is left untouched and stays genuine.
Given('my cancelled subscription has already expired', async function () {
  await sub(this).stubExpiredSubscription();
});

Then('the expired-subscription panel should be shown', async function () {
  const s = sub(this);
  await expect(s.expiredHeading, 'expired notice').toBeVisible({ timeout: 15000 });
  await expect(s.expiredResubscribeHeading, '"Resubscribe to Continue Learning" heading').toBeVisible();
  await expect(s.expiredProgressSavedText, 'progress-retained copy').toBeVisible();
});

// After expiry the plan is no longer live, so the active-state management CTAs must be gone
// — this is what separates the expired panel from the cancelled-before-expiry one, which
// still shows the Current Subscription block.
Then('no {string} action should be available', async function (label) {
  await expect(
    this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`, 'i') }).first(),
    `"${label}" action`
  ).toBeHidden({ timeout: 10000 });
});

// The crux of Scenario B: resubscribing after expiry must start a NEW subscription — the
// full plan-selection flow — not silently re-enable auto-renewal the way resubscribing
// BEFORE expiry does (that path is covered by the @e2e cancel/resubscribe scenario).
Then('I should be offered the full plan selection rather than a re-enable confirmation', async function () {
  const s = sub(this);
  await expect(this.page).toHaveURL(/\/subscribe(\/)?($|\?)/, { timeout: 20000 });
  await expect(s.resubscribeModal, 'auto-renewal re-enable modal').toBeHidden();
  await expect(s.selectPlanButtons.first(), 'plan cards').toBeVisible({ timeout: 15000 });
  expect(await s.selectPlanButtons.count(), 'selectable plans').toBe(3);
});
