// Procedurally generated placeholder skin used for the "Load sample skin"
// button and for automated visual testing. Deliberately NOT a copy of any
// official Mojang skin texture -- just flat, high-contrast colors per
// region so part placement/orientation is easy to eyeball.

import { getParts, boxFaceRects } from './skinLayout.js';

function paintBase(ctx, part, palette) {
  const rects = boxFaceRects(part.baseUV.u, part.baseUV.v, part.w, part.h, part.d);
  for (const face of Object.keys(rects)) {
    const r = rects[face];
    ctx.fillStyle = palette[face] || palette.default;
    ctx.fillRect(r.u, r.v, r.w, r.h);
  }
}

function paintOverlayBand(ctx, part, color, rowFrac0, rowFrac1, faces) {
  const rects = boxFaceRects(part.overlayUV.u, part.overlayUV.v, part.w, part.h, part.d);
  ctx.fillStyle = color;
  for (const face of faces) {
    const r = rects[face];
    const y0 = r.v + Math.round(r.h * rowFrac0);
    const y1 = r.v + Math.round(r.h * rowFrac1);
    ctx.fillRect(r.u, y0, r.w, Math.max(1, y1 - y0));
  }
}

export async function makeSampleSkinBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);

  const parts = getParts({ slim: false, legacy: false });
  const byName = Object.fromEntries(parts.map((p) => [p.name, p]));

  // Head: skin tone, with simple face markings on the front only, and a
  // distinct color on the character's LEFT (+x) side to make orientation
  // checkable at a glance.
  paintBase(ctx, byName.head, {
    default: '#d9a066', '+y': '#c98f57', '-y': '#8a6239',
    '+z': '#d9a066', '-z': '#b98950', '-x': '#d9a066', '+x': '#4f7fd9',
  });
  {
    const front = boxFaceRects(byName.head.baseUV.u, byName.head.baseUV.v, 8, 8, 8)['+z'];
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(front.u + 1, front.v + 3, 2, 2);
    ctx.fillRect(front.u + 5, front.v + 3, 2, 2);
    ctx.fillStyle = '#7a4b2f';
    ctx.fillRect(front.u + 2, front.v + 6, 4, 1);
  }

  // Body: green shirt.
  paintBase(ctx, byName.body, {
    default: '#3f8f4f', '+y': '#3a7f47', '-y': '#2c5f36', '-z': '#357a41', '+x': '#3f8f4f', '-x': '#3f8f4f',
  });

  // Right arm (character's right, world -x): red. Left arm: blue.
  paintBase(ctx, byName.rightArm, { default: '#c0392b', '+y': '#a83226', '-y': '#7a241c' });
  paintBase(ctx, byName.leftArm, { default: '#2e6fc0', '+y': '#2a63aa', '-y': '#1e4a7d' });

  // Right leg: purple. Left leg: orange.
  paintBase(ctx, byName.rightLeg, { default: '#8e44ad', '+y': '#7d3c9a', '-y': '#5b2c72' });
  paintBase(ctx, byName.leftLeg, { default: '#e08a1e', '+y': '#c97a19', '-y': '#8f5610' });

  // Overlay: a cap (top + brim band around the sides/front/back of the head).
  {
    const rects = boxFaceRects(byName.head.overlayUV.u, byName.head.overlayUV.v, 8, 8, 8);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(rects['+y'].u, rects['+y'].v, rects['+y'].w, rects['+y'].h);
    paintOverlayBand(ctx, byName.head, '#1c1c1c', 0, 0.35, ['+z', '-z', '+x', '-x']);
  }

  // Overlay: a sleeve on the right arm only (tests asymmetric overlay + voxelization).
  paintOverlayBand(ctx, byName.rightArm, '#f1c40f', 0, 0.5, ['+z', '-z', '+x', '-x', '+y']);

  // Overlay: a chest stripe (jacket) on the body front only.
  paintOverlayBand(ctx, byName.body, '#ecf0f1', 0.15, 0.35, ['+z']);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
