const BasePage = require('./BasePage');

// CommunityPage — the READ surface of the Community module (TFF-264 / TFF-334):
// the listing at /community and the University Community page at /community/view/<id>.
//
// ROLE-AGNOSTIC ON PURPOSE. The superadmin and the candidate are served the SAME two routes
// off the same endpoints; the only differences are the edit affordances, which is precisely
// what several scenarios assert must not leak. Two Page Objects would have to be kept in step
// with each other for that assertion to mean anything, so there is one.
//
// The create/edit FORM lives in CommunityFormPage — it is a different screen with a different
// contract, and only the superadmin can reach it.
//
// SELECTORS. This module ships NO data-testid attributes anywhere (verified live 2026-07-31),
// so every locator below leads with a data-testid candidate that does not exist yet — so the
// suite auto-upgrades the day the app team adds them — and then falls through ARIA -> semantic
// HTML -> structure. Nothing depends on a Tailwind class name: this app's classes are
// generated utility strings that churn on every build.
class CommunityPage extends BasePage {
  constructor(page) {
    super(page);
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    this.origin = origin;
    this.listUrl = `${origin}/community`;

    // ---- Listing ----
    this.pageHeading = page
      .locator('[data-testid="community-heading"]')
      .or(page.getByRole('heading', { name: /^community$/i }))
      .first();
    // Cards are <article> live. The `.or` chain keeps a DOM change from taking the whole file
    // down: whichever branch matches first wins, and every reader below counts through this.
    this.cards = page
      .locator('[data-testid="community-card"]')
      .or(page.locator('article'))
      .or(page.locator('a[href^="/community/view/"]').locator('xpath=ancestor::*[self::article or self::li or self::div][1]'));
    this.searchInput = page
      .locator('[data-testid="community-search"]')
      .or(page.getByRole('searchbox'))
      .or(page.locator('input[type="search"], input[placeholder*="Search by university" i]'))
      .first();
    this.createCta = page
      .locator('[data-testid="community-create-cta"]')
      .or(page.locator('a[href="/community/create"]'))
      .or(page.getByRole('link', { name: /create community/i }))
      .or(page.getByRole('button', { name: /create community/i }))
      .first();
    // AN ANCHORED NAME REGEX MATCHED NOTHING, AND IT CAPPED EVERY "ACROSS EVERY PAGE" READER AT
    // PAGE ONE. The control is `<button aria-label="Next Page">Next</button>`, so its ACCESSIBLE
    // NAME is "Next Page" — aria-label wins over text content — and `/^next$/i` is anchored, so it
    // never matched. Measured live 2026-08-03 (scripts/probe-community-pagination.js): the listing
    // holds 127 communities across 11 pages, `getByRole('button', {name: /^next$/i})` resolved to 0
    // while `/next/i` resolved to 1, and collectAllPages() returned 12 of the 127.
    //
    // This was silent because collectAllPages() gates on `count()` and simply BREAKS when the
    // locator finds nothing — so it walked one page and returned a confident total. Same class as
    // readCards() answering off the wrong page: a reader that is confident on insufficient data.
    // Anchoring removed and the aria-label added as its own candidate.
    this.nextPage = page
      .locator('[data-testid="pagination-next"]')
      .or(page.locator('button[aria-label*="next" i]'))
      .or(page.getByRole('button', { name: /next/i }))
      .first();
    this.prevPage = page
      .locator('[data-testid="pagination-prev"]')
      .or(page.locator('button[aria-label*="previous" i]'))
      .or(page.getByRole('button', { name: /previous/i }))
      .first();

    // ---- University Community page ----
    this.backLink = page.getByRole('button', { name: /^back$/i }).or(page.getByRole('link', { name: /^back$/i })).first();
    // "Edit community" is the header CTA on the detail page (lowercase 'c' live; matched
    // case-insensitively so a copy fix does not break it).
    this.editCommunityCta = page
      .locator('a[href^="/community/edit/"]')
      .or(page.getByRole('button', { name: /edit community/i }))
      .or(page.getByRole('link', { name: /edit community/i }))
      .first();
    this.memberSearchInput = page
      .locator('[data-testid="community-member-search"]')
      .or(page.locator('input[placeholder*="candidate name" i]'))
      .or(page.locator('input[type="search"]'))
      .first();

    // ---- Empty states ----
    // Structural, not by class: the smallest visible block holding a heading and a body line.
    this.emptyStateHeading = page.locator('h3, h2').filter({ hasText: /^no /i }).first();
  }

  // ==================== Navigation ====================

  async gotoList() {
    await super.navigate(this.listUrl);
    await this.waitForListing();
  }

  async waitForListing() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    // Either cards or an empty state — waiting only for cards hangs forever on a legitimate
    // empty result, and reports it as a timeout rather than as the empty state it is.
    await Promise.race([
      this.cards.first().waitFor({ state: 'visible', timeout: 45000 }),
      this.emptyStateHeading.waitFor({ state: 'visible', timeout: 45000 }),
    ]).catch(() => {});
    await this.settle();
  }

  async gotoCommunity(id) {
    await super.navigate(`${this.origin}/community/view/${id}`);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.settle();
  }

  // The app renders from a fetch that lands after domcontentloaded, so every reader waits on
  // the network settling rather than on a fixed sleep.
  async settle(ms = 900) {
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  isOnListing() {
    return /\/community(\?|$)/.test(this.page.url());
  }

  isOnCommunity(id) {
    return id ? this.page.url().includes(`/community/view/${id}`) : /\/community\/view\/\d+/.test(this.page.url());
  }

  currentCommunityId() {
    const m = this.page.url().match(/\/community\/view\/(\d+)/);
    return m ? m[1] : null;
  }

  // ==================== Listing readers ====================

  // One evaluate per read rather than a locator call per field: a 12-card page costs 60+ round
  // trips read field-by-field, and every one of them is a chance to catch the DOM mid-render.
  async readCards() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const hosts = Array.from(document.querySelectorAll('[data-testid="community-card"], article')).filter(vis);
      const roots = hosts.length
        ? hosts
        : Array.from(document.querySelectorAll('a[href^="/community/view/"]'))
            .map((a) => a.closest('article, li, div'))
            .filter(Boolean)
            .filter(vis);
      const seen = new Set();
      return roots
        .filter((r) => {
          const key = r.getAttribute('data-k') || clean(r.textContent);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((r) => {
          const view = r.querySelector('a[href^="/community/view/"]');
          const edit = r.querySelector('a[href^="/community/edit/"], [aria-label*="edit" i]');
          const heading = r.querySelector('h1,h2,h3,h4');
          const text = clean(r.innerText);
          const m = text.match(/(\d[\d,]*)\s*Members?/i);
          return {
            id: view ? view.getAttribute('href').split('/').pop() : null,
            name: heading ? clean(heading.textContent) : null,
            memberText: (text.match(/\d[\d,]*\s*Members?/i) || [])[0] || null,
            memberCount: m ? Number(m[1].replace(/,/g, '')) : null,
            hasImage: !!r.querySelector('img, [data-avatar], svg'),
            hasEdit: !!edit,
            hasViewCta: !!view && /view community/i.test(clean(view.textContent)),
            yourUniversity: /your university/i.test(text),
            text,
          };
        });
    });
  }

  // The listing's OWN total, taken off the API rather than by counting cards — the page shows
  // 12 at a time, so counting cards answers a different question than "how many exist".
  async readTotalCount() {
    const [resp] = await Promise.all([
      this.page
        .waitForResponse((r) => /\/api\/v1\/community\/\?/.test(r.url()) && r.status() === 200, { timeout: 30000 })
        .catch(() => null),
      this.page.reload({ waitUntil: 'domcontentloaded' }),
    ]);
    if (!resp) return null;
    const body = await resp.json().catch(() => null);
    return body ? body.count ?? body.total ?? null : null;
  }

  // THE WAIT IS REGISTERED BEFORE THE TYPING, AND THE RENDER IS WAITED FOR RATHER THAN SLEPT
  // THROUGH. Both halves were live defects, and together they made the FIRST search of a scenario
  // unreliable while every later one passed:
  //
  //  - `waitForResponse` attached AFTER `fill()` can miss the response entirely on a warm listing,
  //    and the miss is swallowed by `.catch()` — leaving only a fixed 700ms as the entire guarantee.
  //  - 700ms is long enough for the app to have CLEARED the list and not yet painted the results, so
  //    `readCards()` reads 0 cards. In the report that is indistinguishable from the search genuinely
  //    matching nothing, which is how "searching the exact name returned 0 cards" was recorded against
  //    a build where the upper-case, fragment and space-padded forms of that same name all matched.
  //    A search that is case-insensitive but somehow not exact-match is not a coherent app behaviour;
  //    it was always this race.
  async search(term) {
    const pending = this.page
      .waitForResponse((r) => /\/api\/v1\/community\/\?/.test(r.url()), { timeout: 15000 })
      .catch(() => null);
    await this.searchInput.fill(term);
    await pending;
    await this.settleListing();
  }

  async clearSearch() {
    const pending = this.page
      .waitForResponse((r) => /\/api\/v1\/community\/\?/.test(r.url()), { timeout: 15000 })
      .catch(() => null);
    await this.searchInput.fill('');
    await pending;
    await this.settleListing();
  }

  // The listing is only readable once the app has painted EITHER cards or its empty state. Waiting
  // on the race — the same one waitForListing() uses for the initial load — is what makes "0 cards"
  // mean "nothing matched" rather than "read too early". The trailing pause covers a re-render that
  // swaps one result set for another after the first card appears.
  async settleListing() {
    await this.settle(250);
    await Promise.race([
      this.cards.first().waitFor({ state: 'visible', timeout: 15000 }),
      this.emptyStateHeading.waitFor({ state: 'visible', timeout: 15000 }),
    ]).catch(() => {});
    await this.page.waitForTimeout(350);
  }

  async searchPlaceholder() {
    return this.searchInput.getAttribute('placeholder');
  }

  // Walk every page of the listing, collecting cards. Used by the "search covers every page"
  // and "count the members across every page" scenarios — both of which are meaningless if
  // they only ever see page one.
  // IT RECORDS WHY IT STOPPED, on `lastWalk`. The loop's exit conditions are not equivalent and
  // used to be indistinguishable: "the Next button is disabled, so that was the last page" is a
  // complete walk, while "the Next button could not be found" and "the `max` cap was hit" are both
  // TRUNCATED walks that still return a confident-looking array. A broken Next locator therefore
  // capped every caller at page one for as long as it went unnoticed (12 of 127 communities), and
  // callers reported totals off it. `lastWalk.complete` is what a step should attach or assert on
  // when its question is "across EVERY page".
  // COMPLETENESS IS CROSS-CHECKED AGAINST THE PAGER'S OWN PAGE NUMBERS, not inferred from why the
  // loop stopped. The first version of this got it wrong in the most embarrassing possible way:
  // `complete` was "did not hit the max cap", so the exit condition "no next-page control was
  // found" — the EXACT string the broken locator produced — counted as a complete walk. The
  // assertion would have passed on the very bug it was written to catch.
  //
  // "No next control" is genuinely ambiguous: on a 6-member community there is no pager at all and
  // one page is the whole truth, while on the 127-community listing it meant the locator missed.
  // What separates them is observable and has nothing to do with the Next button — the pager renders
  // numbered page buttons (`aria-label="Page 11"`), so if it offers more pages than were walked, the
  // walk was truncated whatever the reason.
  async collectAllPages(readFn, max = 30) {
    const all = [];
    let pages = 0;
    let stoppedBecause = `hit the ${max}-page cap`;
    for (let i = 0; i < max; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      all.push(...(await readFn()));
      pages += 1;
      // eslint-disable-next-line no-await-in-loop
      const found = await this.nextPage.count();
      if (!found) {
        stoppedBecause = 'no next-page control was found';
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      if (await this.nextPage.isDisabled().catch(() => true)) {
        stoppedBecause = 'the next-page control is disabled (last page)';
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await this.nextPage.click();
      // settle(), not settleListing(): this walks the MEMBER list as well as the community listing,
      // and settleListing()'s cards-or-empty-state race is scoped to the listing's own locators —
      // on a member page neither may resolve, costing its 15s timeout on every page turn.
      // eslint-disable-next-line no-await-in-loop
      await this.settle(1200);
    }
    const offered = await this.highestPageOffered();
    const shortOfPager = offered > pages;
    this.lastWalk = {
      pages,
      items: all.length,
      pagesOffered: offered,
      stoppedBecause: shortOfPager
        ? `${stoppedBecause}, but the pager offers ${offered} page(s)`
        : stoppedBecause,
      complete: stoppedBecause !== `hit the ${max}-page cap` && !shortOfPager,
    };
    return all;
  }

  // The highest page number the pager offers, or 0 when there is no pager. Read off the numbered
  // buttons (`aria-label="Page N"`, with the visible digits as a fallback) because they are
  // INDEPENDENT of the Next control — which is the whole point: a reader used to validate the Next
  // button must not itself depend on it. A truncated pager that elides middle pages ("1 2 3 4 5 … 11")
  // still renders the last one, which is the number that matters here.
  async highestPageOffered() {
    return this.page.evaluate(() => {
      const nums = Array.from(document.querySelectorAll('button, a, [role="button"], [role="listitem"]'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/^\s*page\s+(\d{1,4})\s*$/i);
          if (m) return Number(m[1]);
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return /^\d{1,4}$/.test(t) ? Number(t) : 0;
        })
        .filter((n) => n > 0);
      return nums.length ? Math.max(...nums) : 0;
    }).catch(() => 0);
  }

  // One line describing the last walk, for a step's attachment or failure message. A count taken
  // "across every page" is only meaningful alongside how many pages were actually visited.
  walkSummary() {
    const w = this.lastWalk;
    if (!w) return 'no page walk recorded';
    return `${w.items} item(s) across ${w.pages} page(s)`
      + (w.pagesOffered ? ` of ${w.pagesOffered} offered` : ' (no pager on screen)')
      + ` — stopped because ${w.stoppedBecause}`;
  }

  // ==================== Community page readers ====================

  async readHeader() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      // The header is everything above the first candidate card / the filter row.
      const anchor =
        document.querySelector('input[type="search"]') ||
        Array.from(document.querySelectorAll('button')).find((b) => /grad year/i.test(b.textContent || ''));
      const body = document.body.innerText;
      const heading = Array.from(document.querySelectorAll('h1,h2'))
        .filter(vis)
        .map((h) => clean(h.textContent))
        .filter((t) => t && !/^community$/i.test(t));
      const memberText = (body.match(/\d[\d,]*\s*Members?/i) || [])[0] || null;
      // Everything between the name and the member count is the description + location block.
      const lines = body
        .split('\n')
        .map(clean)
        .filter(Boolean);
      const nameIdx = lines.findIndex((l) => l === heading[0]);
      const countIdx = lines.findIndex((l) => /^\d[\d,]*\s*Members?$/i.test(l));
      return {
        name: heading[0] || null,
        memberText,
        memberCount: memberText ? Number(memberText.replace(/[^\d]/g, '')) : null,
        // The line after the count is the location; the lines between name and count are the
        // description. Positional because neither carries a label or a testid.
        description: nameIdx >= 0 && countIdx > nameIdx ? lines.slice(nameIdx + 1, countIdx).join(' ') : null,
        location: countIdx >= 0 ? lines[countIdx + 1] || null : null,
        images: Array.from(document.querySelectorAll('img')).filter(vis).length,
        hasEditCta: /edit community/i.test(body) || !!document.querySelector('a[href^="/community/edit/"]'),
        anchorFound: !!anchor,
      };
    });
  }

  async readMemberCards() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const LABELS = ['Course Completed', 'Certificate', 'Co-op Program', 'Tamheer Program'];
      // Derived STRUCTURALLY — the smallest visible block that carries a View Profile CTA and
      // all three widget captions. Class names on this app are generated and churn per build.
      const roots = Array.from(document.querySelectorAll('div,article,li,section'))
        .filter(vis)
        .filter((e) => {
          const t = e.innerText || '';
          return /view profile/i.test(t) && /track progress/i.test(t) && /hours learned/i.test(t) && t.length < 700;
        })
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      const seen = new Set();
      const uniq = [];
      for (const r of roots) {
        const key = clean(r.innerText);
        if (!seen.has(key)) {
          seen.add(key);
          uniq.push(r);
        }
      }
      const LEAF_NOISE = /^(track:?|view profile|track progress|courses completed|hours learned)$/i;
      return uniq.map((r) => {
        const text = clean(r.innerText);
        const heading = r.querySelector('h1,h2,h3,h4');
        const trackMatch = text.match(/Track:\s*([^\n]*?)(?:\s+View Profile|$)/i);
        const progress = text.match(/(\d+(?:\.\d+)?)\s*%/);
        // Major and graduation year are UNLABELLED spans, so they are identified by elimination
        // from the leaves of THIS card, walking forward from the name. Reading them here rather
        // than in a second method is the point: readMemberDetails() used to scan every h1-h4 in
        // the DOCUMENT, which is unscoped — it picked up page chrome and reported the sidebar's
        // "Activity log" as a community member (live 2026-08-02). Anything read inside this
        // block is inside a card by construction.
        const trackText = trackMatch ? clean(trackMatch[1]) : null;
        const leaves = Array.from(r.querySelectorAll('*'))
          .filter((n) => n.children.length === 0 && vis(n) && clean(n.textContent))
          .map((n) => clean(n.textContent));
        const headingText = heading ? clean(heading.textContent) : null;
        // Start after the name: the avatar's initials ("GS") precede it and would otherwise be
        // taken for the major.
        const idx = headingText ? leaves.indexOf(headingText) : -1;
        const after = leaves.slice(idx >= 0 ? idx + 1 : 0);
        const major = after.find((s) => (
          s.length > 1
          && !/^\d{4}$/.test(s)                       // graduation year
          && !/^\d+(?:\.\d+)?%?$/.test(s)             // widget figures
          && !LEAF_NOISE.test(s)
          && !(s.length <= 3 && s === s.toUpperCase())  // avatar initials, if the name is not a leaf
          && !(trackText && s.toLowerCase() === trackText.toLowerCase())
          && !LABELS.some((l) => l.toLowerCase() === s.toLowerCase())
        )) || null;
        const gradYear = after.find((s) => /^\d{4}$/.test(s)) || null;
        // "Courses Completed" / "Hours Learned" are CAPTIONS that follow their value in the
        // rendered text, so each figure is read as the token immediately BEFORE its caption.
        const before = (caption) => {
          const m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${caption}`, 'i'));
          return m ? Number(m[1]) : null;
        };
        return {
          name: headingText,
          major,
          gradYear,
          leaves,
          hasAvatar: !!r.querySelector('img, [data-avatar]'),
          track: trackText,
          trackProgress: progress ? Number(progress[1]) : null,
          coursesCompleted: before('Courses Completed'),
          hoursLearned: before('Hours Learned'),
          successLabels: LABELS.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(text)),
          hasViewProfile: /view profile/i.test(text),
          text,
        };
      });
    });
  }

  // Major and graduation year per member. DELEGATES to readMemberCards() rather than querying
  // the DOM again — the two used to be independent passes and they disagreed, which is the
  // failure mode this file keeps guarding against elsewhere.
  //
  // The old implementation scanned `document.querySelectorAll('h1,h2,h3,h4')` with NO card
  // scope at all, taking each heading's sibling spans as that "member's" details. On the
  // community page that also matches page chrome, and it reported the sidebar's "Activity log"
  // as a member (live 2026-08-02) — which then made the Major-search scenario fail with a
  // message naming a heading nobody could find in the member list.
  async readMemberDetails() {
    const cards = await this.readMemberCards();
    return cards
      .map((c) => ({
        name: c.name,
        major: c.major,
        gradYear: c.gradYear,
        track: c.track,
        spans: c.leaves,
      }))
      .filter((x) => x.name && x.spans.length);
  }

  async searchMembers(term) {
    await this.memberSearchInput.fill(term);
    await this.page
      .waitForResponse((r) => /\/candidates\/\?/.test(r.url()), { timeout: 15000 })
      .catch(() => {});
    await this.settle(700);
  }

  async clearMemberSearch() {
    await this.memberSearchInput.fill('');
    await this.settle(1200);
  }

  async memberSearchPlaceholder() {
    return this.memberSearchInput.getAttribute('placeholder');
  }

  // ==================== Filters ====================

  // The three triggers are NOT built alike, and this is the whole reason for the mapping below.
  // "Grad Years" and "Members" are <button>s whose popover is checkbox <label> rows.
  // "Majors" is a <div aria-expanded> whose popover holds its own search box, renders its
  // options as <button>s, and carries its own inline Clear All. A single getByRole('button')
  // lookup finds two of the three and times out on the other, which is exactly what happened
  // twice during discovery.
  filterTrigger(name) {
    const label = CommunityPage.filterLabel(name);
    return this.page
      .locator(`[data-testid="community-filter-${label.toLowerCase().replace(/\s+/g, '-')}"]`)
      .or(this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }))
      .or(this.page.locator('[aria-expanded]').filter({ hasText: new RegExp(`^${label}$`, 'i') }))
      .or(this.page.getByText(new RegExp(`^${label}$`, 'i')))
      .first();
  }

  // Accepts either story's naming for the same control. TFF-264 says "Graduation Year" /
  // "Member Type"; TFF-334 and the build say "Grad Year(s)" / "Members". Mapping here rather
  // than in the steps means neither feature file has to know what the build calls it.
  static filterLabel(name) {
    const n = String(name).trim().toLowerCase();
    if (/^grad/.test(n)) return 'Grad Years';
    if (/^major/.test(n)) return 'Majors';
    if (/^member/.test(n)) return 'Members';
    return name;
  }

  async closeAnyPopover() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.mouse.click(5, 5).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async openFilter(name) {
    await this.closeAnyPopover();
    await this.filterTrigger(name).click({ timeout: 20000 });
    await this.page.waitForTimeout(1200);
  }

  // THE ONE resolver for an open filter popover. readOpenFilterOptions() and
  // selectFilterOption() both go through it, so the index a step reads off `options` is the
  // index selectFilterOption() acts on.
  //
  // They used to be two separate queries and it cost four scenarios (§10.2, §10.3, §10.4,
  // §10.5), every one of them reported as an app defect. readOpenFilterOptions() returned
  // deduped VISIBLE label texts; selectFilterOption() indexed
  // `[role="dialog"] label, [role="listbox"] label, [role="dialog"] button, [role="option"]`
  // with .nth(). Two independent faults fell out of that, both measured live 2026-08-02:
  //   * A comma-separated union resolves in DOM ORDER, not in the order the selectors are
  //     written — so .nth(0) landed on react-aria's zero-content <button aria-label="Dismiss">,
  //     which is the first <button> inside [role="dialog"]. It IS visible (so Playwright kept
  //     retrying) but it sits underneath the option list, so every click was intercepted by a
  //     <label> and timed out after 15s: "subtree intercepts pointer events".
  //   * Even had it hit an option, `selectFilterOption(options.length - 1)` was indexing a
  //     different list from the one that length was computed against, so it could silently
  //     select the wrong option.
  // This is the same trap as the promo save-toast locator — see the CLAUDE.md note. Deriving
  // the click target from the same pass that produces the text list is what makes the two
  // incapable of drifting again.
  //
  // When `tagIndex` is a number the chosen option is stamped with `data-qa-filter-option` and
  // clicked through Playwright afterwards, so the click still waits for actionability rather
  // than dispatching a synthetic event.
  async resolveFilterPopover(tagIndex = null) {
    return this.page.evaluate(({ wanted, TAG }) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      document.querySelectorAll(`[${TAG}]`).forEach((el) => el.removeAttribute(TAG));

      const pops = Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"]')).filter(vis);
      const pop = pops.sort((a, b) => clean(b.textContent).length - clean(a.textContent).length)[0];
      if (!pop) return { shape: 'none', options: [], multiSelect: false, tagged: null, count: 0 };

      // Labels win outright where present. A checkbox list renders BOTH a <label> per option
      // AND unrelated <button>s (Dismiss, Clear All); mixing the two is what put Dismiss first.
      const labels = Array.from(pop.querySelectorAll('label')).filter(vis).filter((l) => clean(l.textContent));
      const buttons = Array.from(pop.querySelectorAll('button'))
        .filter(vis)
        .filter((b) => clean(b.textContent))
        .filter((b) => !/^clear all$/i.test(clean(b.textContent)))
        .filter((b) => !/dismiss|close/i.test(b.getAttribute('aria-label') || ''));
      const candidates = labels.length ? labels : buttons;

      // Dedupe by text keeping the first element of each — `options` is deduped, so the element
      // list has to be deduped identically or the indices diverge all over again.
      const seen = new Set();
      const uniq = [];
      for (const el of candidates) {
        const t = clean(el.textContent);
        if (seen.has(t)) continue;
        seen.add(t);
        uniq.push(el);
      }

      let tagged = null;
      if (wanted != null && uniq[wanted]) {
        uniq[wanted].setAttribute(TAG, '1');
        tagged = clean(uniq[wanted].textContent);
      }

      return {
        shape: labels.length ? 'checkbox-labels' : 'buttons',
        options: uniq.map((el) => clean(el.textContent)),
        multiSelect: pop.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length > 0 || labels.length > 0,
        checkboxes: pop.querySelectorAll('input[type="checkbox"]').length,
        hasOwnSearch: !!pop.querySelector('input[type="text"],input:not([type])'),
        ctas: Array.from(pop.querySelectorAll('button')).filter(vis).map((b) => clean(b.textContent)).filter(Boolean),
        tagged,
        count: uniq.length,
      };
    }, { wanted: tagIndex, TAG: CommunityPage.FILTER_OPTION_TAG });
  }

  // Reads whichever shape the open popover happens to use, and reports which one it found so a
  // failure names the control rather than just "0 options".
  async readOpenFilterOptions() {
    return this.resolveFilterPopover(null);
  }

  // Selecting inside a popover applies IMMEDIATELY (there is no Apply button — see AC 7.4 and
  // the §10.4 scenario), so this waits for the resulting request rather than for a click.
  async selectFilterOption(index = 0) {
    const resolved = await this.resolveFilterPopover(index);
    if (resolved.shape === 'none') {
      throw new Error('no filter popover is open, so no option could be selected');
    }
    // Say which option was asked for and what was actually on offer. "Timeout exceeded" told
    // whoever read the report nothing about why.
    if (resolved.tagged == null) {
      throw new Error(
        `the open filter offers ${resolved.count} option(s), so index ${index} cannot be selected. `
        + `On offer: ${JSON.stringify(resolved.options)}`
      );
    }
    const option = this.page.locator(`[${CommunityPage.FILTER_OPTION_TAG}]`).first();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => /\/candidates\/\?/.test(r.url()), { timeout: 20000 }).catch(() => null),
      option.click({ timeout: 15000 }),
    ]);
    await this.settle(700);
    return { text: resolved.tagged, status: resp ? resp.status() : null, url: resp ? resp.url() : null };
  }

  // ==================== The filter popover's own search box ====================

  // Only the Majors popover has one (measured live 2026-08-03: a text input with the placeholder
  // "Majors", beside options rendered as <button>s and its own inline "Clear All"). It exists
  // because THE LIST IS CAPPED AT TEN: the popover offers the first ten Field of Study values
  // alphabetically — "AI prompter" through "Architecture" — and does not grow on scroll, so
  // searching is the ONLY way to reach any of the rest. Every scenario that reads
  // `readOpenFilterOptions()` on Majors is therefore reading ten of many, which is worth knowing
  // when interpreting one.
  filterPopoverSearch() {
    return this.page
      .locator('[role="dialog"] input[type="text"], [role="listbox"] input[type="text"]')
      .or(this.page.locator('[role="dialog"] input:not([type]), [role="listbox"] input:not([type])'))
      .first();
  }

  // Type into the open popover's search box and report what it then offers.
  //
  // Returns the term alongside the options so an assertion can compare the two without having to
  // remember what it asked for — and so a failure message can quote both. `settle` is short: this
  // filters client-side (no request is issued), which is itself worth recording.
  async searchInOpenFilter(term) {
    const box = this.filterPopoverSearch();
    if (!(await box.count())) {
      throw new Error('the open filter popover has no search box of its own');
    }
    let requestSeen = false;
    const watch = (req) => { if (/\/candidates\/\?/.test(req.url())) requestSeen = true; };
    this.page.on('request', watch);
    await box.fill(term);
    await this.page.waitForTimeout(1400);
    this.page.off('request', watch);
    const read = await this.resolveFilterPopover(null);
    return {
      term,
      options: read.options,
      count: read.options.length,
      emptyState: await this.readFilterPopoverEmptyState(),
      issuedRequest: requestSeen,
    };
  }

  async clearOpenFilterSearch() {
    const box = this.filterPopoverSearch();
    if (await box.count()) {
      await box.fill('');
      await this.page.waitForTimeout(1200);
    }
  }

  // What the POPOVER says when its own search matches nothing. Scoped to the popover for the same
  // reason readEmptyState() excludes it: the page and the popover each render a "No results found"
  // and reading one for the other reports the wrong surface.
  async readFilterPopoverEmptyState() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const pop = Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"]'))
        .filter(vis)
        .sort((a, b) => clean(b.textContent).length - clean(a.textContent).length)[0];
      if (!pop) return { present: false, message: null };
      const message = Array.from(pop.querySelectorAll('*'))
        .filter((e) => e.children.length === 0 && vis(e))
        .map((e) => clean(e.textContent))
        .find((t) => /^no\b/i.test(t) && t.length < 80);
      return { present: !!message, message: message || null, popoverText: clean(pop.innerText).slice(0, 200) };
    });
  }

  // Select the option whose text is exactly `text`, by finding its INDEX in the same pass
  // selectFilterOption() will act on. Deliberately not a locator of its own: a second query is how
  // the two filter readers drifted apart before (see resolveFilterPopover's note), and a
  // `filter({hasText})` here would be a substring match — "Law" would select "Business Law".
  async selectFilterOptionByText(text) {
    const read = await this.resolveFilterPopover(null);
    const want = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    const index = read.options.findIndex((o) => o.replace(/\s+/g, ' ').trim().toLowerCase() === want);
    if (index < 0) {
      throw new Error(`the open filter does not offer "${text}". On offer: ${JSON.stringify(read.options)}`);
    }
    return this.selectFilterOption(index);
  }

  clearAllControl() {
    return this.page
      .getByRole('button', { name: /^clear all$/i })
      .or(this.page.getByText(/^clear all$/i))
      .first();
  }

  clearAllFiltersCta() {
    return this.page
      .getByRole('button', { name: /clear all filters/i })
      .or(this.page.getByText(/clear all filters/i))
      .first();
  }

  async cursorOf(locator) {
    return locator.evaluate((el) => getComputedStyle(el).cursor).catch(() => null);
  }

  // Whether ANY filter is currently applied. Read from the controls the app itself renders
  // when one is — there is no URL state to read (which is the AC 6.3 defect), so this is the
  // only observable answer.
  // IT USED TO BE INCAPABLE OF RETURNING FALSE. The old version treated every visible
  // [aria-expanded] element whose text was not one of three bare labels as a selection chip.
  // The page shell also carries aria-expanded on its account and region menus, and the region
  // one renders "SA" — so on a completely fresh community page, with nothing applied and no
  // Clear All on screen, it still answered `true`. Measured live 2026-08-02
  // (scripts/probe-community-filter-applied.js): true when fresh, true with one filter, true
  // again after Clear All. Every scenario asserting `no filter should be applied` was
  // unpassable, and each of them read as an app defect.
  //
  // The app is in fact plainly observable: the trigger renders its bare label ("Members") and
  // gains a count when a selection is made ("Members1"), and Clear All appears only while
  // something is applied. So the reader is scoped to THE FILTER TRIGGERS, identified by their
  // own labels, and a selection is a trigger whose text has grown past its bare label.
  async filterState() {
    return this.page.evaluate((labels) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const clearAll = Array.from(document.querySelectorAll('button,a'))
        .filter(vis)
        .filter((b) => /^clear all$/i.test(clean(b.textContent)))
        .length;
      const triggers = Array.from(document.querySelectorAll('[aria-expanded],button'))
        .filter(vis)
        .map((e) => clean(e.textContent))
        .filter((t) => labels.some((l) => new RegExp(`^${l}`, 'i').test(t)));
      const withSelection = Array.from(new Set(
        triggers.filter((t) => !labels.some((l) => new RegExp(`^${l}$`, 'i').test(t)))
      ));
      return { clearAll, triggers: Array.from(new Set(triggers)), withSelection };
    }, CommunityPage.FILTER_TRIGGER_LABELS);
  }

  async anyFilterApplied() {
    const s = await this.filterState();
    return s.clearAll > 0 || s.withSelection.length > 0;
  }

  // ==================== Empty states ====================

  // THE APP RENDERS FOUR DIFFERENT EMPTY STATES AND NAMES WHICHEVER FILTER IS ACTUALLY ACTIVE.
  // Measured live 2026-08-03 (scripts/probe-community-empty-states.js,
  // scripts/probe-community-majors-search.js):
  //
  //   /community, search matches nothing        h? "No communities found"      no body, no CTA
  //   member SEARCH only                        h3 "No results found"          "…your current search."
  //   member FILTER only                        h3 "No results found"          "…your current filters."      + "Clear all filters"
  //   member search AND filter                  h3 "No results found"          "…your current search and filters." + "Clear all filters"
  //   Majors popover, search matches nothing        "No results found."        (inside the popover)
  //
  // So a single expected wording cannot be right for all of them, and the CTA is present only
  // when a FILTER is applied — the two scenarios that asserted a "Clear all filters" CTA on a
  // search-only state were asserting something the app deliberately does not do.
  //
  // The popover is EXCLUDED here on purpose: `readEmptyState()` answers "what does the page say
  // about the list", and while a Majors search matches nothing the popover also holds a
  // "No results found." that would win the smallest-block contest and be reported as the list's
  // own empty state. `readFilterPopoverEmptyState()` is the reader for that one.
  async readEmptyState() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const inPopover = (el) => !!el.closest('[role="dialog"],[role="listbox"]');
      const host = Array.from(document.querySelectorAll('section,div'))
        .filter(vis)
        .filter((e) => !inPopover(e))
        .filter((e) => /^no\b/i.test(clean(e.innerText)) && clean(e.innerText).length < 400)
        .sort((a, b) => clean(a.innerText).length - clean(b.innerText).length)[0];
      if (!host) return { present: false };
      const heading = host.querySelector('h1,h2,h3,h4') || (/^h[1-4]$/i.test(host.tagName) ? host : null);
      const body = host.querySelector('p');

      // SPACING IS MEASURED GEOMETRICALLY, not from the host's own padding + margin.
      //
      // That is what the old reader did, and it cannot answer the question TFF-337 asks. The very
      // same visual state measured `padTop: 64px` when the winning host was the <section> wrapping
      // the search-empty message and `marginTop: -40px` when it was the <div> wrapping the
      // filter-empty one — so `spacingAbove > 0` passed or failed depending on which block won a
      // sort, not on whether there is whitespace around the message. Both were measured live on
      // 2026-08-03.
      //
      // The gap to the nearest thing above and below is what a reader actually sees, and it
      // survives any refactor between padding, margin and flex gap.
      const r = host.getBoundingClientRect();
      const others = Array.from(document.querySelectorAll('body *'))
        .filter(vis)
        .filter((e) => e !== host && !host.contains(e) && !e.contains(host))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        // Only elements that overlap the message horizontally can be "above" or "below" it.
        .filter(({ r: o }) => o.right > r.left && o.left < r.right);
      const above = others.filter(({ r: o }) => o.bottom <= r.top + 1).map(({ r: o }) => o.bottom);
      const below = others.filter(({ r: o }) => o.top >= r.bottom - 1).map(({ r: o }) => o.top);

      return {
        present: true,
        hostTag: host.tagName,
        heading: heading ? clean(heading.textContent) : null,
        body: body ? clean(body.textContent) : null,
        fullText: clean(host.innerText),
        spacingAbove: above.length ? Math.round(r.top - Math.max(...above)) : Math.round(r.top),
        spacingBelow: below.length ? Math.round(Math.min(...below) - r.bottom) : null,
        // Every "clear" control on the page, popover ones excluded — the Majors popover carries
        // its own "Clear All" and counting it would report a CTA the empty state does not offer.
        clearCtas: Array.from(document.querySelectorAll('button,a'))
          .filter(vis)
          .filter((b) => !inPopover(b))
          .map((b) => clean(b.textContent))
          .filter((t) => /clear/i.test(t)),
      };
    });
  }

  // ==================== Misc ====================

  async toastText() {
    // NOT a `[class*="toast" i]` union: that also matches react-toastify's zero-height
    // <section class="Toastify"> wrapper, and `.first()` resolves in DOM order rather than in
    // the order the selectors are written — so the wrapper always wins and the real toast is
    // reported as absent. Same trap as the promo save-toast reader.
    const toast = this.page
      .locator('.Toastify__toast-body, .Toastify__toast, [role="alert"], [role="status"]')
      .filter({ hasNotText: /^$/ })
      .first();
    if (!(await toast.count())) return null;
    const text = await toast.textContent({ timeout: 5000 }).catch(() => null);
    return text ? text.replace(/\s+/g, ' ').trim() : null;
  }

  async bodyText() {
    return this.page.evaluate(() => document.body.innerText);
  }
}

// Stamped on the filter option resolveFilterPopover() picked, so the click can go through
// Playwright (and its actionability wait) instead of being dispatched in the page.
CommunityPage.FILTER_OPTION_TAG = 'data-qa-filter-option';

// The labels the filter triggers actually RENDER, on both portals — the feature files name them
// differently per story ("Graduation Year"/"Member Type" for the superadmin, "Grad Year"/
// "Members" for the candidate) and filterLabel() maps those onto these. Kept beside the reader
// that scopes to them so the two cannot drift.
CommunityPage.FILTER_TRIGGER_LABELS = ['Grad Years', 'Majors', 'Members'];

module.exports = CommunityPage;
