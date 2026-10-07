import * as THREE from 'three/webgpu';
import './ui.css';

import { parseLayout } from './engine/layout.js';
import { HeatField, createHeatNodes } from './engine/heat.js';
import { buildWorld } from './engine/world.js';
import { createRenderer, createLighting, createPipeline, backendName, QUALITY_FLAGS, QUALITY_NAME, setQualityPreset } from './engine/renderer.js';
import { createCharacter } from './engine/character.js';
import { drawPlanMap } from './engine/planMap.js';
import { cutout } from './engine/materials.js';
import { installDevtools, flags, CAMERA_PRESETS, createDemoHeat } from './engine/devtools.js';
import {
    setupControls, updateMovement, updateGaze, updateCutout, attachUIHandlers, getIsDragging,
    onWindowResize, setPose, setFirstPerson, setPointer, getPose, getCurrentGaze, getDesiredFov
} from './interaction.js';

import { Recorder } from './tracking/Recorder.js';
import { EmotionState } from './tracking/EmotionState.js';
import { FaceEmotionDetector } from './tracking/FaceEmotionDetector.js';
import { PathVisualizer } from './pathVisualizer.js';
import { VoiceAgent } from './VoiceAgent.js';
import { initLandingPage, initFrontPage } from './landing.js';
import { initIntroModal } from './introModal.js';
import { initTutorial, updateTutorial } from './tutorial.js';
import PromptManager from './promptManager.js';
import GameLogic from './gameLogic.js';
import { Inventory } from './inventory.js';
import { db } from './db.js';

let scene, camera, renderer, post, character, world, layout, heat;
let pathVisualizer, promptManager, gameLogic, inventory;
let emotionState, recorder, faceDetector, voiceAgent;
let isTestActive = false;
let freeCamera = null;
let storeFog = null;
let lights = null;
const clock = new THREE.Clock();
const planCanvas = document.createElement('canvas');

// FPS tracking for the dev HUD
let frameCount = 0, fps = 0, fpsT = performance.now();

async function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 120);

    try {
        renderer = await createRenderer({ canvas: document.getElementById('canvas') });
    } catch (err) {
        console.error('Renderer failed to start', err);
        document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:16px Inter,sans-serif;background:#0f0f1a;z-index:99999">This browser can\'t run the 3D view (WebGPU/WebGL2 unavailable).</div>');
        return;
    }

    layout = parseLayout();
    heat = new HeatField(layout);
    const heatNodes = createHeatNodes(heat);
    lights = createLighting(scene, renderer);
    storeFog = scene.fog;
    world = buildWorld(layout, heatNodes);
    scene.add(world.group);

    pathVisualizer = new PathVisualizer(scene);
    character = createCharacter(scene);
    post = createPipeline(renderer, scene, camera);

    inventory = new Inventory();
    emotionState = new EmotionState((emotion) => character.updateEmoji(emotion));
    faceDetector = new FaceEmotionDetector(document.getElementById('webcam-video'), (detected) => {
        emotionState?.setDetectedEmotion(detected);
    });
    recorder = new Recorder(character.person, emotionState, { frame: captureFrame, plan: () => capturePlan(512) });

    setupControls({ camera, character, world, heat, inventory, layout });
    attachUIHandlers(heat);
    window.addEventListener('resize', () => onWindowResize(camera, renderer));

    promptManager = new PromptManager();
    gameLogic = new GameLogic(promptManager, async () => { await endTest(); });
    promptManager.setGameLogic(gameLogic);
    voiceAgent = new VoiceAgent();

    const qualitySelect = document.getElementById('qualitySelect');
    if (qualitySelect) {
        qualitySelect.value = QUALITY_NAME;
        qualitySelect.addEventListener('change', () => { setQualityPreset(qualitySelect.value); location.reload(); });
    }

    window.gameLogic = gameLogic;
    window.voiceAgent = voiceAgent;
    window.recorder = recorder;

    installDevtools({
        renderer, camera, layout, heat, captureFrame, capturePlan,
        setPose, setFirstPerson, setPointer, getPose, setFreeCamera: (c) => { freeCamera = c; }, simulateSession,
        info: () => ({
            backend: backendName(renderer), fps,
            drawCalls: perf.draws, triangles: perf.tris,
            cpuTickMs: +perf.tick.toFixed(2), cpuRenderMs: +perf.render.toFixed(2), gpuMs: +perf.gpu.toFixed(2),
            quality: QUALITY_NAME, pixelRatio: renderer.getPixelRatio(), drawingBuffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()
        })
    });

    if (flags.skip) {
        for (const id of ['front-page', 'landing-page', 'intro-modal']) {
            const el = document.getElementById(id);
            if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
        }
    } else {
        initFrontPage(() => initLandingPage(() => initIntroModal(() => initTutorial())));
    }
    if (flags.heat === 'demo') createDemoHeat(layout, heat);
    if (flags.cam) window.endermax.cam(flags.cam);
    else setPose({ x: -1.2, z: 24, yaw: 0, pitch: -0.08 }); // spawn at the aisle mouth, looking down it

    renderer.setAnimationLoop(animate);
}

function renderFrame() {
    if (world.shadowsDirty) { lights.sun.shadow.needsUpdate = true; world.shadowsDirty = false; }
    heat.flush();
    post.pipeline.render();
}

// Captures render the full post stack into an offscreen 8-bit target and read
// the pixels back. Reading the canvas instead returns whichever frame was last
// *presented*, which lags (and never updates in a hidden tab).
let captureRT = null;
const captureCanvas = document.createElement('canvas');
let capturing = false;
async function captureFrame(type = 'image/jpeg', quality = 0.5, { width = 960, height = 600 } = {}) {
    const w = Math.max(64, Math.round(width / 64) * 64); // WebGPU readback rows align to 256 bytes
    const h = Math.round(height);
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    capturing = true;
    try {
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        if (!captureRT) captureRT = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });
        captureRT.setSize(w, h);

        tick(0);
        heat.flush();
        // Post passes re-render once per node frame, which normally only the
        // animation loop advances; without this a capture shows the last frame.
        renderer._nodes.nodeFrame.update();
        renderer.setRenderTarget(captureRT);
        post.pipeline.render();
        renderer.setRenderTarget(null);
        const px = await renderer.readRenderTargetPixelsAsync(captureRT, 0, 0, w, h);

        captureCanvas.width = w; captureCanvas.height = h;
        const g = captureCanvas.getContext('2d');
        const img = g.createImageData(w, h);
        const flip = !renderer.backend.isWebGPUBackend; // WebGL reads bottom-up
        for (let y = 0; y < h; y++) {
            const src = (flip ? h - 1 - y : y) * w * 4;
            img.data.set(px.subarray(src, src + w * 4), y * w * 4);
        }
        g.putImageData(img, 0, 0);
        return captureCanvas.toDataURL(type, quality);
    } finally {
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
        camera.aspect = prevSize.x / prevSize.y; camera.updateProjectionMatrix();
        capturing = false;
    }
}

// Dev: a scripted shopper walks the store with a wandering gaze and the run is
// saved as a real session (heat, path, snapshots), so the results page and 3D
// replay can be exercised without a camera, microphone, or human tester.
async function simulateSession({ seconds = 36, fps = 30, snapshotEvery = 2 } = {}) {
    const route = [
        { x: -0.75, z: 26 }, { x: -0.75, z: 4 }, { x: -2.5, z: -3 },
        { x: -0.75, z: -12 }, { x: 1.5, z: -26 }
    ];
    const legLen = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.z - route[i].z));
    const total = legLen.reduce((a, b) => a + b, 0);
    const emotions = ['neutral', 'thinking', 'happy', 'confused', 'neutral', 'happy', 'mad'];

    heat.reset();
    pathVisualizer.reset();
    const startTime = Date.now();
    const sessionId = await db.sessions.add({ startTime, endTime: null, duration: 0 });
    const steps = seconds * fps;
    const dt = 1 / fps;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let d = t * total, k = 0;
        while (k < legLen.length - 1 && d > legLen[k]) d -= legLen[k++];
        const a = route[k], b = route[k + 1], f = Math.min(d / legLen[k], 1);
        const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        setPose({ x, z, yaw, pitch: 0 });
        // Glance left and right at the shelves, lingering now and then.
        const time = i * dt;
        setPointer(Math.sin(time * 0.9) * 0.85 + Math.sin(time * 2.3) * 0.1, 0.18 + Math.sin(time * 0.6) * 0.14);
        tick(dt);
        if (i % (snapshotEvery * fps) === 0) {
            const emo = emotions[(i / (snapshotEvery * fps)) % emotions.length];
            character.updateEmoji(emo);
            const p = character.person;
            await db.snapshots.add({
                sessionId,
                timestamp: startTime + Math.round(time * 1000),
                emotionManual: emo, emotionDetected: emo,
                gazeTarget: recorder.getGazeTargetDescription(window.currentGazeTarget),
                gazeVector: getCurrentGaze().direction, gazeOrigin: getCurrentGaze().origin,
                position: { x: p.position.x, y: p.position.y, z: p.position.z },
                rotation: p.rotation.y,
                screenshot: await captureFrame('image/jpeg', 0.6, { width: 640, height: 400 }),
                birdsEyeScreenshot: capturePlan(512),
                task: 'Find the chicken'
            });
        }
    }
    const pathPoints = [];
    for (let i = 0; i < pathVisualizer.count; i++) pathPoints.push({ x: pathVisualizer.positions[i * 3], y: 0.05, z: pathVisualizer.positions[i * 3 + 2] });
    await db.sessions.update(sessionId, {
        endTime: startTime + seconds * 1000, duration: seconds * 1000,
        heatmapData: heat.toObject(), pathPoints, collectedItems: [],
        finalPosition: { x: character.person.position.x, y: 0, z: character.person.position.z, rotation: character.person.rotation.y }
    });
    return sessionId;
}

function capturePlan(size = 512) {
    planCanvas.width = planCanvas.height = size;
    drawPlanMap(planCanvas, { layout, heat, path: pathVisualizer, person: character.person, items: world.items });
    return planCanvas.toDataURL('image/jpeg', 0.85);
}

export async function startFaceDetection() {
    if (faceDetector && await faceDetector.start()) {
        document.getElementById('webcam-video')?.classList.remove('hidden');
        return true;
    }
    return false;
}

export async function startTest() {
    // Clear the previous session only when a new test actually begins.
    try {
        await Promise.all(db.tables.map(table => table.clear()));
    } catch (e) {
        console.warn('Could not clear previous session data:', e);
    }
    await startFaceDetection();

    isTestActive = true;
    inventory?.clear();
    pathVisualizer?.reset();
    heat.reset();

    if (recorder) await recorder.start();
    voiceAgent?.startListening();
    document.getElementById('bottom-controls-container')?.classList.remove('hidden');
    document.getElementById('begin-test-btn')?.classList.add('hidden');
    promptManager?.start();
}

function appendDebugLog(msg) {
    try {
        const current = localStorage.getItem('debugLog') || '';
        localStorage.setItem('debugLog', (current + '\n' + msg + ' at ' + new Date().toISOString()).slice(-50000));
    } catch (e) { /* never break the session over logging */ }
}

export async function endTest() {
    appendDebugLog('[main] endTest called');
    isTestActive = false;

    if (faceDetector) {
        faceDetector.stop();
        document.getElementById('webcam-video')?.classList.add('hidden');
    }
    voiceAgent?.stopListening();

    try {
        if (recorder && recorder.sessionId) {
            const pathPoints = [];
            for (let i = 0; i < pathVisualizer.count; i++) {
                pathPoints.push({ x: pathVisualizer.positions[i * 3], y: pathVisualizer.positions[i * 3 + 1], z: pathVisualizer.positions[i * 3 + 2] });
            }
            const p = character.person;
            await db.sessions.update(recorder.sessionId, {
                heatmapData: heat.toObject(),   // v1-compatible "gx,gy,gz" keys
                pathPoints,
                collectedItems: inventory ? inventory.items.map(item => item.id || item.label) : [],
                finalPosition: { x: p.position.x, y: p.position.y, z: p.position.z, rotation: p.rotation.y }
            });
        }
    } catch (err) {
        console.error('Failed to save session snapshot data:', err);
    }

    if (recorder) {
        appendDebugLog('[main] awaiting recorder.stop');
        await recorder.stop();
        appendDebugLog('[main] recorder.stop completed');
    }

    document.getElementById('bottom-controls-container')?.classList.add('hidden');
    const popup = document.getElementById('completion-popup');
    if (popup) { popup.classList.remove('hidden'); popup.classList.add('visible'); }
}

document.getElementById('endTestBtn')?.addEventListener('click', endTest);

const viewResultsBtn = document.getElementById('viewResultsBtn');
viewResultsBtn?.addEventListener('click', async () => {
    const hasChicken = inventory.items.some(item => item.label.toLowerCase().includes('chicken'));
    if (!hasChicken && !confirm("You haven't collected the chicken yet. View results anyway?")) return;
    viewResultsBtn.textContent = 'Processing transcription...';
    viewResultsBtn.disabled = true;
    await new Promise(resolve => setTimeout(resolve, 500));
    window.location.href = '/results.html';
});

// Rolling frame-cost averages (ms) for the perf HUD and npm run bench.
const perf = { tick: 0, render: 0, gpu: 0, frames: 0 };
const ema = (prev, v) => prev ? prev * 0.95 + v * 0.05 : v;

// Frame pacing: cap at the preset's fps (120Hz displays would otherwise do
// double the work), and drop to ~20fps after a few seconds without input.
let lastInput = performance.now();
let lastFrame = 0;
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
}

function animate(time = performance.now()) {
    if (capturing) return; // don't present a different frame mid-capture
    const idle = time - lastInput > 3000 && !isTestActive;
    const cap = idle ? Math.min(QUALITY_FLAGS.fps || 60, 20) : QUALITY_FLAGS.fps;
    if (cap && time - lastFrame < 1000 / cap - 1) return;
    lastFrame = time;
    const dt = Math.min(clock.getDelta(), 0.1);
    const t0 = performance.now();
    tick(dt);
    const t1 = performance.now();
    renderFrame();
    const t2 = performance.now();
    perf.tick = ema(perf.tick, t1 - t0);
    perf.render = ema(perf.render, t2 - t1);
    perf.draws = renderer.info.render.drawCalls; // sampled on rendered frames (capped frames skip)
    perf.tris = renderer.info.render.triangles;
    perf.frames++;
    if (renderer.backend.trackTimestamp && perf.frames % 10 === 0) {
        renderer.resolveTimestampsAsync('render').then(ms => { if (ms) perf.gpu = ema(perf.gpu, ms); }).catch(() => {});
    }

    frameCount++;
    const now = performance.now();
    if (now - fpsT > 1000) { fps = Math.round(frameCount * 1000 / (now - fpsT)); frameCount = 0; fpsT = now; }
}

// One simulation step. Captures call tick(0) so a pose/camera change made
// while the page isn't animating (hidden tab, automation) still shows up.
function tick(dt) {
    updateMovement(dt);
    // Overview cameras sit far outside the store; fog would wash them out.
    scene.fog = freeCamera ? null : storeFog;
    if (freeCamera) {
        camera.position.set(...freeCamera.pos);
        camera.lookAt(...freeCamera.target);
        if (freeCamera.fov && camera.fov !== freeCamera.fov) { camera.fov = freeCamera.fov; camera.updateProjectionMatrix(); }
    } else if (camera.fov !== getDesiredFov()) {
        camera.fov = getDesiredFov(); camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    pathVisualizer.update(character.person.position);
    updateGaze(dt);
    updateCutout();
    if (freeCamera) cutout.enabled.value = 0;
    updateTutorial(character.person, null, getIsDragging());

    if (gameLogic && isTestActive) {
        gameLogic.update({ inventory });
        if (voiceAgent && recorder?.audioRecorder && emotionState) {
            voiceAgent.update(dt, emotionState.currentEmotion || emotionState.detectedEmotion || 'neutral');
        }
    }
}

init();
