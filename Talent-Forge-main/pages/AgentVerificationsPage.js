// AgentVerificationsPage - the agent's Document Review screen at /verifications and the
// "Document Verification" panel it opens.
//
// ============================================================================
// MEASURED LIVE 2026-08-24 - do not re-derive any of this from the API
// ============================================================================
//
// Route          /verifications?activeFilter=ALL
// Table          react-aria: <table role="grid"> > <tbody class="react-aria-TableBody">
//                > <tr role="row"> with <td role="rowheader"> holding the file name.
// Columns        Document Name | Uploaded By | Document Type | Date Uploaded | Status | Actions
//
// THE STATUS RENAME. The API enum is AWAITING | APPROVED | REVISION, and the schema
// still describes AWAITING as "Awaiting Verification". The UI does NOT: both the status
// pill and the filter tab read "Needs Review". The tab's own test id is still
// `agent-verifications-tab-awaiting-verification`, which confirms the rename is
// presentation-level. So:
//
//     API status AWAITING  ==  displayed "Needs Review"
//
// That mapping is the whole reason this page object exists rather than the steps
// reading the API - the AC is written in the UI's vocabulary.
//
// >>> THE "Need Review" / "Needs Review" INCONSISTENCY IS FIXED, AND THIS FILE WAS THE
//     STALE HALF (re-measured 2026-09-22, scripts/probe-agent-verifications.js). <<<
// `TAB_LABEL.AWAITING` read "Need Review" (singular), recorded on 2026-08-24 as a real UI
// inconsistency against a pill reading "Needs Review". The build now renders "Needs Review"
// in BOTH places. That mattered for more than tidiness: steps/document-verification.js
// asserts `tab label === TAB_LABEL[status]`, so the suite was RED against a build that had
// been corrected - the product fixed the defect and the suite went on reporting it.
//
// TAB_LABEL and STATUS_LABEL are deliberately KEPT SEPARATE even though they now agree on
// every status. They are two different surfaces and collapsing them into one map would mean
// a future divergence could not be expressed at all - which is exactly the state that made
// this one hard to spot. Note CandidateDocumentsPage and CandidateViewProfilePage carry
// comments repeating the old "Need Review" reading; they are stale for the same reason.
//
// data-testid hooks the build already exposes (rare in this app, so they are preferred
// over every other candidate):
//   agent-verifications-tab-all / -awaiting-verification / -approved / -revision-required
//   agent-verifications-view-button        (per row, aria-label "View")
//   agent-verifications-download-button    (per row, aria-label "Download")
//   agent-request-revision-button          (in the panel)
//   agent-approve-button                   (in the panel)
//   agent-submit-request-revision-button   (in the confirm dialog)
//
// >>> THE SUBMIT TEST ID IS DUPLICATED, AND IT IS A PRODUCT BUG. <<<
// The Approve dialog's submit button ALSO carries
// `data-testid="agent-submit-request-revision-button"`. Approving and requesting a
// revision are opposite actions and a selector cannot tell them apart. Every method
// below therefore scopes to the open dialog AND matches the button's visible text, and
// `submitDecision()` refuses to click a control whose label does not match the decision
// it was asked to make. Reported, not worked around silently.

const BasePage = require('./BasePage');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

// What the UI calls each API status.
const STATUS_LABEL = {
  AWAITING: 'Needs Review',
  APPROVED: 'Approved',
  REVISION: 'Revision Required',
};

// What the FILTER TAB calls it, which is not always the same string.
const TAB_LABEL = {
  ALL: 'All',
  // RE-MEASURED 2026-10-01: the TAB now reads "Awaiting Verification" while the panel PILL still
  // reads "Needs Review" (STATUS_LABEL above) - the two surfaces disagree again, which is exactly
  // why these maps are kept separate. History: "Need Review" (to 2026-08), "Needs Review"
  // (2026-09-22), "Awaiting Verification" (now). scripts/probe-agent-verifications-4.js measures it.
  // RE-MEASURED 2026-10-05 and confirmed by the user: the tab reads "Needs Review", the same as
  // the pill (test id agent-verifications-tab-awaiting-verification, activeFilter=AWAITING).
  AWAITING: 'Needs Review',
  APPROVED: 'Approved',
  REVISION: 'Revision Required',
};

const TAB_TESTID = {
  ALL: 'agent-verifications-tab-all',
  AWAITING: 'agent-verifications-tab-awaiting-verification',
  APPROVED: 'agent-verifications-tab-approved',
  REVISION: 'agent-verifications-tab-revision-required',
};

class AgentVerificationsPage extends BasePage {
  constructor(page) {
    super(page);
    this.url = `${APP}/verifications`;

    // Layered most-stable-first, per the repo's selector strategy.
    this.searchBox = page.locator(
      '[data-testid="agent-verifications-search"], input[placeholder*="Search by document name" i], input[placeholder*="Search" i]'
    ).first();
    this.table = page.locator('table[role="grid"], table').first();
    this.rows = page.locator('table[role="grid"] tbody tr[role="row"], table tbody tr');
    this.panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
    // The two decision TRIGGERS, layered like every other locator here. They were bare
    // test-id lookups, which is the one form that cannot tell "the id was renamed" from
    // "the control is not offered on this document" - and both are things scenarios here
    // assert about. Scoped to the review panel so they can never resolve to the SUBMIT
    // button inside a decision dialog, which carries a confusingly similar label (and, per
    // the header note, a duplicated test id).
    //
    // `.first()` is safe only because of that scoping: without it the union would resolve
    // in DOM order across the whole page, which is how the community module's filter
    // popover ended up clicking a dismiss button for four scenarios.
    this.requestRevisionButton = this.panel
      .locator('[data-testid="agent-request-revision-button"]')
      .or(this.panel.getByRole('button', { name: /^request revision$/i }))
      .or(this.panel.locator('button').filter({ hasText: /^Request Revision$/ }))
      .first();

    // ---- PART 2 locators: the page as a page. See the PART 2 header near the foot of the file.

    // The <h1> wraps a <button>, so getByRole('heading') resolves the h1 and takes its name from
    // that button. Matched on the text for exactly that reason.
    this.pageHeading = page.getByRole('heading', { name: /^Verifications$/i }).first();

    // >>> role="radio" IN A radiogroup, NOT role="tab" <<< - measured, zero role=tab on the page.
    this.tabStrip = page.locator('[role="radiogroup"]').first();

    this.filtersButton = page
      .getByRole('button', { name: /^Filters(\s+\d+)?$/ })
      .or(page.locator('button').filter({ hasText: /^Filters\s*\d*$/ }))
      .first();

    // Scoped by its own heading, so it can never resolve to the review panel or a decision
    // dialog - all three are [role="dialog"] and more than one can be attached at a time.
    this.filterDialog = page.locator('[role="dialog"]').filter({ hasText: 'Apply Filters' }).first();

    // Derived from the app's own empty-state class, then from the wording as a fallback. It must
    // NOT be a bare text match on "No results found": while a filter popover is open the page can
    // hold two, and the wrong one wins an innermost-first sort.
    this.emptyState = page
      .locator('.section-empty-state')
      .or(page.locator('main').getByText(/^No results found$/).locator('xpath=..'))
      .first();

    // >>> SCOPED BY ACCESSIBLE NAME: THE SIDEBAR IS ALSO A <nav>. <<< Measured 2 nav elements.
    this.pagination = page.locator('nav[aria-label*="Pagination" i]').first();
    this.approveButton = this.panel
      .locator('[data-testid="agent-approve-button"]')
      .or(this.panel.getByRole('button', { name: /^approve( document)?$/i }))
      .or(this.panel.locator('button').filter({ hasText: /^Approve( Document)?$/ }))
      .first();
  }

  // ---------------------------------------------------------------- listing

  // NO waitForLoadState('networkidle') here, deliberately. Measured 2026-08-24: it cost
  // 1.4-1.7s per scenario and added nothing - the table appearing IS the signal that the
  // queue has loaded, and it is a condition on real state rather than on the network
  // happening to fall quiet for 500ms. `search()` waits on its own response for the same
  // reason. See scripts/probe-verification-load-timing.js.
  // >>> THE TAB URL VALUES CHANGED ON 2026-10-14 FROM THE API ENUM TO KEBAB-CASE SLUGS. <<<
  // Measured (scripts/probe-triage-2026-10-14.js): All -> activeFilter=all, Needs Review ->
  // needs-review, Approved -> approved, Revision Required -> revision-required. The API param is
  // unchanged (status=AWAITING|APPROVED|REVISION). The OLD values now fall back to All, so a
  // caller still passing AWAITING silently landed on the All tab - which is how the decision
  // gating step "found" no Approve/Request Revision on a Needs Review document. Callers keep
  // speaking the API enum; it is translated here, once.
  static urlSlug(value) {
    const SLUG = { ALL: 'all', AWAITING: 'needs-review', APPROVED: 'approved', REVISION: 'revision-required' };
    return SLUG[String(value)] || value;
  }

  async open(filter = 'ALL') {
    await this.navigate(`${this.url}?activeFilter=${AgentVerificationsPage.urlSlug(filter)}`);
    await this.table.waitFor({ state: 'visible', timeout: 30000 });
  }

  // The listing is server-searched (GET .../documents/all/?search=), so this waits on the
  // response rather than on a timeout. Waiting on the DOM alone races the re-render and
  // reads the PREVIOUS result set, which is how a row-count assertion passes against
  // stale rows.
  async search(term) {
    const responded = this.page.waitForResponse(
      (r) => /\/candidate\/documents\/all\//.test(r.url()) && r.url().includes(`search=${encodeURIComponent(term)}`),
      { timeout: 30000 }
    ).catch(() => null);
    await this.searchBox.fill(term);
    await responded;
    await this.page.waitForTimeout(400); // one paint after the response lands
  }

  async selectTab(status) {
    const testid = TAB_TESTID[status];
    if (!testid) throw new Error(`Unknown status tab "${status}". Known: ${Object.keys(TAB_TESTID).join(', ')}`);
    await this.page.locator(`[data-testid="${testid}"]`).click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  // Read the whole listing structurally. Each row's cells are taken in column order
  // rather than by class name, so a Tailwind churn cannot break it.
  async readRows() {
    const n = await this.rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const cells = this.rows.nth(i).locator('td');
      const text = (await cells.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      out.push({
        index: i,
        documentName: text[0] || '',
        uploadedBy: text[1] || '',
        documentType: text[2] || '',
        dateUploaded: text[3] || '',
        status: text[4] || '',
        raw: text,
      });
    }
    return out;
  }

  // Find one row by the file name the API stored. Uploaded files gain a random suffix
  // (FILE-01_allowed_pdf_Yp8uMlZ.pdf), so this matches on a prefix and REFUSES to guess
  // when several rows match - the same discipline AdminPromoToolsPage.disambiguate()
  // enforces after a `hasText` substring match silently opened the wrong agent.
  async findRow(fileNameOrPrefix) {
    const rows = await this.readRows();
    const hits = rows.filter((r) => r.documentName.includes(fileNameOrPrefix));
    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      throw new Error(
        `No verification row matches "${fileNameOrPrefix}".\nRows on screen: ` +
          (rows.map((r) => r.documentName).join(', ') || '(none)')
      );
    }
    const exact = hits.filter((r) => r.documentName === fileNameOrPrefix);
    if (exact.length === 1) return exact[0];
    throw new Error(
      `"${fileNameOrPrefix}" matches ${hits.length} rows and none matches exactly, so this would ` +
        `open an arbitrary one:\n  ${hits.map((r) => r.documentName).join('\n  ')}`
    );
  }

  // ------------------------------------------------------------------ panel

  async openDocument(fileNameOrPrefix) {
    const row = await this.findRow(fileNameOrPrefix);
    await this.rows.nth(row.index).locator('[data-testid="agent-verifications-view-button"]').click();
    await this.panel.waitFor({ state: 'visible', timeout: 30000 });
    // The document itself renders after the panel frame does, so wait for the
    // information block rather than for the dialog. Reading too early returns a panel
    // with empty fields, which is indistinguishable from a panel that failed to load.
    await this.panel.getByText('Document Information', { exact: false }).waitFor({ timeout: 30000 });
    return row;
  }

  async closePanel() {
    const close = this.panel.getByRole('button', { name: /close/i }).first();
    if (await close.count()) await close.click().catch(() => {});
    else await this.page.keyboard.press('Escape');
    await this.panel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // Read the panel's Document Information block by LABEL rather than by position.
  // Positional reads break the moment a field is inserted, and this panel already has
  // one field (Version) that did not exist in the original design.
  async readPanel() {
    const text = (await this.panel.innerText()).replace(/\r/g, '');
    const field = (label) => {
      // "Status\nNeeds Review" - the value is the line after the label.
      const m = new RegExp(`^${label}\\s*\\n\\s*(.+)$`, 'im').exec(text);
      return m ? m[1].trim() : null;
    };
    return {
      documentName: field('Document Name'),
      documentType: field('Document Type'),
      dateUploaded: field('Date Uploaded'),
      status: field('Status'),
      version: field('Version'),
      uploadedBy: field('Uploaded By'),
      flaggedFor: await this.readFlaggedFor(),
      commentHistory: await this.readCommentHistory(),
      fullText: text,
    };
  }

  // The "Flagged for" block is where the AC's own phrases live. Measured verbatim:
  //
  //   "Authenticity could not be confirmed: The document appears to be a scan or
  //    printout, ..."
  //   "Name mismatch detected: The legal name on the document ('John Doe') does not
  //    match the applicant's declared name ('Abdul Musawwir Siddiqui')."
  //   "Name is not consistent across the document: Name 'John Doe' does not match ..."
  //   "Automated System Message"        <- who flagged it
  //
  // NOTE the API's ai_verification.criteria[].detail does NOT carry those leading
  // phrases; they exist only here and in the stored comment. So an assertion about what
  // the AGENT is shown has to read this block, not the API.
  async readFlaggedFor() {
    const heading = this.panel.getByText('Flagged for', { exact: false }).first();
    if (!(await heading.count())) return { present: false, reasons: [], flaggedBy: null, raw: '' };

    const raw = await this.panel.evaluate((root) => {
      const h = [...root.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && /^flagged for$/i.test((e.textContent || '').trim())
      );
      if (!h) return '';
      // Prefer the semantic container the build exposes (.flagged-for-section); fall back
      // to walking up from the heading only if the class is ever removed.
      let box = root.querySelector('.flagged-for-section');
      if (!box) {
        box = h.parentElement;
        for (let i = 0; i < 5 && box; i++) {
          if ((box.textContent || '').length > 120) break;
          box = box.parentElement;
        }
      }
      // Each reason is its own leaf block; join with newlines so they can be split.
      return [...box.querySelectorAll('p,li,div,span')]
        .filter((e) => e.children.length === 0 && (e.textContent || '').trim())
        .map((e) => e.textContent.trim())
        .join('\n');
    });

    const lines = raw
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((l) => !/^flagged for$/i.test(l));

    // The last line names the source ("Automated System Message" for AI, an agent's
    // name for a human decision). Treated as the source only when it carries no
    // "reason:" shape, so a reason ending the list is not mistaken for a byline.
    const last = lines[lines.length - 1] || '';
    const looksLikeSource = last && !last.includes(':') && last.length < 60;
    return {
      present: true,
      reasons: looksLikeSource ? lines.slice(0, -1) : lines,
      flaggedBy: looksLikeSource ? last : null,
      raw: lines.join('\n'),
    };
  }

  // The candidate-visible decision trail. Each entry renders as
  // "<comment> <source> - <timestamp>", source being "Agent" or the automated label.
  async readCommentHistory() {
    const heading = this.panel.getByText('Comment History', { exact: false }).first();
    if (!(await heading.count())) return [];
    return this.panel.evaluate((root) => {
      const h = [...root.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && /^comment history$/i.test((e.textContent || '').trim())
      );
      if (!h) return [];
      let box = h.parentElement;
      for (let i = 0; i < 5 && box; i++) {
        if ((box.textContent || '').length > 60) break;
        box = box.parentElement;
      }
      return [...box.children]
        .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && !/^comment history$/i.test(t));
    });
  }

  // The AC requires the ORIGINAL DOCUMENT to be visible alongside the summary.
  //
  // MEASURED, NOT GUESSED (scripts/probe-document-review-panel.js, 2026-08-24). The panel
  // renders the file with **react-pdf**:
  //
  //     .document-preview-container > .pdf-container > .react-pdf__Document
  //         > .react-pdf__Page > canvas.react-pdf__Page__canvas    (572x808 when settled)
  //
  // A first attempt looked for `iframe, embed, object, canvas, img[src*="documents"]` and
  // found nothing on a panel that was plainly showing the document, because at that moment
  // react-pdf was still showing `.react-pdf__message--loading`. There is no <iframe> and
  // no <img> at any point.
  //
  // >>> THE DOCUMENT TAKES ABOUT 9.5 SECONDS TO RENDER. <<<
  // Timeline measured across the whole window: loading=true through +8511ms, first page
  // and canvas present at +9545ms. So "the panel is open" is emphatically NOT "the
  // document is displayed", and anything that reads the viewer without waiting reads the
  // loader and reports the document as absent. Same trap as the community crop modal,
  // where "Save is clickable" was mistaken for "the cropper is ready".
  async waitForDocumentRendered(timeout = 45000) {
    const loading = this.panel.locator('.react-pdf__message--loading');
    const page = this.panel.locator('.react-pdf__Page, canvas.react-pdf__Page__canvas');
    const startedAt = Date.now();
    // Wait for a rendered page rather than for the loader to vanish: an error state also
    // clears the loader, and "failed to render" must not read as "rendered".
    await page.first().waitFor({ state: 'visible', timeout }).catch(() => {});
    const rendered = await page.count();
    if (!rendered) {
      const errored = await this.panel.locator('.react-pdf__message--error').count();
      const stillLoading = await loading.count();
      throw new Error(
        `The document did not render within ${timeout}ms (${Date.now() - startedAt}ms elapsed). ` +
          `react-pdf state: error=${Boolean(errored)} stillLoading=${Boolean(stillLoading)}. ` +
          'Note the viewer normally settles in about 9.5s.'
      );
    }
    return { renderedInMs: Date.now() - startedAt };
  }

  async documentViewer() {
    await this.waitForDocumentRendered().catch(() => {});
    const canvas = this.panel.locator('canvas.react-pdf__Page__canvas, .react-pdf__Page canvas').first();
    const container = this.panel.locator('.document-preview-container, .pdf-container, .react-pdf__Document').first();
    const target = (await canvas.count()) ? canvas : container;
    if (!(await target.count())) {
      return { present: false, tag: null, width: 0, height: 0, zoomControls: false, state: 'no viewer element at all' };
    }
    const box = await target.boundingBox();
    return {
      present: Boolean(box && box.width > 100 && box.height > 100),
      tag: await target.evaluate((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}`),
      width: box ? Math.round(box.width) : 0,
      height: box ? Math.round(box.height) : 0,
      // The zoom control is part of "displayed alongside" - the agent has to be able to
      // read the document, not merely have it on screen.
      zoomControls: (await this.panel.getByText(/^\d+%$/).count()) > 0,
      stillLoading: (await this.panel.locator('.react-pdf__message--loading').count()) > 0,
      errored: (await this.panel.locator('.react-pdf__message--error').count()) > 0,
    };
  }

  // -------------------------------------------------------------- decisions

  // Open a decision dialog WITHOUT submitting. Returns its contract so the mandatory-
  // reason scenarios can inspect it.
  async openDecisionDialog(decision) {
    const trigger = decision === 'approve' ? this.approveButton : this.requestRevisionButton;
    const before = await this.page.locator('[role="dialog"]').count();
    await trigger.click();
    await this.page
      .waitForFunction((n) => document.querySelectorAll('[role="dialog"]').length > n, before, { timeout: 20000 })
      .catch(() => {
        throw new Error(`Clicking the ${decision} control opened no dialog within 20s`);
      });
    const dialog = this.page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: 'visible' });
    return dialog;
  }

  // The submit control INSIDE a decision dialog.
  //
  // Matched by visible text and not by test id, because the Approve dialog's submit
  // button carries `agent-submit-request-revision-button` too (see the header note).
  // A test id selector here would be ambiguous between two opposite actions, and on a
  // page where both dialogs have been opened it could resolve to the wrong one.
  submitControl(dialog, decision) {
    const label = decision === 'approve' ? /^approve document$/i : /^request revision$/i;
    return dialog.locator('button').filter({ hasText: label }).first();
  }

  reasonField(dialog) {
    return dialog.locator('textarea, input[type="text"]').first();
  }

  // Read whether the decision can be submitted with the given reason, WITHOUT submitting.
  // Used by the mandatory-reason scenarios, which must never commit a decision.
  async probeReasonGating(dialog, decision, reason) {
    const submit = this.submitControl(dialog, decision);
    if (!(await submit.count())) {
      throw new Error(`The ${decision} dialog has no submit control matching its own label`);
    }
    if (reason !== null && reason !== undefined) {
      await this.reasonField(dialog).fill(reason);
      // The gate settles asynchronously, so read it after the form has had a tick.
      // Reading once immediately is what intermittently reported a working gate as broken
      // elsewhere in this repo.
      await this.page.waitForTimeout(600);
    }
    return {
      reason: reason === null || reason === undefined ? '(untouched)' : JSON.stringify(reason),
      submitDisabled: await submit.isDisabled(),
      fieldValue: await this.reasonField(dialog).inputValue(),
    };
  }

  async cancelDialog(dialog) {
    const cancel = dialog.locator('button').filter({ hasText: /^cancel$/i }).first();
    if (await cancel.count()) await cancel.click();
    else await this.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  // COMMITS the decision. Separate from the probe methods on purpose, and it verifies the
  // control it is about to click really belongs to the decision it was asked to make -
  // because the duplicated test id means a mis-scoped selector could approve a document
  // when asked to request a revision, and nothing in the portal undoes either.
  async submitDecision(dialog, decision, reason) {
    if (!reason || !reason.trim()) {
      throw new Error('submitDecision was called with an empty reason. The reason is mandatory.');
    }
    await this.reasonField(dialog).fill(reason);
    const submit = this.submitControl(dialog, decision);
    const label = (await submit.innerText()).trim();
    const expected = decision === 'approve' ? /approve/i : /revision/i;
    if (!expected.test(label)) {
      throw new Error(
        `Refusing to click "${label}" for a "${decision}" decision. These are opposite actions and ` +
          'the build gives both submit buttons the same data-testid, so a mis-scoped selector here ' +
          'would commit the wrong one irreversibly.'
      );
    }
    await this.page.waitForTimeout(400);
    if (await submit.isDisabled()) {
      throw new Error(`The ${decision} submit control is still disabled after entering a reason: "${reason}"`);
    }
    const responded = this.page
      .waitForResponse((r) => /\/candidate\/documents\/update\//.test(r.url()) && r.request().method() !== 'GET', {
        timeout: 30000,
      })
      .catch(() => null);
    await submit.click();
    const res = await responded;
    await dialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    return { httpStatus: res ? res.status() : null, decision, reason };
  }
}

// ===========================================================================================
// PART 2 - THE PAGE AS A PAGE (added 2026-09-22 for features/Agent_Portal/verifications.feature)
// ===========================================================================================
//
// Everything above this line was written for the AI Document Verification module, which drives
// /verifications only as a MEANS - it uploads a document, then reads that document's status and
// commits a decision. Nothing above covers the screen as a screen: the tab strip, the search,
// the Filters modal, pagination, the empty states, the viewer's zoom, or the decision dialogs'
// own contract.
//
// >>> ONE PAGE OBJECT, NOT TWO. <<< A second object for the same route is how two readers of one
// screen drift, and this repo has paid for that more than once. Everything below is additive;
// no method above changed.
//
// MEASURED LIVE 2026-09-22 by scripts/probe-agent-verifications{,-2,-3}.js, which commit nothing.
// Re-run them rather than reasoning about the DOM.
//
//   route            /verifications  -> redirects to ?activeFilter=ALL
//   heading          "Verifications" (a <button> inside the <h1>)
//   grid             role=grid, accessible name "Verifications"
//   columns          Document Name | Uploaded By | Document Type | Date Uploaded | Status | Actions
//   list endpoint    GET /core/api/v1/candidate/documents/all/?page=1&page_size=10&search=
//   search           ?search=<term>, debounced; matches the DOCUMENT NAME only
//   row actions      View + Download (both real <button aria-label>, both operable - see below)
//
// SIX THINGS THAT WOULD BE EASY TO GET WRONG HERE. Each has a wrong assertion behind it.
//
//  1. >>> THE TAB STRIP IS role="radio" IN A radiogroup, NOT role="tab". <<< Measured: zero
//     elements with role=tab on a page that plainly renders four tabs. A getByRole('tab') reader
//     finds nothing.
//
//  2. >>> THE PARAM NAMES DIFFER BETWEEN THE URL AND THE WIRE, IN BOTH CONTROLS, AND IN
//     OPPOSITE WAYS. <<<
//        tabs    URL `activeFilter=AWAITING` -> API `status=AWAITING`   (name differs, value same)
//        filter  URL `documentType=EDUCATION` -> API `category=EDUCATION` (name differs, value same)
//     So both must be asserted. Checking only the URL passes on a front end that rewrites the
//     address bar and queries the server for something else, and reading the rendered rows cannot
//     catch it either. Note the FILTER's three values are the API's own enum while its LABELS are
//     not: Transcript=EDUCATION, Experience Letter=WORKEXPERIENCE, Certification=CERTIFICATION.
//
//  3. >>> THE ALL TAB SENDS NO `status` PARAMETER AT ALL <<< - it is an absence, not a value. A
//     reader expecting `status=ALL` finds nothing and reports the tab as broken.
//
//  4. >>> THE APP ALWAYS SENDS `search=`, EVEN EMPTY. <<< So "a request carrying search=" is not
//     evidence a search was applied. Assert the VALUE.
//
//  5. >>> THE GRID KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. <<< A read after
//     a fixed delay does not fail - it reports the OLD list as the new one. `settleAgainstServer`
//     is the settle and every list-changing action goes through it. DO NOT ADD ONE THAT DOES NOT.
//
//  6. >>> THERE ARE TWO <nav> ELEMENTS ON THE PAGE. <<< The sidebar is one. An unscoped
//     pagination reader resolves to "Dashboard Candidates Verifications Activity Log". The pager
//     is scoped by its accessible name.
//
// THE DECISION CONTROLS, AND WHY NOTHING BELOW CLICKS A SUBMIT.
// Approve and Request Revision are IRREVERSIBLE and nothing in the product undoes either. The
// page-level feature therefore opens both dialogs, reads their contract and their mandatory-
// reason gate, and CANCELS. `submitDecision()` above remains the only committing method and is
// driven only by features/AI Document Verification, which already owns that chain and already
// pays for it. Do not add a second committing path here.
//
// AN ACCESSIBILITY FINDING THAT DISSOLVED UNDER A CONTROL - recorded so nobody re-files it.
// A 40-press Tab walk never lands on View or Download, and `view.focus()` does not focus the
// button either (focus is redirected to the row). Both readings say "the row actions are
// unreachable by keyboard", and BOTH ARE WRONG. This is a react-aria grid with a roving
// tabindex: the ROW is one tab stop and the cells are reached with the ARROW KEYS. Measured -
// Tab x3 reaches the row, then ArrowRight walks document name -> candidate -> email -> type ->
// date -> status -> View -> Download, and **Enter on each one works**: Enter on View opens the
// panel, Enter on Download delivers the file. So there is no defect, and a Tab-only audit would
// have filed a phantom one. `auditRowActionKeyboard()` below drives the arrow-key model on
// purpose and is the only honest way to ask this question of a grid.

// What the Filters modal's Document Type labels mean on the wire. The label is the agent's
// vocabulary, the value is the API's; neither can be derived from the other.
const DOCUMENT_TYPE = {
  Transcript: 'EDUCATION',
  'Experience Letter': 'WORKEXPERIENCE',
  Certification: 'CERTIFICATION',
};

// Both empty states, verbatim. They are NOT interchangeable: a reader looking only for
// "No results found" answers "absent" on a genuinely empty tab, which reads as the empty state
// being missing altogether.
const EMPTY_STATES = {
  noResults: {
    heading: 'No results found',
    body: "We couldn't find any results matching your current search.",
  },
  // A filter (no search) that matches nothing - measured 2026-10-01, with a "Clear all filters" CTA.
  noFilterResults: {
    heading: 'No results found',
    body: "We couldn't find any results matching your current filters.",
  },
  // The GENUINELY empty queue. Measured 2026-10-01 this is also what a server error, a network
  // failure and an out-of-range page render - the known issue in section 10 of the feature.
  emptyQueue: {
    heading: 'No documents to verify yet',
    body: "Uploaded documents from candidates will appear here once they're submitted for review.",
  },
};

const LIST_PATH = '/candidate/documents/all/';

Object.assign(AgentVerificationsPage.prototype, {
  // ------------------------------------------------------------------ request log

  // Called ONCE PER SCENARIO from hooks.js / PagesFixture.js, BEFORE the first navigation - the
  // same way ActivityLogPage, RequiresAttentionPage and DeactivatedCandidatePage are. Three
  // reasons, and the second is what forced it:
  //
  //  1. Several assertions read the query the app sent for an action taken steps earlier.
  //  2. TWO ASSERTED BEHAVIOURS ARE AN ACTION THAT CORRECTLY FIRES NO REQUEST - re-picking the
  //     tab already selected, and opening the review panel (which re-renders data already held).
  //     A `waitForResponse` there resolves to null, which is INDISTINGUISHABLE from a timeout, a
  //     slow network or a listener attached too late. A running log tells "nothing was sent"
  //     apart from "something was sent and I missed it".
  //  3. The server's own `count` is the only figure two result sets can be compared by: the
  //     render is capped at page_size, so two queries differing only past page one look
  //     identical on screen.
  //
  // Never reset mid-scenario; steps take an index baseline instead, so a step can ask what
  // happened AFTER a point without destroying what came before.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.requests = [];
    this.responses = [];
    this._parsing = [];

    this.page.on('request', (req) => {
      if (req.method() !== 'GET' || !req.url().includes(LIST_PATH)) return;
      this.requests.push({
        at: Date.now(),
        url: req.url(),
        query: decodeURIComponent(req.url().split(LIST_PATH)[1] || ''),
      });
    });

    this.page.on('response', (res) => {
      if (res.request().method() !== 'GET' || !res.url().includes(LIST_PATH)) return;
      // >>> READING A BODY IS ASYNCHRONOUS AND PLAYWRIGHT DOES NOT AWAIT AN EVENT HANDLER. <<<
      // A response that has ARRIVED is not yet one that has been READ, so every parse is tracked
      // and flush() awaits the outstanding ones. Without this a settle resolves while the reader
      // still answers null - which reads as "the app never fetched anything".
      const p = res
        .json()
        .then((body) => {
          this.responses.push({
            at: Date.now(),
            query: decodeURIComponent(res.url().split(LIST_PATH)[1] || ''),
            count: typeof body.count === 'number' ? body.count : null,
            results: Array.isArray(body.results) ? body.results : [],
          });
        })
        .catch(() => {});
      this._parsing.push(p);
    });
  },

  async flush() {
    const pending = this._parsing || [];
    this._parsing = [];
    await Promise.all(pending);
  },

  requestCount() {
    return (this.requests || []).length;
  },

  responseCountSync() {
    return (this.responses || []).length;
  },

  async responseCount() {
    await this.flush();
    return (this.responses || []).length;
  },

  // The queries sent since an index baseline. Returns query strings, not URLs, because every
  // assertion here is about a parameter.
  requestsSince(baseline = 0) {
    return (this.requests || []).slice(baseline).map((r) => r.query);
  },

  async lastListResponse() {
    await this.flush();
    const log = this.responses || [];
    return log.length ? log[log.length - 1] : null;
  },

  // The server's own total for the last list query. Preferred over a rendered row count wherever
  // a figure is compared against another figure - see reason 3 in install().
  async lastListCount() {
    const last = await this.lastListResponse();
    return last ? last.count : null;
  },

  async lastListQuery() {
    const last = await this.lastListResponse();
    return last ? last.query : null;
  },

  // A parsed view of the last query's parameters. `getAll` matters: the Document Type filter is
  // repeatable (`category=EDUCATION&category=CERTIFICATION`), so a single-value read would report
  // a working union as one option.
  async lastListParams() {
    const q = await this.lastListQuery();
    if (q === null) return null;
    const sp = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
    const out = {};
    for (const key of new Set(sp.keys())) out[key] = sp.getAll(key);
    return out;
  },

  // The URL's own parameters, read with URLSearchParams rather than a regex over the string.
  // >>> `decodeURIComponent` DOES NOT TURN "+" BACK INTO A SPACE <<<, so a multi-word term
  // compared that way can never match a URL that correctly encodes it. This bit the shared
  // `the URL should contain the search term` step in steps/active-candidate.js.
  urlParams() {
    const sp = new URL(this.page.url()).searchParams;
    const out = {};
    for (const key of new Set(sp.keys())) out[key] = sp.getAll(key);
    return out;
  },

  // ------------------------------------------------------------------ navigation & settling

  // `params` is written straight onto the query string, so a step can deep-link a tab, a filter,
  // a search, several at once, or a deliberately invalid value.
  // `raw: true` sends activeFilter exactly as given - for the scenario that checks what the app
  // does with an unusable or retired value. Everything else is translated to the URL slug.
  async openWith(params = {}, { raw = false } = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      (Array.isArray(v) ? v : [v]).forEach((one) => sp.append(k, (k === 'activeFilter' && !raw) ? AgentVerificationsPage.urlSlug(one) : one));
    }
    const qs = sp.toString();
    const before = this.responseCountSync();
    await this.page.goto(qs ? `${this.url}?${qs}` : this.url, { waitUntil: 'domcontentloaded' });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await this.settleAgainstServer(before).catch(() => {});
    return this.settleList();
  },

  // Resolve on ROWS **OR** THE EMPTY STATE, never on rows alone: a tab or a search legitimately
  // renders nothing, and a rows-only wait would hang for exactly the cases several scenarios
  // exist to inspect.
  async settleList(timeout = 25000) {
    return Promise.race([
      this.rows.first().waitFor({ state: 'visible', timeout }).then(() => 'rows'),
      this.emptyState.waitFor({ state: 'visible', timeout }).then(() => 'empty'),
    ]).catch(() => 'neither');
  },

  // >>> THE GRID KEEPS THE PREVIOUS QUERY'S ROWS WHILE THE NEXT IS IN FLIGHT. <<<
  // Wait for a response newer than `baseline`, then poll the render until it matches that
  // payload. Matched against `results.length`, NEVER `count`: the endpoint pages at 10, so a
  // higher count is correct and the render legitimately stops there.
  async settleAgainstServer(baseline, timeout = 30000) {
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await this.flush();
      if (this.responseCountSync() > baseline) break;
      await this.page.waitForTimeout(150);
    }
    await this.flush();
    if (this.responseCountSync() <= baseline) return null;

    const latest = await this.lastListResponse();
    const want = latest.results.length;
    while (Date.now() < deadline) {
      const rendered = await this.rows.count();
      if (rendered === want) break;
      if (want === 0 && (await this.emptyState.isVisible().catch(() => false))) break;
      await this.page.waitForTimeout(150);
    }

    // >>> A MATCHING ROW COUNT IS NOT A POPULATED GRID. <<<
    // The rows arrive before their CELLS do, so `rendered === want` is satisfied while a cell is
    // still blank - and a read taken there does not fail, it reports an empty Document Type as the
    // row's actual type. Measured on a full run: one row came back as `""` and the filter scenario
    // reported `expected every row to read "Transcript", got ["","Transcript"]` against a filter
    // that is completely correct.
    //
    // Exactly the billing grid's ten blank skeleton rows, one surface along. So the settle has a
    // second phase: wait until every row has actually painted its identity and type cells.
    //
    // It GIVES UP QUIETLY rather than throwing. A document legitimately holding no type would
    // otherwise hang here for the whole budget and report a working queue as broken - and the
    // caller can still see what it got. The extra wait is bounded by the same deadline.
    while (Date.now() < deadline) {
      const blanks = await this.rows.evaluateAll((rs) =>
        rs.filter((r) => {
          const cells = r.querySelectorAll('td');
          const name = (cells[0] && cells[0].innerText || '').trim();
          const type = (cells[2] && cells[2].innerText || '').trim();
          return !name || !type;
        }).length
      );
      if (!blanks) break;
      await this.page.waitForTimeout(150);
    }
    /* eslint-enable no-await-in-loop */
    return latest;
  },

  // ------------------------------------------------------------------ tabs

  async readTabs() {
    return this.tabStrip.locator('[role="radio"]').evaluateAll((rs) =>
      rs.map((r) => ({
        label: r.innerText.replace(/\s+/g, ' ').trim(),
        testid: r.getAttribute('data-testid'),
        selected: r.getAttribute('aria-checked') === 'true',
      }))
    );
  },

  async selectedTab() {
    const tabs = await this.readTabs();
    const on = tabs.filter((t) => t.selected);
    return { selected: on.map((t) => t.label), count: on.length, all: tabs.map((t) => t.label) };
  },

  // Selecting a tab that is already selected correctly fires NO request, so the caller decides
  // whether to settle. Returns the response baseline it took, so a step can ask what was sent.
  async chooseTab(status, { settle = true } = {}) {
    const testid = TAB_TESTID[status];
    if (!testid) throw new Error(`Unknown status tab "${status}". Known: ${Object.keys(TAB_TESTID).join(', ')}`);
    const baseline = this.responseCountSync();
    await this.page.locator(`[data-testid="${testid}"]`).click();
    if (settle) await this.settleAgainstServer(baseline).catch(() => {});
    return baseline;
  },

  // ------------------------------------------------------------------ search

  // The control fires only when the value CHANGES, so this clears first - otherwise typing a term
  // equal to the one already applied sends nothing and the read is of the previous result. That
  // is also what lets a variations table drive two terms that happen to be identical (a name and
  // its own uppercase) without one silently measuring the other.
  //
  // Real keystrokes, never a bare fill(): the box is debounced and a scripted value-set is not
  // reliably what the app listens to.
  async searchFor(term, { settle = true } = {}) {
    await this.clearSearch();
    const baseline = this.responseCountSync();
    await this.searchBox.click();
    await this.searchBox.pressSequentially(term, { delay: 25 });
    if (settle) await this.settleAgainstServer(baseline, 35000).catch(() => {});
    return baseline;
  },

  // Settles ONLY if the box had content. An unconditional settle would wait out its whole budget
  // on an already-empty box and report a working control as broken.
  async clearSearch() {
    const had = (await this.searchBox.inputValue().catch(() => '')).length > 0;
    if (!had) return null;
    const baseline = this.responseCountSync();
    await this.searchBox.fill('');
    await this.settleAgainstServer(baseline, 35000).catch(() => {});
    return baseline;
  },

  async searchValue() {
    return this.searchBox.inputValue().catch(() => null);
  },

  async searchPlaceholder() {
    return this.searchBox.getAttribute('placeholder');
  },

  // ------------------------------------------------------------------ the Filters modal

  async openFilters() {
    await this.filtersButton.click();
    await this.filterDialog.waitFor({ state: 'visible', timeout: 15000 });
    return this.filterDialog;
  },

  // The badge text, e.g. "Filters" or "Filters 1".
  //
  // >>> IT COUNTS GROUPS, NOT OPTIONS. <<< Two Document Type options selected still reads
  // "Filters 1" (measured). Requires Attention and Deactivated behave the same way; the Active
  // tab's own scenarios assert the OPTION count for the same-looking badge, so the listings
  // genuinely disagree about what the number means. Asserted as measured on each surface - do
  // not "align" them without a product answer.
  async filtersBadge() {
    return (await this.filtersButton.innerText()).replace(/\s+/g, ' ').trim();
  },

  async appliedFilterCount() {
    const m = /(\d+)\s*$/.exec(await this.filtersBadge());
    return m ? Number(m[1]) : 0;
  },

  // >>> ONE PASS PRODUCES THE LIST A STEP READS AND THE INDEX A CLICK ACTS ON. <<<
  // Walks every <label> in DOM order rather than selecting by test id: the Document Type labels
  // carry one, the Date Uploaded controls do NOT, so a testid-only reader sees 3 of 5 and any
  // assertion counting them passes having inspected three. The community module lost four
  // scenarios to a reader and a clicker indexing two different lists.
  async readFilterOptions() {
    return this.filterDialog.locator('label').evaluateAll((ls) =>
      ls.map((l, index) => {
        const input = l.querySelector('input') || (l.htmlFor ? document.getElementById(l.htmlFor) : null);
        return {
          index,
          label: l.innerText.replace(/\s+/g, ' ').trim(),
          type: input ? input.type : null,
          testid: l.getAttribute('data-testid'),
          checked: input && input.type === 'checkbox' ? input.checked : null,
          // react-aria pressable labels ignore a scripted element.click() - see selectFilterOption.
          pressable: l.hasAttribute('data-react-aria-pressable'),
        };
      })
    );
  },

  // The groups the modal offers, read from its own headings rather than from a list repeated
  // from a ticket.
  async readFilterGroups() {
    // STRUCTURAL, not a known-list. The old reader filtered the dialog text against
    // ['Document Type', 'Date Uploaded'], so it could only ever answer with those two - and when
    // the build added a third group (Status, measured 2026-10-01) it went on reporting exactly
    // two and the "exactly these groups" assertion passed blind. A group heading is any line of
    // the dialog that is not its title, an option label, a button or an input placeholder.
    return this.filterDialog.evaluate((d) => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const lines = d.innerText.split('\n').map(norm).filter(Boolean);
      const exclude = new Set([lines[0]]);
      d.querySelectorAll('label').forEach((l) => exclude.add(norm(l.innerText)));
      d.querySelectorAll('button').forEach((b) => exclude.add(norm(b.innerText)));
      d.querySelectorAll('input').forEach((i) => exclude.add(norm(i.getAttribute('placeholder'))));
      return lines.slice(1).filter((l) => !exclude.has(l) && !/^[DMY/]+$/.test(l));
    });
  },

  // >>> A REAL PLAYWRIGHT POINTER CLICK, NEVER element.click(). <<< These labels carry
  // `data-react-aria-pressable` and ignore a scripted click entirely - a mixed pass through the
  // SuperAdmin Candidates modal reported three working checkbox groups as ignored by the app,
  // a defect that did not exist.
  //
  // Matched on the EXACT label, never a filter({hasText}) substring: "Transcript" would otherwise
  // also match nothing here but "Certification" would match any option containing it, and the
  // same reader is used on groups where that bites.
  async selectFilterOption(label) {
    const options = await this.readFilterOptions();
    const hit = options.filter((o) => o.label === label);
    if (hit.length !== 1) {
      throw new Error(
        `"${label}" matches ${hit.length} filter options, so this would click an arbitrary one.\n` +
          `Options offered: ${options.map((o) => JSON.stringify(o.label)).join(', ')}`
      );
    }
    await this.filterDialog.locator('label').nth(hit[0].index).click();
    return hit[0];
  },

  async applyFilters({ settle = true } = {}) {
    const baseline = this.responseCountSync();
    await this.filterDialog.locator('[data-testid="filters-apply-button"]').click();
    await this.filterDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    if (settle) await this.settleAgainstServer(baseline).catch(() => {});
    return baseline;
  },

  // Clear All applies IMMEDIATELY and leaves the modal OPEN (measured: the URL loses its filter
  // params, the badge drops back to "Filters" and a list request fires, all without Apply).
  async clearAllFilters({ settle = true } = {}) {
    const baseline = this.responseCountSync();
    await this.filterDialog.locator('[data-testid="filters-clear-all-button"]').click();
    if (settle) await this.settleAgainstServer(baseline).catch(() => {});
    return baseline;
  },

  async cancelFilters() {
    const baseline = this.responseCountSync();
    await this.filterDialog.getByRole('button', { name: /^Cancel$/ }).click();
    await this.filterDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return baseline;
  },

  async closeFiltersByIcon() {
    await this.filterDialog.getByRole('button', { name: /close/i }).first().click();
    await this.filterDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  },

  async filtersDialogOpen() {
    return this.filterDialog.isVisible().catch(() => false);
  },

  // ------------------------------------------------------------------ empty state

  // RE-READS the page every time. A cached snapshot would defeat the scenario that asserts one
  // wording, changes the query and asserts another - it would pass no matter what the app did.
  async readEmptyState() {
    if (!(await this.emptyState.isVisible().catch(() => false))) {
      return { present: false, heading: null, body: null, raw: '' };
    }
    const raw = (await this.emptyState.innerText()).replace(/\s+/g, ' ').trim();
    const lines = (await this.emptyState.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
    return { present: true, heading: lines[0] || null, body: lines[1] || null, raw };
  },

  // ------------------------------------------------------------------ pagination

  // >>> SCOPED BY ACCESSIBLE NAME: THE SIDEBAR IS ALSO A <nav>. <<< Measured 2 nav elements on
  // the page; an unnamed reader resolves to the sidebar and reports its links as pagination.
  async readPagination() {
    if (!(await this.pagination.count())) return { present: false, pages: [], previous: null, next: null };
    const items = await this.pagination.locator('li,button').evaluateAll((es) =>
      es.map((e) => ({
        text: e.innerText.replace(/\s+/g, ' ').trim(),
        aria: e.getAttribute('aria-label'),
        disabled: e.disabled === true,
      }))
    );
    return {
      present: true,
      pages: items.filter((i) => /^Page \d+$/.test(i.aria || '')).map((i) => i.text),
      previous: items.find((i) => /previous/i.test(i.aria || '')) || null,
      next: items.find((i) => /next/i.test(i.aria || '')) || null,
      raw: items,
    };
  },

  async goToNextPage() {
    const baseline = this.responseCountSync();
    await this.pagination.getByRole('button', { name: /next/i }).click();
    await this.settleAgainstServer(baseline).catch(() => {});
    return baseline;
  },

  // ------------------------------------------------------------------ the review panel

  // Open the panel for a row by INDEX rather than by file name. The queue is shared DEV data and
  // its contents change under the suite, so no scenario may pin a document - and the row's own
  // cells are what every panel assertion is compared against, which is stronger than comparing
  // the panel to a string repeated from the Gherkin.
  async openRow(index = 0) {
    const rows = await this.readRows();
    if (!rows.length) throw new Error('There are no rows on this listing to open.');
    if (!rows[index]) throw new Error(`Row ${index} does not exist; the listing holds ${rows.length}.`);
    const urlBefore = this.page.url();
    await this.rows.nth(index).locator('[data-testid="agent-verifications-view-button"]').click();
    await this.panel.waitFor({ state: 'visible', timeout: 30000 });
    await this.panel.getByText('Document Information', { exact: false }).waitFor({ timeout: 30000 });
    return { row: rows[index], urlBefore, urlAfter: this.page.url() };
  },

  async panelOpen() {
    return this.panel.isVisible().catch(() => false);
  },

  async closePanelByEscape() {
    await this.page.keyboard.press('Escape');
    await this.panel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return this.panelOpen();
  },

  // The panel's own controls, so a step can assert which are OFFERED without using any of them.
  async readPanelControls() {
    return this.panel.locator('button').evaluateAll((bs) =>
      bs.map((b) => ({
        label: (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim(),
        testid: b.getAttribute('data-testid'),
        disabled: b.disabled === true,
        tabIndex: b.tabIndex,
      }))
    );
  },

  // >>> THE "Uploaded By" BLOCK RENDERS THREE LINES, AND THE FIRST IS THE AVATAR'S INITIALS. <<<
  // `readPanel()`'s generic `field()` takes "the line after the label", which here is **"GH"** -
  // not the candidate's name. A probe written that way compared "GH" against the profile header
  // and reported that the panel's profile link opens the WRONG person, on a build that opens
  // exactly the right one. Measured: the block is [initials, name, email].
  //
  // So the three parts are identified by what they ARE - the email is the line holding "@", the
  // initials are the short all-caps line - rather than by position.
  async readPanelUploader() {
    const text = await this.panel.innerText();
    const block = /Uploaded By\s*\n+([\s\S]*?)(?:\n\s*\n|$)/.exec(text.replace(/\r/g, ''));
    const lines = (block ? block[1] : '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const email = lines.find((l) => l.includes('@')) || null;
    const initials = lines.find((l) => l !== email && /^[A-Z]{1,3}$/.test(l)) || null;
    const name = lines.find((l) => l !== email && l !== initials) || null;
    return { name, email, initials, lines };
  },

  // Follow the panel's "View profile" control. It is an icon-only button whose ACCESSIBLE NAME is
  // its only hook - it carries no test id and its inner text is empty, so a text locator finds
  // nothing on a panel that plainly offers it.
  async openUploaderProfile(timeout = 45000) {
    const before = this.page.url();
    await this.panel.getByRole('button', { name: 'View profile' }).click();
    await this.page.waitForURL(/\/candidates\/\d+\/view-profile/, { timeout }).catch(() => {});
    const after = this.page.url();
    const matched = /\/candidates\/(\d+)\/view-profile/.exec(after);
    return { before, after, candidateId: matched ? matched[1] : null };
  },

  // Which decision controls the panel offers. Read rather than used - the gating rule is asserted
  // by OBSERVING what appears per status, never by clicking one.
  async decisionControlsOffered() {
    return {
      approve: (await this.panel.locator('[data-testid="agent-approve-button"]').count()) > 0,
      requestRevision: (await this.panel.locator('[data-testid="agent-request-revision-button"]').count()) > 0,
    };
  },

  // ------------------------------------------------------------------ the viewer

  // >>> THE VIEWER RENDERS EVERY PAGE OF THE DOCUMENT AT ONCE. <<< Measured: a 5MB PDF produced
  // **1619** `.react-pdf__Page` elements with 1619 canvases, and a 4MB one 1294. Every zoom step
  // re-renders all of them, which is why a single zoom click can take minutes. Reported as a
  // known issue rather than worked around.
  async readViewer() {
    const counts = await this.panel.evaluate((p) => ({
      documents: p.querySelectorAll('.react-pdf__Document').length,
      pages: p.querySelectorAll('.react-pdf__Page').length,
      canvases: p.querySelectorAll('canvas.react-pdf__Page__canvas').length,
      loading: p.querySelectorAll('.react-pdf__message--loading').length,
      errored: p.querySelectorAll('.react-pdf__message--error').length,
    }));
    const canvas = this.panel.locator('canvas.react-pdf__Page__canvas').first();
    const box = (await canvas.count()) ? await canvas.boundingBox() : null;
    return {
      ...counts,
      rendered: Boolean(box && box.width > 100 && box.height > 100),
      width: box ? Math.round(box.width) : 0,
      height: box ? Math.round(box.height) : 0,
    };
  },

  async zoomLevel() {
    const m = /(\d+)%/.exec(await this.panel.innerText());
    return m ? Number(m[1]) : null;
  },

  // Step the zoom and report the level and the control states after each press. `settleMs` is
  // generous because every step re-renders every canvas (above).
  async stepZoom(direction, presses = 1, settleMs = 1200) {
    const control = this.panel.getByRole('button', { name: direction === 'in' ? 'Zoom in' : 'Zoom out' });
    const steps = [];
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < presses; i++) {
      if (await control.isDisabled()) {
        steps.push({ press: i + 1, level: await this.zoomLevel(), disabled: true, clicked: false });
        break;
      }
      const startedAt = Date.now();
      await control.click();
      await this.page.waitForTimeout(settleMs);
      steps.push({
        press: i + 1,
        level: await this.zoomLevel(),
        disabled: await control.isDisabled(),
        tookMs: Date.now() - startedAt,
        clicked: true,
      });
    }
    /* eslint-enable no-await-in-loop */
    return steps;
  },

  // ------------------------------------------------------------------ decision dialogs

  // >>> `openDecisionDialog()` RETURNS `[role="dialog"].last()`, WHICH RE-RESOLVES. <<<
  // That is fine while the dialog is open and WRONG the moment it closes: three dialogs can be on
  // this screen (the review panel, the Filters modal, a decision dialog), so once the decision
  // dialog is cancelled `.last()` silently resolves to THE REVIEW PANEL - which is still open and
  // still visible. Asking that handle "are you closed?" therefore answers "no" on a Cancel that
  // worked perfectly, and three scenarios reported `the decision dialog is still open after Cancel`
  // against a product doing exactly the right thing.
  //
  // So "is this decision dialog gone" is answered by a locator scoped to text only that dialog
  // carries, counted among the VISIBLE dialogs. Both markers are measured, not guessed.
  // Note it deliberately does NOT key on the submit button's label: the review panel's own trigger
  // button also reads "Request Revision", so a hasText on that matches the panel too.
  decisionDialogMarker(decision) {
    return decision === 'approve'
      ? /Confirm this document meets the verification criteria/i
      : /Help the candidate understand what needs to be fixed/i;
  },

  async decisionDialogIsOpen(decision) {
    const n = await this.page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: this.decisionDialogMarker(decision) })
      .count();
    return n > 0;
  },

  // Read a decision dialog's whole contract WITHOUT submitting: its heading, its explanation, the
  // reason field's own limits, and the gate under each of a set of candidate reasons.
  //
  // >>> IT ALWAYS CANCELS, AND THAT IS NOT OPTIONAL. <<< The submit control is never clicked.
  async probeDecisionDialog(decision, reasons = [null]) {
    const dialog = await this.openDecisionDialog(decision);
    const label = decision === 'approve' ? /^Approve document$/i : /^Request Revision$/i;
    const submit = dialog.locator('button').filter({ hasText: label }).first();
    const field = this.reasonField(dialog);

    const contract = {
      text: (await dialog.innerText()).replace(/\r/g, ''),
      heading: (await dialog.innerText()).split('\n').map((l) => l.trim()).filter(Boolean)[0] || null,
      submitLabel: (await submit.innerText()).replace(/\s+/g, ' ').trim(),
      submitTestid: await submit.getAttribute('data-testid'),
      field: await field
        .evaluate((f) => ({ tag: f.tagName, maxLength: f.maxLength, required: f.required }))
        .catch(() => null),
      buttons: await dialog.locator('button').evaluateAll((bs) =>
        bs.map((b) => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), testid: b.getAttribute('data-testid') }))
      ),
      gate: [],
    };

    /* eslint-disable no-await-in-loop */
    for (const reason of reasons) {
      if (reason !== null) {
        await field.fill('');
        await field.pressSequentially(reason, { delay: 5 });
        // The gate settles asynchronously, so read it after the form has had a tick. Reading once
        // immediately is what intermittently reported a working gate as broken elsewhere here.
        await this.page.waitForTimeout(700);
      }
      contract.gate.push({
        reason: reason === null ? '(untouched)' : reason,
        held: await field.inputValue().catch(() => null),
        submitDisabled: await submit.isDisabled(),
      });
    }
    /* eslint-enable no-await-in-loop */

    await this.cancelDialog(dialog);
    // Scoped, not `dialog.isVisible()` - see decisionDialogIsOpen() above for why that handle lies.
    contract.dialogClosed = !(await this.decisionDialogIsOpen(decision));
    return contract;
  },

  // ------------------------------------------------------------------ accessibility

  // >>> THE ONLY HONEST WAY TO ASK "CAN A KEYBOARD USER OPERATE A ROW ACTION" ON A react-aria
  // GRID. <<< See the header note: Tab reaches the ROW, and the cells inside it are reached with
  // the ARROW KEYS. A Tab-only walk answers "unreachable" on a grid that works perfectly, and
  // `button.focus()` answers the same way because focus is redirected to the row.
  //
  // Takes a CONTROL as well: the search box must be focusable by Tab, or "nothing focused" is
  // just a broken walk rather than a finding about the grid.
  async auditRowActionKeyboard(want, { activate = true } = {}) {
    const active = () =>
      this.page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return 'none';
        return `${a.tagName}[${a.getAttribute('role') || '-'}]:${(
          a.getAttribute('aria-label') ||
          a.getAttribute('data-testid') ||
          a.innerText ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40)}`;
      });

    await this.searchBox.focus();
    const control = /^INPUT/.test(await active());

    const tabStops = [];
    let reachedRow = false;
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 20; i++) {
      await this.page.keyboard.press('Tab');
      const a = await active();
      tabStops.push(a);
      if (/^TR\[row\]/.test(a)) { reachedRow = true; break; }
    }

    const arrowStops = [];
    let reached = false;
    if (reachedRow) {
      for (let i = 0; i < 10; i++) {
        await this.page.keyboard.press('ArrowRight');
        await this.page.waitForTimeout(200);
        const a = await active();
        arrowStops.push(a);
        if (new RegExp(`:${want}$`).test(a)) { reached = true; break; }
      }
    }
    /* eslint-enable no-await-in-loop */

    return { control, reachedRow, reached, tabStops, arrowStops, activate, focused: await active() };
  },
});

// ================================================================================================
// PART 3 (2026-10-01): the Date Uploaded range, downloads, numbered pagination and dismissing a
// decision dialog. Every behaviour below was measured first with
// scripts/probe-agent-verifications-5.js and -6.js (both read-only).
//
// >>> THE DATE PICKERS ARE CALENDAR-BUTTON-ONLY react-aria DatePickers. <<< There are no editable
// date segments (0 spinbuttons) and the <input type="date"> beside each is react-aria's aria-hidden
// MIRROR - filling it changes nothing. A day is chosen in a calendar POPOVER that has its own
// Cancel / Apply, and that popover stays open (and swallows every other click on the modal) until
// one of them is pressed. So: open the popover, move to the month, click the day, press the
// popover's Apply.
//
// Measured contract:
//   URL  dateUploadedStart=YYYY-MM-DD & dateUploadedEnd=YYYY-MM-DD
//   API  uploaded_after=YYYY-MM-DD    & uploaded_before=YYYY-MM-DD   (names differ - assert both)
//   a start with no end -> inline "End Date is required" and Apply Filters disabled
//   the end picker disables every day before the chosen start
// ================================================================================================

const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "Sep 15, 2026" (the grid's format) -> "2026-09-15". Returns null for anything else, so a caller
// can report an unreadable date rather than compare against NaN.
function rowDateToIso(text) {
  const m = /^([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const month = MONTHS.findIndex((n) => n.startsWith(m[1]));
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Object.assign(AgentVerificationsPage.prototype, {
  // ------------------------------------------------------------------ the Date Uploaded range

  // 0 = Start Date, 1 = End Date. Both buttons are named "Calendar", so they are told apart by
  // position inside the Filters modal, which is the order the modal renders them in.
  datePickerButton(which) {
    return this.filterDialog.getByRole('button', { name: 'Calendar' }).nth(which === 'end' ? 1 : 0);
  },

  // The calendar popover is the dialog that holds a GRID - the Filters modal holds none, so this
  // can never resolve to the modal underneath it.
  calendarPopover() {
    return this.page.locator('[role="dialog"]').filter({ has: this.page.locator('[role="grid"]') }).last();
  },

  async openCalendar(which) {
    await this.datePickerButton(which).click();
    const pop = this.calendarPopover();
    await pop.getByRole('button', { name: /^Apply$/ }).waitFor({ state: 'visible', timeout: 10000 });
    return pop;
  },

  // Steps the popover to the month holding `iso`, reading the heading it renders ("October 2026")
  // rather than counting clicks from an assumed starting month.
  async showMonth(pop, iso) {
    const [y, m] = iso.split('-').map(Number);
    const want = y * 12 + (m - 1);
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 60; i++) {
      const heading = clean((await pop.innerText()).split('\n')[0]);
      const [name, year] = heading.split(' ');
      const cur = Number(year) * 12 + MONTHS.indexOf(name);
      if (Number.isNaN(cur) || MONTHS.indexOf(name) < 0) {
        throw new Error(`the calendar popover is headed "${heading}", which is not a month and year`);
      }
      if (cur === want) return;
      const navigation = pop.getByRole('button', { name: cur > want ? 'Previous' : 'Next' }).first();
      if (await navigation.isDisabled()) return false;
      await navigation.click();
    }
    /* eslint-enable no-await-in-loop */
    throw new Error(`the calendar never reached the month of ${iso}`);
  },

  // Matched on what the cell's aria-label CONTAINS, never its end: the first selectable day carries
  // a suffix ("Tuesday, September 15, 2026, First available date", measured 2026-10-01), so an
  // ends-with match missed exactly the day a single-day range needs. Contains is still exact here:
  // "September 1, 2026" is not a substring of "September 21, 2026" or "September 11, 2026".
  dayCell(pop, iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return pop.locator(`[role="gridcell"] [role="button"][aria-label*="${MONTHS[m - 1]} ${d}, ${y}"]`).first();
  },

  async pickDate(which, iso) {
    const pop = await this.openCalendar(which);
    if ((await this.showMonth(pop, iso)) === false) {
      await pop.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
      throw new Error(`${iso} is outside the navigable range of the ${which} date picker`);
    }
    const cell = this.dayCell(pop, iso);
    if ((await cell.getAttribute('aria-disabled')) === 'true') {
      await pop.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
      throw new Error(`${iso} is disabled in the ${which} date picker, so it cannot be chosen`);
    }
    await cell.click();
    await pop.getByRole('button', { name: /^Apply$/ }).click();
    await pop.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  },

  // Whether a day can be chosen in a picker, read off the cell and then CANCELLED, so the modal is
  // left exactly as it was.
  async isDateSelectable(which, iso) {
    const pop = await this.openCalendar(which);
    const monthReachable = await this.showMonth(pop, iso);
    if (monthReachable === false) {
      await pop.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
      await pop.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      return { found: false, selectable: false, label: null, monthReachable: false };
    }
    const cell = this.dayCell(pop, iso);
    const found = (await cell.count()) > 0;
    const disabled = found ? (await cell.getAttribute('aria-disabled')) === 'true' : null;
    const label = found ? await cell.getAttribute('aria-label') : null;
    await pop.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
    await pop.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return { found, selectable: found && !disabled, label, monthReachable: true };
  },

  // What the two pickers DISPLAY ("DD/MM/YYYY" when empty, "15/09/2026" once chosen), plus the
  // value the mirror input holds - the one is what the agent sees, the other what the form sends.
  async readDateRange() {
    const shown = await this.filterDialog
      .locator('[role="group"][aria-label="Start Date"], [role="group"][aria-label="End Date"]')
      .evaluateAll((gs) => gs.map((g) => ({ label: g.getAttribute('aria-label'), text: g.innerText.trim() })));
    const mirror = await this.filterDialog.locator('input[type="date"]').evaluateAll((s) => s.map((x) => x.value));
    const start = shown.find((s) => s.label === 'Start Date');
    const end = shown.find((s) => s.label === 'End Date');
    const empty = (t) => !t || /^DD\/MM\/YYYY$/i.test(t);
    return {
      start: start && !empty(start.text) ? start.text : null,
      end: end && !empty(end.text) ? end.text : null,
      mirror,
    };
  },

  // Inline messages inside the Filters modal that are not part of its static copy.
  async readFilterErrors() {
    const text = await this.filterDialog.innerText();
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /required|invalid|must|cannot|before|after/i.test(l));
  },

  async applyFiltersDisabled() {
    return this.filterDialog.locator('[data-testid="filters-apply-button"]').isDisabled();
  },

  // ------------------------------------------------------------------ downloads

  // Returns what was actually DELIVERED - a download event alone would pass on any file at all,
  // including an HTML error page served under the right name.
  async readDownload(download) {
    if (!download) return null;
    const fs = require('fs');
    const file = await download.path();
    const bytes = file ? fs.statSync(file).size : 0;
    const head = file ? fs.readFileSync(file).slice(0, 8).toString('latin1') : '';
    return { filename: download.suggestedFilename(), bytes, head };
  },

  async downloadFromRow(index = 0) {
    const urlBefore = this.page.url();
    const pagesBefore = this.page.context().pages().length;
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      this.rows.nth(index).locator('[data-testid="agent-verifications-download-button"]').click(),
    ]);
    const file = await this.readDownload(download);
    return {
      file,
      urlBefore,
      urlAfter: this.page.url(),
      newPages: this.page.context().pages().length - pagesBefore,
    };
  },

  async downloadFromPanel() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      this.panel.getByRole('button', { name: /^Download$/ }).click(),
    ]);
    return { file: await this.readDownload(download), panelOpen: await this.panelOpen() };
  },

  // ------------------------------------------------------------------ numbered pagination

  // By aria-label, and only a VISIBLE one: the pager renders a desktop strip and a compact
  // "1 ... 25" strip, both labelled "Page N", and a role-based lookup resolved neither.
  async goToPage(n) {
    const baseline = this.responseCountSync();
    await this.pagination.locator(`[aria-label="Page ${n}"]:visible`).first().click();
    await this.settleAgainstServer(baseline).catch(() => {});
    return baseline;
  },

  // ------------------------------------------------------------------ dismissing a decision dialog

  // `route` is 'Escape' or 'X'. The decision dialog's X is the button named "Close" INSIDE it; the
  // review panel has a "Close" too, which is why this is scoped to the decision dialog's own text.
  async dismissDecisionDialog(dialog, route) {
    if (route === 'Escape') {
      await this.page.keyboard.press('Escape');
    } else {
      await dialog.getByRole('button', { name: /^close$/i }).first().click();
    }
    await this.page.waitForTimeout(600);
  },
});

AgentVerificationsPage.rowDateToIso = rowDateToIso;
AgentVerificationsPage.isoAddDays = isoAddDays;
AgentVerificationsPage.MONTHS = MONTHS;
AgentVerificationsPage.STATUS_LABEL = STATUS_LABEL;
AgentVerificationsPage.TAB_LABEL = TAB_LABEL;
AgentVerificationsPage.TAB_TESTID = TAB_TESTID;
AgentVerificationsPage.DOCUMENT_TYPE = DOCUMENT_TYPE;
AgentVerificationsPage.EMPTY_STATES = EMPTY_STATES;
AgentVerificationsPage.LIST_PATH = LIST_PATH;

module.exports = AgentVerificationsPage;
