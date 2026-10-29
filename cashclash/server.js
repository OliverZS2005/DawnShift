// Hustlefront multiplayer server. Anyone can host one:
//   npm install && npm start            (PORT=8080 by default)
// It serves the game page too, so players can just open http://<host>:<port>.
// Env: PORT, DATA_FILE (default ./players.json), SYNC_FILE, ACCOUNT_FILE, NEWS_FILE, NEWS_URL (another server's
// /api/news to follow), ALLOW_IMPORT=0 to forbid importing singleplayer saves.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const CC = require('./shared.js');

const PORT = +process.env.PORT || 8080;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'players.json');
const ALLOW_IMPORT = process.env.ALLOW_IMPORT !== '0';
const SERVER_NAME = process.env.SERVER_NAME || 'Hustlefront Server';
const TICK = CC.TICK;

// ---------- Persistence ----------
// players: token -> { id, name, tycoon, wins, losses, last }
let players = {};
try { players = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
for (const p of Object.values(players)) p.tycoon = CC.upgradeSave(p.tycoon);
let dirty = false;
setInterval(() => { if (!dirty) return; dirty = false; fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(players), e => { if (!e) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {}); }); }, 5000);

// ---------- Cloud saves (web <-> desktop sync) ----------
// A sync code holds one save blob: { sp: singleplayer game, tokens: { serverUrl: multiplayer token } }.
// Writes carry the `base` version the device last saw; if another device wrote since, we answer 409
// with the newer save so the device can load it instead of overwriting it.
const SYNC_FILE = process.env.SYNC_FILE || path.join(path.dirname(DATA_FILE), 'syncs.json');
let syncs = {};
try { syncs = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8')); } catch {}
let syncDirty = false;
setInterval(() => { if (!syncDirty) return; syncDirty = false; fs.writeFile(SYNC_FILE + '.tmp', JSON.stringify(syncs), e => { if (!e) fs.rename(SYNC_FILE + '.tmp', SYNC_FILE, () => {}); }); }, 5000);
const SYNC_CODE = /^[A-Z0-9]{10}$/;
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
function handleSync(req, res, code) {
  if (!SYNC_CODE.test(code)) return json(res, 400, { error: 'Bad sync code' });
  const cur = syncs[code];
  if (req.method === 'GET') return cur ? json(res, 200, cur) : json(res, 404, { error: 'Unknown sync code' });
  if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
  let body = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 512 * 1024) { json(res, 413, { error: 'Save too large' }); req.destroy(); } else body += c; });
  req.on('end', () => {
    if (res.writableEnded) return;
    let m; try { m = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad JSON' }); }
    if (!m || typeof m.save !== 'object') return json(res, 400, { error: 'Missing save' });
    if (cur && cur.updatedAt !== m.base) return json(res, 409, cur);
    if (!cur && m.base) return json(res, 404, { error: 'Unknown sync code' });
    syncs[code] = { save: m.save, updatedAt: Math.max(Date.now(), (cur?.updatedAt || 0) + 1), device: String(m.device || '').slice(0, 20) };
    syncDirty = true;
    json(res, 200, { updatedAt: syncs[code].updatedAt });
  });
}

// ---------- Accounts (sign up / log in) ----------
// An account is a name and password in front of a sync code: logging in hands the device the account's
// code, and the sync above does the rest (the save, other devices, conflicts). Passwords are kept only as
// salted scrypt hashes; names are matched without case. Too many attempts from one address wait a while.
const ACCOUNT_FILE = process.env.ACCOUNT_FILE || path.join(path.dirname(DATA_FILE), 'accounts.json');
let accounts = {}; // lowercased name -> { name, salt, hash, code, created }
try { accounts = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')); } catch {}
const saveAccounts = () => fs.writeFile(ACCOUNT_FILE + '.tmp', JSON.stringify(accounts), e => { if (!e) fs.rename(ACCOUNT_FILE + '.tmp', ACCOUNT_FILE, () => {}); });
const ACCOUNT_NAME = /^[\w][\w .-]{1,18}[\w]$/; // 3-20 letters, digits, spaces, dots, dashes
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const tries = new Map(); // address -> [times of recent attempts]
const tooMany = ip => { const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 10 * 60e3); t.push(now); tries.set(ip, t); return t.length > 20; };
const newCode = () => Array.from(crypto.randomBytes(10), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
function handleAccount(req, res, op) {
  if (req.method !== 'POST' || (op !== 'signup' && op !== 'login')) return json(res, 404, { error: 'Not found' });
  if (tooMany(req.socket.remoteAddress)) return json(res, 429, { error: 'Too many tries. Wait a few minutes and try again.' });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    let m; try { m = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad JSON' }); }
    const name = String(m?.name || '').trim(), pw = String(m?.password || ''), key = name.toLowerCase();
    if (op === 'signup') {
      if (!ACCOUNT_NAME.test(name)) return json(res, 400, { error: 'Pick a name of 3 to 20 letters or digits.' });
      if (pw.length < 6) return json(res, 400, { error: 'Pick a password of at least 6 characters.' });
      if (accounts[key]) return json(res, 409, { error: 'That name is taken.' });
      let code; do code = newCode(); while (syncs[code]);
      const salt = crypto.randomBytes(16).toString('hex');
      accounts[key] = { name, salt, hash: hashPw(pw, salt), code, created: Date.now() };
      saveAccounts();
      return json(res, 200, { name, code });
    }
    const a = accounts[key];
    const ok = a && crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
    if (!ok) return json(res, 401, { error: 'Wrong name or password.' });
    json(res, 200, { name: a.name, code: a.code });
  });
}

// ---------- News (announcements and "a new version is out") ----------
// GET /api/news hands out news.json: announcements, and the game's latest version number with where to
// download it (the apps compare it with their own). The file is read again whenever it changes, so editing
// it (or `npm run announce`) reaches every player within minutes. With NEWS_URL set to another server's
// /api/news, this server follows that feed too and passes its posts on: one main server can announce to
// every server that follows it.
const NEWS_FILE = process.env.NEWS_FILE || path.join(__dirname, 'news.json');
const NEWS_URL = process.env.NEWS_URL || '';
let newsLocal = { version: 0, posts: [] }, newsAt = 0, newsUp = null;
function localNews() {
  try { const t = fs.statSync(NEWS_FILE).mtimeMs; if (t !== newsAt) { newsLocal = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); newsAt = t; } } catch {}
  return newsLocal;
}
function followNews() {
  if (!NEWS_URL) return;
  const get = NEWS_URL.startsWith('https:') ? require('https').get : http.get;
  get(NEWS_URL, { timeout: 10000 }, r => {
    let body = ''; r.on('data', c => { body += c; if (body.length > 256 * 1024) r.destroy(); });
    r.on('end', () => { try { const n = JSON.parse(body); if (Array.isArray(n.posts)) newsUp = n; } catch {} });
  }).on('error', () => {});
}
followNews(); setInterval(followNews, 10 * 60e3);
function news() {
  const a = localNews(), b = newsUp || { version: 0, posts: [] }, seen = new Set(), posts = [];
  for (const p of [...(a.posts || []), ...(b.posts || [])]) if (p && p.id && !seen.has(p.id)) { seen.add(p.id); posts.push(p); }
  posts.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const up = (b.version || 0) > (a.version || 0);
  return { server: SERVER_NAME, version: Math.max(a.version || 0, b.version || 0), download: (up ? b.download : a.download) || a.download || b.download || '', posts: posts.slice(0, 30) };
}

// ---------- HTTP (static files + sync and account API) ----------
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/shared.js': 'shared.js', '/models.js': 'models.js', '/render3d.js': 'render3d.js', '/vendor/three.bundle.js': 'vendor/three.bundle.js' };
// The 3D art (models, textures, skies) lives in desktop/assets so the Godot app shares it.
const ASSET_DIR = path.join(__dirname, 'desktop', 'assets');
const TYPES = { '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.js': 'text/javascript', '.html': 'text/html' };
function staticFile(url) {
  if (STATIC[url]) return path.join(__dirname, STATIC[url]);
  if (!url.startsWith('/desktop/assets/')) return null;
  const f = path.normalize(path.join(ASSET_DIR, decodeURIComponent(url.slice('/desktop/assets/'.length))));
  return f.startsWith(ASSET_DIR + path.sep) && TYPES[path.extname(f)] ? f : null; // no escaping the folder
}
const server = http.createServer((req, res) => {
  // Desktop app and file:// pages call the sync API from other origins.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const sm = req.url.match(/^\/api\/sync\/([^/?]+)/);
  if (sm) return handleSync(req, res, sm[1]);
  // lets the login forms check an address before you sign up ("Check" next to Server)
  if (req.url === '/api/info') return json(res, 200, { game: 'Hustlefront', name: SERVER_NAME, accounts: true });
  if (req.url === '/api/news') return json(res, 200, news());
  const am = req.url.match(/^\/api\/account\/(\w+)$/);
  if (am) return handleAccount(req, res, am[1]);
  const f = staticFile(req.url.split('?')[0]);
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
  const art = f.startsWith(ASSET_DIR);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': art ? 'public, max-age=86400' : 'no-cache' });
  fs.createReadStream(f).pipe(res);
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
      const idx = s.match.sessions.indexOf(s), prev = s.match.inputs[idx];
      if (+i.seq > 0) s.match.acks[idx] = +i.seq;
      // one-shot inputs (reload / weapon switch) survive until the next tick consumes them
      s.match.inputs[idx] = { reload: !!i.reload || !!prev.reload, sw: (typeof i.sw === 'string' ? i.sw : undefined) || prev.sw, mx: +i.mx || 0, my: +i.my || 0, ang: +i.ang || 0, shoot: !!i.shoot };
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
  for (const s of online.values()) {
    const ev = CC.rollEvent(s.p.tycoon);
    if (ev) send(s.ws, { type: 'event', event: ev });
    s.p.tycoon.money += CC.income(s.p.tycoon) * dt; s.p.last = now; send(s.ws, { type: 'state', state: publicState(s.p) }); }
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
      const d = CC.matchDistance(a.p.tycoon, b.p.tycoon);
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
  const M = { sessions: [a, b], arena: CC.newArena(a.p.tycoon, b.p.tycoon), inputs: [{}, {}], acks: [0, 0], over: false };
  // The pot is fixed when the match starts, so earning/spending mid-fight can't change the stakes.
  M.pot = [a.p.tycoon.money * CC.STEAL, b.p.tycoon.money * CC.STEAL];
  a.queuedAt = b.queuedAt = 0; a.match = b.match = M; matches.add(M);
  M.sessions.forEach((s, i) => { const o = M.sessions[1 - i]; send(s.ws, { type: 'match', you: i, map: M.arena.map, opp: { name: o.p.name, money: o.p.tycoon.money }, pot: { win: M.pot[1 - i], lose: M.pot[i] } }); });
}
function endMatch(M, winner, reason) {
  if (M.over) return; M.over = true; matches.delete(M);
  const w = M.sessions[winner].p, l = M.sessions[1 - winner].p;
  const amount = Math.min(M.pot[1 - winner], l.tycoon.money);
  l.tycoon.money -= amount; w.tycoon.money += amount; w.wins++; l.losses++; CC.recordWin(w.tycoon); dirty = true;
  M.sessions.forEach((s, i) => { s.match = null; send(s.ws, { type: 'result', won: i === winner, amount, opp: M.sessions[1 - i].p.name, reason }); send(s.ws, { type: 'state', state: publicState(s.p) }); });
}
setInterval(() => {
  for (const M of matches) {
    const w = CC.stepArena(M.arena, M.inputs, TICK);
    M.inputs.forEach(i => { i.reload = false; i.sw = undefined; }); // one-shot inputs
    const snap = CC.snapshot(M.arena);
    M.sessions.forEach((s, i) => send(s.ws, { type: 'snap', snap, ack: M.acks[i] }));
    if (w >= 0) endMatch(M, w, M.arena.units.every(u => u.hp > 0) ? 'time limit' : undefined);
  }
}, TICK * 1000);

// ---------- Leaderboard ----------
setInterval(() => {
  const onlineIds = new Set([...online.values()].map(s => s.p.id));
  const board = Object.values(players).sort((a, b) => b.tycoon.money - a.tycoon.money).slice(0, 25)
    .map(p => ({ id: p.id, name: p.name, money: p.tycoon.money, level: p.tycoon.level, prestige: p.tycoon.prestige, wins: p.wins, losses: p.losses, online: onlineIds.has(p.id) }));
  for (const s of online.values()) send(s.ws, { type: 'board', board, you: s.p.id, online: online.size });
}, 2000);

server.listen(PORT, () => console.log(`${SERVER_NAME} listening on http://localhost:${PORT} (import ${ALLOW_IMPORT ? 'allowed' : 'disabled'})`));
