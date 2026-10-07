// A shared vocabulary for driving the sim from code: camera presets, poses,
// synthetic heat, stats, and PNG capture. Used by humans in the console and by
// agents verifying visual changes (?dev in the URL).
//
//   ?skip            jump straight into the sim (no front page / intro / tutorial)
//   ?cam=hero        start from a named camera preset (hero|top|aisle|fp|wide)
//   ?heat=demo       fill the store with synthetic gaze heat
//   ?hud             show the perf HUD
//
// window.endermax.shot('name') saves .shots/name.png via the dev server.

import * as THREE from 'three/webgpu';
import { UNIT } from './layout.js';

export const params = new URLSearchParams(location.search);
export const flags = {
    dev: params.has('dev') || import.meta.env.DEV,
    skip: params.has('skip'),
    cam: params.get('cam'),
    heat: params.get('heat'),
    hud: params.has('hud')
};

// Named views. Free-camera presets pin the camera; pose presets move the shopper.
export const CAMERA_PRESETS = {
    hero:  { pose: { x: 2, z: 6, yaw: 0.35, pitch: 0.1 } },
    aisle: { pose: { x: -7.5, z: 4, yaw: Math.PI / 2, pitch: 0 } },
    fp:    { pose: { x: 0, z: 4, yaw: 0, pitch: 0 }, firstPerson: true },
    top:   { free: { pos: [0.01, 46, 0], target: [0, 0, 0], fov: 55 } },
    wide:  { free: { pos: [22, 16, 24], target: [-2, 1.5, 0], fov: 50 } }
};

export function createDemoHeat(layout, heat, seed = 7) {
    let s = seed;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    heat.reset();
    const walls = layout.panels.filter(p => p.kind === 'wall');
    const p0 = new THREE.Vector3();
    for (const p of walls) {
        const spots = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < spots; k++) {
            const t = rand();
            const gx = Math.round(p.gx0 + (p.gx1 - p.gx0) * t);
            const gz = Math.round(p.gz0 + (p.gz1 - p.gz0) * t);
            const gy = 3 + Math.floor(rand() * 6);
            const cell = layout.cells.get(`${gx},${gy},${gz}`);
            if (!cell) continue;
            p0.set(gx * UNIT, gy * UNIT, gz * UNIT);
            const seconds = 0.15 + rand() * 0.6;
            for (let f = 0; f < seconds * 60; f++) heat.applyGaze(cell, p0, 1 / 60);
        }
    }
    // Hanging signs get glanced at too.
    for (const p of layout.panels.filter(q => q.kind === 'sign')) {
        if (rand() < 0.5) continue;
        const cell = layout.cells.get(`${p.gx0},14,${p.gz0}`);
        if (!cell) continue;
        p0.set(p.gx0 * UNIT, 14 * UNIT, p.gz0 * UNIT);
        for (let f = 0; f < 20; f++) heat.applyGaze(cell, p0, 1 / 60);
    }
}

async function saveShot(name, dataUrl) {
    if (!import.meta.env.DEV) return null;
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: dataUrl });
    return res.ok ? (await res.json()).path : null;
}

async function contactSheet(entries, cellW = 640, cellH = 400) {
    const cols = 2, rows = Math.ceil(entries.length / cols);
    const c = document.createElement('canvas');
    c.width = cellW * cols; c.height = cellH * rows;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < entries.length; i++) {
        const [label, url] = entries[i];
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = url; });
        const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
        const s = Math.min(cellW / img.width, cellH / img.height);
        g.drawImage(img, x + (cellW - img.width * s) / 2, y + (cellH - img.height * s) / 2, img.width * s, img.height * s);
        g.fillStyle = 'rgba(15,15,26,.75)'; g.fillRect(x + 8, y + 8, 12 + label.length * 8, 22);
        g.fillStyle = '#fff'; g.font = '13px ui-monospace,monospace'; g.fillText(label, x + 14, y + 24);
    }
    return c.toDataURL('image/jpeg', 0.85);
}

export function installDevtools(api) {
    const { renderer, camera, layout, heat, captureFrame, capturePlan, setPose, setFirstPerson, setPointer, getPose, setFreeCamera, info } = api;

    const endermax = {
        layout, heat, camera, renderer,
        pose: (p) => { setFreeCamera(null); setPose(p); return getPose(); },
        pointer: (nx, ny) => setPointer(nx, ny),
        firstPerson: (on = true) => setFirstPerson(on),
        freeCam: (pos, target, fov) => setFreeCamera(pos ? { pos, target, fov } : null),
        cam(name) {
            const p = CAMERA_PRESETS[name];
            if (!p) return Object.keys(CAMERA_PRESETS);
            setFirstPerson(!!p.firstPerson);
            if (p.free) setFreeCamera(p.free);
            else { setFreeCamera(null); setPose(p.pose); }
            return name;
        },
        demoHeat: (seed) => createDemoHeat(layout, heat, seed),
        clearHeat: () => heat.reset(),
        stats: () => info(),
        // Renders and saves the current view; resolves to the saved path.
        async shot(name = `shot-${Date.now()}`, { width, height } = {}) {
            const url = await captureFrame('image/png', 1, { width, height });
            return saveShot(name, url);
        },
        async plan(name = 'plan') {
            return saveShot(name, capturePlan(1024));
        },
        // Shoots every named preset plus the plan map, and a contact sheet of
        // all of them (<prefix>-sheet.jpg) for one-glance review.
        async tour(prefix = 'tour', names = ['hero', 'wide', 'top', 'fp', 'aisle'], size = { width: 1280, height: 800 }) {
            const out = [];
            const urls = [];
            for (const n of names) {
                endermax.cam(n);
                setPointer(0, 0.1);
                const url = await captureFrame('image/png', 1, size);
                urls.push([n, url]);
                out.push(await saveShot(`${prefix}-${n}`, url));
            }
            const planUrl = capturePlan(800);
            urls.push(['plan', planUrl]);
            out.push(await saveShot(`${prefix}-plan`, planUrl));
            out.push(await saveShot(`${prefix}-sheet`, await contactSheet(urls)));
            endermax.cam('hero');
            return out;
        },
        // Waits n animation frames (lets smoothing/lazy textures settle).
        frames: (n = 30) => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })
    };
    window.endermax = endermax;

    if (flags.hud) {
        const hud = document.createElement('div');
        hud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px/1.4 ui-monospace,monospace;color:#fff;background:rgba(15,15,26,.75);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
        document.body.appendChild(hud);
        setInterval(() => { const s = info(); hud.textContent = `${s.backend}  ${s.fps} fps  ${s.drawCalls} draws  ${s.triangles} tris`; }, 500);
    }
    return endermax;
}
