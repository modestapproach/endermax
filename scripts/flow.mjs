// Walks the real onboarding flow with real input events and screenshots each
// stage: front page -> landing -> intro -> tutorial -> walking + looking.
//
//   npm run flow -- [prefix]

import { chromium } from 'playwright';

const prefix = process.argv[2] || 'flow';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const shot = (n) => page.screenshot({ path: `.shots/${prefix}-${n}.png` });
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);

await page.goto('http://localhost:5174/');
// Headless Chrome only finishes async shader compiles once the canvas is
// visible (headful Chrome finishes behind the intro pages), so click through
// like a person and wait for the store afterwards.
await page.waitForFunction(() => window.endermax, null, { timeout: 60000 });
await shot('1-front');

await page.click('#front-page').catch(() => {});
await page.waitForTimeout(800);
await shot('2-landing');
await page.click('.btn-explore').catch(() => {});
await page.waitForTimeout(800);
await shot('3-intro');

// Click through the intro modal's primary buttons until it closes.
for (let i = 0; i < 8 && await visible('#intro-modal:not(.hidden)'); i++) {
    const btn = page.locator('#intro-modal button:visible').last();
    if (!(await btn.count())) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
}
await page.waitForFunction(() => window.endermax?.ready, null, { timeout: 60000 });
await shot('4-tutorial');

// Real input: look around, walk forward, turn.
const before = await page.evaluate(() => window.endermax.pose(undefined));
await page.mouse.move(640, 300);
for (let i = 0; i < 20; i++) await page.mouse.move(400 + i * 25, 280 + (i % 5) * 10);
await page.keyboard.down('w');
await page.waitForTimeout(1200);
await page.keyboard.up('w');
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowLeft');
await page.mouse.move(900, 330);
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ pose: window.endermax.pose(undefined), stats: window.endermax.stats(), gaze: window.currentGazeTarget?.userData ?? null, maxHeat: window.endermax.heat.maxHeat }));
await shot('5-walking');

const onboarding = await page.evaluate(() => document.getElementById('onboarding-text')?.textContent);
console.log(JSON.stringify({ before, after, onboarding, errors: [...new Set(errors)].slice(0, 15) }, null, 2));
await browser.close();
