import * as THREE from 'three';
import { items } from './scene.js';

let mouseX = 0, mouseY = 0;
let decayEnabled = false;
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;
let cameraRotationX = 0;
let cameraRotationY = 0;

let keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    arrowUp: false,
    arrowDown: false,
    arrowLeft: false,
    arrowRight: false,
    space: false
};
let moveSpeed = 0.2;
let aoeRadius = 2.8;
let isFirstPerson = false;
let lastCameraMode = false; // Track camera mode changes
let inventoryInstance = null;
let gazeEnabled = true;
let currentGaze = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, -1)
};

// Export function to get current gaze
export function getCurrentGaze() {
    return {
        origin: currentGaze.origin.clone(),
        direction: currentGaze.direction.clone()
    };
}

// Export function to toggle gaze
export function setGazeEnabled(enabled) {
    gazeEnabled = enabled;
}

// Export function to check if user is dragging
export function getIsDragging() {
    return isDragging;
}

// Export function to get camera mode
export function getIsFirstPerson() {
    return isFirstPerson;
}

export function setupControls(camera, person, renderer, inventory) {
    inventoryInstance = inventory;
    // Mouse drag events
    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('mousemove', (e) => onMouseMove(e, camera, person), false);
    document.addEventListener('mouseup', (event) => onMouseUp(event, camera, person), false);

    // Keyboard events
    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);

    window.addEventListener('resize', () => onWindowResize(camera, renderer), false);

    // UI Controls
    const resetBtn = document.querySelector('button[onclick="resetHeatmap()"]');
    if (resetBtn) {
        resetBtn.onclick = () => resetHeatmap();
        resetBtn.removeAttribute('onclick'); // Remove inline handler
    } else {
        // If the button doesn't have the onclick attribute or we want to select by ID/text
        // We'll handle this in main.js or assume the HTML is updated to have IDs
        // For now, let's assume we will update HTML to have IDs for buttons
    }
}

// import { recorder } from './main.js'; // Removed to avoid circular dependency

export function attachUIHandlers(blocks, heatmapData, recorder) {
    // Reset Button
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetHeatmap(blocks, heatmapData);
        });
    }

    // Record Button (Toggle) - REMOVED (Handled by Tutorial/Game Logic now)
    /*
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) {
        // ... old logic removed
    }
    */

    // Decay Toggle
    const decayToggle = document.getElementById('decayToggle');
    if (decayToggle) {
        decayToggle.addEventListener('change', (e) => toggleDecay(e.target.checked));
    }

    // AOE Slider
    const aoeSlider = document.getElementById('aoeSlider');
    if (aoeSlider) {
        aoeSlider.addEventListener('input', (e) => updateAOE(e.target.value));
    }

    // Speed Slider
    const speedSlider = document.getElementById('speedSlider');
    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => updateMoveSpeed(e.target.value));
    }

    // Reset Tutorial button
    const resetTutorialBtn = document.getElementById('resetTutorialBtn');
    if (resetTutorialBtn) {
        resetTutorialBtn.addEventListener('click', () => {
            localStorage.removeItem('onboardingCompleted');
            window.location.reload();
        });
    }

    // Settings toggle button
    const settingsToggle = document.getElementById('settingsToggle');
    const controlsPanel = document.getElementById('controlsPanel');
    if (settingsToggle && controlsPanel) {
        settingsToggle.addEventListener('click', () => {
            controlsPanel.classList.toggle('visible');

            // Update button text
            if (controlsPanel.classList.contains('visible')) {
                settingsToggle.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Hide Settings
                `;
            } else {
                settingsToggle.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path>
                    </svg>
                    Settings
                `;
            }
        });
    }

    // Camera toggle button
    const cameraToggle = document.getElementById('cameraToggle');
    const headsetOverlay = document.getElementById('headset-overlay');
    if (cameraToggle && headsetOverlay) {
        cameraToggle.addEventListener('click', () => {
            isFirstPerson = !isFirstPerson;

            // Toggle button state
            cameraToggle.classList.toggle('active');

            // Toggle headset overlay
            headsetOverlay.classList.toggle('visible');

            // Toggle cursor style
            const canvas = document.getElementById('canvas');
            const body = document.body;
            if (isFirstPerson) {
                canvas.classList.add('first-person-cursor');
                body.classList.add('first-person-cursor');
            } else {
                canvas.classList.remove('first-person-cursor');
                body.classList.remove('first-person-cursor');
            }

            // Force update all block colors when switching modes
            window.dispatchEvent(new CustomEvent('cameraModeChanged', { detail: { isFirstPerson } }));

            // Update button text
            if (isFirstPerson) {
                cameraToggle.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    Third Person
                `;
            } else {
                cameraToggle.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    First Person
                `;
            }
        });
    }
}

function onKeyDown(event) {
    switch (event.key.toLowerCase()) {
        case 'w': keys.w = true; break;
        case 'a': keys.a = true; break;
        case 's': keys.s = true; break;
        case 'd': keys.d = true; break;
        case 'arrowup': keys.arrowUp = true; break;
        case 'arrowdown': keys.arrowDown = true; break;
        case 'arrowleft': keys.arrowLeft = true; break;
        case 'arrowright': keys.arrowRight = true; break;
        case ' ': keys.space = true; break;
    }
}

function onKeyUp(event) {
    switch (event.key.toLowerCase()) {
        case 'w': keys.w = false; break;
        case 'a': keys.a = false; break;
        case 's': keys.s = false; break;
        case 'd': keys.d = false; break;
        case 'arrowup': keys.arrowUp = false; break;
        case 'arrowdown': keys.arrowDown = false; break;
        case 'arrowleft': keys.arrowLeft = false; break;
        case 'arrowright': keys.arrowRight = false; break;
        case ' ': keys.space = false; break;
    }
}

// Reused across frames to avoid per-frame allocations in the movement path.
const _moveVector = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
// Ground is 60x60 world units centered at the origin (scene.js); keep the
// shopper on it with a small margin.
const WORLD_BOUND = 29;

export function updateMovement(camera, person, dt = 1 / 60) {
    // Rates below were tuned at 60fps; timeScale keeps identical speed at any
    // refresh rate (previously a 144Hz monitor moved you 2.4x faster).
    const timeScale = dt * 60;
    _moveVector.set(0, 0, 0);

    // Calculate forward/right vectors based on camera rotation
    _forward.set(Math.sin(cameraRotationY), 0, Math.cos(cameraRotationY));
    _right.set(Math.cos(cameraRotationY), 0, -Math.sin(cameraRotationY));

    const step = moveSpeed * timeScale;
    // addScaledVector leaves the basis vectors untouched, so opposing keys
    // cancel instead of compounding (the old multiplyScalar mutated them).
    if (keys.w || keys.arrowUp) {
        _moveVector.addScaledVector(_forward, -step);
    }
    if (keys.s || keys.arrowDown) {
        _moveVector.addScaledVector(_forward, step);
    }
    if (keys.a) {
        _moveVector.addScaledVector(_right, -step);
    }
    if (keys.d) {
        _moveVector.addScaledVector(_right, step);
    }

    // Arrow Keys Rotation (Redundancy for drag to turn)
    const rotationSpeed = 0.05 * timeScale;
    if (keys.arrowLeft) {
        cameraRotationY += rotationSpeed;
    }
    if (keys.arrowRight) {
        cameraRotationY -= rotationSpeed;
    }

    // Apply movement to person, clamped to the floor extents
    person.position.add(_moveVector);
    person.position.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.x));
    person.position.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, person.position.z));

    // Update camera to follow the character
    updateCamera(camera, person);

    // Check for item proximity
    checkProximity(person);
}

function checkProximity(person) {
    const prompt = document.getElementById('interaction-prompt');
    const promptText = document.getElementById('interaction-text');
    let nearestItem = null;
    let minDistance = 2.5; // Proximity threshold

    // Find nearest item
    for (const item of items) {
        // Calculate distance in 2D (x, z) - ignore height difference for now
        const dx = person.position.x - item.position.x;
        const dz = person.position.z - item.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < minDistance) {
            nearestItem = item;
            minDistance = distance;
        }
    }

    if (nearestItem) {
        // Show prompt (only touch the DOM when something actually changed —
        // this runs every frame)
        if (prompt && promptText) {
            const label = `to collect ${nearestItem.userData.label} `;
            if (promptText.textContent !== label) promptText.textContent = label;
            if (prompt.classList.contains('hidden')) prompt.classList.remove('hidden');
        }

        // Check for collection input
        if (keys.space && inventoryInstance) {
            // Add to inventory
            inventoryInstance.addItem(nearestItem.userData);

            // Remove from scene
            nearestItem.parent.remove(nearestItem);

            // Remove from items array
            const index = items.indexOf(nearestItem);
            if (index > -1) {
                items.splice(index, 1);
            }

            // Hide prompt immediately
            if (prompt) prompt.classList.add('hidden');

            // Reset space key to prevent multiple collections
            keys.space = false;
        }
    } else {
        // Hide prompt
        if (prompt) {
            prompt.classList.add('hidden');
        }
    }
}

function onMouseDown(event) {
    isDragging = true;
    previousMouseX = event.clientX;
    previousMouseY = event.clientY;
}

function onMouseMove(event, camera, person) {
    if (isDragging) {
        const deltaX = event.clientX - previousMouseX;
        const deltaY = event.clientY - previousMouseY;

        cameraRotationY -= deltaX * 0.005;

        // Invert Y-axis for first-person mode
        if (isFirstPerson) {
            cameraRotationX -= deltaY * 0.005;
        } else {
            cameraRotationX += deltaY * 0.005;
        }

        // Clamp vertical rotation
        cameraRotationX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraRotationX));

        previousMouseX = event.clientX;
        previousMouseY = event.clientY;

        updateCamera(camera, person);
    } else {
        // Update gaze target based on mouse position when not dragging
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    }
}

function onMouseUp(event, camera, person) {
    isDragging = false;
}

function updateCamera(camera, person) {
    if (isFirstPerson) {
        // First-person view: camera at eye level, looking from opposite side
        const eyeHeight = 2.75;

        camera.position.x = person.position.x;
        camera.position.y = person.position.y + eyeHeight;
        camera.position.z = person.position.z;

        // Camera looks in the OPPOSITE direction (add PI to flip 180 degrees)
        const flippedRotationY = cameraRotationY + Math.PI;
        const lookTarget = new THREE.Vector3(
            person.position.x + Math.sin(flippedRotationY),
            person.position.y + eyeHeight + cameraRotationX,
            person.position.z + Math.cos(flippedRotationY)
        );
        camera.lookAt(lookTarget);

        person.rotation.y = cameraRotationY;
    } else {
        // Third-person view: original camera behavior
        const radius = 4.5;
        const heightOffset = 1.5;

        const targetY = person.position.y + 2.75;

        camera.position.x = person.position.x + radius * Math.sin(cameraRotationY);
        camera.position.z = person.position.z + radius * Math.cos(cameraRotationY);
        camera.position.y = targetY + heightOffset + cameraRotationX * 2;

        camera.lookAt(person.position.x, targetY, person.position.z);

        person.rotation.y = cameraRotationY;
    }
}

// --- Heatmap engine --------------------------------------------------------
// Per-second rates, identical in both camera modes so recorded gaze data is
// comparable between them. Values match the old third-person per-frame
// numbers at 60fps (0.05/frame, 0.012/frame, 0.005/frame); first-person
// previously ran 4x hotter and saturated a block in ~83ms of hovering.
const HEAT_RATE_HIT = 3.0;
const HEAT_RATE_AOE = 0.72;
const HEAT_RATE_DECAY = 0.3;

// Color progression: White > Light Blue > Green > Yellow > Orange > Red
const GRADIENT = [
    { stop: 0.0, color: new THREE.Color(0xffffff) },
    { stop: 0.2, color: new THREE.Color(0x87ceeb) },
    { stop: 0.4, color: new THREE.Color(0x00ff00) },
    { stop: 0.6, color: new THREE.Color(0xffff00) },
    { stop: 0.8, color: new THREE.Color(0xff8800) },
    { stop: 1.0, color: new THREE.Color(0xff0000) },
];
const _heatColor = new THREE.Color();

function computeHeatColor(heat, out) {
    for (let i = 1; i < GRADIENT.length; i++) {
        if (heat <= GRADIENT[i].stop || i === GRADIENT.length - 1) {
            const span = GRADIENT[i].stop - GRADIENT[i - 1].stop;
            const t = Math.min(Math.max((heat - GRADIENT[i - 1].stop) / span, 0), 1);
            return out.copy(GRADIENT[i - 1].color).lerp(GRADIENT[i].color, t);
        }
    }
    return out.copy(GRADIENT[0].color);
}

// Recolors a block only when its heat changed since the last applied value.
// With ~3,700 blocks this turns the per-frame color pass from thousands of
// setHSL/new Color calls into a map lookup and compare for untouched blocks.
function applyHeatColor(block, heat) {
    if (block.userData._appliedHeat === heat) return;
    block.userData._appliedHeat = heat;
    computeHeatColor(heat, _heatColor);
    block.material.color.copy(_heatColor);
    block.material.emissive.copy(_heatColor).multiplyScalar(heat * 0.2);
}

// Scratch objects reused every frame — the gaze path must not allocate.
const _raycaster = new THREE.Raycaster();
const _pointerVec = new THREE.Vector2();
const _gazeDirection = new THREE.Vector3();
const _worldGazeDirection = new THREE.Vector3();
const _gazeEuler = new THREE.Euler();
const _gazeOrigin = new THREE.Vector3();
const _rayEnd = new THREE.Vector3();
const _rayLocalStart = new THREE.Vector3();
const _rayLocalEnd = new THREE.Vector3();
let _raycastTargets = [];
let _raycastTargetCount = -1;

export function updateGaze(camera, person, blocks, heatmapData, gazeRay, ground, dt = 1 / 60) {
    if (isDragging || !gazeEnabled) {
        if (gazeRay) gazeRay.visible = false;
        return;
    }

    if (lastCameraMode !== isFirstPerson) {
        lastCameraMode = isFirstPerson;
    }

    let hitObject = null;
    let hitPoint = null;

    if (isFirstPerson) {
        // First-person: raycast from the camera through the cursor.
        if (gazeRay) gazeRay.visible = false;

        _raycaster.setFromCamera(_pointerVec.set(mouseX, mouseY), camera);
        currentGaze.origin.copy(_raycaster.ray.origin);
        currentGaze.direction.copy(_raycaster.ray.direction);

        _raycaster.far = 50;
        const intersects = _raycaster.intersectObjects(blocks, false);

        if (intersects.length > 0) {
            hitObject = intersects[0].object;
            hitPoint = intersects[0].point;
            window.currentGazeTarget = hitObject;
        } else {
            window.currentGazeTarget = null;
        }
    } else {
        // Third-person: gaze projects from the character's face toward the cursor.
        if (gazeRay) gazeRay.visible = true;

        _gazeDirection.set(mouseX * 8, mouseY * 6, -8).normalize();
        _worldGazeDirection.copy(_gazeDirection)
            .applyEuler(_gazeEuler.set(0, person.rotation.y, 0));

        // Head tracks the gaze direction (head is the second child)
        const targetRotationX = -mouseY * 0.8;
        const targetRotationY = mouseX * 1.0;
        if (person.children[1]) {
            person.children[1].rotation.x = THREE.MathUtils.lerp(person.children[1].rotation.x, targetRotationX, 0.1);
            person.children[1].rotation.y = THREE.MathUtils.lerp(person.children[1].rotation.y, targetRotationY, 0.1);
        }

        // Raycasting from person's face in world space
        _gazeOrigin.set(0, 2.75, 0.35).applyMatrix4(person.matrixWorld);
        currentGaze.origin.copy(_gazeOrigin);
        currentGaze.direction.copy(_worldGazeDirection);

        _raycaster.set(_gazeOrigin, _worldGazeDirection);
        _raycaster.far = 50;

        // Blocks + ground, rebuilt only when the block list changes size
        // (tutorial spawn/remove) instead of re-spread every frame.
        const wantedCount = blocks.length + (ground ? 1 : 0);
        if (_raycastTargetCount !== wantedCount) {
            _raycastTargets = ground ? [...blocks, ground] : [...blocks];
            _raycastTargetCount = wantedCount;
        }

        const intersects = _raycaster.intersectObjects(_raycastTargets, false);

        // Gaze ray visualization: from the face center along the gaze
        const rayLength = 30;
        _rayEnd.copy(_worldGazeDirection).multiplyScalar(rayLength).add(_gazeOrigin);
        _rayLocalStart.copy(_gazeOrigin);
        person.worldToLocal(_rayLocalStart);
        _rayLocalEnd.copy(_rayEnd);
        person.worldToLocal(_rayLocalEnd);
        gazeRay.geometry.setFromPoints([_rayLocalStart, _rayLocalEnd]);

        if (intersects.length > 0) {
            if (intersects[0].object.userData.type !== 'ground') {
                hitObject = intersects[0].object;
                hitPoint = intersects[0].point;
            }
            window.currentGazeTarget = intersects[0].object.userData.type !== 'ground' ? hitObject : intersects[0].object;
        } else {
            // Not looking at any object - upward ray means sky
            window.currentGazeTarget = _worldGazeDirection.y > 0.3 ? { userData: { type: 'sky' } } : null;
        }
    }

    // --- Shared heat application (dt-scaled, mode-independent) ---
    if (hitObject) {
        const prevHeat = heatmapData.get(hitObject.uuid) || 0;
        heatmapData.set(hitObject.uuid, Math.min(prevHeat + HEAT_RATE_HIT * dt, 1.0));

        // AOE bleed onto nearby blocks
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (block === hitObject) continue;
            const distance = block.position.distanceTo(hitPoint);
            if (distance < aoeRadius) {
                const falloff = 1 - (distance / aoeRadius);
                const blockHeat = heatmapData.get(block.uuid) || 0;
                heatmapData.set(block.uuid, Math.min(blockHeat + HEAT_RATE_AOE * falloff * dt, 1.0));
            }
        }
    }

    // Decay (if enabled) + recolor. applyHeatColor skips blocks whose heat
    // hasn't changed, so quiet frames touch almost no materials.
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        let heat = heatmapData.get(block.uuid) || 0;

        if (decayEnabled && heat > 0 && block !== hitObject) {
            heat = Math.max(heat - HEAT_RATE_DECAY * dt, 0);
            heatmapData.set(block.uuid, heat);
        }

        applyHeatColor(block, heat);
    }
}

export function onWindowResize(camera, renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetHeatmap(blocks, heatmapData) {
    blocks.forEach(block => {
        heatmapData.set(block.uuid, 0);
        block.userData._appliedHeat = 0; // keep the dirty-tracking cache in sync
        block.material.color.setHex(0xffffff); // White instead of blue
        block.material.emissive.setHex(0x000000);
    });
}

function toggleDecay(enabled) {
    decayEnabled = enabled;
    const status = document.getElementById('decayStatus');
    if (status) status.textContent = decayEnabled ? 'ON' : 'OFF';
}

function updateAOE(value) {
    aoeRadius = parseFloat(value);
    const display = document.getElementById('aoeValue');
    if (display) display.textContent = value;
}

function updateMoveSpeed(value) {
    moveSpeed = parseFloat(value);
    const display = document.getElementById('speedValue');
    if (display) display.textContent = value;
}

let fadedBlocks = [];
const _lastObsCameraPos = new THREE.Vector3(Infinity, Infinity, Infinity);
const _lastObsPersonPos = new THREE.Vector3(Infinity, Infinity, Infinity);

export function updateObstruction(camera, person, blocks, blockMap) {
    // The camera-to-head sightline only changes when one of them moves; the
    // neighbor scan below is expensive (up to 11^3 grid lookups per hit), so
    // skip the whole pass on static frames.
    if (person && _lastObsCameraPos.equals(camera.position) && _lastObsPersonPos.equals(person.position)) {
        return;
    }
    if (person) {
        _lastObsCameraPos.copy(camera.position);
        _lastObsPersonPos.copy(person.position);
    }

    // Reset previously faded blocks
    fadedBlocks.forEach(block => {
        block.visible = true;
        block.material.transparent = false;
        block.material.opacity = 1.0;
    });
    fadedBlocks = [];

    if (!person) return;

    // Raycast from camera to person's head
    // Head is at y=2.75 relative to person position
    const headPosition = person.position.clone().add(new THREE.Vector3(0, 2.75, 0));

    const direction = new THREE.Vector3().subVectors(headPosition, camera.position);
    const distance = direction.length();
    direction.normalize();

    const raycaster = new THREE.Raycaster(camera.position, direction);
    // Check intersections up to the person (slightly less to avoid hitting person parts if any)
    raycaster.far = distance - 0.5;

    const intersects = raycaster.intersectObjects(blocks);

    intersects.forEach(intersect => {
        const hitBlock = intersect.object;

        // Hide the hit block
        hideBlock(hitBlock);

        // Hide neighbors if blockMap is available
        if (blockMap && hitBlock.userData) {
            const { gridX, gridY, gridZ } = hitBlock.userData;
            const radius = 5; // Increased radius for wider hole

            for (let x = gridX - radius; x <= gridX + radius; x++) {
                for (let y = gridY - radius; y <= gridY + radius; y++) {
                    for (let z = gridZ - radius; z <= gridZ + radius; z++) {
                        const key = `${x},${y},${z}`;
                        const neighbor = blockMap.get(key);
                        if (neighbor && neighbor !== hitBlock) {
                            hideBlock(neighbor);
                        }
                    }
                }
            }
        }
    });
}

function hideBlock(block) {
    // Avoid adding duplicates if multiple rays hit or neighbors overlap
    if (!fadedBlocks.includes(block)) {
        block.visible = false;
        fadedBlocks.push(block);
    }
}
