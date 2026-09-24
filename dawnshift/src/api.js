// Dawnshift's API: everything the interface can ask for or change.
// server.js serves it over HTTP; the web version calls it directly in the page.
import { newId } from './store-common.js';
import { PRESETS, callModel, listModels, apiKeyFor } from './providers.js';
import { ABILITIES } from './tools.js';
import { TEMPLATES, STARTER_TEAM } from './templates.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);

// ---------- shaping data for the interface ----------

function publicConnection(c) {
  const key = apiKeyFor(c);
  return {
    id: c.id,
    name: c.name,
    preset: c.preset,
    kind: c.kind,
    baseUrl: c.baseUrl,
    model: c.model,
    hasKey: Boolean(key),
    keyHint: key ? `…${key.slice(-4)}` : '',
    keyFromEnv: !c.apiKey && Boolean(key),
  };
}

function taskSummary(t) {
  return {
    id: t.id,
    botId: t.botId,
    botName: t.botName,
    title: t.title,
    from: t.from,
    parentId: t.parentId,
    status: t.status,
    pending: t.pending && { kind: t.pending.kind, summary: t.pending.summary, question: t.pending.question, coworker: t.pending.coworker },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function fullTask(t) {
  const { raw, ...rest } = t;
  return {
    ...rest,
    messages: t.messages.map(({ raw: _raw, ...m }) => m),
  };
}

// ---------- validation ----------

function cleanText(v, max, field) {
  const s = String(v ?? '').trim();
  if (!s) throw bad(`${field} can't be empty.`);
  return s.slice(0, max);
}

function cleanConnection(body, existing = {}) {
  const preset = body.preset ?? existing.preset;
  if (!PRESETS[preset]) throw bad('Unknown AI provider.');
  const p = PRESETS[preset];
  const c = {
    ...existing,
    preset,
    kind: p.kind,
    name: String(body.name ?? existing.name ?? p.label).trim() || p.label,
    baseUrl: String(body.baseUrl ?? existing.baseUrl ?? p.baseUrl).trim(),
    model: String(body.model ?? existing.model ?? p.model ?? '').trim(),
  };
  if (c.kind === 'openai' && !/^https?:\/\//.test(c.baseUrl)) throw bad('The server address must start with http:// or https://');
  // An empty key field on edit means "keep the saved key".
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) c.apiKey = body.apiKey.trim();
  if (body.clearKey) delete c.apiKey;
  return c;
}

function cleanBot(body, store, existing = {}) {
  const name = cleanText(body.name ?? existing.name, 40, 'Name');
  const clash = store.state.bots.find((b) => b.id !== existing.id && b.name.toLowerCase() === name.toLowerCase());
  if (clash) throw bad(`There's already a bot called ${name}.`);
  const connectionId = body.connectionId ?? existing.connectionId ?? '';
  if (connectionId && !store.connection(connectionId)) throw bad('That AI connection no longer exists.');
  const approvals = body.approvals ?? existing.approvals ?? 'risky';
  if (!['risky', 'always', 'never'].includes(approvals)) throw bad('Unknown approval setting.');
  const known = new Set(ABILITIES.map((a) => a.id));
  const routines = (body.routines ?? existing.routines ?? []).map((r) => {
    const everyMinutes = Math.max(5, Math.round(Number(r.everyMinutes) || 0));
    const old = (existing.routines ?? []).find((o) => o.id === r.id);
    return {
      id: old?.id ?? newId('routine'),
      title: cleanText(r.title, 80, 'Routine title'),
      instructions: cleanText(r.instructions, 4000, 'Routine instructions'),
      everyMinutes,
      nextRunAt: old && old.everyMinutes === everyMinutes ? old.nextRunAt : new Date(Date.now() + everyMinutes * 60000).toISOString(),
    };
  });
  return {
    ...existing,
    name,
    job: cleanText(body.job ?? existing.job, 4000, 'Job description'),
    connectionId,
    model: String(body.model ?? existing.model ?? '').trim(),
    abilities: (body.abilities ?? existing.abilities ?? []).filter((a) => known.has(a)),
    approvals,
    routines,
    memory: existing.memory ?? [],
  };
}

// ---------- the API ----------

export function createApi(store, runner) {
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler });
  };

  const getBot = (id) => store.bot(id) ?? (() => { throw new HttpError(404, 'No such bot.'); })();
  const getConn = (id) => store.connection(id) ?? (() => { throw new HttpError(404, 'No such connection.'); })();

  on('GET', '/api/state', ({ query }) => {
    const s = store.state;
    if (query.get('since') === String(s.version)) return { version: s.version, unchanged: true };
    return {
      version: s.version,
      connections: s.connections.map(publicConnection),
      bots: s.bots,
      tasks: s.tasks.map(taskSummary),
      board: s.board.slice(-200),
      secretNames: Object.keys(s.secrets).sort(),
      presets: PRESETS,
      abilities: ABILITIES,
      templates: TEMPLATES,
    };
  });

  // AI connections
  on('POST', '/api/connections', ({ body }) => {
    const c = { id: newId('conn'), ...cleanConnection(body) };
    store.state.connections.push(c);
    store.save();
    return publicConnection(c);
  });
  on('PUT', '/api/connections/:id', ({ params, body }) => {
    const i = store.state.connections.indexOf(getConn(params.id));
    store.state.connections[i] = cleanConnection(body, store.state.connections[i]);
    store.save();
    return publicConnection(store.state.connections[i]);
  });
  on('DELETE', '/api/connections/:id', ({ params }) => {
    const c = getConn(params.id);
    store.state.connections = store.state.connections.filter((x) => x !== c);
    for (const b of store.state.bots) if (b.connectionId === c.id) b.connectionId = '';
    store.save();
    return { ok: true };
  });
  on('POST', '/api/connections/:id/models', async ({ params }) => ({ models: await listModels(getConn(params.id)) }));
  // Lists models for settings that haven't been saved yet (the add/edit form).
  on('POST', '/api/connections/probe', async ({ body }) => {
    const existing = body.id ? getConn(body.id) : {};
    return { models: await listModels({ id: 'probe', ...cleanConnection(body, existing) }) };
  });
  on('POST', '/api/connections/:id/test', async ({ params }) => {
    const c = getConn(params.id);
    const reply = await callModel(c, {
      model: c.model,
      system: 'You are being connected to Dawnshift. Reply with one short, friendly sentence.',
      messages: [{ role: 'user', content: 'Hi! Are you there?' }],
      tools: [],
    });
    return { reply: reply.text, servedBy: reply.servedBy };
  });

  // Bots
  on('POST', '/api/bots', ({ body }) => {
    const bot = { id: newId('bot'), createdAt: new Date().toISOString(), ...cleanBot(body, store) };
    store.state.bots.push(bot);
    store.save();
    return bot;
  });
  on('POST', '/api/bots/starter-team', ({ body }) => {
    const connectionId = body.connectionId && store.connection(body.connectionId) ? body.connectionId : store.state.connections[0]?.id ?? '';
    const made = [];
    for (const key of STARTER_TEAM) {
      const t = TEMPLATES.find((x) => x.key === key);
      if (store.state.bots.some((b) => b.name.toLowerCase() === t.name.toLowerCase())) continue;
      const bot = { id: newId('bot'), createdAt: new Date().toISOString(), ...cleanBot({ ...t, connectionId }, store) };
      store.state.bots.push(bot);
      made.push(bot);
    }
    store.save();
    return { bots: made };
  });
  on('PUT', '/api/bots/:id', ({ params, body }) => {
    const bot = getBot(params.id);
    Object.assign(bot, cleanBot(body, store, bot));
    for (const t of store.state.tasks) if (t.botId === bot.id) t.botName = bot.name;
    store.save();
    return bot;
  });
  on('DELETE', '/api/bots/:id', ({ params }) => {
    const bot = getBot(params.id);
    for (const t of store.state.tasks) if (t.botId === bot.id) runner.cancel(t.id);
    store.state.bots = store.state.bots.filter((b) => b !== bot);
    store.save();
    return { ok: true };
  });
  on('POST', '/api/bots/:id/forget', ({ params, body }) => {
    const bot = getBot(params.id);
    const i = Number(body.index);
    if (!Number.isInteger(i) || !bot.memory?.[i]) throw bad('No such memory.');
    bot.memory.splice(i, 1);
    store.save();
    return bot;
  });

  // Tasks
  on('GET', '/api/tasks/:id', ({ params }) => {
    const t = store.task(params.id);
    if (!t) throw new HttpError(404, 'No such task.');
    return fullTask(t);
  });
  on('POST', '/api/tasks', ({ body }) => {
    getBot(body.botId);
    const instructions = cleanText(body.instructions, 20000, 'Instructions');
    const title = String(body.title ?? '').trim().slice(0, 120) || instructions.split('\n')[0].slice(0, 80);
    return taskSummary(runner.createTask({ botId: body.botId, title, instructions }));
  });
  on('POST', '/api/tasks/:id/decide', ({ params, body }) => (runner.decide(params.id, Boolean(body.approved), String(body.note ?? '')), { ok: true }));
  on('POST', '/api/tasks/:id/answer', ({ params, body }) => (runner.answer(params.id, cleanText(body.text, 20000, 'Answer')), { ok: true }));
  on('POST', '/api/tasks/:id/reply', ({ params, body }) => (runner.reply(params.id, cleanText(body.text, 20000, 'Message')), { ok: true }));
  on('POST', '/api/tasks/:id/cancel', ({ params }) => (runner.cancel(params.id), { ok: true }));
  on('POST', '/api/tasks/clear-finished', () => {
    const keep = (t) => !['done', 'failed', 'cancelled'].includes(t.status) || store.state.tasks.some((p) => p.id === t.parentId && ['queued', 'running', 'needs_you', 'waiting'].includes(p.status));
    store.state.tasks = store.state.tasks.filter(keep);
    store.save();
    return { ok: true };
  });

  // Team board
  on('POST', '/api/board', ({ body }) => {
    store.state.board.push({ id: newId('post'), author: 'You', message: cleanText(body.message, 4000, 'Message'), at: new Date().toISOString() });
    store.save();
    return { ok: true };
  });

  // App keys: secrets the bots can use in web API calls without seeing them
  on('POST', '/api/secrets', ({ body }) => {
    const name = String(body.name ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,40}$/.test(name)) throw bad('Key names can only use letters, numbers and _ (like STRIPE_KEY).');
    store.state.secrets[name] = cleanText(body.value, 4000, 'Value');
    store.save();
    return { ok: true };
  });
  on('DELETE', '/api/secrets/:name', ({ params }) => {
    delete store.state.secrets[decodeURIComponent(params.name)];
    store.save();
    return { ok: true };
  });

  // Workspace files
  on('GET', '/api/files', async ({ query }) => {
    const file = query.get('path');
    if (file) return { path: file, content: (await store.files.read(file)).slice(0, 200000) };
    const files = await store.files.listAll();
    return { root: store.files.label, files: files.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 500) };
  });

  on('POST', '/api/files', async ({ body }) => {
    const content = String(body.content ?? '');
    if (content.length > 2_000_000) throw bad('Files can be up to 2 MB.');
    await store.files.write(cleanText(body.path, 200, 'File name'), content);
    return { ok: true };
  });

  // Runs one API call. Used over HTTP by server.js, and directly in the web version.
  return async function handle(method, url, body = {}) {
    const { pathname, searchParams } = new URL(url, 'http://local');
    const route = routes.find((r) => r.method === method && r.re.test(pathname));
    if (!route) throw new HttpError(404, 'Not found.');
    const m = pathname.match(route.re);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
    return route.handler({ params, body, query: searchParams });
  };
}
