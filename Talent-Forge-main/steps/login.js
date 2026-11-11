const { Given, When, Then } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
require('dotenv').config();

const LOGIN_URL = process.env.BASE_URL;
const VALID_EMAIL = process.env.AGENT_EMAIL;
const VALID_PASSWORD = process.env.AGENT_PASSWORD;

for (const [name, value] of Object.entries({ BASE_URL: LOGIN_URL, AGENT_EMAIL: VALID_EMAIL, AGENT_PASSWORD: VALID_PASSWORD })) {
	if (!value) throw new Error(`Missing required env var ${name}. Set it in .env`);
}

let loginPage;
let googlePopup;

// ==================== Table-driven helpers ====================
//
// The login feature used Scenario Outlines for the three multi-input rules. An outline
// runs once per example, and every run pays for a fresh browser context + page (see
// hooks.js `Before`) to assert the same rule again — 16 contexts for 3 rules. These
// helpers let one scenario walk a data table inside a single context, collecting every
// row's failure so the report names all of them instead of abandoning at the first.

const submitButton = () => loginPage.submitButton.first();

// The gate settles asynchronously, so give the expected state a window before deciding
// the button is in the other one — a single read catches it mid-transition.
async function readSubmitState(expected) {
	const button = submitButton();
	try {
		if (expected === 'disabled') await expect(button).toBeDisabled({ timeout: 5000 });
		else await expect(button).toBeEnabled({ timeout: 5000 });
		return expected;
	} catch {
		return (await button.isDisabled()) ? 'disabled' : 'enabled';
	}
}

// Returns a description of what went wrong, or null when the generic error appeared.
async function genericErrorProblem() {
	const alert = loginPage.alert.first();
	try {
		await expect(alert).toBeVisible({ timeout: 20000 });
	} catch {
		return 'no error message was displayed';
	}
	const text = (await alert.innerText()).trim().replace(/\s+/g, ' ');
	if (!/No active account found|invalid|credentials/i.test(text)) {
		return `error message did not read as a generic credentials failure: "${text}"`;
	}
	return null;
}

// Disjunctive per project convention: an inline email helper OR a disabled submit button
// both count as "validation occurred".
async function emailValidationProblem() {
	if (await submitButton().isDisabled()) return null;
	try {
		await expect(loginPage.emailValidationMessage).toBeVisible({ timeout: 10000 });
		return null;
	} catch {
		return 'neither an inline email validation message nor a disabled submit button';
	}
}

function offLoginPageProblem() {
	const url = loginPage.page.url();
	return /\/login/.test(url) ? null : `the form was submitted — landed on ${url}`;
}

function startWalk(world, rowCount) {
	world._loginWalkRows = rowCount;
	world._loginWalkFailures = [];
}

function recordFailure(world, description) {
	world._loginWalkFailures.push(description);
}

function reportWalk(world, subject) {
	const rows = world._loginWalkRows || 0;
	const failures = world._loginWalkFailures || [];
	expect(rows, `no ${subject} rows were walked — the table did not reach the step`).toBeGreaterThan(0);
	if (failures.length) {
		throw new Error(
			`${failures.length} of ${rows} ${subject}s failed:\n  - ${failures.join('\n  - ')}`
		);
	}
}

Given('the user navigates to the login page', async function () {
	loginPage = new LoginPage(this.page);
	await loginPage.navigate();
});

// Fill the login form; an empty value leaves that field blank so a single scenario can
// exercise every field-completeness combination.
When('the user fills email {string} and password {string}', async (email, password) => {
	await loginPage.emailInput.fill(email);
	await loginPage.passwordInput.fill(password);
});

// ==================== Table-driven scenarios ====================

// Field-completeness gating. No reload between rows — filling both fields is enough to
// reset the form state, and the button is read per row rather than assumed.
When('the user fills the login form with each of these field combinations:', async function (table) {
	const rows = table.hashes();
	startWalk(this, rows.length);

	for (const { email, password, state } of rows) {
		const expected = (state || '').trim();
		await loginPage.emailInput.first().fill(email || '');
		await loginPage.passwordInput.first().fill(password || '');
		await loginPage.passwordInput.first().blur();

		const actual = await readSubmitState(expected);
		if (actual !== expected) {
			recordFailure(
				this,
				`email "${email || '(empty)'}" + password "${password ? '(set)' : '(empty)'}": ` +
					`expected the login button ${expected}, it was ${actual}`
			);
		}
	}
});

Then('the login button should have matched the expected state for every combination', function () {
	reportWalk(this, 'field combination');
});

// Wrong credentials. Each row reloads the login page so the previous attempt's alert
// cannot be mistaken for this one's, while still reusing the one browser context.
When('the user attempts to log in with each of these credential sets:', async function (table) {
	const rows = table.hashes();
	startWalk(this, rows.length);

	for (const { email, password } of rows) {
		await loginPage.navigate();
		await loginPage.emailInput.first().fill(email);
		await loginPage.passwordInput.first().fill(password);
		if (await submitButton().isEnabled()) await submitButton().click();

		const problems = [offLoginPageProblem(), await genericErrorProblem()].filter(Boolean);
		if (problems.length) recordFailure(this, `${email} / ${password}: ${problems.join('; ')}`);
	}
});

Then('every credential set should have been rejected with a generic error on the login page', function () {
	reportWalk(this, 'credential set');
});

// Malformed email formats, each against a valid password so the only invalid input is
// the email itself.
When('the user attempts to log in with each of these malformed emails:', async function (table) {
	const rows = table.hashes();
	startWalk(this, rows.length);

	for (const { email } of rows) {
		await loginPage.navigate();
		await loginPage.emailInput.first().fill(email);
		await loginPage.passwordInput.first().fill('StrongPass123!');
		if (await submitButton().isEnabled()) await submitButton().click();

		const validation = await emailValidationProblem();
		const problems = [
			validation && `no validation was surfaced — ${validation}`,
			offLoginPageProblem(),
		].filter(Boolean);
		if (problems.length) recordFailure(this, `"${email}": ${problems.join('; ')}`);
	}
});

Then('every malformed email should have been rejected without submitting the form', function () {
	reportWalk(this, 'malformed email');
});

When('the user enters valid email and password and removes both', async () => {
	const emailInput = loginPage.emailInput;
	const passwordInput = loginPage.passwordInput;

	await emailInput.fill(VALID_EMAIL);
	await passwordInput.fill(VALID_PASSWORD);
	await emailInput.fill('');
	await emailInput.blur();
	await passwordInput.fill('');
	await passwordInput.blur();
});

When('the user enters email {string}', async (email) => {
	await loginPage.emailInput.fill(email);
});

When('the user enters password {string}', async (password) => {
	await loginPage.passwordInput.fill(password);
});

// Single-row variants of the table walkers above; both go through the same readers so the
// two cannot drift into disagreeing about what the page shows.
Then('the login button should be disabled', async () => {
	expect(await readSubmitState('disabled')).toBe('disabled');
});

Then('the login button should be enabled', async () => {
	expect(await readSubmitState('enabled')).toBe('enabled');
});

Then('an error message should be displayed', async () => {
	const problem = await genericErrorProblem();
	expect(problem, problem || undefined).toBeNull();
});

Then('a success message should be displayed', async () => {
	const alert = loginPage.alert;
	await expect(alert).toBeVisible({ timeout: 20000 });
	await expect(alert).toContainText(/successfully|success/i);
});

Then('the inline validation message {string} should be visible', async (message) => {
	const inlineMessage = loginPage.page.getByText(new RegExp(message, 'i')).first();
	await expect(inlineMessage).toBeVisible({ timeout: 20000 });
});

Then('user should be redirected', async () => {
	await loginPage.page.waitForURL(/\/getting-started|\/dashboard/, { timeout: 30000 });
});

Then('the {string} should be visible', async (text) => {
	const pattern = new RegExp(text, 'i');
	const byLink = loginPage.page.getByRole('link', { name: pattern });
	const byButton = loginPage.page.getByRole('button', { name: pattern });
	const byText = loginPage.page.getByText(pattern);

	if (await byLink.count()) return expect(byLink.first()).toBeVisible({ timeout: 20000 });
	if (await byButton.count()) return expect(byButton.first()).toBeVisible({ timeout: 20000 });
	await expect(byText.first()).toBeVisible({ timeout: 20000 });
});

// ==================== Invalid credentials / email-format validation ====================

// Tolerant click: the submit button is disabled until the form is valid, so a click
// on an invalid form is a no-op rather than a hang.
When('the user clicks the login button', async () => {
	if (await loginPage.submitButton.isEnabled()) {
		await loginPage.submitButton.click();
	}
});

Then('the user should remain on the login page', async () => {
	await loginPage.page.waitForTimeout(500);
	expect(loginPage.page.url()).toMatch(/\/login/);
});

// Disjunctive per project convention: either an inline email helper is shown OR the
// submit button is disabled — both count as "validation occurred".
Then('a validation message should be displayed for the email field', async () => {
	const problem = await emailValidationProblem();
	expect(problem, problem ? `no validation was surfaced — ${problem}` : undefined).toBeNull();
});

Then('the form should not be submitted', async () => {
	const problem = offLoginPageProblem();
	expect(problem, problem || undefined).toBeNull();
});

// ==================== Password visibility toggle ====================

Then('the password field should be masked', async () => {
	await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
});

When(/the user taps the password show\/hide toggle/, async () => {
	await loginPage.passwordToggle.click();
});

Then('the password field should be visible as plain text', async () => {
	await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
});

// ==================== Navigation: Forgot Password / Sign Up ====================

When('the user clicks the {string} link', async (label) => {
	if (/forgot password/i.test(label)) {
		await loginPage.forgotPasswordLink.click();
	} else if (/sign\s*up/i.test(label)) {
		await loginPage.signUpLink.click();
	} else {
		await loginPage.page.getByRole('link', { name: new RegExp(label, 'i') }).first().click();
	}
});

Then('the user should be redirected to the Forgot Password page', async () => {
	await loginPage.page.waitForURL(/\/forgot-password/, { timeout: 30000 });
});

Then('the user should be redirected to the Sign Up page', async () => {
	await loginPage.page.waitForURL(/\/sign-?up/, { timeout: 30000 });
});

// ==================== Google OAuth ====================

When('the user clicks the {string} button', async (label) => {
	if (/google/i.test(label)) {
		const popupPromise = loginPage.page
			.context()
			.waitForEvent('page', { timeout: 20000 })
			.catch(() => null);
		await loginPage.googleButton.click();
		googlePopup = await popupPromise;
	} else {
		await loginPage.page.getByRole('button', { name: new RegExp(label, 'i') }).first().click();
	}
});

Then('the Google authentication popup should be displayed', async () => {
	expect(googlePopup, 'expected a Google OAuth popup window to open').toBeTruthy();
	await googlePopup.waitForLoadState('domcontentloaded').catch(() => {});
	expect(googlePopup.url()).toMatch(/accounts\.google\.com/);
});

// ==================== Base account login / logout ====================

// "Base account" == the primary AGENT credentials from .env.
When('the user enters the base account email', async () => {
	await loginPage.emailInput.fill(VALID_EMAIL);
});

When('the user enters the base account password', async () => {
	await loginPage.passwordInput.fill(VALID_PASSWORD);
});

// Opens the header avatar menu (auto-waits for the post-login shell to render).
When('the user opens the profile menu', async function () {
	await this.pages.dashboard.openProfileMenu();
});

When('the user clicks the logout option', async function () {
	await this.pages.dashboard.clickLogout();
});

Then('the user should be redirected to the login page', async function () {
	await this.page.waitForURL(/\/login(\/|\?|$)/, { timeout: 30000 });
	expect(this.page.url()).toMatch(/\/login/);
});

// De-auth check: a logged-out user hitting a protected route is bounced to /login.
Then('the user should not be authenticated', async function () {
	const dashboardUrl = LOGIN_URL.replace(/\/login\/?$/, '/dashboard');
	await this.page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
	await this.page.waitForURL(/\/login(\/|\?|$)/, { timeout: 30000 });
	expect(this.page.url()).toMatch(/\/login/);
});