// probe-candidate-view-profile.js
//
// The AGENT PORTAL's candidate profile at /candidates/<id>/view-profile, mapped end to end:
// which listings offer a route into it, the header and its four widgets, the five tabs and what
// each one queries, all six Candidate Details sections beside the payload field that produced
// them, the Document Verification rows, the Subscription fields, the Activity Log and its
// duration filter, the Reminder History dialog, and an accessibility audit of the chrome.
//
// >>> READ-ONLY. It opens dialogs and closes them, and clicks nothing that writes. <<< The
// profile screen has no form, no Save, no decision control and nothing that sends a reminder, so
// there is nothing here to spend. It makes no payment, reads no inbox and creates no candidate.
//
// This is the script behind every measurement in CLAUDE.md's "Agent Portal - candidate View
// Profile" section and in the header of pages/CandidateViewProfilePage.js. RE-RUN IT rather than
// reasoning about the DOM - that is the whole point of it existing.
//
//   node scripts/probe-candidate-view-profile.js
//   node scripts/probe-candidate-view-profile.js --candidate 10880
//   node scripts/probe-candidate-view-profile.js --listing deactivated
//   node scripts/probe-candidate-view-profile.js --no-audit      (skip the 60-press Tab walk)
//   node scripts/probe-candidate-view-profile.js --no-viewer     (skip opening each document)
//   node scripts/probe-candidate-view-profile.js --zoom          (also exercise the zoom)
//
// It drives the REAL page object (pages/CandidateViewProfilePage.js) for everything it can,
// deliberately: a probe carrying its own copy of the readers can agree with itself while
// disagreeing with the suite, which is how one module's under-counting reader went unnoticed for
// weeks. Where it reads something the page object does not expose, it says so.

require('dotenv').config();
const { chromium } = require('playwright');
const CandidateViewProfilePage = require('../pages/CandidateViewProfilePage');
const LoginPage = require('../pages/LoginPage');

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const AGENT_EMAIL = process.env.AGENT_EMAIL;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD;

const h1 = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const h2 = (t) => console.log(`\n--- ${t} ---`);
const show = (label, value) =>
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

(async () => {
  if (!AGENT_EMAIL || !AGENT_PASSWORD) {
    console.error('Missing AGENT_EMAIL / AGENT_PASSWORD in .env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  // 1440x900: the profile is a tall page and the app switches to a narrow layout well below
  // this. Layout-dependent behaviour must be reproduced at a width a real run actually gets.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const profile = new CandidateViewProfilePage(page);
  profile.install();

  try {
    h1(`Agent Portal candidate View Profile - probed ${new Date().toISOString()}`);
    show('agent', AGENT_EMAIL);

    const login = new LoginPage(page);
    await login.navigate();
    await login.emailInput.first().fill(AGENT_EMAIL);
    await login.passwordInput.first().fill(AGENT_PASSWORD);
    await login.submitButton.first().click();
    await page.waitForURL(/\/dashboard|\/candidates|\/getting-started/, {
      timeout: 60000,
      waitUntil: 'commit',
    });

    // ---------------------------------------------------------------- 1. entry points
    h1('1. WHICH LISTINGS OFFER A ROUTE INTO THE PROFILE');
    console.log(
      'A listing without a View control has NO route to the profile at all. In Progress is the\n'
        + 'one that does not, which is why it is excluded from the feature file\'s listing tables.'
    );
    for (const name of ['active', 'in progress', 'deactivated', 'requires attention']) {
      /* eslint-disable no-await-in-loop */
      await profile.openListing(name);
      const actions = await profile.listingRowActions(0);
      const hasView = await profile.listingHasViewControl();
      h2(name);
      show('url', page.url());
      show('heading', (await page.getByRole('heading', { level: 1 }).innerText()).trim());
      show('offers a View control', hasView);
      show('row 0 actions', actions);
      /* eslint-enable no-await-in-loop */
    }

    // ---------------------------------------------------------------- 2. open one
    const listing = arg('listing', 'active');
    const candidate = arg('candidate');
    h1(`2. THE PROFILE (opened from "${listing}")`);

    let opened;
    if (candidate) {
      await profile.gotoProfile(candidate);
      opened = { listing: 'direct', candidateId: Number(candidate), url: page.url() };
    } else {
      opened = await profile.openProfile({ listing });
    }
    show('opened', opened);

    console.log(
      '\nNOTE the ROUTE differs by a TRAILING SLASH between listings: Requires Attention uses\n'
        + '/view-profile/?selectedTab=..., Active and Deactivated use /view-profile?selectedTab=...\n'
        + 'Both are live, so a URL assertion must tolerate both.'
    );

    const payload = profile.profilePayload();
    h2('the payload the whole screen is built from');
    show('endpoint', `GET /core/api/v1/candidate/profile/${opened.candidateId}/`);
    show('top-level keys', payload ? Object.keys(payload) : null);
    console.log(
      '\n>>> THERE IS NO email AND NO phone FIELD IN IT. <<< So Basic Information can never\n'
        + 'populate those two, while the listing one click behind displays the email.'
    );

    h2('data-testid count on the whole profile page');
    show('count', await page.locator('main [data-testid]').count());
    console.log(
      'ZERO. Every locator on this screen is a role+name or one of the app\'s own class hooks\n'
        + "(.profile-basic-details, .top-right-buttons-container, .education-section, ...).\n"
        + 'And NEVER a react-aria element id - they are regenerated on every render.'
    );

    // ---------------------------------------------------------------- 3. header
    h1('3. HEADER AND WIDGETS');
    const header = await profile.readHeader();
    show('header', {
      ...header,
      avatarImageSrc: CandidateViewProfilePage.redact(header.avatarImageSrc || ''),
    });
    show('header controls', await profile.readHeaderActions());
    console.log(
      '\n[0] is an icon-only button carrying a link/chain svg with NO accessible name, and it is\n'
        + 'INERT - see section 9. [1] is Reminder History, enabled iff has_reminders.'
    );

    h2('the four widgets, beside the statistic behind each');
    show('rendered', await profile.readWidgets());
    show('payload stats', payload ? payload.stats : null);
    console.log(
      `\nstats === null renders "${CandidateViewProfilePage.UNCOMPUTED_STAT}" (EM DASH) and`
        + ` "${CandidateViewProfilePage.UNCOMPUTED_STAT}%" for Track Progress.\n`
        + `An unset profile FIELD renders "${CandidateViewProfilePage.UNSET_FIELD}" (ASCII hyphen)`
        + ' - two different characters meaning two different things.'
    );

    // ---------------------------------------------------------------- 4. tabs
    h1('4. THE FIVE TABS, AND WHAT EACH ONE QUERIES');
    show('tab labels', await profile.tabLabels());
    show('selected on open', await profile.selectedTabLabel());
    console.log(
      '\nThey are role="radio" in a role="radiogroup", NOT role="tab" - a getByRole("tab")\n'
        + 'reader finds nothing. One tab stop for all five, arrows moving within: correct.\n'
    );
    for (const t of CandidateViewProfilePage.TABS) {
      /* eslint-disable no-await-in-loop */
      const r = await profile.selectTab(t.label);
      console.log(
        `${t.label.padEnd(23)} slug=${String(r.slug).padEnd(23)} requests=${
          r.requests.length ? r.requests.join(', ') : '(none)'
        }`
      );
      /* eslint-enable no-await-in-loop */
    }
    console.log(
      '\nCandidate Details and Document Verification fire NOTHING - they re-render the payload\n'
        + 'fetched when the profile opened. That absence is why the page object keeps a running\n'
        + 'request log: a waitForResponse there cannot tell "nothing was sent" from a miss.\n'
        + 'Track Progress answers 404 when the candidate has no track, which is NORMAL.'
    );

    // ---------------------------------------------------------------- 5. candidate details
    h1('5. CANDIDATE DETAILS - every section beside the payload that produced it');
    await profile.selectTab('Candidate Details');
    show('sections rendered', await profile.sectionHeadings());

    for (const name of CandidateViewProfilePage.SECTIONS) {
      /* eslint-disable no-await-in-loop */
      const s = await profile.readSection(name);
      h2(name);
      show('rendered', s.found ? s.lines : '(section not found)');
      if (s.isEmptyState) console.log('>>> SHOWING ITS EMPTY STATE <<<');
      if (CandidateViewProfilePage.FIELD_LABELS[name]) {
        show('as labelled fields', await profile.readLabelledFields(name));
      }
      const att = await profile.readAttachments(name);
      if (att.length) show('attachments', att);
      /* eslint-enable no-await-in-loop */
    }

    h2('what the payload holds for those sections');
    if (payload) {
      show('qualification / about_me / headline', {
        qualification: payload.qualification,
        about_me: payload.about_me,
        headline: payload.headline,
      });
      show(
        'educations',
        (payload.educations || []).map((e) => ({
          institution: e.institution_name,
          degree: e.degree_name,
          field: e.field_of_study_name,
          start: e.start_date,
          end: e.end_date,
          document: e.document && e.document.file_name,
          documentStatus: e.document && e.document.status,
        }))
      );
      show(
        'work_experiences',
        (payload.work_experiences || []).map((w) => ({
          designation: w.designation,
          experience: w.experience,
          rendersAs: CandidateViewProfilePage.titleCaseEnum(w.experience),
          company: w.company_name,
          start: w.start_date,
          end: w.end_date,
          is_current: w.is_current,
        }))
      );
      show(
        'certifications',
        (payload.certifications || []).map((c) => ({
          name: c.name,
          issued_by: c.issued_by,
          issue: c.issue_date,
          expiry: c.expiry_date,
        }))
      );
      show('roles', (payload.roles || []).map((r) => r.name));
      show('preferences', {
        current_location: payload.current_location && payload.current_location.location_name,
        preferred_locations: (payload.preferred_locations || []).map((l) => l.location_name),
        interested_in_relocation: payload.interested_in_relocation,
        interested_in_tamheer: payload.interested_in_tamheer,
        is_co_op_preferred: payload.is_co_op_preferred,
      });
      console.log(
        '\n>>> Basic Information is gated on about_me ALONE. <<< With it empty the section claims\n'
          + 'the candidate added nothing and HIDES the Current Status they did provide. Compare a\n'
          + 'candidate with about_me set against one without - qualification is set on both.'
      );
    }

    // ---------------------------------------------------------------- 6. documents
    h1('6. DOCUMENT VERIFICATION');
    await profile.selectTab('Document Verification');
    show('grouped rows', await profile.readDocumentGroups());
    show('status label mapping', CandidateViewProfilePage.DOCUMENT_STATUS_LABEL);
    console.log(
      'REVISION renders "Revision Required" and AWAITING renders "Needs Review" here - the same\n'
        + 'API value is "Need Review" on the verifications filter tab and "Awaiting Verification"\n'
        + 'in the schema, so the wording is written down rather than guessed.\n\n'
        + 'A row is .document-list-item inside .documents-list-items-container. NOTE the container\n'
        + 'is PLURAL and the row SINGULAR, so a [class*="list-item"] union matches both and a\n'
        + 'one-row group resolves to two elements. Each row carries the file name (a real\n'
        + '<button>), a .status-badge-label pill, "Uploaded on <date>", and TWO ACTIONS in a\n'
        + 'sibling [margin-inline-start:auto] container: [0] View, [1] Download.\n\n'
        + 'A candidate who has uploaded nothing gets ONE LINE PER GROUP and no tab-level message:\n'
        + JSON.stringify(CandidateViewProfilePage.DOCUMENT_EMPTY_STATE, null, 2)
    );
    const icons = await profile.auditClickableIcons();
    h2('the two per-row controls');
    show('summary', {
      total: icons.total,
      unreachableByKeyboard: icons.unreachable,
      hiddenFromAssistiveTech: icons.hiddenFromAt,
    });
    show('first two', icons.controls.slice(0, 2));
    console.log(
      '\n>>> EVERY ONE IS A BARE <svg aria-hidden="true"> OUTSIDE ANY BUTTON OR ANCHOR, with a\n'
        + 'parent at tabIndex -1. So they are unreachable by keyboard AND explicitly hidden from a\n'
        + 'screen reader. The only reachable control per row is the file name.'
    );

    // ---------------------------------------------------------------- 6b. the document viewer
    //
    // >>> READ-ONLY, AND DELIBERATELY SO. <<< It opens each document, reads what the dialog
    // offers and closes it. Opening writes nothing and fires no request. It NEVER clicks Approve
    // or Request Revision - either one commits irreversibly and nothing in the product reverses
    // it. Pass --no-viewer to skip this section entirely.
    if (!flag('no-viewer')) {
      h1('6b. THE DOCUMENT VIEWER (opened, read and closed - nothing is decided)');
      const groups = await profile.readDocumentGroups();
      const docRows = Object.values(groups).flatMap((g) => g.rows || []);
      const storedDocs = payload
        ? [
            ...(payload.educations || []),
            ...(payload.work_experiences || []),
            ...(payload.certifications || []),
          ]
            .filter((e) => e.document)
            .map((e) => e.document)
        : [];

      if (!docRows.length) console.log('this candidate has uploaded no documents - nothing to open');
      for (const row of docRows) {
        /* eslint-disable no-await-in-loop */
        const v = await profile.openDocumentViewer(row.fileName);
        const stored = storedDocs.find(
          (d) => CandidateViewProfilePage.norm(d.file_name) === CandidateViewProfilePage.norm(row.fileName)
        );
        h2(`${row.fileName}  [${row.status}]`);
        show('viewer', {
          heading: v.heading,
          documentName: v.documentName,
          documentType: v.documentType,
          dateUploaded: v.dateUploaded,
          status: v.status,
          version: v.version,
          zoom: v.zoom,
          buttons: v.buttons,
          decisionControls: { approve: v.hasApprove, requestRevision: v.hasRequestRevision },
          preview: v.preview,
          flaggedBy: v.flaggedBy,
          flaggedFor: v.flaggedFor,
          // Kept apart from the findings above: a decided document also renders a stored
          // comment with its own author line, and a reader that ran the two together returned
          // the comment as an AI finding.
          commentBy: v.commentBy,
          commentHistory: v.commentHistory,
        });
        if (stored) {
          show('the payload behind it', {
            status: stored.status,
            version: stored.version,
            rendered: `v${stored.version}.0`,
            uploaded_on: stored.uploaded_on,
          });
        }
        if (flag('zoom')) {
          show('zoom in', await profile.zoomDocument('in'));
          show('zoom out', await profile.zoomDocument('out'));
        }
        await profile.closeDocumentViewer();
        /* eslint-enable no-await-in-loop */
      }

      console.log(
        '\n>>> Request Revision AND Approve ARE IN THIS DIALOG, ONLY ON A "Needs Review"\n'
          + 'DOCUMENT. <<< Same test ids as /verifications (agent-approve-button,\n'
          + 'agent-request-revision-button) because it is the same panel component, and either\n'
          + 'one commits irreversibly. So the claim that this whole screen "has no decision\n'
          + 'control" is FALSE - what is true is that opening the viewer writes nothing, which is\n'
          + 'what keeps the feature safe in the default run.\n\n'
          + 'VERSION: the payload carries an integer and the dialog renders "v<n>.0". Measured\n'
          + 'v1.0 for version 1 and v3.0 for version 3 - so a document re-uploaded after a\n'
          + 'revision request really does show a higher number, and that is how an agent tells a\n'
          + 'replacement from the copy they sent back.\n\n'
          + 'ZOOM: 100 -> 125 -> 150 stepping in, floor 50 where "Zoom out" is DISABLED.\n'
          + 'Download leaves the dialog OPEN. Close (aria-label "Close") and Escape both shut it,\n'
          + 'and the URL never changes - it is a dialog, not a route.'
      );
    }

    // ---------------------------------------------------------------- 7. subscription
    h1('7. SUBSCRIPTION');
    await profile.selectTab('Subscription');
    const sub = await profile.readSubscription();
    show('rendered', sub);
    const subPayload = profile.subscriptionPayload();
    if (subPayload) {
      show('payload', {
        status: subPayload.status,
        plan_name: subPayload.plan_name,
        plan_price: subPayload.plan_price,
        currency: subPayload.currency,
        subscription_start_date: subPayload.subscription_start_date,
        renewal_date: subPayload.renewal_date,
        paymentAmount: subPayload.payment && subPayload.payment.amount,
      });
      console.log(
        '\n>>> "Total Fee" IS payment.amount, NOT plan_price. <<< Measured: a plan priced 1500\n'
          + 'rendered "895 SAR", the amount actually charged after a promo. Both numbers are on\n'
          + 'the same payload, so a check for "a number appears" would pass on either.\n'
          + 'Status: the API says ACTIVE and the tab says "Subscribed" - a third naming.'
      );
    } else {
      console.log('(no subscription payload - this candidate holds no subscription)');
    }

    // ---------------------------------------------------------------- 8. activity log
    h1('8. ACTIVITY LOG AND ITS DURATION FILTER');
    await profile.selectTab('Activity Log');
    show('default duration', await profile.selectedDuration());
    const opts = await profile.readDurationOptions();
    show('offered in the popover', opts.offered);
    show('the hidden mirror <select>', opts.mirror);
    console.log(
      '\nThe mirror carries a BLANK option the popover does NOT offer, so it is not\n'
        + 'user-selectable and is NOT a defect. Recorded so nobody reports it.\n'
        + 'The popover is role=dialog > role=listbox > role=option with TWO <button\n'
        + 'aria-label="Dismiss"> FLANKING the listbox - so select by role=option and name, never\n'
        + 'by indexing a locator union, or every click is intercepted by Dismiss.'
    );

    h2('each duration -> the parameter the app sends');
    for (const d of CandidateViewProfilePage.DURATIONS) {
      /* eslint-disable no-await-in-loop */
      const r = await profile.selectDuration(d.label);
      console.log(
        `${d.label.padEnd(16)} sent duration=${String(r.sentDuration).padEnd(16)} `
          + `count=${r.payload ? r.payload.count : '?'}  urlCarriesDuration=${/duration=/.test(r.url)}`
      );
      /* eslint-enable no-await-in-loop */
    }
    console.log(
      '\nThe chosen range is sent as the `duration` API parameter and written NOWHERE in the URL,\n'
        + 'so it cannot be shared or restored by a reload.'
    );

    await profile.selectDuration('This year');
    const entries = await profile.readActivityEntries();
    h2('entries (This year)');
    show('rendered', entries.slice(0, 6));
    const actPayload = profile.activityPayload();
    if (actPayload) {
      show('server', {
        count: actPayload.count,
        returnedOnThisPage: (actPayload.results || []).length,
        pageSize: 10,
        actors: [...new Set((actPayload.results || []).map((r) => r.actor))],
        audiences: [...new Set((actPayload.results || []).map((r) => r.audience))],
      });
      show(
        'first three, payload vs render',
        (actPayload.results || []).slice(0, 3).map((r) => ({
          headline: r.headline,
          description: r.description,
          created_at: r.created_at,
          date_time: r.date_time,
        }))
      );
      console.log(
        '\n>>> THE UI RENDERS ONLY THE DATE AND DISCARDS THE TIME date_time CARRIES. <<< Two\n'
          + 'entries on one day with the same headline and description render IDENTICALLY, so the\n'
          + 'agent cannot tell them apart. Ordering is newest-first by created_at.'
      );
    }
    const empty = await profile.readActivityEmptyState();
    if (empty) {
      show('empty state', empty);
      console.log(
        'Note the copy says "YOUR recent actions" on a surface where an AGENT is looking at a\n'
          + 'CANDIDATE - candidate-facing copy on an agent-facing screen.'
      );
    }

    // ---------------------------------------------------------------- 9. reminder history
    h1('9. REMINDER HISTORY');
    show('control enabled', await profile.reminderHistoryEnabled());
    show('payload has_reminders', payload ? payload.has_reminders : null);
    if (await profile.reminderHistoryEnabled()) {
      const r = await profile.openReminderHistory();
      const render = await profile.readReminderHistory();
      show('url changed by opening it', r.urlBefore !== r.urlAfter);
      show('endpoint', `GET /core/api/v1/agent/candidate/${opened.candidateId}/reminders/`);
      show('server', {
        count: r.payload && r.payload.count,
        returnedOnThisPage: r.fetched,
      });
      show('rendered', {
        candidate: render.candidate,
        heading: render.heading,
        entries: render.entries,
        hasViewMore: render.hasViewMore,
        showingAll: render.showingAll,
      });
      console.log(
        '\n>>> "Sent" AND THE TIMESTAMP ARE ON SEPARATE LINES. <<< A reader looking for\n'
          + '"Sent • <date>" on ONE line matches nothing and returns an empty history - which is\n'
          + 'how the sibling reader in RequiresAttentionPage came to report a candidate with ten\n'
          + 'reminders as having none. Entries are derived from the <li> elements instead.\n'
          + '\nThe footer is CORRECT: "View more" when the history is truncated (count > page),\n'
          + '"Showing all reminders sent to this candidate" only when it is complete.\n'
          + '\nIt renders `title` ("We miss you on Talentforge") rather than `display_title`\n'
          + '("Inactivity reminder"), i.e. the candidate-facing wording. Times are TZ-converted.'
      );
      await profile.closeReminderHistory('Close');
      show('closed again', await profile.reminderHistoryStaysClosed(1500));
    } else {
      console.log('(disabled for this candidate - has_reminders is false)');
    }

    // ---------------------------------------------------------------- 10. accessibility
    if (!flag('no-audit')) {
      h1('10. ACCESSIBILITY OF THE PROFILE CHROME');
      console.log(
        'A REAL Tab walk plus a CONTROL. The control matters: "nothing focused" is also what a\n'
          + 'broken walk reports, so a known-focusable button must be shown to focus.\n'
      );
      const audit = await profile.auditKeyboard(60);
      show('focus stops', audit.distinctStops);
      show('CONTROL (Reminder History must focus)', audit.control);
      show('Back', audit.back);
      show('Back was ever focused', audit.backFocused);
      show('focus stops with no accessible name', audit.unnamedFocusStops);
      console.log(
        '\n>>> Back IS A <p> AT tabIndex -1 THAT focus() DOES NOT EVEN FOCUS. <<< Unreachable by\n'
          + 'keyboard and invisible to a screen reader. The header icon button IS focusable but\n'
          + 'has no accessible name, so it announces only "button".'
      );

      h2('is the header icon button inert?');
      const probe = await profile.probeHeaderIconButton();
      show('observed', probe);
      console.log(
        'Instrumented BEFORE the click - clipboard API, execCommand, requests, navigation,\n'
          + 'dialogs and toasts. Measured: it writes nothing, fires nothing, navigates nowhere and\n'
          + 'raises nothing. A control with no name that does nothing.'
      );
    }

    h1('DONE - nothing was written, sent or spent');
  } catch (e) {
    console.error(`\nPROBE FAILED: ${e.message}\n${e.stack}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})();
