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
    // threshold above sunlit surfaces, so only real light sources glow (neon, lamps, flashes)
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 1.6);
    composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());
    composer.addPass(new THREE.ShaderPass(GRADE));
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
        if (tier > 0) return composer.render(dt);
        renderer.render(scene, camera);
        if (overlay) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlay, camera); renderer.autoClear = true; }
      },
    };
  }
  // Colour grade after tone mapping: a little extra saturation and warmth, and a soft vignette.
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, saturation: { value: 1.12 }, warmth: { value: 0.025 }, vignette: { value: 0.28 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation, warmth, vignette; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation) + vec3(warmth, warmth * 0.4, -warmth);
        float d = length(vUv - 0.5) * 1.35;
        c.rgb *= 1.0 - vignette * smoothstep(0.45, 1.05, d);
        gl_FragColor = c;
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

  // ---------- Landscape: rolling hills, mountains, wind-blown grass, trees ----------
  // Built around the arena or the city. terrainHeight() comes from models.js, so the desktop app
  // (r3d.gd) raises exactly the same hills.
  const LS = M.LANDSCAPE;
  let bladeGeo = null;
  // One grass blade, 1 unit tall: a tapering strip, dark at the root and sunlit at the tip.
  function grassBlade() {
    if (bladeGeo) return bladeGeo;
    const pos = [], col = [], nor = [], idx = [], segs = 4;
    for (let i = 0; i <= segs; i++) {
      const y = i / segs, w = 0.045 * (1 - y * 0.9), bend = y * y * 0.12;
      pos.push(-w, y, bend, w, y, bend);
      const c0 = [0.035, 0.09, 0.015], c1 = [0.32, 0.5, 0.1], k = Math.pow(y, 1.4);
      for (let s2 = 0; s2 < 2; s2++) col.push(c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k);
      nor.push(0, 1, 0, 0, 1, 0); // up-facing normals: soft, sky-lit grass instead of flat-lit cards
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bladeGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    bladeGeo.setIndex(idx);
    return bladeGeo;
  }
  // flat: half-extents of the level ground; bare: half-extents of an area with no grass (paving);
  // returns { group, height(x, z), update(t, tier) }
  function buildLandscape(flat, bare, seed) {
    const group = new THREE.Group(), h = (x, z) => M.terrainHeight(x, z, flat);
    // terrain: grass, rock on steep slopes, snow on the high peaks
    const geo = new THREE.PlaneGeometry(LS.size, LS.size, LS.segments, LS.segments); geo.rotateX(-PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { p.setY(i, h(p.getX(i), p.getZ(i))); uv.setXY(i, uv.getX(i) * LS.size / 4, uv.getY(i) * LS.size / 4); }
    geo.computeVertexNormals();
    const n = geo.attributes.normal, cols = [], grass = new THREE.Color('#ffffff'), rock = new THREE.Color('#8c8478'), snow = new THREE.Color('#f4f6f8'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const slope = 1 - n.getY(i), y = p.getY(i);
      c.copy(grass).lerp(rock, THREE.MathUtils.smoothstep(slope, 0.18, 0.42)).lerp(snow, THREE.MathUtils.smoothstep(y, 55, 75) * (1 - slope * 0.8));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const ground = new THREE.Mesh(geo, pbr('grass', { tint: '#8fbf6a', fallback: '#5f8a4a' }).clone());
    ground.material.vertexColors = true; ground.receiveShadow = true; group.add(ground);
    // wind-blown grass: one instanced draw call, swayed in the vertex shader
    const time = { value: 0 }, r = rng(seed), max = LS.grass.high;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float k = position.y * position.y;
          float gust = sin(uTime * 1.5 + ip.x * 0.19 + ip.z * 0.13) * 0.65 + sin(uTime * 3.4 + ip.x * 1.1 + ip.z * 0.8) * 0.22;
          vec3 wind = vec3(1.0, 0.0, 0.42) * (gust + 0.35) * k * 0.42;
          transformed += inverse(mat3(instanceMatrix)) * wind;
        #endif`);
      // both sides lit like the ground beneath (a back face would get a downward normal: black blades)
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
    };
    const blades = new THREE.InstancedMesh(grassBlade(), mat, max);
    blades.receiveShadow = true; blades.frustumCulled = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), tint = new THREE.Color();
    let placed = 0;
    for (let tries = 0; placed < max && tries < max * 3; tries++) {
      const a = r() * PI * 2, d = Math.sqrt(r()) * LS.grass.radius, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.85;
      if (Math.abs(x) < bare[0] && Math.abs(z) < bare[1]) continue;
      const tall = LS.grass.height[0] + r() * (LS.grass.height[1] - LS.grass.height[0]);
      q.setFromAxisAngle(v.set(0, 1, 0), r() * PI * 2); sc.set(1 + r() * 0.6, tall, 1);
      m4.compose(v.set(x, h(x, z) - 0.03, z), q, sc); blades.setMatrixAt(placed, m4);
      blades.setColorAt(placed, tint.setHSL(0.22 + r() * 0.07, 0.55 + r() * 0.3, 0.55 + r() * 0.35));
      placed++;
    }
    blades.count = placed; group.add(blades);
    // trees on the hills
    let tseed = seed + 17; const tr = rng(tseed);
    for (let i = 0; i < LS.trees; i++) {
      const a = tr() * PI * 2, d = 36 + Math.pow(tr(), 0.7) * 170, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const name = tr() < 0.55 ? 'pine' : 'tree', s = 0.9 + tr() * 0.9 + d / 260, rot = tr() * PI * 2;
      prop(name).then(o => { if (!o) return; o.position.set(x, h(x, z) - 0.1, z); o.rotation.y = rot; o.scale.multiplyScalar(s); group.add(o); });
    }
    const counts = [LS.grass.low, LS.grass.medium, LS.grass.medium, LS.grass.high];
    return {
      group, height: h,
      update(t, tier) { time.value = t; blades.count = Math.min(placed, counts[tier] ?? placed); },
    };
  }
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- Characters ----------
  const findClip = (clips, name) => clips.find(c => c.name === name || c.name.endsWith('|' + name));
  const F = A.fighter;
  async function makeCharacter(team) {
    const g = await loadGLB(A.characters[F.model]);
    const root = new THREE.Group();
    // a glowing team ring under the feet makes the two sides readable at a glance
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM[team]).multiplyScalar(2), transparent: true, opacity: 0.85, toneMapped: false }));
    ring.rotation.x = -PI / 2; ring.position.y = 0.03; root.add(ring);
    const ch = { root, team, actions: {}, current: null, mixer: null, gunHolder: null, gunId: null, tintMats: [], hitT: 0, flashT: 0, prev: null, dead: false };
    if (!g) { // fallback: the procedural soldier
      const b = build(M.SOLDIER, TEAM[team]); root.add(b.root);
      Object.assign(ch, { legs: b.groups, gunHolder: b.groups.gun, procedural: true });
      ch.tintMats = b.root.children.filter(c => c.material && c.material.color && c.material.color.getHexString() === new THREE.Color(TEAM[team]).getHexString()).map(c => c.material);
      return ch;
    }
    const model = THREE.SkeletonUtils.clone(g.scene);
    model.rotation.y = PI / 2; // Quaternius characters face +Z; the game's forward is +X
    root.add(model);
    // per-fighter materials; the tunic is dyed in the team colour
    ch.allMats = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      if (F.hide.includes(o.name)) { o.visible = false; return; }
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) {
        ch.allMats.push(m);
        if (F.uniform.includes(m.name)) { m.color.lerp(new THREE.Color(TEAM[team]).multiplyScalar(0.55), 0.85); ch.tintMats.push(m); }
      }
    });
    ch.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(F.clips)) { const clip = findClip(g.animations, name); if (clip) ch.actions[key] = ch.mixer.clipAction(clip); }
    for (const k of ['hit', 'death']) if (ch.actions[k]) { ch.actions[k].setLoop(THREE.LoopOnce, 1); ch.actions[k].clampWhenFinished = true; }
    play(ch, 'idle', 0);
    ch.mixer.update(0); root.updateMatrixWorld(true);
    // scale to a real person's height, measuring the posed (skinned) body
    const box = new THREE.Box3();
    model.traverse(o => { if (o.isSkinnedMesh) box.expandByObject(o, true); });
    if (box.isEmpty()) box.setFromObject(model, true);
    const tall = box.max.y - box.min.y;
    if (tall > 0.01) model.scale.multiplyScalar(A.heights[F.model] / tall);
    root.updateMatrixWorld(true);
    // the gun hangs from the right wrist, lined up with where he aims in the aiming pose
    const handName = THREE.PropertyBinding.sanitizeNodeName(F.hand); // the loader strips the '.' from 'Wrist.R'
    let hand = null; model.traverse(o => { if (!hand && o.isBone && o.name === handName) hand = o; });
    const holder = new THREE.Group();
    if (hand) {
      hand.add(holder);
      const hw = hand.getWorldQuaternion(new THREE.Quaternion()), rw = root.getWorldQuaternion(new THREE.Quaternion());
      // gun models point down -Z; turn that to the body's forward (+X of the root)
      holder.quaternion.copy(hw.invert().multiply(rw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -PI / 2)));
      holder.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x);
    } else { holder.position.set(0.42, 1.25, 0.12); root.add(holder); }
    ch.gunHolder = holder;
    return ch;
  }
  function play(ch, key, fade = 0.18) {
    const a = ch.actions[key]; if (!a || ch.current === a) return;
    a.reset().fadeIn(fade).play();
    if (ch.current) ch.current.fadeOut(fade);
    ch.current = a; ch.currentKey = key;
  }
  // Which run to play: forward, back or a sideways strafe, from movement relative to where he aims.
  function runClip(ang, vx, vz) {
    const fwd = Math.cos(ang) * vx + Math.sin(ang) * vz, side = -Math.sin(ang) * vx + Math.cos(ang) * vz;
    return Math.abs(fwd) >= Math.abs(side) ? (fwd >= 0 ? 'run' : 'back') : (side > 0 ? 'right' : 'left');
  }
  // Puts the equipped gun in the fighter's hand (same models as the first-person view).
  async function setGun(ch, id) {
    ch.gunId = id;
    const len = F.gunLen[id], gun = await makeViewmodel(id, len);
    if (ch.gunId !== id) return;
    if (ch.gun) ch.gunHolder.remove(ch.gun);
    gun.position.set(0, -0.03, -len * 0.3); // grip in the hand, barrel ahead
    gun.traverse(c => { if (c.isMesh) c.castShadow = true; });
    ch.gun = gun; ch.gunHolder.add(gun);
  }
  // Where bullets leave the barrel.
  function muzzleOf(ch, ang, out) {
    if (ch.gun) { ch.gun.updateMatrixWorld(true); return ch.gun.localToWorld(out.set(0, 0, -(ch.gun.userData.len || 0.5) / (ch.gun.scale.x || 1) * 0.5)); }
    return out.set(ch.root.position.x + Math.cos(ang) * 0.8, 1.3, ch.root.position.z + Math.sin(ang) * 0.8);
  }

  // ---------- First-person weapon ----------
  // The same gun model the soldiers carry. To hold it right we pose a soldier in his aiming animation,
  // read how the gun sits relative to his body (he faces +Z), and turn that so his forward becomes the
  // camera's forward (-Z). Barrel direction and roll come straight from the artist's pose.
  const VM_LEN = { pistol: 0.24, smg: 0.44, shotgun: 0.62, sniper: 0.62, rocket: 0.62 };
  async function makeViewmodel(id, length = VM_LEN[id]) {
    const wrap = new THREE.Group(), orient = new THREE.Group(); wrap.add(orient);
    const g = await loadGLB(A.characters.soldier);
    let gun = null;
    if (g) {
      const body = THREE.SkeletonUtils.clone(g.scene), mixer = new THREE.AnimationMixer(body);
      const clip = findClip(g.animations, A.gunPose);
      if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
      body.updateMatrixWorld(true);
      let node = null; body.traverse(o => { if (!node && o.name === A.characterGuns[id]) node = o; });
      if (node) {
        const rel = new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(node.matrixWorld);
        gun = node.clone(true); gun.visible = true;
        rel.decompose(gun.position, gun.quaternion, gun.scale); gun.position.set(0, 0, 0);
        // straighten the barrel (the gun's longest axis) so it points exactly where he faces
        const bare = node.clone(true); bare.position.set(0, 0, 0); bare.quaternion.identity(); bare.scale.set(1, 1, 1); bare.updateMatrixWorld(true);
        const ls = new THREE.Box3().setFromObject(bare).getSize(new THREE.Vector3()); // the gun in its own space
        const along = ls.x >= ls.y && ls.x >= ls.z ? new THREE.Vector3(1, 0, 0) : ls.y >= ls.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        const d = along.applyQuaternion(gun.quaternion).normalize(); if (d.z < 0) d.negate();
        gun.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(d, new THREE.Vector3(0, 0, 1)));
        gun.traverse(c => { if (c.isMesh) { c.material = c.material.clone(); c.castShadow = false; c.frustumCulled = false; } });
        orient.add(gun); orient.rotation.y = PI; // his forward (+Z) -> camera forward (-Z)
      }
    }
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
    let mapIndex = -1, mapGroup = null, sunLight = null, mapToken = 0, frameDt = 1 / 60, clock = 0, land = null;
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
      scene.fog = new THREE.FogExp2(LS.haze[th.sky], 0.0042); // distant hills fade into the sky
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 32);
      // floors
      const floor = new THREE.Mesh(tiledPlane(45, 28, th.floorTile), pbr(th.floorTex, { tint: th.floorTint || '#ffffff', fallback: '#6e6a63' })); floor.receiveShadow = true; grp.add(floor);
      // a paved apron around the arena, then open country: hills, grass, trees, mountains
      const apron = new THREE.Mesh(tiledPlane(2 * LS.flatArena[0] - 4, 2 * LS.flatArena[1] - 4, 5), pbr(th.outerTex, { tint: '#bbbbbb', fallback: '#4a4a48' })); apron.position.y = -0.02; apron.receiveShadow = true; grp.add(apron);
      land = buildLandscape(LS.flatArena, [LS.flatArena[0] - 2, LS.flatArena[1] - 2], 1000 + m); grp.add(land.group);
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
          o.position.set(d.p[0], land ? land.height(d.p[0], d.p[2]) : 0, d.p[2]); o.rotation.y = d.ry; if (d.s) o.scale.multiplyScalar(d.s); grp.add(o);
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
    function ensureChar(team) {
      if (chars[team] || pending[team]) return;
      pending[team] = makeCharacter(team).then(ch => {
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
        if (land) land.update(clock, view.tier);
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
        // ----- the opponent: animated soldier -----
        const s = v.u[1 - you], ch = chars[1];
        if (!ch) ensureChar(1);
        else {
          if (ch.gunId !== s.g.id) setGun(ch, s.g.id);
          const [wx, wz] = toWorld(s.x, s.y);
          const vx = ch.prev ? (wx - ch.prev[0]) / Math.max(dt, 1e-3) : 0, vz = ch.prev ? (wz - ch.prev[1]) / Math.max(dt, 1e-3) : 0;
          ch.prev = [wx, wz];
          const sp = Math.hypot(vx, vz), moving = sp > 0.6;
          ch.root.position.set(wx, 0, wz); ch.root.rotation.y = -s.ang;
          const eShot = ch.lastAmmo !== undefined && s.g.ammo < ch.lastAmmo && s.g.id === ch.lastGun;
          const eHurt = ch.lastHp !== undefined && s.hp < ch.lastHp;
          ch.lastAmmo = s.g.ammo; ch.lastGun = s.g.id; ch.lastHp = s.hp;
          if (eShot) { ch.flashT = 0.055; ch.shootT = 0.35; }
          if (eHurt) { ch.hitT = 0.14; events.hitEnemy = true; }
          ch.flashT -= dt; ch.hitT -= dt; ch.shootT = (ch.shootT || 0) - dt;
          if (s.hp <= 0) { if (!ch.dead) { ch.dead = true; if (ch.actions.death) play(ch, 'death', 0.1); else ch.root.rotation.z = PI / 2 * 0.95; } }
          else if (ch.mixer) {
            ch.dead = false;
            // forward, backward or strafing runs, depending on how they move relative to their aim
            const key = moving ? runClip(s.ang, vx, vz) : ch.shootT > 0 && ch.actions.shoot ? 'shoot' : 'idle';
            play(ch, ch.actions[key] ? key : moving ? 'run' : 'idle');
            if (moving && ch.current) ch.current.timeScale = Math.max(0.6, Math.min(1.3, sp / 4.2));
          } else if (ch.procedural) {
            ch.walk = (ch.walk || 0) + sp * dt * 3.2;
            const sw = moving ? Math.sin(ch.walk) * 0.55 : 0; ch.legs.legL.rotation.z = sw; ch.legs.legR.rotation.z = -sw;
          }
          if (ch.mixer) ch.mixer.update(dt);
          for (const m of ch.allMats || ch.tintMats) { m.emissive.set(ch.hitT > 0 ? '#ff2020' : '#000'); m.emissiveIntensity = ch.hitT > 0 ? 0.45 : 0; }
          ch.root.updateMatrixWorld(true);
          muzzleOf(ch, s.ang, ch.flash.position); ch.flare.position.copy(ch.flash.position);
          ch.flash.intensity = ch.flashT > 0 ? 25 : 0; ch.flare.visible = ch.flashT > 0; ch.flare.scale.setScalar(0.45 + Math.random() * 0.35);
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
      preload() { ensureChar(1); loadGLB(A.characters.soldier); },
    };
  }

  // ---------- City (tycoon view) ----------
  function createCity(canvas, handlers) {
    const view = makeView(canvas, 40), { scene, camera } = view;
    const L = M.CITY.lot, ray = new THREE.Raycaster();
    const lots = [], coins = [], world = new THREE.Group();
    let level = 0, sunLight, crate = null, hover = -1, t = 0, running = false, last = 0, token = 0, land = null;
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

    function windowTexture() {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) if (Math.random() < 0.45) { x.fillStyle = `rgba(255,${200 + Math.random() * 55 | 0},150,${0.35 + Math.random() * 0.45})`; x.fillRect(k * 32 + 9, r * 32 + 10, 14, 13); }
      const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; return tx;
    }
    function setLevel(lv) {
      level = lv; const th = M.CITY.levels[lv - 1], night = th.lampsOn, my = ++token;
      applySky(view, th.sky, th.exposure, () => my === token);
      scene.fog = new THREE.FogExp2(LS.haze[th.sky], 0.0036); // distant hills fade into the sky
      if (sunLight) scene.remove(sunLight, sunLight.target);
      sunLight = sun(scene, th.sun, th.sunI, 24);
      world.clear();
      // the business sits on level ground in open country: hills, wind-blown grass, trees, mountains
      land = buildLandscape(LS.flatCity, [1.5 * L + M.CITY.road, 1.5 * L + M.CITY.road], 2000); world.add(land.group);
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
      // street furniture, cars, trees, lamps
      for (const d of M.CITY.props) prop(d.model).then(o => {
        if (!o || my !== token) return;
        o.position.set(d.p[0], land.height(d.p[0], d.p[2]), d.p[2]); o.rotation.y = d.ry; if (d.s) o.scale.multiplyScalar(d.s); world.add(o);
        if (d.light && night) { const l = new THREE.PointLight('#ffd49a', 70, 20, 2); l.position.set(d.p[0], 5.3, d.p[2]); world.add(l); }
      });
      // skyline: photo-textured towers with lit windows at night
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const winTex = night ? windowTexture() : null;
      for (let k = 0; k < th.skyline; k++) {
        const ang = rnd() * PI * 2, r = 105 + rnd() * 70, h = 14 + rnd() * (8 + lv * 7), w = 8 + rnd() * 8;
        const mat = pbr(M.CITY.skylineTex[k % 3], { tint: ['#c9c2b6', '#d8d8d8', '#b9bcc2'][k % 3], fallback: '#8b96a6' }).clone();
        if (night) { mat.emissiveMap = winTex; mat.emissive = new THREE.Color('#ffcf80'); mat.emissiveIntensity = 0.9; }
        const tower = new THREE.Mesh(tiledBox(w, h, w, 8), mat);
        const tx = Math.cos(ang) * r, tz = Math.sin(ang) * r, base = land.height(tx, tz) - 1;
        tower.position.set(tx, base + h / 2, tz); world.add(tower);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, w + 0.4), new THREE.MeshStandardMaterial({ color: '#3d4148', roughness: 0.7, metalness: 0.4 }));
        roof.position.set(tx, base + h + 0.25, tz); world.add(roof);
      }
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
      if (land) land.update(t, view.tier);
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
