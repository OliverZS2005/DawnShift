// Packs a ready-to-run Hustlefront server into a zip: the server, the web page and its 3D art, and the one
// library it needs (ws), so all it takes is Node.js and `node server.js`. Never the server's own data
// (players, accounts, saves). The desktop app carries this zip ("Download the server"), and every server
// offers it at /download/server.zip.
//   node tools/server-zip.js <out.zip>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FILES = ['server.js', 'shared.js', 'models.js', 'render3d.js', 'index.html', 'news.json', 'vendor/three.bundle.js', 'tools/announce.js', 'tools/server-zip.js'];
const DIRS = ['node_modules/ws', 'desktop/assets']; // all of them but Godot's .import files
const README = `HUSTLEFRONT SERVER
==================

This folder is a whole Hustlefront server: multiplayer, accounts and sync, the news, and the web version of
the game for anyone who opens its address in a browser.

1. Install Node.js (version 18 or newer) from https://nodejs.org
2. Open a terminal in this folder:
     Windows: open the folder, click the address bar, type  cmd  and press Enter
     Mac: right-click the folder in Finder > Services > New Terminal at Folder
3. Type   node server.js   and press Enter. Leave the window open while people play.

The game's address is then:
  ws://localhost:8080             on this computer
  ws://<this computer's IP>:8080  from phones and other computers on the same Wi-Fi
                                  (Windows: type ipconfig, look for IPv4 Address;
                                   Mac: System Settings > Wi-Fi > Details)
Type it in the game's login form (Server) or in Play > Multiplayer. Opening http://localhost:8080 in a
browser plays the web version. If Windows asks whether to let Node.js through the firewall, allow it on
private networks. For players outside your home, run this on a hosting service or forward port 8080.

To post news to everyone playing on this server:
  node tools/announce.js "Title" "What's new."
  (add --update once a new version of the game is out, to tell the apps)

Settings (set before node server.js, e.g. PORT=9000 on Mac/Linux, set PORT=9000 on Windows):
  PORT          the port (8080)
  SERVER_NAME   the name players see
  NEWS_URL      another server's /api/news to follow and pass on
Players, accounts and saves are kept in players.json, accounts.json and syncs.json in this folder.
`;

function list() {
  const out = FILES.filter(f => fs.existsSync(path.join(ROOT, f)));
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) walk(r);
      else if (!e.name.endsWith('.import')) out.push(r);
    }
  };
  for (const d of DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(d);
  return out;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

// A zip (deflated, or stored when that's no smaller), as a Buffer, of `entries`: [name, Buffer].
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  const time = 0, date = (46 << 9) | (10 << 5) | 29; // 2026-10-29: fixed, so the zip is the same each build
  for (const [name, data] of entries) {
    const n = Buffer.from('Hustlefront-Server/' + name), crc = crc32(data);
    const def = zlib.deflateRawSync(data, { level: 6 }), stored = def.length >= data.length, body = stored ? data : def;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function serverZip() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const slim = { name: pkg.name, version: pkg.version, private: true, description: pkg.description, main: 'server.js', scripts: { start: 'node server.js', announce: pkg.scripts.announce }, dependencies: pkg.dependencies };
  const entries = [['READ ME.txt', Buffer.from(README.replace(/\n/g, '\r\n'))], ['package.json', Buffer.from(JSON.stringify(slim, null, 2) + '\n')]];
  for (const f of list()) entries.push([f, fs.readFileSync(path.join(ROOT, f))]);
  return zip(entries);
}

module.exports = { serverZip };
if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('Usage: node tools/server-zip.js <out.zip>'); process.exit(1); }
  if (!fs.existsSync(path.join(ROOT, 'node_modules/ws'))) { console.error('Run `npm install --omit=dev` first: the zip carries node_modules/ws.'); process.exit(1); }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const z = serverZip();
  fs.writeFileSync(out, z);
  console.log(`wrote ${out} (${(z.length / 1e6).toFixed(1)} MB)`);
}
