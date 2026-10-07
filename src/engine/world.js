// Builds the store from the parsed layout. Contiguous fixtures become a few
// merged meshes (tens of draw calls instead of ~3,700 cubes); gaze hits are
// mapped back to layout cells by hit point, so heat keys match v1 exactly.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT } from './layout.js';
import { createMaterials, paint, paintRange, PALETTE } from './materials.js';

const textureUrls = import.meta.glob('../assets/textures/**/*.{webp,png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' });
// Matted shelf photos (npm run textures) take precedence over the originals.
const shelfUrls = import.meta.glob('../assets/shelves/*.webp', { eager: true, query: '?url', import: 'default' });
const modelUrls = import.meta.glob('../assets/textures/**/*.glb', { eager: true, query: '?url', import: 'default' });

function urlFor(globbed, id) {
    for (const [path, url] of Object.entries(globbed)) if (path.includes(`/textures/${id}/`)) return url;
    return null;
}

const Y_TOP_WALL = 10.5 * UNIT;   // top of level 10
const Y_KICK = 0.5 * UNIT;        // bottom of level 1: below this is the kick plate

// BoxGeometry has 4 vertices per face, faces ordered +x,-x,+y,-y,+z,-z.
function remapFaceUVs(geo, faces, r) {
    const uvs = geo.attributes.uv;
    for (const f of faces) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uvs.setXY(i, r.u0 + uvs.getX(i) * (r.u1 - r.u0), r.v0 + uvs.getY(i) * (r.v1 - r.v0));
    }
    uvs.needsUpdate = true;
}

function boxAt(geo, x, y, z) {
    geo.translate(x, y, z);
    return geo;
}

export function buildWorld(layout, heatNodes, { loadItems = true } = {}) {
    const group = new THREE.Group();
    group.name = 'store';

    // Wall imagery (one atlas) and sign labels (another): see materials.js.
    const shelfImageUrls = new Map();
    for (const p of layout.panels) {
        if (p.kind !== 'wall' || shelfImageUrls.has(p.id)) continue;
        const matted = Object.entries(shelfUrls).find(([path]) => path.endsWith(`/shelves/${p.id}.webp`));
        const url = matted ? matted[1] : urlFor(textureUrls, p.id);
        if (url) shelfImageUrls.set(p.id, url);
    }
    const signLabel = (p) => p.label || layout.imageSettings.get(p.id)?.label || '';
    const signAspect = (p) => (p.span * UNIT) / ((p.band[1] - p.band[0] + 1) * UNIT);
    const signList = layout.panels.filter(p => p.kind === 'sign').map(p => ({ label: signLabel(p), aspect: signAspect(p) }));
    const W = (l) => (window.__worldTimes ||= []).push([l, Math.round(performance.now())]);
    W('start');
    const mats = createMaterials(heatNodes, { shelfUrls: shelfImageUrls, signList }, layout);
    W('materials');

    // Everything static is painted (vertex attributes) and merged into two
    // meshes sharing ONE material: shadow casters and non-casters.
    const casters = [];
    const others = [];
    const FIX = { rough: 0.62 };
    // Raycasts (gaze, camera arm) hit invisible box proxies, never the merged
    // render meshes: the store is boxes, and testing 12 triangles per fixture
    // instead of every bevel triangle took gaze from ~9ms to well under 1ms.
    const raycastTargets = [];
    const addProxy = (sx, sy, sz, x, y, z, userData = {}) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), PROXY_MATERIAL);
        p.position.set(x, y, z);
        p.userData = userData;
        p.updateMatrixWorld(true);
        raycastTargets.push(p);
        return p;
    };

    // Wall columns: rounded boxes floor to top of level 10.
    for (const r of layout.columns) {
        const w = (r.gx1 - r.gx0 + 1) * UNIT;
        const d = (r.gz1 - r.gz0 + 1) * UNIT;
        const cx = (r.gx0 + r.gx1) / 2 * UNIT;
        const cz = (r.gz0 + r.gz1) / 2 * UNIT;
        casters.push(paint(boxAt(new RoundedBoxGeometry(w, Y_TOP_WALL - Y_KICK, d, 1, 0.035), cx, (Y_TOP_WALL + Y_KICK) / 2, cz), PALETTE.fixture, FIX));
        addProxy(w, Y_TOP_WALL, d, cx, Y_TOP_WALL / 2, cz);
        casters.push(paint(boxAt(new THREE.BoxGeometry(w - 0.02, Y_KICK, d - 0.02), cx, Y_KICK / 2, cz), KICK, { rough: 0.5, metal: 0.2 }));
        casters.push(paint(boxAt(new RoundedBoxGeometry(w + 0.05, 0.07, d + 0.05, 1, 0.02), cx, Y_TOP_WALL + 0.035, cz), TRIM, { rough: 0.35, metal: 0.1 }));
    }

    // Product walls and hanging signs: one box each, imagery on the broad faces.
    for (const p of layout.panels) {
        const horizontal = p.orientation === 'horizontal';
        const spanLen = p.span * UNIT;
        const cx = (p.gx0 + p.gx1) / 2 * UNIT;
        const cz = (p.gz0 + p.gz1) / 2 * UNIT;
        const isSign = p.kind === 'sign';
        const thick = isSign ? 0.1 : UNIT;
        const y0 = isSign ? (p.band[0] - 0.5) * UNIT : Y_KICK;
        const y1 = (p.band[1] + 0.5) * UNIT;
        const sx = horizontal ? thick : spanLen;
        const sz = horizontal ? spanLen : thick;

        const geo = new THREE.BoxGeometry(sx, y1 - y0, sz);
        paint(geo, isSign ? PALETTE.accent : PALETTE.fixture, isSign ? { rough: 0.4, metal: 0.1 } : FIX);
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
        // Default per-face UVs reproduce v1's mapping (back face mirrored so
        // it reads right); remap the two image faces into the atlas.
        const faces = horizontal ? [0, 1] : [4, 5];
        remapFaceUVs(geo, faces, isSign ? mats.signRect(signLabel(p), signAspect(p)) : mats.imageRect(p.id));
        for (const f of faces) paintRange(geo, f * 4, 4, isSign ? { tex: 1, rough: 0.4, metal: 0, glow: 0.12 } : { tex: 1, rough: 0.55 });
        geo.translate(cx, (y0 + y1) / 2, cz);
        (isSign ? others : casters).push(geo);
        addProxy(sx, isSign ? y1 - y0 : y1, sz, cx, isSign ? (y0 + y1) / 2 : y1 / 2, cz, { kind: p.kind });

        if (!isSign) {
            casters.push(paint(boxAt(new THREE.BoxGeometry(sx - 0.02, Y_KICK, sz - 0.02), cx, Y_KICK / 2, cz), KICK, { rough: 0.5, metal: 0.2 }));
            // Cap that overhangs a touch, like a gondola top shelf.
            casters.push(paint(boxAt(new RoundedBoxGeometry(sx + 0.05, 0.07, sz + 0.05, 1, 0.02), cx, Y_TOP_WALL + 0.035, cz), TRIM, { rough: 0.35, metal: 0.1 }));
        } else {
            others.push(paint(boxAt(new THREE.BoxGeometry(sx + 0.03, 0.05, sz + 0.03), cx, y1 + 0.025, cz), PALETTE.accent, { rough: 0.4, metal: 0.1 }));
        }
    }

    // Hangers: slim rods from the sign up to the ceiling.
    for (const h of layout.hangers) {
        const y0 = 13 * UNIT;
        const y1 = SHELL.ceiling;
        others.push(paint(boxAt(new THREE.CylinderGeometry(0.018, 0.018, y1 - y0, 8), h.gx * UNIT, (y0 + y1) / 2, h.gz * UNIT), METAL, { rough: 0.3, metal: 0.9 }));
        addProxy(0.08, y1 - y0, 0.08, h.gx * UNIT, (y0 + y1) / 2, h.gz * UNIT);
    }

    // Open shelving units ('e'): boards at each level plus uprights.
    for (const s of layout.shelves) {
        for (const lvl of layout.bands.shelfLevels) {
            casters.push(paint(boxAt(new THREE.BoxGeometry(UNIT, 0.05, UNIT), s.gx * UNIT, lvl * UNIT, s.gz * UNIT), PALETTE.fixture, FIX));
        }
        casters.push(paint(boxAt(new THREE.BoxGeometry(0.04, Y_TOP_WALL, 0.04), s.gx * UNIT, Y_TOP_WALL / 2, s.gz * UNIT), METAL, { rough: 0.3, metal: 0.9 }));
        addProxy(UNIT, Y_TOP_WALL, UNIT, s.gx * UNIT, Y_TOP_WALL / 2, s.gz * UNIT);
    }
    for (const t of layout.talls) {
        casters.push(paint(boxAt(new RoundedBoxGeometry(UNIT, 4.5 * UNIT, UNIT, 2, 0.03), t.gx * UNIT, 2.25 * UNIT, t.gz * UNIT), PALETTE.fixture, FIX));
        addProxy(UNIT, 4.5 * UNIT, UNIT, t.gx * UNIT, 2.25 * UNIT, t.gz * UNIT);
    }

    // Shell: ceiling with LED strips and perimeter walls. All single-sided and
    // facing inward, so overview cameras outside/above see straight in.
    others.push(...buildShell());
    W('geometry');

    const addMerged = (geos, name, castShadow) => {
        if (!geos.length) return null;
        // Mixed index/non-index sources can't merge; normalize to non-indexed.
        const merged = mergeGeometries(geos.map(g => (g.index ? g.toNonIndexed() : g)), false);
        geos.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(merged, mats.store);
        mesh.name = name;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    };
    addMerged(casters, 'store-casters', true);
    addMerged(others, 'store-shell-signs', false);
    W('merged');

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120 * UNIT, 120 * UNIT), mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData = { type: 'ground' };
    floor.name = 'floor';
    group.add(floor);

    // Pickup items
    const items = [];
    const itemGroup = new THREE.Group();
    group.add(itemGroup);
    const world = { group, floor, items, itemsRoot: itemGroup, raycastTargets, materials: mats, cellFromHit: null, shadowsDirty: true };
    if (loadItems) loadPickupItems(layout, itemGroup, items, () => { world.shadowsDirty = true; });

    // --- Hit -> cell mapping ------------------------------------------------
    const _n = new THREE.Vector3();
    function cellFromHit(hit) {
        if (!hit || !hit.face) return null;
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        const p = hit.point;
        const gx = Math.round((p.x - _n.x * 0.02) / UNIT);
        let gy = Math.round((p.y - _n.y * 0.02) / UNIT);
        const gz = Math.round((p.z - _n.z * 0.02) / UNIT);
        // The kick plate (y < level 1) and rods between levels snap to the
        // nearest real cell in that column.
        for (let dy = 0; dy <= 2; dy++) {
            for (const y of dy ? [gy + dy, gy - dy] : [gy]) {
                const c = layout.cells.get(`${gx},${y},${gz}`);
                if (c) return c;
            }
        }
        return null;
    }

    world.cellFromHit = cellFromHit;
    return world;
}

export const SHELL = { half: 30, ceiling: 21.5 * UNIT };
const KICK = '#4a4a55', TRIM = '#dedee3', METAL = '#9aa0a6';

function buildShell() {
    const { half, ceiling } = SHELL;
    const out = [];

    // Dark open ceiling: makes the LED runs pop and frames every shot.
    const ceil = new THREE.PlaneGeometry(half * 2, half * 2);
    ceil.rotateX(Math.PI / 2); // faces down
    ceil.translate(0, ceiling, 0);
    out.push(paint(ceil, '#3a3942', { rough: 0.95 }));

    // Linear LED fixtures: self-lit white.
    for (let x = -24; x <= 24; x += 6) {
        for (let z = -24; z <= 24; z += 12) {
            const g = new THREE.PlaneGeometry(0.28, 8);
            g.rotateX(Math.PI / 2);
            g.translate(x, ceiling - 0.02, z);
            out.push(paint(g, '#ffffff', { rough: 1, glow: 4 }));
        }
    }

    // Walls: warm gray with a dark baseboard and a thin brand band.
    const sides = [
        { pos: [0, 0, -half], rotY: 0 },
        { pos: [0, 0, half], rotY: Math.PI },
        { pos: [-half, 0, 0], rotY: Math.PI / 2 },
        { pos: [half, 0, 0], rotY: -Math.PI / 2 }
    ];
    for (const s of sides) {
        const plane = (h, y, hex, opts, inset = 0) => {
            const g = new THREE.PlaneGeometry(half * 2, h);
            g.translate(0, y, inset);
            g.rotateY(s.rotY);
            g.translate(...s.pos);
            out.push(paint(g, hex, opts));
        };
        plane(ceiling, ceiling / 2, '#e7e3dc', { rough: 0.85 });
        plane(0.3, 0.15, '#2f2f3a', { rough: 0.6 }, 0.01);
        plane(0.12, 7.2, '#4f46e5', { rough: 0.5, glow: 0.15 }, 0.01);
    }
    return out;
}

const PROXY_MATERIAL = new THREE.MeshBasicNodeMaterial({ visible: false });

function loadPickupItems(layout, parent, items, onLoaded) {
    const loader = new GLTFLoader();
    for (const it of layout.items) {
        const url = urlFor(modelUrls, it.id);
        const userData = { type: 'item', id: it.id, label: it.label, isPickup: true, gridX: it.gx, gridZ: it.gz };
        const anchor = new THREE.Group();
        anchor.position.set(it.gx * UNIT, 0, it.gz * UNIT);
        anchor.userData = userData;
        parent.add(anchor);
        items.push(anchor);
        // Cheap gaze proxy (models can be tens of thousands of triangles).
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.75), PROXY_MATERIAL);
        proxy.position.set(anchor.position.x, 0.35, anchor.position.z);
        proxy.userData = userData;
        proxy.updateMatrixWorld(true);
        anchor.userData = { ...userData, proxy };

        // Pickup marker: a soft accent ring on the floor.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.42, 0.5, 48),
            new THREE.MeshBasicNodeMaterial({ color: '#6d64ff', transparent: true, opacity: 0.85, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.005;
        ring.name = 'pickup-ring';
        anchor.add(ring);

        if (!url) {
            const fallback = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), new THREE.MeshStandardNodeMaterial({ color: '#ffd24a' }));
            fallback.position.y = 0.3;
            fallback.userData = userData;
            anchor.add(fallback);
            continue;
        }
        loader.load(url, (gltf) => {
            const model = gltf.scene;
            // Fit any model to ~0.6 world units tall, sitting on the floor.
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const s = 0.6 / Math.max(size.y, size.x, size.z, 1e-3);
            model.scale.setScalar(s);
            box.setFromObject(model);
            model.position.y -= box.min.y;
            model.traverse(n => {
                if (!n.isMesh) return;
                n.castShadow = true; n.receiveShadow = true; n.userData = userData;
                // One simple material type for all item models (fewer shaders).
                const old = n.material;
                n.material = new THREE.MeshStandardNodeMaterial({ map: old.map || null, color: old.color || '#ffffff', roughness: 0.6, metalness: 0 });
            });
            anchor.add(model);
            onLoaded?.();
        }, undefined, (e) => console.warn(`Item model ${it.id} failed to load`, e));
    }
}
