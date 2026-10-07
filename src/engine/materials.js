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

// Contact shading baked from the layout (replaces GTAO outside "high"):
// a blurred plan-occupancy map darkens the floor around fixture bases.
function bakeFloorAO(layout) {
    const { x: nx, z: nz } = layout.dims;
    const o = layout.origin;
    const S = 4; // texels per cell
    const W = nx * S, H = nz * S;
    let occ = new Float32Array(W * H);
    for (const c of layout.cells.values()) {
        if (c.gy > 10) continue;
        const ix = (c.gx - o.gx) * S, iz = (c.gz - o.gz) * S;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) occ[(iz + b) * W + ix + a] = 1;
    }
    const blur = (src, r, horizontal) => {
        const out = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let acc = 0, n = 0;
            for (let k = -r; k <= r; k++) {
                const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                acc += src[yy * W + xx]; n++;
            }
            out[y * W + x] = acc / n;
        }
        return out;
    };
    occ = blur(blur(blur(blur(occ, 3, true), 3, false), 3, true), 3, false);
    const data = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = Math.round(255 * (1 - Math.min(occ[i] * 1.6, 1)));
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return { tex, nx, nz, o };
}

export function createMaterials(heatNodes, { shelfUrls, signList }, layout) {
    const { tint, tintFixture, glow } = heatNodes;

    const fixture = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
    // A whisper of large-scale noise keeps big white surfaces from reading as flat CG.
    const fixtureBase = mix(color(PALETTE.fixture), color(PALETTE.fixtureEdge), mx_noise_float(positionWorld.mul(0.9)).mul(0.5).add(0.5).mul(0.35));
    // Plain fixtures only show heat that's genuinely high, so AoE bleed from
    // product faces doesn't wash end caps and side panels.
    // Fixtures darken slightly toward the floor (cheap stand-in for AO).
    const baseShade = mix(float(0.8), float(1), smoothstep(float(0), float(0.9), positionWorld.y));
    fixture.colorNode = withRim(tintFixture(fixtureBase.mul(baseShade)));
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
    base.colorNode = withRim(tint(color('#4a4a55')));
    base.emissiveNode = glow;
    base.maskNode = cutoutMask;

    // Product imagery and signs each use ONE material over a texture atlas.
    // Separate materials per image compiled a separate shader each (WebGPU
    // doesn't share them), which dominated load time on cold shader caches.
    const shelves = createShelfAtlas(shelfUrls);
    const image = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
    image.colorNode = withRim(tint(texture(shelves.texture, uv()).rgb));
    image.emissiveNode = glow;
    image.maskNode = cutoutMask;

    const signs = createSignAtlas(signList);
    const sign = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0 });
    sign.colorNode = withRim(tint(texture(signs.texture, uv()).rgb));
    sign.emissiveNode = glow.add(texture(signs.texture, uv()).rgb.mul(0.12)); // faint self-lit face
    sign.maskNode = cutoutMask;

    // Polished concrete with a faint 2m tile grid.
    const floor = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const fp = positionWorld.xz;
    const n = mx_fractal_noise_float(vec3(fp.mul(0.35), 0), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const tile = fp.div(2.0);
    const gx = abs(fract(tile.x).sub(0.5));
    const gy = abs(fract(tile.y).sub(0.5));
    const line = smoothstep(0.485, 0.497, max(gx, gy));
    const ao = bakeFloorAO(layout);
    // World xz -> AO texel (cell centers at g * 0.5, texture spans the layout grid).
    const aoUV = vec2(
        positionWorld.x.div(0.5).sub(ao.o.gx - 0.5).div(ao.nx),
        positionWorld.z.div(0.5).sub(ao.o.gz - 0.5).div(ao.nz)
    );
    const contact = mix(float(0.62), float(1), texture(ao.tex, aoUV).r);
    floor.colorNode = mix(mix(color(PALETTE.floorA), color(PALETTE.floorB), n), color(PALETTE.grid), line.mul(0.55)).mul(contact);
    floor.roughnessNode = mix(float(0.2), float(0.38), n);

    return { fixture, accent, metal, base, trim, image, imageRect: shelves.rectFor, sign, signRect: signs.rectFor, floor };
}

export const CATEGORY_COLORS = {
    snacks: '#f59e0b', veggie: '#22c55e', meat: '#ef4444', sauce: '#f97316',
    canned: '#94a3b8', frozen: '#38bdf8', goods: '#a78bfa'
};

// UV rect helper: canvas pixel rect -> texture UV rect (CanvasTexture flips Y).
const uvRect = (x, y, w, h, W, H) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });

// Shelf photos packed 4x2 into 1024px cells, each inset by a gutter whose
// pixels are a stretched copy of the image edge (no mip bleeding).
function createShelfAtlas(urls) {
    const CELL = 1024, PAD = 16, COLS = 4;
    const ids = [...urls.keys()];
    const rows = Math.max(1, Math.ceil(ids.length / COLS));
    const W = CELL * COLS, H = CELL * rows;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e7e3';
    g.fillRect(0, 0, W, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const rects = new Map();
    ids.forEach((id, i) => {
        const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
        rects.set(id, uvRect(x + PAD, y + PAD, CELL - 2 * PAD, CELL - 2 * PAD, W, H));
        const img = new Image();
        img.onload = () => {
            g.drawImage(img, x, y, CELL, CELL);                                   // gutter bleed
            g.drawImage(img, x + PAD, y + PAD, CELL - 2 * PAD, CELL - 2 * PAD);   // the image
            tex.needsUpdate = true;
        };
        img.src = urls.get(id);
    });
    return { texture: tex, rectFor: (id) => rects.get(id) || uvRect(0, 0, 1, 1, W, H) };
}

// All sign faces stacked into one canvas column (one row per distinct sign).
function createSignAtlas(list) {
    const W = 1024, GAP = 8;
    const rows = [];
    const seen = new Map();
    let y = 0;
    for (const s of list) {
        const key = `${s.label}|${s.aspect.toFixed(2)}`;
        if (seen.has(key)) continue;
        const h = Math.round(W / s.aspect);
        rows.push({ key, label: s.label || '', y, h });
        seen.set(key, rows[rows.length - 1]);
        y += h + GAP;
    }
    const H = Math.max(y, 4);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const draw = () => {
        const g = c.getContext('2d');
        for (const r of rows) drawSign(g, r.label, 0, r.y, W, r.h);
        tex.needsUpdate = true;
    };
    draw();
    // Redraw once Inter has loaded so the first frame's fallback font doesn't stick.
    document.fonts?.load(`700 64px Inter`).then(draw).catch(() => {});
    return {
        texture: tex,
        rectFor: (label, aspect) => {
            const r = seen.get(`${label}|${aspect.toFixed(2)}`);
            return r ? uvRect(0, r.y, W, r.h, W, H) : uvRect(0, 0, W, H, W, H);
        }
    };
}

function drawSign(g, label, x, y, W, H) {
    g.save();
    g.beginPath(); g.rect(x, y, W, H); g.clip();
    g.fillStyle = '#1e1b4b';
    g.fillRect(x, y, W, H);
    g.fillStyle = '#6366f1';
    g.fillRect(x, y, W, Math.round(H * 0.07));
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    let size = H * 0.36;
    const text = label.toUpperCase();
    g.font = `700 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * 0.08)}px`;
    while (g.measureText(text).width > W * 0.88 && size > 10) {
        size *= 0.92;
        g.font = `700 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
    }
    g.fillText(text, x + W / 2, y + H * 0.56);
    g.restore();
}
