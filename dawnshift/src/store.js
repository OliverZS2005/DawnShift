// On a computer, everything Dawnshift knows lives in one JSON file
// (data/state.json), and the bots' files live in data/workspace/.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { emptyState, normalizePath, withLookups } from './store-common.js';

export { newId } from './store-common.js';

export function createStore(dir, { persist = true } = {}) {
  const file = path.join(dir, 'state.json');
  let state = emptyState();
  if (persist) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  }

  let timer = null;

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
  function save() {
    state.version++;
    if (!timer) timer = setTimeout(flush, 150);
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
    async write(p, content) {
      const target = full(p);
      if (!normalizePath(p)) throw new Error('Give the file a name.');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content);
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

  return withLookups({ state, dir, save, flush, files });
}
