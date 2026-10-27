// Game rules shared by the browser client (singleplayer + multiplayer rendering)
// and the Node server (authoritative multiplayer). Keep it dependency-free.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BUILDINGS = [
    { id: 'lemon',  name: 'Lemonade Stand', icon: '🍋', base: 15,     income: 1 },
    { id: 'cafe',   name: 'Coffee Shop',    icon: '☕', base: 120,    income: 6 },
    { id: 'arcade', name: 'Arcade',         icon: '🕹️', base: 1300,   income: 40 },
    { id: 'fact',   name: 'Factory',        icon: '🏭', base: 14000,  income: 260 },
    { id: 'bank',   name: 'Bank',           icon: '🏦', base: 160000, income: 1800 },
    { id: 'oil',    name: 'Oil Rig',        icon: '🛢️', base: 2.2e6,  income: 14000 },
    { id: 'space',  name: 'Space Mine',     icon: '🚀', base: 3.5e7,  income: 120000 },
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
  const OFFLINE_RATE = 0.5, OFFLINE_CAP = 7200;

  const fmt = n => { n = Math.floor(n); const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi']; let i = 0, x = n; while (Math.abs(x) >= 1000 && i < u.length - 1) { x /= 1000; i++; } return '$' + (i ? x.toFixed(2) : x) + u[i]; };

  // ---------- Tycoon ----------
  const newTycoon = () => ({ money: 50, buildings: {}, weapons: { pistol: { dmg: 0, rate: 0, mag: 0, armor: 0 } }, equipped: 'pistol' });
  const owned = (t, id) => t.buildings[id]?.count || 0;
  const bLevel = (t, id) => t.buildings[id]?.level || 0;
  const bCost = (t, b) => b.base * Math.pow(1.15, owned(t, b.id));
  const bUpCost = (t, b) => b.base * 25 * Math.pow(4, bLevel(t, b.id));
  const bIncome = (t, b) => owned(t, b.id) * b.income * Math.pow(2, bLevel(t, b.id));
  const income = t => BUILDINGS.reduce((s, b) => s + bIncome(t, b), 0);
  const upCost = (t, w, stat) => Math.max(200, (w.price || 800) * 0.35) * Math.pow(1.6, t.weapons[w.id][stat]);
  const offlineEarnings = (t, seconds) => income(t) * Math.min(OFFLINE_CAP, Math.max(0, seconds)) * OFFLINE_RATE;

  // Applies a player action to a tycoon. Returns an error message, or null on success.
  function applyAction(t, a) {
    if (!a || typeof a !== 'object') return 'Bad action';
    const pay = c => { if (!(t.money >= c)) return false; t.money -= c; return true; };
    if (a.type === 'buy') {
      const b = BUILDINGS.find(x => x.id === a.id); if (!b) return 'Unknown building';
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
    } else return 'Unknown action';
    return null;
  }

  // Cleans an untrusted tycoon (e.g. an imported singleplayer save) into a valid one.
  function sanitizeTycoon(raw) {
    const t = newTycoon();
    if (!raw || typeof raw !== 'object') return t;
    const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : lo;
    t.money = num(raw.money, 0, 1e18);
    for (const b of BUILDINGS) {
      const rb = raw.buildings && raw.buildings[b.id];
      if (rb) t.buildings[b.id] = { count: Math.floor(num(rb.count, 0, 1e4)), level: Math.floor(num(rb.level, 0, 40)) };
    }
    for (const w of WEAPONS) {
      const rw = raw.weapons && raw.weapons[w.id];
      if (rw) t.weapons[w.id] = Object.fromEntries(Object.keys(STATS).map(s => [s, Math.floor(num(rw[s], 0, MAX_LVL))]));
    }
    if (raw.equipped && t.weapons[raw.equipped]) t.equipped = raw.equipped;
    return t;
  }

  // ---------- Matchmaking ----------
  // Distance on a log10 scale, so $1K vs $2K is as close as $1M vs $2M.
  const wealthDistance = (a, b) => Math.abs(Math.log10(Math.max(1, a)) - Math.log10(Math.max(1, b)));
  // How far (in orders of magnitude) we accept after waiting `sec` in queue.
  const searchWindow = sec => 0.15 + sec * 0.25;

  // ---------- Arena ----------
  const W = 900, H = 560, R = 14, SPEED = 210;
  const WALLS = [[200, 120, 40, 140], [660, 300, 40, 140], [400, 60, 100, 30], [400, 470, 100, 30], [120, 400, 120, 30], [660, 130, 120, 30], [420, 250, 60, 60]];
  function hitsWall(x, y, rad) {
    if (x < rad || y < rad || x > W - rad || y > H - rad) return true;
    return WALLS.some(([wx, wy, ww, wh]) => x + rad > wx && x - rad < wx + ww && y + rad > wy && y - rad < wy + wh);
  }
  function lineClear(a, b) { for (let i = 1; i < 30; i++) if (hitsWall(a.x + (b.x - a.x) * i / 30, a.y + (b.y - a.y) * i / 30, 1)) return false; return true; }
  function makeGun(id, up) {
    const w = WEAPONS.find(x => x.id === id) || WEAPONS[0];
    const mag = Math.round(w.mag * (1 + 0.15 * up.mag));
    return { ...w, dmg: w.dmg * (1 + 0.15 * up.dmg), rate: w.rate * (1 + 0.08 * up.rate), mag, ammo: mag, cd: 0, reloading: 0, armor: up.armor };
  }
  // loadout = { weapons, equipped } (a tycoon works as one)
  function newArena(loadoutA, loadoutB) {
    const unit = (l, x, ang) => ({ x, y: H / 2, hp: 100, ang, loadout: { weapons: l.weapons, equipped: l.equipped }, gun: makeGun(l.equipped, l.weapons[l.equipped]) });
    return { units: [unit(loadoutA, 80, 0), unit(loadoutB, W - 80, Math.PI)], bullets: [], fx: [], t: 0 };
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
      if (inp.sw && inp.sw !== g.id && u.loadout.weapons[inp.sw]) u.gun = makeGun(inp.sw, u.loadout.weapons[inp.sw]);
      if (inp.reload) reload(u);
      let mx = +inp.mx || 0, my = +inp.my || 0; const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      if (!hitsWall(u.x + mx * SPEED * dt, u.y, R)) u.x += mx * SPEED * dt;
      if (!hitsWall(u.x, u.y + my * SPEED * dt, R)) u.y += my * SPEED * dt;
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
      if (hitsWall(b.x, b.y, 2)) boom();
      else if (Math.hypot(tgt.x - b.x, tgt.y - b.y) < R + 1) { if (!b.splash) damage(tgt, b.dmg); boom(); A.fx.push({ x: b.x, y: b.y, r: 8, t: .15 }); }
    }
    A.bullets = A.bullets.filter(b => b.life > 0);
    A.fx.forEach(f => f.t -= dt); A.fx = A.fx.filter(f => f.t > 0);
    const [a, b] = A.units;
    if (a.hp <= 0 || b.hp <= 0) return a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : (Math.random() < .5 ? 0 : 1);
    return -1;
  }

  // Singleplayer opponent brain: approach to preferred range, strafe, shoot with skill-based aim error.
  function botInput(A, i, skill) {
    const e = A.units[i], p = A.units[1 - i];
    const ai = e.ai || (e.ai = { strafe: 1, think: 0 });
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1, see = lineClear(e, p);
    if ((ai.think -= 1 / 60) <= 0) { ai.think = 0.6 + Math.random(); ai.strafe = Math.random() < .5 ? -1 : 1; }
    const pref = e.gun.id === 'shotgun' ? 120 : e.gun.id === 'sniper' ? 420 : 260;
    let ax = 0, ay = 0;
    if (!see || dist > pref + 40) { ax = dx / dist; ay = dy / dist; } else if (dist < pref - 40) { ax = -dx / dist; ay = -dy / dist; }
    ax += -dy / dist * ai.strafe * .8; ay += dx / dist * ai.strafe * .8;
    const m = Math.hypot(ax, ay) || 1; ax /= m; ay /= m;
    if (hitsWall(e.x + ax * 8, e.y + ay * 8, R)) ai.strafe *= -1;
    const scale = 0.8 + 0.2 * skill;
    return { mx: ax * scale, my: ay * scale, ang: Math.atan2(dy, dx) + (Math.random() - .5) * (0.5 - 0.4 * skill), shoot: see };
  }

  // Compact state for rendering / sending over the network.
  const snapshot = A => ({
    t: A.t,
    u: A.units.map(u => ({ x: Math.round(u.x), y: Math.round(u.y), hp: Math.max(0, Math.round(u.hp)), ang: +u.ang.toFixed(3), g: { id: u.gun.id, ammo: u.gun.ammo, mag: u.gun.mag, rl: u.gun.reloading > 0 } })),
    b: A.bullets.map(b => [Math.round(b.x), Math.round(b.y), b.splash ? 1 : 0]),
    fx: A.fx.map(f => [Math.round(f.x), Math.round(f.y), f.r, +f.t.toFixed(2)]),
  });

  return { BUILDINGS, WEAPONS, STATS, MAX_LVL, STEAL, fmt, newTycoon, owned, bLevel, bCost, bUpCost, bIncome, income, upCost, offlineEarnings,
    applyAction, sanitizeTycoon, wealthDistance, searchWindow, W, H, WALLS, hitsWall, newArena, stepArena, botInput, snapshot };
});
