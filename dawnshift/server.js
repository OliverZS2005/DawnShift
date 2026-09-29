// Dawnshift: a team of AI coworkers that runs on your own computer.
// Start it with `npm start`, then open http://localhost:3777
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.js';
import { createRunner } from './src/runner.js';
import { createApi, HttpError } from './src/api.js';
import { callModel } from './src/providers.js';
import { setOwnPort } from './src/tools.js';
import { createSync } from './src/sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3777);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DAWNSHIFT_DATA || path.join(here, 'data'));
const PUBLIC_DIR = path.join(here, 'public');
// Where accounts live. "off" turns accounts off.
const SYNC_SERVER = (process.env.DAWNSHIFT_SYNC_SERVER || 'https://dawnshift.dawnlife.online').replace(/\/+$/, '');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const full = path.resolve(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');
  const data = await fs.readFile(full).catch(() => {
    throw new HttpError(404, 'Not found.');
  });
  res.writeHead(200, { 'content-type': TYPES[path.extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}

// ---------- server ----------

// Blocks other websites open in your browser from using Dawnshift's API.
function isTrustedRequest(req, listenHost) {
  const host = req.headers.host ?? '';
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return false;
  // Guards against DNS rebinding while Dawnshift is only listening locally.
  if (['127.0.0.1', 'localhost', '::1'].includes(listenHost) && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  return true;
}

// ---------- accounts ----------

// On a computer the data lives in this server, so syncing runs here too
// (src/sync.js) and the interface uses it through these requests.
const ACCOUNT_ACTIONS = new Set(['signup', 'login', 'recover', 'changePassword', 'logout', 'deleteAccount', 'checkAvailable', 'syncNow']);

async function handleAccount(sync, method, pathname, body) {
  if (method === 'GET' && pathname === '/api/account') return sync ? sync.getStatus() : { available: false, loggedIn: false, checked: true, off: true };
  if (!sync) throw new HttpError(404, 'Accounts are turned off.');
  const action = pathname.slice('/api/account/'.length);
  if (method !== 'POST' || !ACCOUNT_ACTIONS.has(action)) throw new HttpError(404, 'Not found.');
  try {
    const result = await sync[action](...(Array.isArray(body.args) ? body.args : []));
    return { result: result ?? null, status: sync.getStatus() };
  } catch (err) {
    // Wrong passwords and the like come back from the account server.
    throw new HttpError(err.status && err.status < 500 ? err.status : err.offline ? 503 : 502, err.message);
  }
}

export function createServer(store, runner, { host = HOST, sync = null } = {}) {
  const handle = createApi(store, runner);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        return await serveStatic(res, url.pathname);
      }
      if (!isTrustedRequest(req, host)) throw new HttpError(403, 'Request blocked.');
      const raw = req.method === 'GET' ? '' : await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')
        ? await handleAccount(sync, req.method, url.pathname, body)
        : await handle(req.method, req.url, body);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (err) {
      // Errors with a cause came from an AI provider and already read well.
      const status = err.status ?? (err instanceof SyntaxError ? 400 : err.cause ? 502 : 500);
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// Starts Dawnshift: its saved data, the bots, and the server for the
// interface. Port 0 picks any free port. Used by the command line below and
// by the desktop app (desktop/main.js).
export async function startDawnshift({ dataDir = DATA_DIR, port = PORT, host = HOST, syncServer = SYNC_SERVER } = {}) {
  const store = createStore(dataDir);
  const runner = createRunner({ store, callModel });
  const sync = syncServer === 'off' ? null : createSync({ store, runner, server: syncServer });
  const server = createServer(store, runner, { host, sync });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  setOwnPort(actualPort);
  runner.start();
  // Checks the account server in the background, so starting never waits on it.
  sync?.start().catch((err) => console.error('Accounts:', err.message));
  return {
    url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${actualPort}`,
    dataDir,
    // Saves anything not yet written to disk.
    stop: () => store.flush(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
  // The double-click launchers pass --open so the app appears by itself.
  const open = process.argv.includes('--open') ? () => openBrowser(url) : () => {};
  try {
    const app = await startDawnshift();
    console.log(`Dawnshift is running: ${app.url}`);
    console.log(`Data is saved in ${app.dataDir}`);
    console.log('Keep this window open while you use Dawnshift. Close it (or press Ctrl+C) to stop.');
    open();
    const stop = () => {
      app.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    console.log(`Dawnshift is already running (or port ${PORT} is busy). Opening ${url}`);
    open();
    setTimeout(() => process.exit(0), 1000);
  }
}
