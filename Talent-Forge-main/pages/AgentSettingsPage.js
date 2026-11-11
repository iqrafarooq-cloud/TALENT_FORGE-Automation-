// Agent Portal > Account Settings (/settings) and the header notifications panel.
//
// Measured 2026-10-14 (scratchpad probes, read-only):
//   /settings            three tabs, role="radio" (NOT role="tab"): General / Notifications / Security.
//                        The URL does not change when a tab is chosen.
//   payload              GET /core/api/v1/auth/settings/ -> firstname, lastname, email, phone_number,
//                        nationality, profile_image, email_notifications_enabled, two_factor_enabled,
//                        password_updated_at, language, visibility. There is NO time-zone field.
//   General              "Basic Information" (Edit basic information) + "Account Preferences"
//                        (Edit account preferences -> one <select> of 418 IANA zones).
//   Basic modal          firstName / lastName / email (DISABLED) / tel / nationality combobox,
//                        Cancel + Save, Save disabled on open.
//   Notifications tab    one <input role="switch" aria-label="Email notifications">.
//   bell panel           a [role=dialog] with All / Unread (n) buttons, per item Review + Mark as read,
//                        Load more, "Go To Settings" (an <a href="/settings">), Mark All As Read.
//   bell endpoint        GET /core/api/v1/notifications/?page=<n>&page_size=10[&is_read=false]
//
// Every assertion built on this object compares the render against the payload the app itself
// fetched, never against strings repeated in the feature file - so nothing here goes stale when the
// fixture agent's name, phone or notifications change.
const SETTINGS_PATH = '/auth/settings/';
const NOTIF_PATH = '/notifications/';

class AgentSettingsPage {
  constructor(page) {
    this.page = page;
    const base = (process.env.BASE_URL || '').replace(/\/login\/?$/, '');
    this.url = `${base}/settings`;
    this.dashboardUrl = `${base}/dashboard`;
    this.tabs = page.locator('main [role="radio"]');
    this.bellButton = page.locator('button[aria-label*="otification" i]').first();
    this.panel = page.locator('[role="dialog"]:visible').filter({ hasText: /Mark All As Read/i }).first();
  }

  static GENERAL_LABELS = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Nationality', 'Time Zone'];

  // ---------------------------------------------------------------- request log
  // Installed before the first navigation: two assertions here are ABSENCES (opening and cancelling
  // an edit modal must write nothing), which a listener attached late cannot measure.
  install() {
    if (this._installed) return;
    this._installed = true;
    this.responses = [];
    this.writes = [];
    this._parsing = [];
    this.page.on('request', (req) => {
      if (!/\/api\//.test(req.url())) return;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method()) && !/\/auth\/token/.test(req.url())) {
        this.writes.push({ at: Date.now(), method: req.method(), url: req.url().replace(/^https?:\/\/[^/]+/, '') });
      }
    });
    this.page.on('response', (res) => {
      const u = res.url();
      if (res.request().method() !== 'GET') return;
      const kind = u.includes(SETTINGS_PATH) ? 'settings' : (u.includes(NOTIF_PATH) ? 'notifications' : null);
      if (!kind) return;
      const p = res.json()
        .then((body) => this.responses.push({ at: Date.now(), kind, url: u, query: new URL(u).searchParams, body }))
        .catch(() => {});
      this._parsing.push(p);
    });
  }

  async flush() { await Promise.all(this._parsing); }

  mark() { return { responses: this.responses.length, writes: this.writes.length }; }

  async latest(kind, predicate = () => true, since = 0) {
    await this.flush();
    const hits = this.responses.slice(since).filter((r) => r.kind === kind && predicate(r));
    return hits.length ? hits[hits.length - 1] : null;
  }

  async waitFor(kind, predicate = () => true, since = 0, timeout = 20000) {
    const deadline = Date.now() + timeout;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      const hit = await this.latest(kind, predicate, since);
      if (hit) return hit;
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return null;
  }

  writesSince(mark) { return this.writes.slice(mark.writes); }

  // ---------------------------------------------------------------- settings
  async open() {
    const m = this.mark();
    await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await this.suppressWelcome();
    const payload = await this.waitFor('settings', () => true, m.responses, 30000);
    await this.page.getByText('Basic Information', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
    return payload && payload.body;
  }

  async suppressWelcome() {
    await this.page.evaluate(() => { try { sessionStorage.setItem('agent_welcome_shown', '1'); } catch (e) { /* */ } });
  }

  async settingsPayload() {
    const r = await this.latest('settings');
    return r && r.body;
  }

  async tabLabels() { return (await this.tabs.allInnerTexts()).map((t) => t.trim()); }

  async selectedTab() {
    return this.page.evaluate(() => {
      const el = document.querySelector('main [role="radio"][aria-checked="true"]');
      return el ? el.innerText.trim() : null;
    });
  }

  async selectTab(name) {
    await this.tabs.filter({ hasText: new RegExp(`^${name}$`) }).first().click();
    await this.page.waitForTimeout(800);
  }

  // Label -> value, read from the rendered lines between one contracted label and the next.
  // Works from the LABELS rather than the markup, the lesson the candidate view-profile module paid for.
  async readGeneral() {
    const text = await this.page.locator('main').innerText();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = {};
    const labels = AgentSettingsPage.GENERAL_LABELS;
    labels.forEach((label) => {
      const i = lines.indexOf(label);
      if (i < 0) return;
      const vals = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (labels.includes(lines[j]) || /^(Account Preferences|Basic Information)$/.test(lines[j])) break;
        vals.push(lines[j]);
      }
      out[label] = vals.join(' ');
    });
    return out;
  }

  async mainText() { return this.page.locator('main').innerText(); }

  emailSwitch() { return this.page.locator('main [role="switch"][aria-label="Email notifications"], main input[role="switch"]').first(); }

  twoFactorSwitch() { return this.page.locator('main [role="switch"], main input[role="switch"]').first(); }

  // ---------------------------------------------------------------- edit modals
  dialog() { return this.page.locator('[role="dialog"]:visible').last(); }

  async openEdit(which) {
    const name = which === 'basic' ? 'Edit basic information' : 'Edit account preferences';
    await this.page.getByRole('button', { name }).click();
    await this.dialog().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(500);
  }

  saveButton() { return this.dialog().getByRole('button', { name: /^Save$/ }); }

  async readBasicModal() {
    const d = this.dialog();
    const val = async (loc) => ((await loc.count()) ? loc.first().inputValue() : null);
    const dis = async (loc) => ((await loc.count()) ? loc.first().isDisabled() : null);
    return {
      firstName: await val(d.locator('input[name="firstName"]')),
      lastName: await val(d.locator('input[name="lastName"]')),
      email: await val(d.locator('input[name="email"]')),
      emailDisabled: await dis(d.locator('input[name="email"]')),
      phone: await val(d.locator('input[type="tel"]')),
      nationality: await val(d.locator('input[role="combobox"]')),
      saveDisabled: await this.saveButton().isDisabled(),
    };
  }

  // The time-zone control is a react-aria select backed by a hidden mirror <select>; the mirror
  // carries the value the modal will save, and its selected option's text is what it displays.
  async readPrefsModal() {
    return this.dialog().evaluate((dl) => {
      const sel = dl.querySelector('select');
      return {
        value: sel ? sel.value : null,
        selectedText: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].text.trim() : null,
        options: sel ? sel.options.length : 0,
      };
    });
  }

  async typeInto(name, text) {
    const input = this.dialog().locator(`input[name="${name}"]`).first();
    await input.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    if (text) await this.page.keyboard.type(text); else await this.page.keyboard.press('Backspace');
    await this.page.keyboard.press('Tab');
  }

  async closeDialogBy(route) {
    if (route === 'Cancel') await this.dialog().getByRole('button', { name: /^Cancel$/ }).last().click();
    else if (route === 'Escape') await this.page.keyboard.press('Escape');
    else throw new Error(`unknown close route "${route}" - use Cancel or Escape`);
  }

  async dialogStaysClosed(ms = 2500) {
    const deadline = Date.now() + ms;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      if (await this.page.locator('[role="dialog"]:visible').count()) {
        const t = await this.page.locator('[role="dialog"]:visible').last().innerText().catch(() => '');
        if (/Basic Information|Account Preferences/.test(t)) return false;
      }
      await this.page.waitForTimeout(250);
    }
    /* eslint-enable no-await-in-loop */
    return true;
  }

  // ---------------------------------------------------------------- notifications panel
  async openBell() {
    const m = this.mark();
    if (!/\/dashboard/.test(this.page.url())) {
      await this.page.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
      await this.suppressWelcome();
    }
    await this.bellButton.waitFor({ state: 'visible', timeout: 30000 });
    await this.bellButton.click();
    await this.panel.waitFor({ state: 'visible', timeout: 20000 });
    await this.waitFor('notifications', () => true, m.responses, 20000);
    return m;
  }

  bellTab(name) { return this.panel.getByRole('button', { name: new RegExp(`^${name}`) }).first(); }

  async unreadLabelCount() {
    const m = /Unread\s*\((\d+)\)/.exec(await this.panel.innerText());
    return m ? Number(m[1]) : null;
  }

  // One entry per Review control, climbing only while the ancestor still holds exactly one Review -
  // so a date group holding several items is never mistaken for one item.
  async readItems() {
    return this.panel.evaluate((root) => {
      const reviews = [...root.querySelectorAll('button, a')].filter((b) => /^Review$/i.test(b.innerText.trim()));
      return reviews.map((rv) => {
        let host = rv;
        while (host.parentElement && host.parentElement !== root) {
          const n = [...host.parentElement.querySelectorAll('button, a')].filter((b) => /^Review$/i.test(b.innerText.trim())).length;
          if (n > 1) break;
          host = host.parentElement;
        }
        // The first item of each date group climbs into the group's heading ("Today", "Oct 12, 2026"),
        // so heading-shaped lines are skipped rather than read as the item's title.
        const heading = /^(Today|Yesterday|[A-Z][a-z]{2,8} \d{1,2}, \d{4})$/;
        const lines = host.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        const title = lines.find((l) => !heading.test(l));
        return {
          title: title || '',
          hasMarkAsRead: [...host.querySelectorAll('button')].some((b) => /^Mark as read$/i.test(b.innerText.trim())),
        };
      });
    });
  }

  async settleItems(want, timeout = 15000) {
    const deadline = Date.now() + timeout;
    let items = [];
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      items = await this.readItems();
      if (items.length === want) return items;
      await this.page.waitForTimeout(300);
    }
    /* eslint-enable no-await-in-loop */
    return items;
  }
}

module.exports = AgentSettingsPage;
