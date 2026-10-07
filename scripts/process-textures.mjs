// Offline matting for shelf photos: replaces each photo's flat grey studio
// backdrop with a warm pegboard tone and drops a soft contact shadow behind
// products, so bays read as real shelving instead of screens. Runs in headless
// Chromium (canvas) so there are no native image dependencies.
//
//   npm run textures
//
// Reads  src/assets/textures/<id>/*  for wall images listed in image-settings.txt
// Writes src/assets/shelves/<id>.webp   (originals are left untouched)

import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const root = new URL('..', import.meta.url).pathname;
const settings = readFileSync(join(root, 'image-settings.txt'), 'utf8')
    .split('\n').map(l => l.trim().match(/^(\w+)\[(\d+),\s*([^,]+),/)).filter(Boolean)
    .filter(m => m[3].trim() === 'x').map(m => m[1]);

const outDir = join(root, 'src/assets/shelves');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

for (const id of settings) {
    const dir = join(root, 'src/assets/textures', id);
    let file;
    try { file = readdirSync(dir).find(f => /\.(webp|png|jpe?g)$/i.test(f)); } catch { continue; }
    if (!file) continue;
    const mime = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(file).toLowerCase()];
    const dataUrl = `data:${mime};base64,${readFileSync(join(dir, file)).toString('base64')}`;

    const out = await page.evaluate(async (src) => {
        const img = new Image();
        await new Promise((r, e) => { img.onload = r; img.onerror = e; img.src = src; });
        const W = img.width, H = img.height;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, W, H);
        const d = px.data;

        // Backdrop colour: median of a thin border frame.
        const border = [];
        const m = Math.round(Math.min(W, H) * 0.015);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (x > m && y > m && x < W - m && y < H - m) continue;
            const i = (y * W + x) * 4;
            border.push([d[i], d[i + 1], d[i + 2]]);
        }
        const med = (k) => border.map(p => p[k]).sort((a, b) => a - b)[border.length >> 1];
        const bg = [med(0), med(1), med(2)];

        // Raw foreground likelihood: distance from backdrop, with low-saturation
        // pixels near the backdrop luminance counted as backdrop (JPEG noise).
        const fg = new Float32Array(W * H);
        for (let i = 0, p = 0; p < W * H; p++, i += 4) {
            const r = d[i], gg = d[i + 1], b = d[i + 2];
            const dist = Math.hypot(r - bg[0], gg - bg[1], b - bg[2]);
            const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
            const t = Math.min(Math.max((dist - 16) / 26, 0), 1);
            fg[p] = sat > 40 ? 1 : t;
        }
        // Box blur helper (separable, radius r)
        const blur = (src, r) => {
            const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
            for (let y = 0; y < H; y++) {
                let acc = 0;
                for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(Math.max(x, 0), W - 1)];
                for (let x = 0; x < W; x++) {
                    tmp[y * W + x] = acc / (2 * r + 1);
                    acc += src[y * W + Math.min(x + r + 1, W - 1)] - src[y * W + Math.max(x - r, 0)];
                }
            }
            for (let x = 0; x < W; x++) {
                let acc = 0;
                for (let y = -r; y <= r; y++) acc += tmp[Math.min(Math.max(y, 0), H - 1) * W + x];
                for (let y = 0; y < H; y++) {
                    out[y * W + x] = acc / (2 * r + 1);
                    acc += tmp[Math.min(y + r + 1, H - 1) * W + x] - tmp[Math.max(y - r, 0) * W + x];
                }
            }
            return out;
        };
        // Majority-style cleanup kills the blocky compression islands, then a
        // small feather softens the cut edge.
        const smooth = blur(fg, 3);
        const mask = new Float32Array(W * H);
        for (let p = 0; p < W * H; p++) {
            // Threshold above 0.5 erodes the matte ~1px, trimming the light rim the
            // studio backdrop left around product tops.
            const t = Math.min(Math.max((smooth[p] - 0.48) / 0.3, 0), 1);
            mask[p] = t * t * (3 - 2 * t);
        }
        const alpha = blur(mask, 1);

        // Contact shadow: mask pushed down/right and blurred.
        const shift = new Float32Array(W * H);
        const oy = Math.round(H * 0.012), ox = Math.round(W * 0.004);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const sy = y - oy, sx = x - ox;
            shift[y * W + x] = sy >= 0 && sx >= 0 ? mask[sy * W + sx] : 0;
        }
        const shadow = blur(blur(shift, 6), 6);

        // Composite onto a warm pegboard tone with a faint top-to-bottom falloff.
        const peg = [232, 231, 227];
        for (let i = 0, p = 0; p < W * H; p++, i += 4) {
            const y = Math.floor(p / W);
            const shade = (1 - shadow[p] * 0.38) * (0.97 + 0.03 * (y / H));
            const a = alpha[p];
            d[i] = d[i] * a + peg[0] * shade * (1 - a);
            d[i + 1] = d[i + 1] * a + peg[1] * shade * (1 - a);
            d[i + 2] = d[i + 2] * a + peg[2] * shade * (1 - a);
            d[i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
        return { url: c.toDataURL('image/webp', 0.9), bg };
    }, dataUrl);

    writeFileSync(join(outDir, `${id}.webp`), Buffer.from(out.url.split(',')[1], 'base64'));
    console.log(`${id}: ${file} (backdrop rgb ${out.bg.join(',')}) -> src/assets/shelves/${id}.webp`);
}
await browser.close();
