// STL and OBJ/MTL exporters operating directly on the plain meshData
// produced by meshBuilder.js (positions/normals/uvs/indices, all
// triangles, single shared texture). No three.js dependency here so
// exports stay decoupled from the preview renderer.

// Binary STL: 80-byte header, uint32 triangle count, then per-triangle
// (3 floats normal, 3x3 floats vertices, uint16 attribute byte).
export function buildSTL(meshData, scale) {
  const { positions, indices } = meshData;
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  let offset = 80;
  view.setUint32(offset, triCount, true);
  offset += 4;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0] * scale, ay = positions[i0 + 1] * scale, az = positions[i0 + 2] * scale;
    const bx = positions[i1] * scale, by = positions[i1 + 1] * scale, bz = positions[i1 + 2] * scale;
    const cx = positions[i2] * scale, cy = positions[i2 + 1] * scale, cz = positions[i2 + 2] * scale;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return new Blob([buffer], { type: 'model/stl' });
}

// OBJ + MTL text referencing an external "skin.png" texture. OBJ/most
// importers use the OpenGL texcoord convention (v=0 at image bottom); our
// internal uv.v is image-row-down (v=0 at top), so flip at write time.
export function buildOBJ(meshData, scale, mtlFilename, textureFilename) {
  const { positions, normals, uvs, indices } = meshData;
  const vertCount = positions.length / 3;
  const lines = [];
  lines.push('# Minecraft skin 3D model');
  lines.push(`mtllib ${mtlFilename}`);
  lines.push(`usemtl skin`);

  for (let i = 0; i < vertCount; i++) {
    lines.push(`v ${(positions[i * 3] * scale).toFixed(5)} ${(positions[i * 3 + 1] * scale).toFixed(5)} ${(positions[i * 3 + 2] * scale).toFixed(5)}`);
  }
  for (let i = 0; i < vertCount; i++) {
    lines.push(`vt ${uvs[i * 2].toFixed(6)} ${(1 - uvs[i * 2 + 1]).toFixed(6)}`);
  }
  for (let i = 0; i < vertCount; i++) {
    lines.push(`vn ${normals[i * 3].toFixed(4)} ${normals[i * 3 + 1].toFixed(4)} ${normals[i * 3 + 2].toFixed(4)}`);
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] + 1, b = indices[t + 1] + 1, c = indices[t + 2] + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }

  const obj = lines.join('\n') + '\n';
  const mtl = [
    'newmtl skin',
    'Ka 1.000 1.000 1.000',
    'Kd 1.000 1.000 1.000',
    'Ks 0.000 0.000 0.000',
    'd 1.0',
    'illum 1',
    `map_Kd ${textureFilename}`,
    '',
  ].join('\n');

  return { obj, mtl };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function buildZip(JSZip, { objText, mtlText, pngBlob, readmeText }) {
  const zip = new JSZip();
  zip.file('model.obj', objText);
  zip.file('model.mtl', mtlText);
  zip.file('skin.png', pngBlob);
  if (readmeText) zip.file('README.txt', readmeText);
  return zip.generateAsync({ type: 'blob' });
}
