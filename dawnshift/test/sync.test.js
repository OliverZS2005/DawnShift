import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  deriveKeys, newDataKey, wrapKey, unwrapRaw, importDataKey, encryptJson, decryptJson,
  newRecoveryCode, normalizeRecoveryCode, toB64, randomBytes,
} from '../src/sync-crypto.js';
import { mergeData, sameData } from '../src/sync-merge.js';
import { openDb, createHandler } from '../sync-server/server.js';
import { createStore } from '../src/store.js';
import { createSync } from '../src/sync.js';

// ---------- encryption ----------

test('data encrypted with the password can only be read with the password', async () => {
  const salt = toB64(randomBytes(16));
  const right = await deriveKeys('correct horse battery', salt, 1000);
  const wrong = await deriveKeys('wrong password', salt, 1000);
  assert.notEqual(right.auth, wrong.auth);

  const { raw, key } = await newDataKey();
  const wrapped = await wrapKey(right.key, raw);
  const unwrapped = await importDataKey(await unwrapRaw(right.key, wrapped));
  await assert.rejects(unwrapRaw(wrong.key, wrapped), /doesn't match/);

  const secret = { connections: [{ apiKey: 'sk-ant-secret' }], note: 'æøå ✓' };
  const blob = await encryptJson(key, secret);
  assert.ok(!blob.includes('sk-ant-secret'));
  assert.deepEqual(await decryptJson(unwrapped, blob), secret);
});

test('the same password and salt always give the same login proof', async () => {
  const salt = toB64(randomBytes(16));
  assert.equal((await deriveKeys('pw', salt, 1000)).auth, (await deriveKeys('pw', salt, 1000)).auth);
});

test('recovery codes are easy to type back in', () => {
  const code = newRecoveryCode();
  assert.match(code, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  assert.equal(normalizeRecoveryCode(code.toLowerCase().replaceAll('-', ' ')), code.replaceAll('-', ''));
});

// ---------- merging ----------

const at = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

test('changes from two devices are combined, newest wins', () => {
  const phone = {
    bots: [{ id: 'b1', name: 'Writer (phone edit)', updatedAt: at(20) }, { id: 'b2', name: 'Phone-only bot', updatedAt: at(5) }],
    tasks: [], connections: [], board: [], secrets: { A: '1' }, deleted: {}, files: [],
  };
  const laptop = {
    bots: [{ id: 'b1', name: 'Writer (laptop edit)', updatedAt: at(10) }, { id: 'b3', name: 'Laptop-only bot', updatedAt: at(5) }],
    tasks: [], connections: [], board: [], secrets: { B: '2' }, deleted: {}, files: [],
  };
  const merged = mergeData(phone, laptop);
  assert.deepEqual(merged.bots.map((b) => b.name), ['Writer (phone edit)', 'Phone-only bot', 'Laptop-only bot']);
  assert.deepEqual(merged.secrets, { A: '1', B: '2' });
  assert.ok(sameData(mergeData(laptop, phone), merged), 'merging is the same either way round');
});

test("deleting on one device isn't undone by the other device's old copy", () => {
  const phone = { bots: [], tasks: [], connections: [], board: [], secrets: {}, deleted: { b1: Date.now(), 'secret:A': Date.now() }, files: [] };
  const laptop = { bots: [{ id: 'b1', updatedAt: at(1) }], tasks: [], connections: [], board: [], secrets: { A: '1' }, deleted: {}, files: [] };
  const merged = mergeData(laptop, phone);
  assert.equal(merged.bots.length, 0);
  assert.deepEqual(merged.secrets, {});
});

test('a task this device is running keeps its local copy', () => {
  const local = { tasks: [{ id: 't1', status: 'running', updatedAt: at(1) }], bots: [], connections: [], board: [], secrets: {}, deleted: {}, files: [] };
  const remote = { tasks: [{ id: 't1', status: 'cancelled', updatedAt: at(9) }], bots: [], connections: [], board: [], secrets: {}, deleted: {}, files: [] };
  assert.equal(mergeData(local, remote, { preferLocal: (id) => id === 't1' }).tasks[0].status, 'running');
  assert.equal(mergeData(local, remote).tasks[0].status, 'cancelled');
});

test('sameData ignores the order of items', () => {
  const a = { bots: [{ id: '1', x: 1 }, { id: '2', y: 2 }], tasks: [], connections: [], board: [], secrets: {}, deleted: {}, files: [] };
  const b = { ...a, bots: [{ y: 2, id: '2' }, { x: 1, id: '1' }] };
  assert.ok(sameData(a, b));
  assert.ok(!sameData(a, { ...a, bots: [{ id: '1', x: 2 }, { id: '2', y: 2 }] }));
});

// ---------- the sync server ----------

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnshift-sync-'));
  const store = await openDb(dir);
  const users = (await import('../sync-server/server.js')).createUsers(store);
  const handle = createHandler(store, users);
  const server = http.createServer(async (req, res) => {
    if (!(await handle(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { call, base, dir, close: () => (users.stopAll(), server.close()) };
}

test('the Android app may call the API, other websites may not', async () => {
  const s = await startServer();
  try {
    const preflight = (origin) => fetch(`${s.base}/api/account/login`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
    });
    const app = await preflight('https://localhost');
    assert.equal(app.status, 204);
    assert.equal(app.headers.get('access-control-allow-origin'), 'https://localhost');
    assert.match(app.headers.get('access-control-allow-headers'), /authorization/);
    const other = await preflight('https://evil.example');
    assert.equal(other.headers.get('access-control-allow-origin'), null);

    const health = await fetch(`${s.base}/api/health`, { headers: { origin: 'https://localhost' } });
    assert.equal(health.headers.get('access-control-allow-origin'), 'https://localhost');
    const plain = await fetch(`${s.base}/api/health`);
    assert.equal(plain.headers.get('access-control-allow-origin'), null);
  } finally {
    s.close();
  }
});

const signup = (name, password = 'a long enough password') => ({ username: name, password });

test('sign up, log in, and wrong passwords', async () => {
  const s = await startServer();
  try {
    const first = await s.call('POST', '/api/account/signup', signup('Oliver'));
    assert.equal(first.status, 200);
    assert.ok(first.body.token);
    assert.match(first.body.recoveryCode, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/);
    assert.equal((await s.call('POST', '/api/account/signup', signup('oliver'))).status, 409, 'usernames are case-insensitive');
    assert.equal((await s.call('POST', '/api/account/signup', signup('x'))).status, 400, 'short usernames rejected');
    assert.equal((await s.call('POST', '/api/account/signup', { username: 'short', password: 'short' })).status, 400, 'short passwords rejected');

    const ok = await s.call('POST', '/api/account/login', { username: 'oliver', password: 'a long enough password' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    assert.equal((await s.call('POST', '/api/account/login', { username: 'oliver', password: 'nope' })).status, 401);
    assert.equal((await s.call('GET', '/api/state', null, 'not-a-token')).status, 401);
    assert.equal((await s.call('GET', '/api/state', null, ok.body.token)).status, 200);

    const stored = fs.readFileSync(path.join(s.dir, 'accounts.json'), 'utf8');
    assert.ok(!stored.includes('a long enough password'), 'the password is only stored hashed');
  } finally {
    s.close();
  }
});

test('too many wrong passwords are slowed down', async () => {
  const s = await startServer();
  try {
    await s.call('POST', '/api/account/signup', signup('target'));
    for (let i = 0; i < 10; i++) await s.call('POST', '/api/account/login', { username: 'target', password: 'nope' });
    const res = await s.call('POST', '/api/account/login', { username: 'target', password: 'a long enough password' });
    assert.equal(res.status, 429);
  } finally {
    s.close();
  }
});

test("each user's team is private to them", async () => {
  const s = await startServer();
  try {
    const a = (await s.call('POST', '/api/account/signup', signup('alice'))).body.token;
    const b = (await s.call('POST', '/api/account/signup', signup('bob'))).body.token;
    const conn = await s.call('POST', '/api/connections', { preset: 'groq', name: 'A keys', apiKey: 'gsk_secret', model: 'llama-3.3-70b-versatile' }, a);
    assert.equal(conn.status, 200);
    assert.equal((await s.call('GET', '/api/state', null, a)).body.connections.length, 1);
    assert.equal((await s.call('GET', '/api/state', null, b)).body.connections.length, 0, "bob can't see alice's connection");
  } finally {
    s.close();
  }
});

test('recovery login, password change and account deletion', async () => {
  const s = await startServer();
  try {
    const { body: { token: first, recoveryCode } } = await s.call('POST', '/api/account/signup', signup('kim'));

    const recovered = await s.call('POST', '/api/account/recover', { username: 'kim', recoveryCode, newPassword: 'another long password' });
    assert.equal(recovered.status, 200, 'recovery code sets a new password');
    assert.equal((await s.call('GET', '/api/state', null, first)).status, 401, 'other sessions are logged out');
    assert.equal((await s.call('POST', '/api/account/login', { username: 'kim', password: 'a long enough password' })).status, 401, "old password doesn't work");
    assert.equal((await s.call('POST', '/api/account/login', { username: 'kim', password: 'another long password' })).status, 200);

    const session = recovered.body.token;
    const changed = await s.call('POST', '/api/account/password', { currentPassword: 'another long password', newPassword: 'third password here' }, session);
    assert.equal(changed.status, 200);
    const stale = await s.call('POST', '/api/account/password', { currentPassword: 'nope', newPassword: 'whatever' }, session);
    assert.equal(stale.status, 401, 'need the real current password');

    const fresh = (await s.call('POST', '/api/account/login', { username: 'kim', password: 'third password here' })).body.token;
    await s.call('POST', '/api/connections', { preset: 'groq', name: 'Keys', apiKey: 'gsk_xyz', model: 'llama-3.3-70b-versatile' }, fresh);

    assert.equal((await s.call('POST', '/api/account/delete', { password: 'third password here' }, fresh)).status, 200);
    assert.equal((await s.call('POST', '/api/account/login', { username: 'kim', password: 'third password here' })).status, 401);
    assert.equal(fs.existsSync(path.join(s.dir, 'users', (await openDb(s.dir)).db.users.kim?.id ?? 'none')), false, "deleting removes the user's data");
  } finally {
    s.close();
  }
});


test('opening a task works (its status field is not an HTTP status)', async () => {
  const s = await startServer();
  try {
    const t = (await s.call('POST', '/api/account/signup', signup('tasker'))).body.token;
    const bot = (await s.call('POST', '/api/bots', { name: 'Helper', job: 'Helps' }, t)).body;
    const task = await s.call('POST', '/api/tasks', { botId: bot.id, instructions: 'Say hi' }, t);
    assert.equal(task.status, 200);
    const full = await s.call('GET', `/api/tasks/${task.body.id}`, null, t);
    assert.equal(full.status, 200);
    assert.equal(typeof full.body.status, 'string');
  } finally {
    s.close();
  }
});
