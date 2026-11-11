const BasePage = require('./BasePage');
const { imageFile } = require('../utils/imageFixtures');

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// CommunityFormPage — the SUPERADMIN's Create (/community/create) and Edit
// (/community/edit/<id>) screens. One Page Object for both: they are the same form with the
// same five fields, the same validation and the same Save gating, differing only in whether
// the university is changeable and whether the CTA saves or updates. Two objects would have to
// be kept in step for `Verify that Edit enforces the same validation rules as Create` to mean
// anything.
//
// FOUR THINGS ABOUT THIS FORM THAT THE AC DOES NOT MENTION, all live-verified 2026-07-31 and
// all of which a naive Page Object gets wrong:
//
//   1. Uploading an image opens a CROP MODAL ("Upload community cover photo." / Cancel / Save).
//      Nothing reaches the form until that modal is confirmed, so an upload helper that just
//      calls setInputFiles and returns leaves the form untouched and every later assertion
//      fails for the wrong reason.
//   2. The Profile Photo control is button[aria-label="Upload community logo"] and carries no
//      visible label naming it "Profile Photo" — so it cannot be found by its AC name.
//   3. Image validation errors arrive as TOASTS, not inline (AC 11 says inline). The reader
//      therefore collects BOTH and reports which surface carried the message, so the
//      @known-issue scenario can fail on the right thing instead of on "no error found".
//   4. Requiredness must be read from a VISIBLE asterisk. About University ships
//      `<span class="hidden">*</span>`, so a textContent check calls an optional field
//      required — the exact opposite of AC 3.1 E.
class CommunityFormPage extends BasePage {
  constructor(page) {
    super(page);
    const origin = new URL(process.env.BASE_URL || 'https://dev.talentforge.com.sa').origin;
    this.origin = origin;
    this.createUrl = `${origin}/community/create`;

    this.heading = page.getByRole('heading', { name: /create a community|edit community/i }).first();

    // ---- Image controls ----
    //
    // NEVER `getByRole('button', …)` FOR THESE, AND THIS IS THE MOST EXPENSIVE MISTAKE THIS FILE
    // HAS MADE. Chromium reports role="button" for `<input type="file">`, and the input's
    // accessible name comes from its associated <label> — so
    // `getByRole('button', { name: /upload cover photo/i })` matched the form's 1x1
    // `<input id="_r_0_" class="peer sr-only" type="file">` as well as the real <button>, and
    // `.or(…).first()` resolves in DOM ORDER (not in the order the branches are written), so the
    // sr-only input won every time. Measured live 2026-08-03
    // (scripts/probe-community-cover-control.js): coverUploadButton resolved to that input, whose
    // hit target at its centre is a `<span>` — so the click could never satisfy Playwright's
    // hit-target check and was RETRIED FOR THE FULL 10s TIMEOUT, calling scrollIntoViewIfNeeded on
    // every retry. That is the whole of the "the Create Community page just scrolls up and down"
    // report: 10 scroll events with 8 direction reversals, and ~14s of dead time, on every single
    // cover upload — then swallowed by a `.catch(() => {})` so nothing said it had happened.
    // Restricted to real <button> elements, the same click opens the picker in ~51ms.
    //
    // The two screens label the cover control differently and BOTH have to be here: Create
    // renders `<button>Click to upload cover photo</button>`, Edit renders
    // `<button>Change photo</button>` (measured on /community/create and /community/edit/78). The
    // old locator matched nothing at all on Edit, which is why every edit upload silently fell
    // through to the setInputFiles fallback.
    this.coverUploadButton = page
      .locator('[data-testid="community-cover-upload"]')
      .or(page.locator('button').filter({ hasText: /upload cover photo/i }))
      .or(page.locator('button').filter({ hasText: /^change photo$/i }))
      .first();
    this.logoUploadButton = page
      .locator('[data-testid="community-logo-upload"]')
      .or(page.locator('button[aria-label*="logo" i]'))
      .or(page.locator('button[aria-label*="profile photo" i]'))
      .first();
    this.fileInputs = page.locator('input[type="file"]');
    this.uploadHint = page.getByText(/JPG,\s*PNG/i).first();

    // ---- Crop / confirm modal ----
    // Re-measured 2026-11-02: the COVER crop dialog is now headed "Adjust Cover Photo" while the
    // logo's still reads "Upload community profile photo.", and both carry crop test ids. Matching
    // only /upload community/ never found the cover's dialog, so every cover upload read as refused.
    this.cropModal = page
      .locator('[role="dialog"]')
      .filter({ has: page.locator('[data-testid^="admin-community-crop-"]') })
      .or(page.locator('[role="dialog"]').filter({ hasText: /upload community|adjust (cover|logo|profile)/i }))
      .first();
    this.cropSave = this.cropModal.getByRole('button', { name: /^save$/i }).first();
    this.cropCancel = this.cropModal.getByRole('button', { name: /^cancel$/i }).first();

    // ---- Text / dropdown fields ----
    this.universityInput = page
      .locator('[data-testid="community-university"]')
      .or(page.locator('input[placeholder*="Select University" i]'))
      .or(page.locator('input[role="combobox"]').first())
      .first();
    this.locationInput = page
      .locator('[data-testid="community-location"]')
      .or(page.locator('input[placeholder*="Riyadh, Saudi Arabia" i]'))
      .or(page.locator('input[role="combobox"]').nth(1))
      .first();
    this.aboutInput = page
      .locator('[data-testid="community-about"]')
      .or(page.locator('textarea[name="description"]'))
      .or(page.locator('textarea'))
      .first();

    this.options = page.locator('[role="option"]');
    // Save is the form's submit; the crop modal also renders a "Save", hence the type filter.
    this.saveButton = page
      .locator('[data-testid="community-save"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.getByRole('button', { name: /^save( changes)?$/i }))
      .first();
    this.exitButton = page.getByRole('button', { name: /^exit$/i }).or(page.getByRole('link', { name: /^exit$/i })).first();

    // ---- Success modal (AC 3.3) ----
    this.successModal = page.locator('[role="dialog"]').filter({ hasText: /community created/i }).first();
  }

  // ==================== Navigation ====================

  async gotoCreate() {
    await super.navigate(this.createUrl);
    await this.ready();
  }

  async gotoEdit(id) {
    await super.navigate(`${this.origin}/community/edit/${id}`);
    await this.ready();
  }

  async ready() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await this.universityInput.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
    await this.settle();
  }

  async settle(ms = 800) {
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  isOnCreate() {
    return /\/community\/create/.test(this.page.url());
  }

  editingId() {
    const m = this.page.url().match(/\/community\/edit\/(\d+)/);
    return m ? m[1] : null;
  }

  // ==================== Field inventory ====================

  // Reads every field's presence, requiredness and placeholder in one pass. Requiredness comes
  // from a VISIBLE asterisk — see note 4 in the class comment.
  async readFields() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const labels = Array.from(document.querySelectorAll('label')).map((l) => ({
        text: clean(l.textContent).replace(/\*$/, '').trim(),
        requiredVisible: Array.from(l.querySelectorAll('*'))
          .filter((e) => /^\*$/.test((e.textContent || '').trim()))
          .some(vis),
      }));
      const inputs = Array.from(document.querySelectorAll('input,textarea')).map((i) => ({
        type: i.getAttribute('type'),
        name: i.getAttribute('name'),
        placeholder: i.getAttribute('placeholder'),
        accept: i.getAttribute('accept'),
        maxlength: i.getAttribute('maxlength'),
        visible: vis(i),
      }));
      const uploadButtons = Array.from(document.querySelectorAll('button'))
        .filter(vis)
        .map((b) => ({ text: clean(b.textContent), aria: b.getAttribute('aria-label') }))
        .filter((b) => /upload|photo|logo/i.test(`${b.text} ${b.aria || ''}`));
      return { labels, inputs, uploadButtons, hint: clean((document.body.innerText.match(/JPG,\s*PNG[^\n]*/i) || [])[0] || '') };
    });
  }

  // ==================== Images ====================

  // `field` is the AC's name ("Cover Photo" / "Profile Photo"); `method` is 'picker' or
  // 'drag and drop'.
  //
  // Returns { accepted, error, errorSurface } rather than throwing on rejection — the caller
  // decides whether a rejection is the pass or the fail, and a helper that threw would make the
  // negative scenarios unwritable.
  // `variant` picks between several real photographs registered at the same size, so a
  // replacement upload can send genuinely different bytes from the original.
  async uploadImage(field, format, sizeMb, method = 'picker', variant = 0) {
    const file = imageFile(format, sizeMb, field.toLowerCase().includes('profile') ? 'logo' : 'cover', variant);
    const isProfile = /profile|logo/i.test(field);

    // A crop modal left open from a previous upload sits over everything, so the next upload's
    // click lands on its backdrop and silently does nothing. That is exactly how a whole
    // profile-photo upload went missing while still reporting success.
    await this.dismissCropIfOpen();

    // What is ALREADY on screen before this file is sent. Every row of the reject table leaves a
    // toast behind, and without this baseline the next row reads its predecessor's toast as its
    // own verdict.
    const baseline = (await this.readValidationError()).message;

    let cropHeading = null;
    this.lastCropImageReady = null;
    if (method === 'drag and drop') {
      await this.dropFile(isProfile, file);
      cropHeading = await this.waitForCropModal(5000, baseline);
    } else {
      cropHeading = await this.setFileOnTheRightInput(isProfile, file, baseline);
    }

    // A valid file opens the crop modal; an invalid one raises a toast and opens nothing.
    const confirmed = cropHeading ? await this.confirmCrop() : false;
    const error = await this.readValidationError();
    const preview = await this.hasPreview(field);
    return {
      // Honest: a crop modal that APPEARED proves nothing — it has to have been confirmed and
      // left a preview behind. Treating "the modal opened" as success is what let a failed
      // upload report as accepted.
      accepted: !error.message && confirmed && preview,
      cropModalAppeared: !!cropHeading,
      cropHeading,
      cropConfirmed: confirmed,
      // Reported so a red row can be read without re-running anything. `cropImageReady: false`
      // means the cropper never decoded the file — a very different finding from "the app raised
      // a validation error", and previously indistinguishable from it.
      cropImageReady: this.lastCropImageReady,
      pickerFailure: this.lastPickerFailure || null,
      previewShown: preview,
      error: error.message,
      errorSurface: error.surface,
      sizeBytes: file.buffer.length,
      fileName: file.name,
      // 'real' = one of the checked-in photographs, 'generated' = built in memory. Reported so a
      // red row says which bytes it sent without anyone having to reason about the registry.
      fileSource: file.source,
    };
  }

  // Which hidden <input type=file> belongs to which control is not discoverable from the DOM —
  // they are unlabelled siblings, and the visible one is the cover's drop zone. So the file is
  // set on a candidate input and the CROP MODAL'S OWN HEADING is read back: it says which image
  // it is cropping ("Upload community cover photo."). A wrong match is cancelled and the next
  // input tried. This is the only self-verifying route; picking by index is a guess that fails
  // silently the day the markup gains an input.
  async setFileOnTheRightInput(isProfile, file, baseline = null) {
    // The picker route first — it is what a user does, and it needs no guessing at all.
    //
    // The click timeout is deliberately SHORT. With the corrected locators above the picker opens
    // in ~51ms, so a click that has not produced a chooser within 4s has not resolved to a
    // clickable control at all and every further second is Playwright retrying and re-scrolling.
    // The old 10s/6s pair meant a mis-resolved locator cost 10 seconds of scroll thrash per
    // upload — and `.catch(() => {})` hid it, so the run looked merely slow. `pickerFailure` is
    // recorded instead of swallowed, so a locator that stops working says so in the report.
    this.lastPickerFailure = null;
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
      (isProfile ? this.logoUploadButton : this.coverUploadButton)
        .click({ timeout: 4000 })
        .catch((e) => { this.lastPickerFailure = e.message.split('\n')[0]; }),
    ]);
    if (chooser) {
      await chooser.setFiles(file);
      const heading = await this.waitForCropModal(5000, baseline);
      if (!heading || this.headingMatches(heading, isProfile)) return heading;
      await this.dismissCropIfOpen();
    }

    const count = await this.fileInputs.count();
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.fileInputs.nth(i).setInputFiles(file).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      const heading = await this.waitForCropModal(5000, baseline);
      // No modal at all means the file was rejected — the error reader will say why.
      if (!heading) return null;
      if (this.headingMatches(heading, isProfile)) return heading;
      // eslint-disable-next-line no-await-in-loop
      await this.dismissCropIfOpen();
    }
    return null;
  }

  headingMatches(heading, isProfile) {
    return isProfile ? /logo|profile/i.test(heading) : /cover/i.test(heading);
  }

  // Wait for the crop modal to APPEAR and return its heading, or null once it is clear the file
  // was refused.
  //
  // This replaced a flat `waitForTimeout(1600)`, which was wrong in both directions. Measured
  // live 2026-08-03 (scripts/probe-community-crop-modal.js): the modal appears at +1336ms and the
  // cropper's image finishes decoding at +1790ms — so 1600ms landed BETWEEN the two, the worst
  // possible moment to read. A valid upload could be judged rejected, and a rejected one always
  // cost the full 1600ms for nothing.
  //
  // IT RACES THE REJECTION rather than waiting the modal out. A plain
  // `waitFor({state:'visible'})` is correct for an accepted file and a pure tax on a rejected one
  // — and the reject table has eight rows, so a naive 8s wait would add over a minute to that one
  // scenario. An error the app has JUST raised means no modal is coming, so the wait ends there.
  //
  // `baseline` is the error already on screen before the file was set. Without it a toast left
  // over from the previous row would be read as this row's rejection, and a file that WAS about
  // to be accepted would be reported as refused — the same class of bug as reading a preview
  // belonging to the other field.
  async waitForCropModal(timeout = 5000, baseline = null) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.cropModal.isVisible().catch(() => false)) return this.cropHeading();
      // eslint-disable-next-line no-await-in-loop
      const err = await this.readValidationError();
      if (err.message && err.message !== baseline) return null;
      // eslint-disable-next-line no-await-in-loop
      await this.page.waitForTimeout(150);
    }
    return null;
  }

  // Whether the cropper has actually MOUNTED AND DECODED its image.
  //
  // Load-bearing, because the modal's Save is enabled from the moment it opens (+1336ms) while
  // the image is not decoded until +1790ms — so "Save is clickable" is not "the cropper is
  // ready", and a Save clicked in that window is a no-op that leaves the modal sitting over the
  // form swallowing every later click. confirmCrop() then absorbed an 8000ms
  // waitFor({state:'hidden'}) before retrying: 8 seconds of dead time per upload, with the modal
  // re-scrolled into view on each attempt. Waiting on the image instead makes ONE click enough —
  // measured, a Save clicked after this returns closes the modal in 258ms.
  async cropImageReady(timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const ready = await this.cropModal
        .evaluate((el) => {
          const imgs = Array.from(el.querySelectorAll('img'));
          if (imgs.some((i) => i.complete && i.naturalWidth > 0)) return true;
          // Some croppers paint to a canvas instead of an <img>; a sized canvas is the same
          // signal. Checked second so the <img> case, which is what this build uses, wins.
          return Array.from(el.querySelectorAll('canvas')).some((c) => c.width > 1 && c.height > 1);
        })
        .catch(() => false);
      if (ready) return true;
      // eslint-disable-next-line no-await-in-loop
      await this.page.waitForTimeout(150);
    }
    return false;
  }

  async cropHeading() {
    if (!(await this.cropModal.count())) return null;
    if (!(await this.cropModal.isVisible().catch(() => false))) return null;
    const text = await this.cropModal.innerText().catch(() => '');
    const line = text.split('\n').map((s) => s.trim()).find((s) => /upload/i.test(s));
    return line || text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // A genuine drag-and-drop: builds a DataTransfer in the page and dispatches the same three
  // events a real drop fires. setInputFiles would exercise the picker path a second time and
  // tell us nothing about the drop zone, which the AC lists as its own behaviour.
  async dropFile(isProfile, file) {
    const target = isProfile ? this.logoUploadButton : this.coverUploadButton;
    const box = await target.boundingBox().catch(() => null);
    await this.page.evaluate(
      async ({ b64, name, mimeType, x, y }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const f = new File([bytes], name, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(f);
        const el = document.elementFromPoint(x, y) || document.body;
        for (const type of ['dragenter', 'dragover', 'drop']) {
          el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
      },
      {
        b64: file.buffer.toString('base64'),
        name: file.name,
        mimeType: file.mimeType,
        x: box ? box.x + box.width / 2 : 200,
        y: box ? box.y + box.height / 2 : 200,
      }
    );
  }

  // Confirm the crop and VERIFY THE MODAL CLOSED. The cropper mounts its image asynchronously,
  // so a Save clicked too early is a no-op that leaves the modal sitting there — which then
  // swallows every later click on the form. Retried, and the return value says what happened
  // rather than assuming it worked.
  //
  // WAITING ON THE IMAGE IS WHAT MAKES THE RETRIES RARE rather than routine. This used to click
  // Save as soon as it was visible, which is ~450ms before the cropper has decoded anything, so
  // the first click was usually wasted and the loop then sat in an 8000ms `waitFor hidden` before
  // trying again. The retry loop is kept — a cropper that stalls is still a real possibility and
  // the caller must be told — but the hidden-wait is now 4s, because a Save clicked on a READY
  // cropper closes the modal in ~258ms and anything past a second or two is a genuine stall
  // rather than a race this helper created for itself.
  async confirmCrop(attempts = 3) {
    for (let i = 0; i < attempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await this.cropModal.isVisible().catch(() => false))) return true;
      // eslint-disable-next-line no-await-in-loop
      this.lastCropImageReady = await this.cropImageReady();
      // eslint-disable-next-line no-await-in-loop
      await this.cropSave.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await this.cropSave.click({ timeout: 8000 }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      const closed = await this.cropModal.waitFor({ state: 'hidden', timeout: 4000 }).then(() => true).catch(() => false);
      if (closed) {
        // eslint-disable-next-line no-await-in-loop
        await this.settle(600);
        return true;
      }
      // eslint-disable-next-line no-await-in-loop
      await this.page.waitForTimeout(800);
    }
    return false;
  }

  // Get the modal out of the way whatever state it is in — Cancel, then the close control, then
  // Escape. Used before every upload so a leftover modal cannot swallow the next click.
  async dismissCropIfOpen() {
    if (!(await this.cropModal.count())) return false;
    if (!(await this.cropModal.isVisible().catch(() => false))) return false;
    await this.cropCancel.click({ timeout: 6000 }).catch(() => {});
    if (await this.cropModal.isVisible().catch(() => false)) {
      await this.cropModal.getByRole('button', { name: /close/i }).first().click({ timeout: 4000 }).catch(() => {});
    }
    if (await this.cropModal.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    await this.cropModal.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
    await this.settle(500);
    return true;
  }

  // Every preview on the form, each already attributed to "cover" or "logo".
  //
  // WHY THIS IS SHARED. Both hasPreview() and removeImage() need the same question answered —
  // which preview belongs to which field — and answering it twice, differently, is how the two
  // drifted apart: hasPreview('Cover Photo') used to return true if ANY preview existed, so a
  // cover that had just been REMOVED still read as present because the logo was on screen.
  //
  // HOW A PREVIEW IS ATTRIBUTED, in order of how much it can be trusted:
  //   1. Its own URL, on the edit form — the app serves the two from different paths
  //      (community/background-images vs community/logos). Unambiguous where available.
  //   2. Its shape, on the create form, where both are blob: URLs that say nothing. Measured
  //      live 2026-08-01 (scripts/probe-community-image-remove.js): the cover spans the form
  //      at 572 x 144 inside the dashed drop zone, the logo is square at 117 x 117 in the
  //      avatar well beneath it. Width separates them with room to spare, so the threshold is
  //      set between the two rather than at either edge.
  async imagePreviews() {
    return this.page.evaluate((coverMinWidth) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return Array.from(document.querySelectorAll('img'))
        .filter(vis)
        .filter((i) => /^blob:|^data:/.test(i.src) || /community\/(logos|background-images)/.test(i.src))
        .map((i) => {
          const r = i.getBoundingClientRect();
          const byUrl = /community\/logos/.test(i.src)
            ? 'logo'
            : (/community\/background-images/.test(i.src) ? 'cover' : null);
          return {
            field: byUrl || (r.width >= coverMinWidth ? 'cover' : 'logo'),
            attributedBy: byUrl ? 'url' : 'width',
            box: { x: r.x, y: r.y, w: r.width, h: r.height },
          };
        });
    }, CommunityFormPage.COVER_PREVIEW_MIN_WIDTH);
  }

  async hasPreview(field) {
    const want = /profile|logo/i.test(field || '') ? 'logo' : 'cover';
    const previews = await this.imagePreviews();
    return previews.some((p) => p.field === want);
  }

  // Controls that appear once an image is present (TFF-272 asked for both plus a pointer
  // cursor). Returns the cursor so the assertion can read it rather than assume it.
  async imageControls() {
    return this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('button,a'))
        .filter(vis)
        .map((b) => ({
          text: clean(b.textContent),
          aria: b.getAttribute('aria-label'),
          cursor: getComputedStyle(b).cursor,
        }))
        .filter((b) => /change|edit|remove|delete/i.test(`${b.text} ${b.aria || ''}`));
    });
  }

  // Remove ONE field's image.
  //
  // The button is bound to the field by GEOMETRY, not by DOM order. Both fields render a button
  // reading exactly "Remove photo", so `nth(0)` for cover and `nth(1)` for logo was a guess —
  // the same "picking by index is a guess that fails silently" trap that setFileOnTheRightInput
  // above exists to avoid, and it would remove the wrong image the day the markup reorders
  // without failing, because a preview would still disappear.
  //
  // Each field's remove button sits INSIDE its own preview's box (measured live 2026-08-01:
  // cover's at 805,280 within the cover preview's 514..1086 x 224..368; the logo's at 531,369
  // within 524..641 x 324..441). The match is made in the page, the winner is tagged, and the
  // click then goes through Playwright so it still waits for actionability.
  async removeImage(field) {
    const want = /profile|logo/i.test(field) ? 'logo' : 'cover';
    const TAG = 'data-qa-remove-target';

    const found = await this.page.evaluate(({ target, tag, coverMinWidth }) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      document.querySelectorAll(`[${tag}]`).forEach((el) => el.removeAttribute(tag));

      const preview = Array.from(document.querySelectorAll('img'))
        .filter(vis)
        .filter((i) => /^blob:|^data:/.test(i.src) || /community\/(logos|background-images)/.test(i.src))
        .map((i) => {
          const r = i.getBoundingClientRect();
          const byUrl = /community\/logos/.test(i.src)
            ? 'logo'
            : (/community\/background-images/.test(i.src) ? 'cover' : null);
          return { field: byUrl || (r.width >= coverMinWidth ? 'cover' : 'logo'), r };
        })
        .find((p) => p.field === target);
      if (!preview) return { ok: false, why: `no ${target} preview is on screen to remove` };

      const buttons = Array.from(document.querySelectorAll('button,a'))
        .filter(vis)
        .filter((b) => /remove|delete/i.test(`${clean(b.textContent)} ${b.getAttribute('aria-label') || ''}`));
      if (!buttons.length) return { ok: false, why: 'no remove control is rendered at all' };

      const inside = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        return cx >= preview.r.x && cx <= preview.r.x + preview.r.width
          && cy >= preview.r.y && cy <= preview.r.y + preview.r.height;
      });
      if (inside.length !== 1) {
        return {
          ok: false,
          why: `${inside.length} remove controls lie within the ${target} preview, so the one that `
            + `owns it is ambiguous (${buttons.length} on the form in total)`,
        };
      }
      inside[0].setAttribute(tag, '1');
      return { ok: true };
    }, { target: want, tag: TAG, coverMinWidth: CommunityFormPage.COVER_PREVIEW_MIN_WIDTH });

    if (!found.ok) {
      this.lastRemoveFailure = found.why;
      return false;
    }
    // Re-measured 2026-11-02: the logo's Remove is `pointer-events-none group-hover:pointer-events-auto`
    // - it only takes clicks while the pointer is over the logo, so the pointer is moved there first,
    // the way a user reveals it.
    const target = this.page.locator(`[${TAG}]`);
    const box = await target.boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.waitForTimeout(300);
    }
    await target.click({ timeout: 10000 });
    await this.settle(800);
    await this.page.evaluate((tag) => {
      document.querySelectorAll(`[${tag}]`).forEach((el) => el.removeAttribute(tag));
    }, TAG);
    return true;
  }

  // ==================== Dropdowns ====================

  async openUniversityDropdown() {
    await this.universityInput.click({ timeout: 15000 });
    await this.page.waitForTimeout(1200);
  }

  async openLocationDropdown() {
    await this.locationInput.click({ timeout: 15000 });
    await this.page.waitForTimeout(1200);
  }

  async readOptions() {
    return this.page.evaluate(() => {
      // Measured 2026-11-03: the "No institutions available for assignment." option is a 0x0
      // role="option" wrapper whose child div carries the size, so the option counts as visible
      // when it OR anything inside it has a box. Checking the wrapper alone read it as absent.
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const vis = (el) => box(el) || Array.from(el.querySelectorAll('*')).some(box);
      const nodes = Array.from(document.querySelectorAll('[role="option"]')).filter(vis);
      return nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
  }

  // Both dropdowns are type-to-filter comboboxes, which is the only way to ask about a SPECIFIC
  // value: the list renders 12 at a time and does not grow on scroll.
  async filterUniversityDropdown(term) {
    await this.universityInput.fill(term);
    await this.page.waitForTimeout(1600);
    return this.readOptions();
  }

  async selectUniversity(index = 0) {
    // Clear any filter text first. This is a type-to-filter combobox, so a scenario that has
    // just searched it for a university WITH a community leaves the box holding a term that
    // matches nothing — and the next "select the first available university" then reports an
    // empty dropdown as though the app offered none.
    await this.universityInput.fill('').catch(() => {});
    await this.page.waitForTimeout(600);
    await this.openUniversityDropdown();
    // "No institutions available for assignment." is rendered as a role=option of its own.
    const options = (await this.readOptions()).filter((o) => !/^No institutions available/i.test(o));
    if (!options.length) throw new Error('No university options were offered (every university may already have a community)');
    const pick = options[Math.min(index, options.length - 1)];
    await this.page.locator('[role="option"]').filter({ hasText: pick }).first().click({ timeout: 15000 });
    await this.settle(600);
    return pick;
  }

  async selectLocation(name) {
    await this.openLocationDropdown();
    if (name) {
      await this.locationInput.fill(name);
      await this.page.waitForTimeout(1200);
    }
    const options = await this.readOptions();
    if (!options.length) throw new Error(`No location option matched "${name || '(first)'}"`);
    const exact = options.find((o) => o.toLowerCase() === String(name || '').toLowerCase());
    const pick = exact || options[0];
    await this.page.locator('[role="option"]').filter({ hasText: pick }).first().click({ timeout: 15000 });
    await this.settle(600);
    return pick;
  }

  async selectFirstDifferentLocation(current) {
    // Clear the box BEFORE opening, for the same reason selectUniversity() does — and this is
    // the bug that fault was already documented for, just never applied here. Location is a
    // type-to-filter combobox, and on the EDIT form it arrives pre-filled with the community's
    // current location. Opening it without clearing therefore filters the list down to that one
    // value, and the only option on offer is the very one being excluded. It reported
    // "No location other than the current one was offered" against a dropdown holding 31 —
    // an app defect on the face of it, and the two scenarios it failed (§7.2, §7.3) are the
    // whole of the edit-gating and edit-persistence coverage.
    await this.locationInput.fill('').catch(() => {});
    await this.page.waitForTimeout(600);
    await this.openLocationDropdown();
    const options = await this.readOptions();
    const pick = options.find((o) => o.toLowerCase() !== String(current || '').toLowerCase());
    if (!pick) {
      throw new Error(
        `No location other than "${current}" was offered. The dropdown held ${options.length}: `
        + `${JSON.stringify(options)}`
      );
    }
    await this.clickOption(pick);
    await this.settle(600);
    return pick;
  }

  // Click the option whose text is EXACTLY `pick`. `filter({ hasText })` is a substring match,
  // so a value that is a prefix of another ("Al Ahsa" against "Al Ahsa Governorate") would
  // silently select the wrong row and the assertion downstream would blame the app.
  async clickOption(pick) {
    const exact = this.page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(pick)}\\s*$`) })
      .first();
    if (await exact.count()) {
      await exact.click({ timeout: 15000 });
      return;
    }
    await this.page.locator('[role="option"]').filter({ hasText: pick }).first().click({ timeout: 15000 });
  }

  async clearField(field) {
    const target = /university/i.test(field) ? this.universityInput : this.locationInput;
    await target.fill('');
    await this.page.keyboard.press('Escape').catch(() => {});
    // Blur onto something inert — the inline error is rendered on blur, not on keystroke.
    await this.heading.click({ force: true, timeout: 5000 }).catch(() => {});
    await this.settle(900);
  }

  // ==================== Values ====================

  async readValues() {
    return {
      university: await this.universityInput.inputValue().catch(() => null),
      location: await this.locationInput.inputValue().catch(() => null),
      about: await this.aboutInput.inputValue().catch(() => null),
      coverPreview: await this.hasPreview('Cover Photo'),
      profilePreview: await this.hasPreview('Profile Photo'),
    };
  }

  async typeAbout(text) {
    await this.aboutInput.fill(text);
    await this.page.waitForTimeout(500);
    return this.aboutInput.inputValue();
  }

  // A paste is a different code path from typing: a per-keystroke guard lets a paste straight
  // through, which is how TFF-288 survived its first fix. So this must insert text WITHOUT
  // synthesising keystrokes — otherwise it is just typeAbout() under another name and the
  // scenario stops covering anything.
  //
  // IT USED TO INSERT NOTHING AT ALL. The old fallback dispatched a ClipboardEvent built by
  // hand. A dispatched event is UNTRUSTED, so the browser performs no default action: no text
  // is inserted, and `navigator.clipboard.writeText` is itself rejected without a granted
  // permission, so that fallback was the path always taken. Measured 2026-08-02
  // (scripts/probe-community-about-cap.js): pasteAbout() left the field holding 0 characters
  // at EVERY length — 299, 300, 301 and 400 alike — while typing capped correctly at 300. The
  // §2.4 scenario read that 0 back and reported "the app does not cap About University at 300",
  // which is the opposite of what the app does: the textarea carries maxlength="300" and
  // honours it.
  //
  // keyboard.insertText() is the right primitive. Measured on the live field: it commits the
  // whole string through ONE input event and ZERO keydown events, which is exactly the
  // distinction from typing this scenario exists to exercise, and the browser still enforces
  // maxlength (400 in -> 300 held). It also needs no clipboard permission, so it works in the
  // plain context hooks.js creates rather than depending on one being granted.
  async pasteAbout(text) {
    await this.aboutInput.click();
    await this.aboutInput.fill('');
    await this.page.waitForTimeout(200);
    await this.aboutInput.focus();
    await this.page.keyboard.insertText(text);
    await this.page.waitForTimeout(700);
    return this.aboutInput.inputValue();
  }

  // ==================== Save ====================

  async isSaveDisabled() {
    return this.saveButton.isDisabled().catch(() => true);
  }

  // Save settles asynchronously on this form as it does on the promo modal, so a single read is
  // not evidence either way. These two are NOT each other's negation: one tolerates a late
  // enable, the other watches the whole window so a late enable is caught rather than missed.
  async waitForSaveEnabled(timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await this.isSaveDisabled())) return true;
      // eslint-disable-next-line no-await-in-loop
      await this.page.waitForTimeout(400);
    }
    return false;
  }

  async saveStaysDisabled(window = 3000) {
    const deadline = Date.now() + window;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await this.isSaveDisabled())) return false;
      // eslint-disable-next-line no-await-in-loop
      await this.page.waitForTimeout(300);
    }
    return true;
  }

  async clickSave({ expectRequest = true, dblclick = false } = {}) {
    if (!(await this.waitForSaveEnabled())) {
      throw new Error('Save is disabled, so the form was not submitted');
    }
    const waiter = expectRequest
      ? this.page
          .waitForResponse((r) => /\/api\/v1\/community\/?(\d+\/)?$/.test(r.url()) && ['POST', 'PATCH', 'PUT'].includes(r.request().method()), {
            timeout: 45000,
          })
          .catch(() => null)
      : Promise.resolve(null);
    const [resp] = await Promise.all([waiter, dblclick ? this.saveButton.dblclick() : this.saveButton.click()]);
    await this.settle(1500);
    return resp ? { status: resp.status(), method: resp.request().method() } : null;
  }

  // ==================== Errors ====================

  // Collects BOTH surfaces and says which one carried the message. AC 11 specifies "Inline" for
  // all six image rules; the build uses toasts. A reader that only looked inline would report
  // "no error" for a rejection that plainly happened, which sends whoever reads the report
  // after a bug that is not there.
  async readValidationError() {
    const inline = await this.page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const hits = Array.from(document.querySelectorAll('p,span,div,label'))
        .filter((e) => e.children.length === 0 && vis(e))
        .map((e) => (e.textContent || '').trim())
        .filter((s) => s && /required\.|only jpg|supported\.|exceed|too large|must be a/i.test(s))
        // The static upload hint is not an error, and matching it would report every fresh
        // form as already invalid.
        .filter((s) => !/^JPG,\s*PNG\s*\(max/i.test(s));
      return Array.from(new Set(hits));
    });
    if (inline.length) return { message: inline[0], all: inline, surface: 'inline' };

    const toast = await this.page
      .locator('.Toastify__toast-body, .Toastify__toast, [role="alert"], [role="status"]')
      .first();
    if (await toast.count()) {
      const text = await toast.textContent({ timeout: 4000 }).catch(() => null);
      const clean = text ? text.replace(/\s+/g, ' ').trim() : '';
      if (clean) return { message: clean, all: [clean], surface: 'toast' };
    }
    return { message: null, all: [], surface: null };
  }

  async readAllErrors() {
    const e = await this.readValidationError();
    return e.all;
  }

  // ==================== Success modal ====================

  async readSuccessModal() {
    if (!(await this.successModal.count())) return { present: false };
    const visible = await this.successModal.isVisible().catch(() => false);
    if (!visible) return { present: false };
    return this.successModal.evaluate((el) => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return {
        present: true,
        text: clean(el.innerText),
        heading: clean((el.querySelector('h1,h2,h3') || {}).textContent || ''),
        ctas: Array.from(el.querySelectorAll('button,a')).map((b) => clean(b.textContent)).filter(Boolean),
      };
    });
  }

  async clickSuccessCta(name) {
    await this.successModal.getByRole('button', { name: new RegExp(name, 'i') })
      .or(this.successModal.getByRole('link', { name: new RegExp(name, 'i') }))
      .first()
      .click({ timeout: 15000 });
    await this.settle(1500);
  }

  // ==================== Composite ====================

  // Fill everything a valid community needs, and report exactly what was used — the steps
  // attach it to the report so a failure is reproducible without reading .env or the DB.
  async fillValidDetails({ location = null, about = null } = {}) {
    const used = {};
    const cover = await this.uploadImage('Cover Photo', ...CommunityFormPage.VALID_COVER);
    const logo = await this.uploadImage('Profile Photo', ...CommunityFormPage.VALID_LOGO);
    used.cover = cover.accepted;
    used.profile = logo.accepted;
    if (this.isOnCreate()) used.university = await this.selectUniversity(0);
    used.location = await this.selectLocation(location);
    if (about !== null) used.about = await this.typeAbout(about);
    return used;
  }
}

// The width that separates a cover preview from a logo preview on the CREATE form, where both
// are blob: URLs and nothing else distinguishes them. Measured live 2026-08-01: cover 572 px
// wide, logo 117 px. Set between the two, far from either, so a responsive tweak has to be
// drastic before it matters — and if one ever is misread, imagePreviews() reports
// `attributedBy: 'width'` so the reason is visible rather than inferred.
CommunityFormPage.COVER_PREVIEW_MIN_WIDTH = 200;

// The image sent whenever a step just needs a required field filled with something valid and
// the file itself is not what the scenario is about. THE SINGLE SOURCE OF TRUTH — community
// .steps.js imports these rather than keeping its own copy, because the two drifting apart is
// how fillValidDetails() (the path the IRREVERSIBLE @creates-community scenarios run through)
// kept sending generated bytes after every step had been moved onto real photographs.
//
// They must resolve to REAL PHOTOGRAPHS in features/support/imageFixtures.js. Every accepted
// upload goes through a crop modal, and a cropper handed a 1x1 image can leave that modal open
// — after which it covers the form, swallows clicks, writes no preview, and Save stays
// correctly gated on a field the caller believes it filled. The scenario then fails as "Save
// should be enabled but is disabled", which reads as an app defect and is not one.
CommunityFormPage.VALID_COVER = ['JPG', 8];
CommunityFormPage.VALID_LOGO = ['PNG', 5];

module.exports = CommunityFormPage;
