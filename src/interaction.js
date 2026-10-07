import * as THREE from 'three/webgpu';
import { EYE_HEIGHT } from './engine/character.js';
import { cutout } from './engine/materials.js';

// --- Input state -----------------------------------------------------------
let mouseX = 0, mouseY = 0;
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;
let yaw = 0;      // body/camera heading (radians); forward is local -Z
let pitch = 0;    // drag pitch, clamped
const keys = { w: false, a: false, s: false, d: false, arrowUp: false, arrowDown: false, arrowLeft: false, arrowRight: false, space: false };
// World units per 60fps frame (Settings slider). v1 moved 0.2 per *rendered*
// frame, which on the machines it ran on (~30fps) was ~6 units/s; 0.1 here
// reproduces that speed at any frame rate.
let moveSpeed = 0.1;
let isFirstPerson = false;
let gazeEnabled = true;
let ctx = null; // { camera, character, world, heat, inventory }

const currentGaze = { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) };

export function getCurrentGaze() {
    return { origin: currentGaze.origin.clone(), direction: currentGaze.direction.clone() };
}
export function setGazeEnabled(enabled) { gazeEnabled = enabled; }
export function getIsDragging() { return isDragging; }
export function getIsFirstPerson() { return isFirstPerson; }
// v1 used one 90° camera for both modes; the wide lens is part of the feel.
export const FOV = { third: 90, first: 90 };
export function getDesiredFov() { return isFirstPerson ? FOV.first : FOV.third; }

// Dev/automation hooks (window.endermax) — direct pose control.
export function setPose({ x, z, yaw: y, pitch: p } = {}) {
    if (!ctx) return;
    const person = ctx.character.person;
    if (x !== undefined) person.position.x = x;
    if (z !== undefined) person.position.z = z;
    if (y !== undefined) yaw = y;
    if (p !== undefined) pitch = p;
    person.rotation.y = yaw;
    snapCamera = true;
}
export function setPointer(nx, ny) { mouseX = nx; mouseY = ny; }
export function setFirstPerson(on) {
    if (on !== isFirstPerson) document.getElementById('cameraToggle')?.click();
    if (on !== isFirstPerson) { isFirstPerson = on; snapCamera = true; }
}
export function getPose() {
    const p = ctx?.character.person.position;
    return p ? { x: p.x, z: p.z, yaw, pitch, firstPerson: isFirstPerson } : null;
}

// Floor-standing fixture footprint ("gx,gz" -> true) for player collision.
let blocked = new Set();
const PLAYER_RADIUS = 0.38;

export function setupControls(context) {
    ctx = context;
    blocked = new Set();
    for (const c of ctx.layout.cells.values()) if (c.gy <= 10) blocked.add(`${c.gx},${c.gz}`);
    // v1 input model: a drag can start anywhere on the page (overlays included).
    document.addEventListener('mousedown', onPointerDown, false);
    document.addEventListener('mousemove', onPointerMove, false);
    document.addEventListener('mouseup', () => { isDragging = false; }, false);
    document.addEventListener('keydown', (e) => setKey(e, true), false);
    document.addEventListener('keyup', (e) => setKey(e, false), false);
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
}

function setKey(event, down) {
    switch (event.key.toLowerCase()) {
        case 'w': keys.w = down; break;
        case 'a': keys.a = down; break;
        case 's': keys.s = down; break;
        case 'd': keys.d = down; break;
        case 'arrowup': keys.arrowUp = down; break;
        case 'arrowdown': keys.arrowDown = down; break;
        case 'arrowleft': keys.arrowLeft = down; break;
        case 'arrowright': keys.arrowRight = down; break;
        case ' ': keys.space = down; break;
    }
}

function onPointerDown(event) {
    // As in v1 any mousedown starts a view drag — except on form controls,
    // where a drag would fight the control.
    if (event.target?.closest?.('button, input, select, textarea, a, label')) return;
    isDragging = true;
    previousMouseX = event.clientX;
    previousMouseY = event.clientY;
}

function onPointerMove(event) {
    if (isDragging) {
        const dx = event.clientX - previousMouseX;
        const dy = event.clientY - previousMouseY;
        yaw -= dx * 0.005;
        pitch += (isFirstPerson ? -dy : dy) * 0.005;
        pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
        previousMouseX = event.clientX;
        previousMouseY = event.clientY;
    } else {
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    }
}

// --- UI wiring (settings panel, camera toggle) -----------------------------
export function attachUIHandlers(heat) {
    document.getElementById('resetBtn')?.addEventListener('click', () => heat.reset());

    const decayToggle = document.getElementById('decayToggle');
    decayToggle?.addEventListener('change', (e) => {
        heat.decay = e.target.checked;
        const status = document.getElementById('decayStatus');
        if (status) status.textContent = heat.decay ? 'ON' : 'OFF';
    });

    document.getElementById('aoeSlider')?.addEventListener('input', (e) => {
        heat.aoeRadius = parseFloat(e.target.value);
        const display = document.getElementById('aoeValue');
        if (display) display.textContent = e.target.value;
    });

    document.getElementById('speedSlider')?.addEventListener('input', (e) => {
        moveSpeed = parseFloat(e.target.value);
        const display = document.getElementById('speedValue');
        if (display) display.textContent = e.target.value;
    });

    document.getElementById('resetTutorialBtn')?.addEventListener('click', () => {
        localStorage.removeItem('onboardingCompleted');
        window.location.reload();
    });

    const settingsToggle = document.getElementById('settingsToggle');
    const controlsPanel = document.getElementById('controlsPanel');
    if (settingsToggle && controlsPanel) {
        settingsToggle.addEventListener('click', () => {
            controlsPanel.classList.toggle('visible');
            settingsToggle.innerHTML = controlsPanel.classList.contains('visible')
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Hide Settings`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path></svg> Settings`;
        });
    }

    const cameraToggle = document.getElementById('cameraToggle');
    const headsetOverlay = document.getElementById('headset-overlay');
    if (cameraToggle) {
        cameraToggle.addEventListener('click', () => {
            isFirstPerson = !isFirstPerson;
            snapCamera = true;
            cameraToggle.classList.toggle('active', isFirstPerson);
            headsetOverlay?.classList.toggle('visible', isFirstPerson);
            document.getElementById('canvas')?.classList.toggle('first-person-cursor', isFirstPerson);
            document.body.classList.toggle('first-person-cursor', isFirstPerson);
            window.dispatchEvent(new CustomEvent('cameraModeChanged', { detail: { isFirstPerson } }));
            cameraToggle.innerHTML = isFirstPerson
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg> Third Person`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> First Person`;
        });
    }
}

// --- Movement ----------------------------------------------------------------
const WORLD_BOUND = 29;
let currentSpeed = 0;

export function updateMovement(dt) {
    if (!ctx) return;
    const person = ctx.character.person;

    // v1 movement: instant (no acceleration), rates tuned at 60fps and
    // dt-scaled. Forward/right steps add independently, as in v1.
    const timeScale = dt * 60;
    const step = moveSpeed * timeScale;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);   // v1 "_forward" (points behind)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);  // right
    let mx = 0, mz = 0;
    if (keys.w || keys.arrowUp) { mx -= fx * step; mz -= fz * step; }
    if (keys.s || keys.arrowDown) { mx += fx * step; mz += fz * step; }
    if (keys.a) { mx -= rx * step; mz -= rz * step; }
    if (keys.d) { mx += rx * step; mz += rz * step; }

    const rotationSpeed = 0.05 * timeScale;
    if (keys.arrowLeft) yaw += rotationSpeed;
    if (keys.arrowRight) yaw -= rotationSpeed;

    // Collision (v2): axis-separated so the shopper slides along shelves.
    const sub = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.2));
    for (let i = 0; i < sub; i++) {
        const nx = person.position.x + mx / sub;
        if (!collides(nx, person.position.z)) person.position.x = nx;
        const nz = person.position.z + mz / sub;
        if (!collides(person.position.x, nz)) person.position.z = nz;
    }
    person.position.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.x));
    person.position.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.z));
    currentSpeed = dt > 0 ? Math.hypot(mx, mz) / dt : 0;

    updateCamera();
    checkProximity(person);
}

function collides(x, z) {
    const U = 0.5, r = PLAYER_RADIUS;
    const g0x = Math.round((x - r) / U), g1x = Math.round((x + r) / U);
    const g0z = Math.round((z - r) / U), g1z = Math.round((z + r) / U);
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
        if (!blocked.has(`${gx},${gz}`)) continue;
        // Circle vs cell square
        const cx = Math.max(gx * U - U / 2, Math.min(x, gx * U + U / 2));
        const cz = Math.max(gz * U - U / 2, Math.min(z, gz * U + U / 2));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
}

// --- Camera rig (v1) ---------------------------------------------------------------
let snapCamera = true; // kept for API compatibility (v1 camera is never smoothed)
const _look = new THREE.Vector3();

function updateCamera() {
    const { camera } = ctx;
    const person = ctx.character.person;
    if (isFirstPerson) {
        // v1: camera at eye level looking along the body heading; drag pitch
        // raises/lowers the look target directly.
        const eyeHeight = EYE_HEIGHT;
        camera.position.set(person.position.x, person.position.y + eyeHeight, person.position.z);
        const flipped = yaw + Math.PI;
        _look.set(
            person.position.x + Math.sin(flipped),
            person.position.y + eyeHeight + pitch,
            person.position.z + Math.cos(flipped)
        );
        camera.lookAt(_look);
        person.rotation.y = yaw;
        person.visible = false;
        return;
    }
    person.visible = true;
    ctx.character.setFade(1);

    // v1 third person: 4.5 behind, 1.5 above the head, looking at the head;
    // drag pitch moves the camera up/down.
    const radius = 4.5;
    const heightOffset = 1.5;
    const targetY = person.position.y + EYE_HEIGHT;
    camera.position.set(
        person.position.x + radius * Math.sin(yaw),
        targetY + heightOffset + pitch * 2,
        person.position.z + radius * Math.cos(yaw)
    );
    camera.lookAt(person.position.x, targetY, person.position.z);
    person.rotation.y = yaw;
    snapCamera = false;
}

// --- Gaze ------------------------------------------------------------------------
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normal = new THREE.Vector3();
let _targets = null;
let _targetsItemCount = -1;

function gazeTargets() {
    // Fixture + item proxies (rebuilt when an item is picked up) and the floor.
    if (!_targets || _targetsItemCount !== ctx.world.items.length) {
        _targets = [...ctx.world.raycastTargets, ctx.world.floor, ...ctx.world.items.map(i => i.userData.proxy).filter(Boolean)];
        _targetsItemCount = ctx.world.items.length;
    }
    return _targets;
}

function gazeTargetFor(hit, cell) {
    if (!hit) return null;
    const ud = hit.object.userData;
    if (ud && ud.type === 'ground') return hit.object;
    if (ud && ud.type === 'item') return hit.object;
    if (!cell) return null;
    return { userData: { gridX: cell.gx, gridY: cell.gy, gridZ: cell.gz, isImageBlock: cell.isImageBlock, imageNum: cell.imageNum, label: cell.label, blockType: cell.blockType } };
}

let lastHitCell = null;
export function getLastHitCell() { return lastHitCell; }

export function updateGaze(dt) {
    if (!ctx) return;
    const { camera, character, world, heat } = ctx;
    const person = character.person;

    if (isDragging || !gazeEnabled) {
        character.setGaze(false);
        character.animate(dt, currentSpeed, 0, 0);
        lastHitCell = null;
        return;
    }

    _pointer.set(mouseX, mouseY);
    _raycaster.setFromCamera(_pointer, camera);
    _raycaster.far = 60;
    let hit = null;

    if (isFirstPerson) {
        const hits = _raycaster.intersectObjects(gazeTargets(), false);
        hit = hits[0] || null;
        currentGaze.origin.copy(_raycaster.ray.origin);
        currentGaze.direction.copy(_raycaster.ray.direction);
        character.setGaze(false);
    } else {
        // v1 gaze: the cursor's screen offset becomes a head-relative look
        // direction (about ±45° across, ±37° up/down), cast from the face.
        _dir.set(mouseX * 8, mouseY * 6, -8).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, person.rotation.y);
        _eye.set(0, EYE_HEIGHT, 0.35).applyMatrix4(person.matrixWorld); // v1's gaze origin
        currentGaze.origin.copy(_eye);
        currentGaze.direction.copy(_dir);
        _raycaster.set(_eye, _dir);
        const hits = _raycaster.intersectObjects(gazeTargets(), false);
        hit = hits[0] || null;
    }

    if (hit && hit.face) _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (!isFirstPerson) character.setGaze(true, currentGaze.origin, currentGaze.direction, hit, hit && hit.face ? _normal : null);

    // v1 head tracking: straight from the cursor offset.
    character.animate(dt, currentSpeed, -mouseX * 1.0, mouseY * 0.8);

    const isGround = hit && hit.object.userData.type === 'ground';
    const isItem = hit && hit.object.userData.type === 'item';
    const cell = hit && !isGround && !isItem ? world.cellFromHit(hit) : null;
    lastHitCell = cell;
    window.currentGazeTarget = hit ? gazeTargetFor(hit, cell)
        : (currentGaze.direction.y > 0.3 ? { userData: { type: 'sky' } } : null);

    heat.applyGaze(cell, hit ? hit.point : null, dt);
}

// --- See-through cutout ------------------------------------------------------------
// Like v1, the cut only opens when something actually blocks the camera's view
// of the shopper: rays from the camera to head, chest and feet are tested
// against the fixture proxies. It grows/shrinks smoothly instead of popping.
const _head = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _occRay = new THREE.Raycaster();
const PROBE_HEIGHTS = [EYE_HEIGHT, 1.6, 0.4];
let cutoutAmount = 0;

function shopperOccluded(camera, person) {
    for (const h of PROBE_HEIGHTS) {
        _probe.set(person.position.x, person.position.y + h, person.position.z);
        const dist = camera.position.distanceTo(_probe);
        _occRay.set(camera.position, _probe.sub(camera.position).normalize());
        _occRay.far = dist - 0.6; // ignore anything at/behind the shopper
        if (_occRay.intersectObjects(ctx.world.raycastTargets, false).length) return true;
    }
    return false;
}

export function updateCutout(dt = 1 / 60) {
    if (!ctx) return;
    const { camera } = ctx;
    if (isFirstPerson) { cutout.enabled.value = 0; cutoutAmount = 0; return; }
    const person = ctx.character.person;

    const target = shopperOccluded(camera, person) ? 1 : 0;
    cutoutAmount += (target - cutoutAmount) * Math.min(1, dt * (target ? 14 : 8));
    window.__cutoutAmount = cutoutAmount; // dev/e2e introspection
    if (cutoutAmount < 0.01) { cutout.enabled.value = 0; return; }

    _head.set(person.position.x, person.position.y + 1.6, person.position.z);
    const dist = camera.position.distanceTo(_head);
    const viewZ = _head.clone().applyMatrix4(camera.matrixWorldInverse).z;
    _head.project(camera);
    cutout.enabled.value = 1;
    cutout.center.value.set(_head.x * 0.5 + 0.5, 1 - (_head.y * 0.5 + 0.5));
    cutout.depth.value = viewZ;
    // Big enough to frame the whole figure (~3.1 units tall).
    cutout.radius.value = cutoutAmount * 1.9 / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// --- Items -------------------------------------------------------------------------
function checkProximity(person) {
    const prompt = document.getElementById('interaction-prompt');
    const promptText = document.getElementById('interaction-text');
    const items = ctx.world.items;
    let nearest = null;
    let minDistance = 2.5;
    for (const item of items) {
        const d = Math.hypot(person.position.x - item.position.x, person.position.z - item.position.z);
        if (d < minDistance) { nearest = item; minDistance = d; }
    }

    // Pulse the pickup rings; brighter when in reach.
    const t = performance.now() * 0.004;
    for (const item of items) {
        const ring = item.getObjectByName('pickup-ring');
        if (ring) ring.scale.setScalar(item === nearest ? 1.25 + Math.sin(t * 2) * 0.08 : 1 + Math.sin(t) * 0.05);
    }

    if (nearest) {
        if (prompt && promptText) {
            const label = `to collect ${nearest.userData.label} `;
            if (promptText.textContent !== label) promptText.textContent = label;
            if (prompt.classList.contains('hidden')) prompt.classList.remove('hidden');
        }
        if (keys.space && ctx.inventory) {
            const { proxy, ...itemData } = nearest.userData;
            ctx.inventory.addItem(itemData);
            nearest.parent.remove(nearest);
            const i = items.indexOf(nearest);
            if (i > -1) items.splice(i, 1);
            prompt?.classList.add('hidden');
            keys.space = false;
        }
    } else if (prompt && !prompt.classList.contains('hidden')) {
        prompt.classList.add('hidden');
    }
}

export function onWindowResize(camera, renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
