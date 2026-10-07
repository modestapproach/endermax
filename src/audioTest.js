export class AudioTest {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.testAudioBlob = null;
        this.isRecording = false;
        this.recordingDuration = 3000; // 3 seconds
    }

    init() {
        // const panel = document.getElementById('audio-test-panel'); // Removed
        // const closeBtn = document.getElementById('closeAudioTestBtn'); // Removed
        const startBtn = document.getElementById('startTestRecordBtn');
        const playBtn = document.getElementById('playTestAudioBtn');
        const statusEl = document.getElementById('audioTestStatus');
        const audioPlayer = document.getElementById('testAudioPlayer');

        if (!startBtn || !playBtn || !statusEl) {
            console.warn('Audio test elements not found');
            return;
        }

        console.log('✅ Audio test initialized');

        // Start recording test
        startBtn.addEventListener('click', async () => {
            if (this.isRecording) return;

            console.log('🎤 Starting test recording...');

            try {
                await this.startTestRecording();
                startBtn.disabled = true;
                startBtn.innerHTML = '<span class="rec-dot"></span>Recording…';
                statusEl.innerHTML = '<span class="recording-indicator"></span>Recording...';

                let countdown = 3;
                const countdownInterval = setInterval(() => {
                    countdown--;
                    if (countdown > 0) {
                        statusEl.innerHTML = `<span class="recording-indicator"></span>Recording... ${countdown}s`;
                    }
                }, 1000);

                this.cancelled = false;
                this._countdownInterval = countdownInterval;
                setTimeout(async () => {
                    clearInterval(countdownInterval);
                    await this.stopTestRecording();
                    if (this.cancelled) {
                        startBtn.disabled = false;
                        startBtn.innerHTML = '<span class="rec-dot"></span>Record';
                        statusEl.textContent = '';
                        return;
                    }
                    startBtn.disabled = false;
                    startBtn.innerHTML = '<span class="rec-dot"></span>Record again';
                    playBtn.classList.remove('hidden');

                    // Show audio player
                    if (audioPlayer && this.testAudioBlob) {
                        audioPlayer.src = URL.createObjectURL(this.testAudioBlob);
                        audioPlayer.style.display = 'block';
                        audioPlayer.classList.remove('hidden');
                    }

                    statusEl.innerHTML = '✅ Done!';
                    statusEl.style.color = 'var(--success-color)';

                    // Dispatch event to notify tutorial that audio test is done
                    window.dispatchEvent(new CustomEvent('audioTestComplete'));

                }, this.recordingDuration);

            } catch (err) {
                console.error('❌ Failed to start test recording:', err);
                statusEl.textContent = '❌ Failed: ' + err.message;
                statusEl.style.color = 'var(--danger-color)';
                startBtn.disabled = false;
            }
        });

        // Play button (legacy, but keep for simplicity)
        playBtn.addEventListener('click', () => {
            if (audioPlayer) {
                audioPlayer.play();
            }
        });
    }

    // show() removed as it is no longer needed

    async startTestRecording() {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000
            }
        });

        console.log('🎤 Audio stream obtained:', {
            tracks: stream.getAudioTracks().length,
            trackSettings: stream.getAudioTracks()[0]?.getSettings(),
            trackEnabled: stream.getAudioTracks()[0]?.enabled,
            trackMuted: stream.getAudioTracks()[0]?.muted,
            trackReadyState: stream.getAudioTracks()[0]?.readyState
        });

        let options = { mimeType: 'audio/webm;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn('⚠️ opus codec not supported, trying default');
            options = {};
        }

        this.mediaRecorder = new MediaRecorder(stream, options);
        this.audioChunks = [];
        this.isRecording = true;

        console.log('📹 MediaRecorder created:', {
            mimeType: this.mediaRecorder.mimeType,
            state: this.mediaRecorder.state,
            audioBitsPerSecond: this.mediaRecorder.audioBitsPerSecond
        });

        this.mediaRecorder.ondataavailable = (e) => {
            console.log('📦 Data chunk received:', e.data.size, 'bytes');
            if (e.data.size > 0) {
                this.audioChunks.push(e.data);
            }
        };

        this.mediaRecorder.onerror = (e) => {
            console.error('❌ MediaRecorder error:', e);
        };

        this.mediaRecorder.start(100); // Collect data every 100ms
        console.log('🎤 Test recording started');
    }

    async stopTestRecording() {
        return new Promise((resolve) => {
            const recorder = this.mediaRecorder;
            let done = false;
            const finish = (why) => {
                if (done) return;
                done = true;
                this.isRecording = false;
                this.testAudioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                console.log(`✅ Test recording stopped (${why}). Size:`, this.testAudioBlob.size, 'bytes');
                recorder?.stream?.getTracks().forEach(track => track.stop());
                resolve();
            };

            if (!recorder || recorder.state === 'inactive') { finish('already inactive'); return; }

            recorder.onstop = () => finish('onstop');
            // Never hang the tutorial on a recorder that doesn't report back.
            setTimeout(() => finish('timeout'), 1500);
            try {
                recorder.stop();
            } catch (e) {
                console.warn('MediaRecorder.stop failed:', e);
                finish('stop threw');
            }
        });
    }

    // Abort an in-progress test (e.g. the participant pressed Skip Step).
    cancel() {
        if (!this.isRecording) return;
        this.cancelled = true;
        clearInterval(this._countdownInterval);
        const statusEl = document.getElementById('audioTestStatus');
        if (statusEl) statusEl.textContent = '';
        this.stopTestRecording();
    }
}
