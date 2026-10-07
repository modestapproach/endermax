// Perf benchmark: Retina-like 2x DPR, gaze moving, 8 seconds in the aisle.
// Reports fps, CPU ms per stage, GPU ms (WebGPU timestamp queries), draw calls.
//
//   npm run bench -- [extra query, e.g. quality=low]

import { chromium } from 'playwright';

const extra = process.argv[2] ? `&${process.argv[2]}` : '';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:5174/?skip&cam=aisle&heat=demo&bench${extra}`);
await page.waitForFunction(() => window.endermax?.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
// Sweep the gaze across both shelf faces while walking forward.
await page.keyboard.down('w');
for (let i = 0; i < 80; i++) {
    await page.mouse.move(200 + (i % 20) * 52, 300 + Math.sin(i / 3) * 120);
    await page.waitForTimeout(50);
}
await page.keyboard.up('w');
for (let i = 0; i < 60; i++) { await page.mouse.move(300 + (i % 15) * 60, 350); await page.waitForTimeout(50); }
const stats = await page.evaluate(() => window.endermax.stats());
console.log(JSON.stringify({ stats, errors }, null, 2));
await browser.close();
