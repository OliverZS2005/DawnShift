// 3D models for Cash Clash, described as data so the web renderer (render3d.js, Three.js) and the
// desktop renderer (desktop/render3d.gd, Godot) build identical scenes from one source.
// Run `node tools/build-models.js` after editing to refresh desktop/models.json.
//
// Units are metres, Y is up. A model is { parts: [...], groups: { name: { p: [x,y,z] } } }.
// Each part:
//   t   shape: 'box' s=[w,h,d] | 'cyl' s=[rTop,rBottom,h] | 'sph' s=[r] | 'cone' s=[r,h] | 'torus' s=[R,tube]
//   p   centre position (relative to its group's pivot when `g` is set)
//   r   rotation [x,y,z] in radians (optional)     sc  extra scale [x,y,z] (optional)
//   c   colour ('team' = the player's team colour)  e/ei emissive colour / strength (optional)
//   m   metalness   ro roughness   o opacity (optional)   seg radial segments (optional)
//   g   group (pivot) the part hangs from           a   animation: spin | spinY | pump | smoke | blink | pulse | bob
//   tx  photo texture set from ASSETS.textures (tiled at real-world scale)   tc  tint for that texture
// Characters and buildings face +X.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MODELS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PI = Math.PI;
  // Helpers take the BOTTOM y (easier to stack things) and return a part.
  const box = (w, h, d, x, y, z, c, o = {}) => ({ t: 'box', s: [w, h, d], p: [x, y + h / 2, z], c, ...o });
  const cyl = (r, h, x, y, z, c, o = {}) => ({ t: 'cyl', s: [o.rt ?? r, r, h], p: [x, y + h / 2, z], c, ...o, rt: undefined });
  const sph = (r, x, y, z, c, o = {}) => ({ t: 'sph', s: [r], p: [x, y, z], c, ...o });
  const cone = (r, h, x, y, z, c, o = {}) => ({ t: 'cone', s: [r, h], p: [x, y + h / 2, z], c, ...o });
  const clean = parts => parts.flat(Infinity).map(p => JSON.parse(JSON.stringify(p)));
  // A grid of lit windows on one face of a building. face: 'x' (front, +X) or 'z' (side, +Z).
  function windows(face, cx, cz, w, y0, rows, cols, spacingY, color = '#ffd88a', strength = 1.4) {
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const off = -w / 2 + (c + 0.5) * (w / cols), y = y0 + r * spacingY;
      const lit = (r * 7 + c * 3) % 5 !== 0;
      out.push(face === 'x'
        ? box(0.06, 0.55, w / cols * 0.6, cx, y, cz + off, lit ? color : '#2b3445', { e: lit ? color : undefined, ei: lit ? strength : undefined, ro: 0.2 })
        : box(w / cols * 0.6, 0.55, 0.06, cx + off, y, cz, lit ? color : '#2b3445', { e: lit ? color : undefined, ei: lit ? strength : undefined, ro: 0.2 }));
    }
    return out;
  }
  const lattice = (h, w, x, z, c) => [  // a tapering steel tower
    [-1, 1].map(sx => [-1, 1].map(sz => box(0.12, h, 0.12, x + sx * w / 2 * 0.7, 0, z + sz * w / 2 * 0.7, c, { m: 0.8, ro: 0.4 }))),
    [0.25, 0.5, 0.75].map(f => [box(w * 0.75, 0.08, 0.08, x, h * f, z - w * 0.35, c, { m: 0.8 }), box(w * 0.75, 0.08, 0.08, x, h * f, z + w * 0.35, c, { m: 0.8 }),
      box(0.08, 0.08, w * 0.75, x - w * 0.35, h * f, z, c, { m: 0.8 }), box(0.08, 0.08, w * 0.75, x + w * 0.35, h * f, z, c, { m: 0.8 })]),
  ];

  // ---------- Buildings (fit a 5.5m footprint, front faces +X) ----------
  const BUILDINGS = {
    lemon: { parts: clean([
      box(2.6, 1.0, 1.3, 0.3, 0, 0, '#f4ead2', { ro: 0.7, tx: 'plaster', tc: '#fff6dc' }),                       // counter
      box(2.7, 0.08, 1.4, 0.3, 1.0, 0, '#c99a5b', { ro: 0.6 }),                    // counter top
      [-0.9, 1.5].map(z => [-0.5, 1.1].map(x => box(0.08, 2.2, 0.08, x, 0, z * 0.45, '#8a6a43'))),
      [0, 1, 2, 3, 4, 5].map(i => box(0.4, 0.06, 1.8, -0.6 + i * 0.4 + 0.2, 2.25, 0, i % 2 ? '#ffffff' : '#f4c430', { r: [0.25, 0, 0] })),
      [[0.6, 0.25], [0.9, -0.2], [0.3, -0.35], [0.95, 0.3]].map(([x, z]) => sph(0.11, x, 1.18, z, '#ffe135', { sc: [1.25, 1, 1], ro: 0.5 })),
      cyl(0.18, 0.35, -0.2, 1.08, 0.1, '#fff6c8', { o: 0.75, ro: 0.1 }),          // pitcher
      box(0.05, 0.6, 1.2, 1.62, 0.25, 0, '#f4c430', { e: '#f4c430', ei: 0.25 }),  // sign
      sph(0.5, 0.3, 2.85, 0, '#ffe135', { sc: [1.35, 1, 1], ro: 0.45 }),           // big lemon
      box(0.6, 0.6, 0.6, -1.0, 0, -0.9, '#a5763f', { ro: 0.9 }),                    // crate
    ]) },
    cafe: { parts: clean([
      box(3.6, 3.2, 4.0, 0, 0, 0, '#9c4a34', { ro: 0.85, tx: 'brick' }),                         // brick body
      box(3.8, 0.25, 4.2, 0, 3.2, 0, '#e8dfd0'),                                    // cornice
      box(0.1, 1.6, 2.6, 1.81, 0.3, -0.4, '#ffd9a0', { e: '#ffcf88', ei: 1.1, ro: 0.1 }), // shop window
      box(0.1, 2.0, 0.9, 1.81, 0, 1.35, '#3b2a1e'),                                 // door
      [0, 1, 2, 3, 4, 5, 6].map(i => box(0.9, 0.06, 0.6, 2.2, 2.25, -1.8 + i * 0.6 + 0.3, i % 2 ? '#f1efe6' : '#2f6b3b', { r: [0, 0, -0.35] })),
      box(0.1, 0.5, 2.6, 1.82, 2.55, -0.4, '#2f6b3b', { e: '#7cd38a', ei: 0.3 }),  // sign
      cyl(0.04, 1.3, 3.3, 0, 0.6, '#cccccc', { m: 0.9 }), cyl(0.45, 0.06, 3.3, 0.72, 0.6, '#ffffff'),
      cone(1.0, 0.45, 3.3, 1.3, 0.6, '#c0392b'),                                     // umbrella
      [[-0.5, -0.9], [0.4, 1.3]].map(([x, z]) => cyl(0.25, 0.75, 3.3 + x * 0.1, 0, 0.6 + z * 0.2, '#ffffff', { rt: 0.25 })),
      box(0.6, 1.2, 0.6, -1.2, 3.45, -1.2, '#7a3b2b', { tx: 'brick' }),                              // chimney
      windows('z', 0, 2.01, 3.0, 1.0, 2, 3, 1.1),
    ]) },
    arcade: { parts: clean([
      box(4.4, 4.0, 4.6, 0, 0, 0, '#221a3a', { ro: 0.5, m: 0.3, tx: 'concrete_wall', tc: '#4a3d6e' }),
      [[2.21, 4.0, 4.6, 'x'], [-2.21, 4.0, 4.6, 'x']].map(([x]) => [box(0.08, 0.1, 4.6, x, 3.95, 0, '#ff3fd2', { e: '#ff3fd2', ei: 3 }), box(0.08, 0.1, 4.6, x, 0.05, 0, '#3ff3ff', { e: '#3ff3ff', ei: 3 })]),
      [-2.3, 2.3].map(z => box(4.4, 0.1, 0.08, 0, 3.95, z, '#ff3fd2', { e: '#ff3fd2', ei: 3 })),
      box(0.3, 1.2, 3.6, 2.35, 4.0, 0, '#120d22'),
      box(0.1, 0.9, 3.3, 2.52, 4.15, 0, '#ffde3b', { e: '#ffb83b', ei: 2.4 }),     // marquee
      box(0.1, 2.3, 1.5, 2.22, 0, 0, '#3ff3ff', { e: '#3ff3ff', ei: 1.4, o: 0.85 }), // glowing doors
      [-1.5, 1.5].map(z => box(0.1, 1.6, 0.9, 2.22, 0.6, z, '#ff3fd2', { e: '#ff3fd2', ei: 1.1 })),
      sph(0.35, 0, 4.9, 0, '#ff3fd2', { e: '#ff3fd2', ei: 2.5, a: 'pulse' }),
      cyl(0.05, 0.9, 0, 4.0, 0, '#888888', { m: 0.9 }),
    ]) },
    fact: { parts: clean([
      box(5.4, 3.2, 4.6, -0.2, 0, 0, '#8d939b', { ro: 0.8, m: 0.2, tx: 'shutter', tc: '#c9ced4' }),
      [0, 1, 2, 3].map(i => box(1.3, 0.12, 4.6, -2.3 + i * 1.35, 3.6, 0, '#6d737b', { r: [0, 0, 0.5], m: 0.4 })),
      [0, 1, 2, 3].map(i => box(0.08, 0.6, 4.4, -1.75 + i * 1.35, 3.25, 0, '#b8e3ff', { e: '#bfe8ff', ei: 0.6, o: 0.9 })),
      box(0.1, 2.2, 1.8, 2.56, 0, -0.8, '#5b6168', { m: 0.6 }),                     // roller door
      [0, 1, 2, 3, 4].map(i => box(0.12, 0.05, 1.8, 2.58, 0.3 + i * 0.42, -0.8, '#474c52')),
      windows('x', 2.56, 1.1, 1.4, 1.2, 2, 2, 0.9),
      [[-1.8, -1.4], [-1.0, 1.5]].map(([x, z]) => [
        cyl(0.42, 6.2, x, 0, z, '#a14a3c', { rt: 0.32, ro: 0.8 }),
        [1.8, 3.6, 5.4].map(y => cyl(0.36, 0.3, x, y, z, '#efefef', { rt: 0.35 })),
        [0, 1, 2].map(i => sph(0.45 + i * 0.12, x, 6.6 + i * 0.6, z, '#cfd2d6', { o: 0.55, a: 'smoke', ro: 1 })),
      ]),
      cyl(0.18, 4.8, 1.2, 1.3, 2.4, '#b8bcc2', { r: [0, 0, PI / 2], m: 0.8 }),
      box(1.2, 1.2, 1.2, 2.9, 0, 1.6, '#c29a5b'), box(1.0, 1.0, 1.0, 2.9, 1.2, 1.6, '#b38a4d'),
    ]) },
    bank: { parts: clean([
      box(5.0, 0.3, 5.0, 0, 0, 0, '#d9d4c7', { ro: 0.6, tx: 'marble' }), box(4.6, 0.3, 4.6, 0, 0.3, 0, '#e6e1d4', { tx: 'marble' }),
      box(3.8, 3.0, 4.2, -0.4, 0.6, 0, '#ece6d6', { ro: 0.55, tx: 'plaster', tc: '#f4efe2' }),
      [-1.6, -0.8, 0, 0.8, 1.6].map(z => [cyl(0.2, 3.0, 1.95, 0.6, z, '#f6f2e8', { seg: 14, rt: 0.17, ro: 0.4 }), box(0.5, 0.15, 0.5, 1.95, 3.45, z, '#ddd6c4')]),
      box(1.2, 0.35, 4.6, 1.5, 3.6, 0, '#ddd6c4'),
      { t: 'cyl', s: [1.0, 1.0, 4.6], p: [1.2, 4.0, 0], r: [PI / 2, 0, 0], seg: 3, sc: [1.2, 0.55, 1], c: '#ece6d6', ro: 0.5 }, // pediment
      sph(0.85, -0.6, 3.6, 0, '#d4a937', { m: 0.9, ro: 0.25, sc: [1, 0.85, 1] }),  // golden dome
      box(0.1, 2.0, 1.1, 1.52, 0.6, 0, '#6b4a1f', { m: 0.3 }),
      box(0.1, 0.5, 1.6, 1.53, 2.75, 0, '#d4a937', { m: 1, ro: 0.2 }),
    ]) },
    oil: { parts: clean([
      box(5.2, 0.25, 5.2, 0, 0, 0, '#4a4e54', { m: 0.5, ro: 0.7, tx: 'metal_plate' }),
      lattice(6.5, 1.8, -1.3, -1.2, '#c9372c'),
      box(0.5, 0.5, 0.5, -1.3, 6.5, -1.2, '#c9372c'), sph(0.12, -1.3, 7.15, -1.2, '#ff3b3b', { e: '#ff3b3b', ei: 3, a: 'blink' }),
      box(1.8, 0.6, 0.6, 1.2, 0.25, 1.0, '#2d3238', { m: 0.6 }),                     // pumpjack base
      box(0.3, 1.6, 0.3, 1.2, 0.85, 1.0, '#2d3238', { m: 0.6 }),
      { t: 'box', s: [2.6, 0.25, 0.3], p: [0, 0, 0], c: '#f0b429', m: 0.5, g: 'pump' },    // walking beam
      { t: 'box', s: [0.45, 0.7, 0.32], p: [1.3, -0.15, 0], c: '#f0b429', m: 0.5, g: 'pump' }, // horse head
      [[-1.6, 1.4], [-0.5, 1.9]].map(([x, z]) => [cyl(0.7, 1.8, x, 0.25, z, '#d9dde2', { m: 0.6, ro: 0.4 }), cyl(0.72, 0.12, x, 2.05, z, '#9aa1a8', { m: 0.7 })]),
      cyl(0.12, 3.4, 0.5, 0.45, -1.4, '#8c939b', { r: [0, 0, PI / 2], m: 0.9 }),
    ]), groups: { pump: { p: [1.2, 2.5, 1.0], a: 'pump' } } },
    space: { parts: clean([
      cyl(2.6, 0.4, 0, 0, 0, '#7d838a', { ro: 0.9, seg: 24, tx: 'concrete_wall' }),
      cyl(1.4, 0.15, 0.2, 0.4, 0, '#3c4046', { seg: 24 }),
      cyl(0.55, 4.6, 0.2, 0.55, 0, '#f2f2f2', { seg: 18, ro: 0.35, m: 0.2 }),
      cyl(0.56, 0.4, 0.2, 2.2, 0, '#22252a', { seg: 18 }), cyl(0.56, 0.3, 0.2, 4.0, 0, '#c9372c', { seg: 18 }),
      cone(0.55, 1.4, 0.2, 5.15, 0, '#c9372c', { seg: 18 }),
      [0, 1, 2, 3].map(i => box(0.08, 1.0, 0.7, 0.2 + Math.cos(i * PI / 2) * 0.7, 0.55, Math.sin(i * PI / 2) * 0.7, '#c9372c', { r: [0, -i * PI / 2, 0] })),
      cone(0.45, 0.5, 0.2, 0.15, 0, '#ff9b2f', { r: [PI, 0, 0], e: '#ff7b1f', ei: 2.5, a: 'pulse' }),
      lattice(6.2, 1.2, -1.6, 0, '#9aa1a8'),
      box(1.1, 0.12, 0.14, -0.85, 3.8, 0, '#9aa1a8', { m: 0.8 }), box(1.1, 0.12, 0.14, -0.85, 5.0, 0, '#9aa1a8', { m: 0.8 }),
      sph(0.1, -1.6, 6.35, 0, '#ff3b3b', { e: '#ff3b3b', ei: 3, a: 'blink' }),
    ]) },
    ailab: { parts: clean([
      box(4.2, 0.4, 4.2, 0, 0, 0, '#2a2f38', { m: 0.5, ro: 0.4, tx: 'metal_plate' }),
      box(3.4, 7.0, 3.4, 0, 0.4, 0, '#7fb8ff', { o: 0.35, m: 0.9, ro: 0.05 }),          // glass tower
      [-1.7, 1.7].map(x => [-1.7, 1.7].map(z => box(0.12, 7.0, 0.12, x, 0.4, z, '#c4ccd6', { m: 1, ro: 0.25 }))),
      [1.4, 2.8, 4.2, 5.6].map(y => box(3.5, 0.1, 3.5, 0, 0.4 + y, 0, '#c4ccd6', { m: 1, ro: 0.3 })),
      sph(0.9, 0, 3.6, 0, '#7af7ff', { e: '#3ae0ff', ei: 3, a: 'pulse' }),
      [-0.9, 0.9].map(z => box(0.6, 1.2, 0.5, -0.9, 0.4, z, '#14181f', { m: 0.5 })),
      [-0.9, 0.9].map(z => box(0.62, 0.05, 0.4, -0.88, 1.0, z, '#3aff8a', { e: '#3aff8a', ei: 2 })),
      cyl(0.05, 1.6, 0, 7.4, 0, '#c4ccd6', { m: 1 }), sph(0.12, 0, 9.05, 0, '#ff3b3b', { e: '#ff3b3b', ei: 3, a: 'blink' }),
    ]) },
    dyson: { parts: clean([
      cyl(2.2, 0.6, 0, 0, 0, '#2a2f38', { m: 0.7, ro: 0.35, seg: 24, tx: 'metal_plate' }),
      cyl(0.35, 2.2, 0, 0.6, 0, '#9aa1a8', { m: 0.9, seg: 12 }),
      sph(1.1, 0, 4.3, 0, '#fff1b0', { e: '#ffb02e', ei: 4, a: 'pulse', seg: 24 }),
      { t: 'torus', s: [1.9, 0.07], p: [0, 4.3, 0], r: [PI / 2, 0, 0], c: '#d4a937', m: 1, ro: 0.2, a: 'spin' },
      { t: 'torus', s: [2.2, 0.06], p: [0, 4.3, 0], r: [0.6, 0, 0.4], c: '#c4ccd6', m: 1, ro: 0.2, a: 'spinY' },
      { t: 'torus', s: [2.5, 0.05], p: [0, 4.3, 0], r: [-0.5, 0, -0.5], c: '#d4a937', m: 1, ro: 0.2, a: 'spin' },
    ]) },
  };

  // ---------- Lot dressing ----------
  const LOT = {
    forSale: { parts: clean([
      [-0.6, 0.6].map(z => cyl(0.04, 1.4, 0.5, 0, z, '#8a6a43')),
      box(0.06, 0.8, 1.5, 0.52, 0.9, 0, '#f5f5f5', { e: '#ffffff', ei: 0.1 }), box(0.07, 0.25, 1.3, 0.53, 1.35, 0, '#2f9e44'),
      [[1.6, -1.6], [1.8, 1.4], [-1.2, 1.8]].map(([x, z]) => [cone(0.22, 0.6, x, 0, z, '#ff7b1f'), cyl(0.23, 0.08, x, 0.3, z, '#ffffff', { rt: 0.15 })]),
    ]) },
    locked: { parts: clean([
      [-2.6, 2.6].map(x => box(0.06, 1.3, 5.2, x, 0, 0, '#9aa1a8', { m: 0.8, o: 0.6 })),
      [-2.6, 2.6].map(z => box(5.2, 1.3, 0.06, 0, 0, z, '#9aa1a8', { m: 0.8, o: 0.6 })),
      box(0.08, 0.7, 0.9, 2.65, 0.4, 0, '#c9372c', { e: '#c9372c', ei: 0.4 }),
      { t: 'torus', s: [0.18, 0.05], p: [2.72, 1.25, 0], r: [0, PI / 2, 0], c: '#d4a937', m: 1 },
      box(0.1, 0.35, 0.4, 2.72, 0.95, 0, '#d4a937', { m: 1 }),
    ]) },
    crate: { parts: clean([
      box(1.0, 1.0, 1.0, 0, 0, 0, '#d4a937', { m: 0.9, ro: 0.25, e: '#ffcc33', ei: 0.35 }),
      box(1.04, 0.16, 1.04, 0, 0.42, 0, '#b83a2d', { m: 0.3 }), box(0.16, 1.04, 1.04, 0, -0.02, 0, '#b83a2d', { m: 0.3 }),
      sph(0.14, 0, 1.12, 0, '#b83a2d'),
    ]) },
  };

  // ---------- Characters & weapons (face +X) ----------
  const SOLDIER = { parts: clean([
    // legs hang from hip pivots so they can swing while walking
    ['legL', 'legR'].map(g => [box(0.24, 0.85, 0.22, 0, -0.45, 0, '#3b4232', { g, ro: 0.9 }), box(0.3, 0.14, 0.24, 0.04, -0.95, 0, '#1d1f22', { g })]),
    box(0.34, 0.62, 0.56, 0, 0.98, 0, 'team', { ro: 0.75 }),                         // vest
    box(0.36, 0.1, 0.58, 0, 0.95, 0, '#2a2a2a', { ro: 0.8 }),                        // belt
    [-0.31, 0.31].map(z => box(0.18, 0.18, 0.12, 0.12, 1.3, z, '#3b4232')),          // shoulders
    box(0.6, 0.12, 0.12, 0.3, 1.3, 0.24, '#3b4232'), box(0.55, 0.12, 0.12, 0.33, 1.3, -0.12, '#3b4232', { r: [0, 0.5, 0] }), // arms
    sph(0.15, 0.02, 1.78, 0, '#e0b089', { ro: 0.6 }),                               // head
    sph(0.19, 0, 1.84, 0, 'team', { sc: [1.05, 0.72, 1.05], ro: 0.5 }),             // helmet
    box(0.04, 0.07, 0.24, 0.15, 1.8, 0, '#101418', { m: 0.6, ro: 0.15 }),             // visor
  ]), groups: { legL: { p: [0, 0.95, -0.14] }, legR: { p: [0, 0.95, 0.14] }, gun: { p: [0.52, 1.3, 0.08] } } };
  const lay = PI / 2; // turns a Y-axis cylinder to lie along X
  const GUNS = {
    pistol: clean([box(0.28, 0.08, 0.05, 0.06, -0.02, 0, '#1b1d20', { m: 0.8, ro: 0.35 }), box(0.07, 0.16, 0.05, -0.04, -0.15, 0, '#2a2c30', { r: [0, 0, 0.25] })]),
    smg: clean([box(0.42, 0.1, 0.07, 0.1, -0.04, 0, '#222428', { m: 0.7, ro: 0.4 }), box(0.06, 0.22, 0.05, 0.12, -0.24, 0, '#1b1d20'),
      { t: 'cyl', s: [0.022, 0.022, 0.18], p: [0.4, 0.0, 0], r: [0, 0, -lay], c: '#111111', m: 0.9 }, box(0.2, 0.05, 0.04, -0.2, -0.04, 0, '#222428')]),
    shotgun: clean([{ t: 'cyl', s: [0.035, 0.035, 0.85], p: [0.3, 0.02, 0], r: [0, 0, -lay], c: '#1d1f22', m: 0.85, ro: 0.3 },
      box(0.22, 0.07, 0.08, 0.28, -0.06, 0, '#6b4423', { ro: 0.6 }), box(0.32, 0.1, 0.06, -0.2, -0.06, 0, '#6b4423', { r: [0, 0, 0.15], ro: 0.6 })]),
    sniper: clean([{ t: 'cyl', s: [0.022, 0.03, 1.05], p: [0.45, 0.02, 0], r: [0, 0, -lay], c: '#2d3a2a', m: 0.7, ro: 0.4 },
      { t: 'cyl', s: [0.045, 0.045, 0.32], p: [0.12, 0.12, 0], r: [0, 0, -lay], c: '#111111', m: 0.9, ro: 0.2 },
      box(0.45, 0.1, 0.07, -0.1, -0.04, 0, '#3e4a37', { ro: 0.6 }), box(0.06, 0.22, 0.04, 0.6, -0.12, 0, '#222222', { r: [0, 0, 0.3] })]),
    rocket: clean([{ t: 'cyl', s: [0.09, 0.09, 1.15], p: [0.2, 0.08, 0], r: [0, 0, -lay], c: '#556b2f', ro: 0.75 },
      { t: 'cone', s: [0.09, 0.25], p: [0.88, 0.08, 0], r: [0, 0, -lay], c: '#8b2e22' }, box(0.08, 0.2, 0.06, 0.05, -0.1, 0, '#2a2c30')]),
  };

  // ---------- Downloaded art (desktop/assets, see tools/fetch-assets.mjs) ----------
  // Paths are relative to the assets folder: the web loads `desktop/assets/<path>`, Godot `res://assets/<path>`.
  // Poly Haven models are real-world size (metres). Others are scaled to `heights` at load time.
  const ASSETS = {
    skies: { day: 'sky/day.hdr', sunset: 'sky/sunset.hdr', dusk: 'sky/dusk.hdr', night: 'sky/night.hdr' },
    models: Object.fromEntries(['crate', 'military_crate', 'barrel', 'barrier', 'street_lamp', 'trash_can', 'hydrant', 'utility_box',
      'plastic_crate', 'covered_car', 'shrub', 'bench'].map(n => [n, `models/${n}.glb`])),
    characters: { soldier: 'characters/soldier.glb', hoodie: 'characters/hoodie.glb', jacket: 'characters/jacket.glb', denim: 'characters/denim.glb' },
    textures: ['concrete_floor', 'corrugated', 'metal_plate', 'marble', 'asphalt', 'brick', 'grass', 'pavers', 'slate', 'plaster', 'concrete_wall', 'roof', 'shutter'],
    heights: { soldier: 1.8 }, // the Rocketbox people are already real size
    // The fighters: photoreal people (Microsoft Rocketbox), one per opponent. Their legs play the run,
    // walk and idle clips in the direction they move; the upper body turns to where they aim and both
    // hands hold the gun out in front (posed in code each frame, the way GTA does it).
    fighter: {
      people: ['hoodie', 'jacket', 'denim'],
      bones: { spine: ['Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2'], head: 'Bip01 Head',
        R: ['Bip01 R UpperArm', 'Bip01 R Forearm', 'Bip01 R Hand'], L: ['Bip01 L UpperArm', 'Bip01 L Forearm', 'Bip01 L Hand'] },
      gunLen: { pistol: 0.26, smg: 0.5, shotgun: 0.85, sniper: 1.0, rocket: 1.0 },
      // where the gun is held: [ahead of the chest, below it, right of centre] in metres
      hold: { pistol: [0.53, 0.04, 0.04], smg: [0.38, 0.08, 0.1], shotgun: [0.34, 0.06, 0.13], sniper: [0.32, 0.04, 0.13], rocket: [0.18, -0.16, 0.17] },
    },
    // The guns: nodes in the soldier model, taken in the pose of his aiming clip (names end with it,
    // e.g. "CharacterArmature|Idle_Shoot") so barrel and roll come from the artist's pose.
    gunPose: 'Idle_Shoot',
    characterGuns: { pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', sniper: 'Sniper_2', rocket: 'RocketLauncher' },
  };
  // Texture path for a material set: tex('brick', 'diff') -> 'textures/brick_diff.jpg'
  const tex = (name, map) => `textures/${name}_${map}.jpg`;

  // Small seeded random generator, so decorations land in the same place on web and desktop.
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- Arena themes (one per map in shared.js MAPS) ----------
  // wallStyle: 'containers' (shipping containers, small blocks become crate stacks), 'stone', 'metal', 'marble'
  const ARENA = {
    scale: 0.05,       // metres per game pixel (arena 900x560 px = 45x28 m)
    wallHeight: 2.6,
    themes: [
      { name: 'Warehouse', sky: 'day', exposure: 0.85, sun: '#fff1d8', sunI: 2.8, floorTex: 'concrete_floor', floorTint: '#b9b3a9', floorTile: 4, outerTex: 'asphalt', wallStyle: 'containers', wallTex: 'corrugated', wallTile: 2.5,
        tints: ['#9b3426', '#2c5a8c', '#3b7a46', '#c07a28', '#6b6f75'], trim: '#3a3d42', line: '#e0b82e', lampsOn: false,
        props: ['crate', 'military_crate', 'barrel', 'plastic_crate', 'utility_box', 'trash_can', 'covered_car', 'barrier'] },
      { name: 'Pillars', sky: 'sunset', exposure: 0.95, sun: '#ffc690', sunI: 3.2, floorTex: 'slate', floorTile: 3, outerTex: 'pavers', wallStyle: 'stone', wallTex: 'concrete_wall', wallTile: 3,
        tints: ['#d8cfbf'], trim: '#a89a7c', line: '#c9b98f', lampsOn: false,
        props: ['barrier', 'shrub', 'bench', 'trash_can', 'hydrant', 'barrel'] },
      { name: 'Corridors', sky: 'night', exposure: 1.25, sun: '#9fb4ff', sunI: 1.2, floorTex: 'metal_plate', floorTile: 2.5, outerTex: 'asphalt', wallStyle: 'metal', wallTex: 'metal_plate', wallTile: 2,
        tints: ['#9aa3ad'], trim: '#3fb6ff', line: '#3fb6ff', lampsOn: true,
        props: ['utility_box', 'barrel', 'plastic_crate', 'military_crate', 'trash_can', 'barrier'] },
      { name: 'Vault', sky: 'dusk', exposure: 0.8, sun: '#ffd9a8', sunI: 2.0, floorTex: 'marble', floorTint: '#9c948a', floorTile: 3, outerTex: 'pavers', wallStyle: 'marble', wallTex: 'marble', wallTile: 3,
        tints: ['#ddd8cf'], trim: '#c99a2e', line: '#d4a937', lampsOn: true,
        props: ['military_crate', 'crate', 'bench', 'shrub', 'hydrant', 'barrier'] },
    ],
  };
  // Decorations around the outside of the arena (they never block shots: the fight only uses MAPS walls).
  function arenaProps(m) {
    const r = rng(101 + m * 7919), set = ARENA.themes[m].props, out = [];
    for (let i = 0; i < 38; i++) {
      const side = i % 4, along = r();
      const [x, z] = side < 2 ? [-25 + along * 50, (side ? 1 : -1) * (15.6 + r() * 5)] : [(side === 2 ? 1 : -1) * (24.2 + r() * 5), -16 + along * 32];
      out.push({ model: set[Math.floor(r() * set.length)], p: [+x.toFixed(2), 0, +z.toFixed(2)], ry: +(r() * PI * 2).toFixed(3) });
    }
    for (const [x, z, ry] of [[-23.6, -15.4, PI * 0.25], [23.6, -15.4, PI * 0.75], [-23.6, 15.4, -PI * 0.25], [23.6, 15.4, -PI * 0.75], [0, -15.6, PI / 2], [0, 15.6, -PI / 2]])
      out.push({ model: 'street_lamp', p: [x, 0, z], ry: +ry.toFixed(3), light: true });
    return out;
  }
  ARENA.themes.forEach((t, m) => { t.decor = arenaProps(m); });

  // ---------- City (tycoon view) ----------
  // 3x3 lots, `lot` metres apart, with roads between them. Lot i sits at x = (1 - floor(i/3)) * lot, z = (i % 3 - 1) * lot.
  const CITY = {
    lot: 10, pad: 7.6, road: 2.4,
    // Sky and light change as your business level rises (index = level - 1).
    levels: [
      { sky: 'day', exposure: 1.0, sun: '#fff1d6', sunI: 3.0, lampsOn: false },
      { sky: 'day', exposure: 1.0, sun: '#fff1d6', sunI: 3.0, lampsOn: false },
      { sky: 'day', exposure: 1.0, sun: '#fff1d6', sunI: 3.0, lampsOn: false },
      { sky: 'sunset', exposure: 0.95, sun: '#ffc690', sunI: 3.0, lampsOn: false },
      { sky: 'sunset', exposure: 0.95, sun: '#ffb070', sunI: 2.6, lampsOn: true },
      { sky: 'dusk', exposure: 1.1, sun: '#ffcfa0', sunI: 1.8, lampsOn: true },
      { sky: 'night', exposure: 1.3, sun: '#a9bcff', sunI: 0.9, lampsOn: true },
    ],
  };
  CITY.props = (() => {
    const r = rng(4242), out = [], L = CITY.lot;
    // street lamps at the four inner and four outer intersections (8 lights keeps it fast)
    for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const z of [-1.5, -0.5, 0.5, 1.5]) if (Math.abs(x) === Math.abs(z))
      out.push({ model: 'street_lamp', p: [x * L + 1.55, 0, z * L + 1.55], ry: +(-PI / 4).toFixed(3), light: true });
    // street furniture along the outside of the block
    const furniture = ['bench', 'hydrant', 'trash_can', 'shrub', 'shrub', 'bench'];
    for (let i = 0; i < 18; i++) {
      const side = i % 4, along = -1.3 + r() * 2.6;
      const [x, z] = side < 2 ? [along * L, (side ? 1 : -1) * (1.5 * L + 2.2)] : [(side === 2 ? 1 : -1) * (1.5 * L + 2.2), along * L];
      out.push({ model: furniture[i % furniture.length], p: [+x.toFixed(2), 0, +z.toFixed(2)], ry: side < 2 ? (side ? PI : 0) : (side === 2 ? -PI / 2 : PI / 2) });
    }
    // parked cars
    for (const [x, z, ry] of [[-1.5 * L - 2.4, -6, 0], [1.5 * L + 2.6, 7, PI], [4, 1.5 * L + 2.6, PI / 2]]) out.push({ model: 'covered_car', p: [x, 0, z], ry });
    return out;
  })();

  // ---------- City blocks (GTA-style streets around the arena and the business) ----------
  // cityLayout() is deterministic, so the web and desktop versions build exactly the same streets.
  const URBAN = {
    haze: { day: '#b8b1a3', sunset: '#c4a184', dusk: '#6f6474', night: '#15171e' }, // smog colour per sky
    fog: 0.0062,          // exponential fog density (web); distant blocks fade into the smog
    storey: 3.3,          // metres per floor
    street: 13, sidewalk: 2.6, block: 46, depth: 15, radius: 150,
    near: 105,            // buildings closer than this get real windows; further ones a painted window grid
    shadows: 60,          // buildings closer than this cast shadows (the sun's shadow map covers the middle)
    facades: [
      { tex: 'brick', tints: ['#c08f7a', '#a87563', '#cfa58d', '#93695a'] },
      { tex: 'plaster', tints: ['#d3c7b1', '#bdb3a3', '#c9b89c'] },
      { tex: 'concrete_wall', tints: ['#b0aea8', '#97958f'] },
    ],
    skyline: { count: 64, radius: [230, 430], size: [14, 30], floors: [18, 58] },
    // clear: half-extents (m) of the open ground in the middle; ring: buildings wall it in (a courtyard)
    arena: { clear: [30, 21], ring: true, seed: 77 },
    city: { clear: [21, 21], ring: false, seed: 91 },
  };
  const round2 = v => +v.toFixed(2);
  function cityLayout(where) {
    const U = URBAN, o = U[where], r = rng(o.seed), [cx, cz] = o.clear, D = U.depth;
    const buildings = [], sidewalks = [], lamps = [], cars = [], props = [];
    const pick = a => a[Math.floor(r() * a.length)];
    function building(x0, z0, x1, z1, floors) {
      const f = pick(U.facades), x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      buildings.push({ x: round2(x), z: round2(z), w: round2(x1 - x0), d: round2(z1 - z0), floors, h: round2(floors * U.storey + 0.6),
        tex: f.tex, tint: pick(f.tints), near: Math.hypot(x, z) < U.near, shade: Math.hypot(x, z) < U.shadows, tank: floors <= 10 && r() < 0.35, seed: Math.floor(r() * 1e6) });
    }
    // fill one side of a rectangle with buildings of varied width; `gap` leaves the odd alley
    function row(along0, along1, across0, across1, vertical, floorsMin, floorsMax, gap) {
      for (let t = along0; t < along1 - 3;) {
        let w = Math.min(8 + r() * 11, along1 - t); if (along1 - t - w < 6) w = along1 - t;
        const floors = floorsMin + Math.floor(r() * (floorsMax - floorsMin + 1));
        if (r() >= gap) vertical ? building(across0, t, across1, t + w, floors) : building(t, across0, t + w, across1, floors);
        t += w;
      }
    }
    // a block: buildings around its edge facing the streets, sidewalks outside it
    function block(x0, x1, z0, z1, ring) {
      const dist = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2), tall = dist > 110 ? 9 : 0;
      const dz = Math.min(D, (z1 - z0) / 2), dx = Math.min(D, (x1 - x0) / 2);
      const lo = ring ? 4 : 3 + tall, hi = ring ? 9 : 11 + tall * 2, gap = ring ? 0.1 : 0.04;
      row(x0, x1, z0, z0 + dz, false, lo, hi, gap); row(x0, x1, z1 - dz, z1, false, lo, hi, gap);
      row(z0 + dz, z1 - dz, x0, x0 + dx, true, lo, hi, gap); row(z0 + dz, z1 - dz, x1 - dx, x1, true, lo, hi, gap);
      const s = U.sidewalk;
      sidewalks.push([x0 - s, z0 - s, x1 + s, z0], [x0 - s, z1, x1 + s, z1 + s], [x0 - s, z0, x0, z1], [x1, z0, x1 + s, z1]);
    }
    // the middle: a courtyard walled in by buildings (arena), or open ground (the business)
    let Cx = cx, Cz = cz;
    if (o.ring) { block(-cx - D, cx + D, -cz - D, cz + D, true); Cx += D; Cz += D; }
    else { const s = U.sidewalk; sidewalks.push([-cx - s, -cz - s, cx + s, -cz], [-cx - s, cz, cx + s, cz + s], [-cx - s, -cz, -cx, cz], [cx, -cz, cx + s, cz]); }
    // blocks in a grid around it, separated by streets
    const spans = c => { const out = [[-c, c]]; for (let a = c + U.street; a < U.radius; a += U.block + U.street) out.push([a, a + U.block], [-a - U.block, -a]); return out; };
    for (const [x0, x1] of spans(Cx)) for (const [z0, z1] of spans(Cz)) if (x0 !== -Cx || z0 !== -Cz) block(x0, x1, z0, z1, false);
    // street furniture on the sidewalks of the streets right around the middle
    const edge = [Cx + U.street - 1.1, Cz + U.street - 1.1], inner = [Cx + 1.1, Cz + 1.1];
    for (let i = 0; i < 16; i++) {
      const side = i % 4, along = -0.85 + (Math.floor(i / 4) / 3) * 1.7 + (r() - 0.5) * 0.1, out = i % 8 < 4 ? edge : inner;
      const [x, z] = side < 2 ? [along * Cx, (side ? 1 : -1) * out[1]] : [(side === 2 ? 1 : -1) * out[0], along * Cz];
      lamps.push({ model: 'street_lamp', p: [round2(x), 0.15, round2(z)], ry: round2(side < 2 ? (side ? -PI / 2 : PI / 2) : (side === 2 ? PI : 0)), light: true });
    }
    for (let i = 0; i < 12; i++) { // parked cars along the kerb
      const side = i % 4, along = -0.8 + r() * 1.6, off = (side < 2 ? Cz : Cx) + U.street - U.sidewalk - 1.4;
      const [x, z] = side < 2 ? [along * Cx, (side ? 1 : -1) * off] : [(side === 2 ? 1 : -1) * off, along * Cz];
      cars.push({ model: 'covered_car', p: [round2(x), 0, round2(z)], ry: round2(side < 2 ? PI / 2 : 0) });
    }
    const stuff = ['hydrant', 'trash_can', 'trash_can', 'utility_box', 'plastic_crate', 'barrel'];
    for (let i = 0; i < 18; i++) {
      const side = i % 4, along = -0.9 + r() * 1.8, out = r() < 0.5 ? edge : inner;
      const [x, z] = side < 2 ? [along * Cx, (side ? 1 : -1) * out[1]] : [(side === 2 ? 1 : -1) * out[0], along * Cz];
      props.push({ model: pick(stuff), p: [round2(x), 0.15, round2(z)], ry: round2(r() * PI * 2) });
    }
    // the skyline: towers far away in the haze
    const S = U.skyline, skyline = [];
    for (let i = 0; i < S.count; i++) {
      const a = r() * PI * 2, d = S.radius[0] + r() * (S.radius[1] - S.radius[0]), w = S.size[0] + r() * (S.size[1] - S.size[0]);
      const floors = S.floors[0] + Math.floor(r() * (S.floors[1] - S.floors[0]));
      skyline.push({ x: round2(Math.cos(a) * d), z: round2(Math.sin(a) * d), w: round2(w), d: round2(w * (0.7 + r() * 0.5)), floors, h: round2(floors * U.storey), tint: pick(pick(U.facades).tints) });
    }
    return { buildings, sidewalks: sidewalks.map(a => a.map(round2)), lamps, cars, props, skyline };
  }
  // Windows on the sides of a building you can see from the middle (the arena or the business):
  // [x, y, z, rotationY, width, height, lit]; rotationY turns the window to face out of that side.
  // Ground floors get wide shop windows. `night` lights some of them.
  function windowsOf(b, night) {
    const U = URBAN, r = rng(b.seed), out = [];
    const sides = [[0, -1, b.w, 0], [0, 1, b.w, PI], [-1, 0, b.d, -PI / 2], [1, 0, b.d, PI / 2]];
    for (const [sx, sz, len, ry] of sides) {
      if (sx * -b.x + sz * -b.z < -1) continue; // faces away from the middle
      const n = Math.max(1, Math.floor((len - 1.4) / 3.1)), step = len / n;
      for (let f = 0; f < b.floors; f++) {
        const shop = f === 0, y = shop ? 1.55 : f * U.storey + 1.75, ww = shop ? Math.min(step - 0.8, 2.6) : 1.25, wh = shop ? 2.1 : 1.65;
        for (let k = 0; k < n; k++) {
          const t = -len / 2 + step * (k + 0.5);
          const x = b.x + (sx ? sx * (b.w / 2 + 0.03) : t), z = b.z + (sz ? sz * (b.d / 2 + 0.03) : t);
          out.push([round2(x), round2(y), round2(z), ry, round2(ww), wh, night && r() < 0.38 ? 1 : 0]);
        }
      }
    }
    return out;
  }

  return { BUILDINGS, LOT, SOLDIER, GUNS, ARENA, CITY, ASSETS, URBAN, tex, cityLayout, windowsOf };
});
