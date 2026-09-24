import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { toAnthropicMessages, toOpenAIMessages } from '../src/providers.js';
import { resolveInWorkspace, fillSecrets, htmlToText } from '../src/tools.js';

const convo = [
  { role: 'user', content: 'Do it' },
  { role: 'assistant', text: 'On it.', toolCalls: [{ id: 'a', name: 'x', args: { q: 1 } }, { id: 'b', name: 'y', args: {} }] },
  { role: 'tool', callId: 'a', name: 'x', content: 'one' },
  { role: 'tool', callId: 'b', name: 'y', content: 'two', isError: true },
  { role: 'assistant', text: 'Done.', toolCalls: [] },
  { role: 'user', content: 'Thanks' },
];

test('Anthropic: tool results for one turn share a single user message', () => {
  const out = toAnthropicMessages(convo);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(out[1].content[1], { type: 'tool_use', id: 'a', name: 'x', input: { q: 1 } });
  assert.deepEqual(out[2].content.map((b) => b.tool_use_id), ['a', 'b']);
  assert.equal(out[2].content[1].is_error, true);
});

test('Anthropic: Claude replies are replayed unchanged', () => {
  const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Hi' }];
  const out = toAnthropicMessages([
    { role: 'user', content: 'Hi' },
    { role: 'assistant', text: 'Hi', toolCalls: [], raw: { kind: 'anthropic', content: raw } },
  ]);
  assert.equal(out[1].content, raw);
});

test('OpenAI: tool calls and results use the chat-completions shape', () => {
  const out = toOpenAIMessages('sys', convo);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'assistant', 'user']);
  assert.equal(out[2].tool_calls[0].function.arguments, '{"q":1}');
  assert.equal(out[3].tool_call_id, 'a');
  assert.equal(out[5].tool_calls, undefined);
});

test('workspace paths cannot escape the workspace', () => {
  const root = path.resolve('/tmp/ws');
  assert.equal(resolveInWorkspace(root, 'a/b.txt'), path.join(root, 'a/b.txt'));
  assert.equal(resolveInWorkspace(root, '/a.txt'), path.join(root, 'a.txt'));
  assert.throws(() => resolveInWorkspace(root, '../secret'));
  assert.throws(() => resolveInWorkspace(root, 'a/../../x'));
  assert.throws(() => resolveInWorkspace('/tmp/ws', '../ws-other/x'));
});

test('app keys are filled in by name', () => {
  assert.equal(fillSecrets('Bearer {{ SHOP_KEY }}', { SHOP_KEY: 'abc' }), 'Bearer abc');
  assert.throws(() => fillSecrets('{{MISSING}}', {}), /MISSING/);
});

test('web pages are turned into readable text', () => {
  const text = htmlToText('<html><style>x{}</style><h1>Title</h1><p>A &amp; B</p><script>evil()</script></html>');
  assert.equal(text, 'Title\n A & B');
});

test('bots cannot call Dawnshift itself', async () => {
  const { TOOLS_BY_NAME, setOwnPort } = await import('../src/tools.js');
  setOwnPort(3777);
  await assert.rejects(TOOLS_BY_NAME.web_fetch.run({ url: 'http://localhost:3777/api/state' }), /Dawnshift itself/);
  await assert.rejects(TOOLS_BY_NAME.web_fetch.run({ url: 'file:///etc/passwd' }), /http/);
});
