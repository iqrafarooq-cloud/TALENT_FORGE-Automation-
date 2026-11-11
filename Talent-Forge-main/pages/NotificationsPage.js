const BasePage = require('./BasePage');

// NotificationsPage — Page Object for the in-app notification centre (the header bell),
// which TFF-43 §11/§12 makes the delivery channel for half the promo-code lifecycle events:
//
//   Event                  Super Admin      Agent              Candidate
//   Promo expiring (2wk)   in-app           in-app             --
//   80% usage reached      in-app           in-app             --
//   Promo expired          in-app           in-app + email     inline error on redemption
//   Promo disabled         email            email              no discount applied
//
// The same bell serves every role, so one Page Object covers the superadmin's context and
// the agent's. Bind it to whichever page holds that role's session.
//
// Live DOM (2026-07-30, discovered by scripts/probe-notifications-dom.js):
//   bell     button[aria-label="Notifications"][aria-haspopup="true"]  (NOT inside <header>)
//   panel    div[role="dialog"] popover, w-[506px], headed "Notifications"
//   tabs     plain buttons "All" | "Unread (n)"      (no role="tab")
//   item     title / body / day label / relative age / "Review" / "Mark As Read", e.g.
//              Your promo code has been disabled
//              Your promo code CODETF5WMM8 has been disabled.
//              Today
//              5 minutes ago
//              Review
//              Mark As Read
//            An already-read item renders "Marked as read" instead.
//   footer   "Go To Settings" | "Mark All As Read"
//   API      GET /core/api/v1/notifications/?page=1&page_size=10[&is_read=false]
//              -> { count, results: [{ id, title, body, type, is_read, created_at }] }
//
// The AGENT dashboard also throws up a "Welcome, <name>! 👋 … Onboard Candidates" modal a few
// seconds after login, and its backdrop swallows the bell click. `open()` dismisses it first
// — without that the click retries until it times out (seen live).
class NotificationsPage extends BasePage {
  constructor(page) {
    super(page);

    this.bell = page
      .locator('[data-testid="notifications-button"]')
      .or(page.getByRole('button', { name: /^notifications$/i }))
      .or(page.locator('button[aria-label*="notification" i]'))
      .first();

    // Scope the popover by its own heading so it can never resolve to another
    // role="dialog" on the page (the superadmin's "Edit Code Parameters" modal is one).
    this.panel = page
      .locator('[data-testid="notifications-panel"]')
      .or(page.locator('[role="dialog"]').filter({ hasText: /^Notifications/ }))
      .first();

    this.allTab = this.panel.getByRole('button', { name: /^all$/i }).first();
    this.unreadTab = this.panel.getByRole('button', { name: /^unread\b/i }).first();
    this.markAllReadButton = this.panel.getByRole('button', { name: /^mark all as read$/i }).first();

    // The welcome/onboarding modal that can sit over the agent dashboard.
    this.welcomeModal = page.locator('div.fixed.inset-0').filter({ hasText: /welcome,/i }).first();
    this.welcomeDismiss = page.getByRole('button', { name: /^dismiss$/i }).first();
  }

  // ---- Opening / closing ----

  async dismissBlockingModal() {
    if (!(await this.welcomeModal.isVisible().catch(() => false))) return false;
    await this.welcomeDismiss.click({ timeout: 5000 }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
    });
    await this.welcomeModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return true;
  }

  async isOpen() {
    return this.panel.isVisible().catch(() => false);
  }

  async open() {
    if (await this.isOpen()) return;
    await this.dismissBlockingModal();
    await this.bell.waitFor({ state: 'visible', timeout: 30000 });
    await this.bell.click();
    await this.panel.waitFor({ state: 'visible', timeout: 20000 });
    // The list is fetched when the popover mounts; give it a beat to render.
    await this.page.waitForTimeout(1200);
  }

  async close() {
    if (!(await this.isOpen())) return;
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.panel.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  // Close and re-open so the list is re-fetched rather than read from a stale render.
  async refresh() {
    await this.close();
    await this.page.waitForTimeout(500);
    await this.open();
  }

  // ---- Reading ----

  // Every notification currently rendered, as { title, body, day, age, read }.
  //
  // Derived structurally instead of by class name: an item is the SMALLEST element in the
  // panel whose text is 4–8 lines and carries both a "Review" line and a "Mark As Read" /
  // "Marked as read" line. That survives a Tailwind class churn, which a
  // `div.min-w-0.flex-1` selector would not.
  async readItems() {
    if (!(await this.isOpen())) await this.open();
    return this.panel.evaluate((root) => {
      const READ_RE = /^mark(ed)?\s*as\s*read$/i;
      const found = [];
      for (const el of root.querySelectorAll('*')) {
        const lines = (el.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 4 || lines.length > 8) continue;
        const readIdx = lines.findIndex((l) => READ_RE.test(l));
        if (readIdx === -1 || !lines.some((l) => /^review$/i.test(l))) continue;
        // Keep the deepest match: skip anything that contains another candidate.
        found.push({ el, lines, readIdx });
      }
      const deepest = found.filter((c) => !found.some((o) => o !== c && c.el.contains(o.el)));
      const seen = new Set();
      const out = [];
      for (const { lines, readIdx } of deepest) {
        const item = {
          title: lines[0] || '',
          body: lines[1] || '',
          // The two lines before "Review" are the day label and the relative age.
          day: lines[readIdx - 3] || '',
          age: lines[readIdx - 2] || '',
          read: /^marked/i.test(lines[readIdx] || ''),
        };
        const key = `${item.title}|${item.body}|${item.age}|${item.read}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    });
  }

  // The count the "Unread (n)" tab advertises, or null when the tab is absent.
  async unreadCount() {
    if (!(await this.isOpen())) await this.open();
    const txt = await this.unreadTab.innerText().catch(() => '');
    const m = String(txt).match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
  }

  async showUnread() {
    if (!(await this.isOpen())) await this.open();
    if (await this.unreadTab.isVisible().catch(() => false)) {
      await this.unreadTab.click().catch(() => {});
      await this.page.waitForTimeout(1000);
    }
  }

  async showAll() {
    if (!(await this.isOpen())) await this.open();
    if (await this.allTab.isVisible().catch(() => false)) {
      await this.allTab.click().catch(() => {});
      await this.page.waitForTimeout(1000);
    }
  }

  // ---- Writing ----

  // Mark everything read, so a later "did this event notify me?" check has a clean signal.
  // This is the in-app equivalent of the `afterUid` inbox baseline the email steps take:
  // the agents are long-lived test accounts whose bells already hold dozens of promo
  // notifications from earlier runs, and the first page only holds 10 — so counting matches
  // cannot tell a new notification from an old one, but "is unread" can.
  //
  // A bell with NOTHING in it renders "No notifications yet!" and no "Mark All As Read" control
  // at all (measured 2026-10-07 on a freshly provisioned throwaway agent). That is already the
  // clean baseline this method exists to produce, so it counts as cleared. Wait for one of the
  // two settled renders first - a panel still fetching has neither, and must not be read as empty.
  async markAllAsRead() {
    await this.open();
    const emptyState = this.panel.getByText(/^no notifications yet!?$/i).first();
    await this.markAllReadButton.or(emptyState).first()
      .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (!(await this.markAllReadButton.isVisible().catch(() => false))) {
      if (await emptyState.isVisible().catch(() => false)) {
        await this.close();
        return { cleared: true, remaining: 0, reason: 'the bell holds no notifications at all' };
      }
      return { cleared: false, reason: 'no "Mark All As Read" control in the panel' };
    }
    await this.markAllReadButton.click();
    // Wait for the advertised unread count to actually reach 0 rather than assuming it did.
    await this.page
      .waitForFunction(() => {
        const btn = [...document.querySelectorAll('[role="dialog"] button')]
          .find((b) => /^unread\b/i.test((b.textContent || '').trim()));
        return btn ? /\(0\)/.test(btn.textContent || '') : false;
      }, undefined, { timeout: 20000 })
      .catch(() => {});
    const left = await this.unreadCount();
    await this.close();
    return { cleared: left === 0, remaining: left };
  }

  // ---- Waiting ----

  // Is this a notification raised just now rather than one left over from an earlier run?
  // "Today" plus an age under an hour. Belt-and-braces alongside the unread filter, so the
  // assertion holds even if the Unread tab ever stops filtering.
  static isFresh(item) {
    if (item.day && !/^today$/i.test(item.day)) return false;
    return /just now|second|^a minute ago$|^[1-9]\d? minutes? ago$/i.test(item.age || '');
  }

  // Poll the bell until an UNREAD notification whose title or body matches `pattern` shows
  // up. Returns the item, or null on timeout — the step decides whether that is a failure
  // (§4, where the notification is known to be sent) or the expected outcome (§6, where it
  // is a documented gap).
  async waitForNotification(pattern, { timeoutMs = 60000, pollMs = 5000, requireFresh = true } = {}) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    const deadline = Date.now() + timeoutMs;
    let lastSeen = [];
    for (;;) {
      await this.refresh();
      await this.showUnread();
      lastSeen = await this.readItems();
      const hit = lastSeen.find((i) => (re.test(i.title) || re.test(i.body))
        && !i.read
        && (!requireFresh || NotificationsPage.isFresh(i)));
      if (hit) {
        await this.close();
        return hit;
      }
      if (Date.now() + pollMs >= deadline) break;
      await this.page.waitForTimeout(pollMs);
    }
    await this.close();
    this.lastSeen = lastSeen;
    return null;
  }

  // A one-line summary of what the last poll saw, for a failure message. waitForNotification
  // always looks at the Unread tab, so an empty list means nothing new was raised at all —
  // worth saying plainly, since it distinguishes "no notification" from "the wrong one".
  describe(items) {
    const list = items || this.lastSeen || [];
    if (!list.length) return 'the unread list was empty — no notification was raised at all';
    return `the unread list held ${list.map((i) => `"${i.title}" (${i.age})`).join(', ')}`;
  }
}

module.exports = NotificationsPage;
