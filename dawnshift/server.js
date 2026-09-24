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

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3777);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DAWNSHIFT_DATA || path.join(here, 'data'));
const PUBLIC_DIR = path.join(here, 'public');

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
function isTrustedRequest(req) {
  const host = req.headers.host ?? '';
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return false;
  // Guards against DNS rebinding while Dawnshift is only listening locally.
  if (['127.0.0.1', 'localhost', '::1'].includes(HOST) && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  return true;
}

export function createServer(store, runner) {
  const handle = createApi(store, runner);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        return await serveStatic(res, url.pathname);
      }
      if (!isTrustedRequest(req)) throw new HttpError(403, 'Request blocked.');
      const raw = req.method === 'GET' ? '' : await readBody(req);
      const result = await handle(req.method, req.url, raw ? JSON.parse(raw) : {});
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setOwnPort(PORT);
  const store = createStore(DATA_DIR);
  const runner = createRunner({ store, callModel });
  runner.start();
  const server = createServer(store, runner);
  const url = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
  // The double-click launchers pass --open so the app appears by itself.
  const open = process.argv.includes('--open') ? () => openBrowser(url) : () => {};
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.log(`Dawnshift is already running (or port ${PORT} is busy). Opening ${url}`);
    open();
    setTimeout(() => process.exit(0), 1000);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Dawnshift is running: ${url}`);
    console.log(`Data is saved in ${DATA_DIR}`);
    console.log('Keep this window open while you use Dawnshift. Close it (or press Ctrl+C) to stop.');
    open();
  });
  const stop = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
