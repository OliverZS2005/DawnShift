import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';

// A pretend AI: each bot gets a script of replies, played in order.
function setup(scripts, botOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnshift-'));
  const store = createStore(dir, { persist: false });
  store.state.connections.push({ id: 'c1', name: 'Fake', kind: 'openai', model: 'fake' });
  const bot = (id, name, extra = {}) => ({ id, name, job: `${name} things`, connectionId: 'c1', abilities: [], approvals: 'risky', memory: [], routines: [], ...extra });
  store.state.bots.push(bot('b1', 'Boss', { abilities: ['delegate_task', 'write_file'], ...botOverrides }), bot('b2', 'Helper'));
  const seen = [];
  const callModel = async (conn, req) => {
    const botName = req.system.match(/You are (\w+)/)[1];
    seen.push({ botName, req: { system: req.system, messages: structuredClone(req.messages), tools: req.tools.map((t) => t.name) } });
    const next = scripts[botName].shift();
    assert.ok(next, `no scripted reply left for ${botName}`);
    return { text: next.text ?? '', toolCalls: next.toolCalls ?? [], usage: { input: 1, output: 1 } };
  };
  const runner = createRunner({ store, callModel });
  return { store, runner, seen };
}

const call = (id, name, args) => ({ id, name, args });
const settled = (store, id, statuses = ['done', 'failed', 'needs_you', 'cancelled']) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const t = store.task(id);
      if (statuses.includes(t.status)) return resolve(t);
      if (Date.now() - start > 2000) return reject(new Error(`task stuck in ${t.status}`));
      setTimeout(check, 5);
    };
    check();
  });

test('a simple task runs a tool and finishes with the final reply', async () => {
  const { store, runner } = setup({
    Boss: [{ toolCalls: [call('t1', 'remember', { note: 'Likes short emails' })] }, { text: 'All done.' }],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Remember my style' });
  const done = await settled(store, task.id);
  assert.equal(done.status, 'done');
  assert.equal(done.result, 'All done.');
  assert.deepEqual(store.bot('b1').memory, ['Likes short emails']);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
});

test('risky actions wait for approval, and a "no" is reported back to the bot', async () => {
  const { store, runner, seen } = setup({
    Boss: [
      { toolCalls: [call('t1', 'write_file', { path: 'a.txt', content: 'hi' })] },
      { text: 'Okay, I did not write it.' },
    ],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Write a file' });
  let t = await settled(store, task.id);
  assert.equal(t.status, 'needs_you');
  assert.equal(t.pending.kind, 'approval');
  assert.match(t.pending.summary, /a\.txt/);

  runner.decide(task.id, false, 'not now');
  t = await settled(store, task.id);
  assert.equal(t.status, 'done');
  const result = seen.at(-1).req.messages.at(-1);
  assert.equal(result.role, 'tool');
  assert.equal(result.isError, true);
  assert.match(result.content, /not now/);
});

test('approved actions run', async () => {
  const { store, runner } = setup({
    Boss: [{ toolCalls: [call('t1', 'write_file', { path: 'notes/a.txt', content: 'hi' })] }, { text: 'Written.' }],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Write a file' });
  await settled(store, task.id);
  runner.decide(task.id, true);
  const t = await settled(store, task.id);
  assert.equal(t.status, 'done');
  assert.equal(await store.files.read('notes/a.txt'), 'hi');
});

test('ask_human pauses until the human answers', async () => {
  const { store, runner, seen } = setup({
    Boss: [{ toolCalls: [call('t1', 'ask_human', { question: 'Which city?' })] }, { text: 'Booked Paris.' }],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Book a trip' });
  let t = await settled(store, task.id);
  assert.equal(t.pending.question, 'Which city?');
  runner.answer(task.id, 'Paris');
  t = await settled(store, task.id);
  assert.equal(t.result, 'Booked Paris.');
  assert.match(seen.at(-1).req.messages.at(-1).content, /Paris/);
});

test('a lead can hand work to a coworker and gets their result back', async () => {
  const { store, runner, seen } = setup({
    Boss: [
      { toolCalls: [call('t1', 'delegate_task', { coworker: 'helper', title: 'Find prices', instructions: 'Find 3 prices' })] },
      { text: 'Helper found: $1, $2, $3.' },
    ],
    Helper: [{ text: '$1, $2, $3' }],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Research prices' });
  const t = await settled(store, task.id);
  assert.equal(t.status, 'done');
  const sub = store.state.tasks.find((x) => x.parentId === task.id);
  assert.equal(sub.botId, 'b2');
  assert.equal(sub.status, 'done');
  assert.match(sub.messages[0].content, /Task from Boss/);
  const handedBack = seen.at(-1).req.messages.at(-1);
  assert.match(handedBack.content, /\$1, \$2, \$3/);
});

test('only bots with the ability can delegate', async () => {
  const { store, runner } = setup(
    { Boss: [{ toolCalls: [call('t1', 'delegate_task', { coworker: 'Helper', title: 'a', instructions: 'b' })] }, { text: 'ok' }] },
    { abilities: [] },
  );
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'y' });
  const t = await settled(store, task.id);
  const result = t.messages.find((m) => m.role === 'tool');
  assert.equal(result.isError, true);
  assert.equal(store.state.tasks.length, 1);
});

test('a follow-up reply continues a finished task', async () => {
  const { store, runner } = setup({ Boss: [{ text: 'Draft 1' }, { text: 'Draft 2' }] });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Write' });
  await settled(store, task.id);
  runner.reply(task.id, 'Shorter please');
  await new Promise((r) => setTimeout(r, 20));
  const t = await settled(store, task.id);
  assert.equal(t.result, 'Draft 2');
});

test('replying after a stopped task closes tool calls that never ran', async () => {
  const { store, runner, seen } = setup({
    Boss: [{ toolCalls: [call('t1', 'write_file', { path: 'a', content: 'b' })] }, { text: 'Fine.' }],
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Write' });
  await settled(store, task.id);
  runner.cancel(task.id);
  assert.equal(store.task(task.id).status, 'cancelled');
  runner.reply(task.id, 'Never mind, just say fine');
  await settled(store, task.id, ['done']);
  const roles = seen.at(-1).req.messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'user']);
});

test('provider errors fail the task with a readable message', async () => {
  const { store } = setup({});
  const runner = createRunner({
    store,
    callModel: async () => {
      throw new Error('Fake: the API key was rejected.');
    },
  });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'y' });
  const t = await settled(store, task.id);
  assert.equal(t.status, 'failed');
  assert.match(t.error, /API key/);
});

test('routines create a task when due, and not twice while one is running', async () => {
  const { store, runner } = setup({ Boss: [{ toolCalls: [call('t1', 'ask_human', { question: '?' })] }] });
  store.bot('b1').routines = [{ id: 'r1', title: 'Daily report', instructions: 'Report', everyMinutes: 60, nextRunAt: new Date(0).toISOString() }];
  runner.runDueRoutines();
  assert.equal(store.state.tasks.length, 1);
  await settled(store, store.state.tasks[0].id);
  runner.runDueRoutines(Date.now() + 2 * 3600000);
  assert.equal(store.state.tasks.length, 1);
});

test('a bot stuck repeating the same read is told to stop', async () => {
  const again = (n) => ({ toolCalls: [call(`t${n}`, 'list_team', {})] });
  const { store, runner } = setup({ Boss: [again(1), again(2), again(3), again(4), { text: 'Done.' }] });
  const task = runner.createTask({ botId: 'b1', title: 'x', instructions: 'Loop' });
  const done = await settled(store, task.id);
  assert.equal(done.status, 'done');
  const results = done.messages.filter((m) => m.role === 'tool').flatMap((m) => m.results ?? [m]).map((r) => JSON.stringify(r));
  assert.ok(results.some((r) => r.includes("Don't run it again")), 'the repeat was stopped');
});
