// Node materials for the store. Every fixture material shares the same heat
// nodes (smooth gaze glow sampled from the 3D heat texture) and the same
// see-through cutout (dithered hole around the shopper when a shelf sits
// between the camera and them).

import * as THREE from 'three/webgpu';
import {
    uniform, vec2, vec3, float, Fn, mix, smoothstep, step, texture, uv, color,
    positionView, positionWorld, screenUV, screenSize,
    mx_fractal_noise_float, mx_noise_float, abs, fract, min, max, length, luminance
} from 'three/tsl';

export const PALETTE = {
    fixture: '#f1f1ef',
    fixtureEdge: '#ecebe7',
    floorA: '#e6e1d9',
    floorB: '#dbd5cb',
    grid: '#c2bcb1',
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

// The cutout is a crisp "lens": fragments in front of the shopper inside the
// circle are discarded, and a thin accent rim marks the cut edge.
const cutoutDist = Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    return length(screenUV.sub(cutout.center).mul(vec2(aspect, 1)));
})();
const cutoutInFront = step(cutout.depth.add(0.4), positionView.z).mul(cutout.enabled);
const cutoutMask = cutoutInFront.mul(step(cutoutDist, cutout.radius)).lessThan(0.5);
const cutoutRim = cutoutInFront.mul(smoothstep(cutout.radius.mul(1.06), cutout.radius.mul(1.0), cutoutDist));
const withRim = (col) => mix(col, color('#6366f1'), cutoutRim.mul(0.45));

export function createMaterials(heatNodes, textures) {
    const { tint, tintFixture, glow } = heatNodes;

    const fixture = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
    // A whisper of large-scale noise keeps big white surfaces from reading as flat CG.
    const fixtureBase = mix(color(PALETTE.fixture), color(PALETTE.fixtureEdge), mx_noise_float(positionWorld.mul(0.9)).mul(0.5).add(0.5).mul(0.35));
    // Plain fixtures only show heat that's genuinely high, so AoE bleed from
    // product faces doesn't wash end caps and side panels.
    fixture.colorNode = withRim(tintFixture(fixtureBase));
    fixture.emissiveNode = glow;
    fixture.maskNode = cutoutMask;

    const accent = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.1 });
    accent.colorNode = withRim(tint(color(PALETTE.accent)));
    accent.emissiveNode = glow;
    accent.maskNode = cutoutMask;

    const metal = new THREE.MeshStandardNodeMaterial({ color: '#9aa0a6', roughness: 0.3, metalness: 0.9 });
    metal.maskNode = cutoutMask;

    const trim = new THREE.MeshStandardNodeMaterial({ color: '#dedee3', roughness: 0.35, metalness: 0.1 });
    trim.maskNode = cutoutMask;

    // Kick plates and shelf lips: a dark band that grounds the white fixtures.
    const base = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
    base.colorNode = withRim(tint(color('#34343d')));
    base.emissiveNode = glow;
    base.maskNode = cutoutMask;

    // Product imagery: one material per texture id, created lazily.
    const imageMaterials = new Map();
    const image = (id) => {
        if (imageMaterials.has(id)) return imageMaterials.get(id);
        const tex = textures.get(id);
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
        const albedo = tex ? texture(tex, uv()).rgb : color(PALETTE.fixture);
        m.colorNode = withRim(tint(albedo));
        m.emissiveNode = glow;
        m.maskNode = cutoutMask;
        imageMaterials.set(id, m);
        return m;
    };

    // Hanging category signs: one designed template, drawn to canvas.
    const signMaterials = new Map();
    const sign = (label, aspect) => {
        const key = `${label}|${aspect.toFixed(2)}`;
        if (signMaterials.has(key)) return signMaterials.get(key);
        const tex = signTexture(label || '', aspect);
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0 });
        m.colorNode = withRim(tint(texture(tex, uv()).rgb));
        m.emissiveNode = glow.add(texture(tex, uv()).rgb.mul(0.12)); // faint self-lit face
        m.maskNode = cutoutMask;
        signMaterials.set(key, m);
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
    floor.roughnessNode = mix(float(0.2), float(0.38), n);

    return { fixture, accent, metal, base, trim, image, sign, floor };
}

export const CATEGORY_COLORS = {
    snacks: '#f59e0b', veggie: '#22c55e', meat: '#ef4444', sauce: '#f97316',
    canned: '#94a3b8', frozen: '#38bdf8', goods: '#a78bfa'
};

function signTexture(label, aspect) {
    const W = 1024, H = Math.round(W / aspect);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const draw = () => {
        const g = c.getContext('2d');
        g.fillStyle = '#1e1b4b';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#6366f1';
        g.fillRect(0, 0, W, Math.round(H * 0.07));
        g.fillStyle = '#ffffff';
        g.textBaseline = 'middle';
        let size = H * 0.36;
        const text = label.toUpperCase();
        g.font = `700 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
        if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * 0.08)}px`;
        const maxW = W * 0.88 - 0;
        while (g.measureText(text).width > maxW && size > 10) {
            size *= 0.92;
            g.font = `700 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
        }
        g.textAlign = 'center';
        g.fillText(text, W / 2, H * 0.56);
        tex.needsUpdate = true;
    };
    draw();
    // Redraw once Inter has loaded so the first frame's fallback font doesn't stick.
    document.fonts?.load(`700 64px Inter`).then(draw).catch(() => {});
    return tex;
}

export function loadTexture(url) {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}
