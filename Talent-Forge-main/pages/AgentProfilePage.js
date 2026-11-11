const BasePage = require('./BasePage');


// AgentProfilePage — Page Object for the SUPERADMIN's agent profile at
// /agents/view/<id>, reached from the listing's "View" row action.
//
// Live DOM verified 2026-08-11 (scripts/probe-agent-management.js, probe-agent-remaining.js):
//
//   route      /agents/view/<id>
//              a tab adds ?tab=candidates | ?tab=promoTools | ?tab=activityLog
//              (Performance Overview is the default and adds NO param)
//   header     "Back" | avatar initials | agent name | status pill | email | university
//              + ONE inline action, "Edit Target", plus a three-dot "Open menu" overflow.
//              MEASURED 2026-09-04: there is no inline "Deactivate Account" button. The
//              overflow is state-dependent - "Log in as agent" + "Deactivate" on an active
//              agent, "Reactivate Account" on a deactivated one. See headerMenuItems().
//   tabs       [role=tab]: Performance Overview | Candidates | Promo Tools | Activity Log
//
//   Performance Overview  Target Progress ("<pct>% / N of M Candidates Onboarded" plus a
//                         Monthly/Quarterly/Yearly/Year to Date period selector),
//                         Candidate Onboarding, Revenue Impact, Pending Verifications with a
//                         "PENDING BY DOCUMENT TYPE" breakdown (Transcripts / Experience
//                         Letters / Certifications)
//   Candidates            its own grid: Candidate | Account Verification | Account Status |
//                         Pending Documents | Subscription Status | Last Activity | Actions
//   Promo Tools           the promo banner + Code Parameters. DELIBERATELY NOT ASSERTED HERE —
//                         features/Promo_Code/Promo-Tools-Tab.feature owns that tab in full
//                         (13 scenarios), and a second reader would drift from it. This page
//                         object only proves the tab is reachable and names itself.
//   Activity Log          a period selector (Last 24 Hours | Last 7 Days (default) |
//                         Last 30 Days | Last 3 Months | Last 6 Months | This Year) over a
//                         list of dated entries
//
//   "Edit Target" modal   heading "Edit Target", ONE field labelled
//                         "Numeric Performance Target (Monthly) *", then Cancel | Save Changes.
//                         The field is type="text" with no min/max, and Save Changes is
//                         ALWAYS enabled — see the note on editTargetGating() below.
const TAB_PARAM = {
  'performance overview': null,
  candidates: 'candidates',
  'promo tools': 'promoTools',
  'activity log': 'activityLog',
};

class AgentProfilePage extends BasePage {
  constructor(page) {
    super(page);
    this.origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;

    // >>> BACK IS A LINK, NOT A BUTTON. <<< Measured 2026-09-04
    // (scripts/probe-agent-profile-back-control.js): the control is
    // `<a href="/agents">Back</a>`, so a `getByRole('button', …)` locator matched NOTHING and
    // `clickBack()` timed out for the full 30s against a control sitting in the top-left of
    // every profile. That reads as a missing Back control rather than a mis-typed reader.
    //
    // The `href` is also the whole explanation of where Back lands: it is the BARE listing
    // path, carrying no `tab=` param, so returning from a Requires Attention or Deactivated
    // profile drops the superadmin on Active — the default tab. That is asserted, not worked
    // around; see "Verify that Back always returns to the Active tab".
    this.backButton = page
      .locator('[data-testid="agent-profile-back"]')
      .or(page.getByRole('link', { name: /^back$/i }))
      .or(page.getByRole('button', { name: /^back$/i }))
      .first();
    this.deactivateCta = page
      .locator('[data-testid="agent-profile-deactivate"]')
      .or(page.getByRole('button', { name: /^deactivate account$/i }))
      .first();
    this.editTargetCta = page
      .locator('[data-testid="agent-profile-edit-target"]')
      .or(page.getByRole('button', { name: /^edit target$/i }))
      .first();
    this.editTargetDialog = page.locator('[role="dialog"]').filter({ hasText: /edit target/i }).first();
    this.candidatesGrid = page.locator('[role="grid"]').first();
  }

  // ==================== Navigation ====================

  async isOnProfile() {
    return /\/agents\/view\/\d+/.test(this.page.url());
  }

  agentId() {
    const m = this.page.url().match(/\/agents\/view\/(\d+)/);
    return m ? m[1] : '';
  }

  async gotoTab(name) {
    const key = String(name).trim().toLowerCase();
    if (!(key in TAB_PARAM)) {
      throw new Error(`Unknown profile tab "${name}" — expected one of ${Object.keys(TAB_PARAM).join(', ')}`);
    }
    const param = TAB_PARAM[key];
    const id = this.agentId();
    await super.navigate(`${this.origin}/agents/view/${id}${param ? `?tab=${param}` : ''}`);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2500);
  }

  tab(name) {
    const rx = new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return this.page.getByRole('tab', { name: rx }).or(this.page.getByRole('radio', { name: rx })).first();
  }

  async openTab(name) {
    await this.tab(name).click();
    await this.page.waitForTimeout(2500);
  }

  async tabNames() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"],[role="radio"]'))
        .map((t) => (t.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
  }

  async selectedTab() {
    return this.page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('[role="tab"],[role="radio"]'))
        .find((x) => x.getAttribute('aria-selected') === 'true' || x.getAttribute('aria-checked') === 'true');
      return t ? (t.innerText || '').replace(/\s+/g, ' ').trim() : '';
    });
  }

  // The profile header keeps everything except "Edit Target" behind a three-dot overflow, so
  // `readHeader().actions` is NOT the profile's action set — it reports the inline controls
  // only. Measured 2026-09-04, scripts/probe-agent-profile-actions.js:
  //   Active / Requires Attention -> "Log in as agent", "Deactivate"
  //   Deactivated                 -> "Reactivate Account"
  // so the menu is STATE-DEPENDENT and an assertion on it has to name the agent's state.
  //
  // As on the listing, the items are role="menuitemRADIO" — see
  // AgentsListingPage.rowMenuItems() for why a `[role="menuitem"]` reader silently reports
  // an empty menu here. The menu is closed on the way out; left open its overlay swallows
  // the next click.
  async headerMenuItems({ trigger = 'Open menu' } = {}) {
    const opener = this.page.getByRole('button', { name: trigger, exact: true }).first();
    if (!(await opener.count())) return { opened: false, trigger, items: [] };
    await opener.click();
    const menu = this.page.locator('[role="menu"]').first();
    await menu.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const items = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="menu"] [role^="menuitem"]')).map((el) => ({
        key: el.getAttribute('data-key'),
        label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      })).filter((i) => i.label)
    );
    await this.page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(300);
    return { opened: true, trigger, items };
  }

  async clickBack() {
    await this.backButton.click();
    await this.page.waitForURL(/\/agents(\?|$)/, { timeout: 30000 });
    await this.page.waitForTimeout(1500);
  }

  // ==================== Header ====================

  // The identity block. Read structurally off the header region rather than by class, and the
  // email is picked by matching "@" instead of by position — the header renders name, status,
  // email and university as sibling nodes whose order has no guarantee.
  async readHeader() {
    // >>> THE TAB STRIP PAINTS BEFORE THE HEADER. <<< Read once on a slow load, `main` held only
    // the tabs ("Performance Overview, Candidates, ...") and the step reported the profile as
    // not naming the agent - a flake on a profile that rendered correctly a moment later
    // (2026-10-19). Wait for a header line carrying an address above the tab strip; a profile
    // that genuinely never shows one still falls through to the read and fails with its lines.
    await this.page.waitForFunction(() => {
      const lines = ((document.querySelector('main') || document.body).innerText || '')
        .split('\n').map((l) => l.trim()).filter(Boolean);
      const firstTab = lines.findIndex((l) => /^performance overview$/i.test(l));
      return firstTab > 0 && lines.slice(0, firstTab).some((l) => /@/.test(l));
    }, null, { timeout: 15000 }).catch(() => {});
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main') || document.body;
      const text = c(main.innerText);
      const lines = (main.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      // Everything above the tab strip is the header.
      const firstTab = lines.findIndex((l) => /^performance overview$/i.test(l));
      const head = firstTab > 0 ? lines.slice(0, firstTab) : lines.slice(0, 8);
      return {
        text,
        headerLines: head,
        email: head.find((l) => /@/.test(l)) || '',
        actions: Array.from(main.querySelectorAll('button'))
          .map((b) => c(b.innerText)).filter((t) => /^(deactivate account|edit target)$/i.test(t)),
        statusPill: head.find((l) => /^(active|deactivated|invite sent|requires attention)$/i.test(l)) || '',
      };
    });
  }

  // ==================== Performance Overview ====================

  async readPerformanceOverview() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const text = c((document.querySelector('main') || document.body).innerText);
      const section = (label) => (text.includes(label) ? label : null);
      const pct = text.match(/(\d+(?:\.\d+)?)%/);
      const ofN = text.match(/(\d+)\s+of\s+(\d+)/);
      return {
        text,
        sections: [
          section('Target Progress'),
          section('Candidate Onboarding'),
          section('Revenue Impact'),
          section('Pending Verifications'),
        ].filter(Boolean),
        documentTypes: ['Transcripts', 'Experience Letters', 'Certifications'].filter((d) => text.includes(d)),
        progressPercent: pct ? Number(pct[1]) : null,
        onboarded: ofN ? Number(ofN[1]) : null,
        target: ofN ? Number(ofN[2]) : null,
        periodOptions: ['Monthly', 'Quarterly', 'Yearly', 'Year to Date'].filter((p) => text.includes(p)),
      };
    });
  }

  // ==================== Candidates tab ====================

  async readCandidatesTab() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const headers = Array.from(document.querySelectorAll('[role="columnheader"]')).map((h) => c(h.innerText));
      const rows = Array.from(document.querySelectorAll('[role="row"]'))
        .filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => {
          // >>> NOT `querySelectorAll('p')`. <<< This grid renders the candidate's name and
          // email as react-aria `<button><span>…</span></button>` pairs, not paragraphs
          // (measured 2026-09-04, scripts/probe-agent-profile-candidates-tab.js: every row
          // reports `p` count 0 while its innerText holds both lines). A `p` reader returned
          // "" for BOTH fields, the `r.email || r.name` filter below then dropped every row,
          // and the tab reported ZERO candidates for an agent the server credits with three
          // — which reads as the app losing candidates rather than as a stale selector.
          //
          // This is the SAME change AgentsListingPage.readRows() was already fixed for; the
          // two grids share the markup, so fix them together if it moves again.
          const h = r.querySelector('[role="rowheader"]');
          const lines = h
            ? String(h.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean)
            : [];
          return {
            name: lines.find((t) => !t.includes('@')) || '',
            email: lines.find((t) => t.includes('@')) || '',
            cells: Array.from(r.querySelectorAll('[role="gridcell"]')).map((x) => c(x.innerText)),
          };
        });
      const emptyHeading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
        .find((h) => /no .*(candidate|result)/i.test(h.innerText || ''));
      return {
        headers,
        rows: rows.filter((r) => r.email || r.name),
        emptyState: emptyHeading ? c((emptyHeading.parentElement || emptyHeading).innerText) : null,
      };
    });
  }

  // ==================== Activity Log ====================

  async readActivityLog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const text = c((document.querySelector('main') || document.body).innerText);
      // Read the period dropdown's own options (its aria-hidden mirror <select>) rather than
      // matching a hardcoded list against the page text - the labels went from Title Case to
      // sentence case ("Last 24 hours", "This year") and the old list matched nothing (2026-10-07).
      const sel = (document.querySelector('main') || document).querySelector('select');
      return {
        text,
        periodOptions: sel ? Array.from(sel.options).map((o) => c(o.text)).filter(Boolean) : [],
        // Entries are dated lines; the date format the log renders is "Aug 6, 2026 - 5:52 PM".
        entryDates: (text.match(/[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+-\s+\d{1,2}:\d{2}\s*(?:AM|PM)/g) || []),
      };
    });
  }

  // ==================== Edit Target modal ====================

  async openEditTarget() {
    await this.editTargetCta.click();
    await this.editTargetDialog.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(800);
  }

  async readEditTarget() {
    return this.page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /edit target/i.test(d.innerText || ''));
      if (!dialog) return null;
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const input = dialog.querySelector('input,textarea');
      const save = Array.from(dialog.querySelectorAll('button')).find((b) => /save changes|^save$|update/i.test(c(b.innerText)));
      return {
        heading: c((dialog.querySelector('h1,h2,h3') || {}).innerText),
        body: c(dialog.innerText),
        fieldLabel: (() => {
          const m = c(dialog.innerText).match(/Numeric Performance Target \(\w+\)\s*\*?/i);
          return m ? m[0] : '';
        })(),
        field: input ? {
          type: input.type, value: input.value, min: input.min, max: input.max,
          inputMode: input.getAttribute('inputmode'), pattern: input.getAttribute('pattern'),
        } : null,
        saveLabel: save ? c(save.innerText) : '',
        saveDisabled: save ? save.disabled : null,
        buttons: Array.from(dialog.querySelectorAll('button'))
          .map((b) => ({ label: c(b.innerText) || c(b.getAttribute('aria-label')), disabled: b.disabled }))
          .filter((b) => b.label),
        errors: Array.from(new Set(
          Array.from(dialog.querySelectorAll('p,span,div')).filter((e) => {
            const t = c(e.innerText);
            if (!t || t.length > 160 || e.children.length) return false;
            if (/^(save changes|cancel|update|save)$/i.test(t)) return false;
            return /^rgb\((2[0-9]{2}|1[89][0-9]),\s*\d+,\s*\d+\)/.test(getComputedStyle(e).color);
          }).map((e) => c(e.innerText)),
        )),
      };
    });
  }

  async typeTarget(value) {
    await this.page.evaluate((v) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((d) => /edit target/i.test(d.innerText || ''));
      const input = dialog.querySelector('input,textarea');
      const setter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(value));
    await this.page.waitForTimeout(700);
  }

  // What the modal does with a given value: what the field KEPT, whether Save is gated, and
  // any inline error.
  //
  // The value the field keeps is read rather than assumed. A numeric field can reject a
  // keystroke outright (holding ""), coerce it, or accept it — and "Save is enabled" means
  // something different in each case, so an assertion that only checked the button could not
  // tell "the field refused the input" from "the field took it and the form allows it".
  async editTargetGating(value) {
    await this.typeTarget(value);
    const state = await this.readEditTarget();
    return {
      typed: String(value),
      held: state && state.field ? state.field.value : null,
      saveDisabled: state ? state.saveDisabled : null,
      errors: state ? state.errors : [],
    };
  }

  async cancelEditTarget() {
    await this.editTargetDialog.getByRole('button', { name: /^cancel$/i }).first().click();
    await this.editTargetDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  async toastMessages() {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.Toastify__toast, .Toastify__toast-body, [role="status"], [role="alert"]'))
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
  }
}

module.exports = AgentProfilePage;
module.exports.TAB_PARAM = TAB_PARAM;
