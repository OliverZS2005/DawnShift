// Builds the web version into web-dist/ and zips it as
// dist/Dawnshift-web-<version>.zip. Upload the ZIP's contents to any web host
// (for example the root of your subdomain) and Dawnshift runs in the browser.
// Run with: npm run build:web
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'web-dist');
const pub = path.join(root, 'public');

// The license page must list what ends up in the bundle.
execFileSync(process.execPath, [path.join(root, 'scripts', 'notices.mjs')], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Bundle the engine, the interface and the AI libraries into one file.
await build({
  entryPoints: [path.join(root, 'web', 'main.js')],
  outfile: path.join(out, 'dawnshift.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  // Safari 15.4 and up, and every current Chrome, Edge and Firefox.
  target: ['es2022', 'safari15.4'],
  minify: true,
  // Keeps the libraries' license comments in a file next to the bundle.
  legalComments: 'linked',
  logLevel: 'warning',
});

// 2. Copy the pages, styles and icons. The interface's scripts are in the bundle.
const SKIP = new Set(['app.js', 'mascot.js', 'guides.js', 'index.html']);
for (const name of fs.readdirSync(pub)) {
  if (!SKIP.has(name)) fs.cpSync(path.join(pub, name), path.join(out, name), { recursive: true });
}
const index = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const tag = '<script type="module" src="app.js"></script>';
if (!index.includes(tag)) throw new Error('public/index.html no longer loads app.js the expected way.');
fs.writeFileSync(path.join(out, 'index.html'), index.replace(tag, '<script type="module" src="dawnshift.js"></script>'));

// 3. The service worker, with a version that changes whenever the app does.
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(path.relative(out, full).split(path.sep).join('/'));
  }
})(out);
const hash = crypto.createHash('sha256');
for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(out, f)));
const assets = ['./', ...files.filter((f) => f !== 'index.html')];
const sw = fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8')
  .replace('__VERSION__', `dawnshift-${version}-${hash.digest('hex').slice(0, 10)}`)
  .replace('__ASSETS__', JSON.stringify(assets));
fs.writeFileSync(path.join(out, 'sw.js'), sw);

// 4. Zip it for uploading. Files sit at the top of the ZIP, ready for a site's root.
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const zip = path.join(root, 'dist', `Dawnshift-web-${version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: out, stdio: 'inherit' });

// A copy with a fixed name in the repo, so a server can always fetch the
// latest build from the same address (see "Hosting on your own server" in the README).
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
fs.copyFileSync(zip, path.join(root, 'release', 'dawnshift-web.zip'));

// 5. The account/sync server, packaged the same way for the server to fetch.
const syncZip = path.join(root, 'release', 'dawnshift-sync.zip');
fs.rmSync(syncZip, { force: true });
execFileSync('zip', ['-q', '-X', syncZip, 'server.js', 'package.json'], { cwd: path.join(root, 'sync-server'), stdio: 'inherit' });

const kb = (fs.statSync(path.join(out, 'dawnshift.js')).size / 1024).toFixed(0);
const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`Built web-dist/ (app bundle ${kb} KB) and dist/${path.basename(zip)} (${mb} MB)`);
