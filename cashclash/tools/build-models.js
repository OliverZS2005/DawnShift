// Writes desktop/models.json from models.js, so the Godot app builds the same scenes as the web.
//   node tools/build-models.js          write it
//   node tools/build-models.js --check  exit 1 if it's out of date (used by CI)
const fs = require('fs');
const path = require('path');
const MODELS = require('../models.js');

const out = path.join(__dirname, '..', 'desktop', 'models.json');
// Functions (like tex()) are left out, so what they generate is written out as data: the city layouts,
// and each business's building and inside at 0-4 milestones (SHOP_BUILDINGS / INTERIORS.<id>[milestones]).
const LAYOUT = { arena: MODELS.cityLayout('arena'), city: MODELS.cityLayout('city') };
const SHOP_BUILDINGS = Object.fromEntries(Object.keys(MODELS.SHOPS).map(id => [id, [0, 1, 2, 3, 4].map(ms => MODELS.lotBuilding(id, ms))]));
const INTERIORS = Object.fromEntries(Object.keys(MODELS.SHOPS).map(id => [id, [0, 1, 2, 3, 4].map(ms => MODELS.interior(id, ms))]));
// the quest givers' words and the reboot goals' names, so the desktop app needn't keep its own copy of them
const { QUEST_TEXT, REBOOT_GOALS } = require('../shared.js');
const json = JSON.stringify({ ...MODELS, LAYOUT, SHOP_BUILDINGS, INTERIORS, QUEST_TEXT, REBOOT_GOALS }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== json) { console.error('desktop/models.json is out of date: run `node tools/build-models.js`'); process.exit(1); }
  console.log('desktop/models.json is up to date');
} else {
  fs.writeFileSync(out, json);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(json.length / 1024) | 0}KB)`);
}
