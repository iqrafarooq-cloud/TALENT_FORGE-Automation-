// Agent Portal - EMPTY STATES, read off an agent that holds nothing at all.
//
// Driven by features/Agent_Portal/Empty-state.feature, signed in as NO_CANDIDATE_AGENT
// (iqra.farooq+211@bytecorp.io): zero candidates, zero documents. That is the only account on
// which the TAB-LEVEL empty states (the ones that say "nothing exists yet") can be observed - on
// AGENT_EMAIL every listing is populated and only the "No results found" family is reachable.
//
// >>> NOTHING HERE WRITES. <<< Every action is a navigation, a tab click, a search keystroke, a
// filter checkbox or "Clear all filters". The two "Invite Candidates" CTAs are asserted PRESENT
// and are never clicked: one invitation spends this fixture's zero-candidate state for good (a
// candidate cannot be deleted), which would destroy every scenario in the feature AND the
// welcome-modal / In Progress empty-state coverage elsewhere.
//
// Measured 2026-10-13 with the MCP browser on that account. Two empty-state shapes exist:
//
//   LISTING pages   <div class="-mt-1 max-w-[350px] space-y-1"><h3>heading</h3><p>body</p></div>
//                   with any CTA ("Clear all filters", "Invite Candidates") rendered as a SIBLING
//                   button further out - NOT inside that div, so a reader scoped to the text box
//                   reports "no CTA" for one that is plainly on screen.
//   DASHBOARD cards <p class="font-bold ...">heading</p><p class="text-xs ...">body</p>, inside
//                   each section card. No h3 at all, so the listing reader finds nothing there.
//
// No data-testid exists on either shape, so both readers are STRUCTURAL.
const BasePage = require('./BasePage');

const BASE = String(process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

// Every Agent Portal listing, by the name the feature file uses.
//   tabs     tab label -> data-testid (the listing's own quick-filter strip)
//   filters  the Filters trigger. Verifications' carries no test id, so it is found by name.
const PAGES = {
  'Active Candidates': {
    path: '/candidates/active',
    tabs: {
      All: 'agent-candidates-active-filter-all',
      Subscribed: 'agent-candidates-active-filter-subscribed',
      'Payment Due': 'agent-candidates-active-filter-payment-due',
      'Not Subscribed': 'agent-candidates-active-filter-not-subscribed',
    },
    filters: '[data-testid="agent-candidates-filters-button"]',
  },
  'In Progress': {
    path: '/candidates/in-progress',
    tabs: {
      All: 'agent-candidates-in-progress-filter-all',
      'Invite Sent': 'agent-candidates-in-progress-filter-invite-sent',
      'Onboarding Incomplete': 'agent-candidates-in-progress-filter-onboarding-incomplete',
    },
    filters: '[data-testid="agent-candidates-filters-button"]',
  },
  Deactivated: {
    path: '/candidates/deactivated',
    tabs: {},
    filters: '[data-testid="agent-candidates-deactivated-filters-button"]',
  },
  'Requires Attention': {
    path: '/candidates/requires-attention',
    tabs: {
      All: 'agent-candidates-requires-attention-filter-all',
      Warning: 'agent-candidates-requires-attention-filter-warning',
      Critical: 'agent-candidates-requires-attention-filter-critical',
    },
    filters: '[data-testid="agent-candidates-filters-button"]',
  },
  Verifications: {
    path: '/verifications',
    tabs: {
      All: 'agent-verifications-tab-all',
      'Needs Review': 'agent-verifications-tab-awaiting-verification',
      Approved: 'agent-verifications-tab-approved',
      'Revision Required': 'agent-verifications-tab-revision-required',
    },
    filters: null,
  },
  'Activity Log': {
    path: '/activity-log',
    tabs: {},
    filters: null, // a date-range dropdown, not a Filters modal - see selectActivityRange()
  },
};

const CTA_LABELS = ['Clear all filters', 'Invite Candidates'];

class AgentEmptyStatePage extends BasePage {
  constructor(page) {
    super(page);
    this.page = page;
  }

  static pageNames() { return Object.keys(PAGES); }

  spec(name) {
    const s = PAGES[name];
    if (!s) throw new Error(`Unknown Agent Portal page "${name}". Known: ${Object.keys(PAGES).join(', ')}`);
    return s;
  }

  /**
   * The welcome modal renders on every fresh session of a zero-candidate agent and its overlay
   * swallows clicks. It is suppressed client-side by sessionStorage.agent_welcome_shown (see
   * CLAUDE.md, "Agent Portal welcome + onboarding methods"), so setting that flag before any
   * page script runs keeps it down without dismissing anything. It is covered by its own feature.
   */
  async suppressWelcomeModal() {
    await this.page.context().addInitScript(() => {
      try { sessionStorage.setItem('agent_welcome_shown', '1'); } catch (_) { /* opaque origin */ }
    });
  }

  async open(name, query = '') {
    const { path } = this.spec(name);
    await this.gotoSignedIn(`${BASE}${path}${query}`);
  }

  /**
   * Navigate, and recover ONCE if the app bounced to /login. Measured 2026-10-13: under DEV
   * database load `auth/token/refresh/` answers 500 and the app drops the session mid-run, so a
   * long table step would otherwise lose every remaining row to a 30s "main never appeared". The
   * step that signed in sets `relogin`; each recovery is counted so the report shows it happened.
   */
  async gotoSignedIn(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const landed = await Promise.race([
      this.page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 }).then(() => 'main'),
      this.page.waitForURL(/\/login(\/|\?|$)/, { timeout: 30000 }).then(() => 'login'),
    ]).catch(() => 'timeout');
    if (landed === 'main' && !/\/login(\/|\?|$)/.test(this.page.url())) return;
    if (!this.relogin) throw new Error(`${url} did not render (${landed}) and no relogin is configured`);
    this.relogins = (this.relogins || 0) + 1;
    await this.relogin();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  }

  async openDashboard() {
    await this.gotoSignedIn(`${BASE}/dashboard`);
  }

  /**
   * The listing empty state: { heading, body, ctas, count }. `count` is how many h3 empty-state
   * headings are on screen - more than one would mean two states rendered at once.
   * Popovers/dialogs are excluded, so an open filter modal cannot be read as the list's state.
   */
  async readEmptyState() {
    return this.page.evaluate((ctaLabels) => {
      const main = document.querySelector('main');
      if (!main) return { heading: null, body: null, ctas: [], count: 0 };
      const inOverlay = (el) => !!el.closest('[role="dialog"], [role="listbox"], [role="menu"]');
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const states = [...main.querySelectorAll('h3')]
        .filter((h) => !inOverlay(h) && visible(h))
        .map((h) => {
          const p = h.parentElement && h.parentElement.querySelector(':scope > p');
          return { heading: h.innerText.trim(), body: p ? p.innerText.trim() : null };
        })
        .filter((s) => s.body !== null);
      // The Activity Log's own "nothing here" state is a different component: two <p> inside
      // .section-empty-state, no h3 (measured 2026-10-13). Without this the reader answers
      // "no empty state" for one that is plainly on screen.
      for (const sec of main.querySelectorAll('.section-empty-state')) {
        if (inOverlay(sec) || !visible(sec)) continue;
        const ps = [...sec.querySelectorAll('p')].map((p) => p.innerText.trim()).filter(Boolean);
        if (ps.length >= 2) states.push({ heading: ps[0], body: ps[1] });
      }
      const ctas = [...main.querySelectorAll('button, a')]
        .filter((b) => !inOverlay(b) && visible(b))
        .map((b) => b.innerText.trim())
        .filter((t) => ctaLabels.includes(t));
      const first = states[0] || { heading: null, body: null };
      return { ...first, ctas: [...new Set(ctas)], count: states.length };
    }, CTA_LABELS);
  }

  /**
   * Poll until the empty state reads `heading`, then return the read. Polling for the EXPECTED
   * heading rather than "any heading" matters: the listing keeps the previous query's state on
   * screen while the next is in flight, so a first read after a click is the OLD state. On a
   * timeout the last read is returned (not thrown), so the step can report what WAS shown.
   */
  async waitForEmptyState(heading, timeout = 20000, body = null) {
    // `body` matters wherever two queries share a heading: after a filter AND a search, the
    // filter-only "No results found" is on screen before the search's debounce fires, and a
    // heading-only wait reads it as the combined state (measured - it cost two scenarios).
    //
    // A match must HOLD for STABLE_MS before it is accepted. Measured 2026-10-14 (trace of a red
    // run): after a search the app paints "No results found / ...search" from the URL at once,
    // then swaps to its loading render while the search request is in flight, then paints the
    // state again. The old "match, wait 300ms, return a fresh read" landed in that gap and
    // returned heading null as the verdict - four scenarios red on In Progress / Requires
    // Attention against a state that settles correctly. A broken match now resets the clock.
    const STABLE_MS = 1500;
    const matches = (r) => r.heading === heading && (body === null || r.body === body);
    const until = Date.now() + timeout;
    let last = await this.readEmptyState();
    let matchedSince = matches(last) ? Date.now() : null;
    while (Date.now() < until) {
      if (matchedSince !== null && Date.now() - matchedSince >= STABLE_MS) return last;
      await this.page.waitForTimeout(300);
      last = await this.readEmptyState();
      if (!matches(last)) matchedSince = null;
      else if (matchedSince === null) matchedSince = Date.now();
    }
    return last;
  }

  async rowCount() {
    return this.page.locator('main [role="grid"] [role="row"]:has([role="gridcell"]), main .activity-log-item').count();
  }

  async selectTab(name, tab) {
    const id = this.spec(name).tabs[tab];
    if (!id) throw new Error(`"${name}" has no "${tab}" tab. Known: ${Object.keys(this.spec(name).tabs).join(', ') || '(none)'}`);
    await this.settle();
    const before = this.page.url();
    await this.page.getByTestId(id).click();
    // The tab writes ?activeFilter=; acting before it has committed lets a search typed next
    // be overwritten by the tab's own re-render.
    await this.page.waitForURL((u) => u.toString() !== before, { timeout: 10000 }).catch(() => {});
  }

  searchInput() {
    // Every listing's search box carries a "Search..." placeholder; only some carry a test id.
    return this.page.locator('main input[placeholder^="Search"]').first();
  }

  /** Wait until the listing has painted SOME state (an empty state or rows) - i.e. it has mounted. */
  async settle(timeout = 20000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if ((await this.readEmptyState()).heading || (await this.rowCount()) > 0) return;
      await this.page.waitForTimeout(300);
    }
  }

  /** The URL param a search writes: `activityLogSearch` on the Activity Log, `search` elsewhere. */
  searchParam() {
    const q = new URL(this.page.url()).searchParams;
    return q.get('search') ?? q.get('activityLogSearch');
  }

  /**
   * Type a search and CONFIRM it applied. Measured under load (3 headed workers, 2026-10-13):
   * typing while the listing is still mounting is thrown away - the box re-renders from the URL
   * and the default empty state stays up, which reads as "the search shows the wrong message".
   * So: wait for the listing to mount, type, then require the term to reach BOTH the box and the
   * URL (the debounce has fired); retype once if it did not.
   */
  async search(term) {
    await this.settle();
    const input = this.searchInput();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await input.click();
      await input.press('ControlOrMeta+a');
      await input.press('Backspace');
      // Real keystrokes: every search box here is debounced and listens to typing, not to a
      // single scripted value-set.
      await input.pressSequentially(term, { delay: 30 });
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        if ((await input.inputValue()) === term && this.searchParam() === term) return;
        await this.page.waitForTimeout(250);
      }
    }
    throw new Error(`the search "${term}" never applied: box holds "${await input.inputValue()}", URL ${this.page.url()}`);
  }

  async clearSearch() {
    const input = this.searchInput();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
  }

  filtersButton(name) {
    const sel = this.spec(name).filters;
    return sel ? this.page.locator(sel).first() : this.page.locator('main').getByRole('button', { name: /^Filters/ }).first();
  }

  /**
   * Apply the FIRST option of the Filters modal. On an empty account every option narrows to
   * nothing, so which one is irrelevant to the empty state - the first is chosen so the step
   * needs no knowledge of each modal's groups. The label is clicked with a REAL pointer click:
   * react-aria pressable labels ignore a scripted element.click().
   * @returns {Promise<string>} the option label that was applied
   */
  async applyFirstFilter(name) {
    return this.applyFilterOption(name, 0);
  }

  /** Every option label in the Filters modal, in DOM order (the index applyFilterOption takes). */
  async filterOptionLabels(name) {
    await this.settle();
    await this.filtersButton(name).click();
    const dialog = this.page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    // Only labels that wrap a checkbox/radio - Verifications' "Start Date"/"End Date" labels
    // belong to date pickers, which are driven separately.
    const labels = await dialog.locator('label:has(input)').allInnerTexts();
    await this.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return labels.map((l) => l.trim());
  }

  async applyFilterOption(name, index) {
    await this.settle();
    await this.filtersButton(name).click();
    const dialog = this.page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const label = dialog.locator('label:has(input)').nth(index);
    const text = (await label.innerText()).trim();
    await label.click();
    await dialog.getByRole('button', { name: /^Apply/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 15000 });
    return text;
  }

  async filtersBadge(name) {
    return (await this.filtersButton(name).innerText()).replace(/\s+/g, ' ').trim();
  }

  async selectActivityRange(label) {
    // The trigger's own label IS the current selection, so it is found structurally: the
    // button immediately following the aria-hidden mirror <select> container.
    const trigger = this.page.locator('main [data-testid="hidden-select-container"] + button, main button:has(+ [data-testid="hidden-select-container"])').first();
    const fallback = this.page.locator('main').getByRole('button', { name: /Last \d|Last 24|This year/ }).first();
    const t = (await trigger.count()) ? trigger : fallback;
    await t.click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async clickCta(label) {
    await this.page.locator('main').getByRole('button', { name: label, exact: true }).click();
  }

  /**
   * One dashboard section card's empty state, found from the card's TITLE. "Requires Attention"
   * and "Active Candidates" each appear twice on the dashboard (a KPI tile and a section card),
   * so the reader climbs from every occurrence of the title and keeps the one whose nearest
   * ancestor holds EXACTLY ONE empty-state heading - a KPI tile's ancestors jump straight from
   * zero to all three.
   */
  async readDashboardCard(title) {
    return this.page.evaluate(({ title, ctaLabels }) => {
      const main = document.querySelector('main');
      // The card heading is p.font-bold.mb-[0.25rem] followed by p.whitespace-pre-line. A KPI tile
      // also has a bold <p> ("0") followed by a <p> ("0 vs last month"), so the classes - not
      // merely "bold p then p" - are what tell the two apart.
      const isHeading = (p) => /font-bold/.test(p.className) && /mb-\[0\.25rem\]/.test(p.className)
        && p.nextElementSibling && p.nextElementSibling.tagName === 'P' && /whitespace-pre-line/.test(p.nextElementSibling.className);
      const titles = [...main.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.innerText && e.innerText.trim() === title);
      for (const t of titles) {
        let n = t.parentElement;
        for (let i = 0; i < 8 && n && n !== main; i++, n = n.parentElement) {
          const heads = [...n.querySelectorAll('p')].filter(isHeading).filter((p) => p !== t);
          if (heads.length === 0) continue;
          if (heads.length > 1) break;
          const h = heads[0];
          const ctas = [...n.querySelectorAll('button, a')].map((b) => b.innerText.trim()).filter((x) => ctaLabels.includes(x));
          return { heading: h.innerText.trim(), body: h.nextElementSibling.innerText.trim(), ctas };
        }
      }
      return null;
    }, { title, ctaLabels: CTA_LABELS });
  }

  /** A KPI tile's figure, polled past the literal "-" the dashboard paints before /candidate/stats/ answers. */
  async readKpi(label, timeout = 20000) {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      last = await this.page.evaluate((label) => {
        const main = document.querySelector('main');
        for (const e of main.querySelectorAll('*')) {
          if (e.children.length || (e.innerText || '').trim() !== label) continue;
          let s = e.nextElementSibling;
          if (!s && e.parentElement) s = e.parentElement.nextElementSibling;
          const v = s ? s.innerText.trim().split('\n')[0] : '';
          if (/^-?\d+$/.test(v)) return v;
        }
        return null;
      }, label);
      if (last !== null) return last;
      await this.page.waitForTimeout(500);
    }
    return last;
  }

  // ---------------------------------------------------------------- a candidate's View Profile
  //
  // Driven against EMPTY_PROFILE_CANDIDATE (a candidate who signed up and verified and did
  // nothing else). The profile nests a <main> per section inside the page's own <main>, so every
  // read is scoped to the FIRST (outer) one.

  async openProfile(id, tab) {
    await this.gotoSignedIn(`${BASE}/candidates/${id}/view-profile?selectedTab=${tab}`);
    // The tab strip and its panel paint seconds after the header.
    await this.page.getByRole('radio', { name: 'Activity Log' }).waitFor({ state: 'visible', timeout: 30000 });
  }

  async profileLines() {
    const raw = await this.page.locator('main').first().innerText();
    return raw.split('\n').map((l) => l.trim()).filter((l) => l && l !== ' ');
  }

  /**
   * The `n` lines after the LAST occurrence of `label`. Last, not first: "Track Progress" is a
   * header widget caption, a tab label AND the panel heading, and only the last is the panel.
   * Polled, because each tab paints its panel after the strip.
   */
  async linesAfter(label, n, timeout = 20000) {
    const until = Date.now() + timeout;
    let got = null;
    while (Date.now() < until) {
      const lines = await this.profileLines();
      const i = lines.lastIndexOf(label);
      if (i >= 0 && i + n < lines.length) {
        got = lines.slice(i + 1, i + 1 + n);
        if (got.every(Boolean)) return got;
      }
      await this.page.waitForTimeout(400);
    }
    return got;
  }

  async readPromoCode() {
    const text = await this.page.locator('main').innerText();
    const m = text.match(/Promo Code\s*\n+\s*([^\n]+)/);
    return m ? m[1].trim() : null;
  }
}

AgentEmptyStatePage.PAGES = PAGES;
module.exports = AgentEmptyStatePage;
