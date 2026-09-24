// BotCrew's web interface. Plain JavaScript, no build step.
import { createMascot } from './mascot.js';

const buddy = createMascot();
document.body.append(buddy.el);

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Like replaceChildren, but accepts nested arrays and skips empty values.
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), bad ? 6000 : 2500);
}

// Runs an action and shows any error instead of failing silently.
async function attempt(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    buddy.shake();
  } finally {
    if (button) button.disabled = false;
  }
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const STATUS_LABEL = {
  queued: 'queued',
  running: 'working',
  needs_you: 'needs you',
  waiting: 'waiting on team',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};
const ACTIVE = new Set(['queued', 'running', 'needs_you', 'waiting']);

// ---------- state ----------

let S = null; // server state
const ui = { view: 'team', botId: 'all', taskId: null, task: null, needsYouOnly: false, newIds: new Set(), changedIds: new Set() };
let mounted = null; // which view's skeleton is on screen

async function refresh(force = false) {
  const data = await api('GET', `/api/state${S && !force ? `?since=${S.version}` : ''}`);
  if (data.unchanged) return;
  const before = S;
  S = data;
  react(before);
  if (ui.botId !== 'all' && !S.bots.some((b) => b.id === ui.botId)) ui.botId = 'all';
  if (ui.taskId) {
    const summary = S.tasks.find((t) => t.id === ui.taskId);
    if (!summary) {
      ui.taskId = null;
      ui.task = null;
    } else if (!ui.task || summary.updatedAt !== ui.task.updatedAt) {
      ui.task = await api('GET', `/api/tasks/${ui.taskId}`);
      ui.taskChanged = true;
    }
  }
  render();
}

// Crewbot reacts to changes in the team's work.
function react(before) {
  const tasks = S.tasks;
  buddy.setMood(
    tasks.some((t) => t.status === 'needs_you') ? 'alert'
      : tasks.some((t) => ['running', 'queued', 'waiting'].includes(t.status)) ? 'working' : 'idle');
  if (!before) {
    if (!S.connections.length) buddy.nod("Hi, I'm Crewbot! Let's set up your AI team.");
    return;
  }
  const old = new Map(before.tasks.map((t) => [t.id, t.status]));
  const short = (title) => (title.length > 40 ? `${title.slice(0, 40)}…` : title);
  for (const t of tasks) {
    const was = old.get(t.id);
    if (was === t.status) continue;
    (was ? ui.changedIds : ui.newIds).add(t.id);
    if (t.status === 'needs_you') buddy.nod(`${t.botName} needs you${t.pending?.kind === 'approval' ? ' to approve something' : ' to answer a question'}.`);
    else if (t.status === 'done' && !t.parentId) buddy.cheer(`${t.botName} finished "${short(t.title)}"!`);
    else if (t.status === 'done') buddy.say(`${t.botName} handed back "${short(t.title)}".`);
    else if (t.status === 'failed') buddy.shake(`${t.botName} ran into a problem with "${short(t.title)}".`);
    else if (!was && t.from === 'Routine') buddy.nod(`${t.botName} started a routine: ${short(t.title)}.`);
  }
}

async function poll() {
  try {
    await refresh();
  } catch {
    // The server may be restarting; try again next tick.
  }
  setTimeout(poll, 1500);
}

function go(view) {
  ui.view = view;
  mounted = null;
  ui.lastRendered = null;
  render();
  document.getElementById('main').scrollTop = 0;
}

async function openTask(id) {
  ui.taskId = id;
  ui.task = await api('GET', `/api/tasks/${id}`);
  ui.taskChanged = true;
  if (ui.view !== 'team') go('team');
  else render();
  document.querySelector('.detail')?.scrollIntoView({ block: 'start', behavior: 'instant' });
}

// ---------- rendering ----------

function render() {
  if (!S) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === ui.view ? 'page' : 'false'));
  const waiting = S.tasks.filter((t) => t.status === 'needs_you');
  const badge = document.getElementById('needs-you');
  badge.hidden = !waiting.length;
  badge.textContent = `Needs you · ${waiting.length}`;
  document.title = waiting.length ? `(${waiting.length}) BotCrew` : 'BotCrew';

  const main = document.getElementById('main');
  const view = !S.connections.length || !S.bots.length ? (ui.view === 'settings' ? 'settings' : 'welcome') : ui.view;
  if (mounted !== view) {
    document.body.append(buddy.el);
    fill(main);
    mounted = view;
    ui.taskChanged = true;
    ({ welcome: mountWelcome, team: mountTeam, board: mountBoard, files: mountFiles, settings: mountSettings })[view](main);
    main.firstElementChild?.classList.add('view-enter');
  }
  const fresh = mounted !== ui.lastRendered;
  ui.lastRendered = mounted;
  ({ welcome: renderWelcome, team: renderTeam, board: renderBoard, files: () => {}, settings: renderSettings })[view]();
  if (fresh) stagger(main);
}

// Lets lists fade in one item after another the first time they show up.
function stagger(root) {
  root.classList.add('entering');
  setTimeout(() => root.classList.remove('entering'), 900);
  root.querySelectorAll('.member, .ticket, .steps li, .providers button').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
}

// ---------- welcome / first run ----------

function mountWelcome(main) {
  main.append(h('div', { class: 'page', id: 'welcome' }));
}

function renderWelcome() {
  const hasConn = S.connections.length > 0;
  const page = document.getElementById('welcome');
  fill(page, 
    h('h1', {}, 'Your AI team, on your computer'),
    h('p', { class: 'lede' },
      'BotCrew gives you a team of AI coworkers. Each one has a job, remembers what it learns, and can hand work to the others. ',
      'You choose which AI powers each bot: Claude, ChatGPT, Grok, Gemini, or a model running on your own machine.'),
    h('ol', { class: 'steps' },
      h('li', { class: hasConn ? 'done' : '' },
        h('div', {},
          h('h2', {}, 'Connect an AI'),
          hasConn
            ? h('p', { class: 'hint' }, `Connected: ${S.connections.map((c) => c.name).join(', ')}`)
            : [h('p', { class: 'hint' }, 'Paste an API key, or point BotCrew at a local model. You can add more later.'), providerPicker()])),
      h('li', {},
        h('div', {},
          h('h2', {}, 'Hire your team'),
          h('p', { class: 'hint' }, 'Start with a Chief of Staff, Researcher, Writer and Operations bot, or build your own.'),
          h('div', { class: 'row' },
            h('button', {
              class: 'primary',
              disabled: !hasConn,
              onclick: (e) => attempt(async () => {
                await api('POST', '/api/bots/starter-team', { connectionId: S.connections[0].id });
                await refresh(true);
                go('team');
                buddy.cheer('Your team is ready! Give them a job.');
              }, e.currentTarget),
            }, 'Hire the starter team'),
            h('button', { disabled: !hasConn, onclick: () => editBot() }, 'Hire one bot')))),
    ),
  );
}

function providerPicker() {
  return h('div', { class: 'providers' },
    Object.entries(S.presets).map(([key, p]) =>
      h('button', { onclick: () => editConnection({ preset: key }) },
        h('span', {}, p.label),
        h('span', { class: 'kind' }, p.local ? 'local' : 'API key'))));
}

// ---------- team view ----------

function mountTeam(main) {
  const composerInput = h('textarea', { id: 'composer-text', rows: 3 });
  const assign = h('button', { class: 'primary', type: 'submit' }, 'Assign');
  const composer = h('form', {
    class: 'composer',
    onsubmit: (e) => {
      e.preventDefault();
      const text = composerInput.value.trim();
      const botId = ui.botId === 'all' ? document.getElementById('composer-bot').value : ui.botId;
      if (!text) return composerInput.focus();
      attempt(async () => {
        const t = await api('POST', '/api/tasks', { botId, instructions: text });
        composerInput.value = '';
        buddy.nod(`On it! ${t.botName} has the task.`);
        await refresh(true);
        openTask(t.id);
      }, assign);
    },
  },
  h('label', { for: 'composer-text', id: 'composer-label', class: 'eyebrow' }),
  composerInput,
  h('div', { class: 'row' },
    h('select', { id: 'composer-bot', style: 'width:auto', 'aria-label': 'Assign to' }),
    h('span', { class: 'hint' }, 'Ctrl+Enter to send'),
    assign));
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) composer.requestSubmit();
  });

  main.append(
    h('div', { class: 'team' },
      h('section', { class: 'roster', 'aria-label': 'Team' }, h('div', { id: 'roster-list' }), buddy.el),
      h('section', { class: 'work', 'aria-label': 'Work' }, h('div', { id: 'bot-head' }), composer, h('div', { id: 'tickets' })),
      h('section', { class: 'detail', 'aria-label': 'Task' })));
}

function botStatus(bot) {
  const mine = S.tasks.filter((t) => t.botId === bot.id);
  if (mine.some((t) => t.status === 'needs_you')) return 'needs_you';
  if (mine.some((t) => t.status === 'running' || t.status === 'queued')) return 'working';
  if (mine.some((t) => t.status === 'waiting')) return 'waiting';
  return 'idle';
}

function modelLabel(bot) {
  const conn = S.connections.find((c) => c.id === bot.connectionId);
  if (!conn) return 'no AI connected';
  return bot.model || conn.model || conn.name;
}

function renderTeam() {
  // Roster
  const roster = document.getElementById('roster-list');
  const active = S.tasks.filter((t) => ACTIVE.has(t.status)).length;
  fill(roster, 
    h('div', { class: 'roster-head' }, h('span', { class: 'eyebrow' }, `Team · ${S.bots.length}`), h('button', { class: 'quiet', onclick: () => editBot() }, '+ Hire')),
    h('button', { class: 'member', 'aria-current': String(ui.botId === 'all'), onclick: () => selectBot('all') },
      h('span', { class: `dot ${active ? 'working' : ''}` }),
      h('span', { class: 'name' }, 'All work'),
      h('span', { class: 'meta' }, `${active} active · ${S.tasks.length} total`)),
    S.bots.map((bot) => {
      const status = botStatus(bot);
      return h('button', { class: 'member', 'aria-current': String(ui.botId === bot.id), onclick: () => selectBot(bot.id) },
        h('span', { class: `dot ${status}`, title: status }),
        h('span', { class: 'name' }, bot.name),
        h('span', { class: 'sub' }, bot.job),
        h('span', { class: 'meta' }, modelLabel(bot)));
    }));

  // Bot header + composer target
  const bot = S.bots.find((b) => b.id === ui.botId);
  fill(document.getElementById('bot-head'), 
    bot
      ? h('div', { class: 'bot-head' },
          h('div', {}, h('h1', {}, bot.name), h('p', {}, bot.job)),
          h('button', { onclick: () => editBot(bot) }, 'Settings'))
      : h('div', { class: 'bot-head' },
          h('div', {}, h('h1', {}, ui.needsYouOnly ? 'Needs you' : 'All work'),
            h('p', {}, ui.needsYouOnly ? 'Approvals and questions from your team.' : 'Everything your team is doing.')),
          ui.needsYouOnly ? h('button', { onclick: () => { ui.needsYouOnly = false; render(); } }, 'Show all') : null));
  document.getElementById('composer-label').textContent = bot ? `New task for ${bot.name}` : 'New task';
  const pick = document.getElementById('composer-bot');
  pick.hidden = Boolean(bot);
  const chosen = pick.value;
  fill(pick, ...S.bots.map((b) => h('option', { value: b.id }, b.name)));
  const lead = S.bots.find((b) => b.abilities.includes('delegate_task'));
  pick.value = S.bots.some((b) => b.id === chosen) ? chosen : (lead ?? S.bots[0]).id;
  const composerText = document.getElementById('composer-text');
  composerText.placeholder = bot
    ? `What should ${bot.name} do?`
    : 'Describe the job. A team lead will split it up and hand pieces to the others.';

  // Tickets: newest first, with coworker subtasks under their parent.
  let tasks = S.tasks.filter((t) => (bot ? t.botId === bot.id : true));
  if (ui.needsYouOnly && !bot) tasks = tasks.filter((t) => t.status === 'needs_you');
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parentId || !ids.has(t.parentId)).reverse();
  const children = (id) => tasks.filter((t) => t.parentId === id);
  const rows = [];
  const add = (t, depth) => {
    rows.push(ticket(t, depth));
    children(t.id).forEach((c) => add(c, depth + 1));
  };
  roots.forEach((t) => add(t, 0));
  fill(document.getElementById('tickets'), 
    rows.length
      ? h('div', { class: 'ticket-list' }, rows)
      : h('p', { class: 'empty' }, bot ? `${bot.name} has no tasks yet.` : ui.needsYouOnly ? 'Nothing is waiting on you.' : 'No tasks yet. Assign one above.'));

  renderDetail();
  // Each change animates once, not again on the next unrelated re-render.
  ui.newIds.clear();
  ui.changedIds.clear();
}

function ticket(t, depth) {
  // New tasks slide in and status changes get a little pop (see react()).
  const isNew = ui.newIds.has(t.id);
  const changed = ui.changedIds.has(t.id);
  const who = ui.botId === 'all' ? `${t.botName} · ` : '';
  const pending = t.status === 'needs_you' ? (t.pending?.kind === 'approval' ? ' · approval' : ' · question') : t.status === 'waiting' && t.pending?.coworker ? ` · on ${t.pending.coworker}` : '';
  return h('button', {
    class: `ticket${depth ? ' child' : ''}${isNew ? ' is-new' : ''}`,
    style: depth ? `padding-left:${0.25 + depth * 1.25}rem` : null,
    'aria-current': String(ui.taskId === t.id),
    onclick: () => attempt(() => openTask(t.id)),
  },
  h('span', { class: 'title' }, t.title),
  h('span', { class: `tag ${t.status}${changed ? ' pop' : ''}` }, STATUS_LABEL[t.status] + pending),
  h('span', { class: 'meta' }, `${who}from ${t.from} · ${ago(t.updatedAt)}`));
}

function selectBot(id) {
  ui.botId = id;
  ui.needsYouOnly = false;
  render();
}

function renderDetail() {
  const pane = document.querySelector('.detail');
  const t = ui.task;
  if (!t) {
    fill(pane, h('div', { class: 'empty' }, h('h2', {}, 'No task selected'), h('p', {}, 'Pick a task to see what the bot did, step by step.')));
    return;
  }
  // Only rebuild when the task changed, so typing in a reply box isn't lost.
  if (!ui.taskChanged && pane.dataset.taskId === t.id) {
    pane.querySelectorAll('[data-ago]').forEach((el) => (el.textContent = ago(el.dataset.ago)));
    return;
  }
  ui.taskChanged = false;
  if (pane.dataset.taskId !== t.id) {
    pane.classList.add('fresh');
    setTimeout(() => pane.classList.remove('fresh'), 700);
  }
  pane.dataset.taskId = t.id;

  const parent = t.parentId && S.tasks.find((x) => x.id === t.parentId);
  const subtasks = S.tasks.filter((x) => x.parentId === t.id);
  const usage = t.usage && t.usage.input + t.usage.output ? ` · ${(t.usage.input + t.usage.output).toLocaleString()} tokens` : '';

  fill(pane, 
    h('div', { class: 'detail-head' },
      h('h2', {}, t.title),
      h('span', { class: `tag ${t.status}` }, STATUS_LABEL[t.status])),
    h('div', { class: 'meta-line' },
      `${t.botName} · from ${t.from} · `, h('span', { 'data-ago': t.updatedAt }, ago(t.updatedAt)), usage,
      t.servedBy ? ` · ${t.servedBy}` : ''),
    parent ? h('p', {}, 'Part of ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openTask(parent.id); } }, parent.title)) : null,
    actionBox(t),
    subtasks.length
      ? h('div', { class: 'block' }, h('div', { class: 'eyebrow' }, 'Handed to coworkers'), h('div', { class: 'ticket-list' }, subtasks.map((s) => ticket(s, 0))))
      : null,
    h('div', { class: 'eyebrow', style: 'margin-bottom:0.75rem' }, 'Steps'),
    transcript(t),
    followUp(t),
  );
}

function actionBox(t) {
  if (t.status === 'needs_you' && t.pending?.kind === 'approval') {
    const note = h('input', { placeholder: 'Optional note for the bot (e.g. why not)' });
    return h('div', { class: 'callout' },
      h('h3', {}, `${t.botName} wants to do this:`),
      h('div', { class: 'what' }, t.pending.summary),
      t.pending.tool === 'write_file' && t.pending.args?.content
        ? h('details', { class: 'call', style: 'margin-bottom:0.75rem' }, h('summary', {}, 'Show file contents'), h('pre', {}, t.pending.args.content))
        : t.pending.args?.body ? h('details', { class: 'call', style: 'margin-bottom:0.75rem' }, h('summary', {}, 'Show request body'), h('pre', {}, t.pending.args.body)) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: (e) => attempt(async () => { await api('POST', `/api/tasks/${t.id}/decide`, { approved: true }); buddy.nod('Approved. Back to work!'); await refresh(); }, e.currentTarget) }, 'Allow'),
        h('button', { onclick: (e) => attempt(async () => { await api('POST', `/api/tasks/${t.id}/decide`, { approved: false, note: note.value }); buddy.nod("Okay, we'll skip that."); await refresh(); }, e.currentTarget) }, 'Don\'t allow'),
        h('div', { class: 'grow' }, note)));
  }
  if (t.status === 'needs_you' && t.pending?.kind === 'input') {
    const answer = h('textarea', { rows: 3, placeholder: 'Your answer' });
    const send = h('button', { class: 'primary', type: 'submit' }, 'Send answer');
    return h('form', {
      class: 'callout',
      onsubmit: (e) => {
        e.preventDefault();
        if (!answer.value.trim()) return answer.focus();
        attempt(async () => { await api('POST', `/api/tasks/${t.id}/answer`, { text: answer.value }); buddy.nod('Got it, thanks!'); await refresh(); }, send);
      },
    }, h('h3', {}, `${t.botName} asks:`), h('p', { class: 'text' }, t.pending.question), answer, h('div', { class: 'row', style: 'margin-top:0.5rem' }, send));
  }
  if (t.status === 'failed') return h('div', { class: 'callout error' }, h('h3', {}, 'This task failed'), h('p', { class: 'text' }, t.error), h('p', { class: 'hint' }, 'Reply below to have the bot try again, or check the AI connection in Settings.'));
  if (t.status === 'done') return h('div', { class: 'callout result' }, h('h3', {}, 'Result'), h('div', { class: 'text' }, t.result));
  if (ACTIVE.has(t.status)) {
    return h('div', { class: 'row', style: 'margin-bottom:1.5rem' },
      h('span', { class: 'hint grow' }, t.status === 'waiting' ? `Waiting for ${t.pending?.coworker ?? 'a coworker'} to finish.` : 'Working. This page updates by itself.'),
      h('button', { class: 'danger', onclick: (e) => attempt(async () => { await api('POST', `/api/tasks/${t.id}/cancel`, {}); await refresh(); }, e.currentTarget) }, 'Stop task'));
  }
  return null;
}

function transcript(t) {
  const results = new Map(t.messages.filter((m) => m.role === 'tool').map((m) => [m.callId, m]));
  return h('div', { class: 'transcript' },
    t.messages.filter((m) => m.role !== 'tool').map((m, i) => {
      if (m.role === 'user') {
        return h('div', { class: 'entry from-human' }, h('div', { class: 'who' }, i === 0 ? `Task from ${t.from}` : 'You'), h('div', { class: 'text' }, m.content));
      }
      return h('div', { class: 'entry' },
        h('div', { class: 'who' }, t.botName),
        m.text ? h('div', { class: 'text' }, m.text) : null,
        m.toolCalls.map((c) => {
          const r = results.get(c.id);
          return h('details', { class: 'call' },
            h('summary', {}, `${c.name} `, callPreview(c), r?.isError ? h('span', { class: 'err' }, ' · error') : r ? '' : ' · pending'),
            h('pre', {}, `${JSON.stringify(c.args, null, 2)}${r ? `\n\n→ ${r.content}` : ''}`));
        }));
    }));
}

function callPreview(c) {
  const a = c.args ?? {};
  const s = a.path ?? a.url ?? a.coworker ?? a.question ?? a.note ?? a.message ?? a.folder ?? '';
  return String(s).slice(0, 80);
}

function followUp(t) {
  if (ACTIVE.has(t.status)) return null;
  const text = h('textarea', { rows: 2, placeholder: t.status === 'done' ? 'Ask for changes or a next step' : 'Tell the bot what to do next' });
  const send = h('button', { type: 'submit' }, t.status === 'done' ? 'Send follow-up' : 'Try again');
  return h('form', {
    class: 'composer',
    style: 'margin-top:1.5rem',
    onsubmit: (e) => {
      e.preventDefault();
      attempt(async () => {
        await api('POST', `/api/tasks/${t.id}/reply`, { text: text.value.trim() || 'Please try again.' });
        buddy.nod('Sending it back to work.');
        await refresh();
      }, send);
    },
  }, text, h('div', { class: 'row', style: 'justify-content:flex-end' }, send));
}

// ---------- bot editor ----------

const EVERY = [
  [60, 'Every hour'],
  [240, 'Every 4 hours'],
  [1440, 'Every day'],
  [10080, 'Every week'],
];

function editBot(bot) {
  const dlg = document.getElementById('dialog');
  const draft = bot ? structuredClone(bot) : { name: '', job: '', connectionId: S.connections[0]?.id ?? '', model: '', abilities: ['files'], approvals: 'risky', routines: [], memory: [] };
  const f = {
    name: h('input', { id: 'bot-name', value: draft.name, required: true, maxlength: 40 }),
    job: h('textarea', { id: 'bot-job', rows: 4, required: true }),
    conn: h('select', { id: 'bot-conn' }, S.connections.map((c) => h('option', { value: c.id }, c.name))),
    model: h('input', { id: 'bot-model', value: draft.model, list: 'bot-models', placeholder: 'Use the connection\'s default' }),
    models: h('datalist', { id: 'bot-models' }),
  };
  f.job.value = draft.job;
  f.conn.value = draft.connectionId;

  const abilities = S.abilities.map((a) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: a.id, checked: draft.abilities.includes(a.id) }), a.label));
  const approvals = [
    ['risky', 'Ask me before it writes files or changes data in an app'],
    ['always', 'Ask me before every action'],
    ['never', 'Never ask (fully autonomous)'],
  ].map(([v, text]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'approvals', value: v, checked: draft.approvals === v }), text));

  const routineBox = h('div');
  const drawRoutines = () => fill(routineBox, 
    draft.routines.map((r, i) => {
      const title = h('input', { value: r.title, placeholder: 'e.g. Morning briefing', oninput: (e) => (r.title = e.target.value) });
      const every = h('select', { onchange: (e) => (r.everyMinutes = Number(e.target.value)) }, EVERY.map(([m, l]) => h('option', { value: m }, l)));
      every.value = String(EVERY.some(([m]) => m === r.everyMinutes) ? r.everyMinutes : 1440);
      r.everyMinutes = Number(every.value);
      const instr = h('textarea', { rows: 2, placeholder: 'What to do each time', oninput: (e) => (r.instructions = e.target.value) });
      instr.value = r.instructions;
      return h('div', { class: 'routine' },
        h('div', { class: 'row', style: 'margin-bottom:0.5rem' }, h('div', { class: 'grow' }, title), every,
          h('button', { type: 'button', class: 'quiet', 'aria-label': 'Remove routine', onclick: () => { draft.routines.splice(i, 1); drawRoutines(); } }, 'Remove')),
        instr);
    }),
    h('button', { type: 'button', onclick: () => { draft.routines.push({ title: '', instructions: '', everyMinutes: 1440 }); drawRoutines(); } }, '+ Add routine'));
  drawRoutines();

  const memoryBox = bot
    ? h('fieldset', {},
        h('legend', {}, `Memory · ${draft.memory.length}`),
        draft.memory.length
          ? draft.memory.map((m, i) => h('div', { class: 'memory-item' }, h('span', {}, m),
              h('button', { type: 'button', class: 'quiet', onclick: (e) => attempt(async () => { await api('POST', `/api/bots/${bot.id}/forget`, { index: i }); dlg.close(); await refresh(true); editBot(S.bots.find((b) => b.id === bot.id)); }, e.currentTarget) }, 'Forget')))
          : h('p', { class: 'hint' }, 'Nothing yet. The bot saves notes here as it learns.'))
    : null;

  const loadModels = h('button', {
    type: 'button',
    onclick: (e) => attempt(async () => {
      const { models } = await api('POST', `/api/connections/${f.conn.value}/models`, {});
      fill(f.models, ...models.map((m) => h('option', { value: m })));
      toast(`${models.length} models found. Start typing in the model box to pick one.`);
      f.model.focus();
    }, e.currentTarget),
  }, 'Load models');

  const save = h('button', { class: 'primary', type: 'submit' }, bot ? 'Save' : 'Hire');
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const body = {
        name: f.name.value,
        job: f.job.value,
        connectionId: f.conn.value,
        model: f.model.value,
        abilities: abilities.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
        approvals: approvals.map((l) => l.querySelector('input')).find((i) => i.checked)?.value ?? 'risky',
        routines: draft.routines.filter((r) => r.title.trim() || r.instructions.trim()),
      };
      attempt(async () => {
        const saved = await api(bot ? 'PUT' : 'POST', bot ? `/api/bots/${bot.id}` : '/api/bots', body);
        dlg.close();
        await refresh(true);
        if (ui.view === 'team' || !bot) selectBot(saved.id);
        if (mounted === 'welcome') go('team');
        if (bot) toast('Saved.');
        else buddy.cheer(`${saved.name} joined the team!`);
      }, save);
    },
  },
  h('div', { class: 'dialog-head' }, h('h2', {}, bot ? `${bot.name} settings` : 'Hire a bot'),
    h('button', { type: 'button', class: 'quiet', onclick: () => dlg.close() }, 'Close')),
  bot ? null : h('div', { class: 'templates' }, h('span', { class: 'eyebrow', style: 'width:100%' }, 'Start from a role'),
    S.templates.map((t) => h('button', {
      type: 'button',
      onclick: () => {
        f.name.value = t.name;
        f.job.value = t.job;
        abilities.forEach((l) => (l.querySelector('input').checked = t.abilities.includes(l.querySelector('input').value)));
      },
    }, t.name))),
  h('div', { class: 'field' }, h('label', { for: 'bot-name' }, 'Name'), f.name),
  h('div', { class: 'field' }, h('label', { for: 'bot-job' }, 'Job'), f.job, h('div', { class: 'hint' }, 'Describe the role like you would to a new hire: what they own, how you like things done.')),
  h('div', { class: 'field' },
    h('label', { for: 'bot-conn' }, 'AI'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, f.conn), h('div', { class: 'grow' }, f.model, f.models), loadModels),
    h('div', { class: 'hint' }, 'Leave the model empty to use the connection\'s default. Different bots can use different AIs.')),
  h('fieldset', {}, h('legend', {}, 'Abilities'), abilities),
  h('fieldset', {}, h('legend', {}, 'Approvals'), approvals),
  h('fieldset', {}, h('legend', {}, 'Routines'), h('p', { class: 'hint', style: 'margin-top:0' }, 'Recurring jobs the bot does on its own while BotCrew is running.'), routineBox),
  memoryBox,
  h('div', { class: 'dialog-foot' },
    bot
      ? h('button', {
          type: 'button',
          class: 'danger',
          onclick: (e) => {
            if (!confirm(`Remove ${bot.name} from the team? Their unfinished tasks will be stopped.`)) return;
            attempt(async () => { await api('DELETE', `/api/bots/${bot.id}`); dlg.close(); await refresh(true); selectBot('all'); }, e.currentTarget);
          },
        }, 'Remove from team')
      : h('span'),
    save));
  fill(dlg, form);
  dlg.showModal();
  if (!bot) f.name.focus();
}

// ---------- AI connection editor ----------

function editConnection(conn) {
  const dlg = document.getElementById('dialog');
  const preset = S.presets[conn.preset];
  const isNew = !conn.id;
  const f = {
    name: h('input', { id: 'c-name', value: conn.name ?? preset.label }),
    key: h('input', { id: 'c-key', type: 'password', autocomplete: 'off', placeholder: conn.hasKey ? `Saved (${conn.keyHint}). Leave empty to keep it.` : preset.local ? 'Not needed for most local servers' : 'Paste your API key' }),
    base: h('input', { id: 'c-base', value: conn.baseUrl ?? preset.baseUrl }),
    model: h('input', { id: 'c-model', value: conn.model ?? preset.model ?? '', list: 'c-models', placeholder: 'Click "Load models" to see what\'s available' }),
    models: h('datalist', { id: 'c-models' }),
  };
  const body = () => ({ id: conn.id, preset: conn.preset, name: f.name.value, apiKey: f.key.value, baseUrl: preset.kind === 'openai' ? f.base.value : '', model: f.model.value });

  const loadModels = h('button', {
    type: 'button',
    onclick: (e) => attempt(async () => {
      const { models } = await api('POST', '/api/connections/probe', body());
      fill(f.models, ...models.map((m) => h('option', { value: m })));
      if (!f.model.value && models.length) f.model.value = models[0];
      toast(models.length ? `Connected. ${models.length} models available.` : 'Connected, but the server listed no models.');
      f.model.focus();
    }, e.currentTarget),
  }, 'Load models');

  const save = h('button', { class: 'primary', type: 'submit' }, isNew ? 'Connect' : 'Save');
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      attempt(async () => {
        if (!f.model.value.trim()) throw new Error('Pick a model first. "Load models" lists what this AI offers.');
        await api(isNew ? 'POST' : 'PUT', isNew ? '/api/connections' : `/api/connections/${conn.id}`, body());
        dlg.close();
        await refresh(true);
        buddy.nod(`${f.name.value} is connected. Nice!`);
      }, save);
    },
  },
  h('div', { class: 'dialog-head' }, h('h2', {}, isNew ? `Connect ${preset.label}` : `Edit ${conn.name}`), h('button', { type: 'button', class: 'quiet', onclick: () => dlg.close() }, 'Close')),
  h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Name'), f.name),
  h('div', { class: 'field' },
    h('label', { for: 'c-key' }, 'API key'),
    f.key,
    preset.keyUrl ? h('div', { class: 'hint' }, 'Get one at ', h('a', { href: preset.keyUrl, target: '_blank', rel: 'noopener' }, new URL(preset.keyUrl).host), preset.env ? `, or set ${preset.env} before starting BotCrew.` : '.') : null,
    conn.keyFromEnv ? h('div', { class: 'hint' }, `Using the key from ${preset.env}.`) : null),
  preset.kind === 'openai'
    ? h('div', { class: 'field' }, h('label', { for: 'c-base' }, 'Server address'), f.base,
        preset.local ? h('div', { class: 'hint' }, conn.preset === 'ollama' ? 'Start Ollama and pull a model that supports tools (for example with "ollama pull" plus the model name).' : 'Start the local server in LM Studio and load a model.') : null)
    : null,
  h('div', { class: 'field' }, h('label', { for: 'c-model' }, 'Default model'), h('div', { class: 'row' }, h('div', { class: 'grow' }, f.model, f.models), loadModels)),
  h('div', { class: 'dialog-foot' }, h('span'), save));
  fill(dlg, form);
  dlg.showModal();
}

// ---------- board ----------

function mountBoard(main) {
  const text = h('textarea', { rows: 2, placeholder: 'Leave context for the whole team, e.g. "We\'re closed Dec 24 to 26."' });
  const post = h('button', { class: 'primary', type: 'submit' }, 'Post');
  main.append(h('div', { class: 'page' },
    h('h1', {}, 'Team board'),
    h('p', { class: 'lede' }, 'Shared notes every bot can read and post to. Use it for context the whole team should know.'),
    h('form', {
      class: 'composer',
      onsubmit: (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        attempt(async () => { await api('POST', '/api/board', { message: text.value }); text.value = ''; await refresh(); }, post);
      },
    }, text, h('div', { class: 'row', style: 'justify-content:flex-end' }, post)),
    h('div', { id: 'posts' })));
}

function renderBoard() {
  const posts = [...S.board].reverse();
  fill(document.getElementById('posts'), 
    posts.length
      ? posts.map((p) => h('div', { class: 'post' }, h('div', { class: 'who' }, `${p.author} · ${ago(p.at)}`), h('div', { class: 'text' }, p.message)))
      : h('p', { class: 'empty' }, 'Nothing posted yet.'));
}

// ---------- files ----------

function mountFiles(main) {
  const list = h('div', { class: 'list' });
  const view = h('div');
  main.append(h('div', { class: 'page' },
    h('h1', {}, 'Workspace files'),
    h('p', { class: 'lede', id: 'files-lede' }, 'Files your bots have written. Bots with file abilities can read anything you put in this folder.'),
    h('div', { class: 'row', style: 'margin-bottom:1rem' }, h('button', { onclick: () => load() }, 'Refresh')),
    list, view));
  async function load() {
    await attempt(async () => {
      const { root, files } = await api('GET', '/api/files');
      fill(document.getElementById('files-lede'), 'Files your bots have written. Bots with file abilities can also read anything you put in ', h('code', {}, root), '.');
      fill(list, ...(files.length
        ? files.map((f) => h('div', { class: 'list-item' },
            h('div', { class: 'grow' }, h('div', {}, f.path), h('div', { class: 'meta' }, `${f.size.toLocaleString()} bytes · ${ago(f.modified)}`)),
            h('button', {
              onclick: (e) => attempt(async () => {
                const { content } = await api('GET', `/api/files?path=${encodeURIComponent(f.path)}`);
                fill(view, h('h2', { style: 'margin-top:2rem' }, f.path), h('div', { class: 'file-view' }, content));
                view.scrollIntoView({ behavior: 'instant' });
              }, e.currentTarget),
            }, 'Open')))
        : [h('p', { class: 'empty' }, 'No files yet.')]));
    });
  }
  load();
}

// ---------- settings ----------

function mountSettings(main) {
  const name = h('input', { placeholder: 'NAME, e.g. SHOPIFY_TOKEN', 'aria-label': 'Key name' });
  const value = h('input', { type: 'password', placeholder: 'Value', 'aria-label': 'Key value', autocomplete: 'off' });
  const add = h('button', { type: 'submit' }, 'Add key');
  main.append(h('div', { class: 'page' },
    h('h1', {}, 'Settings'),
    h('p', { class: 'lede' }, 'Everything is stored on this computer, in BotCrew\'s data folder. Keys are never sent anywhere except the service they belong to.'),
    h('section', { class: 'block' },
      h('h2', {}, 'AI connections'),
      h('p', { class: 'hint' }, 'Add as many as you like. Each bot picks one in its settings.'),
      h('div', { class: 'list', id: 'conn-list' }),
      h('h3', { style: 'margin:1.5rem 0 0.75rem' }, 'Add a connection'),
      providerPicker()),
    h('section', { class: 'block' },
      h('h2', {}, 'App keys'),
      h('p', { class: 'hint' }, 'Tokens for your other apps (shop, CRM, email service). Bots with the "web APIs" ability can use them by writing {{NAME}}; the value itself stays hidden from the AI.'),
      h('div', { class: 'list', id: 'secret-list' }),
      h('form', {
        class: 'row',
        style: 'margin-top:1rem',
        onsubmit: (e) => {
          e.preventDefault();
          attempt(async () => { await api('POST', '/api/secrets', { name: name.value, value: value.value }); name.value = ''; value.value = ''; await refresh(); }, add);
        },
      }, h('div', { class: 'grow' }, name), h('div', { class: 'grow' }, value), add)),
    h('section', { class: 'block' },
      h('h2', {}, 'Housekeeping'),
      h('p', { class: 'hint' }, 'Remove finished, failed and stopped tasks from the list. Bots keep their memory.'),
      h('button', { onclick: (e) => attempt(async () => { await api('POST', '/api/tasks/clear-finished', {}); await refresh(); toast('Cleared.'); }, e.currentTarget) }, 'Clear finished tasks'))));
}

function renderSettings() {
  fill(document.getElementById('conn-list'), 
    ...(S.connections.length
      ? S.connections.map((c) => {
          const users = S.bots.filter((b) => b.connectionId === c.id).map((b) => b.name);
          return h('div', { class: 'list-item' },
            h('div', { class: 'grow' },
              h('div', {}, h('strong', {}, c.name)),
              h('div', { class: 'meta' }, [S.presets[c.preset]?.label, c.model || 'no model picked', c.hasKey ? `key ${c.keyHint}` : S.presets[c.preset]?.local ? 'local' : 'no key', users.length ? `used by ${users.join(', ')}` : 'not used yet'].join(' · '))),
            h('button', {
              onclick: (e) => attempt(async () => {
                const r = await api('POST', `/api/connections/${c.id}/test`, {});
                toast(`${r.servedBy}: "${r.reply.slice(0, 120)}"`);
              }, e.currentTarget),
            }, 'Test'),
            h('button', { onclick: () => editConnection(c) }, 'Edit'),
            h('button', {
              class: 'danger',
              onclick: (e) => {
                if (!confirm(`Remove ${c.name}?${users.length ? ` ${users.join(', ')} will need a new AI.` : ''}`)) return;
                attempt(async () => { await api('DELETE', `/api/connections/${c.id}`); await refresh(); }, e.currentTarget);
              },
            }, 'Remove'));
        })
      : [h('p', { class: 'empty' }, 'No AI connected yet. Pick a provider below.')]));
  fill(document.getElementById('secret-list'), 
    ...(S.secretNames.length
      ? S.secretNames.map((n) => h('div', { class: 'list-item' }, h('code', { class: 'grow' }, `{{${n}}}`),
          h('button', { class: 'danger', onclick: (e) => attempt(async () => { await api('DELETE', `/api/secrets/${encodeURIComponent(n)}`); await refresh(); }, e.currentTarget) }, 'Remove')))
      : [h('p', { class: 'hint' }, 'No app keys yet.')]));
}

// ---------- start ----------

document.querySelectorAll('[data-view]').forEach((el) =>
  el.addEventListener('click', (e) => {
    e.preventDefault();
    go(el.dataset.view);
  }));
document.getElementById('needs-you').addEventListener('click', () => {
  ui.botId = 'all';
  ui.needsYouOnly = true;
  const first = S.tasks.find((t) => t.status === 'needs_you');
  go('team');
  if (first) openTask(first.id);
});

refresh(true).catch((err) => toast(err.message, true)).finally(() => setTimeout(poll, 1500));
