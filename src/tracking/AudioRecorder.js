import { db } from '../db.js';

export class AudioRecorder {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;
        this.startTime = 0;
    }

    async start() {
        try {
            // Request high quality audio
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000
                }
            });

            // Try to use a better codec if available
            let options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn('⚠️ opus codec not supported, using default');
                options = {};
            }

            this.mediaRecorder = new MediaRecorder(stream, options);
            this.isRecording = true;
            this.chunks = []; // Reset chunks
            this.startTime = Date.now();

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.onerror = (e) => {
                console.error("❌ MediaRecorder error:", e);
                this.logDebug(`MediaRecorder Error: ${e.error ? e.error.message : 'Unknown error'}`);
            };

            // Request data every 1 second to ensure continuous capture
            this.mediaRecorder.start(1000);
            console.log("🎙️ Audio recording started at", new Date(this.startTime).toISOString());
            this.logDebug(`Recording started. Codec: ${this.mediaRecorder.mimeType}`);

            return this.startTime; // Return the exact start time for synchronization

        } catch (err) {
            console.error("❌ Error starting audio recording:", err);
            this.logDebug(`Error starting recording: ${err.message}`);
            throw err; // Propagate error to caller
        }
    }

    stop() {
        if (!this.isRecording) return Promise.resolve();

        this.isRecording = false;
        console.log("🛑 Stopping audio recording...");
        this.logDebug("Stopping recording...");

        return new Promise((resolve) => {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.onstop = async () => {
                    console.log("🎬 MediaRecorder stopped. Processing full audio...");
                    this.logDebug("MediaRecorder stopped. Processing...");
                    await this.processFullAudio();
                    console.log("✅ Audio processing complete. Transcription finished.");
                    this.logDebug("Processing complete.");
                    resolve();
                };
                this.mediaRecorder.stop();
            } else {
                console.log("⚠️ MediaRecorder already inactive");
                this.logDebug("MediaRecorder already inactive");
                resolve();
            }

            // Stop all tracks
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
        });
    }

    async processFullAudio() {
        console.log(`📊 Processing audio: ${this.chunks.length} chunks collected`);
        this.logDebug(`Processing ${this.chunks.length} chunks`);

        if (this.chunks.length === 0) {
            console.warn("⚠️ No audio chunks recorded.");
            this.logDebug("Warning: No chunks recorded");
            return;
        }

        // Log individual chunk sizes
        const totalBytes = this.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log(`   Total bytes from chunks: ${totalBytes}`);
        this.logDebug(`Total bytes: ${totalBytes}`);

        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        console.log(`🎵 Audio Blob created. Size: ${blob.size} bytes`);

        // Save audio blob to database for playback
        try {
            await db.audioRecordings.add({
                sessionId: this.sessionId,
                audioBlob: blob,
                startTime: this.startTime
            });
            console.log("💾 Audio blob saved to database for playback");
        } catch (err) {
            console.error("❌ Failed to save audio blob:", err);
            this.logDebug(`Failed to save blob: ${err.message}`);
        }

        await this.transcribe(blob);
    }

    async transcribe(audioBlob) {
        this.logDebug(`Transcribe called. Blob size: ${audioBlob.size}`);
        if (audioBlob.size < 1000) {
            console.warn("Audio blob too small to transcribe. Size:", audioBlob.size);
            this.logDebug(`Blob too small: ${audioBlob.size}`);
            return;
        }

        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');

        console.log("🎤 Sending audio to Server for transcription...");
        this.logDebug("Sending fetch request to /api/transcribe...");

        try {
            // Call our Cloudflare Function instead of OpenAI directly
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });

            this.logDebug(`Response status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error("❌ Server API Error:", response.status, errorText);
                this.logDebug(`API Error ${response.status}: ${errorText}`);
                return;
            }

            const data = await response.json();
            console.log("✅ Transcription Response received:", data);
            this.logDebug("Response JSON received");

            if (data.segments && data.segments.length > 0) {
                console.log(`📝 Received ${data.segments.length} segments. Saving to DB...`);
                this.logDebug(`Success: Received ${data.segments.length} segments`);

                // Save each segment to DB
                // Timestamps from OpenAI are in seconds relative to the start of the audio file.
                // We need to convert them to absolute timestamps (Date.now()) to match our timeline.

                const dbPromises = data.segments.map((segment, index) => {
                    const segmentStart = this.startTime + (segment.start * 1000);
                    const segmentEnd = this.startTime + (segment.end * 1000);

                    console.log(`  Segment ${index + 1}: "${segment.text.trim()}" (${segment.start}s - ${segment.end}s)`);
                    console.log(`    Absolute time: ${new Date(segmentStart).toISOString()} - ${new Date(segmentEnd).toISOString()}`);

                    return db.transcriptions.add({
                        sessionId: this.sessionId,
                        startTime: segmentStart,
                        endTime: segmentEnd,
                        text: segment.text.trim()
                    });
                });

                await Promise.all(dbPromises);
                console.log("✅ All transcription segments saved to DB.");

            } else if (data.error) {
                console.error("❌ Transcription Error:", data.error);
                this.logDebug(`Error from API: ${JSON.stringify(data.error)}`);
            } else {
                console.warn("⚠️ No segments found in response. Full response:", data);
                this.logDebug(`Warning: No segments. Response: ${JSON.stringify(data)}`);
            }

        } catch (err) {
            console.error("❌ Transcription failed:", err);
            console.error("   Error details:", err.message, err.stack);
            this.logDebug(`Exception: ${err.message}`);
        }
    }

    logDebug(msg) {
        const timestamp = new Date().toLocaleTimeString();
        const log = `[${timestamp}] ${msg}\n`;
        try {
            // Keep only the most recent ~50KB so the log can never hit the
            // localStorage quota and abort recording startup.
            const current = localStorage.getItem('debugLog') || '';
            localStorage.setItem('debugLog', (current + log).slice(-50000));
        } catch (e) {
            // Quota exceeded or storage unavailable — logging must never break recording.
        }
    }
}
