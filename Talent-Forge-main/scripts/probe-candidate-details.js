// Read-only probe: the Candidate Portal's Profile > Candidate Details tab.
//
// SAVES NOTHING. Every modal it opens it cancels, and it never clicks Save or a delete icon.
// Run it rather than reasoning about the DOM - every string, label, accept attribute and API
// field name in pages/CandidateDetailsPage.js and in Candidate-Details.feature came from this
// script's output.
//
// The mutating half - what a save actually sends, whether it persists, and whether deleting an
// entry takes its document with it - is scripts/probe-candidate-details-mutations.js, which is
// deliberately a separate file because it writes.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

const J = (o) => JSON.stringify(o, null, 1);
const EMAIL = process.env.CANDIDATE_DETAILS_EMAIL || process.env.CONTACTUS_EMAIL;
const PASSWORD = process.env.CANDIDATE_DETAILS_PASSWORD || process.env.CONTACTUS_PASSWORD;

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  // >= 1440px: the profile renders a narrower layout below that and the sections move.
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();

  const api = [];
  page.on('request', (r) => {
    if (/\/api\/v1\//.test(r.url())) api.push(`${r.method()} ${decodeURIComponent(r.url()).replace(/^.*\/api\/v1/, '')}`);
  });
  let profilePayload = null;
  page.on('response', async (r) => {
    if (/\/candidate\/profile\/me\/$/.test(r.url()) && r.request().method() === 'GET' && r.ok()) {
      try { profilePayload = await r.json(); } catch { /* body consumed elsewhere */ }
    }
  });

  const login = new LoginPage(page);
  await login.navigate();
  await login.emailInput.first().fill(EMAIL);
  await login.passwordInput.first().fill(PASSWORD);
  await login.submitButton.first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000, waitUntil: 'commit' });

  const origin = (process.env.BASE_URL || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
  await page.goto(origin + '/profile?selectedTab=candidate-details');
  await page.getByText('Basic Information', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('=== 0. ACCOUNT ===', EMAIL);

  console.log('\n=== 1. PAGE CHROME ===');
  console.log('url:', page.url());
  console.log('tabs:', J(await page.locator('[role="radio"]').evaluateAll((rs) => rs.map((r) => ({ name: r.textContent.trim(), checked: r.getAttribute('aria-checked') })))));
  console.log('first 8 main buttons:', J(await page.locator('main button').evaluateAll((bs) => bs.slice(0, 8).map((b) => ({ text: (b.innerText || '').trim().slice(0, 30), aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid') })))));
  const mainText = await page.locator('main').first().innerText();
  console.log('verified badge:', (mainText.match(/\b(Verified|Unverified)\b/) || ['(none)'])[0]);
  console.log('stat widgets:', J(await page.evaluate(() => [...document.querySelectorAll('p')]
    .filter((p) => ['Track Progress', 'Courses Completed', 'Hours Learned', 'Certificates Earned'].includes(p.textContent.trim()))
    .map((p) => ({ label: p.textContent.trim(), value: p.previousElementSibling && p.previousElementSibling.textContent.trim() })))));

  console.log('\n=== 2. SECTIONS (title -> icons, entry count) ===');
  console.log(J(await page.evaluate(() => [...document.querySelectorAll('main')].map((m) => {
    const head = m.previousElementSibling;
    const title = head && head.querySelector('p') && head.querySelector('p').textContent.trim();
    if (!title) return null;
    return { title, icons: [...head.querySelectorAll('svg')].map((s) => s.getAttribute('class')), entries: m.children[0] ? m.children[0].children.length : 0 };
  }).filter(Boolean))));

  console.log('\n=== 3. RENDERED VALUES, AND WHAT AN EMPTY FIELD LOOKS LIKE ===');
  console.log(J(await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('main')].forEach((m) => {
      const h = m.previousElementSibling && m.previousElementSibling.querySelector('p');
      if (h) out[h.textContent.trim()] = m.innerText.split('\n').filter(Boolean).slice(0, 14);
    });
    return out;
  })));

  console.log('\n=== 4. API PAYLOAD -> the fields the tab renders ===');
  if (profilePayload) {
    const p = profilePayload;
    console.log(J({
      'user.firstname/lastname': [p.user && p.user.firstname, p.user && p.user.lastname],
      'user.email': p.user && p.user.email,
      'user.phone_number': p.user && p.user.phone_number,
      'user.nationality': p.user && p.user.nationality,
      'user.profile_image': p.user && p.user.profile_image,
      qualification: p.qualification,
      headline: (p.headline || '').slice(0, 40),
      about_me: (p.about_me || '').slice(0, 40),
      is_verified: p.is_verified,
      stats: p.stats,
      educations: (p.educations || []).map((e) => ({ id: e.id, institution: e.institution_name, degree: e.degree_details && e.degree_details.name, field: e.field_of_study && e.field_of_study.name, start: e.start_date, end: e.end_date, doc: e.document && { id: e.document.id, name: e.document.file_name, status: e.document.status } })),
      work_experiences: (p.work_experiences || []).map((w) => ({ id: w.id, company: w.company_name, experience: w.experience, designation: w.designation, start: w.start_date, end: w.end_date, is_current: w.is_current, doc: w.document && w.document.id })),
      certifications: (p.certifications || []).map((c) => ({ id: c.id, name: c.certificate_name, org: c.issuing_organization, issue: c.issue_date, expiry: c.expiry_date, doc: c.document && c.document.id })),
      roles: (p.roles || []).map((r) => r.name),
      current_location: p.current_location,
      preferred_locations: p.preferred_locations,
      is_co_op_preferred: p.is_co_op_preferred,
      interested_in_tamheer: p.interested_in_tamheer,
      interested_in_relocation: p.interested_in_relocation,
    }));
  } else {
    console.log('(profile payload not captured - reload and re-run)');
  }

  console.log('\n=== 5. EVERY MODAL CONTRACT (opened, read, CANCELLED) ===');
  const closeModal = async () => {
    const d = page.locator('[role="dialog"]').last();
    if (!(await d.count())) return;
    const cancel = d.getByRole('button', { name: /^Cancel$/ });
    if (await cancel.count()) await cancel.click();
    else await d.locator('header svg').first().dispatchEvent('click');
    await page.waitForTimeout(1000);
  };
  const iconMap = await page.locator('svg.add-icon, svg.edit-icon').evaluateAll((ss) => ss.map((s, i) => ({ i, cls: s.getAttribute('class') })));
  for (const entry of iconMap) {
    await page.locator('svg.add-icon, svg.edit-icon').nth(entry.i).dispatchEvent('click');
    await page.waitForTimeout(1800);
    const d = page.locator('[role="dialog"]').last();
    if (!(await d.count())) { console.log('icon ' + entry.i + ' (' + entry.cls + ') -> NO DIALOG'); continue; }
    const title = await d.locator('.modal-title').first().innerText().catch(() => '(no title)');
    console.log('\n--- icon ' + entry.i + ' (' + entry.cls + ') -> "' + title + '" ---');
    console.log('fields:', J(await d.locator('input,textarea,select').evaluateAll((els) => els.map((e) => ({
      tag: e.tagName, type: e.type, role: e.getAttribute('role'), name: e.getAttribute('name'),
      label: e.labels && e.labels[0] ? e.labels[0].textContent.trim().slice(0, 45) : null,
      ph: e.placeholder || null, accept: e.getAttribute('accept'), maxlength: e.getAttribute('maxlength'),
      disabled: e.disabled,
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 6) : undefined,
    })))));
    console.log('buttons:', J(await d.locator('button').evaluateAll((bs) => bs.map((b) => ({ t: (b.innerText || '').trim().slice(0, 25), disabled: b.disabled })).filter((b) => b.t))));
    console.log('svg classes inside:', J(await d.evaluate((el) => {
      const counts = {};
      el.querySelectorAll('svg').forEach((s) => { const c = s.getAttribute('class') || '(none)'; counts[c] = (counts[c] || 0) + 1; });
      return counts;
    })));
    await closeModal();
  }

  console.log('\n=== 6. ACCESSIBILITY: what the section controls actually are ===');
  console.log(J(await page.evaluate(() => {
    const icons = [...document.querySelectorAll('svg.add-icon, svg.edit-icon')];
    return {
      total: icons.length,
      wrappedInButton: icons.filter((s) => s.closest('button')).length,
      withRole: icons.filter((s) => s.getAttribute('role')).length,
      withAriaLabel: icons.filter((s) => s.getAttribute('aria-label')).length,
      withTabindex: icons.filter((s) => s.hasAttribute('tabindex')).length,
      withTestid: icons.filter((s) => s.getAttribute('data-testid')).length,
    };
  })));

  console.log('\n=== 7. TAB SWITCHING: does the URL follow? ===');
  for (const t of ['Documents', 'Subscription', 'Activity Log', 'Candidate Details']) {
    await page.locator('[role="radio"]').filter({ hasText: t }).first().click();
    await page.waitForTimeout(1500);
    console.log(t.padEnd(18) + ' -> ' + page.url());
  }

  console.log('\n=== 8. DEEP LINK / UNKNOWN TAB VALUE ===');
  for (const v of ['documents', 'candidate-details', 'not-a-tab', '']) {
    await page.goto(origin + '/profile?selectedTab=' + v);
    await page.waitForTimeout(2500);
    const checked = await page.locator('[role="radio"][aria-checked="true"]').first().innerText().catch(() => '(none)');
    console.log(('?selectedTab=' + (v || '(empty)')).padEnd(30) + ' -> checked tab: ' + checked);
  }

  console.log('\n=== 9. API CALLS THE PAGE MADE ===');
  console.log(J([...new Set(api)]));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
