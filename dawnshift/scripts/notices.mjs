// Collects the licenses of every open-source package Dawnshift ships with and
// writes them to THIRD_PARTY_NOTICES.md and public/licenses.html.
// Run it after adding or updating dependencies: npm run notices
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Fonts are loaded from Google Fonts rather than shipped, but they're credited here too.
const FONTS = [
  { name: 'IBM Plex Sans and IBM Plex Mono', by: 'IBM Corp.', url: 'https://github.com/IBM/plex' },
  { name: 'Bricolage Grotesque', by: 'The Bricolage Grotesque Project Authors', url: 'https://github.com/ateliertriay/bricolage' },
];

// Only needed to build, but their code ships inside the Android app.
const IN_ANDROID_APP = new Set(['node_modules/@capacitor/android', 'node_modules/@capacitor/core']);

const packages = Object.entries(lock.packages)
  .filter(([p, info]) => p.startsWith('node_modules/') && (!info.dev || IN_ANDROID_APP.has(p)))
  .map(([p, info]) => {
    const dir = path.join(root, p);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const license = meta.license ?? info.license ?? 'UNKNOWN';
    let text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '';
    if (!text && license === 'MIT') {
      const author = typeof meta.author === 'string' ? meta.author : meta.author?.name;
      text = `MIT License\n\nCopyright (c) ${author ?? `the ${meta.name} authors`}\n\n${MIT_TEXT}`;
    }
    if (!text) throw new Error(`No license text found for ${meta.name}. Add it by hand before publishing.`);
    const repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
    return { name: meta.name, version: meta.version, license, repo: repo?.replace(/^git\+/, '').replace(/\.git$/, ''), text };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const intro = 'Dawnshift is built with the open-source software below. Thank you to everyone who made it. Each package is used under its own license, reproduced in full.';

// Markdown for the repository
const md = [
  '# Third-party notices',
  '',
  intro,
  '',
  '| Package | Version | License |',
  '|---|---|---|',
  ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
  '',
  '## Fonts',
  '',
  ...FONTS.map((f) => `- **${f.name}** by ${f.by}, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org). Source: ${f.url}`),
  '',
  ...packages.flatMap((p) => [`## ${p.name} ${p.version}`, '', p.repo ? `Source: ${p.repo}` : '', '', '```', p.text, '```', '']),
].join('\n');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);

// HTML page shown inside the app
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open-source licenses · Dawnshift</title>
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="legal">
    <p><a href="./">← Back to Dawnshift</a></p>
    <h1>Open-source licenses</h1>
    <p>${esc(intro)}</p>
    <h2>Fonts</h2>
    <ul>
${FONTS.map((f) => `      <li><strong>${esc(f.name)}</strong> by ${esc(f.by)}, licensed under the <a href="https://openfontlicense.org">SIL Open Font License 1.1</a>.</li>`).join('\n')}
    </ul>
${packages.map((p) => `    <details>
      <summary><strong>${esc(p.name)}</strong> ${esc(p.version)} · ${esc(p.license)}</summary>
      <pre>${esc(p.text)}</pre>
    </details>`).join('\n')}
  </main>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'public', 'licenses.html'), html);
console.log(`Wrote notices for ${packages.length} packages.`);
