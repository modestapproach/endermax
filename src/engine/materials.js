// Node materials for the store. Every fixture material shares the same heat
// nodes (smooth gaze glow sampled from the 3D heat texture) and the same
// see-through cutout (dithered hole around the shopper when a shelf sits
// between the camera and them).

import * as THREE from 'three/webgpu';
import {
    uniform, vec2, vec3, float, Fn, mix, smoothstep, step, texture, uv, color,
    positionView, positionWorld, screenUV, screenSize, screenCoordinate,
    interleavedGradientNoise, mx_fractal_noise_float, mx_noise_float, abs, fract, min, max, length, select
} from 'three/tsl';

export const PALETTE = {
    fixture: '#f3f1ed',
    fixtureEdge: '#e4e1db',
    floorA: '#d9d6d0',
    floorB: '#cfccc5',
    grid: '#bdb9b1',
    accent: '#4f46e5',
    backdrop: '#dcd8d1'
};

// Shared cutout uniforms, driven each frame by the camera rig.
export const cutout = {
    enabled: uniform(0),
    center: uniform(new THREE.Vector2(0.5, 0.5)), // screen UV of the shopper
    radius: uniform(0.16),                         // fraction of screen height
    depth: uniform(-5)                             // view-space z of the shopper
};

const cutoutMask = Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const d = length(screenUV.sub(cutout.center).mul(vec2(aspect, 1)));
    // Fragments nearer the camera than the shopper, inside the circle, are dithered away.
    const inFront = step(cutout.depth.add(0.4), positionView.z);
    const edge = smoothstep(cutout.radius.mul(0.65), cutout.radius, d);
    const noise = interleavedGradientNoise(screenCoordinate.xy);
    const hole = inFront.mul(cutout.enabled).mul(step(edge, noise));
    return hole.lessThan(0.5);
})();

export function createMaterials(heatNodes, textures) {
    const { tint, glow } = heatNodes;

    const fixture = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
    // A whisper of large-scale noise keeps big white surfaces from reading as flat CG.
    const fixtureBase = mix(color(PALETTE.fixture), color(PALETTE.fixtureEdge), mx_noise_float(positionWorld.mul(0.9)).mul(0.5).add(0.5).mul(0.35));
    fixture.colorNode = tint(fixtureBase);
    fixture.emissiveNode = glow;
    fixture.maskNode = cutoutMask;

    const accent = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.1 });
    accent.colorNode = tint(color(PALETTE.accent));
    accent.emissiveNode = glow;
    accent.maskNode = cutoutMask;

    const metal = new THREE.MeshStandardNodeMaterial({ color: '#9aa0a6', roughness: 0.3, metalness: 0.9 });
    metal.maskNode = cutoutMask;

    // Kick plates and shelf lips: a dark band that grounds the white fixtures.
    const base = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
    base.colorNode = tint(color('#2f2f3a'));
    base.emissiveNode = glow;
    base.maskNode = cutoutMask;

    // Product imagery: one material per texture id, created lazily.
    const imageMaterials = new Map();
    const image = (id) => {
        if (imageMaterials.has(id)) return imageMaterials.get(id);
        const tex = textures.get(id);
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
        m.colorNode = tex ? tint(texture(tex, uv()).rgb) : tint(color(PALETTE.fixture));
        m.emissiveNode = glow;
        m.maskNode = cutoutMask;
        imageMaterials.set(id, m);
        return m;
    };

    // Polished concrete with a faint 2m tile grid.
    const floor = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const fp = positionWorld.xz;
    const n = mx_fractal_noise_float(vec3(fp.mul(0.35), 0), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const tile = fp.div(2.0);
    const gx = abs(fract(tile.x).sub(0.5));
    const gy = abs(fract(tile.y).sub(0.5));
    const line = smoothstep(0.485, 0.497, max(gx, gy));
    floor.colorNode = mix(mix(color(PALETTE.floorA), color(PALETTE.floorB), n), color(PALETTE.grid), line.mul(0.55));
    floor.roughnessNode = mix(float(0.32), float(0.55), n);

    return { fixture, accent, metal, base, image, floor };
}

export function loadTexture(url) {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}
