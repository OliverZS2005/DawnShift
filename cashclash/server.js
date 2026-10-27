// Cash Clash multiplayer server. Anyone can host one:
//   npm install && npm start            (PORT=8080 by default)
// It serves the game page too, so players can just open http://<host>:<port>.
// Env: PORT, DATA_FILE (default ./players.json), ALLOW_IMPORT=0 to forbid importing singleplayer saves.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const CC = require('./shared.js');

const PORT = +process.env.PORT || 8080;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'players.json');
const ALLOW_IMPORT = process.env.ALLOW_IMPORT !== '0';
const SERVER_NAME = process.env.SERVER_NAME || 'Cash Clash Server';
const TICK = 1 / 30;

// ---------- Persistence ----------
// players: token -> { id, name, tycoon, wins, losses, last }
let players = {};
try { players = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
let dirty = false;
setInterval(() => { if (!dirty) return; dirty = false; fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(players), e => { if (!e) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {}); }); }, 5000);

// ---------- HTTP (static files) ----------
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/shared.js': 'shared.js' };
const server = http.createServer((req, res) => {
  const f = STATIC[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
});

// ---------- Sessions ----------
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const online = new Map(); // ws -> session { ws, p, queuedAt, match }
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const cleanName = n => String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Player' + Math.floor(Math.random() * 1000);
const publicState = p => ({ name: p.name, tycoon: p.tycoon, wins: p.wins, losses: p.losses });

wss.on('connection', ws => {
  let s = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!s) {
      if (m.type !== 'hello') return;
      let p = m.token && players[m.token];
      if (p) {
        // Returning player: pay out offline earnings.
        const earned = CC.offlineEarnings(p.tycoon, (Date.now() - p.last) / 1000);
        p.tycoon.money += earned;
        if (earned > 1) send(ws, { type: 'toast', msg: `Offline earnings: ${CC.fmt(earned)}` });
      } else {
        if (m.mode !== 'new' && m.mode !== 'import') return send(ws, { type: 'needMode' });
        if (m.mode === 'import' && !ALLOW_IMPORT) return send(ws, { type: 'error', msg: 'This server does not allow importing singleplayer saves.' });
        const token = crypto.randomBytes(18).toString('hex');
        p = players[token] = { id: crypto.randomBytes(6).toString('hex'), token, name: cleanName(m.name),
          tycoon: m.mode === 'import' ? CC.sanitizeTycoon(m.tycoon) : CC.newTycoon(), wins: 0, losses: 0, last: Date.now() };
      }
      for (const o of online.values()) if (o.p === p) { send(o.ws, { type: 'error', msg: 'Logged in from another tab.' }); o.ws.close(); }
      s = { ws, p, queuedAt: 0, match: null };
      online.set(ws, s); dirty = true;
      send(ws, { type: 'welcome', token: p.token, server: SERVER_NAME, allowImport: ALLOW_IMPORT, state: publicState(p) });
      return;
    }
    if (m.type === 'action') {
      if (s.match) return send(ws, { type: 'toast', msg: 'Finish your battle first' });
      const err = CC.applyAction(s.p.tycoon, m.action);
      if (err) send(ws, { type: 'toast', msg: err });
      dirty = true; send(ws, { type: 'state', state: publicState(s.p) });
    } else if (m.type === 'rename') {
      s.p.name = cleanName(m.name); dirty = true;
    } else if (m.type === 'queue') {
      if (s.match) return;
      if (s.p.tycoon.money < 10) return send(ws, { type: 'toast', msg: 'You need at least $10 to battle' });
      s.queuedAt = Date.now();
    } else if (m.type === 'cancel') {
      s.queuedAt = 0; send(ws, { type: 'queue', status: 'idle' });
    } else if (m.type === 'input' && s.match) {
      const i = m.input || {};
      s.match.inputs[s.match.sessions.indexOf(s)] = { mx: +i.mx || 0, my: +i.my || 0, ang: +i.ang || 0, shoot: !!i.shoot, reload: !!i.reload, sw: typeof i.sw === 'string' ? i.sw : undefined };
    }
  });
  ws.on('close', () => {
    if (!s) return;
    s.p.last = Date.now(); dirty = true;
    if (s.match) endMatch(s.match, 1 - s.match.sessions.indexOf(s), 'opponent disconnected');
    online.delete(ws);
  });
});

// ---------- Economy tick ----------
let lastEco = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - lastEco) / 1000; lastEco = now;
  for (const s of online.values()) { s.p.tycoon.money += CC.income(s.p.tycoon) * dt; s.p.last = now; send(s.ws, { type: 'state', state: publicState(s.p) }); }
  dirty = true;
}, 1000);

// ---------- Matchmaking ----------
// Every 250ms, pair queued players by closest wealth (log scale). Each player's acceptable
// range widens the longer they wait; a pair is made when it fits the wider of the two windows.
setInterval(() => {
  const now = Date.now();
  const q = [...online.values()].filter(s => s.queuedAt && !s.match).sort((a, b) => a.queuedAt - b.queuedAt);
  const taken = new Set();
  for (const a of q) {
    if (taken.has(a)) continue;
    let best = null, bestD = Infinity;
    for (const b of q) {
      if (b === a || taken.has(b)) continue;
      const d = CC.wealthDistance(a.p.tycoon.money, b.p.tycoon.money);
      if (d < bestD) { best = b; bestD = d; }
    }
    const win = CC.searchWindow(Math.max(now - a.queuedAt, best ? now - best.queuedAt : 0) / 1000);
    if (best && bestD <= win) { taken.add(a); taken.add(best); startMatch(a, best); }
    else send(a.ws, { type: 'queue', status: 'searching', wait: (now - a.queuedAt) / 1000, window: win, inQueue: q.length });
  }
}, 250);

// ---------- Battles (server-authoritative) ----------
const matches = new Set();
function startMatch(a, b) {
  const M = { sessions: [a, b], arena: CC.newArena(a.p.tycoon, b.p.tycoon), inputs: [{}, {}], over: false };
  // The pot is fixed when the match starts, so earning/spending mid-fight can't change the stakes.
  M.pot = [a.p.tycoon.money * CC.STEAL, b.p.tycoon.money * CC.STEAL];
  a.queuedAt = b.queuedAt = 0; a.match = b.match = M; matches.add(M);
  M.sessions.forEach((s, i) => { const o = M.sessions[1 - i]; send(s.ws, { type: 'match', you: i, opp: { name: o.p.name, money: o.p.tycoon.money }, pot: { win: M.pot[1 - i], lose: M.pot[i] } }); });
}
function endMatch(M, winner, reason) {
  if (M.over) return; M.over = true; matches.delete(M);
  const w = M.sessions[winner].p, l = M.sessions[1 - winner].p;
  const amount = Math.min(M.pot[1 - winner], l.tycoon.money);
  l.tycoon.money -= amount; w.tycoon.money += amount; w.wins++; l.losses++; dirty = true;
  M.sessions.forEach((s, i) => { s.match = null; send(s.ws, { type: 'result', won: i === winner, amount, opp: M.sessions[1 - i].p.name, reason }); send(s.ws, { type: 'state', state: publicState(s.p) }); });
}
setInterval(() => {
  for (const M of matches) {
    const w = CC.stepArena(M.arena, M.inputs, TICK);
    M.inputs.forEach(i => { i.reload = false; i.sw = undefined; }); // one-shot inputs
    const snap = CC.snapshot(M.arena);
    M.sessions.forEach(s => send(s.ws, { type: 'snap', snap }));
    if (w >= 0) endMatch(M, w);
    else if (M.arena.t > 180) endMatch(M, M.arena.units[0].hp >= M.arena.units[1].hp ? 0 : 1, 'time limit');
  }
}, TICK * 1000);

// ---------- Leaderboard ----------
setInterval(() => {
  const onlineIds = new Set([...online.values()].map(s => s.p.id));
  const board = Object.values(players).sort((a, b) => b.tycoon.money - a.tycoon.money).slice(0, 25)
    .map(p => ({ id: p.id, name: p.name, money: p.tycoon.money, wins: p.wins, losses: p.losses, online: onlineIds.has(p.id) }));
  for (const s of online.values()) send(s.ws, { type: 'board', board, you: s.p.id, online: online.size });
}, 2000);

server.listen(PORT, () => console.log(`${SERVER_NAME} listening on http://localhost:${PORT} (import ${ALLOW_IMPORT ? 'allowed' : 'disabled'})`));
