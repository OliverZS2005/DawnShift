// Dawnshift sync server: accounts and encrypted storage for the web version.
//
// It never sees anyone's password or data. Devices send a login proof derived
// from the password (which is hashed again here with scrypt) and data that's
// already encrypted with a key only the user's devices have.
//
// Run: node server.js   (PORT, HOST, DATA_DIR and STATIC_DIR are optional)
// Only built-in Node modules, so there's nothing to install.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(crypto.scrypt);

const MAX_BLOB = 8 * 1024 * 1024;
const MAX_JSON = 32 * 1024;
const SESSION_DAYS = 60;
const LOGIN_LIMIT = { tries: 10, windowMs: 15 * 60 * 1000 };
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

// ---------- storage: one JSON file for accounts, one file per user's data ----------

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

export async function openDb(dir) {
  await fsp.mkdir(path.join(dir, 'blobs'), { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'accounts.json');
  let db = { secret: crypto.randomBytes(32).toString('base64'), users: {}, sessions: {} };
  if (fs.existsSync(file)) db = JSON.parse(await fsp.readFile(file, 'utf8'));
  else await writeAtomic(file, JSON.stringify(db));

  // Writes happen one at a time, in order.
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  const blobFile = (id) => path.join(dir, 'blobs', `${id}.json`);

  return {
    db,
    save: () => serial(() => writeAtomic(file, JSON.stringify(db))),
    async readBlob(id) {
      try {
        return JSON.parse(await fsp.readFile(blobFile(id), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return { version: 0, blob: null, updatedAt: null };
        throw err;
      }
    },
    writeBlob: (id, value) => serial(() => writeAtomic(blobFile(id), JSON.stringify(value))),
    deleteBlob: (id) => serial(() => fsp.rm(blobFile(id), { force: true })),
  };
}

// ---------- helpers ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64');

async function hashAuth(auth, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = (await scrypt(auth, salt, 32)).toString('base64');
  return { hash, salt };
}

async function checkAuth(auth, hash, salt) {
  const got = (await scrypt(String(auth), salt, 32));
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function str(v, name, { max = 2000, pattern = B64 } = {}) {
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
        reject(new HttpError(413, 'Your data is too large to sync (the limit is 8 MB).'));
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

// ---------- the API ----------

export function createHandler(store) {
  const { db } = store;
  const limiter = createLimiter();

  // One sync save per account at a time, so two devices can't both "win".
  const locks = new Map();
  function withLock(id, fn) {
    const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
    locks.set(id, run.catch(() => {}));
    return run;
  }

  // Unknown usernames get made-up salts that stay the same, so the login
  // screen doesn't reveal which usernames exist.
  const fakeSalt = (username, kind) =>
    crypto.createHmac('sha256', db.secret).update(`${kind}:${username}`).digest().subarray(0, 16).toString('base64');

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

  const username = (v) => {
    const u = String(v ?? '').trim().toLowerCase();
    if (!USERNAME.test(u)) fail(400, 'Usernames are 3 to 32 characters: letters, numbers, dots, dashes and underscores.');
    return u;
  };

  const routes = {
    'GET /api/health': () => ({ ok: true, service: 'dawnshift-sync' }),

    'GET /api/account/prelogin': ({ query }) => {
      const u = username(query.get('username'));
      const user = db.users[u];
      return { salt: user?.salt ?? fakeSalt(u, 'salt'), recoverySalt: user?.recoverySalt ?? fakeSalt(u, 'recovery') };
    },

    'POST /api/account/register': async ({ body }) => {
      const u = username(body.username);
      if (db.users[u]) fail(409, 'That username is taken. Try another one.');
      const auth = await hashAuth(str(body.auth, 'login key'));
      const recovery = await hashAuth(str(body.recoveryAuth, 'recovery key'));
      // Checked again: someone else may have taken it while we were hashing.
      if (db.users[u]) fail(409, 'That username is taken. Try another one.');
      db.users[u] = {
        id: crypto.randomUUID(),
        salt: str(body.salt, 'salt', { max: 64 }),
        authHash: auth.hash,
        authSalt: auth.salt,
        wrappedKey: str(body.wrappedKey, 'key'),
        recoverySalt: str(body.recoverySalt, 'salt', { max: 64 }),
        recoveryHash: recovery.hash,
        recoveryHashSalt: recovery.salt,
        recoveryWrappedKey: str(body.recoveryWrappedKey, 'key'),
        createdAt: new Date().toISOString(),
      };
      const token = newSession(u);
      await store.save();
      return { token, username: u };
    },

    'POST /api/account/login': async ({ body, ip }) => {
      const u = username(body.username);
      limiter.check(`u:${u}`, `ip:${ip}`);
      const user = db.users[u];
      if (!user || !(await checkAuth(str(body.auth, 'login key'), user.authHash, user.authSalt))) {
        limiter.failed(`u:${u}`, `ip:${ip}`);
        fail(401, 'Wrong username or password.');
      }
      limiter.clear(`u:${u}`);
      cleanSessions();
      const token = newSession(u);
      await store.save();
      return { token, username: u, wrappedKey: user.wrappedKey };
    },

    // Logs in with the recovery code instead of the password. The session may
    // only be used to set a new password (and to sync).
    'POST /api/account/login-recovery': async ({ body, ip }) => {
      const u = username(body.username);
      limiter.check(`u:${u}`, `ip:${ip}`);
      const user = db.users[u];
      if (!user || !(await checkAuth(str(body.recoveryAuth, 'recovery key'), user.recoveryHash, user.recoveryHashSalt))) {
        limiter.failed(`u:${u}`, `ip:${ip}`);
        fail(401, 'Wrong username or recovery code.');
      }
      limiter.clear(`u:${u}`);
      const token = newSession(u, { recovery: true });
      await store.save();
      return { token, username: u, recoveryWrappedKey: user.recoveryWrappedKey };
    },

    'POST /api/account/password': async ({ req, body }) => {
      const s = session(req);
      const current = typeof body.currentAuth === 'string' ? body.currentAuth : '';
      if (!s.recovery && !(current && (await checkAuth(current, s.user.authHash, s.user.authSalt)))) {
        fail(401, 'Your current password is wrong.');
      }
      const auth = await hashAuth(str(body.auth, 'login key'));
      Object.assign(s.user, { salt: str(body.salt, 'salt', { max: 64 }), authHash: auth.hash, authSalt: auth.salt, wrappedKey: str(body.wrappedKey, 'key') });
      // A new password signs out every other device.
      for (const [k, other] of Object.entries(db.sessions)) if (other.username === s.username && k !== s.tokenHash) delete db.sessions[k];
      db.sessions[s.tokenHash].recovery = false;
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
      if (!(await checkAuth(str(body.auth, 'password'), s.user.authHash, s.user.authSalt))) fail(401, 'Wrong password.');
      await store.deleteBlob(s.user.id);
      delete db.users[s.username];
      for (const [k, other] of Object.entries(db.sessions)) if (other.username === s.username) delete db.sessions[k];
      await store.save();
      return { ok: true };
    },

    'GET /api/sync': async ({ req }) => store.readBlob(session(req).user.id),

    // Saves new data only if nobody else saved in between (baseVersion), so
    // devices never silently overwrite each other.
    'PUT /api/sync': async ({ req, body }) => {
      const s = session(req);
      const blob = str(body.blob, 'data', { max: MAX_BLOB });
      return withLock(s.user.id, async () => {
        const current = await store.readBlob(s.user.id);
        if (body.baseVersion !== current.version) return { status: 409, body: { error: 'conflict', ...current } };
        const next = { version: current.version + 1, blob, updatedAt: new Date().toISOString() };
        await store.writeBlob(s.user.id, next);
        return { version: next.version, updatedAt: next.updatedAt };
      });
    },
  };

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return false;
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
    try {
      const body = req.method === 'GET' ? {} : await readJson(req, url.pathname === '/api/sync' ? MAX_BLOB + 1024 : MAX_JSON);
      const out = await route({ req, body, query: url.searchParams, ip });
      const status = out?.status ?? 200;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out?.status ? out.body : out));
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the server.' : err.message }));
    }
    return true;
  };
}

// ---------- optional static files (for testing without Nginx) ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serveStatic(root, req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT || 3790);
  const HOST = process.env.HOST || '127.0.0.1';
  const DATA_DIR = path.resolve(process.env.DATA_DIR || './sync-data');
  const STATIC_DIR = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR);
  const handle = createHandler(await openDb(DATA_DIR));
  http
    .createServer(async (req, res) => {
      if (await handle(req, res)) return;
      if (STATIC_DIR && req.method === 'GET') return serveStatic(STATIC_DIR, req, res);
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found."}');
    })
    .listen(PORT, HOST, () => console.log(`Dawnshift sync server on http://${HOST}:${PORT} (data in ${DATA_DIR})`));
}
