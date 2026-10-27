// 3D rendering for the web version (Three.js + add-ons from vendor/three.bundle.js).
// Draws the tycoon city and the fight arena with downloaded CC0 art (desktop/assets: animated
// Quaternius characters, Poly Haven photo-scanned props, PBR textures and HDRI skies), image-based
// lighting and post-processing. Scene layout comes from models.js so the desktop app matches.
// Game logic stays in shared.js; this file only draws.
(function () {
  const M = MODELS, A = M.ASSETS, S = M.ARENA.scale, PI = Math.PI;
  const BASE = 'desktop/assets/';
  const TEAM = ['#2f6fd6', '#d23b2e']; // you are always blue, your opponent red
  // Pages opened straight from disk (file://) can't fetch the art, so they fall back to simple shapes.
  const ASSETS_OK = location.protocol !== 'file:';

  // ---------- Asset loading (cached) ----------
  const cache = new Map();
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, ASSETS_OK ? fn().catch(e => { console.warn('Cash Clash: could not load', key, e); return null; }) : Promise.resolve(null)); return cache.get(key); };
  let gltfLoader, rgbeLoader, texLoader;
  function loaders() { if (!gltfLoader) { gltfLoader = new THREE.GLTFLoader(); rgbeLoader = new THREE.RGBELoader(); texLoader = new THREE.TextureLoader(); } }
  const loadGLB = rel => (loaders(), once('glb:' + rel, () => gltfLoader.loadAsync(BASE + rel)));
  const loadSky = name => (loaders(), once('sky:' + name, () => rgbeLoader.loadAsync(BASE + A.skies[name]).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; return t; })));
  // A PBR texture set ({map, normalMap, roughnessMap}); textures appear when they finish loading.
  const texSets = new Map();
  function texSet(name) {
    if (!ASSETS_OK || !A.textures.includes(name)) return null;
    if (!texSets.has(name)) {
      loaders();
      const load = (map, srgb) => { const t = texLoader.load(BASE + M.tex(name, map)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      texSets.set(name, { map: load('diff', true), normalMap: load('nor'), roughnessMap: load('rough') });
    }
    return texSets.get(name);
  }
  const pbrCache = new Map();
  // Photo-textured material (UVs carry the real-world tiling), or a plain colour when art is unavailable.
  function pbr(name, { tint = '#ffffff', rough = 1, metal = 0, fallback = '#888888', normal = 1 } = {}) {
    const key = [name, tint, rough, metal, normal].join('|');
    if (!pbrCache.has(key)) {
      const set = texSet(name);
      pbrCache.set(key, new THREE.MeshStandardMaterial(set
        ? { ...set, color: tint, roughness: rough, metalness: metal, normalScale: new THREE.Vector2(normal, normal) }
        : { color: fallback, roughness: 0.8, metalness: metal }));
    }
    return pbrCache.get(key);
  }
  // Box whose UVs are in metres / tile, so a texture keeps its real size on any box.
  function tiledBox(w, h, d, tile) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    return g;
  }
  function tiledPlane(w, d, tile) {
    const g = new THREE.PlaneGeometry(w, d), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    g.rotateX(-PI / 2); return g;
  }
  const shadows = (o, cast = true) => { o.traverse(c => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = true; } }); return o; };
  // Clones a loaded model; scales it to `height` metres if given (Poly Haven models are already real size).
  async function prop(name, height) {
    const g = await loadGLB(A.models[name]); if (!g) return null;
    const o = g.scene.clone(true);
    const h = height || A.heights[name];
    if (h) { const b = new THREE.Box3().setFromObject(o); o.scale.setScalar(h / Math.max(0.01, b.max.y - b.min.y)); }
    return shadows(o);
  }

  // ---------- Procedural parts from models.js (buildings, fallbacks) ----------
  const geoCache = new Map(), matCache = new Map();
  function geometry(p) {
    const key = p.t + p.s.join(',') + (p.seg || '') + (p.tx || '');
    if (!geoCache.has(key)) {
      const s = p.s, seg = p.seg;
      let g;
      if (p.t === 'box') g = p.tx ? tiledBox(s[0], s[1], s[2], 2.5) : new THREE.BoxGeometry(...s);
      else if (p.t === 'cyl') g = new THREE.CylinderGeometry(s[0], s[1], s[2], seg || 24);
      else if (p.t === 'sph') g = new THREE.SphereGeometry(s[0], seg || 28, Math.max(8, (seg || 28) * 0.7 | 0));
      else if (p.t === 'cone') g = new THREE.ConeGeometry(s[0], s[1], seg || 24);
      else g = new THREE.TorusGeometry(s[0], s[1], 16, 72);
      if (p.tx && p.t === 'cyl') { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * PI * s[1] / 2.5, uv.getY(i) * s[2] / 2.5); }
      geoCache.set(key, g);
    }
    return geoCache.get(key);
  }
  function material(p, team, unique) {
    if (p.tx && texSet(p.tx)) return pbr(p.tx, { tint: p.tc || '#ffffff', rough: 1, metal: p.m || 0 });
    const color = p.c === 'team' ? team : p.c;
    const key = [color, p.e, p.ei, p.m, p.ro, p.o].join('|');
    if (unique || !matCache.has(key)) {
      const glow = p.e && (p.ei ?? 1) > 1.2; // strong emitters glow through the bloom pass
      const m = new THREE.MeshStandardMaterial({
        color, metalness: p.m ?? 0.05, roughness: p.ro ?? 0.6,
        emissive: p.e || '#000000', emissiveIntensity: (p.ei ?? (p.e ? 1 : 0)) * (glow ? 1.6 : 1),
        transparent: p.o !== undefined && p.o < 1, opacity: p.o ?? 1,
      });
      if (unique) return m;
      matCache.set(key, m);
    }
    return matCache.get(key);
  }
  function build(model, team = TEAM[0]) {
    const root = new THREE.Group(), groups = {}, anims = [];
    for (const [name, g] of Object.entries(model.groups || {})) {
      const grp = new THREE.Group(); grp.position.set(...g.p); root.add(grp); groups[name] = grp;
      if (g.a) anims.push({ obj: grp, a: g.a, rot: grp.rotation.clone(), phase: Math.random() * 6 });
    }
    for (const p of model.parts || model) {
      const mesh = new THREE.Mesh(geometry(p), material(p, team, !!p.a || p.c === 'team'));
      mesh.position.set(...p.p);
      if (p.r) mesh.rotation.set(...p.r);
      if (p.sc) mesh.scale.set(...p.sc);
      mesh.castShadow = !(p.o < 1); mesh.receiveShadow = true;
      (p.g ? groups[p.g] : root).add(mesh);
      if (p.a) anims.push({ obj: mesh, a: p.a, base: mesh.position.clone(), rot: mesh.rotation.clone(), ei: mesh.material.emissiveIntensity, op: mesh.material.opacity, phase: Math.random() * 6 });
    }
    return { root, groups, anims };
  }
  function animate(anims, t) {
    for (const k of anims) {
      const o = k.obj, tt = t + k.phase;
      if (k.a === 'spin') o.rotation.z = k.rot.z + t * 0.8;
      else if (k.a === 'spinY') o.rotation.y = k.rot.y + t * 0.6;
      else if (k.a === 'pump') o.rotation.z = Math.sin(t * 2.2) * 0.32;
      else if (k.a === 'bob') o.position.y = k.base.y + Math.sin(tt * 2) * 0.15;
      else if (k.a === 'blink') o.material.emissiveIntensity = (tt % 1.2) < 0.6 ? k.ei : 0.05;
      else if (k.a === 'pulse') o.material.emissiveIntensity = k.ei * (0.75 + 0.25 * Math.sin(tt * 3));
      else if (k.a === 'smoke') {
        const f = (t * 0.35 + k.phase / 6) % 1;
        o.position.y = k.base.y + f * 2.4; o.position.x = k.base.x - f * 0.8;
        o.scale.setScalar(0.7 + f * 1.4); o.material.opacity = k.op * (1 - f);
      }
    }
  }

  // ---------- Renderer + post-processing ----------
  // Ambient occlusion (GTAO), bloom and SMAA. A governor drops the expensive bits on slow machines.
  // `overlay` (optional) is a second scene drawn on top with a fresh depth buffer: the first-person gun.
  function makeView(canvas, fov, overlay) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 900);
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const ao = new THREE.GTAOPass(scene, camera, 256, 256);
    ao.blendIntensity = 0.85; ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1 });
    composer.addPass(ao);
    if (overlay) { const vm = new THREE.RenderPass(overlay, camera); vm.clear = false; vm.clearDepth = true; composer.addPass(vm); }
    // GTA IV-style bloom: bright sky and highlights bleed a soft glow
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.65, 1.25);
    composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());
    const grade = new THREE.ShaderPass(GRADE); composer.addPass(grade);
    const smaa = new THREE.SMAAPass(256, 256); composer.addPass(smaa);
    // 3 = everything on, 2 = no ambient occlusion, 1 = also lower resolution, 0 = also no post effects.
    // ?quality=low|medium|high in the URL pins it.
    const pinned = { low: 0, medium: 2, high: 3 }[new URLSearchParams(location.search).get('quality')];
    let w = 0, h = 0, slow = 0, tier = 3, lastFrame = 0;
    function setTier(n) {
      tier = n; ao.enabled = tier >= 3; w = 0;
      renderer.setPixelRatio(tier >= 2 ? Math.min(devicePixelRatio, 1.75) : 1);
      renderer.shadowMap.type = tier >= 1 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    }
    if (pinned !== undefined) setTier(pinned);
    return {
      renderer, scene, camera, composer, bloom, ao,
      get tier() { return tier; },
      render(dt) {
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!cw || !ch) return;
        if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
        // quality governor: about 2 seconds of frames slower than ~30fps steps the quality down a tier
        const now = performance.now(), real = lastFrame ? (now - lastFrame) / 1000 : 0; lastFrame = now;
        if (pinned === undefined && real > 0 && real < 5) {
          slow = real > 0.034 ? slow + real : Math.max(0, slow - real * 0.5);
          if (slow > 2 && tier > 0) { slow = 0; setTier(tier - 1); }
        }
        grade.uniforms.time.value = (now / 1000) % 100;
        if (tier > 0) return composer.render(dt);
        renderer.render(scene, camera);
        if (overlay) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlay, camera); renderer.autoClear = true; }
      },
    };
  }
  // Colour grade after tone mapping, in the spirit of GTA IV: washed-out colour, a little more contrast,
  // warm sepia shadows and creamy highlights, a heavy vignette and fine film grain.
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, saturation: { value: 0.74 }, contrast: { value: 1.12 },
      shadowTint: { value: new THREE.Vector3(0.035, 0.02, 0.0) }, highTint: { value: new THREE.Vector3(0.025, 0.018, -0.03) },
      vignette: { value: 0.42 }, grain: { value: 0.035 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, saturation, contrast, vignette, grain; uniform vec3 shadowTint, highTint; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation);
        c.rgb = (c.rgb - 0.5) * contrast + 0.5;
        c.rgb += shadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + highTint * smoothstep(0.45, 1.0, l);
        float d = length(vUv - 0.5) * 1.35;
        c.rgb *= 1.0 - vignette * smoothstep(0.4, 1.05, d);
        float n = fract(sin(dot(vUv * 913.0 + time * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (n - 0.5) * grain;
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
      }`,
  };
  // Sky + image-based lighting from an HDRI (with a flat-colour fallback).
  // `current()` says whether this sky is still wanted once it has loaded (the map may have changed meanwhile).
  async function applySky(view, name, exposure, current = () => true) {
    const hdr = await loadSky(name);
    if (!current()) return;
    view.renderer.toneMappingExposure = exposure;
    if (hdr) { view.scene.background = hdr; view.scene.environment = hdr; view.scene.backgroundBlurriness = 0.02; }
    else { const c = { day: '#9fc3e6', sunset: '#e7a978', dusk: '#6b5a7e', night: '#141a30' }[name]; view.scene.background = new THREE.Color(c); view.scene.environment = null; }
  }
  function sun(scene, color, intensity, range) {
    const d = new THREE.DirectionalLight(color, intensity);
    d.position.set(18, 30, 12); d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048); d.shadow.bias = -0.0003; d.shadow.normalBias = 0.03;
    Object.assign(d.shadow.camera, { left: -range, right: range, top: range, bottom: -range, near: 1, far: 100 });
    scene.add(d, d.target); return d;
  }
  // Billboard with a name and health bar.
  function labelSprite() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    // depth-tested, so walls hide it: a tag that shows through walls would be a wall-hack
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, toneMapped: false }));
    s.renderOrder = 10; s.userData = { c, tex, key: '' };
    return s;
  }
  // Soft round sprite texture for smoke, flashes and sparks.
  let softTex;
  function soft() {
    if (softTex) return softTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (softTex = new THREE.CanvasTexture(c));
  }

  // ---------- City blocks: GTA-style streets around the arena or the business ----------
  // Layout comes from models.js cityLayout(), so the desktop app (r3d.gd) builds the same streets.
  const U = M.URBAN;
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Box at (x, y, z) whose UVs are in metres / tu across and / tv up: textures keep their real size and
  // a painted window grid lines up with the floors. `color` fills a vertex colour (tints one shared material).
  function boxGeo(w, h, d, tu, tv, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d / tu, h / tv], [d / tu, h / tv], [w / tu, d / tu], [w / tu, d / tu], [w / tu, h / tv], [w / tu, h / tv]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    g.translate(x, y, z);
    if (color) { const c = new THREE.Color(color), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
    return g;
  }
  // Many boxes that share a material become one mesh (one draw call).
  function mergeGeos(list) {
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
    const col = !!list[0].attributes.color, out = new THREE.BufferGeometry(), idx = new Uint32Array(ni);
    const attrs = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), uv: new Float32Array(nv * 2) };
    if (col) attrs.color = new Float32Array(nv * 3);
    let v = 0, i = 0;
    for (const g of list) {
      for (const k in attrs) attrs[k].set(g.attributes[k].array, v * g.attributes[k].itemSize);
      const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[i + k] = gi[k] + v;
      v += g.attributes.position.count; i += gi.length; g.dispose();
    }
    for (const k in attrs) out.setAttribute(k, new THREE.BufferAttribute(attrs[k], k === 'uv' ? 2 : 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  // Photographed building fronts (ambientCG): colour, relief, roughness and metal (the glass) by day; at
  // night the same building with its lights on, glowing through an emission map.
  const facadeMats = new Map();
  function facadeMat(name, night, tint) {
    const key = [name, night, tint].join('|');
    if (facadeMats.has(key)) return facadeMats.get(key);
    loaders();
    const load = (map, srgb) => { const t = texLoader.load(BASE + `textures/facade_${name}_${map}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const m = !ASSETS_OK ? new THREE.MeshStandardMaterial({ color: '#8a7f75', roughness: 0.85 }) : new THREE.MeshStandardMaterial({
      map: load(night ? 'night' : 'diff', true), normalMap: load('nor'), roughnessMap: load('rough'), color: tint,
      metalnessMap: name === 'tower' ? null : load('metal'), metalness: name === 'tower' ? 0.1 : 1,
      emissiveMap: night ? load('emit', true) : null, emissive: night ? '#ffffff' : '#000000', emissiveIntensity: night ? 0.55 : 0 });
    facadeMats.set(key, m);
    return m;
  }
  // Wet asphalt: puddles (a tiling noise pattern) are glassy and darker, so they mirror the sky and lights.
  let puddleTex = null;
  function puddles() {
    if (puddleTex) return puddleTex;
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N);
    const h = (i, j) => { const s = Math.sin(((i % 16 + 16) % 16) * 127.1 + ((j % 16 + 16) % 16) * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (u, v) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, a = h(i, j), b = h(i + 1, j), cc = h(i, j + 1), d = h(i + 1, j + 1), su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv); return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / N * 16, v = j / N * 16, n = vn(u, v) * 0.6 + vn(u * 2, v * 2) * 0.3 + vn(u * 4, v * 4) * 0.1; // tiles: periodic at 16 cells
      const wet = THREE.MathUtils.smoothstep(n, 0.6, 0.68), g = Math.round(255 * (0.8 - wet * 0.66 + (vn(u * 8, v * 8) - 0.5) * 0.1));
      const k = (j * N + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = g; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    puddleTex = new THREE.CanvasTexture(c); puddleTex.wrapS = puddleTex.wrapT = THREE.RepeatWrapping;
    return puddleTex;
  }
  function wetGround() {
    const m = pbr('asphalt', { tint: '#8d8c88', fallback: '#3d3e40' }).clone();
    if (!m.map) return m;
    m.roughnessMap = puddles(); m.roughnessMap.repeat.set(7 / 34, 7 / 34); m.roughness = 1; m.envMapIntensity = 1.3;
    m.onBeforeCompile = sh => { // puddles also look darker: wet surfaces absorb more light
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.1, 0.7, roughnessFactor));');
    };
    return m;
  }
  // Soft dark blotch for oil stains.
  let stainTex = null;
  function stain() {
    if (stainTex) return stainTex;
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), r = rng(5);
    for (let i = 0; i < 9; i++) { const g = x.createRadialGradient(64 + (r() - 0.5) * 50, 64 + (r() - 0.5) * 50, 0, 64, 64, 30 + r() * 30); g.addColorStop(0, 'rgba(8,7,6,.45)'); g.addColorStop(1, 'rgba(8,7,6,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
    return (stainTex = new THREE.CanvasTexture(c));
  }
  // The streets (wet asphalt, lane paint, crossings, stains, manholes), sidewalks, buildings with photo
  // facades (storefronts, ledges, cornices and roof tanks up close), the skyline in the haze, and street
  // furniture. Returns the group. `detail` false (the lowest quality) leaves out the small stuff.
  function buildCity(where, night, detail = true) {
    const group = new THREE.Group(), L = M.cityLayout(where), batches = new Map(), T = U.facadeTile;
    const add = (key, mat, geo) => { if (!batches.has(key)) batches.set(key, { mat, geos: [] }); batches.get(key).geos.push(geo); };
    const ground = new THREE.Mesh(tiledPlane(1000, 1000, 7), wetGround()); ground.position.y = -0.04; ground.receiveShadow = true; group.add(ground);
    const pav = pbr('pavers', { tint: '#b7b1a7', fallback: '#77746f' });
    for (const [x0, z0, x1, z1] of L.sidewalks) add('pav', pav, boxGeo(x1 - x0, 0.15, z1 - z0, 2.5, 2.5, (x0 + x1) / 2, 0.075, (z0 + z1) / 2));
    const trim = pbr('concrete_wall', { tint: '#a9a49b', fallback: '#8a857d' }), tankMat = new THREE.MeshStandardMaterial({ color: '#5e4a3a', roughness: 0.9 });
    const shops = [pbr('shutter', { tint: '#8d8f8c', fallback: '#4a4c4b' }), pbr('plaster', { tint: '#5a514a', fallback: '#4a443e' })];
    for (const b of L.buildings) {
      const k = b.shade ? '+' : ''; // buildings near the middle cast shadows; batched separately
      add(b.facade + b.tint + k, facadeMat(b.facade, night, b.tint), boxGeo(b.w, b.h, b.d, T[b.facade], T[b.facade], b.x, b.h / 2, b.z));
      add('trim' + k, trim, boxGeo(b.w + 0.5, 0.5, b.d + 0.5, 2.5, 2.5, b.x, b.h - 0.1, b.z)); // cornice (also the roof)
      if (!b.near || !detail) continue;
      add('shop' + (b.seed % 2) + k, shops[b.seed % 2], boxGeo(b.w + 0.12, 3.25, b.d + 0.12, 2.5, 2.5, b.x, 1.625, b.z)); // ground-floor storefronts
      add('trim' + k, trim, boxGeo(b.w + 0.3, 0.35, b.d + 0.3, 2.5, 2.5, b.x, 3.42, b.z)); // ledge over the shops
      if (b.tank) { // a timber water tank on legs, New York style
        const tx = b.x + (b.seed % 3 - 1) * b.w * 0.2, tz = b.z + ((b.seed >> 2) % 3 - 1) * b.d * 0.2;
        for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) add('tank', tankMat, boxGeo(0.18, 2.2, 0.18, 1, 1, tx + lx, b.h + 1.1, tz + lz));
        const cyl = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 14); cyl.translate(tx, b.h + 3.8, tz); add('tank', tankMat, cyl);
        const cone = new THREE.ConeGeometry(1.75, 1.1, 14); cone.translate(tx, b.h + 5.95, tz); add('tank', tankMat, cone);
      }
    }
    for (const t of L.skyline) add('tower', facadeMat('tower', night, t.tint), boxGeo(t.w, t.h, t.d, T.tower, T.tower, t.x, t.h / 2, t.z));
    // road paint
    const yellow = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.55 }), white = new THREE.MeshStandardMaterial({ color: '#d9d6cc', roughness: 0.55 });
    for (const [x0, z0, x1, z1] of L.dashes) add('yellow', yellow, boxGeo(x1 - x0, 0.01, z1 - z0, 1, 1, (x0 + x1) / 2, -0.03, (z0 + z1) / 2));
    for (const [x0, z0, x1, z1] of L.stripes) add('white', white, boxGeo(x1 - x0, 0.01, z1 - z0, 1, 1, (x0 + x1) / 2, -0.03, (z0 + z1) / 2));
    for (const [key, { mat, geos }] of batches) {
      const mesh = new THREE.Mesh(mergeGeos(geos), mat);
      mesh.castShadow = key.endsWith('+'); mesh.receiveShadow = true; group.add(mesh);
    }
    if (detail) { // oil stains and manhole covers
      const stainMat = new THREE.MeshBasicMaterial({ map: stain(), transparent: true, depthWrite: false, color: '#ffffff' });
      const blot = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), stainMat, L.stains.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      L.stains.forEach(([x, z, s, a], i) => blot.setMatrixAt(i, m4.compose(p.set(x, -0.02, z), q.setFromAxisAngle(UP, a), sc.set(s, 1, s * 0.7))));
      blot.renderOrder = 1; group.add(blot);
      const cover = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 20), new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.45, metalness: 0.7 }), L.manholes.length);
      L.manholes.forEach(([x, z], i) => cover.setMatrixAt(i, m4.compose(p.set(x, -0.03, z), q.identity(), sc.set(1, 1, 1))));
      cover.receiveShadow = true; group.add(cover);
    }
    // street lamps (the nearest few light up at night), parked cars, hydrants and bins
    let lights = 0;
    for (const d of [...L.lamps, ...L.cars, ...(detail ? L.props : [])]) prop(d.model).then(o => {
      if (!o) return; o.position.set(...d.p); o.rotation.y = d.ry; group.add(o);
      if (d.light && night && lights++ < 6) { const l = new THREE.PointLight('#ffd49a', 60, 22, 2); l.position.set(d.p[0], 5.3, d.p[2]); group.add(l); }
    });
    return group;
  }

  // ---------- People (the opponent) ----------
  // Photoreal Rocketbox people. Their legs run where they're going; the upper body twists to where
  // they aim and both arms reach for the gun, which is held out in front of the chest (posed in code
  // after the animation each frame, the way GTA does it). They fall when they die.
  const findClip = (clips, name) => clips.find(c => c.name === name || c.name.endsWith('|' + name));
  const F = A.fighter;
  const UP = new THREE.Vector3(0, 1, 0);
  // Same opponent, same person: picked from their name.
  const personFor = name => F.people[Math.abs([...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % F.people.length];
  async function makeCharacter(team, who) {
    const g = await loadGLB(A.characters[who]);
    const root = new THREE.Group();
    // a glowing team ring under the feet makes the two sides readable at a glance
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM[team]).multiplyScalar(2), transparent: true, opacity: 0.85, toneMapped: false }));
    ring.rotation.x = -PI / 2; ring.position.y = 0.03; root.add(ring);
    const ch = { root, team, who, actions: {}, current: null, mixer: null, gunHolder: new THREE.Group(), gunId: null, hitT: 0, flashT: 0, prev: null, dead: false, legs: 0, deathT: 0 };
    root.add(ch.gunHolder);
    if (!g) { // fallback: the procedural soldier
      const b = build(M.SOLDIER, TEAM[team]); root.add(b.root);
      Object.assign(ch, { legsGroups: b.groups, procedural: true });
      root.remove(ch.gunHolder); ch.gunHolder = b.groups.gun;
      return ch;
    }
    // body (turned to where the legs go) > fall (tips over on death) > model
    const body = new THREE.Group(), fall = new THREE.Group(), model = THREE.SkeletonUtils.clone(g.scene);
    root.add(body); body.add(fall); fall.add(model);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const bone = name => { const n = THREE.PropertyBinding.sanitizeNodeName(name); let b = null; model.traverse(o => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
    ch.bones = { spine: F.bones.spine.map(bone), head: bone(F.bones.head), R: F.bones.R.map(bone), L: F.bones.L.map(bone),
      fingerR: bone('Bip01 R Finger2'), fingerL: bone('Bip01 L Finger2') };
    // turn the model so it faces +X (the game's forward): its right is from the left shoulder to the right one
    model.updateMatrixWorld(true);
    const right = ch.bones.R[0].getWorldPosition(new THREE.Vector3()).sub(ch.bones.L[0].getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const fwd = new THREE.Vector3().crossVectors(UP, right);
    model.rotation.y = Math.atan2(fwd.z, fwd.x);
    ch.mixer = new THREE.AnimationMixer(model);
    for (const key of ['idle', 'run', 'walk']) { const clip = findClip(g.animations, key); if (clip) ch.actions[key] = ch.mixer.clipAction(clip); }
    play(ch, 'idle', 0);
    Object.assign(ch, { body, fall, model });
    return ch;
  }
  function play(ch, key, fade = 0.2) {
    const a = ch.actions[key]; if (!a || ch.current === a) return;
    a.reset().fadeIn(fade).play();
    if (ch.current) ch.current.fadeOut(fade);
    ch.current = a; ch.currentKey = key;
  }
  const wrapAng = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
  // ----- posing helpers (world space) -----
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function turnBone(b, q) { // rotate bone b by world rotation q
    b.parent.getWorldQuaternion(_q2);
    const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
    b.quaternion.copy(_q2.invert().multiply(world)); b.updateMatrixWorld(true);
  }
  function pointBone(b, child, target) { // turn b so its child lies on the line towards target
    const o = b.getWorldPosition(new THREE.Vector3()), d = child.getWorldPosition(_v).sub(o).normalize(), t = _v2.copy(target).sub(o).normalize();
    turnBone(b, _q.setFromUnitVectors(d, t));
  }
  // Two-bone arm: upper arm, forearm and wrist reach `target`, elbow bending towards `pole`.
  function reach([upper, fore, hand], target, pole) {
    const s = upper.getWorldPosition(new THREE.Vector3()), a = fore.getWorldPosition(new THREE.Vector3()).distanceTo(s), b = hand.getWorldPosition(new THREE.Vector3()).distanceTo(fore.getWorldPosition(_v));
    const dir = target.clone().sub(s); const c = Math.min(dir.length(), (a + b) * 0.999); dir.normalize();
    const x = (a * a - b * b + c * c) / (2 * c), y = Math.sqrt(Math.max(0, a * a - x * x));
    const bend = pole.clone().sub(s); bend.addScaledVector(dir, -bend.dot(dir)).normalize();
    pointBone(upper, fore, s.clone().addScaledVector(dir, x).addScaledVector(bend, y));
    pointBone(fore, hand, s.clone().addScaledVector(dir, c));
  }
  // Each frame after the animation: twist the spine from where the legs face to the aim, hold the gun
  // out in front of the chest and put both hands on it. `aim` is the game angle (0 = +X).
  function poseAim(ch, aim, recoil) {
    const B = ch.bones; if (!B.spine[2] || !B.R[2]) return;
    const twist = Math.max(-1.8, Math.min(1.8, wrapAng(aim - ch.legs)));
    for (const sb of B.spine) turnBone(sb, _q.setFromAxisAngle(UP, -twist / 3));
    const d = new THREE.Vector3(Math.cos(aim), 0, Math.sin(aim)), rt = new THREE.Vector3(-Math.sin(aim), 0, Math.cos(aim));
    const chest = B.spine[2].getWorldPosition(new THREE.Vector3()), hold = F.hold[ch.gunId] || F.hold.pistol, len = F.gunLen[ch.gunId] || 0.4;
    const grip = chest.clone().addScaledVector(d, hold[0] - recoil * 0.06).addScaledVector(UP, -hold[1] + 0.12).addScaledVector(rt, hold[2]);
    // the gun: grip at `grip`, barrel along the aim
    ch.gunHolder.position.copy(grip).sub(ch.root.position); ch.gunHolder.rotation.set(0, -aim - PI / 2, 0); ch.gunHolder.rotateX(recoil * 0.12);
    const down = UP.clone().negate();
    reach(B.R, grip.clone().addScaledVector(d, -0.07), chest.clone().addScaledVector(down, 0.7).addScaledVector(rt, 0.6));
    const support = ch.gunId === 'pistol' ? grip.clone().addScaledVector(rt, -0.06).addScaledVector(d, -0.02) : grip.clone().addScaledVector(d, len * 0.42).addScaledVector(UP, -0.03);
    reach(B.L, support, chest.clone().addScaledVector(down, 0.7).addScaledVector(rt, -0.6));
    // hands line up with the gun
    if (B.fingerR) pointBone(B.R[2], B.fingerR, B.R[2].getWorldPosition(new THREE.Vector3()).addScaledVector(d, 1).addScaledVector(down, 0.25));
    if (B.fingerL) pointBone(B.L[2], B.fingerL, B.L[2].getWorldPosition(new THREE.Vector3()).addScaledVector(d, 0.6).addScaledVector(rt, 0.6));
    if (B.head) turnBone(B.head, _q.setFromAxisAngle(UP, -wrapAng(aim - ch.legs - twist) * 0.5));
  }
  // Puts the equipped gun in the fighter's hands (same models as the first-person view).
  async function setGun(ch, id) {
    ch.gunId = id;
    const len = F.gunLen[id], gun = await makeViewmodel(id, len);
    if (ch.gunId !== id) return;
    if (ch.gun) ch.gunHolder.remove(ch.gun);
    gun.position.set(0, 0.04, -len * 0.3); // grip in the hand, barrel ahead
    gun.traverse(c => { if (c.isMesh) c.castShadow = true; });
    ch.gun = gun; ch.gunHolder.add(gun);
  }
  // Where bullets leave the barrel.
  function muzzleOf(ch, ang, out) {
    if (ch.gun) { ch.gun.updateMatrixWorld(true); return ch.gun.localToWorld(out.set(0, 0, -(ch.gun.userData.len || 0.5) / (ch.gun.scale.x || 1) * 0.5)); }
    return out.set(ch.root.position.x + Math.cos(ang) * 0.8, 1.3, ch.root.position.z + Math.sin(ang) * 0.8);
  }
  // ---------- First-person weapon ----------
  // Realistic gun models, already turned so the barrel points down -Z (the camera's forward), sights up.
  const VM_LEN = { pistol: 0.24, smg: 0.44, shotgun: 0.62, sniper: 0.62, rocket: 0.62 };
  async function makeViewmodel(id, length = VM_LEN[id]) {
    const wrap = new THREE.Group(), orient = new THREE.Group(); wrap.add(orient);
    const g = await loadGLB(A.guns[id]);
    let gun = null;
    if (g) { gun = g.scene.clone(true); gun.traverse(c => { if (c.isMesh) { c.castShadow = false; c.frustumCulled = false; } }); orient.add(gun); }
    if (!gun) { gun = build(M.GUNS[id]).root; orient.add(gun); orient.rotation.y = PI / 2; } // procedural guns face +X
    // centre it and scale to a believable length along the barrel (now -Z)
    orient.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(orient), size = box.getSize(new THREE.Vector3());
    orient.position.copy(box.getCenter(new THREE.Vector3())).negate();
    const k = length / Math.max(0.001, size.x, size.y, size.z);
    wrap.scale.setScalar(k);
    wrap.userData.len = length; wrap.userData.h = size.y * k; // height decides how low it's held
    return wrap;
  }

  // ---------- Arena (first person) ----------
  const toWorld = (x, y) => [x * S - 22.5, y * S - 14];
  const EYE = 1.62;
  function createArena(canvas) {
    const vmScene = new THREE.Scene(); // the held weapon, drawn on top so it never pokes into walls
    const view = makeView(canvas, 64, vmScene), { scene, camera } = view;
    camera.near = 0.05; camera.rotation.order = 'YXZ';
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mapIndex = -1, mapGroup = null, sunLight = null, mapToken = 0, frameDt = 1 / 60, clock = 0;
    const chars = [null, null], pending = [null, null];
    const tracers = [], seen = [], puffs = [];
    const tracerGeo = new THREE.BoxGeometry(1.1, 0.035, 0.035), rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12);
    const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(5), toneMapped: false });
    const rocketMat = new THREE.MeshStandardMaterial({ color: '#4a5a2a', roughness: 0.6, emissive: '#ff7b1f', emissiveIntensity: 0.4 });
    const boomLight = new THREE.PointLight('#ff8a3a', 0, 14, 2); scene.add(boomLight);
    const myFlash = new THREE.PointLight('#ffc46b', 0, 8, 2); scene.add(myFlash);
    // viewmodel rig: follows the camera; the gun sits low and to the right
    const vmRoot = new THREE.Group(), vmHold = new THREE.Group(); vmScene.add(vmRoot); vmRoot.add(vmHold);
    vmScene.add(new THREE.HemisphereLight('#ffffff', '#45403a', 0.9));
    const vmKey = new THREE.DirectionalLight('#fff4e0', 1.6); vmKey.position.set(1, 2, 1); vmScene.add(vmKey);
    const vmFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color('#ffd27a').multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    vmFlare.visible = false; vmFlare.userData.t = 0; vmRoot.add(vmFlare);
    let vmGun = null, vmId = null, raise = 1, kick = 0, walk = 0, sway = 0, lastYaw = null, reloadK = 0, eye = EYE, roll = 0;
    const me = { lastAmmo: undefined, lastGun: null, lastHp: undefined, prev: null };
    let shake = 0;
    const events = { hitEnemy: false, hurt: false, shot: false };

    async function buildMap(m) {
      const token = ++mapToken;
      if (mapGroup) scene.remove(mapGroup);
      const grp = mapGroup = new THREE.Group(); mapIndex = m; scene.add(grp);
      const th = M.ARENA.themes[m], walls = CC.MAPS[m].walls, Hh = M.ARENA.wallHeight;
      applySky(view, th.sky, th.exposure, () => token === mapToken).then(() => { vmScene.environment = scene.environment; });
      scene.fog = new THREE.FogExp2(U.haze[th.sky], U.fog); // city smog: distant blocks fade out
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 32);
      // floors
      const floor = new THREE.Mesh(tiledPlane(45, 28, th.floorTile), pbr(th.floorTex, { tint: th.floorTint || '#ffffff', fallback: '#6e6a63' })); floor.receiveShadow = true; grp.add(floor);
      // a paved courtyard around the arena, walled in by city blocks
      const [cx, cz] = U.arena.clear;
      const apron = new THREE.Mesh(tiledPlane(2 * cx, 2 * cz, 5), pbr(th.outerTex, { tint: '#bbbbbb', fallback: '#4a4a48' })); apron.position.y = -0.02; apron.receiveShadow = true; grp.add(apron);
      grp.add(buildCity('arena', th.lampsOn, view.tier > 0));
      const lineMat = new THREE.MeshStandardMaterial({ color: th.line, roughness: 0.55 });
      for (const [w, d, x, z] of [[45, 0.14, 0, -13.93], [45, 0.14, 0, 13.93], [0.14, 28, -22.43, 0], [0.14, 28, 22.43, 0]]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), lineMat); l.position.set(x, 0.007, z); l.receiveShadow = true; grp.add(l);
      }
      // low concrete curb around the arena
      for (const [w, d, x, z] of [[46.2, 0.5, 0, -14.3], [46.2, 0.5, 0, 14.3], [0.5, 29.1, -22.85, 0], [0.5, 29.1, 22.85, 0]]) {
        const b = new THREE.Mesh(tiledBox(w, 0.7, d, 3), pbr('concrete_wall', { tint: '#c9c4bb', fallback: '#8a8680' })); b.position.set(x, 0.35, z); shadows(b); grp.add(b);
      }
      // cover walls
      const trim = new THREE.MeshStandardMaterial({ color: th.trim, roughness: 0.3, metalness: th.wallStyle === 'marble' ? 1 : 0.6 });
      const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.trim).multiplyScalar(4), toneMapped: false });
      const steel = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.35, metalness: 0.85 });
      for (const [i, [x, y, w, h]] of walls.entries()) {
        const [wx, wz] = toWorld(x + w / 2, y + h / 2), W = w * S, D = h * S;
        if (th.wallStyle === 'containers' && W <= 3.2 && D <= 3.2) { stackCrates(grp, wx, wz, W, D, token); continue; }
        const tint = th.tints[i % th.tints.length];
        const body = new THREE.Mesh(tiledBox(W, Hh, D, th.wallTile), pbr(th.wallTex, { tint, metal: th.wallStyle === 'metal' ? 0.5 : th.wallStyle === 'containers' ? 0.2 : 0, rough: 1, fallback: tint }));
        body.position.set(wx, Hh / 2, wz); shadows(body); grp.add(body);
        const edge = (ww, hh, dd, px, py, pz, mat = trim) => { const e = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), mat); e.position.set(px, py, pz); shadows(e); grp.add(e); };
        if (th.wallStyle === 'containers') { // steel frame: corner posts + top and bottom rails
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) edge(0.14, Hh, 0.14, wx + sx * (W / 2 - 0.05), Hh / 2, wz + sz * (D / 2 - 0.05));
          edge(W + 0.04, 0.12, D + 0.04, wx, Hh - 0.04, wz); edge(W + 0.04, 0.12, D + 0.04, wx, 0.06, wz);
        } else if (th.wallStyle === 'metal') {
          edge(W + 0.03, 0.05, D + 0.03, wx, 0.35, wz, neon); edge(W + 0.03, 0.05, D + 0.03, wx, Hh - 0.25, wz, neon); edge(W + 0.1, 0.1, D + 0.1, wx, Hh + 0.05, wz, steel);
        } else { // stone and marble: a cap and a plinth
          edge(W + 0.16, 0.14, D + 0.16, wx, Hh + 0.07, wz); edge(W + 0.1, 0.18, D + 0.1, wx, 0.09, wz);
        }
      }
      // decorations outside the play area, and street lamps (lit on night/dusk maps)
      let lights = 0;
      for (const d of th.decor) {
        prop(d.model).then(o => {
          if (!o || token !== mapToken) return;
          o.position.set(...d.p); o.rotation.y = d.ry; if (d.s) o.scale.multiplyScalar(d.s); grp.add(o);
          if (d.light && th.lampsOn && lights++ < 6) { const l = new THREE.PointLight('#ffd8a0', 60, 22, 2); l.position.set(d.p[0], 5.2, d.p[2]); grp.add(l); }
        });
      }
    }
    // Small cover blocks on the Warehouse map are stacks of wooden crates that fill the block.
    async function stackCrates(grp, wx, wz, W, D, token) {
      const g = await loadGLB(A.models.crate);
      if (token !== mapToken) return;
      if (!g) { const b = new THREE.Mesh(tiledBox(W, M.ARENA.wallHeight, D, 2), pbr('corrugated', { fallback: '#9b6b3c' })); b.position.set(wx, M.ARENA.wallHeight / 2, wz); grp.add(shadows(b)); return; }
      const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      const nx = Math.max(1, Math.round(W / 1.2)), nz = Math.max(1, Math.round(D / 1.2)), cx = W / nx, cz = D / nz, cy = 1.25;
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) for (let lv = 0; lv < 2; lv++) {
        const o = shadows(g.scene.clone(true));
        o.scale.set(cx * 0.98 / size.x, cy * 0.98 / size.y, cz * 0.98 / size.z);
        o.position.set(wx - W / 2 + cx * (i + 0.5), lv * cy, wz - D / 2 + cz * (k + 0.5));
        o.rotation.y = ((i + k + lv) % 2) * PI; grp.add(o);
      }
    }
    // Name + health tag above the opponent, set in the HUD's typefaces.
    function tag(ch, s, name) {
      const key = s.hp + '/' + s.mhp + name;
      if (ch.bar.userData.key === key) return;
      const { c, tex } = ch.bar.userData, x = c.getContext('2d');
      x.clearRect(0, 0, 256, 64);
      x.font = "600 26px 'Barlow Condensed', 'Arial Narrow', sans-serif"; x.textAlign = 'center'; x.fillStyle = '#F2EFE8'; x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 5;
      x.fillText(name, 128, 26); x.shadowBlur = 0;
      x.fillStyle = 'rgba(11,13,16,.75)'; x.fillRect(28, 36, 200, 12);
      const f = Math.max(0, s.hp / s.mhp);
      x.fillStyle = f > 0.35 ? '#4ade80' : '#f87171'; x.fillRect(30, 38, 196 * f, 8);
      tex.needsUpdate = true; ch.bar.userData.key = key;
    }
    function ensureChar(team, who) {
      if (chars[team] || pending[team]) return;
      pending[team] = makeCharacter(team, who).then(ch => {
        ch.bar = labelSprite(); ch.bar.scale.set(1.6, 0.4, 1); ch.bar.position.y = 2.3; ch.root.add(ch.bar);
        ch.flash = new THREE.PointLight('#ffc46b', 0, 7, 2); scene.add(ch.flash);
        ch.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color('#ffd27a').multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        ch.flare.scale.setScalar(0.6); ch.flare.visible = false; scene.add(ch.flare);
        scene.add(ch.root); chars[team] = ch; pending[team] = null;
      });
    }
    async function setViewmodel(id) {
      vmId = id; raise = 0;
      const gun = await makeViewmodel(id);
      if (vmId !== id) return;
      if (vmGun) vmHold.remove(vmGun);
      vmGun = gun; vmHold.add(gun);
    }
    function pool(arr, make) { for (const o of arr) if (!o.visible) return o; const o = make(); arr.push(o); scene.add(o); return o; }
    function puff(x, y, z, color, size, life, rise) {
      const p = pool(puffs, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), transparent: true, depthWrite: false })));
      p.material.color.set(color); p.position.set(x, y, z); p.userData = { t: 0, life, size, v: new THREE.Vector3((Math.random() - .5) * 1.2, rise, (Math.random() - .5) * 1.2) };
      p.visible = true; p.scale.setScalar(size);
    }

    return {
      events,
      // v: { m, u: [{x,y,hp,mhp,ang,g:{id,ammo,rl}}], b: [[x,y,big,vx,vy]], fx: [[x,y,r,t]] }; you: your index;
      // names: [you, opponent]; pitch: where you look up/down (visual only: the fight is on a flat plane)
      update(v, you, names, dt, pitch = 0) {
        frameDt = dt; clock += dt;
        events.hitEnemy = events.hurt = events.shot = false;
        if (v.m !== mapIndex) buildMap(v.m);
        // ----- you: the camera -----
        const s0 = v.u[you], [mx, mz] = toWorld(s0.x, s0.y);
        const speed = me.prev ? Math.hypot(mx - me.prev[0], mz - me.prev[1]) / Math.max(dt, 1e-3) : 0; me.prev = [mx, mz];
        const shot = me.lastAmmo !== undefined && s0.g.ammo < me.lastAmmo && s0.g.id === me.lastGun;
        const hurt = me.lastHp !== undefined && s0.hp < me.lastHp;
        me.lastAmmo = s0.g.ammo; me.lastGun = s0.g.id; me.lastHp = s0.hp;
        if (shot) { events.shot = true; kick = Math.min(1.4, kick + ({ sniper: 1.2, rocket: 1.3, shotgun: 1.1 }[s0.g.id] || 0.45)); if (s0.g.id === 'rocket' || s0.g.id === 'shotgun') shake = Math.max(shake, 0.06); }
        if (hurt) { events.hurt = true; shake = Math.max(shake, 0.05); }
        if (vmId !== s0.g.id) setViewmodel(s0.g.id);
        const dead = s0.hp <= 0;
        eye += ((dead ? 0.35 : EYE) - eye) * Math.min(1, dt * (dead ? 3 : 10));
        roll += ((dead ? 0.5 : 0) - roll) * Math.min(1, dt * 3);
        walk += speed * dt * 1.9;
        const bob = reduceMotion || speed < 0.6 ? 0 : 1;
        shake = Math.max(0, shake - dt * 0.6);
        const jitter = reduceMotion ? 0 : shake;
        camera.position.set(mx, eye + bob * Math.abs(Math.cos(walk)) * 0.045, mz);
        camera.rotation.set(pitch + kick * 0.035 + (Math.random() - .5) * jitter, -s0.ang - PI / 2 + (Math.random() - .5) * jitter, roll);
        camera.updateMatrixWorld(true);
        // viewmodel: bob, sway when turning, recoil, reload dip, raise when switching
        if (lastYaw !== null) { let d = s0.ang - lastYaw; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; sway = THREE.MathUtils.clamp(sway + d * 0.6, -0.08, 0.08); }
        lastYaw = s0.ang;
        sway *= Math.max(0, 1 - dt * 8); kick *= Math.max(0, 1 - dt * 9); raise = Math.min(1, raise + dt * 4);
        reloadK += ((s0.g.rl ? 1 : 0) - reloadK) * Math.min(1, dt * 10);
        vmRoot.position.copy(camera.position); vmRoot.quaternion.copy(camera.quaternion);
        const len = (vmGun && vmGun.userData.len) || 0.5, gh = (vmGun && vmGun.userData.h) || 0.15;
        // the gun's top edge sits just under the crosshair line, out to the right
        vmHold.position.set(0.19 + gh * 0.2 + sway + bob * Math.sin(walk) * 0.012, -0.1 - gh * 0.5 - (1 - raise) * 0.3 - reloadK * 0.12 + bob * Math.abs(Math.cos(walk)) * 0.01, -0.16 - len * 0.5 + kick * 0.06);
        vmHold.rotation.set(kick * 0.12 - reloadK * 0.5, 0.05 + sway * 2, -reloadK * 0.6); // angled in slightly toward the crosshair
        vmHold.visible = !dead;
        // muzzle flash on the held gun, and light thrown onto the world
        vmFlare.userData.t = shot ? 0.05 : vmFlare.userData.t - dt;
        vmFlare.visible = vmFlare.userData.t > 0 && !dead;
        vmFlare.position.set(vmHold.position.x, vmHold.position.y + 0.02, vmHold.position.z - len * 0.55);
        vmFlare.scale.setScalar(0.07 + Math.random() * 0.05);
        myFlash.position.set(mx + Math.cos(s0.ang) * 0.9, EYE - 0.2, mz + Math.sin(s0.ang) * 0.9);
        myFlash.intensity = vmFlare.visible ? 30 : 0;
        // ----- the opponent: a person who runs, aims and falls -----
        const s = v.u[1 - you], who = personFor(names[1]);
        if (chars[1] && chars[1].who !== who && !chars[1].procedural) { scene.remove(chars[1].root, chars[1].flash, chars[1].flare); chars[1] = null; }
        const ch = chars[1];
        if (!ch) ensureChar(1, who);
        else {
          if (ch.gunId !== s.g.id) setGun(ch, s.g.id);
          const [wx, wz] = toWorld(s.x, s.y);
          const vx = ch.prev ? (wx - ch.prev[0]) / Math.max(dt, 1e-3) : 0, vz = ch.prev ? (wz - ch.prev[1]) / Math.max(dt, 1e-3) : 0;
          ch.prev = [wx, wz];
          const sp = Math.hypot(vx, vz), moving = sp > 0.6;
          ch.root.position.set(wx, 0, wz);
          const eShot = ch.lastAmmo !== undefined && s.g.ammo < ch.lastAmmo && s.g.id === ch.lastGun;
          const eHurt = ch.lastHp !== undefined && s.hp < ch.lastHp;
          ch.lastAmmo = s.g.ammo; ch.lastGun = s.g.id; ch.lastHp = s.hp;
          if (eShot) { ch.flashT = 0.055; ch.recoil = 1; }
          if (eHurt) { // a puff of blood from the chest
            ch.hitT = 0.14; events.hitEnemy = true;
            const c = ch.bones && ch.bones.spine[2] ? ch.bones.spine[2].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(wx, 1.3, wz);
            puff(c.x, c.y, c.z, '#5a0b0b', 0.32, 0.35, 0.15);
          }
          ch.flashT -= dt; ch.hitT -= dt; ch.recoil = Math.max(0, (ch.recoil || 0) - dt * 7);
          if (ch.procedural) {
            ch.root.rotation.y = -s.ang;
            ch.walk = (ch.walk || 0) + sp * dt * 3.2;
            const sw = moving ? Math.sin(ch.walk) * 0.55 : 0; ch.legsGroups.legL.rotation.z = sw; ch.legsGroups.legR.rotation.z = -sw;
            ch.root.rotation.z = s.hp <= 0 ? PI / 2 * 0.95 : 0;
          } else if (s.hp <= 0) {
            // falls backwards like a dead weight (Rocketbox has no death animation); the gun drops
            if (!ch.dead) { ch.dead = true; ch.deathT = 0; }
            ch.deathT += dt;
            const k = Math.min(1, ch.deathT / 0.7), e = k * k;
            ch.fall.rotation.z = e * PI / 2 * 0.97; ch.fall.position.x = -e * 0.12;
            if (ch.deathT < 0.35) ch.mixer.update(dt * 0.5);
            ch.gunHolder.visible = ch.deathT < 0.12;
          } else {
            if (ch.dead) { ch.dead = false; ch.fall.rotation.z = 0; ch.fall.position.x = 0; ch.gunHolder.visible = true; }
            // legs go where they're moving (backpedalling when that's behind where they aim); standing
            // still, the feet only turn once the body would twist too far
            let legsTo = ch.legs;
            if (moving) {
              const mv = Math.atan2(vz, vx), back = Math.abs(wrapAng(mv - s.ang)) > 1.75, key = sp > 2.6 ? 'run' : 'walk';
              legsTo = back ? mv + PI : mv;
              play(ch, ch.actions[key] ? key : 'run');
              if (ch.current) ch.current.timeScale = (back ? -1 : 1) * Math.max(0.6, Math.min(1.4, sp / (key === 'run' ? 4.4 : 1.5)));
            } else {
              if (Math.abs(wrapAng(s.ang - ch.legs)) > 0.9) legsTo = s.ang;
              play(ch, 'idle'); if (ch.current) ch.current.timeScale = 1;
            }
            ch.legs += wrapAng(legsTo - ch.legs) * Math.min(1, dt * 8);
            ch.mixer.update(dt);
            ch.body.rotation.y = -ch.legs;
            ch.root.updateMatrixWorld(true);
            poseAim(ch, s.ang, ch.recoil);
          }
          ch.root.updateMatrixWorld(true);
          muzzleOf(ch, s.ang, ch.flash.position); ch.flare.position.copy(ch.flash.position);
          ch.flash.intensity = ch.flashT > 0 ? 25 : 0; ch.flare.visible = ch.flashT > 0; ch.flare.scale.setScalar(0.2 + Math.random() * 0.16);
          tag(ch, s, names[1]);
        }
        // tracers / rockets (rockets trail smoke)
        tracers.forEach(t => t.visible = false);
        for (const [x, y, big, vx = 1, vy = 0] of v.b) {
          const [wx, wz] = toWorld(x, y);
          const t = pool(tracers, () => new THREE.Mesh(tracerGeo, tracerMat));
          t.geometry = big ? rocketGeo : tracerGeo; t.material = big ? rocketMat : tracerMat;
          t.position.set(wx, 1.3, wz); t.rotation.set(0, -Math.atan2(vy, vx), big ? PI / 2 : 0); t.visible = true;
          if (big && Math.random() < 0.7) puff(wx, 1.3, wz, '#9a9a9a', 0.35, 0.9, 0.4);
        }
        // explosions and bullet impacts (particles spawn the first frame an effect appears)
        let boom = 0;
        for (const [x, y, r, t] of v.fx) {
          const [wx, wz] = toWorld(x, y), big = r > 20, key = `${Math.round(x)},${Math.round(y)},${r}`;
          if (!seen.includes(key)) {
            seen.push(key); if (seen.length > 60) seen.shift();
            if (big) { if (Math.hypot(wx - mx, wz - mz) < 12) shake = Math.max(shake, 0.12); for (let k = 0; k < 14; k++) puff(wx + (Math.random() - .5) * 2, 0.6 + Math.random(), wz + (Math.random() - .5) * 2, k < 6 ? '#ffb347' : '#5d5a55', 1.2 + Math.random() * 1.4, 0.6 + Math.random() * 0.9, 1.6); }
            else for (let k = 0; k < 5; k++) puff(wx, 1.3, wz, '#ffd27a', 0.12, 0.25, 2.5);
          }
          if (big) { boom = Math.max(boom, t * 3); boomLight.position.set(wx, 1.5, wz); }
        }
        boomLight.intensity = boom * 120;
        for (const p of puffs) if (p.visible) {
          const u = p.userData; u.t += dt; const f = u.t / u.life;
          p.position.addScaledVector(u.v, dt); p.scale.setScalar(u.size * (1 + f * 1.5)); p.material.opacity = Math.max(0, 1 - f) * 0.8;
          if (f >= 1) p.visible = false;
        }
        if (sunLight) { sunLight.position.set(mx + 14, 28, mz + 9); sunLight.target.position.set(mx, 0, mz); }
      },
      render() { view.render(frameDt); },
      reset() {
        Object.assign(me, { lastAmmo: undefined, lastGun: null, lastHp: undefined, prev: null });
        eye = EYE; roll = 0; kick = 0; lastYaw = null; shake = 0;
        for (const ch of chars) if (ch) { ch.prev = null; ch.dead = false; ch.lastHp = ch.lastAmmo = undefined; ch.root.rotation.z = 0; if (ch.mixer) { ch.mixer.stopAllAction(); ch.current = null; play(ch, 'idle', 0); } }
      },
      preload() { for (const p of F.people) loadGLB(A.characters[p]); for (const g of Object.values(A.guns)) loadGLB(g); },
    };
  }

  // ---------- City (tycoon view) ----------
  function createCity(canvas, handlers) {
    const view = makeView(canvas, 40), { scene, camera } = view;
    const L = M.CITY.lot, ray = new THREE.Raycaster();
    const lots = [], coins = [], world = new THREE.Group();
    let level = 0, sunLight, crate = null, hover = -1, t = 0, running = false, last = 0, token = 0;
    let yaw = 0.62, pitch = 0.56, dist = 52, drag = null, tycoon = null;
    scene.add(world);
    const lotPos = i => [(1 - Math.floor(i / 3)) * L, ((i % 3) - 1) * L];
    for (let i = 0; i < 9; i++) {
      const [x, z] = lotPos(i);
      const pad = new THREE.Mesh(tiledBox(M.CITY.pad, 0.2, M.CITY.pad, 2), pbr('pavers', { fallback: '#b9b5ac' }).clone());
      pad.position.set(x, 0.1, z); pad.receiveShadow = true; pad.userData.lot = i; scene.add(pad);
      const holder = new THREE.Group(); holder.position.set(x, 0.2, z); scene.add(holder);
      lots.push({ pad, holder, key: '', anims: [], x, z });
    }
    const coinGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24);
    const coinMat = new THREE.MeshStandardMaterial({ color: '#f5c542', metalness: 1, roughness: 0.2, transparent: true });

    function setLevel(lv) {
      level = lv; const th = M.CITY.levels[lv - 1], night = th.lampsOn, my = ++token;
      applySky(view, th.sky, th.exposure, () => my === token);
      scene.fog = new THREE.FogExp2(U.haze[th.sky], U.fog * 0.55); // smog (thinner: this camera sits further back)
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 24);
      world.clear();
      // the business takes up a paved plaza in the middle of the city
      const [cx, cz] = U.city.clear;
      const plaza = new THREE.Mesh(tiledPlane(2 * cx, 2 * cz, 2.5), pbr('pavers', { tint: '#a9a399', fallback: '#77746f' })); plaza.receiveShadow = true; world.add(plaza);
      world.add(buildCity('city', night, view.tier > 0));
      // roads with lane markings, on a grid between and around the lots
      const asphalt = pbr('asphalt', { tint: '#a8a8a8', fallback: '#45464a' }), paint = new THREE.MeshStandardMaterial({ color: '#efe9d2', roughness: 0.7 });
      const span = L * 3 + M.CITY.road;
      for (const off of [-1.5 * L, -0.5 * L, 0.5 * L, 1.5 * L]) for (const along of ['x', 'z']) {
        const r = new THREE.Mesh(along === 'x' ? tiledBox(span, 0.06, M.CITY.road, 4) : tiledBox(M.CITY.road, 0.06, span, 4), asphalt);
        r.position.set(along === 'x' ? 0 : off, 0.03, along === 'x' ? off : 0); r.receiveShadow = true; world.add(r);
        for (let d = -span / 2 + 1; d < span / 2; d += 2.4) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 1.1 : 0.09, 0.01, along === 'x' ? 0.09 : 1.1), paint);
          m.position.set(along === 'x' ? d : off, 0.065, along === 'x' ? off : d); m.receiveShadow = true; world.add(m);
        }
      }
      // street furniture, cars, lamps
      for (const d of M.CITY.props) prop(d.model).then(o => {
        if (!o || my !== token) return;
        o.position.set(...d.p); o.rotation.y = d.ry; if (d.s) o.scale.multiplyScalar(d.s); world.add(o);
        if (d.light && night) { const l = new THREE.PointLight('#ffd49a', 70, 20, 2); l.position.set(d.p[0], 5.3, d.p[2]); world.add(l); }
      });
      for (const l of lots) l.key = ''; // rebuild buildings for the new look
    }
    function refreshLot(i, tyc) {
      const b = CC.BUILDINGS[i], lot = lots[i];
      const n = CC.owned(tyc, b.id), lv = CC.bLevel(tyc, b.id), unl = CC.unlocked(tyc, b);
      const ms = [25, 50, 100, 200].filter(m => n >= m).length;
      const key = [unl, n > 0, ms, Math.min(lv, 6), level].join('|');
      if (lot.key === key) return;
      lot.key = key; lot.holder.clear(); lot.anims = [];
      const add = (model, x, z, s) => { const m = build(model); m.root.position.set(x, 0, z); m.root.scale.setScalar(s); lot.holder.add(m.root); lot.anims.push(...m.anims); };
      if (!unl) add(M.LOT.locked, 0, 0, 1);
      else if (!n) add(M.LOT.forSale, 0, 0, 1);
      else {
        add(M.BUILDINGS[b.id], 0, 0, 1);
        // each milestone (25/50/100/200 owned) adds a smaller branch on the lot
        [[2.9, 2.9], [2.9, -2.9], [-2.9, 2.9], [-2.9, -2.9]].slice(0, ms).forEach(([x, z]) => add(M.BUILDINGS[b.id], x, z, 0.3));
      }
      // upgrade levels gild the lot
      const k = Math.min(1, lv / 6);
      lot.pad.material.color.set(!unl ? '#777777' : new THREE.Color('#ffffff').lerp(new THREE.Color('#f0c95a'), k));
      lot.pad.material.metalness = k * 0.6;
    }
    function update(tyc) {
      tycoon = tyc;
      if (tyc.level !== level) setLevel(tyc.level);
      for (let i = 0; i < 9; i++) refreshLot(i, tyc);
      const crateOn = CC.eventOn(tyc, 'crate');
      if (crateOn && !crate) { crate = build(M.LOT.crate); crate.root.position.set(L * 1.5 + 3.5, 0.5, 0); crate.root.userData.crate = true; scene.add(crate.root); }
      if (!crateOn && crate) { scene.remove(crate.root); crate = null; }
    }
    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now; t += dt;
      if (!drag) yaw += dt * 0.025;
      camera.position.set(Math.cos(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.sin(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(0, 1.5, 0);
      lots.forEach((l, i) => { animate(l.anims, t); l.pad.material.emissive.set(i === hover ? '#3a5a8a' : '#000'); l.pad.material.emissiveIntensity = i === hover ? 0.6 : 0; });
      if (crate) { crate.root.rotation.y = t * 1.5; crate.root.position.y = 0.6 + Math.sin(t * 3) * 0.2; }
      // coins float up from earning buildings (faster with more income; green during a boom)
      if (tycoon) {
        const boom = CC.eventOn(tycoon, 'boom');
        for (let i = 0; i < 9; i++) {
          const inc = CC.bIncome(tycoon, CC.BUILDINGS[i]);
          if (inc > 0 && Math.random() < dt * Math.min(4, 0.4 + Math.log10(inc + 1) * 0.35) * (boom ? 2.5 : 1)) {
            let c = coins.find(c => !c.visible);
            if (!c) { c = new THREE.Mesh(coinGeo, coinMat.clone()); c.rotation.x = PI / 2; coins.push(c); scene.add(c); }
            c.visible = true; c.userData.t = 0; c.material.color.set(boom ? '#4ade80' : '#f5c542');
            c.position.set(lots[i].x + (Math.random() - .5) * 3, 2.5 + Math.random() * 2, lots[i].z + (Math.random() - .5) * 3);
          }
        }
      }
      for (const c of coins) if (c.visible) {
        c.userData.t += dt; c.position.y += dt * 1.6; c.rotation.z += dt * 5; c.material.opacity = 1 - c.userData.t / 1.6;
        if (c.userData.t > 1.6) c.visible = false;
      }
      view.render(dt);
      requestAnimationFrame(frame);
    }
    function pickAt(e) {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      const targets = lots.map(l => l.pad).concat(lots.map(l => l.holder)).concat(crate ? [crate.root] : []);
      for (const h of ray.intersectObjects(targets, true)) {
        let o = h.object;
        while (o && !o.userData.crate && o.userData.lot === undefined && !lots.some(l => l.holder === o)) o = o.parent;
        if (!o) continue;
        if (o.userData.crate) return 'crate';
        if (o.userData.lot !== undefined) return o.userData.lot;
        return lots.findIndex(l => l.holder === o);
      }
      return -1;
    }
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; });
    addEventListener('pointermove', e => {
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; yaw = drag.yaw + dx * 0.006; pitch = Math.min(1.25, Math.max(0.22, drag.pitch + dy * 0.004)); }
      else if (e.target === canvas) { const p = pickAt(e); hover = typeof p === 'number' ? p : -1; canvas.style.cursor = p === -1 ? 'grab' : 'pointer'; }
    });
    addEventListener('pointerup', e => {
      if (drag && !drag.moved && e.target === canvas) { const p = pickAt(e); if (p === 'crate') handlers.onCrate(); else if (p >= 0) handlers.onLot(p); }
      drag = null;
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(95, Math.max(24, dist + e.deltaY * 0.04)); }, { passive: false });
    return {
      update,
      start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
      stop() { running = false; },
    };
  }

  function supported() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
  window.R3D = { createArena, createCity, supported, TEAM, assetsAvailable: ASSETS_OK };
})();
