// Dawnshift server (hosted-app model).
//
// One account per user. Their team, bots, tasks, API keys and files live on
// this server, not on their device. Bots keep running on the server even when
// the user is offline (routines, in-flight tasks). Browsers and apps are thin
// clients that read and write through this HTTP API with a Bearer token.
//
// Run: node sync-server/server.js
// Env: PORT (default 3790), HOST, DATA_DIR, STATIC_DIR, TRUST_PROXY.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';
import { createApi } from '../src/api.js';
import { callModel } from '../src/providers.js';
import { setOwnPort } from '../src/tools.js';
import { newRecoveryCode, normalizeRecoveryCode } from '../src/sync-crypto.js';

const scrypt = promisify(crypto.scrypt);

const MAX_JSON = 32 * 1024;
const MAX_UPLOAD = 2 * 1024 * 1024;
// Where the mobile app and desktop app run from, so they can call the API.
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);
const SESSION_DAYS = 60;

// ---------- app downloads (/api/download/<slug>) ----------

// The GitHub repo the installers live in. Used when proxying download links.
const RELEASE_REPO = process.env.DAWNSHIFT_RELEASE_REPO || 'OliverZS2005/ClaudeCodeIsTuff';
const DOWNLOADS = {
  android: { tag: 'android-latest', match: /\.apk$/ },
  windows: { tag: 'desktop-latest', match: /-win-x64\.exe$/ },
  'mac-arm': { tag: 'desktop-latest', match: /-mac-arm64\.dmg$/ },
  'mac-intel': { tag: 'desktop-latest', match: /-mac-x64\.dmg$/ },
  'linux-deb': { tag: 'desktop-latest', match: /-linux-amd64\.deb$/ },
  'linux-appimage': { tag: 'desktop-latest', match: /-linux-x86_64\.AppImage$/ },
};
async function githubToken() {
  if (process.env.DAWNSHIFT_GH_TOKEN) return process.env.DAWNSHIFT_GH_TOKEN.trim();
  if (process.env.DAWNSHIFT_GH_TOKEN_FILE) {
    try { return (await fsp.readFile(process.env.DAWNSHIFT_GH_TOKEN_FILE, 'utf8')).trim(); } catch {}
  }
  return null;
}

// Returns a URL the browser can follow to download the installer. With a
// GitHub token it's a short-lived signed URL (one click, direct download);
// without one it's the release page (works for a signed-in GitHub user
// while the repo is private).
async function resolveDownload(slug) {
  const spec = DOWNLOADS[slug];
  if (!spec) return null;
  const page = `https://github.com/${RELEASE_REPO}/releases/tag/${spec.tag}`;
  const token = await githubToken();
  if (!token) return page;
  try {
    const relRes = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${spec.tag}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'dawnshift' },
    });
    if (!relRes.ok) return page;
    const rel = await relRes.json();
    const asset = (rel.assets || []).find((a) => spec.match.test(a.name));
    if (!asset) return page;
    const signed = await fetch(asset.url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/octet-stream', 'user-agent': 'dawnshift' },
      redirect: 'manual',
    });
    const location = signed.headers.get('location');
    return location || page;
  } catch {
    return page;
  }
}

const LOGIN_LIMIT = { tries: 10, windowMs: 15 * 60 * 1000 };
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
// Password: 8 to 256 printable characters (no control chars). HTTPS carries it.
const PASSWORD = /^[\x20-\x7e]{8,256}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

// ---------- the accounts database (one JSON file) ----------

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

export async function openDb(dir) {
  await fsp.mkdir(path.join(dir, 'users'), { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'accounts.json');
  let db = { secret: crypto.randomBytes(32).toString('base64'), users: {}, sessions: {} };
  if (fs.existsSync(file)) db = JSON.parse(await fsp.readFile(file, 'utf8'));
  else await writeAtomic(file, JSON.stringify(db));

  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  return {
    db,
    userDir: (id) => path.join(dir, 'users', id),
    save: () => serial(() => writeAtomic(file, JSON.stringify(db))),
    removeUser: (id) => serial(() => fsp.rm(path.join(dir, 'users', id), { recursive: true, force: true })),
  };
}

// ---------- helpers ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64');

async function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = (await scrypt(password, salt, 32)).toString('base64');
  return { hash, salt };
}

async function checkPassword(password, hash, salt) {
  const got = await scrypt(String(password), salt, 32);
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function str(v, name, { max = 2000, pattern } = {}) {
  if (typeof v !== 'string' || !v || v.length > max || (pattern && !pattern.test(v))) fail(400, `Invalid ${name}.`);
  return v;
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Invalid request.'));
      }
    });
    req.on('error', reject);
  });
}

// Slows down password guessing: a few wrong tries per account and per address.
function createLimiter() {
  const fails = new Map();
  const key = (k) => {
    const now = Date.now();
    const list = (fails.get(k) ?? []).filter((t) => now - t < LOGIN_LIMIT.windowMs);
    fails.set(k, list);
    return list;
  };
  return {
    check(...keys) {
      if (keys.some((k) => key(k).length >= LOGIN_LIMIT.tries)) fail(429, 'Too many tries. Wait 15 minutes and try again.');
    },
    failed: (...keys) => keys.forEach((k) => key(k).push(Date.now())),
    clear: (...keys) => keys.forEach((k) => fails.delete(k)),
  };
}

// ---------- per-user Dawnshift app (store + runner + API) ----------

export function createUsers(store) {
  const cache = new Map();

  function load(userId) {
    if (cache.has(userId)) return cache.get(userId);
    const dataDir = store.userDir(userId);
    const s = createStore(dataDir);
    const runner = createRunner({ store: s, callModel });
    runner.start();
    const entry = { store: s, runner, api: createApi(s, runner) };
    cache.set(userId, entry);
    return entry;
  }

  // Loads every existing user at boot, so their routines keep firing even
  // before they next log in.
  async function loadAll() {
    const base = store.userDir('');
    for (const name of await fsp.readdir(base).catch(() => [])) {
      if (store.db.users[Object.keys(store.db.users).find((u) => store.db.users[u].id === name)]) load(name);
    }
  }

  function remove(userId) {
    const entry = cache.get(userId);
    if (!entry) return;
    entry.store.flush();
    cache.delete(userId);
  }

  function stopAll() {
    for (const { store: s } of cache.values()) s.flush();
    cache.clear();
  }

  return { load, loadAll, remove, stopAll };
}

// ---------- the API ----------

export function createHandler(store, users) {
  const { db } = store;
  const limiter = createLimiter();

  function newSession(username, { recovery = false } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions[sha256(token)] = { username, recovery, expires: Date.now() + SESSION_DAYS * 86400000 };
    return token;
  }

  function session(req) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const s = token && db.sessions[sha256(token)];
    if (!s || s.expires < Date.now() || !db.users[s.username]) fail(401, 'Please log in again.');
    return { ...s, tokenHash: sha256(token), user: db.users[s.username] };
  }

  function cleanSessions() {
    for (const [k, s] of Object.entries(db.sessions)) if (s.expires < Date.now()) delete db.sessions[k];
  }

  const checkUsername = (v) => {
    const u = String(v ?? '').trim().toLowerCase();
    if (!USERNAME.test(u)) fail(400, 'Usernames are 3 to 32 characters: letters, numbers, dots, dashes and underscores.');
    return u;
  };

  const accounts = {
    'GET /api/health': () => ({ ok: true, service: 'dawnshift' }),

    'POST /api/account/signup': async ({ body }) => {
      const u = checkUsername(body.username);
      if (db.users[u]) fail(409, 'That username is taken. Try another one.');
      const password = str(body.password, 'password', { max: 256, pattern: PASSWORD });
      const recoveryCode = newRecoveryCode();
      const auth = await hashPassword(password);
      const recovery = await hashPassword(normalizeRecoveryCode(recoveryCode));
      // Rechecked: someone else may have taken the name while we were hashing.
      if (db.users[u]) fail(409, 'That username is taken. Try another one.');
      db.users[u] = {
        id: crypto.randomUUID(),
        authHash: auth.hash,
        authSalt: auth.salt,
        recoveryHash: recovery.hash,
        recoveryHashSalt: recovery.salt,
        createdAt: new Date().toISOString(),
      };
      users.load(db.users[u].id);
      const token = newSession(u);
      await store.save();
      return { token, username: u, recoveryCode };
    },

    'POST /api/account/login': async ({ body, ip }) => {
      const u = checkUsername(body.username);
      limiter.check(`u:${u}`, `ip:${ip}`);
      const user = db.users[u];
      if (!user || !(await checkPassword(str(body.password, 'password', { max: 256 }), user.authHash, user.authSalt))) {
        limiter.failed(`u:${u}`, `ip:${ip}`);
        fail(401, 'Wrong username or password.');
      }
      limiter.clear(`u:${u}`);
      cleanSessions();
      users.load(user.id);
      const token = newSession(u);
      await store.save();
      return { token, username: u };
    },

    // Reset the password with the recovery code shown at signup.
    'POST /api/account/recover': async ({ body, ip }) => {
      const u = checkUsername(body.username);
      limiter.check(`u:${u}`, `ip:${ip}`);
      const user = db.users[u];
      const code = normalizeRecoveryCode(body.recoveryCode ?? '');
      if (!user || !code || !(await checkPassword(code, user.recoveryHash, user.recoveryHashSalt))) {
        limiter.failed(`u:${u}`, `ip:${ip}`);
        fail(401, 'Wrong username or recovery code.');
      }
      const password = str(body.newPassword, 'new password', { max: 256, pattern: PASSWORD });
      const auth = await hashPassword(password);
      user.authHash = auth.hash;
      user.authSalt = auth.salt;
      // New password: sign out every other device.
      for (const [k, s] of Object.entries(db.sessions)) if (s.username === u) delete db.sessions[k];
      limiter.clear(`u:${u}`);
      users.load(user.id);
      const token = newSession(u);
      await store.save();
      return { token, username: u };
    },

    'POST /api/account/password': async ({ req, body }) => {
      const s = session(req);
      if (!(await checkPassword(str(body.currentPassword, 'current password', { max: 256 }), s.user.authHash, s.user.authSalt))) {
        fail(401, 'Your current password is wrong.');
      }
      const password = str(body.newPassword, 'new password', { max: 256, pattern: PASSWORD });
      const auth = await hashPassword(password);
      Object.assign(s.user, { authHash: auth.hash, authSalt: auth.salt });
      for (const [k, other] of Object.entries(db.sessions)) if (other.username === s.username && k !== s.tokenHash) delete db.sessions[k];
      await store.save();
      return { ok: true };
    },

    'POST /api/account/logout': async ({ req }) => {
      delete db.sessions[session(req).tokenHash];
      await store.save();
      return { ok: true };
    },

    'POST /api/account/delete': async ({ req, body }) => {
      const s = session(req);
      if (!(await checkPassword(str(body.password, 'password', { max: 256 }), s.user.authHash, s.user.authSalt))) fail(401, 'Wrong password.');
      users.remove(s.user.id);
      await store.removeUser(s.user.id);
      delete db.users[s.username];
      for (const [k, other] of Object.entries(db.sessions)) if (other.username === s.username) delete db.sessions[k];
      await store.save();
      return { ok: true };
    },

    'GET /api/account': ({ req }) => {
      const s = session(req);
      return { loggedIn: true, username: s.username, createdAt: s.user.createdAt };
    },
  };

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const cors = APP_ORIGINS.has(req.headers.origin)
      ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' }
      : {};
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204, cors.vary ? {
        ...cors,
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '86400',
      } : {});
      res.end();
      return true;
    }
    if (!url.pathname.startsWith('/api/')) return false;

    // App installer downloads: open to anyone, no login needed.
    if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
      const location = await resolveDownload(url.pathname.slice('/api/download/'.length));
      if (!location) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: "That download doesn't exist." }));
      } else {
        res.writeHead(302, { location, 'cache-control': 'no-store' });
        res.end();
      }
      return true;
    }

    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
    try {
      const body = req.method === 'GET' ? {} : await readJson(req, MAX_UPLOAD);
      let out;
      const accountRoute = accounts[`${req.method} ${url.pathname}`];
      if (accountRoute) {
        out = await accountRoute({ req, body, query: url.searchParams, ip });
      } else {
        // The user's own Dawnshift API: team, tasks, files, everything.
        const s = session(req);
        const app = users.load(s.user.id);
        out = await app.api(req.method, req.url, body);
      }
      // Only an explicit { status: <number>, body } reply sets the HTTP status.
      // Ordinary answers can have their own "status" field (tasks do: "done",
      // "running"...), which must not be mistaken for one.
      const custom = out && typeof out.status === 'number' && 'body' in out;
      const status = custom ? out.status : 200;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify(custom ? out.body : out));
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the server.' : err.message }));
    }
    return true;
  };
}

// ---------- static files (so a single process serves the site too) ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function serveStatic(root, req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(404).end();
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    // Single-page fallback: unknown paths get index.html so client routing works.
    try {
      const html = await fsp.readFile(path.join(root, 'index.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(html);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}

// ---------- start ----------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT || 3790);
  const HOST = process.env.HOST || '127.0.0.1';
  const DATA_DIR = path.resolve(process.env.DATA_DIR || './sync-data');
  const STATIC_DIR = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR);
  const store = await openDb(DATA_DIR);
  const users = createUsers(store);
  await users.loadAll();
  setOwnPort(PORT);
  const handle = createHandler(store, users);
  const server = http.createServer(async (req, res) => {
    if (await handle(req, res)) return;
    if (STATIC_DIR && req.method === 'GET') return serveStatic(STATIC_DIR, req, res);
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found."}');
  });
  server.listen(PORT, HOST, () => console.log(`Dawnshift on http://${HOST}:${PORT} (data in ${DATA_DIR})`));
  const stop = () => {
    users.stopAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
