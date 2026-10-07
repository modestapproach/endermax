// Top-down plan of the store drawn in 2D: fixtures tinted by their hottest
// cell, the walked path, items, and the shopper with a view cone. Replaces
// v1's second WebGL renderer for "bird's eye" snapshots — crisper, and no
// extra GPU context.

import { HEAT_STOPS } from './heat.js';
import { UNIT } from './layout.js';

function heatCss(h) {
    let k = 1;
    while (k < HEAT_STOPS.length - 1 && h > HEAT_STOPS[k][0]) k++;
    const [t0, c0] = HEAT_STOPS[k - 1], [t1, c1] = HEAT_STOPS[k];
    const t = Math.min(Math.max((h - t0) / (t1 - t0), 0), 1);
    const a = parseInt(c0.slice(1), 16), b = parseInt(c1.slice(1), 16);
    const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function drawPlanMap(canvas, { layout, heat, path, person, items = [], extent = 32 }) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W, H) / (extent * 2);
    // World X -> canvas x, world Z -> canvas y (matches v1's ortho camera).
    const px = (x) => W / 2 + x * scale;
    const py = (z) => H / 2 + z * scale;

    ctx.fillStyle = '#f4f2ee';
    ctx.fillRect(0, 0, W, H);

    // 2m floor grid
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let g = -extent; g <= extent; g += 2) {
        ctx.beginPath(); ctx.moveTo(px(g), 0); ctx.lineTo(px(g), H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py(g)); ctx.lineTo(W, py(g)); ctx.stroke();
    }

    // Collapse cells to plan columns, keeping the hottest level and whether it's overhead.
    const plan = new Map();
    for (const c of layout.cells.values()) {
        const key = `${c.gx},${c.gz}`;
        const h = heat ? heat.get(c.gx, c.gy, c.gz) : 0;
        const overhead = c.gy >= 13;
        const prev = plan.get(key);
        if (!prev) plan.set(key, { gx: c.gx, gz: c.gz, h, overhead });
        else { prev.h = Math.max(prev.h, h); prev.overhead = prev.overhead && overhead; }
    }
    const s = UNIT * scale;
    for (const p of plan.values()) {
        const x = px(p.gx * UNIT) - s / 2, y = py(p.gz * UNIT) - s / 2;
        if (p.overhead) {
            ctx.fillStyle = p.h > 0.01 ? heatCss(p.h) : 'rgba(79,70,229,0.18)';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        } else {
            ctx.fillStyle = p.h > 0.01 ? heatCss(p.h) : '#d6d2ca';
            ctx.fillRect(x, y, s, s);
        }
    }

    // Path
    if (path && path.count > 1) {
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, scale * 0.18);
        const n = path.count;
        for (let i = 1; i < n; i++) {
            const t = i / n;
            ctx.strokeStyle = `rgba(${Math.round(199 - 132 * t)},${Math.round(210 - 154 * t)},${Math.round(254 - 52 * t)},0.95)`;
            ctx.beginPath();
            ctx.moveTo(px(path.positions[(i - 1) * 3]), py(path.positions[(i - 1) * 3 + 2]));
            ctx.lineTo(px(path.positions[i * 3]), py(path.positions[i * 3 + 2]));
            ctx.stroke();
        }
    }

    // Items still on the floor
    for (const it of items) {
        ctx.strokeStyle = '#6d64ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(it.position.x), py(it.position.z), Math.max(4, 0.5 * scale), 0, Math.PI * 2);
        ctx.stroke();
    }

    // Shopper + view cone (forward is local -Z)
    if (person) {
        const x = px(person.position.x), y = py(person.position.z);
        const yaw = person.rotation.y;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const ang = Math.atan2(fz, fx);
        const r = 6 * scale;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(99,102,241,0.35)');
        grad.addColorStop(1, 'rgba(99,102,241,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, ang - 0.6, ang + 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#4f46e5';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(5, 0.4 * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    return canvas;
}
