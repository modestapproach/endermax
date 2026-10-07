// WebGPU renderer (automatic WebGL2 fallback), image-based lighting, soft
// shadows, and a TSL post stack: GTAO contact shadows + bloom on heat glow.

import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, builtinAOContext, screenUV, vec4, vec3, float, smoothstep, length } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PALETTE } from './materials.js';

const q = new URLSearchParams(location.search);

// Graphics presets. Measured at 2880x1800 (M-series, WebGPU): GTAO alone was
// ~10ms of a 13.7ms GPU frame, so only "high" pays for it; everything else
// uses baked contact shading. fps is the render cap (input-idle drops lower).
export const PRESETS = {
    battery:  { dpr: 1,   msaa: false, ao: false, bloom: false, fps: 30 },
    balanced: { dpr: 1.5, msaa: true,  ao: false, bloom: true,  fps: 60 },
    high:     { dpr: 2,   msaa: true,  ao: true,  bloom: true,  fps: 60 }
};
function storedPreset() {
    try { return localStorage.getItem('endermax.quality'); } catch { return null; }
}
export const QUALITY_NAME = PRESETS[q.get('quality')] ? q.get('quality') : (PRESETS[storedPreset()] ? storedPreset() : 'balanced');
const preset = PRESETS[QUALITY_NAME];
// Individual overrides for benchmarking: ?dpr=1.5 ?msaa=0 ?ao=0 ?bloom=0 ?fps=0 (uncapped)
export const QUALITY_FLAGS = {
    dpr: q.has('dpr') ? parseFloat(q.get('dpr')) : preset.dpr,
    msaa: q.has('msaa') ? q.get('msaa') !== '0' : preset.msaa,
    ao: q.has('ao') ? q.get('ao') !== '0' : preset.ao,
    bloom: q.has('bloom') ? q.get('bloom') !== '0' : preset.bloom,
    fps: q.has('fps') ? parseFloat(q.get('fps')) : preset.fps
};
export function setQualityPreset(name) {
    try { localStorage.setItem('endermax.quality', name); } catch { /* private mode */ }
}

export async function createRenderer({ canvas, width = window.innerWidth, height = window.innerHeight, updateStyle = true } = {}) {
    const forceWebGL = q.has('webgl');
    const trackTimestamp = new URLSearchParams(location.search).has('bench'); // GPU timing for perf work
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: QUALITY_FLAGS.msaa, alpha: false, forceWebGL, trackTimestamp });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_FLAGS.dpr));
    // updateStyle sets the canvas CSS size. Without it the canvas displays at
    // its drawing-buffer size (CSS px x pixel ratio), overflowing the window on
    // HiDPI screens and pushing the shopper off-centre.
    renderer.setSize(width, height, updateStyle);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    await renderer.init();
    return renderer;
}

export function backendName(renderer) {
    return renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
}

export function createLighting(scene, renderer) {
    scene.background = new THREE.Color(PALETTE.backdrop);
    scene.fog = new THREE.Fog(PALETTE.backdrop, 40, 95);

    // Soft studio IBL for diffuse fill and believable reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.5;

    const hemi = new THREE.HemisphereLight('#ffffff', '#8a8478', 0.4);
    scene.add(hemi);

    // Key light: high, slightly warm, casting the whole store's shadows.
    const sun = new THREE.DirectionalLight('#fff1e0', 2.8);
    sun.position.set(1.5, 30, 3); // near-overhead: shadows pool under fixtures like store lighting
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -36; s.right = 36; s.top = 36; s.bottom = -36; s.near = 1; s.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 6;
    // The store is static: render the 4K shadow map once (and when items load),
    // not every frame. The shopper uses a contact blob instead of casting.
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    scene.add(sun);
    scene.add(sun.target);

    return { sun, hemi };
}

// Post stack. Returns a pipeline whose .render() replaces renderer.render().
export function createPipeline(renderer, scene, camera, { aoEnabled = QUALITY_FLAGS.ao, bloomEnabled = QUALITY_FLAGS.bloom } = {}) {
    const pipeline = new THREE.RenderPipeline(renderer);

    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    let out = color;

    let aoPass = null;
    if (aoEnabled) {
        // Single-sample pre-pass for GTAO: depth + view normals.
        const prePass = pass(scene, camera, { samples: 0 });
        prePass.setMRT(mrt({ output: normalView }));
        prePass.transparent = false;
        const preDepth = prePass.getTextureNode('depth');
        const preNormal = prePass.getTextureNode();
        aoPass = ao(preDepth, preNormal, camera);
        aoPass.resolutionScale = 0.5;
        aoPass.radius.value = 0.6;
        aoPass.thickness.value = 1.5;
        aoPass.distanceFallOff.value = 1.0;
        scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    }

    let bloomPass = null;
    if (bloomEnabled) {
        bloomPass = bloom(scenePass.getTextureNode('emissive'), 0.9, 0.35, 0.0);
        out = out.add(vec4(bloomPass.rgb, 0));
    }

    // Gentle vignette pulls the eye toward the center of the frame.
    const v = smoothstep(float(0.45), float(1.05), length(screenUV.sub(0.5)).mul(1.5));
    out = out.mul(vec4(vec3(v.mul(-0.16).add(1)), 1));

    pipeline.outputNode = out;
    return { pipeline, scenePass, aoPass, bloomPass };
}
