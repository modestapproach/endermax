import * as THREE from 'three';
import { createEnvironment, createBlocks, items } from './scene.js';
import { createPerson } from './person.js';
import { PathVisualizer } from './pathVisualizer.js';
import { db } from './db.js';

let scene, camera, renderer;
let blocks = [];
let snapshotNodes = [];
let heatmapData = new Map();
let blockMap = new Map();
let pathVisualizer;
let sessionTranscriptions = [];
window.lastClickedSnapshotTimestamp = null;
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;
let cameraRotationX = 0;
let cameraRotationY = 0;

// Simple camera controls
const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
const moveSpeed = 0.5;

let onSnapshotSelected = null;

export function setOnSnapshotSelected(callback) {
    onSnapshotSelected = callback;
}
// Saved Camera State
let savedCameraPosition = null;
let savedCameraRotationX = 0;
let savedCameraRotationY = 0;

export async function initViewer(containerElement, sessionId, passedSnapshots = null) {
    if (!containerElement) {
        console.error("Viewer container element not provided");
        return;
    }

    // Load Session Data
    const session = await db.sessions.get(sessionId);
    if (!session) {
        console.error("Session not found:", sessionId);
        return;
    }

    // Fetch transcriptions
    sessionTranscriptions = await db.transcriptions
        .where('sessionId')
        .equals(sessionId)
        .sortBy('startTime');

    // Setup Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Restore Camera Position or Set Default
    if (savedCameraPosition) {
        camera.position.copy(savedCameraPosition);
        cameraRotationX = savedCameraRotationX;
        cameraRotationY = savedCameraRotationY;
    } else {
        // Default Spawn Point (matching main.js)
        // main.js uses (0, 4, 3.5) looking at (0, 2.5, -5)
        // We'll use a slightly higher/further back view for overview
        camera.position.set(0, 5, 10);
        camera.lookAt(0, 0, 0);

        // Or if user wants exact spawn:
        // camera.position.set(0, 4, 3.5);
        // camera.lookAt(0, 2.5, -5);
        // But 0,5,10 is better for "results overview" usually. 
        // User asked for "middle of the scene, like where it spawns when its in the test".
        // Let's use 0, 4, 3.5 but maybe slightly adjusted for free cam.
        camera.position.set(0, 4, 8); // Slightly back from 3.5 to see more
    }

    // Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true // Allow transparency if needed
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    // Clear container and append canvas
    containerElement.innerHTML = '';
    containerElement.appendChild(renderer.domElement);

    // Environment
    createEnvironment(scene);

    // Create Blocks (populates blockMap)
    createBlocks(scene, blocks, heatmapData, blockMap);

    // Restore Heatmap Data (using Grid Coordinates)
    if (session.heatmapData) {
        Object.entries(session.heatmapData).forEach(([key, heat]) => {
            // key is "x,y,z"
            const block = blockMap.get(key);
            if (block && heat > 0) {
                const hue = 0.6 - (heat * 0.6);
                const saturation = Math.min(heat * 1.5, 1);
                const lightness = 0.65 - (heat * 0.25);
                block.material.color.setHSL(hue, saturation, lightness);
                block.material.emissive.setHSL(hue, saturation, lightness * 0.2); // Add glow
            }
        });
    }

    // Remove Collected Items
    if (session.collectedItems && session.collectedItems.length > 0) {
        // items array is populated by createBlocks -> create3DItem
        // We need to wait for items to load? createBlocks is synchronous but model loading is async.
        // However, create3DItem adds to the `items` array.
        // Since model loading is async, we might need to check periodically or hook into it.
        // For now, let's use a timeout or interval to check for items to remove.

        const removeInterval = setInterval(() => {
            // Check items array from scene.js
            for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                const itemId = item.userData.id || item.userData.label;

                // Check if this item was collected
                // collectedItems might store IDs or Labels depending on how we saved it.
                // In main.js we saved: item.id || item.label

                if (session.collectedItems.includes(itemId)) {
                    console.log(`Removing collected item: ${itemId}`);
                    scene.remove(item);
                    items.splice(i, 1);
                }
            }
        }, 500); // Check every 500ms

        // Stop checking after 5 seconds (assuming everything loaded)
        setTimeout(() => clearInterval(removeInterval), 5000);
    }

    // Restore Path
    if (session.pathPoints && session.pathPoints.length > 0) {
        pathVisualizer = new PathVisualizer(scene, session.pathPoints.length + 100);
        session.pathPoints.forEach(point => {
            pathVisualizer.addPoint(new THREE.Vector3(point.x, point.y, point.z));
        });
    }

    // Render Interactive Snapshot Nodes (Emojis)
    const snapsToRender = passedSnapshots || session.snapshotData || [];
    if (snapsToRender.length > 0) {
        snapsToRender.forEach(snap => {
            let emoji = '😐';
            if (snap.emotionManual === 'happy' || snap.emotionDetected === 'happy') emoji = '🙂';
            else if (snap.emotionManual === 'mad' || snap.emotionDetected === 'mad') emoji = '😠';
            else if (snap.emotionManual === 'confused' || snap.emotionDetected === 'confused') emoji = '🤔';
            else if (snap.emotionManual === 'thinking' || snap.emotionDetected === 'thinking') emoji = '🤔';

            const texture = createEmojiTexture(emoji);
            const material = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(material);

            // Scale sprite (0.8 world units)
            sprite.scale.set(0.8, 0.8, 1);
            // Position slightly above path
            sprite.position.set(snap.position.x, 0.5, snap.position.z);

            // Store snapshot data
            sprite.userData = { isSnapshotNode: true, snapshot: snap };

            scene.add(sprite);
            snapshotNodes.push(sprite);
        });
    }

    // Controls
    setupControls();

    animate();

    // Sync Selection from Results Page
    if (window.lastSelectedTimestamp) {
        // Small delay to ensure everything is ready
        setTimeout(() => {
            selectSnapshot(window.lastSelectedTimestamp);
        }, 100);
    }
}

let activeGhostAvatar = null;

function createEmojiTexture(emoji) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = '100px serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

function updateGhostAvatar(snap) {
    // Remove existing ghost
    if (activeGhostAvatar) {
        activeGhostAvatar.remove();
        activeGhostAvatar = null;
    }

    // Create real person model
    const personData = createPerson(scene);
    const person = personData.person;

    // Position and Rotate
    person.position.set(snap.position.x, snap.position.y, snap.position.z);
    if (snap.rotation !== undefined) {
        person.rotation.y = snap.rotation;
    }

    // Update Emoji on Person
    let emotion = snap.emotionManual || snap.emotionDetected || 'neutral';
    if (personData.updateEmoji) {
        personData.updateEmoji(emotion);
    }

    // Gaze Line
    // Use captured gaze data if available, otherwise fallback to forward
    let origin, dir;

    if (snap.gazeOrigin && snap.gazeVector) {
        origin = new THREE.Vector3(snap.gazeOrigin.x, snap.gazeOrigin.y, snap.gazeOrigin.z);
        dir = new THREE.Vector3(snap.gazeVector.x, snap.gazeVector.y, snap.gazeVector.z);
    } else {
        // Fallback: Head position + forward direction
        origin = new THREE.Vector3(0, 2.75, 0);
        origin.applyMatrix4(person.matrixWorld);

        dir = new THREE.Vector3(0, 0, -1);
        dir.applyEuler(new THREE.Euler(0, snap.rotation || 0, 0));
    }

    const length = 50; // Longer ray
    const color = 0x00ffff; // Cyan gaze ray

    const endPoint = new THREE.Vector3().copy(origin).add(dir.multiplyScalar(length));
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, endPoint]);
    const material = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.5 });
    const gazeLine = new THREE.Line(geometry, material);

    // Add line to scene
    scene.add(gazeLine);

    // Group everything for easy removal
    // Since createPerson adds 'person' to scene, we need to track it.
    // We'll create a wrapper group or just track the array of objects to remove.
    // Actually, createPerson adds to scene. Let's just track 'person' and 'arrowHelper'.

    // We need a way to remove 'person' later. 
    // activeGhostAvatar can be an object with .remove() method or an array.
    activeGhostAvatar = {
        remove: () => {
            scene.remove(person);
            scene.remove(gazeLine);
        }
    };
}

export function disposeViewer() {
    // Stop the render loop first — otherwise each open/close stacks another
    // loop and closed viewers keep erroring on the nulled renderer.
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    // Save Camera State
    if (camera) {
        savedCameraPosition = camera.position.clone();
        savedCameraRotationX = cameraRotationX;
        savedCameraRotationY = cameraRotationY;
    }

    // Per-viewer materials are recreated on every open; free the old ones.
    // Geometries and textures are shared module-level caches — keep those.
    blocks.forEach(block => {
        if (block.material) {
            (Array.isArray(block.material) ? block.material : [block.material]).forEach(m => m.dispose());
        }
    });
    snapshotNodes.forEach(node => {
        if (node.material) {
            if (node.material.map) node.material.map.dispose();
            node.material.dispose();
        }
    });

    if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        renderer = null;
    }

    // Clean up event listeners
    window.removeEventListener('resize', onWindowResize);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    // Remove popup if exists
    const existingPopup = document.getElementById('viewer-popup');
    if (existingPopup) existingPopup.remove();

    scene = null;
    camera = null;
    blocks = [];
    snapshotNodes = [];
    activeGhostAvatar = null;
    heatmapData.clear();
    blockMap.clear();
    if (pathVisualizer) {
        pathVisualizer = null;
    }
}

// Event handlers need to be named functions to be removable
function onKeyDown(e) {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
}
function onKeyUp(e) {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
}
function onMouseDown(e) {
    isDragging = true;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;

    // Raycasting for Node Selection
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(snapshotNodes);

    if (intersects.length > 0) {
        const selectedNode = intersects[0].object;
        const snap = selectedNode.userData.snapshot;
        console.log("Clicked Snapshot Node:", snap);

        // Track last clicked snapshot
        window.lastClickedSnapshotTimestamp = snap.timestamp;

        // Show Popup
        showPopup(snap);

        // Show Ghost Avatar
        updateGhostAvatar(snap);

        // Notify listener
        if (onSnapshotSelected) {
            onSnapshotSelected(snap.timestamp);
        }
    } else {
        // Hide popup if clicking empty space? 
        // User requested "fixed on upper right", so maybe we keep it until another click?
        // Let's keep it persistent for now, or allow closing.
    }
}

export function getLastClickedSnapshotTimestamp() {
    return window.lastClickedSnapshotTimestamp;
}

export function selectSnapshot(timestamp) {
    const node = snapshotNodes.find(n => n.userData.snapshot.timestamp === timestamp);
    if (node) {
        const snap = node.userData.snapshot;
        console.log("Selecting snapshot from external sync:", snap);

        // Track last clicked snapshot
        window.lastClickedSnapshotTimestamp = snap.timestamp;

        // Show Popup
        showPopup(snap);

        // Show Ghost Avatar
        updateGhostAvatar(snap);
    }
}
function onMouseMove(e) {
    if (isDragging) {
        const deltaX = e.clientX - previousMouseX;
        const deltaY = e.clientY - previousMouseY;

        cameraRotationY -= deltaX * 0.005;
        cameraRotationX -= deltaY * 0.005;

        // Clamp pitch
        cameraRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotationX));

        previousMouseX = e.clientX;
        previousMouseY = e.clientY;
    }
}
function onMouseUp() { isDragging = false; }

function showPopup(snap) {
    let popup = document.getElementById('viewer-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'viewer-popup';
        popup.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(15, 23, 42, 0.95); /* Dark Slate */
            color: white;
            padding: 1.5rem;
            border-radius: 12px;
            border: 1px solid #334155;
            z-index: 10000;
            width: 320px;
            font-family: 'Inter', sans-serif;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
        `;
        document.body.appendChild(popup);
    }

    const time = new Date(snap.timestamp).toLocaleTimeString();
    const emotion = snap.emotionManual || snap.emotionDetected || 'Neutral';
    const gaze = snap.gazeTarget || 'Nothing';

    // Emoji for popup
    let emoji = '😐';
    if (emotion.includes('happy')) emoji = '🙂';
    else if (emotion.includes('mad')) emoji = '😠';
    else if (emotion.includes('confused')) emoji = '🤔';

    popup.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <span style="font-weight: 600; font-size: 1.1rem; color: #e2e8f0;">Snapshot Details</span>
            <span style="font-size: 0.9rem; color: #94a3b8;">${time}</span>
        </div>
        
        <div style="margin-bottom: 1rem; display: grid; gap: 0.5rem;">
            <div style="background: rgba(255,255,255,0.1); padding: 0.5rem; border-radius: 6px;">
                <span style="color: #94a3b8; font-size: 0.85rem;">Emotion</span>
                <div style="font-size: 1rem;">${emoji} ${emotion}</div>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 0.5rem; border-radius: 6px;">
                <span style="color: #94a3b8; font-size: 0.85rem;">Looking At</span>
                <div style="font-size: 1rem;">👁️ ${gaze}</div>
            </div>
        </div>

        ${(() => {
            // Find relevant transcript (within 5 seconds window)
            const transcript = sessionTranscriptions.find(t =>
                Math.abs(t.startTime - snap.timestamp) < 5000 ||
                (t.startTime <= snap.timestamp && t.endTime >= snap.timestamp)
            );

            if (transcript) {
                return `
                <div style="margin-bottom: 1rem; background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 8px; border-left: 3px solid #3b82f6;">
                    <span style="color: #94a3b8; font-size: 0.75rem; display: block; margin-bottom: 4px;">Transcript</span>
                    <div style="font-size: 0.9rem; font-style: italic; color: #e2e8f0;">"${transcript.text}"</div>
                </div>`;
            }
            return '';
        })()}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
            <div style="position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #475569;">
                <img src="${snap.screenshot}" style="width: 100%; height: 100px; object-fit: cover; display: block;">
                <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); color: white; padding: 2px 6px; font-size: 0.7rem;">First Person</div>
            </div>
            ${snap.birdsEyeScreenshot ? `
            <div style="position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #475569;">
                <img src="${snap.birdsEyeScreenshot}" style="width: 100%; height: 100px; object-fit: cover; display: block;">
                <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); color: white; padding: 2px 6px; font-size: 0.7rem;">Bird's Eye</div>
            </div>` : ''}
        </div>
    `;

    popup.style.display = 'block';
}

function setupControls() {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateCamera() {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, cameraRotationY, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, cameraRotationY, 0));
    const up = new THREE.Vector3(0, 1, 0);

    // addScaledVector keeps the basis vectors unscaled so opposing keys cancel
    if (keys.w) camera.position.addScaledVector(forward, moveSpeed);
    if (keys.s) camera.position.addScaledVector(forward, -moveSpeed);
    if (keys.a) camera.position.addScaledVector(right, -moveSpeed);
    if (keys.d) camera.position.addScaledVector(right, moveSpeed);
    if (keys.q) camera.position.addScaledVector(up, -moveSpeed);
    if (keys.e) camera.position.addScaledVector(up, moveSpeed);

    // Look direction
    const lookTarget = new THREE.Vector3(0, 0, -1);
    lookTarget.applyEuler(new THREE.Euler(cameraRotationX, cameraRotationY, 0));
    lookTarget.add(camera.position);
    camera.lookAt(lookTarget);
}

let rafId = null;
function animate() {
    if (!renderer) return; // disposed mid-frame
    rafId = requestAnimationFrame(animate);
    updateCamera();
    renderer.render(scene, camera);
}


