const BasePage = require('./BasePage');

// SubscriptionPage — Page Object for the Candidate Portal subscription module.
//
// Covers four Jira stories:
//   TFF-163  select plan -> invoice -> promo -> PayTabs -> activate
//   TFF-405  change plan (upgrade invoice / downgrade schedule)
//   TFF-406  cancel & resubscribe
//   TFF-416  view subscription details + billing history
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name
// -> semantic HTML -> structural class -> text fallback. The app (React-Aria +
// Tailwind) exposes almost no data-testids on this module today, so most locators
// lean on role/name and stable visible copy. data-testid candidates are still
// listed first where a natural id would live, so the suite auto-upgrades when the
// app team adds them.
//
// Live behaviour reference (dev.talentforge.com.sa, verified 2026-07-22):
//   Routes (origin = BASE_URL without the trailing /login):
//     /subscribe                              -> plan-selection paywall (reachable
//                                                whether or not the user is subscribed)
//     /subscribe/checkout?planId=1|2|3        -> invoice/checkout (1=Monthly, 2=Quarterly,
//                                                3=Yearly); &mode=change for an upgrade
//     /profile?selectedTab=subscription       -> Subscription tab in the profile
//     /payment/result?payment_id=...          -> post-payment success screen
//   PayTabs test gateway (secure.paytabs.sa) runs in Test Mode; the 4242… test card
//   completes a payment.
//   The yearly-upgrade toggle is a React-Aria <input role="switch">; its <input> is
//   pointer-intercepted by the wrapping <label>, so we click the visual track div.
//
//   API (host differs from the app host — talentforge.autilent.com, so all route
//   patterns below are host-agnostic regexes). Discovered live 2026-07-27 via
//   scripts/probe-subscription-api.js:
//     GET  /core/api/v1/subscription/current/   -> drives the Current Subscription panel;
//                                                  404 once no live subscription record
//                                                  exists, which is what renders the
//                                                  "subscription has expired" panel
//     GET  /core/api/v1/auth/me/                -> same shape under .current_subscription
//     GET  /core/api/v1/payments/?page=&page_size= -> drives the Billing History grid
//     GET  /core/api/v1/plans/                  -> the three plan objects (see PLAN_SHAPE)
//     POST /core/api/v1/payments/paytabs/initiate/ -> creates the PayTabs session
//                                                    (the ONLY subscribe/upgrade path)
// Per-tier payload shapes used by stubDowngradeActivated. `plan` holds the GENUINE plan
// objects the app serves from GET /core/api/v1/plans/ (captured live 2026-07-27) rather than
// hand-built ones, and `apiCycle` is the billing_cycle enum the subscription payload really
// carries ("Billed Annually" was observed on the live Yearly subscription). Patching all of
// these together keeps the stubbed payload self-consistent — patching only plan_name/price
// left the tab rendering the OLD tier's billing line, because the cycle copy is derived, not
// echoed. `displayCycle` is the copy the tab renders for that tier.
const PLAN_SHAPE = {
  monthly: {
    plan: { id: 1, name: 'Monthly Plan', price: 155, label: null, description: 'Cancel anytime with no long-term commitment.', annual_price: 1860, discount: 0 },
    apiCycle: 'Billed Monthly',
    paymentCycle: 'monthly',
    displayCycle: 'Billed monthly · 12 payments/year',
    periodDays: 30,
  },
  quarterly: {
    plan: { id: 2, name: 'Quarterly Plan', price: 400, label: 'Most Popular', description: 'Balanced plan with steady payments and 14% savings.', annual_price: 1600, discount: 14 },
    apiCycle: 'Billed Quarterly',
    paymentCycle: 'quarterly',
    displayCycle: 'Billed every 3 months · 4 payments/year',
    periodDays: 91,
  },
  yearly: {
    plan: { id: 3, name: 'Yearly Plan', price: 1500, label: 'Best Value', description: 'Pay once for full-year access at the lowest cost, with 19.4% savings.', annual_price: 1500, discount: 19.4 },
    apiCycle: 'Billed Annually',
    paymentCycle: 'annual',
    displayCycle: 'Billed once a year',
    periodDays: 365,
  },
};

// Add `days` calendar days to a yyyy-mm-dd string, returning yyyy-mm-dd.
function shiftDays(from, days) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

class SubscriptionPage extends BasePage {
  constructor(page) {
    super(page);

    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.plansUrl = `${this.origin}/subscribe`;
    this.subscriptionTabUrl = `${this.origin}/profile?selectedTab=subscription`;
    this.checkoutUrl = (planId, change = false) =>
      `${this.origin}/subscribe/checkout?planId=${planId}${change ? '&mode=change' : ''}`;

    // planId mapping used by the app's checkout route.
    this.planIds = { monthly: 1, quarterly: 2, yearly: 3 };

    // ---- Profile sub-tab navigation ----
    this.subscriptionNavTab = page
      .getByRole('radio', { name: /^subscription$/i })
      .or(page.getByRole('tab', { name: /^subscription$/i }))
      .first();

    // ================= Plan-selection screen (/subscribe) =================
    // Each plan renders as a card (generic) holding: name, "SAR ###", frequency,
    // optional badge, blurb, and a "Select Plan" button. Scope by the card that
    // contains the plan name so the right "Select Plan" button is clicked.
    this.planCards = page.locator('div', { hasText: /Select Plan/i });
    this.selectPlanButtons = page.getByRole('button', { name: /^Select Plan$/i });

    // ================= Invoice / checkout (/subscribe/checkout) =================
    this.backButton = page.getByRole('button', { name: /^back$/i }).first();
    // Invoice heading: "Subscribe to <Plan> Plan" (initial) or "Switch to <Plan> Plan" (change).
    this.invoiceHeading = page
      .getByText(/^(Subscribe|Switch) to .+ Plan$/i)
      .first();

    // Yearly-upgrade toggle (Monthly & Quarterly invoices only).
    this.yearlyToggle = page.locator('input[role="switch"][aria-label="Switch to yearly plan"]').first();
    this.yearlyToggleTrack = page
      .locator('label:has(input[aria-label="Switch to yearly plan"]) div.cursor-pointer.rounded-full')
      .first();
    this.yearlyToggleSaveText = page.getByText(/Save SAR .* with yearly plan|Save SAR/i).first();

    // Invoice totals — matched by their label, value read from the sibling.
    this.subtotalRow = page.getByText(/^Subtotal$/i).first();
    this.totalDueRow = page.getByText(/^Total due today$/i).first();
    this.planCreditLabel = page.getByText(/Credit$/i).first();
    // Discount line shown when a valid promo is applied on the change/upgrade invoice,
    // e.g. "Discount (50% off)".
    this.discountLine = page.getByText(/^discount\b/i).first();

    // Promo code.
    this.addPromoLink = page.getByRole('button', { name: /add promotion code/i }).first();
    this.promoInput = page.getByRole('textbox', { name: /promo code/i }).first();
    this.promoApplyButton = page.getByRole('button', { name: /^apply$/i }).first();
    this.promoRemoveButton = page.getByRole('button', { name: /^remove$/i }).first();
    this.promoError = page.getByText(/invalid or expired promotion code/i).first();

    // Customer information.
    this.firstNameInput = page.getByRole('textbox', { name: /first name/i }).first();
    this.lastNameInput = page.getByRole('textbox', { name: /last name/i }).first();
    this.emailInput = page.getByRole('textbox', { name: /email address/i }).first();
    this.paymentMethodLabel = page.getByText(/^PayTabs$/i).first();
    this.billingAddressInput = page.locator('textarea[placeholder="Enter your address"]').first();
    this.continueButton = page.getByRole('button', { name: /^continue$/i }).first();

    // ================= PayTabs gateway (secure.paytabs.sa) =================
    this.paytabsCardNumber = page.getByRole('textbox', { name: /card number/i }).first();
    this.paytabsExpMonth = page.getByRole('textbox', { name: /expmonth/i }).first();
    this.paytabsExpYear = page.getByRole('textbox', { name: /expyear/i }).first();
    this.paytabsCvv = page.getByRole('textbox', { name: /cvv/i }).first();
    this.paytabsPayNow = page.getByRole('button', { name: /pay now/i }).first();
    // "Cancel" link on the PayTabs page (href .../cancel). Clicking it raises a native
    // confirm ("Are you sure you want to cancel this transaction?") we must accept.
    this.paytabsCancelLink = page.getByRole('link', { name: /^cancel$/i }).first();
    // Gateway-side validation message (e.g. "Card expiry is not valid"). PayTabs renders it
    // as plain text inside the card panel — matched by content, since the sandbox markup
    // carries no stable hook — and it stays put: no redirect, so the app never sees the try.
    this.paytabsFormErrorFor = (msg) => page.getByText(new RegExp(msg, 'i')).first();

    // ================= Success screen (/payment/result) =================
    this.successTitle = page.getByText(/your subscription is active!/i).first();
    this.goToTrackCta = page.getByRole('link', { name: /go to my learning track/i }).first();

    // ================= Subscription tab — states =================
    // Case 1 — never subscribed.
    this.notSubscribedHeading = page.getByText(/you're not subscribed yet/i).first();
    this.subscribeNowButton = page.getByRole('button', { name: /subscribe now/i }).first();

    // Case 2 — active.
    this.currentSubscriptionHeading = page.getByText(/^current subscription$/i).first();
    this.changePlanButton = page.getByRole('button', { name: /^change plan$/i }).first();
    this.cancelPlanButton = page
      .getByRole('button', { name: /^cancel (subscription|plan)$/i })
      .first();
    this.resubscribeButton = page.getByRole('button', { name: /^resubscribe$/i }).first();
    this.autoRenewText = page.getByText(/auto-renews on/i).first();
    this.expiresText = page.getByText(/expires on/i).first();
    // Case 3 (scheduled downgrade): "Changes to <Plan> Plan on <date>".
    this.scheduledChangeNotice = page.getByText(/changes to .+ plan on/i).first();
    // Any current-plan date line — renewal, scheduled change, or expiry. ("Expired on"
    // is the grace-period wording; "Expires on" the cancelled-before-expiry wording.)
    this.anyPlanDate = page
      .getByText(/auto-renews on|changes to .+ plan on|expires? on|expired on/i)
      .first();

    // The Current Subscription card. Plan-name and price assertions MUST be scoped to this,
    // because the Billing History grid below repeats the same plan names and amounts — an
    // unscoped `getByText('SAR 155.00').first()` can match a past-payment row instead.
    // NOTE: the card is a <section class="current-subscription-section"> (verified live), so a
    // `locator('div').filter(...)` approach does NOT select it — it matches the outer wrapper
    // and pulls the billing grid in with it.
    this.currentPlanPanel = page
      .locator('[data-testid="current-subscription"], section.current-subscription-section')
      .first();

    // Case 4/5 — grace period after a failed auto-renewal. Real copy (observed via the
    // stub in stubGracePeriod): "Payment failed. Update your payment method before
    // <date> to keep your track access." plus an "Update Payment Method" CTA replacing
    // the Change Plan / Cancel Plan pair.
    this.gracePeriodWarning = page
      .getByText(/payment failed\.\s*update your payment method before/i)
      .first();
    this.updatePaymentMethodButton = page
      .getByRole('button', { name: /update payment method/i })
      .first();

    // Billing history — scope receipt actions to the grid (the profile header also
    // has a "View" / view-as-visitor button).
    this.billingHistoryHeading = page.getByText(/^billing history$/i).first();
    this.billingGrid = page.getByRole('grid', { name: /billing history/i }).first();
    this.billingRows = this.billingGrid.locator('[role="rowgroup"]').last().locator('[role="row"]');
    this.receiptViewButtons = this.billingGrid.getByRole('button', { name: /^view$/i });
    this.receiptDownloadLinks = this.billingGrid.getByRole('link', { name: /^download$/i });

    // ================= Change Plan modal =================
    this.changePlanModal = page.getByRole('dialog').filter({ hasText: /change plan/i }).first();
    this.changePlanContinue = this.changePlanModal.getByRole('button', { name: /^continue$/i }).first();
    this.changePlanCancel = this.changePlanModal.getByRole('button', { name: /^cancel$/i }).first();
    // Plan option cards inside the modal (each shows a "SAR ###" price).
    this.changePlanOptions = this.changePlanModal.locator('button', { hasText: /SAR/i });

    // ---- Upgrade: "Plan changed successfully!" modal (immediate, after payment) ----
    this.planChangedModal = page.getByRole('dialog').filter({ hasText: /plan changed successfully/i }).first();
    this.planChangedGotIt = this.planChangedModal.getByRole('button', { name: /got it/i }).first();

    // ---- Downgrade: "Confirm plan change" then "Plan change scheduled" modals ----
    this.confirmChangeModal = page.getByRole('dialog').filter({ hasText: /confirm plan change/i }).first();
    this.confirmChangeButton = this.confirmChangeModal.getByRole('button', { name: /^confirm$/i }).first();
    this.scheduledModal = page.getByRole('dialog').filter({ hasText: /plan change scheduled/i }).first();
    this.scheduledGotIt = this.scheduledModal.getByRole('button', { name: /got it/i }).first();

    // ================= Cancel Subscription modal =================
    this.cancelModal = page.getByRole('dialog').filter({ hasText: /cancel your subscription/i }).first();
    this.keepMyPlanButton = this.cancelModal.getByRole('button', { name: /keep my plan/i }).first();
    this.confirmCancelButton = this.cancelModal
      .getByRole('button', { name: /^cancel (subscription|plan)$/i })
      .first();

    // Post-cancellation info text (Case 6).
    this.postCancelInfoText = page
      .getByText(/your plan has been cancelled\. you have access until/i)
      .first();

    // Case 7 — EXPIRED (a cancelled subscription whose end date has passed). Distinct from
    // Case 6: the backend no longer returns a live subscription record, so the tab drops the
    // "Current Subscription" block entirely and renders a dedicated expired panel. Real copy
    // captured via scripts/probe-expired-resubscribe.js.
    this.expiredHeading = page
      .getByText(/your subscription has expired\.\s*renew to regain full access/i)
      .first();
    this.expiredResubscribeHeading = page.getByText(/resubscribe to continue learning/i).first();
    this.expiredProgressSavedText = page
      .getByText(/your track and progress are saved/i)
      .first();

    // ================= Resubscribe modal =================
    // Resubscribing BEFORE expiry re-enables auto-renewal for the same plan (no new
    // payment) — a confirm modal titled "Resubscribe" ("Auto-renewal will resume …").
    this.resubscribeModal = page.getByRole('dialog').filter({ hasText: /resubscribe/i }).first();
    this.confirmResubscribeButton = this.resubscribeModal
      .getByRole('button', { name: /^resubscribe$/i })
      .first();

    // ================= Receipt viewer modal =================
    this.receiptModal = page.getByRole('dialog', { name: /receipt/i }).first();
    this.receiptZoomIn = this.receiptModal.getByRole('button', { name: /zoom in/i }).first();
    this.receiptZoomOut = this.receiptModal.getByRole('button', { name: /zoom out/i }).first();
    this.receiptDownloadButton = this.receiptModal.getByRole('button', { name: /download/i }).first();
    this.receiptLoadError = this.receiptModal.getByText(/failed to load document/i);
    // The viewer's own zoom indicator, e.g. "100%" -> "125%" after one zoom-in.
    this.receiptZoomLevel = this.receiptModal.getByText(/^\d+%$/).first();
    // The rendered PDF page (react-pdf) — its height grows/shrinks with the zoom level.
    this.receiptPage = this.receiptModal.locator('.react-pdf__Page, canvas').first();
  }

  // ---- Route stubs (see ChangePasswordPage.stubServerError for the project pattern) ----
  //
  // NOTE ON MOCKING: none of the states below can be produced through the UI — the sandbox
  // gateway cannot be made unreachable, an auto-renewal cannot be failed, and neither a
  // scheduled downgrade's activation date nor a cancelled plan's expiry date can be reached
  // without time control. Every stub therefore intercepts the app's OWN API calls, and each
  // one re-fetches the GENUINE response and patches only named fields — so every other value
  // the UI renders is the account's real data. These verify what the UI does with a given
  // backend state; they are NOT end-to-end verification that the backend produces it.

  // Re-fetch the genuine response, apply `mutate`, and pass it through. Guarded: a request
  // can still be in flight when the scenario's context is torn down, and an unhandled throw
  // inside a route callback surfaces as a failure in the NEXT scenario.
  async patchJson(route, mutate) {
    try {
      const res = await route.fetch();
      const json = await res.json().catch(() => null);
      if (!json) return await route.fulfill({ response: res });
      await route.fulfill({ response: res, json: mutate(json) });
    } catch {
      // Context gone (or the upstream call failed) — let the request through untouched.
      await route.continue().catch(() => {});
    }
  }

  // Simulate an unreachable payment gateway by failing the session-create call at the
  // network layer. Records attempts so a step can assert nothing was ever created.
  async stubGatewayUnreachable() {
    this.gatewayAttempts = 0;
    this.gatewaySuccesses = 0;
    // Count any session-create that actually reached the server (should stay 0).
    this.page.on('response', (res) => {
      if (/\/payments\/paytabs\/initiate\//.test(res.url()) && res.status() < 400) {
        this.gatewaySuccesses++;
      }
    });
    await this.page.route(/\/payments\/paytabs\/initiate\//, async (route) => {
      this.gatewayAttempts++;
      await route.abort('connectionfailed');
    });
  }

  // Put the account into the post-failed-auto-renewal grace period. Patches the real
  // subscription payloads (status/payment_failed/grace_period_end/retry_count) and flips
  // the newest billing row to a FAILED payment so the billing-history assertions have a
  // failed row to look at.
  // >>> failedStatus MUST BE A MEMBER OF THE API'S OWN ENUM. <<< It defaulted to 'FAILED' until
  // 2026-09-07, and there is no such payment status: the OpenAPI schema's StatusDcaEnum is
  // ["PAID","PENDING","DECLINED","CANCELED"] (labels Paid / Pending / Declined / Canceled), and
  // "FAILED" appears nowhere in the whole 717KB document. The tab renders an empty Status cell
  // for a value it does not know, so the scenario reported "the app has no label for a failed
  // payment" - a defect the app does not have. Measured with the same stub: DECLINED renders
  // "Declined", while FAILED / PAYMENT_FAILED / FAILURE / UNPAID / ERROR / REFUNDED all render
  // nothing (scripts/probe-billing-failed-status-label.js).
  async stubGracePeriod({ graceEnd = '2026-08-05', failedStatus = 'DECLINED' } = {}) {
    this.graceEnd = graceEnd;
    const patch = (s) => {
      if (!s) return s;
      s.status = 'GRACE_PERIOD';
      s.payment_failed = true;
      s.grace_period_end = graceEnd;
      s.retry_count = 1;
      s.max_retries = 3;
      return s;
    };
    await this.page.route(/\/api\/v\d\/subscription\/current\/?(\?|$)/, (route) =>
      this.patchJson(route, (json) => patch(json))
    );
    await this.page.route(/\/api\/v\d\/auth\/me\/?(\?|$)/, (route) =>
      this.patchJson(route, (json) => {
        if (json.current_subscription) patch(json.current_subscription);
        return json;
      })
    );
    // Billing-history list only — the pathname test keeps this off
    // /payments/paytabs/initiate/.
    await this.page.route(/\/api\/v\d\/payments\/(\?|$)/, (route) =>
      this.patchJson(route, (json) => {
        if (Array.isArray(json.results) && json.results.length) {
          json.results[0].status = failedStatus;
          json.results[0].failure_reason = 'Card declined by issuer';
          json.results[0].paid_at = null;
          json.results[0].receipt_document = null;
        }
        return json;
      })
    );
  }

  // TFF-406 Scenario B — resubscribe AFTER expiry. A cancelled plan only expires when its
  // end date passes, which needs time control, so the terminal state is reproduced instead:
  // once the subscription record is gone the backend answers /subscription/current/ with 404
  // and reports is_subscribed=false on /auth/me/ (that 404 is exactly what drives the app's
  // expired panel — verified via scripts/probe-expired-resubscribe.js). Billing history is
  // NOT touched, so the past-payments grid stays genuine.
  async stubExpiredSubscription() {
    await this.page.route(/\/api\/v\d\/subscription\/current\/?(\?|$)/, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not found.' }),
      })
    );
    await this.page.route(/\/api\/v\d\/auth\/me\/?(\?|$)/, (route) =>
      this.patchJson(route, (json) => {
        json.is_subscribed = false;
        json.current_subscription = null;
        // The candidate HAS subscribed before — this is what separates the expired state
        // from a never-subscribed one.
        json.was_previously_subscribed = true;
        return json;
      })
    );
  }

  // TFF-405 AC25-27 — a scheduled downgrade ACTIVATES on the cycle-end date. The activation
  // itself is a backend transition on a future date, so this patches the real payload into
  // the shape the backend returns AFTER activation: the lower tier is now current, the
  // scheduled-change marker is cleared, and the cycle has rolled over to that tier's period.
  // What this verifies is the UI contract — that the tab then presents the new plan, its
  // price/cycle copy and the new renewal date, and no longer advertises a pending change.
  async stubDowngradeActivated({ to = 'Monthly', today = new Date().toISOString().slice(0, 10) } = {}) {
    const shape = PLAN_SHAPE[String(to).toLowerCase()];
    if (!shape) throw new Error(`stubDowngradeActivated: unknown plan "${to}"`);
    this.activatedPlan = shape.plan.name;
    this.activatedCycleCopy = shape.displayCycle;
    // The activated tier's own billing period starts at activation.
    this.activatedRenewalDate = shiftDays(today, shape.periodDays);

    const patch = (s) => {
      if (!s) return s;
      s.status = 'ACTIVE';
      s.plan_name = shape.plan.name;
      s.plan_price = shape.plan.price;
      s.plan_annual_price = shape.plan.annual_price;
      s.billing_cycle = shape.apiCycle;
      // Cleared: the pending change has been applied, so nothing is scheduled any more.
      s.scheduled_billing_cycle = '';
      s.cancel_at_period_end = false;
      s.cancelled_at = null;
      s.payment_failed = false;
      s.grace_period_end = null;
      s.subscription_start_date = today;
      s.renewal_date = this.activatedRenewalDate;
      if (s.payment) {
        s.payment.plan = { ...shape.plan };
        s.payment.billing_cycle = shape.paymentCycle;
        s.payment.description = `${shape.plan.name} subscription (${shape.paymentCycle})`;
      }
      return s;
    };

    await this.page.route(/\/api\/v\d\/subscription\/current\/?(\?|$)/, (route) =>
      this.patchJson(route, (json) => patch(json))
    );
    await this.page.route(/\/api\/v\d\/auth\/me\/?(\?|$)/, (route) =>
      this.patchJson(route, (json) => {
        if (json.current_subscription) patch(json.current_subscription);
        return json;
      })
    );
  }

  // ---- Navigation ----
  async gotoPlans() {
    await super.navigate(this.plansUrl);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.selectPlanButtons.first().waitFor({ state: 'visible', timeout: 60000 });
  }

  async gotoCheckout(plan, change = false) {
    const id = this.planIds[String(plan).toLowerCase()] || plan;
    await super.navigate(this.checkoutUrl(id, change));
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.continueButton.waitFor({ state: 'visible', timeout: 60000 });
  }

  async gotoSubscriptionTab() {
    await super.navigate(this.subscriptionTabUrl);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    // One of the four terminal panels renders: "Current Subscription" (active / cancelled /
    // grace), the never-subscribed paywall, or the expired panel. The expired wording MUST be
    // listed — it renders no "Current Subscription" block, so omitting it made this wait run
    // its full timeout on every expired-state scenario.
    // The timeout is deliberately BELOW the 60s step timeout: this wait is best-effort
    // (the assertions that follow do the real waiting), so it must never be able to consume
    // the whole step budget and turn a would-be assertion failure into an opaque timeout.
    await this.page
      .getByText(/current subscription|you're not subscribed yet|your subscription has expired/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});
  }

  // The plan card container for a given plan name (used to scope its Select Plan button).
  planCard(planName) {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByText(new RegExp(`^${planName} Plan$`, 'i')) })
      .filter({ has: this.page.getByRole('button', { name: /^Select Plan$/i }) })
      .last();
  }

  async selectPlan(planName) {
    await this.planCard(planName).getByRole('button', { name: /^Select Plan$/i }).click();
    await this.page.waitForURL(/\/subscribe\/checkout/, { timeout: 30000 });
  }

  // ---- Invoice helpers ----
  // Read the numeric value shown next to a label ("Subtotal" / "Total due today").
  async amountFor(label) {
    const row = this.page.getByText(new RegExp(`^${label}$`, 'i')).first();
    // The value is the adjacent sibling in the same flex row.
    const value = row.locator('xpath=following-sibling::*[1]');
    const txt = (await value.textContent().catch(() => '')) || '';
    return txt.trim();
  }

  // Read the promo discount row exactly as the invoice RENDERS it — the label text
  // ("Discount (20% off)") as well as the amount ("- SAR 31.0").
  //
  // This exists because every discount assertion in the suite used to derive the discount
  // arithmetically, as `subtotal - total`. That can only ever see a discount whose AMOUNT is
  // wrong; it is structurally blind to one that is calculated correctly and DESCRIBED
  // incorrectly, which is exactly the state a Fixed Amount promo renders in (a flat SAR 50 is
  // labelled "Discount (50% off)" — live-captured 2026-07-31,
  // scripts/probe-promo-invoice-math.js). The label is what the candidate reads before
  // deciding to pay, so it is part of the calculation being right, not decoration.
  async readDiscountLine() {
    if (!(await this.discountLine.isVisible().catch(() => false))) {
      return { present: false, label: null, amount: null, raw: null };
    }
    const label = ((await this.discountLine.textContent().catch(() => '')) || '').trim();
    const raw = ((await this.discountLine
      .locator('xpath=following-sibling::*[1]')
      .textContent()
      .catch(() => '')) || '').trim();
    const m = raw.match(/-?\s*[\d.,]+/);
    // Rendered as "- SAR 31.0"; carried out as a positive magnitude, since every caller
    // reasons about "how much was taken off" rather than about the sign convention.
    const amount = m ? Math.abs(parseFloat(m[0].replace(/[\s,]/g, ''))) : null;
    return { present: true, label, amount, raw };
  }

  // The whole totals block in one read: subtotal, the promo discount row, the pro-rata plan
  // credit row (change/upgrade invoices only) and the total. Every figure is optional — a
  // bare invoice has no discount and no credit — so a caller can reconcile whichever lines
  // this particular invoice renders.
  async readInvoiceTotals() {
    const parse = (s) => {
      const m = String(s || '').match(/-?\s*[\d.,]+/);
      return m ? parseFloat(m[0].replace(/[\s,]/g, '')) : null;
    };
    const creditVisible = await this.planCreditLabel.isVisible().catch(() => false);
    return {
      subtotal: parse(await this.amountFor('Subtotal')),
      total: parse(await this.amountFor('Total due today')),
      discount: await this.readDiscountLine(),
      credit: creditVisible
        ? Math.abs(parse(
          (await this.planCreditLabel.locator('xpath=following-sibling::*[1]').textContent().catch(() => '')) || ''
        ) || 0)
        : null,
    };
  }

  async isYearlyToggleOn() {
    return this.yearlyToggle.isChecked().catch(async () => {
      return (await this.yearlyToggle.getAttribute('aria-checked')) === 'true';
    });
  }

  // Toggle the yearly switch by clicking its visual track (the <input> is intercepted).
  async setYearlyToggle(on) {
    const current = await this.isYearlyToggleOn();
    if (current !== on) {
      await this.yearlyToggleTrack.click();
      await this.page.waitForTimeout(300);
    }
  }

  async openPromo() {
    if (await this.addPromoLink.isVisible().catch(() => false)) {
      await this.addPromoLink.click();
      await this.promoInput.waitFor({ state: 'visible', timeout: 10000 });
    }
  }

  async applyPromo(code) {
    await this.openPromo();
    await this.promoInput.fill(code);
    await this.promoApplyButton.click();
  }

  // Apply a promo and wait for the invoice's preview recalculation to come back.
  // Returns { rejected, status }. This exists because the app renders the applied-promo
  // chip + Remove with NO error even when the backend rejects the code (422), so the
  // invoice looks discounted while the total is unchanged — a caller that goes on to PAY
  // has to be able to tell the two apart. Verified live 2026-07-27, see
  // scripts/probe-upgrade-promo.js. `applyPromo` above stays lenient on purpose: the
  // @positive "promo code should be accepted" steps assert the UI-level behaviour only.
  //
  // BOTH preview endpoints are awaited. The invoice posts to /subscription/change/preview/
  // only on the CHANGE/upgrade flow; an initial subscribe posts to
  // /payments/paytabs/preview/ (both captured live 2026-07-30). While this matched the change
  // endpoint alone, every caller on a first-subscribe invoice — which is every fresh-candidate
  // redemption, including the usage-limit scenario — got `{ rejected: false, status: null }`
  // whatever the server actually answered. The guard those callers rely on to abort BEFORE
  // paying was therefore inert on the one flow that spends money: a refused promo would have
  // gone on to pay full price, and the failure would have surfaced as "the usage counter did
  // not move" rather than "the promo was rejected".
  async applyPromoAwaitingPreview(code, { timeout = 15000 } = {}) {
    await this.openPromo();
    await this.promoInput.fill(code);
    const preview = this.page
      .waitForResponse(
        (r) => /\/(payments\/paytabs|subscription\/change)\/preview\/?$/.test(new URL(r.url()).pathname)
          && r.request().method() === 'POST',
        { timeout }
      )
      .catch(() => null);
    await this.promoApplyButton.click();
    const res = await preview;
    if (!res) return { rejected: false, status: null, body: '' };
    // Carry the response body out too — a bare 422 cannot distinguish "this promo is not
    // valid for the target plan" from an app-side defect, and the caller reports it.
    const body = res.ok() ? '' : ((await res.text().catch(() => '')) || '');
    return { rejected: !res.ok(), status: res.status(), body };
  }

  // Click Continue on the invoice and land on the PayTabs gateway. If the plan-change
  // call fails, report THAT rather than letting the run die 30s later inside
  // payWithTestCard() on "card number not visible", which says nothing about the cause.
  async continueToGateway({ timeout = 60000 } = {}) {
    const changeCall = this.page
      .waitForResponse(
        (r) => /\/subscription\/change\/?$/.test(new URL(r.url()).pathname)
          && r.request().method() === 'POST',
        { timeout }
      )
      .catch(() => null);
    await this.continueButton.click();
    const res = await changeCall;
    if (res && !res.ok()) {
      const body = (await res.text().catch(() => '')) || '';
      throw new Error(
        `Plan change rejected by the API: POST ${new URL(res.url()).pathname} -> ${res.status()}. `
        + 'The app stayed on the invoice, showed no error toast, and never redirected to the '
        + `payment gateway. Response: ${body.slice(0, 300)}`
      );
    }
    await this.page.waitForURL(/paytabs\./i, { timeout });
  }

  async fillCustomer({ first, last, email } = {}) {
    if (first !== undefined) await this.firstNameInput.fill(first);
    if (last !== undefined) await this.lastNameInput.fill(last);
    if (email !== undefined) await this.emailInput.fill(email);
  }

  // ---- PayTabs ----
  // Enter the card into PayTabs' hosted form and PROVE each field holds what we
  // meant. The gateway's inputs are JS-masked (card number is re-formatted into
  // "1234 1234 1234 1234" groups on every keystroke) and the mask silently drops
  // characters typed while it is still initialising — a run failed live 2026-07-27
  // with "2424 2424 2424 242" in the field: the leading "42" was eaten, so a
  // 15-digit card was submitted. PayTabs answers an invalid card by re-rendering
  // its own empty form with NO error, so the browser sits on the gateway until the
  // redirect wait times out 150s later — a real defect that reads like a hang.
  // Hence: read the value back, and clear + retype if it does not match.
  async typeCardDetails({ number, month, year, cvv, timeout = 30000, attempts = 3 } = {}) {
    await this.paytabsCardNumber.waitFor({ state: 'visible', timeout });
    const digitsOf = (s) => String(s).replace(/\D/g, '');
    const enter = async (locator, value) => {
      await locator.click();
      await locator.press('Control+A');
      await locator.press('Backspace');
      await locator.pressSequentially(value, { delay: 80 });
      return digitsOf(await locator.inputValue().catch(() => ''));
    };
    let got;
    for (let i = 1; i <= attempts; i++) {
      got = {
        number: await enter(this.paytabsCardNumber, number),
        month: await enter(this.paytabsExpMonth, month),
        year: await enter(this.paytabsExpYear, year),
        cvv: await enter(this.paytabsCvv, cvv),
      };
      if (got.number === number && got.month === month && got.year === year && got.cvv === cvv) return;
    }
    throw new Error(
      `PayTabs card fields kept mangling the typed value after ${attempts} attempts `
      + `(the masked inputs dropped characters): ${JSON.stringify(got)}`
    );
  }

  // Enter + submit the PayTabs test card. Resolves once the app redirects back.
  async payWithTestCard({ number = '4242424242424242', month = '12', year = '27', cvv = '123' } = {}) {
    await this.typeCardDetails({ number, month, year, cvv, timeout: 30000 });
    await this.paytabsPayNow.click();
    // Resolve on the client-side route commit — the SPA keeps connections open, so
    // waiting for a full 'load' event intermittently stalls. The PayTabs sandbox
    // redirect back is also occasionally slow (cold session), so allow generous time
    // and, as a fallback, wait to simply leave the PayTabs domain.
    try {
      await this.page.waitForURL(/\/payment\/result/, { timeout: 150000, waitUntil: 'commit' });
    } catch (e) {
      if (/paytabs\./i.test(this.page.url())) {
        // Still on the gateway: say WHY. A blank card field means PayTabs re-rendered
        // its form instead of processing (the submitted payload never registered);
        // any other text is the gateway's own message.
        const card = await this.paytabsCardNumber.inputValue().catch(() => '?');
        const text = (await this.page.evaluate(() => document.body.innerText).catch(() => '')) || '';
        throw new Error(
          `PayTabs never redirected back (${this.page.url()}). Card field after submit: `
          + `"${card}". Gateway page text: ${text.replace(/\s+/g, ' ').slice(0, 400)}`
        );
      }
      // Left PayTabs but didn't match /payment/result yet — let the app settle.
      await this.page.waitForURL(/talentforge\.com\.sa/i, { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
    }
  }

  // Submit a card that the GATEWAY itself must refuse — default 12/25, i.e. an expiry in
  // the past. PayTabs validates before it processes anything: it prints "Card expiry is
  // not valid" in the card panel and stays on /payment/page/<id>/start, so unlike
  // payWithTestCard this must NOT wait for a redirect (verified live 2026-07-27).
  // Non-destructive — no charge, no subscription.
  async submitExpiredCard({ number = '4242424242424242', month = '12', year = '25', cvv = '123' } = {}) {
    await this.typeCardDetails({ number, month, year, cvv, timeout: 30000 });
    await this.paytabsPayNow.click();
  }

  // ---- Minting non-Paid billing rows (used by subscriptionProvision.provisionNonPaidRow) ----
  //
  // POST /payments/paytabs/initiate/ creates the billing row UP FRONT as PENDING and answers
  // 201 { payment_id, status: 'PENDING', amount, currency, redirect_url }. What the row ends up
  // as is decided purely by how the gateway session ends — verified live 2026-07-27 on a fresh
  // account (scripts/probe-provision-nonpaid-rows.js):
  //     abandon the session (navigate away) -> row STAYS 'PENDING'
  //     Cancel on the PayTabs page          -> app hops /payment/result -> row becomes 'CANCELED'
  // On an ALREADY-SUBSCRIBED account initiate answers 422 ["You already have an active
  // subscription. Use upgrade or change plan instead."] and creates no row at all — which is
  // why minting one requires a never-subscribed candidate.
  // No card details are ever entered by these helpers, so nothing is charged.
  async initiatePayTabsSession(plan = 'monthly') {
    await this.gotoCheckout(plan);
    // The method test is essential: the CORS PREFLIGHT (OPTIONS) hits the same URL and answers
    // first, so matching on URL alone resolves with a bodyless response and reads payment_id as
    // undefined (seen live 2026-07-27 — only the first call, since the preflight is then cached).
    const call = this.page
      .waitForResponse(
        (r) => /\/payments\/paytabs\/initiate\//.test(r.url()) && r.request().method() === 'POST',
        { timeout: 90000 }
      )
      .catch(() => null);
    await this.continueButton.click();
    const res = await call;
    if (!res) {
      throw new Error('invoice Continue never triggered POST /payments/paytabs/initiate/');
    }
    if (!res.ok()) {
      const body = (await res.text().catch(() => '')) || '';
      throw new Error(
        `POST /payments/paytabs/initiate/ -> ${res.status()} ${body.slice(0, 200)}\n`
        + 'A non-Paid billing row can only be minted on a never-subscribed account.'
      );
    }
    const body = await res.json().catch(() => ({}));
    await this.page.waitForURL(/paytabs\./i, { timeout: 90000 });
    return body;
  }

  // Walk away from the gateway session -> the row stays PENDING.
  async abandonPayTabsSession() {
    await this.gotoSubscriptionTab();
  }

  // End the gateway session via PayTabs' own "Cancel" link -> the row flips to CANCELED. The
  // link raises a native confirm that must be accepted; the app then routes through
  // /payment/result?payment_id=<id>. Unlike cancelPaymentOnPayTabs this enters no card details
  // — the cancel needs none, so the session is aborted with strictly less side effect.
  //
  // It is the gateway's return callback — POST /payments/paytabs/return/ (303) — that actually
  // flips the row from PENDING to CANCELED, NOT the initiate. Waiting only on the URL is not
  // enough: `commit` fires while that POST is still in flight, and navigating away aborts it,
  // which leaves the SPA wedged (the next page load fired no API calls at all) and the row
  // unfinalised. Diagnosed live 2026-07-27 via scripts/probe-cancel-aftermath.js, so wait for
  // the callback itself.
  async cancelPayTabsSession() {
    const returnCall = this.page
      .waitForResponse((r) => /\/payments\/paytabs\/return\//.test(r.url()), { timeout: 90000 })
      .catch(() => null);
    this.page.once('dialog', (d) => d.accept().catch(() => {}));
    await this.paytabsCancelLink.click();
    await returnCall;
    await this.page
      .waitForURL(/\/payment\/result|\/subscribe\/checkout/, { timeout: 90000, waitUntil: 'domcontentloaded' })
      .catch(() => {});
  }

  // Reach PayTabs from the invoice (if not already there), fill the test card, then
  // ABORT via the "Cancel" link and accept the confirm dialog. The app routes through
  // /payment/result and back to the invoice with a "Payment unsuccessful" error toast.
  // Non-destructive — no charge is made, so the current plan is unchanged.
  async cancelPaymentOnPayTabs({ number = '4242424242424242', month = '12', year = '27', cvv = '123' } = {}) {
    if (!/paytabs\./i.test(this.page.url())) {
      await this.continueButton.click().catch(() => {});
    }
    await this.typeCardDetails({ number, month, year, cvv, timeout: 60000 });
    // Accept the "Are you sure…" confirm the Cancel link raises.
    this.page.once('dialog', (d) => d.accept().catch(() => {}));
    await this.paytabsCancelLink.click();
    // Land back on the invoice (via the transient /payment/result hop).
    await this.page
      .waitForURL(/\/subscribe\/checkout/, { timeout: 60000, waitUntil: 'commit' })
      .catch(() => {});
  }

  // ---- Subscription tab state detection ----
  async currentState() {
    if (await this.notSubscribedHeading.isVisible().catch(() => false)) return 'never';
    // 'expired' MUST be tested before 'cancelled': the expired panel also renders a
    // "Resubscribe" button, but unlike the cancelled-before-expiry state it has no
    // "Current Subscription" block behind it.
    if (await this.expiredHeading.isVisible().catch(() => false)) return 'expired';
    if (await this.resubscribeButton.isVisible().catch(() => false)) return 'cancelled';
    if (await this.currentSubscriptionHeading.isVisible().catch(() => false)) return 'active';
    return 'unknown';
  }

  // Which plan the account is on right now — 'Monthly' | 'Quarterly' | 'Yearly', or null when
  // the tab is in a state with no plan (never-subscribed / expired). Read from the Current
  // Subscription card ONLY: the Billing History grid below repeats the same plan names, so an
  // unscoped read can return the plan of a past payment instead of the live one.
  async currentPlanName() {
    const text = await this.currentPlanPanel.innerText().catch(() => '');
    const m = text.match(/\b(Monthly|Quarterly|Yearly)\s+Plan\b/i);
    if (!m) return null;
    return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }

  // Tier order, low -> high. An UPGRADE (immediate pro-rata invoice) is only offered upward;
  // choosing a lower tier is a downgrade, which takes the "Confirm plan change" path instead
  // and produces no invoice at all. Yearly is the top tier, so an account already on Yearly
  // has no upgrade available and the Change Plan modal offers Monthly/Quarterly only.
  static get PLAN_TIERS() {
    return ['Monthly', 'Quarterly', 'Yearly'];
  }

  planTier(planName) {
    return SubscriptionPage.PLAN_TIERS.findIndex(
      (p) => p.toLowerCase() === String(planName).trim().toLowerCase()
    );
  }

  async openChangePlan() {
    await this.changePlanButton.click();
    await this.changePlanModal.waitFor({ state: 'visible', timeout: 10000 });
    // Plan option cards (each shows a "SAR ###" price) render a beat after the modal.
    await this.changePlanModal
      .locator('button', { hasText: /SAR/i })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async openCancelModal() {
    await this.cancelPlanButton.click();
    await this.cancelModal.waitFor({ state: 'visible', timeout: 10000 });
  }

  // The plan-select buttons inside the Change Plan modal (the two non-current plans).
  changePlanOption(planName) {
    return this.changePlanModal
      .locator('button', { hasText: new RegExp(`${planName} Plan`, 'i') })
      .first();
  }

  // Is a Change-Plan option visually selected? (brand-700 border highlight)
  async isChangeOptionSelected(planName) {
    const cls = (await this.changePlanOption(planName).getAttribute('class')) || '';
    return /brand-700/.test(cls);
  }

  // Is the FIRST offered plan option selected? (plan-agnostic — works regardless of
  // which tier the account is currently on).
  async isFirstChangeOptionSelected() {
    const cls = (await this.changePlanOptions.first().getAttribute('class')) || '';
    return /brand-700/.test(cls);
  }

  // Choose a plan in the Change Plan modal and Continue. For an UPGRADE this navigates
  // to the change/upgrade invoice; for a DOWNGRADE it opens the "Confirm plan change"
  // modal instead (no navigation) — callers decide which to await.
  async chooseChangePlan(planName) {
    await this.changePlanOption(planName).click();
    await this.changePlanContinue.click();
  }

  // Full REAL upgrade via the modal: choose a higher-tier plan, optionally apply a
  // promo, pay on PayTabs, and wait for the "Plan changed successfully!" modal.
  async upgradeWithPayment(targetPlan, { promo } = {}) {
    await this.openChangePlan();
    await this.chooseChangePlan(targetPlan);
    await this.page.waitForURL(/\/subscribe\/checkout/, { timeout: 30000 });
    if (promo) {
      const { rejected, status, body } = await this.applyPromoAwaitingPreview(promo);
      if (rejected) {
        throw new Error(
          `Promo "${promo}" was rejected by the API `
          + `(POST /subscription/change/preview/ -> ${status}), but the invoice still renders it `
          + 'as applied with no error and the total is unchanged. Continuing to pay with it makes '
          + `POST /subscription/change/ return 500 and the flow dead-ends on the invoice. `
          + `Response: ${String(body).slice(0, 300)}`
        );
      }
    }
    // Read the totals BEFORE leaving for the gateway and watch what the payment call carries.
    // The success modal does not restate the amount, so this is the only moment at which "what
    // the candidate agreed to pay" can be captured — and without it the upgrade-with-promo
    // scenario could only assert that a success modal appeared, which a full-price charge
    // satisfies just as well. Returned rather than asserted here: the caller decides, and a
    // mismatch must not abandon the scenario before its other assertions run.
    const totals = await this.readInvoiceTotals();
    const collector = this.watchGatewayCalls();
    await this.continueToGateway();
    const pageRead = await this.readGatewayAmount().catch(() => ({ amount: null, currencyAmounts: [], allAmounts: [], text: '', painted: false }));
    await this.payWithTestCard();
    await this.planChangedModal.waitFor({ state: 'visible', timeout: 30000 });
    collector.stop();
    return { totals, charged: totals.total, collector, pageRead };
  }

  // Full REAL FIRST-TIME subscribe: open the plan's invoice, optionally apply a promo, pay on
  // PayTabs, and wait for "Your Subscription is Active!". Returns the same evidence shape as
  // upgradeWithPayment, so the reconciliation steps work on either flow unchanged.
  //
  // NOT a variant of upgradeWithPayment — a genuinely different code path. That one drives the
  // Change Plan modal, which exists only on an account that already holds a subscription, and its
  // invoice posts to /subscription/change/preview/ while this one posts to
  // /payments/paytabs/preview/ (both captured live 2026-07-30).
  //
  // WHY IT IS WORTH ITS OWN METHOD. A first subscribe carries no pro-rata plan credit, so its
  // invoice is exactly `subtotal − discount` with nothing else in it. That is the only configuration
  // in which a receipt's arithmetic can be checked against a DISCOUNT without the credit
  // confounding it — which is what separates the two candidate causes of M8
  // (features/Candidate_Portal/SUBSCRIPTION_JIRA_VS_APP.md).
  async subscribeWithPayment(plan, { promo } = {}) {
    await this.gotoCheckout(plan);
    if (promo) {
      const { rejected, status, body } = await this.applyPromoAwaitingPreview(promo);
      if (rejected) {
        throw new Error(
          `Promo "${promo}" was rejected by the API (subscribe-invoice preview -> ${status}), so `
          + 'nothing was paid. Redemption is ownership-scoped as of 2026-07-31: the candidate has to '
          + 'have signed up under the agent that owns this code. Aborting here rather than paying is '
          + 'deliberate — continuing would charge FULL PRICE and still reach the success modal. '
          + `Response: ${String(body).slice(0, 300)}`
        );
      }
    }
    // Read the totals BEFORE leaving for the gateway: the success modal does not restate the
    // amount, so this is the only moment at which "what the candidate agreed to pay" is observable.
    const totals = await this.readInvoiceTotals();
    const collector = this.watchGatewayCalls();
    // The subscribe flow posts to /payments/paytabs/initiate/, NOT /subscription/change/ — so a
    // refusal has to be caught here. continueToGateway() watches the change endpoint, which on this
    // flow simply never fires, and the run would then die 150s later inside payWithTestCard() on
    // "card number not visible", saying nothing about the cause.
    const initiate = this.page
      .waitForResponse(
        (r) => /\/payments\/paytabs\/initiate\/?$/.test(new URL(r.url()).pathname)
          && r.request().method() === 'POST',
        { timeout: 60000 }
      )
      .catch(() => null);
    await this.continueButton.click();
    const res = await initiate;
    if (res && !res.ok()) {
      throw new Error(
        `The subscribe call was refused (POST /payments/paytabs/initiate/ -> ${res.status()}): `
        + `${String(await res.text().catch(() => '')).slice(0, 300)}. The candidate never reached the `
        + 'gateway, so nothing was charged.'
      );
    }
    await this.page.waitForURL(/paytabs\./i, { timeout: 60000 });
    // Readable only while the browser is ON the gateway, i.e. before the card is submitted.
    const pageRead = await this.readGatewayAmount().catch(() => ({
      amount: null, currencyAmounts: [], allAmounts: [], text: '', painted: false,
    }));
    await this.payWithTestCard();
    await this.successTitle.waitFor({ state: 'visible', timeout: 60000 });
    collector.stop();
    return { totals, charged: totals.total, collector, pageRead };
  }

  // REAL downgrade via the modal: choose a lower-tier plan, confirm (no payment), and
  // wait for the "Plan change scheduled" modal.
  async scheduleDowngrade(targetPlan) {
    await this.openChangePlan();
    await this.chooseChangePlan(targetPlan);
    await this.confirmChangeModal.waitFor({ state: 'visible', timeout: 15000 });
    await this.confirmChangeButton.click();
    await this.scheduledModal.waitFor({ state: 'visible', timeout: 15000 });
  }

  async openFirstReceipt() {
    await this.receiptViewButtons.first().click();
    await this.receiptModal.waitFor({ state: 'visible', timeout: 10000 });
  }

  // The first Billing-History row whose status is "Paid".
  firstPaidRow() {
    return this.billingGrid
      .locator('[role="row"]:has([role="rowheader"])', { hasText: 'Paid' })
      .first();
  }

  // { plan, amount, date } read from the first Paid row's cells.
  async firstPaidRowData() {
    const row = this.firstPaidRow();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const date = (await row.locator('[role="rowheader"]').first().innerText()).trim();
    const cells = await row.locator('[role="gridcell"]').allInnerTexts();
    return { date, plan: (cells[0] || '').trim(), amount: (cells[1] || '').trim(), status: (cells[2] || '').trim() };
  }

  // Open the receipt viewer for the first Paid row (its View action is enabled).
  async openFirstPaidReceipt() {
    await this.firstPaidRow().getByRole('button', { name: /^view$/i }).first().click();
    await this.receiptModal.waitFor({ state: 'visible', timeout: 10000 });
  }

  // Value shown under a label in the receipt "Receipt information" panel.
  async receiptPanelValue(label) {
    const el = this.receiptModal
      .getByText(new RegExp(`^${label}$`, 'i'))
      .first()
      .locator('xpath=following-sibling::*[1]');
    return (await el.innerText().catch(() => '')).trim();
  }

  // Status text of a billing row by index ("Paid" / "Pending" / "Canceled" / "").
  // >>> THE GRID PAINTS TEN EMPTY SKELETON ROWS BEFORE ITS DATA ARRIVES. <<< They carry
  // role="row" and the grid is already visible, so `expect(billingGrid).toBeVisible()` and a
  // row count are BOTH satisfied while every cell is still blank - and a status read taken then
  // returns "" for a perfectly good Paid row. Measured 2026-09-07: straight after the grid
  // became visible, row 0 read cell "" on a row whose badge already said "Paid".
  //
  // Settle on the DATE cell, which every row has whatever its status. Waiting on the status
  // badge would hang for exactly the case these scenarios exist to inspect - a row the app
  // renders no badge for.
  async waitForBillingRows(timeout = 25000) {
    await this.billingGrid.waitFor({ state: 'visible', timeout });
    await this.page.waitForFunction(() => {
      const groups = document.querySelectorAll('[role="grid"] [role="rowgroup"]');
      const body = groups[groups.length - 1];
      const first = body && body.querySelector('[role="row"]');
      const date = first && first.querySelector('[data-column-index="0"]');
      return !!(date && date.textContent.trim().length);
    }, null, { timeout }).catch(() => {});
  }

  async billingRowStatus(index = 0) {
    const cells = await this.billingRows.nth(index).locator('[role="gridcell"]').allInnerTexts();
    return (cells[2] || '').replace(/\s+/g, ' ').trim();
  }

  // Enabled/disabled state of a billing row's receipt actions, as a label->boolean map.
  async billingRowActionStates(index = 0) {
    const row = this.billingRows.nth(index);
    const actions = row.locator('button, a');
    const n = await actions.count();
    const out = {};
    for (let i = 0; i < n; i++) {
      const a = actions.nth(i);
      const name = ((await a.getAttribute('aria-label')) || (await a.innerText().catch(() => '')) || `action${i}`).trim();
      out[name || `action${i}`] = await a.isEnabled().catch(() => null);
    }
    return out;
  }

  // The receipt viewer's current zoom level as a number (100 for "100%").
  async receiptZoomPercent() {
    const txt = (await this.receiptZoomLevel.innerText().catch(() => '')) || '';
    const m = txt.match(/(\d+)\s*%/);
    return m ? Number(m[1]) : NaN;
  }

  // Click the viewer's Download control and return the downloaded file's bytes.
  async downloadReceiptFromViewer() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 30000 }),
      this.receiptDownloadButton.click(),
    ]);
    const fs = require('fs');
    const path = await download.path();
    return { name: download.suggestedFilename(), bytes: path ? fs.readFileSync(path) : Buffer.alloc(0) };
  }

  // Rows whose status is NOT "Paid" (e.g. "Pending" / "Payment Failed").
  nonPaidRows() {
    return this.billingGrid
      .locator('[role="row"]:has([role="rowheader"])')
      .filter({ hasNot: this.page.getByRole('gridcell', { name: /^Paid$/i }) });
  }

  // Open the Subscription tab and wait for the Billing History grid to be POPULATED.
  //
  // gotoSubscriptionTab resolves as soon as one of the terminal panels renders, which happens
  // BEFORE the billing grid has its rows — and Locator.count() does not auto-wait, so a count()
  // straight afterwards reads 0 and any "does a row with status X exist?" check silently races
  // the network. (That race made the self-healing step mint a row on an account that already
  // had two.) Waiting on the app's own GET /payments/ removes it.
  //
  // A never-subscribed account with no payments at all renders the paywall and no grid, so the
  // row wait is best-effort — callers read the count afterwards and decide.
  async gotoSubscriptionTabWithBilling() {
    const payments = this.page
      .waitForResponse((r) => /\/payments\/(\?|$)/.test(r.url()), { timeout: 45000 })
      .catch(() => null);
    await this.gotoSubscriptionTab();
    await payments;
    await this.billingRows.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await this.waitForBillingRowsLoaded();
  }

  // Wait until the billing rows carry real data rather than loading skeletons.
  //
  // The grid renders 10 placeholder <tr role="row"> with EMPTY cells while GET /payments/ is in
  // flight, so "grid is visible" and even "a row is visible" are both true before any status
  // text exists — a count() or status read at that moment sees 10 blank rows and reports every
  // expected status as missing (verified live 2026-07-28: `rendered statuses: "" x10`, then 9
  // real rows a moment later). Waiting on the response alone is not enough either: React paints
  // the real rows a frame or two after it resolves. So poll the DOM for the thing that actually
  // matters — a non-empty Status cell.
  //
  // Best-effort: an account with no payments renders no grid (or an empty one), which is a
  // legitimate state, so the wait expires quietly and callers read the count themselves.
  async waitForBillingRowsLoaded(timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const statuses = await this.allBillingRowStatuses().catch(() => []);
      if (statuses.length && statuses.some(Boolean)) return statuses;
      await this.page.waitForTimeout(250);
    }
    return [];
  }

  // Every billing row's Status cell, in order — for diagnostics when an expected status is
  // missing ("saw: Paid, Pending, Pending" beats "no Canceled row").
  async allBillingRowStatuses() {
    const n = await this.billingRows.count();
    const out = [];
    for (let i = 0; i < n; i++) out.push(await this.billingRowStatus(i));
    return out;
  }

  // Billing rows whose Status cell reads exactly `status`. The app title-cases the API enum
  // and uses the US single-L spelling: PAID/PENDING/CANCELED -> "Paid"/"Pending"/"Canceled"
  // (verified live 2026-07-27, scripts/probe-billing-status-actions.js). Anchored so
  // "Paid" cannot also match a hypothetical "Unpaid".
  rowsWithStatus(status) {
    return this.billingGrid
      .locator('[role="row"]:has([role="rowheader"])')
      .filter({ has: this.page.locator('[role="gridcell"]', { hasText: new RegExp(`^\\s*${status}\\s*$`, 'i') }) });
  }

  // A row's View / Download receipt controls, matched by aria-label ONLY — deliberately not
  // by role. The element TYPE changes with the payment status: a Paid row's Download is an
  // <a href="…/receipt….pdf">, while a Pending/Canceled row's is a <button disabled> (there
  // is no receipt to link to). A role=link or role=button locator would silently miss one
  // shape and let the assertion pass vacuously.
  receiptActionsIn(row) {
    return {
      View: row.locator('[aria-label="View"]').first(),
      Download: row.locator('[aria-label="Download"]').first(),
    };
  }

  // ---- Reconciling a payment against the record it leaves behind ----
  //
  // Every reader below exists for one question the suite could not previously answer: after a
  // candidate pays a DISCOUNTED amount, does that amount survive into the gateway, the billing
  // row, the receipt panel and the PDF? The receipt scenarios all drove `firstPaidRow()`, whose
  // amount is whatever the newest payment happens to be, and nothing was ever compared against
  // what the candidate was actually charged.

  // Every Paid row as data: { index, date, plan, amount (number), amountText }.
  //
  // Rows are matched by AMOUNT rather than by position on purpose. `firstPaidRow()` assumes the
  // grid is newest-first, which is true today but is not something the app promises — and on an
  // account with two payments (subscribe, then a discounted upgrade) betting on the order is how
  // an assertion ends up reconciling the wrong row and passing.
  async paidRowsData() {
    await this.waitForBillingRowsLoaded();
    const rows = this.rowsWithStatus('Paid');
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const date = ((await row.locator('[role="rowheader"]').first().innerText().catch(() => '')) || '').trim();
      const cells = await row.locator('[role="gridcell"]').allInnerTexts().catch(() => []);
      const amountText = (cells[1] || '').trim();
      const m = amountText.match(/[\d,]+(?:\.\d+)?/);
      out.push({
        index: i,
        date,
        plan: (cells[0] || '').trim(),
        amountText,
        amount: m ? parseFloat(m[0].replace(/,/g, '')) : null,
      });
    }
    return out;
  }

  // The Paid row charged `amount`, or null. Tolerance is one halala so a row rendered "SAR 124"
  // matches a charge of 124.00 (the grid drops decimals — see SUBSCRIPTION_JIRA_VS_APP.md M3).
  async paidRowForAmount(amount) {
    const rows = await this.paidRowsData();
    return rows.find((r) => r.amount !== null && Math.abs(r.amount - amount) < 0.01) || null;
  }

  paidRowAt(index) {
    return this.rowsWithStatus('Paid').nth(index);
  }

  // Open the receipt viewer for a specific Paid row (by index from `paidRowsData()`).
  async openReceiptForPaidRow(index) {
    await this.paidRowAt(index).locator('[aria-label="View"]').first().click();
    await this.receiptModal.waitFor({ state: 'visible', timeout: 15000 });
  }

  // The receipt file behind a specific Paid row, fetched with the page's own session.
  // { status, bytes, href } — a non-200 is returned rather than thrown so the caller can report
  // "the receipt link is dead" distinctly from "the receipt says the wrong amount".
  async fetchReceiptForPaidRow(index) {
    const link = this.paidRowAt(index).locator('[aria-label="Download"]').first();
    const href = (await link.getAttribute('href').catch(() => null)) || '';
    if (!href) return { status: null, bytes: Buffer.alloc(0), href: '' };
    const resp = await this.page.request.get(href);
    const bytes = resp.ok() ? await resp.body() : Buffer.alloc(0);
    return { status: resp.status(), bytes, href };
  }

  // Whatever the "Receipt information" panel currently states, as one object.
  async readReceiptPanel() {
    const amountText = await this.receiptPanelValue('Amount');
    const m = String(amountText).match(/[\d,]+(?:\.\d+)?/);
    return {
      plan: await this.receiptPanelValue('Plan Type'),
      amountText,
      amount: m ? parseFloat(m[0].replace(/,/g, '')) : null,
      date: await this.receiptPanelValue('Date Issued'),
    };
  }

  // ---- The gateway leg ----

  // Watch the two calls that hand a payment to PayTabs, and record what they carried.
  //
  // WHAT IS AND IS NOT OBSERVABLE HERE, established live 2026-07-31 with
  // scripts/probe-gateway-amount.js, because the first version of this reader guessed wrong:
  //
  //   POST /payments/paytabs/initiate/  -> 201 with an EMPTY body
  //   request payload: {"plan_id":1,"billing_cycle":"monthly","promo_code":""}
  //   redirect: https://secure.paytabs.sa/payment/page/<opaque token>
  //
  // So the app never tells the browser an amount: the backend computes it, talks to PayTabs
  // itself, and hands back a page token. Any reader that expects an amount in the API response
  // reports "the amount could not be read" on a perfectly healthy checkout — which is what the
  // first version did. What the request DOES carry is the promo code, which is worth asserting on
  // its own (it proves the code reached the payment call), and the amount is observable on the
  // gateway's own page. Hence: request payloads here, `readGatewayAmount()` for the figure.
  watchGatewayCalls() {
    const seen = [];
    const onResponse = async (res) => {
      let path;
      try {
        path = new URL(res.url()).pathname;
      } catch { return; }
      if (!/\/(payments\/paytabs\/initiate|subscription\/change)\/?$/.test(path)) return;
      if (res.request().method() !== 'POST') return;
      let request = null;
      try { request = JSON.parse(res.request().postData() || 'null'); } catch { request = null; }
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      seen.push({ path, status: res.status(), request, requestRaw: res.request().postData() || null, body });
    };
    this.page.on('response', onResponse);
    return {
      stop: () => this.page.off('response', onResponse),
      calls: () => seen,
      // The promo code the app posted, if any call carried one.
      promoSent: () => {
        for (const c of seen) {
          const code = c.request && (c.request.promo_code || c.request.promoCode);
          if (code) return String(code);
        }
        return null;
      },
      // Kept for completeness — see the note above: today no payload carries an amount, so this is
      // normally empty and callers must not treat that as a defect.
      amounts: () => {
        const out = [];
        const walk = (v, key) => {
          if (v === null || v === undefined) return;
          if (typeof v === 'number' && /amount|total|price|charge/i.test(key || '')) out.push(v);
          else if (typeof v === 'string' && /amount|total|price|charge/i.test(key || '')) {
            const n = parseFloat(v.replace(/[^\d.]/g, ''));
            if (Number.isFinite(n)) out.push(n);
          } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
          else if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
        };
        seen.forEach((c) => { walk(c.body, ''); walk(c.request, ''); });
        return out;
      },
    };
  }

  // The amount the PayTabs page ASKS THE CANDIDATE FOR — the figure they see next to "PAY NOW".
  //
  // Two things this gets right that a naive body scrape does not:
  //
  //  * It waits for the card form. The URL commits well before the gateway paints, so reading
  //    immediately after the redirect returns an empty body — and an empty read looks exactly like
  //    "the gateway displays no amount".
  //  * It prefers CURRENCY-MARKED tokens. The live page reads
  //    "Payment details ﷼155.00 PAY NOW Cancel PMNT0202.6A6CDAC3.00018B95", so scraping every
  //    number yields 155, 202.6, 6, 3.00018, 95 — four of those are fragments of the transaction
  //    reference. `amount` is taken from the ﷼/SAR-prefixed token; `allAmounts` is kept only as a
  //    fallback for a re-skinned gateway.
  //
  // { amount, currencyAmounts, allAmounts, text, painted }
  async readGatewayAmount({ timeout = 45000 } = {}) {
    const painted = await this.paytabsCardNumber
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    const text = (await this.page.locator('body').innerText().catch(() => '')) || '';
    const num = (s) => parseFloat(String(s).replace(/,/g, ''));
    const currencyAmounts = [];
    // ﷼ is U+FDFC (RIAL SIGN) — what the gateway actually prints. SAR / SR / ر.س are accepted too
    // in case it is localised differently.
    const cur = /(?:﷼|SAR|SR|ر\.?س)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:﷼|SAR|SR|ر\.?س)/gi;
    let m;
    while ((m = cur.exec(text)) !== null) {
      const n = num(m[1] || m[2]);
      if (Number.isFinite(n)) currencyAmounts.push(n);
    }
    const allAmounts = [];
    const any = /\d[\d,]*(?:\.\d+)?/g;
    while ((m = any.exec(text)) !== null) {
      const n = num(m[0]);
      if (Number.isFinite(n)) allAmounts.push(n);
    }
    return {
      amount: currencyAmounts.length ? currencyAmounts[0] : null,
      currencyAmounts,
      allAmounts,
      painted,
      text: text.replace(/\s+/g, ' ').trim().slice(0, 600),
    };
  }

  // Confirm cancellation from the Subscription tab (destructive).
  async confirmCancel() {
    await this.openCancelModal();
    await this.confirmCancelButton.click();
    await this.cancelModal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // Resubscribe before expiry: click Resubscribe, confirm in the modal, wait for the
  // tab to return to the active ("Auto-renews on") state.
  async resubscribe() {
    await this.resubscribeButton.click();
    await this.resubscribeModal.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmResubscribeButton.click();
    // Active state is restored when the management CTAs return (the "Resubscribe" CTA
    // is replaced by "Change Plan"/"Cancel"). Don't wait for "Auto-renews on" text
    // specifically — if a scheduled downgrade is pending the tab shows "Changes to …"
    // instead.
    await this.changePlanButton.waitFor({ state: 'visible', timeout: 20000 });
  }
}

module.exports = SubscriptionPage;
