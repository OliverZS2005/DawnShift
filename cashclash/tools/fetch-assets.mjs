// Downloads the CC0 art Cash Clash uses into desktop/assets/ (shared by the web and desktop versions).
//   cd cashclash && npm install && node tools/fetch-assets.mjs
// Sources (all CC0 / public domain):
//   * Poly Haven (https://polyhaven.com): photo-scanned props, PBR textures and HDRI skies
//   * OpenGameArt (https://opengameart.org) CC0 gun models, converted with Blender (tools/guns.py)
//   * ambientCG (https://ambientcg.com) photographed building facades, by day and at night (CC0)
//   * Microsoft Rocketbox (https://github.com/microsoft/Microsoft-Rocketbox, MIT licence): realistic people
//     and their animations. Converting those from FBX needs Blender on the PATH (tools/people.py).
// The downloaded files are committed, so you only need this to change or refresh the art.
// Pass a section name to redo just that part: models, textures, skies, facades, guns, people, fonts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center, dedup, prune, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'assets');
const TMP = path.join(ROOT, '..', '.asset-tmp');
const UA = { 'User-Agent': 'CashClash-asset-fetch/1.0 (+https://github.com/OliverZS2005/ClaudeCodeIsTuff)' };

// Poly Haven scans are film-quality; these budgets keep them small enough for a web game.
const TEX_SIZE = 512;                                    // max texture size inside models
const SIMPLIFY = { shrub: 0.12, bench: 0.5, street_lamp: 0.15, barrier: 0.1, plastic_crate: 0.2, hydrant: 0.3, covered_car: 0.35 }; // keep this fraction of triangles
// Some scans ship two versions side by side (clean and weathered): keep one, centred on the origin.
const ONE_VARIANT = { hydrant: /_aged/, trash_can: /_rust/, military_crate: /_b$/ };
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
// Building fronts: the daytime set (colour, normal, roughness, metalness) and the same building at night
// (colour with lights on, emission). res: download size; the night maps are always 1K.
const FACADES = {
  brick: { day: 'Facade018A', night: 'Facade018B', res: '2K' },
  brick2: { day: 'Facade020A', night: 'Facade020B', res: '2K' },
  concrete: { day: 'Facade019A', night: 'Facade019B', res: '2K' },
  tower: { day: 'Facade012', night: 'Facade015', res: '1K' },
};
const SKIES = { day: 'kloofendal_48d_partly_cloudy_puresky', sunset: 'qwantani_sunset_puresky', dusk: 'qwantani_dusk_2_puresky', night: 'rogland_clear_night' };
// The guns (OpenGameArt pages, all CC0). file: the download; model: the file inside it to convert;
// muzzle: which way the barrel points in it; drop: stray parts (spare magazine, silencer); finish:
// paint a model that ships without textures; level: straighten one saved at an angle.
const OGA = 'https://opengameart.org/sites/default/files/';
const GUNS = {
  pistol: { page: 'pistol-5', file: 'pistolfbxgltftexturesblend_1.zip', model: 'GLTF/Pistol.gltf', muzzle: '+x', drop: '^Pistol_Magazine$' },
  smg: { page: 'micro-uzi-untextured', file: 'uzi.blend', muzzle: '-x', drop: '^Cylinder$', finish: true },
  shotgun: { page: 'benelli-m1', file: 'Benelli%20M1.blend', muzzle: '-x', finish: true },
  sniper: { page: 'bolt-action-rifle-lee-enfield', file: 'Lee%20Enfield.zip', model: 'FP Hunting Rifle.fbx', muzzle: '-x' },
  rocket: { page: 'low-poly-rpg7', file: 'RPG7.zip', model: 'RPG7.fbx', muzzle: '+x', level: true },
};
// Rocketbox people: game name -> avatar folder. Each gets these clips (Rocketbox animation files;
// "xy" ones have the walking movement taken out so they run on the spot).
const PEOPLE = { hoodie: 'Male_Adult_04', jacket: 'Male_Adult_10', denim: 'Male_Adult_12' };
const PEOPLE_CLIPS = { idle: 'static/m_idle_neutral_01', run: 'xy/m_run_neutral', walk: 'xy/m_walk_neutral_01' };
const ROCKETBOX = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/';
const PEOPLE_TEX = 1024;
const only = process.argv[2];
const want = section => !only || only === section;

const get = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };
const api = async id => JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
const save = (rel, buf) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); console.log(`  ${rel} ${(buf.length / 1024) | 0}KB`); };

await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// Writes a plain GLB (no meshopt/quantization extensions) so Godot's importer can read it too.
async function writeGlb(doc, rel, ratio, texSize = TEX_SIZE, drop) {
  // meshopt/quantization: Godot can't read them. unlit: those materials would ignore the scene's lighting.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (/meshopt|quantization|unlit/i.test(ext.extensionName)) ext.dispose();
  if (drop) for (const n of doc.getRoot().listNodes()) if (drop.test(n.getName())) n.dispose();
  const steps = drop ? [center({ pivot: 'below' }), dedup(), prune()] : [dedup(), prune()];
  if (ratio) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.04 })); // props are seen from metres away
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }));
  await doc.transform(...steps);
  save(rel, Buffer.from(await io.writeBinary(doc)));
}

fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
if (want('models')) console.log('Models (Poly Haven)');
for (const [name, id] of want('models') ? Object.entries(MODELS) : []) {
  const g = (await api(id)).gltf['1k'].gltf, dir = path.join(TMP, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.gltf'), await get(g.url));
  for (const [rel, f] of Object.entries(g.include || {})) { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), await get(f.url)); }
  await writeGlb(await io.read(path.join(dir, 'model.gltf')), `models/${name}.glb`, SIMPLIFY[name], TEX_SIZE, ONE_VARIANT[name]);
}
if (want('textures')) console.log('Textures (Poly Haven)');
for (const [name, id] of want('textures') ? Object.entries(TEXTURES) : []) {
  const f = await api(id);
  for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough']])
    if (f[map]) save(`textures/${name}_${suffix}.jpg`, await sharp(await get(f[map]['1k'].jpg.url)).resize(suffix === 'diff' ? 1024 : 512).jpeg({ quality: 80, mozjpeg: true }).toBuffer());
}
if (want('skies')) console.log('Skies (Poly Haven)');
for (const [name, id] of want('skies') ? Object.entries(SKIES) : []) save(`sky/${name}.hdr`, await get((await api(id)).hdri['1k'].hdr.url));
if (want('facades')) {
  console.log('Facades (ambientCG)');
  const set = async (id, res) => {
    const dir = path.join(TMP, id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'set.zip'), await get(`https://ambientcg.com/get?file=${id}_${res}-JPG.zip`));
    execFileSync('unzip', ['-o', '-q', 'set.zip'], { cwd: dir });
    return map => path.join(dir, `${id}_${res}-JPG_${map}.jpg`);
  };
  const jpg = async (from, size, rel) => save(rel, await sharp(from).resize(size, size).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
  for (const [name, f] of Object.entries(FACADES)) {
    const day = await set(f.day, f.res), size = f.res === '2K' ? 2048 : 1024;
    await jpg(day('Color'), size, `textures/facade_${name}_diff.jpg`);
    await jpg(day('NormalGL'), size, `textures/facade_${name}_nor.jpg`);
    await jpg(day('Roughness'), 1024, `textures/facade_${name}_rough.jpg`);
    if (fs.existsSync(day('Metalness'))) await jpg(day('Metalness'), 1024, `textures/facade_${name}_metal.jpg`);
    const night = await set(f.night, '1K');
    await jpg(night('Color'), 1024, `textures/facade_${name}_night.jpg`);
    if (fs.existsSync(night('Emission'))) await jpg(night('Emission'), 1024, `textures/facade_${name}_emit.jpg`);
  }
}

if (want('guns')) {
  console.log('Guns (OpenGameArt, converted with Blender)');
  for (const [id, g] of Object.entries(GUNS)) {
    const dir = path.join(TMP, 'gun-' + id); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, decodeURIComponent(g.file));
    fs.writeFileSync(file, await get(OGA + g.file));
    if (file.endsWith('.zip')) execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
    const raw = path.join(dir, 'out.glb');
    execFileSync('blender', ['-b', '--python', path.join(path.dirname(fileURLToPath(import.meta.url)), 'guns.py'), '--', g.model ? path.join(dir, g.model) : file, raw,
      g.muzzle, g.drop || '', g.finish ? 'finish' : '', g.level ? 'level' : ''], { stdio: 'ignore' });
    await writeGlb(await io.read(raw), `guns/${id}.glb`, 0, 1024);
  }
}

if (want('people')) {
  console.log('People (Microsoft Rocketbox, converted with Blender)');
  const dl = async rel => { const f = path.join(TMP, 'rb', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await get(ROCKETBOX + rel)); return f; };
  const clips = [];
  for (const [clip, file] of Object.entries(PEOPLE_CLIPS)) {
    const [set, name] = file.split('/');
    clips.push(`${clip}=${await dl(`Animations/all_animations_max_motextr_${set}/${name}.max.fbx`)}`);
  }
  for (const [name, folder] of Object.entries(PEOPLE)) {
    const fbx = await dl(`Avatars/Adults/${folder}/Export/${folder}.fbx`);
    // the FBX names its textures (Rocketbox numbers them per avatar, e.g. m024_body_color.tga)
    for (const tga of new Set(fs.readFileSync(fbx, 'latin1').match(/m\d+_[a-z]+_[a-z]+\.tga/g))) await dl(`Avatars/Adults/${folder}/Textures/${tga}`);
    const raw = path.join(TMP, `${name}.glb`);
    execFileSync('blender', ['-b', '--python', path.join(path.dirname(fileURLToPath(import.meta.url)), 'people.py'), '--', fbx, raw, ...clips], { stdio: 'ignore' });
    const doc = await io.read(raw);
    for (const m of doc.getRoot().listMaterials()) {
      if (/opacity/.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.5); // hair, lashes
      // readable texture names (Godot writes them out as files, prefixed with the model: jacket_body_color)
      const part = m.getName().split('_').pop();
      if (m.getBaseColorTexture()) m.getBaseColorTexture().setName(`${part}_color`);
      if (m.getNormalTexture()) m.getNormalTexture().setName(`${part}_normal`);
    }
    await writeGlb(doc, `characters/${name}.glb`, 0, PEOPLE_TEX);
  }
}

if (want('fonts')) console.log('Fonts (from the @fontsource npm packages, SIL Open Font License)');
const FONTS = { 'barlow-condensed': [600, 800], 'jetbrains-mono': [500, 700] };
for (const [family, weights] of want('fonts') ? Object.entries(FONTS) : []) {
  const pkg = path.join(ROOT, '..', '..', 'node_modules', '@fontsource', family);
  for (const w of weights) save(`fonts/${family}-${w}.woff2`, fs.readFileSync(path.join(pkg, 'files', `${family}-latin-${w}-normal.woff2`)));
  save(`fonts/${family}-LICENSE.txt`, fs.readFileSync(path.join(pkg, 'LICENSE')));
}

fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), `# Art credits

Everything here is CC0 (public domain) unless noted. Credit isn't required for CC0, but it's deserved.

- **Poly Haven** (https://polyhaven.com), CC0: ${Object.values(MODELS).join(', ')} (models); ${Object.values(TEXTURES).join(', ')} (textures); ${Object.values(SKIES).join(', ')} (HDRI skies).
- **ambientCG** (https://ambientcg.com), CC0: building facades ${Object.values(FACADES).flatMap(f => [f.day, f.night]).join(', ')}.
- **OpenGameArt** (https://opengameart.org), CC0 guns: ${Object.values(GUNS).map(g => g.page).join(', ')} (https://opengameart.org/content/<name>).

People (MIT licence, notice below): **Microsoft Rocketbox** avatars ${Object.values(PEOPLE).join(', ')} and animations ${Object.values(PEOPLE_CLIPS).map(c => c.split('/')[1]).join(', ')} (https://github.com/microsoft/Microsoft-Rocketbox), converted to glTF.

> Copyright (c) Microsoft Corporation. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Fonts (SIL Open Font License 1.1, license files next to them): Barlow Condensed (Jeremy Tribby) and JetBrains Mono (JetBrains), via the @fontsource npm packages.

Re-download with \`node tools/fetch-assets.mjs\`.
`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('Done.');
