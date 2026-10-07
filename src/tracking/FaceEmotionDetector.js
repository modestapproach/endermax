// face-api.js is ~600KB minified — load it only when the camera step actually
// runs instead of shipping it with the landing page bundle.
let faceapi = null;

export class FaceEmotionDetector {
    constructor(videoElement, onEmotionDetected) {
        this.video = videoElement;
        this.onEmotionDetected = onEmotionDetected;
        this.isRunning = false;
        this.detectionInterval = null;
        this.modelsLoaded = false;
        this.currentDetectedEmotion = null;
    }

    async loadModels() {
        try {
            console.log('🔄 Loading face-api.js models...');
            if (!faceapi) {
                faceapi = await import('face-api.js');
            }
            const MODEL_URL = '/models'; // We'll need to copy models to public folder

            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

            this.modelsLoaded = true;
            console.log('✅ Face-api.js models loaded');
            return true;
        } catch (error) {
            console.error('❌ Error loading face-api.js models:', error);
            return false;
        }
    }

    async startWebcam() {
        try {
            console.log('🎥 Starting webcam...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 320,
                    height: 240
                },
                audio: false
            });

            this.video.srcObject = stream;
            this.video.play();

            console.log('✅ Webcam started');
            return true;
        } catch (error) {
            console.error('❌ Error accessing webcam:', error);
            return false;
        }
    }

    mapFaceApiEmotionToApp(faceApiEmotions) {
        // face-api.js emotions: angry, disgusted, fearful, happy, neutral, sad, surprised
        // App emotions: happy, neutral, mad, confused, thinking

        // Get the dominant emotion from face-api
        const emotions = Object.entries(faceApiEmotions);
        const [dominantEmotion, confidence] = emotions.reduce((max, curr) =>
            curr[1] > max[1] ? curr : max
        );

        // Only proceed if confidence is above threshold
        if (confidence < 0.6) {
            return null;
        }

        // Map face-api emotions to our app emotions
        const emotionMap = {
            'happy': 'happy',
            'neutral': 'neutral',
            'angry': 'mad',
            'sad': 'confused',
            'surprised': 'thinking',
            'disgusted': 'mad',
            'fearful': 'confused'
        };

        return emotionMap[dominantEmotion] || null;
    }

    async detectEmotion() {
        if (!this.modelsLoaded || this.video.readyState !== 4) {
            return;
        }

        try {
            const detections = await faceapi
                .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions())
                .withFaceExpressions();

            if (detections && detections.expressions) {
                const mappedEmotion = this.mapFaceApiEmotionToApp(detections.expressions);

                if (mappedEmotion && mappedEmotion !== this.currentDetectedEmotion) {
                    this.currentDetectedEmotion = mappedEmotion;
                    console.log('😊 Detected emotion:', mappedEmotion);

                    if (this.onEmotionDetected) {
                        this.onEmotionDetected(mappedEmotion);
                    }
                }
            } else {
                // No face detected
                if (this.currentDetectedEmotion !== null) {
                    this.currentDetectedEmotion = null;
                    if (this.onEmotionDetected) {
                        this.onEmotionDetected(null);
                    }
                }
            }
        } catch (error) {
            console.error('Error detecting emotion:', error);
        }
    }

    async start() {
        console.log("   FaceEmotionDetector.start called");
        if (this.isRunning) return;

        // Load models if not loaded
        if (!this.modelsLoaded) {
            console.log("   Loading models...");
            const loaded = await this.loadModels();
            console.log("   Models loaded result:", loaded);
            if (!loaded) {
                console.error('Failed to load models');
                return false;
            }
        }

        // Start webcam if not started
        if (!this.video.srcObject) {
            console.log("   Starting webcam...");
            const started = await this.startWebcam();
            console.log("   Webcam started result:", started);
            if (!started) {
                console.error('Failed to start webcam');
                return false;
            }
        }

        this.isRunning = true;

        // Start detection loop (every 500ms)
        this.detectionInterval = setInterval(() => {
            this.detectEmotion();
        }, 500);

        console.log('✅ Face emotion detection started');
        return true;
    }

    stop() {
        this.isRunning = false;

        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }

        // Stop webcam
        if (this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(track => track.stop());
            this.video.srcObject = null;
        }

        console.log('⏹️ Face emotion detection stopped');
    }

    getCurrentEmotion() {
        return this.currentDetectedEmotion;
    }
}
