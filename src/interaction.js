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
let moveSpeed = 0.2; // v1 units: world units per 60fps frame (settings slider)
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
export const FOV = { third: 54, first: 70 };
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
    // Pointer events cover mouse, pen, and touch.
    document.addEventListener('pointerdown', onPointerDown, false);
    document.addEventListener('pointermove', onPointerMove, false);
    document.addEventListener('pointerup', () => { isDragging = false; }, false);
    document.addEventListener('pointercancel', () => { isDragging = false; }, false);
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
    // Only drags that start on the 3D canvas rotate the view.
    if (event.target && event.target.tagName !== 'CANVAS') return;
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
const _velocity = new THREE.Vector3();
const _wish = new THREE.Vector3();
const WORLD_BOUND = 29;
let currentSpeed = 0;

export function updateMovement(dt) {
    if (!ctx) return;
    const person = ctx.character.person;

    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // right
    _wish.set(0, 0, 0);
    if (keys.w || keys.arrowUp) _wish.x += fx, _wish.z += fz;
    if (keys.s || keys.arrowDown) _wish.x -= fx, _wish.z -= fz;
    if (keys.d) _wish.x += rx, _wish.z += rz;
    if (keys.a) _wish.x -= rx, _wish.z -= rz;
    if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(moveSpeed * 60);

    // Ease toward the wished velocity: quick start, soft stop.
    const accel = _wish.lengthSq() > 0 ? 14 : 10;
    _velocity.lerp(_wish, 1 - Math.exp(-accel * dt));
    // Axis-separated moves so the shopper slides along shelves instead of
    // passing through them (sub-stepped so fast frames can't tunnel).
    const steps = Math.max(1, Math.ceil(_velocity.length() * dt / 0.2));
    for (let i = 0; i < steps; i++) {
        const nx = person.position.x + _velocity.x * dt / steps;
        if (!collides(nx, person.position.z)) person.position.x = nx; else _velocity.x = 0;
        const nz = person.position.z + _velocity.z * dt / steps;
        if (!collides(person.position.x, nz)) person.position.z = nz; else _velocity.z = 0;
    }
    person.position.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.x));
    person.position.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.z));
    currentSpeed = _velocity.length();

    const turn = 3 * dt;
    if (keys.arrowLeft) yaw += turn;
    if (keys.arrowRight) yaw -= turn;
    person.rotation.y = yaw;

    updateCamera(dt);
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

// --- Camera rig ----------------------------------------------------------------
let snapCamera = true;
const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _smoothLook = new THREE.Vector3();
const _armOrigin = new THREE.Vector3();
const _armDir = new THREE.Vector3();
const _armRay = new THREE.Raycaster();
let armCurrent = 6;

function updateCamera(dt) {
    const { camera } = ctx;
    const person = ctx.character.person;
    if (isFirstPerson) {
        camera.position.set(person.position.x, person.position.y + EYE_HEIGHT, person.position.z);
        _look.set(
            camera.position.x - Math.sin(yaw) * Math.cos(pitch),
            camera.position.y + Math.sin(pitch),
            camera.position.z - Math.cos(yaw) * Math.cos(pitch)
        );
        camera.lookAt(_look);
        ctx.character.setFade(1);
        ctx.character.person.visible = false;
        snapCamera = true;
        return;
    }
    ctx.character.person.visible = true;

    // Over-the-shoulder: behind, a little above, offset right so the shopper
    // sits left of center and the view ahead stays open. Pitch tilts the orbit.
    const radius = 5.4;
    const side = 0.95;
    const elev = THREE.MathUtils.clamp(0.3 + pitch * 0.6, 0.02, 1.1);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // camera right
    _camPos.set(
        person.position.x + Math.sin(yaw) * Math.cos(elev) * radius + rx * side,
        person.position.y + EYE_HEIGHT + 0.3 + Math.sin(elev) * radius,
        person.position.z + Math.cos(yaw) * Math.cos(elev) * radius + rz * side
    );
    _camTarget.set(
        person.position.x - Math.sin(yaw) * 4 + rx * side * 0.6,
        person.position.y + EYE_HEIGHT - 0.35,
        person.position.z - Math.cos(yaw) * 4 + rz * side * 0.6
    );

    // Spring arm: if a fixture sits between the head and the ideal camera
    // spot, pull the camera in front of it (snaps in, eases back out).
    _armOrigin.set(person.position.x, person.position.y + EYE_HEIGHT, person.position.z);
    _armDir.subVectors(_camPos, _armOrigin);
    const armLen = _armDir.length();
    _armDir.divideScalar(armLen);
    _armRay.set(_armOrigin, _armDir);
    _armRay.far = armLen;
    const armHit = _armRay.intersectObjects(ctx.world.raycastTargets, false)[0];
    const wanted = armHit ? Math.max(armHit.distance - 0.35, 0.8) : armLen;
    armCurrent = wanted < armCurrent || snapCamera ? wanted : armCurrent + (wanted - armCurrent) * (1 - Math.exp(-4 * dt));
    _camPos.copy(_armOrigin).addScaledVector(_armDir, armCurrent);

    // Close arm -> ghost the figure so it doesn't wall off the view.
    ctx.character.setFade(THREE.MathUtils.clamp((armCurrent - 1.6) / 1.8, 0.22, 1));

    const k = snapCamera ? 1 : 1 - Math.exp(-10 * dt);
    camera.position.lerp(_camPos, k);
    _smoothLook.lerp(_camTarget, k);
    camera.lookAt(_smoothLook);
    snapCamera = false;
}

// --- Gaze ------------------------------------------------------------------------
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _local = new THREE.Vector3();
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
        // Aim where the cursor points, ignoring anything between the camera
        // and the shopper (it's cut away on screen), then cast from the eyes.
        const camToPerson = camera.position.distanceTo(person.position) - 0.5;
        const camHits = _raycaster.intersectObjects(gazeTargets(), false);
        const aimHit = camHits.find(h => h.distance > camToPerson);
        if (aimHit) _aim.copy(aimHit.point);
        else _aim.copy(_raycaster.ray.direction).multiplyScalar(40).add(_raycaster.ray.origin);

        _eye.set(0, EYE_HEIGHT, -0.32).applyMatrix4(person.matrixWorld);
        _dir.subVectors(_aim, _eye).normalize();
        currentGaze.origin.copy(_eye);
        currentGaze.direction.copy(_dir);
        _raycaster.set(_eye, _dir);
        const hits = _raycaster.intersectObjects(gazeTargets(), false);
        hit = hits[0] || null;
    }

    if (hit && hit.face) _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (!isFirstPerson) character.setGaze(true, currentGaze.origin, currentGaze.direction, hit, hit && hit.face ? _normal : null);

    // Head follows the gaze relative to the body.
    _local.copy(currentGaze.direction).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    const headYaw = THREE.MathUtils.clamp(Math.atan2(-_local.x, -_local.z), -1.1, 1.1);
    const headPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_local.y, -1, 1)), -0.6, 0.6);
    character.animate(dt, currentSpeed, headYaw, headPitch);

    const isGround = hit && hit.object.userData.type === 'ground';
    const isItem = hit && hit.object.userData.type === 'item';
    const cell = hit && !isGround && !isItem ? world.cellFromHit(hit) : null;
    lastHitCell = cell;
    window.currentGazeTarget = hit ? gazeTargetFor(hit, cell)
        : (currentGaze.direction.y > 0.3 ? { userData: { type: 'sky' } } : null);

    heat.applyGaze(cell, hit ? hit.point : null, dt);
}

// --- See-through cutout ------------------------------------------------------------
const _head = new THREE.Vector3();
export function updateCutout() {
    if (!ctx) return;
    const { camera } = ctx;
    if (isFirstPerson) { cutout.enabled.value = 0; return; }
    const person = ctx.character.person;
    _head.set(person.position.x, person.position.y + 1.7, person.position.z);
    const dist = camera.position.distanceTo(_head);
    const viewZ = _head.clone().applyMatrix4(camera.matrixWorldInverse).z;
    _head.project(camera);
    cutout.enabled.value = 1;
    cutout.center.value.set(_head.x * 0.5 + 0.5, 1 - (_head.y * 0.5 + 0.5));
    cutout.depth.value = viewZ;
    cutout.radius.value = 2.1 / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
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
