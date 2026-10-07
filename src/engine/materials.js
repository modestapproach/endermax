// Materials for the store, built for few shaders.
//
// Every distinct material is a distinct GPU pipeline, and on some machines
// (e.g. Intel Macs with AMD GPUs) each pipeline takes ~0.5–1s to compile. So
// the whole store — fixtures, product photos, signs, trim, hardware, walls,
// ceiling, LED strips — draws with ONE material. Per-surface look comes from
// vertex attributes (`color`, `surf` = roughness, metalness, glow, texture
// amount), and product photos + sign faces share one atlas texture. The floor
// is a single baked texture.

import * as THREE from 'three/webgpu';
import {
    uniform, vec2, vec3, float, Fn, mix, smoothstep, step, texture, uv, color, attribute,
    positionView, positionWorld, screenUV, screenSize, length
} from 'three/tsl';

export const PALETTE = {
    fixture: '#f1f1ef',
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
// Only geometry clearly nearer the camera than the shopper is cut.
const cutoutInFront = step(cutout.depth.add(0.9), positionView.z).mul(cutout.enabled);
const cutoutMask = cutoutInFront.mul(step(cutoutDist, cutout.radius)).lessThan(0.5);
const cutoutRim = cutoutInFront.mul(smoothstep(cutout.radius.mul(1.06), cutout.radius.mul(1.0), cutoutDist));
const withRim = (col) => mix(col, color('#6366f1'), cutoutRim.mul(0.45));

// --- Surface painting (vertex attributes for the store material) -------------
const _c = new THREE.Color();
/** Paints a whole geometry: color (sRGB hex), roughness, metalness, glow, texture amount. */
export function paint(geo, hex, { rough = 0.6, metal = 0, glow = 0, tex = 0 } = {}) {
    const n = geo.attributes.position.count;
    _c.set(hex); // three converts hex to the linear working space
    const col = new Float32Array(n * 3), surf = new Float32Array(n * 4);
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
        col[j] = _c.r; col[j + 1] = _c.g; col[j + 2] = _c.b;
        surf[k] = rough; surf[k + 1] = metal; surf[k + 2] = glow; surf[k + 3] = tex;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
    return geo;
}
/** Repaints a range of vertices (e.g. the image faces of a box). */
export function paintRange(geo, start, count, { rough, metal, glow, tex } = {}) {
    const s = geo.attributes.surf;
    for (let i = start; i < start + count; i++) {
        if (rough !== undefined) s.setX(i, rough);
        if (metal !== undefined) s.setY(i, metal);
        if (glow !== undefined) s.setZ(i, glow);
        if (tex !== undefined) s.setW(i, tex);
    }
}

export function createMaterials(heatNodes, { shelfUrls, signList }, layout) {
    const { tint, glow } = heatNodes;

    const atlas = createStoreAtlas(shelfUrls, signList);
    (window.__worldTimes ||= []).push(['atlas', Math.round(performance.now())]);

    // The one store material.
    const store = new THREE.MeshStandardNodeMaterial();
    const surf = attribute('surf', 'vec4');
    const flat = attribute('color', 'vec3');
    const albedo = mix(flat, texture(atlas.texture, uv()).rgb, surf.w);
    // Surfaces darken slightly toward the floor (cheap stand-in for AO).
    const baseShade = mix(float(0.82), float(1), smoothstep(float(0), float(0.9), positionWorld.y));
    store.colorNode = withRim(tint(albedo.mul(baseShade)));
    store.roughnessNode = surf.x;
    store.metalnessNode = surf.y;
    store.emissiveNode = glow.add(albedo.mul(surf.z));
    store.maskNode = cutoutMask;

    // Floor: noise, 2m tile grid and baked contact shading in one texture.
    const floor = new THREE.MeshStandardNodeMaterial({ map: bakeFloorTexture(layout), roughness: 0.3, metalness: 0 });

    return { store, floor, imageRect: atlas.shelfRect, signRect: atlas.signRect };
}

// --- Atlas: shelf photos + sign faces in one texture ---------------------------
// UV rect helper: canvas pixel rect -> texture UV rect (CanvasTexture flips Y).
const uvRect = (x, y, w, h, W, H) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });

function createStoreAtlas(shelfUrls, signList) {
    const CELL = 768, PAD = 12, COLS = 4;
    const W = CELL * COLS;
    const ids = [...shelfUrls.keys()];
    const shelfRows = Math.max(1, Math.ceil(ids.length / COLS));

    // Signs: unique (label, aspect) faces, packed 4 per row under the shelves.
    const signs = [];
    const seen = new Map();
    for (const s of signList) {
        const key = `${s.label}|${s.aspect.toFixed(2)}`;
        if (seen.has(key)) continue;
        const h = Math.round(CELL / s.aspect);
        const entry = { key, label: s.label || '', h };
        signs.push(entry);
        seen.set(key, entry);
    }
    let y = shelfRows * CELL;
    for (let i = 0; i < signs.length; i += COLS) {
        const row = signs.slice(i, i + COLS);
        const rowH = Math.max(...row.map(s => s.h)) + 8;
        row.forEach((s, k) => { s.x = k * CELL; s.y = y; });
        y += rowH;
    }
    const H = y;

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
        const x = (i % COLS) * CELL, yy = Math.floor(i / COLS) * CELL;
        rects.set(id, uvRect(x + PAD, yy + PAD, CELL - 2 * PAD, CELL - 2 * PAD, W, H));
        const img = new Image();
        img.onload = () => {
            g.drawImage(img, x, yy, CELL, CELL);                                   // gutter bleed
            g.drawImage(img, x + PAD, yy + PAD, CELL - 2 * PAD, CELL - 2 * PAD);   // the image
            tex.needsUpdate = true;
        };
        img.src = shelfUrls.get(id);
    });

    const drawSigns = () => {
        for (const s of signs) drawSign(g, s.label, s.x, s.y, CELL, s.h);
        tex.needsUpdate = true;
    };
    drawSigns();
    // Redraw once Inter has loaded so the first frame's fallback font doesn't stick.
    document.fonts?.load(`700 64px Inter`).then(drawSigns).catch(() => {});

    return {
        texture: tex,
        shelfRect: (id) => rects.get(id) || uvRect(0, 0, 1, 1, W, H),
        signRect: (label, aspect) => {
            const s = seen.get(`${label}|${aspect.toFixed(2)}`);
            return s ? uvRect(s.x, s.y, CELL, s.h, W, H) : uvRect(0, 0, 1, 1, W, H);
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

// --- Floor texture ------------------------------------------------------------
// Baked once: warm concrete with soft value noise, a 2m tile grid, and contact
// shading from a blurred fixture-occupancy map. Covers the 60x60 floor plane.
function bakeFloorTexture(layout) {
    const SIZE = 2048, WORLD = 60, ppm = SIZE / WORLD; // pixels per world unit
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');

    // Base + two octaves of value noise (drawn small, upscaled smooth).
    g.fillStyle = PALETTE.floorA;
    g.fillRect(0, 0, SIZE, SIZE);
    const noise = (n, alpha) => {
        const nc = document.createElement('canvas');
        nc.width = nc.height = n;
        const ng = nc.getContext('2d');
        const img = ng.createImageData(n, n);
        let seed = n * 7919;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const b = new THREE.Color(PALETTE.floorB);
        for (let i = 0; i < n * n; i++) {
            img.data.set([b.r * 255, b.g * 255, b.b * 255, rand() * 255 * alpha], i * 4);
        }
        ng.putImageData(img, 0, 0);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(nc, 0, 0, SIZE, SIZE);
    };
    noise(24, 0.32);
    noise(96, 0.18);

    // 2m tile grid
    g.strokeStyle = PALETTE.grid;
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(1, ppm * 0.03);
    for (let w = 0; w <= WORLD; w += 2) {
        const p = w * ppm;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, SIZE); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(SIZE, p); g.stroke();
    }
    g.globalAlpha = 1;

    // Contact shading: fixture footprints drawn unfiltered on a small canvas,
    // then blurred ONCE while scaling up and multiplied in. (Filtering every
    // rect draw on the full-size canvas took seconds on slower Macs.)
    const S = 512, sp = S / WORLD;
    const sc = document.createElement('canvas');
    sc.width = sc.height = S;
    const sg = sc.getContext('2d');
    sg.fillStyle = '#ffffff';
    sg.fillRect(0, 0, S, S);
    sg.fillStyle = '#5c5a56';
    const U = layout.unit;
    for (const cell of layout.cells.values()) {
        if (cell.gy !== 1) continue;
        // Plane UV: world x -> u, world z -> v (texture flipY: canvas y = z).
        sg.fillRect((cell.gx * U - U / 2 + WORLD / 2) * sp - 1, (cell.gz * U - U / 2 + WORLD / 2) * sp - 1, U * sp + 2, U * sp + 2);
    }
    g.globalCompositeOperation = 'multiply';
    g.filter = `blur(${Math.round(ppm * 0.45)}px)`;
    g.drawImage(sc, 0, 0, SIZE, SIZE);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}
