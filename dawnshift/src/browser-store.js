// In the web version, everything is saved in the browser's own storage
// (IndexedDB) on the user's device. With an account, an encrypted copy is
// also synced (see src/sync.js); the website itself can't read it.
import { emptyState, normalizePath, withLookups, syncedState, mergeIntoState } from './store-common.js';

const DB_NAME = 'dawnshift';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['state', 'session']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
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
  const listeners = new Set();

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

  function save({ quiet = false } = {}) {
    state.version++;
    if (!timer) timer = setTimeout(flush, 150);
    // quiet: a change that came from syncing, which shouldn't be synced back.
    if (!quiet) for (const fn of listeners) fn();
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
      for (const fn of listeners) fn();
    },
    async listAll() {
      return (await all()).map(({ path, size, modified }) => ({ path, size, modified }));
    },
  };

  const store = withLookups({ state, save, flush, files });

  // Called after every change the user or a bot makes.
  store.onChange = (fn) => listeners.add(fn);

  // Everything that gets synced, as plain data.
  store.exportData = async () => ({ ...syncedState(state), files: await all() });

  // Puts merged data in place (see mergeIntoState). Returns true if this
  // device still has changes the merged data doesn't include.
  store.applyData = async (data, { keepLocal } = {}) => {
    const newerHere = mergeIntoState(state, data, keepLocal);
    await run(db, 'files', 'readwrite', (s) => {
      for (const f of data.files) s.put(f);
    });
    save({ quiet: true });
    await flush();
    return newerHere;
  };

  // Removes all Dawnshift data from this browser (used when logging out).
  store.clearAll = async () => {
    Object.assign(state, emptyState(), { version: state.version + 1 });
    await run(db, 'files', 'readwrite', (s) => s.clear());
    await flush();
  };

  // The login on this device. The data key is stored as a key the page can
  // use but never read out, so it can't be copied off the device as text.
  store.session = {
    get: () => run(db, 'session', 'readonly', (s) => s.get('main')),
    set: (value) => run(db, 'session', 'readwrite', (s) => s.put(value, 'main')),
    clear: () => run(db, 'session', 'readwrite', (s) => s.delete('main')),
  };

  return store;
}
