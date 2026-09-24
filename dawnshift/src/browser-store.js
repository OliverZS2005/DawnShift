// In the web version, everything is saved in the browser's own storage
// (IndexedDB) on the user's device. Nothing is sent to the website.
import { emptyState, normalizePath, withLookups } from './store-common.js';

const DB_NAME = 'dawnshift';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('state');
      req.result.createObjectStore('files', { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs one IndexedDB request and waits for it.
function run(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function createBrowserStore() {
  const db = await openDb();
  const saved = await run(db, 'state', 'readonly', (s) => s.get('main'));
  const state = { ...emptyState(), ...(saved ?? {}) };

  let timer = null;
  let writing = Promise.resolve();

  function flush() {
    clearTimeout(timer);
    timer = null;
    // structuredClone takes a snapshot, so later changes don't race the write.
    const snapshot = structuredClone(state);
    writing = writing.then(() => run(db, 'state', 'readwrite', (s) => s.put(snapshot, 'main'))).catch((err) => {
      console.error('Could not save Dawnshift data', err);
    });
    return writing;
  }

  function save() {
    state.version++;
    if (!timer) timer = setTimeout(flush, 150);
  }

  // Save right away if the page is being closed or hidden.
  addEventListener('pagehide', () => timer && flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && timer && flush());

  const all = () => run(db, 'files', 'readonly', (s) => s.getAll());

  const files = {
    label: "this browser's storage",
    async list(folder) {
      const dir = normalizePath(folder);
      const prefix = dir ? `${dir}/` : '';
      const names = new Set();
      for (const f of await all()) {
        if (!f.path.startsWith(prefix)) continue;
        const rest = f.path.slice(prefix.length);
        names.add(rest.includes('/') ? `${rest.split('/')[0]}/` : rest);
      }
      if (!names.size && dir) return null;
      return [...names].sort();
    },
    async read(p) {
      const f = await run(db, 'files', 'readonly', (s) => s.get(normalizePath(p)));
      if (!f) throw new Error(`No file called "${p}".`);
      return f.content;
    },
    async write(p, content) {
      const key = normalizePath(p);
      if (!key) throw new Error('Give the file a name.');
      await run(db, 'files', 'readwrite', (s) => s.put({ path: key, content, size: content.length, modified: new Date().toISOString() }));
    },
    async listAll() {
      return (await all()).map(({ path, size, modified }) => ({ path, size, modified }));
    },
  };

  return withLookups({ state, save, flush, files });
}
