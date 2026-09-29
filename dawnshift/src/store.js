// On a computer, everything Dawnshift knows lives in one JSON file
// (data/state.json), and the bots' files live in data/workspace/.
// With an account, an encrypted copy is also synced (see src/sync.js).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { emptyState, normalizePath, withLookups, syncedState, mergeIntoState } from './store-common.js';
import { importDataKey, fromB64 } from './sync-crypto.js';

export { newId } from './store-common.js';

export function createStore(dir, { persist = true } = {}) {
  const file = path.join(dir, 'state.json');
  const sessionFile = path.join(dir, 'session.json');
  let state = emptyState();
  if (persist) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  }

  let timer = null;
  const listeners = new Set();
  const changed = () => {
    for (const fn of listeners) fn();
  };

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!persist) return;
    const tmp = `${file}.tmp`;
    // The file holds API keys, so keep it readable by this user only.
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // Bumps the version (so the interface knows to refresh) and writes soon after.
  // quiet: a change that came from syncing, which shouldn't be synced back.
  function save({ quiet = false } = {}) {
    state.version++;
    if (!timer) timer = setTimeout(flush, 150);
    if (!quiet) changed();
  }

  const workspaceDir = path.join(dir, 'workspace');
  const full = (p) => path.join(workspaceDir, normalizePath(p));

  const files = {
    label: workspaceDir,
    // Returns the names in a folder (folders end in "/"), or null if it doesn't exist.
    async list(folder) {
      await fsp.mkdir(workspaceDir, { recursive: true });
      const entries = await fsp.readdir(full(folder), { withFileTypes: true }).catch((err) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      return entries && entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
    },
    read: (p) =>
      fsp.readFile(full(p), 'utf8').catch((err) => {
        throw err.code === 'ENOENT' || err.code === 'EISDIR' ? Object.assign(new Error(`No file called "${p}".`), { status: 404 }) : err;
      }),
    async write(p, content, { quiet = false } = {}) {
      const target = full(p);
      if (!normalizePath(p)) throw new Error('Give the file a name.');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content);
      if (!quiet) changed();
    },
    async listAll() {
      await fsp.mkdir(workspaceDir, { recursive: true });
      const out = [];
      async function walk(d) {
        for (const e of await fsp.readdir(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) await walk(f);
          else {
            const st = await fsp.stat(f);
            out.push({ path: path.relative(workspaceDir, f).split(path.sep).join('/'), size: st.size, modified: st.mtime.toISOString() });
          }
        }
      }
      await walk(workspaceDir);
      return out;
    },
  };

  const store = withLookups({ state, dir, save, flush, files });

  // ---------- syncing ----------

  // Called after every change the user or a bot makes.
  store.onChange = (fn) => listeners.add(fn);

  // Everything that gets synced, as plain data.
  store.exportData = async () => ({
    ...syncedState(state),
    files: await Promise.all((await files.listAll()).map(async (f) => ({ ...f, content: await files.read(f.path) }))),
  });

  // Puts merged data in place (see mergeIntoState). Returns true if this
  // computer still has changes the merged data doesn't include.
  store.applyData = async (data, { keepLocal } = {}) => {
    const newerHere = mergeIntoState(state, data, keepLocal);
    for (const f of data.files) {
      const mine = await files.read(f.path).catch(() => null);
      if (mine !== f.content) await files.write(f.path, f.content, { quiet: true });
    }
    save({ quiet: true });
    flush();
    return newerHere;
  };

  // Removes all Dawnshift data from this computer (used when logging out).
  store.clearAll = async () => {
    const version = state.version;
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, emptyState(), { version: version + 1 });
    await fsp.rm(workspaceDir, { recursive: true, force: true });
    flush();
  };

  // The login on this computer. The data key is saved as text in a file only
  // this user can read, next to state.json (which holds the AI keys anyway).
  store.session = {
    async get() {
      const saved = await fsp.readFile(sessionFile, 'utf8').then(JSON.parse).catch(() => null);
      if (!saved) return null;
      const { rawKey, ...rest } = saved;
      return { ...rest, rawKey, key: await importDataKey(fromB64(rawKey)) };
    },
    async set({ key, rawKey, ...rest }) {
      if (!persist) return;
      if (!rawKey) throw new Error('The computer version needs the data key to stay logged in.');
      await fsp.writeFile(sessionFile, JSON.stringify({ ...rest, rawKey }), { mode: 0o600 });
    },
    clear: () => fsp.rm(sessionFile, { force: true }),
    // Tells src/sync.js to keep the key's bytes (as base64), since a file
    // can't hold a CryptoKey.
    needsRawKey: true,
  };

  return store;
}
