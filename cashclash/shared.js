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

  // ---------- Quests ----------
  // Every area, the plaza and the inside of each business, has someone with a job for you. Who they are,
  // how they talk and what they ask all come from a seed made of the area, how many reboots you've done
  // and how many of their jobs you've finished (or turned down): each reboot brings new people and new
  // jobs, and the same kind of job never comes twice in a row. Targets are set from your business when
  // you take the job; the reward (cash, scaled to your income, and now and then a Boost Point at the top
  // level) when you hand it in. rules.gd has a port; tests/parity checks they agree.
  const QUEST_AREAS = ['plaza', ...BUILDINGS.map(b => b.id)];
  // the kinds of job each area hands out (in the order they're tried)
  const QUEST_KINDS = {
    plaza: ['wins', 'crate', 'cash', 'variety', 'weapon', 'income', 'winwith'],
    lemon: ['buy', 'upgrade', 'milestone', 'cash', 'income', 'crate'], cafe: ['buy', 'milestone', 'upgrade', 'income', 'crate', 'cash'],
    arcade: ['buy', 'upgrade', 'wins', 'milestone', 'income', 'winwith'], bank: ['cash', 'income', 'buy', 'upgrade', 'variety', 'milestone'],
    fact: ['buy', 'upgrade', 'milestone', 'income', 'weapon', 'wins'], oil: ['buy', 'income', 'upgrade', 'wins', 'milestone', 'cash'],
    space: ['buy', 'milestone', 'income', 'weapon', 'upgrade', 'winwith'], ailab: ['upgrade', 'buy', 'income', 'variety', 'milestone', 'weapon'],
    dyson: ['buy', 'income', 'milestone', 'upgrade', 'cash', 'wins'],
  };
  // reward: seconds of income, per kind
  const QUEST_PAY = { buy: 90, milestone: 240, upgrade: 160, income: 300, cash: 120, wins: 200, winwith: 260, crate: 120, variety: 220, weapon: 150 };
  const QUEST_TEXT = {
    first: ['Ada', 'Bruno', 'Carmen', 'Dmitri', 'Esi', 'Farid', 'Greta', 'Hiro', 'Ines', 'Jamal', 'Kasia', 'Lorenzo', 'Mei', 'Nikolai', 'Oona', 'Pablo', 'Quinn', 'Rosa', 'Sven', 'Tamsin',
      'Ugo', 'Vera', 'Wendell', 'Ximena', 'Yusuf', 'Zora', 'Abebe', 'Bianca', 'Cyrus', 'Dagny', 'Emeka', 'Fiona', 'Gus', 'Hana', 'Ivo', 'Jules', 'Kofi', 'Lena', 'Marcus', 'Noor'],
    last: ['Abara', 'Bellini', 'Castellanos', 'Dubois', 'Eriksen', 'Fontaine', 'Gallagher', 'Hosseini', 'Ivanova', 'Jablonski', 'Kowalczyk', 'Lindqvist', 'Mbeki', 'Nakamura', 'Okafor',
      'Petrov', 'Quintero', 'Rasmussen', 'Silva', 'Tanaka', 'Uribe', 'Varga', 'Whitlock', 'Xu', 'Yilmaz', 'Zielinski', 'Achterberg', 'Brannigan', 'Cho', 'Delacroix', 'Esposito', 'Farouk'],
    roles: {
      plaza: ['newspaper vendor', 'street musician', 'retired detective', 'hot-dog cart owner', 'city inspector', 'pigeon whisperer', 'shoeshine', 'parking warden'],
      lemon: ['stand manager', 'lemon supplier', 'sign painter', 'sugar broker'], cafe: ['head barista', 'pastry chef', 'regular customer', 'bean roaster'],
      arcade: ['floor manager', 'high-score champion', 'repair tech', 'prize-counter clerk'], fact: ['foreman', 'safety officer', 'shift supervisor', 'union rep'],
      bank: ['branch manager', 'senior teller', 'auditor', 'vault keeper'], oil: ['rig boss', 'geologist', 'pipeline engineer', 'roughneck'],
      space: ['mission controller', 'asteroid prospector', 'flight surgeon', 'cargo pilot'], ailab: ['lead researcher', 'robot wrangler', 'ethics officer', 'data janitor'],
      dyson: ['chief architect', 'solar engineer', 'orbital welder', 'mirror polisher'],
    },
    // how people talk: hello, taking the job, still working on it, handing it in
    moods: {
      gruff: { hi: ['You. Yeah, you. Got a minute?', 'Don\'t just stand there.', 'Finally, someone who looks useful.', 'Make it quick, I\'m busy.'],
        take: ['Good. Don\'t mess it up.', 'Fine. Get moving.', 'Right. Off you go.'], wait: ['Still waiting.', 'That\'s not done yet.', 'Clock\'s ticking.'],
        done: ['Huh. Not bad.', 'About time. Here.', 'Fine work. Don\'t let it go to your head.'] },
      cheerful: { hi: ['Oh hey! Perfect timing!', 'Hiiii! You\'re the boss, right?', 'What a day, right? I\'ve got an idea!', 'Hello hello!'],
        take: ['Yay! You\'re the best!', 'Amazing, thank you!', 'I knew you\'d say yes!'], wait: ['No rush! Well, a little rush.', 'You\'ve got this!', 'Almost there, I can feel it!'],
        done: ['You did it! Here, take this!', 'Wooo! That\'s my boss!', 'Incredible. Treat yourself!'] },
      nervous: { hi: ['Um, sorry, do you have a second?', 'I hate to bother you, but...', 'Oh! You startled me. Hi.', 'Is now a bad time? It\'s a bad time.'],
        take: ['Oh thank goodness.', 'Really? Okay. Okay! Thank you.', 'You\'re saving my life here.'], wait: ['Is it... going okay?', 'No pressure. Some pressure.', 'I keep checking the numbers.'],
        done: ['Oh, phew. Here, this is for you.', 'I can breathe again. Thank you!', 'I was so worried. You\'re amazing.'] },
      smooth: { hi: ['Well, well. Just the person I wanted.', 'Walk with me a moment.', 'I\'ve been hearing good things about you.', 'Let\'s talk opportunity.'],
        take: ['A pleasure doing business.', 'I knew we\'d understand each other.', 'Splendid.'], wait: ['Patience is profitable.', 'Take your time. Not too much.', 'The offer stands.'],
        done: ['Exquisite. Your cut, as promised.', 'Exactly as planned. Enjoy.', 'You never disappoint.'] },
      dreamy: { hi: ['Do you ever look at the clouds and see profits?', 'I had a dream about you last night.', 'The city is humming today. Hear it?', 'Oh. It\'s you. I was just thinking.'],
        take: ['The universe approves.', 'Wonderful. Go, go.', 'I\'ll be here. Probably.'], wait: ['It will happen when it happens.', 'Mm. Soon.', 'The stars say not yet.'],
        done: ['As foretold. Here.', 'It\'s beautiful. Thank you.', 'Everything is in balance now.'] },
      grizzled: { hi: ['Been in this business forty years, kid.', 'Pull up a crate.', 'Back in my day we did this by hand.', 'Got a job, if you\'ve got the stomach.'],
        take: ['Atta kid.', 'That\'s the spirit.', 'Remind me of me, you do.'], wait: ['Rome wasn\'t built in a day.', 'Steady hands, kid.', 'Not done yet.'],
        done: ['Knew you had it in you.', 'Here. You earned every cent.', 'Proud of you, kid.'] },
    },
    // why they want it (by kind) and what they ask; {n} count, {c} count with its noun (count, below),
    // {b} business, {bs} businesses, {amt} money, {w} weapon
    why: {
      buy: ['The queue round the block is getting silly.', 'Demand is through the roof.', 'A rival is sniffing around this street.', 'We\'re turning customers away.'],
      upgrade: ['The old kit is falling apart.', 'I saw a rival\'s place. It was shinier.', 'Customers notice when things are run-down.', 'Better gear, better margins.'],
      milestone: ['Get big enough and suppliers give you a deal.', 'There\'s a magic number where it all clicks.', 'I want this place in the papers.'],
      income: ['The investors are watching the numbers.', 'I promised my family a holiday.', 'The bigger the flow, the safer we all are.', 'Money makes money.'],
      cash: ['I need to see a healthy cushion in the account.', 'There\'s a deal coming and it needs cash up front.', 'The bank wants proof we\'re solid.'],
      wins: ['Some punk has been bad-mouthing you.', 'Rivals think you\'re soft.', 'Nothing scares competitors like a winning streak.', 'People bet on the fights. I bet on you.'],
      winwith: ['I want to see that thing in action.', 'A demonstration would really impress the buyers.', 'Style matters, boss.'],
      crate: ['Golden crates have been dropping around here.', 'Word is there\'s treasure falling off trucks.', 'Keep your eyes open for gold.'],
      variety: ['Never keep all your eggs in one basket.', 'A real empire has range.', 'Diversify. Trust me.'],
      weapon: ['It\'s dangerous out there.', 'Your gear is a joke, no offence.', 'A tool is only as good as its upkeep.'],
    },
    ask: {
      buy: ['Open {n} more {bs}.', 'Get {n} more {bs} going.', 'I need {n} extra {bs}, fast.'],
      upgrade: ['Give the {b} {c}.', 'Put {c} into the {b}.', 'The {b} needs {c}.'],
      milestone: ['Own {n} {bs}.', 'Get us up to {n} {bs}.', 'Reach {n} {bs} total.'],
      income: ['Get the business earning {amt} a second.', 'Push income up to {amt}/s.', 'I want to see {amt} per second.'],
      cash: ['Have {amt} in the bank at once.', 'Save up {amt}.', 'Hold {amt} in cash.'],
      wins: ['Win {c}.', 'Go win {c} in the arena.', 'Come back with {c} won.'],
      winwith: ['Win a battle with the {w}.', 'Take the {w} into a fight and win.', 'Win one with the {w} in your hands.'],
      crate: ['Grab {c}.', 'Claim {c} when they show up.', 'Find me {c}.'],
      variety: ['Own {n} different kinds of business.', 'Run {n} different businesses.', 'Spread out to {n} different businesses.'],
      weapon: ['Put {c} into your guns.', 'Get {c} done at the armory.', 'I want to see {c}.'],
    },
    count: { upgrade: ['an upgrade', '{n} upgrades'], wins: ['a battle', '{n} battles'], crate: ['a golden crate', '{n} golden crates'], weapon: ['a weapon upgrade', '{n} weapon upgrades'] },
    plural: { lemon: 'Lemonade Stands', cafe: 'Coffee Shops', arcade: 'Arcades', fact: 'Factories', bank: 'Banks', oil: 'Oil Rigs', space: 'Space Mines', ailab: 'AI Labs', dyson: 'Dyson Spheres' },
  };
  const QUEST_MOODS = Object.keys(QUEST_TEXT.moods);
  // seeded random numbers (the same sequence in rules.gd): a 32-bit FNV-style hash of the keys picks the
  // seed, so neighbouring areas, reboots and jobs get unrelated sequences
  const qhash = keys => {
    let h = 2166136261;
    for (const v of keys) { h = Math.imul(h ^ (v & 0xffff), 16777619); h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619); }
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    return (h >>> 0) % 2147483646 + 1;
  };
  const qrng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const qpick = (r, list) => list[Math.floor(r() * list.length)];
  const reboots = t => (t.level - 1) + t.prestige;
  const qseed = (area, rb, n, salt = 0) => qhash([QUEST_AREAS.indexOf(area) + 1, rb, n + 1, salt]);
  // stats count for good; run counts since the last reboot (what a reboot asks for: rebootGoals)
  const questState = t => { const q = (t.quest = t.quest || { stats: { wins: 0, crates: 0, with: {} }, areas: {} }); q.run = q.run || { wins: 0, jobs: 0 }; return q; };
  const questArea = (t, area) => { const q = questState(t); return q.areas[area] || (q.areas[area] = { n: 0, active: null }); };
  // The person in an area for this reboot.
  function questGiver(t, area) {
    const r = qrng(qseed(area, reboots(t), -1));
    return { name: qpick(r, QUEST_TEXT.first) + ' ' + qpick(r, QUEST_TEXT.last), role: qpick(r, QUEST_TEXT.roles[area]), mood: qpick(r, QUEST_MOODS), look: Math.floor(r() * 1000) };
  }
  const weaponUps = t => Object.values(t.weapons).reduce((s, w) => s + w.dmg + w.rate + w.mag + w.armor, 0);
  const kinds = t => BUILDINGS.filter(b => owned(t, b.id) > 0).length;
  // rounds up to 3 significant figures (the exponent found exactly, so rules.gd gets the same)
  const round3 = v => {
    if (v <= 0) return 0;
    let e = Math.floor(Math.log10(v)); if (Math.pow(10, e + 1) <= v) e++; if (Math.pow(10, e) > v) e--;
    const p = Math.pow(10, e - 2); return Math.ceil(v / p) * p;
  };
  // The job an area's person offers now (kind, business, weapon, size, lines). n: jobs done there this reboot.
  function questKind(t, area, n) {
    const r = qrng(qseed(area, reboots(t), n)), list = QUEST_KINDS[area];
    const prev = n > 0 ? qrng(qseed(area, reboots(t), n - 1))() : -1, prevKind = prev < 0 ? '' : list[Math.floor(prev * list.length)];
    let k = Math.floor(r() * list.length);
    for (let tries = 0; tries < list.length; tries++, k = (k + 1) % list.length) {
      const kind = list[k], b = area === 'plaza' ? null : BUILDINGS.find(x => x.id === area);
      if (kind === prevKind) continue;
      if (kind === 'variety' && kinds(t) >= BUILDINGS.filter(x => unlocked(t, x)).length) continue;
      if (kind === 'milestone' && b && owned(t, b.id) >= MILESTONES[MILESTONES.length - 1]) continue;
      if (kind === 'weapon' && Object.values(t.weapons).every(w => w.dmg + w.rate + w.mag + w.armor >= 4 * MAX_LVL)) continue;
      return kind;
    }
    return list[0];
  }
  function questOffer(t, area) {
    const st = questArea(t, area), n = st.n, r = qrng(qseed(area, reboots(t), n, 1));
    const kind = questKind(t, area, n), b = BUILDINGS.find(x => x.id === area) || null;
    const owns = Object.keys(t.weapons);
    const o = { area, kind, id: b ? b.id : null, w: kind === 'winwith' ? owns[Math.floor(r() * owns.length)] : null, size: r(), why: Math.floor(r() * 1000), ask: Math.floor(r() * 1000) };
    return o;
  }
  // What the job needs, from the business as it is now (taken when you accept): { base, target }
  function questTarget(t, o) {
    const q = questState(t), s = o.size, b = o.id && BUILDINGS.find(x => x.id === o.id);
    switch (o.kind) {
      case 'buy': return { base: owned(t, b.id), target: owned(t, b.id) + [3, 5, 8, 10, 12, 15][Math.floor(s * 6)] };
      case 'upgrade': return { base: bLevel(t, b.id), target: bLevel(t, b.id) + (s > 0.75 ? 2 : 1) };
      case 'milestone': return { base: owned(t, b.id), target: nextMilestone(owned(t, b.id)) || owned(t, b.id) + 25 };
      case 'income': return { base: income(t), target: round3(Math.max(5, income(t) * (1.5 + s * 1.5))) };
      case 'cash': return { base: t.money, target: round3(Math.max(200, t.money * 1.3, income(t) * (60 + s * 180))) };
      case 'wins': return { base: q.stats.wins, target: q.stats.wins + 1 + Math.floor(s * 3) };
      case 'winwith': return { base: q.stats.with[o.w] || 0, target: (q.stats.with[o.w] || 0) + 1 };
      case 'crate': return { base: q.stats.crates, target: q.stats.crates + (s > 0.7 ? 2 : 1) };
      case 'variety': { const k = kinds(t), max = BUILDINGS.filter(x => unlocked(t, x)).length; return { base: k, target: Math.min(max, k + (s > 0.6 ? 2 : 1)) }; }
      case 'weapon': return { base: weaponUps(t), target: weaponUps(t) + 2 + Math.floor(s * 3) };
    }
    return { base: 0, target: 1 };
  }
  // How far along the active job in an area is: [now, target] (null if none).
  function questProgress(t, area) {
    const a = questArea(t, area).active; if (!a) return null;
    const q = questState(t), b = a.id && BUILDINGS.find(x => x.id === a.id);
    const now = { buy: () => owned(t, a.id), milestone: () => owned(t, a.id), upgrade: () => bLevel(t, a.id), income: () => income(t), cash: () => t.money,
      wins: () => q.stats.wins, winwith: () => q.stats.with[a.w] || 0, crate: () => q.stats.crates, variety: () => kinds(t), weapon: () => weaponUps(t) }[a.kind];
    return [now ? now() : 0, a.target, !!b];
  }
  const questDone = (t, area) => { const p = questProgress(t, area); return !!p && p[0] >= p[1]; };
  const questReward = (t, area) => { const a = questArea(t, area), k = (a.active || questOffer(t, area)).kind; return Math.max(250 * Math.pow(2, t.level - 1), income(t) * QUEST_PAY[k] * (1 + 0.15 * Math.min(10, a.n))); };
  // The words: who's talking and what they say about the current (or offered) job.
  function questTalk(t, area) {
    const g = questGiver(t, area), m = QUEST_TEXT.moods[g.mood], st = questArea(t, area), a = st.active;
    const o = a || questOffer(t, area), r = qrng(qseed(area, reboots(t), st.n, 2)), tg = a || questTarget(t, o);
    // {n}: how many more for the counting jobs, the total for the rest
    const n = ['buy', 'upgrade', 'wins', 'crate', 'weapon'].includes(o.kind) ? tg.target - tg.base : tg.target;
    const cw = QUEST_TEXT.count[o.kind], c = cw ? cw[n === 1 ? 0 : 1].replace('{n}', String(n)) : '';
    const fill = s => s.replace('{c}', c).replace('{n}', String(n)).replace('{b}', o.id ? BUILDINGS.find(x => x.id === o.id).name : '').replace('{bs}', o.id ? QUEST_TEXT.plural[o.id] : '')
      .replace('{amt}', fmt(tg.target)).replace('{w}', o.w ? WEAPONS.find(x => x.id === o.w).name : '');
    const why = QUEST_TEXT.why[o.kind], ask = QUEST_TEXT.ask[o.kind];
    return { name: g.name, role: g.role, mood: g.mood, look: g.look, hi: qpick(r, m.hi), take: qpick(r, m.take), wait: qpick(r, m.wait), done: qpick(r, m.done),
      why: why[o.why % why.length], ask: fill(ask[o.ask % ask.length]), reward: questReward(t, area), points: t.level >= MAX_BIZ && (st.n + 1) % 3 === 0 ? 1 : 0 };
  }
  // A battle won: counts towards win jobs and the next reboot.
  function recordWin(t) { const q = questState(t), s = q.stats; s.wins++; s.with[t.equipped] = (s.with[t.equipped] || 0) + 1; q.run.wins++; }

  // ---------- What a reboot takes ----------
  // Money alone only takes waiting, so a reboot also asks for work done since the last one: fights won,
  // jobs finished for the people round your business, milestones reached (25/50/100/200 of a building) and
  // weapon upgrades. Every goal grows with each reboot, up to the 16th.
  const REBOOT_GOALS = {
    cash: { name: 'Cash', icon: '💵', desc: 'Money in the bank.' },
    wins: { name: 'Fights won', icon: '⚔️', desc: 'Battles won since your last reboot.' },
    jobs: { name: 'Jobs done', icon: '📋', desc: 'Jobs finished for the people round your business since your last reboot.' },
    milestones: { name: 'Milestones', icon: '🏭', desc: 'Owning 25, 50, 100 or 200 of a building: each one reached counts.' },
    gear: { name: 'Weapon upgrades', icon: '🔫', desc: 'Upgrade levels across all your weapons.' },
  };
  const milestonesReached = t => BUILDINGS.reduce((s, b) => s + MILESTONES.filter(m => owned(t, b.id) >= m).length, 0);
  function rebootGoals(t) {
    const n = Math.min(reboots(t) + 1, 16), run = questState(t).run;
    return [
      { id: 'cash', have: t.money, need: rebootCost(t) },
      { id: 'wins', have: run.wins, need: Math.min(3 + 2 * (n - 1), 25) },
      { id: 'jobs', have: run.jobs, need: Math.min(1 + n, 10) },
      { id: 'milestones', have: milestonesReached(t), need: n + 1 },
      { id: 'gear', have: weaponUps(t), need: 2 + 2 * n },
    ];
  }
  // Why you can't reboot yet (null: you can).
  function rebootBlocker(t) {
    const g = rebootGoals(t).find(g => g.have < g.need); if (!g) return null;
    const left = Math.ceil(g.need - g.have), s = left === 1 ? '' : 's';
    return { cash: `Need ${fmt(g.need)} to reboot`, wins: `Win ${left} more fight${s} first`, jobs: `Finish ${left} more job${s} for the people round your business first`,
      milestones: `Reach ${left} more milestone${s} first`, gear: `Upgrade your weapons ${left} more time${s} first` }[g.id];
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
      t.event = null; t.money += Math.max(100, income(t) * 90); questState(t).stats.crates++;
    } else if (a.type === 'quest') {
      if (!QUEST_AREAS.includes(a.area)) return 'Nobody there';
      if (a.area !== 'plaza' && !owned(t, a.area)) return 'Buy one first';
      const st = questArea(t, a.area);
      if (a.op === 'accept') {
        if (st.active) return 'You already have that job';
        const o = questOffer(t, a.area); st.active = { kind: o.kind, id: o.id, w: o.w, why: o.why, ask: o.ask, ...questTarget(t, o) };
      } else if (a.op === 'claim') {
        if (!questDone(t, a.area)) return 'Not done yet';
        const talk = questTalk(t, a.area);
        t.money += talk.reward; t.points += talk.points; st.n++; st.active = null; questState(t).run.jobs++;
      } else if (a.op === 'drop') { st.n++; st.active = null; } // a new job next time
      else return 'Bad action';
    } else if (a.type === 'reboot') {
      const blocked = rebootBlocker(t); if (blocked) return blocked;
      if (t.level < MAX_BIZ) t.level++;
      else { t.points += prestigePoints(t); t.prestige++; }
      Object.assign(t, { money: startCash(t), buildings: {}, weapons: freshWeapons(), equipped: 'pistol', event: null });
      questState(t).areas = {}; questState(t).run = { wins: 0, jobs: 0 }; // new people, new jobs, new goals
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
    const rq = raw.quest;
    if (rq && typeof rq === 'object') {
      const q = questState(t), rs = rq.stats || {};
      q.stats.wins = int(rs.wins, 0, 1e7); q.stats.crates = int(rs.crates, 0, 1e7);
      q.run = { wins: int(rq.run?.wins, 0, 1e7), jobs: int(rq.run?.jobs, 0, 1e7) };
      for (const w of WEAPONS) { const v = int(rs.with?.[w.id], 0, 1e7); if (v) q.stats.with[w.id] = v; }
      for (const area of QUEST_AREAS) {
        const ra = rq.areas?.[area]; if (!ra) continue;
        const st = questArea(t, area); st.n = int(ra.n, 0, 1e5);
        const a = ra.active;
        if (a && QUEST_PAY[a.kind] !== undefined) st.active = { kind: a.kind, id: area === 'plaza' ? null : area, w: WEAPONS.some(w => w.id === a.w) ? a.w : null,
          why: int(a.why, 0, 999), ask: int(a.ask, 0, 999), base: num(a.base, 0, 1e21), target: num(a.target, 0, 1e21) };
      }
    }
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
    perk, perkCost, rebootCost, prestigePoints, eventOn, rollEvent, applyAction, sanitizeTycoon,
    REBOOT_GOALS, rebootGoals, rebootBlocker,
    QUEST_AREAS, QUEST_KINDS, QUEST_PAY, QUEST_TEXT, questGiver, questOffer, questProgress, questDone, questTalk, questArea, recordWin, reboots, wealthDistance, matchDistance, searchWindow, newRivals, tickRival, rivalLoadout,
    W, H, hitsWall, moveUnit, nextWaypoint, newArena, stepArena, botInput, snapshot };
});
