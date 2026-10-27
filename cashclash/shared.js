// Game rules shared by the browser client (singleplayer + multiplayer rendering)
// and the Node server (authoritative multiplayer). Keep it dependency-free.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BUILDINGS = [
    { id: 'lemon',  name: 'Lemonade Stand', icon: '🍋', base: 15,     income: 1,       unlock: 1 },
    { id: 'cafe',   name: 'Coffee Shop',    icon: '☕', base: 120,    income: 6,       unlock: 1 },
    { id: 'arcade', name: 'Arcade',         icon: '🕹️', base: 1300,   income: 40,      unlock: 1 },
    { id: 'fact',   name: 'Factory',        icon: '🏭', base: 14000,  income: 260,     unlock: 2 },
    { id: 'bank',   name: 'Bank',           icon: '🏦', base: 160000, income: 1800,    unlock: 3 },
    { id: 'oil',    name: 'Oil Rig',        icon: '🛢️', base: 2.2e6,  income: 14000,   unlock: 4 },
    { id: 'space',  name: 'Space Mine',     icon: '🚀', base: 3.5e7,  income: 120000,  unlock: 5 },
    { id: 'ailab',  name: 'AI Lab',         icon: '🧠', base: 6e8,    income: 1.1e6,   unlock: 6 },
    { id: 'dyson',  name: 'Dyson Sphere',   icon: '☀️', base: 1.2e10, income: 1.2e7,   unlock: 7 },
  ];
  const WEAPONS = [
    { id: 'pistol',  name: 'Pistol',          icon: '🔫', price: 0,      dmg: 14, rate: 3,   mag: 12, reload: 1.1, speed: 700,  spread: .03,  pellets: 1 },
    { id: 'smg',     name: 'SMG',             icon: '💨', price: 2500,   dmg: 7,  rate: 12,  mag: 35, reload: 1.6, speed: 750,  spread: .10,  pellets: 1 },
    { id: 'shotgun', name: 'Shotgun',         icon: '💥', price: 12000,  dmg: 9,  rate: 1.3, mag: 6,  reload: 2.0, speed: 600,  spread: .30,  pellets: 7 },
    { id: 'sniper',  name: 'Sniper',          icon: '🎯', price: 60000,  dmg: 70, rate: .8,  mag: 4,  reload: 2.4, speed: 1500, spread: .005, pellets: 1 },
    { id: 'rocket',  name: 'Rocket Launcher', icon: '🚀', price: 400000, dmg: 55, rate: .7,  mag: 2,  reload: 2.8, speed: 420,  spread: .02,  pellets: 1, splash: 70 },
  ];
  const STATS = { dmg: 'Damage', rate: 'Fire rate', mag: 'Magazine', armor: 'Armor' };
  const MAX_LVL = 10;
  const STEAL = 0.10;

  // ---------- Business levels & reboots ----------
  // Reboot = wipe money, buildings and weapons to reach the next business level (x2 income, new building).
  // At the top level, rebooting ("prestige") grants Boost Points for permanent perks instead.
  const LEVELS = ['Street Hustler', 'Small Business', 'Franchise', 'Corporation', 'Conglomerate', 'Megacorp', 'Galactic Empire'];
  const MAX_BIZ = LEVELS.length;
  const PERKS = {
    income:  { name: 'Income',        icon: '💵', desc: '+25% income',            max: 20 },
    dmg:     { name: 'Firepower',     icon: '🔥', desc: '+10% weapon damage',     max: 10 },
    hp:      { name: 'Toughness',     icon: '❤️', desc: '+10% max health',        max: 10 },
    speed:   { name: 'Agility',       icon: '👟', desc: '+5% move speed',         max: 8 },
    cash:    { name: 'Head Start',    icon: '💼', desc: 'x10 starting cash',      max: 5 },
    offline: { name: 'Night Shift',   icon: '🌙', desc: '+1h offline earnings',   max: 10 },
    luck:    { name: 'Lucky Streak',  icon: '🍀', desc: 'More frequent events',   max: 5 },
  };
  const perk = (t, k) => t.perks?.[k] || 0;
  const perkCost = (t, k) => 1 + Math.floor(perk(t, k) / 2);
  const rebootCost = t => t.level < MAX_BIZ ? 25000 * Math.pow(25, t.level - 1) : 1e11 * Math.pow(4, t.prestige);
  const prestigePoints = t => t.level < MAX_BIZ ? 0 : 1 + Math.max(0, Math.floor(Math.log2(t.money / rebootCost(t))));

  const fmt = n => { n = Math.floor(n); const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx']; let i = 0, x = n; while (Math.abs(x) >= 1000 && i < u.length - 1) { x /= 1000; i++; } return '$' + (i ? x.toFixed(2) : x) + u[i]; };

  // ---------- Tycoon ----------
  const freshWeapons = () => ({ pistol: { dmg: 0, rate: 0, mag: 0, armor: 0 } });
  const startCash = t => 50 * Math.pow(10, perk(t, 'cash'));
  const newTycoon = () => ({ money: 50, buildings: {}, weapons: freshWeapons(), equipped: 'pistol', level: 1, prestige: 0, points: 0, perks: {}, event: null });
  const owned = (t, id) => t.buildings[id]?.count || 0;
  const bLevel = (t, id) => t.buildings[id]?.level || 0;
  const unlocked = (t, b) => t.level >= b.unlock;
  const now = () => Date.now();
  const eventOn = (t, type) => t.event && t.event.type === type && t.event.until > now();
  const bCost = (t, b) => b.base * Math.pow(1.15, owned(t, b.id)) * (eventOn(t, 'sale') ? 0.6 : 1);
  const bUpCost = (t, b) => b.base * 25 * Math.pow(4, bLevel(t, b.id));
  const MILESTONES = [25, 50, 100, 200];
  const milestoneMult = n => Math.pow(2, MILESTONES.filter(m => n >= m).length);
  const nextMilestone = n => MILESTONES.find(m => n < m);
  const globalMult = t => Math.pow(2, t.level - 1) * (1 + 0.25 * perk(t, 'income')) * (eventOn(t, 'boom') ? 3 : 1);
  const bIncome = (t, b) => owned(t, b.id) * b.income * Math.pow(2, bLevel(t, b.id)) * milestoneMult(owned(t, b.id)) * globalMult(t);
  const income = t => BUILDINGS.reduce((s, b) => s + bIncome(t, b), 0);
  const upCost = (t, w, stat) => Math.max(200, (w.price || 800) * 0.35) * Math.pow(1.6, t.weapons[w.id][stat]);
  const offlineEarnings = (t, seconds) => {
    const base = { ...t, event: null }; // events don't run while you're away
    return income(base) * Math.min(7200 + 3600 * perk(t, 'offline'), Math.max(0, seconds)) * 0.5;
  };

  // ---------- Random events (call once per second) ----------
  const EVENTS = {
    boom:  { name: 'Market Boom', icon: '📈', desc: 'x3 income for 30s', dur: 30 },
    sale:  { name: 'Fire Sale',   icon: '🏷️', desc: 'Buildings 40% off for 30s', dur: 30 },
    crate: { name: 'Golden Crate', icon: '🎁', desc: 'Claim within 15s for 90s of income!', dur: 15 },
  };
  function rollEvent(t) {
    if (t.event && t.event.until > now()) return null;
    t.event = null;
    if (!(income(t) > 0) || Math.random() > (1 + 0.3 * perk(t, 'luck')) / 120) return null;
    const keys = Object.keys(EVENTS), type = keys[Math.floor(Math.random() * keys.length)];
    t.event = { type, until: now() + EVENTS[type].dur * 1000 };
    return type;
  }

  // Applies a player action to a tycoon. Returns an error message, or null on success.
  function applyAction(t, a) {
    if (!a || typeof a !== 'object') return 'Bad action';
    const pay = c => { if (!(t.money >= c)) return false; t.money -= c; return true; };
    if (a.type === 'buy') {
      const b = BUILDINGS.find(x => x.id === a.id); if (!b) return 'Unknown building';
      if (!unlocked(t, b)) return `Reach ${LEVELS[b.unlock - 1]} to unlock`;
      if (!pay(bCost(t, b))) return 'Not enough money';
      t.buildings[b.id] = { count: owned(t, b.id) + 1, level: bLevel(t, b.id) };
    } else if (a.type === 'bup') {
      const b = BUILDINGS.find(x => x.id === a.id); if (!b || !owned(t, b.id)) return 'Buy one first';
      if (!pay(bUpCost(t, b))) return 'Not enough money';
      t.buildings[b.id].level++;
    } else if (a.type === 'wbuy') {
      const w = WEAPONS.find(x => x.id === a.id); if (!w || t.weapons[w.id]) return 'Cannot buy';
      if (!pay(w.price)) return 'Not enough money';
      t.weapons[w.id] = { dmg: 0, rate: 0, mag: 0, armor: 0 }; t.equipped = w.id;
    } else if (a.type === 'wup') {
      const w = WEAPONS.find(x => x.id === a.id); if (!w || !t.weapons[w.id] || !(a.stat in STATS)) return 'Cannot upgrade';
      if (t.weapons[w.id][a.stat] >= MAX_LVL) return 'Already maxed';
      if (!pay(upCost(t, w, a.stat))) return 'Not enough money';
      t.weapons[w.id][a.stat]++;
    } else if (a.type === 'equip') {
      if (!t.weapons[a.id]) return 'Not owned';
      t.equipped = a.id;
    } else if (a.type === 'claim') {
      if (!eventOn(t, 'crate')) return 'The crate is gone';
      t.event = null; t.money += Math.max(100, income(t) * 90);
    } else if (a.type === 'reboot') {
      if (t.money < rebootCost(t)) return `Need ${fmt(rebootCost(t))} to reboot`;
      if (t.level < MAX_BIZ) t.level++;
      else { t.points += prestigePoints(t); t.prestige++; }
      Object.assign(t, { money: startCash(t), buildings: {}, weapons: freshWeapons(), equipped: 'pistol', event: null });
    } else if (a.type === 'perk') {
      const p = PERKS[a.id]; if (!p) return 'Unknown perk';
      if (perk(t, a.id) >= p.max) return 'Already maxed';
      if (t.points < perkCost(t, a.id)) return 'Not enough Boost Points';
      t.points -= perkCost(t, a.id); t.perks[a.id] = perk(t, a.id) + 1;
    } else return 'Unknown action';
    return null;
  }

  // Cleans an untrusted tycoon (e.g. an imported singleplayer save) into a valid one.
  function sanitizeTycoon(raw) {
    const t = newTycoon();
    if (!raw || typeof raw !== 'object') return t;
    const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : lo;
    const int = (v, lo, hi) => Math.floor(num(v, lo, hi));
    t.money = num(raw.money, 0, 1e21);
    t.level = int(raw.level, 1, MAX_BIZ);
    t.prestige = int(raw.prestige, 0, 1e4);
    t.points = int(raw.points, 0, 1e5);
    for (const k in PERKS) { const v = int(raw.perks?.[k], 0, PERKS[k].max); if (v) t.perks[k] = v; }
    for (const b of BUILDINGS) {
      const rb = raw.buildings && raw.buildings[b.id];
      if (rb && unlocked(t, b)) t.buildings[b.id] = { count: int(rb.count, 0, 1e4), level: int(rb.level, 0, 40) };
    }
    for (const w of WEAPONS) {
      const rw = raw.weapons && raw.weapons[w.id];
      if (rw) t.weapons[w.id] = Object.fromEntries(Object.keys(STATS).map(s => [s, int(rw[s], 0, MAX_LVL)]));
    }
    if (raw.equipped && t.weapons[raw.equipped]) t.equipped = raw.equipped;
    return t;
  }
  // Fills in fields added in later versions so old saves keep working.
  const upgradeSave = t => Object.assign(newTycoon(), t, { perks: t.perks || {}, level: t.level || 1, prestige: t.prestige || 0, points: t.points || 0 });

  // ---------- Matchmaking ----------
  // Distance on a log10 scale, so $1K vs $2K is as close as $1M vs $2M.
  const wealthDistance = (a, b) => Math.abs(Math.log10(Math.max(1, a)) - Math.log10(Math.max(1, b)));
  // How far (in orders of magnitude) we accept after waiting `sec` in queue.
  const searchWindow = sec => 0.15 + sec * 0.25;

  // Matchmaking also weighs business level, so a fresh Megacorp doesn't get paired with a real Street Hustler.
  const power = t => (t.level || 1) + 0.5 * (t.prestige || 0);
  const matchDistance = (a, b) => wealthDistance(a.money, b.money) + 0.4 * Math.abs(power(a) - power(b));

  // ---------- Computer rivals (singleplayer) ----------
  // Rivals run their own tycoons: they earn, reboot through the business levels and prestige, just like you.
  const RIVAL_NAMES = ['xXSniperXx','MoneyMike','LemonLord','BigBankBob','NoScopeNina','TycoonTina','RocketRay','CashCarl','SprayPray','GoldGabe','FrugalFred','OilBaronOz','SpaceSam','PennyPia','CoinKing','ShotgunSue','ArcadeAce','FactoryFay','RichRick','DollarDee','BrokeBen','JackpotJo','VaultVic','StonksSteve'];
  function newRivals() {
    return RIVAL_NAMES.map((name, i) => {
      const r = { name, skill: 0.3 + Math.random() * 0.6, recent: 0, level: Math.min(MAX_BIZ, 1 + Math.floor(i / 4)), prestige: 0 };
      r.money = Math.round(Math.min(30 * Math.pow(1.75, i) * (0.7 + Math.random() * 0.6), rebootCost(r) * 0.5));
      return r;
    });
  }
  const rivalMult = r => Math.pow(2, r.level - 1) * (1 + 0.25 * r.prestige);
  // Advances one rival by dt seconds. Returns a news string when they reboot, else null.
  function tickRival(r, dt) {
    r.level = r.level || 1; r.prestige = r.prestige || 0;
    r.money = r.money * (1 + 0.0015 * dt * (0.5 + r.skill)) + dt * (0.5 + r.skill) * rivalMult(r);
    // Skilled rivals reboot as soon as they can; others overshoot a little first.
    if (r.money < rebootCost(r) * (1.6 - r.skill * 0.6)) return null;
    if (r.level < MAX_BIZ) r.level++; else r.prestige++;
    r.money = 500 * Math.pow(3, r.level) * (1 + r.prestige);
    return r.prestige ? `${r.name} prestiged (★${r.prestige})!` : `${r.name} rebooted to ${LEVELS[r.level - 1]}!`;
  }
  // A rival's battle gear follows their wealth and level, so higher-level rivals hit harder.
  function rivalLoadout(r) {
    const level = r.level || 1, prestige = r.prestige || 0;
    const affordable = WEAPONS.filter(w => w.price <= r.money * 0.6 * Math.pow(2, level - 1));
    const w = affordable[Math.max(0, affordable.length - 1 - (Math.random() < .35 ? 1 : 0))] || WEAPONS[0];
    const lvl = Math.max(0, Math.min(MAX_LVL, Math.floor(Math.log10(Math.max(10, r.money)) * 1.3 - 2 + Math.random() * 2) + Math.floor((level - 1) / 2)));
    return { weapons: { [w.id]: { dmg: lvl, rate: lvl, mag: lvl, armor: lvl } }, equipped: w.id,
      perks: { hp: Math.min(10, prestige), dmg: Math.min(10, prestige), speed: Math.min(8, Math.floor(prestige / 2)) } };
  }

  // ---------- Arena ----------
  const W = 900, H = 560, R = 14, SPEED = 210, TICK = 1 / 30, TIME_LIMIT = 180, CELL = 20;
  const MAPS = [
    { name: 'Warehouse', walls: [[200, 120, 40, 140], [660, 300, 40, 140], [400, 60, 100, 30], [400, 470, 100, 30], [120, 400, 120, 30], [660, 130, 120, 30], [420, 250, 60, 60]] },
    { name: 'Pillars',   walls: [[180, 100, 50, 50], [180, 410, 50, 50], [670, 100, 50, 50], [670, 410, 50, 50], [425, 160, 50, 50], [425, 350, 50, 50], [300, 255, 50, 50], [550, 255, 50, 50]] },
    { name: 'Corridors', walls: [[150, 0, 30, 200], [150, 360, 30, 200], [720, 0, 30, 200], [720, 360, 30, 200], [330, 150, 240, 30], [330, 380, 240, 30]] },
    { name: 'Vault',     walls: [[300, 140, 300, 25], [300, 395, 300, 25], [300, 140, 25, 100], [575, 320, 25, 100], [80, 260, 80, 40], [740, 260, 80, 40]] },
  ];
  function hitsWall(walls, x, y, rad) {
    if (x < rad || y < rad || x > W - rad || y > H - rad) return true;
    return walls.some(([wx, wy, ww, wh]) => x + rad > wx && x - rad < wx + ww && y + rad > wy && y - rad < wy + wh);
  }
  function lineClear(walls, a, b) { for (let i = 1; i < 30; i++) if (hitsWall(walls, a.x + (b.x - a.x) * i / 30, a.y + (b.y - a.y) * i / 30, 1)) return false; return true; }
  // Movement is shared so the client can predict its own player exactly like the server moves it.
  function moveUnit(walls, u, mx, my, speed, dt) {
    mx = +mx || 0; my = +my || 0; const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    if (!hitsWall(walls, u.x + mx * speed * dt, u.y, R)) u.x += mx * speed * dt;
    if (!hitsWall(walls, u.x, u.y + my * speed * dt, R)) u.y += my * speed * dt;
  }
  function makeGun(id, up, dmgPerk = 0) {
    const w = WEAPONS.find(x => x.id === id) || WEAPONS[0];
    const mag = Math.round(w.mag * (1 + 0.15 * up.mag));
    return { ...w, dmg: w.dmg * (1 + 0.15 * up.dmg) * (1 + 0.1 * dmgPerk), rate: w.rate * (1 + 0.08 * up.rate), mag, ammo: mag, cd: 0, reloading: 0, armor: up.armor };
  }
  // loadout = { weapons, equipped, perks } (a tycoon works as one)
  function newArena(loadoutA, loadoutB, mapIndex = Math.floor(Math.random() * MAPS.length)) {
    const unit = (l, x, ang) => {
      const p = l.perks || {}, mhp = 100 * (1 + 0.1 * (p.hp || 0));
      return { x, y: H / 2, hp: mhp, mhp, ang, speed: SPEED * (1 + 0.05 * (p.speed || 0)), dmgPerk: p.dmg || 0,
        loadout: { weapons: l.weapons, equipped: l.equipped }, gun: makeGun(l.equipped, l.weapons[l.equipped], p.dmg || 0) };
    };
    return { map: mapIndex, walls: MAPS[mapIndex].walls, units: [unit(loadoutA, 60, 0), unit(loadoutB, W - 60, Math.PI)], bullets: [], fx: [], t: 0 };
  }
  function reload(u) { if (!u.gun.reloading && u.gun.ammo < u.gun.mag) u.gun.reloading = u.gun.reload; }
  function shoot(A, u, owner) {
    const g = u.gun; if (g.cd > 0 || g.reloading > 0) return;
    if (g.ammo <= 0) return reload(u);
    g.ammo--; g.cd = 1 / g.rate;
    for (let i = 0; i < g.pellets; i++) {
      const a = u.ang + (Math.random() - .5) * g.spread * 2;
      A.bullets.push({ x: u.x + Math.cos(a) * 18, y: u.y + Math.sin(a) * 18, vx: Math.cos(a) * g.speed, vy: Math.sin(a) * g.speed, dmg: g.dmg, owner, splash: g.splash, life: 1.5 });
    }
    if (g.ammo <= 0) reload(u);
  }
  const damage = (u, d) => { u.hp -= d / (1 + 0.1 * u.gun.armor); };

  // input = { mx, my, ang, shoot, reload, sw }. Returns winner index, or -1 while the fight goes on.
  function stepArena(A, inputs, dt) {
    A.t += dt;
    A.units.forEach((u, i) => {
      const g = u.gun, inp = inputs[i] || {};
      g.cd -= dt;
      if (g.reloading > 0 && (g.reloading -= dt) <= 0) { g.reloading = 0; g.ammo = g.mag; }
      if (inp.sw && inp.sw !== g.id && u.loadout.weapons[inp.sw]) u.gun = makeGun(inp.sw, u.loadout.weapons[inp.sw], u.dmgPerk);
      if (inp.reload) reload(u);
      moveUnit(A.walls, u, inp.mx, inp.my, u.speed, dt);
      if (typeof inp.ang === 'number' && isFinite(inp.ang)) u.ang = inp.ang;
      if (inp.shoot && A.t > 0.8) shoot(A, u, i);
    });
    for (const b of A.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      const tgt = A.units[1 - b.owner];
      const boom = () => {
        b.life = 0;
        if (!b.splash) return;
        A.fx.push({ x: b.x, y: b.y, r: b.splash, t: .3 });
        for (const u of A.units) { const d = Math.hypot(u.x - b.x, u.y - b.y); if (d < b.splash) damage(u, b.dmg * (1 - d / b.splash) * (u === tgt ? 1 : 0.4)); }
      };
      if (hitsWall(A.walls, b.x, b.y, 2)) boom();
      else if (Math.hypot(tgt.x - b.x, tgt.y - b.y) < R + 1) { if (!b.splash) damage(tgt, b.dmg); boom(); A.fx.push({ x: b.x, y: b.y, r: 8, t: .15 }); }
    }
    A.bullets = A.bullets.filter(b => b.life > 0);
    A.fx.forEach(f => f.t -= dt); A.fx = A.fx.filter(f => f.t > 0);
    const [a, b] = A.units;
    if (a.hp <= 0 || b.hp <= 0 || A.t >= TIME_LIMIT) return a.hp / a.mhp > b.hp / b.mhp ? 0 : b.hp / b.mhp > a.hp / a.mhp ? 1 : (Math.random() < .5 ? 0 : 1);
    return -1;
  }

  // Breadth-first search over a 20px grid; returns a point a few cells along the shortest path
  // from `from` to `to`, or null if there's no path. Lets bots walk around walls instead of into them.
  function nextWaypoint(walls, from, to) {
    const cols = Math.floor(W / CELL), rows = Math.floor(H / CELL), key = (c, r) => r * cols + c;
    const cell = p => [Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL)))];
    const [sc, sr] = cell(from), [gc, gr] = cell(to), goal = key(gc, gr);
    const prev = new Map([[key(sc, sr), -1]]), q = [[sc, sr]];
    for (let qi = 0; qi < q.length && !prev.has(goal); qi++) {
      const [c, r] = q[qi];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, k = key(nc, nr);
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || prev.has(k)) continue;
        if (k !== goal && hitsWall(walls, nc * CELL + CELL / 2, nr * CELL + CELL / 2, R)) continue;
        prev.set(k, key(c, r)); q.push([nc, nr]);
      }
    }
    if (!prev.has(goal)) return null;
    const path = []; for (let k = goal; k !== -1; k = prev.get(k)) path.push(k);
    const k = path[Math.max(0, path.length - 4)];
    return { x: (k % cols) * CELL + CELL / 2, y: Math.floor(k / cols) * CELL + CELL / 2 };
  }

  // Singleplayer opponent brain: approach to preferred range, strafe, shoot with skill-based aim error.
  function botInput(A, i, skill) {
    const e = A.units[i], p = A.units[1 - i];
    const ai = e.ai || (e.ai = { strafe: 1, think: 0, pathT: 0, wp: null });
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1, see = lineClear(A.walls, e, p);
    if ((ai.think -= 1 / 60) <= 0) { ai.think = 0.6 + Math.random(); ai.strafe = Math.random() < .5 ? -1 : 1; }
    const pref = e.gun.id === 'shotgun' ? 120 : e.gun.id === 'sniper' ? 420 : 260;
    let ax = 0, ay = 0;
    if (!see) {
      // no line of sight: follow a path around the walls
      if ((ai.pathT -= 1 / 60) <= 0 || !ai.wp) { ai.pathT = 0.3; ai.wp = nextWaypoint(A.walls, e, p) || p; }
      const wx = ai.wp.x - e.x, wy = ai.wp.y - e.y, wd = Math.hypot(wx, wy) || 1;
      ax = wx / wd; ay = wy / wd;
    } else {
      if (dist > pref + 40) { ax = dx / dist; ay = dy / dist; } else if (dist < pref - 40) { ax = -dx / dist; ay = -dy / dist; }
      ax += -dy / dist * ai.strafe * .8; ay += dx / dist * ai.strafe * .8;
    }
    const m = Math.hypot(ax, ay) || 1; ax /= m; ay /= m;
    if (see && hitsWall(A.walls, e.x + ax * 8, e.y + ay * 8, R)) ai.strafe *= -1;
    const scale = 0.8 + 0.2 * skill;
    return { mx: ax * scale, my: ay * scale, ang: Math.atan2(dy, dx) + (Math.random() - .5) * (0.5 - 0.4 * skill), shoot: see };
  }

  // Compact state for rendering / sending over the network. Bullets carry velocity so clients can extrapolate.
  const snapshot = A => ({
    t: +A.t.toFixed(3), m: A.map,
    u: A.units.map(u => ({ x: +u.x.toFixed(1), y: +u.y.toFixed(1), hp: Math.max(0, Math.round(u.hp)), mhp: Math.round(u.mhp), ang: +u.ang.toFixed(3), sp: u.speed,
      g: { id: u.gun.id, ammo: u.gun.ammo, mag: u.gun.mag, rl: u.gun.reloading > 0 } })),
    b: A.bullets.map(b => [Math.round(b.x), Math.round(b.y), b.splash ? 1 : 0, Math.round(b.vx), Math.round(b.vy)]),
    fx: A.fx.map(f => [Math.round(f.x), Math.round(f.y), f.r, +f.t.toFixed(2)]),
  });

  return { BUILDINGS, WEAPONS, STATS, MAX_LVL, STEAL, LEVELS, MAX_BIZ, PERKS, EVENTS, MAPS, TICK, fmt,
    newTycoon, upgradeSave, owned, bLevel, unlocked, bCost, bUpCost, bIncome, income, globalMult, milestoneMult, nextMilestone, upCost, offlineEarnings,
    perk, perkCost, rebootCost, prestigePoints, eventOn, rollEvent, applyAction, sanitizeTycoon, wealthDistance, matchDistance, searchWindow, newRivals, tickRival, rivalLoadout,
    W, H, hitsWall, moveUnit, nextWaypoint, newArena, stepArena, botInput, snapshot };
});
