const { When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const ChangePasswordPage = require('../pages/ChangePasswordPage');

// Suite-wide step definitions for phrases that more than one feature uses.
//
// Cucumber loads every file under features/step_definitions/** into ONE global registry, so
// a generic phrase can be defined exactly once. `I click "<label>"` appears in a dozen
// feature files (Community, Invite-candidate, Subscription, Change-Password, Invite-agent,
// ...); when two feature-scoped step files each defined it, every step using it became
// AMBIGUOUS and was skipped. This file is the single owner: it dispatches the labels that
// need page-object handling (route waits, post-submit settling) and falls back to a plain
// role-based button click for everything else.
//
// When adding a label here, prefer the fallback. Only add a branch if the click needs
// something the generic click cannot do — a navigation wait, a settle, a non-button target.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lazily bind the ChangePasswordPage, matching what change-password.steps.js does.
function changePasswordPage(world) {
  if (!world.pages.changePassword) {
    world.pages.changePassword = new ChangePasswordPage(world.page);
  }
  return world.pages.changePassword;
}

When('I click {string}', async function (label) {
  // --- Superadmin invite-agent flow -------------------------------------------------
  // Guarded on the /agents route so these labels can never hijack a click in another
  // feature. Each goes through the page object because each carries a wait the bare
  // click does not: the CTA and Exit wait for their route, submit lets the POST land.
  if (/\/agents(\/|\?|$)/.test(this.page.url())) {
    if (/^invite agents?$/i.test(label)) {
      await this.pages.agentsListing.clickInviteCta();
      return;
    }
    if (/^exit$/i.test(label)) {
      await this.pages.inviteAgent.clickExit();
      return;
    }
    if (/^send invite$/i.test(label)) {
      await this.pages.inviteAgent.clickSubmit();
      // Give the request time to land; the outcome step decides whether it succeeded.
      await this.page.waitForTimeout(3500);
      return;
    }
  }

  // --- Community module -------------------------------------------------------------
  // Guarded on the /community route so these labels cannot hijack a click elsewhere. Each
  // needs something the generic click cannot do: Save has to wait for the button to settle
  // (it enables asynchronously, so a bare click races it), the two clear controls are not
  // always <button>s, and the navigating CTAs have to wait for their route.
  if (/\/community(\/|\?|$)/.test(this.page.url())) {
    const CommunityPage = require('../pages/CommunityPage');
    const CommunityFormPage = require('../pages/CommunityFormPage');
    if (!this._community) this._community = new CommunityPage(this.page);
    if (!this._communityForm) this._communityForm = new CommunityFormPage(this.page);

    if (/^save( changes)?$/i.test(label)) {
      await this._communityForm.clickSave();
      return;
    }
    if (/^clear all$/i.test(label)) {
      await this._community.clearAllControl().click({ timeout: 20000 });
      await this._community.settle(1200);
      return;
    }
    if (/^clear all filters$/i.test(label)) {
      await this._community.clearAllFiltersCta().click({ timeout: 20000 });
      await this._community.settle(1500);
      return;
    }
    if (/^edit community$/i.test(label)) {
      await this._community.editCommunityCta.click({ timeout: 20000 });
      await this._communityForm.ready();
      return;
    }
    if (/^\+?\s*create community$/i.test(label)) {
      await this._community.createCta.click({ timeout: 20000 });
      await this._communityForm.ready();
      return;
    }
  }

  // --- Change-password modal --------------------------------------------------------
  if (/^change password$/i.test(label)) {
    await changePasswordPage(this).submit();
    return;
  }
  if (/^cancel$/i.test(label)) {
    await changePasswordPage(this).cancelButton.click();
    return;
  }
  if (/forgotten your password/i.test(label)) {
    await changePasswordPage(this).forgotPasswordLink.click();
    return;
  }

  // --- Agent Portal: sending the invite modal -----------------------------------------
  //
  // Guarded on the Invite via Email modal actually being open, so this label cannot hijack a
  // click anywhere else. It exists for ONE reason: measured 2026-08-27, the chip input and the
  // CSV upload are MUTUALLY EXCLUSIVE - with both present the modal renders "You can only use one
  // option at a time..." and DISABLES Send Invites. A bare click on a disabled button waits out
  // its full timeout and reports "element is not enabled", which says nothing about why. This
  // turns that into the sentence the app is actually showing, so the red row names the product
  // rule instead of reading like a broken locator.
  if (/^send invites?$/i.test(label)) {
    const CandidateOnboardingPage = require('../pages/CandidateOnboardingPage');
    const onboarding = new CandidateOnboardingPage(this.page);
    if ((await onboarding.inviteModal.count()) && (await onboarding.inviteModal.isVisible().catch(() => false))) {
      const clash = await onboarding.mutualExclusionError();
      if (clash) {
        throw new Error(
          `Send Invites is disabled: the modal is refusing this combination with ${JSON.stringify(clash)}.\n`
          + 'Measured 2026-08-27: typed addresses and an uploaded file are mutually exclusive in this '
          + 'build, so a scenario that supplies both cannot send. Confirm with the PO whether they are '
          + 'meant to be combinable before treating this as a defect.'
        );
      }
      await onboarding.sendInvitesButton.click();
      return;
    }
  }

  // --- Agent-portal candidate-onboarding modal stack --------------------------------
  //
  // >>> SCOPED TO THE OPEN DIALOG, AND IT HAS TO BE. <<< The fallback below resolves
  // `getByRole('button', { name: /Copy Code/i }).first()` in DOM ORDER, and the agent
  // dashboard renders TWO `button[aria-label="Copy Code"]` controls of its own in the
  // Referral Codes section - above the modal in the DOM. So `I click "Copy Code"` inside the
  // Share Agent Code modal would copy the dashboard widget's code instead, and the clipboard
  // assertion would pass or fail for a reason that has nothing to do with the modal. Same
  // class of trap as the promo module's save toast resolving to react-toastify's wrapper.
  //
  // Guarded on a dialog actually being open, so these labels cannot hijack a click anywhere
  // else. Nothing else is special-cased here: the chooser's cards and the welcome modal's
  // primary button have their own steps.
  //
  // >>> IT SITS LAST, IMMEDIATELY ABOVE THE FALLBACK, ON PURPOSE. <<< It matches ANY label in any
  // open dialog, so placed higher it would preempt the page-object branches above - the
  // change-password modal is a `[role="dialog"]` carrying "Change Password" and "Cancel", and
  // routing those through the bare click would drop the handling change-password.steps.js relies
  // on. Here it can only ever refine the last resort, never override a deliberate branch.
  //
  // >>> IT WALKS EVERY VISIBLE DIALOG, NEWEST FIRST - `.first()` IS NOT SAFE HERE. <<< While one
  // onboarding modal replaces another BOTH are attached and visible for a beat (measured
  // 2026-08-27), so `[role="dialog"]` .first() can be the OUTGOING modal, which holds no such
  // button. The lookup then finds nothing, falls through to the page-level fallback, and clicks
  // the dashboard widget behind the overlay. Not hypothetical: it timed out on
  // `I click "Copy Code"` against `<button aria-label="Copy Code" class="text-gray-400...">`,
  // reporting `"Or share via" ... subtree intercepts pointer events` - a pointer-event error for
  // what was really a wrong-element resolution.
  {
    const dialogs = this.page.locator('[role="dialog"]');
    const total = await dialogs.count();
    for (let i = total - 1; i >= 0; i--) {
      const dialog = dialogs.nth(i);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const inDialog = dialog.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') });
      if (await inDialog.count()) {
        await inDialog.first().click();
        return;
      }
    }
  }

  // --- Everything else --------------------------------------------------------------
  await this.page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first().click();
});

// ==================== Suite-wide generic assertions ====================
//
// >>> MOVED HERE FROM subscription.steps.js DURING THE playwright-bdd MIGRATION. Both bodies are
//     verbatim: nothing about what they assert changed, only which file owns them.
//
// Why the move was forced rather than tidy: these two match rendered text and nothing else, so
// they are page-agnostic, but they lived in a feature-specific step file and
// Referral-Codes.feature borrowed them through Cucumber's ONE global step registry. Under
// playwright-bdd that borrowing cannot work - generation loads steps/ only, so a migrated
// feature cannot reach a definition still sitting in an unmigrated file. Generation fails with
// "Missing step definitions", which is exactly how this was found.
//
// >>> AND EACH MUST BE DEFINED EXACTLY ONCE. The note still in steps/referral-codes.js records
//     what happened the last time one of them was defined twice: the step became AMBIGUOUS and
//     took out that feature's section scenario AND 8 unrelated Subscription billing-history
//     scenarios. This file is the designated single owner of suite-wide phrases (see the header
//     at the top), so it is the right home for them.
Then('the {string} section should be visible', async function (section) {
  await expect(
    this.page.getByText(new RegExp(`^${escapeRegExp(section)}$`, 'i')).first()
  ).toBeVisible({ timeout: 15000 });
});

Then('the {string} section should not be visible', async function (section) {
  await expect(
    this.page.getByText(new RegExp(`^${escapeRegExp(section)}$`, 'i')).first()
  ).toBeHidden({ timeout: 10000 });
});

// ---------------------------------------------------------------------------------------------
// The Candidates listings' page heading (Active / In Progress / Deactivated / Requires Attention).
// Page-agnostic on purpose: it reads the <h1> the page renders, so the same rule is asserted the
// same way on all four listings. The heading must name the listing ("Candidates - Active"), not
// just the section. Measured 2026-10-05: only Deactivated does; the other three read "Candidates".
// Polled, because the shell can paint the heading a moment before its suffix.
// ---------------------------------------------------------------------------------------------
Then('the candidates page heading should read {string}', { timeout: 30000 }, async function (expected) {
  const norm = (s) => String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const h1 = this.page.getByRole('heading', { level: 1 }).first();
  await expect(h1, 'the page should render an <h1> heading').toBeVisible({ timeout: 20000 });
  let shown = '';
  await expect
    .poll(async () => {
      shown = norm(await h1.innerText().catch(() => ''));
      return shown;
    }, { timeout: 10000 })
    .toBe(norm(expected))
    .catch(() => {});
  await this.attach(`page: ${new URL(this.page.url()).pathname}\nheading: "${shown}"\nexpected: "${expected}"`, 'text/plain');
  expect(shown, `the page heading on ${new URL(this.page.url()).pathname}`).toBe(norm(expected));
});
