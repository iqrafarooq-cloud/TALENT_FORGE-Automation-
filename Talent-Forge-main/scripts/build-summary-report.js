// Opens or re-renders the run's client/PM-facing summary (configs/summaryReportReporter.js).
//
//   npm run test:report:pdf      open reports/Test-Summary-Report.pdf
//   npm run report:pdf:rebuild   re-render the PDF (and its .html twin) from
//                                reports/summary-report-data.json - e.g. after changing the
//                                report's layout, or if rendering failed at the end of a run.
//                                It never re-runs a test: the data is the run's own record.
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { renderReport } = require('../configs/summaryReportReporter');

const REPORTS = path.resolve(__dirname, '..', 'reports');
const PDF = path.join(REPORTS, 'Test-Summary-Report.pdf');
const DATA = path.join(REPORTS, 'summary-report-data.json');

function open(file) {
  const cmd = process.platform === 'win32' ? `start "" "${file}"` : process.platform === 'darwin' ? `open "${file}"` : `xdg-open "${file}"`;
  exec(cmd);
}

(async () => {
  if (process.argv.includes('--open')) {
    if (!fs.existsSync(PDF)) {
      console.error(`No summary report yet (${path.relative(process.cwd(), PDF)}). Run a test command first, or `
        + 'npm run report:pdf:rebuild if the run left summary-report-data.json behind.');
      process.exit(1);
    }
    open(PDF);
    return;
  }
  if (!fs.existsSync(DATA)) {
    console.error(`Nothing to rebuild from: ${path.relative(process.cwd(), DATA)} does not exist. It is written by every run.`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  await renderReport(data, path.join(REPORTS, 'Test-Summary-Report'));
  console.log(`Rebuilt ${path.relative(process.cwd(), PDF)} from ${data.scenarios.length} recorded scenario(s).`);
})().catch((e) => { console.error(e.message); process.exit(1); });
