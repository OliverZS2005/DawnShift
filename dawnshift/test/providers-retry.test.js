import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callModel } from '../src/providers.js';

// A pretend OpenAI-style server that fails the way Groq does.
async function fakeAI(handler) {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw); bodies.push(body);
    const [status, json] = handler(body, bodies.length);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, bodies, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}
const ok = (content) => [200, { id: 'x', object: 'chat.completion', model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }];
const tools = [{ name: 'list_team', description: 'x', parameters: { type: 'object', properties: {} } }];
const req = { model: 'm', system: 's', messages: [{ role: 'user', text: 'hi' }], tools };

test('a broken tool call is retried with tools still on', async () => {
  const ai = await fakeAI((body, n) => n === 1
    ? [400, { error: { message: 'Tool call validation failed: parameters for tool x did not match schema', code: 'tool_use_failed' } }]
    : ok('fine'));
  try {
    const out = await callModel({ kind: 'openai', name: 'Groq', baseUrl: ai.baseUrl, apiKey: 'k' }, req);
    assert.equal(out.text, 'fine');
    assert.equal(ai.bodies.length, 2);
    assert.ok(ai.bodies[1].tools, 'tools were kept, so the model is never told it has none');
  } finally { ai.server.close(); }
});

test('a model that truly has no tool support falls back to plain chat', async () => {
  const ai = await fakeAI((body) => body.tools ? [400, { error: { message: 'this model does not support tools' } }] : ok('plain'));
  try {
    const out = await callModel({ kind: 'openai', name: 'Local', baseUrl: ai.baseUrl, apiKey: 'k' }, req);
    assert.equal(out.text, 'plain');
  } finally { ai.server.close(); }
});
