import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { createApi } from '../src/api.js';
import { buildSystemPrompt } from '../src/runner.js';
import { CORE_RULES } from '../src/core-rules.js';

const makeStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'dawnshift-')), { persist: false });
const bot = (extra = {}) => ({ id: 'b1', name: 'Ops', job: 'Ops things', abilities: [], memory: [], routines: [], ...extra });

test('bots get the core rules in their system prompt by default, including old bots with no setting', () => {
  const store = makeStore();
  const b = bot();
  store.state.bots.push(b);
  const prompt = buildSystemPrompt(store, b);
  assert.ok(prompt.includes(CORE_RULES[0]));
  assert.ok(prompt.indexOf('Core rules') < prompt.indexOf('Your job:'));
});

test('a bot with core rules turned off does not get them', () => {
  const store = makeStore();
  const b = bot({ coreRules: false });
  store.state.bots.push(b);
  assert.ok(!buildSystemPrompt(store, b).includes(CORE_RULES[0]));
});

test('hiring keeps core rules on unless explicitly turned off, and edits keep the setting', async () => {
  const store = makeStore();
  const api = createApi(store, { cancel() {}, kick() {} });
  const call = api;
  const hired = await call('POST', '/api/bots', { name: 'A', job: 'x' });
  assert.equal(hired.coreRules, true);
  const off = await call('PUT', `/api/bots/${hired.id}`, { coreRules: false });
  assert.equal(off.coreRules, false);
  const renamed = await call('PUT', `/api/bots/${hired.id}`, { name: 'B' });
  assert.equal(renamed.coreRules, false);
});

test('network failures pass on the real reason instead of just "fetch failed"', async () => {
  const { TOOLS_BY_NAME } = await import('../src/tools.js');
  const tool = TOOLS_BY_NAME.web_fetch;
  const store = makeStore();
  const b = bot({ abilities: ['http_request', 'web_fetch'] });
  store.state.bots.push(b);
  const args = { url: 'http://does-not-exist.invalid/', method: 'GET' };
  let message = '';
  try {
    const out = await tool.run(args, { store, bot: b });
    message = out?.content ?? String(out);
  } catch (err) {
    message = err.message;
  }
  assert.ok(!/^fetch failed$/.test(message), message);
  assert.match(message, /ENOTFOUND|EAI_AGAIN|does-not-exist/);
});

test('Dawnshift flags a status report from a bot that checked nothing', async () => {
  const { evidenceNote } = await import('../src/runner.js');
  const task = { messages: [{ role: 'user', content: 'status?' }, { role: 'assistant', text: 'Proxmox nodes are healthy, no issues.', toolCalls: [] }] };
  assert.match(evidenceNote(task), /no successful web or API calls/);
});

test('Dawnshift lists the calls a bot made, and does not warn when one succeeded', async () => {
  const { evidenceNote } = await import('../src/runner.js');
  const task = { messages: [
    { role: 'user', content: 'status?' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'http_request', args: { url: '{{PROXMOX_BASE_URL}}/api2/json/nodes' } }, { id: 'b', name: 'web_fetch', args: { url: 'https://www.googleapis.com/youtube/v3/channels' } }] },
    { role: 'tool', callId: 'a', name: 'http_request', content: '{"data":[]}', isError: false },
    { role: 'tool', callId: 'b', name: 'web_fetch', content: 'Error: Couldn\'t reach www.googleapis.com', isError: true },
    { role: 'assistant', text: 'Proxmox is healthy. YouTube call failed.', toolCalls: [] },
  ] };
  const note = evidenceNote(task);
  assert.ok(!/no successful/.test(note));
  assert.match(note, /✓ PROXMOX_BASE_URL/);
  assert.match(note, /✗ www\.googleapis\.com/);
});

test('plain replies with no status claims and no calls get no note', async () => {
  const { evidenceNote } = await import('../src/runner.js');
  assert.equal(evidenceNote({ messages: [{ role: 'assistant', text: 'Here is your email draft.', toolCalls: [] }] }), '');
});
