// Pieces shared by the two ways Dawnshift saves data: files on a computer
// (store.js) and the browser's own storage (browser-store.js).

export const emptyState = () => ({
  version: 0,
  connections: [],
  bots: [],
  tasks: [],
  board: [],
  secrets: {},
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

// Adds the lookup helpers both stores offer.
export function withLookups(store) {
  store.bot = (id) => store.state.bots.find((b) => b.id === id);
  store.task = (id) => store.state.tasks.find((t) => t.id === id);
  store.connection = (id) => store.state.connections.find((c) => c.id === id);
  return store;
}
