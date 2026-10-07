// Builds the store from the parsed layout. Contiguous fixtures become a few
// merged meshes (tens of draw calls instead of ~3,700 cubes); gaze hits are
// mapped back to layout cells by hit point, so heat keys match v1 exactly.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT } from './layout.js';
import { createMaterials, loadTexture } from './materials.js';

const textureUrls = import.meta.glob('../assets/textures/**/*.{webp,png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' });
const modelUrls = import.meta.glob('../assets/textures/**/*.glb', { eager: true, query: '?url', import: 'default' });

function urlFor(globbed, id) {
    for (const [path, url] of Object.entries(globbed)) if (path.includes(`/textures/${id}/`)) return url;
    return null;
}

const Y_TOP_WALL = 10.5 * UNIT;   // top of level 10
const Y_KICK = 0.5 * UNIT;        // bottom of level 1: below this is the kick plate

function boxAt(geo, x, y, z) {
    geo.translate(x, y, z);
    return geo;
}

export function buildWorld(layout, heatNodes, { loadItems = true } = {}) {
    const group = new THREE.Group();
    group.name = 'store';

    const textures = new Map();
    for (const id of layout.imageSettings.keys()) {
        const url = urlFor(textureUrls, id);
        if (url) textures.set(id, loadTexture(url));
    }
    const mats = createMaterials(heatNodes, textures);

    const fixtureGeos = [];
    const baseGeos = [];
    const metalGeos = [];
    const accentGeos = [];
    const raycastTargets = [];

    // Wall columns: rounded boxes floor to top of level 10.
    for (const r of layout.columns) {
        const w = (r.gx1 - r.gx0 + 1) * UNIT;
        const d = (r.gz1 - r.gz0 + 1) * UNIT;
        const cx = (r.gx0 + r.gx1) / 2 * UNIT;
        const cz = (r.gz0 + r.gz1) / 2 * UNIT;
        fixtureGeos.push(boxAt(new RoundedBoxGeometry(w, Y_TOP_WALL - Y_KICK, d, 2, 0.035), cx, (Y_TOP_WALL + Y_KICK) / 2, cz));
        baseGeos.push(boxAt(new THREE.BoxGeometry(w - 0.02, Y_KICK, d - 0.02), cx, Y_KICK / 2, cz));
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
        const edgeMat = isSign ? mats.accent : mats.fixture;
        const img = mats.image(p.id);
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Default per-face UVs
        // already reproduce v1's mapping (back face mirrored so it reads right).
        const faceMats = horizontal
            ? [img, img, edgeMat, edgeMat, edgeMat, edgeMat]
            : [edgeMat, edgeMat, edgeMat, edgeMat, img, img];
        const mesh = new THREE.Mesh(geo, faceMats);
        mesh.position.set(cx, (y0 + y1) / 2, cz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.kind = p.kind;
        group.add(mesh);
        raycastTargets.push(mesh);

        if (!isSign) {
            baseGeos.push(boxAt(new THREE.BoxGeometry(sx - 0.02, Y_KICK, sz - 0.02), cx, Y_KICK / 2, cz));
            // Cap that overhangs a touch, like a gondola top shelf.
            fixtureGeos.push(boxAt(new RoundedBoxGeometry(sx + 0.06, 0.06, sz + 0.06, 1, 0.02), cx, Y_TOP_WALL + 0.03, cz));
        } else {
            accentGeos.push(boxAt(new THREE.BoxGeometry(sx + 0.03, 0.05, sz + 0.03), cx, y1 + 0.025, cz));
        }
    }

    // Hangers: slim rods from the sign up toward the ceiling line.
    for (const h of layout.hangers) {
        const y0 = 13 * UNIT;
        const y1 = 20.5 * UNIT;
        metalGeos.push(boxAt(new THREE.CylinderGeometry(0.018, 0.018, y1 - y0, 8), h.gx * UNIT, (y0 + y1) / 2, h.gz * UNIT));
    }

    // Open shelving units ('e'): boards at each level plus uprights.
    for (const s of layout.shelves) {
        for (const lvl of layout.bands.shelfLevels) {
            fixtureGeos.push(boxAt(new THREE.BoxGeometry(UNIT, 0.05, UNIT), s.gx * UNIT, lvl * UNIT, s.gz * UNIT));
        }
        metalGeos.push(boxAt(new THREE.BoxGeometry(0.04, Y_TOP_WALL, 0.04), s.gx * UNIT, Y_TOP_WALL / 2, s.gz * UNIT));
    }
    for (const t of layout.talls) {
        fixtureGeos.push(boxAt(new RoundedBoxGeometry(UNIT, 4.5 * UNIT, UNIT, 2, 0.03), t.gx * UNIT, 2.25 * UNIT, t.gz * UNIT));
    }

    const addMerged = (geos, material, name) => {
        if (!geos.length) return null;
        // Mixed index/non-index sources can't merge; normalize to non-indexed.
        const merged = mergeGeometries(geos.map(g => (g.index ? g.toNonIndexed() : g)), false);
        geos.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(merged, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        raycastTargets.push(mesh);
        return mesh;
    };
    addMerged(fixtureGeos, mats.fixture, 'fixtures');
    addMerged(baseGeos, mats.base, 'kickplates');
    addMerged(accentGeos, mats.accent, 'sign-trim');
    addMerged(metalGeos, mats.metal, 'hardware');

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
    if (loadItems) loadPickupItems(layout, itemGroup, items);

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

    return { group, floor, items, itemsRoot: itemGroup, raycastTargets, materials: mats, cellFromHit };
}

function loadPickupItems(layout, parent, items) {
    const loader = new GLTFLoader();
    for (const it of layout.items) {
        const url = urlFor(modelUrls, it.id);
        const userData = { type: 'item', id: it.id, label: it.label, isPickup: true, gridX: it.gx, gridZ: it.gz };
        const anchor = new THREE.Group();
        anchor.position.set(it.gx * UNIT, 0, it.gz * UNIT);
        anchor.userData = userData;
        parent.add(anchor);
        items.push(anchor);

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
                if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.userData = userData; }
            });
            anchor.add(model);
        }, undefined, (e) => console.warn(`Item model ${it.id} failed to load`, e));
    }
}
