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
        this.bytes[i] = Math.round(v * 255);
        if (v > 0) this._hot.add(i); else this._hot.delete(i);
        if (v > this.maxHeat) this.maxHeat = v;
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

    // Called once per frame before rendering.
    flush() {
        if (!this.dirty) return;
        this.texture.needsUpdate = true;
        this.dirty = false;
    }

    reset() {
        this.values.fill(0);
        this.bytes.fill(0);
        this._hot.clear();
        this.maxHeat = 0;
        this.dirty = true;
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

    // Sample half a cell inside the surface so faces read their own cell.
    const heat = Fn(() => {
        const p = positionWorld.sub(normalWorld.mul(UNIT * 0.49)).div(UNIT);
        const uvw = p.sub(origin).add(0.5).div(dims);
        return texture3D(field.texture, clamp(uvw, 0, 1)).r.mul(strength);
    })();

    const heatColor = texture(ramp, vec2(heat, 0.5)).rgb;
    // Fill: nothing below 0.06, capped at 0.6 so packaging stays readable.
    const heatMix = smoothstep(float(0.06), float(0.45), heat).mul(0.6);
    // Contour lines every 1/6 of the range make heat read as data, not paint.
    const bands = heat.mul(6);
    const contour = smoothstep(fwidth(bands).mul(1.2), float(0), abs(fract(bands).sub(0.5)).mul(2).oneMinus())
        .mul(smoothstep(float(0.22), float(0.32), heat)).mul(0.8);
    const tint = (base) => {
        // Desaturate what's under heat so the ramp has something to sit on.
        const grey = vec3(luminance(base));
        const under = mix(base, grey, heatMix.mul(1.2).min(0.6));
        return mix(mix(under, heatColor, heatMix), heatColor.mul(0.85), contour);
    };
    // Only genuinely hot spots glow (bloom), so low heat never haloes.
    const glow = heatColor.mul(smoothstep(float(0.6), float(1.0), heat).mul(0.35));

    return { heat, heatColor, heatMix, tint, glow, strength, ramp };
}
