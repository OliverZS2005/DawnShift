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
