// Generates a readable Markdown test report for the Subscription module from the
// Cucumber JSON output. Run AFTER a subscription run:
//   node scripts/subscription-report.js
// Writes features/Candidate_Portal/SUBSCRIPTION_TEST_REPORT.md
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.resolve(__dirname, '../reports/cucumber-report.json');
const OUT_PATH = path.resolve(__dirname, '../features/Candidate_Portal/SUBSCRIPTION_TEST_REPORT.md');

const KNOWN_ISSUE_MAP = {
  'Yearly toggle should update the plan sub-card to the Yearly plan': 'M1 — TFF-163 AC14: sub-card not updated on yearly toggle',
  'Upgrade credit label should not duplicate the word "Plan"': 'M2 — TFF-405 AC8: credit label reads "… Plan Plan Credit"',
  'Billing history amount should be shown to two decimal places': 'M3 — TFF-416 AC22: amount shown without decimals ("SAR 155")',
  'Billing history date should use DD/MM/YY format': 'M4 — TFF-416 AC22: date rendered MM/DD/YY',
  'Receipt viewer should render the receipt document': 'M5 — TFF-416 AC22: intermittent "Failed to load document"',
};

function statusOf(el) {
  const steps = el.steps || [];
  if (steps.some((s) => s.result && s.result.status === 'failed')) return 'failed';
  if (steps.some((s) => s.result && s.result.status === 'skipped')) return 'skipped';
  if (steps.some((s) => s.result && s.result.status === 'undefined')) return 'undefined';
  return 'passed';
}

function tagsOf(el) {
  return (el.tags || []).map((t) => t.name);
}

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const scenarios = [];
for (const f of data) for (const el of f.elements || []) {
  if ((el.type || 'scenario') === 'background') continue;
  scenarios.push({ name: el.name, tags: tagsOf(el), status: statusOf(el) });
}

const total = scenarios.length;
const passed = scenarios.filter((s) => s.status === 'passed').length;
const failed = scenarios.filter((s) => s.status === 'failed').length;
const known = scenarios.filter((s) => s.tags.includes('@known-issue'));
const knownFailed = known.filter((s) => s.status === 'failed');
const regressions = scenarios.filter((s) => s.status === 'failed' && !s.tags.includes('@known-issue'));

const icon = (s) => (s === 'passed' ? '✅' : s === 'failed' ? '❌' : s === 'skipped' ? '⏭️' : '❓');
const tagStr = (t) => t.filter((x) => x !== '@subscription' && x !== '@candidate').join(' ');

let md = '';
md += '# Subscription Module — Test Execution Report\n\n';
md += `Feature: \`features/Candidate_Portal/Subscription.feature\` · App: dev.talentforge.com.sa\n\n`;
md += '> Generated from `reports/cucumber-report.json` by `scripts/subscription-report.js`.\n';
md += '> The default profile runs everything except `@not-automatable`; `@known-issue` scenarios are\n';
md += '> included on purpose and FAIL where the app deviates from the Jira AC (see the mismatch\n';
md += '> report `SUBSCRIPTION_JIRA_VS_APP.md`).\n\n';

md += '## Summary (default / CI profile)\n\n';
md += `| Metric | Count |\n|---|---|\n`;
md += `| Total scenarios | ${total} |\n`;
md += `| ✅ Passed | ${passed} |\n`;
md += `| ❌ Failed | ${failed} |\n`;
md += `| &nbsp;&nbsp;• of which \`@known-issue\` (expected) | ${knownFailed.length} |\n`;
md += `| &nbsp;&nbsp;• unexpected regressions | ${regressions.length} |\n\n`;
md += regressions.length === 0
  ? '**All failures are documented `@known-issue` defects — no unexpected regressions.**\n\n'
  : `**⚠ ${regressions.length} unexpected regression(s): ${regressions.map((r) => r.name).join('; ')}**\n\n`;

md += '## Results\n\n';
md += '| # | Scenario | Tags | Result |\n|---|---|---|---|\n';
scenarios.forEach((s, i) => {
  md += `| ${i + 1} | ${s.name.replace(/\|/g, '\\|')} | ${tagStr(s.tags)} | ${icon(s.status)} ${s.status} |\n`;
});
md += '\n';

md += '## Known issues (failing by design — assert the written Jira AC)\n\n';
if (known.length === 0) md += '_None in this run._\n\n';
else {
  md += '| Scenario | Result | Defect |\n|---|---|---|\n';
  for (const s of known) {
    md += `| ${s.name.replace(/\|/g, '\\|')} | ${icon(s.status)} ${s.status} | ${KNOWN_ISSUE_MAP[s.name] || ''} |\n`;
  }
  md += '\n';
}

md += '## Living spec (excluded from CI — `@not-automatable`)\n\n';
md += 'Real-payment / time-travel / forced-failure / fresh-account flows that cannot run\n';
md += 'idempotently on the shared live account. Several were verified live once on 2026-07-22\n';
md += '(full subscribe→pay→activate, upgrade+promo pay, downgrade schedule). Run on demand:\n';
md += '`npx cucumber-js -p notAutomatable features/Candidate_Portal/Subscription.feature`.\n\n';

md += '## How to run\n\n';
md += '```bash\n';
md += '# CI set (positive/negative/boundary/e2e + known-issue defects):\n';
md += 'npm test -- features/Candidate_Portal/Subscription.feature\n\n';
md += '# Just the known-issue defects:\n';
md += 'npx cucumber-js -p known features/Candidate_Portal/Subscription.feature\n\n';
md += '# Living-spec / real-payment flows (destructive):\n';
md += 'npx cucumber-js -p notAutomatable features/Candidate_Portal/Subscription.feature\n';
md += '```\n\n';
md += 'HTML report: `reports/cucumber-report.html` (failures: `reports/failed-report.html`).\n';

fs.writeFileSync(OUT_PATH, md);
console.log(`Wrote ${OUT_PATH}`);
console.log(`Total ${total} | passed ${passed} | failed ${failed} (known ${knownFailed.length}, regressions ${regressions.length})`);
