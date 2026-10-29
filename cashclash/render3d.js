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
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, ASSETS_OK ? fn().catch(e => { console.warn('Hustlefront: could not load', key, e); return null; }) : Promise.resolve(null)); return cache.get(key); };
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

  // ---------- Settings (the ⚙️ tab; the list of options is M.SETTINGS) ----------
  // `saved` is what the player picked; opts() fills in the defaults and the quality preset's values. 'auto'
  // starts at high and the governor in makeView() steps it down while frames are slow. ?quality=low|medium|high
  // in the URL pins the preset for that visit.
  const SET = M.SETTINGS, DEF = Object.fromEntries(SET.groups.flatMap(g => g.items).map(i => [i.id, i.def]));
  const pinned = { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' }[new URLSearchParams(location.search).get('quality')];
  const views = new Set();
  let saved = {}, autoStep = 0, current = null, drawn = 0; // drawn: frames drawn, for the frame rate counter
  function opts() {
    if (current) return current;
    const o = { ...DEF, ...saved };
    if (pinned) o.preset = pinned;
    const level = o.preset === 'auto' ? SET.AUTO[autoStep] : o.preset;
    Object.assign(o, SET.PRESETS[level] || {});
    o.level = level; // what the graphics are really at: a preset's name, or 'custom'
    return (current = o);
  }
  function setOptions(s) { saved = { ...s }; current = null; for (const v of views) v.apply(); }

  // ---------- Renderer + post-processing ----------
  // Ambient occlusion (GTAO), bloom, the colour grade and SMAA, each switched by the settings.
  // `overlay` (optional) is a second scene drawn on top with a fresh depth buffer: the first-person gun.
  // `fov` is the view's own field of view at the default setting (70°): the setting moves every view by the same amount.
  function makeView(canvas, fov, overlay) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 900);
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const ao = new THREE.GTAOPass(scene, camera, 256, 256);
    ao.blendIntensity = 0.85; ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1 });
    composer.addPass(ao);
    if (overlay) { const vm = new THREE.RenderPass(overlay, camera); vm.clear = false; vm.clearDepth = true; composer.addPass(vm); }
    // GTA IV-style bloom: lamps, lit windows and bright sky bleed a soft glow. The threshold is above a white
    // car in full sun (albedo ~0.8 x sun 3), so sunlit paint and signs don't glow.
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.65, 2.6);
    composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());
    const grade = new THREE.ShaderPass(GRADE); composer.addPass(grade);
    const smaa = new THREE.SMAAPass(256, 256); composer.addPass(smaa);
    let w = 0, h = 0, slow = 0, lastFrame = 0, lastDraw = 0, post = true, exposure = 1, shadowKey = '', settle = 0;
    // tier: how much of the city to build in detail (0 = the least), for scenes built from now on
    let tier = 3;
    function apply() {
      const o = opts(), u = grade.uniforms;
      ao.enabled = o.ao; bloom.enabled = o.bloom; smaa.enabled = o.aa;
      u.saturation.value = o.grade ? 0.74 : 1; u.contrast.value = o.grade ? 1.12 : 1;
      u.shadowTint.value.copy(o.grade ? GRADE.shadowTint : ZERO); u.highTint.value.copy(o.grade ? GRADE.highTint : ZERO);
      u.vignette.value = o.grain ? 0.42 : 0; u.grain.value = o.grain ? 0.035 : 0;
      post = o.ao || o.bloom || o.aa || o.grade || o.grain;
      const pr = Math.min(devicePixelRatio, 1.75) * o.scale / 100;
      renderer.setPixelRatio(pr); composer.setPixelRatio(pr); w = 0;
      renderer.toneMappingExposure = exposure * o.brightness / 100;
      camera.fov = fov + o.fov - 70; camera.updateProjectionMatrix();
      if (scene.fog) scene.fog.density = U.fog * SET.FOG[o.distance];
      camera.far = o.distance === 'far' ? 1300 : 900;
      tier = o.level === 'low' ? 0 : o.distance === 'near' ? 1 : !o.ao ? 2 : 3;
      // shadows: the suns cast them at the chosen map size; changing the filter recompiles the materials
      const size = SET.SHADOW_MAP[o.shadows], key = o.shadows;
      renderer.shadowMap.type = o.shadows === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      scene.traverse(l => {
        if (!l.userData.sun) return;
        l.castShadow = size > 0;
        if (size && l.shadow.mapSize.x !== size) { l.shadow.mapSize.set(size, size); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } }
      });
      if (shadowKey && key !== shadowKey) scene.traverse(m => { if (m.material) for (const x of [].concat(m.material)) x.needsUpdate = true; });
      shadowKey = key;
      settle = performance.now() + 3000; // shaders recompile after a change: don't judge those frames
    }
    const view = {
      renderer, scene, camera, composer, bloom, ao, apply,
      get tier() { return tier; },
      // the sky's exposure, before the brightness setting
      setExposure(e) { exposure = e; renderer.toneMappingExposure = e * opts().brightness / 100; },
      render(dt) {
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!cw || !ch) return;
        if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
        const now = performance.now(), real = lastFrame ? (now - lastFrame) / 1000 : 0, o = opts(); lastFrame = now;
        // frame rate limit: skip drawing until the frame is due (the game itself keeps running every frame)
        if (o.fps && now - lastDraw < 1000 / o.fps - 2) return;
        lastDraw = now; drawn++;
        // 'auto' quality: about 2 seconds of frames slower than ~30fps steps every view down a preset. A
        // stutter (loading a model, building a street, coming back to the tab) isn't slowness: it, and the
        // 3 seconds after it while things settle, don't count.
        if (real > 0.25 || !real) settle = now + 3000; // (!real: the first frame)
        if (o.preset === 'auto' && !pinned && real > 0 && now > settle) {
          slow = real > 0.034 ? slow + real : Math.max(0, slow - real * 0.5);
          if (slow > 2 && autoStep < SET.AUTO.length - 1) { slow = 0; autoStep++; current = null; for (const v of views) v.apply(); }
        }
        grade.uniforms.time.value = (now / 1000) % 100;
        if (post) return composer.render(dt);
        renderer.render(scene, camera);
        if (overlay) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlay, camera); renderer.autoClear = true; }
      },
    };
    views.add(view); apply();
    return view;
  }
  const ZERO = new THREE.Vector3();
  // Colour grade after tone mapping, in the spirit of GTA IV: washed-out colour, a little more contrast,
  // warm sepia shadows and creamy highlights, a heavy vignette and fine film grain.
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, saturation: { value: 0.74 }, contrast: { value: 1.12 },
      shadowTint: { value: new THREE.Vector3(0.035, 0.02, 0.0) }, highTint: { value: new THREE.Vector3(0.025, 0.018, -0.03) },
      vignette: { value: 0.42 }, grain: { value: 0.035 } },
    shadowTint: new THREE.Vector3(0.035, 0.02, 0.0), highTint: new THREE.Vector3(0.025, 0.018, -0.03),
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
    view.setExposure(exposure);
    if (hdr) { view.scene.background = hdr; view.scene.environment = hdr; view.scene.backgroundBlurriness = 0.02; }
    else { const c = { day: '#9fc3e6', sunset: '#e7a978', dusk: '#6b5a7e', night: '#141a30' }[name]; view.scene.background = new THREE.Color(c); view.scene.environment = null; }
  }
  function sun(scene, color, intensity, range) {
    const d = new THREE.DirectionalLight(color, intensity);
    d.position.set(18, 30, 12); d.castShadow = SET.SHADOW_MAP[opts().shadows] > 0; d.userData.sun = true;
    const n = SET.SHADOW_MAP[opts().shadows] || 2048; d.shadow.mapSize.set(n, n); d.shadow.bias = -0.0003; d.shadow.normalBias = 0.03;
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
  // Modelled building fronts (Poly Haven kits): piece name -> its parts ({geometry, material}), at the origin.
  function kitParts(name) {
    return once('kit:' + name, async () => {
      const g = await loadGLB(A.kits[name]), out = new Map();
      if (g) for (const node of g.scene.children) {
        const parts = []; node.traverse(c => { if (c.isMesh) parts.push({ geometry: c.geometry, material: c.material }); });
        out.set(node.name, parts);
      }
      return out;
    });
  }
  // Lit windows at night: the same glass glowing warm. Which ones are lit depends only on the building,
  // side, bay and floor, so the desktop version lights the same windows.
  const litGlass = new Map();
  function lit(material) {
    if (!litGlass.has(material)) {
      const m = material.clone();
      m.emissive = new THREE.Color('#ffc58a'); m.emissiveMap = material.map; m.emissiveIntensity = 1.6; m.opacity = 1; m.transparent = false;
      litGlass.set(material, m);
    }
    return litGlass.get(material);
  }
  const KIT = U.kit, KIT_GROUND = { d: 'door', s: 'shop', p: 'plain' }, SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // Where every kit piece of building b goes: calls put(piece, x, y, z, rotationY, scaleX, lit) for each
  // bay, the corner piers and the roof mouldings. Mirrors kit_pieces() in desktop/r3d.gd.
  function kitPieces(b, faces, night, put) {
    for (const f of faces) {
      const [nx, nz] = SIDES[f.s], ry = Math.atan2(nx, nz), X = [Math.cos(ry), -Math.sin(ry)], ryL = Math.atan2(-X[0], -X[1]);
      const len = f.s < 2 ? b.d : b.w, sx = len / (KIT.bay * f.n), cx = b.x + nx * b.w / 2, cz = b.z + nz * b.d / 2;
      const rx = cx + X[0] * len / 2, rz = cz + X[1] * len / 2, lx = cx - X[0] * len / 2, lz = cz - X[1] * len / 2;
      for (let k = 0; k < f.n; k++) {
        const ox = rx - X[0] * k * KIT.bay * sx, oz = rz - X[1] * k * KIT.bay * sx;
        put(KIT_GROUND[f.g[k]], ox, 0, oz, ry, sx, night && f.g[k] === 's' && (b.seed + f.s * 31 + k * 7) % 10 < 6);
        for (let fl = 1; fl < b.floors; fl++) put(f.u, ox, fl * KIT.floor, oz, ry, sx, night && (b.seed + f.s * 31 + k * 7 + fl * 13) % 10 < 3);
        put('crown', ox, b.floors * KIT.floor, oz, ry, sx, false);
      }
      for (let fl = 0; fl < b.floors; fl++) { put('pier', rx, fl * KIT.floor, rz, ry, 1, false); put('pier', lx, fl * KIT.floor, lz, ryL, 1, false); }
      put('crown_pier', rx, b.floors * KIT.floor, rz, ry, 1, false); put('crown_pier', lx, b.floors * KIT.floor, lz, ryL, 1, false);
    }
  }
  // One building of the layout (or a business, M.lotBuilding()): its box (photo fronts) goes to add(key,
  // material, geometry), batched by material; the modelled sides (`faces`) to kits (kit -> piece|lit|shadow
  // -> matrices), and the box is set back behind those so the windows and doors have depth.
  let innerMat = null;
  function addBuilding(b, faces, night, k, add, kits) {
    const T = U.facadeTile, trim = pbr('concrete_wall', { tint: '#a9a49b', fallback: '#8a857d' });
    const inner = innerMat || (innerMat = new THREE.MeshStandardMaterial({ color: '#1d1a17', roughness: 0.95 }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const on = [0, 1, 2, 3].map(s => faces.some(f => f.s === s));
    const fm = facadeMat(b.facade, night, b.tint), tile = T[b.facade], I = KIT.inset;
    // the box, set back behind the modelled sides
    const x0 = b.x - b.w / 2 + (on[1] ? I : 0), x1 = b.x + b.w / 2 - (on[0] ? I : 0), z0 = b.z - b.d / 2 + (on[3] ? I : 0), z1 = b.z + b.d / 2 - (on[2] ? I : 0);
    add(b.facade + b.tint + k, fm, boxGeo(x1 - x0, b.h, z1 - z0, tile, tile, (x0 + x1) / 2, b.h / 2, (z0 + z1) / 2));
    if (faces.length) {
      add('trim' + k, trim, boxGeo(b.w, 0.3, b.d, 2.5, 2.5, b.x, b.h - 0.15, b.z)); // roof over the set-back
      for (const f of faces) {
        // dark rooms behind the windows, and the photo sides carried on to the corner
        if (f.s < 2) {
          const fx = f.s ? x0 - 0.01 : x1 + 0.01, ex = f.s ? b.x - b.w / 2 : b.x + b.w / 2;
          add('inner', inner, boxGeo(0.02, b.h, z1 - z0, 1, 1, fx, b.h / 2, (z0 + z1) / 2));
          for (const [s, z] of [[2, b.z + b.d / 2 - 0.01], [3, b.z - b.d / 2 + 0.01]]) if (!on[s]) add(b.facade + b.tint + k, fm, boxGeo(I, b.h, 0.02, tile, tile, (fx + ex) / 2, b.h / 2, z));
        } else {
          const fz = f.s === 3 ? z0 - 0.01 : z1 + 0.01, ez = f.s === 3 ? b.z - b.d / 2 : b.z + b.d / 2;
          add('inner', inner, boxGeo(x1 - x0, b.h, 0.02, 1, 1, (x0 + x1) / 2, b.h / 2, fz));
          for (const [s, x] of [[0, b.x + b.w / 2 - 0.01], [1, b.x - b.w / 2 + 0.01]]) if (!on[s]) add(b.facade + b.tint + k, fm, boxGeo(0.02, b.h, I, tile, tile, x, b.h / 2, (fz + ez) / 2));
        }
      }
      if (!kits.has(b.kit)) kits.set(b.kit, new Map());
      const into = kits.get(b.kit);
      kitPieces(b, faces, night, (piece, x, y, z, ry, sx, glow) => {
        const key = piece + '|' + (glow ? 1 : 0) + '|' + k;
        if (!into.has(key)) into.set(key, []);
        into.get(key).push(m4.compose(p.set(x, y, z), q.setFromAxisAngle(UP, ry), sc.set(sx, 1, 1)).clone());
      });
    } else add('trim' + k, trim, boxGeo(b.w + 0.5, 0.5, b.d + 0.5, 2.5, 2.5, b.x, b.h - 0.1, b.z)); // cornice (also the roof)
  }
  // The kit pieces collected by addBuilding(): one instanced mesh per piece part (lit windows and shadow
  // casters apart). They appear when the kit has loaded.
  function instanceKits(kits, group) {
    for (const [name, into] of kits) kitParts(name).then(parts => {
      if (!parts) return;
      for (const [key, list] of into) {
        const [piece, glow, k] = key.split('|');
        for (const part of parts.get(piece) || []) {
          const mat = glow === '1' && /glass/.test(part.material.name) ? lit(part.material) : part.material;
          const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
          list.forEach((m, i) => im.setMatrixAt(i, m));
          im.castShadow = k === '+' && !mat.transparent; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im);
        }
      }
    });
  }
  // The streets (wet asphalt, lane paint, crossings, stains, manholes), sidewalks, buildings with photo
  // facades (storefronts, ledges, cornices and roof tanks up close), the skyline in the haze, and street
  // furniture, and traffic driving round the middle. The sides of the nearer buildings that face the middle
  // (closer than `kitReach`) get modelled fronts instead of photos. Returns the group; call
  // group.userData.tick(t) each frame to move the traffic. `detail` false (the lowest quality) leaves out
  // the small stuff.
  function buildCity(where, night, detail = true, kitReach = KIT.reach) {
    const group = new THREE.Group(), L = M.cityLayout(where), batches = new Map(), T = U.facadeTile;
    const add = (key, mat, geo) => { if (!batches.has(key)) batches.set(key, { mat, geos: [] }); batches.get(key).geos.push(geo); };
    const ground = new THREE.Mesh(tiledPlane(1000, 1000, 7), wetGround()); ground.position.y = -0.04; ground.receiveShadow = true; group.add(ground);
    const pav = pbr('pavers', { tint: '#b7b1a7', fallback: '#77746f' });
    for (const [x0, z0, x1, z1] of L.sidewalks) add('pav', pav, boxGeo(x1 - x0, 0.15, z1 - z0, 2.5, 2.5, (x0 + x1) / 2, 0.075, (z0 + z1) / 2));
    const trim = pbr('concrete_wall', { tint: '#a9a49b', fallback: '#8a857d' }), tankMat = new THREE.MeshStandardMaterial({ color: '#5e4a3a', roughness: 0.9 });
    const shops = [pbr('shutter', { tint: '#8d8f8c', fallback: '#4a4c4b' }), pbr('plaster', { tint: '#5a514a', fallback: '#4a443e' })];
    const kits = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const b of L.buildings) {
      const k = b.shade ? '+' : ''; // buildings near the middle cast shadows; batched separately
      const faces = (b.faces || []).filter(f => f.d < kitReach);
      addBuilding(b, faces, night, k, add, kits);
      if (!b.near || !detail) continue;
      if (!faces.length) {
        add('shop' + (b.seed % 2) + k, shops[b.seed % 2], boxGeo(b.w + 0.12, 3.25, b.d + 0.12, 2.5, 2.5, b.x, 1.625, b.z)); // ground-floor storefronts
        add('trim' + k, trim, boxGeo(b.w + 0.3, 0.35, b.d + 0.3, 2.5, 2.5, b.x, 3.42, b.z)); // ledge over the shops
      }
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
    instanceKits(kits, group);
    if (detail) { // oil stains and manhole covers
      const stainMat = new THREE.MeshBasicMaterial({ map: stain(), transparent: true, depthWrite: false, color: '#ffffff' });
      const blot = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), stainMat, L.stains.length);
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
      if (d.light && night && lights++ < 6) { const l = new THREE.PointLight('#ffd49a', 20, 22, 2); l.position.set(d.p[0], 5.3, d.p[2]); group.add(l); }
    });
    // traffic (positions from models.js trafficAt(), so the desktop app drives the same cars); the Traffic
    // setting takes the cars off the road
    const cars = [];
    for (const c of L.traffic.cars) prop(c.model).then(o => { if (o) { group.add(o); cars.push([o, c]); } });
    group.userData.tick = t => { const on = opts().traffic; for (const [o, c] of cars) { o.visible = on; if (!on) continue; const [x, z, ry] = M.trafficAt(L.traffic, c, t); o.position.set(x, 0, z); o.rotation.y = ry; } };
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
  const TWIST = 1.15; // most the upper body turns from the legs to aim (radians, about 65 degrees)
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
    const twist = Math.max(-TWIST, Math.min(TWIST, wrapAng(aim - ch.legs)));
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
    let mapIndex = -1, mapGroup = null, sunLight = null, mapToken = 0, frameDt = 1 / 60, clock = 0, streets = null;
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
      scene.fog = new THREE.FogExp2(U.haze[th.sky], U.fog * SET.FOG[opts().distance]); // city smog: distant blocks fade out
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 32);
      // floors
      const floor = new THREE.Mesh(tiledPlane(45, 28, th.floorTile), pbr(th.floorTex, { tint: th.floorTint || '#ffffff', fallback: '#6e6a63' })); floor.receiveShadow = true; grp.add(floor);
      // a paved courtyard around the arena, walled in by city blocks
      const [cx, cz] = U.arena.clear;
      const apron = new THREE.Mesh(tiledPlane(2 * cx, 2 * cz, 5), pbr(th.outerTex, { tint: '#bbbbbb', fallback: '#4a4a48' })); apron.position.y = -0.02; apron.receiveShadow = true; grp.add(apron);
      streets = buildCity('arena', th.lampsOn, view.tier > 0, [0, 40, 60, U.kit.reach][view.tier]); grp.add(streets);
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
        if (streets) streets.userData.tick(clock);
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
            // legs go where they're moving, but the upper body only twists so far to keep aiming (no strafe
            // clips): moving sideways, the legs point partway between the two; moving away from the aim,
            // they backpedal. Standing still, the feet only turn once the body would twist too far.
            let legsTo = ch.legs;
            if (moving) {
              const mv = Math.atan2(vz, vx), rel = wrapAng(mv - s.ang), back = Math.abs(rel) > 1.95, key = sp > 2.6 ? 'run' : 'walk';
              legsTo = back ? s.ang + Math.max(-TWIST, Math.min(TWIST, wrapAng(mv + PI - s.ang))) : s.ang + Math.max(-TWIST, Math.min(TWIST, rel));
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

  // ---------- Tycoon: walk around your business in first person ----------
  // The 3x3 lots sit on a plaza in the middle of the city. Click the view to take the mouse, walk with
  // WASD, look at a lot and press E to buy one more or R to upgrade it (handlers.describe() says what
  // that costs). Every owned lot runs a production line: machines drop boxes onto a conveyor that
  // carries them to a till, faster the more that building earns.
  const LINE = M.CITY.line, EYE_T = 1.62;
  let beltTex = null;
  function belt() { // dark rubber with raised ribs, tiled along the conveyor
    if (beltTex) return beltTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#1b1c1e'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#2c2e31'; x.fillRect(0, 0, 10, 64);
    beltTex = new THREE.CanvasTexture(c); beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping; beltTex.colorSpace = THREE.SRGBColorSpace; beltTex.repeat.set(LINE.length / 0.6, 1);
    return beltTex;
  }
  function createCity(canvas, handlers) {
    const view = makeView(canvas, 70), { scene, camera } = view;
    camera.near = 0.05; camera.rotation.order = 'YXZ';
    const L = M.CITY.lot, P = M.CITY.pad, ray = new THREE.Raycaster(), [cx, cz] = U.city.clear;
    const lots = [], coins = [], world = new THREE.Group();
    let level = 0, sunLight, crate = null, aim = -1, t = 0, running = false, last = 0, token = 0, tycoon = null, streets = null;
    // room: the business you're inside (-1: out in the plaza); floor: the ground under you (lots and rooms are 0.2 up)
    const me = { x: L, z: 1.5 * L + 2.2, yaw: 0, pitch: -0.08, walk: 0, room: -1, floor: 0 }, keys = {}; // in front of the arcade
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scene.add(world);
    const lotPos = i => [(1 - Math.floor(i / 3)) * L, ((i % 3) - 1) * L];
    for (let i = 0; i < 9; i++) {
      const [x, z] = lotPos(i);
      const pad = new THREE.Mesh(tiledBox(P, 0.2, P, 2), pbr('pavers', { fallback: '#b9b5ac' }).clone());
      pad.position.set(x, 0.1, z); pad.receiveShadow = true; pad.userData.lot = i; scene.add(pad);
      const holder = new THREE.Group(); holder.position.set(x, 0.2, z); scene.add(holder);
      lots.push({ pad, holder, key: '', anims: [], x, z, door: null, portal: null, kind: 'empty', ms: 0 });
    }
    // Inside the businesses: each owned business's front door leads into a room (M.interior) far out of
    // town, much bigger than the building. The door shows it like a portal: a second camera, moved by the
    // same offset as the room, draws the room into a texture that the doorway shows at screen position;
    // walking through the doorway moves you by that offset. Only the room you're in or nearest to is built
    // (rooms[i]); a fixed pool of lights is moved into it (changing the number of lights would recompile
    // every shader). The sun and sky light are off while a room is drawn: the room has a roof.
    const ROOM_AT = i => new THREE.Vector3(2000 + i * 60, 0.2, 0), rooms = [];
    const roomLights = Array.from({ length: 5 }, () => { const l = new THREE.PointLight('#ffe6c4', 0, 20, 2); scene.add(l); return l; });
    const roomFill = new THREE.HemisphereLight('#fff4e6', '#6b5f55', 0); scene.add(roomFill);
    const portalRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }), portalCam = new THREE.PerspectiveCamera(), drawSize = new THREE.Vector2();
    const portalMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { map: { value: portalRT.texture }, res: { value: drawSize } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform vec2 res; void main() { gl_FragColor = texture2D(map, gl_FragCoord.xy / res); }' });
    let sunI = 1;
    function indoor(on) { // lighting for inside a room (on) or out in the city
      if (sunLight) sunLight.intensity = on ? 0 : sunI;
      scene.environmentIntensity = on ? 0.25 : 1; roomFill.intensity = on ? 0.8 : 0;
    }
    // the offset from lot i's door to its room's doorway
    const roomOffset = i => { const l = lots[i]; return ROOM_AT(i).sub(new THREE.Vector3(l.x + l.door.x, 0.2, l.z + l.door.z)); };
    // People: workers at their stations, people walking their rounds (they stop if you're in the way) and
    // in every area someone with a job for you (CC.questTalk), whom you talk to with E.
    function townsperson(who, scale = 1) {
      const root = new THREE.Group(), p = { root, actions: {}, current: null, mixer: null };
      root.scale.setScalar(scale);
      loadGLB(A.npcs[who]).then(g => {
        if (!g) return;
        const model = THREE.SkeletonUtils.clone(g.scene); root.add(model);
        model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        const bone = name => { const n = THREE.PropertyBinding.sanitizeNodeName(name); let b = null; model.traverse(o => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
        model.updateMatrixWorld(true);
        const r = bone('Bip01 R UpperArm'), l = bone('Bip01 L UpperArm');
        if (r && l) { // turn it to face +Z: its right is from the left shoulder to the right one
          const right = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3())).setY(0).normalize(), fwd = new THREE.Vector3().crossVectors(UP, right);
          model.rotation.y = -Math.atan2(fwd.x, fwd.z);
        }
        p.mixer = new THREE.AnimationMixer(model);
        for (const key of ['idle', 'walk', 'talk', 'work']) { const clip = findClip(g.animations, key); if (clip) p.actions[key] = p.mixer.clipAction(clip); }
        const want = p.want || 'idle'; p.want = null; play(p, want, 0);
        if (p.actions[want]) p.actions[want].time = Math.random() * 3; // not all in step
      });
      return p;
    }
    const doClip = (p, key, fade) => { if (p.mixer) play(p, key, fade); else p.want = key; };
    const faceTo = (p, x, z, dt) => { // turn smoothly towards a point (world)
      const w = p.root.getWorldPosition(new THREE.Vector3()), want = Math.atan2(x - w.x, z - w.z);
      const parent = p.root.parent ? p.root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const base = new THREE.Euler().setFromQuaternion(parent, 'YXZ').y;
      p.root.rotation.y += wrapAng(want - base - p.root.rotation.y) * Math.min(1, dt * 6);
    };
    // people walking a closed path: [{ p, path, speed, d }] (with fewer passers-by, every other one stays home)
    function walkers(list, holder, scaleSeed = 0) {
      return list.filter((w, k) => opts().crowd === 'all' || k % 2 === 0).map((w, k) => {
        const p = townsperson(w.who, 0.95 + ((k + scaleSeed) % 5) * 0.025);
        const len = w.path.reduce((a, q, i) => { const r = w.path[(i + 1) % w.path.length]; return a + Math.hypot(r[0] - q[0], r[1] - q[1]); }, 0);
        holder.add(p.root); return { p, path: w.path, speed: w.speed, d: w.phase * len };
      });
    }
    let plazaWalkers = [];
    let plazaGiver = null, plazaKey = '', talking = null; // talking: the area whose person you're talking to
    function giverFor(area, crew, holder, at) { // the quest giver: who they look like changes each reboot
      const look = tycoon ? CC.questGiver(tycoon, area).look : 0, p = townsperson(crew[look % crew.length], 0.97 + (look % 7) * 0.012);
      p.root.position.set(at.p[0], 0, at.p[1]); p.root.rotation.y = at.ry; p.area = area; p.home = at.ry; holder.add(p.root);
      return p;
    }
    const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 20);
    const coinMat = new THREE.MeshStandardMaterial({ color: '#f5c542', metalness: 1, roughness: 0.2, transparent: true });
    const steel = new THREE.MeshStandardMaterial({ color: '#3d4045', metalness: 0.75, roughness: 0.4 });
    const beltMat = new THREE.MeshStandardMaterial({ map: belt(), roughness: 0.85 });
    let boxModel = null; prop('box').then(o => { boxModel = o; });

    function setLevel(lv) {
      level = lv; const th = M.CITY.levels[lv - 1], night = th.lampsOn, my = ++token;
      applySky(view, th.sky, th.exposure, () => my === token);
      scene.fog = new THREE.FogExp2(U.haze[th.sky], U.fog * SET.FOG[opts().distance]); // city smog: distant blocks fade out
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 26); sunI = th.sunI;
      for (const r of rooms) if (r) { scene.remove(r.group); } rooms.length = 0; // rebuilt for the new level
      world.clear();
      // the business takes up a paved plaza in the middle of the city
      const plaza = new THREE.Mesh(tiledPlane(2 * cx, 2 * cz, 2.5), pbr('pavers', { tint: '#a9a399', fallback: '#77746f' })); plaza.receiveShadow = true; world.add(plaza);
      streets = buildCity('city', night, view.tier > 0, [0, 40, 60, U.kit.reach][view.tier]); world.add(streets);
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
        if (d.light && night) { const l = new THREE.PointLight('#ffd49a', 20, 20, 2); l.position.set(d.p[0], 5.3, d.p[2]); world.add(l); }
      });
      for (const l of lots) l.key = ''; // rebuild buildings for the new look
    }
    // A production line: `machines` machines on stands feeding a conveyor (along x, at z) that runs into a
    // till. Boxes on the belt are pooled; frame() spawns and moves them.
    function productionLine(i, machines, z = 0) {
      const g = new THREE.Group(), half = LINE.length / 2, y = LINE.height;
      const part = (w, h, d, x, py, pz, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, py, pz); shadows(m); g.add(m); return m; };
      const table = (w, d, x, pz) => { // steel top on four legs
        part(w, 0.05, d, x, y - 0.075, pz, steel);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(0.05, y - 0.1, 0.05, x + sx * (w / 2 - 0.05), (y - 0.1) / 2, pz + sz * (d / 2 - 0.05), steel);
      };
      part(LINE.length, 0.05, 0.62, 0, y, z, beltMat);                                                  // belt
      for (const s of [-1, 1]) part(LINE.length + 0.1, 0.16, 0.06, 0, y + 0.02, z + s * 0.34, steel); // side rails
      for (let k = 0; k <= 4; k++) for (const s of [-1, 1]) part(0.06, y, 0.06, -half + k * LINE.length / 4, y / 2, z + s * 0.3, steel); // legs
      const stands = [];
      for (let k = 0; k < machines; k++) {
        const mx = -half + 0.7 + k * 1.7, model = LINE.machines[(i + k) % LINE.machines.length];
        table(1.1, 0.9, mx, z - 0.85);
        prop(model).then(o => { if (o) { o.position.set(mx, y - 0.05, z - 0.85); o.rotation.y = PI; g.add(o); } });
        stands.push(mx);
      }
      table(0.8, 0.8, half + 0.45, z);                                                                   // the till's table
      prop('cash_register').then(o => { if (o) { o.position.set(half + 0.45, y, z); o.rotation.y = -PI / 2; g.add(o); } });
      return { group: g, stands, z, items: [], until: Math.random() };
    }
    // A business: its building (M.lotBuilding) with the name on a sign board over the shop front.
    function shopBuilding(b, ms, night) {
      const g = new THREE.Group(), spec = M.lotBuilding(b.id, ms), batches = new Map(), kits = new Map();
      addBuilding(spec, spec.faces, night, '+', (key, mat, geo) => { if (!batches.has(key)) batches.set(key, { mat, geos: [] }); batches.get(key).geos.push(geo); }, kits);
      for (const { mat, geos } of batches.values()) g.add(shadows(new THREE.Mesh(mergeGeos(geos), mat)));
      instanceKits(kits, g);
      g.add(signBoard(b.name.toUpperCase(), M.SHOPS[b.id].sign, 5.2, 0.62, [0, 3.3, spec.z + spec.d / 2 + 0.18], night ? 0.45 : 0));
      return g;
    }
    // A painted sign board facing +Z: `text` in colors[0] on colors[1], w x h metres, centred at `at`; `glow`
    // lights the letters (at night).
    function signBoard(text, [fg, bg], w, h, at, glow) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
      const x = c.getContext('2d'), H = c.height; x.fillStyle = bg; x.fillRect(0, 0, 1024, H);
      x.strokeStyle = fg; x.globalAlpha = 0.35; x.lineWidth = H * 0.05; x.strokeRect(H * 0.07, H * 0.07, 1024 - H * 0.14, H * 0.86); x.globalAlpha = 1;
      x.fillStyle = fg; x.font = `800 ${Math.round(H * 0.62)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, 512, H * 0.54, 1024 - H * 0.5);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const g = new THREE.Group(), lit = { roughness: 0.6 };
      if (glow) { // lit at night: only the letters glow (white on black), not the whole board
        const e = document.createElement('canvas'); e.width = c.width; e.height = H; const y = e.getContext('2d');
        y.fillStyle = '#000'; y.fillRect(0, 0, 1024, H); y.fillStyle = fg; y.font = x.font; y.textAlign = 'center'; y.textBaseline = 'middle';
        y.fillText(text, 512, H * 0.54, 1024 - H * 0.5);
        Object.assign(lit, { emissive: '#ffffff', emissiveMap: new THREE.CanvasTexture(e), emissiveIntensity: glow });
        lit.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshStandardMaterial({ color: bg, roughness: 0.6 }));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, ...lit }));
      face.position.z = 0.031; g.add(shadows(board), face); g.position.set(...at);
      return g;
    }
    // Chain-link fence round a lot you can't buy yet.
    function fence() {
      const g = new THREE.Group(), kits = new Map([['fence', new Map()]]), into = kits.get('fence'), q = new THREE.Quaternion();
      for (const [piece, x, z, ry] of M.LOT.fence) {
        if (!into.has(piece + '|0|+')) into.set(piece + '|0|+', []);
        into.get(piece + '|0|+').push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(UP, ry), new THREE.Vector3(1, 1, 1)));
      }
      instanceKits(kits, g);
      return g;
    }
    // The inside of business i (lot i) at `ms` milestones, at ROOM_AT(i).
    function buildRoom(i, ms) {
      const R = M.interior(CC.BUILDINGS[i].id, ms), g = new THREE.Group(), batches = new Map();
      g.position.copy(ROOM_AT(i)); scene.add(g);
      for (const [[sx, sy, sz], [x, y, z], tex, tint] of R.parts) {
        const key = tex + tint;
        if (!batches.has(key)) batches.set(key, { mat: tex ? pbr(tex, { tint, fallback: tint }) : new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6 }), geos: [] });
        batches.get(key).geos.push(boxGeo(sx, sy, sz, 2.5, 2.5, x, y, z));
      }
      for (const { mat, geos } of batches.values()) { const m = new THREE.Mesh(mergeGeos(geos), mat); m.receiveShadow = true; g.add(m); }
      // the business's own furnishings (glowing, blinking and pulsing parts: see decor() in models.js)
      const fit = build({ parts: R.extra }); g.add(fit.root);
      for (const d of R.props) prop(d.model).then(o => { if (o && rooms[i] && rooms[i].group === g) { o.position.set(...d.p); o.rotation.y = d.ry; g.add(o); } });
      const lines = R.lines.map(ln => {
        const line = productionLine(i, ln.machines); line.group.position.set(ln.x, 0, ln.z); g.add(line.group);
        line.till = new THREE.Vector3(ln.x + LINE.length / 2 + 0.45, LINE.height + 1, ln.z).add(g.position);
        return line;
      });
      // the doorway from inside shows the plaza
      const exit = new THREE.Mesh(new THREE.PlaneGeometry(R.door.w, R.door.h), portalMat); exit.position.set(0, R.door.h / 2, -0.01); g.add(exit);
      // the people who work there
      const crew = R.people.stand.map((st, k) => { const p = townsperson(st.who, 0.95 + (k % 5) * 0.025); p.root.position.set(st.p[0], 0, st.p[1]); p.root.rotation.y = st.ry; doClip(p, st.clip, 0); g.add(p.root); return p; });
      const walking = walkers(R.people.walk, g, i);
      const giver = giverFor(CC.BUILDINGS[i].id, R.people.crew, g, R.people.giver);
      return { i, ms, group: g, R, lines, exit, crew, walking, giver, anims: fit.anims, crowd: opts().crowd };
    }
    function refreshLot(i, tyc) {
      const b = CC.BUILDINGS[i], lot = lots[i];
      const n = CC.owned(tyc, b.id), lv = CC.bLevel(tyc, b.id), unl = CC.unlocked(tyc, b);
      const ms = [25, 50, 100, 200].filter(m => n >= m).length;
      const key = [unl, n > 0, ms, Math.min(lv, 6), level].join('|');
      if (lot.key === key) return;
      lot.key = key; lot.holder.clear(); lot.anims = []; lot.door = null; lot.portal = null; lot.ms = ms; lot.kind = !unl ? 'locked' : n ? 'shop' : 'empty';
      if (rooms[i]) { scene.remove(rooms[i].group); rooms[i] = null; }
      const add = (model, x, z, s) => { const m = build(model); m.root.position.set(x, 0, z); m.root.scale.setScalar(s); lot.holder.add(m.root); lot.anims.push(...m.anims); };
      const night = M.CITY.levels[level - 1].lampsOn;
      const board = kind => { const d = M.LOT.boards[kind]; add(M.LOT[kind], 0, 0, 1); lot.holder.add(signBoard(d.text, d.colors, 1.6, 0.85, d.at, 0)); };
      if (!unl) { board('locked'); lot.holder.add(fence()); }
      else if (!n) board('forSale');
      else {
        // a real building from the facade kits, a floor taller for each milestone (25/50/100/200 owned)
        const spec = M.lotBuilding(b.id, ms);
        lot.holder.add(shopBuilding(b, ms, night));
        // its front door: a portal into the inside (drawn by frame())
        lot.door = spec.door;
        lot.portal = new THREE.Mesh(new THREE.PlaneGeometry(spec.door.w, spec.door.h), portalMat);
        lot.portal.position.set(spec.door.x, spec.door.h / 2, spec.door.z + 0.012); lot.holder.add(lot.portal);
      }
      // upgrade levels warm the paving towards sandstone
      const k = Math.min(1, lv / 6);
      lot.pad.material.color.set(!unl ? '#8a8a8a' : new THREE.Color('#ffffff').lerp(new THREE.Color('#e3c98f'), k * 0.6));
    }
    function update(tyc) {
      tycoon = tyc;
      if (tyc.level !== level) setLevel(tyc.level);
      const pk = CC.reboots(tyc) + '|' + CC.questGiver(tyc, 'plaza').name + '|' + opts().crowd; // a new person each reboot
      if (pk !== plazaKey) {
        plazaKey = pk; if (plazaGiver) scene.remove(plazaGiver.root); plazaGiver = giverFor('plaza', M.CITY.town.crew, scene, M.CITY.town.giver);
        // different people walk the routes after each reboot
        const folk = M.CITY.town.folk, rb = CC.reboots(tyc);
        for (const w of plazaWalkers) scene.remove(w.p.root);
        plazaWalkers = walkers(M.CITY.town.walk.map((w, k) => ({ ...w, who: folk[(k * 5 + rb * 7) % folk.length] })), scene, rb);
      }
      for (let i = 0; i < 9; i++) refreshLot(i, tyc);
      const crateOn = CC.eventOn(tyc, 'crate');
      if (crateOn && !crate) { crate = build(M.LOT.crate); crate.root.position.set(0, 0.5, 1.5 * L + 0.6); crate.root.userData.crate = true; scene.add(crate.root); }
      if (!crateOn && crate) { scene.remove(crate.root); crate = null; }
    }
    function coin(x, y, z, boom) {
      let c = coins.find(c => !c.visible);
      if (!c) { c = new THREE.Mesh(coinGeo, coinMat.clone()); c.rotation.x = PI / 2; coins.push(c); scene.add(c); }
      c.visible = true; c.userData.t = 0; c.material.color.set(boom ? '#4ade80' : '#f5c542'); c.position.set(x, y, z);
    }
    // walking: round the plaza (not through the buildings and fences) or round a room; through a front door
    // into its room and back out
    const push = (x0, z0, x1, z1, rad) => { // out of a box, along the shallower side
      const a = me.x - (x0 - rad), b = x1 + rad - me.x, c = me.z - (z0 - rad), d = z1 + rad - me.z;
      if (a <= 0 || b <= 0 || c <= 0 || d <= 0) return;
      const m = Math.min(a, b, c, d);
      if (m === a) me.x = x0 - rad; else if (m === b) me.x = x1 + rad; else if (m === c) me.z = z0 - rad; else me.z = z1 + rad;
    };
    function move(dt) {
      if (talking) return 0;
      const f = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0), s = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
      if (!f && !s) return 0;
      const speed = keys.shift ? 7 : 4.2, len = Math.hypot(f, s), sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
      const px = me.x, pz = me.z;
      me.x += (-sin * f + cos * s) / len * speed * dt; me.z += (-cos * f - sin * s) / len * speed * dt;
      if (me.room >= 0) { // inside: walls, the counter and the lines; out through the doorway
        const r = rooms[me.room], R = r.R, o = r.group.position, lx = me.x - o.x, lz = me.z - o.z, plz = pz - o.z;
        if (plz < 0 && lz >= 0 && Math.abs(lx) < R.door.w / 2 - 0.15) { const off = roomOffset(me.room); me.x -= off.x; me.z -= off.z; me.room = -1; return speed; }
        const inDoor = Math.abs(lx) < R.door.w / 2 - 0.15;
        me.x = o.x + Math.max(-R.w / 2 + 0.35, Math.min(R.w / 2 - 0.35, lx)); me.z = o.z + Math.max(-R.d + 0.35, Math.min(inDoor ? 0.2 : -0.35, lz));
        for (const [x0, z0, x1, z1] of R.blocks) push(o.x + x0, o.z + z0, o.x + x1, o.z + z1, 0.3);
        return speed;
      }
      const lim = cx - 0.6; me.x = Math.max(-lim, Math.min(lim, me.x)); me.z = Math.max(-lim, Math.min(lim, me.z));
      if (plazaGiver) { const p = plazaGiver.root.position; push(p.x - 0.25, p.z - 0.25, p.x + 0.25, p.z + 0.25, 0.3); }
      for (let i = 0; i < lots.length; i++) {
        const l = lots[i];
        if (l.door && rooms[i]) { // through the front door?
          const dz = l.z + l.door.z, dx = l.x + l.door.x;
          if (pz > dz && me.z <= dz && Math.abs(me.x - dx) < l.door.w / 2 - 0.15) { const off = roomOffset(i); me.x += off.x; me.z += off.z; me.room = i; return speed; }
        }
        if (l.kind === 'locked') push(l.x - P / 2, l.z - P / 2, l.x + P / 2, l.z + P / 2, 0.35); // fenced off
        else if (l.kind === 'shop' && !(l.door && Math.abs(me.x - l.x - l.door.x) < l.door.w / 2 - 0.15 && me.z > l.z + l.door.z)) // the building (but you can step into its doorway)
          push(l.x - 3.05, l.z - 3.85, l.x + 3.05, l.z + 1.25, 0.3);
      }
      return speed;
    }
    // what's under the crosshair (a lot index, 'crate', or -1), within reach
    // the quest giver you're facing and close to (their area), if any
    function talkable() {
      const g = me.room >= 0 ? rooms[me.room] && rooms[me.room].giver : plazaGiver;
      if (!g) return null;
      const w = g.root.getWorldPosition(new THREE.Vector3()), dx = w.x - me.x, dz = w.z - me.z, d = Math.hypot(dx, dz);
      if (d > 2.6) return null;
      const ang = wrapAng(Math.atan2(-dx, -dz) - me.yaw); // the camera looks down -Z
      return Math.abs(ang) < 0.5 || d < 1.1 ? g.area : null;
    }
    function aimed() {
      const tk = talkable(); if (tk) return 'talk:' + tk;
      if (me.room >= 0) return me.room; // inside a business: E and R act on it
      ray.setFromCamera({ x: 0, y: 0 }, camera); ray.far = 9;
      const targets = lots.map(l => l.pad).concat(lots.map(l => l.holder)).concat(crate ? [crate.root] : []);
      for (const h of ray.intersectObjects(targets, true)) {
        let o = h.object;
        while (o && !o.userData.crate && o.userData.lot === undefined && !lots.some(l => l.holder === o)) o = o.parent;
        if (!o) continue;
        if (o.userData.crate) return 'crate';
        return o.userData.lot !== undefined ? o.userData.lot : lots.findIndex(l => l.holder === o);
      }
      return -1;
    }
    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now; t += dt;
      // the room to have ready: the one you're in, else the nearest business whose door is within 25 m
      let want = me.room;
      if (want < 0) {
        let best = 25;
        lots.forEach((l, i) => { if (!l.door) return; const dd = Math.hypot(me.x - l.x - l.door.x, me.z - l.z - l.door.z); if (dd < best) { best = dd; want = i; } });
      }
      rooms.forEach((r, i) => { if (r && (i !== want || r.crowd !== opts().crowd)) { scene.remove(r.group); rooms[i] = null; } });
      if (want >= 0 && !rooms[want]) rooms[want] = buildRoom(want, lots[want].ms);
      const room = want >= 0 ? rooms[want] : null;
      roomLights.forEach((l, k) => { const p = room && room.R.lights[k]; l.intensity = p ? (room.R.kind === 'factory' ? 60 : 30) * room.R.glow : 0; if (p) { l.position.set(...p).add(room.group.position); l.color.set(room.R.light); } });
      if (room) animate(room.anims, t);
      const speed = move(dt); me.walk += speed * dt * 1.9;
      const bob = reduceMotion || !speed ? 0 : Math.abs(Math.cos(me.walk)) * 0.04;
      const onPad = me.room >= 0 || lots.some(l => Math.abs(me.x - l.x) < P / 2 && Math.abs(me.z - l.z) < P / 2);
      me.floor += ((onPad ? 0.2 : 0) - me.floor) * Math.min(1, dt * 12); // step up onto the paving
      camera.position.set(me.x, me.floor + EYE_T + bob, me.z); camera.rotation.set(me.pitch, me.yaw, 0); camera.updateMatrixWorld(true);
      if (crate && Math.hypot(me.x - crate.root.position.x, me.z - crate.root.position.z) < 1.6) handlers.onCrate(); // walk into it to claim
      const a = aimed(); if (a !== aim) { aim = a; handlers.onAim(a); }
      if (streets) streets.userData.tick(t);
      lots.forEach((l, i) => { animate(l.anims, t); l.pad.material.emissive.set(i === aim ? '#3a5a8a' : '#000'); l.pad.material.emissiveIntensity = i === aim ? 0.5 : 0; });
      if (crate) { crate.root.rotation.y = t * 1.5; crate.root.position.y = 0.6 + Math.sin(t * 3) * 0.2; }
      // production lines: boxes come off the machines and ride the belt to the till (more income, more boxes)
      beltMat.map.offset.x -= dt * LINE.speed / 0.6; // 0.6 m between ribs
      const boom = tycoon && CC.eventOn(tycoon, 'boom');
      for (const r of rooms) if (r) for (const line of r.lines) {
        const inc = tycoon ? CC.bIncome(tycoon, CC.BUILDINGS[r.i]) : 0, half = LINE.length / 2;
        line.until -= dt * Math.min(3, 0.35 + Math.log10(inc + 1) * 0.3) * (boom ? 2 : 1);
        if (line.until <= 0 && boxModel) {
          line.until = 1;
          let it = line.items.find(o => !o.visible);
          if (!it) { it = boxModel.clone(true); it.scale.setScalar(0.55); line.items.push(it); line.group.add(it); }
          it.visible = true; it.position.set(line.stands[Math.floor(Math.random() * line.stands.length)], LINE.height + 0.03, line.z); it.rotation.y = Math.random() * 0.4 - 0.2;
        }
        for (const it of line.items) if (it.visible) {
          it.position.x += LINE.speed * dt;
          if (it.position.x > half + 0.1) { it.visible = false; coin(line.till.x, line.till.y, line.till.z, boom); }
        }
      }
      // people
      const stepWalkers = (list, origin) => {
        for (const w of list) {
          const pos = w.p.root.getWorldPosition(new THREE.Vector3());
          if (Math.hypot(pos.x - me.x, pos.z - me.z) < 1.1) { doClip(w.p, 'idle'); faceTo(w.p, me.x, me.z, dt); } // you're in the way: wait
          else {
            w.d += w.speed * dt; const [x, z, ry] = M.pathAt(w.path, w.d);
            w.p.root.position.set(x, 0, z); w.p.root.rotation.y = ry; doClip(w.p, 'walk');
            if (w.p.actions.walk) w.p.actions.walk.timeScale = w.speed / 1.3;
          }
          if (w.p.mixer) w.p.mixer.update(dt);
        }
      };
      stepWalkers(plazaWalkers);
      const givers = [plazaGiver, ...rooms.map(r => r && r.giver)].filter(Boolean);
      for (const g of givers) {
        if (talking === g.area || (aim === 'talk:' + g.area)) faceTo(g, me.x, me.z, dt);
        else g.root.rotation.y += wrapAng(g.home - g.root.rotation.y) * Math.min(1, dt * 2);
        doClip(g, talking === g.area ? 'talk' : 'idle');
        if (g.mixer) g.mixer.update(dt);
      }
      for (const r of rooms) if (r) { stepWalkers(r.walking); for (const p of r.crew) if (p.mixer) p.mixer.update(dt); }
      for (const c of coins) if (c.visible) {
        c.userData.t += dt; c.position.y += dt * 1.2; c.rotation.z += dt * 6; c.material.opacity = 1 - c.userData.t / 1.2;
        if (c.userData.t > 1.2) c.visible = false;
      }
      // the portal: from outside, the room seen through its door; from inside, the plaza through the doorway
      if (room && (me.room >= 0 || lots[want].portal)) {
        view.renderer.getDrawingBufferSize(drawSize);
        const pw = Math.max(1, drawSize.x >> 1), ph = Math.max(1, drawSize.y >> 1);
        if (portalRT.width !== pw || portalRT.height !== ph) portalRT.setSize(pw, ph);
        const off = roomOffset(want), inside = me.room >= 0, hide = inside ? lots[want].holder : null;
        portalCam.copy(camera); portalCam.position.addScaledVector(off, inside ? -1 : 1); portalCam.updateMatrixWorld(true);
        const quads = [...rooms.map(r => r && r.exit), ...lots.map(l => l.portal)].filter(Boolean);
        quads.forEach(q => { q.visible = false; }); if (hide) hide.visible = false;
        indoor(!inside);
        const prev = view.renderer.getRenderTarget(); view.renderer.setRenderTarget(portalRT); view.renderer.render(scene, portalCam); view.renderer.setRenderTarget(prev);
        if (hide) hide.visible = true;
      }
      // only the nearest door stands open (the portal texture shows its room); the others show their doors
      lots.forEach((l, i) => { if (l.portal) l.portal.visible = me.room < 0 && i === want; });
      rooms.forEach(r => { if (r) r.exit.visible = me.room === r.i; });
      indoor(me.room >= 0);
      view.render(dt);
      requestAnimationFrame(frame);
    }
    // mouse look (pointer lock) and keys
    const locked = () => document.pointerLockElement === canvas;
    canvas.addEventListener('click', () => {
      if (!locked()) canvas.requestPointerLock();
      else if (talking) return;
      else if (typeof aim === 'string' && aim.startsWith('talk:')) handlers.onTalk(aim.slice(5));
      else if (typeof aim === 'number' && aim >= 0) handlers.onLot(aim);
    });
    addEventListener('mousemove', e => {
      if (!locked()) return;
      const o = opts(), k = 0.0022 * o.sens / 100;
      me.yaw -= e.movementX * k; me.pitch = Math.max(-1.3, Math.min(1.3, me.pitch - e.movementY * k * (o.invert ? -1 : 1)));
    });
    const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    addEventListener('keydown', e => {
      if (!running || typing() || talking) return; // (the conversation takes the keys)
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys[k] = true; if (locked()) e.preventDefault(); }
      if (k === 'e' && typeof aim === 'string' && aim.startsWith('talk:')) handlers.onTalk(aim.slice(5));
      else if (k === 'e' && typeof aim === 'number' && aim >= 0) handlers.onLot(aim);
      if (k === 'r' && typeof aim === 'number' && aim >= 0) handlers.onUpgrade(aim);
    });
    addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    return {
      update,
      start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
      talk(area) { talking = area; for (const k in keys) keys[k] = false; }, // area: talking to its person (null: done)
      get room() { return me.room; }, // which business you're inside (-1: none), and where you are: for tests
      get spot() { return [me.x, me.z]; },
      stop() { running = false; for (const k in keys) keys[k] = false; if (locked()) document.exitPointerLock(); },
      // for tests and screenshots: x, z in the plaza, or in room `room`'s own coordinates
      place(x, z, yaw = me.yaw, pitch = me.pitch, room = -1) {
        if (room >= 0) { const o = ROOM_AT(room); x += o.x; z += o.z; }
        Object.assign(me, { x, z, yaw, pitch, room, floor: room >= 0 ? 0.2 : me.floor });
      },
    };
  }

  function supported() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
  window.R3D = { createArena, createCity, supported, TEAM, assetsAvailable: ASSETS_OK, setOptions, opts, pinned, drawn: () => drawn };
})();
