// Dawnshift's web interface. Plain JavaScript, no build step.
import { createMascot } from './mascot.js';
import { GUIDES, ORDER, COST_LABEL } from './guides.js';
import * as notify from './notify.js';

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

// Dawnshift is a hosted app. The server holds every account's team, bots and
// files; this page is a thin client that signs in with a token and talks to
// the server through HTTP.
let token = (() => { try { return localStorage.getItem('dawnshift-token'); } catch { return null; } })();

function setToken(t) {
  token = t;
  try { t ? localStorage.setItem('dawnshift-token', t) : localStorage.removeItem('dawnshift-token'); } catch {}
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !url.startsWith('/api/account/')) {
    // Token expired or revoked: start fresh.
    setToken(null);
    location.reload();
    throw new Error('Please log in again.');
  }
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
const ui = { view: 'team', botId: 'all', taskId: null, task: null, needsYouOnly: false, newIds: new Set(), changedIds: new Set(), accountMode: 'login' };
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

// Sunny reacts to changes in the team's work.
function react(before) {
  const tasks = S.tasks;
  buddy.setMood(
    tasks.some((t) => t.status === 'needs_you') ? 'alert'
      : tasks.some((t) => ['running', 'queued', 'waiting'].includes(t.status)) ? 'working' : 'idle');
  if (!before) {
    if (!S.connections.length) buddy.nod("Hi, I'm Sunny! Let's set up your AI team.");
    return;
  }
  const old = new Map(before.tasks.map((t) => [t.id, t.status]));
  const short = (title) => (title.length > 40 ? `${title.slice(0, 40)}…` : title);
  for (const t of tasks) {
    const was = old.get(t.id);
    if (was === t.status) continue;
    (was ? ui.changedIds : ui.newIds).add(t.id);
    if (t.status === 'needs_you') {
      const what = t.pending?.kind === 'approval' ? 'to approve something' : 'to answer a question';
      buddy.nod(`${t.botName} needs you ${what}.`);
      notify.notify(`${t.botName} needs you`, `${t.title} — ${what}.`, { tag: `task-${t.id}`, onClick: () => openTask(t.id) });
    } else if (t.status === 'done' && !t.parentId) {
      buddy.cheer(`${t.botName} finished "${short(t.title)}"!`);
      notify.notify(`${t.botName} finished`, t.title, { tag: `done-${t.id}`, onClick: () => openTask(t.id) });
    } else if (t.status === 'done') buddy.say(`${t.botName} handed back "${short(t.title)}".`);
    else if (t.status === 'failed') {
      buddy.shake(`${t.botName} ran into a problem with "${short(t.title)}".`);
      notify.notify(`${t.botName} hit a problem`, t.title, { tag: `fail-${t.id}`, onClick: () => openTask(t.id) });
    }
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
  document.querySelector('.detail')?.scrollIntoView({ block: 'start', behavior: 'auto' });
}

// ---------- rendering ----------

function render() {
  if (!S) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === ui.view ? 'page' : 'false'));
  const waiting = S.tasks.filter((t) => t.status === 'needs_you');
  const badge = document.getElementById('needs-you');
  badge.hidden = !waiting.length;
  badge.textContent = `Needs you · ${waiting.length}`;
  document.title = waiting.length ? `(${waiting.length}) Dawnshift` : 'Dawnshift';

  const main = document.getElementById('main');
  const setupDone = S.connections.length && S.bots.length;
  const view = setupDone || ['settings', 'account'].includes(ui.view) ? ui.view : 'welcome';
  if (mounted !== view) {
    document.body.append(buddy.el);
    fill(main);
    mounted = view;
    ui.taskChanged = true;
    ({ welcome: mountWelcome, team: mountTeam, board: mountBoard, files: mountFiles, settings: mountSettings, account: mountAccount })[view](main);
    main.firstElementChild?.classList.add('view-enter');
  }
  const fresh = mounted !== ui.lastRendered;
  ui.lastRendered = mounted;
  ({ welcome: renderWelcome, team: renderTeam, board: renderBoard, files: () => {}, settings: renderSettings, account: () => {} })[view]();
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
    h('h1', {}, 'Your AI team, wherever you are'),
    h('p', { class: 'lede' },
      'Dawnshift gives you a team of AI coworkers. Each one has a job, remembers what it learns, and can hand work to the others. ',
      'You choose which AI powers each bot: Claude, ChatGPT, Grok, Gemini, or a model running on your own machine.'),
    iosInstallHint(),
    h('p', { class: 'hint' }, `Your team lives on your Dawnshift account, so it follows you to every device you log in on. Bots keep running on the server even when you're offline.`),
    h('ol', { class: 'steps' },
      h('li', { class: hasConn ? 'done' : '' },
        h('div', {},
          h('h2', {}, 'Connect an AI'),
          hasConn
            ? h('p', { class: 'hint' }, `Connected: ${S.connections.map((c) => c.name).join(', ')}`)
            : [h('p', { class: 'hint' }, 'Paste an API key, or point Dawnshift at a local model. You can add more later.'), providerPicker()])),
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
    h('p', { class: 'legal-links' }, 'By using Dawnshift you agree to the ', h('a', { href: 'terms.html' }, 'Terms of Service'),
      ' and ', h('a', { href: 'privacy.html' }, 'Privacy Policy'), '.'),
  );
}

// Safari on iPhone and iPad never offers to install web apps by itself, and it
// may clear a website's data after about a week without a visit. Apps added to
// the Home Screen are kept, so iPhone users get a nudge to add it.
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function iosInstallHint() {
  if (!isIos || isInstalled()) return null;
  try {
    if (localStorage.getItem('dawnshift-hide-ios-hint')) return null;
  } catch {
    // Private browsing can block storage; just show the hint.
  }
  const box = h('div', { class: 'install-hint' },
    h('h3', {}, 'Add Dawnshift to your Home Screen'),
    h('p', {}, 'Tap the ', h('strong', {}, 'Share'), ' button (the square with an arrow) in Safari, then ', h('strong', {}, 'Add to Home Screen'),
      '. Dawnshift then opens like an app, and Safari won\'t clear your data if you don\'t visit for a while.'),
    h('button', { class: 'quiet', onclick: () => {
      try {
        localStorage.setItem('dawnshift-hide-ios-hint', '1');
      } catch {
        // Nothing to remember it in; hiding it for now is enough.
      }
      box.remove();
    } }, 'Got it'));
  return box;
}

function providerPicker() {
  const keys = [...ORDER.filter((k) => S.presets[k]), ...Object.keys(S.presets).filter((k) => !ORDER.includes(k))];
  return h('div', {},
    h('p', { class: 'hint' }, 'New to this? ', h('strong', {}, 'Groq'), ' is free and takes about two minutes. Each option shows you step by step how to get it working.'),
    h('div', { class: 'providers' },
      keys.map((key) => {
        const p = S.presets[key];
        const g = GUIDES[key];
        return h('button', { onclick: () => editConnection({ preset: key }) },
          h('span', { class: 'provider-name' }, h('span', {}, p.label), g ? h('span', { class: 'provider-blurb' }, g.blurb) : null),
          h('span', { class: `kind cost-${g?.cost ?? 'varies'}` }, COST_LABEL[g?.cost] ?? (p.local ? 'local' : 'API key')));
      })));
}

// Renders one guide step: text, links, bold text and copyable code.
function guidePiece(piece) {
  if (typeof piece === 'string') return piece;
  if (piece.a) return h('a', { href: piece.a, target: '_blank', rel: 'noopener' }, piece.text ?? piece.a);
  if (piece.b) return h('strong', {}, piece.b);
  if (piece.code) return h('code', { class: 'copy', title: 'Click to copy', onclick: () => navigator.clipboard?.writeText(piece.code).then(() => toast('Copied.')) }, piece.code);
  return null;
}

// The step-by-step guide at the top of the Connect dialog (see guides.js).
function setupGuide(presetKey, open) {
  const g = GUIDES[presetKey];
  if (!g) return null;
  return h('details', { class: 'call guide', open: open || null },
    h('summary', {}, 'Step by step: how to set this up'),
    h('div', { class: 'guide-body' },
      h('ol', {}, g.steps.map((step) => h('li', {}, step.map(guidePiece)))),
      g.note ? h('p', { class: 'hint' }, g.note) : null,
      g.webNote ? h('p', { class: 'hint' }, g.webNote) : null));
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
  // Which app keys this bot may use. A bot that never had this set can use
  // all of them, so they all start ticked.
  const appKeys = S.secretNames.map((n) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', value: n, checked: !Array.isArray(draft.appKeys) || draft.appKeys.includes(n) }), h('code', {}, n)));
  const approvals = [
    ['risky', 'Ask me before it writes files or changes data in an app'],
    ['always', 'Ask me before every action'],
    ['never', 'Never ask (fully autonomous)'],
  ].map(([v, text]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'approvals', value: v, checked: draft.approvals === v }), text));

  // Core rules: on for every bot unless the owner removes them (with a warning).
  draft.coreRules = draft.coreRules !== false;
  const coreBox = h('fieldset', { class: 'core-rules' });
  const drawCore = () => fill(coreBox,
    h('legend', {}, '⚠️ Core rules'),
    draft.coreRules
      ? [
          h('p', { class: 'hint', style: 'margin-top:0' }, 'Every bot follows these before its job. They stop it from making things up when something fails.'),
          h('ol', {}, (S.coreRules ?? []).map((r) => h('li', {}, r))),
          h('button', {
            type: 'button',
            class: 'quiet',
            onclick: () => {
              if (!confirm('Remove the core rules from this bot?\n\nThey stop the bot from making up data when an API call or tool fails. Without them it may invent results, like player counts when a server API is down, or say a message was sent when it wasn\'t. Made-up answers usually sound confident, so you may not notice until something breaks.\n\nRemove them anyway?')) return;
              draft.coreRules = false;
              drawCore();
            },
          }, 'Remove core rules'),
        ]
      : [
          h('p', { class: 'hint warn', style: 'margin-top:0' }, 'This bot has no core rules. It may make up results when an API call or tool fails.'),
          h('button', { type: 'button', onclick: () => { draft.coreRules = true; drawCore(); } }, 'Restore core rules'),
        ]);
  drawCore();

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
        ...(appKeys.length ? { appKeys: appKeys.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value) } : {}),
        approvals: approvals.map((l) => l.querySelector('input')).find((i) => i.checked)?.value ?? 'risky',
        coreRules: draft.coreRules,
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
  coreBox,
  h('div', { class: 'field' }, h('label', { for: 'bot-job' }, 'Job'), f.job, h('div', { class: 'hint' }, 'Describe the role like you would to a new hire: what they own, how you like things done.')),
  h('div', { class: 'field' },
    h('label', { for: 'bot-conn' }, 'AI'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, f.conn), h('div', { class: 'grow' }, f.model, f.models), loadModels),
    h('div', { class: 'hint' }, 'Leave the model empty to use the connection\'s default. Different bots can use different AIs.')),
  h('fieldset', {}, h('legend', {}, 'Abilities'), abilities),
  h('fieldset', {}, h('legend', {}, 'Apps this bot can use'),
    appKeys.length
      ? [h('p', { class: 'hint', style: 'margin-top:0' }, 'App keys from Settings. Needs the "Use web APIs" ability above. Untick an app to keep this bot away from it.'), appKeys]
      : h('p', { class: 'hint', style: 'margin-top:0' }, 'No app keys yet. Add them in Settings → App keys, then pick them here.')),
  h('fieldset', {}, h('legend', {}, 'Approvals'), approvals),
  h('fieldset', {}, h('legend', {}, 'Routines'), h('p', { class: 'hint', style: 'margin-top:0' }, 'Recurring jobs the bot does on its own while Dawnshift is running.'), routineBox),
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
  setupGuide(conn.preset, isNew),
  h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Name'), f.name),
  h('div', { class: 'field' },
    h('label', { for: 'c-key' }, 'API key'),
    f.key,
    preset.keyUrl ? h('div', { class: 'hint' }, 'Get one at ', h('a', { href: preset.keyUrl, target: '_blank', rel: 'noopener' }, new URL(preset.keyUrl).host), '.') : null,
    conn.keyFromEnv ? h('div', { class: 'hint' }, `Using the key from ${preset.env}.`) : null),
  preset.kind === 'openai'
    ? h('div', { class: 'field' }, h('label', { for: 'c-base' }, 'Server address'), f.base,
        preset.local ? h('div', { class: 'hint' }, conn.preset === 'ollama' ? 'Start Ollama and pull a model that supports tools (for example with "ollama pull" plus the model name).' : 'Start the local server in LM Studio and load a model.') : null,
        preset.local ? localAiSteps(conn.preset) : null)
    : null,
  h('div', { class: 'field' }, h('label', { for: 'c-model' }, 'Default model'), h('div', { class: 'row' }, h('div', { class: 'grow' }, f.model, f.models), loadModels)),
  h('div', { class: 'dialog-foot' }, h('span'), save));
  fill(dlg, form);
  dlg.showModal();
}

// Setup steps for using an AI on your own computer from the web version.
// Browsers only allow it if the AI server allows this website, and the
// user allows "local network" access when the browser asks.
function localAiSteps(preset) {
  const origin = location.origin;
  const safari = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
  const code = (text) => h('code', { class: 'copy', title: 'Click to copy', onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Copied.')) }, text);
  const ollama = [
    h('li', {}, 'Tell Ollama to allow this website. Set ', code(`OLLAMA_ORIGINS=${origin}`), ':',
      h('ul', {},
        h('li', {}, h('strong', {}, 'Windows: '), 'Start menu → "Edit environment variables for your account" → New → name ', code('OLLAMA_ORIGINS'), ', value ', code(origin), '. Then quit Ollama from the taskbar and start it again.'),
        h('li', {}, h('strong', {}, 'Mac: '), 'in Terminal run ', code(`launchctl setenv OLLAMA_ORIGINS "${origin}"`), ', then quit and reopen Ollama.'),
        h('li', {}, h('strong', {}, 'Linux: '), code('sudo systemctl edit ollama'), ', add ', code(`Environment="OLLAMA_ORIGINS=${origin}"`), ' under [Service], then ', code('sudo systemctl restart ollama'), '.'))),
    h('li', {}, 'Using Dawnshift on a different device than Ollama (like your phone)? Also set ', code('OLLAMA_HOST=0.0.0.0'), ' the same way, and use the computer\'s address as the server address, like ', code('http://192.168.1.20:11434/v1'), '.'),
  ];
  const lmstudio = [
    h('li', {}, 'In LM Studio open the Developer tab → Server settings and turn on ', h('strong', {}, 'Enable CORS'), '.'),
    h('li', {}, 'Using Dawnshift on a different device (like your phone)? Also turn on ', h('strong', {}, 'Serve on Local Network'), ' and use the address LM Studio shows, like ', code('http://192.168.1.20:1234/v1'), '.'),
  ];
  return h('details', { class: 'call local-steps', open: safari || null },
    h('summary', {}, 'Setup steps for the web version'),
    h('div', { class: 'local-steps-body' },
      safari
        ? h('p', { class: 'warn' }, "Safari (on iPhone, iPad and Mac) doesn't let websites reach an AI on your own devices. Use Chrome or Edge on a computer or Android phone, or the downloadable version of Dawnshift.")
        : null,
      h('ol', {},
        ...(preset === 'ollama' ? ollama : lmstudio),
        h('li', {}, 'Click ', h('strong', {}, 'Load models'), '. If your browser asks to let this site access ', h('em', {}, 'devices on your local network'), ', click ', h('strong', {}, 'Allow'), '.')),
      h('p', { class: 'hint' }, 'Works in Chrome and Edge (computer and Android). Firefox only works when the AI is on the same computer.')));
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
  const picker = h('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: () => attempt(async () => {
      for (const file of picker.files) {
        if (file.size > 2_000_000) throw new Error(`${file.name} is too big. Files can be up to 2 MB.`);
        await api('POST', '/api/files', { path: file.name, content: await file.text() });
      }
      toast(`Added ${picker.files.length} file${picker.files.length === 1 ? '' : 's'}.`);
      picker.value = '';
      await load();
    }),
  });
  main.append(h('div', { class: 'page' },
    h('h1', {}, 'Workspace files'),
    h('p', { class: 'lede', id: 'files-lede' }, 'Files your bots have written, and files you add for them to read.'),
    h('div', { class: 'row', style: 'margin-bottom:1rem' },
      h('button', { class: 'primary', onclick: () => picker.click() }, 'Add files'),
      h('button', { onclick: () => load() }, 'Refresh'),
      picker),
    list, view));

  const read = async (f) => (await api('GET', `/api/files?path=${encodeURIComponent(f.path)}`)).content;
  async function load() {
    await attempt(async () => {
      const { root, files } = await api('GET', '/api/files');
      fill(document.getElementById('files-lede'), 'Files your bots have written, and text files you add for them to read (notes, price lists, CSV spreadsheets). Saved in ', h('code', {}, root), '.');
      fill(list, ...(files.length
        ? files.map((f) => h('div', { class: 'list-item' },
            h('div', { class: 'grow' }, h('div', {}, f.path), h('div', { class: 'meta' }, `${f.size.toLocaleString()} bytes · ${ago(f.modified)}`)),
            h('button', {
              onclick: (e) => attempt(async () => {
                fill(view, h('h2', { style: 'margin-top:2rem' }, f.path), h('div', { class: 'file-view' }, await read(f)));
                view.scrollIntoView({ behavior: 'auto' });
              }, e.currentTarget),
            }, 'Open'),
            h('button', {
              onclick: (e) => attempt(async () => {
                const link = h('a', { href: URL.createObjectURL(new Blob([await read(f)], { type: 'text/plain' })), download: f.path.split('/').pop() });
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
              }, e.currentTarget),
            }, 'Download')))
        : [h('p', { class: 'empty' }, 'No files yet.')]));
    });
  }
  load();
}

// ---------- settings ----------

// Lets the user turn browser notifications on or off (only shown when the
// browser can do them at all). Draws its own refresh on every click.
// Guesses which installer the user actually wants, so the "Download" button
// takes them straight to it instead of the whole release page.
function detectOs() {
  const ua = navigator.userAgent;
  const plat = navigator.userAgentData?.platform ?? navigator.platform ?? '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Windows/i.test(ua) || /Win/i.test(plat)) return 'windows';
  if (/Mac/i.test(ua) || /Mac/i.test(plat)) return 'mac';
  if (/Linux/i.test(ua) || /Linux/i.test(plat)) return 'linux';
  return 'unknown';
}

// The Dawnshift app downloads. Points at this server's /api/download/<slug>,
// which looks up the current GitHub release asset and 302s the browser to it,
// so one click always lands on the newest build.
const APP_DOWNLOADS = [
  { os: 'android', slug: 'android', label: 'Android (APK)',
    detail: 'Download and open the APK; allow "install from this source", then tap Install.' },
  { os: 'windows', slug: 'windows', label: 'Windows (.exe)',
    detail: 'If SmartScreen warns, click "More info" → "Run anyway".' },
  { os: 'mac', slug: 'mac-arm', altSlug: 'mac-intel', altLabel: 'Mac (Intel)', label: 'Mac (Apple chip)',
    detail: 'First launch: right-click the app → Open. Intel Mac? Use the alternate below.' },
  { os: 'linux', slug: 'linux-deb', altSlug: 'linux-appimage', altLabel: 'Linux (.AppImage)', label: 'Linux (.deb)',
    detail: 'Ubuntu, Debian, Mint, Pop!_OS: the .deb. Everything else: the AppImage below.' },
  { os: 'ios', slug: null, label: 'iPhone / iPad',
    detail: 'No App Store build yet. In Safari, tap Share → Add to Home Screen to install this site as an app.' },
];

function downloadAppBlock() {
  const you = detectOs();
  const primary = APP_DOWNLOADS.find((d) => d.os === you);
  const others = APP_DOWNLOADS.filter((d) => d.os !== you && d.os !== 'ios');
  const link = (slug, label, big) => h('a', {
    class: `button${big ? ' primary' : ''}`,
    href: `/api/download/${slug}`,
    target: '_blank',
    rel: 'noopener',
  }, big ? `Download Dawnshift for ${label}` : label);
  return [
    h('h2', {}, 'Get the Dawnshift app'),
    h('p', { class: 'hint' }, 'The website updates itself (that banner at the top). The installable app is handy on phones and for a dock icon on a computer; tap this any time to grab the newest build.'),
    primary && primary.slug
      ? h('div', {},
          link(primary.slug, primary.label, true),
          primary.altSlug ? h('a', { class: 'button', style: 'margin-left:0.5rem', href: `/api/download/${primary.altSlug}`, target: '_blank', rel: 'noopener' }, primary.altLabel) : null,
          h('p', { class: 'hint', style: 'margin-top:0.5rem' }, primary.detail))
      : primary
        ? h('p', { class: 'hint' }, primary.detail)
        : null,
    h('p', { class: 'hint', style: 'margin-top:1rem' }, 'Other systems:'),
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      ...others.flatMap((d) => [
        link(d.slug, d.label, false),
        d.altSlug ? link(d.altSlug, d.altLabel, false) : null,
      ].filter(Boolean))),
  ];
}

function notifyBlock() {
  const wrap = h('div', {});
  function draw() {
    const s = notify.state();
    const turnOn = h('button', { class: 'primary', onclick: async (e) => {
      const res = await notify.enable();
      if (res === 'blocked') toast("Your browser is blocking notifications for this site. Allow them in the site's permissions, then try again.", true);
      else if (res === 'ask') toast('You need to allow notifications when the browser asks.', true);
      draw();
    } }, 'Turn on notifications');
    const turnOff = h('button', { onclick: () => { notify.disable(); draw(); toast('Notifications off.'); } }, 'Turn off');
    const test = h('button', { onclick: () => notify.notify('Dawnshift', "That's what a notification will look like.", { tag: 'test' }) }, 'Send a test');
    const body = s === 'unsupported' ? h('p', { class: 'hint' }, "This browser doesn't support notifications.")
      : s === 'blocked' ? h('p', { class: 'hint' }, "Your browser is blocking notifications for this site. Allow them in the site's permissions, then come back here.")
      : s === 'on' ? h('div', {}, h('p', { class: 'hint' }, 'Dawnshift will ping you when a bot needs you, or finishes something big. Only while you have the site open or installed.'), h('div', { class: 'row' }, turnOff, test))
      : h('div', {}, h('p', { class: 'hint' }, 'Get a browser notification when a bot needs you to answer or approve something. Nothing goes outside this browser.'), turnOn);
    fill(wrap, h('h2', {}, 'Notifications'), body);
  }
  draw();
  return wrap;
}

function mountSettings(main) {
  const name = h('input', { placeholder: 'NAME, e.g. SHOPIFY_TOKEN', 'aria-label': 'Key name' });
  const value = h('input', { type: 'password', placeholder: 'Value', 'aria-label': 'Key value', autocomplete: 'off' });
  const keyUrl = h('input', { placeholder: 'Website it\'s for, e.g. https://crafty.example.com', 'aria-label': 'Website the key is for' });
  const keyNote = h('input', { placeholder: 'How bots should use it (optional), e.g. GET /api/v2/servers with header Authorization: Bearer {{NAME}}', 'aria-label': 'How bots should use the key' });
  const add = h('button', { type: 'submit' }, 'Add key');
  main.append(h('div', { class: 'page' },
    h('h1', {}, 'Settings'),
    h('p', { class: 'lede' }, 'Your team, API keys and files live on your Dawnshift account, so they follow you to every device. Keys are only ever sent to the AI service they belong to.'),
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
          attempt(async () => {
            await api('POST', '/api/secrets', { name: name.value, value: value.value, url: keyUrl.value, note: keyNote.value });
            name.value = ''; value.value = ''; keyUrl.value = ''; keyNote.value = '';
            await refresh();
          }, add);
        },
      }, h('div', { class: 'grow' }, name), h('div', { class: 'grow' }, value),
        h('div', { style: 'flex-basis:100%' }, keyUrl), h('div', { style: 'flex-basis:100%' }, keyNote), add)),
    trustedHostsBlock(),
    h('section', { class: 'block' }, notifyBlock()),
    h('section', { class: 'block' }, ...downloadAppBlock()),
    h('section', { class: 'block' },
      h('h2', {}, 'About'),
      h('p', { class: 'hint' }, 'Made by OliverZS2005, built with help from Claude, an AI by Anthropic.'),
      h('p', { class: 'hint' }, 'Version 0.1.5'),
      h('p', { class: 'hint' }, 'Dawnshift works with AI services from Anthropic and other companies but isn\'t made, endorsed or sponsored by any of them.'),
      h('div', { class: 'row' },
        h('a', { class: 'button', href: 'terms.html' }, 'Terms of Service'),
        h('a', { class: 'button', href: 'privacy.html' }, 'Privacy Policy'),
        h('a', { class: 'button', href: 'licenses.html' }, 'Open-source licenses'))),
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
      ? S.secretNames.map((n) => {
          // Bots with web API access that may use this key.
          const users = S.bots.filter((b) => b.abilities.includes('http_request') && (!Array.isArray(b.appKeys) || b.appKeys.includes(n))).map((b) => b.name);
          const info = S.secretInfo?.[n] ?? {};
          const where = info.url
            ? `Only sent to ${info.url}${info.learned ? ' (locked to the first website it worked with)' : ''}`
            : 'Not locked to a website yet: it locks to the first one it works with. Set it now to be safe.';
          return h('div', { class: 'list-item' },
            h('div', { class: 'grow' }, h('code', {}, `{{${n}}}`),
              h('div', { class: 'meta' }, users.length ? `Used by ${users.join(', ')}` : 'No bot can use this yet. Tick it in a bot\'s settings.'),
              h('div', { class: 'meta' }, where),
              info.note ? h('div', { class: 'meta' }, `How to use: ${info.note}`) : null),
            h('button', { onclick: (e) => {
              const url = prompt(`Website ${n} may be sent to (leave empty to unlock):`, info.url ?? '');
              if (url === null) return;
              const note = prompt(`How bots should use ${n} (optional):`, info.note ?? '');
              if (note === null) return;
              attempt(async () => { await api('PUT', `/api/secrets/${encodeURIComponent(n)}`, { url, note }); await refresh(); }, e.currentTarget);
            } }, 'Edit'),
            h('button', { class: 'danger', onclick: (e) => {
              if (!confirm(`Remove the app key ${n}? Bots that use it will stop working with that app.`)) return;
              attempt(async () => { await api('DELETE', `/api/secrets/${encodeURIComponent(n)}`); await refresh(); }, e.currentTarget);
            } }, 'Remove'));
        })
      : [h('p', { class: 'hint' }, 'No app keys yet.')]));
  renderTrustedHosts();
}

// The user's own servers (Proxmox, Crafty, a NAS) use self-signed HTTPS
// certificates, which bots would otherwise refuse.
function trustedHostsBlock() {
  const host = h('input', { placeholder: 'e.g. 192.168.1.20 or proxmox.home', 'aria-label': 'Server name or IP address' });
  const add = h('button', { class: 'primary', type: 'submit' }, 'Add');
  return h('section', { class: 'block' },
    h('h2', {}, 'Your own servers'),
    h('p', { class: 'hint' }, 'Home servers like Proxmox, Crafty or a NAS often use a self-signed certificate, so bots can\'t verify them and fail with a certificate error. Add the server here and bots will accept its certificate. Only add servers you own.'),
    h('p', { class: 'hint', id: 'home-network-note' }),
    h('div', { class: 'list', id: 'trusted-list' }),
    h('form', {
      class: 'row',
      style: 'margin-top:1rem',
      onsubmit: (e) => {
        e.preventDefault();
        attempt(async () => { await api('POST', '/api/trusted-hosts', { host: host.value }); host.value = ''; await refresh(); }, add);
      },
    }, h('div', { class: 'grow' }, host), add));
}

function renderTrustedHosts() {
  const list = document.getElementById('trusted-list');
  if (!list) return;
  const hosts = S.trustedHosts ?? [];
  const note = document.getElementById('home-network-note');
  if (note) note.textContent = S.homeNetwork === false
    ? 'Your account\'s bots can only reach the public internet on this server. Home network addresses (like 192.168.x.x) are only for the server\'s owner, set in owners.txt on the server.'
    : 'Your bots can reach your home network from this server.';
  fill(list, ...(hosts.length
    ? hosts.map((n) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' }, h('code', {}, n)),
        h('button', { class: 'danger', onclick: (e) => {
          if (!confirm(`Stop trusting ${n}'s own certificate?`)) return;
          attempt(async () => { await api('DELETE', `/api/trusted-hosts/${encodeURIComponent(n)}`); await refresh(); }, e.currentTarget);
        } }, 'Remove')))
    : [h('p', { class: 'hint' }, 'None yet.')]));
}

// ---------- account (hosted) ----------

// Talks to /api/account/*. One account powers every device the user logs in
// on. The server holds everything; this page just carries a login token.
function serverSync() {
  const listeners = new Set();
  const status = { available: true, checked: true, loggedIn: Boolean(token), username: '', state: token ? 'synced' : 'idle', message: '', lastSynced: null };
  const emit = () => { for (const fn of listeners) fn({ ...status }); };
  const set = (patch) => { Object.assign(status, patch); emit(); };

  const after = (data) => {
    setToken(data.token);
    set({ loggedIn: true, username: data.username, state: 'synced', lastSynced: new Date().toISOString() });
    return data;
  };

  // Verify the saved token on load, so a revoked session doesn't look alive.
  if (token) {
    api('GET', '/api/account').then(
      ({ username }) => set({ loggedIn: true, username }),
      () => { setToken(null); set({ loggedIn: false, username: '', state: 'idle' }); },
    );
  }

  return {
    onStatus(fn) { listeners.add(fn); fn({ ...status }); return () => listeners.delete(fn); },
    getStatus: () => ({ ...status }),
    checkAvailable: async () => true,
    syncNow: async () => refresh(true),

    async signup(username, password) {
      const data = await api('POST', '/api/account/signup', { username, password });
      after(data);
      return data.recoveryCode;
    },
    async login(username, password) {
      after(await api('POST', '/api/account/login', { username, password }));
    },
    async recover(username, recoveryCode, newPassword) {
      after(await api('POST', '/api/account/recover', { username, recoveryCode, newPassword }));
    },
    async changePassword(currentPassword, newPassword) {
      await api('POST', '/api/account/password', { currentPassword, newPassword });
    },
    async logout() {
      try { await api('POST', '/api/account/logout'); } catch {}
      setToken(null);
      location.reload();
    },
    async deleteAccount(password) {
      await api('POST', '/api/account/delete', { password });
      setToken(null);
      location.reload();
    },
  };
}

const sync = serverSync();
let syncStatus = sync.getStatus();

function syncLabel(st) {
  if (st.state === 'syncing') return 'Syncing…';
  if (st.state === 'offline') return 'Offline. Will sync when you are back online.';
  if (st.state === 'error') return `Sync problem: ${st.message}`;
  if (st.lastSynced) return `Synced ${ago(st.lastSynced)}`;
  return 'Not synced yet';
}

function field(label, attrs) {
  const input = h('input', { required: true, ...attrs });
  return { input, el: h('div', { class: 'field' }, h('label', { for: attrs.id }, label), input) };
}

function mountAccount(main) {
  const page = h('div', { class: 'page account', id: 'account-page' });
  main.append(page);
  let shownFor = null;
  const draw = (st) => {
    if (!document.body.contains(page)) return;
    const key = !st.available ? `none:${Boolean(st.checked)}` : st.loggedIn ? `in:${st.username}` : 'out';
    if (key !== shownFor && !page.dataset.busy) {
      shownFor = key;
      fill(page, ...(!st.available ? accountUnavailable() : st.loggedIn ? accountPanel() : loginPanel(ui.accountMode)));
    }
    const line = page.querySelector('#sync-line');
    if (line) line.textContent = syncLabel(st);
  };
  const stop = sync?.onStatus(draw);
  if (!sync) draw({ available: false });
  // Stop listening once another page is shown.
  new MutationObserver((_, obs) => {
    if (!document.body.contains(page)) {
      stop?.();
      obs.disconnect();
    }
  }).observe(main, { childList: true });
}

function accountUnavailable() {
  // In the hosted model /api/account always answers. If we land here it means
  // the request failed, so send the user back through a browser reload.
  return [
    h('h1', {}, 'Accounts aren\'t reachable right now'),
    h('p', { class: 'lede' }, 'Dawnshift\'s server isn\'t answering. Check your internet connection and try again.'),
    h('button', { onclick: () => location.reload() }, 'Try again'),
  ];
}

function loginPanel(mode) {
  const page = document.getElementById('account-page');
  const redraw = (m) => {
    ui.accountMode = m;
    fill(page, ...loginPanel(m));
  };
  const user = field('Username', { id: 'acc-user', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, minlength: 3, maxlength: 32 });
  const pass = field(mode === 'recover' ? 'New password' : 'Password', {
    id: 'acc-pass', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', minlength: mode === 'login' ? 1 : 8,
  });
  const confirmPass = field('Type the password again', { id: 'acc-pass2', type: 'password', autocomplete: 'new-password' });
  const code = field('Recovery code', { id: 'acc-code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'ABCD-EFGH-…' });
  const agree = h('input', { type: 'checkbox', required: true });
  const submit = h('button', { class: 'primary', type: 'submit' }, { login: 'Log in', signup: 'Create account', recover: 'Set new password and log in' }[mode]);

  const form = h('form', {
    class: 'account-form',
    onsubmit: (e) => {
      e.preventDefault();
      if (mode === 'signup' && pass.input.value !== confirmPass.input.value) return toast('The two passwords are different.', true);
      page.dataset.busy = '1';
      submit.textContent = 'Working… (this takes a moment)';
      let showingCode = false;
      attempt(async () => {
        try {
          const name = user.input.value.trim();
          if (mode === 'login') {
            await sync.login(name, pass.input.value);
            buddy.nod(`Welcome back, ${name}!`);
          } else if (mode === 'recover') {
            await sync.recover(name, code.input.value, pass.input.value);
            buddy.nod('New password set. Welcome back!');
          } else {
            const recoveryCode = await sync.signup(name, pass.input.value);
            showingCode = true;
            fill(page, ...recoveryScreen(recoveryCode));
            buddy.cheer('Account created!');
            return;
          }
          delete page.dataset.busy;
          await refresh(true);
          go(S.bots.length ? 'team' : 'welcome');
        } finally {
          // The recovery code screen stays up until the user confirms it's saved.
          if (!showingCode) delete page.dataset.busy;
          submit.textContent = { login: 'Log in', signup: 'Create account', recover: 'Set new password and log in' }[mode];
        }
      }, submit);
    },
  },
  user.el,
  mode === 'recover' ? code.el : null,
  pass.el,
  mode === 'signup' ? confirmPass.el : null,
  mode === 'signup'
    ? h('label', { class: 'check' }, agree, h('span', {}, 'I agree to the ', h('a', { href: 'terms.html', target: '_blank' }, 'Terms of Service'), ' and ', h('a', { href: 'privacy.html', target: '_blank' }, 'Privacy Policy'), '.'))
    : null,
  h('div', { class: 'row', style: 'margin-top:0.5rem' }, submit));

  const link = (label, m) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); redraw(m); } }, label);
  return [
    h('h1', {}, { login: 'Log in', signup: 'Create an account', recover: 'Forgot your password?' }[mode]),
    h('p', { class: 'lede' }, mode === 'recover'
      ? 'Use the recovery code you saved when you created your account to choose a new password.'
      : 'Your team, AI keys and files live on your account, so they follow you to every phone and computer you log in on, and your bots keep working while you\'re away.'),
    form,
    h('p', { class: 'account-links' },
      mode !== 'login' ? link('Log in instead', 'login') : link('Create an account', 'signup'),
      mode !== 'recover' ? [' · ', link('Forgot password?', 'recover')] : null),
    mode === 'signup'
      ? h('p', { class: 'hint' }, "There's no email reset: if you forget your password, only your recovery code can get you back in. You'll get it on the next screen.")
      : null,
  ];
}

function recoveryScreen(recoveryCode) {
  const page = document.getElementById('account-page');
  page.dataset.busy = '1';
  const saved = h('input', { type: 'checkbox' });
  const done = h('button', { class: 'primary', disabled: true, onclick: async () => {
    delete page.dataset.busy;
    await refresh(true);
    go(S.bots.length ? 'team' : 'welcome');
  } }, 'Continue');
  saved.addEventListener('change', () => (done.disabled = !saved.checked));
  const text = `Dawnshift recovery code for ${syncStatus.username}\n\n${recoveryCode}\n\nUse it at "Forgot password?" if you forget your password. Keep it somewhere safe.\n`;
  return [
    h('h1', {}, 'Save your recovery code'),
    h('p', { class: 'lede' }, "If you forget your password, this code is the only way back into your account. Dawnshift doesn't store your email, so there's no other way to reset it."),
    h('div', { class: 'recovery-code', tabindex: 0 }, recoveryCode),
    h('div', { class: 'row', style: 'margin:1rem 0' },
      h('button', { onclick: () => navigator.clipboard.writeText(recoveryCode).then(() => toast('Copied.'), () => toast("Couldn't copy. Write it down instead.", true)) }, 'Copy'),
      h('button', { onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'dawnshift-recovery-code.txt' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, 'Download')),
    h('label', { class: 'check' }, saved, "I've saved my recovery code somewhere safe"),
    h('div', { class: 'row', style: 'margin-top:1rem' }, done),
  ];
}

function accountPanel() {
  const current = field('Current password', { id: 'acc-cur', type: 'password', autocomplete: 'current-password' });
  const next = field('New password', { id: 'acc-new', type: 'password', autocomplete: 'new-password', minlength: 8 });
  const change = h('button', { type: 'submit' }, 'Change password');
  const delPass = field('Your password', { id: 'acc-del', type: 'password', autocomplete: 'current-password' });
  const del = h('button', { type: 'submit', class: 'danger' }, 'Delete my account');

  return [
    h('h1', {}, syncStatus.username),
    h('p', { class: 'lede', id: 'sync-line' }, syncLabel(syncStatus)),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: (e) => attempt(() => sync.syncNow(), e.currentTarget) }, 'Sync now'),
      h('button', { onclick: () => logoutDialog() }, 'Log out')),
    h('p', { class: 'hint', style: 'margin-top:1rem' },
      'Your team, AI keys, tasks and files sync to every device you log in on. Bots work on whichever device has Dawnshift open, so keep it open on one device at a time to avoid doing the same job twice.'),

    h('section', { class: 'block', style: 'margin-top:2.5rem' },
      h('h2', {}, 'Change password'),
      h('p', { class: 'hint' }, 'Your other devices will be logged out.'),
      h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          attempt(async () => {
            await sync.changePassword(current.input.value, next.input.value);
            current.input.value = next.input.value = '';
            toast('Password changed.');
          }, change);
        },
      }, current.el, next.el, change)),

    h('section', { class: 'block' },
      h('h2', {}, 'Delete account'),
      h('p', { class: 'hint' }, 'Deletes your account and the synced copy of your data from the server. This device keeps its own copy until you log out.'),
      h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          if (!confirm('Delete your account for good? This cannot be undone.')) return;
          attempt(async () => {
            await sync.deleteAccount(delPass.input.value);
            toast('Account deleted.');
          }, del);
        },
      }, delPass.el, del)),
  ];
}

function logoutDialog() {
  const dlg = document.getElementById('dialog');
  const out = (keepData) => attempt(async () => {
    await sync.logout({ keepData });
    dlg.close();
    // Start fresh, so nothing keeps running with the removed data.
    if (!keepData) return location.reload();
    await refresh(true);
    toast('Logged out.');
  });
  fill(dlg, h('form', { method: 'dialog' },
    h('div', { class: 'dialog-head' }, h('h2', {}, 'Log out'), h('button', { class: 'quiet', value: 'cancel' }, 'Close')),
    h('p', {}, 'Remove your Dawnshift data (including your AI keys) from this device? Your account keeps its copy, so you get everything back when you log in again.'),
    h('div', { class: 'dialog-foot' },
      h('button', { type: 'button', onclick: () => out(true) }, 'Log out, keep data here'),
      h('button', { type: 'button', class: 'primary', onclick: () => out(false) }, 'Log out and remove'))));
  dlg.showModal();
}

// The account button in the top bar.
function openAccount(mode) {
  ui.accountMode = mode;
  go('account');
}

// The Log in / Sign up buttons in the top bar (the username once logged in).
function mountAccountButton() {
  if (!sync) return;
  const box = h('div', { class: 'account-btns' });
  document.querySelector('.topbar').insertBefore(box, document.getElementById('needs-you'));
  sync.onStatus((st) => {
    const wasLoggedIn = syncStatus.loggedIn;
    const changed = st.available !== syncStatus.available || st.loggedIn !== wasLoggedIn || st.checked !== syncStatus.checked;
    syncStatus = st;
    if (changed && S && mounted === 'welcome') render();
    fill(box, st.loggedIn
      ? h('button', { class: 'account-btn', title: syncLabel(st), onclick: () => go('account') }, h('span', { class: `sync-dot ${st.state}` }), st.username)
      : [
          h('button', { class: 'account-btn', onclick: () => openAccount('login') }, 'Log in'),
          h('button', { class: 'account-btn primary', onclick: () => openAccount('signup') }, 'Sign up'),
        ]);
    // Data may have arrived from another device.
    if (st.loggedIn && st.state === 'synced') refresh().catch(() => {});
    if (wasLoggedIn && !st.loggedIn && st.message) toast(st.message, true);
  });
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

mountAccountButton();

// Boot: if not logged in, show the account screen. Once logged in (now or
// after signup/login), fetch state and start polling.
let polling = false;
// ---------- the one rule ----------

// Before any of the app renders, ask the user to agree to one short waiver.
// Stored per-device in localStorage; bumping WAIVER_VERSION makes everyone
// agree again (change it when the text itself changes).
const WAIVER_VERSION = 2;
const WAIVER_KEY = `dawnshift-waiver-v${WAIVER_VERSION}`;

function waiver() {
  try { if (localStorage.getItem(WAIVER_KEY)) return Promise.resolve(); } catch {}
  return new Promise((resolve) => {
    const agree = h('button', { class: 'primary' }, 'I agree — let me in');
    const card = h('div', { class: 'waiver-card' },
      h('h1', {}, 'Before you start'),
      h('p', {}, "Dawnshift is a one-person hobby project. It's free, it's rough around the edges, and it comes with no promises."),
      h('p', { class: 'hint' }, "By tapping I agree you're saying:"),
      h('ul', {},
        h('li', {}, "As far as the law allows, you won't hold the maker (OliverZS2005) or anyone involved responsible for anything that goes wrong — lost data, missed deadlines, wrong answers from the bots, AI bills you rack up, legal trouble from how you use it, or anything else."),
        h('li', {}, "You're only using it to do things you're allowed to do."),
        h('li', {}, "You use it as-is, at your own risk."),
        h('li', {}, 'You agree to the ', h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, 'Terms of Service'), ' and ', h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Policy'), '. Your account\'s data is stored on Dawnshift\'s server.')),
      h('p', { class: 'hint' }, 'If you don\'t agree, just close this tab.'),
      h('div', { class: 'row' }, agree));
    const overlay = h('div', { class: 'waiver-overlay', role: 'dialog', 'aria-modal': 'true' }, card);
    agree.addEventListener('click', () => {
      try { localStorage.setItem(WAIVER_KEY, new Date().toISOString()); } catch {}
      overlay.remove();
      resolve();
    });
    document.body.append(overlay);
    agree.focus();
  });
}

async function boot() {
  await waiver();
  if (!syncStatus.loggedIn) {
    // Stub so render() can mount the account view before /api/state is loaded.
    S ??= { version: 0, connections: [], bots: [], tasks: [], board: [], secretNames: [], presets: {}, workspacePath: '' };
    ui.view = 'account';
    render();
    return;
  }
  try { await refresh(true); } catch (err) { toast(err.message, true); }
  if (polling) return;
  polling = true;
  setTimeout(poll, 1500);
}

sync.onStatus((st) => {
  syncStatus = st;
  if (st.loggedIn && !polling) boot();
});

boot();

// ---------- service worker + update banner ----------

// Keeps a copy of Dawnshift's own files for fast reloads and PWA installs. When
// the server ships a new build, the new service worker sits in "waiting" until
// the user clicks Reload in the banner below.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const show = (sw) => showUpdateBanner(() => sw.postMessage({ type: 'skip-waiting' }));
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) show(sw);
      });
    });
    // Poll for new deploys every 15 minutes while the tab stays open.
    setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
  }).catch(() => {});

  // When the new SW takes over, swap in its content with a reload.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBanner(onReload) {
  let el = document.getElementById('update-banner');
  if (el) return;
  el = h('div', { id: 'update-banner', role: 'status' },
    h('span', {}, 'A new version of Dawnshift is ready.'),
    h('button', { class: 'primary', onclick: () => { el.remove(); onReload(); } }, 'Reload'),
    h('button', { class: 'quiet', 'aria-label': 'Dismiss', onclick: () => el.remove() }, '✕'));
  document.body.append(el);
}
