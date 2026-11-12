// Runs the bots' tasks in the background.
//
// A task is a conversation between a bot and the AI model it uses. It moves
// through these statuses:
//   queued -> running -> done | failed | cancelled
//                    \-> needs_you (waiting on an approval or an answer)
//                    \-> waiting   (waiting on a coworker's task)
// Everything is saved after each step, so a task picks up where it left off
// even if Dawnshift is restarted.
import { newId } from './store-common.js';
import { coreRulesText, hasCoreRules } from './core-rules.js';
import { TOOLS_BY_NAME, toolsFor, needsApproval, describeCall, allowedSecrets, discordWebhooks } from './tools.js';

const MAX_STEPS = 40;
const ACTIVE = new Set(['queued', 'running', 'needs_you', 'waiting']);

// A mistake in what was asked (as opposed to a crash).
function requestError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function buildSystemPrompt(store, bot) {
  const team = store.state.bots
    .map((b) => `- ${b.name}${b.id === bot.id ? ' (you)' : ''}: ${b.job.split('\n')[0]}`)
    .join('\n');
  const memory = (bot.memory ?? []).map((m, i) => `${i + 1}. ${m}`).join('\n');
  const canDelegate = (bot.abilities ?? []).includes('delegate_task');
  const keyNames = (bot.abilities ?? []).includes('http_request') ? Object.keys(allowedSecrets(bot, store.state.secrets ?? {})) : [];
  return [
    `You are ${bot.name}, an AI coworker on a small team that works for one human (your manager).`,
    hasCoreRules(bot) ? coreRulesText() : '',
    `Your job:\n${bot.job}`,
    `How you work:
- Tasks come from the human or from coworkers. Do the work with your tools, then finish with a reply that contains the finished result. That final reply is what gets delivered, so make it complete and easy to act on.
- Use ask_human only when you truly need something only the human can give: a decision, missing information, or access. Actions that need approval are held for the human automatically, so don't ask permission separately.
- Use remember to save lasting facts (preferences, contacts, decisions, how things are done) so you know them next time.
- Read the team board for context and post updates your coworkers would need.`,
    canDelegate
      ? `You lead the team. Split big jobs into pieces, hand each piece to the coworker whose job fits with delegate_task, then combine their results. Do small jobs yourself.`
      : '',
    (bot.abilities ?? []).includes('http_request') && Object.keys(discordWebhooks(bot, store.state.secrets)).length
      ? `To post to Discord, call the send_discord_message tool with the message text. Never just write the message in your reply — actually call the tool.`
      : '',
    keyNames.length ? `App keys you can use in web API calls (write {{NAME}}): ${keyNames.join(', ')}.` : '',
    `The team:\n${team}`,
    memory ? `Your memory:\n${memory}` : 'Your memory is empty so far.',
    `Today is ${new Date().toDateString()}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// What a bot actually checked in a task, written by Dawnshift (not the bot),
// so a small model can't claim "all healthy" without having looked.
const DATA_TOOLS = new Set(['http_request', 'web_fetch']);
const STATUS_WORDS = /\b(healthy|online|offline|running|up and running|is up|are up|is down|are down|no (specific )?issues|all good|working fine|operational)\b/i;

// The data calls one task made: [{ where, ok }].
function checksIn(task) {
  const args = new Map();
  for (const m of task.messages) if (m.role === 'assistant') for (const c of m.toolCalls ?? []) args.set(c.id, c.args ?? {});
  return task.messages
    .filter((m) => m.role === 'tool' && DATA_TOOLS.has(m.name))
    .map((m) => {
      let where = String(args.get(m.callId)?.url ?? '');
      try { where = new URL(where.replace(/\{\{\w+\}\}/g, 'x')).host || where; } catch {}
      return { where: where.replace(/\{\{(\w+)\}\}/g, '$1') || m.name, ok: !m.isError && !/^Error:/.test(m.content) };
    });
}

// tasks: every task, so a lead's note can include what its coworkers checked.
export function evidenceNote(task, tasks = []) {
  const groups = [];
  const walk = (t, depth) => {
    const checks = checksIn(t);
    if (depth === 0 || checks.length || STATUS_WORDS.test(t.result ?? '')) groups.push({ t, depth, checks });
    for (const sub of tasks.filter((x) => x.parentId === t.id)) walk(sub, depth + 1);
  };
  walk(task, 0);
  const all = groups.flatMap((g) => g.checks);
  const reply = task.messages.at(-1)?.text ?? '';
  const warn = STATUS_WORDS.test(reply) && !all.some((c) => c.ok)
    ? `⚠️ Dawnshift check: ${groups.length > 1 ? 'neither this bot nor the coworkers it asked' : 'this bot'} made any successful web or API calls, so any status above is unverified.`
    : '';
  const lines = [];
  for (const g of groups) {
    if (!g.checks.length && g.depth === 0) continue;
    const who = g.depth === 0 ? '' : `${g.t.botName ?? 'Coworker'}: `;
    if (!g.checks.length) lines.push(`${who}no calls made`);
    else for (const c of g.checks) lines.push(`${who}${c.ok ? '✓' : '✗'} ${c.where}`);
  }
  if (!lines.length && !warn) return '';
  return `\n\n---\n${warn}${warn && lines.length ? '\n' : ''}${lines.length ? `Calls made in this task (checked by Dawnshift):\n${lines.join('\n')}` : ''}`;
}

function unresolvedCalls(task) {
  let i = task.messages.length - 1;
  while (i >= 0 && task.messages[i].role === 'tool') i--;
  const last = task.messages[i];
  if (last?.role !== 'assistant') return [];
  const done = new Set(task.messages.slice(i + 1).map((m) => m.callId));
  return last.toolCalls.filter((c) => !done.has(c.id));
}

export function createRunner({ store, callModel, maxConcurrent = 3, onChange = () => {} }) {
  const running = new Set();
  let pumpScheduled = false;

  const now = () => new Date().toISOString();

  function touch(task) {
    task.updatedAt = now();
    store.save();
    onChange(task);
  }

  function kick() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => {
      pumpScheduled = false;
      pump();
    }, 0);
  }

  function pump() {
    for (const task of store.state.tasks) {
      if (running.size >= maxConcurrent) return;
      if (task.status !== 'queued' || running.has(task.id)) continue;
      // Each bot works on one thing at a time, like a person would.
      const busy = [...running].some((id) => store.task(id)?.botId === task.botId);
      if (busy) continue;
      running.add(task.id);
      work(task)
        .catch((err) => finish(task, 'failed', { error: err.message || String(err) }))
        .finally(() => {
          running.delete(task.id);
          kick();
        });
    }
  }

  function createTask({ botId, title, instructions, from = 'You', parentId = null, depth = 0, routineId = null }) {
    const bot = store.bot(botId);
    if (!bot) throw requestError('No such bot.');
    const task = {
      id: newId('task'),
      botId,
      botName: bot.name,
      title: title || instructions.slice(0, 80),
      from,
      parentId,
      depth,
      routineId,
      status: 'queued',
      messages: [{ role: 'user', content: from === 'You' ? instructions : `Task from ${from}:\n\n${instructions}`, at: now() }],
      pending: null,
      steps: 0,
      usage: { input: 0, output: 0 },
      result: '',
      error: '',
      createdAt: now(),
      updatedAt: now(),
    };
    store.state.tasks.push(task);
    touch(task);
    kick();
    return task;
  }

  function finish(task, status, { result = '', error = '' } = {}) {
    task.status = status;
    task.result = result;
    task.error = error;
    task.pending = status === 'done' ? null : task.pending;
    touch(task);
    // Wake the coworker who was waiting on this task.
    const parent = task.parentId && store.task(task.parentId);
    if (parent?.status === 'waiting' && parent.pending?.subtaskId === task.id) {
      parent.status = 'queued';
      touch(parent);
    }
    kick();
  }

  function addResult(task, call, content, isError = false) {
    task.messages.push({ role: 'tool', callId: call.id, name: call.name, content: String(content), isError, at: now() });
  }

  // Runs one tool call. Returns false if the task has to pause.
  async function resolveCall(task, bot, call) {
    const tool = TOOLS_BY_NAME[call.name];
    const allowed = tool && toolsFor(bot).includes(tool);
    if (!allowed) {
      addResult(task, call, `There is no tool called "${call.name}" available to you.`, true);
      return true;
    }
    if (call.args?.__invalid !== undefined) {
      addResult(task, call, 'The tool arguments were not valid JSON. Try the call again.', true);
      return true;
    }
    const pending = task.pending?.callId === call.id ? task.pending : null;
    if (pending?.kind === 'approval' && pending.denied) {
      task.pending = null;
      addResult(task, call, `The human said no to this action.${pending.note ? ` Their note: ${pending.note}` : ''}`, true);
      return true;
    }
    const approved = pending?.kind === 'approval' && pending.approved;
    // A call that already started (waiting on an answer or a coworker) was
    // either approved before or never needed approval.
    const started = pending && pending.kind !== 'approval';
    if (!approved && !started && needsApproval(bot, tool, call.args)) {
      task.pending = { callId: call.id, kind: 'approval', tool: call.name, summary: describeCall(call.name, call.args), args: call.args };
      task.status = 'needs_you';
      touch(task);
      return false;
    }
    let out;
    try {
      out = await tool.run(call.args, { store, bot, task, pending: approved ? null : pending, runner: api });
    } catch (err) {
      out = { content: `Error: ${err.message}`, isError: true };
    }
    if (out.pause) {
      task.pending = { callId: call.id, ...out.pause };
      task.status = out.pause.kind === 'subtask' ? 'waiting' : 'needs_you';
      touch(task);
      return false;
    }
    task.pending = null;
    addResult(task, call, out.content, out.isError);
    return true;
  }

  async function work(task) {
    const bot = store.bot(task.botId);
    if (!bot) throw new Error('This bot has been removed from the team.');
    task.status = 'running';
    touch(task);

    for (;;) {
      if (task.cancelRequested) return finish(task, 'cancelled');

      const calls = unresolvedCalls(task);
      if (calls.length) {
        for (const call of calls) {
          if (!(await resolveCall(task, bot, call))) return;
        }
        touch(task);
        continue;
      }

      const last = task.messages.at(-1);
      if (last.role === 'assistant') {
        return finish(task, 'done', { result: (last.text || '(The bot finished without writing a reply.)') + evidenceNote(task, store.state.tasks) });
      }
      if (task.steps >= MAX_STEPS) {
        throw new Error(`Stopped after ${MAX_STEPS} steps. Reply to the task to let the bot keep going.`);
      }

      const conn = store.connection(bot.connectionId);
      if (!conn) throw new Error(`${bot.name} isn't connected to an AI. Pick one in the bot's settings.`);
      task.steps++;
      const reply = await callModel(conn, {
        model: bot.model || conn.model,
        system: buildSystemPrompt(store, bot),
        messages: task.messages,
        tools: toolsFor(bot),
      });
      if (task.cancelRequested) return finish(task, 'cancelled');
      task.usage.input += reply.usage?.input ?? 0;
      task.usage.output += reply.usage?.output ?? 0;
      task.servedBy = reply.servedBy;
      task.messages.push({
        role: 'assistant',
        text: reply.truncated ? `${reply.text}\n\n[The reply hit the length limit and was cut off.]` : reply.text,
        toolCalls: reply.toolCalls,
        ...(reply.raw ? { raw: reply.raw } : {}),
        at: now(),
      });
      touch(task);
    }
  }

  function taskOrThrow(id) {
    const task = store.task(id);
    if (!task) throw requestError('No such task.');
    return task;
  }

  // Gives any tool calls that never ran a result, so the conversation stays
  // valid when the human steps in with new instructions.
  function closeOpenCalls(task) {
    for (const call of unresolvedCalls(task)) addResult(task, call, 'This action was not run because the task was stopped.', true);
    task.pending = null;
  }

  const api = {
    createTask,

    // The human approves or declines a held action.
    decide(id, approved, note = '') {
      const task = taskOrThrow(id);
      if (task.status !== 'needs_you' || task.pending?.kind !== 'approval') throw requestError('Nothing is waiting for approval.');
      Object.assign(task.pending, approved ? { approved: true } : { denied: true, note });
      task.status = 'queued';
      touch(task);
      kick();
    },

    // The human answers a bot's question.
    answer(id, text) {
      const task = taskOrThrow(id);
      if (task.status !== 'needs_you' || task.pending?.kind !== 'input') throw requestError('Nothing is waiting for an answer.');
      task.pending.answer = String(text);
      task.status = 'queued';
      touch(task);
      kick();
    },

    // Follow-up instructions on a finished (or failed) task.
    reply(id, text) {
      const task = taskOrThrow(id);
      if (ACTIVE.has(task.status)) throw requestError('The bot is still working on this task.');
      closeOpenCalls(task);
      task.messages.push({ role: 'user', content: String(text), at: now() });
      task.steps = 0;
      task.error = '';
      task.cancelRequested = false;
      task.status = 'queued';
      touch(task);
      kick();
    },

    cancel(id) {
      const task = taskOrThrow(id);
      if (!ACTIVE.has(task.status)) return;
      for (const sub of store.state.tasks) {
        if (sub.parentId === task.id) api.cancel(sub.id);
      }
      if (running.has(task.id)) {
        task.cancelRequested = true;
        touch(task);
      } else {
        finish(task, 'cancelled');
      }
    },

    // Called once at startup: anything that was mid-step when Dawnshift stopped
    // is picked up again, and due routines are scheduled.
    start({ routineIntervalMs = 30000 } = {}) {
      for (const task of store.state.tasks) {
        if (task.status === 'running') task.status = 'queued';
      }
      store.save();
      kick();
      if (routineIntervalMs) {
        const timer = setInterval(api.runDueRoutines, routineIntervalMs);
        timer.unref?.(); // Node only: don't keep the process alive just for this.
      }
    },

    // Routines are recurring jobs, like "every morning, summarize the news".
    runDueRoutines(at = Date.now()) {
      for (const bot of store.state.bots) {
        for (const r of bot.routines ?? []) {
          if (!r.everyMinutes || new Date(r.nextRunAt ?? 0).getTime() > at) continue;
          r.nextRunAt = new Date(at + r.everyMinutes * 60000).toISOString();
          bot.updatedAt = new Date(at).toISOString();
          const stillGoing = store.state.tasks.some((t) => t.routineId === r.id && ACTIVE.has(t.status));
          if (!stillGoing) createTask({ botId: bot.id, title: r.title, instructions: r.instructions, from: 'Routine', routineId: r.id });
        }
      }
      store.save();
    },

    isRunning: (id) => running.has(id),
  };
  return api;
}
