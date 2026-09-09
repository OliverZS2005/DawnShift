import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildMeshData, samplerFromImageData } from './meshBuilder.js';
import { buildSTL, buildOBJ, buildZip, downloadBlob } from './exporters.js';
import { MODEL_HEIGHT_UNITS } from './skinLayout.js';
import { makeSampleSkinBlob } from './sampleSkin.js';

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  sampleBtn: document.getElementById('sampleBtn'),
  controls: document.getElementById('controls'),
  exportSection: document.getElementById('exportSection'),
  modelType: document.getElementById('modelType'),
  overlayToggle: document.getElementById('overlayToggle'),
  overlayThickness: document.getElementById('overlayThickness'),
  overlayThicknessOut: document.getElementById('overlayThicknessOut'),
  printHeight: document.getElementById('printHeight'),
  stats: document.getElementById('stats'),
  downloadStl: document.getElementById('downloadStl'),
  downloadObj: document.getElementById('downloadObj'),
  canvasHost: document.getElementById('canvasHost'),
  viewportEmpty: document.getElementById('viewportEmpty'),
  viewportHint: document.getElementById('viewportHint'),
};

// ---------- three.js scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16181d);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
els.canvasHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 16, 0);
controls.enableDamping = true;
controls.minDistance = 15;
controls.maxDistance = 200;
camera.position.set(38, 26, 46);
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3020, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(30, 50, 40);
scene.add(key);
const fill = new THREE.DirectionalLight(0xfff2dd, 0.5);
fill.position.set(-30, 10, -20);
scene.add(fill);

const grid = new THREE.GridHelper(64, 16, 0x2c3038, 0x22252c);
scene.add(grid);

function resize() {
  const w = els.canvasHost.clientWidth || 1;
  const h = els.canvasHost.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(els.canvasHost);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------- app state ----------
const state = {
  texW: 0,
  texH: 0,
  imageData: null,
  pngBlob: null,
  meshData: null,
  mesh: null,
  texture: null,
};

function currentOptions() {
  const active = els.modelType.querySelector('.seg.active');
  return {
    slim: active ? active.dataset.value === 'slim' : false,
    legacy: state.texH <= 32,
    includeOverlay: els.overlayToggle.checked,
    overlayThickness: parseFloat(els.overlayThickness.value),
  };
}

function rebuildGeometry() {
  if (!state.imageData) return;
  const sampler = samplerFromImageData(state.imageData);
  const meshData = buildMeshData(sampler, state.texW, state.texH, currentOptions());
  state.meshData = meshData;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

  if (state.mesh) {
    scene.remove(state.mesh);
    state.mesh.geometry.dispose();
    state.mesh.material.dispose();
  }

  const material = new THREE.MeshStandardMaterial({
    map: state.texture,
    roughness: 0.85,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  state.mesh = mesh;

  updateStats();
}

function updateStats() {
  if (!state.meshData) return;
  const geo = state.mesh.geometry;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);

  const heightMm = Math.max(1, parseFloat(els.printHeight.value) || 100);
  const scale = heightMm / (size.y || MODEL_HEIGHT_UNITS);

  els.stats.innerHTML = '';
  const rows = [
    ['triangles', state.meshData.triangleCount.toLocaleString()],
    ['width', `${(size.x * scale).toFixed(1)} mm`],
    ['depth', `${(size.z * scale).toFixed(1)} mm`],
    ['height', `${(size.y * scale).toFixed(1)} mm`],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    els.stats.appendChild(dt); els.stats.appendChild(dd);
  }
  state.exportScale = scale;
}

// ---------- loading a skin image ----------
async function loadSkinFile(file) {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = blobUrl;
    });

    if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
      alert(`This doesn't look like a standard Minecraft skin (got ${img.width}×${img.height}). Expected 64×64 or legacy 64×32.`);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    state.texW = img.width;
    state.texH = img.height;
    state.imageData = imageData;
    state.pngBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));

    if (state.texture) state.texture.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    state.texture = texture;

    els.controls.hidden = false;
    els.exportSection.hidden = false;
    els.viewportEmpty.hidden = true;
    els.viewportHint.hidden = false;

    rebuildGeometry();
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// ---------- UI wiring ----------
els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
});
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files[0]) loadSkinFile(els.fileInput.files[0]);
});
['dragover', 'dragenter'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add('dragover'); })
);
['dragleave', 'dragend', 'drop'].forEach((evt) =>
  els.dropzone.addEventListener(evt, () => els.dropzone.classList.remove('dragover'))
);
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadSkinFile(file);
});

els.sampleBtn.addEventListener('click', async () => {
  const blob = await makeSampleSkinBlob();
  const file = new File([blob], 'sample-skin.png', { type: 'image/png' });
  loadSkinFile(file);
});

els.modelType.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  els.modelType.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
  rebuildGeometry();
});

els.overlayToggle.addEventListener('change', rebuildGeometry);
els.overlayThickness.addEventListener('input', () => {
  els.overlayThicknessOut.textContent = parseFloat(els.overlayThickness.value).toFixed(1);
  rebuildGeometry();
});
els.printHeight.addEventListener('input', updateStats);

els.downloadStl.addEventListener('click', () => {
  if (!state.meshData) return;
  const blob = buildSTL(state.meshData, state.exportScale || 1);
  downloadBlob(blob, 'minecraft-skin-figure.stl');
});

els.downloadObj.addEventListener('click', async () => {
  if (!state.meshData) return;
  const prevLabel = els.downloadObj.textContent;
  els.downloadObj.textContent = 'Packaging…';
  els.downloadObj.disabled = true;
  try {
    const { obj, mtl } = buildOBJ(state.meshData, state.exportScale || 1, 'model.mtl', 'skin.png');
    const readme = [
      'Minecraft skin 3D print export',
      '',
      'model.obj  - geometry + UV coordinates',
      'model.mtl  - material referencing skin.png',
      'skin.png   - your original skin texture (unmodified)',
      '',
      'Open model.obj in Blender or any OBJ-capable slicer/print-prep tool;',
      'keep all three files together in the same folder.',
    ].join('\n');
    const zipBlob = await buildZip(window.JSZip, { objText: obj, mtlText: mtl, pngBlob: state.pngBlob, readmeText: readme });
    downloadBlob(zipBlob, 'minecraft-skin-figure-obj.zip');
  } finally {
    els.downloadObj.textContent = prevLabel;
    els.downloadObj.disabled = false;
  }
});
