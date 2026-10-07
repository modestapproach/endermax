// Camera/gaze parity check against v1 (endermax-v3 dev server on :5173).
// Same spawn pose, same cursor positions: compares what each version's gaze
// hits and saves side-by-side screenshots.
//
//   node scripts/parity-v1.mjs [--fp]

import { chromium } from 'playwright';

const fp = process.argv.includes('--fp');
const points = [[640, 400], [300, 300], [1000, 300], [640, 200], [200, 550], [1100, 600]];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] });

async function probe(url, setup, tag) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url);
    if (url.includes(':5174')) await page.waitForFunction(() => window.endermax?.ready, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(setup);
    if (fp) await page.evaluate(() => document.getElementById('cameraToggle')?.click());
    await page.waitForTimeout(400);
    const out = [];
    for (const [x, y] of points) {
        await page.mouse.move(x, y, { steps: 3 });
        await page.waitForTimeout(400);
        const t = await page.evaluate(() => {
            const u = window.currentGazeTarget?.userData;
            return u ? (u.type || `${u.gridX},${u.gridY},${u.gridZ}${u.label ? ' ' + u.label : ''}`) : 'none';
        });
        out.push(t);
    }
    await page.mouse.move(640, 400);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.shots/parity-${tag}${fp ? '-fp' : ''}.png` });
    await page.close();
    return out;
}

// v1: hide the intro overlays; the sim already runs (gaze on) behind them.
const v1 = await probe('http://localhost:5173/', () => {
    for (const id of ['front-page', 'landing-page', 'intro-modal']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
}, 'v1');
const v2 = await probe('http://localhost:5174/?skip', () => window.endermax.pose({ x: 0, z: 0, yaw: 0, pitch: 0 }), 'v2');
points.forEach((p, i) => console.log(`${String(p).padEnd(10)} v1: ${v1[i].padEnd(26)} v2: ${v2[i]}${v1[i] === v2[i] ? '' : '   <-- differs'}`));
await browser.close();
