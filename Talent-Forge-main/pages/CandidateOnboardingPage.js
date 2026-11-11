const BasePage = require('./BasePage');

// CandidateOnboardingPage — the Agent Portal's candidate-onboarding modal STACK (TFF-36,
// TFF-158, TFF-467), plus the zero-candidate dashboard the first-time welcome modal sits over.
//
// Four modals, all rendered as `[role="dialog"]` and only ever one at a time:
//
//   1. the first-time welcome modal      "Welcome, <FirstName>! 👋"
//   2. the method chooser                "Choose how you want to onboard your candidates:"
//   3. Share Agent Code                  "Agent Code"
//   4. Send Onboarding Invite            "Invite via Email"
//
// >>> THE STORY'S NAMES FOR MODALS 3 AND 4 ARE NOT WHAT THE APP RENDERS. <<< The feature files
// say "Share Agent Code" and "Send Onboarding Invite" — those are the card LINK labels ("Share
// agent code" / "Send onboarding invite"), not the titles. The app titles them "Agent Code" and
// "Invite via Email". MODALS maps one onto the other, the same way CommunityPage's
// FILTER_TRIGGER_LABELS maps each story's filter naming onto the rendered set, so a step can say
// `the "Send Onboarding Invite" modal should be displayed` and still be checked against the
// title the build actually paints. The divergence is asserted in a step of its own, never
// smuggled in as a locator that quietly tolerates either name.
//
// ENTRY POINTS, measured 2026-08-27 — there are two and they are NOT interchangeable:
//   * /dashboard — only through the welcome modal's "Onboard Candidates" button, so only for an
//     agent that still has zero candidates. There is no other onboarding control on the
//     dashboard (the two "Share Code" buttons belong to the Referral Codes section, a different
//     modal — see ReferralCodesPage).
//   * /candidates/in-progress — the "Invite Candidate" button, available to EVERY agent.
// A scenario that ends by asserting it is back "on the Agent Dashboard" therefore has to have
// opened the chooser from the dashboard; openChooserFromDashboard() is that path.
//
// >>> THE WELCOME MODAL IS NOT GATED ON "FIRST LOGIN". <<< Measured 2026-08-27 across five
// accounts: it renders on EVERY fresh sign-in of any agent whose candidate count is 0 — four
// long-lived fixtures that have each signed in dozens of times all showed it — and never for an
// agent that has candidates. What suppresses it once seen is
// `sessionStorage.agent_welcome_shown === '1'`, written client-side when it is dismissed: no
// request is fired, no cookie is set, nothing is recorded server-side. Consequences the steps
// depend on:
//   * sessionStorage is per TAB, so it survives a reload (which re-authenticates through
//     POST /auth/token/refresh/) but not a new browser context. Every Cucumber scenario gets a
//     fresh context, so the modal is up again at the start of each one — no fixture is consumed
//     by looking at it.
//   * "log out and log back in" inside one tab therefore proves NOTHING about the candidate-count
//     rule: the flag alone would keep the modal down. clearWelcomeSuppression() drops it, so the
//     assertion tests the app's rule instead of this tab's leftover state.
//
// Selector strategy follows the project convention: data-testid -> ARIA role/name -> semantic
// HTML -> structural classes -> text fallback. Unusually for this app the onboarding stack DOES
// expose test ids (`agent-onboard-candidates-button`, `agent-share-agent-code-option`,
// `agent-code-text-area`, `agent-copy-code-button`, `agent-send-invites-button`, ...), so those
// lead; the layers behind them are what keeps the suite alive if they are renamed.
class CandidateOnboardingPage extends BasePage {
  // Story name -> how to recognise the modal the app renders for it.
  //
  // >>> `title` AND `body` ARE NOT INTERCHANGEABLE, AND CONFLATING THEM SILENTLY BREAKS EVERY
  //     LOCATOR HERE. <<< Playwright's `filter({ hasText })` tests the element's WHOLE text
  //     content, so an anchored title regex can never match a dialog: the chooser's own text is
  //     "Choose how you want to onboard your candidates: | Invite via Email | Send an email
  //     invitation ... | Share agent code", and `/^Choose ... candidates:?$/` fails on it. Using
  //     the title regex as a filter is how the first live run reported the chooser "not
  //     displayed" while its own error message quoted the correct title back.
  //
  //     So there are two regexes per modal and each has one job:
  //       * `body`  - a phrase unique to that modal, used to FIND it. Deliberately a line the
  //                   modal owns outright rather than its heading, so it cannot collide with a
  //                   neighbour (the invite modal and the chooser both contain the words "Invite
  //                   via Email", which is exactly the sort of overlap that resolves to the wrong
  //                   dialog).
  //       * `title` - the exact heading, used to resolve a story name and to assert the wording.
  static MODALS = {
    welcome: {
      title: /^Welcome,/,
      body: /Everything starts with onboarding your candidates/i,
      aliases: [/^(the )?(first-time )?welcome( modal)?$/i],
    },
    chooser: {
      title: /^Choose how you want to onboard your candidates:?$/i,
      body: /Choose how you want to onboard your candidates/i,
      aliases: [/^choose onboarding method$/i],
    },
    agentCode: {
      title: /^Agent Code$/i,
      body: /Your Agent Code/i,
      aliases: [/^share agent code$/i],
    },
    invite: {
      title: /^Invite via Email$/i,
      body: /Type or paste candidate email addresses/i,
      aliases: [/^send onboarding invite$/i, /^invite$/i],
    },
  };

  // The two onboarding methods the chooser offers, as the stories name them.
  static METHODS = {
    'Invite via Email': {
      testid: 'agent-send-onboarding-invite-option',
      link: 'Send onboarding invite',
      opens: 'invite',
    },
    'Share Agent Code': {
      testid: 'agent-share-agent-code-option',
      link: 'Share agent code',
      opens: 'agentCode',
    },
  };

  // The four platforms the Share Agent Code modal offers, and the host each must reach.
  // The stories say "X (Twitter)"; the button reads "Twitter" and opens x.com.
  //
  // `host` is matched against the url THE APP OPENS, so it has to name each platform's own
  // share endpoint - not the host that platform's redirect happens to land on. `wa.me` is
  // WhatsApp's official short domain and is what the app opens; it redirects to
  // `api.whatsapp.com` only afterwards, which is all the previous popup-url reader ever saw.
  static PLATFORMS = {
    WhatsApp: { button: /^WhatsApp$/i, host: /(whatsapp\.com|wa\.me)/i },
    Facebook: { button: /^Facebook$/i, host: /facebook\.com/i },
    LinkedIn: { button: /^LinkedIn$/i, host: /linkedin\.com/i },
    'X (Twitter)': { button: /^(Twitter|X)$/i, host: /(twitter\.com|x\.com)/i },
  };

  // The four KPI widgets on the agent dashboard, in the order they are rendered.
  static KPIS = ['Total Candidates', 'Active Candidates', 'Onboarding in Progress', 'Requires Attention'];

  constructor(page) {
    super(page);
    const base = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
    this.dashboardUrl = new URL('/dashboard', base).href;
    this.candidatesUrl = new URL('/candidates/in-progress', base).href;

    // Any open modal. Every one of the four is a `<section role="dialog">` and react-aria leaves
    // the closed ones out of the DOM entirely rather than hiding them.
    this.anyModal = this.page.locator('[role="dialog"]');

    // ---- 1. welcome modal ----
    this.welcomeModal = this.modal('welcome');
    // The greeting is the only h2 in the stack; the other three title with a <p>.
    this.welcomeHeading = this.welcomeModal.locator('h2, [role="heading"]').first();
    this.onboardCandidatesButton = this.welcomeModal
      .locator('[data-testid="agent-onboard-candidates-button"]')
      .or(this.welcomeModal.getByRole('button', { name: /onboard candidates/i }))
      .first();

    // ---- 2. method chooser ----
    this.chooserModal = this.modal('chooser');

    // ---- 3. Share Agent Code ----
    this.agentCodeModal = this.modal('agentCode');
    this.agentCodeText = this.agentCodeModal
      .locator('[data-testid="agent-code-text-area"]')
      .or(this.agentCodeModal.locator('p.text-display-md, p.text-4xl, p.text-3xl'))
      .first();
    this.copyCodeButton = this.agentCodeModal
      .locator('[data-testid="agent-copy-code-button"]')
      .or(this.agentCodeModal.getByRole('button', { name: /^(copy code|copied!?)$/i }))
      .first();
    this.shareViaHeading = this.agentCodeModal.getByText(/^Or share via$/i).first();

    // ---- 4. Send Onboarding Invite ----
    this.inviteModal = this.modal('invite');
    this.inviteEmailInput = this.inviteModal
      .locator('[data-testid="agent-invite-email-input"]')
      .or(this.inviteModal.locator('input[type="text"]'))
      .first();
    this.sendInvitesButton = this.inviteModal
      .locator('[data-testid="agent-send-invites-button"]')
      .or(this.inviteModal.getByRole('button', { name: /send invites?/i }))
      .first();
    this.inviteCancelButton = this.inviteModal.getByRole('button', { name: /^cancel$/i }).first();

    // ---- 4a. the CHIP field inside that modal ----
    //
    // Measured 2026-08-29 (scripts/probe-invite-chips.js). A committed address renders as
    //   <span class="... bg-brand-25 ...">addr<button aria-label="Remove addr">...</button></span>
    // so the REMOVE BUTTON's aria-label is the only hook carrying the address itself. That is what
    // every chip reader below is built on, and it is deliberate: reading the <span>'s text would
    // also pick up the button's own node, and matching the span by class ties the suite to a
    // Tailwind palette name.
    this.chipRemoveButtons = this.inviteModal.locator('button[aria-label^="Remove "]');
    // The inline validation line. `role="alert"` is the app's own. Scoped to the MODAL because the
    // bulk zone below it raises its own errors - an unscoped [role=alert] read would report a
    // file-format refusal as an email validation error.
    this.inviteFieldError = this.inviteModal.locator('[role="alert"]');
    this.inviteBackArrow = this.inviteModal.locator('button[aria-label="Back"]').first();
    this.inviteCloseIcon = this.inviteModal.locator('button[aria-label="Close"]').first();

    // ---- 4b. the BULK CSV upload zone inside that same modal ----
    //
    // Measured 2026-08-27 (scripts/probe-bulk-upload-modal.js). The whole bulk half of the modal
    // is one container carrying its own test id, which is what every reader below is scoped to -
    // the modal also holds the chip input, and an unscoped "error text" or "file name" read would
    // happily pick up something from that half instead.
    this.csvZone = this.inviteModal.locator('[data-testid="agent-invite-csv-dropzone"]').first();

    // The drop TARGET, which is a different element from the zone: the zone contains the heading,
    // the template link, the drop target, and - when there is one - the error line BELOW it. The
    // "immediately below the upload area" assertion needs both boxes, so both are locators.
    this.csvDropTarget = this.csvZone.locator('[data-dropzone="true"]').first();

    // >>> THE FILE INPUT IS `sr-only` AND IS REMOVED FROM THE DOM ONCE A FILE IS CHOSEN. <<<
    // The zone swaps the drop target for a file card, taking the input with it, so a second
    // setInputFiles() against a zone that already holds a file times out reporting the input
    // "not found" - which reads as a broken locator. removeCsv() first; uploadCsv() does.
    this.csvFileInput = this.csvZone.locator('input[type="file"]').first();
    this.csvUploadButton = this.csvZone
      .locator('[data-testid="agent-invite-csv-upload-button"]')
      .or(this.csvZone.getByRole('button', { name: /click to upload/i }))
      .first();
    this.csvDragHint = this.csvZone.getByText(/or drag and drop/i).first();
    this.csvFormatHint = this.csvZone.locator('p').filter({ hasText: /max\.?\s*10\s*MB/i }).first();
    // An <a download href="/invite-candidates-template.csv">, not a button - so this is matched
    // by role LINK. A getByRole('button') here resolves nothing.
    this.downloadTemplateLink = this.csvZone
      .getByRole('link', { name: /download template/i })
      .or(this.csvZone.locator('a[download]'))
      .first();
    this.uploadInstructionsHeading = this.inviteModal.getByText(/^Upload Instructions:?$/i).first();
    this.uploadInstructionItems = this.inviteModal.locator('ul li');
    // The file card the zone renders in place of the drop target: a bold name, a size/progress
    // line, and a delete control that is identified by aria-label because it is icon-only.
    this.csvRemoveButton = this.csvZone.locator('button[aria-label="Delete"]').first();
    this.csvProgressBar = this.csvZone.locator('[role="progressbar"]').first();
    // The mutual-exclusion notice, which belongs to the MODAL rather than the zone - see
    // mutualExclusionError() for the rule it announces.
    this.oneOptionError = this.inviteModal
      .getByText(/only use one option at a time/i)
      .first();
  }

  // ---------------------------------------------------------------------------------------
  // Modal identity
  // ---------------------------------------------------------------------------------------

  // Resolve a story name ("Send Onboarding Invite", "welcome", ...) to a MODALS key. Throws
  // rather than guessing: a mistyped modal name in a feature file must fail naming the four
  // that exist, not silently match whichever dialog happens to be open.
  static keyFor(name) {
    const wanted = String(name).trim();
    if (Object.prototype.hasOwnProperty.call(CandidateOnboardingPage.MODALS, wanted)) return wanted;
    for (const [key, spec] of Object.entries(CandidateOnboardingPage.MODALS)) {
      if (spec.title.test(wanted) || spec.aliases.some((a) => a.test(wanted))) return key;
    }
    throw new Error(
      `Unknown onboarding modal ${JSON.stringify(name)}. Known: `
      + Object.keys(CandidateOnboardingPage.MODALS).join(', ')
    );
  }

  // A locator for one modal, found by a phrase that modal owns outright - `body`, never `title`;
  // see MODALS above for what goes wrong when the two are conflated. Matched on rendered text
  // rather than on a class, so a Tailwind churn cannot break it.
  modal(name) {
    const key = CandidateOnboardingPage.keyFor(name);
    const { body } = CandidateOnboardingPage.MODALS[key];
    return this.page.locator('[role="dialog"]').filter({ hasText: body }).first();
  }

  // >>> TWO MODALS ARE VISIBLE AT ONCE WHILE ONE REPLACES ANOTHER. <<< Measured 2026-08-27
  // (scripts/probe-onboarding-reopen-loop.js): for a moment after "Onboard Candidates" is
  // clicked, BOTH the welcome modal and the chooser are attached and visible - the outgoing one
  // is unmounted a beat later. So "which modal is open" cannot be answered by testing the four
  // in a fixed order: the first version of openModal() checked `welcome` first and reported the
  // STALE modal, which is how a live run said the Share Agent Code modal had not opened while
  // its own evidence showed the click had worked. That is the DOM-order trap this repo already
  // records for comma-separated locator unions, one layer up.
  //
  // The honest answer is the TOPMOST dialog - the last one in document order, which is the one
  // the app has just pushed and the one a person is looking at. Ties are impossible here (each
  // `body` phrase belongs to exactly one modal), but everything visible is returned so a caller
  // can report the whole stack rather than a single guess.
  async visibleModals() {
    const dialogs = this.page.locator('[role="dialog"]');
    const count = await dialogs.count();
    const found = [];
    for (let i = 0; i < count; i++) {
      const dlg = dialogs.nth(i);
      if (!(await dlg.isVisible().catch(() => false))) continue;
      const text = await dlg.innerText().catch(() => '');
      const key = Object.entries(CandidateOnboardingPage.MODALS)
        .find(([, spec]) => spec.body.test(text));
      found.push(key ? key[0] : 'unrecognised');
    }
    return found;
  }

  // The modal on top, or null. Used by the "no longer displayed" steps so a failure can say what
  // IS up instead of only what is not.
  async openModal() {
    const visible = await this.visibleModals();
    return visible.length ? visible[visible.length - 1] : null;
  }

  // The title the app actually paints on the TOPMOST modal, so a divergence from the story's
  // name is reportable instead of merely tolerated.
  async renderedTitle() {
    const dialogs = this.page.locator('[role="dialog"]');
    const count = await dialogs.count();
    for (let i = count - 1; i >= 0; i--) {
      const dlg = dialogs.nth(i);
      if (!(await dlg.isVisible().catch(() => false))) continue;
      const title = dlg.locator('h2, p.text-lg, [role="heading"]').first();
      if (!(await title.count())) return null;
      return (await title.innerText()).trim();
    }
    return null;
  }

  async waitForModal(name, timeout = 25000) {
    await this.modal(name).waitFor({ state: 'visible', timeout });
  }

  // "Is it gone?" has to be waited OUT, not sampled. isVisible() does not wait, so a read taken
  // while the closing transition is still running answers "still there" for a modal that closed
  // perfectly well.
  async waitForModalGone(name, timeout = 15000) {
    try {
      await this.modal(name).waitFor({ state: 'hidden', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // Confirm a modal is absent AND STAYS absent for a window.
  //
  // >>> `waitForModalGone()` ALONE IS NOT EVIDENCE OF ABSENCE. <<< It resolves the instant the
  // locator matches nothing, which is also true of a modal the app has not rendered YET - so on
  // a dashboard that is still painting it answers "gone" for a welcome modal about to appear a
  // second later, and three scenarios here would pass without asserting anything. Watching the
  // whole window is the only read that separates "it never came up" from "we looked too early";
  // it is the same distinction the promo module's saveStaysDisabled() exists to make.
  async modalStaysAbsent(name, windowMs = 4000) {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      if (await this.modal(name).isVisible().catch(() => false)) return false;
      await this.page.waitForTimeout(250);
    }
    return true;
  }

  async isModalDisplayed(name, timeout = 10000) {
    try {
      await this.modal(name).waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // ---- chrome shared by modals 2-4 ----

  closeIcon(name) {
    return this.modal(name)
      .locator('button[aria-label="Close" i], button[aria-label="Close dialog" i]')
      .first();
  }

  backArrow(name) {
    return this.modal(name).locator('button[aria-label="Back" i]').first();
  }

  async hasCloseIcon(name) {
    if (!(await this.closeIcon(name).count())) return false;
    return this.closeIcon(name).isVisible().catch(() => false);
  }

  async hasBackArrow(name) {
    if (!(await this.backArrow(name).count())) return false;
    return this.backArrow(name).isVisible().catch(() => false);
  }

  // ---------------------------------------------------------------------------------------
  // Navigation into the stack
  // ---------------------------------------------------------------------------------------

  // >>> WAITS FOR THE KPI ROW, NOT FOR domcontentloaded. <<< The dashboard is an SPA shell: the
  // document is "loaded" long before the widgets exist, so a KPI read taken straight after the
  // navigation finds NO node carrying the label at all - and `readKpi()` then reports
  // `value: null, candidates: []`, which reads as "the app renders no Total Candidates figure"
  // rather than "the suite looked too early". That is exactly how the first live run failed.
  // `load`/`networkidle` are not the fix either: this page holds connections open.
  async gotoDashboard() {
    await this.page.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
    await this.dashboardReady();
  }

  // >>> THE LABEL ARRIVES BEFORE THE FIGURE, AND THE PLACEHOLDER IS "-". <<< Waiting for the
  // "Total Candidates" label to appear is NOT enough: the widget renders with a literal `-` until
  // GET /candidate/stats/ answers, so a KPI read taken in between finds the label and a value of
  // "-" - which readKpi() then reports as `value: null`, i.e. "the app renders no figure". That
  // is how the live run failed with `label nodes: [{"raw":"-","numeric":false}]` on a dashboard
  // that shows 0 perfectly well a moment later. So readiness is "the first figure is numeric".
  //
  // Resolves false rather than throwing, so a caller inspecting a deliberately odd state still
  // gets to make its own assertion and report what it saw.
  async dashboardReady(timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const read = await this.readKpi('Total Candidates').catch(() => null);
      if (read && read.value !== null) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }

  async gotoCandidates() {
    await this.page.goto(this.candidatesUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.inviteCandidateCta().waitFor({ state: 'visible', timeout: 60000 });
  }

  // The label depends on the agent (product rule, 2026-10-15): an agent WITH candidates gets the
  // header's "Invite Candidate"; an agent with none gets only the empty state's "Invite Candidates".
  // Matching only the singular left gotoCandidates() waiting 60s for a button that never renders.
  inviteCandidateCta() {
    return this.page
      .locator('[data-testid="agent-invite-candidate-button"]')
      .or(this.page.getByRole('button', { name: /^\+?\s*invite candidates?$/i }))
      .first();
  }

  // The dashboard route: only reachable through the welcome modal, so only for an agent with
  // zero candidates.
  //
  // >>> IT HAS TO BE IDEMPOTENT, AND THAT IS WHY IT CLEARS THE FLAG. <<< The first dismissal in
  // a tab sets sessionStorage.agent_welcome_shown, and from then on the dashboard renders NO
  // onboarding control at all - so a second call would wait out the full timeout and report the
  // welcome modal missing, on an agent for which it works perfectly well. Steps that re-open the
  // chooser several times in one scenario (the card-and-text-link table drives it four times) hit
  // that on their second row. Clearing the per-tab flag and reloading is what makes the second
  // and fourth call behave like the first; it changes nothing server-side, because nothing about
  // the flag is server-side.
  // The flag is CONSULTED rather than the timeout waited out. Opening the chooser once sets
  // agent_welcome_shown, so on every later call the modal is never coming - and waiting 20s to
  // discover that cost ~24s per re-open, which the card-and-text-link table pays four times.
  // Reading the flag turns that into ~3s and says plainly why the reload is needed.
  async openChooserFromDashboard() {
    await this.gotoDashboard();
    if ((await this.welcomeSuppressionFlag()) || !(await this.isModalDisplayed('welcome', 20000))) {
      await this.clearWelcomeSuppression();
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForModal('welcome', 45000);
    }
    await this.onboardCandidatesButton.click();
    await this.waitForModal('chooser');
  }

  // The route every agent has.
  async openChooserFromCandidates() {
    await this.gotoCandidates();
    await this.inviteCandidateCta().click();
    await this.waitForModal('chooser');
  }

  methodSpec(method) {
    const spec = CandidateOnboardingPage.METHODS[method];
    if (!spec) {
      throw new Error(
        `Unknown onboarding method ${JSON.stringify(method)}. Known: `
        + Object.keys(CandidateOnboardingPage.METHODS).join(', ')
      );
    }
    return spec;
  }

  // One method's card. Layered off its test id; the fallback matches the card BUTTON by its
  // heading text rather than by class, because the two cards are class-identical.
  methodCard(method) {
    const spec = this.methodSpec(method);
    return this.chooserModal
      .locator(`[data-testid="${spec.testid}"]`)
      .or(this.chooserModal.locator('button').filter({ hasText: new RegExp(`^${method}`, 'i') }))
      .first();
  }

  // The underlined text link INSIDE each card ("Send onboarding invite" / "Share agent code").
  // It is a <span>, not a control of its own, so it is clicked as a target within the card —
  // which is what the story means by "from both its card and its text link".
  methodLink(method) {
    const spec = this.methodSpec(method);
    return this.methodCard(method)
      .locator('span')
      .filter({ hasText: new RegExp(`^${spec.link}$`, 'i') })
      .first();
  }

  async chooseMethod(method, { via = 'card' } = {}) {
    const spec = this.methodSpec(method);
    const target = via === 'link' ? this.methodLink(method) : this.methodCard(method);
    await target.click();
    await this.waitForModal(spec.opens);
    return spec.opens;
  }

  // ---------------------------------------------------------------------------------------
  // Dismissals
  // ---------------------------------------------------------------------------------------

  // An outside click. The overlay is the `div.fixed.inset-0` ANCESTOR of the dialog (measured
  // 2026-08-27), so a click at the very top-left of the viewport lands on it and not on any
  // control — which is what makes this a genuine "outside" click rather than a click on whatever
  // the page happens to render at that point. The modal is centred and at most 528px wide, so
  // (6, 6) is never over it at any viewport this suite runs.
  async clickOutsideModal() {
    await this.page.mouse.click(6, 6);
    await this.page.waitForTimeout(1200);
  }

  async pressEscape() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(1200);
  }

  // Close whatever modal is open, by whichever control it actually offers, and report which one
  // worked. For housekeeping only - the scenarios that assert a particular dismissal drive it
  // explicitly.
  //
  // >>> IT PREFERS THE X ICON, BECAUSE ESCAPE DOES NOT CLOSE EVERY MODAL HERE. <<< The welcome
  // modal and the chooser both go on Escape; the Share Agent Code modal does not, and an Escape
  // that quietly did nothing left the overlay up - which then swallowed the header avatar click
  // and made the sign-out helper fall back to clearing cookies. Trying the controls in order and
  // VERIFYING the modal is gone is what turns that from a silent no-op into a fact.
  async dismissOpenModal() {
    const key = await this.openModal();
    if (!key || key === 'unrecognised') return { dismissed: !key, how: null, modal: key };
    if (await this.hasCloseIcon(key)) {
      await this.closeIcon(key).click().catch(() => {});
      if (await this.waitForModalGone(key, 8000)) return { dismissed: true, how: 'X icon', modal: key };
    }
    await this.pressEscape();
    if (await this.waitForModalGone(key, 5000)) return { dismissed: true, how: 'Escape', modal: key };
    await this.clickOutsideModal();
    const gone = await this.waitForModalGone(key, 5000);
    return { dismissed: gone, how: gone ? 'outside click' : null, modal: key };
  }

  // ---------------------------------------------------------------------------------------
  // Share Agent Code
  // ---------------------------------------------------------------------------------------

  async readAgentCode() {
    await this.agentCodeText.waitFor({ state: 'visible', timeout: 20000 });
    return (await this.agentCodeText.innerText()).trim();
  }

  // The highlighted panel the code sits in — the innermost block holding BOTH the code and the
  // Copy control.
  codePanel() {
    return this.agentCodeModal
      .locator('div')
      .filter({ has: this.page.locator('[data-testid="agent-code-text-area"]') })
      .filter({ has: this.page.locator('[data-testid="agent-copy-code-button"]') })
      .last();
  }

  // "Centered" is asserted GEOMETRICALLY, not by reading the one Tailwind class we guessed at.
  // `items-center` is what the build uses today, but a class check can only ever answer "the
  // class I looked for is absent" — this repo has been caught by exactly that twice (the
  // disabled promo's greying, the save toast).
  async isCodeCentered() {
    const panelBox = await this.codePanel().boundingBox();
    const codeBox = await this.agentCodeText.boundingBox();
    if (!panelBox || !codeBox) {
      return { centered: false, reason: 'the code panel or the code itself has no bounding box' };
    }
    const offset = Math.abs((codeBox.x + codeBox.width / 2) - (panelBox.x + panelBox.width / 2));
    // 2px of tolerance for sub-pixel layout; anything left- or right-aligned is far outside it.
    return {
      centered: offset <= 2,
      offset: Math.round(offset * 100) / 100,
      panel: panelBox,
      code: codeBox,
      reason: offset <= 2 ? null : `the code sits ${Math.round(offset)}px off the panel's centre`,
    };
  }

  // Does the Copy control carry an icon as well as its label? Asserted as "an svg inside the
  // button", which is all a clipboard glyph can be here — the build inlines it with no title,
  // aria-label or class naming it.
  async copyButtonIconCount() {
    return this.copyCodeButton.locator('svg').count();
  }

  async copyButtonLabel() {
    return (await this.copyCodeButton.innerText()).trim();
  }

  async clickCopyCode() {
    await this.copyCodeButton.click();
  }

  // The clipboard, read back through the page. Needs clipboard-read/-write granted on the
  // origin; the step file does that on the context before it navigates.
  async readClipboard() {
    return this.page
      .evaluate(() => navigator.clipboard.readText())
      .catch((err) => `<<unreadable: ${err.message}>>`);
  }

  shareButton(platform) {
    const spec = CandidateOnboardingPage.PLATFORMS[platform];
    if (!spec) {
      throw new Error(
        `Unknown share platform ${JSON.stringify(platform)}. Known: `
        + Object.keys(CandidateOnboardingPage.PLATFORMS).join(', ')
      );
    }
    return this.agentCodeModal.getByRole('button', { name: spec.button }).first();
  }

  // Click one platform's control and report WHAT THE APP ASKED THE PLATFORM TO SHARE.
  //
  // >>> `popup.url()` IS NOT THE ANSWER TO THIS QUESTION, AND READING IT COST THIS SUITE A
  // MISDIAGNOSED APP DEFECT. <<< Every one of these controls is a `window.open(url, '_blank')`,
  // and the platform then redirects the popup wherever its own login and content rules send it.
  // So `popup.url()` reports where the BROWSER ENDED UP - a function of Facebook's sharer rules
  // and of whether this machine happens to hold a session on that network - not what the product
  // sent. Measured 2026-08-28 (`scripts/probe-agent-code-share-window-open.js`):
  //
  //   platform | the app asks for                                  | the popup lands on
  //   WhatsApp | wa.me/?text=...code: SZZZCE                       | api.whatsapp.com/send/?text=...SZZZCE
  //   Facebook | facebook.com/sharer/sharer.php?quote=...SZZZCE    | facebook.com/share_channel/?type=empty
  //   LinkedIn | linkedin.com/sharing/share-offsite/?url=...SZZZCE | linkedin.com/login?session_redirect=...SZZZCE
  //   X        | x.com/intent/tweet?text=...SZZZCE                 | x.com/intent/tweet?text=...SZZZCE
  //
  // All four carry the code on the way OUT. Facebook alone loses it on the way in, because
  // `sharer.php` shares a `u=` (a URL) and treats `quote=` as a comment ON that url - with no
  // `u=` there is nothing to share, so Facebook answers `share_channel/?type=empty` ("empty"
  // being its own term for a share carrying no content). Reading the landing url therefore
  // reported "the app passes no code to Facebook", which is false, and sent whoever read it to
  // the wrong half of the product. The real gap is the missing `u=`, reported as that.
  //
  // The recorder is installed on the page immediately BEFORE the click rather than as an init
  // script: by the time a modal is open the page has long since navigated, so an init script
  // would never run. The app resolves `window.open` at call time, so a late wrapper is read by
  // the very next click - verified live on all four platforms.
  //
  // The landing url is still captured, as EVIDENCE, and its own code check is reported
  // separately: it is what a human watching the popup sees, and the only thing that can show a
  // platform silently discarding the share.
  async share(platform, code, { timeout = 12000 } = {}) {
    const spec = CandidateOnboardingPage.PLATFORMS[platform];
    const context = this.page.context();

    await this.page.evaluate(() => {
      if (!window.__tfShareOpens) {
        window.__tfShareOpens = [];
        const real = window.open.bind(window);
        window.open = function (...args) {
          window.__tfShareOpens.push(args.map((a) => (a === undefined || a === null ? null : String(a))));
          return real(...args);
        };
      }
      window.__tfShareOpens.length = 0;
    });

    const popupPromise = context.waitForEvent('page', { timeout }).catch(() => null);
    await this.shareButton(platform).click();
    const popup = await popupPromise;
    const requestedUrl = await this.page.evaluate(() => {
      const calls = window.__tfShareOpens || [];
      return calls.length ? calls[0][0] : null;
    });

    let landedOn = null;
    if (popup) {
      // A short settle only. The old 1500ms wait existed to let the platform's url commit, which
      // is precisely the redirect this reader no longer depends on - so there is nothing to be
      // gained by holding four real social hosts open any longer than it takes to read one url.
      landedOn = popup.url();
      await popup.waitForTimeout(700).catch(() => {});
      landedOn = popup.url();
      await popup.close().catch(() => {});
    }

    // Neither reading answers this on its own: an app that opened nothing at all leaves both
    // null, and that must stay distinguishable from an app that opened the wrong place.
    const asked = requestedUrl || landedOn;
    const decoded = CandidateOnboardingPage.decodeDeep(asked);
    const landedDecoded = CandidateOnboardingPage.decodeDeep(landedOn);
    const holdsCode = (u) => !!code && !!u && u.toUpperCase().includes(String(code).toUpperCase());

    return {
      platform,
      opened: !!popup || !!requestedUrl,
      requestedUrl,
      requestedFromWindowOpen: !!requestedUrl,
      landedOn,
      // `url` / `decoded` keep the names the steps already read, and now hold what the APP asked.
      url: asked,
      decoded,
      landedDecoded,
      reachedPlatform: !!asked && spec.host.test(asked),
      carriesCode: holdsCode(decoded),
      landingCarriesCode: holdsCode(landedDecoded),
    };
  }

  // Share urls are percent-encoded, and two platforms encode them twice - LinkedIn and X wrap the
  // share url inside a login redirect, so the code sits behind two rounds of encoding.
  static decodeDeep(url) {
    let decoded = url;
    for (let i = 0; i < 4; i++) {
      let next;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        break;
      }
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  }

  // ---------------------------------------------------------------------------------------
  // The dashboard behind the modal
  // ---------------------------------------------------------------------------------------

  // One KPI widget's value.
  //
  // >>> "Active Candidates" AND "Requires Attention" EACH APPEAR TWICE ON THE PAGE <<< — once as
  // a KPI label and once as the heading of a list section further down (measured 2026-08-27). So
  // the label alone cannot identify the widget. The KPI is the one whose label <p> is IMMEDIATELY
  // FOLLOWED by a sibling holding a number; the section headings have no such sibling. Read
  // structurally in the page rather than by class, so the palette/size classes stay free to
  // change. Every candidate found is returned, so a failure can say what the alternatives were.
  async readKpi(label) {
    return this.page.evaluate((wanted) => {
      const found = [];
      for (const el of document.querySelectorAll('p, h3, h4')) {
        if ((el.textContent || '').trim() !== wanted) continue;
        const next = el.nextElementSibling;
        const raw = next ? (next.textContent || '').trim() : null;
        found.push({ raw, numeric: raw !== null && /^-?[\d,]+$/.test(raw) });
      }
      const kpi = found.find((f) => f.numeric);
      return { label: wanted, value: kpi ? kpi.raw : null, candidates: found };
    }, label);
  }

  // Wait for one KPI's figure to settle, then return it. The widgets render a literal "-" until
  // their stats request answers (see dashboardReady), so a single read is not evidence: reporting
  // that placeholder as a missing figure would name the wrong defect. On timeout it returns the
  // last read WITH the placeholder in `candidates`, so a genuinely absent figure is still
  // reportable and says what was on screen instead.
  async readKpiWhenSettled(label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    let read = await this.readKpi(label);
    while (read.value === null && Date.now() < deadline) {
      await this.page.waitForTimeout(500);
      read = await this.readKpi(label);
    }
    return read;
  }

  async readAllKpis() {
    const out = {};
    for (const label of CandidateOnboardingPage.KPIS) out[label] = await this.readKpiWhenSettled(label);
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // Do the KPI widgets route anywhere?
  // ---------------------------------------------------------------------------------------

  // The story's widget names mapped onto what the build renders, the same way MODALS maps the
  // story's modal names and CommunityPage.FILTER_TRIGGER_LABELS maps the filter names. TFF-36's
  // fourth widget is "Pending Verifications"; the dashboard renders "Requires Attention" (there
  // is no widget by the story's name at all - measured 2026-08-28). Keeping the Gherkin in the
  // story's words and resolving here means the divergence is recorded in one place instead of
  // being silently absorbed by editing the feature file.
  static KPI_STORY_LABELS = {
    'Total Candidates': 'Total Candidates',
    'Active Candidates': 'Active Candidates',
    'Onboarding in Progress': 'Onboarding in Progress',
    'Pending Verifications': 'Requires Attention',
    'Requires Attention': 'Requires Attention',
  };

  // Where each documented destination lives. An unknown destination THROWS naming the known set,
  // rather than being treated as "no expectation" - a typo in a feature file must not become a
  // scenario that passes having compared nothing.
  // ONE map, shared by the KPI table and the "View all" table, so a destination is spelled in a
  // single place. The `?` alternative matters: every "View all" appends a filter param
  // (`?activeFilter=...`), so an anchored `$`-only pattern would reject a correct landing.
  static KPI_DESTINATIONS = {
    'Candidates > Active': /\/candidates\/active(\?|$)/,
    'Candidates > In Progress': /\/candidates\/in-progress(\?|$)/,
    'Candidates > Requires Attention': /\/candidates\/requires-attention(\?|$)/,
    'Verifications': /\/verifications(\?|$)/,
  };

  static kpiDestination(name) {
    const spec = CandidateOnboardingPage.KPI_DESTINATIONS[name];
    if (!spec) {
      throw new Error(
        `Unknown KPI destination ${JSON.stringify(name)}. Known: `
        + Object.keys(CandidateOnboardingPage.KPI_DESTINATIONS).map((k) => JSON.stringify(k)).join(', ')
      );
    }
    return spec;
  }

  // ---------------------------------------------------------------------------------------
  // The dashboard's section cards and their "View all" links
  //
  // >>> EVERY "View all" IS A BARE <span> WITH A REACT onClick - NO <button>, NO role, NO href,
  // NO tabindex, NO test id. <<< (Measured 2026-09-09.) Two consequences, and the first one is
  // why this coverage did not exist until now:
  //   1. `getByRole('link'|'button')` finds NOTHING. A dump of every button/a/[role] in <main>
  //      on this dashboard returns 46 controls and not one of them is a "View all" - so a
  //      role-based reader reports the links as absent on a dashboard that plainly shows three.
  //      They are found by TEXT and then verified to carry an onClick instead.
  //   2. They are not keyboard focusable and are invisible to assistive technology. Same defect
  //      class as the candidate-profile upload controls being bare `<svg class="add-icon">`.
  //      `viewAllLinks()` reports the whole ancestor chain so that finding is assertable.
  //
  // The card each link belongs to is derived by climbing to the nearest ancestor whose text
  // carries one of the known card headings - the links themselves are identical, so position in
  // the DOM is the only thing that distinguishes them, and two cards sit side by side at the same
  // y. Measured live: Document Verification Queue -> /verifications, Requires Attention ->
  // /candidates/requires-attention, Active Candidates -> /candidates/active.
  //
  // NOTE "Active Candidates" and "Requires Attention" EACH APPEAR TWICE on the dashboard - once
  // as a top-row KPI tile (label followed by a bare number) and once as a section card heading
  // (followed by "37 Candidates" / "17 Items"). So a label-only locator cannot tell a tile from a
  // card. readKpi() keys on the bare number; this keys on the card owning a "View all".
  // ---------------------------------------------------------------------------------------
  static VIEW_ALL_CARDS = ['Document Verification Queue', 'Requires Attention', 'Active Candidates'];

  // Every "View all" on the dashboard: which card owns it, and whether it is a real control.
  // >>> THE SET READ HERE AND THE SET CLICKED IN followViewAll() MUST BE THE SAME ONE. <<<
  // Scoped to leaf `main span`s so it matches `main span:text-is("View all")` element for element
  // and in the same DOM order - `index` is then usable as an `.nth()`. The first version of this
  // read `main *` and clicked `main *` filtered by text, which ALSO matched each span's wrapping
  // `div` (its whole text is "View all" too): the click list was twice as long, so cards 2 and 3
  // clicked card 1's and card 2's links and the step reported the product as routing to the wrong
  // pages. Exactly the trap resolveFilterPopover() exists to avoid in the community module.
  async viewAllLinks() {
    return this.page.evaluate((cards) => {
      const links = [];
      const spans = [...document.querySelectorAll('main span')]
        .filter((e) => !e.children.length && (e.textContent || '').trim() === 'View all');
      for (const el of spans) {
        let host = el;
        let card = null;
        for (let i = 0; i < 8 && host; i++) {
          host = host.parentElement;
          if (!host) break;
          const text = (host.innerText || '').replace(/\s+/g, ' ');
          const hit = cards.find((c) => text.includes(c));
          // The first ancestor naming exactly ONE known card is that card; keep climbing while
          // the host still spans several (the row wrapping two cards names both).
          if (hit && cards.filter((c) => text.includes(c)).length === 1) { card = hit; break; }
          if (hit) { card = hit; }
        }
        const chain = [];
        let h = el;
        for (let i = 0; i < 6 && h && h.tagName !== 'MAIN' && h.tagName !== 'BODY'; i++) {
          const cs = getComputedStyle(h);
          const k = Object.keys(h).find((x) => x.startsWith('__reactProps'));
          chain.push({
            hop: i, tag: h.tagName, role: h.getAttribute('role'), href: h.getAttribute('href'),
            tabindex: h.getAttribute('tabindex'), testid: h.getAttribute('data-testid'),
            cursor: cs.cursor, onClick: k ? typeof h[k].onClick === 'function' : null,
          });
          h = h.parentElement;
        }
        // >>> FOCUSABILITY IS MEASURED, NOT INFERRED FROM THE MARKUP. <<< `el.tabIndex` is the
        // browser's own answer, and `focus()` followed by an activeElement check is the strongest
        // evidence available in-page: a <span> with no tabindex cannot be focused even
        // programmatically, so a keyboard user has no route to it at all. Reported alongside the
        // tabbable set the browser would actually walk, so the failure message carries evidence
        // rather than a conclusion.
        const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
          + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
        el.focus();
        const programmaticFocusable = document.activeElement === el;
        if (programmaticFocusable) el.blur();

        const r = el.getBoundingClientRect();
        links.push({
          card,
          index: links.length,
          tag: el.tagName,
          y: Math.round(r.top + window.scrollY),
          // A real control by the only definitions that make it keyboard- and AT-reachable.
          isRealControl: chain.some((c) => (c.tag === 'A' && c.href) || c.tag === 'BUTTON' || c.role === 'button' || c.role === 'link'),
          focusable: chain.some((c) => c.tag === 'A' || c.tag === 'BUTTON' || (c.tabindex !== null && c.tabindex !== '-1')),
          clickable: chain.some((c) => c.onClick === true || c.cursor === 'pointer'),
          tabIndexProp: el.tabIndex,
          programmaticFocusable,
          inTabbableSet: el.matches(TABBABLE) || !!el.closest(TABBABLE),
          // The styling anticipates a focus state the markup can never produce - the clearest
          // signal that this is an oversight rather than a deliberate choice, and the most useful
          // thing to hand dev.
          stylesAFocusRing: /focus-visible:/.test(el.className || ''),
          chain,
        });
      }
      return links;
    }, CandidateOnboardingPage.VIEW_ALL_CARDS);
  }

  // Click one card's "View all" and report where it landed AND what rendered there. The URL alone
  // is not enough - a route that resolves to a blank shell would pass a url-only check, and
  // "redirects to the correct page" is the thing being asserted.
  async followViewAll(card, { settle = 8000 } = {}) {
    await this.gotoDashboard();
    const links = await this.viewAllLinks();
    const match = links.filter((l) => l.card === card);
    const result = {
      card,
      offered: links.map((l) => l.card),
      found: match.length === 1,
      duplicates: match.length > 1 ? match.length : null,
      from: this.page.url(),
      navigated: false,
      landedOn: null,
    };
    if (match.length !== 1) return result;

    // Indexed off the SAME pass that produced `links` - see the note on viewAllLinks().
    const target = this.page.locator('main span:text-is("View all")').nth(match[0].index);

    // >>> THE RESOLVED ELEMENT IS CHECKED AGAINST THE CARD THAT WAS ASKED FOR, BEFORE CLICKING.
    // <<< Without this, an index that drifts by one produces a perfectly plausible "it routes to
    // the wrong page" failure - which is what the first version of this method actually reported.
    // A locator problem must never be presentable as a product defect.
    result.resolvedCard = await target
      .evaluate((el, cards) => {
        let host = el;
        let card = null;
        for (let i = 0; i < 8 && host; i++) {
          host = host.parentElement;
          if (!host) break;
          const text = (host.innerText || '').replace(/\s+/g, ' ');
          const hits = cards.filter((c) => text.includes(c));
          if (hits.length === 1) return hits[0];
          if (hits.length) card = hits[0];
        }
        return card;
      }, CandidateOnboardingPage.VIEW_ALL_CARDS)
      .catch(() => null);
    if (result.resolvedCard !== card) {
      throw new Error(
        `Refusing to click: the "View all" at index ${match[0].index} belongs to `
        + `${JSON.stringify(result.resolvedCard)}, not to ${JSON.stringify(card)}. That is a `
        + 'locator fault in this page object, NOT a routing defect - the reader and the click '
        + 'have resolved different element sets. See the note on viewAllLinks().'
      );
    }

    result.clickError = await target
      .click({ timeout: 10000 })
      .then(() => null)
      .catch((err) => err.message.split('\n')[0]);
    await this.page.waitForURL((u) => u.href !== result.from, { timeout: settle }).catch(() => {});
    result.landedOn = this.page.url();
    result.navigated = result.landedOn !== result.from;
    if (result.navigated) Object.assign(result, await this.readListingSurface());
    return result;
  }

  // What a listing page rendered: enough to tell a real listing from a blank shell, and recorded
  // as evidence either way. An EMPTY listing is legitimate, so the absence of rows is not itself
  // a failure - `rendered` is what the assertion uses.
  async readListingSurface() {
    await this.page.waitForTimeout(2500);
    return this.page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main ? (main.innerText || '').replace(/\n+/g, ' | ') : '';
      const rows = document.querySelectorAll('[role="row"]').length;
      return {
        rows,
        emptyState: /no candidates|no documents|no results|nothing to/i.test(text),
        rendered: rows > 0 || /no candidates|no documents|no results|nothing to/i.test(text),
        excerpt: text.slice(0, 240),
      };
    });
  }

  // Is this KPI a CONTROL at all, and if so what kind?
  //
  // >>> "IT IS NOT CLICKABLE" AND "IT IS CLICKABLE AND GOES SOMEWHERE ELSE" ARE DIFFERENT
  // FINDINGS, AND ONLY ONE OF THEM IS A ROUTING BUG. <<< A click that changes no url cannot tell
  // them apart, so the interactivity of the widget's whole ancestor chain is read first: an
  // `<a href>`, a `<button>`, a `role="button"`, a `tabindex`, `cursor: pointer`, or a React
  // `onClick` prop (React attaches one listener at the root, so `el.onclick` is always null here
  // and the props key is the only place a handler is visible). Whatever it finds is reported, so
  // a red row says WHY the widget did not route.
  //
  // The widget is found by the same structural rule readKpi() uses - a label node whose next
  // sibling holds a number - because the labels are plain `<p>`s with no test id, and two of them
  // ("Active Candidates", "Requires Attention") appear again lower down as list-section headings.
  async inspectKpiWidget(renderedLabel) {
    return this.page.evaluate((wanted) => {
      let node = null;
      for (const el of document.querySelectorAll('p, h1, h2, h3, h4, span, div')) {
        if (el.children.length || (el.textContent || '').trim() !== wanted) continue;
        const next = el.nextElementSibling;
        if (next && /^-?[\d,]+$/.test((next.textContent || '').trim())) { node = el; break; }
      }
      if (!node) {
        // Every label/figure pair actually on the page, so a missing widget names the real set.
        const rendered = [];
        for (const el of document.querySelectorAll('p, h1, h2, h3, h4, span, div')) {
          if (el.children.length) continue;
          const t = (el.textContent || '').trim();
          if (!t || t.length > 40) continue;
          const next = el.nextElementSibling;
          if (next && /^-?[\d,]+$/.test((next.textContent || '').trim())) rendered.push(t);
        }
        return { found: false, renderedWidgets: [...new Set(rendered)] };
      }
      const chain = [];
      let host = node;
      for (let i = 0; i < 8 && host && host.tagName !== 'MAIN' && host.tagName !== 'BODY'; i++) {
        const cs = getComputedStyle(host);
        const propsKey = Object.keys(host).find((k) => k.startsWith('__reactProps'));
        chain.push({
          hop: i,
          tag: host.tagName,
          role: host.getAttribute('role'),
          href: host.getAttribute('href'),
          tabindex: host.getAttribute('tabindex'),
          testid: host.getAttribute('data-testid'),
          cursor: cs.cursor,
          onClick: propsKey ? typeof host[propsKey].onClick === 'function' : null,
        });
        host = host.parentElement;
      }
      const interactive = chain.find((c) => c.tag === 'A' && c.href
        || c.tag === 'BUTTON' || c.role === 'button' || c.onClick === true
        || c.cursor === 'pointer' || (c.tabindex !== null && c.tabindex !== '-1'));
      return {
        found: true,
        value: (node.nextElementSibling.textContent || '').trim(),
        interactive: interactive || null,
        chain,
      };
    }, renderedLabel);
  }

  // Click one KPI widget and report where it went.
  //
  // Re-navigates to the dashboard first, because the previous widget's click may have left the
  // page - and reads the figures out before clicking, since the widgets render a literal "-"
  // until the stats request answers and a control wired up on data arrival would not respond to a
  // click aimed at the placeholder.
  async followKpi(storyLabel, { settle = 3000 } = {}) {
    const renderedLabel = CandidateOnboardingPage.KPI_STORY_LABELS[storyLabel] || storyLabel;
    await this.gotoDashboard();
    const probe = await this.inspectKpiWidget(renderedLabel);
    const result = {
      widget: storyLabel,
      renderedLabel,
      renamedByTheBuild: renderedLabel !== storyLabel,
      ...probe,
      from: this.page.url(),
      navigated: false,
      landedOn: null,
    };
    if (!probe.found) return result;

    const target = this.page
      .locator(`p:text-is(${JSON.stringify(renderedLabel)}), span:text-is(${JSON.stringify(renderedLabel)})`)
      .first();
    await target.scrollIntoViewIfNeeded().catch(() => {});
    // A click on the label bubbles to any handler on its card - React's listener is at the root -
    // so this reaches an ancestor's onClick without having to guess which ancestor owns it.
    result.clickError = await target
      .click({ timeout: 8000 })
      .then(() => null)
      .catch((err) => err.message.split('\n')[0]);
    await this.page.waitForURL((u) => u.href !== result.from, { timeout: settle }).catch(() => {});
    result.landedOn = this.page.url();
    result.navigated = result.landedOn !== result.from;
    return result;
  }

  // The dashboard's own empty states, quoted verbatim. Collected as whatever is on the page
  // rather than searched for by the wording we hoped to find — the community module's
  // probe-community-empty-states.js exists for exactly that reason.
  async readDashboardEmptyStates() {
    return this.page.evaluate(() => {
      const known = [
        'No candidates yet',
        'Nothing needs your attention right now',
        'No documents to review yet',
        'No data available',
      ];
      const seen = [];
      for (const el of document.querySelectorAll('p, h3, h4, span, div')) {
        if (el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (t && known.includes(t)) seen.push(t);
      }
      return [...new Set(seen)];
    });
  }

  // ---------------------------------------------------------------------------------------
  // The welcome modal's suppression flag
  // ---------------------------------------------------------------------------------------

  async welcomeSuppressionFlag() {
    return this.page.evaluate(() => {
      try {
        return sessionStorage.getItem('agent_welcome_shown');
      } catch {
        return '<<sessionStorage unreadable>>';
      }
    });
  }

  // Drop the per-tab flag so the next sign-in is judged on the app's own rule (does this agent
  // have candidates?) rather than on this tab's leftover state. Every step that claims to start
  // a NEW session calls this; without it "the modal did not come back" is true whatever the app
  // does, and the assertion is worthless.
  async clearWelcomeSuppression() {
    await this.page.evaluate(() => {
      try {
        sessionStorage.removeItem('agent_welcome_shown');
      } catch {
        /* nothing to clear */
      }
    });
  }

  // =========================================================================================
  // The bulk CSV upload zone
  //
  // Everything here was measured on 2026-08-27 against the live modal; the probes are
  // scripts/probe-bulk-upload-modal.js (structure + template download),
  // scripts/probe-bulk-upload-states.js (what each class of file leaves behind) and
  // scripts/probe-bulk-upload-formats.js (the accept/reject table, drag-and-drop, and where a
  // server refusal surfaces). None of them sends an invitation.
  //
  // TWO THINGS DECIDE HOW EVERY METHOD BELOW IS WRITTEN:
  //
  //   1. THE ZONE ANIMATES A FAKE PROGRESS BAR AND FIRES NO REQUEST WHILE IT RUNS. The card
  //      reads "good.csv | 62% - 2 seconds remaining" for about two seconds and only then
  //      settles to "good.csv | 0.0 MB"; Send Invites stays DISABLED throughout. So a read taken
  //      straight after setInputFiles() sees a disabled button and a file that looks refused -
  //      the exact shape of the document-upload bug recorded in CLAUDE.md, where a 500ms wait
  //      returned at 13% and the entry was saved with no document. waitForUploadSettled() waits
  //      for the settled state, never a fixed delay.
  //   2. THE DROP TARGET AND THE FILE CARD ARE THE SAME SLOT. Choosing a file replaces the drop
  //      target - and the <input type="file"> inside it - with the card, so uploading a second
  //      file without removing the first times out on a locator that no longer exists.
  // =========================================================================================

  // Has the zone settled? "Settled" means a file card with a SIZE and no percentage/countdown,
  // or no file at all. Read as text because the progress line is the only signal the app gives -
  // there is no request to wait on and no attribute that flips.
  async uploadSettled() {
    const text = await this.csvZone.innerText().catch(() => '');
    return !/%|remaining/i.test(text);
  }

  async waitForUploadSettled(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.uploadSettled()) {
        // One more beat: the card's size line and the Send button settle a frame apart.
        await this.page.waitForTimeout(400);
        return true;
      }
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  // The file card, derived STRUCTURALLY from the one control only it has: the Delete button.
  //
  // >>> A CLASS-BASED READER PICKED UP THE WRONG NODE, AND THIS IS WHY THE CARD IS FOUND THIS
  // WAY. <<< The first version read `p.text-sm.font-bold` inside the zone - which also matches
  // the "Upload Instructions:" HEADING, because that block sits INSIDE the dropzone container.
  // So with no file uploaded the reader answered "Upload Instructions:", and a run reported seven
  // correctly-refused files as ACCEPTED and an oversized file as "still being held". A locator
  // that can resolve to page furniture is worse than one that resolves to nothing, because the
  // failure it produces describes a defect the app does not have.
  fileCard() {
    return this.csvZone
      .locator('li')
      .filter({ has: this.page.locator('button[aria-label="Delete"]') })
      .first();
  }

  // The name the zone displays for the file it is holding, or null. Read from the card rather
  // than by looking for the name that was uploaded: a reader that searches for the expected
  // string can only ever answer "absent", and could never catch the app displaying a DIFFERENT
  // name - the same reasoning as readDiscountLine() in the promo module.
  // >>> THE CARD'S TWO LINES ARE NOT <p>. <<< Both readers below used to query
  // `card.locator('p')`, and the card renders each line as a React-Aria
  // <button><span> — so the name and the size came back null on a card that was
  // plainly on screen, holding the right file, with Send Invites correctly
  // enabled and the drop target correctly swapped out.
  //
  // That combination is what made it look like a product bug: the step reported
  // "the zone is not holding a file - no file card is rendered" while the app had
  // accepted the upload perfectly. `fileCard()` was never at fault (it keys off
  // the Delete button, which is a real control) — only the text read was.
  //
  // Read the card's innerText and split it: line 0 is the file name, line 1 the
  // size or the mid-upload progress. Same fault as ActiveCandidatePage and
  // InProgressCandidatePage — the app moved off <p> across these surfaces.
  async cardLines() {
    const card = this.fileCard();
    if (!(await card.count())) return null;
    return (await card.innerText().catch(() => ''))
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async uploadedFileName() {
    const lines = await this.cardLines();
    if (!lines) return null;
    return lines[0] || null;
  }

  // The size/progress line under the name ("0.0 MB", or "63% - 2 seconds remaining" mid-upload).
  async uploadedFileMeta() {
    const lines = await this.cardLines();
    if (!lines) return null;
    return lines.length > 1 ? lines[1] : null;
  }

  async hasUploadedFile() {
    if (!(await this.csvRemoveButton.count())) return false;
    return this.csvRemoveButton.isVisible().catch(() => false);
  }

  // The zone's own error line. Deliberately NOT matched against an expected wording: the two
  // messages the app renders ("This file type is not allowed..." / "This file is too large...")
  // are not the ones the AC quotes, and a locator built from the AC's strings would report every
  // real rejection as "no error displayed" - sending whoever reads the report after the wrong
  // bug. Collected structurally instead, and compared in the step.
  async zoneError() {
    const lines = (await this.csvZone.innerText().catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const known = /not allowed|too large|invalid|exceeds|must be|unsupported|failed/i;
    const hit = lines.find((l) => known.test(l));
    return hit || null;
  }

  // Where that error sits relative to the drop area. The AC asks for it "immediately below the
  // upload area", which is geometry, not DOM order - so it is measured as geometry: the gap
  // between the drop target's bottom edge and the error's top edge, in CSS pixels. Reported
  // rather than thresholded here, so the step decides what "immediately" means and the number
  // reaches the report either way.
  async errorGeometry() {
    const message = await this.zoneError();
    if (!message) return { message: null };
    const node = this.csvZone.getByText(message, { exact: false }).first();
    const [zone, drop, err] = await Promise.all([
      this.csvZone.boundingBox().catch(() => null),
      this.csvDropTarget.boundingBox().catch(() => null),
      node.boundingBox().catch(() => null),
    ]);
    const insideZone = await node.evaluate(
      (el, id) => !!el.closest(`[data-testid="${id}"]`),
      'agent-invite-csv-dropzone'
    ).catch(() => null);
    return {
      message,
      insideUploadZone: insideZone,
      dropAreaBottom: drop ? Math.round(drop.y + drop.height) : null,
      errorTop: err ? Math.round(err.y) : null,
      gapPx: drop && err ? Math.round(err.y - (drop.y + drop.height)) : null,
      zoneBox: zone ? { y: Math.round(zone.y), height: Math.round(zone.height) } : null,
    };
  }

  // The modal-level notice the app raises when BOTH a chip and a file are present. Measured
  // 2026-08-27: "You can only use one option at a time. Remove the emails or the uploaded file.",
  // with Send Invites DISABLED. The two input methods are mutually exclusive by design.
  async mutualExclusionError() {
    if (!(await this.oneOptionError.count())) return null;
    if (!(await this.oneOptionError.isVisible().catch(() => false))) return null;
    return (await this.oneOptionError.innerText()).trim();
  }

  // Choose a file through the input the "Click to upload" control is labelled for.
  //
  // setInputFiles() rather than a click + filechooser on purpose: the visible control is a
  // <button> inside a <label for>, so a click opens the OS picker, which Playwright can only
  // intercept through the filechooser event - more moving parts for the same result, and the
  // suite already has a recorded bug (the community cover upload) caused by getByRole('button')
  // resolving to a sr-only file input instead of the real control.
  async uploadCsv(filePath, { replace = true } = {}) {
    if (replace && (await this.hasUploadedFile())) await this.removeCsv();
    await this.csvFileInput.waitFor({ state: 'attached', timeout: 20000 });
    await this.csvFileInput.setInputFiles(filePath);
    await this.waitForUploadSettled();
    return this.uploadState();
  }

  // Drag and drop, which is a genuinely different code path from the input: the zone listens for
  // dragenter/dragover/drop on [data-dropzone] and reads the DataTransfer, so a file that arrives
  // this way never touches the <input>. The file's bytes are carried across into the page as
  // base64 and rebuilt as a real File there - the only way to hand a browser a file it did not
  // pick itself.
  async dropCsv(filePath) {
    const fs = require('fs');
    const path = require('path');
    if (await this.hasUploadedFile()) await this.removeCsv();
    const name = path.basename(filePath);
    const b64 = fs.readFileSync(filePath).toString('base64');
    const type = name.endsWith('.csv') ? 'text/csv'
      : name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/octet-stream';
    const dataTransfer = await this.page.evaluateHandle((f) => {
      const dt = new DataTransfer();
      const bin = atob(f.b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
      dt.items.add(new File([arr], f.name, { type: f.type }));
      return dt;
    }, { b64, name, type });
    await this.csvDropTarget.dispatchEvent('dragenter', { dataTransfer });
    await this.csvDropTarget.dispatchEvent('dragover', { dataTransfer });
    await this.csvDropTarget.dispatchEvent('drop', { dataTransfer });
    await this.waitForUploadSettled();
    return this.uploadState();
  }

  async removeCsv() {
    if (!(await this.hasUploadedFile())) return false;
    await this.csvRemoveButton.click();
    // The drop target comes back in place of the card; wait for the control, not a timeout.
    await this.csvUploadButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(300);
    return true;
  }

  // One read of everything an upload assertion needs, taken together so a report shows a single
  // consistent picture of the zone rather than four reads taken at four different moments.
  async uploadState() {
    return {
      fileName: await this.uploadedFileName(),
      fileMeta: await this.uploadedFileMeta(),
      error: await this.zoneError(),
      mutualExclusionError: await this.mutualExclusionError(),
      sendInvitesEnabled: await this.sendInvitesButton.isEnabled().catch(() => null),
      dropTargetVisible: await this.csvDropTarget.isVisible().catch(() => false),
    };
  }

  // The template link. Returns the download plus the href, because the href is the part that
  // says WHICH file the app offers - a download event alone would pass on any file at all.
  async downloadTemplate(timeout = 30000) {
    const href = await this.downloadTemplateLink.getAttribute('href');
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout }).catch(() => null),
      this.downloadTemplateLink.click(),
    ]);
    return { href, download };
  }

  // The three bullet points under "Upload Instructions:", as rendered.
  // ---------------------------------------------------------------------------------------
  // The email chip field
  //
  // >>> COMMIT KEYS, MEASURED - Enter, Tab and comma commit; SPACE DOES NOT. <<<
  // (scripts/probe-invite-chip-rules.js, 2026-08-29.) A Space leaves the address in the input with
  // a trailing space and creates no chip. TFF-36 lists Space as a commit key, so addChip() REPORTS
  // what it observed rather than throwing: a step that threw here would say "the suite could not
  // enter an email" for what is a product divergence. The scenario decides; this only measures.
  // ---------------------------------------------------------------------------------------

  // Every committed address, in render order, read off the remove buttons' aria-labels.
  async readChips() {
    return this.chipRemoveButtons.evaluateAll((els) =>
      els.map((e) => (e.getAttribute('aria-label') || '').replace(/^Removes*/, '').trim()).filter(Boolean)
    );
  }

  async chipCount() {
    return this.chipRemoveButtons.count();
  }

  async inviteInputValue() {
    return this.inviteEmailInput.inputValue().catch(() => null);
  }

  // Every inline error currently on the chip field, verbatim.
  async inviteErrors() {
    return this.inviteFieldError.allInnerTexts().catch(() => []);
  }

  async chipFieldState() {
    return {
      chips: await this.readChips(),
      inputValue: await this.inviteInputValue(),
      errors: await this.inviteErrors(),
      sendInvitesEnabled: await this.sendInvitesButton.isEnabled().catch(() => null),
    };
  }

  // Type one address and try to commit it. Returns what the field looks like AFTERWARDS - chips,
  // the residue left in the input, the errors raised, and the Send Invites state - so one
  // observation answers both "was it accepted" and "was it refused, and how".
  //
  // `key`: 'Enter' | 'Tab' | 'Space' | ',' | null (type only, commit nothing).
  async addChip(email, key = 'Enter') {
    await this.inviteEmailInput.click();
    await this.inviteEmailInput.fill(email);
    if (key) await this.inviteEmailInput.press(key === 'Space' ? ' ' : key);
    // The field re-renders on commit; 400ms is comfortably past it and keeps a 12-row table fast.
    await this.page.waitForTimeout(400);
    return this.chipFieldState();
  }

  // Paste rather than type. `insertText` fires ONE input event and no keydowns, so it is a
  // genuinely different code path from typing - which is the point: a per-keystroke validator
  // would let a pasted address straight through. A dispatched ClipboardEvent is untrusted and
  // performs no default action, so it is not usable here - see what that cost pasteAbout().
  async pasteChip(email, key = 'Enter') {
    await this.inviteEmailInput.click();
    await this.inviteEmailInput.fill('');
    await this.page.keyboard.insertText(email);
    await this.page.waitForTimeout(200);
    if (key) await this.inviteEmailInput.press(key === 'Space' ? ' ' : key);
    await this.page.waitForTimeout(400);
    return this.chipFieldState();
  }

  // Remove one chip by the address it carries. Matched EXACTLY on the aria-label, never with a
  // substring filter: "dupe@university.edu" is a substring of "not.dupe@university.edu", and this
  // repo has been bitten three times by a substring locator resolving to a neighbour.
  async removeChip(email) {
    const button = this.inviteModal.locator(`button[aria-label="Remove ${email}"]`).first();
    if (!(await button.count())) {
      throw new Error(
        `No chip for ${JSON.stringify(email)} to remove. The field holds: ${JSON.stringify(await this.readChips())}.`
      );
    }
    await button.click();
    await this.page.waitForTimeout(300);
    return this.readChips();
  }

  // Clear the field by removing chips one at a time. Always removes the FIRST remaining chip and
  // re-resolves, because each removal re-renders the list - holding a stale handle across a
  // re-render is how the profile combobox detached mid-click.
  async clearChips(max = 40) {
    for (let i = 0; i < max; i += 1) {
      const first = this.chipRemoveButtons.first();
      if (!(await first.count())) break;
      await first.click();
      await this.page.waitForTimeout(200);
    }
    await this.inviteEmailInput.fill('').catch(() => {});
    await this.page.waitForTimeout(200);
    return this.readChips();
  }

  async readUploadInstructions() {
    if (!(await this.uploadInstructionsHeading.count())) return null;
    const items = await this.uploadInstructionItems.allInnerTexts();
    return items.map((t) => t.trim()).filter(Boolean);
  }
}

module.exports = CandidateOnboardingPage;
