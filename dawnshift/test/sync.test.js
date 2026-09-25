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
  const handle = createHandler(await openDb(dir));
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
    return { status: res.status, body: await res.json() };
  };
  return { call, dir, close: () => server.close() };
}

const account = (name, auth = 'YXV0aA==') => ({
  username: name, auth, salt: 'c2FsdA==', wrappedKey: 'a2V5',
  recoverySalt: 'cnNhbHQ=', recoveryAuth: 'cmF1dGg=', recoveryWrappedKey: 'cmtleQ==',
});

test('sign up, log in, and wrong passwords', async () => {
  const s = await startServer();
  try {
    assert.equal((await s.call('POST', '/api/account/register', account('Oliver'))).status, 200);
    assert.equal((await s.call('POST', '/api/account/register', account('oliver'))).status, 409, 'usernames are case-insensitive');
    assert.equal((await s.call('POST', '/api/account/register', account('x'))).status, 400);

    const pre = await s.call('GET', '/api/account/prelogin?username=oliver');
    assert.equal(pre.body.salt, 'c2FsdA==');
    const ghost1 = await s.call('GET', '/api/account/prelogin?username=nobody');
    const ghost2 = await s.call('GET', '/api/account/prelogin?username=nobody');
    assert.equal(ghost1.body.salt, ghost2.body.salt, "unknown names get a steady made-up salt, so they can't be told apart");

    const ok = await s.call('POST', '/api/account/login', { username: 'oliver', auth: 'YXV0aA==' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.wrappedKey, 'a2V5');
    assert.equal((await s.call('POST', '/api/account/login', { username: 'oliver', auth: 'd3Jvbmc=' })).status, 401);
    assert.equal((await s.call('GET', '/api/sync', null, 'not-a-token')).status, 401);

    const stored = fs.readFileSync(path.join(s.dir, 'accounts.json'), 'utf8');
    assert.ok(!stored.includes('YXV0aA=='), 'the login proof is only stored hashed');
  } finally {
    s.close();
  }
});

test('too many wrong passwords are slowed down', async () => {
  const s = await startServer();
  try {
    await s.call('POST', '/api/account/register', account('target'));
    for (let i = 0; i < 10; i++) await s.call('POST', '/api/account/login', { username: 'target', auth: 'd3Jvbmc=' });
    const res = await s.call('POST', '/api/account/login', { username: 'target', auth: 'YXV0aA==' });
    assert.equal(res.status, 429);
  } finally {
    s.close();
  }
});

test("devices can't overwrite each other's saves", async () => {
  const s = await startServer();
  try {
    const { body } = await s.call('POST', '/api/account/register', account('sam'));
    const t = body.token;
    assert.deepEqual((await s.call('GET', '/api/sync', null, t)).body.version, 0);
    assert.equal((await s.call('PUT', '/api/sync', { baseVersion: 0, blob: 'djE=' }, t)).body.version, 1);
    const stale = await s.call('PUT', '/api/sync', { baseVersion: 0, blob: 'djI=' }, t);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.blob, 'djE=', 'the conflict answer includes the newer data to merge with');
    assert.equal((await s.call('PUT', '/api/sync', { baseVersion: 1, blob: 'djI=' }, t)).body.version, 2);
  } finally {
    s.close();
  }
});

test('recovery login, password change and account deletion', async () => {
  const s = await startServer();
  try {
    const first = (await s.call('POST', '/api/account/register', account('kim'))).body.token;
    const rec = await s.call('POST', '/api/account/login-recovery', { username: 'kim', recoveryAuth: 'cmF1dGg=' });
    assert.equal(rec.body.recoveryWrappedKey, 'cmtleQ==');
    const changed = await s.call('POST', '/api/account/password', { salt: 'bmV3', auth: 'bmV3YXV0aA==', wrappedKey: 'bmV3a2V5' }, rec.body.token);
    assert.equal(changed.status, 200, 'a recovery login can set a new password without the old one');
    assert.equal((await s.call('GET', '/api/sync', null, first)).status, 401, 'other devices are logged out');
    assert.equal((await s.call('POST', '/api/account/login', { username: 'kim', auth: 'YXV0aA==' })).status, 401);
    const fresh = await s.call('POST', '/api/account/login', { username: 'kim', auth: 'bmV3YXV0aA==' });
    assert.equal(fresh.status, 200);

    const noPw = await s.call('POST', '/api/account/password', { salt: 'eA==', auth: 'eA==', wrappedKey: 'eA==' }, fresh.body.token);
    assert.equal(noPw.status, 401, 'a normal login needs the current password to change it');

    await s.call('PUT', '/api/sync', { baseVersion: 0, blob: 'ZGF0YQ==' }, fresh.body.token);
    assert.equal((await s.call('POST', '/api/account/delete', { auth: 'bmV3YXV0aA==' }, fresh.body.token)).status, 200);
    assert.equal((await s.call('POST', '/api/account/login', { username: 'kim', auth: 'bmV3YXV0aA==' })).status, 401);
    assert.equal(fs.readdirSync(path.join(s.dir, 'blobs')).length, 0, 'the synced data is gone too');
  } finally {
    s.close();
  }
});
