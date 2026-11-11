const BasePage = require('./BasePage');

// ReferralCodesPage — Page Object for the "Referral Codes" section on the Agent
// Dashboard (TFF-467) and its two share modals.
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name
// -> semantic HTML -> structural classes -> text fallback. data-testid candidates
// are listed first even though this section exposes NONE today (verified live
// 2026-07-28: the whole section is Tailwind with zero test ids), so the suite
// auto-upgrades when the app team adds them.
//
// Live DOM, agent dashboard (2026-07-28):
//   div.rounded-2xl.border                       <- section
//     p "Referral Codes"
//     div.flex.flex-1.flex-wrap  (x2)            <- widget
//       p.text-[12px] "Agent Code" | "Promo Code"   <- widget label
//       p.text-[24px] "MZFVYB"                      <- the code
//       button[aria-label="Copy Code"]               <- copy icon (ABSENT when disabled)
//       button "Share Code"
//
// Share modal (role="dialog"):
//   p.text-lg  "Agent Code" | "Promo Code"       <- title
//   p.text-base.font-medium                      <- guidance / state message
//   p.text-display-md                            <- the code
//   button "Copy Code"       (label flips to "Copied!"; ABSENT when disabled)
//   "Promo Details" panel: Status | Discount | Usage Limit | Expires on  (promo only)
//   "Or share via": Facebook | WhatsApp | LinkedIn | Twitter  (ABSENT when disabled)
class ReferralCodesPage extends BasePage {
  constructor(page) {
    super(page);
    this.url = new URL('/dashboard', process.env.BASE_URL || 'https://dev.talentforge.com.sa').href;

    // ---- Section ----
    this.sectionHeading = page
      .locator('[data-testid="referral-codes-heading"]')
      .or(page.getByText(/^Referral Codes$/).first())
      .first();

    // The section card itself — the ancestor that holds the heading AND both widgets.
    this.section = page
      .locator('[data-testid="referral-codes-section"]')
      .or(page.locator('div.rounded-2xl:has(> div p:text-is("Referral Codes"))'))
      .first();

    // ---- Share modal ----
    this.modal = page.locator('[data-testid="share-code-modal"], [role="dialog"]').first();
    // >>> THE MODAL'S TYPE SCALE BECAME RESPONSIVE (measured 2026-10-06): the title is
    //     `text-md lg:text-lg`, the message `text-sm lg:text-base`, the code
    //     `text-display-sm lg:text-display-md`. A class written `lg:text-lg` is NOT the class
    //     `text-lg`, so the old selectors matched nothing. Both forms are accepted.
    this.modalTitle = this.modal.locator('p.text-lg, p.lg\\:text-lg, h2, [role="heading"]').first();
    // The guidance / state message: the first body paragraph, above the code panel.
    this.modalMessage = this.modal.locator('p.text-base.font-medium, p.font-medium.lg\\:text-base, p.text-base').first();
    // The large code inside the modal's highlighted panel.
    this.modalCode = this.modal.locator('p.text-display-md, p.lg\\:text-display-md, p.text-4xl, p.text-3xl').first();
    this.modalCopyButton = this.modal
      .getByRole('button', { name: /^(copy code|copied!?)$/i })
      .first();
    this.modalCloseButton = this.modal.locator('button[aria-label="Close"], button[aria-label="Close dialog"]').first();
    this.modalBackButton = this.modal.locator('button[aria-label="Back"]').first();
    this.promoDetailsPanel = this.modal
      .locator('div:has(> div p:text-is("Promo Details"))')
      .first();
    this.shareViaHeading = this.modal.getByText(/^Or share via$/i).first();

    // ---- The dashboard's first-time welcome modal ----
    // Not part of this section, but it covers it. Scoped by its own greeting so it can never
    // resolve to a share modal, which is also a `div.fixed.inset-0` overlay.
    this.welcomeModal = page.locator('div.fixed.inset-0').filter({ hasText: /welcome,/i }).first();
    this.welcomeModalDismiss = this.welcomeModal
      .getByRole('button', { name: /^dismiss$/i })
      .first();
  }

  async navigate() {
    await super.navigate(this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.sectionHeading.waitFor({ state: 'visible', timeout: 60000 });
  }

  // ---- The welcome modal that covers this section ----
  //
  // >>> THE AGENT DASHBOARD'S FIRST-TIME WELCOME MODAL APPEARS ~2s AFTER THE DASHBOARD PAINTS,
  // AND ITS BACKDROP SWALLOWS EVERY CLICK IN THIS SECTION. <<< It renders for any agent whose
  // candidate count is 0, which this feature's own fixture is permanently (see the account note
  // at the top of steps/referral-codes.js - these agents carry no candidates by design). The
  // backdrop is `div.fixed.inset-0 ... bg-overlay/70 ... backdrop-blur-[6px]`, so a Share Code
  // or Copy click made after it appears retries until it times out, reporting
  // "<div ...> intercepts pointer events" - which reads as a broken locator.
  //
  // Measured 2026-09-08 (scripts/probe-referral-welcome-block.js): NOT visible at 0ms or 1000ms,
  // visible from ~2000ms onward. That timing is the whole story, and it is why the fault looked
  // intermittent rather than systematic: a scenario that opens a share modal within ~2s of
  // navigate() wins the race and passes, while one that returns to the agent page after a detour
  // ALWAYS loses it - `the promo parameters on the superadmin tab should match my share modal:`
  // spends ~90s logging a superadmin into a second context first, and failed 100% of the time.
  //
  // Dismissing in navigate() would be useless for the same reason: at that point the modal does
  // not exist yet. So it is dismissed at the point of the click instead, and the click is retried
  // once after a dismissal to cover the window in which it can appear between the two. Escape
  // also works and sets sessionStorage.agent_welcome_shown="1", after which it stays down for
  // the tab - so one dismissal per page is normally enough. Do NOT raise the click timeout
  // instead: the backdrop never goes away on its own.
  async dismissWelcomeModal() {
    if (!(await this.welcomeModal.isVisible().catch(() => false))) return false;
    await this.welcomeModalDismiss.click({ timeout: 5000 }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
    });
    await this.welcomeModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return true;
  }

  // Click a control in this section, tolerating the welcome modal appearing mid-action. The
  // retry is conditional on a dismissal having actually happened, so a click that failed for any
  // OTHER reason still throws its own error rather than being masked by a second attempt.
  async clickPastWelcomeModal(locator) {
    await this.dismissWelcomeModal();
    try {
      await locator.click({ timeout: 15000 });
    } catch (err) {
      if (!(await this.dismissWelcomeModal())) throw err;
      await locator.click({ timeout: 15000 });
    }
  }

  // ---- Widgets ----

  // One widget ("Agent Code" / "Promo Code"), identified by STRUCTURE: the div whose direct child
  // holds the exact label. The section card is an ancestor of both widgets but never has a label
  // as a grandchild, so this cannot resolve to the section.
  //
  // >>> IT USED TO BE `div.flex-1.flex-wrap:has(...)`, AND THE STYLING CLASS BROKE IT. Measured
  //     2026-10-06 (scripts/probe-referral-code-value.js): the widget is now
  //     `flex flex-1 flex-col ... lg:flex-row` - no `flex-wrap` - so the locator matched nothing and
  //     every Referral Codes step reading a code timed out against a dashboard plainly showing it.
  widget(label) {
    return this.page
      .locator(`[data-testid="referral-widget-${slug(label)}"]`)
      .or(this.page.locator(`div:has(> div > p:text-is("${label}"))`))
      .first();
  }

  widgetLabel(label) {
    return this.widget(label).locator(`p:text-is("${label}")`).first();
  }

  // The code itself. Rendered at text-[24px]; brand-700 when live, gray-300 when the
  // promo is disabled — so match on size, not colour.
  codeText(label) {
    return this.widget(label).locator('p.text-\\[24px\\], p.text-2xl').first();
  }

  copyIcon(label) {
    return this.widget(label).locator('button[aria-label="Copy Code" i], button[aria-label*="copy" i]').first();
  }

  shareButton(label) {
    return this.widget(label).getByRole('button', { name: /share code/i }).first();
  }

  // Status pill next to the code ("Disabled" / "Expired"). Absent on an Active promo.
  statusPill(label) {
    return this.widget(label).locator('span.rounded-full:has(> span)').filter({ hasText: /\w/ }).first();
  }

  async readCode(label) {
    const el = this.codeText(label);
    await el.waitFor({ state: 'visible', timeout: 20000 });
    return (await el.innerText()).trim();
  }

  async hasCopyIcon(label) {
    return this.copyIcon(label).isVisible().catch(() => false);
  }

  // "Washed out" = the disabled treatment (text-gray-300 instead of text-brand-700).
  async isCodeWashedOut(label) {
    const cls = (await this.codeText(label).getAttribute('class')) || '';
    if (/text-gray-(300|400)/.test(cls)) return true;
    // Fall back to the computed colour in case the palette class is renamed.
    const color = await this.codeText(label).evaluate((el) => getComputedStyle(el).color);
    const m = color.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const [r, g, b] = m.slice(1).map(Number);
    // Grey and light: all channels within 12 of each other, none dark.
    return Math.max(r, g, b) - Math.min(r, g, b) < 12 && Math.min(r, g, b) > 150;
  }

  async widgetStatus(label) {
    const pill = this.statusPill(label);
    if (!(await pill.isVisible().catch(() => false))) return null;
    return (await pill.innerText()).trim();
  }

  // ---- Copy ----

  // Read the clipboard. Needs clipboard-read permission on the context (granted by the
  // step that calls this); returns null when the browser refuses so callers can fall
  // back to the button's own "Copied!" confirmation.
  async readClipboard() {
    return this.page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => null);
  }

  async copyFromWidget(label) {
    await this.clickPastWelcomeModal(this.copyIcon(label));
  }

  // ---- Share modal ----

  async openShareModal(label) {
    await this.clickPastWelcomeModal(this.shareButton(label));
    await this.modal.waitFor({ state: 'visible', timeout: 20000 });
    await this.modalTitle.waitFor({ state: 'visible', timeout: 20000 });
  }

  async closeShareModal() {
    if (await this.modal.isVisible().catch(() => false)) {
      await this.modalCloseButton.click().catch(() => {});
      await this.modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }

  async readModalTitle() {
    return (await this.modalTitle.innerText()).trim();
  }

  async readModalMessage() {
    return (await this.modalMessage.innerText()).trim().replace(/\s+/g, ' ');
  }

  async readModalCode() {
    return (await this.modalCode.innerText()).trim();
  }

  async modalHasCopyCta() {
    return this.modalCopyButton.isVisible().catch(() => false);
  }

  async readModalCopyLabel() {
    return (await this.modalCopyButton.innerText()).trim();
  }

  // ---- Promo Details ----

  // Read one Promo Details field by its label.
  //
  // >>> `.last()` ON A COMMA-SEPARATED UNION RESOLVES IN DOM ORDER, AND THAT COST THIS SUITE
  // FOUR MISREPORTED FAILURES. <<< Three fields render as a `div > p(label) + p(value)` pair,
  // but STATUS renders its value in a pill that contains TWO `span.rounded-full` - the pill
  // itself and, first inside it, a 6px decorative indicator DOT carrying no text at all
  // (measured live 2026-09-08 on the referral agent, promo Active):
  //
  //   <div class="flex flex-col gap-1.5">
  //     <p  class="text-[12px] ...">Status</p>
  //     <span class="... rounded-full border border-success-600">   <- innerText "Active"
  //       <span class="w-1.5 h-1.5 rounded-full bg-success-600"></span>  <- the DOT, innerText ""
  //       <span class="text-xs font-medium text-gray-900">Active</span>
  //     </span>
  //   </div>
  //
  // So the old `.last()` picked the dot and `readPromoDetail('Status')` returned "" for a modal
  // plainly showing "Active". A reader that can only ever answer "absent" is the trap this repo
  // has now paid for five times, and here it reported the AGENT PORTAL as not showing a status:
  // "Promo Details are well-formed" failed `toBeTruthy()`, "An Active promo code is fully
  // enabled" threw "...but it is (not shown)" and sent the reader to the superadmin portal to
  // fix a promo that was already correct, and "my promo code has uses remaining" failed
  // `/active/i` - taking a @provision scenario (a live candidate signup) down with it.
  //
  // Filtering to candidates that hold text is what makes the union safe: it drops the dot and
  // changes nothing for the three `p`-valued fields, whose values are non-empty by definition.
  // Do NOT "simplify" this back to a bare `.last()`.
  promoDetailValue(field) {
    return this.modal
      .locator(`div:has(> p:text-is("${field}"))`)
      .last()
      .locator(`p:not(:text-is("${field}")), span.rounded-full`)
      .filter({ hasText: /\S/ })
      .last();
  }

  async readPromoDetail(field) {
    const el = this.promoDetailValue(field);
    if (!(await el.isVisible().catch(() => false))) return null;
    return (await el.innerText()).trim().replace(/\s+/g, ' ');
  }

  async promoDetailsFields() {
    if (!(await this.promoDetailsPanel.isVisible().catch(() => false))) return [];
    return this.promoDetailsPanel
      .locator('p.text-\\[12px\\], p.text-xs')
      .allInnerTexts()
      .then((xs) => xs.map((s) => s.trim()).filter(Boolean));
  }

  // ---- Social sharing ----

  shareTargetButton(platform) {
    return this.modal.getByRole('button', { name: new RegExp(`^${platform}$`, 'i') }).first();
  }

  async shareTargets() {
    const names = ['Facebook', 'WhatsApp', 'LinkedIn', 'Twitter', 'X'];
    const found = [];
    for (const n of names) {
      if (await this.shareTargetButton(n).isVisible().catch(() => false)) found.push(n);
    }
    return found;
  }

  // Click a share target and report WHAT THE APP ASKED THE PLATFORM TO SHARE.
  //
  // >>> `popup.url()` IS NOT THE ANSWER TO THAT QUESTION, AND READING IT COST THIS FEATURE A
  // MISDIAGNOSED APP DEFECT FOR MONTHS. <<< Every share target is a `window.open(url)`, and the
  // platform then redirects the popup wherever its own login and content rules send it - so
  // `popup.url()` reports where the BROWSER ENDED UP, which is a function of Facebook's sharer
  // rules and of whether this machine holds a session on that network, not of what the product
  // sent. Measured 2026-09-08 (scripts/probe-referral-promo-state.js):
  //
  //   the app opens   facebook.com/sharer/sharer.php?quote=Use my promo code on ...: CODEHFA8X3Y
  //   the popup lands facebook.com/share_channel/?type=empty&source_surface=external_share
  //
  // So the code IS passed, on all four platforms. Facebook alone loses it on the way in, because
  // `sharer.php` shares a `u=` (a URL) and treats `quote=` as a comment ON that url - with no
  // `u=` there is nothing to share, and `type=empty` is Facebook's own word for it. Asserting the
  // landing url therefore reported "the app passes no code to Facebook", which is false, and sent
  // whoever read it to the wrong half of the product.
  //
  // The recorder is installed immediately BEFORE the click, not as an init script: by the time a
  // share modal is open the page navigated long ago, so an init script would never run. The app
  // resolves `window.open` at call time, so a late wrapper is picked up by the very next click.
  //
  // The landing url is still captured, as EVIDENCE - it is what a human watching the popup sees,
  // and the only thing that can show a platform silently discarding a correctly formed share.
  //
  // Still waits on context.waitForEvent('page') rather than page.waitForEvent('popup'): a couple
  // of the handlers open the tab from a detached async callback, which page-level capture misses.
  async shareVia(platform, { timeout = 20000 } = {}) {
    const context = this.page.context();

    await this.page.evaluate(() => {
      if (!window.__tfShareOpens) {
        window.__tfShareOpens = [];
        const real = window.open.bind(window);
        window.open = function (...args) {
          window.__tfShareOpens.push(args[0] == null ? null : String(args[0]));
          return real(...args);
        };
      }
      window.__tfShareOpens.length = 0;
    });

    const pending = context.waitForEvent('page', { timeout }).catch(() => null);
    await this.shareTargetButton(platform).click();
    const popup = await pending;
    const requestedUrl = await this.page.evaluate(() => (window.__tfShareOpens || [])[0] || null);

    let landedOn = null;
    if (popup) {
      landedOn = popup.url();
      await popup.close().catch(() => {});
    }

    // Neither reading answers this alone: an app that opened nothing leaves both null, and that
    // must stay distinguishable from an app that opened the wrong place.
    if (!popup && !requestedUrl) {
      throw new Error(
        `Clicking the "${platform}" share target opened no window. The app is expected to `
        + "window.open the platform's share endpoint with the code prefilled (AC 6)."
      );
    }

    this.lastShare = { platform, requestedUrl, landedOn, fromWindowOpen: !!requestedUrl };
    return requestedUrl || landedOn;
  }

  // Pull the human-readable share text back out of a share URL, including the variants
  // that bury it in a login redirect (LinkedIn / X). Verified live 2026-07-28:
  //   WhatsApp  api.whatsapp.com/send/?text=<msg>
  //   LinkedIn  linkedin.com/uas/login?session_redirect=<enc linkedin.com/shareArticle/?url=<msg>>
  //   X         x.com/i/flow/login?redirect_after_login=<enc /intent/tweet?text=<msg>>
  //   Facebook  facebook.com/sharer/sharer.php?quote=<msg>   (Facebook then redirects to
  //             share_channel/?type=empty because `quote=` needs a `u=` to comment on)
  static shareTextFrom(rawUrl) {
    let decoded = rawUrl;
    // Unwrap up to three layers of percent-encoding (login redirect -> share URL -> text).
    for (let i = 0; i < 3; i += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return decoded.replace(/\+/g, ' ');
  }
}

function slug(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, '-');
}

module.exports = ReferralCodesPage;
