const BasePage = require('./BasePage');

// CandidateDetailPanelPage - the SUPERADMIN's candidate View, reached from the row action
// "View" on /candidates.
//
// >>> IT IS A DRAWER, NOT A PAGE, AND THAT IS THE ONE THING TO KNOW ABOUT IT. <<<
// Measured live 2026-09-07 (scripts/probe-superadmin-candidates.js):
//
//   * the URL stays exactly /candidates. There is NO /candidates/view/<id>.
//   * no tab writes a `?tab=` param, so a panel tab cannot be deep-linked, reloaded into,
//     or restored by the browser Back button.
//   * there is no Back control. The only way out is Close / Escape / the backdrop.
//   * NO lifecycle action is offered inside it - no Deactivate, no Reactivate, no "Log in
//     as". Those live only on the listing row.
//
// The AGENT equivalent (AgentProfilePage) is a real route at /agents/view/<id>?tab=, with a
// Back link and an overflow menu of actions. So none of the agent profile's navigation
// coverage transfers, and a step asserting a URL after View would be asserting a route this
// product does not have. That divergence is recorded rather than treated as a defect; ask
// the PO whether the candidate view is meant to be deep-linkable.
//
// STRUCTURE
//   header   candidate name | verification pill (Verified / Unverified) | headline |
//            current status (e.g. STUDENT) | city
//   KPIs     Track Progress %  |  Courses Completed  |  Hours Learned  |  Certificates
//            Earned - all four render an em dash placeholder until their data arrives
//   tabs     <button role="radio"> in one radiogroup, NOT role="tab":
//            Candidate Details | Track Progress | Documents | Subscription | Activity Log
//
// ONE ENDPOINT PER TAB, measured by watching the requests each tab fires:
//   Candidate Details  GET /core/api/v1/candidate/profile/<id>/
//   Documents          (none - it reads the SAME profile payload)
//   Track Progress     GET /core/api/v1/tracks/candidate/<id>/            404 when no track
//   Subscription       GET /core/api/v1/subscription/current/<id>/        404 when none
//   Activity Log       GET /core/api/v1/analytics/candidates/activity-logs/<id>/
//                          ?page=&page_size=&duration=<duration>
// The two 404s are the app's NORMAL answer for a candidate with no track / no subscription,
// not an error - the panel renders its own empty copy for each. A scenario treating a 404
// here as a failure would report every unsubscribed candidate as broken.
//
// TAB CONTENTS, both states measured:
//   Candidate Details  Basic Information | Education | Work Experience | Certifications |
//                      Work Preferences & Availability | Desired Roles. Each of the first
//                      four renders its own empty copy plus an "Add ..." CTA when unset.
//   Track Progress     populated, or "This candidate hasn't completed the psychometric
//                      assessment. A track will be assigned once results are in."
//   Documents          Education | Work Experience | Certifications, each listing
//                      <filename> + a status badge (Approved / Needs Review / ...) +
//                      "Uploaded on <date>", or "No <x> documents uploaded yet."
//   Subscription       "Subscription Details" with Status / Subscription Started / Current
//                      Subscription / Total Fee / Next Billing Date, or "This candidate does
//                      not have an active subscription."
//   Activity Log       a duration <select> over dated entries, or "No activity to show".

// The duration values the app sends, measured one option at a time. The labels are what the
// feature file speaks; the values are the implementation detail.
const ACTIVITY_DURATIONS = {
  'last 24 hours': 'last_24_hours',
  'last 7 days': 'last_7_days',
  'last 30 days': 'last_30_days',
  'last 3 months': 'last_3_months',
  'last 6 months': 'last_6_months',
  'this year': 'this_year',
};

const TABS = ['Candidate Details', 'Track Progress', 'Documents', 'Subscription', 'Activity Log'];

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class CandidateDetailPanelPage extends BasePage {
  constructor(page) {
    super(page);
    // The panel is found by the tab strip it OWNS, not by a heading: its heading is the
    // candidate's own name, which is different on every row and is also printed in the
    // listing behind it. "Candidate Details" is a phrase no other dialog on this screen
    // contains.
    this.panel = page.locator('[role="dialog"]').filter({ hasText: /candidate details/i }).first();
  }

  // ==================== Opening and closing ====================

  async isOpen() {
    return this.panel.isVisible().catch(() => false);
  }

  // >>> THE PROFILE IS FETCHED ONCE, WHEN THE DRAWER OPENS, AND BOTH Candidate Details AND
  // Documents READ THAT ONE PAYLOAD. <<< Measured 2026-09-07: clicking either of those two tabs
  // fires NO request, even after switching away and back - only Track Progress, Subscription
  // and Activity Log query on selection.
  //
  // That is sensible caching, but it means a per-tab request assertion can say nothing at all
  // about those two, and the first version of that assertion reported "Candidate Details fired
  // no request" - a true statement about a working panel and a misleading one about the
  // product. So the opening fetch is captured HERE instead, which is where it actually
  // happens, and is what proves the drawer is showing the candidate it was opened for.
  //
  // The listener has to be armed BEFORE the row action is clicked; arming it afterwards misses
  // the very request it exists to record.
  armOpeningWatch() {
    this._opening = [];
    this._openingListener = (request) => {
      const url = request.url();
      if (/\/api\/v1\//.test(url) && !/notifications/.test(url)) this._opening.push(url);
    };
    this.page.on('request', this._openingListener);
  }

  disarmOpeningWatch() {
    if (this._openingListener) {
      this.page.off('request', this._openingListener);
      this._openingListener = null;
    }
    return this._opening || [];
  }

  openingRequests() {
    return this._opening || [];
  }

  async waitForOpen(timeout = 30000) {
    await this.panel.waitFor({ state: 'visible', timeout });
    // The panel paints its chrome before its data: every KPI is an em dash and every section
    // is empty for about a second. A read taken at that moment reports a fully-populated
    // candidate as having nothing - the same class of bug as the billing grid's skeleton
    // rows. Settle on the tab strip being interactive, then let the first payload land.
    await this.panel.getByRole('radio', { name: 'Candidate Details', exact: true })
      .waitFor({ state: 'visible', timeout }).catch(() => {});
    await this.page.waitForTimeout(2500);
  }

  // A "not visible" read is also true of a panel the app has not rendered YET, so a single
  // check on a settling page reports "closed" for one about to appear. This watches a window.
  async staysClosed({ windowMs = 3000, everyMs = 250 } = {}) {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      if (await this.isOpen()) return { closed: false, at: windowMs - (deadline - Date.now()) };
      await this.page.waitForTimeout(everyMs);
    }
    return { closed: true, at: null };
  }

  async close() {
    await this.panel.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    await this.panel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  // MEASURED: Escape closes the drawer, but only as a REAL key press. A dispatched
  // KeyboardEvent is untrusted and the panel ignores it - so a probe that "tested Escape"
  // with document.dispatchEvent reported the drawer as un-closable when it closes fine.
  async closeVia(method) {
    const how = String(method).trim().toLowerCase();
    if (how === 'x icon' || how === 'x' || how === 'close') {
      await this.panel.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    } else if (how === 'escape') {
      await this.page.keyboard.press('Escape');
    } else if (how === 'backdrop') {
      await this.page.mouse.click(5, 5);
    } else {
      throw new Error(`Unknown close method "${method}" - expected X icon, Escape or backdrop.`);
    }
    await this.page.waitForTimeout(1200);
    return !(await this.isOpen());
  }

  // ==================== Tabs ====================

  static get TAB_NAMES() { return TABS.slice(); }

  async tabNames() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return [];
      return Array.from(d.querySelectorAll('[role="radio"]')).map((r) => c(r.innerText)).filter(Boolean);
    });
  }

  async selectedTab() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return '';
      const hit = Array.from(d.querySelectorAll('[role="radio"]'))
        .find((r) => r.getAttribute('aria-checked') === 'true');
      return hit ? c(hit.innerText) : '';
    });
  }

  // Opens a tab and hands back the request it fired, so a step can assert BOTH what the
  // panel rendered and what it asked the server for. A 404 is returned as data, not thrown:
  // it is the app's normal answer for a candidate with no track or no subscription.
  async openTab(name, { timeout = 15000 } = {}) {
    const wanted = TABS.find((t) => t.toLowerCase() === String(name).trim().toLowerCase());
    if (!wanted) throw new Error(`Unknown panel tab "${name}" - expected one of ${TABS.join(', ')}`);
    const pending = this.page.waitForResponse(
      (r) => /\/api\/v1\/(candidate\/profile|tracks\/candidate|subscription\/current|analytics\/candidates\/activity-logs)\//.test(r.url()),
      { timeout },
    ).catch(() => null);
    await this.panel.getByRole('radio', { name: wanted, exact: true }).click();
    const response = await pending;
    await this.page.waitForTimeout(2200);
    return {
      tab: wanted,
      requestUrl: response ? response.url() : '',
      status: response ? response.status() : null,
      requestFired: Boolean(response),
    };
  }

  // ==================== Header and KPIs ====================

  async readHeader() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      // Everything above the tab strip is the header. Derived from the strip's position
      // rather than from a class name, so a restyle cannot silently empty this reader.
      const strip = d.querySelector('[role="radiogroup"]');
      const text = c(d.innerText);
      const headerText = strip ? c(text.split(c(strip.innerText))[0]) : text;
      return {
        headerText,
        name: c((d.querySelector('p') || {}).innerText),
        // Both spellings are read because the listing column and the pill have been seen to
        // differ elsewhere in this app; the step asserts whichever the row claimed.
        verification: (headerText.match(/\b(Verified|Unverified)\b/) || [])[1] || '',
        buttons: Array.from(d.querySelectorAll('button'))
          .map((b) => c(b.innerText) || c(b.getAttribute('aria-label'))).filter(Boolean),
      };
    });
  }

  // The four KPI widgets. Each is a figure paragraph immediately followed by its caption, so
  // they are read STRUCTURALLY - the captions "Track Progress" and "Documents" also appear
  // as tab names, and a text-only reader picks the tab up as a KPI.
  //
  // Every figure starts as an em dash and is replaced when the payload lands, so `settled`
  // says whether what was read is a value or a placeholder. A step that treats the
  // placeholder as "no figure" reports a working panel as empty - the same trap the agent
  // dashboard's "-" KPI placeholder already caused.
  async readKpis() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return [];
      const strip = d.querySelector('[role="radiogroup"]');
      const ps = Array.from(d.querySelectorAll('p'));
      const out = [];
      ps.forEach((p, i) => {
        const next = ps[i + 1];
        if (!next) return;
        // >>> KPIs LIVE ABOVE THE TAB STRIP; ANYTHING BELOW IT BELONGS TO A TAB BODY. <<<
        // `strip.compareDocumentPosition(p)` describes p RELATIVE TO strip, so
        // DOCUMENT_POSITION_PRECEDING set means p comes before the strip - which is the half
        // to KEEP. Written the other way round first, this returned the Work Preferences
        // rows ("Current City -", "Open to Relocation -") as the drawer's summary figures:
        // they are <p> pairs whose value is a bare dash, so they satisfy every other test
        // here. A reader that resolves to the wrong part of the page invents defects, which
        // is what it did - it reported a drawer rendering all four KPIs as rendering none.
        if (strip && !(strip.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING)) return;
        const value = c(p.innerText);
        const caption = c(next.innerText);
        if (!caption || caption.length > 40) return;
        if (!/^(—|-|\d[\d.,]*%?|—%)$/.test(value)) return;
        out.push({ caption, value, settled: !/^—?%?$|^-$/.test(value) });
      });
      return out;
    });
  }

  // ==================== Candidate Details ====================

  async readCandidateDetails() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      // Each section is a <p> title followed by a <main>. Deriving the section from that
      // pairing keeps the reader honest about which text belongs to which heading - the
      // trap that made readCommentHistory() report a "Document Information" block as a
      // comment in the document-verification module.
      const sections = Array.from(d.querySelectorAll('main')).map((m) => {
        const title = m.previousElementSibling;
        return {
          title: title ? c(title.innerText) : '',
          text: c(m.innerText),
          empty: /^(nothing here yet|no .*(added|selected|uploaded).*)$/i.test(c(m.innerText).split('.')[0]),
          ctas: Array.from(m.querySelectorAll('button')).map((b) => c(b.innerText)).filter(Boolean),
        };
      }).filter((s) => s.title);
      return { sections, titles: sections.map((s) => s.title) };
    });
  }

  // ==================== Track Progress ====================

  async readTrackProgress() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const strip = d.querySelector('[role="radiogroup"]');
      const body = strip ? c(c(d.innerText).split(c(strip.innerText)).pop()) : c(d.innerText);
      return {
        body,
        // The app's own words for "no track yet", asserted as measured. A candidate WITH a
        // track has never been observed on this environment, so the populated shape is
        // reported rather than pinned - see the feature file's note.
        noAssessment: /hasn't completed the psychometric assessment/i.test(body),
      };
    });
  }

  // ==================== Documents ====================

  // Three groups, each holding rows of <filename> + status + "Uploaded on <date>", or its
  // own empty line. The status is read per FILE rather than per group: a candidate can hold
  // an Approved transcript and a Needs Review work letter at the same time, and a
  // group-level read cannot say which is which.
  async readDocuments() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const strip = d.querySelector('[role="radiogroup"]');
      const body = strip ? c(c(d.innerText).split(c(strip.innerText)).pop()) : c(d.innerText);
      const GROUPS = ['Education', 'Work Experience', 'Certifications'];
      const groups = GROUPS.map((g, i) => {
        const start = body.indexOf(g);
        if (start < 0) return { group: g, present: false, empty: null, text: '', files: [] };
        const nextAt = GROUPS.slice(i + 1)
          .map((n) => body.indexOf(n, start + g.length))
          .filter((n) => n > -1).sort((a, b) => a - b)[0];
        const text = c(body.slice(start + g.length, nextAt === undefined ? body.length : nextAt));
        return {
          group: g,
          present: true,
          empty: /^no .* documents uploaded yet\.?$/i.test(text),
          text,
          // "<file> <Status> Uploaded on <date>", repeated. Parsed rather than pattern-matched
          // on a hoped-for status, so an unexpected status is REPORTED instead of dropped.
          files: (text.match(/\S+\.(?:pdf|png|jpe?g|webp|docx?)\s+.+?Uploaded on\s+[^,]+,\s+\d{4}/gi) || [])
            .map((raw) => {
              const m = raw.match(/^(\S+)\s+(.*?)\s+Uploaded on\s+(.+)$/i);
              return m ? { name: m[1], status: c(m[2]), uploadedOn: c(m[3]), raw: c(raw) } : { raw: c(raw) };
            }),
        };
      });
      return { body, groups, allEmpty: groups.every((g) => g.empty) };
    });
  }

  // ==================== Subscription ====================

  async readSubscription() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const strip = d.querySelector('[role="radiogroup"]');
      const body = strip ? c(c(d.innerText).split(c(strip.innerText)).pop()) : c(d.innerText);
      const FIELDS = ['Status', 'Subscription Started', 'Current Subscription', 'Total Fee', 'Next Billing Date'];
      const fields = {};
      FIELDS.forEach((f, i) => {
        const start = body.indexOf(f);
        if (start < 0) return;
        const nextAt = FIELDS.slice(i + 1)
          .map((n) => body.indexOf(n, start + f.length))
          .filter((n) => n > -1).sort((a, b) => a - b)[0];
        fields[f] = c(body.slice(start + f.length, nextAt === undefined ? body.length : nextAt));
      });
      return {
        body,
        heading: /subscription details/i.test(body) ? 'Subscription Details' : '',
        // The app's own words when there is nothing to show. The endpoint answers 404 in
        // this state and that is CORRECT - see the header note.
        none: /does not have an active subscription/i.test(body),
        fields,
        fieldsPresent: Object.keys(fields),
      };
    });
  }

  // ==================== Activity Log ====================

  async readActivityLog() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return null;
      const sel = d.querySelector('select');
      const strip = d.querySelector('[role="radiogroup"]');
      const body = strip ? c(c(d.innerText).split(c(strip.innerText)).pop()) : c(d.innerText);
      return {
        body,
        periods: sel ? Array.from(sel.options).map((o) => c(o.text)).filter(Boolean) : [],
        periodValues: sel ? Array.from(sel.options).map((o) => o.value).filter(Boolean) : [],
        selectedPeriod: sel ? c((sel.selectedOptions[0] || {}).text) : '',
        // "No activity to show" is a legitimate answer for a chosen period, so it is
        // reported rather than treated as a failure to load.
        noActivity: /no activity to show/i.test(body),
        // One per `.activity-log-item` (the app's own row), never de-duplicated by text - two
        // entries can render identically. Falls back to <li> for an older layout.
        entries: (d.querySelectorAll('.activity-log-item').length
          ? Array.from(d.querySelectorAll('.activity-log-item')) : Array.from(d.querySelectorAll('li')))
          .map((li) => c(li.innerText)).filter(Boolean),
      };
    });
  }

  async selectActivityPeriod(label) {
    const key = String(label).trim().toLowerCase();
    if (!(key in ACTIVITY_DURATIONS)) {
      throw new Error(
        `Unknown activity period "${label}" - the panel offers `
        + `${Object.keys(ACTIVITY_DURATIONS).join(', ')}`,
      );
    }
    const pending = this.page.waitForResponse(
      (r) => /\/analytics\/candidates\/activity-logs\//.test(r.url()),
      { timeout: 15000 },
    ).catch(() => null);
    await this.panel.locator('select').first().selectOption({ label: String(label) });
    const response = await pending;
    await this.page.waitForTimeout(1800);
    return {
      requestUrl: response ? response.url() : '',
      expectedDuration: ACTIVITY_DURATIONS[key],
      requestFired: Boolean(response),
    };
  }

  static durationFor(label) {
    return ACTIVITY_DURATIONS[String(label).trim().toLowerCase()] || null;
  }

  // The whole panel as one object, for the report attachment. A green run is then a record of
  // what the app rendered that day, which is what makes a later change diagnosable.
  async snapshot() {
    return {
      selectedTab: await this.selectedTab(),
      tabs: await this.tabNames(),
      header: await this.readHeader(),
      kpis: await this.readKpis(),
    };
  }

  rowLocator(needle) {
    return this.panel.locator('[role="row"]').filter({ hasText: new RegExp(escapeRegExp(needle), 'i') }).first();
  }

  // ==================== PART 2 (2026-10-26): the Documents tab's row actions and viewer ====================
  //
  // MEASURED 2026-10-26 (scripts/probe-superadmin-candidate-drawer.js, read-only):
  //   row      `.document-list-item`: a file-type icon, the file name as a <button>, the status
  //            pill, "Uploaded on <date>", and two bare <svg> actions -
  //            data-testid candidate-profile-document-view-button / -download-button
  //   View     opens a SECOND dialog "Document Verification": the preview (react-pdf for a PDF),
  //            a zoom level between "Zoom out" and "Zoom in", "Download", and Document
  //            Information - Document Name / Document Type / Date Uploaded / Status / Version
  //            (v<n>.0) - then "Flagged for" (the AI's findings, "Automated System Message") and,
  //            ON A Needs Review DOCUMENT ONLY, "Request Revision" + "Approve" (agent-* test ids).
  //            Opening it fires NO request - it re-renders the profile payload.
  //   Download (row, and in the viewer) delivers the real file under its stored name; the viewer
  //            stays open. Escape / X close the viewer only - the drawer stays on Documents.
  //   name     clicking the file name does nothing at all (no dialog, no download, no request).
  // The decision buttons are only ever READ here. Nothing in this page object clicks them.

  get viewer() {
    return this.page.locator('[role="dialog"]').filter({ hasText: /document information/i }).last();
  }

  documentRow(fileName) {
    return this.panel.locator('.document-list-item').filter({ hasText: String(fileName) }).first();
  }

  async readDocumentRows() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const d = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /candidate details/i.test(x.innerText || '')).pop();
      if (!d) return [];
      const GROUPS = ['Education', 'Work Experience', 'Certifications'];
      return Array.from(d.querySelectorAll('.document-list-item')).map((row) => {
        // The group a row belongs to is the nearest group heading BEFORE it in document order.
        let group = '';
        const heads = Array.from(d.querySelectorAll('p, h2, h3, h4')).filter((h) => GROUPS.includes(c(h.innerText)));
        heads.forEach((h) => { if (h.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) group = c(h.innerText); });
        const name = c((row.querySelector('button') || {}).innerText);
        const text = c(row.innerText);
        const uploaded = (text.match(/Uploaded on\s+(.+)$/i) || [])[1] || '';
        const status = c(text.replace(name, '').replace(/Uploaded on.*$/i, ''));
        return {
          group,
          name,
          status,
          uploadedOn: c(uploaded),
          view: Boolean(row.querySelector('[data-testid="candidate-profile-document-view-button"]')),
          download: Boolean(row.querySelector('[data-testid="candidate-profile-document-download-button"]')),
        };
      });
    });
  }

  // react-pdf takes ~9.5s to paint a PDF's first page, so a PDF waits for a rendered page (an
  // image document needs no such wait). Timing out here is not thrown - readViewer() then reports
  // pdfPages 0 and the step names it.
  async openDocumentViewer(fileName) {
    await this.documentRow(fileName).locator('[data-testid="candidate-profile-document-view-button"]').click();
    await this.viewer.waitFor({ state: 'visible', timeout: 20000 });
    if (/\.pdf$/i.test(String(fileName))) {
      await this.viewer.locator('.react-pdf__Page canvas').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    }
    await this.page.waitForTimeout(1000);
  }

  async readViewer() {
    return this.page.evaluate(() => {
      const c = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const v = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => /document information/i.test(x.innerText || '')).pop();
      if (!v) return null;
      const text = c(v.innerText);
      const LABELS = ['Document Name', 'Document Type', 'Date Uploaded', 'Status', 'Version'];
      const fields = {};
      LABELS.forEach((l, i) => {
        const start = text.indexOf(l);
        if (start < 0) return;
        const ends = [...LABELS.slice(i + 1), 'Flagged for', 'Comment History', 'Automated System Message', 'Request Revision', 'Approve']
          .map((n) => text.indexOf(n, start + l.length)).filter((n) => n > -1).sort((a, b) => a - b);
        fields[l] = c(text.slice(start + l.length, ends.length ? ends[0] : text.length));
      });
      const flagged = text.includes('Flagged for')
        ? c(text.slice(text.indexOf('Flagged for') + 'Flagged for'.length).split(/Automated System Message|Comment History|Request Revision|Approve/)[0])
        : '';
      const buttons = Array.from(v.querySelectorAll('button')).map((b) => ({
        label: c(b.getAttribute('aria-label')) || c(b.innerText), disabled: b.disabled, testid: b.getAttribute('data-testid'),
      }));
      return {
        heading: c((v.querySelector('h1,h2,h3') || {}).innerText),
        fields,
        flagged,
        zoom: (text.match(/(\d+)%/) || [])[1] ? Number(text.match(/(\d+)%/)[1]) : null,
        pdfPages: v.querySelectorAll('.react-pdf__Page').length,
        canvases: v.querySelectorAll('canvas').length,
        images: v.querySelectorAll('img').length,
        buttons,
        decisions: buttons.filter((b) => /^(approve|request revision)$/i.test(b.label)).map((b) => b.label),
      };
    });
  }

  async zoomViewer(direction) {
    const btn = this.viewer.getByRole('button', { name: direction === 'in' ? 'Zoom in' : 'Zoom out', exact: true });
    if (await btn.isDisabled()) return { clicked: false };
    await btn.click();
    await this.page.waitForTimeout(1200);
    return { clicked: true };
  }

  async viewerZoomDisabled(direction) {
    return this.viewer.getByRole('button', { name: direction === 'in' ? 'Zoom in' : 'Zoom out', exact: true }).isDisabled();
  }

  // Returns the Playwright Download (or null) the action produced within the window.
  async captureDownload(action, timeout = 20000) {
    const pending = this.page.waitForEvent('download', { timeout }).catch(() => null);
    await action();
    return pending;
  }

  async downloadFromViewer() {
    return this.captureDownload(() => this.viewer.getByRole('button', { name: /^download$/i }).first().click());
  }

  async downloadFromRow(fileName) {
    return this.captureDownload(() => this.documentRow(fileName)
      .locator('[data-testid="candidate-profile-document-download-button"]').click());
  }

  async closeViewerVia(method) {
    const how = String(method).trim().toLowerCase();
    if (how === 'escape') await this.page.keyboard.press('Escape');
    else if (how === 'x icon') await this.viewer.getByRole('button', { name: /^close( dialog)?$/i }).first().click();
    else throw new Error(`Unknown way to close the viewer "${method}" - X icon or Escape.`);
    await this.viewer.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(800);
  }

  // ==================== Track Progress with a track ====================
  //
  // MEASURED: "Track Progress | <track title> | <n>% | <course> | <Not Started|In Progress|
  // Completed> | <lesson> | - ...". Read as the body text; the steps compare it with the
  // tracks payload rather than parsing a layout.
  async trackBody() {
    return (await this.readTrackProgress()).body;
  }
}

module.exports = CandidateDetailPanelPage;
