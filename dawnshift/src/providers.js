// Talks to the AI providers. Two protocols cover everything:
//   - "anthropic": Claude, through the official Anthropic SDK.
//   - "openai": the OpenAI chat-completions API, which OpenAI, xAI (Grok),
//     Google Gemini, OpenRouter, Ollama, LM Studio and most others speak.
//
// Conversations are stored in one provider-neutral shape so a bot can be
// moved to a different AI at any time:
//   { role: 'user', content }
//   { role: 'assistant', text, toolCalls: [{ id, name, args }], raw? }
//   { role: 'tool', callId, name, content, isError }
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const PRESETS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    baseUrl: '',
    model: 'claude-opus-5',
    env: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    env: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  xai: {
    label: 'Grok (xAI)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    env: 'XAI_API_KEY',
    keyUrl: 'https://console.x.ai',
  },
  gemini: {
    label: 'Gemini (Google)',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    env: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: {
    label: 'Groq (free tier)',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    env: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter (many models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    env: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    local: true,
  },
  lmstudio: {
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    local: true,
  },
  custom: {
    label: 'Other OpenAI-compatible server',
    kind: 'openai',
    baseUrl: 'http://localhost:8000/v1',
  },
};

// Models that can decline a request through their safety classifiers. For
// these we opt into server-side fallbacks, so a declined request is retried on
// the model Anthropic recommends instead of failing the task.
const FALLBACK_MODELS = new Set([
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
]);

const MAX_TOKENS = 16000;

// In the web version the page talks to the AI services directly. That's safe
// here because each person only ever uses their own key on their own device.
const IN_BROWSER = typeof window !== 'undefined';

export function apiKeyFor(conn) {
  if (conn.apiKey) return conn.apiKey;
  const env = PRESETS[conn.preset]?.env;
  return (env && globalThis.process?.env?.[env]) || '';
}

function anthropicClient(conn) {
  return new Anthropic({
    apiKey: apiKeyFor(conn),
    dangerouslyAllowBrowser: IN_BROWSER,
    ...(conn.baseUrl ? { baseURL: conn.baseUrl } : {}),
  });
}

// Where a host is, as browsers see it: on this device ("loopback"), on the
// home network ("local"), or on the internet (null).
export function addressSpace(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1') return 'loopback';
  if (/^(10\.|192\.168\.|169\.254\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd]/.test(h) || h.endsWith('.local')) return 'local';
  return null;
}

// In the web version, requests to an AI on the user's own computer or home
// network say so up front. Chrome and Edge then ask the user for permission
// ("Allow access to devices on your local network") instead of blocking them
// as insecure. Browsers that don't know the option simply ignore it.
function browserFetch(url, init = {}) {
  const space = addressSpace(new URL(String(url)).hostname);
  return fetch(url, space ? { ...init, targetAddressSpace: space } : init);
}

function openaiClient(conn) {
  // Local servers don't check the key, but the SDK insists on having one.
  return new OpenAI({
    apiKey: apiKeyFor(conn) || 'not-needed',
    baseURL: conn.baseUrl,
    dangerouslyAllowBrowser: IN_BROWSER,
    ...(IN_BROWSER ? { fetch: browserFetch } : {}),
  });
}

// Safari (on iPhone, iPad and Mac) never lets a website reach a server on the
// user's own devices over plain http.
const IS_SAFARI = IN_BROWSER && /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);

export function toAnthropicMessages(messages) {
  const out = [];
  const pushUser = (blocks) => {
    const last = out.at(-1);
    if (last?.role === 'user') last.content.push(...blocks);
    else out.push({ role: 'user', content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      pushUser([{ type: 'text', text: m.content }]);
    } else if (m.role === 'assistant') {
      // Replay Claude's own content blocks unchanged (thinking blocks included)
      // when we have them; otherwise rebuild them from the neutral shape.
      const content =
        m.raw?.kind === 'anthropic'
          ? m.raw.content
          : [
              ...(m.text ? [{ type: 'text', text: m.text }] : []),
              ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
            ];
      if (content.length) out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      // All results for one assistant turn go back in a single user message.
      pushUser([
        {
          type: 'tool_result',
          tool_use_id: m.callId,
          content: m.content,
          ...(m.isError ? { is_error: true } : {}),
        },
      ]);
    }
  }
  return out;
}

export function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
    }
  }
  return out;
}

function parseArgs(json) {
  if (!json) return {};
  try {
    const args = JSON.parse(json);
    return args && typeof args === 'object' ? args : { __invalid: json };
  } catch {
    return { __invalid: json };
  }
}

async function callAnthropic(conn, { model, system, messages, tools }) {
  const client = anthropicClient(conn);
  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: toAnthropicMessages(messages),
    cache_control: { type: 'ephemeral' },
  };
  if (tools.length) {
    params.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  const res = FALLBACK_MODELS.has(model)
    ? await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    : await client.messages.create(params);

  if (res.stop_reason === 'refusal') {
    const why = res.stop_details?.explanation;
    throw new Error(`Claude declined this request${why ? `: ${why}` : '.'}`);
  }
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const toolCalls = res.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  return {
    text,
    toolCalls,
    truncated: res.stop_reason === 'max_tokens',
    raw: { kind: 'anthropic', content: res.content },
    servedBy: res.model,
    usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
  };
}

async function callOpenAI(conn, { model, system, messages, tools }) {
  const client = openaiClient(conn);
  const params = { model, messages: toOpenAIMessages(system, messages) };
  if (tools.length) {
    params.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  let res;
  try {
    res = await client.chat.completions.create(params);
  } catch (err) {
    // Some local models can't use tools at all. Rather than failing, let the
    // bot work as a plain chat model.
    if (!(err instanceof OpenAI.BadRequestError) || !params.tools || !/tool/i.test(err.message)) throw err;
    delete params.tools;
    res = await client.chat.completions.create(params);
  }
  const choice = res.choices?.[0];
  if (!choice) throw new Error('The AI returned an empty response.');
  const msg = choice.message ?? {};
  const toolCalls = (msg.tool_calls ?? [])
    .filter((c) => c.type === 'function' || c.function)
    .map((c) => ({
      id: c.id || `call_${globalThis.crypto.randomUUID()}`,
      name: c.function.name,
      args: parseArgs(c.function.arguments),
    }));
  return {
    text: (msg.content ?? '').trim(),
    toolCalls,
    truncated: choice.finish_reason === 'length',
    servedBy: res.model || model,
    usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
  };
}

export async function callModel(conn, request) {
  if (!request.model) {
    const err = new Error(`Pick a model for the "${conn.name}" connection first.`);
    err.status = 400;
    throw err;
  }
  try {
    return conn.kind === 'anthropic' ? await callAnthropic(conn, request) : await callOpenAI(conn, request);
  } catch (err) {
    throw friendlyError(conn, err);
  }
}

export async function listModels(conn) {
  try {
    const client = conn.kind === 'anthropic' ? anthropicClient(conn) : openaiClient(conn);
    const ids = [];
    for await (const m of client.models.list()) {
      ids.push(m.id);
      if (ids.length >= 300) break;
    }
    return ids.sort();
  } catch (err) {
    throw friendlyError(conn, err);
  }
}

// True if the connection points at the user's own computer or home network.
function isOwnDevice(conn) {
  try {
    return Boolean(addressSpace(new URL(conn.baseUrl).hostname)) || Boolean(PRESETS[conn.preset]?.local);
  } catch {
    return false;
  }
}

function friendlyError(conn, err) {
  const where = conn.baseUrl || 'api.anthropic.com';
  let message = err.message;
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    message = `${conn.name}: the API key was rejected. Check it in Settings.`;
  } else if (IN_BROWSER && isOwnDevice(conn) && (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.PermissionDeniedError)) {
    const name = PRESETS[conn.preset]?.label.replace(' (local)', '') ?? 'the AI server';
    message = IS_SAFARI
      ? `Safari doesn't let websites reach an AI running on your own devices. Use Chrome or Edge on a computer, or the downloadable version of Dawnshift.`
      : `Couldn't reach ${name} at ${where}. Check that it's running, that it allows this website (see "Setup steps" in the connection's settings), and that you clicked Allow if your browser asked about devices on your local network.`;
  } else if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    const name = PRESETS[conn.preset]?.label.replace(' (local)', '');
    message = PRESETS[conn.preset]?.local
      ? `Couldn't reach ${where}. Is ${name} running?`
      : IN_BROWSER
        ? `Couldn't reach ${where}. Check your internet connection. If it keeps happening, this AI service may not allow connections from a web page; try another one or the downloadable version.`
        : `Couldn't reach ${where}. Check your internet connection and the server address.`;
  } else if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    message = `${conn.name} is rate limiting requests right now. Try again in a minute.`;
  } else if (err instanceof Anthropic.NotFoundError || err instanceof OpenAI.NotFoundError) {
    message = `${conn.name}: not found (${err.message}). The model name may be wrong.`;
  }
  const wrapped = new Error(message);
  wrapped.cause = err;
  return wrapped;
}
