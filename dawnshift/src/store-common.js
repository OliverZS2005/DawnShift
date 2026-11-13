// Pieces shared by the two ways Dawnshift saves data: files on a computer
// (store.js) and the browser's own storage (browser-store.js).

export const emptyState = () => ({
  version: 0,
  connections: [],
  bots: [],
  tasks: [],
  board: [],
  secrets: {},
  // Hostnames of the user's own servers (Proxmox, Crafty, a NAS...) whose
  // self-signed HTTPS certificate bots should accept.
  trustedHosts: [],
  // id -> when it was deleted, so syncing devices don't bring it back.
  deleted: {},
});

export const nowIso = () => new Date().toISOString();

// When an item last changed, for deciding which copy is newer.
export const stamp = (item) => Date.parse(item?.updatedAt ?? item?.at ?? item?.createdAt ?? 0) || 0;

export function markDeleted(state, id) {
  state.deleted ??= {};
  state.deleted[id] = Date.now();
}

export function newId(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Turns a workspace path into a clean "folder/file.txt" form, and refuses
// anything that would reach outside the workspace.
export function normalizePath(p = '.') {
  const parts = [];
  for (const part of String(p).split(/[/\\]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw Object.assign(new Error(`"${p}" is outside the workspace folder.`), { status: 400 });
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

// ---------- syncing (see src/sync.js) ----------

// The lists that sync between devices, item by item.
const SYNCED = ['connections', 'bots', 'tasks', 'board'];

// Everything that gets synced, except files, as plain data.
export function syncedState(state) {
  return structuredClone({
    ...Object.fromEntries(SYNCED.map((k) => [k, state[k] ?? []])),
    secrets: state.secrets ?? {},
    deleted: state.deleted ?? {},
  });
}

// Puts merged data into state. Items that already exist are updated in place,
// so a bot that's in the middle of a task keeps working with the same object.
// Anything that changed on this device while the sync was in flight (or that
// keepLocal says to keep) stays as it is. Returns true if this device still
// has changes the merged data doesn't include.
export function mergeIntoState(state, data, keepLocal = () => false) {
  let newerHere = false;
  const deleted = { ...state.deleted, ...data.deleted };
  for (const name of SYNCED) {
    const existing = new Map(state[name].map((item) => [item.id, item]));
    const seen = new Set();
    const next = [];
    for (const item of data[name]) {
      seen.add(item.id);
      const mine = existing.get(item.id);
      if (!mine) next.push(item);
      else if (keepLocal(item.id) || stamp(mine) > stamp(item)) {
        newerHere ||= stamp(mine) > stamp(item);
        next.push(mine);
      } else {
        for (const k of Object.keys(mine)) if (!(k in item)) delete mine[k];
        next.push(Object.assign(mine, item));
      }
    }
    // Items created here in the meantime.
    for (const mine of state[name]) {
      if (!seen.has(mine.id) && !(mine.id in deleted)) {
        next.push(mine);
        newerHere = true;
      }
    }
    state[name] = next;
  }
  const secrets = { ...data.secrets };
  for (const [k, v] of Object.entries(state.secrets)) {
    if (!(k in secrets) && !(`secret:${k}` in deleted)) {
      secrets[k] = v;
      newerHere = true;
    }
  }
  state.secrets = secrets;
  state.deleted = deleted;
  return newerHere;
}

// Adds the lookup helpers both stores offer.
export function withLookups(store) {
  store.bot = (id) => store.state.bots.find((b) => b.id === id);
  store.task = (id) => store.state.tasks.find((t) => t.id === id);
  store.connection = (id) => store.state.connections.find((c) => c.id === id);
  return store;
}
