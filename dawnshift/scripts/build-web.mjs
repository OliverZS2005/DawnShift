// Prepares web-dist/ for the hosted web app: the browser just needs the UI
// files (public/) and a service worker that keeps them cached offline-first.
// The engine (bots, AI calls, data) lives on the server. Run with:
//   npm run build:web
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'web-dist');
const pub = path.join(root, 'public');

// Keep the licenses page up to date.
execFileSync(process.execPath, [path.join(root, 'scripts', 'notices.mjs')], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Copy every file from public/ unchanged.
fs.cpSync(pub, out, { recursive: true });

// Service worker with a content-based version string, so a new deploy busts
// the cache without the user having to force-reload.
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

// Zip for release (static front-end only; the server is deployed separately).
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const zip = path.join(root, 'dist', `Dawnshift-web-${version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: out, stdio: 'inherit' });
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
fs.copyFileSync(zip, path.join(root, 'release', 'dawnshift-web.zip'));

const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(2);
console.log(`Built web-dist/ and dist/${path.basename(zip)} (${mb} MB)`);
