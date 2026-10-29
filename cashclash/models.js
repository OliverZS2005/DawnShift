// 3D models for Hustlefront, described as data so the web renderer (render3d.js, Three.js) and the
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
    // an estate agent's board on two posts at the front of the lot (the locked lots also get a chain-link
    // fence, LOT.fence)
    forSale: { parts: clean([[-0.75, 0.75].map(x => box(0.07, 1.9, 0.07, x, 0, 3.2, '#e8e4dc', { ro: 0.5 }))]) },
    locked: { parts: clean([[-0.75, 0.75].map(x => box(0.07, 1.9, 0.07, x, 0, 4.05, '#6b6f73', { m: 0.7, ro: 0.45 }))]) },
    // the boards on those posts: text, [letters, board] colours, centre [x, y, z] (signs facing +Z)
    boards: { forSale: { text: 'FOR SALE', colors: ['#a3302a', '#bdb7ab'], at: [0, 1.4, 3.24] },
      locked: { text: 'COMING SOON', colors: ['#cfc9bd', '#8a2a23'], at: [0, 1.4, 4.09] } },
    // chain-link fence round a lot you can't buy yet: [piece, x, z, rotation y] (models/kit_fence.glb,
    // panels 1.9 m wide from their origin towards -X, facing +Z)
    fence: (() => {
      const out = [], h = 3.8, n = 4, w = 2 * h / n;
      [[0, h], [h, 0], [0, -h], [-h, 0]].forEach(([cx, cz], s) => {
        const ry = [0, PI / 2, PI, -PI / 2][s], X = [Math.cos(ry), -Math.sin(ry)];
        for (let k = 0; k < n; k++) {
          const t = h - k * w;
          out.push(['panel', +(cx + X[0] * t).toFixed(3), +(cz + X[1] * t).toFixed(3), +ry.toFixed(4)], ['post', +(cx + X[0] * t).toFixed(3), +(cz + X[1] * t).toFixed(3), 0]);
        }
      });
      return out;
    })(),
    crate: { parts: clean([
      box(1.0, 1.0, 1.0, 0, 0, 0, '#d4a937', { m: 0.9, ro: 0.25, e: '#ffcc33', ei: 0.35 }),
      box(1.04, 0.16, 1.04, 0, 0.42, 0, '#b83a2d', { m: 0.3 }), box(0.16, 1.04, 1.04, 0, -0.02, 0, '#b83a2d', { m: 0.3 }),
      sph(0.14, 0, 1.12, 0, '#b83a2d'),
    ]) },
  };

  // The businesses as real buildings from the facade kits (URBAN.kit): the kit, floors (one more for each
  // milestone: 25/50/100/200 owned), the ground floor bays and window style, and the shop sign's
  // [letters, board] colours. lotBuilding() turns one into a building like cityLayout()'s, 6 x 5 m at the
  // back of the lot, its front (+Z) towards the production line.
  const SHOPS = {
    lemon: { kit: 'apartments', floors: 1, g: 'sd', u: 'small', sign: ['#ffd84a', '#20331d'] },
    cafe: { kit: 'apartments', floors: 2, g: 'sd', u: 'large', sign: ['#f3e3c3', '#3b2416'] },
    arcade: { kit: 'apartments', floors: 2, g: 'ds', u: 'double', sign: ['#ff5fd2', '#16102a'] },
    fact: { kit: 'factory', floors: 2, g: 'ds', u: 'large', sign: ['#ffffff', '#2f3a44'] },
    bank: { kit: 'apartments', floors: 3, g: 'sd', u: 'large', sign: ['#e9c46a', '#13233d'] },
    oil: { kit: 'factory', floors: 2, g: 'sd', u: 'small', sign: ['#ffb000', '#151515'] },
    space: { kit: 'factory', floors: 3, g: 'ds', u: 'double', sign: ['#9be7ff', '#0d1830'] },
    ailab: { kit: 'factory', floors: 4, g: 'sd', u: 'offset', sign: ['#ffffff', '#3b1f6e'] },
    dyson: { kit: 'apartments', floors: 5, g: 'ds', u: 'double', sign: ['#ffcf4a', '#3a1d05'] },
  };
  // The doorway of each kit's door bay ("door" piece): its opening, measured from the kit (metres; the bay
  // runs from x = -3 to 0, so its centre is 1.5 in from the bay's right end).
  const DOORWAY = { apartments: { w: 1.79, h: 2.6 }, factory: { w: 1.49, h: 2.15 } };
  function lotBuilding(id, milestones) {
    const s = SHOPS[id], seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000;
    const b = { x: 0, z: -1.3, w: 6, d: 5, floors: s.floors + milestones, h: (s.floors + milestones) * URBAN.kit.floor, seed, kit: s.kit,
      facade: 'brick', tint: '#ffffff', faces: [{ s: 2, n: 2, g: s.g, u: s.u, d: 0 }, { s: 0, n: 2, g: 'pp', u: s.u, d: 0 }, { s: 1, n: 2, g: 'pp', u: s.u, d: 0 }] };
    // the front door (lot coordinates, on the pad): walking through it takes you inside (interior())
    const k = s.g.indexOf('d');
    b.door = { x: b.w / 2 - k * URBAN.kit.bay - 1.5, z: b.z + b.d / 2, ...DOORWAY[s.kit] };
    return b;
  }

  // ---------- Inside the businesses ----------
  // Each business's front door leads into a room far bigger than the building (it shows through the door
  // like a portal). interior() lays one out, in the room's own coordinates: the doorway is at the origin
  // in the front wall (z = 0), facing +Z like the building's door, and the room runs back to z = -d.
  // A factory hall for the industries, a shop with a counter and customers' side for the rest; the
  // production lines (one more per milestone) run across the back. parts: plain boxes [size, centre,
  // texture, tint]; props: models; lights: [x, y, z]; blocks: footprints you can't walk through.
  // crew: who works there (ASSETS.npcs); the quest giver is one of them too, picked per reboot.
  // Every business has its own room on top of that: textures and tints (floor/walls/ceil), the colour and
  // strength of its lights (light, glow), and its own furnishings (decor(): procedural parts like the
  // models above, so they can glow, blink and pulse, plus downloaded props).
  const INSIDE = {
    lemon: { kind: 'shop', floor: ['slate', '#e8dcc0'], walls: ['plaster', '#f4e7a6'], ceil: '#fbf6e2', light: '#fff1c9', glow: 1, front: 'lemon', crew: ['woman2', 'man1', 'courier', 'woman4', 'man3'] },
    cafe: { kind: 'shop', floor: ['slate', '#8a6a52'], walls: ['brick', '#c9b2a0'], ceil: '#d8c8b8', light: '#ffd9a8', glow: 0.85, front: 'cafe', crew: ['chef', 'woman1', 'man2', 'woman3', 'courier'] },
    arcade: { kind: 'shop', floor: ['concrete_floor', '#3a3046'], walls: ['plaster', '#2a2436'], ceil: '#1c1826', light: '#d2b8ff', glow: 0.8, front: 'arcade', crew: ['man3', 'woman4', 'man1', 'guard', 'woman1'] },
    bank: { kind: 'shop', floor: ['marble', '#efe9df'], walls: ['plaster', '#e4dccd'], ceil: '#f2ede4', light: '#fff3dd', glow: 1, front: 'bank', crew: ['banker', 'exec', 'guard', 'woman2', 'man2'] },
    fact: { kind: 'factory', floor: ['concrete_floor', '#9c978f'], walls: ['brick', '#a89e94'], ceil: '#7b7f84', light: '#f2f4ff', glow: 1, front: 'fact', crew: ['builder', 'builder2', 'builder3', 'guard', 'courier'] },
    oil: { kind: 'factory', floor: ['metal_plate', '#7d7a74'], walls: ['concrete_wall', '#8f8a80'], ceil: '#5c5a56', light: '#ffc27a', glow: 0.9, front: 'oil', crew: ['builder2', 'builder', 'builder3', 'man3', 'guard'] },
    space: { kind: 'factory', floor: ['metal_plate', '#c9ced6'], walls: ['metal_plate', '#d9dee6'], ceil: '#b9c0ca', light: '#d6e8ff', glow: 0.8, front: 'space', crew: ['pilot', 'builder', 'builder3', 'exec', 'guard'] },
    ailab: { kind: 'factory', floor: ['plaster', '#e9ecef'], walls: ['plaster', '#eef1f4'], ceil: '#f4f6f8', light: '#eaf2ff', glow: 0.9, front: 'ailab', crew: ['exec', 'banker', 'builder3', 'woman3', 'man2'] },
    dyson: { kind: 'factory', floor: ['marble', '#3c3630'], walls: ['metal_plate', '#4a4038'], ceil: '#2c2622', light: '#ffb45e', glow: 0.75, front: 'dyson', crew: ['builder3', 'builder2', 'pilot', 'exec', 'builder'] },
  };
  // Each business's own furnishings. Rooms are w wide (x from -w/2 to w/2) and run back to z = -d; the
  // production lines, the counter (shops), the people's spots and the walking rounds stay clear, so this
  // only fills the walls, the corners, the space by the door and the ceiling. Returns procedural parts;
  // `prop` and `block` add downloaded models and footprints.
  function decor(id, w, d, h, r, prop, block) {
    const P = [], glow = (c, ei = 2) => ({ e: c, ei }), X = w / 2;
    // a cylinder turned on its side (o.r), placed by its centre rather than its bottom
    const pipe = (rad, len, x, y, z, c, o) => cyl(rad, len, x, y - len / 2, z, c, o);
    // a neon strip (not so bright that it washes out to white)
    const stripe = (x, y, z, len, c, along = 'z', a) => P.push(box(along === 'z' ? 0.06 : len, 0.06, along === 'z' ? len : 0.06, x, y, z, c, { ...glow(c, 0.9), ...(a ? { a } : {}) }));
    if (id === 'lemon') {
      // a striped awning over the counter, crates of lemons, a juice press and a lit drinks fridge
      for (let k = 0; k < 9; k++) P.push(box(0.75, 0.05, 1.3, -4.1 + k * 0.75, 2.45, -6.9, k % 2 ? '#fff6dc' : '#f2c21b', { r: [0.32, 0, 0] }));
      for (const [x, z] of [[-5.6, -2.4], [-5.6, -3.6], [-4.6, -2.4]]) {
        P.push(box(0.8, 0.45, 0.6, x, 0, z, '#9c6b3e'));
        for (let k = 0; k < 15; k++) P.push(sph(0.065, x - 0.28 + (k % 5) * 0.14, 0.5, z - 0.16 + Math.floor(k / 5) * 0.16, k % 4 ? '#f4d21c' : '#e9c412', { seg: 10 }));
      }
      block([-6.1, -4.0, -4.1, -2.0]);
      P.push(cyl(0.22, 0.5, 1.4, 1.06, -7.2, '#c7ccd1', { m: 0.8, ro: 0.3 }), cyl(0.18, 0.32, 1.4, 1.56, -7.2, '#f6e27a', { o: 0.75 }), sph(0.07, 1.4, 1.95, -7.2, '#2b2b2b'));
      P.push(box(1.4, 2.1, 0.7, X - 0.8, 0, -4.8, '#e8eef2', { m: 0.3 }), box(1.25, 1.7, 0.05, X - 0.8, 0.25, -4.44, '#bfe8ff', glow('#bfe8ff', 0.6)));
      for (let k = 0; k < 8; k++) P.push(cyl(0.05, 0.28, X - 1.3 + (k % 4) * 0.33, 0.5 + Math.floor(k / 4) * 0.75, -4.6, k % 2 ? '#f4d21c' : '#ffe98a', { seg: 10 }));
      block([X - 1.6, -5.2, X, -4.4]);
      P.push(box(2.2, 0.5, 0.06, -1.2, 3.1, -9.3, '#fff3b0', glow('#ffd84a', 1.6)));
    } else if (id === 'cafe') {
      // pendant lamps over the tables, a pastry case on the counter, an espresso machine and a bookshelf
      for (const [x, z] of [[-4.2, -2.6], [-1.2, -4.4], [-4.4, -5.6]]) {
        P.push(box(0.02, h - 2.3, 0.02, x, 2.3, z, '#222'), sph(0.2, x, 2.25, z, '#ffd9a0', { ...glow('#ffc27a', 2.2), seg: 14 }));
      }
      P.push(box(1.6, 0.5, 0.6, -3.2, 1.06, -7.2, '#d9eef5', { o: 0.35 }));
      for (let k = 0; k < 8; k++) P.push(sph(0.09, -3.8 + (k % 4) * 0.4, 1.2, -7.3 + Math.floor(k / 4) * 0.2, k % 3 ? '#c98b4a' : '#f2d2b0', { seg: 10 }));
      P.push(box(0.7, 0.55, 0.45, -0.4, 1.06, -7.25, '#9aa3ab', { m: 0.9, ro: 0.25 }), box(0.6, 0.06, 0.06, -0.4, 1.45, -7.0, '#ff7a3d', glow('#ff7a3d', 2)));
      // a bookshelf: back panel, sides and shelves, with books standing on each shelf
      P.push(box(0.05, 2.6, 2.6, -X + 0.03, 0, -3.6, '#4a2f1e'));
      for (const z of [-4.9, -2.3]) P.push(box(0.4, 2.6, 0.05, -X + 0.22, 0, z, '#5a3b26'));
      for (let k = 0; k < 5; k++) P.push(box(0.4, 0.04, 2.6, -X + 0.22, 0.3 + k * 0.58, -3.6, '#5a3b26'));
      for (let k = 0; k < 4; k++) for (let j = 0; j < 14; j++) {
        const tall = 0.3 + ((j * 7 + k) % 4) * 0.04;
        P.push(box(0.26, tall, 0.12 + ((j + k) % 3) * 0.03, -X + 0.2, 0.34 + k * 0.58, -4.75 + j * 0.17, ['#8c2f2f', '#2f4f8c', '#2f7a4a', '#c9a227', '#5b3a6e'][(j * 3 + k) % 5]));
      }
      block([-X, -5.0, -X + 0.5, -2.2]);
    } else if (id === 'arcade') {
      // neon along the walls and ceiling, rows of glowing cabinets, a claw machine and a prize counter
      for (const x of [-X + 0.05, X - 0.05]) { stripe(x, 0.15, -10, 20, '#ff3cf0', 'z', 'pulse'); stripe(x, h - 0.3, -10, 20, '#3cf0ff', 'z', 'pulse'); }
      for (const z of [-2.5, -6.5]) stripe(0, h - 0.05, z, w - 1, '#7a5cff', 'x');
      const screens = ['#ff4d6d', '#4dd2ff', '#9dff4d', '#ffd34d', '#c44dff'];
      for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) {
        const x = sg * (X - 0.55), z = -1.8 - k * 1.3, c = screens[(k * 2 + (sg > 0)) % screens.length];
        P.push(box(0.8, 1.7, 0.75, x, 0, z, '#15131c'), box(0.06, 0.55, 0.55, x - sg * 0.42, 1.05, z, c, glow(c, 2.6)), box(0.06, 0.22, 0.7, x - sg * 0.42, 1.75, z, c, { ...glow(c, 3.2), a: 'blink' }));
        prop('bar_chair', x - sg * 1.0, 0, z, 0);
      }
      block([-X, -6.6, -X + 1.0, -1.2]); block([X - 1.0, -6.6, X, -1.2]);
      // the claw machine, further in, full of prizes
      const cx = -3.6, cz = -4.6;
      P.push(box(1.0, 0.9, 1.0, cx, 0, cz, '#d43c6a'), box(0.95, 1.1, 0.95, cx, 0.9, cz, '#cfefff', { o: 0.3 }), box(1.0, 0.15, 1.0, cx, 2.0, cz, '#ffd34d', glow('#ffd34d', 1.6)));
      for (let k = 0; k < 9; k++) P.push(sph(0.1, cx - 0.25 + (k % 3) * 0.25, 1.0, cz - 0.25 + Math.floor(k / 3) * 0.25, screens[k % 5], { seg: 10 }));
      P.push(box(0.04, 0.5, 0.04, cx, 1.5, cz, '#c0c4c8', { m: 1 }));
      block([cx - 0.6, cz - 0.6, cx + 0.6, cz + 0.6]);
      // a glowing sign over the counter
      P.push(box(2.6, 0.45, 0.06, -1.2, 3.1, -9.3, '#ff3cf0', { ...glow('#ff3cf0', 1.8), a: 'pulse' }));
      for (let k = 0; k < 6; k++) P.push(sph(0.14, -4.0 + k * 0.5, 1.17, -7.2, screens[k % 5], { seg: 10 }));
    } else if (id === 'bank') {
      // a round vault door in the back wall, glass teller windows on the counter, velvet ropes and gold
      P.push(pipe(1.5, 0.35, 0, 1.6, -d + 0.2, '#8d939a', { r: [PI / 2, 0, 0], m: 0.9, ro: 0.3, seg: 40 }), pipe(0.35, 0.5, 0, 1.6, -d + 0.45, '#c9ced4', { r: [PI / 2, 0, 0], m: 1, ro: 0.2 }));
      for (let k = 0; k < 6; k++) { const a = k * PI / 3; P.push(box(0.08, 0.9, 0.08, Math.cos(a) * 0.6, 1.6 - 0.45 + Math.sin(a) * 0.6, -d + 0.55, '#d8dde2', { m: 1, r: [0, 0, a + PI / 2] })); }
      for (const x of [-3.6, -1.6, 0.4]) P.push(box(0.04, 1.0, 0.7, x, 1.09, -7.2, '#dff3ff', { o: 0.3 }));
      P.push(box(6.6, 0.06, 0.82, -1.2, 2.09, -7.2, '#b8963e', { m: 0.8, ro: 0.35 }));
      const posts = [[-6.2, -1.8], [-6.2, -3.4], [-6.2, -5.0], [-6.2, -6.4]]; // a queue line along the wall
      for (const [x, z] of posts) P.push(cyl(0.05, 0.95, x, 0, z, '#d4af37', { m: 1, ro: 0.25 }), sph(0.08, x, 0.98, z, '#d4af37', { m: 1, ro: 0.25 }));
      for (let k = 0; k < posts.length - 1; k++) { const [a, b] = [posts[k], posts[k + 1]]; P.push(box(Math.abs(b[0] - a[0]) + 0.04, 0.05, Math.abs(b[1] - a[1]) + 0.04, (a[0] + b[0]) / 2, 0.82, (a[1] + b[1]) / 2, '#8b1a2b')); }
      block([-6.4, -6.6, -6.0, -1.6]);
      for (let k = 0; k < 12; k++) P.push(box(0.36, 0.12, 0.18, X - 1.0 + (k % 3) * 0.38, 0.06 + Math.floor(k / 6) * 0.13, -11 - (Math.floor(k / 3) % 2) * 0.2, '#e7c14b', { m: 1, ro: 0.2 }));
      block([X - 1.3, -11.4, X - 0.0, -10.7]);
    } else if (id === 'fact') {
      // the original: steel columns and roof beams, the overhead crane, racks and carts along the walls
      for (const z of [-6, -12, -18, -24]) for (const x of [-6.5, 6.5]) block([x - 0.15, z - 0.15, x + 0.15, z + 0.15]);
      P.push(...[-6, -12, -18, -24].flatMap(z => [box(0.3, h, 0.3, -6.5, 0, z, '#4a5058', { tx: 'metal_plate', tc: '#4a5058' }), box(0.3, h, 0.3, 6.5, 0, z, '#4a5058', { tx: 'metal_plate', tc: '#4a5058' }), box(w, 0.35, 0.25, 0, h - 0.35, z, '#4a5058', { tx: 'metal_plate', tc: '#4a5058' })]));
      prop('crane', -1, h - 1.25, -15);
      for (const x of [-5.4, 3.4]) P.push(box(0.1, 0.01, d - 3, x, 0.001, -d / 2 - 1, '#d9a72a'));
      for (let z = -3; z > -d + 1.5; z -= 1.25) prop(z > -12 ? 'shelves_narrow' : 'shelves', -X + 0.4, 0, z, PI / 2);
      block([-X, -d, -X + 1.3, -1.5]);
      ['rack', 'rack', 'storage_cart', 'tool_cart', 'welding_cart', 'tool_chest', 'rack', 'rack', 'hand_truck', 'crate2', 'crate2', 'propane', 'propane'].forEach((m, k) => prop(m, X - 0.6, 0, -3 - k * 1.7, -PI / 2));
      block([X - 1.5, -d, X, -1.5]);
    } else if (id === 'oil') {
      // a refinery floor: tall tanks down one side, pipe runs along the walls and ceiling, barrels, beacons
      for (const z of [-5, -11, -17, -23]) {
        P.push(cyl(1.3, h - 1.2, -X + 1.5, 0, z, '#b9b4a8', { m: 0.6, ro: 0.45, seg: 32 }), cyl(1.32, 0.12, -X + 1.5, h * 0.45, z, '#d9a72a'));
        P.push(cyl(0.12, 2.2, -X + 2.9, 0, z + 0.9, '#8a8f95', { m: 0.8 }));
        block([-X, z - 1.4, -X + 3.1, z + 1.4]);
      }
      for (const y of [h - 0.6, h - 1.1]) P.push(pipe(0.16, d - 2, X - 0.4, y, -d / 2, '#a45a2a', { r: [PI / 2, 0, 0], m: 0.6 }), pipe(0.12, w - 1, 0, y + 0.2, -d + 0.6, '#6f7b85', { r: [0, 0, PI / 2], m: 0.7 }));
      for (const z of [-4, -10, -16, -22]) P.push(pipe(0.16, 0.3, X - 0.4, h - 0.6, z, '#2d2d2d', { r: [PI / 2, 0, 0] }), pipe(0.22, 0.08, X - 0.75, h - 0.6, z, '#c0392b', { r: [0, 0, PI / 2] }));
      for (let k = 0; k < 10; k++) prop('barrel', X - 0.7 - (k % 2) * 0.7, 0, -3 - Math.floor(k / 2) * 0.8, r() * PI);
      block([X - 1.6, -7.2, X, -2.4]);
      prop('generator', X - 1.0, 0, -12, -PI / 2, [0.8, 1.0]); prop('compressor', X - 1.0, 0, -15, -PI / 2, [0.7, 0.8]); prop('propane', X - 0.6, 0, -18, 0); prop('propane', X - 0.6, 0, -18.7, 0);
      block([X - 1.8, -19.2, X, -11]);
      for (const x of [-5.4, 3.4]) for (let k = 0; k < 10; k++) P.push(box(0.12, 0.01, 1.0, x, 0.001, -2.5 - k * 2.2, k % 2 ? '#1c1c1c' : '#e0b21c'));
      for (const z of [-6, -14, -22]) P.push(sph(0.18, 6.5, h - 0.25, z, '#ff8c1a', { ...glow('#ff7a00', 3), a: 'blink' }));
    } else if (id === 'space') {
      // a mining bay: portholes full of stars, glowing ore crystals, light strips, a landed capsule
      for (const z of [-5, -11, -17, -23]) {
        for (const x of [-X + 0.05, X - 0.05]) {
          P.push(pipe(0.9, 0.12, x, 2.6, z, '#0a0d18', { r: [0, 0, PI / 2], seg: 32 }), pipe(1.02, 0.08, x, 2.6, z, '#9aa6b4', { r: [0, 0, PI / 2], m: 0.9, seg: 32 }));
          for (let k = 0; k < 5; k++) P.push(sph(0.03, x - Math.sign(x) * 0.07, 2.25 + r() * 0.7, z - 0.5 + r(), '#ffffff', { ...glow('#ffffff', 4), seg: 6 }));
        }
      }
      for (const x of [-X + 0.06, X - 0.06]) stripe(x, 0.3, -d / 2, d - 1, '#2f8fff', 'z');
      stripe(0, h - 0.05, -d / 2, w - 2, '#8fd3ff', 'x');
      for (const [x, z] of [[-8.4, -6], [-8.6, -9], [-8.3, -15], [-8.6, -20], [8.5, -8], [8.4, -18]]) {
        for (let k = 0; k < 4; k++) P.push(cone(0.18 + r() * 0.12, 0.6 + r() * 0.8, x + (r() - 0.5) * 0.6, 0, z + (r() - 0.5) * 0.6, '#1fb8e8', { ...glow('#18c8ff', 0.9), a: 'pulse', seg: 6, r: [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5] }));
        block([x - 0.7, z - 0.7, x + 0.7, z + 0.7]);
      }
      P.push(cyl(1.2, 2.4, 7.6, 0, -13, '#e9ecef', { rt: 0.9, m: 0.4, seg: 28 }), cone(0.9, 1.4, 7.6, 2.4, -13, '#e9ecef', { m: 0.4, seg: 28 }), pipe(0.5, 0.06, 7.6, 1.4, -11.82, '#0b1730', { r: [PI / 2, 0, 0], ...glow('#3a7bff', 0.6) }));
      block([6.2, -14.4, X, -11.6]);
      prop('drill_press', 8.6, 0, -23.5, -PI / 2, [0.6, 0.6]); prop('storage_cart', 8.6, 0, -3.5, -PI / 2, [0.6, 0.6]);
    } else if (id === 'ailab') {
      // rows of server racks with blinking lights, desks with monitors, a glass meeting room, cable trays
      for (let k = 0; k < 7; k++) {
        const z = -6 - k * 2.6;
        for (const x of [-X + 0.5, -X + 1.3]) {
          P.push(box(0.7, 2.3, 1.0, x, 0, z, '#1a1d22', { m: 0.5, ro: 0.4 }));
          for (let j = 0; j < 6; j++) P.push(box(0.05, 0.04, 0.04, x + 0.36, 0.3 + j * 0.33, z - 0.3 + (j % 3) * 0.25, j % 3 ? '#41ff8a' : '#3ab0ff', { ...glow(j % 3 ? '#41ff8a' : '#3ab0ff', 3.5), a: (j + k) % 2 ? 'blink' : 'pulse' }));
        }
        block([-X, z - 0.55, -X + 1.7, z + 0.55]);
      }
      P.push(box(0.3, 0.1, d - 6, -X + 0.9, h - 0.6, -d / 2 - 1, '#7e8792', { m: 0.6 }));
      for (const z of [-4, -7.5]) { prop('desk', X - 1.3, 0, z, -PI / 2, [0.6, 1.1]); prop('tv', X - 1.5, 0.78, z - 0.4, -PI / 2); prop('tv', X - 1.5, 0.78, z + 0.4, -PI / 2); prop('armchair', X - 2.4, 0, z, PI / 2); }
      P.push(box(0.06, 2.6, 6, 6.3, 0, -18, '#dff3ff', { o: 0.22 }), box(3.6, 2.6, 0.06, X - 1.85, 0, -15, '#dff3ff', { o: 0.22 }), box(1.6, 0.75, 3.2, 8.2, 0, -18.5, '#ffffff'));
      block([6.2, -21, X, -15]);
      P.push(box(2.6, 1.4, 0.05, 0, 3.6, -d + 0.08, '#081420', glow('#1d6fff', 0.8)), box(2.2, 0.08, 0.05, 0, 4.0, -d + 0.12, '#41ff8a', { ...glow('#41ff8a', 2.5), a: 'pulse' }));
    } else if (id === 'dyson') {
      // the control room: a huge window onto the sun, an arc of consoles, pulsing energy conduits, gold trim
      P.push(box(w - 2, h - 1.6, 0.1, 0, 0.9, -d + 0.15, '#050505'), sph(5.5, 0, 3.4, -d - 6.5, '#ffd27a', { ...glow('#ff9a1f', 5), seg: 40 }), box(w - 2, 0.12, 0.3, 0, h - 0.7, -d + 0.3, '#c9a227', { m: 1, ro: 0.3 }));
      for (let k = 0; k < 7; k++) {
        const a = -0.9 + k * 0.3, x = Math.sin(a) * 7.4, z = -3.5 - Math.cos(a) * 0.9;
        if (Math.abs(x) < 6) continue;
        P.push(box(1.1, 0.9, 0.6, x, 0, z, '#2a2622', { r: [0, -a, 0] }), box(0.95, 0.45, 0.05, x, 0.95, z - 0.1, '#ffb45e', { ...glow('#ffb45e', 1.8), r: [-0.5, -a, 0] }));
        block([x - 0.7, z - 0.5, x + 0.7, z + 0.5]);
      }
      for (const z of [-6, -12, -18, -24]) for (const x of [-X + 0.6, X - 0.6]) { P.push(cyl(0.28, h, x, 0, z, '#ff8a2a', { ...glow('#ff7a1a', 2.4), a: 'pulse', seg: 18 }), cyl(0.36, 0.25, x, 0, z, '#c9a227', { m: 1 }), cyl(0.36, 0.25, x, h - 0.25, z, '#c9a227', { m: 1 })); block([x - 0.4, z - 0.4, x + 0.4, z + 0.4]); }
      for (const x of [-5.4, 3.4]) P.push(box(0.08, 0.01, d - 3, x, 0.001, -d / 2 - 1, '#ffb45e', glow('#ffb45e', 1.2)));
    }
    return P;
  }
  function interior(id, milestones) {
    const I = INSIDE[id], door = DOORWAY[SHOPS[id].kit], fac = I.kind === 'factory';
    const w = fac ? 20 : 14, d = fac ? 26 : 20, h = fac ? 7 : 4.5, r = rng(([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 1000) + 1);
    const parts = [], props = [], lights = [], blocks = [], lines = [];
    const box2 = (sx, sy, sz, x, y, z, tex, tint) => parts.push([[sx, sy, sz].map(round2), [x, y, z].map(round2), tex, tint]);
    const prop = (model, x, y, z, ry = 0, block) => { props.push({ model, p: [x, y, z].map(round2), ry: round2(ry) }); if (block) blocks.push([x - block[0], z - block[1], x + block[0], z + block[1]].map(round2)); };
    // the shell: floor, ceiling, walls (the front one round the doorway)
    const [wallTex, wallTint] = I.walls, [floorTex, floorTint] = I.floor;
    box2(w, 0.1, d, 0, -0.05, -d / 2, floorTex, floorTint);
    box2(w, 0.2, d, 0, h + 0.1, -d / 2, fac ? 'corrugated' : 'plaster', I.ceil);
    box2(0.3, h, d, -w / 2 - 0.15, h / 2, -d / 2, wallTex, wallTint); box2(0.3, h, d, w / 2 + 0.15, h / 2, -d / 2, wallTex, wallTint);
    box2(w, h, 0.3, 0, h / 2, -d - 0.15, wallTex, wallTint);
    const side = (w - door.w) / 2;
    box2(side, h, 0.3, -door.w / 2 - side / 2, h / 2, 0.15, wallTex, wallTint); box2(side, h, 0.3, door.w / 2 + side / 2, h / 2, 0.15, wallTex, wallTint);
    box2(door.w, h - door.h, 0.3, 0, door.h + (h - door.h) / 2, 0.15, wallTex, wallTint);
    for (const x of [-1, 1]) box2(0.12, door.h + 0.1, 0.36, x * (door.w / 2 + 0.06), (door.h + 0.1) / 2, 0.15, 'metal_plate', '#3b3e42'); // door frame
    box2(door.w + 0.24, 0.12, 0.36, 0, door.h + 0.06, 0.15, 'metal_plate', '#3b3e42');
    // production lines across the back, one more for each milestone (4 in a factory hall, 3 in a shop)
    const n = Math.min(fac ? 4 : 3, 1 + milestones), lz = fac ? [-8, -12.5, -17, -21.5] : [-11.5, -15, -18.5];
    const half = CITY.line.length / 2;
    for (let k = 0; k < n; k++) {
      lines.push({ x: fac ? -1 : 0, z: lz[k], machines: 3 });
      blocks.push([(fac ? -1 : 0) - half - 0.15, lz[k] - 1.4, (fac ? -1 : 0) + half + 0.9, lz[k] + 0.45].map(round2));
    }
    const extra = clean(decor(id, w, d, h, r, prop, b => blocks.push(b.map(round2))));
    if (fac) {
      prop('extinguisher', -w / 2 + 0.25, 0, -1.2, PI / 2); prop('wet_floor', 2.2, 0, -3.2, r() * PI);
      prop('power_box', w / 2 - 0.05, 1.4, -2, -PI / 2);
      for (const z of [-8, -12.5, -17, -21.5]) for (const x of [-4.5, 2.5]) prop(id === 'fact' || id === 'oil' ? 'hanging_lamp' : 'fluorescent', x, h, z + 1.2);
      lights.push([-1, h - 1.6, -6], [-1, h - 1.6, -12.5], [-1, h - 1.6, -19], [-7, h - 1.6, -10], [7, h - 1.6, -16]);
    } else {
      // the counter with the till, a partition wall to the back with shelves, plants by the door
      box2(6.4, 1.0, 0.7, -1.2, 0.5, -7.2, 'plaster', { lemon: '#e6c34a', cafe: '#6b4a35', arcade: '#2b2140', bank: '#7a5c3e' }[id]); box2(6.6, 0.06, 0.82, -1.2, 1.03, -7.2, 'marble', id === 'arcade' ? '#3a2f55' : '#e8e2d8');
      blocks.push([-4.6, -7.8, 2.2, -6.6]);
      prop('cash_register', 0.8, 1.06, -7.2, 0);
      if (id !== 'arcade') { prop('chalkboard', 2.6, 0, -1.3, PI * 0.85); blocks.push([2.1, -1.8, 3.1, -0.8]); }
      if (id !== 'arcade') { prop('plant', -w / 2 + 0.7, 0, -1.0); prop('plant', w / 2 - 0.7, 0, -1.0); }
      box2(w / 2 - 3.2, 2.4, 0.15, -w / 2 + (w / 2 - 3.2) / 2, 1.2, -9.4, 'plaster', id === 'arcade' ? '#221c30' : '#b8afa4'); box2(w / 2 - 3.2, 2.4, 0.15, w / 2 - (w / 2 - 3.2) / 2, 1.2, -9.4, 'plaster', id === 'arcade' ? '#221c30' : '#b8afa4');
      blocks.push([-w / 2, -9.6, -3.2, -9.2], [3.2, -9.6, w / 2, -9.2]);
      if (id === 'cafe' || id === 'lemon') for (let k = 0; k < 4; k++) prop('wall_shelf', -w / 2 + 1.2 + k * 1.1, 0, -9.3, 0);
      if (id === 'cafe') {
        prop('coffee_cart', w / 2 - 1.4, 0, -4.2, -PI / 2, [0.7, 1.2]);
        for (const [x, z] of [[-4.2, -2.6], [-1.2, -4.4], [-4.4, -5.6]]) {
          prop('round_table', x, 0, z, r(), [0.8, 0.8]);
          for (let c = 0; c < 3; c++) { const a = c * 2.1 + r(); prop('bar_chair', x + Math.cos(a) * 0.95, 0, z + Math.sin(a) * 0.95, -a + PI / 2); }
        }
      } else if (id === 'lemon') {
        for (let k = 0; k < 2; k++) prop('display_shelves', -w / 2 + 0.3, 0, -5.0 - k * 1.15, 0);
        blocks.push([-w / 2, -6.5, -w / 2 + 0.8, -4.2]);
      } else if (id === 'bank') {
        for (const x of [-4.2, 0.8]) { prop('desk', x, 0, -4.4, 0, [1.05, 0.55]); prop('armchair', x, 0, -3.1, PI); prop('armchair', x, 0, -5.4, 0); }
        prop('plant', -1.7, 0, -4.4); prop('tv', 2.9, 1.2, -9.1, 0);
      }
      for (const z of [-3, -8, -13, -17.5]) for (const x of [-3.5, 3.5]) if (id !== 'cafe' || z < -8) prop('fluorescent', x, h, z);
      lights.push([-3, h - 1.1, -3.5], [3, h - 1.1, -3.5], [0, h - 1.1, -9.5], [-2.5, h - 1.1, -15], [2.5, h - 1.1, -15]);
    }
    // people: the quest giver by the way in; a worker at the first and last machine of each line and one
    // at its till; staff behind the counter (shops); and people walking rounds, more as you grow.
    // Positions are [x, z]; ry turns a person facing +Z; stand.clip: idle, talk or work
    const stand = [], walk = [], crew = I.crew;
    const giver = fac ? { p: [4, -3], ry: -0.6 } : { p: [3.3, -6.5], ry: -0.3 };
    lines.forEach((ln, k) => {
      for (const m of [0, 2]) stand.push({ p: [ln.x - half + 0.7 + m * 1.7, ln.z - 1.75].map(round2), ry: 0, clip: 'work', who: crew[(k * 2 + m) % crew.length] });
      stand.push({ p: [ln.x + half + 0.45, ln.z - 0.95].map(round2), ry: 0, clip: 'idle', who: crew[(k + 3) % crew.length] });
    });
    if (!fac) {
      stand.push({ p: [-2.6, -8.0], ry: 0, clip: 'idle', who: crew[0] });
      stand.push({ p: [-0.6, -6.2], ry: PI, clip: 'talk', who: crew[3 % crew.length] }); // a customer at the counter
    }
    const rounds = fac ? [[-7.7, -3], [7.7, -3], [7.7, -24.3], [-7.7, -24.3]] : [[0.4, -2.2], [1.6, -2.2], [1.6, -5.9], [0.4, -5.9]];
    for (let k = 0; k < Math.min(3, 1 + milestones); k++) walk.push({ path: rounds, speed: round2(1.1 + r() * 0.35), phase: round2(k / 3 + r() * 0.1), who: crew[(k + 1) % crew.length] });
    for (const s of stand) blocks.push([s.p[0] - 0.25, s.p[1] - 0.25, s.p[0] + 0.25, s.p[1] + 0.25].map(round2));
    blocks.push([giver.p[0] - 0.3, giver.p[1] - 0.3, giver.p[0] + 0.3, giver.p[1] + 0.3]);
    return { kind: I.kind, w, d, h, door, parts, extra, props, lights, light: I.light, glow: I.glow, lines, blocks, people: { giver, stand, walk, crew } };
  }
  // Where someone walking a closed path is after d metres: [x, z, heading (rotation y, facing +Z)].
  function pathAt(path, d) {
    const seg = path.map((p, i) => { const q = path[(i + 1) % path.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
    const total = seg.reduce((a, b) => a + b, 0);
    let t = ((d % total) + total) % total, i = 0;
    while (t > seg[i]) { t -= seg[i]; i++; }
    const p = path[i], q = path[(i + 1) % path.length], f = t / seg[i];
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, Math.atan2(q[0] - p[0], q[1] - p[1])];
  }

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
  // real cars (Grab3D, repainted by fetch-assets.mjs): models/car_<name>.glb, nose towards +Z
  const CARS = ['car_sedan', 'car_sedan2', 'car_wagon', 'car_van', 'car_suv', 'car_taxi'];
  const ASSETS = {
    skies: { day: 'sky/day.hdr', sunset: 'sky/sunset.hdr', dusk: 'sky/dusk.hdr', night: 'sky/night.hdr' },
    models: Object.fromEntries(['crate', 'military_crate', 'barrel', 'barrier', 'street_lamp', 'trash_can', 'hydrant', 'utility_box',
      'plastic_crate', 'covered_car', 'shrub', 'bench', 'drill_press', 'generator', 'compressor', 'cash_register', 'box', ...CARS,
      // inside the businesses
      'shelves', 'shelves_narrow', 'rack', 'tool_cart', 'tool_chest', 'hand_truck', 'welding_cart', 'storage_cart', 'fluorescent', 'hanging_lamp',
      'extinguisher', 'wet_floor', 'power_box', 'crate2', 'propane', 'cement_bag', 'coffee_cart', 'bar_chair', 'round_table', 'display_shelves',
      'wall_shelf', 'plant', 'tv', 'desk', 'armchair', 'chalkboard', 'crane']
      .map(n => [n, `models/${n}.glb`])),
    characters: { hoodie: 'characters/hoodie.glb', jacket: 'characters/jacket.glb', denim: 'characters/denim.glb' },
    // townspeople and workers (Rocketbox; clips idle, walk, talk, work)
    npcs: Object.fromEntries(['builder', 'builder2', 'builder3', 'chef', 'courier', 'exec', 'banker', 'pilot', 'guard', 'woman1', 'woman2', 'woman3', 'woman4', 'man1', 'man2', 'man3']
      .map(n => [n, `characters/${n}.glb`])),
    // realistic guns (OpenGameArt, CC0), already turned barrel-forward (-Z) and centred by tools/guns.py
    guns: { pistol: 'guns/pistol.glb', smg: 'guns/smg.glb', shotgun: 'guns/shotgun.glb', sniper: 'guns/sniper.glb', rocket: 'guns/rocket.glb' },
    textures: ['concrete_floor', 'corrugated', 'metal_plate', 'marble', 'asphalt', 'brick', 'grass', 'pavers', 'slate', 'plaster', 'concrete_wall', 'roof', 'shutter'],
    facades: ['brick', 'brick2', 'concrete', 'tower'], // textures/facade_<name>_{diff,nor,rough,metal,night,emit}.jpg
    // modelled building fronts (Poly Haven kits): one object per piece, see URBAN.kit and tools/kit.py
    kits: { apartments: 'models/kit_apartments.glb', factory: 'models/kit_factory.glb', fence: 'models/kit_fence.glb' },
    heights: { shelves: 2.14 }, // everything else is already real size (that shelf's file is 10x)
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
        tints: ['#a7a39b', '#9a968e'], trim: '#7d7a73', line: '#c9b98f', lampsOn: false, // weathered cast concrete
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
    // out in the plaza: the quest giver near where you start, and people walking round the sidewalks
    town: {
      giver: { p: [14.6, 15.8], ry: -1.9 },
      walk: [
        { path: [[-16.8, -16.8], [16.8, -16.8], [16.8, 16.8], [-16.8, 16.8]], speed: 1.25, phase: 0.05, who: 'woman1' },
        { path: [[-16.8, -16.8], [16.8, -16.8], [16.8, 16.8], [-16.8, 16.8]], speed: 1.1, phase: 0.4, who: 'man2' },
        { path: [[-16.8, 16.8], [16.8, 16.8], [16.8, -16.8], [-16.8, -16.8]], speed: 1.35, phase: 0.7, who: 'courier' },
        { path: [[5, -16.8], [5, 16.8]], speed: 1.2, phase: 0.2, who: 'woman3' },
        { path: [[-5, 16.8], [-5, -16.8]], speed: 1.05, phase: 0.6, who: 'man1' },
        { path: [[-16.8, 5], [16.8, 5]], speed: 1.3, phase: 0.35, who: 'exec' },
        { path: [[16.8, -5], [-16.8, -5]], speed: 1.15, phase: 0.85, who: 'woman4' },
      ],
      crew: ['man3', 'woman2', 'guard', 'woman1', 'man1', 'courier', 'woman4', 'man2'], // the giver is one of these
      // who walks each route changes with every reboot: walker k is folk[(k * 5 + reboots * 7) % folk.length]
      folk: ['woman1', 'man2', 'courier', 'woman3', 'man1', 'exec', 'woman4', 'man3', 'woman2', 'banker', 'chef', 'guard'],
    },
    lot: 10, pad: 7.6, road: 2.4,
    // each owned lot's production line: a conveyor (metres; speed in m/s) along its front edge, fed by
    // machines (one more per milestone, up to 3) and ending in a till
    line: { length: 6.2, height: 0.85, speed: 0.9, machines: ['drill_press', 'generator', 'compressor'] },
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
    [[-1.5 * L - 2.4, -6, 0], [1.5 * L + 2.6, 7, PI], [4, 1.5 * L + 2.6, PI / 2]].forEach(([x, z, ry], i) => out.push({ model: CARS[i * 2], p: [x, 0, z], ry }));
    return out;
  })();

  // ---------- City blocks (GTA-style streets around the arena and the business) ----------
  // cityLayout() is deterministic, so the web and desktop versions build exactly the same streets.
  const URBAN = {
    haze: { day: '#b8b1a3', sunset: '#c4a184', dusk: '#6f6474', night: '#15171e' }, // smog colour per sky
    fog: 0.0062,          // exponential fog density (web); distant blocks fade into the smog
    storey: 3.3,          // metres per floor
    street: 13, sidewalk: 2.6, block: 46, depth: 15, radius: 150,
    near: 105,            // buildings closer than this get storefronts, ledges, cornices and roof tanks
    shadows: 60,          // buildings closer than this cast shadows (the sun's shadow map covers the middle)
    // photographed building fronts (ambientCG); tints vary them a little. `tile`: metres one copy of the
    // photo covers (6 floors of 3.3 m for the apartment blocks)
    facades: [
      { facade: 'brick', tints: ['#ffffff', '#efe4da', '#e2d6cc'] },
      { facade: 'brick2', tints: ['#ffffff', '#e9e3dc'] },
      { facade: 'concrete', tints: ['#ffffff', '#e6e4df'] },
    ],
    facadeTile: { brick: 19.8, brick2: 19.8, concrete: 19.8, tower: 80 },
    marking: { dash: 3, gap: 4, crosswalk: 4.2 }, // centre-line dashes and crosswalk depth (m)
    skyline: { count: 64, radius: [230, 430], size: [14, 30], floors: [18, 58] },
    // Modelled fronts (Poly Haven kits, models/kit_<name>.glb from tools/kit.py) on the sides of the nearer
    // buildings that face the middle: 3 m bays, 3 m floors. Ground-floor bays: d door, s shop window,
    // p plain wall; the floors above repeat one window style per side. The building's box is set back
    // `inset` behind those sides so the windows and doors have depth. reach: only sides closer than this
    // (renderers may use less, at lower quality).
    kit: { names: ['apartments', 'factory'], bay: 3, floor: 3, inset: 0.6, reach: 75, upper: ['large', 'double', 'small', 'offset'] },
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
        facade: f.facade, tint: pick(f.tints), near: Math.hypot(x, z) < U.near, shade: Math.hypot(x, z) < U.shadows, tank: floors <= 10 && r() < 0.35, seed: Math.floor(r() * 1e6) });
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
      cars.push({ model: i === 5 ? 'covered_car' : pick(CARS), p: [round2(x), 0, round2(z)], ry: round2((side < 2 ? PI / 2 : 0) + (r() < 0.5 ? PI : 0)) });
    }
    const stuff = ['hydrant', 'trash_can', 'trash_can', 'utility_box', 'plastic_crate', 'barrel'];
    for (let i = 0; i < 18; i++) {
      const side = i % 4, along = -0.9 + r() * 1.8, out = r() < 0.5 ? edge : inner;
      const [x, z] = side < 2 ? [along * Cx, (side ? 1 : -1) * out[1]] : [(side === 2 ? 1 : -1) * out[0], along * Cz];
      props.push({ model: pick(stuff), p: [round2(x), 0.15, round2(z)], ry: round2(r() * PI * 2) });
    }
    // modelled fronts on the sides that face the middle (not the ones mostly hidden by a neighbour)
    const K = U.kit, overlap = (a, aw, o, ow) => Math.min(a + aw / 2, o + ow / 2) - Math.max(a - aw / 2, o - ow / 2);
    const touching = (b, side) => buildings.some(o => o !== b && (side < 2
      ? Math.abs((o.x - o.w / 2 * (side ? -1 : 1)) - (b.x + b.w / 2 * (side ? -1 : 1))) < 0.05 && overlap(b.z, b.d, o.z, o.d) > b.d * 0.8
      : Math.abs((o.z - o.d / 2 * (side === 3 ? -1 : 1)) - (b.z + b.d / 2 * (side === 3 ? -1 : 1))) < 0.05 && overlap(b.x, b.w, o.x, o.w) > b.w * 0.8));
    for (const b of buildings) {
      if (!b.near) continue;
      const faces = [];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([nx, nz], side) => {
        const fx = b.x + nx * b.w / 2, fz = b.z + nz * b.d / 2, dist = Math.hypot(fx, fz);
        if (-(fx * nx + fz * nz) <= 0 || dist > K.reach || touching(b, side)) return;
        const n = Math.max(1, Math.round((side < 2 ? b.d : b.w) / K.bay));
        let g = '';
        for (let k = 0; k < n; k++) { const t = (b.seed >> (k % 16)) & 7; g += t === 0 ? 'd' : t < 6 ? 's' : 'p'; }
        if (!g.includes('d')) g = 'd' + g.slice(1); // every front has a way in
        faces.push({ s: side, n, g, u: K.upper[(b.seed + side) % K.upper.length], d: round2(dist) });
      });
      if (!faces.length) continue;
      b.kit = K.names[b.seed % 10 < 3 ? 1 : 0];
      b.faces = faces;
      b.h = b.floors * K.floor;
    }
    // the skyline: towers far away in the haze
    const S = U.skyline, skyline = [];
    for (let i = 0; i < S.count; i++) {
      const a = r() * PI * 2, d = S.radius[0] + r() * (S.radius[1] - S.radius[0]), w = S.size[0] + r() * (S.size[1] - S.size[0]);
      const floors = S.floors[0] + Math.floor(r() * (S.floors[1] - S.floors[0]));
      skyline.push({ x: round2(Math.cos(a) * d), z: round2(Math.sin(a) * d), w: round2(w), d: round2(w * (0.7 + r() * 0.5)), floors, h: round2(floors * U.storey), tint: pick(pick(U.facades).tints) });
    }
    // road paint: yellow centre-line dashes along every street (not through the junctions) and zebra
    // crossings around the four junctions next to the middle; then oil stains and manhole covers
    const M = U.marking, road = U.street / 2 - U.sidewalk, near = 110;
    const gaps = c => { const iv = spans(c).sort((a, b) => a[0] - b[0]), out = []; for (let i = 0; i + 1 < iv.length; i++) out.push((iv[i][1] + iv[i + 1][0]) / 2); return out; };
    const gx = gaps(Cx), gz = gaps(Cz), dashes = [], stripes = [], stains = [], manholes = [];
    const inJunction = (v, list) => list.some(g => Math.abs(v - g) < U.street / 2 + 0.5);
    for (const [list, cross, vertical] of [[gx, gz, true], [gz, gx, false]]) for (const g of list) {
      if (Math.abs(g) > near) continue;
      for (let t = -near; t < near; t += M.dash + M.gap) {
        if (inJunction(t, cross) || inJunction(t + M.dash, cross)) continue;
        dashes.push(vertical ? [g - 0.08, t, g + 0.08, t + M.dash] : [t, g - 0.08, t + M.dash, g + 0.08]);
      }
    }
    for (const x of gx.filter(g => Math.abs(Math.abs(g) - Cx - U.street / 2) < 0.01)) for (const z of gz.filter(g => Math.abs(Math.abs(g) - Cz - U.street / 2) < 0.01)) {
      const off = U.street / 2 + M.crosswalk / 2 + 0.3;
      for (const k of [-1, 1]) {
        for (let a = -road + 0.5; a < road - 0.3; a += 1.0) { // across the street running along z, and the one along x
          stripes.push([x + a, z + k * off - M.crosswalk / 2, x + a + 0.5, z + k * off + M.crosswalk / 2]);
          stripes.push([x + k * off - M.crosswalk / 2, z + a, x + k * off + M.crosswalk / 2, z + a + 0.5]);
        }
      }
    }
    for (let i = 0; i < 48; i++) {
      const vertical = r() < 0.5, list = (vertical ? gx : gz).filter(g => Math.abs(g) < 90), g = list[Math.floor(r() * list.length)];
      const across = g + (r() * 2 - 1) * (road - 0.5), along = (r() * 2 - 1) * 90;
      const [x, z] = vertical ? [across, along] : [along, across];
      if (i % 4) stains.push([round2(x), round2(z), round2(0.8 + r() * 2.2), round2(r() * PI)]);
      else manholes.push([round2(x), round2(z)]);
    }
    const r4 = a => a.map(round2);
    // traffic: a few cars driving laps of the street around the middle, in its inner lane
    const traffic = { half: [round2(Cx + U.street / 2 - 1.6), round2(Cz + U.street / 2 - 1.6)], turn: 5, cars: [] };
    for (let i = 0; i < 5; i++) traffic.cars.push({ model: CARS[(i * 2 + 1) % CARS.length], phase: round2(i / 5 + r() * 0.08), speed: round2(8 + r() * 4) });
    return { buildings, sidewalks: sidewalks.map(r4), lamps, cars, props, skyline, dashes: dashes.map(r4), stripes: stripes.map(r4), stains, manholes, traffic };
  }
  // Where traffic car `c` is at time `t` (s): [x, z, rotationY] on a rectangle with rounded corners
  // (half-extents `half`, corner radius `turn`), driven clockwise seen from above. Cars face +Z.
  function trafficAt(traffic, c, t) {
    const [hx, hz] = traffic.half, R = traffic.turn, ax = hx - R, az = hz - R, arc = PI * R / 2;
    const legs = [2 * ax, arc, 2 * az, arc, 2 * ax, arc, 2 * az, arc], P = legs.reduce((a, b) => a + b, 0);
    let d = ((c.phase * P + c.speed * t) % P + P) % P, k = 0;
    while (d > legs[k]) { d -= legs[k]; k++; }
    // straights: along +X at z = -hz, along +Z at x = hx, along -X at z = hz, along -Z at x = -hx
    const corners = [[ax, -az], [ax, az], [-ax, az], [-ax, -az]], starts = [[-ax, -hz], [hx, -az], [ax, hz], [-hx, az]];
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const i = k >> 1;
    if (k % 2 === 0) { const [x, z] = starts[i], [dx, dz] = dirs[i]; return [x + dx * d, z + dz * d, Math.atan2(dx, dz)]; }
    const a = -PI / 2 + i * PI / 2 + d / R, [cx, cz] = corners[i]; // around the corner's centre
    return [cx + Math.cos(a) * R, cz + Math.sin(a) * R, Math.atan2(-Math.sin(a), Math.cos(a))];
  }

  // ---------- Settings ----------
  // Every option in the ⚙️ Settings tab, so the web and desktop versions offer the same ones. Each device keeps
  // its own (they aren't synced: a laptop and a gaming PC want different graphics). type: 'choice' (options
  // [value, label]), 'range' (min, max, step, unit) or 'toggle'. `only` marks an option one version can't do.
  // The quality presets set the options listed in PRESETS; changing one of those by hand makes it 'custom'.
  // 'auto' starts at high and steps down a preset at a time while the game runs slowly.
  const SETTINGS = {
    groups: [
      { id: 'graphics', name: 'Graphics', items: [
        { id: 'preset', name: 'Quality', type: 'choice', def: 'auto', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']],
          desc: 'Sets the options below at once. Auto turns quality down by itself if the game runs slowly.' },
        { id: 'scale', name: 'Render resolution', type: 'range', def: 100, min: 50, max: 100, step: 5, unit: '%', desc: 'Lower draws fewer pixels and scales the picture up: much faster, a little softer.' },
        { id: 'shadows', name: 'Shadows', type: 'choice', def: 'high', options: [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']] },
        { id: 'ao', name: 'Ambient occlusion', type: 'toggle', def: true, desc: 'Soft shade in corners and under things.' },
        { id: 'bloom', name: 'Bloom', type: 'toggle', def: true, desc: 'Lamps, lit windows and the bright sky glow softly.' },
        { id: 'aa', name: 'Anti-aliasing', type: 'toggle', def: true, desc: 'Smooths jagged edges.' },
        { id: 'reflections', name: 'Reflections and bounce light', type: 'toggle', def: true, only: 'desktop', desc: 'Shiny floors reflect the room; light bounces off walls.' },
        { id: 'haze', name: 'Volumetric haze', type: 'toggle', def: true, only: 'desktop', desc: 'Sunlight catches in the air between the buildings.' },
        { id: 'distance', name: 'View distance', type: 'choice', def: 'normal', options: [['near', 'Near'], ['normal', 'Normal'], ['far', 'Far']], desc: 'How far you see before the city fades into the smog.' },
        { id: 'grade', name: 'Film colour grade', type: 'toggle', def: true, desc: 'The washed-out, warm, gritty look. Off shows plain colours.' },
        { id: 'grain', name: 'Film grain and vignette', type: 'toggle', def: true, only: 'web' },
        { id: 'brightness', name: 'Brightness', type: 'range', def: 100, min: 60, max: 150, step: 5, unit: '%' },
        { id: 'fps', name: 'Frame rate limit', type: 'choice', def: 0, options: [[30, '30 fps'], [60, '60 fps'], [120, '120 fps'], [0, 'No limit']] },
        { id: 'vsync', name: 'V-Sync', type: 'toggle', def: true, only: 'desktop', desc: 'Waits for the screen, so the picture never tears.' },
      ] },
      { id: 'world', name: 'World', items: [
        { id: 'crowd', name: 'Passers-by', type: 'choice', def: 'all', options: [['all', 'Everyone'], ['fewer', 'Fewer']], desc: 'Fewer keeps the workers and the people with jobs, but sends half the walkers home.' },
        { id: 'traffic', name: 'Traffic', type: 'toggle', def: true, desc: 'Cars driving round the blocks.' },
      ] },
      { id: 'controls', name: 'Controls', items: [
        { id: 'sens', name: 'Mouse sensitivity', type: 'range', def: 100, min: 25, max: 300, step: 5, unit: '%' },
        { id: 'invert', name: 'Invert mouse up/down', type: 'toggle', def: false },
        { id: 'fov', name: 'Field of view', type: 'range', def: 70, min: 55, max: 100, step: 1, unit: '°', desc: 'How wide you see. Fights are 6° narrower, as you aim down the gun.' },
      ] },
      { id: 'hud', name: 'Screen', items: [
        { id: 'minimap', name: 'Minimap in fights', type: 'toggle', def: true },
        { id: 'crosshair', name: 'Crosshair colour', type: 'choice', def: 'white', options: [['white', 'White'], ['green', 'Green'], ['yellow', 'Yellow'], ['cyan', 'Cyan'], ['pink', 'Pink']] },
        { id: 'hints', name: 'Key hints', type: 'toggle', def: true, desc: 'The line of controls along the bottom.' },
        { id: 'showFps', name: 'Show frame rate', type: 'toggle', def: false },
      ] },
    ],
    PRESETS: {
      low: { scale: 75, shadows: 'off', ao: false, bloom: false, aa: false, reflections: false, haze: false, distance: 'near' },
      medium: { scale: 100, shadows: 'low', ao: false, bloom: true, aa: true, reflections: false, haze: false, distance: 'normal' },
      high: { scale: 100, shadows: 'high', ao: true, bloom: true, aa: true, reflections: true, haze: true, distance: 'normal' },
      ultra: { scale: 100, shadows: 'ultra', ao: true, bloom: true, aa: true, reflections: true, haze: true, distance: 'far' },
    },
    AUTO: ['high', 'medium', 'low'], // the steps 'auto' goes down
    CROSSHAIR: { white: '#F2EFE8', green: '#4ade80', yellow: '#facc15', cyan: '#22d3ee', pink: '#f472b6' },
    SHADOW_MAP: { off: 0, low: 1024, high: 2048, ultra: 4096 },
    FOG: { near: 1.7, normal: 1, far: 0.55 }, // multiplies how thick the smog is
  };

  return { BUILDINGS, LOT, SHOPS, SOLDIER, GUNS, ARENA, CITY, ASSETS, URBAN, SETTINGS, tex, cityLayout, trafficAt, lotBuilding, interior, pathAt };
});
