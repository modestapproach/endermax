export class EmotionState {
    constructor(onChange) {
        this.currentEmotion = null; // Manual emotion selected by user
        this.detectedEmotion = null; // Emotion detected by face-api
        this.buttons = document.querySelectorAll('.emotion-btn');
        this.onChange = onChange;
        this.timeoutId = null;
        this.setupListeners();
    }

    setupListeners() {
        this.buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setEmotion(btn.dataset.emotion);
            });
        });
    }

    setEmotion(emotion) {
        // Clear existing timeout
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }

        this.currentEmotion = emotion;
        this.updateUI();
        if (this.onChange) this.onChange(emotion);

        // Set timeout to reset after 4 seconds
        this.timeoutId = setTimeout(() => {
            this.resetEmotion();
        }, 4000);
    }

    resetEmotion() {
        this.currentEmotion = null;
        this.timeoutId = null;
        this.updateUI();
        if (this.onChange) this.onChange(null);
    }

    setDetectedEmotion(emotion) {
        this.detectedEmotion = emotion;
        this.updateUI();

        // Dispatch event for tutorial to detect face recognition success
        if (emotion) {
            window.dispatchEvent(new CustomEvent('faceDetectionSuccess', { detail: { emotion } }));
        }
    }

    updateUI() {
        this.buttons.forEach(btn => {
            const emotion = btn.dataset.emotion;

            // Active class for manual selection
            if (this.currentEmotion && emotion === this.currentEmotion) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }

            // Detected class for face detection
            if (this.detectedEmotion && emotion === this.detectedEmotion) {
                btn.classList.add('detected');
            } else {
                btn.classList.remove('detected');
            }
        });
    }

    getCurrentEmotion() {
        return this.currentEmotion;
    }

    getDetectedEmotion() {
        return this.detectedEmotion;
    }

    getBothEmotions() {
        return {
            manual: this.currentEmotion,
            detected: this.detectedEmotion
        };
    }
}
