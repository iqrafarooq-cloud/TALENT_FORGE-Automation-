/* eslint-disable no-console */
// probe-community-candidate.js — discovery for the CANDIDATE side of the Community epic
// (TFF-334). The superadmin probes mapped the admin surface; this one answers what only the
// candidate's own session can show:
//
//   1  Sidebar entry + the BETA badge (TFF-521, still open)
//   2  Community listing: card anatomy, the "Your University" label, and enrolled-first sorting
//   3  Search placeholder and behaviour — name / major / track (TFF-354, on hold)
//   4  Filters: options, multi-select, and whether "Clear all filters" also clears the search
//      input (TFF-356, marked fixed)
//   5  Filter persistence across a refresh (AC 6.3)
//   6  Community detail header, and that no admin control (Edit) leaks into it
//   7  Empty-state copy (AC 8.1 / 8.2 vs what TFF-383 left on DEV)
//   8  Access control: can a candidate reach /community/create or /community/edit/<id>?
//
// Read-only. Creates nothing.
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
const EMAIL = process.env.CANDIDATE_EMAIL;
// NOTE the typo in .env — CANDIDTAE_PASSWORD. Kept as-is; renaming it would break other steps.
const PASSWORD = process.env.CANDIDTAE_PASSWORD || process.env.CANDIDATE_PASSWORD;

const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

async function step(name, fn) {
  try {
    out[name] = await fn();
  } catch (err) {
    out[name] = { error: err.message.split('\n')[0] };
    console.log(`  !! ${name}: ${out[name].error}`);
  }
  console.log(JSON.stringify(out[name], null, 1).slice(0, 5000));
  return out[name];
}

const cardDump = (page) =>
  page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const cards = Array.from(document.querySelectorAll('article,div,li'))
      .filter(vis)
      .filter((e) => /view community/i.test(e.innerText || '') && (e.innerText || '').length < 320);
    cards.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    // Keep only the outermost-unique cards (dedupe nested wrappers by their text).
    const seen = new Set();
    const uniq = [];
    for (const c of cards) {
      const key = t(c);
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(c);
      }
    }
    return {
      count: uniq.length,
      tag: uniq[0] ? uniq[0].tagName : null,
      texts: uniq.map(t).slice(0, 20),
      firstHtml: uniq[0] ? uniq[0].outerHTML.slice(0, 2000) : null,
      yourUniversityLabels: Array.from(document.querySelectorAll('*'))
        .filter((e) => e.children.length === 0 && vis(e) && /your university/i.test(e.textContent || ''))
        .map((e) => t(e)),
      editLinks: document.querySelectorAll('a[href^="/community/edit/"]').length,
    };
  });

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error('Missing CANDIDATE_EMAIL / CANDIDTAE_PASSWORD in .env');
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();
  const api = [];
  page.on('response', (r) => {
    if (/\/api\/v1\/community/.test(r.url())) api.push(`${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')}`);
  });

  hr('LOGIN AS CANDIDATE');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(8000);
  console.log(`landed on ${page.url()}`);

  // ------------------------------------------------------------------------ 1
  hr('1 — SIDEBAR + BETA BADGE (TFF-521)');
  await step('sidebar', () =>
    page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a,button'))
        .filter(vis)
        .map((e) => ({ text: t(e), href: e.getAttribute('href') }))
        .filter((e) => e.text && e.text.length < 40);
      const community = Array.from(document.querySelectorAll('a'))
        .filter(vis)
        .find((a) => /community/i.test(t(a)));
      return {
        links,
        communityLinkText: community ? t(community) : null,
        communityLinkHtml: community ? community.outerHTML.slice(0, 900) : null,
        betaAnywhere: /beta/i.test(document.body.innerText),
      };
    })
  );

  // ------------------------------------------------------------------------ 2
  hr('2 — COMMUNITY LISTING');
  await step('listing', async () => {
    await page.goto(`${ORIGIN}/community`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const cards = await cardDump(page);
    const screen = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return {
        url: location.href,
        headings: Array.from(document.querySelectorAll('h1,h2,h3'))
          .filter(vis)
          .map((h) => `${h.tagName}: ${h.textContent.trim()}`)
          .slice(0, 20),
        inputs: Array.from(document.querySelectorAll('input')).filter(vis).map((i) => ({
          type: i.getAttribute('type'),
          placeholder: i.getAttribute('placeholder'),
        })),
        buttons: Array.from(document.querySelectorAll('button'))
          .filter(vis)
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
        createCta: /create community/i.test(document.body.innerText),
        bodyText: document.body.innerText.slice(0, 1600),
      };
    });
    return { cards, screen };
  });

  // ------------------------------------------------------------------------ 3
  hr('3 — LISTING SEARCH (placeholder + behaviour)');
  await step('listingSearch', async () => {
    const search = page.locator('input[type="search"], input[placeholder]').first();
    const placeholder = await search.getAttribute('placeholder').catch(() => null);
    const res = { placeholder };
    for (const [key, term] of [
      ['partial', 'Arid'],
      ['upper', 'ARID'],
      ['padded', '   Arid   '],
      ['noMatch', 'zzzz-no-such-university'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await search.fill(term);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2500);
      // eslint-disable-next-line no-await-in-loop
      res[key] = await page.evaluate(() => ({
        cards: Array.from(document.querySelectorAll('*')).filter(
          (e) => e.children.length === 0 && /view community/i.test(e.textContent || '')
        ).length,
        empty: document.body.innerText
          .split('\n')
          .filter((l) => /no communit|no results|clear all|couldn't find/i.test(l)),
      }));
    }
    await search.fill('');
    await page.waitForTimeout(1500);
    return res;
  });

  // ------------------------------------------------------------------------ 6
  hr('6 — COMMUNITY DETAIL PAGE (header, no admin controls)');
  await step('detail', async () => {
    const first = page.getByRole('button', { name: /view community/i }).or(page.getByRole('link', { name: /view community/i })).first();
    await first.click({ timeout: 15000 });
    await page.waitForTimeout(4500);
    return page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return {
        url: location.href,
        bodyText: document.body.innerText.slice(0, 1800),
        searchPlaceholders: Array.from(document.querySelectorAll('input'))
          .filter(vis)
          .map((i) => i.getAttribute('placeholder')),
        buttons: Array.from(document.querySelectorAll('button'))
          .filter(vis)
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
        editControls: document.querySelectorAll('a[href*="/community/edit"]').length,
        hasEditCta: /edit community/i.test(document.body.innerText),
        images: Array.from(document.querySelectorAll('img')).filter(vis).length,
      };
    });
  });

  hr('3b — MEMBER SEARCH: name / major / track (AC 5.2 lists all three)');
  await step('memberSearch', async () => {
    const search = page.locator('input[type="search"]').first();
    const placeholder = await search.getAttribute('placeholder').catch(() => null);
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map((h) => h.textContent.trim()).slice(0, 8)
    );
    const res = { placeholder, namesOnPage: names };
    const probe = async (key, term) => {
      await search.fill(term);
      await page.waitForTimeout(2500);
      res[key] = await page.evaluate(() => ({
        cards: Array.from(document.querySelectorAll('*')).filter(
          (e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')
        ).length,
        empty: document.body.innerText.split('\n').filter((l) => /no results|couldn't find|clear all/i.test(l)),
      }));
    };
    const name = (names[1] || names[0] || '').split(' ')[0];
    await probe('byName', name);
    await probe('byNameUpper', name.toUpperCase());
    await probe('byNamePadded', `   ${name}   `);
    await probe('byMajor', 'Accounting');
    await probe('byTrack', 'Marketing');
    await probe('noMatch', 'zzzz-no-such-candidate');
    await search.fill('');
    await page.waitForTimeout(1500);
    return res;
  });

  // ------------------------------------------------------------------------ 4
  hr('4 — FILTERS + does "Clear all filters" clear the SEARCH too (TFF-356)');
  await step('filters', async () => {
    const res = {};
    for (const name of ['Grad Years', 'Grad Year', 'Majors', 'Members']) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape').catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(5, 5).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(800);
      const btn = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
      // eslint-disable-next-line no-await-in-loop
      if (!(await btn.count())) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await btn.click({ timeout: 8000 });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(1800);
        // eslint-disable-next-line no-await-in-loop
        res[name] = await page.evaluate(() => {
          const vis = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
          const pop = Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"]'))
            .filter(vis)
            .sort((a, b) => t(b).length - t(a).length)[0];
          return pop
            ? {
                items: Array.from(pop.querySelectorAll('label')).filter(vis).map(t).filter(Boolean).slice(0, 40),
                checkboxes: pop.querySelectorAll('input[type="checkbox"]').length,
                ctas: Array.from(pop.querySelectorAll('button')).filter(vis).map(t).filter(Boolean),
              }
            : null;
        });
      } catch (e) {
        res[name] = { error: e.message.split('\n')[0] };
      }
    }
    return res;
  });

  await step('clearAllClearsSearch', async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(600);
    const search = page.locator('input[type="search"]').first();
    await search.fill('zzzz-no-such-candidate');
    await page.waitForTimeout(2500);
    // Apply a filter on top of the search.
    const gy = page.getByRole('button', { name: /^grad years?$/i }).first();
    if (await gy.count()) {
      await gy.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.locator('[role="dialog"] label').first().click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape').catch(() => {});
    }
    const before = {
      search: await search.inputValue(),
      clearCtas: await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,a'))
          .map((b) => (b.textContent || '').trim())
          .filter((t) => /clear/i.test(t))
      ),
    };
    const clear = page.getByRole('button', { name: /clear all filters/i }).or(page.getByText(/clear all filters/i)).first();
    if (await clear.count()) await clear.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return {
      before,
      afterSearchValue: await search.inputValue(),
      afterCards: await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('*')).filter(
            (e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')
          ).length
      ),
    };
  });

  // ------------------------------------------------------------------------ 5
  hr('5 — FILTER PERSISTENCE ACROSS A REFRESH (AC 6.3)');
  await step('persistence', async () => {
    const gy = page.getByRole('button', { name: /^grad years?$/i }).first();
    await gy.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const chosen = await page.locator('[role="dialog"] label').first().textContent().catch(() => null);
    await page.locator('[role="dialog"] label').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape').catch(() => {});
    const urlBefore = page.url();
    const cardsBefore = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('*')).filter(
          (e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')
        ).length
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    return {
      chosen: (chosen || '').trim(),
      urlBefore,
      urlAfter: page.url(),
      cardsBefore,
      cardsAfter: await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('*')).filter(
            (e) => e.children.length === 0 && /view profile/i.test(e.textContent || '')
          ).length
      ),
      filterStillShown: await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,a'))
          .map((b) => (b.textContent || '').trim())
          .filter((t) => /clear all/i.test(t))
      ),
    };
  });

  // ------------------------------------------------------------------------ 8
  hr('8 — ACCESS CONTROL: candidate on the superadmin create/edit routes');
  await step('accessControl', async () => {
    const res = {};
    for (const route of ['/community/create', '/community/edit/78']) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(3500);
      // eslint-disable-next-line no-await-in-loop
      res[route] = {
        landedOn: page.url(),
        heading: await page.evaluate(() => {
          const h = document.querySelector('h1,h2');
          return h ? h.textContent.trim() : null;
        }),
        bodySample: await page.evaluate(() => document.body.innerText.slice(0, 300)),
      };
    }
    return res;
  });

  fs.writeFileSync(
    path.join(__dirname, '..', 'reports', 'probe-community-candidate.json'),
    JSON.stringify({ out, api: api.slice(-25) }, null, 2)
  );
  hr('API CALLS');
  console.log(Array.from(new Set(api)).join('\n'));
  hr('DONE — reports/probe-community-candidate.json');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
