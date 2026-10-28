// Downloads the CC0 art Cash Clash uses into desktop/assets/ (shared by the web and desktop versions).
//   cd cashclash && npm install && node tools/fetch-assets.mjs
// Sources (all CC0 / public domain):
//   * Poly Haven (https://polyhaven.com): photo-scanned props, PBR textures and HDRI skies
//   * OpenGameArt (https://opengameart.org) CC0 gun models, converted with Blender (tools/guns.py)
//   * ambientCG (https://ambientcg.com) photographed building facades, by day and at night (CC0)
//   * Grab3D (https://grab3d.com) CC0 cars, repainted in real car colours
//   * Poly Haven modular facade kits: modelled building fronts (windows, doors, mouldings), cut into 3 m
//     bays with Blender (tools/kit.py) and put together into city blocks by the game
//   * Microsoft Rocketbox (https://github.com/microsoft/Microsoft-Rocketbox, MIT licence): realistic people
//     and their animations. Converting those from FBX needs Blender on the PATH (tools/people.py).
// The downloaded files are committed, so you only need this to change or refresh the art.
// Pass a section name to redo just that part: models, textures, skies, facades, kits, cars, guns, people, fonts
// (models and kits also take names: `node tools/fetch-assets.mjs models shelves,rack`, `... kits fence`).
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
const SIMPLIFY = { shrub: 0.12, bench: 0.5, street_lamp: 0.15, barrier: 0.1, plastic_crate: 0.2, hydrant: 0.3, covered_car: 0.35,
  drill_press: 0.25, generator: 0.25, compressor: 0.25, cash_register: 0.4, box: 0.2,
  rack: 0.6, tool_cart: 0.15, tool_chest: 0.2, hand_truck: 0.2, welding_cart: 0.15, storage_cart: 0.2, fluorescent: 0.15,
  hanging_lamp: 0.3, extinguisher: 0.25, power_box: 0.15, crate2: 0.6, propane: 0.5, coffee_cart: 0.15, bar_chair: 0.2,
  round_table: 0.3, plant: 0.04, desk: 0.5, armchair: 0.4, crane: 0.08 }; // keep this fraction of triangles
// Some scans ship two versions side by side (clean and weathered): keep one, centred on the origin.
const ONE_VARIANT = { hydrant: /_aged/, trash_can: /_rust/, military_crate: /_b$/ };
const RECENTRE = ['compressor']; // modelled away from the origin
// name in the game -> Poly Haven asset id
const MODELS = {
  crate: 'wooden_crate_01', military_crate: 'old_military_crate', barrel: 'barrel_03', barrier: 'concrete_road_barrier',
  street_lamp: 'street_lamp_01', trash_can: 'metal_trash_can', hydrant: 'fire_hydrant', utility_box: 'utility_box_01',
  plastic_crate: 'plastic_crate_01', covered_car: 'covered_car',
  shrub: 'shrub_01', bench: 'modular_street_seating',
  // the tycoon's production lines: machines, the boxes they turn out, and the till at the end
  drill_press: 'drill_press_01', generator: 'portable_generator', compressor: 'old_military_compressor',
  cash_register: 'CashRegister_01', box: 'cardboard_box_01',
  // inside the businesses: workshop and warehouse kit, and shop and office furniture
  shelves: 'steel_frame_shelves_01', shelves_narrow: 'steel_frame_shelves_02', rack: 'worn_metal_rack', tool_cart: 'tool_cart',
  tool_chest: 'metal_tool_chest', hand_truck: 'hand_truck', welding_cart: 'portable_welding_cart', storage_cart: 'industrial_storage_cart',
  fluorescent: 'mounted_fluorescent_lights', hanging_lamp: 'hanging_industrial_lamp', extinguisher: 'korean_fire_extinguisher_01',
  wet_floor: 'WetFloorSign_01', power_box: 'power_box_01', crate2: 'wooden_crate_02', propane: 'propane_tank', cement_bag: 'cement_bag',
  coffee_cart: 'CoffeeCart_01', bar_chair: 'bar_chair_round_01', round_table: 'round_wooden_table_01', display_shelves: 'wooden_display_shelves_01',
  wall_shelf: 'Shelf_01', plant: 'potted_plant_01', tv: 'Television_01', desk: 'metal_office_desk', armchair: 'modern_arm_chair_01',
  chalkboard: 'standing_chalkboard_01', crane: 'overhead_crane',
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
// Cars (Grab3D slug -> paint). Their paint is baked into a pastel texture: the dominant body colour is
// re-tinted to a real car colour (keeping the shading), the glass made dark, rims chrome.
const CARS = {
  sedan: { slug: '1990s-sedan', paint: '#1f2d45' },        // navy
  sedan2: { slug: '1980s-sedan', paint: '#5a1a1d' },       // maroon
  wagon: { slug: '1990s-station-wagon', paint: '#a3a7aa' }, // silver
  van: { slug: '1990s-delivery-van', paint: '#e4e3de', shade: 0.8 }, // white (shade: real white paint is greyer than the texture)
  suv: { slug: '1990s-suv', paint: '#151617' },            // black
  taxi: { slug: '1990s-taxi', paint: '#e8b10d' },          // taxi yellow
};
// Modelled building fronts (Poly Haven kits): piece name -> the kit parts merged into one 3 m bay. Ground
// floor bays (door, shop, plain) carry the plinth; upper bays carry the moulding along their floor line.
const KITS = {
  apartments: { id: 'modular_urban_apartments_facade', pieces: {
    door: ['wall_door_centered_large_01', 'door_centered_large_01', 'base_standard_01'],
    shop: ['wall_window_centered_double_01', 'window_centered_double_01', 'base_standard_01'],
    plain: ['wall_standard_standard_01', 'base_standard_01'],
    large: ['wall_window_centered_large_01', 'window_centered_large_01', 'cornice_standard_standard_01'],
    double: ['wall_window_centered_double_01', 'window_centered_double_01', 'cornice_standard_standard_01'],
    small: ['wall_window_centered_small_01', 'window_centered_small_01', 'cornice_standard_standard_01'],
    offset: ['wall_window_offset_small_01', 'window_offset_small_01', 'cornice_standard_standard_01'],
    crown: ['crown_standard_standard_01'], pier: ['wall_pier_corner_01'], crown_pier: ['crown_pier_corner_01'],
  } },
  factory: { id: 'modular_factory_facade', pieces: {
    door: ['wall_door_recessed_large_01', 'door_recessed_large_01', 'base_standard_standard_01'],
    shop: ['wall_window_tall_large_01', 'window_tall_large_01', 'base_standard_standard_01'],
    plain: ['wall_standard_standard_01', 'base_standard_standard_01'],
    large: ['wall_window_tall_large_01', 'window_tall_large_01', 'cornice02_standard_standard_01'],
    double: ['wall_window_centered_double_01', 'window_centered_double_01', 'cornice02_standard_standard_01'],
    small: ['wall_window_tall_small_01', 'window_tall_small_01', 'cornice02_standard_standard_01'],
    offset: ['wall_window_centered_large_01', 'window_centered_large_01', 'cornice02_standard_standard_01'],
    crown: ['crown_standard_standard_01'], pier: ['wall_pier_corner_01'], crown_pier: ['crown_pier_corner_01'],
  } },
  // chain-link fence round the lots you can't buy yet: a 1.9 m panel and a post
  // (the wire's see-through holes come as a separate alpha map: `alpha` puts it into the colour texture)
  fence: { id: 'modular_chainlink_fence', keep: true, pieces: { panel: ['modular_chainlink_fence_double'], post: ['modular_chainlink_fence_post'] },
    alpha: { modular_chainlink_fence_wire: 'wire_alpha' } },
};
const KIT_TEX = 1024;
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
  const steps = drop || RECENTRE.includes(path.basename(rel, '.glb')) ? [center({ pivot: 'below' }), dedup(), prune()] : [dedup(), prune()];
  if (ratio) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.04 })); // props are seen from metres away
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }));
  await doc.transform(...steps);
  save(rel, Buffer.from(await io.writeBinary(doc)));
}

fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
if (want('models')) console.log('Models (Poly Haven)');
const pickModels = only === 'models' && process.argv[3] ? process.argv[3].split(',') : null; // `models a,b` redoes just those
for (const [name, id] of want('models') ? Object.entries(MODELS).filter(([n]) => !pickModels || pickModels.includes(n)) : []) {
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

if (want('kits')) {
  console.log('Facade kits (Poly Haven, cut into bays with Blender)');
  for (const [name, kit] of Object.entries(KITS)) {
    if (only === 'kits' && process.argv[3] && process.argv[3] !== name) continue;
    const g = (await api(kit.id)).gltf['2k'].gltf, dir = path.join(TMP, kit.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kit.gltf'), await get(g.url));
    for (const [rel, f] of Object.entries(g.include || {})) { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), await get(f.url)); }
    fs.writeFileSync(path.join(dir, 'pieces.json'), JSON.stringify(kit.pieces));
    const raw = path.join(dir, 'out.glb');
    execFileSync('blender', ['-b', '--python', path.join(path.dirname(fileURLToPath(import.meta.url)), 'kit.py'), '--', path.join(dir, 'kit.gltf'), raw, path.join(dir, 'pieces.json'), kit.keep ? 'keep' : ''], { stdio: 'ignore' });
    const doc = await io.read(raw), files = await api(kit.id);
    for (const [mat, map] of Object.entries(kit.alpha || {})) {
      const m = doc.getRoot().listMaterials().find(x => x.getName() === mat), tex = m && m.getBaseColorTexture();
      if (!tex) continue;
      const img = sharp(Buffer.from(tex.getImage())), { width, height } = await img.metadata();
      const alpha = await sharp(await get(files[map]['2k'].jpg.url)).resize(width, height).toColourspace('b-w').raw().toBuffer();
      tex.setImage(await img.joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer()).setMimeType('image/png');
      m.setAlphaMode('MASK').setAlphaCutoff(0.5);
    }
    await writeGlb(doc, `models/kit_${name}.glb`, 0, KIT_TEX);
  }
}

if (want('cars')) {
  console.log('Cars (Grab3D, repainted)');
  const hsl = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, s, l]; };
  const rgb = (h, s, l) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h * 6) % 6]; return [r + m, g + m, b + m]; };
  for (const [name, car] of Object.entries(CARS)) {
    const raw = path.join(TMP, `car-${name}.glb`);
    fs.writeFileSync(raw, await get(`https://grab3d.com/dl/${car.slug}/${car.slug}.glb`));
    const doc = await io.read(raw), hex = car.paint.replace('#', ''), target = hsl(...[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
    for (const m of doc.getRoot().listMaterials()) {
      const n = m.getName();
      if (/glass/.test(n)) m.setBaseColorFactor([0.02, 0.025, 0.03, 1]).setRoughnessFactor(0.05).setMetallicFactor(0); // tinted glass: dark, reflects at grazing angles only
      else if (/rim/.test(n)) m.setMetallicFactor(1).setRoughnessFactor(0.16);
      else if (/_paint_/.test(n)) m.setBaseColorFactor([...rgb(...target), 1]);
      else if (/tire/.test(n)) m.setBaseColorFactor([0.32, 0.32, 0.33, 1]); // black rubber, not grey
      if (/body_pbr/.test(n)) m.setRoughnessFactor(0.5).setBaseColorFactor([car.shade || 1, car.shade || 1, car.shade || 1, 1]); // glossier paint (scales the texture's roughness)
      const tex = /body_pbr/.test(n) && m.getBaseColorTexture();
      if (!tex) continue;
      // find the body colour (the most common saturated hue) and move those pixels to the paint colour
      const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const bins = new Array(36).fill(0), px = [];
      for (let i = 0; i < data.length; i += 4) { const c = hsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255); px.push(c); if (c[1] > 0.25 && c[2] > 0.25 && c[2] < 0.9) bins[Math.floor(c[0] * 36) % 36]++; }
      const dom = (bins.indexOf(Math.max(...bins)) + 0.5) / 36;
      let ls = 0, ln = 0; for (const c of px) if (Math.min(Math.abs(c[0] - dom), 1 - Math.abs(c[0] - dom)) < 0.06 && c[1] > 0.18) { ls += c[2]; ln++; }
      const domL = ls / Math.max(1, ln);
      px.forEach((c, k) => {
        if (Math.min(Math.abs(c[0] - dom), 1 - Math.abs(c[0] - dom)) >= 0.06 || c[1] <= 0.18) return;
        const [r, g, b] = rgb(target[0], target[1], Math.min(0.97, target[2] * c[2] / domL));
        data[k * 4] = r * 255; data[k * 4 + 1] = g * 255; data[k * 4 + 2] = b * 255;
      });
      tex.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
    }
    await writeGlb(doc, `models/car_${name}.glb`, 0, 1024);
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

- **Poly Haven** (https://polyhaven.com), CC0: ${Object.values(MODELS).join(', ')} and the modular facade kits ${Object.values(KITS).map(k => k.id).join(', ')} (models); ${Object.values(TEXTURES).join(', ')} (textures); ${Object.values(SKIES).join(', ')} (HDRI skies).
- **ambientCG** (https://ambientcg.com), CC0: building facades ${Object.values(FACADES).flatMap(f => [f.day, f.night]).join(', ')}.
- **Grab3D** (https://grab3d.com), CC0 cars (repainted): ${Object.values(CARS).map(c => c.slug).join(', ')}.
- **OpenGameArt** (https://opengameart.org), CC0 guns: ${Object.values(GUNS).map(g => g.page).join(', ')} (https://opengameart.org/content/<name>).

People (MIT licence, notice below): **Microsoft Rocketbox** avatars ${Object.values(PEOPLE).join(', ')} and animations ${Object.values(PEOPLE_CLIPS).map(c => c.split('/')[1]).join(', ')} (https://github.com/microsoft/Microsoft-Rocketbox), converted to glTF.

> Copyright (c) Microsoft Corporation. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Fonts (SIL Open Font License 1.1, license files next to them): Barlow Condensed (Jeremy Tribby) and JetBrains Mono (JetBrains), via the @fontsource npm packages.

Re-download with \`node tools/fetch-assets.mjs\`.
`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('Done.');
