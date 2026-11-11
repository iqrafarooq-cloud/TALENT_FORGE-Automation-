const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const fs = require('fs');
require('dotenv').config();

const CandidatesListingPage = require('../pages/CandidatesListingPage');

// Step definitions for features/SuperAdmin_Portal/UserManagement/Candidate-View-Drawer.feature -
// the SuperAdmin Candidates listing's View drawer, every tab checked against the response the app
// itself received for the candidate that was opened.
//
// Measured 2026-10-26 with scripts/probe-superadmin-candidate-drawer.js (read-only). The structural
// steps (tab names, one endpoint per tab, closing the drawer) live in steps/candidate-management.js
// and are reused, not repeated.
//
// RULES
//  - Subjects are CHOSEN from live data on every run (a candidate with documents, a subscribed one,
//    one with a track...). Nothing is pinned: candidates gain documents, tracks and subscriptions.
//  - Every expected value comes from the server's own answer, read off the app's request.
//  - The Documents viewer's Approve / Request Revision are only READ. Nothing here clicks them.
//  - A table-driven step collects every problem and throws once.

const listing = (world) => world.pages.candidatesListing;
const panel = (world) => world.pages.candidateDetailPanel;

function fail(problems, context) {
  if (problems.length) throw new Error(`${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const DOC_STATUS = { AWAITING: 'Needs Review', APPROVED: 'Approved', REVISION: 'Revision Required' };
// The viewer names the type as the Verifications page does: Transcript / Experience Letter /
// Certification - not the category headings the Documents tab groups by.
const DOC_TYPE = { EDUCATION: 'Transcript', WORKEXPERIENCE: 'Experience Letter', CERTIFICATION: 'Certification' };
const DOC_GROUP = { EDUCATION: 'Education', WORKEXPERIENCE: 'Work Experience', CERTIFICATION: 'Certifications' };
const COURSE_STATUS = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed' };
const MAGIC = { pdf: '25504446', png: '89504e47', jpg: 'ffd8ff', jpeg: 'ffd8ff' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-19" -> "Oct 19, 2026", built from the string's own parts (a Date would shift a
// date-only value by the runner's timezone).
function isoToShort(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
const titleCaseFirst = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase().replace(/_/g, '-') : '');

// ==================== The server, read with the app's own token ====================

async function api(world) {
  if (world._dwApi && world._dwApi.page === world.page) return world._dwApi;
  const authorised = world.page.waitForRequest(
    (r) => /\/api\/v1\/candidate\/\?/.test(r.url()) && Boolean(r.headers().authorization), { timeout: 60000 },
  );
  await listing(world).goto('All');
  const req = await authorised;
  const base = req.url().replace(/\/candidate\/\?.*$/, '');
  const headers = { authorization: req.headers().authorization };
  const get = async (path) => {
    const r = await world.page.request.get(`${base}${path}`, { headers });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };
  world._dwApi = { page: world.page, get };
  return world._dwApi;
}

const docsOf = (profile) => ['educations', 'work_experiences', 'certifications']
  .flatMap((k) => ((profile && profile[k]) || []).map((e) => e.document).filter(Boolean));

// Subjects are chosen once per worker and reused: the scan behind each is dozens of API calls, and
// re-running it in every scenario on parallel workers starved the browser (measured: a drawer that
// took over 3 minutes to open).
const CHOSEN = {};
// A reused subject still lands the scenario on the Candidates listing, as a fresh scan would.
async function reuse(world, key) {
  if (!CHOSEN[key]) return false;
  await listing(world).goto('All');
  note(world, CHOSEN[key].c, `${CHOSEN[key].why} (chosen earlier in this run)`);
  return true;
}
function choose(world, key, c, why) {
  CHOSEN[key] = { c, why };
  note(world, c, why);
}

function note(world, c, why) {
  const row = { id: c.id, name: c.full_name || c.name, email: c.email, status: c.account_status };
  world._candidate = row;
  world._emailSurface = 'Candidates';
  world._emailSubject = { kind: 'candidate', ...row };
  world.attach(`Subject candidate: ${row.name} <${row.email}> (id ${row.id})\n${why}`, 'text/plain');
}

async function listOf(world, query, pages = 1) {
  const { get } = await api(world);
  const out = [];
  for (let p = 1; p <= pages; p += 1) {
    const r = await get(`/candidate/?page=${p}&page_size=100${query}`);
    out.push(...((r.body && r.body.results) || []));
    if (!(r.body && r.body.next)) break;
  }
  return out;
}

// ==================== Choosing a subject ====================

Given('I have found a candidate whose documents I can open', { timeout: 300000 }, async function () {
  if (await reuse(this, 'documents')) return;
  const { get } = await api(this);
  const pool = [...await listOf(this, '&pending_documents=1-2'), ...await listOf(this, '&pending_documents=3%2B')];
  let best = null;
  for (const c of pool.slice(0, 40)) {
    const docs = docsOf((await get(`/candidate/profile/${c.id}/`)).body);
    const statuses = new Set(docs.map((d) => d.status));
    const score = docs.length + (statuses.size > 1 ? 10 : 0);
    if (docs.length && (!best || score > best.score)) best = { c, docs, score };
    if (best && best.score >= 12) break;
  }
  if (!best) throw new Error(`None of ${pool.length} candidates with pending documents holds a document.`);
  choose(this, 'documents', best.c, `Holds ${best.docs.length} document(s): ${best.docs.map((d) => `${d.file_name} [${d.status}]`).join(', ')}`);
});

Given('I have found a subscribed candidate', { timeout: 300000 }, async function () {
  if (await reuse(this, 'subscribed')) return;
  const { get } = await api(this);
  for (const c of (await listOf(this, '&subscription_status=subscribed')).slice(0, 20)) {
    const s = await get(`/subscription/current/${c.id}/`);
    if (s.status === 200 && s.body && s.body.status === 'ACTIVE') {
      choose(this, 'subscribed', c, `Subscription: ${s.body.plan_name}, started ${s.body.subscription_start_date}`);
      return;
    }
  }
  throw new Error('No subscribed candidate with an ACTIVE current subscription was found.');
});

Given('I have found a candidate without a subscription', { timeout: 300000 }, async function () {
  if (await reuse(this, 'unsubscribed')) return;
  const { get } = await api(this);
  for (const c of (await listOf(this, '&subscription_status=not_subscribed')).slice(0, 20)) {
    if ((await get(`/subscription/current/${c.id}/`)).status === 404) { choose(this, 'unsubscribed', c, 'No current subscription (404).'); return; }
  }
  throw new Error('No unsubscribed candidate answering 404 for its subscription was found.');
});

Given('I have found a candidate with an assigned track', { timeout: 600000 }, async function () {
  if (await reuse(this, 'track')) return;
  const { get } = await api(this);
  const pool = await listOf(this, '&subscription_status=subscribed', 4);
  for (const c of pool) {
    const t = await get(`/tracks/candidate/${c.id}/`);
    if (t.status === 200 && t.body && t.body.track_title) {
      choose(this, 'track', c, `Track: ${t.body.track_title}, ${(t.body.courses || []).length} course(s)`);
      return;
    }
  }
  throw new Error(`None of ${pool.length} subscribed candidates has a track assigned.`);
});

Given('I have found a candidate without a track', { timeout: 300000 }, async function () {
  if (await reuse(this, 'notrack')) return;
  const { get } = await api(this);
  for (const c of (await listOf(this, '&subscription_status=not_subscribed')).slice(0, 20)) {
    if ((await get(`/tracks/candidate/${c.id}/`)).status === 404) { choose(this, 'notrack', c, 'No track (404).'); return; }
  }
  throw new Error('No candidate without a track was found.');
});

Given('I have found a candidate with activity this year', { timeout: 600000 }, async function () {
  if (await reuse(this, 'activity')) return;
  const { get } = await api(this);
  for (const c of [...await listOf(this, '&subscription_status=subscribed'), ...await listOf(this, '')].slice(0, 80)) {
    const a = await get(`/analytics/candidates/activity-logs/${c.id}/?page=1&page_size=10&duration=this_year`);
    if (a.body && a.body.count > 0) { choose(this, 'activity', c, `${a.body.count} activity entr${a.body.count === 1 ? 'y' : 'ies'} this year.`); return; }
  }
  throw new Error('No candidate with activity this year was found among the first 80 checked.');
});

Given('I have found a candidate with a filled-in profile', { timeout: 300000 }, async function () {
  if (await reuse(this, 'filled')) return;
  const { get } = await api(this);
  const pool = [...await listOf(this, '&pending_documents=1-2'), ...await listOf(this, '&pending_documents=3%2B')];
  for (const c of pool.slice(0, 30)) {
    const p = (await get(`/candidate/profile/${c.id}/`)).body || {};
    const filled = ['educations', 'work_experiences', 'certifications'].filter((k) => (p[k] || []).length).length;
    if (filled >= 2 && p.qualification) { choose(this, 'filled', c, `Profile has ${filled} filled sections.`); return; }
  }
  throw new Error('No candidate with at least two filled profile sections was found.');
});

Given('I have found a candidate with an empty profile', { timeout: 300000 }, async function () {
  if (await reuse(this, 'empty')) return;
  const { get } = await api(this);
  for (const c of (await listOf(this, '&subscription_status=not_subscribed')).slice(0, 30)) {
    const p = (await get(`/candidate/profile/${c.id}/`)).body || {};
    const empty = ['educations', 'work_experiences', 'certifications', 'roles', 'preferred_locations'].every((k) => !(p[k] || []).length)
      && !p.about_me && !p.stats;
    if (empty) { choose(this, 'empty', c, 'Profile holds no entries, no About Me and no statistics.'); return; }
  }
  throw new Error('No candidate with an empty profile was found.');
});

Given('I have found two different candidates on the listing', { timeout: 120000 }, async function () {
  const rows = (await listOf(this, '')).filter((c) => c.email);
  expect(rows.length, 'the listing holds fewer than two candidates').toBeGreaterThan(1);
  this._dwPair = rows.slice(0, 2);
  note(this, rows[0], `Second candidate: ${rows[1].full_name} <${rows[1].email}>`);
});

// ==================== Opening the drawer and recording what it fetched ====================

function record(world) {
  if (world._dwRecPage === world.page) return;
  world._dwRecPage = world.page;
  world._dw = { profile: {}, track: {}, subscription: {}, activity: [] };
  world.page.on('response', async (r) => {
    const url = r.url();
    const m = url.match(/\/api\/v1\/(candidate\/profile|tracks\/candidate|subscription\/current|analytics\/candidates\/activity-logs)\/(\d+)\//);
    if (!m || r.request().method() !== 'GET') return;
    const body = await r.json().catch(() => null);
    const entry = { id: Number(m[2]), status: r.status(), body, url };
    if (m[1] === 'candidate/profile') world._dw.profile[m[2]] = entry;
    else if (m[1] === 'tracks/candidate') world._dw.track[m[2]] = entry;
    else if (m[1] === 'subscription/current') world._dw.subscription[m[2]] = entry;
    else world._dw.activity.push(entry);
  });
}

async function openDrawerFor(world, c) {
  record(world);
  await listing(world).goto('All');
  await listing(world).search(c.email, { tab: 'All' });
  await listing(world).openCandidatePanel(c.email);
  await panel(world).waitForOpen();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !world._dw.profile[c.id]) await world.page.waitForTimeout(300);
}

When("I open that candidate's drawer from the listing", { timeout: 180000 }, async function () {
  await openDrawerFor(this, this._candidate);
});

// Opens the drawer from the row ALREADY on screen (no navigation, no search), for the end-to-end
// scenario that notes the listing first and must find it unchanged afterwards.
When('I view that candidate and record what the drawer fetches', { timeout: 120000 }, async function () {
  record(this);
  await listing(this).openCandidatePanel(this._candidate.email);
  await panel(this).waitForOpen();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !this._dw.profile[this._candidate.id]) await this.page.waitForTimeout(300);
});

function served(world, kind) {
  const c = world._candidate;
  const entry = world._dw && world._dw[kind] && world._dw[kind][c.id];
  if (!entry) throw new Error(`The drawer never received ${kind} for ${c.email} (id ${c.id}).`);
  return entry;
}

async function openTab(world, name) {
  await panel(world).openTab(name);
  await world.page.waitForTimeout(800);
}

// ==================== Header and KPIs ====================

Then('the drawer header should show that candidate as the server holds them', async function () {
  const p = served(this, 'profile').body;
  const header = await panel(this).readHeader();
  const kpis = await panel(this).readKpis();
  const problems = [];
  const name = clean(`${p.user.firstname || ''} ${p.user.lastname || ''}`);
  if (!header.headerText.includes(name)) problems.push(`the header does not name ${name}: ${header.headerText}`);
  const pill = p.is_verified ? 'Verified' : 'Unverified';
  if (header.verification !== pill) problems.push(`the pill reads ${JSON.stringify(header.verification)}, the server says ${pill}`);
  const want = p.stats
    ? { 'Track Progress': `${p.stats.track_progress}%`, 'Courses Completed': String(p.stats.courses_completed), 'Hours Learned': String(p.stats.hours_learned), 'Certificates Earned': String(p.stats.certifications_earned) }
    : { 'Track Progress': '—%', 'Courses Completed': '—', 'Hours Learned': '—', 'Certificates Earned': '—' };
  for (const [caption, value] of Object.entries(want)) {
    const k = kpis.find((x) => x.caption === caption);
    if (!k) problems.push(`no "${caption}" figure is shown`);
    else if (k.value !== value) problems.push(`"${caption}" reads ${k.value}, the server says ${value}`);
  }
  this.attach(`header: ${header.headerText}\nkpis: ${JSON.stringify(kpis)}\nstats: ${JSON.stringify(p.stats)}`, 'text/plain');
  fail(problems, 'The drawer header does not show what the server holds for this candidate:');
});

// ==================== Candidate Details ====================

Then('Candidate Details should show what the server holds for that candidate', { timeout: 120000 }, async function () {
  await openTab(this, 'Candidate Details');
  const p = served(this, 'profile').body;
  const details = await panel(this).readCandidateDetails();
  const sec = (t) => (details.sections.find((s) => s.title === t) || { text: '' }).text;
  const problems = [];
  const basic = sec('Basic Information');
  const expectField = (label, value) => {
    const want = value ? String(value) : '-';
    if (!new RegExp(`${label}\\s+${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(basic)) {
      problems.push(`Basic Information "${label}" should read ${JSON.stringify(want)}: ${basic}`);
    }
  };
  expectField('Email', p.user.email);
  expectField('Phone Number', p.user.phone_number);
  // Current Status is compared only when the candidate stored one: with none stored the drawer
  // shows "Student" (its own @known-issue scenario below), and that must not sink this check.
  if (p.qualification) expectField('Current Status', titleCaseFirst(p.qualification));
  expectField('Nationality', p.user.nationality);
  const lists = [
    ['Education', p.educations, (e) => e.institution_name],
    ['Work Experience', p.work_experiences, (e) => e.company_name],
    ['Certifications', p.certifications, (e) => e.name],
  ];
  for (const [title, entries, key] of lists) {
    const text = sec(title);
    if (!(entries || []).length) {
      if (!/no .* added yet/i.test(text)) problems.push(`${title} holds nothing on the server but does not say so: ${text}`);
      continue;
    }
    for (const e of entries) {
      const v = key(e);
      if (v && !text.toLowerCase().includes(String(v).toLowerCase())) problems.push(`${title} does not list ${JSON.stringify(v)}: ${text}`);
    }
  }
  const prefs = sec('Work Preferences & Availability');
  if (!new RegExp(`Open to Relocation\\s+${p.interested_in_relocation ? 'Yes' : 'No'}`).test(prefs)) {
    problems.push(`Open to Relocation should read ${p.interested_in_relocation ? 'Yes' : 'No'}: ${prefs}`);
  }
  const roles = sec('Desired Roles');
  if (!(p.roles || []).length) {
    if (!/no desired roles selected/i.test(roles)) problems.push(`Desired Roles holds nothing on the server but does not say so: ${roles}`);
  } else {
    for (const r of p.roles) if (!roles.toLowerCase().includes(String(r.name).toLowerCase())) problems.push(`Desired Roles does not list ${r.name}`);
  }
  this.attach(JSON.stringify(details.sections, null, 1), 'text/plain');
  fail(problems, 'Candidate Details does not show what the server holds:');
});

Then('Current Status should read "-" when the candidate has not stored one', { timeout: 120000 }, async function () {
  await openTab(this, 'Candidate Details');
  const p = served(this, 'profile').body;
  expect(p.qualification, 'the premise is broken: this candidate HAS stored a Current Status').toBeFalsy();
  const details = await panel(this).readCandidateDetails();
  const basic = (details.sections.find((s) => s.title === 'Basic Information') || { text: '' }).text;
  const shown = (basic.match(/Current Status\s+(\S+)/) || [])[1];
  this.attach(`qualification on the server: ${JSON.stringify(p.qualification)}; Basic Information: ${basic}`, 'text/plain');
  expect(shown, `Current Status reads ${JSON.stringify(shown)} for a candidate who stored none`).toBe('-');
});

// ==================== Track Progress ====================

Then('Track Progress should say no track is assigned yet, as the server answered 404', { timeout: 60000 }, async function () {
  await openTab(this, 'Track Progress');
  const t = served(this, 'track');
  const track = await panel(this).readTrackProgress();
  expect(t.status, `the tracks request answered ${t.status}`).toBe(404);
  expect(track.noAssessment, `Track Progress reads: ${track.body}`).toBe(true);
});

Then("Track Progress should show the server's track with every course and its status", { timeout: 60000 }, async function () {
  await openTab(this, 'Track Progress');
  const t = served(this, 'track');
  expect(t.status, `the tracks request answered ${t.status}`).toBe(200);
  const body = await panel(this).trackBody();
  const problems = [];
  if (!body.includes(t.body.track_title)) problems.push(`the track title ${JSON.stringify(t.body.track_title)} is not shown`);
  for (const course of t.body.courses || []) {
    const label = COURSE_STATUS[course.status] || course.status;
    const at = body.indexOf(course.title);
    if (at < 0) { problems.push(`course ${JSON.stringify(course.title)} is not listed`); continue; }
    if (!body.slice(at + course.title.length, at + course.title.length + 30).includes(label)) {
      problems.push(`course ${JSON.stringify(course.title)} should read "${label}"`);
    }
  }
  this.attach(`Track Progress: ${body.slice(0, 1200)}`, 'text/plain');
  fail(problems, "Track Progress does not show the server's track:");
});

// ==================== Documents ====================

function serverDocs(world) {
  return docsOf(served(world, 'profile').body);
}

Then("the Documents tab should list exactly the server's documents under their categories", { timeout: 60000 }, async function () {
  await openTab(this, 'Documents');
  const docs = serverDocs(this);
  const rows = await panel(this).readDocumentRows();
  const problems = [];
  if (rows.length !== docs.length) problems.push(`${rows.length} row(s) listed, the server holds ${docs.length}`);
  for (const d of docs) {
    const row = rows.find((r) => r.name === d.file_name);
    if (!row) { problems.push(`${d.file_name} is not listed`); continue; }
    if (row.group !== DOC_GROUP[d.category]) problems.push(`${d.file_name} is under ${JSON.stringify(row.group)}, not ${DOC_GROUP[d.category]}`);
    if (row.status !== DOC_STATUS[d.status]) problems.push(`${d.file_name} reads ${JSON.stringify(row.status)}, the server says ${d.status} (${DOC_STATUS[d.status]})`);
    if (row.uploadedOn !== d.uploaded_on) problems.push(`${d.file_name} says uploaded ${row.uploadedOn}, the server ${d.uploaded_on}`);
    if (!row.view || !row.download) problems.push(`${d.file_name} does not offer both View and Download`);
  }
  const doc = await panel(this).readDocuments();
  for (const g of doc.groups) {
    const has = docs.some((d) => DOC_GROUP[d.category] === g.group);
    if (!has && !g.empty) problems.push(`${g.group} holds no document on the server but does not say so: ${g.text}`);
  }
  this.attach(`rows: ${JSON.stringify(rows, null, 1)}`, 'text/plain');
  fail(problems, "The Documents tab does not list the server's documents:");
});

// One pass over EVERY document: open its viewer, compare it with the server's record, and close it.
// Decision controls are only read (the superadmin may decide - product decision 2026-10-26 - but a
// decision is irreversible): on a Needs Review document the viewer offers them, on any other
// it must not.
Then('the viewer should describe each document as the server holds it', { timeout: 300000 }, async function () {
  await openTab(this, 'Documents');
  const problems = [];
  const report = [];
  for (const d of serverDocs(this)) {
    await panel(this).openDocumentViewer(d.file_name);
    const v = await panel(this).readViewer();
    report.push(`${d.file_name}: ${JSON.stringify(v.fields)} decisions=${JSON.stringify(v.decisions)} flagged=${v.flagged.slice(0, 120)}`);
    const want = {
      'Document Name': d.file_name,
      'Document Type': DOC_TYPE[d.category],
      'Date Uploaded': d.uploaded_on,
      Status: DOC_STATUS[d.status],
      Version: `v${d.version}.0`,
    };
    for (const [k, val] of Object.entries(want)) {
      if (v.fields[k] !== val) problems.push(`${d.file_name}: ${k} reads ${JSON.stringify(v.fields[k])}, the server says ${JSON.stringify(val)}`);
    }
    if (v.heading !== 'Document Verification') problems.push(`${d.file_name}: the viewer is headed ${JSON.stringify(v.heading)}`);
    const nonPass = ((d.ai_verification && d.ai_verification.criteria) || []).filter((c) => c.verdict !== 'pass');
    if (nonPass.length && !v.flagged) problems.push(`${d.file_name}: the AI did not pass ${nonPass.map((c) => c.key).join(', ')} but nothing is flagged`);
    for (const c of nonPass.filter((x) => x.verdict === 'fail')) {
      if (!v.flagged.includes(clean(c.detail).slice(0, 40))) problems.push(`${d.file_name}: the failed ${c.key} finding is not shown`);
    }
    const offered = v.decisions.length > 0;
    if (d.status === 'AWAITING' && !offered) problems.push(`${d.file_name}: Needs Review but no decision is offered`);
    if (d.status !== 'AWAITING' && offered) problems.push(`${d.file_name}: ${DOC_STATUS[d.status]} but the viewer offers ${v.decisions.join(' and ')}`);
    if (d.file_name.toLowerCase().endsWith('.pdf') && v.pdfPages < 1) problems.push(`${d.file_name}: the PDF preview rendered no page`);
    await panel(this).closeViewerVia('Escape');
  }
  this.attach(report.join('\n'), 'text/plain');
  fail(problems, 'The document viewer does not describe the documents as the server holds them:');
});

When('I open the first document in the viewer', { timeout: 60000 }, async function () {
  await openTab(this, 'Documents');
  const d = serverDocs(this)[0];
  this._dwDoc = d;
  await panel(this).openDocumentViewer(d.file_name);
});

Then('the viewer should zoom in steps of 25 between 50% and 200% and disable each control at its bound', { timeout: 180000 }, async function () {
  const problems = [];
  let v = await panel(this).readViewer();
  if (v.zoom !== 100) problems.push(`the viewer opens at ${v.zoom}%, not 100%`);
  const seen = [v.zoom];
  for (let i = 0; i < 8 && !(await panel(this).viewerZoomDisabled('in')); i += 1) {
    await panel(this).zoomViewer('in');
    seen.push((await panel(this).readViewer()).zoom);
  }
  for (let i = 0; i < 12 && !(await panel(this).viewerZoomDisabled('out')); i += 1) {
    await panel(this).zoomViewer('out');
    seen.push((await panel(this).readViewer()).zoom);
  }
  v = await panel(this).readViewer();
  this.attach(`zoom levels seen: ${seen.join(' -> ')}`, 'text/plain');
  if (Math.max(...seen) !== 200) problems.push(`the highest zoom reached is ${Math.max(...seen)}%, not 200%`);
  if (Math.min(...seen) !== 50) problems.push(`the lowest zoom reached is ${Math.min(...seen)}%, not 50%`);
  seen.forEach((z, i) => { if (i && Math.abs(z - seen[i - 1]) !== 25) problems.push(`a zoom step went ${seen[i - 1]}% -> ${z}%`); });
  if (!(await panel(this).viewerZoomDisabled('out'))) problems.push('"Zoom out" is still enabled at 50%');
  fail(problems, 'The document viewer does not zoom as expected:');
});

async function checkDownload(download, d) {
  const problems = [];
  if (!download) return [`${d.file_name}: no download was delivered`];
  const name = download.suggestedFilename();
  const file = await download.path();
  const bytes = fs.readFileSync(file);
  const ext = (d.file_name.split('.').pop() || '').toLowerCase();
  if (name !== d.file_name) problems.push(`${d.file_name}: the download is named ${JSON.stringify(name)}`);
  if (!bytes.length) problems.push(`${d.file_name}: the downloaded file is empty`);
  if (MAGIC[ext] && !bytes.subarray(0, 4).toString('hex').startsWith(MAGIC[ext])) {
    problems.push(`${d.file_name}: the file does not start like a ${ext.toUpperCase()} (${bytes.subarray(0, 8).toString('hex')})`);
  }
  return problems;
}

Then("the viewer's Download should deliver that document and leave the viewer open", { timeout: 90000 }, async function () {
  const d = this._dwDoc;
  const problems = await checkDownload(await panel(this).downloadFromViewer(), d);
  if (!(await panel(this).viewer.isVisible())) problems.push('the viewer closed after Download');
  fail(problems, "The viewer's Download did not deliver the document:");
});

Then("each document's row Download should deliver that document under its own name", { timeout: 300000 }, async function () {
  await openTab(this, 'Documents');
  const problems = [];
  for (const d of serverDocs(this)) problems.push(...await checkDownload(await panel(this).downloadFromRow(d.file_name), d));
  expect(await panel(this).isOpen(), 'the drawer closed while downloading').toBe(true);
  fail(problems, 'A row Download did not deliver its document:');
});

Then('closing the viewer each of these ways should leave the drawer open on Documents:', { timeout: 180000 }, async function (table) {
  const problems = [];
  for (const { way } of table.hashes()) {
    if (!(await panel(this).viewer.isVisible())) await panel(this).openDocumentViewer(this._dwDoc.file_name);
    await panel(this).closeViewerVia(way);
    if (await panel(this).viewer.isVisible()) problems.push(`${way}: the viewer is still open`);
    if (!(await panel(this).isOpen())) problems.push(`${way}: the drawer closed with the viewer`);
    else if ((await panel(this).selectedTab()) !== 'Documents') problems.push(`${way}: the drawer left the Documents tab`);
  }
  fail(problems, 'Closing the viewer did not return to the drawer:');
});

When('I close the viewer with {string}', { timeout: 30000 }, async function (way) {
  await panel(this).closeViewerVia(way);
  expect(await panel(this).viewer.isVisible(), `the viewer did not close with ${way}`).toBe(false);
});

// The file name renders as a button and clicking it does nothing - intended (product decision
// 2026-10-26): only View opens a document.
Then("clicking a document's name should open nothing, download nothing and send nothing", { timeout: 60000 }, async function () {
  await openTab(this, 'Documents');
  const d = serverDocs(this)[0];
  const sent = [];
  const watch = (r) => { if (/\/api\/v1\//.test(r.url()) && !/notifications/.test(r.url())) sent.push(r.url()); };
  this.page.on('request', watch);
  const download = await panel(this).captureDownload(() => panel(this).documentRow(d.file_name).locator('button').first().click(), 4000);
  await this.page.waitForTimeout(1500);
  this.page.off('request', watch);
  expect(download, 'clicking the name downloaded the file').toBeNull();
  expect(await panel(this).viewer.isVisible(), 'clicking the name opened the viewer').toBe(false);
  expect(sent, `clicking the name sent ${JSON.stringify(sent)}`).toEqual([]);
});

// ==================== Subscription ====================

Then("the Subscription tab should show the server's current subscription", { timeout: 60000 }, async function () {
  await openTab(this, 'Subscription');
  const s = served(this, 'subscription');
  expect(s.status, `the subscription request answered ${s.status}`).toBe(200);
  const b = s.body;
  const view = await panel(this).readSubscription();
  const problems = [];
  const want = {
    Status: b.status === 'ACTIVE' ? 'Subscribed' : b.status,
    'Subscription Started': isoToShort(b.subscription_start_date),
    'Current Subscription': b.plan_name,
    'Next Billing Date': isoToShort(b.renewal_date),
  };
  for (const [k, v] of Object.entries(want)) if (view.fields[k] !== v) problems.push(`${k} reads ${JSON.stringify(view.fields[k])}, the server says ${JSON.stringify(v)}`);
  // "Total Fee" is the amount CHARGED, not the plan price (measured: Quarterly 400, 320 SAR after a promo).
  const charged = b.payment && b.payment.amount != null ? Number(b.payment.amount) : null;
  const shown = Number((view.fields['Total Fee'] || '').replace(/[^\d.]/g, ''));
  if (charged == null) problems.push(`the server returned no payment amount to compare Total Fee (${view.fields['Total Fee']}) with`);
  else if (shown !== charged) problems.push(`Total Fee reads ${view.fields['Total Fee']}, the server charged ${charged}`);
  if (!/SAR/.test(view.fields['Total Fee'] || '')) problems.push(`Total Fee names no currency: ${view.fields['Total Fee']}`);
  this.attach(`shown: ${JSON.stringify(view.fields)}\nserver: plan ${b.plan_name} price ${b.plan_price} charged ${charged} start ${b.subscription_start_date} renew ${b.renewal_date}`, 'text/plain');
  fail(problems, "The Subscription tab does not show the server's subscription:");
});

Then('the Subscription tab should say there is no active subscription, as the server answered 404', { timeout: 60000 }, async function () {
  await openTab(this, 'Subscription');
  const s = served(this, 'subscription');
  const view = await panel(this).readSubscription();
  expect(s.status, `the subscription request answered ${s.status}`).toBe(404);
  expect(view.none, `the Subscription tab reads: ${view.body}`).toBe(true);
  expect(view.fieldsPresent, 'subscription fields are shown for a candidate with none').toEqual([]);
});

// ==================== Activity Log ====================

When('I choose the {string} activity period in the drawer', { timeout: 60000 }, async function (label) {
  await openTab(this, 'Activity Log');
  const result = await panel(this).selectActivityPeriod(label);
  this._dwPeriod = { label, ...result };
});

function lastActivity(world) {
  const c = world._candidate;
  const hits = (world._dw.activity || []).filter((a) => a.id === c.id);
  if (!hits.length) throw new Error(`No Activity Log response was recorded for ${c.email}.`);
  return hits[hits.length - 1];
}

Then('the Activity Log should list exactly the entries the server returned', { timeout: 60000 }, async function () {
  const a = lastActivity(this);
  const log = await panel(this).readActivityLog();
  const results = (a.body && a.body.results) || [];
  const problems = [];
  if (!results.length) problems.push(`the premise is broken: the server returned no entries for ${this._dwPeriod.label}`);
  if (log.entries.length !== results.length) problems.push(`${log.entries.length} entr(ies) rendered, the server returned ${results.length}`);
  for (const r of results) {
    const head = clean(r.headline || r.title || '');
    if (head && !log.entries.some((e) => e.includes(head))) problems.push(`the entry ${JSON.stringify(head)} is not rendered`);
  }
  if (log.noActivity) problems.push('the empty state is shown beside entries');
  this.attach(`server ${results.length} (count ${a.body && a.body.count}); rendered ${JSON.stringify(log.entries.slice(0, 10))}`, 'text/plain');
  fail(problems, 'The Activity Log does not list the entries the server returned:');
});

Then('the Activity Log should say there is no activity when the server returns none', { timeout: 60000 }, async function () {
  const a = lastActivity(this);
  const log = await panel(this).readActivityLog();
  const count = a.body && a.body.count;
  this.attach(`period ${this._dwPeriod.label}: server count ${count}; rendered ${log.body.slice(0, 300)}`, 'text/plain');
  if (count > 0) {
    expect(log.entries.length, 'the server returned entries but none are rendered').toBeGreaterThan(0);
    return;
  }
  expect(log.noActivity, `no "No activity to show" for an empty period: ${log.body}`).toBe(true);
  expect(log.entries, 'entries are rendered for an empty period').toEqual([]);
});

// ==================== Failed loads (stubbed, read-only) ====================

const STUB = {
  'Track Progress': /\/api\/v1\/tracks\/candidate\/\d+\//,
  Subscription: /\/api\/v1\/subscription\/current\/\d+\//,
  'Activity Log': /\/api\/v1\/analytics\/candidates\/activity-logs\/\d+\//,
  profile: /\/api\/v1\/candidate\/profile\/\d+\//,
};

Given("the drawer's {string} request will fail with a server error", async function (which) {
  const pattern = STUB[which];
  if (!pattern) throw new Error(`Unknown drawer request "${which}" - ${Object.keys(STUB).join(', ')}.`);
  await this.page.route(pattern, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"stubbed failure"}' }));
});

const NOT_FAILURE = {
  'Track Progress': /hasn't completed the psychometric assessment/i,
  Subscription: /does not have an active subscription/i,
  'Activity Log': /no activity to show/i,
};

Then('the {string} tab should not present the failed load as an empty state', { timeout: 60000 }, async function (tab) {
  await openTab(this, tab);
  const body = (tab === 'Activity Log' ? await panel(this).readActivityLog()
    : tab === 'Subscription' ? await panel(this).readSubscription() : await panel(this).readTrackProgress()).body;
  this.attach(`${tab} after a 500: ${body.slice(0, 400)}`, 'text/plain');
  expect(body, `a failed ${tab} load is shown as the "nothing here" state: ${body.slice(0, 200)}`).not.toMatch(NOT_FAILURE[tab]);
});

Then('the drawer should not present a failed profile load as an empty profile', { timeout: 60000 }, async function () {
  const details = await panel(this).readCandidateDetails();
  const text = (details && details.sections.map((s) => s.text).join(' | ')) || '';
  this.attach(`Candidate Details after a 500: ${text.slice(0, 600)}`, 'text/plain');
  expect(text, 'a failed profile load is shown as a candidate who has added nothing')
    .not.toMatch(/hasn't added their (education|work experience|certifications)/i);
});

// ==================== Moving between candidates ====================

When('I close the drawer and open the second candidate', { timeout: 180000 }, async function () {
  await panel(this).closeVia('Escape');
  const [, second] = this._dwPair;
  this._dwFirst = this._candidate;
  note(this, second, 'Second candidate opened after the first.');
  await openDrawerFor(this, this._candidate);
});

Then('the drawer should show only the second candidate, opened on Candidate Details', { timeout: 60000 }, async function () {
  const first = this._dwFirst;
  const second = this._candidate;
  const header = await panel(this).readHeader();
  const problems = [];
  if (!header.headerText.includes(clean(second.name))) problems.push(`the header does not name ${second.name}: ${header.headerText}`);
  if (first.name !== second.name && header.headerText.includes(clean(first.name))) problems.push(`the header still names ${first.name}`);
  if ((await panel(this).selectedTab()) !== 'Candidate Details') problems.push(`the drawer opened on ${await panel(this).selectedTab()}`);
  const details = await panel(this).readCandidateDetails();
  const basic = (details.sections.find((s) => s.title === 'Basic Information') || { text: '' }).text;
  if (!basic.includes(second.email)) problems.push(`Basic Information does not show ${second.email}`);
  if (basic.includes(first.email)) problems.push(`Basic Information still shows ${first.email}`);
  fail(problems, 'The drawer did not switch cleanly to the second candidate:');
});

When('I close the drawer and reopen the same candidate', { timeout: 180000 }, async function () {
  await panel(this).closeVia('Escape');
  await listing(this).openCandidatePanel(this._candidate.email);
  await panel(this).waitForOpen();
});

Then('the drawer should reopen on Candidate Details', async function () {
  expect(await panel(this).selectedTab()).toBe('Candidate Details');
});

// ==================== End to end ====================

When('I note the candidate listing as it stands', async function () {
  this._dwListing = { url: this.page.url(), rows: (await listing(this).readRows()).map((r) => r.email).filter(Boolean) };
});

Then('the candidate listing should be exactly as it was before the drawer opened', { timeout: 60000 }, async function () {
  expect(await panel(this).staysClosed({ windowMs: 2000 }).then((s) => s.closed), 'the drawer is still open').toBe(true);
  expect(this.page.url()).toBe(this._dwListing.url);
  expect((await listing(this).readRows()).map((r) => r.email).filter(Boolean)).toEqual(this._dwListing.rows);
});

