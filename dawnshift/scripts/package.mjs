// Builds dist/Dawnshift-<version>.zip: everything needed to run Dawnshift,
// including its libraries, so people only need Node.js installed.
// Run with: npm run package
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'Dawnshift');
const zipName = `Dawnshift-${version}.zip`;

// What goes in the download. Tests, scripts and saved data stay out.
const INCLUDE = ['server.js', 'src', 'public', 'node_modules', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'];

// Refresh the license list first, so the download always matches its libraries.
execFileSync(process.execPath, [path.join(root, 'scripts', 'notices.mjs')], { stdio: 'inherit' });

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const item of INCLUDE) {
  fs.cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
}
for (const file of fs.readdirSync(path.join(root, 'launchers'))) {
  fs.cpSync(path.join(root, 'launchers', file), path.join(stage, file));
}
// Drop files the libraries only need for development (TypeScript sources,
// type definitions, source maps). License files are always kept.
(function prune(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) prune(full);
    else if (/\.(ts|mts|cts|map)$/.test(e.name) && !/licen[cs]e/i.test(e.name)) fs.rmSync(full);
  }
})(path.join(stage, 'node_modules'));

// Keep the Mac and Linux launchers double-clickable.
fs.chmodSync(path.join(stage, 'Start Dawnshift (Mac).command'), 0o755);
fs.chmodSync(path.join(stage, 'start-linux.sh'), 0o755);

execFileSync('zip', ['-r', '-q', '-X', zipName, 'Dawnshift'], { cwd: dist, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });

const size = (fs.statSync(path.join(dist, zipName)).size / 1024 / 1024).toFixed(1);
console.log(`Built dist/${zipName} (${size} MB)`);
