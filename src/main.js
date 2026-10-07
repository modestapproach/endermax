import * as THREE from 'three';
import { createEnvironment, createBlocks } from './scene.js';
import { createPerson } from './person.js';
import { setupControls, updateMovement, updateGaze, attachUIHandlers, updateObstruction, getIsDragging } from './interaction.js';
import './ui.css';

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

let scene, camera, renderer, person, gazeRay;
let birdsEyeCamera, birdsEyeRenderer; // Orthographic camera for top-down view
let blocks = [];
let heatmapData = new Map();
let blockMap = new Map();
let ground; // Ground plane for gaze detection
let pathVisualizer;
let promptManager;
let gameLogic;
let inventory;
let startPosition;
let objectiveStartTime;
let isTestActive = false;

let emotionState;
let recorder;
let faceDetector;
let voiceAgent;
let clock;

// Initialize Recorder
// export const recorder = new Recorder(); // Removed old export

function init() {
    // Scene setup
    scene = new THREE.Scene();

    // ... (rest of scene setup) ...

    // Camera - positioned behind and slightly above the person's head with fish-eye effect
    // Fog fully occludes everything past 70 units, so a 100-unit far plane
    // culls the same view for less GPU work than the old 1000.
    camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 4, 3.5);
    camera.lookAt(0, 2.5, -5);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('canvas'),
        antialias: true,
        preserveDrawingBuffer: true // Required for screenshots
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Bird's Eye Orthographic Camera (top-down view, no perspective)
    const frustumSize = 60; // Adjust to see the whole scene
    birdsEyeCamera = new THREE.OrthographicCamera(
        -frustumSize / 2, frustumSize / 2,
        frustumSize / 2, -frustumSize / 2,
        0.1, 1000
    );
    birdsEyeCamera.position.set(0, 50, 0); // High above the scene
    birdsEyeCamera.lookAt(0, 0, 0); // Look straight down
    birdsEyeCamera.up.set(0, 0, -1); // Set up vector to align with scene

    // Bird's Eye Renderer (offscreen)
    birdsEyeRenderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: true
    });
    birdsEyeRenderer.setSize(512, 512); // Fixed size for bird's eye view
    birdsEyeRenderer.shadowMap.enabled = true;
    birdsEyeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Environment
    const envObjects = createEnvironment(scene);
    ground = envObjects.ground;
    createBlocks(scene, blocks, heatmapData, blockMap);

    // Path Visualizer
    pathVisualizer = new PathVisualizer(scene);

    // Person
    const personData = createPerson(scene);
    person = personData.person;
    gazeRay = personData.gazeRay;

    // Initialize Inventory
    inventory = new Inventory();

    // Initialize Emotion State
    emotionState = new EmotionState((emotion) => {
        if (personData && personData.updateEmoji) {
            personData.updateEmoji(emotion);
        }
    });

    // Initialize Face Emotion Detector
    const webcamVideo = document.getElementById('webcam-video');
    faceDetector = new FaceEmotionDetector(webcamVideo, (detectedEmotion) => {
        if (emotionState) {
            emotionState.setDetectedEmotion(detectedEmotion);
        }
    });

    // Initialize Recorder
    recorder = new Recorder(person, heatmapData, emotionState, renderer);

    // Controls
    setupControls(camera, person, renderer, inventory);
    attachUIHandlers(blocks, heatmapData, recorder); // Pass recorder to UI handlers

    // Initialize Prompt Manager
    promptManager = new PromptManager();

    // Initialize Game Logic
    // Initialize Game Logic
    gameLogic = new GameLogic(promptManager, async () => {
        await endTest();
    });
    promptManager.setGameLogic(gameLogic);

    // Initialize Voice Agent
    voiceAgent = new VoiceAgent();
    clock = new THREE.Clock();

    // Expose gameLogic globally for Recorder to access current task
    window.gameLogic = gameLogic;
    window.voiceAgent = voiceAgent;
    window.recorder = recorder;

    // Store starting position
    startPosition = { x: person.position.x, y: person.position.y, z: person.position.z };
    objectiveStartTime = Date.now();

    // Initialize Front Page -> Landing Page -> Intro Modal -> Tutorial
    initFrontPage(() => {
        initLandingPage(() => {
            initIntroModal(() => {
                // Start Tutorial after intro is dismissed
                initTutorial();
            });
        });
    });

    animate();
}

// Export helper to start face detection
export async function startFaceDetection() {
    if (faceDetector) {
        const started = await faceDetector.start();
        if (started) {
            // Show webcam video
            const webcamVideo = document.getElementById('webcam-video');
            if (webcamVideo) webcamVideo.classList.remove('hidden');
            return true;
        }
    }
    return false;
}

// Test Flow Control
export async function startTest() {
    console.log("🚀 startTest called");
    // Clear the previous session only when a new test actually begins —
    // clearing on page load meant a stray reload destroyed recorded data.
    try {
        await Promise.all(db.tables.map(table => table.clear()));
    } catch (e) {
        console.warn("Could not clear previous session data:", e);
    }
    // Start face detection (if not already started)
    console.log("   Calling startFaceDetection...");
    await startFaceDetection();
    console.log("   startFaceDetection returned");

    isTestActive = true;
    if (inventory) inventory.clear();

    // Drop tutorial-phase wandering from the recorded path — the analysis
    // should only see movement from the actual test.
    if (pathVisualizer) pathVisualizer.reset();

    // Reset Heatmap
    heatmapData.clear();
    blocks.forEach(block => {
        if (block.material) {
            block.userData._appliedHeat = 0; // keep updateGaze's dirty-tracking in sync
            block.material.color.setHex(0xffffff);
            block.material.emissive.setHex(0x000000);
        }
    });

    // Start recording
    console.log("   Starting recorder...");
    if (recorder) await recorder.start(); // Added await just in case, though it's async
    console.log("   Recorder started");

    // Start Voice Agent listening
    if (voiceAgent) voiceAgent.startListening();

    // Show bottom controls
    const bottomControls = document.getElementById('bottom-controls-container');
    if (bottomControls) bottomControls.classList.remove('hidden');

    // Hide Begin Test button
    const beginTestBtn = document.getElementById('begin-test-btn');
    if (beginTestBtn) beginTestBtn.classList.add('hidden');

    // Start Prompt Manager
    if (promptManager) {
        promptManager.start();
    }
    console.log("✅ startTest complete");
}

// Appends to the persistent debug log, capped so it can never fill localStorage.
function appendDebugLog(msg) {
    try {
        const current = localStorage.getItem('debugLog') || '';
        localStorage.setItem('debugLog', (current + '\n' + msg + ' at ' + new Date().toISOString()).slice(-50000));
    } catch (e) { /* storage full/unavailable — never break the session over logging */ }
}

export async function endTest() {
    console.log("🏁 End Test clicked - stopping recording...");
    appendDebugLog('[main] endTest called');

    isTestActive = false;

    // Stop face detection
    if (faceDetector) {
        faceDetector.stop();
        // Hide webcam video
        const webcamVideo = document.getElementById('webcam-video');
        if (webcamVideo) webcamVideo.classList.add('hidden');
    }

    // Stop Voice Agent listening
    if (voiceAgent) voiceAgent.stopListening();

    // Capture Session Data for 3D Snapshot
    try {
        if (recorder && recorder.sessionId) {
            // 1. Heatmap Data (Keyed by Grid Coordinates for stability)
            // We need to iterate blocks to get coordinates, as heatmapData only has UUIDs
            // and UUIDs change on every reload.
            const heatmapObj = {};
            blocks.forEach(block => {
                const heat = heatmapData.get(block.uuid);
                if (heat > 0 && block.userData) {
                    const key = `${block.userData.gridX},${block.userData.gridY},${block.userData.gridZ}`;
                    heatmapObj[key] = heat;
                }
            });

            // 2. Path Points
            let pathPoints = [];
            if (pathVisualizer && pathVisualizer.positions) {
                // Extract valid points up to current count
                for (let i = 0; i < pathVisualizer.count; i++) {
                    pathPoints.push({
                        x: pathVisualizer.positions[i * 3],
                        y: pathVisualizer.positions[i * 3 + 1],
                        z: pathVisualizer.positions[i * 3 + 2]
                    });
                }
            }

            // 3. Collected Items (from Inventory)
            const collectedItems = inventory ? inventory.items.map(item => item.id || item.label) : [];

            // 4. Final Position
            const finalPosition = {
                x: person.position.x,
                y: person.position.y,
                z: person.position.z,
                rotation: person.rotation.y
            };

            // Update Session in DB. Snapshots stay in their own table — the
            // results page passes them to the viewer directly, and duplicating
            // every screenshot into the session record doubled storage.
            await db.sessions.update(recorder.sessionId, {
                heatmapData: heatmapObj,
                pathPoints: pathPoints,
                collectedItems: collectedItems,
                finalPosition: finalPosition
            });
            console.log("💾 Session snapshot data saved to DB");
        }
    } catch (err) {
        console.error("❌ Failed to save session snapshot data:", err);
    }

    // Stop recording and wait for transcription to complete
    // Stop recording and wait for transcription to complete
    if (recorder) {
        console.log("⏳ Awaiting recorder.stop()...");
        appendDebugLog('[main] awaiting recorder.stop');

        await recorder.stop();

        console.log("✅ Recorder fully stopped with transcription complete");
        appendDebugLog('[main] recorder.stop completed');
    } else {
        console.warn("⚠️ No recorder found!");
        appendDebugLog('[main] NO RECORDER');
    }

    // Hide bottom controls
    const bottomControls = document.getElementById('bottom-controls-container');
    if (bottomControls) bottomControls.classList.add('hidden');

    // Show Mission Complete / Next Mission logic
    showCompletionPopup();
    console.log("✅ Completion popup shown");
}

function showCompletionPopup() {
    const popup = document.getElementById('completion-popup');
    if (popup) {
        popup.classList.remove('hidden');
        popup.classList.add('visible');
    }
}

// Wire up End Test button
const endTestBtn = document.getElementById('endTestBtn');
if (endTestBtn) {
    endTestBtn.addEventListener('click', endTest);
}

// Wire up View Results button
const viewResultsBtn = document.getElementById('viewResultsBtn');
if (viewResultsBtn) {
    viewResultsBtn.addEventListener('click', async () => {
        console.log("🔍 View Results button clicked");

        // Nudge toward finishing the tasks, but never dead-end the researcher —
        // the session data exists whether or not the chicken was collected.
        const hasChicken = inventory.items.some(item => item.label.toLowerCase().includes('chicken'));
        if (!hasChicken && !confirm("You haven't collected the chicken yet. View results anyway?")) {
            return;
        }

        // Show loading state
        const originalText = viewResultsBtn.textContent;
        viewResultsBtn.textContent = 'Processing transcription...';
        viewResultsBtn.disabled = true;

        // Wait a moment to ensure any pending transcription completes
        // (In case user clicks before endTest completes)
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log("🚀 Navigating to results page...");
        window.location.href = '/results.html';
    });
}

// Animation Loop
let lastObjectiveIndex = -1;
function animate() {
    requestAnimationFrame(animate);
    // One shared delta per frame, clamped so a backgrounded tab can't produce
    // a giant catch-up step. All movement/heat rates are dt-scaled.
    const dt = Math.min(clock.getDelta(), 0.1);
    updateMovement(camera, person, dt);

    // Update path trail
    if (pathVisualizer) {
        pathVisualizer.update(person.position);
    }

    updateGaze(camera, person, blocks, heatmapData, gazeRay, ground, dt);
    updateObstruction(camera, person, blocks, blockMap);

    // Update tutorial
    const isDragging = getIsDragging();
    updateTutorial(person, heatmapData, isDragging);

    // Update game logic and check objectives
    if (gameLogic && isTestActive) {
        gameLogic.update({ inventory });

        // Reset the objective timer once when the active objective changes
        if (gameLogic.currentObjectiveIndex !== lastObjectiveIndex) {
            lastObjectiveIndex = gameLogic.currentObjectiveIndex;
            objectiveStartTime = Date.now();
        }

        // Update Voice Agent
        if (voiceAgent && recorder && recorder.audioRecorder && emotionState) {
            const currentEmotion = emotionState.currentEmotion || emotionState.detectedEmotion || 'neutral';
            voiceAgent.update(dt, currentEmotion);
        }
    }

    renderer.render(scene, camera);
}

// Tutorial Event Listeners
window.addEventListener('tutorialSpawnObject', (e) => {
    const object = e.detail.object;
    if (object) {
        // Add to scene
        // We need to ensure it's added to the scene, but tutorial.js might have tried to add it to person.parent
        // Let's just ensure it's in the blocks array for raycasting
        if (!blocks.includes(object)) {
            blocks.push(object);
        }
        // Ensure it's in the scene if not already
        if (!object.parent) {
            scene.add(object);
        }
    }
});

window.addEventListener('tutorialRemoveObject', (e) => {
    const object = e.detail.object;
    if (object) {
        // Remove from scene
        if (object.parent) {
            object.parent.remove(object);
        }
        // Remove from blocks array
        const index = blocks.indexOf(object);
        if (index > -1) {
            blocks.splice(index, 1);
        }
        // Clean up heatmap data
        heatmapData.delete(object.uuid);
        // Free GPU resources — removed meshes never come back
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
            (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
        }
    }
});

// Export function to get bird's eye renderer and camera
export function getBirdsEyeView() {
    return {
        renderer: birdsEyeRenderer,
        camera: birdsEyeCamera,
        scene: scene,
        pathVisualizer: pathVisualizer
    };
}



init();
