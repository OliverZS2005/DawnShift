// Combines two copies of a user's data (for example a phone's and a laptop's)
// so changes from both survive. Items are matched by id; when both sides
// changed the same item, the newer one wins. Deleted items are remembered for
// a while, so a deletion on one device isn't undone by an old copy elsewhere.
import { stamp } from './store-common.js';

const COLLECTIONS = ['connections', 'bots', 'tasks', 'board'];
const KEEP_DELETIONS_MS = 60 * 24 * 3600 * 1000;

// preferLocal(id) lets the caller keep its own copy of an item it's busy with
// (such as a task this device is running right now).
export function mergeData(local, remote, { preferLocal = () => false, now = Date.now() } = {}) {
  const deleted = { ...(remote.deleted ?? {}), ...(local.deleted ?? {}) };
  for (const [id, at] of Object.entries(deleted)) {
    if (now - at > KEEP_DELETIONS_MS) delete deleted[id];
  }

  const out = { deleted };
  for (const name of COLLECTIONS) {
    const byId = new Map();
    for (const item of remote[name] ?? []) byId.set(item.id, item);
    for (const item of local[name] ?? []) {
      const other = byId.get(item.id);
      if (!other || preferLocal(item.id) || stamp(item) >= stamp(other)) byId.set(item.id, item);
    }
    // Keep the local order, then anything new from the other device.
    const order = [...(local[name] ?? []), ...(remote[name] ?? [])].map((i) => i.id);
    out[name] = [...new Set(order)].filter((id) => !(id in deleted)).map((id) => byId.get(id));
  }
  // Newest board posts last, like on each device.
  out.board.sort((a, b) => stamp(a) - stamp(b));

  out.secrets = { ...(remote.secrets ?? {}), ...(local.secrets ?? {}) };
  for (const name of Object.keys(out.secrets)) {
    if (`secret:${name}` in deleted) delete out.secrets[name];
  }

  const files = new Map();
  for (const f of [...(remote.files ?? []), ...(local.files ?? [])]) {
    const other = files.get(f.path);
    if (!other || stamp({ updatedAt: f.modified }) >= stamp({ updatedAt: other.modified })) files.set(f.path, f);
  }
  out.files = [...files.values()].filter((f) => !(`file:${f.path}` in deleted));
  return out;
}

// JSON with object keys sorted, so the same data always gives the same text.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// True if two copies hold the same data, ignoring the order of items.
// Used to avoid uploading when a merge changed nothing, so two devices
// don't keep re-uploading the same data back and forth.
export function sameData(a, b) {
  const canon = (d) =>
    stable({
      ...Object.fromEntries(COLLECTIONS.map((name) => [name, [...(d[name] ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))])),
      secrets: d.secrets ?? {},
      deleted: d.deleted ?? {},
      files: [...(d.files ?? [])].sort((x, y) => (x.path < y.path ? -1 : 1)),
    });
  return canon(a) === canon(b);
}
