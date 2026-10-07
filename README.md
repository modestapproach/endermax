# Endermax

A browser-based mixed-reality shopper-research simulator. A participant walks a 3D
grocery store. Endermax records where they look (gaze heat), where they walk, what
they say (voice to transcript), and how they feel (webcam emotion). Researchers then
replay the session in 3D with an AI summary.

Live: [endermax.com](https://endermax.com)

## What's new in v2

v2 is a rebuild of the 3D layer. The research flow and data format are unchanged.

| | v1 | v2 |
|---|---|---|
| Renderer | three r160 `WebGLRenderer` | three r186 `WebGPURenderer` (automatic WebGL2 fallback) |
| Store geometry | ~3,700 individual cubes, one material each | Layout merged into a few dozen meshes |
| Gaze heat | Per-cube material tint | 3D heat texture sampled per pixel in TSL: smooth glow, contour lines, desaturated base |
| Lighting | Flat ambient + 4 directional lights | Image-based lighting, near-overhead soft shadows, LED ceiling, GTAO, bloom, SSR floor |
| Occlusion | Hide whole blocks between camera and player | Shader "lens" cut-away around the shopper, plus a spring-arm camera |
| Shopper | Cylinders and spheres | Designed mannequin with an MR headset, walk cycle, head tracking, gaze beam and reticle |
| Movement | Walks through shelves | Fixture collision with sliding |
| Bird's-eye snapshots | A second WebGL renderer | 2D plan map: heat field, path, view cone, legend |
| Results replay | WASD fly camera | Orbit/zoom/pan, emotion pins, ghost shopper with gaze |

Recorded heat still uses v1's `"gx,gy,gz"` grid keys, so v1 sessions replay in v2.

## Quick start

```bash
npm install
npm run dev            # http://127.0.0.1:5173
```

Server-side AI (transcription, summary, TTS) needs `OPENAI_API_KEY` and
`ELEVENLABS_API_KEY`. Put them in `.env` (as the `VITE_` variants) for the dev proxy,
or in Cloudflare Pages settings for production. Never commit them.

## Dev tooling: a shared language for the 3D scene

v2 is built around a tight feedback loop. Any view of the store can be reproduced
from a URL or a console call and saved as a real PNG.

URL flags:

- `?skip` jumps straight into the sim, skipping the front page, intro and tutorial.
- `?cam=hero|aisle|fp|iso|wide|top` starts from a camera preset.
- `?heat=demo` fills the store with synthetic gaze heat.
- `?hud` shows a perf overlay (backend, fps, draw calls).
- `?webgl` forces the WebGL2 backend.

Console (`window.endermax`):

```js
endermax.cam('aisle')                 // camera presets
endermax.pose({ x: -1, z: 20, yaw: 0 })
endermax.demoHeat()                   // synthetic heat
await endermax.shot('my-view')        // -> .shots/my-view.png (dev server)
await endermax.tour('review')         // every preset + plan + contact sheet
await endermax.simulateSession()      // scripted shopper run saved as a real session
endermax.stats()
```

Scripts (run with the dev server up; they use headless Chromium with WebGPU):

```bash
npm run shots -- <prefix> [--webgl] [--page]   # preset tour -> .shots/<prefix>-sheet.jpg
npm run flow                                   # real onboarding + keyboard/mouse input
npm run e2e                                    # simulated session -> results -> 3D replay
npm run textures                               # re-matte shelf photos into src/assets/shelves
```

## Architecture

```
src/engine/
  layout.js     layout.txt + image-settings.txt -> pure data (cells, panels, columns)
  heat.js       HeatField (CPU accumulation -> Data3DTexture) + TSL heat nodes
  materials.js  node materials: heat tint, contours, cut-away lens, signs, floor
  world.js      merged fixture meshes, store shell, items, hit -> cell mapping
  renderer.js   WebGPURenderer, lighting, RenderPipeline (GTAO, SSR, bloom, vignette)
  character.js  shopper mannequin, walk cycle, gaze beam, reticle, emotion badge
  planMap.js    2D plan snapshots
  devtools.js   URL flags, window.endermax, presets, tour/contact sheets
src/main.js         sim loop, capture, test flow, session simulator
src/interaction.js  input, movement + collision, camera rig, gaze, cut-away
src/viewer.js       results 3D replay
```

To change the store, edit `layout.txt` (the grid) and `image-settings.txt` (what each
character means). Everything downstream, including heat, collision, the plan map and
the replay, derives from those two files.

## Deploy

See [how-to-deploy.md](how-to-deploy.md). In short: `npm run build`, then
`npx wrangler pages deploy dist --project-name endermax --branch master`.

## Known limitations

- The Cloudflare API functions have no auth. Rate-limit them in the Cloudflare
  dashboard if quota abuse becomes a problem.
- Mic, camera and AI paths need a real browser session to verify end to end. The
  simulator covers gaze, heat, path, snapshots and replay.
- Tutorial steps 8–9 can still dead-end if camera access is denied mid-flow.
