// Load-time profile: real flow (no ?skip). Reports when the sim is ready,
// long main-thread tasks, and frame gaps after the front page is clicked.
//
//   npm run loadtime -- [query]

import { chromium } from 'playwright';
const q = process.argv[2] ? `?${process.argv[2]}` : '';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    window.__frames = [];
    const raf = window.requestAnimationFrame.bind(window);
    (function tick(t) { window.__frames.push(Math.round(t)); if (window.__frames.length < 4000) raf(tick); })(0);
});
const t0 = Date.now();
await page.goto(`${process.env.BASE || 'http://localhost:5174'}/${q}`);
await page.waitForFunction(() => window.endermax, null, { timeout: 120000 });
const ready = Date.now() - t0;
await page.waitForTimeout(1500);
const clickAt = await page.evaluate(() => performance.now());
await page.click('#front-page').catch(() => {});
await page.waitForTimeout(1500);
await page.click('.btn-explore').catch(() => {});
await page.waitForTimeout(8000);
const r = await page.evaluate((clickAt) => {
    const f = window.__frames.filter(t => t > clickAt);
    const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => b - a).slice(0, 5);
    return { init: window.__initTimes, long: window.__long.filter(([s, d]) => d > 200), worstFrameGapsAfterClick: gaps, framesAfterClick: f.length };
}, clickAt);
console.log(JSON.stringify({ readyMs: ready, clickAt: Math.round(clickAt), ...r }, null, 1));
await browser.close();
