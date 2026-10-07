// Headless visual check: opens the running dev server, waits for the sim, and
// runs window.endermax.tour() so every camera preset lands in .shots/.
//
//   npm run shots -- [prefix] [--url=http://localhost:5174] [--query=heat=demo] [--webgl]
//
// Prints the backend, perf counters, console errors, and saved file paths.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const prefix = args.find(a => !a.startsWith('--')) || 'shot';
const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const base = opt('url', 'http://localhost:5174');
const query = opt('query', 'heat=demo');
const forceWebGL = args.includes('--webgl');
const eval_ = opt('eval', '');

const browser = await chromium.launch({
    headless: true,
    args: forceWebGL ? [] : ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const url = `${base}/?skip&${query}${forceWebGL ? '&webgl' : ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.endermax, null, { timeout: 30000 });
await page.evaluate(() => window.endermax.frames(20));
if (eval_) console.log('eval:', await page.evaluate(eval_));
const stats = await page.evaluate(() => window.endermax.stats());
const files = await page.evaluate((p) => window.endermax.tour(p), prefix);
console.log(JSON.stringify({ url, stats, files, errors: [...new Set(errors)].slice(0, 15) }, null, 2));
await browser.close();
