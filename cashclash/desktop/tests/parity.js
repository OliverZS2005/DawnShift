// Prints rule calculations from shared.js for the same fixed tycoons as parity.gd.
// With a file argument (parity.gd's output), compares the two and exits 1 on any mismatch.
const CC = require('../../shared.js');
const out = [];
for (const lvl of [1, 3, 7]) {
  const t = CC.newTycoon(); t.level = lvl; t.prestige = lvl === 7 ? 2 : 0; t.perks = { income: 3, cash: 1 }; t.money = 5e12;
  t.buildings = { lemon: { count: 30, level: 2 }, bank: { count: 5, level: 0 } }; t.weapons.smg = { dmg: 3, rate: 1, mag: 0, armor: 2 };
  const row = [CC.income(t), CC.rebootCost(t), CC.prestigePoints(t), CC.bCost(t, CC.BUILDINGS[0]), CC.bUpCost(t, CC.BUILDINGS[4]), CC.upCost(t, CC.WEAPONS[1], 'dmg'), CC.offlineEarnings(t, 99999), CC.matchDistance(t, { money: 1234, level: 2, prestige: 0 })];
  // what the reboot still asks for, then everything done but the cash, then all of it
  row.push(CC.applyAction(t, { type: 'reboot' }) || '');
  for (const g of CC.rebootGoals(t)) row.push(g.id, g.have, g.need);
  CC.recordWin(t); t.quest.run.jobs = 99; row.push(CC.rebootBlocker(t) || '');
  t.quest.run.wins = 99; for (const id of ['lemon', 'cafe', 'bank']) t.buildings[id] = { count: 200, level: 0 };
  t.weapons.pistol = { dmg: 10, rate: 10, mag: 10, armor: 10 }; row.push(CC.rebootBlocker(t) || '');
  t.money = 1; row.push(CC.rebootBlocker(t) || ''); t.money = 5e12;
  row.push(CC.applyAction(t, { type: 'reboot' }) || '');
  row.push(t.level, t.money, t.points, t.quest.run.wins); out.push(row);
}
// quests: who's in each area, what they say and ask, and a job taken, done and handed in
const words = [];
for (const [level, prestige] of [[1, 0], [4, 0], [7, 3]]) {
  const t = CC.newTycoon(); t.level = level; t.prestige = prestige; t.money = 1234.5 * Math.pow(10, level);
  for (const b of CC.BUILDINGS) if (CC.unlocked(t, b)) t.buildings[b.id] = { count: 7 + b.unlock, level: 1 };
  for (const area of CC.QUEST_AREAS) {
    if (area !== 'plaza' && !t.buildings[area]) continue;
    for (let step = 0; step < 4; step++) {
      const k = CC.questTalk(t, area);
      words.push([area, k.name, k.role, k.mood, k.hi, k.why, k.ask, k.take, k.done, k.reward, k.points]);
      CC.applyAction(t, { type: 'quest', area, op: 'accept' });
      const p = CC.questProgress(t, area); words.push([area, p[0], p[1]]);
      CC.applyAction(t, { type: 'quest', area, op: step % 2 ? 'drop' : 'claim' });
      CC.recordWin(t);
    }
  }
}
// money formatting, ties included
const money = [];
for (let i = 0; i < 400; i++) money.push(CC.fmt(Math.floor(Math.pow(1.37, i % 90) * (1 + i * 7919 % 1000))));
for (const v of [15625000, 15635000, 1125, 2375, 9875, 160845, 541505]) money.push(CC.fmt(v));
if (!process.argv[2]) { console.log(JSON.stringify(out)); console.log(JSON.stringify(words.slice(0, 6))); process.exit(0); }
const text = require('fs').readFileSync(process.argv[2], 'utf8');
const line = tag => JSON.parse(text.split('\n').find(l => l.startsWith(tag + ' ')).slice(tag.length + 1));
const gd = line('PARITY'), gq = line('QUESTS'), gm = line('FMT');
let bad = 0;
const same = (v, g) => typeof v === 'number' ? Math.abs(v - g) <= 1e-9 * Math.max(1, Math.abs(v)) : v === g;
out.forEach((row, i) => row.forEach((v, j) => { if (!same(v, gd[i][j])) { bad++; console.log('MISMATCH', i, j, 'js', v, 'gd', gd[i][j]); } }));
if (gq.length !== words.length) { bad++; console.log('MISMATCH quest count', words.length, gq.length); }
words.forEach((row, i) => row.forEach((v, j) => { if (gq[i] && !same(v, gq[i][j])) { bad++; if (bad < 20) console.log('MISMATCH quest', i, j, 'js', v, 'gd', gq[i][j]); } }));
money.forEach((v, i) => { if (v !== gm[i]) { bad++; console.log('MISMATCH fmt', i, 'js', v, 'gd', gm[i]); } });
console.log(bad ? 'Rules differ between shared.js and rules.gd' : `Rules match between shared.js and rules.gd (${words.length} quest checks)`);
process.exit(bad ? 1 : 0);
