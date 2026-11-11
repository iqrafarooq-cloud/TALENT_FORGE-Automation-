// envWriter.js — update KEY=value entries in the project .env, preserving every
// other line and comment. Also updates process.env in-memory for the current run,
// so a value written mid-run is visible to code that reads it afterwards.
//
// >>> THE PATH WAS WRONG FOR MONTHS AND THE WRITES LANDED OUTSIDE THE REPO. <<<
// It resolved `__dirname/../../.env`, which was right while this file lived two
// levels deep (features/support/) and became the PARENT OF THE PROJECT once it
// moved to the top-level utils/ in the "Nxtstim top-level layout" restructure.
// So every persisted value — TWOFA_AGENT_SECRET, FORGOT_PASSWORD, and anything
// else a run rotated — was written to C:\Users\Byte\Documents\.env, which dotenv
// never loads. The suite reported "updated in <path>" and the project .env went
// on holding a stale value, which then surfaces one run later as
// "Invalid Credentials" on an account whose password had genuinely changed.
//
// Hence the guard below: this module now asserts it is writing the .env that
// sits beside package.json, and throws rather than silently creating a stray
// file somewhere up the tree if this file is ever moved again.
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

// A .env is only the project's if package.json sits beside it. Checked once, on
// load, so a mis-resolved path fails loudly at require time instead of writing a
// credential into a directory nobody reads.
if (!fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) {
  throw new Error(
    `envWriter resolved ${ENV_PATH} as the project .env, but ${PROJECT_ROOT} holds no ` +
      `package.json. Fix the path in utils/envWriter.js rather than letting it write there.`
  );
}

// Write one KEY=value. Replaces the existing line in place (keeping its position
// in the file) or appends it. Returns the path written, for logging.
function updateEnv(key, value) {
  return updateEnvVars({ [key]: value });
}

// Write several at once — one read/write of the file rather than one per key, so a
// crash cannot leave half a fixture recorded.
function updateEnvVars(vars) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';

  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    // Anchored per line, and tolerant of a `export ` prefix and trailing \r on
    // this repo's CRLF .env — without \r? the replace misses and the key is
    // appended a second time, leaving two lines and dotenv honouring the first.
    const re = new RegExp(`^(?:export\s+)?${key}=.*\r?$`, 'm');
    content = re.test(content)
      ? content.replace(re, line)
      : `${content.replace(/\s*$/, '')}\n${line}\n`;
    process.env[key] = value;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
  return ENV_PATH;
}

module.exports = { updateEnv, updateEnvVars, ENV_PATH, PROJECT_ROOT };
