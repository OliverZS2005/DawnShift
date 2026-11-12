import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';
import { createApi } from '../src/api.js';
import { allowedSecrets, fillSecrets, TOOLS_BY_NAME } from '../src/tools.js';

function setup() {
  const store = createStore('/nonexistent', { persist: false });
  const runner = createRunner({ store, callModel: async () => ({ text: 'ok', toolCalls: [] }) });
  return { store, api: createApi(store, runner) };
}

test("bots that never picked app keys keep using all of them", () => {
  const secrets = { A: '1', B: '2' };
  assert.deepEqual(allowedSecrets({}, secrets), secrets);
  assert.deepEqual(allowedSecrets({ appKeys: ['B'] }, secrets), { B: '2' });
  assert.deepEqual(allowedSecrets({ appKeys: [] }, secrets), {});
});

test('picking app keys for a bot is saved, and editing other things keeps it', async () => {
  const { store, api } = setup();
  await api('POST', '/api/secrets', { name: 'DISCORD_WEBHOOK', value: 'https://example.com/hook' });
  await api('POST', '/api/secrets', { name: 'SHOP_KEY', value: 'shop-secret' });
  const bot = await api('POST', '/api/bots', { name: 'Poster', job: 'Posts things', abilities: ['http_request'] });
  assert.equal(bot.appKeys, undefined, 'a new bot without a choice keeps the old behavior');

  await api('PUT', `/api/bots/${bot.id}`, { appKeys: ['DISCORD_WEBHOOK', 'bad name!'] });
  assert.deepEqual(store.bot(bot.id).appKeys, ['DISCORD_WEBHOOK'], 'invalid names are dropped');

  await api('PUT', `/api/bots/${bot.id}`, { job: 'Posts updates' });
  assert.deepEqual(store.bot(bot.id).appKeys, ['DISCORD_WEBHOOK'], "an edit that doesn't mention app keys leaves them alone");
  assert.equal(Object.keys(store.state.secrets).length, 2, 'no keys were deleted');
});

test("a bot can't use an app key it wasn't given", async () => {
  const { store } = setup();
  store.state.secrets = { DISCORD_WEBHOOK: 'https://example.com/hook', SHOP_KEY: 'shop-secret' };
  const bot = { abilities: ['http_request'], appKeys: ['DISCORD_WEBHOOK'] };
  assert.throws(() => fillSecrets('Bearer {{SHOP_KEY}}', allowedSecrets(bot, store.state.secrets)), /isn't|not|available to this bot/);
  await assert.rejects(
    TOOLS_BY_NAME.http_request.run({ method: 'GET', url: 'https://example.com/?k={{SHOP_KEY}}' }, { store, bot }),
    /available to this bot/,
  );
});
