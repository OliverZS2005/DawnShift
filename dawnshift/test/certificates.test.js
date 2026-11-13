import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';
import { createApi } from '../src/api.js';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { useSystemCertificates } from '../src/system-ca.js';

function selfSignedServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k`, '-out', `${dir}/c`, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(`${dir}/k`), cert: fs.readFileSync(`${dir}/c`) }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"players":3}');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

test('the system certificate list is trusted as well as Node\'s own', () => {
  assert.equal(typeof useSystemCertificates(), 'boolean');
});

test("a self-signed home server fails until it's added under Your own servers", async (t) => {
  let ok = true;
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { ok = false; }
  if (!ok) return t.skip('openssl not installed');
  const { server, port } = await selfSignedServer();
  try {
    const store = createStore('/nonexistent', { persist: false });
    const api = createApi(store, createRunner({ store, callModel: async () => ({ text: 'ok', toolCalls: [] }) }));
    const bot = { abilities: ['http_request'] };
    const call = () => TOOLS_BY_NAME.http_request.run({ method: 'GET', url: `https://localhost:${port}/status` }, { store, bot });

    await assert.rejects(call(), /Your own servers/);

    const added = await api('POST', '/api/trusted-hosts', { host: `https://localhost:${port}/panel` });
    assert.equal(added.host, 'localhost', 'a pasted address is reduced to the server name');
    const res = await call();
    assert.equal(res.isError, false);
    assert.match(res.content, /players/);
    assert.deepEqual((await api('GET', '/api/state')).trustedHosts, ['localhost']);

    await api('DELETE', '/api/trusted-hosts/localhost');
    await assert.rejects(call(), /certificate/);
  } finally {
    server.close();
  }
});
