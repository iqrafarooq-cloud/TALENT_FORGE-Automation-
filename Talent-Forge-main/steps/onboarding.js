const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const OnboardingPage = require('../pages/OnboardingPage');
const { provisionAccountToOnboarding } = require('../utils/onboardingProvision');
require('dotenv').config();

// Onboarding steps. Reaching /onboarding is expensive (signup -> IMAP email
// verify -> login) so it happens once per scenario in the Background step below.
//
// NOTE: the generic button-state assertions
//   "the {string} button should be enabled/disabled"
// are defined in signup.steps.js and reused here for Next / Finish. Do not
// redefine them or Cucumber will error on ambiguous step definitions.

// Lazily create (and cache) the OnboardingPage bound to the current page.
function ob(world) {
  if (!world.pages.onboarding) {
    world.pages.onboarding = new OnboardingPage(world.page);
  }
  return world.pages.onboarding;
}

// ==================== Background: reach the onboarding screen ====================

Given('a new verified user has reached the onboarding screen', async function () {
  await provisionAccountToOnboarding(this);
  await expect(this.page).toHaveURL(/\/onboarding/, { timeout: 30000 });
  await expect(ob(this).stepIndicator).toBeVisible({ timeout: 20000 });
});

// ==================== Navigation ====================

When('the user proceeds to the next onboarding step', async function () {
  await ob(this).clickNext();
});

When('the user finishes onboarding', async function () {
  await ob(this).clickFinish();
});

When('the user skips the current onboarding step', async function () {
  await ob(this).clickSkip();
});

When('the user skips to onboarding step {int}', async function (step) {
  await ob(this).skipToStep(step);
});

When('the user skips all onboarding steps', async function () {
  await ob(this).skipAllSteps();
});

// ==================== Step 1: profile type ====================

When('the user selects the {string} profile type', async function (type) {
  await ob(this).selectProfileType(type);
});

// ==================== Step 2: education ====================

When('the user fills in the education details', async function () {
  await ob(this).fillEducation();
});

// ==================== Step 3: work experience ====================

When('the user fills in the work experience details', async function () {
  await ob(this).fillWorkExperience();
});

Then('the End Date fields should not be displayed', async function () {
  await expect(this.page.getByText(/^End Date/i)).toHaveCount(0);
});

// ==================== Step 4: certifications ====================

When('the user fills in the certification details', async function () {
  await ob(this).fillCertification();
});

// ==================== Step 5: work preferences ====================

When('the user fills in the work preferences details', async function () {
  await ob(this).fillWorkPreferences();
});

When('the user selects the location {string}', async function (location) {
  await ob(this).chooseFromCombobox(/Where are you currently located/i, location);
});

When('the user selects {string} for relocation', async function (answer) {
  await ob(this).selectRelocation(answer);
});

When('the user selects the preferred work location {string}', async function (loc) {
  await ob(this).chooseFromCombobox(/Preferred Work Location/i, loc);
  await this.page.keyboard.press('Escape');
});

Then('the Preferred Work Location\\(s) field should be displayed', async function () {
  await expect(
    this.page.getByRole('combobox', { name: /Preferred Work Location/i }).first()
  ).toBeVisible({ timeout: 15000 });
});

// ==================== Step 6: role interests ====================

When('the user selects role interests', async function () {
  await ob(this).selectRoleInterests();
});

// ==================== Assertions ====================

// Exact-match button-state assertions for the wizard. (The signup suite's generic
// "the {string} button should be ..." matches by substring, which mis-selects
// "Next" because the Graduate card text contains "my next role".)
Then('the onboarding {string} button should be disabled', async function (label) {
  const btn = this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(btn).toBeDisabled({ timeout: 15000 });
});

Then('the onboarding {string} button should be enabled', async function (label) {
  const btn = this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(btn).toBeEnabled({ timeout: 15000 });
});

Then('the onboarding {string} should be displayed', async function (text) {
  await expect(this.page.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first())
    .toBeVisible({ timeout: 15000 });
});

Then('the user should land on the getting started page', async function () {
  await this.page.waitForURL(/\/getting-started/, { timeout: 30000 });
  await expect(ob(this).welcomeHeading).toBeVisible({ timeout: 20000 });
});

Then('the profile completion should be {string}', async function (value) {
  await expect(this.page.getByText(value, { exact: true }).first())
    .toBeVisible({ timeout: 15000 });
});

Then('the profile completion should not be {string}', async function (value) {
  await this.page.waitForURL(/\/getting-started/, { timeout: 30000 });
  await expect(this.page.getByText(value, { exact: true })).toHaveCount(0);
});
