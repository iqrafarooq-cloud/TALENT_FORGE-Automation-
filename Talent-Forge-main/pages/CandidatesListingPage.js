const BasePage = require('./BasePage');

// CandidatesListingPage - SuperAdmin Portal > User Management > Candidates (`/candidates`).
//
// NOT to be confused with ActiveCandidatePage / InProgressCandidatePage, which are the AGENT
// portal's own candidate lists at /candidates/active and /candidates/in-progress. Different
// role, different route, different columns, different row actions. This one exists because the
// superadmin's Edit > Update Email Address flow lives here as well as on the Agents listing,
// and TFF's edit-email rules are the same rules on both - so they are asserted on both.
//
// ===========================================================================================
// MEASURED LIVE against dev.talentforge.com.sa on 2026-09-03 (Playwright MCP). Every string,
// route and param below was read off the running app.
// ===========================================================================================
//
//   URL:      /candidates                       (the All tab adds NO param)
//             /candidates?accountTab=active | deactivated
//   API:      GET /core/api/v1/candidate/?page=&page_size=&search=[&is_active=false]
//   heading:  "User Management - Candidates"
//   tabs:     All | Active | Deactivated        (<button role="radio">, aria-checked)
//   columns:  Candidate | Agent | Account Status | Account Verification | Pending Documents |
//             Subscription Status | Last Activity | Actions
//   row acts: View | Edit | Deactivate account   (Deactivated rows: View | Edit | Reactivate
//                                                 Account - note Edit IS offered there, which
//                                                 is the opposite of the Agents listing, where
//                                                 a Deactivated row offers View | Reactivate
//                                                 and NO Edit at all)
//
// The row payload is what makes the pending-email state assertable:
//   { id, full_name, email, is_verified, is_email_verified, account_status,
//     agent_name, agent_email, pending_email, ... }
// `pending_email` is null in the settled state and holds the unverified new address while a
// change is awaiting the candidate's confirmation.
//
// >>> THE EDIT MODAL IS *NEARLY* THE AGENT ONE, AND THE DIFFERENCES ARE REAL. <<<
// Measured side by side on the same day, so this is divergence in the build and not drift in
// the measuring:
//
//   |                    | Agents listing                | Candidates listing            |
//   | field labels       | Current Email Address /       | Current Email /               |
//   |                    | New Email Address * /         | New Email Address * /         |
//   |                    | Confirm Email Address *       | Confirm New Email *           |
//   | close icon         | aria-label "close"            | aria-label "Close dialog"     |
//   | same-address error | "New email must be different" | "New email must be different."|
//   | success toast      | "Verification email sent to   | "Verification email sent to   |
//   |                    |  the updated email."          |  the new address."            |
//   | pending notice     | "...already pending:" and     | "...already pending" (no colon)|
//   |                    | "from the agent's side"       | and "from the candidate's side"|
//   | verify route       | /agent/verify-email-change    | /verify-email-change          |
//
// Neither wording is asserted as "correct" anywhere; both are asserted as MEASURED, and the
// divergence is attached to the report for the PO. Pinning one of the two as the house style
// would make one listing permanently red over a full stop.

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tab -> the `accountTab` value the app puts in the URL. "All" deliberately maps to null: it
// adds no param at all, and sending accountTab=all would be inventing a value the app never
// uses.
const TAB_PARAM = { all: null, active: 'active', deactivated: 'deactivated' };

class CandidatesListingPage extends BasePage {
  constructor(page) {
    super(page);
    const base = process.env.BASE_URL || '';
    this.origin = base.replace(/\/login\/?$/, '').replace(/\/$/, '');
    this.url = `${this.origin}/candidates`;

    this.pageHeading = page.getByRole('heading', { name: /User Management\s*-\s*Candidates/i });
    this.searchInput = page.locator(
      '[data-testid="admin-candidates-search-input"], input[placeholder*="Search" i], [role="searchbox"]'
    ).first();
    this.grid = page.locator('[role="grid"], table').first();

    // The dialog is found by the phrase it OWNS rather than by a test id, and the same
    // locator has to match both faces of it - the form and the already-pending notice - since
    // they share the heading and only one of them has inputs.
    this.emailDialog = page.locator('[role="dialog"]')
      .filter({ hasText: /update email address/i }).first();
  }

  async goto(tab = 'All') {
    const param = TAB_PARAM[String(tab).trim().toLowerCase()];
    await super.navigate(param ? `${this.url}?accountTab=${param}` : this.url);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.settle();
  }

  // Either a row holding an address or a genuine empty state has to be on screen before a
  // read means anything. The grid paints skeleton rows first - the same trap the Agents
  // listing documents - so a read timed on the ROW COUNT reports ten candidates with no
  // names.
  async settle(timeout = 30000) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'))
          .filter((r) => !r.querySelector('[role="columnheader"]'));
        return {
          rows: rows.length,
          filled: rows.filter((r) => /@/.test(r.innerText || '')).length,
          empty: Array.from(document.querySelectorAll('h1,h2,h3,h4'))
            .some((h) => /no results|no candidates|not found/i.test(h.innerText || '')),
        };
      });
      if (last.filled > 0 || last.empty) return last;
      await this.page.waitForTimeout(300);
    }
    return last;
  }

  // Run `action` and hand back the candidate-list response it triggered. Same reasoning as
  // AgentsListingPage.runAndWaitForList(): the grid keeps the PREVIOUS query's rows on screen
  // while the next one is in flight, so anything asserting what the list CONTAINS has to read
  // the server's answer, not the DOM.
  async runAndWaitForList(action, { timeout = 45000 } = {}) {
    const pending = this.page.waitForResponse(
      (r) => /\/api\/v1\/candidate\/\?/.test(r.url()) && r.request().method() === 'GET',
      { timeout },
    );
    await action();
    try {
      const response = await pending;
      const payload = await response.json().catch(() => null);
      await this.settle();
      return { requestUrl: response.url(), payload, requestFired: true };
    } catch {
      await this.settle();
      return { requestUrl: '', payload: null, requestFired: false };
    }
  }

  // >>> THERE ARE TWO VERIFICATION FLAGS AND THEY DISAGREE. <<< Measured 2026-09-07 on the
  // Deactivated tab: `is_verified: true` alongside `is_email_verified: false`, on the same
  // three rows. The grid's **Account Verification** column renders `is_verified`, and the
  // Account Verification Status FILTER (`verification_status=`) agrees with it - so an
  // assertion built on `is_email_verified` reports a perfectly working filter as broken, which
  // is exactly what it did on the first full run (Verified returned a row "failing" the rule,
  // Unverified returned ten). Both are exposed; `verified` is the one the listing means.
  //
  // >>> AND `account_status` SAYS "Inactive" WHERE THE GRID RENDERS "Deactivated". <<< Same
  // measurement, same rows. Neither string is asserted as the correct one - `statusIs()` below
  // accepts the pair and the divergence is recorded for the PO. Pinning the rendered wording
  // would make every payload assertion red; pinning the API's would make every grid assertion
  // red.
  static candidatesFrom(payload) {
    if (!payload) return [];
    return (payload.results || payload.data || payload.items || []).map((c) => ({
      id: c.id,
      name: c.full_name,
      email: c.email,
      agentName: c.agent_name,
      agentEmail: c.agent_email,
      status: c.account_status,
      // What the Account Verification column and its filter both mean.
      verified: c.is_verified,
      // A DIFFERENT flag, kept because the edit-email flow is about the email address. Do not
      // use it for an Account Verification assertion.
      emailVerified: c.is_email_verified,
      pendingDocuments: c.pending_documents_count,
      subscriptionStatus: c.subscription_status,
      // The one machine-readable statement of the pending-change state. Null when settled.
      pendingEmail: c.pending_email,
    }));
  }

  // "Active" | "Deactivated" -> does this row's account_status mean that? The API answers
  // "Active" / "Inactive" and the grid renders "Active" / "Deactivated", so the deactivated
  // state has two names and a step must accept both. See the note above candidatesFrom().
  static statusIs(candidate, want) {
    const got = String((candidate && candidate.status) || '').trim().toLowerCase();
    const w = String(want).trim().toLowerCase();
    if (w === 'active') return got === 'active';
    if (w === 'deactivated' || w === 'inactive') return got === 'deactivated' || got === 'inactive';
    throw new Error(`Unknown account status "${want}" - expected Active or Deactivated.`);
  }

  async selectTab(tab) {
    const button = this.page.getByRole('radio', { name: new RegExp(`^${escapeRegExp(tab)}$`, 'i') }).first();
    const target = (await button.count())
      ? button
      : this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(tab)}$`, 'i') }).first();
    return this.runAndWaitForList(async () => { await target.click(); });
  }

  async currentTab() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const hit = Array.from(document.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true');
      return hit ? c(hit.innerText) : '';
    });
  }

  // Server-side, debounced. Searching the FULL address is what makes a lookup exact - a
  // partial term can match several candidates, and this account holds 2,000+ of them across
  // 211 pages, so scanning rendered rows for one invited seconds ago finds nothing.
  // Repeating a term fires NO request - see the long note on
  // AgentsListingPage.search(), which this mirrors. The two listings share one step
  // vocabulary, so a fix on one of them only is a fix that drifts.
  async search(term, { tab } = {}) {
    const wanted = String(term);
    const result = await this.runAndWaitForList(async () => {
      await this.searchInput.fill('');
      await this.searchInput.fill(wanted);
    }, { timeout: 12000 });
    if (result.requestFired) return { ...result, refetched: false };

    await this.settle();
    const url = new URL(this.page.url());
    // MEASURED 2026-09-07: the candidate listing writes the term as `?search=`, NOT the `q=`
    // the agents listing uses. The loop below still wins when the app has already written the
    // term under some other key; this is only the fallback for a first search on a bare URL.
    let key = 'search';
    for (const [k, v] of url.searchParams.entries()) {
      if (v === wanted) { key = k; break; }
    }
    url.searchParams.set(key, wanted);
    const tabParam = tab ? TAB_PARAM[String(tab).trim().toLowerCase()] : null;
    if (tabParam) url.searchParams.set('accountTab', tabParam);
    const forced = await this.runAndWaitForList(async () => {
      await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    }, { timeout: 45000 });
    await this.searchInput.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    if (!forced.requestFired) await this.settle();
    return { ...forced, refetched: true };
  }

  rowLocator(needle) {
    return this.page.locator('[role="row"]').filter({ hasText: String(needle) }).first();
  }

  async readRows() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => {
          const header = r.querySelector('[role="rowheader"]');
          const lines = header ? String(header.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean) : [];
          return {
            text: c(r.innerText),
            name: lines.find((t) => !t.includes('@')) || '',
            email: lines.find((t) => t.includes('@')) || '',
            actions: Array.from(r.querySelectorAll('button'))
              .map((b) => c(b.getAttribute('aria-label')) || c(b.innerText)).filter(Boolean),
          };
        });
    });
  }

  async rowActions(needle) {
    const rows = await this.readRows();
    const row = rows.find((r) => r.text.toLowerCase().includes(String(needle).toLowerCase()));
    return row ? row.actions : [];
  }

  async clickRowAction(needle, action) {
    const row = this.rowLocator(needle);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.getByRole('button', { name: new RegExp(`^${escapeRegExp(action)}$`, 'i') }).first().click();
    await this.page.waitForTimeout(800);
  }

  // ==================== Edit -> Update Email Address ====================

  async openEmailDialog(needle) {
    await this.clickRowAction(needle, 'Edit');
    await this.emailDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(600);
  }

  // Inline errors are matched by COLOUR, not by the wording we hope to find. A locator built
  // from the expected string can only ever answer "absent", which cannot tell a missing error
  // from a differently-worded one - and this modal's wording already differs from the agent
  // modal's by a full stop.
  async readEmailDialog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => /update email address/i.test(d.innerText || '')).pop();
      if (!dialog) return null;
      const inputs = Array.from(dialog.querySelectorAll('input'));
      const primary = Array.from(dialog.querySelectorAll('button'))
        .find((b) => /^(update|next)$/i.test(c(b.innerText)));
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        pending: /already pending/i.test(c(dialog.innerText)),
        labels: Array.from(dialog.querySelectorAll('label')).map((l) => c(l.innerText)),
        // The twin of AgentsListingPage.readEmailDialog()'s `fields` - see the note there.
        // The two readers are one vocabulary and must not drift.
        fields: inputs.map((i, idx) => {
          const byFor = i.id ? dialog.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null;
          const byAria = i.getAttribute('aria-labelledby')
            ? document.getElementById(i.getAttribute('aria-labelledby')) : null;
          const el = byFor || byAria;
          return {
            index: idx,
            label: c(el ? el.innerText : '').replace(/\s*\*\s*$/, '').trim(),
            labelSource: byFor ? 'for' : (byAria ? 'aria-labelledby' : 'none'),
            placeholder: i.placeholder,
            value: i.value,
            disabled: i.disabled,
          };
        }),
        current: inputs[0] ? { value: inputs[0].value, disabled: inputs[0].disabled } : null,
        placeholders: inputs.map((i) => i.placeholder),
        values: inputs.map((i) => i.value),
        updateDisabled: primary ? primary.disabled : null,
        primaryLabel: primary ? c(primary.innerText) : '',
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        errors: Array.from(new Set(
          Array.from(dialog.querySelectorAll('p,span,div')).filter((e) => {
            const t = c(e.innerText);
            if (!t || t.length > 160 || e.children.length) return false;
            if (/^(update|next|cancel)$/i.test(t)) return false;
            return /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color);
          }).map((e) => c(e.innerText)),
        )),
      };
    });
  }

  // The native value setter, so a React-controlled input really updates. `fill()` on these
  // two fields leaves the component's own state behind and the gate never re-evaluates.
  async fillNewEmail(newEmail, confirmEmail) {
    await this.page.evaluate(([nv, cv]) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => /update email address/i.test(d.innerText || '')).pop();
      const inputs = Array.from(dialog.querySelectorAll('input'));
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      set(inputs[1], nv);
      set(inputs[2], cv);
    }, [String(newEmail), String(confirmEmail)]);
    await this.page.waitForTimeout(900);
  }

  async cancelEmailDialog() {
    await this.emailDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  // The X icon. Its accessible name is "Close dialog" here and a bare "close" on the Agents
  // listing, so BOTH are matched - a locator pinned to one of them silently resolves to
  // nothing on the other listing and the click then lands on whatever is underneath.
  async closeEmailDialogWithIcon() {
    await this.emailDialog.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async escapeEmailDialog() {
    await this.page.keyboard.press('Escape');
    await this.emailDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  // See AgentsListingPage.submitEmailUpdate() for why the toast is sampled rather than read,
  // and why a refusal is returned rather than thrown.
  async submitEmailUpdate({ sampleMs = 6000 } = {}) {
    const primary = this.emailDialog.getByRole('button', { name: /^(update|next)$/i }).first();
    const label = (await primary.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (await primary.isDisabled().catch(() => false)) {
      const state = await this.readEmailDialog();
      return {
        submitted: false,
        buttonLabel: label,
        toasts: [],
        dialogStillOpen: true,
        gatedBecause: `"${label}" is disabled. The modal holds ${JSON.stringify(state && state.values)} `
          + `and shows ${JSON.stringify(state && state.errors)}.`,
      };
    }
    const toasts = await this.captureToasts(async () => { await primary.click(); }, { sampleMs });
    const dialogStillOpen = await this.emailDialog.isVisible().catch(() => false);
    return { submitted: true, buttonLabel: label, toasts, dialogStillOpen, gatedBecause: null };
  }

  async captureToasts(action, { sampleMs = 6000, everyMs = 200 } = {}) {
    const started = this.page.evaluate(([total, step]) => new Promise((resolve) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const seen = [];
      const tick = () => {
        document.querySelectorAll(
          '.Toastify__toast, .Toastify__toast-body, li[data-sonner-toast], [role="status"], [role="alert"]'
        ).forEach((e) => {
          const t = c(e.innerText);
          if (t && !seen.includes(t)) seen.push(t);
        });
      };
      const id = setInterval(tick, step);
      setTimeout(() => { clearInterval(id); tick(); resolve(seen); }, total);
    }), [sampleMs, everyMs]);
    await action();
    return started;
  }

  // ==================== The PENDING email change ====================
  //
  // The candidate half of what AgentsListingPage documents at length. Same shape, and the two
  // readers are deliberately separate rather than shared: the row markup, the class names and
  // the tooltip wording all differ, and a single "clever" reader spanning both would have to
  // guess which listing it is on.

  async readRowEmailState(needle) {
    return this.page.evaluate((term) => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'));
      const row = rows.find((r) => c(r.innerText).toLowerCase().includes(String(term).toLowerCase()));
      if (!row) return null;
      // The CANDIDATE cell, never the row: the Agent column holds an address too, and the
      // agent's is painted the ordinary grey - so an unscoped read can answer "not pending"
      // on a row that plainly is.
      const cell = row.querySelector('[role="rowheader"]') || row;
      const el = Array.from(cell.querySelectorAll('span,p,a'))
        .find((e) => !e.children.length && /@/.test(e.innerText || ''));
      const icon = Array.from(cell.querySelectorAll('button')).find((b) => b.querySelector('svg'));
      const colour = el ? getComputedStyle(el).color : '';
      const rgb = (colour.match(/\d+/g) || []).map(Number);
      return {
        email: el ? c(el.innerText) : '',
        colour,
        className: el ? String(el.className) : '',
        paintedAsError: rgb.length >= 3 && rgb[0] >= 170 && rgb[1] < 110 && rgb[2] < 110,
        hasWarningIcon: !!icon,
        iconId: icon ? icon.id : null,
        rowText: c(row.innerText),
      };
    }, String(needle));
  }

  async readPendingTooltip(needle) {
    const state = await this.readRowEmailState(needle);
    if (!state) throw new Error(`No candidate row matching ${JSON.stringify(needle)} is on screen.`);
    if (!state.hasWarningIcon) {
      return { opened: false, via: null, text: '', reason: 'the row renders no warning icon' };
    }
    // The twin of AgentsListingPage.readPendingTooltip() - see the long note there for why a
    // real pointer move and a poll are required, and why focus and click are not routes in.
    const icon = this.page.locator(`[id="${state.iconId}"]`).first();
    const read = async () => this.page.evaluate(() => Array.from(document.querySelectorAll('[role="tooltip"]'))
      .map((t) => String(t.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    const poll = async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const tips = await read();
        if (tips.length) return tips;
        await this.page.waitForTimeout(250);
      }
      return [];
    };

    const box = await icon.boundingBox().catch(() => null);
    if (box) {
      await this.page.mouse.move(Math.max(0, box.x - 80), Math.max(0, box.y - 80));
      await this.page.waitForTimeout(250);
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    } else {
      await icon.hover({ timeout: 10000 }).catch(() => {});
    }
    let tips = await poll(6000);
    if (tips.length) return { opened: true, via: 'hover', text: tips[0], all: tips };

    await icon.focus().catch(() => {});
    tips = await poll(3000);
    if (tips.length) return { opened: true, via: 'focus', text: tips[0], all: tips };

    return {
      opened: false,
      via: null,
      text: '',
      reason: 'no [role="tooltip"] appeared within 6s of a real pointer move onto the icon, '
        + 'nor within 3s of focusing it',
    };
  }

  async readPendingNotice() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => /update email address/i.test(d.innerText || '')).pop();
      if (!dialog) return null;
      const text = c(dialog.innerText);
      if (!/already pending/i.test(text)) return null;
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        text,
        emails: Array.from(new Set(text.match(/[^\s@]+@[^\s@]+\.[^\s@,]+/g) || [])),
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
        inputs: dialog.querySelectorAll('input').length,
      };
    });
  }

  async clickEditPendingEmail() {
    await this.emailDialog.getByRole('button', { name: /^edit email$/i }).first().click();
    await this.page.waitForTimeout(1200);
  }

  // ==================== Structure ====================

  async isOnListing() {
    return /\/candidates(\?|$)/.test(this.page.url());
  }

  async headingText() {
    return this.page.evaluate(() => {
      const h = document.querySelector('h1');
      return h ? String(h.innerText || '').replace(/\s+/g, ' ').trim() : '';
    });
  }

  async searchPlaceholder() {
    return this.searchInput.getAttribute('placeholder').catch(() => '');
  }

  // The three lifecycle tabs are <button role="radio"> inside one radiogroup - NOT
  // role="tab". A getByRole('tab') reader finds nothing here and reports a listing with no
  // tabs at all.
  async tabNames() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll('[role="radio"]'))
      .filter((r) => !r.closest('[role="dialog"]'))
      .map((r) => String(r.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean));
  }

  async isTabSelected(name) {
    return (await this.currentTab()).toLowerCase() === String(name).trim().toLowerCase();
  }

  async columnHeaders() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll('[role="columnheader"]'))
      .map((h) => String(h.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean));
  }

  async rowCount() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll('[role="row"]'))
      .filter((r) => !r.querySelector('[role="columnheader"]')).length);
  }

  async toastMessages() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll(
      '.Toastify__toast, .Toastify__toast-body, li[data-sonner-toast], [role="status"], [role="alert"]',
    )).map((e) => String(e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  }

  // ==================== Empty state ====================
  //
  // MEASURED 2026-09-07 - the two empty states differ, and the CTA is offered by only one:
  //   search  : "No results found" / "We couldn't find any results matching your current
  //             search."   and NO call to action
  //   filters : "No results found" / "We couldn't find any results matching your current
  //             filters."  and a "Clear all filters" button
  //
  // Note the CTA's wording: "Clear all filters", where the AGENTS listing's is "Clear All".
  // Neither is asserted as the house style - both are asserted as measured, and the
  // divergence is a question for the PO. Pinning one would make the other listing red over a
  // word.
  async readEmptyState() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,p'))
        .filter((h) => !h.closest('[role="dialog"],[role="listbox"]'))
        .find((h) => /^no results found\.?$/i.test(c(h.innerText)));
      if (!heading) return null;
      // The CTA is not a sibling of the heading - same trap AgentsListingPage documents at
      // length. Climb only while the ancestor's text still BEGINS with the heading, so the
      // climb stops before it reaches the page chrome (the tabs and the Filters trigger)
      // and starts reporting those as empty-state CTAs.
      const headingText = c(heading.innerText);
      let wrap = heading.parentElement || heading;
      for (let i = 0; i < 6 && wrap.parentElement; i += 1) {
        if (!c(wrap.parentElement.innerText).startsWith(headingText)) break;
        wrap = wrap.parentElement;
      }
      return {
        heading: headingText,
        text: c(wrap.innerText),
        body: c(wrap.innerText).replace(headingText, '').trim(),
        ctas: Array.from(wrap.querySelectorAll('button,a')).map((b) => c(b.innerText)).filter(Boolean),
      };
    });
  }

  // The empty state's own way out. Only the FILTERED empty state offers one.
  async clickEmptyStateClearAll() {
    const cta = this.page.getByRole('button', { name: /^clear all( filters)?$/i }).first();
    const result = await this.runAndWaitForList(async () => { await cta.click(); }, { timeout: 10000 });
    await this.settle();
    return result;
  }

  // ==================== Filters modal ("Apply Filters") ====================
  //
  // MEASURED LIVE 2026-09-07 (scripts/probe-superadmin-candidates.js). FIVE groups, and the
  // two things that make this modal different from the agents' one:
  //
  //   group                        control    options
  //   Status                       checkbox   Active | Deactivated
  //   Account Verification Status  checkbox   Verified | Unverified
  //   Pending Documents            RADIO      0 | 1-2 | 3+
  //   Subscription Status          checkbox   Subscribed | Not Subscribed | Payment Due
  //   Last Activity                RADIO      Last 24 hours | Last 7 days | Last 30 days |
  //                                           30+ days
  //
  // >>> TWO GROUPS ARE SINGLE-SELECT RADIOS. <<< Selecting a second option in Pending
  // Documents or Last Activity REPLACES the first rather than unioning with it, and a
  // selected radio cannot be un-selected by clicking it again - Clear All is the only way
  // back. Any "two options in one group return the union" assertion must therefore be aimed
  // at a CHECKBOX group; aimed at a radio group it asserts behaviour the control cannot have.
  //
  // >>> ONLY THE CHECKBOX LABELS CARRY data-testid. <<< The radio labels carry none, so a
  // testid-only reader silently sees 7 of the 14 options and any assertion counting them
  // passes having inspected half the modal.
  //
  // >>> THE CHECKBOX LABELS NEED A REAL POINTER CLICK. <<< They carry
  // data-react-aria-pressable, and an element.click() on them is a SILENT NO-OP - Apply then
  // produces a URL with the param missing. The radio labels DO respond to a scripted click,
  // which is what made this confusing while probing: a mixed run reported the two radio
  // groups working and the three checkbox groups ignored, i.e. an app defect that does not
  // exist. Every selection here goes through a Playwright .click().
  //
  // url param -> API param, measured one option at a time. They agree in NO case, which is
  // why both are asserted:
  //   status=active                  -> is_active=true
  //   status=deactivated             -> is_active=false
  //   accountVerification=verified   -> verification_status=verified
  //   accountVerification=unverified -> verification_status=unverified
  //   pendingDocuments=0             -> pending_documents=0
  //   pendingDocuments=1-2           -> pending_documents=1-2
  //   pendingDocuments=3plus         -> pending_documents=3+
  //   subscriptionStatus=subscribed  -> subscription_status=subscribed
  //   subscriptionStatus=notSubscribed -> subscription_status=not_subscribed
  //   subscriptionStatus=paymentDue  -> subscription_status=payment_due
  //   lastActivity=24h               -> last_activity=24h
  //   lastActivity=7days             -> last_activity=7d
  //   lastActivity=30days            -> last_activity=30d
  //   lastActivity=inactive          -> last_activity=inactive

  get filtersTrigger() {
    return this.page.getByRole('button', { name: /^filters\b/i }).first();
  }

  get filterDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /apply filters/i }).first();
  }

  async openFilters() {
    await this.filtersTrigger.click();
    await this.filterDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(500);
  }

  async isFilterDialogOpen() {
    return this.filterDialog.isVisible().catch(() => false);
  }

  async filtersTriggerLabel() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const b = Array.from(document.querySelectorAll('button')).find((x) => /^filters\b/i.test(c(x.innerText)));
      return b ? c(b.innerText) : '';
    });
  }

  async appliedFilterCount() {
    const m = (await this.filtersTriggerLabel()).match(/^filters\s+(\d+)$/i);
    return m ? Number(m[1]) : 0;
  }

  // ONE ordered pass over every label in the modal, whatever its control type, carrying the
  // INDEX that `selectFilterOption()` clicks by. Reading the options through one list and
  // clicking through another is how the community module ended up selecting a different
  // option from the one a step had read - so here the index a caller reads is by
  // construction the index the click acts on.
  async readFilterOptions() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => /apply filters/i.test(d.innerText || '')).pop();
      if (!dialog) return { found: false, groupTitles: [], options: [] };
      const labels = Array.from(dialog.querySelectorAll('label'));
      const options = labels.map((l, index) => {
        const input = l.querySelector('input');
        // The group is the nearest preceding bold heading. Derived from the DOM rather than
        // hardcoded, so a re-ordered modal is reported correctly instead of mis-attributed.
        const section = l.closest('div.flex.flex-col') || l.parentElement;
        const headingEl = section ? section.querySelector('p.font-bold') : null;
        return {
          index,
          group: c(headingEl ? headingEl.innerText : ''),
          label: c(l.innerText),
          testid: l.getAttribute('data-testid'),
          type: input ? input.type : '',
          checked: Boolean(input && input.checked),
        };
      });
      return {
        found: true,
        groupTitles: Array.from(dialog.querySelectorAll('p.font-bold')).map((p) => c(p.innerText)).filter(Boolean),
        options,
      };
    });
  }

  // Resolve by GROUP + exact label. Scoping to the group matters: "0" is an option under
  // Pending Documents and would also substring-match nothing else today, but an unscoped
  // exact-text match across a modal that gains an option later is a bug waiting to happen -
  // and "Active" already appears both as a Status option here and as a lifecycle tab
  // outside the dialog.
  async filterOptionIndex(group, option) {
    const state = await this.readFilterOptions();
    if (!state.found) throw new Error('The Filters modal is not open.');
    const wantGroup = String(group).trim().toLowerCase();
    const wantOption = String(option).trim().toLowerCase();
    const hit = state.options.find(
      (o) => o.group.toLowerCase() === wantGroup && o.label.toLowerCase() === wantOption,
    );
    if (!hit) {
      throw new Error(
        `The Filters modal offers no "${option}" under "${group}". It offers: `
        + `${JSON.stringify(state.options.map((o) => `${o.group}/${o.label}`))}`,
      );
    }
    return hit;
  }

  async selectFilterOption(group, option) {
    const hit = await this.filterOptionIndex(group, option);
    // A real pointer click - see the note above on data-react-aria-pressable.
    await this.filterDialog.locator('label').nth(hit.index).click();
    await this.page.waitForTimeout(350);
    return hit;
  }

  async isFilterOptionSelected(group, option) {
    const hit = await this.filterOptionIndex(group, option);
    return hit.checked;
  }

  async selectedFilterOptions() {
    return (await this.readFilterOptions()).options
      .filter((o) => o.checked)
      .map((o) => `${o.group}/${o.label}`);
  }

  async applyFilters() {
    return this.runAndWaitForList(async () => {
      await this.page.locator('[data-testid="filters-apply-button"]').click();
    });
  }

  async clearAllInModal() {
    return this.runAndWaitForList(async () => {
      await this.page.locator('[data-testid="filters-clear-all-button"]').click();
    }, { timeout: 12000 });
  }

  async cancelFilters() {
    await this.filterDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.filterDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(700);
  }

  async closeFilterDialogVia(method) {
    const how = String(method).trim().toLowerCase();
    if (how === 'x icon' || how === 'x') {
      await this.filterDialog.locator('button[aria-label="Close" i]').first().click();
    } else if (how === 'cancel') {
      await this.filterDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    } else if (how === 'escape') {
      await this.page.keyboard.press('Escape');
    } else if (how === 'backdrop') {
      await this.page.mouse.click(5, 5);
    } else {
      throw new Error(`Unknown close method "${method}" - expected X icon, Cancel, Escape or backdrop.`);
    }
    await this.page.waitForTimeout(1200);
  }

  // ==================== Pagination ====================
  //
  // MEASURED: Previous | 1 2 3 4 5 … 214 | Next, with `?page=N` in the URL and `page=N` on
  // the API. The numbered controls are <li role="listitem" aria-label="Page N">, NOT buttons,
  // so a getByRole('button', {name: '2'}) finds nothing.

  get pagination() {
    return this.page.locator('[aria-label*="Pagination" i]').first();
  }

  async hasPagination() {
    return (await this.pagination.count()) > 0 && this.pagination.isVisible().catch(() => false);
  }

  async paginationText() {
    if (!(await this.pagination.count())) return '';
    return (await this.pagination.innerText()).replace(/\s+/g, ' ').trim();
  }

  prevButton() { return this.page.getByRole('button', { name: /previous/i }).first(); }

  nextButton() { return this.page.getByRole('button', { name: /next/i }).first(); }

  async isPrevDisabled() { return this.prevButton().isDisabled().catch(() => null); }

  async isNextDisabled() { return this.nextButton().isDisabled().catch(() => null); }

  // A page already fetched is re-rendered from cache with NO request - the same behaviour
  // AgentsListingPage documents. So the short window is deliberate: the wait must not depend
  // on a response arriving, and `requestFired` tells the caller which happened.
  async goToNextPage() {
    const result = await this.runAndWaitForList(async () => { await this.nextButton().click(); }, { timeout: 15000 });
    await this.settle();
    return result;
  }

  async goToPrevPage() {
    const result = await this.runAndWaitForList(async () => { await this.prevButton().click(); }, { timeout: 10000 });
    await this.settle();
    return result;
  }

  async goToPageNumber(n) {
    const result = await this.runAndWaitForList(async () => {
      await this.page.locator(`[aria-label="Page ${Number(n)}"]`).first().click();
    }, { timeout: 15000 });
    await this.settle();
    return result;
  }

  // ==================== Row action: View -> the candidate drawer ====================
  //
  // >>> VIEW IS A DRAWER, NOT A ROUTE. <<< Measured 2026-09-07: the URL stays exactly
  // /candidates - there is no /candidates/view/<id>, no ?tab= per panel tab and no Back
  // control. The agent equivalent is a real page at /agents/view/<id>?tab=, so nothing about
  // the agent profile's navigation coverage transfers here, and a step asserting a URL after
  // View would be asserting a route the app does not have.
  //
  // The drawer's own reader is CandidateDetailPanelPage.
  async openCandidatePanel(needle) {
    await this.clickRowAction(needle, 'View');
    await this.page.waitForTimeout(1200);
  }

  // ==================== Row action: Deactivate ====================
  //
  // MEASURED 2026-09-07 on the Active/All tabs:
  //   heading  "Deactivate Candidate Account"
  //   body     "You're about to deactivate <Name>'s account. This action will:" then
  //            Prevent the user from logging in / Pause any active subscriptions /
  //            All user data will remain in the system / Allow the account to be
  //            reactivated later
  //   field    "Reason for Deactivation *" - a real <select> whose options are
  //            User requested closure | Policy violation | Temporary hold |
  //            Duplicate account | Fraudulent activity | Other
  //   footer   Cancel | Deactivate Account   (+ an X "Close dialog")
  //
  // >>> THE CONFIRM BUTTON IS GATED TWICE. <<< It is disabled until a reason is chosen, and
  // choosing "Other" REVEALS a second required field ("Please specify reason *", placeholder
  // "Enter reason for deactivation...") and re-disables it until that field holds something
  // other than whitespace. So "pick a reason and confirm" is right for five of the six
  // options and wrong for the sixth.

  get deactivateDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /deactivate candidate account/i }).first();
  }

  async openDeactivateDialog(needle) {
    await this.clickRowAction(needle, 'Deactivate account');
    await this.deactivateDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(600);
  }

  async readDeactivateDialog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /deactivate candidate account/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const sel = d.querySelector('select');
      const confirm = Array.from(d.querySelectorAll('button'))
        .find((b) => /^deactivate account$/i.test(c(b.innerText)));
      const ta = d.querySelector('textarea');
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        text: c(d.innerText),
        // Each consequence the dialog promises, as its own line, so a scenario can assert
        // the SET rather than one long string that a re-wording of any bullet would break.
        bullets: Array.from(d.querySelectorAll('li'))
          .map((li) => c(li.innerText)).filter(Boolean),
        // >>> READ OFF THE DIALOG'S OWN TEXT, NOT OFF A GUESSED ELEMENT TYPE. <<< The first
        // version scanned only `p, label` and answered "" for a dialog whose text plainly
        // reads "Reason for Deactivation *" - so the step failed with "the reason control
        // carries no label" while quoting the label back in its own message. The label lives
        // in neither of those tags, and a reader that can only answer "absent" is the trap
        // this repo has paid for repeatedly.
        reasonLabel: (c(d.innerText).match(/Reason for Deactivation\s*\*?/i) || [''])[0],
        reasons: sel ? Array.from(sel.options).map((o) => ({ value: o.value, label: c(o.text) })) : null,
        selectedReason: sel ? sel.value : null,
        freeTextShown: Boolean(ta),
        freeTextPlaceholder: ta ? ta.placeholder : null,
        freeTextValue: ta ? ta.value : null,
        confirmLabel: confirm ? c(confirm.innerText) : '',
        confirmDisabled: confirm ? confirm.disabled : null,
        buttons: Array.from(d.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      };
    });
  }

  // The <select> is a real native one, so selectOption drives it honestly. It is matched by
  // LABEL rather than by value, because the labels are what the AC and the feature file
  // speak - the values (user_requested_closure, …) are an implementation detail recorded in
  // readDeactivateDialog().
  async selectDeactivationReason(label) {
    const select = this.deactivateDialog.locator('select').first();
    await select.selectOption({ label: String(label) });
    await this.page.waitForTimeout(700);
  }

  async fillOtherReason(text) {
    const ta = this.deactivateDialog.locator('textarea').first();
    if (!(await ta.count())) {
      throw new Error(
        'The Deactivate dialog shows no free-text reason field. It appears only once "Other" '
        + 'is chosen - the current state is ' + JSON.stringify(await this.readDeactivateDialog()),
      );
    }
    await ta.fill(String(text));
    await this.page.waitForTimeout(700);
  }

  async cancelDeactivateDialog() {
    await this.deactivateDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  async closeDeactivateDialogWithIcon() {
    await this.deactivateDialog.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  // ==================== Row action: Reactivate (Deactivated tab) ====================
  //
  // MEASURED 2026-09-07:
  //   heading  "Reactivate Account"
  //   body     the candidate's name + email + a "Deactivated" pill, then "The account for
  //            <Name> will be reactivated. The user will regain access to all candidate
  //            features instantly. A reactivation email will be sent to the user's
  //            registered email address."
  //   footer   Cancel | Reactivate Account   (+ an X "Close dialog")
  // RE-MEASURED 2026-10-26 from the agent profile Candidates tab: the dialog now reads
  // "Re-activate Account" (heading and confirm), with "re-activated" / "re-activation" in the
  // body, while the menu item that opens it still says "Reactivate". Both spellings are matched.
  // No reason is asked for and the confirm button is enabled from the moment it opens - the
  // opposite of the deactivate dialog, and asserted as such.

  get reactivateDialog() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /re-?activate account/i }).first();
  }

  async openReactivateDialog(needle) {
    await this.clickRowAction(needle, 'Reactivate Account');
    await this.reactivateDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(600);
  }

  async readReactivateDialog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /re-?activate account/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const confirm = Array.from(d.querySelectorAll('button'))
        .find((b) => /^re-?activate account$/i.test(c(b.innerText)));
      return {
        heading: c((d.querySelector('h1,h2,h3') || {}).innerText),
        text: c(d.innerText),
        emails: Array.from(new Set(c(d.innerText).match(/[^\s@]+@[^\s@]+\.[^\s@,]+/g) || [])),
        confirmLabel: confirm ? c(confirm.innerText) : '',
        confirmDisabled: confirm ? confirm.disabled : null,
        fields: d.querySelectorAll('input,select,textarea').length,
        buttons: Array.from(d.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      };
    });
  }

  async cancelReactivateDialog() {
    await this.reactivateDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.reactivateDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  // ==================== COMMIT METHODS ====================
  //
  // >>> EVERYTHING BELOW THIS LINE REALLY CHANGES A LIVE CANDIDATE. <<< Nothing above it
  // does. They are separated so that a scenario reaching one by accident is obvious in
  // review, and so that the read-only profile can be trusted to be exactly that.
  //
  // A candidate CANNOT be deleted, but deactivation IS reversible, so unlike the community
  // module's consumed university this is a state change rather than a destroyed fixture.
  // It still sends a real reactivation email, which is why the scenarios that call these are
  // tagged @mutates-candidate and excluded from the default run.

  async confirmDeactivate({ sampleMs = 6000 } = {}) {
    const confirm = this.deactivateDialog.getByRole('button', { name: /^deactivate account$/i }).first();
    if (await confirm.isDisabled().catch(() => false)) {
      const state = await this.readDeactivateDialog();
      throw new Error(
        '"Deactivate Account" is disabled, so nothing was committed. The dialog holds '
        + `${JSON.stringify({ reason: state && state.selectedReason, freeText: state && state.freeTextValue })}.`,
      );
    }
    const toasts = await this.captureToasts(async () => { await confirm.click(); }, { sampleMs });
    await this.deactivateDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.settle();
    return { toasts, dialogStillOpen: await this.deactivateDialog.isVisible().catch(() => false) };
  }

  async confirmReactivate({ sampleMs = 6000 } = {}) {
    const confirm = this.reactivateDialog.getByRole('button', { name: /^re-?activate account$/i }).first();
    const toasts = await this.captureToasts(async () => { await confirm.click(); }, { sampleMs });
    await this.reactivateDialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.settle();
    return { toasts, dialogStillOpen: await this.reactivateDialog.isVisible().catch(() => false) };
  }

  // ==================== Finding a candidate on a tab ====================
  //
  // The list runs to 214 pages, so a candidate is found by SEARCHING for its exact address,
  // never by scanning the rendered page. Both waiters poll the SERVER's answer rather than
  // the DOM: the grid keeps the previous query's rows on screen while the next is in flight,
  // and a status written by a background job can trail the click that caused it.

  async findCandidateOnTab(tab, email, { timeout = 60000 } = {}) {
    const deadline = Date.now() + timeout;
    let last = [];
    while (Date.now() < deadline) {
      await this.goto(tab);
      const result = await this.search(email, { tab });
      last = CandidatesListingPage.candidatesFrom(result.payload);
      const hit = last.find((c) => String(c.email).toLowerCase() === String(email).toLowerCase());
      if (hit) return hit;
      await this.page.waitForTimeout(2500);
    }
    return null;
  }

  async waitForCandidateOnTab(tab, email, { timeout = 90000 } = {}) {
    const hit = await this.findCandidateOnTab(tab, email, { timeout });
    if (!hit) {
      throw new Error(
        `${email} never appeared on the "${tab}" tab within ${Math.round(timeout / 1000)}s. `
        + 'The search is on the exact address, so this is the server\'s own answer and not a paging miss.',
      );
    }
    return hit;
  }

  async confirmCandidateAbsentFromTab(tab, email, { confirmations = 2, gapMs = 2500 } = {}) {
    // Absence is confirmed twice, because a list still settling answers "absent" for a row
    // that arrives a moment later - the same distinction modalStaysAbsent() exists to make.
    for (let i = 0; i < confirmations; i += 1) {
      await this.goto(tab);
      const result = await this.search(email, { tab });
      const rows = CandidatesListingPage.candidatesFrom(result.payload);
      const hit = rows.find((c) => String(c.email).toLowerCase() === String(email).toLowerCase());
      if (hit) return { absent: false, found: hit };
      if (i < confirmations - 1) await this.page.waitForTimeout(gapMs);
    }
    return { absent: true, found: null };
  }
}

module.exports = CandidatesListingPage;
