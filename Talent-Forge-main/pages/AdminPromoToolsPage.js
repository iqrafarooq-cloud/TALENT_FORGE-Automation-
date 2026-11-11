const BasePage = require('./BasePage');

// The single endpoint every promo-parameter save goes through (captured live 2026-07-30):
//   PATCH /core/api/v1/agents/<agentId>/promotion/  {"expiry_date":"…","usage_limit":…, …}
// Used by backdateExpiry() to rewrite one field of the app's own request.
const PROMOTION_ENDPOINT = /\/core\/api\/v1\/agents\/\d+\/promotion\/?$/;

// AdminPromoToolsPage — Page Object for the SUPERADMIN side of TFF-467:
// Agents > <agent> > Promo Tools, and its "Edit Code Parameters" modal. This is where
// each agent's unique promo code is configured (status / incentive type / value /
// expiry / usage limit); the agent dashboard renders it read-only.
//
// IMPORTANT — this page needs its own browser context. Verified live 2026-07-28: the
// app keeps ONE session per context, and an agent session hitting /agents/view/<id> is
// bounced to /unauthorized. The steps therefore open a second context for this role
// rather than logging out and back in.
//
// Live DOM (2026-07-28):
//   Agents list          /agents          searchbox "Search by agent name...", row actions View/Edit
//   Agent detail         /agents/view/<id>  radio tabs: Performance Overview | Candidates |
//                                           Promo Tools | Activity Log
//   Promo Tools tab      Promo Code <code> + button[aria-label="Copy code"],
//                        Total Usage, Promo Revenue,
//                        "Code Parameters": Status | Incentive Type | Value | Expiry Date |
//                        Usage Limit, and an "Edit parameters" button
//   Edit modal           role="dialog" "Edit Code Parameters":
//                          input[role=switch][aria-label="Status"]   (visually hidden — click
//                                                                     the label's track div)
//                          input[type=text] PROMO CODE NAME          (DISABLED — read-only)
//                          radio percentage | fixed
//                          input[type=text] value
//                          input[type=date] expiry  (Save is silently DISABLED for any date
//                                                    before today — no validation message)
//                          input[type=text] usage limit
//                          Cancel | Save Changes    -> toast "Changes saved successfully."
class AdminPromoToolsPage extends BasePage {
  constructor(page) {
    super(page);
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    this.agentsUrl = `${origin}/agents`;
    this.origin = origin;

    // ---- Agents list ----
    this.agentSearchInput = page
      .locator('[data-testid="agents-search"]')
      .or(page.getByRole('searchbox', { name: /search by agent name/i }))
      .or(page.locator('input[type="search"], input[placeholder*="Search" i]'))
      .first();

    // ---- Agent detail tabs ----
    this.promoToolsTab = page
      .locator('[data-testid="agent-tab-promo-tools"]')
      .or(page.getByRole('radio', { name: /promo tools/i }))
      .or(page.getByText(/^Promo Tools$/i))
      .first();

    // ---- Promo Tools tab ----
    // The code sits next to the "Promo Code" label and its "Copy code" icon button.
    this.promoCodeValue = page
      .locator('[data-testid="admin-promo-code"]')
      .or(page.locator('div:has(> p:text-is("Promo Code")) div:has(button[aria-label*="opy" i]) > div').first())
      .or(page.locator('div:has(> p:text-is("Promo Code"))').first().locator('div').first())
      .first();
    // data-testid confirmed live 2026-07-30 — kept first so the suite auto-upgrades as the
    // app team rolls test ids out, with the aria-label as the still-working fallback.
    this.promoCopyIcon = page
      .locator('[data-testid="promo-code-copy-button"]')
      .or(page.locator('button[aria-label="Copy code" i], button[aria-label*="copy code" i]'))
      .first();
    // Case 4 (TFF-43 §10): agent has no promo assigned. The tab renders an empty state and
    // an "Add Promo Code" CTA that opens the same modal as Edit, titled "Add Code
    // Parameters". Verified live 2026-07-30.
    this.addPromoCodeButton = page
      .locator('[data-testid="add-promo-code"]')
      .or(page.getByRole('button', { name: /add promo code/i }))
      .first();
    this.noPromoEmptyState = page.getByText(/no code parameters set/i).first();
    this.editParametersButton = page
      .locator('[data-testid="edit-code-parameters"]')
      .or(page.getByRole('button', { name: /edit parameters/i }))
      .first();
    this.codeParametersPanel = page
      .locator('div:has(> div:has-text("Code Parameters"))')
      .first();

    // ---- Edit Code Parameters modal ----
    this.modal = page
      .locator('[role="dialog"][aria-labelledby="edit-code-params-title"]')
      .or(page.locator('[role="dialog"]'))
      .first();
    this.modalHeading = this.modal.getByRole('heading', { name: /edit code parameters/i }).first();
    this.statusSwitch = this.modal.locator('input[role="switch"]').first();
    // The switch <input> is clipped to 1px by react-aria, so a click on it is always
    // intercepted by an ancestor (seen live: label -> section -> track all intercept).
    // Click the track div inside the label instead — same fix as SubscriptionPage's
    // yearlyToggleTrack.
    this.statusSwitchTrack = this.modal.locator('label:has(input[role="switch"]) > div').first();
    this.promoNameInput = this.modal.locator('input[type="text"]').first();
    this.incentivePercentageRadio = this.modal.locator('input[type="radio"][value="percentage"]').first();
    this.incentiveFixedRadio = this.modal.locator('input[type="radio"][value="fixed"]').first();
    this.expiryDateInput = this.modal.locator('input[type="date"]').first();
    this.cancelButton = this.modal.getByRole('button', { name: /^cancel$/i }).first();
    this.saveButton = this.modal.getByRole('button', { name: /save changes/i }).first();
    this.savedToast = page.getByText(/changes saved successfully/i).first();
    // TFF-43 §7.4 requires the toast to read "Promo code parameters updated successfully".
    // The live app renders "Changes saved successfully." instead (TFF-183, verified 2026-07-30),
    // so the wording is asserted from readToastText() rather than baked into `savedToast` —
    // a locator that only matches the CORRECT wording could never report the actual one.
    //
    // The toast is react-toastify (same library as InviteAgentPage / AgentsListingPage) and its DOM
    // is THREE nested elements — captured live 2026-07-31 by scripts/probe-promo-verify-three.js:
    //
    //   <section class="Toastify">                                     <-- 0-height wrapper
    //     <div class="Toastify__toast-container …--bottom-left">
    //       <div id="1" role="alert" class="app-toast app-toast--success …">
    //         Changes saved successfully.
    //
    // This locator has to match the INNERMOST one only. The previous union ended in
    // `[class*="toast" i]`, which also matches the <section> ("Toastify" contains "toast") — and
    // `.first()` picks the first match in DOM ORDER, not the first selector listed, so it always
    // resolved to the wrapper. That <section> contains nothing but position:fixed children, so its
    // own box is zero-height and Playwright never reports it visible: `waitFor({state:'visible'})`
    // timed out on a toast that was on screen the whole time, and the save-wording scenario
    // reported "no toast appeared at all" instead of the wrong wording it exists to catch.
    // Reporting a missing toast when the real defect is its wording sends whoever reads the report
    // after the wrong bug — so keep the container OUT of this union.
    // Note the app replaces react-toastify's default `Toastify__toast` class with `app-toast`;
    // both are listed so either build matches, and the role-scoped variants keep working if the
    // class names churn.
    this.anyToast = page
      .locator(
        '[data-testid="toast"], .app-toast, .Toastify__toast, .notistack-Snackbar, '
        + '[class*="toast-container" i] [role="alert"], [class*="toast-container" i] [role="status"]'
      )
      .first();
    // Case 4 (TFF-43 §10.2): the empty state's CTA opens the same modal titled "Add Code
    // Parameters" instead of "Edit Code Parameters".
    this.addModalHeading = this.modal
      .getByRole('heading', { name: /add code parameters/i })
      .first();
    this.noPromoSubMessage = page
      .getByText(/set up promo code details for this agent/i)
      .first();
  }

  // Whatever the toast actually says, or null if none appeared. Read from a live capture so the
  // wording assertion can report the real text — see the note on `anyToast`.
  async readToastText({ timeout = 8000 } = {}) {
    // Prefer what saveChanges() captured at the moment of the click — by the time a caller asks,
    // the toast has usually auto-dismissed and a fresh wait would report `null` for a toast that
    // definitely appeared.
    if (this.lastSaveToast !== undefined && this.lastSaveToast !== null) return this.lastSaveToast;
    const appeared = await this.anyToast
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return null;
    return (await this.anyToast.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() || null;
  }

  // TFF-43 §10.1 — the no-promo empty state, read as a whole so a step can report which of the
  // three required pieces is missing.
  //
  // The short wait is load-bearing in ONE direction only. This same empty state is what the tab
  // paints while it is still fetching (see openPromoToolsAllowingEmpty), so a `true` here is only
  // meaningful once the tab has settled — but a `false` taken a moment too early would report a
  // missing empty state on an agent that has none, which is the more misleading of the two.
  async readEmptyState() {
    await this.noPromoEmptyState.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    return {
      message: await this.noPromoEmptyState.isVisible().catch(() => false),
      subMessage: await this.noPromoSubMessage.isVisible().catch(() => false),
      cta: await this.addPromoCodeButton.isVisible().catch(() => false),
    };
  }

  // Open the "Add Code Parameters" modal from the empty state's CTA (TFF-43 §10.2).
  async openAddParameters() {
    await this.addPromoCodeButton.click();
    await this.modal.waitFor({ state: 'visible', timeout: 20000 });
  }

  // TFF-43 §7.2 / clarification #6 — the expiry picker must offer NEXT DAY ONWARDS, so a
  // native date input has to carry min="<tomorrow>". Returns the raw attribute (or null),
  // leaving the step to compare it against tomorrow's date.
  async expiryMinAttribute() {
    return this.expiryDateInput.getAttribute('min');
  }

  // Which fields the Add/Edit modal exposes, for the §10.2 "same fields and validations as the
  // Edit modal" requirement. Counts the text inputs rather than naming them — none of them
  // carry a label association or test id (see the note on the field setters).
  async modalFieldInventory() {
    return {
      heading: (await this.modal.getByRole('heading').first().innerText().catch(() => '')).trim(),
      statusSwitch: await this.statusSwitch.count(),
      promoNameDisabled: await this.promoNameInput.isDisabled().catch(() => null),
      percentageRadio: await this.incentivePercentageRadio.count(),
      fixedRadio: await this.incentiveFixedRadio.count(),
      expiryDate: await this.expiryDateInput.count(),
      textInputs: await this.modal.locator('input[type="text"]').count(),
    };
  }

  // ---- Navigation ----

  async gotoAgents() {
    await super.navigate(this.agentsUrl);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.agentSearchInput.waitFor({ state: 'visible', timeout: 60000 });
  }

  // Search the agents list and open the matching agent's detail page. Matches on the
  // row's full text so an email works as well as a name (the searchbox filters by name,
  // so pass a name when the email's local part differs from it).
  async openAgent(nameOrEmail) {
    await this.gotoAgents();
    // The search matches the email as well as the name, so pick the MOST DISTINCTIVE
    // token available. For a +tagged alias that is the tag itself: reducing
    // "iqra.farooq+refagent@bytecorp.io" to its first local-part token gives "iqra",
    // which matches dozens of DEV agents spread over 16 pages — the wanted row is then
    // simply not in the DOM and the row wait times out. The +tag ("refagent") narrows it
    // to one or two rows, and the row filter below still matches on the FULL email, so a
    // prefix collision ("refagent" vs "refagent-nopromo") cannot pick the wrong agent.
    const term = /@/.test(nameOrEmail)
      ? (nameOrEmail.split('@')[0].split('+')[1] || nameOrEmail.split('@')[0].split(/[._-]/)[0])
      : nameOrEmail;
    await this.agentSearchInput.fill(term);
    const rows = this.page.locator('[role="row"]', { hasText: nameOrEmail });
    await rows.first().waitFor({ state: 'visible', timeout: 30000 });
    const row = await this.disambiguate(rows, nameOrEmail);
    await row.getByRole('button', { name: /^view$/i }).first().click();
    await this.page.waitForURL(/\/agents\/view\/\d+/, { timeout: 30000 });
    return this.page.url();
  }

  // `hasText` is a case-insensitive SUBSTRING match, so a short fixture name is a prefix of every
  // throwaway the provisioners have ever minted: `freshAgentIdentity()` surnames every one of them
  // "Qa<letters>", so "NoPromo QA" matched TEN rows live on 2026-08-01 ("Nopromo Qamsaekirwb",
  // "Nopromo Qamsitsusab", …) and `.first()` opened /agents/view/1069 — a throwaway that had been
  // given a promo — instead of the /agents/view/1021 the fixture records. The two Case 4 scenarios
  // were driving an arbitrary agent, and grew a new candidate to drive on every @provision run.
  //
  // So: prefer a row where the term fills a whole cell (an email always does, an exact name does),
  // and REFUSE to guess when several different agents match. Silently taking the first is what
  // turned a fixture mix-up into two failures that read like app defects.
  async disambiguate(rows, term) {
    const count = await rows.count();
    if (count <= 1) return rows.first();

    const wanted = String(term).trim();
    const wantedLower = wanted.toLowerCase();
    const cellsOf = async (i) => (await rows.nth(i).innerText())
      .split(/[\n\t]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    const exact = [];
    const caseExact = [];
    const summaries = [];
    for (let i = 0; i < count; i += 1) {
      const cells = await cellsOf(i);
      summaries.push(cells.join(' | ').slice(0, 140));
      if (cells.some((c) => c.toLowerCase() === wantedLower)) exact.push(i);
      if (cells.some((c) => c === wanted)) caseExact.push(i);
    }
    if (exact.length === 1) return rows.nth(exact[0]);

    // >>> TWO AGENTS CAN HOLD THE SAME EMAIL DIFFERING ONLY IN CASE, SO A CASE-INSENSITIVE
    // "EXACT" MATCH IS NOT ALWAYS UNIQUE. <<< The backend accepts an invite on the UPPER-CASE
    // form of an existing agent's address - that is Invite-agent.feature's own @known-issue
    // (steps/invite-agent.js:924, "the one duplicate the backend ACCEPTS"), and because AN
    // AGENT CANNOT BE DELETED the row it mints is permanent. Live 2026-09-08 the referral
    // fixture's address matched two rows, both "exactly":
    //
    //   Dup Check   | IQRA.FAROOQ+REFAGENT@bytecorp.io | King Saud University | Active | 0 | 0%
    //   Referral QA | iqra.farooq+refagent@bytecorp.io | King Saud University | Active | 0 | 0%
    //
    // That took out the whole superadmin leg of Referral-Codes.feature - four scenarios died in
    // their Given, two of them @known-issue ones that then never reached the deviation they
    // exist to record. Comparing as STORED separates them, which is both correct and safe: the
    // caller passes the address from .env and the app holds it verbatim on the agent it belongs
    // to. This pass is only ever reached when the case-insensitive one was ALREADY ambiguous, so
    // it cannot change which row an unambiguous term resolves to.
    if (exact.length > 1 && caseExact.length === 1) return rows.nth(caseExact[0]);

    throw new Error(
      `"${term}" matches ${count} agents in the list, and ${exact.length === 0 ? 'none of them' : `${exact.length} of them`} `
      + `match it exactly${exact.length > 1 ? ` (${caseExact.length} matching the case as stored)` : ''}, so which one is `
      + 'meant cannot be decided. Address the agent by its EMAIL, which is unique - unless two '
      + 'agents differ only in the CASE of one, which the backend allows and nothing deletes. '
      + `Matching rows:\n  ${summaries.join('\n  ')}`
    );
  }

  async openPromoTools(nameOrEmail) {
    if (nameOrEmail) await this.openAgent(nameOrEmail);
    await this.promoToolsTab.click();
    await this.editParametersButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  // Re-fetch the agent whose profile is ALREADY open, without going back through the agents list
  // (which costs a search and a row match). Reload lands on the default tab, so Promo Tools is
  // re-selected afterwards.
  //
  // This exists for polling the banner. "Total Usage" and "Promo Revenue" are written by the
  // payment webhook, which can trail the candidate's redirect back from the gateway by a few
  // seconds, so one read taken straight after a payment can legitimately still show the previous
  // figures — and asserting on that single read would report a timing lag as a product defect.
  async refreshPromoTools() {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.promoToolsTab.click();
    await this.editParametersButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  // Same as openPromoTools but tolerant of an agent with NO promo assigned, where there is
  // no "Edit parameters" button to wait for — only the empty state and its Add CTA.
  // Returns whether a promo is configured.
  //
  // THE TAB PAINTS THE NO-PROMO EMPTY STATE WHILE IT LOADS, ON EVERY AGENT — measured live
  // 2026-08-01 (scripts/probe-promo-tab-load-race.js): on an agent that plainly holds a promo, the
  // "No code parameters set" message, its sub-message and its "Add Promo Code" CTA are all visible
  // and "Edit parameters" is absent for the first ~1.0s, then the whole section swaps. So the
  // loading render and the genuinely-empty render are INDISTINGUISHABLE in the DOM.
  //
  // The previous implementation raced the two buttons and then read `editParametersButton
  // .isVisible()`, which does not wait: the Add CTA always won that race, and this method answered
  // "no promo" for an agent holding one — 3 times out of 3 in the probe. Everything the two Case 4
  // scenarios reported followed from that single wrong answer: the premise guard passed, the
  // empty-state assertion (also an un-waited isVisible) passed, the Add CTA was clicked, and by the
  // time the modal opened the fetch HAD landed — so it opened titled "Edit Code Parameters",
  // prefilled with the promo the agent already had. That is also where the "the app fills Expiry
  // Date with +45 days and Usage Limit with 30 of its own accord" note came from: those were an
  // existing promo's values, not suggested defaults.
  //
  // So the question is put to the endpoint the render itself waits on —
  // GET /core/api/v1/agents/<id>/promotion/, which answers either the promo object or
  // {"detail":"No promotion found for this agent."} — and only then is the DOM read.
  async openPromoToolsAllowingEmpty(nameOrEmail) {
    const seen = [];
    const onResponse = (r) => {
      const m = r.url().match(/\/agents\/(\d+)\/promotion\/?(?:\?|$)/);
      if (m && r.request().method() === 'GET') seen.push({ id: m[1], res: r });
    };
    // Armed BEFORE the navigation: the agent page fires this request as it loads, which can be
    // well before the Promo Tools tab is clicked.
    this.page.on('response', onResponse);
    try {
      if (nameOrEmail) await this.openAgent(nameOrEmail);
      await this.promoToolsTab.click();

      const id = (this.page.url().match(/\/agents\/view\/(\d+)/) || [])[1];
      const deadline = Date.now() + 30000;
      let entry = null;
      for (;;) {
        // Newest first, and matched on the agent id so a response left over from a previously
        // opened agent cannot answer for this one.
        entry = [...seen].reverse().find((e) => !id || e.id === id) || null;
        if (entry || Date.now() >= deadline) break;
        await this.page.waitForTimeout(100);
      }

      if (entry) {
        this.lastPromotionPayload = await entry.res.json().catch(() => null);
        const hasPromo = Boolean(this.lastPromotionPayload && this.lastPromotionPayload.code);
        // The API has answered, so the render that follows is the FINAL one — wait for the DOM to
        // agree rather than reading it mid-swap.
        const settled = hasPromo ? this.editParametersButton : this.addPromoCodeButton;
        await settled.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
        return hasPromo;
      }

      // No response seen at all (the tab can render from an answer already in the client's cache).
      // Fall back to the DOM, but give the swap time to happen rather than reading it immediately.
      this.lastPromotionPayload = undefined;
      await this.editParametersButton.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      return this.editParametersButton.isVisible().catch(() => false);
    } finally {
      this.page.off('response', onResponse);
    }
  }

  // What GET /agents/<id>/promotion/ answered on the last openPromoToolsAllowingEmpty() call, so a
  // step asserting "this agent has no promo" can quote the server rather than the DOM. `undefined`
  // means no response was observed and the answer came from the settled DOM instead.
  promotionPayloadSummary() {
    if (this.lastPromotionPayload === undefined) return '(no /promotion/ response observed)';
    if (!this.lastPromotionPayload) return '(unparseable /promotion/ response)';
    const p = this.lastPromotionPayload;
    return p.code
      ? `code ${p.code}, status ${p.status}, ${p.incentive_type} ${p.incentive_value}, expires ${p.expiry_date}`
      : JSON.stringify(p).slice(0, 160);
  }

  async hasPromoAssigned() {
    return this.editParametersButton.isVisible().catch(() => false);
  }

  // ---- Reading the configured promo ----

  async readPromoCode() {
    // Take the text next to the "Promo Code" label rather than a fragile nth-child:
    // read the label's container and strip the label itself.
    const container = this.page.locator('div:has(> p:text-is("Promo Code"))').first();
    await container.waitFor({ state: 'visible', timeout: 30000 });
    const txt = (await container.innerText()).replace(/\s+/g, ' ').trim();
    return txt.replace(/^Promo Code\s*/i, '').trim().split(' ')[0];
  }

  // Read one "Code Parameters" field ("Status" | "Incentive Type" | "Value" |
  // "Expiry Date" | "Usage Limit"). Each is a label <p> followed by its value.
  async readParameter(field) {
    const block = this.page.locator(`div:has(> p:text-is("${field}"))`).last();
    if (!(await block.isVisible().catch(() => false))) return null;
    const txt = (await block.innerText()).replace(/\s+/g, ' ').trim();
    return txt.replace(new RegExp(`^${escapeRegExp(field)}\\s*`, 'i'), '').trim();
  }

  async readAllParameters() {
    const fields = ['Status', 'Incentive Type', 'Value', 'Expiry Date', 'Usage Limit'];
    const out = {};
    for (const f of fields) out[f] = await this.readParameter(f);
    return out;
  }

  // TFF-43 §4 — the four tabs an Agent Profile must expose. Read by name rather than by
  // position so a reordering does not read as a missing tab.
  async readProfileTabs() {
    const wanted = ['Performance Overview', 'Candidates', 'Promo Tools', 'Activity Log'];
    const out = {};
    for (const name of wanted) {
      const tab = this.page
        .getByRole('radio', { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') })
        .or(this.page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') }))
        .or(this.page.getByText(new RegExp(`^${escapeRegExp(name)}$`, 'i')))
        .first();
      out[name] = await tab.isVisible().catch(() => false);
    }
    return out;
  }

  // TFF-43 §5 — the tab is specified as two sections. Reports whether each is present along
  // with every Code Parameters field §6.2 requires, so one step can name all the gaps.
  async readTabStructure() {
    const banner = await this.readBanner();
    const params = await this.readAllParameters();
    return {
      bannerPresent: !!banner.code,
      banner,
      parametersPresent: await this.codeParametersPanel.isVisible().catch(() => false),
      parameters: params,
    };
  }

  async readTotalUsage() {
    return this.readParameter('Total Usage');
  }

  // TFF-43 §6.1 — the banner's third figure. The AC calls it "Revenue Generated"; the live
  // tab labels it "Promo Revenue" (verified 2026-07-30). Both labels are tried so the reader
  // survives the app being brought in line with the wording, and so a rename does not read as
  // "the figure is missing".
  async readPromoRevenue() {
    for (const label of ['Promo Revenue', 'Revenue Generated', 'Revenue']) {
      const value = await this.readParameter(label);
      if (value) return { label, value };
    }
    return { label: null, value: null };
  }

  // The revenue figure as a number, or null when the banner does not render it. Currency and
  // thousands separators are stripped; "SAR 1,240.50" -> 1240.5.
  async readPromoRevenueAmount() {
    const { value } = await this.readPromoRevenue();
    const m = String(value || '').match(/[\d.,]+/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : null;
  }

  // Every figure the banner is required to carry (TFF-43 §6.1), read in one pass so a step can
  // report ALL the missing ones instead of stopping at the first.
  async readBanner() {
    return {
      code: await this.readPromoCode().catch(() => null),
      copyIcon: await this.promoCopyIcon.isVisible().catch(() => false),
      totalUsage: await this.readTotalUsage(),
      revenue: await this.readPromoRevenue(),
    };
  }

  // Copy the promo code with the banner's copy icon and return what landed on the clipboard.
  // Needs clipboard-read permission on the context (granted where the context is created).
  async copyPromoCodeToClipboard() {
    await this.promoCopyIcon.click();
    return this.page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  }

  // TFF-43 §8 / TFF-185 — a DISABLED promo must render the banner and the Code Parameters section
  // visually de-emphasised. Reports how each section is PAINTED: the colour of every content row,
  // plus every opacity / blur / non-interactive signal on the card, its ancestors and its
  // descendants. The step compares this against the same reading taken while the promo was still
  // Active (see captureVisualBaseline in promo-lifecycle.steps.js).
  //
  // COLOUR IS THE POINT, and the reader this replaced could not see it. That one looked only at
  // `opacity`, `filter` and a class-name pattern, and so reported "not greyed out (opacity 1, no
  // muting class)" — while the app was greying both sections perfectly well by repainting their
  // text: every content row goes from rgb(83,88,98) / rgb(24,29,39) to a uniform rgb(164,167,174),
  // opacity stays 1 and no class changes at all (captured live 2026-07-31 by
  // scripts/probe-promo-greying-and-add-defaults.js — 6 of 6 banner rows and 8 of 11 Code
  // Parameters rows, the three exceptions being the section heading, the "Status" label and the
  // new "Disabled" value, which correctly stay legible). A reader blind to `color` can only ever
  // answer "absent", so it reported a working requirement as an app defect for as long as it
  // existed. Same trap as the toast locator above: never assert a visual treatment by asking
  // whether the ONE property you guessed at is present.
  //
  // Greying therefore cannot be asserted absolutely — there is no fixed "muted" value to test
  // against — only as a CHANGE from the active render. Hence the baseline.
  async readSectionVisuals() {
    return this.page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const all = [...document.querySelectorAll('body *')];
      const findExact = (re) => all.find((e) => re.test(norm(e.textContent)) && e.children.length <= 3);

      // One entry per element that owns visible text of its own, so a value is reported once
      // rather than once for every wrapper that contains it.
      const rowsOf = (card) => {
        const rows = [];
        for (const el of card.querySelectorAll('*')) {
          const own = norm(
            [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')
          );
          if (!own) continue;
          const s = getComputedStyle(el);
          rows.push({ text: own.slice(0, 40), color: s.color, opacity: s.opacity, filter: s.filter });
        }
        return rows;
      };

      // Any blur / fade / non-interactive treatment, wherever it is applied. SVG `filter=url(#…)`
      // is deliberately not counted — the page's icons carry those in both states.
      const treatments = (card) => {
        const out = [];
        const consider = (el, where) => {
          const s = getComputedStyle(el);
          const cls = String(el.getAttribute('class') || '');
          const bd = s.backdropFilter || s.webkitBackdropFilter || '';
          const op = parseFloat(s.opacity);
          if (s.filter && /blur\(/i.test(s.filter)) out.push(`${where}: filter=${s.filter}`);
          if (/blur\(/i.test(bd)) out.push(`${where}: backdrop-filter=${bd}`);
          if (/(^|\s)(blur|backdrop-blur)(-|\s|$)/i.test(cls)) out.push(`${where}: blur class`);
          if (!Number.isNaN(op) && op < 1) out.push(`${where}: opacity=${s.opacity}`);
          if (/(^|\s)pointer-events-none(\s|$)/i.test(cls)) out.push(`${where}: pointer-events-none`);
        };
        let el = card;
        for (let i = 0; el && i < 6; i += 1, el = el.parentElement) consider(el, `ancestor+${i}`);
        for (const d of card.querySelectorAll('*')) consider(d, 'descendant');
        return out;
      };

      const codeLbl = findExact(/^Promo Code$/i);
      const paramsLbl = findExact(/^Code Parameters$/i);
      const cards = {
        banner: codeLbl && codeLbl.parentElement ? codeLbl.parentElement.parentElement : null,
        parameters: paramsLbl ? paramsLbl.parentElement : null,
      };

      const out = {};
      for (const [name, card] of Object.entries(cards)) {
        out[name] = card
          ? { found: true, rows: rowsOf(card), treatments: treatments(card) }
          : { found: false, rows: [], treatments: [] };
      }
      return out;
    });
  }

  // "Total Usage" as a number, or null when the banner is absent / unparseable. The banner
  // renders a bare count (no "x of y"), so the limit comes from readParameter('Usage Limit').
  // A count as the tab renders it, THOUSANDS SEPARATORS INCLUDED.
  //
  // These used to match /\d+/, which stops at the first comma: the tab renders a usage limit of
  // 10000 as "10,000", so the reader returned 10. That made the tab-coherence scenario report
  // "Usage Limit reads 10, .env configures 10000" for both agents on a 10000 limit — a parsing
  // bug in the suite reported as an app defect, and one that would silently under-read every
  // usage figure above 999.
  static parseCount(raw) {
    const m = String(raw == null ? '' : raw).match(/\d[\d,٬  ]*/);
    if (!m) return null;
    const digits = m[0].replace(/[^\d]/g, '');
    return digits === '' ? null : Number(digits);
  }

  async readTotalUsageCount() {
    return AdminPromoToolsPage.parseCount(await this.readTotalUsage());
  }

  async readUsageLimitCount() {
    return AdminPromoToolsPage.parseCount(await this.readParameter('Usage Limit'));
  }

  // TFF-43 §9.2: once a promo expires (by date OR by exhausting its usage limit) the Promo
  // Tools tab and the "Code Parameters" heading each show a red "i" icon.
  //
  // There is no test id and no accessible name on that icon, so this looks for an icon
  // element carrying a red/error/warning signal beside each anchor rather than asserting a
  // specific class. It returns WHAT it found, not a bare boolean, so a failing step can say
  // whether the icon was missing or merely unrecognisable.
  async warningIcons() {
    return this.page.evaluate(() => {
      const isRed = (el) => {
        const cls = String(el.getAttribute('class') || '');
        if (/error|danger|warning|destructive|text-red|fill-red|stroke-red/i.test(cls)) return true;
        const style = window.getComputedStyle(el);
        const colour = `${style.color} ${style.fill} ${style.stroke}`;
        // Reds render as rgb(r,g,b) with a dominant red channel.
        return /rgb\(\s*(1[6-9]\d|2[0-5]\d)\s*,\s*([0-9]|[1-9]\d)\s*,\s*([0-9]|[1-9]\d)\s*\)/.test(colour);
      };
      const near = (root) => {
        if (!root) return null;
        const icons = [...root.querySelectorAll('svg, i, [class*="icon" i]')];
        const hit = icons.find(isRed);
        return hit ? (hit.getAttribute('class') || hit.tagName) : null;
      };
      const all = [...document.querySelectorAll('*')];
      const tab = all.find((e) => /^promo tools$/i.test((e.textContent || '').trim())
        && e.children.length <= 2);
      const heading = all.find((e) => /^code parameters$/i.test((e.textContent || '').trim())
        && e.children.length <= 2);
      return {
        onTab: near(tab && tab.parentElement),
        onHeading: near(heading && heading.parentElement),
      };
    });
  }

  // ---- Edit modal field setters ----
  // The modal has three text inputs in DOM order: promo name (disabled), value, usage
  // limit. Value is addressed by position for that reason — none of them carry a name,
  // label association or test id (checked live 2026-07-30).

  // Write into one of this modal's controlled numeric inputs.
  //
  // `locator.fill(x)` OVER AN EXISTING VALUE IS A NO-OP HERE. Proved live 2026-07-31
  // (scripts/probe-promo-add-value-field.js): on the Add modal's Value field, which opens
  // holding "0", `fill("15")` leaves it at "0", while `fill("")` followed by `fill("15")` sets
  // it. The field silently keeps its old contents, so every setter that used a single fill()
  // could report success having changed nothing — which is exactly how the Add-modal gating
  // scenario came to fail: Value stayed "0", the app correctly refused to enable "Save Changes",
  // and the test blamed the button.
  //
  // Clearing first is harmless on a field that would have accepted the direct fill, so this is
  // the single write path for both modals.
  async fillControlled(locator, value) {
    await locator.fill('');
    await this.page.waitForTimeout(120);
    if (String(value) !== '') {
      await locator.fill(String(value));
      await this.page.waitForTimeout(120);
    }
  }

  async setValue(value) {
    const inputs = this.modal.locator('input[type="text"]');
    await this.fillControlled(inputs.nth(1), value);
  }

  // The incentive radios are React-Aria: the real <input type="radio"> lives inside a
  // visually-hidden 1x1 clipped <span> and carries NO id, so `label[for=...]` does not exist and
  // a real mouse click at the input's own box never reaches it. `check({ force: true })` RESOLVES
  // without flipping it, which is why this used to fail silently — the old `.catch()` fallback
  // never ran, `setIncentive` reported success, and the scenario then blamed the app for not
  // persisting Incentive Type (it was never set). Click the ancestor <label>, which is what
  // React-Aria listens on, and VERIFY: a selector that stops working must fail loudly here
  // rather than hand the next reader a false app defect.
  async setIncentive(type) {
    const wantFixed = /fixed/i.test(type);
    const radio = wantFixed ? this.incentiveFixedRadio : this.incentivePercentageRadio;

    if (await radio.isChecked().catch(() => false)) return;

    await radio.locator('xpath=ancestor::label[1]').first().click({ timeout: 10000 })
      .catch(async () => {
        await this.modal.getByText(new RegExp(escapeRegExp(type), 'i')).first().click();
      });

    if (!(await radio.isChecked().catch(() => false))) {
      throw new Error(
        `could not select the "${type}" incentive radio: it is still unchecked after clicking its `
        + 'label. The control is React-Aria (hidden 1x1 input, no id, label ancestor) — a real '
        + 'click on the input itself does nothing, so this needs a click target that React-Aria '
        + 'listens on. Failing here on purpose: a silent miss makes the app look like it does not '
        + 'persist Incentive Type.'
      );
    }
  }

  async readValueField() {
    const inputs = this.modal.locator('input[type="text"]');
    return inputs.nth(1).inputValue();
  }

  async readUsageLimitField() {
    const inputs = this.modal.locator('input[type="text"]');
    return inputs.last().inputValue();
  }

  // Set the status and persist it in one call, reporting whether anything changed. Used by
  // the notification scenarios, which have to disable and then restore the same promo.
  async setStatusAndSave(on) {
    await this.openEditParameters();
    const changed = await this.setStatus(on);
    if (!changed) {
      await this.cancelEdit();
      return { changed: false };
    }
    await this.saveChanges();
    return { changed: true };
  }

  // ---- Editing ----

  async openEditParameters() {
    await this.editParametersButton.click();
    await this.modalHeading.waitFor({ state: 'visible', timeout: 20000 });
  }

  async isStatusEnabled() {
    return this.statusSwitch.isChecked();
  }

  // Toggle Status to `on`. No-op when already there.
  async setStatus(on) {
    if ((await this.isStatusEnabled()) === on) return false;
    await this.statusSwitchTrack.click();
    await this.page.waitForFunction(
      (want) => {
        const sw = document.querySelector('[role="dialog"] input[role="switch"]');
        return sw && sw.checked === want;
      },
      on,
      { timeout: 10000 }
    );
    return true;
  }

  // Set the expiry date. `iso` is YYYY-MM-DD. NOTE: the form silently disables Save for
  // any date before today (verified live 2026-07-28 — no validation message is rendered),
  // so a past date cannot be persisted; saveChanges() reports that rather than hanging.
  //
  // >>> THE EXPIRY DATE CANNOT BE CLEARED, BY A USER OR BY THIS SUITE. <<< Measured 2026-09-07
  // (scripts/probe-promo-expiry-clear-noop.js): the control is a calendar-button-only react-aria
  // DatePicker - 0 editable date segments, no clear/reset control in its popover, and
  // expiryDateInput resolves to react-aria's aria-hidden tabindex="-1" MIRROR input, not to
  // anything on screen. fill("") on that mirror left the visible control reading 19/09/2026 and
  // the mirror itself still holding 2026-09-19 - a complete no-op. It is rejected loudly rather
  // than silently, because a silent no-op is exactly what made the modal look as though it
  // rendered no required-field error: the field had never been emptied.
  async setExpiryDate(iso) {
    if (String(iso).trim() === '') {
      throw new Error(
        'Expiry Date cannot be cleared - the control is a calendar-button-only react-aria '
        + 'DatePicker with no editable segments and no clear control, and the input this page '
        + 'object holds is its aria-hidden mirror. An empty expiry is not a state the product '
        + 'can reach, so do not assert on it.'
      );
    }
    await this.expiryDateInput.fill(iso);
  }

  async setUsageLimit(value) {
    const inputs = this.modal.locator('input[type="text"]');
    await this.fillControlled(inputs.last(), value);
  }

  async isSaveEnabled() {
    return this.saveButton.isEnabled();
  }

  // "Save Changes" reaches its final state ASYNCHRONOUSLY, so a single read taken straight after
  // typing is not evidence of anything. Observed live 2026-07-31 in one Add-modal run: with
  // Value=15, Expiry=+30d and Usage Limit=25 all validly filled, one read said disabled — and a
  // few interactions later the very same field values read ENABLED. Reading once therefore
  // reported "a complete form cannot be saved" against a form that saves fine.
  //
  // Two directions, two different questions, and they are NOT each other's negation:
  //   waitForSaveEnabled  — must ENABLE: poll until it does, so a late enable still passes.
  //   saveStaysDisabled   — must stay GATED: watch for the whole window, so a late enable is
  //                         caught instead of being missed by a read taken too early.
  async waitForSaveEnabled(timeout = 6000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.isSaveEnabled()) return true;
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(200);
    }
  }

  async saveStaysDisabled(window = 2000) {
    const deadline = Date.now() + window;
    for (;;) {
      if (await this.isSaveEnabled()) return false;
      if (Date.now() >= deadline) return true;
      await this.page.waitForTimeout(200);
    }
  }

  // The modal's whole visible text. Inline errors in this modal carry no role, no test id and
  // no label association (checked live 2026-07-30), so a step matches expected error wording
  // against this rather than against a per-field locator that does not exist. Returns the text
  // with the field VALUES stripped of newlines so a multi-line error still matches on one line.
  async modalText() {
    return (await this.modal.innerText().catch(() => '')).replace(/[ \t]+/g, ' ').trim();
  }

  // Fill Value and move focus out, which is what triggers this form's inline validation
  // (verified on the invite form, same component). Returns the modal text afterwards so a
  // caller gets the resulting error in one round trip.
  async setValueAndBlur(value) {
    const inputs = this.modal.locator('input[type="text"]');
    await this.fillControlled(inputs.nth(1), value);
    await inputs.nth(1).blur().catch(() => {});
    await this.page.waitForTimeout(400);
    return this.modalText();
  }

  async setUsageLimitAndBlur(value) {
    const inputs = this.modal.locator('input[type="text"]');
    await this.fillControlled(inputs.last(), value);
    await inputs.last().blur().catch(() => {});
    await this.page.waitForTimeout(400);
    return this.modalText();
  }

  // Which incentive radio the modal opens on. TFF-43 §7.2 specifies "Percentage Discount
  // (default)" — but that only means the default for a promo that has none yet, so this is
  // asserted on the ADD modal, where nothing has been configured.
  async selectedIncentive() {
    if (await this.incentivePercentageRadio.isChecked().catch(() => false)) return 'percentage';
    if (await this.incentiveFixedRadio.isChecked().catch(() => false)) return 'fixed';
    return null;
  }

  // Everything the Edit modal currently holds, for the "Cancel discards changes" check.
  async readModalFields() {
    const inputs = this.modal.locator('input[type="text"]');
    return {
      status: await this.isStatusEnabled().catch(() => null),
      promoName: await inputs.first().inputValue().catch(() => null),
      incentive: await this.selectedIncentive(),
      value: await inputs.nth(1).inputValue().catch(() => null),
      expiry: await this.expiryDateInput.inputValue().catch(() => null),
      usageLimit: await inputs.last().inputValue().catch(() => null),
    };
  }

  // TFF-43 §7.2 / clarification #6 — the expiry picker must offer the NEXT DAY onwards, so
  // today must be unreachable. Asserted BEHAVIOURALLY rather than from the input's `min`
  // attribute: this form gates the date by disabling Save, not by constraining the input
  // (verified live — see saveChanges()), so `min` may legitimately be absent while the
  // constraint is still enforced. Returns whether Save enables for each date, and leaves the
  // modal closed.
  async expiryAcceptance(isoDates) {
    const out = {};
    for (const iso of isoDates) {
      await this.openEditParameters();
      await this.setExpiryDate(iso);
      out[iso] = await this.isSaveEnabled();
      await this.cancelEdit();
    }
    return out;
  }

  async saveChanges({ timeout = 20000 } = {}) {
    // Poll for enablement rather than reading it once — this form settles Save asynchronously, so a
    // single read taken straight after the last field was typed can catch it a moment too early.
    // That is what made the Add-modal save report "Save Changes is disabled, so the promo
    // parameters were not persisted" against a form that saves perfectly well, recorded for a while
    // as a pre-existing failure of unknown cause. See waitForSaveEnabled().
    if (!(await this.waitForSaveEnabled())) {
      const expiry = await this.expiryDateInput.inputValue().catch(() => '(unknown)');
      throw new Error(
        'Save Changes is disabled, so the promo parameters were not persisted. The form '
        + 'disables Save, silently and with no validation message, in exactly two cases '
        + '(both verified live): the expiry date is before today, or NOTHING IN THE FORM HAS '
        + `CHANGED. The expiry field currently holds "${expiry}" — if that date is in the `
        + 'future, the modal was opened without editing anything.'
      );
    }
    // Start watching for the toast BEFORE the click. This form's toast auto-dismisses in a
    // couple of seconds, so a reader that only starts looking after the modal has closed can
    // miss it entirely — which is how the save-wording scenario came to report "no toast
    // appeared" when the app does show one (it reads "Changes saved successfully.", captured
    // live 2026-07-31 by scripts/probe-promo-modal-truth.js). Reporting a missing toast when
    // the real defect is its wording sends whoever reads the report after the wrong bug.
    const toast = this.anyToast
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => this.anyToast.innerText().catch(() => ''))
      .then((t) => (t || '').replace(/\s+/g, ' ').trim() || null)
      .catch(() => null);

    await this.saveButton.click();
    await this.modal.waitFor({ state: 'hidden', timeout }).catch(() => {});
    this.lastSaveToast = await toast;
  }

  async cancelEdit() {
    if (await this.modal.isVisible().catch(() => false)) {
      await this.cancelButton.click().catch(() => {});
      await this.modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }

  // ---- Backdating: making a promo genuinely EXPIRED ----

  // Push the promo past its expiry date, so the lifecycle transition TFF-43 §9.2 describes
  // ("promo expired") can actually be driven instead of being left as living spec.
  //
  // WHY IT HAS TO WORK THIS WAY. The modal's Save button is disabled for any expiry date
  // before today, so the UI alone cannot produce an expired promo. Calling the API by hand
  // does not work either: the session is not a JWT in web storage, so a hand-rolled fetch
  // answers 401 (scripts/probe-promo-expire-via-api.js). What DOES work is letting the app
  // make its own request and rewriting one field on the way out — the app supplies the
  // Authorization header, and only `expiry_date` changes:
  //
  //   PATCH /core/api/v1/agents/<id>/promotion/   {"expiry_date":"<past>"}
  //     -> 200 {... "status":"Expired", "expiry_date":"<past>" ...}
  //
  // Verified live 2026-07-30: the API accepts a past date, flips `status` to "Expired", the
  // Promo Tools tab then reads "Expired" and both red "i" icons render. So this is the real
  // product behaviour for an expired promo, not a mock.
  //
  // The form still has to be made DIRTY for Save to enable, hence the future date typed into
  // the field first — that value never reaches the server.
  //
  // Undone by restoreParameters(), which puts the snapshot's future date back through the
  // plain UI (that direction the form allows unaided).
  async backdateExpiry({ daysPast = 1 } = {}) {
    const past = isoDaysFromToday(-Math.abs(daysPast));
    const dirtyValue = isoDaysFromToday(30);
    let sentBody = null;

    const handler = async (route) => {
      const request = route.request();
      if (request.method() !== 'PATCH') return route.fallback();
      let body = {};
      try {
        body = JSON.parse(request.postData() || '{}');
      } catch {
        body = {};
      }
      sentBody = { ...body, expiry_date: past };
      await route.continue({ postData: JSON.stringify(sentBody) });
    };

    await this.page.route(PROMOTION_ENDPOINT, handler);
    try {
      await this.openEditParameters();
      await this.setExpiryDate(dirtyValue);
      if (!(await this.isSaveEnabled())) {
        await this.cancelEdit();
        throw new Error(
          `Save stayed disabled after typing a +30d expiry date (${dirtyValue}) into the Edit `
          + 'Code Parameters form, so the promo could not be backdated. Either the promo already '
          + 'carries that date, or the form no longer treats an expiry-date edit as a change.'
        );
      }
      const [response] = await Promise.all([
        this.page
          .waitForResponse((r) => PROMOTION_ENDPOINT.test(new URL(r.url()).pathname)
            && r.request().method() === 'PATCH', { timeout: 30000 })
          .catch(() => null),
        this.saveChanges(),
      ]);
      const status = response ? response.status() : null;
      const raw = response ? await response.text().catch(() => '') : '';
      if (!response) {
        throw new Error('the promotion PATCH never answered, so the backdate was not persisted');
      }
      if (status >= 400) {
        throw new Error(
          `the API refused the backdated expiry date ${past} (${status}): ${raw.slice(0, 200)}. `
          + 'If it has started validating the date server-side, expiry can no longer be driven '
          + 'from the suite and these scenarios go back to being living spec.'
        );
      }
      let reported = null;
      try {
        reported = JSON.parse(raw);
      } catch {
        reported = null;
      }
      return { expiryDate: past, status, apiStatus: reported && reported.status, sent: sentBody };
    } finally {
      await this.cancelEdit().catch(() => {});
      await this.page.unroute(PROMOTION_ENDPOINT, handler).catch(() => {});
    }
  }

  // Capture everything needed to put the promo back exactly as it was.
  async snapshotParameters() {
    await this.openEditParameters();
    const inputs = this.modal.locator('input[type="text"]');
    const snap = {
      status: await this.isStatusEnabled(),
      percentage: await this.incentivePercentageRadio.isChecked().catch(() => null),
      value: await inputs.nth(1).inputValue().catch(() => null),
      expiry: await this.expiryDateInput.inputValue().catch(() => null),
      usageLimit: await inputs.last().inputValue().catch(() => null),
    };
    await this.cancelEdit();
    return snap;
  }

  // Restore a snapshot taken by snapshotParameters(). Only touches what differs, and
  // never throws — it runs from an After hook, where masking the scenario's own failure
  // would be worse than a stale promo (the mismatch is reported by the caller instead).
  // Restores EVERY field snapshotParameters() captures — status, expiry, incentive type and
  // value. Incentive and value were previously captured and then silently dropped here, which
  // did not bite while nothing changed them; the fixed-amount scenarios do, and a promo left
  // on the wrong incentive type would quietly falsify every discount assertion that follows.
  async restoreParameters(snap) {
    if (!snap) return { restored: false, reason: 'no snapshot' };
    try {
      await this.openEditParameters();
      const changed = await this.setStatus(snap.status);
      if (snap.expiry) await this.setExpiryDate(snap.expiry);
      // `percentage` is null when the radio could not be read at snapshot time — restoring
      // from that would be a guess, so leave the incentive alone in that case.
      //
      // setIncentive() THROWS when it cannot select the radio (it used to fail silently). Letting
      // that escape here would abandon the value and usage-limit restores below and leave MORE
      // drift than doing nothing, so it is caught and reported: restore as much as possible, and
      // say what was missed. No-ops without clicking when the incentive already matches.
      const problems = [];
      if (snap.percentage !== null && snap.percentage !== undefined) {
        try {
          await this.setIncentive(snap.percentage ? 'percentage' : 'fixed');
        } catch (e) {
          problems.push(`incentive type not restored: ${String((e && e.message) || e).split('\n')[0]}`);
        }
      }
      if (snap.value !== null && snap.value !== undefined && snap.value !== '') {
        await this.setValue(snap.value);
      }
      // Usage Limit was captured by snapshotParameters() and then silently DROPPED here, so any
      // scenario that edited it left the new figure behind permanently. That is what put the
      // unlimited and fixed agents on a limit of 500 and then 10, which made the tab-coherence
      // scenario fail against the 10000 recorded in .env — a leak from an earlier run reported as
      // an app defect. Verified live 2026-07-31: 10000 saves and persists perfectly well.
      if (snap.usageLimit !== null && snap.usageLimit !== undefined && snap.usageLimit !== '') {
        await this.setUsageLimit(snap.usageLimit);
      }
      if (!changed && !(await this.isSaveEnabled())) {
        await this.cancelEdit();
        return problems.length
          ? { restored: false, reason: problems.join(' | ') }
          : { restored: true, reason: 'already in the snapshot state' };
      }
      await this.saveChanges();
      return problems.length
        ? { restored: false, reason: problems.join(' | ') }
        : { restored: true };
    } catch (e) {
      await this.cancelEdit().catch(() => {});
      return { restored: false, reason: String((e && e.message) || e).split('\n')[0] };
    }
  }

  // Set the incentive type and value together and persist them, reporting what was replaced
  // so a caller can put it back. Used by the over-subtotal edge case, which needs a fixed
  // value larger than the invoice.
  async setIncentiveAndSave(type, value) {
    await this.openEditParameters();
    const before = {
      percentage: await this.incentivePercentageRadio.isChecked().catch(() => null),
      value: await this.readValueField().catch(() => null),
    };
    await this.setIncentive(type);
    await this.setValue(value);
    await this.saveChanges();
    return before;
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// YYYY-MM-DD, `days` from today (negative for the past).
function isoDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = AdminPromoToolsPage;
