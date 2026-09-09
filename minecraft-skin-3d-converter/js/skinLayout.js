// Minecraft skin texture layout + "box UV" unwrap math.
//
// A Minecraft player model is six boxes (head, body, 2 arms, 2 legs), each
// with a "base" layer and a semi-transparent "overlay" layer (hat, jacket,
// sleeves, pants). Every box uses Mojang's standard box-UV unwrap: given a
// texture origin (u,v) and box dimensions (w,h,d), the six faces occupy a
// fixed cross-shaped region of the texture.
//
// World axes used throughout this project: +X = character's own left,
// -X = character's own right, +Y = up, +Z = character's front (the side
// facing the default camera).

export const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];

// Per-face texture rectangle within a box's UV block, in texture pixels.
export function boxFaceRects(u, v, w, h, d) {
  return {
    '+y': { u: u + d, v: v, w: w, h: d }, // top
    '-y': { u: u + d + w, v: v, w: w, h: d }, // bottom
    '-x': { u: u, v: v + d, w: d, h: h }, // character's right
    '+z': { u: u + d, v: v + d, w: w, h: h }, // front
    '+x': { u: u + d + w, v: v + d, w: d, h: h }, // character's left
    '-z': { u: u + d + w + d, v: v + d, w: w, h: h }, // back
  };
}

// Number of texels spanning a face, in (col, row) order.
export function faceSpan(face, w, h, d) {
  switch (face) {
    case '+z':
    case '-z':
      return { cols: w, rows: h };
    case '+x':
    case '-x':
      return { cols: d, rows: h };
    case '+y':
    case '-y':
      return { cols: w, rows: d };
  }
  throw new Error('unknown face ' + face);
}

// Local-space (box centered on origin) position for a point at texel
// coordinate (col, row) on the given face. col/row may be fractional
// (pass col+0.5 for a texel's center).
export function faceLocal(face, col, row, w, h, d) {
  switch (face) {
    case '+z':
      return { x: -w / 2 + col, y: h / 2 - row, z: d / 2 };
    case '-z':
      return { x: w / 2 - col, y: h / 2 - row, z: -d / 2 };
    case '-x':
      return { x: -w / 2, y: h / 2 - row, z: -d / 2 + col };
    case '+x':
      return { x: w / 2, y: h / 2 - row, z: d / 2 - col };
    case '+y':
      return { x: -w / 2 + col, y: h / 2, z: -d / 2 + row };
    case '-y':
      return { x: -w / 2 + col, y: -h / 2, z: d / 2 - row };
  }
  throw new Error('unknown face ' + face);
}

// Which world axis a face's outward normal points along, and its sign.
export const AXIS_INFO = {
  '+x': { axis: 'x', sign: 1 },
  '-x': { axis: 'x', sign: -1 },
  '+y': { axis: 'y', sign: 1 },
  '-y': { axis: 'y', sign: -1 },
  '+z': { axis: 'z', sign: 1 },
  '-z': { axis: 'z', sign: -1 },
};

export function flipXFace(face) {
  if (face === '+x') return '-x';
  if (face === '-x') return '+x';
  return face;
}

// Body part definitions: dimensions, placement, and base-layer/overlay-layer
// UV origins. `mirror: true` means the part's texture region is shared with
// its counterpart and must be read left-right flipped (legacy 64x32 skins,
// which have no separate left arm/leg regions).
// Small overlap nudge (model units) applied to limb/head placement so
// adjoining boxes interpenetrate slightly instead of merely touching,
// guaranteeing a fused, watertight-enough union for slicing/printing.
export const SEAM_OVERLAP = 0.15;

export function getParts(options) {
  const slim = !!options.slim;
  const legacy = !!options.legacy;
  const armW = slim ? 3 : 4;
  const s = SEAM_OVERLAP / 2;

  // Legacy 64x32 textures are only 32px tall: body/arm/leg overlay blocks
  // (which live at v=32..48) fall outside the image and don't exist for
  // that format. Only the head's hat layer (v=0..16) predates the 64x64
  // update and is present in both formats.
  const limbOverlay = legacy ? null : true;

  const parts = [
    {
      name: 'head', w: 8, h: 8, d: 8,
      center: { x: 0, y: 28 - s, z: 0 },
      baseUV: { u: 0, v: 0 }, overlayUV: { u: 32, v: 0 },
    },
    {
      name: 'body', w: 8, h: 12, d: 4,
      center: { x: 0, y: 18, z: 0 },
      baseUV: { u: 16, v: 16 }, overlayUV: limbOverlay && { u: 16, v: 32 },
    },
    {
      name: 'rightArm', w: armW, h: 12, d: 4,
      center: { x: -4 - armW / 2 + s, y: 18, z: 0 },
      baseUV: { u: 40, v: 16 }, overlayUV: limbOverlay && { u: 40, v: 32 },
    },
    {
      name: 'rightLeg', w: 4, h: 12, d: 4,
      center: { x: -2, y: 6 + s, z: 0 },
      baseUV: { u: 0, v: 16 }, overlayUV: limbOverlay && { u: 0, v: 32 },
    },
  ];

  if (legacy) {
    parts.push({
      name: 'leftArm', w: armW, h: 12, d: 4,
      center: { x: 4 + armW / 2 - s, y: 18, z: 0 },
      baseUV: { u: 40, v: 16 }, overlayUV: null,
      mirror: true,
    });
    parts.push({
      name: 'leftLeg', w: 4, h: 12, d: 4,
      center: { x: 2, y: 6 + s, z: 0 },
      baseUV: { u: 0, v: 16 }, overlayUV: null,
      mirror: true,
    });
  } else {
    parts.push({
      name: 'leftArm', w: armW, h: 12, d: 4,
      center: { x: 4 + armW / 2 - s, y: 18, z: 0 },
      baseUV: { u: 32, v: 48 }, overlayUV: { u: 48, v: 48 },
    });
    parts.push({
      name: 'leftLeg', w: 4, h: 12, d: 4,
      center: { x: 2, y: 6 + s, z: 0 },
      baseUV: { u: 16, v: 48 }, overlayUV: { u: 0, v: 48 },
    });
  }

  return parts;
}

export const MODEL_HEIGHT_UNITS = 32; // total figure height in model units (feet to top of head)
