# Stability Notes — endermax-v3 (2026-08-27)

This folder was copied from `endermax` (branch `3D-analysis`, last commit Dec 9 2025,
the most recent of the three endermax folders) and then hardened in staged commits.
Each stage was built and smoke-tested in the browser before the next began.

## Verified stable (tested live in the dev server)

- Landing page → demo overlay → intro slides → tutorial → 3D sim flow (full funnel)
- WebP landing image and all six WebP shelf textures load and render (noticeably
  richer colors now that textures are tagged sRGB)
- Movement (held keys), drag-to-rotate, gaze ray, heat accumulation on shelves
- Tutorial button choreography (Enable Mic → Record → Enable Cam reveal/hide) —
  this was silently broken before the missing `.hidden` CSS rule was added
- Skip Step path through permissions (mic/cam can be skipped; recording now
  continues without audio instead of aborting)
- Results page empty state (new) and production build (`npm run build`) green
- Portfolio page at `/portfolio.html` (new)

## Changed behavior — intentional, worth knowing

- **First-person heat rate** was 4x hotter than third-person and saturated a block
  in ~83ms; both modes now share the same per-second rates (fixes near-binary
  first-person heatmaps). Recorded heat data is now comparable across modes.
- **Movement/rotation/heat are delta-time scaled** — speed no longer depends on
  monitor refresh rate (was 2.4x faster at 144Hz).
- **Both camera modes use the 6-stop gradient** (white→blue→green→yellow→orange→red)
  matching the on-screen legend; first person previously used a different HSL scheme.
- **Blocks no longer cast shadows** (invisible under 0.9 ambient light; halves
  draw calls). Person/ground shadows unchanged.
- **DB wipe moved from page load to test start** — reloading the sim no longer
  destroys the last recorded session.
- **Opposing movement keys now cancel** (W+S previously sped you up — vector
  mutation bug).
- **Player is clamped to the 60x60 floor** (could previously walk off the map).
- **View Results** without the chicken asks to confirm instead of hard-blocking.
- **AI summary is persisted per session** — revisiting results doesn't re-call OpenAI.

## Not yet verified end-to-end (needs a real mic/cam session)

- Full recorded session → transcription → AI summary → 3D replay round trip
  (code paths reviewed and hardened, but the sandbox browser has no mic/cam;
  run one real session before demoing)
- Dexie v3 schema migration on a browser holding old v2 data (fresh profiles fine)

## Known remaining issues (documented, not fixed)

- ~3,700 meshes still render individually; InstancedMesh would be the next big
  perf win (see audit notes in git history)
- The three Cloudflare functions validate/cap payloads now but have no auth —
  anyone who finds the endpoints can spend API quota (rate-limit via Cloudflare
  dashboard if it becomes a problem)
- API keys that were committed to git history should be **rotated**
- Tutorial steps 8–9 can still dead-end if camera is denied mid-flow
- No session picker on results (always shows the latest session)
