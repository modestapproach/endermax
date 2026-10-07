// Results replay: the recorded session rendered with the same engine as the
// live sim — heat restored into the GPU heat field, the walked path as a floor
// ribbon, emotion pins at each snapshot, and a ghost shopper + gaze beam for
// the selected moment. Orbit to inspect (drag), zoom (wheel), pan (right-drag).

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { parseLayout } from './engine/layout.js';
import { HeatField, createHeatNodes } from './engine/heat.js';
import { buildWorld } from './engine/world.js';
import { createRenderer, createLighting, createPipeline } from './engine/renderer.js';
import { createCharacter } from './engine/character.js';
import { PathVisualizer } from './pathVisualizer.js';
import { db } from './db.js';

let scene, camera, renderer, post, controls, world, heat;
let snapshotNodes = [];
let pathVisualizer;
let ghost = null;
let sessionTranscriptions = [];
let onSnapshotSelected = null;
let savedView = null;
let container = null;
let fly = null; // { pos, target } while flying to a selected snapshot
let loopTicks = 0, renderedFrames = 0;
let renderFrames = 4; // a few frames lets lazily loaded textures/models land
function requestRender(frames = 2) { renderFrames = Math.max(renderFrames, frames); }
window.lastClickedSnapshotTimestamp = null;

export function setOnSnapshotSelected(callback) { onSnapshotSelected = callback; }
export function getLastClickedSnapshotTimestamp() { return window.lastClickedSnapshotTimestamp; }

const EMOJI = { happy: '🙂', neutral: '😐', mad: '😠', confused: '😕', thinking: '🤔' };
function emotionOf(snap) {
    return snap.emotionManual || snap.emotionDetected || 'neutral';
}

export async function initViewer(containerElement, sessionId, passedSnapshots = null) {
    if (!containerElement) return console.error('Viewer container element not provided');
    const session = await db.sessions.get(sessionId);
    if (!session) return console.error('Session not found:', sessionId);
    sessionTranscriptions = await db.transcriptions.where('sessionId').equals(sessionId).sortBy('startTime');

    container = containerElement;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(canvas);
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    renderer = await createRenderer({ canvas, width: w, height: h });
    renderer.setSize(w, h, false);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);

    const layout = parseLayout();
    heat = new HeatField(layout);
    heat.load(session.heatmapData);
    heat.flush();
    const lights = createLighting(scene, renderer);
    world = buildWorld(layout, createHeatNodes(heat));
    // Textures/models arrive async; repaint once they land (and once fonts do).
    THREE.DefaultLoadingManager.onLoad = () => requestRender(6);
    setTimeout(() => requestRender(4), 1500);
    scene.add(world.group);
    post = createPipeline(renderer, scene, camera);

    // Hide items the shopper collected (models load async, so check on load).
    const collected = new Set(session.collectedItems || []);
    for (const item of world.items) {
        if (collected.has(item.userData.id) || collected.has(item.userData.label)) item.visible = false;
    }

    if (session.pathPoints?.length) {
        pathVisualizer = new PathVisualizer(scene, session.pathPoints.length + 100);
        for (const p of session.pathPoints) pathVisualizer.addPoint(new THREE.Vector3(p.x, p.y, p.z));
    }

    // Emotion pins along the path
    const snaps = passedSnapshots || session.snapshotData || [];
    const textures = new Map();
    for (const snap of snaps) {
        if (!snap.position) continue;
        const emo = emotionOf(snap);
        if (!textures.has(emo)) textures.set(emo, pinTexture(EMOJI[emo] || '😐'));
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.get(emo), depthTest: true }));
        sprite.scale.set(0.7, 0.7, 1);
        sprite.position.set(snap.position.x, 0.6, snap.position.z);
        sprite.userData = { isSnapshotNode: true, snapshot: snap };
        scene.add(sprite);
        snapshotNodes.push(sprite);
    }

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 3;
    controls.maxDistance = 70;
    if (savedView) {
        camera.position.copy(savedView.position);
        controls.target.copy(savedView.target);
    } else {
        // Overview of the store from a high three-quarter angle.
        camera.position.set(20, 26, 30);
        controls.target.set(0, 0, 0);
    }
    controls.update();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onWindowResize);

    // Render on demand: only while the orbit moves (incl. damping) or after a
    // selection/resize — a static replay costs nothing between interactions.
    controls.addEventListener('change', () => requestRender());
    renderer.setAnimationLoop(() => {
        if (fly) {
            // Ease camera + target toward the selected moment.
            camera.position.lerp(fly.pos, 0.12);
            controls.target.lerp(fly.target, 0.12);
            if (camera.position.distanceTo(fly.pos) < 0.05) fly = null;
            requestRender();
        }
        controls.update();
        if (world?.shadowsDirty) { lights.sun.shadow.needsUpdate = true; world.shadowsDirty = false; requestRender(); }
        loopTicks++;
        if (renderFrames > 0) {
            renderFrames--;
            renderedFrames++;
            post.pipeline.render();
        }
    });

    if (window.lastSelectedTimestamp) setTimeout(() => selectSnapshot(window.lastSelectedTimestamp), 100);
    // The live instance, for automation (a dynamic import can load a second copy under HMR).
    window.__endermaxViewer = { selectSnapshot, getViewerDebug };
}

function pinTexture(emoji) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#4f46e5'; g.stroke();
    g.font = '72px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function updateGhostAvatar(snap) {
    if (!ghost) {
        ghost = createCharacter(scene);
        ghost.beamOpacity.value = 0.8;
    }
    const p = ghost.person;
    p.position.set(snap.position.x, snap.position.y || 0, snap.position.z);
    p.rotation.y = snap.rotation || 0;
    p.updateMatrixWorld(true);
    ghost.updateEmoji(emotionOf(snap));

    let origin, dir;
    if (snap.gazeOrigin && snap.gazeVector) {
        origin = new THREE.Vector3(snap.gazeOrigin.x, snap.gazeOrigin.y, snap.gazeOrigin.z);
        dir = new THREE.Vector3(snap.gazeVector.x, snap.gazeVector.y, snap.gazeVector.z).normalize();
    } else {
        origin = new THREE.Vector3(0, 2.75, -0.3).applyMatrix4(p.matrixWorld);
        dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, snap.rotation || 0, 0));
    }
    const ray = new THREE.Raycaster(origin, dir, 0, 60);
    const hit = ray.intersectObjects([...world.raycastTargets, world.floor], false)[0] || null;
    const normal = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    ghost.setGaze(true, origin, dir, hit, normal);
    ghost.animate(1, 0, 0, 0);
    requestRender(30);
}

let downAt = null;
function onPointerDown(e) { downAt = { x: e.clientX, y: e.clientY }; }
function onPointerUp(e) {
    // A click (not an orbit drag) selects the nearest emotion pin.
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(snapshotNodes)[0];
    if (!hit) return;
    const snap = hit.object.userData.snapshot;
    window.lastClickedSnapshotTimestamp = snap.timestamp;
    showPopup(snap);
    updateGhostAvatar(snap);
    flyTo(snap);
    onSnapshotSelected?.(snap.timestamp);
}

export function selectSnapshot(timestamp) {
    const node = snapshotNodes.find(n => n.userData.snapshot.timestamp === timestamp);
    if (!node) return;
    const snap = node.userData.snapshot;
    window.lastClickedSnapshotTimestamp = snap.timestamp;
    showPopup(snap);
    updateGhostAvatar(snap);
    flyTo(snap);
}

// Frame the selected moment: keep the current viewing direction, but come in
// to a readable distance with the shopper on screen.
function flyTo(snap) {
    if (!controls) return;
    const target = new THREE.Vector3(snap.position.x, 1.5, snap.position.z);
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    fly = { target, pos: target.clone().addScaledVector(dir, 14) };
    requestRender();
}

export function disposeViewer() {
    if (camera && controls) savedView = { position: camera.position.clone(), target: controls.target.clone() };
    if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.dispose();
        renderer.domElement.remove();
        renderer = null;
    }
    controls?.dispose();
    snapshotNodes.forEach(n => { n.material.map?.dispose(); n.material.dispose(); });
    window.removeEventListener('resize', onWindowResize);
    document.getElementById('viewer-popup')?.remove();
    scene = camera = controls = world = heat = post = pathVisualizer = null;
    fly = null;
    snapshotNodes = [];
    ghost = null;
}

function onWindowResize() {
    if (!renderer || !container) return;
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    requestRender();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showPopup(snap) {
    let popup = document.getElementById('viewer-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'viewer-popup';
        popup.style.cssText = `position:fixed;top:20px;right:20px;background:rgba(15,15,26,.88);color:#fff;padding:1.25rem;
            border-radius:14px;border:1px solid rgba(255,255,255,.1);z-index:10000;width:320px;font-family:Inter,sans-serif;
            box-shadow:0 20px 40px rgba(0,0,0,.45);backdrop-filter:blur(14px);`;
        document.body.appendChild(popup);
    }
    const time = new Date(snap.timestamp).toLocaleTimeString();
    const emotion = emotionOf(snap);
    const transcript = sessionTranscriptions.find(t =>
        Math.abs(t.startTime - snap.timestamp) < 5000 || (t.startTime <= snap.timestamp && t.endTime >= snap.timestamp));
    const tile = (src, label) => src ? `
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.12)">
            <img src="${src}" style="width:100%;height:100px;object-fit:cover;display:block">
            <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);padding:2px 6px;font-size:.7rem">${label}</div>
        </div>` : '';
    popup.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <span style="font-weight:600;font-size:1.05rem">Snapshot</span>
            <span style="font-size:.85rem;color:#a1a1aa">${time}</span>
        </div>
        <div style="display:grid;gap:.5rem;margin-bottom:1rem">
            <div style="background:rgba(255,255,255,.07);padding:.5rem .65rem;border-radius:8px">
                <span style="color:#a1a1aa;font-size:.8rem">Emotion</span><div>${EMOJI[emotion] || '😐'} ${escapeHtml(emotion)}</div>
            </div>
            <div style="background:rgba(255,255,255,.07);padding:.5rem .65rem;border-radius:8px">
                <span style="color:#a1a1aa;font-size:.8rem">Looking at</span><div>${escapeHtml(snap.gazeTarget || 'nothing')}</div>
            </div>
        </div>
        ${transcript ? `<div style="margin-bottom:1rem;background:rgba(255,255,255,.05);padding:.7rem;border-radius:8px;border-left:3px solid #6366f1">
            <span style="color:#a1a1aa;font-size:.75rem;display:block;margin-bottom:4px">Transcript</span>
            <div style="font-size:.9rem;font-style:italic">"${escapeHtml(transcript.text)}"</div></div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
            ${tile(snap.screenshot, 'View')}${tile(snap.birdsEyeScreenshot, 'Plan')}
        </div>`;
    popup.style.display = 'block';
}

// Dev/e2e introspection.
export function getViewerDebug() {
    const p = ghost?.person;
    return { ghost: p ? { pos: p.position.toArray(), inScene: !!p.parent } : null, cam: camera?.position.toArray(), target: controls?.target.toArray(), fly: !!fly, loopTicks, renderedFrames, renderFrames };
}
