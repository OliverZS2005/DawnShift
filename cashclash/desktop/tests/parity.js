// Prints rule calculations from shared.js for the same fixed tycoons as parity.gd.
// With a file argument (parity.gd's output), compares the two and exits 1 on any mismatch.
const CC = require('../../shared.js');
const out = [];
for (const lvl of [1, 3, 7]) {
  const t = CC.newTycoon(); t.level = lvl; t.prestige = lvl === 7 ? 2 : 0; t.perks = { income: 3, cash: 1 }; t.money = 5e12;
  t.buildings = { lemon: { count: 30, level: 2 }, bank: { count: 5, level: 0 } }; t.weapons.smg = { dmg: 3, rate: 1, mag: 0, armor: 2 };
  const row = [CC.income(t), CC.rebootCost(t), CC.prestigePoints(t), CC.bCost(t, CC.BUILDINGS[0]), CC.bUpCost(t, CC.BUILDINGS[4]), CC.upCost(t, CC.WEAPONS[1], 'dmg'), CC.offlineEarnings(t, 99999), CC.matchDistance(t, { money: 1234, level: 2, prestige: 0 })];
  CC.applyAction(t, { type: 'reboot' }); row.push(t.level, t.money, t.points); out.push(row);
}
// the window layout r3d.gd ports from models.js: every number for the first near buildings, lit at night
global.window = global;
const MODELS = require('../../models.js');
out.push(MODELS.cityLayout('arena').buildings.filter(b => b.near).slice(0, 4).flatMap(b => MODELS.windowsOf(b, true).flat()));
if (!process.argv[2]) { console.log(JSON.stringify(out)); process.exit(0); }
const gd = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8').replace(/^[\s\S]*PARITY /, '').split('\n')[0]);
let bad = 0;
const windows = out.length - 1; // window positions are rounded to centimetres on both sides
if (out[windows].length !== (gd[windows] || []).length) { bad++; console.log('MISMATCH window count', out[windows].length, (gd[windows] || []).length); }
out.forEach((row, i) => row.forEach((v, j) => { if (Math.abs(v - gd[i][j]) > (i === windows ? 0.011 : 1e-9 * Math.max(1, Math.abs(v)))) { bad++; console.log('MISMATCH', i, j, 'js', v, 'gd', gd[i][j]); } }));
console.log(bad ? 'Rules or windows differ between the web and desktop versions' : 'Rules match between shared.js and rules.gd, windows between models.js and r3d.gd');
process.exit(bad ? 1 : 0);
