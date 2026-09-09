// Builds an indexed triangle mesh from a Minecraft skin texture.
//
// The mesh is framework-agnostic (plain typed arrays) so the exact same
// data feeds both the live three.js preview and the STL/OBJ exporters.
// Everything -- base-layer box faces and voxelized overlay nubs alike --
// is UV-mapped back into the *original* skin PNG, so a single texture
// image is all that's ever needed; no baked atlas.

import { boxFaceRects, faceSpan, faceLocal, AXIS_INFO, flipXFace, getParts } from './skinLayout.js';

// Internal UV convention: v=0 is the TOP row of the source image (matches
// canvas/ImageData row order). Exporters that expect the OpenGL/OBJ
// convention (v=0 at bottom) must flip at write time.

const NORMALS = {
  '+x': { x: 1, y: 0, z: 0 }, '-x': { x: -1, y: 0, z: 0 },
  '+y': { x: 0, y: 1, z: 0 }, '-y': { x: 0, y: -1, z: 0 },
  '+z': { x: 0, y: 0, z: 1 }, '-z': { x: 0, y: 0, z: -1 },
};

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// Mirroring a part negates world X only, so a face's "column" axis needs
// flipping when reading mirrored texture content only if that axis
// represents X (front/back/top/bottom). On the +x/-x side faces, column
// represents Z (depth), which an X-mirror leaves untouched -- those faces
// are handled instead by swapping which of the two rects (+x vs -x) is
// read, via flipXFace.
function mirrorFlipsColumn(face) {
  return face !== '+x' && face !== '-x';
}

// For each face, determine the (col,row) corner traversal order that
// produces a counter-clockwise winding as seen from outside the box (i.e.
// matching the declared outward normal), by testing against faceLocal
// directly rather than hand-deriving it -- self-correcting regardless of
// which axes a given face's parametrization happens to flip.
const FACE_CORNER_ORDER = {};
for (const face of Object.keys(NORMALS)) {
  const w = 3, h = 5, d = 7; // asymmetric test dims so no axis accidentally cancels
  const { cols, rows } = faceSpan(face, w, h, d);
  const p00 = faceLocal(face, 0, 0, w, h, d);
  const p10 = faceLocal(face, cols, 0, w, h, d);
  const p01 = faceLocal(face, 0, rows, w, h, d);
  const testNormal = cross(sub(p10, p00), sub(p01, p00));
  const forward = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const reversed = [[0, 0], [0, 1], [1, 1], [1, 0]];
  FACE_CORNER_ORDER[face] = dot(testNormal, NORMALS[face]) > 0 ? forward : reversed;
}

export function buildMeshData(sampler, texW, texH, options) {
  const opts = Object.assign({
    slim: false,
    legacy: texH <= 32,
    includeOverlay: true,
    overlayThickness: 1.0,
    overlayGap: -0.05, // slight negative = embed into surface, guarantees a fused union
    alphaThreshold: 16,
  }, options);

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  function addQuad(p0, p1, p2, p3, uv0, uv1, uv2, uv3, normal) {
    const base = positions.length / 3;
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    for (let i = 0; i < 4; i++) normals.push(normal.x, normal.y, normal.z);
    uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v, uv3.u, uv3.v);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function addBoxFace(face, part, rect) {
    const { cols, rows } = faceSpan(face, part.w, part.h, part.d);
    const corners = FACE_CORNER_ORDER[face];
    const pts = corners.map(([cf, rf]) => {
      const p = faceLocal(face, cf * cols, rf * rows, part.w, part.h, part.d);
      return { x: p.x + part.center.x, y: p.y + part.center.y, z: p.z + part.center.z };
    });
    const flip = part.mirror && mirrorFlipsColumn(face);
    const uvsForCorners = corners.map(([cf, rf]) => {
      const u = flip ? (1 - cf) : cf;
      return { u: (rect.u + u * rect.w) / texW, v: (rect.v + rf * rect.h) / texH };
    });
    addQuad(pts[0], pts[1], pts[2], pts[3], uvsForCorners[0], uvsForCorners[1], uvsForCorners[2], uvsForCorners[3], NORMALS[face]);
  }

  function addVoxelCube(center, face, thickness, gap, uvRect) {
    const { axis, sign } = AXIS_INFO[face];
    const half = { x: 0.5, y: 0.5, z: 0.5 };
    half[axis] = thickness / 2;
    const c = { x: center.x, y: center.y, z: center.z };
    c[axis] = center[axis] + sign * (gap + thickness / 2);

    const min = { x: c.x - half.x, y: c.y - half.y, z: c.z - half.z };
    const max = { x: c.x + half.x, y: c.y + half.y, z: c.z + half.z };
    // Single-texel UV for every face of this tiny cube: it's a flat color anyway.
    const uv = { u: (uvRect.u + 0.5) / texW, v: (uvRect.v + 0.5) / texH };

    function face3(nx, ny, nz, corners) {
      addQuad(corners[0], corners[1], corners[2], corners[3], uv, uv, uv, uv, { x: nx, y: ny, z: nz });
    }
    // Each quad below is listed CCW as seen from outside along its normal.
    face3(1, 0, 0, [
      { x: max.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: min.z },
      { x: max.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: max.z },
    ]);
    face3(-1, 0, 0, [
      { x: min.x, y: min.y, z: min.z }, { x: min.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: min.z },
    ]);
    face3(0, 1, 0, [
      { x: min.x, y: max.y, z: min.z }, { x: min.x, y: max.y, z: max.z },
      { x: max.x, y: max.y, z: max.z }, { x: max.x, y: max.y, z: min.z },
    ]);
    face3(0, -1, 0, [
      { x: min.x, y: min.y, z: max.z }, { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: max.z },
    ]);
    face3(0, 0, 1, [
      { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: max.z },
      { x: max.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: max.z },
    ]);
    face3(0, 0, -1, [
      { x: max.x, y: min.y, z: min.z }, { x: min.x, y: min.y, z: min.z },
      { x: min.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: min.z },
    ]);
  }

  const parts = getParts(opts);

  for (const part of parts) {
    const baseRects = boxFaceRects(part.baseUV.u, part.baseUV.v, part.w, part.h, part.d);
    for (const face of Object.keys(baseRects)) {
      const sampleFace = part.mirror ? flipXFace(face) : face;
      addBoxFace(face, part, baseRects[sampleFace]);
    }

    if (opts.includeOverlay && part.overlayUV) {
      const overlayRects = boxFaceRects(part.overlayUV.u, part.overlayUV.v, part.w, part.h, part.d);
      for (const face of Object.keys(overlayRects)) {
        const { cols, rows } = faceSpan(face, part.w, part.h, part.d);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const sampleFace = part.mirror ? flipXFace(face) : face;
            const sampleCol = (part.mirror && mirrorFlipsColumn(face)) ? (cols - 1 - col) : col;
            const rect = overlayRects[sampleFace];
            const px = rect.u + sampleCol;
            const py = rect.v + row;
            const [, , , a] = sampler(px, py);
            if (a < opts.alphaThreshold) continue;
            const centerLocal = faceLocal(face, col + 0.5, row + 0.5, part.w, part.h, part.d);
            const center = {
              x: centerLocal.x + part.center.x,
              y: centerLocal.y + part.center.y,
              z: centerLocal.z + part.center.z,
            };
            addVoxelCube(center, face, opts.overlayThickness, opts.overlayGap, { u: px, v: py });
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    triangleCount: indices.length / 3,
  };
}

// Convenience sampler factory from a CanvasRenderingContext2D ImageData.
export function samplerFromImageData(imageData) {
  const { data, width, height } = imageData;
  return function sample(px, py) {
    px = Math.max(0, Math.min(width - 1, Math.floor(px)));
    py = Math.max(0, Math.min(height - 1, Math.floor(py)));
    const i = (py * width + px) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
}
