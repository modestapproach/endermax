// WebGPU renderer (automatic WebGL2 fallback), image-based lighting, soft
// shadows, and a TSL post stack: GTAO contact shadows + bloom on heat glow.

import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, builtinAOContext, screenUV, vec4 } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PALETTE } from './materials.js';

export async function createRenderer({ canvas, width = window.innerWidth, height = window.innerHeight, quality = 'high' } = {}) {
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, forceWebGL });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
    renderer.setSize(width, height, !!canvas ? false : true);
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

    const hemi = new THREE.HemisphereLight('#ffffff', '#b9b2a6', 0.35);
    scene.add(hemi);

    // Key light: high, slightly warm, casting the whole store's shadows.
    const sun = new THREE.DirectionalLight('#fff1e0', 2.8);
    sun.position.set(14, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -36; s.right = 36; s.top = 36; s.bottom = -36; s.near = 1; s.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    scene.add(sun);
    scene.add(sun.target);

    return { sun, hemi };
}

// Post stack. Returns a pipeline whose .render() replaces renderer.render().
export function createPipeline(renderer, scene, camera, { aoEnabled = true, bloomEnabled = true } = {}) {
    const pipeline = new THREE.RenderPipeline(renderer);

    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    let out = color;

    let aoPass = null;
    if (aoEnabled) {
        const prePass = pass(scene, camera, { samples: 0 }); // GTAO needs a single-sample depth texture
        prePass.setMRT(mrt({ output: normalView }));
        prePass.transparent = false;
        aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
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

    pipeline.outputNode = out;
    return { pipeline, scenePass, aoPass, bloomPass };
}
