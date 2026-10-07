import { db } from '../db.js';
import { getCurrentGaze } from '../interaction.js';
import { AudioRecorder } from './AudioRecorder.js';

export class Recorder {
    constructor(person, emotionState, capture) {
        this.person = person;
        this.emotionState = emotionState;
        this.capture = capture;

        this.isRecording = false;
        this.sessionId = null;
        this.intervalId = null;
        this.audioRecorder = null;
    }

    // Helper function to format gaze target description
    getGazeTargetDescription(gazeTarget) {
        if (!gazeTarget || !gazeTarget.userData) {
            return 'nothing';
        }

        const userData = gazeTarget.userData;

        // Handle ground and sky
        if (userData.type === 'ground') {
            return 'floor';
        }
        if (userData.type === 'sky') {
            return 'sky';
        }

        // Handle pickup items (beans, chicken, etc.)
        if (userData.type === 'item') {
            return userData.label || 'item';
        }

        // Handle image blocks (shelves, signs)
        if (userData.isImageBlock) {
            const label = userData.label;
            const blockType = userData.blockType;

            let typeName = '';
            if (blockType === 'x') {
                typeName = 'shelf';
            } else if (blockType === '#' || blockType === '!') {
                // Both '#' and '!' are signs
                typeName = 'sign';
            } else {
                typeName = 'object';
            }

            // Format: "label typeName" or just "typeName" if no label
            if (label && label !== 'na') {
                return `${label} ${typeName}`;
            } else {
                return typeName;
            }
        }

        // Handle regular blocks (x without image)
        if (!userData.isImageBlock) {
            return 'shelf'; // generic shelf
        }

        return 'object';
    }

    async start() {
        if (this.isRecording) return;

        this.isRecording = true;

        try {
            // Start Audio Recorder FIRST to establish the exact start time.
            // A denied/missing microphone must not abort the whole session —
            // snapshots, gaze, path, and emotion capture work without audio.
            let startTime;
            try {
                this.audioRecorder = new AudioRecorder(null); // Will set sessionId later
                await this.audioRecorder.start(); // Wait for audio to actually start
                startTime = this.audioRecorder.startTime;
            } catch (audioError) {
                console.warn('🎤 Audio unavailable — recording session without voice:', audioError);
                this.audioRecorder = null;
                startTime = Date.now();
            }

            this.sessionId = await db.sessions.add({
                startTime: startTime,
                endTime: null,
                duration: 0
            });

            // Update audio recorder with session ID
            if (this.audioRecorder) this.audioRecorder.sessionId = this.sessionId;

            console.log(`📊 Recording started. Session ID: ${this.sessionId}`);
            console.log(`⏰ Start time: ${new Date(startTime).toISOString()}`);

            // Take immediate first snapshot (now synchronized with audio start)
            await this.poll();

            // Start polling every 2 seconds for subsequent snapshots
            this.intervalId = setInterval(() => this.poll(), 2000);

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
        }
    }

    async stop() {
        if (!this.isRecording) return;

        this.isRecording = false;
        clearInterval(this.intervalId);

        console.log("🎯 Recorder.stop() called - waiting for audio transcription...");

        // Wait for audio recording to stop and transcription to complete
        if (this.audioRecorder) {
            await this.audioRecorder.stop();
            console.log("✅ Audio recorder stopped and transcription complete");
        }

        try {
            const endTime = Date.now();
            const session = await db.sessions.get(this.sessionId);

            if (session) {
                await db.sessions.update(this.sessionId, {
                    endTime: endTime,
                    duration: endTime - session.startTime
                });
            }

            console.log(`✅ Recording stopped. Session ID: ${this.sessionId}`);

        } catch (error) {
            console.error('❌ Failed to stop recording:', error);
        }
    }

    async poll() {
        if (!this.isRecording) return;

        try {
            const timestamp = Date.now();
            const emotions = this.emotionState.getBothEmotions();
            const manualEmotion = emotions.manual;
            const detectedEmotion = emotions.detected;

            // Get gaze target
            const gazeTarget = window.currentGazeTarget;
            const gazeDescription = this.getGazeTargetDescription(gazeTarget);

            // Get current task
            const currentTask = window.gameLogic ?
                window.gameLogic.getCurrentObjective()?.description :
                'No task';

            // Frame + plan-map captures come from the engine (`capture` is
            // { frame(), plan() }); WebGPU canvases must be read in the same
            // task they're rendered, so the engine renders on demand.
            let screenshot = null;
            let birdsEyeScreenshot = null;
            try {
                screenshot = await this.capture.frame('image/jpeg', 0.5);
                birdsEyeScreenshot = this.capture.plan();
            } catch (error) {
                console.error('Error capturing snapshot images:', error);
            }

            // Get position
            const position = {
                x: this.person.position.x,
                y: this.person.position.y,
                z: this.person.position.z,
                rotation: this.person.rotation.y
            };

            // Calculate offset from audio start
            const audioOffset = this.audioRecorder ?
                ((timestamp - this.audioRecorder.startTime) / 1000).toFixed(2) :
                'N/A';

            // Capture real gaze data
            const gazeData = getCurrentGaze();

            // Save snapshot
            await db.snapshots.add({
                sessionId: this.sessionId,
                timestamp: Date.now(),
                emotionManual: manualEmotion,
                emotionDetected: detectedEmotion,
                gazeTarget: gazeDescription,
                gazeVector: gazeData.direction, // Save direction
                gazeOrigin: gazeData.origin,    // Save origin
                position: {
                    x: this.person.position.x,
                    y: this.person.position.y,
                    z: this.person.position.z
                },
                rotation: this.person.rotation.y,
                screenshot: screenshot, // Kept original `screenshot` variable
                birdsEyeScreenshot: birdsEyeScreenshot, // Kept original `birdsEyeScreenshot`
                task: currentTask
            });

            console.log(`📸 Snapshot at +${audioOffset}s | Task: ${currentTask} | Looking at: ${gazeDescription} | Manual: ${manualEmotion} | Detected: ${detectedEmotion}`);

        } catch (error) {
            console.error('Error polling data:', error);
        }
    }
}
