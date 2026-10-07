// End-to-end check of the research loop without a human tester:
// scripted shopper session -> results page -> 3D replay (+ pin selection).
//
//   npm run e2e -- [prefix] [--seconds=24]

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const args = process.argv.slice(2);
const prefix = args.find(a => !a.startsWith('--')) || 'e2e';
const seconds = Number((args.find(a => a.startsWith('--seconds=')) || '=24').split('=')[1]);
const base = 'http://localhost:5174';
mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(`${base}/?skip`);
await page.waitForFunction(() => window.endermax, null, { timeout: 30000 });
const sessionId = await page.evaluate((s) => window.endermax.simulateSession({ seconds: s }), seconds);

await page.goto(`${base}/results.html`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `.shots/${prefix}-results.png` });

const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('3D Session'));
    btn?.click();
    return !!btn;
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `.shots/${prefix}-replay.png` });

// Select a mid-session snapshot through the public viewer API.
const picked = await page.evaluate(async () => {
    const { selectSnapshot } = await import('/src/viewer.js');
    const { db } = await import('/src/db.js');
    const last = await db.sessions.orderBy('id').last();
    const snaps = await db.snapshots.where('sessionId').equals(last.id).sortBy('timestamp');
    const mid = snaps[Math.floor(snaps.length / 2)];
    selectSnapshot(mid.timestamp);
    return { count: snaps.length, gaze: mid.gazeTarget };
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `.shots/${prefix}-replay-selected.png` });

console.log(JSON.stringify({ sessionId, opened, picked, errors: [...new Set(errors)].slice(0, 15) }, null, 2));
await browser.close();
