// The tools a bot can use. Each tool gets the call's arguments plus a context
// ({ store, bot, task, pending, runner }) and returns either
//   { content, isError? }  - the result the bot sees, or
//   { pause: {...} }       - stop the task until a human or teammate responds.
import { newId } from './store-common.js';

const MAX_FETCH_CHARS = 20000;
const MAX_FILE_CHARS = 50000;
const MAX_MEMORY = 60;
const MAX_DELEGATION_DEPTH = 3;

// Dawnshift's own address. Bots may not call it: a web page could otherwise
// trick a bot into changing its own settings.
let ownPort = null;
export function setOwnPort(port) {
  ownPort = String(port);
}

function checkUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs are allowed.');
  const local = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname);
  if (local && ownPort && (u.port || (u.protocol === 'https:' ? '443' : '80')) === ownPort) {
    throw new Error("Bots can't call Dawnshift itself.");
  }
}

// Like fetch, but explains the most common failure in the web version:
// browsers only let a page read other websites that explicitly allow it.
async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (typeof window !== 'undefined' && err instanceof TypeError) {
      throw new Error(`Couldn't read ${url.host} from the web version. Many websites block that for browser security. The downloadable version of Dawnshift can read them.`);
    }
    throw err;
  }
}

// The app keys a bot may use: the ones picked in its settings, or all of
// them for bots that never had that setting.
export function allowedSecrets(bot, secrets) {
  if (!Array.isArray(bot?.appKeys)) return secrets;
  return Object.fromEntries(Object.entries(secrets).filter(([name]) => bot.appKeys.includes(name)));
}

// Replaces {{NAME}} with a saved app key. The bot only ever sees the name.
export function fillSecrets(text, secrets) {
  return String(text ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name) => {
    if (!(name in secrets)) throw new Error(`No app key named ${name} is available to this bot. Add it in Settings → App keys, then tick it in this bot's settings.`);
    return secrets[name];
  });
}

function hideSecrets(text, secrets) {
  let out = String(text);
  for (const value of Object.values(secrets)) {
    if (value && value.length >= 4) out = out.split(value).join('[hidden]');
  }
  return out;
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n\n[Cut off: showing ${max} of ${text.length} characters.]` : text;
}

const str = (description) => ({ type: 'string', description });
const schema = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS = [
  {
    name: 'ask_human',
    label: 'Ask the human a question',
    description:
      'Ask your human manager a question and wait for the answer. Use this when you need information, a decision, or a login that only they can give.',
    parameters: schema({ question: str('The question, written so it can be answered without other context.') }),
    always: true,
    async run({ question }, { pending }) {
      if (pending?.kind === 'input' && 'answer' in pending) {
        return { content: `The human answered: ${pending.answer}` };
      }
      return { pause: { kind: 'input', question: String(question) } };
    },
  },
  {
    name: 'remember',
    label: 'Save notes to memory',
    description:
      'Save a fact to your long-term memory (preferences, contacts, decisions, how things are done). Your memory is shown to you at the start of every task.',
    parameters: schema({ note: str('One short, self-contained fact.') }),
    always: true,
    async run({ note }, { bot }) {
      bot.memory ??= [];
      bot.memory.push(String(note).slice(0, 500));
      bot.updatedAt = new Date().toISOString();
      if (bot.memory.length > MAX_MEMORY) bot.memory.splice(0, bot.memory.length - MAX_MEMORY);
      return { content: 'Saved to memory.' };
    },
  },
  {
    name: 'list_team',
    label: 'See the team',
    description: 'List your coworkers and what each one does.',
    parameters: schema({}),
    always: true,
    async run(_args, { store, bot }) {
      const lines = store.state.bots.map(
        (b) => `- ${b.name}${b.id === bot.id ? ' (you)' : ''}: ${b.job.split('\n')[0]}`,
      );
      return { content: lines.join('\n') || 'No coworkers yet.' };
    },
  },
  {
    name: 'read_team_board',
    label: 'Read the team board',
    description: 'Read the latest posts on the shared team board, where coworkers leave updates and context for each other.',
    parameters: schema({}),
    always: true,
    async run(_args, { store }) {
      const posts = store.state.board.slice(-30);
      if (!posts.length) return { content: 'The team board is empty.' };
      return { content: posts.map((p) => `[${p.at.slice(0, 16).replace('T', ' ')}] ${p.author}: ${p.message}`).join('\n') };
    },
  },
  {
    name: 'post_to_team_board',
    label: 'Post to the team board',
    description: 'Post an update or piece of context to the shared team board so coworkers and the human can see it.',
    parameters: schema({ message: str('What to post.') }),
    always: true,
    async run({ message }, { store, bot }) {
      store.state.board.push({ id: newId('post'), author: bot.name, message: String(message).slice(0, 4000), at: new Date().toISOString() });
      if (store.state.board.length > 500) store.state.board.splice(0, store.state.board.length - 500);
      return { content: 'Posted.' };
    },
  },
  {
    name: 'delegate_task',
    label: 'Hand work to coworkers',
    description:
      'Give a task to a coworker and wait for their result. Write instructions they can act on without seeing your conversation.',
    parameters: schema({
      coworker: str('The coworker\'s name, exactly as listed by list_team.'),
      title: str('A short title for the task.'),
      instructions: str('Everything they need to do the job well.'),
    }),
    async run({ coworker, title, instructions }, { store, bot, task, pending, runner }) {
      if (pending?.kind === 'subtask') {
        const sub = store.task(pending.subtaskId);
        if (!sub) return { content: 'That task was deleted.', isError: true };
        if (sub.status === 'done') return { content: `${sub.botName} finished "${sub.title}":\n\n${sub.result}` };
        if (sub.status === 'failed') return { content: `${sub.botName} could not finish "${sub.title}": ${sub.error}`, isError: true };
        if (sub.status === 'cancelled') return { content: `The human cancelled "${sub.title}".`, isError: true };
        return { pause: pending };
      }
      const target = store.state.bots.find((b) => b.name.toLowerCase() === String(coworker).trim().toLowerCase());
      if (!target) return { content: `No coworker named "${coworker}". Use list_team to see names.`, isError: true };
      if (target.id === bot.id) return { content: 'You can\'t delegate to yourself.', isError: true };
      if ((task.depth ?? 0) >= MAX_DELEGATION_DEPTH) {
        return { content: 'This work has been handed down too many times already. Do it yourself.', isError: true };
      }
      const sub = runner.createTask({
        botId: target.id,
        title: String(title),
        instructions: String(instructions),
        from: bot.name,
        parentId: task.id,
        depth: (task.depth ?? 0) + 1,
      });
      return { pause: { kind: 'subtask', subtaskId: sub.id, coworker: target.name } };
    },
  },
  {
    name: 'web_fetch',
    label: 'Read web pages',
    description: 'Download a web page (or any URL) and return its text.',
    parameters: schema({ url: str('The full http(s) URL.') }),
    async run({ url }) {
      const u = new URL(String(url));
      checkUrl(u);
      const res = await request(u, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Dawnshift/0.1' } });
      const type = res.headers.get('content-type') || '';
      let body = await res.text();
      if (type.includes('html')) body = htmlToText(body);
      return { content: clip(`HTTP ${res.status} ${u.href}\n\n${body}`, MAX_FETCH_CHARS), isError: !res.ok };
    },
  },
  {
    name: 'http_request',
    label: 'Use web APIs (your apps)',
    description:
      'Call a web API, e.g. to use one of the human\'s apps. Write {{KEY_NAME}} anywhere in the URL, headers or body to insert a saved app key; you never see the value. Ask the human which keys exist if unsure.',
    parameters: schema(
      {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        url: str('The full URL.'),
        headers: { type: 'object', description: 'Request headers.', additionalProperties: { type: 'string' } },
        body: str('Request body, usually JSON text.'),
      },
      ['method', 'url'],
    ),
    // Reading is harmless; anything that changes data needs a human's OK.
    risky: (args) => String(args.method || 'GET').toUpperCase() !== 'GET',
    async run({ method = 'GET', url, headers = {}, body }, { store, bot }) {
      const all = store.state.secrets;
      const secrets = allowedSecrets(bot, all);
      const u = new URL(fillSecrets(url, secrets));
      checkUrl(u);
      const h = {};
      for (const [k, v] of Object.entries(headers ?? {})) h[k] = fillSecrets(v, secrets);
      const res = await request(u, {
        method: String(method).toUpperCase(),
        headers: h,
        body: body == null || method === 'GET' ? undefined : fillSecrets(body, secrets),
        signal: AbortSignal.timeout(30000),
      });
      const text = hideSecrets(await res.text(), all);
      return { content: clip(`HTTP ${res.status}\n\n${text}`, MAX_FETCH_CHARS), isError: !res.ok };
    },
  },
  {
    name: 'list_files',
    label: 'Read workspace files',
    description: 'List the files in a folder of the shared workspace.',
    parameters: schema({ folder: str('Folder inside the workspace. Use "." for the top.') }, []),
    group: 'files',
    async run({ folder = '.' }, { store }) {
      const names = await store.files.list(folder);
      if (!names) return { content: `No folder called "${folder}".`, isError: true };
      if (!names.length) return { content: 'The folder is empty.' };
      return { content: names.join('\n') };
    },
  },
  {
    name: 'read_file',
    label: 'Read workspace files',
    description: 'Read a text file from the shared workspace.',
    parameters: schema({ path: str('File path inside the workspace.') }),
    group: 'files',
    async run({ path: p }, { store }) {
      return { content: clip(await store.files.read(p), MAX_FILE_CHARS) };
    },
  },
  {
    name: 'write_file',
    label: 'Write workspace files',
    description: 'Create or overwrite a text file in the shared workspace (reports, drafts, spreadsheets as CSV, etc.).',
    parameters: schema({ path: str('File path inside the workspace.'), content: str('The full file contents.') }),
    risky: () => true,
    async run({ path: p, content }, { store }) {
      await store.files.write(p, String(content ?? ''));
      return { content: `Wrote ${String(content ?? '').length} characters to ${p}.` };
    },
  },
];

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// The optional abilities a bot can be given in its settings.
export const ABILITIES = [
  { id: 'delegate_task', label: 'Hand work to coworkers (team lead)' },
  { id: 'web_fetch', label: 'Read web pages' },
  { id: 'http_request', label: 'Use web APIs with your app keys' },
  { id: 'files', label: 'Read workspace files' },
  { id: 'write_file', label: 'Write workspace files' },
];

export function toolsFor(bot) {
  const on = new Set(bot.abilities ?? []);
  return TOOLS.filter((t) => t.always || on.has(t.group ?? t.name));
}

export function needsApproval(bot, tool, args) {
  if (tool.always) return false;
  if (bot.approvals === 'never') return false;
  if (bot.approvals === 'always') return true;
  return Boolean(tool.risky?.(args));
}

// One line shown to the human when a bot asks for approval.
export function describeCall(name, args) {
  switch (name) {
    case 'write_file':
      return `Write the file "${args.path}" (${String(args.content ?? '').length} characters)`;
    case 'http_request':
      return `${String(args.method || 'GET').toUpperCase()} ${args.url}`;
    case 'web_fetch':
      return `Open ${args.url}`;
    case 'delegate_task':
      return `Give "${args.title}" to ${args.coworker}`;
    default:
      return `${name} ${JSON.stringify(args)}`;
  }
}
