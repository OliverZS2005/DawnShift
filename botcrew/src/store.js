// Everything BotCrew knows lives in one JSON file (data/state.json), so the
// team, its tasks and its memory survive restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  version: 0,
  connections: [],
  bots: [],
  tasks: [],
  board: [],
  secrets: {},
});

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function createStore(dir, { persist = true } = {}) {
  const file = path.join(dir, 'state.json');
  let state = EMPTY();
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

  // Bumps the version (so the UI knows to refresh) and writes soon after.
  function save() {
    state.version++;
    if (!timer) timer = setTimeout(flush, 150);
  }

  return {
    state,
    dir,
    workspaceDir: path.join(dir, 'workspace'),
    save,
    flush,
    bot: (id) => state.bots.find((b) => b.id === id),
    task: (id) => state.tasks.find((t) => t.id === id),
    connection: (id) => state.connections.find((c) => c.id === id),
  };
}
