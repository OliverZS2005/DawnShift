// Entry point for vendor/three.bundle.js: Three.js plus the add-ons Hustlefront uses, exposed as
// the global THREE so the page works as plain <script> tags. Rebuild with `npm run build:three`.
import * as THREE_CORE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

window.THREE = Object.assign({}, THREE_CORE, { GLTFLoader, RGBELoader, EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, SMAAPass, ShaderPass, SkeletonUtils });
