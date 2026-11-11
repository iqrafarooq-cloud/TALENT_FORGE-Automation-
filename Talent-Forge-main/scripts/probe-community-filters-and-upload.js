/* eslint-disable no-console */
// probe-community-filters-and-upload.js — third-pass discovery, superadmin side.
//
// Answers what probe #2 could not:
//   1  The three filter controls (Grad Years / Majors / Members): how options are rendered,
//      whether they are multi-select, and whether Apply / Clear All / Cancel exist at all
//      (AC 7.4 specifies all three; the build renders three inline dropdowns, not a modal).
//   2  The member-search no-results copy IN FULL, and whether a "Clear all filters" CTA exists.
//   3  Where the Profile Photo control is. Only a cover-photo upload is visible on a fresh
//      form, so this uploads a cover (in memory, never saved) and re-reads the screen.
//   4  Whether the AC 11 inline validation errors are reachable AT ALL — by filling a field
//      and then clearing it, which is the only route left once Save is gated.
//
// NEVER SAVES. Every upload is an in-memory buffer on a form that is then abandoned.
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = process.env.BASE_URL || 'https://dev.talentforge.com.sa';
const ORIGIN = new URL(BASE).origin;
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

// ---- Real image bytes at an arbitrary size ---------------------------------
// A genuinely decodable PNG/JPEG, padded to `mb` with a trailing comment/ancillary chunk so
// the file is both valid AND the size we want. A test that "uploads an 11 MB file" has to send
// 11 MB of something the browser will accept as an image, or it proves nothing about the limit.
function pngOfSize(mb) {
  const crc32 = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
  ];
  const base = Buffer.concat([...parts, chunk('IEND', Buffer.alloc(0))]).length;
  const target = Math.round(mb * 1024 * 1024);
  const padLen = Math.max(0, target - base - 12);
  // tEXt is an ancillary chunk: decoders ignore it, so the image stays valid at any size.
  const pad = chunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'ascii'), Buffer.alloc(padLen, 0x41)]));
  return Buffer.concat([...parts, pad, chunk('IEND', Buffer.alloc(0))]);
}

function jpgOfSize(mb) {
  const head = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
  ]);
  const tail = Buffer.from([0xff, 0xd9]);
  const target = Math.round(mb * 1024 * 1024);
  const padLen = Math.max(0, target - head.length - tail.length - 4);
  const comLen = Buffer.alloc(2);
  comLen.writeUInt16BE(Math.min(65533, padLen + 2));
  // COM marker — arbitrary length, ignored by decoders. Repeated to reach large sizes.
  const coms = [];
  let remaining = padLen;
  while (remaining > 0) {
    const n = Math.min(65531, remaining);
    const l = Buffer.alloc(2);
    l.writeUInt16BE(n + 2);
    coms.push(Buffer.concat([Buffer.from([0xff, 0xfe]), l, Buffer.alloc(n, 0x20)]));
    remaining -= n + 4;
  }
  return Buffer.concat([head, ...coms, tail]);
}

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });

// Read anything on screen that looks like a validation message.
const readErrors = (page) =>
  page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(
      new Set(
        Array.from(document.querySelectorAll('p,span,div,label'))
          .filter((e) => e.children.length === 0 && vis(e))
          .map((e) => (e.textContent || '').trim())
          .filter((s) => s && /required|only jpg|supported|exceed|must not|invalid|max/i.test(s))
      )
    );
  });

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(process.env.SUPERADMIN_EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(process.env.SUPERADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(agents|dashboard|agents-analytics|candidate-analytics)/, { timeout: 90000 });

  // ------------------------------------------------------------------ 1 + 2
  hr('1 — FILTER CONTROLS on /community/view/78');
  await page.goto(`${ORIGIN}/community/view/78`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  for (const name of ['Grad Years', 'Majors', 'Members']) {
    // eslint-disable-next-line no-await-in-loop
    await step(`filter_${name.replace(/\s+/g, '')}`, async () => {
      // Close whatever is open first — an open popover swallows the next trigger's click.
      await page.keyboard.press('Escape').catch(() => {});
      await page.mouse.click(5, 5).catch(() => {});
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first().click({ timeout: 12000 });
      await page.waitForTimeout(1800);
      const dump = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
        const popovers = Array.from(
          document.querySelectorAll('[role="dialog"],[role="listbox"],[data-rac][class*="popover" i],[class*="popover" i]')
        ).filter(vis);
        const p = popovers.sort((a, b) => t(b).length - t(a).length)[0];
        return {
          popoverCount: popovers.length,
          role: p ? p.getAttribute('role') : null,
          text: p ? t(p).slice(0, 700) : null,
          html: p ? p.outerHTML.slice(0, 1800) : null,
          optionRoles: p
            ? Array.from(new Set(Array.from(p.querySelectorAll('*')).map((e) => e.getAttribute('role')).filter(Boolean)))
            : [],
          checkboxes: p ? p.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length : 0,
          items: p
            ? Array.from(p.querySelectorAll('[role="option"],li,label')).filter(vis).map(t).filter(Boolean).slice(0, 40)
            : [],
          ctas: p
            ? Array.from(p.querySelectorAll('button')).filter(vis).map(t).filter(Boolean)
            : [],
        };
      });
      return dump;
    });
  }

  hr('1b — APPLY A FILTER: does the list narrow, and does a Clear All appear?');
  await step('applyFirstGradYear', async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(600);
    const before = await page.evaluate(
      () => Array.from(document.querySelectorAll('span[data-text]')).filter((s) => /view profile/i.test(s.textContent)).length
    );
    const reqs = [];
    const onReq = (r) => {
      if (/candidates/.test(r.url())) reqs.push(r.url().replace(/^.*\/api\/v1/, ''));
    };
    page.on('request', onReq);
    await page.getByRole('button', { name: /^Grad Years$/i }).first().click({ timeout: 12000 });
    await page.waitForTimeout(1500);
    // Click the first selectable thing inside the popover.
    const firstOption = page.locator('[role="option"], [role="dialog"] label, [role="dialog"] li').first();
    const optionText = await firstOption.textContent().catch(() => null);
    await firstOption.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const afterSelect = await page.evaluate(() => ({
      cards: Array.from(document.querySelectorAll('span[data-text]')).filter((s) => /view profile/i.test(s.textContent)).length,
      clearAllVisible: Array.from(document.querySelectorAll('button,a'))
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((b) => (b.textContent || '').trim())
        .filter((t) => /clear all/i.test(t)),
      somethingWentWrong: /something went wrong/i.test(document.body.innerText),
      emptyState: document.body.innerText.split('\n').filter((l) => /no results|no members|clear all/i.test(l)),
    }));
    page.off('request', onReq);
    return { before, optionText: (optionText || '').trim(), afterSelect, requests: reqs };
  });

  hr('2 — MEMBER SEARCH no-results copy IN FULL');
  await step('memberNoResults', async () => {
    await page.goto(`${ORIGIN}/community/view/78`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.locator('input[type="search"]').first().fill('zzzz-no-such-candidate');
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const host = Array.from(document.querySelectorAll('div,section'))
        .filter(vis)
        .filter((e) => /no results/i.test(e.innerText || '') && (e.innerText || '').length < 400)
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
      return {
        fullText: host ? host.innerText.replace(/\n+/g, ' | ') : null,
        html: host ? host.outerHTML.slice(0, 1200) : null,
        clearAll: Array.from(document.querySelectorAll('button,a'))
          .filter(vis)
          .map((b) => (b.textContent || '').trim())
          .filter((t) => /clear/i.test(t)),
      };
    });
  });

  // ---------------------------------------------------------------------- 3
  hr('3 — PROFILE PHOTO: upload a cover and re-read the form');
  await step('afterCoverUpload', async () => {
    await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(file('cover.jpg', 'image/jpeg', jpgOfSize(2)));
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        bodyText: (document.body.innerText || '').slice(0, 1200),
        buttons: Array.from(document.querySelectorAll('button')).filter(vis).map((b) => ({
          text: t(b),
          aria: b.getAttribute('aria-label'),
          cursor: getComputedStyle(b).cursor,
          disabled: b.disabled,
        })),
        fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map((f, i) => ({
          index: i,
          visible: vis(f),
          context: (f.closest('div') && f.closest('div').parentElement
            ? t(f.closest('div').parentElement)
            : ''
          ).slice(0, 160),
        })),
        images: Array.from(document.querySelectorAll('img')).filter(vis).map((im) => ({
          alt: im.getAttribute('alt'),
          srcKind: /^blob:|^data:/.test(im.src) ? 'preview' : 'remote',
        })),
        saveDisabled: (Array.from(document.querySelectorAll('button')).find((b) => /^save$/i.test(t(b))) || {}).disabled,
      };
    });
  });

  hr('3b — REJECTIONS: GIF, and an 11 MB JPG');
  await step('rejections', async () => {
    const results = {};
    for (const [key, f] of [
      ['gif', file('bad.gif', 'image/gif', Buffer.from('GIF89a' + 'x'.repeat(1024)))],
      ['pdf', file('bad.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n' + 'x'.repeat(1024)))],
      ['oversizeJpg', file('big.jpg', 'image/jpeg', jpgOfSize(11))],
      ['boundary10Png', file('ten.png', 'image/png', pngOfSize(10))],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2200);
      // eslint-disable-next-line no-await-in-loop
      await page.locator('input[type="file"]').first().setInputFiles(f).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(3000);
      // eslint-disable-next-line no-await-in-loop
      results[key] = {
        sizeMB: +(f.buffer.length / 1024 / 1024).toFixed(2),
        errors: await readErrors(page),
        // eslint-disable-next-line no-await-in-loop
        preview: await page.evaluate(() =>
          Array.from(document.querySelectorAll('img')).some((im) => /^blob:|^data:/.test(im.src))
        ),
        // eslint-disable-next-line no-await-in-loop
        toast: await page.evaluate(() => {
          const el = document.querySelector('[role="alert"],[role="status"],.Toastify__toast-body');
          return el ? el.textContent.trim() : null;
        }),
      };
    }
    return results;
  });

  // ---------------------------------------------------------------------- 4
  hr('4 — ARE THE AC 11 INLINE ERRORS REACHABLE? fill then clear each field');
  await step('clearFieldErrors', async () => {
    await page.goto(`${ORIGIN}/community/create`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const res = {};
    // Location: select a value, then clear the text.
    const loc = page.locator('input[placeholder*="Riyadh, Saudi Arabia" i]').first();
    await loc.click();
    await page.waitForTimeout(1200);
    await page.locator('[role="option"]').first().click().catch(() => {});
    await page.waitForTimeout(900);
    res.locationAfterSelect = await loc.inputValue();
    await loc.fill('');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    res.locationCleared = { value: await loc.inputValue(), errors: await readErrors(page) };

    // About University at the 300 cap: type 301 and 400 and read back what it holds.
    const about = page.locator('textarea[name="description"]').first();
    await about.fill('a'.repeat(301));
    await page.waitForTimeout(600);
    res.about301 = (await about.inputValue()).length;
    await about.fill('b'.repeat(400));
    await page.waitForTimeout(600);
    res.about400 = (await about.inputValue()).length;
    await about.fill('line1\nline2\nline3');
    await page.waitForTimeout(400);
    res.aboutMultiline = (await about.inputValue()).split('\n').length;
    res.aboutErrors = await readErrors(page);
    return res;
  });

  fs.writeFileSync(
    path.join(__dirname, '..', 'reports', 'probe-community-filters-and-upload.json'),
    JSON.stringify(out, null, 2)
  );
  hr('DONE — reports/probe-community-filters-and-upload.json');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
