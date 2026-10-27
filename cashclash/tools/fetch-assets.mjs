// Downloads the CC0 art Cash Clash uses into desktop/assets/ (shared by the web and desktop versions).
//   cd cashclash && npm install && node tools/fetch-assets.mjs
// Sources (all CC0 / public domain):
//   * Poly Haven (https://polyhaven.com): photo-scanned props, PBR textures and HDRI skies
//   * Quaternius (https://quaternius.com) animated characters, via the @netforge/asset-library-files npm package
// The downloaded files are committed, so you only need this to change or refresh the art.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'assets');
const TMP = path.join(ROOT, '..', '.asset-tmp');
const UA = { 'User-Agent': 'CashClash-asset-fetch/1.0 (+https://github.com/OliverZS2005/ClaudeCodeIsTuff)' };

// Poly Haven scans are film-quality; these budgets keep them small enough for a web game.
const TEX_SIZE = 512;                                    // max texture size inside models
const SIMPLIFY = { shrub: 0.25, bench: 0.5 };             // keep this fraction of triangles
// name in the game -> Poly Haven asset id
const MODELS = {
  crate: 'wooden_crate_01', military_crate: 'old_military_crate', barrel: 'barrel_03', barrier: 'concrete_road_barrier',
  street_lamp: 'street_lamp_01', trash_can: 'metal_trash_can', hydrant: 'fire_hydrant', utility_box: 'utility_box_01',
  plastic_crate: 'plastic_crate_01', covered_car: 'covered_car',
  shrub: 'shrub_01', bench: 'modular_street_seating',
};
const TEXTURES = {
  concrete_floor: 'concrete_floor_worn_001', corrugated: 'corrugated_iron', metal_plate: 'metal_plate', marble: 'marble_01',
  asphalt: 'asphalt_02', brick: 'brick_wall_10', grass: 'leafy_grass', pavers: 'concrete_pavers', slate: 'patterned_slate_tiles',
  plaster: 'grey_plaster', concrete_wall: 'concrete_wall_008', roof: 'clay_roof_tiles', shutter: 'painted_metal_shutter',
};
const SKIES = { day: 'kloofendal_48d_partly_cloudy_puresky', sunset: 'qwantani_sunset_puresky', dusk: 'qwantani_dusk_2_puresky', night: 'rogland_clear_night' };
// From the npm package's library/lowpoly/. (Poly Haven's photo-scanned trees are tens of MB each.)
const CHARACTERS = { soldier: 'soldier.glb', astronaut: 'astronaut.glb' };
const PACKAGE_MODELS = { tree: 'tree_oak.glb', pine: 'tree_pine.glb' };

const get = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };
const api = async id => JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
const save = (rel, buf) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); console.log(`  ${rel} ${(buf.length / 1024) | 0}KB`); };

await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// Writes a plain GLB (no meshopt/quantization extensions) so Godot's importer can read it too.
async function writeGlb(doc, rel, ratio) {
  // meshopt/quantization: Godot can't read them. unlit: those materials would ignore the scene's lighting.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (/meshopt|quantization|unlit/i.test(ext.extensionName)) ext.dispose();
  const steps = [dedup(), prune()];
  if (ratio) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX_SIZE, TEX_SIZE], quality: 82 }));
  await doc.transform(...steps);
  save(rel, Buffer.from(await io.writeBinary(doc)));
}

fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
console.log('Models (Poly Haven)');
for (const [name, id] of Object.entries(MODELS)) {
  const g = (await api(id)).gltf['1k'].gltf, dir = path.join(TMP, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.gltf'), await get(g.url));
  for (const [rel, f] of Object.entries(g.include || {})) { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), await get(f.url)); }
  await writeGlb(await io.read(path.join(dir, 'model.gltf')), `models/${name}.glb`, SIMPLIFY[name]);
}
console.log('Textures (Poly Haven)');
for (const [name, id] of Object.entries(TEXTURES)) {
  const f = await api(id);
  for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough']])
    if (f[map]) save(`textures/${name}_${suffix}.jpg`, await sharp(await get(f[map]['1k'].jpg.url)).resize(suffix === 'diff' ? 1024 : 512).jpeg({ quality: 80, mozjpeg: true }).toBuffer());
}
console.log('Skies (Poly Haven)');
for (const [name, id] of Object.entries(SKIES)) save(`sky/${name}.hdr`, await get((await api(id)).hdri['1k'].hdr.url));
console.log('Characters (Quaternius)');
const meta = JSON.parse((await get('https://registry.npmjs.org/@netforge/asset-library-files/0.2.0')).toString());
fs.writeFileSync(path.join(TMP, 'pkg.tgz'), await get(meta.dist.tarball));
execFileSync('tar', ['xzf', 'pkg.tgz'], { cwd: TMP });
for (const [name, file] of Object.entries(CHARACTERS)) await writeGlb(await io.read(path.join(TMP, 'package/library/lowpoly', file)), `characters/${name}.glb`);
for (const [name, file] of Object.entries(PACKAGE_MODELS)) {
  const doc = await io.read(path.join(TMP, 'package/library/lowpoly', file));
  // These leave metalness unset, which glTF reads as fully metallic (chrome trees). Make them matte,
  // and turn the stylised teal leaves into a natural green that sits with the photo-scanned props.
  for (const m of doc.getRoot().listMaterials()) {
    m.setMetallicFactor(0).setRoughnessFactor(0.9);
    if (/leaf/i.test(m.getName())) m.setBaseColorFactor(/dark/i.test(m.getName()) ? [0.035, 0.11, 0.05, 1] : [0.07, 0.17, 0.04, 1]); // linear values
    else if (/bark|wood/i.test(m.getName())) m.setBaseColorFactor([0.2, 0.11, 0.06, 1]);
  }
  await writeGlb(doc, `models/${name}.glb`);
}

console.log('Fonts (from the @fontsource npm packages, SIL Open Font License)');
const FONTS = { 'barlow-condensed': [600, 800], 'jetbrains-mono': [500, 700] };
for (const [family, weights] of Object.entries(FONTS)) {
  const pkg = path.join(ROOT, '..', '..', 'node_modules', '@fontsource', family);
  for (const w of weights) save(`fonts/${family}-${w}.woff2`, fs.readFileSync(path.join(pkg, 'files', `${family}-latin-${w}-normal.woff2`)));
  save(`fonts/${family}-LICENSE.txt`, fs.readFileSync(path.join(pkg, 'LICENSE')));
}

fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), `# Art credits

Everything here is CC0 (public domain). Credit isn't required, but it's deserved.

- **Poly Haven** (https://polyhaven.com), CC0: ${Object.values(MODELS).join(', ')} (models); ${Object.values(TEXTURES).join(', ')} (textures); ${Object.values(SKIES).join(', ')} (HDRI skies).
- **Quaternius** (https://quaternius.com), CC0: animated characters (${Object.values(CHARACTERS).join(', ')}) and trees (${Object.values(PACKAGE_MODELS).join(', ')}), taken from the @netforge/asset-library-files npm package.

Fonts (SIL Open Font License 1.1, license files next to them): Barlow Condensed (Jeremy Tribby) and JetBrains Mono (JetBrains), via the @fontsource npm packages.

Re-download with \`node tools/fetch-assets.mjs\`.
`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('Done.');
