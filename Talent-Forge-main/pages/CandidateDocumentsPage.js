// CandidateDocumentsPage - the candidate's side of document verification.
//
// ============================================================================
// MEASURED LIVE 2026-08-24
// ============================================================================
//
// WHERE THE DOCUMENTS ARE. There are TWO surfaces and they disagree.
//
//   /dashboard  "Your Documents"      - a SUBSET (4 rows when the account held 96), each
//                                       with a status pill and a "View" that opens the
//                                       verification panel.
//   /profile?selectedTab=documents    - EVERY document, with status and upload date, but
//                                       clicking one DOWNLOADS it. No panel, no reasons.
//
// So the surface that lists everything explains nothing, and the surface that explains
// things does not list everything. A candidate whose document was flagged today will not
// find it on the dashboard at all.
//
// `/documents` and `/my-documents` render an empty body - neither is the page.
//
// THE VIEW PANEL is the same "Document Verification" dialog the agent gets, minus the
// decision controls and minus the "Flagged for" block, plus a **"Comment History"**
// block. A history entry renders as "<comment> <source> - <timestamp>", e.g.
// "rf  Agent  -  Apr 25, 2026, 12:22 PM".
//
// >>> THE CANDIDATE IS NOT SHOWN THE AI'S FINDINGS. <<<
// The agent's "Flagged for" block is derived live from ai_verification.criteria. The
// candidate's panel has no such block - it shows only stored COMMENT rows. Measured
// 2026-08-24: of 71 documents carrying a failing criterion, **52 have no comment at all**.
// So for roughly three quarters of flagged documents the candidate is shown a status and
// nothing whatsoever about what to correct.
//
// Comment sources across the account: AI 19, AGENT 8 - so the taxonomy does distinguish
// them where a comment exists.
//
// >>> THE DASHBOARD LIST IS NOT THE FULL SET. <<<
// Measured 2026-08-24: the dashboard's "Your Documents" block listed **4** documents, all
// from March-May, while Profile > Documents listed dozens including that day's uploads.
// So a candidate whose document was just flagged will NOT find it on the dashboard.
//
// >>> RE-MEASURED 2026-09-01 - THREE OF THE NOTES ABOVE WERE STALE. THE BUILD CHANGED. <<<
//
//   (a) Profile > Documents DOES carry a status now, grouped under Education / Work
//       Experience / Certifications, one badge per row.
//   (b) That tab labels AWAITING **"Needs Review"** - the same string the agent's pill
//       uses, NOT "Awaiting Verification". STATUS_LABEL below was wrong, and because
//       readDocumentCards() classifies rows by those strings it returned **0 cards** on
//       a dashboard plainly showing four. A reader that can only ever answer "absent" is
//       the trap this repo has paid for repeatedly.
//   (c) Clicking a filename on that tab does NOTHING - no panel, no download, no
//       navigation, no request. It is a real <button>, so something is meant to happen.
//       Reported by documentsTabRowActivation() rather than asserted away.
//
// >>> THE DASHBOARD BLOCK IS HARD-CAPPED AT FOUR, AND THE CAP IS THE APP'S OWN. <<<
// Measured 2026-09-01: the block issues
//     GET /core/api/v1/candidate/documents/?page=1&page_size=4
// against count: 29, and the response carries a "next" page the UI never exposes - there
// is no pagination control, no "View All", no "show more". So 25 of 29 documents have NO
// reachable panel, and the four that do are not the newest.
//
// dashboardPagingContract() reads that request back off the wire, so the cap is asserted
// as a MEASURED number rather than a remembered one - hardcoding 4 would go stale
// silently the day dev raises it, and the finding is the absence of a way past the cap,
// not the figure.
//
// widenDashboardPaging() rewrites page_size so a scenario can reach the panel of a
// document the UI caps out of view. It changes only the page SIZE of a request the app
// already paginates: every row, status, comment and reason still comes from the server
// and is still rendered by the app, so nothing is faked. It is recorded on every
// scenario that uses it, and the cap has its own scenario that does NOT widen -
// otherwise the widening would hide the defect it exists to work around.
//
// >>> THERE IS NO RESUBMIT CONTROL IN THIS PANEL. <<<
// Measured: zero <input type="file"> elements and a single "Download" button. So the
// AC's "the candidate must be able to resubmit a corrected document" is NOT satisfied
// from the place the candidate is told what to correct. Whatever resubmission path
// exists is elsewhere (the profile's education / work / certification sections, which
// is what the API-level resubmit drives). `resubmitControl()` below returns what it
// actually finds so a scenario reports "no resubmit control is offered here" as a
// finding rather than timing out on a locator.

const BasePage = require('./BasePage');

const APP = (process.env.BASE_URL || 'https://dev.talentforge.com.sa/login').replace(/\/login\/?$/, '');

// >>> THE TWO PORTALS AGREE ON THE STATUS WORDING NOW - THEY DID NOT ON 2026-08-24. <<<
// Then, the candidate's tab rendered the API's `AWAITING` as "Awaiting Verification"
// while the agent's queue rendered the identical status as "Needs Review". Re-measured
// 2026-09-01 both candidate surfaces render **"Needs Review"**, matching the agent pill.
//
// This map stays a separate copy rather than importing the agent page's, and that is
// precisely why the old divergence was observable at all: a shared constant would have
// hidden it, and a shared constant would hide the next one. Same lesson as the community
// module's public profile. The scenario that compares the two portals reads BOTH maps.
//
// The one string still not agreed is the FILTER TAB, which reads "Need Review" (singular)
// against a pill reading "Needs Review" - see AgentVerificationsPage.TAB_LABEL.
const STATUS_LABEL = {
  AWAITING: 'Needs Review',
  APPROVED: 'Approved',
  REVISION: 'Revision Required',
};

// Kept so a surface still rendering the old wording is REPORTED rather than read as
// "no status". Never used to classify a row.
const LEGACY_AWAITING_LABEL = 'Awaiting Verification';

// The Documents tab groups rows under these headings, and that grouping is the only
// place a row's category appears - the row itself carries no category text.
const DOCUMENTS_TAB_SECTIONS = ['Education', 'Work Experience', 'Certifications'];

// Anchored, so a heading is matched whole. "Education" also appears inside longer strings
// on the profile (the Candidate Details tab's own section), and an unanchored match would
// wait on the wrong node and then read an empty Documents tab.
const SECTION_HEADING_PATTERN = '^(' + DOCUMENTS_TAB_SECTIONS.join('|') + ')$';

class CandidateDocumentsPage extends BasePage {
  constructor(page) {
    super(page);
    this.dashboardUrl = `${APP}/dashboard`;
    this.documentsTabUrl = `${APP}/profile?selectedTab=documents`;
    this.panel = page.locator('[role="dialog"]').filter({ hasText: 'Document Verification' }).first();
  }

  async openDashboard() {
    await this.navigate(this.dashboardUrl);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    // Wait for the block itself. The dashboard paints its widgets progressively and the
    // documents block is near the bottom, so waiting on load alone reads an empty list.
    await this.page
      .getByText('Your Documents', { exact: false })
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {
        throw new Error(
          'The "Your Documents" block never appeared on /dashboard. Note this is the only place ' +
            'candidate documents are listed - /documents and /my-documents both render empty.'
        );
      });
  }

  // Read the document cards structurally: a card is the smallest block that holds both a
  // status pill and a "View" control. Derived that way rather than by class name so a
  // Tailwind churn cannot break it, and so page chrome cannot be mistaken for a card -
  // the same reasoning as CommunityPage.readMemberCards(), whose text-length heuristic
  // silently dropped 5 of 12 cards.
  async readDocumentCards() {
    return this.page.evaluate((labels) => {
      const statuses = Object.values(labels);
      const hasStatus = (t) => statuses.find((s) => t.includes(s)) || null;

      const views = [...document.querySelectorAll('button,a')].filter((e) =>
        /^view$/i.test((e.textContent || '').trim())
      );

      // A card must contain a FILE NAME, not merely a status word. Without that the walk
      // up the tree keeps going until it swallows the whole dashboard - the streak
      // calendar and the "Welcome Back" header included - and reports that blob as a
      // document. Same over-capture that CommunityPage.readMemberCards() was fixed for.
      const FILENAME = /([\w .,()-]+\.(?:pdf|png|jpe?g|docx|webp))/i;
      const cards = [];
      for (const v of views) {
        let host = v.parentElement;
        let status = null;
        let text = '';
        for (let i = 0; i < 6 && host; i++) {
          text = (host.textContent || '').replace(/\s+/g, ' ').trim();
          status = hasStatus(text);
          if (status && FILENAME.test(text) && text.length < 250) break;
          status = null;
          host = host.parentElement;
        }
        if (!host || !status) continue;
        const uploaded = (/Uploaded on ([A-Za-z]+ \d{1,2}, \d{4})/.exec(text) || [])[1] || null;
        const name = (FILENAME.exec(text) || [])[1];
        if (!name) continue;
        cards.push({ documentName: name.trim(), status, uploadedOn: uploaded, raw: text });
      }
      // Same card can be reached twice if nested; de-duplicate on name + status.
      const seen = new Set();
      return cards.filter((c) => {
        const k = `${c.documentName}|${c.status}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }, STATUS_LABEL);
  }

  // Find one card, refusing to guess between several. Uploaded files carry a random
  // suffix, so this is a prefix match with the same disambiguation discipline as the
  // agent page.
  async findCard(fileNameOrPrefix) {
    const cards = await this.readDocumentCards();
    const hits = cards.filter((c) => c.documentName.includes(fileNameOrPrefix));
    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      throw new Error(
        `No document card matches "${fileNameOrPrefix}" on the candidate dashboard.\n` +
          `The dashboard lists ${cards.length}: ` +
          (cards.map((c) => `${c.documentName} [${c.status}]`).join(', ') || '(none)') +
          '\n\nNOTE: the dashboard "Your Documents" block shows only a SUBSET of the account. ' +
          'Measured 2026-08-24: 4 rows while the account held 99 documents, 35 of them decided. ' +
          'So a document being absent here is very often a PRODUCT limitation, not a bad locator - ' +
          'the candidate genuinely cannot reach it. Profile > Documents lists them all but only ' +
          'downloads on click, so it shows no remarks either.'
      );
    }
    throw new Error(
      `"${fileNameOrPrefix}" matches ${hits.length} document cards, so this would open an arbitrary one:\n  ` +
        hits.map((c) => c.documentName).join('\n  ')
    );
  }

  // >>> THE ANCESTOR WALK MUST STOP AT THE CARD BOUNDARY <<<
  //
  // This used to walk up to six ancestors from each "View" control and click as soon as one
  // CONTAINED the target name. Four levels up, that ancestor is the whole "Your Documents"
  // container, whose textContent holds EVERY card's name - so the very first View always
  // satisfied the test and this method opened the FIRST card no matter which one was asked
  // for. Measured 2026-08-25: asked for "Screenshot_from_2026-03-25_19-33-48_RD5y5VY.png"
  // [Revision Required], opened "Empty_GYFa8Bv.png" [Approved]. The scenario then failed as
  // "the candidate sees the status as Approved", which reads like a product defect in the
  // status the candidate is shown, and is not one.
  //
  // readDocumentCards() never had this bug because it requires the host to hold a FILENAME
  // and be under 250 characters - the tight card boundary. So the fix is to derive each
  // View's OWN card the same way and match on that, rather than asking whether the target
  // appears somewhere beneath a shared ancestor. Same lesson as CommunityPage's member
  // cards: derive the boundary structurally, then read inside it.
  async openDocument(fileNameOrPrefix) {
    const card = await this.findCard(fileNameOrPrefix);
    const clicked = await this.page.evaluate((name) => {
      const FILENAME = /([\w .,()-]+\.(?:pdf|png|jpe?g|docx|webp))/i;
      const views = [...document.querySelectorAll('button,a')].filter((e) =>
        /^view$/i.test((e.textContent || '').trim())
      );
      const seen = [];
      for (const v of views) {
        // The tightest ancestor that looks like one card, by the same rule
        // readDocumentCards() uses.
        let host = v.parentElement;
        let own = null;
        for (let i = 0; i < 6 && host; i++) {
          const text = (host.textContent || '').replace(/\s+/g, ' ').trim();
          const hit = FILENAME.exec(text);
          if (hit && text.length < 250) {
            own = hit[1].trim();
            break;
          }
          host = host.parentElement;
        }
        if (!own) continue;
        seen.push(own);
        if (own === name) {
          v.click();
          return { ok: true, opened: own };
        }
      }
      return { ok: false, cardsSeen: seen };
    }, card.documentName);

    // A failed click used to be ignored, and the panel wait then "succeeded" on whatever
    // was already open - which is how opening the wrong document looked like a passing step.
    if (!clicked.ok) {
      throw new Error(
        `Found the card for "${card.documentName}" but could not resolve its own View control.\n` +
          `View controls resolved to these cards: ${JSON.stringify(clicked.cardsSeen)}\n` +
          'If the dashboard markup changed, the card boundary rule in this method and in ' +
          'readDocumentCards() must change together.'
      );
    }

    await this.panel.waitFor({ state: 'visible', timeout: 30000 });
    await this.panel.getByText('Document Information', { exact: false }).waitFor({ timeout: 30000 });

    // Confirm the panel is showing the document that was asked for. Without this the caller
    // has no way to tell "the candidate sees the wrong status" from "the suite opened the
    // wrong document", and those send the reader to opposite places.
    const shown = (/^Document Name\s*\n\s*(.+)$/im.exec(await this.panel.innerText()) || [])[1];
    if (shown && shown.trim() !== card.documentName) {
      throw new Error(
        `Asked to open "${card.documentName}" but the panel is showing "${shown.trim()}". ` +
          'Every assertion after this point would describe the wrong document.'
      );
    }
    return card;
  }

  // Same label-based reader as the agent panel. Positional reads break when a field is
  // inserted, and this panel has already gained one (Version).
  async readPanel() {
    const text = (await this.panel.innerText()).replace(/\r/g, '');
    const field = (label) => {
      const m = new RegExp(`^${label}\\s*\\n\\s*(.+)$`, 'im').exec(text);
      return m ? m[1].trim() : null;
    };
    return {
      documentName: field('Document Name'),
      documentType: field('Document Type'),
      dateUploaded: field('Date Uploaded'),
      status: field('Status'),
      version: field('Version'),
      commentHistory: await this.readCommentHistory(),
      resubmit: await this.resubmitControl(),
      fullText: text,
    };
  }

  // The decision trail the candidate is shown. Each entry is parsed into its comment and
  // its SOURCE, because "who flagged the document" is an explicit AC requirement and a
  // whole-blob `includes()` check cannot tell "Agent" appearing as a byline from "agent"
  // appearing inside somebody's reason text.
  async readCommentHistory() {
    const heading = this.panel.getByText('Comment History', { exact: false }).first();
    if (!(await heading.count())) return [];
    const raw = await this.panel.evaluate((root) => {
      const h = [...root.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && /^comment history$/i.test((e.textContent || '').trim())
      );
      if (!h) return [];

      // The walk up used to stop at the first ancestor holding more than 60 characters,
      // which on this panel is an ancestor of BOTH sections - so the whole "Document
      // Information" block came back as a comment entry, with source null. It then read as
      // a real comment the app had failed to attribute, which is a different (and
      // non-existent) defect from the one being investigated.
      //
      // The section boundary is where "Document Information" starts appearing, so climb
      // only while the ancestor stays clear of it.
      const OTHER_SECTION = /document information/i;
      let box = h.parentElement;
      while (box && box !== root) {
        const parent = box.parentElement;
        if (!parent || parent === root) break;
        if (OTHER_SECTION.test(parent.textContent || '')) break;
        // Stop once the box holds more than the heading itself - that is the entry list.
        if ((box.textContent || '').replace(/\s+/g, ' ').trim().length > 'comment history'.length + 10) break;
        box = parent;
      }
      if (!box || OTHER_SECTION.test(box.textContent || '')) return [];

      return [...box.children]
        .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && !/^comment history$/i.test(t) && !OTHER_SECTION.test(t));
    });

    // "<comment> <source> - <date>". The source is the token immediately before the
    // timestamp, which is the only reliably delimited part of the entry.
    return raw.map((entry) => {
      const m = /^(.*?)\s*(Agent|Automated System Message|AI Review|System)\s*[•\-•]?\s*(.*)$/i.exec(entry);
      return m
        ? { comment: m[1].trim(), source: m[2].trim(), timestamp: m[3].trim(), raw: entry }
        : { comment: entry, source: null, timestamp: null, raw: entry };
    });
  }

  // What, if anything, lets the candidate resubmit from here. Returns a shape rather
  // than throwing so a scenario can report the ABSENCE as a finding - measured live,
  // there is nothing: no file input and no upload control, only Download.
  async resubmitControl() {
    const fileInputs = await this.panel.locator('input[type="file"]').count();
    const buttons = await this.panel.locator('button, a').evaluateAll((els) =>
      els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );
    const upload = buttons.filter((t) => /upload|re-?submit|replace|change|new version/i.test(t));
    return {
      present: fileInputs > 0 || upload.length > 0,
      fileInputs,
      uploadControls: upload,
      controlsOffered: buttons,
    };
  }

  // -------------------------------------------------------------------------
  // PROFILE > DOCUMENTS TAB
  // -------------------------------------------------------------------------

  // The surface that lists EVERY document. It answers "did my upload arrive, and what
  // status does it carry" - a different question from "why", which only the dashboard
  // panel answers.
  async openDocumentsTab() {
    await this.navigate(this.documentsTabUrl);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    // Wait for a SECTION heading, not for the tab control. The tab exists the moment the
    // profile shell paints while the rows arrive with the documents request, and a read
    // in between finds an empty tab that is indistinguishable from an empty account.
    await this.page
      .getByText(new RegExp(SECTION_HEADING_PATTERN))
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {
        throw new Error(
          'Profile > Documents never rendered any of its section headings (' +
            DOCUMENTS_TAB_SECTIONS.join(', ') +
            '). Reached ' +
            this.page.url()
        );
      });
  }

  // Read every row on the Documents tab, structurally.
  //
  // A row is derived from its STATUS BADGE, never from a class name and never from the
  // filename. The badge is .status-badge-label inside .status-badge, and the block that
  // holds it also holds the filename button and the "Uploaded on" line. Deriving from
  // the badge rather than the name is deliberate: a document whose name failed to render
  // would otherwise vanish from the read entirely, instead of being reported as a row
  // with a null name - and "the document is not listed" is exactly the conclusion that
  // must never be reached by accident.
  async readDocumentsTabRows() {
    return this.page.evaluate(
      ({ sections, labels, legacy }) => {
        const known = Object.values(labels).concat(legacy);
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const FILENAME = /([\w .,()-]+\.(?:pdf|png|jpe?g|webp|docx))/i;

        // Section headings in document order, so a row can be attributed to one.
        const headings = [...document.querySelectorAll('*')]
          .filter((e) => e.children.length === 0 && sections.includes(clean(e.textContent)))
          .map((e) => ({ name: clean(e.textContent), el: e }));

        const badges = [...document.querySelectorAll('.status-badge-label')].filter(
          (b) => b.offsetParent !== null
        );

        const rows = [];
        for (const badge of badges) {
          const status = clean(badge.textContent);
          if (!known.includes(status)) continue;

          // Climb to the block holding the filename too - at most five levels, and stop
          // as soon as a name is in scope. Bounded so a missing name cannot let the walk
          // swallow the whole tab, the over-capture CommunityPage.readMemberCards() had
          // to be fixed for.
          let host = badge.parentElement;
          let text = '';
          for (let i = 0; i < 5 && host; i++) {
            text = clean(host.textContent);
            if (FILENAME.test(text) && text.length < 400) break;
            host = host.parentElement;
          }
          if (!host) continue;

          let section = null;
          for (const h of headings) {
            if (h.el.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING) {
              section = h.name;
            }
          }

          const name = (FILENAME.exec(text) || [])[1];
          rows.push({
            documentName: name ? name.trim() : null,
            status,
            section,
            uploadedOn: (/Uploaded on ([A-Za-z]+ \d{1,2}, \d{4})/.exec(text) || [])[1] || null,
            raw: text.slice(0, 300),
          });
        }
        return rows;
      },
      { sections: DOCUMENTS_TAB_SECTIONS, labels: STATUS_LABEL, legacy: LEGACY_AWAITING_LABEL }
    );
  }

  // One row, refusing to guess between two. Uploaded files carry a server-appended
  // suffix and this account holds repeat uploads of the same fixture, so an ambiguous
  // term is an error and names every match - the third occurrence of this trap here.
  async findDocumentsTabRow(fileName) {
    const rows = await this.readDocumentsTabRows();
    const exact = rows.filter((r) => r.documentName === fileName);
    if (exact.length === 1) return exact[0];
    const partial = rows.filter((r) => r.documentName && r.documentName.includes(fileName));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new Error(
        '"' +
          fileName +
          '" matches ' +
          partial.length +
          ' rows on the Documents tab: ' +
          partial.map((r) => r.documentName).join(', ') +
          '. Pass the full stored file name, extension included - the server-appended ' +
          'suffix is the only thing that separates them.'
      );
    }
    return null;
  }

  // What clicking a document name on the Documents tab actually does. Returns a shape
  // rather than asserting, so the ABSENCE of any effect is reportable as the finding it
  // is. Measured 2026-09-01: nothing happens at all.
  async documentsTabRowActivation(fileName) {
    const button = this.page.locator('button').filter({ hasText: fileName }).first();
    if (!(await button.count())) {
      throw new Error('No clickable document name matching "' + fileName + '" on the Documents tab');
    }
    const before = this.page.url();
    let download = null;
    const onDownload = (d) => {
      download = d.suggestedFilename();
    };
    const requests = [];
    const onRequest = (r) => {
      // Notification polling runs on a timer and would otherwise read as an effect of
      // the click.
      if (/\/api\/v1\//.test(r.url()) && !/notifications/.test(r.url())) requests.push(r.url());
    };
    this.page.on('download', onDownload);
    this.page.on('request', onRequest);
    await button.scrollIntoViewIfNeeded();
    await button.click({ timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(6000);
    this.page.off('download', onDownload);
    this.page.off('request', onRequest);
    const dialogs = await this.page.locator('[role="dialog"]:visible').count();
    return {
      dialogOpened: dialogs > 0,
      downloadStarted: download,
      navigated: this.page.url() !== before,
      apiRequests: requests,
      didSomething: dialogs > 0 || !!download || this.page.url() !== before || requests.length > 0,
    };
  }

  // -------------------------------------------------------------------------
  // THE DASHBOARD BLOCK'S OWN PAGINATION
  // -------------------------------------------------------------------------

  // The block's documents request read off the wire, beside whatever paging controls the
  // page offers. Measured rather than remembered - see the header note.
  async dashboardPagingContract() {
    const seen = [];
    const onResponse = async (r) => {
      if (!/\/candidate\/documents\//.test(r.url())) return;
      let body = null;
      try {
        body = await r.json();
      } catch (e) {
        /* not JSON - recorded as null rather than thrown */
      }
      const u = new URL(r.url());
      seen.push({
        url: r.url().split('?')[0],
        pageSize: Number(u.searchParams.get('page_size')) || null,
        page: Number(u.searchParams.get('page')) || null,
        count: body && body.count != null ? body.count : null,
        returned: body && Array.isArray(body.results) ? body.results.length : null,
        hasNextPage: !!(body && body.next),
      });
    };
    this.page.on('response', onResponse);
    await this.openDashboard();
    await this.page.waitForTimeout(4000);
    this.page.off('response', onResponse);

    const controls = await this.page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.search(/Your Documents/i);
      const j = t.search(/Earned Certificates/i);
      const block = i >= 0 ? t.slice(i, j > i ? j : i + 2000) : '';
      const labels = [...document.querySelectorAll('button,a')]
        .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((x) => x && x.length < 40 && /view all|see all|show all|more|next|page |>>|→/i.test(x));
      return { blockText: block.slice(0, 1500), pagingControls: [...new Set(labels)] };
    });

    return {
      request: seen.find((x) => x.pageSize) || seen[0] || null,
      allRequests: seen,
      cardsRendered: (await this.readDocumentCards()).length,
      pagingControls: controls.pagingControls,
      blockText: controls.blockText,
    };
  }

  // Rewrite the page size on the block's OWN request so a capped-out document becomes
  // reachable. Returns a disposer, so a scenario can put the app back to its real
  // behaviour rather than leaving the widening armed for whatever runs next.
  async widenDashboardPaging(pageSize = 200) {
    const pattern = /\/candidate\/documents\/\?/;
    await this.page.route(pattern, async (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set('page', '1');
      u.searchParams.set('page_size', String(pageSize));
      await route.continue({ url: u.toString() });
    });
    this._widened = pageSize;
    return async () => {
      await this.page.unroute(pattern).catch(() => {});
      this._widened = null;
    };
  }

  get widenedPageSize() {
    return this._widened || null;
  }

  async closePanel() {
    const close = this.panel.getByRole('button', { name: /close/i }).first();
    if (await close.count()) await close.click().catch(() => {});
    else await this.page.keyboard.press('Escape');
    await this.panel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }
}

CandidateDocumentsPage.STATUS_LABEL = STATUS_LABEL;
CandidateDocumentsPage.LEGACY_AWAITING_LABEL = LEGACY_AWAITING_LABEL;
CandidateDocumentsPage.DOCUMENTS_TAB_SECTIONS = DOCUMENTS_TAB_SECTIONS;

module.exports = CandidateDocumentsPage;
