const { Given, When, Then, After } = require('../fixtures/bdd');
const { expect } = require('@playwright/test');
require('dotenv').config();

const { provisionAgentWithoutPromo } = require('../utils/promoAgentProvision');
const AgentsListingPage = require('../pages/AgentsListingPage');
const {
  captureAgentEmail,
  captureAgentEmailByBody,
  expectSender,
  expectSubject,
  expectGreetsRecipient,
  expectBodyStates,
  expectActionableLink,
  fatalProblems,
  describeEvidence,
  latestUid,
  latestUidForRecipient,
} = require('../utils/agentEmailEvidence');

// Step definitions for features/Notifications/Agent-Email-Notifications.feature.
//
// `Given I am logged in as the superadmin` and `Given I am on the Agents listing` are NOT
// defined here - invite-agent.steps.js and agent.steps.js own them respectively, and Cucumber
// loads every step file into one registry, so redefining either would throw an ambiguous-step
// error and take three features down at once.
//
// THE RULE THIS FILE IS BUILT AROUND. An email assertion has three independent ways to fail -
// the mail never arrived, it arrived with the wrong subject, or it arrived saying the wrong
// thing - and they call for completely different responses from whoever reads the report. So no
// step here throws on the first thing it finds wrong: each collects every problem across every
// mail it is responsible for and throws once, with the whole picture. Cucumber abandons a
// scenario at its first failing step, so a step that stopped early would hide the rest of the
// same mail, and a scenario asserting two mails would only ever report the first.
//
// EVERY MAIL IS ATTACHED TO THE REPORT WHETHER OR NOT IT PASSED. On a red row it is the
// evidence; on a green one it is the record of what the app actually sent on the day the run
// passed, which is what makes a later wording change diagnosable rather than mysterious.

const listing = (world) => world.pages.agentsListing;

// Where the throwaway agents this file provisions are kept, so the After hook can report them.
function throwaways(world) {
  if (!world._agentEmailThrowaways) world._agentEmailThrowaways = [];
  return world._agentEmailThrowaways;
}

function subjectAgent(world) {
  if (!world._agentEmailSubject || !world._agentEmailSubject.email) {
    throw new Error(
      'No agent has been chosen for the email assertions - a Given that provisions a throwaway '
      + 'or finds a flagged agent has to run first.'
    );
  }
  return world._agentEmailSubject;
}

// A fresh address on the SAME inbox the suite reads, for the email-change scenario.
//
// It has to be a `+tag` off GMAIL_USER: the change is only observable if the verification mail
// lands somewhere readable, and bytecorp preserves the +alias in the To header so the new
// address can be told apart from the old one. A random external address would deliver the mail
// nowhere this suite can see and the scenario would report a missing email.
let freshSeq = 0;
function freshAddress(prefix = 'agentmail') {
  freshSeq += 1;
  const inbox = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
  const [local, domain] = inbox.split('@');
  return `${local}+${prefix}${Date.now().toString(36)}${freshSeq}@${domain}`;
}

function attachEvidence(world, ...evidences) {
  world.attach(evidences.map(describeEvidence).join('\n\n'), 'text/plain');
}

// Throw once with every problem found across every mail, or pass.
function reportAll(context, evidences) {
  const problems = [];
  for (const e of evidences) {
    const label = e.type || e.templateKey || 'email';
    fatalProblems(e).forEach((p) => problems.push(`[${label}] ${p}`));
  }
  if (problems.length) {
    throw new Error(
      `${context}\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}\n\n`
      + 'The full text of every email read is attached to this step.'
    );
  }
}

// ==================== Provisioning the subject ====================

// A brand-new agent, invited and accepted, that this scenario owns outright.
//
// It is invited WITHOUT a promo code on purpose - none of these scenarios touch promo state, and
// an unnecessary promo would put a second set of notifications in flight on the same inbox.
Given('I have provisioned a throwaway agent for email notifications', { timeout: 600000 },
  async function () {
    const agent = await provisionAgentWithoutPromo(this.browser, {
      label: 'agent-email-throwaway',
      firstName: 'Mailnotif',
      tagPrefix: 'agmail',
    });
    this._agentEmailSubject = agent;
    throwaways(this).push(agent);
    this.attach(
      `Provisioned throwaway agent for this scenario:\n`
      + `  name  : ${agent.name}\n  email : ${agent.email}\n`
      + 'It is abandoned when the scenario ends - nothing in .env refers to it.',
      'text/plain'
    );
    // Come back to the listing: provisioning drove its own contexts and the Background's page
    // is still on the Agents listing, but the new agent will not be in the rendered rows yet.
    await listing(this).goto('Active');
    await listing(this).search(agent.name);
  });

// The flagged agent for the reminder scenarios.
//
// HUNTS rather than assumes. A freshly invited agent is Active, so it has no Notify action at
// all - only an agent the app itself put on Requires Attention can be sent a reminder. And the
// mail is only readable if the address is a +tag off the suite's own inbox: measured 2026-08-12,
// three of the ten agents on that tab qualify and seven are on @addy.com / @gmail.com addresses
// whose mail this suite cannot see. Reporting that plainly beats timing out on an inbox read.
Given('I have found a flagged agent whose mail the suite can read', { timeout: 180000 },
  async function () {
    const inbox = process.env.GMAIL_USER || 'iqra.farooq@bytecorp.io';
    const [local, domain] = inbox.split('@');
    await listing(this).goto('Requires Attention');
    await listing(this).settle();
    const rows = await listing(this).readRows();
    const considered = [];
    let chosen = null;
    for (const row of rows) {
      const email = (row.text.match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0];
      const readable = email.startsWith(`${local}+`) && email.endsWith(`@${domain}`);
      const canNotify = row.actions.some((a) => /notify/i.test(a));
      considered.push(`${email || '(no email in row)'} - readable:${readable ? 'yes' : 'no'}, Notify:${canNotify ? 'yes' : 'no'}`);
      if (readable && canNotify && !chosen) {
        // The name is what the listing search matches on (TFF-532: it ignores email), so keep it.
        const name = row.text.split(/\s{2,}|\n/).map((s) => s.trim()).find((s) => s && !s.includes('@')) || '';
        chosen = { email, name, flagged: true };
      }
    }
    if (!chosen) {
      throw new Error(
        'No agent on the Requires Attention tab has an address this suite can read mail for, so no '
        + 'reminder email could be verified.\n\nA usable agent needs BOTH a Notify action and an '
        + `address of the form ${local}+<tag>@${domain} - an @iqra.anonaddy.com alias is no good `
        + 'because anonaddy strips the +alias, leaving two agents\' mail indistinguishable.\n\n'
        + `Rows considered:\n${considered.map((c) => `  - ${c}`).join('\n')}\n\n`
        + 'Provisioning will not fix this: a freshly invited agent is Active, not flagged. Wait for '
        + 'an existing +tag throwaway to be flagged, or ask dev how an agent is put on this tab.'
      );
    }
    this._agentEmailSubject = chosen;
    this.attach(`Flagged agent chosen: ${chosen.name} <${chosen.email}>\n\nRows considered:\n`
      + considered.map((c) => `  - ${c}`).join('\n'), 'text/plain');
  });

// ==================== Inbox baselines ====================
//
// EVERY BASELINE IS TAKEN BEFORE THE TRIGGERING ACTION, and that is not optional. These are
// long-lived inboxes holding every previous run's mail - 13,495 messages on 2026-08-12 - so
// "a message with this subject exists" proves nothing whatsoever. Only "a message NEWER than
// UID N" does. Without the baseline every one of these scenarios would pass on a mail from
// weeks ago, including the ones that exist to prove a mail is never sent.

Given("I have baselined the inbox for that agent's email-change mails", { timeout: 180000 },
  async function () {
    const agent = subjectAgent(this);
    this._agentEmailNewAddress = freshAddress('agentnew');
    this._agentEmailBaselines = {
      changed: await latestUid({ subject: 'Your Talentforge account email was changed', to: agent.email }).catch(() => 0),
      verify: await latestUid({ subject: 'Verify your new Talentforge email address', to: this._agentEmailNewAddress }).catch(() => 0),
    };
    this.attach(
      `Email-change baselines for ${agent.email}:\n`
      + `  new address        : ${this._agentEmailNewAddress}\n`
      + `  "was changed" UID  : ${this._agentEmailBaselines.changed}\n`
      + `  "verify new" UID   : ${this._agentEmailBaselines.verify}`,
      'text/plain'
    );
  });

Given("I have baselined the inbox for that agent's lifecycle mails", { timeout: 180000 },
  async function () {
    const agent = subjectAgent(this);
    this._agentEmailBaselines = {
      deactivated: await latestUid({ subject: 'Your Talentforge account Has Been Deactivated', to: agent.email }).catch(() => 0),
      reactivated: await latestUid({ subject: 'Your Talentforge account Has Been Reactivated', to: agent.email }).catch(() => 0),
    };
    this.attach(
      `Lifecycle baselines for ${agent.email}:\n`
      + `  deactivated UID : ${this._agentEmailBaselines.deactivated}\n`
      + `  reactivated UID : ${this._agentEmailBaselines.reactivated}`,
      'text/plain'
    );
  });

Given("I have baselined the inbox for that agent's reminder mails", { timeout: 180000 },
  async function () {
    const agent = subjectAgent(this);
    // Baselined per SUBJECT for the reminder that exists, and by RECIPIENT as well, because the
    // step asserts whichever reminder the dialog promises and that may not be this subject.
    this._agentEmailBaselines = {
      monthlyTarget: await latestUid({ subject: 'Reminder: Monthly target progress', to: agent.email }).catch(() => 0),
      anyMail: await latestUidForRecipient(agent.email).catch(() => 0),
    };
    this.attach(
      `Reminder baselines for ${agent.email}:\n`
      + `  "Monthly target progress" UID : ${this._agentEmailBaselines.monthlyTarget}\n`
      + `  newest mail to this agent UID : ${this._agentEmailBaselines.anyMail}`,
      'text/plain'
    );
  });

Given("I have baselined the inbox for that agent's transfer mails", { timeout: 180000 },
  async function () {
    const agent = subjectAgent(this);
    // By RECIPIENT, not subject: this mail has never been sent, so there is no subject to
    // baseline against. captureAgentEmailByBody searches the body instead.
    this._agentEmailBaselines = { anyMail: await latestUidForRecipient(agent.email).catch(() => 0) };
    this.attach(`Transfer baseline for ${agent.email}: newest mail UID ${this._agentEmailBaselines.anyMail}`, 'text/plain');
  });

// ==================== 1. The email-change pair ====================

When("I update that agent's email address to a fresh address", { timeout: 240000 },
  async function () {
    const agent = subjectAgent(this);
    const newAddress = this._agentEmailNewAddress;
    if (!newAddress) throw new Error('No fresh address was prepared - the baseline Given has to run first.');
    await listing(this).goto('Active');
    await listing(this).search(agent.name);
    await listing(this).openEmailDialog(agent.email);
    await listing(this).fillNewEmail(newAddress, newAddress);
    const toasts = await listing(this).confirmEmailUpdate();
    this._agentEmailChangeToasts = toasts;
    this.attach(
      `Committed an email change for ${agent.name}:\n  from : ${agent.email}\n  to   : ${newAddress}\n`
      + `Toast: ${JSON.stringify(toasts)}`,
      'text/plain'
    );
  });

// One step, both mails, every mismatch reported together - see the note at the top of the file.
Then('both email-change notifications should be correct:', { timeout: 420000 },
  async function (dataTable) {
    const agent = subjectAgent(this);
    const rows = dataTable.hashes();
    const evidences = [];

    for (const row of rows) {
      const which = row.mail.trim().toLowerCase();
      const isVerify = /verify/.test(which);
      const type = isVerify ? 'agentEmailVerify' : 'agentEmailChanged';
      const recipient = row.to.trim().toLowerCase() === 'new' ? this._agentEmailNewAddress : agent.email;
      const afterUid = isVerify ? this._agentEmailBaselines.verify : this._agentEmailBaselines.changed;

      const evidence = await captureAgentEmail(type, { to: recipient, afterUid, timeoutMs: 180000 });
      expectSender(evidence);
      // The subject AS SENT, not the search key that found it. See emailTypes.js.
      expectSubject(evidence, row.subject.trim());
      // The greeting is asserted to NAME the agent, not merely to exist: the live verification
      // mail greets "Hi ," with the name missing, and a body-contains check for any other
      // sentence in it passes straight over that.
      expectGreetsRecipient(evidence, agent.name);
      if (isVerify) {
        expectBodyStates(evidence, 'verify your new email address', { label: 'verification mail' });
        expectActionableLink(evidence, { label: 'verification link' });
      } else {
        expectBodyStates(evidence, 'email address associated with your', { label: 'change notice' });
      }
      evidences.push(evidence);
      if (isVerify) this._agentEmailVerifyEvidence = evidence;
    }

    attachEvidence(this, ...evidences);
    reportAll(
      `The email change for ${agent.name} <${agent.email}> did not produce both notifications correctly.`,
      evidences
    );
  });

Then('the verification email should carry a working verification link', { timeout: 240000 },
  async function () {
    const evidence = this._agentEmailVerifyEvidence;
    if (!evidence || !evidence.delivered) {
      throw new Error('The verification email was never captured, so its link cannot be followed.');
    }
    // The only actionable URL in this mail is a SendGrid click wrapper, so "working" means the
    // wrapper resolves to the app's own verify route - not that the wrapper itself is a 200.
    const context = await this.browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(evidence.extracted, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(3000);
      const landed = page.url();
      this.attach(`Followed the verification link:\n  ${evidence.extracted}\n  landed on: ${landed}`, 'text/plain');
      expect(
        landed,
        `the verification link should land on the app's verify route, but it landed on ${landed}`
      ).toMatch(/verify|email|confirm/i);
    } finally {
      await context.close().catch(() => {});
    }
  });

// ==================== 2. Deactivation and re-activation ====================

When('I deactivate that agent', { timeout: 240000 }, async function () {
  const agent = subjectAgent(this);
  await listing(this).goto('Active');
  await listing(this).search(agent.name);
  await listing(this).openDeactivateDialog(agent.email);
  const toasts = await listing(this).confirmDeactivate();
  this._agentEmailDeactivated = true;
  this.attach(`Deactivated ${agent.name} <${agent.email}>. Toast: ${JSON.stringify(toasts)}`, 'text/plain');
});

When('I re-activate that agent', { timeout: 240000 }, async function () {
  const agent = subjectAgent(this);
  await listing(this).goto('Deactivated');
  await listing(this).search(agent.name);
  await listing(this).openReactivateDialog(agent.email);
  const toasts = await listing(this).confirmReactivate();
  this._agentEmailDeactivated = false;
  this.attach(`Re-activated ${agent.name} <${agent.email}>. Toast: ${JSON.stringify(toasts)}`, 'text/plain');
});

// Delivery and subject only. The wording is asserted by the LAST step of the scenario on
// purpose: a wrong sentence must not cost the two delivery assertions, which are the ones that
// say whether the notification fires at all.
Then('that agent should be emailed that their account was deactivated', { timeout: 300000 },
  async function () {
    const agent = subjectAgent(this);
    const evidence = await captureAgentEmail('agentDeactivated', {
      to: agent.email,
      afterUid: this._agentEmailBaselines.deactivated,
      timeoutMs: 240000,
    });
    expectSender(evidence);
    // LOWER CASE, and that was measured rather than chosen. The inbox holds both casings of
    // this subject; committing a real deactivation on 2026-08-12 showed the AGENT path sends
    // lower case (uid 20308). The Title Case variant belongs to another path.
    expectSubject(evidence, 'Your Talentforge account has been deactivated');
    this._agentEmailDeactivateEvidence = evidence;
    attachEvidence(this, evidence);
    reportAll(`The deactivation email for ${agent.email} was not delivered as specified.`, [evidence]);
  });

Then('that agent should be emailed that their account was reactivated', { timeout: 300000 },
  async function () {
    const agent = subjectAgent(this);
    const evidence = await captureAgentEmail('agentReactivated', {
      to: agent.email,
      afterUid: this._agentEmailBaselines.reactivated,
      timeoutMs: 240000,
    });
    expectSender(evidence);
    // Lower case for the same measured reason as the deactivation subject (uid 20310).
    expectSubject(evidence, 'Your Talentforge account has been reactivated');
    this._agentEmailReactivateEvidence = evidence;
    attachEvidence(this, evidence);
    reportAll(`The re-activation email for ${agent.email} was not delivered as specified.`, [evidence]);
  });

Then('the two lifecycle emails should each name the agent and describe the right state',
  { timeout: 120000 }, async function () {
    const agent = subjectAgent(this);
    const deact = this._agentEmailDeactivateEvidence;
    const react = this._agentEmailReactivateEvidence;
    if (!deact || !react) {
      throw new Error('Both lifecycle emails have to be captured before their wording can be compared.');
    }
    // Reset the problem lists: delivery and subject were already asserted and passed, and
    // repeating them here would double-report them.
    [deact, react].forEach((e) => { e.problems = { delivery: [], identity: [], content: [], figmaCopy: [] }; });

    expectGreetsRecipient(deact, agent.name);
    // "agent account" is the phrase that distinguishes this mail from the candidate-facing
    // deactivation notice, which shares its subject line.
    expectBodyStates(deact, 'agent account has been deactivated', { label: 'deactivation notice' });
    expectBodyStates(deact, 'no longer have access', { label: 'deactivation notice' });

    expectGreetsRecipient(react, agent.name);
    expectBodyStates(react, 'has been reactivated', { label: 'reactivation notice' });
    expectBodyStates(react, 'access and use your account as usual', { label: 'reactivation notice' });

    attachEvidence(this, deact, react);
    reportAll(`The lifecycle emails for ${agent.email} did not read as specified.`, [deact, react]);
  });

// ==================== 3 & 4. The reminder dialog ====================

When('I open the Notify dialog for that flagged agent', { timeout: 120000 }, async function () {
  const agent = subjectAgent(this);
  await listing(this).goto('Requires Attention');
  await listing(this).search(agent.name);
  await listing(this).openNotifyDialog(agent.email);
  this._agentEmailNotifyDialog = await listing(this).readNotifyDialog();
  this.attach(`Notify dialog for ${agent.email}:\n${JSON.stringify(this._agentEmailNotifyDialog, null, 2)}`, 'text/plain');
});

When('I send the reminder the dialog offers', { timeout: 180000 }, async function () {
  const result = await listing(this).confirmSendReminder();
  this._agentEmailReminder = result;
  this.attach(
    `Sent the reminder.\n  type the dialog named : ${result.reminderType || '(none recognised)'}\n`
    + `  dialog body           : ${result.dialogBody}\n  toast                 : ${JSON.stringify(result.toasts)}`,
    'text/plain'
  );
});

// Asserts the mail matching WHAT THE DIALOG PROMISED, not a hardcoded subject. The dialog names
// one type today; reading the promise and then checking it was kept is the assertion that stays
// correct if the app ever offers more.
// THE BUTTON AND THE SCHEDULER SEND DIFFERENT TEMPLATES FOR THE SAME REMINDER, so the subject
// expected here is the ON-DEMAND one. Measured 2026-08-12 against one flagged agent:
//   automatic  uid 20306  "Reminder: Monthly target progress"
//   the button uid 20311  "Subject: Monthly target delay reminder"
// Asserting the automatic subject after clicking the button is what made this scenario time out
// on the first run: the mail it was waiting for is sent by a nightly job, not by the click.
const REMINDER_MAIL_FOR_TYPE = {
  monthlyTarget: {
    type: 'agentMonthlyTargetReminderOnDemand',
    subject: 'Subject: Monthly target delay reminder',
  },
  activity: { type: 'agentActivityReminder', subject: 'Reminder: Log back into Talentforge' },
};

Then('that agent should receive the reminder the dialog promised', { timeout: 420000 },
  async function () {
    const agent = subjectAgent(this);
    const sent = this._agentEmailReminder;
    if (!sent) throw new Error('No reminder has been sent yet.');
    if (!sent.reminderType) {
      throw new Error(
        'The Send Reminder dialog named no recognisable reminder type, so there is no way to know '
        + `which email to expect. The dialog read: ${sent.dialogBody}`
      );
    }
    const mail = REMINDER_MAIL_FOR_TYPE[sent.reminderType];
    if (!mail) {
      throw new Error(
        `The dialog offered the "${sent.reminderType}" reminder, which no registered email type `
        + 'corresponds to. Register its subject in emailTypes.js - measured from the delivered '
        + 'message, never guessed - and add it to REMINDER_MAIL_FOR_TYPE here.'
      );
    }
    // BASELINE BY RECIPIENT, not by the subject that was baselined for the automatic reminder.
    // Since the button turned out to send a DIFFERENT subject from the scheduler, a baseline taken
    // from the scheduler's subject is only a loose lower bound on the mailbox - an older
    // "Subject: Monthly target delay reminder" to the same agent could carry a higher UID and be
    // mistaken for this click's mail. The newest UID addressed to the agent before the click is
    // the tight, correct bound; both are kept and the larger wins.
    const afterUid = Math.max(
      this._agentEmailBaselines.monthlyTarget || 0,
      this._agentEmailBaselines.anyMail || 0
    );
    const evidence = await captureAgentEmail(mail.type, {
      to: agent.email,
      afterUid,
      timeoutMs: 300000,
    });
    expectSender(evidence);
    expectSubject(evidence, mail.subject);
    this._agentEmailReminderEvidence = evidence;
    attachEvidence(this, evidence);
    reportAll(
      `The "${sent.reminderType}" reminder the dialog promised did not reach ${agent.email} as specified.`,
      [evidence]
    );
  });

Then('the reminder email should name the agent and state its purpose', { timeout: 120000 },
  async function () {
    const agent = subjectAgent(this);
    const evidence = this._agentEmailReminderEvidence;
    if (!evidence || !evidence.delivered) {
      throw new Error('The reminder email was never captured, so its wording cannot be read.');
    }
    evidence.problems = { delivery: [], identity: [], content: [], figmaCopy: [] };
    expectGreetsRecipient(evidence, agent.name);
    expectBodyStates(evidence, 'monthly targets', { label: 'reminder' });
    attachEvidence(this, evidence);
    reportAll(`The reminder email to ${agent.email} did not read as specified.`, [evidence]);
  });

// PLACED LAST IN ITS SCENARIO ON PURPOSE. The subject defect fires on every on-demand reminder,
// so while it sat earlier it would cost the delivery and body assertions above - the ones that
// say whether the reminder works at all. Same rule as the receipt-PDF currency step.
Then('the reminder email\'s subject should not carry a literal "Subject:" label',
  async function () {
    const evidence = this._agentEmailReminderEvidence;
    if (!evidence || !evidence.delivered) {
      throw new Error('The reminder email was never captured, so its subject cannot be read.');
    }
    expect(
      evidence.actualSubject,
      'The reminder\'s subject line has the header label baked into its VALUE, so the agent\'s mail '
      + `client renders "Subject: ${evidence.actualSubject}". The app sent `
      + `${JSON.stringify(evidence.actualSubject)}.\n\n`
      + 'Note this is the template the Send Reminder BUTTON uses. The same reminder sent '
      + 'automatically arrives as "Reminder: Monthly target progress", which is clean - so the '
      + 'two paths use different templates and only the on-demand one is malformed.'
    ).not.toMatch(/^\s*Subject\s*:/i);
  });

// The reminder-type gap. Costs no email and no provisioning - the whole finding is in the DOM.
Then('the dialog should offer a way to choose the reminder type', async function () {
  const dialog = this._agentEmailNotifyDialog;
  if (!dialog) throw new Error('The Notify dialog has not been opened.');
  const controls = await this.page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((x) => /send reminder/i.test(x.innerText || ''));
    if (!d) return null;
    return {
      selects: Array.from(d.querySelectorAll('select')).length,
      radios: Array.from(d.querySelectorAll('input[type=radio]')).length,
      comboboxes: Array.from(d.querySelectorAll('[role="combobox"],[aria-haspopup="listbox"]')).length,
      invitesAChoice: /select reminder type/i.test(d.innerText || ''),
    };
  });
  this.attach(`Reminder-type controls in the dialog: ${JSON.stringify(controls)}`, 'text/plain');
  const offersChoice = controls
    && (controls.selects > 0 || controls.radios > 0 || controls.comboboxes > 0);
  expect(
    offersChoice,
    'The dialog renders the label "Select Reminder Type" but provides NOTHING to select with - no '
    + `<select>, no radio group and no combobox (${JSON.stringify(controls)}). So the superadmin is `
    + 'invited to choose a reminder type and cannot, and only one of the reminder templates the '
    + 'design defines can ever be sent from here.'
  ).toBe(true);
});

Then('the dialog should offer each reminder type the design defines:', async function (dataTable) {
  const dialog = this._agentEmailNotifyDialog;
  if (!dialog) throw new Error('The Notify dialog has not been opened.');
  const body = String(dialog.body || '');
  const problems = [];
  for (const row of dataTable.hashes()) {
    const wanted = row['reminder type'].trim();
    // Match on the distinctive words, not the exact label - the dialog writes
    // "Monthly Target Delay Reminder" where the table says "Monthly Target Delay".
    const words = wanted.split(/\s+/).filter((w) => w.length > 3);
    const present = words.every((w) => new RegExp(w, 'i').test(body));
    if (!present) {
      problems.push(
        `"${wanted}" (${row['figma template']}) is not offered - the dialog names only `
        + `"${(body.match(/Select Reminder Type\s*(.+?)\s*(?:Reminds|Message Preview)/i) || [, '(nothing)'])[1]}"`
      );
    }
  }
  if (problems.length) {
    throw new Error(
      'The Send Reminder dialog does not offer every reminder type the Figma board defines. '
      + 'Measured across eight flagged agents on 2026-08-12, it offers exactly one and it does not '
      + 'vary by agent, so the type does not follow the flag reason either.\n\n'
      + `${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}\n\n`
      + `Dialog body:\n  ${body}`
    );
  }
});

// ==================== 5. The transfer email ====================

// The donor comes from agent.steps.js's own `Given I have found an agent holding active
// candidates`, which filters the listing by candidate count and reads the SERVER'S payload. It
// leaves the agent on `world._agent`.
//
// A bespoke version of this step scanned rendered rows for a candidate count and found nothing on
// the run of 2026-08-12 - `readRows()` does not expose that figure the way it assumed, so the
// scenario failed with "no donor found" rather than reaching the defect it exists to report.
// Reusing the step that already does it correctly is the repo's own rule and is also shorter.
When('I transfer those candidates to the throwaway agent', { timeout: 300000 }, async function () {
  const donor = this._agent;
  if (!donor || !donor.email) {
    throw new Error(
      'No donor agent is on the World. This step needs `Given I have found an agent holding '
      + 'active candidates` (agent.steps.js) to run first - that is what filters the listing and '
      + 'records the subject.'
    );
  }
  await listing(this).goto('Active');
  await listing(this).search(donor.name);
  await listing(this).openDeactivateDialog(donor.email);
  const dialog = await listing(this).readDeactivateDialog();
  const picker = await listing(this).transferAgentOptions();
  this._agentEmailTransfer = { attempted: true, picker, donorEmail: donor.email, dialog };
  this.attach(
    `Donor: ${donor.name} <${donor.email}> holding ${donor.candidates} candidate(s) at `
    + `"${donor.university}".\nConfirm button: ${dialog && dialog.confirmLabel} `
    + `(disabled: ${dialog && dialog.confirmDisabled})\nTransfer picker:\n${JSON.stringify(picker, null, 2)}`,
    'text/plain'
  );
  // Nothing is committed here. If the picker ever offers agents, choosing the throwaway and
  // confirming belongs in this step - but it must never guess a target, because a transfer is
  // the one action in this module with no undo anywhere in the portal.
  await listing(this).closeTransferSuggestions().catch(() => {});
  await listing(this).cancelDeactivateDialog().catch(() => {});
});

Then('the throwaway agent should be emailed that candidates were transferred to them',
  { timeout: 300000 }, async function () {
    const agent = subjectAgent(this);
    const transfer = this._agentEmailTransfer;
    // If the picker offered nobody, the transfer could not be committed and the email cannot
    // exist. Say exactly that, and point at the defect that owns it - rather than reporting a
    // missing email, which would send the reader after a second, apparently-separate bug.
    if (transfer && transfer.picker && !transfer.picker.offered.length) {
      throw new Error(
        'The candidates-transferred email cannot be reached at all, because the transfer itself '
        + 'cannot be committed.\n\n'
        + `The receiving-agent picker for ${transfer.donorEmail} offered NO agents and rendered: `
        + `${JSON.stringify(transfer.picker.emptyState)}\n\n`
        + 'THIS IS THE SAME DEFECT already asserted in '
        + 'SuperAdmin_Portal/UserManagement/Agent.feature, "Verify that the transfer picker offers '
        + 'the other agents of the same university" (@known-issue) - the picker claims no agents '
        + 'exist at a university that demonstrably holds others, leaving Transfer & Deactivate '
        + 'permanently disabled. Fix that and this scenario turns green without being rewritten.\n\n'
        + 'This scenario does not re-assert the picker on purpose; it asserts the EMAIL, which '
        + 'nothing else covers.'
      );
    }
    const evidence = await captureAgentEmailByBody('candidatesTransferred', {
      to: agent.email,
      afterUid: this._agentEmailBaselines.anyMail,
      timeoutMs: 180000,
    });
    attachEvidence(this, evidence);
    reportAll(`No candidates-transferred email reached ${agent.email}.`, [evidence]);
  });

// ==================== 6. The two templates whose trigger is unverified ====================
//
// `() => 'pending'` on purpose, and the feature file explains why at length: the trigger -
// deactivating an individual candidate from the superadmin portal - is a flow no feature file
// drives and no Page Object covers, so there is nothing measured to build on. A scenario written
// against an unconfirmed UI would report "the email is missing" when the real answer might be
// "the suite never performed the trigger".
const manual = () => 'pending';
Given('a candidate of a throwaway agent is deactivated by a superadmin', manual);
Given('a candidate of a throwaway agent is re-activated by a superadmin', manual);
Then("that agent should be emailed that their candidate's account was deactivated", manual);
Then("that agent should be emailed that their candidate's account was reactivated", manual);

// ==================== Teardown ====================
//
// The throwaway agents are ABANDONED, not cleaned up, and that is deliberate. There is no way to
// delete an agent from the portal, so "cleanup" could only mean deactivating it - which would
// send yet another live email and, worse, would fire the very notification a later scenario in
// the same run is baselining for. The hook records what was created so the accounts are
// identifiable, and re-activates one only if a scenario died with it deactivated.
After({ tags: '@agent-email', timeout: 240000 }, async function () {
  const created = throwaways(this);
  if (created.length) {
    this.attach(
      'Throwaway agents this scenario created and abandoned:\n'
      + created.map((a) => `  ${a.name} <${a.email}>`).join('\n')
      + '\nThey are not deleted - the portal offers no way to delete an agent - and nothing in '
      + '.env refers to them.',
      'text/plain'
    );
  }
  // Only restores if the scenario died between deactivate and re-activate. Never throws:
  // masking the scenario's own failure with a cleanup error would be worse, and the agent is a
  // throwaway either way.
  if (this._agentEmailDeactivated && this._agentEmailSubject) {
    const agent = this._agentEmailSubject;
    try {
      await listing(this).goto('Deactivated');
      await listing(this).search(agent.name);
      await listing(this).openReactivateDialog(agent.email);
      await listing(this).confirmReactivate();
      this.attach(`Left ${agent.email} deactivated mid-scenario; re-activated it.`, 'text/plain');
    } catch (error) {
      this.attach(
        `Could not re-activate the throwaway ${agent.email} after a mid-scenario failure: `
        + `${error.message}\nIt is a throwaway, so this is a note rather than a problem.`,
        'text/plain'
      );
    }
  }
});
