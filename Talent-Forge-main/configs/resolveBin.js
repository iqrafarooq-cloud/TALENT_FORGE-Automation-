// Resolve a package's own bin entry to a .js file, so it can be run as `node <entry>` with
// shell:false. On Windows the node_modules/.bin shims are .cmd files that spawn cannot exec
// directly, and shell:true re-parses the argument string - which silently splits any argument
// containing a space (a --grep of a scenario name, a path under "AI Document Verification").
// Going through the package's `bin` field (rather than a deep path) also survives an `exports`
// map that blocks subpaths, which playwright-bdd's does.
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function resolveBin(packageName, binName) {
  let pkgPath;
  try {
    pkgPath = require.resolve(`${packageName}/package.json`, { paths: [ROOT] });
  } catch (e) {
    console.error(`Cannot find ${packageName}. Run \`npm install\` first.`);
    process.exit(1);
  }
  const pkg = require(pkgPath);
  const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin[binName]);
  if (!bin) {
    console.error(`${packageName}@${pkg.version} declares no "${binName}" bin entry.`);
    process.exit(1);
  }
  return path.join(path.dirname(pkgPath), bin);
}

module.exports = { ROOT, resolveBin };
