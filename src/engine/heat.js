// Gaze heat lives in a dense 3D grid that mirrors the layout cells. The CPU
// accumulates into a Float32Array; a byte copy is uploaded as a Data3DTexture
// that every fixture shader samples by world position, so heat renders as a
// smooth glow across surfaces instead of per-cube tints.

import * as THREE from 'three/webgpu';
import { texture3D, uniform, positionWorld, normalWorld, vec3, float, Fn, mix, smoothstep, texture, vec2, clamp, fract, abs, fwidth, luminance, max } from 'three/tsl';
import { UNIT } from './layout.js';

// Per-second rates, identical in both camera modes (see v1 STABILITY.md).
export const HEAT_RATE_HIT = 3.0;
export const HEAT_RATE_AOE = 0.72;
export const HEAT_RATE_DECAY = 0.3;

// The legend's stops: white > light blue > green > yellow > orange > red.
export const HEAT_STOPS = [
    [0.0, '#ffffff'], [0.2, '#60a5fa'], [0.4, '#22c55e'],
    [0.6, '#facc15'], [0.8, '#f97316'], [1.0, '#ef4444']
];

export class HeatField {
    constructor(layout) {
        this.layout = layout;
        const { x, y, z } = layout.dims;
        this.dims = layout.dims;
        this.origin = layout.origin;
        this.values = new Float32Array(x * y * z);
        this.occupied = new Uint8Array(x * y * z);
        for (const c of layout.cells.values()) {
            const i = this.index(c.gx, c.gy, c.gz);
            if (i >= 0) this.occupied[i] = 1;
        }

        this.bytes = new Uint8Array(x * y * z);
        this.texture = new THREE.Data3DTexture(this.bytes, x, y, z);
        this.texture.format = THREE.RedFormat;
        this.texture.type = THREE.UnsignedByteType;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.unpackAlignment = 1;
        this.texture.needsUpdate = true;

        this.aoeRadius = 2.8;
        this.decay = false;
        this.dirty = false;
        this.maxHeat = 0;
        this._hot = new Set(); // indices with heat > 0, so decay never scans the full volume
        this._box = new Int32Array(6); // dirty region (ix0,iy0,iz0,ix1,iy1,iz1)
    }

    index(gx, gy, gz) {
        const ix = gx - this.origin.gx, iy = gy - this.origin.gy, iz = gz - this.origin.gz;
        const { x, y, z } = this.dims;
        if (ix < 0 || iy < 0 || iz < 0 || ix >= x || iy >= y || iz >= z) return -1;
        return ix + x * (iy + y * iz);
    }

    get(gx, gy, gz) {
        const i = this.index(gx, gy, gz);
        return i < 0 ? 0 : this.values[i];
    }

    _set(i, v) {
        v = Math.min(Math.max(v, 0), 1);
        this.values[i] = v;
        if (v > 0) this._hot.add(i); else this._hot.delete(i);
        if (v > this.maxHeat) this.maxHeat = v;
        this._markDirty(i);
    }

    _markDirty(i) {
        const { x, y } = this.dims;
        const ix = i % x, iy = Math.floor(i / x) % y, iz = Math.floor(i / (x * y));
        const b = this._box;
        if (!this.dirty) { b[0] = b[3] = ix; b[1] = b[4] = iy; b[2] = b[5] = iz; }
        else {
            b[0] = Math.min(b[0], ix); b[1] = Math.min(b[1], iy); b[2] = Math.min(b[2], iz);
            b[3] = Math.max(b[3], ix); b[4] = Math.max(b[4], iy); b[5] = Math.max(b[5], iz);
        }
        this.dirty = true;
    }

    // One frame of gaze on a cell. hitPoint is world space.
    applyGaze(cell, hitPoint, dt) {
        const hitIndex = cell ? this.index(cell.gx, cell.gy, cell.gz) : -1;
        if (hitIndex >= 0 && this.occupied[hitIndex]) {
            this._set(hitIndex, this.values[hitIndex] + HEAT_RATE_HIT * dt);

            const r = this.aoeRadius;
            const rc = Math.ceil(r / UNIT);
            for (let dx = -rc; dx <= rc; dx++) for (let dy = -rc; dy <= rc; dy++) for (let dz = -rc; dz <= rc; dz++) {
                const gx = cell.gx + dx, gy = cell.gy + dy, gz = cell.gz + dz;
                const i = this.index(gx, gy, gz);
                if (i < 0 || i === hitIndex || !this.occupied[i]) continue;
                const ddx = gx * UNIT - hitPoint.x, ddy = gy * UNIT - hitPoint.y, ddz = gz * UNIT - hitPoint.z;
                const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                if (d < r) this._set(i, this.values[i] + HEAT_RATE_AOE * (1 - d / r) * dt);
            }
        }
        if (this.decay && this._hot.size) {
            for (const i of [...this._hot]) if (i !== hitIndex) this._set(i, this.values[i] - HEAT_RATE_DECAY * dt);
        }
    }

    // Called once per frame before rendering. The displayed value of a cell is
    // the max of its own heat and 0.7x its 26 neighbours: a gazed-at cell then
    // reads as a full soft patch (like a v1 block) instead of a tiny peak
    // under trilinear filtering. Only the changed region is recomputed.
    flush() {
        if (!this.dirty) return;
        const { x: nx, y: ny, z: nz } = this.dims;
        const b = this._box, V = this.values, B = this.bytes;
        const x0 = Math.max(b[0] - 1, 0), y0 = Math.max(b[1] - 1, 0), z0 = Math.max(b[2] - 1, 0);
        const x1 = Math.min(b[3] + 1, nx - 1), y1 = Math.min(b[4] + 1, ny - 1), z1 = Math.min(b[5] + 1, nz - 1);
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = x + nx * (y + ny * z);
            let v = V[i];
            for (let dz = -1; dz <= 1; dz++) {
                const zz = z + dz; if (zz < 0 || zz >= nz) continue;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy; if (yy < 0 || yy >= ny) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx; if (xx < 0 || xx >= nx || (dx | dy | dz) === 0) continue;
                        const n = V[xx + nx * (yy + ny * zz)] * 0.7;
                        if (n > v) v = n;
                    }
                }
            }
            B[i] = Math.round(v * 255);
        }
        this.texture.needsUpdate = true;
        this.dirty = false;
    }

    reset() {
        this.values.fill(0);
        this.bytes.fill(0);
        this._hot.clear();
        this.maxHeat = 0;
        this.texture.needsUpdate = true;
        this.dirty = false;
    }

    // v1-compatible serialization: { "gx,gy,gz": heat } for heated cells.
    toObject() {
        const out = {};
        for (const c of this.layout.cells.values()) {
            const v = this.get(c.gx, c.gy, c.gz);
            if (v > 0) out[`${c.gx},${c.gy},${c.gz}`] = v;
        }
        return out;
    }

    load(obj) {
        this.reset();
        for (const [key, v] of Object.entries(obj || {})) {
            const [gx, gy, gz] = key.split(',').map(Number);
            const i = this.index(gx, gy, gz);
            if (i >= 0 && v > 0) this._set(i, v);
        }
    }

    hasAnyHeat(threshold = 0) {
        return this.maxHeat > threshold;
    }
}

// 256px ramp texture built from the legend stops.
export function createHeatRamp() {
    const w = 256;
    const data = new Uint8Array(w * 4);
    const stops = HEAT_STOPS.map(([t, hex]) => [t, new THREE.Color(hex)]);
    const c = new THREE.Color();
    for (let i = 0; i < w; i++) {
        const t = i / (w - 1);
        let k = 1;
        while (k < stops.length - 1 && t > stops[k][0]) k++;
        const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
        c.copy(c0).lerp(c1, Math.min(Math.max((t - t0) / (t1 - t0), 0), 1));
        data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
    }
    const tex = new THREE.DataTexture(data, w, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

// TSL nodes shared by every heat-aware material.
export function createHeatNodes(field) {
    const ramp = createHeatRamp();
    const { x, y, z } = field.dims;
    const dims = vec3(x, y, z);
    const origin = vec3(field.origin.gx, field.origin.gy, field.origin.gz);
    const strength = uniform(1); // 0 hides heat (e.g. a "clean" capture)

    // Sample half a cell inside the surface so faces read their own cell
    // (the field is pre-dilated on the CPU, see HeatField.flush).
    const heat = Fn(() => {
        const p = positionWorld.sub(normalWorld.mul(UNIT * 0.49)).div(UNIT);
        const uvw = p.sub(origin).add(0.5).div(dims);
        return texture3D(field.texture, clamp(uvw, 0, 1)).r.mul(strength);
    })();

    const heatColor = texture(ramp, vec2(heat, 0.5)).rgb;
    // v1-strength fill: light heat already shows the blue tint; hot reads solid.
    const heatMix = smoothstep(float(0.0), float(0.22), heat).mul(0.88);
    // Contours at 0.4 / 0.6 / 0.8, drawn in the ramp colour of their level.
    const bands = heat.mul(5);
    const w = fwidth(bands);
    const contour = float(1).sub(smoothstep(float(0), w.mul(1.25), abs(fract(bands.add(0.5)).sub(0.5))))
        .mul(smoothstep(float(0.34), float(0.4), heat)).mul(0.6);
    const tint = (base) => {
        // Light desaturation under strong heat keeps the ramp readable on packaging.
        const grey = vec3(luminance(base));
        const under = mix(base, grey, smoothstep(float(0.3), float(0.8), heat).mul(0.5));
        return mix(mix(under, heatColor, heatMix), heatColor.mul(0.8), contour);
    };
    // Plain fixtures get heat too (v1 coloured every block), same response.
    const tintFixture = tint;
    // Hot spots glow so bloom picks them up.
    const glow = heatColor.mul(smoothstep(float(0.55), float(1.0), heat).mul(0.4));

    return { heat, heatColor, heatMix, tint, tintFixture, glow, strength, ramp };
}
