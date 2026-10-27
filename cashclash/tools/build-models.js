// Writes desktop/models.json from models.js, so the Godot app builds the same scenes as the web.
//   node tools/build-models.js          write it
//   node tools/build-models.js --check  exit 1 if it's out of date (used by CI)
const fs = require('fs');
const path = require('path');
const MODELS = require('../models.js');

const out = path.join(__dirname, '..', 'desktop', 'models.json');
const json = JSON.stringify(MODELS, null, 1) + '\n'; // functions (like tex()) are left out
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== json) { console.error('desktop/models.json is out of date: run `node tools/build-models.js`'); process.exit(1); }
  console.log('desktop/models.json is up to date');
} else {
  fs.writeFileSync(out, json);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(json.length / 1024) | 0}KB)`);
}
